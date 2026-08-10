// Implementer oracle for slice 1: covers what the frozen blind set leaves
// unverified - the definition() success-path mapping (Location vs LocationLink,
// 0-based range, uri.toString) and the function-pointer-field guard in
// toCompletionMember. The adversarial review flagged both: definition ships in
// the interface with only its undefined-degrade case tested, and a field whose
// type is a function pointer must not render as a callable method.
//
// impl* files may know internals; they are the implementer's own oracles, not
// the frozen contract. Headless, no rust-analyzer.
//
// Run: SKIP_LIVE=1 node --test test/impl6-extraction.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");
const { bundleCore } = require("./.blind-util.cjs");

// ---- Core: toCompletionMember signature guard [review M1] ----

const { mod: core, cleanup: cleanCore } = bundleCore(
  "impl6-core",
  `export { toCompletionMember, renderMemberSignatures } from "../src/core/extraction";\n`
);
const { toCompletionMember, renderMemberSignatures } = core;

for (const { name, label, detail, kind, expectedSig } of [
  { name: "a method with an fn detail renders its signature", label: "contains", detail: "fn(&self, &T) -> bool", kind: "method", expectedSig: "contains(&self, &T) -> bool" },
  { name: "a free function renders its signature", label: "forge", detail: "fn(u64) -> Widget", kind: "function", expectedSig: "forge(u64) -> Widget" },
  { name: "a function-pointer FIELD renders as DATA, never as a callable method", label: "on_tick", detail: "fn(u64) -> bool", kind: "field", expectedSig: "on_tick: fn(u64) -> bool" },
  { name: "a plain data field renders its name and the type the server gave it", label: "seed", detail: "u64", kind: "field", expectedSig: "seed: u64" },
  { name: "a field whose server gave no type has no signature", label: "seed", detail: undefined, kind: "field", expectedSig: undefined },
  { name: "an other-kind member with fn detail is not rendered as callable", label: "thing", detail: "fn()", kind: "other", expectedSig: undefined },
]) {
  test(`toCompletionMember: ${name}`, () => {
    const m = toCompletionMember(label, detail, kind);
    assert.strictEqual(m.signature, expectedSig, `signature for ${label} (${kind})`);
    assert.strictEqual(m.kind, kind, "kind is preserved verbatim");
  });
}

test("toCompletionMember carries trait provenance and drops it from the name", () => {
  const m = toCompletionMember("clone(as Clone)", "fn(&self) -> Self", "method");
  assert.strictEqual(m.name, "clone");
  assert.strictEqual(m.viaTrait, "Clone");
  assert.strictEqual(m.signature, "clone(&self) -> Self");
});

test("a function-pointer field reaches the rendered payload as data, never as a call", () => {
  const members = [
    toCompletionMember("render", "fn(&self) -> String", "method"),
    toCompletionMember("on_tick", "fn(u64) -> bool", "field"),
  ];
  // on_tick is data: it renders, and it renders as `name: Type` so no reader can
  // take it for a method the receiver can be called through.
  assert.strictEqual(renderMemberSignatures(members), "render(&self) -> String\non_tick: fn(u64) -> bool");
});

test.after(cleanCore);

// ---- Product adapter: definition() success-path mapping [review M3] ----

const STUB = path.join(__dirname, ".impl6-vscode-stub.cjs");
fs.writeFileSync(
  STUB,
  `module.exports = {
    CompletionItemKind: { Method: 1, Function: 2, Field: 4, Keyword: 13 },
    Uri: { parse: (s) => ({ toString: () => s }) },
    Position: class { constructor(l, c) { this.line = l; this.character = c; } },
    commands: { executeCommand: async () => undefined },
  };\n`
);
const entry = path.join(__dirname, ".impl6-adapter.entry.ts");
const outfile = path.join(__dirname, ".impl6-adapter.bundle.cjs");
fs.writeFileSync(entry, `export { RaCommandExtractor } from "../src/vscode/raExtractor";\n`);
esbuild.buildSync({ entryPoints: [entry], bundle: true, outfile, format: "cjs", platform: "node", alias: { vscode: STUB } });
const { RaCommandExtractor } = require(outfile);
test.after(() => {
  fs.rmSync(entry, { force: true });
  fs.rmSync(outfile, { force: true });
  fs.rmSync(STUB, { force: true });
});

const CURSOR = { uri: "file:///x/main.rs", line: 3, character: 8 };
// A vscode Uri stringifies to its file:// form; a Range is {start,end} positions.
const uriOf = (s) => ({ toString: () => s });
const range = (sl, sc, el, ec) => ({ start: { line: sl, character: sc }, end: { line: el, character: ec } });
const defRunner = (result) => async (command) => {
  if (String(command).toLowerCase().includes("definition")) return result;
  return undefined;
};

test("definition maps a plain vscode Location to a DefinitionLocation with 0-based range", async () => {
  const loc = { uri: uriOf("file:///dep/src/lib.rs"), range: range(41, 4, 41, 17) };
  const extractor = new RaCommandExtractor(defRunner([loc]));
  assert.deepStrictEqual(await extractor.definition(CURSOR), {
    uri: "file:///dep/src/lib.rs",
    range: { startLine: 41, startCharacter: 4, endLine: 41, endCharacter: 17 },
  });
});

test("definition maps a LocationLink (targetUri/targetRange) the same way", async () => {
  const link = { targetUri: uriOf("file:///dep/src/lib.rs"), targetRange: range(10, 0, 12, 1) };
  const extractor = new RaCommandExtractor(defRunner([link]));
  assert.deepStrictEqual(await extractor.definition(CURSOR), {
    uri: "file:///dep/src/lib.rs",
    range: { startLine: 10, startCharacter: 0, endLine: 12, endCharacter: 1 },
  });
});

test("definition takes the first location when several are returned", async () => {
  const first = { uri: uriOf("file:///a.rs"), range: range(1, 0, 1, 5) };
  const second = { uri: uriOf("file:///b.rs"), range: range(2, 0, 2, 5) };
  const extractor = new RaCommandExtractor(defRunner([first, second]));
  assert.strictEqual((await extractor.definition(CURSOR)).uri, "file:///a.rs");
});

test("definition on an empty result degrades to undefined", async () => {
  const extractor = new RaCommandExtractor(defRunner([]));
  assert.strictEqual(await extractor.definition(CURSOR), undefined);
});
