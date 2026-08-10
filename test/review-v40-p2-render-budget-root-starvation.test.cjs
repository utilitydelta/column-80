// Second-loop adversarial review: session-v40 item 1 (render-pass budget move,
// src/core/dataShape.ts). Finding 1's original fix (preferWholeFirst two-pass
// allocator) was validated against a 2-child repro (root + big A + small B),
// where the ROOT itself was always small and always won pass 1. This file
// checks a shape the 2-child repro could never expose: the ROOT ITSELF is the
// oversized def, competing against several small children that each fit whole.
//
// [DEFECT] Because `renderDefsWithinBudget` runs pass 1 (whole-fits-only, in
// given order) across ALL of a walk's discovered defs with no special-casing
// for the root, an oversized root that cannot fit whole is deferred past pass
// 1 while its own smaller children (queued right behind it in BFS/discovery
// order) win pass 1 and spend the budget. By the time pass 2 gets to the root,
// there is nothing left - not even room for a bare truncated shell - so the
// root is dropped ENTIRELY while unrelated children survive in full.
//
// PRE-v40, this could not happen: a root that breached TOK_MAX was dropped at
// walk time BEFORE its children were ever enqueued (the emit-then-enqueue
// order in the old per-node loop), so a dropped root always meant an EMPTY
// walk (defs=[], dropped=[root]) - never a walk whose block is populated with
// the root's own children while the root itself is nowhere in it. Confirmed
// by running the identical scenario through `git show HEAD:src/core/dataShape.ts`
// (bundled standalone): OLD code returns defs=[] dropped=['R'] at the same
// budget where NEW code returns defs=['S0','S1','S2'] dropped=['R','S3','S4','S5'].
//
// This matters because the caller (src/vscode/fnGen.ts:2572-2573, 2915-2916)
// embeds `walk.block` verbatim under the header "Data shape of `${type}`" -
// with this defect, that header can now name a type whose own definition is
// completely absent from the block underneath it, while the block instead
// shows unrelated field-types the reader has no way to attribute back to the
// named root (its own def, which would carry the field names connecting them,
// isn't there).
//
// Run: SKIP_LIVE=1 node --test test/review-v40-p2-render-budget-root-starvation.test.cjs

const test = require("node:test");
const assert = require("node:assert/strict");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "review-v40-p2-root-starvation",
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

test("[DEFECT] the walk's own ROOT can be dropped entirely while its smaller children survive, when the root itself needs truncation", () => {
  const rootDef = flatDef("R", 20); // needs truncation at the budgets below
  const children = Array.from({ length: 6 }, (_, i) => [`S${i}`, flatDef(`S${i}`, 3)]);

  const resolve = (name) => {
    if (name === "R") {
      return { def: rootDef, fields: children.map(([n]) => ({ name: n, typeName: n, isLocal: true })) };
    }
    const c = children.find(([n]) => n === name);
    return c ? { def: c[1], fields: [] } : undefined;
  };

  const wholeTotal = rootDef.length + children.reduce((s, [, d]) => s + d.length, 0) + 2 * children.length;
  const budgetChars = Math.round(wholeTotal * 0.3); // enough for 2-3 small children whole, not enough left for root's own shell after they win pass 1
  const bounds = { D_MAX: 2, B_MAX: 10, N_MAX: 10, TOK_MAX: budgetChars / 4 };
  const result = walkDataShape("R", resolve, bounds);

  const names = result.defs.map((d) => d.name);
  const rootPresent = names.includes("R");
  const someChildPresent = children.some(([n]) => names.includes(n));
  assert.ok(
    rootPresent || !someChildPresent,
    `the walk's own root ("R") was dropped entirely while these children survived in full: ` +
      `${JSON.stringify(names)} (dropped=${JSON.stringify(result.dropped)}). Pre-v40, a dropped root always meant ` +
      `an EMPTY walk (children are never enqueued before the root's own TOK_MAX check) - this walk's block now ` +
      `renders ${result.block.length} chars entirely about types OTHER than the one it was asked to describe, ` +
      `with zero mention of R itself. block=${JSON.stringify(result.block)}`,
  );
});
