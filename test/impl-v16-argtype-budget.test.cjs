// The argument-type leg's BUDGET behaviour, driven through the real
// `resolveArgTypesInBudget` in src/core/argTypeSurface.ts.
//
// Why this file exists. The leg runs inside a 50ms per-keystroke injection
// window that the receiver's own member resolution has already spent most of.
// What it does when that window runs out is therefore not an edge case, it is
// the common case, and it was untested: the leg lived in a private provider
// method, so no test in this repo could reach it and the timeout path was
// graded by nothing.
//
// The invariant under test is PARTIAL PROGRESS. `membersWithHoverSignatures`
// one layer down is built so members that answered keep their signatures,
// because an all-or-nothing timeout throws away work already paid for. The same
// must hold across argument types: a first type that resolved inside the budget
// is a construction surface the caller cannot re-derive before the keystroke
// expires, so a second, slower type must not take it down with it.
//
// The extractor here is a fake with a controllable per-type delay. That is the
// only way to make a deadline test deterministic; the real-server end of this
// invariant is graded by the VS Code tier.
//
// Run: SKIP_LIVE=1 node --test test/impl-v16-argtype-budget.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore, sleep } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-v16-argtype-budget",
  `export { resolveArgTypesInBudget, argTypeMinBudgetMs, MAX_ARG_TYPES } from "../src/core/argTypeSurface";\n`
);
const { resolveArgTypesInBudget, argTypeMinBudgetMs, MAX_ARG_TYPES } = mod;
test.after(cleanup);

// A TypeScript member site whose candidate takes two user types as arguments,
// so the leg has two to resolve and `MAX_ARG_TYPES` admits both.
const CANDIDATES = [{ name: "enrollTile", kind: "method", signature: "enrollTile(tile: Tile, band: LodBand): boolean" }];

// Both types are MENTIONED in code, so `findArgTypeAnchor` finds a reference for
// each and the leg reaches `definition()` for both.
const SOURCE = {
  uri: "file:///w/fim.ts",
  languageId: "typescript",
  text: ["import { Tile, LodBand } from './atlas';", "const t: Tile = mk();", "const b: LodBand = t.band;", ""].join("\n"),
};

const memberOf = (type) => [{ name: `${type}_member`, kind: "method", signature: `${type}_member(): void` }];

// Every `SurfaceExtractor` primitive the leg can touch, with a per-type delay on
// the one round trip that dominates. A fake that simply omits a primitive
// silently blesses any composition that never calls it, so the absent ones throw
// rather than returning undefined.
function extractorWithDelays(delaysByType) {
  const absent = (name) => () => {
    throw new Error(`the leg called ${name}, which this fake does not model`);
  };
  const typeAt = (cursor) => cursor.uri.slice(cursor.uri.lastIndexOf("/") + 1).replace(".def", "");
  return {
    completeMembers: absent("completeMembers"),
    hoverSurface: absent("hoverSurface"),
    example: absent("example"),
    qualifyImport: absent("qualifyImport"),
    // The leg anchors on a reference and asks definition() to turn it into a
    // definition cursor. The fake encodes the type name in the definition uri so
    // membersOfType can charge that type's delay.
    definition: async (cursor) => {
      // Read the identifier AT the anchor character, not merely somewhere on the
      // line: `import { Tile, LodBand }` names both, and matching the line would
      // charge every type the first one's delay.
      const at = SOURCE.text.split("\n")[cursor.line].slice(cursor.character);
      const type = Object.keys(delaysByType).find((t) => at.startsWith(t));
      if (!type) return undefined;
      return { uri: `file:///w/${type}.def`, range: { startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 0 } };
    },
    membersOfType: async (defCursor) => {
      const type = typeAt(defCursor);
      await sleep(delaysByType[type] ?? 0);
      return memberOf(type);
    },
  };
}

test("resolveArgTypesInBudget: both types land when the budget covers both", async () => {
  const out = await resolveArgTypesInBudget(
    extractorWithDelays({ Tile: 5, LodBand: 5 }),
    SOURCE,
    CANDIDATES,
    400,
  );
  assert.deepStrictEqual(
    out.map((t) => t.name),
    ["Tile", "LodBand"],
    "with room to spare the leg must resolve every argument type it names, in first-appearance order",
  );
  assert.ok(out.length <= MAX_ARG_TYPES, `the leg resolved ${out.length} types, past MAX_ARG_TYPES=${MAX_ARG_TYPES}`);
});

test("resolveArgTypesInBudget: a type that COMPLETED inside the budget survives a later type overrunning it", async () => {
  // Tile answers immediately; LodBand cannot answer inside any plausible
  // keystroke window. The budget is wide enough for Tile and nowhere near wide
  // enough for both.
  const out = await resolveArgTypesInBudget(
    extractorWithDelays({ Tile: 0, LodBand: 3000 }),
    SOURCE,
    CANDIDATES,
    120,
  );
  assert.deepStrictEqual(
    out.map((t) => t.name),
    ["Tile"],
    "the leg discarded a construction surface that resolved INSIDE its budget because a later type overran. " +
    "That is the all-or-nothing timeout `withinBudget` one layer down exists to avoid: the caller cannot " +
    "re-derive Tile's surface before the keystroke expires, so the block renders without the arity the whole " +
    "feature was built to state.",
  );
});

test("resolveArgTypesInBudget: the whole call still returns inside its budget when nothing answers", async () => {
  const startedAt = Date.now();
  const out = await resolveArgTypesInBudget(
    extractorWithDelays({ Tile: 3000, LodBand: 3000 }),
    SOURCE,
    CANDIDATES,
    60,
  );
  const elapsed = Date.now() - startedAt;
  assert.deepStrictEqual(out, [], "no type answered, so there is no surface to report");
  // Budget plus slip, not a multiple of it. The old bound was `60 * 3` and
  // admitted 179ms, so it would have passed a 119ms overrun of exactly the kind
  // this test names in its own message. Nothing here touches a real server: both
  // types are stubbed to hang for 3000ms, so the only thing between the budget
  // expiring and this line is timer slip on the node event loop. Measured over 5
  // hermetic runs on an idle box: 59, 61, 59, 60, 60. 15ms of headroom covers a
  // loaded CI worker and still fails any overrun big enough to lose a keystroke.
  assert.ok(
    elapsed < 60 + 15,
    `the leg took ${elapsed}ms against a 60ms budget. It runs per keystroke inside a 50ms injection window; ` +
    "overrunning it loses the receiver block and the enforcement set as well as the argument types.",
  );
});

// The floor is per-language, so the number this asserts against comes from the
// source's own languageId rather than a single shared constant.
test("resolveArgTypesInBudget: a budget below the floor is refused without a round trip", async () => {
  let asked = 0;
  const counting = extractorWithDelays({ Tile: 0, LodBand: 0 });
  const wrapped = { ...counting, definition: async (c) => { asked++; return counting.definition(c); } };
  const out = await resolveArgTypesInBudget(wrapped, SOURCE, CANDIDATES, argTypeMinBudgetMs(SOURCE.languageId) - 1);
  assert.deepStrictEqual(out, []);
  assert.strictEqual(asked, 0, "below the floor the leg must cost nothing, not start work it cannot finish");
});
