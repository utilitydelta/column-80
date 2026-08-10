// IMPLEMENTER test for csShapeGraphBlock — the pure core of the C# pre-fill
// render. Dogfood capture: round-1 injected only `Members of Stripe` (the ROOT),
// never the recursively-resolved collaborators, so the model saw `EnrollTile(Tile)`
// but no `Tile` constructor and invented `Enroll(1, 0)`. The render must emit the
// WHOLE resolved graph (Fix 3), skip method-less types, and dedup via the shared
// visited set.
//
// It used to drop `_`-prefixed members here too. That was a naming convention
// standing in for the accessibility modifier, which session-v24 phase 2 made
// readable upstream over structured members (src/core/memberVisibility.ts); the
// stand-in was RETIRED rather than narrowed, because two filters answering the
// same question hide real API between them — a `public long _RollActive()` is
// public whatever it is called — and because narrowing it to "fields only" would
// mean classifying a member by looking for parens in its rendered signature,
// after the structured kind was thrown away. The rows below now pin that this
// renderer renders what it is handed.
//
// Run: SKIP_LIVE=1 node --test test/impl-goalmd-csshapeblock.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-goalmd-csshapeblock",
  `export { csShapeGraphBlock } from "../src/core/csExtraction";\n`,
);
test.after(() => cleanup());
const { csShapeGraphBlock } = mod;

// The real resolved Stripe graph (probed live), root first: Stripe (with private
// fields), Tile (WITH its constructor), and two method-less types.
const GRAPH = [
  { name: "Stripe", methods: [
    "_tiles : List<Tile>",
    "_seenCodes : HashSet<int>",
    "EnrollTile(Tile) : bool",
    "AggregateFanout() : int",
    "PartitionByLod() : IReadOnlyDictionary<int, List<Tile>>",
    "TileTally : int",
    "Summarize(string?) : StripeSummary",
  ] },
  { name: "Tile", methods: [
    "Tile(int, int)", "MortonCode : int", "Lod : int", "Band : LodBand",
    "SubtendedChildren() : int", "Encloses(Tile) : bool",
  ] },
  { name: "StripeSummary", methods: [] },
  { name: "LodBand", methods: [] },
];

const opts = () => ({ memberCap: 32, fence: "```", visited: new Set(), budget: { remaining: 100000 } });

test("emits the RECURSIVE graph: Tile's block (with its constructor) rides alongside Stripe's", () => {
  const out = csShapeGraphBlock(GRAPH, opts());
  assert.ok(out, "a block is produced");
  assert.ok(out.includes("Members of `Stripe`"), "the root type's block");
  assert.ok(out.includes("Members of `Tile`"), "the collaborator Tile's block is emitted (Fix 3)");
  assert.ok(out.includes("Tile(int, int)"), "Tile's CONSTRUCTOR is in the surface — the model can now build a Tile");
  assert.ok(out.includes("EnrollTile(Tile) : bool"), "Stripe's real method");
});

test("renders what it is handed: the `_`-prefix stand-in is retired, so the name no longer overrules the modifier", () => {
  const out = csShapeGraphBlock(GRAPH, opts());
  assert.ok(out.includes("_tiles"), "no name-shaped filter survives here");
  assert.ok(out.includes("_seenCodes"), "the same for the second one");
  // Where those two actually leave now: the visibility pass, over structured
  // members carrying their declaration lines, before anything is rendered.
  // `private readonly List<Tile> _tiles;` says private; the name says nothing.
});

test("skips method-less types (an empty record/enum is not a block)", () => {
  const out = csShapeGraphBlock(GRAPH, opts());
  assert.ok(!out.includes("Members of `StripeSummary`"), "a method-less type renders no block");
  assert.ok(!out.includes("Members of `LodBand`"), "the enum renders no block");
});

test("dedups against the shared visited set", () => {
  const o = opts();
  const first = csShapeGraphBlock(GRAPH, o);
  assert.ok(first.includes("Members of `Tile`"), "Tile emitted the first time");
  // A second render sharing the same visited set must not re-emit already-seen types.
  const second = csShapeGraphBlock(GRAPH, o);
  assert.strictEqual(second, undefined, "every type already emitted -> no duplicate block");
});

test("the member cap truncates and reports the honest subset", () => {
  const wide = [{ name: "Big", methods: Array.from({ length: 40 }, (_, i) => `M${i}() : int`) }];
  let truncatedTotal;
  const out = csShapeGraphBlock(wide, { memberCap: 32, fence: "```", visited: new Set(), budget: { remaining: 100000 }, onTruncate: (n, total) => { truncatedTotal = total; } });
  assert.ok(out.includes("a subset — the first 32 of 40"), "the header states the honest subset");
  assert.strictEqual(truncatedTotal, 40, "onTruncate reports the real total");
});
