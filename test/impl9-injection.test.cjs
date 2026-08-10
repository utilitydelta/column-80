// Implementer oracle for the slice-2b product glue in oracleSurface.ts: the
// functions that turn a diagnostic into an injected surface or an in-span
// qualify edit. Headless, bundled against a minimal vscode stub (the glue only
// touches Position/Range + a document's offset math). Proves the wiring selects
// example-else-signatures, calls the extractor with the compiler-named type as
// the preference, keeps a qualify edit inside the function span, and refuses one
// that would reach outside it (invariant 2).
//
// Run: SKIP_LIVE=1 node --test test/impl9-injection.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");

const STUB = path.join(__dirname, ".impl9-vscode-stub.cjs");
fs.writeFileSync(
  STUB,
  `class Position { constructor(line, character) { this.line = line; this.character = character; } }
class Range { constructor(a, b) { this.start = a; this.end = b; } }
module.exports = { Position, Range, languages: {}, window: {}, workspace: {}, ThemeColor: class {}, MarkdownString: class {} };\n`
);
const entry = path.join(__dirname, ".impl9.entry.ts");
const outfile = path.join(__dirname, ".impl9.bundle.cjs");
fs.writeFileSync(
  entry,
  `export { resolveSurfaceInjection, firstQualifiable, applyQualifyToFunction, documentMissingCrates, isNoOpRepair } from "../src/vscode/oracleSurface";\n`
);
esbuild.buildSync({ entryPoints: [entry], bundle: true, outfile, format: "cjs", platform: "node", alias: { vscode: STUB } });
const { resolveSurfaceInjection, firstQualifiable, applyQualifyToFunction, documentMissingCrates, isNoOpRepair } = require(outfile);
test.after(() => [STUB, entry, outfile].forEach((f) => fs.rmSync(f, { force: true })));

// A document over a text string with the offset math the glue uses.
function makeDoc(text, uriStr) {
  const lines = text.split("\n");
  const offsetAt = (pos) => {
    let o = 0;
    for (let i = 0; i < pos.line; i++) o += lines[i].length + 1;
    return o + pos.character;
  };
  const positionAt = (off) => {
    let o = 0;
    for (let l = 0; l < lines.length; l++) {
      if (off <= o + lines[l].length) return { line: l, character: off - o };
      o += lines[l].length + 1;
    }
    return { line: lines.length - 1, character: 0 };
  };
  return { uri: { toString: () => uriStr }, offsetAt, positionAt, getText: (r) => text.slice(offsetAt(r.start), offsetAt(r.end)) };
}

const diag = (code, message, span) => ({
  kind: "compile-error", level: "error", code, message,
  spans: [{ fileName: "src/main.rs", byteStart: 0, byteEnd: 0, lineStart: span.line + 1, lineEnd: span.line + 1, columnStart: span.character + 1, columnEnd: span.character + 3, isPrimary: true }],
  suggestions: [],
});

// ---- resolveSurfaceInjection: v6 item 1 per-class surface shape. A wrong
// CONSTRUCTOR (unresolved-assoc) prefers the worked example; a wrong METHOD NAME
// (unresolved-method) prefers the member LIST (signatures). Extractor called right.

test("surface injection prefers the example for a wrong constructor (unresolved-assoc) and passes the named type as the preference", async () => {
  const calls = [];
  const extractor = {
    example: async (cursor, prefer) => { calls.push({ cursor, prefer }); return "let f = fastbloom::BloomFilter::with_num_bits(1024);"; },
    completeMembers: async () => { throw new Error("should not be reached when an example exists for a constructor miss"); },
  };
  const doc = makeDoc("fn f() {}", "file:///x/main.rs");
  const out = await resolveSurfaceInjection(extractor, doc, [
    diag("E0599", "no associated function or constant named `new` found for struct `BloomFilter<S>` in the current scope", { line: 2, character: 4 }),
  ], () => {});
  assert.ok(out.includes("with_num_bits"), "the example is the payload for a constructor miss");
  assert.match(out, /Call ONLY methods and constructors/, "the firm instruction rides it");
  assert.strictEqual(calls.length, 1);
  assert.deepStrictEqual(calls[0].cursor, { uri: "file:///x/main.rs", line: 2, character: 4 }, "cursor from the diagnostic span");
  assert.strictEqual(calls[0].prefer, "BloomFilter<S>", "the named type biases example selection");
});

test("surface injection injects the member LIST for a wrong method name (unresolved-method), never a usage example", async () => {
  const exampleCalls = [];
  const extractor = {
    // an example IS available - but a method-name miss must not use it: the member
    // list guarantees the real method is present as an explicit signature.
    example: async () => { exampleCalls.push(1); return "let f = fastbloom::BloomFilter::with_num_bits(1024);"; },
    completeMembers: async () => [{ name: "expected_items", signature: "expected_items(self, usize) -> BloomFilter", kind: "method" }],
  };
  const out = await resolveSurfaceInjection(extractor, makeDoc("fn f(){}", "file:///x"), [
    diag("E0599", "no method named `add` found for struct `BloomFilter<S>` in the current scope", { line: 0, character: 0 }),
  ], () => {});
  assert.ok(out.includes("expected_items(self, usize) -> BloomFilter"), "the member list is the payload for a method-name miss");
  assert.match(out, /API surface for/, "the signatures form, not a usage example");
  assert.ok(!out.includes("Usage example"), "a wrong method name does NOT get a usage example");
  assert.strictEqual(exampleCalls.length, 0, "the example is not resolved when the member list is available");
});

test("surface injection falls back to the example for a method miss when no members resolve", async () => {
  const extractor = {
    example: async () => "let w = Widget::new();",
    completeMembers: async () => [],
  };
  const out = await resolveSurfaceInjection(extractor, makeDoc("fn f(){}", "file:///x"), [
    diag("E0599", "no method named `x` found for struct `Widget` in the current scope", { line: 0, character: 0 }),
  ], () => {});
  assert.ok(out.includes("Widget::new()"), "a method miss with no resolvable members falls back to the example");
});

// review-item1 finding (A): members present but ALL render to no signatures (no
// `signature` field / universal-trait noise) => renderMemberSignatures returns "",
// which is falsy, so the method branch must still fall back to the example rather
// than inject a degenerate empty surface. This exercises the falsy-fallback path
// the empty-array test does not.
test("surface injection falls back to the example for a method miss when members render to no signatures", async () => {
  const extractor = {
    example: async () => "let w = Widget::new();",
    completeMembers: async () => [{ name: "into", kind: "method" }],
  };
  const out = await resolveSurfaceInjection(extractor, makeDoc("fn f(){}", "file:///x"), [
    diag("E0599", "no method named `x` found for struct `Widget` in the current scope", { line: 0, character: 0 }),
  ], () => {});
  assert.ok(out.includes("Widget::new()"), "members that render to no signatures fall back to the example, not an empty surface");
  assert.ok(!out.includes("API surface for"), "no degenerate empty signatures payload is injected");
});

test("surface injection returns the installed-crate catalog for an unresolved-crate class (slice 4)", async () => {
  const extractor = { example: async () => { throw new Error("not for a crate class"); }, completeMembers: async () => { throw new Error("not for a crate class"); } };
  const out = await resolveSurfaceInjection(
    extractor,
    makeDoc("fn f(){}", "file:///x"),
    [diag("E0433", "cannot find module or crate `aws_sdk_s3` in this scope", { line: 0, character: 0 })],
    () => {},
    "CATALOG_BLOCK_SENTINEL",
  );
  assert.strictEqual(out, "CATALOG_BLOCK_SENTINEL", "the catalog is the payload for a missing crate");
});

test("surface injection skips the unresolved-crate class when no catalog is available", async () => {
  const extractor = { example: async () => undefined, completeMembers: async () => [] };
  const out = await resolveSurfaceInjection(extractor, makeDoc("fn f(){}", "file:///x"), [
    diag("E0433", "cannot find module or crate `aws_sdk_s3` in this scope", { line: 0, character: 0 }),
  ], () => {});
  assert.strictEqual(out, undefined);
});

// ---- documentMissingCrates: a missing crate anywhere in the accepted file is
// caught (independent of the function span), a wrong item in a present crate is
// not a missing crate, and an error in ANOTHER file is not blamed here.

const spanFor = (fileName, line) => ({ fileName, byteStart: 0, byteEnd: 0, lineStart: line, lineEnd: line, columnStart: 1, columnEnd: 3, isPrimary: true });
const fileDiag = (code, message, fileName) => ({ kind: "compile-error", level: "error", code, message, spans: [spanFor(fileName, 2)], suggestions: [] });

test("documentMissingCrates catches a single-segment E0432 in the accepted file", () => {
  const errs = [fileDiag("E0432", "unresolved import `fastbloom`", "src/main.rs")];
  assert.deepStrictEqual(documentMissingCrates(errs, "/w/src/main.rs", "/w"), ["fastbloom"]);
});

test("documentMissingCrates ignores a wrong-item (crate present) and a plain error", () => {
  const errs = [
    fileDiag("E0432", "unresolved import `fastbloom::Bloom`", "src/main.rs"),
    fileDiag("E0308", "mismatched types", "src/main.rs"),
  ];
  assert.deepStrictEqual(documentMissingCrates(errs, "/w/src/main.rs", "/w"), []);
});

test("documentMissingCrates does not blame a missing crate in ANOTHER file", () => {
  const errs = [fileDiag("E0432", "unresolved import `tokio`", "src/other.rs")];
  assert.deepStrictEqual(documentMissingCrates(errs, "/w/src/main.rs", "/w"), []);
});

// ---- isNoOpRepair: a whitespace-only "fix" is not a fix.

test("isNoOpRepair is true when the repair only reshuffles whitespace (the blank-line surprise)", () => {
  const current = "fn f() {\n    let x = 1;\n    x\n}";
  const blankLineAdded = "fn f() {\n\n    let x = 1;\n    x\n}"; // model re-emitted with a blank line
  const reindented = "fn f() {\n  let x = 1;\n  x\n}";
  assert.strictEqual(isNoOpRepair(current, blankLineAdded), true, "an added blank line is no change");
  assert.strictEqual(isNoOpRepair(current, reindented), true, "re-indentation is no change");
  assert.strictEqual(isNoOpRepair(current, current), true);
});

test("isNoOpRepair is false when the repair changes a real token", () => {
  const current = "fn f() {\n    let x = 1;\n    x\n}";
  const fixed = "fn f() {\n    let x = 2;\n    x\n}";
  assert.strictEqual(isNoOpRepair(current, fixed), false, "a changed literal is a real change");
});

// ---- firstQualifiable + applyQualifyToFunction: in-span discipline.

const SRC = "fn demo() -> bool {\n    let f = BloomFilter::with_num_bits(1024);\n    f.contains(&\"x\")\n}\n";
// The function span covers the whole `fn demo ... }` (offsets into SRC).
const SPAN = { start: 0, end: SRC.indexOf("}") + 1 };

test("firstQualifiable picks a `cannot find type` error whose span is inside the function", () => {
  const doc = makeDoc(SRC, "file:///x");
  // `BloomFilter` starts at line 1, character 12.
  const cursor = firstQualifiable([diag("E0433", "cannot find type `BloomFilter` in this scope", { line: 1, character: 12 })], doc, SPAN);
  assert.deepStrictEqual(cursor, { line: 1, character: 12 });
});

test("firstQualifiable ignores an error outside the function span", () => {
  const doc = makeDoc(SRC, "file:///x");
  const outsideSpan = { start: SRC.indexOf("}") + 1, end: SRC.length };
  assert.strictEqual(firstQualifiable([diag("E0433", "cannot find type `BloomFilter` in this scope", { line: 1, character: 12 })], doc, outsideSpan), undefined);
});

test("applyQualifyToFunction rewrites the name in place, staying inside the span", () => {
  const doc = makeDoc(SRC, "file:///x");
  const start = { line: 1, character: 12 };
  const edit = { range: { startLine: 1, startCharacter: 12, endLine: 1, endCharacter: 23 }, newText: "fastbloom::BloomFilter" };
  const out = applyQualifyToFunction(doc, SPAN, edit);
  assert.match(out, /fastbloom::BloomFilter::with_num_bits/, "qualified in place");
  assert.ok(out.startsWith("fn demo()"), "still the whole function");
  void start;
});

test("applyQualifyToFunction refuses an edit that reaches outside the function span (invariant 2)", () => {
  const doc = makeDoc(SRC, "file:///x");
  // An edit whose end is past the function's closing brace must be rejected.
  const edit = { range: { startLine: 3, startCharacter: 0, endLine: 4, endCharacter: 0 }, newText: "X" };
  assert.strictEqual(applyQualifyToFunction(doc, { start: 0, end: 10 }, edit), undefined);
});
