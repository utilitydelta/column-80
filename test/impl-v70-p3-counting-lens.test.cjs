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
//   - the C# 11 raw string and the TypeScript regex literal, both added in
//     phase 3 LOOP 2 off the adversarial review's two HIGH findings
//   - Rust, which must not move: it is the language the old lens was written
//     for and every Rust answer stays where it is
//   - the measured differential against a facade of the pre-v70 commit below,
//     two corpora: one with no test shape in any literal or comment, which must
//     not move at all, and one where every reply hides a shape, where every
//     move must run in the direction the goal authorises
//
// A row whose comment says NON-MOVE GUARD was green before the change it sits
// under and is green after. It is written down because the new branch is what
// could break it, and a guard that was never red is worth having only when it
// says so.
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
    `export { extractTestModule, extractTestFunctions, tsFileLocalDefinitions } from "../src/core/instructPostprocess";\n`
  ));
} catch (e) {
  bundleError = e;
}

// main's copy of the same module, read-only via `git archive`. Nothing here
// touches the index or the working tree.
const REPO = path.join(__dirname, "..");
// The pre-phase-3 baseline is a COMMIT, not the `main` ref: 1fb757f is main at the 3.5.0 release,
// the last commit before session-v70. A pull-request checkout on the CI runner has `origin/main`
// but no local `main`, so `git archive main` died there with "not a valid object name" while it
// passed on every dev box (run 34670454201). And once this branch merges, `main` IS this code, so a
// differential against the ref would compare the new lens with itself and prove nothing. The hash
// stays meaningful forever; ci.yml fetches full history so it is always present.
const PRE_V70_BASELINE = "1fb757f415b7dd1f9f956d0b761dfbcd78750ebb";
let mainMod = {};
let mainCleanup = () => {};
let mainError;
let mainDir;
try {
  mainDir = fs.mkdtempSync(path.join(os.tmpdir(), "c80-v70p3-impl-main-"));
  const tar = execFileSync("git", ["-C", REPO, "archive", PRE_V70_BASELINE, "src"], {
    maxBuffer: 256 * 1024 * 1024,
  });
  execFileSync("tar", ["-x", "-C", mainDir], { input: tar });
  const entry = path.join(mainDir, "src", "core", "instructPostprocess");
  ({ mod: mainMod, cleanup: mainCleanup } = bundleCore(
    "impl-v70-p3-counting-lens-main",
    `export { extractTestModule, extractTestFunctions, tsFileLocalDefinitions } from ${JSON.stringify(entry)};\n`
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

// ---------------------------------------------------------------------------
// The C# 11 raw string (`"""`), added in phase 3 loop 2. Lexed as `""` plus a
// one-line string, every line of the body reads as CODE: a scaffold helper
// whose raw string quoted a `[Fact]` was admitted as a test file, and a real
// test file's count rose by whatever its raw strings quoted.
// ---------------------------------------------------------------------------

itest('[v70 P3 C# 13] a """ raw string spans lines and its body is not code', () => {
  pinsCount(
    "csharp",
    L('    var example = """', "[Fact]", "public void Ghost() { }", '    """;'),
    baselineOf("csharp"),
    'a raw string is one literal; read as `""` plus a one-line string its body is lexed as code'
  );
});

itest('[v70 P3 C# 14] the $ prefixes are raw too: $""" and $$"""', () => {
  for (const prefix of ["$", "$$", "$$$"]) {
    pinsCount(
      "csharp",
      L(`    var example = ${prefix}"""`, "[Fact]", "public void Ghost() { }", '    """;'),
      baselineOf("csharp"),
      `${prefix}""" is an interpolated raw string; the hole count changes nothing here`
    );
  }
});

// A run of four or more quotes is where the counting lens and the bare
// completeness scanner part company. `BARE_LANG_RULES.csharp` has a raw entry
// for the VERBATIM form only, so a four-quote run reads to it as two empty
// strings, the scan ends inside a literal and the reply is refused. That
// refusal costs a re-run, which is the direction P8 amendment 3 already
// licenses the bare path to be wrong in, and the bare scanner is phase 2's
// rather than this lens's. The two rows below therefore state the fenced count
// and PIN the bare refusal, so the day the bare rules learn the form the row
// fails and gets rewritten rather than quietly widening.
const pinsFencedCountBareRefused = (id, ex, want, why) => {
  const lang = LANG[id];
  const body = lang.base(ex);
  const f = lang.run(fenced(lang.fence, body));
  assert.ok(f, `${id} FENCED refused outright.\n${why}\n--- body ---\n${body}`);
  assert.strictEqual(f.testCount, want, `${id} FENCED count.\n${why}\n--- body ---\n${body}`);
  assert.strictEqual(
    lang.run(body),
    undefined,
    `${id} BARE answered. The bare scanner has no rule for a quote run of four, so it still refuses\n` +
      `this reply; if it now admits it, this row is the place to say so.\n--- body ---\n${body}`
  );
};

itest("[v70 P3 C# 15] a quote run SHORTER than the opener is content, not a close", () => {
  // The rule that makes the form useful: a four-quote opener quotes a body
  // that itself contains a three-quote run. Closing on the first run of three
  // would end the literal early and lex the rest of the body as code.
  pinsFencedCountBareRefused(
    "csharp",
    L('    var example = """"', 'the """ opener', "[Fact]", "public void Ghost() { }", '    """";'),
    baselineOf("csharp"),
    "the closing run must be at least as long as the opening one"
  );
});

itest("[v70 P3 C# 16] a longer closing run still closes, and the code after it is live", () => {
  // Both halves in one fixture: the attribute INSIDE the body does not count
  // and the attribute AFTER the close does. A lens that blanks to the end of
  // the reply passes the first half and fails the second.
  pinsFencedCountBareRefused(
    "csharp",
    L('    var example = """', "[Fact] public void Ghost() { }", '    """";', "    [Fact] public void Extra() { }"),
    baselineOf("csharp") + 1,
    "a run of at least the opening length closes; what follows is code and counts"
  );
});

itest('[v70 P3 C# 17] a raw string with NO closing run blanks to the end of the reply', () => {
  // The refusing direction, and the one to be wrong in: a literal left open is
  // what a truncated reply looks like, and the alternative is reading its body
  // as code. Stated on the fenced path, like C# 12: the bare path has its own
  // answer to an unclosed literal under P8 rule 3.
  const body = CS_BASE(L('    var example = """', "[Fact]", "public void Ghost() { }"));
  const res = extractTestFunctions(fenced("csharp", body), "csharp");
  assert.ok(res, "FENCED: the cut raw string lost the test ABOVE it too, which is a lens defect");
  assert.strictEqual(
    res.testCount,
    baselineOf("csharp") - 1,
    `everything after an unclosed raw string blanks, so the [Fact] below it stops counting\n${body}`
  );
});

itest('[v70 P3 C# 18] two quotes are still an empty string and one is still a string', () => {
  // A NON-MOVE guard: green before the raw branch existed and green after, by
  // construction. It is here because the raw branch is the thing that could
  // break it. An empty string is ordinary C#, and reading a two-quote run as a
  // raw opener would blank the rest of the file.
  pinsCount(
    "csharp",
    L('    var empty = "";', '    var example = "[Fact] public void Ghost() { }";'),
    baselineOf("csharp"),
    'a run of two quotes is an empty string, not a raw opener'
  );
  pinsCount(
    "csharp",
    L('    var empty = $"";', '    var example = "[Fact] public void Ghost() { }";'),
    baselineOf("csharp"),
    'the $ prefix does not lower the three-quote threshold'
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
// The TypeScript regex literal, added in phase 3 loop 2, and OPT-IN.
//
// `neutralizeTsCommentsAndStrings` serves two consumers: the counter here and
// `tsFileLocalDefinitions` on the prompt path. Unmodelled, a delimiter inside a
// regex is lexed as itself, and a backtick is the expensive one: it opens a
// template that runs to the end of the file, so a fence-handling module's tests
// counted zero and the reply was REFUSED. The rule is switched on for the
// counting lens only; the last row here is the one that says the prompt path
// did not move.
//
// The rule itself belongs to `matchRegexLiteral`/`endsInValue`, which phase 2
// wrote and the bare scanner already calls. These rows check that the lens
// reaches that rule and keeps the bookkeeping it needs, not that the rule is
// right: phase 2's own rows own that.
// ===========================================================================

itest("[v70 P3 ts-regex 1] a BACKTICK inside a regex does not open a template that eats the rest of the reply", () => {
  // The costly direction and the review's finding: the tests below the regex
  // were blanked, the count reached zero and the reply was refused outright.
  pinsCount(
    "typescript",
    "  const re = /" + BT + "{3}/;",
    baselineOf("typescript"),
    "a backtick inside a regex is regex syntax; lexed as a template delimiter it runs past every later test"
  );
});

itest("[v70 P3 ts-regex 2] a quote inside a regex does not open a string, single or double", () => {
  // The admitting direction: the `it(` written inside the regex is not a test.
  pinsCount(
    "typescript",
    "  const re = /it('g')/;",
    baselineOf("typescript"),
    "an apostrophe inside a regex is regex syntax"
  );
  pinsCount(
    "typescript",
    '  const re = /it("g")/;',
    baselineOf("typescript"),
    "a double quote inside a regex is regex syntax"
  );
});

itest("[v70 P3 ts-regex 3] a / inside a CHARACTER CLASS does not close the regex", () => {
  // Discriminating against a matcher with no class rule: closing on the inner
  // slash leaves `]it(x)/;` behind as code, and the `it(` in it counts.
  pinsCount(
    "typescript",
    "  const re = /[/]it(x)/;",
    baselineOf("typescript"),
    "the class brackets suspend the closing delimiter"
  );
});

itest("[v70 P3 ts-regex 4] a DIVISION is not a regex: a / after a value divides", () => {
  // A NON-MOVE guard: with no regex rule at all this already passed. It is here
  // because the new rule is what could break it. The trap the opt-in rule buys
  // into. Reading `/ … /` as a regex blanks a real call, which is the admitting
  // direction: it hides whatever the operand held.
  //
  // THE PROBE CHANGED, session-v71 item B. It was `test(0)`, whose count proved
  // the operand survived; the call-shape rule does not count that, because
  // `test(0)` takes a number and is not a test (P8 amendment 5 rule 11). So the
  // probe is a REAL test call in the same position, which is a stronger probe
  // for the same property: if the slash opened a regex, the probe is blanked and
  // the count drops back to the baseline.
  pinsCount(
    "typescript",
    '  const q = width / test("probe", () => {}) / 2;',
    baselineOf("typescript") + 1,
    "an identifier before the slash is a value in hand, so the slash divides it"
  );
});

itest("[v70 P3 ts-regex 5] a postfix ++ leaves a value in hand, so the / after it divides", () => {
  // A NON-MOVE guard, like the row above, and the same probe swap for the same
  // reason (session-v71 item B).
  pinsCount(
    "typescript",
    '  const q = counter++ / test("probe", () => {}) / 2;',
    baselineOf("typescript") + 1,
    "`x++ / 2` is a division; reading the doubled + as an operator opens a phantom regex"
  );
});

itest("[v70 P3 ts-regex 6] a regex FIRST on its line is still a regex when code follows it", () => {
  // The token before it is the `{` that opened the enclosing arrow body, which
  // is not a value, so the slash opens a regex.
  //
  // THE PROBE CHANGED, session-v71 item B. The survivor used to be the trailing
  // `.test(`, which counted because the old NAME pattern matched after a dot.
  // The call-shape rule refuses `.test(name)` - it takes an identifier - so the
  // survivor is a real test call after it on the same line. Both halves are
  // still pinned: the `it("ghost")` INSIDE the regex is blanked (or the count
  // would be baseline + 2), and the code after the regex is not.
  pinsCount(
    "typescript",
    '  /it("ghost")/.test(name); test("survivor", () => {});',
    baselineOf("typescript") + 1,
    "a regex may begin a line; what it must not do is fill one"
  );
});

itest("[v70 P3 ts-regex 7] a regex ALONE on its line is left as text", () => {
  // A NON-MOVE guard: a lens with no regex rule leaves the line as text too, so
  // the answer is the same on both sides. What it pins is that the new rule
  // does NOT fire here. Phase 2's rule, reached through the same matcher. A regex filling a line by
  // itself is an expression statement that does nothing, and the shape is far
  // more often prose with slashes at both ends. Left as text, the `it(` inside
  // it counts, which is the admitting direction and the cost of the rule.
  pinsCount(
    "typescript",
    '  /it("ghost", () => {});/',
    baselineOf("typescript") + 1,
    "`aloneOnItsLine` refuses the lex; the line stays code and its `it(` is counted"
  );
});

itest("[v70 P3 ts-regex 8] all four TS-family ids get the regex-aware lens", () => {
  const body = TS_BASE("  const re = /" + BT + "{3}/;");
  const ids = ["typescript", "typescriptreact", "javascript", "javascriptreact"];
  for (const id of ids) {
    const f = extractTestFunctions(fenced("typescript", body), id);
    assert.ok(f, `${id} FENCED refused a reply whose only backtick is inside a regex literal`);
    assert.strictEqual(
      f.testCount,
      baselineOf("typescript"),
      `${id} FENCED counted differently from the plain baseline; the alias ids must share one lens`
    );
    const b = extractTestFunctions(body, id);
    assert.ok(b, `${id} BARE refused the same reply`);
    assert.strictEqual(b.testCount, baselineOf("typescript"), `${id} BARE count`);
  }
});

// ---------------------------------------------------------------------------
// The prompt path does not move. `tsFileLocalDefinitions` is the ONLY caller of
// the lens with the regex rule off, so its answer over a real corpus is the
// whole exposed surface of the default. The baseline facade is the same
// pre-v70 commit the differential rows use, where both that function and the
// lens it reads are byte-identical to the working tree's, regex branch aside.
// ---------------------------------------------------------------------------

const tsSourcesUnder = (dir) => {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name.startsWith(".")) continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name === "out" || e.name === "dist") continue;
        walk(full);
      } else if (e.name.endsWith(".ts") || e.name.endsWith(".tsx")) {
        out.push(full);
      }
    }
  };
  walk(dir);
  return out;
};

// A NON-MOVE guard by definition: the baseline it compares against is what the
// default must still produce.
test("[v70 P3 ts-regex 9] with the regex rule OFF the definition finder answers identically to the pre-v70 baseline, over the whole repo", (ctx) => {
  if (bundleError || mainError) return ctx.skip("a facade failed to build");
  const files = [...tsSourcesUnder(path.join(REPO, "src")), ...tsSourcesUnder(path.join(REPO, "test"))];
  assert.ok(files.length > 100, `only ${files.length} TypeScript sources found; the corpus is not the repo`);

  const diffs = [];
  let withDefinitions = 0;
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8");
    const now = [...mod.tsFileLocalDefinitions(src)].sort();
    const before = [...mainMod.tsFileLocalDefinitions(src)].sort();
    if (now.length > 0) withDefinitions++;
    if (JSON.stringify(now) !== JSON.stringify(before)) {
      diffs.push(`${path.relative(REPO, f)}\n  baseline: ${before.join(", ")}\n  now:      ${now.join(", ")}`);
    }
  }
  assert.strictEqual(
    diffs.length,
    0,
    `${diffs.length} of ${files.length} files changed their definition set. The regex rule is opt-in precisely so the\n` +
      `prompt path cannot move; a diff here means the default was flipped or the shared lens was edited.\n\n${diffs.slice(0, 5).join("\n\n")}`
  );

  // A corpus that answers nothing proves nothing.
  assert.ok(
    withDefinitions > 50,
    `only ${withDefinitions} of ${files.length} files produced any definitions, so the comparison is close to empty`
  );
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

// ===========================================================================
// Loop 3. Two measured one-hunk fixes from the loop-2 review.
// ===========================================================================

itest("[v70 P3 loop3 1] C#: a run of `$` at code position is lexed once, not once per dollar", () => {
  // Before the fix the raw-string branch counted the WHOLE remaining `$` run at every `$` and
  // pushed one character, so 32,000 dollars cost 386ms. A small model in a repetition loop emits
  // exactly that run, on the request thread.
  const run = "$".repeat(32000);
  const body = `[Fact]\npublic void A() { var s = ${run}; }`;
  const t0 = process.hrtime.bigint();
  const res = mod.extractTestFunctions(fenced("csharp", body), "csharp");
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.ok(res && res.testCount === 1, "the [Fact] before the run is still counted");
  assert.ok(ms < 50, `32,000 dollars took ${ms.toFixed(1)}ms; the run must be linear`);
});

itest("[v70 P3 loop3 2] TS: `of` as an identifier before a division does not open a regex", () => {
  // `of` is a legal identifier and sat in REGEX_AFTER_KEYWORD, so `of / 2` opened a phantom regex
  // that closed on the next slash on the line and blanked a real `it(` between them.
  pinsCount(
    "typescript",
    '  const half = of / 2; it("ghost", () => {}); const q = 1 / 2;',
    baselineOf("typescript") + 1,
    "the `it(` between the two slashes is a real test and must be counted"
  );
});
