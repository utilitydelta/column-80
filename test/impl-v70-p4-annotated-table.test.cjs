// White-box rows for session-v70 phase 4: a table annotated with a plain type
// NAME is still a table [session-v70/goal.md defect 3, session-v68 contract
// P9-annotated-table.md rules 1, 2 and 8].
//
// WHITE BOX on purpose. The blind oracle for this phase writes the contract's
// own rows without reading src/**; these rows drive the BRANCH the fix added,
// which means they name the shapes that decide whether the branch is entered:
// a plain type name, a path-qualified one, the `::` trap, a struct-literal
// field, and the Rust-only flag that keeps the walk off Python.
//
// The instrument is the differential the contract calls the cheapest true one:
// every Rust fixture is built once with the annotation and once without, and
// the two span sets must be equal. A fix that finds the table but names the
// wrong column fails that, while it would pass a bare "some spans came back".
//
// Reached through the seam, as production reaches it. No per-framework locator
// is imported by name.
//
// Run: SKIP_LIVE=1 node --test test/impl-v70-p4-annotated-table.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

let mod = {};
let cleanup = () => {};
let bundleError;
try {
  ({ mod, cleanup } = bundleCore("impl-v70-p4-annotated-table", `export { tddLangFor } from "../src/core/tddLang";\n`));
} catch (e) {
  bundleError = e;
}
test.after(() => cleanup());

const itest = (name, fn) =>
  test(name, (ctx) => {
    if (bundleError) return ctx.skip(`bundle failed: ${bundleError}`);
    return fn(ctx);
  });

const frameworkOf = (languageId, frameworkId) =>
  mod.tddLangFor(languageId).frameworks.find((f) => f.id === frameworkId);

/** The TEXT of every expected-value span, which is what a human sees blanked. */
const spansOf = (languageId, frameworkId, text) =>
  frameworkOf(languageId, frameworkId)
    .expectedValueSpans(text)
    .map((s) => text.slice(s.start, s.end));

const rawSpansOf = (languageId, frameworkId, text) => frameworkOf(languageId, frameworkId).expectedValueSpans(text);

/** A generated Rust test module, the shape the product actually splices. */
const wrapRust = (body) =>
  `#[cfg(test)]\nmod tests {\n    use super::*;\n\n    #[test]\n    fn t() {\n${body}\n    }\n}`;

const TABLE_AND_RUNNER = (annotation, binding = "let cases") => `        ${binding}${annotation} = [
            (1, 2),
            (3, 4),
        ];
        for (a, want) in cases {
            assert_eq!(f(a), want);
        }`;

/** Rule 1 as an executable: the annotated spelling and the bare one answer the
 *  same thing. Splicing the annotation in is the only difference between the
 *  two texts, so an equal span set is an exact statement that the annotation
 *  changed nothing. */
const sameAsUnannotated = (annotation, binding, why) => {
  const plain = spansOf("rust", "libtest", wrapRust(TABLE_AND_RUNNER("", binding)));
  const annotated = spansOf("rust", "libtest", wrapRust(TABLE_AND_RUNNER(annotation, binding)));
  assert.deepStrictEqual(plain, ["2", "4"], `${why}: the UNANNOTATED control must find the table first`);
  assert.deepStrictEqual(annotated, plain, why);
};

// ===========================================================================
// The defect, and the spellings of it
// ===========================================================================

itest("[v70 D3 §1] rust: `let cases: Cases = [ … ]` finds the same spans as the unannotated table", () => {
  sameAsUnannotated(
    ": Cases",
    undefined,
    "a plain type NAME is the one annotation that ENDS in an identifier, so the walk back from " +
      "the `=` lands on `Cases` and the annotation branch is skipped. The table is then hunted " +
      "for a loop over `Cases`, found to have none, and dropped with every hole in it"
  );
});

itest("[v70 D3 §1] rust: a PATH-qualified annotation is the same table", () => {
  sameAsUnannotated(
    ": crate::fixtures::Cases",
    undefined,
    "`::` is a path separator, not a binding colon. Walking back has to step over both halves of " +
      "every `::` and still reach the binding `:` in front of `cases`"
  );
});

itest("[v70 D3 §1] rust: `const` and `static` bindings carry the same annotation", () => {
  sameAsUnannotated(": Cases", "const cases", "`const` is a binding keyword, and a generated module may hang a table off one");
  sameAsUnannotated(": Cases", "static cases", "`static` likewise");
});

itest("[v70 D3 §2] rust: the rule-2 shapes did not move", () => {
  for (const annotation of [
    ": [(u32, u64); 2]",
    ": [(u32, u64); 5]",
    ": Vec<(u32, u64)>",
    ": &[(u32, u64)]",
    ": Vec<[u8; 4]>",
  ]) {
    sameAsUnannotated(annotation, undefined, `rule 2 form \`${annotation}\` must answer as it did before the branch was widened`);
  }
});

itest("[v70 D3 §3] rust: no span falls inside the annotation, and none starts before the `=`", () => {
  const text = wrapRust(TABLE_AND_RUNNER(": Cases"));
  const eq = text.indexOf(" = [");
  const spans = rawSpansOf("rust", "libtest", text);
  assert.ok(spans.length > 0, "the table is found at all");
  for (const s of spans) {
    assert.ok(
      s.start > eq,
      `a span starting at ${s.start} is at or before the \`=\` at ${eq}, which is inside the annotation. ` +
        "Blanking there hands the human a hole where a TYPE belongs and ships the real expected value unchecked"
    );
    assert.notStrictEqual(text.slice(s.start, s.end), "Cases", "a type name is never an expected value");
  }
});

// ===========================================================================
// The traps. Each one carries a `:` in front of an identifier, and none of
// them is a binding.
// ===========================================================================

itest("[v70 D3 trap] rust: a `::` path with NO binding keyword answers what it answered before", () => {
  const body = `        Fixtures::CASES = [
            (1, 2),
            (3, 4),
        ];
        for (a, want) in CASES {
            assert_eq!(f(a), want);
        }`;
  const withPath = spansOf("rust", "libtest", wrapRust(body));
  const withoutPath = spansOf("rust", "libtest", wrapRust(body.replace("Fixtures::CASES", "CASES")));
  assert.deepStrictEqual(
    withPath,
    withoutPath,
    "the `:` in front of `CASES` is a path separator and there is no `let`, `const` or `static` " +
      "anywhere behind it. The walk must refuse, and the identifier stands as the name exactly as " +
      "it did before the question was asked"
  );
});

itest("[v70 D3 trap] rust: a struct-literal FIELD named like the table is not a table", () => {
  const text = wrapRust(`        let cfg = Config {
            cases: [ (1, 2), (3, 4) ],
        };
        for (a, want) in cases {
            assert_eq!(f(a), want);
        }`);
  assert.deepStrictEqual(
    spansOf("rust", "libtest", text),
    [],
    "`cases:` here is a field of a struct literal, not a binding. Reading it as one blanks `2` and " +
      "`4`, the second element of a list no runner walks, while the assertion's real expected " +
      "value ships as the model guessed it. An ambiguous shape is answered with no table"
  );
});

itest("[v70 D3 trap] rust: a match arm is not a binding", () => {
  const text = wrapRust(`        let cases = match kind {
            Kind::Pairs => [ (1, 2), (3, 4) ],
        };
        for (a, want) in cases {
            assert_eq!(f(a), want);
        }`);
  assert.deepStrictEqual(
    spansOf("rust", "libtest", text),
    [],
    "`Kind::Pairs =>` is an arm, not a binding, and the `=` a walk would need here is the first " +
      "half of a fat arrow. Neither `Pairs` nor the arm's list may become a table"
  );
});

itest("[v70 D3 §4] rust: an annotated table with NO destructuring loop after it is still not a table", () => {
  const text = wrapRust(`        let cases: Cases = [
            (1, 2),
            (3, 4),
        ];
        assert_eq!(f(1), 2);
        assert_eq!(f(3), 4);`);
  assert.deepStrictEqual(
    spansOf("rust", "libtest", text),
    ["2", "4"],
    "rule 4 is load-bearing and the widening must not reopen it: with no runner walking the list, " +
      "the two holes are the INLINE assertions' expected values, not the list's elements"
  );
});

// ===========================================================================
// Rule 8. The walk is Rust-only, and the flag is what holds it there.
// ===========================================================================

itest("[v70 D3 §8] python: a colon in front of the assigned name does NOT open the walk", () => {
  const text = `import unittest

class T(unittest.TestCase):
    def test_x(self):
        if cases:
            rows = [(1, 2), (3, 4)]
        for a, b in cases:
            self.assertEqual(f(a), b)
`;
  assert.deepStrictEqual(
    spansOf("python", "unittest", text),
    ["b"],
    "this is the widened gate's worst case: `rows` is preceded by the `:` that ends an `if` " +
      "header, and the name in front of THAT colon is `cases`, which the runner does walk. The " +
      "Rust-only flag is the only thing standing between this and blanking `2` and `4` while the " +
      "assertion's real expected value ships unchecked"
  );
});

itest("[v70 D3 §8] python: the pytest leg is the same finder and the same answer", () => {
  const text = `import pytest


def test_x():
    if cases:
        rows = [(1, 2), (3, 4)]
    for a, b in cases:
        assert f(a) == b
`;
  assert.deepStrictEqual(spansOf("python", "pytest", text), ["b"], "one finder, two Python legs");
});

itest("[v70 D3 §8] python: a plain type-NAME annotation answers as it did before", () => {
  const text = `import unittest

class T(unittest.TestCase):
    def test_x(self):
        cases: Cases = [(1, 2), (3, 4)]
        for a, b in cases:
            self.assertEqual(f(a), b)
`;
  assert.deepStrictEqual(
    spansOf("python", "unittest", text),
    ["b"],
    "the benign half of the same widening. Python is out of scope, so the annotated binding keeps " +
      "the inline hole it had"
  );
});

itest("[v70 D3 §8] the other four finders answer on the Rust spelling without moving", () => {
  const goText = `func TestF(t *testing.T) {
	cases := []struct {
		a    int
		want int
	}{
		{1, 2},
		{3, 4},
	}
	for _, c := range cases {
		if got := f(c.a); got != c.want {
			t.Errorf("got %v", got)
		}
	}
}
`;
  assert.deepStrictEqual(spansOf("go", "gotest", goText), ["2", "4"], "Go's own finder is untouched");
  const rustInGo = `func TestF(t *testing.T) {
	let cases: Cases = [ (1, 2), (3, 4) ]
}
`;
  assert.deepStrictEqual(
    spansOf("go", "gotest", rustInGo),
    [],
    "a Rust annotation is not Go, and the Go finder answers on it without throwing"
  );
});

// ===========================================================================
// The walk stays bounded. This locator runs on the fn-gen path.
// ===========================================================================

itest("[v70 D3 bounded] rust: the walk is bounded, and the bound is where the table stops being found", () => {
  const inBudget = `: ${"A".repeat(400)}`;
  const overBudget = `: ${"A".repeat(600)}`;
  sameAsUnannotated(inBudget, undefined, "a 400-character annotation is inside ANNOTATION_BUDGET and is still found");
  assert.deepStrictEqual(
    spansOf("rust", "libtest", wrapRust(TABLE_AND_RUNNER(overBudget))),
    [],
    "past the budget the walk refuses. The bound is why this locator can run on the fn-gen path at " +
      "all: an unbounded backwards walk over pathological input is how it turns into a hang. A " +
      "refusal costs a gesture, which is the cheap direction"
  );
});

itest("[v70 D3 bounded] rust: an unbalanced prefix in front of the colon is refused", () => {
  const junk = "<".repeat(40000);
  const text = wrapRust(TABLE_AND_RUNNER(`: ${junk}Cases`));
  const started = Date.now();
  const spans = spansOf("rust", "libtest", text);
  const took = Date.now() - started;
  assert.ok(took < 2000, `the locator took ${took}ms on 40k unclosed generic opens`);
  assert.deepStrictEqual(spans, [], "an annotation that opens brackets it never closes is not an annotation");
});

// ===========================================================================
// A `:` a LINE COMMENT owns is not a binding colon [session-v70 phase 4 loop 2,
// review rows REV70-P4 1, 2 and 3]
// ===========================================================================
//
// The backwards walk reads raw characters, so it cannot see that the `:` it
// stopped on is the last character of a comment. `annotationRunsTo` guards only
// the region AFTER the colon, which in these shapes is a bare identifier and
// passes, and the binding-keyword anchor then reads `let` out of the comment's
// own prose. Every row below is a FALSE ADMIT: the locator names a list no
// runner walks and the human gets holes punched into the test's inputs.

itest("[v70 D3 comment] rust: a line comment ending in `let cases:` does not name the list below it", () => {
  const text = wrapRust(`        /// let cases:
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
    "P9 rule 4: nothing walks `rows`, and `cases` is not declared here at all. The only reason the " +
      "walk reaches a name is that it read `let cases:` out of a doc comment"
  );
});

itest("[v70 D3 comment] rust: a commented colon beside a real table blanks only the real table", () => {
  const text = wrapRust(`        let expected = [(7, 7), (8, 8)];
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
    "`expected` is the walked table and `inputs` is ordinary setup. Renaming `inputs` out of the " +
      "comment blanks both lists, which is the correct table plus a column the human wrote as input"
  );
});

itest("[v70 D3 comment] rust: the name is inside the comment too when the `=` is on the next line", () => {
  const text = wrapRust(`        // let cases: rows
        = [
            (1, 2),
            (3, 4),
        ];
        for (a, want) in cases {
            assert_eq!(f(a), want);
        }`);
  assert.deepStrictEqual(
    spansOf("rust", "libtest", text),
    [],
    "the colon and the identifier after it sit on ONE line, so a gate that only refused a newline " +
      "between the two would still admit this one"
  );
});

itest("[v70 D3 comment] rust: a trailing line comment on a real statement cannot name the next list", () => {
  const text = wrapRust(`        let n = 1; // let cases:
        rows = [
            (1, 2),
            (3, 4),
        ];
        for (a, want) in cases {
            assert_eq!(f(a), want);
        }`);
  assert.deepStrictEqual(spansOf("rust", "libtest", text), [], "the line holds real code before the `//`");
});

itest("[v70 D3 comment] rust: a block comment's colon stays refused", () => {
  const text = wrapRust(`        /* setup, let cases: */
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
    "the forward verification sees the `*/` between the colon and the `=` and refuses. The line " +
      "gate must not be the only thing holding this shape"
  );
});

itest("[v70 D3 comment] rust: a comment above a REAL annotated table changes nothing", () => {
  const text = wrapRust(`        /// let cases:
        let cases: Cases = [
            (1, 2),
            (3, 4),
        ];
        for (a, want) in cases {
            assert_eq!(f(a), want);
        }`);
  assert.deepStrictEqual(
    spansOf("rust", "libtest", text),
    ["2", "4"],
    "the gate asks who owns the colon the walk STOPPED on, not whether a comment is nearby. This " +
      "colon is the binding's, on a line of its own code"
  );
});

itest("[v70 D3 comment] rust: a `:` inside a string on the line above does not name the list", () => {
  const inString = wrapRust(`        let msg = "let cases:";
        let cases: Cases = [
            (1, 2),
            (3, 4),
        ];
        for (a, want) in cases {
            assert_eq!(f(a), want);
        }`);
  assert.deepStrictEqual(
    spansOf("rust", "libtest", inString),
    ["2", "4"],
    "the string's colon is not the one the walk stops on: the `;` ends the walk first, and the real " +
      "annotation below still answers"
  );
  const unterminated = wrapRust(`        let msg = "let cases:
        rows = [
            (1, 2),
            (3, 4),
        ];
        for (a, want) in cases {
            assert_eq!(f(a), want);
        }`);
  assert.deepStrictEqual(
    spansOf("rust", "libtest", unterminated),
    [],
    "an unterminated string swallows the list, so the locator never reaches a `[` at all"
  );
});

itest("[v70 D3 comment] rust: an annotation split across two lines is still an annotation", () => {
  const text = wrapRust(`        let cases:
            Cases = [
            (1, 2),
            (3, 4),
        ];
        for (a, want) in cases {
            assert_eq!(f(a), want);
        }`);
  assert.deepStrictEqual(
    spansOf("rust", "libtest", text),
    ["2", "4"],
    "refusing a newline between the `:` and the `=` would have been the smaller gate and would have " +
      "cost this table. The gate asks about the colon's own line instead"
  );
});
