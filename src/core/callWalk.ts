/**
 * The recursive call walk: a bounded breadth-first search UP the caller graph
 * from a target function, answering "which of this repo's tests reach this
 * function, and how far away are they".
 *
 * Shaped exactly like `walkDataShape` (dataShape.ts) with the edges reversed:
 * pure, reaching the graph only through an injected `resolveCallers` edge so the
 * LSP transport lives in the vscode layer, with a `visited` set killing cycles
 * and a 3-D structural bound.
 *
 * THE BOUND IS A REQUEST CAP, NOT A CLOCK, and that is the load-bearing decision
 * in this file. Measured on one real function, same code, same server, only the
 * server's cache differing (goal.md Phase A):
 *
 *   250ms -> 1 request, 0 tests found       2000ms -> 113 requests, 303 tests
 *   500ms -> 6 requests, 6 tests found      5000ms -> 113 requests, 303 tests
 *
 * Cold, a request costs ~30ms; warm, ~3ms. A fixed clock therefore turns SERVER
 * CACHE STATE into a different answer for the same code, which is the opposite
 * of what this feature sells. Bounding by requests and nodes makes the answer a
 * function of the code alone. `hangGuardMs` exists only so a wedged server
 * cannot hang a gesture, is set well above the cap, and SAYS SO when it fires.
 *
 * DEPTH IS CONFIDENCE. Graded against execution on a 534-test crate: everything
 * the walk selected at distance <= 2 really executed the target, and precision
 * settles near 89% deeper, with zero executing tests missed at depth 8. The
 * false positives are callers that reach the target only on some branches, which
 * static reachability cannot see. Callers order by distance so a developer reads
 * certainty from position.
 */

/** One node in the caller graph, as a transport hands it back. */
export interface CallerNode {
  /** The item's own name, exactly as the server spelled it (C# qualifies, others do not). */
  name: string;
  /** Absolute path of the file the item lives in. */
  filePath: string;
  /** 0-based line of the item's declaration RANGE start. This may sit ABOVE the
   *  name, because a server's range covers doc comments and attributes. */
  line: number;
  /** 0-based line of the item's NAME token (selectionRange start). */
  nameLine: number;
  /** Opaque transport handle used to ask for THIS node's own callers. */
  handle: unknown;
}

export type NodeClass = "test" | "plain";

export interface WalkBoundsUp {
  /** Hard cap on caller-resolution REQUESTS. A request cap, never a clock.
   *  Calibration: the complete crate-scoped walk on the worst measured function
   *  is 113 requests. */
  R_MAX: number;
  /** Hard cap on DISTINCT nodes admitted to the graph, target excluded. */
  N_MAX: number;
  /** Frontier depth cap: a node at distance D_MAX has its callers left unasked. */
  D_MAX: number;
}

export interface DiscoveredTest {
  node: CallerNode;
  /** Hops from the target. 1 means the test calls the target directly. */
  distance: number;
  /** The call path, TEST FIRST and TARGET LAST: names only, length === distance + 1. */
  path: string[];
}

export type WalkStop = "requests" | "nodes" | "depth" | "cancelled" | "hang-guard";

export interface CallWalkResult {
  /** Ordered by distance ascending, then by discovery order within a distance. */
  tests: DiscoveredTest[];
  /** How many times `resolveCallers` was actually invoked. */
  requests: number;
  /** Distinct nodes admitted to the graph, target excluded, tests included. */
  nodesAdmitted: number;
  /** The greatest distance any admitted node sits at. 0 when nothing was admitted. */
  depthReached: number;
  /** Present exactly when a bound cut the walk short.
   *
   *  ABSENT MEANS EXACTLY THIS: every node the walk was ALLOWED to visit was
   *  visited, within every bound. It does NOT mean the caller graph was
   *  exhausted, and the earlier comment here that said so was false in two
   *  ordinary cases the review named (rows A12, A13):
   *
   *   - `inScope` refused nodes. For Rust the crate scope is the DESIGNED
   *     answer, so a walk that refused out-of-crate callers and found nothing
   *     did prove "no test in this crate calls it"; `outOfScope` records how
   *     many it turned away.
   *   - `resolveCallers` REJECTED. That leaves a whole subtree unseen and is
   *     survivable rather than a stop, so `failedRequests` is the field that
   *     says so - and anything deriving a FACT from an absent `stoppedBy` has to
   *     require `failedRequests === 0` as well. `testDiscovery.provenZero`
   *     does. */
  stoppedBy?: WalkStop;
  /** Distinct nodes refused by `inScope`. Never walked, never recorded. */
  outOfScope: number;
  /** `resolveCallers` calls that rejected. Counted in `requests` too. */
  failedRequests: number;
}

export interface CallWalkInput {
  target: CallerNode;
  resolveCallers: (node: CallerNode) => Promise<readonly CallerNode[]>;
  classify: (node: CallerNode) => NodeClass;
  /** Scope test. Rust's answer is "same crate"; a node outside is not walked, and
   *  a function whose only callers live in a sibling crate discovers nothing,
   *  which is the intended answer. */
  inScope: (node: CallerNode) => boolean;
  bounds: WalkBoundsUp;
  /** Optional cancellation. An aborted walk returns what it has. */
  signal?: { readonly aborted: boolean };
  /** Wall-clock HANG GUARD only, set well above the request cap. Never the bound. */
  hangGuardMs?: number;
  /** Injected clock for the hang guard, so tests are deterministic. Read ONLY
   *  when `hangGuardMs` is set: with no guard the walk reads no clock at all,
   *  which is what makes "no clock decides the answer" checkable. */
  now?: () => number;
  log?: (line: string) => void;
}

/** Node identity: two items are the same node iff this key matches. The RANGE
 *  line rather than the name line, because that is what the transport reports
 *  as the item's position and two overloads on the same name differ by it. */
export function nodeKey(node: CallerNode): string {
  return `${node.filePath}#${node.line}:${node.name}`;
}

interface Pending {
  node: CallerNode;
  distance: number;
  /** The path from this node DOWN to the target, this node first, target last. */
  path: string[];
}

export async function walkCallers(input: CallWalkInput): Promise<CallWalkResult> {
  const { target, resolveCallers, classify, inScope, bounds, log } = input;
  const tests: DiscoveredTest[] = [];
  const visited = new Set<string>([nodeKey(target)]); // the target is never its own result
  let requests = 0;
  let failedRequests = 0;
  let outOfScope = 0;
  let nodesAdmitted = 0;
  let depthReached = 0;
  let stoppedBy: WalkStop | undefined;

  const aborted = (): boolean => input.signal?.aborted === true;
  // The guard reads the clock ONLY when it exists. A walk with no guard makes no
  // clock call whatsoever, so "the answer does not depend on time" is a property
  // a test can pin by handing in a `now` that fails when called.
  const guardMs = input.hangGuardMs;
  const clock = input.now ?? Date.now;
  const startedAt = guardMs === undefined ? 0 : clock();
  const hung = (): boolean => guardMs !== undefined && clock() - startedAt >= guardMs;

  if (aborted()) {
    return { tests, requests, nodesAdmitted, depthReached, stoppedBy: "cancelled", outOfScope, failedRequests };
  }

  let frontier: Pending[] = [{ node: target, distance: 0, path: [target.name] }];

  outer: while (frontier.length > 0) {
    // Precedence, and it is checked at the LEVEL boundary as well as per parent
    // so the reported stop is the one that actually cut the walk: the human's
    // cancel, then the wedged server, then the request cap, then the depth cap.
    // Depth last of these, because a frontier that is both at D_MAX and out of
    // requests was cut by the budget, and telling the human "depth" would point
    // them at the wrong dial.
    if (aborted()) {
      stoppedBy = "cancelled";
      break;
    }
    if (hung()) {
      stoppedBy = "hang-guard";
      log?.(`[walk] hang guard fired after ${guardMs}ms with ${requests} request(s); the answer is PARTIAL`);
      break;
    }
    if (requests >= bounds.R_MAX) {
      stoppedBy = "requests";
      break;
    }
    // A frontier already at the depth cap has its callers left unasked. Reported
    // rather than silent: a walk that stopped at D_MAX with work still queued has
    // NOT proved anything about the tests beyond it.
    if (frontier[0].distance >= bounds.D_MAX) {
      stoppedBy = "depth";
      break;
    }
    const next: Pending[] = [];
    for (const parent of frontier) {
      if (aborted()) {
        stoppedBy = "cancelled";
        break outer;
      }
      if (hung()) {
        stoppedBy = "hang-guard";
        log?.(`[walk] hang guard fired after ${guardMs}ms with ${requests} request(s); the answer is PARTIAL`);
        break outer;
      }
      if (requests >= bounds.R_MAX) {
        stoppedBy = "requests";
        break outer;
      }
      requests++;
      let callers: readonly CallerNode[];
      try {
        callers = await resolveCallers(parent.node);
      } catch (err) {
        // One node's callers being unresolvable is not the walk failing. The
        // node contributes nothing and the walk continues; the count is on the
        // result so a caller can say the answer is incomplete.
        failedRequests++;
        log?.(`[walk] callers unresolved for ${parent.node.name}: ${String(err)}`);
        continue;
      }
      for (const caller of callers) {
        const key = nodeKey(caller);
        if (visited.has(key)) {
          continue; // cycle, diamond, or a node an earlier frontier already took
        }
        // Scope is refused BEFORE classification: an out-of-crate test is not a
        // result, however it would have classified. Marked visited so a node
        // reachable by three paths is counted once.
        if (!inScope(caller)) {
          visited.add(key);
          outOfScope++;
          continue;
        }
        if (nodesAdmitted >= bounds.N_MAX) {
          // Rule 9 ranks cancelled first, and the signal can flip DURING the
          // await that just returned these callers: they then trip the node cap
          // and a bare `break` would tell the human a budget stopped the walk
          // when what stopped it was their own cancel (adversarial review row
          // A14). `hung()` reads no clock when there is no guard, so this
          // preserves "no clock decides the answer".
          stoppedBy = aborted() ? "cancelled" : hung() ? "hang-guard" : "nodes";
          break outer;
        }
        visited.add(key);
        nodesAdmitted++;
        const distance = parent.distance + 1;
        depthReached = Math.max(depthReached, distance);
        // Breadth-first, so the first path by which a node is reached is a
        // shortest one. Test first, target last.
        const path = [caller.name, ...parent.path];
        if (classify(caller) === "test") {
          // A TEST IS A LEAF. Its own callers are never requested: a test that
          // calls another test contributes one result, not a chain, and asking
          // would spend the request budget on nodes that can never be run.
          tests.push({ node: caller, distance, path });
          continue;
        }
        next.push({ node: caller, distance, path });
      }
    }
    frontier = next;
  }

  log?.(
    `[walk] requests=${requests} nodes=${nodesAdmitted} tests=${tests.length} depth=${depthReached}` +
      ` outOfScope=${outOfScope} failed=${failedRequests} stoppedBy=${stoppedBy ?? "-"}`,
  );
  const result: CallWalkResult = {
    tests,
    requests,
    nodesAdmitted,
    depthReached,
    outOfScope,
    failedRequests,
  };
  if (stoppedBy !== undefined) {
    result.stoppedBy = stoppedBy;
  }
  return result;
}
