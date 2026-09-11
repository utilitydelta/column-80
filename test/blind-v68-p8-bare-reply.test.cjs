// Blind oracle for session-v68 phase 8: a fence-free reply that IS the tests
// [session-v68/contracts/P8-bare-reply.md]. Written from the contract alone,
// WITHOUT READING src/** - not one file, not one grep, not one peek at the
// bundled source text. An oracle that agreed with the implementation would be
// worthless, so every assertion below is derived from the contract's ten
// numbered rules and from nothing else.
//
// Surface exercised, all through the public seam:
//   extractTestModule(reply)                 ../src/core/instructPostprocess
//   extractTestFunctions(reply, languageId)  ../src/core/instructPostprocess
//   stripLeadingThink(reply)                 ../src/core/instructPostprocess
//
// Rule 1 is asserted DIFFERENTIALLY, as the contract's falsification note
// demands: the fenced reply is run and its return value captured, and the bare
// reply is compared against THAT, never against a hand-written string that
// could drift away from the ollama baseline.
//
// Rules 3, 6, 7 and 9 are written red-before-green: each of those rows FAILS
// against a naive "if there is no fence, just use the whole reply" fix.
//
// EXPECTED RED: phase 8 is not written. A failing `assert` here is a contract
// finding and is the point of the file. A bundling crash, or a TypeError on an
// export that should exist, would be a harness bug instead - the bundle row is
// its own loud test for exactly that reason.
//
// Run: SKIP_LIVE=1 node --test test/blind-v68-p8-bare-reply.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

let mod = {};
let cleanup = () => {};
let bundleError;
try {
  ({ mod, cleanup } = bundleCore(
    "blind-v68-p8-bare-reply",
    `export { extractTestModule, extractTestFunctions, stripLeadingThink } from "../src/core/instructPostprocess";\n`
  ));
} catch (e) {
  bundleError = e;
}

// Rule 10 names two fn-gen functions that must survive untouched. They are a
// SECOND bundle so a rename there cannot take the whole file down with it.
let fnGenMod = {};
let fnGenCleanup = () => {};
let fnGenBundleError;
try {
  ({ mod: fnGenMod, cleanup: fnGenCleanup } = bundleCore(
    "blind-v68-p8-fngen",
    `export { postprocessInstructOutput, extractRequestedFunction } from "../src/core/instructPostprocess";\n`
  ));
} catch (e) {
  fnGenBundleError = e;
}

test.after(() => {
  cleanup();
  fnGenCleanup();
});

const { extractTestModule, extractTestFunctions, stripLeadingThink } = mod;

// Every row except the bundle row skips (not fails) while the bundle is broken,
// so a harness break stays ONE loud failure instead of a wall of TypeErrors.
const gtest = (name, fn) =>
  test(name, (ctx) => {
    if (bundleError) return ctx.skip("bundle failed to build; see the bundle test");
    return fn(ctx);
  });

test("bundle: the P8 surface builds and exports extractTestModule + extractTestFunctions + stripLeadingThink [P8 'Surface under contract']", () => {
  assert.strictEqual(
    bundleError,
    undefined,
    `the bundle failed, so every row below is a harness error rather than a contract finding: ${bundleError}`
  );
  assert.strictEqual(typeof extractTestModule, "function", "extractTestModule(reply) => { text, testCount } | undefined");
  assert.strictEqual(
    typeof extractTestFunctions,
    "function",
    "extractTestFunctions(reply, languageId) => { text, testCount } | undefined"
  );
  assert.strictEqual(typeof stripLeadingThink, "function", "stripLeadingThink(reply) => string");
});

// ===========================================================================
// Helpers. No expected string in this file is hand-computed from the
// implementation: an expectation is either the fixture text itself, or a value
// captured from the FENCED call on the same fixture.
// ===========================================================================

const FENCE = "```";
const TILDE = "~~~";
// Amendment 1: a fence marker is EITHER kind. `~~~` is a supported fence today.
const MARKERS = [FENCE, TILDE];

const fencedOf = (lang, body, marker = FENCE) => `${marker}${lang.fence}\n${body}\n${marker}\n`;

const hasFenceLine = (s) =>
  String(s)
    .split("\n")
    .some((l) => MARKERS.some((m) => l.trim().startsWith(m)));

const show = (label, reply, res) =>
  `${label}\n---- REPLY ----\n${reply}\n---- END REPLY ----\n` +
  `---- RESULT ----\n${res === undefined ? "undefined" : JSON.stringify(res, null, 2)}\n---- END RESULT ----`;

// Deletes the LAST closing delimiter anywhere in the text, wherever it sits.
// A regex anchored at the end is a no-op on a body ending in `;` or a digit,
// and a no-op mutation would assert that a WELL FORMED reply must be refused.
const dropLastCloser = (s) => {
  const i = Math.max(s.lastIndexOf(")"), s.lastIndexOf("]"), s.lastIndexOf("}"));
  return i < 0 ? s : s.slice(0, i) + s.slice(i + 1);
};

const APOLOGY =
  "I am sorry, but I cannot write tests for this function without seeing the module it belongs to.\n" +
  "Consider adding a few cases by hand instead.";

const TRAILING_SENTENCE = "These cases cover the happy path and the zero bucket edge.";
const LEADING_SENTENCE = "Here are the tests for shard of.";

// ===========================================================================
// The five languages. Every body is table-shaped, in the idiom session-v68
// generates: a row list plus a runner, and one separate single-case test.
// ===========================================================================

const LANGS = [
  {
    id: "rust",
    fence: "rust",
    fnName: "extractTestModule",
    extract: (reply) => extractTestModule(reply),
    body: `#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shard_of_cases() {
        let cases = [
            ("alpha", 8, 101),
            ("beta", 16, 202),
        ];
        for (key, buckets, want) in cases {
            assert_eq!(shard_of(key, buckets), want);
        }
    }

    #[test]
    fn shard_of_rejects_zero_buckets() {
        assert_eq!(shard_of("alpha", 0), 0);
    }
}`,
    literalBody: `#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn brace_of_cases() {
        // an unmatched } and a stray ( live in this comment
        let cases = [
            ("{", "}"),
            ("(", ")"),
        ];
        for (open, want) in cases {
            assert_eq!(brace_of(open), want);
        }
    }
}`,
    ghostBase: `#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shard_of_alpha() {
        __EX__
        assert_eq!(shard_of("alpha", 8), 101);
    }

    #[test]
    fn shard_of_beta() {
        assert_eq!(shard_of("beta", 16), 202);
    }
}`,
    exPlain: `let example = "shard";`,
    exGhostString: `let example = "#[test] fn ghost() {}";`,
    exGhostComment: `// #[test] fn ghost() {}`,
    plainFunction: `pub fn shard_of(key: &str, buckets: usize) -> usize {
    let mut h = 0usize;
    for b in key.as_bytes() {
        h = h * 31 + *b as usize;
    }
    h % buckets
}`,
    // Rule 6's adversary: the word "mod" is in the FUNCTION NAME, "mod tests"
    // and "#[test]" appear only inside a comment and a string literal. A
    // substring check passes this. Neutralised text does not.
    plainFunctionWearingTheWords: `pub fn mod_of(key: &str, buckets: usize) -> usize {
    // the tests for this live in a mod tests block, with a #[test] on each fn
    let example = "#[test] fn shard_of_cases() {}";
    key.len() % buckets
}`,
    proseWithMatch:
      "You could write a mod tests block with a #[test] fn shard_of_cases in it (one case per bucket count.",
    openString: `fn extra() {
    let s = "the remaining cases are`,
    openBlockComment: `/* the remaining cases are`,
  },

  {
    id: "go",
    fence: "go",
    fnName: "extractTestFunctions",
    extract: (reply) => extractTestFunctions(reply, "go"),
    body: `func TestShardOf(t *testing.T) {
	cases := []struct {
		name    string
		key     string
		buckets int
		want    int
	}{
		{"alpha", "a", 8, 101},
		{"beta", "b", 16, 202},
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

func TestShardOfZeroBuckets(t *testing.T) {
	if got := ShardOf("alpha", 0); got != 0 {
		t.Errorf("want 0, got %v", got)
	}
}`,
    literalBody: `func TestBraceOf(t *testing.T) {
	// an unmatched } and a stray ( live in this comment
	cases := []struct {
		open string
		want string
	}{
		{"{", "}"},
		{"(", ")"},
	}
	for _, tt := range cases {
		if got := BraceOf(tt.open); got != tt.want {
			t.Errorf("BraceOf() = %v, want %v", got, tt.want)
		}
	}
}`,
    ghostBase: `func TestShardOfAlpha(t *testing.T) {
	__EX__
	if got := ShardOf("alpha", 8); got != 101 {
		t.Errorf("alpha")
	}
}

func TestShardOfBeta(t *testing.T) {
	if got := ShardOf("beta", 16); got != 202 {
		t.Errorf("beta")
	}
}`,
    exPlain: `example := "shard"`,
    exGhostString: `example := "func TestGhost(t *testing.T) {}"`,
    exGhostComment: `// func TestGhost(t *testing.T) {}`,
    plainFunction: `func ShardOf(key string, buckets int) int {
	h := 0
	for _, b := range []byte(key) {
		h = h*31 + int(b)
	}
	return h % buckets
}`,
    plainFunctionWearingTheWords: `func ShardOf(key string, buckets int) int {
	// the table for this lives in func TestShardOf(t *testing.T) elsewhere
	example := "func TestShardOf(t *testing.T) {}"
	_ = example
	return len(key) % buckets
}`,
    proseWithMatch:
      "You could add func TestShardOf(t *testing.T) to shard_test.go [one case per bucket count.",
    openString: `func TestExtra(t *testing.T) {
	s := "the remaining cases are`,
    openBlockComment: `/* the remaining cases are`,
  },

  {
    id: "typescript",
    fence: "typescript",
    fnName: "extractTestFunctions",
    extract: (reply) => extractTestFunctions(reply, "typescript"),
    body: `it.each([
  ["alpha", 8, 101],
  ["beta", 16, 202],
])("shardOf(%s, %i)", (key, buckets, want) => {
  expect(shardOf(key, buckets)).toBe(want);
});

it("returns 0 when there are no buckets", () => {
  expect(shardOf("alpha", 0)).toBe(0);
});`,
    literalBody: `it.each([
  ["{", "}"],
  ["(", ")"],
])("braceOf(%s)", (open, want) => {
  // an unmatched } and a stray ( live in this comment
  expect(braceOf(open)).toBe(want);
});`,
    ghostBase: `it("shards alpha", () => {
  __EX__
  expect(shardOf("alpha", 8)).toBe(101);
});

it("shards beta", () => {
  expect(shardOf("beta", 16)).toBe(202);
});`,
    exPlain: `const example = "shard";`,
    exGhostString: `const example = 'it("ghost", () => {});';`,
    exGhostComment: `// it("ghost", () => {});`,
    plainFunction: `export function shardOf(key: string, buckets: number): number {
  let h = 0;
  for (const ch of key) {
    h = h * 31 + ch.charCodeAt(0);
  }
  return h % buckets;
}`,
    plainFunctionWearingTheWords: `export function shardOf(key: string, buckets: number): number {
  // covered by it("shards alpha", ...) in the spec file
  const example = 'it("shards alpha", () => {});';
  return key.length % buckets;
}`,
    proseWithMatch:
      'You could add it("shards alpha", () => expect(shardOf("alpha", 8)).toBe(101)); to the spec file {one case per bucket count.',
    openString: `it("extra", () => {
  const s = "the remaining cases are`,
    openBlockComment: `/* the remaining cases are`,
  },

  {
    id: "python",
    fence: "python",
    fnName: "extractTestFunctions",
    extract: (reply) => extractTestFunctions(reply, "python"),
    body: `@pytest.mark.parametrize("key,buckets,want", [
    ("alpha", 8, 101),
    ("beta", 16, 202),
])
def test_shard_of(key, buckets, want):
    assert shard_of(key, buckets) == want


def test_shard_of_zero_buckets():
    assert shard_of("alpha", 0) == 0`,
    literalBody: `@pytest.mark.parametrize("open_ch,want", [
    ("{", "}"),
    ("(", ")"),
])
def test_brace_of(open_ch, want):
    # an unmatched } and a stray ( live in this comment
    assert brace_of(open_ch) == want`,
    ghostBase: `def test_shard_of_alpha():
    __EX__
    assert shard_of("alpha", 8) == 101


def test_shard_of_beta():
    assert shard_of("beta", 16) == 202`,
    exPlain: `example = "shard"`,
    exGhostString: `example = "def test_ghost(x):"`,
    exGhostComment: `# def test_ghost(x):`,
    plainFunction: `def shard_of(key, buckets):
    h = 0
    for ch in key:
        h = h * 31 + ord(ch)
    return h % buckets`,
    plainFunctionWearingTheWords: `def shard_of(key, buckets):
    # covered by def test_shard_of(key, buckets, want) in the test module
    example = "def test_shard_of(key, buckets, want):"
    return len(key) % buckets`,
    proseWithMatch:
      "You could add def test_shard_of(key, buckets, want): to the test file (one case per bucket count.",
    openString: `def test_extra():
    s = "the remaining cases are`,
    openBlockComment: `"""the remaining cases are`,
  },

  {
    id: "csharp",
    fence: "csharp",
    fnName: "extractTestFunctions",
    extract: (reply) => extractTestFunctions(reply, "csharp"),
    body: `[Theory]
[InlineData("alpha", 8, 101)]
[InlineData("beta", 16, 202)]
public void ShardOfCases(string key, int buckets, int want)
{
    Assert.Equal(want, ShardOf(key, buckets));
}

[Fact]
public void ShardOfZeroBuckets()
{
    Assert.Equal(0, ShardOf("alpha", 0));
}`,
    literalBody: `[Theory]
[InlineData("{", "}")]
[InlineData("(", ")")]
public void BraceOfCases(string open, string want)
{
    // an unmatched } and a stray ( live in this comment
    Assert.Equal(want, BraceOf(open));
}`,
    ghostBase: `[Fact]
public void ShardsAlpha()
{
    __EX__
    Assert.Equal(101, ShardOf("alpha", 8));
}

[Fact]
public void ShardsBeta()
{
    Assert.Equal(202, ShardOf("beta", 16));
}`,
    exPlain: `var example = "shard";`,
    exGhostString: `var example = "[Fact] public void Ghost() { }";`,
    exGhostComment: `// [Fact] public void Ghost() { }`,
    plainFunction: `public int ShardOf(string key, int buckets)
{
    var h = 0;
    foreach (var ch in key)
    {
        h = h * 31 + ch;
    }
    return h % buckets;
}`,
    plainFunctionWearingTheWords: `public int ShardOf(string key, int buckets)
{
    // covered by the [Fact] public void ShardsAlpha() method in the test class
    var example = "[Fact] public void ShardsAlpha() { }";
    return key.Length % buckets;
}`,
    proseWithMatch:
      "You could add a [Fact] public void ShardOfCases() method to the test class (one case per bucket count.",
    openString: `[Fact]
public void Extra()
{
    var s = "the remaining cases are`,
    openBlockComment: `/* the remaining cases are`,
  },
];

const okShape = (label, reply, res) => {
  assert.ok(
    res !== undefined && res !== null,
    show(label, reply, res)
  );
  assert.strictEqual(typeof res.text, "string", show(`${label}: text is not a string`, reply, res));
  assert.ok(
    Number.isInteger(res.testCount) && res.testCount >= 1,
    show(`${label}: [P8 §4] an accepted reply carries at least one test, so testCount must be a positive integer`, reply, res)
  );
  return res;
};

// The fenced call on the same body, captured fresh. Rule 1 makes this the
// reference value for everything the bare path is compared against.
const fencedResultOf = (lang, body, marker = FENCE) => {
  const reply = fencedOf(lang, body, marker);
  const res = lang.extract(reply);
  okShape(`[P8 §1] ${lang.id}: the FENCED baseline (marker ${marker}) was itself refused, so no differential row below can mean anything`, reply, res);
  return res;
};

// ===========================================================================
// Rule 1. The fenced path is the ollama measurement baseline and does not move.
// ===========================================================================

for (const lang of LANGS) {
  gtest(`[P8 §1 the fenced path is unchanged] ${lang.id}: a complete fenced block is accepted and its text carries no fence line`, () => {
    const reply = fencedOf(lang, lang.body);
    const res = okShape(`${lang.id}: a complete fenced block was refused by ${lang.fnName}`, reply, lang.extract(reply));
    assert.ok(
      !hasFenceLine(res.text),
      show(`[P8 §1] ${lang.id}: the extracted text carries a fence line, so a ${FENCE} would be spliced into a source file`, reply, res)
    );
    assert.strictEqual(
      res.text.trim(),
      lang.body.trim(),
      show(`[P8 §1] ${lang.id}: the fenced block's text is not the block's own content`, reply, res)
    );
  });

  gtest(`[P8 §1 job 1, the fence still delimits a chatty reply] ${lang.id}: prose before and after the block is not in the text`, () => {
    const baseline = fencedResultOf(lang, lang.body);
    const reply =
      "Sure! Here are the tests you asked for:\n\n" +
      fencedOf(lang, lang.body) +
      "\nLet me know if you want more cases.\n";
    const res = okShape(`${lang.id}: a chatty fenced reply was refused; §1 says the fenced path does not move`, reply, lang.extract(reply));
    assert.deepStrictEqual(
      { text: res.text, testCount: res.testCount },
      { text: baseline.text, testCount: baseline.testCount },
      show(`[P8 §1] ${lang.id}: a chatty reply returned something different from the same block sent alone. The fence is what separates prose from code and that job is untouched by this phase`, reply, res)
    );
    for (const sentence of ["Sure!", "Let me know"]) {
      assert.ok(
        !res.text.includes(sentence),
        show(`[P8 §1] ${lang.id}: the prose ${JSON.stringify(sentence)} survived into the extracted text`, reply, res)
      );
    }
  });
}

for (const lang of LANGS) {
  gtest(`[P8 §1 + amendment 1, a ~~~ block is a fence too] ${lang.id}: a tilde-fenced block extracts, and the marker is not in the text`, () => {
    const baseline = fencedResultOf(lang, lang.body);
    const reply = fencedOf(lang, lang.body, TILDE);
    const res = okShape(`${lang.id}: a complete ~~~ block was refused; amendment 1 records that ~~~ is a supported fence today and blind-v8-testgen pins it`, reply, lang.extract(reply));
    assert.ok(
      !hasFenceLine(res.text),
      show(`[P8 §2] ${lang.id}: the ~~~ marker survived into the extracted text`, reply, res)
    );
    assert.deepStrictEqual(
      { text: res.text, testCount: res.testCount },
      { text: baseline.text, testCount: baseline.testCount },
      show(`[P8 §1] ${lang.id}: the same tests answered differently under ~~~ than under three backticks`, reply, res)
    );
  });
}

// ===========================================================================
// Rule 2. Eligibility is textual: NO line whose trimmed form starts with a
// fence marker of EITHER kind. Any fence line at all takes the reply off the
// bare path.
//
// These rows are the adversary for a naive fix. "extractFirstCodeBlock found
// nothing, so use the whole reply" returns a reply with a ``` line in it, and
// that line is then written into a source file.
// ===========================================================================

for (const lang of LANGS) {
  const cases = [
    ["a stray CLOSING fence after the tests", `${lang.body}\n${FENCE}\n`],
    ["a stray OPENING fence and no closer", `${FENCE}${lang.fence}\n${lang.body}\n`],
    ["a fence line between two halves", `${lang.body}\n${FENCE}\n${lang.body}\n`],
    ["a stray CLOSING ~~~ after the tests", `${lang.body}\n${TILDE}\n`],
    ["a stray OPENING ~~~ and no closer", `${TILDE}${lang.fence}\n${lang.body}\n`],
    ["a ~~~ opener closed by three backticks", `${TILDE}${lang.fence}\n${lang.body}\n${FENCE}\n`],
  ];

  for (const [what, reply] of cases) {
    gtest(`[P8 §2 a reply carrying any fence line is NOT eligible] ${lang.id}: ${what}`, () => {
      const res = lang.extract(reply);
      if (res === undefined) return; // a malformed block keeps failing, which §2 allows
      assert.ok(
        !hasFenceLine(res.text),
        show(`[P8 §2] ${lang.id}: ${what} was accepted WITH its fence line still in the text. This is the naive fix - no complete block was found, so the whole reply was used - and it splices a ${FENCE} line into the source file`, reply, res)
      );
      assert.notStrictEqual(
        res.text.trim(),
        reply.trim(),
        show(`[P8 §2] ${lang.id}: ${what} came back as the WHOLE reply. §2 says a reply carrying any fence line is not eligible for the bare path`, reply, res)
      );
    });
  }
}

gtest("[P8 §2 'no line whose TRIMMED form starts with a fence marker'] rust: a fence inside a // comment is not a fence line, so the reply stays eligible", () => {
  const lang = LANGS[0];
  const reply = `#[cfg(test)]
mod tests {
    use super::*;

    // Example:
    // ${FENCE}rust
    // shard_of("alpha", 8)
    // ${FENCE}
    #[test]
    fn shard_of_alpha() {
        assert_eq!(shard_of("alpha", 8), 101);
    }
}`;
  const res = okShape(
    "[P8 §2] rust: every line here trims to something starting with `//` or with code, so by §2's own definition there is NO fence line and the reply is eligible. It was refused",
    reply,
    lang.extract(reply)
  );
  assert.strictEqual(
    res.text,
    reply.trim(),
    show("[P8 §5] rust: an accepted bare reply's text is the trimmed reply itself", reply, res)
  );
});

gtest("[P8 §2 'no line whose TRIMMED form starts with a fence marker'] python: a docstring fence IS a fence line, so the reply is ineligible", () => {
  const lang = LANGS.find((l) => l.id === "python");
  const reply = `def test_shard_of():
    """
    ${FENCE}python
    shard_of("alpha", 8)
    ${FENCE}
    """
    assert shard_of("alpha", 8) == 101`;
  const res = lang.extract(reply);
  assert.strictEqual(
    res,
    undefined,
    show("[P8 §2] python: the docstring's fence lines trim to three backticks, so this reply is NOT eligible for the bare path, and the block those fences delimit holds no test pattern. §2 + §4 refuse it", reply, res)
  );
});

// ===========================================================================
// Rule 3. Structural completeness, read through the comment/string lens.
//
// The truncation case is not hypothetical: the contract records a reply in the
// measured arm that ran to 2,809 output tokens because the CLI ignores
// maxTokens. A naive fix ships half a test module into the document.
// ===========================================================================

for (const lang of LANGS) {
  const cut = lang.body.indexOf("202");
  const truncations = [
    ["cut mid-table, the row list left open", lang.body.slice(0, cut >= 0 ? cut + 3 : Math.floor(lang.body.length / 2))],
    ["a string literal left open", `${lang.body}\n\n${lang.openString}`],
    ["a block comment left open", `${lang.body}\n\n${lang.openBlockComment}`],
    ["every delimiter opened, none closed", `([{\n${lang.body}`],
    ["the last closing delimiter deleted", dropLastCloser(lang.body)],
  ];

  assert.notStrictEqual(
    truncations[4][1],
    lang.body,
    `fixture bug: ${lang.id}'s "last closing delimiter deleted" mutation changed nothing, so that row would assert a WELL FORMED reply is refused`
  );

  for (const [what, reply] of truncations) {
    gtest(`[P8 §3 a truncated bare reply is REFUSED] ${lang.id}: ${what}`, () => {
      const res = lang.extract(reply);
      assert.strictEqual(
        res,
        undefined,
        show(`[P8 §3] ${lang.id}: ${what}. The reply is not structurally complete, so it must be refused. Accepting it writes half a test module into the human's file`, reply, res)
      );
    });
  }

  gtest(`[P8 §3 the lens is neutralised text] ${lang.id}: braces and parens inside strings and comments do not make a complete reply look truncated`, () => {
    // The fenced control first, so a failure below cannot be blamed on the
    // fixture: these tests ARE acceptable tests, they are just unfenced.
    fencedResultOf(lang, lang.literalBody);
    const reply = lang.literalBody;
    const res = okShape(
      `[P8 §3] ${lang.id}: every delimiter OUTSIDE a comment or a string is closed here; the unmatched ones are all inside a string literal or a comment, which §3 says is the lens. A raw brace count refuses this good reply`,
      reply,
      lang.extract(reply)
    );
    assert.strictEqual(
      res.text,
      reply.trim(),
      show(`[P8 §5] ${lang.id}: text is the trimmed reply itself`, reply, res)
    );
  });

  gtest(`[P8 §3 leading and trailing blank lines are trimmed first] ${lang.id}: a padded reply is still complete, and text loses the padding`, () => {
    const reply = `\n\n\n${lang.body}\n\n   \n\n`;
    const res = okShape(`[P8 §3] ${lang.id}: a reply padded with blank lines was refused; §3 trims them before judging completeness`, reply, lang.extract(reply));
    assert.strictEqual(
      res.text,
      lang.body.trim(),
      show(`[P8 §5] ${lang.id}: text must be the TRIMMED reply, with the padding gone`, reply, res)
    );
  });
}

// ===========================================================================
// Rule 4. Every guard a fenced block faces, a bare reply faces too.
// ===========================================================================

for (const id of ["ruby", "cobol", "plaintext", "", "javascriptreact"]) {
  gtest(`[P8 §4 an unregistered languageId answers undefined BEFORE anything else] ${JSON.stringify(id)}: refused fenced and bare alike`, () => {
    const lang = LANGS.find((l) => l.id === "python");
    for (const [what, reply] of [
      ["a bare, perfectly formed test reply", lang.body],
      ["a fenced, perfectly formed test reply", fencedOf(lang, lang.body)],
    ]) {
      const res = extractTestFunctions(reply, id);
      assert.strictEqual(
        res,
        undefined,
        show(`[P8 §4] languageId ${JSON.stringify(id)} is not registered, so ${what} must answer undefined before any shape work happens`, reply, res)
      );
    }
  });
}

gtest("[P8 §4 the language's own pattern still gates] a python body offered as go is refused", () => {
  const py = LANGS.find((l) => l.id === "python");
  const res = extractTestFunctions(py.body, "go");
  assert.strictEqual(
    res,
    undefined,
    show("[P8 §4] a bare reply must match THAT language's TEST_FUNCTION_SHAPES pattern; python's `def test_` is not a Go test function", py.body, res)
  );
});

gtest("[P8 §4 rust needs the mod wrapper AND a #[test]] a mod with no #[test] in it is refused", () => {
  const reply = `#[cfg(test)]
mod tests {
    use super::*;

    fn helper(key: &str) -> usize {
        key.len()
    }
}`;
  const res = extractTestModule(reply);
  assert.strictEqual(
    res,
    undefined,
    show("[P8 §4] the module wrapper is there but no #[test] is, so there is nothing to run and the reply is refused", reply, res)
  );
});

gtest("[P8 §4 rust needs the mod wrapper AND a #[test]] bare #[test] fns with no mod wrapper are refused", () => {
  const reply = `#[test]
fn shard_of_alpha() {
    assert_eq!(shard_of("alpha", 8), 101);
}

#[test]
fn shard_of_beta() {
    assert_eq!(shard_of("beta", 16), 202);
}`;
  const res = extractTestModule(reply);
  assert.strictEqual(
    res,
    undefined,
    show("[P8 §4] extractTestModule wants a MODULE. Loose #[test] fns have no mod wrapper, and §4 says the wrapper guard applies to a bare reply unchanged", reply, res)
  );
});

for (const lang of LANGS) {
  gtest(`[P8 §4 counted on NEUTRALISED text] ${lang.id}: a test-shaped string literal and a test-shaped comment do not raise testCount`, () => {
    const plain = lang.ghostBase.replace("__EX__", lang.exPlain);
    const inString = lang.ghostBase.replace("__EX__", lang.exGhostString);
    const inComment = lang.ghostBase.replace("__EX__", lang.exGhostComment);

    // The FENCED control: today's counter already neutralises. §4 says the bare
    // path inherits that unchanged, so the fenced side proves the fixture and
    // the bare side below is the only thing this row can be failing on.
    const fencedBase = fencedResultOf(lang, plain);
    for (const [what, body] of [["a string literal", inString], ["a comment", inComment]]) {
      const fencedRes = fencedResultOf(lang, body);
      assert.strictEqual(
        fencedRes.testCount,
        fencedBase.testCount,
        show(`[P8 §4] ${lang.id}: FENCED, a test-shaped payload inside ${what} was counted as a real test. The count is taken on neutralised text`, fencedOf(lang, body), fencedRes)
      );
    }

    const base = okShape(`[P8 §4] ${lang.id}: the plain two-test reply was refused on the bare path`, plain, lang.extract(plain));

    for (const [what, reply] of [["a string literal", inString], ["a comment", inComment]]) {
      const res = okShape(`[P8 §4] ${lang.id}: the same two tests, with a test-shaped payload in ${what}, were refused`, reply, lang.extract(reply));
      assert.strictEqual(
        res.testCount,
        base.testCount,
        show(`[P8 §4] ${lang.id}: a test-shaped payload inside ${what} was counted as a real test. §4 says the count is taken on neutralised text, on the bare path exactly as on the fenced one`, reply, res)
      );
    }
  });
}

// ===========================================================================
// Rule 5, the DIFFERENTIAL. A bare and a fenced copy of the same tests answer
// with the same text and the same count. The fenced side is captured, never
// hand-written.
// ===========================================================================

for (const lang of LANGS) {
  gtest(`[P8 §5 bare and fenced agree] ${lang.id}: the same tests, sent bare, give the fenced text and the fenced testCount`, () => {
    const baseline = fencedResultOf(lang, lang.body);
    const reply = lang.body;
    const res = okShape(
      `[P8 §5] ${lang.id}: the FENCED copy of these tests is accepted, and the bare copy - the Claude Code backend's every reply - is refused. This is the defect the phase exists to close`,
      reply,
      lang.extract(reply)
    );
    assert.strictEqual(
      res.text,
      reply.trim(),
      show(`[P8 §5] ${lang.id}: text for an accepted bare reply is the trimmed reply itself`, reply, res)
    );
    assert.strictEqual(
      res.testCount,
      baseline.testCount,
      show(`[P8 §5] ${lang.id}: bare counted ${res.testCount} where the fenced copy of the SAME tests counted ${baseline.testCount}. §5 says the two must agree`, reply, res)
    );
    assert.strictEqual(
      res.text.trim(),
      baseline.text.trim(),
      show(`[P8 §5] ${lang.id}: bare and fenced returned different text for the same tests`, reply, res)
    );
  });

  gtest(`[P8 §5 bare and fenced agree] ${lang.id}: the same holds for the literal-heavy body`, () => {
    const baseline = fencedResultOf(lang, lang.literalBody);
    const reply = lang.literalBody;
    const res = okShape(`[P8 §5] ${lang.id}: the literal-heavy body is accepted fenced and refused bare`, reply, lang.extract(reply));
    assert.strictEqual(
      res.testCount,
      baseline.testCount,
      show(`[P8 §5] ${lang.id}: bare and fenced counts disagree on the literal-heavy body`, reply, res)
    );
  });
}

// ===========================================================================
// Rule 6. A bare plain FUNCTION is still refused in Rust. This is the whole
// reason the test pass cannot reuse extractRequestedFunction, and it is the
// first thing a naive "just use the whole reply" fix destroys.
// ===========================================================================

gtest("[P8 §6 a bare plain FUNCTION is refused] rust: an implementation, not a test module", () => {
  const lang = LANGS[0];
  const reply = lang.plainFunction;
  const res = extractTestModule(reply);
  assert.strictEqual(
    res,
    undefined,
    show("[P8 §6] rust: this reply is structurally complete and is nothing but code, yet it is an IMPLEMENTATION. §4's mod wrapper must refuse it. Accepting it writes the function under test into the test file", reply, res)
  );
});

gtest("[P8 §6 a bare plain FUNCTION is refused] rust: `mod` in the fn NAME, `mod tests` in a comment, `#[test]` in a string literal", () => {
  const lang = LANGS[0];
  const reply = lang.plainFunctionWearingTheWords;
  const res = extractTestModule(reply);
  assert.strictEqual(
    res,
    undefined,
    show("[P8 §6] rust: every token the wrapper guard keys on is present, and every one of them is inside a comment, a string literal, or an identifier. §4 says the guard reads NEUTRALISED text, so this is still a plain function and is refused", reply, res)
  );
});

for (const lang of LANGS.slice(1)) {
  gtest(`[P8 §6 + §4 a bare plain FUNCTION is refused] ${lang.id}: an implementation carries no test pattern`, () => {
    const res = lang.extract(lang.plainFunction);
    assert.strictEqual(
      res,
      undefined,
      show(`[P8 §6] ${lang.id}: a complete, fence-free implementation is not a test. §4's pattern guard must refuse it`, lang.plainFunction, res)
    );
  });

  gtest(`[P8 §6 + §4 a bare plain FUNCTION is refused] ${lang.id}: even when the test's own shape appears in a comment and a string`, () => {
    const res = lang.extract(lang.plainFunctionWearingTheWords);
    assert.strictEqual(
      res,
      undefined,
      show(`[P8 §6] ${lang.id}: the test shape appears only inside a comment and a string literal, and §4 counts on neutralised text, so the pattern count is zero and the reply is refused`, lang.plainFunctionWearingTheWords, res)
    );
  });
}

// ===========================================================================
// Rule 7. Prose is refused. The second row of each pair is the one that goes
// wrong under a careless fix: the sentence CONTAINS a test-shaped match, and
// what refuses it is §3, because English does not balance its brackets.
// ===========================================================================

for (const lang of LANGS) {
  gtest(`[P8 §7 bare PROSE is refused] ${lang.id}: an apology carries no tests`, () => {
    const res = lang.extract(APOLOGY);
    assert.strictEqual(
      res,
      undefined,
      show(`[P8 §7] ${lang.id}: a refusal from the model is prose. Accepting it writes an apology into a source file`, APOLOGY, res)
    );
  });

  gtest(`[P8 §7 bare PROSE is refused] ${lang.id}: a sentence carrying a test-shaped match is caught by §3's bracket balance`, () => {
    const reply = lang.proseWithMatch;
    const res = lang.extract(reply);
    assert.strictEqual(
      res,
      undefined,
      show(`[P8 §7] ${lang.id}: this sentence contains a real pattern match, so §4 alone will not refuse it. §3 must: the sentence opens a bracket it never closes, which is what §7 means by "English does not balance its brackets"`, reply, res)
    );
  });
}

// ===========================================================================
// Rule 8. stripLeadingThink is shared and runs FIRST. The bare row is the
// composed one: strip the think block and the fence lines inside it go with
// it, which is what makes the remaining reply eligible under §2.
// ===========================================================================

const thinkBlock = (fence) =>
  `<think>\nA table is the right shape here. Something like:\n\n` +
  `${FENCE}${fence}\nlet decoy_cases = [("decoy", 1, 999)];\n${FENCE}\n\n` +
  `That is only a sketch, so I will write the real thing now.\n</think>\n`;

// "Surface under contract" puts stripLeadingThink at the CALL SITE: both
// extractors are "reached from fnGenService at the shape === 'test-module'
// branch, AFTER stripLeadingThink". So the production sequence is composed
// here, exactly as fnGenService composes it, rather than assumed to live
// inside the extractors.
const production = (lang, reply) => lang.extract(stripLeadingThink(reply));

for (const lang of LANGS) {
  gtest(`[P8 §8 stripLeadingThink runs FIRST] ${lang.id}: a fenced example inside <think> is never the extracted block, on the FENCED path`, () => {
    const baseline = fencedResultOf(lang, lang.body);
    const reply = `${thinkBlock(lang.fence)}\n${fencedOf(lang, lang.body)}`;

    // Even off the production sequence, the example must never come back.
    const raw = lang.extract(reply);
    if (raw !== undefined) {
      assert.ok(
        !raw.text.includes("decoy"),
        show(`[P8 §8] ${lang.id}: the DECOY inside the <think> block was extracted instead of the real tests`, reply, raw)
      );
    }

    const res = okShape(`[P8 §8] ${lang.id}: the production sequence refused a reply whose think block holds a fenced example`, reply, production(lang, reply));
    assert.ok(
      !res.text.includes("decoy"),
      show(`[P8 §8] ${lang.id}: the DECOY inside the <think> block was extracted instead of the real tests. stripLeadingThink runs first precisely so the example is gone before anything looks for a fence`, reply, res)
    );
    assert.strictEqual(
      res.text.trim(),
      baseline.text.trim(),
      show(`[P8 §8] ${lang.id}: the think block changed what the fenced path returned`, reply, res)
    );
  });

  gtest(`[P8 §8 + §2 stripLeadingThink runs FIRST] ${lang.id}: the fences live only in the <think> block, so the surviving reply is eligible and bare`, () => {
    const reply = `${thinkBlock(lang.fence)}\n${lang.body}`;
    const res = okShape(
      `[P8 §8] ${lang.id}: after stripLeadingThink there is no fence line left anywhere, so §2 says the surviving reply IS eligible for the bare path. It was refused, which means either the bare path is not there or the fence check reads text the think strip has already removed`,
      reply,
      production(lang, reply)
    );
    assert.ok(
      !res.text.includes("decoy"),
      show(`[P8 §8] ${lang.id}: the decoy from the think block survived into the extracted text`, reply, res)
    );
    assert.strictEqual(
      res.text,
      lang.body.trim(),
      show(`[P8 §5] ${lang.id}: text is the trimmed reply that survives the think strip, and nothing else`, reply, res)
    );
  });
}

gtest("[P8 §8 stripLeadingThink stays shared] the exported helper removes a leading think block, decoy fence and all", () => {
  const lang = LANGS[0];
  const reply = `${thinkBlock(lang.fence)}\n${lang.body}`;
  const out = stripLeadingThink(reply);
  assert.strictEqual(typeof out, "string", `stripLeadingThink returned ${typeof out}`);
  for (const gone of ["<think>", "</think>", "decoy"]) {
    assert.ok(
      !out.includes(gone),
      `[P8 §8] stripLeadingThink left ${JSON.stringify(gone)} in its output:\n---- OUT ----\n${out}\n---- END ----`
    );
  }
  assert.strictEqual(
    out.trim(),
    lang.body.trim(),
    `[P8 §8] stripLeadingThink must leave exactly the reply that follows the think block:\n---- OUT ----\n${out}\n---- END ----`
  );
});

// ===========================================================================
// Rule 9. Bare tests plus a trailing prose sentence are REFUSED, not trimmed.
//
// This is the sharpest row in the file. The sentence balances its brackets and
// closes its quotes, so §3 does NOT catch it, and the tests below it are real,
// so §4 does not either. Only "the reply is nothing but the tests" refuses it.
// A fix that splices, or one that quietly drops the sentence and keeps the
// module, fails here - and the second is the more tempting of the two.
// ===========================================================================

for (const lang of LANGS) {
  gtest(`[P8 §9 bare tests plus a TRAILING sentence are refused] ${lang.id}: the sentence balances, so nothing else catches it`, () => {
    const reply = `${lang.body}\n\n${TRAILING_SENTENCE}\n`;
    assert.ok(
      !/[(){}[\]"'`]/.test(TRAILING_SENTENCE),
      "fixture bug: the trailing sentence must carry no bracket and no quote, or §3 would refuse the reply and this row would prove nothing"
    );
    const res = lang.extract(reply);
    assert.strictEqual(
      res,
      undefined,
      show(`[P8 §9] ${lang.id}: the reply is tests followed by a prose sentence that balances its brackets. §9 says REFUSED, not silently trimmed. If the result is the module alone, the fix is splicing on a heuristic boundary; if it is the whole reply, the prose goes into the source file`, reply, res)
    );
  });

  gtest(`[P8 §9 + 'is nothing but the tests'] ${lang.id}: bare tests under a LEADING sentence are refused too`, () => {
    const reply = `${LEADING_SENTENCE}\n\n${lang.body}\n`;
    assert.ok(
      !/[(){}[\]"'`]/.test(LEADING_SENTENCE),
      "fixture bug: the leading sentence must carry no bracket and no quote"
    );
    const res = lang.extract(reply);
    assert.strictEqual(
      res,
      undefined,
      show(`[P8 §9] ${lang.id}: prose before the tests is prose in the reply. The discriminator §"The rule the fence used to carry" lands on is "is a fence, or is nothing but the tests", and this reply is neither. Job 1 - finding code inside a chatty reply - is the FENCE's job and stays the fence's job`, reply, res)
    );
  });

  // Amendment 1 records that blind-v8-testgen already pins this exact shape for
  // Rust and that it must stay green. Derived here independently, and widened to
  // all five languages: an announcement line is prose, and the announcement is
  // the single most likely thing a chatty model puts above a bare module.
  gtest(`[P8 §9 + amendment 1, the announced module] ${lang.id}: "Here is the module, no fence:" above bare tests stays refused`, () => {
    const reply = `Here is the module, no fence:\n${lang.body}`;
    const res = lang.extract(reply);
    assert.strictEqual(
      res,
      undefined,
      show(`[P8 §9] ${lang.id}: this is the shape blind-v8-testgen line 186 already pins for Rust. It is prose plus a module, not "nothing but the tests", and a fix that turns it green has broken rule 9 whatever else it achieves`, reply, res)
    );
  });

  gtest(`[P8 §9 the fenced escape hatch still works] ${lang.id}: the same tests with the same trailing sentence, fenced, are accepted`, () => {
    const baseline = fencedResultOf(lang, lang.body);
    const reply = `${fencedOf(lang, lang.body)}\n${TRAILING_SENTENCE}\n`;
    const res = okShape(`[P8 §9] ${lang.id}: §1 keeps the fenced path exactly as it is; a trailing sentence after a fenced block is job 1 and has always worked`, reply, lang.extract(reply));
    assert.strictEqual(
      res.text.trim(),
      baseline.text.trim(),
      show(`[P8 §1] ${lang.id}: a trailing sentence changed what the fenced path returned`, reply, res)
    );
  });
}

// ===========================================================================
// Rule 10. Nothing on the fn-gen path changes.
// ===========================================================================

test("[P8 §10 the fn-gen path is untouched] postprocessInstructOutput and extractRequestedFunction still exist on the same seam", (ctx) => {
  if (fnGenBundleError) {
    return ctx.skip(
      `the fn-gen bundle failed to build, which is a HARNESS result and not a contract finding unless the exports were renamed: ${fnGenBundleError}`
    );
  }
  assert.strictEqual(
    typeof fnGenMod.postprocessInstructOutput,
    "function",
    "[P8 §10] postprocessInstructOutput is named in the contract as untouched, and it is not exported"
  );
  assert.strictEqual(
    typeof fnGenMod.extractRequestedFunction,
    "function",
    "[P8 §10] extractRequestedFunction is named in the contract as untouched, and it is not exported"
  );
});

gtest("[P8 §10 + §6 the test pass does not become the fn-gen pass] extractTestModule and extractTestFunctions are not extractRequestedFunction", (ctx) => {
  if (fnGenBundleError) return ctx.skip("the fn-gen bundle failed to build; see the §10 row");
  assert.notStrictEqual(
    extractTestModule,
    fnGenMod.extractRequestedFunction,
    "[P8 §6] the rejection of a bare plain function is the whole reason the test pass cannot reuse extractRequestedFunction"
  );
  assert.notStrictEqual(
    extractTestFunctions,
    fnGenMod.extractRequestedFunction,
    "[P8 §6] extractTestFunctions must not be an alias of the fn-gen extractor"
  );
});
