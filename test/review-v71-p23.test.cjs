// Adversarial review of session-v71 phases 2 and 3, items B and C.
//
// Scope: the `src/core/instructPostprocess.ts` delta only - `countTsTestCalls`
// and its helpers (`tsParenPairs`, `dottedHead`, `tsTestCallAt`,
// `tsCallTakesTitleAndFunction`, `tsArrowAfterReturnType`), the deletion of
// `BARE_TEST_FUNCTION_SHAPES`, the widened TypeScript `opener`, and the
// template-literal REWIND in `neutralizeTsCommentsAndStrings`. Contract:
// `session-v68/contracts/P8-bare-reply.md`, amendments 4 and 5.
//
// Every row is tagged `[REV71-P23 n]`. A FAILING row is the finding and carries
// the measurement that produced it. A row marked HOLDING is green on purpose:
// it pins a property that was attacked and did not break, so a later fix cannot
// buy a red row with it.
//
// Facades are built read-only with `git archive <ref> src`, the idiom
// `test/review-v70-p3b.test.cjs` uses. 1fb757f is 3.5.0 (the S35 measurement
// baseline) and a81e986 is 3.5.1 (the shipped counter). Nothing here writes the
// index or the working tree.
//
// Run: SKIP_LIVE=1 node --test test/review-v71-p23.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const esbuild = require("esbuild");
const { bundleCore } = require("./.blind-util.cjs");

const REPO = path.join(__dirname, "..");
const REF_350 = "1fb757f415b7dd1f9f956d0b761dfbcd78750ebb";
const REF_351 = "a81e986";

const EXPORTS = `export { extractTestModule, extractTestFunctions, tsFileLocalDefinitions } from `;

const scratch = [];
function facadeAt(ref, tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `c80-rev71p23-${tag}-`));
  scratch.push(dir);
  const tar = execFileSync("git", ["-C", REPO, "archive", ref, "src"], {
    maxBuffer: 256 * 1024 * 1024,
  });
  execFileSync("tar", ["-x", "-C", dir], { input: tar });
  const entry = path.join(dir, "src", "core", "instructPostprocess");
  const { mod, cleanup } = bundleCore(`rev71p23${tag}`, `${EXPORTS}${JSON.stringify(entry)};\n`);
  scratch.push(cleanup);
  return mod;
}

/** The lens itself, which is not exported. `src` is COPIED to a scratch tree and
 *  one export line appended there; the repo is never written. This is the only
 *  way to ask the "index-aligned by construction" claim directly, and item B
 *  depends on that claim. */
function lensProbe() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "c80-rev71p23-lens-"));
  scratch.push(dir);
  fs.cpSync(path.join(REPO, "src"), path.join(dir, "src"), { recursive: true });
  const target = path.join(dir, "src", "core", "instructPostprocess.ts");
  fs.appendFileSync(target, "\nexport const __lens = neutralizeTsCommentsAndStrings;\n");
  const entry = path.join(dir, "entry.ts");
  fs.writeFileSync(entry, `export { __lens } from ${JSON.stringify(target.replace(/\.ts$/, ""))};\n`);
  const outfile = path.join(dir, "lens.cjs");
  esbuild.buildSync({ entryPoints: [entry], bundle: true, outfile, format: "cjs", platform: "node" });
  return require(outfile).__lens;
}

let work = {};
let m350 = {};
let m351 = {};
let lens;
let harvest;
let corpus;
let harnessError;
try {
  const built = bundleCore(
    "rev71p23work",
    `export { extractTestModule, extractTestFunctions, tsFileLocalDefinitions } from "../src/core/instructPostprocess";\n`
  );
  work = built.mod;
  scratch.push(built.cleanup);
  m350 = facadeAt(REF_350, "350");
  m351 = facadeAt(REF_351, "351");
  lens = lensProbe();
} catch (e) {
  harnessError = e;
}

// The two measurement helpers the implementation phase left in `test/`. They are
// the 3537-reply harvest and the 1050-reply fenced corpus. Rows that need them
// SKIP rather than fail if they move again, so this file cannot go red for a
// reason that is not a defect in the code under review.
let corpusError;
try {
  harvest = require("./fixtures/v71-counter-harvest.json");
  corpus = require("./.v71-fenced-corpus.cjs");
} catch (e) {
  corpusError = e;
}

test.after(() => {
  for (const s of scratch) {
    if (typeof s === "function") {
      s();
    } else {
      fs.rmSync(s, { recursive: true, force: true });
    }
  }
});

const rtest = (name, fn) =>
  test(name, (ctx) => {
    if (harnessError) return ctx.skip(`harness failed: ${harnessError}`);
    return fn(ctx);
  });

const ctest = (name, fn) =>
  test(name, (ctx) => {
    if (harnessError) return ctx.skip(`harness failed: ${harnessError}`);
    if (corpusError) return ctx.skip(`corpus helpers missing: ${corpusError}`);
    return fn(ctx);
  });

const L = (...lines) => lines.join("\n");
const FENCE = "```";
const BT = "`";
const fenced = (tag, body) => `${FENCE}${tag}\n${body}\n${FENCE}\n`;

const TS_IDS = new Set(["typescript", "typescriptreact", "javascript", "javascriptreact"]);
const callOn = (impl, id, reply) =>
  id === "rust" ? impl.extractTestModule(reply) : impl.extractTestFunctions(reply, id);
const same = (a, b) =>
  (a === undefined && b === undefined) ||
  (a !== undefined && b !== undefined && a.text === b.text && a.testCount === b.testCount);
const show = (r) => (r === undefined ? "REFUSED" : `count=${r.testCount}`);

const three = (body, id = "typescript") => ({
  work: work.extractTestFunctions(fenced("typescript", body), id),
  m351: m351.extractTestFunctions(fenced("typescript", body), id),
  m350: m350.extractTestFunctions(fenced("typescript", body), id),
});

const report = (label, reply, rows) =>
  `${label}\n---- REPLY ----\n${reply}\n---- END REPLY ----\n` +
  rows.map(([k, v]) => `${k.padEnd(14)} ${v}`).join("\n");

rtest("[REV71-P23 0] harness: three counters and the lens probe all build", () => {
  assert.strictEqual(harnessError, undefined, `harness failed: ${harnessError}`);
  for (const [n, m] of [["work", work], ["3.5.0", m350], ["3.5.1", m351]]) {
    assert.strictEqual(typeof m.extractTestFunctions, "function", `${n} has no extractTestFunctions`);
  }
  assert.strictEqual(typeof lens, "function", "lens probe did not export the lens");
});

// ===========================================================================
// FINDING 1 (HIGH). The widened TypeScript `opener` admits a bare reply whose
// FIRST LINE IS AN ENGLISH SENTENCE, and the sentence is spliced into the test
// file.
//
// Mechanism. Item B added `(?:[A-Za-z_$][\w$]*\s*\.\s*)?` in front of
// `(?:describe|it|test)\s*[.(]` so a bare reply may START with `Deno.test(`.
// `bareCodeBlock` tests that pattern against the first non-blank line and
// nothing else, and `text` is then the WHOLE reply from that line down. A prose
// sentence that opens with a dotted runner name - "Deno.test() is the runner
// used below." - now passes the opener, passes rule 3 (its parens balance) and
// passes rule 9 (the tail is `});`), so the reply is admitted with the sentence
// as line 1 of the source file.
//
// This is the family P8 amendment 3 closed by measurement: "four leading
// sentences that the openers accepted", all confirmed admits, all spliced into a
// source file. Rule 7 refuses prose and amendment 2 extended rule 9 to LEADING
// prose. Both baselines refuse these two replies.
// ===========================================================================

const PROSE_DENO = L(
  "Deno.test() is the runner used below.",
  'Deno.test("adds", () => {',
  "  assertEquals(add(1, 2), 3);",
  "});"
);
const PROSE_QUNIT = L(
  "QUnit.test(name, fn) takes a title and a callback.",
  'it("adds", () => {',
  "  expect(add(1, 2)).toBe(3);",
  "});"
);

rtest("[REV71-P23 1] the widened opener splices a leading PROSE sentence into the test file", () => {
  const admitted = [];
  for (const reply of [PROSE_DENO, PROSE_QUNIT]) {
    const w = work.extractTestFunctions(reply, "typescript");
    const a = m351.extractTestFunctions(reply, "typescript");
    const b = m350.extractTestFunctions(reply, "typescript");
    if (w !== undefined) {
      admitted.push(
        report("BARE reply, rule 7 and rule 9: prose is refused", reply, [
          ["working tree", `${show(w)}  text line 1: ${JSON.stringify(w.text.split("\n")[0])}`],
          ["3.5.1", show(a)],
          ["3.5.0", show(b)],
          ["hand", "REFUSED - line 1 is an English sentence, not code"],
        ])
      );
    }
  }
  assert.strictEqual(admitted.length, 0, admitted.join("\n\n"));
});

rtest("[REV71-P23 2] HOLDING: the same two replies WITHOUT the leading sentence are admitted", () => {
  // The widening does its job. The defect in row 1 is the opener being the only
  // gate on the first line, not the dotted head being admitted at all.
  for (const reply of [PROSE_DENO, PROSE_QUNIT].map((r) => r.split("\n").slice(1).join("\n"))) {
    const w = work.extractTestFunctions(reply, "typescript");
    assert.notStrictEqual(w, undefined, `bare reply refused:\n${reply}`);
    assert.strictEqual(w.testCount, 1, `bare reply counted ${w && w.testCount}:\n${reply}`);
  }
});

// ===========================================================================
// FINDING 2 (MED). Item C's rewind fires only for an ODD number of stray
// backticks. Two declined regexes each carrying a backtick PAIR UP into one
// spurious template, the template closes, no rewind happens, and every test
// between them is still blanked.
//
// Mechanism. The rewind is entered on `!closed`. A backtick that opens a
// template scans forward and takes the NEXT backtick in the reply as its close,
// wherever that is. So only the last unmatched backtick is ever `!closed`. A
// module that tests fence handling - the exact module goal item C is written
// about - carries an OPENING fence regex and a CLOSING fence regex, which is
// two, and stays refused.
// ===========================================================================

const FENCE_MOD = L("const OPEN = new RegExp(", `  /^${BT}{3}/`, ");");
const T = (n) => `it("t${n}", () => { expect(${n}).toBe(${n}); });`;

rtest("[REV71-P23 3] two backtick-bearing declined regexes still refuse the whole module", () => {
  const body = L(FENCE_MOD, T(1), T(2), T(3), FENCE_MOD);
  const r = three(body);
  assert.strictEqual(
    r.work === undefined ? "REFUSED" : r.work.testCount,
    3,
    report("item C, the two-fence-regex module", body, [
      ["working tree", show(r.work)],
      ["3.5.1", show(r.m351)],
      ["3.5.0", show(r.m350)],
      ["hand", "3 - three it() calls at statement position"],
      ["note", "one copy of the same regex block counts 3; two copies refuse"],
    ])
  );
});

rtest("[REV71-P23 4] the rewind's reach is one backtick, measured over k=1..8", () => {
  const ALONE = (n) =>
    L(`it("m${n}", () => {`, "  expect(s).toMatch(", `    /^${BT}{3}/`, "  );", "});");
  const rows = [];
  let firstBad;
  for (let k = 1; k <= 8; k++) {
    const parts = [];
    for (let j = 1; j <= k; j++) parts.push(ALONE(j));
    parts.push('it("tail", () => { expect(1).toBe(1); });');
    const body = parts.join("\n");
    const r = three(body);
    const hand = k + 1;
    const got = r.work === undefined ? "REFUSED" : r.work.testCount;
    rows.push(`k=${k} hand=${hand} work=${show(r.work)} 3.5.1=${show(r.m351)} 3.5.0=${show(r.m350)}`);
    if (got !== hand && firstBad === undefined) firstBad = k;
  }
  assert.strictEqual(
    firstBad,
    undefined,
    `k alone-on-its-line regexes, each carrying one backtick, plus one tail test.\n` +
      `Every reply is well formed and every test is at statement position.\n${rows.join("\n")}`
  );
});

// ===========================================================================
// FINDING 3 (MED). `test(name, options, fn)` - the three-argument form of
// node:test and of vitest - is refused. Rule 11 asks for a title, a comma and
// then a FUNCTION, and an options object sits between them.
//
// node:test is the runner this repository's own suite runs on, and
// `test(name, { skip: true }, fn)` and `test(name, { timeout: 100 }, fn)` are
// both documented forms. Amendment 5's declared limits name the variable title
// and Deno's object form; they do not name this. Amendment 5's stated expected
// direction for the rule-1 move is "only replies whose only `.test(` is a regex
// call or a `function test(` declaration move" - this is a real test reply
// moving to refusal.
// ===========================================================================

rtest("[REV71-P23 5] node:test / vitest `test(name, options, fn)` is refused", () => {
  const bodies = [
    'test("adds", { timeout: 100 }, () => { assert.strictEqual(add(1, 2), 3); });',
    'test("adds", { skip: true }, (t) => { t.assert.ok(add(1, 2)); });',
    'it("adds", { retry: 2 }, async () => { expect(add(1, 2)).toBe(3); });',
  ];
  const wrong = [];
  for (const body of bodies) {
    const r = three(body);
    if ((r.work === undefined ? "REFUSED" : r.work.testCount) !== 1) {
      wrong.push(
        report("rule 11 against the documented three-argument runner form", body, [
          ["working tree", show(r.work)],
          ["3.5.1", show(r.m351)],
          ["3.5.0", show(r.m350)],
          ["hand", "1"],
        ])
      );
    }
  }
  assert.strictEqual(wrong.length, 0, wrong.join("\n\n"));
});

// ===========================================================================
// FINDING 4 (MED). The rewind admits a truncated IMPLEMENTATION, and a
// truncated PROSE template, as a test file.
//
// The cost amendment 5 and the code comment declare is "a fenced reply
// genuinely cut mid-template now counts the tests AFTER the cut". What the
// rewind actually counts here is the template's own CONTENT: a scaffolding
// function's emitted source, and a usage string. In all three replies below
// there is no test anywhere - the counted `it(` is inside what the author wrote
// as text - and 3.5.1 refused all three.
//
// Reachability is on the backend this contract exists for: P8's own falsification
// notes record that the Claude Code CLI ignores maxTokens and one measured reply
// ran to 2,809 output tokens.
// ===========================================================================

rtest("[REV71-P23 6] the rewind counts a truncated template's CONTENT as tests", () => {
  const cases = {
    "a scaffolder cut mid-template": L(
      "export function scaffold(name: string): string {",
      `  return ${BT}it("\${name}", () => {`
    ),
    "a usage string cut mid-template": L(
      "export function usage(): string {",
      `  return ${BT}Usage:`,
      '  it("name", () => {}) declares a test.'
    ),
  };
  const admitted = [];
  for (const [label, body] of Object.entries(cases)) {
    const r = three(body);
    if (r.work !== undefined) {
      admitted.push(
        report(`rule 6 / rule 7: ${label} carries no test`, body, [
          ["working tree", show(r.work)],
          ["3.5.1", show(r.m351)],
          ["3.5.0", show(r.m350)],
          ["hand", "REFUSED - every `it(` here is inside a string the author wrote"],
        ])
      );
    }
  }
  assert.strictEqual(admitted.length, 0, admitted.join("\n\n"));
});

// ===========================================================================
// FINDING 5 (MED). The `!dotted` fallback counts a plain implementation.
//
// `tsTestCallAt` answers `!dotted` when the call's `(` has no matching `)` in the
// neutralised text, which reverts rule 11 to the NAME rule it replaced for every
// undotted head. An unmatched `(` does not need a mis-lex to appear: a regex
// ALONE ON ITS LINE is declined by the shared rule (that is `aloneOnItsLine`,
// pinned as a heuristic in goal item E), so its characters are emitted as CODE
// and a `\(` inside it consumes the `)` that belonged to the call above it.
//
// The implementation below has no test in it. It is a validator with a local
// predicate named `test`, and rule 11 is supposed to refuse it because its
// argument is a regex literal, not a title-and-function.
// ===========================================================================

const FALLBACK_IMPL = L(
  "export function validate(s: string): boolean {",
  "  const test = (re: RegExp) => re.test(s);",
  "  return test(",
  "    /^\\(/",
  "  );",
  "}"
);

rtest("[REV71-P23 7] the `!dotted` fallback counts an implementation with no test in it", () => {
  const r = three(FALLBACK_IMPL);
  assert.strictEqual(
    r.work,
    undefined,
    report("rule 11: a test call takes a title and a function", FALLBACK_IMPL, [
      ["working tree", show(r.work)],
      ["3.5.1", show(r.m351)],
      ["3.5.0", show(r.m350)],
      ["hand", "REFUSED - `test(` here takes a regex literal"],
      ["mechanism", "the alone-on-its-line regex is declined, its `(` is code, and it eats the `)`"],
    ])
  );
});

// ===========================================================================
// FINDING 6 (LOW). `tsArrowAfterReturnType` gives up after 200 characters, so a
// long typed return annotation refuses a real test. Measured threshold below.
// ===========================================================================

rtest("[REV71-P23 8] a return type longer than 200 characters refuses a real test", () => {
  const mk = (len) => {
    let t = "Promise<{ ";
    let i = 0;
    while (t.length < len - 4) {
      t += `k${i}: number; `;
      i++;
    }
    return `${t}}>`;
  };
  const rows = [];
  let firstBad;
  for (const target of [120, 160, 190, 205, 240]) {
    const rt = mk(target);
    const body = `it("a", async (): ${rt} => { expect(1).toBe(1); });`;
    const r = three(body);
    rows.push(`return type ${String(rt.length).padStart(4)} chars: work=${show(r.work)} 3.5.1=${show(r.m351)}`);
    if (r.work === undefined && firstBad === undefined) firstBad = rt.length;
  }
  assert.strictEqual(
    firstBad,
    undefined,
    `A typed arrow is rule 11's own listed shape. The walk is bounded at colon+200.\n${rows.join("\n")}`
  );
});

// ===========================================================================
// FINDING 7 (LOW). Two more real shapes rule 11 refuses and 3.5.1 counted: a
// GENERIC arrow callback, and a title built by concatenation. Amendment 5's
// declared limits name the variable title; the concatenated title is the same
// family and is not named, and the generic arrow is not named at all.
// ===========================================================================

rtest("[REV71-P23 9] a generic arrow callback and a concatenated title are refused", () => {
  const cases = {
    "generic arrow callback": 'it("a", <T>(x: T) => { expect(x).toBeDefined(); });',
    "concatenated title": 'it("returns " + n + " rows", () => { expect(rows).toHaveLength(n); });',
  };
  const wrong = [];
  for (const [label, body] of Object.entries(cases)) {
    const r = three(body);
    if ((r.work === undefined ? "REFUSED" : r.work.testCount) !== 1) {
      wrong.push(
        report(`rule 11 vs ${label}`, body, [
          ["working tree", show(r.work)],
          ["3.5.1", show(r.m351)],
          ["3.5.0", show(r.m350)],
          ["hand", "1"],
        ])
      );
    }
  }
  assert.strictEqual(wrong.length, 0, wrong.join("\n\n"));
});

// ===========================================================================
// HOLDING ROWS. Everything below was attacked and did not break.
// ===========================================================================

rtest("[REV71-P23 10] HOLDING: the lens stays index-aligned with its input", () => {
  // Item B reads structure from the neutralised text and the title from the RAW
  // block, aligned "by construction". 20,000 random strings over an alphabet
  // built to break the lexer - backtick, quote, backslash, slash, star, CR, LF,
  // tab, BOM, a non-BMP character and a LONE SURROGATE - in both lens modes.
  const ALPH = [
    BT, '"', "'", "\\", "/", "*", "\n", "\r", "\t", "(", ")", "{", "}", "a", "1", " ",
    "﻿", "\u{1F389}", "\uD800", "$", "<", ">", "=", ";", ",", "+", "-", "[", "]",
  ];
  let rng = 12345;
  const rnd = () => {
    rng = (rng * 1103515245 + 12345) & 0x7fffffff;
    return rng / 0x7fffffff;
  };
  let bad;
  let cases = 0;
  for (let t = 0; t < 20000; t++) {
    let s = "";
    const len = 1 + Math.floor(rnd() * 40);
    for (let k = 0; k < len; k++) s += ALPH[Math.floor(rnd() * ALPH.length)];
    for (const opts of [undefined, { regexLiterals: true }]) {
      cases++;
      const out = lens(s, opts);
      if (out.length !== s.length && bad === undefined) bad = [s, out, opts];
    }
  }
  assert.strictEqual(
    bad,
    undefined,
    bad && `lens moved length: ${JSON.stringify(bad[0])} -> ${JSON.stringify(bad[1])} opts=${JSON.stringify(bad[2])}`
  );
  // And the shapes the review was asked for, named one by one.
  const named = {
    "non-BMP title": 'it("\u{1F389}", () => {});',
    "CRLF": 'it("a", () => {});\r\n',
    "BOM": '﻿it("a", () => {});',
    "lone surrogate": 'it("\uD800", () => {});',
    "tab": 'it("a\tb", () => {});',
    "trailing backslash": 'it("a", () => {});\\',
    "unclosed template at EOF": `it("a", () => {});${BT}`,
  };
  for (const [label, s] of Object.entries(named)) {
    assert.strictEqual(lens(s, { regexLiterals: true }).length, s.length, `${label}: length moved`);
  }
  assert.ok(cases === 40000, `expected 40000 fuzz cases, ran ${cases}`);
});

rtest("[REV71-P23 11] HOLDING: a title cannot be forged out of a comment or a regex", () => {
  // The title question is asked of the RAW block. For a non-literal quote to
  // answer it, that quote must be the first non-whitespace RAW character after
  // the `(` and must be BLANK in the neutralised text. Every construct that
  // blanks a quote (a comment, a regex, an enclosing literal) puts a
  // non-whitespace character in front of it, so the raw skip stops there first.
  const refused = [
    'it(/* "a" */ x, () => {});',
    'it(/"/, () => {});',
    "it(x /* \"a\" */, () => {});",
    'const s = "it(\\"a\\", () => {});";',
    "// it(\"a\", () => {});",
  ];
  for (const body of refused) {
    const r = three(L("export const z = 1;", body));
    assert.strictEqual(r.work, undefined, report("forged title", body, [["working tree", show(r.work)]]));
  }
});

ctest("[REV71-P23 12] HOLDING: Go, Python, C# and Rust do not move against 3.5.1", () => {
  const moves = {};
  let checked = 0;
  for (const r of harvest) {
    if (TS_IDS.has(r.languageId)) continue;
    checked++;
    const w = callOn(work, r.languageId, r.reply);
    const a = callOn(m351, r.languageId, r.reply);
    if (!same(w, a)) {
      moves[r.languageId] ??= [];
      if (moves[r.languageId].length < 3) moves[r.languageId].push([r.reply, show(w), show(a)]);
    }
  }
  for (const id of corpus.CORPUS_IDS) {
    if (TS_IDS.has(id)) continue;
    for (let i = 0; i < corpus.PER_LANG; i++) {
      const hs = corpus.HIDERS[id];
      const h = hs[i % hs.length];
      const body = i % 2 === 0 ? corpus.cleanBody(id, i) : corpus.plant(id, i, h[1](i));
      const reply = corpus.fenced(corpus.FENCE_TAG[id], body);
      checked++;
      const w = callOn(work, id, reply);
      const a = callOn(m351, id, reply);
      if (!same(w, a)) {
        moves[id] ??= [];
        if (moves[id].length < 3) moves[id].push([reply, show(w), show(a)]);
      }
    }
  }
  const total = Object.values(moves).reduce((n, v) => n + v.length, 0);
  assert.strictEqual(
    total,
    0,
    `non-TypeScript replies checked: ${checked}\n` +
      Object.entries(moves)
        .map(([k, v]) => v.map(([reply, w, a]) => `[${k}] work=${w} 3.5.1=${a}\n${reply}`).join("\n"))
        .join("\n")
  );
  assert.ok(checked > 3000, `expected more than 3000 non-TS replies, checked ${checked}`);
});

ctest("[REV71-P23 13] HOLDING: rule 5 / rule 12 over 546 real TypeScript replies", () => {
  // Every harvested TypeScript reply that is exactly one clean fenced block,
  // answered fenced and then bare. Rule 5: the two must agree. Amendment 4:
  // the bare lens may be NARROWER, never wider.
  const strip = (reply) => {
    const lines = reply.replace(/\s+$/, "").split("\n");
    if (!lines[0].trim().startsWith(FENCE)) return undefined;
    if (lines[lines.length - 1].trim() !== FENCE) return undefined;
    const body = lines.slice(1, -1);
    if (body.some((l) => l.trim().startsWith(FENCE) || l.trim().startsWith("~~~"))) return undefined;
    return body.join("\n");
  };
  const seen = new Set();
  let n = 0;
  let bothAdmit = 0;
  let bareNarrower = 0;
  const diverged = [];
  const bareWider = [];
  for (const r of harvest) {
    if (!TS_IDS.has(r.languageId)) continue;
    const bare = strip(r.reply);
    if (bare === undefined || seen.has(bare)) continue;
    seen.add(bare);
    n++;
    const fc = work.extractTestFunctions(r.reply, r.languageId);
    const bc = work.extractTestFunctions(bare, r.languageId);
    if (fc && bc) {
      bothAdmit++;
      if (fc.testCount !== bc.testCount && diverged.length < 5) diverged.push([bare, fc.testCount, bc.testCount]);
    } else if (fc && !bc) {
      bareNarrower++;
    } else if (!fc && bc && bareWider.length < 5) {
      bareWider.push(bare);
    }
  }
  assert.ok(n >= 40, `the review asked for at least 40 real TypeScript replies; found ${n}`);
  assert.deepStrictEqual(
    { diverged: diverged.length, bareWider: bareWider.length },
    { diverged: 0, bareWider: 0 },
    `distinct TS replies: ${n}, both admit: ${bothAdmit}, bare narrower: ${bareNarrower}\n` +
      diverged.map(([b, f, x]) => `fenced=${f} bare=${x}\n${b}`).join("\n") +
      bareWider.map((b) => `BARE ADMITS, FENCED REFUSES\n${b}`).join("\n")
  );
});

ctest("[REV71-P23 14] HOLDING: every TypeScript move against 3.5.1 is in the declared direction", () => {
  // Amendment 5: only replies whose only `.test(` is a regex call or a
  // `function test(` declaration move, and they move to refusal - plus the three
  // dotted runners, which move to admission. The kinds are counted here so a
  // later change that adds a fourth kind goes red.
  const kinds = {};
  const admits = [];
  for (const r of harvest) {
    if (!TS_IDS.has(r.languageId)) continue;
    const w = callOn(work, r.languageId, r.reply);
    const a = callOn(m351, r.languageId, r.reply);
    if (same(w, a)) continue;
    const kind =
      a === undefined ? `REFUSED->${show(w)}` : w === undefined ? `${show(a)}->REFUSED` : `${show(a)}->${show(w)}`;
    kinds[kind] = (kinds[kind] || 0) + 1;
    if (a === undefined) admits.push(r.reply);
  }
  const down = Object.entries(kinds).filter(([k]) => k.startsWith("count") && !k.endsWith("REFUSED"));
  const summary = JSON.stringify(kinds, null, 1);
  // Every new admit is a dotted runner head. That is S70-10 closing.
  for (const reply of admits) {
    assert.ok(
      /(?:Deno|QUnit|t)\s*\.\s*test\s*\(/.test(reply),
      `a reply admitted that 3.5.1 refused and that is not a dotted runner:\n${reply}\n${summary}`
    );
  }
  assert.ok(Object.keys(kinds).length > 0, "expected the TypeScript counter to move at all");
  assert.ok(down.length >= 1, `expected regex-call counts to fall\n${summary}`);
});

rtest("[REV71-P23 15] HOLDING: the 544ms quadratic stayed closed", () => {
  const ms = (fn) => {
    const t = process.hrtime.bigint();
    fn();
    return Number(process.hrtime.bigint() - t) / 1e6;
  };
  // [label, reply, budget in ms]. The budget is generous against a loaded
  // runner and still an order of magnitude under the 544ms amendment 5 measured
  // for the quadratic on the 20,000-head shape.
  const shapes = [
    ["20,000 `it(` heads, no closers", fenced("typescript", "it(".repeat(20000)), 250],
    ["300,000 `it(` heads, no closers", fenced("typescript", "it(".repeat(300000)), 1500],
    ["20,000 RE.test(x) calls", fenced("typescript", "RE.test(x);\n".repeat(20000)), 250],
    [
      "1MB of real tests",
      fenced(
        "typescript",
        Array.from({ length: 50000 }, (_, i) => `it("t${i}", () => { expect(${i}).toBe(${i}); });`).join("\n")
      ),
      1500,
    ],
    [
      "1MB, 250k paren pairs, no test name",
      fenced(
        "typescript",
        Array.from({ length: 62500 }, (_, i) => `const v${i} = g(h(i(j(${i}))));`).join("\n")
      ),
      1500,
    ],
  ];
  const rows = [];
  for (const [label, reply, budget] of shapes) {
    work.extractTestFunctions(reply, "typescript");
    const t = ms(() => work.extractTestFunctions(reply, "typescript"));
    const base = ms(() => m351.extractTestFunctions(reply, "typescript"));
    rows.push(`${label.padEnd(38)} work=${t.toFixed(1)}ms 3.5.1=${base.toFixed(1)}ms budget=${budget}ms`);
    assert.ok(t < budget, `${label} took ${t.toFixed(1)}ms on the request thread\n${rows.join("\n")}`);
  }
  // Linear, not quadratic: 15x the heads must not cost 100x the time.
  const small = ms(() => work.extractTestFunctions(shapes[0][1], "typescript"));
  const large = ms(() => work.extractTestFunctions(shapes[1][1], "typescript"));
  assert.ok(
    large < small * 60 + 50,
    `15x the input cost ${(large / small).toFixed(1)}x the time\n${rows.join("\n")}`
  );
});

rtest("[REV71-P23 16] HOLDING: the rewind terminates, is bounded, and stays affordable", () => {
  const ms = (fn) => {
    const t = process.hrtime.bigint();
    fn();
    return Number(process.hrtime.bigint() - t) / 1e6;
  };
  // Each rewind resumes at openedAt + 1, so the cursor strictly advances and no
  // rewind can repeat a position. The shapes below are the ones that make a
  // template fail to close over and over: an escaped backtick pair, and a
  // repetition loop of bare backticks.
  const shapes = {
    "17 escaped-backtick rewinds + 500KB tail":
      `${BT}\\`.repeat(17) +
      "\n" +
      Array.from({ length: 25000 }, (_, i) => `it("t${i}", () => { expect(${i}).toBe(${i}); });`).join("\n"),
    "300,000 lone backticks": BT.repeat(300000),
    "150,000 escaped-backtick pairs": `${BT}\\`.repeat(150000),
  };
  const rows = [];
  for (const [label, body] of Object.entries(shapes)) {
    const reply = fenced("typescript", body);
    const t = ms(() => work.extractTestFunctions(reply, "typescript"));
    rows.push(`${label.padEnd(42)} ${t.toFixed(1)}ms`);
    assert.ok(t < 1500, `${label} took ${t.toFixed(1)}ms\n${rows.join("\n")}`);
  }
  // REWRITTEN by the phase 2/3 triage. The rewind this bound belonged to is
  // gone; P8 amendment 5's addendum replaces it with the declined-REGION rule,
  // which has no per-reply counter to oscillate around. The rows are kept
  // because a run of stray backticks is still the shape that costs the most, and
  // the answer must not depend on how many there are.
  const at = (k) =>
    show(
      work.extractTestFunctions(
        fenced("typescript", `${BT}\\`.repeat(k) + '\nit("a", () => { expect(1).toBe(1); });'),
        "typescript"
      )
    );
  for (const k of [1, 2, 3, 15, 16, 17, 18, 64]) {
    assert.strictEqual(
      at(k),
      at(k + 1),
      `the answer moved between ${k} and ${k + 1} stray backticks: ${at(k)} vs ${at(k + 1)}`
    );
  }
});

rtest("[REV71-P23 17] HOLDING: the prompt path's definition finder does not move", () => {
  // The rewind is `regexLiterals` only, and `tsFileLocalDefinitions` reads the
  // same function with the rule off. Sources chosen so the rewind WOULD fire if
  // the mode leaked.
  const sources = [
    `export function a() {}\nconst b = ${BT}unclosed\nexport class C {}`,
    `const RE =\n  /^${BT}{3}/\nexport function d() {}`,
    `export const e = ${BT}x${BT};\nexport function f() {}`,
    `function g() {}\n${`${BT}\\`.repeat(20)}\nexport class H {}`,
  ];
  for (const s of sources) {
    const a = [...work.tsFileLocalDefinitions(s)].sort().join(",");
    const b = [...m351.tsFileLocalDefinitions(s)].sort().join(",");
    assert.strictEqual(a, b, `prompt-path definitions moved\n${s}\nwork: ${a}\n3.5.1: ${b}`);
  }
});

rtest("[REV71-P23 18] HOLDING: the chain walk refuses rather than admits past its bound", () => {
  const at = (k) => three(`it${".a".repeat(k)}("x", () => { expect(1).toBe(1); });`);
  assert.strictEqual(at(30).work.testCount, 1, "a 30-segment chain should still answer");
  assert.strictEqual(at(40).work, undefined, "a 40-segment chain must refuse, not admit");
  // A blanked literal is whitespace to the walk. That is what makes the tagged
  // template form fall out, and it counts ONCE, not twice.
  const tagged = three(`test.each${BT}\n  a | b\n  \${1} | \${2}\n${BT}("adds", ({ a, b }) => { expect(a).toBeLessThan(b); });`);
  assert.strictEqual(tagged.work.testCount, 1, `tagged template counted ${show(tagged.work)}`);
});

rtest("[REV71-P23 19] HOLDING: the runner shapes rule 11 promises still count", () => {
  const rows = {
    "plain it": 'it("a", () => { expect(1).toBe(1); });',
    "Deno.test": 'Deno.test("adds", () => { assertEquals(add(1, 2), 3); });',
    "QUnit.test": 'QUnit.test("adds", (assert) => { assert.equal(add(1, 2), 3); });',
    "t.test": 't.test("adds", (t) => { t.assert.ok(1); });',
    "it.only": 'it.only("a", () => { expect(1).toBe(1); });',
    "it.each array": 'it.each([[1, 2]])("adds %i", (a, b) => { expect(a).toBeLessThan(b); });',
    "playwright fixture": 'test("a", async ({ page }) => { await page.goto("/"); });',
    "mocha this context": 'it("a", function (this: Mocha.Context) { this.timeout(1); });',
    "jest timeout third arg": 'it("a", () => { expect(1).toBe(1); }, 10000);',
    "typed arrow": 'it("a", async (): Promise<void> => { await Promise.resolve(); });',
    "generic return type": 'it("a", (): Map<string, number> => new Map());',
    "object return type": 'it("a", (): { a: number } => ({ a: 1 }));',
    "template title": `it(${BT}a \${1}${BT}, () => { expect(1).toBe(1); });`,
    "title with a paren in it": 'it("a) b", () => { expect(1).toBe(1); });',
    "async function expression": 'it("a", async function () { expect(1).toBe(1); });',
  };
  for (const [label, body] of Object.entries(rows)) {
    const r = three(body);
    assert.strictEqual(r.work && r.work.testCount, 1, report(label, body, [["working tree", show(r.work)]]));
  }
  // And the refusals rule 11 exists for, on BOTH paths (rule 12).
  const refuse = {
    "the goal's implementation": "export function isSlug(s: string) {\n  return /^[a-z-]+$/.test(s);\n}",
    "a bare regex call": "export function ok(s: string) {\n  return RE.test(s);\n}",
    "function test( declaration": "export function test(value: string): boolean {\n  return value.length > 0;\n}",
  };
  for (const [label, body] of Object.entries(refuse)) {
    const r = three(body);
    assert.strictEqual(r.work, undefined, report(`${label} (fenced)`, body, [["working tree", show(r.work)]]));
    assert.strictEqual(
      work.extractTestFunctions(body, "typescript"),
      undefined,
      report(`${label} (bare)`, body, [["working tree", show(work.extractTestFunctions(body, "typescript"))]])
    );
  }
});

ctest("[REV71-P23 20] HOLDING: the 1050-reply fenced corpus does not move against 3.5.1", () => {
  let checked = 0;
  const moves = [];
  for (const id of corpus.CORPUS_IDS) {
    for (let i = 0; i < corpus.PER_LANG; i++) {
      const hs = corpus.HIDERS[id];
      const h = hs[i % hs.length];
      const body = i % 2 === 0 ? corpus.cleanBody(id, i) : corpus.plant(id, i, h[1](i));
      const reply = corpus.fenced(corpus.FENCE_TAG[id], body);
      checked++;
      const w = callOn(work, id, reply);
      const a = callOn(m351, id, reply);
      if (!same(w, a) && moves.length < 5) moves.push(`[${id}] work=${show(w)} 3.5.1=${show(a)}\n${reply}`);
    }
  }
  assert.strictEqual(moves.length, 0, `replies checked: ${checked}\n${moves.join("\n")}`);
  assert.strictEqual(checked, 1050, `expected 1050 replies, ran ${checked}`);
});
