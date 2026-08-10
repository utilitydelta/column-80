// Implementer tests for session-v31 phase 4: the Python leg (src/core/tddPy.ts),
// written alongside the implementation and sitting under the blind oracle
// blind-v31-py.
//
// What these pin that the contract alone does not:
//   - THE FORGERY, first and hardest, and it is not theoretical. Every XML
//     fixture below was captured from pytest 9.0.2 on this machine, including
//     the one where the code under test PRINTS a complete fake `<testsuite
//     tests="99">` and a fake count line. Section 7 runs that test for real and
//     proves the count the parser reports comes from the FILE, not from stdout;
//   - THE EXIT-4 COLLISION, third language running: a filter miss and a
//     collection error are both exit 4, both "no tests ran", and only the
//     `errors` attribute separates them. Get it backwards and a human whose
//     import does not resolve is told their filter matched nothing;
//   - the IMPORT PROOF. A src-layout package that is not installed makes a
//     guessed import a collection error the human cannot act on, so placement
//     asks the interpreter first, and a probe that cannot answer must NOT be
//     read as an answer;
//   - `//` IS FLOOR DIVISION. The shared scanner reads it as a comment for four
//     languages, and reading `assert halve(7) == 7 // 2` that way truncates the
//     expected-value span and leaves the model's `// 2` behind;
//   - `not-exported` NEVER firing, with `_is_port_available`, a real corpus
//     survivor, as the witness;
//   - and that Rust, Go and TypeScript do not move, because this phase widened
//     the shared literal scanner all three read through.
//
// Run: SKIP_LIVE=1 node --test test/impl-v31-py.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");
const esbuild = require("esbuild");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-v31-py",
  `export { tddLangFor, frameworkFor, REAL_TDD_DEPS } from "../src/core/tddLang";\n` +
    `export { PY_TDD_LANG, PYTEST, UNITTEST, pyReturnTypeOf, classifyPyTestability, pyRenderBlankValue, pytestExpectedValueSpans, unittestExpectedValueSpans, parsePytestJunitXml, parseUnittestOutput, pytestJunitPath } from "../src/core/tddPy";\n` +
    `export { goExpectedValueSpans } from "../src/core/tddGo";\n` +
    `export { tsExpectedValueSpans } from "../src/core/tddTs";\n` +
    `export { rustExpectedValueSpans, skipLiteralOrComment, blankTestModule } from "../src/core/testAssembly";\n`
);
const {
  tddLangFor,
  frameworkFor,
  pyReturnTypeOf,
  classifyPyTestability,
  pyRenderBlankValue,
  pytestExpectedValueSpans,
  unittestExpectedValueSpans,
  parsePytestJunitXml,
  parseUnittestOutput,
  pytestJunitPath,
  goExpectedValueSpans,
  tsExpectedValueSpans,
  rustExpectedValueSpans,
  blankTestModule,
} = mod;

const REPO = path.resolve(__dirname, "..");
const CORPUS = path.join(os.homedir(), "work", "utilitydelta", "mcp-graph-engine");
const CORPUS_PY = path.join(CORPUS, ".venv", "bin", "python");
const corpusPython = fs.existsSync(CORPUS_PY) ? CORPUS_PY : undefined;
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "impl-v31-py-"));
test.after(() => {
  cleanup();
  fs.rmSync(scratch, { recursive: true, force: true });
});

const py = () => tddLangFor("python");
const pytest = () => py().frameworks[0];
const unittest = () => py().frameworks[1];

// A project at /p: pyproject.toml declaring pytest and testpaths, a venv holding
// the pytest console script, and the module under test at /p/src/pkg/foo.py.
const PYPROJECT = [
  "[tool.pytest.ini_options]",
  'testpaths = ["tests"]',
  "",
  "[tool.setuptools.packages.find]",
  'where = ["src"]',
  "",
].join("\n");

function deps(files, contents = {}, extra = {}) {
  const set = new Set(files.map((f) => path.normalize(f)));
  return {
    fileExists: (p) => set.has(path.normalize(p)),
    readFile: (p) => contents[path.normalize(p)],
    readDir: () => undefined,
    // No probe is ever spawned in a unit row: the fake answers 0 (resolves)
    // unless a row overrides it. A test must never need a real interpreter.
    probe: () => ({ exitCode: 0 }),
    ...extra,
  };
}

const PROJECT_FILES = ["/p/pyproject.toml", "/p/.venv/bin/python", "/p/.venv/bin/pytest", "/p/src/pkg/foo.py", "/p/tests"];
const projectDeps = (extra = {}, files = [], contents = {}) =>
  deps([...PROJECT_FILES, ...files], { "/p/pyproject.toml": PYPROJECT, ...contents }, extra);

const spans = (text) => pytestExpectedValueSpans(text).map((s) => text.slice(s.start, s.end));
const okPlacement = (r) => {
  assert.ok(r.ok, `expected a placement, got refusal ${JSON.stringify(r.refusal)}`);
  return r.placement;
};

// ===========================================================================
// 1. The registry
// ===========================================================================

test("python resolves, with `#` markers and pytest ahead of unittest", () => {
  const lang = py();
  assert.ok(lang, "phase 4 registers python");
  assert.equal(lang.languageId, "python");
  assert.equal(lang.displayName, "Python");
  assert.equal(lang.markerPrefix, "#", "the only leg that is not //");
  assert.deepEqual(lang.frameworks.map((f) => f.id), ["pytest", "unittest"]);
  // The other legs must not have moved. C# was undefined here until phase 5;
  // that row FLIPPED when the C# leg registered, deliberately and by its own
  // stated design, rather than being discovered as a mystery red.
  assert.equal(tddLangFor("rust").languageId, "rust");
  assert.equal(tddLangFor("go").languageId, "go");
  assert.equal(tddLangFor("typescript").languageId, "typescript");
  assert.equal(tddLangFor("csharp").languageId, "csharp");
});

test("unittest always detects, so Python can never be honest-dark about frameworks", () => {
  const empty = deps([]);
  assert.equal(unittest().detect("/nowhere", empty), true);
  const chosen = frameworkFor(py(), "/nowhere", empty);
  assert.ok(chosen.ok, "Python always has SOME rung, exactly like Go");
  assert.equal(chosen.framework.id, "unittest", "no pytest evidence anywhere -> unittest");
});

test("pytest detection ASKS the interpreter, and falls back to offline evidence only when it cannot", () => {
  const asked = [];
  const probe = (command, args) => {
    asked.push([command, ...args].join(" "));
    return { exitCode: 0 };
  };
  assert.equal(pytest().detect("/p", projectDeps({ probe })), true);
  assert.deepEqual(asked, ["/p/.venv/bin/python -B -c import pytest"], "the project's own interpreter, with -B so it writes no bytecode");

  // A definite NO from the interpreter beats a pyproject section: a declared but
  // absent runner cannot spawn, which is what the TypeScript leg measured.
  assert.equal(pytest().detect("/p", projectDeps({ probe: () => ({ exitCode: 1 }) })), false);
  // The probe could not run at all -> the filesystem answers.
  assert.equal(pytest().detect("/p", projectDeps({ probe: () => undefined })), true);
  // No venv beside the root -> no interpreter to ask, and configuration answers.
  const noVenv = deps(["/q/pyproject.toml"], { "/q/pyproject.toml": PYPROJECT }, { probe: () => ({ exitCode: 0 }) });
  assert.equal(pytest().detect("/q", noVenv), true, "[tool.pytest.ini_options] is a project saying it tests with pytest");
  assert.equal(pytest().detect("/q", deps(["/q/pyproject.toml"], { "/q/pyproject.toml": "[project]\nname='x'\n" })), false);
});

// ===========================================================================
// 2. returnTypeOf, and the colon the shipped Rust regex swallows
// ===========================================================================

test("returnTypeOf: the contract's table, colon included", () => {
  const cases = [
    ["def f(a: int) -> str:", "str"],
    ["def f(a: int) -> list[int]:", "list[int]"],
    ["def f(a: int):", undefined],
    ["def f(a: int) -> None:", undefined],
    ["def f(a: dict[str, int]) -> bool:", "bool"],
    ["def f(a: Callable[[int], int]) -> str:", "str"],
    ["async def f() -> Awaitable[int]:", "Awaitable[int]"],
    ["def f() -> tuple[str, list[str]]:", "tuple[str, list[str]]"],
    ["def f[T](a: T) -> T:", "T"],
    ["def f(a: int = 3, *args, **kw) -> int:", "int"],
    ["def f(a: str) -> dict[str, Any]", "dict[str, Any]"],
    ["def f(", undefined],
    ["", undefined],
  ];
  for (const [sig, want] of cases) {
    assert.equal(pyReturnTypeOf(sig), want, `returnTypeOf(${JSON.stringify(sig)})`);
  }
});

test("returnTypeOf: the shipped Rust regex is WRONG here, which is why this leg has its own", () => {
  // The bug, spelled out: `->\s*([\s\S]+?)\s*(?:\bwhere\b|\{|$)` has nothing to
  // stop at in Python, so it takes the colon with it.
  const rust = /->\s*([\s\S]+?)\s*(?:\bwhere\b|\{|$)/.exec("def f() -> str:")[1];
  assert.equal(rust, "str:", "the shipped Rust extractor really does swallow the colon");
  assert.equal(pyReturnTypeOf("def f() -> str:"), "str");
  // And the two shapes a regex cannot fix by tightening: a parameter carrying its
  // own `->`, and one carrying its own `:`.
  assert.equal(pyReturnTypeOf("def f(cb: Callable[[int], int]) -> str:"), "str");
  assert.equal(pyReturnTypeOf("def f(d: dict[str, int]) -> bool:"), "bool");
});

// ===========================================================================
// 3. Testability
// ===========================================================================

test("classify: fixed precedence, async -> io -> needs-fixture -> underspecified", () => {
  const doc = "does a thing";
  const rows = [
    ["async def f(self, p: Path) -> int:", "async", "async beats every other leg"],
    ["def f(p: Path) -> int:", "io"],
    ["def f(self, a: int) -> int:", "needs-fixture"],
    ["def f(cls, a: int) -> int:", "needs-fixture"],
    ["def f(a: int):", "underspecified", "no return annotation"],
    ["def f(a: int) -> None:", "underspecified"],
    ["async def f() -> int:", "async"],
    ["def f() -> Awaitable[int]:", "async"],
    ["def f() -> Coroutine[Any, Any, int]:", "async"],
    ["def f(s: socket) -> bool:", "io"],
    ["def f(x: str = open('a').read()) -> str:", "io"],
  ];
  for (const [sig, reason, why] of rows) {
    const v = classifyPyTestability(sig, doc);
    assert.equal(v.testable, false, `${sig} must refuse`);
    assert.equal(v.reason, reason, `${sig}${why ? ` (${why})` : ""}`);
    assert.ok(v.detail.length > 0, "a refusal must say why");
  }
  assert.deepEqual(classifyPyTestability("def f(a: int) -> int:", doc), { testable: true });
});

test("classify: `not-exported` NEVER fires - Python has no privacy, and a survivor proves it", () => {
  const doc = "checks a port";
  const v = classifyPyTestability("def _is_port_available(host: str, port: int) -> bool:", doc);
  assert.deepEqual(v, { testable: true }, "a leading underscore is convention, not a barrier to an importer");
  for (const sig of ["def __private(a: int) -> int:", "def _x(a: int) -> int:", "def _(a: int) -> int:"]) {
    const r = classifyPyTestability(sig, doc);
    assert.notEqual(r.reason, "not-exported", `${sig} must never be refused for visibility`);
  }
});

test("classify: no docstring is underspecified, and the docstring is the only contract source", () => {
  assert.equal(classifyPyTestability("def f(a: int) -> int:", undefined).reason, "underspecified");
  assert.equal(classifyPyTestability("def f(a: int) -> int:", "   ").reason, "underspecified");
  assert.equal(classifyPyTestability("def f(a: int) -> int:", "x").testable, true);
});

test("classify: the io ZERO on the corpus is FALSE, and the leg says so rather than pretending", () => {
  // `_is_port_available` opens a socket in its BODY. A signature-only classifier
  // cannot see that, and this row exists so the residual is recorded rather than
  // filed as a bug later.
  assert.equal(classifyPyTestability("def _is_port_available(host: str, port: int) -> bool:", "d").testable, true);
  assert.equal(classifyPyTestability("def _is_port_available(host: str, sock: socket) -> bool:", "d").reason, "io");
});

test("classify: a `self` first parameter is the tell, and `self` elsewhere is not", () => {
  const doc = "d";
  assert.equal(classifyPyTestability("def f(self) -> int:", doc).reason, "needs-fixture");
  assert.equal(classifyPyTestability("def f(a: int, self: int) -> int:", doc).testable, true, "only the FIRST parameter is a receiver");
  assert.equal(classifyPyTestability("def f(selfish: int) -> int:", doc).testable, true);
});

// ===========================================================================
// 4. Blank values (Amendment 2 + Amendment 6a)
// ===========================================================================

test("blank values: scalars bare, containers hinted with the ELEMENT type, tuples one BARE hole each", () => {
  const rows = [
    ["int", "${1}", 1],
    ["str", "${1}", 1],
    ["bool", "${1}", 1],
    ["float", "${1}", 1],
    ["list[int]", "[${1:/* int */}]", 1],
    ["dict[str, int]", "{${1:/* str, int */}}", 1],
    ["set[str]", "{${1:/* str */}}", 1],
    ["frozenset[str]", "{${1:/* str */}}", 1],
    // Amendment 6a: a positional hole is BARE, because its type is readable off
    // the position. Measured against the shipped Rust tuple branch.
    ["tuple[str, list[str]]", "(${1}, ${2})", 2],
    ["tuple[int, int, bool]", "(${1}, ${2}, ${3})", 3],
    ["Optional[int]", "${1:/* Optional[int] */}", 1],
    ["int | None", "${1:/* int | None */}", 1],
    ["MyClass", "${1:/* MyClass */}", 1],
    ["dict[str, Any]", "{${1:/* str, Any */}}", 1],
  ];
  for (const [ty, rhs, holes] of rows) {
    assert.deepEqual(pyRenderBlankValue(ty), { rhs, holes }, `renderBlankValue(${ty})`);
  }
});

test("blank values: startHole numbers holes across a module", () => {
  assert.deepEqual(pyRenderBlankValue("tuple[int, int]", { startHole: 4 }), { rhs: "(${4}, ${5})", holes: 2 });
  assert.deepEqual(pyRenderBlankValue("list[int]", { startHole: 3 }), { rhs: "[${3:/* int */}]", holes: 1 });
});

// ===========================================================================
// 5. The pytest locator. Safety-critical: blanking the wrong side keeps the
//    model's guess and deletes the call under test.
// ===========================================================================

test("locator: the RIGHT-hand side of the top-level ==, never the call under test", () => {
  assert.deepEqual(spans("assert fanout(3) == 7"), ["7"]);
  assert.deepEqual(spans("    assert fanout(3) == 7\n"), ["7"]);
  assert.deepEqual(spans("assert widen(3) == [1, 2, 3]"), ["[1, 2, 3]"]);
  // The message is not an expected value.
  assert.deepEqual(spans('assert fanout(3) == 7, "should double"'), ["7"]);
  // A nested == is not the top-level one.
  assert.deepEqual(spans('assert d == {"a": 1 == 2}'), ['{"a": 1 == 2}']);
  // Two asserts, ascending and non-overlapping.
  const two = "def t():\n    assert a() == 1\n    assert b() == 2\n";
  const got = pytestExpectedValueSpans(two);
  assert.deepEqual(got.map((s) => two.slice(s.start, s.end)), ["1", "2"]);
  assert.ok(got[0].end <= got[1].start, "spans must be ascending and non-overlapping");
});

test("locator: `//` IS FLOOR DIVISION, not a comment", () => {
  // The shared scanner reads `//` as a line comment for four languages. Reading
  // it that way here truncates the span to `7` and leaves the model's `// 2` in
  // the human's buffer with a hole in front of it.
  assert.deepEqual(spans("assert halve(7) == 7 // 2"), ["7 // 2"]);
  assert.deepEqual(spans("assert f() == a / b"), ["a / b"]);
  // `#` IS a comment, and it ends the value.
  assert.deepEqual(spans("assert f() == 7  # the answer"), ["7"]);
});

test("locator: never inside a string, a docstring, an f-string or a comment", () => {
  assert.deepEqual(spans('s = "assert f() == 7"'), []);
  assert.deepEqual(spans("'''\nassert f() == 7\n'''"), []);
  assert.deepEqual(spans('"""assert f() == 7"""'), []);
  assert.deepEqual(spans("# assert f() == 7"), []);
  assert.deepEqual(spans('assert f() == f"{a}"'), ['f"{a}"']);
  assert.deepEqual(spans("assert f() == 'x'"), ["'x'"]);
  // A 3.12 f-string reusing its own quote inside the interpolation.
  assert.deepEqual(spans('assert f() == f"{d["k"]}"'), ['f"{d["k"]}"']);
  // A docstring holding an assert, then a real one after it.
  const doc = 'def t():\n    """Example: assert f() == 99."""\n    assert f() == 7\n';
  assert.deepEqual(pytestExpectedValueSpans(doc).map((s) => doc.slice(s.start, s.end)), ["7"]);
});

test("locator: FAILS OPEN on the shapes with no top-level == (scraps D5, deferred)", () => {
  // Recorded, not fixed: these produce no span, so a module of only these blanks
  // nothing. Phase 6 owns the general floor; this row exists so the shape is a
  // known cost rather than a surprise.
  assert.deepEqual(spans("assert x != y"), []);
  assert.deepEqual(spans("assert x is None"), []);
  assert.deepEqual(spans("assert x"), []);
  assert.deepEqual(spans("assert isinstance(x, int)"), []);
  // And it must not blank a plain assignment or a keyword argument.
  assert.deepEqual(spans("want = 7"), []);
  assert.deepEqual(spans("f(a == 1)"), []);
});

test("locator: multi-line values, continuations and unbalanced text never overrun", () => {
  const multi = "assert f() == [\n    1,\n    2,\n]\n";
  assert.deepEqual(spans(multi), ["[\n    1,\n    2,\n]"]);
  assert.deepEqual(spans("assert f() == 1 + \\\n    2\n"), ["1 + \\\n    2"]);
  assert.deepEqual(spans("assert f() == 1\nassert g() == 2\n"), ["1", "2"]);
  // Garbage in, no throw and no runaway span.
  for (const junk of ["assert f() ==", "assert", "assert (f() == 1", 'assert f() == "unterminated']) {
    assert.doesNotThrow(() => pytestExpectedValueSpans(junk), junk);
  }
});

test("locator: unittest blanks the SECOND argument of assertEqual and nothing else", () => {
  const one = "self.assertEqual(fanout(3), 7)";
  assert.deepEqual(unittestExpectedValueSpans(one).map((s) => one.slice(s.start, s.end)), ["7"]);
  const nested = "self.assertEqual(fanout(3, 4), [1, 2])";
  assert.deepEqual(unittestExpectedValueSpans(nested).map((s) => nested.slice(s.start, s.end)), ["[1, 2]"]);
  assert.deepEqual(unittestExpectedValueSpans('s = "self.assertEqual(a, 7)"'), []);
  assert.deepEqual(unittestExpectedValueSpans("assertEqual(a, 7)"), [], "a bare call is not the method form");
  assert.deepEqual(unittestExpectedValueSpans("self.assertTrue(f())"), [], "fail open, per the contract's table");
});

// ===========================================================================
// 6. The junit parse. Fixtures captured from pytest 9.0.2 on this machine.
// ===========================================================================

const XML_HEAD = '<?xml version="1.0" encoding="utf-8"?><testsuites name="pytest tests">';
const XML_PASS_FAIL =
  XML_HEAD +
  '<testsuite name="pytest" errors="0" failures="1" skipped="0" tests="2" time="0.014" timestamp="2026-07-27T19:07:43" hostname="h">' +
  '<testcase classname="tests.test_atlas" name="test_print_forge" time="0.000">' +
  '<failure message="assert 6 == 7&#10; +  where 6 = noisy(3)">def test_print_forge():\n&gt;       assert noisy(3) == 7\nE       assert 6 == 7\n\ntests/test_atlas.py:10: AssertionError</failure>' +
  "</testcase>" +
  '<testcase classname="tests.test_atlas" name="test_ok" time="0.000" /></testsuite></testsuites>';
const XML_FILTER_MISS =
  XML_HEAD +
  '<testsuite name="pytest" errors="0" failures="0" skipped="0" tests="0" time="0.004" timestamp="t" hostname="h" /></testsuites>';
const XML_COLLECTION_ERROR =
  XML_HEAD +
  '<testsuite name="pytest" errors="1" failures="0" skipped="0" tests="1" time="0.012" timestamp="t" hostname="h">' +
  '<testcase classname="" name="tests.test_broken" time="0.000">' +
  '<error message="collection failure">ImportError while importing test module \'/p/tests/test_broken.py\'.\n' +
  "tests/test_broken.py:1: in &lt;module&gt;\n    from mypkg.atlas import widen\nE   ModuleNotFoundError: No module named 'mypkg'</error>" +
  "</testcase></testsuite></testsuites>";

test("parse: a pass and a fail, with counts taken from the testsuite ATTRIBUTES", () => {
  const p = parsePytestJunitXml(XML_PASS_FAIL, "", 1);
  assert.equal(p.ran, true);
  assert.equal(p.passed, 1);
  assert.equal(p.failed, 1);
  assert.equal(p.ignored, 0);
  assert.equal(p.casesComplete, true, "pytest enumerates passing tests, unlike C#");
  assert.equal(p.filterMatchedNothing, undefined);
  assert.equal(p.environmentError, undefined);
  assert.equal(p.buildError, undefined, "Python has no build step: buildError is never set");
  assert.deepEqual(p.cases, [
    { name: "test_print_forge", outcome: "fail" },
    { name: "test_ok", outcome: "pass" },
  ]);
  assert.match(p.failures[0].message, /assert 6 == 7/);
  assert.match(p.failures[0].message, /\n\s*>\s+assert noisy\(3\) == 7/, "entities are decoded, so the human reads the source line");
});

test("parse: THE EXIT-4 COLLISION - a filter miss and a collection error are told apart by `errors`", () => {
  const miss = parsePytestJunitXml(XML_FILTER_MISS, "", 4);
  assert.equal(miss.filterMatchedNothing, true);
  assert.equal(miss.environmentError, undefined, "a filter miss is not a broken environment");
  assert.equal(miss.ran, false);

  const err = parsePytestJunitXml(XML_COLLECTION_ERROR, "", 4);
  assert.equal(err.filterMatchedNothing, undefined, "an unresolvable import must NEVER be reported as a filter miss");
  assert.match(err.environmentError, /No module named 'mypkg'/);
  assert.equal(err.buildError, undefined);
  assert.equal(err.failed, 0, "a collection error is not a failing test");
  assert.deepEqual(err.cases, [], "the synthetic collection testcase is not a test result");
  // Amendment 6b: the exit code is identical, so the parse must not lean on it.
  assert.equal(parsePytestJunitXml(XML_COLLECTION_ERROR, "", 4).ran, false, "nothing ran, so ran is false");
});

test("parse: skips are ignored, not failures", () => {
  const xml =
    XML_HEAD +
    '<testsuite name="pytest" errors="0" failures="0" skipped="1" tests="2">' +
    '<testcase name="test_a" /><testcase name="test_b"><skipped message="no reason" /></testcase>' +
    "</testsuite></testsuites>";
  const p = parsePytestJunitXml(xml, "", 0);
  assert.equal(p.passed, 1);
  assert.equal(p.ignored, 1);
  assert.equal(p.failed, 0);
  assert.deepEqual(p.cases.map((c) => c.outcome), ["pass", "ignored"]);
});

test("parse: RAW STDOUT IS NOT A REPORT, however much of one a test printed", () => {
  // The forgery, handed to the parser as if it were the file. A parser that went
  // looking for `<testsuite` inside it would report 99 passing tests.
  const forged =
    "1 failed, 99 passed in 0.01s\nFAILED tests/test_atlas.py::test_phantom - forged\n" +
    '<?xml version="1.0"?><testsuite name="pytest" errors="0" failures="0" skipped="0" tests="99">' +
    '<testcase classname="tests.test_atlas" name="test_phantom" /></testsuite>';
  const p = parsePytestJunitXml(forged, "boom", 1);
  assert.equal(p.ran, false);
  assert.equal(p.passed, 0);
  assert.equal(p.failed, 0);
  assert.match(p.environmentError, /boom/, "an honest did-not-run, not a run assembled from stdout");
});

test("parse: malformed and hostile XML yields a did-not-run, never a throw", () => {
  for (const junk of ["", "   ", "not xml", "<testsuite", '<?xml version="1.0"?>', "<testsuites><testsuite tests='x'"]) {
    assert.doesNotThrow(() => parsePytestJunitXml(junk, "", 4), JSON.stringify(junk));
  }
  // A report pytest did not finish writing is NOT a report, even though its
  // `<testsuite>` start tag holds readable counts. pytest writes the file in one
  // go at the end of the session, so an unclosed suite means the session never
  // ended and those counts describe a run that did not happen.
  const truncated = parsePytestJunitXml(XML_PASS_FAIL.slice(0, 260), "", 1);
  assert.equal(truncated.ran, false, "a truncated report must not be trusted for its counts");
  assert.equal(truncated.passed, 0);
  assert.ok(truncated.environmentError.length > 0);
  // The filter miss is a SELF-CLOSING suite with no close tag, and it is whole.
  assert.equal(parsePytestJunitXml(XML_FILTER_MISS, "", 4).filterMatchedNothing, true);
  // An attribute holding an unescaped `>` must not end the tag early. pytest
  // escapes it, so this is a defensive row rather than a captured one.
  const gt = XML_HEAD + '<testsuite errors="0" failures="1" skipped="0" tests="1"><testcase name="test_gt"><failure message="assert 6 > 700">body</failure></testcase></testsuite></testsuites>';
  const p = parsePytestJunitXml(gt, "", 1);
  assert.deepEqual(p.cases, [{ name: "test_gt", outcome: "fail" }]);
  assert.match(p.failures[0].message, /assert 6 > 700/);
});

// ===========================================================================
// 7. The forgery, run for real
// ===========================================================================

test(
  "LIVE: a test that PRINTS a fake testsuite and fake counts changes nothing the parser reports",
  { skip: corpusPython === undefined ? "mcp-graph-engine venv not present" : false },
  () => {
    const root = path.join(scratch, "forge");
    fs.mkdirSync(path.join(root, "tests"), { recursive: true });
    fs.writeFileSync(path.join(root, "pyproject.toml"), '[tool.pytest.ini_options]\ntestpaths = ["tests"]\n');
    fs.writeFileSync(
      path.join(root, "atlas.py"),
      [
        "def fanout(n: int) -> int:",
        '    """Double n."""',
        "    return n * 2",
        "",
        "def noisy(n: int) -> int:",
        '    """Prints a forged report, then doubles n."""',
        '    print("")',
        '    print("1 failed, 99 passed in 0.01s")',
        '    print("FAILED tests/test_atlas.py::test_phantom - forged")',
        "    print('<?xml version=\"1.0\"?><testsuite errors=\"0\" failures=\"0\" skipped=\"0\" tests=\"99\">" +
          "<testcase classname=\"t\" name=\"test_phantom\" /></testsuite>')",
        "    return n * 2",
        "",
      ].join("\n")
    );
    fs.writeFileSync(
      path.join(root, "tests", "test_atlas.py"),
      ["from atlas import fanout, noisy", "", "def test_forge():", "    assert noisy(3) == 7", "", "def test_ok():", "    assert fanout(3) == 6", ""].join("\n")
    );

    const placement = {
      targetPath: path.join(root, "tests", "test_atlas.py"),
      exists: true,
      mode: "project-file",
      runRoot: root,
      interpreter: corpusPython,
    };
    const cmd = pytest().buildCommand(placement, ["test_forge", "test_ok"]);
    fs.rmSync(cmd.outputFile, { force: true });
    const run = spawnSync(cmd.command, cmd.args, { cwd: cmd.cwd, encoding: "utf8" });
    const report = fs.readFileSync(cmd.outputFile, "utf8");

    // The channel is real: the forgery IS on stdout, at column 0.
    assert.match(run.stdout, /^1 failed, 99 passed in /m, "the forged count line really does reach stdout");
    assert.match(run.stdout, /tests="99"/, "so does a whole forged testsuite element");
    assert.ok(!/tests="99"/.test(report), "and none of it reaches the FILE, which only pytest writes");

    const p = pytest().parseOutput(report, run.stderr, run.status);
    assert.equal(p.passed, 1, "one real pass, not 99");
    assert.equal(p.failed, 1);
    assert.deepEqual(p.cases.map((c) => c.name).sort(), ["test_forge", "test_ok"], "no phantom test");
    // The forged text still exists, attributed to the test that printed it: the
    // honest place for it.
    assert.equal(p.failures.length, 1);
    assert.equal(p.failures[0].name, "test_forge");

    // And the run left nothing in the project.
    const leftovers = fs.readdirSync(root).filter((f) => f === "__pycache__" || f === ".pytest_cache");
    assert.deepEqual(leftovers, [], "-B and -p no:cacheprovider together leave nothing behind");
    assert.deepEqual(fs.readdirSync(path.join(root, "tests")).filter((f) => f === "__pycache__"), []);
  }
);

// ===========================================================================
// 8. The unittest parse
// ===========================================================================

const UNITTEST_FAIL = [
  "test_bad (tests.test_unit.TestAtlas.test_bad) ... FAIL",
  "test_ok (tests.test_unit.TestAtlas.test_ok) ... ok",
  "",
  "======================================================================",
  "FAIL: test_bad (tests.test_unit.TestAtlas.test_bad)",
  "----------------------------------------------------------------------",
  "Traceback (most recent call last):",
  '  File "/p/tests/test_unit.py", line 9, in test_bad',
  "    self.assertEqual(fanout(3), 7)",
  "AssertionError: 6 != 7",
  "",
  "----------------------------------------------------------------------",
  "Ran 2 tests in 0.000s",
  "",
  "FAILED (failures=1)",
  "",
].join("\n");

const UNITTEST_IMPORT_ERROR = [
  "test_import (unittest.loader._FailedTest.test_import) ... ERROR",
  "",
  "======================================================================",
  "ERROR: test_import (unittest.loader._FailedTest.test_import)",
  "----------------------------------------------------------------------",
  "ImportError: Failed to import test module: test_import",
  "Traceback (most recent call last):",
  "ModuleNotFoundError: No module named 'mypkg'",
  "",
  "",
  "----------------------------------------------------------------------",
  "Ran 1 test in 0.000s",
  "",
  "FAILED (errors=1)",
  "",
].join("\n");

const UNITTEST_NO_TESTS = ["", "----------------------------------------------------------------------", "Ran 0 tests in 0.000s", "", "NO TESTS RAN", ""].join("\n");

test("parse: unittest reads STDERR, which is where its report goes and where print() does not", () => {
  // The forgery on stdout must change nothing. This is a weaker guarantee than
  // pytest's file and the code says so: sys.stderr.write can still forge a line.
  const forgedStdout = "test_phantom (t.T.test_phantom) ... ok\nRan 99 tests in 0.001s\n\nOK\n";
  const p = parseUnittestOutput(forgedStdout, UNITTEST_FAIL, 1);
  assert.equal(p.passed, 1);
  assert.equal(p.failed, 1);
  assert.deepEqual(p.cases, [
    { name: "test_bad", outcome: "fail" },
    { name: "test_ok", outcome: "pass" },
  ]);
  assert.equal(p.failures.length, 1);
  assert.equal(p.failures[0].name, "test_bad");
  assert.match(p.failures[0].message, /AssertionError: 6 != 7/);
  assert.ok(!/^FAIL: /.test(p.failures[0].message), "the block's own header is furniture, not detail");
  assert.equal(p.casesComplete, true);
});

test("parse: unittest tells a filter miss from a module that would not import", () => {
  const miss = parseUnittestOutput("", UNITTEST_NO_TESTS, 5);
  assert.equal(miss.filterMatchedNothing, true);
  assert.equal(miss.environmentError, undefined);
  assert.equal(miss.ran, false);

  const err = parseUnittestOutput("", UNITTEST_IMPORT_ERROR, 1);
  assert.equal(err.filterMatchedNothing, undefined, "an import failure is not a filter miss, whatever the exit code");
  assert.match(err.environmentError, /No module named 'mypkg'/);
  assert.equal(err.failed, 0, "the synthetic _FailedTest is not a failing test of the human's");
  assert.deepEqual(err.cases, []);
  assert.equal(err.buildError, undefined);
});

test("parse: unittest with no report at all is an environment failure, never a green", () => {
  const p = parseUnittestOutput("", "", 1);
  assert.equal(p.ran, false);
  assert.equal(p.passed + p.failed, 0);
  assert.ok(p.environmentError.length > 0);
  assert.doesNotThrow(() => parseUnittestOutput(undefined, undefined, 0));
});

// ===========================================================================
// 9. The commands
// ===========================================================================

const CMD_PLACEMENT = {
  targetPath: "/p/tests/test_foo.py",
  exists: true,
  mode: "project-file",
  runRoot: "/p",
  interpreter: "/p/.venv/bin/python",
};

test("command: pytest node ids, both cache flags, and a junit path in the system temp area", () => {
  const cmd = pytest().buildCommand(CMD_PLACEMENT, ["test_a", "test_b"]);
  assert.equal(cmd.command, "/p/.venv/bin/python");
  assert.deepEqual(cmd.args, [
    "-B",
    "-m",
    "pytest",
    "tests/test_foo.py::test_a",
    "tests/test_foo.py::test_b",
    "-q",
    "-p",
    "no:cacheprovider",
    `--junit-xml=${cmd.outputFile}`,
  ]);
  assert.equal(cmd.cwd, "/p");
  assert.ok(cmd.outputFile.startsWith(os.tmpdir()), "the report must never be written into the human's repo");
  assert.ok(!cmd.outputFile.startsWith("/p/"));
  assert.equal(cmd.outputFile, pytestJunitPath(CMD_PLACEMENT), "deterministic, so the runner can find what the command wrote");
  // No -k anywhere: node ids compose positionally and select exactly.
  assert.ok(!cmd.args.includes("-k"));
});

test("command: an empty filter must never run the whole suite", () => {
  assert.throws(() => pytest().buildCommand(CMD_PLACEMENT, []), /at least one node id/);
  assert.throws(() => pytest().buildCommand(CMD_PLACEMENT, [""]), /at least one node id/);
  assert.throws(() => unittest().buildCommand(CMD_PLACEMENT, []), /at least one test name/);
});

test("command: unittest's -k is ANCHORED, because a bare pattern is a substring match", () => {
  const cmd = unittest().buildCommand(CMD_PLACEMENT, ["test_ok", "test_two"]);
  assert.deepEqual(cmd.args, ["-B", "-m", "unittest", "-v", "-k", "*.test_ok", "-k", "*.test_two", "tests/test_foo.py"]);
  assert.equal(cmd.outputFile, undefined, "unittest has no structured report to read from a file");
});

test("command: no interpreter resolved -> python3, and the same one that proved the import", () => {
  const cmd = pytest().buildCommand({ ...CMD_PLACEMENT, interpreter: undefined }, ["test_a"]);
  assert.equal(cmd.command, "python3");
});

// ===========================================================================
// 10. Placement
// ===========================================================================

test("placement: testpaths wins, then a tests/ directory, then beside the module", () => {
  const p = okPlacement(py().placementFor("/p/src/pkg/foo.py", "widen", projectDeps()));
  assert.equal(p.targetPath, path.normalize("/p/tests/test_foo.py"));
  assert.equal(p.mode, "project-file");
  assert.equal(p.runRoot, "/p");
  assert.equal(p.packageArg, undefined, "pytest's filter is node ids, not a package argument");
  assert.equal(p.importLine, "from pkg.foo import widen");
  assert.equal(p.interpreter, path.normalize("/p/.venv/bin/python"));

  // No testpaths, but a tests/ directory.
  const noPaths = deps([...PROJECT_FILES], { "/p/pyproject.toml": '[tool.setuptools.packages.find]\nwhere = ["src"]\n' });
  assert.equal(okPlacement(py().placementFor("/p/src/pkg/foo.py", "widen", noPaths)).targetPath, path.normalize("/p/tests/test_foo.py"));

  // Neither: beside the module.
  const bare = deps(["/p/pyproject.toml", "/p/pkg/foo.py"], { "/p/pyproject.toml": "[project]\nname='x'\n" });
  const beside = okPlacement(py().placementFor("/p/pkg/foo.py", "widen", bare));
  assert.equal(beside.targetPath, path.normalize("/p/pkg/test_foo.py"));
  assert.equal(beside.importLine, "from pkg.foo import widen");

  // A testpaths array spelled across lines, which real pyproject.toml files do.
  const multiline = deps([...PROJECT_FILES], {
    "/p/pyproject.toml": '[tool.pytest.ini_options]\ntestpaths = [\n    "spec",  # not tests\n]\nminversion = "7.0"\n',
  });
  assert.equal(okPlacement(py().placementFor("/p/src/pkg/foo.py", "widen", multiline)).targetPath, path.normalize("/p/spec/test_foo.py"));
});

test("placement: `where = ['src']` is honoured, so the import is not `src.pkg.foo`", () => {
  const p = okPlacement(py().placementFor("/p/src/pkg/foo.py", "widen", projectDeps()));
  assert.equal(p.importLine, "from pkg.foo import widen");
  // A package `__init__.py` IS the package.
  const init = okPlacement(py().placementFor("/p/src/pkg/__init__.py", "widen", projectDeps({}, ["/p/src/pkg/__init__.py"])));
  assert.equal(init.importLine, "from pkg import widen");
});

test("placement: no project root refuses BY NAMING what is missing", () => {
  const r = py().placementFor("/nowhere/foo.py", "widen", deps([]));
  assert.equal(r.ok, false);
  assert.equal(r.refusal.reason, "no-project-root");
  for (const marker of ["pyproject.toml", "setup.py", "setup.cfg", "tox.ini"]) {
    assert.ok(r.refusal.detail.includes(marker), `the refusal must name ${marker}`);
  }
});

test("placement: THE IMPORT IS PROVEN, and a definite failure refuses with both names", () => {
  const asked = [];
  const probe = (command, args, cwd) => {
    asked.push({ command, args, cwd });
    return { exitCode: 1 };
  };
  const r = py().placementFor("/p/src/pkg/foo.py", "widen", projectDeps({ probe }));
  assert.equal(r.ok, false);
  assert.equal(r.refusal.reason, "unresolvable-import");
  assert.ok(r.refusal.detail.includes("pkg.foo"), "the refusal must name the MODULE");
  assert.ok(r.refusal.detail.includes("widen"), "and the SYMBOL that was asked for");
  assert.ok(r.refusal.detail.includes("/p/.venv/bin/python"), "and the INTERPRETER that was asked");
  // Two probes per placement, both against the project's own interpreter: which
  // framework is installed, and whether THE LINE THE SCAFFOLD WILL WRITE imports.
  // The second is the whole `from … import …`, not `import <module>`: measured on
  // the corpus, the module resolves while the symbol does not when the name is a
  // @staticmethod on a class, and the weaker question passes the proof and writes
  // a file that will not collect. Both are `-B` so answering leaves no bytecode in
  // the human's repo.
  assert.deepEqual(asked, [
    { command: path.normalize("/p/.venv/bin/python"), args: ["-B", "-c", "import pytest"], cwd: "/p" },
    { command: path.normalize("/p/.venv/bin/python"), args: ["-B", "-c", "from pkg.foo import widen"], cwd: "/p" },
  ]);
});

test("placement: a probe that cannot ANSWER is not an answer - unproven proceeds, and says so", () => {
  const lines = [];
  const unproven = py().placementFor("/p/src/pkg/foo.py", "widen", projectDeps({ probe: () => undefined, log: (l) => lines.push(l) }));
  assert.ok(unproven.ok, "a probe that could not spawn must not refuse the gesture");
  assert.ok(lines.some((l) => /UNPROVEN/.test(l)), `the log must say so, got ${JSON.stringify(lines)}`);

  // No venv beside the root: there is no interpreter to ask.
  const noVenvFiles = ["/q/pyproject.toml", "/q/src/pkg/foo.py"];
  const noVenv = deps(noVenvFiles, { "/q/pyproject.toml": PYPROJECT }, { probe: () => ({ exitCode: 1 }) });
  const r = py().placementFor("/q/src/pkg/foo.py", "widen", noVenv);
  assert.ok(r.ok, "no interpreter means the question could not be asked, not that the answer was no");
  assert.equal(r.placement.interpreter, undefined);
});

test("placement: a symbol that cannot be spelled has no import line, so it refuses", () => {
  for (const name of ["not an identifier", "", "foo.bar", "3x"]) {
    const r = py().placementFor("/p/src/pkg/foo.py", name, projectDeps());
    assert.equal(r.ok, false, `${JSON.stringify(name)} must refuse`);
    assert.equal(r.refusal.reason, "unresolvable-import");
  }
});

test("placement: a source file that IS a test file targets itself and imports nothing", () => {
  const files = ["/p/pyproject.toml", "/p/.venv/bin/python", "/p/tests/test_foo.py"];
  const p = okPlacement(py().placementFor("/p/tests/test_foo.py", "widen", deps(files, { "/p/pyproject.toml": PYPROJECT })));
  assert.equal(p.targetPath, path.normalize("/p/tests/test_foo.py"), "no test_test_foo.py");
  assert.equal(p.mode, "same-file");
  assert.equal(p.importLine, undefined, "a helper in a test file is already in scope");
});

test("placement: the unittest project gets `import unittest`, the pytest project gets no framework import", () => {
  const withPytest = okPlacement(py().placementFor("/p/src/pkg/foo.py", "widen", projectDeps()));
  assert.equal(withPytest.frameworkImportLine, undefined, "pytest needs no import: the idiom is a bare assert");

  const files = ["/q/pyproject.toml", "/q/pkg/foo.py"];
  const noPytest = deps(files, { "/q/pyproject.toml": "[project]\nname='x'\n" }, { probe: () => ({ exitCode: 1 }) });
  const p = okPlacement(py().placementFor("/q/pkg/foo.py", "widen", noPytest));
  assert.equal(p.frameworkImportLine, "import unittest");
});

// ===========================================================================
// 11. The scaffold
// ===========================================================================

const scaffoldPlacement = {
  targetPath: "/p/tests/test_foo.py",
  exists: false,
  mode: "project-file",
  runRoot: "/p",
  importLine: "from pkg.foo import widen",
};
const GENERATED = "def test_widen_happy():\n    assert widen(3) == 7\n";
const plan = (existingText, placement = scaffoldPlacement, markerId = "m1", generatedTests = GENERATED) =>
  py().scaffold({ existingText, generatedTests, markerId, placement });

test("scaffold: a new file is the import, then the marked region, at column 0", () => {
  const p = plan("");
  assert.equal(p.mode, "new-module");
  assert.equal(p.start, 0);
  assert.equal(p.end, 0);
  assert.equal(
    p.text,
    "from pkg.foo import widen\n\n# column80-tests:m1:begin\ndef test_widen_happy():\n    assert widen(3) == 7\n# column80-tests:m1:end\n"
  );
  // An indented model reply is reindented: an indented `def` is a nested
  // function pytest never collects.
  const indented = plan("", scaffoldPlacement, "m1", "    def test_x():\n        assert f() == 1\n");
  assert.match(indented.text, /^def test_x\(\):$/m);
});

test("scaffold: regenerating replaces EXACTLY the marked region and touches nothing else", () => {
  const existing = plan("").text;
  const again = py().scaffold({
    existingText: existing,
    generatedTests: "def test_widen_other():\n    assert widen(4) == 9\n",
    markerId: "m1",
    placement: scaffoldPlacement,
  });
  assert.equal(again.mode, "replace-generated");
  const applied = existing.slice(0, again.start) + again.text + existing.slice(again.end);
  assert.match(applied, /test_widen_other/);
  assert.ok(!/test_widen_happy/.test(applied));
  assert.equal((applied.match(/from pkg\.foo import widen/g) || []).length, 1, "the import is not duplicated");
  // Idempotent: a third pass over the same input is byte-identical.
  const third = py().scaffold({ existingText: applied, generatedTests: "def test_widen_other():\n    assert widen(4) == 9\n", markerId: "m1", placement: scaffoldPlacement });
  assert.equal(applied.slice(0, third.start) + third.text + applied.slice(third.end), applied);
});

test("scaffold: the import already present keeps the plan NARROW; missing forces a whole-file plan", () => {
  const hasImport = "from pkg.foo import widen\n\ndef test_mine():\n    assert True\n";
  const narrow = plan(hasImport);
  assert.equal(narrow.mode, "extend-existing");
  assert.equal(narrow.start, hasImport.length, "an append, not a rewrite");
  assert.equal(narrow.end, hasImport.length);

  const noImport = "def test_mine():\n    assert True\n";
  const whole = plan(noImport);
  assert.equal(whole.mode, "extend-existing");
  // The mode string cannot distinguish these two, which is the wall both earlier
  // legs hit. What this leg owes phase 6 is a DETECTABLE shape: a whole-file plan
  // over a non-empty file, which the append branch can never produce.
  assert.equal(whole.start, 0);
  assert.equal(whole.end, noImport.length);
  assert.ok(whole.text.startsWith("from pkg.foo import widen\n"));
  assert.match(whole.text, /def test_mine/, "the developer's own test survives");
});

test("scaffold: the import goes AFTER the last import and never before a module docstring", () => {
  const withDoc = '"""Module docstring."""\n\nimport os\n\ndef test_mine():\n    assert True\n';
  const p = plan(withDoc);
  const lines = p.text.split("\n");
  assert.equal(lines[0], '"""Module docstring."""', "the docstring must stay the first statement or it stops being one");
  assert.equal(lines.indexOf("from pkg.foo import widen"), lines.indexOf("import os") + 1);

  const onlyDoc = '"""Doc with an import in it: from pkg.foo import widen."""\n\ndef test_mine():\n    pass\n';
  const q = plan(onlyDoc);
  assert.match(q.text, /^"""Doc with/, "an import spelled inside the docstring is not an import");
  assert.equal((q.text.match(/^from pkg\.foo import widen$/gm) || []).length, 1, "so the real one still gets added");
});

test("scaffold: an existing `from pkg.foo import other` is not this import", () => {
  const other = "from pkg.foo import other\n\ndef test_mine():\n    pass\n";
  const p = plan(other);
  assert.equal(p.start, 0, "the name is missing, so the import must be added");
  assert.match(p.text, /from pkg\.foo import widen/);
  const parens = "from pkg.foo import (\n    other,\n    widen,\n)\n\ndef test_mine():\n    pass\n";
  assert.equal(plan(parens).start, parens.length, "a parenthesized list binding the name IS the import");
});

test("scaffold: unittest's framework import rides alongside the unit import", () => {
  const p = plan("", { ...scaffoldPlacement, frameworkImportLine: "import unittest" });
  assert.equal(p.text.split("\n")[0], "import unittest");
  assert.equal(p.text.split("\n")[1], "from pkg.foo import widen");
});

test("generatedTestNames: the literal-aware scanner, so a docstring cannot invent a test", () => {
  const region = [
    "# column80-tests:m1:begin",
    "def test_real():",
    '    """Example: def test_phantom(): ..."""',
    "    assert f() == 1",
    "",
    "def test_second():",
    '    assert g() == "def test_also_phantom():"',
    "# column80-tests:m1:end",
    "",
  ].join("\n");
  assert.deepEqual(py().generatedTestNames(region, "m1"), ["test_real", "test_second"]);
  // A raw regex would have found both phantoms.
  assert.deepEqual([...region.matchAll(/\bdef\s+(test\w*)/g)].map((m) => m[1]).length, 4);
  // Names outside the region, and a missing region, are not this function's.
  assert.deepEqual(py().generatedTestNames("def test_elsewhere(): pass\n", "m1"), []);
  assert.deepEqual(py().generatedTestNames("# column80-tests:m1:begin\ndef test_x():\n    pass\n", "m1"), [], "an unterminated region yields nothing");
  assert.equal(py().testNameIsValid, undefined, "nothing in Python constrains a test function's name the way go test does");
});

// ===========================================================================
// 12. The shared scanner widened, and the three earlier legs did not move
// ===========================================================================

const PRE_V31 = "45b4778";
const preV31Exists = (() => {
  try {
    execFileSync("git", ["cat-file", "-e", `${PRE_V31}:src/core/testAssembly.ts`], { cwd: REPO });
    return true;
  } catch {
    return false;
  }
})();

test(
  "freeze: the Rust blanker is byte-identical to the pre-v31 implementation after the Python profile fields were added",
  { skip: preV31Exists ? false : `${PRE_V31} is not reachable from this checkout` },
  () => {
    const dir = path.join(scratch, "prev31");
    fs.mkdirSync(dir, { recursive: true });
    for (const f of ["testAssembly.ts", "tabstop.ts"]) {
      fs.writeFileSync(path.join(dir, f), execFileSync("git", ["show", `${PRE_V31}:src/core/${f}`], { cwd: REPO, maxBuffer: 1 << 26 }));
    }
    // blankTestModule only: `rustExpectedValueSpans` was lifted out of it in
    // phase 1 and does not exist at this commit. It is the same scanner either
    // way, and the blanker is the shipped surface.
    fs.writeFileSync(path.join(dir, "entry.ts"), `export { blankTestModule } from "./testAssembly";\n`);
    const outfile = path.join(dir, "bundle.cjs");
    esbuild.buildSync({ entryPoints: [path.join(dir, "entry.ts")], bundle: true, outfile, format: "cjs", platform: "node" });
    const before = require(outfile);

    const cases = [
      "assert_eq!(a, 2);",
      "assert_eq!(a, 2); // a # not-a-comment",
      "assert_eq!(a, b // 2);",
      'assert_eq!(a, "x # y");',
      "assert_eq!(a, '\\'');",
      "/* block */ assert_eq!(a, 3);",
      "assert_eq!(a, r#\"raw ''' \"\"\" \"#);",
      "let s = \"'''\"; assert_eq!(a, 4);",
      "// # comment\nassert_eq!(a, 5);",
      "assert_eq!(f\"{x}\", 6);",
    ];
    for (const c of cases) {
      assert.ok(Array.isArray(rustExpectedValueSpans(c)), "the lifted-out scanner still answers");
      for (const rt of ["u32", "Option<u32>", "Vec<String>"]) {
        assert.deepEqual(blankTestModule(c, rt), before.blankTestModule(c, rt), `Rust blank drift on ${JSON.stringify(c)} / ${rt}`);
      }
    }

    const toks = ["assert_eq!(", "a", ",", ")", '"', "'", "\\", "/*", "*/", "//", "\n", "`", "#", '"""', "'''", "f\"", "{", "}", "(", 'r#"', " "];
    let seed = 20260728;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let k = 0; k < 3000; k++) {
      let t = "";
      const len = 3 + Math.floor(rnd() * 20);
      for (let j = 0; j < len; j++) t += toks[Math.floor(rnd() * toks.length)];
      assert.deepEqual(blankTestModule(t, "u32"), before.blankTestModule(t, "u32"), `Rust fuzz drift on ${JSON.stringify(t)}`);
    }
  }
);

test("freeze: the Go and TypeScript locators read the same bytes as before the Python fields existed", () => {
  // Their profiles do not set hashComments, tripleQuotedStrings or
  // fStringInterpolation, so `//` is still a comment for them and `#` is not.
  const goText = 'func TestA(t *testing.T) {\n\twant := 7 // # not a python comment\n\tgot := f()\n}';
  assert.deepEqual(goExpectedValueSpans(goText).map((s) => goText.slice(s.start, s.end)), ["7"]);
  const goHash = 'func TestB(t *testing.T) {\n\twant := "#hash"\n}';
  assert.deepEqual(goExpectedValueSpans(goHash).map((s) => goHash.slice(s.start, s.end)), ['"#hash"']);
  const tsText = "it('x', () => { expect(f()).toBe(7); }); // # trailing";
  assert.deepEqual(tsExpectedValueSpans(tsText).map((s) => tsText.slice(s.start, s.end)), ["7"]);
  const tsHash = "it('x', () => { expect(f()).toBe('#7'); });";
  assert.deepEqual(tsExpectedValueSpans(tsHash).map((s) => tsHash.slice(s.start, s.end)), ["'#7'"]);
});

// ===========================================================================
// 13. The corpus: the classifier over mcp-graph-engine/src
// ===========================================================================

function corpusFunctions() {
  const script = path.join(scratch, "extract.py");
  fs.writeFileSync(
    script,
    [
      "import ast, json, os, sys",
      "root = sys.argv[1]",
      "out = []",
      "files = []",
      "for dirpath, dirnames, filenames in os.walk(root):",
      "    dirnames[:] = [d for d in dirnames if d not in ('__pycache__', 'tests') and not d.endswith('.egg-info')]",
      "    files += [os.path.join(dirpath, f) for f in sorted(filenames) if f.endswith('.py')]",
      "for path in files:",
      "    src = open(path, encoding='utf-8').read()",
      "    lines = src.split('\\n')",
      "    def visit(node):",
      "        for child in ast.iter_child_nodes(node):",
      "            if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef)):",
      "                sig = ' '.join('\\n'.join(lines[child.lineno - 1:child.body[0].lineno - 1]).split())",
      "                out.append({'file': os.path.relpath(path, root), 'name': child.name, 'signature': sig, 'doc': ast.get_docstring(child) or ''})",
      "                visit(child)",
      // A def does not only sit under a module, a class or another def. Recursing
      // through those three alone MISSED `graph_mutation_callback` at
      // session.py:41, which sits under a module-level `if`, and pinned the corpus
      // at 88 when it is 89. A harness that under-counts the corpus quietly
      // shrinks the bar the classifier is measured against.
      "            elif isinstance(child, (ast.ClassDef, ast.If, ast.Try, ast.With, ast.AsyncWith)):",
      "                visit(child)",
      "    visit(ast.parse(src))",
      "print(json.dumps(out))",
      "",
    ].join("\n")
  );
  return JSON.parse(execFileSync(corpusPython, ["-B", script, path.join(CORPUS, "src")], { encoding: "utf8", maxBuffer: 1 << 26 }));
}

test(
  "corpus: mcp-graph-engine/src refuses 82 of 89 and the seven survivors are the measured ones",
  { skip: corpusPython === undefined ? "mcp-graph-engine not present" : false },
  () => {
    const fns = corpusFunctions();
    const counts = {};
    const survivors = [];
    for (const fn of fns) {
      const v = classifyPyTestability(fn.signature, fn.doc);
      const key = v.testable ? "testable" : v.reason;
      counts[key] = (counts[key] ?? 0) + 1;
      if (v.testable) survivors.push(fn.name);
    }
    // The scout measured 89 functions / 7 survivors. This harness pinned 88 until
    // its extractor learned to walk into an `if`; the one it missed is
    // `graph_mutation_callback` at session.py:41 and it classifies underspecified.
    assert.equal(fns.length, 89, `corpus size moved: ${fns.length}`);
    assert.deepEqual(counts, { "needs-fixture": 64, async: 14, testable: 7, underspecified: 4 });
    assert.equal(counts.io ?? 0, 0, "a FALSE zero: the classifier reads signatures, not bodies");
    assert.equal(counts["not-exported"] ?? 0, 0, "and it must stay 0 forever - Python has no privacy");
    assert.deepEqual(survivors.sort(), [
      "_is_port_available",
      "execute_cypher_query",
      "parse_ask_query",
      "parse_knowledge_dsl",
      "parse_mermaid",
      "preprocess_cypher",
      "remove_comments",
    ]);

    // Every corpus signature through returnTypeOf: not one may keep the colon.
    for (const fn of fns) {
      const rt = pyReturnTypeOf(fn.signature);
      assert.ok(rt === undefined || !/[:{]\s*$/.test(rt), `${fn.name}: returnTypeOf kept punctuation -> ${JSON.stringify(rt)}`);
    }
  }
);

test(
  "LIVE: the whole chain on the real corpus - placement, a PROVEN import, the command, and a real red then green",
  { skip: corpusPython === undefined ? "mcp-graph-engine not present" : false },
  () => {
    const source = path.join(CORPUS, "src", "mcp_graph_engine", "cypher.py");
    const before = fs.readFileSync(path.join(CORPUS, "tests", "test_cypher.py"), "utf8");

    // Placement against the REAL repo, with the REAL deps: real filesystem, real
    // interpreter, real import proof.
    const p = okPlacement(py().placementFor(source, "preprocess_cypher", {}));
    assert.equal(p.targetPath, path.join(CORPUS, "tests", "test_cypher.py"), "testpaths = ['tests'] is honoured on the real project");
    assert.equal(p.exists, true);
    assert.equal(p.runRoot, CORPUS);
    assert.equal(p.importLine, "from mcp_graph_engine.cypher import preprocess_cypher", "where = ['src'] is honoured: not src.mcp_graph_engine");
    assert.equal(p.interpreter, CORPUS_PY);
    assert.equal(frameworkFor(py(), p.runRoot, {}).framework.id, "pytest");

    // And the same derivation for a module that is NOT installed refuses.
    const bad = py().placementFor(path.join(CORPUS, "src", "not_a_package", "atlas.py"), "widen", {});
    assert.equal(bad.ok, false);
    assert.equal(bad.refusal.reason, "unresolvable-import");

    // The run happens from a scratchpad root because the corpus is read-only. The
    // corpus package is installed editable in that venv, so the import reaches the
    // REAL source either way.
    const root = path.join(scratch, "e2e");
    fs.mkdirSync(path.join(root, "tests"), { recursive: true });
    fs.writeFileSync(path.join(root, "pyproject.toml"), '[tool.pytest.ini_options]\ntestpaths = ["tests"]\n');
    const runPlacement = { ...p, targetPath: path.join(root, "tests", "test_cypher.py"), exists: false, runRoot: root };

    const query = "MATCH (n) WHERE n.name = 'x' RETURN n";
    const right = `('MATCH (n) WHERE n.name = "x" RETURN n', ["single quotes → double quotes"])`;
    for (const [expected, wantPassed, wantFailed] of [["(\"nope\", [])", 0, 1], [right, 1, 0]]) {
      const tests = `def test_preprocess_cypher_rewrites_quotes():\n    assert preprocess_cypher(${JSON.stringify(query)}) == ${expected}\n`;
      const written = py().scaffold({ existingText: "", generatedTests: tests, markerId: "c1", placement: runPlacement });
      fs.writeFileSync(runPlacement.targetPath, written.text);
      const names = py().generatedTestNames(written.text, "c1");
      assert.deepEqual(names, ["test_preprocess_cypher_rewrites_quotes"]);
      const cmd = pytest().buildCommand(runPlacement, names);
      fs.rmSync(cmd.outputFile, { force: true });
      const run = spawnSync(cmd.command, cmd.args, { cwd: cmd.cwd, encoding: "utf8" });
      const parse = pytest().parseOutput(fs.readFileSync(cmd.outputFile, "utf8"), run.stderr, run.status);
      assert.equal(parse.passed, wantPassed, `expected ${wantPassed} passed for ${expected}`);
      assert.equal(parse.failed, wantFailed);
      assert.equal(parse.ran, true);
      assert.equal(parse.environmentError, undefined, "the derived import really did resolve against the real package");
      assert.equal(parse.filterMatchedNothing, undefined);
    }

    // Nothing was written into the corpus.
    assert.equal(fs.readFileSync(path.join(CORPUS, "tests", "test_cypher.py"), "utf8"), before);
    assert.equal(spawnSync("git", ["status", "--porcelain"], { cwd: CORPUS, encoding: "utf8" }).stdout.trim(), "", "the corpus repo must be clean");
  }
);
