// White-box rows for session-v70 phase 3: the COUNTING lens, per language
// [session-v70/goal.md defect 2, session-v68/contracts/P8-bare-reply.md rules
// 1, 4, 5, 6].
//
// `extractTestFunctions` counted every language's test shapes on
// `neutralizeCommentsAndStrings`, which lexes Rust. Phase 3 routes the count,
// and the bare admission gate beside it, through the lens that belongs to the
// reply's languageId. These rows sit underneath the blind oracle and pin each
// lens rule one at a time, because a lens written to satisfy a handful of
// fixtures is a lens with a handful of correct cases in it.
//
// What each section owns:
//   - the C# lens, which is NEW: every literal and comment form it models,
//     including the three forms whose C-escape reading under-counts today
//   - the routing itself: the form each of the other four languages owns and
//     Rust's lens does not know
//   - Rust, which must not move: it is the language the old lens was written
//     for and every Rust answer stays where it is
//   - the measured differential against `git archive main src`, two corpora:
//     one with no test shape in any literal or comment, which must not move at
//     all, and one where every reply hides a shape, where every move must run
//     in the direction the goal authorises
//
// Counts are compared against a BASELINE fixture rather than written down: the
// same body with the payload replaced by ordinary text. A hard-coded "2" would
// be an assertion about the shape table, which this file does not own.
//
// Run: SKIP_LIVE=1 node --test test/impl-v70-p3-counting-lens.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { bundleCore } = require("./.blind-util.cjs");

let mod = {};
let cleanup = () => {};
let bundleError;
try {
  ({ mod, cleanup } = bundleCore(
    "impl-v70-p3-counting-lens",
    `export { extractTestModule, extractTestFunctions } from "../src/core/instructPostprocess";\n`
  ));
} catch (e) {
  bundleError = e;
}

// main's copy of the same module, read-only via `git archive`. Nothing here
// touches the index or the working tree.
const REPO = path.join(__dirname, "..");
let mainMod = {};
let mainCleanup = () => {};
let mainError;
let mainDir;
try {
  mainDir = fs.mkdtempSync(path.join(os.tmpdir(), "c80-v70p3-impl-main-"));
  const tar = execFileSync("git", ["-C", REPO, "archive", "main", "src"], {
    maxBuffer: 256 * 1024 * 1024,
  });
  execFileSync("tar", ["-x", "-C", mainDir], { input: tar });
  const entry = path.join(mainDir, "src", "core", "instructPostprocess");
  ({ mod: mainMod, cleanup: mainCleanup } = bundleCore(
    "impl-v70-p3-counting-lens-main",
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

const itest = (name, fn) =>
  test(name, (ctx) => {
    if (bundleError) return ctx.skip(`bundle failed to build: ${bundleError}`);
    return fn(ctx);
  });

itest("[v70 P3] the bundle builds and both extractors are exported", () => {
  assert.strictEqual(bundleError, undefined, `bundle failed: ${bundleError}`);
  assert.strictEqual(typeof extractTestModule, "function");
  assert.strictEqual(typeof extractTestFunctions, "function");
});

const L = (...lines) => lines.join("\n");
const FENCE = "```";
const BT = "`";
const fenced = (tag, body) => `${FENCE}${tag}\n${body}\n${FENCE}\n`;

// ===========================================================================
// Fixture bases. Two real tests, plus one PAYLOAD statement that carries the
// form under test. The baseline is the same body with an ordinary payload, so
// no expected number below is hand-computed.
// ===========================================================================

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

const LANG = {
  csharp: { base: CS_BASE, fence: "csharp", plain: '    var example = "shard";', run: (r) => extractTestFunctions(r, "csharp") },
  go: { base: GO_BASE, fence: "go", plain: '\texample := "shard"', run: (r) => extractTestFunctions(r, "go") },
  python: { base: PY_BASE, fence: "python", plain: 'EXAMPLE = "shard"', run: (r) => extractTestFunctions(r, "python") },
  typescript: { base: TS_BASE, fence: "typescript", plain: '  const example = "shard";', run: (r) => extractTestFunctions(r, "typescript") },
  rust: { base: RS_BASE, fence: "rust", plain: '        let example = "shard";', run: (r) => extractTestModule(r) },
};

const baselineOf = (id) => {
  const lang = LANG[id];
  const res = lang.run(fenced(lang.fence, lang.base(lang.plain)));
  assert.ok(res, `${id}: the plain baseline fixture was refused, so no row below means anything`);
  return res.testCount;
};

// Both paths, one call. Rule 5 says a bare and a fenced copy of the same tests
// answer the same, so every row below is stated once and checked twice.
const counts = (id, ex) => {
  const lang = LANG[id];
  const body = lang.base(ex);
  const f = lang.run(fenced(lang.fence, body));
  const b = lang.run(body);
  return { fencedRes: f, bareRes: b, body };
};

const pinsCount = (id, ex, want, why) => {
  const { fencedRes, bareRes, body } = counts(id, ex);
  assert.ok(fencedRes, `${id} FENCED refused outright.\n${why}\n--- body ---\n${body}`);
  assert.strictEqual(fencedRes.testCount, want, `${id} FENCED count.\n${why}\n--- body ---\n${body}`);
  assert.ok(bareRes, `${id} BARE refused outright.\n${why}\n--- body ---\n${body}`);
  assert.strictEqual(bareRes.testCount, want, `${id} BARE count.\n${why}\n--- body ---\n${body}`);
};

// ===========================================================================
// The C# lens. NEW in this phase: main has no C# lens at all, so every C#
// reply was lexed by Rust's rules. Rust and C# agree on `//`, on a plain
// `"..."` and on a `'c'` char literal, and disagree on everything below.
// ===========================================================================

itest("[v70 P3 C# 1] a verbatim @\"...\" string takes no backslash escape, so a trailing backslash does not eat the closing quote", () => {
  // The UNDER-count direction, and the one that loses a real test. Under the C
  // escape rule the `\"` at the end is an escape, the string runs to the next
  // quote several lines down, and the [Fact] on ShardsBeta is inside it.
  pinsCount(
    "csharp",
    '    var example = @"C:\\dir\\";',
    baselineOf("csharp"),
    "a verbatim string's only escape is the doubled quote; a backslash is a byte"
  );
});

itest("[v70 P3 C# 2] a verbatim @\"...\" string closes on a single quote and \"\" is its escape pair", () => {
  pinsCount(
    "csharp",
    '    var example = @"the ""[Fact]"" attribute";',
    baselineOf("csharp"),
    "the doubled quote is one literal quote inside the string, not a close followed by an open"
  );
});

itest("[v70 P3 C# 3] a verbatim string spans lines, so a [Fact] at column 0 inside it is not a test", () => {
  pinsCount(
    "csharp",
    L('    var example = @"', "[Fact]", "public void Ghost() { }", '";'),
    baselineOf("csharp"),
    "@\"...\" runs across newlines; a regular \"...\" does not"
  );
});

itest("[v70 P3 C# 4] $@\"...\" and @$\"...\" are both verbatim, in either prefix order", () => {
  for (const prefix of ["$@", "@$"]) {
    pinsCount(
      "csharp",
      L(`    var example = ${prefix}"`, "[Fact]", "public void Ghost() { }", '";'),
      baselineOf("csharp"),
      `${prefix}"..." is an interpolated VERBATIM string and spans lines`
    );
  }
});

itest("[v70 P3 C# 5] an interpolated $\"...\" is read as a plain string: its holes and its {{ }} escapes change no count", () => {
  pinsCount(
    "csharp",
    L('    var name = "Ghost";', '    var example = $"[Fact] public void {name}() {{ }}";'),
    baselineOf("csharp"),
    "the lens does not parse interpolation holes, and does not need to: the whole literal blanks"
  );
  pinsCount(
    "csharp",
    L('    var name = "Ghost";', '    var example = $"{{ {name} }} closes";'),
    baselineOf("csharp"),
    "a {{ }} escape pair and a real hole both leave the count alone"
  );
});

itest("[v70 P3 C# 6] a '\"' char literal does not open a string", () => {
  // Red against a lens with no char rule: the quote inside the char literal
  // opens a region that swallows the second [Fact].
  pinsCount(
    "csharp",
    L("    var quote = '\"';", '    var example = "[Fact] public void Ghost() { }";'),
    baselineOf("csharp"),
    "a char literal is consumed whole, so the quote it holds never flips string parity"
  );
});

itest("[v70 P3 C# 7] a '\\\\' char literal holding a backslash does not escape its own closing quote", () => {
  pinsCount(
    "csharp",
    L("    var sep = '\\\\';", '    var example = "[Fact] public void Ghost() { }";'),
    baselineOf("csharp"),
    "the escape inside a char literal is consumed with it"
  );
});

itest("[v70 P3 C# 8] a regular \"...\" string DOES take backslash escapes, so \\\" stays inside it", () => {
  pinsCount(
    "csharp",
    '    var example = "a \\"[Fact]\\" mention";',
    baselineOf("csharp"),
    "the non-verbatim form keeps the C escape rule; only @\"...\" drops it"
  );
});

itest("[v70 P3 C# 9] a // or /* */ comment holding a [Fact] row is not a test", () => {
  pinsCount("csharp", "    // [Fact] public void Ghost() { }", baselineOf("csharp"), "line comment");
  pinsCount("csharp", "    /* [Fact] public void Ghost() { } */", baselineOf("csharp"), "block comment");
  pinsCount(
    "csharp",
    L("    /*", "[Fact]", "public void Ghost() { }", "    */"),
    baselineOf("csharp"),
    "a multi-line block comment"
  );
});

itest("[v70 P3 C# 10] a C# block comment does NOT nest: the first */ ends it and what follows is live code", () => {
  // The discriminating row against reusing Rust's lens, which nests. Under
  // C#'s real grammar the `[Fact]` after the inner `*/` is code and counts.
  const want = baselineOf("csharp") + 1;
  pinsCount(
    "csharp",
    "    /* outer /* inner */ [Fact] public void Ghost() { }",
    want,
    "C# has no nested block comments; Rust does, and the Rust lens hides this attribute"
  );
});

itest("[v70 P3 C# 11] a // inside a verbatim string does not start a comment", () => {
  pinsCount(
    "csharp",
    '    var url = @"https://example.test/a";',
    baselineOf("csharp"),
    "the comment rule must run after the string rule has taken the literal"
  );
});

itest("[v70 P3 C# 12] an unterminated regular string ends at the line, so the COUNT does not swallow the file", () => {
  // A reply cut mid-literal must not silently blank every test after it. Stated
  // on the fenced path only, deliberately: the BARE path refuses this reply
  // outright under P8 rule 3, because an unclosed literal is how truncation
  // looks, and that refusal is the behaviour the bare gate is there for. The
  // count and the completeness scan answer different questions here.
  const ex = L('    var broken = "open and never closed', '    var example = "shard";');
  const body = CS_BASE(ex);
  const res = extractTestFunctions(fenced("csharp", body), "csharp");
  assert.ok(res, "FENCED: the cut literal lost every test");
  assert.strictEqual(
    res.testCount,
    baselineOf("csharp"),
    `a regular C# string cannot span a newline; stopping at the line keeps the rest of the reply countable\n${body}`
  );
  assert.strictEqual(
    extractTestFunctions(body, "csharp"),
    undefined,
    "BARE: P8 rule 3 refuses a reply that leaves a literal open, and this phase does not widen that"
  );
});

// ===========================================================================
// The routing. One form per language that the Rust lens does not know, so a
// green row here is the lens actually being selected by languageId.
// ===========================================================================

itest("[v70 P3 route go] a raw backtick string holds no test, on one line or many", () => {
  pinsCount(
    "go",
    "\texample := " + BT + "func TestGhost(t *testing.T) {}" + BT,
    baselineOf("go"),
    "Go's raw string is a backtick pair; the Rust lens has no backtick rule at all"
  );
  pinsCount(
    "go",
    L("\texample := " + BT, "func TestGhost(t *testing.T) {", "}", BT),
    baselineOf("go"),
    "and it spans lines"
  );
});

itest("[v70 P3 route go] a raw backtick string ending in a backslash still closes on its backtick", () => {
  pinsCount(
    "go",
    L("\tpath := " + BT + "C:\\dir\\" + BT, '\texample := "func TestGhost(t *testing.T) {}"'),
    baselineOf("go"),
    "a Go raw string takes no escapes, so the trailing backslash is a byte and the backtick closes"
  );
});

itest("[v70 P3 route python] a multi-line ''' string holds no test, raw and f-prefixed too", () => {
  for (const [what, open, close] of [
    ["'''", "'''", "'''"],
    ["r'''", "r'''", "'''"],
    ["f'''", "f'''", "'''"],
  ]) {
    pinsCount(
      "python",
      L(`EXAMPLE = ${open}`, "def test_ghost(x):", "    pass", close),
      baselineOf("python"),
      `${what}: Python's triple-single-quote block is not a literal to the Rust lens, which knows only "`
    );
  }
});

itest("[v70 P3 route typescript] a single-quoted string and a backtick template hold no test", () => {
  pinsCount(
    "typescript",
    "  const example = 'it(\"ghost\", () => {});';",
    baselineOf("typescript"),
    "a single-quoted TS string; the Rust lens reads `'` as a lifetime"
  );
  pinsCount(
    "typescript",
    "  const example = " + BT + 'it("ghost", () => {});' + BT + ";",
    baselineOf("typescript"),
    "a one-line template"
  );
  pinsCount(
    "typescript",
    L("  const example = " + BT, 'it("ghost", () => {});', BT + ";"),
    baselineOf("typescript"),
    "a template that spans lines"
  );
  pinsCount(
    "typescript",
    L('  const name = "ghost";', "  const example = " + BT + 'it("${name}", () => {});' + BT + ";"),
    baselineOf("typescript"),
    "a template carrying an interpolation hole; the lens blanks the whole literal and never parses the hole"
  );
});

itest("[v70 P3 route typescript] the four TS-family ids answer identically", () => {
  const body = TS_BASE("  const example = 'it(\"ghost\", () => {});';");
  const ids = ["typescript", "typescriptreact", "javascript", "javascriptreact"];
  const answers = ids.map((id) => ({
    id,
    f: extractTestFunctions(fenced("typescript", body), id),
    b: extractTestFunctions(body, id),
  }));
  for (const a of answers.slice(1)) {
    assert.deepStrictEqual(
      [a.f && a.f.testCount, a.b && a.b.testCount],
      [answers[0].f && answers[0].f.testCount, answers[0].b && answers[0].b.testCount],
      `${a.id} answered differently from ${answers[0].id}; the alias ids must share one lens`
    );
  }
});

itest("[v70 P3 route] an unregistered languageId is undefined before any lens is chosen", () => {
  const body = TS_BASE('  const example = "shard";');
  for (const id of ["ruby", "java", "plaintext", "", "rust", "csharpx"]) {
    assert.strictEqual(
      extractTestFunctions(fenced("typescript", body), id),
      undefined,
      `extractTestFunctions answered for languageId ${JSON.stringify(id)}`
    );
    assert.strictEqual(extractTestFunctions(body, id), undefined, `bare path, languageId ${JSON.stringify(id)}`);
  }
});

// ===========================================================================
// Rust does not move. It is the language the old lens was written for, and
// routing must leave it where it is: nesting block comments, raw strings,
// char literals and all.
// ===========================================================================

itest("[v70 P3 rust] every Rust form the old lens knew still answers the same", () => {
  const want = baselineOf("rust");
  for (const [what, ex] of [
    ['a "..." string', '        let example = "#[test] fn ghost() {}";'],
    ['an r"..." raw string', '        let example = r"#[test] fn ghost() {}";'],
    ['an r#"..."# raw string', '        let example = r#"#[test] fn ghost() {}"#;'],
    ["a multi-line raw string", L('        let example = r#"', "#[test]", "fn ghost() {}", '"#;')],
    ["a '\"' char literal", L("        let quote = '\"';", '        let example = "#[test] fn ghost() {}";')],
    ["a // comment", "        // #[test] fn ghost() {}"],
    ["a NESTED /* /* */ */ comment", "        /* outer /* inner */ #[test] fn ghost() {} */"],
  ]) {
    pinsCount("rust", ex, want, `rust: ${what}`);
  }
});

// ===========================================================================
// The bare ADMISSION gate reads the same lens as the count. Before this
// phase the gate ran on Rust-neutralised text, so a TypeScript implementation
// whose string or template holds `it(` satisfied the very gate that exists to
// refuse it. [review-v70-p2 rows 3 and 4 are the acceptance for this.]
// ===========================================================================

itest("[v70 P3 gate] an implementation whose only `it(` is inside a string or a template is refused on the bare path", () => {
  for (const [what, body] of [
    [
      "single-quoted string",
      L("export function scaffold(name) {", "  const body = 'it(' + name + ', () => {});';", "  return body;", "}"),
    ],
    [
      "template literal",
      L("export function scaffold(name) {", "  return " + BT + 'it("${name}", () => {});' + BT + ";", "}"),
    ],
    [
      "line comment",
      L("export function shardOf(key, buckets) {", '  // it("shards beta", () => {});', "  return key.length % buckets;", "}"),
    ],
  ]) {
    assert.strictEqual(
      extractTestFunctions(body, "typescript"),
      undefined,
      `${what}: an implementation was admitted as a test file. The gate and the count must read the SAME per-language lens`
    );
  }
});

itest("[v70 P3 gate] a real test whose body also mentions `it(` inside a string is still admitted", () => {
  // The gate is narrowing, and a narrowing that refuses real tests is worse
  // than the hole it closes. This is the row that says the gate still opens.
  const body = TS_BASE("  const example = 'it(\"ghost\", () => {});';");
  const res = extractTestFunctions(body, "typescript");
  assert.ok(res, "a reply with two real `it(` tests was refused on the bare path");
  assert.strictEqual(res.testCount, baselineOf("typescript"), "and it counts the two real tests, not the one in the string");
});

// ===========================================================================
// THE MEASURED DIFFERENTIAL, against `git archive main src`.
//
// Corpus B: generated fenced replies, >= 200 per language, with NO test shape
// inside any literal or comment. Rule 1 says these answer exactly what main
// answers. Expected moves: 0.
//
// Corpus C: the same generator with a test shape planted in a literal or a
// comment. Every move must be a count DECREASE (the shape stopped being
// counted) or, for C# verbatim, an INCREASE (a real test stopped being eaten
// by a mis-lexed string).
// ===========================================================================

test("[v70 P3 differential] main's copy of instructPostprocess builds", () => {
  assert.strictEqual(mainError, undefined, `main's copy could not be extracted or bundled: ${mainError}`);
  assert.strictEqual(typeof mainMod.extractTestFunctions, "function");
});

const callOn = (impl, id, reply) =>
  id === "rust" ? impl.extractTestModule(reply) : impl.extractTestFunctions(reply, id);

// Ordinary, literal-free and comment-free filler, varied so the corpus is not
// one body repeated. None of it carries a test shape.
const FILLER = {
  csharp: (i) => [`    var n${i} = ${i};`, `    Assert.True(n${i} >= 0);`],
  go: (i) => [`\tn${i} := ${i}`, `\tif n${i} < 0 {`, "\t\tt.Fatal(n" + i + ")", "\t}"],
  python: (i) => [`    n${i} = ${i}`, `    assert n${i} >= 0`],
  typescript: (i) => [`  const n${i} = ${i};`, `  expect(n${i}).toBeGreaterThanOrEqual(0);`],
  rust: (i) => [`        let n${i} = ${i};`, `        assert!(n${i} >= 0);`],
};

// A test case of index i, with `extra` lines dropped into the first body.
const cleanBody = (id, i) => {
  const f = FILLER[id](i);
  if (id === "csharp") {
    return L(
      "[Fact]",
      `public void Case${i}A()`,
      "{",
      ...f,
      `    Assert.Equal(${i}, ShardOf(${i}));`,
      "}",
      "",
      i % 3 === 0 ? "[Theory]" : "[Fact]",
      ...(i % 3 === 0 ? [`[InlineData(${i})]`] : []),
      `public void Case${i}B(${i % 3 === 0 ? "int n" : ""})`,
      "{",
      `    Assert.NotNull(ShardOf(${i}));`,
      "}"
    );
  }
  if (id === "go") {
    return L(
      `func TestCase${i}A(t *testing.T) {`,
      ...f,
      `\tif got := ShardOf(${i}); got != ${i} {`,
      "\t\tt.Errorf(" + JSON.stringify(`case ${i}: got %v`) + ", got)",
      "\t}",
      "}",
      "",
      `func TestCase${i}B(t *testing.T) {`,
      `\tif ShardOf(${i}) < 0 {`,
      "\t\tt.Fatal(" + JSON.stringify(`case ${i}`) + ")",
      "\t}",
      "}"
    );
  }
  if (id === "python") {
    return L(
      `def test_case_${i}_a():`,
      ...f,
      `    assert shard_of(${i}) == ${i}`,
      "",
      "",
      `def test_case_${i}_b():`,
      `    assert shard_of(${i}) >= 0`
    );
  }
  if (id === "rust") {
    return L(
      "#[cfg(test)]",
      "mod tests {",
      "    use super::*;",
      "",
      "    #[test]",
      `    fn case_${i}_a() {`,
      ...f,
      `        assert_eq!(shard_of(${i}), ${i});`,
      "    }",
      "",
      "    #[test]",
      `    fn case_${i}_b() {`,
      `        assert!(shard_of(${i}) >= 0);`,
      "    }",
      "}"
    );
  }
  return L(
    `it(${JSON.stringify(`case ${i} a`)}, () => {`,
    ...f,
    `  expect(shardOf(${i})).toBe(${i});`,
    "});",
    "",
    `it(${JSON.stringify(`case ${i} b`)}, () => {`,
    `  expect(shardOf(${i})).toBeGreaterThanOrEqual(0);`,
    "});"
  );
};

// The hiding places, one per index so the corpus covers every form. Each entry
// is [name, lines] and every one puts the language's own test shape inside a
// literal or a comment.
const HIDERS = {
  csharp: [
    ["regular string", (i) => [`    var e${i} = "[Fact] public void Ghost${i}() { }";`]],
    ["verbatim multi-line", (i) => [`    var e${i} = @"`, "[Fact]", `public void Ghost${i}() { }`, '";']],
    ["verbatim trailing backslash", (i) => [`    var e${i} = @"C:\\dir${i}\\";`]],
    ["verbatim doubled quote", (i) => [`    var e${i} = @"the ""[Fact]"" attribute";`]],
    ["interpolated", (i) => [`    var e${i} = $"[Fact] public void Ghost{${i}}() {{ }}";`]],
    ["line comment", (i) => [`    // [Fact] public void Ghost${i}() { }`]],
    ["block comment", (i) => [`    /* [Fact] public void Ghost${i}() { } */`]],
  ],
  go: [
    ["string", (i) => [`\te${i} := "func TestGhost${i}(t *testing.T) {}"`]],
    ["raw backtick", (i) => ["\te" + i + " := " + BT + `func TestGhost${i}(t *testing.T) {}` + BT]],
    ["raw backtick multi-line", (i) => ["\te" + i + " := " + BT, `func TestGhost${i}(t *testing.T) {`, "}", BT]],
    ["line comment", (i) => [`\t// func TestGhost${i}(t *testing.T) {}`]],
    ["block comment", (i) => ["\t/*", `func TestGhost${i}(t *testing.T) {`, "}", "\t*/"]],
  ],
  python: [
    ["triple single", (i) => ["EXAMPLE = '''", `def test_ghost_${i}(x):`, "    pass", "'''"]],
    ["triple double", (i) => ['EXAMPLE = """', `def test_ghost_${i}(x):`, "    pass", '"""']],
    ["raw triple single", (i) => ["EXAMPLE = r'''", `def test_ghost_${i}(x):`, "    pass", "'''"]],
    ["f triple single", (i) => ["EXAMPLE = f'''", `def test_ghost_${i}(x):`, "    pass", "'''"]],
    ["comment", (i) => [`# def test_ghost_${i}(x):`]],
  ],
  typescript: [
    ["single-quoted", (i) => [`  const e${i} = 'it("ghost${i}", () => {});';`]],
    ["double-quoted", (i) => [`  const e${i} = "it(\\"ghost${i}\\", () => {});";`]],
    ["template", (i) => ["  const e" + i + " = " + BT + `it("ghost${i}", () => {});` + BT + ";"]],
    ["template multi-line", (i) => ["  const e" + i + " = " + BT, `it("ghost${i}", () => {});`, BT + ";"]],
    ["line comment", (i) => [`  // it("ghost${i}", () => {});`]],
    ["block comment", (i) => ["  /*", `  it("ghost${i}", () => {});`, "  */"]],
  ],
  rust: [
    ["string", (i) => [`        let e${i} = "#[test] fn ghost${i}() {}";`]],
    ["raw string", (i) => [`        let e${i} = r#"#[test] fn ghost${i}() {}"#;`]],
    ["line comment", (i) => [`        // #[test] fn ghost${i}() {}`]],
    ["nested block comment", (i) => [`        /* outer /* in */ #[test] fn ghost${i}() {} */`]],
  ],
};

// Plant the hider's lines into the body, just after the first opening line of
// the first test (or at module level for Python, whose shape is line-anchored).
const plant = (id, i, lines) => {
  const body = cleanBody(id, i).split("\n");
  if (id === "python") {
    return L(...lines, "", "", ...body);
  }
  const at = body.findIndex((l) => l.includes("{")) + 1;
  return L(...body.slice(0, at), ...lines, ...body.slice(at));
};

const FENCE_TAG = { csharp: "csharp", go: "go", python: "python", typescript: "typescript", rust: "rust" };
const CORPUS_IDS = ["csharp", "go", "python", "typescript", "rust"];
const PER_LANG = 210;

const differential = (bodiesFor) => {
  const rows = [];
  for (const id of CORPUS_IDS) {
    for (let i = 0; i < PER_LANG; i++) {
      const body = bodiesFor(id, i);
      const reply = fenced(FENCE_TAG[id], body);
      const now = callOn(mod, id, reply);
      const before = callOn(mainMod, id, reply);
      rows.push({ id, i, body, reply, now, before });
    }
  }
  return rows;
};

const same = (a, b) =>
  (a === undefined && b === undefined) ||
  (a !== undefined && b !== undefined && a.text === b.text && a.testCount === b.testCount);

const describe1 = (r) =>
  `---- ${r.id} #${r.i} ----\n${r.body}\n  main: ${r.before === undefined ? "undefined" : JSON.stringify(r.before)}` +
  `\n  now:  ${r.now === undefined ? "undefined" : JSON.stringify(r.now)}`;

test(`[v70 P3 differential B] ${PER_LANG} clean fenced replies per language do not move against main`, (ctx) => {
  if (bundleError || mainError) return ctx.skip("a facade failed to build");
  const rows = differential((id, i) => cleanBody(id, i));
  const moved = rows.filter((r) => !same(r.now, r.before));
  assert.strictEqual(
    moved.length,
    0,
    `[rule 1] ${moved.length} of ${rows.length} clean fenced replies moved. None of these hides a test shape in a literal or a comment, so the goal's licence to move the fenced path does not cover them.\n\n${moved.slice(0, 5).map(describe1).join("\n\n")}`
  );
  // A differential that proves nothing is worse than one that fails: the
  // corpus has to be answerable in the first place.
  assert.strictEqual(
    rows.filter((r) => r.now === undefined).length,
    0,
    "some clean replies were refused by BOTH sides, so the corpus is not exercising the counter"
  );
});

test("[v70 P3 differential C] every move on a hiding corpus runs in the direction the goal authorises", (ctx) => {
  if (bundleError || mainError) return ctx.skip("a facade failed to build");
  const rows = [];
  for (const id of CORPUS_IDS) {
    const hiders = HIDERS[id];
    for (let i = 0; i < PER_LANG; i++) {
      const [name, make] = hiders[i % hiders.length];
      const body = plant(id, i, make(i));
      const reply = fenced(FENCE_TAG[id], body);
      rows.push({ id, i, name, body, reply, now: callOn(mod, id, reply), before: callOn(mainMod, id, reply) });
    }
  }

  const wrongWay = [];
  let moves = 0;
  for (const r of rows) {
    if (same(r.now, r.before)) continue;
    moves++;
    const beforeN = r.before === undefined ? 0 : r.before.testCount;
    const nowN = r.now === undefined ? 0 : r.now.testCount;
    // A decrease is the shape inside the literal or comment ceasing to count.
    // An increase is only legitimate where main's C escape rule ate a verbatim
    // string's closing quote and swallowed a real test with it.
    const legitimateIncrease = r.id === "csharp" && r.name.startsWith("verbatim");
    if (nowN > beforeN && !legitimateIncrease) wrongWay.push(describe1(r));
    if (nowN < beforeN && r.now !== undefined && r.now.text !== r.before.text) wrongWay.push(describe1(r));
  }

  assert.strictEqual(
    wrongWay.length,
    0,
    `${wrongWay.length} of ${moves} moves ran the wrong way.\n\n${wrongWay.slice(0, 5).join("\n\n")}`
  );
  assert.ok(moves > 0, "the hiding corpus produced no moves at all, so it is not exercising the fix");
});
