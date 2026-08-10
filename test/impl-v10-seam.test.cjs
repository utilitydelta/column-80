// Phase-1 seam-confirmation lock (session-v10/goal.md phase 1). v9 extracted
// oracleFor + the extractor/whole-block registries as the only construction
// paths; v10 (C#) is the third language proving those seams generalize. This
// file LOCKS two phase-1 claims so a later refactor cannot silently break the
// third-language seam:
//
//   1. declarationHeadLine (core/symbols.ts) lands the head on the NAME line
//      for C# member shapes, never inside a leading attribute. Inputs below are
//      the REAL Roslyn LS documentSymbol ranges from a broken C# buffer
//      (session-v10 phase-1 probe): for ATTRIBUTED members the LS puts the
//      attribute INSIDE range.start, so the head walk must strip it. Caller
//      wiring (fnGen.ts:149) feeds range.start.line as startLine and
//      selectionRange.start.line as nameLine — the two args here.
//      SCOPE (honest): for C#, modifiers+name share the name line, so the
//      correct head is ALWAYS the name line; this suite proves "head does not
//      land on the attribute" and catches a startLine-returning regression. It
//      does NOT and cannot (with C# inputs) prove the interior stripping logic,
//      nor does it cover C# fn-gen doc-comment capture or signature slicing —
//      those are wrong-defaulted to Rust today (session-v10/scraps.md F2/F3)
//      and are pinned by the phase-4 blind oracle, where the gestures light up.
//   2. The core construction registries stay DARK for csharp before phase 2/3
//      wire it, and dark for any unknown id (honest inapplicability, the seam's
//      whole point). oracleFor is compiler-directed; wholeBlockSiteFor is the
//      FIM whole-block detector registry. (extractorFor imports vscode and is
//      locked in the phase-3 blind suite, not here.)
//
// Characterization phase: these run GREEN against current main (no C# code
// exists yet).
//
// Run: SKIP_LIVE=1 node --test test/impl-v10-seam.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-v10-seam",
  `export { declarationHeadLine, hasDocumentSymbolShape } from "../src/core/symbols";\n` +
    `export { oracleFor } from "../src/core/compilerOracle";\n` +
    `export { wholeBlockSiteFor } from "../src/core/fimWholeBlock";\n`,
);
test.after(() => cleanup());

const { declarationHeadLine, hasDocumentSymbolShape, oracleFor, wholeBlockSiteFor } = mod;

// The exact C# source the LS probe ran against (0-based line array, matching
// vscode/LSP line numbers). getLine(n) returns line n.
const CS_SOURCE = [
  "using System;", // 0
  "", // 1
  "namespace P1;", // 2
  "", // 3
  "public class Shapes", // 4
  "{", // 5
  "    // expression-bodied method (single-line range expected)", // 6
  '    public string Greet(string name) => $"hi {name}";', // 7
  "", // 8
  "    // expression-bodied property (single-line)", // 9
  "    public int Answer => 42;", // 10
  "", // 11
  "    // block-bodied method with a single-line attribute above it", // 12
  "    [Obsolete]", // 13
  "    public int Block()", // 14
  "    {", // 15
  "        return 1;", // 16
  "    }", // 17
  "", // 18
  "    // multi-line attribute stack above a block-bodied method", // 19
  "    [Obsolete]", // 20
  "    [Serializable]", // 21
  "    public int Stacked()", // 22
  "    {", // 23
  "        return 2;", // 24
  "    }", // 25
  "", // 26
  "    // attribute carrying parens + a string arg", // 27
  '    [Obsolete("use Greet instead")]', // 28
  '    public string Old() => "x";', // 29
  "}", // 30
];
const getLine = (n) => CS_SOURCE[n] ?? "";

// [shape, range.start.line, selectionRange.start.line (name), expected head].
// Columns 2-3 are the REAL LS output; column 4 is the name line the head must
// land on (never inside an attribute). Proven by the phase-1 probe.
const HEAD_CASES = [
  ["expr-bodied method (Greet)", 7, 7, 7],
  ["expr-bodied property (Answer)", 10, 10, 10],
  ["block + single [Obsolete] (Block)", 13, 14, 14],
  ["block + [Obsolete][Serializable] stack (Stacked)", 20, 22, 22],
  ['[Obsolete("...")] parens+string (Old)', 28, 29, 29],
];

for (const [label, startLine, nameLine, expected] of HEAD_CASES) {
  test(`declarationHeadLine strips C# attributes/comments to the name line: ${label}`, () => {
    const head = declarationHeadLine(getLine, startLine, nameLine);
    assert.strictEqual(
      head,
      expected,
      `head for ${label} landed on line ${head} (source: ${JSON.stringify(getLine(head))}), expected the name line ${expected}`,
    );
    // The head is never past the name line, and never lands on an attribute
    // opener — the two span-shrinking safety properties, checked on C# input.
    assert.ok(head <= nameLine, "head must never pass the name line");
    assert.ok(!getLine(head).trim().startsWith("["), "head must not land on an attribute line");
  });
}

test("declarationHeadLine leaves a real declaration head untouched (no over-strip)", () => {
  // A bare declaration with no leading trivia: head is the start line itself.
  assert.strictEqual(declarationHeadLine(getLine, 14, 14), 14);
});

test("hasDocumentSymbolShape accepts the LS hierarchical shape, rejects flat SymbolInformation", () => {
  const hierarchical = [{ range: {}, selectionRange: {}, children: [] }];
  const flat = [{ name: "X", location: {} }];
  assert.strictEqual(hasDocumentSymbolShape(hierarchical), true);
  assert.strictEqual(hasDocumentSymbolShape(flat), false);
});

test("oracleFor resolves a csharp oracle now phase 2 has wired it (the seam took the third language)", () => {
  // Phase-1 characterization was `undefined` (dark before phase 2). Phase 2
  // (CsOracle) wires it: the seam now resolves csharp the same shape it
  // resolves rust and typescript, with no interface change — v10's whole point.
  const cs = oracleFor("csharp");
  assert.ok(cs && cs.language === "csharp", "oracleFor('csharp') resolves the C# oracle");
});

test("wholeBlockSiteFor resolves a csharp detector now phase 4 has wired it (the FIM whole-block go-live)", () => {
  // Phase-3 characterization was `undefined` (dark before phase 4). Phase 4
  // registers the C# whole-block detector atomically with the gesture wiring, so
  // the seam now resolves csharp the same shape it resolves rust and typescript.
  assert.strictEqual(typeof wholeBlockSiteFor("csharp"), "function");
});

test("both core registries stay dark for an unknown language id (the seam default)", () => {
  assert.strictEqual(oracleFor("cobol"), undefined);
  assert.strictEqual(wholeBlockSiteFor("cobol"), undefined);
});

// The two registries that DO resolve today keep resolving — proving the
// phase-1 seam scan did not disturb the existing languages while confirming
// no third-language block exists.
test("the seam still resolves the existing languages (rust oracle, ts oracle)", () => {
  assert.ok(oracleFor("rust"), "rust oracle must still resolve");
  assert.ok(oracleFor("typescript"), "typescript oracle must still resolve");
  assert.ok(wholeBlockSiteFor("rust"), "rust whole-block detector must still resolve");
  assert.ok(wholeBlockSiteFor("typescript"), "ts whole-block detector must still resolve");
});
