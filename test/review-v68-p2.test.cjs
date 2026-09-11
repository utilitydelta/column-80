// ADVERSARIAL REVIEW evidence for session-v68 phase 2, the table-aware
// expected-value locator [session-v68/contracts/P2-locator.md].
//
// Every row here is a DEFECT CLAIM with a runnable input. A row that passes
// today is a defect that has been fixed; a row that fails is the finding. The
// review report names these test titles as its evidence.
//
// Surface is the same public seam the blind oracle uses - `tddLangFor` to
// resolve the language, its `frameworks` to resolve the framework,
// `TestFramework.expectedValueSpans` / `unresolvedAssertions` off that, and
// `blankExpectedValues` for the end-to-end artefact. The BARE inline locators
// are imported alongside so a "no table found means no behaviour change"
// regression can be shown as a difference rather than asserted from memory.
//
// Run: SKIP_LIVE=1 node --test test/review-v68-p2.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

let mod = {};
let cleanup = () => {};
let bundleError;
try {
  ({ mod, cleanup } = bundleCore(
    "review-v68-p2",
    `export { tddLangFor, blankExpectedValues } from "../src/core/tddLang";\n` +
      `export { rustExpectedValueSpans, rustUnresolvedAssertions } from "../src/core/testAssembly";\n` +
      `export { pytestExpectedValueSpans, unittestExpectedValueSpans } from "../src/core/tddPy";\n` +
      `export { goUnresolvedAssertions } from "../src/core/tddGo";\n`
  ));
} catch (e) {
  bundleError = e;
}
test.after(() => cleanup());

const { tddLangFor, blankExpectedValues } = mod;

const gtest = (name, fn) =>
  test(name, (ctx) => {
    if (bundleError) return ctx.skip(`bundle failed to build: ${bundleError}`);
    return fn(ctx);
  });

function frameworkOf(languageId, frameworkId) {
  const lang = tddLangFor(languageId);
  assert.ok(lang, `no TddLang for ${languageId}`);
  const framework = lang.frameworks.find((f) => f.id === frameworkId);
  assert.ok(framework, `no framework ${frameworkId} in ${languageId}`);
  return { lang, framework };
}

/** The located spans as TEXT, which is what every claim below is about. No
 *  byte offset in this file is written by hand. */
function located(languageId, frameworkId, text) {
  const { framework } = frameworkOf(languageId, frameworkId);
  return {
    texts: framework.expectedValueSpans(text).map((s) => text.slice(s.start, s.end)),
    spans: framework.expectedValueSpans(text),
    unresolved: framework.unresolvedAssertions ? framework.unresolvedAssertions(text) : 0,
  };
}

test("bundle: the P2 review surface builds", () => {
  assert.strictEqual(bundleError, undefined, `bundle failed: ${bundleError}`);
  assert.strictEqual(typeof tddLangFor, "function");
  assert.strictEqual(typeof blankExpectedValues, "function");
});

// ===========================================================================
// F1 (CRITICAL). The inversion survives on `it.each` with OBJECT rows.
//
// The TS/JS table clause (`TS_FAMILY_TABLE_SHAPE`, src/core/prompt.ts) is the
// only one of the five that does NOT name the expected column `want` - Go,
// Python and all three C# clauses do. So a vitest/jest reply is free to call it
// `out`, and object rows are a first-class `it.each` idiom (they are what makes
// the `$a` title interpolation work). `rowsFromList` demands every row open with
// `[`, so the table is not parsed; `arrowParamNames` maps a destructured
// `({ a, b, out })` parameter to no knob at all; `out` is in neither closed set,
// so it is not a row reference. Result: the runner's read of the row is the ONLY
// hole, the model's guessed rows survive untouched, and `unresolvedAssertions`
// is ZERO so the all-or-nothing floor passes it.
//
// Contract rule 11 ("ZERO spans over the runner's assertion") and the danger
// this phase exists to close.
// ===========================================================================

const TS_OBJECT_ROWS = `it.each([
  { a: 1, b: 2, out: 3 },
  { a: 4, b: 5, out: 9 },
])('add($a,$b)', ({ a, b, out }) => {
  expect(add(a, b)).toBe(out);
});
`;

gtest("F1 vitest: it.each with object rows blanks the runner's row read, not the rows [P2 rule 11]", () => {
  const r = located("typescript", "vitest", TS_OBJECT_ROWS);
  assert.deepStrictEqual(
    r.texts.filter((t) => t === "out"),
    [],
    `a span covers the runner's binding \`out\`, which is the inverted invariant; located ${JSON.stringify(r.texts)}`
  );
});

gtest("F1 vitest: object-row table yields one span PER ROW [P2 rule 10]", () => {
  const r = located("typescript", "vitest", TS_OBJECT_ROWS);
  assert.deepStrictEqual(r.texts, ["3", "9"], `expected the two row values, got ${JSON.stringify(r.texts)}`);
});

gtest("F1 vitest: an unparsed object-row table must refuse, not blank silently [P2 rule 3]", () => {
  const r = located("typescript", "vitest", TS_OBJECT_ROWS);
  if (r.texts.length === 0) {
    assert.ok(r.unresolved > 0, "zero spans with a zero floor is silence, not a refusal");
    return;
  }
  assert.deepStrictEqual(r.texts, ["3", "9"], `neither correct rows nor a refusal: ${JSON.stringify(r.texts)}`);
});

gtest("F1 jest: the same reply inverts on jest too [P2 rule 11]", () => {
  const r = located("typescript", "jest", TS_OBJECT_ROWS);
  assert.ok(!r.texts.includes("out"), `jest blanks the runner's binding too; located ${JSON.stringify(r.texts)}`);
});

gtest("F1 end to end: the artefact keeps the model's guesses and holes the runner [P2 rule 15]", () => {
  const { lang, framework } = frameworkOf("typescript", "vitest");
  const r = blankExpectedValues(lang, framework, TS_OBJECT_ROWS, "number");
  assert.ok(
    !/toBe\(\$\{\d+/.test(r.snippet),
    `the runner's matcher argument became a hole while rows 3 and 9 shipped as guesses:\n${r.snippet}`
  );
});

// ===========================================================================
// F2 (HIGH). A plain array-of-tuples FIXTURE is parsed as a case table.
//
// `rowsFromList` accepts any list whose every element is a bracketed group of
// two or more columns. `let pairs = [(1, 2), (3, 4)];` is exactly that, and it
// is ordinary INPUT DATA, not a table. The last element of each pair becomes a
// hole, so the human is asked to type into the test's inputs. The bare inline
// locator gets this right and returns the one real expected value.
//
// Contract rule 7 ("no table found means no behaviour change") and rule 15.
// ===========================================================================

const RUST_DATA_FIXTURE = `#[test]
fn sums_pairs() {
    let pairs = [(1, 2), (3, 4)];
    assert_eq!(sum(&pairs), 10);
}
`;

gtest("F2 libtest: an input-data array of tuples is blanked as if it were a table [P2 rule 7]", () => {
  const r = located("rust", "libtest", RUST_DATA_FIXTURE);
  assert.deepStrictEqual(
    r.texts,
    ["10"],
    `only the real expected value may be a hole; the second element of each INPUT pair was blanked too: ${JSON.stringify(r.texts)}`
  );
});

gtest("F2 libtest: the table-aware locator must match the bare one when there is no table [P2 rule 7]", () => {
  const { framework } = frameworkOf("rust", "libtest");
  const bare = mod.rustExpectedValueSpans(RUST_DATA_FIXTURE);
  assert.deepStrictEqual(
    framework.expectedValueSpans(RUST_DATA_FIXTURE),
    bare,
    "byte-identical was the promise for a reply with no table in it"
  );
});

const PY_DATA_FIXTURE = `def test_merge():
    pairs = [(1, 2), (3, 4)]
    assert merge(pairs) == 10
`;

gtest("F2 pytest: the same input-data fixture is blanked as a table [P2 rule 7]", () => {
  const r = located("python", "pytest", PY_DATA_FIXTURE);
  assert.deepStrictEqual(r.texts, ["10"], `input data was blanked: ${JSON.stringify(r.texts)}`);
});

const PY_UNITTEST_DATA_FIXTURE = `class TestMerge(unittest.TestCase):
    def test_merge(self):
        pairs = [(1, 2), (3, 4)]
        self.assertEqual(merge(pairs), 10)
`;

gtest("F2 unittest: and on the unittest leg [P2 rule 7]", () => {
  const r = located("python", "unittest", PY_UNITTEST_DATA_FIXTURE);
  assert.deepStrictEqual(r.texts, ["10"], `input data was blanked: ${JSON.stringify(r.texts)}`);
});

gtest("F2 end to end: the snippet asks the human to type into the test's inputs [P2 rule 15]", () => {
  const { lang, framework } = frameworkOf("rust", "libtest");
  const r = blankExpectedValues(lang, framework, RUST_DATA_FIXTURE, "i32");
  assert.strictEqual(r.holes, 1, `three holes for one expected value:\n${r.snippet}`);
});

// ===========================================================================
// F3 (HIGH). `LITERAL_NAMES` is tested BEFORE the declared knobs, so a table
// that declares a column named `default` or `string` has its runner's read of
// that column blanked. Contract rule 2 makes a DECLARED COLUMN a reference
// unconditionally; rule 4's literal list is `None null nil undefined true false
// NaN` and names neither `string` nor `default`.
// ===========================================================================

const PY_KNOB_NAMED_DEFAULT = `@pytest.mark.parametrize("a,default", [(1, 2), (3, 4)])
def test_lookup(a, default):
    assert lookup(a) == default
`;

gtest("F3 pytest: a declared column named `default` is blanked in the runner [P2 rule 2]", () => {
  const r = located("python", "pytest", PY_KNOB_NAMED_DEFAULT);
  assert.deepStrictEqual(
    r.texts,
    ["2", "4"],
    `\`default\` is a declared column of the parsed table and must never be blanked: ${JSON.stringify(r.texts)}`
  );
});

// ===========================================================================
// F4 (MEDIUM). `isRowReference` requires a bare identifier or a dotted path, so
// any other spelling of a row read is blanked alongside the correct row spans.
// Two reachable spellings:
//
//   Rust  `for (a, b, want) in cases.iter()` binds by REFERENCE, so the loop
//         body reads `*want` - idiomatic, and not an identifier.
//   TS    a `function` callback rather than an arrow yields NO knobs from
//         `arrowParamNames`, which only reads a `(`-headed element.
// ===========================================================================

const RUST_DEREF_RUNNER = `#[test]
fn add_cases() {
    let cases = [(1, 2, 3), (4, 5, 9)];
    for (a, b, want) in cases.iter() {
        assert_eq!(add(*a, *b), *want);
    }
}
`;

gtest("F4 libtest: `*want` in the runner is blanked as a fourth hole [P2 rule 11]", () => {
  const r = located("rust", "libtest", RUST_DEREF_RUNNER);
  assert.deepStrictEqual(
    r.texts,
    ["3", "9"],
    `the runner's dereferenced row read became a hole: ${JSON.stringify(r.texts)}`
  );
});

const TS_FUNCTION_CALLBACK = `it.each([
  [1, 2, 3],
  [4, 5, 9],
])('add', function (a, b, result) {
  expect(add(a, b)).toBe(result);
});
`;

gtest("F4 vitest: a `function` callback loses its knobs and the runner is blanked [P2 rule 11]", () => {
  const r = located("typescript", "vitest", TS_FUNCTION_CALLBACK);
  assert.deepStrictEqual(
    r.texts,
    ["3", "9"],
    `the callback's parameter \`result\` became a hole: ${JSON.stringify(r.texts)}`
  );
});

// ===========================================================================
// F5 (LOW). `goTableAwareUnresolved` re-asks the body rule against the MERGED
// spans. When the table is declared at FILE scope its row spans sit outside
// every test body, and a body whose only inline span was a dropped row
// reference now reads as unresolved - so the floor refuses a pass whose rows
// were blanked perfectly. The shipped `goUnresolvedAssertions` returns 0 here.
// ===========================================================================

const GO_PACKAGE_LEVEL_TABLE = `var cases = []struct{ a, b, want int }{ {1, 2, 3}, {4, 5, 9} }

func TestAdd(t *testing.T) {
	for _, tt := range cases {
		got := Add(tt.a, tt.b)
		want := tt.want
		if got != want {
			t.Errorf("Add() = %v, want %v", got, want)
		}
	}
}
`;

gtest("F5 gotest: a file-scope table makes a correctly blanked pass refuse [P2 rule 3]", () => {
  const r = located("go", "gotest", GO_PACKAGE_LEVEL_TABLE);
  assert.deepStrictEqual(r.texts, ["3", "9"], "the rows should be the holes");
  assert.strictEqual(
    r.unresolved,
    0,
    `both rows are blanked, so the floor has nothing to refuse; the shipped counter says ${mod.goUnresolvedAssertions(GO_PACKAGE_LEVEL_TABLE)}`
  );
});

// ===========================================================================
// F6 (LOW). `CONVENTIONAL_ROW_NAMES` holds `c`, `cs`, `row`, `tc` and `case`.
// With no table in the reply those names turn a working inline blank into a
// refusal. The prompt does tell the model never to pull an expected value from
// a shared variable, so this is a priced trade rather than an inversion - but
// it IS a behaviour change on a reply with no table in it, which rule 7 says
// there should not be.
// ===========================================================================

const RUST_CONST_NAMED_C = `#[test]
fn t() {
    let c = 3;
    assert_eq!(add(1, 2), c);
}
`;

gtest("F6 libtest: a local named `c` degrades a working blank into a refusal [P2 rule 7]", () => {
  const { framework } = frameworkOf("rust", "libtest");
  assert.deepStrictEqual(
    framework.expectedValueSpans(RUST_CONST_NAMED_C),
    mod.rustExpectedValueSpans(RUST_CONST_NAMED_C),
    "no table in this reply, so the locator was promised byte-identical output"
  );
});

// ===========================================================================
// WHERE THE ATTACK FOUND NOTHING. These rows pass today and are kept so a later
// change cannot quietly break what phase 2 got right.
// ===========================================================================

const HAPPY = [
  ["rust", "libtest", `#[test]
fn add_cases() {
    let cases = [(1, 2, 3), (4, 5, 9)];
    for (a, b, want) in cases {
        assert_eq!(add(a, b), want);
    }
}
`],
  ["go", "gotest", `func TestAdd(t *testing.T) {
	cases := []struct {
		name string
		a, b int
		want int
	}{
		{"one", 1, 2, 3},
		{"two", 4, 5, 9},
	}
	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			got := Add(tt.a, tt.b)
			if got != tt.want {
				t.Errorf("Add() = %v, want %v", got, tt.want)
			}
		})
	}
}
`],
  ["typescript", "vitest", `it.each([
  ['adds', 1, 2, 3],
  ['more', 4, 5, 9],
])('%s', (label, a, b, want) => {
  expect(add(a, b)).toBe(want);
});
`],
  ["typescript", "jest", `it.each([
  ['adds', 1, 2, 3],
  ['more', 4, 5, 9],
])('%s', (label, a, b, want) => {
  expect(add(a, b)).toBe(want);
});
`],
  ["python", "pytest", `@pytest.mark.parametrize("a,b,want", [
    (1, 2, 3),
    (4, 5, 9),
])
def test_add(a, b, want):
    assert add(a, b) == want
`],
  ["python", "unittest", `class TestAdd(unittest.TestCase):
    def test_add(self):
        cases = [
            (1, 2, 3),
            (4, 5, 9),
        ]
        for a, b, want in cases:
            with self.subTest(a=a, b=b):
                self.assertEqual(add(a, b), want)
`],
  ["csharp", "mstest", `[DataTestMethod]
[DataRow(1, 2, 3)]
[DataRow(4, 5, 9)]
public void AddCases(int a, int b, int want) { Assert.AreEqual(want, Add(a, b)); }
`],
  ["csharp", "xunit", `[Theory]
[InlineData(1, 2, 3)]
[InlineData(4, 5, 9)]
public void AddCases(int a, int b, int want) { Assert.Equal(want, Add(a, b)); }
`],
  ["csharp", "nunit", `[TestCase(1, 2, 3)]
[TestCase(4, 5, 9)]
public void AddCases(int a, int b, int want) { Assert.That(Add(a, b), Is.EqualTo(want)); }
`],
];

for (const [languageId, frameworkId, text] of HAPPY) {
  gtest(`clean: ${frameworkId} table yields one span per row and none over the runner [P2 rules 10+11]`, () => {
    const r = located(languageId, frameworkId, text);
    assert.deepStrictEqual(r.texts, ["3", "9"]);
    assert.strictEqual(r.unresolved, 0);
  });
}

const AWKWARD = [
  ["nested last column", "rust", "libtest", `#[test]
fn t() {
    let cases = [(1, [(2, 3)]), (4, [(5, 6)])];
    for (a, want) in cases { assert_eq!(f(a), want); }
}
`],
  ["two tables in one reply", "rust", "libtest", `#[test]
fn t1() { let cases = [(1, 2), (3, 4)]; for (a, want) in cases { assert_eq!(f(a), want); } }
#[test]
fn t2() { let cases = [(5, 6), (7, 8)]; for (a, want) in cases { assert_eq!(f(a), want); } }
`],
  ["a table inside a string", "rust", "libtest", `#[test]
fn t() { assert_eq!(parse("let cases = [(1,2),(3,4)];"), 7); }
`],
  ["a table inside a comment", "rust", "libtest", `#[test]
fn t() {
    // let cases = [(1,2),(3,4)];
    assert_eq!(f(1), 7);
}
`],
  ["an unbalanced table", "rust", "libtest", `let cases = [(1, 2), (3, 4);
assert_eq!(f(1), 2);
`],
  ["a C# run then a single case", "csharp", "mstest", `[DataTestMethod]
[DataRow(1, 2, 3)]
[DataRow(4, 5, 9)]
public void Cases(int a, int b, int want) { Assert.AreEqual(want, Add(a, b)); }

[TestMethod]
public void Zero() { Assert.AreEqual(0, Add(0, 0)); }
`],
  ["a C# single case then a run", "csharp", "mstest", `[TestMethod]
public void Zero() { Assert.AreEqual(0, Add(0, 0)); }

[DataTestMethod]
[DataRow(1, 2, 3)]
[DataRow(4, 5, 9)]
public void Cases(int a, int b, int want) { Assert.AreEqual(want, Add(a, b)); }
`],
  ["a C# row carrying a constructed array", "csharp", "xunit", `[Theory]
[InlineData(new[]{1,2}, 3)]
[InlineData(new[]{4,5}, 9)]
public void Cases(int[] a, int want) { Assert.Equal(want, Sum(a)); }
`],
  ["a Go keyed row with want not last", "go", "gotest", `func TestAdd(t *testing.T) {
	cases := []struct{ name string; a int; want int }{
		{name: "one", want: 3, a: 1},
		{name: "two", want: 9, a: 4},
	}
	for _, tt := range cases { if Add(tt.a) != tt.want { t.Errorf("x") } }
}
`],
  ["a Go table plus a separate single-case fn", "go", "gotest", `func TestAdd(t *testing.T) {
	cases := []struct{ a, b, want int }{ {1,2,3}, {4,5,9} }
	for _, tt := range cases { if Add(tt.a, tt.b) != tt.want { t.Errorf("x") } }
}

func TestZero(t *testing.T) {
	got := Add(0, 0)
	want := 0
	if got != want { t.Errorf("x") }
}
`],
];

for (const [label, languageId, frameworkId, text] of AWKWARD) {
  gtest(`clean: spans stay ascending and non-overlapping - ${label} [P2 rules 6+13]`, () => {
    const r = located(languageId, frameworkId, text);
    for (let k = 1; k < r.spans.length; k++) {
      assert.ok(
        r.spans[k].start >= r.spans[k - 1].end,
        `overlapping or descending pair at ${k}: ${JSON.stringify(r.spans)}`
      );
    }
    for (const s of r.spans) {
      assert.ok(s.start >= 0 && s.end <= text.length && s.end >= s.start, `span out of range: ${JSON.stringify(s)}`);
    }
  });
}

// Rule 9: pure and total, on every truncation of every fixture and on garbage.
gtest("clean: never throws and is pure, on every 10-byte truncation of every fixture [P2 rule 9]", () => {
  const corpus = [
    ...HAPPY.map((h) => h[2]),
    ...AWKWARD.map((a) => a[3]),
    TS_OBJECT_ROWS,
    RUST_DATA_FIXTURE,
    PY_KNOB_NAMED_DEFAULT,
    GO_PACKAGE_LEVEL_TABLE,
    `"unterminated string [(1,2),(3,4)]`,
    `/* unterminated comment [(1,2),(3,4)]`,
    `'''unterminated docstring [(1,2),(3,4)]`,
    "`unterminated template [[1,2],[3,4]]",
    "[".repeat(4000),
    "[[[[".repeat(1000),
    "",
    " ",
  ];
  const frameworks = [
    ["rust", "libtest"],
    ["go", "gotest"],
    ["typescript", "vitest"],
    ["typescript", "jest"],
    ["python", "pytest"],
    ["python", "unittest"],
    ["csharp", "mstest"],
    ["csharp", "xunit"],
    ["csharp", "nunit"],
  ];
  for (const [languageId, frameworkId] of frameworks) {
    const { framework } = frameworkOf(languageId, frameworkId);
    for (const fixture of corpus) {
      for (let cut = 0; cut <= fixture.length; cut += 10) {
        const t = fixture.slice(0, cut);
        let first;
        try {
          first = framework.expectedValueSpans(t);
          framework.unresolvedAssertions(t);
        } catch (e) {
          assert.fail(`${frameworkId} threw on ${JSON.stringify(t.slice(0, 60))}: ${e.message}`);
        }
        const second = framework.expectedValueSpans(t);
        assert.deepStrictEqual(second, first, `${frameworkId} is not pure on ${JSON.stringify(t.slice(0, 60))}`);
      }
    }
  }
});

// Rule 15, the readable end: every happy-path artefact numbers its tabstops
// sequentially and uniquely, and leaves the runner alone.
gtest("clean: the happy-path artefact numbers tabstops sequentially and uniquely [P2 rule 15]", () => {
  for (const [languageId, frameworkId, text] of HAPPY) {
    const { lang, framework } = frameworkOf(languageId, frameworkId);
    const r = blankExpectedValues(lang, framework, text, languageId === "rust" ? "i32" : "int");
    const nums = [...r.snippet.matchAll(/\$\{(\d+)[:}]/g)].map((x) => Number(x[1]));
    assert.deepStrictEqual(new Set(nums).size, nums.length, `${frameworkId} repeated a tabstop number`);
    assert.deepStrictEqual(
      [...nums].sort((a, b) => a - b),
      Array.from({ length: nums.length }, (_, k) => k + 1),
      `${frameworkId} tabstops are not 1..n: ${JSON.stringify(nums)}`
    );
    assert.strictEqual(r.holes, 2, `${frameworkId} should hole exactly the two rows`);
    assert.strictEqual(r.unresolved, 0, `${frameworkId} should not refuse a clean table`);
  }
});
