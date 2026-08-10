// Implementer oracle: pure gesture support for the context panel
// (src/core/contextGestures.ts) — the P3-F11 multi-cursor semantics (all
// non-empty selections, document order), the selection line-range math the
// staleness text leg depends on, and the P3-F2/F7 preview clamp's
// surrogate-pair boundary. Complements test/impl3-contextBlocks.test.cjs.
//
// Run: npm test

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl3-gestures",
  `export { orderedNonEmptySelections, selectionLineRange, truncatePreview } from "../src/core/contextGestures";\n`
);
const { orderedNonEmptySelections, selectionLineRange, truncatePreview } = mod;
test.after(cleanup);

const sel = (startLine, startCharacter, endLine, endCharacter, tag) => ({
  startLine,
  startCharacter,
  endLine,
  endCharacter,
  tag,
});

// ---- P3-F11: multi-cursor ordering and filtering

test("empty selections (caret-only cursors) are dropped; non-empty survive", () => {
  const out = orderedNonEmptySelections([
    sel(4, 2, 4, 2, "caret"),
    sel(1, 0, 2, 5, "real"),
    sel(9, 9, 9, 9, "caret2"),
  ]);
  assert.deepStrictEqual(out.map((s) => s.tag), ["real"]);
});

test("selections come back in document order (line, then column), whatever order the cursors were placed", () => {
  const out = orderedNonEmptySelections([
    sel(10, 0, 11, 3, "third"),
    sel(2, 8, 2, 12, "second"),
    sel(2, 1, 2, 4, "first"),
  ]);
  assert.deepStrictEqual(out.map((s) => s.tag), ["first", "second", "third"]);
});

test("all-empty input yields [], and the input array is never mutated", () => {
  const carets = [sel(3, 1, 3, 1, "a"), sel(1, 0, 1, 0, "b")];
  assert.deepStrictEqual(orderedNonEmptySelections(carets), []);
  assert.deepStrictEqual(carets.map((s) => s.tag), ["a", "b"], "input order untouched");
  const mixed = [sel(5, 0, 6, 0, "later"), sel(1, 0, 2, 0, "earlier")];
  orderedNonEmptySelections(mixed);
  assert.deepStrictEqual(mixed.map((s) => s.tag), ["later", "earlier"], "sort works on a copy");
});

// ---- selection-to-line-range math (the staleness text leg reads these labels)

const rangeCases = [
  { name: "partial single line", s: sel(2, 1, 2, 5), expected: { startLine: 3, endLine: 3 } },
  { name: "mid-line to mid-line across lines", s: sel(1, 2, 3, 4), expected: { startLine: 2, endLine: 4 } },
  { name: "full lines ending at column 0: the tail line is not part of the selection", s: sel(1, 0, 3, 0), expected: { startLine: 2, endLine: 3 } },
  { name: "single line grabbed with its newline (end col 0 next line)", s: sel(0, 0, 1, 0), expected: { startLine: 1, endLine: 1 } },
  { name: "end col 0 on the SAME line as a non-zero start still counts that line", s: sel(4, 0, 4, 7), expected: { startLine: 5, endLine: 5 } },
];
for (const { name, s, expected } of rangeCases) {
  test(`selectionLineRange: ${name}`, () => {
    assert.deepStrictEqual(selectionLineRange(s), expected);
  });
}

// ---- P3-F2/F7: the preview clamp never splits a surrogate pair

const isHighSurrogate = (s) => {
  const c = s.charCodeAt(s.length - 1);
  return c >= 0xd800 && c <= 0xdbff;
};

test("text at or under the cap is returned unchanged", () => {
  assert.strictEqual(truncatePreview("abc", 3), "abc");
  assert.strictEqual(truncatePreview("abc", 10), "abc");
  assert.strictEqual(truncatePreview("", 5), "");
});

test("cap landing between a high and low surrogate backs off one unit: the preview ends on a whole character", () => {
  // 4 units: cap 3 would cut the second emoji in half.
  const text = "\u{1F600}\u{1F600}tail";
  const out = truncatePreview(text, 3);
  assert.strictEqual(out, "\u{1F600}", "backed off to the whole first emoji");
  assert.ok(!isHighSurrogate(out), "no dangling high surrogate at the cut");
  assert.ok(out.isWellFormed(), "well-formed UTF-16 after the cut");
});

test("cap landing exactly after a complete pair cuts there, no over-backoff", () => {
  const text = "\u{1F600}\u{1F600}tail";
  const out = truncatePreview(text, 4);
  assert.strictEqual(out, "\u{1F600}\u{1F600}");
  assert.ok(out.isWellFormed());
});

test("astral-only text: every cap position yields well-formed output of at most cap units", () => {
  const text = "\u{1F600}".repeat(8); // 16 units
  for (let cap = 0; cap <= text.length; cap++) {
    const out = truncatePreview(text, cap);
    assert.ok(out.length <= cap, `cap=${cap}: length ${out.length} exceeds cap`);
    assert.ok(out.isWellFormed(), `cap=${cap}: split a surrogate pair`);
  }
});

test("BMP text is never shortened below the cap: backoff only fires on a real pair split", () => {
  const text = "x".repeat(50);
  assert.strictEqual(truncatePreview(text, 20).length, 20);
});
