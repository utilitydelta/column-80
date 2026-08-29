// BLIND ORACLE - session-v62 phase 1: the voice.
//
// Bound ONLY to session-v62/contracts/phase1-voice.md, THROUGH AMENDMENT 4,
// and the RULED voice section of session-v62/goal.md. Later amendments win:
// Amendment 3 clause 1 repeals Amendment 1 clause 1 (the tag keeps its space),
// and Amendment 4 repeals Amendment 2 in full (there is no short form, so
// nothing here tests one). `src/core/criticizeVoice.ts` was never opened while
// this file was written, and did not have to exist. Where the contract states
// a behaviour this file asserts that exact behaviour; where the contract is
// silent it asserts nothing, and the silence is reported back as a finding
// about the contract rather than guessed at here.
//
// AMENDMENT 3 CLAUSE 2 IS THE LOAD-BEARING ONE FOR THIS FILE. Voice rules 2, 3
// and 4 police only the text the MODULE authors. The detector's detail passes
// through verbatim and is exempt, because rules 3, 4 and Amendment 1 clause 7
// are not jointly satisfiable on real code: `Splice(string? first, string?
// second)` is everyday C#, the detector puts `string?` in the detail, and a
// question mark reaches the comment legitimately. Every rule-2/3/4 row below
// strips the detail before it asserts, and `authoredOnly` is where that
// happens.
//
// The one type file this oracle read is `src/core/criticizeTypes.ts`, and only
// for the shape of `DetectorFinding` and the fourteen members of `DimensionId`,
// so the inputs below are well formed.
//
// Four families of row:
//
//   RULES     - the five voice rules walked across ALL FIFTEEN dimensions and
//               across every blast-radius state, not spot-checked on three.
//               The banned-word list and the four-digit-year ban are the sharp
//               ones: a citation or a "you might consider" is the failure the
//               human ruled out by name.
//   SHAPE     - three beats, the order never inverts, the fix is last. A
//               phrase that ends on the complaint has no order in it.
//   SPECIFICS - the finding's own detail reaches the comment. A comment that
//               could apply to any function is not criticism, so two findings
//               that differ must produce comments that differ.
//   BLAST     - the three-way distinction. A number renders, undefined renders
//               no call-site clause at all, and 0 is a MEASURED zero that may
//               not share a spelling with the unmeasured one.
//
// Then `wrapComment`, which is the only thing here that touches layout.
//
// The module is bundled with esbuild. That bundle is itself the check that the
// module is pure and headless: an `import "vscode"` cannot resolve outside the
// extension host and the bundle would fail here.
//
// Run: node --test test/blind-v62-p1-voice.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { bundleCore } = require("./.blind-util.cjs");

// ===========================================================================
// Loading, and failing cleanly when the module is not there yet
// ===========================================================================

// Red-before-green: on the first run of this file the module does not exist,
// esbuild cannot resolve it, and the load throws. Catching it here turns that
// into one clean failure per test with a sentence saying why, instead of one
// unreadable crash that hides how many rows this oracle carries.
let voiceModule = null;
let cleanup = () => {};
let loadError = null;
try {
  const loaded = bundleCore(
    "blind-v62-p1",
    `import * as criticizeVoice from "../src/core/criticizeVoice";\nexport { criticizeVoice };\n`,
  );
  voiceModule = loaded.mod.criticizeVoice;
  cleanup = loaded.cleanup;
} catch (err) {
  loadError = err;
  for (const leftover of [".blind-v62-p1.entry.ts", ".blind-v62-p1.bundle.cjs"]) {
    fs.rmSync(path.join(__dirname, leftover), { force: true });
  }
}
test.after(() => cleanup());

const REQUIRED_EXPORTS = ["criticizeComment", "VOICE", "C80_TAG", "VOICE_COLUMN", "wrapComment"];

/** The module surface, or a failure that names what is missing. */
function voice() {
  if (loadError) {
    throw new Error(
      `src/core/criticizeVoice is not loadable, so no voice rule can be checked: ${loadError.message}`,
    );
  }
  for (const name of REQUIRED_EXPORTS) {
    if (voiceModule[name] === undefined) {
      throw new Error(`criticizeVoice exports no \`${name}\`, which the contract puts on the surface`);
    }
  }
  return voiceModule;
}

const comment = (finding, opts) =>
  opts === undefined ? voice().criticizeComment(finding) : voice().criticizeComment(finding, opts);

// ===========================================================================
// The fourteen dimensions, and a well-formed finding for each
// ===========================================================================

// Straight off `DimensionId` in src/core/criticizeTypes.ts. Held apart from
// VOICE on purpose: a table that walked its own keys could not catch a missing
// dimension, and a dimension that fires with no words injects a blank comment
// into a person's file.
const DIMENSIONS = [
  "clock",
  "prng",
  "env",
  "world",
  "adjacent-params",
  "bool-param",
  "param-count",
  "undocumented",
  "unenforced-precondition",
  "cqs",
  "pass-through",
  "nesting",
  "unadmitted-failure",
  "section-comment",
];

// Details in the detectors' own register: lower case, no trailing stop, no
// prose. DIGIT-FREE, every one of them, because the blast-radius rows below
// read the digits in a comment as evidence that a call-site clause was
// rendered. A digit smuggled in here would make that test green by accident.
//
// None of them spends the reserved `call site` vocabulary either. Amendment 3
// clause 3 barred the detectors from it, so a comment that says "call site"
// can only have got it from a measured radius. `bool-param` saying "the
// caller" is deliberate: "caller" was never reserved, and this row is what
// catches a call-site guard written too wide.
const DETAIL = {
  clock: "reads the wall clock through Instant::now",
  prng: "seeds a generator through thread_rng",
  env: "reads the process environment through env::var",
  world: "opens a file through File::open",
  "adjacent-params":
    "first and second are neighbours of the same type and the compiler cannot see them swapped",
  "bool-param": "parameter recursive carries a decision the caller had already made",
  "param-count": "the signature takes more parameters than the chosen threshold for rust",
  undocumented: "the public signature carries no doc comment",
  "unenforced-precondition": "the doc promises a non-empty slice and the body never checks it",
  cqs: "the body mutates state and returns a value",
  "pass-through": "every parameter is forwarded unchanged to inner",
  nesting: "the body nests deeper than the chosen threshold for rust",
  "unadmitted-failure": "the body can panic through unwrap and the signature returns no Result",
  "section-comment": "the body is split by a banner comment into stages",
};

// The same findings as the detectors really spell them, thresholds and all.
// The contract's own examples carry numbers, so the year ban has to survive a
// detail that names one.
const DETAIL_WITH_NUMBERS = {
  "adjacent-params": "first and second are neighbours of type u64",
  "param-count": "the signature takes 7 parameters, at or above the chosen threshold of 5 for rust",
  nesting: "the body nests 4 blocks deep, at or above the chosen threshold of 4 for rust",
};

// Digit-free evidence, for the same reason the details are digit-free.
const EVIDENCE = {
  clock: "let started = Instant::now();",
  prng: "let mut rng = thread_rng();",
  env: 'let debug = env::var("COLUMN_DEBUG");',
  world: "let raw = File::open(path)?;",
  "adjacent-params": "pub fn splice(first: Offset, second: Offset) -> Span {",
  "bool-param": "pub fn render(node: &Node, recursive: bool) -> String {",
  "param-count": "pub fn build(a: A, b: B, c: C, d: D, e: E, f: F, g: G) -> Out {",
  undocumented: "pub fn splice(first: Offset, second: Offset) -> Span {",
  "unenforced-precondition": "let head = rows[first];",
  cqs: "self.count += one; return self.count;",
  "pass-through": "inner(first, second, third)",
  nesting: "for row in rows {",
  "unadmitted-failure": "let cfg = parse(raw).unwrap();",
  "section-comment": "// ---- stage two: normalise ----",
};

function findingFor(dimension, overrides) {
  return Object.freeze({
    dimension,
    line: 42,
    evidence: EVIDENCE[dimension],
    detail: DETAIL[dimension],
    ...(overrides || {}),
  });
}

/** Every blast-radius state a caller can put the module in. */
const OPT_STATES = [
  { label: "no opts argument", opts: undefined },
  { label: "an empty opts object", opts: {} },
  { label: "blastRadius undefined", opts: { blastRadius: undefined } },
  { label: "blastRadius 0", opts: { blastRadius: 0 } },
  { label: "blastRadius 1", opts: { blastRadius: 1 } },
  { label: "blastRadius 7", opts: { blastRadius: 7 } },
  { label: "blastRadius 231", opts: { blastRadius: 231 } },
];

/** Every string this module can produce, once, for the walks below. */
function everyComment() {
  const out = [];
  for (const dimension of DIMENSIONS) {
    for (const detailTable of [DETAIL, DETAIL_WITH_NUMBERS]) {
      const detail = detailTable[dimension];
      if (detail === undefined) continue;
      const finding = findingFor(dimension, { detail });
      for (const state of OPT_STATES) {
        out.push({
          dimension,
          detail,
          state: state.label,
          text: comment(finding, state.opts),
          where: `${dimension} / ${state.label} / detail "${detail}"`,
        });
      }
    }
  }
  return out;
}

// ===========================================================================
// Shared regexes
// ===========================================================================

// Amendment 3 clause 2: citations are the target, not digits. A blast radius
// of 2024 is a count and was never a citation, so a naive /\d{4}/ banned legal
// comments.
const YEAR = /\b(19|20)\d{2}\b/;
// Whole words, case-insensitive, exactly the list the contract writes down.
const BANNED_WORDS = [
  "consider",
  "might",
  "maybe",
  "perhaps",
  "probably",
  "you",
  "your",
  "we",
  "our",
  "please",
  "just",
  "simply",
  "recommend",
  "suggest",
];
const BANNED = new RegExp(`\\b(${BANNED_WORDS.join("|")})\\b`, "i");

// Amendment 1 clause 4, kept by Amendment 3: a measured radius renders the
// EXACT words `call site` or `call sites`, and nothing else may spend them.
// One vocabulary, so presence and absence are both assertable without a guess.
// Deliberately narrow: `caller` and `call chain` are ordinary English the
// voice is allowed to use, and a guard that banned them would fail a legal
// comment.
const CALL_SITE_TALK = /\bcall sites?\b/i;

/**
 * The text this module actually authored, with the detector's detail cut out.
 *
 * Amendment 3 clause 2: voice rules 2, 3 and 4 apply here and NOT to the
 * detail. What is left is `VOICE`, the blast clause, the tag and the
 * punctuation between them, which is exactly the set the module writes.
 */
function authoredOnly(text, detail) {
  if (!detail) return text;
  return text.split(detail).join(" ");
}

/** Sentences, each keeping its own terminator. */
const beatsOf = (text) =>
  String(text)
    .trim()
    .split(/(?<=[.!])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

const stripStop = (beat) => beat.replace(/[.!]+$/, "").trim();

// ===========================================================================
// THE SURFACE
// ===========================================================================

test("surface: the five names the contract exports are present, with the right kinds", () => {
  const v = voice();
  assert.equal(typeof v.criticizeComment, "function", "criticizeComment is a function");
  assert.equal(typeof v.wrapComment, "function", "wrapComment is a function");
  assert.equal(typeof v.C80_TAG, "string", "C80_TAG is a string");
  assert.equal(typeof v.VOICE_COLUMN, "number", "VOICE_COLUMN is a number");
  assert.ok(v.VOICE && typeof v.VOICE === "object", "VOICE is an object");
  assert.equal(v.criticizeComment.length >= 1, true, "criticizeComment takes a finding");
});

test("surface: VOICE holds exactly the fourteen dimensions, once each, and none is empty", () => {
  const { VOICE } = voice();
  const keys = Object.keys(VOICE);
  assert.deepEqual(
    [...keys].sort(),
    [...DIMENSIONS].sort(),
    "VOICE keys are exactly the fourteen DimensionId members",
  );
  assert.equal(keys.length, 14, `VOICE has fourteen entries, has ${keys.length}`);
  for (const dimension of DIMENSIONS) {
    const phrase = VOICE[dimension];
    assert.equal(typeof phrase, "string", `VOICE.${dimension} is a string`);
    assert.ok(phrase.trim().length > 0, `VOICE.${dimension} is not blank`);
  }
});

test("surface: VOICE is frozen - the not-a-model invariant is enforced, not claimed", () => {
  // Amendment 3 clause 4. `Readonly<>` is a compile-time claim and this table
  // is the whole argument that the words are fixed and not generated.
  const { VOICE } = voice();
  assert.equal(Object.isFrozen(VOICE), true, "VOICE is Object.freeze'd");
  assert.throws(
    () => {
      "use strict";
      VOICE.clock = "consider splitting it, maybe.";
    },
    /read.only|Cannot assign|frozen/i,
    "a write to VOICE must throw, not land silently",
  );
});

test("surface: VOICE_COLUMN is 80, the width the product already answers with", () => {
  assert.equal(voice().VOICE_COLUMN, 80);
});

// ===========================================================================
// THE TAG - rule 1, and the strip pass in phase 2 depends on it being exact
// ===========================================================================

test("tag: C80_TAG is `C80 `, with the trailing space", () => {
  // Amendment 3 clause 1, which repeals Amendment 1 clause 1. The constant's
  // job is to be the exact bytes phase 2's strip pass removes, so the space
  // belongs to the constant and the join is `${C80_TAG}${dimension}: `.
  assert.equal(voice().C80_TAG, "C80 ");
});

test("tag: every comment starts with `C80 <dimension>: `, exactly, for all fourteen", () => {
  const { C80_TAG } = voice();
  for (const row of everyComment()) {
    const wanted = `C80 ${row.dimension}: `;
    assert.ok(
      row.text.startsWith(wanted),
      `${row.where}: must start with ${JSON.stringify(wanted)}, got ${JSON.stringify(row.text)}`,
    );
    assert.ok(row.text.startsWith(C80_TAG), `${row.where}: must start with C80_TAG`);
    assert.ok(/C80 /.test(row.text), `${row.where}: a grep for "C80 " must find it`);
  }
});

test("tag: the comment carries no comment token and no indent - the caller adds those", () => {
  for (const row of everyComment()) {
    assert.equal(row.text, row.text.trim(), `${row.where}: no leading or trailing whitespace`);
    assert.ok(!row.text.startsWith("//"), `${row.where}: no // token`);
    assert.ok(!row.text.startsWith("#"), `${row.where}: no # token`);
    assert.ok(!row.text.includes("\n"), `${row.where}: one logical group, on one line`);
  }
});

// ===========================================================================
// THE VOICE RULES - walked across all fourteen, both detail sets, every
// blast-radius state
// ===========================================================================

test("rule 2: no module-authored text carries a year, so no comment carries a citation", () => {
  for (const row of everyComment()) {
    const authored = authoredOnly(row.text, row.detail);
    assert.ok(
      !YEAR.test(authored),
      `${row.where}: a citation reached a person's source file: ${JSON.stringify(authored)}`,
    );
  }
});

test("rule 2: the fixed phrases themselves carry no year - the table is where a citation would hide", () => {
  const { VOICE } = voice();
  for (const dimension of DIMENSIONS) {
    assert.ok(
      !YEAR.test(VOICE[dimension]),
      `VOICE.${dimension} contains a year: ${JSON.stringify(VOICE[dimension])}`,
    );
  }
});

test("rule 3: no module-authored text hedges or speaks in the second person", () => {
  // The detail is cut out first. A parameter genuinely named `you` is the
  // detector's problem and Amendment 7 gave that text to the detectors.
  for (const row of everyComment()) {
    const authored = authoredOnly(row.text, row.detail);
    const hit = authored.match(BANNED);
    assert.equal(
      hit,
      null,
      `${row.where}: banned word ${hit && JSON.stringify(hit[0])} in ${JSON.stringify(authored)}`,
    );
  }
});

test("rule 3: each banned word is checked as a whole word, so this row proves the guard bites", () => {
  // A guard written as a substring search would fail every honest phrase that
  // contains "never" or "source". This row pins the reading of the rule the
  // oracle uses above, so a green rule-3 walk means something.
  for (const inner of ["never", "source", "however", "wet", "outer", "adjust", "sourcing"]) {
    assert.equal(BANNED.test(inner), false, `${inner} is not a banned word`);
  }
  for (const word of BANNED_WORDS) {
    assert.equal(BANNED.test(`the fix ${word} here.`), true, `${word} is banned`);
  }
});

test("rule 4: no module-authored text asks a question", () => {
  // `string?` is a real C# type and reaches the comment inside the detail, so
  // the question-mark ban stops at the detail's edge.
  for (const row of everyComment()) {
    const authored = authoredOnly(row.text, row.detail);
    assert.ok(!authored.includes("?"), `${row.where}: contains a question mark: ${JSON.stringify(authored)}`);
  }
});

test("rule 4: every comment closes on a full stop, and never on a question mark", () => {
  // Amendment 1 clause 2 makes the punctuation the rule, and clause 11 puts
  // the fix beat last, so the closing character is always module-authored.
  for (const row of everyComment()) {
    assert.ok(!row.text.endsWith("?"), `${row.where}: ends on a question mark`);
    assert.ok(
      row.text.endsWith("."),
      `${row.where}: must close on a full stop, got ${JSON.stringify(row.text.slice(-24))}`,
    );
  }
});

test("rule 5: every one of the fourteen dimensions produces a non-blank comment", () => {
  const seen = new Set();
  for (const row of everyComment()) {
    const body = row.text.replace(`C80 ${row.dimension}:`, "").trim();
    assert.ok(body.length > 0, `${row.where}: the tag with no words behind it is a blank comment`);
    seen.add(row.dimension);
  }
  assert.equal(seen.size, 14, `all fourteen dimensions were exercised, exercised ${seen.size}`);
});

test("rules: the fixed phrases obey rules 3 and 4 on their own, before any joining", () => {
  const { VOICE } = voice();
  for (const dimension of DIMENSIONS) {
    const phrase = VOICE[dimension];
    assert.equal(phrase.match(BANNED), null, `VOICE.${dimension} holds a banned word: ${phrase}`);
    assert.ok(!phrase.includes("?"), `VOICE.${dimension} asks a question: ${phrase}`);
    assert.ok(phrase.endsWith("."), `VOICE.${dimension} does not close on a full stop: ${phrase}`);
  }
});

test("table: the fixed phrase carries no tag - criticizeComment adds it, so it is added once", () => {
  const { VOICE } = voice();
  for (const dimension of DIMENSIONS) {
    assert.ok(
      !VOICE[dimension].includes("C80"),
      `VOICE.${dimension} already carries the tag, which would double it: ${VOICE[dimension]}`,
    );
  }
});

// ===========================================================================
// THE SHAPE - three beats, and the fix is last
// ===========================================================================

test("shape: `clock` reads exactly the phrase the contract writes down", () => {
  assert.equal(voice().VOICE.clock, "hidden wall-clock read. Untestable. Pass it in.");
});

test("shape: every phrase has two or three beats - a complaint and an order at least", () => {
  const { VOICE } = voice();
  for (const dimension of DIMENSIONS) {
    const beats = beatsOf(VOICE[dimension]);
    assert.ok(
      beats.length >= 2 && beats.length <= 3,
      `VOICE.${dimension} has ${beats.length} beats, the shape is <what it did>. <what that costs>. <what to do>. and beats may compress, not vanish: ${VOICE[dimension]}`,
    );
  }
});

test("shape: the last beat is the order, never a restatement of the complaint", () => {
  // A phrase that ends on the complaint has no order in it. Mechanically: the
  // final beat opens on a verb, not on an article or a pronoun, which is what
  // a description opens on. `Pass it in.` `Inject the reader.` `Split it.`
  const NOT_AN_ORDER = new Set([
    "the",
    "a",
    "an",
    "it",
    "its",
    "this",
    "that",
    "these",
    "those",
    "there",
    "nothing",
    "nobody",
    "no",
    "every",
    "each",
    "which",
    "and",
  ]);
  const { VOICE } = voice();
  for (const dimension of DIMENSIONS) {
    const beats = beatsOf(VOICE[dimension]);
    const last = beats[beats.length - 1];
    const first = stripStop(last).split(/\s+/)[0].toLowerCase().replace(/[^a-z-]/g, "");
    assert.ok(
      !NOT_AN_ORDER.has(first),
      `VOICE.${dimension} ends on a description, not an order: ${JSON.stringify(last)}`,
    );
    assert.ok(last.endsWith("."), `VOICE.${dimension}'s order does not close: ${JSON.stringify(last)}`);
  }
});

test("shape: the order never inverts - the opening beat lands before the order in the comment", () => {
  const { VOICE } = voice();
  for (const dimension of DIMENSIONS) {
    const beats = beatsOf(VOICE[dimension]);
    const opening = stripStop(beats[0]).toLowerCase();
    const order = stripStop(beats[beats.length - 1]).toLowerCase();
    for (const state of OPT_STATES) {
      const text = comment(findingFor(dimension), state.opts).toLowerCase();
      const at1 = text.indexOf(opening);
      const at2 = text.indexOf(order);
      assert.ok(at1 >= 0, `${dimension} / ${state.label}: the opening beat is missing: ${opening}`);
      assert.ok(at2 >= 0, `${dimension} / ${state.label}: the order is missing: ${order}`);
      assert.ok(
        at1 < at2,
        `${dimension} / ${state.label}: the fix landed before the complaint, the order inverted`,
      );
    }
  }
});

// ===========================================================================
// THE FINDING'S OWN SPECIFICS
// ===========================================================================

test("specifics: the detail reaches the comment verbatim, byte for byte, for all fourteen", () => {
  // Amendment 1 clause 7: no case change either. If sentence flow wants a
  // capital, the sentence is restructured around the detail, not over it.
  for (const row of everyComment()) {
    assert.ok(
      row.text.includes(row.detail),
      `${row.where}: the detail was dropped or re-worded, so the comment could apply to any function: ${JSON.stringify(row.text)}`,
    );
  }
});

test("specifics: the evidence line does NOT reach the comment", () => {
  // Amendment 1 clause 12. The comment is planted next to that exact line, so
  // repeating the line above the line is noise.
  for (const row of everyComment()) {
    const evidence = EVIDENCE[row.dimension];
    assert.ok(
      !row.text.includes(evidence),
      `${row.where}: the offending line was echoed above itself: ${JSON.stringify(row.text)}`,
    );
  }
});

test("specifics: two findings on one dimension that differ produce comments that differ", () => {
  for (const dimension of DIMENSIONS) {
    const a = comment(findingFor(dimension, { detail: "first and second are neighbours of the same type" }));
    const b = comment(findingFor(dimension, { detail: "third and fourth are neighbours of another type" }));
    assert.notEqual(
      a,
      b,
      `${dimension}: two different findings produced one comment, which is a comment about nothing`,
    );
  }
});

test("specifics: the fourteen dimensions produce fourteen distinct comments", () => {
  const seen = new Map();
  for (const dimension of DIMENSIONS) {
    const text = comment(findingFor(dimension));
    const clash = seen.get(text);
    assert.equal(clash, undefined, `${dimension} and ${clash} produce the same comment: ${text}`);
    seen.set(text, dimension);
  }
  assert.equal(seen.size, 14);
});

test("specifics: a detail naming a threshold survives the year ban and arrives whole", () => {
  const detail = "the body nests 4 blocks deep, at or above the chosen threshold of 4 for rust";
  const text = comment(findingFor("nesting", { detail }));
  assert.ok(text.includes(detail), `the threshold detail was dropped or re-worded: ${text}`);
  assert.ok(!YEAR.test(text), `a threshold-bearing detail tripped the year ban: ${text}`);
});

test("specifics: a detail carrying `string?` and a count of 2024 is legal and passes through", () => {
  // The two cases Amendment 3 clause 2 was written for, in one row. C# nullable
  // types are everyday, and a blast radius of 2024 is a count, not a citation.
  const detail = "first and second are neighbours of type string? and the compiler cannot see them swapped";
  const text = comment(findingFor("adjacent-params", { detail }), { blastRadius: 2024 });
  assert.ok(text.includes(detail), `the detail was sanitised: ${text}`);
  assert.ok(text.includes("2024"), `the count was dropped: ${text}`);
  const authored = authoredOnly(text, detail);
  assert.ok(!authored.includes("?"), `the module authored a question mark of its own: ${authored}`);
  assert.ok(
    CALL_SITE_TALK.test(authored),
    `a four-digit count is still a measured radius and renders the reserved words: ${authored}`,
  );
  // The count itself is exempt from the year ban. Amendment 3 clause 2 says so
  // in as many words, which is why the prose is checked with the count cut out.
  const prose = authored.split("2024").join(" ");
  assert.ok(!YEAR.test(prose), `the module authored a year of its own: ${prose}`);
});

// ===========================================================================
// BLAST RADIUS - the three-way distinction
// ===========================================================================

test("blast: undefined renders no call-site clause at all, for all fourteen dimensions", () => {
  for (const dimension of DIMENSIONS) {
    const finding = findingFor(dimension);
    for (const opts of [undefined, {}, { blastRadius: undefined }]) {
      const text = comment(finding, opts);
      assert.ok(
        !CALL_SITE_TALK.test(text),
        `${dimension}: an unmeasured blast radius spoke about call sites anyway: ${JSON.stringify(text)}`,
      );
    }
  }
});

test("blast: undefined renders no number at all - not 0, not unknown, no clause", () => {
  // Every detail and every evidence string in this file is digit-free, and the
  // mandated `C80 ` tag is cut off first because the tag itself contains 80.
  // What is left can only have got a digit from a blast-radius clause, which
  // is what catches an unmeasured radius rendered as "0 call sites".
  for (const dimension of DIMENSIONS) {
    const finding = findingFor(dimension);
    const prefix = `C80 ${dimension}: `;
    for (const opts of [undefined, {}, { blastRadius: undefined }]) {
      const full = comment(finding, opts);
      const text = authoredOnly(full.startsWith(prefix) ? full.slice(prefix.length) : full, finding.detail);
      assert.ok(
        !/\d/.test(text),
        `${dimension}: an unmeasured blast radius put a number in the comment: ${JSON.stringify(full)}`,
      );
      assert.ok(
        !/\bunknown\b|\bunmeasured\b|\bnot measured\b/i.test(text),
        `${dimension}: an unmeasured blast radius announced itself instead of staying silent: ${JSON.stringify(text)}`,
      );
    }
  }
});

test("blast: a measured zero and an unmeasured one do not share a spelling", () => {
  for (const dimension of DIMENSIONS) {
    const finding = findingFor(dimension);
    const unmeasured = comment(finding, undefined);
    const measuredZero = comment(finding, { blastRadius: 0 });
    assert.notEqual(
      measuredZero,
      unmeasured,
      `${dimension}: blastRadius 0 rendered the same string as no blast radius, which is the v61 two-state rule broken`,
    );
  }
});

test("blast: a measured zero renders as something - the walk ran and found no call sites", () => {
  for (const dimension of DIMENSIONS) {
    const finding = findingFor(dimension);
    const measuredZero = comment(finding, { blastRadius: 0 });
    const seven = comment(finding, { blastRadius: 7 });
    assert.notEqual(measuredZero, seven, `${dimension}: 0 and 7 render the same`);
    assert.ok(
      CALL_SITE_TALK.test(measuredZero),
      `${dimension}: a measured zero said nothing about call sites: ${JSON.stringify(measuredZero)}`,
    );
  }
});

test("blast: a number renders as that number", () => {
  for (const dimension of DIMENSIONS) {
    const finding = findingFor(dimension);
    for (const n of [1, 2, 7, 231]) {
      const text = comment(finding, { blastRadius: n });
      assert.ok(
        new RegExp(`(^|\\D)${n}(\\D|$)`).test(text),
        `${dimension}: blastRadius ${n} does not appear in ${JSON.stringify(text)}`,
      );
      assert.ok(
        CALL_SITE_TALK.test(text),
        `${dimension}: blastRadius ${n} rendered with no call-site clause: ${JSON.stringify(text)}`,
      );
    }
  }
});

test("blast: singular at 1, plural everywhere else, including at a measured 0", () => {
  // Amendment 1 clause 4. `1 call sites` is the tell of a count formatted by a
  // template that never looked at the number.
  const plural = /\bcall sites\b/i;
  const singular = /\bcall site\b(?!s)/i;
  for (const dimension of DIMENSIONS) {
    const finding = findingFor(dimension);
    const one = comment(finding, { blastRadius: 1 });
    assert.ok(singular.test(one), `${dimension}: a radius of 1 must say "call site": ${JSON.stringify(one)}`);
    assert.ok(!plural.test(one), `${dimension}: a radius of 1 must not say "call sites": ${JSON.stringify(one)}`);
    for (const n of [0, 2, 7, 231]) {
      const many = comment(finding, { blastRadius: n });
      assert.ok(plural.test(many), `${dimension}: a radius of ${n} must say "call sites": ${JSON.stringify(many)}`);
    }
  }
});

test("blast: a radius that is not a non-negative integer is UNMEASURED and renders no clause", () => {
  // Amendment 3 clause 7. A corrupt measurement and an absent one share a
  // spelling on purpose: `2.5 call sites` in a person's source is worse.
  for (const dimension of DIMENSIONS) {
    const finding = findingFor(dimension);
    const unmeasured = comment(finding, undefined);
    for (const bad of [Number.NaN, Infinity, -Infinity, -1, 2.5, -0.5]) {
      const text = comment(finding, { blastRadius: bad });
      assert.equal(
        text,
        unmeasured,
        `${dimension}: blastRadius ${bad} must render as unmeasured, got ${JSON.stringify(text)}`,
      );
    }
  }
});

test("blast: the three states are three distinct strings, on every dimension", () => {
  for (const dimension of DIMENSIONS) {
    const finding = findingFor(dimension);
    const three = [
      comment(finding, undefined),
      comment(finding, { blastRadius: 0 }),
      comment(finding, { blastRadius: 7 }),
    ];
    assert.equal(new Set(three).size, 3, `${dimension}: the three blast states collapsed: ${three.join(" | ")}`);
  }
});

test("blast: a clause added for a blast radius still obeys every voice rule", () => {
  for (const dimension of DIMENSIONS) {
    const finding = findingFor(dimension);
    for (const n of [0, 1, 7, 231]) {
      const full = comment(finding, { blastRadius: n });
      const text = authoredOnly(full, finding.detail);
      assert.ok(!YEAR.test(text), `${dimension} @ ${n}: a year in ${JSON.stringify(text)}`);
      assert.equal(text.match(BANNED), null, `${dimension} @ ${n}: banned word in ${JSON.stringify(text)}`);
      assert.ok(text.endsWith("."), `${dimension} @ ${n}: does not close on a full stop`);
      assert.ok(!text.includes("\n"), `${dimension} @ ${n}: broke onto a second line`);
    }
  }
});

// ===========================================================================
// PURITY - the same input gives the same output, and the finding is untouched
// ===========================================================================

test("purity: two calls with the same finding give the same string", () => {
  for (const dimension of DIMENSIONS) {
    const finding = findingFor(dimension);
    assert.equal(comment(finding), comment(finding), `${dimension} is not deterministic`);
    assert.equal(
      comment(finding, { blastRadius: 3 }),
      comment(finding, { blastRadius: 3 }),
      `${dimension} with a blast radius is not deterministic`,
    );
  }
});

test("purity: the finding handed in is not mutated", () => {
  for (const dimension of DIMENSIONS) {
    const finding = {
      dimension,
      line: 42,
      evidence: EVIDENCE[dimension],
      detail: DETAIL[dimension],
    };
    const before = JSON.stringify(finding);
    comment(finding, { blastRadius: 4 });
    assert.equal(JSON.stringify(finding), before, `${dimension}: criticizeComment wrote to the finding`);
  }
});

// ===========================================================================
// wrapComment
// ===========================================================================

const LONG =
  "hidden wall-clock read. Untestable. Pass it in. reads the wall clock through " +
  "Instant::now at the top of the body, and every caller that wants a fixed clock " +
  "has to fork the function or reach for a global, so the honest fix moves the " +
  "clock into the signature and ripples outward from there.";

const INDENTS = ["", "  ", "    ", "        ", "                "];
const TOKENS = ["//", "#"];

/** The content of a wrapped line, with its indent and token taken back off. */
const contentOf = (line, indent, token) => line.slice((indent + token).length).trim();

test("wrap: empty and whitespace-only text return an empty array, never a bare token", () => {
  // Amendment 1 clause 9 folds whitespace-only in with empty: a comment of
  // nothing but spaces is a bare `//` in someone's file.
  const { wrapComment } = voice();
  for (const text of ["", " ", "   ", "\t", " \t ", "\n"]) {
    for (const indent of INDENTS) {
      for (const token of TOKENS) {
        assert.deepEqual(
          wrapComment(text, indent, token),
          [],
          `${JSON.stringify(text)} at indent ${indent.length} with ${token} must produce no lines`,
        );
      }
    }
  }
});

test("wrap: every returned line carries the indent and the token", () => {
  // A continuation line that lost its token is not a comment, it is code.
  const { wrapComment } = voice();
  for (const indent of [...INDENTS, "\t", "\t\t"]) {
    for (const token of TOKENS) {
      const lines = wrapComment(LONG, indent, token);
      assert.ok(lines.length > 1, `a ${LONG.length}-char text at indent ${indent.length} must wrap`);
      for (const line of lines) {
        assert.ok(
          line.startsWith(indent + token),
          `line does not open on indent + token: ${JSON.stringify(line)}`,
        );
        assert.ok(
          contentOf(line, indent, token).length > 0,
          `a wrapped line carries no words: ${JSON.stringify(line)}`,
        );
      }
    }
  }
});

test("wrap: every line fits VOICE_COLUMN when the words are breakable", () => {
  const { wrapComment, VOICE_COLUMN } = voice();
  for (const indent of INDENTS) {
    for (const token of TOKENS) {
      for (const line of wrapComment(LONG, indent, token)) {
        assert.ok(
          line.length <= VOICE_COLUMN,
          `indent ${indent.length} with ${token}: line is ${line.length} wide, over ${VOICE_COLUMN}: ${JSON.stringify(line)}`,
        );
      }
    }
  }
});

test("wrap: the deeper the indent the more lines - the indent is inside the budget, not outside it", () => {
  // A wrapper that measures the text and then prepends the indent produces the
  // same line count at every depth and blows the column at the deep ones.
  const { wrapComment } = voice();
  const shallow = wrapComment(LONG, "", "//").length;
  const deep = wrapComment(LONG, " ".repeat(40), "//").length;
  assert.ok(deep > shallow, `indent 0 gave ${shallow} lines and indent 40 gave ${deep}`);
});

test("wrap: no word is lost, duplicated or reordered", () => {
  const { wrapComment } = voice();
  const wanted = LONG.split(/\s+/).filter(Boolean);
  for (const indent of INDENTS) {
    for (const token of TOKENS) {
      const got = wrapComment(LONG, indent, token)
        .map((line) => contentOf(line, indent, token))
        .join(" ")
        .split(/\s+/)
        .filter(Boolean);
      assert.deepEqual(got, wanted, `indent ${indent.length} with ${token} did not reassemble to the text`);
    }
  }
});

test("wrap: a text that already fits comes back as one line", () => {
  const { wrapComment } = voice();
  const short = "C80 clock: hidden wall-clock read. Untestable. Pass it in.";
  const lines = wrapComment(short, "  ", "//");
  assert.equal(lines.length, 1, `a ${short.length + 5}-column comment must not wrap: ${JSON.stringify(lines)}`);
  assert.ok(lines[0].startsWith("  //"), `got ${JSON.stringify(lines[0])}`);
  assert.ok(lines[0].includes(short), `the text was altered: ${JSON.stringify(lines[0])}`);
});

test("wrap: TWO unbreakable words each overrun their own line, and no other line does", () => {
  // Amendment 3 clause 8 repealed "and the rest may not": there is no limit on
  // how many lines carry an oversized token, and every line still gets one.
  // Two giant words in one text is the case that killed the old rule.
  const { wrapComment, VOICE_COLUMN } = voice();
  const giantA = "Instant::" + "now".repeat(40);
  const giantB = "Chrono::" + "utc".repeat(40);
  for (const giant of [giantA, giantB]) {
    assert.ok(giant.length > VOICE_COLUMN, "the fixture word must be wider than the column");
  }
  const text = `the body reads the wall clock through ${giantA} and again through ${giantB} on the way out.`;
  const lines = wrapComment(text, "    ", "//");
  for (const giant of [giantA, giantB]) {
    const carriers = lines.filter((line) => line.includes(giant));
    assert.equal(carriers.length, 1, `an unbreakable word must stay whole on one line, found ${carriers.length}`);
  }
  for (const line of lines) {
    if (line.includes(giantA) || line.includes(giantB)) continue;
    assert.ok(
      line.length <= VOICE_COLUMN,
      `a line that carries no giant word overran: ${line.length} wide, ${JSON.stringify(line)}`,
    );
  }
});

test("wrap: an indent wider than the column still returns lines, one word each", () => {
  // Amendment 1 clause 10. The alternative to allowing the overrun here is an
  // infinite loop or a dropped word, and both are worse than a long line.
  const { wrapComment } = voice();
  const text = "hidden wall-clock read. Untestable. Pass it in.";
  const lines = wrapComment(text, " ".repeat(96), "//");
  assert.ok(lines.length > 0, "a wrap at an impossible indent must still emit the words");
  for (const line of lines) {
    assert.ok(line.startsWith(" ".repeat(96) + "//"), `line lost its indent or token: ${JSON.stringify(line)}`);
    assert.ok(contentOf(line, " ".repeat(96), "//").length > 0, `a line carries no word: ${JSON.stringify(line)}`);
  }
  const got = lines
    .map((line) => contentOf(line, " ".repeat(96), "//"))
    .join(" ")
    .split(/\s+/)
    .filter(Boolean);
  assert.deepEqual(got, text.split(/\s+/).filter(Boolean), "a word was dropped at an impossible indent");
});

test("wrap: a real comment at a real indent fits the column", () => {
  // The join of the two halves of this phase: what criticizeComment produces
  // has to survive what wrapComment does to it, at the indents real code sits
  // at. Nothing here needs a document, so it stays inside phase 1.
  const { wrapComment, VOICE_COLUMN } = voice();
  for (const dimension of DIMENSIONS) {
    const finding = findingFor(dimension, { detail: DETAIL_WITH_NUMBERS[dimension] || DETAIL[dimension] });
    for (const n of [undefined, 0, 231]) {
      const text = comment(finding, n === undefined ? undefined : { blastRadius: n });
      for (const indent of ["", "    ", "            "]) {
        const lines = wrapComment(text, indent, indent === "" ? "#" : "//");
        assert.ok(lines.length > 0, `${dimension}: a non-empty comment wrapped to nothing`);
        for (const line of lines) {
          assert.ok(
            line.length <= VOICE_COLUMN,
            `${dimension} @ blast ${n}, indent ${indent.length}: ${line.length} wide: ${JSON.stringify(line)}`,
          );
        }
      }
    }
  }
});
