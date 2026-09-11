// Blind oracle for session-v68 phase 3: a declared table column the body never
// reads is refused [session-v68/contracts/P3-knob-lint.md]. Written from the
// contract alone, WITHOUT READING src/** - not one file, not one grep, not one
// peek at the bundled source text. A lint oracle that agreed with the lint
// would be worthless, so every assertion below is derived from the contract's
// numbered rules 1-14 and from nothing else.
//
// Surface exercised, all through the public seam:
//   tddLangFor, frameworkFor              ../src/core/tddLang
//   TddLang.deadTableColumns(text)        off the resolved language
//
// The contract puts deadTableColumns on the LANGUAGE, one implementation per
// language, so the six shapes in its table collapse onto five language ids:
// python/pytest and python/unittest are both `python`.
//
// EXPECTED RED: phase 3 is not written. deadTableColumns does not exist yet.
// Every row below therefore asserts the method EXISTS first, with a sentence
// saying so, rather than dying on a TypeError. A failing `assert` here is a
// contract finding and is the point of the file. A bundling crash would be a
// harness bug instead.
//
// Run: SKIP_LIVE=1 node --test test/blind-v68-knob-lint.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const { bundleCore } = require("./.blind-util.cjs");

let mod = {};
let cleanup = () => {};
let bundleError;
try {
  ({ mod, cleanup } = bundleCore(
    "blind-v68-knob-lint",
    `export { tddLangFor, frameworkFor } from "../src/core/tddLang";\n`
  ));
} catch (e) {
  bundleError = e;
}
test.after(() => cleanup());

const { tddLangFor, frameworkFor } = mod;

// Every row except the bundle row skips (not fails) while the bundle is broken,
// so a harness break stays ONE loud failure instead of a wall of TypeErrors.
const gtest = (name, fn) =>
  test(name, (ctx) => {
    if (bundleError) return ctx.skip("bundle failed to build; see the bundle test");
    return fn(ctx);
  });

test("bundle: the P3 surface builds and exports tddLangFor [P3 'Surface under contract']", () => {
  assert.strictEqual(
    bundleError,
    undefined,
    `the bundle failed, so every row below is a harness error rather than a contract finding: ${bundleError}`
  );
  assert.strictEqual(typeof tddLangFor, "function", "tddLangFor(languageId) => TddLang | undefined");
  assert.strictEqual(typeof frameworkFor, "function", "frameworkFor(lang, root, deps)");
});

// ===========================================================================
// Resolution. deadTableColumns is declared on TddLang, so the five language
// ids are what this file needs. The nine-framework walk below is kept because
// the contract's shape table is written per FRAMEWORK idiom: every framework a
// human can actually reach must land on a language that declares the method.
// ===========================================================================

const LANG_IDS = ["rust", "go", "typescript", "python", "csharp"];

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

const langOf = (languageId) => {
  const lang = tddLangFor(languageId);
  assert.ok(lang, `tddLangFor(${JSON.stringify(languageId)}) returned nothing, so no row below can run`);
  return lang;
};

gtest("[P3 'Surface under contract'] every language a reachable framework lands on declares deadTableColumns", () => {
  const bad = [];
  for (const [languageId, frameworkId, root, mkDeps] of REACHABLE) {
    const lang = tddLangFor(languageId);
    if (!lang) {
      bad.push(`${languageId}/${frameworkId}: tddLangFor(${languageId}) returned nothing`);
      continue;
    }
    let reached = false;
    try {
      const res = frameworkFor(lang, root, mkDeps());
      reached = Boolean(res && res.ok && res.framework && res.framework.id === frameworkId);
    } catch {
      reached = false;
    }
    if (!reached && !(Array.isArray(lang.frameworks) && lang.frameworks.some((f) => f.id === frameworkId))) {
      bad.push(`${languageId}/${frameworkId}: not reachable at all`);
    }
    if (typeof lang.deadTableColumns !== "function") {
      bad.push(
        `${languageId}/${frameworkId}: TddLang.deadTableColumns is ${typeof lang.deadTableColumns}, not a function`
      );
    }
  }
  assert.deepStrictEqual(
    [...new Set(bad)],
    [],
    "the contract puts deadTableColumns(text) on the TddLang seam, one implementation per language:\n" +
      [...new Set(bad)].join("\n")
  );
});

// ===========================================================================
// Helpers. A lint failure that does not print the fixture and the returned
// names is a failure nobody can act on, so every message below carries both.
// ===========================================================================

const show = (label, text, got, why) =>
  `${label}: ${why}\n` +
  `  deadTableColumns returned: ${JSON.stringify(got)}\n` +
  `---- TEXT ----\n${text}\n---- END TEXT ----`;

const sorted = (a) => [...a].sort();

// Rule 5 says pure and total, so this asserts the method EXISTS (the expected
// phase-3 red, stated as a sentence rather than a TypeError), that it does not
// throw, and that it returns a plain array of strings, before any row compares
// names. Order is never asserted: the contract fixes no order.
function deadOf(languageId, label, text) {
  const lang = langOf(languageId);
  assert.strictEqual(
    typeof lang.deadTableColumns,
    "function",
    `${label}: TddLang(${languageId}).deadTableColumns is ${typeof lang.deadTableColumns}. ` +
      "The P3 contract's 'Surface under contract' declares deadTableColumns(text: string): string[] on the seam, " +
      "one implementation per language. It is not there yet, so this row cannot make a contract finding."
  );
  let got;
  assert.doesNotThrow(() => {
    got = lang.deadTableColumns(text);
  }, `${label}: [P3 §5] deadTableColumns threw. Rule 5 says pure and total: never throws, on any input.\n---- TEXT ----\n${text}\n---- END TEXT ----`);
  assert.ok(Array.isArray(got), show(label, text, got, "[P3 'Surface under contract'] the return is not an array"));
  for (const n of got) {
    assert.strictEqual(
      typeof n,
      "string",
      show(label, text, got, `[P3 §8] an entry is a ${typeof n}, not a column NAME. This is a refusal, not a repair: the seam returns names, never an edit payload`)
    );
  }
  return got;
}

const expectDead = (languageId, label, text, want, why) => {
  const got = deadOf(languageId, label, text);
  assert.deepStrictEqual(sorted(got), sorted(want), show(label, text, got, `${why}; expected ${JSON.stringify(sorted(want))}`));
};

// ===========================================================================
// The six shapes of the contract's table. A CORRECT table reports zero (§10),
// and the same table with exactly one bound-and-never-read column reports that
// one name and only that one (§11), which is also §2: the header that BINDS
// the name is outside the body by construction, so a name appearing only in
// the destructure is still dead.
// ===========================================================================

const SHAPES = {
  rust: {
    lang: "rust",
    deadName: "limit",
    ok: `#[cfg(test)]
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
    dead: `#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shard_of_cases() {
        let cases = [
            ("alpha", 8, 4, 101),
            ("beta", 16, 8, 202),
            ("gamma", 32, 16, 303),
        ];
        for (key, buckets, limit, want) in cases {
            assert_eq!(shard_of(key, buckets), want);
        }
    }
}
`,
  },

  go: {
    lang: "go",
    deadName: "limit",
    ok: `func TestShardOf(t *testing.T) {
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
    dead: `func TestShardOf(t *testing.T) {
	cases := []struct {
		name    string
		key     string
		buckets int
		limit   int
		want    int
	}{
		{"alpha", "a", 8, 4, 101},
		{"beta", "b", 16, 8, 202},
		{"gamma", "g", 32, 16, 303},
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

  typescript: {
    lang: "typescript",
    deadName: "limit",
    ok: `it.each([
  ["alpha", 8, 101],
  ["beta", 16, 202],
  ["gamma", 32, 303],
])("shardOf(%s, %i)", (key, buckets, want) => {
  expect(shardOf(key, buckets)).toBe(want);
});
`,
    dead: `it.each([
  ["alpha", 8, 4, 101],
  ["beta", 16, 8, 202],
  ["gamma", 32, 16, 303],
])("shardOf(%s, %i)", (key, buckets, limit, want) => {
  expect(shardOf(key, buckets)).toBe(want);
});
`,
  },

  "python/pytest": {
    lang: "python",
    deadName: "limit",
    ok: `@pytest.mark.parametrize("key,buckets,want", [
    ("alpha", 8, 101),
    ("beta", 16, 202),
    ("gamma", 32, 303),
])
def test_shard_of(key, buckets, want):
    assert shard_of(key, buckets) == want
`,
    dead: `@pytest.mark.parametrize("key,buckets,limit,want", [
    ("alpha", 8, 4, 101),
    ("beta", 16, 8, 202),
    ("gamma", 32, 16, 303),
])
def test_shard_of(key, buckets, limit, want):
    assert shard_of(key, buckets) == want
`,
  },

  "python/unittest": {
    lang: "python",
    deadName: "limit",
    ok: `class ShardOfTest(unittest.TestCase):
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
    dead: `class ShardOfTest(unittest.TestCase):
    def test_shard_of(self):
        cases = [
            ("alpha", 8, 4, 101),
            ("beta", 16, 8, 202),
            ("gamma", 32, 16, 303),
        ]
        for key, buckets, limit, want in cases:
            with self.subTest(key=key):
                self.assertEqual(shard_of(key, buckets), want)
`,
  },

  csharp: {
    lang: "csharp",
    deadName: "limit",
    ok: `[Theory]
[InlineData("alpha", 8, 101)]
[InlineData("beta", 16, 202)]
[InlineData("gamma", 32, 303)]
public void ShardOfCases(string key, int buckets, int want)
{
    Assert.Equal(want, ShardOf(key, buckets));
}
`,
    dead: `[Theory]
[InlineData("alpha", 8, 4, 101)]
[InlineData("beta", 16, 8, 202)]
[InlineData("gamma", 32, 16, 303)]
public void ShardOfCases(string key, int buckets, int limit, int want)
{
    Assert.Equal(want, ShardOf(key, buckets));
}
`,
  },
};

const SHAPE_KEYS = Object.keys(SHAPES);

for (const shape of SHAPE_KEYS) {
  const f = SHAPES[shape];

  gtest(`[P3 §10 a correct table in each of the six shapes reports zero dead columns] ${shape}`, () => {
    expectDead(
      f.lang,
      `${shape} correct`,
      f.ok,
      [],
      "every column this table binds is read in the body, so refusing here refuses a correct idiom and the human is sent hunting a defect that is not there"
    );
  });

  gtest(`[P3 §11 + §2 exactly the one dead column, by name; the destructure is not a use] ${shape}: ${JSON.stringify(f.deadName)}`, () => {
    expectDead(
      f.lang,
      `${shape} one dead column`,
      f.dead,
      [f.deadName],
      `${JSON.stringify(f.deadName)} is bound by the header and read nowhere in the body. ` +
        "A row value in that column changes nothing, so the table cannot exercise it. " +
        "Reporting [] means rule 2 counted the BINDING as a read; reporting more than this one name means a live column was slandered"
    );
  });
}

// ===========================================================================
// §1. A name read anywhere in the body counts as a use, however deep, and a
// qualified read is still a read. Getting this too narrow refuses live
// columns, which is worse than the defect: the human loses a correct pass.
// ===========================================================================

const NESTED_READ = {
  rust: `#[test]
fn shard_of_cases() {
    let cases = [
        ("alpha", 8, 101),
        ("beta", 16, 202),
    ];
    for (key, buckets, want) in cases {
        if buckets > 0 {
            for _ in 0..1 {
                assert_eq!(shard_of(key, buckets), want);
            }
        }
    }
}
`,
  go: `func TestShardOf(t *testing.T) {
	cases := []struct {
		key     string
		buckets int
		want    int
	}{
		{"a", 8, 101},
		{"b", 16, 202},
	}
	for _, tt := range cases {
		t.Run("case", func(t *testing.T) {
			for i := 0; i < 1; i++ {
				func() {
					if got := ShardOf(tt.key, tt.buckets); got != tt.want {
						t.Errorf("shard")
					}
				}()
			}
		})
	}
}
`,
  typescript: `it.each([
  ["alpha", 8, 101],
  ["beta", 16, 202],
])("shardOf(%s, %i)", (key, buckets, want) => {
  [0].forEach(() => {
    if (buckets > 0) {
      expect(shardOf(key, buckets)).toBe(want);
    }
  });
});
`,
  python: `@pytest.mark.parametrize("key,buckets,want", [
    ("alpha", 8, 101),
    ("beta", 16, 202),
])
def test_shard_of(key, buckets, want):
    for _ in range(1):
        if buckets > 0:
            assert shard_of(key, buckets) == want
`,
  csharp: `[Theory]
[InlineData("alpha", 8, 101)]
[InlineData("beta", 16, 202)]
public void ShardOfCases(string key, int buckets, int want)
{
    foreach (var i in new[] { 0 })
    {
        if (buckets > 0)
        {
            Assert.Equal(want, ShardOf(key, buckets));
        }
    }
}
`,
};

for (const languageId of LANG_IDS) {
  gtest(`[P3 §1 a name read ANYWHERE in the body counts as a use] ${languageId}: reads nested inside a closure, a loop and a branch still count`, () => {
    expectDead(
      languageId,
      `${languageId} nested read`,
      NESTED_READ[languageId],
      [],
      "rule 1 says anywhere in the body. A reader that only scans the first statement, or the top nesting level, refuses a correct table"
    );
  });
}

gtest("[P3 §1 a qualified read is still a read] go: every column is reached only as tt.<field>, never as a bare word", () => {
  const text = `func TestShardOf(t *testing.T) {
	cases := []struct {
		key     string
		buckets int
		want    int
	}{
		{"a", 8, 101},
	}
	for _, tt := range cases {
		if got := ShardOf(tt.key, tt.buckets); got != tt.want {
			t.Errorf("shard")
		}
	}
}
`;
  expectDead(
    "go",
    "go qualified read",
    text,
    [],
    "Go's tt.want is a use of want: the field name appears as a word after the qualifier. Requiring a BARE occurrence would report all three of a perfectly good Go table"
  );
});

// ===========================================================================
// §9. The measured defect. A Go table declaring maxBytes and using it ONLY as
// the literal text inside a t.Errorf format string is the arm this rung exists
// to catch: the cap is a module constant, the column cannot be passed in, and
// a row value there changes nothing. The same call with tt.maxBytes as an
// ARGUMENT is a real use. The two fixtures differ by that argument alone.
// ===========================================================================

const GO_MAXBYTES_FORMAT_ONLY = `func TestSplice(t *testing.T) {
	cases := []struct {
		name     string
		input    string
		maxBytes int
		want     string
	}{
		{"short", "abc", 64, "abc"},
		{"long", "abcdefgh", 4, "abcd"},
	}
	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			got := Splice(tt.input)
			if got != tt.want {
				t.Errorf("Splice() = %q, want %q under maxBytes", got, tt.want)
			}
		})
	}
}
`;

const GO_MAXBYTES_PASSED = `func TestSplice(t *testing.T) {
	cases := []struct {
		name     string
		input    string
		maxBytes int
		want     string
	}{
		{"short", "abc", 64, "abc"},
		{"long", "abcdefgh", 4, "abcd"},
	}
	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			got := Splice(tt.input)
			if got != tt.want {
				t.Errorf("Splice() = %q, want %q under maxBytes %d", got, tt.want, tt.maxBytes)
			}
		})
	}
}
`;

gtest("[P3 §9 the measured defect fires] go: maxBytes appears ONLY as literal text inside the t.Errorf format string, which is not a use", () => {
  expectDead(
    "go",
    "go maxBytes in format string only",
    GO_MAXBYTES_FORMAT_ONLY,
    ["maxBytes"],
    "this is the arm the contract measured: the model declared a maxBytes knob, put its NAME in the failure message, and never read it. " +
      "A format string is neutralised before the read, so the word inside the quotes is not a use and the column is dead"
  );
});

gtest("[P3 §9 a format string's ARGUMENT is a real use] go: tt.maxBytes passed to the same t.Errorf is read, so nothing is reported", () => {
  expectDead(
    "go",
    "go tt.maxBytes passed as an argument",
    GO_MAXBYTES_PASSED,
    [],
    "the only difference from the dead fixture is the trailing tt.maxBytes argument. " +
      "If this reports maxBytes, neutralising the format string ate the argument list with it; " +
      "if the dead fixture reports [] and this reports [], the string was never neutralised at all"
  );
});

gtest("[P3 §9 the two fixtures differ ONLY by the argument] go: a fixture-integrity check, not a product check", () => {
  const a = GO_MAXBYTES_FORMAT_ONLY.replace(' under maxBytes"', ' under maxBytes %d"');
  const b = GO_MAXBYTES_PASSED.replace(", tt.maxBytes)", ")");
  assert.strictEqual(
    a,
    b,
    "fixture bug: the §9 pair differs by more than the tt.maxBytes argument and the %d verb, so a difference in the verdict would not isolate the format-string rule"
  );
});

// ===========================================================================
// §13. A label-only column. Go's `name` is read only by t.Run(tt.name, ...).
// That IS a use. Reporting it would refuse the standard Go subtest idiom on
// every table the product ever emits.
// ===========================================================================

gtest("[P3 §13 a label-only column is a use] go: `name` read ONLY by t.Run(tt.name, ...) is never reported", () => {
  const text = `func TestShardOf(t *testing.T) {
	cases := []struct {
		name    string
		key     string
		buckets int
		want    int
	}{
		{"alpha shards", "a", 8, 101},
		{"beta shards", "b", 16, 202},
	}
	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			if got := ShardOf(tt.key, tt.buckets); got != tt.want {
				t.Errorf("shard")
			}
		})
	}
}
`;
  expectDead(
    "go",
    "go label-only column",
    text,
    [],
    "t.Run(tt.name, ...) is the standard Go subtest idiom and tt.name is a genuine read. " +
      "Reporting it refuses nearly every well-formed Go table, which is a far worse outcome than missing one dead knob"
  );
});

gtest("[P3 §13 + §9 a label read only INSIDE a string is still dead] go: a `name` column named in the message but never read", () => {
  const text = `func TestShardOf(t *testing.T) {
	cases := []struct {
		name    string
		key     string
		buckets int
		want    int
	}{
		{"alpha shards", "a", 8, 101},
		{"beta shards", "b", 16, 202},
	}
	for _, tt := range cases {
		if got := ShardOf(tt.key, tt.buckets); got != tt.want {
			t.Errorf("case name failed: got %v want %v", got, tt.want)
		}
	}
}
`;
  expectDead(
    "go",
    "go name only inside the message text",
    text,
    ["name"],
    "§13 exempts a label READ by t.Run, not a label whose word merely appears inside a quoted message. " +
      "This is §9's rule applied to the label column: the string is neutralised, so nothing reads name"
  );
});

// ===========================================================================
// §3 + §12. The expected column is exempt. NUnit's ExpectedResult form has no
// want parameter at all, and the runner compares the RETURN value, so a lint
// that demanded a read of the expected column would refuse a correct idiom.
// ===========================================================================

gtest("[P3 §12 the NUnit ExpectedResult method reports nothing] csharp: parameters are (string key, int buckets) and both are read", () => {
  const text = `[TestCase("alpha", 8, ExpectedResult = 101)]
[TestCase("beta", 16, ExpectedResult = 202)]
public int ShardOfCases(string key, int buckets)
{
    return ShardOf(key, buckets);
}
`;
  expectDead(
    "csharp",
    "csharp NUnit ExpectedResult",
    text,
    [],
    "NUnit compares the RETURN value itself, so there is no want parameter to read. " +
      "Reporting anything here refuses a correct idiom; reporting 'ExpectedResult' means the named argument was mistaken for a bound column"
  );
});

gtest("[P3 §12 an NUnit ExpectedResult method with a genuinely dead parameter still reports it] csharp", () => {
  const text = `[TestCase("alpha", 8, 4, ExpectedResult = 101)]
[TestCase("beta", 16, 8, ExpectedResult = 202)]
public int ShardOfCases(string key, int buckets, int limit)
{
    return ShardOf(key, buckets);
}
`;
  expectDead(
    "csharp",
    "csharp NUnit ExpectedResult with a dead parameter",
    text,
    ["limit"],
    "the ExpectedResult exemption is about the EXPECTED column, not a blanket pass for the whole NUnit shape. " +
      "limit is bound and never read, so the table cannot exercise it"
  );
});

// RE-CUT after the contract was AMENDED on 2026-09-10, which is what this row
// asked for in its own message. It read rule 3 as a universal exemption for the
// expected column. The build disagreed and rule 3 moved: a Rust table that binds
// `want` and never reads it has an assertion with no expected value in it, and
// that is precisely a harness worth refusing. The narrow case rule 3 was really
// about is NUnit's `ExpectedResult`, where there is no bound name to be dead at
// all, and the §12 rows above cover it.
gtest("[P3 §3 amended: the exemption is NUnit's ExpectedResult alone] rust: a bound-but-unread `want` IS reported", () => {
  const text = `#[test]
fn shard_of_cases() {
    let cases = [
        ("alpha", 8, 101),
        ("beta", 16, 202),
    ];
    for (key, buckets, want) in cases {
        assert!(shard_of(key, buckets) > 0);
    }
}
`;
  expectDead(
    "rust",
    "rust unread expected column",
    text,
    ["want"],
    "a table that binds `want` and never reads it asserts nothing at all, so it is exactly the harness " +
      "this rung exists to refuse. The exemption belongs to NUnit's ExpectedResult, which binds no name"
  );
});

// ===========================================================================
// §4. No table found means no verdict. This rung never fires on the inline
// shape, so nothing that shipped before S31 changes.
// ===========================================================================

const INLINE = {
  rust: `#[cfg(test)]
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
  go: `func TestShardOfAlpha(t *testing.T) {
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
  typescript: `it("shards alpha", () => {
  expect(shardOf("alpha", 8)).toBe(101);
});

it("shards beta", () => {
  expect(shardOf("beta", 16)).toBe(202);
});
`,
  python: `def test_shards_alpha():
    assert shard_of("alpha", 8) == 101


def test_shards_beta():
    assert shard_of("beta", 16) == 202
`,
  csharp: `[Fact]
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
};

for (const languageId of LANG_IDS) {
  gtest(`[P3 §4 no table found means no verdict] ${languageId}: a purely INLINE reply reports zero dead columns`, () => {
    expectDead(
      languageId,
      `${languageId} inline reply`,
      INLINE[languageId],
      [],
      "there is no table here, so there are no bound columns and no verdict to give. " +
        "Anything reported refuses a shape that shipped before S31 and changes behaviour this rung promised not to touch"
    );
  });
}

gtest("[P3 §4 no table found means no verdict] python/unittest: a single-case method with unused LOCALS is not a table", () => {
  const text = `class ShardOfTest(unittest.TestCase):
    def test_shard_of(self):
        key = "alpha"
        buckets = 8
        limit = 4
        self.assertEqual(shard_of(key, buckets), 101)
`;
  expectDead(
    "python",
    "python unused local, no table",
    text,
    [],
    "limit is an unused LOCAL, not a bound table column. This rung lints tables, not variables; a general unused-name lint would fire on every inline reply"
  );
});

// ===========================================================================
// §5 + §14. Pure and total. Truncated and malformed tables report nothing
// rather than throwing. A throw here takes the whole gesture down on text the
// model routinely half-writes.
// ===========================================================================

// AMENDED: several of these transforms are NO-OPS on some shapes - Python has no
// `}` to remove, so "closing brace removed" handed back the VALID table and this
// row then asserted the same text reports [] while the §11 row asserts it
// reports ["limit"]. A fixture that cannot produce the case is a fact about the
// fixture. Every transform that leaves the text unchanged is dropped.
const MALFORMED = (shape) => MALFORMED_RAW(shape).filter(([, text]) => text !== SHAPES[shape].dead);

const MALFORMED_RAW = (shape) => {
  const t = SHAPES[shape].dead;
  const cut = t.indexOf("303");
  return [
    ["empty string", ""],
    ["whitespace only", "   \n\t\n"],
    ["truncated mid-table", t.slice(0, cut >= 0 ? cut + 1 : Math.floor(t.length / 2))],
    ["truncated mid-header", t.slice(0, Math.max(1, Math.floor(t.length / 4)))],
    ["closing bracket removed", t.replace("]", "")],
    ["closing brace removed", t.replace("}", "")],
    ["every delimiter opened, none closed", "([{" + t],
    ["an unterminated string", t + '\n"unterminated'],
    ["only the header, no body", t.slice(0, t.indexOf("\n") + 1)],
  ];
};

for (const shape of SHAPE_KEYS) {
  const f = SHAPES[shape];

  gtest(`[P3 §5 pure and total] ${shape}: nine broken inputs, none throws, every return is an array of strings`, () => {
    for (const [what, text] of MALFORMED(shape)) {
      deadOf(f.lang, `${shape} / ${what}`, text);
    }
  });

  gtest(`[P3 §14 truncated and malformed tables report NOTHING] ${shape}: nine broken inputs, all report []`, () => {
    const wrong = [];
    for (const [what, text] of MALFORMED(shape)) {
      const got = deadOf(f.lang, `${shape} / ${what}`, text);
      if (got.length) wrong.push(`${what} -> ${JSON.stringify(got)}\n---- TEXT ----\n${text}\n---- END TEXT ----`);
    }
    assert.deepStrictEqual(
      wrong,
      [],
      `[P3 §14] a half-written table produced a verdict. The model writes text like this while streaming; ` +
        `refusing on it names a column the human never finished typing:\n${wrong.join("\n\n")}`
    );
  });

  gtest(`[P3 §5 same text, same names] ${shape}: two calls on the correct table and on a truncated one agree`, () => {
    for (const text of [f.ok, f.dead, MALFORMED(shape)[2][1]]) {
      const a = deadOf(f.lang, `${shape} purity a`, text);
      const b = deadOf(f.lang, `${shape} purity b`, text);
      assert.deepStrictEqual(sorted(b), sorted(a), show(`${shape} purity`, text, [a, b], "two calls on the same text disagreed, so the lint carries state"));
    }
  });
}

// ===========================================================================
// §6 + §7 + §8. The refusal itself lives on the column80.generateTests floor
// in src/vscode/fnGen.ts, ahead of both write paths and the preview. That is
// not reachable from this core-seam bundle, so the rows below assert what the
// SEAM can carry: the names the message must be built from, and the fact that
// the seam offers no way to edit the model's text.
// ===========================================================================

gtest("[P3 §7 the message NAMES the dead columns] the seam hands the floor the exact names, so the message can be specific", () => {
  const got = deadOf("go", "go message names", GO_MAXBYTES_FORMAT_ONLY);
  assert.deepStrictEqual(
    sorted(got),
    ["maxBytes"],
    show("go message names", GO_MAXBYTES_FORMAT_ONLY, got, "the refusal must say which column is dead. A boolean, an empty array on a dead table, or a name that is not the declared field all leave the human hunting")
  );
  for (const n of got) {
    assert.ok(
      /^[A-Za-z_][A-Za-z0-9_]*$/.test(n),
      show("go message names", GO_MAXBYTES_FORMAT_ONLY, got, `${JSON.stringify(n)} is not a bare column name. §7 says the message names the dead COLUMNS, not a type, a snippet, or a rendered sentence`)
    );
  }
});

gtest("[P3 §8 a REFUSAL, not a repair] the seam returns names only, so nothing here can edit the model's text", () => {
  const lang = langOf("go");
  assert.strictEqual(
    typeof lang.deadTableColumns,
    "function",
    "TddLang(go).deadTableColumns does not exist yet, so §8's shape cannot be checked"
  );
  const got = lang.deadTableColumns(GO_MAXBYTES_FORMAT_ONLY);
  assert.ok(Array.isArray(got), `§8: the return is ${typeof got}, not string[]`);
  for (const n of got) {
    assert.strictEqual(
      typeof n,
      "string",
      `§8: an entry is a ${typeof n}. A returned snippet, span or edit would make this a repair path, and rule 8 says nothing edits the model's text`
    );
  }
});

gtest("[P3 §6 the whole pass is refused] one dead column among four live ones still yields a non-empty verdict for the floor", () => {
  const got = deadOf("go", "go whole-pass refusal", SHAPES.go.dead);
  assert.ok(
    got.length > 0,
    show("go whole-pass refusal", SHAPES.go.dead, got, "the floor refuses the WHOLE pass on a non-empty result, exactly as the zero-hole and unresolved floors do. An empty array here means the floor never fires and the defect ships")
  );
});
