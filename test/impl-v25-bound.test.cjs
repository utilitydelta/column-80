// Implementer oracle: the branches of src/core/fimBound.ts the black-box
// contract cannot see from the surface doc - the language dispatch, the family
// split in the termination test, the per-language construct table, and the
// safe-point machinery's extend/retract/refuse legs. Complements
// test/blind-v25-bound.test.cjs.
//
// Run: npm test

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-v25-bound",
  `export { MAX_BOUND_LINES, boundContinuation, boundReached, sealCut } from "../src/core/fimBound";\n` +
    `export { postprocessBounded } from "../src/core/postprocess";\n`
);
const { MAX_BOUND_LINES, boundContinuation, boundReached, sealCut, postprocessBounded } = mod;
test.after(cleanup);

const bound = (raw, languageId, currentLinePrefix = "", maxLines) =>
  boundContinuation(raw, { languageId, currentLinePrefix, maxLines });

// ---- leading blank lines: skipped when counting, kept in the output.
// `toSingleLine` returns "" at 100 of 100 `fn f() {|` sites because it cuts at
// the first newline; the primitive is the first line WITH CONTENT.

test("a ghost that starts on the next line serves that line, not nothing", () => {
  const r = bound("\n    let mut n = 0;\n    for x in xs {\n        n += x;\n    }", "rust", "fn f() {");
  assert.strictEqual(r.text, "\n    let mut n = 0;");
  assert.strictEqual(r.rule, "line");
  assert.strictEqual(r.droppedLines, 3);
});

test("several leading blank lines are all preserved and none count as content", () => {
  const r = bound("\n\n  x = 1;\n  y = 2;", "typescript", "if (a) {", 1);
  assert.strictEqual(r.text, "\n\n  x = 1;");
  assert.strictEqual(r.droppedLines, 1);
});

test("an all-blank generation is empty, and not a refusal", () => {
  const r = bound("\n   \n", "rust", "fn f() {");
  assert.deepStrictEqual(r, { text: "", rule: "empty", droppedLines: 0, appended: "", refusedUnsafe: false });
});

// ---- the cursor's line joins the statement only when the ghost continues it.
// Backwards, and `fn f() {|` never terminates: the prefix's `{` stays open.

test("the prefix's open brace does not hold the statement open across a blank line", () => {
  const r = bound("\n    call();\n    more();", "rust", "fn f() {");
  assert.strictEqual(r.text, "\n    call();");
});

test("the prefix's open paren does hold the statement open when the ghost continues the line", () => {
  const r = bound("a,\n  b,\n);\nnext();", "typescript", "let x = compute(");
  assert.strictEqual(r.text, "a,\n  b,\n);");
  // The prefix's `(` is the buffer's; the editor auto-inserted its closer, so
  // the balance step must not add a second one.
  assert.strictEqual(r.appended, "");
});

// ---- termination test, per language family

const CHAIN_AFTER_TERMINATOR = "a = 1;\n  .b()\nc";

test("a C-family statement stops at its terminator even when the next line continues", () => {
  assert.strictEqual(bound(CHAIN_AFTER_TERMINATOR, "typescript").text, "a = 1;");
  assert.strictEqual(bound(CHAIN_AFTER_TERMINATOR, "csharp").text, "a = 1;");
  assert.strictEqual(bound(CHAIN_AFTER_TERMINATOR, "rust").text, "a = 1;");
});

test("Go has no statement end of its own, so a continuation line still extends", () => {
  assert.strictEqual(bound(CHAIN_AFTER_TERMINATOR, "go").text, "a = 1;\n  .b()");
});

// ---- python decides on its own line: zero balance IS the statement end
//
// Not a terminator character but the same job, and the same latency case: the
// lookahead that proved "the next line does not continue" cost python 2.14
// content lines a request against typescript's 1.15, which is the whole of its
// 207ms p90 against everyone else's 174 to 180. Python has two line
// continuations only, a trailing `\` and open brackets, and zero balance
// excludes the second.

test("a balanced python line ends the statement, with no line below it in hand", () => {
  assert.strictEqual(bound("total = a + b\nprint(total)", "python", "    ").text, "total = a + b");
  // The whole point: no next line at all, and the answer is already the same.
  assert.strictEqual(bound("total = a + b", "python", "    ").text, "total = a + b");
  assert.strictEqual(bound(CHAIN_AFTER_TERMINATOR, "python").text, "a = 1;");
});

test("an explicit backslash is the one python continuation left, and it still extends", () => {
  const raw = "total = a + \\\n        b\n    print(total)";
  assert.strictEqual(bound(raw, "python", "    ").text, "total = a + \\\n        b");
  assert.strictEqual(boundReached("total = a + \\\n", { languageId: "python", currentLinePrefix: "    " }), false);
});

test("a python statement that began ABOVE the served text keeps the lookahead", () => {
  // The bound's balance is local - it sees the cursor's line, never the buffer
  // above it - so a `(` opened three lines up the file reads as balanced. A
  // first content line opening with `+` is the only local evidence, and two of
  // the 150 python raws in the spike-1 corpus are that shape: a parenthesized
  // sum whose every line starts with `+`. Without this they each serve one line
  // where the developer's expression runs to four.
  // The cursor sits under `per_frame = (H * W * 4  # depth`, whose `(` the
  // bound cannot see: only the indent of the cursor's own line reaches it.
  const prefix = " ".repeat(21);
  const raw = "+ H * W * 4  # sky\n                     + Hd * Wd * 3 * 4  # pts\n                     + 1024)";
  assert.strictEqual(bound(raw, "python", prefix).text, raw);
  assert.strictEqual(boundReached("+ H * W * 4  # sky\n", { languageId: "python", currentLinePrefix: prefix }), false);
});

test("an unmapped language takes the C-family rules", () => {
  assert.strictEqual(bound(CHAIN_AFTER_TERMINATOR, "cpp").text, "a = 1;");
});

test("open brackets extend the statement in every family", () => {
  const raw = "x = foo(\n    1,\n)\nprint(x)";
  assert.strictEqual(bound(raw, "python").text, "x = foo(\n    1,\n)");
  assert.strictEqual(bound(raw, "go").text, "x = foo(\n    1,\n)");
});

test("a chain extends line by line and stops after the terminator", () => {
  const r = bound(".filter(r => r.ok)\n    .map(r => r.id);\nconsole.log(out);", "typescript", "  const out = rows");
  assert.strictEqual(r.text, ".filter(r => r.ok)\n    .map(r => r.id);");
  assert.strictEqual(r.rule, "statement");
});

// ---- a trailing block opener terminates the statement.
// The measured defect: `balanced` is false while a fresh `{` is open, so the
// C-family terminator test could never fire at a declaration head. 145 of 152
// cap-rule sites were declaration heads and 117 of the 152 ended in a `}` rule
// 6 had appended, which is a whole function.

test("a declaration head is one line, and rule 6 leaves the block it opened open", () => {
  const r = bound("foo(a: T) -> Vec<R> {\n    let mut out = vec![];\n    out\n}", "rust", "pub fn ");
  assert.strictEqual(r.text, "foo(a: T) -> Vec<R> {");
  assert.strictEqual(r.rule, "line");
  assert.strictEqual(r.appended, "", "closing it here is what made the ghost a whole function");
  assert.strictEqual(r.refusedUnsafe, false);
  assert.strictEqual(r.droppedLines, 3);
});

test("the block-opener arm fires in Go too, which has no statement terminator at all", () => {
  const r = bound("Load(p string) ([]byte, error) {\n\treturn os.ReadFile(p)\n}", "go", "func ");
  assert.strictEqual(r.text, "Load(p string) ([]byte, error) {");
  assert.strictEqual(r.appended, "");
});

test("csharp and the TS family take the same arm", () => {
  assert.strictEqual(bound("Sum(int[] xs) {\n    return 0;\n}", "csharp", "    public int ").text, "Sum(int[] xs) {");
  assert.strictEqual(bound("f(xs: number[]) {\n  return 0;\n}", "typescript", "function ").text, "f(xs: number[]) {");
});

test("a lone content line ending in `{` is served, where it used to be refused whole", () => {
  // Triage finding 3c: 11 of 750 generations were a single `func main() {` with
  // no forward line to extend to and no backward line to retract to, so the
  // ghost died. `func main() {}` was the alternative, an empty body.
  const r = bound("func main() {", "go", "");
  assert.strictEqual(r.text, "func main() {");
  assert.strictEqual(r.refusedUnsafe, false);
  assert.strictEqual(r.appended, "");
});

test("`(` and `[` are still unsafe tails: balancing them changes what the code means", () => {
  assert.strictEqual(bound("compute(", "rust", "    let x = ").refusedUnsafe, true);
  assert.strictEqual(bound("vec![", "rust", "    let x = ").refusedUnsafe, true);
});

test("a second unclosed opener disqualifies the tail: only the block may be left open", () => {
  // `f(x) { g(` leaves `{` and `(`, so the trailing character is not the block
  // opener and the old rule stands.
  const r = bound("f(x) { g(", "rust", "fn ");
  assert.strictEqual(r.refusedUnsafe, true);
});

test("python is out of the arm: `{` there is a dict literal, not a block", () => {
  const r = bound("d = {\n        'a': 1,\n    }\n    print(d)", "python", "    ");
  assert.strictEqual(r.text, "d = {\n        'a': 1,\n    }");
});

test("boundReached fires on the first newline at a declaration head", () => {
  const ctx = { languageId: "rust", currentLinePrefix: "pub fn " };
  assert.strictEqual(boundReached("foo(a: T) -> R {", ctx), false, "a partial line still grows");
  assert.strictEqual(boundReached("foo(a: T) -> R {\n", ctx), true);
});

test("the seal leaves a lone block opener alone, and says so twice", () => {
  const ctx = { languageId: "go", currentLinePrefix: "" };
  const once = sealCut("func main() {", ctx);
  assert.strictEqual(once.text, "func main() {");
  assert.strictEqual(once.appended, "");
  assert.strictEqual(sealCut(once.text, ctx).text, once.text);
});

test("a multi-line signature still gets its body line and a closer, which is the residue", () => {
  // The safety exception is one content line only, so a signature that took two
  // lines has no safe stop at its `{`: the search extends to the next one and
  // rule 6 closes the block. This is decl-args, 56 of the 152 cap-rule sites,
  // and it is the population this change does NOT fix.
  const r = bound("a: T,\n) -> R {\n    body();\n}", "rust", "pub fn foo(");
  assert.strictEqual(r.text, "a: T,\n) -> R {\n    body();}");
  assert.strictEqual(r.appended, "}");
});

// ---- the construct table is per language, matched on a word boundary

test("rust opens a construct on match/if let/while let and nothing else", () => {
  assert.strictEqual(bound("match x {\n  A => f(),\n}\nafter();", "rust").rule, "construct");
  assert.strictEqual(bound("if let Some(v) = o {\n  use(v);\n}\nafter();", "rust").rule, "construct");
  assert.strictEqual(bound("while let Some(v) = it.next() {\n  use(v);\n}\nafter();", "rust").rule, "construct");
  // `switch` is not Rust's, so it takes the line and statement rules - and the
  // trailing `{` terminates the statement on the opener's own line, so the
  // label is `line`. The construct table is the only thing that pulls a `{`
  // line's body in.
  assert.strictEqual(bound("switch x {\n  A => f(),\n}\nafter();", "rust").rule, "line");
});

test("an opener matches on a word boundary, never as a prefix", () => {
  assert.strictEqual(bound("matches(x);\nafter();", "rust").text, "matches(x);");
  assert.strictEqual(bound("switcher();\nafter();", "csharp").text, "switcher();");
});

test("go matches the whole `if err != nil` phrase, whitespace-insensitively", () => {
  const spaced = bound("if err != nil {\n\t\treturn nil, err\n\t}\n\treturn out, nil", "go", "\t");
  assert.strictEqual(spaced.text, "if err != nil {\n\t\treturn nil, err\n\t}");
  assert.strictEqual(spaced.rule, "construct");
  assert.strictEqual(bound("if err!=nil {\n\t\treturn err\n\t}\n\tmore()", "go", "\t").rule, "construct");
  // A different error variable is a different phrase: not in the table, so the
  // statement rules apply and the trailing `{` ends it on its own line.
  const other = bound("if err2 != nil {\n\t\treturn err2\n\t}\n\tmore()", "go", "\t");
  assert.strictEqual(other.rule, "line");
  assert.strictEqual(other.text, "if err2 != nil {");
});

test("csharp and the TS family share switch/try, and reject the others' openers", () => {
  assert.strictEqual(bound("switch (x) {\n  case 1: f();\n    break;\n}", "csharp").rule, "construct");
  assert.strictEqual(bound("try {\n  f();\n} catch {}\nafter();", "typescriptreact").rule, "construct");
  assert.strictEqual(bound("try {\n  f();\n} catch {}\nafter();", "javascript").rule, "construct");
  assert.strictEqual(bound("match (x) {\n  case 1: f();\n}\nafter();", "csharp").rule, "line");
});

// ---- python's construct closes on indentation, not braces

test("python's construct runs while the body is indented past the opener", () => {
  const r = bound("try:\n    x()\nexcept E:\n    y()\nafter()", "python");
  assert.strictEqual(r.text, "try:\n    x()\nexcept E:\n    y()");
  assert.strictEqual(r.rule, "construct");
});

test("python's construct closes at the first line back at the opener's indent", () => {
  const r = bound("match v:\n    case 1:\n        f()\nafter()", "python");
  assert.strictEqual(r.text, "match v:\n    case 1:\n        f()");
});

test("a construct whose braces never open falls back to the statement rules", () => {
  const r = bound("switch (\n  x\n)\nafter();", "csharp");
  assert.strictEqual(r.text, "switch (\n  x\n)");
  assert.strictEqual(r.rule, "statement");
});

// ---- the cap, on both extensions

test("MAX_BOUND_LINES is four content lines, blanks excluded", () => {
  assert.strictEqual(MAX_BOUND_LINES, 4);
  // A chain that never terminates: only the cap can stop it, and the leading
  // blank line does not eat one of the four.
  const r = bound("\n  .a()\n  .b()\n  .c()\n  .d()\n  .e();", "typescript", "const x = rows");
  assert.strictEqual(r.text, "\n  .a()\n  .b()\n  .c()\n  .d()");
  assert.strictEqual(r.rule, "cap");
  assert.strictEqual(r.droppedLines, 1);
});

test("the cap truncates a long python construct and says so", () => {
  const r = bound("try:\n  a()\n  b()\n  c()\n  d()\nafter()", "python");
  assert.strictEqual(r.text, "try:\n  a()\n  b()\n  c()");
  assert.strictEqual(r.rule, "cap");
  assert.strictEqual(r.droppedLines, 2);
});

test("maxLines overrides the cap for tests", () => {
  const r = bound("try:\n  a()\n  b()\n  c()\n  d()\nafter()", "python", "", 2);
  assert.strictEqual(r.text, "try:\n  a()");
  assert.strictEqual(r.rule, "cap");
});

// ---- rule 5: never cut at an unsafe point

test("an unsafe cut extends to the next safe line boundary", () => {
  const r = bound("compute(\n        a,\n        b,\n    );\nnext();", "typescript", "    let x = ");
  assert.strictEqual(r.text, "compute(\n        a,\n        b,\n    );");
});

test("a dangling operator is unsafe, and extending fixes it", () => {
  const r = bound("total +\n  extra;\nnext();", "typescript", "const v = ");
  assert.strictEqual(r.text, "total +\n  extra;");
});

test("with no safe point inside the cap, the bound retracts to the last safe line before its cut", () => {
  const r = bound("try {\n  a();\n  b = c +\n    d +\n    e;\n}", "typescript");
  assert.strictEqual(r.text, "try {\n  a();}");
  assert.strictEqual(r.appended, "}");
});

test("no safe point at all refuses the whole ghost", () => {
  const r = bound("foo(", "typescript");
  assert.deepStrictEqual(r, { text: "", rule: "empty", droppedLines: 1, appended: "", refusedUnsafe: true });
});

// ---- the trailing-comma exception, which is what makes the cap serve four
// lines of a long construct instead of nothing

test("a comma-dangling arm is safe while an opener is still unclosed, so the cap serves its four lines", () => {
  const r = bound("match x {\n    A => 1,\n    B => 2,\n    C => 3,\n    D => 4,\n}", "rust");
  assert.strictEqual(r.refusedUnsafe, false);
  assert.strictEqual(r.rule, "cap");
  assert.strictEqual(r.text, "match x {\n    A => 1,\n    B => 2,\n    C => 3,}");
  assert.strictEqual(r.appended, "}");
});

test("a trailing comma with nothing open is still an unsafe cut", () => {
  // No opener means no closer is coming, so the comma dangles into the buffer.
  const r = bound("a = 1,\nb = 2;\nc();", "typescript");
  assert.strictEqual(r.text, "a = 1,\nb = 2;");
});

test("the exception is the comma alone: other danglers stay unsafe with a bracket open", () => {
  const r = bound("f(\n  x =\n  1\n);", "typescript");
  assert.strictEqual(r.text.endsWith("="), false);
  const opener = bound("compute(", "typescript");
  assert.strictEqual(opener.refusedUnsafe, true);
});

test("a closer is a safe tail, an opener is not", () => {
  assert.strictEqual(bound("f(a)\nb", "typescript").text, "f(a)");
  assert.strictEqual(bound("f(a\nb", "typescript").text, "f(a\nb)");
});

// ---- rule 6: balance only what the served text opened

test("the balance appends the closers of the served text's own openers, innermost first", () => {
  const r = bound("lookup(map.get(k", "typescript", "  const v = ");
  assert.strictEqual(r.appended, "))");
  assert.strictEqual(r.text, "lookup(map.get(k))");
});

test("a closer already in the served text is not appended twice", () => {
  const r = bound("lookup(map.get(k)", "typescript", "  const v = ");
  assert.strictEqual(r.appended, ")");
});

test("an opener in the prefix is the buffer's and is never balanced", () => {
  assert.strictEqual(bound("bar", "typescript", "foo(").appended, "");
});

test("brackets inside a string literal are not structure", () => {
  assert.strictEqual(bound('log("(");\nnext();', "typescript").appended, "");
  assert.strictEqual(bound("log('(');\nnext();", "python").appended, "");
});

test("rust's tick is a lifetime, not a string quote", () => {
  // Skipping from the tick would swallow the `fetch(` and leave nothing to
  // balance; in TS the same tick opens a literal and does exactly that.
  assert.strictEqual(bound("let s: &'a str = fetch(id", "rust").appended, ")");
  assert.strictEqual(bound("const s = 'a str = fetch(id", "typescript").appended, "");
});

// ---- boundReached: conservative by construction

test("boundReached is false while the only line is still partial", () => {
  const ctx = { languageId: "typescript", currentLinePrefix: "" };
  assert.strictEqual(boundReached("", ctx), false);
  assert.strictEqual(boundReached("const x = 1;", ctx), false);
});

test("boundReached is false while only blank lines have arrived", () => {
  const ctx = { languageId: "rust", currentLinePrefix: "fn f() {" };
  assert.strictEqual(boundReached("\n", ctx), false);
  assert.strictEqual(boundReached("\n   \n", ctx), false);
});

test("a reached terminator decides on its own line, which is the latency case", () => {
  const ctx = { languageId: "typescript", currentLinePrefix: "" };
  assert.strictEqual(boundReached("a();\n", ctx), true);
  // Python decides on the same line without a terminator to reach: zero
  // balance is its statement end. Measured over the spike-1 raws, that takes
  // the content lines it must decode before aborting from 2.33 to 1.74.
  assert.strictEqual(boundReached("a()\n", { languageId: "python", currentLinePrefix: "" }), true);
  // Go still needs the next line: its automatic semicolon insertion is a test
  // on the last token, not on balance, so a line ending in `,` or an operator
  // genuinely continues and balance alone proves nothing.
  assert.strictEqual(boundReached("a()\n", { languageId: "go", currentLinePrefix: "\t" }), false);
  assert.strictEqual(boundReached("a()\nb()\n", { languageId: "go", currentLinePrefix: "\t" }), true);
});

test("a closed construct decides on the line that closes it", () => {
  const ctx = { languageId: "go", currentLinePrefix: "\t" };
  assert.strictEqual(boundReached("if err != nil {\n\t\treturn err\n", ctx), false);
  assert.strictEqual(boundReached("if err != nil {\n\t\treturn err\n\t}\n", ctx), true);
});

test("boundReached is false while a longer read could still find a safe point", () => {
  const ctx = { languageId: "typescript", currentLinePrefix: "" };
  assert.strictEqual(boundReached("foo(\n", ctx), false);
  assert.strictEqual(boundReached("foo(\n  a,\n", ctx), false);
});

test("boundReached is false while a chain could still continue", () => {
  const ctx = { languageId: "typescript", currentLinePrefix: "const a = rows" };
  assert.strictEqual(boundReached(".filter(x)\n", ctx), false);
});

test("boundReached is true at the cap, because nothing past it can move the cut", () => {
  const ctx = { languageId: "python", currentLinePrefix: "", maxLines: 2 };
  assert.strictEqual(boundReached("try:\n  a()\n", ctx), true);
});

// ---- the streaming predicate and the bound agree, character by character

const PROPERTY_CASES = [
  { languageId: "rust", currentLinePrefix: "fn f() {", raw: "\n    let mut n = 0;\n    for x in xs {\n        n += x;\n    }\n    n\n}" },
  { languageId: "rust", currentLinePrefix: "    ", raw: "match x {\n        A => f(),\n        B => g(),\n    }\n    done();" },
  { languageId: "csharp", currentLinePrefix: "        var q = items", raw: "\n            .Where(x => x.Active)\n            .OrderBy(x => x.Name)\n            .ToList();\nreturn q;" },
  { languageId: "typescript", currentLinePrefix: "  const out = rows", raw: ".filter(r => r.ok)\n    .map(r => r.id);\nconsole.log(out);" },
  { languageId: "typescript", currentLinePrefix: "    let x = ", raw: "compute(\n        a,\n        b,\n    );\nnext();" },
  { languageId: "typescript", currentLinePrefix: "", raw: "try {\n  a();\n} catch (e) {\n  log(e);\n}\nafter();" },
  { languageId: "go", currentLinePrefix: "\t", raw: "if err != nil {\n\t\treturn nil, err\n\t}\n\treturn out, nil" },
  { languageId: "go", currentLinePrefix: "\t", raw: "count := len(items)\n\tfor _, it := range items {\n\t\tuse(it)\n\t}" },
  { languageId: "python", currentLinePrefix: "def f():", raw: "\n    try:\n        run()\n    except E:\n        pass\n    return 1" },
  { languageId: "python", currentLinePrefix: "    total = ", raw: "sum(\n        x\n        for x in xs\n    )\n    print(total)" },
  // Python's own decision procedure, all three legs: balance decides alone, a
  // backslash holds the statement open, and a statement that began above the
  // served text falls back to the lookahead.
  { languageId: "python", currentLinePrefix: "    ", raw: "total = a + b\n    print(total)\n    return total" },
  { languageId: "python", currentLinePrefix: "    ", raw: "total = a + \\\n        b\n    print(total)" },
  { languageId: "python", currentLinePrefix: " ".repeat(21), raw: "+ H * W * 4  # sky\n                     + Hd * Wd * 3 * 4  # pts\n                     + 1024)" },
  { languageId: "python", currentLinePrefix: "    def ", raw: "should_scan(self, snapshot: Snapshot) -> bool:\n        ...\n" },
  { languageId: "javascript", currentLinePrefix: "const v = ", raw: "lookup(map.get(k)\nsomething();\nmore();" },
  { languageId: "typescript", currentLinePrefix: "", raw: "a();\nb();\nc();\nd();\ne();\nf();" },
];

test("every prefix where boundReached fires serves the same text as the whole generation", () => {
  for (const ctx of PROPERTY_CASES) {
    const { raw, ...rest } = ctx;
    const whole = boundContinuation(raw, rest).text;
    for (let i = 1; i <= raw.length; i++) {
      if (!boundReached(raw.slice(0, i), rest)) {
        continue;
      }
      assert.strictEqual(
        boundContinuation(raw.slice(0, i), rest).text,
        whole,
        `${rest.languageId} aborted at ${i} of ${raw.length}: ${JSON.stringify(raw)}`
      );
    }
  }
});

// Guard against the property above passing vacuously. The cases that never
// abort are the ones whose cut lands ON the last complete content line: only
// COMPLETE lines can be judged, so there the next chunk still decides.
test("most property cases abort before the generation ends", () => {
  const fired = PROPERTY_CASES.filter((ctx) => {
    const { raw, ...rest } = ctx;
    return [...raw].some((_, i) => boundReached(raw.slice(0, i + 1), rest));
  });
  assert.ok(fired.length >= 8, `only ${fired.length} of ${PROPERTY_CASES.length} aborted`);
});

// ---- sealCut: the safety half alone, for text later filters reshaped

test("sealCut leaves a safe tail alone and balances what is open", () => {
  const r = sealCut("foo(bar\nbaz", { languageId: "typescript", currentLinePrefix: "" });
  assert.deepStrictEqual(r, { text: "foo(bar\nbaz)", appended: ")" });
});

test("sealCut retracts to the last safe line boundary, and never extends", () => {
  const r = sealCut("a();\nb = c +", { languageId: "typescript", currentLinePrefix: "" });
  assert.deepStrictEqual(r, { text: "a();", appended: "" });
});

test("sealCut keeps a comma tail that a closer is about to follow", () => {
  const r = sealCut("b(\n  c,", { languageId: "typescript", currentLinePrefix: "" });
  assert.deepStrictEqual(r, { text: "b(\n  c,)", appended: ")" });
});

test("sealCut empties text with no safe line at all", () => {
  assert.deepStrictEqual(sealCut("foo(", { languageId: "typescript", currentLinePrefix: "" }), { text: "", appended: "" });
});

test("sealCut is idempotent", () => {
  const ctx = { languageId: "typescript", currentLinePrefix: "" };
  for (const text of ["foo(bar\nbaz", "a();\nb(\n  c,", "foo(", "x = 1;", "", "\n\n  y();"]) {
    const once = sealCut(text, ctx).text;
    assert.strictEqual(sealCut(once, ctx).text, once, `not idempotent for ${JSON.stringify(text)}`);
  }
});

// ###########################################################################
// The phase-1 adversarial round. One white-box case per defect, each pinning
// the branch the fix lives in rather than the symptom it was found by.
// ###########################################################################

test("finding 1: a cut inside an unterminated literal is an unsafe tail, so the seal cannot grow", () => {
  const ctx = { languageId: "typescript", currentLinePrefix: "  const v = " };
  assert.deepStrictEqual(sealCut('foo("bar', ctx), { text: "", appended: "" });
  // The growth this kills: the closer the old seal appended was swallowed by
  // the same open literal, so `openStack` still reported the `(` and the next
  // application appended another. Five of 750 real generations grew this way.
  assert.strictEqual(sealCut('foo("bar)', ctx).text, "");
  // It is also what makes rule 6's stated justification true - it declines to
  // balance quotes BECAUSE the safety rule refuses a mid-literal tail.
  assert.strictEqual(boundContinuation('foo("bar', ctx).refusedUnsafe, true);
});

test("finding 2: prose in a line comment is not structure, so an apostrophe invents no closer", () => {
  const r = bound("x = f(1); // it's fine\ny = 2;", "typescript", "  ");
  assert.strictEqual(r.appended, "", "the apostrophe opened a literal that swallowed the rest of the scan");
  // The latency half: an unbalanced scan makes the statement look permanently
  // open, so the extension runs to the cap. 97 of 290 TypeScript files in the
  // corpus scanned unbalanced for this reason alone.
  assert.strictEqual(r.rule, "line");
});

test("finding 2: the bound never stops on a comment-only line it would append closers to", () => {
  const r = bound("compute(\n        a,\n        // why\n        b(", "rust", "    let v = ");
  assert.strictEqual(r.appended, ")");
  assert.ok(!r.text.split("\n").pop().includes("//"), `closer inside a comment: ${JSON.stringify(r.text)}`);
  // A TRAILING comment keeps its line: `cutIntroducedComment` runs after the
  // bound and strips exactly that shape, so retracting here would refuse a
  // ghost the pipeline already handles.
  assert.strictEqual(bound("foo(a, // note", "rust", "    ").text, "foo(a, // note)");
});

test("finding 3a: the SAFETY test sees the prefix's open bracket while the BALANCE step does not", () => {
  const r = bound("\n        &self,\n        account_id: u128,", "rust", "    pub async fn catch_up(");
  assert.strictEqual(r.refusedUnsafe, false, "the buffer's `(` is what legalises the trailing comma");
  assert.strictEqual(r.text, "\n        &self,");
  assert.strictEqual(r.appended, "", "that `(` is the buffer's, so rule 6 still must not close it");
});

test("finding 3b: a python declaration head is a whole line, and a bare `if` header still dangles", () => {
  const decl = bound('read_intrinsics(f: Path) -> np.ndarray:\n    """Docs.\n', "python", "def ");
  assert.strictEqual(decl.refusedUnsafe, false);
  assert.strictEqual(decl.text, "read_intrinsics(f: Path) -> np.ndarray:");
  // Narrower than the review asked for, and deliberately: the contract lists
  // `:` as dangling without exception and the blind oracle pins `if x:`
  // extending into its first body line.
  assert.strictEqual(bound("if x:\n        go()\n    done()", "python", "    ").text, "if x:\n        go()");
  // Inside brackets the same character is an annotation or a dict key.
  assert.strictEqual(bound("def f(a:", "python", "    ").refusedUnsafe, true);
});

test("finding 4: no `{` yet is running out of text, so the construct fallback is never a decision", () => {
  const ctx = { languageId: "csharp", currentLinePrefix: "        " };
  assert.strictEqual(boundReached("switch (kind)\n", ctx), false, "the Allman brace has not arrived yet");
  const raw = "switch (kind)\n        // one per wire kind\n        {\n            case 1: return a();\n        }";
  const whole = boundContinuation(raw, ctx).text;
  for (let i = 1; i <= raw.length; i++) {
    const p = raw.slice(0, i);
    if (!boundReached(p, ctx)) {
      continue;
    }
    assert.strictEqual(boundContinuation(p, ctx).text, whole, `aborting at ${i} would serve a different ghost`);
  }
});

test("finding 5: a rust char literal holding a bracket is skipped, a lifetime tick is not", () => {
  assert.strictEqual(bound("let d = '(';", "rust", "    ").appended, "", "`'('` unbalanced the scan");
  // The trade the blanket exclusion was protecting: 233 lifetime ticks against
  // 11 bracket char literals in the rust corpus. Both work now.
  assert.strictEqual(bound("let s: &'a str = fetch(id", "rust", "    ").appended, ")");
  // Two ticks and a tick pair on one line, none of them a char literal: the
  // call and the body both stay open and both get closed, innermost first.
  assert.strictEqual(bound("fn g<'a, 'b>(x: &'a str) -> Cow<'b, str> { wrap(x", "rust", "").appended, ")}");
});

test("finding 6: the seal does not re-append a closer the suffix dedup decided is the buffer's", () => {
  // `try` is in the TS construct table, so the body comes in and the served text
  // ends on the `}` the dedup then recognises as the buffer's.
  const r = postprocessBounded("try {\n    go();\n  }\n  after();", {
    suffix: "\n  }\n}\n",
    currentLinePrefix: "  ",
    multiline: true,
    bound: { languageId: "typescript", currentLinePrefix: "  " },
  });
  assert.strictEqual(r.text, "try {\n    go();", "the `}` the dedup dropped came back as a duplicate");
});

test("finding 7: DANGLING's false positives go, its misses are caught, and `return` stays safe", () => {
  // False positives, with their corpus counts: 180 postfix increments in the Go
  // corpus, 175 Allman generic-close declarations in the C# one.
  assert.strictEqual(bound("count++", "go", "\t").refusedUnsafe, false);
  assert.strictEqual(bound("i--", "go", "\t").refusedUnsafe, false);
  assert.strictEqual(bound("public class C : JsonConverter<double>", "csharp", "    ").refusedUnsafe, false);
  // `->` ends in `>` too, and its angles do not balance, so it still dangles.
  assert.strictEqual(bound("fn helper() ->", "rust", "    ").refusedUnsafe, true);
  // Misses. These are the worse half: rule 6 was bolting a closer onto them.
  assert.strictEqual(bound("for (const x of", "typescript", "  ").refusedUnsafe, true);
  assert.strictEqual(bound("total = a and", "python", "    ").refusedUnsafe, true);
  assert.strictEqual(bound("total = a + \\", "python", "    ").refusedUnsafe, true);
  // Not on the keyword list, because both legitimately end a statement.
  assert.strictEqual(bound("return", "rust", "    ").refusedUnsafe, false);
  assert.strictEqual(bound("} else", "csharp", "    ").refusedUnsafe, false);
});

test("finding 9: the cap counts content lines, so an interior blank costs no slot", () => {
  const raw = "match x {\n        A => a(),\n\n        B => b(),\n        C => c(),\n        _ => z(),\n    }";
  const r = bound(raw, "rust", "    ");
  assert.strictEqual(r.rule, "cap");
  const content = r.text.split("\n").filter((l) => l.trim() !== "").length;
  assert.strictEqual(content, MAX_BOUND_LINES, `a blank between arms cost an arm: ${JSON.stringify(r.text)}`);
});

test("finding 10: closers land on the last content line, never on one of their own or after a CR", () => {
  assert.strictEqual(bound("x = f(a\ny();\n", "typescript", "  ").text, "x = f(a\ny();)");
  assert.strictEqual(bound("x = f(a\r\ny();\r\n", "typescript", "  ").text, "x = f(a\r\ny();)");
});

// ###########################################################################
// FINAL REVIEW FINDING 2. The bound runs in every languageId, because the
// provider registers on document scheme alone - so markdown, plaintext, latex
// and asciidoc reach it. Rule 5 has two halves, and only one of them is a
// statement grammar. The DANGLING classes were measured on the five shipped
// languages; in prose `.` `,` `:` `?` are how a sentence ends, so every safe
// point dangled and 28 of 28 sites over this repo's own ARCHITECTURE.md were
// refused outright.
// ###########################################################################

test("finding 2: a prose sentence ends, it does not dangle", () => {
  const r = bound("keyed on the model input window.\nEvery entry is windowed.\n", "markdown", "The cache is ");
  assert.strictEqual(r.text, "keyed on the model input window.");
  assert.strictEqual(r.refusedUnsafe, false);
  assert.strictEqual(r.rule, "line");
});

test("finding 2: every character in the DANGLING class also ends a prose line", () => {
  for (const end of [".", ",", ":", "?", "-", "+", "="]) {
    const r = bound(`a sentence ending in ${end}\nthe line below it\n`, "plaintext", "");
    assert.strictEqual(r.refusedUnsafe, false, `refused a prose line ending in ${end}`);
    assert.strictEqual(r.text, `a sentence ending in ${end}`);
  }
});

test("finding 2: the STRUCTURAL half of rule 5 survives without a grammar", () => {
  // An opener the served text itself left open, and a literal it left open.
  // Neither is a claim about statements, so neither goes with the grammar.
  assert.strictEqual(bound("a bracketed aside (", "markdown", "").refusedUnsafe, true);
  assert.strictEqual(bound('he said "hello', "markdown", "").refusedUnsafe, true);
});

test("finding 2: a language WITH a grammar is untouched by the exemption", () => {
  assert.strictEqual(bound("let x = a +", "rust", "    ").refusedUnsafe, true);
  assert.strictEqual(bound("total = a and", "python", "    ").refusedUnsafe, true);
  assert.strictEqual(bound("for (const x of", "typescript", "  ").refusedUnsafe, true);
  assert.strictEqual(bound("value :=", "go", "\t").refusedUnsafe, true);
  assert.strictEqual(bound("var x =", "csharp", "    ").refusedUnsafe, true);
});

test("finding 2: the cap, the line rule and rule 6 all still run in prose", () => {
  // The fix is to rule 5 alone. A prose buffer is bounded exactly as code is.
  const r = bound("one.\ntwo.\nthree.\nfour.\nfive.\n", "markdown", "", 4);
  assert.strictEqual(r.text, "one.", "the line rule decides first, the same as in code");
  assert.strictEqual(r.droppedLines, 4);
});
