// White-box: the upward call walk and the per-language test classifier
// (session-v60 phase A1). Written against the implementation, so it pins the
// internals the blind oracle cannot see: the exact request LEDGER, the identity
// key's shape, and the "no clock is read without a hang guard" property.
//
// Run: npm run test:unit

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-v60-callwalk",
  `export { walkCallers, nodeKey } from "../src/core/callWalk";
export { classifyTestNode, attributeWindow, runnerFilterFor, ATTRIBUTE_LOOKBACK } from "../src/core/testClassify";\n`,
);
const { walkCallers, nodeKey, classifyTestNode, attributeWindow, runnerFilterFor, ATTRIBUTE_LOOKBACK } = mod;
test.after(cleanup);

// ---------------------------------------------------------------------------
// A graph fixture: names -> the names that CALL them. Every node gets a handle
// that is its own name, so the request ledger reads as a list of names.
// ---------------------------------------------------------------------------

const node = (name, over = {}) => ({
  name,
  filePath: over.filePath ?? `/repo/src/${name}.rs`,
  line: over.line ?? 10,
  nameLine: over.nameLine ?? 12,
  handle: name,
  ...over,
});

/** callers: { [name]: string[] }, tests: Set<string>, outOfScope: Set<string> */
function harness(callers, opts = {}) {
  const testNames = new Set(opts.tests ?? []);
  const outside = new Set(opts.outOfScope ?? []);
  const ledger = [];
  const failing = new Set(opts.failing ?? []);
  return {
    ledger,
    resolveCallers: async (n) => {
      ledger.push(n.name);
      if (failing.has(n.name)) {
        throw new Error(`server said no for ${n.name}`);
      }
      return (callers[n.name] ?? []).map((c) => node(c));
    },
    classify: (n) => (testNames.has(n.name) ? "test" : "plain"),
    inScope: (n) => !outside.has(n.name),
  };
}

const BOUNDS = { R_MAX: 100, N_MAX: 100, D_MAX: 8 };

async function walk(callers, opts = {}) {
  const h = harness(callers, opts);
  const res = await walkCallers({
    target: node(opts.targetName ?? "target"),
    resolveCallers: h.resolveCallers,
    classify: h.classify,
    inScope: h.inScope,
    bounds: { ...BOUNDS, ...(opts.bounds ?? {}) },
    signal: opts.signal,
    hangGuardMs: opts.hangGuardMs,
    now: opts.now,
  });
  return { res, ledger: h.ledger };
}

const names = (res) => res.tests.map((t) => t.node.name);

// ---------------------------------------------------------------------------
// Graph shapes
// ---------------------------------------------------------------------------

test("a test is a LEAF: the walk never asks who calls a test [ledger]", async () => {
  const { res, ledger } = await walk(
    { target: ["t_direct"], t_direct: ["some_outer_test_helper"] },
    { tests: ["t_direct"] },
  );
  assert.deepStrictEqual(names(res), ["t_direct"]);
  assert.deepStrictEqual(ledger, ["target"], "only the target's callers were ever requested");
  assert.strictEqual(res.requests, 1);
});

test("a hub is walked ONCE however many tests hang off it [ledger]", async () => {
  const { res, ledger } = await walk(
    { target: ["hub"], hub: ["t_a", "t_b", "t_c"] },
    { tests: ["t_a", "t_b", "t_c"] },
  );
  assert.deepStrictEqual(names(res).sort(), ["t_a", "t_b", "t_c"]);
  assert.deepStrictEqual(ledger, ["target", "hub"]);
  assert.ok(res.tests.every((t) => t.distance === 2));
});

test("a diamond costs one request per node, not one per path [ledger]", async () => {
  // target <- left, right; both <- shared; shared <- t
  const { res, ledger } = await walk(
    { target: ["left", "right"], left: ["shared"], right: ["shared"], shared: ["t"] },
    { tests: ["t"] },
  );
  assert.deepStrictEqual(names(res), ["t"]);
  assert.deepStrictEqual(ledger, ["target", "left", "right", "shared"]);
  assert.strictEqual(res.tests[0].distance, 3, "shortest route: target <- left <- shared <- t");
});

test("a cycle terminates and each node is requested once [ledger]", async () => {
  const { res, ledger } = await walk(
    { target: ["a"], a: ["b", "t"], b: ["a", "t"] },
    { tests: ["t"] },
  );
  assert.deepStrictEqual(names(res), ["t"]);
  assert.deepStrictEqual(ledger, ["target", "a", "b"]);
});

test("the recorded path is names, test first and target last", async () => {
  const { res } = await walk({ target: ["mid"], mid: ["inner"], inner: ["t"] }, { tests: ["t"] });
  assert.deepStrictEqual(res.tests[0].path, ["t", "inner", "mid", "target"]);
  assert.strictEqual(res.tests[0].path.length, res.tests[0].distance + 1);
});

test("results are ordered by distance ascending", async () => {
  const { res } = await walk(
    { target: ["t_near", "mid"], mid: ["t_far"] },
    { tests: ["t_near", "t_far"] },
  );
  assert.deepStrictEqual(names(res), ["t_near", "t_far"]);
  assert.deepStrictEqual(res.tests.map((t) => t.distance), [1, 2]);
});

// ---------------------------------------------------------------------------
// Bounds
// ---------------------------------------------------------------------------

test("R_MAX is a REQUEST cap and the ledger proves the exact count", async () => {
  const { res, ledger } = await walk(
    { target: ["a"], a: ["b"], b: ["c"], c: ["t"] },
    { tests: ["t"], bounds: { R_MAX: 2 } },
  );
  assert.strictEqual(res.requests, 2);
  assert.deepStrictEqual(ledger, ["target", "a"]);
  assert.strictEqual(res.stoppedBy, "requests");
  assert.deepStrictEqual(names(res), [], "the test three hops up was never reached");
});

test("N_MAX keeps what it admitted and says nodes", async () => {
  const { res } = await walk(
    { target: ["a", "b", "c", "d"] },
    { bounds: { N_MAX: 2 } },
  );
  assert.strictEqual(res.nodesAdmitted, 2);
  assert.strictEqual(res.stoppedBy, "nodes");
});

test("an exhausted graph inside every bound reports NO stop at all", async () => {
  const { res } = await walk({ target: ["t"] }, { tests: ["t"] });
  assert.strictEqual(res.stoppedBy, undefined, "absent stoppedBy is what makes a zero a FACT");
  assert.strictEqual(res.failedRequests, 0);
});

test("D_MAX leaves the frontier unasked and says depth", async () => {
  const { res, ledger } = await walk(
    { target: ["a"], a: ["b"], b: ["t"] },
    { tests: ["t"], bounds: { D_MAX: 1 } },
  );
  assert.deepStrictEqual(ledger, ["target"]);
  assert.strictEqual(res.stoppedBy, "depth");
});

test("the request cap outranks the depth cap when both apply", async () => {
  // Frontier reaches distance 1 having spent the single allowed request.
  const { res } = await walk(
    { target: ["a"], a: ["t"] },
    { tests: ["t"], bounds: { R_MAX: 1, D_MAX: 1 } },
  );
  assert.strictEqual(res.stoppedBy, "requests", "the budget cut it, not the depth dial");
});

// ---------------------------------------------------------------------------
// Failure, scope, cancellation, the clock
// ---------------------------------------------------------------------------

test("one node's rejection is survived and counted, and the walk still resolves", async () => {
  const { res } = await walk(
    { target: ["a", "b"], a: ["t_a"], b: ["t_b"] },
    { tests: ["t_a", "t_b"], failing: ["a"] },
  );
  assert.deepStrictEqual(names(res), ["t_b"]);
  assert.strictEqual(res.failedRequests, 1);
  assert.strictEqual(res.requests, 3, "the rejecting call still spent its request");
});

test("an out-of-scope node is refused BEFORE classification, so it is not a result", async () => {
  const { res } = await walk(
    { target: ["t_in", "t_out"] },
    { tests: ["t_in", "t_out"], outOfScope: ["t_out"] },
  );
  assert.deepStrictEqual(names(res), ["t_in"]);
  assert.strictEqual(res.outOfScope, 1);
});

test("an out-of-scope node reachable three ways is counted once", async () => {
  const { res } = await walk({ target: ["a", "b", "c"], a: ["x"], b: ["x"], c: ["x"] }, { outOfScope: ["x"] });
  assert.strictEqual(res.outOfScope, 1);
});

test("an already-aborted signal spends no request", async () => {
  const { res, ledger } = await walk({ target: ["t"] }, { tests: ["t"], signal: { aborted: true } });
  assert.deepStrictEqual(ledger, []);
  assert.strictEqual(res.requests, 0);
  assert.strictEqual(res.stoppedBy, "cancelled");
});

test("a mid-walk abort returns what it already has", async () => {
  const signal = { aborted: false };
  const h = harness({ target: ["t_first", "mid"], mid: ["t_second"] }, { tests: ["t_first", "t_second"] });
  const res = await walkCallers({
    target: node("target"),
    resolveCallers: async (n) => {
      const out = await h.resolveCallers(n);
      signal.aborted = true; // the human cancels the moment the first answer lands
      return out;
    },
    classify: h.classify,
    inScope: h.inScope,
    bounds: BOUNDS,
    signal,
  });
  assert.deepStrictEqual(res.tests.map((t) => t.node.name), ["t_first"]);
  assert.strictEqual(res.stoppedBy, "cancelled");
});

test("with NO hang guard the clock is never read", async () => {
  const now = () => {
    throw new Error("the walk read a clock it had no guard for");
  };
  const { res } = await walk({ target: ["a"], a: ["t"] }, { tests: ["t"], now });
  assert.deepStrictEqual(names(res), ["t"]);
});

test("the hang guard fires and says so", async () => {
  let t = 0;
  const { res } = await walk(
    { target: ["a"], a: ["b"], b: ["t"] },
    { tests: ["t"], hangGuardMs: 50, now: () => (t += 40) },
  );
  assert.strictEqual(res.stoppedBy, "hang-guard");
});

test("the same walk twice is byte-identical", async () => {
  const graph = { target: ["a", "b"], a: ["t_a"], b: ["t_b", "c"], c: ["t_c"] };
  const first = await walk(graph, { tests: ["t_a", "t_b", "t_c"] });
  const second = await walk(graph, { tests: ["t_a", "t_b", "t_c"] });
  assert.deepStrictEqual(JSON.stringify(first.res), JSON.stringify(second.res));
});

test("nodeKey separates two declarations sharing a name in one file", () => {
  assert.notStrictEqual(nodeKey(node("f", { line: 1 })), nodeKey(node("f", { line: 2 })));
  assert.strictEqual(nodeKey(node("f", { line: 1 })), nodeKey(node("f", { line: 1, handle: "other" })));
});

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

const classifyAt = (lang, lines, name, rangeStart, selStart, filePath) =>
  classifyTestNode(lang, {
    name,
    filePath,
    lines,
    rangeStartLine: rangeStart,
    selectionStartLine: selStart,
  });

test("THE DOC-COMMENT TRAP: #[test] BELOW range.start still classifies as a test", () => {
  // range.start is the doc comment, exactly as rust-analyzer reports it.
  const lines = [
    "/// Round-trips a CA through PEM.",
    "///",
    "/// This is the documented case.",
    "#[test]",
    "fn ca_round_trips() {",
  ];
  assert.strictEqual(classifyAt("rust", lines, "ca_round_trips", 0, 4, "/r/src/ca.rs"), "test");
});

test("#[cfg(test)] alone is a MODULE marker, never a test", () => {
  const lines = ["#[cfg(test)]", "fn helper() {"];
  assert.strictEqual(classifyAt("rust", lines, "helper", 0, 1, "/r/src/ca.rs"), "plain");
});

test("qualified and spaced rust test attributes both classify", () => {
  assert.strictEqual(classifyAt("rust", ["#[tokio::test]", "async fn t() {"], "t", 0, 1, "/r/a.rs"), "test");
  assert.strictEqual(classifyAt("rust", ["# [ test ]", "fn t() {"], "t", 0, 1, "/r/a.rs"), "test");
  assert.strictEqual(classifyAt("rust", ["#[test_case(1)]", "fn t(n: u8) {"], "t", 0, 1, "/r/a.rs"), "test");
});

test("C# attributes classify qualified, bare and comma-shared", () => {
  assert.strictEqual(classifyAt("csharp", ["[Fact]", "public void T()"], "C.T()", 0, 1, "/r/T.cs"), "test");
  assert.strictEqual(classifyAt("csharp", ["[Xunit.Fact]", "public void T()"], "C.T()", 0, 1, "/r/T.cs"), "test");
  assert.strictEqual(
    classifyAt("csharp", ['[Fact, Trait("k","v")]', "public void T()"], "C.T()", 0, 1, "/r/T.cs"),
    "test",
  );
  assert.strictEqual(classifyAt("csharp", ["[Obsolete]", "public void T()"], "C.T()", 0, 1, "/r/T.cs"), "plain");
});

test("Go and Python need BOTH the file and the name", () => {
  assert.strictEqual(classifyAt("go", [], "TestShape", 0, 0, "/r/shape_test.go"), "test");
  assert.strictEqual(classifyAt("go", [], "TestShape", 0, 0, "/r/shape.go"), "plain");
  assert.strictEqual(classifyAt("go", [], "helperTest", 0, 0, "/r/shape_test.go"), "plain");
  assert.strictEqual(classifyAt("python", [], "test_shape", 0, 0, "/r/test_shape.py"), "test");
  assert.strictEqual(classifyAt("python", [], "test_shape", 0, 0, "/r/shape_test.py"), "test");
  assert.strictEqual(classifyAt("python", [], "test_shape", 0, 0, "/r/helpers.py"), "plain");
  assert.strictEqual(classifyAt("python", [], "helper", 0, 0, "/r/test_shape.py"), "plain");
});

test("TypeScript is always plain and never yields a runner filter", () => {
  assert.strictEqual(classifyAt("typescript", ["it('x')"], "/r/a.test.ts", 0, 0, "/r/a.test.ts"), "plain");
  assert.strictEqual(runnerFilterFor("typescript", "/r/a.test.ts"), undefined);
});

test("an unreadable file leaves the attribute languages plain and the name languages answering", () => {
  assert.strictEqual(classifyAt("rust", undefined, "t", 0, 1, "/r/a.rs"), "plain");
  assert.strictEqual(classifyAt("csharp", undefined, "C.T()", 0, 1, "/r/a.cs"), "plain");
  assert.strictEqual(classifyAt("go", undefined, "TestX", 0, 0, "/r/a_test.go"), "test");
  assert.strictEqual(classifyAt("python", undefined, "test_x", 0, 0, "/r/test_a.py"), "test");
});

test("attributeWindow clamps and never spans backwards", () => {
  assert.deepStrictEqual(attributeWindow(10, 12, 40), { from: 10 - ATTRIBUTE_LOOKBACK, to: 12 });
  assert.deepStrictEqual(attributeWindow(0, 0, 5), { from: 0, to: 0 });
  const past = attributeWindow(99, 120, 5);
  assert.ok(past.to <= 4 && past.from >= 0);
  const empty = attributeWindow(3, 5, 0);
  assert.ok(empty.to < empty.from, "an empty file yields a window no loop enters");
  const malformed = attributeWindow(10, 4, 40);
  assert.ok(malformed.to >= malformed.from, "a selection above the range never spans backwards");
});

test("runnerFilterFor strips the C# argument list and takes Python's last segment", () => {
  assert.strictEqual(runnerFilterFor("csharp", "Shape.Tests.WorksDirectly()"), "Shape.Tests.WorksDirectly");
  assert.strictEqual(runnerFilterFor("csharp", "Shape.Tests.Works(int, string)"), "Shape.Tests.Works");
  assert.strictEqual(runnerFilterFor("csharp", "Works"), "Works");
  assert.strictEqual(runnerFilterFor("python", "TestShape.test_direct"), "test_direct");
  assert.strictEqual(runnerFilterFor("rust", "ca_round_trips"), "ca_round_trips");
  assert.strictEqual(runnerFilterFor("go", "TestShape"), "TestShape");
  assert.strictEqual(runnerFilterFor("rust", "   "), undefined);
  assert.strictEqual(runnerFilterFor("csharp", "()"), undefined);
});

test("classification never throws on hostile input", () => {
  for (const lang of ["rust", "go", "csharp", "python", "typescript"]) {
    assert.doesNotThrow(() =>
      classifyTestNode(lang, {
        name: "a\nb",
        filePath: "",
        lines: ["x"],
        rangeStartLine: -5,
        selectionStartLine: -9,
      }),
    );
  }
});

// ---------------------------------------------------------------------------
// Exclusion. The shapes below are TRACED FROM THE REAL CORPORA and scrubbed of
// every client name. VERIFIED against the live trees on 2026-08-26: 257 C# tests
// found, 45 of them in a `[Collection("postgres")]` class whose fixture drops
// four tables and recursively deletes a hardcoded absolute path - 45 of 45
// excluded, 0 missed; 1745 Rust tests, 16 excluded (13 `#[ignore]`, 3 through an
// enclosing `#[cfg(feature = "live_tests")]` module gate).
// ---------------------------------------------------------------------------

// The cleanup is REGISTERED, not dropped. Dropping it left
// `test/.impl-v60-exclusion.bundle.cjs` and its `.entry.ts` behind after every
// run - untracked build artifacts in a source tree, which is how a `git add -A`
// commits somebody's scratch file (adversarial review row L15).
const exclusionBundle = bundleCore(
  "impl-v60-exclusion",
  `export { testExclusion } from "../src/core/testExclusion";\n`,
);
const { testExclusion } = exclusionBundle.mod;
test.after(exclusionBundle.cleanup);

const excl = (lang, lines, name, rangeStart, selStart, filePath) =>
  testExclusion(lang, { name, filePath, lines, rangeStartLine: rangeStart, selectionStartLine: selStart });

test("THE DESTRUCTIVE C# CASE: the marker is on the CLASS, and the method declares nothing about it", () => {
  // Traced from the measured corpus: the method says only [SkippableFact]; the
  // DROP TABLE lives two files away in the collection fixture.
  const lines = [
    "namespace Acme.QueryService.Tests;",
    "",
    "/// <summary>The warm-connection lifecycle.</summary>",
    '[Collection("postgres")]',
    "public sealed class WarmLifecycleTests",
    "{",
    "    private readonly PostgresFixture _pg;",
    "",
    "    [SkippableFact]",
    "    public async Task One_Warm_Connection_Serves_Many_Reports()",
    "    {",
  ];
  // Its own attribute is enough here, and that is the FIRST line of defence.
  const own = excl("csharp", lines, "T.One_Warm_Connection_Serves_Many_Reports()", 8, 9, "/r/T.cs");
  assert.strictEqual(own.where, "declaration");
  assert.match(own.marker, /SkippableFact/);

  // Strip the method's own marker and the CLASS must still catch it. This is the
  // load-bearing half: a plain [Fact] in the same class is just as destructive.
  const plain = lines.slice();
  plain[8] = "    [Fact]";
  const viaClass = excl("csharp", plain, "T.One_Warm()", 8, 9, "/r/T.cs");
  assert.strictEqual(viaClass.where, "enclosing", "the class's [Collection] is the reliable tell");
  assert.match(viaClass.marker, /Collection\("postgres"\)/);
});

test("a C# class declaring IClassFixture in its BASE LIST excludes its tests", () => {
  const lines = [
    "public sealed class SmokeTests",
    "    : IClassFixture<WebApplicationFactory<Program>>",
    "{",
    "    [Fact]",
    "    public void Responds()",
  ];
  const got = excl("csharp", lines, "SmokeTests.Responds()", 3, 4, "/r/S.cs");
  assert.strictEqual(got.where, "enclosing");
  assert.match(got.marker, /IClassFixture</);
});

test("an ordinary C# test in an ordinary class is NOT excluded", () => {
  const lines = ["public sealed class MathTests", "{", "    [Fact]", "    public void Adds()"];
  assert.strictEqual(excl("csharp", lines, "MathTests.Adds()", 2, 3, "/r/M.cs"), undefined);
});

test("Rust: #[ignore] on the test and #[cfg(feature)] on the enclosing mod both exclude", () => {
  const own = ["#[test]", "#[ignore] // Run with: cargo test -- --ignored", "fn slow() {"];
  assert.strictEqual(excl("rust", own, "slow", 0, 2, "/r/a.rs").where, "declaration");

  const gated = [
    '#[cfg(feature = "live_tests")]',
    "mod live {",
    "    #[test]",
    "    fn test_write_and_read() {",
  ];
  const got = excl("rust", gated, "test_write_and_read", 2, 3, "/r/a.rs");
  assert.strictEqual(got.where, "enclosing");
  assert.match(got.marker, /cfg\(feature/);
});

test("Rust: #[cfg(test)] on the enclosing mod is NOT an exclusion", () => {
  const lines = ["#[cfg(test)]", "mod tests {", "    #[test]", "    fn works() {"];
  assert.strictEqual(excl("rust", lines, "works", 2, 3, "/r/a.rs"), undefined, "every unit test lives in one of these");
});

test("Go excludes on a file build constraint and nothing else", () => {
  assert.strictEqual(excl("go", ["//go:build integration", "", "package x"], "TestX", 4, 4, "/r/x_test.go").where, "file");
  assert.strictEqual(excl("go", ["package x"], "TestX", 2, 2, "/r/x_test.go"), undefined);
});

test("Python excludes on its own mark and on the enclosing class's", () => {
  const own = ["@pytest.mark.skipif(not HAVE_DB)", "def test_reads():"];
  assert.strictEqual(excl("python", own, "test_reads", 0, 1, "/r/test_a.py").where, "declaration");

  const cls = ["@pytest.mark.integration", "class TestLive:", "    def test_reads(self):"];
  assert.strictEqual(excl("python", cls, "TestLive.test_reads", 2, 2, "/r/test_a.py").where, "enclosing");

  assert.strictEqual(excl("python", ["def test_adds():"], "test_adds", 0, 0, "/r/test_a.py"), undefined);
});

test("TypeScript excludes a whole file the runner will not execute", () => {
  assert.strictEqual(excl("typescript", ["describe.skip('shape', () => {"], "/r/a.test.ts", 0, 0, "/r/a.test.ts").where, "file");
  assert.strictEqual(excl("typescript", ["describe('shape', () => {"], "/r/a.test.ts", 0, 0, "/r/a.test.ts"), undefined);
});

test("exclusion never throws and an unreadable file excludes nothing", () => {
  for (const lang of ["rust", "go", "csharp", "python", "typescript"]) {
    assert.strictEqual(excl(lang, undefined, "x", 0, 0, "/r/a"), undefined);
    assert.doesNotThrow(() => excl(lang, [""], "a\nb", -3, -9, ""));
  }
});

// ---------------------------------------------------------------------------
// The adversarial review's rows, pinned white-box. Each of these asserts the
// MECHANISM the review's own row only sees the outcome of, so a later
// refactor that happens to keep one shape working still has to keep the rule.
// ---------------------------------------------------------------------------

test("A1: the string mask survives the shapes a real analyzer suite writes", () => {
  // A RAW string literal, the other flush-left embedding, and one that closes on
  // a longer quote run than it opened with.
  const raw = [
    '[Collection("database")]',
    "public sealed class GeneratorTests",
    "{",
    "    [Fact]",
    "    public void Emits()",
    "    {",
    '        const string src = """',
    "public sealed class Generated",
    "{",
    "}",
    '        """;',
    "    }",
    "}",
  ];
  const above = excl("csharp", raw, "GeneratorTests.Emits()", 3, 4, "/r/G.cs");
  assert.ok(above && above.where === "enclosing", "the test ABOVE the string reaches its class as it always did");

  // The method BELOW the raw string is the one the shadowing bit.
  const below = raw.concat(["", "    [Fact]", "    public void Emits_Twice()", "    {", "    }"]);
  const got = excl("csharp", below, "GeneratorTests.Emits_Twice()", 14, 15, "/r/G.cs");
  assert.ok(got && got.where === "enclosing", "the real class head is found past the raw string");
  assert.match(got.marker, /Collection\("database"\)/);
});

test("A1: a block comment holding a class head is skipped like a string", () => {
  const lines = [
    '[Collection("database")]',
    "public sealed class ReadingTests",
    "{",
    "    /*",
    "public sealed class OldShape",
    "    */",
    "    [Fact]",
    "    public void Reads()",
    "    {",
    "    }",
    "}",
  ];
  const got = excl("csharp", lines, "ReadingTests.Reads()", 6, 7, "/r/R.cs");
  assert.ok(got && got.where === "enclosing", "a commented-out class head is not a container");
});

test("A1: Rust's `'a` lifetime does not open a char literal and mask the file", () => {
  const lines = [
    '#[cfg(feature = "live_tests")]',
    "mod live {",
    "    fn helper<'a>(x: &'a str) -> &'a str { x }",
    "    #[test]",
    "    fn writes() {",
  ];
  const got = excl("rust", lines, "writes", 3, 4, "/r/a.rs");
  assert.ok(got && got.where === "enclosing", "the mod gate is still reachable past two lifetimes");
});

test("A2: the marker is taken from the NEAREST container that carries one", () => {
  // Both classes are marked. The inner one is the more specific answer and is
  // the one reported, so `where` still points the developer somewhere useful.
  const lines = [
    '[Collection("outer")]',
    "public sealed class Outer",
    "{",
    "    private readonly DbFixture _db;",
    "",
    '    [Collection("inner")]',
    "    public sealed class Inner",
    "    {",
    "        [Fact]",
    "        public void Reads()",
    "        {",
    "        }",
    "    }",
    "}",
  ];
  const got = excl("csharp", lines, "Outer.Inner.Reads()", 8, 9, "/r/R.cs");
  assert.match(got.marker, /Collection\("inner"\)/, "nearest first, so the inner class wins");
});

test("A2: three classes deep, and only the outermost carries the marker", () => {
  const lines = [
    '[Collection("database")]',
    "public sealed class A",
    "{",
    "    private readonly DbFixture _db;",
    "    public sealed class B",
    "    {",
    "        public sealed class C",
    "        {",
    "            [Fact]",
    "            public void Reads()",
    "            {",
    "            }",
    "        }",
    "    }",
    "}",
  ];
  const got = excl("csharp", lines, "A.B.C.Reads()", 8, 9, "/r/R.cs");
  assert.ok(got && got.where === "enclosing");
  assert.match(got.marker, /Collection\("database"\)/);
});

test("A3: the attribute run is UNBOUNDED, and stops where the decoration stops", () => {
  const many = new Array(12).fill('[Trait("Layer", "unit")]');
  const lines = ['[Collection("database")]', ...many, "public sealed class T", "{", "    [Fact]", "    public void R()"];
  const decl = lines.length - 1;
  const got = excl("csharp", lines, "T.R()", decl - 1, decl, "/r/T.cs");
  assert.ok(got && got.where === "enclosing", "twelve attributes above the marker do not bury it");

  // And the run genuinely STOPS: a marker separated from the class by a
  // statement is not that class's attribute.
  const broken = ['[Collection("database")]', "public sealed class Other { }", "public sealed class T", "{", "    [Fact]", "    public void R()"];
  const bDecl = broken.length - 1;
  assert.strictEqual(excl("csharp", broken, "T.R()", bDecl - 1, bDecl, "/r/T.cs"), undefined,
    "the marker belongs to the class it decorates, not to the next one down");
});

test("A4: a tab-indented file and its space-indented twin answer identically", () => {
  const tabs = [
    '[Collection("database")]',
    "public sealed class T",
    "{",
    "\tprivate readonly DbFixture _db;",
    "",
    "\t[Fact]",
    "\tpublic void R()",
  ];
  const spaces = tabs.map((l) => l.replace(/^\t/, "    "));
  const a = excl("csharp", tabs, "T.R()", 5, 6, "/r/T.cs");
  const b = excl("csharp", spaces, "T.R()", 5, 6, "/r/T.cs");
  assert.deepStrictEqual(a, b, "indent style is not a safety setting");
  assert.ok(a && a.where === "enclosing");
});

test("A6: a module-level pytestmark, and the marks that are NOT one", () => {
  const marked = ["import pytest", "", "pytestmark = pytest.mark.integration", "", "def test_reads():"];
  const got = excl("python", marked, "test_reads", 4, 4, "/r/test_db.py");
  assert.strictEqual(got.where, "file", "a module mark is the FILE's, not the declaration's");
  assert.match(got.marker, /pytestmark/);

  // A mark outside the excluded set does not exclude.
  const benign = ["pytestmark = pytest.mark.slow", "", "def test_reads():"];
  assert.strictEqual(excl("python", benign, "test_reads", 2, 2, "/r/test_db.py"), undefined);

  // TOP LEVEL only: an indented `pytestmark` is a class attribute, and pytest
  // does not read it as a module mark.
  const indented = ["class TestX:", "    pytestmark = pytest.mark.integration", "", "    def test_reads(self):"];
  assert.strictEqual(excl("python", indented, "TestX.test_reads", 3, 3, "/r/test_db.py"), undefined);

  // The declaration's own mark still outranks the module's.
  const both = ["pytestmark = pytest.mark.integration", "", "@pytest.mark.skip", "def test_reads():"];
  assert.strictEqual(excl("python", both, "test_reads", 2, 3, "/r/test_db.py").where, "declaration");
});

test("A7: a decorator stack of any depth is read to its top", () => {
  const stack = new Array(9).fill("@pytest.mark.parametrize('a', [1, 2])");
  const lines = ["@pytest.mark.skipif(NO_DB, reason='needs a live database')", ...stack, "def test_reads(a):"];
  const decl = lines.length - 1;
  const got = excl("python", lines, "test_reads", decl, decl, "/r/test_db.py");
  assert.strictEqual(got.where, "declaration");
  assert.match(got.marker, /skipif/);
});

test("A8: the Go head scan ends at `package`, not at a line number", () => {
  const header = new Array(40).fill("// Copyright 2026 The Shape Authors.");
  const withTag = [...header, "//go:build integration", "", "package store", "", "//go:build nonsense"];
  assert.strictEqual(excl("go", withTag, "TestR", 6, 6, "/r/s_test.go").where, "file");

  // A tag BELOW the package clause is not a build constraint and must not read
  // as one: Go ignores it, so excluding on it would refuse a test that runs.
  const after = ["package store", "", "//go:build integration"];
  assert.strictEqual(excl("go", after, "TestR", 2, 2, "/r/s_test.go"), undefined);
});

test("A9/A10: Go classification follows the toolchain's own isTest rule", () => {
  const go = (name) => classifyTestNode("go", { name, filePath: "/r/s_test.go", lines: undefined, rangeStartLine: 0, selectionStartLine: 0 });
  assert.strictEqual(go("Test"), "test", "`func Test(t *testing.T)` is a test");
  assert.strictEqual(go("Test1Suite"), "test", "a digit is not lower case");
  assert.strictEqual(go("Test_area"), "test");
  assert.strictEqual(go("TestArea"), "test");
  assert.strictEqual(go("Fuzz"), "test");
  assert.strictEqual(go("Testing"), "plain", "a lower-case rune after the prefix disqualifies it");
  assert.strictEqual(go("TestMain"), "plain", "the package entry point; `-run TestMain` selects nothing");
  assert.strictEqual(go("BenchmarkArea"), "plain");
});

test("A11: C# type arguments never reach a runner filter", () => {
  assert.strictEqual(runnerFilterFor("csharp", "Shape.Tests.Works<int>()"), "Shape.Tests.Works");
  assert.strictEqual(
    runnerFilterFor("csharp", "Shape.Tests.Works<Dictionary<int, string>>()"),
    "Shape.Tests.Works",
    "a nested argument list collapses too",
  );
  assert.strictEqual(runnerFilterFor("csharp", "Shape.Tests<T>.Works()"), "Shape.Tests.Works");
  assert.strictEqual(runnerFilterFor("csharp", "Shape.Tests.Works<int>(int, string)"), "Shape.Tests.Works");
  assert.strictEqual(runnerFilterFor("csharp", "<T>()"), undefined, "nothing left is not a filter");
});

test("A14: cancellation outranks the node cap, however late the signal flips", () => {
  return (async () => {
    const signal = { aborted: false };
    const res = await walkCallers({
      target: node("target"),
      resolveCallers: async () => {
        signal.aborted = true;
        return [node("a"), node("b"), node("c")];
      },
      classify: () => "plain",
      inScope: () => true,
      bounds: { R_MAX: 100, N_MAX: 2, D_MAX: 8 },
      signal,
      now: () => {
        throw new Error("the walk read a clock it had no guard for");
      },
    });
    assert.strictEqual(res.stoppedBy, "cancelled", "the human's cancel, not a budget");
    assert.strictEqual(res.nodesAdmitted, 2, "what was admitted before the cap is kept");
  })();
});

test("A5: a base class declared IN THIS FILE is resolved and read", () => {
  const lines = [
    '[Collection("database")]',
    "public abstract class DatabaseTestBase",
    "{",
    "    protected DbFixture Db;",
    "}",
    "",
    "public sealed class ReadingTests : DatabaseTestBase",
    "{",
    "    [Fact]",
    "    public void Reads()",
    "    {",
    "    }",
    "}",
  ];
  const got = excl("csharp", lines, "ReadingTests.Reads()", 8, 9, "/r/R.cs");
  assert.strictEqual(got.where, "enclosing");
  assert.match(got.marker, /Collection\("database"\)/, "the marker quoted is the BASE's, not a guess");
});

test("A5: a base declared elsewhere is excluded WITH ITS NAME, and an interface list is not", () => {
  const unresolved = [
    "public sealed class ReadingTests : DatabaseTestBase",
    "{",
    "    [Fact]",
    "    public void Reads()",
  ];
  const got = excl("csharp", unresolved, "ReadingTests.Reads()", 2, 3, "/r/R.cs");
  assert.match(got.marker, /DatabaseTestBase/, "the developer is told which base could not be followed");

  // MEASURED on the real C# corpus: every base list in it is interfaces only
  // (ICloudIngest, IDisposable, ICollection), so this branch costs that corpus
  // nothing. If it started excluding ordinary suites, THIS is the row that moves.
  const interfacesOnly = [
    "public sealed class MathTests : IDisposable, ICloudIngest",
    "{",
    "    [Fact]",
    "    public void Adds()",
  ];
  assert.strictEqual(excl("csharp", interfacesOnly, "MathTests.Adds()", 2, 3, "/r/M.cs"), undefined);

  // And an ordinary class with no base list at all is still untouched.
  const plain = ["public sealed class MathTests", "{", "    [Fact]", "    public void Adds()"];
  assert.strictEqual(excl("csharp", plain, "MathTests.Adds()", 2, 3, "/r/M.cs"), undefined);
});
