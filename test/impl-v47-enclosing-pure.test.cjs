// IMPLEMENTER (white-box) - session-v47: `enclosingTypeName`, the symbol-tree
// descent to the type a cursor sits inside.
//
// WHAT IT IS FOR, since no product code calls it. session-v47 found that
// `session-v46/run-arm.cjs` never set `resolved.symbols`, which switched off
// `resolvePrefill`'s receiver leg in every arm this project has measured. The
// fix feeds the rig a translated symbol tree, and a re-derived translation is
// this project's classic silent defect - so the rig CHECKS its translation
// against this function, which reads the LSP kind table directly. A helper the
// check depends on gets tested at its own edges.
//
// The documentSymbol fixtures are the SHAPES Roslyn really returns, taken from
// the live probe in session-v47/probe-cs0103.json (a C# 12 primary-constructor
// controller answering one member, a classic service answering twelve with
// `detail` signatures). Kind numbers are LSP SymbolKind: 5 class, 6 method,
// 8 field, 9 constructor, 10 enum, 11 interface, 23 struct, 3 namespace.
//
// Run: SKIP_LIVE=1 node --test test/impl-v47-enclosing-pure.test.cjs

const test = require("node:test");
const assert = require("node:assert/strict");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-v47-enclosing-pure",
  `export { enclosingTypeName } from "../src/core/extraction";
export { csLspSymbolRole } from "../src/core/csExtraction";\n`,
);
const { enclosingTypeName, csLspSymbolRole } = mod;
test.after(cleanup);

const at = (line, character) => ({ uri: "file:///X.cs", line, character });
const range = (sl, sc, el, ec) => ({ start: { line: sl, character: sc }, end: { line: el, character: ec } });
const sym = (name, kind, r, children) => ({ name, kind, range: r, selectionRange: r, ...(children ? { children } : {}) });

// namespace Acme { class Widget { field _q; method Run { ... } } }
const TREE = [
  sym("Acme", 3, range(0, 0, 40, 1), [
    sym("Widget", 5, range(1, 2, 30, 3), [
      sym("_q", 8, range(2, 4, 2, 20)),
      sym("Run", 6, range(4, 4, 12, 5)),
      sym("Nested", 5, range(14, 4, 24, 5), [sym("Inner", 6, range(16, 6, 20, 7))]),
    ]),
    sym("Other", 5, range(32, 2, 38, 3), [sym("Ping", 6, range(33, 4, 35, 5))]),
  ]),
];

test("enclosingTypeName: a cursor inside a method answers the TYPE, not the method", () => {
  assert.equal(enclosingTypeName(TREE, at(6, 10), csLspSymbolRole), "Widget");
});

test("enclosingTypeName: a cursor inside a NESTED type answers the nearest one", () => {
  // The whole reason the descent is depth-first. Answering `Widget` here would
  // put an outer type's name over an inner type's members.
  assert.equal(enclosingTypeName(TREE, at(18, 8), csLspSymbolRole), "Nested");
});

test("enclosingTypeName: a cursor in a sibling type answers THAT type", () => {
  assert.equal(enclosingTypeName(TREE, at(34, 6), csLspSymbolRole), "Other");
});

test("enclosingTypeName: a cursor in the NAMESPACE but no type answers undefined", () => {
  // A namespace encloses every method in the file. The role table is the whole
  // safety property here: an unfiltered walk lands on `Acme` and prints a
  // namespace's name where a type's belongs.
  assert.equal(enclosingTypeName(TREE, at(31, 0), csLspSymbolRole), undefined);
});

test("enclosingTypeName: a cursor outside everything answers undefined", () => {
  assert.equal(enclosingTypeName(TREE, at(99, 0), csLspSymbolRole), undefined);
});

test("enclosingTypeName: a non-array payload answers undefined rather than throwing", () => {
  // A dead or confused server returns null, an error object, a string. The leg
  // above it must degrade, never throw: repair going out with the diagnostics
  // alone is the behaviour this is trying to improve on, not one it may break.
  for (const junk of [undefined, null, {}, "symbols", 7, NaN]) {
    assert.equal(enclosingTypeName(junk, at(6, 10), csLspSymbolRole), undefined);
  }
});

test("enclosingTypeName: a container with an empty name answers undefined, not ``", () => {
  const nameless = [sym("", 5, range(0, 0, 9, 1), [sym("Run", 6, range(2, 2, 5, 3))])];
  assert.equal(enclosingTypeName(nameless, at(3, 4), csLspSymbolRole), undefined);
});

test("enclosingTypeName: struct, interface and enum are types too", () => {
  for (const kind of [23, 11, 10]) {
    const tree = [sym("Shape", kind, range(0, 0, 9, 1), [sym("M", 6, range(2, 2, 5, 3))])];
    assert.equal(enclosingTypeName(tree, at(3, 4), csLspSymbolRole), "Shape", `kind ${kind}`);
  }
});
