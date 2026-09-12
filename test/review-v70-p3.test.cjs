// Adversarial review of session-v70 phase 3: the per-language counting lens
// [commit 586045a, working tree at 2cad307].
//
// Under attack: `countingLensFor`, the new `neutralizeCSharpCommentsAndStrings`
// and the one-line dispatch change in `extractTestFunctions`
// (src/core/instructPostprocess.ts). Contract: session-v68/contracts/
// P8-bare-reply.md rules 1, 4, 5, 6 and amendment 3; session-v70/goal.md
// defect 2 and "Done looks like".
//
// Every row is tagged `[REV70-P3 n]`. A FAILING row is the finding; its message
// carries the reply, both answers and the mechanism. Green rows pin behaviour
// that holds, so a later fix cannot buy the red ones by breaking them.
//
// Rule 1 rows compare against a facade of MAIN, built read-only with
// `git archive` of the pre-v70 commit into the session scratchpad. Nothing here writes the
// index or the working tree.
//
// Run: node --test test/review-v70-p3.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { bundleCore } = require("./.blind-util.cjs");

const REPO = path.join(__dirname, "..");
// A COMMIT, not the `main` ref: a PR checkout on the runner has no local `main` (run 34670454201
// died on it), and once this branch merges `main` is this code and a differential against it
// compares the lens with itself. 1fb757f is main at 3.5.0, the last commit before session-v70.
const PRE_V70_BASELINE = "1fb757f415b7dd1f9f956d0b761dfbcd78750ebb";

let mod = {};
let cleanup = () => {};
let bundleError;
try {
  ({ mod, cleanup } = bundleCore(
    "rev70p3",
    `export { extractTestModule, extractTestFunctions } from "../src/core/instructPostprocess";\n`
  ));
} catch (e) {
  bundleError = e;
}

let mainMod = {};
let mainCleanup = () => {};
let mainError;
let mainDir;
try {
  mainDir = fs.mkdtempSync(path.join(os.tmpdir(), "c80-rev70p3-main-"));
  const tar = execFileSync("git", ["-C", REPO, "archive", PRE_V70_BASELINE, "src"], {
    maxBuffer: 256 * 1024 * 1024,
  });
  execFileSync("tar", ["-x", "-C", mainDir], { input: tar });
  const entry = path.join(mainDir, "src", "core", "instructPostprocess");
  ({ mod: mainMod, cleanup: mainCleanup } = bundleCore(
    "rev70p3main",
    `export { extractTestModule, extractTestFunctions } from ${JSON.stringify(entry)};\n`
  ));
} catch (e) {
  mainError = e;
}

test.after(() => {
  cleanup();
  mainCleanup();
  if (mainDir) fs.rmSync(mainDir, { recursive: true, force: true });
});

const rtest = (name, fn) =>
  test(name, (ctx) => {
    if (bundleError) return ctx.skip(`bundle failed: ${bundleError}`);
    if (mainError) return ctx.skip(`main facade failed: ${mainError}`);
    return fn(ctx);
  });

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

const L = (...lines) => lines.join("\n");
const FENCE = "```";
const BT = "`";
const AP = "'";
const fenced = (tag, body) => `${FENCE}${tag}\n${body}\n${FENCE}\n`;

const now = (body, lang) =>
  lang === "rust" ? mod.extractTestModule(body) : mod.extractTestFunctions(body, lang);
const old = (body, lang) =>
  lang === "rust" ? mainMod.extractTestModule(body) : mainMod.extractTestFunctions(body, lang);

const n = (r) => (r === undefined ? "REFUSED" : r.testCount);

const report = (label, reply, a, b) =>
  `${label}\n---- REPLY ----\n${reply}\n---- END REPLY ----\n` +
  `working tree: ${n(a)}\nmain:         ${n(b)}`;

test("[REV70-P3 0] harness: both facades build", () => {
  assert.strictEqual(bundleError, undefined, `working-tree bundle failed: ${bundleError}`);
  assert.strictEqual(mainError, undefined, `main facade failed: ${mainError}`);
  assert.strictEqual(typeof mod.extractTestFunctions, "function");
  assert.strictEqual(typeof mainMod.extractTestFunctions, "function");
});

// ===========================================================================
// FINDING 1 (HIGH). The C# 11 raw string literal (`"""`) is unmodelled, and
// unlike main's accidental handling of it the new lens reads the BODY AS CODE.
//
// Mechanism. `neutralizeCSharpCommentsAndStrings` has one plain-string branch
// and it terminates at a newline (deliberately, so a cut literal cannot blank
// the rest of the file). A `"""` opener is therefore read as an EMPTY string
// (`""`) followed by a third quote that opens a one-line string and dies at the
// end of that line. Every line of the raw string's body is then lexed as code.
//
// Main is accidentally right here: the Rust lens does NOT stop a string at a
// newline, so its third quote runs to the raw string's closing delimiter and
// the body is blanked.
// ===========================================================================

const CS_IMPL_RAWSTRING = L(
  "public static class Scaffold {",
  "    public static string Template() {",
  '        return """',
  "        [Fact]",
  "        public void Sample() { }",
  '        """;',
  "    }",
  "}"
);

rtest(
  "[REV70-P3 1] csharp: a PLAIN IMPLEMENTATION whose only [Fact] is in a C# 11 raw string is admitted as a test file",
  () => {
    const reply = fenced("csharp", CS_IMPL_RAWSTRING);
    const a = now(reply, "csharp");
    const b = old(reply, "csharp");
    assert.strictEqual(
      b,
      undefined,
      report("main refused this, which is the baseline the row measures against", reply, a, b)
    );
    assert.strictEqual(
      a,
      undefined,
      report(
        "FALSE ADMIT, fenced path. This is a scaffold helper, not a test file: its only test-shaped\n" +
          "token sits inside a C# 11 raw string literal. The phase's own commit message claims the\n" +
          "plain-implementation refusal now HOLDS on the fenced path; for csharp it was OPENED.\n" +
          "What lands: the implementation is spliced into the generated test file under a message\n" +
          "saying tests were generated.",
        reply,
        a,
        b
      )
    );
  }
);

rtest(
  "[REV70-P3 2] csharp: the same raw string in a REAL test file inflates the count, and the move is an INCREASE",
  () => {
    const body = L(
      "public class T {",
      "    [Fact]",
      "    public void A() {",
      '        var json = """',
      "        [Fact]",
      "        [Fact]",
      '        """;',
      "        Assert.NotNull(json);",
      "    }",
      "",
      "    [Fact]",
      "    public void B() { Assert.True(true); }",
      "}"
    );
    const reply = fenced("csharp", body);
    const a = now(reply, "csharp");
    const b = old(reply, "csharp");
    assert.strictEqual(b.testCount, 2, report("main counts the two real tests", reply, a, b));
    assert.strictEqual(
      a.testCount,
      2,
      report(
        "Rule 1 move in the INCREASING direction on csharp. Two real tests read as four because the\n" +
          "raw string's body is lexed as code. The commit message states 'every non-Rust move a\n" +
          "decrease, every C# verbatim move an increase'; this is a non-verbatim C# increase and the\n" +
          "generated set the claim was measured on carried no raw string literal.",
        reply,
        a,
        b
      )
    );
  }
);

rtest("[REV70-P3 3] csharp: the raw-string false admit reaches the BARE path too", () => {
  const a = now(CS_IMPL_RAWSTRING, "csharp");
  const b = old(CS_IMPL_RAWSTRING, "csharp");
  assert.strictEqual(
    a,
    undefined,
    report(
      "Amendment 3 licenses the bare path being NARROWER than the fenced one. It does not license\n" +
        "the bare path admitting an implementation main refused. Both paths read the same neutral\n" +
        "buffer now, so the raw-string hole is shared.",
      CS_IMPL_RAWSTRING,
      a,
      b
    )
  );
});

// ===========================================================================
// FINDING 2 (HIGH). A backtick inside a TypeScript regex literal blanks the
// reply to EOF, and a reply whose tests all follow it is REFUSED.
//
// Mechanism. The TS counting lens has no regex model (deliberately: it is
// shared with tsFileLocalDefinitions on the prompt path). A `` ` `` inside
// `/.../` opens a template literal, which unlike a quoted string does NOT end
// at the newline, so every later `it(` is blanked. On main the Rust lens did
// not treat a backtick as a delimiter at all, so the reply counted.
//
// The implementer declared this residual in progress.md. What was not measured
// is its reachability. `grep -rcE '= */[^/ ]*`' --include=*.ts src test` in this
// repository answers 5 files: claudeCodeInstruct.ts, goExtraction.ts,
// surfaceRelevance.ts, instructPostprocess.ts, tightenFlags.ts. A markdown- or
// fence-handling module is exactly what this product is asked to write tests
// for, and the fence character is a backtick.
// ===========================================================================

const TS_REGEX_BACKTICK_MODULE = L(
  `const FENCE_RE = /${BT}{3}/;`,
  "",
  'it("finds a fence", () => {',
  '  expect(FENCE_RE.test(threeTicks + "ts")).toBe(true);',
  "});",
  "",
  'it("ignores prose", () => {',
  '  expect(FENCE_RE.test("hello")).toBe(false);',
  "});"
);

rtest(
  "[REV70-P3 4] typescript: a module-level regex holding a backtick REFUSES a well-formed two-test reply",
  () => {
    const reply = fenced("ts", TS_REGEX_BACKTICK_MODULE);
    const a = now(reply, "typescript");
    const b = old(reply, "typescript");
    assert.notStrictEqual(
      b,
      undefined,
      report("main admitted this reply, which is the baseline", reply, a, b)
    );
    assert.notStrictEqual(
      a,
      undefined,
      report(
        "REAL REPLY REFUSED on the fenced path. The user is told 'the model's reply contained no\n" +
          "usable tests' and pays a re-run. Rule 1 says a fenced answer that moves is a defect; this\n" +
          "one moves from a count to a refusal.",
        reply,
        a,
        b
      )
    );
  }
);

rtest(
  "[REV70-P3 5] typescript: a backtick regex inside the FIRST test silently loses every later test from the count",
  () => {
    const body = L(
      'it("strips a fence", () => {',
      `  expect("x".replace(/${BT}/g, "")).toBe("x");`,
      "});",
      "",
      'it("leaves prose alone", () => { expect(1).toBe(1); });'
    );
    const reply = fenced("ts", body);
    const a = now(reply, "typescript");
    const b = old(reply, "typescript");
    assert.strictEqual(b.testCount, 2, report("main counts both", reply, a, b));
    assert.strictEqual(
      a.testCount,
      2,
      report(
        "Under-count, no refusal, no diagnostic. testCount reaches a log line, so this one is quiet\n" +
          "rather than costly; it is the same mechanism as row 4 one test later.",
        reply,
        a,
        b
      )
    );
  }
);

// ===========================================================================
// Confirmed holding. Every row below is GREEN and pins behaviour a later fix
// must not buy the red rows by breaking.
// ===========================================================================

const CS = (inner) =>
  L(
    "public class T {",
    "    [Fact]",
    "    public void A() {",
    `        ${inner}`,
    "        Assert.True(true);",
    "    }",
    "",
    "    [Fact]",
    "    public void B() {",
    "        Assert.True(true);",
    "    }",
    "}"
  );

const CS_FORMS = [
  ["verbatim ending in a doubled quote", 'var s = @"say ""hi""";'],
  ["empty verbatim", 'var s = @"";'],
  ["verbatim path ending in a backslash", 'var p = @"C:\\dir\\";'],
  ["$@ interpolated verbatim", 'var k = 1; var s = $@"C:\\d\\{k}";'],
  ["@$ interpolated verbatim", 'var k = 1; var s = @$"C:\\d\\{k}";'],
  ["a // inside a verbatim string", 'var u = @"http://x/y";'],
  ["a /* inside a plain string", 'var u = "/* not a comment";'],
  ["{{ }} brace escapes in an interpolated string", 'var s = $"{{literal}}";'],
  ["a string inside an interpolation hole", 'var x = true; var s = $"{(x ? "a" : "b")}";'],
  ["char literal holding a double quote", "var q = '\"';"],
  ["char literal holding an apostrophe", "var t = '\\'';"],
  ["char literal holding a backslash", "var e = '\\\\';"],
  ["hex char literal", "var h = '\\x41';"],
  ["plain char literal", "var c = 'A';"],
  ["@class / @event identifiers", "var @class = 1; var @event = 2;"],
  ["a lone apostrophe in a line comment", "// it's only one"],
  ["a lone apostrophe inside a string", 'var s = "it\'s only one";'],
];

for (const [label, inner] of CS_FORMS) {
  rtest(`[REV70-P3 6] csharp lens holds: ${label}`, () => {
    const body = CS(inner);
    const reply = fenced("csharp", body);
    const a = now(reply, "csharp");
    assert.strictEqual(n(a), 2, report(`two [Fact] methods, ${label}`, reply, a, old(reply, "csharp")));
  });
}

rtest("[REV70-P3 7] csharp: a plain string is ended by the newline, so the next line reads as code", () => {
  const body = L(
    "public class T {",
    "    [Fact]",
    '    public void A() { var s = "abc',
    "        Assert.True(true); }",
    "",
    "    [Fact]",
    "    public void B() { Assert.True(true); }",
    "}"
  );
  const reply = fenced("csharp", body);
  const a = now(reply, "csharp");
  assert.strictEqual(
    n(a),
    2,
    report("a cut literal must not blank every later [Fact]", reply, a, old(reply, "csharp"))
  );
});

rtest("[REV70-P3 8] csharp: a block comment does NOT nest, and this is a fenced move in the ADMITTING direction", () => {
  const body = L(
    "public class T {",
    "    /* draft /* inner */",
    "    [Fact]",
    "    public void A() { Assert.True(true); }",
    "",
    "    [Fact]",
    "    public void B() { Assert.True(true); }",
    "}"
  );
  const reply = fenced("csharp", body);
  const a = now(reply, "csharp");
  const b = old(reply, "csharp");
  assert.strictEqual(n(a), 2, report("C# block comments do not nest, so both tests are code", reply, a, b));
  assert.strictEqual(
    b,
    undefined,
    report("main's Rust lens nests the comment, blanks the rest and refuses the reply", reply, a, b)
  );
});

rtest("[REV70-P3 9] csharp: a verbatim string holding [Fact] does not inflate the count", () => {
  const body = L(
    "public class T {",
    "    [Fact]",
    '    public void A() { var p = @"[Fact] [Fact]"; Assert.NotNull(p); }',
    "}"
  );
  const reply = fenced("csharp", body);
  const a = now(reply, "csharp");
  assert.strictEqual(n(a), 1, report("one real test", reply, a, old(reply, "csharp")));
});

rtest("[REV70-P3 10] csharp: #if false code is counted, on main too (pinned, not a move)", () => {
  const body = L(
    "public class T {",
    "#if false",
    "    [Fact]",
    "    public void Dead() { }",
    "#endif",
    "    [Fact]",
    "    public void A() { Assert.True(true); }",
    "}"
  );
  const reply = fenced("csharp", body);
  const a = now(reply, "csharp");
  const b = old(reply, "csharp");
  assert.strictEqual(
    n(a),
    n(b),
    report(
      "the preprocessor is not modelled by either lens. The compiler skips a #if false block, so\n" +
        "the count is one high. Unchanged from main, so it is a limit rather than a phase-3 defect.",
      reply,
      a,
      b
    )
  );
});

// ---------------------------------------------------------------------------
// Rule 1 differential. A clean corpus: no test shape hides in any literal or
// comment, so the per-language routing must not move a single answer.
// ---------------------------------------------------------------------------

const CLEAN_CORPUS = [
  ["python", "f-string with a nested quote", L(
    "def test_alpha():",
    '    x = {"k": 1}',
    `    assert f"{x[${AP}k${AP}]}" == "1"`,
    "",
    "def test_beta():",
    "    assert True"
  )],
  ["python", "bytes literal", L(
    "def test_alpha():",
    '    assert b"abc" == bytes("abc", "utf8")',
    "",
    "def test_beta():",
    "    assert True"
  )],
  ...["rb", "Rb", "BR", "f", "fr", "r"].map((p) => [
    "python",
    `string prefix ${p}`,
    L("def test_alpha():", `    s = ${p}"a\\d"`, "    assert s", "", "def test_beta():", "    assert True"),
  ]),
  ["python", "tests inside a class body", L(
    "class TestThing:",
    "    def test_alpha(self):",
    "        assert True",
    "",
    "    def test_beta(self):",
    "        assert True"
  )],
  ["python", "a __main__ guard after the tests", L(
    "def test_alpha():",
    "    assert True",
    "",
    "def test_beta():",
    "    assert True",
    "",
    'if __name__ == "__main__":',
    "    test_alpha()"
  )],
  ["python", "a docstring with an apostrophe", L(
    "def test_alpha():",
    `    """it${AP}s fine"""`,
    "    assert True",
    "",
    "def test_beta():",
    "    assert True"
  )],
  ["go", "struct tag in backticks", L(
    "type Row struct {",
    `\tName string ${BT}json:"name"${BT}`,
    "}",
    "",
    "func TestAlpha(t *testing.T) {",
    '\tif (Row{}).Name != "" {',
    "\t\tt.Fail()",
    "\t}",
    "}",
    "",
    "func TestBeta(t *testing.T) {",
    "\t_ = 1",
    "}"
  )],
  ["go", "rune literals holding a quote and a backslash", L(
    "func TestAlpha(t *testing.T) {",
    `\tif ${AP}"${AP} != 34 {`,
    "\t\tt.Fail()",
    "\t}",
    `\tif ${AP}\\\\${AP} != 92 {`,
    "\t\tt.Fail()",
    "\t}",
    "}",
    "",
    "func TestBeta(t *testing.T) {",
    "\t_ = 1",
    "}"
  )],
  ["go", "raw string ending in a backslash", L(
    "func TestAlpha(t *testing.T) {",
    `\tp := ${BT}C:\\dir\\${BT}`,
    "\t_ = p",
    "}",
    "",
    "func TestBeta(t *testing.T) {",
    "\t_ = 1",
    "}"
  )],
  ["typescriptreact", "JSX text with an apostrophe", L(
    'it("renders", () => {',
    `  render(<p>it${AP}s here</p>);`,
    "});",
    "",
    'it("renders twice", () => {',
    "  render(<p>ok</p>);",
    "});"
  )],
  ["typescript", "a template nested inside a hole", L(
    'it("a", () => {',
    `  const s = ${BT}x \${ ${BT}y\${1}${BT} } z${BT};`,
    "  expect(s).toBeTruthy();",
    "});",
    "",
    'it("b", () => { expect(1).toBe(1); });'
  )],
  ["csharp", "[Theory] with [InlineData] string rows", L(
    "public class T {",
    "    [Theory]",
    '    [InlineData("a", "b")]',
    '    [InlineData("c", "d")]',
    "    public void A(string x, string y) { Assert.NotEqual(x, y); }",
    "}"
  )],
  ["rust", "doc comments with an apostrophe", L(
    "mod tests {",
    `    /// it${AP}s a doc comment`,
    "    //! inner doc",
    "    #[test]",
    "    fn alpha() { assert!(true); }",
    "    #[test]",
    "    fn beta() { assert!(true); }",
    "}"
  )],
  ["rust", "nested block comment", L(
    "mod tests {",
    "    /* a /* b */ */",
    "    #[test]",
    "    fn alpha() { assert!(true); }",
    "    #[test]",
    "    fn beta() { assert!(true); }",
    "}"
  )],
];

rtest("[REV70-P3 11] rule 1: a clean fenced corpus with no shape in any literal does not move", () => {
  const moved = [];
  for (const [lang, label, body] of CLEAN_CORPUS) {
    const reply = fenced(lang, body);
    const a = now(reply, lang);
    const b = old(reply, lang);
    if (n(a) !== n(b)) moved.push(`${lang} / ${label}: main ${n(b)} -> now ${n(a)}\n${body}`);
  }
  assert.deepStrictEqual(moved, [], `rule 1 moves on a clean corpus:\n\n${moved.join("\n\n")}`);
});

rtest("[REV70-P3 12] rule 1: the same corpus through all four TypeScript ids answers identically", () => {
  const body = L(
    `const tpl = ${BT}it("ghost", () => {});${BT};`,
    "",
    'it("a", () => { expect(1).toBe(1); });',
    "",
    'it("b", () => { expect(2).toBe(2); });'
  );
  const answers = ["typescript", "typescriptreact", "javascript", "javascriptreact"].map((id) =>
    n(now(fenced("ts", body), id))
  );
  assert.deepStrictEqual(
    answers,
    [2, 2, 2, 2],
    `the four TS ids must all reach the TS lens (TS_LANGUAGE_IDS vs TEST_FUNCTION_SHAPES):\n${JSON.stringify(answers)}`
  );
});

rtest("[REV70-P3 13] dispatch: an unregistered languageId is refused before the lens is chosen", () => {
  for (const id of ["ruby", "java", "", "rust", "RUST", "TypeScript", "c#"]) {
    assert.strictEqual(
      mod.extractTestFunctions(fenced(id, 'it("a", () => {});'), id),
      undefined,
      `extractTestFunctions must answer undefined for an id with no TEST_FUNCTION_SHAPES entry: ${JSON.stringify(id)}`
    );
  }
});

// ---------------------------------------------------------------------------
// Rule 5: a bare copy and a fenced copy of the same tests answer the same
// count. Amendment 3 licenses bare being NARROWER (a refusal); it does not
// license a different count when both admit, nor bare admitting what fenced
// refuses.
// ---------------------------------------------------------------------------

const RULE5_BODIES = [
  ["csharp", CS('var s = @"say ""hi""";')],
  ["csharp", CS("var q = '\"';")],
  ["csharp", CS('var p = @"C:\\dir\\";')],
  ["csharp", CS_IMPL_RAWSTRING],
  ["go", CLEAN_CORPUS.find((c) => c[1] === "raw string ending in a backslash")[2]],
  ["go", CLEAN_CORPUS.find((c) => c[1] === "rune literals holding a quote and a backslash")[2]],
  ["python", CLEAN_CORPUS.find((c) => c[1] === "tests inside a class body")[2]],
  ["python", CLEAN_CORPUS.find((c) => c[1] === "a docstring with an apostrophe")[2]],
  ["typescript", TS_REGEX_BACKTICK_MODULE],
];

rtest("[REV70-P3 14] rule 5: bare never admits what fenced refuses, and never counts differently", () => {
  const bad = [];
  for (const [lang, body] of RULE5_BODIES) {
    const f = now(fenced(lang, body), lang);
    const b = now(body, lang);
    if (b === undefined) continue; // narrower in the refusing direction: licensed
    if (f === undefined) bad.push(`${lang}: bare ADMITS ${b.testCount} where fenced refuses\n${body}`);
    else if (f.testCount !== b.testCount)
      bad.push(`${lang}: fenced ${f.testCount} vs bare ${b.testCount}\n${body}`);
  }
  assert.deepStrictEqual(bad, [], `rule 5 breaks:\n\n${bad.join("\n\n")}`);
});

// ---------------------------------------------------------------------------
// Rule 1 / §6: the newly-held plain-implementation refusal must not catch a
// real test reply.
// ---------------------------------------------------------------------------

rtest("[REV70-P3 15] section 6: a Go test file whose FIXTURE is a raw string of test source still counts the real tests", () => {
  const body = L(
    "func TestAlpha(t *testing.T) {",
    "\t_ = 1",
    "}",
    "",
    "func TestBeta(t *testing.T) {",
    "\t_ = 2",
    "}",
    "",
    `const fixture = ${BT}func TestFromFixture(t *testing.T) {}${BT}`
  );
  const reply = fenced("go", body);
  const a = now(reply, "go");
  const b = old(reply, "go");
  assert.strictEqual(
    n(a),
    2,
    report("the two real tests survive; the fixture's TestFromFixture is literal text", reply, a, b)
  );
  assert.strictEqual(n(b), 3, report("main counted the fixture's test as real", reply, a, b));
});

rtest("[REV70-P3 16] section 8: `text` is the original block, never the neutralised buffer", () => {
  const cases = [
    ["csharp", CS('var s = @"say ""hi""";')],
    ["go", CLEAN_CORPUS.find((c) => c[1] === "struct tag in backticks")[2]],
    ["python", CLEAN_CORPUS.find((c) => c[1] === "a docstring with an apostrophe")[2]],
    ["typescript", CLEAN_CORPUS.find((c) => c[1] === "a template nested inside a hole")[2]],
    ["typescriptreact", CLEAN_CORPUS.find((c) => c[1] === "JSX text with an apostrophe")[2]],
    ["rust", CLEAN_CORPUS.find((c) => c[1] === "doc comments with an apostrophe")[2]],
  ];
  const bad = [];
  for (const [lang, body] of cases) {
    const f = now(fenced(lang, body), lang);
    if (f === undefined || f.text !== body) bad.push(`${lang} fenced text is not the block verbatim`);
    const b = now(body, lang);
    if (b !== undefined && b.text !== body) bad.push(`${lang} bare text is not the reply verbatim`);
  }
  assert.deepStrictEqual(bad, [], bad.join("\n"));
});

// ---------------------------------------------------------------------------
// Cost. The char-literal branch slices the whole remaining source at every
// apostrophe reached in CODE position and runs an anchored regex on it, which
// reads as O(n) per apostrophe. V8's sliced strings make the slice O(1), so the
// lens stays linear. Measured, not argued.
// ---------------------------------------------------------------------------

rtest("[REV70-P3 17] cost: the C# char-literal branch is linear, not quadratic", () => {
  const build = (count) => {
    const lines = ["public class T {", "    [Fact] public void A() {"];
    for (let i = 0; i < count; i++) lines.push(`        var c${i} = 'a';`);
    lines.push("    }", "}");
    return fenced("csharp", lines.join("\n"));
  };
  const timeOf = (reply, lang) => {
    mod.extractTestFunctions(reply, lang);
    const t = Date.now();
    mod.extractTestFunctions(reply, lang);
    return Date.now() - t;
  };
  const small = build(5000);
  const big = build(40000);
  const ts = timeOf(small, "csharp");
  const tb = timeOf(big, "csharp");
  const ratio = tb / Math.max(ts, 1);
  assert.ok(
    ratio < 16,
    `8x the apostrophes must not cost more than 16x the time.\n` +
      `5,000 char literals (${small.length} bytes): ${ts}ms\n` +
      `40,000 char literals (${big.length} bytes): ${tb}ms\nratio ${ratio.toFixed(1)}`
  );
  assert.ok(tb < 2000, `40,000 char literals in ${tb}ms`);
});
