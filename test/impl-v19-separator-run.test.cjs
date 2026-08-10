// The shared separator run, both readings. `separatorRunAt` is strict and
// `separatorRunTolerant` walks leads between the pieces; the two exist because
// one lead-tolerant strip applied to member text ate a private field and
// disarmed three guards (v19 round 3). This file pins the parts of each that no
// higher-level suite exercises.
//
// The multi-pass tolerance in `separatorRunTolerant` is the specific gap: a
// single-pass rewrite left every provider suite green while changing what the
// backstop refuses (v19 round 4, F2). The rows below go red under that rewrite.

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-v19-separator-run",
  `export { separatorRunAt, separatorRunTolerant } from "../src/core/fimInject";\n`,
);
const { separatorRunAt, separatorRunTolerant } = mod;
test.after(cleanup);

// Both functions return { length, separators }. `length` is how far to advance
// past the run, `separators` is the separator characters alone with the leads
// removed - the caller judges the second and skips by the first, so a row that
// gets either wrong is a row that either mis-slices or mis-judges.
const eq = (actual, expLength, expSeparators, where) => {
  assert.strictEqual(actual.length, expLength, `${where}: length`);
  assert.strictEqual(actual.separators, expSeparators, `${where}: separators`);
};

test("separatorRunAt is STRICT: it stops at the first non-separator, leads included, because it strips text that is supposed to BE a member reference", () => {
  const rows = [
    { text: ".enrollTile", length: 1, separators: "." },
    { text: "::enrollTile", length: 2, separators: "::" },
    { text: "?.enrollTile", length: 2, separators: "?." },
    { text: "?  .enrollTile", length: 4, separators: "?  ." }, // `?\s*\.` tolerates space INSIDE the `?.`
    { text: "enrollTile", length: 0, separators: "" }, // a bare name has no run
    { text: " .enrollTile", length: 0, separators: "" }, // a LEADING space is not consumed: strict
    { text: ". enrollTile", length: 1, separators: "." }, // the space AFTER is not part of the run
    { text: ".#count", length: 1, separators: "." }, // the `#` is not eaten - this is the round-3 fix
    { text: ":name", length: 0, separators: "" }, // a lone colon is not a separator
  ];
  for (const r of rows) {
    eq(separatorRunAt(r.text), r.length, r.separators, JSON.stringify(r.text));
  }
});

test("separatorRunTolerant walks EVERY pass, not just the first: a repeat joined by two separators with junk between them is one run, which is what refuses `. . NAME` and `. /*c*/ . NAME`", () => {
  // Each row is the text sitting after a landed member name. The backstop asks
  // whether the name re-appears after a separator run; a single-pass walk sees
  // only the first `.` and reports the rest as content, so the repeat escapes.
  const rows = [
    { text: ". . enrollTile(t);", separators: ".." },
    { text: ". /*c*/ . enrollTile(t);", separators: ".." },
    { text: ".  .  .enrollTile", separators: "..." },
    { text: "?. ?. enrollTile", separators: "?.?." },
    { text: ":: :: enrollTile", separators: "::::" },
  ];
  for (const r of rows) {
    const got = separatorRunTolerant(r.text);
    assert.strictEqual(
      got.separators,
      r.separators,
      `${JSON.stringify(r.text)}: a single pass would stop at ${JSON.stringify(got.separators)} and let the repeat through`,
    );
    // The name starts exactly where the run ends. If length under-counts, the
    // caller slices into the middle of the run and the twice-spelled test reads
    // the wrong string.
    assert.strictEqual(
      r.text.slice(got.length).startsWith("enrollTile"),
      true,
      `${JSON.stringify(r.text)}: length must land on the name`,
    );
  }
});

test("a line comment ENDS the run rather than being walked through: it comments out the rest of the single line the caller passes, so a `. NAME` after it is not a live repeat", () => {
  // The tail the caller passes is a slice of ONE line. A `//` masks to
  // end-of-line, so `. // c . enrollTile` has no live second separator on that
  // line - the repeat is commented out, and reporting only the first `.` is
  // correct rather than a missed pass. `lead`'s `[^\S\n]` stops at the newline
  // for the same reason: nothing the caller passes crosses one.
  const got = separatorRunTolerant(". // . enrollTile");
  assert.strictEqual(got.separators, ".", "the commented-out separator is not part of the run");
});

test("separatorRunTolerant reports zero when there is no separator, even past a lead, so a caller cannot read a run out of pure whitespace", () => {
  const rows = [
    { text: "enrollTile", length: 0 },
    { text: "   enrollTile", length: 0 }, // a lead with no separator is still no run
    { text: " /*c*/ enrollTile", length: 0 },
    { text: "", length: 0 },
  ];
  for (const r of rows) {
    const got = separatorRunTolerant(r.text);
    eq(got, r.length, "", JSON.stringify(r.text));
  }
});
