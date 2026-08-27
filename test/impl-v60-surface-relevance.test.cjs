// `src/core/surfaceRelevance.ts`: the ordering seam for injected member
// signatures on the test-repair leg.
//
// WHY THIS MODULE EXISTS AT ALL. Measured on the real Rust corpus with a seeded
// defect, `qwen3-coder:30b` at temperature 0, three repetitions per arm, every
// candidate fix spliced back and VERIFIED BY `cargo test` rather than graded on
// reply text:
//
//   failure evidence only ............................ 0/3 restored, 0/3 green
//   evidence + SOURCE-ordered receiver surface ....... 0/3 restored, 0/3 green
//   evidence + RELEVANCE-ordered receiver surface .... 3/3 restored, 3/3 green
//   evidence + relevance-ordered, top 16 only ........ 0/3 restored, 0/3 green
//
// Same 100 signatures, same budget, same model. Only the ORDER differs. The
// losing arms invented `cache.get_required_disk_space()`, which does not exist,
// or picked a real but wrong `cache.pending_append_bytes()`.
//
// This seam sits on a shared prompt path, so the rows below are mostly about
// what it must NOT do: never throw, never mutate, never drop or duplicate a
// line, and return the input untouched when it has nothing to go on.
//
// Run: node --test test/impl-v60-surface-relevance.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-v60-surface-relevance",
  `export { orderByRelevance, orderSurfaceByRelevance } from "../src/core/surfaceRelevance";\n`,
);
const { orderByRelevance, orderSurfaceByRelevance } = mod;
test.after(cleanup);

// Twenty plausible receiver signatures traced from the shape of the measured
// crate's cache type. `buffer_size_total` is the one the fix needs.
const SIGS = [
  "pub fn new(capacity: usize) -> Self",
  "pub fn insert(&mut self, key: ShardKey, value: Vec<u8>)",
  "pub fn remove(&mut self, key: &ShardKey) -> Option<Vec<u8>>",
  "pub fn contains(&self, key: &ShardKey) -> bool",
  "pub fn iter(&self) -> impl Iterator<Item = (&ShardKey, &Vec<u8>)>",
  "pub fn clear(&mut self)",
  "pub fn len(&self) -> usize",
  "pub fn is_empty(&self) -> bool",
  "pub fn evict_oldest(&mut self) -> Option<ShardKey>",
  "pub fn touch(&mut self, key: &ShardKey)",
  "pub fn hit_ratio(&self) -> f64",
  "pub fn pending_append_bytes(&self) -> u64",
  "pub fn buffer_size_total(&self) -> u64",
  "pub fn generation(&self) -> u32",
  "pub fn set_ceiling(&mut self, ceiling: usize)",
  "pub fn ceiling(&self) -> usize",
  "pub fn flush_marker(&self) -> Option<Lsn>",
  "pub fn reserve(&mut self, additional: usize)",
  "pub fn shrink_to_fit(&mut self)",
  "pub fn as_slice(&self) -> &[u8]",
];

const TARGET = [
  "fn capture_fsync_snapshot(cache: &MemCache, disk: &DiskGuard) -> Snapshot {",
  "    let required_disk_space = 0;",
  "    Snapshot::new(required_disk_space, cache.generation())",
  "}",
].join("\n");

const EVIDENCE = [
  "test shard_wal::tests::snapshot_reserves_buffer FAILED",
  "assertion `left == right` failed",
  "  left: 0",
  " right: 4096",
  "at src/shard_wal_sync.rs:118: assert_eq!(snap.required_disk_space, cache.buffer_size_total());",
].join("\n");

const FENCE = "```";

test("empty context returns the input order byte-identical", () => {
  const out = orderByRelevance(SIGS, { targetText: "" });
  assert.deepStrictEqual(out, [...SIGS]);
});

test("an empty context object with an empty evidence and doc comment is still identity", () => {
  const out = orderByRelevance(SIGS, { targetText: "", evidenceText: "", docComment: "" });
  assert.deepStrictEqual(out, [...SIGS]);
});

test("all-equal scores keep input order: the tiebreak is the original index", () => {
  // Every candidate shares exactly the token `alpha` with the context, so every
  // score is 1 and only the stable tiebreak can decide the order.
  const lines = ["alpha one", "alpha two", "alpha three", "alpha four"];
  const out = orderByRelevance(lines, { targetText: "alpha" });
  assert.deepStrictEqual(out, lines);
});

test("all-zero scores keep input order", () => {
  const out = orderByRelevance(SIGS, { targetText: "zzz_nothing_here_matches_qqq" });
  assert.deepStrictEqual(out, [...SIGS]);
});

test("the measured case: the member the fix needs rises out of the middle of the list", () => {
  const before = SIGS.indexOf("pub fn buffer_size_total(&self) -> u64");
  const out = orderByRelevance(SIGS, { targetText: TARGET, evidenceText: EVIDENCE });
  const after = out.indexOf("pub fn buffer_size_total(&self) -> u64");
  assert.ok(after < before, `expected the needed member to rise, was ${before} now ${after}`);
  // And it beats the real-but-wrong member the source-ordered arm picked.
  assert.ok(after < out.indexOf("pub fn pending_append_bytes(&self) -> u64"));
});

test("the doc comment contributes to the context", () => {
  const lines = ["pub fn unrelated_thing(&self)", "pub fn flush_marker(&self) -> Option<Lsn>"];
  const plain = orderByRelevance(lines, { targetText: "" });
  assert.deepStrictEqual(plain, lines);
  const withDoc = orderByRelevance(lines, { targetText: "", docComment: "/// Reads the cache's `flush_marker` before the snapshot." });
  assert.strictEqual(withDoc[0], "pub fn flush_marker(&self) -> Option<Lsn>");
});

test("deterministic: the same input twice is deep-equal", () => {
  const a = orderByRelevance(SIGS, { targetText: TARGET, evidenceText: EVIDENCE });
  const b = orderByRelevance(SIGS, { targetText: TARGET, evidenceText: EVIDENCE });
  assert.deepStrictEqual(a, b);
});

test("pure: a deep-frozen input is neither thrown on nor mutated", () => {
  const frozen = Object.freeze(SIGS.map((s) => s));
  const ctx = Object.freeze({ targetText: TARGET, evidenceText: EVIDENCE });
  const copy = [...frozen];
  const out = orderByRelevance(frozen, ctx);
  assert.deepStrictEqual([...frozen], copy);
  assert.notStrictEqual(out, frozen);
});

test("total: degenerate inputs never throw", () => {
  assert.deepStrictEqual(orderByRelevance([], { targetText: TARGET }), []);
  assert.deepStrictEqual(orderByRelevance([""], { targetText: "" }), [""]);
  assert.deepStrictEqual(orderByRelevance(["   "], { targetText: TARGET }), ["   "]);
  // A candidate with no identifier token at all: punctuation only.
  assert.deepStrictEqual(orderByRelevance(["!!! ((( +++"], { targetText: TARGET }), ["!!! ((( +++"]);
  // Tokens under three characters are below the floor on both sides.
  assert.deepStrictEqual(orderByRelevance(["a b c"], { targetText: "a b c" }), ["a b c"]);
  const huge = "wal_segment_flush ".repeat(6000); // well past 100KB
  assert.ok(huge.length > 100_000);
  assert.strictEqual(orderByRelevance(SIGS, { targetText: huge }).length, SIGS.length);
  assert.strictEqual(orderByRelevance([huge], { targetText: huge })[0], huge);
});

// THE PROPERTY THAT MAKES IT SAFE TO PUT ON A SHARED PROMPT PATH. A reorder that
// can drop or duplicate a signature would silently shrink or corrupt the surface
// the model is told it may call from, and the firm instruction names types on
// the strength of what rendered.
test("property: the output is always a permutation of the input", () => {
  const fixtures = [
    { lines: [], ctx: { targetText: "" } },
    { lines: SIGS, ctx: { targetText: TARGET, evidenceText: EVIDENCE } },
    { lines: SIGS, ctx: { targetText: "" } },
    { lines: ["dup", "dup", "dup"], ctx: { targetText: "dup" } },
    { lines: ["dup", "other", "dup"], ctx: { targetText: "other dup" } },
    { lines: ["", "", "x"], ctx: { targetText: "x" } },
    { lines: SIGS.map((s) => s.toUpperCase()), ctx: { targetText: TARGET } },
    { lines: ["éè accented", "plain_token_here"], ctx: { targetText: "plain_token_here" } },
    { lines: Array.from({ length: 200 }, (_, i) => `pub fn m${i}(&self) -> u64`), ctx: { targetText: TARGET } },
  ];
  const multiset = (xs) => {
    const m = new Map();
    for (const x of xs) {
      m.set(x, (m.get(x) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  };
  for (const { lines, ctx } of fixtures) {
    const out = orderByRelevance(lines, ctx);
    assert.strictEqual(out.length, lines.length);
    assert.deepStrictEqual(multiset(out), multiset(lines));
  }
});

// ---------------------------------------------------------------------------
// The rendered-surface wrapper. The test leg does not hold a list of lines; it
// holds one assembled string of headed, fenced blocks.
// ---------------------------------------------------------------------------

const apiBlock = (type, sigs) =>
  `API surface for \`${type}\` (real signatures, use these exact names, do not invent):\n${FENCE}\n${sigs.join("\n")}\n${FENCE}`;

const SURFACE = [
  "Data shape of `MemCache` (fields and types, nested):\n" +
    `${FENCE}rust\nstruct MemCache {\n    generation: u32,\n    buffer: Vec<u8>,\n}\n${FENCE}`,
  apiBlock("MemCache", SIGS),
  "You may call the members of `MemCache` shown above. Do not invent others.",
].join("\n\n");

test("the rendered surface reorders only the signature lines inside the API-surface fence", () => {
  const out = orderSurfaceByRelevance(SURFACE, { targetText: TARGET, evidenceText: EVIDENCE });
  const outLines = out.split("\n");
  const inLines = SURFACE.split("\n");
  assert.strictEqual(outLines.length, inLines.length);
  // Everything outside the signature run is at the same index it was.
  const open = inLines.findIndex((l) => l.startsWith("API surface for")) + 1;
  const close = open + SIGS.length + 1;
  for (let i = 0; i < inLines.length; i++) {
    if (i > open && i < close) {
      continue;
    }
    assert.strictEqual(outLines[i], inLines[i], `line ${i} moved: ${inLines[i]}`);
  }
  const moved = outLines.slice(open + 1, close);
  assert.deepStrictEqual([...moved].sort(), [...SIGS].sort());
  assert.ok(moved.indexOf("pub fn buffer_size_total(&self) -> u64") < SIGS.indexOf("pub fn buffer_size_total(&self) -> u64"));
});

test("each API-surface block is ordered on its own, so a header never loses its signatures", () => {
  const other = ["pub fn open(path: &Path) -> Self", "pub fn buffer_size_total(&self) -> u64"];
  const two = [apiBlock("DiskGuard", other), apiBlock("MemCache", SIGS)].join("\n\n");
  const out = orderSurfaceByRelevance(two, { targetText: TARGET, evidenceText: EVIDENCE }).split("\n");
  const first = out.indexOf("API surface for `DiskGuard` (real signatures, use these exact names, do not invent):");
  const second = out.indexOf("API surface for `MemCache` (real signatures, use these exact names, do not invent):");
  assert.ok(first >= 0 && second > first);
  assert.deepStrictEqual(out.slice(first + 2, first + 2 + other.length).sort(), [...other].sort());
  assert.strictEqual(out.slice(second + 2, second + 2 + SIGS.length).length, SIGS.length);
});

test("a surface with no API-surface block comes back byte-identical", () => {
  const noApi =
    "Usage example for `MemCache` (from its docs, this compiles):\n" +
    `${FENCE}rust\nlet c = MemCache::new(8);\n${FENCE}\n\nYou may call the members of \`MemCache\` shown above.`;
  assert.strictEqual(orderSurfaceByRelevance(noApi, { targetText: TARGET, evidenceText: EVIDENCE }), noApi);
});

test("an unterminated or headerless fence is left exactly as it was", () => {
  const broken = `API surface for \`MemCache\` (real signatures, use these exact names, do not invent):\n${FENCE}\n${SIGS.join("\n")}`;
  assert.strictEqual(orderSurfaceByRelevance(broken, { targetText: TARGET, evidenceText: EVIDENCE }), broken);
  const noFence = `API surface for \`MemCache\` (real signatures, use these exact names, do not invent):\n${SIGS.join("\n")}`;
  assert.strictEqual(orderSurfaceByRelevance(noFence, { targetText: TARGET, evidenceText: EVIDENCE }), noFence);
});

test("a longer fence token, which fenceFor emits when a signature carries backticks, still matches", () => {
  const long = "````";
  const sigs = ["pub fn doc(&self) -> &str // ```rust", "pub fn buffer_size_total(&self) -> u64"];
  const block = `API surface for \`MemCache\` (real signatures, use these exact names, do not invent):\n${long}\n${sigs.join("\n")}\n${long}`;
  const out = orderSurfaceByRelevance(block, { targetText: TARGET, evidenceText: EVIDENCE }).split("\n");
  assert.strictEqual(out[1], long);
  assert.strictEqual(out[out.length - 1], long);
  assert.deepStrictEqual(out.slice(2, 4).sort(), [...sigs].sort());
});

test("the surface wrapper is total, pure and a permutation of its own lines", () => {
  for (const s of ["", "\n", FENCE, SURFACE, "API surface for `X` (real signatures, use these exact names, do not invent):"]) {
    const out = orderSurfaceByRelevance(s, { targetText: TARGET, evidenceText: EVIDENCE });
    assert.strictEqual(typeof out, "string");
    assert.deepStrictEqual([...out.split("\n")].sort(), [...s.split("\n")].sort());
  }
  assert.strictEqual(orderSurfaceByRelevance(SURFACE, { targetText: "" }), SURFACE);
});
