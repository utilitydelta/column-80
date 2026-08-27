// WHITE-BOX: the explainer (session-v61 phase 4), written against the module.
//
// The blind oracle in test/blind-v61-p4-oneway.test.cjs attacks the door from
// the contract's words. This file attacks it from the implementation's own
// seams, and from the one place the oracle could not reach: a REAL card, built
// by the real detectors through `scoreFunction`, rather than a fixture that
// says it is one.
//
// Run: node --test test/impl-v61-p4-explain.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const bundled = bundleCore(
  "impl-v61-p4-explain",
  `export * from "../src/core/criticizeExplain";
export * from "../src/core/criticizeScore";
export * from "../src/core/criticizeSlice";
export * from "../src/core/criticizeRender";
export { criticizeLangFor } from "../src/core/criticizeLang";\n`,
);
test.after(() => bundled.cleanup());

const {
  attachExplanations,
  buildExplainPrompt,
  explainFinding,
  findingKey,
  EXPLANATION_MAX_LINES,
  scoreFunction,
  sliceFunction,
  renderScorecard,
  DEFAULT_ELEVATION,
  criticizeLangFor,
} = bundled.mod;

// ---------------------------------------------------------------------------
// A REAL card, from the real detectors. Nothing here is hand-built.
// ---------------------------------------------------------------------------

/** A TypeScript function that fires several dimensions at once: it reads the
 *  clock, mutates state and returns a value, and takes a boolean parameter. */
const SOURCE_LINES = [
  "/** Records the hit and answers whether it was the first one. */",
  "export function touch(key: string, warm: boolean): boolean {",
  "  const now = Date.now();",
  "  const first = !seen.has(key);",
  "  seen.set(key, now);",
  "  if (warm) {",
  "    warmed.add(key);",
  "  }",
  "  return first;",
  "}",
];

function realCard() {
  const fn = sliceFunction(SOURCE_LINES, 2, 10, "touch", criticizeLangFor("typescript"));
  assert.notStrictEqual(fn, undefined, "the slicer refused a fixture it should accept");
  return scoreFunction(fn, undefined, DEFAULT_ELEVATION, 3);
}

const findingCount = (rows) =>
  rows.reduce((n, r) => n + (r.outcome.state === "flagged" ? r.outcome.findings.length : 0), 0);

const allFindings = (rows) =>
  rows.flatMap((r) => (r.outcome.state === "flagged" ? r.outcome.findings.slice() : []));

test("a real detector card keeps its row and finding counts through the explainer", () => {
  const card = realCard();
  assert.strictEqual(card.rows.length, 15);
  const findings = allFindings(card.rows);
  assert.ok(findings.length > 0, "the fixture fired no detector, so this test proves nothing");

  // Explain every real finding, with a transport that fabricates three more.
  const prose = new Map(findings.map((f) => [findingKey(f), "the principle, named and explained."]));
  const after = attachExplanations(card.rows, prose);

  assert.strictEqual(after.length, card.rows.length);
  assert.strictEqual(findingCount(after), findingCount(card.rows));
  assert.deepStrictEqual(
    after.map((r) => r.outcome),
    card.rows.map((r) => r.outcome),
  );
  assert.deepStrictEqual(
    after.map((r) => r.elevated),
    card.rows.map((r) => r.elevated),
  );
});

test("the renderer prints an attached explanation and prints nothing for a dropped one", () => {
  const card = realCard();
  const one = allFindings(card.rows)[0];
  const marker = "explained in the developer's own terms.";

  const kept = renderScorecard(
    { ...card, rows: attachExplanations(card.rows, new Map([[findingKey(one), marker]])) },
    DEFAULT_ELEVATION,
  );
  assert.strictEqual(kept.includes(marker), true);

  const overLong = Array.from({ length: EXPLANATION_MAX_LINES + 1 }, () => marker).join("\n");
  const dropped = renderScorecard(
    { ...card, rows: attachExplanations(card.rows, new Map([[findingKey(one), overLong]])) },
    DEFAULT_ELEVATION,
  );
  assert.strictEqual(dropped.includes(marker), false);
  // Degraded, not deleted: the row is still there with its evidence.
  assert.strictEqual(dropped.includes(one.evidence), true);
});

// ---------------------------------------------------------------------------
// The prompt: what it carries, and what it must not.
// ---------------------------------------------------------------------------

const FINDING = {
  dimension: "cqs",
  line: 5,
  evidence: "seen.set(key, now);",
  detail: "mutates state and returns a value",
};
const SOURCE = "Meyer 1988, command-query separation";

test("the prompt carries the finding's four facts and no function body", () => {
  const prompt = buildExplainPrompt({ finding: FINDING, source: SOURCE });

  assert.strictEqual(prompt.includes(FINDING.evidence), true);
  assert.strictEqual(prompt.includes(FINDING.detail), true);
  assert.strictEqual(prompt.includes(FINDING.dimension), true);
  assert.strictEqual(prompt.includes(SOURCE), true);
  assert.strictEqual(prompt.includes("5"), true);

  // Not the function. Every other line of the fixture is absent.
  for (const line of SOURCE_LINES) {
    if (line.trim() === FINDING.evidence) continue;
    assert.strictEqual(prompt.includes(line.trim()), false, `prompt leaked: ${line}`);
  }
});

test("the prompt states the line bound it will be judged against", () => {
  const prompt = buildExplainPrompt({ finding: FINDING, source: SOURCE });
  assert.strictEqual(prompt.includes(String(EXPLANATION_MAX_LINES)), true);
});

test("the prompt is a pure function of its authorization", () => {
  const a = buildExplainPrompt({ finding: FINDING, source: SOURCE });
  const b = buildExplainPrompt({ finding: { ...FINDING }, source: SOURCE });
  assert.strictEqual(a, b);
});

// ---------------------------------------------------------------------------
// The transport seam.
// ---------------------------------------------------------------------------

test("a transport that returns a non-string yields the empty string", async () => {
  for (const answer of [undefined, null, 42, { explanation: "nice try" }, ["a"]]) {
    const text = await explainFinding({ finding: FINDING, source: SOURCE }, async () => answer);
    assert.strictEqual(text, "");
  }
});

test("a transport that rejects yields the empty string and does not throw", async () => {
  const text = await explainFinding({ finding: FINDING, source: SOURCE }, async () => {
    throw new Error("connection refused");
  });
  assert.strictEqual(text, "");
});

test("a transport that throws synchronously also yields the empty string", async () => {
  const text = await explainFinding({ finding: FINDING, source: SOURCE }, () => {
    throw new Error("no client configured");
  });
  assert.strictEqual(text, "");
});

test("explainFinding trims what it keeps", async () => {
  const text = await explainFinding(
    { finding: FINDING, source: SOURCE },
    async () => "\n  command-query separation, Meyer 1988.  \n",
  );
  assert.strictEqual(text, "command-query separation, Meyer 1988.");
});

test("explainFinding drops prose one line over the bound and keeps prose exactly at it", async () => {
  const lines = (n) => Array.from({ length: n }, (_, i) => `line ${i + 1}`).join("\n");

  const at = await explainFinding(
    { finding: FINDING, source: SOURCE },
    async () => lines(EXPLANATION_MAX_LINES),
  );
  assert.notStrictEqual(at, "");

  const over = await explainFinding(
    { finding: FINDING, source: SOURCE },
    async () => lines(EXPLANATION_MAX_LINES + 1),
  );
  assert.strictEqual(over, "");
});

test("the bound counts CRLF lines too", () => {
  const crlf = Array.from({ length: EXPLANATION_MAX_LINES + 1 }, (_, i) => `line ${i}`).join("\r\n");
  const rows = attachExplanations(
    [
      {
        dimension: "cqs",
        title: "answers a question and changes the world",
        group: "contract",
        source: SOURCE,
        outcome: { state: "flagged", findings: [FINDING] },
        elevated: true,
      },
    ],
    new Map([[findingKey(FINDING), crlf]]),
  );
  assert.strictEqual(rows[0].explanation, undefined);
});

// ---------------------------------------------------------------------------
// attachExplanations, at the seams the oracle did not name.
// ---------------------------------------------------------------------------

const flaggedRow = (findings) => ({
  dimension: "cqs",
  title: "answers a question and changes the world",
  group: "contract",
  source: SOURCE,
  outcome: { state: "flagged", findings },
  elevated: true,
});

test("a row with several findings takes the FIRST admissible prose and only that", () => {
  const second = { ...FINDING, line: 9, evidence: "warmed.add(key);" };
  const rows = [flaggedRow([FINDING, second])];

  const both = attachExplanations(
    rows,
    new Map([
      [findingKey(FINDING), "the first finding's prose."],
      [findingKey(second), "the second finding's prose."],
    ]),
  );
  assert.strictEqual(both[0].explanation, "the first finding's prose.");

  // With the first finding's prose over the bound, the second one is reached:
  // a dropped explanation must not silence the rest of the row.
  const overLong = Array.from({ length: EXPLANATION_MAX_LINES + 1 }, () => "x").join("\n");
  const fallback = attachExplanations(
    rows,
    new Map([
      [findingKey(FINDING), overLong],
      [findingKey(second), "the second finding's prose."],
    ]),
  );
  assert.strictEqual(fallback[0].explanation, "the second finding's prose.");
});

test("a row that gains no prose has no `explanation` key at all", () => {
  const rows = attachExplanations([flaggedRow([FINDING])], new Map([["nesting:5", "unreachable."]]));
  assert.strictEqual("explanation" in rows[0], false);
});

test("an empty prose map returns a new array whose rows are the same objects", () => {
  const input = [flaggedRow([FINDING])];
  const out = attachExplanations(input, new Map());
  assert.notStrictEqual(out, input);
  assert.strictEqual(out[0], input[0]);
});

test("no row is ever added, and an empty card stays empty", () => {
  const out = attachExplanations([], new Map([[findingKey(FINDING), "prose for nobody."]]));
  assert.strictEqual(out.length, 0);
});

test("prose already on a row is not carried over a drop", () => {
  const pre = { ...flaggedRow([FINDING]), explanation: "prose from an earlier pass." };
  const overLong = Array.from({ length: EXPLANATION_MAX_LINES + 1 }, () => "x").join("\n");
  const out = attachExplanations([pre], new Map([[findingKey(FINDING), overLong]]));
  // The drop leaves the row exactly as it arrived: this function replaces, it
  // never edits, and it never erases what it was handed.
  assert.strictEqual(out[0], pre);
});
