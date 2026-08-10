// Blind oracle: the v5 REPAIR LEG contract for the local-symbol class. The
// fn-gen model invents `use atlas::CohortRegister;` for a type CohortRegister
// that is DEFINED IN THE SAME FILE; rustc reports E0432 (or the E0425/E0412 /
// E0433 inline forms). Today the classifier calls that `wrong-item` and the
// repair injects atlas's API surface, steering the model DEEPER into the wrong
// crate. The fix: `classifyHallucination` gains an optional 3rd param
// `localDefs?: Set<string>`; when the offending leaf name is a local
// definition, the class becomes the NEW `local-symbol` so repair steers "drop
// the import, the type is local" instead of injecting an external surface. And
// a NEW `assembleLocalSymbolPayload({name})` emits that terminal steering.
//
// Blind-oracle discipline: assertions are designed from the CONTRACT (v5 goal
// item 6), never from src/**. Expected RED today: the reclassify tests FAIL
// (localDefs is ignored), the payload tests FAIL (not a function). The
// MUST-NOT-reclassify guards PASS today and are regression guards.
//
// Run: SKIP_LIVE=1 node --test test/blind-v5-repairleg.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "blind-v5-repairleg",
  `export { classifyHallucination, assembleLocalSymbolPayload } from "../src/core/compilerDirected";\n`
);
const { classifyHallucination, assembleLocalSymbolPayload } = mod;
test.after(cleanup);

// --- Scaffolding: exact shape reused from impl-v3-classify.test.cjs ----------
// Primary span at line 5, column 12 (rustc 1-based). The contract derives the
// cursor as { line: lineStart - 1, character: columnStart - 1 }, so CURSOR is
// pinned at { line: 4, character: 11 } across every case.
const primarySpan = (over = {}) => ({
  fileName: "src/main.rs",
  byteStart: 0, byteEnd: 0,
  lineStart: 5, lineEnd: 5, columnStart: 12, columnEnd: 20,
  isPrimary: true, ...over,
});
const CURSOR = { line: 4, character: 11 };
const diag = (over = {}) => ({
  kind: "compile-error", level: "error", code: undefined,
  message: "", spans: [primarySpan()], suggestions: [], ...over,
});
const resolution = (spec = {}) => ({
  isInstalledCrate: (c) => new Set(spec.installed ?? []).has(c),
  gatingFeature: (c, m) => (spec.gates ?? {})[`${c}::${m}`],
});

// The leaf under test and its local-def set. The whole point of the class:
// CohortRegister is defined in THIS file, so its `use atlas::CohortRegister`
// import is spurious.
const LEAF = "CohortRegister";
const LOCAL = () => new Set([LEAF]);
// A localDefs that does NOT contain the leaf: must behave like no localDefs.
const OTHER_LOCAL = () => new Set(["SomethingElse"]);

// Helper: call classifyHallucination with the arity implied by the fields
// present. localDefs is the NEW optional 3rd arg; resolution the 2nd.
const classify = (d, res, localDefs) => {
  if (localDefs !== undefined && res !== undefined) return classifyHallucination(d, res, localDefs);
  if (localDefs !== undefined) return classifyHallucination(d, undefined, localDefs);
  if (res !== undefined) return classifyHallucination(d, res);
  return classifyHallucination(d);
};

// ============================================================================
// A. RECLASSIFY: every diagnostic that is wrong-item today becomes
//    local-symbol when localDefs contains the leaf.
// ============================================================================

// Each reclassify case carries the diagnostic + optional resolution that makes
// it a wrong-item today, and the wrong-item shape it produces WITHOUT localDefs.
const reclassifyCases = [
  {
    name: "E0432 multi-segment import `atlas::CohortRegister`",
    diagnostic: diag({ code: "E0432", message: "unresolved import `atlas::CohortRegister`" }),
    res: undefined,
    wrongItem: { kind: "wrong-item", crate: "atlas", item: LEAF, cursor: CURSOR },
  },
  {
    name: "E0425/E0412 inline `cannot find type CohortRegister in crate atlas`",
    diagnostic: diag({ code: "E0425", message: "cannot find type `CohortRegister` in crate `atlas`" }),
    res: undefined,
    wrongItem: { kind: "wrong-item", crate: "atlas", item: LEAF, cursor: CURSOR },
  },
  {
    name: "E0433 inline `cannot find CohortRegister in atlas` (installed, ungated)",
    diagnostic: diag({ code: "E0433", message: "cannot find `CohortRegister` in `atlas`" }),
    res: resolution({ installed: ["atlas"] }),
    wrongItem: { kind: "wrong-item", crate: "atlas", item: LEAF, cursor: CURSOR },
  },
];

const localSymbol = { kind: "local-symbol", name: LEAF, cursor: CURSOR };

for (const { name, diagnostic, res, wrongItem } of reclassifyCases) {
  test(`INVARIANT reclassify-to-local: ${name} WITH localDefs{${LEAF}} -> local-symbol`, () => {
    assert.deepStrictEqual(classify(diagnostic, res, LOCAL()), localSymbol);
  });

  test(`INVARIANT unchanged-without-local: ${name} WITHOUT localDefs -> wrong-item`, () => {
    assert.deepStrictEqual(classify(diagnostic, res, undefined), wrongItem);
  });

  test(`INVARIANT empty-set-is-noop: ${name} with new Set() -> wrong-item (same as undefined)`, () => {
    assert.deepStrictEqual(classify(diagnostic, res, new Set()), wrongItem);
  });

  test(`INVARIANT non-matching-set-is-noop: ${name} with localDefs not containing leaf -> wrong-item`, () => {
    assert.deepStrictEqual(classify(diagnostic, res, OTHER_LOCAL()), wrongItem);
  });
}

// ============================================================================
// B. MUST-NOT-RECLASSIFY guards. These PASS today (behavior already correct)
//    and are regression guards that must keep passing.
// ============================================================================

// Each guard: the diagnostic + optional resolution, and the class it holds
// regardless of localDefs (asserted with AND without the leaf in localDefs).
const guardCases = [
  {
    name: "unresolved-method (E0599): TYPE resolved, only the METHOD is wrong -> genuine repair, not a spurious import",
    diagnostic: diag({
      code: "E0599",
      message: "no method named `count` found for struct `CohortRegister`",
    }),
    res: undefined,
    expected: { kind: "unresolved-method", member: "count", type: LEAF, cursor: CURSOR },
  },
  {
    name: "unresolved-assoc: associated fn on a real local type stays unresolved-assoc",
    diagnostic: diag({
      code: "E0599",
      message: "no associated function or constant named `from_morton` found for struct `CohortRegister`",
    }),
    res: undefined,
    expected: { kind: "unresolved-assoc", member: "from_morton", type: LEAF, cursor: CURSOR },
  },
  {
    name: "unresolved-crate (single-segment E0432 `atlas`): a whole missing crate can't be a local def",
    diagnostic: diag({ code: "E0432", message: "unresolved import `atlas`" }),
    res: undefined,
    // localDefs deliberately contains the crate name to prove the guard: even
    // so, a bare-crate miss stays unresolved-crate.
    localDefsOverride: () => new Set(["atlas"]),
    expected: { kind: "unresolved-crate", crate: "atlas", cursor: CURSOR },
  },
  {
    name: "needs-feature (E0432 import of a gated module): gated module is not a local symbol -> unchanged",
    diagnostic: diag({ code: "E0432", message: "unresolved import `object_store::aws`" }),
    res: resolution({ installed: ["object_store"], gates: { "object_store::aws": "aws" } }),
    // localDefs deliberately does NOT contain the gated leaf `aws`: with no
    // same-file collision, needs-feature wins. (Local-wins applies only when the
    // leaf IS a local def — the collision tie is asserted separately, local-wins,
    // per the goal's roadmap section 3.)
    localDefsOverride: () => new Set(["Unrelated"]),
    expected: { kind: "needs-feature", crate: "object_store", module: "aws", feature: "aws", cursor: CURSOR },
  },
  {
    name: "undefined (borrow/type error the classifier does not own) stays undefined with localDefs",
    diagnostic: diag({ code: "E0382", message: "borrow of moved value: `CohortRegister`" }),
    res: undefined,
    expected: undefined,
  },
];

for (const { name, diagnostic, res, expected, localDefsOverride } of guardCases) {
  const withLeaf = localDefsOverride ?? LOCAL;
  test(`INVARIANT guard: ${name} [with localDefs]`, () => {
    assert.deepStrictEqual(classify(diagnostic, res, withLeaf()), expected);
  });
  test(`INVARIANT guard: ${name} [without localDefs, baseline]`, () => {
    assert.deepStrictEqual(classify(diagnostic, res, undefined), expected);
  });
}

// --- The local-vs-gated-module tie: DOCUMENTED ASSUMPTION --------------------
// Contract edge: a leaf that is BOTH a same-file local def AND (per resolution)
// a gated module. The goal text names "local wins" as the reasonable default:
// a same-file definition means the `use` import is spurious, so drop it rather
// than steer to a Cargo.toml feature edit. We encode local-wins and flag it.
// If triage prefers gated-wins, this is the single test to flip.
test("ASSUMPTION local-wins: E0432 leaf is BOTH gated module AND local def -> local-symbol (drop the spurious import)", () => {
  const d = diag({ code: "E0432", message: "unresolved import `atlas::CohortRegister`" });
  const res = resolution({ installed: ["atlas"], gates: { "atlas::CohortRegister": "cohort" } });
  assert.deepStrictEqual(
    classify(d, res, LOCAL()),
    { kind: "local-symbol", name: LEAF, cursor: CURSOR }
  );
});

// ============================================================================
// B (payload). assembleLocalSymbolPayload({ name }) -> terminal repair steer.
//   Exact wording is the implementer's; assert the load-bearing properties via
//   tolerant regexes.
// ============================================================================

test("INVARIANT payload names the symbol: `name` appears in the output", () => {
  const p = assembleLocalSymbolPayload({ name: LEAF });
  assert.ok(p.includes(LEAF), "payload must name the offending symbol");
});

test("INVARIANT payload says the name is defined in THIS FILE / local (case-insensitive)", () => {
  const p = assembleLocalSymbolPayload({ name: LEAF });
  assert.match(
    p,
    /defined in this file|in this file|\blocal\b/i,
    "payload must communicate the name is local / defined in this file"
  );
});

test("INVARIANT payload instructs to REMOVE/DROP the use import or crate path (tolerant)", () => {
  const p = assembleLocalSymbolPayload({ name: LEAF });
  assert.match(
    p,
    /(remove|drop|delete)[\s\S]{0,40}(import|\buse\b|path)/i,
    "payload must instruct to remove/drop the use import or crate path"
  );
});

test("INVARIANT payload emits NO rust code fence (terminal steer, no API surface to show)", () => {
  const p = assembleLocalSymbolPayload({ name: LEAF });
  assert.ok(!/```rust/.test(p), "no rust fence: mirrors assembleNeedsFeaturePayload, there is no example");
});
