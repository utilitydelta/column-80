// IMPLEMENTER wiring proof for session-v30 phase 2: the repair surface's
// per-language dispatch, driven through the PRODUCT's own `repairLangFor` rather
// than a re-derived copy of it.
//
// This file exists because the scout's spike could not answer the question. It
// bundles `src/core/` only, so it hard-coded "python and go fall through to the
// Rust hooks" as a fact read off the source. That was true when it was written
// and is the exact shape of the mistake the v29 arms made (a harness that
// re-derived the product mapping inverted a result). The dispatch lives in
// `src/vscode/oracleSurface.ts`, so the only honest proof bundles that file with
// a vscode stub and asks it.
//
// Every diagnostic below is VERBATIM from the scout's captures, which are real
// checker runs: pyright, `go build`, `dotnet build`, cargo, tsc.
//
// The extractor is a stub. What a real language server answers is the live
// suite's question; this file's question is which hook set the diagnostic
// reaches and what fence the payload comes back in.
//
// Run: SKIP_LIVE=1 node --test test/impl-v30-p2-langdispatch.test.cjs

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");

const STUB = path.join(__dirname, ".impl-v30-p2-stub.cjs");
fs.writeFileSync(
  STUB,
  `
class Position { constructor(line, character) { this.line = line; this.character = character; } }
class Range {
  constructor(a, b, c, d) {
    if (typeof a === "number") { this.start = new Position(a, b); this.end = new Position(c, d); }
    else { this.start = a; this.end = b; }
  }
}
class ThemeColor { constructor(id) { this.id = id; } }
class MarkdownString { constructor() { this.blocks = []; } appendCodeblock(t) { this.blocks.push(t); } }
class Diagnostic { constructor(range, message, severity) { this.range = range; this.message = message; this.severity = severity; } }
const Uri = {
  file: (p) => ({ fsPath: p, path: p, scheme: "file", toString: () => "file://" + p }),
  parse: (s) => ({ raw: s, toString: () => s }),
};
module.exports = {
  Position, Range, ThemeColor, MarkdownString, Diagnostic, Uri,
  DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
  workspace: {
    getConfiguration: () => ({ get: (k, fb) => fb, inspect: () => undefined, update: async () => {} }),
    get textDocuments() { return []; },
    openTextDocument: async () => ({ getText: () => "" }),
  },
  languages: { createDiagnosticCollection: (name) => ({ name, set() {}, delete() {}, clear() {}, dispose() {} }) },
  window: {
    createTextEditorDecorationType: (opts) => ({ opts, dispose() {} }),
    get visibleTextEditors() { return []; },
    showWarningMessage: async () => {},
    showInformationMessage: async () => {},
    setStatusBarMessage: () => ({ dispose() {} }),
  },
  commands: { executeCommand: async () => undefined },
};
`,
);

const entry = path.join(__dirname, ".impl-v30-p2.entry.ts");
const outfile = path.join(__dirname, ".impl-v30-p2.bundle.cjs");
fs.writeFileSync(entry, `export { resolveSurfaceInjection } from "../src/vscode/oracleSurface";\n`);
esbuild.buildSync({
  entryPoints: [entry],
  bundle: true,
  outfile,
  format: "cjs",
  platform: "node",
  alias: { vscode: STUB },
});
const { resolveSurfaceInjection } = require(outfile);
test.after(() => [entry, outfile, STUB].forEach((f) => fs.rmSync(f, { force: true })));

// ---------------------------------------------------------------------------

const SPAN_TEXT = "// nothing in this file names the receiver, which is the point\n";

const doc = (languageId) => ({
  languageId,
  uri: { fsPath: "/x/target", path: "/x/target", scheme: "file", toString: () => "file:///x/target" },
  getText: () => SPAN_TEXT,
});

const diag = (message, code) => ({
  kind: "compile-error",
  level: "error",
  message,
  ...(code === undefined ? {} : { code }),
  spans: [{ fileName: "target", lineStart: 3, lineEnd: 3, columnStart: 10, columnEnd: 20, isPrimary: true }],
  suggestions: [],
});

// A member list the stub always answers with, so a payload that renders proves
// the dispatch reached a member leg and nothing else.
const MEMBERS = [
  { name: "to_manifest", kind: "method", signature: "to_manifest(mirror, last_enrolled, last_flushed)" },
  { name: "advance", kind: "method", signature: "advance(n)" },
];
const extractor = {
  completeMembers: async () => MEMBERS,
  hoverSurface: async () => undefined,
  membersOfType: async () => [],
  definition: async () => undefined,
  example: async () => undefined,
  qualifyImport: async () => undefined,
};

const run = async (languageId, diagnostics) => {
  const lines = [];
  const payload = await resolveSurfaceInjection(
    extractor,
    doc(languageId),
    diagnostics,
    (l) => lines.push(l),
  );
  return { payload, lines };
};

// ===========================================================================
// 1. PYTHON reaches the Python hooks. Before v30 `repairLangFor` sent it to the
// Rust hooks, so pyright's rule name was matched against rustc's error codes and
// classified as none, forever.
// ===========================================================================

test("python: pyright's attribute miss reaches a member leg and renders a python fence", async () => {
  const { payload, lines } = await run("python", [
    diag('Cannot access attribute "mirror" for class "Boxed[Shard]"\n    Attribute "mirror" is unknown', "reportAttributeAccessIssue"),
  ]);
  assert.ok(payload, `expected a payload, got ${JSON.stringify(payload)}`);
  assert.match(payload, /Members of `Boxed\[Shard\]`/);
  assert.match(payload, /```python\n/);
  assert.ok(
    lines.some((l) => l.includes("class=unresolved-method") && l.includes("Boxed[Shard]")),
    `no injected line naming the receiver: ${JSON.stringify(lines)}`,
  );
});

test("python: reportCallIssue is the arity class and says the compiler named no receiver", async () => {
  const { payload, lines } = await run("python", [
    diag('Arguments missing for parameters "last_enrolled", "last_flushed"', "reportCallIssue"),
  ]);
  // No block of its own, exactly like operand-mismatch.
  assert.equal(payload, undefined);
  const line = lines.find((l) => l.includes("class=arity-mismatch"));
  assert.ok(line, `no arity line: ${JSON.stringify(lines)}`);
  assert.match(line, /named no receiver/);
});

test("python: the qualify class still injects nothing", async () => {
  const { payload } = await run("python", [diag('"Shard" is not defined', "reportUndefinedVariable")]);
  assert.equal(payload, undefined);
});

// ===========================================================================
// 2. GO reaches the Go hooks, and go pays the receiver forward at an arity error.
// ===========================================================================

test("go: the member miss reaches a member leg, and the receiver is reduced to a bare name", async () => {
  const { payload, lines } = await run("go", [
    diag("shard.Mirror undefined (type *atlas.Boxed[*atlas.Shard] has no field or method Mirror)"),
  ]);
  assert.ok(payload, `expected a payload, got ${JSON.stringify(payload)}`);
  assert.match(payload, /Members of `Boxed`/);
  assert.match(payload, /```go\n/);
  assert.ok(lines.some((l) => l.includes("class=unresolved-method") && l.includes("for=Boxed")), JSON.stringify(lines));
});

// CORRECTED after the phase 2-4 review. The first version of this test asserted
// that go's arity error names the receiver, reading the first `want` parameter
// as the receiver's type. That is wrong: go's `want` list is the PARAMETER list
// and a method's receiver is not in it. Verified against go1.26.5 with a method
// whose first parameter is NOT its receiver's type:
//
//   not enough arguments in call to c.ToManifest
//     have (string)
//     want (string, uint64, uint64)        <- `*Cursor` appears nowhere
//
// The scout's reproduction hid it because `ToManifest`'s first parameter
// happened to be the same type as its receiver. Go now names no type, like Rust,
// TypeScript and Python, and its receiver is resolved by the disclosure leg.
test("go: the arity error names the CALL and no receiver, because want is the parameter list", async () => {
  const { payload, lines } = await run("go", [
    diag(
      "not enough arguments in call to shard.Value().Meta.Head.ToManifest have (uint64) want (*atlas.Cursor, uint64, uint64)",
    ),
  ]);
  assert.equal(payload, undefined);
  const line = lines.find((l) => l.includes("class=arity-mismatch"));
  assert.ok(line, `no arity line: ${JSON.stringify(lines)}`);
  assert.match(line, /named no receiver/);
  assert.match(line, /ToManifest/);
});

test("go: a receiver-typed first parameter is a coincidence, not a signal", async () => {
  // The shape that would have exposed the original defect: the first `want`
  // parameter is a real type and is NOT the receiver.
  const { lines } = await run("go", [
    diag("not enough arguments in call to c.ToManifest have (uint64) want (*atlas.Options, uint64, uint64)"),
  ]);
  const line = lines.find((l) => l.includes("class=arity-mismatch"));
  assert.ok(line, `no arity line: ${JSON.stringify(lines)}`);
  assert.ok(!line.includes("Options"), `a parameter type leaked as the receiver: ${line}`);
});

test("go: a message the compiler did not write in either shape injects nothing", async () => {
  const { payload } = await run("go", [diag("declared and not used: shard")]);
  assert.equal(payload, undefined);
});

// ===========================================================================
// 3. THE SMART-POINTER UNWRAP, through the product's own Rust field leg. The
// live capture's receiver was `Ref<'_, Rc<LogSegmentFile>>` and the field leg
// went looking for the shape of `Ref`.
// ===========================================================================

test("rust: E0609 behind a RefCell borrow asks for the wrapped type's shape, not the guard's", async () => {
  const { lines } = await run("rust", [
    diag("no field `cursor` on type `Ref<'_, Rc<LogSegmentFile>>`", "E0609"),
  ]);
  const miss = lines.find((l) => l.includes("class=unresolved-field"));
  assert.ok(miss, `no field line: ${JSON.stringify(lines)}`);
  assert.match(miss, /for=LogSegmentFile/);
  assert.ok(!miss.includes("Ref<"), `the guard type still reached the resolver: ${miss}`);
});

test("rust: a container that is not a wrapper keeps its own spelling", async () => {
  const { lines } = await run("rust", [
    diag("no field `cursor` on type `HashMap<String, Shard>`", "E0609"),
  ]);
  const miss = lines.find((l) => l.includes("class=unresolved-field"));
  assert.ok(miss, `no field line: ${JSON.stringify(lines)}`);
  assert.match(miss, /for=HashMap<String, Shard>/);
});

// ===========================================================================
// 4. THE LANGUAGES THAT ALREADY HAD HOOKS KEEP THEM. A dispatch table grows two
// entries and the other three must not move.
// ===========================================================================

test("csharp: CS1061 still renders a cs fence", async () => {
  const { payload } = await run("csharp", [
    diag("'Boxed<Shard>' does not contain a definition for 'Mirror' and no accessible extension method 'Mirror' accepting a first argument of type 'Boxed<Shard>' could be found (are you missing a using directive or an assembly reference?)", "CS1061"),
  ]);
  assert.ok(payload, "expected a payload");
  assert.match(payload, /```cs\n/);
});

test("csharp: CS7036 carries the receiver out of the quoted signature at no round-trip cost", async () => {
  const { payload, lines } = await run("csharp", [
    diag("There is no argument given that corresponds to the required parameter 'lastEnrolled' of 'Cursor.ToManifest(Cursor?, long, long)'", "CS7036"),
  ]);
  assert.equal(payload, undefined);
  const line = lines.find((l) => l.includes("class=arity-mismatch"));
  assert.ok(line, `no arity line: ${JSON.stringify(lines)}`);
  assert.match(line, /named the receiver `Cursor`/);
});

test("typescript: TS2339 still renders a ts fence, and TS2554 is the arity class with no receiver", async () => {
  const miss = await run("typescript", [
    diag("Property 'mirror' does not exist on type 'Boxed<Shard>'.", "TS2339"),
  ]);
  assert.ok(miss.payload, "expected a payload");
  assert.match(miss.payload, /```ts\n/);

  const arity = await run("typescript", [diag("Expected 3 arguments, but got 1.", "TS2554")]);
  assert.equal(arity.payload, undefined);
  const line = arity.lines.find((l) => l.includes("class=arity-mismatch"));
  assert.ok(line, `no arity line: ${JSON.stringify(arity.lines)}`);
  assert.match(line, /named no receiver/);
});

test("rust: E0061 is the arity class, and rustc's message names no receiver", async () => {
  const { payload, lines } = await run("rust", [
    diag("this method takes 3 arguments but 1 argument was supplied", "E0061"),
  ]);
  assert.equal(payload, undefined);
  const line = lines.find((l) => l.includes("class=arity-mismatch"));
  assert.ok(line, `no arity line: ${JSON.stringify(lines)}`);
  assert.match(line, /named no receiver/);
});
