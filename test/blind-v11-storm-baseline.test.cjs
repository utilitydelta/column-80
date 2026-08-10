// BLIND ORACLE — v11 (Python) Phase 4, WP10 / P2-1: the storm classifier's
// BASELINE-ONLY enforcement. Written from phase4-brief.md WP10 + OQ-3 ONLY.
// The implementation is written AFTER this file.
//
// THE INVARIANT (brief WP10): `isMissingImportsStorm` / `describeEnvironment`
// must be consumable ONLY on an untouched PRE-generation baseline, never on the
// POST-accept check. The danger is exact: a generation that emits TWO
// hallucinated imports produces `missing=2, total=2`, and the pure code-only
// heuristic (pyOracle's private isStormCodes: `missing >= 2 && missing*2 > total`)
// classifies that as environment-broken — which would EXCUSE the hallucination
// as "select an interpreter." So a post-generation two-hallucination stream must
// NOT surface an environment reason through the gesture path. The brief's
// recommended enforcement (OQ-3) is a typed `BaselineCheck` newtype only the
// pre-generation path can mint.
//
// BLACK-BOX LIMIT (a finding, stated up front): a TS newtype that is a pure
// phantom brand is ERASED at runtime, so a headless black-box test cannot
// observe the type-level refusal of a post-accept OracleCheckResult unless the
// mint carries a RUNTIME brand (a marker field / wrapper). This suite is
// therefore self-adapting: it probes for a mint function and, when a runtime
// brand is observable, asserts the refusal HARD; when the newtype is
// compile-time-only, it records that as a finding rather than a false red, and
// recommends a tsc-level negative test as the real enforcement proof.
//
// Run: SKIP_LIVE=1 node --test test/blind-v11-storm-baseline.test.cjs
// Expected: RED until isMissingImportsStorm/describeEnvironment land.

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

// Probe for the classifier + every plausible mint-fn name. Unbuilt names bundle
// to `undefined` (esbuild emits undefined for a missing export, no throw), so
// this file goes cleanly red at assert-time rather than erroring at bundle-time.
const MINT_NAMES = [
  "baselineCheck",
  "mintBaselineCheck",
  "asBaselineCheck",
  "toBaselineCheck",
  "makeBaselineCheck",
  "baselineFrom",
  "preGenerationBaseline",
  "asBaseline",
];

let mod = {};
let cleanup = () => {};
let bundleErr;
try {
  ({ mod, cleanup } = bundleCore(
    "blind-v11-storm-baseline",
    `export { isMissingImportsStorm, describeEnvironment } from "../src/core/pyOracle";\n` +
      MINT_NAMES.map((n) => `export { ${n} } from "../src/core/pyOracle";\n`).join(""),
  ));
} catch (e) {
  bundleErr = e;
}
test.after(() => cleanup());
const { isMissingImportsStorm, describeEnvironment } = mod;
const mintName = MINT_NAMES.find((n) => typeof mod[n] === "function");
const mint = mintName ? mod[mintName] : undefined;

test("bundle guard: pyOracle builds headless", () => {
  if (bundleErr) assert.fail(`bundle failed: ${bundleErr.message}`);
});

// ---- Fixtures. A post-generation OracleCheckResult carrying TWO hallucinated
// imports: missing=2, total=2 — the shape that fools the naive storm heuristic.
const missingImportDiag = (name) => ({
  kind: "compile-error",
  level: "error",
  code: "reportMissingImports",
  message: `Import "${name}" could not be resolved`,
  spans: [{ fileName: "m.py", byteStart: 0, byteEnd: 0, lineStart: 1, lineEnd: 1, columnStart: 8, columnEnd: 8 + name.length, isPrimary: true }],
  suggestions: [],
});

// The POST-ACCEPT check: the model hallucinated two libraries into the code it
// just generated. This is NOT a baseline — it is the state AFTER a generation.
const POST_GEN_TWO_HALLUCINATIONS = {
  success: false,
  diagnostics: [missingImportDiag("faketorchlib"), missingImportDiag("fakenumpylib")],
  durationMs: 5,
  crateRoot: "/proj",
};

// ===========================================================================
// 1. Existence contract — the two classifier entry points are exported.
//    RED until P2-1 lands.
// ===========================================================================

test("contract: isMissingImportsStorm and describeEnvironment are exported classifier fns", () => {
  assert.strictEqual(typeof isMissingImportsStorm, "function", "isMissingImportsStorm must be exported (the baseline-only storm gate)");
  assert.strictEqual(typeof describeEnvironment, "function", "describeEnvironment must be exported (the honest env-reason line)");
});

// ===========================================================================
// 2. The POSITIVE path — a genuine PRE-generation baseline whose imports are all
//    missing (a truly broken interpreter) IS a storm, and describeEnvironment
//    yields a non-empty reason. Requires the mint fn; skipped-with-finding if
//    the mint name is not among the probed set.
// ===========================================================================

test("positive: a minted PRE-generation baseline storm classifies as environment-broken", (ctx) => {
  if (typeof isMissingImportsStorm !== "function") {
    return ctx.skip("isMissingImportsStorm not yet exported (red — see the existence contract)");
  }
  if (!mint) {
    return ctx.skip(
      `FINDING: no BaselineCheck mint fn found among ${JSON.stringify(MINT_NAMES)}; the mint's export name is unspecified in the brief (OQ-3). ` +
        "Cannot exercise the pre-generation path black-box until the mint name is pinned.",
    );
  }
  let baseline;
  try {
    baseline = mint(POST_GEN_TWO_HALLUCINATIONS);
  } catch (e) {
    return ctx.skip(`FINDING: mint(${mintName}) rejected the check shape (${e.message}); baseline mint input shape unspecified.`);
  }
  assert.strictEqual(
    isMissingImportsStorm(baseline),
    true,
    "a minted baseline whose only errors are 2 missing imports IS a storm (the pre-generation broken-env case)",
  );
  const reason = describeEnvironment(baseline);
  assert.ok(
    typeof reason === "string" && reason.length > 0,
    `describeEnvironment returns a non-empty honest reason line for a broken env; got ${JSON.stringify(reason)}`,
  );
});

// ===========================================================================
// 3. The INVARIANT — a POST-generation two-hallucination stream must NOT surface
//    an environment reason. Self-adapting on whether the newtype is runtime-
//    observable.
// ===========================================================================

test("invariant: a POST-generation two-hallucination stream is NOT classified environment-broken", (ctx) => {
  if (typeof isMissingImportsStorm !== "function") {
    return ctx.skip("isMissingImportsStorm not yet exported (red — see the existence contract)");
  }
  // Is the newtype runtime-observable? Compare a minted baseline to the raw
  // check: a runtime brand transforms the object (adds a field / wraps it).
  let runtimeBrand = false;
  if (mint) {
    try {
      const minted = mint(POST_GEN_TWO_HALLUCINATIONS);
      runtimeBrand =
        minted !== POST_GEN_TWO_HALLUCINATIONS &&
        JSON.stringify(minted) !== JSON.stringify(POST_GEN_TWO_HALLUCINATIONS);
    } catch {
      runtimeBrand = false;
    }
  }

  if (!runtimeBrand) {
    return ctx.skip(
      "FINDING: the BaselineCheck newtype is not runtime-observable (compile-time-only phantom brand, or no mint fn). " +
        "A headless black-box test cannot observe the type-level refusal of a raw post-accept OracleCheckResult. " +
        "RECOMMEND the implementer add a tsc-level negative test (a .ts fixture that passes an OracleCheckResult to " +
        "isMissingImportsStorm and asserts `tsc --noEmit` REJECTS it) as the real baseline-only enforcement proof. " +
        "The runtime invariant below can only be asserted when the mint carries a runtime brand.",
    );
  }

  // Runtime brand present: the gate must REFUSE the un-minted post-accept check.
  const verdict = isMissingImportsStorm(POST_GEN_TWO_HALLUCINATIONS);
  assert.notStrictEqual(
    verdict,
    true,
    "a RAW post-accept OracleCheckResult (not a minted BaselineCheck) must NOT be classified as a storm — " +
      "otherwise a 2-hallucination generation is excused as a broken environment (the exact P2-1 failure)",
  );
});
