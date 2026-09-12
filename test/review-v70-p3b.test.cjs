// Adversarial review of session-v70 phase 3, LOOP 2 [HEAD bee30c8].
//
// Narrow scope: the delta in `git show bee30c8` only. The C# raw-string branch
// in `neutralizeCSharpCommentsAndStrings`, the opt-in `regexLiterals` mode in
// `neutralizeTsCommentsAndStrings`, and `countingLensFor` handing TypeScript the
// regex-aware lens. Loop 1's review is `test/review-v70-p3.test.cjs`; `#if false`
// (S70-18) and the bare scanner's missing C# raw-string rule (S70-6) are already
// triaged and are not re-argued here.
//
// Every row is tagged `[REV70-P3B n]`. A FAILING row is the finding. Green rows
// pin behaviour that holds so a later fix cannot buy the red ones.
//
// Rule 1 rows compare against a facade of the PRE-V70 baseline commit, built
// read-only with `git archive`, same as loop 1. Nothing here writes the index.
//
// Run: node --test test/review-v70-p3b.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { bundleCore } = require("./.blind-util.cjs");

const REPO = path.join(__dirname, "..");
// A COMMIT, not the `main` ref: a PR checkout has no local `main`, and once this
// branch merges `main` is this code. 1fb757f is main at 3.5.0.
const PRE_V70_BASELINE = "1fb757f415b7dd1f9f956d0b761dfbcd78750ebb";

let mod = {};
let cleanup = () => {};
let bundleError;
try {
  ({ mod, cleanup } = bundleCore(
    "rev70p3b",
    `export { extractTestFunctions, tsFileLocalDefinitions } from "../src/core/instructPostprocess";\n`
  ));
} catch (e) {
  bundleError = e;
}

let mainMod = {};
let mainCleanup = () => {};
let mainError;
let mainDir;
try {
  mainDir = fs.mkdtempSync(path.join(os.tmpdir(), "c80-rev70p3b-main-"));
  const tar = execFileSync("git", ["-C", REPO, "archive", PRE_V70_BASELINE, "src"], {
    maxBuffer: 256 * 1024 * 1024,
  });
  execFileSync("tar", ["-x", "-C", mainDir], { input: tar });
  const entry = path.join(mainDir, "src", "core", "instructPostprocess");
  ({ mod: mainMod, cleanup: mainCleanup } = bundleCore(
    "rev70p3bmain",
    `export { extractTestFunctions, tsFileLocalDefinitions } from ${JSON.stringify(entry)};\n`
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

const L = (...lines) => lines.join("\n");
const FENCE = "```";
const BT = "`";
const Q = '"';
const AP = "'";
const fenced = (tag, body) => `${FENCE}${tag}\n${body}\n${FENCE}\n`;

const now = (body, lang) => mod.extractTestFunctions(body, lang);
const old = (body, lang) => mainMod.extractTestFunctions(body, lang);
const n = (r) => (r === undefined ? "REFUSED" : r.testCount);

const report = (label, reply, a, b, truth) =>
  `${label}\n---- REPLY ----\n${reply}\n---- END REPLY ----\n` +
  `working tree: ${n(a)}\nmain:         ${n(b)}\nhand count:   ${truth}`;

// `.test(` is itself the counted shape (TEST_FUNCTION_SHAPES has no `.`
// lookbehind, unlike the bare gate), so every fixture below calls `.exec` on a
// regex instead. Hand counts are of `it(`/`test(` at statement position only.
const TAIL = `it("b", () => { expect(1).toBe(1); });`;

rtest("[REV70-P3B 0] harness: both facades build", () => {
  assert.strictEqual(bundleError, undefined, `working-tree bundle failed: ${bundleError}`);
  assert.strictEqual(mainError, undefined, `main facade failed: ${mainError}`);
  assert.strictEqual(typeof mod.extractTestFunctions, "function");
  assert.strictEqual(typeof mainMod.extractTestFunctions, "function");
});

// ===========================================================================
// FINDING 1 (HIGH, NEW IN bee30c8). The C# raw-string opener scans its `$` run
// from every `$`, so a run of k dollar signs at code position costs O(k^2).
//
// Mechanism. The branch is entered on `c === "$"` as well as `c === '"'`, and
// it counts the WHOLE remaining `$` run before it learns there is no quote run
// behind it. openQuotes is then 0, the branch declines, the `$"` branch
// declines, and one `$` is pushed as code. The next character repeats the whole
// count. Before bee30c8 a `$` was tested against its single successor and cost
// O(1). A degenerate reply (a small model in a repetition loop is the everyday
// producer of a single-character run) turns the synchronous counting call into
// hundreds of milliseconds and grows as the square.
// ===========================================================================

rtest("[REV70-P3B 1] C#: a run of `$` at code position is quadratic", () => {
  const body = (k) =>
    fenced("csharp", L("public class T {", `  [Fact] public void A(){ var z = ${"$".repeat(k)}; }`, "}"));
  const ms = (k) => {
    const s = body(k);
    const t0 = process.hrtime.bigint();
    now(s, "csharp");
    return Number(process.hrtime.bigint() - t0) / 1e6;
  };
  ms(4000); // warm
  const small = ms(8000);
  const big = ms(32000);
  // Four times the input. Linear is ~4x, quadratic is ~16x. Allow a wide band.
  const ratio = big / Math.max(small, 0.001);
  assert.ok(
    ratio < 8,
    `a 4x longer \`$\` run costs ${ratio.toFixed(1)}x the time, not ~4x.\n` +
      `8000 dollars: ${small.toFixed(1)}ms\n32000 dollars: ${big.toFixed(1)}ms\n` +
      `Mechanism: the raw-string branch counts the whole \`$\` run at EVERY \`$\`.\n` +
      `A run of quotes is linear (row 2), so the defect is the \`$\` loop alone.`
  );
});

rtest("[REV70-P3B 2] C#: a run of `\"` at code position stays linear (guard)", () => {
  const body = (k) =>
    fenced("csharp", L("public class T {", "  [Fact] public void A(){}", `  var z = ${'"'.repeat(k)};`, "}"));
  const ms = (k) => {
    const s = body(k);
    const t0 = process.hrtime.bigint();
    now(s, "csharp");
    return Number(process.hrtime.bigint() - t0) / 1e6;
  };
  ms(4000);
  const small = ms(8000);
  const big = ms(32000);
  assert.ok(big / Math.max(small, 0.001) < 8, `quote run went superlinear: ${small} -> ${big} ms`);
});

// ===========================================================================
// FINDING 2 (HIGH). The regex mode closes the backtick hole ONLY where
// `matchRegexLiteral` says yes. At every position the shared rule declines a
// real regex, the backtick inside it still opens a template literal that runs to
// the end of the reply and blanks every later test. Five wrong-direction moves
// against the pre-v70 baseline, which had no backtick rule for TypeScript at all
// and therefore counted all five correctly.
//
// The declining positions are the shared rule's three deliberate readings:
// `)` is a value (so the `)` of an `if (...)` head is read as one), `}` is a
// value, `<` is a value, plus the alone-on-its-line guard. Each is defensible on
// its own; what the delta did is give each one a new way to cost a count, because
// the counting lens now owns the backtick AND defers to the rule.
// ===========================================================================

const backtickRows = [
  [
    "3",
    "a regex after the `)` of an `if (...)` head",
    L(`it("a", () => {`, `  if (x) /${BT}{3}/.exec(s);`, "});", TAIL),
    2,
  ],
  [
    "4",
    "a regex after a `}` that closed a block",
    L(`it("a", () => {`, "  if (x) { y(); }", `  /${BT}q/.exec(s);`, "});", TAIL),
    2,
  ],
  [
    "5",
    "a regex alone on its line (prettier breaks a long argument this way)",
    L(`it("a", () => {`, "  expect(s).toMatch(", `    /^${BT}{3}/`, "  );", "});", TAIL),
    2,
  ],
  [
    "6",
    "a regex after `<`",
    L(`it("a", () => { expect(a < /${BT}x/.source.length).toBe(true); });`, TAIL),
    2,
  ],
];

for (const [id, what, body, truth] of backtickRows) {
  rtest(`[REV70-P3B ${id}] CLOSED S70-19: ${what} counts the tests after it`, () => {
    // FLIPPED 2026-09-12, session-v71 item C. The shared regex rule still declines the slash at
    // these four positions - `)`, `}` and `<` read as values, and a regex alone on its line is the
    // bare scanner's prose defence - so the backtick still opens a template. What changed is what
    // happens when that template never CLOSES: the lens rewinds to the backtick, emits it as an
    // inert character and carries on, because a template that runs to the end of the reply is
    // evidence the backtick was not a delimiter. Bounded at 16 rewinds, measured flat.
    //
    // The named cost is the admitting direction and is real: a fenced reply genuinely cut
    // mid-template now counts the tests after the cut. That reply does not compile, and the
    // compile check is the next gate it meets. Differential: 0 moves against 3.5.1 on the 1050
    // clean and the 1050 hiding replies.
    const reply = fenced("typescript", body);
    const a = now(reply, "typescript");
    const b = old(reply, "typescript");
    assert.strictEqual(n(b), truth, "the 3.5.0 baseline counts this right, by accident; the pin is about `now`");
    assert.strictEqual(
      n(a),
      truth,
      report(`S70-19 CLOSED: the counting lens must answer the hand count here.`, reply, a, b, truth)
    );
  });
}

// ===========================================================================
// FINDING 3 (MEDIUM). The regex mode can blank a real `it(`. `of` and `in` are
// legal identifiers and both sit in REGEX_AFTER_KEYWORD, so a division after one
// is read as a regex opening, and it closes on the NEXT `/` on the same line,
// blanking everything between. A wrong-direction move: an over-blank, so the
// count drops below the hand count and a reply that should be admitted with two
// tests is admitted with one.
// ===========================================================================

rtest("[REV70-P3B 7] TS: `of` as an identifier lets a phantom regex eat an `it(`", () => {
  const body = L(
    `it("a", () => { const of = 8; const r = of / 2; it("inner", () => {}); const q = 9 / 3; });`
  );
  const reply = fenced("typescript", body);
  const a = now(reply, "typescript");
  const b = old(reply, "typescript");
  assert.strictEqual(
    n(a),
    2,
    report(
      "`of` is a legal identifier and a REGEX_AFTER_KEYWORD entry, so `of / 2` opens a " +
        "phantom regex that closes on the next `/` on the line and blanks the `it(` between them.",
      reply,
      a,
      b,
      2
    )
  );
});

// CONFIRMED HOLDING, with a named residual. A `//` inside a character class,
// at a position where the shared rule declines the regex, opens a line comment
// and blanks the rest of the line. It costs no count here because nothing after
// it on that line is a test shape, and the bare path refuses the reply outright
// (rows 39-42's direction). The blast radius is one line, unlike the backtick
// rows above, whose template runs to the end of the reply.
rtest("[REV70-P3B 8] TS: a `//` inside a declined regex costs no count", () => {
  const body = L(`it("a", () => { if (x) /[//]/.exec(s); expect(1).toBe(1); });`, TAIL);
  const reply = fenced("typescript", body);
  const a = now(reply, "typescript");
  const b = old(reply, "typescript");
  assert.strictEqual(n(a), 2, report("one-line blast radius", reply, a, b, 2));
});

// ===========================================================================
// CONFIRMED HOLDING. C# raw strings.
// ===========================================================================

const csRows = [
  ["9", "a four-quote opener whose body holds three quotes", L(
    "public class T {",
    `  const string S = ${Q.repeat(4)}`,
    `  [Fact] inside ${Q.repeat(3)} here`,
    `  ${Q.repeat(4)};`,
    "  [Fact] public void A(){}",
    "}"
  ), 1],
  ["10", "a closing run LONGER than the opener (not legal C#; must not under-blank)", L(
    "public class T {",
    `  const string S = ${Q.repeat(3)}`,
    "  x",
    `  ${Q.repeat(4)};`,
    "  [Fact] public void A(){}",
    "}"
  ), 1],
  ["11", "a `$$` raw string whose `{{ }}` hole carries quotes and a [Fact]", L(
    "public class T {",
    `  const string S = $$${Q.repeat(3)}{{ ${Q}q${Q} }} [Fact]${Q.repeat(3)};`,
    "  [Fact] public void A(){}",
    "}"
  ), 1],
  ["12", "two raw strings on consecutive lines", L(
    "public class T {",
    `  const string A = ${Q.repeat(3)}a [Fact]${Q.repeat(3)};`,
    `  const string B = ${Q.repeat(3)}b [Fact]${Q.repeat(3)};`,
    "  [Fact] public void A(){}",
    "}"
  ), 1],
  ["13", "a `\"\"\"` inside a line comment is a comment", L(
    "public class T {",
    `  // ${Q.repeat(3)} note`,
    "  [Fact] public void A(){}",
    "}"
  ), 1],
  ["14", "a `\"\"\"` inside a block comment is a comment", L(
    "public class T {",
    `  /* ${Q.repeat(3)} */`,
    "  [Fact] public void A(){}",
    "}"
  ), 1],
  ["15", "a quote run inside a verbatim `@\"...\"` is the verbatim escape", L(
    "public class T {",
    `  const string S = @${Q}a ${Q.repeat(4)} b${Q};`,
    "  [Fact] public void A(){}",
    "}"
  ), 1],
  ["16", "`$\"x\"` is interpolated, not raw: the `$` run branch falls through", L(
    "public class T {",
    `  string s = $${Q}x [Fact] y${Q};`,
    "  [Fact] public void A(){}",
    "}"
  ), 1],
  ["17", "a bare `$` in code falls through unchanged", L(
    "public class T {",
    "  [Fact] public void A(){ var x = a $ b; }",
    "}"
  ), 1],
];

for (const [id, what, body, expected] of csRows) {
  rtest(`[REV70-P3B ${id}] C#: ${what}`, () => {
    const reply = fenced("csharp", body);
    const a = now(reply, "csharp");
    assert.strictEqual(n(a), expected, report("C# raw-string reading", reply, a, old(reply, "csharp"), expected));
  });
}

const csRefusals = [
  ["18", "a raw string with no close blanks to EOF and the reply is refused", L(
    "public class T {",
    `  const string S = ${Q.repeat(3)}`,
    "  body",
    "  [Fact] public void A(){}",
    "}"
  )],
  ["20", "`@\"\"\"` is an unterminated verbatim string, as the compiler reads it", L(
    "public class T {",
    `  const string S = @${Q.repeat(3)};`,
    "  [Fact] public void A(){}",
    "}"
  )],
  ["21", "six quotes is one opening run of six, unterminated", L(
    "public class T {",
    `  const string S = ${Q.repeat(6)};`,
    "  [Fact] public void A(){}",
    "}"
  )],
];

for (const [id, what] of csRefusals) {
  const body = csRefusals.find((r) => r[0] === id)[2];
  rtest(`[REV70-P3B ${id}] C#: ${what}`, () => {
    const reply = fenced("csharp", body);
    const a = now(reply, "csharp");
    assert.strictEqual(n(a), "REFUSED", report("expected the refusing direction", reply, a, old(reply, "csharp"), "REFUSED"));
  });
}

// CONFIRMED HOLDING. A real test file whose LAST literal is a truncated raw
// string is not MISCOUNTED: the tests above the cut are counted and the `[Fact]`
// inside the unterminated body is not. The reply is still admitted, because the
// fenced path has no structural-completeness guard at all (that is the bare
// path's job) - pre-existing, unchanged by this delta, and main answers the same.
rtest("[REV70-P3B 19] C#: a truncated trailing raw string excludes only its own body", () => {
  const body = L(
    "public class T {",
    "  [Fact] public void A(){}",
    `  const string S = ${Q.repeat(3)}`,
    "  body [Fact] more"
  );
  const reply = fenced("csharp", body);
  const a = now(reply, "csharp");
  const b = old(reply, "csharp");
  assert.strictEqual(n(a), 1, report("only the code-position [Fact] counts", reply, a, b, 1));
  assert.strictEqual(n(b), 1, "main answered differently");
});

// ===========================================================================
// CONFIRMED HOLDING. TypeScript shapes the regex mode must not disturb.
// ===========================================================================

const tsRows = [
  ["22", "typescript", "a regex with escaped slashes and a backtick, at a value-expecting position",
    L(`it("a", () => { expect(/https?:\\/\\/${BT}/.exec(u)).toBeTruthy(); });`, TAIL), 2],
  ["23", "typescript", "a character class holding `/*` plus a backtick",
    L(`it("a", () => { expect(/[/*]${BT}/.exec(u)).toBeTruthy(); });`, TAIL), 2],
  ["24", "typescript", "flags `gimsuy` after a backticked regex",
    L(`it("a", () => { expect(/${BT}x/gimsuy.exec(u)).toBeTruthy(); });`, TAIL), 2],
  ["25", "typescript", "`a / b/ c` is two divisions, not a regex",
    L(`it("a", () => { const z = a / b/ c; expect(z).toBe(1); });`, TAIL), 2],
  ["26", "typescript", "`return /re/` at the end of a function",
    L(`it("a", () => { const f = () => { return /${BT}q/; }; expect(f()).toBeTruthy(); });`, TAIL), 2],
  ["27", "typescript", "a template literal followed by a division",
    L(`it("a", () => { const z = ${BT}\${a}${BT} / 2; expect(z).toBe(1); });`, TAIL), 2],
  ["28", "typescript", "a template literal containing slashes",
    L(`it("a", () => { const u = ${BT}a/b/c${BT}; expect(u).toBe("a/b/c"); });`, TAIL), 2],
  ["29", "typescript", "a URL inside a string",
    L(`it("a", () => { const u = "https://x/y"; expect(u).toBeTruthy(); });`, TAIL), 2],
  ["30", "typescript", "a comment carrying slashes, then a division",
    L(`it("a", () => { // a/b/c`, "  const z = 4 / 2; expect(z).toBe(2); });", TAIL), 2],
  ["31", "typescript", "a regex alone on its line with no backtick keeps its parens",
    L(`it("a", () => {`, "  expect(s).toMatch(", "    /^a(b)c$/", "  );", "});", TAIL), 2],
  ["32", "typescript", "a regex carrying both quote kinds",
    L(`const RE = /[${Q}${AP}]/g;`, `it("a", () => { expect(RE.source).toBeTruthy(); });`, TAIL), 2],
  ["33", "typescriptreact", "JSX division and a self-closing tag whose attribute is a slash",
    L(`it("a", () => { render(<div>{a / b}</div>); });`, `it("b", () => { render(<Foo bar="/" />); });`), 2],
  ["34", "typescriptreact", "a JSX closing tag after text",
    L(`it("a", () => { render(<div>hello</div>); });`, `it("b", () => { render(<Foo bar="/" />); });`), 2],
];

for (const [id, lang, what, body, expected] of tsRows) {
  rtest(`[REV70-P3B ${id}] ${lang}: ${what}`, () => {
    const reply = fenced(lang, body);
    const a = now(reply, lang);
    assert.strictEqual(n(a), expected, report("regex-mode reading", reply, a, old(reply, lang), expected));
  });
}

// ===========================================================================
// RULE 1 DIFFERENTIAL. A corpus of CLEAN fenced TypeScript and TSX replies with
// divisions, comment slashes, URLs in strings, JSX and template literals, and no
// regex literal and no test shape inside a literal. Zero moves expected.
// ===========================================================================

rtest("[REV70-P3B 35] rule 1: a clean division/JSX/template corpus does not move", () => {
  const cases = [];
  for (let i = 0; i < 40; i++) {
    const lang = i % 3 === 0 ? "typescriptreact" : "typescript";
    cases.push({
      lang,
      truth: 2,
      body: L(
        `import { helper } from "./helper";`,
        "// see https://example.com/a/b/c for the rate",
        "/* rate = a / b / c */",
        `const RATE = "https://x.example/${i}/path";`,
        `it("divides ${i}", () => {`,
        `  const q = (${i + 2}) / 2 / 1;`,
        `  const t = ${BT}a/${BT} + RATE;`,
        `  expect(q / 1).toBe(${(i + 2) / 2});`,
        "  expect(t).toBeTruthy();",
        "});",
        lang === "typescriptreact"
          ? `it("renders ${i}", () => { render(<div>{RATE}</div>); render(<Foo bar="/" />); });`
          : `it("second ${i}", () => { expect(RATE.length / 1).toBeGreaterThan(0); });`
      ),
    });
  }
  const moves = [];
  const wrong = [];
  for (const c of cases) {
    const reply = fenced(c.lang, c.body);
    const a = now(reply, c.lang);
    const b = old(reply, c.lang);
    if (n(a) !== n(b)) moves.push(report("MOVED", reply, a, b, c.truth));
    if (n(a) !== c.truth) wrong.push(report("WRONG COUNT", reply, a, b, c.truth));
  }
  assert.deepStrictEqual(moves, [], `clean corpus moved on ${moves.length} of ${cases.length}:\n${moves[0] ?? ""}`);
  assert.deepStrictEqual(wrong, [], `clean corpus miscounted:\n${wrong[0] ?? ""}`);
});

rtest("[REV70-P3B 36] rule 1: every move on a regex corpus is a count that is now right", () => {
  const literals = [
    `/${BT}{3}/`,
    `/[${Q}${AP}]/g`,
    `/^${BT}${BT}${BT}(\\w+)$/m`,
    `/a${BT}b/`,
    `/["']|${BT}/gu`,
  ];
  const rows = [];
  for (let i = 0; i < literals.length; i++) {
    const body = L(
      `const RE${i} = ${literals[i]};`,
      `it("one ${i}", () => { expect(RE${i}.source).toBeTruthy(); });`,
      `it("two ${i}", () => { expect(RE${i}.flags).toBeDefined(); });`
    );
    const reply = fenced("typescript", body);
    const a = now(reply, "typescript");
    const b = old(reply, "typescript");
    rows.push({ reply, a, b, truth: 2, moved: n(a) !== n(b) });
  }
  const badMoves = rows.filter((r) => r.moved && n(r.a) !== r.truth);
  const badStays = rows.filter((r) => n(r.a) !== r.truth);
  assert.deepStrictEqual(
    badStays.map((r) => report("count is not the hand count", r.reply, r.a, r.b, r.truth)),
    [],
    "a regex-corpus row does not land on its hand count"
  );
  assert.deepStrictEqual(badMoves, [], "a move landed somewhere other than the hand count");
});

// ===========================================================================
// BYTE IDENTITY OF THE DEFAULT PATH. `tsFileLocalDefinitions` reads the lens
// with `regexLiterals` off; it must answer exactly what the pre-v70 baseline
// answered over every TypeScript file in this repo.
// ===========================================================================

rtest("[REV70-P3B 37] the prompt path's definition set is unchanged over the whole repo", () => {
  const walk = (d, out = []) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      // Dot-prefixed files are the transient facade entries sibling test files
      // write and delete while this one runs; one vanished between the walk and
      // the read once under `node --test`'s parallel run. They are not corpus.
      if (e.name.startsWith(".")) continue;
      if (e.isDirectory()) {
        if (e.name !== "node_modules") walk(p, out);
      } else if (/\.(ts|tsx)$/.test(e.name)) {
        out.push(p);
      }
    }
    return out;
  };
  const files = [...walk(path.join(REPO, "src")), ...walk(path.join(REPO, "test"))];
  assert.ok(files.length > 100, `expected the repo's TypeScript corpus, found ${files.length} files`);
  const diffs = [];
  for (const f of files) {
    const s = fs.readFileSync(f, "utf8");
    const a = [...mod.tsFileLocalDefinitions(s)].sort().join("\n");
    const b = [...mainMod.tsFileLocalDefinitions(s)].sort().join("\n");
    if (a !== b) diffs.push(f);
  }
  assert.deepStrictEqual(diffs, [], `definition set moved on ${diffs.length} of ${files.length} files`);
});

// ===========================================================================
// COST. Linear on the shapes the product actually sees.
// ===========================================================================

rtest("[REV70-P3B 38] cost: 10k divisions, 10k regexes, 10k C# raw strings", () => {
  const run = (reply, lang) => {
    const t0 = process.hrtime.bigint();
    now(reply, lang);
    return Number(process.hrtime.bigint() - t0) / 1e6;
  };
  const divisions = ["it(\"t\", () => {"];
  for (let i = 0; i < 5000; i++) divisions.push(`  const x${i} = a${i} / b${i} / c${i};`);
  divisions.push("});");
  const regexes = ["it(\"t\", () => {"];
  for (let i = 0; i < 10000; i++) regexes.push(`  const r${i} = /ab${i}c/g.source;`);
  regexes.push("});");
  const raws = ["public class T {", "  [Fact] public void A(){}"];
  for (let i = 0; i < 10000; i++) raws.push(`  const string s${i} = ${Q.repeat(3)}body${i}${Q.repeat(3)};`);
  raws.push("}");
  const d = run(fenced("typescript", divisions.join("\n")), "typescript");
  const r = run(fenced("typescript", regexes.join("\n")), "typescript");
  const c = run(fenced("csharp", raws.join("\n")), "csharp");
  assert.ok(
    d < 500 && r < 500 && c < 500,
    `divisions ${d.toFixed(1)}ms, regexes ${r.toFixed(1)}ms, C# raw strings ${c.toFixed(1)}ms`
  );
});

// ===========================================================================
// RULE 5. Fenced and bare agree when both admit; bare may only be narrower.
// A bare reply has to CLOSE as code, so each body ends on a delimiter-only line.
// ===========================================================================

const rule5Rows = [
  ["39", "typescript", L(
    `it("a", () => {`,
    `  const RE = /[${Q}${AP}]/g;`,
    "  expect(RE.source).toBeTruthy();",
    "});",
    `it("b", () => {`,
    "  expect(1).toBe(1);",
    "});"
  )],
  ["40", "typescript", L(
    `it("a", () => {`,
    `  if (x) /${BT}{3}/.exec(s);`,
    "});",
    `it("b", () => {`,
    "  expect(1).toBe(1);",
    "});"
  )],
  ["41", "csharp", L(
    "public class T {",
    `  const string S = ${Q.repeat(3)}a [Fact] b${Q.repeat(3)};`,
    "  [Fact] public void A(){}",
    "}"
  )],
  ["42", "csharp", L(
    "public class T {",
    `  const string S = $$${Q.repeat(3)}{{ ${Q}q${Q} }} [Fact]${Q.repeat(3)};`,
    "  [Fact] public void A(){}",
    "}"
  )],
];

for (const [id, lang, body] of rule5Rows) {
  rtest(`[REV70-P3B ${id}] rule 5 (${lang}): bare is equal or narrower, never wider`, () => {
    const f = now(fenced(lang, body), lang);
    const b = now(body, lang);
    if (b === undefined) return; // narrower in the refusing direction is allowed
    assert.strictEqual(
      n(b),
      n(f),
      `bare admitted a DIFFERENT count from fenced.\n---- REPLY ----\n${body}\n---- END ----\n` +
        `fenced: ${n(f)}\nbare:   ${n(b)}`
    );
  });
}
