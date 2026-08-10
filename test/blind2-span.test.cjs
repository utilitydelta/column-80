// Blind oracle: span math contract (phase2-surface.md "src/core/span.ts").
// The boundary oracle is checked both as subject (its verdicts) and as
// cross-check (an independent slice comparison computed here must agree).
// Written against the surface doc only; never read src/**. Expected red while
// stubs throw "unimplemented".
//
// Run: npm test

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "blind2-span",
  `export { validateSpan, spliceSpan, byteCompareOutsideSpan } from "../src/core/span";\n`
);
const { validateSpan, spliceSpan, byteCompareOutsideSpan } = mod;
test.after(cleanup);

const EMOJI = "\u{1F600}"; // one surrogate pair, two UTF-16 code units
const CRAB = "\u{1F980}";

// Independent oracle: the surface's three conditions, computed here, never
// via the module under test. Cross-checks every byteCompareOutsideSpan verdict.
function outsideIdenticalByHand(original, result, span) {
  return (
    result.length >= original.length - (span.end - span.start) &&
    result.slice(0, span.start) === original.slice(0, span.start) &&
    result.slice(result.length - (original.length - span.end)) === original.slice(span.end)
  );
}

// ---- splice roundtrip: the boundary invariant [surface: span 'The boundary invariant']

const EMOJI_TEXT = `let a = ${EMOJI}; call_old(); // ${EMOJI} tail`;
const OLD_START = EMOJI_TEXT.indexOf("call_old()");
const roundtripCases = [
  { name: "ascii interior", text: "const a = 1;\nconst b = 2;\n", span: { start: 13, end: 25 }, replacement: "let b = 99;" },
  { name: "empty replacement deletes the interior", text: "abcdef", span: { start: 2, end: 4 }, replacement: "" },
  { name: "insertion at document start, span [0,0]", text: "hello", span: { start: 0, end: 0 }, replacement: "// hi\n" },
  { name: "replacement at document start", text: "hello world", span: { start: 0, end: 5 }, replacement: "goodbye" },
  { name: "insertion at document end, span [len,len]", text: "hello", span: { start: 5, end: 5 }, replacement: "!" },
  { name: "replacement reaching document end", text: "hello world", span: { start: 6, end: 11 }, replacement: "there" },
  { name: "whole document", text: "old", span: { start: 0, end: 3 }, replacement: "entirely new" },
  { name: "empty document, empty span", text: "", span: { start: 0, end: 0 }, replacement: "fn x() {}" },
  { name: "multi-byte char before the span edge", text: "café = brew();", span: { start: 7, end: 13 }, replacement: "roast()" },
  { name: "surrogate pairs on both sides of the span", text: EMOJI_TEXT, span: { start: OLD_START, end: OLD_START + 10 }, replacement: "call_new_and_longer()" },
  { name: "span exactly covering a surrogate pair", text: `a${EMOJI}b`, span: { start: 1, end: 3 }, replacement: CRAB },
  { name: "surrogate-pair replacement into ascii text", text: "let x = ok;", span: { start: 8, end: 10 }, replacement: `${EMOJI}${EMOJI}` },
  { name: "empty replacement flush against a trailing emoji", text: `f(drop_me)${EMOJI}`, span: { start: 2, end: 9 }, replacement: "" },
];

for (const { name, text, span, replacement } of roundtripCases) {
  test(`splice roundtrip (${name}): replacement lands exactly in the span, outside byte-identical [surface: span 'spliceSpan' + 'The boundary invariant']`, () => {
    const result = spliceSpan(text, span, replacement);
    // The documented formula, computed independently.
    assert.strictEqual(result, text.slice(0, span.start) + replacement + text.slice(span.end));
    assert.strictEqual(result.slice(span.start, span.start + replacement.length), replacement, "replacement occupies exactly [start, start+len)");
    // Subject and cross-check must agree, and both say identical.
    assert.strictEqual(byteCompareOutsideSpan(text, result, span), true, "oracle passes on a clean splice");
    assert.strictEqual(outsideIdenticalByHand(text, result, span), true, "independent slice comparison agrees");
  });
}

// ---- validateSpan [surface: span 'validateSpan']

test("validateSpan returns undefined for every well-formed span, with and without a matching expectedText", () => {
  const text = "0123456789";
  for (const span of [
    { start: 0, end: 0 },
    { start: 0, end: 10 },
    { start: 3, end: 7 },
    { start: 5, end: 5 },
    { start: 10, end: 10 },
  ]) {
    assert.strictEqual(validateSpan(text, span), undefined, `span ${span.start}-${span.end}`);
    assert.strictEqual(validateSpan(text, span, text.slice(span.start, span.end)), undefined, `expectedText guard on live span ${span.start}-${span.end}`);
  }
  assert.strictEqual(validateSpan("", { start: 0, end: 0 }), undefined, "empty text, empty span");
});

test("validateSpan accepts a mid-surrogate offset: the contract is code-unit arithmetic, no surrogate rule [surface: span 'UTF-16 code-unit offsets' + the exhaustive validity conditions]", () => {
  // "a" + high surrogate at 1, low at 2, "b" at 3. Offset 2 splits the pair;
  // it is an integer inside [0, length], which is the whole stated condition.
  const text = `a${EMOJI}b`;
  assert.strictEqual(text.length, 4, "harness sanity: the emoji is two code units");
  assert.strictEqual(validateSpan(text, { start: 2, end: 2 }), undefined);
  assert.strictEqual(validateSpan(text, { start: 2, end: 4 }), undefined);
});

const invalidSpanCases = [
  { name: "negative start", text: "0123456789", span: { start: -1, end: 3 } },
  { name: "end past text.length", text: "0123456789", span: { start: 0, end: 11 } },
  { name: "inverted span (start > end)", text: "0123456789", span: { start: 7, end: 3 } },
  { name: "non-integer start", text: "0123456789", span: { start: 1.5, end: 3 } },
  { name: "non-integer end", text: "0123456789", span: { start: 1, end: NaN } },
  { name: "both out of range on empty text", text: "", span: { start: 1, end: 2 } },
];

for (const { name, text, span } of invalidSpanCases) {
  test(`validateSpan rejects ${name} with a non-empty reason and never throws [surface: span 'Any violation returns a non-empty human-readable reason. Never throws.']`, () => {
    let reason;
    assert.doesNotThrow(() => {
      reason = validateSpan(text, span);
    });
    assert.strictEqual(typeof reason, "string");
    assert.ok(reason.length > 0, "reason is non-empty");
  });
}

test("validateSpan catches the stale span: expectedText mismatch returns a reason, spliceSpan alone would not [surface: span 'the stale-span guard']", () => {
  const text = "fn old_name() {}";
  const reason = validateSpan(text, { start: 3, end: 11 }, "new_name");
  assert.strictEqual(typeof reason, "string");
  assert.ok(reason.length > 0);
  // The same span without expectedText is fine; the guard is the caller's.
  assert.strictEqual(validateSpan(text, { start: 3, end: 11 }), undefined);
});

// ---- spliceSpan rejection [surface: span 'It throws an Error whose message contains the validateSpan reason']

for (const { name, text, span } of invalidSpanCases) {
  test(`spliceSpan throws on ${name}, message carries the validateSpan reason`, () => {
    const reason = validateSpan(text, span);
    assert.throws(
      () => spliceSpan(text, span, "x"),
      (err) => {
        assert.ok(err instanceof Error);
        if (typeof reason === "string" && reason.length > 0) {
          assert.ok(err.message.includes(reason), `message ${JSON.stringify(err.message)} must contain reason ${JSON.stringify(reason)}`);
        }
        return true;
      }
    );
  });
}

// ---- byteCompareOutsideSpan as oracle [surface: span 'byteCompareOutsideSpan is the boundary oracle' + 'the converse discriminates']

const ORIG = "0123456789ABCDEFGHIJ";
const SPAN = { start: 8, end: 12 }; // interior "89AB"

function mutateAt(s, i, ch) {
  return s.slice(0, i) + ch + s.slice(i + 1);
}

test("oracle detects a single-char mutation before the span", () => {
  const clean = ORIG.slice(0, 8) + "xyz" + ORIG.slice(12);
  const mutated = mutateAt(clean, 3, "!");
  assert.strictEqual(byteCompareOutsideSpan(ORIG, mutated, SPAN), false);
  assert.strictEqual(outsideIdenticalByHand(ORIG, mutated, SPAN), false, "independent comparison agrees");
});

test("oracle detects a single-char mutation after the span", () => {
  const clean = ORIG.slice(0, 8) + "xyz" + ORIG.slice(12);
  const mutated = mutateAt(clean, clean.length - 3, "!");
  assert.strictEqual(byteCompareOutsideSpan(ORIG, mutated, SPAN), false);
  assert.strictEqual(outsideIdenticalByHand(ORIG, mutated, SPAN), false);
});

test("oracle passes an inside-span-only change of any size", () => {
  for (const interior of ["", "z", "a completely different and much longer interior"]) {
    const result = ORIG.slice(0, 8) + interior + ORIG.slice(12);
    assert.strictEqual(byteCompareOutsideSpan(ORIG, result, SPAN), true, `interior ${JSON.stringify(interior)}`);
    assert.strictEqual(outsideIdenticalByHand(ORIG, result, SPAN), true);
  }
});

test("oracle detects dropped and duplicated span-adjacent text", () => {
  const clean = ORIG.slice(0, 8) + "xyz" + ORIG.slice(12);
  const dropped = clean.slice(0, 7) + clean.slice(8); // char at span.start-1 gone
  const duplicated = clean.slice(0, 8) + clean[7] + clean.slice(8); // doubled into the interior boundary... still shifts the suffix
  assert.strictEqual(byteCompareOutsideSpan(ORIG, dropped, SPAN), false, "dropped adjacent char");
  assert.strictEqual(outsideIdenticalByHand(ORIG, dropped, SPAN), false);
  // Duplication that grows the result but shifts nothing outside is legal
  // interior; duplication that changes the suffix is not.
  const dupSuffix = clean + clean[clean.length - 1];
  assert.strictEqual(byteCompareOutsideSpan(ORIG, dupSuffix, SPAN), false, "duplicated trailing char");
  assert.strictEqual(outsideIdenticalByHand(ORIG, dupSuffix, SPAN), false);
  assert.strictEqual(byteCompareOutsideSpan(ORIG, duplicated, SPAN), true, "growth inside the interior only is an interior change");
});

test("oracle condition 1: a result shorter than original minus the interior fails even when repetitive text masks the slices [surface: span condition 1]", () => {
  // All-same-char text defeats slice comparison; only the length condition
  // catches the loss.
  const original = "aaaaaa";
  const span = { start: 2, end: 4 };
  const result = "aaa"; // 3 < 6 - 2
  assert.strictEqual(result.slice(0, 2), original.slice(0, 2), "prefix slices match, by construction");
  assert.strictEqual(result.slice(result.length - 2), original.slice(4), "suffix slices match, by construction");
  assert.strictEqual(byteCompareOutsideSpan(original, result, span), false);
});

test("oracle detects UTF-16 damage outside the span: swapped emoji and a lone-surrogate flip", () => {
  const original = `${EMOJI} keep; TARGET; keep ${EMOJI}`;
  const span = { start: original.indexOf("TARGET"), end: original.indexOf("TARGET") + 6 };
  const clean = original.slice(0, span.start) + "replaced" + original.slice(span.end);
  assert.strictEqual(byteCompareOutsideSpan(original, clean, span), true);

  const swapped = clean.replace(EMOJI, CRAB); // first emoji, before the span
  assert.strictEqual(byteCompareOutsideSpan(original, swapped, span), false, "different emoji before the span");

  const loneFlip = mutateAt(clean, clean.length - 1, "\uDE01"); // low surrogate of the trailing pair
  assert.strictEqual(byteCompareOutsideSpan(original, loneFlip, span), false, "half of a trailing surrogate pair changed");
});

test("oracle: empty prefix and suffix regions compare equal trivially [surface: span 'a span at offset 0 or at text.length is legal']", () => {
  const original = "anything at all";
  const whole = { start: 0, end: original.length };
  assert.strictEqual(byteCompareOutsideSpan(original, "totally unrelated", whole), true);
});

test("oracle throws when the span is invalid for original, and only then [surface: span 'It throws when span is invalid for original']", () => {
  assert.throws(() => byteCompareOutsideSpan("abc", "abc", { start: 2, end: 1 }));
  assert.throws(() => byteCompareOutsideSpan("abc", "abc", { start: 0, end: 4 }));
  // Discriminates against a stub that throws unconditionally.
  assert.strictEqual(byteCompareOutsideSpan("abc", "abc", { start: 0, end: 1 }), true);
});
