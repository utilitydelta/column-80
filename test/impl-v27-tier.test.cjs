// impl-v27-tier: the server's own relevance tier on CompletionMember, the
// arm-D empty-partial block (tier-1 members dropped from the BLOCK, never the
// enforcement set), and the fn-gen reject-reason line.
//
// Evidence: session-v27/measure-ordering.md (arm D 79.5% top-1 vs control
// 75.0%, blanket-first 0 vs 2, on 44 real Rust member sites) and
// session-v27/capture-csharp-linq.md defect 2 (a reject with no why is a dark
// site).
//
// Bundled with the esbuild vscode-stub alias (blind6-command pattern) because
// the rust-analyzer tier stamp lives in the product transport
// (src/vscode/raExtractor.ts) and must be provable headless.
//
// Run: SKIP_LIVE=1 node --test test/impl-v27-tier.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");

// Minimal vscode stub: enough that raExtractor's module-level vscode references
// resolve. The adapter is driven by the injected `run`, never these.
const STUB = path.join(__dirname, ".impl-v27-tier-vscode-stub.cjs");
fs.writeFileSync(
  STUB,
  `
module.exports = {
  Uri: { parse: (s) => ({ toString: () => s }), from: (o) => ({ toString: () => JSON.stringify(o) }) },
  Position: class { constructor(line, character) { this.line = line; this.character = character; } },
  Range: class { constructor(start, end) { this.start = start; this.end = end; } },
  commands: { executeCommand: async () => undefined },
  workspace: { textDocuments: [] },
};
`,
);

const entry = path.join(__dirname, ".impl-v27-tier.entry.ts");
const outfile = path.join(__dirname, ".impl-v27-tier.bundle.cjs");
fs.writeFileSync(
  entry,
  `export { RaCommandExtractor } from "../src/vscode/raExtractor";
export { toPyCompletionMember } from "../src/core/pyExtraction";
export { toCsCompletionMember } from "../src/core/csExtraction";
export { renderFimCandidates } from "../src/core/fimInject";
export { FnGenService } from "../src/core/fnGenService";\n`,
);
esbuild.buildSync({
  entryPoints: [entry],
  bundle: true,
  outfile,
  format: "cjs",
  platform: "node",
  alias: { vscode: STUB },
});
const {
  RaCommandExtractor,
  toPyCompletionMember,
  toCsCompletionMember,
  renderFimCandidates,
  FnGenService,
} = require(outfile);
test.after(() => {
  fs.rmSync(entry, { force: true });
  fs.rmSync(outfile, { force: true });
  fs.rmSync(STUB, { force: true });
});

const CURSOR = { uri: "file:///x/main.rs", line: 10, character: 4 };
const KIND = { Method: 1, Field: 4 };

// ---------------------------------------------------------------------------
// rust-analyzer tier stamp: sortText FAMILY by leading hex digit, never exact
// values. The measurement's run-1 mispartition (exact-7fffffff) silently
// demoted type-matched own fields at 7fffffd9; the family digit is the rule.
// ---------------------------------------------------------------------------

test("raExtractor stamps tier from the sortText family, not exact values", async () => {
  const rows = [
    // [sortText, expected tier, why]
    ["7fffffff", 0, "the neutral own-member value"],
    ["7fffffd9", 0, "a type-matched boosted own field (run-1's silent demotion)"],
    ["80000000", 1, "the penalized family floor"],
    ["8000000b", 1, "the penalized family ceiling seen in the harvest"],
    [undefined, 0, "absent sortText reads as own"],
  ];
  const items = rows.map(([sortText], i) => ({
    label: `member_${i}`,
    detail: "fn(&self) -> u64",
    kind: KIND.Method,
    ...(sortText === undefined ? {} : { sortText }),
  }));
  const extractor = new RaCommandExtractor(async () => ({ items }));
  const members = await extractor.completeMembers(CURSOR);
  assert.strictEqual(members.length, rows.length, "every item maps to one member");
  for (let i = 0; i < rows.length; i++) {
    const [sortText, want, why] = rows[i];
    assert.strictEqual(
      members[i].tier,
      want,
      `sortText=${sortText}: expected tier ${want} (${why})`,
    );
  }
});

// ---------------------------------------------------------------------------
// Python tier stamp: dunders are the universal blanket tier. The vscode and
// LSP transports drop dunders before the builder today; the stamp is the
// classifier if one ever reaches the surface.
// ---------------------------------------------------------------------------

test("toPyCompletionMember stamps dunders tier 1 and leaves real members own", () => {
  const rows = [
    ["__eq__", 1],
    ["__init__", 1],
    ["_private", undefined], // single-underscore privates are real API
    ["__half", undefined], // half-dunder is not a dunder
    ["append", undefined],
  ];
  for (const [name, want] of rows) {
    const member = toPyCompletionMember(name, undefined, "method");
    assert.strictEqual(member.tier, want, `${name}: expected tier ${want}`);
  }
});

// ---------------------------------------------------------------------------
// C# tier stamp: the declaring type is authoritative when a signature exists
// (a developer's own ToString override stays own); the Object four-name
// fallback covers the unresolved tail, where Roslyn's alphabetical sortText
// says nothing (probe-proven useless).
// ---------------------------------------------------------------------------

test("toCsCompletionMember tiers object-declared members and the unresolved Object four", () => {
  const rows = [
    // [label, documentation, expected tier, why]
    ["Equals", "bool object.Equals(object? obj)", 1, "inherited object member"],
    ["GetType", "Type object.GetType()", 1, "inherited object member"],
    ["ToString", "string Stripe.ToString()", undefined, "the developer's own override"],
    ["Field", "(extension) TResult object.Field<TResult>(string name)", 1, "extension hung on object"],
    ["Equals", undefined, 1, "unresolved: the four-name fallback"],
    ["GetHashCode", undefined, 1, "unresolved: the four-name fallback"],
    ["AtlasId", undefined, undefined, "unresolved own property stays own"],
    ["AtlasId", "int Stripe.AtlasId { get; set; }", undefined, "resolved own property"],
  ];
  for (const [label, doc, want, why] of rows) {
    const member = toCsCompletionMember(label, doc, "method");
    assert.strictEqual(member.tier, want, `${label} (${why}): expected tier ${want}`);
  }
});

// ---------------------------------------------------------------------------
// Arm D at an empty partial: tier-1 members leave the BLOCK, never the
// enforcement set. Fixture mirrors the captured 21-member tuple-site surface
// (session-v26/capture-2026-07-26.md: RefMut<LogSegmentFileMetadata>, own
// fields log_id/read/write/file_len, blanket clone/to_owned/... leading the
// provider order).
// ---------------------------------------------------------------------------

const own = (name, signature) => ({ name, signature, kind: "method", tier: 0 });
const ownField = (name, signature) => ({ name, signature, kind: "field", tier: 0 });
const blanket = (name, signature) => ({ name, signature, kind: "method", tier: 1 });

// Provider raw order: blanket members first, exactly the captured hazard.
const tupleSiteMembers = [
  blanket("clone", "clone(&self) -> Self"),
  blanket("clone_from", "clone_from(&mut self, &Self)"),
  blanket("clone_into", "clone_into(&self, &mut <Self as ToOwned>::Owned)"),
  blanket("to_owned", "to_owned(&self) -> Self"),
  blanket("borrow", "borrow(&self) -> &Self"),
  blanket("borrow_mut", "borrow_mut(&mut self) -> &mut Self"),
  blanket("eq", "eq(&self, &Self) -> bool"),
  blanket("ne", "ne(&self, &Self) -> bool"),
  blanket("hash", "hash(&self, &mut H)"),
  ownField("log_id", "log_id: u64"),
  ownField("read", "read: u64"),
  ownField("write", "write: u64"),
  ownField("file_len", "file_len: u64"),
  own("advance_visible_position", "advance_visible_position(&mut self, u64)"),
  own("set_read_cursor", "set_read_cursor(&mut self, u64)"),
  own("set_write_cursor", "set_write_cursor(&mut self, u64)"),
  own("mark_dirty", "mark_dirty(&mut self)"),
  own("flush_len", "flush_len(&self) -> u64"),
  own("segment_path", "segment_path(&self) -> PathBuf"),
  own("is_sealed", "is_sealed(&self) -> bool"),
  own("seal", "seal(&mut self)"),
];

test("empty partial: the block carries only the own tier, clone-class names absent", () => {
  assert.strictEqual(tupleSiteMembers.length, 21, "the captured surface is 21 members");
  const block = renderFimCandidates(tupleSiteMembers, "");
  assert.ok(block !== undefined, "the own-only block renders");
  assert.match(block, /log_id: u64/, "own fields lead the surface");
  assert.match(block, /advance_visible_position/, "own methods render");
  for (const name of ["clone", "to_owned", "borrow", "eq(", "hash"]) {
    assert.ok(!block.includes(name), `blanket member ${name} must not be in the block`);
  }
  // The first signature line after the header is an own member, never blanket.
  const firstLine = block.split("\n")[1];
  assert.match(firstLine, /log_id/, "the block leads with the receiver's own surface");
});

test("empty partial: the enforcement set is untouched — all 21 names, every tier", () => {
  const before = tupleSiteMembers.map((m) => m.name);
  renderFimCandidates(tupleSiteMembers, "");
  const after = tupleSiteMembers.map((m) => m.name);
  assert.deepStrictEqual(after, before, "renderFimCandidates must not mutate the member set");
  assert.ok(after.includes("clone"), "clone stays a legal completion (the gate never narrows)");
  assert.strictEqual(after.length, 21);
});

test("non-empty partial: a human typing clo wants clone listed, all tiers render", () => {
  const block = renderFimCandidates(tupleSiteMembers, "clo");
  assert.ok(block !== undefined, "the narrowed block renders");
  assert.match(block, /clone\(&self\) -> Self/, "tier-1 clone renders under a typed partial");
  assert.match(block, /clone_from/, "the whole narrowed set renders");
  assert.ok(!block.includes("log_id"), "narrowing still applies");
});

test("empty partial with an all-blanket surface renders no block at all", () => {
  const allBlanket = tupleSiteMembers.filter((m) => m.tier === 1);
  assert.strictEqual(renderFimCandidates(allBlanket, ""), undefined);
});

test("unstamped members (no tier) render as today — the field is additive", () => {
  const unstamped = tupleSiteMembers.map(({ name, signature, kind }) => ({ name, signature, kind }));
  const block = renderFimCandidates(unstamped, "");
  assert.ok(block !== undefined);
  assert.match(block, /clone\(&self\) -> Self/, "no tier evidence means nothing is dropped");
});

// ---------------------------------------------------------------------------
// fn-gen reject reason: outcome=reject says which check refused and the first
// line of what the model offered (capture-csharp-linq.md defect 2: a reject
// without a why is a dark site).
// ---------------------------------------------------------------------------

const SERVICE_CONFIG = {
  apiBase: "http://127.0.0.1:11434",
  model: "qwen2.5-coder:7b-instruct",
  keepAlive: "30m",
  maxPromptBytes: 8192,
  timeoutMs: 1000,
};

test("outcome=reject carries the refusing check and the offered first line", () => {
  const lines = [];
  const service = new FnGenService(SERVICE_CONFIG, async () => ({ text: "", ttftMs: 0, totalMs: 0 }), (l) =>
    lines.push(l),
  );
  service.logOutcome("reject", {
    refusedBy: "human-gesture",
    offered: "\n  return tiles.Where(t => t.Band == LodBand.Regional).Count();\nrest",
  });
  assert.deepStrictEqual(lines, [
    "[fngen] outcome=reject refused-by=human-gesture offered=return tiles.Where(t => t.Band == LodBand.Regional).Count();",
  ]);
});

test("outcome=accept and outcome=discarded keep their existing one-word lines", () => {
  const lines = [];
  const service = new FnGenService(SERVICE_CONFIG, async () => ({ text: "", ttftMs: 0, totalMs: 0 }), (l) =>
    lines.push(l),
  );
  service.logOutcome("accept");
  service.logOutcome("discarded");
  assert.deepStrictEqual(lines, ["[fngen] outcome=accept", "[fngen] outcome=discarded"]);
});
