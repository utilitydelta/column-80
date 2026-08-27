// ===========================================================================
// Blast radius: how far an honest fix to this signature reaches.
//
// The professional's half of the card. A student wants to know which dimension
// they are weak on; a refactor worklist wants to know what a fix costs, and
// "changing this signature touches 14 call sites" is the input that decision
// actually needs.
//
// THE WHOLE FILE IS ABOUT WHEN TO SAY NOTHING. `undefined` is the answer
// whenever the walk did not enumerate the direct callers completely, and
// `undefined` renders as no line at all rather than as a zero. A reader cannot
// tell a measured zero from an unmeasured one, so the two must not share a
// spelling. Everything below exists to keep a partial walk from being spelled
// like a complete one.
// ===========================================================================

import {
  CallWalkResult,
  CallerNode,
  WalkBoundsUp,
  walkCallers,
} from "./callWalk";

/**
 * The bounds for a blast-radius walk, CHOSEN and not measured.
 *
 * This is not test discovery and it is not the same shape. Discovery walks UP
 * through intermediate callers to reach tests several hops away; a blast radius
 * is the DIRECT call sites and nothing else, because those are the lines an
 * honest signature change edits. So `D_MAX` is 1 by definition rather than by
 * budget.
 *
 * `R_MAX` is 2 rather than 1 so the depth cap is what stops the walk. At 1 the
 * request cap fires first and the result would report `stoppedBy: "requests"`,
 * which reads as "a budget cut this short" when in fact the walk finished the
 * only level it wanted. The stop reason is load-bearing here: it is the
 * difference between a number and no number.
 *
 * `N_MAX` bounds a pathological fan-in. A function with more direct callers
 * than this reports NO number, which is the honest answer: the walk did not
 * finish counting.
 */
export const BLAST_BOUNDS: WalkBoundsUp = { R_MAX: 2, N_MAX: 500, D_MAX: 1 };

/** Wall-clock guard, CHOSEN and not measured. Well above the one request this
 *  walk makes, and it exists only so a wedged language server cannot hang a
 *  gesture. It never decides the answer: when it fires the answer is nothing. */
export const BLAST_HANG_GUARD_MS = 5000;

/**
 * What one blast-radius walk produced.
 *
 * `callSites` is undefined whenever the count would be a claim the walk cannot
 * support. `note` says which of those it was, in a sentence, and it is never
 * empty: a refusal that does not say why is indistinguishable from a shrug, and
 * this subsystem's whole failure mode is a silence that reads as a clean
 * result.
 */
export interface BlastRadiusOutcome {
  callSites: number | undefined;
  note: string;
}

/**
 * True when a completed walk's own report supports a count.
 *
 * Pulled out of the walk call so it can be tested against a hand-built
 * `CallWalkResult` with no host and no transport. Three things void a count and
 * every one of them is a partial enumeration:
 *
 *  - a REJECTED caller request, which leaves callers unseen while the walk
 *    reports success. `testDiscovery.provenZero` requires the same field for
 *    the same reason.
 *  - a stop that is not the depth cap. The depth cap is this walk's own design
 *    and means it finished level one; anything else means a budget, a wedged
 *    server or the human's cancel cut it short.
 *  - a caller the scope test turned away. Nothing here refuses a scope, so a
 *    non-zero count means the input was wired wrong rather than that a caller
 *    was legitimately out of range.
 */
export function countIsSupported(result: CallWalkResult): boolean {
  if (result.failedRequests > 0) {
    return false;
  }
  if (result.outOfScope > 0) {
    return false;
  }
  return result.stoppedBy === undefined || result.stoppedBy === "depth";
}

/** The sentence for a walk whose count cannot be trusted. Names the cause, so
 *  the channel line a developer reads points at the dial that produced it. */
export function unsupportedNote(result: CallWalkResult): string {
  if (result.failedRequests > 0) {
    return `the caller walk had ${result.failedRequests} request(s) rejected, so its call-site count would be a lower bound rather than a count`;
  }
  if (result.outOfScope > 0) {
    return `the caller walk turned away ${result.outOfScope} caller(s) as out of scope, so its call-site count would be partial`;
  }
  switch (result.stoppedBy) {
    case "cancelled":
      return "the caller walk was cancelled, so no call-site count was produced";
    case "hang-guard":
      return "the caller walk hit its hang guard, so no call-site count was produced";
    case "requests":
      return "the caller walk ran out of request budget, so no call-site count was produced";
    case "nodes":
      return `the caller walk hit its ${BLAST_BOUNDS.N_MAX}-node bound, so no call-site count was produced`;
    default:
      return "the caller walk produced no usable call-site count";
  }
}

export interface BlastRadiusInput {
  /** The call-hierarchy root for the function under review, or undefined when
   *  the server could not place the cursor. Undefined is a RESULT: the server
   *  could not start, which is a different sentence from "nothing calls this". */
  target: CallerNode | undefined;
  resolveCallers: (node: CallerNode) => Promise<readonly CallerNode[]>;
  signal?: { readonly aborted: boolean };
  now?: () => number;
  log?: (line: string) => void;
}

/**
 * The direct call sites of one function, or nothing.
 *
 * BEST EFFORT BY CONTRACT. Every failure mode here degrades to a complete card
 * without a blast line, never to an error and never to a zero. The card is the
 * product; this is enrichment on top of it.
 *
 * `classify` says every admitted node is a result, because a blast radius wants
 * every caller and not only the tests. `inScope` admits everything for the same
 * reason: a signature change reaches a caller in a sibling crate exactly as
 * much as it reaches one next door, and refusing it would undercount the cost
 * this number exists to state.
 */
export async function blastRadius(input: BlastRadiusInput): Promise<BlastRadiusOutcome> {
  if (input.target === undefined) {
    return {
      callSites: undefined,
      note: "the language server could not place a call-hierarchy root on this function, so no call-site count was produced",
    };
  }
  if (input.signal?.aborted === true) {
    return { callSites: undefined, note: "the caller walk was cancelled before it started" };
  }
  const result = await walkCallers({
    target: input.target,
    resolveCallers: input.resolveCallers,
    classify: () => "test",
    inScope: () => true,
    bounds: BLAST_BOUNDS,
    signal: input.signal,
    hangGuardMs: BLAST_HANG_GUARD_MS,
    now: input.now,
    log: input.log,
  });
  if (!countIsSupported(result)) {
    return { callSites: undefined, note: unsupportedNote(result) };
  }
  const direct = result.tests.filter((t) => t.distance === 1).length;
  return {
    callSites: direct,
    note: `the caller walk enumerated ${direct} direct call site(s) in ${result.requests} request(s)`,
  };
}
