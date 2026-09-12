// Adversarial review evidence for session-v70 phase 2 (commit 53762e0,
// "the bare path lexes each language's literals, not C's").
//
// WHITE BOX. Every row is a defect claim with a runnable case, written to FAIL
// against the working tree at the time of review. A green row here means the
// defect it names has been closed. Rows tagged "holding" are the properties the
// review attacked and could NOT break; those are green now and must stay green.
//
// Reviewed artifact, pinned:
//   src/core/instructPostprocess.ts  (BARE_LANG_RULES, scanBare, matchCharLiteral,
//                                    matchRegexLiteral, endsInValue, scanRawString,
//                                    BARE_TEST_FUNCTION_SHAPES)
//
// Rules cited are from session-v68/contracts/P8-bare-reply.md, amendment 3.
//
// The asymmetry every row is written against: a refusal costs the user a re-run,
// a false admit writes prose or the user's own implementation into their test
// file. Rows 3 to 8 are the admit direction. Rows 1, 2 and 9 are the refuse
// direction on shapes the pre-phase code ADMITTED, so they are regressions, not
// pre-existing limits.
//
// Run: SKIP_LIVE=1 node --test test/review-v70-p2.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

let mod = {};
let cleanup = () => {};
let bundleError;
try {
  ({ mod, cleanup } = bundleCore(
    "review-v70-p2",
    `export { extractTestModule, extractTestFunctions } from "../src/core/instructPostprocess";\n`
  ));
} catch (e) {
  bundleError = e;
}
test.after(() => cleanup());

const rtest = (name, fn) =>
  test(name, (ctx) => {
    if (bundleError) return ctx.skip(`bundle failed: ${bundleError}`);
    return fn(ctx);
  });

const BQ = String.fromCharCode(96);
const FENCE = BQ + BQ + BQ;

const extract = (languageId, reply) =>
  languageId === "rust" ? mod.extractTestModule(reply) : mod.extractTestFunctions(reply, languageId);

const fencedCopy = (languageId, body) => FENCE + languageId + "\n" + body + "\n" + FENCE;

const admitted = (languageId, reply, why) =>
  assert.notStrictEqual(extract(languageId, reply), undefined, why);

const refused = (languageId, reply, why) =>
  assert.strictEqual(
    extract(languageId, reply),
    undefined,
    `${why}\nbut it was ADMITTED and this text would be spliced into the user's test file:\n---\n${reply}\n---`
  );

// Rule 5: a bare and a fenced copy of one reply answer the same thing. The row
// proves its own fixture first, so a fixture the FENCED path refuses can never
// be read as a bare-path finding.
const sameBothWays = (languageId, body, why) => {
  const fenced = extract(languageId, fencedCopy(languageId, body));
  assert.notStrictEqual(fenced, undefined, `fixture is not a test reply at all (fenced path refused it): ${why}`);
  const bare = extract(languageId, body);
  assert.notStrictEqual(
    bare,
    undefined,
    `P8 rule 5: the fenced copy answers testCount=${fenced && fenced.testCount} and the BARE copy is refused.\n${why}\n---\n${body}\n---`
  );
  assert.strictEqual(bare.testCount, fenced.testCount, `P8 rule 5: counts differ. ${why}`);
};

rtest("[REV70-P2 0] the bundle builds and both extractors are exported", () => {
  assert.strictEqual(bundleError, undefined, `bundle failed: ${bundleError}`);
  assert.strictEqual(typeof mod.extractTestModule, "function");
  assert.strictEqual(typeof mod.extractTestFunctions, "function");
});

// ===========================================================================
// The new BARE_TEST_FUNCTION_SHAPES gate, refusing direction.
// `(?<![.$])` refuses every test declaration whose head is DOTTED. Three real
// runners spell it that way. All three were admitted on the bare path before
// this phase and are still admitted through a fence, so each is both a
// regression and a rule 5 break.
// ===========================================================================

rtest("[REV70-P2 1] a Deno test reply is refused bare and admitted fenced", () => {
  sameBothWays(
    "typescript",
    `import { assertEquals } from "./deps.ts";

Deno.test("adds", () => {
  assertEquals(add(1, 2), 3);
});`,
    "Deno.test is the only way Deno declares a test, and the gate's lookbehind refuses it."
  );
});

rtest("[REV70-P2 2] a QUnit / node-tap test reply is refused bare and admitted fenced", () => {
  sameBothWays(
    "typescript",
    `import QUnit from "qunit";

QUnit.test("adds", (assert) => {
  assert.equal(add(1, 2), 3);
});`,
    "QUnit.test is a dotted head, so the gate finds nothing."
  );
  sameBothWays(
    "typescript",
    `import t from "tap";

t.test("adds", (tt) => {
  tt.equal(add(1, 2), 3);
  tt.end();
});`,
    "node-tap spells every test t.test(...)."
  );
});

// ===========================================================================
// The new gate, ADMITTING direction. It runs on neutralizeCommentsAndStrings,
// which is the RUST lens: a TypeScript single-quoted string and a template
// literal are CODE to it. So the gate that exists to keep an implementation out
// of the test file is satisfied by an implementation that merely writes the
// characters `it(` into a string.
// ===========================================================================

rtest("[REV70-P2 3] an implementation is admitted because a single-quoted string holds `it(`", () => {
  refused(
    "typescript",
    `export function scaffold(name: string): string {
  const body = 'it(' + name + ', () => {});';
  return body;
}`,
    "this reply is an implementation, not tests; the bare gate must not read a string body as a test declaration"
  );
});

rtest("[REV70-P2 4] an implementation is admitted because a TEMPLATE LITERAL holds `it(`", () => {
  refused(
    "typescript",
    `export function scaffold(name: string): string {
  return ${BQ}it("\${name}", () => {});${BQ};
}`,
    "same hole through the backtick form; the gate's lens does not know TypeScript strings"
  );
});

rtest("[REV70-P2 5] an implementation FUNCTION named test satisfies the gate", () => {
  refused(
    "typescript",
    `export function test(value: string): boolean {
  const RE = /^[a-z]+$/;
  return RE.test(value);
}`,
    "`function test(` is a declaration of an implementation, and the gate was added to refuse exactly this reply"
  );
});

// ===========================================================================
// The TypeScript regex literal, admitting direction.
// matchRegexLiteral blanks from a `/` in non-value position to the next `/` on
// the line. Where that run contains a delimiter, the delimiter becomes
// invisible to the balance count and a reply that does not parse is admitted.
// P8 rule 3 (a brace language is complete when every delimiter closes) and
// rule 9 (prose is refused, not trimmed) are both defeated by it.
// ===========================================================================

rtest("[REV70-P2 6] rule 9: a trailing prose line is blanked as a phantom regex and spliced", () => {
  refused(
    "typescript",
    `it("adds", () => {
  expect(add(1, 2)).toBe(3);
});
/ covers add and the overflow path /`,
    "P8 rule 9: a trailing prose sentence is REFUSED, not silently trimmed; here the whole line lexes as a regex, blanks to whitespace, and the tail gate reads the line above it"
  );
});

rtest("[REV70-P2 7] rule 3: a phantom regex hides an unbalanced OPEN paren", () => {
  refused(
    "typescript",
    `it("a", () => {
  const r = x++ / f(2 / 3;
});`,
    "this text does not parse: `f(` never closes. The `/` after a postfix `++` is read as a regex opener, so `/ f(2 /` is blanked and the open paren is never counted"
  );
});

rtest("[REV70-P2 8] rule 3: a phantom regex hides an unbalanced CLOSE paren", () => {
  refused(
    "typescript",
    `it("a", () => {
  const r = x++ / 2) / 3;
});`,
    "same mechanism, other direction: the stray `)` is inside the blanked run, so the balance count never sees it"
  );
});

// ===========================================================================
// The TypeScript regex literal, refusing direction.
// ===========================================================================

rtest("[REV70-P2 9] a division after a postfix `--` refuses a reply that parses", () => {
  sameBothWays(
    "typescript",
    `it("a", () => {
  expect(x-- / f(2 / 1).g).toBe(2);
});`,
    "`x--` leaves a value in hand, so both slashes divide; endsInValue reads the `-` of the postfix operator and opens a regex that eats `f(`"
  );
});

// ===========================================================================
// Cost. endsInValue is evaluated at EVERY character of a TypeScript reply, not
// only at a `/`, and it walks back over the trailing whitespace run in the
// output. Comment text is blanked to whitespace, so a reply carrying a run of
// line comments makes scanBare quadratic.
// ===========================================================================

rtest("[REV70-P2 10] scanBare is superlinear in a run of comment lines (TypeScript)", () => {
  const replyOf = (n) =>
    `it("a", () => {\n` + `  // a note about this case and why it matters\n`.repeat(n) + `  expect(f(1)).toBe(1);\n});`;
  const best = (reply) => {
    let b = Infinity;
    for (let k = 0; k < 3; k++) {
      const t0 = process.hrtime.bigint();
      mod.extractTestFunctions(reply, "typescript");
      const d = Number(process.hrtime.bigint() - t0) / 1e6;
      if (d < b) b = d;
    }
    return b;
  };
  const small = best(replyOf(800));
  const large = best(replyOf(1600));
  assert.ok(small > 0.5, `base measurement too small to compare (${small.toFixed(2)}ms); the row cannot judge`);
  assert.ok(
    large < small * 3,
    `doubling the input multiplied the time by ${(large / small).toFixed(1)}x ` +
      `(${small.toFixed(1)}ms at 800 comment lines, ${large.toFixed(1)}ms at 1600). ` +
      `Linear work would be about 2x. endsInValue runs per character and rescans the blanked comment run each time.`
  );
});

// ===========================================================================
// Python. Deliberately unchanged by this phase apart from the kept string
// delimiters. This row is the residual the review measured, reported as a
// pre-existing limit rather than a phase 2 regression.
// ===========================================================================

rtest("[REV70-P2 11] a Python reply truncated at a line-continuation backslash is admitted", () => {
  refused(
    "python",
    `def test_total():
    assert total(1, 2) == \\`,
    "the tail gate's operator class does not carry `\\`, so a reply cut at an explicit line continuation reads as finished. Pre-existing, not introduced by phase 2"
  );
});

// ===========================================================================
// HOLDING. Everything below is a property the review attacked and could not
// break. These rows are green today and a later change that reds one of them
// has reopened something this review closed out.
// ===========================================================================

rtest("[REV70-P2 12] holding: a Rust lifetime, a labelled loop and `'_` leave the quote inert", () => {
  for (const body of [
    `fn f<'a>(s: &'a str) -> &'a str { s }\n        assert_eq!(f("x"), "x");`,
    `'outer: loop { break 'outer; }\n        assert_eq!(1, 1);`,
    `let x: Foo<'_> = Foo::new();\n        assert_eq!(x.n(), 1);`,
    `let p: Box<dyn Fn() -> &'static str> = Box::new(|| "x");\n        assert_eq!(p(), "x");`,
  ]) {
    admitted("rust", `#[cfg(test)]\nmod tests {\n    #[test]\n    fn t() {\n        ${body}\n    }\n}`, `lifetime shape refused: ${body}`);
  }
});

rtest("[REV70-P2 13] holding: Rust char, byte-char and raw string spellings", () => {
  for (const body of [
    `assert_eq!(split_on('"'), 2);`,
    `assert_eq!(f('\\''), 1);`,
    `assert_eq!(f('\\u{1F600}'), 1);`,
    `assert_eq!(f('\u{1F600}'), 1);`,
    `assert_eq!(f(b'"'), 1);`,
    `assert_eq!(parse(r#"{"a": 1}"#), 1);`,
    `assert_eq!(parse(r##"a "# b"##), 1);`,
    `assert_eq!(parse(br"a\\b"), 1);`,
    `assert_eq!(f('{'), 1);`,
  ]) {
    admitted("rust", `#[cfg(test)]\nmod tests {\n    #[test]\n    fn t() {\n        ${body}\n    }\n}`, `literal refused: ${body}`);
  }
});

rtest("[REV70-P2 14] holding: C# verbatim strings in all three prefix orders, and the doubled quote", () => {
  const shell = (body) =>
    `[TestClass]\npublic class T {\n  [TestMethod]\n  public void A() {\n    ${body}\n  }\n}`;
  for (const body of [
    `Assert.AreEqual(@"C:\\dir\\", Norm(@"C:\\dir\\"));`,
    `Assert.AreEqual(@"a""b", S);`,
    `Assert.AreEqual(@"say ""hi""", S);`,
    `Assert.AreEqual($@"a{1}b", S);`,
    `Assert.AreEqual(@$"a{1}b", S);`,
    `Assert.AreEqual('"', Quote());`,
    `Assert.AreEqual('\\'', Quote());`,
    `var @class = 1; Assert.AreEqual(1, @class);`,
  ]) {
    admitted("csharp", shell(body), `C# literal refused: ${body}`);
  }
  refused("csharp", `[TestClass]\npublic class T {\n  [TestMethod]\n  public void A() {\n    Assert.AreEqual(@"C:\\dir`, "a reply cut inside a verbatim string must stay refused");
});

rtest("[REV70-P2 15] holding: Go raw strings and runes", () => {
  const shell = (body) => `func TestA(t *testing.T) {\n\t${body}\n\tif F() != 1 {\n\t\tt.Errorf("bad")\n\t}\n}`;
  for (const body of [
    `_ = Norm(${BQ}C:\\dir\\${BQ})`,
    `_ = Split('${BQ}')`,
    `_ = Split('\\'')`,
    `_ = Split('\\x00')`,
    `_ = Split('\u1234')`,
    `_ = Split('{')`,
    `_ = ${BQ}json:"a"${BQ}`,
  ]) {
    admitted("go", shell(body), `Go literal refused: ${body}`);
  }
  refused("go", `func TestA(t *testing.T) {\n\t_ = Norm(${BQ}C:\\dir`, "a reply cut inside a Go raw string must stay refused");
});

rtest("[REV70-P2 16] holding: the TypeScript division trap set", () => {
  const shell = (body) => `it("x", () => {\n${body}\n});`;
  for (const body of [
    `  expect(a / b / c).toBe(1);`,
    `  const x = y /2/ z;`,
    `  const f = (s) => { return /re/.test(s); };`,
    `  expect(f(1) / 2).toBe(1);`,
    `  expect(arr[0] / 2).toBe(1);`,
    `  expect({ a: 1 }.a / 2).toBe(1);`,
    "  expect(" + BQ + "${a / b}" + BQ + ").toBe('x');",
    `  let x = 4; x /= 2; expect(x).toBe(2);`,
    `  expect(/^\\{/.test(s)).toBe(true);`,
    `  expect(/it's/.test(s)).toBe(true);`,
    `  const rate = total\n    / count;\n  expect(rate).toBe(2);`,
  ]) {
    admitted("typescript", shell(body), `division/regex shape refused: ${body}`);
  }
  admitted(
    "typescriptreact",
    `it("renders", () => {\n  expect(fn(<div>{a}</div>)).toBe(<span>{b}</span>);\n});`,
    "a JSX closing tag must not open a regex"
  );
});

rtest("[REV70-P2 17] holding: truncation stays refused at every cut in rust, go and csharp", () => {
  const FIX = {
    rust: `#[cfg(test)]\nmod tests {\n    use super::*;\n    #[test]\n    fn q() {\n        assert_eq!(split_on('"'), 2);\n        assert_eq!(parse(r#"{"a": 1}"#), 1);\n    }\n}`,
    csharp: `[TestClass]\npublic class T {\n    [TestMethod]\n    public void A() {\n        Assert.AreEqual(@"C:\\dir\\", Norm(@"C:\\dir\\"));\n        Assert.AreEqual('"', Quote());\n    }\n}`,
    go: `func TestNorm(t *testing.T) {\n\tif got := Norm(${BQ}C:\\dir\\${BQ}); got != "x" {\n\t\tt.Errorf("got %q", got)\n\t}\n}`,
  };
  for (const [lang, text] of Object.entries(FIX)) {
    const admits = [];
    for (let n = 1; n < text.length; n++) {
      if (extract(lang, text.slice(0, n)) !== undefined) admits.push(n);
    }
    assert.deepStrictEqual(admits, [], `${lang}: ${admits.length} of ${text.length - 1} truncations were ADMITTED`);
  }
});

rtest("[REV70-P2 18] holding: prose before or after the tests is still refused", () => {
  const TS = `it("adds", () => {\n  expect(add(1, 2)).toBe(3);\n});`;
  const RS = `#[cfg(test)]\nmod tests {\n    #[test]\n    fn adds() { assert_eq!(add(1, 2), 3); }\n}`;
  const GO = `func TestAdd(t *testing.T) {\n\tif add(1, 2) != 3 {\n\t\tt.Errorf("bad")\n\t}\n}`;
  refused("typescript", TS + `\nNote: these tests cover add(1, 2) and overflow.`, "trailing note");
  refused("typescript", TS + `\nCovers the 1/2 and 3/4 rounding cases.`, "trailing note carrying two slashes");
  refused("typescript", TS + `\n- the overflow case (wrapping)`, "trailing markdown bullet");
  refused("typescript", `Here are the tests:\n` + TS, "leading prose");
  refused("rust", RS + `\nNote: it's the overflow path that matters.`, "trailing note carrying an apostrophe");
  refused("rust", RS + `\nNote: 'x' is the separator.`, "trailing note carrying a char literal");
  refused("go", GO + `\nNote: 'x' marks the separator.`, "trailing note carrying a rune");
  refused("rust", `pub fn add(a: i32, b: i32) -> i32 {\n    a + b\n}`, "P8 rule 6: a bare plain function is not a test module");
  refused("rust", `pub fn sep() -> char {\n    '"'\n}`, "P8 rule 6 still holds once char literals lex");
});

rtest("[REV70-P2 19] holding: the Python truncation shapes still refuse", () => {
  refused("python", `def test_total():\n    assert total(1, 2) ==`, "cut after the operator");
  refused("python", `def test_total():\n    assert label(1) == "on`, "cut mid-string");
  refused("python", `def test_total():\n    assert total(`, "cut mid-call");
  refused("python", `def test_total():`, "cut at the def header");
  refused("python", `def test_total():\n    assert total(1, 2) == 3\nNote: covers add(1, 2).`, "trailing prose at column 0");
  admitted("python", `def test_label():\n    assert label(1) == "one"`, "S70-3: a string comparison is not a truncated expression");
});
