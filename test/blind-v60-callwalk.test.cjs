// BLIND ORACLE - session-v60 phase A1: the upward call walk + test classification.
//
// Written against session-v60/contracts/phaseA-callwalk.md ALONE. Nothing here
// has read src/core/callWalk.ts or src/core/testClassify.ts; the modules are
// reached only through the exports the contract declares. A require-red (esbuild
// cannot resolve the entry) is the correct state before the implementation lands.
//
// WHAT THIS FILE PINS, one group per contract rule:
//   walk 1   breadth first: every distance-1 result precedes every distance-2 one
//   walk 2   the target is never a result and never counted
//   walk 3   nodeKey identity kills cycles, diamonds and second requests
//   walk 4   a test is a LEAF - its own callers are never requested
//   walk 5   out of scope is refused BEFORE classification, counted once
//   walk 6   R_MAX is a request cap: exact invocation count + stoppedBy "requests"
//   walk 7   N_MAX caps admitted nodes, already-admitted nodes kept
//   walk 8   D_MAX cuts the frontier -> "depth"; a graph that exhausts itself
//            first reports NO stoppedBy at all
//   walk 9   precedence between two simultaneously applicable bounds
//   walk 10  a rejecting resolveCallers is survivable
//   walk 11  path is names only, TEST FIRST and TARGET LAST, shortest route
//   walk 12  determinism: same inputs, byte-identical result
//   walk 13  the hang guard is not a bound: absent hangGuardMs reads NO clock
//   walk 14  cancellation at entry and mid-walk
//   classify the doc-comment trap, the window clamps, every per-language row
//            positive AND negative, runnerFilterFor, and purity
//
// THE GRAPH IS FAKE DATA. resolveCallers is injected over a plain
// { name: [callerNames] } object and every answer is a FRESH object with the
// same field values, so identity has to come from nodeKey and not from
// reference equality.
//
// Run: SKIP_LIVE=1 node --test test/blind-v60-callwalk.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "blind-v60-callwalk",
  `export { walkCallers, nodeKey } from "../src/core/callWalk";
export { classifyTestNode, attributeWindow, runnerFilterFor, ATTRIBUTE_LOOKBACK } from "../src/core/testClassify";\n`
);
const {
  walkCallers,
  nodeKey,
  classifyTestNode,
  attributeWindow,
  runnerFilterFor,
  ATTRIBUTE_LOOKBACK,
} = mod;
test.after(cleanup);

// ---------------------------------------------------------------------------
// Fake caller graph
// ---------------------------------------------------------------------------

// Every node gets a distinct filePath and line, so nodeKey (filePath#line:name)
// separates them by name alone unless a test deliberately collides them.
const FILE = (name) => `/repo/src/${name.toLowerCase()}.rs`;
const LINE = (name) => 10 + (name.length % 7);

// A FRESH CallerNode every call: same fields, different object. Identity must
// come from nodeKey, never from ===.
const nodeOf = (name) => ({
  name,
  filePath: FILE(name),
  line: LINE(name),
  nameLine: LINE(name) + 2,
  handle: { transport: name },
});

const GENEROUS = { R_MAX: 100, N_MAX: 100, D_MAX: 10 };

/**
 * edges: { callee: [callerName, ...] }. Anything absent has no callers.
 * opts: { tests: [names], outOfScope: [names], reject: [names],
 *         onRequest: (name, nth) => void }
 */
function graph(edges, opts = {}) {
  const testNames = new Set(opts.tests || []);
  const outNames = new Set(opts.outOfScope || []);
  const rejectNames = new Set(opts.reject || []);
  const asked = [];        // names resolveCallers was invoked for, in order
  const classified = [];   // names classify was invoked for, in order
  const scoped = [];       // names inScope was invoked for, in order

  const resolveCallers = async (node) => {
    asked.push(node.name);
    if (opts.onRequest) opts.onRequest(node.name, asked.length);
    if (rejectNames.has(node.name)) throw new Error(`transport refused ${node.name}`);
    return (edges[node.name] || []).map(nodeOf);
  };
  const classify = (node) => {
    classified.push(node.name);
    return testNames.has(node.name) ? "test" : "plain";
  };
  const inScope = (node) => {
    scoped.push(node.name);
    return !outNames.has(node.name);
  };
  return { resolveCallers, classify, inScope, asked, classified, scoped };
}

const run = (edges, opts = {}, over = {}) => {
  const g = graph(edges, opts);
  const input = {
    target: nodeOf(over.targetName || "target"),
    resolveCallers: g.resolveCallers,
    classify: g.classify,
    inScope: g.inScope,
    bounds: { ...GENEROUS, ...(over.bounds || {}) },
    ...(over.signal ? { signal: over.signal } : {}),
    ...(over.hangGuardMs !== undefined ? { hangGuardMs: over.hangGuardMs } : {}),
    ...(over.now ? { now: over.now } : {}),
  };
  return walkCallers(input).then((result) => ({ result, g }));
};

const names = (r) => r.tests.map((t) => t.node.name);
const found = (r, name) => r.tests.find((t) => t.node.name === name);
const countOf = (arr, name) => arr.filter((n) => n === name).length;

// ---------------------------------------------------------------------------
// walk: the shape of a completed walk
// ---------------------------------------------------------------------------

test("walkCallers: a direct caller that is a test is a distance-1 result with a two-name path [surface: walk rules 1, 11]", async () => {
  const { result } = await run({ target: ["ItAdds"] }, { tests: ["ItAdds"] });
  assert.deepStrictEqual(names(result), ["ItAdds"]);
  const hit = found(result, "ItAdds");
  assert.strictEqual(hit.distance, 1, "a caller of the target sits at distance 1");
  assert.deepStrictEqual(hit.path, ["ItAdds", "target"], "path is names only, test first and target last");
  assert.strictEqual(hit.path.length, hit.distance + 1);
  assert.strictEqual(result.requests, 1, "one request, on the target itself");
  assert.strictEqual(result.nodesAdmitted, 1);
  assert.strictEqual(result.depthReached, 1);
  assert.strictEqual(result.outOfScope, 0);
  assert.strictEqual(result.failedRequests, 0);
});

test("walkCallers: a chain gives distance 2 and a three-name path in call order [surface: walk rule 11]", async () => {
  const { result } = await run(
    { target: ["mid"], mid: ["ItWorks"] },
    { tests: ["ItWorks"] }
  );
  assert.deepStrictEqual(names(result), ["ItWorks"]);
  const hit = found(result, "ItWorks");
  assert.strictEqual(hit.distance, 2);
  assert.deepStrictEqual(hit.path, ["ItWorks", "mid", "target"]);
  assert.strictEqual(result.requests, 2, "target then mid; the test is a leaf");
  assert.strictEqual(result.nodesAdmitted, 2, "mid and the test, target excluded");
  assert.strictEqual(result.depthReached, 2);
});

test("walkCallers: a three-hop chain gives a four-name path [surface: walk rule 11 'at distance 3']", async () => {
  const { result } = await run(
    { target: ["inner"], inner: ["mid"], mid: ["ItWorks"] },
    { tests: ["ItWorks"] }
  );
  const hit = found(result, "ItWorks");
  assert.strictEqual(hit.distance, 3);
  assert.deepStrictEqual(hit.path, ["ItWorks", "mid", "inner", "target"]);
});

test("walkCallers: the target is never a result and never counted, even when it classifies as a test and calls itself [surface: walk rule 2]", async () => {
  // Everything classifies as a test, and the target appears as its own caller.
  const { result, g } = await run(
    { target: ["target", "ItAdds"] },
    { tests: ["target", "ItAdds"] }
  );
  assert.deepStrictEqual(names(result), ["ItAdds"], "the target is not a result of its own walk");
  assert.strictEqual(result.nodesAdmitted, 1, "the target is not counted in nodesAdmitted");
  assert.strictEqual(countOf(g.asked, "target"), 1, "the target is not re-walked as its own caller");
});

test("walkCallers: an empty caller set completes with no stop reason and depthReached 0 [surface: walk rule 8 'absent means the walk COMPLETED', depthReached 'is 0 when nothing was admitted']", async () => {
  const { result } = await run({});
  assert.deepStrictEqual(result.tests, []);
  assert.strictEqual(result.requests, 1);
  assert.strictEqual(result.nodesAdmitted, 0);
  assert.strictEqual(result.depthReached, 0);
  assert.strictEqual(result.stoppedBy, undefined, "no bound cut this walk");
});

// ---------------------------------------------------------------------------
// walk 1 + 11: breadth first, and the SHORTEST path wins
// ---------------------------------------------------------------------------

test("walkCallers: every distance-1 result precedes every distance-2 result [surface: walk rule 1 + tests 'ordered by distance ascending']", async () => {
  // Two direct test callers and two plain ones, each plain one reaching a
  // deeper test. If ordering were discovery-order-only, DeepA would land
  // between the two direct tests.
  const { result } = await run(
    {
      target: ["Near1", "plainA", "Near2", "plainB"],
      plainA: ["DeepA"],
      plainB: ["DeepB"],
    },
    { tests: ["Near1", "Near2", "DeepA", "DeepB"] }
  );
  const ds = result.tests.map((t) => t.distance);
  assert.deepStrictEqual(ds, [...ds].sort((a, b) => a - b), "distances are ascending");
  const lastOne = ds.lastIndexOf(1);
  const firstTwo = ds.indexOf(2);
  assert.ok(lastOne < firstTwo, "every distance-1 result precedes every distance-2 result");
  assert.deepStrictEqual(names(result), ["Near1", "Near2", "DeepA", "DeepB"],
    "within a distance, discovery order");
});

test("walkCallers: a node reachable by a short and a long route records the SHORT path [surface: walk rule 11 'the FIRST path by which the node was reached']", async () => {
  // Shared reaches the target at distance 2 through fastLane, and would reach
  // it at distance 3 through slowLane -> hop.
  const { result } = await run(
    {
      target: ["fastLane", "slowLane"],
      fastLane: ["Shared"],
      slowLane: ["hop"],
      hop: ["Shared"],
    },
    { tests: ["Shared"] }
  );
  const hit = found(result, "Shared");
  assert.strictEqual(result.tests.length, 1, "one node, one result");
  assert.strictEqual(hit.distance, 2, "the short route sets the distance");
  assert.deepStrictEqual(hit.path, ["Shared", "fastLane", "target"], "the short route sets the path");
});

// ---------------------------------------------------------------------------
// walk 3: identity, diamonds, hubs, cycles
// ---------------------------------------------------------------------------

test("walkCallers: a hub reached from two sides is walked ONCE and each test through it appears once [surface: walk rule 3 'never re-walked, costs no second request']", async () => {
  const { result, g } = await run(
    {
      target: ["armA", "armB"],
      armA: ["hub"],
      armB: ["hub"],
      hub: ["T1", "T2", "T3"],
    },
    { tests: ["T1", "T2", "T3"] }
  );
  assert.strictEqual(countOf(g.asked, "hub"), 1, "the hub costs exactly one request");
  assert.deepStrictEqual(g.asked, ["target", "armA", "armB", "hub"]);
  assert.strictEqual(result.requests, 4);
  assert.deepStrictEqual(names(result).slice().sort(), ["T1", "T2", "T3"]);
  for (const n of ["T1", "T2", "T3"]) {
    assert.strictEqual(names(result).filter((x) => x === n).length, 1, `${n} appears once`);
  }
  assert.strictEqual(result.nodesAdmitted, 6, "armA, armB, hub, T1, T2, T3");
  assert.strictEqual(result.depthReached, 3);
  assert.strictEqual(result.stoppedBy, undefined, "the graph exhausted itself inside every bound");
  for (const t of result.tests) {
    assert.deepStrictEqual(t.path, [t.node.name, "hub", "armA", "target"],
      "the hub was first reached through armA, so that is the recorded route");
  }
});

test("walkCallers: a cycle terminates and costs one request per node [surface: walk rule 3 'A cyclic graph terminates']", async () => {
  // A calls B, B calls A, both call the target, and a test calls A.
  const { result, g } = await run(
    {
      target: ["A", "B"],
      A: ["B", "ItCycles"],
      B: ["A"],
    },
    { tests: ["ItCycles"] }
  );
  assert.deepStrictEqual(g.asked, ["target", "A", "B"], "no node is asked twice, so the cycle ends");
  assert.strictEqual(result.requests, 3);
  assert.strictEqual(result.nodesAdmitted, 3, "A, B, ItCycles");
  assert.deepStrictEqual(names(result), ["ItCycles"]);
  assert.strictEqual(result.stoppedBy, undefined, "a cycle is not a bound breach");
});

test("nodeKey: two items differing only in line are different nodes; identical items are the same node [surface: walk rule 3, the stated key format]", () => {
  const base = { name: "run", filePath: "/repo/src/a.rs", line: 12, nameLine: 14, handle: { t: 1 } };
  const sameFields = { name: "run", filePath: "/repo/src/a.rs", line: 12, nameLine: 14, handle: { t: 2 } };
  const otherLine = { ...base, line: 13 };
  const otherFile = { ...base, filePath: "/repo/src/b.rs" };
  const otherName = { ...base, name: "runTwice" };

  assert.strictEqual(nodeKey(base), "/repo/src/a.rs#12:run", "the contract states the key format literally");
  assert.strictEqual(nodeKey(sameFields), nodeKey(base), "a different handle is still the same node");
  assert.notStrictEqual(nodeKey(otherLine), nodeKey(base), "line is part of identity");
  assert.notStrictEqual(nodeKey(otherFile), nodeKey(base));
  assert.notStrictEqual(nodeKey(otherName), nodeKey(base));
  // nameLine is not in the stated key.
  assert.strictEqual(nodeKey({ ...base, nameLine: 99 }), nodeKey(base));
});

test("walkCallers: two same-named callers on different lines are two nodes [surface: walk rule 3, identity is per nodeKey and not per name]", async () => {
  // Hand-built graph: the two "overload" items share a name but not a line.
  const target = nodeOf("target");
  const a = { name: "overload", filePath: "/repo/src/o.rs", line: 4, nameLine: 5, handle: {} };
  const b = { name: "overload", filePath: "/repo/src/o.rs", line: 40, nameLine: 41, handle: {} };
  const asked = [];
  const result = await walkCallers({
    target,
    resolveCallers: async (n) => {
      asked.push(nodeKey(n));
      return nodeKey(n) === nodeKey(target) ? [{ ...a }, { ...b }] : [];
    },
    classify: () => "test",
    inScope: () => true,
    bounds: GENEROUS,
  });
  assert.strictEqual(result.tests.length, 2, "same name, different line: two distinct nodes");
  assert.strictEqual(result.nodesAdmitted, 2);
});

// ---------------------------------------------------------------------------
// walk 4: a test is a leaf
// ---------------------------------------------------------------------------

test("walkCallers: a test's own callers are NEVER requested, even when it has some [surface: walk rule 4 'A test is a LEAF']", async () => {
  const { result, g } = await run(
    {
      target: ["ItAdds"],
      ItAdds: ["ItAddsOuter", "helper"],   // must never be asked for
      helper: ["ShouldNotAppear"],
    },
    { tests: ["ItAdds", "ItAddsOuter", "ShouldNotAppear"] }
  );
  assert.deepStrictEqual(g.asked, ["target"], "resolveCallers was never invoked for the test node");
  assert.ok(!g.asked.includes("ItAdds"));
  assert.deepStrictEqual(names(result), ["ItAdds"], "a test calling another test is one result, not a chain");
  assert.strictEqual(result.nodesAdmitted, 1);
  assert.strictEqual(result.requests, 1);
});

// ---------------------------------------------------------------------------
// walk 5: out of scope
// ---------------------------------------------------------------------------

test("walkCallers: an out-of-scope node that WOULD classify as a test is refused before classification and counted once [surface: walk rule 5]", async () => {
  // Foreign is a caller of both inA and inB, so it is reached twice.
  const { result, g } = await run(
    {
      target: ["inA", "inB"],
      inA: ["Foreign"],
      inB: ["Foreign"],
    },
    { tests: ["Foreign"], outOfScope: ["Foreign"] }
  );
  assert.deepStrictEqual(names(result), [], "an out-of-scope node is not recorded even though it classifies as a test");
  assert.strictEqual(result.outOfScope, 1, "a node refused once is not counted twice");
  assert.ok(!g.asked.includes("Foreign"), "an out-of-scope node is never walked");
  assert.ok(!g.classified.includes("Foreign"), "refused BEFORE classification: classify is never asked about it");
  assert.strictEqual(result.nodesAdmitted, 2, "inA and inB only");
  assert.strictEqual(result.requests, 3, "target, inA, inB - the refusal consumes no request");
  assert.strictEqual(result.stoppedBy, undefined);
});

// ---------------------------------------------------------------------------
// walk 6: R_MAX
// ---------------------------------------------------------------------------

test("walkCallers: R_MAX stops issuing at exactly R_MAX invocations and reports 'requests' [surface: walk rule 6 'a REQUEST cap, never a clock']", async () => {
  const { result, g } = await run(
    { target: ["a"], a: ["b"], b: ["c"], c: ["d"], d: ["Deep"] },
    { tests: ["Deep"] },
    { bounds: { R_MAX: 3 } }
  );
  assert.strictEqual(result.requests, 3, "the cap is exact: three invocations, no fourth");
  assert.strictEqual(g.asked.length, 3);
  assert.deepStrictEqual(g.asked, ["target", "a", "b"]);
  assert.strictEqual(result.stoppedBy, "requests");
  assert.deepStrictEqual(names(result), [], "Deep was never reached");
  assert.strictEqual(result.nodesAdmitted, 3, "a, b and c were admitted before the cap bit");
});

test("walkCallers: R_MAX of 0 issues no request at all [surface: walk rule 6 'Before each resolveCallers call, if requests >= R_MAX']", async () => {
  const { result, g } = await run({ target: ["ItAdds"] }, { tests: ["ItAdds"] }, { bounds: { R_MAX: 0 } });
  assert.strictEqual(result.requests, 0);
  assert.deepStrictEqual(g.asked, []);
  assert.strictEqual(result.stoppedBy, "requests");
  assert.deepStrictEqual(result.tests, []);
  assert.strictEqual(result.nodesAdmitted, 0);
  assert.strictEqual(result.depthReached, 0);
});

test("walkCallers: a rejecting request still counts against R_MAX [surface: walk rule 6 'counts every invocation, including ones that reject']", async () => {
  const { result } = await run(
    { target: ["a", "b"], a: ["x"], b: ["y"], x: ["Deep"] },
    { tests: ["Deep"], reject: ["a"] },
    { bounds: { R_MAX: 2 } }
  );
  assert.strictEqual(result.requests, 2, "target + the rejecting call on a");
  assert.strictEqual(result.failedRequests, 1);
  assert.strictEqual(result.stoppedBy, "requests");
});

// ---------------------------------------------------------------------------
// walk 7: N_MAX
// ---------------------------------------------------------------------------
//
// CONTRACT GAP: rule 7 says the walk returns "nodes" once nodesAdmitted reaches
// N_MAX, while rule 8 says stoppedBy is ABSENT when the graph exhausted itself.
// A graph with exactly N_MAX nodes satisfies both sentences at once. READING
// TAKEN: only a node genuinely REFUSED admission makes the stop real, so both
// rows below hand the walk strictly more nodes than the cap and the two
// readings agree. The exactly-N_MAX case is deliberately NOT pinned.

test("walkCallers: N_MAX refuses further admissions, keeps the ones already admitted, and reports 'nodes' [surface: walk rule 7]", async () => {
  const { result } = await run(
    { target: ["T1", "T2", "T3", "T4", "T5"] },
    { tests: ["T1", "T2", "T3", "T4", "T5"] },
    { bounds: { N_MAX: 3 } }
  );
  assert.strictEqual(result.nodesAdmitted, 3, "the cap is exact");
  assert.strictEqual(result.stoppedBy, "nodes");
  assert.deepStrictEqual(names(result), ["T1", "T2", "T3"], "already-admitted nodes are kept, in discovery order");
});

test("walkCallers: N_MAX counts tests as admitted nodes too [surface: walk rule 7 + nodesAdmitted 'tests included']", async () => {
  const { result } = await run(
    { target: ["plainOne", "T1", "T2"] },
    { tests: ["T1", "T2"] },
    { bounds: { N_MAX: 2 } }
  );
  assert.strictEqual(result.nodesAdmitted, 2, "plainOne and T1 fill the cap; tests are not free");
  assert.deepStrictEqual(names(result), ["T1"]);
  assert.strictEqual(result.stoppedBy, "nodes");
});

// ---------------------------------------------------------------------------
// walk 8: D_MAX - and the important half, the ABSENT stop
// ---------------------------------------------------------------------------

test("walkCallers: a node sitting AT D_MAX has its callers left unasked and the walk reports 'depth' [surface: walk rule 8]", async () => {
  const { result, g } = await run(
    { target: ["a"], a: ["b"], b: ["Deep"] },
    { tests: ["Deep"] },
    { bounds: { D_MAX: 2 } }
  );
  assert.deepStrictEqual(g.asked, ["target", "a"], "b sits at distance 2 == D_MAX, so b's callers are never asked");
  assert.strictEqual(result.requests, 2);
  assert.strictEqual(result.stoppedBy, "depth");
  assert.strictEqual(result.depthReached, 2);
  assert.strictEqual(result.nodesAdmitted, 2, "a and b");
  assert.deepStrictEqual(names(result), [], "Deep was one hop past the frontier");
});

test("walkCallers: a graph that exhausts itself BELOW D_MAX reports NO stoppedBy at all [surface: walk rule 8 'if the frontier emptied on its own, stoppedBy is ABSENT']", async () => {
  const { result } = await run(
    { target: ["a"], a: ["b"], b: [] },
    {},
    { bounds: { D_MAX: 7 } }
  );
  assert.strictEqual(result.stoppedBy, undefined, "the frontier emptied on its own; nothing cut the walk");
  assert.ok(!("stoppedBy" in result) || result.stoppedBy === undefined,
    "stoppedBy is 'present exactly when a bound cut the walk short'");
  assert.strictEqual(result.depthReached, 2);
  assert.strictEqual(result.requests, 3, "target, a and b were all asked - b was below the frontier cap");
  assert.strictEqual(result.nodesAdmitted, 2);
});

test("walkCallers: exhausting one hop UNDER D_MAX still reports no stop [surface: walk rule 8, the off-by-one on the frontier]", async () => {
  // The deepest admitted node sits at exactly D_MAX - 1 and answers with [].
  const { result, g } = await run(
    { target: ["a"], a: ["b"], b: [] },
    {},
    { bounds: { D_MAX: 3 } }
  );
  assert.strictEqual(g.asked.length, 3, "b at distance 2 is under D_MAX 3, so b IS asked");
  assert.strictEqual(result.stoppedBy, undefined);
});

test("walkCallers: a tree that runs out of callers at distance 1 reports no stop [surface: walk rule 8 'the walk COMPLETED']", async () => {
  const { result } = await run(
    { target: ["ItAdds", "plainOne"], plainOne: [] },
    { tests: ["ItAdds"] },
    { bounds: { D_MAX: 4 } }
  );
  assert.strictEqual(result.stoppedBy, undefined);
  assert.deepStrictEqual(names(result), ["ItAdds"]);
  assert.strictEqual(result.depthReached, 1);
});

test("walkCallers: reaching D_MAX with nothing beyond it still reports 'depth' because the frontier was left unasked [surface: walk rule 8 'If any such node existed']", async () => {
  // b sits at D_MAX and, unknown to the walk, has no callers. The walk cannot
  // know that without asking - so a node WAS left unasked and the stop is real.
  const { result, g } = await run(
    { target: ["a"], a: ["b"], b: [] },
    {},
    { bounds: { D_MAX: 2 } }
  );
  assert.deepStrictEqual(g.asked, ["target", "a"]);
  assert.strictEqual(result.stoppedBy, "depth");
});

test("walkCallers: D_MAX of 1 admits the direct callers and asks nothing further [surface: walk rule 8]", async () => {
  const { result, g } = await run(
    { target: ["ItAdds", "plainOne"], plainOne: ["Deeper"] },
    { tests: ["ItAdds", "Deeper"] },
    { bounds: { D_MAX: 1 } }
  );
  assert.deepStrictEqual(g.asked, ["target"]);
  assert.deepStrictEqual(names(result), ["ItAdds"]);
  assert.strictEqual(result.stoppedBy, "depth");
  assert.strictEqual(result.depthReached, 1);
});

// ---------------------------------------------------------------------------
// walk 9: precedence
// ---------------------------------------------------------------------------
//
// CONTRACT GAP: rule 9 gives an order (cancelled, hang-guard, requests, nodes,
// depth) and then says "the reported stop is the one that ACTUALLY cut the
// walk". Those two sentences can disagree for the requests/nodes/depth trio -
// R_MAX and D_MAX can both become true on the same iteration and which one
// "actually" cut is not decidable from the contract. READING TAKEN: the listed
// order governs whenever two are simultaneously applicable, and the rows below
// use only pairs where the list and the "actually cut" sentence agree
// (cancellation and the hang guard both stop the walk outright, so when either
// is live it IS the cut). The requests/nodes/depth tie is NOT pinned.

test("walkCallers: cancellation outranks an exhausted request cap [surface: walk rule 9 precedence order, 'cancelled' first]", async () => {
  const { result, g } = await run(
    { target: ["ItAdds"] },
    { tests: ["ItAdds"] },
    { bounds: { R_MAX: 0 }, signal: { aborted: true } }
  );
  assert.strictEqual(result.stoppedBy, "cancelled", "cancelled precedes requests");
  assert.strictEqual(result.requests, 0);
  assert.deepStrictEqual(g.asked, []);
});

test("walkCallers: cancellation outranks a blown hang guard [surface: walk rule 9 precedence order, 'cancelled' before 'hang-guard']", async () => {
  const { result } = await run(
    { target: ["ItAdds"] },
    { tests: ["ItAdds"] },
    { signal: { aborted: true }, hangGuardMs: 1, now: () => 10000000 }
  );
  assert.strictEqual(result.stoppedBy, "cancelled");
  assert.strictEqual(result.requests, 0);
});

// ---------------------------------------------------------------------------
// walk 10: a rejecting resolveCallers
// ---------------------------------------------------------------------------

test("walkCallers: one rejecting resolveCallers does not reject the walk; the other branch still lands [surface: walk rule 10]", async () => {
  const { result } = await run(
    {
      target: ["bad", "good"],
      bad: ["NeverSeen"],
      good: ["ItAdds"],
    },
    { tests: ["NeverSeen", "ItAdds"], reject: ["bad"] }
  );
  assert.strictEqual(result.failedRequests, 1);
  assert.strictEqual(result.requests, 3, "target, bad (rejected) and good all count");
  assert.deepStrictEqual(names(result), ["ItAdds"], "the failed branch contributes no callers");
  assert.strictEqual(result.stoppedBy, undefined, "a transport failure is not a bound");
  assert.strictEqual(result.nodesAdmitted, 3, "bad, good and ItAdds");
});

test("walkCallers: a walk whose only request rejects resolves, it does not throw [surface: walk rule 10 'never rejects for that reason']", async () => {
  const { result } = await run(
    { target: ["a"] },
    { reject: ["target"] }
  );
  assert.strictEqual(result.failedRequests, 1);
  assert.strictEqual(result.requests, 1);
  assert.deepStrictEqual(result.tests, []);
  assert.strictEqual(result.nodesAdmitted, 0);
});

// ---------------------------------------------------------------------------
// walk 12: determinism
// ---------------------------------------------------------------------------

test("walkCallers: the same walk run twice returns an identical result [surface: walk rule 12 'byte-identical result']", async () => {
  const build = () =>
    run(
      {
        target: ["armA", "armB", "T0"],
        armA: ["hub", "T1"],
        armB: ["hub"],
        hub: ["T2", "deeper"],
        deeper: ["T3"],
      },
      { tests: ["T0", "T1", "T2", "T3"] }
    );
  const first = (await build()).result;
  const second = (await build()).result;
  assert.deepStrictEqual(second, first);
  assert.strictEqual(JSON.stringify(second), JSON.stringify(first), "identical down to key order");
});

// ---------------------------------------------------------------------------
// walk 13: the hang guard
// ---------------------------------------------------------------------------

test("walkCallers: with hangGuardMs ABSENT the injected clock is never read [surface: walk rule 13 'no clock is read at all']", async () => {
  let clockReads = 0;
  const now = () => {
    clockReads += 1;
    return 1000 + clockReads;
  };
  const { result } = await run(
    { target: ["a"], a: ["b"], b: ["c"], c: ["ItAdds"] },
    { tests: ["ItAdds"] },
    { now }
  );
  assert.strictEqual(clockReads, 0, "the hang guard is not a bound; no hangGuardMs means no clock");
  assert.deepStrictEqual(names(result), ["ItAdds"]);
  assert.strictEqual(result.stoppedBy, undefined);
});

test("walkCallers: a blown hang guard cuts the walk and says so [surface: walk rule 13 'so a caller can say so out loud']", async () => {
  // First read is the baseline; every read after it is a minute later.
  let reads = 0;
  const now = () => {
    reads += 1;
    return reads === 1 ? 1000 : 61000;
  };
  const { result } = await run(
    { target: ["a"], a: ["b"], b: ["c"], c: ["d"], d: ["Deep"] },
    { tests: ["Deep"] },
    { hangGuardMs: 50, now }
  );
  assert.ok(reads > 0, "with hangGuardMs set the clock IS read");
  assert.strictEqual(result.stoppedBy, "hang-guard");
  assert.deepStrictEqual(names(result), [], "the guard fired before the deep test was reached");
});

test("walkCallers: a hang guard that never blows leaves the walk unmarked [surface: walk rule 13 'set well above the request cap. Never the bound']", async () => {
  const now = () => 5000; // the clock never advances
  const { result } = await run(
    { target: ["a"], a: ["ItAdds"] },
    { tests: ["ItAdds"] },
    { hangGuardMs: 30000, now }
  );
  assert.strictEqual(result.stoppedBy, undefined);
  assert.deepStrictEqual(names(result), ["ItAdds"]);
});

// ---------------------------------------------------------------------------
// walk 14: cancellation
// ---------------------------------------------------------------------------

test("walkCallers: a signal already aborted at entry returns an empty result with no requests [surface: walk rule 14]", async () => {
  const { result, g } = await run(
    { target: ["ItAdds", "a"], a: ["Deep"] },
    { tests: ["ItAdds", "Deep"] },
    { signal: { aborted: true } }
  );
  assert.deepStrictEqual(result.tests, []);
  assert.strictEqual(result.requests, 0);
  assert.strictEqual(result.nodesAdmitted, 0);
  assert.strictEqual(result.depthReached, 0);
  assert.strictEqual(result.outOfScope, 0);
  assert.strictEqual(result.failedRequests, 0);
  assert.strictEqual(result.stoppedBy, "cancelled");
  assert.deepStrictEqual(g.asked, []);
});

test("walkCallers: aborting mid-walk returns the partial results already gathered [surface: walk rule 14 'checked before each request' + 'returns what it has']", async () => {
  const signal = { aborted: false };
  const { result, g } = await run(
    { target: ["ItNear", "a"], a: ["b"], b: ["ItDeep"] },
    {
      tests: ["ItNear", "ItDeep"],
      onRequest: (name) => {
        if (name === "a") signal.aborted = true; // abort as the 2nd request lands
      },
    },
    { signal }
  );
  assert.deepStrictEqual(g.asked, ["target", "a"], "the third request is refused by the signal check");
  assert.strictEqual(result.requests, 2);
  assert.strictEqual(result.stoppedBy, "cancelled");
  assert.deepStrictEqual(names(result), ["ItNear"], "what it already had survives the abort");
  assert.ok(!names(result).includes("ItDeep"));
  assert.strictEqual(result.nodesAdmitted, 3, "ItNear, a and b were admitted before the abort");
});

// ===========================================================================
// Module 2: testClassify
// ===========================================================================

const classifyInput = (over) => ({
  name: "thing",
  filePath: "/repo/src/lib.rs",
  lines: undefined,
  rangeStartLine: 0,
  selectionStartLine: 0,
  ...over,
});

// ---------------------------------------------------------------------------
// attributeWindow
// ---------------------------------------------------------------------------

test("ATTRIBUTE_LOOKBACK is a positive whole number of lines [surface: 'How far ABOVE the declaration range's start']", () => {
  // CONTRACT GAP: the contract exports ATTRIBUTE_LOOKBACK but never states its
  // value. READING TAKEN: every expectation below is computed FROM the exported
  // constant rather than a hard-coded number, so any lookback of 1 or more passes.
  assert.strictEqual(typeof ATTRIBUTE_LOOKBACK, "number");
  assert.ok(Number.isInteger(ATTRIBUTE_LOOKBACK), "a line count, not a fraction");
  assert.ok(ATTRIBUTE_LOOKBACK >= 1, "a lookback of 0 could not see an attribute above the range");
});

test("attributeWindow: the window runs from ABOVE the range start DOWN TO the name line [surface: 'from a little ABOVE rangeStartLine DOWN TO selectionStartLine inclusive']", () => {
  const w = attributeWindow(20, 24, 100);
  assert.strictEqual(w.from, 20 - ATTRIBUTE_LOOKBACK);
  assert.strictEqual(w.to, 24, "the name line itself is inside the window");
  assert.ok(w.from <= w.to);
});

test("attributeWindow: clamps at the TOP of the file [surface: 'clamped to the file']", () => {
  const w = attributeWindow(0, 2, 50);
  assert.strictEqual(w.from, 0, "never a negative line");
  assert.strictEqual(w.to, 2);
  const w2 = attributeWindow(1, 1, 50);
  assert.ok(w2.from >= 0);
});

test("attributeWindow: clamps at the BOTTOM of the file [surface: 'A window that would run past the end of the file is clamped']", () => {
  const w = attributeWindow(8, 999, 10);
  assert.strictEqual(w.to, 9, "the last readable line is lineCount - 1");
  assert.strictEqual(w.from, Math.max(0, 8 - ATTRIBUTE_LOOKBACK));
  assert.ok(w.to <= 9);
});

test("attributeWindow: a lineCount of 0 yields an EMPTY window [surface: 'a lineCount of 0 yields an empty window']", () => {
  // CONTRACT GAP: "empty window" is not given a numeric shape. READING TAKEN:
  // empty means nothing can be read from it, that is `to < from`. The
  // consequence the contract DOES state (every attribute language answers
  // "plain") is pinned separately below and does not rest on this reading.
  const w = attributeWindow(0, 0, 0);
  assert.ok(w.to < w.from, "an empty window spans no line");
});

test("attributeWindow: selectionStartLine BELOW rangeStartLine is malformed and never yields a negative-width span [surface: 'the window still covers rangeStartLine - ATTRIBUTE_LOOKBACK through rangeStartLine']", () => {
  const w = attributeWindow(30, 12, 100);
  assert.strictEqual(w.from, 30 - ATTRIBUTE_LOOKBACK);
  assert.strictEqual(w.to, 30, "the bottom falls back to rangeStartLine, not the bad selection line");
  assert.ok(w.from <= w.to, "never a negative-width span");
});

test("attributeWindow: never throws for hostile line numbers [surface: 'Never throws for any input, including a negative line number']", () => {
  const rows = [
    [-5, -1, 10], [-5, 3, 10], [0, 0, 1], [3, 3, 3], [1000, 1000, 4],
    [0, 0, -1], [-1, -1, 0], [2, 1, 0],
  ];
  for (const [r, s, c] of rows) {
    const w = attributeWindow(r, s, c);
    assert.strictEqual(typeof w.from, "number", `from is a number for ${JSON.stringify([r, s, c])}`);
    assert.strictEqual(typeof w.to, "number");
  }
});

// ---------------------------------------------------------------------------
// THE DOC-COMMENT TRAP - the headline
// ---------------------------------------------------------------------------

// A real documented Rust test: the CallHierarchyItem `range` starts on the
// first `///` line, the `#[test]` attribute sits BETWEEN the doc comment and
// the `fn` line, and the `selectionRange` starts on the `fn` line.
const RUST_DOC_TRAP = [
  "use crate::geometry::area;",                        // 0
  "",                                                  // 1
  "/// Area of a unit square is one.",                 // 2  <- range.start
  "///",                                               // 3
  "/// Regression cover for the rounding fix.",        // 4
  "#[test]",                                           // 5  <- BELOW range.start
  "fn area_of_unit_square() {",                        // 6  <- selectionRange.start
  "    assert_eq!(area(1.0, 1.0), 1.0);",              // 7
  "}",                                                 // 8
];

test("classifyTestNode rust: THE DOC-COMMENT TRAP - #[test] below the range start still classifies as a test [surface: 'THE TRAP THIS EXISTS FOR']", () => {
  const got = classifyTestNode("rust", classifyInput({
    name: "area_of_unit_square",
    filePath: "/repo/src/geometry.rs",
    lines: RUST_DOC_TRAP,
    rangeStartLine: 2,     // the doc comment, as the server reports it
    selectionStartLine: 6, // the fn name line
  }));
  assert.strictEqual(got, "test", "scanning UPWARD from range.start would miss every documented test");
});

test("attributeWindow: the doc-comment trap's window actually contains the #[test] line [surface: window bounds vs the trap]", () => {
  const w = attributeWindow(2, 6, RUST_DOC_TRAP.length);
  assert.ok(w.from <= 5 && 5 <= w.to, `#[test] on line 5 must be inside {from:${w.from},to:${w.to}}`);
});

const CS_DOC_TRAP = [
  "namespace Shape.Tests;",                                   // 0
  "",                                                         // 1
  "public class AreaTests",                                   // 2
  "{",                                                        // 3
  "    /// <summary>Area of a unit square is one.</summary>", // 4  <- range.start
  "    [Fact]",                                               // 5  <- BELOW range.start
  "    public void AreaOfUnitSquare()",                       // 6  <- selectionRange.start
  "    {",                                                    // 7
  "    }",                                                    // 8
  "}",                                                        // 9
];

test("classifyTestNode csharp: THE DOC-COMMENT TRAP - [Fact] below a /// <summary> still classifies as a test [surface: the same trap, C# row]", () => {
  const got = classifyTestNode("csharp", classifyInput({
    name: "Shape.Tests.AreaTests.AreaOfUnitSquare()",
    filePath: "/repo/tests/AreaTests.cs",
    lines: CS_DOC_TRAP,
    rangeStartLine: 4,
    selectionStartLine: 6,
  }));
  assert.strictEqual(got, "test");
});

// ---------------------------------------------------------------------------
// Rust row
// ---------------------------------------------------------------------------

// One attribute, sandwiched between a doc line and the fn line, so every row
// exercises the same window as the trap above.
const rustWith = (attr) => classifyInput({
  name: "thing",
  filePath: "/repo/src/lib.rs",
  lines: ["/// doc line", attr, "fn thing() {", "}"],
  rangeStartLine: 0,
  selectionStartLine: 2,
});

const RUST_POSITIVE = [
  ["#[test]", "the plain attribute"],
  ["#[tokio::test]", "a qualified path ending in test"],
  ["#[test_case(1, 2)]", "test_case with arguments"],
  ["# [ test ]", "spaces inside the attribute"],
  ["#[async_std::test]", "another qualified async runner"],
  ["    #[test]", "indented inside a mod"],
];
for (const [attr, why] of RUST_POSITIVE) {
  test(`classifyTestNode rust: ${JSON.stringify(attr)} IS a test (${why}) [surface: rust row 'a path ending in test or test_case']`, () => {
    assert.strictEqual(classifyTestNode("rust", rustWith(attr)), "test");
  });
}

const RUST_NEGATIVE = [
  ["#[derive(Debug, Clone)]", "an ordinary derive"],
  ["#[allow(dead_code)]", "a lint attribute"],
  ["#[should_panic]", "a modifier, not the test marker"],
  ["#[test_utils::setup]", "a path whose LAST segment is not test"],
  ["#[inline]", "no test anywhere"],
];
for (const [attr, why] of RUST_NEGATIVE) {
  test(`classifyTestNode rust: ${JSON.stringify(attr)} is NOT a test (${why}) [surface: rust row]`, () => {
    assert.strictEqual(classifyTestNode("rust", rustWith(attr)), "plain");
  });
}

test("classifyTestNode rust: a COMMENTED-OUT #[test] is not an attribute [surface: rust row - CONTRACT GAP, see comment]", () => {
  // CONTRACT GAP: the rust row says "a line matching an attribute whose path
  // ends in test", and the contract never mentions comments. A line reading
  // `// #[test] was removed` matches that sentence literally while being no
  // attribute at all, so the contract is genuinely silent on which way this
  // falls. READING TAKEN: it is NOT a test. The two directions are not
  // symmetric - a false positive here makes the product run a plain function
  // as a covering test, which is the expensive mistake - so the reading that
  // costs less on being wrong is the one pinned. A red here is a CONTRACT
  // question to settle (say so about comments, either way), not automatically
  // a code defect.
  assert.strictEqual(classifyTestNode("rust", rustWith("// #[test] was removed")), "plain");
});

test("classifyTestNode rust: #[cfg(test)] ALONE is not a test attribute, it marks a module [surface: rust row '#[cfg(test)] alone is NOT a test attribute']", () => {
  const lines = [
    "    // a fixture builder used by the tests below",  // 0
    "    #[cfg(test)]",                                  // 1  <- range.start
    "    fn make_shape() -> Shape {",                    // 2  <- selectionRange.start
    "        Shape::default()",
    "    }",
  ];
  const got = classifyTestNode("rust", classifyInput({
    name: "make_shape",
    filePath: "/repo/src/shape.rs",
    lines,
    rangeStartLine: 1,
    selectionStartLine: 2,
  }));
  assert.strictEqual(got, "plain", "the #[cfg(test)] line IS inside the window and must not count");
});

test("classifyTestNode rust: a helper inside a #[cfg(test)] mod, with no #[test] of its own, is plain [surface: rust row, the module marker]", () => {
  const lines = [
    "#[cfg(test)]",                  // 0
    "mod tests {",                   // 1
    "    use super::*;",             // 2
    "",                              // 3
    "    /// Builds a fixture.",     // 4  <- range.start
    "    fn make_shape() -> Shape {",// 5  <- selectionRange.start
    "        Shape::default()",
    "    }",
    "}",
  ];
  assert.strictEqual(
    classifyTestNode("rust", classifyInput({
      name: "make_shape", filePath: "/repo/src/shape.rs", lines,
      rangeStartLine: 4, selectionStartLine: 5,
    })),
    "plain"
  );
});

test("classifyTestNode rust: lines undefined means the file could not be read, so plain [surface: 'every attribute-based language answers plain']", () => {
  assert.strictEqual(
    classifyTestNode("rust", classifyInput({ name: "area_of_unit_square", lines: undefined, rangeStartLine: 2, selectionStartLine: 6 })),
    "plain"
  );
});

test("classifyTestNode rust: an empty file yields an empty window and plain [surface: 'a lineCount of 0 ... every attribute language answers plain']", () => {
  assert.strictEqual(
    classifyTestNode("rust", classifyInput({ name: "thing", lines: [], rangeStartLine: 0, selectionStartLine: 0 })),
    "plain"
  );
});

test("classifyTestNode rust: an attribute BELOW the name line is outside the window [surface: window 'DOWN TO selectionStartLine inclusive']", () => {
  const lines = [
    "fn thing() {",   // 0 <- range and selection
    "}",              // 1
    "",               // 2
    "#[test]",        // 3  belongs to the NEXT function
    "fn other() {",   // 4
  ];
  assert.strictEqual(
    classifyTestNode("rust", classifyInput({ name: "thing", lines, rangeStartLine: 0, selectionStartLine: 0 })),
    "plain",
    "the next function's #[test] must not leak upward onto this one"
  );
});

// ---------------------------------------------------------------------------
// C# row
// ---------------------------------------------------------------------------

const csWith = (attr) => classifyInput({
  name: "Shape.Tests.AreaTests.Works()",
  filePath: "/repo/tests/AreaTests.cs",
  lines: ["    /// <summary>doc</summary>", "    " + attr, "    public void Works()", "    {", "    }"],
  rangeStartLine: 0,
  selectionStartLine: 2,
});

const CS_POSITIVE = [
  "[Fact]", "[Theory]", "[Test]", "[TestCase(1, 2)]", "[TestMethod]", "[DataTestMethod]",
  "[Xunit.Fact]", "[NUnit.Framework.Test]", "[Microsoft.VisualStudio.TestTools.UnitTesting.TestMethod]",
  "[Theory, InlineData(1)]",
];
for (const attr of CS_POSITIVE) {
  test(`classifyTestNode csharp: ${JSON.stringify(attr)} IS a test [surface: C# row 'with or without a namespace qualifier']`, () => {
    assert.strictEqual(classifyTestNode("csharp", csWith(attr)), "test");
  });
}

test("classifyTestNode csharp: an attribute SHARING the declaration line is a test [surface: C# row 'with or without brackets sharing a line']", () => {
  const lines = [
    "    /// <summary>doc</summary>",         // 0 <- range.start
    "    [Fact] public void Works() { }",     // 1 <- selectionRange.start, name on the same line
  ];
  assert.strictEqual(
    classifyTestNode("csharp", classifyInput({
      name: "Shape.Tests.Works()", filePath: "/repo/tests/A.cs", lines,
      rangeStartLine: 0, selectionStartLine: 1,
    })),
    "test"
  );
});

const CS_NEGATIVE = [
  ["[Serializable]", "an ordinary attribute"],
  ["[Obsolete(\"use Works2\")]", "an ordinary attribute with arguments"],
  ["[SetUp]", "a fixture hook, not one of the listed test attributes"],
  ["[TestFixture]", "a CLASS attribute; the contract lists the method attributes explicitly and TestFixture is not among them"],
  ["public void NotAnAttributeAtAll()", "no attribute in the window"],
];
for (const [attr, why] of CS_NEGATIVE) {
  test(`classifyTestNode csharp: ${JSON.stringify(attr)} is NOT a test (${why}) [surface: C# row, the listed attribute set]`, () => {
    assert.strictEqual(classifyTestNode("csharp", csWith(attr)), "plain");
  });
}

test("classifyTestNode csharp: lines undefined answers plain [surface: 'every attribute-based language answers plain']", () => {
  assert.strictEqual(
    classifyTestNode("csharp", classifyInput({ name: "Shape.Tests.Works()", filePath: "/repo/tests/A.cs", lines: undefined })),
    "plain",
    "a C# name that looks like a test is still not evidence; C# classifies from the attribute"
  );
});

// ---------------------------------------------------------------------------
// Go row
// ---------------------------------------------------------------------------

const goCase = (name, filePath) => classifyInput({ name, filePath, lines: undefined });

const GO_ROWS = [
  ["TestArea", "/repo/geometry/area_test.go", "test", "Test + uppercase in a _test.go file"],
  ["Test_area", "/repo/geometry/area_test.go", "test", "Test + underscore matches [A-Z_]"],
  ["TestArea", "/repo/geometry/area.go", "plain", "a Test func in a NON _test.go file"],
  ["TestArea", "/repo/geometry/test.go", "plain", "test.go does not end in _test.go"],
  ["BenchmarkArea", "/repo/geometry/area_test.go", "plain", "a benchmark is not a covering test"],
  ["ExampleArea", "/repo/geometry/area_test.go", "plain", "an example is not a covering test"],
  // SUPERSEDED BY MEASUREMENT. The contract's Go cell said `^Test[A-Z_]`, so this
  // row read bare `Test` as plain. The adversarial review flagged it and the
  // build session RAN THE TOOLCHAIN: a package containing `func Test(t
  // *testing.T)` and `func Test1Suite(t *testing.T)` executes BOTH, and
  // `go test -run '^(Test)$'` selects the bare one. (`Testlower` is a BUILD
  // ERROR, not a skipped test: "first letter after 'Test' must not be
  // lowercase".) Go's real rule is Test followed by a rune that is not
  // lower-case, or end of name, and the contract's cell was wrong. A test the
  // walk mislabels as plain is worse than noise: it gets walked THROUGH instead
  // of recorded, so a real covering test disappears from the answer.
  ["Test", "/repo/geometry/area_test.go", "test", "bare `Test` really runs: measured with the go toolchain"],
  ["Test1Suite", "/repo/geometry/area_test.go", "test", "digit after Test is not lower-case, so it runs"],
  ["Testing", "/repo/geometry/area_test.go", "plain", "Test followed by a lowercase letter"],
  ["helperArea", "/repo/geometry/area_test.go", "plain", "a helper in a test file is not itself a test"],
  ["testArea", "/repo/geometry/area_test.go", "plain", "lowercase test does not match ^Test"],
];
for (const [name, filePath, want, why] of GO_ROWS) {
  test(`classifyTestNode go: ${name} in ${filePath.split("/").pop()} -> ${want} (${why}) [surface: Go row 'file ends _test.go AND name matches ^Test[A-Z_]']`, () => {
    assert.strictEqual(classifyTestNode("go", goCase(name, filePath)), want);
  });
}

test("classifyTestNode go: FuzzArea in a _test.go file is a test [surface: Go row - CONTRACT GAP, see comment]", () => {
  // CONTRACT GAP: the Go row's rule cell gives the regex `^Test[A-Z_]` and, in
  // the same cell, concludes "Test and Fuzz only". A Fuzz target matches the
  // prose and NOT the regex, so the contract contradicts itself here.
  // READING TAKEN: the prose sentence is the later, more specific decision (it
  // is the answer to the Benchmark question), so Fuzz IS a covering test and
  // the regex simply was not updated. If the implementation follows the regex,
  // this row is a CONTRACT defect to settle, not a code defect.
  assert.strictEqual(classifyTestNode("go", goCase("FuzzArea", "/repo/geometry/area_test.go")), "test");
});

test("classifyTestNode go: an attribute-looking line in the window changes nothing [surface: Go row classifies from 'the item's own name and uri']", () => {
  const got = classifyTestNode("go", classifyInput({
    name: "helperArea",
    filePath: "/repo/geometry/area_test.go",
    lines: ["// [Fact] #[test]", "func helperArea() {"],
    rangeStartLine: 0,
    selectionStartLine: 1,
  }));
  assert.strictEqual(got, "plain", "Go never reads the attribute window");
});

test("classifyTestNode go: an unreadable file does not stop Go classifying from name and path [surface: 'the name/uri-based languages (Go, Python) still answer from the name and path alone']", () => {
  assert.strictEqual(classifyTestNode("go", goCase("TestArea", "/repo/geometry/area_test.go")), "test");
});

// ---------------------------------------------------------------------------
// Python row
// ---------------------------------------------------------------------------

const PY_ROWS = [
  ["test_area", "/repo/tests/test_shapes.py", "test", "test_ prefix file, test_ function"],
  ["test_area", "/repo/tests/shapes_test.py", "test", "_test.py suffix file"],
  ["TestShapes.test_area", "/repo/tests/test_shapes.py", "test", "the LAST dotted segment is what matters"],
  ["Outer.TestShapes.test_area", "/repo/tests/test_shapes.py", "test", "deeply qualified, last segment still test_"],
  ["test_area", "/repo/src/helpers.py", "plain", "a test_ name in a non-test file"],
  ["make_shape", "/repo/tests/test_shapes.py", "plain", "a helper inside a test file"],
  ["TestShapes.make_shape", "/repo/tests/test_shapes.py", "plain", "last segment is not test_"],
  ["TestShapes.test_area", "/repo/src/helpers.py", "plain", "right name, wrong file"],
  ["test_area", "/repo/tests/testing.py", "plain", "testing.py matches neither basename pattern"],
  ["test_area", "/repo/tests/test_shapes.pyi", "plain", "the basename pattern is anchored on .py"],
  ["testarea", "/repo/tests/test_shapes.py", "plain", "test without the underscore"],
  ["TestShapes", "/repo/tests/test_shapes.py", "plain", "the class itself is not a test function"],
];
for (const [name, filePath, want, why] of PY_ROWS) {
  test(`classifyTestNode python: ${name} in ${filePath.split("/").pop()} -> ${want} (${why}) [surface: Python row 'basename matches ... AND the name's LAST dotted segment matches ^test_']`, () => {
    assert.strictEqual(classifyTestNode("python", classifyInput({ name, filePath, lines: undefined })), want);
  });
}

// ---------------------------------------------------------------------------
// TypeScript row
// ---------------------------------------------------------------------------

test("classifyTestNode typescript: ALWAYS plain, whatever the name, path or window says [surface: TS row 'TypeScript is ruled to FILE granularity']", () => {
  const rows = [
    { name: "it", filePath: "/repo/src/area.test.ts", lines: ["describe('area', () => {", "  it('works', () => {"], rangeStartLine: 0, selectionStartLine: 1 },
    { name: "shouldWork", filePath: "/repo/src/area.spec.ts", lines: ["#[test]", "function shouldWork() {"], rangeStartLine: 0, selectionStartLine: 1 },
    { name: "TestArea", filePath: "/repo/src/area_test.go", lines: undefined },
    { name: "test_area", filePath: "/repo/tests/test_shapes.py", lines: undefined },
    { name: "describe", filePath: "/repo/src/__tests__/area.test.ts", lines: ["    [Fact]", "    function describe() {"], rangeStartLine: 0, selectionStartLine: 1 },
  ];
  for (const over of rows) {
    assert.strictEqual(classifyTestNode("typescript", classifyInput(over)), "plain", `${over.name} in ${over.filePath}`);
  }
});

// ---------------------------------------------------------------------------
// runnerFilterFor
// ---------------------------------------------------------------------------

test("runnerFilterFor rust: the bare name as given [surface: runnerFilterFor rust row]", () => {
  assert.strictEqual(runnerFilterFor("rust", "area_of_unit_square"), "area_of_unit_square");
  assert.strictEqual(runnerFilterFor("rust", "tests::area"), "tests::area", "whatever the server said, unchanged");
});

test("runnerFilterFor go: the bare name as given [surface: runnerFilterFor go row]", () => {
  assert.strictEqual(runnerFilterFor("go", "TestArea"), "TestArea");
  assert.strictEqual(runnerFilterFor("go", "Test_area"), "Test_area");
});

test("runnerFilterFor python: the LAST dotted segment [surface: runnerFilterFor python row]", () => {
  assert.strictEqual(runnerFilterFor("python", "TestShapes.test_area"), "test_area");
  assert.strictEqual(runnerFilterFor("python", "test_area"), "test_area", "no dot, nothing to strip");
  assert.strictEqual(runnerFilterFor("python", "Outer.TestShapes.test_area"), "test_area");
});

test("runnerFilterFor csharp: a trailing () is stripped and the qualification kept [surface: runnerFilterFor C# row, the worked example]", () => {
  assert.strictEqual(runnerFilterFor("csharp", "Shape.Tests.WorksDirectly()"), "Shape.Tests.WorksDirectly");
});

test("runnerFilterFor csharp: an argument list is stripped too [surface: runnerFilterFor C# row 'and any argument list']", () => {
  assert.strictEqual(runnerFilterFor("csharp", "Shape.Tests.Works(int a, string b)"), "Shape.Tests.Works");
  assert.strictEqual(runnerFilterFor("csharp", "Shape.Tests.Works(System.Collections.Generic.List<int> xs)"), "Shape.Tests.Works");
});

test("runnerFilterFor csharp: a name with no dot is returned as given [surface: runnerFilterFor C# row 'A name with no dot is returned as given']", () => {
  assert.strictEqual(runnerFilterFor("csharp", "WorksDirectly"), "WorksDirectly");
});

test("runnerFilterFor csharp: an undotted name WITH parens still loses them [surface: runnerFilterFor C# row - CONTRACT GAP, see comment]", () => {
  // CONTRACT GAP: the C# row says "strip a trailing () and any argument list"
  // and then "A name with no dot is returned as given". For `Works()` those two
  // sentences disagree. READING TAKEN: the strip rule is stated first and
  // unconditionally; the no-dot sentence is about QUALIFICATION (do not require
  // a dot), not a licence to keep the parens. So `Works()` becomes `Works`.
  assert.strictEqual(runnerFilterFor("csharp", "Works()"), "Works");
});

test("runnerFilterFor typescript: always undefined [surface: runnerFilterFor TS row 'the TS leg never turns a name into a test filter']", () => {
  for (const name of ["it", "shouldWork", "Shape.Tests.Works()", "test_area", "TestArea", ""]) {
    assert.strictEqual(runnerFilterFor("typescript", name), undefined, `typescript / ${JSON.stringify(name)}`);
  }
});

test("runnerFilterFor: a name that normalises to the empty string returns undefined, in every language [surface: 'Any language: a name that normalises to the empty string returns undefined']", () => {
  for (const lang of ["rust", "go", "csharp", "python"]) {
    assert.strictEqual(runnerFilterFor(lang, ""), undefined, `${lang} / empty name`);
  }
  assert.strictEqual(runnerFilterFor("csharp", "()"), undefined, "C#: nothing survives the strip");
  assert.strictEqual(runnerFilterFor("csharp", "(int a)"), undefined);
  assert.strictEqual(runnerFilterFor("python", "TestShapes."), undefined, "python: the last dotted segment is empty");
  assert.strictEqual(runnerFilterFor("python", "."), undefined);
});

// ---------------------------------------------------------------------------
// Purity
// ---------------------------------------------------------------------------

const LANGS = ["rust", "go", "csharp", "python", "typescript"];

test("classifyTestNode: never throws for hostile input, and always answers test or plain [surface: 'Never throws for any input, including a negative line number or a name with newlines']", () => {
  const hostile = [
    { name: "", filePath: "", lines: undefined, rangeStartLine: 0, selectionStartLine: 0 },
    { name: "has\na\nnewline", filePath: "/repo/tests/test_x.py", lines: undefined, rangeStartLine: 0, selectionStartLine: 0 },
    { name: "#[test]\nfn x()", filePath: "/repo/src/a.rs", lines: ["#[test]", "fn x() {"], rangeStartLine: -3, selectionStartLine: -1 },
    { name: "thing", filePath: "/repo/src/a.rs", lines: [], rangeStartLine: -1, selectionStartLine: -1 },
    { name: "thing", filePath: "/repo/src/a.rs", lines: ["#[test]"], rangeStartLine: 500, selectionStartLine: 900 },
    { name: "thing", filePath: "/repo/src/a.rs", lines: ["#[test]", "fn thing() {"], rangeStartLine: 5, selectionStartLine: 0 },
    { name: "Shape.Tests.Works()", filePath: "relative/path.cs", lines: undefined, rangeStartLine: 0, selectionStartLine: -7 },
  ];
  for (const lang of LANGS) {
    for (const over of hostile) {
      const got = classifyTestNode(lang, classifyInput(over));
      assert.ok(got === "test" || got === "plain", `${lang} / ${JSON.stringify(over.name)} answered ${JSON.stringify(got)}`);
    }
  }
});

test("classifyTestNode: does not mutate its input [surface: 'Pure. No filesystem.']", () => {
  const input = classifyInput({
    name: "area_of_unit_square", filePath: "/repo/src/geometry.rs",
    lines: RUST_DOC_TRAP, rangeStartLine: 2, selectionStartLine: 6,
  });
  const before = JSON.stringify(input);
  classifyTestNode("rust", input);
  assert.strictEqual(JSON.stringify(input), before);
});

test("runnerFilterFor: never throws for hostile names [surface: 'Never throws for any input ... a name with newlines']", () => {
  const hostile = ["", " ", "\n", "a\nb", "((()))", "Shape..Works()", "...", "Works(", "Works)", "\t"];
  for (const lang of LANGS) {
    for (const name of hostile) {
      const got = runnerFilterFor(lang, name);
      assert.ok(got === undefined || typeof got === "string", `${lang} / ${JSON.stringify(name)} answered ${JSON.stringify(got)}`);
    }
  }
});
