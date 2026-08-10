// IMPL ORACLE — session-v40 item 4: Python's enum variant render.
//
// pyright hovers a class as `(class) LodBand`, byte for byte the same whether
// the class is a plain class, a dataclass, or an Enum subclass (verified live
// against ~/repos/python-scratch/atlas_py/_core.py — see pyExtraction.ts's
// pyEnumBaseDecl doc comment for the exact probe and numbers). Its variants
// resolve through documentSymbol with no signature, so `renderMethods` drops
// every one and the enum ships empty — the same hole `enumMemberLine`
// already fills for C# by reading `enum Atlas.LodBand` off Roslyn's hover.
//
// Python has no hover text to read. A second live probe against a synthetic
// fixture (a plain class with an ALL_CAPS attribute, a dataclass field with no
// default, and a real Enum subclass with LOWERCASE variants) killed the
// documentSymbol-`kind` substitute too: pyright's Constant-vs-Variable split
// is an ALL_CAPS naming heuristic, not an Enum signal. So `pyEnumBaseDecl`
// reads the declaration SOURCE (`class LodBand(IntEnum):`) instead, and
// `pyShapeHooks.enumMemberLine` renders a member only when that line says so.
//
// This file is the white-box unit half: `pyEnumBaseDecl` and
// `pyShapeHooks.enumMemberLine` against synthetic CompletionMember inputs, no
// server involved. The live half (does a REAL pyright session actually
// produce this) is test/impl-v40-p4-py-enum-render-live.test.cjs.
//
// Run: SKIP_LIVE=1 node --test test/impl-v40-p4-py-enum-render.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

let mod = {};
let cleanup = () => {};
let bundleErr;
try {
  ({ mod, cleanup } = bundleCore(
    "impl-v40-p4-py-enum-render",
    `export { pyEnumBaseDecl } from "../src/core/pyExtraction";\n` +
      `export { pyShapeHooks } from "../src/core/crossFileShape";\n`,
  ));
} catch (e) {
  bundleErr = e;
}
test.after(() => cleanup());
const { pyEnumBaseDecl, pyShapeHooks } = mod;

test("bundle built with no error", () => {
  assert.strictEqual(bundleErr, undefined, bundleErr && bundleErr.stack);
});

// --- pyEnumBaseDecl: source-text base-class detection. ---------------------

test("pyEnumBaseDecl: true for a bare IntEnum base, byte for byte the LodBand shape", () => {
  const defLines = ["class LodBand(IntEnum):", "    CONTINENTAL = 0"];
  assert.strictEqual(pyEnumBaseDecl(defLines, "LodBand"), true);
});

test("pyEnumBaseDecl: true for a qualified enum.Enum base", () => {
  const defLines = ["class Color(enum.Enum):", "    RED = 1"];
  assert.strictEqual(pyEnumBaseDecl(defLines, "Color"), true);
});

test("pyEnumBaseDecl: true when the enum base is not first in a multi-base list", () => {
  const defLines = ["class Mixed(SomeMixin, IntFlag):", "    A = 1"];
  assert.strictEqual(pyEnumBaseDecl(defLines, "Mixed"), true);
});

test("pyEnumBaseDecl: false for a plain class with no base", () => {
  const defLines = ["class Tile:", "    def __init__(self): pass"];
  assert.strictEqual(pyEnumBaseDecl(defLines, "Tile"), false);
});

test("pyEnumBaseDecl: false for a dataclass — no Enum in its base list", () => {
  const defLines = ["class StripeSummary:", "    aggregate: int"];
  assert.strictEqual(pyEnumBaseDecl(defLines, "StripeSummary"), false);
});

test("pyEnumBaseDecl: false for a class whose base merely CONTAINS 'Enum' as a substring", () => {
  // MyEnumish is not Enum: a substring match here would be a false positive,
  // rendering an ordinary class's fields as fake Type.field enum access.
  const defLines = ["class Weird(MyEnumish):", "    x: int"];
  assert.strictEqual(pyEnumBaseDecl(defLines, "Weird"), false);
});

test("pyEnumBaseDecl: false when the header names a DIFFERENT type", () => {
  const defLines = ["class OtherType(IntEnum):", "    A = 1"];
  assert.strictEqual(pyEnumBaseDecl(defLines, "LodBand"), false);
});

test("pyEnumBaseDecl: false when no line matches a class header at all (unreadable source)", () => {
  assert.strictEqual(pyEnumBaseDecl(["# just a comment", ""], "LodBand"), false);
});

// --- pyShapeHooks.enumMemberLine: the hook itself. --------------------------

const enumMember = (name) => ({ name, kind: "field", signature: undefined });

test("pyShapeHooks.enumMemberLine: renders Type.Variant for a no-signature member of an Enum-declared type", () => {
  const defLines = ["class LodBand(IntEnum):", "    CONTINENTAL = 0"];
  assert.strictEqual(
    pyShapeHooks.enumMemberLine(enumMember("CONTINENTAL"), "LodBand", "class LodBand", defLines),
    "LodBand.CONTINENTAL",
  );
});

test("pyShapeHooks.enumMemberLine: stays dark (undefined) for a dataclass field — the wrong-is-worse-than-absent case", () => {
  const defLines = ["class StripeSummary:", "    aggregate: int", "    tile_tally: int"];
  assert.strictEqual(pyShapeHooks.enumMemberLine(enumMember("aggregate"), "StripeSummary", "class StripeSummary", defLines), undefined);
});

test("pyShapeHooks.enumMemberLine: stays dark for a plain class's ALL_CAPS attribute — the naming-heuristic trap", () => {
  // This is the exact case the documentSymbol-kind approach would have gotten
  // wrong: pyright's own hover calls MAX_RETRIES `(constant)`, same as a real
  // enum variant, purely because it is ALL_CAPS. The source-text check does
  // not fall for it: PlainConfig names no Enum base.
  const defLines = ["class PlainConfig:", "    MAX_RETRIES = 3"];
  assert.strictEqual(pyShapeHooks.enumMemberLine(enumMember("MAX_RETRIES"), "PlainConfig", "class PlainConfig", defLines), undefined);
});

test("pyShapeHooks.enumMemberLine: stays dark for a member that already carries a signature", () => {
  const defLines = ["class LodBand(IntEnum):", "    def describe(self) -> str: ..."];
  const withSig = { name: "describe", kind: "method", signature: "describe(self) -> str" };
  assert.strictEqual(pyShapeHooks.enumMemberLine(withSig, "LodBand", "class LodBand", defLines), undefined);
});

test("pyShapeHooks.enumMemberLine: renders even a real Enum's LOWERCASE variant (the source check does not require ALL_CAPS)", () => {
  const defLines = ["class LowerEnum(Enum):", "    continental = 0"];
  assert.strictEqual(
    pyShapeHooks.enumMemberLine(enumMember("continental"), "LowerEnum", "class LowerEnum", defLines),
    "LowerEnum.continental",
  );
});
