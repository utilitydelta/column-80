// White-box: the Criticize voice table (session-v62 phase 1).
//
// This module writes into a person's source file, which is a harder bar than
// writing into an output panel: a comment the developer accepts is a comment
// they now own and have to live with. Three properties carry that, and all
// three are mechanical rather than admired:
//
//  - THE VOICE RULES ARE CHECKABLE. No citation, no four-digit year, no second
//    person, no hedge. The human ruled the aesthetic and the ruling is only
//    worth anything if a test can fail on it.
//  - EVERY DIMENSION HAS WORDS. A dimension that fires with an empty phrase
//    injects a blank comment, and a blank comment is worse than no comment.
//  - THE ORDER IS LAST. A phrase that trails off after the complaint tells the
//    developer nothing they can do at the line they are looking at.
//
// Run: node --test test/impl-v62-p1-voice.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-v62-p1-voice",
  `export * from "../src/core/criticizeVoice";
export { TIGHTEN_COLUMN } from "../src/core/tightenRegion";\n`,
);
test.after(cleanup);

const { VOICE, C80_TAG, VOICE_COLUMN, criticizeComment, wrapComment, TIGHTEN_COLUMN } = mod;

/** The fifteen, retyped from `criticizeTypes.ts`. Retyped deliberately: a test
 *  that imported the list could not notice a dimension being dropped from it. */
const DIMENSIONS = [
  "clock", "prng", "env", "world",
  "adjacent-params", "bool-param", "unused-param", "param-count",
  "undocumented", "unenforced-precondition", "cqs",
  "pass-through", "nesting",
  "unadmitted-failure",
  "section-comment",
];

/** The mechanical half of "no hedging, no second person". */
const BANNED = [
  "consider", "might", "maybe", "perhaps", "probably",
  "you", "your", "we", "our",
  "please", "just", "simply", "recommend", "suggest",
];

/** A realistic detail per dimension, copied from what the detectors actually
 *  emit (`criticizeHonesty.DETAIL`, `criticizeSignature`, `criticizeAltitude`,
 *  `criticizeContract`, `criticizeSafety`). A made-up detail would prove the
 *  join works on strings this module will never see. */
const DETAILS = {
  clock: "reads the wall clock",
  prng: "reads a pseudorandom generator",
  env: "reads the process environment",
  world: "opens or reads a file",
  "adjacent-params": "first and second are neighbours of type u64, and the compiler cannot see them swapped",
  "bool-param": "parameter recursive carries a decision the caller had already made",
  "unused-param": "parameter depth never appears in the body",
  "param-count": "7 parameters, at or above the chosen threshold of 6 for Rust",
  undocumented: "public surface with no doc comment",
  "unenforced-precondition": "the doc states a precondition and the body checks nothing",
  cqs: "answers a question and changes state that outlives the call",
  "pass-through": "the body is one delegating call taking 3 arguments against the signature's 3 parameters, so the interface is as wide as the implementation",
  nesting: "the body nests 4 blocks deep, at or above the chosen threshold of 4 for Rust",
  "section-comment": "a comment labels the lines under it, and a labelled section is a step at its own altitude",
  "unadmitted-failure": "the body can panic and the return type admits no failure",
};

const findingFor = (dimension) => ({
  dimension,
  line: 12,
  evidence: "let now = SystemTime::now();",
  detail: DETAILS[dimension],
});

/** Every string this module can produce for a dimension, under the argument
 *  shapes the contract admits. The rules apply to all of them, not to the
 *  happy path. */
function allComments(dimension) {
  const finding = findingFor(dimension);
  return [
    VOICE[dimension],
    criticizeComment(finding),
    criticizeComment({ ...finding, detail: "" }),
    criticizeComment(finding, {}),
    criticizeComment(finding, { blastRadius: 0 }),
    criticizeComment(finding, { blastRadius: 1 }),
    criticizeComment(finding, { blastRadius: 47 }),
  ];
}

/**
 * The half of a comment THIS MODULE wrote: the tag, the dimension id, the
 * phrase, the blast clause and the punctuation between them, with the
 * detector's detail cut out.
 *
 * The voice rules police that half and no other. Rules 3 and 4 and the
 * verbatim-detail rule are not jointly satisfiable over the whole comment:
 * `public static Span Splice(string? first, string? second)` is everyday C#
 * and the real detector emits `...neighbours of type string?...`, which puts a
 * question mark in the comment; a parameter genuinely named `you` puts a
 * banned word there the same way. A test that applied the rules to the whole
 * string would be demanding this module re-word text it does not own, which is
 * the one thing the detail rule forbids.
 */
function moduleAuthored(text, dimension) {
  const detail = DETAILS[dimension];
  return typeof detail === "string" && detail !== "" ? text.split(detail).join("") : text;
}

// ---------------------------------------------------------------------------
// 1. The table
// ---------------------------------------------------------------------------

test("every one of the fifteen dimensions has a non-empty phrase, and nothing else does", () => {
  assert.deepEqual(
    Object.keys(VOICE).sort(),
    [...DIMENSIONS].sort(),
    "the table must carry exactly the fifteen rubric dimensions",
  );
  for (const dimension of DIMENSIONS) {
    const phrase = VOICE[dimension];
    assert.equal(typeof phrase, "string", `${dimension} must have a phrase`);
    assert.ok(phrase.trim().length > 0, `${dimension} must not be a blank comment`);
  }
});

test("the phrase table is frozen in practice: two reads give the same strings", () => {
  // The whole point of a table rather than a model. Pinned so a later refactor
  // to a getter or a builder has to keep this property.
  for (const dimension of DIMENSIONS) {
    assert.equal(VOICE[dimension], VOICE[dimension]);
  }
});

test("the phrase table cannot be rewritten at runtime, and a later comment proves it", () => {
  // `Readonly<>` is a compile-time claim and it is gone by the time this ships.
  // Every module in the bundle shares this object, and this is the one path
  // that writes into a person's source file: a table that could be reassigned
  // is a fixed voice that is not fixed. Enforced by construction rather than
  // by convention, and asserted through the PRODUCT rather than on the table,
  // because a test that only read `VOICE.clock` back would pass on a build
  // where `criticizeComment` had snapshotted the mutation.
  assert.equal(Object.isFrozen(VOICE), true, "the table is frozen by construction");
  const before = criticizeComment(findingFor("clock"));
  try {
    // Silent under sloppy mode, a TypeError under strict. Either is a pass;
    // the failure this catches is the write LANDING.
    VOICE.clock = "hidden wall-clock read. Fine. Ship it.";
    VOICE["not-a-dimension"] = "smuggled in.";
    delete VOICE.nesting;
  } catch {
    // Strict-mode rejection is the stronger outcome, not a failure.
  }
  assert.equal(VOICE.clock, "hidden wall-clock read. Untestable. Pass it in.");
  assert.equal(VOICE["not-a-dimension"], undefined, "no sixteenth dimension can be added");
  assert.equal(typeof VOICE.nesting, "string", "no dimension can be deleted out of the table");
  assert.equal(criticizeComment(findingFor("clock")), before, "the comment after the write is the comment before it");
});

// ---------------------------------------------------------------------------
// 2. The voice rules, over everything the module can produce
// ---------------------------------------------------------------------------

test("no comment cites a year, because a citation is a lecture", () => {
  // The ruled test is `\b(19|20)\d{2}\b`, not `\d{4}`. A function with 1024
  // call sites produces a legal comment that a naive four-digit rule fails,
  // and citations rather than digits are what the ban is for. The tag itself
  // carries `80`, which is why the rule is anchored on the century.
  const YEAR = /\b(19|20)\d{2}\b/;
  for (const dimension of DIMENSIONS) {
    for (const text of allComments(dimension)) {
      const mine = moduleAuthored(text, dimension);
      assert.ok(!YEAR.test(mine), `${dimension} must cite no year: ${mine}`);
    }
  }
});

test("no comment hedges and no comment says you, your, we or our", () => {
  for (const dimension of DIMENSIONS) {
    for (const text of allComments(dimension)) {
      const mine = moduleAuthored(text, dimension);
      for (const word of BANNED) {
        const hit = new RegExp(`\\b${word}\\b`, "i");
        assert.ok(!hit.test(mine), `${dimension} must not contain "${word}": ${mine}`);
      }
    }
  }
});

test("no comment asks a question, and every comment ends on a full stop", () => {
  for (const dimension of DIMENSIONS) {
    for (const text of allComments(dimension)) {
      const mine = moduleAuthored(text, dimension);
      assert.ok(!mine.includes("?"), `${dimension} must not ask a question: ${mine}`);
      // The full stop is asserted on the WHOLE string: the last beat is the
      // table's order, which this module does author, so the ending is the
      // module's own and the detail never sits at the end.
      assert.ok(/\.$/.test(text), `${dimension} must end on a full stop: ${text}`);
    }
  }
});

test("no comment softens, praises or trails off into reassurance", () => {
  // The banned-word list is the mechanical half; these are the shapes that
  // slip past it and turn contempt into a code review.
  const SOFT = /\b(good|nice|great|well done|otherwise fine|not a big deal|minor)\b/i;
  for (const dimension of DIMENSIONS) {
    for (const text of allComments(dimension)) {
      const mine = moduleAuthored(text, dimension);
      assert.ok(!SOFT.test(mine), `${dimension} must not balance the ledger: ${mine}`);
    }
  }
});

test("a C# nullable type puts a question mark in the comment, and that comment is still legal", () => {
  // `public static Span Splice(string? first, string? second)` is everyday C#,
  // and the real detector emits the type name verbatim. The reviewer proved
  // the old reading of rule 4 impossible on this input: either the detail is
  // carried byte for byte, or there is no `?` in the comment, and the ruling
  // took the detail. So the `?` rides through and the sentence this module
  // wrote around it is still an order ending on a stop.
  const detail = "first and second are neighbours of type string?, and the compiler cannot see them swapped";
  const text = criticizeComment({
    dimension: "adjacent-params",
    line: 4,
    evidence: "public static Span Splice(string? first, string? second)",
    detail,
  });
  assert.ok(text.includes(detail), `the detector's type name is untouched: ${text}`);
  assert.ok(text.includes("?"), "the question mark reaches the comment, by ruling");
  assert.ok(text.startsWith("C80 adjacent-params: "), text);
  assert.ok(text.endsWith("Give them distinct types."), `the order is still last: ${text}`);
  // And the half this module wrote carries none of it.
  const mine = text.split(detail).join("");
  assert.ok(!mine.includes("?"), `this module asks nothing: ${mine}`);
  assert.ok(/\.$/.test(mine), mine);
});

test("a parameter genuinely named you rides through, because the detector owns that name", () => {
  // The second half of the same ruling. Renaming someone's parameter to keep a
  // banned word out of the comment would be this module inventing a finding,
  // and a comment that names a parameter the file does not have is worse than
  // a comment containing the word "you".
  const detail = "parameter you never appears in the body";
  const text = criticizeComment({ dimension: "unused-param", line: 7, evidence: "fn f(you: u8)", detail });
  assert.ok(text.includes(detail), `verbatim, banned word and all: ${text}`);
  const mine = text.split(detail).join("");
  for (const word of BANNED) {
    assert.ok(!new RegExp(`\\b${word}\\b`, "i").test(mine), `this module said "${word}": ${mine}`);
  }
});

test("every phrase ends on an order, never on the complaint", () => {
  // The falsifier for "three beats, the third is the order". A phrase whose
  // last sentence is a noun phrase is a description, and the developer at the
  // failing line gets nothing they can act on.
  const IMPERATIVES = new Set([
    "Pass", "Take", "Inject", "Give", "Split", "Delete", "Group",
    "Write", "Enforce", "Extract", "Admit", "Drop", "Return", "Move",
  ]);
  for (const dimension of DIMENSIONS) {
    const sentences = VOICE[dimension].split(". ");
    assert.ok(sentences.length >= 2, `${dimension} must have at least two beats: ${VOICE[dimension]}`);
    const last = sentences[sentences.length - 1];
    const verb = last.split(" ")[0];
    assert.ok(
      IMPERATIVES.has(verb),
      `${dimension} must end on an imperative, got "${last}" starting with "${verb}"`,
    );
  }
});

test("a phrase is short enough to read at the failing line", () => {
  // No hard contract number, so this is a smoke bound rather than a ruling:
  // three beats that run past 160 characters have stopped being contempt and
  // started being teaching.
  for (const dimension of DIMENSIONS) {
    assert.ok(
      VOICE[dimension].length <= 160,
      `${dimension} is ${VOICE[dimension].length} chars and has turned into a lecture`,
    );
  }
});

// ---------------------------------------------------------------------------
// 3. The tag and the shape
// ---------------------------------------------------------------------------

test("every comment starts with the tag and its own dimension id", () => {
  assert.equal(C80_TAG, "C80 ", "the marker carries its trailing space, because the strip pass matches it");
  for (const dimension of DIMENSIONS) {
    const text = criticizeComment(findingFor(dimension));
    assert.ok(
      text.startsWith(`${C80_TAG}${dimension}: `),
      `${dimension} must lead with "C80 ${dimension}: ": ${text}`,
    );
    // The falsifier: a comment that led with a DIFFERENT dimension id would
    // still start with the tag and would still pass a grep.
    const head = text.slice(C80_TAG.length, text.indexOf(":"));
    assert.equal(head, dimension);
  }
});

test("a comment with no detail is the phrase itself, off the tag", () => {
  // The ruled example, verbatim. It is the one shape the human wrote down.
  assert.equal(
    criticizeComment({ dimension: "clock", line: 3, evidence: "now()", detail: "" }),
    "C80 clock: hidden wall-clock read. Untestable. Pass it in.",
  );
});

// ---------------------------------------------------------------------------
// 4. The finding's own specifics
// ---------------------------------------------------------------------------

test("the comment carries the detector's detail verbatim, and the phrase with it", () => {
  for (const dimension of DIMENSIONS) {
    const text = criticizeComment(findingFor(dimension));
    assert.ok(
      text.includes(DETAILS[dimension]),
      `${dimension} must carry the detector's own words unchanged: ${text}`,
    );
    // Both halves present: the facts above, and the last beat of the phrase
    // (the order) below. Where they join is this module's business.
    const order = VOICE[dimension].split(". ").pop();
    assert.ok(text.endsWith(order), `${dimension} must still end on its order: ${text}`);
  }
});

test("the specifics make two findings of one dimension different comments", () => {
  // A comment that could apply to any function is not criticism. Two nesting
  // findings at different depths must not read the same.
  const four = criticizeComment({
    dimension: "nesting", line: 9, evidence: "if x {",
    detail: "the body nests 4 blocks deep, at or above the chosen threshold of 4 for Rust",
  });
  const six = criticizeComment({
    dimension: "nesting", line: 9, evidence: "if x {",
    detail: "the body nests 6 blocks deep, at or above the chosen threshold of 4 for Rust",
  });
  assert.notEqual(four, six);
  assert.ok(four.includes("4 blocks deep"));
  assert.ok(six.includes("6 blocks deep"));
});

test("a malformed finding produces no comment rather than half a one", () => {
  assert.equal(criticizeComment(undefined), "");
  assert.equal(criticizeComment(null), "");
  assert.equal(criticizeComment({}), "");
  assert.equal(criticizeComment({ dimension: "not-a-dimension", detail: "x" }), "");
  // And the empty string is what stops it reaching a file at all.
  assert.deepEqual(wrapComment(criticizeComment({}), "    ", "//"), []);
});

// ---------------------------------------------------------------------------
// 5. Blast radius: a measured zero and an unmeasured one do not share a spelling
// ---------------------------------------------------------------------------

test("no phrase in the table says call site or caller, so the blast rule stays readable", () => {
  // Found twice, by this file and then by the phase 1 blind oracle:
  // `adjacent-params` ended "a transposed call site still compiles" and six
  // other phrases priced the defect in "callers". Either way a comment with NO
  // blast radius still spoke about call sites, and a reader could not tell the
  // walk had not run from the words alone. The whole family belongs to the
  // blast clause, which only speaks when something was measured. The
  // DETECTOR's detail keeps its own wording, because the detector owns it.
  const FAMILY = /call[\s-]?sites?|callers?|call\s?chain/i;
  for (const dimension of DIMENSIONS) {
    assert.ok(
      !FAMILY.test(VOICE[dimension]),
      `${dimension} must leave call-site talk to the blast clause: ${VOICE[dimension]}`,
    );
  }
});

test("an absent blast radius says NOTHING about call sites", () => {
  for (const dimension of DIMENSIONS) {
    for (const opts of [undefined, {}, { blastRadius: undefined }]) {
      // Detail-free, because a detector's own detail may legitimately say
      // "call site" and this is a test about what THIS module adds.
      const text = criticizeComment({ ...findingFor(dimension), detail: "" }, opts);
      assert.ok(!/call site/i.test(text), `${dimension} must not mention call sites: ${text}`);
      assert.ok(!/\b0\b/.test(text), `${dimension} must not render a zero: ${text}`);
      // And with the real detail, it adds no clause of its own either.
      const full = criticizeComment(findingFor(dimension), opts);
      assert.ok(!/ride[s]? on this signature/.test(full), `${dimension}: ${full}`);
      assert.ok(!/no call sites/i.test(full), `${dimension}: ${full}`);
    }
  }
});

test("a measured zero renders in words and never as a digit", () => {
  const text = criticizeComment(findingFor("clock"), { blastRadius: 0 });
  assert.ok(/no call sites/i.test(text), text);
  assert.ok(!/\b0\b/.test(text), `a measured zero must not read as a digit: ${text}`);
  // And it must not read the same as the unmeasured one, which is the whole
  // reason the two are separated.
  assert.notEqual(text, criticizeComment(findingFor("clock")));
});

test("a measured count renders the number, and agrees with itself", () => {
  const one = criticizeComment(findingFor("clock"), { blastRadius: 1 });
  assert.ok(one.includes("1 call site rides"), one);
  assert.ok(!one.includes("call sites"), `one call site is singular: ${one}`);
  const many = criticizeComment(findingFor("clock"), { blastRadius: 14 });
  assert.ok(many.includes("14 call sites ride"), many);
});

test("the blast clause sits before the order, so the comment still ends on the fix", () => {
  const text = criticizeComment(findingFor("clock"), { blastRadius: 14 });
  assert.ok(text.endsWith("Pass it in."), text);
  assert.ok(text.indexOf("14 call sites") < text.indexOf("Pass it in."), text);
});

test("a blast radius that is not a non-negative integer produces NO clause at all", () => {
  // Ruled, and the reason is worth writing down because the ruling costs
  // something: a corrupt measurement and an absent one now share a spelling,
  // and there is no way to tell them apart from the comment. That is the
  // lesser evil. `2.5 call sites ride on this signature.` written into a
  // person's source file is a number nobody can act on and a claim the walk
  // never made, and it discredits every honest count next to it. Silence is
  // recoverable; a wrong number in someone's committed code is not.
  for (const bad of [-1, 1.5, 2.5, NaN, Infinity, -Infinity, "3", null, true, {}]) {
    const text = criticizeComment(findingFor("clock"), { blastRadius: bad });
    assert.ok(!/call site/i.test(text), `${String(bad)} is not a measurement: ${text}`);
    assert.ok(!/ride[s]? on this signature/.test(text), `${String(bad)} must add no clause: ${text}`);
    // Past the tag, which carries the 80 the product is named for, the clock
    // comment has no digits in it at all, so a leaked count would show.
    assert.ok(!/\d/.test(text.slice(C80_TAG.length)), `${String(bad)} must not leak a digit: ${text}`);
    // Identical to the unmeasured comment, byte for byte. Nothing hedges, and
    // nothing hints that a number was offered and refused.
    assert.equal(text, criticizeComment(findingFor("clock")));
  }
});

// ---------------------------------------------------------------------------
// 6. The wrap
// ---------------------------------------------------------------------------

test("the wrap respects the column the product is named for", () => {
  assert.equal(VOICE_COLUMN, 80);
  assert.equal(VOICE_COLUMN, TIGHTEN_COLUMN, "one answer to how wide, not two");
});

test("every wrapped line fits 80 columns, at every indent, in both comment tokens", () => {
  for (const dimension of DIMENSIONS) {
    for (const indent of ["", "    ", "        ", "\t\t"]) {
      for (const token of ["//", "#"]) {
        const lines = wrapComment(criticizeComment(findingFor(dimension), { blastRadius: 14 }), indent, token);
        assert.ok(lines.length > 0, `${dimension} must produce lines`);
        for (const line of lines) {
          const width = [...line].reduce((n, ch) => n + (ch === "\t" ? 4 : 1), 0);
          assert.ok(width <= 80, `${dimension} at indent ${JSON.stringify(indent)}: ${width} cols: ${line}`);
          assert.ok(line.startsWith(`${indent}${token} `), `every line carries indent and token: ${line}`);
        }
      }
    }
  }
});

test("the wrap loses no word and invents none", () => {
  const text = criticizeComment(findingFor("pass-through"), { blastRadius: 14 });
  const lines = wrapComment(text, "        ", "//");
  const back = lines.map((line) => line.replace(/^\s*\/\/ /, "")).join(" ");
  assert.equal(back, text, "the wrap moves whitespace and nothing else");
});

test("an empty text returns no lines rather than a bare comment token", () => {
  assert.deepEqual(wrapComment("", "    ", "//"), []);
  assert.deepEqual(wrapComment("   ", "    ", "//"), []);
  assert.deepEqual(wrapComment(undefined, "    ", "//"), []);
});

test("a single unbreakable word overruns its own line and no other", () => {
  const long = `a${"x".repeat(120)}z`;
  const lines = wrapComment(`${long} and a short tail`, "    ", "//");
  assert.ok(lines[0].includes(long), "the long token is not cut in half");
  for (const line of lines.slice(1)) {
    const width = [...line].length;
    assert.ok(width <= 80, `only the unbreakable line may overrun: ${line}`);
  }
});

test("a pathological indent still terminates, one token to a line", () => {
  const lines = wrapComment("alpha beta gamma", " ".repeat(200), "//");
  assert.equal(lines.length, 3, "the fill must not loop and must not merge");
});

// ---------------------------------------------------------------------------
// 7. Purity
// ---------------------------------------------------------------------------

test("the same finding produces the same bytes, twice and a hundred times", () => {
  for (const dimension of DIMENSIONS) {
    const first = criticizeComment(findingFor(dimension), { blastRadius: 3 });
    for (let n = 0; n < 100; n++) {
      assert.equal(criticizeComment(findingFor(dimension), { blastRadius: 3 }), first);
    }
  }
});

test("the module imports no host, reads no clock and draws no randomness", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "src", "core", "criticizeVoice.ts"),
    "utf8",
  );
  for (const ban of ['from "vscode"', "require(\"vscode\")", "Date.now", "new Date", "Math.random", "readFileSync", "process.env"]) {
    assert.ok(!source.includes(ban), `criticizeVoice.ts must not reach for ${ban}`);
  }
});

test("the wrap is the tighten wrapper, not a second one", () => {
  // A second greedy fill would drift from the first the day one of them learns
  // about a new token shape. Pinned at the source, because a duplicate
  // implementation passes every behavioural test in this file.
  const source = fs.readFileSync(
    path.join(__dirname, "..", "src", "core", "criticizeVoice.ts"),
    "utf8",
  );
  assert.ok(source.includes("wrapTokens"), "the fill comes from tightenRegion");
  assert.ok(source.includes("TIGHTEN_COLUMN"), "the column comes from tightenRegion");
  assert.ok(
    !/function\s+wrapTokens/.test(source),
    "criticizeVoice.ts must not define its own fill",
  );
});
