/**
 * ONE covering-test mechanism, two gestures.
 *
 * Run Covering Tests (`column80.runTests`) and the Repair Function test leg both
 * come through here, so what the developer just looked at is exactly what the
 * model gets. A second derivation of "which tests cover this function" is the
 * defect session-v60's design exists to prevent: the harness would then be
 * measuring something the product never runs, and the number reported would be
 * about the harness.
 *
 * The bounds, the scope predicate, the run-target resolution and the sequential
 * group run all live here. What does NOT live here is the transport - the call
 * hierarchy is a vscode command, so `resolveCallers`, `readLines` and the walk
 * root arrive from the caller, and this module stays pure enough to bundle
 * headless.
 */

import { CallerNode, WalkBoundsUp } from "./callWalk";
import { TestOracleResult, oracleFor, runFrameworkTestsAt } from "./compilerOracle";
import { GroupOutcome } from "./runTestsReport";
import { ClassifyLang, caseMatchesFilter } from "./testClassify";
import { RunGroup, TargetResolution } from "./testRunGroup";
import { TddDeps, TddLang, TestRunScope, frameworkFor, tddLangFor } from "./tddLang";

/**
 * The Run Covering Tests bounds. FIXED, and not settings: a developer cannot be
 * asked to tune a request budget they have no way to measure, and a walk whose
 * budget moves under it stops being comparable to the one that was graded.
 *
 * CALIBRATION, RE-MEASURED during the build because the scout's node figure was
 * short. The complete crate-scoped walk on the worst function measured is
 * **112 caller-resolution requests and 415 admitted nodes**, reaching depth 8
 * with 303 covering tests. The scout recorded 307 nodes; running the product's
 * own walk over the same crate gives 415, and `N_MAX = 400` TRUNCATED it, to 289
 * tests with `stoppedBy: "nodes"`. The completion point was found directly:
 * 400 truncates, and 800 / 1200 / 2000 all return the identical 112/415/303.
 *
 * So N_MAX is 600: above the measured 415 with headroom, and far below the point
 * where a runaway walk stops being bounded. Every cap here sits above the
 * measured worst case, so an ordinary walk finishes and can report a PROVEN zero
 * rather than a truncated one.
 *
 * D_MAX stays at 8 and is a REAL cut on a crate with a shared test harness: two
 * of four measured functions still report `stoppedBy: "depth"`, and the surface
 * says the search did not finish, which is true. The scout's grading is what
 * makes 8 the right number anyway: depth 8 already reaches 100% of the tests that
 * EXECUTE the target, so raising it buys recall that is already complete and
 * spends requests to do it.
 */
export const RUN_TESTS_R_MAX = 150;
export const RUN_TESTS_N_MAX = 600;
export const RUN_TESTS_D_MAX = 8;
/** A wall-clock HANG GUARD, never the bound: it fires only when a language
 *  server stops answering altogether, well after the request cap would have
 *  ended a walk that is merely slow. */
export const RUN_TESTS_HANG_GUARD_MS = 20000;

/**
 * Per-language facts the covering-test gestures need and the TDD leg does not
 * carry: what the walk's classifier calls this language, and the word the report
 * uses for the scope the search was confined to.
 *
 * The scope word is the developer's own name for the thing a Cargo.toml, a
 * go.mod, a .csproj, a pyproject.toml or a package.json marks out, because the
 * strongest sentence the report makes ("no test in this crate calls X") is only
 * true of that scope and has to name it in the language's own terms.
 *
 * Keyed by every languageId `tddLanguageIds()` registers. A languageId missing
 * here has no leg for these gestures and is refused by name, same as one with no
 * TDD leg at all.
 */
export const RUN_TESTS_LANGS: Record<string, { classifyLang: ClassifyLang; scopeWord: string }> = {
  rust: { classifyLang: "rust", scopeWord: "crate" },
  go: { classifyLang: "go", scopeWord: "module" },
  csharp: { classifyLang: "csharp", scopeWord: "project" },
  python: { classifyLang: "python", scopeWord: "project" },
  // THE TYPESCRIPT FAMILY IS DELIBERATELY ABSENT (adversarial review row A3).
  //
  // tsserver resolves a call-hierarchy query to the FILE, measured in the real
  // host as a `Module` item named for the file, so the walk here resolves
  // TypeScript to FILES rather than to individual tests. `classifyTestNode`
  // answers "plain" for every TypeScript node in consequence, so no TS node can
  // ever be admitted as a test, `discovered` is always empty, and `provenZero`
  // is therefore always true. That made the product state its STRONGEST sentence
  // - "no test in this package calls X, directly or through any caller I could
  // reach" - as a fact, when the truth is that the walk cannot name a TypeScript
  // test at all. A false claim, in the one place this design exists to refuse
  // one.
  //
  // The file-granular leg needs a runner path that runs a FILE with no `-t`
  // title filter, which neither vitest's nor jest's shipped `buildCommand`
  // offers, so it is a build of its own rather than a line here. Until it exists
  // both gestures refuse these languageIds BY NAME, with the same honest-dark
  // sentence every unregistered language gets. The file-granular branches in
  // `runTestsReport.ts` are unreachable meanwhile and are kept for that leg.
};

/** Everything `discoverCoveringTests` and the run loop need for one language and
 *  one target, resolved once and shared by both gestures. */
export interface CoveringTestPlan {
  lang: TddLang;
  classifyLang: ClassifyLang;
  scopeWord: string;
  bounds: WalkBoundsUp;
  hangGuardMs: number;
  runScope: TestRunScope;
  /** The language's OWN scope root for the target, so a caller is never told it
   *  belongs to a different crate/module/project from the one that compiles it. */
  inScope: (node: CallerNode) => boolean;
  resolveTarget: (filePath: string) => TargetResolution;
  /** The framework OBJECT for a run root, which `resolveTarget` only recorded the
   *  id of. Cached, so a re-run of the same groups pays nothing. */
  frameworkAt: (root: string) => ReturnType<typeof frameworkFor>;
}

/**
 * The plan, or undefined when this language has no covering-test leg.
 *
 * Undefined covers BOTH gaps - no TDD leg at all, and a TDD leg with no row in
 * `RUN_TESTS_LANGS` - because the honest sentence for both is the same: this
 * gesture is not built for that language. Splitting them would imply the gesture
 * exists here and something else went wrong.
 */
export function coveringTestPlan(input: {
  languageId: string;
  /** The file the TARGET function lives in. Its root is the scope. */
  targetFilePath: string;
  log: (line: string) => void;
}): CoveringTestPlan | undefined {
  const lang = tddLangFor(input.languageId);
  const langScope = RUN_TESTS_LANGS[input.languageId];
  if (lang === undefined || langScope === undefined) {
    return undefined;
  }
  const tddDeps: TddDeps = { log: input.log };
  // Through the same detection the check rung uses rather than a second finder.
  const rootOracle = oracleFor(input.languageId);
  const targetRoot = rootOracle?.detectCrateRoot(input.targetFilePath);
  // Cached per file: the walk asks about the same handful of test files hundreds
  // of times, and each answer is a walk up the filesystem.
  const rootCache = new Map<string, string | undefined>();
  const rootFor = (filePath: string): string | undefined => {
    if (!rootCache.has(filePath)) {
      rootCache.set(filePath, rootOracle?.detectCrateRoot(filePath));
    }
    return rootCache.get(filePath);
  };
  const frameworkCache = new Map<string, ReturnType<typeof frameworkFor>>();
  const frameworkAt = (root: string): ReturnType<typeof frameworkFor> => {
    const cached = frameworkCache.get(root);
    if (cached !== undefined) {
      return cached;
    }
    const resolvedFramework = frameworkFor(lang, root, tddDeps);
    frameworkCache.set(root, resolvedFramework);
    return resolvedFramework;
  };
  const resolveTarget = (filePath: string): TargetResolution => {
    // `runTargetForTestFile`, never `placementFor`: this file already HOLDS the
    // tests, so the question is where to run it FROM, and deriving a write
    // target from a test path produces nonsense.
    const placed = lang.runTargetForTestFile(filePath, tddDeps);
    if (!placed.ok) {
      return { ok: false, reason: placed.refusal.detail };
    }
    const resolvedFramework = frameworkAt(placed.placement.runRoot);
    if (!resolvedFramework.ok) {
      const detail =
        resolvedFramework.detail ??
        `looked for ${resolvedFramework.lookedFor.join(", ")} in ${placed.placement.runRoot}`;
      return { ok: false, reason: `no test framework to run it with (${detail})` };
    }
    return { ok: true, placement: placed.placement, frameworkId: resolvedFramework.framework.id };
  };
  return {
    lang,
    classifyLang: langScope.classifyLang,
    scopeWord: langScope.scopeWord,
    bounds: { R_MAX: RUN_TESTS_R_MAX, N_MAX: RUN_TESTS_N_MAX, D_MAX: RUN_TESTS_D_MAX },
    hangGuardMs: RUN_TESTS_HANG_GUARD_MS,
    runScope: lang.runScope,
    // No root for the TARGET means there is nothing to be outside OF, so
    // everything is admitted: refusing everything instead would report a zero,
    // and a zero that really means "I could not find a project root" is the
    // false certificate this whole design exists to refuse.
    inScope: (node) => (targetRoot === undefined ? true : rootFor(node.filePath) === targetRoot),
    resolveTarget,
    frameworkAt,
  };
}

export type CoveringGroupsRun =
  | { cancelled: true }
  | { cancelled: false; outcomes: GroupOutcome[] };

/**
 * Run every discovered group, sequentially, honouring the abort signal.
 *
 * The caller passes the SAME `RunGroup[]` object every time it wants this set
 * run. The repair leg's after-run depends on that: the function changed, but
 * "which tests cover it" was answered before the change, and re-answering
 * mid-loop would compare two different sets and call the difference a result.
 *
 * `firstLine` is injected because it is the product's one line-bound definition
 * (`src/vscode/toastText.ts`) and core does not import the vscode layer. A second
 * copy here would be a second definition of what ends a line.
 */
export async function runCoveringGroups(input: {
  groups: readonly RunGroup[];
  frameworkAt: (root: string) => ReturnType<typeof frameworkFor>;
  signal: AbortSignal;
  isCancellation: (err: unknown) => boolean;
  firstLine: (s: string | undefined) => string;
  log: (line: string) => void;
}): Promise<CoveringGroupsRun> {
  const outcomes: GroupOutcome[] = [];
  for (const group of input.groups) {
    // BETWEEN groups, never mid-spawn. A cancel here stops the next runner from
    // starting and is a CANCEL, not a failure: nothing failed, the human asked
    // for it to stop.
    if (input.signal.aborted) {
      return { cancelled: true };
    }
    const resolvedFramework = input.frameworkAt(group.placement.runRoot);
    if (!resolvedFramework.ok) {
      // Unreachable while `resolveTarget` is the only producer of groups,
      // because it refuses a file whose root has no framework before a group can
      // be built. RECORDED rather than skipped even so: a group that vanished
      // silently between discovery and the run is the false green.
      outcomes.push({
        key: group.key,
        frameworkName: group.frameworkId,
        tests: group.tests,
        failure: `no test framework in ${group.placement.runRoot}, so these tests were not run.`,
      });
      continue;
    }
    const framework = resolvedFramework.framework;
    let result: TestOracleResult | undefined;
    try {
      result = await runFrameworkTestsAt(
        framework,
        group.placement,
        group.tests.map((t) => t.filter),
        { log: input.log, signal: input.signal },
      );
    } catch (err) {
      if (input.isCancellation(err)) {
        return { cancelled: true };
      }
      // The spawn itself failed: the runner binary is not on PATH, or the
      // process could not start. NOT a compile error, since nothing was built.
      // The other groups still run, and this one carries its reason into the
      // report.
      outcomes.push({
        key: group.key,
        frameworkName: framework.displayName,
        tests: group.tests,
        failure: `the run could not start: ${input.firstLine(String(err))}. Nothing was built and no test ran.`,
      });
      continue;
    }
    outcomes.push({
      key: group.key,
      frameworkName: framework.displayName,
      tests: group.tests,
      result,
      classifiesBuildError: framework.classifiesBuildError,
    });
  }
  if (input.signal.aborted) {
    return { cancelled: true };
  }
  return { cancelled: false, outcomes };
}

/** Every runner filter the run actually SELECTED, which is the discovered set
 *  membership is tested against.
 *
 *  The groups, not `discovery.discovered`: an excluded or unrunnable test is
 *  discovered and SAID, and it never ran, so a failure carrying its name came
 *  from somewhere else and is not this function's problem. */
export function discoveredFilters(groups: readonly RunGroup[]): Set<string> {
  const filters = new Set<string>();
  for (const group of groups) {
    for (const test of group.tests) {
      filters.add(test.filter);
    }
  }
  return filters;
}

/**
 * THE CASE NAME A RUN THAT DID NOT RUN ENUMERATES AS (adversarial review row
 * A1b).
 *
 * A group that did not run says nothing about any test in it, so the honest
 * enumeration is not "no failures" - that is what let a broken build read as a
 * green - but ONE entry standing for the whole group. It is not a test name and
 * cannot collide with one, and `shapesWithinDiscoveredSet` keeps it whatever the
 * discovered set holds, because a no-run is a statement about the entire set
 * rather than about one member of it.
 */
export const RUN_DID_NOT_HAPPEN = "(the run itself did not happen)";

/** Why one group's run produced no test result, in the SHIPPED four-outcome
 *  vocabulary (`reportNoRun` and `renderRunTestsReport`), never a fifth. */
export type NoRunReason =
  | "buildError"
  | "filterMatchedNothing"
  | "environmentError"
  | "unclassified"
  | "notAttempted";

export interface NoRunOutcome {
  key: string;
  frameworkName: string;
  reason: NoRunReason;
  /** The sentence for the human: the reason NAMED, never just flagged. */
  detail: string;
}

/**
 * The groups whose run DID NOT RUN, each with its reason named (adversarial
 * review row A1, HIGH).
 *
 * Phase B1's wording rule 9 - a run that did not run is not a pass - was
 * enforced on the report gesture and nowhere on the repair leg, which computed
 * its verdict from the failures the after-run enumerated. A build error, an
 * environment error, a filter that matched nothing and a run that executed zero
 * tests all enumerate NO failures, so the still-red count was zero and the
 * developer was told the covering tests pass on code that does not compile.
 *
 * Every caller that is about to say something green must ask this first, and say
 * THIS instead when the answer is non-empty.
 */
export function outcomesThatDidNotRun(outcomes: readonly GroupOutcome[]): NoRunOutcome[] {
  const notRun: NoRunOutcome[] = [];
  for (const outcome of outcomes) {
    if (outcome.failure !== undefined) {
      notRun.push({ key: outcome.key, frameworkName: outcome.frameworkName, reason: "notAttempted", detail: outcome.failure });
      continue;
    }
    const res = outcome.result;
    if (res === undefined) {
      notRun.push({
        key: outcome.key,
        frameworkName: outcome.frameworkName,
        reason: "notAttempted",
        detail: "the run did not happen, and named no reason.",
      });
      continue;
    }
    if (res.ran && res.passed + res.failed > 0) {
      continue;
    }
    if (res.filterMatchedNothing === true) {
      notRun.push({
        key: outcome.key,
        frameworkName: outcome.frameworkName,
        reason: "filterMatchedNothing",
        detail: `the filter matched nothing; it selected none of ${outcome.tests.map((t) => t.filter).join(", ") || "the discovered tests"}. Zero tests ran, so this is not a pass.`,
      });
    } else if (res.environmentError !== undefined) {
      notRun.push({
        key: outcome.key,
        frameworkName: outcome.frameworkName,
        reason: "environmentError",
        detail: `the run could not start. ${res.environmentError}`,
      });
    } else if (res.buildError !== undefined) {
      notRun.push({
        key: outcome.key,
        frameworkName: outcome.frameworkName,
        reason: "buildError",
        detail: `the tests did not compile. ${res.buildError}`,
      });
    } else if (res.ran) {
      // The FIFTH shape that is still one of the four sentences: the runner ran
      // and executed nothing. Every selected test was skipped, so nothing passed
      // and nothing failed, and the green rule below must not read it as a pass.
      notRun.push({
        key: outcome.key,
        frameworkName: outcome.frameworkName,
        reason: "unclassified",
        detail: "the runner executed no test at all: every selected test was skipped. Nothing passed and nothing failed.",
      });
    } else {
      notRun.push({
        key: outcome.key,
        frameworkName: outcome.frameworkName,
        reason: "unclassified",
        detail: "the runner produced no result, and reported no test, no failure and no reason.",
      });
    }
  }
  return notRun;
}

/** Every failure the run reported, across every group, in group order.
 *
 *  A group whose runner ANSWERED and answered "nothing ran" contributes the
 *  `RUN_DID_NOT_HAPPEN` entry instead of nothing at all (review row A1b): a
 *  caller that derives its still-red count from this list would otherwise get a
 *  zero out of a broken build and call it a pass. A group that never produced a
 *  result carries its reason on `failure` and is enumerated the same way. */
export function failuresOf(outcomes: readonly GroupOutcome[]): Array<{ name: string; message: string }> {
  const failures: Array<{ name: string; message: string }> = [];
  const notRun = new Map(outcomesThatDidNotRun(outcomes).map((n) => [n.key, n]));
  for (const outcome of outcomes) {
    const didNotRun = notRun.get(outcome.key);
    if (didNotRun !== undefined) {
      failures.push({ name: RUN_DID_NOT_HAPPEN, message: `${didNotRun.frameworkName}: ${didNotRun.detail}` });
      continue;
    }
    for (const failure of outcome.result?.failures ?? []) {
      failures.push({ name: failure.name, message: failure.message });
    }
  }
  return failures;
}

/**
 * The outcomes with every case and every failure NARROWED to the tests the walk
 * actually discovered (adversarial review rows A4 and A5).
 *
 * A Rust filter the call hierarchy named bare gets no `--exact`, so libtest
 * substring-matches and the spawn executes tests the walk never selected. Those
 * cases flowed straight into `runTotals` and into `runDelta`, which made the
 * number printed to the model ("N of 3 covering test(s) failed") and the number
 * toasted to the developer claim to be the covering set while being something
 * wider, and let ONE press say "the repair made things WORSE" about a neighbour
 * and "the covering tests now pass" in the same breath. The substring behaviour
 * itself stays and is recorded in session-v60/scraps.md S60-2; what must not
 * stand is a count that claims to be the covering set and is not.
 *
 * Membership is `caseMatchesFilter`, never `Set.has`: libtest reports
 * `shard_wal::tests::x` for a filter named `x`.
 *
 * `casesComplete === false` (C#, which never enumerates a passing test) keeps
 * its own `passed` count, because a recount over failures alone would report
 * zero passes for a green run. Its FAILURES still narrow, which is the half the
 * verdict turns on.
 */
export function withinDiscoveredSet(
  outcomes: readonly GroupOutcome[],
  discovered: ReadonlySet<string>,
  lang: ClassifyLang,
): GroupOutcome[] {
  const filters = [...discovered];
  const keep = (name: string): boolean =>
    name === RUN_DID_NOT_HAPPEN || filters.some((f) => caseMatchesFilter(lang, name, f));
  return outcomes.map((outcome) => {
    const res = outcome.result;
    if (res === undefined) {
      return outcome;
    }
    const cases = res.cases.filter((c) => keep(c.name));
    const failures = res.failures.filter((f) => keep(f.name));
    if (res.casesComplete === false) {
      return { ...outcome, result: { ...res, failures, cases, failed: failures.length } };
    }
    const passed = cases.filter((c) => c.outcome === "pass").length;
    const failed = cases.filter((c) => c.outcome === "fail").length;
    return { ...outcome, result: { ...res, cases, failures, passed, failed } };
  });
}

/** How many tests ran and how many passed, across every group: the honest header
 *  the evidence block leads with. */
export function runTotals(outcomes: readonly GroupOutcome[]): { ran: number; passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  for (const outcome of outcomes) {
    const res = outcome.result;
    if (res === undefined || !res.ran) {
      continue;
    }
    passed += res.passed;
    failed += res.failed;
  }
  return { ran: passed + failed, passed, failed };
}
