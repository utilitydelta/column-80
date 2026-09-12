// Adversarial review evidence for session-v70 phase 4 LOOP 2: "a colon a
// comment owns cannot start the annotation walk" (commit 77086b6), the new
// `commentOwnsColon` gate and its call site in `nameBeforeAnnotation`.
//
// WHITE BOX. Every row is a defect claim with a runnable case behind it,
// written to FAIL against the working tree at the time of review. A green row
// in this file means the defect it names has been closed. Rows tagged
// "HOLDING" are the opposite: properties that were attacked and did not break,
// kept so a later change cannot quietly take them away.
//
// Reviewed artifact, pinned:
//   src/core/tddTable.ts     md5 d60c6cb82035db485d01959e1047df47
//   src/core/tddLang.ts      md5 711a8f5a776faa5104d3db3b9420af3a
//   src/core/testAssembly.ts md5 b7a346f9fe04c80481f72cd4431018d5
//
// Two baselines are quoted in the messages below and both were measured, not
// reasoned. Each was produced by writing `git show <rev>:src/core/tddTable.ts`
// over a copy of the working tree's other sources and bundling that:
//   "main"     = 77086b6's ancestor before phase 4 touched the finder
//   "e164ab7"  = this commit's PARENT, the plain-type-name feature with no gate
// Naming both matters here: a row where e164ab7 and the working tree differ is
// a cost this commit chose, and a row where MAIN and the working tree differ is
// a shape that used to work before phase 4 started and does not now.
//
// Rules cited are from session-v68/contracts/P9-annotated-table.md.
// Loop 1's rows live in test/review-v70-p4.test.cjs; rows 4 and 5 there are
// deferred as S70-8 and are not re-argued.
//
// Run: SKIP_LIVE=1 node --test test/review-v70-p4b.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

let mod = {};
let cleanup = () => {};
let bundleError;
try {
  ({ mod, cleanup } = bundleCore(
    "rev70p4b",
    `export { tddLangFor, blankExpectedValues } from "../src/core/tddLang";\n`
  ));
} catch (e) {
  bundleError = e;
}
test.after(() => cleanup());

const rtest = (name, fn) =>
  test(name, (ctx) => {
    if (bundleError) return ctx.skip(`bundle failed: ${bundleError}`);
    return fn(ctx);
  });

const frameworkOf = (languageId, frameworkId) =>
  mod.tddLangFor(languageId).frameworks.find((f) => f.id === frameworkId);

const rawSpans = (languageId, frameworkId, text) => frameworkOf(languageId, frameworkId).expectedValueSpans(text);

const spansOf = (languageId, frameworkId, text) =>
  rawSpans(languageId, frameworkId, text).map((s) => text.slice(s.start, s.end));

const wrap = (b) => `#[cfg(test)]\nmod tests {\n    use super::*;\n\n    #[test]\n    fn t() {\n${b}\n    }\n}`;

// ===========================================================================
// FALSE ADMIT: the gate cannot see a block comment that opened on an
// EARLIER line
// ===========================================================================
//
// `commentOwnsColon` re-lexes forward from the start of the colon's OWN line.
// A block comment opened two lines up and still open at that line start is
// invisible to a forward lex that begins inside it: `*/` is not a character
// `skipLiteralOrComment` opens anything on, so the walk sees plain text, finds
// no skipped region, and answers "not owned". The colon, the identifier and the
// `let` in front of it are all comment prose, which is the exact defect the
// gate exists to close.
//
// Loop 1 row 8 called block comments HOLDING. Its fixture is a ONE-LINE block
// comment, where the opener does sit on the colon's line and the gate does see
// it. The multi-line spelling is the one the gate's own doc comment claims is
// "already caught", and it is not.

rtest("[REV70-P4B 1] a multi-line block comment's colon still names an unwalked list", () => {
  const closerOnColonLine = wrap(`        /* draft
        let cases: rows */ = [
            (1, 2),
            (3, 4),
        ];
        for (a, want) in cases {
            assert_eq!(f(a), want);
        }`);
  const closerOnNextLine = wrap(`        /* draft
        let cases: rows
        */ = [
            (1, 2),
            (3, 4),
        ];
        for (a, want) in cases {
            assert_eq!(f(a), want);
        }`);
  assert.deepStrictEqual(
    spansOf("rust", "libtest", closerOnColonLine),
    [],
    "P9 rule 4: the only `let`, the only name and the only `:` in this file are inside a block " +
      "comment, and nothing walks the list. Measured main [\"2\",\"4\"], e164ab7 [\"2\",\"4\"], this " +
      "commit [\"2\",\"4\"]. The gate re-lexes from the colon's line start, which is INSIDE the open " +
      "comment, and `*/` opens nothing, so it reports the line as ordinary code."
  );
  assert.deepStrictEqual(
    spansOf("rust", "libtest", closerOnNextLine),
    [],
    "same mechanism with the closer moved off the colon's line. The commit message says a block " +
      "comment 'was already caught, because its closer lands inside the verified region'; that is " +
      "true of the one-line spelling only."
  );
});

rtest("[REV70-P4B 2] the block-comment shape end to end: the refusal net goes quiet", () => {
  const text = wrap(`        /* draft
        let cases: rows
        */ = [
            (1, 2),
            (3, 4),
        ];
        for (a, want) in cases {
            assert_eq!(f(a), want);
        }`);
  const lang = mod.tddLangFor("rust");
  const got = mod.blankExpectedValues(lang, frameworkOf("rust", "libtest"), text, "u64");
  assert.deepStrictEqual(
    { holes: got.holes, unresolved: got.unresolved },
    { holes: 0, unresolved: 1 },
    "this is loop 1 row 2's end-to-end inversion in the spelling the gate does not cover. Measured " +
      "holes 2 / unresolved 0 on all three revisions: the pass ships with `${1}` and `${2}` punched " +
      "into the model's own inputs and the unresolved-row-ref net that would have refused it is " +
      "silenced by the same rename."
  );
});

// ===========================================================================
// LOST TABLE, and a REGRESSION AGAINST MAIN: a multi-line literal that
// closes on the binding's line
// ===========================================================================
//
// The forward lex starts at the colon's line start. When a string literal
// opened on the PREVIOUS line, that start is inside the string, so the string's
// CLOSING quote reads as an opening one. `skipQuoted` has no newline stop, so
// it runs to the next quote anywhere in the file, or to the end of it. Either
// way the skipped region covers the colon and the gate answers "owned", and a
// real, correctly annotated table is refused with every hole in it.
//
// The quote count on such a line is always odd, so the mis-lex always ends past
// the colon: the error is one-directional and costs a table rather than
// inventing one. That is the cheap direction, and it is still a shape main
// answered and this commit does not.

rtest("[REV70-P4B 3] a multi-line string above the binding refuses a real annotated table", () => {
  const arrayForm = wrap(`        let msg = "note
        ok"; let cases: [(u32, u64); 2] = [
            (1, 2),
            (3, 4),
        ];
        for (a, want) in cases {
            assert_eq!(f(a), want);
        }`);
  const vecForm = wrap(`        let msg = "note
        ok"; let cases: Vec<(u32, u64)> = vec![
            (1, 2),
            (3, 4),
        ];
        for (a, want) in cases {
            assert_eq!(f(a), want);
        }`);
  const rawForm = wrap(`        let sql = r#"SELECT *
        FROM t"#; let cases: [(u32, u64); 2] = [
            (1, 2),
            (3, 4),
        ];
        for (a, want) in cases {
            assert_eq!(f(a), want);
        }`);
  assert.deepStrictEqual(
    spansOf("rust", "libtest", arrayForm),
    ["2", "4"],
    "P9 rule 2 form 1, and a binding whose `let`, name, `:` and type are all real code. Measured " +
      "main [\"2\",\"4\"], e164ab7 [\"2\",\"4\"], this commit []. Nothing about the annotation changed; " +
      "the gate mis-lexed the closing quote of the statement above as an opening one."
  );
  assert.deepStrictEqual(
    spansOf("rust", "libtest", vecForm),
    ["2", "4"],
    "P9 rule 2 form 3, same measurements. Both forms predate phase 4, so this is main's answer lost."
  );
  assert.deepStrictEqual(
    spansOf("rust", "libtest", rawForm),
    ["2", "4"],
    "Rust's `r#\"…\"#` has no profile entry at all, so the `\"` is read as an ordinary quote and the " +
      "same mis-lex follows. Measured main [\"2\",\"4\"], this commit []."
  );
});

rtest("[REV70-P4B 4] HOLDING: the mis-lex only ever refuses, it never admits", () => {
  // The stray closing quote makes the count on the line odd, so whatever pairs
  // up inside it the final open quote runs past the colon. A REAL line comment
  // sitting behind the mis-lexed region therefore still ends up covered.
  const text = wrap(`        let msg = "note
        ok"; let m2 = "x"; // let cases:
        rows = [
            (1, 2),
            (3, 4),
        ];
        for (a, want) in cases {
            assert_eq!(f(a), want);
        }`);
  assert.deepStrictEqual(
    spansOf("rust", "libtest", text),
    [],
    "two extra quotes in front of the `//` pair off against each other and the stray one still " +
      "swallows the colon, so the false-admit direction stays shut. e164ab7 answers [\"2\",\"4\"] here " +
      "and this commit answers [], which is the gate doing its job by the wrong route."
  );
});

// ===========================================================================
// The BUDGET: a line longer than ANNOTATION_BUDGET is answered "owned"
// ===========================================================================

rtest("[REV70-P4B 5] KNOWN LIMIT S70-13: a colon 513 characters into its line refuses a table main kept", () => {
  // The line is built so the `:` sits at a known index from the line start.
  const mk = (colonIndex, ann) => {
    const pad = " ".repeat(colonIndex - "let cases".length);
    return (
      `#[cfg(test)]\nmod tests {\n    #[test]\n    fn t() {\n` +
      `${pad}let cases${ann} = [\n(1, 2),\n(3, 4),\n];\n` +
      `for (a, want) in cases {\nassert_eq!(f(a), want);\n}\n}\n}`
    );
  };
  assert.deepStrictEqual(
    spansOf("rust", "libtest", mk(512, ": [(u32, u64); 2]")),
    ["2", "4"],
    "the control: at exactly ANNOTATION_BUDGET the backwards line walk still reaches a newline"
  );
  // PINNED, not fixed. One character further and `commentOwnsColon` finds no line boundary inside
  // its budget and answers "owned". Main and e164ab7 answer ["2","4"] here. The cliff is exact:
  // 512 admits, 513 refuses, silently. A real binding's colon sits about twenty characters into
  // its line, so the shape is not one the product meets, and the refusal is the safe direction.
  // Deferred as S70-13 in session-v70/scraps.md; this row pins the cliff so moving it is deliberate.
  assert.deepStrictEqual(
    spansOf("rust", "libtest", mk(513, ": [(u32, u64); 2]")),
    [],
    "S70-13: past the budget the gate refuses. If this answers [\"2\",\"4\"], the cliff moved or " +
      "went away and S70-13 should be closed with the new bound written down"
  );
});

// ===========================================================================
// A line comment that starts AFTER the colon
// ===========================================================================

rtest("[REV70-P4B 6] KNOWN LIMIT S70-14: a trailing `// note:` on the binding's line loses the table", () => {
  const withComment = wrap(`        let cases: Cases = [ // note:
            (1, 2),
            (3, 4),
        ];
        for (a, want) in cases {
            assert_eq!(f(a), want);
        }`);
  const control = wrap(`        let cases: Cases = [
            (1, 2),
            (3, 4),
        ];
        for (a, want) in cases {
            assert_eq!(f(a), want);
        }`);
  assert.deepStrictEqual(
    spansOf("rust", "libtest", control),
    ["2", "4"],
    "the control must find the table before the comment arm means anything"
  );
  // PINNED, not fixed. P9 rule 1 says a trailing comment on the opening line changes nothing, and
  // today it loses the table. Not phase 4's doing: main, e164ab7 and this branch all answer [],
  // and the UNANNOTATED `let cases = [ // note` loses it on all three too. The colon is reached and
  // admitted; the loss is downstream in the list reader. Deferred as S70-14 in
  // session-v70/scraps.md; this row pins the loss so a fix is a deliberate flip.
  assert.deepStrictEqual(
    spansOf("rust", "libtest", withComment),
    [],
    "S70-14: a trailing line comment on the opening line loses the table today. If this answers " +
      "the control, S70-14 is closed and this row should assert [\"2\",\"4\"]"
  );
});

// ===========================================================================
// HOLDING: what was attacked and did not break
// ===========================================================================

rtest("[REV70-P4B 7] HOLDING: the gate is unreachable on the Python leg", () => {
  // `commentOwnsColon` has ONE caller, `nameBeforeAnnotation`, which has two,
  // both behind the `annotations` flag that `pyTables` passes false. The rows
  // below are the observable half of that: Python answers what main answers for
  // a hash-commented colon, a walked list under one, and a real annotation.
  const commented = `def test_f():
    # let cases:
    rows = [
        (1, 2),
        (3, 4),
    ]
    for a, want in cases:
        assert f(a) == want
`;
  const walked = `def test_f():
    # let cases: Cases
    rows = [
        (1, 2),
        (3, 4),
    ]
    for a, want in rows:
        assert f(a) == want
`;
  const annotated = `def test_f():
    cases: Cases = [
        (1, 2),
        (3, 4),
    ]
    for a, want in cases:
        assert f(a) == want
`;
  for (const framework of ["pytest", "unittest"]) {
    assert.deepStrictEqual(spansOf("python", framework, commented), [], `main answers [] for ${framework}`);
    assert.deepStrictEqual(
      spansOf("python", framework, walked),
      ["2", "4"],
      `the list IS walked here, so the table is real and the answer is main's ["2","4"] for ${framework}`
    );
    assert.deepStrictEqual(
      spansOf("python", framework, annotated),
      [],
      `rule 8: the annotation walk is off for Python, so main's [] stands for ${framework}`
    );
  }
});

rtest("[REV70-P4B 8] HOLDING: CRLF does not change either direction", () => {
  const crlf = (s) => s.replace(/\n/g, "\r\n");
  const falseAdmitShape = crlf(
    wrap(`        /// let cases:
        rows = [
            (1, 2),
            (3, 4),
        ];
        for (a, want) in cases {
            assert_eq!(f(a), want);
        }`)
  );
  const realTable = crlf(
    wrap(`        let cases: Cases = [
            (1, 2),
            (3, 4),
        ];
        for (a, want) in cases {
            assert_eq!(f(a), want);
        }`)
  );
  assert.deepStrictEqual(
    spansOf("rust", "libtest", falseAdmitShape),
    [],
    "the backwards line walk stops on `\\n`, and in CRLF the `\\n` is still the last character of " +
      "the break, so the line start is found in the same place. e164ab7 answers [\"2\",\"4\"] here."
  );
  assert.deepStrictEqual(spansOf("rust", "libtest", realTable), ["2", "4"], "and a real table is not lost to CRLF");
});

rtest("[REV70-P4B 9] HOLDING: the gate runs at most once per candidate and costs nothing measurable", () => {
  // `nameBeforeAnnotation` RETURNS on the first colon whose candidate is
  // non-empty, so `commentOwnsColon` runs at most once per `= [` site and its
  // own work is bounded at ANNOTATION_BUDGET. This is loop 1 row 7's file with
  // every line padded past the budget, which is the gate's worst case: the
  // backwards line walk and the forward re-lex both run the full 512.
  const pad = " ".repeat(500);
  const lines = [];
  for (let i = 0; i < 500; i++) {
    lines.push(`${pad}let v${i}: Cases${i} = [`);
    lines.push(`            (1, 2),`);
    lines.push(`            (3, 4),`);
    lines.push(`        ];`);
  }
  const text = wrap(lines.join("\n"));
  const start = process.hrtime.bigint();
  for (let i = 0; i < 3; i++) {
    rawSpans("rust", "libtest", text);
  }
  const ms = Number(process.hrtime.bigint() - start) / 1e6 / 3;
  assert.ok(
    ms < 3000,
    `Measured on this box, 287000 characters and 500 annotated bindings: main 512ms, e164ab7 514ms, ` +
      `this commit 516ms, which is inside the run-to-run spread. Loop 1 row 7's own file re-measured ` +
      `at 130ms, 128ms and 127ms across the same three revisions. Got ${ms.toFixed(1)}ms.`
  );
});
