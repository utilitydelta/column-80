// Blind oracle for session-v70 phase 2: the bare path's lexer, per language
// [session-v68/contracts/P8-bare-reply.md, amendment 3; session-v70/goal.md
// defect 1]. Written from the contract and from each language's real literal
// grammar, WITHOUT READING src/** - not one file, not one grep, not one peek
// at the bundled text. An oracle that agreed with the implementation would be
// worthless.
//
// Surface exercised, both through the public seam:
//   extractTestModule(reply)                 ../src/core/instructPostprocess
//   extractTestFunctions(reply, languageId)  ../src/core/instructPostprocess
//
// What this file is for. The bare path lexes five languages with one C-style
// string model: a quote character, backslash escapes inside it, closed by the
// same quote. Four real shapes break it and a good test reply is refused
// (goal.md defect 1). Those four have rows already, in review-v68-p89. This
// file asks the wider question the fix has to answer: is the LEXER right for
// each language, both ways round.
//
// The asymmetry, and why half the rows below are refusals. A false refusal
// costs the user a re-run of the gesture. A FALSE ADMIT splices prose or half
// a string literal into their source file. So every literal shape this file
// says must be admitted is paired with the shape that must still be refused:
// a genuinely unterminated string, a truncated reply, prose after the tests,
// a reply that is not tests at all. The existing P8 refusal rows (contract
// rules 6 to 9) must not widen by one byte, and neither may these.
//
// Each ADMIT row proves its own fixture first: the same body inside a fence is
// run, and the row fails loudly if the FENCED path refuses it. A fixture the
// fenced path will not take proves nothing about the bare path.
//
// A judgement call is marked JUDGEMENT in the row name. The contract does not
// settle it, so the row takes the side that risks a re-run rather than a bad
// splice, and says why in its own comment. That is usually refuse. Where the
// shape is a complete, legal reply the product already admits, the cautious
// side is do-not-move instead, because demanding a refusal there would be
// asking for a NEW outage. Either way a later flip is somebody's decision, not
// an accident.
//
// EXPECTED RED: phase 2 is being written in parallel. A failing assert here is
// a finding. A bundling crash is a harness bug, which is why the bundle row is
// separate and loud.
//
// Run: SKIP_LIVE=1 node --test test/blind-v70-p2-bare-literals.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

let mod = {};
let cleanup = () => {};
let bundleError;
try {
  ({ mod, cleanup } = bundleCore(
    "blind-v70-p2-bare-literals",
    `export { extractTestModule, extractTestFunctions } from "../src/core/instructPostprocess";\n`
  ));
} catch (e) {
  bundleError = e;
}

test.after(() => cleanup());

const { extractTestModule, extractTestFunctions } = mod;

// A broken bundle skips every row instead of firing a wall of TypeErrors, so
// the harness failure stays one loud line.
const gtest = (name, fn) =>
  test(name, (ctx) => {
    if (bundleError) return ctx.skip("bundle failed to build; see the bundle test");
    return fn(ctx);
  });

test("bundle: the v70 phase 2 surface builds and exports extractTestModule + extractTestFunctions", () => {
  assert.strictEqual(
    bundleError,
    undefined,
    `the bundle failed, so every row below is a harness error rather than a finding: ${bundleError}`
  );
  assert.strictEqual(typeof extractTestModule, "function", "extractTestModule(reply) => { text, testCount } | undefined");
  assert.strictEqual(typeof extractTestFunctions, "function", "extractTestFunctions(reply, languageId) => { text, testCount } | undefined");
});

// ===========================================================================
// Mechanics
// ===========================================================================

const FENCE = "```";
// A backtick cannot be typed inside the Go and TypeScript fixtures below
// without fighting the host language, so it is built here once.
const BQ = String.fromCharCode(96);

const FENCE_TAG = {
  rust: "rust",
  go: "go",
  csharp: "csharp",
  typescript: "typescript",
  python: "python",
};

// Rust goes through extractTestModule, which is the rust-only entry point the
// contract names. The other four go through extractTestFunctions.
const extractOf = (lang) =>
  lang === "rust" ? (reply) => extractTestModule(reply) : (reply) => extractTestFunctions(reply, lang);

const fencedOf = (lang, body) => `${FENCE}${FENCE_TAG[lang]}\n${body}\n${FENCE}\n`;

const show = (label, reply, res) =>
  `${label}\n---- REPLY ----\n${reply}\n---- END REPLY ----\n` +
  `---- RESULT ----\n${res === undefined ? "undefined" : JSON.stringify(res, null, 2)}\n---- END RESULT ----`;

// An accepted reply carries text and at least one test. Shared by every ADMIT
// row so the shape check is written once.
const okShape = (label, reply, res) => {
  assert.ok(res !== undefined && res !== null, show(label, reply, res));
  assert.strictEqual(typeof res.text, "string", show(`${label}: text is not a string`, reply, res));
  assert.ok(
    Number.isInteger(res.testCount) && res.testCount >= 1,
    show(`${label}: an accepted reply carries at least one test [P8 rule 4]`, reply, res)
  );
  return res;
};

// ===========================================================================
// The literal shapes that must be ADMITTED.
//
// Every one is legal source in its language and every one is a shape a test
// reply really produces. `why` says what the shape is and what the user loses
// when the lexer gets it wrong: the gesture writes nothing and the product
// says "the model's reply contained no usable tests".
// ===========================================================================

const ADMIT = [
  // -------------------------------------------------------------- rust -----
  {
    lang: "rust",
    name: "char literals holding a quote, an apostrophe, a backslash and an open brace",
    why:
      "Rust char literals are `'\"'`, `'\\''`, `'\\\\'` and `'{'`. The quote inside the first opens a " +
      "phantom string under a C-style model, and `'{'` counts as an unclosed brace unless the char " +
      "literal is real to the lexer. A test that asserts on delimiter characters is the ordinary " +
      "way a parser gets tested, and the user loses the whole reply. Narrowed from the outside: " +
      "the escaped forms already pass, so what this row really holds is the quote and the brace.",
    body: String.raw`#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counts_a_double_quote() {
        assert_eq!(count_char("a\"b", '"'), 1);
    }

    #[test]
    fn counts_the_awkward_chars() {
        assert_eq!(count_char("a'b", '\''), 1);
        assert_eq!(count_char("a\\b", '\\'), 1);
        assert_eq!(count_char("a{b", '{'), 1);
    }
}`,
  },
  {
    lang: "rust",
    name: "lifetimes, which look exactly like an unclosed char literal and are not one",
    why:
      "`<'a>` and `&'a str` carry a lone apostrophe. This is the sibling trap of the char literal " +
      "fix: a lexer that opens a char literal on every `'` swallows the code between two lifetimes " +
      "and the reply goes unbalanced. Helper functions with borrowed returns are common in a test " +
      "module, so a careless fix trades one outage for another.",
    body: String.raw`#[cfg(test)]
mod tests {
    use super::*;

    fn first_word<'a>(s: &'a str) -> &'a str {
        s.split(' ').next().unwrap()
    }

    #[test]
    fn takes_the_first_word() {
        assert_eq!(first_word("alpha beta"), "alpha");
    }
}`,
  },
  {
    lang: "rust",
    name: "raw strings: an odd number of quotes inside r#\"...\"# and a trailing backslash in r\"...\"",
    why:
      "A raw string has no escapes and may hold a bare `\"`, so `r#\"the \" opens\"#` carries three " +
      "quote characters and a C-style pair-them-up model leaves one open to EOF. `r\"C:\\tmp\\\"` ends " +
      "in a backslash, which is legal because a raw string escapes nothing. Both are how a Rust " +
      "test pins rendered output and Windows paths. Neither form is in the goal's list of four " +
      "broken shapes and both are refused today, so raw strings are a fifth.",
    body: String.raw`#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renders_a_bare_quote() {
        assert_eq!(render(), r#"the " opens"#);
    }

    #[test]
    fn keeps_a_trailing_separator() {
        assert_eq!(normalise(r"C:\tmp\"), "c:/tmp/");
    }
}`,
  },
  {
    lang: "rust",
    name: "byte strings and a byte char literal holding a quote",
    why:
      "`b\"...\"` and `b'\"'` are their own literal forms. The byte char is the same trap as the plain " +
      "char literal wearing a prefix, and a lexer that special cases `'` only when it follows " +
      "whitespace or `(` misses it. Byte level tests are exactly where quote characters show up. " +
      "Narrowed from the outside: the byte STRING already passes, so the hole is the byte char.",
    body: String.raw`#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_an_escaped_quote_byte() {
        assert_eq!(first_byte(b"\""), b'"');
    }

    #[test]
    fn reads_a_brace_byte() {
        assert_eq!(first_byte(b"{"), b'{');
    }
}`,
  },
  {
    lang: "rust",
    name: "comment markers living inside string literals",
    why:
      "`\"// not a comment\"` and `\"a /* b\"` are strings, not comments. Get it wrong and the `//` " +
      "eats the rest of the line, including its closing paren and semicolon, or the `/*` opens a " +
      "block comment that never closes and the whole reply reads as truncated. Any test of a " +
      "comment stripper writes this.",
    body: String.raw`#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_a_line_comment() {
        assert_eq!(strip("let x = 1; // not a comment"), "let x = 1; ");
    }

    #[test]
    fn strips_an_unclosed_block_opener() {
        assert_eq!(strip("a /* b"), "a ");
    }
}`,
  },
  {
    lang: "rust",
    name: "block comments NEST, so a brace after the inner close is still commented out",
    why:
      "Rust is one of the few languages whose block comments nest: `/* a /* b */ } */` is one " +
      "comment end to end. A non-nesting lexer ends it at the first `*/` and then reads the stray " +
      "`}` as real code, so a correct module reads as unbalanced. Grammar fact, not a judgement " +
      "call, and commenting out a block of code is the most ordinary way it appears.",
    body: String.raw`#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn depth_of_nested_braces() {
        /* an old case /* with its own comment */ } was removed here */
        assert_eq!(depth("{{}}"), 2);
    }
}`,
  },

  // ---------------------------------------------------------------- go -----
  {
    lang: "go",
    name: "a raw backtick string holding quotes, an unmatched brace and comment markers",
    why:
      "A Go raw string escapes nothing and spans anything short of a backtick. `" + BQ + "f(\"a\") { // x" + BQ + "` " +
      "holds two quotes, an unmatched brace and a line comment marker, all inert. A lexer that " +
      "reads any of them as live code refuses a code generator's golden fixture, which is the " +
      "commonest use of a raw string in a Go test.",
    body:
      `func TestHeaderLine(t *testing.T) {\n` +
      `    if HeaderLine("f") != ${BQ}f("a") { // not a comment${BQ} {\n` +
      `        t.Fatal("bad header")\n` +
      `    }\n` +
      `}`,
  },
  {
    lang: "go",
    name: "a raw backtick string spanning several lines",
    why:
      "A Go raw string carries newlines. A lexer that closes an open literal at end of line leaks " +
      "the brace and the quote on the following lines into the balance count. Multi line golden " +
      "text is the normal shape of a Go table test's want field.",
    body:
      `func TestBlock(t *testing.T) {\n` +
      `    want := ${BQ}if x {\n` +
      `    say("hi")\n` +
      `${BQ}\n` +
      `    if Block() != want {\n` +
      `        t.Fatal("bad block")\n` +
      `    }\n` +
      `}`,
  },
  {
    lang: "go",
    name: "rune literals holding a quote, an apostrophe, a backslash and a brace",
    why:
      "Go runes are `'\"'`, `'\\''`, `'\\\\'` and `'{'`, the same shapes as Rust chars minus the " +
      "lifetime ambiguity, because Go has no lifetimes. Whatever the fix does for Rust must leave " +
      "these standing: a byte or rune scanner test writes them on every line. Goal defect 1 calls " +
      "the char literal hole a Rust problem. Measured here, Go has it too, so the fix is two " +
      "languages wide, not one.",
    body: String.raw`func TestRunes(t *testing.T) {
    if Count("a\"b", '"') != 1 {
        t.Fatal("quote")
    }
    if Count("a'b", '\'') != 1 {
        t.Fatal("apostrophe")
    }
    if Count("a{b", '{') != 1 {
        t.Fatal("brace")
    }
}`,
  },
  {
    lang: "go",
    name: "an interpreted string with escaped quotes and an embedded //",
    why:
      "`\"he said \\\"hi\\\"\"` is one string, and `\"https://x/a\"` is not a comment. This is the side " +
      "the trailing backslash fix must not break: an interpreted Go string DOES process backslash " +
      "escapes, unlike the raw form, so the fix has to split the two rather than drop escaping.",
    body: String.raw`func TestQuoting(t *testing.T) {
    if Quote("hi") != "he said \"hi\"" {
        t.Fatal("quote")
    }
    if Clean("https://example.com/a") != "https://example.com/a" {
        t.Fatal("url")
    }
}`,
  },

  // ------------------------------------------------------------ csharp -----
  {
    lang: "csharp",
    name: "a verbatim string spanning several lines and holding an unmatched brace",
    why:
      "`@\"...\"` runs across newlines and takes a brace as text. A lexer that ends a string at the " +
      "newline reads the following line as code and the count never balances. A SQL or template " +
      "fixture written this way is ordinary C# test material.",
    body: String.raw`[Fact]
public void RendersABlock()
{
    var want = @"if (x)
{";
    Assert.Equal(want, Render("x"));
}`,
  },
  {
    lang: "csharp",
    name: "the doubled \"\" escape inside a verbatim string",
    why:
      "A verbatim string escapes a quote by doubling it, not with a backslash. The fix for " +
      "`@\"C:\\dir\\\"` has to keep this pair rule, because the two live in the same literal: a " +
      "verbatim string that drops escaping entirely closes at the first inner quote and turns the " +
      "rest of the method into a phantom string.",
    body: String.raw`[Fact]
public void QuotesAColumn()
{
    var sql = @"SELECT ""name"" FROM t";
    Assert.Equal(1, ColumnCount(sql));
}`,
  },
  {
    lang: "csharp",
    name: "char literals and an interpolated string carrying braces",
    why:
      "`'\"'` is a char, `$\"{n} of {{total}}\"` is a string whose braces are content and whose `{{` " +
      "is an escaped brace. Reading either as live code unbalances a correct method. Interpolation " +
      "is how nearly every modern C# assertion message is written.",
    body: String.raw`[Fact]
public void FormatsACount()
{
    Assert.Equal('"', Quote());
    Assert.Equal('{', Open());
    var n = 2;
    Assert.Equal("2 of {total}", $"{n} of {{total}}");
}`,
  },
  {
    lang: "csharp",
    name: "JUDGEMENT: a complete C# raw string literal stays admitted",
    why:
      "This one is admitted today, and by luck: a `\"\"\"` fixture with an even number of quote " +
      "characters pairs up under the C-style model and happens to balance. The judgement is that " +
      "phase 2 should not touch C# raw strings at all, so the conservative row is do-not-move " +
      "rather than refuse. Requiring a refusal here would be asking for a NEW false refusal of a " +
      "complete, legal reply, which is the wrong direction to spend on a shape nobody has reported. " +
      "The row exists so a half written triple quote model breaks something loudly, and it pairs " +
      "with the truncated raw string in the REFUSE table.",
    body: String.raw`[Fact]
public void RendersJson()
{
    var want = """{"a": 1}""";
    Assert.Equal(want, Render());
}`,
  },
  {
    lang: "csharp",
    name: "comment markers inside a verbatim string",
    why:
      "`@\"a // b\"` and `@\"a /* b\"` are text. Mis-read, the first eats the closing paren and " +
      "semicolon on that line and the second opens a block comment that swallows the rest of the " +
      "class, so a complete reply reads as truncated.",
    body: String.raw`[Fact]
public void KeepsCommentMarkers()
{
    Assert.Equal("a // b", Echo(@"a // b"));
    Assert.Equal("a /* b", Echo(@"a /* b"));
}`,
  },

  // -------------------------------------------------------- typescript -----
  {
    lang: "typescript",
    name: "single, double and template quotes carrying each other's delimiters",
    why:
      "TypeScript has three string delimiters and each may hold the others verbatim. `\"it's\"` and " +
      "`'say \"hi\"'` are complete strings; a lexer with one quote character in its table opens a " +
      "phantom literal on the inner mark and the reply runs to EOF unterminated.",
    body:
      `it("keeps an apostrophe", () => {\n` +
      `  expect(squash("it's")).toBe('it"s');\n` +
      `});\n` +
      `\n` +
      `it("keeps both quotes", () => {\n` +
      `  expect(join("a", 'b')).toBe(${BQ}a"b'${BQ});\n` +
      `});`,
  },
  {
    lang: "typescript",
    name: "a template literal with ${} interpolation holding a quote and a brace",
    why:
      "A template's `${...}` is live code inside a literal, and the literal text around it may hold " +
      "braces and quotes. Either half read wrongly unbalances the file. Building an expected JSON " +
      "string from a value is the normal use of a template in a spec.",
    body:
      `it("renders json", () => {\n` +
      `  const want = ${BQ}{"a": \${JSON.stringify("b")}}${BQ};\n` +
      `  expect(render()).toBe(want);\n` +
      `});`,
  },
  {
    lang: "typescript",
    name: "a regex literal holding an unmatched brace",
    why:
      "`/^\\{/` is a regex whose brace is a pattern character. With no regex state in the lexer the " +
      "brace counts as an opener that never closes, so the reply reads as truncated and is refused. " +
      "Matching a brace is routine in a formatter or parser spec.",
    body: String.raw`it("matches an opening brace", () => {
  expect(/^\{/.test("{a")).toBe(true);
});`,
  },
  {
    lang: "typescript",
    name: "a regex literal holding quotes, a character class and an escaped slash",
    why:
      "`/[\"']\\//` carries both quote characters and a slash inside the literal. This is the wider " +
      "form of the apostrophe defect: the fix must lex the whole regex, character class included, " +
      "not just tolerate one apostrophe.",
    body: String.raw`it("splits a quoted path", () => {
  expect(/["']\//.test('"/a')).toBe(true);
});`,
  },
  {
    lang: "typescript",
    name: "division is not a regex, twice in one file",
    why:
      "This is the trap that makes regex support dangerous. Two `/` operators in different test " +
      "bodies look like one regex literal spanning both, and a naive detector swallows the closing " +
      "`});` of the first test and the opening of the second, so a correct file reads as " +
      "unbalanced. Arithmetic in a test is not an exotic shape.",
    body: String.raw`it("halves", () => {
  const a = total / 2;
  expect(a).toBe(5);
});

it("quarters", () => {
  const b = total / 4;
  expect(b).toBe(2.5);
});`,
  },
  {
    lang: "typescript",
    name: "a // inside a string is a URL, not a comment",
    why:
      "`\"https://example.com/a\"` is the single most common string in a TypeScript test. Read as a " +
      "comment it eats the rest of the line with its closing delimiters, and the reply is refused.",
    body: String.raw`it("keeps a url", () => {
  expect(clean("https://example.com/a")).toBe("https://example.com/a");
});`,
  },

  // ------------------------------------------------------------ python -----
  {
    lang: "python",
    name: "a triple quoted string holding a single bare quote",
    why:
      "`\"\"\"he said \" once\"\"\"` is one string. Pair the quotes up two at a time and the count comes " +
      "out odd, leaving a literal open to EOF, so a complete module is refused. A triple quote is " +
      "how a Python test writes any expected text with quotes in it.",
    body: String.raw`def test_quote_inside_a_block():
    want = """he said " once"""
    assert render() == want`,
  },
  {
    lang: "python",
    name: "a triple single quoted string holding an apostrophe",
    why:
      "`'''it isn't'''` is legal and its inner apostrophe is content. Counting apostrophes in pairs " +
      "leaves one open. Same mechanism as the row above, other delimiter, and both forms appear in " +
      "generated tests.",
    body: String.raw`def test_apostrophe_inside_a_block():
    want = '''it isn't'''
    assert render() == want`,
  },
  {
    lang: "python",
    name: "an apostrophe in a double quoted string and a quote in a single quoted one",
    why:
      "The must-not-break side of the apostrophe work. `\"it's\"` and `'say \"hi\"'` are already " +
      "correct under a two delimiter model, and the fix for regex and char literals elsewhere must " +
      "leave Python's plain strings exactly where they are. The fixture deliberately does NOT end " +
      "on a string literal, so it isolates the quote mix from the trailing literal defect the next " +
      "row pins.",
    body: String.raw`def test_quote_mix():
    assert squash("it's") == len('say "hi"')`,
  },
  {
    lang: "python",
    name: "an assertion whose expected value is a string literal, at the end of the reply",
    why:
      "Measured from the outside, and it is not a judgement call: `assert f(1) == 1` is admitted and " +
      "`assert f(1) == \"one\"` is refused, same line otherwise. `== 'one'` and `== \"\"\"one\"\"\"` are " +
      "refused too; `== f\"one\"` is admitted, which points at the lens erasing the literal and " +
      "leaving a line that ends in `==`, so a complete assertion reads as an expression cut after " +
      "its operator. Python is the language whose truncation gate leans hardest on that shape " +
      "(amendment 3), and the cost is every Python test that asserts a string value, which is most " +
      "of them.",
    body: String.raw`def test_renders_a_label():
    assert label(1) == "one"`,
  },
  {
    lang: "python",
    name: "a raw string carrying regex escapes and a hash",
    why:
      "`r\"\\d+\\{\"` keeps its backslashes and its brace is pattern text; `r\"a#b\"` has no comment in " +
      "it. A regex fixture is the ordinary reason a Python test reaches for a raw string, and the " +
      "brace inside it must not count as an opener.",
    body: String.raw`def test_raw_pattern():
    assert matches(r"\d+\{", "12{")
    assert matches(r"a#b", "a#b")`,
  },
  {
    lang: "python",
    name: "an f-string with a nested quote and an escaped brace",
    why:
      "`f\"{d['k']} of {{n}}\"` mixes interpolation, an inner single quote and a doubled brace. All " +
      "of it is one literal. Reading the braces as delimiters or the inner quote as an opener " +
      "refuses a correct assertion message.",
    body: String.raw`def test_formats_a_count():
    d = {"k": "v"}
    assert label(d) == f"{d['k']} of {{n}}"`,
  },
  {
    lang: "python",
    name: "a hash inside a string is not a comment",
    why:
      "`\"a # b\"` is text. Read as a comment it removes the rest of the line, including the closing " +
      "paren, and a complete module reads as truncated. Any test of a config or comment parser " +
      "writes this line. The assertion ends on a call, not on a literal, so the row measures the " +
      "hash and nothing else.",
    body: String.raw`def test_keeps_a_hash():
    assert len(strip("a # b")) == 5`,
  },
];

for (const row of ADMIT) {
  gtest(`[v70 D1 ${row.lang}] ADMIT: ${row.name}`, () => {
    const extract = extractOf(row.lang);

    // The fixture proves itself first. If the FENCED path refuses this body,
    // the bare row below would be measuring the fixture, not the lexer.
    const fencedReply = fencedOf(row.lang, row.body);
    const fenced = okShape(
      `[v70 D1] ${row.lang}: the FENCED copy of this fixture was refused, so this row is a fixture problem and not a lexer finding. ${row.why}`,
      fencedReply,
      extract(fencedReply)
    );

    const res = okShape(
      `[v70 D1, goal.md defect 1] ${row.lang}: a complete, legal test reply was REFUSED on the bare path. ${row.why}`,
      row.body,
      extract(row.body)
    );

    assert.strictEqual(
      res.text,
      row.body.trim(),
      show(`[P8 rule 5] ${row.lang}: text for an accepted bare reply is the trimmed reply itself`, row.body, res)
    );
    assert.strictEqual(
      res.testCount,
      fenced.testCount,
      show(
        `[P8 rule 5] ${row.lang}: the bare copy counted ${res.testCount} tests where the fenced copy of the SAME body counted ${fenced.testCount}. A bare and a fenced copy of one reply must agree`,
        row.body,
        res
      )
    );
  });
}

// ===========================================================================
// The shapes that must still be REFUSED.
//
// This is the expensive direction. A widened lexer that admits any of these
// writes a broken literal, or a sentence of English, into the human's source
// file. Several of them are written so they FAIL against a careless version of
// the very fix phase 2 is making: drop backslash escaping everywhere and the
// C# and Rust rows below go green in the wrong direction.
// ===========================================================================

const REFUSE = [
  // -------------------------------------------------------------- rust -----
  {
    lang: "rust",
    name: "a plain string ending in a backslash is genuinely unterminated",
    why:
      "Rust has no verbatim string. `\"C:\\dir\\\"` escapes its own closing quote and the literal " +
      "runs on, which does not compile. The C# fix must be scoped to `@\"...\"` and the Go fix to the " +
      "backtick form; a lexer that stops escaping everywhere admits this and splices a broken " +
      "string into the file.",
    reply: String.raw`#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalises() {
        let root = "C:\dir\";
        assert_eq!(normalise(root), "c:/dir/");
    }
}`,
  },
  {
    lang: "rust",
    name: "a reply truncated inside a raw string",
    why:
      "The model ran out of budget mid literal. The raw string never closes and neither do the two " +
      "braces after it. Admitting a truncated reply is the failure rule 3 exists for, and raw " +
      "string support must not become a way to declare an open literal closed.",
    reply: String.raw`#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renders_a_header() {
        assert_eq!(render(), r#"the header is`,
  },
  {
    lang: "rust",
    name: "an unclosed block comment at the end of the reply",
    why:
      "Rule 3 says no block comment may be left open. Nesting support must count depth, not stop " +
      "checking: a comment opened once and never closed is still truncation, and what lands is a " +
      "file that will not compile.",
    reply: String.raw`#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counts() {
        assert_eq!(count("a"), 1);
    }
}

/* the remaining cases are`,
  },
  {
    lang: "rust",
    name: "tests followed by a sentence carrying an apostrophe and a quote",
    why:
      "Rule 9. The prose is the reason this guard exists, and an apostrophe in it is exactly the " +
      "character the char literal fix teaches the lexer to be relaxed about. If the sentence is " +
      "swallowed as a literal and the reply then reads as complete, the sentence lands in the " +
      "human's source file.",
    reply: String.raw`#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counts_a_double_quote() {
        assert_eq!(count_char("a\"b", '"'), 1);
    }
}

These cases cover the parser's handling of the '"' character and the escape path.`,
  },
  {
    lang: "rust",
    name: "a plain function carrying the tricky char literal, with no test module",
    why:
      "Rule 6. Char literal support widens what the lexer understands, not what counts as tests. An " +
      "implementation is not a test module however well it lexes, and admitting one overwrites the " +
      "human's code with a second copy of it.",
    reply: String.raw`pub fn count_char(s: &str, needle: char) -> usize {
    s.chars().filter(|c| *c == needle).count()
}

pub fn quote() -> char {
    '"'
}`,
  },

  // ---------------------------------------------------------------- go -----
  {
    lang: "go",
    name: "a reply truncated inside a raw backtick string",
    why:
      "The backtick never closes. This is the sibling of the trailing backslash fix: teaching the " +
      "lexer that a raw string escapes nothing must not teach it that an open raw string is fine. " +
      "What lands otherwise is half a golden fixture.",
    reply:
      `func TestBlock(t *testing.T) {\n` +
      `    want := ${BQ}if x {\n` +
      `    say("hi")`,
  },
  {
    lang: "go",
    name: "an interpreted string left open at the end of the reply",
    why:
      "A plain Go string cannot span a newline. Refusing it is the behaviour rule 3 already has and " +
      "no literal work may relax it.",
    reply: String.raw`func TestMessage(t *testing.T) {
    want := "the remaining cases are`,
  },
  {
    lang: "go",
    name: "tests followed by a prose bullet list holding a backtick pair and an apostrophe",
    why:
      "Rule 9, amendment 3. The list's own parens balance and its inline backticks pair, so a lexer " +
      "that treats backticks loosely can read the whole tail as inert and let it through. Prose in " +
      "a .go file is the failure this guard exists to prevent.",
    reply:
      `func TestHeaderLine(t *testing.T) {\n` +
      `    if HeaderLine("f") != ${BQ}f("a") {${BQ} {\n` +
      `        t.Fatal("bad header")\n` +
      `    }\n` +
      `}\n` +
      `\n` +
      `- the table above covers ${BQ}HeaderLine${BQ} and the generator's brace handling (both cases)`,
  },
  {
    lang: "go",
    name: "a plain function with a raw string and no Test shape",
    why:
      "Rule 4. A raw string does not make a function a test. The user asked for tests and would get " +
      "their own implementation written back at them.",
    reply:
      `func HeaderLine(name string) string {\n` +
      `    return ${BQ}func ${BQ} + name + ${BQ}() {${BQ}\n` +
      `}`,
  },

  // ------------------------------------------------------------ csharp -----
  {
    lang: "csharp",
    name: "a NON-verbatim string ending in a backslash is genuinely unterminated",
    why:
      "This is the red before green row for defect 1's C# half. `\"C:\\dir\\\"` without the `@` escapes " +
      "its closing quote and does not compile. The fix must key on the `@` prefix; a lexer that " +
      "simply stops honouring backslashes in C# admits this and writes a broken literal into the " +
      "file. Refusal costs a re-run, this costs a corrupted source file.",
    reply: String.raw`[Fact]
public void Normalises()
{
    var root = "C:\dir\";
    Assert.Equal("c:/dir/", Normalise(root));
}`,
  },
  {
    lang: "csharp",
    name: "a reply truncated inside a verbatim string",
    why:
      "The verbatim string opens and the reply stops. Verbatim support must close the literal on a " +
      "real quote, not by reaching EOF, or every truncated reply that happens to contain an `@\"` " +
      "becomes admissible.",
    reply: String.raw`[Fact]
public void Renders()
{
    var want = @"if (x)
{
    var y = 1;`,
  },
  {
    lang: "csharp",
    name: "a reply truncated inside a C# raw string literal",
    why:
      "The sibling of the complete raw string in the ADMIT table. C# 11 raw strings are not in the " +
      "contract and not in defect 1, so the conservative position is that phase 2 leaves them " +
      "alone: complete ones keep getting through on the quote count, truncated ones keep being " +
      "refused. A half written `\"\"\"` model that closes a literal at EOF would flip this row, and " +
      "what lands then is half a JSON fixture in the human's test class.",
    reply: String.raw`[Fact]
public void RendersJson()
{
    var want = """{"a": 1,`,
  },
  {
    lang: "csharp",
    name: "tests followed by a sentence holding a Windows path and an apostrophe",
    why:
      "Rule 9 with the exact characters verbatim string support relaxes. A backslash and an " +
      "apostrophe in an English sentence must not read as an inert literal that lets the tail " +
      "through, or the sentence is spliced into a .cs file.",
    reply: String.raw`[Fact]
public void Normalises()
{
    var root = @"C:\dir\";
    Assert.Equal("c:/dir/", Normalise(root));
}

Note: this covers the C:\dir\ case and the trailing separator's behaviour.`,
  },
  {
    lang: "csharp",
    name: "an apology carrying a verbatim string in it",
    why:
      "A reply that is not tests at all. Rule 7: no test shape, so it is refused before the lexer " +
      "matters. The row is here because the apology quotes a path and a widened lexer must not turn " +
      "prose into an admissible reply.",
    reply: String.raw`I cannot write these tests without seeing Normalise, but the fixture would use @"C:\dir\" as its input.`,
  },

  // -------------------------------------------------------- typescript -----
  {
    lang: "typescript",
    name: "a reply truncated inside a template literal",
    why:
      "The backtick never closes and the arrow function's brace and paren never close either. " +
      "Template support must not make an open template look shut.",
    reply:
      `it("renders json", () => {\n` +
      `  const want = ${BQ}{"a": 1,`,
  },
  {
    lang: "typescript",
    name: "a reply truncated inside a regex literal",
    why:
      "`expect(/^\\{` stops mid pattern, with the paren and the arrow body still open. Regex support " +
      "is the widest change phase 2 can make to the TypeScript lexer, and this row says it must " +
      "still know when a regex has not ended.",
    reply: String.raw`it("matches an opening brace", () => {
  expect(/^\{`,
  },
  {
    lang: "typescript",
    name: "a single quoted string left open at the end of the reply",
    why:
      "Plain truncation. The apostrophe work teaches the lexer that a `'` is sometimes not a string " +
      "opener, and this row holds the other half: when it IS one and never closes, the reply is " +
      "refused.",
    reply: String.raw`it("names it", () => {
  const label = 'the remaining cases are`,
  },
  {
    lang: "typescript",
    name: "tests followed by a sentence with an apostrophe and a slash",
    why:
      "Rule 9 aimed at the two characters the regex and apostrophe fix relaxes. The sentence's " +
      "parens balance, so only the rule 9 tail gate stands between it and the human's spec file.",
    reply: String.raw`it("matches an apostrophe", () => {
  expect(/it's/.test("it's")).toBe(true);
});

Note: these cases cover the tokeniser's /regex/ path and the apostrophe it holds.`,
  },
  {
    lang: "typescript",
    name: "an implementation whose only test-ish token is a call to .test(), and no test shape",
    why:
      "Rule 6 keeps Rust from taking an implementation as a test module. TypeScript has no `mod` " +
      "wrapper, so the whole job falls on the shape pattern, and the pattern takes `RE.test(s)` as " +
      "a test. Measured: the same reply is admitted through the FENCE too, with and without the " +
      "regex literal, so this is not something phase 2 broke. What phase 2 changed is who reaches " +
      "it. The apostrophe used to make this reply unbalanced, so the bare path refused it by " +
      "accident; a regex aware lexer removes that accident and the loose pattern is all that is " +
      "left. The conservative answer for the bare path is refusal, and amendment 3 already allows " +
      "the bare lens to be narrower than the fenced one in the refusal direction, so closing this " +
      "does not have to move the fenced baseline that rule 1 protects. Left open, a reply that is " +
      "the human's own implementation gets written into their test file as tests, and " +
      "`x.test(str)` is everywhere in string handling code.",
    reply: String.raw`export function hasApostrophe(s: string): boolean {
  return /it's/.test(s);
}`,
  },

  // ------------------------------------------------------------ python -----
  {
    lang: "python",
    name: "a reply truncated inside a triple quoted string",
    why:
      "Rule 3's suite language leg. Python opens no delimiter for a statement, so an open string is " +
      "one of the few truncation signals the lens actually has. Triple quote support must not cost " +
      "it that.",
    reply: String.raw`def test_renders_a_block():
    want = """if x:
    say("hi")`,
  },
  {
    lang: "python",
    name: "a single line string left open",
    why:
      "The same signal in its commonest form. Admitting it writes an unterminated literal into the " +
      "human's test file, which is a syntax error at import time, not at run time.",
    reply: String.raw`def test_message():
    want = "the remaining cases are`,
  },
  {
    lang: "python",
    name: "a reply cut after an operator",
    why:
      "Amendment 3 names this as one of the two shapes Python truncation actually produces. It has " +
      "no unclosed delimiter and no unclosed literal, so only the operator shape catches it, and " +
      "nothing in the literal work may loosen that.",
    reply: String.raw`def test_shard_of_alpha():
    assert shard_of("alpha", 8) ==`,
  },
  {
    lang: "python",
    name: "a header whose suite never arrived",
    why:
      "The other shape amendment 3 names. `def test_b():` with nothing under it is a syntax error, " +
      "and it is what a budget cut off at a function boundary leaves behind.",
    reply: String.raw`def test_a():
    assert shard_of("alpha", 8) == 101


def test_b():`,
  },
  {
    lang: "python",
    name: "tests followed by a sentence with an apostrophe",
    why:
      "Rule 9 for the suite language, where the gate is indentation rather than a closing " +
      "delimiter. The apostrophe is the character the triple quote and quote mix work relaxes, and " +
      "an unindented English sentence must still end the reply's claim to be code.",
    reply: String.raw`def test_quote_inside_a_block():
    want = """he said " once"""
    assert render() == want

These cases cover the renderer's quote handling and the docstring path.`,
  },
  {
    lang: "python",
    name: "an explanation with no test function in it",
    why:
      "Rule 4 and rule 7. No `def test_` shape, so the reply is refused before any literal is " +
      "lexed. The sentence quotes both delimiters on purpose.",
    reply: String.raw`You could assert that render() returns """he said " once""" and that it isn't stripped.`,
  },
];

for (const row of REFUSE) {
  gtest(`[v70 D1 ${row.lang}] REFUSE: ${row.name}`, () => {
    const res = extractOf(row.lang)(row.reply);
    assert.strictEqual(
      res,
      undefined,
      show(
        `[v70 D1, the expensive direction] ${row.lang}: this reply was ADMITTED and must not be. ${row.why}`,
        row.reply,
        res
      )
    );
  });
}
