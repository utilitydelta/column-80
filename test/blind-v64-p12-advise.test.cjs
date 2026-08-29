// BLIND ORACLE: the model-authored advice path (session-v64 phase 12).
//
// Written from `session-v64/contracts/advise.md` ALONE, plus
// `src/core/criticizeTypes.ts` for `FunctionUnderReview` / `CriticizeLang` /
// `DimensionId` so the fixtures below are well formed, and
// `src/core/criticizeLang.ts`'s `criticizeLangFor` so the language profile is
// the real one rather than a hand-rolled stub.
// `src/core/criticizeAdvise.ts` (the module under test) was never opened while
// this file was written, and neither was `criticizeHonesty.ts` nor
// `criticizeHonestyModel.ts`. Nothing here asserts an internal.
//
// WHAT THIS FILE IS DEFENDING. The model now writes the comment AND says where
// it goes. The whole risk is a comment planted about code that is not there:
// an anchor that matches nothing placed "somewhere near", an anchor that
// matches two identical lines placed on the wrong one, two comments stacked on
// one line, or the reply's own text becoming the `lineText` the product shows
// as the developer's code. A2, A2b, A3, A4 and A5 are those, and they get the
// most rows.
//
// CONTRACT REVISED TWICE ON 2026-08-29, and this file follows the current text:
//
//  - A5 NOW REQUIRES THE RAW LINE. The first pass reported that A5 was
//    unfalsifiable: a match only happens when `anchor.trim()` equals the
//    line's trim, so a TRIMMED `lineText` is byte-identical whichever source
//    it came from. The contract and the implementation both changed to the
//    raw line, and the old `A5 LIMIT` row is now a real assertion on an
//    indented fixture.
//  - `AdviceBlock` GAINED AN OPTIONAL `line`, and A2b makes it a TIE-BREAKER
//    and never an authority. That is the one place a NUMBER can influence
//    placement, so it is attacked hardest: a `line` naming a non-matching
//    line, a `line` outside the function, and eleven junk `line` values must
//    all be ignored, while a `line` naming one of two identical matches must
//    recover the block and hand back THAT line's raw text.
//  - `UnplacedAdvice.reason` IS NOW A UNION OF THREE EXACT STRINGS, and A4's
//    collision has its own. Every unplaced row below asserts the exact string.
//    The A4 REGRESSION row is the one that would have caught the live defect:
//    a fixture whose every line is distinct cannot produce an ambiguity
//    reason, so a collision misreported as one fails there.
//  - A9 pins the kind, A12 pins the cap's order, A14 is a four-outcome table
//    split by `failure.kind`, A15 names the dimension IDS, and A16b requires
//    the phrase `reported nothing` in BOTH directions.
//  - A4 WAS RELAXED from one block per line to `ADVICE_MAX_PER_LINE`, and the
//    old `another block already took this line` reason left the union. Nine
//    rows went red against the old rule and are rewritten; one sweep proves
//    the retired string can no longer be produced. A4b is new and its
//    within-line ordering gets the sharpest rows, because a sort keyed on the
//    line number that is not STABLE reorders a model's two sentences about
//    one statement silently.
//  - A9b IS NEW: a bare top-level JSON array IS the blocks array, after a
//    fenced bare array turned out to be the only unreadable reply one live
//    model produced across ten functions. The risk is loosening further than
//    intended, so that section splits: what the unwrapping accepts, and a
//    fourteen-shape table of what must STILL be unreadable.
//  - A19b IS NEW, from this file's own open note: the two shapes disagreed
//    about the same verdict, so `@@none` now says "nothing to say" in the
//    line shape and an EMPTY reply stays unreadable in both. That negative
//    half is the one place in this contract where leniency would produce a
//    FALSE CLEAN rather than a lost comment, and it gets the sharpest rows.
//  - A19 IS NEW: two reply shapes. The line shape's exact spelling is
//    DISCOVERED by probing `readAdviceReply`, never copied out of the prompt,
//    so no row here is married to a separator the contract declines to pin.
//  - A10a WAS REVERSED BY THESE ROWS. It first said a half fence is not a
//    fence and the reply is `unreadable`; four rows went red against the
//    implementation, and the measurement that followed found the strict
//    wording was the defect. Each half is now stripped independently and what
//    remains is parsed on its merits. The truncation the strict version was
//    reaching for is caught by the JSON parse instead, and the
//    FENCE_TRUNCATIONS rows are where that is now pinned.
//
// Run: SKIP_LIVE=1 node --test test/blind-v64-p12-advise.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { bundleCore } = require("./.blind-util.cjs");

// ===========================================================================
// Loading, and failing legibly rather than with a loader stack trace
// ===========================================================================

const TAG = "blind-v64-p12-advise";
const BUNDLE_PATH = path.join(__dirname, `.${TAG}.bundle.cjs`);
const ENTRY_PATH = path.join(__dirname, `.${TAG}.entry.ts`);

let mod = null;
let loadError = null;
let cleanup = () => {};
try {
  const loaded = bundleCore(
    TAG,
    `export * from "../src/core/criticizeAdvise";\n` +
      `export { criticizeLangFor } from "../src/core/criticizeLang";\n`,
  );
  mod = loaded.mod;
  cleanup = loaded.cleanup;
} catch (err) {
  loadError = err;
  // bundleCore writes its entry BEFORE esbuild runs, so a resolve failure
  // leaves both files behind. Don't litter.
  cleanup = () => {
    for (const leftover of [ENTRY_PATH, BUNDLE_PATH]) {
      fs.rmSync(leftover, { force: true });
    }
  };
}
test.after(() => cleanup());

const SURFACE = ["ADVICE_MAX_BLOCKS", "buildAdvicePrompt", "readAdviceReply", "placeAdvice", "adviseFunction"];

/** One exported symbol, or a failure naming exactly what is missing. */
function need(name) {
  if (loadError) {
    throw new Error(`src/core/criticizeAdvise does not bundle: ${loadError.message}`);
  }
  const value = mod[name];
  if (value === undefined) {
    throw new Error(`the contract puts \`${name}\` on the surface, but the module exports no such symbol`);
  }
  return value;
}

// ===========================================================================
// Fixtures
//
// Real profile, real-looking slices. Every fixture is DOC COMMENT FIRST, as
// `FunctionUnderReview.lines` requires.
// ===========================================================================

const LANG = (() => {
  if (loadError) return null;
  const criticizeLangFor = mod.criticizeLangFor;
  return criticizeLangFor ? criticizeLangFor("typescript") : null;
})();

// A distinctive token planted in the body so the A15/A16 "the prompt is not
// simply empty" controls have something real to look for.
const BODY_MARKER = "ZZBODYMARKER";

// Fixture 1: a doc comment, a blank line, unique body lines, and the natural
// `}` / `  }` pair that trims to one string (a free A3 case).
//
//   doc line 10 is lines[0], so a document line is 10 + index.
const WIDTHS_LINES = [
  "/** Adds up the widths of the cells in a row. */",
  "export function totalWidth(cells: Cell[]): number {",
  `  let total = 0; // ${BODY_MARKER}`,
  "",
  "  for (const cell of cells) {",
  "    total += cell.width;",
  "  }",
  "  return total;",
  "}",
];
const WIDTHS_START = 10;
const widths = () => ({
  languageId: "typescript",
  name: "totalWidth",
  lines: WIDTHS_LINES.slice(),
  startLine: WIDTHS_START,
  headIndex: 1,
  bodyIndex: 2,
});
/** Document line of an index into WIDTHS_LINES. */
const wline = (i) => WIDTHS_START + i;

const DOC_LINE = WIDTHS_LINES[0];          // index 0, document line 10
const HEAD_LINE = WIDTHS_LINES[1];         // index 1, document line 11
const BLANK_INDEX = 3;                     // document line 13
const RETURN_LINE = "  return total;";     // index 7, document line 17
const FOR_LINE = "  for (const cell of cells) {"; // index 4, document line 14

// Fixture 2: two byte-identical body lines, on purpose.
const DISPATCH_LINES = [
  "// Sends the payload, waits, sends it again.",
  "function dispatch(payload: Payload): void {",
  "  send(payload);",
  "  wait();",
  "  send(payload);",
  "}",
];
const DISPATCH_START = 100;
const dispatch = () => ({
  languageId: "typescript",
  name: "dispatch",
  lines: DISPATCH_LINES.slice(),
  startLine: DISPATCH_START,
  headIndex: 1,
  bodyIndex: 2,
});

// The three reasons `UnplacedAdvice.reason` may carry, as the contract's union
// spells them. Free text is no longer allowed: a wrong reason on a dropped
// block is a false lead in the one channel line that explains the drop, and on
// the first live run a collision reported as an ambiguity sent a reader
// hunting for duplicate lines in a file that had none.
const REASON = {
  NO_MATCH: "no line matches this anchor",
  AMBIGUOUS: "more than one line matches this anchor",
  FULL: "this line already carries the most comments one line may take",
};
const ALL_REASONS = Object.values(REASON);

// The string A4 used while it said ONE block per line. It is out of the union
// as of the 2026-08-29 relaxation, and a sweep below proves no round can still
// produce it.
const RETIRED_REASON = "another block already took this line";

// Fixture 3: FOUR LINES, EVERY ONE DISTINCT. Nothing in this function can be
// ambiguous, so any "more than one line matches" out of it is a wrong reason
// rather than a wrong placement. This is the shape of the live three-line
// TypeScript function whose collisions were misreported.
const TINY_LINES = [
  "/** The human label for a status code. */",
  "export function label(code: number): string {",
  "  return CODES[code] ?? FALLBACK;",
  "}",
];
const TINY_START = 200;
const tiny = () => ({
  languageId: "typescript",
  name: "label",
  lines: TINY_LINES.slice(),
  startLine: TINY_START,
  headIndex: 1,
  bodyIndex: 2,
});

/** A well-formed block. */
const block = (anchor, text = "this line is doing two jobs", dimension = "cqs") => ({ dimension, anchor, text });

/** The reply spelling the contract pins: JSON carrying a `blocks` array. */
const reply = (blocks) => JSON.stringify({ blocks });

const DIAGS = [
  { line: 12, severity: "warning", source: "ts", code: "TS6133", message: "the accumulator is written before it is read" },
  { line: 17, severity: "error", source: "ts", code: "", message: "a returned width can be fractional here" },
];
const CALLEES = [
  { name: "widthOf", signature: "widthOf(cell: Cell): number", doc: "The rendered width of one cell." },
  { name: "wait", signature: "wait(): void", doc: "" },
];

// The fourteen `DimensionId` values, from `src/core/criticizeTypes.ts`. This is
// the only written list of "the rubric's dimensions" available to a blind
// oracle; see the report for the spelling ambiguity in A15.
const DIMENSION_IDS = [
  "clock", "prng", "env", "world",
  "adjacent-params", "bool-param", "param-count",
  "undocumented", "unenforced-precondition", "cqs",
  "pass-through", "nesting",
  "unadmitted-failure",
  "section-comment",
];

// A15's banned spellings, exactly as the contract writes them.
const BANNED_SPELLINGS = ["Instant::now", "os.environ", "console.log", "Directory.GetFiles", "thread_rng"];

// A16's forbidden renders. `undefined` and `[object Object]` are the
// contract's own two; `null` and `NaN` are the same defect wearing a
// different hat. No fixture in this file contains any of these four as text,
// so a hit is the prompt builder's, not the fixture's.
const FORBIDDEN_RENDERS = ["undefined", "[object Object]", "NaN", "null"];

// ===========================================================================
// Helpers
// ===========================================================================

/** Reject rather than hang: a stalled suite reports nothing at all. */
function withDeadline(promise, ms, what) {
  let timer;
  const alarm = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} did not settle within ${ms}ms; it hung`)), ms);
  });
  return Promise.race([Promise.resolve(promise), alarm]).finally(() => clearTimeout(timer));
}

/** One whole round against a transport that answers `raw`. */
function round(raw, fn = widths(), evidence = {}) {
  const adviseFunction = need("adviseFunction");
  return withDeadline(adviseFunction(async () => raw, fn, LANG, evidence), 5000, "adviseFunction");
}

/** One whole round against a transport that misbehaves. */
function roundWith(transport, fn = widths(), evidence = {}) {
  const adviseFunction = need("adviseFunction");
  return withDeadline(adviseFunction(transport, fn, LANG, evidence), 5000, "adviseFunction");
}

const place = (blocks, fn = widths()) => need("placeAdvice")(fn, blocks);
const read = (raw) => need("readAdviceReply")(raw);
const prompt = (evidence, fn = widths()) => need("buildAdvicePrompt")(fn, LANG, evidence);
/** buildAdvicePrompt with A19's explicit fourth argument. */
const promptAs = (evidence, format, fn = widths()) => need("buildAdvicePrompt")(fn, LANG, evidence, format);

/** The document's own lines, RAW. A5 (corrected 2026-08-29) requires
 *  `lineText` to be exactly one of these, indentation included. That is the
 *  whole falsifiability of A5: a match only ever happens when the anchor's
 *  TRIM equals the line's trim, so a trimmed `lineText` would be
 *  byte-identical whichever source it came from. The raw line is not. */
function documentLines(fn) {
  return new Set(fn.lines);
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

// ===========================================================================
// Surface
// ===========================================================================

test("surface: the module exports every symbol the contract names", () => {
  if (loadError) throw new Error(`src/core/criticizeAdvise does not bundle: ${loadError.message}`);
  const missing = SURFACE.filter((name) => mod[name] === undefined);
  assert.deepStrictEqual(missing, [], `the contract names these exports and the module has none of them: ${missing}`);
});

test("surface: the real TypeScript profile loaded, so the fixtures use a real language", () => {
  assert.ok(LANG, "criticizeLangFor(\"typescript\") gave no profile, so every prompt row below is meaningless");
  assert.strictEqual(LANG.displayName, "TypeScript");
});

test("surface: ADVICE_MAX_BLOCKS is a positive integer", () => {
  const max = need("ADVICE_MAX_BLOCKS");
  assert.strictEqual(typeof max, "number");
  assert.ok(Number.isInteger(max) && max >= 1, `ADVICE_MAX_BLOCKS is ${max}, which cannot cap anything`);
});

// ===========================================================================
// A1. Placement is by TEXT, trimmed, and exact after the trim
// ===========================================================================

test("A1: an anchor with no indentation at all places on the line it quotes", () => {
  const { placed, unplaced } = place([block("return total;")]);
  assert.strictEqual(unplaced.length, 0, `expected a place, got unplaced: ${JSON.stringify(unplaced)}`);
  assert.strictEqual(placed.length, 1);
  assert.strictEqual(placed[0].line, wline(7));
});

test("A1: an anchor with heavier indentation than the line still places on it", () => {
  const { placed } = place([block("\t\t\t      return total;   ")]);
  assert.strictEqual(placed.length, 1);
  assert.strictEqual(placed[0].line, wline(7));
});

test("A1: whitespace INSIDE the line is not trimmed away, so a re-spaced anchor does not place", () => {
  const { placed, unplaced } = place([block("return  total;")]);
  assert.strictEqual(placed.length, 0, "a doubly-spaced anchor was placed, so the comparison is not exact after the trim");
  assert.strictEqual(unplaced.length, 1);
});

test("A1: the comparison is case sensitive", () => {
  const { placed, unplaced } = place([block("Return total;")]);
  assert.strictEqual(placed.length, 0, "a case-changed anchor was placed, so the comparison is not exact");
  assert.strictEqual(unplaced.length, 1);
});

// ===========================================================================
// A2. An anchor matching NOTHING is unplaced, never guessed
//
// The load-bearing group. Every shape of "nearly right" here must come back
// unplaced, and `placed` must stay empty: no nearest match, no top-of-function
// fallback.
// ===========================================================================

test("A2: an anchor quoting a line that is not in the function is unplaced", () => {
  const { placed, unplaced } = place([block("const cached = memo.get(key);")]);
  assert.deepStrictEqual(placed, [], "a block whose anchor matches nothing was placed somewhere");
  assert.strictEqual(unplaced.length, 1);
  assert.strictEqual(unplaced[0].block.anchor, "const cached = memo.get(key);");
});

test("A2: the unplaced row's reason is exactly `no line matches this anchor`", () => {
  const { unplaced } = place([block("const cached = memo.get(key);")]);
  assert.strictEqual(unplaced[0].reason, REASON.NO_MATCH);
});

test("A2: every shape of miss gives the SAME reason, and never the ambiguity one", () => {
  const misses = ["total", "return total; // and log it", "return totals;", "  send(payload);", "Return total;", "return  total;"];
  for (const anchor of misses) {
    const { unplaced } = place([block(anchor)]);
    assert.strictEqual(unplaced.length, 1);
    assert.strictEqual(unplaced[0].reason, REASON.NO_MATCH, `the anchor ${JSON.stringify(anchor)} was refused as ${JSON.stringify(unplaced[0].reason)}`);
  }
});

test("A2: a SUBSTRING of a real line is not a match", () => {
  const { placed, unplaced } = place([block("total")]);
  assert.deepStrictEqual(placed, [], "a bare substring was accepted as an anchor, so matching is not exact");
  assert.strictEqual(unplaced.length, 1);
});

test("A2: a SUPERSTRING of a real line is not a match", () => {
  const { placed, unplaced } = place([block("return total; // and log it")]);
  assert.deepStrictEqual(placed, [], "an anchor with extra text was accepted, so matching is not exact");
  assert.strictEqual(unplaced.length, 1);
});

test("A2: a near-miss on one character is not fuzzily matched", () => {
  const { placed } = place([block("return totals;")]);
  assert.deepStrictEqual(placed, [], "a one-character-off anchor was placed, which is a fuzzy match");
});

test("A2: an anchor from a DIFFERENT function is unplaced, not placed at the top", () => {
  const { placed, unplaced } = place([block("  send(payload);")]);
  assert.deepStrictEqual(placed, [], "a foreign line's anchor was placed inside this function");
  assert.strictEqual(unplaced.length, 1);
});

test("A2: several unmatchable anchors all come back unplaced, and none is guessed", () => {
  const anchors = ["nothing();", "alsoNothing();", "return elsewhere;", "// not here"];
  const { placed, unplaced } = place(anchors.map((a) => block(a)));
  assert.deepStrictEqual(Array.from(placed), []);
  assert.strictEqual(unplaced.length, anchors.length);
  assert.deepStrictEqual(unplaced.map((u) => u.block.anchor), anchors);
  assert.deepStrictEqual(unplaced.map((u) => u.reason), anchors.map(() => REASON.NO_MATCH));
});

test("A2: an unmatchable anchor beside a matchable one loses only itself", () => {
  const { placed, unplaced } = place([block("nothing();"), block("return total;")]);
  assert.strictEqual(placed.length, 1);
  assert.strictEqual(placed[0].line, wline(7));
  assert.strictEqual(unplaced.length, 1);
  assert.strictEqual(unplaced[0].block.anchor, "nothing();");
});

// ===========================================================================
// A2b. `line` is a TIE-BREAKER and never an authority
//
// The one place a NUMBER can influence placement, so it gets attacked hardest.
// The design rests on `line` being unable to move a block onto code the anchor
// did not name: it is consulted ONLY to choose among lines whose text already
// matched. Every row below feeds a `line` that a naive implementation would
// obey and checks that it was ignored.
//
// Numbering: `line` is a 1-based DOCUMENT line, like everything else on this
// surface. The dispatch fixture starts at document line 100, so an
// implementation reading `line` as an index into `fn.lines` fails these rows.
// ===========================================================================

/** A block with a tie-breaker line. */
const lineBlock = (anchor, line, text = "x", dimension = "cqs") => ({ dimension, anchor, text, line });

test("A2b: a `line` naming a line whose TEXT does not match is ignored, and the block stays unplaced", () => {
  // The anchor matches nothing. `line` names the return line, which is real
  // and in range. Obeying it would plant a comment about code the model never
  // quoted.
  const { placed, unplaced } = place([lineBlock("cache.get(key);", wline(7))]);
  assert.deepStrictEqual(Array.from(placed), [], `\`line\` moved a block onto a line the anchor did not name: ${JSON.stringify(placed)}`);
  assert.strictEqual(unplaced.length, 1);
  assert.strictEqual(unplaced[0].reason, REASON.NO_MATCH, "a block refused for having no text match blamed something else");
});

test("A2b: a `line` naming the doc comment cannot rescue an anchor that matches nothing", () => {
  const { placed, unplaced } = place([lineBlock("nothing at all here", wline(0))]);
  assert.deepStrictEqual(Array.from(placed), []);
  assert.strictEqual(unplaced.length, 1);
});

test("A2b: a `line` OUTSIDE the function is ignored", () => {
  for (const n of [1, 9, WIDTHS_START + 500, -3, 0]) {
    const { placed } = place([lineBlock("cache.get(key);", n)]);
    assert.deepStrictEqual(Array.from(placed), [], `\`line\` ${n} placed a block whose anchor matches nothing`);
  }
});

test("A2b: a `line` outside the function does not disturb an ambiguous anchor either", () => {
  const { placed, unplaced } = place([lineBlock("send(payload);", 9999)], dispatch());
  assert.deepStrictEqual(Array.from(placed), [], "an out-of-range tie-breaker was used to pick a match");
  assert.strictEqual(unplaced.length, 1);
});

const JUNK_LINES = [
  ["a non-integer", 104.5],
  ["NaN", Number.NaN],
  ["Infinity", Number.POSITIVE_INFINITY],
  ["negative", -104],
  ["zero", 0],
  ["a numeric string", "104"],
  ["a non-numeric string", "line 104"],
  ["null", null],
  ["a boolean", true],
  ["an object", { line: 104 }],
  ["an array", [104]],
];

for (const [label, junk] of JUNK_LINES) {
  test(`A2b: \`line\` as ${label} is ignored, so an ambiguous anchor stays unplaced`, () => {
    const { placed, unplaced } = place([lineBlock("send(payload);", junk)], dispatch());
    assert.deepStrictEqual(Array.from(placed), [], `a \`line\` of ${JSON.stringify(junk)} was used to break a tie`);
    assert.strictEqual(unplaced.length, 1);
    assert.strictEqual(unplaced[0].reason, REASON.AMBIGUOUS);
  });

  test(`A2b: \`line\` as ${label} does not stop a UNIQUE anchor placing`, () => {
    const { placed, unplaced } = place([lineBlock("wait();", junk)], dispatch());
    assert.strictEqual(unplaced.length, 0, `a junk \`line\` (${label}) broke an unambiguous placement: ${JSON.stringify(unplaced)}`);
    assert.strictEqual(placed[0].line, DISPATCH_START + 3);
  });
}

test("A2b: a `line` beside a UNIQUE anchor changes nothing when it agrees", () => {
  const without = place([block("return total;")]);
  const with_ = place([lineBlock("return total;", wline(7))]);
  assert.strictEqual(with_.placed.length, 1);
  assert.strictEqual(with_.placed[0].line, without.placed[0].line);
  assert.strictEqual(with_.placed[0].lineText, without.placed[0].lineText);
});

test("A2b: a WRONG `line` beside a unique anchor does not move the block", () => {
  // One match, so there is nothing to choose among: A2b says `line` is only
  // consulted to pick between matches. The anchor wins.
  const { placed, unplaced } = place([lineBlock("return total;", wline(0))]);
  assert.strictEqual(unplaced.length, 0, `a disagreeing \`line\` unplaced an unambiguous block: ${JSON.stringify(unplaced)}`);
  assert.strictEqual(placed[0].line, wline(7), "`line` overrode a unique text match, which makes it an authority");
  assert.strictEqual(placed[0].lineText, RETURN_LINE);
});

test("A2b: a `line` pointing at the BLANK line is ignored", () => {
  const { placed } = place([lineBlock("return total;", wline(BLANK_INDEX))]);
  assert.strictEqual(placed[0].line, wline(7), "the tie-breaker moved a block onto the blank line");
});

test("A2b: a `line` naming a real line that is NOT one of the matches is ignored", () => {
  // "send(payload);" matches document lines 102 and 104. `line` names 103,
  // which is a real line of the function and matches nothing. It is not one
  // of the matches, so the ambiguity stands.
  const { placed, unplaced } = place([lineBlock("send(payload);", DISPATCH_START + 3)], dispatch());
  assert.deepStrictEqual(Array.from(placed), [], "a `line` naming a non-matching line was used to break the tie");
  assert.strictEqual(unplaced.length, 1);
  assert.strictEqual(unplaced[0].reason, REASON.AMBIGUOUS);
});

test("A2b: the tie-breaker survives a whole round through adviseFunction", async () => {
  const raw = reply([{ dimension: "cqs", anchor: "send(payload);", text: "the retry is silent", line: DISPATCH_START + 4 }]);
  const out = await round(raw, dispatch());
  assert.strictEqual(out.placed.length, 1, `the tie-breaker did not reach placeAdvice through adviseFunction: ${JSON.stringify(out)}`);
  assert.strictEqual(out.placed[0].line, DISPATCH_START + 4);
});

test("A2b: an out-of-range `line` survives readAdviceReply rather than dropping the block", () => {
  // A11 lists the three fields whose absence or wrongness drops a block, and
  // `line` is not among them. A bad tie-breaker is ignored at placement, not
  // grounds for discarding the model's comment.
  const out = read(JSON.stringify({ blocks: [{ dimension: "cqs", anchor: "wait();", text: "a", line: 9999 }] }));
  assert.strictEqual(out.ok, true);
  assert.strictEqual(out.blocks.length, 1, "a block was dropped over its optional `line`, which A11 does not list as a required field");
});

// ===========================================================================
// A3. An anchor matching MORE THAN ONE line is unplaced, UNLESS `line` names
//     one of the matches
// ===========================================================================

test("A3: an anchor matching two identical body lines is unplaced", () => {
  const { placed, unplaced } = place([block("send(payload);")], dispatch());
  assert.deepStrictEqual(Array.from(placed), [], "an ambiguous anchor was placed on one of two identical lines");
  assert.strictEqual(unplaced.length, 1);
});

test("A3: the ambiguous block's reason is exactly `more than one line matches this anchor`", () => {
  const { unplaced } = place([block("send(payload);")], dispatch());
  assert.strictEqual(unplaced[0].reason, REASON.AMBIGUOUS);
});

test("A3: the duplicated closing brace is refused as an ambiguity, not as a miss", () => {
  const { unplaced } = place([block("}")]);
  assert.strictEqual(unplaced[0].reason, REASON.AMBIGUOUS);
});

test("A3: indentation does not rescue an ambiguity, because the compare is trimmed", () => {
  const { placed } = place([block("  send(payload);")], dispatch());
  assert.deepStrictEqual(Array.from(placed), [], "the indentation was used to disambiguate, and A1 says indentation does not identify a line");
});

test("A3: the naturally duplicated closing brace is ambiguous too", () => {
  // WIDTHS_LINES has `  }` and `}`, which trim to the same string.
  const { placed, unplaced } = place([block("}")]);
  assert.deepStrictEqual(Array.from(placed), [], "`}` was placed although two lines of the slice trim to it");
  assert.strictEqual(unplaced.length, 1);
});

test("A3: a DISTINCTIVE line in the same ambiguous function still places (the rig can place)", () => {
  const { placed, unplaced } = place([block("wait();")], dispatch());
  assert.strictEqual(unplaced.length, 0, `expected a place, got: ${JSON.stringify(unplaced)}`);
  assert.strictEqual(placed.length, 1);
  assert.strictEqual(placed[0].line, DISPATCH_START + 3);
});

test("A3: one ambiguous anchor beside one distinctive anchor loses only itself", () => {
  const { placed, unplaced } = place([block("send(payload);"), block("wait();")], dispatch());
  assert.strictEqual(placed.length, 1);
  assert.strictEqual(placed[0].block.anchor, "wait();");
  assert.strictEqual(unplaced.length, 1);
  assert.strictEqual(unplaced[0].block.anchor, "send(payload);");
});

// The amendment: `line` naming one of the matches recovers the block. This is
// the case that cost two of fourteen placements on the first live Opus run,
// both of them one TypeScript signature line appearing twice in its file.

test("A3+A2b: `line` naming the FIRST of two identical lines places on it", () => {
  const fn = dispatch();
  const { placed, unplaced } = place([lineBlock("send(payload);", DISPATCH_START + 2, "the first send is unguarded")], fn);
  assert.strictEqual(unplaced.length, 0, `the tie-breaker did not recover the block: ${JSON.stringify(unplaced)}`);
  assert.strictEqual(placed.length, 1);
  assert.strictEqual(placed[0].line, DISPATCH_START + 2);
  assert.strictEqual(placed[0].lineText, DISPATCH_LINES[2], "lineText is not the raw text of the line `line` named");
});

test("A3+A2b: `line` naming the SECOND of two identical lines places on THAT one", () => {
  const { placed, unplaced } = place([lineBlock("send(payload);", DISPATCH_START + 4, "the retry is silent")], dispatch());
  assert.strictEqual(unplaced.length, 0, `the tie-breaker did not recover the block: ${JSON.stringify(unplaced)}`);
  assert.strictEqual(placed[0].line, DISPATCH_START + 4, "the tie-breaker picked the wrong one of the two matches");
  assert.strictEqual(placed[0].lineText, DISPATCH_LINES[4]);
});

test("A3+A2b: the two tie-break targets are genuinely different lines of the document", () => {
  const first = place([lineBlock("send(payload);", DISPATCH_START + 2)], dispatch());
  const second = place([lineBlock("send(payload);", DISPATCH_START + 4)], dispatch());
  assert.notStrictEqual(first.placed[0].line, second.placed[0].line,
    "both tie-breakers landed on one line, so `line` is not actually choosing");
});

test("A3+A2b: the duplicated closing brace can be disambiguated too", () => {
  const { placed, unplaced } = place([lineBlock("}", wline(8))]);
  assert.strictEqual(unplaced.length, 0, `the brace tie-break was refused: ${JSON.stringify(unplaced)}`);
  assert.strictEqual(placed[0].line, wline(8));
  assert.strictEqual(placed[0].lineText, "}");
});

test("A3+A2b: two blocks tie-breaking onto the SAME match both place (A4 is per-line, not one)", () => {
  const blocks = [
    lineBlock("send(payload);", DISPATCH_START + 2, "a"),
    lineBlock("send(payload);", DISPATCH_START + 2, "b"),
  ];
  const { placed, unplaced } = place(blocks, dispatch());
  assert.deepStrictEqual(Array.from(unplaced), [], `both blocks named the same real match and one was refused: ${JSON.stringify(unplaced)}`);
  assert.deepStrictEqual(placed.map((r) => r.line), [DISPATCH_START + 2, DISPATCH_START + 2]);
});

test("A3+A2b: two blocks tie-breaking onto DIFFERENT matches both place, ascending", () => {
  const blocks = [
    lineBlock("send(payload);", DISPATCH_START + 4, "the retry is silent"),
    lineBlock("send(payload);", DISPATCH_START + 2, "the first send is unguarded"),
  ];
  const { placed, unplaced } = place(blocks, dispatch());
  assert.strictEqual(unplaced.length, 0, `both matches were named and one was still refused: ${JSON.stringify(unplaced)}`);
  assert.deepStrictEqual(placed.map((row) => row.line), [DISPATCH_START + 2, DISPATCH_START + 4]);
  assert.deepStrictEqual(placed.map((row) => row.lineText), [DISPATCH_LINES[2], DISPATCH_LINES[4]]);
});

// ===========================================================================
// A4.  Up to `ADVICE_MAX_PER_LINE` blocks may share a line
// A4b. Blocks sharing a line keep the order the model wrote them in, and the
//      whole `placed` array is ascending by line
//
// RELAXED 2026-08-29. A4 first allowed ONE block per line, justified as "two
// comments on one line is how the tool read its own output as the code". That
// named the wrong defect: v62's S62-7 was the tool reading its own comments
// ACROSS PRESSES, which the strip pass handles, and the rubric's own planner
// has always grouped several findings onto one line. The rule cost more than
// it bought: same-line collision was the LARGEST single loss bucket on every
// model measured, 20 of 21 dropped blocks on one, 16 of 20 on another, and
// those were second things to say about a line that already had a comment.
//
// The BOUND survives, because a wall of comment above one statement is its own
// defect and `ADVICE_MAX_BLOCKS` alone does not stop six landing on one line.
//
// A4b's within-line ordering gets the most rows here: a stable sort keyed on
// the line number is the part most likely to be wrong, and a sort that is not
// stable reorders a model's two sentences about one statement silently.
// ===========================================================================

test("A4: ADVICE_MAX_PER_LINE is an integer of at least 2", () => {
  const perLine = need("ADVICE_MAX_PER_LINE");
  assert.strictEqual(typeof perLine, "number");
  assert.ok(Number.isInteger(perLine) && perLine >= 2,
    `ADVICE_MAX_PER_LINE is ${perLine}; at 1 or less the relaxation did not happen and A4b has nothing to order`);
});

test("A4: ADVICE_MAX_PER_LINE does not exceed ADVICE_MAX_BLOCKS", () => {
  assert.ok(need("ADVICE_MAX_PER_LINE") <= need("ADVICE_MAX_BLOCKS"),
    "the per-line bound is looser than the whole-reply cap, so it can never bind");
});

test("A4: exactly ADVICE_MAX_PER_LINE blocks on one line ALL place", () => {
  const perLine = need("ADVICE_MAX_PER_LINE");
  const blocks = Array.from({ length: perLine }, (_, n) => block("return total;", `say ${n}`, "cqs"));
  const { placed, unplaced } = place(blocks);
  assert.deepStrictEqual(Array.from(unplaced), [], `a round at exactly the bound dropped something: ${JSON.stringify(unplaced)}`);
  assert.strictEqual(placed.length, perLine);
  for (const row of placed) assert.strictEqual(row.line, wline(7));
});

test("A4: one block PAST the bound is unplaced, and the rest still place", () => {
  const perLine = need("ADVICE_MAX_PER_LINE");
  const blocks = Array.from({ length: perLine + 1 }, (_, n) => block("return total;", `say ${n}`, "cqs"));
  const { placed, unplaced } = place(blocks);
  assert.strictEqual(placed.length, perLine);
  assert.strictEqual(unplaced.length, 1);
  assert.strictEqual(unplaced[0].reason, REASON.FULL);
});

test("A4: the over-budget reason is exactly the union's third string", () => {
  const perLine = need("ADVICE_MAX_PER_LINE");
  const blocks = Array.from({ length: perLine + 3 }, (_, n) => block("return total;", `say ${n}`, "cqs"));
  const { unplaced } = place(blocks);
  assert.strictEqual(unplaced.length, 3);
  assert.deepStrictEqual(unplaced.map((u) => u.reason), [REASON.FULL, REASON.FULL, REASON.FULL]);
});

test("A4: the blocks that survive the bound are the FIRST in reply order", () => {
  const perLine = need("ADVICE_MAX_PER_LINE");
  const blocks = Array.from({ length: perLine + 2 }, (_, n) => block("return total;", `say ${n}`, "cqs"));
  const { placed, unplaced } = place(blocks);
  assert.deepStrictEqual(placed.map((r) => r.block.text), blocks.slice(0, perLine).map((b) => b.text));
  assert.deepStrictEqual(unplaced.map((r) => r.block.text), blocks.slice(perLine).map((b) => b.text));
});

test("A4: the RETIRED one-per-line reason is gone from every round this suite can build", () => {
  const perLine = need("ADVICE_MAX_PER_LINE");
  for (const make of [widths, dispatch, tiny]) {
    const fn = make();
    const blocks = [];
    for (const line of fn.lines) {
      for (let n = 0; n < perLine + 2; n += 1) blocks.push(block(line.trim() || "  ", `say ${n}`));
    }
    blocks.push(block("absent from every fixture();", "z"));
    const { unplaced } = place(blocks, fn);
    const retired = unplaced.filter((u) => u.reason === RETIRED_REASON);
    assert.deepStrictEqual(retired, [], `${fn.name} still produces the retired reason ${JSON.stringify(RETIRED_REASON)}`);
    for (const row of unplaced) {
      assert.ok(ALL_REASONS.includes(row.reason), `${fn.name} produced the free-text reason ${JSON.stringify(row.reason)}`);
    }
  }
});

test("A4: differently-spaced anchors count against the SAME line's budget", () => {
  const perLine = need("ADVICE_MAX_PER_LINE");
  const spellings = ["return total;", "  return total;", "\t\treturn total;", "     return total;   "];
  const blocks = Array.from({ length: perLine + 1 }, (_, n) => block(spellings[n % spellings.length], `say ${n}`));
  const { placed, unplaced } = place(blocks);
  assert.strictEqual(placed.length, perLine, "two spellings of one line were budgeted separately");
  assert.strictEqual(unplaced.length, 1);
  assert.strictEqual(unplaced[0].reason, REASON.FULL);
});

test("A4 REGRESSION: on a function with NO duplicate lines, an over-budget drop never says ambiguity", () => {
  // The row that caught the live defect, carried forward to the relaxed rule.
  // Every line of `tiny` is distinct, so "more than one line matches this
  // anchor" cannot be true of anything here.
  const perLine = need("ADVICE_MAX_PER_LINE");
  const trimmed = TINY_LINES.map((l) => l.trim());
  assert.strictEqual(new Set(trimmed).size, trimmed.length, "the fixture has duplicate lines, so this row proves nothing");
  const blocks = Array.from({ length: perLine + 2 }, (_, n) => block(trimmed[2], `say ${n}`));
  const { placed, unplaced } = place(blocks, tiny());
  assert.strictEqual(placed.length, perLine);
  assert.deepStrictEqual(unplaced.map((u) => u.reason), [REASON.FULL, REASON.FULL],
    "an over-budget drop on a function with no duplicate lines was reported as an ambiguity, which sends a reader hunting for duplicates that do not exist");
});

test("A4: a full line does not stop a block on a different line", () => {
  const perLine = need("ADVICE_MAX_PER_LINE");
  const blocks = Array.from({ length: perLine + 1 }, (_, n) => block("return total;", `say ${n}`));
  blocks.push(block("let total = 0; // " + BODY_MARKER, "on another line"));
  const { placed, unplaced } = place(blocks);
  assert.strictEqual(placed.length, perLine + 1);
  assert.strictEqual(unplaced.length, 1);
  assert.ok(placed.some((r) => r.line === wline(2)), "a block on an empty line was refused because another line was full");
});

test("A4: the three reasons are distinguishable in one round", () => {
  const perLine = need("ADVICE_MAX_PER_LINE");
  const blocks = [block("nothing();", "a miss"), block("send(payload);", "an ambiguity")];
  for (let n = 0; n <= perLine; n += 1) blocks.push(block("wait();", `on the wait line ${n}`));
  const { placed, unplaced } = place(blocks, dispatch());
  assert.strictEqual(placed.length, perLine);
  assert.deepStrictEqual(unplaced.map((u) => u.reason), [REASON.NO_MATCH, REASON.AMBIGUOUS, REASON.FULL]);
});

test("A4: the bound is per LINE, not per function", () => {
  const perLine = need("ADVICE_MAX_PER_LINE");
  const blocks = [];
  for (let n = 0; n < perLine; n += 1) blocks.push(block("return total;", `return ${n}`));
  for (let n = 0; n < perLine; n += 1) blocks.push(block(DOC_LINE, `doc ${n}`));
  const { placed, unplaced } = place(blocks.slice(0, need("ADVICE_MAX_BLOCKS")));
  assert.deepStrictEqual(Array.from(unplaced), [], `a second line was refused its own budget: ${JSON.stringify(unplaced)}`);
  assert.ok(placed.length > perLine,
    `only ${placed.length} placed against a per-line bound of ${perLine}, so the bound is being applied per function`);
});

test("A4: ADVICE_MAX_BLOCKS still binds before the per-line bound can be reached", async () => {
  const max = need("ADVICE_MAX_BLOCKS");
  const many = Array.from({ length: max + 4 }, (_, n) => ({ dimension: "cqs", anchor: "return total;", text: `say ${n}` }));
  const out = await round(JSON.stringify({ blocks: many }));
  const perLine = need("ADVICE_MAX_PER_LINE");
  assert.strictEqual(out.placed.length, Math.min(perLine, max), `expected ${Math.min(perLine, max)} placements, got ${out.placed.length}`);
  assert.strictEqual(out.placed.length + out.unplaced.length, max,
    "the reply cap and the per-line bound disagree about how many blocks the round ever saw");
  for (const row of out.unplaced) assert.strictEqual(row.reason, REASON.FULL);
});

// --------------------------------------------------------------------- A4b

test("A4b: blocks sharing a line come back in the order the model wrote them", () => {
  const perLine = need("ADVICE_MAX_PER_LINE");
  // Dimensions and texts that sort differently from the input order, so a
  // sort keyed on anything but arrival is visible.
  const seed = [
    { d: "world", t: "zulu: the accumulator is mutable" },
    { d: "adjacent-params", t: "alpha: and it is never reset" },
    { d: "clock", t: "mike: and the caller cannot see either" },
    { d: "nesting", t: "bravo: a fourth thing" },
    { d: "cqs", t: "yankee: a fifth thing" },
  ].slice(0, perLine);
  const blocks = seed.map((x) => block("return total;", x.t, x.d));
  const { placed } = place(blocks);
  assert.strictEqual(placed.length, perLine);
  assert.deepStrictEqual(placed.map((r) => r.block.text), seed.map((x) => x.t),
    "the blocks on one line were reordered; a sort keyed on the line number must be STABLE");
});

test("A4b: reversing the input reverses the within-line output, so it really is arrival order", () => {
  const perLine = need("ADVICE_MAX_PER_LINE");
  const texts = Array.from({ length: perLine }, (_, n) => `say ${n}`);
  const forward = place(texts.map((t) => block("return total;", t)));
  const backward = place(texts.slice().reverse().map((t) => block("return total;", t)));
  assert.deepStrictEqual(forward.placed.map((r) => r.block.text), texts);
  assert.deepStrictEqual(backward.placed.map((r) => r.block.text), texts.slice().reverse(),
    "the within-line order is not the model's; something is sorting the blocks");
});

test("A4b: the within-line order is not alphabetical by text", () => {
  const blocks = [block("return total;", "zulu"), block("return total;", "alpha")];
  const { placed } = place(blocks);
  assert.deepStrictEqual(placed.map((r) => r.block.text), ["zulu", "alpha"]);
});

test("A4b: the within-line order is not alphabetical by dimension", () => {
  const blocks = [block("return total;", "first", "world"), block("return total;", "second", "adjacent-params")];
  const { placed } = place(blocks);
  assert.deepStrictEqual(placed.map((r) => r.block.dimension), ["world", "adjacent-params"]);
});

test("A4b: `placed` is ascending by line while within-line order is preserved", () => {
  // Fed shuffled across three lines. Lines must come out ascending; each
  // line's own blocks must come out in the order they arrived.
  const blocks = [
    block("return total;", "return-1"),          // document line 17
    block(DOC_LINE, "doc-1"),                    // document line 10
    block("return total;", "return-2"),
    block("for (const cell of cells) {", "for-1"), // document line 14
    block(DOC_LINE, "doc-2"),
  ];
  const { placed, unplaced } = place(blocks);
  assert.deepStrictEqual(Array.from(unplaced), [], `nothing should be dropped here: ${JSON.stringify(unplaced)}`);
  assert.deepStrictEqual(placed.map((r) => r.line), [wline(0), wline(0), wline(4), wline(7), wline(7)]);
  assert.deepStrictEqual(placed.map((r) => r.block.text), ["doc-1", "doc-2", "for-1", "return-1", "return-2"]);
});

test("A4b: `placed` line numbers are NON-DECREASING, which is what ascending now means", () => {
  const blocks = [
    block("return total;", "a"), block(DOC_LINE, "b"), block("return total;", "c"), block(DOC_LINE, "d"),
  ];
  const { placed } = place(blocks);
  const lines = placed.map((r) => r.line);
  for (let i = 1; i < lines.length; i += 1) {
    assert.ok(lines[i] >= lines[i - 1], `placed is not ascending: ${lines}`);
  }
  assert.ok(new Set(lines).size < lines.length, "no line repeated, so this row did not exercise the relaxed rule");
});

test("A4b: the MIXED round the relaxation was written for", () => {
  // Two on line A, one on line B, four on line C, fed interleaved. The right
  // ones place, the right one drops, and nothing is reordered.
  const perLine = need("ADVICE_MAX_PER_LINE");
  const overflow = perLine + 1;
  const blocks = [
    block(DOC_LINE, "A1"),
    block("return total;", "C1"),
    block("for (const cell of cells) {", "B1"),
    block(DOC_LINE, "A2"),
    ...Array.from({ length: overflow - 1 }, (_, n) => block("return total;", `C${n + 2}`)),
  ];
  const { placed, unplaced } = place(blocks);
  assert.deepStrictEqual(placed.map((r) => r.line), [wline(0), wline(0), wline(4), ...Array(perLine).fill(wline(7))]);
  assert.deepStrictEqual(
    placed.map((r) => r.block.text),
    ["A1", "A2", "B1", ...Array.from({ length: perLine }, (_, n) => `C${n + 1}`)],
  );
  assert.strictEqual(unplaced.length, 1);
  assert.strictEqual(unplaced[0].block.text, `C${overflow}`);
  assert.strictEqual(unplaced[0].reason, REASON.FULL);
});

test("A4b: within-line order survives the whole round through adviseFunction", async () => {
  const perLine = need("ADVICE_MAX_PER_LINE");
  const texts = Array.from({ length: perLine }, (_, n) => `zz say ${perLine - n}`);
  const out = await round(reply(texts.map((t) => block("return total;", t))));
  assert.deepStrictEqual(out.placed.map((r) => r.block.text), texts);
});

test("A4b: two blocks tie-breaking onto the SAME match both place, in order", () => {
  const blocks = [
    lineBlock("send(payload);", DISPATCH_START + 2, "the first thing"),
    lineBlock("send(payload);", DISPATCH_START + 2, "the second thing"),
  ];
  const { placed, unplaced } = place(blocks, dispatch());
  assert.deepStrictEqual(Array.from(unplaced), [], `the tie-break line was budgeted at one block: ${JSON.stringify(unplaced)}`);
  assert.deepStrictEqual(placed.map((r) => r.line), [DISPATCH_START + 2, DISPATCH_START + 2]);
  assert.deepStrictEqual(placed.map((r) => r.block.text), ["the first thing", "the second thing"]);
});

test("A4b: a tie-broken line has its own budget, and overflow says FULL", () => {
  const perLine = need("ADVICE_MAX_PER_LINE");
  const blocks = Array.from({ length: perLine + 1 }, (_, n) =>
    lineBlock("send(payload);", DISPATCH_START + 4, `say ${n}`));
  const { placed, unplaced } = place(blocks, dispatch());
  assert.strictEqual(placed.length, perLine);
  assert.strictEqual(unplaced.length, 1);
  assert.strictEqual(unplaced[0].reason, REASON.FULL,
    "a tie-break overflow was blamed on the ambiguity the tie-breaker had just resolved");
});

// ===========================================================================
// A5. `lineText` is the RAW document line, indentation included, read out of
//     `fn` and never out of the reply
//
// The sharpest group, and NOW A FALSIFIABLE ONE. A match only ever happens
// when `anchor.trim() === documentLine.trim()`, so a TRIMMED `lineText` is
// byte-identical whichever source it came from and no row could separate the
// two. The raw line is not: every fixture line anchored below is indented and
// every anchor is fed with different whitespace, so one comparison decides it.
// ===========================================================================

test("A5: lineText is the RAW document line, indentation included", () => {
  const { placed } = place([block("\t\treturn total;")]);
  assert.strictEqual(placed.length, 1);
  assert.strictEqual(placed[0].lineText, RETURN_LINE,
    "lineText is not the raw document line, so it cannot be told apart from the reply's own anchor trimmed");
});

test("A5: an anchor with NO indentation still yields the INDENTED document line", () => {
  const { placed } = place([block("return total;")]);
  assert.strictEqual(placed[0].lineText, RETURN_LINE);
  assert.notStrictEqual(placed[0].lineText, "return total;",
    "the reply sent an unindented anchor and got its own string straight back, which is the reply becoming the evidence");
});

test("A5: no character of the anchor's own whitespace survives into lineText", () => {
  const { placed } = place([block("\t\treturn total;   ")]);
  assert.ok(!placed[0].lineText.includes("\t"), "a tab from the reply reached lineText");
  assert.ok(placed[0].lineText.startsWith("  "), `lineText ${JSON.stringify(placed[0].lineText)} lost the document's own indentation`);
  assert.strictEqual(placed[0].lineText, RETURN_LINE);
});

test("A5: a deeply indented line keeps all four of its spaces", () => {
  const { placed } = place([block("total += cell.width;")]);
  assert.strictEqual(placed[0].lineText, "    total += cell.width;");
});

test("A5: lineText is byte-identical to a line of `fn`, and never to the anchor", () => {
  const anchors = [
    "\treturn total;",
    "  for (const cell of cells) {   ",
    "\t\t\tlet total = 0; // " + BODY_MARKER,
    "     " + DOC_LINE,
    "total += cell.width;",
  ];
  const fn = widths();
  const { placed } = place(anchors.map((a) => block(a)), fn);
  assert.strictEqual(placed.length, anchors.length, `expected all ${anchors.length} anchors to place, got ${placed.length}`);
  const lines = documentLines(fn);
  for (const row of placed) {
    assert.ok(lines.has(row.lineText), `lineText ${JSON.stringify(row.lineText)} is not a raw line of the function`);
    assert.ok(!anchors.includes(row.lineText), `lineText ${JSON.stringify(row.lineText)} is one of the reply's own strings`);
    assert.ok(!anchors.map((a) => a.trim()).includes(row.lineText) || row.lineText === row.lineText.trim(),
      `lineText ${JSON.stringify(row.lineText)} is the reply's anchor trimmed`);
  }
});

test("A5: lineText is exactly the line the `line` number points at", () => {
  const fn = widths();
  const { placed } = place([block("\tfor (const cell of cells) {")], fn);
  assert.strictEqual(placed.length, 1);
  assert.strictEqual(placed[0].lineText, fn.lines[placed[0].line - fn.startLine],
    "lineText and `line` disagree, so the card would quote one line and point at another");
});

test("A5: every anchorable line of the slice round-trips its own raw text", () => {
  const fn = widths();
  // Every line except the blank one and the two that trim to `}`.
  const targets = [0, 1, 2, 4, 5, 7];
  for (const i of targets) {
    const { placed, unplaced } = place([block("   " + fn.lines[i].trim() + "  ")], widths());
    assert.strictEqual(unplaced.length, 0, `line index ${i} would not anchor: ${JSON.stringify(unplaced)}`);
    assert.strictEqual(placed[0].lineText, fn.lines[i], `line index ${i} came back as ${JSON.stringify(placed[0].lineText)}`);
  }
});

test("A5: end to end through adviseFunction, lineText is still the raw document line", async () => {
  const anchors = ["\t\treturn total;", "\t\t\tfor (const cell of cells) {"];
  const fn = widths();
  const out = await round(reply(anchors.map((a) => block(a))), fn);
  assert.strictEqual(out.placed.length, 2, `expected two placements, got ${JSON.stringify(out)}`);
  const lines = documentLines(fn);
  for (const row of out.placed) {
    assert.ok(lines.has(row.lineText), `lineText ${JSON.stringify(row.lineText)} came from the reply, not the document`);
  }
  assert.deepStrictEqual(out.placed.map((row) => row.lineText), [FOR_LINE, RETURN_LINE]);
});

test("A5: the block itself is handed back unchanged, so the anchor is still auditable", () => {
  const b = block("\t\treturn total;");
  const { placed } = place([b]);
  assert.strictEqual(placed[0].block.anchor, "\t\treturn total;", "the block was rewritten, so a reader cannot see what the model actually quoted");
});

// ===========================================================================
// A6. `placed` is ascending by line
// ===========================================================================

test("A6: blocks handed in bottom-up come back ascending by line", () => {
  const { placed } = place([
    block("return total;", "last"),
    block("for (const cell of cells) {", "middle"),
    block(DOC_LINE, "first"),
  ]);
  assert.deepStrictEqual(placed.map((p) => p.line), [wline(0), wline(4), wline(7)]);
});

test("A6: a shuffled five-block round is still ascending (ties allowed since A4 relaxed)", () => {
  const { placed } = place([
    block("}", "ignored, ambiguous"),
    block("total += cell.width;", "b"),
    block(HEAD_LINE, "c"),
    block("return total;", "d"),
    block(DOC_LINE, "e"),
  ]);
  const lines = placed.map((p) => p.line);
  assert.deepStrictEqual(lines, lines.slice().sort((a, b) => a - b), `placed is not ascending: ${lines}`);
});

test("A6: a round with several blocks per line is still ascending overall", () => {
  const blocks = [
    block("return total;", "r1"), block(DOC_LINE, "d1"),
    block("return total;", "r2"), block(DOC_LINE, "d2"),
    block("for (const cell of cells) {", "f1"),
  ];
  const lines = place(blocks).placed.map((p) => p.line);
  assert.deepStrictEqual(lines, lines.slice().sort((a, b) => a - b), `placed is not ascending: ${lines}`);
});

// ===========================================================================
// A7. `placeAdvice` is pure
// ===========================================================================

test("A7: the same inputs give the same outputs", () => {
  const blocks = [block("return total;"), block("nothing();"), block("send(payload);")];
  const a = place(blocks, widths());
  const b = place(blocks, widths());
  assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));
});

test("A7: `fn` is not mutated", () => {
  const fn = widths();
  const before = JSON.stringify(fn);
  place([block("return total;"), block("nothing();")], fn);
  assert.strictEqual(JSON.stringify(fn), before, "placeAdvice mutated the function under review");
});

test("A7: the blocks are not mutated", () => {
  const blocks = [block("return total;"), block("return total;"), block("nothing();")];
  const before = JSON.stringify(blocks);
  place(blocks, widths());
  assert.strictEqual(JSON.stringify(blocks), before, "placeAdvice mutated the blocks it was given");
});

test("A7: deep-frozen inputs are accepted, so nothing is written through", () => {
  const fn = deepFreeze(widths());
  const blocks = deepFreeze([block("return total;"), block("nothing();")]);
  const { placed, unplaced } = need("placeAdvice")(fn, blocks);
  assert.strictEqual(placed.length, 1);
  assert.strictEqual(unplaced.length, 1);
});

test("A7: an empty block list gives two empty lists", () => {
  const { placed, unplaced } = place([]);
  assert.deepStrictEqual(placed, []);
  assert.deepStrictEqual(unplaced, []);
});

// ===========================================================================
// A8. Every line of the SLICE is anchorable, doc comment included.
//     Blank lines are not.
// ===========================================================================

test("A8: the doc comment line is anchorable", () => {
  const { placed, unplaced } = place([block(DOC_LINE, "this doc says what, not why")]);
  assert.strictEqual(unplaced.length, 0, `the doc comment was refused as an anchor: ${JSON.stringify(unplaced)}`);
  assert.strictEqual(placed[0].line, wline(0));
});

test("A8: the declaration head is anchorable", () => {
  const { placed, unplaced } = place([block(HEAD_LINE, "four positional numbers")]);
  assert.strictEqual(unplaced.length, 0, `the declaration head was refused as an anchor: ${JSON.stringify(unplaced)}`);
  assert.strictEqual(placed[0].line, wline(1));
});

test("A8: the last line of the slice is anchorable when it is unique", () => {
  const { placed, unplaced } = place([block("wait();")], dispatch());
  assert.strictEqual(unplaced.length, 0);
  assert.strictEqual(placed.length, 1);
});

test("A8: an empty anchor does not land on the blank line", () => {
  const { placed, unplaced } = place([block("")]);
  assert.deepStrictEqual(Array.from(placed), [], `an empty anchor was placed at document line ${placed.length ? placed[0].line : "?"}; blank lines are not anchorable`);
  assert.strictEqual(unplaced.length, 1);
  assert.strictEqual(unplaced[0].reason, REASON.NO_MATCH);
});

test("A8: a whitespace-only anchor does not land on the blank line", () => {
  const { placed, unplaced } = place([block("     ")]);
  assert.deepStrictEqual(Array.from(placed), [], "a whitespace-only anchor was placed; blank lines are not anchorable");
  assert.strictEqual(unplaced.length, 1);
  assert.strictEqual(unplaced[0].reason, REASON.NO_MATCH);
});

test("A8: the blank line's own document number is never in placed", () => {
  const { placed } = place([block(""), block("   \t "), block("return total;")]);
  assert.ok(!placed.some((p) => p.line === wline(BLANK_INDEX)), "something was placed on the blank line");
});

// ===========================================================================
// A9b. A bare JSON array IS the blocks array
//
// Added 2026-08-29: a fenced bare array was the ONLY unreadable reply
// `qwen3.8:27b-mlx` produced across ten real functions, and refusing a whole
// round over a missing wrapper is the trade the fence strip already declines.
//
// THE RISK OF THIS CHANGE IS THAT IT LOOSENS FURTHER THAN INTENDED, so the
// rows split in two: what the unwrapping now accepts, and what must STILL be
// unreadable. An array of things that are not blocks has to come back as zero
// blocks through A11's per-block validation, never as readable garbage.
// ===========================================================================

const BARE = [
  { dimension: "cqs", anchor: "return total;", text: "this both mutates and reports" },
  { dimension: "nesting", anchor: "for (const cell of cells) {", text: "the loop body is doing two jobs" },
];

test("A9b: a bare array of valid blocks is read as the blocks array", () => {
  const out = read(JSON.stringify(BARE));
  assert.strictEqual(out.ok, true, `a bare array was refused: ${JSON.stringify(out)}`);
  assert.strictEqual(out.blocks.length, 2);
  assert.deepStrictEqual(out.blocks.map((b) => ({ ...b })), BARE);
});

test("A9b: the bare array reads IDENTICALLY to the wrapped form", () => {
  const bare = read(JSON.stringify(BARE));
  const wrapped = read(JSON.stringify({ blocks: BARE }));
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(bare)),
    JSON.parse(JSON.stringify(wrapped)),
    "one less layer of wrapping produced a different answer, and the contract says it is the same answer",
  );
});

test("A9b: a bare array places, and A5 still holds on what it places", () => {
  const out = read(JSON.stringify(BARE));
  const fn = widths();
  const { placed, unplaced } = place(Array.from(out.blocks), fn);
  assert.deepStrictEqual(Array.from(unplaced), [], `a bare array's blocks would not place: ${JSON.stringify(unplaced)}`);
  assert.deepStrictEqual(placed.map((r) => r.line), [wline(4), wline(7)]);
  assert.deepStrictEqual(placed.map((r) => r.lineText), [FOR_LINE, RETURN_LINE]);
});

test("A9b: a FENCED bare array parses, because A10 runs first", () => {
  // The exact shape the live model produced.
  const out = read("```json\n" + JSON.stringify(BARE, null, 2) + "\n```");
  assert.strictEqual(out.ok, true, `a fenced bare array was refused, which is the live failure this invariant exists for: ${JSON.stringify(out)}`);
  assert.strictEqual(out.blocks.length, 2);
});

test("A9b: a HALF-fenced bare array parses too", () => {
  const out = read("```json\n" + JSON.stringify(BARE));
  assert.strictEqual(out.ok, true, `a half-fenced bare array was refused: ${JSON.stringify(out)}`);
  assert.strictEqual(out.blocks.length, 2);
});

test("A9b: malformed entries in a bare array are dropped per A11, and the good ones stand", () => {
  const mixed = [null, BARE[0], { dimension: "cqs" }, 7, BARE[1], { dimension: "cqs", anchor: "", text: "a" }, "a string"];
  const out = read(JSON.stringify(mixed));
  assert.strictEqual(out.ok, true, `a bare array with junk in it failed the whole reply: ${JSON.stringify(out)}`);
  assert.deepStrictEqual(out.blocks.map((b) => ({ ...b })), BARE, `expected only the two whole blocks, got ${JSON.stringify(out.blocks)}`);
});

test("A9b: a bare array of PRIMITIVES is ok with zero blocks, not readable garbage", () => {
  const out = read(JSON.stringify(["return total;", 1, true, null, 2.5]));
  assert.strictEqual(out.ok, true, `a bare array of primitives was treated as unreadable: ${JSON.stringify(out)}`);
  assert.deepStrictEqual(Array.from(out.blocks), [], `primitives became blocks: ${JSON.stringify(out.blocks)}`);
});

test("A9b: nothing survives a bare array without being a whole block", () => {
  // The guard on the loosening: whatever comes back must still satisfy A11.
  const soup = [
    [BARE[0]],                                      // a nested array
    { blocks: [BARE[0]] },                          // a re-wrapped block
    { dimension: 3, anchor: 4, text: 5 },
    { dimension: "cqs", anchor: "return total;" },
    { anchor: "return total;", text: "a" },
    { dimension: "cqs", anchor: "  ", text: "a" },
    BARE[0],
  ];
  const out = read(JSON.stringify(soup));
  assert.strictEqual(out.ok, true);
  for (const b of out.blocks) {
    for (const field of ["dimension", "anchor", "text"]) {
      assert.strictEqual(typeof b[field], "string", `a survivor carries a non-string ${field}: ${JSON.stringify(b)}`);
      assert.ok(b[field].trim().length > 0, `a survivor carries a blank ${field}: ${JSON.stringify(b)}`);
    }
  }
  assert.strictEqual(out.blocks.length, 1, `expected the one whole block to survive, got ${JSON.stringify(out.blocks)}`);
});

test("A9b: an EMPTY bare array is the same as an empty blocks array", () => {
  const bare = read("[]");
  const wrapped = read('{"blocks": []}');
  assert.strictEqual(bare.ok, true, `an empty bare array was treated as unreadable: ${JSON.stringify(bare)}`);
  assert.deepStrictEqual(Array.from(bare.blocks), []);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(bare)), JSON.parse(JSON.stringify(wrapped)));
});

test("A9b: an empty bare array is A14 outcome 2 through the whole round, not a failure", async () => {
  const out = await round("[]");
  assert.deepStrictEqual(Array.from(out.placed), []);
  assert.deepStrictEqual(Array.from(out.unplaced), []);
  assert.strictEqual(out.failure, undefined,
    "a model that answered \"nothing to say\" with one less layer of wrapping was reported as a failure");
});

test("A9b: ADVICE_MAX_BLOCKS caps a bare array too, first in reply order", () => {
  const max = need("ADVICE_MAX_BLOCKS");
  const many = Array.from({ length: max + 3 }, (_, n) => ({ dimension: "cqs", anchor: `line${n}();`, text: `say ${n}` }));
  const out = read(JSON.stringify(many));
  assert.strictEqual(out.blocks.length, max);
  assert.deepStrictEqual(out.blocks.map((b) => b.text), many.slice(0, max).map((b) => b.text));
});

test("A9b: a bare array drives a whole round through adviseFunction", async () => {
  const out = await round(JSON.stringify(BARE));
  assert.strictEqual(out.failure, undefined, `a bare array failed the round: ${JSON.stringify(out)}`);
  assert.strictEqual(out.placed.length, 2);
  assert.deepStrictEqual(out.placed.map((r) => r.lineText), [FOR_LINE, RETURN_LINE]);
});

// ---- and what the unwrapping must NOT have loosened ----

const STILL_UNREADABLE = [
  ["a top-level object with no blocks key", '{"advice": [{"dimension":"cqs","anchor":"return total;","text":"a"}]}'],
  ["a top-level object spelled notblocks", '{"notblocks": [{"dimension":"cqs","anchor":"return total;","text":"a"}]}'],
  ["an empty top-level object", "{}"],
  ["a top-level object whose blocks is a string", '{"blocks": "return total;"}'],
  ["a top-level object whose blocks is a number", '{"blocks": 3}'],
  ["a top-level object whose blocks is null", '{"blocks": null}'],
  ["a top-level object whose blocks is an object", '{"blocks": {"0": {"dimension":"cqs","anchor":"a","text":"b"}}}'],
  ["a top-level JSON string", '"blocks"'],
  ["a top-level JSON string that looks like an array", '"[{\\"dimension\\":\\"cqs\\"}]"'],
  ["a top-level JSON number", "17"],
  ["a top-level JSON boolean", "true"],
  ["top-level JSON null", "null"],
  ["a truncated bare array", '[{"dimension": "cqs", "anch'],
  ["a bare array missing its close", '[{"dimension":"cqs","anchor":"return total;","text":"a"}'],
];

for (const [label, raw] of STILL_UNREADABLE) {
  test(`A9b: ${label} is STILL unreadable`, () => {
    const out = read(raw);
    assert.strictEqual(out.ok, false, `the bare-array unwrapping loosened as far as ${label}: ${JSON.stringify(out)}`);
    assert.strictEqual(out.failure.kind, "unreadable");
    assert.ok(out.failure.detail.trim().length > 0);
  });
}

test("A9b: none of the still-unreadable shapes throws", () => {
  const readAdviceReply = need("readAdviceReply");
  for (const [label, raw] of STILL_UNREADABLE) {
    assert.doesNotThrow(() => readAdviceReply(raw), `readAdviceReply threw on ${label}`);
  }
});

test("A9b: a JS array (not a string) is still a non-string and still unreadable", () => {
  // A9's non-string rule is untouched: the unwrapping is about JSON TEXT, not
  // about handing `readAdviceReply` a live array.
  const out = read(BARE);
  assert.strictEqual(out.ok, false, "a live JS array was accepted, but readAdviceReply reads a reply, not a value");
  assert.strictEqual(out.failure.kind, "unreadable");
});

// ===========================================================================
// A9. `readAdviceReply` is total
//
// A dozen-plus junk values. Each must come back `{ ok: false }` with a kind
// and a non-empty detail, and none may throw.
// ===========================================================================

const JUNK = [
  ["undefined", undefined],
  ["null", null],
  ["a number", 42],
  ["a boolean", true],
  ["a bare object", { notBlocks: 1 }],
  ["an object carrying a real blocks array (not a string)", { blocks: [{ dimension: "cqs", anchor: "return total;", text: "hi" }] }],
  ["an array", [{ dimension: "cqs", anchor: "return total;", text: "hi" }]],
  ["a function", () => "{}"],
  ["a Date", new Date(0)],
  ["a Buffer", Buffer.from("{}")],
  ["an empty string", ""],
  ["whitespace only", "   \n\t  "],
  ["prose, not JSON", "Sure! Here is my advice about the function."],
  ["truncated JSON", '{"blocks": [{"dimension": "cqs", "anch'],
  ["a JSON string at top level", '"blocks"'],
  ["a JSON number at top level", "17"],
  ["JSON null at top level", "null"],
  ["JSON with no blocks key", '{"advice": []}'],
  ["blocks as a string", '{"blocks": "return total;"}'],
  ["blocks as a number", '{"blocks": 3}'],
  ["blocks as null", '{"blocks": null}'],
  ["blocks as an object", '{"blocks": {"0": {"dimension":"cqs","anchor":"a","text":"b"}}}'],
];

for (const [label, raw] of JUNK) {
  test(`A9: readAdviceReply does not throw on ${label}`, () => {
    const readAdviceReply = need("readAdviceReply");
    assert.doesNotThrow(() => readAdviceReply(raw), `readAdviceReply threw on ${label}`);
  });

  test(`A9: ${label} is a failure with a kind and a non-empty detail`, () => {
    const out = read(raw);
    assert.strictEqual(out.ok, false, `${label} was read as a usable reply: ${JSON.stringify(out)}`);
    assert.ok(out.failure, `${label} gave ok:false with no failure`);
    assert.strictEqual(
      out.failure.kind, "unreadable",
      `${label} gave failure kind ${JSON.stringify(out.failure.kind)}; anything reaching readAdviceReply has by definition arrived, so \`transport\` is never its answer`,
    );
    assert.strictEqual(typeof out.failure.detail, "string");
    assert.ok(out.failure.detail.trim().length > 0, `${label} gave an empty detail, so nothing can be shown to a human`);
  });
}

test("A9: readAdviceReply NEVER answers `transport`, on any input in the junk table", () => {
  // `transport` means nothing came back at all and only adviseFunction can
  // produce it; anything reaching readAdviceReply has, by definition, arrived.
  for (const [, raw] of JUNK) {
    const out = read(raw);
    assert.notStrictEqual(out.failure.kind, "transport", `readAdviceReply answered \`transport\` for ${JSON.stringify(String(raw)).slice(0, 40)}`);
  }
  for (const raw of ["not json at all", '{"blocks": 3}', ""]) {
    const out = read(raw);
    assert.strictEqual(out.failure.kind, "unreadable", `reading ${JSON.stringify(raw)} produced kind ${out.failure.kind}`);
  }
});

test("A9: a well-formed reply is ok:true with the blocks", () => {
  const out = read(reply([block("return total;", "one thing", "cqs")]));
  assert.strictEqual(out.ok, true, `a well-formed reply was refused: ${JSON.stringify(out)}`);
  assert.strictEqual(out.blocks.length, 1);
  assert.strictEqual(out.blocks[0].dimension, "cqs");
  assert.strictEqual(out.blocks[0].anchor, "return total;");
  assert.strictEqual(out.blocks[0].text, "one thing");
});

test("A9: an empty blocks array is a readable reply carrying nothing", () => {
  const out = read('{"blocks": []}');
  assert.strictEqual(out.ok, true, `an empty blocks array was treated as unreadable: ${JSON.stringify(out)}`);
  assert.deepStrictEqual(Array.from(out.blocks), []);
});

// ===========================================================================
// A10.  One outer code fence is stripped
// A10a. Each half of a fence is stripped INDEPENDENTLY
//
// A10a was REVERSED on 2026-08-29 after these rows went red against its first
// wording. It first said a half fence is not a fence and the reply is
// `unreadable`, on the reasoning that a truncated reply is not a reply. The
// measurement that settled it:
//
//   truncated mid-object, a real maxTokens cut  -> invalid JSON -> no parse
//   opening fence, COMPLETE json, no close      -> valid JSON   -> parses
//   closed fence with trailing prose after it   -> invalid JSON -> no parse
//
// The truncation the strict wording was reaching for is already caught by the
// JSON parse, so strictness bought nothing there. What it cost was the middle
// shape: a complete, usable answer discarded because a model did not close a
// fence, which is precisely the trade A10 exists to refuse.
//
// The truncation risk is therefore pinned by the FENCE_TRUNCATIONS rows below
// rather than by A10a, and those rows are the ones to read if the strict
// wording is ever proposed again.
// ===========================================================================

test("A10: a bare ``` fence comes off", () => {
  const out = read("```\n" + reply([block("return total;")]) + "\n```");
  assert.strictEqual(out.ok, true, `a fenced reply was refused: ${JSON.stringify(out)}`);
  assert.strictEqual(out.blocks.length, 1);
});

test("A10: a ```json fence comes off", () => {
  const out = read("```json\n" + reply([block("return total;")]) + "\n```");
  assert.strictEqual(out.ok, true, `a json-tagged fenced reply was refused: ${JSON.stringify(out)}`);
  assert.strictEqual(out.blocks.length, 1);
});

test("A10: a fence with surrounding whitespace comes off", () => {
  const out = read("\n  ```json\n" + reply([block("return total;")]) + "\n```  \n");
  assert.strictEqual(out.ok, true, `a whitespace-padded fence was refused: ${JSON.stringify(out)}`);
});

test("A10: EXACTLY one pair comes off, so a doubly fenced reply is still unreadable", () => {
  const inner = "```\n" + reply([block("return total;")]) + "\n```";
  const out = read("```\n" + inner + "\n```");
  assert.strictEqual(out.ok, false, "both fence pairs were stripped; the contract says exactly one outer pair comes off");
});

// The three half-fence shapes, each carrying a COMPLETE JSON body. Each half
// comes off on its own and what remains parses, so the answer stands.
const FENCE_HALVES = [
  ["an opening ```json fence with no closing one", "```json\n" + reply([block("return total;")])],
  ["a bare opening ``` fence with no closing one", "```\n" + reply([block("return total;")])],
  ["a closing fence with no opening one", reply([block("return total;")]) + "\n```"],
  ["an opening fence and a trailing newline only", "```json\n" + reply([block("return total;")]) + "\n"],
];

for (const [label, raw] of FENCE_HALVES) {
  test(`A10a: ${label} still yields the complete answer behind it`, () => {
    const out = read(raw);
    assert.strictEqual(out.ok, true, `a complete answer was discarded over an unclosed fence: ${JSON.stringify(out)}`);
    assert.strictEqual(out.blocks.length, 1);
    assert.strictEqual(out.blocks[0].anchor, "return total;");
  });
}

test("A10a: a half-fenced complete answer places through the whole round", async () => {
  const out = await round("```json\n" + reply([block("return total;")]));
  assert.strictEqual(out.failure, undefined, `a complete answer behind an unclosed fence failed the round: ${JSON.stringify(out)}`);
  assert.strictEqual(out.placed.length, 1);
  assert.strictEqual(out.placed[0].line, wline(7));
  assert.strictEqual(out.placed[0].lineText, RETURN_LINE);
});

// WHERE THE TRUNCATION RISK IS NOW PINNED. A10a no longer refuses a half
// fence, so nothing in A10a stops a reply that was cut off mid-generation. The
// JSON parse does, and these are the rows that say so. A model stopped at its
// token ceiling produces a body that cannot parse whatever the fencing looks
// like, and planting comments out of the surviving prefix would be planting
// comments from an answer the model never finished.
const FENCE_TRUNCATIONS = [
  ["an opening fence and a body cut mid-object", '```json\n{"blocks": [{"dimension": "cqs", "anch'],
  ["an opening fence and a body cut mid-array", '```json\n{"blocks": [{"dimension": "cqs", "anchor": "return total;", "text": "a"},'],
  ["a bare opening fence and a truncated body", '```\n{"blocks": [{"dimension": "cqs"'],
  ["a truncated body behind no fence at all", '{"blocks": [{"dimension": "cqs", "anch'],
  ["a closed fence with trailing prose after it", "```json\n" + reply([block("return total;")]) + "\n```\nHope this helps!"],
  ["a closed fence with prose before it", "Sure, here you go:\n```json\n" + reply([block("return total;")]) + "\n```"],
];

for (const [label, raw] of FENCE_TRUNCATIONS) {
  test(`A10a: ${label} is still unreadable, because the JSON parse catches it`, () => {
    const out = read(raw);
    assert.strictEqual(out.ok, false, `a reply that cannot parse was accepted: ${JSON.stringify(out)}`);
    assert.strictEqual(out.failure.kind, "unreadable");
    assert.ok(out.failure.detail.trim().length > 0);
  });
}

test("A10a: a truncated reply behind an opening fence fails the whole round rather than placing a prefix", async () => {
  const out = await round('```json\n{"blocks": [{"dimension": "cqs", "anchor": "return total;", "text": "half a th');
  assert.deepStrictEqual(Array.from(out.placed), [], "comments were planted out of a reply the model never finished");
  assert.deepStrictEqual(Array.from(out.unplaced), []);
  assert.ok(out.failure);
  assert.strictEqual(out.failure.kind, "unreadable");
});

test("A10a: no fence shape, whole or half, makes readAdviceReply throw", () => {
  const readAdviceReply = need("readAdviceReply");
  for (const [label, raw] of FENCE_HALVES.concat(FENCE_TRUNCATIONS)) {
    assert.doesNotThrow(() => readAdviceReply(raw), `readAdviceReply threw on ${label}`);
  }
});

// ===========================================================================
// A11. A malformed block does not fail the reply
// ===========================================================================

const GOOD = { dimension: "cqs", anchor: "return total;", text: "this both mutates and reports" };

const MALFORMED = [
  ["missing dimension", { anchor: "wait();", text: "a" }],
  ["missing anchor", { dimension: "cqs", text: "a" }],
  ["missing text", { dimension: "cqs", anchor: "wait();" }],
  ["dimension is a number", { dimension: 3, anchor: "wait();", text: "a" }],
  ["anchor is a number", { dimension: "cqs", anchor: 12, text: "a" }],
  ["text is an object", { dimension: "cqs", anchor: "wait();", text: { s: "a" } }],
  ["anchor is an array", { dimension: "cqs", anchor: ["wait();"], text: "a" }],
  ["dimension is empty", { dimension: "", anchor: "wait();", text: "a" }],
  ["anchor is empty", { dimension: "cqs", anchor: "", text: "a" }],
  ["text is empty", { dimension: "cqs", anchor: "wait();", text: "" }],
  ["dimension is whitespace", { dimension: "   ", anchor: "wait();", text: "a" }],
  ["anchor is whitespace", { dimension: "cqs", anchor: " \t ", text: "a" }],
  ["text is whitespace", { dimension: "cqs", anchor: "wait();", text: "  " }],
  ["the block is null", null],
  ["the block is a string", "return total;"],
  ["the block is a number", 7],
  ["the block is an array", ["cqs", "wait();", "a"]],
];

for (const [label, bad] of MALFORMED) {
  test(`A11: ${label} is dropped, and a good block beside it still stands`, () => {
    const out = read(JSON.stringify({ blocks: [GOOD, bad] }));
    assert.strictEqual(out.ok, true, `one malformed block (${label}) failed the whole reply: ${JSON.stringify(out)}`);
    assert.strictEqual(out.blocks.length, 1, `${label} was not dropped; blocks were ${JSON.stringify(out.blocks)}`);
    assert.deepStrictEqual({ ...out.blocks[0] }, GOOD);
  });
}

test("A11: the malformed block first and the good block second reads the same way", () => {
  const out = read(JSON.stringify({ blocks: [null, { dimension: "cqs" }, GOOD] }));
  assert.strictEqual(out.ok, true);
  assert.strictEqual(out.blocks.length, 1);
  assert.deepStrictEqual({ ...out.blocks[0] }, GOOD);
});

test("A11: one bad block in six leaves five", () => {
  const five = [1, 2, 3, 4, 5].map((n) => ({ dimension: "cqs", anchor: `line${n}();`, text: `say ${n}` }));
  const out = read(JSON.stringify({ blocks: [five[0], five[1], { dimension: "cqs", anchor: "" }, five[2], five[3], five[4]] }));
  assert.strictEqual(out.ok, true);
  assert.strictEqual(out.blocks.length, 5, `expected five survivors, got ${JSON.stringify(out.blocks)}`);
});

test("A11: a reply whose blocks are ALL malformed is still ok, just empty", () => {
  const out = read(JSON.stringify({ blocks: [null, { dimension: "cqs" }, 7] }));
  assert.strictEqual(out.ok, true, `an all-malformed blocks array was reported as unreadable: ${JSON.stringify(out)}`);
  assert.deepStrictEqual(Array.from(out.blocks), []);
});

test("A11: an unknown extra field on a block does not drop it", () => {
  const out = read(JSON.stringify({ blocks: [{ ...GOOD, severity: "high" }] }));
  assert.strictEqual(out.ok, true);
  assert.strictEqual(out.blocks.length, 1);
});

// ===========================================================================
// A12. No more than ADVICE_MAX_BLOCKS blocks are returned
// ===========================================================================

test("A12: a reply carrying MAX + 3 blocks reads back MAX", () => {
  const max = need("ADVICE_MAX_BLOCKS");
  const many = Array.from({ length: max + 3 }, (_, n) => ({ dimension: "cqs", anchor: `line${n}();`, text: `say ${n}` }));
  const out = read(JSON.stringify({ blocks: many }));
  assert.strictEqual(out.ok, true);
  assert.strictEqual(out.blocks.length, max, `${many.length} blocks read back as ${out.blocks.length}, and the cap is ${max}`);
});

test("A12: a reply carrying MAX * 4 blocks still reads back MAX", () => {
  const max = need("ADVICE_MAX_BLOCKS");
  const many = Array.from({ length: max * 4 }, (_, n) => ({ dimension: "cqs", anchor: `line${n}();`, text: `say ${n}` }));
  const out = read(JSON.stringify({ blocks: many }));
  assert.strictEqual(out.blocks.length, max);
});

test("A12: a reply under the cap is not trimmed", () => {
  const max = need("ADVICE_MAX_BLOCKS");
  const few = Array.from({ length: Math.max(1, max - 1) }, (_, n) => ({ dimension: "cqs", anchor: `line${n}();`, text: `say ${n}` }));
  const out = read(JSON.stringify({ blocks: few }));
  assert.strictEqual(out.blocks.length, few.length);
});

test("A12: malformed blocks are dropped before the cap, so MAX good ones survive them", () => {
  const max = need("ADVICE_MAX_BLOCKS");
  const good = Array.from({ length: max }, (_, n) => ({ dimension: "cqs", anchor: `line${n}();`, text: `say ${n}` }));
  const mixed = [];
  for (const g of good) { mixed.push(null, g); }
  const out = read(JSON.stringify({ blocks: mixed }));
  assert.strictEqual(out.blocks.length, max, `interleaved nulls cost real blocks: got ${out.blocks.length} of ${max}`);
});

test("A12: the survivors are the FIRST valid blocks in reply order", () => {
  const max = need("ADVICE_MAX_BLOCKS");
  const many = Array.from({ length: max + 4 }, (_, n) => ({ dimension: "cqs", anchor: `line${n}();`, text: `say ${n}` }));
  const out = read(JSON.stringify({ blocks: many }));
  assert.deepStrictEqual(
    out.blocks.map((b) => b.text),
    many.slice(0, max).map((b) => b.text),
    "the cap did not keep the first blocks in reply order, which makes the model's own ordering unobservable",
  );
});

test("A12: the cap does not reorder the blocks it keeps", () => {
  const max = need("ADVICE_MAX_BLOCKS");
  const many = Array.from({ length: max }, (_, n) => ({ dimension: "cqs", anchor: `zline${max - n}();`, text: `say ${n}` }));
  const out = read(JSON.stringify({ blocks: many }));
  assert.deepStrictEqual(out.blocks.map((b) => b.anchor), many.map((b) => b.anchor), "the cap reordered a reply that was already under it");
});

test("A12: `first` counts VALID blocks, so malformed ones do not consume the budget", () => {
  const max = need("ADVICE_MAX_BLOCKS");
  const good = Array.from({ length: max + 2 }, (_, n) => ({ dimension: "cqs", anchor: `line${n}();`, text: `say ${n}` }));
  const mixed = [];
  for (const g of good) { mixed.push(null, g); }
  const out = read(JSON.stringify({ blocks: mixed }));
  assert.deepStrictEqual(out.blocks.map((b) => b.text), good.slice(0, max).map((b) => b.text));
});

test("A12: adviseFunction's placed + unplaced never exceeds the cap", async () => {
  const max = need("ADVICE_MAX_BLOCKS");
  const many = Array.from({ length: max + 5 }, (_, n) => ({ dimension: "cqs", anchor: `absent${n}();`, text: `say ${n}` }));
  const out = await round(JSON.stringify({ blocks: many }));
  assert.ok(out.placed.length + out.unplaced.length <= max, `a round returned ${out.placed.length + out.unplaced.length} rows against a cap of ${max}`);
});

// ===========================================================================
// A13. `adviseFunction` never throws
// ===========================================================================

test("A13: a rejecting transport gives empty lists and a transport failure", async () => {
  const out = await roundWith(async () => { throw new Error("the socket closed"); });
  assert.deepStrictEqual(Array.from(out.placed), []);
  assert.deepStrictEqual(Array.from(out.unplaced), []);
  assert.ok(out.failure, "a rejecting transport produced no failure at all");
  assert.strictEqual(out.failure.kind, "transport");
  assert.ok(out.failure.detail.trim().length > 0, "the transport failure carries an empty detail");
});

test("A13: a SYNCHRONOUSLY throwing transport is caught too", async () => {
  const out = await roundWith(() => { throw new Error("bad call, thrown before any promise"); });
  assert.ok(out.failure, "a synchronously throwing transport produced no failure");
  assert.strictEqual(out.failure.kind, "transport");
  assert.deepStrictEqual(Array.from(out.placed), []);
});

test("A13: a cancellation-named rejection resolves rather than throwing", async () => {
  const cancelled = new Error("Canceled");
  cancelled.name = "Canceled";
  const out = await roundWith(async () => { throw cancelled; });
  assert.ok(out && typeof out === "object", "a cancellation escaped adviseFunction");
  assert.deepStrictEqual(Array.from(out.placed), []);
  assert.deepStrictEqual(Array.from(out.unplaced), []);
  assert.ok(out.failure, "a cancelled round reported no failure, so a caller cannot tell it from a clean function");
  assert.strictEqual(out.failure.kind, "transport",
    `a cancellation is a rejecting transport, and A13 says a rejecting transport gives kind "transport"; got ${JSON.stringify(out.failure.kind)}`);
});

test("A13: a transport rejecting with a non-Error is still caught", async () => {
  const out = await roundWith(async () => { throw "just a string"; });
  assert.ok(out.failure, "a non-Error rejection escaped");
  assert.ok(out.failure.detail.trim().length > 0);
});

test("A13: a transport returning junk gives an unreadable failure, not a throw", async () => {
  const out = await roundWith(async () => "I am afraid I cannot do that.");
  assert.ok(out.failure, "an unreadable reply produced no failure");
  assert.strictEqual(out.failure.kind, "unreadable");
  assert.deepStrictEqual(Array.from(out.placed), []);
});

test("A13: a transport returning a non-string is caught", async () => {
  const out = await roundWith(async () => 42);
  assert.ok(out.failure, "a non-string reply produced no failure");
});

// ===========================================================================
// A14. FOUR outcomes, and no two of them may look alike
//
//   | outcome                                    | placed    | unplaced | failure |
//   | the model found things and they placed     | non-empty | either   | absent  |
//   | the model answered and found nothing       | empty     | empty    | absent  |
//   | the model answered and every block missed  | empty     | non-empty| absent  |
//   | the model never answered, or unreadably    | empty     | empty    | present |
//
// The last row splits by `failure.kind`: `transport` when nothing came back,
// `unreadable` when something did and could not be read.
// ===========================================================================

test("A14 outcome 1: found things and they placed", async () => {
  const out = await round(reply([block("return total;")]));
  assert.ok(out.placed.length > 0, `expected a placement, got ${JSON.stringify(out)}`);
  assert.strictEqual(out.failure, undefined, "a successful round carried a failure");
});

test("A14 outcome 1: a partly-placed round still carries no failure", async () => {
  const out = await round(reply([block("return total;"), block("nowhere();")]));
  assert.strictEqual(out.placed.length, 1);
  assert.strictEqual(out.unplaced.length, 1);
  assert.strictEqual(out.failure, undefined);
});

test("A14 outcome 2: answered and found nothing gives empty, empty, no failure", async () => {
  const out = await round('{"blocks": []}');
  assert.deepStrictEqual(Array.from(out.placed), []);
  assert.deepStrictEqual(Array.from(out.unplaced), []);
  assert.strictEqual(out.failure, undefined, "a model that answered \"nothing to say\" was reported as a failure");
});

test("A14 outcome 3: every block missed gives empty placed, POPULATED unplaced, and NO failure", async () => {
  const out = await round(reply([block("nowhere();"), block("alsoNowhere();")]));
  assert.deepStrictEqual(Array.from(out.placed), [], "something was placed from anchors that match nothing");
  assert.ok(out.unplaced.length > 0, "an answered round that missed left unplaced empty, so it is indistinguishable from silence");
  assert.strictEqual(out.failure, undefined, "an answered-and-missed round reported a failure, which makes it look like the model was never reached");
});

test("A14 outcome 4a: nothing came back gives empty both, and kind `transport`", async () => {
  const out = await roundWith(async () => { throw new Error("no backend configured"); });
  assert.deepStrictEqual(Array.from(out.placed), []);
  assert.deepStrictEqual(Array.from(out.unplaced), []);
  assert.ok(out.failure, "an unasked round reported no failure, so it looks like a clean function");
  assert.strictEqual(out.failure.kind, "transport");
});

test("A14 outcome 4b: something came back and could not be read gives kind `unreadable`", async () => {
  const out = await roundWith(async () => "Certainly! Here are some thoughts.");
  assert.deepStrictEqual(Array.from(out.placed), []);
  assert.deepStrictEqual(Array.from(out.unplaced), []);
  assert.ok(out.failure);
  assert.strictEqual(out.failure.kind, "unreadable",
    "a babbling model was reported as a transport failure, which is the collapse the corrected A14 exists to stop");
});

test("A14: all FIVE observable outcomes are pairwise distinguishable from the returned value alone", async () => {
  const shape = (o) => [
    o.placed.length > 0,
    o.unplaced.length > 0,
    o.failure === undefined ? "none" : o.failure.kind,
  ].join("/");
  const rounds = {
    placed: await round(reply([block("return total;")])),
    nothing: await round('{"blocks": []}'),
    missed: await round(reply([block("nowhere();")])),
    dead: await roundWith(async () => { throw new Error("dead"); }),
    babble: await roundWith(async () => "no thanks"),
  };
  const shapes = Object.entries(rounds).map(([k, v]) => `${k}=${shape(v)}`);
  const values = Object.values(rounds).map(shape);
  assert.strictEqual(new Set(values).size, 5, `two outcomes look identical: ${shapes.join(" | ")}`);
});

test("A14: a dead transport and a babbling model differ ONLY in kind, so kind is load-bearing", async () => {
  const dead = await roundWith(async () => { throw new Error("no backend configured"); });
  const babble = await roundWith(async () => "Certainly! Here are some thoughts.");
  const bulk = (o) => `${o.placed.length}/${o.unplaced.length}/${o.failure !== undefined}`;
  assert.strictEqual(bulk(dead), bulk(babble), "these now differ in bulk shape too, which is fine but means this row can be tightened");
  assert.notStrictEqual(dead.failure.kind, babble.failure.kind);
  assert.strictEqual(dead.failure.kind, "transport");
  assert.strictEqual(babble.failure.kind, "unreadable");
});

test("A14: a failure never rides along with a placement", async () => {
  const out = await round(reply([block("return total;")]));
  assert.strictEqual(out.failure, undefined);
  const dead = await roundWith(async () => { throw new Error("dead"); });
  assert.deepStrictEqual(Array.from(dead.placed), []);
});

// ===========================================================================
// A19b. "Nothing to say" is EXPLICIT in both shapes, and an empty message is
//       neither
//
// This section exists because the two shapes disagreed about the same verdict:
// a model reporting a good function in the line shape read as a FAILURE while
// the identical verdict in json read as clean. `@@none` settles it.
//
// THE NEGATIVE HALF IS THE IMPORTANT HALF, and it is the one place in this
// whole contract where leniency would produce a FALSE CLEAN rather than a lost
// comment. An empty message is also what a dead backend, a truncated round and
// a refusal look like; read as "nothing to say" it becomes a certificate that
// the function is fine. Every other leniency here goes the other way, so the
// asymmetry is deliberate and the rows below pin it in both directions.
// ===========================================================================

test("A19b: `@@none` alone is readable with zero blocks", () => {
  const out = read("@@none");
  assert.strictEqual(out.ok, true, `\`@@none\` was refused: ${JSON.stringify(out)}`);
  assert.deepStrictEqual(Array.from(out.blocks), []);
});

test("A19b: `@@none` reads EXACTLY as `{\"blocks\":[]}` does", () => {
  const token = read("@@none");
  const wrapped = read('{"blocks": []}');
  const bare = read("[]");
  assert.deepStrictEqual(JSON.parse(JSON.stringify(token)), JSON.parse(JSON.stringify(wrapped)),
    "the same verdict reads differently in the two shapes, which is the disagreement A19b was added to close");
  assert.deepStrictEqual(JSON.parse(JSON.stringify(token)), JSON.parse(JSON.stringify(bare)));
});

test("A19b: `@@none` through the whole round is A14 outcome 2, not a failure", async () => {
  const out = await round("@@none");
  assert.deepStrictEqual(Array.from(out.placed), []);
  assert.deepStrictEqual(Array.from(out.unplaced), []);
  assert.strictEqual(out.failure, undefined,
    "a model that reported a good function in the line shape was rendered as an outage");
});

test("A19b: a fenced `@@none` is read", () => {
  for (const raw of ["```\n@@none\n```", "```text\n@@none\n```", "```\n@@none"]) {
    const out = read(raw);
    assert.strictEqual(out.ok, true, `a fenced \`@@none\` was refused: ${JSON.stringify(raw)} -> ${JSON.stringify(out)}`);
    assert.deepStrictEqual(Array.from(out.blocks), []);
  }
});

test("A19b: `@@none` with surrounding prose is read", () => {
  for (const raw of [
    "I looked this function over and it is fine.\n\n@@none",
    "@@none\n\nNothing stood out.",
    "  @@none  ",
    "Here is my answer:\n@@none\nThat is all.",
  ]) {
    const out = read(raw);
    assert.strictEqual(out.ok, true, `\`@@none\` in prose was refused: ${JSON.stringify(raw)} -> ${JSON.stringify(out)}`);
    assert.deepStrictEqual(Array.from(out.blocks), []);
  }
});

test("A19b: `@@none` beside real @@block groups lets the BLOCKS win", () => {
  // The contract does not rule on a reply that says both. A model that wrote
  // real blocks and then a stray `@@none` has plainly found things, and
  // discarding them would lose real advice; the opposite reading turns a
  // contradictory reply into a clean certificate, which is exactly what A19b's
  // negative half refuses. Left red if the implementation disagrees.
  const withBlocks = asLines(PROBE);
  for (const raw of [withBlocks + "\n@@none", "@@none\n" + withBlocks]) {
    const out = read(raw);
    assert.strictEqual(out.ok, true, `a reply carrying both was refused: ${JSON.stringify(out)}`);
    assert.strictEqual(out.blocks.length, PROBE.length,
      `\`@@none\` beside ${PROBE.length} real blocks yielded ${out.blocks.length}; a stray token erased the model's findings`);
    assert.deepStrictEqual(out.blocks.map((b) => b.anchor), PROBE.map((b) => b.anchor));
  }
});

test("A19b: the `lines` prompt names the `@@none` token", () => {
  assert.ok(promptAs({}, "lines").includes("@@none"),
    "the lines prompt never mentions @@none, so a model has no way to say `nothing to say` in the shape it was asked for");
});

test("A19b: the `json` prompt shows its own explicit-nothing spelling", () => {
  // Derived from "both prompts demand it": A19b pins the token only for the
  // line shape, so the json half is checked against the empty blocks array,
  // which is the spelling the reader treats as equivalent. Reported if red.
  const text = promptAs({}, "json");
  assert.ok(text.includes("[]"),
    "the json prompt never shows the empty blocks array, so a model is not told how to say `nothing to say` explicitly");
});

// ---- the negative half ----

const EMPTY_REPLIES = [
  ["an empty string", ""],
  ["a single space", " "],
  ["a tab", "\t"],
  ["a newline", "\n"],
  ["whitespace and newlines", "   \n\t  \n "],
  ["an empty fence", "```\n```"],
  ["an empty fence with a language tag", "```json\n```"],
  ["a fence around whitespace", "```\n   \n```"],
];

for (const [label, raw] of EMPTY_REPLIES) {
  test(`A19b: ${label} stays UNREADABLE, because an empty message is also what an outage looks like`, () => {
    const out = read(raw);
    assert.strictEqual(out.ok, false,
      `${label} was read as "nothing to say", which turns a dead backend into a certificate that the function is fine: ${JSON.stringify(out)}`);
    assert.strictEqual(out.failure.kind, "unreadable");
    assert.ok(out.failure.detail.trim().length > 0);
  });
}

test("A19b: an empty reply is unreadable through the WHOLE ROUND, and lands in A14 outcome 4", async () => {
  for (const raw of ["", "   \n  ", "```\n```"]) {
    const out = await round(raw);
    assert.deepStrictEqual(Array.from(out.placed), []);
    assert.deepStrictEqual(Array.from(out.unplaced), []);
    assert.ok(out.failure, `an empty reply (${JSON.stringify(raw)}) produced no failure, so the round reads as a clean function`);
    assert.strictEqual(out.failure.kind, "unreadable");
  }
});

test("A19b: `@@none` and an empty reply are DIFFERENT OUTCOMES, which is the whole point", async () => {
  const shape = (o) => [
    o.placed.length > 0,
    o.unplaced.length > 0,
    o.failure === undefined ? "none" : o.failure.kind,
  ].join("/");
  const said = await round("@@none");
  const silent = await round("");
  const dead = await roundWith(async () => { throw new Error("no backend configured"); });
  assert.notStrictEqual(shape(said), shape(silent),
    "an explicit `nothing to say` and an empty message look identical, so silence certifies the function");
  assert.strictEqual(shape(said), "false/false/none");
  assert.strictEqual(shape(silent), "false/false/unreadable");
  assert.strictEqual(shape(dead), "false/false/transport");
  assert.strictEqual(new Set([shape(said), shape(silent), shape(dead)]).size, 3);
});

test("A19b: the empty-reply refusal holds in the JSON shape too, not just the line shape", async () => {
  // Symmetry: nothing about the asymmetry is specific to `lines`. An empty
  // answer to a json-shaped request is the same outage.
  assert.strictEqual(promptAs({}, "json"), prompt({}));
  const out = await round("");
  assert.ok(out.failure);
  assert.strictEqual(out.failure.kind, "unreadable");
});

test("A19b: none of the empty shapes throws", () => {
  const readAdviceReply = need("readAdviceReply");
  for (const [label, raw] of EMPTY_REPLIES) {
    assert.doesNotThrow(() => readAdviceReply(raw), `readAdviceReply threw on ${label}`);
  }
});

// ===========================================================================
// A19. TWO REPLY SHAPES, and the reader accepts either whichever was asked for
//
// `format` decides only what the PROMPT REQUESTS. A model asked for one shape
// and answering in the other is still answering, and refusing it would spend a
// real review on formatting.
//
// THE LINE SHAPE'S EXACT SPELLING IS DISCOVERED, NOT GUESSED. The contract
// names the five markers (`@@block`, `@@anchor`, `@@dimension`, `@@line`,
// `@@text`) and does not pin the separator between a marker and its value, so
// this file does not pin it either: `chosenLineFormat()` probes
// `readAdviceReply` with a catalogue of plausible spellings and keeps the
// first that round-trips a known pair of blocks exactly. Every lines-shaped
// row below uses that spelling. If none round-trips, the discovery row fails
// and prints the prompt's own `lines` request so a human can read the shape
// the implementation actually asked for.
// ===========================================================================

const LINE_FORMAT_CANDIDATES = [
  {
    name: "@@block, then `@@key value` per field",
    render: (blocks) => blocks.map((b) => {
      const out = ["@@block"];
      if (b.anchor !== undefined) out.push(`@@anchor ${b.anchor}`);
      if (b.dimension !== undefined) out.push(`@@dimension ${b.dimension}`);
      if (b.line !== undefined) out.push(`@@line ${b.line}`);
      if (b.text !== undefined) out.push(`@@text ${b.text}`);
      return out.join("\n");
    }).join("\n"),
  },
  {
    name: "@@block, then `@@key: value` per field",
    render: (blocks) => blocks.map((b) => {
      const out = ["@@block"];
      if (b.anchor !== undefined) out.push(`@@anchor: ${b.anchor}`);
      if (b.dimension !== undefined) out.push(`@@dimension: ${b.dimension}`);
      if (b.line !== undefined) out.push(`@@line: ${b.line}`);
      if (b.text !== undefined) out.push(`@@text: ${b.text}`);
      return out.join("\n");
    }).join("\n"),
  },
  {
    name: "@@block, dimension first, `@@key value`",
    render: (blocks) => blocks.map((b) => {
      const out = ["@@block"];
      if (b.dimension !== undefined) out.push(`@@dimension ${b.dimension}`);
      if (b.anchor !== undefined) out.push(`@@anchor ${b.anchor}`);
      if (b.line !== undefined) out.push(`@@line ${b.line}`);
      if (b.text !== undefined) out.push(`@@text ${b.text}`);
      return out.join("\n");
    }).join("\n"),
  },
  {
    name: "@@block, then each marker on its own line with the value beneath",
    render: (blocks) => blocks.map((b) => {
      const out = ["@@block"];
      if (b.anchor !== undefined) out.push("@@anchor", b.anchor);
      if (b.dimension !== undefined) out.push("@@dimension", b.dimension);
      if (b.line !== undefined) out.push("@@line", String(b.line));
      if (b.text !== undefined) out.push("@@text", b.text);
      return out.join("\n");
    }).join("\n"),
  },
  {
    name: "@@block <n>, then `@@key value`",
    render: (blocks) => blocks.map((b, i) => {
      const out = [`@@block ${i + 1}`];
      if (b.anchor !== undefined) out.push(`@@anchor ${b.anchor}`);
      if (b.dimension !== undefined) out.push(`@@dimension ${b.dimension}`);
      if (b.line !== undefined) out.push(`@@line ${b.line}`);
      if (b.text !== undefined) out.push(`@@text ${b.text}`);
      return out.join("\n");
    }).join("\n"),
  },
];

const PROBE = [
  { dimension: "cqs", anchor: "return total;", text: "this both mutates and reports" },
  { dimension: "nesting", anchor: "wait();", text: "the wait has no timeout" },
];

/** The first candidate spelling that round-trips PROBE exactly, or null. */
const LINE_FORMAT = (() => {
  if (loadError) return null;
  const readAdviceReply = mod.readAdviceReply;
  if (typeof readAdviceReply !== "function") return null;
  for (const candidate of LINE_FORMAT_CANDIDATES) {
    let out;
    try {
      out = readAdviceReply(candidate.render(PROBE));
    } catch {
      continue;
    }
    if (!out || out.ok !== true || out.blocks.length !== PROBE.length) continue;
    const exact = PROBE.every((want, i) => {
      const got = out.blocks[i];
      return got && got.dimension === want.dimension && got.anchor === want.anchor && got.text === want.text;
    });
    if (exact) return candidate;
  }
  return null;
})();

/** Render blocks in the discovered line spelling, or fail naming the problem. */
function asLines(blocks) {
  if (!LINE_FORMAT) {
    throw new Error(
      "no candidate spelling of the @@block line shape round-tripped through readAdviceReply. " +
      "The `lines` prompt asks for this:\n\n" + promptAs({}, "lines"),
    );
  }
  return LINE_FORMAT.render(blocks);
}

test("A19: the surface carries AdviceFormat's two constants", () => {
  const def = need("ADVICE_DEFAULT_FORMAT");
  assert.strictEqual(typeof def, "string");
  assert.ok(def === "json" || def === "lines", `ADVICE_DEFAULT_FORMAT is ${JSON.stringify(def)}, which is not an AdviceFormat`);
});

test("A19: ADVICE_DEFAULT_FORMAT is `json`", () => {
  assert.strictEqual(need("ADVICE_DEFAULT_FORMAT"), "json");
});

test("A19: an omitted `format` argument builds exactly the default's prompt", () => {
  const def = need("ADVICE_DEFAULT_FORMAT");
  assert.strictEqual(prompt({ diagnostics: DIAGS, callees: CALLEES }), promptAs({ diagnostics: DIAGS, callees: CALLEES }, def),
    "the omitted fourth argument does not fall to ADVICE_DEFAULT_FORMAT");
});

test("A19: an explicitly undefined `format` also falls to the default", () => {
  assert.strictEqual(promptAs({}, undefined), promptAs({}, need("ADVICE_DEFAULT_FORMAT")));
});

test("A19: `format` CHANGES the prompt", () => {
  assert.notStrictEqual(promptAs({}, "json"), promptAs({}, "lines"),
    "the two formats build an identical prompt, so `format` requests nothing");
});

test("A19: the `lines` prompt asks for the marker shape", () => {
  const text = promptAs({}, "lines");
  for (const marker of ["@@block", "@@anchor", "@@text"]) {
    assert.ok(text.includes(marker), `the lines prompt never mentions ${marker}`);
  }
});

test("A19: the `json` prompt does NOT ask for the marker shape", () => {
  const text = promptAs({}, "json");
  assert.ok(!text.includes("@@block"), "the json prompt asks for @@block, so a model cannot tell the two requests apart");
});

test("A19: both formats are deterministic", () => {
  for (const format of ["json", "lines"]) {
    assert.strictEqual(promptAs({ diagnostics: DIAGS, callees: CALLEES }, format), promptAs({ diagnostics: DIAGS, callees: CALLEES }, format),
      `the ${format} prompt changed between two builds`);
  }
});

test("A19: both formats carry the fourteen dimension ids and no banned spelling", () => {
  for (const format of ["json", "lines"]) {
    const text = promptAs({ diagnostics: DIAGS, callees: CALLEES }, format);
    const missing = DIMENSION_IDS.filter((id) => !text.includes(id));
    assert.deepStrictEqual(missing, [], `the ${format} prompt is missing ${missing.join(", ")}`);
    const banned = BANNED_SPELLINGS.filter((x) => text.includes(x));
    assert.deepStrictEqual(banned, [], `the ${format} prompt carries ${banned.join(", ")}`);
  }
});

test("A19: both formats obey A16 and A16b", () => {
  for (const format of ["json", "lines"]) {
    for (const [label, evidence] of EVIDENCE_COMBOS) {
      const text = promptAs(evidence, format);
      const found = FORBIDDEN_RENDERS.filter((token) => text.includes(token));
      assert.deepStrictEqual(found, [], `the ${format} prompt for ${label} contains ${found.join(", ")}`);
    }
    assert.ok(promptAs({}, format).includes("reported nothing"), `the ${format} prompt drops the \`reported nothing\` phrase`);
    assert.ok(!promptAs({ diagnostics: DIAGS }, format).includes("reported nothing"), `the ${format} prompt keeps the phrase with real diagnostics`);
  }
});

test("A19: a line-shaped reply spelling was discovered", () => {
  assert.ok(LINE_FORMAT, () =>
    "no candidate spelling of the @@block line shape round-tripped through readAdviceReply. " +
    "The `lines` prompt asks for this:\n\n" + promptAs({}, "lines"));
});

test("A19: a LINES-shaped reply is read, though `json` is the default that was asked for", () => {
  const out = read(asLines(PROBE));
  assert.strictEqual(out.ok, true, `a lines-shaped reply was refused: ${JSON.stringify(out)}`);
  assert.strictEqual(out.blocks.length, 2);
  assert.deepStrictEqual(out.blocks.map((b) => b.anchor), PROBE.map((b) => b.anchor));
  assert.deepStrictEqual(out.blocks.map((b) => b.text), PROBE.map((b) => b.text));
  assert.deepStrictEqual(out.blocks.map((b) => b.dimension), PROBE.map((b) => b.dimension));
});

test("A19: a JSON-shaped reply is read even when `lines` was the shape requested", () => {
  // The reader takes no format argument at all, which is the mechanism: it
  // cannot know what was asked for, so it cannot refuse over it.
  const asked = promptAs({}, "lines");
  assert.ok(asked.includes("@@block"));
  const out = read(reply([block("return total;", "answered in the other shape")]));
  assert.strictEqual(out.ok, true, "a json reply was refused because the prompt had asked for lines");
  assert.strictEqual(out.blocks[0].text, "answered in the other shape");
});

test("A19: the line shape carries `line` through as the tie-breaker", () => {
  const out = read(asLines([{ dimension: "cqs", anchor: "send(payload);", text: "the retry is silent", line: DISPATCH_START + 4 }]));
  assert.strictEqual(out.ok, true, `a lines reply carrying @@line was refused: ${JSON.stringify(out)}`);
  const { placed, unplaced } = place(Array.from(out.blocks), dispatch());
  assert.deepStrictEqual(Array.from(unplaced), [], `the @@line tie-breaker did not survive the reader: ${JSON.stringify(unplaced)}`);
  assert.strictEqual(placed[0].line, DISPATCH_START + 4);
  assert.strictEqual(placed[0].lineText, DISPATCH_LINES[4]);
});

test("A19 lenient: a missing @@line is fine, because it is only a tie-breaker", () => {
  const out = read(asLines([{ dimension: "cqs", anchor: "return total;", text: "a" }]));
  assert.strictEqual(out.ok, true, `a block with no @@line was refused: ${JSON.stringify(out)}`);
  assert.strictEqual(out.blocks.length, 1);
  const { placed } = place(Array.from(out.blocks));
  assert.strictEqual(placed[0].line, wline(7), "a block with no @@line would not place by its anchor");
});

test("A19 lenient: a missing @@dimension falls to the `advice` slug", () => {
  const out = read(asLines([{ anchor: "return total;", text: "a thing to say" }]));
  assert.strictEqual(out.ok, true, `a block with no @@dimension was refused: ${JSON.stringify(out)}`);
  assert.strictEqual(out.blocks.length, 1);
  assert.strictEqual(out.blocks[0].dimension, "advice",
    `a dimension-less block came back as ${JSON.stringify(out.blocks[0].dimension)} rather than the \`advice\` slug`);
});

test("A19 lenient: a @@text running over several lines folds into one", () => {
  const raw = asLines([{ dimension: "cqs", anchor: "return total;", text: "the first sentence." }]) +
    "\nand the second sentence.\nand a third.";
  const out = read(raw);
  assert.strictEqual(out.ok, true, `a folded @@text was refused: ${JSON.stringify(out)}`);
  assert.strictEqual(out.blocks.length, 1);
  const text = out.blocks[0].text;
  assert.ok(!text.includes("\n"), `the folded text still carries a newline: ${JSON.stringify(text)}`);
  for (const fragment of ["the first sentence.", "and the second sentence.", "and a third."]) {
    assert.ok(text.includes(fragment), `the fold lost ${JSON.stringify(fragment)}; got ${JSON.stringify(text)}`);
  }
});

test("A19 lenient: a missing @@anchor drops THAT block alone", () => {
  const raw = asLines([
    { dimension: "cqs", text: "no anchor on this one" },
    { dimension: "nesting", anchor: "return total;", text: "this one is whole" },
  ]);
  const out = read(raw);
  assert.strictEqual(out.ok, true, `an anchorless block failed the whole reply: ${JSON.stringify(out)}`);
  assert.strictEqual(out.blocks.length, 1, `expected one survivor, got ${JSON.stringify(out.blocks)}`);
  assert.strictEqual(out.blocks[0].text, "this one is whole");
});

test("A19 lenient: a missing @@text drops THAT block alone", () => {
  const raw = asLines([
    { dimension: "cqs", anchor: "wait();" },
    { dimension: "nesting", anchor: "return total;", text: "this one is whole" },
  ]);
  const out = read(raw);
  assert.strictEqual(out.ok, true, `a textless block failed the whole reply: ${JSON.stringify(out)}`);
  assert.strictEqual(out.blocks.length, 1, `expected one survivor, got ${JSON.stringify(out.blocks)}`);
  assert.strictEqual(out.blocks[0].text, "this one is whole");
});

test("A19 lenient: leniency does NOT extend to placement, so a dropped block cannot become a guess", () => {
  const raw = asLines([{ dimension: "cqs", text: "no anchor on this one" }]);
  const out = read(raw);
  assert.strictEqual(out.ok, true);
  assert.deepStrictEqual(Array.from(out.blocks), [], "an anchorless block survived the reader, and nothing downstream can place it honestly");
});

test("A19: a marker-looking string INSIDE @@text is not a marker", () => {
  const text = "the @@anchor marker is fine here, and so is @@text";
  const out = read(asLines([{ dimension: "cqs", anchor: "return total;", text }]));
  assert.strictEqual(out.ok, true, `a text mentioning a marker was refused: ${JSON.stringify(out)}`);
  assert.strictEqual(out.blocks.length, 1, `a mid-line marker split the block: ${JSON.stringify(out.blocks)}`);
  assert.strictEqual(out.blocks[0].text, text, "a mid-line marker was eaten out of the text");
  assert.strictEqual(out.blocks[0].anchor, "return total;");
});

test("A19: prose before the first @@block is ignored", () => {
  const raw = "Sure! Here is my review of this function.\n\nI found two things worth saying:\n\n" + asLines(PROBE);
  const out = read(raw);
  assert.strictEqual(out.ok, true, `a preamble sank a lines reply: ${JSON.stringify(out)}`);
  assert.strictEqual(out.blocks.length, 2);
  assert.deepStrictEqual(out.blocks.map((b) => b.anchor), PROBE.map((b) => b.anchor));
});

test("A19: a fenced lines reply is read, because A10 runs before the shape does", () => {
  const out = read("```\n" + asLines(PROBE) + "\n```");
  assert.strictEqual(out.ok, true, `a fenced lines reply was refused: ${JSON.stringify(out)}`);
  assert.strictEqual(out.blocks.length, 2);
});

test("A19: ADVICE_MAX_BLOCKS caps the line shape too", () => {
  const max = need("ADVICE_MAX_BLOCKS");
  const many = Array.from({ length: max + 3 }, (_, n) => ({ dimension: "cqs", anchor: `line${n}();`, text: `say ${n}` }));
  const out = read(asLines(many));
  assert.strictEqual(out.ok, true);
  assert.strictEqual(out.blocks.length, max, `the line shape returned ${out.blocks.length} blocks against a cap of ${max}`);
  assert.deepStrictEqual(out.blocks.map((b) => b.text), many.slice(0, max).map((b) => b.text));
});

test("A19: a lines reply drives a whole round through adviseFunction", async () => {
  const out = await round(asLines([{ dimension: "cqs", anchor: "return total;", text: "this both mutates and reports" }]));
  assert.strictEqual(out.failure, undefined, `a lines reply failed the round: ${JSON.stringify(out)}`);
  assert.strictEqual(out.placed.length, 1);
  assert.strictEqual(out.placed[0].line, wline(7));
  assert.strictEqual(out.placed[0].lineText, RETURN_LINE, "A5 does not hold for the line shape");
});

test("A19: the line shape obeys A2, A3 and A4 exactly as the json shape does", () => {
  const perLine = need("ADVICE_MAX_PER_LINE");
  const blocks = [
    { dimension: "cqs", anchor: "nothing();", text: "a miss" },
    { dimension: "cqs", anchor: "send(payload);", text: "an ambiguity" },
    ...Array.from({ length: perLine + 1 }, (_, n) => ({ dimension: "cqs", anchor: "wait();", text: `full ${n}` })),
  ].slice(0, need("ADVICE_MAX_BLOCKS"));
  const out = read(asLines(blocks));
  assert.strictEqual(out.ok, true);
  const { placed, unplaced } = place(Array.from(out.blocks), dispatch());
  for (const row of unplaced) {
    assert.ok(ALL_REASONS.includes(row.reason), `the line shape produced the free-text reason ${JSON.stringify(row.reason)}`);
  }
  for (const row of placed) {
    assert.ok(documentLines(dispatch()).has(row.lineText), "the line shape leaked reply text into lineText");
  }
});

test("A19: neither format's junk is readable, and neither throws", () => {
  const readAdviceReply = need("readAdviceReply");
  for (const raw of ["@@block", "@@anchor return total;", "@@block\n@@anchor\n@@text", "@@", "@@block @@anchor @@text"]) {
    assert.doesNotThrow(() => readAdviceReply(raw), `readAdviceReply threw on ${JSON.stringify(raw)}`);
    const out = readAdviceReply(raw);
    if (out.ok === false) {
      assert.strictEqual(out.failure.kind, "unreadable");
      assert.ok(out.failure.detail.trim().length > 0);
    } else {
      for (const b of out.blocks) {
        assert.strictEqual(typeof b.anchor, "string");
        assert.ok(b.anchor.trim().length > 0, `a block survived with a blank anchor: ${JSON.stringify(b)}`);
        assert.ok(b.text.trim().length > 0, `a block survived with a blank text: ${JSON.stringify(b)}`);
      }
    }
  }
});

// ===========================================================================
// A15. The prompt carries the rubric's dimensions and no library spelling table
// ===========================================================================

test("A15: all fourteen dimension IDS appear in the prompt, spelled as DimensionId spells them", () => {
  assert.strictEqual(DIMENSION_IDS.length, 14);
  const text = prompt({ diagnostics: DIAGS, callees: CALLEES });
  // Exact, case sensitive, hyphens included: the id is what a block's
  // `dimension` field is matched against when the comment is planted, so a
  // prose paraphrase in the prompt is not the same thing.
  const missing = DIMENSION_IDS.filter((id) => !text.includes(id));
  assert.deepStrictEqual(missing, [], `these rubric dimension ids are not in the prompt: ${missing.join(", ")}`);
});

test("A15: the ids are present with no evidence either", () => {
  const text = prompt({});
  const missing = DIMENSION_IDS.filter((id) => !text.includes(id));
  assert.deepStrictEqual(missing, []);
});

test("A15: a dimension id survives the round trip it exists for", () => {
  // The contract's stated reason for the ids: they are what `dimension` is
  // matched against when the comment is planted.
  const out = read(reply([block("return total;", "x", "adjacent-params")]));
  assert.strictEqual(out.blocks[0].dimension, "adjacent-params");
  const { placed } = place([block("return total;", "x", "adjacent-params")]);
  assert.strictEqual(placed[0].block.dimension, "adjacent-params");
});

test("A15: none of the banned library spellings appears in the prompt", () => {
  const text = prompt({ diagnostics: DIAGS, callees: CALLEES });
  const found = BANNED_SPELLINGS.filter((s) => text.includes(s));
  assert.deepStrictEqual(found, [], `the deleted spelling table is back inside the prompt: ${found.join(", ")}`);
});

test("A15: none of the banned spellings appears with no evidence either", () => {
  const text = prompt({});
  const found = BANNED_SPELLINGS.filter((s) => text.includes(s));
  assert.deepStrictEqual(found, [], `the deleted spelling table is back inside the prompt: ${found.join(", ")}`);
});

test("A15 non-vacuity: the prompt does carry the function's name", () => {
  const text = prompt({});
  assert.ok(text.includes("totalWidth"), "the prompt does not name the function, so the banned-spelling row above proves nothing");
});

test("A15 non-vacuity: the prompt does carry the function's body lines", () => {
  const text = prompt({});
  assert.ok(text.includes(BODY_MARKER), "a marker planted in the body is not in the prompt, so the model is not being shown the code");
  assert.ok(text.includes("for (const cell of cells) {"), "a body line is not in the prompt");
  assert.ok(text.includes("return total;"), "the return line is not in the prompt");
});

test("A15 non-vacuity: the prompt does carry the doc comment line", () => {
  const text = prompt({});
  assert.ok(text.includes("Adds up the widths of the cells in a row."), "the doc comment is not in the prompt, and A8 says it is anchorable");
});

test("A15 non-vacuity: the prompt does carry the evidence it was handed", () => {
  const text = prompt({ diagnostics: DIAGS, callees: CALLEES });
  assert.ok(text.includes("the accumulator is written before it is read"), "a diagnostic message is not in the prompt");
  assert.ok(text.includes("widthOf"), "a callee name is not in the prompt");
});

// ===========================================================================
// A16. The prompt renders every evidence block it is given and none it is not
// ===========================================================================

const EVIDENCE_COMBOS = [
  ["both absent", {}],
  ["diagnostics absent, callees empty", { callees: [] }],
  ["diagnostics absent, callees present", { callees: CALLEES }],
  ["diagnostics empty, callees absent", { diagnostics: [] }],
  ["both empty", { diagnostics: [], callees: [] }],
  ["diagnostics empty, callees present", { diagnostics: [], callees: CALLEES }],
  ["diagnostics present, callees absent", { diagnostics: DIAGS }],
  ["diagnostics present, callees empty", { diagnostics: DIAGS, callees: [] }],
  ["both present", { diagnostics: DIAGS, callees: CALLEES }],
  ["both explicitly undefined", { diagnostics: undefined, callees: undefined }],
];

for (const [label, evidence] of EVIDENCE_COMBOS) {
  test(`A16: ${label} renders no undefined, null, NaN or [object Object]`, () => {
    const text = prompt(evidence);
    assert.strictEqual(typeof text, "string");
    assert.ok(text.length > 0, "the prompt is empty");
    const found = FORBIDDEN_RENDERS.filter((token) => text.includes(token));
    assert.deepStrictEqual(found, [], `the prompt for ${label} contains ${found.join(", ")}`);
  });
}

test("A16: diagnostics present render their line, source, code and message", () => {
  const text = prompt({ diagnostics: DIAGS });
  assert.ok(text.includes("12"), "the diagnostic's document line is missing");
  assert.ok(text.includes("ts"), "the diagnostic's source is missing");
  assert.ok(text.includes("TS6133"), "the diagnostic's code is missing");
  assert.ok(text.includes("the accumulator is written before it is read"), "the diagnostic's message is missing");
  assert.ok(text.includes("a returned width can be fractional here"), "the second diagnostic's message is missing");
});

test("A16: a diagnostic with an empty code renders without a hole", () => {
  const only = [{ line: 17, severity: "error", source: "ts", code: "", message: "a returned width can be fractional here" }];
  const text = prompt({ diagnostics: only });
  assert.ok(text.includes("a returned width can be fractional here"));
  const found = FORBIDDEN_RENDERS.filter((token) => text.includes(token));
  assert.deepStrictEqual(found, [], `an empty code rendered as ${found.join(", ")}`);
});

test("A16: callees present render their name, signature and doc", () => {
  const text = prompt({ callees: CALLEES });
  assert.ok(text.includes("widthOf(cell: Cell): number"), "the callee's signature is missing");
  assert.ok(text.includes("The rendered width of one cell."), "the callee's doc is missing");
  assert.ok(text.includes("wait(): void"), "the second callee's signature is missing");
});

test("A16: a callee with an empty doc renders without a hole", () => {
  const text = prompt({ callees: [{ name: "wait", signature: "wait(): void", doc: "" }] });
  assert.ok(text.includes("wait(): void"));
  const found = FORBIDDEN_RENDERS.filter((token) => text.includes(token));
  assert.deepStrictEqual(found, [], `an empty doc rendered as ${found.join(", ")}`);
});

test("A16: absent diagnostics do not leak the present ones' text", () => {
  const text = prompt({ callees: CALLEES });
  assert.ok(!text.includes("TS6133"), "a diagnostic that was not handed in appears in the prompt");
  assert.ok(!text.includes("the accumulator is written before it is read"));
});

test("A16: absent callees do not leak the present ones' text", () => {
  const text = prompt({ diagnostics: DIAGS });
  assert.ok(!text.includes("widthOf(cell: Cell): number"), "a callee that was not handed in appears in the prompt");
});

test("A16b: with NO diagnostics the prompt contains the phrase `reported nothing`", () => {
  assert.ok(prompt({}).includes("reported nothing"),
    "with diagnostics absent the prompt does not say `reported nothing`, so a reader cannot tell a silent toolchain from one that was never asked");
});

test("A16b: with an EMPTY diagnostics array the prompt contains the phrase too", () => {
  assert.ok(prompt({ diagnostics: [] }).includes("reported nothing"),
    "with diagnostics empty the prompt does not say `reported nothing`");
});

test("A16b: the phrase is there whatever the callees are doing", () => {
  for (const evidence of [{}, { diagnostics: [] }, { callees: CALLEES }, { diagnostics: [], callees: CALLEES }, { callees: [] }]) {
    assert.ok(prompt(evidence).includes("reported nothing"), `no \`reported nothing\` for ${JSON.stringify(evidence)}`);
  }
});

test("A16b: the phrase DISCRIMINATES, so it is absent when diagnostics are present", () => {
  // Both directions are now the contract's letter (tightened 2026-08-29):
  // stated one way only, the invariant would be satisfied by a prompt that
  // printed the phrase unconditionally, which is the reader confusion it
  // exists to prevent.
  assert.ok(!prompt({ diagnostics: DIAGS }).includes("reported nothing"),
    "the prompt says `reported nothing` while rendering two real diagnostics, so the phrase distinguishes nothing");
});

test("A16b: the phrase is absent for a single diagnostic too, and for every callee shape", () => {
  const one = [{ line: 12, severity: "hint", source: "ts", code: "TS7006", message: "the parameter has an implicit type" }];
  for (const evidence of [{ diagnostics: one }, { diagnostics: one, callees: [] }, { diagnostics: one, callees: CALLEES }, { diagnostics: DIAGS, callees: CALLEES }]) {
    assert.ok(!prompt(evidence).includes("reported nothing"), `the phrase survived real diagnostics for ${JSON.stringify(evidence).slice(0, 60)}`);
  }
});

test("A16: the empty and absent cases are not simply the whole evidence section missing", () => {
  // The contract says the prompt "says so rather than emitting an empty
  // heading". Its wording is the implementation's to choose, so the only
  // testable part is that the empty case still produces a real prompt and
  // differs from the populated one.
  const bare = prompt({});
  const full = prompt({ diagnostics: DIAGS, callees: CALLEES });
  assert.ok(bare.length > 0);
  assert.notStrictEqual(bare, full, "the prompt is identical with and without evidence, so the evidence is not being rendered at all");
});

// ===========================================================================
// A17. `buildAdvicePrompt` is deterministic
// ===========================================================================

test("A17: the same inputs give a byte-identical prompt", () => {
  const a = prompt({ diagnostics: DIAGS, callees: CALLEES });
  const b = prompt({ diagnostics: DIAGS, callees: CALLEES });
  assert.strictEqual(a, b);
});

test("A17: every evidence combination is deterministic", () => {
  for (const [label, evidence] of EVIDENCE_COMBOS) {
    assert.strictEqual(prompt(evidence), prompt(evidence), `the prompt for ${label} changed between two builds`);
  }
});

test("A17: a fresh copy of the same fixture gives the same prompt", () => {
  assert.strictEqual(prompt({}, widths()), prompt({}, widths()));
});

test("A17: buildAdvicePrompt does not mutate its inputs", () => {
  const fn = widths();
  const evidence = { diagnostics: DIAGS, callees: CALLEES };
  const before = JSON.stringify([fn, evidence]);
  prompt(evidence, fn);
  assert.strictEqual(JSON.stringify([fn, evidence]), before, "buildAdvicePrompt mutated what it was given");
});

// ===========================================================================
// A18. The module never imports vscode
// ===========================================================================

test("A18: nothing in the module's bundle reaches for vscode", () => {
  if (loadError) throw new Error(`src/core/criticizeAdvise does not bundle: ${loadError.message}`);
  // esbuild bundling for node would already have failed to resolve a bare
  // `vscode` import; reading the emitted bundle catches a dynamic or
  // externalised reach too. A build artifact is not the source, so
  // blind-oracle discipline holds.
  const bundled = fs.readFileSync(BUNDLE_PATH, "utf8");
  const hits = bundled.match(/["']vscode["']/g) || [];
  assert.deepStrictEqual(hits, [], "the bundled module references the vscode module, which src/core may not do");
});

// ===========================================================================
// Whole-round wiring: the invariants must survive adviseFunction, not just
// placeAdvice. A guard that only holds on the inner function is not a guard.
// ===========================================================================

test("wiring: a fenced reply survives the whole round", async () => {
  const out = await round("```json\n" + reply([block("return total;")]) + "\n```");
  assert.strictEqual(out.placed.length, 1, `a fenced reply did not survive adviseFunction: ${JSON.stringify(out)}`);
});

test("wiring: an ambiguous anchor is unplaced through the whole round", async () => {
  const out = await round(reply([block("send(payload);")]), dispatch());
  assert.deepStrictEqual(Array.from(out.placed), [], "an ambiguous anchor was placed by adviseFunction");
  assert.strictEqual(out.unplaced.length, 1);
});

test("wiring: two blocks on one line both survive the whole round, in order", async () => {
  const out = await round(reply([block("return total;", "a"), block("return total;", "b")]));
  assert.deepStrictEqual(Array.from(out.unplaced), [], `the relaxed per-line bound did not reach adviseFunction: ${JSON.stringify(out.unplaced)}`);
  assert.deepStrictEqual(out.placed.map((r) => r.block.text), ["a", "b"]);
  assert.deepStrictEqual(out.placed.map((r) => r.line), [wline(7), wline(7)]);
});

test("wiring: the per-line bound is enforced through the whole round", async () => {
  const perLine = need("ADVICE_MAX_PER_LINE");
  const blocks = Array.from({ length: perLine + 1 }, (_, n) => block("return total;", `say ${n}`));
  const out = await round(reply(blocks));
  assert.strictEqual(out.placed.length, perLine, "adviseFunction ignored the per-line bound");
  assert.strictEqual(out.unplaced.length, 1);
  assert.strictEqual(out.unplaced[0].reason, REASON.FULL);
});

test("wiring: placed is ascending through the whole round", async () => {
  const out = await round(reply([block("return total;", "b"), block(DOC_LINE, "a")]));
  const lines = out.placed.map((p) => p.line);
  assert.deepStrictEqual(lines, lines.slice().sort((x, y) => x - y), `adviseFunction returned ${lines}`);
});

test("wiring: the prompt the transport is handed is the one buildAdvicePrompt builds", async () => {
  const adviseFunction = need("adviseFunction");
  let seen = null;
  const fn = widths();
  const evidence = { diagnostics: DIAGS, callees: CALLEES };
  await withDeadline(
    adviseFunction(async (p) => { seen = p; return reply([block("return total;")]); }, fn, LANG, evidence),
    5000,
    "adviseFunction",
  );
  assert.strictEqual(typeof seen, "string", "adviseFunction never called the transport");
  assert.strictEqual(seen, prompt(evidence, widths()), "adviseFunction sent something other than buildAdvicePrompt's output");
});
