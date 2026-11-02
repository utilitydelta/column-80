// Blind oracle for session-v78 phase 1: keepSketch guarantees the developer's
// sketch comments survive fn-gen's reply, in order, so regenerating from the
// result reads the same sketch. Bound to session-v78/contract-p1.md, rules 1-8.
//
// Written without reading src/core/scaffoldKeep.ts. The real harvest
// (harvestBodyComments over bodyTextOfSpan) is the oracle for the sketch and
// for rule 2, exactly as the contract defines it.
//
// Every row carries a fixture sanity check that runs against the harvest alone,
// so a row's expected text is proven to round-trip before keepSketch is asked
// to produce it. If src/core/scaffoldKeep.ts is missing, the sanity rows pass
// and every keepSketch row fails naming the missing module.
//
// Exact bytes are asserted only where the contract is exact (rule 4 placement
// before the next code line and its indent, rules 5-6 reply untouched, rule 1
// identity). Rules 2, 5 and 6 follow the human ruling of 2026-11-02: the tool
// never removes or edits a reply comment, and `stripped` is always empty.
// Elsewhere the rows assert ordering, round trip, code identity and idempotence.
//
// Run: SKIP_LIVE=1 node --test test/blind-v78-p1-keep-sketch.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const harvestBundle = bundleCore(
  "blind-v78-p1-harvest",
  `export { harvestBodyComments, bodyTextOfSpan } from "../src/core/scaffold";\n`,
);
test.after(harvestBundle.cleanup);
const { harvestBodyComments, bodyTextOfSpan } = harvestBundle.mod;

let keepSketch;
let keepLoadError;
try {
  const keepBundle = bundleCore(
    "blind-v78-p1-keep-sketch",
    [
      `export { keepSketch } from "../src/core/scaffoldKeep";`,
      `export { harvestBodyComments, bodyTextOfSpan } from "../src/core/scaffold";`,
      "",
    ].join("\n"),
  );
  test.after(keepBundle.cleanup);
  keepSketch = keepBundle.mod.keepSketch;
} catch (err) {
  keepLoadError = err;
  // bundleCore registers no cleanup when the build fails; remove its entry file.
  require("fs").rmSync(require("path").join(__dirname, ".blind-v78-p1-keep-sketch.entry.ts"), { force: true });
}

function requireKeep() {
  if (typeof keepSketch !== "function") {
    assert.fail(
      `keepSketch is not available from src/core/scaffoldKeep: ${keepLoadError ? keepLoadError.message.split("\n")[0] : "not exported"}`,
    );
  }
  return keepSketch;
}

// ---------------------------------------------------------------------------
// Shared contract helpers
// ---------------------------------------------------------------------------

const L = (...lines) => lines.join("\n");
const crlf = (s) => s.replace(/\r?\n/g, "\r\n");

function harvestOf(text, row) {
  return harvestBodyComments(bodyTextOfSpan(text, row.lang, row.bodyOnly === true), row.lang, row.bodyIndent ?? "")
    .comments;
}

function sketchOf(row) {
  return harvestOf(row.original, row);
}

function inputOf(row) {
  const input = { languageId: row.lang, originalSpan: row.original, reply: row.reply };
  if (row.bodyOnly !== undefined) input.bodyOnly = row.bodyOnly;
  if (row.bodyIndent !== undefined) input.bodyIndent = row.bodyIndent;
  return input;
}

const OPENERS = { rust: ["//", "/*"], typescript: ["//", "/*"], go: ["//", "/*"], csharp: ["//", "/*"], python: ["#"] };

// A line that is only a comment, or a block comment's continuation. Fixtures
// never start a code line with `*`, so the continuation test is safe here.
function isCommentLine(line, lang) {
  const t = line.trim();
  if (t === "") return false;
  if (OPENERS[lang].some((o) => t.startsWith(o))) return true;
  return lang !== "python" && (t.startsWith("*") || t.startsWith("*/"));
}

function splitLines(text) {
  return text.split(/\r?\n/);
}

// Rule 6: every line of the reply survives in order and byte-identical (the
// split on \r?\n: rule 8 owns the terminators), and every line the tool added is a comment line.
// Returns the added lines.
function assertReplyUntouched(reply, text, lang, label) {
  const replyLines = splitLines(reply);
  const textLines = splitLines(text);
  const added = [];
  let j = 0;
  for (const line of textLines) {
    if (j < replyLines.length && line === replyLines[j]) {
      j++;
    } else {
      added.push(line);
    }
  }
  assert.strictEqual(
    j,
    replyLines.length,
    `${label}: rule 6, reply line ${j} missing or changed: ${JSON.stringify(replyLines[j])}\n--- text ---\n${text}`,
  );
  for (const line of added) {
    assert.ok(isCommentLine(line, lang), `${label}: rule 6, added a non-comment line ${JSON.stringify(line)}`);
  }
  return added;
}

function lcs(a, b) {
  const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
  return dp[a.length][b.length];
}

// Rule 2's equality clause applies when the reply adds no body-depth comment of
// its own: every comment the reply's harvest holds is a kept sketch line.
function replyAddsNoComments(row) {
  const replyHarvest = harvestOf(row.reply, row);
  return lcs(sketchOf(row), replyHarvest) === replyHarvest.length;
}

function isSubsequence(small, big) {
  let j = 0;
  for (const x of big) if (j < small.length && small[j] === x) j++;
  return j === small.length;
}

// ---------------------------------------------------------------------------
// Fixtures. `expect` fields are asserted only when present.
// ---------------------------------------------------------------------------

const RUST_SKETCH_SPAN = L(
  "fn main() {",
  "// say hello world",
  "// get two numbers from user",
  "// use the add function to add the numbers together",
  "// dump the output to console",
  "}",
);
const RS_A = "say hello world";
const RS_B = "get two numbers from user";
const RS_C = "use the add function to add the numbers together";
const RS_D = "dump the output to console";

const RUST_DROP_ALL_REPLY = L(
  "fn main() {",
  '    println!("hello world");',
  "    let a = read_number();",
  "    let b = read_number();",
  "    let sum = add(a, b);",
  '    println!("{}", sum);',
  "}",
);
const RUST_DROP_ALL_TEXT = L(
  "fn main() {",
  "    // say hello world",
  "    // get two numbers from user",
  "    // use the add function to add the numbers together",
  "    // dump the output to console",
  '    println!("hello world");',
  "    let a = read_number();",
  "    let b = read_number();",
  "    let sum = add(a, b);",
  '    println!("{}", sum);',
  "}",
);

const RUST_KEEP_ALL_REPLY = L(
  "fn main() {",
  "    // say hello world",
  '    println!("hello world");',
  "    // get two numbers from user",
  "    let a = read_number();",
  "    let b = read_number();",
  "    // use the add function to add the numbers together",
  "    let sum = add(a, b);",
  "    // dump the output to console",
  '    println!("{}", sum);',
  "}",
);

const ROWS = [
  // ---------------- Rust: the human's example and its variants ----------------
  {
    name: "rust: reply drops all four sketch lines, all placed before the first code line",
    lang: "rust",
    original: RUST_SKETCH_SPAN,
    reply: RUST_DROP_ALL_REPLY,
    expect: { text: RUST_DROP_ALL_TEXT, keptByModel: 0, placedByTool: [RS_A, RS_B, RS_C, RS_D], stripped: [] },
  },
  {
    name: "rust: reply keeps all four in order, returned unchanged",
    lang: "rust",
    original: RUST_SKETCH_SPAN,
    reply: RUST_KEEP_ALL_REPLY,
    expect: { text: RUST_KEEP_ALL_REPLY, keptByModel: 4, placedByTool: [], stripped: [] },
  },
  {
    name: "rust: reply keeps two in order and one out of order; the stray stays, the missing two are placed after the last kept",
    lang: "rust",
    original: RUST_SKETCH_SPAN,
    reply: L(
      "fn main() {",
      "    // dump the output to console",
      "    // say hello world",
      '    println!("hello world");',
      "    // get two numbers from user",
      "    let a = read_number();",
      "    let b = read_number();",
      "    let sum = add(a, b);",
      '    println!("{}", sum);',
      "}",
    ),
    expect: {
      text: L(
        "fn main() {",
        "    // dump the output to console",
        "    // say hello world",
        '    println!("hello world");',
        "    // get two numbers from user",
        "    // use the add function to add the numbers together",
        "    // dump the output to console",
        "    let a = read_number();",
        "    let b = read_number();",
        "    let sum = add(a, b);",
        '    println!("{}", sum);',
        "}",
      ),
      keptByModel: 2,
      placedByTool: [RS_C, RS_D],
      stripped: [],
    },
  },
  {
    name: "rust: reply keeps two sketch lines in swapped order (tie in the subsequence), only counts and round trip asserted",
    lang: "rust",
    original: RUST_SKETCH_SPAN,
    reply: L(
      "fn main() {",
      "    // get two numbers from user",
      "    let a = read_number();",
      "    let b = read_number();",
      "    // say hello world",
      '    println!("hello world");',
      '    println!("{}", add(a, b));',
      "}",
    ),
    expect: { keptByModel: 1, stripped: [], placedCount: 3 },
  },
  {
    name: "rust: reply rewords one sketch line; the rewording stays, the original is placed after the previous kept line",
    lang: "rust",
    original: RUST_SKETCH_SPAN,
    reply: L(
      "fn main() {",
      "    // say hello world",
      '    println!("hello world");',
      "    // read two numbers from the user",
      "    let a = read_number();",
      "    let b = read_number();",
      "    // use the add function to add the numbers together",
      "    let sum = add(a, b);",
      "    // dump the output to console",
      '    println!("{}", sum);',
      "}",
    ),
    expect: {
      text: L(
        "fn main() {",
        "    // say hello world",
        "    // get two numbers from user",
        '    println!("hello world");',
        "    // read two numbers from the user",
        "    let a = read_number();",
        "    let b = read_number();",
        "    // use the add function to add the numbers together",
        "    let sum = add(a, b);",
        "    // dump the output to console",
        '    println!("{}", sum);',
        "}",
      ),
      keptByModel: 3,
      placedByTool: [RS_B],
      stripped: [],
    },
  },
  {
    name: "rust: reply adds its own body-depth comment; it stays, and so do nested comments",
    lang: "rust",
    original: RUST_SKETCH_SPAN,
    reply: L(
      "fn main() {",
      "    // say hello world",
      '    println!("hello world");',
      "    // get two numbers from user",
      "    let a = read_number();",
      "    // parse the second number too",
      "    let b = read_number();",
      "    // use the add function to add the numbers together",
      "    let sum = add(a, b);",
      "    if sum > 100 {",
      "        // a large sum is still printed",
      '        println!("big");',
      "    }",
      "    // dump the output to console",
      '    println!("{}", sum);',
      "}",
    ),
    expect: { textIsReply: true, keptByModel: 4, placedByTool: [], stripped: [] },
  },
  {
    name: "rust: a trailing body-depth comment stays on its code line",
    lang: "rust",
    original: RUST_SKETCH_SPAN,
    reply: L(
      "fn main() {",
      "    // say hello world",
      '    println!("hello world");',
      "    // get two numbers from user",
      "    let a = read_number();",
      "    let b = read_number();   // second operand",
      "    // use the add function to add the numbers together",
      "    let sum = add(a, b);",
      "    // dump the output to console",
      '    println!("{}", sum);',
      "}",
    ),
    expect: { textIsReply: true, keptByModel: 4, placedByTool: [], stripped: [] },
  },
  {
    name: "rust: a trailing comment the model added and a missing sketch line placed before that same code line",
    lang: "rust",
    original: RUST_SKETCH_SPAN,
    reply: L(
      "fn main() {",
      '    println!("hello world"); // greet',
      "}",
    ),
    expect: {
      text: L(
        "fn main() {",
        "    // say hello world",
        "    // get two numbers from user",
        "    // use the add function to add the numbers together",
        "    // dump the output to console",
        '    println!("hello world"); // greet',
        "}",
      ),
      keptByModel: 0,
      placedByTool: [RS_A, RS_B, RS_C, RS_D],
      stripped: [],
    },
  },
  {
    name: "rust: comments inside an if block and a closure are never touched while sketch lines are placed",
    lang: "rust",
    original: RUST_SKETCH_SPAN,
    reply: L(
      "fn main() {",
      "    // say hello world",
      '    println!("hello world");',
      "    let a = read_number();",
      "    let b = read_number();",
      "    if a > 100 {",
      "        // too big, clamp it",
      "        println!(\"big\");",
      "    }",
      "    let f = |x: i32| {",
      "        // closure note",
      "        x + 1",
      "    };",
      "    // dump the output to console",
      '    println!("{}", f(add(a, b)));',
      "}",
    ),
    expect: {
      text: L(
        "fn main() {",
        "    // say hello world",
        "    // get two numbers from user",
        "    // use the add function to add the numbers together",
        '    println!("hello world");',
        "    let a = read_number();",
        "    let b = read_number();",
        "    if a > 100 {",
        "        // too big, clamp it",
        "        println!(\"big\");",
        "    }",
        "    let f = |x: i32| {",
        "        // closure note",
        "        x + 1",
        "    };",
        "    // dump the output to console",
        '    println!("{}", f(add(a, b)));',
        "}",
      ),
      keptByModel: 2,
      placedByTool: [RS_B, RS_C],
      stripped: [],
    },
  },
  {
    name: "rust: last sketch line missing after the last code line is placed at the end of the body at the code indent",
    lang: "rust",
    original: RUST_SKETCH_SPAN,
    reply: L(
      "fn main() {",
      "    // say hello world",
      '    println!("hello world");',
      "    // get two numbers from user",
      "    let a = read_number();",
      "    let b = read_number();",
      '    println!("{}", add(a, b));',
      "    // use the add function to add the numbers together",
      "}",
    ),
    expect: {
      text: L(
        "fn main() {",
        "    // say hello world",
        '    println!("hello world");',
        "    // get two numbers from user",
        "    let a = read_number();",
        "    let b = read_number();",
        '    println!("{}", add(a, b));',
        "    // use the add function to add the numbers together",
        "    // dump the output to console",
        "}",
      ),
      keptByModel: 3,
      placedByTool: [RS_D],
      stripped: [],
    },
  },
  {
    name: "rust: empty body reply gets every sketch line at the original comment indent, before the closing brace",
    lang: "rust",
    original: RUST_SKETCH_SPAN,
    reply: L("fn main() {", "}"),
    expect: {
      text: L(
        "fn main() {",
        "// say hello world",
        "// get two numbers from user",
        "// use the add function to add the numbers together",
        "// dump the output to console",
        "}",
      ),
      keptByModel: 0,
      placedByTool: [RS_A, RS_B, RS_C, RS_D],
      stripped: [],
    },
  },
  {
    name: "rust: empty body reply, original indented by four, inserted at four",
    lang: "rust",
    original: L("fn main() {", "    // say hello world", "    // dump the output to console", "}"),
    reply: L("fn main() {", "}"),
    expect: {
      text: L("fn main() {", "    // say hello world", "    // dump the output to console", "}"),
      keptByModel: 0,
      placedByTool: [RS_A, RS_D],
      stripped: [],
    },
  },
  {
    name: "rust: placed line keeps the developer's opener and words as written (doc-style opener, extra spaces)",
    lang: "rust",
    original: L("fn main() {", "  ///   say hello world", "}"),
    reply: L("fn main() {", '    println!("hello world");', "}"),
    expect: {
      text: L("fn main() {", "    ///   say hello world", '    println!("hello world");', "}"),
      keptByModel: 0,
      placedByTool: [RS_A],
      stripped: [],
    },
  },
  {
    name: "rust: a kept line keeps the model's bytes when it differs from the original only in decoration",
    lang: "rust",
    original: L("fn main() {", "//   say hello world", "}"),
    reply: L("fn main() {", "    //say hello world", '    println!("hello world");', "}"),
    expect: {
      text: L("fn main() {", "    //say hello world", '    println!("hello world");', "}"),
      keptByModel: 1,
      placedByTool: [],
      stripped: [],
    },
  },

  // ---------------- TypeScript ----------------
  {
    name: "typescript: drops all; comment inside an arrow callback is untouched",
    lang: "typescript",
    original: L(
      "export function total(items: Item[]): number {",
      "  // skip items with no price",
      "  // sum the prices",
      "  // round to two decimals",
      "}",
    ),
    reply: L(
      "export function total(items: Item[]): number {",
      "  const priced = items.filter((item) => {",
      "    // a zero price is still a price",
      "    return item.price !== undefined;",
      "  });",
      "  const sum = priced.reduce((acc, item) => acc + item.price, 0);",
      "  return Math.round(sum * 100) / 100;",
      "}",
    ),
    expect: {
      text: L(
        "export function total(items: Item[]): number {",
        "  // skip items with no price",
        "  // sum the prices",
        "  // round to two decimals",
        "  const priced = items.filter((item) => {",
        "    // a zero price is still a price",
        "    return item.price !== undefined;",
        "  });",
        "  const sum = priced.reduce((acc, item) => acc + item.price, 0);",
        "  return Math.round(sum * 100) / 100;",
        "}",
      ),
      keptByModel: 0,
      placedByTool: ["skip items with no price", "sum the prices", "round to two decimals"],
      stripped: [],
    },
  },
  {
    name: "typescript: block-comment sketch line placed verbatim, a kept line written with // stays as //",
    lang: "typescript",
    original: L(
      "function total(items: Item[]): number {",
      "  /* skip items with no price */",
      "  /* sum the prices */",
      "}",
    ),
    reply: L(
      "function total(items: Item[]): number {",
      "  // skip items with no price",
      "  const priced = items.filter((item) => item.price !== undefined);",
      "  return priced.reduce((acc, item) => acc + item.price, 0);",
      "}",
    ),
    expect: {
      text: L(
        "function total(items: Item[]): number {",
        "  // skip items with no price",
        "  /* sum the prices */",
        "  const priced = items.filter((item) => item.price !== undefined);",
        "  return priced.reduce((acc, item) => acc + item.price, 0);",
        "}",
      ),
      keptByModel: 1,
      placedByTool: ["sum the prices"],
      stripped: [],
    },
  },
  {
    name: "typescript: a trailing comment and an extra body comment the model added both stay",
    lang: "typescript",
    original: L("function clamp(x: number, lo: number, hi: number): number {", "  // clamp into the range", "}"),
    reply: L(
      "function clamp(x: number, lo: number, hi: number): number {",
      "  // guard the order",
      "  if (lo > hi) throw new Error(\"bad range\"); // caller bug",
      "  // clamp into the range",
      "  return Math.min(hi, Math.max(lo, x));",
      "}",
    ),
    expect: { textIsReply: true, keptByModel: 1, placedByTool: [], stripped: [] },
  },
  {
    name: "typescript: a missing sketch line goes immediately before the first code line, below the model's own leading comment",
    lang: "typescript",
    original: L("function clamp(x: number, lo: number, hi: number): number {", "  // clamp into the range", "}"),
    reply: L(
      "function clamp(x: number, lo: number, hi: number): number {",
      "  // guard the order",
      "  if (lo > hi) throw new Error(\"bad range\");",
      "  return Math.min(hi, Math.max(lo, x));",
      "}",
    ),
    expect: {
      text: L(
        "function clamp(x: number, lo: number, hi: number): number {",
        "  // guard the order",
        "  // clamp into the range",
        "  if (lo > hi) throw new Error(\"bad range\");",
        "  return Math.min(hi, Math.max(lo, x));",
        "}",
      ),
      keptByModel: 0,
      placedByTool: ["clamp into the range"],
      stripped: [],
    },
  },
  {
    name: "typescript: multi-line block sketch, model drops it (placement bytes not asserted)",
    lang: "typescript",
    original: L("function next(x: number): number {", "  /*", "   * double it", "   * add one", "   */", "}"),
    reply: L("function next(x: number): number {", "  const doubled = x * 2;", "  return doubled + 1;", "}"),
    expect: { keptByModel: 0, placedCount: 2, stripped: [] },
  },

  // ---------------- Go, tabs ----------------
  {
    name: "go: drops all; comment in an if block untouched; tab indent",
    lang: "go",
    original: L(
      "func Parse(s string) (int, error) {",
      "\t// trim spaces",
      "\t// reject empty input",
      "\t// convert with strconv",
      "}",
    ),
    reply: L(
      "func Parse(s string) (int, error) {",
      "\ts = strings.TrimSpace(s)",
      '\tif s == "" {',
      "\t\t// nothing to parse",
      '\t\treturn 0, errors.New("empty")',
      "\t}",
      "\treturn strconv.Atoi(s)",
      "}",
    ),
    expect: {
      text: L(
        "func Parse(s string) (int, error) {",
        "\t// trim spaces",
        "\t// reject empty input",
        "\t// convert with strconv",
        "\ts = strings.TrimSpace(s)",
        '\tif s == "" {',
        "\t\t// nothing to parse",
        '\t\treturn 0, errors.New("empty")',
        "\t}",
        "\treturn strconv.Atoi(s)",
        "}",
      ),
      keptByModel: 0,
      placedByTool: ["trim spaces", "reject empty input", "convert with strconv"],
      stripped: [],
    },
  },
  {
    name: "go: keeps first and last, middle placed after the first; the model's trailing comment stays",
    lang: "go",
    original: L(
      "func Parse(s string) (int, error) {",
      "\t// trim spaces",
      "\t// reject empty input",
      "\t// convert with strconv",
      "}",
    ),
    reply: L(
      "func Parse(s string) (int, error) {",
      "\t// trim spaces",
      "\ts = strings.TrimSpace(s) // drop whitespace",
      '\tif s == "" {',
      '\t\treturn 0, errors.New("empty")',
      "\t}",
      "\t// convert with strconv",
      "\treturn strconv.Atoi(s)",
      "}",
    ),
    expect: {
      text: L(
        "func Parse(s string) (int, error) {",
        "\t// trim spaces",
        "\t// reject empty input",
        "\ts = strings.TrimSpace(s) // drop whitespace",
        '\tif s == "" {',
        '\t\treturn 0, errors.New("empty")',
        "\t}",
        "\t// convert with strconv",
        "\treturn strconv.Atoi(s)",
        "}",
      ),
      keptByModel: 2,
      placedByTool: ["reject empty input"],
      stripped: [],
    },
  },
  {
    name: "go: comment inside a func literal untouched; empty-ish body gets lines at the code indent",
    lang: "go",
    original: L("func Run() {", "\t// start the worker", "\t// wait for it", "}"),
    reply: L("func Run() {", "\tdone := make(chan bool)", "\tgo func() {", "\t\t// signal when finished", "\t\tdone <- true", "\t}()", "\t<-done", "}"),
    expect: {
      text: L(
        "func Run() {",
        "\t// start the worker",
        "\t// wait for it",
        "\tdone := make(chan bool)",
        "\tgo func() {",
        "\t\t// signal when finished",
        "\t\tdone <- true",
        "\t}()",
        "\t<-done",
        "}",
      ),
      keptByModel: 0,
      placedByTool: ["start the worker", "wait for it"],
      stripped: [],
    },
  },
  {
    name: "go: empty body reply, tab-indented original",
    lang: "go",
    original: L("func Run() {", "\t// start the worker", "}"),
    reply: L("func Run() {", "}"),
    expect: { text: L("func Run() {", "\t// start the worker", "}"), keptByModel: 0, placedByTool: ["start the worker"], stripped: [] },
  },

  // ---------------- Python, full span ----------------
  {
    name: "python: drops all; nested comment and the model's trailing comment untouched",
    lang: "python",
    original: L(
      "def mean(values: list[float]) -> float:",
      "    # return 0.0 for an empty list",
      "    # add the values up",
      "    # divide by the count",
      "    pass",
    ),
    reply: L(
      "def mean(values: list[float]) -> float:",
      "    if not values:",
      "        # nothing to average",
      "        return 0.0",
      "    total = sum(values)  # builtin sum",
      "    return total / len(values)",
    ),
    expect: {
      text: L(
        "def mean(values: list[float]) -> float:",
        "    # return 0.0 for an empty list",
        "    # add the values up",
        "    # divide by the count",
        "    if not values:",
        "        # nothing to average",
        "        return 0.0",
        "    total = sum(values)  # builtin sum",
        "    return total / len(values)",
      ),
      keptByModel: 0,
      placedByTool: ["return 0.0 for an empty list", "add the values up", "divide by the count"],
      stripped: [],
    },
  },
  {
    name: "python: keeps two of three, the model's extra body comment stays",
    lang: "python",
    original: L(
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
      "    # use the builtin",
      "    total = sum(values)",
      "    # divide by the count",
      "    return total / len(values)",
    ),
    expect: {
      text: L(
        "def mean(values: list[float]) -> float:",
        "    # return 0.0 for an empty list",
        "    # add the values up",
        "    if not values:",
        "        return 0.0",
        "    # use the builtin",
        "    total = sum(values)",
        "    # divide by the count",
        "    return total / len(values)",
      ),
      keptByModel: 2,
      placedByTool: ["add the values up"],
      stripped: [],
    },
  },
  {
    name: "python: last sketch line placed after the last body line (bytes beyond order not asserted)",
    lang: "python",
    original: L(
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
    expect: { keptByModel: 2, placedByTool: ["divide by the count"], stripped: [], lastLine: "    # divide by the count" },
  },

  // ---------------- Python, bodyOnly ----------------
  {
    name: "python bodyOnly: drops both; nested comment under except untouched",
    lang: "python",
    bodyOnly: true,
    bodyIndent: "    ",
    original: L("    # read the config file", "    # fall back to defaults when missing", "    return None"),
    reply: L(
      "    try:",
      "        return read_config(path)",
      "    except FileNotFoundError:",
      "        # use defaults",
      "        return DEFAULTS",
    ),
    expect: {
      text: L(
        "    # read the config file",
        "    # fall back to defaults when missing",
        "    try:",
        "        return read_config(path)",
        "    except FileNotFoundError:",
        "        # use defaults",
        "        return DEFAULTS",
      ),
      keptByModel: 0,
      placedByTool: ["read the config file", "fall back to defaults when missing"],
      stripped: [],
    },
  },
  {
    name: "python bodyOnly: keeps the second only, first placed before the first code line",
    lang: "python",
    bodyOnly: true,
    bodyIndent: "    ",
    original: L("    # read the config file", "    # fall back to defaults when missing", "    return None"),
    reply: L(
      "    try:",
      "        return read_config(path)",
      "    # fall back to defaults when missing",
      "    except FileNotFoundError:",
      "        return DEFAULTS",
    ),
    expect: {
      text: L(
        "    # read the config file",
        "    try:",
        "        return read_config(path)",
        "    # fall back to defaults when missing",
        "    except FileNotFoundError:",
        "        return DEFAULTS",
      ),
      keptByModel: 1,
      placedByTool: ["read the config file"],
      stripped: [],
    },
  },
  {
    name: "python bodyOnly with derived indent (bodyIndent absent)",
    lang: "python",
    bodyOnly: true,
    original: L("    # read the config file", "    return None"),
    reply: L("    data = read_config(path)", "    return data"),
    expect: {
      text: L("    # read the config file", "    data = read_config(path)", "    return data"),
      keptByModel: 0,
      placedByTool: ["read the config file"],
      stripped: [],
    },
  },

  // ---------------- C# ----------------
  {
    name: "csharp: drops all; comment inside foreach block untouched",
    lang: "csharp",
    original: L(
      "public decimal Total(IEnumerable<Order> orders)",
      "{",
      "    // ignore cancelled orders",
      "    // sum the line totals",
      "    // apply the discount",
      "}",
    ),
    reply: L(
      "public decimal Total(IEnumerable<Order> orders)",
      "{",
      "    var live = orders.Where(o => !o.Cancelled).ToList();",
      "    var sum = live.Sum(o => o.LineTotal);",
      "    foreach (var o in live)",
      "    {",
      "        // log each order",
      "        Log(o);",
      "    }",
      "    return sum * (1 - Discount);",
      "}",
    ),
    expect: {
      text: L(
        "public decimal Total(IEnumerable<Order> orders)",
        "{",
        "    // ignore cancelled orders",
        "    // sum the line totals",
        "    // apply the discount",
        "    var live = orders.Where(o => !o.Cancelled).ToList();",
        "    var sum = live.Sum(o => o.LineTotal);",
        "    foreach (var o in live)",
        "    {",
        "        // log each order",
        "        Log(o);",
        "    }",
        "    return sum * (1 - Discount);",
        "}",
      ),
      keptByModel: 0,
      placedByTool: ["ignore cancelled orders", "sum the line totals", "apply the discount"],
      stripped: [],
    },
  },
  {
    name: "csharp: rewords one and adds a trailing comment; both stay and the original is placed",
    lang: "csharp",
    original: L(
      "public decimal Total(IEnumerable<Order> orders)",
      "{",
      "    // ignore cancelled orders",
      "    // sum the line totals",
      "    // apply the discount",
      "}",
    ),
    reply: L(
      "public decimal Total(IEnumerable<Order> orders)",
      "{",
      "    // ignore cancelled orders",
      "    var live = orders.Where(o => !o.Cancelled);",
      "    // total every line",
      "    var sum = live.Sum(o => o.LineTotal); // decimal sum",
      "    // apply the discount",
      "    return sum * (1 - Discount);",
      "}",
    ),
    expect: {
      text: L(
        "public decimal Total(IEnumerable<Order> orders)",
        "{",
        "    // ignore cancelled orders",
        "    // sum the line totals",
        "    var live = orders.Where(o => !o.Cancelled);",
        "    // total every line",
        "    var sum = live.Sum(o => o.LineTotal); // decimal sum",
        "    // apply the discount",
        "    return sum * (1 - Discount);",
        "}",
      ),
      keptByModel: 2,
      placedByTool: ["sum the line totals"],
      stripped: [],
    },
  },
  {
    name: "csharp: keeps all three, returned unchanged",
    lang: "csharp",
    original: L("public int Add(int a, int b)", "{", "    // add them", "}"),
    reply: L("public int Add(int a, int b)", "{", "    // add them", "    return a + b;", "}"),
    expect: { text: L("public int Add(int a, int b)", "{", "    // add them", "    return a + b;", "}"), keptByModel: 1, placedByTool: [], stripped: [] },
  },
];

// Rule 1: no sketch. Each original has no body-depth comment (a doc comment
// above the header, a docstring, or only nested comments), and the reply has
// body-depth comments of its own. The reply comes back byte-identical.
const NO_SKETCH_ROWS = [
  {
    name: "rust: doc comment above the header and a nested comment are not a sketch",
    lang: "rust",
    original: L("/// Adds two numbers.", "fn add(a: i32, b: i32) -> i32 {", "    if a > 0 {", "        // nested", "    }", "    0", "}"),
    reply: L("/// Adds two numbers.", "fn add(a: i32, b: i32) -> i32 {", "    // the sum", "    a + b // trailing", "}"),
  },
  {
    name: "typescript: empty body",
    lang: "typescript",
    original: L("function f(x: number): number {", "}"),
    reply: L("function f(x: number): number {", "  // double", "  return x * 2;", "}"),
  },
  {
    name: "go: comment only inside a nested block",
    lang: "go",
    original: L("func F(x int) int {", "\tif x > 0 {", "\t\t// positive", "\t}", "\treturn 0", "}"),
    reply: L("func F(x int) int {", "\t// return double", "\treturn x * 2", "}"),
  },
  {
    name: "python: docstring is not a sketch",
    lang: "python",
    original: L("def f(x: int) -> int:", '    """Double x."""', "    pass"),
    reply: L("def f(x: int) -> int:", '    """Double x."""', "    # double it", "    return x * 2"),
  },
  {
    name: "python bodyOnly: no comments",
    lang: "python",
    bodyOnly: true,
    bodyIndent: "    ",
    original: L("    return None"),
    reply: L("    # double it", "    return x * 2"),
  },
  {
    name: "csharp: empty body",
    lang: "csharp",
    original: L("public int Twice(int x)", "{", "}"),
    reply: L("public int Twice(int x)", "{", "    // double", "    return x * 2;", "}"),
  },
];

// Rule 8: every sketch row again with CRLF on both sides.
const CRLF_ROWS = ROWS.map((row) => ({
  ...row,
  name: `${row.name} [CRLF]`,
  original: crlf(row.original),
  reply: crlf(row.reply),
  expect: row.expect.text === undefined ? row.expect : { ...row.expect, text: crlf(row.expect.text) },
  crlf: true,
}));

const ALL_SKETCH_ROWS = [...ROWS, ...CRLF_ROWS];

// ---------------------------------------------------------------------------
// Fixture sanity: proves the rows themselves against the real harvest, so a
// keepSketch failure below is the implementation's, not the fixture's.
// ---------------------------------------------------------------------------

test("fixture sanity: every sketch row has a non-empty sketch and its expected text round-trips", () => {
  for (const row of ROWS) {
    const sketch = sketchOf(row);
    assert.ok(sketch.length > 0, `${row.name}: fixture has an empty sketch`);
    assert.ok(
      row.expect.text === undefined || row.expect.textIsReply === undefined,
      `${row.name}: fixture sets both text and textIsReply`,
    );
    const expected = row.expect.textIsReply ? row.reply : row.expect.text;
    if (expected !== undefined) {
      const h = harvestOf(expected, row);
      assert.ok(isSubsequence(sketch, h), `${row.name}: sketch is not a subsequence of the expected text's harvest`);
      if (replyAddsNoComments(row)) {
        assert.deepStrictEqual(h, sketch, `${row.name}: expected text does not round-trip exactly`);
      }
      const added = assertReplyUntouched(row.reply, expected, row.lang, `${row.name} (fixture)`);
      if (row.expect.placedByTool !== undefined) {
        assert.strictEqual(added.length, row.expect.placedByTool.length, `${row.name}: fixture added-line count`);
      }
    }
    if (row.expect.placedByTool !== undefined && row.expect.keptByModel !== undefined) {
      assert.strictEqual(row.expect.keptByModel + row.expect.placedByTool.length, sketch.length, `${row.name}: fixture counts`);
    }
  }
});

test("fixture sanity: every no-sketch row has an empty sketch and a reply with body-depth comments", () => {
  for (const row of NO_SKETCH_ROWS) {
    assert.deepStrictEqual(sketchOf(row), [], `${row.name}: fixture sketch not empty`);
    assert.ok(harvestOf(row.reply, row).length > 0, `${row.name}: reply has no body-depth comment`);
  }
});

test("fixture sanity: the harvest picks up a trailing body-depth comment, so rule 2's subsequence (not equality) case is live", () => {
  const row = ROWS.find((r) => r.name.startsWith("rust: a trailing body-depth comment"));
  assert.ok(harvestOf(row.reply, row).includes("second operand"));
  assert.ok(!replyAddsNoComments(row));
});

// ---------------------------------------------------------------------------
// keepSketch rows
// ---------------------------------------------------------------------------

test("rule 1: an empty sketch returns the reply byte-identical with zero counts", () => {
  const keep = requireKeep();
  for (const base of NO_SKETCH_ROWS) {
    for (const row of [base, { ...base, name: `${base.name} [CRLF]`, original: crlf(base.original), reply: crlf(base.reply) }]) {
      const r = keep(inputOf(row));
      assert.strictEqual(r.text, row.reply, `${row.name}: text changed`);
      assert.strictEqual(r.keptByModel, 0, `${row.name}: keptByModel`);
      assert.deepStrictEqual(r.placedByTool, [], `${row.name}: placedByTool`);
      assert.deepStrictEqual(r.stripped, [], `${row.name}: stripped`);
    }
  }
});

test("rules 3-5: exact results where the contract fixes the bytes", () => {
  const keep = requireKeep();
  for (const row of ALL_SKETCH_ROWS) {
    const r = keep(inputOf(row));
    const e = row.expect;
    if (e.textIsReply) {
      assert.strictEqual(r.text, row.reply, `${row.name}: text must equal the reply\n--- got ---\n${r.text}`);
    }
    if (e.text !== undefined) {
      assert.strictEqual(r.text, e.text, `${row.name}: text\n--- got ---\n${r.text}\n--- want ---\n${e.text}`);
    }
    if (e.keptByModel !== undefined) assert.strictEqual(r.keptByModel, e.keptByModel, `${row.name}: keptByModel`);
    if (e.placedByTool !== undefined) assert.deepStrictEqual(r.placedByTool, e.placedByTool, `${row.name}: placedByTool`);
    if (e.stripped !== undefined) assert.deepStrictEqual(r.stripped, e.stripped, `${row.name}: stripped`);
    if (e.placedCount !== undefined) assert.strictEqual(r.placedByTool.length, e.placedCount, `${row.name}: placed count`);
    if (e.lastLine !== undefined) {
      const lines = splitLines(r.text).filter((l) => l.trim() !== "");
      assert.strictEqual(lines[lines.length - 1], e.lastLine, `${row.name}: last body line`);
    }
  }
});

test("rule 2: the sketch is an in-order subsequence of the result's harvest, equal when the reply adds no comments", () => {
  const keep = requireKeep();
  for (const row of ALL_SKETCH_ROWS) {
    const r = keep(inputOf(row));
    const h = harvestOf(r.text, row);
    assert.ok(isSubsequence(sketchOf(row), h), `${row.name}: sketch not a subsequence of the result's harvest\n${JSON.stringify(h)}\n${r.text}`);
    if (replyAddsNoComments(row)) {
      assert.deepStrictEqual(h, sketchOf(row), `${row.name}: round trip not exact\n${r.text}`);
    }
  }
});

test("rules 3-4: counts agree; placed lines are the sketch minus a kept in-order subsequence", () => {
  const keep = requireKeep();
  for (const row of ALL_SKETCH_ROWS) {
    const sketch = sketchOf(row);
    const r = keep(inputOf(row));
    assert.strictEqual(r.keptByModel + r.placedByTool.length, sketch.length, `${row.name}: kept + placed != sketch length`);
    assert.ok(isSubsequence(r.placedByTool, sketch), `${row.name}: placedByTool not an in-order subsequence of the sketch`);
    assert.deepStrictEqual(r.stripped, [], `${row.name}: rule 5, stripped must be empty`);
    // Nothing removed, only placed lines added: the result's harvest is the
    // reply's harvest plus exactly the placed lines.
    const replyHarvest = harvestOf(row.reply, row);
    const h = harvestOf(r.text, row);
    assert.strictEqual(h.length, replyHarvest.length + r.placedByTool.length, `${row.name}: harvest grew by other than the placed lines`);
    assert.ok(isSubsequence(replyHarvest, h), `${row.name}: a reply comment vanished from the harvest`);
  }
});

test("rule 3: keptByModel is the longest in-order common subsequence of sketch and reply harvest", () => {
  const keep = requireKeep();
  for (const row of ALL_SKETCH_ROWS) {
    const r = keep(inputOf(row));
    assert.strictEqual(r.keptByModel, lcs(sketchOf(row), harvestOf(row.reply, row)), `${row.name}: keptByModel is not the LCS length`);
  }
});

test("rules 5-6: every reply line survives in order and byte-identical; the only additions are placed comment lines", () => {
  const keep = requireKeep();
  for (const row of [...ALL_SKETCH_ROWS, ...NO_SKETCH_ROWS]) {
    const r = keep(inputOf(row));
    const added = assertReplyUntouched(row.reply, r.text, row.lang, row.name);
    // A single-line sketch comment is one added line; the multi-line block row
    // is the only one where the count may differ.
    if (!row.name.includes("multi-line block")) {
      assert.strictEqual(added.length, r.placedByTool.length, `${row.name}: added line count != placedByTool length`);
    }
  }
});

test("rule 7: idempotent - a second pass over the result returns it unchanged with every line kept", () => {
  const keep = requireKeep();
  for (const row of ALL_SKETCH_ROWS) {
    const first = keep(inputOf(row));
    const second = keep({ ...inputOf(row), reply: first.text });
    assert.strictEqual(second.text, first.text, `${row.name}: second pass changed the text`);
    assert.strictEqual(second.keptByModel, sketchOf(row).length, `${row.name}: second pass keptByModel`);
    assert.deepStrictEqual(second.placedByTool, [], `${row.name}: second pass placedByTool`);
    assert.deepStrictEqual(second.stripped, [], `${row.name}: second pass stripped`);
  }
});

test("rule 7: deterministic - the same input gives the same output, and the input is not mutated", () => {
  const keep = requireKeep();
  for (const row of [...ALL_SKETCH_ROWS, ...NO_SKETCH_ROWS]) {
    const input = inputOf(row);
    const frozen = JSON.stringify(input);
    const a = keep(input);
    const b = keep(inputOf(row));
    assert.deepStrictEqual(a, b, `${row.name}: two calls disagree`);
    assert.strictEqual(JSON.stringify(input), frozen, `${row.name}: input mutated`);
  }
});

test("rule 8: a CRLF reply keeps CRLF on every line, inserted lines included", () => {
  const keep = requireKeep();
  for (const row of CRLF_ROWS) {
    const r = keep(inputOf(row));
    assert.ok(!/(^|[^\r])\n/.test(r.text), `${row.name}: a bare LF in the result\n${JSON.stringify(r.text)}`);
  }
  // An LF original with a CRLF reply: the inserted lines follow the reply.
  const row = { ...ROWS[0], reply: crlf(ROWS[0].reply) };
  const r = keep(inputOf(row));
  assert.strictEqual(r.text, crlf(RUST_DROP_ALL_TEXT), "LF original, CRLF reply: inserted lines must carry CRLF");
});
