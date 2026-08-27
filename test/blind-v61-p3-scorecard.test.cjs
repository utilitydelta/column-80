// BLIND ORACLE: the scorecard, its elevation policy, and its renderer
// (session-v61 phase 3).
//
// Written from `session-v61/contracts/phase3-scorecard.md` alone, with
// `phase1-detector-seam.md` for `DimensionId` / `DimensionOutcome` /
// `DetectorFinding` and `phase2-rubric-dimensions.md` for the fifteen
// dimensions and which one ships held. `src/core/criticizeScore.ts` and
// `src/core/criticizeRender.ts` have NOT been read: they are being written by
// other agents while this file is authored. No stub is provided for them.
//
// Expected RED with a module-resolution failure until phase 3 exists.
//
// Run: SKIP_LIVE=1 node --test test/blind-v61-p3-scorecard.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

// ---------------------------------------------------------------------------
// Bundle. Defensive, so each contract rule reports as its own failing test
// rather than one opaque load error.
// ---------------------------------------------------------------------------

let mod = null;
let loadError = null;
let cleanup = () => {};
try {
  const bundled = bundleCore(
    "blind-v61-p3-scorecard",
    `export * from "../src/core/criticizeScore";
export * from "../src/core/criticizeRender";\n`,
  );
  cleanup = bundled.cleanup;
  mod = bundled.mod;
} catch (err) {
  loadError = err;
  // bundleCore writes its entry file BEFORE esbuild runs, so a failed build
  // leaves one behind and its cleanup closure was never returned.
  try {
    require("fs").rmSync(
      require("path").join(__dirname, ".blind-v61-p3-scorecard.entry.ts"),
      { force: true },
    );
  } catch {
    /* nothing to remove */
  }
}

// The phase-1 language registry, bundled SEPARATELY so a failure here cannot
// be mistaken for a phase-3 failure. Only used to feed the assembly entry
// point when it turns out to want a language profile.
let criticizeLangFor = null;
let cleanupLang = () => {};
try {
  const bundledLang = bundleCore(
    "blind-v61-p3-lang",
    `export { criticizeLangFor } from "../src/core/criticizeLang";\n`,
  );
  cleanupLang = bundledLang.cleanup;
  criticizeLangFor = bundledLang.mod.criticizeLangFor;
} catch {
  criticizeLangFor = null;
}

test.after(() => {
  cleanup();
  cleanupLang();
});

function requireModule() {
  if (mod === null) {
    throw new Error(
      `phase 3 modules did not load: ${loadError && loadError.message}`,
    );
  }
  return mod;
}

function renderScorecard(card, policy) {
  const m = requireModule();
  assert.strictEqual(
    typeof m.renderScorecard,
    "function",
    "contract §'Two reading depths' exports renderScorecard(card, policy): string",
  );
  const out = m.renderScorecard(card, policy);
  assert.strictEqual(typeof out, "string", "renderScorecard returns a string");
  return out;
}

function defaultElevation() {
  const m = requireModule();
  assert.ok(
    m.DEFAULT_ELEVATION && Array.isArray(m.DEFAULT_ELEVATION.held),
    "contract exports DEFAULT_ELEVATION with a readonly held array",
  );
  return m.DEFAULT_ELEVATION;
}

// ---------------------------------------------------------------------------
// The rubric, from phase 2 and from phase 3's "Order is fixed" paragraph.
// honesty (1-4), signature empathy (5-8), contract (9-11), altitude (12,13,15),
// safety (14).
// ---------------------------------------------------------------------------

const DIMS = [
  "clock",
  "prng",
  "env",
  "world",
  "adjacent-params",
  "bool-param",
  "unused-param",
  "param-count",
  "undocumented",
  "unenforced-precondition",
  "cqs",
  "pass-through",
  "nesting",
  "section-comment",
  "unadmitted-failure",
];

const GROUP_OF = {
  clock: "honesty",
  prng: "honesty",
  env: "honesty",
  world: "honesty",
  "adjacent-params": "signature-empathy",
  "bool-param": "signature-empathy",
  "unused-param": "signature-empathy",
  "param-count": "signature-empathy",
  undocumented: "contract",
  "unenforced-precondition": "contract",
  cqs: "contract",
  "pass-through": "altitude",
  nesting: "altitude",
  "section-comment": "altitude",
  "unadmitted-failure": "safety",
};

const GROUP_SEQUENCE = DIMS.map((d) => GROUP_OF[d]);

// Phase 3 §'Blast radius': true where the honest fix changes the signature.
const SIGNATURE_LEVEL = {
  clock: true,
  prng: true,
  env: true,
  world: true,
  "adjacent-params": true,
  "bool-param": true,
  "unused-param": true,
  "param-count": true,
  "unadmitted-failure": true,
  nesting: false,
  "section-comment": false,
  "pass-through": false,
  cqs: false,
  undocumented: false,
  "unenforced-precondition": false,
};

// ---------------------------------------------------------------------------
// Hand-built card fixtures. Every string is a sentinel so a render assertion
// pins THAT row's text and cannot pass on some other row's words. Line numbers
// start at 5301 so that no line number contains "14" or a bare zero: the blast
// radius assertions below turn on exactly those two tokens.
// ---------------------------------------------------------------------------

const lineOf = (dim) => 5301 + DIMS.indexOf(dim);
const sourceOf = (dim) => `Curriculum lineage srcmark ${dim.toUpperCase()} 1971`;
const titleOf = (dim) => `the dimension's own words for ${dim}`;
const evidenceOf = (dim) => `evidmark_${dim.replace(/-/g, "_")}_token()`;
const reasonOf = (dim) =>
  `blindmark ${dim}: this language cannot answer that question, so it refuses by name`;

const flagged = (dim) => ({
  state: "flagged",
  findings: [
    {
      dimension: dim,
      line: lineOf(dim),
      evidence: evidenceOf(dim),
      detail: `${dim} fired`,
    },
  ],
});

const blind = (dim) => ({ state: "blind", reason: reasonOf(dim) });
const clean = () => ({ state: "clean" });

function heldByDefault(dim) {
  return defaultElevation().held.includes(dim);
}

/** A row. `elevated` defaults to what DEFAULT_ELEVATION would say, which is
 *  deliberately STALE when the card is rendered under a different policy: the
 *  contract says the renderer reads the policy. */
function makeRow(dim, outcome, over = {}) {
  const row = {
    dimension: dim,
    title: titleOf(dim),
    group: GROUP_OF[dim],
    source: sourceOf(dim),
    outcome,
    elevated:
      "elevated" in over
        ? over.elevated
        : outcome.state === "flagged" && !heldByDefault(dim),
  };
  if (over.blastRadius !== undefined) row.blastRadius = over.blastRadius;
  return row;
}

/** A full fifteen-row card. `spec` maps a dimension to an outcome; anything
 *  unnamed is clean. `blast` maps a dimension to a blastRadius. */
function makeCard(spec = {}, over = {}) {
  return {
    name: over.name ?? "target_fn",
    languageId: over.languageId ?? "rust",
    headLine: over.headLine ?? 5300,
    rows: DIMS.map((d) =>
      makeRow(d, spec[d] ?? clean(), {
        ...(over.blast && d in over.blast
          ? { blastRadius: over.blast[d] }
          : {}),
      }),
    ),
  };
}

const ALL_HELD = { held: DIMS.slice() };
const NONE_HELD = { held: [] };

// ---------------------------------------------------------------------------
// FunctionUnderReview fixtures, shaped by phase 1. Built FRESH on every call so
// the determinism test compares two independent inputs.
// ---------------------------------------------------------------------------

/** Rust, and as close to perfect as the fifteen dimensions allow: documented,
 *  two differently-typed used parameters, one flat expression, no clock, no
 *  panic, no section comment. */
const cleanRustFn = () => ({
  languageId: "rust",
  name: "scale",
  lines: [
    "/// Scales a count by a factor.",
    "pub fn scale(count: i64, factor: f64) -> f64 {",
    "    (count as f64) * factor",
    "}",
  ],
  startLine: 120,
  headIndex: 1,
  bodyIndex: 2,
});

/** Python with an unannotated signature: phase 2 makes dimensions 5 and 6
 *  blind there, so this card carries several blind rows. */
const blindPythonFn = () => ({
  languageId: "python",
  name: "apply_rule",
  lines: [
    "def apply_rule(alpha, beta, flag):",
    '    """Applies the rule."""',
    "    return alpha + beta",
  ],
  startLine: 40,
  headIndex: 0,
  bodyIndex: 2,
});

/** TypeScript, where dimension 14 is ALWAYS blind by phase 2's table. */
const tsFn = () => ({
  languageId: "typescript",
  name: "widen",
  lines: [
    "/** Widens a span by one column. */",
    "export function widen(span: Span, columns: number): Span {",
    "  return { start: span.start, end: span.end + columns };",
    "}",
  ],
  startLine: 88,
  headIndex: 1,
  bodyIndex: 2,
});

/** Rust with a lone section comment inside the body, which is dimension 15. */
const sectionCommentRustFn = () => ({
  languageId: "rust",
  name: "run_thing",
  lines: [
    "/// Runs the thing.",
    "pub fn run_thing(name: &str) -> usize {",
    "    // gather the inputs",
    "    let n = name.len();",
    "    n",
    "}",
  ],
  startLine: 200,
  headIndex: 1,
  bodyIndex: 2,
});

// ---------------------------------------------------------------------------
// Assembly entry point. The contract names the MODULE (`criticizeScore.ts`,
// "assembly") but never names the function or its arity, so it is discovered
// by behaviour: the first export that, given a FunctionUnderReview, hands back
// an object carrying a `rows` array. The argument shape is resolved ONCE and
// reused, so every card in this file is built the same way.
// ---------------------------------------------------------------------------

let scorerChoice = undefined;

function isCardish(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    Array.isArray(value.rows) &&
    value.rows.length > 0 &&
    typeof value.rows[0] === "object" &&
    value.rows[0] !== null &&
    typeof value.rows[0].dimension === "string"
  );
}

function argShapes(fn, policy) {
  const lang = criticizeLangFor ? criticizeLangFor(fn.languageId) : undefined;
  return [
    ["fn", [fn]],
    ["fn,policy", [fn, policy]],
    ["fn,lang", [fn, lang]],
    ["fn,lang,policy", [fn, lang, policy]],
  ];
}

function resolveScorer() {
  if (scorerChoice !== undefined) return scorerChoice;
  const m = requireModule();
  const probe = cleanRustFn();
  const policy = defaultElevation();
  const names = Object.keys(m).filter((k) => typeof m[k] === "function");
  const ranked = [
    ...names.filter((n) => /score|card|rubric|criticize/i.test(n)),
    ...names.filter((n) => !/score|card|rubric|criticize/i.test(n)),
  ];
  for (const name of ranked) {
    for (const [shape, args] of argShapes(probe, policy)) {
      let out;
      try {
        out = m[name](...args);
      } catch {
        continue;
      }
      if (isCardish(out)) {
        scorerChoice = { name, shape };
        return scorerChoice;
      }
    }
  }
  scorerChoice = null;
  throw new Error(
    `no export of criticizeScore assembled a Scorecard from a FunctionUnderReview. exports seen: ${names.join(", ")}`,
  );
}

/** Score a function into a Scorecard. */
function score(fn, policy) {
  const m = requireModule();
  const choice = resolveScorer();
  const wanted = policy ?? defaultElevation();
  const shapes = argShapes(fn, wanted);
  const entry = shapes.find(([shape]) => shape === choice.shape);
  const out = m[choice.name](...entry[1]);
  assert.ok(
    isCardish(out),
    `${choice.name} must assemble a Scorecard for ${fn.languageId} ${fn.name}`,
  );
  return out;
}

function rowFor(card, dim) {
  const row = card.rows.find((r) => r.dimension === dim);
  assert.ok(row, `every card carries a row for ${dim}`);
  return row;
}

const dimensionsOf = (card) => card.rows.map((r) => r.dimension);

// The honest contract sentence, from the goal's ruled wording.
const CONTRACT_TAIL = "does not certify correctness";
const RULED_EMPTY = "this pass found nothing above the evidence bar";

function assertEndsWithContractSentence(out, where) {
  const lines = out.trimEnd().split("\n");
  const last = lines[lines.length - 1].toLowerCase();
  assert.ok(
    last.includes(CONTRACT_TAIL),
    `${where}: the card's last line must be the honest contract sentence, got: ${lines[lines.length - 1]}`,
  );
  const lower = out.toLowerCase();
  assert.ok(
    lower.includes("oracles can witness"),
    `${where}: the contract sentence names what the repo's oracles can witness`,
  );
}

// ===========================================================================
// Determinism and completeness
// ===========================================================================

test("the same function scored TWICE renders BYTE-IDENTICAL output [P3 §'What a scorecard is']", () => {
  const policy = defaultElevation();
  const a = renderScorecard(score(cleanRustFn(), policy), policy);
  const b = renderScorecard(score(cleanRustFn(), policy), policy);
  assert.strictEqual(a, b, "unchanged bytes must produce an unchanged card");
});

test("the same function scored TWICE produces structurally identical cards [P3 §'What a scorecard is']", () => {
  const policy = defaultElevation();
  const a = score(sectionCommentRustFn(), policy);
  const b = score(sectionCommentRustFn(), policy);
  assert.deepStrictEqual(a, b, "the finding set is a rubric answer, not a run");
});

test("a PERFECTLY CLEAN function still carries exactly 15 rows in the fixed order [P3 §'What a scorecard is']", () => {
  const card = score(cleanRustFn(), defaultElevation());
  assert.strictEqual(card.rows.length, 15, "every dimension appears on every card");
  assert.deepStrictEqual(dimensionsOf(card), DIMS);
});

test("a language BLIND on several dimensions still carries exactly 15 rows in the fixed order [P3 §'What a scorecard is']", () => {
  const card = score(blindPythonFn(), defaultElevation());
  assert.strictEqual(card.rows.length, 15);
  assert.deepStrictEqual(dimensionsOf(card), DIMS);
});

test("TypeScript, blind on dimension 14 by construction, still carries exactly 15 rows [P3 §'What a scorecard is']", () => {
  const card = score(tsFn(), defaultElevation());
  assert.strictEqual(card.rows.length, 15);
  assert.deepStrictEqual(dimensionsOf(card), DIMS);
});

test("group order is honesty, signature-empathy, contract, altitude, safety [P3 §'Order is fixed']", () => {
  const card = score(cleanRustFn(), defaultElevation());
  assert.deepStrictEqual(card.rows.map((r) => r.group), GROUP_SEQUENCE);
  assert.deepStrictEqual(
    card.rows.slice(0, 4).map((r) => r.dimension),
    ["clock", "prng", "env", "world"],
  );
  assert.deepStrictEqual(
    card.rows.slice(11, 14).map((r) => r.dimension),
    ["pass-through", "nesting", "section-comment"],
  );
  assert.strictEqual(card.rows[14].dimension, "unadmitted-failure");
  assert.strictEqual(card.rows[14].group, "safety");
});

test("every row carries a non-empty title and a non-empty source line [P3 ScorecardRow]", () => {
  const card = score(cleanRustFn(), defaultElevation());
  for (const row of card.rows) {
    assert.strictEqual(typeof row.title, "string", `${row.dimension} title is a string`);
    assert.notStrictEqual(row.title.trim(), "", `${row.dimension} title is never empty`);
    assert.strictEqual(typeof row.source, "string", `${row.dimension} source is a string`);
    assert.notStrictEqual(row.source.trim(), "", `${row.dimension} source is never empty`);
  }
});

// ===========================================================================
// Elevation
// ===========================================================================

test("a CLEAN row is never elevated [P3 §'Elevation']", () => {
  const card = score(cleanRustFn(), defaultElevation());
  const cleanRows = card.rows.filter((r) => r.outcome.state === "clean");
  assert.notStrictEqual(cleanRows.length, 0, "the clean fixture must produce clean rows");
  for (const row of cleanRows) {
    assert.strictEqual(row.elevated, false, `${row.dimension}: clean is not a finding`);
  }
});

test("a BLIND row is never elevated, and Python's unannotated signature is blind on 5 and 6 [P3 §'Elevation', P2 §5/§6]", () => {
  const card = score(blindPythonFn(), defaultElevation());
  assert.strictEqual(rowFor(card, "adjacent-params").outcome.state, "blind");
  assert.strictEqual(rowFor(card, "bool-param").outcome.state, "blind");
  const blindRows = card.rows.filter((r) => r.outcome.state === "blind");
  assert.ok(blindRows.length >= 2, "the fixture must carry several blind rows");
  for (const row of blindRows) {
    assert.strictEqual(row.elevated, false, `${row.dimension}: a refusal is not a finding`);
    assert.strictEqual(typeof row.outcome.reason, "string");
    assert.notStrictEqual(row.outcome.reason.trim(), "", `${row.dimension}: blind carries a reason`);
  }
});

test("TypeScript's dimension 14 is blind and unelevated [P3 §'Elevation', P2 §14]", () => {
  const card = score(tsFn(), defaultElevation());
  const row = rowFor(card, "unadmitted-failure");
  assert.strictEqual(row.outcome.state, "blind");
  assert.strictEqual(row.elevated, false);
});

test("section-comment ships SCORED but NOT ELEVATED by DEFAULT_ELEVATION [P3 §'Elevation', P2 §15]", () => {
  assert.ok(
    defaultElevation().held.includes("section-comment"),
    "DEFAULT_ELEVATION.held names section-comment, the 31.0% dimension",
  );
  const card = score(sectionCommentRustFn(), defaultElevation());
  const row = rowFor(card, "section-comment");
  assert.strictEqual(row.outcome.state, "flagged", "the detector still SCORES it");
  assert.strictEqual(row.elevated, false, "held means scored and not elevated");
});

test("DEFAULT_ELEVATION holds section-comment and NOTHING else [P3 §'Elevation']", () => {
  assert.deepStrictEqual(defaultElevation().held.slice(), ["section-comment"]);
});

test("removing section-comment from held is the ONLY change needed to elevate it [P3 §'Elevation']", () => {
  const card = makeCard({ "section-comment": flagged("section-comment") });
  const withDefault = renderScorecard(card, defaultElevation());
  assert.ok(
    !withDefault.includes(evidenceOf("section-comment")),
    "held: the row's evidence is not read first",
  );
  assert.ok(
    withDefault.toLowerCase().includes(RULED_EMPTY),
    "held: with nothing else flagged the card says it found nothing above the bar",
  );

  const sameCard = makeCard({ "section-comment": flagged("section-comment") });
  const withRuling = renderScorecard(sameCard, NONE_HELD);
  assert.ok(
    withRuling.includes(evidenceOf("section-comment")),
    "one array entry, not a rebuild: the row is now above the bar",
  );
  assert.ok(
    !withRuling.toLowerCase().includes(RULED_EMPTY),
    "a card with an elevated row does not claim it found nothing",
  );
});

test("the renderer hard-codes NO dimension id: hold nesting instead and the two rows swap [P3 §'Elevation']", () => {
  const spec = {
    "section-comment": flagged("section-comment"),
    nesting: flagged("nesting"),
  };
  const underDefault = renderScorecard(makeCard(spec), defaultElevation());
  assert.ok(underDefault.includes(evidenceOf("nesting")), "nesting is not held by default");
  assert.ok(!underDefault.includes(evidenceOf("section-comment")), "section-comment is held by default");

  const underSwap = renderScorecard(makeCard(spec), { held: ["nesting"] });
  assert.ok(
    !underSwap.includes(evidenceOf("nesting")),
    "the policy, not the id, decides: nesting is now held",
  );
  assert.ok(
    underSwap.includes(evidenceOf("section-comment")),
    "the policy, not the id, decides: section-comment is now elevated",
  );
});

test("flagged AND not held is the WHOLE elevation rule [P3 §'Elevation']", () => {
  const spec = {
    clock: flagged("clock"),
    cqs: flagged("cqs"),
    "section-comment": flagged("section-comment"),
    world: blind("world"),
    nesting: blind("nesting"),
  };
  const nothingHeld = renderScorecard(makeCard(spec), NONE_HELD);
  for (const dim of ["clock", "cqs", "section-comment"]) {
    assert.ok(nothingHeld.includes(evidenceOf(dim)), `${dim}: flagged and not held is elevated`);
  }

  const everythingHeld = renderScorecard(makeCard(spec), ALL_HELD);
  for (const dim of ["clock", "cqs", "section-comment"]) {
    assert.ok(
      !everythingHeld.includes(evidenceOf(dim)),
      `${dim}: held is never elevated however loudly it fired`,
    );
  }
  assert.ok(
    everythingHeld.toLowerCase().includes(RULED_EMPTY),
    "three flagged rows all held leaves nothing above the bar",
  );
});

// ===========================================================================
// No composite score
// ===========================================================================

test("no exported function returns a NUMBER when handed a card [P3 §'No composite score']", () => {
  const m = requireModule();
  const card = makeCard({ clock: flagged("clock"), cqs: flagged("cqs") });
  const policy = defaultElevation();
  const names = Object.keys(m).filter((k) => typeof m[k] === "function");
  assert.notStrictEqual(names.length, 0, "the two modules export at least one function");
  for (const name of names) {
    for (const args of [[card], [card, policy]]) {
      let out;
      try {
        out = m[name](...args);
      } catch {
        continue;
      }
      assert.notStrictEqual(
        typeof out,
        "number",
        `${name}() returned a number for a card: a grade is a thing to optimise against`,
      );
    }
  }
});

test("no exported VALUE is a bare numeric quality constant [P3 §'No composite score']", () => {
  const m = requireModule();
  for (const [name, value] of Object.entries(m)) {
    if (typeof value !== "number") continue;
    assert.fail(`${name} is an exported number: phase 3 has no quality scalar`);
  }
});

test("the Scorecard object carries NO numeric summary field [P3 §'No composite score']", () => {
  const card = score(cleanRustFn(), defaultElevation());
  for (const banned of ["score", "grade", "total", "rating", "points"]) {
    assert.strictEqual(
      banned in card,
      false,
      `Scorecard.${banned} would be the grade the contract refuses`,
    );
  }
  const numericKeys = Object.keys(card).filter((k) => typeof card[k] === "number");
  assert.deepStrictEqual(numericKeys, ["headLine"], "headLine is the only number on a card");
});

test("no ScorecardRow carries a numeric summary field [P3 §'No composite score']", () => {
  const card = score(sectionCommentRustFn(), defaultElevation());
  for (const row of card.rows) {
    for (const banned of ["score", "grade", "total", "rating", "points"]) {
      assert.strictEqual(
        banned in row,
        false,
        `${row.dimension}.${banned}: a row is a state, not a number`,
      );
    }
  }
});

// ===========================================================================
// Rendering
// ===========================================================================

test("a card with ZERO elevated rows says it found nothing above the evidence bar [P3 §'Two reading depths']", () => {
  const out = renderScorecard(makeCard(), defaultElevation());
  assert.ok(
    out.toLowerCase().includes(RULED_EMPTY),
    `the ruled wording is a constant, got: ${out}`,
  );
});

test("a card with ZERO elevated rows never delivers a verdict of clean or correct [P3 §'Two reading depths']", () => {
  const out = renderScorecard(makeCard(), defaultElevation()).toLowerCase();
  const verdicts = [
    "is clean",
    "looks clean",
    "all clean",
    "everything clean",
    "is correct",
    "looks correct",
    "appears correct",
    "verified correct",
    "no problems",
    "nothing wrong",
    "all good",
  ];
  for (const phrase of verdicts) {
    assert.strictEqual(
      out.includes(phrase),
      false,
      `"${phrase}" is a verdict on the function, which this pass never delivers`,
    );
  }
});

test("EVERY rendered card ends with the honest contract sentence [P3 §'Two reading depths']", () => {
  assertEndsWithContractSentence(
    renderScorecard(makeCard(), defaultElevation()),
    "empty card",
  );
  assertEndsWithContractSentence(
    renderScorecard(makeCard({ clock: flagged("clock") }), NONE_HELD),
    "flagged card",
  );
  assertEndsWithContractSentence(
    renderScorecard(makeCard({ world: blind("world") }), defaultElevation()),
    "blind card",
  );
  assertEndsWithContractSentence(
    renderScorecard(score(blindPythonFn(), defaultElevation()), defaultElevation()),
    "assembled python card",
  );
});

test("an ELEVATED row renders its source, the curriculum line [P3 §'Two reading depths']", () => {
  const out = renderScorecard(makeCard({ cqs: flagged("cqs") }), NONE_HELD);
  assert.ok(
    out.includes(sourceOf("cqs")),
    `naming the principle is the product, got: ${out}`,
  );
  assert.ok(out.includes(titleOf("cqs")), "an elevated row renders its title");
});

test("an ELEVATED row renders one evidence line per finding, quoting the line and its document line number [P3 §'Two reading depths']", () => {
  const card = makeCard();
  const row = card.rows.find((r) => r.dimension === "clock");
  row.outcome = {
    state: "flagged",
    findings: [
      { dimension: "clock", line: 5301, evidence: "let t = Instant::now();", detail: "reads the wall clock" },
      { dimension: "clock", line: 5309, evidence: "let u = SystemTime::now();", detail: "reads the wall clock" },
    ],
  };
  row.elevated = true;
  const out = renderScorecard(card, NONE_HELD);
  assert.ok(out.includes("let t = Instant::now();"), "the evidence is the line itself");
  assert.ok(out.includes("let u = SystemTime::now();"), "one evidence line PER finding");
  assert.ok(out.includes("5301"), "the finding carries its document line number");
  assert.ok(out.includes("5309"), "the second finding carries its own line number");
});

test("a BLIND row renders its reason [P3 §'Two reading depths']", () => {
  const out = renderScorecard(makeCard({ world: blind("world") }), defaultElevation());
  assert.ok(
    out.includes(reasonOf("world")),
    `a refusal names the language and the cause, got: ${out}`,
  );
});

test("the renderer never prints a fix, a patch, or a rewritten function [P3 §'Two reading depths']", () => {
  const spec = {
    clock: flagged("clock"),
    "unadmitted-failure": flagged("unadmitted-failure"),
    "section-comment": flagged("section-comment"),
    world: blind("world"),
  };
  const out = renderScorecard(makeCard(spec, { blast: { clock: 14 } }), NONE_HELD);
  for (const line of out.split("\n")) {
    // Diff position: a leading + or - hard against a token. A markdown bullet
    // ("- clock: clean") is not a patch and is not caught here.
    assert.strictEqual(
      /^[+-][^\s+-]/.test(line),
      false,
      `a diff-shaped line is a patch: ${line}`,
    );
    assert.strictEqual(/^(\+\+\+|---)\s/.test(line), false, `a diff header is a patch: ${line}`);
  }
  const lower = out.toLowerCase();
  for (const phrase of ["replace with", "change to", "rewrite"]) {
    assert.strictEqual(lower.includes(phrase), false, `"${phrase}" prescribes a fix; this is ADVISE only`);
  }
});

// ===========================================================================
// Blast radius
// ===========================================================================

test("signatureLevel is true for the nine signature dimensions and false for the six body-local ones [P3 §'Blast radius']", () => {
  const m = requireModule();
  assert.strictEqual(typeof m.signatureLevel, "function", "criticizeScore exports signatureLevel");
  for (const dim of DIMS) {
    assert.strictEqual(
      m.signatureLevel(dim),
      SIGNATURE_LEVEL[dim],
      `signatureLevel(${dim}) must be ${SIGNATURE_LEVEL[dim]}`,
    );
  }
  const trueCount = DIMS.filter((d) => m.signatureLevel(d)).length;
  assert.strictEqual(trueCount, 9, "nine dimensions change the signature");
});

test("blastRadius UNDEFINED renders NOTHING about call sites, and never a zero [P3 §'Blast radius']", () => {
  const card = makeCard({ clock: flagged("clock") });
  assert.strictEqual(
    "blastRadius" in card.rows[0],
    false,
    "the fixture's clock row must genuinely omit the count",
  );
  const out = renderScorecard(card, NONE_HELD);
  assert.strictEqual(
    out.includes("0 call sites"),
    false,
    "a missing count is not a zero: the walk never made that claim",
  );
  assert.strictEqual(
    /call sites?/i.test(out),
    false,
    `no count means no call-site sentence at all, got: ${out}`,
  );
});

test("blastRadius 14 renders the count [P3 §'Blast radius']", () => {
  const out = renderScorecard(
    makeCard({ clock: flagged("clock") }, { blast: { clock: 14 } }),
    NONE_HELD,
  );
  assert.ok(/call sites?/i.test(out), "a present count renders as call sites");
  const near = out
    .split("\n")
    .some((l) => /14[^\n]{0,60}call sites?/i.test(l) || /call sites?[^\n]{0,60}14/i.test(l));
  assert.ok(near, `the count 14 must render beside the call-site wording, got: ${out}`);
  assert.strictEqual(out.includes("0 call sites"), false, "and never a zero");
});
