// BLIND ORACLE: the four honesty dimensions become a model judgement
// (session-v64 phase 10).
//
// Written from `session-v64/contracts/honesty-model.md` ALONE, plus
// `src/core/criticizeTypes.ts` for the shapes the contract references
// (`FunctionUnderReview`, `CriticizeLang`, `DimensionOutcome`,
// `DetectorFinding`) so the fixtures below are well formed.
// `src/core/criticizeHonestyModel.ts` (the module under test) and
// `src/core/criticizeHonesty.ts` (the module it replaces) were never opened
// while this file was written. Nothing here asserts an internal.
//
// The defect this phase removes: 67 regexes could only find library
// spellings someone had written down, so `clean` meant "none of my patterns
// matched" rather than "this function reads nothing bound outside it". The
// replacement asks a model, and the whole risk of asking a model is that its
// text becomes the product's evidence, or that a dead model reads as a clean
// function. I1 and I5 are the two rows that stop that, and they get the most
// coverage here.
//
// TWO DELIBERATE CHOICES IN THIS FILE:
//
//  - THE REPLY FORMAT IS DISCOVERED, NOT GUESSED. The contract says the
//    spelling of a reply line is the implementation's to choose and a test
//    must not assume it. So `chosenFormat()` probes `readHonestyReply` with a
//    catalogue of plausible spellings and keeps the first one that round-trips
//    a known map exactly. Every row needing a RAW reply uses that spelling.
//    If none round-trips, the format row fails and prints
//    `buildHonestyPrompt`'s own text so a human can read the format the
//    implementation actually asked for.
//  - MOST INVARIANTS AVOID THE FORMAT ENTIRELY. `honestyOutcomes` takes the
//    line numbers as a plain record, so I1, I2, I3, I4, I6, I7 and I8 are
//    driven through it directly and cannot be knocked over by a parser
//    disagreement.
//
// CONTRACT REVISION 2026-08-29. The first pass of this file went red on I10
// and reported seven ambiguities. The contract was rewritten rather than the
// test loosened: I5 now wins every tie (a reply naming none of the four is
// unreadable, never four cleans), I2's "in range" is defined as "a line
// `bodyLines(fn, lang)` yields", I3 is split into masked-nameability and raw
// evidence, and I4b, I12's inversion note and I13's ordering are new. This
// file now holds the corrected wording.
//
// Run: SKIP_LIVE=1 node --test test/blind-v64-p10-honesty.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { bundleCore } = require("./.blind-util.cjs");

// ===========================================================================
// Loading, and failing legibly while the module does not exist
// ===========================================================================

const TAG = "blind-v64-p10-honesty";
const BUNDLE_PATH = path.join(__dirname, `.${TAG}.bundle.cjs`);
const ENTRY_PATH = path.join(__dirname, `.${TAG}.entry.ts`);

let mod = null;
let loadError = null;
let cleanup = () => {};
try {
  const loaded = bundleCore(TAG, `export * from "../src/core/criticizeHonestyModel";\n`);
  mod = loaded.mod;
  cleanup = loaded.cleanup;
} catch (err) {
  loadError = err;
  // bundleCore writes its entry BEFORE esbuild runs, so a resolve failure
  // leaves both files behind. Expected RED until phase 10 exists; don't litter.
  cleanup = () => {
    for (const leftover of [ENTRY_PATH, BUNDLE_PATH]) {
      fs.rmSync(leftover, { force: true });
    }
  };
}
test.after(() => cleanup());

const SURFACE = [
  "HONESTY_DIMENSIONS",
  "buildHonestyPrompt",
  "readHonestyReply",
  "honestyOutcomes",
  "judgeHonesty",
  "HONESTY_DETAIL",
];

/** One exported symbol, or a failure that names exactly what is missing
 *  rather than a stack trace out of the loader. */
function need(name) {
  if (loadError) {
    throw new Error(
      `src/core/criticizeHonestyModel does not exist yet (or does not bundle): ${loadError.message}`,
    );
  }
  const value = mod[name];
  if (value === undefined) {
    throw new Error(`the contract puts \`${name}\` on the surface, but the module exports no such symbol`);
  }
  return value;
}

// ===========================================================================
// Fixtures
// ===========================================================================

const DIMENSIONS = ["clock", "prng", "env", "world"];
const BACKEND = "qwen-oracle-9000";

// Marker strings planted in the profile's own honesty tables. I9 says the
// prompt must not carry a list of clock/PRNG/env/file-read spellings; if the
// implementation renders `lang.honesty` into the prompt in any form (source,
// String(), JSON), these come with it and the I9 row sees them.
const TABLE_MARKERS = {
  clock: "ZZ_CLOCK_TABLE_MARKER",
  prng: "ZZ_PRNG_TABLE_MARKER",
  env: "ZZ_ENV_TABLE_MARKER",
  world: "ZZ_WORLD_TABLE_MARKER",
};

const LANG = {
  languageIds: ["typescript"],
  displayName: "TypeScript",
  honesty: {
    clock: [new RegExp(TABLE_MARKERS.clock)],
    prng: [new RegExp(TABLE_MARKERS.prng)],
    env: [new RegExp(TABLE_MARKERS.env)],
    world: [new RegExp(TABLE_MARKERS.world)],
  },
  lineComment: "//",
  logWrites: [],
  verbatimStrings: [],
  craft: {
    paramStyle: "typescript",
    boolTypes: ["boolean"],
    unitReturns: ["void"],
    underscoreMeansUnused: true,
    paramCountThreshold: 4,
    nestingThreshold: 3,
    blocks: "braces",
    publicSurface: { kind: "keyword", pattern: /^export\b/ },
    undocumentedDetail: "no doc comment",
    guards: [],
    mutations: [],
    receiverMutation: "none",
    failure: { kind: "unknowable", reason: "TypeScript cannot admit a throw in a signature" },
  },
};

// The unit under review. Document lines are startLine + index, so:
//
//   100  /** Stamp the row. */            doc comment   OUT OF BODY
//   101  function stamp(row) {            head          OUT OF BODY
//   102    const at = readClock();        body          <- first legal line
//   103                                   body, EMPTY
//   104                                   body, WHITESPACE ONLY
//   105    const key = nextKey();         body
//   106    row.at = at;                   body
//   107    return key;                    body
//   108  }                                body           <- last legal line
//
// THE BODY DELIBERATELY CARRIES NO LIBRARY SPELLING (`readClock`, `nextKey`,
// not `Date.now` or `Math.random`). The prompt legitimately quotes the
// function, so a fixture that spelled a real clock call would make the I9
// banned-spelling row fire on the function rather than on a name table.
//
// The head line's own remainder is empty (`function stamp(row) {` carries no
// code after its brace), so there is no one-line-body ambiguity about whether
// document line 101 is nameable: the contract says before `bodyIndex` is out
// of range, and this fixture leaves no second reading.
const FN_LINES = [
  "/** Stamp the row. */",
  "function stamp(row) {",
  "  const at = readClock();",
  "",
  "   ",
  "  const key = nextKey();",
  "  row.at = at;",
  "  return key;",
  "}",
];

const FIRST_BODY_LINE = 102;
const LAST_BODY_LINE = 108;
const EMPTY_LINE = 103;
const BLANK_LINE = 104;

/** A fresh `FunctionUnderReview` every call, so a mutation in one row cannot
 *  reach another. */
function unit() {
  return {
    languageId: "typescript",
    name: "stamp",
    lines: FN_LINES.slice(),
    startLine: 100,
    headIndex: 1,
    bodyIndex: 2,
  };
}

/** The trimmed text of a DOCUMENT line of the fixture: what I1 says the
 *  evidence must be. */
function documentLine(n) {
  return FN_LINES[n - 100].trim();
}

// A ONE-LINE FUNCTION, where the declaration and the body share a line.
// `bodyLines` yields exactly one entry for this shape, the head line's own
// remainder, so document line 201 is the ONLY nameable line in the whole
// function. I2's index-arithmetic reading would have called it out of range
// and left 307 expression-bodied C# members and 79 single-line Rust functions
// with nothing nameable at all.
const ONE_LINE_LINES = [
  "/** The stamp. */",
  "function stamp() { return readClock(); }",
];
const ONE_LINE_DOC = 200;
const ONE_LINE_HEAD = 201;

function oneLineUnit() {
  return {
    languageId: "typescript",
    name: "stamp",
    lines: ONE_LINE_LINES.slice(),
    startLine: ONE_LINE_DOC,
    headIndex: 1,
    bodyIndex: 2,
  };
}

// A body whose lines exercise the two halves of I3: what MASKING decides is
// nameable, and what the RAW line gives as evidence.
//
//   300  function marked(row) {                         head, no doc
//   301    // reads the clock here                      comment only, MASKS BLANK
//   302    /* block comment */                          comment only, MASKS BLANK
//   303    const at = readClock(); // trailing note     code, then a comment
//   304    const label = "readClock() in a string";     code, string masked out
//   305    return at;
//   306  }
const MASK_LINES = [
  "function marked(row) {",
  "  // reads the clock here",
  "  /* block comment */",
  "  const at = readClock(); // trailing note",
  '  const label = "readClock() in a string";',
  "  return at;",
  "}",
];
const MASK_START = 300;
const COMMENT_LINE = 301;
const BLOCK_COMMENT_LINE = 302;
const CODE_THEN_COMMENT_LINE = 303;
const CODE_WITH_STRING_LINE = 304;

function maskUnit() {
  return {
    languageId: "typescript",
    name: "marked",
    lines: MASK_LINES.slice(),
    startLine: MASK_START,
    headIndex: 0,
    bodyIndex: 1,
  };
}

/** The trimmed RAW text of a document line of the masking fixture. */
function maskDocumentLine(n) {
  return MASK_LINES[n - MASK_START].trim();
}

const CONTEXT_EMPTY = {};
const CONTEXT_CALLEES = {
  callees: [
    { name: "nowMillis", doc: "Milliseconds since the epoch, read from the system clock." },
    { name: "rowKey", doc: "A stable key for a row." },
  ],
};

/** A complete `lines` record: the four keys always present, as the
 *  `Record<HonestyDimension, readonly number[]>` in the contract requires. */
function linesOf(partial) {
  return {
    clock: partial.clock ?? [],
    prng: partial.prng ?? [],
    env: partial.env ?? [],
    world: partial.world ?? [],
  };
}

/** The findings an outcome carries, whatever its state. */
function findingsOf(outcome) {
  return outcome && outcome.state === "flagged" ? outcome.findings : [];
}

/** Every finding across all four dimensions. */
function allFindings(outcomes) {
  return DIMENSIONS.flatMap((d) => findingsOf(outcomes[d]).map((f) => ({ dimension: d, finding: f })));
}

/** Reject rather than hang. I12's whole point is that a dead transport must
 *  not stall the caller, and a stalled suite reports nothing at all. */
function withDeadline(promise, ms, what) {
  let timer;
  const alarm = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} did not settle within ${ms}ms; it hung`)), ms);
  });
  return Promise.race([Promise.resolve(promise), alarm]).finally(() => clearTimeout(timer));
}

/** One whole round with a transport that answers `raw`. */
async function roundFor(raw, fn = unit(), context = CONTEXT_EMPTY) {
  const judgeHonesty = need("judgeHonesty");
  return withDeadline(judgeHonesty(async () => raw, fn, LANG, context, BACKEND), 5000, "judgeHonesty");
}

// ===========================================================================
// Discovering the reply spelling the implementation chose
// ===========================================================================

/** Candidate spellings of "dimension name then the document line numbers",
 *  one line per dimension that fires. The contract refuses to pin this, so
 *  the test refuses to pin it too: whichever one `readHonestyReply` reads
 *  back exactly is the one every raw-reply row below uses. */
const FORMAT_CANDIDATES = [
  { name: "`clock: 1, 2`", render: (e) => e.map(([d, n]) => `${d}: ${n.join(", ")}`).join("\n") },
  { name: "`clock: 1,2`", render: (e) => e.map(([d, n]) => `${d}: ${n.join(",")}`).join("\n") },
  { name: "`clock: 1 2`", render: (e) => e.map(([d, n]) => `${d}: ${n.join(" ")}`).join("\n") },
  { name: "`clock 1 2`", render: (e) => e.map(([d, n]) => `${d} ${n.join(" ")}`).join("\n") },
  { name: "`clock 1, 2`", render: (e) => e.map(([d, n]) => `${d} ${n.join(", ")}`).join("\n") },
  { name: "`clock - 1, 2`", render: (e) => e.map(([d, n]) => `${d} - ${n.join(", ")}`).join("\n") },
  { name: "`clock = 1, 2`", render: (e) => e.map(([d, n]) => `${d}=${n.join(",")}`).join("\n") },
  { name: "`clock: [1, 2]`", render: (e) => e.map(([d, n]) => `${d}: [${n.join(", ")}]`).join("\n") },
  { name: "`- clock: 1, 2`", render: (e) => e.map(([d, n]) => `- ${d}: ${n.join(", ")}`).join("\n") },
  { name: "`CLOCK: 1, 2`", render: (e) => e.map(([d, n]) => `${d.toUpperCase()}: ${n.join(", ")}`).join("\n") },
  { name: "`clock | 1, 2`", render: (e) => e.map(([d, n]) => `${d} | ${n.join(", ")}`).join("\n") },
  { name: "`clock lines 1, 2`", render: (e) => e.map(([d, n]) => `${d} lines ${n.join(", ")}`).join("\n") },
  { name: "JSON object", render: (e) => JSON.stringify(Object.fromEntries(e)) },
];

const PROBE = { clock: [102, 105], env: [106] };

let formatMemo;

/** The first candidate spelling `readHonestyReply` reads back exactly, or a
 *  failure carrying the prompt so a human can see the real format. */
function chosenFormat() {
  if (formatMemo !== undefined) {
    if (formatMemo.error) {
      throw formatMemo.error;
    }
    return formatMemo.format;
  }
  const readHonestyReply = need("readHonestyReply");
  const want = linesOf(PROBE);
  const tried = [];
  for (const candidate of FORMAT_CANDIDATES) {
    const raw = candidate.render(Object.entries(PROBE));
    let result;
    try {
      result = readHonestyReply(raw);
    } catch (err) {
      tried.push(`${candidate.name}: THREW ${err && err.message} (readHonestyReply is documented total)`);
      continue;
    }
    if (result && result.ok === true) {
      const got = linesOf(result.lines || {});
      const same = DIMENSIONS.every(
        (d) => Array.from(got[d]).join(",") === Array.from(want[d]).join(","),
      );
      if (same) {
        formatMemo = { format: candidate };
        return candidate;
      }
      tried.push(`${candidate.name}: parsed but read back ${JSON.stringify(got)}`);
      continue;
    }
    tried.push(`${candidate.name}: refused`);
  }
  const prompt = promptOrEmpty();
  const error = new Error(
    "no candidate reply spelling round-tripped through readHonestyReply, so no raw-reply row can be " +
      `driven. Tried:\n  ${tried.join("\n  ")}\n\nbuildHonestyPrompt asked for:\n${prompt}`,
  );
  formatMemo = { error };
  throw error;
}

/** `buildHonestyPrompt`'s text, or a note, purely for a failure message. */
function promptOrEmpty() {
  try {
    return String(need("buildHonestyPrompt")(unit(), LANG, CONTEXT_EMPTY));
  } catch (err) {
    return `<buildHonestyPrompt unavailable: ${err && err.message}>`;
  }
}

/** A raw reply in the discovered spelling. `entries` is an array of
 *  [dimensionName, lineNumbers], and the dimension name is NOT constrained to
 *  the four, so I10 can name `sql`. */
function reply(entries) {
  return chosenFormat().render(entries);
}

// ===========================================================================
// Surface
// ===========================================================================

test("surface: the module exports every symbol the contract names", () => {
  for (const name of SURFACE) {
    assert.notStrictEqual(need(name), undefined, `missing export: ${name}`);
  }
  assert.strictEqual(typeof need("buildHonestyPrompt"), "function");
  assert.strictEqual(typeof need("readHonestyReply"), "function");
  assert.strictEqual(typeof need("honestyOutcomes"), "function");
  assert.strictEqual(typeof need("judgeHonesty"), "function");
});

test("I13: HONESTY_DIMENSIONS is the four dimensions in rubric order", () => {
  const dims = need("HONESTY_DIMENSIONS");
  assert.strictEqual(Array.isArray(dims), true, "HONESTY_DIMENSIONS must be an array");
  assert.deepStrictEqual(
    Array.from(dims),
    ["clock", "prng", "env", "world"],
    "the card renders in rubric order, so an unspecified order would let it drift",
  );
});

test("surface: honestyOutcomes and judgeHonesty both answer with exactly the four keys", async () => {
  const honestyOutcomes = need("honestyOutcomes");
  const pure = honestyOutcomes(unit(), LANG, linesOf({ clock: [FIRST_BODY_LINE] }));
  assert.deepStrictEqual(Object.keys(pure).sort(), DIMENSIONS.slice().sort());

  const round = await roundFor(reply([["clock", [FIRST_BODY_LINE]]]));
  assert.deepStrictEqual(Object.keys(round).sort(), DIMENSIONS.slice().sort());
  for (const d of DIMENSIONS) {
    assert.ok(
      ["clean", "flagged", "blind"].includes(round[d].state),
      `${d} answered with a state that is not in DimensionOutcome: ${JSON.stringify(round[d])}`,
    );
  }
});

test("format: some spelling of `dimension then document line numbers` round-trips through readHonestyReply", () => {
  const format = chosenFormat();
  assert.ok(format.name.length > 0);
});

// ===========================================================================
// I1. The evidence is the document's own line, never the model's text
// ===========================================================================

test("I1: the evidence is the trimmed text of the DOCUMENT line the model named", () => {
  const honestyOutcomes = need("honestyOutcomes");
  const outcomes = honestyOutcomes(
    unit(),
    LANG,
    linesOf({ clock: [FIRST_BODY_LINE], prng: [105], world: [106] }),
  );

  assert.strictEqual(outcomes.clock.state, "flagged");
  assert.strictEqual(findingsOf(outcomes.clock).length, 1);
  assert.strictEqual(findingsOf(outcomes.clock)[0].evidence, documentLine(FIRST_BODY_LINE));
  assert.strictEqual(findingsOf(outcomes.clock)[0].evidence, "const at = readClock();");

  assert.strictEqual(findingsOf(outcomes.prng)[0].evidence, documentLine(105));
  assert.strictEqual(findingsOf(outcomes.world)[0].evidence, documentLine(106));
});

test("I1: the finding carries the 1-based DOCUMENT line number and the dimension that named it", () => {
  const honestyOutcomes = need("honestyOutcomes");
  const outcomes = honestyOutcomes(unit(), LANG, linesOf({ env: [107], clock: [LAST_BODY_LINE] }));

  assert.strictEqual(findingsOf(outcomes.env)[0].line, 107);
  assert.strictEqual(findingsOf(outcomes.env)[0].dimension, "env");
  assert.strictEqual(findingsOf(outcomes.clock)[0].line, LAST_BODY_LINE);
  assert.strictEqual(findingsOf(outcomes.clock)[0].dimension, "clock");
});

test("I1: evidence is never the empty string, and always a line that is actually in the slice", () => {
  const honestyOutcomes = need("honestyOutcomes");
  const legal = [];
  for (let n = FIRST_BODY_LINE; n <= LAST_BODY_LINE; n++) {
    legal.push(n);
  }
  const outcomes = honestyOutcomes(unit(), LANG, linesOf({ clock: legal, prng: legal, env: legal, world: legal }));
  const slice = FN_LINES.map((l) => l.trim());

  const found = allFindings(outcomes);
  assert.ok(found.length > 0, "naming every body line produced no findings at all");
  for (const { dimension, finding } of found) {
    assert.notStrictEqual(finding.evidence, "", `${dimension} line ${finding.line} carried empty evidence`);
    assert.ok(
      slice.includes(finding.evidence),
      `${dimension} line ${finding.line} carried evidence that is not any line of the slice: ${JSON.stringify(finding.evidence)}`,
    );
    assert.strictEqual(finding.evidence, documentLine(finding.line));
  }
});

test("I1: no model text reaches DetectorFinding.evidence, even when the reply is full of prose", async () => {
  // The model's own words, in the shapes a real reply carries them: a
  // preamble sentence, a per-line justification, a quoted "line" of its own
  // invention. None of these may become evidence. This row holds whether the
  // parser reads past the prose or refuses the whole reply, because a refusal
  // yields no findings and therefore no leak either.
  const prose = [
    "Looking at this function, it clearly reads the wall clock.",
    "const at = TOTALLY_INVENTED_LINE();",
    "because Date.now is a clock read",
  ];
  const raw = [prose[0], reply([["clock", [FIRST_BODY_LINE]]]), prose[1], prose[2]].join("\n");

  const outcomes = await roundFor(raw);
  for (const { dimension, finding } of allFindings(outcomes)) {
    assert.strictEqual(
      finding.evidence,
      documentLine(finding.line),
      `${dimension} evidence is not the document's own line: ${JSON.stringify(finding.evidence)}`,
    );
    for (const needle of prose) {
      assert.strictEqual(
        finding.evidence.includes(needle),
        false,
        `${dimension} evidence carried the model's own text: ${JSON.stringify(finding.evidence)}`,
      );
    }
    assert.strictEqual(finding.evidence.includes("TOTALLY_INVENTED_LINE"), false);
  }
});

test("I1: end to end, a whole round's evidence still comes out of the document", async () => {
  const outcomes = await roundFor(reply([["clock", [FIRST_BODY_LINE]], ["prng", [105]]]));
  assert.strictEqual(outcomes.clock.state, "flagged");
  assert.strictEqual(findingsOf(outcomes.clock)[0].evidence, documentLine(FIRST_BODY_LINE));
  assert.strictEqual(outcomes.prng.state, "flagged");
  assert.strictEqual(findingsOf(outcomes.prng)[0].evidence, documentLine(105));
});

// ===========================================================================
// I2. An out-of-range line is DISCARDED, never repaired
// ===========================================================================

const OUT_OF_RANGE = [
  { what: "the doc comment line, before bodyIndex", n: 100 },
  { what: "the declaration head line, before bodyIndex", n: 101 },
  { what: "one line past the end of the slice", n: LAST_BODY_LINE + 1 },
  { what: "far past the end of the slice", n: 9999 },
  { what: "far before the slice", n: 1 },
  { what: "zero", n: 0 },
  { what: "negative", n: -4 },
  { what: "not an integer", n: 104.5 },
  { what: "NaN", n: NaN },
  { what: "Infinity", n: Infinity },
];

for (const { what, n } of OUT_OF_RANGE) {
  test(`I2: ${what} (${n}) produces no finding, and does not clamp or shift`, () => {
    const honestyOutcomes = need("honestyOutcomes");
    const outcomes = honestyOutcomes(unit(), LANG, linesOf({ clock: [n] }));

    assert.notStrictEqual(outcomes.clock.state, "blind", `an out-of-range line failed the dimension: ${what}`);
    assert.strictEqual(
      findingsOf(outcomes.clock).length,
      0,
      `an out-of-range line was repaired into a finding on line ${findingsOf(outcomes.clock)[0] && findingsOf(outcomes.clock)[0].line}`,
    );
  });
}

test("I2: an out-of-range line beside a legal one keeps the legal one and drops only the bad one", () => {
  const honestyOutcomes = need("honestyOutcomes");
  const outcomes = honestyOutcomes(
    unit(),
    LANG,
    linesOf({ clock: [9999, FIRST_BODY_LINE, 0, 101, 106.5] }),
  );

  assert.strictEqual(outcomes.clock.state, "flagged");
  assert.deepStrictEqual(findingsOf(outcomes.clock).map((f) => f.line), [FIRST_BODY_LINE]);
  assert.strictEqual(findingsOf(outcomes.clock)[0].evidence, documentLine(FIRST_BODY_LINE));
});

test("I2: an out-of-range line does not fail the ROUND: the other three dimensions still answer", () => {
  const honestyOutcomes = need("honestyOutcomes");
  const outcomes = honestyOutcomes(unit(), LANG, linesOf({ clock: [9999], prng: [105] }));

  for (const d of DIMENSIONS) {
    assert.notStrictEqual(outcomes[d].state, "blind", `${d} went blind because another dimension named a bad line`);
  }
  assert.strictEqual(outcomes.prng.state, "flagged");
  assert.strictEqual(findingsOf(outcomes.prng)[0].line, 105);
});

test("I4b: a mentioned dimension whose every named line was discarded is `clean`", () => {
  const honestyOutcomes = need("honestyOutcomes");
  const outcomes = honestyOutcomes(unit(), LANG, linesOf({ clock: [9999, 0, 101] }));
  assert.deepStrictEqual(
    outcomes.clock,
    { state: "clean" },
    "not `flagged` with an empty finding list, which the type does not intend, and not `blind`, because the model did answer and the product did read it",
  );
});

// ---------------------------------------------------------------------------
// I2, the shape the old index-arithmetic wording would have broken: a function
// whose declaration and body share one line.
// ---------------------------------------------------------------------------

test("I2: in a one-line function, the shared declaration line IS nameable, because bodyLines yields it", () => {
  const honestyOutcomes = need("honestyOutcomes");
  const outcomes = honestyOutcomes(oneLineUnit(), LANG, linesOf({ clock: [ONE_LINE_HEAD] }));

  assert.strictEqual(
    outcomes.clock.state,
    "flagged",
    "the only line bodyLines yields for a one-line function was discarded, which leaves 307 expression-bodied C# members and 79 single-line Rust functions with nothing nameable at all",
  );
  assert.deepStrictEqual(findingsOf(outcomes.clock).map((f) => f.line), [ONE_LINE_HEAD]);
  assert.strictEqual(findingsOf(outcomes.clock)[0].evidence, "function stamp() { return readClock(); }");
});

test("I2: a one-line function's doc line and the line past its end are still discarded", () => {
  const honestyOutcomes = need("honestyOutcomes");
  for (const n of [ONE_LINE_DOC, ONE_LINE_HEAD + 1, 0, ONE_LINE_HEAD + 0.5]) {
    const outcomes = honestyOutcomes(oneLineUnit(), LANG, linesOf({ clock: [n] }));
    assert.strictEqual(findingsOf(outcomes.clock).length, 0, `line ${n} produced a finding in a two-line slice`);
    assert.notStrictEqual(outcomes.clock.state, "blind");
  }
});

// ===========================================================================
// I3. A blank line named is discarded
// ===========================================================================

test("I3: a named EMPTY line produces no finding", () => {
  const honestyOutcomes = need("honestyOutcomes");
  const outcomes = honestyOutcomes(unit(), LANG, linesOf({ clock: [EMPTY_LINE] }));
  assert.strictEqual(findingsOf(outcomes.clock).length, 0, "an empty line became a finding with empty evidence");
  assert.notStrictEqual(outcomes.clock.state, "blind");
});

test("I3: a named WHITESPACE-ONLY line produces no finding", () => {
  const honestyOutcomes = need("honestyOutcomes");
  const outcomes = honestyOutcomes(unit(), LANG, linesOf({ env: [BLANK_LINE] }));
  assert.strictEqual(findingsOf(outcomes.env).length, 0, "a whitespace-only line became a finding");
  assert.notStrictEqual(outcomes.env.state, "blind");
});

test("I3: a blank line beside a real one keeps the real one", () => {
  const honestyOutcomes = need("honestyOutcomes");
  const outcomes = honestyOutcomes(unit(), LANG, linesOf({ clock: [EMPTY_LINE, 105, BLANK_LINE] }));
  assert.deepStrictEqual(findingsOf(outcomes.clock).map((f) => f.line), [105]);
  assert.strictEqual(findingsOf(outcomes.clock)[0].evidence, documentLine(105));
});

test("I3a: a comment-only line is NOT nameable, whatever the reply says about it", () => {
  // The model reads the function as written, comments included, so it can name
  // a line that is nothing but a comment saying the code reads a clock. A
  // comment describing a read is not a read, and the prompt saying so is a
  // rule a model can decline. Masking is what enforces it.
  const honestyOutcomes = need("honestyOutcomes");
  const outcomes = honestyOutcomes(maskUnit(), LANG, linesOf({ clock: [COMMENT_LINE] }));
  assert.strictEqual(
    findingsOf(outcomes.clock).length,
    0,
    `a line comment became a clock finding: ${JSON.stringify(maskDocumentLine(COMMENT_LINE))}`,
  );
  assert.deepStrictEqual(outcomes.clock, { state: "clean" });
});

test("I3a: a block-comment-only line is NOT nameable either", () => {
  const honestyOutcomes = need("honestyOutcomes");
  const outcomes = honestyOutcomes(maskUnit(), LANG, linesOf({ env: [BLOCK_COMMENT_LINE] }));
  assert.strictEqual(
    findingsOf(outcomes.env).length,
    0,
    `a block comment became an env finding: ${JSON.stringify(maskDocumentLine(BLOCK_COMMENT_LINE))}`,
  );
});

test("I3b: a line with code before a trailing comment IS nameable, and the evidence is the RAW line", () => {
  // The card quotes what the developer wrote, never the product's internal
  // masked copy, so the trailing comment comes with it.
  const honestyOutcomes = need("honestyOutcomes");
  const outcomes = honestyOutcomes(maskUnit(), LANG, linesOf({ clock: [CODE_THEN_COMMENT_LINE] }));

  assert.strictEqual(outcomes.clock.state, "flagged", "masking discarded a line that still holds code");
  assert.strictEqual(findingsOf(outcomes.clock)[0].line, CODE_THEN_COMMENT_LINE);
  assert.strictEqual(
    findingsOf(outcomes.clock)[0].evidence,
    "const at = readClock(); // trailing note",
    "the evidence is the masked copy rather than the raw line the developer wrote",
  );
});

test("I3b: a line whose only string is masked out still has code left, and quotes its raw text", () => {
  const honestyOutcomes = need("honestyOutcomes");
  const outcomes = honestyOutcomes(maskUnit(), LANG, linesOf({ world: [CODE_WITH_STRING_LINE] }));
  assert.strictEqual(outcomes.world.state, "flagged");
  assert.strictEqual(
    findingsOf(outcomes.world)[0].evidence,
    maskDocumentLine(CODE_WITH_STRING_LINE),
    "the string's contents belong in the evidence, because the evidence is the raw line",
  );
});

test("I3: a comment-only line beside a real one keeps only the real one", () => {
  const honestyOutcomes = need("honestyOutcomes");
  const outcomes = honestyOutcomes(
    maskUnit(),
    LANG,
    linesOf({ clock: [COMMENT_LINE, CODE_THEN_COMMENT_LINE, BLOCK_COMMENT_LINE] }),
  );
  assert.deepStrictEqual(findingsOf(outcomes.clock).map((f) => f.line), [CODE_THEN_COMMENT_LINE]);
});

// ===========================================================================
// I4. A dimension the reply does not mention is `clean`
// ===========================================================================

test("I4: a dimension with no lines is clean, not blind and not flagged", () => {
  const honestyOutcomes = need("honestyOutcomes");
  const outcomes = honestyOutcomes(unit(), LANG, linesOf({ clock: [FIRST_BODY_LINE] }));
  for (const d of ["prng", "env", "world"]) {
    assert.deepStrictEqual(outcomes[d], { state: "clean" }, `${d} was not clean when the reply said nothing about it`);
  }
});

test("I4: honestyOutcomes handed an all-empty record answers four cleans", () => {
  // Post-parse only. A REPLY that mentions nothing is I5's case now, not this
  // one: see the I5/I10 rows below.
  const honestyOutcomes = need("honestyOutcomes");
  const outcomes = honestyOutcomes(unit(), LANG, linesOf({}));
  for (const d of DIMENSIONS) {
    assert.deepStrictEqual(outcomes[d], { state: "clean" });
  }
});

test("I4: readHonestyReply hands back all four keys even when the reply names one", () => {
  const readHonestyReply = need("readHonestyReply");
  const result = readHonestyReply(reply([["clock", [FIRST_BODY_LINE]]]));
  assert.strictEqual(result.ok, true, `a well-formed one-dimension reply was refused: ${JSON.stringify(result)}`);
  assert.deepStrictEqual(Object.keys(result.lines).sort(), DIMENSIONS.slice().sort());
  for (const d of DIMENSIONS) {
    assert.strictEqual(Array.isArray(result.lines[d]), true, `${d} is not an array of line numbers`);
  }
  assert.deepStrictEqual(Array.from(result.lines.clock), [FIRST_BODY_LINE]);
  for (const d of ["prng", "env", "world"]) {
    assert.deepStrictEqual(Array.from(result.lines[d]), []);
  }
});

// ===========================================================================
// I5. A failed round is `blind` on all four, and it says why
// ===========================================================================

/** Every dimension blind, with a reason naming the backend. This is the
 *  assertion the phase exists for: a false `clean` is the defect. */
function assertBlindEverywhere(outcomes, note) {
  assert.deepStrictEqual(Object.keys(outcomes).sort(), DIMENSIONS.slice().sort(), note);
  for (const d of DIMENSIONS) {
    const outcome = outcomes[d];
    assert.strictEqual(
      outcome.state,
      "blind",
      `${note}: ${d} answered ${outcome.state} on a FAILED round. A failed round that reads clean is the false certificate this phase removes.`,
    );
    assert.notStrictEqual(outcome.state, "clean");
    assert.notStrictEqual(outcome.state, "flagged");
    assert.strictEqual(typeof outcome.reason, "string", `${note}: ${d} is blind with no reason`);
    assert.notStrictEqual(outcome.reason.trim(), "", `${note}: ${d} is blind with an empty reason`);
    assert.strictEqual(
      outcome.reason.includes(BACKEND),
      true,
      `${note}: ${d}'s reason does not name the backend '${BACKEND}': ${outcome.reason}`,
    );
  }
}

test("I5: a transport that rejects makes all four blind, naming the backend, and judgeHonesty does not throw", async () => {
  const judgeHonesty = need("judgeHonesty");
  const outcomes = await withDeadline(
    judgeHonesty(async () => { throw new Error("connection refused"); }, unit(), LANG, CONTEXT_EMPTY, BACKEND),
    5000,
    "judgeHonesty on a rejecting transport",
  );
  assertBlindEverywhere(outcomes, "rejected transport");
});

test("I5: a transport that throws SYNCHRONOUSLY is the same failure, not an escaped exception", async () => {
  const judgeHonesty = need("judgeHonesty");
  const outcomes = await withDeadline(
    judgeHonesty(() => { throw new Error("no client configured"); }, unit(), LANG, CONTEXT_EMPTY, BACKEND),
    5000,
    "judgeHonesty on a synchronously throwing transport",
  );
  assertBlindEverywhere(outcomes, "synchronous throw");
});

test("I5: a rejection with a non-Error value is still four blind outcomes", async () => {
  const judgeHonesty = need("judgeHonesty");
  const outcomes = await withDeadline(
    judgeHonesty(async () => { throw "HTTP 503"; }, unit(), LANG, CONTEXT_EMPTY, BACKEND),
    5000,
    "judgeHonesty on a non-Error rejection",
  );
  assertBlindEverywhere(outcomes, "non-Error rejection");
});

test("I5: a reply that cannot be read is four blind outcomes, never four clean ones", async () => {
  // A transport that answers with something that is not a readable reply.
  // `readHonestyReply` is documented total over `unknown`, so this drives the
  // `unreadable` branch without depending on which STRINGS the parser refuses.
  const judgeHonesty = need("judgeHonesty");
  for (const answer of [undefined, null, 42, {}, []]) {
    const outcomes = await withDeadline(
      judgeHonesty(async () => answer, unit(), LANG, CONTEXT_EMPTY, BACKEND),
      5000,
      `judgeHonesty on a transport answering ${JSON.stringify(answer) ?? "undefined"}`,
    );
    assertBlindEverywhere(outcomes, `unreadable reply ${JSON.stringify(answer) ?? "undefined"}`);
  }
});

test("I5: readHonestyReply is total, and refuses junk with a named failure rather than throwing", () => {
  const readHonestyReply = need("readHonestyReply");
  const junk = [undefined, null, 42, 0, true, false, {}, [], new Date(0), () => {}, Symbol.iterator];
  for (const raw of junk) {
    let result;
    assert.doesNotThrow(() => { result = readHonestyReply(raw); }, `readHonestyReply threw on ${String(raw)}`);
    assert.strictEqual(result.ok, false, `readHonestyReply accepted ${String(raw)} as a reply`);
    assert.strictEqual(
      result.failure.kind,
      "unreadable",
      `a non-string raw is 'unreadable', not 'transport': something answered, it just was not text. Got ${JSON.stringify(result.failure)}`,
    );
    assert.strictEqual(typeof result.failure.detail, "string");
    assert.notStrictEqual(result.failure.detail.trim(), "", `${String(raw)} was refused with an empty detail`);
  }
});

test("I5: a failed round is blind on all four even when the fixture would have had findings", async () => {
  // The positive control on the row above: the SAME function, answered
  // properly, does flag. So the blind result is the transport failing, not
  // the fixture being unable to fire.
  const good = await roundFor(reply([["clock", [FIRST_BODY_LINE]]]));
  assert.strictEqual(good.clock.state, "flagged", "the fixture cannot produce a finding, so the I5 rows prove nothing");

  const judgeHonesty = need("judgeHonesty");
  const bad = await withDeadline(
    judgeHonesty(async () => { throw new Error("dead"); }, unit(), LANG, CONTEXT_EMPTY, BACKEND),
    5000,
    "judgeHonesty",
  );
  assertBlindEverywhere(bad, "same fixture, dead transport");
});

// ===========================================================================
// I6. The detail is fixed per dimension
// ===========================================================================

test("I6: HONESTY_DETAIL carries exactly the four dimensions, each a non-empty single line", () => {
  const detail = need("HONESTY_DETAIL");
  assert.deepStrictEqual(Object.keys(detail).sort(), DIMENSIONS.slice().sort());
  for (const d of DIMENSIONS) {
    assert.strictEqual(typeof detail[d], "string");
    assert.notStrictEqual(detail[d].trim(), "", `${d} has an empty detail`);
    assert.strictEqual(detail[d].includes("\n"), false, `${d}'s detail is not one line: ${JSON.stringify(detail[d])}`);
  }
  assert.strictEqual(new Set(Object.values(detail)).size, 4, "two dimensions speak with the same detail");
});

test("I6: every finding's detail is HONESTY_DETAIL's, for all four dimensions", () => {
  const honestyOutcomes = need("honestyOutcomes");
  const detail = need("HONESTY_DETAIL");
  const outcomes = honestyOutcomes(
    unit(),
    LANG,
    linesOf({ clock: [FIRST_BODY_LINE], prng: [105], env: [106], world: [107] }),
  );
  for (const d of DIMENSIONS) {
    assert.strictEqual(findingsOf(outcomes[d]).length, 1, `${d} produced no finding`);
    assert.strictEqual(findingsOf(outcomes[d])[0].detail, detail[d]);
  }
});

test("I6: nothing in a model reply can reword a detail", async () => {
  const detail = need("HONESTY_DETAIL");
  const raw = [
    "clock detail: this function is a filthy clock reader",
    reply([["clock", [FIRST_BODY_LINE]]]),
    "detail = something else entirely",
  ].join("\n");

  const outcomes = await roundFor(raw);
  for (const { dimension, finding } of allFindings(outcomes)) {
    assert.strictEqual(finding.detail, detail[dimension], `${dimension}'s detail came from the reply`);
  }
});

// ===========================================================================
// I7. Findings are ascending by line, at most one per dimension per line
// ===========================================================================

test("I7: findings come back ascending by line however the reply ordered them", () => {
  const honestyOutcomes = need("honestyOutcomes");
  const outcomes = honestyOutcomes(unit(), LANG, linesOf({ clock: [107, FIRST_BODY_LINE, 106, 105] }));
  const lines = findingsOf(outcomes.clock).map((f) => f.line);
  assert.deepStrictEqual(lines, [FIRST_BODY_LINE, 105, 106, 107]);
});

test("I7: a duplicated line number collapses to exactly one finding", () => {
  const honestyOutcomes = need("honestyOutcomes");
  const outcomes = honestyOutcomes(unit(), LANG, linesOf({ clock: [105, 105, 105, FIRST_BODY_LINE, 105] }));
  assert.deepStrictEqual(findingsOf(outcomes.clock).map((f) => f.line), [FIRST_BODY_LINE, 105]);
});

test("I7: ascending and deduplicated holds for every dimension at once", () => {
  const honestyOutcomes = need("honestyOutcomes");
  const shuffled = [107, 105, 107, FIRST_BODY_LINE, 106, 105];
  const outcomes = honestyOutcomes(
    unit(),
    LANG,
    linesOf({ clock: shuffled, prng: shuffled, env: shuffled, world: shuffled }),
  );
  for (const d of DIMENSIONS) {
    const lines = findingsOf(outcomes[d]).map((f) => f.line);
    assert.deepStrictEqual(lines, [FIRST_BODY_LINE, 105, 106, 107], `${d} is not ascending and deduplicated`);
    assert.strictEqual(new Set(lines).size, lines.length);
  }
});

// ===========================================================================
// I8. honestyOutcomes is pure
// ===========================================================================

test("I8: calling honestyOutcomes twice with the same inputs returns equal values", () => {
  const honestyOutcomes = need("honestyOutcomes");
  const lines = linesOf({ clock: [FIRST_BODY_LINE, 105], env: [106], world: [9999, EMPTY_LINE] });
  const first = honestyOutcomes(unit(), LANG, lines);
  const second = honestyOutcomes(unit(), LANG, lines);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(second)), JSON.parse(JSON.stringify(first)));
});

test("I8: honestyOutcomes mutates neither `fn` nor the lines record", () => {
  const honestyOutcomes = need("honestyOutcomes");
  const fn = unit();
  const before = JSON.stringify(fn);
  const lines = linesOf({ clock: [107, 105, 105], prng: [FIRST_BODY_LINE] });
  const linesBefore = JSON.stringify(lines);

  honestyOutcomes(fn, LANG, lines);

  assert.strictEqual(JSON.stringify(fn), before, "honestyOutcomes mutated the FunctionUnderReview it was handed");
  assert.strictEqual(JSON.stringify(lines), linesBefore, "honestyOutcomes mutated the lines record it was handed");
});

test("I8: repeated calls in a row stay stable, so nothing is being accumulated between them", () => {
  const honestyOutcomes = need("honestyOutcomes");
  const lines = linesOf({ clock: [FIRST_BODY_LINE, 105] });
  const runs = [];
  for (let i = 0; i < 5; i++) {
    runs.push(JSON.stringify(honestyOutcomes(unit(), LANG, lines)));
  }
  assert.strictEqual(new Set(runs).size, 1, `honestyOutcomes drifted across five identical calls: ${runs.join(" | ")}`);
});

// ===========================================================================
// I9. The prompt contains no library name table
// ===========================================================================

// Library spellings the 67 regexes held. Reintroducing any of them inside the
// prompt is the same defect wearing a different coat, so the prompt must
// carry none of them.
const BANNED_SPELLINGS = [
  "Instant::now",
  "os.environ",
  "console.log",
  "Directory.GetFiles",
  "thread_rng",
  "Date.now",
  "Math.random",
  "DateTime.UtcNow",
  "DateTime.Now",
  "System.currentTimeMillis",
  "time.Now",
  "os.Getenv",
  "std::env::var",
  "random.random",
  "rand::random",
  "File.ReadAllText",
  "SystemTime::now",
  "process.env",
  "getenv",
  "readFileSync",
];

test("I9: the prompt carries no clock/PRNG/environment/file-read spelling table", () => {
  const buildHonestyPrompt = need("buildHonestyPrompt");
  const prompt = buildHonestyPrompt(unit(), LANG, CONTEXT_CALLEES);
  assert.strictEqual(typeof prompt, "string");

  for (const spelling of BANNED_SPELLINGS) {
    assert.strictEqual(
      prompt.includes(spelling),
      false,
      `the prompt carries the library spelling ${JSON.stringify(spelling)}, which is the name table this phase removes`,
    );
  }
});

test("I9: the prompt does not render the profile's own honesty tables", () => {
  // The strongest form of I9: `LANG.honesty` holds four marker regexes that
  // exist nowhere else. If the implementation renders the profile's tables
  // into the prompt in any form, the markers come with them.
  const buildHonestyPrompt = need("buildHonestyPrompt");
  const prompt = buildHonestyPrompt(unit(), LANG, CONTEXT_EMPTY);
  for (const [dimension, marker] of Object.entries(TABLE_MARKERS)) {
    assert.strictEqual(
      prompt.includes(marker),
      false,
      `the prompt renders lang.honesty.${dimension} into itself; that is the name table, inside the prompt`,
    );
  }
});

test("I9 (control): the prompt is not vacuously clean; it carries the function and the four dimensions", () => {
  const buildHonestyPrompt = need("buildHonestyPrompt");
  const prompt = buildHonestyPrompt(unit(), LANG, CONTEXT_EMPTY);

  assert.ok(prompt.length > 0, "the prompt is empty, so the I9 rows above prove nothing");
  assert.strictEqual(prompt.includes("stamp"), true, "the prompt does not carry the function's name");
  assert.strictEqual(prompt.includes("row.at = at;"), true, "the prompt does not carry the function's body");
  for (const d of DIMENSIONS) {
    assert.strictEqual(prompt.toLowerCase().includes(d), true, `the prompt never names the '${d}' dimension`);
  }
});

test("I9: the callee names and docs are carried when present, and their absence is a shipped state", () => {
  const buildHonestyPrompt = need("buildHonestyPrompt");

  const withCallees = buildHonestyPrompt(unit(), LANG, CONTEXT_CALLEES);
  for (const callee of CONTEXT_CALLEES.callees) {
    assert.strictEqual(withCallees.includes(callee.name), true, `the prompt dropped callee ${callee.name}`);
    assert.strictEqual(withCallees.includes(callee.doc), true, `the prompt dropped callee ${callee.name}'s doc`);
  }

  // Every field of HonestyContext is optional and every absence ships.
  for (const context of [{}, { callees: [] }, { callees: undefined }]) {
    const bare = buildHonestyPrompt(unit(), LANG, context);
    assert.strictEqual(typeof bare, "string");
    assert.ok(bare.length > 0, `an empty context produced an empty prompt: ${JSON.stringify(context)}`);
    assert.strictEqual(bare.includes("undefined"), false, `an absent field leaked as 'undefined': ${JSON.stringify(context)}`);
    assert.strictEqual(bare.includes("[object Object]"), false, `an absent field leaked as '[object Object]'`);
  }
});

test("I9: the prompt is deterministic; the same inputs give the same bytes", () => {
  const buildHonestyPrompt = need("buildHonestyPrompt");
  const runs = new Set();
  for (let i = 0; i < 3; i++) {
    runs.add(buildHonestyPrompt(unit(), LANG, CONTEXT_CALLEES));
  }
  assert.strictEqual(runs.size, 1, "buildHonestyPrompt is not deterministic");
});

// ===========================================================================
// I10. Unknown dimension keys in a reply are ignored
// ===========================================================================

test("I10: unknown keys are ignored when the reply also names at least one of the four", async () => {
  const raw = reply([
    ["sql", [FIRST_BODY_LINE]],
    ["clock", [105]],
    ["network", [106]],
  ]);
  const outcomes = await roundFor(raw);

  assert.deepStrictEqual(Object.keys(outcomes).sort(), DIMENSIONS.slice().sort(), "an unknown key became a fifth dimension");
  assert.strictEqual(outcomes.clock.state, "flagged");
  assert.deepStrictEqual(findingsOf(outcomes.clock).map((f) => f.line), [105]);
  for (const d of ["prng", "env", "world"]) {
    assert.deepStrictEqual(outcomes[d], { state: "clean" }, `${d} was decided by an unknown key`);
  }
});

// A reply that names none of the four. The tie between I4, I5 and I10 is
// broken toward I5 deliberately: a reply the product could not read is not
// evidence that a function is honest, and calling it four cleans is precisely
// the false certificate the 67 name-table regexes gave for a whole release.
const NAMES_NOTHING = [
  { what: "only unknown keys", raw: () => reply([["sql", [FIRST_BODY_LINE]], ["network", [105]]]) },
  { what: "the empty answer", raw: () => "" },
  { what: "a whitespace-only answer", raw: () => "   \n  \t " },
  { what: "prose saying nothing fired", raw: () => "no dimensions fired" },
  { what: "a refusal sentence", raw: () => "I cannot analyse this function." },
];

for (const { what, raw } of NAMES_NOTHING) {
  test(`I10/I5: a reply naming none of the four (${what}) is unreadable, so the round is four blind`, async () => {
    const outcomes = await roundFor(raw());
    assertBlindEverywhere(outcomes, `reply naming none of the four: ${what}`);
  });

  test(`I10/I5: readHonestyReply refuses a reply naming none of the four (${what}) as 'unreadable'`, () => {
    const readHonestyReply = need("readHonestyReply");
    const result = readHonestyReply(raw());
    assert.strictEqual(
      result.ok,
      false,
      `${what} was read as a reply and would decide four rows: ${JSON.stringify(result)}`,
    );
    assert.strictEqual(result.failure.kind, "unreadable");
    assert.notStrictEqual(result.failure.detail.trim(), "");
  });
}

test("I10: an unknown key in the lines record does not become a fifth outcome", () => {
  const honestyOutcomes = need("honestyOutcomes");
  const outcomes = honestyOutcomes(unit(), LANG, {
    ...linesOf({ clock: [FIRST_BODY_LINE] }),
    sql: [105],
    network: [106],
  });
  assert.deepStrictEqual(Object.keys(outcomes).sort(), DIMENSIONS.slice().sort());
  assert.deepStrictEqual(findingsOf(outcomes.clock).map((f) => f.line), [FIRST_BODY_LINE]);
});

// ===========================================================================
// I11. The module never imports vscode
// ===========================================================================

test("I11: nothing in the module's bundle reaches for vscode", () => {
  if (loadError) {
    throw new Error(
      `src/core/criticizeHonestyModel does not exist yet (or does not bundle): ${loadError.message}`,
    );
  }
  // esbuild bundling the module for node would already have failed to resolve
  // a bare `vscode` import; this reads the emitted bundle so a dynamic or
  // externalised reach shows up too. The bundle is a build artifact, not the
  // source, so blind-oracle discipline holds.
  const bundled = fs.readFileSync(BUNDLE_PATH, "utf8");
  const hits = bundled.match(/["']vscode["']/g) || [];
  assert.deepStrictEqual(hits, [], "the bundled module references the vscode module, which src/core may not do");
});

// ===========================================================================
// I12. Cancellation propagates
// ===========================================================================

// I12 IS THE OPPOSITE OF `explainFinding`, WHICH RETHROWS A CANCELLATION, and
// the contract now states the inversion rather than leaving two contracts
// silently opposite. The explain round is enrichment and a cancelled press may
// abandon it. This round DECIDES four of the fourteen rows, so a cancelled press
// still has to render them, and the only honest thing to render is a refusal.
// That is what these rows assert: four rows come back, all of them refusals.
for (const name of ["Canceled", "CancellationError", "AbortError"]) {
  test(`I12: a transport rejecting with a '${name}' cancellation reaches the caller as four blind outcomes`, async () => {
    const judgeHonesty = need("judgeHonesty");
    const err = new Error("user cancelled");
    err.name = name;

    const outcomes = await withDeadline(
      judgeHonesty(async () => { throw err; }, unit(), LANG, CONTEXT_EMPTY, BACKEND),
      5000,
      `judgeHonesty on a '${name}' cancellation`,
    );
    assertBlindEverywhere(outcomes, `${name} cancellation`);
  });
}

test("I12: a transport that rejects after a tick still settles, and does not hang", async () => {
  const judgeHonesty = need("judgeHonesty");
  const err = new Error("cancelled mid-flight");
  err.name = "Canceled";

  const outcomes = await withDeadline(
    judgeHonesty(
      () => new Promise((_, reject) => setTimeout(() => reject(err), 20)),
      unit(),
      LANG,
      CONTEXT_EMPTY,
      BACKEND,
    ),
    5000,
    "judgeHonesty on a delayed cancellation",
  );
  assertBlindEverywhere(outcomes, "delayed cancellation");
});

test("I12: a cancellation is not rethrown out of judgeHonesty; the contract says it never throws", async () => {
  const judgeHonesty = need("judgeHonesty");
  const err = new Error("user cancelled");
  err.name = "Canceled";

  await assert.doesNotReject(
    () => withDeadline(
      judgeHonesty(async () => { throw err; }, unit(), LANG, CONTEXT_EMPTY, BACKEND),
      5000,
      "judgeHonesty",
    ),
    "judgeHonesty rethrew a cancellation; I5 says it never throws and I12 says the caller sees a blind outcome",
  );
});
