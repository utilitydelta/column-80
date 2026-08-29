// BLIND ORACLE: the explainer, and the one-way door (session-v61 phase 4).
//
// Written from `session-v61/contracts/phase4-explainer.md` ALONE, with
// `phase3-scorecard.md` for `ScorecardRow`/`Scorecard` and
// `phase1-detector-seam.md` for `DetectorFinding`/`DimensionOutcome`.
// `src/core/criticizeExplain.ts`, `src/core/criticizeScore.ts` and the
// session harness have NOT been read: they are being written as this file is
// written. Every assertion below binds to contract prose.
//
// The rule this file exists to pin, quoted from the contract: "The model never
// decides WHAT the findings are. The detectors do." If the explainer can add a
// finding, the reframe is undone. So the door gets attacked from both sides:
// from the prose map (keys nobody can reach), and from the transport (text that
// is shaped exactly like a finding).
//
// Run: SKIP_LIVE=1 node --test test/blind-v61-p4-oneway.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

// The modules may not exist yet. Bundle defensively, and star-export rather
// than name-export, so ONE missing symbol fails only the tests that use it
// instead of collapsing the whole file into a single opaque load error.
let mod = {};
let loadError;
let cleanup = () => {};
try {
  const bundled = bundleCore(
    "blind-v61-p4-oneway",
    `export * from "../src/core/criticizeExplain";
export * from "../src/core/criticizeScore";\n`,
  );
  cleanup = bundled.cleanup;
  mod = bundled.mod;
} catch (err) {
  loadError = err;
  // bundleCore writes its entry file BEFORE esbuild runs, so a resolve failure
  // leaves it behind. Expected RED until phase 4 exists; do not litter.
  const path = require("path");
  const fs = require("fs");
  cleanup = () => {
    fs.rmSync(path.join(__dirname, ".blind-v61-p4-oneway.entry.ts"), { force: true });
    fs.rmSync(path.join(__dirname, ".blind-v61-p4-oneway.bundle.cjs"), { force: true });
  };
}
test.after(() => cleanup());

/** Fetch an exported symbol, or fail this test by name. */
function need(name) {
  if (loadError) {
    throw new Error(`phase 4 modules did not load: ${loadError && loadError.message}`);
  }
  const value = mod[name];
  if (value === undefined) {
    throw new Error(`contract names \`${name}\` but it is not exported`);
  }
  return value;
}

// ---------------------------------------------------------------------------
// Fixtures. Built from the contract's type shapes only.
// ---------------------------------------------------------------------------

/** The fourteen DimensionIds of phase 1, in the card order phase 3 fixes:
 *  honesty (1-4), signature empathy (5-7), contract (8-10), altitude (11, 12,
 *  14), safety (13). */
const CARD_ORDER = [
  "clock", "prng", "env", "world",
  "adjacent-params", "bool-param", "param-count",
  "undocumented", "unenforced-precondition", "cqs",
  "pass-through", "nesting", "section-comment",
  "unadmitted-failure",
];

const GROUP_OF = {
  clock: "honesty", prng: "honesty", env: "honesty", world: "honesty",
  "adjacent-params": "signature-empathy", "bool-param": "signature-empathy",
  "param-count": "signature-empathy",
  undocumented: "contract", "unenforced-precondition": "contract", cqs: "contract",
  "pass-through": "altitude", nesting: "altitude", "section-comment": "altitude",
  "unadmitted-failure": "safety",
};

const SOURCE_CQS = "Meyer 1988, command-query separation";
const SOURCE_NESTING = "Martin 2008, one level of abstraction per function";

const finding = (dimension, line, evidence, detail) => ({
  dimension,
  line,
  evidence,
  detail,
});

const row = (over) => {
  const built = {
    dimension: over.dimension,
    title: over.title ?? `the ${over.dimension} row's fixed words`,
    group: over.group ?? GROUP_OF[over.dimension],
    source: over.source ?? `curriculum line for ${over.dimension}`,
    outcome: over.outcome ?? { state: "clean" },
    elevated: over.elevated ?? false,
  };
  if (over.blastRadius !== undefined) built.blastRadius = over.blastRadius;
  return built;
};

/** The finding every positive control speaks about. Line 14 is distinctive and
 *  does not appear as a substring of any other number in these fixtures. */
const CQS_FINDING = finding(
  "cqs",
  14,
  "self.cache.insert(key, value); return value;",
  "mutates a field and returns a value",
);

/** A SECOND real finding, on the same card. `explainFinding` must never see it. */
const NESTING_FINDING = finding(
  "nesting",
  907,
  "if let Some(inner) = maybe_inner_value_from_the_far_branch {",
  "nesting depth 6 in a body of 41 lines",
);

/** A card whose cqs row is flagged and elevated, and whose nesting row is
 *  flagged too, so a leak between findings is observable. */
function twoFindingRows() {
  return [
    row({
      dimension: "cqs",
      source: SOURCE_CQS,
      outcome: { state: "flagged", findings: [CQS_FINDING] },
      elevated: true,
    }),
    row({
      dimension: "nesting",
      source: SOURCE_NESTING,
      outcome: { state: "flagged", findings: [NESTING_FINDING] },
      elevated: true,
    }),
  ];
}

/** A full fourteen-row card: every dimension present, in the fixed order, with
 *  one flagged row, one blind row, and thirteen clean rows. */
function fullCard() {
  return CARD_ORDER.map((dimension) => {
    if (dimension === "cqs") {
      return row({
        dimension,
        source: SOURCE_CQS,
        outcome: { state: "flagged", findings: [CQS_FINDING] },
        elevated: true,
        blastRadius: 7,
      });
    }
    if (dimension === "unadmitted-failure") {
      return row({
        dimension,
        outcome: {
          state: "blind",
          reason:
            "TypeScript has no checked exceptions, so a throw the signature never admits is not a thing this language can tell you about",
        },
      });
    }
    return row({ dimension });
  });
}

// ---------------------------------------------------------------------------
// Helpers. Every one of these can report FALSE, so every assertion can fail.
// ---------------------------------------------------------------------------

function deepEquals(a, b) {
  try {
    assert.deepStrictEqual(a, b);
    return true;
  } catch {
    return false;
  }
}

const dimensionsOf = (rows) => rows.map((r) => r.dimension);
const outcomesOf = (rows) => rows.map((r) => r.outcome);
const elevatedOf = (rows) => rows.map((r) => r.elevated);
const findingCount = (rows) =>
  rows.reduce(
    (n, r) => n + (r.outcome && r.outcome.state === "flagged" ? r.outcome.findings.length : 0),
    0,
  );

/** The four invariants of contract test 5, asserted as exact values. */
function assertDoorHeld(before, after) {
  assert.strictEqual(after.length, before.length);
  assert.deepStrictEqual(dimensionsOf(after), dimensionsOf(before));
  assert.deepStrictEqual(outcomesOf(after), outcomesOf(before));
  assert.deepStrictEqual(elevatedOf(after), elevatedOf(before));
  assert.strictEqual(findingCount(after), findingCount(before));
}

/** Prose of exactly n lines, none of which resembles a finding. */
const proseOf = (n) =>
  Array.from({ length: n }, (_, i) => `explanation line ${i + 1} about the principle.`).join("\n");

// ---------------------------------------------------------------------------
// The five tests the contract names.
// ---------------------------------------------------------------------------

test("1. prose keyed to findings no detector produced changes nothing", () => {
  const attachExplanations = need("attachExplanations");
  const before = fullCard();
  const input = fullCard();

  // Every key here is plausible and every one is unreachable: real dimension
  // ids, real-looking line numbers, no detector finding underneath any of them.
  const prose = new Map([
    ["nesting:31", "the model believes this function nests six deep."],
    ["unadmitted-failure:88", "the model believes this function panics."],
    ["clock:1", "the model believes this reads the wall clock."],
    ["world:14", "same line as a real finding, wrong dimension."],
    ["prng:14", "again the real line, again the wrong dimension."],
  ]);

  const after = attachExplanations(input, prose);

  // Deep equality of the ROWS, not just the count: an unreachable entry must
  // leave no trace anywhere on the card.
  assert.deepStrictEqual(after, before);
  assertDoorHeld(before, after);
});

test("2. a prose map missing every key still yields a complete set of rows", () => {
  const attachExplanations = need("attachExplanations");
  const before = fullCard();

  const after = attachExplanations(fullCard(), new Map());

  assert.strictEqual(after.length, 14);
  assert.deepStrictEqual(dimensionsOf(after), CARD_ORDER);
  assert.deepStrictEqual(after, before);
  for (const r of after) {
    assert.strictEqual(typeof r.title, "string");
    assert.notStrictEqual(r.title, "");
    assert.strictEqual(typeof r.source, "string");
    assert.notStrictEqual(r.source, "");
  }
});

test("3. a transport that fabricates extra findings adds no row and no finding", async () => {
  const attachExplanations = need("attachExplanations");
  const explainFinding = need("explainFinding");
  const findingKey = need("findingKey");
  const MAX = need("EXPLANATION_MAX_LINES");

  // Text shaped exactly like two more findings: dimension names lifted from the
  // DimensionId union, plausible line numbers, and quoted evidence lines. Kept
  // inside the line bound on purpose, so this test proves that even prose the
  // card ACCEPTS cannot become a finding. The bound is tested separately.
  const fabricated = [
    "This violates command-query separation. Two further defects are present:",
    "nesting at line 907: `if let Some(inner) = maybe {` - nesting depth 6.",
    "unadmitted-failure at line 912: `panic!(\"unreachable\")` - panics, returns no Result.",
  ]
    .slice(0, MAX)
    .join("\n");

  const transport = async () => fabricated;
  const text = await explainFinding({ finding: CQS_FINDING, source: SOURCE_CQS }, transport);
  assert.strictEqual(typeof text, "string");

  const before = fullCard();
  const after = attachExplanations(fullCard(), new Map([[findingKey(CQS_FINDING), text]]));

  // The card gained prose, at most. It gained no row and no finding.
  assert.strictEqual(after.length, 14);
  assert.deepStrictEqual(dimensionsOf(after), CARD_ORDER);
  assert.strictEqual(findingCount(after), 1);
  assertDoorHeld(before, after);

  // And no fabricated dimension became a row of its own.
  assert.strictEqual(after.filter((r) => r.dimension === "nesting").length, 1);
  assert.strictEqual(
    after.find((r) => r.dimension === "nesting").outcome.state,
    "clean",
  );
  assert.strictEqual(
    after.find((r) => r.dimension === "unadmitted-failure").outcome.state,
    "blind",
  );
});

test("4. a transport that throws leaves the card intact and unexplained", async () => {
  const attachExplanations = need("attachExplanations");
  const explainFinding = need("explainFinding");
  const findingKey = need("findingKey");

  const boom = async () => {
    throw new Error("model unavailable: connection refused");
  };

  let resolved = null;
  let threw = false;
  try {
    resolved = await explainFinding({ finding: CQS_FINDING, source: SOURCE_CQS }, boom);
  } catch {
    threw = true;
  }

  // Either shape is a legal reading of the contract, but exactly one thing is
  // forbidden: inventing prose when the model never spoke.
  assert.strictEqual(threw || resolved === "", true);

  // The card is built from whatever survived, and is intact and unexplained.
  const prose = new Map();
  if (!threw && resolved) prose.set(findingKey(CQS_FINDING), resolved);

  const before = fullCard();
  const after = attachExplanations(fullCard(), prose);
  assert.deepStrictEqual(after, before);
  assertDoorHeld(before, after);
});

test("5. attachExplanations never moves outcome, elevated, row count or finding count", () => {
  const attachExplanations = need("attachExplanations");
  const findingKey = need("findingKey");

  const before = fullCard();
  const beforeOutcomes = outcomesOf(before);
  const beforeElevated = elevatedOf(before);
  const beforeRowCount = before.length;
  const beforeFindingCount = findingCount(before);

  // A REAL key, so prose genuinely attaches, plus unreachable ones alongside.
  const prose = new Map([
    [findingKey(CQS_FINDING), proseOf(1)],
    ["nesting:907", "prose for a finding this card's nesting row does not carry."],
    ["param-count:3", "prose for a clean row."],
  ]);

  const after = attachExplanations(fullCard(), prose);

  assert.strictEqual(after.length, beforeRowCount);
  assert.strictEqual(after.length, 14);
  assert.strictEqual(findingCount(after), beforeFindingCount);
  assert.strictEqual(findingCount(after), 1);
  assert.deepStrictEqual(outcomesOf(after), beforeOutcomes);
  assert.deepStrictEqual(elevatedOf(after), beforeElevated);
});

// ---------------------------------------------------------------------------
// Attacks beyond the five. The door is only as good as the slot it left open.
// ---------------------------------------------------------------------------

test("6. positive control: a reachable key DOES attach, so the drops above are not vacuous", () => {
  const attachExplanations = need("attachExplanations");
  const findingKey = need("findingKey");

  const before = fullCard();
  const after = attachExplanations(fullCard(), new Map([[findingKey(CQS_FINDING), proseOf(1)]]));

  // Something on the card changed, or attachExplanations is the identity
  // function and every "changes nothing" test in this file proves nothing.
  assert.strictEqual(deepEquals(after, before), false);
  // ...and whatever changed, it was not the outcome, which is where a finding
  // would have to live.
  assertDoorHeld(before, after);
});

test("7. prose over EXPLANATION_MAX_LINES is dropped, and the row stays complete", () => {
  const attachExplanations = need("attachExplanations");
  const findingKey = need("findingKey");
  const MAX = need("EXPLANATION_MAX_LINES");

  // The bound is asserted on attachExplanations, not only on explainFinding: a
  // prose map can be built by any caller, and the last gate before a row is
  // where a structural guard belongs.
  const before = fullCard();
  const after = attachExplanations(
    fullCard(),
    new Map([[findingKey(CQS_FINDING), proseOf(MAX + 1)]]),
  );

  // Dropped: the card is byte-identical to the unexplained one.
  assert.deepStrictEqual(after, before);
  // And degraded, not deleted: the row is present, complete, and still carries
  // its evidence line.
  assert.strictEqual(after.length, 14);
  const cqsRow = after.find((r) => r.dimension === "cqs");
  assert.strictEqual(cqsRow.outcome.state, "flagged");
  assert.strictEqual(cqsRow.outcome.findings.length, 1);
  assert.strictEqual(cqsRow.outcome.findings[0].evidence, CQS_FINDING.evidence);
  assert.strictEqual(cqsRow.source, SOURCE_CQS);
  assert.strictEqual(cqsRow.elevated, true);
});

test("8. prose of exactly EXPLANATION_MAX_LINES is kept: the bound is not off by one", () => {
  const attachExplanations = need("attachExplanations");
  const findingKey = need("findingKey");
  const MAX = need("EXPLANATION_MAX_LINES");

  const before = fullCard();
  const after = attachExplanations(
    fullCard(),
    new Map([[findingKey(CQS_FINDING), proseOf(MAX)]]),
  );

  assert.strictEqual(deepEquals(after, before), false);
  assertDoorHeld(before, after);
});

test("9. the over-length drop also holds end to end, through explainFinding", async () => {
  const attachExplanations = need("attachExplanations");
  const explainFinding = need("explainFinding");
  const findingKey = need("findingKey");
  const MAX = need("EXPLANATION_MAX_LINES");

  const windy = async () => proseOf(MAX + 40);
  let text = "";
  try {
    text = await explainFinding({ finding: CQS_FINDING, source: SOURCE_CQS }, windy);
  } catch {
    text = "";
  }

  const before = fullCard();
  const prose = new Map();
  if (text) prose.set(findingKey(CQS_FINDING), text);
  const after = attachExplanations(fullCard(), prose);

  assert.deepStrictEqual(after, before);
});

test("10. empty-string prose is dropped, and the row degrades to its evidence", () => {
  const attachExplanations = need("attachExplanations");
  const findingKey = need("findingKey");

  const before = fullCard();
  const after = attachExplanations(fullCard(), new Map([[findingKey(CQS_FINDING), ""]]));

  assert.deepStrictEqual(after, before);
  assert.strictEqual(after.length, 14);
  assert.strictEqual(findingCount(after), 1);
});

test("11. whitespace-only prose is dropped", () => {
  const attachExplanations = need("attachExplanations");
  const findingKey = need("findingKey");

  const before = fullCard();
  for (const blank of ["   ", "\n", "\n\n\n", "  \t \n  \t "]) {
    const after = attachExplanations(fullCard(), new Map([[findingKey(CQS_FINDING), blank]]));
    assert.deepStrictEqual(after, before);
  }
});

test("12. right dimension, wrong line: unreachable", () => {
  const attachExplanations = need("attachExplanations");

  const before = fullCard();
  // The cqs row exists and is flagged. Its ONE finding sits on line 14.
  const after = attachExplanations(
    fullCard(),
    new Map([
      ["cqs:13", "one line above the real finding."],
      ["cqs:15", "one line below the real finding."],
      ["cqs:0", "line zero, which is not a document line at all."],
      ["cqs:140", "the real line with a digit appended."],
    ]),
  );

  assert.deepStrictEqual(after, before);
  assertDoorHeld(before, after);
});

test("13. a key aimed at a clean row or a blind row is unreachable, and blind keeps its reason", () => {
  const attachExplanations = need("attachExplanations");

  const before = fullCard();
  const blindReason = before.find((r) => r.dimension === "unadmitted-failure").outcome.reason;

  const after = attachExplanations(
    fullCard(),
    new Map([
      ["unadmitted-failure:12", "the model would like to explain a panic here."],
      ["param-count:9", "the model would like to explain seven parameters here."],
    ]),
  );

  assert.deepStrictEqual(after, before);
  const blindRow = after.find((r) => r.dimension === "unadmitted-failure");
  assert.strictEqual(blindRow.outcome.state, "blind");
  assert.strictEqual(blindRow.outcome.reason, blindReason);
  assert.strictEqual(blindRow.elevated, false);
});

test("14. malformed keys are unreachable", () => {
  const attachExplanations = need("attachExplanations");

  const before = fullCard();
  const after = attachExplanations(
    fullCard(),
    new Map([
      ["cqs", "no line at all."],
      ["cqs:", "an empty line part."],
      ["cqs:14:extra", "a third segment."],
      [":14", "no dimension."],
      ["cqs:014", "a zero-padded line."],
      ["CQS:14", "the dimension in the wrong case."],
      ["cqs: 14", "a space before the line."],
      ["", "the empty key."],
    ]),
  );

  assert.deepStrictEqual(after, before);
  assertDoorHeld(before, after);
});

test("15. two map entries for one key: the last wins, and only one attachment happens", () => {
  const attachExplanations = need("attachExplanations");
  const findingKey = need("findingKey");
  const key = findingKey(CQS_FINDING);

  const duplicated = attachExplanations(
    fullCard(),
    new Map([[key, "the first explanation."], [key, "the second explanation."]]),
  );
  const single = attachExplanations(fullCard(), new Map([[key, "the second explanation."]]));

  assert.deepStrictEqual(duplicated, single);
  assertDoorHeld(fullCard(), duplicated);
  assert.strictEqual(duplicated.length, 14);
  assert.strictEqual(findingCount(duplicated), 1);
});

test("16. findingKey is `${dimension}:${line}` and is stable on unchanged bytes", () => {
  const findingKey = need("findingKey");

  assert.strictEqual(findingKey(CQS_FINDING), "cqs:14");
  assert.strictEqual(findingKey(CQS_FINDING), findingKey(CQS_FINDING));

  // A structurally identical finding, freshly built, keys the same.
  const twin = finding("cqs", 14, CQS_FINDING.evidence, CQS_FINDING.detail);
  assert.strictEqual(findingKey(twin), findingKey(CQS_FINDING));

  assert.strictEqual(findingKey(NESTING_FINDING), "nesting:907");
});

test("17. findingKey separates by line, and ignores evidence and detail", () => {
  const findingKey = need("findingKey");

  const sameLineOtherText = finding("cqs", 14, "a completely different line of code;", "other detail");
  assert.strictEqual(findingKey(sameLineOtherText), findingKey(CQS_FINDING));

  const otherLine = finding("cqs", 15, CQS_FINDING.evidence, CQS_FINDING.detail);
  assert.notStrictEqual(findingKey(otherLine), findingKey(CQS_FINDING));
  assert.strictEqual(findingKey(otherLine), "cqs:15");

  const otherDimension = finding("nesting", 14, CQS_FINDING.evidence, CQS_FINDING.detail);
  assert.notStrictEqual(findingKey(otherDimension), findingKey(CQS_FINDING));
});

test("18. explainFinding is handed exactly ONE finding: the other one never reaches the prompt", async () => {
  const explainFinding = need("explainFinding");

  const prompts = [];
  const spy = async (prompt) => {
    prompts.push(prompt);
    return "the principle exists because a reader cannot see both halves at once.";
  };

  // Both findings are on the same card. Only the cqs one is authorized.
  const card = twoFindingRows();
  assert.strictEqual(card.length, 2);

  await explainFinding({ finding: CQS_FINDING, source: SOURCE_CQS }, spy);

  assert.strictEqual(prompts.length, 1);
  const prompt = prompts[0];
  assert.strictEqual(typeof prompt, "string");

  // The authorized finding IS there.
  assert.strictEqual(prompt.includes(CQS_FINDING.evidence), true);

  // The second finding is not, in any of its parts.
  assert.strictEqual(prompt.includes(NESTING_FINDING.evidence), false);
  assert.strictEqual(prompt.includes(NESTING_FINDING.detail), false);
  assert.strictEqual(prompt.includes("907"), false);
  assert.strictEqual(prompt.includes(SOURCE_NESTING), false);
});

test("19. the prompt names the principle: it carries the dimension's source line", async () => {
  const explainFinding = need("explainFinding");

  const prompts = [];
  const spy = async (prompt) => {
    prompts.push(prompt);
    return "explained.";
  };

  await explainFinding({ finding: CQS_FINDING, source: SOURCE_CQS }, spy);

  assert.strictEqual(prompts.length, 1);
  assert.strictEqual(prompts[0].includes(SOURCE_CQS), true);
  assert.strictEqual(prompts[0].includes(String(CQS_FINDING.line)), true);
});

test("20. the transport is called exactly once per finding: no ensemble, no retry-for-agreement", async () => {
  const explainFinding = need("explainFinding");

  let calls = 0;
  const counting = async () => {
    calls += 1;
    return "explained.";
  };

  await explainFinding({ finding: CQS_FINDING, source: SOURCE_CQS }, counting);
  assert.strictEqual(calls, 1);

  await explainFinding({ finding: NESTING_FINDING, source: SOURCE_NESTING }, counting);
  assert.strictEqual(calls, 2);
});

test("21. attachExplanations does not mutate the rows it was given", () => {
  const attachExplanations = need("attachExplanations");
  const findingKey = need("findingKey");

  const input = fullCard();
  const snapshot = structuredClone(input);

  attachExplanations(input, new Map([[findingKey(CQS_FINDING), proseOf(1)]]));

  assert.deepStrictEqual(input, snapshot);
});

test("22. degradation is a shipped state: no transport at all, and the card is still complete", () => {
  const attachExplanations = need("attachExplanations");

  // No transport is constructed, no model is asked, the prose map is empty.
  // This is what ships when the tier gate is closed or the explainer is cut.
  const before = fullCard();
  const after = attachExplanations(fullCard(), new Map());

  assert.strictEqual(after.length, 14);
  assert.deepStrictEqual(dimensionsOf(after), CARD_ORDER);
  assert.strictEqual(new Set(dimensionsOf(after)).size, 14);
  assert.deepStrictEqual(after, before);

  for (const r of after) {
    assert.notStrictEqual(r.title, "");
    assert.notStrictEqual(r.source, "");
    assert.strictEqual(typeof r.elevated, "boolean");
    assert.strictEqual(
      ["clean", "flagged", "blind"].includes(r.outcome.state),
      true,
    );
  }
  const flagged = after.filter((r) => r.outcome.state === "flagged");
  assert.strictEqual(flagged.length, 1);
  assert.strictEqual(flagged[0].outcome.findings[0].evidence, CQS_FINDING.evidence);
  assert.strictEqual(after.find((r) => r.dimension === "cqs").blastRadius, 7);
});

test("23. attaching prose never elevates a held dimension", () => {
  const attachExplanations = need("attachExplanations");
  const findingKey = need("findingKey");
  const policy = need("DEFAULT_ELEVATION");

  // Phase 3 holds dimension 14 pending a human ruling.
  assert.strictEqual(Array.isArray(policy.held), true);
  assert.strictEqual(policy.held.includes("section-comment"), true);

  const held = policy.held[0];
  const heldFinding = finding(held, 22, "// ---- helpers ----", "a section comment inside the body");
  const input = [
    row({
      dimension: held,
      outcome: { state: "flagged", findings: [heldFinding] },
      elevated: false,
    }),
  ];

  const after = attachExplanations(input, new Map([[findingKey(heldFinding), proseOf(1)]]));

  assert.strictEqual(after.length, 1);
  assert.strictEqual(after[0].elevated, false);
  assert.deepStrictEqual(after[0].outcome, input[0].outcome);
});

test("24. EXPLANATION_MAX_LINES is an exported, chosen, positive integer", () => {
  const MAX = need("EXPLANATION_MAX_LINES");
  assert.strictEqual(typeof MAX, "number");
  assert.strictEqual(Number.isInteger(MAX), true);
  assert.strictEqual(MAX >= 1, true);
  // A bound that admits a page is not a bound. The contract's purpose is to stop
  // a paragraph that CLAIMS a second defect.
  assert.strictEqual(MAX <= 20, true);
});
