// Adversarial review: session-v40 item 1, the render-pass budget move in
// src/core/dataShape.ts (walkDataShape / renderDefsWithinBudget).
//
// Both rows here are RED against the shipped change and were found by tracing
// the render-time truncation pass line by line, then confirmed against the
// PRE-v40 walkDataShape (git show HEAD~0:src/core/dataShape.ts, i.e. the
// commit this change is not yet on top of) to establish these are new
// regressions, not pre-existing behavior.
//
// Run: SKIP_LIVE=1 node --test test/review-v40-p1-render-budget.test.cjs

const test = require("node:test");
const assert = require("node:assert/strict");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "review-v40-p1",
  `export { walkDataShape } from "../src/core/dataShape";\n`,
);
const { walkDataShape } = mod;
test.after(cleanup);

function flatDef(name, n) {
  const lines = [`struct ${name} {`];
  for (let i = 0; i < n; i++) lines.push(`    field_${i}: u64,`);
  lines.push("}");
  return lines.join("\n");
}

// ===========================================================================
// [DEFECT] The per-walk TOK_MAX budget is not honored by the walk's own
// returned `block` once 3+ defs are kept whole in one walk.
//
// `renderDefsWithinBudget`'s internal accounting (`lineCost = l => l.length +
// 1`) charges exactly 1 char per LINE, matching a single "\n" join - correct
// for lines WITHIN one def, and correct for fimWholeBlock.ts's own use (which
// joins its whole output with "\n" throughout, never SEP). But
// `walkDataShape` re-joins the KEPT per-def texts with `SEP = "\n\n"` (2
// chars) at line ~407 (`keptDefs.map((d) => d.def).join(SEP)`) - a different,
// WIDER separator than the one the budget accounting assumed between defs.
//
// Net effect, for K whole-kept defs in one walk: the internal accounting
// total is (sum of def lengths) + K (one +1 per def's own first line stands
// in for a separator that never actually costs only 1 char between defs).
// The real joined string is (sum of def lengths) + 2*(K-1) (SEP is 2 chars,
// K-1 gaps). The difference is K-2: for K<=2 the internal accounting is
// still >= actual (safe, just conservative); for K>=3 the internal
// accounting UNDER-counts what the real `block` string costs, so
// `result.block.length` can exceed the caller's own `bounds.TOK_MAX*4` - the
// exact bound this function exists to enforce.
//
// PRE-v40, this could not happen: the walk's own `blockLen` bookkeeping used
// `SEP.length` (2) directly (`addLen = (emitted.length > 0 ? SEP.length : 0)
// + res.def.length`), matching the real join separator exactly. This is a
// NEW regression introduced by moving to a per-LINE accounting model that
// does not know about the def-to-def SEP boundary.
//
// Confirmed via a minimal 3-def case: root R with two flat one-field
// children A and B, TOK_MAX set to the walk's OWN internal accounting total
// (the tightest budget it believes sufficient) - the returned block is 1
// byte longer than that budget allows.
// ===========================================================================
test("[DEFECT] a walk's returned block can exceed its own TOK_MAX*4 budget once 3+ defs are kept whole (SEP vs per-line accounting mismatch)", () => {
  const rootDef = `struct R {\n    a: A,\n    b: B,\n}`;
  const aDef = `struct A {\n    field_0: u64,\n}`;
  const bDef = `struct B {\n    field_0: u64,\n}`;
  const resolve = (name) => {
    if (name === "R") {
      return {
        def: rootDef,
        fields: [
          { name: "a", typeName: "A", isLocal: true },
          { name: "b", typeName: "B", isLocal: true },
        ],
      };
    }
    if (name === "A") return { def: aDef, fields: [] };
    if (name === "B") return { def: bDef, fields: [] };
    return undefined;
  };
  const lineCostSum = (def) => def.split("\n").reduce((c, l) => c + l.length + 1, 0);
  const internalTotal = lineCostSum(rootDef) + lineCostSum(aDef) + lineCostSum(bDef);
  // TOK_MAX chosen so TOK_MAX*4 == the walk's own internal accounting total
  // exactly - the tightest budget the walk itself believes is sufficient.
  const bounds = { D_MAX: 2, B_MAX: 4, N_MAX: 4, TOK_MAX: internalTotal / 4 };
  const result = walkDataShape("R", resolve, bounds);

  // NOTE (post-fix adjustment): the two assertions this comment replaces
  // ("all three kept whole", "nothing dropped") were written against
  // `internalTotal`, the OLD per-line accounting's own belief about what fits
  // - which this defect proves is wrong by exactly 1 byte at K=3 (see the
  // block-length assertion below, the test's actual point). A budget derived
  // from that wrong number is not just "1 byte short of 3 whole defs" - it is
  // short of EVERY combination that keeps all three present, including the
  // cheapest one - which, for a 1-field def like A or B, is keeping the field
  // WHOLE, not a truncated header+marker+close shell (the shell replaces one
  // field line with a longer marker line, so it costs MORE than the field it
  // drops). That cheapest combination is R + A + B all whole, joined by the
  // two-char SEP: 32 + 2 + 30 + 2 + 30 = 96 bytes, 1 over this 95-byte budget.
  // So once the accounting is exact, no allocation can honor
  // this budget AND keep B present in any form - dropping B whole (as
  // `renderDefsWithinBudget` already does when even the shell does not fit)
  // is the correct, unavoidable outcome, not a regression. What must still
  // hold, and does, is the root and the def that fits alongside it staying
  // present, and the block never exceeding the budget - asserted below.
  assert.deepEqual(result.defs.map((d) => d.name), ["R", "A"], "R and A are kept - B alone cannot fit any budget left once R+A are honestly accounted for");
  assert.deepEqual(result.dropped, ["B"], "B is dropped whole (not silently truncated past budget, not silently kept over budget)");
  assert.ok(
    result.block.length <= bounds.TOK_MAX * 4,
    `the walk's own TOK_MAX*4 budget (${bounds.TOK_MAX * 4}) is not honored by its own returned block ` +
      `(${result.block.length} chars, ${result.block.length - bounds.TOK_MAX * 4} over) - the SEP="\\n\\n" ` +
      `join between kept defs costs 2 chars but renderDefsWithinBudget's internal per-line accounting only ` +
      `charged 1 char per def-boundary line, undercounting by (kept defs - 2) once 3+ defs are kept whole. ` +
      `This reaches fn-gen's shapeBlock/tsShapeBlock (src/vscode/fnGen.ts:2572-2573, 2915-2916), which embed ` +
      `walk.block verbatim with no further truncation, and undercounts shared.remainingChars by the same ` +
      `amount every time a walk keeps 3+ defs (dataShape.ts's own "shared.remainingChars -= rendered.total") ` +
      `- FIM's own path is unaffected (fimWholeBlock.ts reads walk.defs only, never walk.block, and does its ` +
      `own SEP-free "\\n"-joined render via renderDefsWithinBudget directly).`,
  );
});

// ===========================================================================
// [DEFECT] Render-time truncation is GREEDY in BFS/discovery order: the first
// discovered oversized def eats as much of the shared render budget as it
// can via truncation, before a LATER, small sibling def in the SAME walk
// ever gets a turn - so a tiny def that would trivially render in FULL can
// end up dropped ENTIRELY, not because it doesn't fit, but because an
// earlier, much larger def (which itself only ends up as a near-empty
// truncated stub) was processed first and consumed the budget getting there.
//
// This is NOT an N_MAX effect - confirmed below with N_MAX=10, generous
// enough that BOTH the huge type (A) and the tiny type (B) are structurally
// discovered without contest. The starvation survives anyway, because
// `renderDefsWithinBudget` (dataShape.ts's Phase B) processes `emitted` in
// discovery order and lets each def claim as much of the REMAINING budget as
// its own truncation loop can use, with no lookahead for what smaller defs
// are still queued behind it.
//
// PRE-v40, this could not happen: an oversized def that breached TOK_MAX was
// excluded WHOLE at walk time, contributing zero bytes, so the entire budget
// was preserved for whatever came after it. v40 turned that exclusion into a
// truncation that still spends up to the full budget on the oversized def's
// own (mostly-dropped) fields, which is strictly worse than the old
// behavior in this shape of case: pre-v40 a human reading the prompt would
// see B's complete, useful 3-field def; post-v40 they see A reduced to
// 15 of 60 fields plus a marker, and B is gone without a trace in the
// rendered text (it does appear in `dropped`, so it is not SILENT by the
// letter of the "no silent truncation" rule - but the outcome average
// USEFULNESS of the rendered surface went down, which is exactly what
// session-v39's item 1 measurement (this session's own justification) was
// trying to move up).
//
// Confirmed by running the SAME scenario (N_MAX=10, non-binding) against
// pre-v40 dataShape.ts (git show HEAD:src/core/dataShape.ts, bundled
// standalone): OLD code emits [R, B] in FULL (drops A, the oversized type,
// whole, contributing 0 bytes); NEW code emits [R, A-truncated-to-15-of-60-
// fields] and drops B entirely, even though B's full 66-char def is smaller
// than the single-digit number of bytes A's truncation leaves unused.
// ===========================================================================
test("[DEFECT] an oversized def processed first can greedily consume the render budget and starve out a small sibling that would have rendered whole - not an N_MAX effect", () => {
  const rootDef = `struct R {\n    a: A,\n    b: B,\n}`;
  const aDef = flatDef("A", 60); // huge: will be truncated hard by the render pass
  const bDef = flatDef("B", 3); // tiny: would trivially fit whole

  const resolve = (name) => {
    if (name === "R") {
      return {
        def: rootDef,
        fields: [
          { name: "a", typeName: "A", isLocal: true },
          { name: "b", typeName: "B", isLocal: true },
        ],
      };
    }
    if (name === "A") return { def: aDef, fields: [] };
    if (name === "B") return { def: bDef, fields: [] };
    return undefined;
  };

  // N_MAX = 10: generous, non-binding - both A and B are structurally
  // discovered without contest. Budget is generous too - big enough for R +
  // a truncated A shell + all of B, with room to spare - so neither
  // structural cap is why B ends up absent; only the greedy render order is.
  const budgetChars = rootDef.length + 200 + bDef.length + 50;
  const bounds = { D_MAX: 2, B_MAX: 4, N_MAX: 10, TOK_MAX: Math.ceil(budgetChars / 4) };
  const result = walkDataShape("R", resolve, bounds);

  const names = result.defs.map((d) => d.name);
  const gotB = names.includes("B");
  assert.ok(
    gotB,
    `B (3 fields, ${bDef.length} chars) is starved out entirely by A (60 fields, truncated to a near-empty ` +
      `stub) purely because A was processed first in the render pass (Phase B, discovery/BFS order) and greedily ` +
      `consumed the render budget before B's turn, with N_MAX=10 never binding on either type. ` +
      `emitted=${JSON.stringify(names)}, dropped=${JSON.stringify(result.dropped)}, block used ${result.block.length} ` +
      `of ${budgetChars} available budget chars - only ${budgetChars - result.block.length} chars were left once ` +
      `A's own greedy truncation finished, too few for B's ${bDef.length}-char def, even though the budget was ` +
      `sized with B's full def in mind (rootDef.length + 200 slack + B.length + 50 slack) on the assumption that ` +
      `an oversized type would still be excluded whole, the way it was pre-v40. Pre-v40, A would have been ` +
      `TOK_MAX-dropped whole at walk time, contributing 0 bytes and leaving the full budget for B (verified ` +
      `against git show HEAD:src/core/dataShape.ts, which emits [R, B] in FULL on this exact N_MAX=10 scenario).`,
  );
});
