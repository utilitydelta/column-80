// White-box rows for session-v70 phase 2: per-language literal lexing on the
// BARE reply path [session-v70/goal.md defect 1, session-v68/contracts/P8-bare-reply.md
// rules 3, 4, 6, 7, 9].
//
// The four `[P8 R6*]` rows in review-v68-p89 name the four shapes that were
// refused in the field. These rows sit underneath them and pin the lexer's own
// edges, one at a time, because a lexer written to satisfy four fixtures is a
// lexer with four correct cases in it.
//
// The edges, in the order they appear below, per language:
//   - a quote of one kind sitting inside a literal of another
//   - a delimiter (`{`, `(`, `[`) hiding inside a literal, which must stay
//     invisible to the balance count
//   - EOF inside each literal kind, which is a REFUSAL and the reason the scan
//     answers on the literal rather than on the delimiter count
//   - a backslash as the last character of the reply
//   - the two shapes that look like a literal and are not: a Rust lifetime and
//     a TypeScript division
//
// Every row is stated as ADMIT or REFUSE, never as "returns 3", because the
// asymmetry is the whole design: a false refusal costs a re-run, a false admit
// writes prose or half a string into the human's source file. Where a row is
// an ADMIT it is also red-before-green against the obvious wrong fix, and the
// message says which wrong fix it kills.
//
// Run: SKIP_LIVE=1 node --test test/impl-v70-p2-bare-literals.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

let mod = {};
let cleanup = () => {};
let bundleError;
try {
  ({ mod, cleanup } = bundleCore(
    "impl-v70-p2-bare-literals",
    `export { extractTestModule, extractTestFunctions } from "../src/core/instructPostprocess";\n`
  ));
} catch (e) {
  bundleError = e;
}

test.after(() => cleanup());

const { extractTestModule, extractTestFunctions } = mod;

const itest = (name, fn) =>
  test(name, (ctx) => {
    if (bundleError) return ctx.skip(`bundle failed to build: ${bundleError}`);
    return fn(ctx);
  });

itest("[v70 P2] the bundle builds and both extractors are exported", () => {
  assert.strictEqual(bundleError, undefined, `bundle failed: ${bundleError}`);
  assert.strictEqual(typeof extractTestModule, "function");
  assert.strictEqual(typeof extractTestFunctions, "function");
});

// Rust goes through extractTestModule, the other four through
// extractTestFunctions. Same bare path underneath, different guard on top.
const run = (lang, reply) =>
  lang === "rust" ? extractTestModule(reply) : extractTestFunctions(reply, lang);

const admits = (lang, reply, why) =>
  assert.notStrictEqual(run(lang, reply), undefined, `${why}\n---- REPLY ----\n${reply}`);

const refuses = (lang, reply, why) =>
  assert.strictEqual(run(lang, reply), undefined, `${why}\n---- REPLY ----\n${reply}`);

// Minimal well-formed test files, one per language, so a row's body is the only
// thing under test. Each wrapper already satisfies the guard on top of the bare
// path (the Rust `mod` wrapper, the shape pattern elsewhere), so a REFUSE row
// can only be the lexer refusing.
const rustModule = (body) => `#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn case() {
${body}
    }
}`;

const goFile = (body) => `package main

import "testing"

func TestCase(t *testing.T) {
${body}
}`;

const csharpFile = (body) => `using Xunit;

public class CaseTests
{
    [Fact]
    public void Case()
    {
${body}
    }
}`;

const tsFile = (body) => `import { it, expect } from "vitest";

it("case", () => {
${body}
});`;

const pyFile = (body) => `def test_case():
${body}`;

// ===========================================================================
// Rust: char literals, lifetimes, raw strings, nested block comments
// ===========================================================================

itest("[v70 P2 rust] a char literal holding a double quote does not open a string", () => {
  admits(
    "rust",
    rustModule(`        assert_eq!(split_on('"'), 2);`),
    "the review row's shape, pinned here at the lexer. `'` is not a Rust quote and the `\"` " +
      "inside the char literal used to open a string that ran to EOF."
  );
});

itest("[v70 P2 rust] a char literal holding a BRACE is invisible to the balance count", () => {
  admits(
    "rust",
    rustModule(`        assert_eq!(depth('{'), 1);
        assert_eq!(depth('}'), 0);`),
    "a char literal that is not lexed leaves its brace in the delimiter count, so this module " +
      "reads as one brace short and then one brace over. Both directions are in the row on purpose."
  );
});

itest("[v70 P2 rust] an escaped quote inside a char literal is not the close", () => {
  admits(
    "rust",
    rustModule(`        assert_eq!(quote_char(), '\\'');
        assert_eq!(tab_char(), '\\t');`),
    "`'\\''` is four characters and must be consumed as four. NOT red-before-green, and the row " +
      "says so rather than implying otherwise: a lexer that stops after three leaves a lone `'`, " +
      "and a lone `'` is INERT by design, so the balance count survives the mistake. What is " +
      "pinned here is the value, not a refusal it would cause."
  );
});

itest("[v70 P2 rust] a LIFETIME is not an unterminated char literal", () => {
  admits(
    "rust",
    `#[cfg(test)]
mod tests {
    fn longest<'a>(a: &'a str, b: &'a str) -> &'a str {
        if a.len() > b.len() { a } else { b }
    }

    #[test]
    fn case() {
        assert_eq!(longest("aa", "b"), "aa");
    }
}`,
    "this is the reason `'` cannot simply be added to rust.quotes. Five lifetime sigils here and " +
      "none of them closes; a quote rule refuses every borrowing test there is."
  );
});

itest("[v70 P2 rust] a lifetime and a char literal on the SAME line", () => {
  admits(
    "rust",
    `#[cfg(test)]
mod tests {
    fn holds<'a>(s: &'a str, c: char) -> bool { s.contains(c) }

    #[test]
    fn case() {
        assert!(holds::<'_>("a\\"b", '"'));
    }
}`,
    "the disambiguation is per occurrence, not per file: `'_` on this line is a lifetime and `'\"'` " +
      "on the same line is a literal. A file-level flag would get one of them wrong."
  );
});

itest("[v70 P2 rust] a loop LABEL is inert", () => {
  admits(
    "rust",
    rustModule(`        'outer: loop {
            break 'outer;
        }
        assert!(true);`),
    "`'outer` is neither a literal nor a lifetime and must leave the `'` as an ordinary character. " +
      "Inert is the only safe answer for an unrecognised `'`: it opens nothing and closes nothing."
  );
});

itest("[v70 P2 rust] a raw string carries quotes and braces of its own", () => {
  admits(
    "rust",
    rustModule(`        let json = r#"{"a": [1, 2}"#;
        assert_eq!(parse_err(json).len(), 1);`),
    "a hashed raw string holds a `\"`, an unmatched `}` and an unclosed `[`. All three have to be " +
      "invisible, and the close is `\"#` rather than the first `\"` inside it."
  );
});

itest("[v70 P2 rust] a raw string ending in a backslash keeps its close", () => {
  admits(
    "rust",
    rustModule(`        let p = r"C:\\dir\\";
        assert!(p.ends_with('\\\\'));`),
    "same mechanism as the C# and Go review rows. A raw string takes no backslash escape, so the " +
      "C model eats the closing quote and reports the reply as truncated."
  );
});

itest("[v70 P2 rust] a BYTE raw string is raw as well", () => {
  admits(
    "rust",
    rustModule(`        let p = br"C:\\dir\\";
        assert_eq!(p.len(), 8);`),
    "`br\"`, `cr\"` and `r\"` are all raw. Handle only the bare `r` and the `b` in front of it is a " +
      "word character sitting where the prefix guard is looking, so the whole thing falls back to " +
      "the C model and the trailing backslash eats the close."
  );
});

itest("[v70 P2 rust] an identifier ending in `r` is not a raw prefix", () => {
  admits(
    "rust",
    rustModule(`        let separator = "|";
        assert_eq!(separator, "|");`),
    "the guard for this is defensive: valid Rust cannot put an identifier character immediately " +
      "before `r\"`, so the row is a sanity check and not a falsifier. The guard stays because the " +
      "prefix rules are data and the next one added may not have that property."
  );
});

itest("[v70 P2 rust] EOF inside a raw string is a refusal", () => {
  refuses(
    "rust",
    `#[cfg(test)]
mod tests {
    #[test]
    fn case() {
        let json = r#"{"a": 1}`,
    "rule 3. The reply is cut inside the raw string. Its braces happen to balance, which is exactly " +
      "why an unterminated literal has to be its own answer and not something read off the count."
  );
});

itest("[v70 P2 rust] a backslash as the LAST character of the reply is a refusal", () => {
  refuses(
    "rust",
    `#[cfg(test)]
mod tests {
    #[test]
    fn case() {
        let s = "abc\\`,
    "the escape branch needs a character after the backslash and there is none. Running off the " +
      "end of the text mid-escape must refuse, not fall out of the loop as if the string closed."
  );
});

itest("[v70 P2 rust] a nested block comment hides a brace and a quote", () => {
  admits(
    "rust",
    rustModule(`        /* outer /* inner " { */ still commented */
        assert_eq!(1, 1);`),
    "Rust block comments nest, so the first `*/` closes the inner one only. A non-nesting lexer " +
      "ends the comment early and then sees a stray `\"` and a stray `*/`."
  );
});

itest("[v70 P2 rust] an unclosed block comment is a refusal", () => {
  refuses(
    "rust",
    `#[cfg(test)]
mod tests {
    #[test]
    fn case() {
        assert_eq!(1, 1);
    }
}
/* trailing note about the`,
    "rule 3 names an open block comment alongside an open literal. The braces all closed before it."
  );
});

// ===========================================================================
// Go: raw backtick strings and runes
// ===========================================================================

itest("[v70 P2 go] a raw backtick string holds quotes and braces", () => {
  admits(
    "go",
    goFile("\tjson := `{\"a\": [1}`\n\tif Parse(json) == nil {\n\t\tt.Fatal(\"want an error\")\n\t}"),
    "a Go raw string takes no escapes at all, so everything up to the next backtick is body: the " +
      "`\"` pair, the unmatched `}` and the unclosed `[`."
  );
});

itest("[v70 P2 go] a raw backtick string spanning lines", () => {
  admits(
    "go",
    goFile("\twant := `line one\nline \"two\"\n`\n\tif Render() != want {\n\t\tt.Fatal(\"bad\")\n\t}"),
    "the blanking has to keep the newlines, or every line number after a multi-line literal shifts " +
      "and the tail gate reads the wrong last line."
  );
});

itest("[v70 P2 go] EOF inside a raw backtick string is a refusal", () => {
  refuses(
    "go",
    "package main\n\nimport \"testing\"\n\nfunc TestCase(t *testing.T) {\n\twant := `C:\\dir",
    "rule 3, and the direction that matters: a raw string with no close is truncation, not a " +
      "backtick that happens to be decorative."
  );
});

itest("[v70 P2 go] a rune literal holding a quote is not a string opener", () => {
  admits(
    "go",
    goFile("\tif Quote() != '\"' {\n\t\tt.Fatal(\"bad\")\n\t}\n\tif Escaped() != '\\'' {\n\t\tt.Fatal(\"bad\")\n\t}"),
    "Go has no lifetimes, so `'` here is unambiguous, but it still gets the bounded rule rather " +
      "than a quotes entry: an unrecognised apostrophe stays inert instead of opening a phantom string."
  );
});

itest("[v70 P2 go] an interpreted string still escapes its quotes", () => {
  admits(
    "go",
    goFile('\ts := "he said \\"hi\\""\n\tif s == "" {\n\t\tt.Fatal("bad")\n\t}'),
    "the raw rule must not leak into the interpreted one. A double-quoted Go string keeps the C " +
      "escape model and `\\\"` is not the close."
  );
});

itest("[v70 P2 go] an interpreted string ending in a backslash IS unterminated", () => {
  refuses(
    "go",
    "package main\n\nimport \"testing\"\n\nfunc TestCase(t *testing.T) {\n\tp := \"C:\\dir\\\"\n}",
    "the contrast row for the backtick fix. A backslash before the close is an escape in an " +
      "INTERPRETED string, so this reply really is truncated and widening the raw case must not " +
      "widen this one."
  );
});

// ===========================================================================
// C#: verbatim strings and their doubled-quote escape
// ===========================================================================

itest("[v70 P2 csharp] a verbatim string ending in a backslash keeps its close", () => {
  admits(
    "csharp",
    csharpFile(`        var root = @"C:\\dir\\";
        Assert.Equal("c:/dir/", Normalise(root));`),
    "the review row's shape at the lexer. A verbatim string has no backslash escape; applying one " +
      "eats the closing quote and runs into the following ordinary string."
  );
});

itest("[v70 P2 csharp] a doubled quote inside a verbatim string is one character, not the end", () => {
  admits(
    "csharp",
    csharpFile(`        var json = @"{ ""a"": [1 }";
        Assert.Null(Parse(json));`),
    "`\"\"` is how a verbatim string spells a quote, and the body carries an unmatched `}` and an " +
      "unclosed `[`. NOT red-before-green, deliberately recorded as such: drop the doubled-quote " +
      "rule and the literal re-lexes as a CHAIN of strings that ends on the same character, " +
      "because a doubled pair leaves no gap for code to sit in. The rule is here because it is the " +
      "correct C#, and because the chain reading changes which characters the tail gate and the " +
      "shape gate read as code."
  );
});

itest("[v70 P2 csharp] a verbatim string ENDING in a doubled quote", () => {
  admits(
    "csharp",
    csharpFile(`        var s = @"a""";
        Assert.Equal("a\\"", s);`),
    "three quotes in a row, and the split is `\"\"` then `\"`. The doubled-quote check runs before " +
      "the close check, which is the only order that spells this value correctly. Parity means the " +
      "wrong order happens to end on the same character here too, so this row pins the value and " +
      "not a refusal."
  );
});

itest("[v70 P2 csharp] an interpolated verbatim string, both prefix orders", () => {
  admits(
    "csharp",
    csharpFile(`        var a = $@"C:\\{name}\\";
        var b = @$"C:\\{name}\\";
        Assert.Equal(a, b);`),
    "`$@\"` and `@$\"` are both legal and both verbatim. A rule that only knows `@\"` treats the " +
      "`$` forms as an ordinary string and eats the close on the trailing backslash."
  );
});

itest("[v70 P2 csharp] EOF inside a verbatim string is a refusal", () => {
  refuses(
    "csharp",
    `using Xunit;

public class CaseTests
{
    [Fact]
    public void Case()
    {
        var root = @"C:\\dir`,
    "rule 3. No escape model can rescue this one: there is no close."
  );
});

itest("[v70 P2 csharp] a NON-verbatim string ending in a backslash IS unterminated", () => {
  refuses(
    "csharp",
    `using Xunit;

public class CaseTests
{
    [Fact]
    public void Case()
    {
        var p = "C:\\dir\\";
    }
}`,
    "the contrast row. Without the `@` the backslash escapes the quote, so this string really does " +
      "run past the end of the file, and the verbatim widening must not reach it."
  );
});

itest("[v70 P2 csharp] a char literal holding a quote", () => {
  admits(
    "csharp",
    csharpFile(`        Assert.Equal('"', Quote());
        Assert.Equal('\\'', Apostrophe());`),
    "C# keeps `'` in quotes rather than moving to the bounded char rule, because it has no " +
      "lifetime spelling and the escape a quotes entry gives it is the escape a C# char literal has."
  );
});

// ===========================================================================
// TypeScript: regex literals, the division trap, and templates
// ===========================================================================

itest("[v70 P2 typescript] an apostrophe inside a regex literal is not a string opener", () => {
  admits(
    "typescript",
    tsFile(`  expect(/it's/.test("it's")).toBe(true);`),
    "the review row's shape at the lexer. With no regex state the `'` opens a phantom string that " +
      "closes on the apostrophe in the argument, and the reply then reads as unbalanced."
  );
});

itest("[v70 P2 typescript] a regex literal hides a brace and a paren", () => {
  admits(
    "typescript",
    tsFile(`  expect(/^\\{\\(/.test("{(")).toBe(true);`),
    "the point of lexing a regex at all is that its contents leave the delimiter count alone. An " +
      "unclosed `{` and `(` in the pattern must be invisible."
  );
});

itest("[v70 P2 typescript] a slash inside a CHARACTER CLASS does not close the regex", () => {
  admits(
    "typescript",
    tsFile(`  expect(/[/(]/.test("/")).toBe(true);`),
    "closing on the first `/` ends the literal inside the class and leaves `(]/` as code, which " +
      "opens a paren that never closes. The class state is not optional."
  );
});

itest("[v70 P2 typescript] DIVISION is not a regex", () => {
  admits(
    "typescript",
    tsFile(`  const ratio = width / (height / 2);
  expect(ratio).toBe(4);`),
    "red-before-green against the naive fix. Lex the first `/` as a regex and it closes on the " +
      "second, swallowing ` (height ` and the `(` inside it, and the reply is refused for an " +
      "unmatched `)`. This is why the rule is 'a regex can only begin where an operand cannot'."
  );
});

itest("[v70 P2 typescript] a regex after a KEYWORD is still a regex", () => {
  admits(
    "typescript",
    tsFile(`  const ok = (s) => { return /a(b/.test(s); };
  expect(ok("a(b")).toBe(true);`),
    "after `return` a value is expected, so the `/` opens a regex and the unmatched `(` inside it " +
      "stays invisible. Treating every identifier-looking token as an operand would refuse this."
  );
});

itest("[v70 P2 typescript] a division after a CLOSING PAREN is not a regex", () => {
  admits(
    "typescript",
    tsFile(`  const ratio = total() / (count() / 2);
  expect(ratio).toBe(4);`),
    "`)` is a value, so the `/` after it divides. Same failure shape as the width/height row and a " +
      "different preceding token, because the rule is read off the token and not off the spacing."
  );
});

itest("[v70 P2 typescriptreact] a JSX CLOSING TAG is not a regex opener", () => {
  admits(
    "typescriptreact",
    `import { it, expect } from "vitest";

it("case", () => {
  expect(fn(<div>{a}</div>)).toBe(<span>{b}</span>);
});`,
    "this is what buys the deliberate choice to read `<` as a value. Every closing tag puts a `/` " +
      "straight after a `<`, which is an operand position, so a CORRECT reading of the language " +
      "opens a regex here and closes it on the `/` in `</span>`, swallowing a paren and leaving " +
      "the reply unbalanced. A closing tag is on every second line of a React test; the shape " +
      "given up, `a < /re/.test(b)`, is on none."
  );
});

itest("[v70 P2 typescript] a regex that never closes on its line leaves the slash inert", () => {
  refuses(
    "typescript",
    `import { it, expect } from "vitest";

it("case", () => {
  expect(/abc`,
    "a regex literal cannot span a line, so an unclosed one is not lexed as a literal at all and " +
      "the `/` stays an ordinary character. The reply is still refused, by the two open parens, " +
      "which is the answer that matters. The same-line bound is a DAMAGE bound rather than a rule " +
      "this row can falsify: a `/` in operand position that is not a regex barely exists in valid " +
      "code, so what the bound buys is that a misclassification cannot swallow more than one line."
  );
});

itest("[v70 P2 typescript] a template literal hides a brace", () => {
  admits(
    "typescript",
    tsFile("  const s = `a{b${x}c`;\n  expect(s).toContain(\"{\");"),
    "a backtick string is a quotes entry with the C escape model, which is correct for a template: " +
      "`` \\` `` really is an escape there. Its braces, interpolation included, stay invisible."
  );
});

itest("[v70 P2 typescript] EOF inside a template literal is a refusal", () => {
  refuses(
    "typescript",
    `import { it, expect } from "vitest";

it("case", () => {
  const s = \`a{b`,
    "rule 3, and the shape truncation actually produces on this backend."
  );
});

itest("[v70 P2 typescript] one quote kind inside another", () => {
  admits(
    "typescript",
    tsFile(`  expect(quote()).toBe("it's");
  expect(apostrophe()).toBe('say "hi"');
  expect(both()).toBe(\`it's "hi"\`);`),
    "three delimiters, each holding the other two. Longest-first matching and per-delimiter closing " +
      "is the whole requirement, and getting it wrong chains: one bad close makes every later " +
      "literal on the line code."
  );
});

itest("[v70 P2 typescript] an implementation whose only test token is `.test(` is refused", () => {
  refuses(
    "typescript",
    `export function hasApostrophe(s: string): boolean {
  return /it's/.test(s);
}`,
    "the admit the regex fix would otherwise open. TypeScript has no `mod` wrapper, so the shape " +
      "pattern is the entire guard against rule 6, and it takes `RE.test(s)` as a test because a " +
      "word boundary holds after a dot. The apostrophe used to refuse this reply by accident; the " +
      "bare path now refuses it on purpose. Left open, the human's own implementation is written " +
      "into their test file."
  );
});

itest("[v70 P2 typescript] a real test that also calls `.test(` still counts BOTH", () => {
  const fenced = extractTestFunctions(
    '```ts\nit("case", () => {\n  expect(/^\\{/.test("{a")).toBe(true);\n});\n```',
    "typescript"
  );
  const bare = extractTestFunctions(
    'it("case", () => {\n  expect(/^\\{/.test("{a")).toBe(true);\n});',
    "typescript"
  );
  assert.notStrictEqual(bare, undefined, "the bare copy was refused");
  assert.deepStrictEqual(
    bare && bare.testCount,
    fenced && fenced.testCount,
    "rule 5: a bare and a fenced copy of the same tests return the same count. The bare path's " +
      "extra strictness is an ADMISSION gate, not a different counter, or the two paths disagree " +
      "on a number that reaches the log."
  );
});

// ===========================================================================
// Python: the language whose raw strings are NOT raw for finding the close
// ===========================================================================

itest("[v70 P2 python] an assertion whose expected value is a string literal", () => {
  admits(
    "python",
    pyFile(`    assert label(1) == "one"`),
    "the suite tail gate refuses a line that ends in an operator, because that is what truncation " +
      "after `==` looks like. Blank the literal away entirely and a complete assertion ends in " +
      "`==` too. The delimiters have to survive the lens, or most Python tests there are get refused."
  );
});

itest("[v70 P2 python] an EMPTY string literal at the end of the line", () => {
  admits(
    "python",
    pyFile(`    assert render([]) == ""`),
    "the same row with a zero-length body, which is the case a filler character would not fix. " +
      "Only keeping the delimiters answers both."
  );
});

itest("[v70 P2 python] a raw string still honours a backslash before its quote", () => {
  admits(
    "python",
    pyFile(`    assert len(r"\\"") == 2
    assert re.match(r"\\d+", "12")`),
    "red-before-green against the wrong fix. A Python raw string is raw for the VALUE and not for " +
      "finding the close: `r\"\\\"\"` is a legal two-character string and `r\"\\\"` is a syntax error. " +
      "Add a no-escape prefix rule here, as C# and Go need, and the first assertion closes early, " +
      "leaving a stray quote that runs to EOF."
  );
});

itest("[v70 P2 python] a triple-quoted string holds a bare quote and a hash", () => {
  admits(
    "python",
    pyFile(`    want = """a "b" # not a comment
    { unclosed
    """
    assert render() == want`),
    "longest-first delimiter matching. Match `\"` before `\"\"\"` and the docstring becomes an empty " +
      "string followed by code, and the `#`, the `{` and the bare quotes all become real."
  );
});

itest("[v70 P2 python] EOF inside a triple-quoted string is a refusal", () => {
  refuses(
    "python",
    `def test_case():
    want = """a
    b`,
    "rule 3. Python's delimiter count is close to vacuous, so an unterminated literal is one of the " +
      "few truncations the lens can actually prove."
  );
});

itest("[v70 P2 python] a backslash as the last character of the reply is a refusal", () => {
  refuses(
    "python",
    `def test_case():
    assert label(1) == "one\\`,
    "the escape branch has no character to consume. Same edge as the Rust row, in the language " +
      "where the delimiter count cannot back it up."
  );
});

itest("[v70 P2 python] a hash inside a string is not a comment", () => {
  admits(
    "python",
    pyFile(`    assert colour() == "#ff0000"`),
    "the comment check runs before the quote check at each position, which is right, but only " +
      "because the quote check has already consumed the string by the time the `#` is reached."
  );
});

// ===========================================================================
// TypeScript, loop 2: the division trap after a postfix operator, the phantom
// regex that eats the prose tail, and the cost of asking "is there a value in
// hand" at every character.
//
// [session-v70/goal.md defect 1; P8 rules 3 and 9; review rows REV70-P2 6-10]
// ===========================================================================

itest("[v70 P2 typescript] a division after a postfix `++` is a division", () => {
  admits(
    "typescript",
    tsFile(`  const r = x++ / f(2 / 3);
  expect(r).toBe(1);`),
    "`x++` leaves a value in hand, so the `/` after it divides. Read the `+` as an operator and a " +
      "regex opens at the `/`, blanking `/ f(2 /` and hiding the open paren from the balance count: " +
      "a reply that does not parse would be admitted, and one that does would be refused."
  );
});

itest("[v70 P2 typescript] a division after a postfix `--` is a division", () => {
  admits(
    "typescript",
    tsFile(`  expect(x-- / f(2 / 1).g).toBe(2);`),
    "same rule, other operator. The fenced copy of this reply is admitted, so P8 rule 5 says the " +
      "bare copy answers the same."
  );
});

itest("[v70 P2 typescript] `++/` with no space between is still a division", () => {
  admits(
    "typescript",
    tsFile(`  const r = x++/f(2/3);
  expect(r).toBe(1);`),
    "the postfix rule is about the two characters, not about the whitespace around them. Written " +
      "tight, the wrong reading opens a regex at the first slash and closes it at the second, " +
      "blanking `/f(2/` and leaving a `)` with nothing to close: a reply that parses is refused."
  );
});

itest("[v70 P2 typescript] a single `+` before a slash still opens a regex", () => {
  admits(
    "typescript",
    tsFile(`  const r = a + /x(y/.source;
  expect(r).toBe("x(y");`),
    "red-before-green against the wrong fix. Treat any `+` as leaving a value and this `/` divides, " +
      "the unmatched `(` inside the regex becomes real, and a well-formed reply is refused. Only a " +
      "`+` whose previous character is also `+` is a postfix operator."
  );
});

itest("[v70 P2 typescript] a regex inside the LAST statement is still admitted", () => {
  admits(
    "typescript",
    tsFile(`  expect(/x/.test(s)).toBe(true);`),
    "the regex tail guard refuses a regex blanked AFTER the last closing delimiter. A regex that " +
      "sits inside the last statement closes before that delimiter and must be untouched by it, or " +
      "the guard costs every reply whose final assertion matches a pattern."
  );
});

itest("[v70 P2 typescript] a trailing COMMENT after the last close is admitted", () => {
  admits(
    "typescript",
    `it("adds", () => {
  expect(add(1, 2)).toBe(3);
});
// covers add and the overflow path`,
    "a comment is code the model is allowed to write, and the lens has already blanked it. The tail " +
      "guard is scoped to regexes for exactly this reason: blanking is not evidence of prose."
  );
});

itest("[v70 P2 typescript] a trailing PROSE line with slashes in it is refused", () => {
  refuses(
    "typescript",
    `it("adds", () => {
  expect(add(1, 2)).toBe(3);
});
/ covers add and the overflow path /`,
    "P8 rule 9. The line opens at a `/` in non-value position, closes at the next one, and blanks " +
      "whole, so the tail gate reads the `});` above it and the prose is spliced into the user's " +
      "test file. A regex that finishes after the last closing delimiter is not part of the module."
  );
});

itest("[v70 P2 typescript] loop 3: a slash-wrapped prose line in the MIDDLE hiding a `(` is refused", () => {
  refuses(
    "typescript",
    `it("adds", () => {
  expect(add(1, 2)).toBe(3);
});
/ see helper( for the rest /
it("subs", () => {
  expect(sub(3, 1)).toBe(2);
});`,
    "P8 rule 3. Lexed as a regex the line blanks whole and the `(` is never counted, so a reply " +
      "that does not parse is admitted. A regex alone on its line is an expression statement that " +
      "does nothing and no test writes one, so the line stays text and the paren refuses it, which " +
      "is what main answered before the scanner knew regexes."
  );
});

itest("[v70 P2 typescript] loop 3: a regex at the START of a line followed by code is still a regex", () => {
  admits(
    "typescript",
    `it("matches", () => {
  const ok =
    /^[a-z]+(?:-[a-z]+)*$/.test(slug);
  expect(ok).toBe(true);
});`,
    "the whole-line rule must not fire here: the line does not END at the regex, so the `(` inside " +
      "it is still blanked and the reply balances."
  );
});

itest("[v70 P2 typescript] a long blanked comment run scans in linear time", () => {
  const note = "  // note\n";
  const lines = Math.ceil(80000 / note.length);
  const reply = `it("a", () => {\n` + note.repeat(lines) + `  expect(f(1)).toBe(1);\n});`;
  assert.ok(
    reply.length > 80000,
    `the row needs an 80,000 character run to judge; it built ${reply.length}`
  );
  let best = Infinity;
  for (let k = 0; k < 3; k++) {
    const t0 = process.hrtime.bigint();
    extractTestFunctions(reply, "typescript");
    const d = Number(process.hrtime.bigint() - t0) / 1e6;
    if (d < best) best = d;
  }
  assert.ok(
    best < 100,
    `${reply.length} characters, almost all of them blanked comment text, took ${best.toFixed(1)}ms. ` +
      `"is there a value in hand" walks back over the trailing whitespace run in the output, so asking ` +
      `it at every character makes the scan quadratic. It is only ever needed at a slash.`
  );
});
