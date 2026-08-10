// BLIND ORACLE - session-v25 fixes 1 and 7: the plain-continuation bound.
// Black-box contract test for `src/core/fimBound.ts` written against
// `session-v25/contract-bound.md` ONLY. This file has never read the
// implementation and must not be edited to make one pass (AGENTS.md "Rules").
//
// The surface under test: MAX_BOUND_LINES, boundContinuation, boundReached,
// sealCut, and the BoundResult fields. Nothing here names a helper, a regex or
// an internal step; every assertion is a property the contract states.
//
// The class this exists for: at `fn f() {|` the model's first raw line is
// EMPTY, so a first-newline cut serves "" at 100 of 100 sites. Serving the
// first CONTENT line, with its leading blank kept, is the primitive.
//
// Expected RED until the module lands.
//
// Run: SKIP_LIVE=1 node --test test/blind-v25-bound.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "blind-v25-bound",
  `export { MAX_BOUND_LINES, boundContinuation, boundReached, sealCut } from "../src/core/fimBound";\n`,
);
const { MAX_BOUND_LINES, boundContinuation, boundReached, sealCut } = mod;
test.after(cleanup);

// ---- local mechanics for the assertions (never the module's) -------------

const ctxOf = (languageId, currentLinePrefix, extra = {}) => ({
  languageId,
  currentLinePrefix,
  ...extra,
});

/** Content lines: blank (whitespace-only) lines never count. */
const contentLineCount = (text) =>
  text.split("\n").filter((l) => l.trim() !== "").length;

// Rule 5's unsafe-tail vocabulary, transcribed from the contract so the
// safety property can be checked without asking the module.
const DANGLING = [
  "&&", "||", "??", "?.", "=>", "->", "::",
  "=", ",", ".", "?", ":", "+", "-", "*", "/", "%", "&", "|", "^", "!", "<", ">",
];

function endsUnsafe(text) {
  const t = text.replace(/[ \t\r\n]+$/, "");
  if (t === "") return false;
  let bal = 0;
  for (const ch of t) {
    if ("([{".includes(ch)) bal++;
    else if (")]}".includes(ch)) bal--;
  }
  const last = t[t.length - 1];
  if ("([{".includes(last) && bal > 0) return true;
  // Rule 5 amendment: a trailing `,` is safe when an opener is still open,
  // because rule 6 appends that closer and `,)` / `,}` / `,]` is legal in all
  // five languages. Every other dangling token stays unsafe either way.
  if (last === "," && bal > 0) return false;
  return DANGLING.some((d) => t.endsWith(d));
}

// ---- the scenario table --------------------------------------------------
// Every row is a full contract claim. `rule`/`dropped`/`appended` are omitted
// where the contract does not pin them down (noted in the report).

const SCENARIOS = [
  // 1. The end-of-terminator-line class, all five languages. This is the class
  //    a first-newline cut returns "" for.
  {
    name: "rust: at a terminator line the first CONTENT line is served, leading blank kept",
    ctx: ctxOf("rust", "fn f() {"),
    raw: "\n    let mut n = 0;\n    for x in xs {\n        n += x;\n    }\n    n\n}",
    text: "\n    let mut n = 0;",
    rule: "line",
    appended: "",
    dropped: 5,
  },
  {
    name: "csharp: at a terminator line the first CONTENT line is served, leading blank kept",
    ctx: ctxOf("csharp", "    public int Sum(int[] xs) {"),
    raw: "\n        var n = 0;\n        foreach (var x in xs) {\n            n += x;\n        }\n        return n;\n    }",
    text: "\n        var n = 0;",
    rule: "line",
    appended: "",
    dropped: 5,
  },
  {
    name: "typescript: at a terminator line the first CONTENT line is served, leading blank kept",
    ctx: ctxOf("typescript", "function f(xs: number[]) {"),
    raw: "\n  let n = 0;\n  for (const x of xs) {\n    n += x;\n  }\n  return n;\n}",
    text: "\n  let n = 0;",
    rule: "line",
    appended: "",
    dropped: 5,
  },
  {
    name: "go: at a terminator line the first CONTENT line is served, leading blank kept",
    ctx: ctxOf("go", "func f(xs []int) int {"),
    raw: "\n\tn := 0\n\tfor _, x := range xs {\n\t\tn += x\n\t}\n\treturn n\n}",
    text: "\n\tn := 0",
    rule: "line",
    appended: "",
    dropped: 5,
  },
  {
    name: "python: at a terminator line the first CONTENT line is served, leading blank kept",
    ctx: ctxOf("python", "def f(xs):"),
    raw: "\n    n = 0\n    for x in xs:\n        n += x\n    return n",
    text: "\n    n = 0",
    rule: "line",
    appended: "",
    dropped: 3,
  },

  // 2. Leading blank lines are positioning, not content.
  {
    name: "two leading blank lines survive into the served text and cost no content line",
    ctx: ctxOf("rust", "fn f() {"),
    raw: "\n\n    let x = 1;\n    let y = 2;",
    text: "\n\n    let x = 1;",
    rule: "line",
    appended: "",
    dropped: 1,
  },
  {
    name: "a whitespace-only leading line survives verbatim",
    ctx: ctxOf("rust", "fn f() {"),
    raw: "\n   \n    let x = 1;\n    let y = 2;",
    text: "\n   \n    let x = 1;",
    rule: "line",
    appended: "",
    dropped: 1,
  },
  {
    name: "a raw of nothing but leading blanks drops no content line",
    ctx: ctxOf("rust", "fn f() {"),
    raw: "\n\n    let x = 1;",
    text: "\n\n    let x = 1;",
    rule: "line",
    appended: "",
    dropped: 0,
  },

  // 3. Chained statements run to the statement terminator.
  {
    name: "csharp: a LINQ chain runs to the semicolon and stops there",
    ctx: ctxOf("csharp", "        var q = items"),
    raw: "\n            .Where(x => x.Active)\n            .OrderBy(x => x.Name)\n            .ToList();\nreturn q;",
    text: "\n            .Where(x => x.Active)\n            .OrderBy(x => x.Name)\n            .ToList();",
    rule: "statement",
    appended: "",
    dropped: 1,
  },
  {
    name: "typescript: a chain that continues the cursor's own line runs to the semicolon",
    ctx: ctxOf("typescript", "  const out = rows"),
    raw: ".filter(r => r.ok)\n    .map(r => r.id);\nconsole.log(out);",
    text: ".filter(r => r.ok)\n    .map(r => r.id);",
    rule: "statement",
    appended: "",
    dropped: 1,
  },
  {
    name: "rust: an iterator chain runs to the semicolon and stops there",
    ctx: ctxOf("rust", "    let ys = xs"),
    raw: "\n        .iter()\n        .map(|x| x * 2)\n        .collect::<Vec<_>>();\n    println!(\"{:?}\", ys);",
    text: "\n        .iter()\n        .map(|x| x * 2)\n        .collect::<Vec<_>>();",
    rule: "statement",
    appended: "",
    dropped: 1,
  },

  // 4. A construct opener from the per-language table runs to the close.
  {
    name: "rust: `match` runs to the construct close",
    ctx: ctxOf("rust", "    "),
    raw: "match x {\n        1 => go(),\n    }\nnext();",
    text: "match x {\n        1 => go(),\n    }",
    rule: "construct",
    appended: "",
    dropped: 1,
  },
  {
    name: "go: `if err != nil` runs to the construct close",
    ctx: ctxOf("go", "\t"),
    raw: "if err != nil {\n\t\treturn nil, err\n\t}\n\treturn out, nil",
    text: "if err != nil {\n\t\treturn nil, err\n\t}",
    rule: "construct",
    appended: "",
    dropped: 1,
  },
  {
    name: "go: `if err!=nil` matches the phrase whitespace-insensitively",
    ctx: ctxOf("go", "\t"),
    raw: "if err!=nil {\n\t\treturn nil, err\n\t}\n\treturn out, nil",
    text: "if err!=nil {\n\t\treturn nil, err\n\t}",
    rule: "construct",
    appended: "",
    dropped: 1,
  },
  {
    name: "csharp: `switch` runs to the construct close",
    ctx: ctxOf("csharp", "        "),
    raw: "switch (k) {\n            default: return 0;\n        }\n        done();",
    text: "switch (k) {\n            default: return 0;\n        }",
    rule: "construct",
    appended: "",
    dropped: 1,
  },
  {
    name: "typescript: `switch` runs to the construct close",
    ctx: ctxOf("typescript", "  "),
    raw: "switch (k) {\n    default: return 0;\n  }\nafter();",
    text: "switch (k) {\n    default: return 0;\n  }",
    rule: "construct",
    appended: "",
    dropped: 1,
  },
  {
    name: "javascript gets the same construct table as typescript",
    ctx: ctxOf("javascript", "  "),
    raw: "switch (k) {\n    default: return 0;\n  }\nafter();",
    text: "switch (k) {\n    default: return 0;\n  }",
    rule: "construct",
    appended: "",
    dropped: 1,
  },
  {
    name: "typescriptreact gets the same construct table as typescript",
    ctx: ctxOf("typescriptreact", "  "),
    raw: "switch (k) {\n    default: return 0;\n  }\nafter();",
    text: "switch (k) {\n    default: return 0;\n  }",
    rule: "construct",
    appended: "",
    dropped: 1,
  },
  {
    name: "python: `match` runs until the indentation returns to the opener's level",
    ctx: ctxOf("python", "    "),
    raw: "match cmd:\n        case \"a\":\n            go()\n    done()",
    text: "match cmd:\n        case \"a\":\n            go()",
    rule: "construct",
    appended: "",
    dropped: 1,
  },
  {
    name: "python: a construct that starts after a blank line keeps the blank and still closes on indentation",
    ctx: ctxOf("python", "def handle(cmd):"),
    raw: "\n    match cmd:\n        case \"a\":\n            go()\n    done()",
    text: "\n    match cmd:\n        case \"a\":\n            go()",
    rule: "construct",
    appended: "",
    dropped: 1,
  },
  {
    name: "python: `except` continues the `try` construct rather than closing it",
    ctx: ctxOf("python", "    "),
    raw: "try:\n        go()\n    except E:\n        pass\n    done()",
    text: "try:\n        go()\n    except E:\n        pass",
    appended: "",
    dropped: 1,
  },

  // 5. Openers outside the table get rules 1 and 2, never the construct bound.
  {
    name: "csharp: a plain `if` is not in the table, so the line bound stands",
    ctx: ctxOf("csharp", "        "),
    raw: "if (x)\n            go();\n        after();",
    text: "if (x)",
    rule: "line",
    appended: "",
    dropped: 2,
  },
  {
    name: "an unmapped language gets the C-family rules, so a plain `if` is still not a construct",
    ctx: ctxOf("cpp", "        "),
    raw: "if (x)\n            go();\n        after();",
    text: "if (x)",
    rule: "line",
    appended: "",
    dropped: 2,
  },
  {
    name: "typescript: an opener only matches on a word boundary, so `switcher(` is not `switch`",
    ctx: ctxOf("typescript", "  "),
    raw: "switcher(x);\nnext();",
    text: "switcher(x);",
    rule: "line",
    appended: "",
    dropped: 1,
  },

  // 6. The cap is the teeth: four content lines, both extensions.
  {
    name: "rust: a match longer than the cap yields exactly MAX_BOUND_LINES content lines",
    ctx: ctxOf("rust", "    "),
    raw: [
      "match x {",
      "        1 => { a(); }",
      "        2 => { b(); }",
      "        3 => { c(); }",
      "        4 => { d(); }",
      "        5 => { e(); }",
      "        _ => { f(); }",
      "    }",
      "    after();",
    ].join("\n"),
    text: "match x {\n        1 => { a(); }\n        2 => { b(); }\n        3 => { c(); }}",
    rule: "cap",
    appended: "}",
    dropped: 5,
  },
  {
    name: "csharp: a switch longer than the cap yields exactly MAX_BOUND_LINES content lines",
    ctx: ctxOf("csharp", "        "),
    raw: [
      "switch (k) {",
      "            case 1: return a();",
      "            case 2: return b();",
      "            case 3: return c();",
      "            case 4: return d();",
      "            default: return e();",
      "        }",
      "        after();",
    ].join("\n"),
    text: "switch (k) {\n            case 1: return a();\n            case 2: return b();\n            case 3: return c();}",
    rule: "cap",
    appended: "}",
    dropped: 4,
  },
  {
    name: "rust: a comma-terminated match past the cap is served, not refused",
    ctx: ctxOf("rust", "fn f() {"),
    raw: [
      "",
      "    match cmd {",
      "        A => a(),",
      "        B => b(),",
      "        C => c(),",
      "        D => d(),",
      "        _ => z(),",
      "    }",
      "}",
    ].join("\n"),
    text: "\n    match cmd {\n        A => a(),\n        B => b(),\n        C => c(),}",
    rule: "cap",
    appended: "}",
    dropped: 4,
  },
  {
    name: "maxLines overrides the cap",
    ctx: ctxOf("rust", "    ", { maxLines: 2 }),
    raw: [
      "match x {",
      "        1 => { a(); }",
      "        2 => { b(); }",
      "        3 => { c(); }",
      "        4 => { d(); }",
      "        5 => { e(); }",
      "        _ => { f(); }",
      "    }",
      "    after();",
    ].join("\n"),
    text: "match x {\n        1 => { a(); }}",
    rule: "cap",
    appended: "}",
    dropped: 7,
  },

  // 7. Rule 5: never cut at an unsafe point.
  {
    name: "rust: a cut that would land after an unclosed `(` extends to the next safe boundary",
    ctx: ctxOf("rust", "    let x = "),
    raw: "compute(\n        a,\n        b,\n    );\nnext();",
    text: "compute(\n        a,\n        b,\n    );",
    appended: "",
    dropped: 1,
  },
  {
    name: "python: a tail dangling on `=` is never served",
    ctx: ctxOf("python", "    "),
    raw: "total =\n        a + b\n    print(total)",
    text: "total =\n        a + b",
    appended: "",
  },
  {
    name: "python: a tail dangling on `,` with nothing open is never served",
    ctx: ctxOf("python", "    "),
    raw: "a, b = 1,\n        2\n    print(a)",
    text: "a, b = 1,\n        2",
    appended: "",
  },
  {
    name: "python: a tail dangling on `:` is never served",
    ctx: ctxOf("python", "    "),
    raw: "if x:\n        go()\n    done()",
    text: "if x:\n        go()",
    appended: "",
  },
  {
    name: "go: a tail dangling on `.` is never served",
    ctx: ctxOf("go", "\t"),
    raw: "x := client.\n\t\tDo(req)\n\tuse(x)",
    text: "x := client.\n\t\tDo(req)",
    appended: "",
  },
  {
    name: "csharp: a tail dangling on `=>` is never served",
    ctx: ctxOf("csharp", "        "),
    raw: "var f = x =>\n            x + 1;\n        next();",
    text: "var f = x =>\n            x + 1;",
    appended: "",
  },

  // 8. Rule 6: balance what the SERVED TEXT itself left open.
  {
    name: "a statement that genuinely ends with brackets open gets only the missing closer",
    ctx: ctxOf("typescript", "  const v = "),
    raw: "lookup(map.get(k)",
    text: "lookup(map.get(k))",
    rule: "line",
    appended: ")",
    dropped: 0,
  },
  {
    name: "closers are appended innermost first, at the very end of the text",
    ctx: ctxOf("typescript", "  const v = "),
    raw: "f(a, b[i",
    text: "f(a, b[i])",
    rule: "line",
    appended: "])",
    dropped: 0,
  },
  {
    name: "rust: a brace the served text opened is closed on the same line",
    ctx: ctxOf("rust", "    "),
    raw: "if x { go();",
    text: "if x { go();}",
    rule: "line",
    appended: "}",
    dropped: 0,
  },
  {
    name: "an opener sitting in currentLinePrefix is never balanced",
    ctx: ctxOf("typescript", "foo("),
    raw: "bar",
    text: "bar",
    rule: "line",
    appended: "",
    dropped: 0,
  },
  {
    name: "nothing open means nothing appended",
    ctx: ctxOf("typescript", "  "),
    raw: "x = 1;",
    text: "x = 1;",
    rule: "line",
    appended: "",
    dropped: 0,
  },
];

for (const s of SCENARIOS) {
  test(`boundContinuation: ${s.name}`, () => {
    const got = boundContinuation(s.raw, s.ctx);
    assert.strictEqual(got.text, s.text);
    if (s.rule !== undefined) assert.strictEqual(got.rule, s.rule);
    if (s.appended !== undefined) assert.strictEqual(got.appended, s.appended);
    if (s.dropped !== undefined) assert.strictEqual(got.droppedLines, s.dropped);
    assert.strictEqual(got.refusedUnsafe, false);
  });
}

// ---- the primitive, stated on its own ------------------------------------

test("MAX_BOUND_LINES is four content lines", () => {
  assert.strictEqual(MAX_BOUND_LINES, 4);
});

test("a terminator-line site never serves the empty string", () => {
  const terminatorSites = SCENARIOS.slice(0, 5);
  assert.strictEqual(terminatorSites.length, 5);
  for (const s of terminatorSites) {
    const got = boundContinuation(s.raw, s.ctx);
    assert.notStrictEqual(got.text, "", `empty ghost at ${s.ctx.languageId}`);
    assert.ok(got.text.startsWith("\n"), `leading blank lost at ${s.ctx.languageId}`);
    assert.strictEqual(contentLineCount(got.text), 1);
  }
});

test("no bound ever serves more than MAX_BOUND_LINES content lines", () => {
  for (const s of SCENARIOS) {
    const cap = s.ctx.maxLines ?? MAX_BOUND_LINES;
    const got = boundContinuation(s.raw, s.ctx);
    assert.ok(
      contentLineCount(got.text) <= cap,
      `${s.name}: served ${contentLineCount(got.text)} content lines, cap ${cap}`,
    );
  }
});

test("no served text ever ends at an unsafe point", () => {
  for (const s of SCENARIOS) {
    const got = boundContinuation(s.raw, s.ctx);
    assert.ok(!endsUnsafe(got.text), `${s.name}: unsafe tail in ${JSON.stringify(got.text)}`);
  }
});

test("droppedLines counts content lines and nothing else", () => {
  for (const s of SCENARIOS) {
    if (s.dropped === undefined) continue;
    const got = boundContinuation(s.raw, s.ctx);
    const rawContent = contentLineCount(s.raw);
    const servedContent = contentLineCount(got.text);
    assert.strictEqual(
      got.droppedLines,
      rawContent - servedContent,
      `${s.name}: droppedLines disagrees with the content-line arithmetic`,
    );
  }
});

// ---- refusal: no safe point inside the cap -------------------------------

test("a lone unclosed call with nothing after it is refused, not truncated", () => {
  const got = boundContinuation("foo(", ctxOf("typescript", "  const v = "));
  assert.strictEqual(got.text, "");
  assert.strictEqual(got.refusedUnsafe, true);
  assert.strictEqual(got.rule, "empty");
  assert.strictEqual(got.appended, "");
  assert.strictEqual(got.droppedLines, 1);
});

test("a run of lines with no safe boundary anywhere is refused whole", () => {
  // Every line boundary dangles: an unclosed opener, then `=`, then `.`. None
  // of these is rescued by the trailing-comma amendment.
  const got = boundContinuation(
    "foo(\n    bar =\n    baz.",
    ctxOf("typescript", "  const v = "),
  );
  assert.strictEqual(got.text, "");
  assert.strictEqual(got.refusedUnsafe, true);
  assert.strictEqual(got.rule, "empty");
});

test("a comma tail with an opener still open is safe, so it is not refused", () => {
  const got = boundContinuation(
    "match x {\n        1 => a(),\n        2 => b(),",
    ctxOf("rust", "    "),
  );
  assert.strictEqual(got.refusedUnsafe, false);
  assert.strictEqual(got.text, "match x {\n        1 => a(),\n        2 => b(),}");
  assert.strictEqual(got.appended, "}");
});

test("an empty generation is empty, not a refusal", () => {
  const got = boundContinuation("", ctxOf("rust", "fn f() {"));
  assert.strictEqual(got.text, "");
  assert.strictEqual(got.rule, "empty");
  assert.strictEqual(got.refusedUnsafe, false);
  assert.strictEqual(got.droppedLines, 0);
});

test("a whitespace-only generation is empty, not a refusal", () => {
  const got = boundContinuation("\n  \n\t\n", ctxOf("rust", "fn f() {"));
  assert.strictEqual(got.rule, "empty");
  assert.strictEqual(got.refusedUnsafe, false);
  assert.strictEqual(got.droppedLines, 0);
});

// ---- the eight worked examples, verbatim ---------------------------------

test("worked example 1: end of terminator line, rust", () => {
  const got = boundContinuation(
    "\n    let mut n = 0;\n    for x in xs {\n        n += x;\n    }\n    n\n}",
    ctxOf("rust", "fn f() {"),
  );
  assert.strictEqual(got.text, "\n    let mut n = 0;");
  assert.strictEqual(got.rule, "line");
});

test("worked example 2: mid-statement chain, csharp", () => {
  const got = boundContinuation(
    "\n            .Where(x => x.Active)\n            .OrderBy(x => x.Name)\n            .ToList();\nreturn q;",
    ctxOf("csharp", "        var q = items"),
  );
  assert.strictEqual(
    got.text,
    "\n            .Where(x => x.Active)\n            .OrderBy(x => x.Name)\n            .ToList();",
  );
  assert.strictEqual(got.rule, "statement");
});

test("worked example 3: chain on the same line, typescript", () => {
  const got = boundContinuation(
    ".filter(r => r.ok)\n    .map(r => r.id);\nconsole.log(out);",
    ctxOf("typescript", "  const out = rows"),
  );
  assert.strictEqual(got.text, ".filter(r => r.ok)\n    .map(r => r.id);");
  assert.strictEqual(got.rule, "statement");
});

test("worked example 4: short block, go", () => {
  const got = boundContinuation(
    "if err != nil {\n\t\treturn nil, err\n\t}\n\treturn out, nil",
    ctxOf("go", "\t"),
  );
  assert.strictEqual(got.text, "if err != nil {\n\t\treturn nil, err\n\t}");
  assert.strictEqual(got.rule, "construct");
});

test("worked example 5: the cap holds and the tail it leaves is safe", () => {
  const raw = [
    "match x {",
    "        1 => { a(); }",
    "        2 => { b(); }",
    "        3 => { c(); }",
    "        4 => { d(); }",
    "        5 => { e(); }",
    "        _ => { f(); }",
    "    }",
    "    after();",
  ].join("\n");
  const got = boundContinuation(raw, ctxOf("rust", "    "));
  assert.ok(contentLineCount(got.text) <= MAX_BOUND_LINES);
  assert.ok(!endsUnsafe(got.text));
  assert.strictEqual(got.refusedUnsafe, false);
});

test("worked example 6: unsafe tail extends", () => {
  const got = boundContinuation(
    "compute(\n        a,\n        b,\n    );\nnext();",
    ctxOf("rust", "    let x = "),
  );
  assert.strictEqual(got.text, "compute(\n        a,\n        b,\n    );");
  assert.strictEqual(got.appended, "");
  assert.strictEqual(got.refusedUnsafe, false);
});

test("worked example 7: balance closes only what the served text opened", () => {
  const got = boundContinuation(
    "lookup(map.get(k)",
    ctxOf("typescript", "  const v = "),
  );
  assert.strictEqual(got.text, "lookup(map.get(k))");
  assert.strictEqual(got.appended, ")");
});

test("worked example 7b: an opener in currentLinePrefix appends nothing", () => {
  const got = boundContinuation("bar", ctxOf("typescript", "foo("));
  assert.strictEqual(got.text, "bar");
  assert.strictEqual(got.appended, "");
});

test("worked example 8: no safe point serves nothing and says so", () => {
  const got = boundContinuation("foo(", ctxOf("typescript", "  const v = "));
  assert.strictEqual(got.text, "");
  assert.strictEqual(got.refusedUnsafe, true);
});

// ---- boundReached, the streaming predicate -------------------------------

const RUST_TERMINATOR = ctxOf("rust", "fn f() {");

test("boundReached is false before any newline has arrived", () => {
  assert.strictEqual(boundReached("", RUST_TERMINATOR), false);
  assert.strictEqual(boundReached("    let mut n = 0;", RUST_TERMINATOR), false);
  assert.strictEqual(boundReached("match x {", ctxOf("rust", "    ")), false);
});

test("boundReached is false while only blank lines have arrived", () => {
  assert.strictEqual(boundReached("\n", RUST_TERMINATOR), false);
  assert.strictEqual(boundReached("\n\n", RUST_TERMINATOR), false);
  assert.strictEqual(boundReached("\n   \n  ", RUST_TERMINATOR), false);
});

test("boundReached is true the moment a terminated statement completes its line", () => {
  assert.strictEqual(boundReached("\n    let mut n = 0;\n", RUST_TERMINATOR), true);
  assert.strictEqual(
    boundReached(".filter(r => r.ok);\n", ctxOf("typescript", "  const out = rows")),
    true,
  );
});

test("boundReached is true on the line that closes a construct", () => {
  assert.strictEqual(
    boundReached("if err != nil {\n\t\treturn nil, err\n\t}\n", ctxOf("go", "\t")),
    true,
  );
});

test("boundReached is false when the extension stopped only because the text ran out", () => {
  assert.strictEqual(
    boundReached("lookup(map.get(k)\n", ctxOf("typescript", "  const v = ")),
    false,
  );
  assert.strictEqual(
    boundReached("if err != nil {\n\t\treturn nil, err\n", ctxOf("go", "\t")),
    false,
  );
  assert.strictEqual(boundReached("total =\n", ctxOf("python", "    ")), false);
});

test("boundReached is true once a later complete content line proves the cut", () => {
  assert.strictEqual(
    boundReached("\n    let mut n = 0;\n    for x in xs {\n", RUST_TERMINATOR),
    true,
  );
});

test("boundReached is true once the cap's worth of complete content lines has arrived", () => {
  const ctx = ctxOf("rust", "    ");
  const four =
    "match x {\n        1 => { a(); }\n        2 => { b(); }\n        3 => { c(); }\n";
  assert.strictEqual(boundReached(four, ctx), true);

  const ctx2 = ctxOf("rust", "    ", { maxLines: 2 });
  assert.strictEqual(boundReached("match x {\n        1 => { a(); }\n", ctx2), true);
});

// The conservatism property. Fed one character at a time, the first moment
// boundReached says "stop" must already give the answer the whole raw gives -
// and so must every later moment it says "stop". A true that arrives early is
// a shorter ghost than the bound specifies, which is a correctness bug.

const STREAM_CASES = [
  {
    name: "rust terminator line",
    ctx: RUST_TERMINATOR,
    raw: "\n    let mut n = 0;\n    for x in xs {\n        n += x;\n    }\n    n\n}\n",
  },
  {
    name: "csharp LINQ chain",
    ctx: ctxOf("csharp", "        var q = items"),
    raw: "\n            .Where(x => x.Active)\n            .OrderBy(x => x.Name)\n            .ToList();\nreturn q;\n",
  },
  {
    name: "typescript chain on the cursor's line",
    ctx: ctxOf("typescript", "  const out = rows"),
    raw: ".filter(r => r.ok)\n    .map(r => r.id);\nconsole.log(out);\n",
  },
  {
    name: "go error construct",
    ctx: ctxOf("go", "\t"),
    raw: "if err != nil {\n\t\treturn nil, err\n\t}\n\treturn out, nil\n",
  },
  {
    name: "python match construct",
    ctx: ctxOf("python", "    "),
    raw: "match cmd:\n        case \"a\":\n            go()\n    done()\n",
  },
  {
    name: "rust comma-terminated match past the cap at a terminator head",
    ctx: ctxOf("rust", "fn f() {"),
    raw: [
      "",
      "    match cmd {",
      "        A => a(),",
      "        B => b(),",
      "        C => c(),",
      "        D => d(),",
      "        _ => z(),",
      "    }",
      "}",
      "",
    ].join("\n"),
  },
  {
    name: "rust match past the cap",
    ctx: ctxOf("rust", "    "),
    raw: [
      "match x {",
      "        1 => { a(); }",
      "        2 => { b(); }",
      "        3 => { c(); }",
      "        4 => { d(); }",
      "        5 => { e(); }",
      "        _ => { f(); }",
      "    }",
      "    after();",
      "",
    ].join("\n"),
  },
];

for (const { name, ctx, raw } of STREAM_CASES) {
  test(`boundReached never fires before the answer is settled: ${name}`, () => {
    const whole = boundContinuation(raw, ctx).text;
    let firstTrue = -1;
    for (let i = 0; i <= raw.length; i++) {
      const prefix = raw.slice(0, i);
      if (!boundReached(prefix, ctx)) continue;
      if (firstTrue < 0) firstTrue = i;
      assert.strictEqual(
        boundContinuation(prefix, ctx).text,
        whole,
        `${name}: aborting at char ${i} would serve a different ghost`,
      );
    }
    assert.ok(firstTrue >= 0, `${name}: boundReached never fired, the stream would never abort`);
  });
}

// ---- idempotence ---------------------------------------------------------

for (const s of SCENARIOS) {
  test(`boundContinuation is a fixpoint on its own output: ${s.name}`, () => {
    const once = boundContinuation(s.raw, s.ctx).text;
    assert.strictEqual(boundContinuation(once, s.ctx).text, once);
  });
}

// ---- sealCut, the safety half on its own ---------------------------------

const TS = ctxOf("typescript", "  const v = ");

test("sealCut appends the closers the text itself left open", () => {
  const got = sealCut("f(a, b[i", TS);
  assert.strictEqual(got.text, "f(a, b[i])");
  assert.strictEqual(got.appended, "])");
});

test("sealCut retracts an unsafe tail to the last safe line boundary", () => {
  const got = sealCut("a();\nb =", TS);
  assert.strictEqual(got.text, "a();");
  assert.strictEqual(got.appended, "");
});

test("sealCut does not retract a comma tail that an unclosed opener rescues", () => {
  const got = sealCut("a();\nb(c,", TS);
  assert.strictEqual(got.text, "a();\nb(c,)");
  assert.strictEqual(got.appended, ")");
});

test("sealCut leaves safe, balanced text alone", () => {
  const got = sealCut("a();\nb(c);", TS);
  assert.strictEqual(got.text, "a();\nb(c);");
  assert.strictEqual(got.appended, "");
});

test("sealCut never balances an opener that belongs to currentLinePrefix", () => {
  const got = sealCut("bar", ctxOf("typescript", "foo("));
  assert.strictEqual(got.text, "bar");
  assert.strictEqual(got.appended, "");
});

const SEAL_CASES = [
  { ctx: TS, text: "f(a, b[i" },
  { ctx: TS, text: "a();\nb(c," },
  { ctx: TS, text: "a();\nb =" },
  { ctx: TS, text: "a();\nb(c);" },
  { ctx: TS, text: "" },
  { ctx: ctxOf("rust", "    "), text: "match x {\n        1 => { a(); }" },
  { ctx: ctxOf("python", "    "), text: "total =" },
  { ctx: ctxOf("go", "\t"), text: "if err != nil {\n\t\treturn nil, err" },
];

for (const { ctx, text } of SEAL_CASES) {
  test(`sealCut applied twice equals once: ${JSON.stringify(text)}`, () => {
    const once = sealCut(text, ctx);
    const twice = sealCut(once.text, ctx);
    assert.strictEqual(twice.text, once.text);
    assert.strictEqual(twice.appended, "");
  });

  test(`sealCut never extends: ${JSON.stringify(text)}`, () => {
    const once = sealCut(text, ctx);
    assert.ok(
      contentLineCount(once.text) <= contentLineCount(text),
      `sealCut grew ${JSON.stringify(text)} to ${JSON.stringify(once.text)}`,
    );
  });

  test(`sealCut leaves no unsafe tail: ${JSON.stringify(text)}`, () => {
    const once = sealCut(text, ctx);
    assert.ok(!endsUnsafe(once.text), `unsafe tail in ${JSON.stringify(once.text)}`);
  });
}
