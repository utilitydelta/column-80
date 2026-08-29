// BLIND ORACLE: the model writes the fix sentence (session-v64 phase 3).
//
// Written from the task brief that quotes `session-v64/goal.md` and the v62
// voice ruling it inherits, PLUS the public facade handed down for
// `src/core/criticizeFix.ts` (`admissibleFix`, `FIX_MAX_CHARS`,
// `FIX_MAX_SENTENCES`, `FIX_BANNED_WORDS`, `FIX_PASS`) and
// `src/core/criticizeVoice.ts` (`VOICE_PARTS`, `VOICE`, `orderFor`,
// `criticizeComment`). `src/core/criticizeFix.ts` and
// `src/core/criticizeVoice.ts` were never opened while this file was
// written. The one type file read is `src/core/criticizeTypes.ts`, and only
// for the fourteen `DimensionId` members and the `DetectorFinding` shape, so
// the inputs below are well formed.
//
// `FIX_MAX_CHARS`, `FIX_MAX_SENTENCES` and `FIX_BANNED_WORDS` are read at
// RUN TIME off the bundled module, never guessed at write time. A fixture
// built from a guessed limit proves nothing about the real gate; a fixture
// built from the module's own constant proves the boundary is where the
// constant says it is.
//
// The contract: the model writes ONE sentence, the last of three beats
// already planted in a developer's file, and every failure DEGRADES TO THE
// TABLE PHRASE rather than to nothing - a comment with no order in it is a
// complaint, and the product does not plant complaints. Ten mechanical
// rules gate that sentence. This file walks each rule with a fixture that
// breaks ONLY that rule, and a near-miss that must be ACCEPTED, so a green
// run proves the rule bites rather than swallows everything near it.
//
// Run: SKIP_LIVE=1 node --test test/blind-v64-p3-fix.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { bundleCore } = require("./.blind-util.cjs");

// ===========================================================================
// Loading, and failing cleanly when the module is not there yet
// ===========================================================================

let mod = null;
let loadError = null;
let cleanup = () => {};
try {
  const loaded = bundleCore(
    "blind-v64-p3-fix",
    `import * as criticizeFix from "../src/core/criticizeFix";
import * as criticizeVoice from "../src/core/criticizeVoice";
export { criticizeFix, criticizeVoice };\n`,
  );
  mod = loaded.mod;
  cleanup = loaded.cleanup;
} catch (err) {
  loadError = err;
  for (const leftover of [".blind-v64-p3-fix.entry.ts", ".blind-v64-p3-fix.bundle.cjs"]) {
    fs.rmSync(path.join(__dirname, leftover), { force: true });
  }
}
test.after(() => cleanup());

const FIX_EXPORTS = ["admissibleFix", "FIX_MAX_CHARS", "FIX_MAX_SENTENCES", "FIX_BANNED_WORDS", "FIX_PASS"];
const VOICE_EXPORTS = ["VOICE_PARTS", "VOICE", "orderFor", "criticizeComment"];

/** The fix module surface, or a failure that names what is missing. */
function fixMod() {
  if (loadError) {
    throw new Error(`src/core/criticizeFix is not loadable: ${loadError.message}`);
  }
  const m = mod.criticizeFix;
  for (const name of FIX_EXPORTS) {
    if (m[name] === undefined) {
      throw new Error(`criticizeFix exports no \`${name}\`, which the contract puts on the surface`);
    }
  }
  return m;
}

/** The voice module surface, or a failure that names what is missing. */
function voiceMod() {
  if (loadError) {
    throw new Error(`src/core/criticizeVoice is not loadable: ${loadError.message}`);
  }
  const m = mod.criticizeVoice;
  for (const name of VOICE_EXPORTS) {
    if (m[name] === undefined) {
      throw new Error(`criticizeVoice exports no \`${name}\`, which the contract puts on the surface`);
    }
  }
  return m;
}

// ===========================================================================
// The fourteen dimensions, and a well-formed finding for each
// ===========================================================================

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

// The goal's own wanted sentence, verbatim.
const WANTED =
  "Make Shard(u64) and Lod(u64) newtypes, so warm_fs_metadata(lod, shard) stops compiling.";

// ===========================================================================
// The v62 voice rules, copied from test/blind-v62-p1-voice.test.cjs, for the
// end-to-end check that a criticizeComment carrying an ACCEPTED model fix
// still obeys the shipped table's own rules. This is a DIFFERENT list from
// FIX_BANNED_WORDS: this one is the fixed vocabulary the table itself was
// ruled against, read off the fixture that already pins it, not a guess.
// ===========================================================================

const YEAR = /\b(19|20)\d{2}\b/;
const TABLE_BANNED_WORDS = [
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
const TABLE_BANNED = new RegExp(`\\b(${TABLE_BANNED_WORDS.join("|")})\\b`, "i");

// ===========================================================================
// Helpers
// ===========================================================================

/** A whole-word regex for one banned word, case-insensitive. */
const wholeWord = (word) => new RegExp(`\\b${word}\\b`, "i");

/**
 * A single-sentence, verb-opening, otherwise-clean fixture of EXACT length
 * `len`, built from the module's own `FIX_MAX_CHARS` rather than a guessed
 * number. "Rename " (7 chars) + a run of `x` + "." pads to any length at
 * least 8, keeps one sentence, one verb at the front, no digits, no banned
 * word, no question mark, no call-site phrase, no comment marker.
 */
function textOfLength(len) {
  const prefix = "Rename ";
  const suffix = ".";
  const fillLen = len - prefix.length - suffix.length;
  assert.ok(fillLen >= 1, `length ${len} is too short to build a fixture from`);
  return prefix + "x".repeat(fillLen) + suffix;
}

/** N clean, verb-opening, single-clause sentences, joined into one text. */
function sentencesOf(n) {
  const verbs = ["Split", "Extract", "Rename", "Inline", "Return", "Guard", "Move", "Flatten"];
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push(`${verbs[i % verbs.length]} the shard field.`);
  }
  return out.join(" ");
}

function isRefusal(result) {
  return (
    result &&
    typeof result === "object" &&
    typeof result.refusal === "string" &&
    result.text === undefined
  );
}

function isAccepted(result) {
  return (
    result &&
    typeof result === "object" &&
    typeof result.text === "string" &&
    result.refusal === undefined
  );
}

// ===========================================================================
// SURFACE
// ===========================================================================

test("surface: criticizeFix exports the five named symbols, with the right kinds", () => {
  const f = fixMod();
  assert.equal(typeof f.admissibleFix, "function", "admissibleFix is a function");
  assert.equal(typeof f.FIX_MAX_CHARS, "number", "FIX_MAX_CHARS is a number");
  assert.ok(f.FIX_MAX_CHARS > 0, "FIX_MAX_CHARS is positive");
  assert.equal(typeof f.FIX_MAX_SENTENCES, "number", "FIX_MAX_SENTENCES is a number");
  assert.ok(f.FIX_MAX_SENTENCES >= 1 && f.FIX_MAX_SENTENCES <= 2, "FIX_MAX_SENTENCES is one or two");
  assert.ok(Array.isArray(f.FIX_BANNED_WORDS), "FIX_BANNED_WORDS is an array");
  assert.ok(f.FIX_BANNED_WORDS.length > 0, "FIX_BANNED_WORDS is not empty");
  for (const w of f.FIX_BANNED_WORDS) {
    assert.equal(typeof w, "string", `FIX_BANNED_WORDS entry ${JSON.stringify(w)} is a string`);
  }
  assert.equal(typeof f.FIX_PASS, "string", "FIX_PASS is a string");
});

test("surface: criticizeVoice exports VOICE_PARTS, VOICE, orderFor, criticizeComment", () => {
  const v = voiceMod();
  assert.ok(v.VOICE_PARTS && typeof v.VOICE_PARTS === "object", "VOICE_PARTS is an object");
  assert.ok(v.VOICE && typeof v.VOICE === "object", "VOICE is an object");
  assert.equal(typeof v.orderFor, "function", "orderFor is a function");
  assert.equal(typeof v.criticizeComment, "function", "criticizeComment is a function");
});

test("surface: VOICE_PARTS holds exactly the fourteen dimensions, each a {complaint, order} pair", () => {
  const { VOICE_PARTS } = voiceMod();
  assert.deepEqual(
    [...Object.keys(VOICE_PARTS)].sort(),
    [...DIMENSIONS].sort(),
    "VOICE_PARTS keys are exactly the fourteen DimensionId members",
  );
  for (const dimension of DIMENSIONS) {
    const part = VOICE_PARTS[dimension];
    assert.equal(typeof part.complaint, "string", `VOICE_PARTS.${dimension}.complaint is a string`);
    assert.ok(part.complaint.trim().length > 0, `VOICE_PARTS.${dimension}.complaint is not blank`);
    assert.equal(typeof part.order, "string", `VOICE_PARTS.${dimension}.order is a string`);
    assert.ok(part.order.trim().length > 0, `VOICE_PARTS.${dimension}.order is not blank`);
  }
});

// ===========================================================================
// THE WANTED SENTENCE - the goal's own example, accepted verbatim
// ===========================================================================

test("the goal's own wanted sentence is accepted, verbatim", () => {
  const { admissibleFix } = fixMod();
  const result = admissibleFix(WANTED);
  assert.ok(isAccepted(result), `the wanted sentence was refused: ${JSON.stringify(result)}`);
  assert.equal(result.text, WANTED, "the accepted text must not be altered");
});

// ===========================================================================
// RULE 1 - one or two sentences, no more
// ===========================================================================

test("rule 1: FIX_MAX_SENTENCES sentences are accepted, one more is refused", () => {
  const { admissibleFix, FIX_MAX_SENTENCES } = fixMod();
  const atLimit = admissibleFix(sentencesOf(FIX_MAX_SENTENCES));
  assert.ok(isAccepted(atLimit), `${FIX_MAX_SENTENCES} clean sentences must be accepted: ${JSON.stringify(atLimit)}`);

  const overLimit = admissibleFix(sentencesOf(FIX_MAX_SENTENCES + 1));
  assert.ok(isRefusal(overLimit), `${FIX_MAX_SENTENCES + 1} sentences must be refused: ${JSON.stringify(overLimit)}`);
  assert.ok(overLimit.refusal.length > 0, "the refusal names a cause");
});

// ===========================================================================
// RULE 2 - at most FIX_MAX_CHARS characters
// ===========================================================================

test("rule 2: exactly FIX_MAX_CHARS characters is accepted, one more is refused", () => {
  const { admissibleFix, FIX_MAX_CHARS } = fixMod();
  const atLimit = textOfLength(FIX_MAX_CHARS);
  assert.equal(atLimit.length, FIX_MAX_CHARS, "fixture is built to the exact limit");
  const acceptedResult = admissibleFix(atLimit);
  assert.ok(isAccepted(acceptedResult), `a fix of exactly FIX_MAX_CHARS must be accepted: ${JSON.stringify(acceptedResult)}`);

  const overLimit = textOfLength(FIX_MAX_CHARS + 1);
  const refusedResult = admissibleFix(overLimit);
  assert.ok(isRefusal(refusedResult), `a fix one char over FIX_MAX_CHARS must be refused: ${JSON.stringify(refusedResult)}`);
  assert.ok(refusedResult.refusal.length > 0, "the refusal names a cause");
});

// ===========================================================================
// RULE 3 - no banned word, whole word, case-insensitive
// ===========================================================================

test("rule 3: every word in FIX_BANNED_WORDS refuses the sentence carrying it, embedded inside a larger token does not", () => {
  const { admissibleFix, FIX_BANNED_WORDS } = fixMod();
  for (const word of FIX_BANNED_WORDS) {
    const violating = `Extract the shard type, ${word} it helps.`;
    const violatingResult = admissibleFix(violating);
    assert.ok(
      isRefusal(violatingResult),
      `banned word ${JSON.stringify(word)} must refuse: ${JSON.stringify(violating)} -> ${JSON.stringify(violatingResult)}`,
    );
    assert.ok(violatingResult.refusal.length > 0, `${word}: the refusal names a cause`);

    const embedded = `Extract the x${word}x shard type.`;
    assert.equal(
      wholeWord(word).test(embedded),
      false,
      `fixture bug: x${word}x must not match ${word} as a whole word`,
    );
    const embeddedResult = admissibleFix(embedded);
    assert.ok(
      isAccepted(embeddedResult),
      `${word} embedded inside a larger token must not trip the ban: ${JSON.stringify(embedded)} -> ${JSON.stringify(embeddedResult)}`,
    );
  }
});

// ===========================================================================
// RULE 4 - no question mark
// ===========================================================================

test("rule 4: a question mark refuses, the same sentence closed on a full stop is accepted", () => {
  const { admissibleFix } = fixMod();
  const violating = "Split shard and lod into separate newtypes?";
  const violatingResult = admissibleFix(violating);
  assert.ok(isRefusal(violatingResult), `a question mark must refuse: ${JSON.stringify(violatingResult)}`);
  assert.ok(violatingResult.refusal.length > 0, "the refusal names a cause");

  const nearMiss = "Split shard and lod into separate newtypes.";
  const nearMissResult = admissibleFix(nearMiss);
  assert.ok(isAccepted(nearMissResult), `the same sentence with a full stop must be accepted: ${JSON.stringify(nearMissResult)}`);
});

// ===========================================================================
// RULE 5 - no four-digit year
// ===========================================================================

test("rule 5: a 19xx/20xx number refuses, a same-width number that is not a year is accepted", () => {
  const { admissibleFix } = fixMod();
  const violating = "Follow the pattern from Smith 2019 and split the shard type.";
  const violatingResult = admissibleFix(violating);
  assert.ok(isRefusal(violatingResult), `a four-digit year must refuse: ${JSON.stringify(violatingResult)}`);
  assert.ok(violatingResult.refusal.length > 0, "the refusal names a cause");

  const nearMiss = "Route the request through port 8080 and split the shard type.";
  assert.equal(YEAR.test(nearMiss), false, "fixture bug: 8080 must not match the year pattern");
  const nearMissResult = admissibleFix(nearMiss);
  assert.ok(
    isAccepted(nearMissResult),
    `a non-year four-digit number must not trip the ban: ${JSON.stringify(nearMissResult)}`,
  );
});

// ===========================================================================
// RULE 6 - never "call site" / "call sites"
// ===========================================================================

test('rule 6: "call site" refuses, "caller" in the same slot is accepted', () => {
  const { admissibleFix } = fixMod();
  const violating = "Audit the call site before splitting the shard type.";
  const violatingResult = admissibleFix(violating);
  assert.ok(isRefusal(violatingResult), `"call site" must refuse: ${JSON.stringify(violatingResult)}`);
  assert.ok(violatingResult.refusal.length > 0, "the refusal names a cause");

  const pluralViolating = "Audit the call sites before splitting the shard type.";
  const pluralResult = admissibleFix(pluralViolating);
  assert.ok(isRefusal(pluralResult), `"call sites" must refuse: ${JSON.stringify(pluralResult)}`);

  const nearMiss = "Audit the caller before splitting the shard type.";
  const nearMissResult = admissibleFix(nearMiss);
  assert.ok(
    isAccepted(nearMissResult),
    `"caller" is ordinary English and must not trip the ban: ${JSON.stringify(nearMissResult)}`,
  );
});

// ===========================================================================
// RULE 7 - no comment markers, no C80 tag, no markdown code fence
// ===========================================================================

test("rule 7: a comment token, the C80 tag, or a code fence each refuse alone", () => {
  const { admissibleFix } = fixMod();
  const cases = [
    ["Split the shard type and drop the // marker syntax.", "a // comment token"],
    ["Split the shard type per the C80 rule.", "the C80 tag"],
    ["Split the shard type into ```a newtype```.", "a markdown code fence"],
  ];
  for (const [text, label] of cases) {
    const result = admissibleFix(text);
    assert.ok(isRefusal(result), `${label} must refuse: ${JSON.stringify(text)} -> ${JSON.stringify(result)}`);
    assert.ok(result.refusal.length > 0, `${label}: the refusal names a cause`);
  }
});

test("rule 7: mentioning a slash or the word markdown in plain prose is accepted", () => {
  const { admissibleFix } = fixMod();
  const nearMiss = "Split the shard type using a forward slash as the field separator.";
  const nearMissResult = admissibleFix(nearMiss);
  assert.ok(
    isAccepted(nearMissResult),
    `ordinary prose that is not a marker must not trip the ban: ${JSON.stringify(nearMissResult)}`,
  );
});

// ===========================================================================
// RULE 8 - an order, not a description: starts with a verb
// ===========================================================================

test("rule 8: opening on The/This/It/There refuses, opening on the same content's verb is accepted", () => {
  const { admissibleFix } = fixMod();
  const openers = [
    "This fixes the shard and lod confusion by using newtypes.",
    "The shard type should become a newtype.",
    "It needs a newtype wrapper around the shard field.",
    "There is a newtype wrapper missing for the shard field.",
  ];
  for (const violating of openers) {
    const result = admissibleFix(violating);
    assert.ok(isRefusal(result), `a description opener must refuse: ${JSON.stringify(violating)} -> ${JSON.stringify(result)}`);
    assert.ok(result.refusal.length > 0, "the refusal names a cause");
  }

  const nearMiss = "Make the shard type a newtype.";
  const nearMissResult = admissibleFix(nearMiss);
  assert.ok(isAccepted(nearMissResult), `an imperative opener must be accepted: ${JSON.stringify(nearMissResult)}`);
});

// ===========================================================================
// RULE 9 - FIX_PASS is a refusal, not a sentence
// ===========================================================================

test("rule 9: FIX_PASS itself is a refusal, and an ordinary accepted sentence is not swallowed by the same check", () => {
  const { admissibleFix, FIX_PASS } = fixMod();
  const passResult = admissibleFix(FIX_PASS);
  assert.ok(isRefusal(passResult), `FIX_PASS must be a refusal, not a sentence: ${JSON.stringify(passResult)}`);
  assert.ok(passResult.refusal.length > 0, "the refusal names a cause");

  assert.notEqual(WANTED, FIX_PASS, "fixture bug: the wanted sentence must not equal FIX_PASS");
  const wantedResult = admissibleFix(WANTED);
  assert.ok(
    isAccepted(wantedResult),
    `a real sentence must not be swallowed by the FIX_PASS check: ${JSON.stringify(wantedResult)}`,
  );
});

// ===========================================================================
// RULE 10 - non-string, empty, whitespace-only are refusals
// ===========================================================================

test("rule 10: non-string, empty and whitespace-only values are refusals; a short real sentence is not", () => {
  const { admissibleFix } = fixMod();
  const badValues = [123, null, undefined, {}, [], true, false, "", "   ", "\t\n", " "];
  for (const bad of badValues) {
    const result = admissibleFix(bad);
    assert.ok(isRefusal(result), `${JSON.stringify(bad)} must be a refusal: ${JSON.stringify(result)}`);
    assert.ok(result.refusal.length > 0, `${JSON.stringify(bad)}: the refusal names a cause`);
  }

  const nearMiss = "Refactor the shard field.";
  const nearMissResult = admissibleFix(nearMiss);
  assert.ok(
    isAccepted(nearMissResult),
    `a short but real sentence must not be caught by the emptiness guard: ${JSON.stringify(nearMissResult)}`,
  );
});

// ===========================================================================
// Every refusal names its cause, and different causes are not all the same
// sentence - a drop with no reason is indistinguishable from never having
// asked.
// ===========================================================================

test("refusals: every one carries a non-empty refusal string, and different causes are not all spelled the same", () => {
  const { admissibleFix, FIX_MAX_CHARS, FIX_MAX_SENTENCES, FIX_PASS, FIX_BANNED_WORDS } = fixMod();
  const causes = {
    "too many sentences": sentencesOf(FIX_MAX_SENTENCES + 1),
    "too long": textOfLength(FIX_MAX_CHARS + 1),
    "banned word": `Extract the shard type, ${FIX_BANNED_WORDS[0]} it helps.`,
    "question mark": "Split shard and lod into separate newtypes?",
    year: "Follow the pattern from Smith 2019 and split the shard type.",
    "call site": "Audit the call site before splitting the shard type.",
    "comment marker": "Split the shard type and drop the // marker syntax.",
    "description opener": "This fixes the shard and lod confusion by using newtypes.",
    "FIX_PASS": FIX_PASS,
    "non-string": 123,
    empty: "",
    whitespace: "   ",
  };
  const reasons = new Set();
  for (const [label, value] of Object.entries(causes)) {
    const result = admissibleFix(value);
    assert.ok(isRefusal(result), `${label}: expected a refusal, got ${JSON.stringify(result)}`);
    assert.equal(typeof result.refusal, "string", `${label}: refusal is a string`);
    assert.ok(result.refusal.trim().length > 0, `${label}: refusal is not blank`);
    reasons.add(result.refusal);
  }
  assert.ok(
    reasons.size > 1,
    `every distinct cause produced the identical refusal sentence, which names no cause: ${JSON.stringify([...reasons])}`,
  );
});

// ===========================================================================
// orderFor - the table order for every refused fix, the model's order for
// every accepted one, across all fourteen dimensions
// ===========================================================================

test("orderFor: no fix, and a refused fix, both return the TABLE order, for all fourteen dimensions", () => {
  const { VOICE_PARTS, orderFor } = voiceMod();
  const { FIX_PASS } = fixMod();
  const badFixes = [undefined, "not a fix?", FIX_PASS, ""];
  for (const dimension of DIMENSIONS) {
    const tableOrder = VOICE_PARTS[dimension].order;
    assert.equal(orderFor(dimension), tableOrder, `${dimension}: orderFor with no second argument`);
    for (const bad of badFixes) {
      assert.equal(
        orderFor(dimension, bad),
        tableOrder,
        `${dimension}: a refused fix (${JSON.stringify(bad)}) must fall back to the table order`,
      );
    }
  }
});

test("orderFor: an accepted fix returns the model's own order, for all fourteen dimensions", () => {
  const { VOICE_PARTS, orderFor } = voiceMod();
  for (const dimension of DIMENSIONS) {
    const got = orderFor(dimension, WANTED);
    assert.equal(got, WANTED, `${dimension}: an accepted fix must be used verbatim as the order`);
    assert.notEqual(got, VOICE_PARTS[dimension].order, `${dimension}: the accepted fix must not silently fall back`);
  }
});

// ===========================================================================
// criticizeComment - the degradation guarantee: no fix and a refused fix are
// byte-identical, for all fourteen dimensions and for a measured, an
// unmeasured, and a zero blast radius. THE MOST IMPORTANT ROW IN THIS FILE.
// ===========================================================================

test("degradation: no fix and a refused fix render the byte-identical comment, all fourteen dimensions, three blast states", () => {
  const { criticizeComment } = voiceMod();
  const { FIX_PASS } = fixMod();
  const badFixes = ["not a fix?", FIX_PASS, "This is not an order."];
  const blastStates = [
    { label: "unmeasured", opts: {} },
    { label: "measured zero", opts: { blastRadius: 0 } },
    { label: "measured seven", opts: { blastRadius: 7 } },
  ];
  for (const dimension of DIMENSIONS) {
    const finding = findingFor(dimension);
    for (const { label, opts } of blastStates) {
      const noFix = criticizeComment(finding, { ...opts });
      const noFixExplicitUndefined = criticizeComment(finding, { ...opts, fix: undefined });
      assert.equal(
        noFixExplicitUndefined,
        noFix,
        `${dimension} @ ${label}: fix: undefined must render the same as no fix key at all`,
      );
      for (const bad of badFixes) {
        const withBadFix = criticizeComment(finding, { ...opts, fix: bad });
        assert.equal(
          withBadFix,
          noFix,
          `${dimension} @ ${label}: a refused fix (${JSON.stringify(bad)}) must render byte-identically to no fix at all`,
        );
      }
    }
  }
});

// ===========================================================================
// criticizeComment - an accepted fix keeps the detail and the blast clause
// byte-identical, and changes only the final sentence.
// ===========================================================================

test("accepted fix: the comment's prefix (detail and blast clause) is untouched, only the order changes", () => {
  const { VOICE_PARTS, criticizeComment } = voiceMod();
  const blastStates = [
    { label: "unmeasured", opts: {} },
    { label: "measured zero", opts: { blastRadius: 0 } },
    { label: "measured seven", opts: { blastRadius: 7 } },
  ];
  for (const dimension of DIMENSIONS) {
    const finding = findingFor(dimension);
    const tableOrder = VOICE_PARTS[dimension].order;
    for (const { label, opts } of blastStates) {
      const base = criticizeComment(finding, { ...opts });
      assert.ok(
        base.endsWith(tableOrder),
        `${dimension} @ ${label}: the table comment must end on the table order: ${JSON.stringify(base)}`,
      );
      const prefix = base.slice(0, base.length - tableOrder.length);

      const withFix = criticizeComment(finding, { ...opts, fix: WANTED });
      assert.notEqual(withFix, base, `${dimension} @ ${label}: an accepted fix must change the comment`);
      assert.ok(
        withFix.startsWith(prefix),
        `${dimension} @ ${label}: everything before the order must be untouched: prefix=${JSON.stringify(prefix)} got=${JSON.stringify(withFix)}`,
      );
      assert.equal(
        withFix.slice(prefix.length),
        WANTED,
        `${dimension} @ ${label}: the only thing after the untouched prefix must be the accepted fix, verbatim`,
      );
    }
  }
});

// ===========================================================================
// VOICE[dimension] === VOICE_PARTS[dimension].complaint + " " + order
// ===========================================================================

test("VOICE cannot drift from VOICE_PARTS: VOICE[d] === complaint + ' ' + order, for all fourteen", () => {
  const { VOICE, VOICE_PARTS } = voiceMod();
  for (const dimension of DIMENSIONS) {
    const part = VOICE_PARTS[dimension];
    assert.equal(
      VOICE[dimension],
      `${part.complaint} ${part.order}`,
      `${dimension}: VOICE and VOICE_PARTS have drifted apart`,
    );
  }
});

// ===========================================================================
// The v62 voice rules still hold for a comment carrying an ACCEPTED model
// fix. Strip the detector's detail first - it is exempt, the way the v62
// oracle strips it.
// ===========================================================================

/** The text this module authored, with the detector's detail cut out. */
function authoredOnly(text, detail) {
  if (!detail) return text;
  return text.split(detail).join(" ");
}

test("accepted fix: the whole comment still obeys the v62 voice rules once the detail is stripped", () => {
  const { criticizeComment } = voiceMod();
  const blastStates = [undefined, { blastRadius: 0 }, { blastRadius: 7 }];
  for (const dimension of DIMENSIONS) {
    const finding = findingFor(dimension);
    for (const opts of blastStates) {
      const full = opts === undefined ? { fix: WANTED } : { ...opts, fix: WANTED };
      const text = criticizeComment(finding, full);
      const authored = authoredOnly(text, finding.detail);
      assert.ok(!YEAR.test(authored), `${dimension}: an accepted fix let a year through: ${JSON.stringify(authored)}`);
      assert.equal(
        authored.match(TABLE_BANNED),
        null,
        `${dimension}: an accepted fix let a banned word through: ${JSON.stringify(authored)}`,
      );
      assert.ok(!authored.includes("?"), `${dimension}: an accepted fix let a question mark through: ${JSON.stringify(authored)}`);
      assert.ok(text.endsWith("."), `${dimension}: the comment must still close on a full stop: ${JSON.stringify(text)}`);
      assert.ok(!text.endsWith("?"), `${dimension}: the comment must never close on a question mark`);
    }
  }
});

// ===========================================================================
// A hostile dimension produces no comment and no order, with or without a
// fix.
// ===========================================================================

test("hostile dimension: constructor/__proto__/toString produce no comment and no order, with or without a fix", () => {
  const { orderFor, criticizeComment } = voiceMod();
  const hostile = ["constructor", "__proto__", "toString"];
  for (const dimension of hostile) {
    for (const fix of [undefined, WANTED, "not a fix?"]) {
      const order = fix === undefined ? orderFor(dimension) : orderFor(dimension, fix);
      assert.ok(
        order === undefined || order === null || order === "",
        `orderFor(${JSON.stringify(dimension)}, fix=${JSON.stringify(fix)}) must produce no order, got ${JSON.stringify(order)}`,
      );

      const finding = { dimension, line: 1, evidence: "x", detail: "y" };
      const opts = fix === undefined ? undefined : { fix };
      const comment = opts === undefined ? criticizeComment(finding) : criticizeComment(finding, opts);
      assert.ok(
        comment === undefined || comment === null || comment === "",
        `criticizeComment for a hostile dimension must produce no comment, got ${JSON.stringify(comment)}`,
      );
    }
  }
});
