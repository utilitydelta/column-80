// Implementer oracle (v12 Phase 1, do-list DO-1): the bodyless-member refusal
// guard. A cursor on an interface member / abstract method resolves as a
// FUNCTION (Method is a function kind), so the type brace-less guard never sees
// it; without this predicate the command would splice a body over a bodyless
// signature and emit invalid code (session-v12 review-phase1 MAJOR). This is the
// deliberate-dark pin the triage required: a bodyless C#/TS member refuses; a
// bodied member does not; and the freeze/phase boundaries hold — a RUST trait
// method signature (legal default body) is NEVER refused, and PYTHON (brace-less
// bodies, a later phase) is NEVER refused here.
//
// Drives the REAL isBodylessMemberTarget from src/vscode/fnGen, bundled against a
// minimal vscode stub (the predicate never calls vscode; the stub only satisfies
// fnGen's module-load `vscode.SymbolKind` reads). Soundness cases prove the
// depth-aware slice, not a substring: an inline object-type `{` or a `<...>`
// generic in a bodyless signature must NOT defeat the refusal.
//
// Run: SKIP_LIVE=1 node --test test/impl-v12-bodyless-member-guard.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");

// A stub that only supplies what fnGen touches at module load. SymbolKind is the
// one enum read at load (the kind Sets); everything else is a no-op Proxy.
const STUB = path.join(__dirname, ".impl-v12-bodyless-stub.cjs");
fs.writeFileSync(
  STUB,
  `const h = { get: () => new Proxy(function(){}, h), apply: () => undefined };
const anything = new Proxy(function(){}, h);
module.exports = new Proxy({
  SymbolKind: { File:0, Module:1, Namespace:2, Package:3, Class:4, Method:5, Property:6,
    Field:7, Constructor:8, Enum:9, Interface:10, Function:11, Variable:12, Constant:13,
    String:14, Number:15, Boolean:16, Array:17, Object:18, Key:19, Null:20, EnumMember:21,
    Struct:22, Event:23, Operator:24, TypeParameter:25 },
}, { get: (t, p) => (p in t ? t[p] : anything) });
`,
);

const entry = path.join(__dirname, ".impl-v12-bodyless.entry.ts");
const out = path.join(__dirname, ".impl-v12-bodyless.bundle.cjs");
let mod = {};
let bundleErr;
try {
  fs.writeFileSync(entry, `export { isBodylessMemberTarget } from "../src/vscode/fnGen";\n`);
  esbuild.buildSync({ entryPoints: [entry], bundle: true, outfile: out, format: "cjs", platform: "node", alias: { vscode: STUB } });
  mod = require(out);
} catch (e) {
  bundleErr = e;
}
test.after(() => {
  for (const f of [STUB, entry, out]) fs.rmSync(f, { force: true });
});

test("bundle guard: isBodylessMemberTarget builds headless", () => {
  if (bundleErr) assert.fail(`bundle failed: ${bundleErr.message}`);
  assert.strictEqual(typeof mod.isBodylessMemberTarget, "function");
});

// [languageId, spanText, expectBodyless, why]
const CASES = [
  // --- C#: refuse bodyless members --------------------------------------
  ["csharp", "double Area();", true, "C# interface member signature"],
  ["csharp", "public abstract int Area();", true, "C# abstract method"],
  ["csharp", "int Area()\n{\n    return 0;\n}", false, "C# interface DEFAULT method (has a brace body)"],
  ["csharp", "public void Reset()\n{\n    Port = 0;\n}", false, "C# block-bodied method"],
  ["csharp", "public int Foo() => 1;", false, "C# expression-bodied member"],
  ["csharp", "Dictionary<int, List<int>> Get();", true, "C# generic-return bodyless member (the <...> must not fool it)"],
  // --- TS: refuse bodyless members --------------------------------------
  ["typescript", "area(): number;", true, "TS interface member signature"],
  ["typescript", "reset(): void {\n    this.port = 0;\n}", false, "TS block-bodied method"],
  ["typescript", "foo(x: { a: number }): void;", true, "TS bodyless member with an inline object-type param (the {} must not fool it)"],
  ["typescript", "make(): () => number;", true, "TS bodyless member returning a function type (the => must not fool it)"],
  ["typescript", "foo():\n  { a: number };", true, "TS bodyless member with the object return type on a CONTINUATION line (review-phase1 re-review (b): the type-group { must not read as a body)"],
  ["typescript", "foo(): { a: number };", true, "TS bodyless member with a same-line object return type"],
  ["typescript", "method<T>(x: T): T {\n    return x;\n}", false, "TS generic block-bodied method"],
  ["typescript", "make(): { a: number } {\n    return { a: 1 };\n}", false, "TS method with an object return type AND a block body (bodied)"],
  ["typescriptreact", "render(): JSX.Element;", true, "TSX interface member signature"],
  // --- Freeze / phase boundaries: NEVER refused here --------------------
  ["rust", "fn area(&self) -> f64;", false, "FROZEN: a Rust trait method sig legally takes a generated default body"],
  ["rust", "pub fn add(a: i32, b: i32) -> i32", false, "FROZEN: a Rust fn header is never refused"],
  ["python", "def area(self) -> float: ...", false, "PHASE 2: Python bodies are brace-less; not handled here"],
  ["python", "def reset(self):", false, "PHASE 2: Python def header not refused here"],
  ["go", "func Area() float64", false, "unregistered language never refused here"],
];

for (const [languageId, spanText, expected, why] of CASES) {
  test(`${languageId}: ${expected ? "REFUSE" : "allow"} — ${why}`, () => {
    assert.strictEqual(
      mod.isBodylessMemberTarget(languageId, spanText),
      expected,
      `isBodylessMemberTarget(${JSON.stringify(languageId)}, ${JSON.stringify(spanText)}) should be ${expected}`,
    );
  });
}
