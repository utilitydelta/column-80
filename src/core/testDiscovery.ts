/**
 * The ONE discovery entry point. Run Tests and Repair Function both call this,
 * so what the developer just looked at is exactly what the model gets: one
 * mechanism, two gestures. A second derivation of the same set is how a harness
 * ends up measuring something the product never runs.
 *
 * Pure: the graph arrives through `resolveCallers`, the text through `readLines`,
 * the run targets through `resolveTarget`. No filesystem, no vscode, no clock
 * except the walk's own hang guard.
 */

import { CallWalkResult, CallerNode, WalkBoundsUp, walkCallers } from "./callWalk";
import { ClassifyLang, classifyTestNode, runnerFilterFor } from "./testClassify";
import { Exclusion, testExclusion } from "./testExclusion";
import { RunGroup, RunScope, RunnableTest, TargetResolution, groupTestRuns } from "./testRunGroup";

export interface DiscoveredEntry {
  name: string;
  filePath: string;
  distance: number;
  path: string[];
  /** Present when the test is discovered but must not be RUN. */
  excluded?: Exclusion;
  /** Present when the test would run but could not become one. */
  unrunnable?: string;
}

export interface DiscoveryReport {
  /** EVERY discovered test, runnable or not, ordered by distance then file then name. */
  discovered: DiscoveredEntry[];
  /** The groups to spawn. Excluded and unrunnable tests are absent from these. */
  groups: RunGroup[];
  /** The walk's own accounting, verbatim, so the surface can say what bounded it. */
  walk: CallWalkResult;
  /** True ONLY when the walk completed with NO bound hit, NO rejected request,
   *  and found no test.
   *
   *  This is the only thing licensed to produce the product's strongest
   *  sentence - "no test in this crate calls create_ca, directly or through any
   *  caller I could reach". A bounded walk that found nothing found nothing
   *  WITHIN A BUDGET, which is a different claim, and reporting it as this one
   *  would turn a truncation into a certificate.
   *
   *  `failedRequests === 0` is part of the test and not a refinement of it. A
   *  rejecting `resolveCallers` is survivable, so the walk keeps going and
   *  leaves `stoppedBy` absent - but the subtree behind that rejection was NEVER
   *  SEEN, and a zero that rests on it is a budget dressed as a fact
   *  (adversarial review row A12).
   *
   *  `outOfScope` is deliberately NOT part of the test. Scope is the designed
   *  answer, not a failure: for Rust the crate IS the question, so a walk that
   *  refused out-of-crate callers and found nothing has proved what the sentence
   *  claims (adversarial review row A13). */
  provenZero: boolean;
}

export interface DiscoverInput {
  target: CallerNode;
  lang: ClassifyLang;
  resolveCallers: (node: CallerNode) => Promise<readonly CallerNode[]>;
  /** Lines for classification and exclusion. Undefined for an unreadable file. */
  readLines: (filePath: string) => readonly string[] | undefined;
  inScope: (node: CallerNode) => boolean;
  bounds: WalkBoundsUp;
  runScope: RunScope;
  resolveTarget: (filePath: string) => TargetResolution;
  signal?: { readonly aborted: boolean };
  hangGuardMs?: number;
  log?: (line: string) => void;
}

/** The reason a discovered test's name could not become a runner filter. Said in
 *  full rather than dropped: the developer can SEE the test in the report, and a
 *  set that quietly shrinks between "found" and "ran" is the false green. */
const NO_FILTER = "the server's name for this test cannot become a runner filter";

function compareEntries(a: DiscoveredEntry, b: DiscoveredEntry): number {
  return (
    a.distance - b.distance ||
    (a.filePath < b.filePath ? -1 : a.filePath > b.filePath ? 1 : 0) ||
    (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
  );
}

export async function discoverCoveringTests(input: DiscoverInput): Promise<DiscoveryReport> {
  const { lang, readLines } = input;
  const walk = await walkCallers({
    target: input.target,
    resolveCallers: input.resolveCallers,
    classify: (node) =>
      classifyTestNode(lang, {
        name: node.name,
        filePath: node.filePath,
        lines: readLines(node.filePath),
        rangeStartLine: node.line,
        selectionStartLine: node.nameLine,
      }),
    inScope: input.inScope,
    bounds: input.bounds,
    signal: input.signal,
    hangGuardMs: input.hangGuardMs,
    log: input.log,
  });

  const discovered: DiscoveredEntry[] = [];
  const runnable: RunnableTest[] = [];
  // Identity, not a re-match on (file, distance): two tests in one file at one
  // distance are ordinary, and a re-match would write one test's refusal onto
  // another's row. The grouper hands back the very objects it was given.
  const entryOf = new Map<RunnableTest, DiscoveredEntry>();
  for (const found of walk.tests) {
    const node = found.node;
    const entry: DiscoveredEntry = {
      name: node.name,
      filePath: node.filePath,
      distance: found.distance,
      path: found.path,
    };
    // Exclusion runs AFTER the walk, on every discovered test. It is a run
    // filter, never a discovery filter: an excluded test is still something a
    // developer is owed the sight of, with the marker that excluded it.
    const excluded = testExclusion(lang, {
      name: node.name,
      filePath: node.filePath,
      lines: readLines(node.filePath),
      rangeStartLine: node.line,
      selectionStartLine: node.nameLine,
    });
    if (excluded !== undefined) {
      entry.excluded = excluded;
      discovered.push(entry);
      continue;
    }
    const filter = runnerFilterFor(lang, node.name);
    if (filter === undefined) {
      entry.unrunnable = NO_FILTER;
      discovered.push(entry);
      continue;
    }
    discovered.push(entry);
    const runnableTest: RunnableTest = {
      filter,
      filePath: node.filePath,
      distance: found.distance,
      path: found.path,
    };
    runnable.push(runnableTest);
    entryOf.set(runnableTest, entry);
  }

  const grouped = groupTestRuns({ tests: runnable, runScope: input.runScope, resolveTarget: input.resolveTarget });
  // A test the grouper could not place gets its reason written back onto the
  // entry the developer reads, so one list answers "what did you find" and "what
  // will you run" without the two disagreeing.
  for (const { test, reason } of grouped.unrunnable) {
    const entry = entryOf.get(test);
    if (entry !== undefined) {
      entry.unrunnable = reason;
    }
  }

  discovered.sort(compareEntries);
  const provenZero = walk.stoppedBy === undefined && walk.failedRequests === 0 && discovered.length === 0;
  input.log?.(
    `[discover] found=${discovered.length} runnable=${runnable.length} groups=${grouped.groups.length}` +
      ` excluded=${discovered.filter((d) => d.excluded !== undefined).length} provenZero=${provenZero}`,
  );
  return { discovered, groups: grouped.groups, walk, provenZero };
}
