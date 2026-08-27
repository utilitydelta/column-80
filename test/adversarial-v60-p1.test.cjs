// Adversarial rows against session-v60 phase A1: `src/core/callWalk.ts`,
// `src/core/testClassify.ts` and `src/core/testExclusion.ts`.
//
// The exclusion filter is a SAFETY control, not a report field. It exists
// because a real .NET corpus measured this session has 45 of 257 tests sitting
// in a `[Collection(...)]` class whose fixture drops tables in a live database
// and recursively deletes a hardcoded absolute path under the user's home. A
// marked test that slips through gets RUN, and the repair loop re-runs it, so a
// miss costs the developer's data.
//
// Every row below is a LAYOUT the filter gets wrong, or a walk result whose
// bookkeeping licenses a false statement. Each destructive row carries its own
// POSITIVE CONTROL: the same class, flattened to the layout the filter does
// handle, must still exclude. Without the control a red row proves only that the
// fixture is broken.
//
// The C# shapes are traced from a real test tree and scrubbed to neutral names:
// no client name, project name or connection string appears here. The embedded
// source-in-a-string shape (row 1) is the layout that tree's analyzer tests
// actually use; only the indentation is moved to where it bites.
//
// Run: node --test test/adversarial-v60-p1.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "adv-v60-p1",
  `export { walkCallers, nodeKey } from "../src/core/callWalk";
export { classifyTestNode, attributeWindow, runnerFilterFor, ATTRIBUTE_LOOKBACK } from "../src/core/testClassify";
export { testExclusion } from "../src/core/testExclusion";\n`,
);
const { walkCallers, nodeKey, classifyTestNode, attributeWindow, runnerFilterFor, testExclusion } = mod;
test.after(cleanup);

const excl = (lang, lines, name, rangeStart, selStart, filePath) =>
  testExclusion(lang, { name, filePath, lines, rangeStartLine: rangeStart, selectionStartLine: selStart });

const classify = (lang, lines, name, rangeStart, selStart, filePath) =>
  classifyTestNode(lang, { name, filePath, lines, rangeStartLine: rangeStart, selectionStartLine: selStart });

/** Index of the first line matching `re`, so the fixtures below stay readable. */
const at = (lines, re) => lines.findIndex((l) => re.test(l));

// ===========================================================================
// EXCLUSION - C#. Each of these is a test that RUNS when it must not.
// ===========================================================================

test("A1 [HIGH] a class head inside a STRING LITERAL shadows the real enclosing type", () => {
  // Analyzer / source-generator / codegen suites embed C# source in a verbatim
  // or raw string and write it FLUSH LEFT. With a block-scoped namespace the
  // members sit at indent 8, so a flush-left `public sealed class C` inside the
  // string has a SMALLER indent than the test method and matches CS_TYPE_HEAD.
  // `enclosingDeclLine` walks up, hits it first, and stops - the real
  // `[Collection(...)]` class two screens above is never consulted.
  const lines = [
    "namespace Shape.Tests",
    "{",
    '    [Collection("database")]',
    "    public sealed class AnalyzerTests",
    "    {",
    "        [Fact]",
    "        public void Flags_A_Property()",
    "        {",
    '            const string src = @"',
    "public sealed class C",
    "{",
    "    public int Foo { get; set; }",
    "}",
    '";',
    "            Verify.Fires(src);",
    "        }",
    "",
    "        [Fact]",
    "        public void Stays_Silent_On_A_Field()",
    "        {",
    "            Verify.Silent(Sample);",
    "        }",
    "    }",
    "}",
  ];
  const second = at(lines, /Stays_Silent_On_A_Field/);
  const got = excl("csharp", lines, "AnalyzerTests.Stays_Silent_On_A_Field()", second - 1, second, "/r/A.cs");

  // POSITIVE CONTROL: delete the embedded snippet and the very same test is
  // excluded, so the fixture is sound and only the string literal moved it.
  const control = lines.filter((_, i) => i < 8 || i > 13);
  const cSecond = at(control, /Stays_Silent_On_A_Field/);
  const ctl = excl("csharp", control, "AnalyzerTests.Stays_Silent_On_A_Field()", cSecond - 1, cSecond, "/r/A.cs");
  assert.ok(ctl && ctl.where === "enclosing", "control: without the string literal the class marker is found");

  assert.ok(got, "a [Collection] test must never be handed to the runner");

  // The FILE-scoped variant, which is the layout the measured corpus actually
  // uses: members at indent 4, the verbatim string flush left at indent 0.
  const fileScoped = [
    "namespace Shape.Tests;",
    "",
    '[Collection("database")]',
    "public sealed class AnalyzerTests",
    "{",
    "    [Fact]",
    "    public void Flags_A_Property()",
    "    {",
    '        const string src = @"',
    "public sealed class C",
    "{",
    "}",
    '";',
    "    }",
    "",
    "    [Fact]",
    "    public void Stays_Silent_On_A_Field()",
    "    {",
    "    }",
    "}",
  ];
  const fsDecl = at(fileScoped, /Stays_Silent_On_A_Field/);
  assert.ok(
    excl("csharp", fileScoped, "AnalyzerTests.Stays_Silent_On_A_Field()", fsDecl - 1, fsDecl, "/r/A.cs"),
    "file-scoped namespace, flush-left verbatim string: the same shadowing",
  );
});

test("A2 [HIGH] a NESTED test class hides the outer class's [Collection]", () => {
  // xunit's nested-class idiom. `enclosingDeclLine` returns only the NEAREST
  // enclosing type and the marker scan is +/-3 lines around it, so the outer
  // class's attribute is out of reach as soon as the outer class has a fixture
  // field and a constructor - which is exactly what a collection class has.
  const lines = [
    '[Collection("database")]',
    "public sealed class ReadingTests",
    "{",
    "    private readonly DbFixture _db;",
    "    public ReadingTests(DbFixture db) => _db = db;",
    "",
    "    private static readonly Guid Site = Guid.NewGuid();",
    "",
    "    public sealed class WhenReading",
    "    {",
    "        [Fact]",
    "        public void Returns_The_Latest_Row()",
    "        {",
    "        }",
    "    }",
    "}",
  ];
  const decl = at(lines, /Returns_The_Latest_Row/);
  const got = excl("csharp", lines, "ReadingTests.WhenReading.Returns_The_Latest_Row()", decl - 1, decl, "/r/R.cs");

  // POSITIVE CONTROL: the same method, un-nested, is excluded.
  const flat = [
    '[Collection("database")]',
    "public sealed class ReadingTests",
    "{",
    "    private readonly DbFixture _db;",
    "    public ReadingTests(DbFixture db) => _db = db;",
    "",
    "    [Fact]",
    "    public void Returns_The_Latest_Row()",
    "    {",
    "    }",
    "}",
  ];
  const fDecl = at(flat, /Returns_The_Latest_Row/);
  const ctl = excl("csharp", flat, "ReadingTests.Returns_The_Latest_Row()", fDecl - 1, fDecl, "/r/R.cs");
  assert.ok(ctl && ctl.where === "enclosing", "control: the un-nested test IS excluded");

  assert.ok(got, "a test nested one class deeper is still in the destructive collection");
});

test("A3 [MEDIUM] a class attributed more than ATTRIBUTE_LOOKBACK lines above its head is missed", () => {
  // Ordering attributes is a house style, not a rarity, and xunit's own
  // TestCaseOrderer / TestFramework attributes stack on the class.
  const lines = [
    '[Collection("database")]',
    '[Trait("Layer", "integration")]',
    "[TestCaseOrderer(\"Shape.Tests.Alphabetical\", \"Shape.Tests\")]",
    "[Obsolete(\"pending the v3 rewrite\")]",
    "public sealed class ReadingTests",
    "{",
    "    [Fact]",
    "    public void Reads()",
    "    {",
    "    }",
    "}",
  ];
  const decl = at(lines, /public void Reads/);
  const got = excl("csharp", lines, "ReadingTests.Reads()", decl - 1, decl, "/r/R.cs");

  const control = lines.slice(0, 1).concat(lines.slice(4));
  const cDecl = at(control, /public void Reads/);
  const ctl = excl("csharp", control, "ReadingTests.Reads()", cDecl - 1, cDecl, "/r/R.cs");
  assert.ok(ctl && ctl.where === "enclosing", "control: one attribute above the head IS found");

  assert.ok(got, "four attributes on the class do not make its [Collection] stop counting");
});

test("A4 [MEDIUM] mixed tabs and spaces invert the indent comparison", () => {
  // `indentOf` counts a tab as one character. A class head written with four
  // SPACES (indent 4) around members written with two TABS (indent 2) makes the
  // enclosing head look DEEPER than its own member, so no container is found.
  // A collection class always has the fixture field and the constructor, which
  // is enough to push the class attribute out of the method's own 3-line
  // lookback as well, so nothing catches it.
  const lines = [
    "namespace Shape.Tests",
    "{",
    '    [Collection("database")]',
    "    public sealed class ReadingTests",
    "    {",
    "\t\tprivate readonly DbFixture _db;",
    "\t\tpublic ReadingTests(DbFixture db) => _db = db;",
    "",
    "\t\t[Fact]",
    "\t\tpublic void Reads()",
    "\t\t{",
    "\t\t}",
    "    }",
    "}",
  ];
  const decl = at(lines, /public void Reads/);
  const got = excl("csharp", lines, "ReadingTests.Reads()", decl - 1, decl, "/r/R.cs");

  const control = lines.map((l) => l.replace(/^\t\t/, "        "));
  const ctl = excl("csharp", control, "ReadingTests.Reads()", decl - 1, decl, "/r/R.cs");
  assert.ok(ctl && ctl.where === "enclosing", "control: all-spaces, same file, IS excluded");

  assert.ok(got, "an indent style change must not disarm a safety filter");
});

test("A5 [MEDIUM] a BASE CLASS carrying the collection marker is invisible", () => {
  // The other half of xunit's shared-fixture idiom: the collection attribute
  // goes on an abstract base and every suite derives from it. Nothing in the
  // derived file says "database", and the filter reads one file.
  const lines = [
    "public sealed class ReadingTests : DatabaseTestBase",
    "{",
    "    [Fact]",
    "    public void Reads()",
    "    {",
    "    }",
    "}",
  ];
  const decl = at(lines, /public void Reads/);
  const got = excl("csharp", lines, "ReadingTests.Reads()", decl - 1, decl, "/r/R.cs");
  assert.ok(got, "inheriting the collection inherits the destruction");
});

// ===========================================================================
// EXCLUSION - Python and Go
// ===========================================================================

test("A6 [MEDIUM] a module-level `pytestmark` marks every test in the file and is not read", () => {
  // This is pytest's documented way to mark a whole module, and it is what a
  // suite that needs a live database uses instead of decorating 40 functions.
  const lines = [
    "import pytest",
    "",
    "pytestmark = pytest.mark.integration",
    "",
    "def test_reads_from_the_database():",
    "    assert True",
  ];
  const decl = at(lines, /def test_reads/);
  const got = excl("python", lines, "test_reads_from_the_database", decl, decl, "/r/test_db.py");

  const control = ["import pytest", "", "@pytest.mark.integration", "def test_reads_from_the_database():"];
  const ctl = excl("python", control, "test_reads_from_the_database", 2, 3, "/r/test_db.py");
  assert.ok(ctl && ctl.where === "declaration", "control: the same mark as a decorator IS read");

  assert.ok(got, "a module-level pytestmark is the enclosing scope's marker");
});

test("A7 [MEDIUM] a decorator stack deeper than ATTRIBUTE_LOOKBACK hides the skip mark", () => {
  // Only bites if the Python server's `range` starts at the `def` rather than at
  // the first decorator, which this build has NOT measured. The row pins the
  // consequence so the assumption is written down instead of assumed.
  const lines = [
    "@pytest.mark.skipif(NO_DB, reason='needs a live database')",
    "@pytest.mark.parametrize('a', [1, 2])",
    "@pytest.mark.parametrize('b', [3, 4])",
    "@pytest.mark.parametrize('c', [5, 6])",
    "def test_reads(a, b, c):",
    "    assert True",
  ];
  const decl = at(lines, /^def test_reads/);
  const got = excl("python", lines, "test_reads", decl, decl, "/r/test_db.py");
  assert.ok(got, "the skipif is four lines up and the window reaches three");
});

test("A8 [LOW] a build constraint under a licence header is out of the 16-line head scan", () => {
  const header = new Array(16).fill("// Copyright 2026 The Shape Authors. All rights reserved.");
  const lines = [...header, "", "//go:build integration", "", "package store"];
  const got = excl("go", lines, "TestReads", 20, 20, "/r/store_test.go");

  const ctl = excl("go", ["//go:build integration", "", "package store"], "TestReads", 4, 4, "/r/store_test.go");
  assert.ok(ctl && ctl.where === "file", "control: a bare build tag IS read");

  assert.ok(got, "the head scan stops at line 15; a 16-line licence header pushes the tag past it");
});

// ===========================================================================
// CLASSIFICATION
// ===========================================================================

test("A9 [LOW] Go's own valid test names `Test` and `Test1Suite` classify as PLAIN", () => {
  // `go test` runs any `func TestXxx` whose first rune after `Test` is not a
  // lower-case letter, and `func Test(t *testing.T)` with nothing after it. The
  // classifier demands `[A-Z_]`, so a digit or an empty suffix reads as plain -
  // the test is walked THROUGH instead of recorded, and never runs.
  assert.strictEqual(classify("go", [], "Test", 0, 0, "/r/s_test.go"), "test", "`func Test` is a test");
  assert.strictEqual(classify("go", [], "Test1Suite", 0, 0, "/r/s_test.go"), "test", "a digit is not lower case");
});

test("A10 [LOW] Go's TestMain is not a test and must not become a runner filter", () => {
  // TestMain is the package's entry point. `-run TestMain` selects nothing, so
  // recording it produces a filter miss the developer cannot act on.
  assert.strictEqual(classify("go", [], "TestMain", 0, 0, "/r/s_test.go"), "plain");
});

test("A11 [MEDIUM] a GENERIC C# test method keeps its type arguments in the runner filter", () => {
  // VSTest filters on FullyQualifiedName, which for `Works<T>` is `...Works`.
  // Leaving `<int>` in produces a filter that matches no test - the shape that
  // reports a clean run for a suite that never executed.
  assert.strictEqual(runnerFilterFor("csharp", "Shape.Tests.Works<int>()"), "Shape.Tests.Works");
});

// ===========================================================================
// THE WALK. An absent `stoppedBy` is what licenses the product to say
// "no test in this crate calls X" as a FACT.
// ===========================================================================

const node = (name, over = {}) => ({
  name,
  filePath: over.filePath ?? `/repo/src/${name}.rs`,
  line: over.line ?? 10,
  nameLine: over.nameLine ?? 12,
  handle: name,
  ...over,
});

async function run(opts) {
  return walkCallers({
    target: node("target"),
    resolveCallers: opts.resolveCallers,
    classify: opts.classify ?? (() => "plain"),
    inScope: opts.inScope ?? (() => true),
    bounds: { R_MAX: 100, N_MAX: 100, D_MAX: 8, ...(opts.bounds ?? {}) },
    signal: opts.signal,
    hangGuardMs: opts.hangGuardMs,
    now: opts.now,
  });
}

// A12, TRIAGED AND ANSWERED, and the answer is not the one this row proposed.
//
// The finding was right and it was the most important one in the review: an
// absent `stoppedBy` is what licenses the product to state a zero as a FACT, and
// a rejected request leaves a whole subtree unseen. The ruling put the fix at
// the CONSUMER rather than in the walk. `stoppedBy` keeps meaning exactly one
// thing - every node the walk was ALLOWED to visit was visited, within every
// bound - because a rejection is survivable and is not a bound. What changed is
// that `testDiscovery.provenZero`, the ONE thing that produces the fact-shaped
// sentence, now requires `failedRequests === 0` as well, and both doc comments
// say so. The false comment on callWalk.ts, which claimed absent meant the graph
// was exhausted, was itself the defect and is gone.
//
// This row now pins the ruled behaviour on both halves.
test("A12 [RULED] a rejected resolveCallers is survivable, and provenZero is what refuses to call it a fact", () => {
  return (async () => {
    const res = await run({
      resolveCallers: async () => {
        throw new Error("server wedged on this item");
      },
    });
    assert.strictEqual(res.tests.length, 0);
    assert.strictEqual(res.failedRequests, 1);
    assert.strictEqual(res.stoppedBy, undefined, "a rejection is not a BOUND, so it is not a stop");
  })();
});

// A13, TRIAGED: the VALUE is right and stays; only the old comment was wrong.
//
// For Rust the crate scope IS the question. goal.md rules it explicitly: "a
// function whose only callers live in a sibling crate discovers nothing, and
// that is the intended answer." So a walk that refused out-of-crate callers and
// found nothing has proved exactly what the honest-zero sentence claims, and
// `provenZero` is deliberately NOT gated on `outOfScope`. The count is on the
// result so the surface can say how many it turned away, which it does.
test("A13 [RULED] an out-of-scope refusal is the DESIGNED answer, not a truncation", () => {
  return (async () => {
    const res = await run({
      resolveCallers: async (n) => (n.name === "target" ? [node("sibling_crate_test")] : []),
      inScope: (n) => n.name === "target",
      classify: () => "test",
    });
    assert.strictEqual(res.tests.length, 0);
    assert.strictEqual(res.outOfScope, 1, "counted, so the surface can say how many were turned away");
    assert.strictEqual(res.stoppedBy, undefined, "scope is the question, not a bound that cut the answer short");
  })();
});

test("A14 [MEDIUM] cancellation loses to the node cap, against rule 9's precedence", () => {
  return (async () => {
    const signal = { aborted: false };
    const res = await run({
      signal,
      bounds: { N_MAX: 2 },
      resolveCallers: async () => {
        signal.aborted = true; // the human presses cancel while the answer is in flight
        return [node("a"), node("b"), node("c")];
      },
    });
    assert.strictEqual(res.stoppedBy, "cancelled", "rule 9 ranks cancelled above nodes; got " + res.stoppedBy);
  })();
});

test("V1 [VERIFIED] nodeKey is exactly the string the contract specifies", () => {
  assert.strictEqual(nodeKey(node("f", { filePath: "/a/b.rs", line: 7 })), "/a/b.rs#7:f");
});

test("V2 [VERIFIED] attributeWindow's clamped and malformed spans, pinned exactly", () => {
  // The implementer's own rows assert `to <= 4` and `to >= from`, which a window
  // of {0,0} satisfies. The contract names the exact span.
  assert.deepStrictEqual(attributeWindow(99, 120, 5), { from: 1, to: 4 });
  assert.deepStrictEqual(attributeWindow(10, 4, 40), { from: 7, to: 10 });
});

test("V3 [VERIFIED] depthReached is right on a walk cut by the node cap", () => {
  return (async () => {
    const graph = { target: ["a"], a: ["b"], b: ["c", "d"] };
    const res = await run({
      bounds: { N_MAX: 3 },
      resolveCallers: async (n) => (graph[n.name] ?? []).map((c) => node(c)),
    });
    assert.strictEqual(res.nodesAdmitted, 3);
    assert.strictEqual(res.depthReached, 3, "a, b, c sit at 1, 2, 3");
  })();
});

test("V4 [VERIFIED] the walk mutates nothing it was handed", () => {
  return (async () => {
    const target = node("target");
    const frozenTarget = JSON.stringify(target);
    const callerList = Object.freeze([node("a"), node("b")]);
    const res = await run({
      resolveCallers: async (n) => (n.name === "target" ? callerList : []),
    });
    assert.strictEqual(JSON.stringify(target), frozenTarget, "the target came back untouched");
    assert.strictEqual(callerList.length, 2, "the transport's array came back untouched");
    assert.strictEqual(res.nodesAdmitted, 2);
  })();
});

test("V5 [VERIFIED] no clock is read without a hang guard, on the REJECT and CANCEL branches too", () => {
  return (async () => {
    const now = () => {
      throw new Error("the walk read a clock it had no guard for");
    };
    const rejecting = await run({ now, resolveCallers: async () => { throw new Error("no"); } });
    assert.strictEqual(rejecting.failedRequests, 1);

    const signal = { aborted: false };
    const cancelled = await run({
      now,
      signal,
      resolveCallers: async () => {
        signal.aborted = true;
        return [node("a")];
      },
    });
    assert.strictEqual(cancelled.stoppedBy, "cancelled");

    const entryAborted = await run({ now, signal: { aborted: true }, resolveCallers: async () => [] });
    assert.strictEqual(entryAborted.requests, 0);
  })();
});

test("V6 [VERIFIED] a self-recursive target is never its own result", () => {
  return (async () => {
    const target = node("target");
    const res = await run({
      classify: () => "test",
      resolveCallers: async (n) => (n.name === "target" ? [node("target"), node("t")] : []),
    });
    assert.deepStrictEqual(res.tests.map((t) => t.node.name), ["t"]);
    assert.strictEqual(res.nodesAdmitted, 1, "the target is not counted as an admitted node");
    assert.strictEqual(target.name, "target");
  })();
});

test("V7 [VERIFIED] the doc-comment trap: the attribute BELOW range.start is still seen, both languages", () => {
  const rust = ["/// Round-trips a CA.", "///", "/// Documented.", "#[test]", "fn ca_round_trips() {"];
  assert.strictEqual(classify("rust", rust, "ca_round_trips", 0, 4, "/r/ca.rs"), "test");
  const cs = ["/// <summary>Reads.</summary>", "[Fact]", "public void Reads()"];
  assert.strictEqual(classify("csharp", cs, "T.Reads()", 0, 2, "/r/T.cs"), "test");
  // and a commented-out attribute is not one
  assert.strictEqual(classify("rust", ["// #[test] removed", "fn helper() {"], "helper", 0, 1, "/r/a.rs"), "plain");
});
