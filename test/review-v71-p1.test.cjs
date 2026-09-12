// Adversarial review evidence for session-v71 phase 1, item A: `bindsName`
// (P9 amendment 4 rule 12, the `let mut` walk) and `skipSpaceAndComments` +
// the new element head in `rowsFromList` (rule 13, a comment is not a row).
//
// WHITE BOX. Every row is a claim with a runnable case behind it. A RED row
// names a defect; a row tagged HOLDING is the opposite — a property that was
// attacked and did not break, kept so a later change cannot quietly take it
// away.
//
// Reviewed artifact, pinned:
//   src/core/tddTable.ts     md5 e3ca2f76dad838f1e4d989da19385485
//   src/core/tddLang.ts      md5 711a8f5a776faa5104d3db3b9420af3a
//   src/core/testAssembly.ts md5 b7a346f9fe04c80481f72cd4431018d5
//
// ONE baseline is quoted below and it was measured, not reasoned: "HEAD" is
// d53b71d, the commit the working tree's tddTable.ts is uncommitted on top of,
// extracted read-only with `git archive` into a scratch directory and bundled
// beside the working tree's own build. Nothing here touches the index or the
// working tree's src.
//
// Rule 13 is the reason the baseline matters TWICE over. Amendment 4 wrote the
// rule this session, so a shape that is wrong at HEAD and equally wrong now is
// not "pre-existing, out of scope": it is the new rule, half implemented. Rows
// 17 to 20 are that case and each names the HEAD measurement in its message.
//
// Rules cited are from session-v68/contracts/P9-annotated-table.md, amendment 4
// unless another is named.
//
// Run: SKIP_LIVE=1 node --test test/review-v71-p1.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { bundleCore } = require("./.blind-util.cjs");

// ===========================================================================
// Facade 1: the working tree, with the phase 1 change in it.
// ===========================================================================

let mod = {};
let cleanup = () => {};
let bundleError;
try {
  ({ mod, cleanup } = bundleCore(
    "rev71p1",
    `export { tddLangFor, blankExpectedValues } from "../src/core/tddLang";\n`
  ));
} catch (e) {
  bundleError = e;
}

// ===========================================================================
// Facade 2: d53b71d, the pre-change answer. A COMMIT and not a ref: `main` is
// this code once the branch merges, and a differential against itself proves
// nothing. ci.yml fetches full history so the hash is always present.
// ===========================================================================

const REPO = path.join(__dirname, "..");
const PRE_V71_P1 = "d53b71d90c6ced49c540b09724f83291b07ca76e";
let headMod = {};
let headCleanup = () => {};
let headError;
let headDir;
try {
  headDir = fs.mkdtempSync(path.join(os.tmpdir(), "c80-v71p1-head-"));
  const tar = execFileSync("git", ["-C", REPO, "archive", PRE_V71_P1, "src"], {
    maxBuffer: 256 * 1024 * 1024,
  });
  execFileSync("tar", ["-x", "-C", headDir], { input: tar });
  const entry = path.join(headDir, "src", "core", "tddLang");
  ({ mod: headMod, cleanup: headCleanup } = bundleCore(
    "rev71p1head",
    `export { tddLangFor, blankExpectedValues } from ${JSON.stringify(entry)};\n`
  ));
} catch (e) {
  headError = e;
}

test.after(() => {
  cleanup();
  headCleanup();
  if (headDir) fs.rmSync(headDir, { recursive: true, force: true });
});

const rtest = (name, fn) =>
  test(name, (ctx) => {
    if (bundleError) return ctx.skip(`bundle failed: ${bundleError}`);
    return fn(ctx);
  });

const dtest = (name, fn) =>
  test(name, (ctx) => {
    if (bundleError) return ctx.skip(`bundle failed: ${bundleError}`);
    if (headError) return ctx.skip(`the d53b71d facade failed to build: ${headError}`);
    return fn(ctx);
  });

const frameworkOf = (m, languageId, frameworkId) =>
  m.tddLangFor(languageId).frameworks.find((f) => f.id === frameworkId);

const rawSpans = (m, languageId, frameworkId, text) =>
  frameworkOf(m, languageId, frameworkId).expectedValueSpans(text);

const spansOf = (m, languageId, frameworkId, text) =>
  rawSpans(m, languageId, frameworkId, text).map((s) => text.slice(s.start, s.end));

const now = (languageId, frameworkId, text) => spansOf(mod, languageId, frameworkId, text);
const head = (languageId, frameworkId, text) => spansOf(headMod, languageId, frameworkId, text);

const deadNow = (languageId, text) => mod.tddLangFor(languageId).deadTableColumns(text);
const deadHead = (languageId, text) => headMod.tddLangFor(languageId).deadTableColumns(text);

// ---------------------------------------------------------------------------
// Fixture builders. One body per language, the binding or the comment varied.
// ---------------------------------------------------------------------------

const RUST_RUN = `        for (a, want) in cases { assert_eq!(f(a), want); }`;
const rust = (body) =>
  `#[cfg(test)]\nmod tests {\n    use super::*;\n\n    #[test]\n    fn t() {\n${body}\n    }\n}`;
const rustTable = (binding, rhs, run) =>
  rust(`        ${binding} = ${rhs};\n${run === undefined ? RUST_RUN : run}`);

const go = (list) =>
  `package p\n\nimport "testing"\n\nfunc TestF(t *testing.T) {\n` +
  `\tcases := []struct{\n\t\tin int\n\t\twant int\n\t}{${list}}\n` +
  `\tfor _, tt := range cases {\n\t\tif got := f(tt.in); got != tt.want { t.Errorf("bad") }\n\t}\n}\n`;

const ts = (list) =>
  `import { it, expect } from "vitest";\n\nit.each([${list}])("adds %i", (a, want) => {\n` +
  `  expect(f(a)).toBe(want);\n});\n`;

const pyParam = (list) =>
  `import pytest\n\n@pytest.mark.parametrize("a,want", [${list}])\ndef test_f(a, want):\n` +
  `    assert f(a) == want\n`;

const pyUnit = (list) =>
  `import unittest\n\nclass T(unittest.TestCase):\n    def test_f(self):\n` +
  `        cases = [${list}]\n        for a, want in cases:\n            self.assertEqual(f(a), want)\n`;

const csharp = (attrs) =>
  `using Xunit;\n\npublic class FTests\n{\n    [Theory]\n${attrs}` +
  `    public void Adds(int a, int want)\n    {\n        Assert.Equal(want, F(a));\n    }\n}\n`;

// ===========================================================================
// Harness row: loud on its own, so a bundling break is one failure and not a
// wall of TypeErrors.
// ===========================================================================

test("[REV71-P1 0] both facades build: the working tree and d53b71d", () => {
  assert.strictEqual(bundleError, undefined, `working-tree bundle failed: ${bundleError}`);
  assert.strictEqual(headError, undefined, `the d53b71d facade failed to build: ${headError}`);
  assert.strictEqual(typeof mod.tddLangFor, "function");
  assert.strictEqual(typeof headMod.tddLangFor, "function");
});

// ===========================================================================
// THE `mut` WALK — rule 12
// ===========================================================================

dtest("[REV71-P1 1] HOLDING rule 12: the triple differential over every annotation form", () => {
  // Rule 2's four forms, amendment 3's plain type NAME, and a nested generic.
  // For each: unannotated `let`, annotated `let`, annotated `let mut`,
  // unannotated `let mut`, annotated `static mut`. All five must agree.
  const forms = {
    "array with a length": ["[(i32, i32); 2]", "[ (1, 2), (3, 4) ]"],
    "array, scalar columns": ["[(u32, u64); 2]", "[ (1, 2), (3, 4) ]"],
    "Vec with vec!": ["Vec<(i32, i32)>", "vec![ (1, 2), (3, 4) ]"],
    "slice reference": ["&[(u8, u8)]", "&[ (1, 2), (3, 4) ]"],
    "nested array type": ["Vec<[(u8, u16); 2]>", "vec![ (1, 2), (3, 4) ]"],
    "plain type NAME (amendment 3)": ["Cases", "[ (1, 2), (3, 4) ]"],
  };
  for (const [label, [ann, rhs]] of Object.entries(forms)) {
    const control = now("rust", "libtest", rustTable("let cases", rhs));
    assert.deepStrictEqual(
      control,
      ["2", "4"],
      `${label}: the UNANNOTATED control must find the table before anything else is graded`
    );
    for (const binding of [`let cases: ${ann}`, `let mut cases: ${ann}`, "let mut cases", `static mut cases: ${ann}`]) {
      assert.deepStrictEqual(
        now("rust", "libtest", rustTable(binding, rhs)),
        control,
        `P9 §12 differential, ${label}, binding \`${binding}\`: the annotation and the \`mut\` change ` +
          `nothing about WHICH values are blanked. Measured at d53b71d: every \`mut\` spelling ` +
          `answered [] and every plain one answered ["2","4"], which is the loss amendment 4 closes.`
      );
    }
  }
  // And the baseline, so the row cannot pass by the fix never having been needed.
  assert.deepStrictEqual(
    head("rust", "libtest", rustTable("let mut cases: Vec<(i32, i32)>", "vec![ (1, 2), (3, 4) ]")),
    [],
    "d53b71d lost the annotated `let mut` table; if this is not [] the baseline is wrong, not the fix"
  );
});

dtest("[REV71-P1 2] HOLDING rule 12: `static mut` is admitted and `const mut` is not", () => {
  const rhs = "vec![ (1, 2), (3, 4) ]";
  assert.deepStrictEqual(
    now("rust", "libtest", rustTable("static mut cases: Vec<(i32, i32)>", rhs)),
    ["2", "4"],
    "`static mut` is a real Rust spell and MUT_BINDING_KEYWORD lists it"
  );
  assert.deepStrictEqual(
    now("rust", "libtest", rustTable("const mut cases: Vec<(i32, i32)>", rhs)),
    [],
    "`const mut` is not Rust. Measured: d53b71d [] and the working tree [] — refusing it costs " +
      "nothing and admitting an invented keyword pair would widen the class for no observed spelling."
  );
});

rtest("[REV71-P1 3] HOLDING rule 12 falsification note: `mut` only as a WHOLE token", () => {
  const rhs = "vec![ (1, 2), (3, 4) ]";
  // The cheapest false pass the contract names: an implementation that
  // special-cases the literal string `mut` in the wrong place reads
  // `mutable_cases` as `let` + `able_cases`, whose walker never matches.
  assert.deepStrictEqual(
    now("rust", "libtest", rustTable("let mutable_cases: Vec<(i32, i32)>", rhs).replace(/in cases/, "in mutable_cases")),
    ["2", "4"],
    "P9 §12: `let mutable_cases: T` is `let` binding `mutable_cases`, not `let mut` binding " +
      "`able_cases`. `identBefore` cannot return a prefix, so the whole-token rule is structural."
  );
  assert.deepStrictEqual(
    now("rust", "libtest", rustTable("let mutable cases: Vec<(i32, i32)>", rhs)),
    [],
    "`let mutable cases: T` is not a binding. Only the literal token `mut` may sit between the " +
      "keyword and the name; admitting an arbitrary identifier is what §12 forbids in its last line."
  );
  assert.deepStrictEqual(
    now("rust", "libtest", rustTable("let mut mut cases: Vec<(i32, i32)>", rhs)),
    [],
    "`let mut mut` walks ONE token, so the second `mut` finds `mut` behind it and MUT_BINDING_KEYWORD " +
      "refuses. A walk that looped over `mut` would admit `let mut mut mut cases`."
  );
  assert.deepStrictEqual(
    now("rust", "libtest", rustTable("foo bar cases: Vec<(i32, i32)>", rhs)),
    [],
    "§12's own example of the widening that must not happen"
  );
});

rtest("[REV71-P1 4] HOLDING: `bindsName` index bounds — `mut` at the very start of the text", () => {
  // b = end - 3 - 1 is -1 when `mut` starts at index 0, and identBefore(text, 0)
  // is "", which MUT_BINDING_KEYWORD refuses. Nothing here may throw.
  const bare = `mut cases: Vec<(i32, i32)> = vec![ (1, 2), (3, 4) ];\nfor (a, want) in cases { assert_eq!(f(a), want); }\n`;
  assert.deepStrictEqual(now("rust", "libtest", bare), [], "no keyword, no binding, no throw");
  assert.deepStrictEqual(now("rust", "libtest", "mut"), [], "a three-character file is a bounds case");
  assert.deepStrictEqual(now("rust", "libtest", ""), [], "an empty file is a bounds case");
  assert.deepStrictEqual(
    now("rust", "libtest", rust(`mut cases: Vec<(i32, i32)> = vec![ (1, 2), (3, 4) ];\n${RUST_RUN}`)),
    [],
    "`mut` with no keyword in front of it is not a binding at any indentation"
  );
});

dtest("[REV71-P1 5] HOLDING: the ANNOTATION_BUDGET floor is symmetric across `mut`", () => {
  // `bindsName` walks one token further back than the old call did, and it does
  // so with NO floor of its own. The question that matters is not whether it can
  // read below the floor by four characters but whether `let mut` and `let` fall
  // off the 512-character cliff at the same annotation length. They do: `end` is
  // the annotation's last character, so the distance the `:` walk covers does not
  // change when four characters are added in FRONT of the name.
  const rhs = "vec![ (1, 2), (3, 4) ]";
  for (const n of [1, 30, 45, 46, 47, 50, 60]) {
    const ann = "Wrapper<".repeat(n) + "Vec<(i32, i32)>" + ">".repeat(n);
    const plain = now("rust", "libtest", rustTable(`let cases: ${ann}`, rhs));
    const withMut = now("rust", "libtest", rustTable(`let mut cases: ${ann}`, rhs));
    assert.deepStrictEqual(
      withMut,
      plain,
      `annotation length ${ann.length}: the budget cliff must fall in the same place for both ` +
        `bindings. Measured: both answer ["2","4"] up to length 465 and both answer [] at 555.`
    );
  }
});

dtest("[REV71-P1 6] HOLDING rule 11 x rule 12: a BORROWED runner over a `let mut` table", () => {
  const borrowed = `        for (a, want) in &cases { assert_eq!(f(a), *want); }`;
  const plain = now("rust", "libtest", rustTable("let cases: Vec<(i32, i32)>", "vec![ (1, 2), (3, 4) ]", borrowed));
  assert.deepStrictEqual(plain, ["2", "4"], "rule 11's borrowed control");
  assert.deepStrictEqual(
    now("rust", "libtest", rustTable("let mut cases: Vec<(i32, i32)>", "vec![ (1, 2), (3, 4) ]", borrowed)),
    plain,
    "P9 §11 + §12: `let mut cases` walked by `for … in &cases` with a deref in the assertion is " +
      "the exact pair a model writes when the table is mutated and the rows are borrowed. Measured " +
      "at d53b71d: []."
  );
});

dtest("[REV71-P1 7] HOLDING rule 8: `let mut` in PYTHON source is not a Rust binding", () => {
  for (const [lang, fw, build] of [
    ["python", "pytest", pyParam],
    ["python", "unittest", pyUnit],
  ]) {
    const rustish = `# let mut cases: Cases\n` + build("\n    (1, 2),\n    (3, 4),\n");
    assert.deepStrictEqual(
      now(lang, fw, rustish),
      head(lang, fw, rustish),
      `P9 §8: the annotation walk is flag-gated off the Python leg, so the ${fw} answer for text ` +
        `carrying Rust's own binding spelling is byte-identical to d53b71d.`
    );
  }
  // And a Python name that merely starts with `mut`.
  const src = pyUnit("\n            (1, 2),\n            (3, 4),\n").replace(/cases/g, "mut_cases");
  assert.deepStrictEqual(
    now("python", "unittest", src),
    head("python", "unittest", src),
    "a Python identifier beginning `mut` moves nothing"
  );
});

// ===========================================================================
// THE COMMENT SKIP — rule 13
// ===========================================================================

dtest("[REV71-P1 8] HOLDING rule 13: every comment POSITION the contract enumerates", () => {
  const cases = {
    "trailing note on the opening line": `        let cases: Cases = [ // the interesting ones\n            (1, 2),\n            (3, 4),\n        ];`,
    "note before a middle row": `        let cases = [\n            (1, 2),\n            // the tricky one\n            (3, 4),\n        ];`,
    "note after the last row": `        let cases = [\n            (1, 2),\n            (3, 4),\n            // done\n        ];`,
    "note after a trailing comma": `        let cases = [\n            (1, 2),\n            (3, 4), // done\n        ];`,
    "block comment before the first row": `        let cases = [ /* note */ (1, 2), (3, 4) ];`,
    "/// spelling": `        let cases = [\n            /// note\n            (1, 2),\n            (3, 4),\n        ];`,
    "//! spelling": `        let cases = [\n            //! note\n            (1, 2),\n            (3, 4),\n        ];`,
    "a comment whose TEXT is row-shaped": `        let cases: Cases = [ // (9, 99)\n            (1, 2),\n            (3, 4),\n        ];`,
    "CRLF line endings": `        let cases = [ // note\r\n            (1, 2),\r\n            (3, 4),\r\n        ];`,
    "CRLF block comment across lines": `        let cases = [ /* note\r\n           more */\r\n            (1, 2),\r\n            (3, 4),\r\n        ];`,
    "nested block comment (Rust nests)": `        let cases = [ /* a /* b */ c */ (1, 2), (3, 4) ];`,
    "a comment holding an unbalanced [": `        let cases = [ // [ oops\n            (1, 2),\n            (3, 4),\n        ];`,
    "a comment holding an unbalanced quote": `        let cases = [ // it's\n            (1, 2),\n            (3, 4),\n        ];`,
    "a comment holding a lone \"": `        let cases = [ // she said "\n            (1, 2),\n            (3, 4),\n        ];`,
  };
  for (const [label, decl] of Object.entries(cases)) {
    const text = rust(`${decl}\n${RUST_RUN}`);
    assert.deepStrictEqual(
      now("rust", "libtest", text),
      ["2", "4"],
      `P9 §13, ${label}: the same table as the comment-free form, and the comment contributes no ` +
        `span. Measured at d53b71d: [] — the whole table dropped with every hole in it.`
    );
    assert.deepStrictEqual(
      head("rust", "libtest", text),
      [],
      `${label}: d53b71d must be the LOSS, or this row proves nothing`
    );
  }
});

rtest("[REV71-P1 9] HOLDING rule 13: a comment must never BE the table", () => {
  const only = rust(`        let cases: Cases = [ // (1, 2)\n            // (3, 4)\n        ];\n${RUST_RUN}`);
  assert.deepStrictEqual(
    now("rust", "libtest", only),
    [],
    "P9 §13 last line: a list whose only elements are comments is not a table. Answering one would " +
      "hand the caller an empty hole set and call it a found table, which the third floor would pass."
  );
  // RULED 2026-09-12 by the phase-1 triage, written into P9 amendment 4 as rule
  // 13c. This row first asserted `["2"]` - skip the comment-only element and
  // keep the table. With the comments out, that list is `[ , (1, 2) ]`, which is
  // not valid source in any of the five languages, so recovering a table from it
  // is a widening bought with nothing. `rowsFromList` refuses every other
  // element that is not a row and it refuses this one the same way. The
  // comment-only TAIL after the LAST comma is the exception and is dropped, not
  // refused - the row below is that case.
  const oneRealRow = rust(`        let cases = [ // note\n            /* also a note */,\n            (1, 2),\n        ];\n${RUST_RUN}`);
  assert.deepStrictEqual(
    now("rust", "libtest", oneRealRow),
    [],
    "P9 §13c: a comment-only element mid-list is not valid source, and refusing is the cheap direction"
  );
  const trailingNote = rust(`        let cases = [\n            (1, 2),\n            (3, 4), // done\n        ];\n${RUST_RUN}`);
  assert.deepStrictEqual(
    now("rust", "libtest", trailingNote),
    ["2", "4"],
    "P9 §13c: a note after the LAST comma is a trailing comma with a note on it, and a bare " +
      "trailing comma was already dropped"
  );
});

dtest("[REV71-P1 10] HOLDING: a STRING is never stepped over, in any of the five legs", () => {
  // The comment skip must not become a literal skip: a string is a legitimate
  // first column and stepping over one moves the span onto the wrong value.
  const rustStr = rust(
    `        let cases = [ // note\n            ("//", 1),\n            ("b", 2),\n        ];\n${RUST_RUN}`
  );
  assert.deepStrictEqual(
    now("rust", "libtest", rustStr),
    ["1", "2"],
    'a first column whose TEXT is "//" is a string, and the row still yields its LAST column'
  );
  const rawStr = rust(
    `        let cases = [ // note\n            (r#"a//b"#, 1),\n            (r#"c/*d"#, 2),\n        ];\n${RUST_RUN}`
  );
  assert.deepStrictEqual(
    now("rust", "libtest", rawStr),
    ["1", "2"],
    "a Rust raw string holding `//` and `/*` is a value, not a comment"
  );
  // Python: `//` is FLOOR DIVISION and `#` is the comment, and the flag is one
  // switch. Both directions, measured.
  const floorDiv = pyParam("\n    (1, 2 // 3),\n    (3, 4),\n");
  assert.deepStrictEqual(
    now("python", "pytest", floorDiv),
    head("python", "pytest", floorDiv),
    'P9 §8: `2 // 3` is floor division and the whole expression is the expected value. Measured ' +
      'd53b71d ["2 // 3","4"]; a `//` skip on the Python profile would come back short and leave ' +
      "the model's `// 3` in the human's buffer, which is the blank-value invariant inverted."
  );
  const hashInString = pyParam('\n    ("#", 2),\n    ("b", 4),\n');
  assert.deepStrictEqual(
    now("python", "pytest", hashInString),
    head("python", "pytest", hashInString),
    "a `#` inside a Python string is a value"
  );
  const slashSlashLeading = pyParam(" // note\n    (1, 2),\n    (3, 4),\n");
  assert.deepStrictEqual(
    now("python", "pytest", slashSlashLeading),
    [],
    "`//` is NOT a comment in Python, so a leading `//` is still a syntax error and still no table"
  );
});

rtest("[REV71-P1 11] HOLDING rule 10: malformed comment input neither throws nor hangs", () => {
  const shapes = {
    "an unclosed /*": [`        let cases = [ /* note\n            (1, 2),\n            (3, 4),\n        ];`, []],
    "a */ with no opener": [`        let cases = [ */ (1, 2), (3, 4) ];`, []],
    "a line comment running to EOF": [`        let cases = [ // no newline after this`, []],
    // An attribute is CODE and not a comment, so the element head stays `#` and
    // the refusal is correct rather than lucky. `#` is Python's comment
    // character and Rust's attribute sigil, and the profile flag is what keeps
    // those apart; if it ever stopped doing so, this row answers ["2","4"].
    "an attribute at the element head": [
      `        let cases = [ // note\n            #[allow(x)] (1, 2),\n            (3, 4),\n        ];`,
      [],
    ],
    // Not malformed at all: a comment is allowed to hold whatever characters it
    // likes, and the skip must read it as one region rather than as delimiters.
    "a comment holding a ] and a ;": [
      `        let cases = [ // ] ;\n            (1, 2),\n            (3, 4),\n        ];`,
      ["2", "4"],
    ],
    "a comment holding an unbalanced (": [
      `        let cases = [ // f(\n            (1, 2),\n            (3, 4),\n        ];`,
      ["2", "4"],
    ],
  };
  for (const [label, [decl, want]] of Object.entries(shapes)) {
    const text = rust(`${decl}\n${RUST_RUN}`);
    let out;
    const started = Date.now();
    assert.doesNotThrow(() => {
      out = now("rust", "libtest", text);
    }, `${label} must not throw`);
    assert.ok(Date.now() - started < 1000, `${label} must not hang`);
    assert.deepStrictEqual(
      out,
      want,
      `P9 §10 / §13, ${label}: a half-generated reply answers no table, and a well-formed one whose ` +
        `note happens to hold a delimiter answers the table. Both measured on the working tree.`
    );
  }
});

dtest("[REV71-P1 12] HOLDING rule 8: the four shared callers move only toward FINDING a table", () => {
  const legs = [
    ["go", "gotest", go, "\n\t\t{1, 2},\n\t\t{3, 4},\n\t", " // note\n\t\t{1, 2},\n\t\t{3, 4},\n\t"],
    ["go", "gotest", go, "\n\t\t{1, 2},\n\t\t{3, 4},\n\t", "\n\t\t{1, 2}, // note\n\t\t{3, 4},\n\t"],
    ["typescript", "vitest", ts, "\n  [1, 2],\n  [3, 4],\n", " // note\n  [1, 2],\n  [3, 4],\n"],
    ["typescript", "vitest", ts, "\n  [1, 2],\n  [3, 4],\n", " /* note */ [1, 2], [3, 4] "],
    [
      "typescript",
      "vitest",
      ts,
      "\n  { a: 1, want: 2 },\n  { a: 3, want: 4 },\n",
      " // note\n  { a: 1, want: 2 },\n  { a: 3, want: 4 },\n",
    ],
    ["python", "pytest", pyParam, "\n    (1, 2),\n    (3, 4),\n", " # note\n    (1, 2),\n    (3, 4),\n"],
    [
      "python",
      "unittest",
      pyUnit,
      "\n            (1, 2),\n            (3, 4),\n        ",
      " # note\n            (1, 2),\n            (3, 4),\n        ",
    ],
  ];
  for (const [lang, fw, build, plainList, commentList] of legs) {
    const control = now(lang, fw, build(plainList));
    assert.deepStrictEqual(control, ["2", "4"], `${lang}/${fw}: the comment-free control`);
    assert.deepStrictEqual(
      now(lang, fw, build(commentList)),
      control,
      `P9 §8 DIRECTION, ${lang}/${fw}: rule 13's reader is shared, and it is allowed to change this ` +
        `leg only toward finding a table a comment was hiding. Measured d53b71d: [].`
    );
    assert.deepStrictEqual(
      head(lang, fw, build(commentList)),
      [],
      `${lang}/${fw}: d53b71d must be the loss, or the move is not the one rule 8 permits`
    );
  }
  // A comment whose content would break a naive scanner, one per leg.
  const trapped = [
    ["typescript", "vitest", ts(" // a ` tick\n  [1, 2],\n  [3, 4],\n")],
    ["go", "gotest", go(" // a ` tick\n\t\t{1, 2},\n\t\t{3, 4},\n\t")],
    ["python", "pytest", pyParam(' # a """ quote\n    (1, 2),\n    (3, 4),\n')],
  ];
  for (const [lang, fw, text] of trapped) {
    assert.deepStrictEqual(
      now(lang, fw, text),
      ["2", "4"],
      `${lang}/${fw}: an unbalanced quote character inside a comment is comment TEXT. The skip runs ` +
        `the comment through the shared scanner, so a backtick or a triple quote in a note cannot ` +
        `open a literal that swallows the list.`
    );
  }
});


// P9 amendment 4 rule 13b. A span that used to CARRY comment text and no longer
// does is a permitted move on every leg. `codeOf` strips comments and collapses
// whitespace so the two answers can be compared on the code they name, which is
// the thing the human ends up typing into.
const codeOf = (s) =>
  s
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ")
    .replace(/#[^\n]*/g, " ")
    .replace(/\s+/g, " ")
    .trim();

dtest("[REV71-P1 13] HOLDING rule 8: the C# attribute leg names the same CODE, 364 insertion points", () => {
  // `findAttributeTable` does not go through `rowsFromList`, so rule 13's reader
  // cannot reach it. Asserted here in CODE rather than in the contract: a
  // comment is inserted at EVERY index of a working C# fixture, in both
  // spellings, and every answer must match d53b71d exactly.
  //
  // REWRITTEN 2026-09-12 by the phase-1 triage, against P9 amendment 4 rule 13b.
  // The row first demanded byte identity and found 50 moves, and every one of
  // them was of the shape ["// n\n 2","4"] -> ["2","4"]: the comment coming OUT
  // of a span. That is the direction rules 3 and 5 were written for - a span
  // carrying comment text is a hole punched over a note, and blanking it hands
  // the human `${1}` where their comment was. So the grade is on the CODE the
  // spans name, which must be identical, and the raw moves are counted and
  // asserted to be comment-stripping only.
  const base = csharp("    [InlineData(1, 2)]\n    [InlineData(3, 4)]\n");
  let checked = 0;
  let moved = 0;
  let carriedComment = 0;
  for (const comment of ["// n\n", "/* n */"]) {
    for (let i = 0; i <= base.length; i++) {
      const text = base.slice(0, i) + comment + base.slice(i);
      checked++;
      const a = now("csharp", "xunit", text);
      const b = head("csharp", "xunit", text);
      if (JSON.stringify(a) === JSON.stringify(b)) continue;
      moved++;
      if (b.some((x) => codeOf(x) !== x.trim())) carriedComment++;
      assert.deepStrictEqual(
        a.map(codeOf),
        b.map(codeOf),
        `P9 §8: C# may lose comment text from a span and nothing else. Insertion of ` +
          `${JSON.stringify(comment)} at index ${i} moved ${JSON.stringify(b)} -> ${JSON.stringify(a)}. ` +
          `Context: ${JSON.stringify(text.slice(Math.max(0, i - 30), i + 40))}`
      );
      assert.ok(
        a.every((x) => codeOf(x) === x.trim()),
        `the NEW answer must carry no comment text at all: ${JSON.stringify(a)}`
      );
    }
  }
  assert.strictEqual(
    carriedComment,
    moved,
    `every move must be a span that USED to carry a comment: ${moved} moves, ${carriedComment} of them`
  );
  assert.ok(checked > 300, `the sweep must actually run: ${checked} points`);
  assert.ok(moved > 0, `the sweep must MOVE something or it grades nothing: ${moved} of ${checked}`);
});

dtest("[REV71-P1 14] HOLDING: comment inserted at EVERY index of six fixtures, no wrong-direction move (rules 8 + 13b)", () => {
  // The blunt instrument. Every legal move rule 8 allows is HEAD-lost ->
  // now-found; anything else is a finding. A comment injected mid-token makes
  // the source garbage, which is exactly the input class rule 10 covers, so the
  // grader asks only that the new answer never DROPS or REWRITES a span the old
  // one had.
  const fixtures = [
    ["rust", "libtest", rustTable("let cases", "[ (1, 2), (3, 4) ]"), ["// n\n", "/* n */"]],
    [
      "rust",
      "libtest",
      rustTable("let mut cases: Vec<(i32, i32)>", "vec![ (1, 2), (3, 4) ]"),
      ["// n\n", "/* n */"],
    ],
    ["go", "gotest", go(" {1, 2}, {3, 4} "), ["// n\n", "/* n */"]],
    ["typescript", "vitest", ts(" [1, 2], [3, 4] "), ["// n\n", "/* n */"]],
    ["python", "pytest", pyParam(" (1, 2), (3, 4) "), ["# n\n"]],
    ["python", "unittest", pyUnit(" (1, 2), (3, 4) "), ["# n\n"]],
  ];
  let checked = 0;
  let moved = 0;
  const wrong = [];
  for (const [lang, fw, base, comments] of fixtures) {
    for (const comment of comments) {
      for (let i = 0; i <= base.length; i++) {
        const text = base.slice(0, i) + comment + base.slice(i);
        checked++;
        const a = now(lang, fw, text);
        const b = head(lang, fw, text);
        if (JSON.stringify(a) === JSON.stringify(b)) continue;
        moved++;
        // Two directions are permitted, and only two. Toward FINDING a table a
        // comment was hiding (amendment 4), and a span LOSING comment text
        // (rule 13b, added by this triage). Both are graded on the code the
        // spans name: every span d53b71d found must still be named, and the new
        // answer must carry no comment text at all.
        // A comment-bearing span is allowed through only when d53b71d had that
        // exact span too. The sweep injects a comment at EVERY index, including
        // the middle of an identifier in the runner body, and the INLINE
        // assertion locator - which this phase did not touch - then returns a
        // span carrying it. Those come through unchanged and are d53b71d's.
        const keptAll =
          b.map(codeOf).every((s) => a.map(codeOf).includes(s)) &&
          a.length >= b.length &&
          a.every((x) => codeOf(x) === x.trim() || b.includes(x));
        if (!keptAll) {
          wrong.push(
            `${lang}/${fw} @${i} ${JSON.stringify(comment)}: ${JSON.stringify(b)} -> ${JSON.stringify(a)} ` +
              `ctx=${JSON.stringify(text.slice(Math.max(0, i - 25), i + 35))}`
          );
        }
      }
    }
  }
  assert.deepStrictEqual(
    wrong,
    [],
    `P9 §8 + §13: a span d53b71d found and the working tree does not, or rewrote, is a finding. ` +
      `Measured: ${checked} insertion points, ${moved} moves, 0 of them in a direction rule 8 forbids.`
  );
  assert.ok(checked > 1500, `the sweep must actually run: ${checked} points`);
  assert.ok(moved > 200, `the sweep must actually MOVE something, or it grades nothing: ${moved}`);
});

dtest("[REV71-P1 15] HOLDING rules 6 and 7: a comment restores the answer, it does not invent one", () => {
  const body = `            ("a", 1, 2),\n            ("b", 3, 4),`;
  const run = `        for (name, a, want) in cases { assert_eq!(f(a), want); }`;
  const plain = rust(`        let cases = [\n${body}\n        ];\n${run}`);
  const noted = rust(`        let cases = [ // the interesting ones\n${body}\n        ];\n${run}`);
  assert.deepStrictEqual(
    deadNow("rust", noted),
    deadNow("rust", plain),
    "P9 §6: `name` is bound and never read, with or without the note. Measured d53b71d: the noted " +
      'form reported [] because there was no table to read columns off, and the plain form ["name"].'
  );
  assert.deepStrictEqual(deadHead("rust", noted), [], "d53b71d had no table here, so no dead column");
  const fwNow = frameworkOf(mod, "rust", "libtest");
  const fwHead = frameworkOf(headMod, "rust", "libtest");
  assert.strictEqual(
    fwNow.unresolvedAssertions(noted),
    fwNow.unresolvedAssertions(plain),
    "P9 §7: the refusal net goes quiet because the table is READ now, not because it was silenced. " +
      `Measured d53b71d on the noted form: ${fwHead.unresolvedAssertions(noted)} unresolved row ` +
      `reference, which is the honest refusal the loss produced.`
  );
  assert.strictEqual(
    fwHead.unresolvedAssertions(noted),
    1,
    "d53b71d refused this shape through the row-reference counter; if it did not, the fix bought nothing"
  );
});

rtest("[REV71-P1 16] HOLDING: the comment skip is LINEAR, not quadratic, on pathological lists", () => {
  // `skipSpaceAndComments` runs once per element and scans only that element's
  // own leading run, so total work is bounded by the text. Four shapes that
  // would each expose a different quadratic: a comment per row, a huge run of
  // comment lines before one row, a run of `/*` openers, and a list of
  // comment-only elements.
  const shapes = {
    "one comment per row": (n) =>
      rust(
        `        let cases = [\n` +
          Array.from({ length: n }, (_, i) => `            // note ${i}\n            (${i}, ${i + 1}),`).join("\n") +
          `\n        ];\n${RUST_RUN}`
      ),
    "a wall of comment lines, one row": (n) =>
      rust(
        `        let cases = [\n` +
          Array.from({ length: n }, (_, i) => `            // note ${i}`).join("\n") +
          `\n            (1, 2),\n            (3, 4),\n        ];\n${RUST_RUN}`
      ),
    "a run of /* openers": (n) => rust(`        let cases = [ ${"/*".repeat(n)} (1, 2), (3, 4) ];\n${RUST_RUN}`),
    "comment-only elements": (n) =>
      rust(
        `        let cases = [ ${Array.from({ length: n }, (_, i) => `/* c${i} */`).join(", ")}, (1, 2), (3, 4) ];\n${RUST_RUN}`
      ),
  };
  const timeOf = (text) => {
    for (let i = 0; i < 3; i++) now("rust", "libtest", text);
    const s = process.hrtime.bigint();
    now("rust", "libtest", text);
    return Number(process.hrtime.bigint() - s) / 1e6;
  };
  for (const [label, build] of Object.entries(shapes)) {
    const small = timeOf(build(250));
    const big = timeOf(build(4000));
    // 16x the input. Quadratic would be ~256x; the bound is generous enough
    // that a loaded box does not make this flaky and tight enough that a
    // genuine n^2 cannot pass it.
    assert.ok(
      big < Math.max(60, small * 40),
      `${label}: 250 -> 4000 elements took ${small.toFixed(2)}ms -> ${big.toFixed(2)}ms. A quadratic ` +
        `skip would be ~256x. Measured on this box, working tree: 0.8ms -> 7.9ms for the first shape.`
    );
    assert.ok(big < 250, `${label}: ${big.toFixed(2)}ms for 4000 elements — this runs on the fn-gen path`);
  }
});

// ===========================================================================
// RED. Rule 13 is implemented at the element head of the LIST and nowhere else.
// ===========================================================================

dtest("[REV71-P1 17] CLOSED HIGH: a trailing comma plus a note does not make the COMMENT the expected value", () => {
  // rustfmt writes a trailing comma on every multi-line tuple, and a note on the
  // expected column is the commonest annotation a model writes. Together they
  // leave an element after the last comma that is NOTHING but a comment, and
  // `lastPositionalColumn` hands that comment back as the column.
  //
  // This is the inversion, all three ways at once:
  //   - the model's guessed `2` and `4` ship UNBLANKED and look checked;
  //   - the hole lands after the comma, so typing into it builds a THREE-tuple
  //     against a runner that destructures two;
  //   - `holes` is 2, so the third floor passes and the gesture ships.
  const text = rust(
    `        let cases = [\n` +
      `            (\n                1,\n                2, // the answer\n            ),\n` +
      `            (\n                3,\n                4, // the answer\n            ),\n` +
      `        ];\n${RUST_RUN}`
  );
  const spans = now("rust", "libtest", text);
  assert.ok(
    spans.every((s) => !/^\s*(\/\/|\/\*)/.test(s)),
    "P9 §13: `A comment must never become a ROW. No span may start or end inside one.` The change " +
      "steps over a comment at the head of a LIST element and nowhere else, so the head of a ROW " +
      'element is untouched: measured ["// the answer","// the answer"], both facades. d53b71d is ' +
      "the same, which makes this rule 13 half implemented rather than a regression — and the half " +
      "that shipped makes the shape reachable more often, not less."
  );
  assert.deepStrictEqual(spans, ["2", "4"], "the expected column is the value, not the note beside it");
  // The end-to-end cost, so the severity is measured and not argued.
  const lang = mod.tddLangFor("rust");
  const blanked = mod.blankExpectedValues(lang, frameworkOf(mod, "rust", "libtest"), text, "i32");
  assert.ok(
    !/2,\s*\$\{1\}/.test(blanked.snippet),
    "the blanked snippet keeps the guessed `2` and puts hole 1 after the comma: measured " +
      "`2, ${1}` with holes=2 and unresolved=0, so nothing downstream refuses it"
  );
});

dtest("[REV71-P1 18] CLOSED HIGH: no comment-as-column on Go, TypeScript or either Python leg", () => {
  const legs = [
    ["go", "gotest", go("\n\t\t{1, 2, // the answer\n\t\t},\n\t\t{3, 4},\n\t"), ["2", "4"]],
    ["typescript", "vitest", ts("\n  [1, 2, // the answer\n  ],\n  [3, 4],\n"), ["2", "4"]],
    ["python", "pytest", pyParam("\n    (1, 2, # the answer\n    ),\n    (3, 4),\n"), ["2", "4"]],
    [
      "python",
      "unittest",
      pyUnit("\n            (1, 2, # the answer\n            ),\n            (3, 4),\n        "),
      ["2", "4"],
    ],
  ];
  const bad = [];
  for (const [lang, fw, text, want] of legs) {
    const got = now(lang, fw, text);
    if (got.some((s) => /^\s*(\/\/|\/\*|#)/.test(s))) {
      bad.push(`${lang}/${fw}: ${JSON.stringify(got)} (d53b71d: ${JSON.stringify(head(lang, fw, text))})`);
    }
    assert.deepStrictEqual(
      got,
      want,
      `${lang}/${fw}: the expected column is the value. A trailing comma with a note after it is ` +
        `gofmt's and black's own output shape, not an exotic spelling.`
    );
  }
  assert.deepStrictEqual(
    bad,
    [],
    "P9 §13 reaches four of the five legs. Rule 13's reader is shared, and so is the hole it left: " +
      "`lastPositionalColumn` never asks whether the element it returns is a comment."
  );
});

dtest("[REV71-P1 19] CLOSED MED: no span starts inside a comment, and a keyed row keeps its KEY", () => {
  const positional = rust(`        let cases = [ (1, /* pick */ 2), (3, 4) ];\n${RUST_RUN}`);
  assert.deepStrictEqual(
    now("rust", "libtest", positional),
    ["2", "4"],
    'P9 §13: measured ["/* pick */ 2","4"] on both facades. The span begins inside a comment, so ' +
      "blanking it deletes the human's note along with the value."
  );
  const goKeyed = go("\n\t\t{in: 1, /* pick */ want: 2},\n\t\t{in: 3, want: 4},\n\t");
  assert.deepStrictEqual(
    now("go", "gotest", goKeyed),
    ["2", "4"],
    'go: measured ["/* pick */ want: 2","4"]. `goLastColumn` matches its `want:` key with a regex ' +
      "anchored at the element start, the comment defeats the anchor, and the span then covers the " +
      "FIELD NAME. Blanking it emits `{in: 1, ${1}}`, which is not a keyed composite literal and " +
      "does not compile — the human is handed broken source rather than a hole."
  );
  const tsKeyed = ts("\n  { a: 1, /* pick */ want: 2 },\n  { a: 3, want: 4 },\n");
  assert.deepStrictEqual(
    now("typescript", "vitest", tsKeyed),
    ["2", "4"],
    'typescript: measured ["/* pick */ want: 2","4"], same mechanism in `jsObjectLastColumn`'
  );
});

dtest("[REV71-P1 20] CLOSED MED: the table is found and the span carries no comment", () => {
  // Row 19's shapes are equally wrong at d53b71d, so the fair charge against
  // this phase is reachability. Put a note on the opening line as well and
  // d53b71d refuses the whole table — no spans, no holes, the third floor
  // refuses the pass, nothing is written. The working tree finds the table and
  // returns a span that starts inside a comment. Rule 13 bought the table and
  // sold a wrong span with it.
  const text = rust(
    `        let cases = [ // the interesting ones\n` +
      `            (1,\n             // pick one\n             2),\n            (3, 4),\n        ];\n${RUST_RUN}`
  );
  assert.deepStrictEqual(head("rust", "libtest", text), [], "d53b71d refused, which is the safe answer");
  assert.deepStrictEqual(
    now("rust", "libtest", text),
    ["2", "4"],
    'measured: ["// pick one\\n             2","4"]. Because the whole span is replaced, blanking ' +
      "eats the line comment AND the newline behind it. Rule 13 says no span may start inside a " +
      "comment; the reader that was taught to step over one at the list head still walks straight " +
      "into one at the row head, and the fix widened the set of inputs that reach it."
  );
});

dtest("[REV71-P1 21] KNOWN LIMIT S71-2: a comment between the OPENER and the list loses the whole table", () => {
  // Four `skipSpace` call sites the phase did not convert. Rule 13's text is
  // about a comment INSIDE the list, so this is the same family one character
  // to the left rather than a breach of the written rule — but it is the same
  // loss, silent, and the same one-line remedy at each site.
  const sites = [
    ["typescript", "vitest", `import { it, expect } from "vitest";\n\nit.each(/* c */ [ [1, 2], [3, 4] ])("adds %i", (a, want) => {\n  expect(f(a)).toBe(want);\n});\n`, "findEachTable's `listOpen = skipSpace(callOpen + 1)`"],
    [
      "go",
      "gotest",
      `package p\n\nimport "testing"\n\nfunc TestF(t *testing.T) {\n\tcases := []struct{\n\t\tin int\n\t\twant int\n\t} /* c */ { {1, 2}, {3, 4} }\n\tfor _, tt := range cases {\n\t\tif got := f(tt.in); got != tt.want { t.Errorf("bad") }\n\t}\n}\n`,
      "findGoStructTable's `valuesOpen = skipSpace(fieldsClose + 1)`",
    ],
    [
      "python",
      "pytest",
      `import pytest\n\n@pytest.mark.parametrize("a,want", # c\n    [ (1, 2), (3, 4) ])\ndef test_f(a, want):\n    assert f(a) == want\n`,
      "findParametrizeTable's list argument",
    ],
    ["rust", "libtest", rustTable("let cases", "/* c */ vec![ (1, 2), (3, 4) ]"), "findAssignedTupleTable, between `=` and `vec!`"],
  ];
  // DEFERRED by the phase-1 triage as S71-2, and PINNED here so a fix is a
  // deliberate flip. Four reasons, all measured: the loss is pre-existing (all
  // four answer [] at d53b71d too), the direction is a refusal and not an
  // inversion, rule 13's text is about a comment INSIDE the list, and the fourth
  // site needs a BACKWARDS comment skip rather than the forward primitive the
  // other three would take. The remedy per site is named above.
  //
  // MEASURED, and the review's claim of four is now three.
  // `@pytest.mark.parametrize` loses its table at d53b71d and FINDS it now: its
  // list argument is reached through `topLevelElements` on the decorator's own
  // call, so rule 13a's element trim closed it as a side effect. The other three
  // reach their list by walking characters and are the deferred set.
  const lost = [];
  const found = [];
  const alsoLostAtHead = [];
  for (const [lang, fw, text, site] of sites) {
    const key = `${lang}/${fw}`;
    if (now(lang, fw, text).length === 0) {
      lost.push(key);
    } else {
      found.push(key);
    }
    if (head(lang, fw, text).length === 0) alsoLostAtHead.push(site);
  }
  assert.deepStrictEqual(
    lost,
    ["typescript/vitest", "go/gotest", "rust/libtest"],
    "S71-2: these three still lose the table for a note one character outside the bracket. If one " +
      "of them now answers, S71-2 is closing and this row should assert the table it finds."
  );
  assert.deepStrictEqual(found, ["python/pytest"], "and parametrize is the one that already answers");
  assert.strictEqual(
    alsoLostAtHead.length,
    sites.length,
    "d53b71d loses ALL FOUR, which is what makes the three a deferral and not a regression, and " +
      "what makes parametrize a fourth thing rule 13a closed"
  );
});

dtest("[REV71-P1 22] CLOSED LOW: the binding KEYWORD may not be comment prose, on either hop", () => {
  // `commentOwnsColon` guards the `:`. Nothing guards the token in front of the
  // name, so a line comment ending in `let` or `static` supplies the keyword for
  // the code on the line below it. The no-`mut` half is d53b71d's and this phase
  // did not cause it; `bindsName` inherits the hole and adds a hop, so a comment
  // ending in `let` now also authorises a `mut` that is not a binding.
  const withMut = rust(
    `        // this used to be a let\n        mut cases: Vec<(i32, i32)> = vec![ (1, 2), (3, 4) ];\n${RUST_RUN}`
  );
  const withStatic = rust(
    `        // and this one was static\n        mut cases: Vec<(i32, i32)> = vec![ (1, 2), (3, 4) ];\n${RUST_RUN}`
  );
  assert.deepStrictEqual(head("rust", "libtest", withMut), [], "d53b71d refused the `mut` form");
  assert.deepStrictEqual(
    now("rust", "libtest", withMut),
    [],
    'P9 §12: `mut cases: T = …` with no keyword is not a binding in any Rust. Measured ["2","4"]: ' +
      "`bindsName` skips whitespace backwards, crosses the newline, and reads `let` out of the " +
      "COMMENT above. Cheap to close — the same `commentOwnsColon` lens over the keyword position."
  );
  assert.deepStrictEqual(
    now("rust", "libtest", withStatic),
    [],
    'the `static` half of MUT_BINDING_KEYWORD, same mechanism, measured ["2","4"]'
  );
});

rtest("[REV71-P1 23] HOLDING: `let /* c */ mut` refuses, and so does `let /* c */ cases`", () => {
  // The mirror of row 22, and the reason row 22 is LOW rather than MED: the
  // walk reads comment prose FORWARD out of a note on the line above and
  // refuses a comment BETWEEN the keyword and the name. Both halves behave the
  // same with and without `mut`, so rule 12 introduced no asymmetry of its own.
  const rhs = "vec![ (1, 2), (3, 4) ]";
  for (const gap of ["/* c */", "// c\n       "]) {
    const plain = now("rust", "libtest", rustTable(`let ${gap} cases: Vec<(i32, i32)>`, rhs));
    const withMut = now("rust", "libtest", rustTable(`let ${gap} mut cases: Vec<(i32, i32)>`, rhs));
    assert.deepStrictEqual(
      withMut,
      plain,
      `a comment between the keyword and the name refuses identically with and without \`mut\`: ` +
        `measured [] for both. §12 asks that \`let mut\` answer as \`let\` does, and here it does.`
    );
    assert.deepStrictEqual(plain, [], "and the shared answer is the refusal, not a found table");
  }
});
