// Adversarial review evidence for session-v70 phase 2, LOOP 2.
//
// Subject, pinned: commit 7518710 ("the bare scanner's regex rule no longer
// invents or hides a literal"), and ONLY its delta against 53762e0:
//
//   1. the postfix `++` / `--` rule in endsInValue
//   2. the `lastRegexEnd > lastClose` refusal in closesAsCode
//   3. the hoisted `text[i] === "/"` guard in scanBare
//
// Nothing here reads the working tree. Another agent is editing
// src/core/instructPostprocess.ts in this checkout, so every facade below is
// built from a `git archive` of a fixed commit into a scratch directory. That
// is what keeps these rows stable while phase 3 runs.
//
// Loop 1's rows are test/review-v70-p2.test.cjs. Its rows 1, 2, 5, 11 are
// deferred and 3, 4 belong to phase 3; none of them is re-argued here.
//
// WHITE BOX. A red row is a defect claim with a runnable case. Rows tagged
// "holding" are properties this loop attacked and could not break.
//
// The asymmetry every row is written against: a refusal costs a re-run, a
// false admit writes prose or an unparseable fragment into the user's test file.
//
// Run: SKIP_LIVE=1 node --test test/review-v70-p2b.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const esbuild = require("esbuild");

const REPO = path.join(__dirname, "..");
const POST = "7518710"; // the reviewed commit
const PRE = "53762e0"; // its parent, phase 2 before this fix

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "c80-v70p2b-"));
const built = [];
let setupError;

/** Extract `src` from a pinned commit into the scratch dir. Read only: this
 *  never touches the index or the working tree. */
function archive(commit, tag) {
  const dir = path.join(scratch, tag);
  fs.mkdirSync(dir, { recursive: true });
  const tar = execFileSync("git", ["-C", REPO, "archive", commit, "src"], {
    maxBuffer: 256 * 1024 * 1024,
  });
  execFileSync("tar", ["-x", "-C", dir], { input: tar });
  return dir;
}

/** Bundle the pinned copy's public seam and require it headless. */
function facade(tag, root) {
  const entry = path.join(scratch, `${tag}.entry.ts`);
  const outfile = path.join(scratch, `${tag}.bundle.cjs`);
  const target = path.join(root, "src", "core", "instructPostprocess");
  fs.writeFileSync(
    entry,
    `export { extractTestModule, extractTestFunctions } from ${JSON.stringify(target)};\n`
  );
  esbuild.buildSync({ entryPoints: [entry], bundle: true, outfile, format: "cjs", platform: "node" });
  built.push(outfile);
  return require(outfile);
}

/** Cut one exact block out of the pinned source, so a variant can isolate one
 *  of the three changes. The markers are asserted, not hoped for: if the
 *  reviewed source ever stops containing them the row fails loudly instead of
 *  quietly measuring nothing. */
function withoutBlock(srcRoot, tag, head, tail) {
  const dir = path.join(scratch, tag);
  fs.cpSync(srcRoot, dir, { recursive: true });
  const file = path.join(dir, "src", "core", "instructPostprocess.ts");
  const text = fs.readFileSync(file, "utf8");
  const a = text.indexOf(head);
  assert.ok(a >= 0, `variant ${tag}: the reviewed source no longer contains ${JSON.stringify(head)}`);
  const b = text.indexOf(tail, a);
  assert.ok(b >= 0, `variant ${tag}: no ${JSON.stringify(tail)} after the head marker`);
  fs.writeFileSync(file, text.slice(0, a) + text.slice(b + tail.length));
  return dir;
}

const GATE_HEAD = "  if (scanned.lastRegexEnd !== undefined && scanned.lastRegexEnd > scanned.lastClose) {";
const SIGN_HEAD = '  if ((c === "+" || c === "-") && out[p - 1] === c) {';
const RET_FALSE = "    return false;\n  }\n";
const RET_TRUE = "    return true;\n  }\n";

let post = {};
let pre = {};
/** The WORKING TREE, for the rows that phase 2's third loop closed or pinned
 *  after this review was written. The pinned facades above stay as the
 *  evidence of what 7518710 did; these five rows ask what the code does now. */
let live = {};
let hoistOnly = {};
let signOnly = {};
let gateOnly = {};
try {
  const postRoot = archive(POST, "post");
  const preRoot = archive(PRE, "pre");
  post = facade("post", postRoot);
  pre = facade("pre", preRoot);
  live = facade("live", REPO);
  // The reviewed commit with BOTH behavioural rules cut out. What is left of
  // the delta is the hoisted `/` guard and nothing else.
  hoistOnly = facade(
    "hoistonly",
    withoutBlock(
      withoutBlock(postRoot, "hoistonly-src", GATE_HEAD, RET_FALSE),
      "hoistonly-src2",
      SIGN_HEAD,
      RET_TRUE
    )
  );
  signOnly = facade("signonly", withoutBlock(postRoot, "signonly-src", GATE_HEAD, RET_FALSE));
  gateOnly = facade("gateonly", withoutBlock(postRoot, "gateonly-src", SIGN_HEAD, RET_TRUE));
} catch (e) {
  setupError = e;
}

test.after(() => {
  for (const f of built) fs.rmSync(f, { force: true });
  fs.rmSync(scratch, { recursive: true, force: true });
});

const rtest = (name, fn) =>
  test(name, (ctx) => {
    if (setupError) return ctx.skip(`pinned facades failed to build; see row 0: ${setupError}`);
    return fn(ctx);
  });

const ex = (m, reply) => m.extractTestFunctions(reply, "typescript");

const refusedNow = (reply, why) =>
  assert.strictEqual(
    ex(live, reply),
    undefined,
    `${why}\nbut it was ADMITTED and this text would be spliced into the user's test file:\n---\n${reply}\n---`
  );

const admittedNow = (reply, why) =>
  assert.notStrictEqual(ex(post, reply), undefined, `${why}\n---\n${reply}\n---`);

const sameAnswer = (a, b) =>
  (a === undefined) === (b === undefined) &&
  (a === undefined || (a.text === b.text && a.testCount === b.testCount));

const TS = `it("adds", () => {\n  expect(add(1, 2)).toBe(3);\n});`;
const TS2 = `it("subs", () => {\n  expect(sub(3, 1)).toBe(2);\n});`;

rtest("[REV70-P2B 0] both pinned facades build and export the seam", () => {
  assert.strictEqual(setupError, undefined, `setup failed: ${setupError && setupError.stack}`);
  for (const [tag, m] of [
    [POST, post],
    [PRE, pre],
    ["hoist-only", hoistOnly],
    ["sign-only", signOnly],
    ["gate-only", gateOnly],
  ]) {
    assert.strictEqual(typeof m.extractTestFunctions, "function", `${tag}: extractTestFunctions missing`);
    assert.strictEqual(typeof m.extractTestModule, "function", `${tag}: extractTestModule missing`);
  }
});

// ===========================================================================
// The `lastRegexEnd > lastClose` refusal. It is POSITIONAL, not structural: it
// asks where the last phantom regex ended relative to the module's last
// depth-0 close. A prose line that lexes as a regex anywhere EARLIER than that
// close is still blanked, still passes the tail gate on the code line below
// it, and is still returned verbatim in the spliced text, because bareCodeBlock
// returns the ORIGINAL text and not the neutralised copy. Loop 1 row 6 is
// closed; the mechanism behind it is not.
// ===========================================================================

rtest("[REV70-P2B 1] KNOWN LIMIT S70-15: a balanced prose line BETWEEN two test blocks is admitted, as on main", () => {
  // PINNED, not fixed. Measured against `git archive main src`: main admits this at testCount=2,
  // and so did 53762e0 and 7518710. The line carries no bracket or quote, so it balances, and
  // rule 9's tail gate only reads the LAST line. Phase 2 did not open this; closing it needs a
  // per-line prose discriminator for the interior of a reply, which is S70-15's design call.
  // The whole-line regex rule from loop 3 leaves this line as text, which is exactly main's read.
  const res = ex(live, `${TS}\n/ covers add and the overflow path /\n${TS2}`);
  assert.notStrictEqual(res, undefined, "S70-15: main admits interior prose that balances; if this is refused, S70-15 is closed and this row should assert refusal");
  assert.strictEqual(res.testCount, 2, "and the count is the two real tests, as on main");
});

rtest("[REV70-P2B 2] rule 3: an interior phantom regex still hides an unbalanced OPEN paren", () => {
  const reply = `${TS}\n/ see helper( for the rest /\n${TS2}`;
  refusedNow(
    reply,
    "this text does not parse: `helper(` never closes. The phantom regex blanks the paren before the delimiter count sees it, which is the exact mechanism loop 1 rows 7 and 8 named"
  );
});

rtest("[REV70-P2B 3] KNOWN LIMIT S70-15: a balanced prose line inside a describe is admitted, as on main", () => {
  // PINNED, not fixed: S70-15, the same tail-only residual nested one level. Main admits at
  // testCount=1.
  const res = ex(live, `describe("add", () => {\n  it("adds", () => {\n    expect(add(1, 2)).toBe(3);\n  });\n/ covers add and the overflow path /\n});`);
  assert.notStrictEqual(res, undefined, "S70-15: main admits this; if refused, S70-15 is closed and this row should assert refusal");
  assert.strictEqual(res.testCount, 1);
});

rtest("[REV70-P2B 4] rule 3: the nested phantom regex hides an unbalanced OPEN paren too", () => {
  refusedNow(
    `describe("add", () => {\n  it("adds", () => {\n    expect(add(1, 2)).toBe(3);\n  });\n/ see helper( for the rest /\n});`,
    "a describe block is what a model writes when asked for more than one test, so this is the ordinary shape of the row 6 failure, not an exotic one"
  );
});

// ===========================================================================
// The postfix `++` / `--` rule. It reads ANY two adjacent `+` or `-` before the
// slash as a postfix step. A run of three is a postfix step followed by a
// BINARY operator, after which a regex is exactly what JavaScript expects.
// ===========================================================================

rtest("[REV70-P2B 5] KNOWN LIMIT S70-16: a triple sign run is read as a postfix step, so a reply that parses is refused", () => {
  // PINNED, not fixed. Main refuses all three spellings too (it has no regex model, so the regex
  // body is code there as well); 53762e0 admitted them and 7518710 returned main's answer. A
  // re-run, never a corrupted file, on a shape no test writes. The fix widens the admit side of the
  // sign rule, which phase 2 was forbidden to do. S70-16.
  for (const body of [
    `const r = a--- /[)]/.test(s);`,
    `const r = a---/[)]/.test(s);`,
    `const r = a+++ /[)]/.test(s);`,
  ]) {
    const reply = `it("a", () => {\n  ${body}\n  expect(1).toBe(1);\n});`;
    assert.strictEqual(
      ex(live, reply),
      undefined,
      `S70-16: JavaScript lexes this as \`a--\`, a binary \`-\`, then a REGEX, and it parses; the ` +
        `scanner refuses it today, as main did. If this is admitted, S70-16 is closed and this row ` +
        `should assert admission.\n---\n${reply}\n---`
    );
  }
});

rtest("[REV70-P2B 6] holding: the spaced and unary spellings the sign rule has to get right", () => {
  for (const body of [
    `const r = a-- - /[)]/.test(s);`,
    `const r = a++ + /[)]/.test(s);`,
    `const r = a + +/[)]/.test(s);`,
    `const x = y +\n+ /[)]/.test(s);`,
    `const r = a - -1 / 2;`,
    `const r = a + +b / 2;`,
    `const r = x++ / 2;`,
    `expect(x-- / f(2 / 1).g).toBe(2);`,
    `let i = 2;\n  i--;\n  expect(/[)]/.test(s)).toBe(false);`,
  ]) {
    admittedNow(
      `it("a", () => {\n  ${body}\n  expect(1).toBe(1);\n});`,
      `the sign rule must not fire here: ${body}`
    );
  }
});

// ===========================================================================
// The hoisted `/` guard. matchRegexLiteral already refused on a non-slash, so
// moving that test to the call site should change nothing but the cost. The
// row proves it rather than reading it: a variant of the REVIEWED commit with
// both behavioural rules cut out must answer identically to the pre-fix commit
// on every input.
// ===========================================================================

const TOKENS = [
  "/", "//", "/*", "*/", "++", "--", "+", "-", "(", ")", "{", "}", "[", "]",
  ";", ",", "=", ":", '"s"', "`t`", "a", "b", "1", " ", "\n", "re", ".test",
  "return ", "<", ">", "x/", "/y", "++ /", "-- /", "+ /", "- /",
];
const SHELLS = [
  (b) => `it("a", () => {\n  ${b}\n});`,
  (b) => `${TS}\n${b}`,
  (b) => `describe("g", () => {\n  ${TS.replace(/^/gm, "  ")}\n${b}\n});`,
  (b) => `it("a", () => {\n  ${b}\n});\n${TS2}`,
];

/** Deterministic LCG, so a red row is reproducible rather than a coin toss. */
function corpus(seed, count) {
  let s = seed;
  const rnd = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
  const out = [];
  for (let k = 0; k < count; k++) {
    const len = 1 + Math.floor(rnd() * 12);
    let body = "";
    for (let j = 0; j < len; j++) body += TOKENS[Math.floor(rnd() * TOKENS.length)];
    out.push(SHELLS[Math.floor(rnd() * SHELLS.length)](body));
  }
  return out;
}

rtest("[REV70-P2B 7] holding: the hoisted `/` guard is behaviour-identical to asking at every character", () => {
  const replies = corpus(987654321, 120000);
  const differ = [];
  for (const reply of replies) {
    for (const lang of ["typescript", "typescriptreact"]) {
      const a = pre.extractTestFunctions(reply, lang);
      const b = hoistOnly.extractTestFunctions(reply, lang);
      if (!sameAnswer(a, b) && differ.length < 3) differ.push(`${lang} :: ${JSON.stringify(reply)}`);
    }
  }
  assert.deepStrictEqual(
    differ,
    [],
    `the hoist alone changed an answer on ${differ.length} of ${replies.length * 2} pinned inputs`
  );
});

rtest("[REV70-P2B 8] holding: every difference the commit makes is one of its two intended rules", () => {
  const replies = corpus(13579, 120000);
  let sign = 0;
  let gate = 0;
  const unexplained = [];
  for (const reply of replies) {
    const a = pre.extractTestFunctions(reply, "typescript");
    const b = post.extractTestFunctions(reply, "typescript");
    if (sameAnswer(a, b)) continue;
    const bySign = !sameAnswer(a, signOnly.extractTestFunctions(reply, "typescript"));
    const byGate = !sameAnswer(a, gateOnly.extractTestFunctions(reply, "typescript"));
    if (bySign) sign++;
    else if (byGate) gate++;
    else if (unexplained.length < 5) unexplained.push(JSON.stringify(reply));
  }
  assert.deepStrictEqual(
    unexplained,
    [],
    `a difference attributable to NEITHER rule, which means the hoist or an interaction moved it. ` +
      `sign-attributable ${sign}, gate-attributable ${gate}`
  );
  assert.ok(sign > 0 && gate > 0, `the corpus never exercised one of the rules (sign ${sign}, gate ${gate})`);
});

// ===========================================================================
// Cost. Loop 1 row 10 measured a doubling ratio; these are absolute numbers on
// the pinned commit, with the pre-fix answer alongside so the row says how much
// of the win is real.
// ===========================================================================

rtest("[REV70-P2B 9] holding: the scan is linear on the shapes that were quadratic", () => {
  const best = (m, reply) => {
    let b = Infinity;
    for (let k = 0; k < 3; k++) {
      const t0 = process.hrtime.bigint();
      m.extractTestFunctions(reply, "typescript");
      const d = Number(process.hrtime.bigint() - t0) / 1e6;
      if (d < b) b = d;
    }
    return b;
  };
  const whitespace = `it("a", () => {\n${" ".repeat(80000)}\n  expect(f(1)).toBe(1);\n});`;
  const comments = (n) =>
    `it("a", () => {\n` + `  // a note about this case and why it matters\n`.repeat(n) + `  expect(f(1)).toBe(1);\n});`;
  let ordinary = `it("suite", () => {\n`;
  for (let i = 0; ordinary.length < 96 * 1024; i++) {
    ordinary += `  expect(add(${i}, ${i + 1})).toBe(${2 * i + 1});\n  const r${i} = total${i} / count${i};\n`;
  }
  ordinary += `});`;
  const rows = [
    ["80k whitespace run", whitespace, 200],
    ["1600 comment lines", comments(1600), 200],
    ["96KB ordinary test file", ordinary, 400],
  ];
  const report = [];
  for (const [name, reply, budget] of rows) {
    const now = best(post, reply);
    const was = best(pre, reply);
    report.push(`${name}: ${now.toFixed(1)}ms (pre-fix ${was.toFixed(1)}ms)`);
    assert.ok(now < budget, `${name} took ${now.toFixed(1)}ms, over the ${budget}ms budget. ${report.join("; ")}`);
  }
  const small = best(post, comments(800));
  const large = best(post, comments(1600));
  assert.ok(large < small * 3 + 1, `doubling the comment run multiplied the time by ${(large / small).toFixed(1)}x`);
});

// ===========================================================================
// Regression sweeps from loop 1, re-run against the PINNED commit. Any admitted
// count above the pre-fix count is a finding.
// ===========================================================================

rtest("[REV70-P2B 10] holding: the truncation sweep admits no more than it did before the fix", () => {
  const BQ = String.fromCharCode(96);
  const SQ = String.fromCharCode(39);
  const DQ = String.fromCharCode(34);
  const FIX = {
    rust: `#[cfg(test)]\nmod tests {\n    use super::*;\n    #[test]\n    fn q() {\n        assert_eq!(split_on(${SQ}${DQ}${SQ}), 2);\n        assert_eq!(parse(r#"{"a": 1}"#), 1);\n    }\n}`,
    csharp: `[TestClass]\npublic class T {\n    [TestMethod]\n    public void A() {\n        Assert.AreEqual(@"C:\\dir\\", Norm(@"C:\\dir\\"));\n        Assert.AreEqual(${SQ}${DQ}${SQ}, Quote());\n    }\n}`,
    go: `func TestNorm(t *testing.T) {\n\tif got := Norm(${BQ}C:\\dir\\${BQ}); got != "x" {\n\t\tt.Errorf("got %q", got)\n\t}\n}`,
    typescript: `it("adds", () => {\n  const r = total / count;\n  expect(r).toBe(2);\n  expect(s).toMatch(/^a+b$/);\n  expect(x++ / 2).toBe(1);\n});`,
    python: `def test_total():\n    assert total(1, 2) == 3\n    assert label(1) == "one"`,
  };
  const call = (m, lang, r) => (lang === "rust" ? m.extractTestModule(r) : m.extractTestFunctions(r, lang));
  for (const [lang, text] of Object.entries(FIX)) {
    let now = 0;
    let was = 0;
    for (let n = 1; n < text.length; n++) {
      if (call(post, lang, text.slice(0, n)) !== undefined) now++;
      if (call(pre, lang, text.slice(0, n)) !== undefined) was++;
    }
    assert.ok(
      now <= was,
      `${lang}: the fix ADMITS ${now} of ${text.length - 1} truncations where the pre-fix commit admitted ${was}`
    );
    if (lang === "rust" || lang === "csharp" || lang === "go") {
      assert.strictEqual(now, 0, `${lang}: loop 1 row 17 pinned 0 admitted truncations and this commit admits ${now}`);
    }
  }
});

rtest("[REV70-P2B 11] holding: a real regex-carrying reply is not caught by the new refusal", () => {
  for (const reply of [
    `it("adds", () => {\n  expect(label(1)).toMatch(/^one$/);\n});`,
    `const RE = /^one$/;\nit("adds", () => {\n  expect(RE.test(label(1))).toBe(true);\n});`,
    `it("adds", () => {\n  expect("a-b".replace(/-/g, "_")).toBe("a_b");\n});`,
    `describe("re", () => {\n  it("adds", () => {\n    expect(s.split(/[,;]/)).toHaveLength(2);\n  });\n});`,
  ]) {
    admittedNow(reply, "the lastRegexEnd gate must only fire on a regex that ends after the module's last close");
  }
});

rtest("[REV70-P2B 12] holding: loop 1 row 6 stays closed, and a trailing comment stays allowed", () => {
  refusedNow(`${TS}\n/ covers add and the overflow path /`, "loop 1 row 6");
  refusedNow(`${TS}\n/ covers add and the overflow path /\n   \n`, "row 6 with trailing blank lines, so the tail walk starts higher");
  refusedNow(`${TS}\nCovers the 1/2 and 3/4 rounding cases.`, "loop 1 row 18, a prose line carrying two slashes");
  admittedNow(`${TS}\n// covers add and the overflow path`, "a trailing line comment is code the model may write");
  admittedNow(`${TS}\n/* covers add and the overflow path */`, "a trailing block comment is code the model may write");
});
