// Phase-1 seam-confirmation lock (the Python session, phase 1). v9 extracted
// oracleFor + the whole-block registry as the only core construction paths; v10
// (C#) proved they take a third language; v11 (Python) is the fourth. This file
// LOCKS the phase-1 seam state so a later refactor — or a premature/residual
// wiring — cannot slip through:
//
//   1. The core construction registries stay DARK for `python` until the phase
//      that lights each one wires it (honest inapplicability, the seam's whole
//      point). oracleFor is compiler-directed (lit in phase 2); wholeBlockSiteFor
//      is the FIM whole-block detector registry (lit in phase 4). extractorFor
//      imports vscode and is locked in the phase-3 blind suite, not here.
//   2. Weaving Python in did NOT disturb the three existing languages: rust, ts,
//      and csharp all still resolve on every registry they resolved before.
//   3. The two language-neutral pure helpers phase 1 leans on — fimMemberSite's
//      comment-token parameter and declarationHeadLine's decorator strip — keep
//      their DEFAULT (Rust/TS/C#) behavior byte-identical. The Python contract
//      for both is proven black-box in blind-v11-seam; this suite pins only that
//      the default path did not shift under the phase-1 change.
//
// The assertions below flip GREEN as phases land: today (phase 1) python is dark
// on both core registries. Update the two `oracleFor`/`wholeBlockSiteFor` python
// cases when phase 2 / phase 4 wire them, the same way impl-v10-seam evolved.
//
// Run: SKIP_LIVE=1 node --test test/impl-v11-seam.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-v11-seam",
  `export { oracleFor } from "../src/core/compilerOracle";\n` +
    `export { wholeBlockSiteFor } from "../src/core/fimWholeBlock";\n` +
    `export { fimMemberSite } from "../src/core/fimInject";\n` +
    `export { declarationHeadLine } from "../src/core/symbols";\n`,
);
test.after(() => cleanup());

const { oracleFor, wholeBlockSiteFor, fimMemberSite, declarationHeadLine } = mod;

test("oracleFor resolves a python oracle; phase 4 lights wholeBlockSiteFor('python') too", () => {
  // Phase 2 (PyOracle) flipped oracleFor('python') to a python oracle, the same
  // shape it resolves rust/ts/csharp with no interface change. Phase 4 wires the
  // FIM whole-block detector (pyWholeBlockSite) atomically with the Python
  // gestures, so wholeBlockSiteFor('python') now resolves a detector fn.
  const py = oracleFor("python");
  assert.ok(py && py.language === "python", "oracleFor('python') resolves the Python oracle");
  assert.strictEqual(
    typeof wholeBlockSiteFor("python"),
    "function",
    "wholeBlockSiteFor('python') is live in phase 4",
  );
});

test("the three existing languages still resolve on every registry (no residue)", () => {
  for (const lang of ["rust", "typescript", "csharp"]) {
    const o = oracleFor(lang);
    assert.ok(o && o.language, `oracleFor(${lang}) must still resolve`);
  }
  assert.ok(wholeBlockSiteFor("rust"), "rust whole-block detector must still resolve");
  assert.ok(wholeBlockSiteFor("typescript"), "ts whole-block detector must still resolve");
  assert.strictEqual(typeof wholeBlockSiteFor("csharp"), "function", "cs whole-block still resolves");
});

test("both core registries stay dark for an unknown language id (the seam default)", () => {
  assert.strictEqual(oracleFor("cobol"), undefined);
  assert.strictEqual(wholeBlockSiteFor("cobol"), undefined);
});

test("fimMemberSite default (no lineComments arg) is unchanged: '//' dark, '#' live", () => {
  // The phase-1 change added an OPTIONAL lineComments param defaulting to ["//"].
  // Every existing Rust/TS/C# call site passes no second arg, so its behavior
  // must be byte-identical: a `//` line is dark, a `#` line is live code.
  assert.strictEqual(fimMemberSite("    // note foo.bar"), undefined, "'//' line dark by default");
  assert.deepStrictEqual(fimMemberSite("x.field"), { partial: "field" }, "plain member site unchanged");
  assert.deepStrictEqual(
    fimMemberSite("    # not a comment here obj.attr"),
    { partial: "attr" },
    "'#' is NOT a comment under the default token set",
  );
});

test("declarationHeadLine default trivia strip is unchanged (Rust attribute + doc comment)", () => {
  // A Rust-shaped head: doc comment + attribute above the fn name line. The
  // decorator/attribute walk that Python decorated funcs ride is the same code,
  // so this pins that phase 1 left the existing strip untouched.
  const src = ["/// docs", "#[inline]", "pub fn go() {"];
  const getLine = (n) => src[n];
  assert.strictEqual(declarationHeadLine(getLine, 0, 2), 2, "strips doc+attr to the fn name line");
});
