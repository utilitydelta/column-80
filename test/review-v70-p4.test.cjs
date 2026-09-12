// Adversarial review evidence for session-v70 phase 4: "a table annotated with
// a plain type name is still a table" (commit e164ab7).
//
// WHITE BOX. Every row is a defect claim with a runnable case behind it,
// written to FAIL against the working tree at the time of review. A green row
// in this file means the defect it names has been closed. Rows tagged
// "HOLDING" are the opposite: properties that were attacked and did not break,
// kept so a later change cannot quietly take them away.
//
// Reviewed artifact, pinned:
//   src/core/tddTable.ts   md5 8fe45fee6b7d9d441ae3bdd78fe2b581
//   src/core/tddLang.ts    md5 711a8f5a776faa5104d3db3b9420af3a
//
// Rules cited are from session-v68/contracts/P9-annotated-table.md.
// The baseline "main" answers quoted in the messages were measured by bundling
// `git show main:src/core/tddTable.ts` over the working tree's other sources,
// which isolates this commit's 41 added lines (the file diff is additive only).
//
// Run: SKIP_LIVE=1 node --test test/review-v70-p4.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

let mod = {};
let cleanup = () => {};
let bundleError;
try {
  ({ mod, cleanup } = bundleCore(
    "rev70p4",
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
// The FALSE ADMIT direction: a `:` the locator cannot tell from a binding one
// ===========================================================================
//
// `colonBefore` skips whitespace and NEWLINES only, and `nameBeforeAnnotation`
// walks raw characters. Neither can see that a `:` is the last character of a
// COMMENT. `annotationRunsTo` guards only the region AFTER the colon, which in
// these fixtures is a bare identifier, so it passes. The binding-keyword anchor
// then reads `let` out of the comment's own text.

rtest("[REV70-P4 1] a comment ending in `let cases:` makes an unwalked list a table", () => {
  const text = wrap(`        /// let cases:
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
    "P9 rule 4: `rows` is walked by nothing, so it is not a table and no value in it may be blanked. " +
      "The runner loops `cases`, which is not declared here at all. main answers []; this commit " +
      "answers [\"2\",\"4\"], holes punched into a list the human wrote as input."
  );
});

rtest("[REV70-P4 2] the same shape end to end: the blank-value floor stops refusing", () => {
  const text = wrap(`        /// let cases:
        rows = [
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
    "main answers holes 0 / unresolved 1, so fnGen refuses the pass and writes nothing. This commit " +
      "answers holes 2 / unresolved 0: the unresolved-row-ref net that made it refuse is silenced by " +
      "the same rename, and the snippet ships with `${1}` and `${2}` where the model's inputs were."
  );
});

rtest("[REV70-P4 3] a real table plus a commented colon blanks BOTH lists", () => {
  const text = wrap(`        let expected = [(7, 7), (8, 8)];
        // let expected:
        inputs = [
            (1, 2),
            (3, 4),
        ];
        for (a, want) in expected {
            assert_eq!(f(a), want);
        }`);
  assert.deepStrictEqual(
    spansOf("rust", "libtest", text),
    ["7", "8"],
    "Only `expected` is walked. main answers [\"7\",\"8\"]; this commit answers [\"7\",\"8\",\"2\",\"4\"], " +
      "so the correct table is still blanked AND the unwalked `inputs` list is blanked beside it. " +
      "Rule 5's ordering survives; rule 4 does not."
  );
});

// ===========================================================================
// The LOST direction: one token of Rust between `let` and the name
// ===========================================================================
//
// `nameBeforeAnnotation` tests BINDING_KEYWORD against the identifier
// IMMEDIATELY before the candidate name. In `let mut cases: …` that identifier
// is `mut`, so the walk refuses and the table is dropped with every hole in it.
// Pre-existing (main answers the same), and this commit did not close it while
// standing on the same anchor.

rtest("[REV70-P4 4] KNOWN LIMIT S70-8: `let mut cases: [(u32, u64); 2] = [ … ]` loses the table (rule 2, form 1)", () => {
  const mk = (bind) => wrap(`        ${bind} = [
            (1, 2),
            (3, 4),
        ];
        for (a, want) in cases {
            assert_eq!(f(a), want);
        }`);
  const control = spansOf("rust", "libtest", mk("let mut cases"));
  assert.deepStrictEqual(control, ["2", "4"], "the UNANNOTATED `let mut` control must find the table first");
  // PINNED, not fixed. P9 rule 1 says the annotation changes nothing, and here it does: `mut` is
  // not in BINDING_KEYWORD and it is the token the walk lands on, so every rule-2 annotation form
  // is lost the moment the binding is `let mut`. Main answers the same, so phase 4 neither opened
  // nor widened it, and closing it widens the anchor in the false-admit direction. Deferred as
  // S70-8 in session-v70/scraps.md; this row pins today's loss so a fix is a deliberate flip.
  assert.deepStrictEqual(
    spansOf("rust", "libtest", mk("let mut cases: [(u32, u64); 2]")),
    [],
    "S70-8: the annotated `let mut` table is lost today. If this answers the control, S70-8 is " +
      "closed and this row should be rewritten to assert `control`"
  );
});

rtest("[REV70-P4 5] KNOWN LIMIT S70-8: `let mut cases: Vec<(u32, u64)> = vec![ … ]` loses the table (rule 2, form 3)", () => {
  const mk = (bind) => wrap(`        ${bind} = vec![
            (1, 2),
            (3, 4),
        ];
        for (a, want) in cases {
            assert_eq!(f(a), want);
        }`);
  const control = spansOf("rust", "libtest", mk("let mut cases"));
  assert.deepStrictEqual(control, ["2", "4"], "the UNANNOTATED `let mut` control must find the table first");
  // PINNED, not fixed: S70-8, same mechanism as row 4. A `Vec` case table is the one a model is
  // most likely to bind with `let mut`, and it is the spelling P9 rule 2 names third.
  assert.deepStrictEqual(
    spansOf("rust", "libtest", mk("let mut cases: Vec<(u32, u64)>")),
    [],
    "S70-8: the annotated `let mut` Vec table is lost today. If this answers the control, S70-8 " +
      "is closed and this row should assert `control`"
  );
});

// ===========================================================================
// Cost and crash
// ===========================================================================

rtest("[REV70-P4 6] a 33000-character table name throws SyntaxError out of expectedValueSpans", () => {
  const name = "c".repeat(33000);
  const text = wrap(`        let ${name}: Cases = [ (1, 2), (3, 4) ];
        for (a, want) in ${name} { assert_eq!(f(a), want); }`);
  let thrown;
  try {
    rawSpans("rust", "libtest", text);
  } catch (e) {
    // The message carries the whole 33000-character pattern; the class is the finding.
    thrown = e.constructor.name;
  }
  assert.strictEqual(
    thrown,
    undefined,
    "`iterableAt` interpolates the table name into a `new RegExp`, escaped but UNBOUNDED, and V8 " +
      "refuses a pattern over 32768 characters. Nothing on the fnGen path wraps blankExpectedValues " +
      "in a try, so the command dies. Pre-existing on the unannotated spelling; this commit adds the " +
      "annotated one as a second route to it."
  );
});

rtest("[REV70-P4 7] HOLDING: the new branch adds no measurable cost to a 2000-line Rust file", () => {
  const lines = [];
  for (let i = 0; i < 500; i++) {
    lines.push(`        let v${i}: Some::Very::Long::Qualified::Path::To::A::Type::Named::Cases${i} = [`);
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
    ms < 2000,
    `every \`= [\` in this file is preceded by \`: IDENT\`, which is the new branch's worst case. ` +
      `Measured on this box: 130ms per call at main and 130ms at this commit, so the 512-character ` +
      `ANNOTATION_BUDGET holds and the path is not quadratic. Got ${ms.toFixed(1)}ms.`
  );
});

// ===========================================================================
// HOLDING: what was attacked and did not break
// ===========================================================================

rtest("[REV70-P4 8] HOLDING: a block comment's colon is refused by the forward verification", () => {
  const text = wrap(`        /* setup, let cases: */
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
    "`annotationRunsTo` sees the `*/` between the colon and the `=` and refuses. This is why rows 1 " +
      "and 3 need a LINE comment: the forward pass is doing its job, it just cannot see backwards."
  );
});

rtest("[REV70-P4 9] HOLDING: a `;` between the colon and the `=` stops the walk", () => {
  const text = wrap(`        let n: usize = 1;
        cases = [
            (1, 2),
            (3, 4),
        ];
        for (a, want) in cases {
            assert_eq!(f(a), want);
        }`);
  assert.deepStrictEqual(
    spansOf("rust", "libtest", text),
    ["2", "4"],
    "a previous statement's annotation colon cannot name this list: the backwards walk returns at the " +
      "`;`, the identifier stands, and the answer is main's."
  );
});

rtest("[REV70-P4 10] HOLDING: a `:` inside a string literal does not reach the walk", () => {
  const text = wrap(`        let msg = "let cases:";
        cases = [
            (1, 2),
            (3, 4),
        ];
        for (a, want) in cases {
            assert_eq!(f(a), want);
        }`);
  assert.deepStrictEqual(spansOf("rust", "libtest", text), ["2", "4"], "the `;` stops the walk before the string does");
});

rtest("[REV70-P4 11] HOLDING: rule 4 - an annotated list with no walker is not a table", () => {
  const text = wrap(`        let inputs: Cases = [
            (1, 2),
            (3, 4),
        ];
        assert_eq!(f(1), 2);
        assert_eq!(f(3), 4);`);
  const listEnd = text.indexOf("];");
  for (const s of rawSpans("rust", "libtest", text)) {
    assert.ok(
      s.start > listEnd,
      `rule 4: no span may fall inside the un-walked list. Span at ${s.start} is ${JSON.stringify(text.slice(s.start, s.end))}`
    );
  }
});

rtest("[REV70-P4 12] HOLDING: rule 3 - no span starts before the `=`", () => {
  const text = wrap(`        let cases: crate::fixtures::Cases = [
            (1, 2),
            (3, 4),
        ];
        for (a, want) in cases {
            assert_eq!(f(a), want);
        }`);
  const eq = text.indexOf("= [");
  const got = rawSpans("rust", "libtest", text);
  assert.ok(got.length > 0, "the path-qualified annotation must find the table");
  for (const s of got) {
    assert.ok(s.start > eq, `rule 3: a span at ${s.start} falls inside the annotation`);
  }
});

rtest("[REV70-P4 13] HOLDING: rule 11 x rule 1 - every borrow spelling reaches the same spans", () => {
  const mk = (ann, iter) => wrap(`        let cases${ann} = [
            (1, 2),
            (3, 4),
        ];
        for (a, want) in ${iter} {
            assert_eq!(f(a), *want);
        }`);
  for (const iter of ["cases", "&cases", "&mut cases", "cases.iter()", "cases.iter().copied()", "&cases[..]"]) {
    assert.deepStrictEqual(
      spansOf("rust", "libtest", mk(": Cases", iter)),
      spansOf("rust", "libtest", mk("", iter)),
      `the plain-name annotation must not change the answer for \`in ${iter}\``
    );
  }
});

rtest("[REV70-P4 14] HOLDING: rules 6 and 7 track the unannotated answer", () => {
  const mk = (ann) => wrap(`        let cases${ann} = [
            (1, "in", 2),
            (3, "in", 4),
        ];
        for (a, _name, want) in cases {
            assert_eq!(f(a), want);
        }`);
  const lang = mod.tddLangFor("rust");
  const fw = frameworkOf("rust", "libtest");
  assert.deepStrictEqual(lang.deadTableColumns(mk(": Cases")), lang.deadTableColumns(mk("")), "rule 6");
  assert.strictEqual(fw.unresolvedAssertions(mk(": Cases")), fw.unresolvedAssertions(mk("")), "rule 7");
});

rtest("[REV70-P4 15] HOLDING: rule 8 - the Python leg answers exactly what main answers", () => {
  const annotated = `def test_f():
    cases: Cases = [
        (1, 2),
        (3, 4),
    ]
    for a, want in cases:
        assert f(a) == want
`;
  const inversion = `def test_f():
    if cases:
        rows[0] = [(1, 2), (3, 4)]
    for a, b in cases:
        assert f(a) == b
`;
  for (const framework of ["pytest", "unittest"]) {
    assert.deepStrictEqual(spansOf("python", framework, annotated), [], `main answers [] for ${framework}`);
    assert.deepStrictEqual(
      spansOf("python", framework, inversion),
      ["b"],
      `amendment 2's own fixture: main answers ["b"] for ${framework}`
    );
  }
});

rtest("[REV70-P4 16] HOLDING: Go, it.each and the C# attribute finders do not move", () => {
  assert.deepStrictEqual(
    spansOf("go", "gotest", `func TestF(t *testing.T) {\n\tcases := []struct {\n\t\tin   int\n\t\twant int\n\t}{\n\t\t{1, 2},\n\t\t{3, 4},\n\t}\n\tfor _, c := range cases {\n\t\tif got := F(c.in); got != c.want {\n\t\t\tt.Errorf("got %v want %v", got, c.want)\n\t\t}\n\t}\n}\n`),
    ["2", "4"]
  );
  assert.deepStrictEqual(
    spansOf("typescript", "jest", `describe("f", () => {\n  it.each([\n    [1, 2],\n    [3, 4],\n  ])("f(%i)", (a, want) => {\n    expect(f(a)).toBe(want);\n  });\n});\n`),
    ["2", "4"]
  );
  assert.deepStrictEqual(
    spansOf("csharp", "xunit", `public class FTests\n{\n    [Theory]\n    [InlineData(1, 2)]\n    [InlineData(3, 4)]\n    public void F_Works(int a, int want)\n    {\n        Assert.Equal(want, F(a));\n    }\n}\n`),
    ["2", "4"]
  );
});

rtest("[REV70-P4 17] the review row [P9 R8 §1] would stay green on a DOUBLE loss", () => {
  // That row asserts `named` deepEqual `plain` and never asserts `plain` is
  // non-empty, so a change that lost the unannotated table too would satisfy it
  // with [] === []. This row is the control it is missing. Green today.
  const plain = spansOf(
    "rust",
    "libtest",
    wrap(`        let cases = [\n            (1, 2),\n            (3, 4),\n        ];\n        for (a, want) in cases {\n            assert_eq!(f(a), want);\n        }`)
  );
  assert.deepStrictEqual(
    plain,
    ["2", "4"],
    "test/review-v68-p89.test.cjs:395 has no non-empty guard on its control arm"
  );
});
