// BLIND ORACLE - session-v52 phase 4: THE FLAGS.
//
// Bound to `session-v52/contract-p4.md`, written before `src/core/tightenFlags.ts`
// exists. Nothing in this file has read `src/**`, and nothing here has read
// `session-v52/spikes/detector.cjs` - that is the implementation this file grades,
// and reading it would fit the oracle to the code instead of to the contract.
// The only sources are the contract, the fixture constants in
// `session-v52/spikes/validate-detector.cjs`, and the doc comment quoted in
// `docs/dumb-models-work.md`.
//
// THE ORACLES ARE COMPUTED HERE. Every synthetic row recomputes containment in
// this file from the contract's own words - "content tokens: lowercase
// [a-z0-9_]+, length 3 or more" and "shared token count over min(|A|, |B|)" -
// and the module's `worst` is cross-checked against that number rather than
// against itself. The synthetic rows deliberately use invented tokens
// (`zorbex`, `qq07`) so that the spike's stop list, which the contract does not
// print, cannot change the arithmetic.
//
// Expected RED until phase 4 lands.
//
// Run: SKIP_LIVE=1 npx node --test test/blind-v52-p4-flags.test.cjs

const test = require("node:test");
const assert = require("node:assert/strict");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "blind-v52-p4",
  `export { findRestatements, findUndefinedTerms, RESTATEMENT_THRESHOLD, RESTATEMENT_MIN_TOKENS } from "../src/core/tightenFlags";\n`
);
const {
  findRestatements,
  findUndefinedTerms,
  RESTATEMENT_THRESHOLD,
  RESTATEMENT_MIN_TOKENS,
} = mod;
test.after(cleanup);

// ---------------------------------------------------------------------------
// Independent oracles. The contract's stated rules, recomputed here.
// ---------------------------------------------------------------------------

// Contract "Mechanics": content tokens are lowercase `[a-z0-9_]+`, length 3 or
// more, minus the stop list. The stop list is the spike's and the contract does
// not print it, so this oracle omits it and is used ONLY on the synthetic rows,
// whose tokens are invented words no stop list can hold.
function contentTokens(s) {
  const out = new Set();
  for (const m of String(s).toLowerCase().match(/[a-z0-9_]+/g) || []) {
    if (m.length >= 3) out.add(m);
  }
  return out;
}

// Contract: "Containment of A against B is the shared token count over
// min(|A|, |B|)."
function containmentOf(a, b) {
  const A = contentTokens(a);
  const B = contentTokens(b);
  if (A.size === 0 || B.size === 0) return 0;
  let shared = 0;
  for (const t of A) if (B.has(t)) shared += 1;
  return shared / Math.min(A.size, B.size);
}

const round2 = (x) => Math.round(x * 100) / 100;

function closeTo(actual, expected, tol, what) {
  assert.equal(typeof actual, "number", `${what}: expected a number`);
  assert.ok(
    Math.abs(actual - expected) <= tol,
    `${what}: expected ~${expected}, got ${actual}`
  );
}

// Contract "RestatementReport" shape, plus ship condition 3: every span is a
// verbatim slice of the input at the offsets reported.
function assertReportShape(report, prose, what) {
  assert.ok(report && typeof report === "object", `${what}: no report`);
  assert.equal(typeof report.units, "number", `${what}: units`);
  assert.ok(Number.isInteger(report.units) && report.units >= 0, `${what}: units integer`);
  assert.equal(typeof report.worst, "number", `${what}: worst`);
  assert.ok(report.worst >= 0 && report.worst <= 1, `${what}: worst in 0..1`);
  assert.ok(Array.isArray(report.pairs), `${what}: pairs array`);
  for (const p of report.pairs) {
    assert.ok(["sentence", "paragraph"].includes(p.grain), `${what}: grain ${p.grain}`);
    assert.ok(p.containment >= 0 && p.containment <= 1, `${what}: containment range`);
    for (const side of ["a", "b"]) {
      const s = p[side];
      assert.equal(typeof s.text, "string", `${what}: ${side}.text`);
      assert.ok(Number.isInteger(s.start) && Number.isInteger(s.end), `${what}: ${side} offsets`);
      assert.ok(s.start >= 0 && s.end <= prose.length && s.start < s.end, `${what}: ${side} bounds`);
      assert.equal(
        prose.slice(s.start, s.end),
        s.text,
        `${what}: ${side} span is not a verbatim slice of the input`
      );
    }
    assert.notEqual(p.a.start, p.b.start, `${what}: a pair of one span`);
  }
}

// ---------------------------------------------------------------------------
// The fixtures. Copied verbatim from `session-v52/spikes/validate-detector.cjs`
// per the contract: "Do not paraphrase these. Copy them."
// ---------------------------------------------------------------------------

const ROUND2 = `
Enforce SUMMARY_PAYLOAD_MAX_BYTES (already u64) by dropping per-aggregate
client sets to ClientSet::Unknown, largest saving first, until the payload
fits. Returns how many were dropped; 0 when already under the cap.

Largest-first is policy, not tuning: every drop costs one aggregate its
negative-lookup skip regardless of the set's size, so the goal is to shed the
fewest sets per byte freed. Plain aggregates order would be worse than
arbitrary: the vec is sorted by (org_id, aggregate_type_id, aggregate_id)
and binary-searched by the read path, so the lowest org id would absorb every
seal's degradation, forever.

Entries are never dropped: listing correctness and segment skipping must not
degrade. Unknown answers maybe-present, so a drop costs a scan and never a
false absent, and if dropping every set still exceeds the cap, return anyway.

wire_size() is O(n): call it ONCE, then subtract each dropped set's saving,
client_set.wire_size() - ClientSet::Unknown.wire_size(), since the entry keeps
paying for the discriminant, from a running total. Skip sets already Unknown:
they save nothing and must not count toward the return value. Re-checking
wire_size() per drop is O(n^2) and stalls the executor.
`.trim();

const ROUND5_DUPLICATED = ROUND2 + `

wire_size() is O(n), so call it once and subtract each entry's known saving
from a running total instead of re-checking it. Skip any set that is already
Unknown. Re-checking wire_size() on every drop is quadratic and stalls the
executor.
`;

const ROUND5_EXACT = ROUND2 + '\n\n' + ROUND2.split('\n\n')[3];

// Contract "The fixtures": round 4's spec is "round 2's first three paragraphs
// plus the fourth paragraph as ROUND5_DUPLICATED appends it". Built from the
// spike's own constants so it cannot drift away from them.
const ROUND2_PARAGRAPHS = ROUND2.split("\n\n");
const ROUND4_FOURTH = ROUND5_DUPLICATED.slice(ROUND2.length);
const ROUND4 = ROUND2_PARAGRAPHS.slice(0, 3).join("\n\n") + ROUND4_FOURTH;

// Guards on the fixtures themselves, so a drifted spike fails loudly here
// rather than quietly changing what the rows below mean.
test("fixture guard: the copied spike constants have the shape the contract describes", () => {
  assert.equal(ROUND2_PARAGRAPHS.length, 4, "round 2 is a four-paragraph spec");
  assert.ok(ROUND5_DUPLICATED.startsWith(ROUND2), "round 5 duplicated is round 2 plus a paragraph");
  assert.ok(ROUND5_EXACT.startsWith(ROUND2), "the paste is round 2 plus a copy of paragraph 4");
  // Round 2 defines the saving; round 4 does not. That difference is the whole
  // of ship condition 2.
  assert.ok(
    ROUND2.includes("client_set.wire_size() - ClientSet::Unknown.wire_size()"),
    "round 2 defines saving inline"
  );
  assert.ok(
    !ROUND4.includes("client_set.wire_size() - ClientSet::Unknown.wire_size()"),
    "round 4 never defines saving"
  );
  assert.ok(ROUND4.includes("subtract each entry's known saving"), "round 4 has the ambiguous clause");
});

// ---------------------------------------------------------------------------
// Contract "Restatement": the exported constants.
// ---------------------------------------------------------------------------

test("the constants are the contract's numbers", () => {
  assert.equal(RESTATEMENT_THRESHOLD, 0.7);
  assert.equal(RESTATEMENT_MIN_TOKENS, 5);
});

// ---------------------------------------------------------------------------
// SHIP CONDITION 1: the three validation cases, driven through findRestatements.
// "round 2 clean does not fire, round 5's restated paragraph fires at roughly
// 0.79, the verbatim paste fires at 1.00."
// ---------------------------------------------------------------------------

test("ship condition 1a: round 2, sharpened and clean, does NOT fire", () => {
  const r = findRestatements(ROUND2);
  assertReportShape(r, ROUND2, "round 2");
  assert.equal(r.pairs.length, 0, "a clean spec must raise no restatement flag");
  assert.ok(
    r.worst < RESTATEMENT_THRESHOLD,
    `round 2's worst pair must sit under threshold, got ${r.worst}`
  );
  assert.ok(r.units > 0, "round 2 has units to compare; 0 would mean the instrument is dark");
});

test("ship condition 1b: round 5's paragraph restated in new words FIRES, at roughly 0.79", () => {
  const r = findRestatements(ROUND5_DUPLICATED);
  assertReportShape(r, ROUND5_DUPLICATED, "round 5 duplicated");
  assert.ok(r.pairs.length > 0, "the restated paragraph must fire");
  assert.ok(
    r.pairs.some((p) => p.grain === "paragraph"),
    "the restatement is a paragraph-grain finding; a sentence-only hit misses the shape"
  );
  assert.ok(
    r.worst >= RESTATEMENT_THRESHOLD,
    `worst must reach threshold, got ${r.worst}`
  );
  // The contract says "roughly 0.79" and refuses to fix the digit here, so this
  // row pins a band around it rather than an invented exact value.
  assert.ok(
    r.worst >= 0.7 && r.worst <= 0.9,
    `worst should be roughly 0.79, got ${r.worst}`
  );
});

test("ship condition 1c: the verbatim paste FIRES at containment 1.00", () => {
  const r = findRestatements(ROUND5_EXACT);
  assertReportShape(r, ROUND5_EXACT, "verbatim paste");
  assert.ok(r.pairs.length > 0, "a pasted duplicate paragraph must fire");
  closeTo(r.worst, 1, 0.001, "verbatim paste worst");
  assert.ok(
    r.pairs.some((p) => p.grain === "paragraph" && Math.abs(p.containment - 1) <= 0.001),
    "the paragraph pair itself must report 1.00"
  );
});

// ---------------------------------------------------------------------------
// SHIP CONDITION 3, on the real fixtures: neither function writes a word.
// ---------------------------------------------------------------------------

test("ship condition 3: every restatement span is verbatim and its offsets index the input", () => {
  for (const [label, prose] of [
    ["round 2", ROUND2],
    ["round 4", ROUND4],
    ["round 5 duplicated", ROUND5_DUPLICATED],
    ["verbatim paste", ROUND5_EXACT],
  ]) {
    const r = findRestatements(prose);
    // assertReportShape does the slice-equals-text check on every span.
    assertReportShape(r, prose, label);
  }
});

// ---------------------------------------------------------------------------
// Contract "Mechanics": "Both grains run: a paragraph restated across several
// sentences leaves every individual sentence pair under threshold."
// ---------------------------------------------------------------------------

// Two paragraphs holding the same eighteen invented tokens, redistributed so
// that no sentence pair shares more than 2 of 6 (0.33) while the paragraph pair
// shares all eighteen (1.00).
const A_SENTENCES = [
  "zorbex quillam frobnat marlop tindle harkos.",
  "welkin dratho spilner glenov kirtal muzzek.",
  "napthor vernic quolba tressin hobrat yannic.",
];
const B_SENTENCES = [
  "zorbex welkin napthor quillam dratho vernic.",
  "frobnat spilner quolba marlop glenov tressin.",
  "tindle kirtal hobrat harkos muzzek yannic.",
];
const PARAGRAPH_GRAIN_ONLY = A_SENTENCES.join("\n") + "\n\n" + B_SENTENCES.join("\n");

test("paragraph grain: a restatement spread across sentences fires only at the paragraph", () => {
  // Oracle first: no sentence pair may reach threshold, the paragraph pair must.
  let worstSentence = 0;
  for (const a of A_SENTENCES) {
    for (const b of B_SENTENCES) worstSentence = Math.max(worstSentence, containmentOf(a, b));
  }
  assert.ok(
    worstSentence < RESTATEMENT_THRESHOLD,
    `oracle: the fixture's sentence pairs must stay under threshold, computed ${worstSentence}`
  );
  const paragraphContainment = containmentOf(A_SENTENCES.join(" "), B_SENTENCES.join(" "));
  closeTo(paragraphContainment, 1, 1e-9, "oracle: paragraph containment");

  const r = findRestatements(PARAGRAPH_GRAIN_ONLY);
  assertReportShape(r, PARAGRAPH_GRAIN_ONLY, "paragraph grain fixture");
  assert.ok(r.pairs.length > 0, "the paragraph restatement must fire");
  assert.ok(
    r.pairs.some((p) => p.grain === "paragraph"),
    "paragraph grain must run, or this shape is invisible"
  );
  assert.ok(
    !r.pairs.some((p) => p.grain === "sentence"),
    "no sentence pair reaches 0.7 here; a sentence hit means the sentence maths is wrong"
  );
  closeTo(r.worst, 1, 0.006, "paragraph grain fixture worst");
});

const SENTENCE_GRAIN = [
  "zorbex quillam frobnat marlop tindle harkos.",
  "zorbex quillam frobnat marlop tindle vantar.",
].join("\n");

test("sentence grain: a near-identical pair inside one paragraph fires", () => {
  const expected = containmentOf(
    "zorbex quillam frobnat marlop tindle harkos.",
    "zorbex quillam frobnat marlop tindle vantar."
  );
  closeTo(expected, 5 / 6, 1e-9, "oracle: sentence containment");

  const r = findRestatements(SENTENCE_GRAIN);
  assertReportShape(r, SENTENCE_GRAIN, "sentence grain fixture");
  assert.ok(
    r.pairs.some((p) => p.grain === "sentence"),
    "two near-identical sentences in one paragraph must fire at sentence grain"
  );
  const hit = r.pairs.find((p) => p.grain === "sentence");
  closeTo(hit.containment, round2(5 / 6), 0.006, "sentence pair containment");
  closeTo(r.worst, round2(5 / 6), 0.006, "sentence grain fixture worst");
});

// ---------------------------------------------------------------------------
// Contract: containment threshold of 0.7. Built from invented tokens so the
// arithmetic here is exact and independent of the spike's stop list.
// ---------------------------------------------------------------------------

const qq = (n) => `qq${String(n).padStart(2, "0")}`;
const seq = (from, to) => {
  const out = [];
  for (let i = from; i <= to; i += 1) out.push(qq(i));
  return out;
};

function twoParagraphs(aTokens, bTokens) {
  return `${aTokens.join(" ")}.\n\n${bTokens.join(" ")}.`;
}

// 20 tokens each side. 13 shared = 0.65, one notch under. 15 shared = 0.75, one
// notch over. 0.70 exactly is skipped on purpose: the contract does not say
// whether the comparison is `>=` or `>`.
const JUST_UNDER = twoParagraphs(seq(1, 20), seq(1, 13).concat(seq(21, 27)));
const JUST_OVER = twoParagraphs(seq(1, 20), seq(1, 15).concat(seq(21, 25)));

test("threshold: a pair just under 0.7 does not fire, and worst still reports it", () => {
  const oracle = containmentOf(seq(1, 20).join(" "), seq(1, 13).concat(seq(21, 27)).join(" "));
  closeTo(oracle, 0.65, 1e-9, "oracle: just-under containment");
  assert.ok(oracle < RESTATEMENT_THRESHOLD, "oracle: 0.65 is under threshold");

  const r = findRestatements(JUST_UNDER);
  assertReportShape(r, JUST_UNDER, "just under");
  assert.equal(r.pairs.length, 0, "0.65 must not fire");
  // "The worst pair's containment, whether or not it fired."
  closeTo(r.worst, 0.65, 0.006, "just-under worst");
});

test("threshold: a pair just over 0.7 fires", () => {
  const oracle = containmentOf(seq(1, 20).join(" "), seq(1, 15).concat(seq(21, 25)).join(" "));
  closeTo(oracle, 0.75, 1e-9, "oracle: just-over containment");

  const r = findRestatements(JUST_OVER);
  assertReportShape(r, JUST_OVER, "just over");
  assert.ok(r.pairs.length > 0, "0.75 must fire");
  closeTo(r.worst, 0.75, 0.006, "just-over worst");
  for (const p of r.pairs) closeTo(p.containment, 0.75, 0.006, "just-over pair containment");
});

// ---------------------------------------------------------------------------
// Contract: "Units with fewer than RESTATEMENT_MIN_TOKENS content tokens are not
// compared."
// ---------------------------------------------------------------------------

test("min tokens: two identical short units below the floor are not compared and do not fire", () => {
  const short = seq(1, RESTATEMENT_MIN_TOKENS - 1).join(" ");
  const prose = `${short}.\n\n${short}.`;
  // Identical text, so containment is 1.00 - only the floor can hold it back.
  closeTo(containmentOf(short, short), 1, 1e-9, "oracle: identical short units");

  const r = findRestatements(prose);
  assertReportShape(r, prose, "below min tokens");
  assert.equal(r.pairs.length, 0, "a unit under the token floor must not be compared");
  assert.equal(r.units, 0, "no unit survives the min-token filter, so none was compared");
  assert.ok(r.worst < RESTATEMENT_THRESHOLD, `worst must not report an uncompared pair, got ${r.worst}`);
});

test("min tokens: the same shape AT the floor does fire, so the floor is the reason", () => {
  const atFloor = seq(1, RESTATEMENT_MIN_TOKENS).join(" ");
  const prose = `${atFloor}.\n\n${atFloor}.`;
  const r = findRestatements(prose);
  assertReportShape(r, prose, "at min tokens");
  assert.ok(r.pairs.length > 0, "'fewer than' means the floor itself is compared");
  closeTo(r.worst, 1, 0.006, "at-floor worst");
});

// ---------------------------------------------------------------------------
// SHIP CONDITION 2 and the undefined-term rule.
// ---------------------------------------------------------------------------

// The names the anchor tiers would have resolved for this function, taken from
// the real code printed in `docs/dumb-models-work.md`. Domain nouns only where
// the code actually spells them.
const RESOLVED = [
  "SegmentSummaryPayload",
  "SegmentAggregateEntry",
  "AggregateTypeKey",
  "ClientSet",
  "Unknown",
  "Exact",
  "Bloom",
  "trim_out_client_sets",
  "wire_size",
  "client_set",
  "aggregates",
  "aggregate_types",
  "orgs",
  "org_id",
  "aggregate_type_id",
  "aggregate_id",
  "complete",
  "aggregate_bloom",
  "client_bloom",
  "schema_bloom",
  "SUMMARY_PAYLOAD_MAX_BYTES",
  "SCHEMA_BLOOM_MAX_BYTES",
  "WIRE_SIZE_FIXED",
  "from_client_hashes",
];

// The contract's example of a language stop set: "so `result` in Rust is not a
// mystery noun". Language-level nouns only - stuffing domain words in here
// would make the round-2 row pass for the wrong reason.
const RUST_STOP_NAMES = new Set([
  "result",
  "self",
  "value",
  "values",
  "len",
  "size",
  "type",
  "data",
  "index",
  "item",
  "items",
  "new",
  "string",
  "vec",
  "option",
  "error",
  "err",
  "ok",
  "none",
  "some",
]);

function terms(prose, resolved = [], stopNames = undefined) {
  const input = stopNames ? { prose, resolved, stopNames } : { prose, resolved };
  const out = findUndefinedTerms(input);
  assert.ok(Array.isArray(out), "findUndefinedTerms returns an array");
  for (const t of out) {
    assert.equal(typeof t.term, "string");
    assert.ok(/^[a-z][a-z0-9_]*$/.test(t.term), `term must be a bare lowercase word, got ${t.term}`);
    assert.equal(typeof t.sentence, "string");
    assert.ok(Number.isInteger(t.uses) && t.uses >= 1, "uses is a positive count");
    // Ship condition 3: verbatim, offsets index the input. The contract does
    // not say whether start/end delimit the sentence or the term, so either
    // reading is accepted - what is pinned is that the slice is not invented.
    assert.ok(Number.isInteger(t.start) && Number.isInteger(t.end), "offsets are integers");
    assert.ok(t.start >= 0 && t.end <= prose.length && t.start < t.end, "offsets in range");
    const slice = prose.slice(t.start, t.end);
    assert.ok(
      slice === t.sentence || slice === t.term,
      `slice(${t.start}, ${t.end}) = ${JSON.stringify(slice)} is neither the reported sentence nor the term`
    );
    assert.ok(prose.includes(t.sentence), "the reported sentence is verbatim from the prose");
    assert.ok(
      t.sentence.toLowerCase().includes(t.term),
      "the reported term appears in the reported sentence"
    );
  }
  return out;
}

const has = (list, term) => list.some((t) => t.term === term);

test("ship condition 2a: round 4's spec FIRES on the undefined saving", () => {
  const found = terms(ROUND4, RESOLVED, RUST_STOP_NAMES);
  assert.ok(
    has(found, "saving"),
    `round 4 never defines a saving and must be flagged; got [${found.map((t) => t.term).join(", ")}]`
  );
});

test("ship condition 2b: round 2 does not fire on saving, because round 2 defines it", () => {
  const found = terms(ROUND2, RESOLVED, RUST_STOP_NAMES);
  assert.ok(
    !has(found, "saving"),
    "round 2 defines saving inline as client_set.wire_size() - ClientSet::Unknown.wire_size()"
  );
});

test("ship condition 2b, strict: round 2 raises no undefined-term flag at all", () => {
  const found = terms(ROUND2, RESOLVED, RUST_STOP_NAMES);
  assert.equal(
    found.length,
    0,
    `"the flag fires on round 4's spec and not on round 2's"; got [${found.map((t) => t.term).join(", ")}]`
  );
});

// The minimal instruction sentence round 4's failure came from, used as the
// control for every narrowness row below.
const BASE = "Subtract each entry's known saving from a running total.";

test("narrowness control: the bare instruction sentence does fire on saving", () => {
  assert.ok(has(terms(BASE, []), "saving"), "the control must fire, or every row below is vacuous");
});

test("narrowness: a term in resolved does not fire", () => {
  assert.ok(!has(terms(BASE, ["saving"]), "saving"));
});

test("the fold: a spoken lowercase term matches a PascalCase resolved name", () => {
  assert.ok(
    !has(terms(BASE, ["Saving"]), "saving"),
    "matching is under the fold, so Saving in the code defines saving in the prose"
  );
});

test("narrowness: a term in stopNames does not fire", () => {
  assert.ok(!has(terms(BASE, [], new Set(["saving"])), "saving"));
});

test("narrowness: a backticked span does not fire", () => {
  const prose = "Subtract each entry's known `saving` from a running total.";
  assert.ok(
    !has(terms(prose, []), "saving"),
    "a name in code style is phase 3's problem, not this flag's"
  );
});

test("narrowness: a definition in the comment suppresses the flag", () => {
  const definitions = [
    ["is", "The saving is the set's width minus the unknown width."],
    ["means", "A saving means the set's width minus the unknown width."],
    ["equals", "The saving equals the set's width minus the unknown width."],
    ["defined as", "Saving defined as the set's width minus the unknown width."],
    ["colon", "saving: the set's width minus the unknown width."],
  ];
  for (const [label, definition] of definitions) {
    const prose = `${BASE}\n\n${definition}`;
    assert.ok(!has(terms(prose, []), "saving"), `"${label}" defines the term, so no flag`);
  }
});

test("narrowness: a term used only outside an instruction sentence does not fire", () => {
  const prose = "Historically the saving was smaller than the discriminant.";
  assert.ok(
    !has(terms(prose, []), "saving"),
    "no imperative and no modal, so the sentence is not an instruction"
  );
});

// The human's original doc comment, quoted verbatim in `docs/dumb-models-work.md`
// under "Round 1". Ordinary English prose about the same function.
const ORDINARY_DOC_COMMENT = [
  "If the wire size of this segment summary payload is greater than the maximum payload allowed,",
  "then trim out all of the client sets until we get under the max payload limit.",
  "Each client set that gets trimmed gets set to unknown.",
].join("\n");

test("narrowness: ordinary English in a real doc comment barely fires", () => {
  const found = terms(ORDINARY_DOC_COMMENT, RESOLVED, RUST_STOP_NAMES);
  assert.ok(
    found.length <= 2,
    `"a flag that fires on ordinary English is a flag a developer learns to ignore"; got [${found
      .map((t) => t.term)
      .join(", ")}]`
  );
});

test("the uses count is the number of times the comment uses the term", () => {
  const prose = "Subtract each entry's known saving from a running total. Never let a saving go negative.";
  const found = terms(prose, []);
  const saving = found.find((t) => t.term === "saving");
  assert.ok(saving, "the control term must be present");
  assert.equal(saving.uses, 2, "the prose uses saving twice");
});

// ---------------------------------------------------------------------------
// SHIP CONDITION 4: neither throws.
// ---------------------------------------------------------------------------

const BIG_PASTE = (() => {
  const copies = Math.ceil((100 * 1024) / (ROUND2.length + 2));
  return new Array(copies).fill(ROUND2).join("\n\n");
})();

test("findRestatements never throws: empty, one word, whitespace, a 100KB paste", () => {
  assert.ok(BIG_PASTE.length >= 100 * 1024, "the paste really is 100KB");
  for (const [label, prose] of [
    ["empty", ""],
    ["one word", "saving"],
    ["whitespace only", "   \n\t \n\n  "],
    ["100KB paste", BIG_PASTE],
  ]) {
    let r;
    assert.doesNotThrow(() => {
      r = findRestatements(prose);
    }, `findRestatements threw on ${label}`);
    assertReportShape(r, prose, label);
  }
});

test("findRestatements never throws on null or undefined", () => {
  assert.doesNotThrow(() => findRestatements(null));
  assert.doesNotThrow(() => findRestatements(undefined));
});

test("findUndefinedTerms never throws: empty, one word, whitespace, a 100KB paste", () => {
  for (const [label, prose] of [
    ["empty", ""],
    ["one word", "saving"],
    ["whitespace only", "   \n\t \n\n  "],
    ["100KB paste", BIG_PASTE],
  ]) {
    assert.doesNotThrow(() => {
      const out = findUndefinedTerms({ prose, resolved: [] });
      assert.ok(Array.isArray(out), `${label}: expected an array`);
    }, `findUndefinedTerms threw on ${label}`);
  }
});

test("findUndefinedTerms never throws on a missing, empty or absent resolved list", () => {
  assert.doesNotThrow(() => {
    const out = findUndefinedTerms({ prose: BASE, resolved: [] });
    assert.ok(Array.isArray(out));
  }, "empty resolved");
  assert.doesNotThrow(() => {
    const out = findUndefinedTerms({ prose: BASE });
    assert.ok(Array.isArray(out));
  }, "absent resolved");
  assert.doesNotThrow(() => findUndefinedTerms(null), "null input");
  assert.doesNotThrow(() => findUndefinedTerms(undefined), "undefined input");
  assert.doesNotThrow(() => findUndefinedTerms({}), "empty input object");
  assert.doesNotThrow(() => findUndefinedTerms({ prose: null, resolved: null }), "null members");
});

// The 100KB paste is nothing but repeated identical paragraphs, so it is also
// the loudest possible restatement case: the spans must still be verbatim.
test("the 100KB paste still reports verbatim spans", () => {
  const r = findRestatements(BIG_PASTE);
  assertReportShape(r, BIG_PASTE, "100KB paste");
  assert.ok(r.pairs.length > 0, "a paste of the same paragraph 80 times must fire");
  closeTo(r.worst, 1, 0.001, "100KB paste worst");
});
