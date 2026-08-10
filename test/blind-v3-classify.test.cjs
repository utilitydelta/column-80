// Blind oracle: classifyHallucination v3 spine (E0425/E0412 invented-item and
// E0433 disambiguation) against the FROZEN phase-1 contract
// [session-v3/phase1-classifier-contract.md]. Pure over one Diagnostic (the
// compilerOracle shape) plus an optional CrateResolution: the real rustc
// messages captured in test/fixtures/rustc/v3-classify/ map to their class,
// with the crate/item/module/feature and the cursor derived from the primary
// span. E0433 "cannot find X in Y" needs the resolution to disambiguate a
// gated module (needs-feature) from a typo in an installed crate (wrong-item)
// from a local path (undefined); without resolution it is undefined. Adding
// resolution never changes the existing E0599/E0432/E0433-bare classes. Never
// read src/**; expected red on the stub that predates the new templates.
//
// Run: SKIP_LIVE=1 node --test test/blind-v3-classify.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "blind-v3-classify",
  `export { classifyHallucination } from "../src/core/compilerDirected";\n`
);
const { classifyHallucination } = mod;
test.after(cleanup);

// A primary span at line 17, column 17 (1-based, rustc's own coordinates). The
// contract derives the cursor as { line: lineStart - 1, character: columnStart
// - 1 }, so this span pins the cursor at { line: 16, character: 16 }. The real
// captures sit at other coordinates; the cursor rule is span-driven, so this
// one span exercises it uniformly across every case.
const primarySpan = (over = {}) => ({
  fileName: "src/main.rs",
  byteStart: 0,
  byteEnd: 0,
  lineStart: 17,
  lineEnd: 17,
  columnStart: 17,
  columnEnd: 20,
  isPrimary: true,
  ...over,
});
const CURSOR = { line: 16, character: 16 };

// One Diagnostic in the compilerOracle shape. Defaults carry a single primary
// span so a case that omits `spans` still has a cursor to derive.
const diag = (over = {}) => ({
  kind: "compile-error",
  level: "error",
  code: undefined,
  message: "",
  spans: [primarySpan()],
  suggestions: [],
  ...over,
});

// A CrateResolution stub: a plain JS object with the two contract methods.
// `installed` is the set of installed-crate names; `gates` maps "crate::mod"
// to the public feature that cfg-gates that top-level module. Anything not in
// `gates` returns undefined (not a feature-gated module), matching the shape
// the classifier is promised.
const resolution = (spec = {}) => {
  const installed = new Set(spec.installed ?? []);
  const gates = spec.gates ?? {};
  return {
    isInstalledCrate: (crate) => installed.has(crate),
    gatingFeature: (crate, mod) => gates[`${crate}::${mod}`],
  };
};

// Ground-truth message strings are byte-for-byte the `message` field of the
// captures in test/fixtures/rustc/v3-classify/ (backticks included). The
// module-path and E0412 shapes the contract names but that were not captured
// are constructed in the same template.
const cases = [
  // --- E0425 / E0412 invented item in a real crate -> wrong-item -----------
  {
    name: "E0425 type in crate -> wrong-item{crate:Y, item:X} (real InventedType/fastbloom capture)",
    diagnostic: diag({ code: "E0425", message: "cannot find type `InventedType` in crate `fastbloom`" }),
    expected: { kind: "wrong-item", crate: "fastbloom", item: "InventedType", cursor: CURSOR },
  },
  {
    name: "E0425 function in crate -> wrong-item{crate:Y, item:X} (real invented_fn/fastbloom capture)",
    diagnostic: diag({ code: "E0425", message: "cannot find function `invented_fn` in crate `fastbloom`" }),
    expected: { kind: "wrong-item", crate: "fastbloom", item: "invented_fn", cursor: CURSOR },
  },
  {
    name: "E0425 value namespace in crate -> wrong-item (NS is not part of the class, Y/X are)",
    diagnostic: diag({ code: "E0425", message: "cannot find value `INVENTED` in crate `fastbloom`" }),
    expected: { kind: "wrong-item", crate: "fastbloom", item: "INVENTED", cursor: CURSOR },
  },
  {
    name: "E0412 type in crate -> wrong-item (E0412 shares the invented-item-in-crate template)",
    diagnostic: diag({ code: "E0412", message: "cannot find type `Nope` in crate `serde`" }),
    expected: { kind: "wrong-item", crate: "serde", item: "Nope", cursor: CURSOR },
  },
  {
    name: "E0425 item in module A::B -> wrong-item{crate: first segment A, item:X}",
    diagnostic: diag({ code: "E0425", message: "cannot find function `invented` in module `object_store::aws`" }),
    expected: { kind: "wrong-item", crate: "object_store", item: "invented", cursor: CURSOR },
  },
  {
    name: "E0425 item in deeper module A::B::C -> wrong-item keeps first segment A as crate",
    diagnostic: diag({ code: "E0425", message: "cannot find type `Missing` in module `tokio::sync::mpsc`" }),
    expected: { kind: "wrong-item", crate: "tokio", item: "Missing", cursor: CURSOR },
  },
  {
    name: "E0425 item in this scope -> undefined (qualify/plain-repair case; classifier does NOT own it)",
    diagnostic: diag({ code: "E0425", message: "cannot find type `UndefinedLocalType` in this scope" }),
    expected: undefined,
  },

  // --- E0433 "cannot find X in Y" -> disambiguate (needs resolution) --------
  {
    name: "E0433 X in Y, gatingFeature(Y,X) returns a feature -> needs-feature (real aws/object_store capture)",
    diagnostic: diag({ code: "E0433", message: "cannot find `aws` in `object_store`" }),
    resolution: resolution({ installed: ["object_store"], gates: { "object_store::aws": "aws" } }),
    expected: { kind: "needs-feature", crate: "object_store", module: "aws", feature: "aws", cursor: CURSOR },
  },
  {
    name: "E0433 X in Y, no gating feature but Y is installed -> wrong-item (real NotAThing/object_store capture)",
    diagnostic: diag({ code: "E0433", message: "cannot find `NotAThing` in `object_store`" }),
    resolution: resolution({ installed: ["object_store"] }),
    expected: { kind: "wrong-item", crate: "object_store", item: "NotAThing", cursor: CURSOR },
  },
  {
    name: "E0433 X in Y, Y neither gated nor installed -> undefined (local module path rides plain repair)",
    diagnostic: diag({ code: "E0433", message: "cannot find `NotAThing` in `object_store`" }),
    resolution: resolution({}),
    expected: undefined,
  },
  {
    name: "E0433 X in Y with resolution ABSENT (one-arg) -> undefined (cannot disambiguate without cfg-scan)",
    diagnostic: diag({ code: "E0433", message: "cannot find `aws` in `object_store`" }),
    // no resolution field: called one-arg
    expected: undefined,
  },

  // --- E0433 bare "module or crate X in this scope" -> unresolved-crate -----
  {
    name: "E0433 module-or-crate in this scope -> unresolved-crate (real totally_absent_crate capture)",
    diagnostic: diag({ code: "E0433", message: "cannot find module or crate `totally_absent_crate` in this scope" }),
    // Adding a resolution that installs nothing must not change the class.
    resolution: resolution({}),
    alsoWithoutResolution: true,
    expected: { kind: "unresolved-crate", crate: "totally_absent_crate", cursor: CURSOR },
  },

  // --- Backward compatibility: resolution never changes existing classes ---
  {
    name: "E0599 method -> unresolved-method, same class whether resolution is passed or not",
    diagnostic: diag({
      code: "E0599",
      message: "no method named `add` found for struct `BloomFilter<S>` in the current scope",
    }),
    resolution: resolution({ installed: ["fastbloom"], gates: { "fastbloom::add": "extra" } }),
    alsoWithoutResolution: true,
    expected: { kind: "unresolved-method", member: "add", type: "BloomFilter<S>", cursor: CURSOR },
  },
  {
    // The COMMON needs-feature trigger: a generated body imports a crate API
    // reaching for a cfg-gated module, so rustc reports E0432 truncated to the
    // first unresolvable segment -> the gated module is the LAST segment.
    // gatingFeature(first, last) hits -> needs-feature, exactly like E0433 X-in-Y.
    name: "E0432 import whose last segment is a gated module -> needs-feature (real object_store::aws import shape)",
    diagnostic: diag({ code: "E0432", message: "unresolved import `object_store::aws`" }),
    resolution: resolution({ installed: ["object_store"], gates: { "object_store::aws": "aws" } }),
    expected: { kind: "needs-feature", crate: "object_store", module: "aws", feature: "aws", cursor: CURSOR },
  },
  {
    // Resolution only PROMOTES an E0432 import to needs-feature for a real
    // gated module; an invented type stays wrong-item. buildGatingFeatures only
    // ever gates cfg-gated top-level modules (aws, azure), never a type, so a
    // resolution that installs the crate but gates nothing (or only an
    // unrelated module) leaves the class identical with and without resolution.
    name: "E0432 import of an invented item -> wrong-item, same class whether resolution is passed or not",
    diagnostic: diag({ code: "E0432", message: "unresolved import `fastbloom::Bloom`" }),
    resolution: resolution({ installed: ["fastbloom"], gates: { "fastbloom::aws": "aws" } }),
    alsoWithoutResolution: true,
    expected: { kind: "wrong-item", crate: "fastbloom", item: "Bloom", cursor: CURSOR },
  },

  // --- No primary span -> undefined for the new templates too --------------
  {
    name: "E0425 in-crate message but spans empty -> undefined: no primary span, nowhere to derive a cursor",
    diagnostic: diag({
      code: "E0425",
      message: "cannot find type `InventedType` in crate `fastbloom`",
      spans: [],
    }),
    expected: undefined,
  },
  {
    name: "E0433 X in Y message but only a non-primary span -> undefined even with a resolving resolution",
    diagnostic: diag({
      code: "E0433",
      message: "cannot find `aws` in `object_store`",
      spans: [primarySpan({ isPrimary: false })],
    }),
    resolution: resolution({ installed: ["object_store"], gates: { "object_store::aws": "aws" } }),
    expected: undefined,
  },
];

for (const { name, diagnostic, resolution: res, expected, alsoWithoutResolution } of cases) {
  test(name, () => {
    const actual = res === undefined
      ? classifyHallucination(diagnostic)
      : classifyHallucination(diagnostic, res);
    assert.deepStrictEqual(actual, expected);
    // Invariance cases pin that the one-arg (pre-resolution) call is identical:
    // adding resolution to an existing class must not perturb it.
    if (alsoWithoutResolution) {
      assert.deepStrictEqual(classifyHallucination(diagnostic), expected);
    }
  });
}
