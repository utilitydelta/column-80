// Implementer oracle for session-v60 phase B2's PER-FRAMEWORK failure hooks:
// one LocationExtractor and one FrameStripper for each of the nine runners this
// product supports, wired onto the TestFramework seam.
//
// EVERY happy path here runs on REAL captured runner output, and the location it
// asserts is the location the real runner reported:
//
//   gotest    test/fixtures/gotest/fail.json + fail-verbose.txt   go 1.26.5
//   pytest    test/fixtures/pytest/fail-junit.xml                 pytest 9.1.0
//   unittest  test/fixtures/unittest/fail.txt                     python 3.12.3
//   mstest    test/fixtures/csharp-trx/fail.trx                   already committed
//   xunit     test/fixtures/csharp-trx/xunit-fail.trx             xunit 2.9.3
//   nunit     test/fixtures/csharp-trx/nunit-fail.trx             NUnit 4.6.0
//   vitest    test/fixtures/vitest/fail.json                      vitest 4.1.10
//   jest      test/fixtures/jest/fail.json                        jest 29.x
//   libtest   test/fixtures/rustc/assertion-panic.txt             already committed
//
// The message an extractor is handed is NOT the raw report: it is whatever that
// runner's shipped parseOutput put into `TestFailureDetail.message`. So each
// happy path parses the fixture with the SHIPPED parser first and reads the
// hooks off that, which is how the pytest and C# shapes below were found to
// differ from what the raw report looks like.
//
// Run: SKIP_LIVE=1 node --test test/impl-v60-framework-hooks.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-v60-framework-hooks",
  `export { goTestFailureLocation, goTestStripHarnessFrames, parseGoTestOutput } from "../src/core/tddGo";
export { pytestFailureLocation, pytestStripHarnessFrames, unittestFailureLocation, unittestStripHarnessFrames, parsePytestJunitXml, parseUnittestOutput } from "../src/core/tddPy";
export { trxFailureLocation, trxStripHarnessFrames, parseTrx } from "../src/core/tddCs";
export { nodeStackFailureLocation, nodeStackStripHarnessFrames, parseVitestJson, parseJestJson } from "../src/core/tddTs";
export { libtestFailureLocation, libtestStripHarnessFrames, parseLibtestOutput } from "../src/core/compilerOracle";
export { digestFailures } from "../src/core/failureDigest";
export { tddLangFor, tddLanguageIds } from "../src/core/tddLang";\n`
);
test.after(cleanup);

const {
  goTestFailureLocation,
  goTestStripHarnessFrames,
  parseGoTestOutput,
  pytestFailureLocation,
  pytestStripHarnessFrames,
  unittestFailureLocation,
  unittestStripHarnessFrames,
  parsePytestJunitXml,
  parseUnittestOutput,
  trxFailureLocation,
  trxStripHarnessFrames,
  parseTrx,
  nodeStackFailureLocation,
  nodeStackStripHarnessFrames,
  parseVitestJson,
  parseJestJson,
  libtestFailureLocation,
  libtestStripHarnessFrames,
  parseLibtestOutput,
  digestFailures,
  tddLangFor,
  tddLanguageIds,
} = mod;

const fixture = (rel) => fs.readFileSync(path.join(__dirname, "fixtures", rel), "utf8");
/** The failure the shipped parser produced for `name`, by name. */
const failureNamed = (parse, name) => {
  const found = parse.failures.find((f) => f.name === name);
  assert.ok(found !== undefined, `no failure named ${name}; got ${parse.failures.map((f) => f.name).join(", ")}`);
  return found.message;
};

// ===========================================================================
// gotest
// ===========================================================================

test("gotest: the location is the file:line go indents under the failing test", () => {
  const parse = parseGoTestOutput(fixture("gotest/fail.json"), "", 1);
  assert.deepStrictEqual(goTestFailureLocation(failureNamed(parse, "TestAdd")), {
    filePath: "widget_test.go",
    line: 8,
  });
  // A SUBTEST is its own case in `-json`, and its own location.
  assert.deepStrictEqual(goTestFailureLocation(failureNamed(parse, "TestAddSub/negatives")), {
    filePath: "widget_test.go",
    line: 15,
  });
  // go reports no column, so the field must be ABSENT rather than guessed.
  assert.strictEqual("column" in goTestFailureLocation(failureNamed(parse, "TestAdd")), false);
});

test("gotest: declines rather than guessing", () => {
  // Nothing location-shaped at all.
  assert.strictEqual(goTestFailureLocation(""), undefined);
  assert.strictEqual(goTestFailureLocation("    assertion failed: want 5, got -1"), undefined);
  // LOCATION-SHAPED BUT NOT A LOCATION. A `host:port:` and a bare line number
  // both carry the digits-between-colons shape and neither names a Go file.
  assert.strictEqual(goTestFailureLocation("    dial tcp 127.0.0.1:8080: connection refused"), undefined);
  assert.strictEqual(goTestFailureLocation("    config.yaml:12: unexpected key"), undefined);
  // Unindented: go indents every one of these lines, so a flush-left match is
  // something the code under test PRINTED, not something go reported.
  assert.strictEqual(goTestFailureLocation("widget_test.go:8: forged by the test"), undefined);
});

test("gotest: the stripper drops go's own verdict and RUN framing", () => {
  const stripped = goTestStripHarnessFrames(fixture("gotest/fail-verbose.txt"));
  assert.ok(!/--- FAIL/.test(stripped), stripped);
  assert.ok(!/=== RUN/.test(stripped), stripped);
  // What the test itself said survives, byte for byte.
  assert.ok(stripped.includes("    widget_test.go:8: Add(2, 3) = -1, want 5"), stripped);
  assert.ok(stripped.includes("    widget_test.go:15: Add(-1, -1) = 0, want -2"), stripped);
});

test("gotest: digestFailures round trip over the real report", () => {
  const parse = parseGoTestOutput(fixture("gotest/fail.json"), "", 1);
  const shapes = digestFailures(parse.failures, {
    strip: goTestStripHarnessFrames,
    locate: goTestFailureLocation,
  });
  // Three failures, three distinct messages (the parent subtest's is empty).
  assert.strictEqual(shapes.length, 3);
  const withLine8 = shapes.find((s) => s.location !== undefined && s.location.line === 8);
  assert.deepStrictEqual(withLine8.location, { filePath: "widget_test.go", line: 8 });
  assert.strictEqual(withLine8.count, 1);
});

// ===========================================================================
// pytest
// ===========================================================================

test("pytest: the INNERMOST frame wins, and it is product code", () => {
  const parse = parsePytestJunitXml(fixture("pytest/fail-junit.xml"), "", 1);
  // A plain rewritten assert: one frame, in the test file.
  assert.deepStrictEqual(pytestFailureLocation(failureNamed(parse, "test_add")), {
    filePath: "test_widget.py",
    line: 7,
  });
  // An exception raised THROUGH the test into product code: the last frame is
  // widget.py, which is where the failure actually surfaced.
  assert.deepStrictEqual(pytestFailureLocation(failureNamed(parse, "test_boom")), {
    filePath: "widget.py",
    line: 2,
  });
  // A fixture that raised in setup: still a location, still the human's code.
  assert.deepStrictEqual(pytestFailureLocation(failureNamed(parse, "test_uses")), {
    filePath: "test_fix.py",
    line: 6,
  });
});

test("pytest: an innermost frame inside _pytest is NOT the location", () => {
  const parse = parsePytestJunitXml(fixture("pytest/fail-junit.xml"), "", 1);
  const message = failureNamed(parse, "test_raises_bad");
  // The real capture's LAST frame is `_pytest/raises.py:454`. Naming it would
  // point the model at pytest's own source; the innermost frame that is not
  // pytest's is the test file.
  assert.ok(message.includes("_pytest/raises.py:454"), message);
  assert.deepStrictEqual(pytestFailureLocation(message), { filePath: "test_int2.py", line: 5 });
});

test("pytest: declines rather than guessing", () => {
  assert.strictEqual(pytestFailureLocation(""), undefined);
  assert.strictEqual(pytestFailureLocation("AssertionError: -1 != 5"), undefined);
  // LOCATION-SHAPED BUT NOT A LOCATION: a path and a number inside the failure
  // TEXT, which is indented under an `E` marker and is not a frame line.
  assert.strictEqual(pytestFailureLocation("E       assert 'settings.py:80' == 'settings.py:81'"), undefined);
  assert.strictEqual(pytestFailureLocation("collected 3 items / 1 error in 0.12s"), undefined);
});

test("pytest: the stripper drops _pytest's own frames and keeps the rest", () => {
  const parse = parsePytestJunitXml(fixture("pytest/fail-junit.xml"), "", 1);
  const stripped = pytestStripHarnessFrames(failureNamed(parse, "test_raises_bad"));
  assert.ok(!/_pytest\//.test(stripped), stripped);
  assert.ok(stripped.includes("test_int2.py:5:"), stripped);
  assert.ok(stripped.includes("TypeError: Expected a BaseException type, but got 'str'"), stripped);
  // A message with no pytest frames at all comes back unchanged.
  const plain = failureNamed(parse, "test_add");
  assert.strictEqual(pytestStripHarnessFrames(plain), plain);
});

test("pytest: digestFailures round trip over the real report", () => {
  const parse = parsePytestJunitXml(fixture("pytest/fail-junit.xml"), "", 1);
  const shapes = digestFailures(parse.failures, {
    strip: pytestStripHarnessFrames,
    locate: pytestFailureLocation,
  });
  assert.strictEqual(shapes.length, 4);
  const boom = shapes.find((s) => s.representative.includes("unsupported operand type"));
  assert.deepStrictEqual(boom.location, { filePath: "widget.py", line: 2 });
});

// ===========================================================================
// unittest
// ===========================================================================

test("unittest: the LAST traceback frame wins", () => {
  const parse = parseUnittestOutput("", fixture("unittest/fail.txt"), 1);
  assert.deepStrictEqual(unittestFailureLocation(failureNamed(parse, "test_add_method")), {
    filePath: "/repo/test_widget.py",
    line: 16,
  });
  assert.deepStrictEqual(unittestFailureLocation(failureNamed(parse, "test_raises")), {
    filePath: "/repo/test_widget.py",
    line: 19,
  });
});

test("unittest: a unittest/case.py frame is not the location", () => {
  const parse = parseUnittestOutput("", fixture("unittest/fail.txt"), 1);
  const message = failureNamed(parse, "test_odd");
  assert.ok(message.includes("unittest/case.py"), message);
  // The traceback goes test -> case.py -> case.py -> the human's __eq__. The
  // innermost frame that is not the stdlib harness is the one to name.
  assert.deepStrictEqual(unittestFailureLocation(message), { filePath: "/repo/test_deep.py", line: 6 });
});

test("unittest: declines rather than guessing", () => {
  assert.strictEqual(unittestFailureLocation(""), undefined);
  assert.strictEqual(unittestFailureLocation("AssertionError: TypeError not raised"), undefined);
  // LOCATION-SHAPED BUT NOT A LOCATION: the words are there and the shape is not.
  assert.strictEqual(unittestFailureLocation('AssertionError: File "a.py" was read at line four'), undefined);
  assert.strictEqual(unittestFailureLocation('  File "/repo/x.py", line ???, in f'), undefined);
});

test("unittest: the stripper drops case.py frames and keeps the rest", () => {
  const parse = parseUnittestOutput("", fixture("unittest/fail.txt"), 1);
  const stripped = unittestStripHarnessFrames(failureNamed(parse, "test_odd"));
  assert.ok(!/unittest\/case\.py/.test(stripped), stripped);
  // Both of the human's OWN frames survive, with their source lines.
  assert.ok(stripped.includes('File "/repo/test_deep.py", line 11, in test_odd'), stripped);
  assert.ok(stripped.includes('File "/repo/test_deep.py", line 6, in __eq__'), stripped);
  assert.ok(stripped.includes('raise RuntimeError("comparison exploded")'), stripped);
  assert.ok(stripped.includes("RuntimeError: comparison exploded"), stripped);
});

test("unittest: digestFailures round trip over the real report", () => {
  const parse = parseUnittestOutput("", fixture("unittest/fail.txt"), 1);
  const shapes = digestFailures(parse.failures, {
    strip: unittestStripHarnessFrames,
    locate: unittestFailureLocation,
  });
  assert.strictEqual(shapes.length, 3);
  const raised = shapes.find((s) => s.representative.includes("comparison exploded"));
  assert.deepStrictEqual(raised.location, { filePath: "/repo/test_deep.py", line: 6 });
});

// ===========================================================================
// mstest / xunit / nunit, all three through the TRX parse
// ===========================================================================

test("trx: the FIRST non-framework frame wins, on all three adapters", () => {
  // MSTest. The first frame is PRODUCT code, one level under the test.
  const mstest = parseTrx(fixture("csharp-trx/fail.trx"), "", 1);
  assert.deepStrictEqual(trxFailureLocation(mstest.failures[0].message), {
    filePath: "/home/utilitydelta/work/contoso/data-processing/dotnet/Contoso.DataModel/SiteValidation.cs",
    line: 30,
  });
  // xunit.
  const xunit = parseTrx(fixture("csharp-trx/xunit-fail.trx"), "", 1);
  assert.deepStrictEqual(trxFailureLocation(failureNamed(xunit, "Widget.Tests.CalcTests.Add_TwoAndThree_IsFive")), {
    filePath: "/repo/WidgetTests.cs",
    line: 10,
  });
  // NUnit, whose stack repeats the frame under a `1)` marker.
  const nunit = parseTrx(fixture("csharp-trx/nunit-fail.trx"), "", 1);
  assert.deepStrictEqual(trxFailureLocation(failureNamed(nunit, "Add_Throws_WhenAsked")), {
    filePath: "/repo/WidgetTests.cs",
    line: 16,
  });
});

test("trx: a framework frame is skipped even when it carries a location", () => {
  // CONSTRUCTED, and said so: none of the three real captures put a located
  // Xunit/NUnit/VisualStudio frame in the trace, so the rule the contract names
  // has no real witness on this box. The shape is a real one though - a
  // framework built with its PDBs beside it produces exactly this - and naming
  // xunit's own Assert.cs would be the wrong-location failure the rule exists
  // to stop.
  const message = [
    "Assert.Equal() Failure: Values differ",
    "   at Xunit.Assert.Equal[T](T expected, T actual) in /repo/xunit/Assert.cs:line 12",
    "   at NUnit.Framework.Assert.That(Object actual) in /repo/nunit/Assert.cs:line 8",
    "   at Microsoft.VisualStudio.TestTools.UnitTesting.Assert.AreEqual[T](T a, T b) in /repo/mstest/Assert.cs:line 4",
    "   at Widget.Tests.CalcTests.Add_TwoAndThree_IsFive() in /repo/WidgetTests.cs:line 10",
  ].join("\n");
  assert.deepStrictEqual(trxFailureLocation(message), { filePath: "/repo/WidgetTests.cs", line: 10 });
});

test("trx: declines rather than guessing", () => {
  assert.strictEqual(trxFailureLocation(""), undefined);
  assert.strictEqual(trxFailureLocation("System.ArgumentException: Invalid timezone ID: Eastern Standard Time"), undefined);
  // LOCATION-SHAPED BUT NOT A LOCATION: `:line` is the marker, and prose that
  // merely mentions a file and a number is not a frame.
  assert.strictEqual(trxFailureLocation("Expected SiteValidation.cs:30 to have been called"), undefined);
  // A non-English test host spells `line` in its own language; declining beats
  // reading the wrong number out of a shape that only looks familiar.
  assert.strictEqual(trxFailureLocation("   at Widget.Calc.Add(Int32 a) in /repo/Calc.cs:Zeile 30"), undefined);
});

test("trx: the stripper drops framework frames and keeps the message", () => {
  const message = [
    "Assert.Equal() Failure: Values differ",
    "Expected: 5",
    "   at Xunit.Assert.Equal[T](T expected, T actual)",
    "   at NUnit.Framework.Assert.That(Object actual)",
    "   at Microsoft.VisualStudio.TestTools.UnitTesting.Assert.AreEqual[T](T a, T b)",
    "   at Widget.Tests.CalcTests.Add_TwoAndThree_IsFive() in /repo/WidgetTests.cs:line 10",
  ].join("\n");
  const stripped = trxStripHarnessFrames(message);
  assert.ok(!/Xunit\.|NUnit\.|Microsoft\.VisualStudio\.TestTools/.test(stripped), stripped);
  assert.ok(stripped.includes("Assert.Equal() Failure: Values differ"), stripped);
  assert.ok(stripped.includes("Widget.Tests.CalcTests.Add_TwoAndThree_IsFive"), stripped);
  // The real xunit capture has no framework frames, so it survives whole.
  const xunit = parseTrx(fixture("csharp-trx/xunit-fail.trx"), "", 1);
  const real = failureNamed(xunit, "Widget.Tests.CalcTests.Add_TwoAndThree_IsFive");
  assert.strictEqual(trxStripHarnessFrames(real), real);
});

test("trx: digestFailures round trip over the real reports", () => {
  for (const [file, count] of [["csharp-trx/fail.trx", 1], ["csharp-trx/xunit-fail.trx", 2], ["csharp-trx/nunit-fail.trx", 2]]) {
    const parse = parseTrx(fixture(file), "", 1);
    const shapes = digestFailures(parse.failures, { strip: trxStripHarnessFrames, locate: trxFailureLocation });
    // Every failure in these captures says something different, so a shape each.
    assert.strictEqual(shapes.length, count, file);
    assert.ok(shapes.every((s) => s.location !== undefined), file);
  }
  const xunit = parseTrx(fixture("csharp-trx/xunit-fail.trx"), "", 1);
  const shapes = digestFailures(xunit.failures, { strip: trxStripHarnessFrames, locate: trxFailureLocation });
  assert.deepStrictEqual(shapes[0].location, { filePath: "/repo/WidgetTests.cs", line: 10 });
});

// ===========================================================================
// vitest / jest, which share a stack format and so share one pair
// ===========================================================================

test("vitest: the first frame outside node_modules wins, with its column", () => {
  const parse = parseVitestJson(fixture("vitest/fail.json"), "", 1);
  assert.deepStrictEqual(nodeStackFailureLocation(parse.failures[0].message), {
    filePath: "/repo/widget.test.js",
    line: 6,
    column: 23,
  });
});

test("jest: the first frame outside node_modules wins, with its column", () => {
  const parse = parseJestJson(fixture("jest/fail.json"), "", 1);
  assert.deepStrictEqual(nodeStackFailureLocation(parse.failures[0].message), {
    filePath: "/repo/widget.test.js",
    line: 5,
    column: 23,
  });
});

test("node stacks: declines rather than guessing", () => {
  assert.strictEqual(nodeStackFailureLocation(""), undefined);
  assert.strictEqual(nodeStackFailureLocation("AssertionError: expected -1 to be 5"), undefined);
  // LOCATION-SHAPED BUT NOT A LOCATION: a host and a port carry the same
  // colon-digit-colon shape a frame does.
  assert.strictEqual(nodeStackFailureLocation("Error: connect ECONNREFUSED 127.0.0.1:5432"), undefined);
  assert.strictEqual(nodeStackFailureLocation("    at new Promise (<anonymous>)"), undefined);
  // A node RUNTIME internal is not the code under test either.
  assert.strictEqual(
    nodeStackFailureLocation("    at processTicksAndRejections (node:internal/process/task_queues:103:5)"),
    undefined
  );
  // A stack that is ALL node_modules names nothing, from the real capture.
  const parse = parseVitestJson(fixture("vitest/fail.json"), "", 1);
  const onlyHarness = parse.failures[0].message
    .split("\n")
    .filter((l) => !l.includes("/repo/widget.test.js"))
    .join("\n");
  assert.ok(onlyHarness.includes("node_modules"), onlyHarness);
  assert.strictEqual(nodeStackFailureLocation(onlyHarness), undefined);
});

test("node stacks: the stripper drops every node_modules frame", () => {
  for (const [file, parseFn] of [["vitest/fail.json", parseVitestJson], ["jest/fail.json", parseJestJson]]) {
    const parse = parseFn(fixture(file), "", 1);
    const stripped = nodeStackStripHarnessFrames(parse.failures[0].message);
    assert.ok(!/node_modules/.test(stripped), stripped);
    assert.ok(stripped.includes("/repo/widget.test.js"), stripped);
    // The assertion text itself, which is the whole point of keeping anything.
    assert.ok(/Object\.is equality/.test(stripped), stripped);
  }
});

test("node stacks: digestFailures round trip over the real reports", () => {
  const vitest = parseVitestJson(fixture("vitest/fail.json"), "", 1);
  const shapes = digestFailures(vitest.failures, {
    strip: nodeStackStripHarnessFrames,
    locate: nodeStackFailureLocation,
  });
  assert.strictEqual(shapes.length, 1);
  assert.strictEqual(shapes[0].count, 1);
  assert.deepStrictEqual(shapes[0].location, { filePath: "/repo/widget.test.js", line: 6, column: 23 });
  assert.ok(!/node_modules/.test(shapes[0].representative), shapes[0].representative);
});

// ===========================================================================
// libtest, already written in compilerOracle.ts, wired here
// ===========================================================================

test("libtest: digestFailures round trip over the committed capture", () => {
  const parse = parseLibtestOutput(fixture("rustc/assertion-panic.txt"));
  const shapes = digestFailures(parse.failures, {
    strip: libtestStripHarnessFrames,
    locate: libtestFailureLocation,
  });
  assert.ok(shapes.length > 0);
  // The loudest shape is the deduped `not implemented`, reached from two
  // product lines, so it is PLACED without claiming a single one.
  const notImplemented = shapes.find((s) => s.representative.includes("not implemented"));
  assert.strictEqual(notImplemented.count, 5);
  assert.strictEqual(notImplemented.location, undefined);
  assert.deepStrictEqual(notImplemented.locations, [
    { filePath: "src/task10.rs", line: 6, column: 63 },
    { filePath: "src/task15.rs", line: 8, column: 41 },
  ]);
});

// ===========================================================================
// The seam
// ===========================================================================

test("every framework the seam registers carries both hooks", () => {
  const seen = new Map();
  for (const id of tddLanguageIds()) {
    for (const framework of tddLangFor(id).frameworks) {
      seen.set(framework.id, framework);
    }
  }
  assert.deepStrictEqual(
    [...seen.keys()].sort(),
    ["gotest", "jest", "libtest", "mstest", "nunit", "pytest", "unittest", "vitest", "xunit"]
  );
  for (const [id, framework] of seen) {
    assert.strictEqual(typeof framework.failureLocation, "function", `${id} failureLocation`);
    assert.strictEqual(typeof framework.stripHarnessFrames, "function", `${id} stripHarnessFrames`);
  }
  // And they are THIS runner's pair, not a neighbour's.
  assert.strictEqual(seen.get("libtest").failureLocation, libtestFailureLocation);
  assert.strictEqual(seen.get("libtest").stripHarnessFrames, libtestStripHarnessFrames);
  assert.strictEqual(seen.get("gotest").failureLocation, goTestFailureLocation);
  assert.strictEqual(seen.get("pytest").failureLocation, pytestFailureLocation);
  assert.strictEqual(seen.get("unittest").failureLocation, unittestFailureLocation);
  assert.strictEqual(seen.get("mstest").failureLocation, trxFailureLocation);
  assert.strictEqual(seen.get("xunit").failureLocation, trxFailureLocation);
  assert.strictEqual(seen.get("nunit").failureLocation, trxFailureLocation);
  assert.strictEqual(seen.get("vitest").failureLocation, nodeStackFailureLocation);
  assert.strictEqual(seen.get("jest").failureLocation, nodeStackFailureLocation);
});

// ===========================================================================
// Totality: never throws, whatever arrives
// ===========================================================================

test("no hook throws, for any input", () => {
  const pairs = [
    ["gotest", goTestFailureLocation, goTestStripHarnessFrames],
    ["pytest", pytestFailureLocation, pytestStripHarnessFrames],
    ["unittest", unittestFailureLocation, unittestStripHarnessFrames],
    ["trx", trxFailureLocation, trxStripHarnessFrames],
    ["node", nodeStackFailureLocation, nodeStackStripHarnessFrames],
    ["libtest", libtestFailureLocation, libtestStripHarnessFrames],
  ];
  // A 100KB message is not hypothetical: a failing deep-equal on a large
  // structure prints the whole structure, and a hook that backtracks
  // catastrophically over it would hang the repair round rather than fail it.
  const huge = `${"x".repeat(50_000)}\n${"    at /repo/a.js:1:1\n".repeat(2000)}`;
  const inputs = [
    "",
    "   ",
    "\n\n\t\n",
    "\r\n",
    "line one\r\n    at /repo/a.js:1:1\r\n--- FAIL: TestX (0.00s)\r\n",
    'Traceback (most recent call last):\r\n  File "/repo/a.py", line 3, in f\r\nBoom\r\n',
    huge,
  ];
  for (const [id, locate, strip] of pairs) {
    for (const input of inputs) {
      const started = Date.now();
      const loc = locate(input);
      assert.ok(loc === undefined || (typeof loc.filePath === "string" && Number.isInteger(loc.line)), id);
      assert.strictEqual(typeof strip(input), "string", id);
      assert.ok(Date.now() - started < 2000, `${id} took too long on a ${input.length}-char message`);
    }
  }
});

test("CRLF output is read the same as LF output", () => {
  const parse = parseUnittestOutput("", fixture("unittest/fail.txt"), 1);
  const message = failureNamed(parse, "test_add_method");
  const crlf = message.replace(/\n/g, "\r\n");
  assert.deepStrictEqual(unittestFailureLocation(crlf), unittestFailureLocation(message));
  const go = "    widget_test.go:8: Add(2, 3) = -1, want 5\r\n--- FAIL: TestAdd (0.00s)\r\n";
  assert.deepStrictEqual(goTestFailureLocation(go), { filePath: "widget_test.go", line: 8 });
  assert.ok(!/--- FAIL/.test(goTestStripHarnessFrames(go)));
});
