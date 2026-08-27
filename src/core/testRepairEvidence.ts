/**
 * Turning a red test run into something `RepairSession` can route.
 *
 * The repair loop is diagnostic-shaped: `next()` takes an `OracleCheckResult`,
 * filters to `level === "error"`, and classifies each one. A failing test is not
 * a compiler diagnostic, so this module makes it look like one - carefully,
 * because the exact shape decides whether three of `classifyEligibility`'s five
 * refusal branches keep guarding anything.
 *
 * THE PRIMARY SPAN IS THE TARGET FUNCTION'S SPAN, and that is the load-bearing
 * decision. `classifyEligibility` refuses a diagnostic with no primary span, and
 * one whose primary span sits outside the repair scope. Session-v60 authorises
 * exactly the two ASSERTION refusals and promises the other three keep applying
 * unchanged; that promise is only true if a test-failure diagnostic cannot trip
 * them. Setting the span to the PANIC LOCATION instead would have been the quiet
 * way to break it: an `assert_eq!` panics in the TEST file, which is out of
 * scope, so almost every real assertion failure would have been refused by a
 * branch nobody meant to touch, and the feature would have looked implemented
 * while doing nothing.
 *
 * The panic location still reaches the model - as rendered TEXT, inside the
 * evidence, where it belongs.
 *
 * ONE DIAGNOSTIC PER FAILING TEST, not one per shape. The session's round-2 rule
 * asks whether the error count is still FALLING, and the honest reading of that
 * for this oracle is "are fewer tests failing than last round". Counting shapes
 * would let a round that fixed four of five tests in one shape read as no
 * progress at all.
 */

import { Diagnostic, TestOracleResult } from "./compilerOracle";
import { FailureShape } from "./failureDigest";
import { RUN_DID_NOT_HAPPEN } from "./coveringTestRun";
import { ClassifyLang, caseMatchesFilter } from "./testClassify";

export interface TestFailureDiagnosticInput {
  /** The failing tests, as the runners reported them. */
  failures: readonly { name: string; message: string }[];
  /** Absolute path of the file the target function lives in, as the oracle's
   *  span resolution spells it. */
  filePath: string;
  /** The target function's byte span: what repair is allowed to touch. */
  byteStart: number;
  byteEnd: number;
  /** The rendered evidence block, already budgeted. Carried on the FIRST
   *  diagnostic so a consumer reading `rendered` sees the digest once rather
   *  than the same text repeated per test. */
  evidence?: string;
}

/**
 * One error-level `assertion-failure` diagnostic per failing test, each anchored
 * on the target function's own span.
 *
 * `fileName` is the ABSOLUTE path rather than a crate-relative one. The scope
 * test resolves a diagnostic's `fileName` through the strategy's resolver and
 * compares by identity, and the resolvers pass an already-absolute path through
 * unchanged, so this lands inside the scope in every language without inventing
 * a relative form that only one of them would spell correctly.
 */
export function testFailureDiagnostics(input: TestFailureDiagnosticInput): Diagnostic[] {
  return input.failures.map((failure, index) => ({
    level: "error" as const,
    kind: "assertion-failure" as const,
    message: `${failure.name} failed: ${firstLineOf(failure.message)}`,
    // Only the first carries the digest. The rest exist to be COUNTED: they are
    // what makes "is the failing-test count falling" a real question.
    rendered: index === 0 ? input.evidence : undefined,
    // No suggestions, ever. A suggestion is rustc's own machine-applicable fix,
    // and a test run has none: nothing about a red test says what to write.
    suggestions: [],
    spans: [
      {
        fileName: input.filePath,
        isPrimary: true,
        byteStart: input.byteStart,
        byteEnd: input.byteEnd,
        // The line/column fields are display coordinates for the Problems
        // mirror. A test failure has no line inside the function to point at,
        // and the eligibility test reads BYTES only, so these carry the -1
        // no-conversion sentinel the oracle already uses for a position it
        // could not convert rather than a fabricated 1:1.
        lineStart: -1,
        lineEnd: -1,
        columnStart: -1,
        columnEnd: -1,
      },
    ],
  }));
}

function firstLineOf(message: string): string {
  const line = (message ?? "").split(/\r?\n/).find((l) => l.trim().length > 0);
  return (line ?? "(the runner reported no message)").trim();
}

/** The check result a `RepairSession` consumes for a test round. Shaped exactly
 *  like a compiler check so the session needs no second entry point. */
export function testCheckResult(diagnostics: Diagnostic[], crateRoot: string): {
  success: boolean;
  diagnostics: Diagnostic[];
  crateRoot: string;
  durationMs: number;
} {
  return { success: diagnostics.length === 0, diagnostics, crateRoot, durationMs: 0 };
}

// ---------------------------------------------------------------------------
// Before and after
// ---------------------------------------------------------------------------

export interface RunDelta {
  /** Test filters that were RED before and GREEN after. */
  fixed: string[];
  /** GREEN before and RED after. The outcome that must be reported in those
   *  words: a repair that made things worse is a real result, not a theoretical
   *  one, and one measured seed went from 2 red to 7 under every arm. */
  broken: string[];
  /** Red before and still red. */
  stillRed: string[];
  /** True when nothing is red any more. */
  allGreen: boolean;
}

/** Compare two runs of THE SAME discovered set.
 *
 *  Keyed on the runner's own case NAMES, and only cases present in BOTH runs are
 *  compared: a case that appears in one run and not the other says something
 *  about the filter or the build, not about the repair, and calling that
 *  "broken" would blame a model for a run that never happened. */
export function runDelta(before: TestOracleResult | undefined, after: TestOracleResult | undefined): RunDelta {
  const outcomeOf = (res: TestOracleResult | undefined): Map<string, boolean> => {
    const map = new Map<string, boolean>();
    for (const c of res?.cases ?? []) {
      if (c.outcome === "pass" || c.outcome === "fail") {
        map.set(c.name, c.outcome === "pass");
      }
    }
    // C# never enumerates passing tests (`casesComplete: false`), so its `cases`
    // carries the failures alone. Every FAILURE is still there, which is the
    // half this comparison turns on, and a name absent from both maps simply
    // does not participate.
    for (const f of res?.failures ?? []) {
      map.set(f.name, false);
    }
    return map;
  };
  const was = outcomeOf(before);
  const now = outcomeOf(after);
  const fixed: string[] = [];
  const broken: string[] = [];
  const stillRed: string[] = [];
  for (const [name, passedBefore] of was) {
    const passedAfter = now.get(name);
    if (passedAfter === undefined) {
      continue; // not in both runs: not this repair's to claim or be blamed for
    }
    if (!passedBefore && passedAfter) {
      fixed.push(name);
    } else if (passedBefore && !passedAfter) {
      broken.push(name);
    } else if (!passedBefore && !passedAfter) {
      stillRed.push(name);
    }
  }
  // A newly red test that the BEFORE run never saw still counts as red now, and
  // drives the next round; it is just not attributed to the repair as "broken".
  for (const [name, passedNow] of now) {
    if (!passedNow && !was.has(name) && !stillRed.includes(name)) {
      stillRed.push(name);
    }
  }
  fixed.sort();
  broken.sort();
  stillRed.sort();
  // A RE-RUN THAT NEVER RAN IS NEVER ALL GREEN (adversarial review row A1, HIGH).
  //
  // The comparison above enumerates nothing for an after-run that did not
  // happen: a build error, an environment error and a filter that matched
  // nothing all report zero cases and zero failures, so `broken` and `stillRed`
  // are empty and the verdict read as success on code that does not compile.
  // Phase B1's wording rule 9 applied to the report gesture and to this one
  // equally. An after-run of `undefined` is the SEPARATE case of no re-run being
  // attempted at all, which only the caller's own guard can speak to, so it is
  // left alone.
  const afterRan = after === undefined || (after.ran && after.passed + after.failed > 0);
  return { fixed, broken, stillRed, allGreen: afterRan && broken.length === 0 && stillRed.length === 0 };
}

/** The sentence for a repair that made things WORSE, or undefined when it did
 *  not. Said in those words, because the alternative is a developer discovering
 *  it by reading their own test output afterwards. */
export function worseThanBeforeMessage(delta: RunDelta, symbolName: string): string | undefined {
  if (delta.broken.length === 0) {
    return undefined;
  }
  const n = delta.broken.length;
  const fixedPart = delta.fixed.length > 0 ? ` It did fix ${delta.fixed.length}.` : "";
  return (
    `the repair of ${symbolName} made things WORSE: ${n} test${n === 1 ? "" : "s"} that passed before now fail ` +
    `(${delta.broken.slice(0, 5).join(", ")}${n > 5 ? ", ..." : ""}).${fixedPart}`
  );
}

/**
 * The digest's shapes, filtered to the tests the walk actually discovered. A red
 * test elsewhere in the repo is not this function's problem, and the
 * authorization that opens assertion eligibility requires membership.
 *
 * Membership goes through `caseMatchesFilter` and NOT through `Set.has`. The
 * runner's case name and the walk's filter are different strings: libtest
 * reports `shard_wal::tests::chain_read_...` for a filter the call hierarchy
 * named `chain_read_...`. MEASURED while running the seeded-defect arm against
 * the real crate: a `Set.has` membership test matched ZERO of 40 real failures,
 * which would have left every Rust repair round with no evidence and no
 * authorization while looking perfectly wired.
 */
export function shapesWithinDiscoveredSet(
  shapes: readonly FailureShape[],
  discovered: ReadonlySet<string>,
  lang: ClassifyLang,
): FailureShape[] {
  const filters = [...discovered];
  const kept: FailureShape[] = [];
  for (const shape of shapes) {
    // A group that DID NOT RUN is a statement about the whole discovered set, not
    // about one member of it, so no membership test may drop it (review row
    // A1b). Dropping it is what turned a broken build into a still-red count of
    // zero and then into "the covering tests now pass".
    const names = shape.names.filter(
      (n) => n === RUN_DID_NOT_HAPPEN || filters.some((f) => caseMatchesFilter(lang, n, f)),
    );
    if (names.length === 0) {
      continue;
    }
    kept.push({ ...shape, names, count: names.length });
  }
  return kept;
}
