// Implementer oracle: span-math edges the blind contract set cannot see —
// off-by-one boundaries on every validity condition, -0 and Infinity
// offsets, the exact interplay of the oracle's length floor with slice
// comparisons, and a grid sweep of the roundtrip invariant. Complements
// test/blind2-span.test.cjs.
//
// Run: npm test

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl2-span",
  `export { validateSpan, spliceSpan, byteCompareOutsideSpan } from "../src/core/span";\n`
);
const { validateSpan, spliceSpan, byteCompareOutsideSpan } = mod;
test.after(cleanup);

// ---- validateSpan boundary sweep: each condition at its exact edge

test("validateSpan boundaries: end === text.length passes, end === text.length + 1 fails", () => {
  assert.strictEqual(validateSpan("abc", { start: 0, end: 3 }), undefined);
  assert.strictEqual(typeof validateSpan("abc", { start: 0, end: 4 }), "string");
});

test("validateSpan: start === end === 0 on empty text passes; start 0 end 1 fails", () => {
  assert.strictEqual(validateSpan("", { start: 0, end: 0 }), undefined);
  assert.strictEqual(typeof validateSpan("", { start: 0, end: 1 }), "string");
});

test("validateSpan: -0 is an integer and not negative, so span {-0, 0} is valid", () => {
  assert.strictEqual(validateSpan("abc", { start: -0, end: 0 }), undefined);
});

test("validateSpan rejects Infinity and -Infinity offsets as non-integers", () => {
  assert.strictEqual(typeof validateSpan("abc", { start: Infinity, end: 3 }), "string");
  assert.strictEqual(typeof validateSpan("abc", { start: 0, end: -Infinity }), "string");
});

test("validateSpan: expectedText '' matches any empty span and mismatches a non-empty one", () => {
  assert.strictEqual(validateSpan("abc", { start: 1, end: 1 }, ""), undefined);
  assert.strictEqual(typeof validateSpan("abc", { start: 1, end: 2 }, ""), "string");
});

test("validateSpan: expectedText check runs only after range checks — an out-of-range span reports the range problem even with matching-looking text", () => {
  const reason = validateSpan("abc", { start: 0, end: 9 }, "abc");
  assert.strictEqual(typeof reason, "string");
  assert.ok(!/expected text|document changed/.test(reason), `range reason wins: ${reason}`);
});

// ---- spliceSpan

test("spliceSpan error message carries a prefix naming the function, so a thrown reason is traceable in a log", () => {
  assert.throws(() => spliceSpan("abc", { start: 5, end: 6 }, "x"), /spliceSpan:/);
});

test("spliceSpan ignores expectedText staleness by design: only the caller pre-validates content", () => {
  // The span is range-valid; splice never sees expectedText.
  assert.strictEqual(spliceSpan("fn old() {}", { start: 3, end: 6 }, "new"), "fn new() {}");
});

// ---- byteCompareOutsideSpan edges

test("oracle: result identical to original passes for any valid span (regenerating identical text is legal)", () => {
  const text = "fn a() { body }";
  for (const span of [{ start: 0, end: 0 }, { start: 3, end: 9 }, { start: 0, end: text.length }]) {
    assert.strictEqual(byteCompareOutsideSpan(text, text, span), true, `span ${span.start}-${span.end}`);
  }
});

test("oracle: insertion detection at the empty-span boundary", () => {
  // Span [0,0]: anything prepended is interior; anything changed later is not.
  assert.strictEqual(byteCompareOutsideSpan("hello", "Xhello", { start: 0, end: 0 }), true);
  assert.strictEqual(byteCompareOutsideSpan("hello", "hellX", { start: 0, end: 0 }), false);
  // Span [len,len]: anything appended is interior; a changed prefix is not.
  assert.strictEqual(byteCompareOutsideSpan("hello", "hello!!", { start: 5, end: 5 }), true);
  assert.strictEqual(byteCompareOutsideSpan("hello", "Xello!!", { start: 5, end: 5 }), false);
});

test("oracle length floor is exact: result.length === original.length - interior passes when slices agree", () => {
  // Full deletion of the interior: shortest legal result.
  const original = "abcXYZdef";
  const span = { start: 3, end: 6 };
  assert.strictEqual(byteCompareOutsideSpan(original, "abcdef", span), true);
  // One shorter loses adjacent text no matter what the slices look like.
  assert.strictEqual(byteCompareOutsideSpan(original, "abcde", span), false);
});

test("oracle throw message names the oracle and carries the span reason", () => {
  assert.throws(
    () => byteCompareOutsideSpan("abc", "abc", { start: 1.5, end: 2 }),
    /byteCompareOutsideSpan:.*integer/
  );
});

test("oracle validates the span against ORIGINAL, not result: a span valid only for the longer result still throws", () => {
  assert.throws(() => byteCompareOutsideSpan("ab", "abcdef", { start: 0, end: 5 }));
});

// ---- grid sweep: roundtrip invariant over every span of a small text

test("roundtrip invariant sweep: every span x replacement over a surrogate-bearing text", () => {
  const text = "a\u{1F600}b\nc"; // length 6, pair at [1,3)
  const replacements = ["", "x", "\u{1F980}", "longer than the text itself\n"];
  for (let start = 0; start <= text.length; start++) {
    for (let end = start; end <= text.length; end++) {
      const span = { start, end };
      assert.strictEqual(validateSpan(text, span), undefined);
      for (const r of replacements) {
        const result = spliceSpan(text, span, r);
        assert.strictEqual(
          byteCompareOutsideSpan(text, result, span),
          true,
          `span ${start}-${end} replacement ${JSON.stringify(r)}`
        );
      }
    }
  }
});
