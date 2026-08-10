// Second-loop adversarial review: session-v40 item 1 (render-pass budget move,
// src/core/dataShape.ts). The implementer self-reported LOW CONFIDENCE in one
// specific claim: that renderDefsWithinBudget's internal accounting always
// carries a constant "+1 unused trailing separator" offset regardless of def
// count or truncation pattern, removed exactly once when `sepCost` is passed -
// verified by hand against ONE concrete 3-def case, not swept.
//
// This file sweeps: def count (1,2,3,4,5,8), def-size pattern (uniform small,
// uniform huge, ascending, descending, random-seeded), and budget (from tighter
// than the root alone to far more generous than every def combined). For every
// resulting case it asserts the two invariants Finding 2 was actually about:
//   1. result.block.length <= bounds.TOK_MAX * 4 (the walk's own declared
//      per-walk budget is never exceeded by what it actually returns).
//   2. result.block === result.defs.map(d => d.def).join("\n\n") (block and
//      defs never silently disagree with each other).
//
// Run: SKIP_LIVE=1 node --test test/review-v40-p2-render-budget-property.test.cjs

const test = require("node:test");
const assert = require("node:assert/strict");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "review-v40-p2-property",
  `export { walkDataShape } from "../src/core/dataShape";\n`,
);
const { walkDataShape } = mod;
test.after(cleanup);

// Deterministic seeded PRNG (mulberry32) - reproducible sweep, no external dep.
function mulberry32(seed) {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function flatDef(name, n) {
  const lines = [`struct ${name} {`];
  for (let i = 0; i < n; i++) lines.push(`    field_${i}: u64,`);
  lines.push("}");
  return lines.join("\n");
}

// Build a root with (numDefs - 1) flat children, each sized per `sizeFor(i)`
// fields. Root itself always has one field per child (small, fixed shape).
function buildCase(numDefs, sizeFor) {
  const childCount = numDefs - 1;
  const childNames = Array.from({ length: childCount }, (_, i) => `C${i}`);
  const rootLines = [`struct R {`, ...childNames.map((c, i) => `    f${i}: ${c},`), `}`];
  const rootDef = rootLines.join("\n");
  const childDefs = new Map(childNames.map((c, i) => [c, flatDef(c, sizeFor(i))]));

  const resolve = (name) => {
    if (name === "R") {
      return {
        def: rootDef,
        fields: childNames.map((c, i) => ({ name: `f${i}`, typeName: c, isLocal: true })),
      };
    }
    if (childDefs.has(name)) {
      return { def: childDefs.get(name), fields: [] };
    }
    return undefined;
  };

  const wholeTotal = rootDef.length + [...childDefs.values()].reduce((s, d) => s + d.length, 0) + 2 * childCount;
  return { resolve, wholeTotal };
}

const sizePatterns = {
  uniformSmall: () => 1,
  uniformHuge: () => 50,
  ascending: (i) => 1 + i * 4,
  descending: (i, n) => 1 + (n - 1 - i) * 4,
  randomSeeded: (i, n, rng) => Math.floor(rng() * 40),
};

const numDefsList = [1, 2, 3, 4, 5, 8];
// Budget multipliers relative to the fully-whole total size of the case
// (wholeTotal computed above): from far tighter than even the root, to far
// more generous than everything combined.
const budgetMultipliers = [0.02, 0.1, 0.25, 0.5, 0.75, 0.95, 1.0, 1.2, 2.0, 10.0];

let swept = 0;
const failures = [];

for (const numDefs of numDefsList) {
  for (const [patternName, sizeFor] of Object.entries(sizePatterns)) {
    const rng = mulberry32(numDefs * 1000 + patternName.length);
    const { resolve, wholeTotal } = buildCase(numDefs, (i) => sizeFor(i, numDefs - 1, rng));
    for (const mult of budgetMultipliers) {
      const budgetChars = Math.max(1, Math.round(wholeTotal * mult));
      const TOK_MAX = budgetChars / 4;
      const bounds = { D_MAX: 3, B_MAX: numDefs + 2, N_MAX: numDefs + 2, TOK_MAX };
      const result = walkDataShape("R", resolve, bounds);
      swept++;

      const expectedBlock = result.defs.map((d) => d.def).join("\n\n");
      const overBudget = result.block.length > bounds.TOK_MAX * 4;
      const disagree = result.block !== expectedBlock;
      if (overBudget || disagree) {
        failures.push({
          numDefs,
          patternName,
          mult,
          budgetChars,
          tokMax4: bounds.TOK_MAX * 4,
          blockLength: result.block.length,
          overBudget,
          disagree,
          names: result.defs.map((d) => d.name),
          dropped: result.dropped,
        });
      }
    }
  }
}

test(`[PROPERTY] result.block never exceeds bounds.TOK_MAX*4, across ${swept} generated (numDefs x sizePattern x budget) cases`, () => {
  assert.deepEqual(
    failures.filter((f) => f.overBudget),
    [],
    `found a case where block.length > TOK_MAX*4: ${JSON.stringify(failures.filter((f) => f.overBudget), null, 2)}`,
  );
});

test(`[PROPERTY] result.block === result.defs.map(d => d.def).join("\\n\\n") in every generated case`, () => {
  assert.deepEqual(
    failures.filter((f) => f.disagree),
    [],
    `found a case where block disagrees with defs.join(SEP): ${JSON.stringify(failures.filter((f) => f.disagree), null, 2)}`,
  );
});

test(`[PROPERTY] sweep coverage sanity - swept a nontrivial number of cases`, () => {
  assert.strictEqual(swept, numDefsList.length * Object.keys(sizePatterns).length * budgetMultipliers.length);
  assert.ok(swept >= 250, `expected a wide sweep, got ${swept} cases`);
});
