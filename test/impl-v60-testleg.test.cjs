// Implementer oracle for session-v60 phase B3: Repair Function's TEST LEG.
//
// `src/vscode/oracleSurface.ts` imports vscode, so `runTestLeg` itself cannot be
// driven headless. What IS driven here is every pure seam the leg's correctness
// actually rests on - the authorization one-way door, the synthesised
// diagnostic's span, the session's round-2 rule counting FAILING TESTS, the
// before/after delta, the prompt's test wording and its frozen identity, and the
// shared covering-test mechanism the leg and Run Covering Tests both call.
//
// Run: npm run test:unit

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-v60-testleg",
  `export { classifyEligibility, RepairSession, NO_TEST_REPAIR, assembleRepairPrompt } from "../src/core/repair";
export { testFailureDiagnostics, testCheckResult, runDelta, worseThanBeforeMessage, shapesWithinDiscoveredSet } from "../src/core/testRepairEvidence";
export { digestFailures, renderFailureEvidence } from "../src/core/failureDigest";
export { coveringTestPlan, runCoveringGroups, discoveredFilters, failuresOf, runTotals, outcomesThatDidNotRun, withinDiscoveredSet, RUN_DID_NOT_HAPPEN, RUN_TESTS_LANGS, RUN_TESTS_R_MAX, RUN_TESTS_N_MAX, RUN_TESTS_D_MAX } from "../src/core/coveringTestRun";
export { tddLanguageIds } from "../src/core/tddLang";
export { budgetProfileFor, contextBoundsFor } from "../src/core/budgetProfile";\n`,
);
const {
  classifyEligibility,
  RepairSession,
  NO_TEST_REPAIR,
  assembleRepairPrompt,
  testFailureDiagnostics,
  testCheckResult,
  runDelta,
  worseThanBeforeMessage,
  shapesWithinDiscoveredSet,
  digestFailures,
  renderFailureEvidence,
  coveringTestPlan,
  runCoveringGroups,
  discoveredFilters,
  failuresOf,
  runTotals,
  outcomesThatDidNotRun,
  withinDiscoveredSet,
  RUN_DID_NOT_HAPPEN,
  RUN_TESTS_LANGS,
  RUN_TESTS_R_MAX,
  RUN_TESTS_N_MAX,
  RUN_TESTS_D_MAX,
  tddLanguageIds,
  budgetProfileFor,
  contextBoundsFor,
} = mod;
test.after(cleanup);

// The target function, as the leg sees it: an absolute path and a byte span.
const FILE = "/repo/src/ca.rs";
const SCOPE = { filePath: FILE, crateRoot: "/repo", byteStart: 400, byteEnd: 900 };

const failing = (n) =>
  Array.from({ length: n }, (_, i) => ({ name: `test_${i}`, message: `assertion \`left == right\` failed\n  left: ${i}\n right: 7` }));

const testDiagnostics = (n, over = {}) =>
  testFailureDiagnostics({
    failures: failing(n),
    filePath: over.filePath ?? FILE,
    byteStart: over.byteStart ?? SCOPE.byteStart,
    byteEnd: over.byteEnd ?? SCOPE.byteEnd,
    evidence: over.evidence,
  });

const AUTH = { manualRepairGesture: true, inDiscoveredSet: true };

// ---------------------------------------------------------------------------
// 1. The authorization: both halves, and only both halves
// ---------------------------------------------------------------------------

test("the one-way door takes BOTH halves: only manual AND in-the-discovered-set opens it", () => {
  const diagnostic = testDiagnostics(1)[0];
  const combos = [
    [false, false],
    [true, false],
    [false, true],
    [true, true],
  ];
  const opened = [];
  for (const [manualRepairGesture, inDiscoveredSet] of combos) {
    const decision = classifyEligibility(diagnostic, SCOPE, undefined, { manualRepairGesture, inDiscoveredSet });
    opened.push(decision.eligible);
    if (!decision.eligible) {
      assert.strictEqual(
        decision.reason,
        "assertion-failure",
        `manual=${manualRepairGesture} inSet=${inDiscoveredSet} must be refused as an assertion failure, not by some other branch`,
      );
    }
  }
  assert.deepStrictEqual(
    opened,
    [false, false, false, true],
    "a failing test that is NOT in the discovered set must not open eligibility, however the gesture was invoked",
  );
});

test("a runtime-undefined authorization reads as UNAUTHORIZED, the safe direction", () => {
  const diagnostic = testDiagnostics(1)[0];
  const decision = classifyEligibility(diagnostic, SCOPE, undefined, undefined);
  assert.strictEqual(decision.eligible, false);
  assert.strictEqual(decision.reason, "assertion-failure");
});

test("NO_TEST_REPAIR is what every non-test call site means, and it refuses", () => {
  const diagnostic = testDiagnostics(1)[0];
  assert.deepStrictEqual(NO_TEST_REPAIR, { manualRepairGesture: false, inDiscoveredSet: false });
  assert.strictEqual(classifyEligibility(diagnostic, SCOPE, undefined, NO_TEST_REPAIR).eligible, false);
});

// ---------------------------------------------------------------------------
// 2. The decision the whole design turns on: the synthesised diagnostic is
//    IN SPAN
// ---------------------------------------------------------------------------

test("the synthesised diagnostic lands IN SPAN, so `out-of-span` keeps guarding compiler errors instead of killing this class", () => {
  const diagnostic = testDiagnostics(1)[0];
  const decision = classifyEligibility(diagnostic, SCOPE, undefined, AUTH);
  assert.strictEqual(decision.eligible, true);
  assert.notStrictEqual(
    decision.reason,
    "out-of-span",
    "the primary span is the TARGET FUNCTION's span; anchoring it on the panic location instead would put an assert_eq! in the TEST file, out of scope, and refuse almost every real assertion failure",
  );
  const primary = diagnostic.spans.filter((s) => s.isPrimary);
  assert.strictEqual(primary.length, 1, "exactly one primary, and it is the function");
  assert.strictEqual(primary[0].fileName, FILE);
  assert.strictEqual(primary[0].byteStart, SCOPE.byteStart);
  assert.strictEqual(primary[0].byteEnd, SCOPE.byteEnd);
});

test("a diagnostic anchored on the TEST file instead is refused out-of-span, which is what the span choice avoids", () => {
  const wrong = testDiagnostics(1, { filePath: "/repo/tests/ca_test.rs", byteStart: 10, byteEnd: 40 })[0];
  const decision = classifyEligibility(wrong, SCOPE, undefined, AUTH);
  assert.strictEqual(decision.eligible, false);
  assert.strictEqual(decision.reason, "out-of-span");
});

test("the other three refusals still apply under an OPEN authorization", () => {
  const warning = { ...testDiagnostics(1)[0], level: "warning" };
  assert.strictEqual(classifyEligibility(warning, SCOPE, undefined, AUTH).reason, "warning");
  const spanless = { ...testDiagnostics(1)[0], spans: [] };
  assert.strictEqual(classifyEligibility(spanless, SCOPE, undefined, AUTH).reason, "no-location");
});

// ---------------------------------------------------------------------------
// 3. The session
// ---------------------------------------------------------------------------

const sessionWith = (auth) => new RepairSession("fngen", true, undefined, undefined, auth);

test("a session built WITH the authorization grants a round on a synthesised test failure", () => {
  const session = sessionWith(AUTH);
  const action = session.next(testCheckResult(testDiagnostics(3), "/repo"), SCOPE);
  assert.strictEqual(action.kind, "repair");
  assert.strictEqual(action.round, 1);
  assert.strictEqual(action.eligible.length, 3, "one diagnostic per failing test, all eligible");
});

test("the SAME session without it surfaces no-eligible, and spends no round", () => {
  const session = sessionWith(NO_TEST_REPAIR);
  const action = session.next(testCheckResult(testDiagnostics(3), "/repo"), SCOPE);
  assert.strictEqual(action.kind, "surface");
  assert.strictEqual(action.why, "no-eligible");
  assert.strictEqual(session.roundsUsed, 0);
});

test("the DEFAULT session - the one every automatic post-fn-gen call site builds - refuses too", () => {
  const session = new RepairSession("fngen", true);
  const action = session.next(testCheckResult(testDiagnostics(2), "/repo"), SCOPE);
  assert.strictEqual(action.kind, "surface");
  assert.strictEqual(action.why, "no-eligible");
});

test("round 2's falling rule counts FAILING TESTS: 5 red then 3 red grants it", () => {
  const session = sessionWith(AUTH);
  assert.strictEqual(session.next(testCheckResult(testDiagnostics(5), "/repo"), SCOPE).kind, "repair");
  const second = session.next(testCheckResult(testDiagnostics(3), "/repo"), SCOPE);
  assert.strictEqual(second.kind, "repair");
  assert.strictEqual(second.round, 2);
});

test("5 red then 5 red does not: a round that bought nothing gets no second one", () => {
  const session = sessionWith(AUTH);
  assert.strictEqual(session.next(testCheckResult(testDiagnostics(5), "/repo"), SCOPE).kind, "repair");
  const second = session.next(testCheckResult(testDiagnostics(5), "/repo"), SCOPE);
  assert.strictEqual(second.kind, "surface");
  assert.strictEqual(second.why, "route-exhausted");
});

test("one diagnostic per failing TEST is what makes the count a real question", () => {
  // Five tests failing with ONE shared message. Counting shapes would read a
  // round that fixed four of the five as no progress at all.
  const shared = Array.from({ length: 5 }, (_, i) => ({ name: `t${i}`, message: "not implemented" }));
  const diagnostics = testFailureDiagnostics({ failures: shared, filePath: FILE, byteStart: 400, byteEnd: 900 });
  assert.strictEqual(diagnostics.length, 5);
  assert.strictEqual(digestFailures(shared).length, 1, "one SHAPE, five diagnostics");
});

test("an empty failing set is a clean check, so the session surfaces rather than looping", () => {
  const session = sessionWith(AUTH);
  const action = session.next(testCheckResult(testDiagnostics(0), "/repo"), SCOPE);
  assert.strictEqual(action.kind, "surface");
  assert.strictEqual(action.why, "clean");
});

// ---------------------------------------------------------------------------
// 4. Before and after
// ---------------------------------------------------------------------------

const rustResult = (cases) => ({
  ran: true,
  success: cases.every((c) => c.outcome === "pass"),
  cases,
  failures: cases.filter((c) => c.outcome === "fail").map((c) => ({ name: c.name, message: "assertion failed" })),
  passed: cases.filter((c) => c.outcome === "pass").length,
  failed: cases.filter((c) => c.outcome === "fail").length,
  ignored: 0,
  durationMs: 12,
  crateRoot: "/repo",
});

// C# NEVER enumerates passing tests: `cases` carries the failures alone and
// `casesComplete` says so. Every FAILURE is still there, which is the half the
// comparison turns on.
const csResult = (failed) => ({
  ran: true,
  success: failed.length === 0,
  cases: failed.map((name) => ({ name, outcome: "fail" })),
  failures: failed.map((name) => ({ name, message: "Assert.Equal() Failure" })),
  passed: 0,
  failed: failed.length,
  ignored: 0,
  durationMs: 40,
  crateRoot: "/repo",
  casesComplete: false,
});

test("runDelta on a real Rust before/after: two fixed, one still red", () => {
  const before = rustResult([
    { name: "tests::a", outcome: "fail" },
    { name: "tests::b", outcome: "fail" },
    { name: "tests::c", outcome: "fail" },
    { name: "tests::d", outcome: "pass" },
  ]);
  const after = rustResult([
    { name: "tests::a", outcome: "pass" },
    { name: "tests::b", outcome: "pass" },
    { name: "tests::c", outcome: "fail" },
    { name: "tests::d", outcome: "pass" },
  ]);
  const delta = runDelta(before, after);
  assert.deepStrictEqual(delta.fixed, ["tests::a", "tests::b"]);
  assert.deepStrictEqual(delta.broken, []);
  assert.deepStrictEqual(delta.stillRed, ["tests::c"]);
  assert.strictEqual(delta.allGreen, false);
  assert.strictEqual(worseThanBeforeMessage(delta, "create_ca"), undefined);
});

test("runDelta calls a repair that made things WORSE by that name", () => {
  const before = rustResult([
    { name: "tests::a", outcome: "fail" },
    { name: "tests::b", outcome: "pass" },
    { name: "tests::c", outcome: "pass" },
  ]);
  const after = rustResult([
    { name: "tests::a", outcome: "pass" },
    { name: "tests::b", outcome: "fail" },
    { name: "tests::c", outcome: "fail" },
  ]);
  const delta = runDelta(before, after);
  assert.deepStrictEqual(delta.broken, ["tests::b", "tests::c"]);
  const message = worseThanBeforeMessage(delta, "create_ca");
  assert.match(message, /made things WORSE/);
  assert.match(message, /2 tests that passed before now fail/);
  assert.match(message, /It did fix 1\./);
});

test("runDelta on the C# casesComplete:false shape, where only failures are enumerated", () => {
  const before = csResult(["Contoso.Tests.Writes", "Contoso.Tests.Reads"]);
  const after = csResult(["Contoso.Tests.Reads"]);
  const delta = runDelta(before, after);
  assert.deepStrictEqual(
    delta.fixed,
    [],
    "a name absent from the AFTER run's enumeration cannot be claimed as fixed - C# does not list passing tests, so the repair gets no credit it cannot prove",
  );
  assert.deepStrictEqual(delta.stillRed, ["Contoso.Tests.Reads"]);
  assert.deepStrictEqual(delta.broken, []);
});

test("a newly red C# test the before-run never saw counts as red now, without being blamed on the repair", () => {
  const delta = runDelta(csResult(["Contoso.Tests.Reads"]), csResult(["Contoso.Tests.Reads", "Contoso.Tests.Rotates"]));
  assert.deepStrictEqual(delta.broken, [], "not in both runs, so not attributed");
  assert.deepStrictEqual(delta.stillRed, ["Contoso.Tests.Reads", "Contoso.Tests.Rotates"]);
  assert.strictEqual(delta.allGreen, false);
});

test("all green is all green", () => {
  const delta = runDelta(rustResult([{ name: "tests::a", outcome: "fail" }]), rustResult([{ name: "tests::a", outcome: "pass" }]));
  assert.strictEqual(delta.allGreen, true);
  assert.deepStrictEqual(delta.fixed, ["tests::a"]);
});

// ---------------------------------------------------------------------------
// 5. Only failing tests inside the discovered set become evidence
// ---------------------------------------------------------------------------

test("a red test elsewhere in the repo is not this function's problem", () => {
  const failures = [
    { name: "shard_wal::tests::covers_target", message: "not implemented" },
    { name: "unrelated::tests::somewhere_else", message: "not implemented" },
  ];
  const kept = shapesWithinDiscoveredSet(digestFailures(failures), new Set(["covers_target"]), "rust");
  assert.strictEqual(kept.length, 1);
  assert.deepStrictEqual(kept[0].names, ["shard_wal::tests::covers_target"]);
  assert.strictEqual(kept[0].count, 1, "the count follows the filtered names, so the header cannot overstate");
});

test("nothing in the discovered set means nothing to authorise", () => {
  const failures = [{ name: "unrelated::tests::elsewhere", message: "boom" }];
  assert.deepStrictEqual(shapesWithinDiscoveredSet(digestFailures(failures), new Set(["covers_target"]), "rust"), []);
});

// ---------------------------------------------------------------------------
// 6. The prompt
// ---------------------------------------------------------------------------

const CODE = "fn create_ca(path: &Path) -> Result<()> {\n    todo!()\n}\n";

const testPrompt = (over = {}) =>
  assembleRepairPrompt({
    languageId: "rust",
    code: CODE,
    diagnostics: [],
    oracle: "tests",
    failureEvidence: "2 of 11 covering test(s) failed (9 passed).\n\n[2 test(s)] expected PEM, found DER",
    ...over,
  });

test("the test round says the code COMPILES and its tests fail, never that it failed the compiler check", () => {
  const prompt = testPrompt();
  assert.match(prompt, /compiles, but the tests that cover it fail/);
  assert.doesNotMatch(
    prompt,
    /failed the compiler check/,
    "the failing code compiles; saying otherwise is false on its face and points the model at the wrong kind of fault",
  );
});

test("the test round tells the model not to change any test, and not to weaken the function", () => {
  const prompt = testPrompt();
  assert.match(prompt, /Do NOT change any test/);
  assert.match(prompt, /do not weaken the function to satisfy one/);
  assert.match(prompt, /the tests below are the specification/);
});

test("the evidence REPLACES the diagnostics block rather than sitting beside an empty fence", () => {
  const prompt = testPrompt();
  assert.match(prompt, /Test failures:/);
  assert.doesNotMatch(prompt, /Compiler diagnostics:/);
  assert.match(prompt, /expected PEM, found DER/);
});

test("a body-only test round asks for a corrected BODY, and still forbids touching a test", () => {
  const prompt = testPrompt({ languageId: "python", bodyOnly: true, code: "    return None\n" });
  assert.match(prompt, /Reply with one fenced code block containing ONLY the corrected body/);
  assert.match(prompt, /Do NOT change any test/);
});

test("THE FROZEN IDENTITY: with neither failureEvidence nor oracle the bytes are unchanged", () => {
  const base = {
    languageId: "rust",
    docComment: "/// Writes the CA in PEM.\n",
    code: CODE,
    diagnostics: [
      {
        level: "error",
        message: "mismatched types",
        code: "E0308",
        rendered: "error[E0308]: mismatched types\n --> src/ca.rs:3:5\n",
        suggestions: [],
        spans: [{ fileName: "src/ca.rs", isPrimary: true, byteStart: 1, byteEnd: 2, lineStart: 3, lineEnd: 3, columnStart: 5, columnEnd: 6 }],
      },
    ],
    surface: "The API:\n\nfn write_pem(path: &Path)\n",
  };
  const withoutFields = assembleRepairPrompt(base);
  const withUndefinedFields = assembleRepairPrompt({ ...base, failureEvidence: undefined, oracle: undefined });
  assert.strictEqual(
    withUndefinedFields,
    withoutFields,
    "v60 added two optional fields to RepairPromptInput; absent, the repair prompt must be byte-identical to v1",
  );
  const asCompiler = assembleRepairPrompt({ ...base, oracle: "compiler" });
  assert.strictEqual(asCompiler, withoutFields, 'an explicit oracle:"compiler" is the same v1 bytes');
  const withEmptyEvidence = assembleRepairPrompt({ ...base, failureEvidence: "   \n " });
  assert.strictEqual(withEmptyEvidence, withoutFields, "a whitespace-only evidence block renders nothing at all");
});

// ---------------------------------------------------------------------------
// 7. The budget: additional to the surface, never carved out of it
// ---------------------------------------------------------------------------

// Contract point 4: the failure allowance is ADDITIONAL to `surfaceBudgetTok`,
// never carved out of it. Measured, and the reason it is not a preference: the
// evidence-only arm scored 1/4 and the evidence-plus-surface arm 3/4, so a
// budget that paid for the evidence out of the surface would spend the arm that
// wins to buy the arm that does not.
//
// The row this replaced compared `budgetProfileFor(...).surfaceBudgetTok` with
// `profile.surfaceBudgetTok` where `profile` was the identical call - a
// tautology over a pure function, which cannot go red however the budget is
// wired (adversarial review row A6). What pins the contract is the two
// relations below: the allowance is its OWN declared fraction, and the surface
// budget is byte-identical to the stop's own bound, so a change that carves the
// evidence out of the surface moves one of them and goes red.
test("failureTokMax is ADDITIONAL to surfaceBudgetTok, so the test payload cannot evict the type surface", () => {
  for (const stop of ["small", "medium", "large", "frontier"]) {
    const profile = budgetProfileFor("30b", "rust", stop);
    assert.ok(profile.failureTokMax > 0, `${stop} must give the evidence an allowance of its own`);
    assert.strictEqual(
      profile.failureTokMax,
      Math.round(profile.surfaceBudgetTok / 3),
      `${stop}: the failure allowance is a declared fraction of the surface budget, not a slice taken out of it`,
    );
    assert.strictEqual(
      profile.surfaceBudgetTok,
      contextBoundsFor(stop).surfaceBudgetTok,
      `${stop}: the surface budget must be the stop's own bound, unreduced. Any code path that pays for the` +
        ` failure evidence out of the surface shows up here as a smaller number.`,
    );
  }
});

test("the evidence block respects the allowance it was handed", () => {
  const shapes = digestFailures(failing(6));
  const profile = budgetProfileFor("30b", "rust", "small");
  const evidence = renderFailureEvidence({ shapes, tokMax: profile.failureTokMax, ran: 11, passed: 5 });
  assert.ok(evidence.spentTok <= profile.failureTokMax, `spent ${evidence.spentTok} of ${profile.failureTokMax}`);
  assert.match(evidence.section, /covering test\(s\) failed/);
});

// ---------------------------------------------------------------------------
// 8. The shared covering-test mechanism: one derivation, two gestures
// ---------------------------------------------------------------------------

// The TypeScript family is REGISTERED NOWHERE on purpose (adversarial review row
// A3): tsserver resolves a call-hierarchy query to the FILE, `classifyTestNode`
// answers "plain" for every TS node, so the walk can never name a TS test and
// `provenZero` was always true - the product's strongest sentence, stated as a
// fact, about a leg that cannot run. Both gestures refuse those languageIds by
// name until the file-granular runner path exists.
const NO_COVERING_LEG = ["typescript", "typescriptreact", "javascript", "javascriptreact"];

test("every language with a TDD leg has a covering-test row, except the TS family which is refused by name", () => {
  for (const languageId of tddLanguageIds()) {
    if (NO_COVERING_LEG.includes(languageId)) {
      assert.strictEqual(
        RUN_TESTS_LANGS[languageId],
        undefined,
        `${languageId} discovers FILES, not tests, so a row here would let both gestures state a proven zero they cannot prove`,
      );
      continue;
    }
    assert.ok(RUN_TESTS_LANGS[languageId] !== undefined, `${languageId} has a TDD leg but no covering-test row`);
  }
  for (const languageId of NO_COVERING_LEG) {
    assert.strictEqual(
      coveringTestPlan({ languageId, targetFilePath: "/repo/src/ca.ts", log: () => {} }),
      undefined,
      `${languageId} must get the same honest-dark refusal an unregistered language gets`,
    );
  }
});

test("a language with no leg gets no plan, which is the one honest refusal for both gaps", () => {
  assert.strictEqual(coveringTestPlan({ languageId: "ruby", targetFilePath: "/repo/lib/ca.rb", log: () => {} }), undefined);
});

test("the walk bounds sit above the worst measured crate-scoped walk (113 requests, depth 8, 307 nodes)", () => {
  assert.ok(RUN_TESTS_R_MAX > 113, "a cap at or below the measured worst case turns a proven zero into a truncated one");
  assert.ok(RUN_TESTS_N_MAX > 307);
  assert.ok(RUN_TESTS_D_MAX >= 8);
});

const group = (key, filters, runRoot = "/repo") => ({
  key,
  placement: { targetPath: `${runRoot}/tests/a.rs`, exists: true, mode: "same-file", runRoot },
  frameworkId: "libtest",
  tests: filters.map((filter, i) => ({ filter, filePath: `${runRoot}/tests/a.rs`, distance: i + 1, path: [filter, "create_ca"] })),
});

test("the discovered set membership is tested against what the run actually SELECTED", () => {
  const filters = discoveredFilters([group("a", ["x", "y"]), group("b", ["y", "z"])]);
  assert.deepStrictEqual([...filters].sort(), ["x", "y", "z"]);
});

test("failuresOf and runTotals aggregate every group, so a multi-spawn language reports one number", () => {
  const outcomes = [
    { key: "a", frameworkName: "libtest", tests: [], result: rustResult([{ name: "a", outcome: "fail" }, { name: "b", outcome: "pass" }]) },
    { key: "b", frameworkName: "libtest", tests: [], result: rustResult([{ name: "c", outcome: "fail" }]) },
    { key: "c", frameworkName: "libtest", tests: [], failure: "the run could not start: no such file. Nothing was built and no test ran." },
  ];
  // Group c did not run, and it enumerates as the no-run entry rather than as
  // nothing at all (adversarial review row A1b): a caller deriving a still-red
  // count from this list must not get a zero out of a run that never happened.
  assert.deepStrictEqual(failuresOf(outcomes).map((f) => f.name), ["a", "c", RUN_DID_NOT_HAPPEN]);
  assert.deepStrictEqual(runTotals(outcomes), { ran: 3, passed: 1, failed: 2 });
});

test("a run that did not run names WHICH of the four shipped no-run outcomes it was", () => {
  const outcome = (key, extra) => ({ key, frameworkName: "libtest", tests: [{ filter: "writes_pem" }], result: { ...rustResult([]), ran: false, ...extra } });
  const reasons = outcomesThatDidNotRun([
    outcome("build", { buildError: "error[E0308]: mismatched types" }),
    outcome("filter", { filterMatchedNothing: true }),
    outcome("env", { environmentError: "cargo: not found" }),
    outcome("silent", {}),
    { key: "spawn", frameworkName: "libtest", tests: [], failure: "the run could not start." },
    { key: "green", frameworkName: "libtest", tests: [], result: rustResult([{ name: "a", outcome: "pass" }]) },
  ]).map((n) => `${n.key}=${n.reason}`);
  assert.deepStrictEqual(reasons, [
    "build=buildError",
    "filter=filterMatchedNothing",
    "env=environmentError",
    "silent=unclassified",
    "spawn=notAttempted",
  ]);
});

test("a runner that ran and executed nothing is a no-run, so an all-skipped suite cannot read as a pass", () => {
  const skipped = [{ key: "a", frameworkName: "libtest", tests: [], result: { ...rustResult([]), ran: true, ignored: 4 } }];
  assert.deepStrictEqual(outcomesThatDidNotRun(skipped).map((n) => n.reason), ["unclassified"]);
});

test("the totals and the delta population are narrowed to the discovered set, substring matches and all", () => {
  // A bare libtest filter gets no `--exact`, so the spawn executes every case
  // whose path CONTAINS it. Unscoped, those became the numbers the model and the
  // developer were shown (adversarial review rows A4 and A5).
  const outcomes = [
    {
      key: "a",
      frameworkName: "libtest",
      tests: [{ filter: "writes_pem" }],
      result: rustResult([
        { name: "wal::tests::writes_pem", outcome: "fail" },
        { name: "wal::tests::also_writes_pem_twice", outcome: "pass" },
        { name: "wal::tests::unrelated_neighbour", outcome: "pass" },
      ]),
    },
  ];
  assert.deepStrictEqual(runTotals(outcomes), { ran: 3, passed: 2, failed: 1 });
  const scoped = withinDiscoveredSet(outcomes, new Set(["writes_pem"]), "rust");
  assert.deepStrictEqual(runTotals(scoped), { ran: 1, passed: 0, failed: 1 });
  assert.deepStrictEqual(scoped[0].result.cases.map((c) => c.name), ["wal::tests::writes_pem"]);
  // C# never enumerates a passing test, so a recount over its cases would report
  // zero passes for a green run. Its failures still narrow.
  const csharp = [
    {
      key: "a",
      frameworkName: "dotnet test",
      tests: [{ filter: "Ns.Tests.Writes" }],
      result: { ...rustResult([]), ran: true, casesComplete: false, passed: 9, failed: 2, cases: [], failures: [{ name: "Ns.Tests.Writes", message: "boom" }, { name: "Ns.Other.Reads", message: "boom" }] },
    },
  ];
  const csScoped = withinDiscoveredSet(csharp, new Set(["Ns.Tests.Writes"]), "csharp");
  assert.deepStrictEqual(csScoped[0].result.failures.map((f) => f.name), ["Ns.Tests.Writes"]);
  assert.strictEqual(csScoped[0].result.passed, 9, "a count that was never enumerated cannot be recounted");
});

test("a run that never happened contributes nothing to the totals, so a spawn failure cannot read as a pass", () => {
  const outcomes = [{ key: "a", frameworkName: "libtest", tests: [], result: { ...rustResult([]), ran: false } }];
  assert.deepStrictEqual(runTotals(outcomes), { ran: 0, passed: 0, failed: 0 });
});

test("an already-aborted signal cancels the group run before any runner is spawned", async () => {
  const controller = new AbortController();
  controller.abort();
  let asked = 0;
  const run = await runCoveringGroups({
    groups: [group("a", ["x"])],
    frameworkAt: () => {
      asked++;
      return { ok: false, lookedFor: ["cargo"] };
    },
    signal: controller.signal,
    isCancellation: () => true,
    firstLine: (s) => String(s ?? "").split("\n")[0],
    log: () => {},
  });
  assert.deepStrictEqual(run, { cancelled: true });
  assert.strictEqual(asked, 0, "a cancel between groups stops the NEXT runner from starting; it spawns nothing");
});

test("a group whose root has no framework is RECORDED, never skipped: a group that vanished is the false green", async () => {
  const run = await runCoveringGroups({
    groups: [group("a", ["x"])],
    frameworkAt: () => ({ ok: false, lookedFor: ["cargo"] }),
    signal: new AbortController().signal,
    isCancellation: () => false,
    firstLine: (s) => String(s ?? "").split("\n")[0],
    log: () => {},
  });
  assert.strictEqual(run.cancelled, false);
  assert.strictEqual(run.outcomes.length, 1);
  assert.match(run.outcomes[0].failure, /no test framework in \/repo/);
  assert.strictEqual(run.outcomes[0].result, undefined);
});

test("the SAME RunGroup objects come back on the outcomes, so a re-run compares one set with itself", async () => {
  const groups = [group("a", ["x", "y"])];
  const opts = {
    groups,
    frameworkAt: () => ({ ok: false, lookedFor: ["cargo"] }),
    signal: new AbortController().signal,
    isCancellation: () => false,
    firstLine: (s) => String(s ?? "").split("\n")[0],
    log: () => {},
  };
  const first = await runCoveringGroups(opts);
  const second = await runCoveringGroups(opts);
  assert.strictEqual(first.outcomes[0].tests, groups[0].tests);
  assert.strictEqual(second.outcomes[0].tests, groups[0].tests);
});
