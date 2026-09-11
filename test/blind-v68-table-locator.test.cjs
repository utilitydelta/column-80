// Blind oracle for session-v68 phase 2: the expected-value locator reads a
// TABLE row [session-v68/contracts/P2-locator.md]. Written from the contract
// alone, WITHOUT READING src/** - not one file, not one grep, not one peek at
// the bundled source text. A locator oracle that agreed with the locator would
// be worthless, so every assertion below is derived from the contract's
// numbered rules and properties and from nothing else.
//
// The assertions are on SPAN POSITIONS and on BLANKED OUTPUT, never on
// implementation internals. No expected byte offset in this file was computed
// by hand: every one comes from `text.indexOf(<the literal I placed there>)`,
// so a fixture edit cannot silently move a pin.
//
// Surface exercised, all through the public seam:
//   tddLangFor, frameworkFor, blankExpectedValues   ../src/core/tddLang
//   TestFramework.expectedValueSpans(text)          off the resolved framework
//   TestFramework.unresolvedAssertions(text)        off the resolved framework
// No per-framework locator is imported by name from its own module. Production
// reaches them through the seam, so the oracle does too.
//
// EXPECTED RED: phase 2 is not written. A failing `assert` here is a contract
// finding and is the point of the file. A bundling crash, or a TypeError on an
// export that should exist, would be a harness bug instead.
//
// Run: SKIP_LIVE=1 node --test test/blind-v68-table-locator.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const { bundleCore } = require("./.blind-util.cjs");

let mod = {};
let cleanup = () => {};
let bundleError;
try {
  ({ mod, cleanup } = bundleCore(
    "blind-v68-table-locator",
    `export { tddLangFor, frameworkFor, blankExpectedValues } from "../src/core/tddLang";\n`
  ));
} catch (e) {
  bundleError = e;
}
test.after(() => cleanup());

const { tddLangFor, frameworkFor, blankExpectedValues } = mod;

// Every row except the bundle row skips (not fails) while the bundle is broken,
// so a harness break stays ONE loud failure instead of a wall of TypeErrors.
const gtest = (name, fn) =>
  test(name, (ctx) => {
    if (bundleError) return ctx.skip("bundle failed to build; see the bundle test");
    return fn(ctx);
  });

test("bundle: the P2 surface builds and exports tddLangFor + frameworkFor + blankExpectedValues [P2 'Surface under contract']", () => {
  assert.strictEqual(
    bundleError,
    undefined,
    `the bundle failed, so every row below is a harness error rather than a contract finding: ${bundleError}`
  );
  assert.strictEqual(typeof tddLangFor, "function", "tddLangFor(languageId) => TddLang | undefined");
  assert.strictEqual(typeof frameworkFor, "function", "frameworkFor(lang, root, deps)");
  assert.strictEqual(
    typeof blankExpectedValues,
    "function",
    "blankExpectedValues(lang, framework, text, returnType, opts) => { snippet, holes, unresolved }"
  );
});

// ===========================================================================
// Framework resolution. Copied from blind-v68-table-instruction.test.cjs: the
// nine are reached through frameworkFor with an injected fake TddDeps, which is
// the path production takes. The registration array is the fallback ONLY so a
// detection wobble cannot mask the locator findings this file exists to make;
// one row below asserts frameworkFor itself reached all nine.
// ===========================================================================

const depsOf = (files, contents = {}, dirs = {}, extra = {}) => {
  const set = new Set(files.map((f) => path.normalize(f)));
  return {
    fileExists: (p) => set.has(path.normalize(p)) || dirs[path.normalize(p)] !== undefined,
    readFile: (p) => contents[path.normalize(p)],
    readDir: (p) => dirs[path.normalize(p)],
    log: () => {},
    ...extra,
  };
};

const PKG = (dev) => JSON.stringify({ devDependencies: dev, scripts: { test: "test" } });
const PYPROJECT_PYTEST = '[tool.pytest.ini_options]\ntestpaths = ["tests"]\n';
const CSPROJ = (pkg) =>
  [
    '<Project Sdk="Microsoft.NET.Sdk">',
    "  <PropertyGroup><IsTestProject>true</IsTestProject></PropertyGroup>",
    `  <ItemGroup><PackageReference Include="${pkg}" Version="1.0.0" /></ItemGroup>`,
    "</Project>",
  ].join("\n");

const csDeps = (pkg) =>
  depsOf(
    ["/repo/Acme.Tests/Acme.Tests.csproj"],
    { "/repo/Acme.Tests/Acme.Tests.csproj": CSPROJ(pkg) },
    { "/repo": ["Acme.Tests"], "/repo/Acme.Tests": ["Acme.Tests.csproj"], "/": ["repo"] }
  );

const REACHABLE = [
  ["rust", "libtest", "/w/crate", () => depsOf(["/w/crate/Cargo.toml", "/w/crate/src/lib.rs"])],
  ["go", "gotest", "/m", () => depsOf(["/m/go.mod"], { "/m/go.mod": "module m\n" })],
  [
    "typescript",
    "vitest",
    "/p",
    () => depsOf(["/p/package.json", "/p/node_modules/.bin/vitest"], { "/p/package.json": PKG({ vitest: "^4.1.7" }) }),
  ],
  [
    "typescript",
    "jest",
    "/p",
    () => depsOf(["/p/package.json", "/p/node_modules/.bin/jest"], { "/p/package.json": PKG({ jest: "^29.0.0" }) }),
  ],
  [
    "python",
    "pytest",
    "/p",
    () =>
      depsOf(
        ["/p/pyproject.toml", "/p/.venv/bin/python", "/p/.venv/bin/pytest", "/p/tests"],
        { "/p/pyproject.toml": PYPROJECT_PYTEST },
        {},
        { probe: () => ({ exitCode: 0 }) }
      ),
  ],
  ["python", "unittest", "/nowhere", () => depsOf([], {}, {}, { probe: () => ({ exitCode: 1 }) })],
  ["csharp", "mstest", "/repo/Acme.Tests", () => csDeps("MSTest.TestFramework")],
  ["csharp", "xunit", "/repo/Acme.Tests", () => csDeps("xunit.v3")],
  ["csharp", "nunit", "/repo/Acme.Tests", () => csDeps("NUnit")],
];

// key -> { languageId, frameworkId, lang, fw, viaFrameworkFor }
const RESOLVED = new Map();
const KEYS = REACHABLE.map(([l, f]) => `${l}/${f}`);

function resolveAll() {
  if (RESOLVED.size || bundleError) return RESOLVED;
  for (const [languageId, frameworkId, root, mkDeps] of REACHABLE) {
    const lang = tddLangFor(languageId);
    let fw;
    let viaFrameworkFor = false;
    try {
      const res = frameworkFor(lang, root, mkDeps());
      if (res && res.ok && res.framework && res.framework.id === frameworkId) {
        fw = res.framework;
        viaFrameworkFor = true;
      }
    } catch {
      /* fall through to the registration array */
    }
    if (!fw && lang && Array.isArray(lang.frameworks)) fw = lang.frameworks.find((f) => f.id === frameworkId);
    RESOLVED.set(`${languageId}/${frameworkId}`, { languageId, frameworkId, lang, fw, viaFrameworkFor });
  }
  return RESOLVED;
}

const at = (key) => {
  const r = resolveAll().get(key);
  assert.ok(r && r.fw, `${key} did not resolve at all, so no locator row below can run`);
  return r;
};

const fwOf = (key) => at(key).fw;

gtest("[P2 'Surface under contract'] all nine frameworks resolve through frameworkFor, and each declares expectedValueSpans + unresolvedAssertions", () => {
  const bad = [];
  for (const key of KEYS) {
    const r = resolveAll().get(key);
    if (!r || !r.fw) bad.push(`${key}: did not resolve`);
    else if (!r.viaFrameworkFor) bad.push(`${key}: only reachable off the registration array, not through frameworkFor`);
    else if (typeof r.fw.expectedValueSpans !== "function") bad.push(`${key}: declares no expectedValueSpans`);
    else if (typeof r.fw.unresolvedAssertions !== "function") bad.push(`${key}: declares no unresolvedAssertions`);
  }
  assert.deepStrictEqual(bad, [], "the contract names nine registrations of expectedValueSpans:\n" + bad.join("\n"));
});

// ===========================================================================
// Span helpers. A locator failure that does not print the span TEXTS is a
// failure nobody can act on, so every message below carries them.
// ===========================================================================

const textsOf = (text, spans) => spans.map((s) => text.slice(s.start, s.end));

const show = (label, text, spans, why) =>
  `${label}: ${why}\n` +
  `  span texts: ${JSON.stringify(textsOf(text, spans))}\n` +
  `  span offsets: ${JSON.stringify(spans.map((s) => [s.start, s.end]))}\n` +
  `---- TEXT ----\n${text}\n---- END TEXT ----`;

// Never a hand-computed offset: the expected range is always looked up from the
// literal that was placed in the fixture.
function rangeOf(label, text, literal) {
  const start = text.indexOf(literal);
  assert.ok(start >= 0, `${label}: fixture bug, ${JSON.stringify(literal)} is not in the text`);
  assert.strictEqual(
    text.indexOf(literal, start + 1),
    -1,
    `${label}: fixture bug, ${JSON.stringify(literal)} occurs more than once so an offset pin would be ambiguous`
  );
  return { start, end: start + literal.length };
}

function assertAscending(label, text, spans) {
  assert.ok(Array.isArray(spans), show(label, text, spans || [], "expectedValueSpans did not return an array"));
  for (let i = 0; i < spans.length; i++) {
    const s = spans[i];
    assert.ok(
      Number.isInteger(s.start) && Number.isInteger(s.end) && s.start >= 0 && s.end <= text.length && s.start < s.end,
      show(label, text, spans, `span ${i} is not a valid non-empty range inside the text`)
    );
    if (i > 0) {
      assert.ok(
        spans[i - 1].end <= s.start,
        show(label, text, spans, `[P2 §6] spans ${i - 1} and ${i} descend or overlap; blankExpectedValues's slice loop corrupts the snippet on this`)
      );
    }
  }
}

// The runner's assertion is the line the loop body executes. No span may touch
// it: that is the inversion §"The danger this phase exists to close" names.
function assertRunnerUntouched(label, text, spans, runner) {
  const r = rangeOf(`${label} runner`, text, runner);
  for (const s of spans) {
    assert.ok(
      s.end <= r.start || s.start >= r.end,
      show(label, text, spans, `[P2 §11] a span lands on the RUNNER's assertion ${JSON.stringify(runner)}; that blanks the LOOP VARIABLE and ships every guessed row green`)
    );
  }
}

// ===========================================================================
// The table fixtures. One per framework, in the idiom P2's own shape table
// names. Three rows each; the last column is a literal unique within its
// fixture, so every pin resolves by indexOf.
// ===========================================================================

const RETURN_TYPE = { rust: "i32", go: "int", typescript: "number", python: "int", csharp: "int" };

const TABLES = {
  "rust/libtest": {
    lastCols: ["101", "202", "303"],
    runner: "assert_eq!(shard_of(key, buckets), want);",
    text: `#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shard_of_cases() {
        let cases = [
            ("alpha", 8, 101),
            ("beta", 16, 202),
            ("gamma", 32, 303),
        ];
        for (key, buckets, want) in cases {
            assert_eq!(shard_of(key, buckets), want);
        }
    }
}
`,
  },

  "go/gotest": {
    lastCols: ["101", "202", "303"],
    runner: "t.Errorf(\"ShardOf() = %v, want %v\", got, tt.want)",
    text: `func TestShardOf(t *testing.T) {
	cases := []struct {
		name    string
		key     string
		buckets int
		want    int
	}{
		{"alpha", "a", 8, 101},
		{"beta", "b", 16, 202},
		{"gamma", "g", 32, 303},
	}
	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			got := ShardOf(tt.key, tt.buckets)
			if got != tt.want {
				t.Errorf("ShardOf() = %v, want %v", got, tt.want)
			}
		})
	}
}
`,
  },

  "typescript/vitest": {
    lastCols: ["101", "202", "303"],
    runner: "expect(shardOf(key, buckets)).toBe(want);",
    text: `it.each([
  ["alpha", 8, 101],
  ["beta", 16, 202],
  ["gamma", 32, 303],
])("shardOf(%s, %i)", (key, buckets, want) => {
  expect(shardOf(key, buckets)).toBe(want);
});
`,
  },

  "typescript/jest": {
    lastCols: ["101", "202", "303"],
    runner: "expect(shardOf(key, buckets)).toBe(want);",
    text: `it.each([
  ["alpha", 8, 101],
  ["beta", 16, 202],
  ["gamma", 32, 303],
])("shardOf(%s, %i)", (key, buckets, want) => {
  expect(shardOf(key, buckets)).toBe(want);
});
`,
  },

  "python/pytest": {
    lastCols: ["101", "202", "303"],
    runner: "assert shard_of(key, buckets) == want",
    text: `@pytest.mark.parametrize("key,buckets,want", [
    ("alpha", 8, 101),
    ("beta", 16, 202),
    ("gamma", 32, 303),
])
def test_shard_of(key, buckets, want):
    assert shard_of(key, buckets) == want
`,
  },

  "python/unittest": {
    lastCols: ["101", "202", "303"],
    runner: "self.assertEqual(shard_of(key, buckets), want)",
    text: `class ShardOfTest(unittest.TestCase):
    def test_shard_of(self):
        cases = [
            ("alpha", 8, 101),
            ("beta", 16, 202),
            ("gamma", 32, 303),
        ]
        for key, buckets, want in cases:
            with self.subTest(key=key):
                self.assertEqual(shard_of(key, buckets), want)
`,
  },

  "csharp/mstest": {
    lastCols: ["101", "202", "303"],
    runner: "Assert.AreEqual(want, ShardOf(key, buckets));",
    text: `[DataTestMethod]
[DataRow("alpha", 8, 101)]
[DataRow("beta", 16, 202)]
[DataRow("gamma", 32, 303)]
public void ShardOfCases(string key, int buckets, int want)
{
    Assert.AreEqual(want, ShardOf(key, buckets));
}
`,
  },

  "csharp/xunit": {
    lastCols: ["101", "202", "303"],
    runner: "Assert.Equal(want, ShardOf(key, buckets));",
    text: `[Theory]
[InlineData("alpha", 8, 101)]
[InlineData("beta", 16, 202)]
[InlineData("gamma", 32, 303)]
public void ShardOfCases(string key, int buckets, int want)
{
    Assert.Equal(want, ShardOf(key, buckets));
}
`,
  },

  "csharp/nunit": {
    lastCols: ["101", "202", "303"],
    runner: "Assert.That(ShardOf(key, buckets), Is.EqualTo(want));",
    text: `[TestCase("alpha", 8, 101)]
[TestCase("beta", 16, 202)]
[TestCase("gamma", 32, 303)]
public void ShardOfCases(string key, int buckets, int want)
{
    Assert.That(ShardOf(key, buckets), Is.EqualTo(want));
}
`,
  },
};

// ===========================================================================
// §1 + §10 + §11. One span per row, covering exactly the last column, and
// nothing over the runner.
// ===========================================================================

for (const key of KEYS) {
  const f = TABLES[key];

  gtest(`[P2 §1 a table's expected column is a hole] ${key}: one span PER ROW, ${f.lastCols.length} rows, ${f.lastCols.length} spans`, () => {
    const spans = fwOf(key).expectedValueSpans(f.text);
    assert.strictEqual(
      spans.length,
      f.lastCols.length,
      show(key, f.text, spans, `expected one span per row (${f.lastCols.length}), got ${spans.length}`)
    );
  });

  gtest(`[P2 §10 each span covers exactly the last column] ${key}: span text equals the row's last column, byte for byte`, () => {
    const spans = fwOf(key).expectedValueSpans(f.text);
    const want = f.lastCols.map((lit) => rangeOf(key, f.text, lit));
    assert.deepStrictEqual(
      spans.map((s) => ({ start: s.start, end: s.end })),
      want,
      show(key, f.text, spans, `the spans are not exactly the three last columns ${JSON.stringify(f.lastCols)} at their indexOf positions`)
    );
    assert.deepStrictEqual(textsOf(f.text, spans), f.lastCols, show(key, f.text, spans, "span TEXTS are not the last columns"));
  });

  gtest(`[P2 §11 zero spans over the runner] ${key}: nothing is blanked in the loop body's assertion`, () => {
    const spans = fwOf(key).expectedValueSpans(f.text);
    assertRunnerUntouched(key, f.text, spans, f.runner);
  });

  gtest(`[P2 §6 ascending and non-overlapping] ${key}: the table reply's spans are strictly ordered`, () => {
    assertAscending(key, f.text, fwOf(key).expectedValueSpans(f.text));
  });

  gtest(`[P2 §3 a table WAS found, so nothing is unresolved] ${key}: unresolvedAssertions is 0 on a parsed table`, () => {
    const spans = fwOf(key).expectedValueSpans(f.text);
    const n = fwOf(key).unresolvedAssertions(f.text);
    assert.strictEqual(
      n,
      0,
      show(key, f.text, spans, `the table parsed (rule 3 only fires when NO table was detected) yet ${n} site(s) are reported unresolved, so a perfectly good pass is refused`)
    );
  });
}

// The two keyed/named forms the shape table calls out by name.

gtest("[P2 §1 the shape table, Go keyed literal] go/gotest: a KEYED composite literal blanks the `want:` field's value, not the last field written", () => {
  const text = `func TestShardOf(t *testing.T) {
	cases := []struct {
		key     string
		want    int
		buckets int
	}{
		{key: "alpha", want: 101, buckets: 8},
		{key: "beta", want: 202, buckets: 16},
	}
	for _, tt := range cases {
		if got := ShardOf(tt.key, tt.buckets); got != tt.want {
			t.Errorf("got %v want %v", got, tt.want)
		}
	}
}
`;
  const spans = fwOf("go/gotest").expectedValueSpans(text);
  assertAscending("go keyed", text, spans);
  assert.deepStrictEqual(
    textsOf(text, spans),
    ["101", "202"],
    show("go keyed", text, spans, "a keyed literal's expected column is the `want:` field's value; the last field WRITTEN here is `buckets`, which is an input")
  );
});

gtest("[P2 §1 the shape table, NUnit ExpectedResult] csharp/nunit: a named ExpectedResult carries the expected value, and the span is its VALUE", () => {
  const text = `[TestCase("alpha", 8, ExpectedResult = 101)]
[TestCase("beta", 16, ExpectedResult = 202)]
public int ShardOfCases(string key, int buckets)
{
    return ShardOf(key, buckets);
}
`;
  const spans = fwOf("csharp/nunit").expectedValueSpans(text);
  assertAscending("nunit ExpectedResult", text, spans);
  assert.deepStrictEqual(
    textsOf(text, spans),
    ["101", "202"],
    show("nunit ExpectedResult", text, spans, "the span must be the VALUE of ExpectedResult, not the whole `ExpectedResult = 101` and not the last positional argument `8`")
  );
});

// ===========================================================================
// §2 + §3. A row reference is not a hole; with no table it is UNRESOLVED.
// ===========================================================================

// Each of these is a runner with NO table literal the locator can parse: the
// model wrote a table this locator did not understand, or loaded rows from a
// helper. The shipped INLINE locator finds the loop variable here. It must not
// be blanked (rule 2), and the pass must be refused out loud (rule 3).
const ROW_REF_NO_TABLE = {
  "rust/libtest": {
    ref: "want",
    text: `#[test]
fn shard_of_cases() {
    for (key, buckets, want) in load_cases() {
        assert_eq!(shard_of(key, buckets), want);
    }
}
`,
  },
  "go/gotest": {
    ref: "tt.want",
    text: `func TestShardOf(t *testing.T) {
	for _, tt := range loadCases() {
		want := tt.want
		if got := ShardOf(tt.key, tt.buckets); got != want {
			t.Errorf("got %v", got)
		}
	}
}
`,
  },
  "typescript/vitest": {
    ref: "want",
    text: `it.each(loadCases())("shardOf", (key, buckets, want) => {
  expect(shardOf(key, buckets)).toBe(want);
});
`,
  },
  "typescript/jest": {
    ref: "c.expected",
    text: `for (const c of loadCases()) {
  it(c.name, () => {
    expect(shardOf(c.key, c.buckets)).toBe(c.expected);
  });
}
`,
  },
  "python/pytest": {
    ref: "want",
    text: `@pytest.mark.parametrize("key,buckets,want", load_cases())
def test_shard_of(key, buckets, want):
    assert shard_of(key, buckets) == want
`,
  },
  "python/unittest": {
    ref: "expected",
    text: `class ShardOfTest(unittest.TestCase):
    def test_shard_of(self):
        for key, buckets, expected in load_cases():
            with self.subTest(key=key):
                self.assertEqual(shard_of(key, buckets), expected)
`,
  },
  "csharp/mstest": {
    ref: "want",
    text: `[DataTestMethod]
[DynamicData(nameof(LoadCases), DynamicDataSourceType.Method)]
public void ShardOfCases(string key, int buckets, int want)
{
    Assert.AreEqual(want, ShardOf(key, buckets));
}
`,
  },
  "csharp/xunit": {
    ref: "want",
    text: `[Theory]
[MemberData(nameof(LoadCases))]
public void ShardOfCases(string key, int buckets, int want)
{
    Assert.Equal(want, ShardOf(key, buckets));
}
`,
  },
  "csharp/nunit": {
    ref: "row.Expected",
    text: `[TestCaseSource(nameof(LoadCases))]
public void ShardOfCases(Case row)
{
    Assert.That(ShardOf(row.Key, row.Buckets), Is.EqualTo(row.Expected));
}
`,
  },
};

for (const key of KEYS) {
  const f = ROW_REF_NO_TABLE[key];

  gtest(`[P2 §2 a row reference is not a hole] ${key}: ${JSON.stringify(f.ref)} is a reference INTO the table and is never blanked`, () => {
    const spans = fwOf(key).expectedValueSpans(f.text);
    const got = textsOf(f.text, spans);
    assert.deepStrictEqual(
      got,
      [],
      show(key, f.text, spans, `a span was emitted over a row reference; blanking it puts the hole where the expected value is NOT, and every guessed row ships green`)
    );
  });

  gtest(`[P2 §3 a row reference with no table is UNRESOLVED, not silence] ${key}: the whole pass is refused rather than half-blanked`, () => {
    const spans = fwOf(key).expectedValueSpans(f.text);
    const n = fwOf(key).unresolvedAssertions(f.text);
    assert.ok(
      n > 0,
      show(key, f.text, spans, `the locator dropped a row reference and found no table, yet reported ${n} unresolved. Silence here means the human gets a snippet whose rows are the model's guesses`)
    );
  });
}

// ===========================================================================
// §4. A dotted path is not automatically a reference.
// ===========================================================================

// INLINE assertions whose expected value is a legitimate dotted constant or a
// literal-ish bare name. Each of these is a value the human keeps, so each is
// a hole. Getting rule 2 too wide silently swallows them.
const LEGIT_VALUES = {
  "rust/libtest": {
    wants: ["true", "None"],
    text: `#[test]
fn edges() {
    assert_eq!(is_ready(), true);
    assert_eq!(find(1), None);
}
`,
  },
  "go/gotest": {
    wants: ["math.MaxInt32", "nil"],
    text: `func TestEdges(t *testing.T) {
	want := math.MaxInt32
	if got := Cap(); got != want {
		t.Errorf("cap")
	}
}

func TestMissing(t *testing.T) {
	want := nil
	if got := Find(1); got != want {
		t.Errorf("find")
	}
}
`,
  },
  "typescript/vitest": {
    wants: ["Number.MAX_SAFE_INTEGER", "undefined"],
    text: `it("caps", () => {
  expect(cap()).toBe(Number.MAX_SAFE_INTEGER);
});

it("misses", () => {
  expect(find(1)).toBe(undefined);
});
`,
  },
  "typescript/jest": {
    wants: ["Number.NaN", "null"],
    text: `it("nans", () => {
  expect(rate()).toBe(Number.NaN);
});

it("misses", () => {
  expect(find(1)).toBe(null);
});
`,
  },
  "python/pytest": {
    wants: ["math.inf", "None"],
    text: `def test_rate():
    assert rate() == math.inf


def test_missing():
    assert find(1) == None
`,
  },
  "python/unittest": {
    wants: ["math.inf", "None"],
    text: `class EdgeTest(unittest.TestCase):
    def test_rate(self):
        self.assertEqual(rate(), math.inf)

    def test_missing(self):
        self.assertEqual(find(1), None)
`,
  },
  "csharp/mstest": {
    wants: ["int.MaxValue", "null"],
    text: `[TestMethod]
public void Caps()
{
    Assert.AreEqual(int.MaxValue, Cap());
}

[TestMethod]
public void Misses()
{
    Assert.AreEqual(null, Find(1));
}
`,
  },
  "csharp/xunit": {
    wants: ["decimal.Zero", "null"],
    text: `[Fact]
public void Zeroes()
{
    Assert.Equal(decimal.Zero, Rate());
}

[Fact]
public void Misses()
{
    Assert.Equal(null, Find(1));
}
`,
  },
  "csharp/nunit": {
    wants: ["int.MaxValue", "null"],
    text: `[Test]
public void Caps()
{
    Assert.That(Cap(), Is.EqualTo(int.MaxValue));
}

[Test]
public void Misses()
{
    Assert.That(Find(1), Is.EqualTo(null));
}
`,
  },
};

for (const key of KEYS) {
  const f = LEGIT_VALUES[key];
  gtest(`[P2 §4 a dotted path is not automatically a reference] ${key}: ${JSON.stringify(f.wants)} are values the human keeps, so each is a hole`, () => {
    const spans = fwOf(key).expectedValueSpans(f.text);
    assertAscending(key, f.text, spans);
    assert.deepStrictEqual(
      textsOf(f.text, spans),
      f.wants,
      show(key, f.text, spans, "rule 2 was applied too widely and swallowed a legitimate expected value; only a ROOT segment in rule 2's set is a reference")
    );
  });

  gtest(`[P2 §4 a legitimate expected value is not UNRESOLVED either] ${key}: a fully located inline reply refuses nothing`, () => {
    const spans = fwOf(key).expectedValueSpans(f.text);
    const n = fwOf(key).unresolvedAssertions(f.text);
    assert.strictEqual(n, 0, show(key, f.text, spans, `both values were located, yet ${n} unresolved site(s) are reported, so a good pass is refused`));
  });
}

// ===========================================================================
// §7 (as a POSITIVE) + §5 + §12. Inline replies still work; a mixed reply
// yields both, ascending.
// ===========================================================================

// Rule 7 says a table-free reply behaves byte-identically to today. This file
// cannot diff against the old build, so it asserts the positive instead: each
// framework's SHIPPED inline idiom still yields one span per assertion, each
// covering the expected value.
const INLINE = {
  "rust/libtest": {
    wants: ["101", "202"],
    text: `#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shards_alpha() {
        assert_eq!(shard_of("alpha", 8), 101);
    }

    #[test]
    fn shards_beta() {
        assert_eq!(shard_of("beta", 16), 202);
    }
}
`,
  },
  "go/gotest": {
    wants: ["101", "202"],
    text: `func TestShardOfAlpha(t *testing.T) {
	want := 101
	if got := ShardOf("alpha", 8); got != want {
		t.Errorf("alpha")
	}
}

func TestShardOfBeta(t *testing.T) {
	want := 202
	if got := ShardOf("beta", 16); got != want {
		t.Errorf("beta")
	}
}
`,
  },
  "typescript/vitest": {
    wants: ["101", "202"],
    text: `it("shards alpha", () => {
  expect(shardOf("alpha", 8)).toBe(101);
});

it("shards beta", () => {
  expect(shardOf("beta", 16)).toBe(202);
});
`,
  },
  "typescript/jest": {
    wants: ["101", "202"],
    text: `it("shards alpha", () => {
  expect(shardOf("alpha", 8)).toBe(101);
});

it("shards beta", () => {
  expect(shardOf("beta", 16)).toBe(202);
});
`,
  },
  "python/pytest": {
    wants: ["101", "202"],
    text: `def test_shards_alpha():
    assert shard_of("alpha", 8) == 101


def test_shards_beta():
    assert shard_of("beta", 16) == 202
`,
  },
  "python/unittest": {
    wants: ["101", "202"],
    text: `class ShardOfTest(unittest.TestCase):
    def test_alpha(self):
        self.assertEqual(shard_of("alpha", 8), 101)

    def test_beta(self):
        self.assertEqual(shard_of("beta", 16), 202)
`,
  },
  "csharp/mstest": {
    wants: ["101", "202"],
    text: `[TestMethod]
public void ShardsAlpha()
{
    Assert.AreEqual(101, ShardOf("alpha", 8));
}

[TestMethod]
public void ShardsBeta()
{
    Assert.AreEqual(202, ShardOf("beta", 16));
}
`,
  },
  "csharp/xunit": {
    wants: ["101", "202"],
    text: `[Fact]
public void ShardsAlpha()
{
    Assert.Equal(101, ShardOf("alpha", 8));
}

[Fact]
public void ShardsBeta()
{
    Assert.Equal(202, ShardOf("beta", 16));
}
`,
  },
  "csharp/nunit": {
    wants: ["101", "202"],
    text: `[Test]
public void ShardsAlpha()
{
    Assert.That(ShardOf("alpha", 8), Is.EqualTo(101));
}

[Test]
public void ShardsBeta()
{
    Assert.That(ShardOf("beta", 16), Is.EqualTo(202));
}
`,
  },
};

for (const key of KEYS) {
  const f = INLINE[key];

  gtest(`[P2 §7 no table found means no behaviour change] ${key}: a purely INLINE reply still yields one span per assertion, each covering the expected value`, () => {
    const spans = fwOf(key).expectedValueSpans(f.text);
    assertAscending(key, f.text, spans);
    assert.deepStrictEqual(
      spans.map((s) => ({ start: s.start, end: s.end })),
      f.wants.map((lit) => rangeOf(key, f.text, lit)),
      show(key, f.text, spans, "the table work moved the inline locator; a table-free reply must behave exactly as it does today")
    );
  });

  gtest(`[P2 §7 no table found means no behaviour change] ${key}: an inline reply carrying no row reference reports nothing unresolved`, () => {
    const spans = fwOf(key).expectedValueSpans(f.text);
    const n = fwOf(key).unresolvedAssertions(f.text);
    assert.strictEqual(n, 0, show(key, f.text, spans, `rule 3 fired on a reply that has no row reference at all; ${n} unresolved reported`));
  });
}

for (const key of KEYS) {
  gtest(`[P2 §5 + §12 inline and table coexist] ${key}: a reply holding a table AND a separate single-case test yields BOTH, merged and ascending`, () => {
    const t = TABLES[key];
    const i = INLINE[key];
    // The single-case test carries a value that appears in neither half's rows,
    // so a missing merge is visible rather than inferred.
    const extra = i.text.replace(/101/g, "404").replace(/202/g, "505");
    const text = `${t.text}\n${extra}`;
    const spans = fwOf(key).expectedValueSpans(text);
    assertAscending(`${key} mixed`, text, spans);
    assert.deepStrictEqual(
      textsOf(text, spans),
      [...t.lastCols, "404", "505"],
      show(`${key} mixed`, text, spans, "the merge dropped one half; §5 requires the table's rows AND the separate test's expected values, in source order")
    );
    assertRunnerUntouched(`${key} mixed`, text, spans, t.runner);
  });
}

gtest("[P2 §5 inline and table coexist] rust/libtest: a #[should_panic] fn beside the table does not disturb the table's spans", () => {
  const t = TABLES["rust/libtest"];
  const text = `${t.text}
#[test]
#[should_panic]
fn rejects_zero_buckets() {
    shard_of("alpha", 0);
}
`;
  const spans = fwOf("rust/libtest").expectedValueSpans(text);
  assertAscending("rust should_panic", text, spans);
  assert.deepStrictEqual(
    textsOf(text, spans),
    t.lastCols,
    show("rust should_panic", text, spans, "a #[should_panic] fn asserts no value, so it contributes no span, and it must not perturb the table's three")
  );
});

// ===========================================================================
// §6. An inline candidate falling INSIDE a detected table's region is dropped.
// ===========================================================================

gtest("[P2 §6 an inline span inside a table region is dropped] python/pytest: a boolean input column containing `==` must not produce a second, overlapping span", () => {
  // The pytest inline locator keys on `... == <expr>`. A row carrying a boolean
  // input column puts a top-level `==` INSIDE the table region, which is the
  // one shape where the two readers genuinely collide.
  const text = `@pytest.mark.parametrize("flag,want", [
    (2 == 2, 101),
    (3 == 4, 202),
])
def test_flagged(flag, want):
    assert flagged(flag) == want
`;
  const spans = fwOf("python/pytest").expectedValueSpans(text);
  assertAscending("pytest == in row", text, spans);
  assert.deepStrictEqual(
    textsOf(text, spans),
    ["101", "202"],
    show("pytest == in row", text, spans, "an inline candidate inside the table's region was emitted alongside the row spans; §6 says it is dropped, never merged")
  );
  assertRunnerUntouched("pytest == in row", text, spans, "assert flagged(flag) == want");
});

gtest("[P2 §6 an inline span inside a table region is dropped] rust/libtest: an assert_eq! written inside a row's own expression does not double-emit", () => {
  const text = `#[test]
fn shard_of_cases() {
    let cases = [
        ("alpha", 8, 101),
        ("beta", 16, 202),
    ];
    for (key, buckets, want) in cases {
        assert_eq!(shard_of(key, buckets), want);
    }
}
`;
  const spans = fwOf("rust/libtest").expectedValueSpans(text);
  assertAscending("rust drop-inside", text, spans);
  assert.deepStrictEqual(
    textsOf(text, spans),
    ["101", "202"],
    show("rust drop-inside", text, spans, "exactly two rows, exactly two spans, and none over the runner")
  );
  assertRunnerUntouched("rust drop-inside", text, spans, "assert_eq!(shard_of(key, buckets), want);");
});

// ===========================================================================
// §14. A constructed last column is covered WHOLE.
// ===========================================================================

const CONSTRUCTED = {
  "rust/libtest": {
    wants: ["vec![1, 2, 3]", "vec![4, 5]"],
    text: `#[test]
fn fan_cases() {
    let cases = [
        ("alpha", vec![1, 2, 3]),
        ("beta", vec![4, 5]),
    ];
    for (key, want) in cases {
        assert_eq!(fan(key), want);
    }
}
`,
  },
  "go/gotest": {
    wants: ["[]int{1, 2, 3}", "[]int{4, 5}"],
    text: `func TestFan(t *testing.T) {
	cases := []struct {
		key  string
		want []int
	}{
		{"alpha", []int{1, 2, 3}},
		{"beta", []int{4, 5}},
	}
	for _, tt := range cases {
		if got := Fan(tt.key); !reflect.DeepEqual(got, tt.want) {
			t.Errorf("fan")
		}
	}
}
`,
  },
  "typescript/vitest": {
    wants: ["[1, 2, 3]", "{ a: 1 }"],
    text: `it.each([
  ["alpha", [1, 2, 3]],
  ["beta", { a: 1 }],
])("fan(%s)", (key, want) => {
  expect(fan(key)).toEqual(want);
});
`,
  },
  "typescript/jest": {
    wants: ["[1, 2, 3]", "{ a: 1 }"],
    text: `it.each([
  ["alpha", [1, 2, 3]],
  ["beta", { a: 1 }],
])("fan(%s)", (key, want) => {
  expect(fan(key)).toEqual(want);
});
`,
  },
  "python/pytest": {
    wants: ["[1, 2, 3]", '{"a": 1}'],
    text: `@pytest.mark.parametrize("key,want", [
    ("alpha", [1, 2, 3]),
    ("beta", {"a": 1}),
])
def test_fan(key, want):
    assert fan(key) == want
`,
  },
  "python/unittest": {
    wants: ["[1, 2, 3]", '{"a": 1}'],
    text: `class FanTest(unittest.TestCase):
    def test_fan(self):
        cases = [
            ("alpha", [1, 2, 3]),
            ("beta", {"a": 1}),
        ]
        for key, want in cases:
            with self.subTest(key=key):
                self.assertEqual(fan(key), want)
`,
  },
  "csharp/mstest": {
    wants: ["new int[] { 1, 2, 3 }", "new int[] { 4, 5 }"],
    text: `[DataTestMethod]
[DataRow("alpha", new int[] { 1, 2, 3 })]
[DataRow("beta", new int[] { 4, 5 })]
public void FanCases(string key, int[] want)
{
    CollectionAssert.AreEqual(want, Fan(key));
}
`,
  },
  "csharp/xunit": {
    wants: ["new int[] { 1, 2, 3 }", "new int[] { 4, 5 }"],
    text: `[Theory]
[InlineData("alpha", new int[] { 1, 2, 3 })]
[InlineData("beta", new int[] { 4, 5 })]
public void FanCases(string key, int[] want)
{
    Assert.Equal(want, Fan(key));
}
`,
  },
  "csharp/nunit": {
    wants: ["new int[] { 1, 2, 3 }", "new int[] { 4, 5 }"],
    text: `[TestCase("alpha", new int[] { 1, 2, 3 })]
[TestCase("beta", new int[] { 4, 5 })]
public void FanCases(string key, int[] want)
{
    Assert.That(Fan(key), Is.EqualTo(want));
}
`,
  },
};

for (const key of KEYS) {
  const f = CONSTRUCTED[key];
  gtest(`[P2 §14 a constructed last column is covered WHOLE] ${key}: the span is the whole construction, not its first element`, () => {
    const spans = fwOf(key).expectedValueSpans(f.text);
    assertAscending(key, f.text, spans);
    assert.deepStrictEqual(
      spans.map((s) => ({ start: s.start, end: s.end })),
      f.wants.map((lit) => rangeOf(key, f.text, lit)),
      show(key, f.text, spans, `the span must cover ${JSON.stringify(f.wants)} whole; splitting on the construction's inner commas blanks a fragment and leaves the rest of the model's guess in the file`)
    );
  });
}

// ===========================================================================
// §9 + §13. Pure and total; malformed input never throws and never returns a
// descending or overlapping pair.
// ===========================================================================

const MALFORMED = (key) => {
  const t = TABLES[key].text;
  const cut = t.indexOf("303");
  return [
    ["empty string", ""],
    ["whitespace only", "   \n\t\n"],
    ["truncated mid-table", t.slice(0, cut >= 0 ? cut + 1 : Math.floor(t.length / 2))],
    ["closing bracket removed", t.replace("]", "")],
    ["closing brace removed", t.replace("}", "")],
    ["a row short a column", t.replace(", 202)", ")").replace(", 202}", "}").replace(", 202)]", ")]").replace(", 202]", "]")],
    ["every delimiter opened, none closed", "([{" + t],
    ["an unterminated string", t + '\n    let s = "unterminated'],
  ];
};

for (const key of KEYS) {
  gtest(`[P2 §9 pure and total + §13 malformed] ${key}: eight broken inputs, none throws, none returns a descending or overlapping pair`, () => {
    for (const [what, text] of MALFORMED(key)) {
      let spans;
      assert.doesNotThrow(() => {
        spans = fwOf(key).expectedValueSpans(text);
      }, `${key}: expectedValueSpans threw on ${what}. §9 says never throws, on any input.\n---- TEXT ----\n${text}\n---- END ----`);
      assertAscending(`${key} / ${what}`, text, spans);
      assert.doesNotThrow(() => {
        fwOf(key).unresolvedAssertions(text);
      }, `${key}: unresolvedAssertions threw on ${what}`);
    }
  });

  gtest(`[P2 §9 pure] ${key}: same text, same spans, on the table reply and on a half-written one`, () => {
    for (const text of [TABLES[key].text, MALFORMED(key)[2][1]]) {
      const a = fwOf(key).expectedValueSpans(text);
      const b = fwOf(key).expectedValueSpans(text);
      assert.deepStrictEqual(
        b.map((s) => ({ start: s.start, end: s.end })),
        a.map((s) => ({ start: s.start, end: s.end })),
        show(key, text, a, "two calls on the same text disagreed, so the locator carries state")
      );
    }
  });
}

// ===========================================================================
// §15. blankExpectedValues over a table reply: the holes sit in the ROWS and
// the runner comes back unchanged.
// ===========================================================================

const holeOpeners = (s) => (s.match(/\$\{/g) || []).length;

// The prefix of the fixture line that carries a given literal, so a hole can be
// located by LINE without pinning the renderer's exact bytes.
function rowPrefix(text, literal) {
  const i = text.indexOf(literal);
  const s = text.lastIndexOf("\n", i) + 1;
  return text.slice(s, i).trim();
}

for (const key of KEYS) {
  const { languageId } = REACHABLE.map(([l, f]) => ({ languageId: l, k: `${l}/${f}` })).find((x) => x.k === key);
  const f = TABLES[key];

  gtest(`[P2 §15 the holes sit in the rows] ${key}: blankExpectedValues puts one hole per row and leaves the runner byte-identical`, () => {
    const { lang, fw } = at(key);
    const res = blankExpectedValues(lang, fw, f.text, RETURN_TYPE[languageId]);
    assert.ok(res && typeof res.snippet === "string", `${key}: blankExpectedValues returned no snippet: ${JSON.stringify(res)}`);

    const tail = `\n---- SNIPPET ----\n${res.snippet}\n---- END SNIPPET ----`;

    assert.strictEqual(res.unresolved, 0, `${key}: the table parsed, so nothing should be unresolved; got ${res.unresolved}${tail}`);
    assert.strictEqual(res.holes, f.lastCols.length, `${key}: expected one hole per row (${f.lastCols.length}), got ${res.holes}${tail}`);
    assert.strictEqual(res.holes, holeOpeners(res.snippet), `${key}: the reported hole count disagrees with the count of \${ openers in the snippet${tail}`);

    // The runner survives verbatim. This is the inversion's tell: if the runner
    // came back holding a hole, the human would be typing into the loop
    // variable while the rows kept the model's guesses.
    assert.ok(
      res.snippet.includes(f.runner),
      `${key}: the runner ${JSON.stringify(f.runner)} is not in the snippet unchanged${tail}`
    );

    // The model's guessed row values are gone.
    for (const lit of f.lastCols) {
      const before = rowPrefix(f.text, lit);
      const rowLine = res.snippet.split("\n").find((l) => l.trim().startsWith(before));
      assert.ok(rowLine, `${key}: the row line beginning ${JSON.stringify(before)} vanished from the snippet${tail}`);
      assert.ok(
        rowLine.includes("${"),
        `${key}: the row line ${JSON.stringify(rowLine)} carries no hole, so the human types nothing and the model's ${lit} ships${tail}`
      );
    }

    // Every hole in the snippet is on a ROW line, none anywhere else.
    const prefixes = f.lastCols.map((lit) => rowPrefix(f.text, lit));
    const stray = res.snippet
      .split("\n")
      .filter((l) => l.includes("${"))
      .filter((l) => !prefixes.some((p) => l.trim().startsWith(p)));
    assert.deepStrictEqual(
      stray,
      [],
      `${key}: a hole landed outside the table's rows, which is the blank-value invariant inverted:\n${stray.join("\n")}${tail}`
    );
  });

  gtest(`[P2 §15 + §3 a table the locator cannot parse refuses] ${key}: blankExpectedValues over a row reference with no table reports unresolved`, () => {
    const { lang, fw } = at(key);
    const text = ROW_REF_NO_TABLE[key].text;
    const res = blankExpectedValues(lang, fw, text, RETURN_TYPE[languageId]);
    assert.ok(
      res.unresolved > 0,
      `${key}: the reply references a row and carries no parseable table, yet the blanker reports ${res.unresolved} unresolved and ${res.holes} hole(s). ` +
        `Silence here hands the human a snippet whose rows are the model's guesses.\n---- SNIPPET ----\n${res.snippet}\n---- END ----`
    );
  });
}
