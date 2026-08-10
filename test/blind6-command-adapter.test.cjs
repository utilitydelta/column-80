// Blind oracle: RaCommandExtractor (the product adapter), headless. The
// product path reuses the user's already-running rust-analyzer through VS
// Code's command API and is not extension-host testable, so the surface makes
// the transport injectable: `new RaCommandExtractor(run)` where `run(command,
// cursor)` returns vscode-shaped results. This test injects a fake runner and
// proves the adapter maps those shapes into the same core types the LSP adapter
// would produce (transport-independence) and delegates rendering to the pure
// helpers.
//
// Frozen contract [surface: 'RaCommandExtractor' + 'Command adapter' export
// spec]. Bundled with the esbuild vscode-stub alias (impl*-vscode pattern) so
// the vscode-layer file resolves even if it references the vscode enum at
// runtime; the adapter never needs a real extension host.
//
// Encoded ambiguities (noted in the oracle report):
//  - hover result contents shape: the canonical vscode.Hover.contents is a
//    MarkdownString[], so the fake returns { contents: [{ value: markdown }] }.
//  - keyword-only: keyword completion items carry vscode CompletionItemKind
//    .Keyword (13); "keyword-only list yields []" requires the adapter to drop
//    them.
//
// Run: SKIP_LIVE=1 node --test test/blind6-command-adapter.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");

// Minimal vscode stub: enough of the enum and classes that a runtime reference
// in the adapter resolves. The adapter is driven by the injected `run`, so the
// command dispatch never touches these.
const STUB = path.join(__dirname, ".blind6-command-vscode-stub.cjs");
fs.writeFileSync(
  STUB,
  `
module.exports = {
  CompletionItemKind: {
    Text: 0, Method: 1, Function: 2, Constructor: 3, Field: 4, Variable: 5,
    Class: 6, Interface: 7, Module: 8, Property: 9, Unit: 10, Value: 11,
    Enum: 12, Keyword: 13, Snippet: 14, Color: 15, File: 16, Reference: 17,
    Folder: 18, EnumMember: 19, Constant: 20, Struct: 21, Event: 22,
    Operator: 23, TypeParameter: 24,
  },
  Uri: { parse: (s) => ({ toString: () => s }), file: (s) => ({ toString: () => "file://" + s }) },
  Position: class { constructor(line, character) { this.line = line; this.character = character; } },
  MarkdownString: class { constructor(value) { this.value = value; } },
  Hover: class { constructor(contents) { this.contents = contents; } },
  Location: class { constructor(uri, range) { this.uri = uri; this.range = range; } },
  commands: { executeCommand: async () => undefined },
  workspace: {},
};
`
);

const entry = path.join(__dirname, ".blind6-command.entry.ts");
const outfile = path.join(__dirname, ".blind6-command.bundle.cjs");
fs.writeFileSync(
  entry,
  `export { RaCommandExtractor } from "../src/vscode/raExtractor";
export { parseHover, renderMemberSignatures } from "../src/core/extraction";\n`
);
esbuild.buildSync({
  entryPoints: [entry],
  bundle: true,
  outfile,
  format: "cjs",
  platform: "node",
  alias: { vscode: STUB },
});
const { RaCommandExtractor, parseHover, renderMemberSignatures } = require(outfile);
test.after(() => {
  fs.rmSync(entry, { force: true });
  fs.rmSync(outfile, { force: true });
  fs.rmSync(STUB, { force: true });
});

// vscode CompletionItemKind values the surface pins for the adapter mapping.
const KIND = { Method: 1, Function: 2, Field: 4, Keyword: 13 };
const CURSOR = { uri: "file:///x/main.rs", line: 10, character: 4 };

// A fake runner: dispatch on the command string (the surface's product run
// closes over executeCommand and dispatches the three provider commands). We
// key on the provider substring so the exact "vscode." prefix is not load-
// bearing, but the dispatch is still driven by the command string.
const fakeRun = (responses) => async (command, _cursor) => {
  const c = String(command).toLowerCase();
  if (c.includes("completion")) return responses.completion;
  if (c.includes("hover")) return responses.hover;
  if (c.includes("definition")) return responses.definition;
  throw new Error(`unexpected command ${command}`);
};

// ---- completion mapping: fixture vscode CompletionItem[] -> CompletionMember[]

test("completeMembers maps vscode completion items to core members with identical name/viaTrait/signature/kind", async () => {
  // The trait-provenance row was `clone(as Clone)` / `fn(&self) -> Self` until
  // v27's blanket-impl drop, which removes exactly that member on purpose (RA
  // boosts clone at every member site, so it crowded out the real surface). The
  // row's subject is the label -> name/viaTrait split, and `fmt(as Debug)` tests
  // it identically without colliding with a deliberate drop. See
  // supersessions.md S8.
  const items = [
    { label: "insert", detail: "fn(&self, &T)", kind: KIND.Method },
    { label: "contains_hash", detail: "fn(&self, u64) -> bool", kind: KIND.Method },
    { label: "fmt(as Debug)", detail: "fn(&self, &mut Formatter) -> Result", kind: KIND.Method },
    { label: "seed", detail: "u64", kind: KIND.Field },
    { label: "forge", detail: "fn(u64) -> Widget", kind: KIND.Function },
  ];
  const extractor = new RaCommandExtractor(fakeRun({ completion: { items } }));
  const members = await extractor.completeMembers(CURSOR);

  const expected = [
    { name: "insert", kind: "method", viaTrait: undefined, signature: "insert(&self, &T)" },
    { name: "contains_hash", kind: "method", viaTrait: undefined, signature: "contains_hash(&self, u64) -> bool" },
    { name: "fmt", kind: "method", viaTrait: "Debug", signature: "fmt(&self, &mut Formatter) -> Result" },
    // v21 gave data members their own render (`seed: u64`, never call-shaped).
    // This row expected `undefined` from back when only callables carried a
    // signature, and the length assertion above was hiding it. supersessions.md S8.
    { name: "seed", kind: "field", viaTrait: undefined, signature: "seed: u64" },
    { name: "forge", kind: "function", viaTrait: undefined, signature: "forge(u64) -> Widget" },
  ];
  assert.strictEqual(members.length, expected.length, "every non-keyword item maps to one member");
  for (let i = 0; i < expected.length; i++) {
    const got = members[i];
    const want = expected[i];
    assert.strictEqual(got.name, want.name, `member ${i} name`);
    assert.strictEqual(got.kind, want.kind, `member ${i} kind (vscode enum ${JSON.stringify(KIND)} -> MemberKind)`);
    assert.strictEqual(got.viaTrait, want.viaTrait, `member ${i} viaTrait`);
    assert.strictEqual(got.signature, want.signature, `member ${i} signature`);
  }
});

test("completeMembers requests item resolution (resolveCount) so rust-analyzer fills in each member's detail/signature", async () => {
  // rust-analyzer defers `detail` (the fn signature) to completionItem/resolve;
  // a bare executeCompletionItemProvider returns items WITHOUT detail, so every
  // member renders to nothing and the member-list surface silently falls back to
  // an example (the live via=example non-convergence). completeMembers must pass
  // a positive resolveCount or the signatures path is dead.
  const calls = [];
  const capturingRun = async (command, cursor, opts) => {
    calls.push({ command: String(command).toLowerCase(), opts });
    return { items: [{ label: "tally_cohort", detail: "fn(&self, u32) -> usize", kind: KIND.Method }] };
  };
  const extractor = new RaCommandExtractor(capturingRun);
  const members = await extractor.completeMembers(CURSOR);
  assert.ok(members.length === 1 && members[0].signature, "the resolved member carries its signature");
  const completionCall = calls.find((c) => c.command.includes("completion"));
  assert.ok(completionCall, "completeMembers dispatched the completion command");
  assert.ok(
    completionCall.opts && typeof completionCall.opts.resolveCount === "number" && completionCall.opts.resolveCount > 0,
    "completeMembers must request item resolution (resolveCount > 0), else RA omits detail and the member list is empty",
  );
});

test("transport-independence: renderMemberSignatures over the adapter output matches the pure-helper payload", async () => {
  const items = [
    { label: "render", detail: "fn(&self) -> String", kind: KIND.Method },
    { label: "relabel", detail: "fn(&mut self, u64)", kind: KIND.Method },
    { label: "into(as Into)", detail: "fn(self) -> U", kind: KIND.Method },
  ];
  const extractor = new RaCommandExtractor(fakeRun({ completion: { items } }));
  const members = await extractor.completeMembers(CURSOR);
  // The universal Into member drops; the two inherent signatures render in order.
  assert.strictEqual(renderMemberSignatures(members), "render(&self) -> String\nrelabel(&mut self, u64)");
});

// ---- hover mapping: through parseHover [surface: 'delegates rendering to the pure helpers']

test("hoverSurface pulls the markdown out of the vscode Hover and delegates to parseHover", async () => {
  const md = [
    "```rust",
    "fastbloom::BloomFilter",
    "```",
    "",
    "```rust",
    "pub fn with_num_bits(num_bits: usize) -> BuilderWithBits",
    "```",
    "",
    "---",
    "",
    "Creates a builder instance.",
  ].join("\n");
  const extractor = new RaCommandExtractor(fakeRun({ hover: { contents: [{ value: md }] } }));
  const got = await extractor.hoverSurface(CURSOR);
  assert.deepStrictEqual(got, parseHover(md), "adapter hover equals the pure parse of the same markdown");
});

// ---- degrade signals: empty, keyword-only, and no-provider all stay quiet

test("completeMembers on an empty completion list yields []", async () => {
  const extractor = new RaCommandExtractor(fakeRun({ completion: { items: [] } }));
  assert.deepStrictEqual(await extractor.completeMembers(CURSOR), []);
});

test("completeMembers on a keyword-only completion list yields []", async () => {
  const items = [
    { label: "self", detail: undefined, kind: KIND.Keyword },
    { label: "super", detail: undefined, kind: KIND.Keyword },
    { label: "crate", detail: undefined, kind: KIND.Keyword },
  ];
  const extractor = new RaCommandExtractor(fakeRun({ completion: { items } }));
  assert.deepStrictEqual(await extractor.completeMembers(CURSOR), [], "keyword items are not API members");
});

test("no provider registered (runner resolves undefined) degrades to []/undefined and never throws", async () => {
  const extractor = new RaCommandExtractor(fakeRun({ completion: undefined, hover: undefined, definition: undefined }));
  assert.deepStrictEqual(await extractor.completeMembers(CURSOR), [], "absent completion provider -> []");
  assert.strictEqual(await extractor.hoverSurface(CURSOR), undefined, "absent hover provider -> undefined");
  assert.strictEqual(await extractor.definition(CURSOR), undefined, "absent definition provider -> undefined");
});
