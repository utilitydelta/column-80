// Adversarial rows against session-v60 phase B3: Repair Function's TEST LEG
// (`runTestLeg` in src/vscode/oracleSurface.ts, plus the core seams it drives).
//
// The leg opens a guard that was closed on purpose, so the rows below attack the
// one-way door, the synthesised diagnostic's span, the 2-round cap, the write
// path, the re-run, `runDelta`, the wording, and whether the two gestures
// discover the same set.
//
// `oracleSurface.ts` imports vscode and cannot be bundled, so claims about
// `runTestLeg` itself are made as SOURCE-LEVEL assertions over the file text,
// the idiom other adversarial files already use. Everything else is driven
// headless through `bundleCore`.
//
// Run: node --test test/adversarial-v60-p2.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "adv-v60-p2",
  `export { withinDiscoveredSet, outcomesThatDidNotRun } from "../src/core/coveringTestRun";
export { runDelta, worseThanBeforeMessage, shapesWithinDiscoveredSet, testFailureDiagnostics, testCheckResult } from "../src/core/testRepairEvidence";
export { failuresOf, discoveredFilters, runTotals } from "../src/core/coveringTestRun";
export { digestFailures } from "../src/core/failureDigest";
export { discoverCoveringTests } from "../src/core/testDiscovery";
export { classifyTestNode, caseMatchesFilter, runnerFilterFor } from "../src/core/testClassify";
export { buildTestCommand, oracleFor } from "../src/core/compilerOracle";
export { classifyEligibility, RepairSession } from "../src/core/repair";\n`,
);
const {
  withinDiscoveredSet,
  outcomesThatDidNotRun,
  runDelta,
  worseThanBeforeMessage,
  shapesWithinDiscoveredSet,
  testFailureDiagnostics,
  testCheckResult,
  runTotals,
  failuresOf,
  discoveredFilters,
  digestFailures,
  discoverCoveringTests,
  classifyTestNode,
  caseMatchesFilter,
  runnerFilterFor,
  buildTestCommand,
  oracleFor,
  classifyEligibility,
  RepairSession,
} = mod;
test.after(cleanup);

const SRC = path.join(__dirname, "..", "src");
const oracleSurface = fs.readFileSync(path.join(SRC, "vscode", "oracleSurface.ts"), "utf8");
const fnGen = fs.readFileSync(path.join(SRC, "vscode", "fnGen.ts"), "utf8");

/** The body of `runTestLeg`, from its signature to the start of `runRefine`. */
function testLegSource() {
  const start = oracleSurface.indexOf("async function runTestLeg(");
  const end = oracleSurface.indexOf("async function runRefine(", start);
  assert.ok(start > 0 && end > start, "runTestLeg must still be a function in oracleSurface.ts");
  return oracleSurface.slice(start, end);
}

const FILE = "/repo/src/ca.rs";
const SCOPE = { filePath: FILE, crateRoot: "/repo", byteStart: 400, byteEnd: 900 };

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

// What a runner returns when the crate NO LONGER COMPILES: nothing ran, nothing
// passed, nothing failed, and the reason is on `buildError`. This is the exact
// shape `runFrameworkTestsAt` produces after a repair that broke the build, and
// it is what `mergeRunResults` (oracleSurface.ts:1401) hands to `runDelta`.
const buildErrorResult = (reason) => ({
  ran: false,
  success: false,
  cases: [],
  failures: [],
  passed: 0,
  failed: 0,
  ignored: 0,
  buildError: reason,
  durationMs: 90,
  crateRoot: "/repo",
});

// ---------------------------------------------------------------------------
// ROW 1 (HIGH). A repair that BREAKS THE BUILD is reported as all green.
//
// runTestLeg never re-runs the compiler oracle after its splice, and it decides
// the verdict from `failuresOf(after.outcomes)` alone. A run that did not run
// enumerates no failures, so `stillRed` is 0, `outcome("all-green")` fires, and
// the human is told the covering tests now pass on code that does not compile.
// ---------------------------------------------------------------------------

test("A1 runDelta calls a build-error after-run allGreen, so the leg's own verdict reads as success", () => {
  const before = rustResult([
    { name: "tests::writes_pem", outcome: "fail" },
    { name: "tests::reads_pem", outcome: "fail" },
    { name: "tests::perms", outcome: "pass" },
  ]);
  const after = buildErrorResult("error[E0308]: mismatched types");
  const delta = runDelta(before, after);
  assert.strictEqual(
    delta.allGreen,
    false,
    "a re-run that never ran must never be allGreen: nothing was proved about any test, and the code does not even build",
  );
});

test("A1b the leg's still-red count is 0 for a build-error re-run, which is what produces the false green", () => {
  const outcomes = [
    { key: "a", frameworkName: "cargo test (libtest)", tests: [], result: buildErrorResult("E0308") },
  ];
  // These are the three expressions runTestLeg uses after the re-run
  // (oracleSurface.ts:1861-1876): failuresOf -> digest -> shapesWithinDiscoveredSet
  // -> stillRed, and runTotals for the number in the success toast.
  const afterFailures = failuresOf(outcomes);
  const shapes = shapesWithinDiscoveredSet(digestFailures(afterFailures), new Set(["writes_pem"]), "rust");
  const stillRed = afterFailures.filter((f) => new Set(shapes.flatMap((s) => s.names)).has(f.name)).length;
  const totals = runTotals(outcomes);
  assert.notStrictEqual(
    stillRed,
    0,
    `a build-error re-run yields stillRed ${stillRed} and nowPassing ${totals.passed}, so the leg logs "every covering test for X now passes" and toasts "${totals.passed} covering test(s) now pass" over code that does not compile`,
  );
});

test("A1c runTestLeg reads no no-run field and never re-checks the compiler after its splice", () => {
  const leg = testLegSource();
  const missing = ["buildError", "environmentError", "filterMatchedNothing"].filter((f) => !leg.includes(f));
  assert.deepStrictEqual(
    missing,
    [],
    "the four no-run outcomes each have a shipped sentence (runTestsReport.ts:232-246) and the test leg consults none of them",
  );
  assert.ok(
    /runOracleCheck\(/.test(leg),
    "the compiler loop re-checks after every accepted splice (oracleSurface.ts:978); the test leg accepts a splice and never checks that the code still compiles",
  );
});

// ---------------------------------------------------------------------------
// ROW 2 (MEDIUM). The two gestures do NOT discover the same set for the same
// cursor: Run Covering Tests prepares the call hierarchy at the RAW cursor,
// the repair leg normalises to the enclosing symbol's selectionRange.
// ---------------------------------------------------------------------------

test("A2 the two gestures prepare the call root from different positions", () => {
  assert.ok(
    fnGen.includes('vscode.commands.registerCommand("column80.runTests"'),
    "the Run Covering Tests command must still live in fnGen.ts",
  );
  const cmdStart = fnGen.indexOf('vscode.commands.registerCommand("column80.runTests"');
  const cmd = fnGen.slice(cmdStart, cmdStart + 9000);
  // RE-CUT. The row's original precondition pinned the exact line
  // `prepareCallRoot(document, editor.selection.active, log)` as evidence of the
  // defect, so the fix that removed the raw cursor also removed the row's own
  // anchor. What the row is ABOUT is the binding assertion below: both gestures
  // must normalise the cursor the same way. That is what is pinned now.
  // Comments stripped: the fix left the old line quoted in a WHY comment, and a
  // raw source scan would read that as the defect still being present.
  const cmdCode = cmd.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
  assert.ok(!/prepareCallRoot\(document,\s*editor\.selection\.active/.test(cmdCode), "Run Covering Tests must NOT use the raw cursor");
  const leg = testLegSource();
  assert.ok(leg.includes("prepareCallRoot(ctx.document, callRootPosition(ctx.document, resolved), log)"), "the repair leg normalises");
  assert.ok(
    cmdCode.includes("callRootPosition("),
    "Run Covering Tests must normalise the cursor the same way the repair leg does: at a raw cursor sitting on a call inside the body, `vscode.prepareCallHierarchy` answers with the CALLEE, so the two gestures discover two different functions' covering tests for one cursor and the whole design rests on them agreeing",
  );
});

// A2b: TRIAGE RULED ONE WAY AND THEN THE OTHER, and the row was right first time.
//
// The first ruling was to REMOVE the refusal from `column80.runTests` so both
// gestures accept any kind. That satisfies the row's real requirement (the two
// gestures must agree) but it is the wrong direction: what a type target's
// "covering tests" even means is murky, `column80.runTddTests` has gated on kind
// since it shipped, and the conservative direction on a gesture that spawns
// runners and a gesture that calls a model is to refuse what nobody has
// measured. So: BOTH gate, which is what this row asked for.
test("A2b [RULED] both gestures gate on a function target, so they cannot disagree", () => {
  const cmdStart = fnGen.indexOf('vscode.commands.registerCommand("column80.runTests"');
  const cmd = fnGen.slice(cmdStart, cmdStart + 9000);
  assert.ok(cmd.includes('resolved.kind !== "function"'), "the gesture refuses a type target");
  const leg = testLegSource();
  assert.ok(
    /resolved\.kind\s*!==\s*"function"/.test(leg),
    "the repair leg must gate on kind too: it passes `kind: resolved.kind` to assembleRepairPrompt, so without this one gesture refuses a struct target and the other runs a repair round on it",
  );
});

// ---------------------------------------------------------------------------
// ROW 3 (MEDIUM). TypeScript is registered for both gestures and can never
// discover a test, so the leg is structurally dead there and the report states
// a PROVEN ZERO.
// ---------------------------------------------------------------------------

// A3, TRIAGED: the FINDING is upheld and the FIX is the opposite of this row's
// assertion.
//
// The finding was right and it was the sharpest honesty defect in the review:
// `classifyTestNode` answers "plain" for every TypeScript node, so nothing is
// ever discovered, so `provenZero` came back TRUE and the product printed "no
// test file in this package calls X, directly or through any caller I could
// reach" as a FACT. It is not a fact. The walk cannot name a TypeScript test at
// all yet.
//
// The row's own remedy - make TS discovery work - was ruled OUT of this session.
// The file-granularity leg needs a runner path that runs a FILE without a `-t`
// title filter, and neither vitest's nor jest's shipped `buildCommand` offers
// one; building it here would ship it unmeasured, in the one language whose
// precision cost is already known to be real.
//
// So the honest fix is the honest-dark gate the product already uses everywhere
// else: the TS family is REFUSED BY NAME, and no zero of any kind is stated for
// it. That is what these rows pin.
test("A3 [RULED] the TypeScript family is refused by name, so no false zero can be stated for it", () => {
  const langs = require("path").join(__dirname, "..", "src", "core", "coveringTestRun.ts");
  const src = require("fs").readFileSync(langs, "utf8");
  const table = src.slice(src.indexOf("RUN_TESTS_LANGS"), src.indexOf("RUN_TESTS_LANGS") + 1400);
  for (const id of ["typescript", "typescriptreact", "javascript", "javascriptreact"]) {
    assert.ok(
      !new RegExp(`^\\s*(?:"${id}"|${id})\\s*:`, "m").test(table),
      `${id} must NOT be registered for the covering-test gestures while the walk cannot name a TS test: registering it makes the product state a proven zero it has not proved`,
    );
  }
  assert.ok(/rust\s*:/.test(table) && /csharp\s*:/.test(table), "the languages that DO work stay registered");
});

test("A3b [RULED] the underlying gap is real and unchanged: a TS caller still classifies as plain", async () => {
  // Kept from the original row, because the day someone re-registers TypeScript
  // this is the fact that makes it a defect again.
  const caller = { name: "/repo/src/ca.test.ts", filePath: "/repo/src/ca.test.ts", line: 1, nameLine: 1 };
  assert.strictEqual(
    classifyTestNode("typescript", { name: caller.name, filePath: caller.filePath, lines: [], rangeStartLine: 1, selectionStartLine: 1 }),
    "plain",
    "tsserver answers a call-hierarchy query with the FILE, and nothing yet turns that into a runnable test",
  );
});

// ---------------------------------------------------------------------------
// ROW 4 (MEDIUM). One press can toast "made things WORSE" and "now pass" at
// once: the WORSE sentence is computed over every case the run reported, the
// still-red count only over the discovered set.
// ---------------------------------------------------------------------------

// A4, TRIAGED: the CONTRADICTION was real and the fix is caller-side, so the row
// moves to the layer the fix lives at.
//
// The finding: `broke` came from `runDelta` over EVERY case the runner reported
// while `stillRed` was filtered to the discovered set, so one press could warn
// "the repair made things WORSE" and then inform "the covering tests now pass".
// `runDelta` is a pure two-run comparison and holds no discovered set; it cannot
// be the thing that fixes this, and asserting on it alone pins the wrong layer.
// The leg now scopes BOTH runs through `withinDiscoveredSet` before either
// number is computed. These two rows pin the defect and the fix together.
test("A4 [RULED] the unfiltered delta really does produce the contradiction", () => {
  const before = rustResult([
    { name: "wal::tests::writes_pem", outcome: "fail" },
    { name: "wal::tests::unrelated_neighbour", outcome: "pass" },
  ]);
  const after = rustResult([
    { name: "wal::tests::writes_pem", outcome: "pass" },
    { name: "wal::tests::unrelated_neighbour", outcome: "fail" },
  ]);
  const worse = worseThanBeforeMessage(runDelta(before, after), "create_ca");
  assert.ok(worse !== undefined, "unfiltered, the neighbour going red reads as the repair making things worse");
  assert.match(worse, /unrelated_neighbour/, "and it names a test the walk never discovered");
});

test("A4 [RULED] scoping BOTH runs to the discovered set first removes the contradiction", () => {
  const filters = new Set(["writes_pem"]);
  const wrap = (res) => [{ key: "k", result: res, tests: [{ filter: "writes_pem", filePath: "/r/a.rs", distance: 1, path: [] }], frameworkName: "cargo test" }];
  const before = rustResult([
    { name: "wal::tests::writes_pem", outcome: "fail" },
    { name: "wal::tests::unrelated_neighbour", outcome: "pass" },
  ]);
  const after = rustResult([
    { name: "wal::tests::writes_pem", outcome: "pass" },
    { name: "wal::tests::unrelated_neighbour", outcome: "fail" },
  ]);
  const scopedBefore = withinDiscoveredSet(wrap(before), filters, "rust")[0].result;
  const scopedAfter = withinDiscoveredSet(wrap(after), filters, "rust")[0].result;
  const delta = runDelta(scopedBefore, scopedAfter);
  assert.strictEqual(
    worseThanBeforeMessage(delta, "create_ca"),
    undefined,
    "one press must not be able to say the repair made things worse and that the covering tests now pass",
  );
  assert.deepStrictEqual(delta.fixed, ["wal::tests::writes_pem"]);
  assert.strictEqual(delta.allGreen, true);
});


// ---------------------------------------------------------------------------
// ROW 5 (LOW/MEDIUM). The numbers the developer and the model are shown are
// taken over everything the runner executed, which for Rust is wider than the
// discovered set: a bare walk name gets no `--exact`.
// ---------------------------------------------------------------------------

// A5, TRIAGED: the FINDING is upheld, the DEMANDED FIX is refuted by running it.
//
// The finding is real: rust-analyzer names a test bare, `LIBTEST_FULL_PATH`
// refuses a bare name, so the shipped Rust command runs WITHOUT `--exact` and
// libtest substring-matches. Tests the walk never discovered can run and be
// counted. That is recorded in session-v60/scraps.md S60-2.
//
// The row's remedy was to add `--exact`. MEASURED against the real 534-test
// crate, on a real discovered name:
//
//   cargo test --lib -- apply_returns_ok_when_batch_fully_applied
//     -> 1 passed; 539 filtered out
//   cargo test --lib -- --exact apply_returns_ok_when_batch_fully_applied
//     -> 0 passed; 540 filtered out
//
// `--exact` needs the full `mod::path::name`, so pairing it with a bare name
// selects NOTHING and turns every Rust run into a filter miss: a silent zero,
// which is the exact false-green class this session exists to refuse. The
// remedy is worse than the defect.
//
// What was fixed instead is the half that actually misled: the COUNTS. They are
// now filtered to the discovered set before they reach either the model or the
// developer, so a number that claims to be the covering set is one. The real fix
// for the selection itself is the full libtest path, which is scraps S60-2.
test("A5 [RULED] the bare-name command must NOT carry --exact, because --exact on a bare name selects nothing", () => {
  const bare = buildTestCommand("/repo", ["writes_pem"]);
  assert.ok(
    !bare.args.includes("--exact"),
    "measured on the real crate: `--exact` with a bare name matches 0 tests, which is a filter miss reported as a run",
  );
  const full = buildTestCommand("/repo", ["wal::tests::writes_pem"]);
  assert.ok(
    full.args.includes("--exact"),
    "a FULL libtest path is what earns --exact, and assembling one for a discovered test is the open item",
  );
});


// A5b, TRIAGED: the finding is upheld and the fixture had to be repaired to
// express it. The row built its filters from a SEPARATE groups array while
// leaving `tests: []` on the outcome itself, so the primitive under test held no
// filter and could not have answered anything else. The outcome now carries the
// discovered test it was run for, which is what the leg passes.
test("A5b [RULED] the totals fed to the evidence header and the success toast ARE filtered to the discovered set", () => {
  const discovered = [{ filter: "writes_pem", filePath: "/repo/src/a.rs", distance: 1, path: ["writes_pem", "create_ca"] }];
  const outcomes = [
    {
      key: "a",
      frameworkName: "cargo test (libtest)",
      tests: discovered,
      result: rustResult([
        { name: "wal::tests::writes_pem", outcome: "fail" },
        { name: "wal::tests::also_writes_pem_twice", outcome: "pass" },
        { name: "wal::tests::writes_pem_slowly", outcome: "pass" },
      ]),
    },
  ];
  const filters = discoveredFilters([
    { key: "a", placement: { runRoot: "/repo" }, frameworkId: "libtest", tests: discovered },
  ]);
  // Unfiltered, the substring match makes the run three tests wide.
  assert.strictEqual(runTotals(outcomes).ran, 3, "the runner really did execute three, because a bare name substring-matches");
  // Scoped, the numbers describe the set the walk actually found, which is what
  // the evidence header and the success toast both claim to be describing.
  const scoped = runTotals(withinDiscoveredSet(outcomes, filters, "rust"));
  assert.strictEqual(scoped.ran, 1, "a count that CLAIMS to be the covering set must be the covering set");
  assert.strictEqual(scoped.failed, 1);
  assert.strictEqual(scoped.passed, 0);
});


// ---------------------------------------------------------------------------
// VERIFICATIONS. These pass, and they are here so triage knows the attack was
// actually run rather than waved at.
// ---------------------------------------------------------------------------

test("V1 the one-way door: only both halves open the class, in the wired diagnostic shape", () => {
  const diagnostic = testFailureDiagnostics({
    failures: [{ name: "tests::writes_pem", message: "assertion `left == right` failed" }],
    filePath: FILE,
    byteStart: SCOPE.byteStart,
    byteEnd: SCOPE.byteEnd,
  })[0];
  for (const auth of [undefined, { manualRepairGesture: false, inDiscoveredSet: false }, { manualRepairGesture: true, inDiscoveredSet: false }, { manualRepairGesture: false, inDiscoveredSet: true }]) {
    assert.strictEqual(classifyEligibility(diagnostic, SCOPE, undefined, auth).eligible, false);
  }
  assert.strictEqual(classifyEligibility(diagnostic, SCOPE, undefined, { manualRepairGesture: true, inDiscoveredSet: true }).eligible, true);
  // The automatic path's session: no fifth argument anywhere in executeSession.
  const session = new RepairSession("fngen", true);
  const action = session.next(
    testCheckResult(
      testFailureDiagnostics({ failures: [{ name: "t", message: "boom" }], filePath: FILE, byteStart: 400, byteEnd: 900 }),
      "/repo",
    ),
    SCOPE,
  );
  assert.strictEqual(action.kind, "surface");
  assert.strictEqual(action.why, "no-eligible");
});

test("V2 the span is in-scope through EVERY language's own path resolver, not just Rust's default", () => {
  for (const languageId of ["rust", "typescript", "csharp", "python", "go"]) {
    const oracle = oracleFor(languageId);
    assert.ok(oracle !== undefined, `${languageId} must have an oracle`);
    const absolute = "/repo/src/target.ext";
    assert.strictEqual(
      oracle.resolveDiagnosticPath("/repo", absolute),
      absolute,
      `${languageId}'s resolver must pass an absolute path through unchanged, or the synthesised diagnostic resolves to a different file and the whole class silently becomes out-of-span`,
    );
    const scope = { filePath: absolute, crateRoot: "/repo", byteStart: 10, byteEnd: 90, resolvePath: (r, f) => oracle.resolveDiagnosticPath(r, f) };
    const diagnostic = testFailureDiagnostics({ failures: [{ name: "t", message: "boom" }], filePath: absolute, byteStart: 10, byteEnd: 90 })[0];
    assert.strictEqual(
      classifyEligibility(diagnostic, scope, undefined, { manualRepairGesture: true, inDiscoveredSet: true }).eligible,
      true,
      `${languageId}: the synthesised diagnostic must land IN SPAN`,
    );
  }
});

test("V3 membership goes through caseMatchesFilter, not Set.has, in all four filterable languages", () => {
  assert.ok(caseMatchesFilter("rust", "shard_wal::tests::writes_pem", "writes_pem"));
  assert.ok(caseMatchesFilter("python", "tests/test_ca.py::test_writes_pem", "test_writes_pem"));
  assert.ok(caseMatchesFilter("csharp", "Ns.Tests.Writes(1, \"a\")".replace(/\(.*/, "(1)"), "Ns.Tests.Writes"));
  assert.ok(caseMatchesFilter("go", "TestWrites/pem_case", "TestWrites"));
  assert.strictEqual(runnerFilterFor("typescript", "/repo/a.test.ts"), undefined);
});

test("V4 the cap: one press of Repair Function can reach at most two model calls", () => {
  // The compiler loop and the test leg are mutually exclusive by the
  // `session.roundsUsed === 0` guard, and the refine runs only when the leg
  // returned "not-run" - which every pre-model return does.
  const guard = oracleSurface.indexOf('ctx.manualRefine === true && action.why === "clean" && session.roundsUsed === 0');
  assert.ok(guard > 0, "the guard must still read roundsUsed === 0");
  const block = oracleSurface.slice(guard, guard + 1400);
  assert.ok(block.includes('if (leg === "not-run") {'), "the refine runs only when the leg did nothing");
  const leg = testLegSource();
  const beforeFirstNext = leg.slice(0, leg.indexOf("let action = session.next("));
  assert.ok(!beforeFirstNext.includes("generateRaw"), "no model call before the session grants a round");
  const afterFirstNext = leg.slice(leg.indexOf("let action = session.next("));
  assert.strictEqual(
    (afterFirstNext.match(/return "not-run"/g) ?? []).length,
    0,
    'once a round can have run, every exit must be "ran", or the caller would add a refine call on top of the leg\'s two rounds',
  );
  assert.strictEqual((leg.match(/generateRaw\(/g) ?? []).length, 1, "one model call site, inside the capped loop");
});

test("V5 the write path: the leg's only document write is the shipped presenter", () => {
  const leg = testLegSource();
  assert.strictEqual((leg.match(/ctx\.presenter\.present\(/g) ?? []).length, 1);
  for (const forbidden of ["WorkspaceEdit", "applyEdit", "edit.replace", "fs.writeFile"]) {
    assert.ok(!leg.includes(forbidden), `the test leg must not reach for ${forbidden}`);
  }
  assert.ok(leg.includes("span: resolved.span"), "the span it may touch is the TARGET's, never a test's");
  assert.ok(oracleSurface.includes("Do NOT change any test") || fs.readFileSync(path.join(SRC, "core", "repair.ts"), "utf8").includes("Do NOT change any test"));
});

test("V6 the re-run passes the SAME RunGroup[] object the first run used", () => {
  const leg = testLegSource();
  assert.strictEqual(
    (leg.match(/groups: discovery\.groups/g) ?? []).length,
    2,
    "the before-run and the after-run must both name discovery.groups; a re-derived filter or a second discoverCoveringTests call would compare two different sets",
  );
  assert.strictEqual((leg.match(/discoverCoveringTests\(/g) ?? []).length, 1, "discovery happens once, before the loop");
});

test("V7 the wording never claims the function is correct, and never softens a still-red outcome", () => {
  const leg = testLegSource();
  assert.ok(leg.includes("which is not a statement that the function is right"));
  assert.ok(!/is correct|now correct|verified correct/.test(leg));
  assert.ok(leg.includes("still fail after the repair rounds"), "the still-red toast names the count and does not soften it");
  assert.ok(leg.includes("worseThanBeforeMessage"), "the WORSE sentence is used verbatim");
  assert.ok(leg.includes("showWarningMessage(oneLineWithPointer(`Column 80: ${broke}`))"), "and it is raised at warning severity");
});

test("V8 runDelta refuses to blame the repair for a case only one run saw", () => {
  const before = rustResult([{ name: "a", outcome: "pass" }]);
  const after = rustResult([{ name: "b", outcome: "fail" }]);
  const delta = runDelta(before, after);
  assert.deepStrictEqual(delta.broken, [], "`a` is absent from the after run, so nothing is claimed about it");
  assert.deepStrictEqual(delta.stillRed, ["b"], "`b` is red now and drives the next round without being blamed on the repair");
  assert.strictEqual(runDelta(undefined, undefined).allGreen, true, "two missing runs read as allGreen, which only the caller's own guard stops from being said");
});
