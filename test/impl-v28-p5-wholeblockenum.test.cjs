// The whole-block block must disclose the VARIANTS of an enum the roots reach.
//
// The capture (session-v28, the human's own dogfood run at an empty
// `RegionLodCount(List<Tile>)` body): the block disclosed
//
//   // Tile:
//   // Band : LodBand
//   // class Atlas.Tile
//
// and nothing about what a LodBand is, so the 1.5b could not write
// `tile.Band == LodBand.Regional` and invented `tile.IsRegional()` instead. The
// resolved graph held all four variants at the time; only the render dropped
// them, because the def walk follows FIELD edges and a C# hover has no field
// body, so a type reached through a member's TYPE never appears.
//
// Same law as the repair leg's, at the site the session had not covered: what
// the model cannot see, it invents.
//
// RED before the fix: `renderWholeBlockInjection` took six arguments and the
// seventh is ignored, so every "names the variant" row fails. Proven red against
// a bundle built from HEAD, not asserted.
//
// Run: SKIP_LIVE=1 node --test test/impl-v28-p5-wholeblockenum.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-v28-p5",
  `export { renderWholeBlockInjection } from "../src/core/fimWholeBlock";\n`,
);
test.after(cleanup);
const { renderWholeBlockInjection } = mod;

const BOUNDS = { D_MAX: 2, B_MAX: 4, N_MAX: 6, TOK_MAX: 200 };
const BUDGET = 1200;

// The captured shape, verbatim from a live probe of the real Roslyn server over
// csharp-scratch: Tile's members name LodBand, and LodBand's own members are its
// four variants, already spelled the way a caller has to type them.
const TILE_METHODS = [
  "MortonCode : int",
  "Lod : int",
  "Band : LodBand",
  "SubtendedChildren() : int",
  "Encloses(Tile) : bool",
];
const LODBAND_VARIANTS = [
  "LodBand.Continental",
  "LodBand.Regional",
  "LodBand.Municipal",
  "LodBand.Parcel",
];

const resolveStruct = (name) =>
  name === "Tile"
    ? { def: "class Atlas.Tile", fields: [] }
    : name === "LodBand"
      ? { def: "enum Atlas.LodBand", fields: [] }
      : undefined;
const methodsOf = (name) => (name === "Tile" ? TILE_METHODS : []);

const render = (reached, budget = BUDGET) =>
  renderWholeBlockInjection(["Tile"], resolveStruct, methodsOf, BOUNDS, budget, "//", reached);

test("the captured site: every variant of the reached enum is in the block", () => {
  const block = render([{ type: "LodBand", lines: LODBAND_VARIANTS }]);
  assert.ok(block, "a block must render");
  for (const variant of LODBAND_VARIANTS) {
    assert.ok(
      block.includes(variant),
      `the model can only type a name it can see, and ${variant} is what the human's doc comment asks for; got:\n${block}`,
    );
  }
  assert.ok(
    block.includes("LodBand:"),
    `the variants ride under their own type's anchor, the way a root's members do, or a reader cannot tell whose they are; got:\n${block}`,
  );
});

test("the enum's variants are not attributed to the root", () => {
  const block = render([{ type: "LodBand", lines: LODBAND_VARIANTS }]);
  const lines = block.split("\n").map((l) => l.replace(/^\/\/ ?/, ""));
  const tileAnchor = lines.indexOf("Tile:");
  const lodAnchor = lines.indexOf("LodBand:");
  assert.ok(tileAnchor >= 0 && lodAnchor > tileAnchor, `both anchors present, root first; got:\n${block}`);
  for (const variant of LODBAND_VARIANTS) {
    assert.ok(
      lines.indexOf(variant) > lodAnchor,
      `${variant} must sit under LodBand's anchor, never under Tile's; got:\n${block}`,
    );
  }
});

test("no reached types: the block is byte-identical to the pre-fix render", () => {
  const before = render(undefined);
  const empty = render([]);
  assert.equal(
    empty,
    before,
    "an absent list and an empty one are the same claim, and both must reproduce the block the frozen oracles pin",
  );
  assert.ok(!before.includes("LodBand.Regional"), "nothing invents a variant out of an empty list");
  assert.ok(before.includes("Band : LodBand"), `the root's own members are unchanged; got:\n${before}`);
});

test("a reached type that is also a root is not rendered twice", () => {
  const block = renderWholeBlockInjection(
    ["Tile"],
    resolveStruct,
    methodsOf,
    BOUNDS,
    BUDGET,
    "//",
    [{ type: "Tile", lines: TILE_METHODS }],
  );
  const anchors = block.split("\n").filter((l) => l.replace(/^\/\/ ?/, "") === "Tile:");
  assert.equal(anchors.length, 1, `Tile owns its members once; got:\n${block}`);
});

test("a variant list the budget cuts says how many it dropped", () => {
  // A closed set is the one surface where a silent cut is a lie: the header
  // forbids inventing a name, so a variant that was dropped reads as one that
  // does not exist.
  const many = Array.from({ length: 40 }, (_, i) => `LodBand.Value${i}`);
  const block = render([{ type: "LodBand", lines: many }], 320);
  assert.ok(block, "a block still renders");
  assert.match(
    block,
    /\.\.\. and \d+ more/,
    `a cut list must say it was cut; got:\n${block}`,
  );
});

test("an empty variant list contributes nothing, not an empty anchor", () => {
  const block = render([{ type: "LodBand", lines: [] }]);
  assert.ok(
    !block.includes("LodBand:"),
    `an anchor with nothing under it tells the model a type has no values; got:\n${block}`,
  );
});

test("nothing resolved anywhere still degrades to plain FIM", () => {
  const block = renderWholeBlockInjection(
    ["Nothing"],
    () => undefined,
    () => [],
    BOUNDS,
    BUDGET,
    "//",
    [],
  );
  assert.equal(block, undefined, "no surface means no block, never an empty header");
});
