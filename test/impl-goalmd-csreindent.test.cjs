// IMPLEMENTER tests for reindentCsBody / reindentTsBody — the mechanism the
// blind contract (blind-goalmd-csreindent) does not reach: interpolation-hole
// string safety. These pin the Phase-1 triage fix (review-p1 Findings 1+2): a
// `"` inside an interpolated verbatim string's {...} hole must NOT mis-close the
// string, and the $@"/@$" opener forms must be recognized. Regression guards for
// the TS sibling live here too.
//
// Run: SKIP_LIVE=1 node --test test/impl-goalmd-csreindent.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-goalmd-csreindent",
  `export { reindentCsBody } from "../src/core/csExtraction";\n` +
    `export { reindentTsBody } from "../src/core/tsExtraction";\n`,
);
test.after(() => cleanup());
const { reindentCsBody, reindentTsBody } = mod;

// review-p1 Finding 1: a quote inside an interpolation hole of a MULTI-LINE
// interpolated verbatim string must not be read as the closing quote, or the
// next physical line of string text gets shifted (silent value change).
test("CS interp verbatim: a quote inside a {...} hole does not mis-close; string text stays byte-exact", () => {
  const input = [
    "public string M()",
    "{",
    '    return $@"total {price.ToString("C")} for the order',
    'next line of the receipt";',
    "}",
  ].join("\n");
  const out = reindentCsBody(input, "    ").split("\n");
  assert.strictEqual(out[2], '        return $@"total {price.ToString("C")} for the order', "the opening line is code and shifts");
  assert.strictEqual(out[3], 'next line of the receipt";', "the second string-text line is byte-exact — the hole quote did not close the string early");
  assert.strictEqual(out[4], "    }", "code after the string resumes shifting");
});

// review-p1 Finding 2: the @$" opener order is a valid C# verbatim string and
// must open verbatim, or the whole thing is read as a regular string and every
// continuation line is shifted.
test("CS interp verbatim: the @$\" opener order is recognized; continuation is frozen", () => {
  const input = [
    "public string M()",
    "{",
    '    return @$"line one {x}',
    'line two";',
    "}",
  ].join("\n");
  const out = reindentCsBody(input, "    ").split("\n");
  assert.strictEqual(out[2], '        return @$"line one {x}', "opener line shifts (code)");
  assert.strictEqual(out[3], 'line two";', "the string-text continuation is byte-exact");
});

// A line whose START sits inside a hole that spans the line boundary is CODE and
// SHOULD be shifted (not frozen) — the interpolation carries an expression.
test("CS interp verbatim: a line inside a cross-line {...} hole is shifted as code", () => {
  const input = [
    "public string M()",
    "{",
    '    return $@"x {',
    "a + b",
    '}";',
    "}",
  ].join("\n");
  const out = reindentCsBody(input, "    ").split("\n");
  assert.strictEqual(out[3], "    a + b", "the hole's expression line is code and shifts by one indent");
});

// {{ and }} are escaped literal braces in string text, not a hole — a following
// quote must still close the string normally (no spurious open hole left).
test("CS interp verbatim: {{ }} escaped braces do not open a hole", () => {
  const input = ['var s = $@"a {{literal}} b', 'second";', "after;"].join("\n");
  const out = reindentCsBody(input, "  ").split("\n");
  assert.strictEqual(out[1], "second\";", "string text after an escaped brace stays frozen");
  assert.strictEqual(out[2], "  after;", "code after the closed string shifts");
});

// Non-interpolated @" is unchanged by the interpolation machinery: a { is literal
// and no quote-in-hole logic applies.
test("CS plain verbatim: a { in a non-interpolated @\" string is literal, string text frozen", () => {
  const input = ['var s = @"a { not a hole', 'more";', "x;"].join("\n");
  const out = reindentCsBody(input, "  ").split("\n");
  assert.strictEqual(out[1], "more\";", "plain verbatim text is byte-exact");
  assert.strictEqual(out[2], "  x;", "code after resumes shifting");
});

// --- TS sibling regression guards ---

test("TS: a line inside a multi-line template literal is byte-exact", () => {
  const input = ["function f() {", "  return `line one", "line two`;", "}"].join("\n");
  const out = reindentTsBody(input, "  ").split("\n");
  assert.strictEqual(out[1], "    return `line one", "the opening line is code and shifts");
  assert.strictEqual(out[2], "line two`;", "the template-content line is byte-exact");
  assert.strictEqual(out[3], "  }", "code after the template shifts");
});

test("TS: indent==='' is a byte-for-byte no-op", () => {
  const input = "function f() {\n  return 1;\n}";
  assert.strictEqual(reindentTsBody(input, ""), input);
});

test("TS: the goal shape — header kept, body and brace shifted", () => {
  const input = ["function g(): number {", "  const x = 1;", "  return x;", "}"].join("\n");
  const out = reindentTsBody(input, "    ").split("\n");
  assert.strictEqual(out[0], "function g(): number {", "header untouched");
  assert.strictEqual(out[1], "      const x = 1;", "body shifted by the header indent");
});
