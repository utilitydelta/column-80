// ADVERSARIAL REVIEW - session-v46 phase 0 (contract-phase0b.md).
//
// RED BY DESIGN until triage rules. Phase 0b moved DATASHAPE_TOTAL_TOK into
// src/core/budgetProfile.ts and made fnGen's module-level DATASHAPE_BOUNDS
// spell its TOK_MAX as `walkTokMaxFor(DATASHAPE_TOTAL_TOK)` instead of the
// literal 200. The rig's bundle-rewrite loaders in lib-core.cjs patch these
// constants by exact text match, and the seam changed what they find:
//
//  - loadPrefillWide: WIDE_PATCHES' DATASHAPE_BOUNDS pattern (literal
//    `TOK_MAX: 200`) no longer matches; the loader THROWS. Loud, so no wrong
//    number ships, but the ceiling-arm loader is dead until repointed.
//  - loadPrefillBudget(totalTok, tokMax>0): same site, same miss, THROWS.
//  - loadPrefillBudget(totalTok, 0): the documented contract is "leave the
//    per-walk cap at the shipped value and attribute the aggregate alone".
//    Post-seam the aggregate patch drags TOK_MAX with it through
//    `walkTokMaxFor` (and memberCap through `budgetProfileFor`), so an
//    aggregate-only rung silently measures a different arm - the one failure
//    mode lib-core's own comments exist to prevent, and the only SILENT one
//    of the three.
//
// v46's own runner (run-arm.cjs) uses loadPrefillCapBudget, which still works
// and now deliberately moves the deriveds with the knob - these rows are about
// the OTHER loaders, whose v40/v45 ladder semantics changed underneath them.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

// THE RIG LIVES IN A DIFFERENT REPOSITORY (2026-08-10). The measurement harness
// and its session archives were moved to a private repo, because they carry
// corpora taken against private client code and cannot be published. This file
// exercises the rig's own loaders, so on a public clone there is nothing to
// exercise and every row here skips with that reason on the channel.
//
// It SKIPS rather than passes vacuously, and it skips rather than being deleted:
// the rows are real and they run wherever the rig is checked out beside the
// product. A row that quietly passed when its subject was absent would be the
// false green this suite exists to prevent. Roadmap item 22 owns the wider
// version of this problem, which is shipped source citing paths a clone does
// not have.
const SPIKES = path.join(__dirname, "..", "session-complxity-research", "spikes");
const RIG_PRESENT = fs.existsSync(path.join(SPIKES, "lib-core.cjs"));
const lib = RIG_PRESENT ? require(path.join(SPIKES, "lib-core.cjs")) : undefined;
const rigTest = (name, fn) =>
  RIG_PRESENT
    ? test(name, fn)
    : test(name, { skip: "the measurement rig is not checked out beside the product (see column-80-working)" }, () => {});

rigTest("RIG-1: loadPrefillWide (the ceiling arm) still builds against the seamed tree", () => {
  let r;
  assert.doesNotThrow(() => {
    r = lib.loadPrefillWide();
  }, "WIDE_PATCHES no longer matches the bundle: the DATASHAPE_BOUNDS literal `TOK_MAX: 200` became `TOK_MAX: walkTokMaxFor(DATASHAPE_TOTAL_TOK)`");
  r?.cleanup();
});

rigTest("RIG-2: loadPrefillBudget with an explicit per-walk cap still builds", () => {
  let r;
  assert.doesNotThrow(() => {
    r = lib.loadPrefillBudget(900, 600);
  }, "the DATASHAPE_BOUNDS patch site is gone (0 matches), so no budget rung with tokMax>0 can run");
  r?.cleanup();
});

rigTest("RIG-3: loadPrefillBudget(totalTok, 0) attributes the AGGREGATE ALONE, per its own doc", () => {
  // tokMax=0 builds fine, which is exactly the problem: nothing asserts. The
  // documented contract is that the per-walk TOK_MAX stays at the shipped
  // value; post-seam the bundle computes it FROM the patched aggregate, so a
  // 900-rung runs with TOK_MAX 600 while claiming to move one knob.
  const r = lib.loadPrefillBudget(900, 0);
  try {
    const src = fs.readFileSync(path.join(SPIKES, ".prefillbudget900_0.bundle.cjs"), "utf8");
    assert.doesNotMatch(
      src,
      /TOK_MAX: walkTokMaxFor\(DATASHAPE_TOTAL_TOK\)/,
      "the per-walk TOK_MAX is derived from the patched aggregate, so the aggregate-only arm silently moves two knobs",
    );
  } finally {
    r.cleanup();
  }
});
