// Implementer oracle (v12 Phase 3): the DELIBERATE-DARK pins — the "this
// language deliberately does not do X" facts, each asserted so dark-by-design is
// distinguishable from broken (the camouflage gap the de-rust audit named, and
// the goal's Phase-3 requirement). Consolidates the Phase-1/2 review Defers:
//   DEFER-1  the brace-less refusal is de-Rusted per language (bracelessTypeShape)
//   DEFER-2  a C# record's instruction wording (record reported as class → "class")
//   DEFER-4  C#/TS type splice coherence (full-replacement leaves the doc above intact)
//   DEFER-5  the Python enum import-alias base boundary (bare alias → class; dotted → enum)
// Pure/near-pure surfaces; the fnGen helper rides a minimal vscode stub.
//
// Run: SKIP_LIVE=1 node --test test/impl-v12-deliberate-dark.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");
const { bundleCore } = require("./.blind-util.cjs");

// --- core surfaces ---------------------------------------------------------
const { mod: core, cleanup } = bundleCore(
  "impl-v12-deliberate-dark",
  `export { assembleFnGenPrompt } from "../src/core/prompt";\n` +
    `export { pyTypeGenKind } from "../src/core/pyExtraction";\n` +
    `export { spliceSpan } from "../src/core/span";\n`,
);
const { assembleFnGenPrompt, pyTypeGenKind, spliceSpan } = core;

// --- fnGen helper via a minimal vscode stub --------------------------------
const STUB = path.join(__dirname, ".impl-v12-dd-stub.cjs");
fs.writeFileSync(
  STUB,
  `const h={get:()=>new Proxy(function(){},h),apply:()=>undefined};const anything=new Proxy(function(){},h);
module.exports=new Proxy({ SymbolKind:{ File:0,Class:4,Method:5,Enum:9,Interface:10,Function:11,Struct:22 } },{ get:(t,p)=>(p in t?t[p]:anything) });`,
);
const entry = path.join(__dirname, ".impl-v12-dd.entry.ts");
const out = path.join(__dirname, ".impl-v12-dd.bundle.cjs");
let fnGen = {};
let fnErr;
try {
  fs.writeFileSync(entry, `export { bracelessTypeShape, isBracelessTypeTarget } from "../src/vscode/fnGen";\n`);
  esbuild.buildSync({ entryPoints: [entry], bundle: true, outfile: out, format: "cjs", platform: "node", alias: { vscode: STUB } });
  fnGen = require(out);
} catch (e) {
  fnErr = e;
}
test.after(() => {
  cleanup();
  for (const f of [STUB, entry, out]) fs.rmSync(f, { force: true });
});

// === DEFER-1: brace-less refusal is de-Rusted per language ==================

test("DEFER-1: bracelessTypeShape is de-Rusted — C# names a positional record / record struct, never 'unit or tuple'", () => {
  if (fnErr) assert.fail(`fnGen bundle failed: ${fnErr.message}`);
  assert.strictEqual(fnGen.bracelessTypeShape("csharp", "class"), "a positional record");
  assert.strictEqual(fnGen.bracelessTypeShape("csharp", "struct"), "a positional record struct");
  assert.ok(!fnGen.bracelessTypeShape("csharp", "class").includes("unit or tuple"), "C# must not borrow the Rust 'unit or tuple' vocabulary");
  // Rust keeps its own vocabulary.
  assert.strictEqual(fnGen.bracelessTypeShape("rust", "struct"), "a unit or tuple struct");
});

// === DARK: the brace-less refusal DECISION (review MINOR-1 / MINOR-2) ========
// Pins the dark facts at the DECISION layer, so a regression that re-enables a
// wrong refusal (e.g. dropping the Python exclusion) is caught by CI, not only
// asserted by proxy below the command.

test("DARK: Python is deliberately excluded from the brace-less refusal — a pass-only / one-liner class (no `{`) is NOT refused", () => {
  if (fnErr) assert.fail(`fnGen bundle failed: ${fnErr.message}`);
  // Python bodies are brace-less by nature; these are real generatable bodies.
  assert.strictEqual(fnGen.isBracelessTypeTarget("python", "class", "class EmptyPass:\n    pass"), false, "a pass-only Python class must NOT be brace-less-refused");
  assert.strictEqual(fnGen.isBracelessTypeTarget("python", "class", "class OneLiner: pass"), false, "a one-liner Python class must NOT be refused");
  assert.strictEqual(fnGen.isBracelessTypeTarget("python", "enum", "class Color(Enum):\n    RED = 1"), false, "a Python enum (no braces) must NOT be refused");
});

test("DARK: a C# positional record / record struct (no `{`) IS brace-less-refused; a braced C# type is not", () => {
  if (fnErr) assert.fail(`fnGen bundle failed: ${fnErr.message}`);
  assert.strictEqual(fnGen.isBracelessTypeTarget("csharp", "class", "public record Point(int X, int Y);"), true, "a C# positional record has no body block");
  assert.strictEqual(fnGen.isBracelessTypeTarget("csharp", "struct", "public record struct Rgb(byte R, byte G, byte B);"), true, "a C# positional record struct has no body block");
  assert.strictEqual(fnGen.isBracelessTypeTarget("csharp", "class", "public class C\n{\n}"), false, "a braced C# class IS generatable");
  assert.strictEqual(fnGen.isBracelessTypeTarget("rust", "struct", "pub struct Unit;"), true, "a Rust unit struct has no body block");
  assert.strictEqual(fnGen.isBracelessTypeTarget("rust", "struct", "pub struct S {\n    x: u8,\n}"), false, "a braced Rust struct IS generatable");
  assert.strictEqual(fnGen.isBracelessTypeTarget("csharp", "function", "int Area();"), false, "a function target is never the type brace-less case (the bodyless-member guard owns that)");
});

// === DEFER-5: Python enum import-alias base boundary ========================

test("DEFER-5: a bare import-alias enum base classifies 'class' (sound limitation); the dotted form classifies 'enum'", () => {
  // `from enum import Enum as E; class C(E):` — E is not a recognized enum base
  // name; the classifier reads the base text and honestly picks "class".
  assert.strictEqual(pyTypeGenKind(["class C(E):"]), "class");
  // `import enum as e; class C(e.Enum):` — the final dotted component IS Enum.
  assert.strictEqual(pyTypeGenKind(["class C(e.Enum):"]), "enum");
});

// === DEFER-2: a C# record's instruction says "class" (a record IS a class) ===

test("DEFER-2: a C# record (reported as Class → kind 'class') uses the 'class' + 'members' instruction, header carries 'record'", () => {
  const prompt = assembleFnGenPrompt({
    kind: "class",
    languageId: "csharp",
    signature: "public record Point",
    docComment: "/// <summary>A point.</summary>",
  });
  const lower = prompt.toLowerCase();
  assert.ok(lower.includes("class definition"), "the instruction speaks of the class definition (a record is a class)");
  assert.ok(lower.includes("members"), "the noun is 'members'");
  assert.ok(prompt.includes("public record Point"), "the true keyword 'record' is carried in the target header block");
});

// === DEFER-4: C#/TS type splice coherence (full-replacement, doc above intact) ===

// The generated type replaces exactly [headStart .. range.end]; the doc comment
// above headStart is outside the span and must survive untouched.
const CS_DOC =
  "namespace N;\n" + // 0
  "\n" + // 1
  "/// <summary>A server config.</summary>\n" + // 2  doc above — must survive
  "public class ServerConfig\n" + // 3  headStart here
  "{\n" + // 4
  "}\n"; // 5
test("DEFER-4: a C# class splice replaces only the type span; the doc comment above is untouched", () => {
  // headStart = start of line 3; span end = end of line 5 `}`.
  const lines = CS_DOC.split("\n");
  const off = (line, col) => { let o = 0; for (let i = 0; i < line; i++) o += lines[i].length + 1; return o + col; };
  const span = { start: off(3, 0), end: off(5, 1) };
  const generated = "public class ServerConfig\n{\n    public int Port { get; set; }\n}";
  const result = spliceSpan(CS_DOC, span, generated);
  assert.ok(result.includes("/// <summary>A server config.</summary>"), "the XML doc above the header must survive the splice");
  assert.ok(result.startsWith("namespace N;\n"), "the namespace line above is untouched");
  assert.ok(result.includes("public int Port { get; set; }"), "the generated body landed in the span");
  assert.ok(!result.includes("public class ServerConfig\npublic class ServerConfig"), "the header is not duplicated");
});

const TS_DOC =
  "/** A shape. */\n" + // 0  JSDoc above — must survive
  "export interface Shape\n" + // 1  headStart
  "{\n" + // 2
  "}\n"; // 3
test("DEFER-4: a TS interface splice replaces only the type span; the JSDoc above is untouched", () => {
  const lines = TS_DOC.split("\n");
  const off = (line, col) => { let o = 0; for (let i = 0; i < line; i++) o += lines[i].length + 1; return o + col; };
  const span = { start: off(1, 0), end: off(3, 1) };
  const generated = "export interface Shape\n{\n    area(): number;\n}";
  const result = spliceSpan(TS_DOC, span, generated);
  assert.ok(result.startsWith("/** A shape. */\n"), "the JSDoc above the interface must survive the splice");
  assert.ok(result.includes("area(): number;"), "the generated member list landed in the span");
});
