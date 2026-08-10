// Implementer oracle for Phase 5 (example() selection hygiene): the pure
// rankExampleCandidates tiers and the RaCommandExtractor.exampleAt wiring that
// maps vscode completion items into the candidate shape. impl* files may know
// internals; they are the implementer's own oracles, not the frozen contract.
// Headless, no rust-analyzer.
//
// Run: SKIP_LIVE=1 node --test test/impl-v3-example.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");
const { bundleCore } = require("./.blind-util.cjs");

// ---- Core: rankExampleCandidates tiers ----

const { mod: core, cleanup: cleanCore } = bundleCore(
  "impl-v3-example-core",
  `export { rankExampleCandidates } from "../src/core/extraction";\n`
);
const { rankExampleCandidates } = core;
const order = (result) => result.map((c) => c.name);

// The name denylist vs the viaTrait signal. Two rules: (1) a noise blanket trait
// (Clone/ToOwned/Borrow/Into/...) is dropped by provenance; (2) an unambiguous std
// method name is dropped when provenance is absent. Construction traits
// (From/TryFrom/Default) are NOT noise - they are legitimate construction paths and
// are KEPT. `from`/`from_vec` names are never denylisted (crate constructors).
for (const { name, viaTrait, dropped } of [
  { name: "clone", viaTrait: undefined, dropped: true }, // std name, no provenance
  { name: "to_owned", viaTrait: undefined, dropped: true },
  { name: "clone_into", viaTrait: undefined, dropped: true },
  { name: "extend", viaTrait: undefined, dropped: true },
  { name: "borrow", viaTrait: undefined, dropped: true },
  { name: "borrow_mut", viaTrait: undefined, dropped: true },
  { name: "clone", viaTrait: "Clone", dropped: true }, // noise trait -> dropped by provenance
  { name: "into", viaTrait: "Into", dropped: true }, // conversion away, not construction
  { name: "from", viaTrait: "From", dropped: false }, // construction trait -> KEPT
  { name: "try_from", viaTrait: "TryFrom", dropped: false }, // construction trait -> KEPT
  { name: "default", viaTrait: "Default", dropped: false }, // construction trait -> KEPT
  { name: "from_vec", viaTrait: undefined, dropped: false }, // crate constructor -> kept
  { name: "from_config", viaTrait: undefined, dropped: false }, // crate constructor -> kept
  { name: "with_num_bits", viaTrait: undefined, dropped: false },
  { name: "contains", viaTrait: undefined, dropped: false },
]) {
  test(`filter: ${name}${viaTrait ? ` (as ${viaTrait})` : ""} is ${dropped ? "dropped" : "kept"}`, () => {
    const kept = order(rankExampleCandidates([{ name, viaTrait }], "zzz_no_match"));
    assert.strictEqual(kept.includes(name), !dropped, `${name} present?`);
  });
}

// LOW-MEDIUM-1: From/Default/TryFrom impls are construction, not noise, and get
// the constructor tier - a `From` conversion beats a plain method's example.
test("construction-trait impls are kept and ranked as constructors", () => {
  const cands = [
    { name: "poke" }, // plain method
    { name: "from", viaTrait: "From" }, // From conversion -> from-ctor tier
    { name: "default", viaTrait: "Default" }, // Default -> builder tier
  ];
  // default (builder tier 0) then from (from tier 1) then poke (method tier 2).
  assert.deepStrictEqual(order(rankExampleCandidates(cands, "hallucinated")), ["default", "from", "poke"]);
});

// LOW-2: the compiler naming a member (prefer) overrides the std-name denylist -
// an E0599 on an inherent `extend` must keep `extend` as a candidate.
test("a candidate whose name equals prefer is never filtered by the std denylist", () => {
  const cands = [{ name: "extend" }, { name: "with_num_bits" }];
  const ranked = order(rankExampleCandidates(cands, "extend"));
  assert.strictEqual(ranked[0], "extend", "the compiler-named member is rescued and wins the prefer tier");
});

test("constructor tiers: builder > from-constructor > plain method (prefer matches nothing)", () => {
  const cands = [
    { name: "contains" }, // plain method  -> tier 2
    { name: "from_vec" }, // from-ctor      -> tier 1
    { name: "with_num_bits" }, // builder   -> tier 0
    { name: "insert" }, // plain method     -> tier 2
    { name: "new" }, // builder             -> tier 0
  ];
  const ranked = order(rankExampleCandidates(cands, "hallucinated"));
  // Both builders first (input order among ties), then from_vec, then methods.
  assert.deepStrictEqual(ranked, ["with_num_bits", "new", "from_vec", "contains", "insert"]);
});

test("Constructor completion kind is a builder tier even without a builder name", () => {
  const cands = [
    { name: "make", isConstructor: true }, // Constructor kind -> tier 0
    { name: "from_bytes" }, // from-ctor            -> tier 1
    { name: "poke" }, // plain method               -> tier 2
  ];
  assert.deepStrictEqual(order(rankExampleCandidates(cands, "x")), ["make", "from_bytes", "poke"]);
});

test("prefer tiers: exact > prefix > substring > none, above the constructor tier", () => {
  const cands = [
    { name: "with_num_bits" }, // builder, but no prefer match
    { name: "insert_hash" }, // prefix match on "insert"
    { name: "insert" }, // exact match
    { name: "reinsert" }, // substring match
  ];
  // Exact prefer wins even though it is a plain method and a builder is present.
  assert.deepStrictEqual(
    order(rankExampleCandidates(cands, "insert")),
    ["insert", "insert_hash", "reinsert", "with_num_bits"],
  );
});

test("the constructor regex anchors at the start: `renew`/`transform` are not builders", () => {
  // A method whose name merely contains new/with is a plain method, not a ctor.
  const cands = [{ name: "renew" }, { name: "transform" }, { name: "new_pool" }];
  // new_pool is the only builder-shaped name (starts with `new`).
  assert.strictEqual(order(rankExampleCandidates(cands, "zzz"))[0], "new_pool");
});

test.after(cleanCore);

// ---- Product adapter: exampleAt wiring over the fastbloom candidate set ----

const STUB = path.join(__dirname, ".impl-v3-example-vscode-stub.cjs");
fs.writeFileSync(
  STUB,
  `module.exports = {
    CompletionItemKind: { Method: 1, Function: 2, Constructor: 3, Field: 4 },
    Uri: { parse: (s) => ({ toString: () => s }) },
    Position: class { constructor(l, c) { this.line = l; this.character = c; } },
    commands: { executeCommand: async () => undefined },
  };\n`
);
const entry = path.join(__dirname, ".impl-v3-example.entry.ts");
const outfile = path.join(__dirname, ".impl-v3-example.bundle.cjs");
fs.writeFileSync(entry, `export { RaCommandExtractor } from "../src/vscode/raExtractor";\n`);
esbuild.buildSync({ entryPoints: [entry], bundle: true, outfile, format: "cjs", platform: "node", alias: { vscode: STUB } });
const { RaCommandExtractor } = require(outfile);
test.after(() => {
  fs.rmSync(entry, { force: true });
  fs.rmSync(outfile, { force: true });
  fs.rmSync(STUB, { force: true });
});

const CURSOR = { uri: "file:///x/main.rs", line: 3, character: 8 };
const examplesDoc = (code) => ({ value: ["# Examples", "", "```rust", code, "```"].join("\n") });

// The host-check ground truth: RA resolved these docs through the command API.
// clone is the std trait example that wrongly won before Phase 5.
const CLONE_EXAMPLE = `let hello = "Hello"; assert_eq!("Hello", hello.clone());`;
const WITH_NUM_BITS_EXAMPLE = `let filter = BloomFilter::with_num_bits(1024).hashes(4);`;
const FASTBLOOM_ITEMS = [
  { kind: 1, label: "clone (as Clone)", documentation: examplesDoc(CLONE_EXAMPLE) },
  { kind: 2, label: "contains", documentation: examplesDoc("filter.contains(&4);") },
  { kind: 2, label: "from_vec", documentation: examplesDoc("let f = BloomFilter::from_vec(&v);") },
  { kind: 2, label: "with_num_bits", documentation: examplesDoc(WITH_NUM_BITS_EXAMPLE) },
  { kind: 2, label: "with_false_pos", documentation: examplesDoc("BloomFilter::with_false_pos(0.001).expected_items(1000);") },
];

// A runner that returns the given completion items for the completion command.
const itemsRunner = (items) => async (command, _cursor, opts) => {
  if (String(command).toLowerCase().includes("completion")) {
    assert.strictEqual(opts?.resolveCount, 12, "example resolve cap is passed through");
    return items;
  }
  return undefined;
};

test("exampleAt: E0599 hallucinated prefer selects the builder example, never clone", async () => {
  const extractor = new RaCommandExtractor(itemsRunner(FASTBLOOM_ITEMS));
  // `new_for` is the hallucinated associated function the compiler named.
  const example = await extractor.example(CURSOR, "new_for");
  assert.strictEqual(example, WITH_NUM_BITS_EXAMPLE, "the builder constructor example is injected");
  assert.ok(!example.includes("hello.clone"), "clone's std example is never injected");
});

test("exampleAt: only std-trait candidates -> undefined (no example, fall through)", async () => {
  const stdOnly = [
    { kind: 1, label: "clone (as Clone)", documentation: examplesDoc(CLONE_EXAMPLE) },
    { kind: 1, label: "to_owned (as ToOwned)", documentation: examplesDoc(`let s = x.to_owned();`) },
  ];
  const extractor = new RaCommandExtractor(itemsRunner(stdOnly));
  // No readText injected, so the past-`::` re-target is skipped: undefined stands.
  assert.strictEqual(await extractor.example(CURSOR, "new_for"), undefined);
});

test("exampleAt: no prefer still avoids clone and reaches the builder", async () => {
  // The host-check probe called example() with no prefer and got clone; Phase 5
  // must reach a constructor even with prefer absent.
  const extractor = new RaCommandExtractor(itemsRunner(FASTBLOOM_ITEMS));
  assert.strictEqual(await extractor.example(CURSOR), WITH_NUM_BITS_EXAMPLE);
});

// ---- LSP transport (RaLspExtractor) parity [HIGH-1] ----
// The headless-LSP oracle transport that blind7-loop-live drives. It now ranks
// through the SAME pure rankExampleCandidates as RaCommandExtractor. Proven by
// driving exampleAt over the fastbloom candidate set with the RA process stubbed
// (private constructor + private completionRequest/request shadowed at runtime).

const { mod: lsp, cleanup: cleanLsp } = bundleCore(
  "impl-v3-example-lsp",
  `export { RaLspExtractor } from "../src/core/raLspClient";\n`
);
const { RaLspExtractor } = lsp;
test.after(cleanLsp);

// LSP wire CompletionItemKind: Method=2, Function=3, Constructor=4, Field=5.
const lspFastbloom = [
  { kind: 2, label: "clone (as Clone)", documentation: examplesDoc(CLONE_EXAMPLE) },
  { kind: 3, label: "contains", documentation: examplesDoc("filter.contains(&4);") },
  { kind: 3, label: "from_vec", documentation: examplesDoc("let f = BloomFilter::from_vec(&v);") },
  { kind: 3, label: "with_num_bits", documentation: examplesDoc(WITH_NUM_BITS_EXAMPLE) },
];

// A fake child process the private constructor can attach its listeners to.
const fakeProc = () => ({ stdout: { on() {} }, stderr: { on() {} }, on() {} });

// Build an RaLspExtractor with the RA transport stubbed: completionRequest yields
// the fixed items, completionItem/resolve echoes the item (docs already present).
const lspExtractorOver = (items) => {
  const ex = new RaLspExtractor(fakeProc());
  ex.completionRequest = async () => items;
  ex.request = async (_method, item) => item;
  return ex;
};

test("RaLspExtractor.example: no prefer selects the builder, not clone (blind7-loop shape)", async () => {
  // This is the exact call blind7-loop-live makes: example(cursor) with no prefer.
  const example = await lspExtractorOver(lspFastbloom).example(CURSOR);
  assert.strictEqual(example, WITH_NUM_BITS_EXAMPLE, "the LSP transport reaches the builder");
  assert.ok(!example.includes("hello.clone"), "clone's std example is never injected");
});

test("RaLspExtractor.example: E0599 hallucinated prefer still selects the builder", async () => {
  const example = await lspExtractorOver(lspFastbloom).example(CURSOR, "new_for");
  assert.strictEqual(example, WITH_NUM_BITS_EXAMPLE);
});

test("RaLspExtractor.example: only std-trait candidates -> undefined", async () => {
  const stdOnly = [
    { kind: 2, label: "clone (as Clone)", documentation: examplesDoc(CLONE_EXAMPLE) },
    { kind: 2, label: "to_owned (as ToOwned)", documentation: examplesDoc(`let s = x.to_owned();`) },
  ];
  assert.strictEqual(await lspExtractorOver(stdOnly).example(CURSOR), undefined);
});
