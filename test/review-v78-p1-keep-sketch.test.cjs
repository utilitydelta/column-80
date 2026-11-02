// Adversarial review of session-v78 phase 1 (keepSketch). Bound to
// session-v78/contract-p1.md and the human's intent: fn-gen never removes or
// rewords the developer's sketch, and regenerating from the result reads the
// same sketch. Rows that fail here are defect claims; rows that pass are
// evidence for a ruling (the disputed blind CRLF row).
//
// Run: SKIP_LIVE=1 node --test test/review-v78-p1-keep-sketch.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "review-v78-p1-keep-sketch",
  [
    `export { keepSketch } from "../src/core/scaffoldKeep";`,
    `export { harvestBodyComments, bodyTextOfSpan } from "../src/core/scaffold";`,
    "",
  ].join("\n"),
);
test.after(cleanup);
const { keepSketch, harvestBodyComments, bodyTextOfSpan } = mod;

const L = (...lines) => lines.join("\n");
const crlf = (s) => s.replace(/\r?\n/g, "\r\n");

function harvestOf(text, lang, bodyOnly = false, bodyIndent = "") {
  return harvestBodyComments(bodyTextOfSpan(text, lang, bodyOnly), lang, bodyIndent).comments;
}

function isSubsequence(needle, hay) {
  let j = 0;
  for (const line of hay) if (j < needle.length && line === needle[j]) j++;
  return j === needle.length;
}

// ---------------------------------------------------------------------------
// Rule 9 revised: a slotless reply gets a slot made by line breaks
// ---------------------------------------------------------------------------

// One-line functions, a Python one-liner and a C# expression body have no line
// starting inside the body. Placing the sketch after them put it outside the
// next generation's span (review R1-R3). Revised rule 9: the tool breaks the
// line to make a slot and restores the sketch inside the body. Only line
// breaks and indentation are added to the reply's code.
const SLOT_MADE = [
  {
    name: "R1 rust one-line reply",
    lang: "rust",
    original: L("fn add(a: i32, b: i32) -> i32 {", "    // add the two numbers", "}"),
    reply: "fn add(a: i32, b: i32) -> i32 { a + b }",
    // The sketch line sits between the opening brace and the closing brace.
    inside: (text) => text.indexOf("// add") > text.indexOf("{") && text.indexOf("// add") < text.lastIndexOf("}"),
  },
  {
    name: "R1b typescript one-line reply",
    lang: "typescript",
    original: L("function add(a: number, b: number): number {", "  // add the two numbers", "}"),
    reply: "function add(a: number, b: number): number { return a + b; }",
    inside: (text) => text.indexOf("// add") > text.indexOf("{") && text.indexOf("// add") < text.lastIndexOf("}"),
  },
  {
    name: "R2 python one-line reply",
    lang: "python",
    original: L("def one() -> int:", "    # return one", "    pass"),
    reply: "def one() -> int: return 1",
    // Above the statement, which now sits on its own line at the body indent.
    inside: (text) => {
      const lines = text.split(/\r?\n/);
      const c = lines.findIndex((l) => l.trim() === "# return one");
      const r = lines.findIndex((l) => l.trim() === "return 1");
      return c > 0 && r === c + 1 && /^[ \t]+$/.test(lines[r].slice(0, lines[r].indexOf("return")));
    },
  },
  {
    name: "R3 csharp expression-bodied reply",
    lang: "csharp",
    original: L("int Add(int a, int b) {", "    // add the two numbers", "}"),
    reply: "int Add(int a, int b) => a + b;",
    // After the arrow, before the expression.
    inside: (text) => text.indexOf("// add") > text.indexOf("=>") && text.indexOf("// add") < text.indexOf("a + b;"),
  },
];

// The reply's non-whitespace characters, in order, after the placed comment
// lines are taken out: equal to the reply's own means only line breaks and
// indentation were added to its code.
function codeOf(text, placedSources) {
  const left = [...placedSources];
  const kept = text.split(/\r?\n/).filter((l) => {
    const i = left.indexOf(l.trim());
    if (i < 0) return true;
    left.splice(i, 1);
    return false;
  });
  return kept.join("\n").replace(/\s+/g, "");
}

function originalSources(row) {
  return row.original
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.startsWith("//") || l.startsWith("#"));
}

for (const row of SLOT_MADE) {
  const input = { languageId: row.lang, originalSpan: row.original, reply: row.reply };
  test(`${row.name}: revised rule 9, the sketch is restored inside the body by a line break`, () => {
    const sketch = harvestOf(row.original, row.lang);
    const r = keepSketch(input);
    assert.ok(row.inside(r.text), `${row.name}: sketch not inside the body:\n${r.text}`);
    assert.deepStrictEqual(harvestOf(r.text, row.lang), sketch, `${row.name}: round trip via the harvest:\n${r.text}`);
    assert.strictEqual(codeOf(r.text, originalSources(row)), row.reply.replace(/\s+/g, ""), `${row.name}: a non-whitespace character of the reply changed:\n${r.text}`);
    assert.deepStrictEqual(r.placedByTool, sketch, `${row.name}: placedByTool`);
    assert.deepStrictEqual(r.unplaced, [], `${row.name}: unplaced`);
  });
  const tag = row.name.split(" ")[0];
  test(`${tag === "R1" || tag === "R1b" ? tag : tag + "b"} ${row.name.slice(tag.length + 1)}: rule 7, a second pass is byte-identical`, () => {
    const first = keepSketch(input);
    const second = keepSketch({ ...input, reply: first.text });
    assert.strictEqual(second.text, first.text, `second pass changed the text:\n${second.text}`);
    assert.deepStrictEqual(second.placedByTool, [], "second pass placedByTool");
    assert.deepStrictEqual(second.unplaced, [], "second pass unplaced");
  });
}

// ---------------------------------------------------------------------------
// Rule 9: nothing to break, so the sketch is reported unplaced
// ---------------------------------------------------------------------------

const NOTHING_TO_BREAK = [
  { name: "R6 empty reply", lang: "rust", original: L("fn f() {", "    // a", "}"), reply: "" },
  { name: "R6b signature-only reply", lang: "rust", original: L("fn f() {", "    // a", "}"), reply: "fn f()" },
];

for (const row of NOTHING_TO_BREAK) {
  test(`${row.name}: rule 9, text is the reply, the sketch is unplaced, nothing placed`, () => {
    const r = keepSketch({ languageId: row.lang, originalSpan: row.original, reply: row.reply });
    assert.strictEqual(r.text, row.reply, `${row.name}: text changed:\n${JSON.stringify(r.text)}`);
    assert.deepStrictEqual(r.unplaced, harvestOf(row.original, row.lang), `${row.name}: unplaced`);
    assert.deepStrictEqual(r.placedByTool, [], `${row.name}: placedByTool`);
  });
}

// ---------------------------------------------------------------------------
// Lexer disagreement: a kept sketch line the harvest cannot see is duplicated
// ---------------------------------------------------------------------------

// The model kept "log it" verbatim, at body depth, directly above its code.
// A quote the comment scanner mis-lexes hides it, so the tool places a second
// copy far from the code it describes.
const HIDDEN_KEPT = [
  {
    name: "typescript regex literal with a double quote",
    lang: "typescript",
    original: L("function f(s: string) {", "  // strip quotes", "  // log it", "  // return", "}"),
    reply: L(
      "function f(s: string) {",
      "  // strip quotes",
      "  const t = s.replace(/\"/g, '');",
      "  // log it",
      "  console.log(t);",
      "  return t;",
      "}",
    ),
  },
  {
    name: "csharp verbatim path ending in a backslash",
    lang: "csharp",
    original: L("void F() {", "    // set dir", "    // copy", "    // log", "}"),
    reply: L(
      "void F() {",
      "    // set dir",
      "    var dir = @\"C:\\temp\\\";",
      "    // copy",
      "    File.Copy(dir, \"b\");",
      "    Log(\"ok\");",
      "}",
    ),
  },
  {
    name: "rust char literal holding a double quote",
    lang: "rust",
    original: L("fn f(s: &str) -> usize {", "    // find quote", "    // count", "    // ret", "}"),
    reply: L(
      "fn f(s: &str) -> usize {",
      "    // find quote",
      "    let q = s.find('\"');",
      "    // count",
      "    let n = 1;",
      "    n",
      "}",
    ),
  },
];

// Deferred: S78-1 in session-v78/scraps.md (the shared comment scanner goes
// blind past a mis-lexed quote). These rows are its acceptance tests.
for (const row of HIDDEN_KEPT) {
  test(`R4 ${row.name}: a sketch line the model kept verbatim is not placed a second time`, { skip: "S78-1 (session-v78/scraps.md): nextComment mis-lexes this literal; fix belongs in the shared lexer" }, () => {
    const r = keepSketch({ languageId: row.lang, originalSpan: row.original, reply: row.reply });
    const keptText = row.lang === "csharp" ? "    // copy" : row.lang === "rust" ? "    // count" : "  // log it";
    const copies = r.text.split("\n").filter((l) => l === keptText).length;
    assert.strictEqual(copies, 1, `${row.name}: ${copies} copies of ${keptText}, keptByModel ${r.keptByModel}\n${r.text}`);
  });
}

// ---------------------------------------------------------------------------
// Interpretation 2: two kept comments on one line (contract clarification)
// ---------------------------------------------------------------------------

// The model's placement cannot be honoured (dropped `b` sits between kept `a`
// and `c` on one line), so every unit is placed by code and keptByModel is 0.
// What must still hold: the round trip, no reply line removed, and the counts.
test("R5 two kept comments sharing a line: round trip holds, nothing removed, counts add up", () => {
  const input = {
    languageId: "rust",
    originalSpan: L("fn f() {", "    /* a */", "    // b", "    /* c */", "}"),
    reply: L("fn f() {", "    /* a */ /* c */", "    x();", "}"),
  };
  const sketch = harvestOf(input.originalSpan, "rust");
  const r = keepSketch(input);
  assert.ok(isSubsequence(sketch, harvestOf(r.text, "rust")), `round trip broken:\n${r.text}`);
  assert.ok(isSubsequence(input.reply.split(/\r?\n/), r.text.split(/\r?\n/)), `a reply line was removed:\n${r.text}`);
  assert.strictEqual(r.keptByModel + r.placedByTool.length, sketch.length, "kept + placed != sketch length");
});

// ---------------------------------------------------------------------------
// Performance: the pure step runs on every generation with a sketch
// ---------------------------------------------------------------------------

function bigRust(n) {
  const sketch = [];
  for (let i = 0; i < 10; i++) sketch.push(`    // step ${i}`);
  const body = [];
  for (let i = 0; i < n; i++) body.push(`    let v${i} = compute("x{", ${i}) + other(${i});`);
  return { languageId: "rust", originalSpan: L("fn f() {", ...sketch, "}"), reply: L("fn f() {", ...body, "}") };
}

function timeOf(input) {
  const t = process.hrtime.bigint();
  keepSketch(input);
  return Number(process.hrtime.bigint() - t) / 1e6;
}

// Deferred: S78-2 in session-v78/scraps.md. This row is its acceptance test.
test("R7 performance: doubling the reply from 1,000 to 2,000 lines does not roughly quadruple the time", { skip: "S78-2 (session-v78/scraps.md): layoutOf rescans a prefix per line; needs a resumable scanBrackets" }, () => {
  keepSketch(bigRust(200));
  const t1 = timeOf(bigRust(1000));
  const t2 = timeOf(bigRust(2000));
  assert.ok(t2 / t1 < 3, `1,000 lines ${t1.toFixed(0)}ms, 2,000 lines ${t2.toFixed(0)}ms, ratio ${(t2 / t1).toFixed(2)}`);
});

// ---------------------------------------------------------------------------
// Evidence for the disputed blind row (expected to PASS)
// ---------------------------------------------------------------------------

const PY_MEAN = {
  languageId: "python",
  originalSpan: L(
    "def mean(values: list[float]) -> float:",
    "    # return 0.0 for an empty list",
    "    # add the values up",
    "    # divide by the count",
    "    pass",
  ),
  reply: L(
    "def mean(values: list[float]) -> float:",
    "    # return 0.0 for an empty list",
    "    if not values:",
    "        return 0.0",
    "    # add the values up",
  ),
};

test("E1 blind CRLF row: the CRLF reply survives as a byte prefix; only a CRLF and the placed line are appended", () => {
  const reply = crlf(PY_MEAN.reply);
  const r = keepSketch({ ...PY_MEAN, originalSpan: crlf(PY_MEAN.originalSpan), reply });
  assert.ok(r.text.startsWith(reply), JSON.stringify(r.text));
  assert.strictEqual(r.text.slice(reply.length), "\r\n    # divide by the count");
});

test("E2 blind CRLF row: the LF twin appends the same shape, so the blind helper passes LF only because it splits on \\n", () => {
  const r = keepSketch(PY_MEAN);
  assert.ok(r.text.startsWith(PY_MEAN.reply));
  assert.strictEqual(r.text.slice(PY_MEAN.reply.length), "\n    # divide by the count");
  // The blind helper's comparison, applied to the CRLF run, flags the old
  // last line only because it now carries the `\r` of its new terminator.
  const reply = crlf(PY_MEAN.reply);
  const rc = keepSketch({ ...PY_MEAN, originalSpan: crlf(PY_MEAN.originalSpan), reply });
  const lastReplyLine = reply.split("\n").pop();
  const sameLineInText = rc.text.split("\n")[reply.split("\n").length - 1];
  assert.strictEqual(sameLineInText, lastReplyLine + "\r");
});
