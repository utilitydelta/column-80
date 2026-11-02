// Adversarial review of session-v78 phase 1, loop 2: the `unplaced` field and
// the `hasSlot` predicate in keepSketch. Bound to session-v78/contract-p1.md
// rule 9 as revised (a slotless reply gets a slot made by line breaks; no
// non-whitespace character of the reply changes). Failing rows are defect
// claims; passing rows are the shapes that were probed and hold.
//
// Run: SKIP_LIVE=1 node --test test/review-v78-p1b-keep-sketch.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "review-v78-p1b-keep-sketch",
  [
    `export { keepSketch } from "../src/core/scaffoldKeep";`,
    `export { harvestBodyComments, bodyTextOfSpan } from "../src/core/scaffold";`,
    "",
  ].join("\n"),
);
test.after(cleanup);
const { keepSketch } = mod;

const L = (...lines) => lines.join("\n");

// ---------------------------------------------------------------------------
// Rule 9 revised: a slotless reply gets a slot made by line breaks
// ---------------------------------------------------------------------------

// The properties every slot-making row asserts:
//  - every sketch line is in the result, in order, inside the function: after
//    the line that opens the body (`:` or `=>`) and before `before`, the first
//    code token of the reply's body;
//  - the harvest of the result holds the sketch as an in-order subsequence;
//  - no non-whitespace character of the reply changed (removing the placed
//    comment lines leaves the reply's non-whitespace text exactly);
//  - nothing lands after the function's end (the result's last non-blank line
//    is a suffix of the reply's last non-blank line);
//  - a second pass over the result is byte-identical and places nothing.
const nonWs = (s) => s.replace(/\s+/g, "");
const lastNonBlank = (s) => s.split(/\r?\n/).filter((l) => l.trim() !== "").pop().trim();

function harvestOf(text, lang) {
  return mod.harvestBodyComments(mod.bodyTextOfSpan(text, lang, false), lang, "").comments;
}

function isSubsequence(needle, hay) {
  let j = 0;
  for (const line of hay) if (j < needle.length && line === needle[j]) j++;
  return j === needle.length;
}

function slotMade(languageId, originalSpan, reply, sketch, placedSource, opener, before) {
  const r = keepSketch({ languageId, originalSpan, reply });
  assert.deepStrictEqual(r.unplaced, [], "a slot is made, nothing is left unplaced");
  assert.deepStrictEqual(r.placedByTool, sketch);
  assert.deepStrictEqual(r.stripped, []);

  const lines = r.text.split(/\r?\n/);
  const openAt = lines.findIndex((l) => l.includes(opener));
  const codeAt = lines.findIndex((l) => l.includes(before));
  const at = placedSource.map((c) => lines.findIndex((l) => l.trim() === c));
  assert.ok(at.every((i) => i >= 0), `every placed comment is on a line of its own:\n${r.text}`);
  for (let k = 1; k < at.length; k++) assert.ok(at[k - 1] < at[k], `in order:\n${r.text}`);
  assert.ok(openAt >= 0 && openAt < at[0], `after the body opener:\n${r.text}`);
  assert.ok(at[at.length - 1] < codeAt, `before the body's first code:\n${r.text}`);

  assert.ok(isSubsequence(sketch, harvestOf(r.text, languageId)), `harvest round trip:\n${r.text}`);

  const withoutPlaced = lines.filter((l) => !placedSource.includes(l.trim())).join("\n");
  assert.strictEqual(nonWs(withoutPlaced), nonWs(reply), "only whitespace of the reply changed");
  // Splitting a one-liner moves the reply's last line's tail to a new line,
  // so the result's last line is a suffix of the reply's last line, never a
  // placed comment or anything else after the function.
  const tail = lastNonBlank(r.text);
  assert.ok(
    tail !== "" && !placedSource.includes(tail) && lastNonBlank(reply).endsWith(tail),
    `nothing after the function's end:\n${r.text}`,
  );

  const again = keepSketch({ languageId, originalSpan, reply: r.text });
  assert.strictEqual(again.text, r.text, "second pass is byte-identical");
  assert.deepStrictEqual(again.placedByTool, []);
  assert.deepStrictEqual(again.unplaced, []);
  return r;
}

// A Python one-liner whose single statement continues inside brackets. The
// whole tail after `:` moves to its own line; the continuation line is left as
// it was. Loop 2 placed the comment after the def, at module level.
test("rule 9 revised: Python one-liner continued in brackets gets a slot", () => {
  slotMade(
    "python",
    L("def f(a, b):", "    # add them", "    return a + b"),
    L("def f(a, b): return (a +", "        b)"),
    ["add them"],
    ["# add them"],
    "def f(a, b):",
    "return (a +",
  );
});

test("rule 9 revised: Python one-liner with a multi-line list literal gets a slot", () => {
  slotMade(
    "python",
    L("def f():", "    # one", "    x = 1", "    return x"),
    L("def f(): return [1,", "    2]"),
    ["one"],
    ["# one"],
    "def f():",
    "return [1,",
  );
});

test("rule 9 revised: Python one-liner with a trailing newline gets a slot", () => {
  const r = slotMade(
    "python",
    L("def f():", "    # one", "    return 1"),
    "def f(): return 1\n",
    ["one"],
    ["# one"],
    "def f():",
    "return 1",
  );
  assert.ok(r.text.includes("\n    # one\n    return 1"), `body indent is header indent plus four:\n${r.text}`);
});

// A C# expression body with a brace in the expression: the break goes after
// `=>`, the placed lines, then the expression. Loop 2 put the line between the
// switch arms.
test("rule 9 revised: C# expression body with a switch expression gets a slot", () => {
  slotMade(
    "csharp",
    L("int F(int x)", "{", "    // map it", "    return x;", "}"),
    L("int F(int x) => x switch", "{", "    1 => 2,", "    _ => 0", "};"),
    ["map it"],
    ["// map it"],
    "int F(int x) =>",
    "x switch",
  );
});

test("rule 9 revised: C# expression body with an object initializer gets a slot", () => {
  slotMade(
    "csharp",
    L("Foo F()", "{", "    // build it", "    return null;", "}"),
    L("Foo F() => new Foo", "{", "    A = 1,", "};"),
    ["build it"],
    ["// build it"],
    "Foo F() =>",
    "new Foo",
  );
});

test("rule 9 revised: C# expression body already spanning lines gets a slot", () => {
  slotMade(
    "csharp",
    L("int F(int a, int b)", "{", "    // add", "    // then return", "    return a + b;", "}"),
    L("int F(int a, int b) =>", "    a +", "    b;"),
    ["add", "then return"],
    ["// add", "// then return"],
    "int F(int a, int b) =>",
    "a +",
  );
});

// ---------------------------------------------------------------------------
// Probed and holding: multi-line bodies that open on the header line
// ---------------------------------------------------------------------------

function placedInside(languageId, originalSpan, reply, expected) {
  const r = keepSketch({ languageId, originalSpan, reply });
  assert.deepStrictEqual(r.unplaced, []);
  assert.strictEqual(r.text, expected);
}

test("holds: Rust body opening on the header line, then continuing", () => {
  placedInside(
    "rust",
    L("fn f() {", "    // one", "    a();", "}"),
    L("fn f() { a();", "    b();", "}"),
    L("fn f() { a();", "    // one", "    b();", "}"),
  );
});

test("holds: Go body opening on the header line, then continuing", () => {
  placedInside(
    "go",
    L("func f() {", "\t// one", "\ta()", "}"),
    L("func f() { a()", "\tb()", "}"),
    L("func f() { a()", "\t// one", "\tb()", "}"),
  );
});

test("holds: TS arrow function block body", () => {
  placedInside(
    "typescript",
    L("const f = () => {", "  // one", "  // two", "  a();", "};"),
    L("const f = () => {", "  a();", "  b();", "};"),
    L("const f = () => {", "  // one", "  // two", "  a();", "  b();", "};"),
  );
});

test("holds: closing brace shares the last statement's line", () => {
  placedInside(
    "rust",
    L("fn f() {", "    // one", "    a();", "}"),
    L("fn f() {", "    a() }"),
    L("fn f() {", "    // one", "    a() }"),
  );
});
