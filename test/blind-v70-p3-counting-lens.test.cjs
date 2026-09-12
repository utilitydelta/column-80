// Blind oracle for session-v70 phase 3: the counting lens, per language
// [session-v68/contracts/P8-bare-reply.md rules 1, 3, 4, 5, 6, 7 and
// amendment 3; session-v70/goal.md defect 2]. Written from the contract and
// from each language's real literal grammar, WITHOUT READING the body of
// src/core/instructPostprocess.ts. The only thing taken from that file is the
// two exported signatures, which the contract states anyway.
//
// Surface exercised, both through the public seam:
//   extractTestModule(reply)                 ../src/core/instructPostprocess
//   extractTestFunctions(reply, languageId)  ../src/core/instructPostprocess
//
// What this file is for. `testCount` is taken on text with comments and
// strings neutralised, and the neutraliser is the RUST one for every language.
// So a TypeScript single-quoted string, a Go raw backtick string and a Python
// triple-single-quoted block are not literals to it. Test-shaped text hiding
// in one of them is counted as a test. That miscount runs BOTH ways:
//
//   over-count: two real tests plus `const ghost = 'it("x", () => {});'`
//               answer three, and a plain implementation whose comment
//               mentions its own tests is admitted as a test module.
//   under-count: a C# verbatim string ending in a backslash eats its closing
//               quote, the rest of the file is read as one long string, and a
//               real [Fact] stops being counted.
//
// Both are wrong for the same reason, and both are fixed by routing the count
// through a per-language lens. The rows below enumerate each language's real
// literal and comment forms and pin the count at the number of tests that are
// actually there.
//
// Why the rows are not all red. Rust is already counted by the Rust lens, so
// every Rust row here is GREEN today and its job is to stay green: the per
// language routing must not move the language the lens was written for. The
// same goes for every form a different language happens to share with Rust,
// such as a double-quoted string or a `//` comment. A green row that pins a
// baseline is worth as much as a red one that names a defect, because the
// cheap way to pass the red rows is a lens that breaks the green ones.
//
// EXPECTED RED: phase 3 is being written in parallel with this file. A failing
// assert here is a finding, not a harness fault. A bundling crash IS a harness
// fault, which is why the bundle rows are separate and loud.
//
// Run: SKIP_LIVE=1 node --test test/blind-v70-p3-counting-lens.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { bundleCore } = require("./.blind-util.cjs");

// ===========================================================================
// Facade 1: the working tree. Everything except the rule 1 differential runs
// against this.
// ===========================================================================

let mod = {};
let cleanup = () => {};
let bundleError;
try {
  ({ mod, cleanup } = bundleCore(
    "blind70p3",
    `export { extractTestModule, extractTestFunctions } from "../src/core/instructPostprocess";\n`
  ));
} catch (e) {
  bundleError = e;
}

// ===========================================================================
// Facade 2: main's copy of the same module, extracted read-only with
// `git archive` into a scratch directory. This is the OLD answer the rule 1
// differential compares against. Nothing here touches the index or the
// working tree.
// ===========================================================================

const REPO = path.join(__dirname, "..");
let mainMod = {};
let mainCleanup = () => {};
let mainError;
let mainDir;
try {
  mainDir = fs.mkdtempSync(path.join(os.tmpdir(), "c80-v70p3-main-"));
  const tar = execFileSync("git", ["-C", REPO, "archive", "main", "src"], {
    maxBuffer: 256 * 1024 * 1024,
  });
  execFileSync("tar", ["-x", "-C", mainDir], { input: tar });
  const entry = path.join(mainDir, "src", "core", "instructPostprocess");
  ({ mod: mainMod, cleanup: mainCleanup } = bundleCore(
    "blind70p3main",
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

const { extractTestModule, extractTestFunctions } = mod;

// Every row except the bundle rows skips while the bundle is broken, so a
// harness break stays one loud failure instead of a wall of TypeErrors.
const gtest = (name, fn) =>
  test(name, (ctx) => {
    if (bundleError) return ctx.skip("bundle failed to build; see the bundle row");
    return fn(ctx);
  });

test("bundle: the v70 phase 3 surface builds and exports extractTestModule + extractTestFunctions", () => {
  assert.strictEqual(
    bundleError,
    undefined,
    `the bundle failed, so every row below is a harness error rather than a finding: ${bundleError}`
  );
  assert.strictEqual(typeof extractTestModule, "function", "extractTestModule(reply) => { text, testCount } | undefined");
  assert.strictEqual(
    typeof extractTestFunctions,
    "function",
    "extractTestFunctions(reply, languageId) => { text, testCount } | undefined"
  );
});

// ===========================================================================
// Helpers.
// ===========================================================================

const L = (...lines) => lines.join("\n");

const FENCE = "```";

const fencedOf = (tag, body) => `${FENCE}${tag}\n${body}\n${FENCE}\n`;

const show = (label, reply, res) =>
  `${label}\n---- REPLY ----\n${reply}\n---- END REPLY ----\n` +
  `---- RESULT ----\n${res === undefined ? "undefined" : JSON.stringify(res, null, 2)}\n---- END RESULT ----`;

const okShape = (label, reply, res) => {
  assert.ok(res !== undefined && res !== null, show(label, reply, res));
  assert.strictEqual(typeof res.text, "string", show(`${label}: text is not a string`, reply, res));
  assert.ok(
    Number.isInteger(res.testCount) && res.testCount >= 1,
    show(`${label}: an accepted reply carries at least one test, so testCount is a positive integer`, reply, res)
  );
  return res;
};

// ===========================================================================
// The seven languageIds under contract. Rust goes through extractTestModule
// and needs the `mod tests` wrapper; the other six go through
// extractTestFunctions. The four TypeScript-family ids share one grammar and
// one fixture set, because a lens keyed on the id must give all four the same
// answer.
// ===========================================================================

const TS_BASE = (ex) =>
  L(
    'it("shards alpha", () => {',
    `  ${ex.split("\n").join("\n  ")}`,
    '  expect(shardOf("alpha", 8)).toBe(101);',
    "});",
    "",
    'it("shards beta", () => {',
    '  expect(shardOf("beta", 16)).toBe(202);',
    "});"
  );

// A TypeScript fixture whose hidden text sits at module level rather than
// inside a test body. Used where the form is naturally written that way.
const TS_MODULE_BASE = (ex) =>
  L(
    'it("shards alpha", () => {',
    '  expect(shardOf("alpha", 8)).toBe(101);',
    "});",
    "",
    ex,
    "",
    'it("shards beta", () => {',
    '  expect(shardOf("beta", 16)).toBe(202);',
    "});"
  );

const GO_BASE = (ex) =>
  L(
    "func TestShardOfAlpha(t *testing.T) {",
    ex,
    '\tif got := ShardOf("alpha", 8); got != 101 {',
    '\t\tt.Errorf("alpha: got %v", got)',
    "\t}",
    "}",
    "",
    "func TestShardOfBeta(t *testing.T) {",
    '\tif got := ShardOf("beta", 16); got != 202 {',
    '\t\tt.Errorf("beta: got %v", got)',
    "\t}",
    "}"
  );

// Python's test shape is anchored at the start of a line, so a hidden `def
// test_...(` only matters when it sits at a line start. A single-line string
// cannot put it there: the line starts with the assignment. That is why every
// Python form below that can inflate the count is a MULTI-LINE literal with
// the hidden def at column 0, and why the single-line forms are here as
// baseline pins rather than as defect claims.
const PY_BASE = (ex) =>
  L(
    "def test_shard_of_alpha():",
    '    assert shard_of("alpha", 8) == 101',
    "",
    "",
    ex,
    "",
    "",
    "def test_shard_of_beta():",
    '    assert shard_of("beta", 16) == 202'
  );

const CS_BASE = (ex) =>
  L(
    "[Fact]",
    "public void ShardsAlpha()",
    "{",
    ex,
    '    Assert.Equal(101, ShardOf("alpha", 8));',
    "}",
    "",
    "[Fact]",
    "public void ShardsBeta()",
    "{",
    '    Assert.Equal(202, ShardOf("beta", 16));',
    "}"
  );

const RS_BASE = (ex) =>
  L(
    "#[cfg(test)]",
    "mod tests {",
    "    use super::*;",
    "",
    "    #[test]",
    "    fn shard_of_alpha() {",
    ex,
    '        assert_eq!(shard_of("alpha", 8), 101);',
    "    }",
    "",
    "    #[test]",
    "    fn shard_of_beta() {",
    '        assert_eq!(shard_of("beta", 16), 202);',
    "    }",
    "}"
  );

const BT = "`"; // a backtick, so the fixtures below stay readable in a .cjs file

// Each form is { name, ex, plain }. `ex` hides the language's test shape
// inside one literal or comment form. `plain` is the same statement with the
// payload replaced by ordinary text, and it is what the baseline count is
// taken from, so no expected number in this file is hand-computed.
const LANGS = [
  {
    id: "rust",
    fence: "rust",
    extract: (reply) => extractTestModule(reply),
    base: RS_BASE,
    plainEx: '        let example = "shard";',
    forms: [
      {
        name: 'a "..." string holding #[test]',
        ex: '        let example = "#[test] fn ghost() {}";',
      },
      {
        name: 'an r"..." raw string holding #[test]',
        ex: '        let example = r"#[test] fn ghost() {}";',
      },
      {
        name: 'an r#"..."# raw string holding #[test]',
        ex: '        let example = r#"#[test] fn ghost() {}"#;',
      },
      {
        name: 'a MULTI-LINE r#"..."# raw string with #[test] at column 0',
        ex: L('        let example = r#"', "#[test]", "fn ghost() {}", '"#;'),
      },
      {
        name: "a '\"' char literal, then #[test] in a string",
        ex: L("        let quote = '\"';", '        let example = "#[test] fn ghost() {}";'),
      },
      {
        name: "a // comment holding #[test]",
        ex: "        // #[test] fn ghost() {}",
      },
      {
        name: "a NESTED /* /* */ */ comment holding #[test]",
        ex: "        /* outer /* inner */ #[test] fn ghost() {} */",
      },
      {
        name: 'a "..." string holding `mod tests`',
        ex: '        let example = "mod tests { #[test] fn ghost() {} }";',
      },
    ],
    // Rule 6. Not a test module: the wrapper and the attribute live only in a
    // raw string and a comment.
    plainFunction: L(
      "pub fn shard_of(key: &str, buckets: usize) -> usize {",
      '    let example = r#"',
      "#[test]",
      "fn shard_of_alpha() {}",
      '"#;',
      "    // mod tests { #[test] }",
      "    key.len() % buckets",
      "}"
    ),
    scanOnlyNeedle: 'r#"#[test] fn ghost() {}"#',
    scanOnlyEx: '        let example = r#"#[test] fn ghost() {}"#;',
  },

  {
    id: "go",
    fence: "go",
    extract: (reply) => extractTestFunctions(reply, "go"),
    base: GO_BASE,
    plainEx: '\texample := "shard"',
    forms: [
      {
        name: 'a "..." string holding func TestGhost(',
        ex: '\texample := "func TestGhost(t *testing.T) {}"',
      },
      {
        name: "a single-line raw backtick string holding func TestGhost(",
        ex: "\texample := " + BT + "func TestGhost(t *testing.T) {}" + BT,
      },
      {
        name: "a MULTI-LINE raw backtick string with func TestGhost( at column 0",
        ex: L("\texample := " + BT, "func TestGhost(t *testing.T) {", "}", BT),
      },
      {
        name: "a // comment holding func TestGhost(",
        ex: "\t// func TestGhost(t *testing.T) {}",
      },
      {
        name: "a single-line /* */ comment holding func TestGhost(",
        ex: "\t/* func TestGhost(t *testing.T) {} */",
      },
      {
        name: "a MULTI-LINE /* */ comment with func TestGhost( at column 0",
        ex: L("\t/*", "func TestGhost(t *testing.T) {", "}", "\t*/"),
      },
    ],
    plainFunction: L(
      "func ShardOf(key string, buckets int) int {",
      "\texample := " + BT + "func TestShardOf(t *testing.T) {}" + BT,
      "\t// func TestShardOfBeta(t *testing.T) {}",
      "\treturn len(key) % buckets",
      "}"
    ),
    scanOnlyNeedle: BT + "func TestGhost(t *testing.T) {}" + BT,
    scanOnlyEx: "\texample := " + BT + "func TestGhost(t *testing.T) {}" + BT,
  },

  {
    id: "python",
    fence: "python",
    extract: (reply) => extractTestFunctions(reply, "python"),
    base: PY_BASE,
    plainEx: 'EXAMPLE = "shard"',
    forms: [
      {
        name: "a '...' string on one line (the def cannot reach a line start)",
        ex: "EXAMPLE = 'def test_ghost(x):'",
      },
      {
        name: 'a "..." string on one line (the def cannot reach a line start)',
        ex: 'EXAMPLE = "def test_ghost(x):"',
      },
      {
        name: "a MULTI-LINE '''...''' string with def test_ at column 0",
        ex: L("EXAMPLE = '''", "def test_ghost(x):", "    pass", "'''"),
      },
      {
        name: 'a MULTI-LINE """...""" docstring with def test_ at column 0',
        ex: L('EXAMPLE = """', "def test_ghost(x):", "    pass", '"""'),
      },
      {
        name: 'a MULTI-LINE r"""...""" raw string with def test_ at column 0',
        ex: L('EXAMPLE = r"""', "def test_ghost(x):", "    pass", '"""'),
      },
      {
        name: "a MULTI-LINE r'''...''' raw string with def test_ at column 0",
        ex: L("EXAMPLE = r'''", "def test_ghost(x):", "    pass", "'''"),
      },
      {
        name: 'a MULTI-LINE f"""...""" string with def test_ at column 0',
        ex: L('EXAMPLE = f"""', "def test_ghost(x):", '    return f"{x}"', '"""'),
      },
      {
        name: "a MULTI-LINE f'''...''' string with def test_ at column 0",
        ex: L("EXAMPLE = f'''", "def test_ghost(x):", '    return f"{x}"', "'''"),
      },
      {
        name: "a # comment at column 0 holding def test_",
        ex: "# def test_ghost(x):",
      },
      {
        name: 'a module docstring """...""" with def test_ at column 0',
        ex: L('"""', "Shows the shape a case takes:", "", "def test_ghost(x):", "    pass", '"""'),
      },
    ],
    plainFunction: L(
      "def shard_of(key, buckets):",
      "    example = '''",
      "def test_shard_of(key):",
      "    pass",
      "'''",
      "    # def test_shard_of_beta(key):",
      "    return len(key) % buckets"
    ),
    scanOnlyNeedle: "'''\ndef test_ghost(x):\n    pass\n'''",
    scanOnlyEx: L("EXAMPLE = '''", "def test_ghost(x):", "    pass", "'''"),
  },

  {
    id: "csharp",
    fence: "csharp",
    extract: (reply) => extractTestFunctions(reply, "csharp"),
    base: CS_BASE,
    plainEx: '    var example = "shard";',
    forms: [
      {
        name: 'a "..." string holding a [Fact] row',
        ex: '    var example = "[Fact] public void Ghost() { }";',
      },
      {
        name: 'a MULTI-LINE @"..." verbatim string with [Fact] at column 0',
        ex: L('    var example = @"', "[Fact]", "public void Ghost() { }", '";'),
      },
      {
        // The UNDER-count direction. A verbatim string has no backslash
        // escape, so `\"` at its end is a closing quote and not an escape. A
        // lens that applies the C escape rule here eats the close, reads the
        // rest of the file as one string, and the [Fact] on ShardsBeta stops
        // being counted. This is the same mis-lex as goal.md defect 1, seen
        // through the counter instead of the bare scanner.
        name: 'an @"C:\\dir\\" verbatim path ending in a backslash',
        ex: '    var example = @"C:\\dir\\";',
      },
      {
        name: 'an @"..." verbatim string using the "" escape pair',
        ex: '    var example = @"the ""[Fact]"" attribute";',
      },
      {
        name: 'a $"..." interpolated string holding a [Fact] row',
        ex: L("    var name = \"Ghost\";", '    var example = $"[Fact] public void {name}() {{ }}";'),
      },
      {
        // The interpolation-hole question. `{{` and `}}` are escaped literal
        // braces, not structure. A lens that treats a $"..." as ordinary
        // string text never sees them; a lens that parses holes has to skip
        // them. Either reading gives the same answer here, which is the point
        // of the row: the count and the admission must not move.
        name: 'a $"..." interpolated string with {{ }} escapes and a real hole',
        ex: L("    var name = \"Ghost\";", '    var example = $"{{ {name} }} closes";'),
      },
      {
        name: "a '[' char literal",
        ex: "    var open = '[';",
      },
      {
        name: "a // comment holding a [Fact] row",
        ex: "    // [Fact] public void Ghost() { }",
      },
      {
        name: "a single-line /* */ comment holding a [Fact] row",
        ex: "    /* [Fact] public void Ghost() { } */",
      },
      {
        name: "a MULTI-LINE /* */ comment with [Fact] at column 0",
        ex: L("    /*", "[Fact]", "public void Ghost() { }", "    */"),
      },
    ],
    plainFunction: L(
      "public int ShardOf(string key, int buckets)",
      "{",
      '    var example = @"',
      "[Fact]",
      "public void ShardsAlpha() { }",
      '";',
      "    // [Fact] public void ShardsBeta() { }",
      "    return key.Length % buckets;",
      "}"
    ),
    scanOnlyNeedle: '@"C:\\dir\\"',
    scanOnlyEx: '    var example = @"C:\\dir\\";',
  },
];

// The TypeScript family. One grammar, four registered ids, one fixture set.
const TS_FORMS = [
  {
    name: "a '...' single-quoted string holding it(",
    ex: "  const example = 'it(\"ghost\", () => {});';",
  },
  {
    name: 'a "..." double-quoted string holding it(',
    ex: '  const example = "it(\\"ghost\\", () => {});";',
  },
  {
    name: "a single-line backtick template holding it(",
    ex: "  const example = " + BT + 'it("ghost", () => {});' + BT + ";",
  },
  {
    name: "a MULTI-LINE backtick template holding it(",
    ex: L("  const example = " + BT, 'it("ghost", () => {});', BT + ";"),
  },
  {
    name: "a backtick template with a ${} interpolation holding it(",
    ex: L('  const name = "ghost";', "  const example = " + BT + 'it("${name}", () => {});' + BT + ";"),
  },
  {
    name: "a // line comment holding it(",
    ex: '  // it("ghost", () => {});',
  },
  {
    name: "a single-line /* */ comment holding it(",
    ex: '  /* it("ghost", () => {}); */',
  },
  {
    name: "a MULTI-LINE /* */ comment holding it(",
    ex: L("  /*", '  it("ghost", () => {});', "  */"),
  },
  {
    name: "a '...' string holding test(",
    ex: "  const example = 'test(\"ghost\", () => {});';",
  },
  {
    name: "a '...' string holding describe(",
    ex: "  const example = 'describe(\"ghost\", () => {});';",
  },
];

// RESIDUAL, argued rather than asserted. Amendment 3 already says the bare
// lens is knowingly narrower than the fenced one, so a form the contract does
// not name is a candidate for the same treatment. A JavaScript regex literal
// is not mentioned anywhere in P8, and telling a regex literal from a division
// apart needs the preceding token, which a neutraliser that scans characters
// does not have. The row is here because the SHAPE is real: `/test(\d+)/` is
// an ordinary thing to write and its capture group reads as a call. If the
// phase decides regex literals are out of the lens, this row gets rewritten
// with that argument in scraps.md rather than forced green.
const TS_RESIDUAL_FORMS = [
  {
    name: "RESIDUAL: a /test(\\d+)/ regex literal whose capture group reads as a call",
    ex: "  const re = /test(\\d+)/;",
  },
  {
    name: "RESIDUAL: an /it(ghost)/ regex literal whose capture group reads as a call",
    ex: "  const re = /it(ghost)/;",
  },
];

const TS_IDS = ["typescript", "typescriptreact", "javascript", "javascriptreact"];

for (const id of TS_IDS) {
  LANGS.push({
    id,
    fence: id === "javascript" || id === "javascriptreact" ? "javascript" : "typescript",
    extract: (reply) => extractTestFunctions(reply, id),
    base: TS_BASE,
    plainEx: '  const example = "shard";',
    forms: TS_FORMS,
    residualForms: TS_RESIDUAL_FORMS,
    plainFunction: L(
      "export function shardOf(key, buckets) {",
      "  const example = " + BT + 'it("shards alpha", () => {});' + BT + ";",
      '  // it("shards beta", () => {});',
      "  return key.length % buckets;",
      "}"
    ),
    scanOnlyNeedle: "'it(\"ghost\", () => {});'",
    scanOnlyEx: "  const example = 'it(\"ghost\", () => {});';",
  });
}

// ===========================================================================
// Rule 4, per language, per literal form, FENCED and BARE.
//
// The baseline is captured from the same fixture with the payload replaced by
// ordinary text, never hand-written. An assertion that says "3" would be an
// assertion about the pattern table, and this file does not know the pattern
// table.
// ===========================================================================

const baselineOf = (lang) => {
  const body = lang.base(lang.plainEx);
  const reply = fencedOf(lang.fence, body);
  const res = lang.extract(reply);
  okShape(
    `[P8 §4 lens ${lang.id}] the plain fenced baseline was itself refused, so no count row below can mean anything`,
    reply,
    res
  );
  return res.testCount;
};

for (const lang of LANGS) {
  const allForms = [...lang.forms, ...(lang.residualForms || [])];
  for (const form of allForms) {
    gtest(`[P8 §4 lens ${lang.id}] ${form.name}: the hidden shape is not a test, fenced and bare`, () => {
      const want = baselineOf(lang);
      const body = lang.base(form.ex);

      const fencedReply = fencedOf(lang.fence, body);
      const fencedRes = okShape(
        `[P8 §4 lens ${lang.id}] FENCED: the reply with the payload in ${form.name} was refused outright. The lens lost every real test, which is worse than miscounting one`,
        fencedReply,
        lang.extract(fencedReply)
      );
      assert.strictEqual(
        fencedRes.testCount,
        want,
        show(
          `[P8 §4 lens ${lang.id}] FENCED: test-shaped text inside ${form.name} changed the count. §4 counts on neutralised text, and ${lang.id}'s neutralisation owns this form`,
          fencedReply,
          fencedRes
        )
      );

      const bareRes = okShape(
        `[P8 §4 lens ${lang.id}] BARE: the same reply with no fence was refused`,
        body,
        lang.extract(body)
      );
      assert.strictEqual(
        bareRes.testCount,
        want,
        show(
          `[P8 §4 lens ${lang.id}] BARE: test-shaped text inside ${form.name} changed the count`,
          body,
          bareRes
        )
      );
    });
  }
}

// ===========================================================================
// Rule 5. A bare and a fenced copy of the same tests return the same answer.
// Written as one property over every fixture this file owns, so a lens that
// is fixed on one path and not the other cannot pass.
// ===========================================================================

const everyFixture = () => {
  const out = [];
  for (const lang of LANGS) {
    const bodies = [lang.base(lang.plainEx), lang.plainFunction];
    for (const form of [...lang.forms, ...(lang.residualForms || [])]) {
      bodies.push(lang.base(form.ex));
    }
    for (const body of bodies) out.push({ lang, body });
  }
  return out;
};

for (const lang of LANGS) {
  gtest(`[P8 §5 lens ${lang.id}] every fixture answers the same bare as it does fenced`, () => {
    const rows = everyFixture().filter((r) => r.lang.id === lang.id);
    const disagreed = [];
    for (const { body } of rows) {
      const fencedRes = lang.extract(fencedOf(lang.fence, body));
      const bareRes = lang.extract(body);
      const same =
        (fencedRes === undefined && bareRes === undefined) ||
        (fencedRes !== undefined &&
          bareRes !== undefined &&
          fencedRes.testCount === bareRes.testCount &&
          fencedRes.text.trim() === bareRes.text.trim());
      if (!same) {
        disagreed.push(
          show(
            `fenced said ${fencedRes === undefined ? "undefined" : fencedRes.testCount} and bare said ${bareRes === undefined ? "undefined" : bareRes.testCount}`,
            body,
            bareRes
          )
        );
      }
    }
    assert.strictEqual(
      disagreed.length,
      0,
      `[P8 §5 lens ${lang.id}] ${disagreed.length} of ${rows.length} fixtures answered differently bare than fenced. §5 says a bare and a fenced copy of the same tests return the same count and the same text.\n\n${disagreed.join("\n\n")}`
    );
  });
}

// ===========================================================================
// Rules 6 and 4 together. A plain implementation is not a test module, and it
// stays not a test module when its comment and its string mention the tests it
// has. On BOTH paths.
//
// This is a DELIBERATE move of the fenced baseline where it moves, and the
// goal names the move: "the fenced path moves ONLY where a test shape is
// hiding inside a string or a comment". Every row here is exactly that case,
// so a row that goes from admitted to refused on the fenced path is the fix
// working, not a regression. The rows are tagged so the differential section
// can name them.
// ===========================================================================

for (const lang of LANGS) {
  gtest(`[P8 §6 lens ${lang.id}] a plain implementation whose comment and string mention its tests is refused, fenced and bare`, () => {
    const body = lang.plainFunction;

    const fencedReply = fencedOf(lang.fence, body);
    const fencedRes = lang.extract(fencedReply);
    assert.strictEqual(
      fencedRes,
      undefined,
      show(
        `[P8 §6 lens ${lang.id}] FENCED: the only test-shaped tokens in this implementation are inside a string literal and a comment. §4 counts on neutralised text, so the count is zero and §6 refuses. This is the fenced move goal.md defect 2 authorises`,
        fencedReply,
        fencedRes
      )
    );

    const bareRes = lang.extract(body);
    assert.strictEqual(
      bareRes,
      undefined,
      show(
        `[P8 §6 lens ${lang.id}] BARE: same implementation, no fence, same refusal`,
        body,
        bareRes
      )
    );
  });
}

// ===========================================================================
// Rule 4, the shape of a refusal. A reply whose count falls to zero answers
// undefined. It never answers an object with testCount 0, because the call
// site tests the value, not the count, and a zero-count object splices an
// implementation into a test file.
// ===========================================================================

for (const lang of LANGS) {
  gtest(`[P8 §4 lens ${lang.id}] a count of zero is undefined, not { testCount: 0 }`, () => {
    for (const [what, body] of [
      ["the plain implementation", lang.plainFunction],
      ["an apology", "I am sorry, but I cannot write tests without seeing the module."],
    ]) {
      for (const [path_, reply] of [
        ["FENCED", fencedOf(lang.fence, body)],
        ["BARE", body],
      ]) {
        const res = lang.extract(reply);
        assert.ok(
          res === undefined || (Number.isInteger(res.testCount) && res.testCount >= 1),
          show(
            `[P8 §4 lens ${lang.id}] ${path_}: ${what} answered an object carrying a count of ${res && res.testCount}. A refusal is undefined`,
            reply,
            res
          )
        );
      }
    }
  });
}

// ===========================================================================
// The neutralisation is SCAN-ONLY. It exists to decide a count and a balance.
// The text handed back is the block the model wrote, byte for byte. A lens
// that returns its own neutralised buffer would splice a file full of spaces
// into the human's source.
// ===========================================================================

for (const lang of LANGS) {
  gtest(`[P8 §5 lens ${lang.id}] text is the original block, not the neutralised one`, () => {
    const body = lang.base(lang.scanOnlyEx);

    const fencedReply = fencedOf(lang.fence, body);
    const fencedRes = okShape(
      `[P8 §5 lens ${lang.id}] FENCED: the scan-only fixture was refused`,
      fencedReply,
      lang.extract(fencedReply)
    );
    assert.ok(
      fencedRes.text.includes(lang.scanOnlyNeedle),
      show(
        `[P8 §5 lens ${lang.id}] FENCED: the literal was not returned verbatim. Neutralisation is a scan, and text is the block the model wrote`,
        fencedReply,
        fencedRes
      )
    );
    assert.strictEqual(
      fencedRes.text.trim(),
      body.trim(),
      show(`[P8 §5 lens ${lang.id}] FENCED: text is not the fenced block's own content`, fencedReply, fencedRes)
    );

    const bareRes = okShape(
      `[P8 §5 lens ${lang.id}] BARE: the scan-only fixture was refused`,
      body,
      lang.extract(body)
    );
    assert.strictEqual(
      bareRes.text.trim(),
      body.trim(),
      show(`[P8 §5 lens ${lang.id}] BARE: text for an accepted bare reply is the trimmed reply itself`, body, bareRes)
    );
  });
}

// ===========================================================================
// Rule 1, the DIFFERENTIAL. This is the row that catches an over-wide fix.
//
// The corpus below is realistic test replies in every language, FENCED, with
// NO test shape hiding inside any literal or comment. Rule 1 says a fenced
// reply behaves exactly as it does today, and goal.md defect 2 narrows the
// exception to one case: a test shape hiding inside a string or a comment.
// None of these have one. So the new answer must equal main's answer, text
// and count, for every row.
//
// It is GREEN today because both sides are the same code path on an unchanged
// corpus. Its whole value is after the lens is routed per language: a lens
// that eats a brace, drops a real test, or trims the text differently turns
// this red and names the fixture that moved.
// ===========================================================================

const CLEAN_CORPUS = [];

const clean = (fence, extractId, body) => CLEAN_CORPUS.push({ fence, extractId, body });

// -- Rust ------------------------------------------------------------------
clean("rust", "rust", L(
  "#[cfg(test)]",
  "mod tests {",
  "    use super::*;",
  "",
  "    #[test]",
  "    fn adds_positive() { assert_eq!(add(1, 2), 3); }",
  "",
  "    #[test]",
  "    fn adds_zero() { assert_eq!(add(0, 0), 0); }",
  "",
  "    #[test]",
  "    fn adds_negative() { assert_eq!(add(-1, -1), -2); }",
  "}"
));
clean("rust", "rust", L(
  "#[cfg(test)]",
  "mod tests {",
  "    use super::*;",
  "",
  "    fn fixture() -> Vec<&'static str> {",
  '        vec!["alpha", "beta"]',
  "    }",
  "",
  "    #[test]",
  "    fn shard_of_cases() {",
  "        let cases = [",
  '            ("alpha", 8, 101),',
  '            ("beta", 16, 202),',
  "        ];",
  "        for (key, buckets, want) in cases {",
  "            assert_eq!(shard_of(key, buckets), want);",
  "        }",
  "    }",
  "",
  "    #[test]",
  "    fn uses_the_fixture() {",
  "        assert_eq!(fixture().len(), 2);",
  "    }",
  "}"
));
clean("rust", "rust", L(
  "#[cfg(test)]",
  "mod tests {",
  "    use super::*;",
  "",
  "    // Each case checks one bucket count. The zero case is separate because",
  "    // the function returns early for it.",
  "    #[test]",
  "    fn braces_in_a_string() {",
  '        assert_eq!(render("{ }"), "{ }");',
  '        assert_eq!(render("a \\"quoted\\" b"), "a \\"quoted\\" b");',
  "    }",
  "",
  "    #[test]",
  "    fn zero_buckets() {",
  '        assert_eq!(shard_of("alpha", 0), 0);',
  "    }",
  "}"
));
clean("rust", "rust", L(
  "mod tests {",
  "    use super::*;",
  "",
  "    #[test]",
  "    fn raw_strings_survive() {",
  '        let path = r"C:\\dir\\file";',
  "        assert!(path.contains(\"dir\"));",
  "    }",
  "",
  "    #[test]",
  "    fn char_literals_survive() {",
  "        assert_eq!(split_on('\"').len(), 2);",
  "    }",
  "}"
));
clean("rust", "rust", L(
  "#[cfg(test)]",
  "mod tests {",
  "    use super::*;",
  "    use tokio::test as async_test;",
  "",
  "    #[test]",
  "    fn sync_case() { assert!(ready()); }",
  "",
  "    #[tokio::test]",
  "    async fn async_case() {",
  "        let got = fetch().await;",
  "        assert_eq!(got, 7);",
  "    }",
  "}"
));
clean("rust", "rust", L(
  "#[cfg(test)]",
  "mod tests {",
  "    use super::*;",
  "",
  "    /* A block comment about the module. It mentions brackets like [ and ( ",
  "       and closes them here: ] ). */",
  "    #[test]",
  "    fn one() { assert!(true); }",
  "}"
));
clean("rust", "rust", L(
  "#[cfg(test)]",
  "mod tests {",
  "    use super::*;",
  "",
  "    #[test]",
  "    #[should_panic(expected = \"zero\")]",
  "    fn panics_on_zero() { divide(1, 0); }",
  "",
  "    #[test]",
  "    fn divides() { assert_eq!(divide(6, 3), 2); }",
  "}"
));
clean("rust", "rust", L(
  "#[cfg(test)]",
  "mod tests {",
  "    use super::*;",
  "",
  "    #[test]",
  "    fn nested_generics() {",
  "        let m: HashMap<String, Vec<(usize, usize)>> = HashMap::new();",
  "        assert!(m.is_empty());",
  "    }",
  "}"
));

// -- Go --------------------------------------------------------------------
clean("go", "go", L(
  "func TestAddPositive(t *testing.T) {",
  "\tif got := Add(1, 2); got != 3 {",
  '\t\tt.Errorf("Add(1, 2) = %v, want 3", got)',
  "\t}",
  "}",
  "",
  "func TestAddZero(t *testing.T) {",
  "\tif got := Add(0, 0); got != 0 {",
  '\t\tt.Errorf("Add(0, 0) = %v, want 0", got)',
  "\t}",
  "}"
));
clean("go", "go", L(
  "func TestShardOf(t *testing.T) {",
  "\tcases := []struct {",
  "\t\tname    string",
  "\t\tkey     string",
  "\t\tbuckets int",
  "\t\twant    int",
  "\t}{",
  '\t\t{"alpha", "a", 8, 101},',
  '\t\t{"beta", "b", 16, 202},',
  "\t}",
  "\tfor _, tt := range cases {",
  "\t\tt.Run(tt.name, func(t *testing.T) {",
  "\t\t\tif got := ShardOf(tt.key, tt.buckets); got != tt.want {",
  '\t\t\t\tt.Errorf("ShardOf() = %v, want %v", got, tt.want)',
  "\t\t\t}",
  "\t\t})",
  "\t}",
  "}"
));
clean("go", "go", L(
  "func newFixture(t *testing.T) *Store {",
  "\tt.Helper()",
  "\treturn &Store{}",
  "}",
  "",
  "func TestStoreIsEmpty(t *testing.T) {",
  "\ts := newFixture(t)",
  "\tif s.Len() != 0 {",
  '\t\tt.Fatal("want an empty store")',
  "\t}",
  "}"
));
clean("go", "go", L(
  "func TestRenderBraces(t *testing.T) {",
  '\tif got := Render("{ }"); got != "{ }" {',
  '\t\tt.Errorf("braces in a string are not structure: %q", got)',
  "\t}",
  '\tif got := Render("a \\"quoted\\" b"); got == "" {',
  '\t\tt.Error("want the quoted form back")',
  "\t}",
  "}"
));
clean("go", "go", L(
  "func TestRawPath(t *testing.T) {",
  "\tpath := " + BT + "C:\\dir\\file" + BT,
  '\tif !strings.Contains(path, "dir") {',
  '\t\tt.Errorf("want dir in %q", path)',
  "\t}",
  "}"
));
clean("go", "go", L(
  "// TestFetch drives the real client against the fake server. The comment is",
  "// ordinary English and says nothing a counter should key on.",
  "func TestFetch(t *testing.T) {",
  "\tctx, cancel := context.WithCancel(context.Background())",
  "\tdefer cancel()",
  "\tgot, err := Fetch(ctx)",
  "\tif err != nil {",
  "\t\tt.Fatal(err)",
  "\t}",
  "\tif got != 7 {",
  '\t\tt.Errorf("got %v, want 7", got)',
  "\t}",
  "}"
));
clean("go", "go", L(
  "func TestParallelCases(t *testing.T) {",
  '\tfor _, name := range []string{"alpha", "beta"} {',
  "\t\tname := name",
  "\t\tt.Run(name, func(t *testing.T) {",
  "\t\t\tt.Parallel()",
  "\t\t\tif Parse(name) == nil {",
  '\t\t\t\tt.Errorf("Parse(%q) is nil", name)',
  "\t\t\t}",
  "\t\t})",
  "\t}",
  "}"
));
clean("go", "go", L(
  "func BenchmarkShardOf(b *testing.B) {",
  "\tfor i := 0; i < b.N; i++ {",
  '\t\tShardOf("alpha", 8)',
  "\t}",
  "}",
  "",
  "func TestShardOfZero(t *testing.T) {",
  '\tif got := ShardOf("alpha", 0); got != 0 {',
  '\t\tt.Errorf("want 0, got %v", got)',
  "\t}",
  "}"
));

// -- TypeScript ------------------------------------------------------------
clean("typescript", "typescript", L(
  'it("adds two positives", () => {',
  "  expect(add(1, 2)).toBe(3);",
  "});",
  "",
  'it("adds zero", () => {',
  "  expect(add(0, 0)).toBe(0);",
  "});"
));
clean("typescript", "typescript", L(
  "it.each([",
  '  ["alpha", 8, 101],',
  '  ["beta", 16, 202],',
  '])("shardOf(%s, %i)", (key, buckets, want) => {',
  "  expect(shardOf(key, buckets)).toBe(want);",
  "});",
  "",
  'it("returns 0 when there are no buckets", () => {',
  '  expect(shardOf("alpha", 0)).toBe(0);',
  "});"
));
clean("typescript", "typescript", L(
  "function fixture(): Store {",
  "  return new Store();",
  "}",
  "",
  'describe("Store", () => {',
  '  it("starts empty", () => {',
  "    expect(fixture().size).toBe(0);",
  "  });",
  "",
  '  it("takes one entry", () => {',
  "    const s = fixture();",
  '    s.put("a", 1);',
  "    expect(s.size).toBe(1);",
  "  });",
  "});"
));
clean("typescript", "typescript", L(
  'it("keeps braces inside a string", () => {',
  '  expect(render("{ }")).toBe("{ }");',
  "  expect(render('a \"quoted\" b')).toContain('\"');",
  "});"
));
clean("typescript", "typescript", L(
  'it("awaits the fetch", async () => {',
  "  const got = await fetchOne();",
  "  expect(got).toEqual({ id: 7 });",
  "});",
  "",
  'it("rejects on a bad id", async () => {',
  "  await expect(fetchOne(-1)).rejects.toThrow();",
  "});"
));
clean("typescript", "typescript", L(
  "// The two cases below cover the happy path and the empty input. Ordinary",
  "// English, nothing a counter should key on.",
  'it("splits on a comma", () => {',
  '  expect(split("a,b")).toEqual(["a", "b"]);',
  "});",
  "",
  'it("splits an empty string to an empty list", () => {',
  '  expect(split("")).toEqual([]);',
  "});"
));
clean("typescript", "typescript", L(
  'it("renders a template", () => {',
  "  const name = \"alpha\";",
  "  const line = " + BT + "shard ${name} of 8" + BT + ";",
  '  expect(render(name)).toBe(line);',
  "});"
));
clean("typescript", "typescript", L(
  'it("matches the id pattern", () => {',
  "  const re = /^[a-z]+-\\d+$/;",
  '  expect(re.test("alpha-1")).toBe(true);',
  "});"
));

// -- Python ----------------------------------------------------------------
clean("python", "python", L(
  "def test_adds_positive():",
  "    assert add(1, 2) == 3",
  "",
  "",
  "def test_adds_zero():",
  "    assert add(0, 0) == 0"
));
clean("python", "python", L(
  '@pytest.mark.parametrize("key,buckets,want", [',
  '    ("alpha", 8, 101),',
  '    ("beta", 16, 202),',
  "])",
  "def test_shard_of(key, buckets, want):",
  "    assert shard_of(key, buckets) == want",
  "",
  "",
  "def test_shard_of_zero_buckets():",
  '    assert shard_of("alpha", 0) == 0'
));
clean("python", "python", L(
  "@pytest.fixture",
  "def store():",
  "    return Store()",
  "",
  "",
  "def test_store_starts_empty(store):",
  "    assert len(store) == 0",
  "",
  "",
  "def test_store_takes_one(store):",
  '    store.put("a", 1)',
  "    assert len(store) == 1"
));
clean("python", "python", L(
  "def test_braces_in_a_string():",
  '    assert render("{ }") == "{ }"',
  "    assert render('a \"quoted\" b').count('\"') == 2"
));
clean("python", "python", L(
  "@pytest.mark.asyncio",
  "async def test_fetch_one():",
  "    got = await fetch_one()",
  '    assert got == {"id": 7}'
));
clean("python", "python", L(
  '"""Cases for the shard function.',
  "",
  "The docstring is ordinary English and names no shapes.",
  '"""',
  "",
  "",
  "def test_shard_of_alpha():",
  '    assert shard_of("alpha", 8) == 101'
));
clean("python", "python", L(
  "# The two cases below cover the happy path and the empty input.",
  "def test_splits_on_a_comma():",
  '    assert split("a,b") == ["a", "b"]',
  "",
  "",
  "def test_splits_empty():",
  '    assert split("") == []'
));
clean("python", "python", L(
  "def test_raises_on_zero():",
  "    with pytest.raises(ValueError):",
  "        divide(1, 0)",
  "",
  "",
  "def test_divides():",
  "    assert divide(6, 3) == 2"
));

// -- C# --------------------------------------------------------------------
clean("csharp", "csharp", L(
  "[Fact]",
  "public void AddsPositive()",
  "{",
  "    Assert.Equal(3, Add(1, 2));",
  "}",
  "",
  "[Fact]",
  "public void AddsZero()",
  "{",
  "    Assert.Equal(0, Add(0, 0));",
  "}"
));
clean("csharp", "csharp", L(
  "[Theory]",
  '[InlineData("alpha", 8, 101)]',
  '[InlineData("beta", 16, 202)]',
  "public void ShardOfCases(string key, int buckets, int want)",
  "{",
  "    Assert.Equal(want, ShardOf(key, buckets));",
  "}",
  "",
  "[Fact]",
  "public void ShardOfZeroBuckets()",
  "{",
  '    Assert.Equal(0, ShardOf("alpha", 0));',
  "}"
));
clean("csharp", "csharp", L(
  "private static Store NewStore() => new Store();",
  "",
  "[Fact]",
  "public void StoreStartsEmpty()",
  "{",
  "    Assert.Empty(NewStore());",
  "}",
  "",
  "[Fact]",
  "public void StoreTakesOne()",
  "{",
  "    var s = NewStore();",
  '    s.Put("a", 1);',
  "    Assert.Single(s);",
  "}"
));
clean("csharp", "csharp", L(
  "[Fact]",
  "public void BracesInsideAStringAreNotStructure()",
  "{",
  '    Assert.Equal("{ }", Render("{ }"));',
  '    Assert.Contains("\\"", Render("a \\"quoted\\" b"));',
  "}"
));
clean("csharp", "csharp", L(
  "[Fact]",
  "public async Task FetchesOne()",
  "{",
  "    var got = await FetchOneAsync();",
  "    Assert.Equal(7, got.Id);",
  "}"
));
clean("csharp", "csharp", L(
  "// The two methods below cover the happy path and the empty input. The",
  "// comment is ordinary English.",
  "[Fact]",
  "public void SplitsOnAComma()",
  "{",
  '    Assert.Equal(new[] { "a", "b" }, Split("a,b"));',
  "}",
  "",
  "[Fact]",
  "public void SplitsEmpty()",
  "{",
  '    Assert.Empty(Split(""));',
  "}"
));
clean("csharp", "csharp", L(
  "[Fact]",
  "public void ThrowsOnZero()",
  "{",
  "    Assert.Throws<DivideByZeroException>(() => Divide(1, 0));",
  "}",
  "",
  "[Fact]",
  "public void Divides()",
  "{",
  "    Assert.Equal(2, Divide(6, 3));",
  "}"
));
clean("csharp", "csharp", L(
  "[TestMethod]",
  "public void UsesTheOtherFramework()",
  "{",
  "    Assert.AreEqual(3, Add(1, 2));",
  "}",
  "",
  "[DataTestMethod]",
  '[DataRow("alpha", 8)]',
  "public void RowsToo(string key, int buckets)",
  "{",
  "    Assert.IsTrue(ShardOf(key, buckets) > 0);",
  "}"
));

const callOn = (impl, extractId, reply) =>
  extractId === "rust" ? impl.extractTestModule(reply) : impl.extractTestFunctions(reply, extractId);

test("bundle: main's copy of instructPostprocess builds, so the rule 1 differential can run", () => {
  assert.strictEqual(
    mainError,
    undefined,
    `main's copy could not be extracted or bundled, so the rule 1 differential below is a harness error rather than a finding: ${mainError}`
  );
  assert.strictEqual(typeof mainMod.extractTestModule, "function");
  assert.strictEqual(typeof mainMod.extractTestFunctions, "function");
});

test("[P8 §1 lens differential] a clean FENCED corpus answers exactly what main answers, in every language", (ctx) => {
  if (bundleError || mainError) return ctx.skip("a facade failed to build; see the bundle rows");

  const moved = [];
  for (const { fence, extractId, body } of CLEAN_CORPUS) {
    const reply = fencedOf(fence, body);
    const now = callOn(mod, extractId, reply);
    const before = callOn(mainMod, extractId, reply);

    const same =
      (now === undefined && before === undefined) ||
      (now !== undefined && before !== undefined && now.text === before.text && now.testCount === before.testCount);

    if (!same) {
      moved.push(
        `---- ${extractId} ----\n${reply}\n  main: ${before === undefined ? "undefined" : JSON.stringify(before)}\n  now:  ${now === undefined ? "undefined" : JSON.stringify(now)}`
      );
    }
  }

  assert.strictEqual(
    moved.length,
    0,
    `[P8 §1] ${moved.length} of ${CLEAN_CORPUS.length} clean fenced replies moved. NONE of these hides a test shape in a string or a comment, so goal.md defect 2's licence to move the fenced path does not cover them. Rule 1 says a fenced reply behaves exactly as it does today.\n\n${moved.join("\n\n")}`
  );
});

// The same differential run per language, so a failure names the language
// rather than making the reader diff a wall.
for (const fenceLang of ["rust", "go", "typescript", "python", "csharp"]) {
  test(`[P8 §1 lens differential ${fenceLang}] the clean fenced corpus does not move`, (ctx) => {
    if (bundleError || mainError) return ctx.skip("a facade failed to build; see the bundle rows");
    const rows = CLEAN_CORPUS.filter((r) => r.extractId === fenceLang);
    assert.ok(rows.length >= 8, `the ${fenceLang} corpus has ${rows.length} replies; the contract wants at least 8`);
    for (const { fence, extractId, body } of rows) {
      const reply = fencedOf(fence, body);
      const now = callOn(mod, extractId, reply);
      const before = callOn(mainMod, extractId, reply);
      assert.deepStrictEqual(
        now === undefined ? null : { text: now.text, testCount: now.testCount },
        before === undefined ? null : { text: before.text, testCount: before.testCount },
        `[P8 §1 lens differential ${fenceLang}] this clean fenced reply moved against main, and it hides no test shape in any literal or comment:\n${reply}`
      );
    }
  });
}

// The TypeScript-family ids share one grammar. A lens keyed on the id has to
// give all four the same answer for the same source, or a .tsx file and a .ts
// file with identical tests are counted differently.
gtest("[P8 §1 lens differential typescript] the four TS-family ids agree with each other, fenced and bare", () => {
  const rows = CLEAN_CORPUS.filter((r) => r.extractId === "typescript");
  for (const { body } of rows) {
    const reply = fencedOf("typescript", body);
    const answers = TS_IDS.map((id) => ({ id, fenced: extractTestFunctions(reply, id), bare: extractTestFunctions(body, id) }));
    const first = answers[0];
    for (const a of answers.slice(1)) {
      assert.deepStrictEqual(
        a.fenced === undefined ? null : { text: a.fenced.text, testCount: a.fenced.testCount },
        first.fenced === undefined ? null : { text: first.fenced.text, testCount: first.fenced.testCount },
        `[P8 §1] FENCED: ${a.id} answered differently from ${first.id} for the same source:\n${body}`
      );
      assert.deepStrictEqual(
        a.bare === undefined ? null : { text: a.bare.text, testCount: a.bare.testCount },
        first.bare === undefined ? null : { text: first.bare.text, testCount: first.bare.testCount },
        `[P8 §1] BARE: ${a.id} answered differently from ${first.id} for the same source:\n${body}`
      );
    }
  }
});

// An unregistered id is refused before anything else, lens or no lens. Rule 4
// says so, and a per-language lens is exactly the kind of change that grows an
// accidental default branch.
gtest("[P8 §4 lens] an unregistered languageId is still undefined, fenced and bare", () => {
  const body = TS_BASE('  const example = "shard";');
  for (const id of ["ruby", "java", "plaintext", "", "rust"]) {
    for (const [path_, reply] of [["FENCED", fencedOf("typescript", body)], ["BARE", body]]) {
      const res = extractTestFunctions(reply, id);
      assert.strictEqual(
        res,
        undefined,
        show(
          `[P8 §4] ${path_}: extractTestFunctions answered for languageId ${JSON.stringify(id)}. An unregistered id is undefined before anything else, and "rust" is unregistered HERE because Rust goes through extractTestModule`,
          reply,
          res
        )
      );
    }
  }
});
