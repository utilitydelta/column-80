// BLIND ORACLE: the injection planner (session-v62 phase 2).
//
// Written from `session-v62/contracts/phase2-planner.md` alone, with
// `session-v62/goal.md` for the product frame and `contracts/phase1-voice.md`
// read ONLY for the SHAPE of a comment string (the `C80 <dimension>: ` prefix
// of Amendment 1 clause 1), which phase 2's strip pass and tag rule both
// depend on. `src/core/criticizeTypes.ts` and `src/core/criticizeScore.ts`
// were read only for the shapes this file hand-builds: DetectorFinding,
// DimensionId, Scorecard, ScorecardRow, DimensionOutcome, ElevationPolicy.
//
// NOT READ, and the exercise is void if they are: `src/core/criticizePlan.ts`
// (the module under test) and `src/core/criticizeVoice.ts` (phase 1). No stub
// is provided for either.
//
// Contract state: Amendment 2 (human ruling, 2026-08-28) REPEALS trailing
// placement. Every comment goes directly above its offending line, at that
// line's own indent, in the long form. The trailing STRIP survives, because a
// legacy build or a person's own hand can leave one behind.
//
// Expected RED with a module-resolution failure until phase 2 exists.
//
// Run: node --test test/blind-v62-p2-planner.test.cjs

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
    "blind-v62-p2-planner",
    `export * from "../src/core/criticizePlan";\n`,
  );
  cleanup = bundled.cleanup;
  mod = bundled.mod;
} catch (err) {
  loadError = err;
  // bundleCore writes its entry file BEFORE esbuild runs, so a failed build
  // leaves one behind and its cleanup closure was never returned.
  try {
    require("fs").rmSync(
      require("path").join(__dirname, ".blind-v62-p2-planner.entry.ts"),
      { force: true },
    );
  } catch {
    /* nothing to remove */
  }
}

test.after(() => cleanup());

function requireModule() {
  if (mod === null) {
    throw new Error(
      `phase 2 module did not load: ${loadError && loadError.message}`,
    );
  }
  return mod;
}

/** The one exported entry point, contract §'What it exposes'. */
function planInjection(regionLines, regionStartLine, card, policy) {
  const m = requireModule();
  assert.strictEqual(
    typeof m.planInjection,
    "function",
    "contract §'What it exposes' exports planInjection(regionLines, regionStartLine, card, policy)",
  );
  const plan = m.planInjection(regionLines, regionStartLine, card, policy);
  assert.ok(
    plan !== null && typeof plan === "object",
    "contract §'Nothing to say': the planner does not return undefined",
  );
  assert.strictEqual(typeof plan.text, "string", "InjectionPlan.text is a string");
  assert.strictEqual(
    typeof plan.planted,
    "number",
    "InjectionPlan.planted is a number",
  );
  assert.strictEqual(
    typeof plan.stripped,
    "number",
    "InjectionPlan.stripped is a number",
  );
  assert.doesNotMatch(
    plan.text,
    /\r/,
    "contract §'Line endings': the planner never emits \\r",
  );
  return plan;
}

// ---------------------------------------------------------------------------
// Card fixtures. Hand-built, because the planner is being handed a Scorecard
// and never builds one. Fifteen rows in the rubric's fixed order, because that
// order IS "card order" for the several-findings-on-one-line rule.
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

// criticizeScore.signatureLevel, transcribed. Contract §'What gets planted':
// blastRadius rides the comment "on signature-level rows only".
const SIGNATURE_LEVEL = new Set([
  "clock",
  "prng",
  "env",
  "world",
  "adjacent-params",
  "bool-param",
  "unused-param",
  "param-count",
  "unadmitted-failure",
]);

const NONE_HELD = { held: [] };
const HELD_SECTION = { held: ["section-comment"] };

/** A flagged outcome. `findings` is a list of {line, detail, evidence?}. */
function flagged(dim, findings) {
  return {
    state: "flagged",
    findings: findings.map((f) => ({
      dimension: dim,
      line: f.line,
      evidence: f.evidence ?? `evidmark_${dim.replace(/-/g, "_")}()`,
      detail: f.detail,
    })),
  };
}

const blind = (dim) => ({
  state: "blind",
  reason: `blindmark ${dim}: this language cannot answer that question`,
});

const clean = () => ({ state: "clean" });

/**
 * A whole fifteen-row card.
 *
 * `spec` maps a dimension to an outcome; anything unnamed is clean. `blast`
 * maps a dimension to a blastRadius. `elevatedOverride` maps a dimension to a
 * deliberately WRONG `row.elevated`, because the contract says what plants is
 * "flagged, and the policy does not hold it" and never mentions that field.
 */
function makeCard(opts) {
  const spec = opts.spec ?? {};
  const blast = opts.blast ?? {};
  const elevatedOverride = opts.elevatedOverride ?? {};
  const held = opts.policyHeldForRowFlag ?? [];
  return {
    name: opts.name ?? "widen",
    languageId: opts.languageId,
    headLine: opts.headLine,
    rows: DIMS.map((dim) => {
      const outcome = spec[dim] ?? clean();
      const row = {
        dimension: dim,
        title: `the dimension's own words for ${dim}`,
        group: GROUP_OF[dim],
        source: `curriculum lineage srcmark ${dim}`,
        outcome,
        elevated:
          dim in elevatedOverride
            ? elevatedOverride[dim]
            : outcome.state === "flagged" && !held.includes(dim),
      };
      if (dim in blast) row.blastRadius = blast[dim];
      return row;
    }),
  };
}

// ---------------------------------------------------------------------------
// Region fixtures. Five languages ship; these cover a `//` language with space
// indent (TypeScript), a `#` language (Python) and a TAB-indented `//`
// language (Go), because Go and Rust indent with tabs and a width function
// that counts a tab as one column measures them wrong.
// ---------------------------------------------------------------------------

const TS_START = 200;
const TS_REGION = [
  "export function widen(a: number, b: number): number {",
  "  const now = Date.now();",
  "  if (a > b) {",
  "    return a;",
  "  }",
  "  return b;",
  "}",
];
// document lines 200 .. 206

const PY_START = 300;
const PY_REGION = [
  "def widen(a, b):",
  '    """Widen a to b."""',
  "    now = time.time()",
  "    return a + b",
];
// document lines 300 .. 303

// A wide body line, 75 columns, because real functions have them and a
// comment planted above one must still wrap inside its own budget.
const LONG_START = 600;
const LONG_CODE =
  "  const nowMeasuredFromTheWallClockInsideThisVeryFunctionBody = Date.now();";
const LONG_TS_REGION = [
  "export function widen(a: number, b: number): number {",
  LONG_CODE,
  "  return a + b;",
  "}",
];
// document lines 600 .. 603

const GO_START = 400;
const GO_REGION = [
  "func widen(a int, b int) int {",
  "\tnow := time.Now()",
  "\tif a > b {",
  "\t\treturn a",
  "\t}",
  "\treturn b",
  "}",
];
// document lines 400 .. 406

const tokenFor = (languageId) => (languageId === "python" ? "#" : "//");

// ---------------------------------------------------------------------------
// Output readers. None of them know anything about the module's internals;
// they read the text the way a person reading the diff would.
// ---------------------------------------------------------------------------

/** Lines the plan produced that were not in the input, as a multiset diff. A
 *  trailing comment shows up here as the whole rewritten code line. */
function addedLines(inputLines, outLines) {
  const counts = new Map();
  for (const l of inputLines) counts.set(l, (counts.get(l) || 0) + 1);
  const added = [];
  for (const l of outLines) {
    const c = counts.get(l) || 0;
    if (c > 0) counts.set(l, c - 1);
    else added.push(l);
  }
  return added;
}

/** True when the line is nothing but a C80 comment. */
function isWholeC80Line(line, token) {
  return line.trim().startsWith(`${token} C80 `);
}

/** True when the line has code AND a C80 comment after it. */
function hasTrailingC80(line, token) {
  const at = line.indexOf(`${token} C80 `);
  return at > 0 && line.slice(0, at).trim().length > 0;
}

/** Occurrences of one dimension's comment head anywhere in the text. One per
 *  FINDING: Amendment 4 gives a continuation no tag and no `<dim>: `. */
function headCount(text, dim) {
  return text.split("\n").filter((l) => l.includes(`C80 ${dim}: `)).length;
}

/** Amendment 4: the continuation hangs under the head's own text.
 *
 *  The prose of the amendment says "exactly four spaces" but its own worked
 *  example, and the head shape it must hang under, both mean four AFTER the
 *  token's ordinary separating space: `//` + 5 spaces puts the text in the
 *  same column as the head's text, which is the stated purpose. A
 *  hand-written `// my own note` has one space and can never match either
 *  reading.
 *
 *  CONT_SPACES is asserted against the head's own geometry below, so this
 *  constant cannot silently drift from what "hangs under itself" means. */
const CONT_SPACES = " ".repeat(1 + "C80 ".length);
const CONTINUATION = new RegExp(`^[ \\t]*(//|#)${CONT_SPACES}\\S`);
const isContinuationLine = (line) => CONTINUATION.test(line);

/** A line this product planted: a head, or a continuation of one. */
function isCommentLine(line, token) {
  return isWholeC80Line(line, token) || isContinuationLine(line);
}

/** The contiguous run of planted comment lines directly above index `at`. */
function blockAbove(lines, at, token) {
  const out = [];
  for (let i = at - 1; i >= 0 && isCommentLine(lines[i], token); i--) out.unshift(lines[i]);
  return out;
}

/** The column a line's TEXT starts in: past the indent, the token, and any
 *  hanging indent. This is what "hangs under itself" is measured in. */
function textColumn(line) {
  const m = /^([ \t]*(?:\/\/|#) *)/.exec(line);
  return m === null ? 0 : m[1].length;
}

/**
 * Every comment in the text, read back as ONE sentence group.
 *
 * Amendment 1 §9: a wrapped comment is not byte-contiguous in the file, so an
 * assertion about its words must rejoin head and continuations first. The
 * `prose` is everything after `C80 <dim>: `, hanging indent removed.
 */
function comments(text, token) {
  const lines = text.split("\n");
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const indent = indentOf(lines[i]);
    const headStart = `${indent}${token} C80 `;
    if (!lines[i].startsWith(headStart)) continue;
    const m = /^([a-z-]+): (.*)$/.exec(lines[i].slice(headStart.length));
    if (m === null) continue;
    const contStart = `${indent}${token}${CONT_SPACES}`;
    const parts = [m[2]];
    const continuations = [];
    let j = i + 1;
    while (
      j < lines.length &&
      lines[j].startsWith(contStart) &&
      lines[j].charAt(contStart.length) !== " " &&
      lines[j].charAt(contStart.length) !== ""
    ) {
      continuations.push(lines[j]);
      parts.push(lines[j].slice(contStart.length));
      j++;
    }
    out.push({
      dim: m[1],
      prose: parts.join(" "),
      head: lines[i],
      continuations,
      at: i,
      endsAt: j - 1,
    });
    i = j - 1;
  }
  return out;
}

/**
 * The code line each C80 comment is attached to, in output order.
 *
 * A trailing comment attaches to its own line; a planted comment attaches to
 * the next line that is neither a head nor a continuation. Returns a list of
 * `{ dim, code }` where `code` is the attached code line WITHOUT any trailing
 * comment, so an assertion can name the fixture line it expects.
 */
function attachments(text, token) {
  const lines = text.split("\n");
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const at = line.indexOf(`${token} C80 `);
    if (at < 0) continue;
    const head = line.slice(at + `${token} C80 `.length);
    const m = /^([a-z-]+):/.exec(head);
    if (m === null) continue; // a wrapped continuation, not a comment head
    const dim = m[1];
    if (hasTrailingC80(line, token)) {
      out.push({ dim, code: line.slice(0, at).replace(/\s+$/, ""), trailing: true });
      continue;
    }
    let j = i + 1;
    while (j < lines.length && isCommentLine(lines[j], token) && !hasTrailingC80(lines[j], token)) {
      j++;
    }
    const target = j < lines.length ? lines[j] : "";
    const tAt = target.indexOf(`${token} C80 `);
    out.push({
      dim,
      code: (tAt > 0 ? target.slice(0, tAt) : target).replace(/\s+$/, ""),
      trailing: false,
    });
  }
  return out;
}

/** The line's leading whitespace, exactly. */
const indentOf = (line) => /^[ \t]*/.exec(line)[0];

// ===========================================================================
// The exported surface
// ===========================================================================

test("contract §'What it exposes': planInjection is exported and returns an InjectionPlan", () => {
  const card = makeCard({ languageId: "typescript", headLine: TS_START });
  const plan = planInjection(TS_REGION, TS_START, card, NONE_HELD);
  assert.ok(Number.isInteger(plan.planted), "planted is an integer count");
  assert.ok(Number.isInteger(plan.stripped), "stripped is an integer count");
});

// ===========================================================================
// Nothing to say
// ===========================================================================

test("contract §'Nothing to say': an all-clean card plants nothing and returns the region unchanged", () => {
  const card = makeCard({ languageId: "typescript", headLine: TS_START });
  const plan = planInjection(TS_REGION, TS_START, card, NONE_HELD);
  assert.strictEqual(plan.planted, 0, "no elevated row means planted === 0");
  assert.strictEqual(plan.stripped, 0, "there was nothing to strip");
  assert.strictEqual(
    plan.text,
    TS_REGION.join("\n"),
    "text equals the region unchanged, joined with \\n",
  );
});

test("Amendment 1 §10: an empty region returns empty text, zero and zero, and does not throw", () => {
  const card = makeCard({
    languageId: "typescript",
    headLine: TS_START,
    spec: { clock: flagged("clock", [{ line: 201, detail: "reads Date.now here" }]) },
  });
  const plan = planInjection([], TS_START, card, NONE_HELD);
  assert.deepStrictEqual(
    { text: plan.text, planted: plan.planted, stripped: plan.stripped },
    { text: "", planted: 0, stripped: 0 },
    "no region means nowhere to plant, and that is not an error",
  );
});

test("Amendment 1 §10: an incoming \\r is normalised out, not carried through", () => {
  const region = TS_REGION.map((l) => `${l}\r`);
  const card = makeCard({
    languageId: "typescript",
    headLine: TS_START,
    spec: { clock: flagged("clock", [{ line: 201, detail: "reads Date.now here" }]) },
  });
  const plan = planInjection(region, TS_START, card, NONE_HELD);
  assert.strictEqual(plan.planted, 1, "a CRLF document still gets its comment");
  assert.ok(
    plan.text.split("\n").includes(TS_REGION[1]),
    `the code line comes back without its carriage return: ${JSON.stringify(plan.text)}`,
  );
});

test("contract §'What gets planted': a blind row is a refusal and plants nothing", () => {
  const card = makeCard({
    languageId: "typescript",
    headLine: TS_START,
    spec: { clock: blind("clock"), world: blind("world") },
  });
  const plan = planInjection(TS_REGION, TS_START, card, NONE_HELD);
  assert.strictEqual(plan.planted, 0, "a blind row does not belong in source");
  assert.strictEqual(plan.text, TS_REGION.join("\n"), "nothing was written");
});

test("contract §'What gets planted': a held dimension scores and stays out of the source", () => {
  const card = makeCard({
    languageId: "typescript",
    headLine: TS_START,
    policyHeldForRowFlag: ["section-comment"],
    spec: {
      "section-comment": flagged("section-comment", [
        { line: 202, detail: "a section comment splits the body in two" },
      ]),
    },
  });
  const plan = planInjection(TS_REGION, TS_START, card, HELD_SECTION);
  assert.strictEqual(plan.planted, 0, "the policy holds section-comment");
  assert.strictEqual(plan.text, TS_REGION.join("\n"), "nothing was written");
});

test("positive control: the same flagged row plants when the policy does not hold it", () => {
  const card = makeCard({
    languageId: "typescript",
    headLine: TS_START,
    spec: {
      "section-comment": flagged("section-comment", [
        { line: 202, detail: "a section comment splits the body in two" },
      ]),
    },
  });
  const plan = planInjection(TS_REGION, TS_START, card, NONE_HELD);
  assert.strictEqual(plan.planted, 1, "flagged and not held plants one comment");
  assert.strictEqual(headCount(plan.text, "section-comment"), 1, "one comment in the text");
});

test("contract §'What gets planted': a clean row is the absence of a finding and plants nothing", () => {
  const card = makeCard({
    languageId: "typescript",
    headLine: TS_START,
    spec: {
      clock: flagged("clock", [{ line: 201, detail: "reads Date.now in the body" }]),
      nesting: clean(),
    },
  });
  const plan = planInjection(TS_REGION, TS_START, card, NONE_HELD);
  assert.strictEqual(plan.planted, 1, "only the flagged row planted");
  assert.strictEqual(headCount(plan.text, "nesting"), 0, "the clean row wrote nothing");
});

test("contract §'What gets planted': the policy decides, not the row's stale `elevated` flag", () => {
  const card = makeCard({
    languageId: "typescript",
    headLine: TS_START,
    spec: { clock: flagged("clock", [{ line: 201, detail: "reads Date.now in the body" }]) },
    elevatedOverride: { clock: false },
  });
  const plan = planInjection(TS_REGION, TS_START, card, NONE_HELD);
  assert.strictEqual(
    plan.planted,
    1,
    "the clause is 'flagged, and the policy does not hold it'; row.elevated is a stale convenience",
  );
});

test("contract §'What gets planted': the policy suppresses any dimension it holds, not just section-comment", () => {
  const card = makeCard({
    languageId: "typescript",
    headLine: TS_START,
    spec: {
      clock: flagged("clock", [{ line: 201, detail: "reads Date.now in the body" }]),
      nesting: flagged("nesting", [{ line: 203, detail: "the body nests 3 blocks deep" }]),
    },
  });
  const plan = planInjection(TS_REGION, TS_START, card, { held: ["clock"] });
  assert.strictEqual(plan.planted, 1, "clock is held, nesting is not");
  assert.strictEqual(headCount(plan.text, "clock"), 0, "the held dimension wrote nothing");
  assert.strictEqual(headCount(plan.text, "nesting"), 1, "the other one still planted");
});

// ===========================================================================
// One comment per FINDING
// ===========================================================================

test("contract §'What gets planted': one comment per FINDING, not per row", () => {
  const card = makeCard({
    languageId: "typescript",
    headLine: TS_START,
    spec: {
      world: flagged("world", [
        { line: 201, detail: "opens a file on this line" },
        { line: 203, detail: "reads a directory on this line" },
        { line: 205, detail: "writes a file on this line" },
        { line: 206, detail: "removes a file on this line" },
      ]),
    },
  });
  const plan = planInjection(TS_REGION, TS_START, card, NONE_HELD);
  assert.strictEqual(plan.planted, 4, "four findings on one row give four comments");
  assert.strictEqual(headCount(plan.text, "world"), 4, "four comment heads in the text");
  const codes = attachments(plan.text, "//").map((a) => a.code);
  assert.deepStrictEqual(
    codes,
    ["  const now = Date.now();", "    return a;", "  return b;", "}"],
    "each comment attaches to its own finding's line, in document order",
  );
});

test("Amendment 1 §8: two findings of the SAME dimension on one line both render, no dedupe", () => {
  const card = makeCard({
    languageId: "typescript",
    headLine: TS_START,
    spec: {
      world: flagged("world", [
        { line: 201, detail: "opens a file here", evidence: "readFileSync(a)" },
        { line: 201, detail: "reads a directory here", evidence: "readdirSync(b)" },
      ]),
    },
  });
  const plan = planInjection(TS_REGION, TS_START, card, NONE_HELD);
  assert.strictEqual(plan.planted, 2, "it fired twice, and two identical heads is honest");
  assert.strictEqual(headCount(plan.text, "world"), 2, "two comments, not one");
  const atts = attachments(plan.text, "//");
  assert.deepStrictEqual(
    atts.map((a) => a.code),
    [TS_REGION[1], TS_REGION[1]],
    "both above the same line, in the order the row lists them",
  );
});

test("contract §'What gets planted': findings across rows all plant, and planted is their sum", () => {
  const card = makeCard({
    languageId: "typescript",
    headLine: TS_START,
    spec: {
      clock: flagged("clock", [{ line: 201, detail: "reads Date.now in the body" }]),
      world: flagged("world", [
        { line: 203, detail: "opens a file on this line" },
        { line: 205, detail: "reads a directory on this line" },
      ]),
      nesting: flagged("nesting", [{ line: 202, detail: "the body nests 3 blocks deep" }]),
    },
  });
  const plan = planInjection(TS_REGION, TS_START, card, NONE_HELD);
  assert.strictEqual(plan.planted, 4, "1 + 2 + 1 findings");
  assert.strictEqual(headCount(plan.text, "clock"), 1, "clock planted once");
  assert.strictEqual(headCount(plan.text, "world"), 2, "world planted twice");
  assert.strictEqual(headCount(plan.text, "nesting"), 1, "nesting planted once");
});

test("contract §'The finding's own specifics': the LONG form carries the detail verbatim", () => {
  const detail = "the body nests 4 blocks deep, at or above the chosen threshold of 4 for TypeScript";
  const card = makeCard({
    languageId: "typescript",
    headLine: LONG_START,
    spec: { nesting: flagged("nesting", [{ line: 601, detail }]) },
  });
  const plan = planInjection(LONG_TS_REGION, LONG_START, card, NONE_HELD);
  // Amendment 1 §9: check the detail after rejoining head and continuations.
  // A wrapped detail is not byte-contiguous in the file.
  const [only] = comments(plan.text, "//");
  assert.ok(only !== undefined, `a comment was planted: ${JSON.stringify(plan.text)}`);
  assert.strictEqual(only.dim, "nesting", "the head names the dimension that fired");
  assert.ok(
    only.prose.includes(detail),
    `the detector's own words must survive into the comment, in order and unreworded: ${JSON.stringify(plan.text)}`,
  );
});

// ===========================================================================
// The region rule
// ===========================================================================

test("contract §'The region': a finding on the FIRST region line attaches to that line", () => {
  const card = makeCard({
    languageId: "typescript",
    headLine: TS_START,
    spec: {
      "param-count": flagged("param-count", [
        { line: TS_START, detail: "asks for 2 parameters" },
      ]),
    },
  });
  const plan = planInjection(TS_REGION, TS_START, card, NONE_HELD);
  assert.strictEqual(plan.planted, 1, "the head-line finding was not dropped");
  const [att] = attachments(plan.text, "//");
  assert.strictEqual(
    att.code,
    TS_REGION[0],
    "adjacent-params and param-count fire ON THE HEAD LINE",
  );
});

test("contract §'The region': a finding on the LAST region line attaches to that line", () => {
  const last = TS_START + TS_REGION.length - 1;
  const card = makeCard({
    languageId: "typescript",
    headLine: TS_START,
    spec: { cqs: flagged("cqs", [{ line: last, detail: "returns and mutates" }]) },
  });
  const plan = planInjection(TS_REGION, TS_START, card, NONE_HELD);
  assert.strictEqual(plan.planted, 1, "the last-line finding was not dropped");
  const [att] = attachments(plan.text, "//");
  assert.strictEqual(att.code, TS_REGION[TS_REGION.length - 1], "attached to the closing line");
});

test("contract §'The region': a finding ABOVE the region attaches to the region's first line and is never dropped", () => {
  const card = makeCard({
    languageId: "typescript",
    headLine: TS_START,
    spec: {
      undocumented: flagged("undocumented", [
        { line: TS_START - 3, detail: "the doc comment states no contract" },
      ]),
    },
  });
  const plan = planInjection(TS_REGION, TS_START, card, NONE_HELD);
  assert.strictEqual(
    plan.planted,
    1,
    "a dimension that read the doc comment fires above the head; the card says one failure and the diff must show one",
  );
  const [att] = attachments(plan.text, "//");
  assert.strictEqual(att.code, TS_REGION[0], "it attaches to the region's first line");
});

test("contract §'The region': a finding BELOW the region also attaches to the region's first line", () => {
  const past = TS_START + TS_REGION.length + 4;
  const card = makeCard({
    languageId: "typescript",
    headLine: TS_START,
    spec: { cqs: flagged("cqs", [{ line: past, detail: "returns and mutates" }]) },
  });
  const plan = planInjection(TS_REGION, TS_START, card, NONE_HELD);
  assert.strictEqual(plan.planted, 1, "out of region is never dropped");
  const [att] = attachments(plan.text, "//");
  assert.strictEqual(
    att.code,
    TS_REGION[0],
    "the contract says the region's FIRST line, both directions; it is not clamped to the last",
  );
});

test("contract §'The region': two out-of-region findings both land, and neither evicts the other", () => {
  const card = makeCard({
    languageId: "typescript",
    headLine: TS_START,
    spec: {
      undocumented: flagged("undocumented", [
        { line: TS_START - 2, detail: "the doc comment states no contract" },
      ]),
      "unenforced-precondition": flagged("unenforced-precondition", [
        { line: TS_START - 1, detail: "the doc promises a is positive" },
      ]),
    },
  });
  const plan = planInjection(TS_REGION, TS_START, card, NONE_HELD);
  assert.strictEqual(plan.planted, 2, "both survived");
  const atts = attachments(plan.text, "//");
  assert.deepStrictEqual(
    atts.map((a) => a.dim),
    ["undocumented", "unenforced-precondition"],
    "both above the first line, in card order",
  );
  assert.ok(
    atts.every((a) => a.code === TS_REGION[0] && a.trailing === false),
    "several findings on one line all go above it",
  );
});

test("contract §'The region': a region of ONE line takes a finding on it and one outside it", () => {
  const region = ["  return a + b;"];
  const card = makeCard({
    languageId: "typescript",
    headLine: 500,
    spec: {
      cqs: flagged("cqs", [{ line: 500, detail: "returns and mutates" }]),
      "pass-through": flagged("pass-through", [{ line: 9000, detail: "adds no depth" }]),
    },
  });
  const plan = planInjection(region, 500, card, NONE_HELD);
  assert.strictEqual(plan.planted, 2, "neither finding was dropped off a one-line region");
});

// ===========================================================================
// Placement: trailing versus above, at exactly 80 columns
// ===========================================================================

test("contract §'Placement': an above-comment sits directly above, at that line's own indent", () => {
  const detail = "reads the wall clock here";
  const body = `      ${"a".repeat(90)}`; // six spaces, and deliberately over 80
  const region = ["function f() {", body, "}"];
  const card = makeCard({
    languageId: "typescript",
    headLine: 700,
    spec: { clock: flagged("clock", [{ line: 701, detail }]) },
  });
  const plan = planInjection(region, 700, card, NONE_HELD);
  const lines = plan.text.split("\n");
  const at = lines.indexOf(body);
  assert.ok(at > 0, "the offending line survives, unmodified, and is not first");
  const block = blockAbove(lines, at, "//");
  assert.ok(
    block.length >= 1 && isWholeC80Line(block[0], "//"),
    `the comment is DIRECTLY above the offending line: ${JSON.stringify(lines)}`,
  );
  for (const l of block) {
    assert.strictEqual(
      indentOf(l),
      "      ",
      "every line of it at that line's own indent, not the region's and not zero",
    );
  }
});

test("Amendment 2: several findings on ONE line each get their own comment above it, in card order", () => {
  const card = makeCard({
    languageId: "typescript",
    headLine: TS_START,
    spec: {
      nesting: flagged("nesting", [{ line: 201, detail: "the body nests 3 blocks deep" }]),
      clock: flagged("clock", [{ line: 201, detail: "reads Date.now here" }]),
      world: flagged("world", [{ line: 201, detail: "opens a file here" }]),
    },
  });
  const plan = planInjection(TS_REGION, TS_START, card, NONE_HELD);
  assert.strictEqual(plan.planted, 3, "three findings on one line give three comments");
  const atts = attachments(plan.text, "//");
  assert.deepStrictEqual(
    atts.map((a) => a.dim),
    ["clock", "world", "nesting"],
    "in the order the card lists them: honesty rows before the altitude row",
  );
  assert.ok(
    atts.every((a) => a.trailing === false),
    "there is no trailing form, so none of them can be trailing",
  );
  const lines = plan.text.split("\n");
  const at = lines.indexOf(TS_REGION[1]);
  assert.ok(at >= 0, "the offending line is unmodified");
  const block = blockAbove(lines, at, "//");
  const heads = block.filter((l) => isWholeC80Line(l, "//"));
  assert.strictEqual(
    heads.length,
    3,
    `all three sit contiguously above the line, never grouped elsewhere: ${JSON.stringify(lines)}`,
  );
  assert.strictEqual(
    comments(plan.text, "//").length,
    3,
    "three comments in the whole region, and nowhere else",
  );
});

test("Amendment 2: a SHORT line, which trailing would have fitted, still gets its comment ABOVE", () => {
  const code = "  const now = Date.now();"; // 25 columns, room to spare
  const region = ["function f() {", code, "}"];
  const card = makeCard({
    languageId: "typescript",
    headLine: 700,
    spec: {
      clock: flagged("clock", [
        { line: 701, detail: "reads the wall clock through Date.now" },
      ]),
    },
  });
  const plan = planInjection(region, 700, card, NONE_HELD);
  const lines = plan.text.split("\n");
  const at = lines.indexOf(code);
  assert.ok(at > 0, "the offending line survives byte for byte, unmodified");
  const block = blockAbove(lines, at, "//");
  assert.ok(
    block.length >= 1 && isWholeC80Line(block[0], "//"),
    `placement is one rule now: directly above, always: ${JSON.stringify(plan.text)}`,
  );
  for (const l of block) {
    assert.strictEqual(indentOf(l), "  ", "at the offending line's own indent");
  }
});

test("Amendment 2: no fixture, in any language, ever produces a trailing comment", () => {
  const cases = [
    [TS_REGION, TS_START, BUSY_CARD(), NONE_HELD, "//"],
    [
      LONG_TS_REGION,
      LONG_START,
      makeCard({
        languageId: "typescript",
        headLine: LONG_START,
        spec: { clock: flagged("clock", [{ line: 601, detail: "reads Date.now here" }]) },
      }),
      NONE_HELD,
      "//",
    ],
    [
      PY_REGION,
      PY_START,
      makeCard({
        languageId: "python",
        headLine: PY_START,
        spec: {
          clock: flagged("clock", [{ line: 302, detail: "reads time.time here" }]),
          "param-count": flagged("param-count", [
            { line: 300, detail: "asks the caller for 2 parameters" },
          ]),
        },
      }),
      NONE_HELD,
      "#",
    ],
    [
      GO_REGION,
      GO_START,
      makeCard({
        languageId: "go",
        headLine: GO_START,
        spec: {
          clock: flagged("clock", [{ line: 401, detail: "reads time.Now here" }]),
          nesting: flagged("nesting", [{ line: 403, detail: "the body nests 2 blocks deep" }]),
        },
      }),
      NONE_HELD,
      "//",
    ],
  ];
  for (const [region, start, card, policy, token] of cases) {
    const plan = planInjection(region, start, card, policy);
    assert.ok(plan.planted > 0, "the case actually planted something");
    for (const line of plan.text.split("\n")) {
      assert.ok(
        hasTrailingC80(line, token) === false,
        `there is no trailing form: ${JSON.stringify(line)}`,
      );
    }
  }
});

test("Amendment 2: the planted form is the LONG one, carrying detail and blast clause", () => {
  const detail = "reads the wall clock through Date.now on this very line";
  const code = "  const now = Date.now();";
  const region = ["function f() {", code, "}"];
  const card = makeCard({
    languageId: "typescript",
    headLine: 700,
    spec: { clock: flagged("clock", [{ line: 701, detail }]) },
    blast: { clock: 6 },
  });
  const plan = planInjection(region, 700, card, NONE_HELD);
  assert.strictEqual(headCount(plan.text, "clock"), 1, "one finding, one comment");
  const [only] = comments(plan.text, "//");
  assert.ok(only !== undefined, `a comment was planted: ${JSON.stringify(plan.text)}`);
  assert.ok(
    only.prose.includes(detail),
    "there is no short form left, so even a 25-column line gets the detail",
  );
  // Against the REJOINED prose, because the clause can straddle a wrap and a
  // raw-text match would be green only by luck.
  assert.match(only.prose, /\b6 call sites\b/, "and the blast clause");
});

test("contract §'Comment token per language' (goal): Python gets `#` and never `//`", () => {
  const card = makeCard({
    languageId: "python",
    headLine: PY_START,
    spec: { clock: flagged("clock", [{ line: 302, detail: "reads time.time here" }]) },
  });
  const plan = planInjection(PY_REGION, PY_START, card, NONE_HELD);
  assert.strictEqual(plan.planted, 1, "one comment planted");
  assert.match(plan.text, /# C80 clock: /, "the tag rides a # comment");
  assert.doesNotMatch(plan.text, /\/\/ C80 /, "a // comment in Python is not a comment");
});

test("contract §'Placement': Python's above-comment carries the four-space body indent", () => {
  // A wide line, so the indent assertion is about the planter's choice of
  // indent and not about a line that happens to be short.
  const wide = "    return widenTheAccumulatorAcrossEveryBucketWeHaveEverSeen(a, b, c)";
  const region = [PY_REGION[0], PY_REGION[1], PY_REGION[2], wide];
  const card = makeCard({
    languageId: "python",
    headLine: PY_START,
    spec: {
      nesting: flagged("nesting", [
        {
          line: 303,
          detail:
            "the body nests 4 blocks deep, at or above the chosen threshold of 4 for Python",
        },
      ]),
    },
  });
  const plan = planInjection(region, PY_START, card, NONE_HELD);
  const lines = plan.text.split("\n");
  const at = lines.indexOf(wide);
  assert.ok(at > 0, "the offending line survives unmodified");
  const block = blockAbove(lines, at, "#");
  assert.ok(
    block.length >= 1 && isWholeC80Line(block[0], "#"),
    `the comment is directly above it: ${JSON.stringify(lines)}`,
  );
  for (const l of block) {
    assert.strictEqual(indentOf(l), "    ", "at the offending line's own indent");
  }
});

test("contract §'Placement': a TAB-indented line gets a TAB-indented comment above it", () => {
  const long = `\t\t${"return someVeryLongCallChain()".repeat(4)}`;
  const region = GO_REGION.slice();
  region[3] = long; // document line 403, tab-tab indented, far over 80
  const card = makeCard({
    languageId: "go",
    headLine: GO_START,
    spec: { world: flagged("world", [{ line: 403, detail: "opens a file here" }]) },
  });
  const plan = planInjection(region, GO_START, card, NONE_HELD);
  const lines = plan.text.split("\n");
  const at = lines.indexOf(long);
  assert.ok(at > 0, "the offending line survives unmodified");
  const block = blockAbove(lines, at, "//");
  assert.ok(
    block.length >= 1 && isWholeC80Line(block[0], "//"),
    `the comment is directly above it: ${JSON.stringify(lines)}`,
  );
  for (const l of block) {
    assert.strictEqual(
      indentOf(l),
      "\t\t",
      "the indent is copied from the line, tabs and all; spaces here would misalign Go and Rust",
    );
  }
});

test("contract §'The region': tab-indented Go maps findings by document line, not by trimmed text", () => {
  const card = makeCard({
    languageId: "go",
    headLine: GO_START,
    spec: {
      clock: flagged("clock", [{ line: 401, detail: "reads time.Now here" }]),
      nesting: flagged("nesting", [{ line: 403, detail: "the body nests 2 blocks deep" }]),
    },
  });
  const plan = planInjection(GO_REGION, GO_START, card, NONE_HELD);
  const atts = attachments(plan.text, "//");
  assert.deepStrictEqual(
    atts.map((a) => ({ dim: a.dim, code: a.code })),
    [
      { dim: "clock", code: "\tnow := time.Now()" },
      { dim: "nesting", code: "\t\treturn a" },
    ],
    "each comment attached to the document line its finding named",
  );
});

// ===========================================================================
// Every injected line carries the tag
// ===========================================================================

test("Amendment 4: every added line is a HEAD or a four-space CONTINUATION, nothing else", () => {
  const card = makeCard({
    languageId: "typescript",
    headLine: TS_START,
    spec: {
      clock: flagged("clock", [{ line: 201, detail: "reads Date.now here" }]),
      world: flagged("world", [
        { line: 203, detail: "opens a file here" },
        { line: 205, detail: "reads a directory here" },
      ]),
      nesting: flagged("nesting", [
        {
          line: 202,
          detail:
            "the body nests 4 blocks deep, at or above the chosen threshold of 4 for TypeScript, and that is more than a reader can hold at once",
        },
      ]),
    },
  });
  const plan = planInjection(TS_REGION, TS_START, card, NONE_HELD);
  const added = addedLines(TS_REGION, plan.text.split("\n"));
  assert.ok(added.length >= 4, "at least one line per finding was added");
  for (const line of added) {
    assert.ok(
      isCommentLine(line, "//"),
      `an added line the strip pass cannot recognise: ${JSON.stringify(line)}`,
    );
  }
  assert.strictEqual(
    comments(plan.text, "//").length,
    plan.planted,
    "and the heads read back one per planted finding",
  );
});

test("Amendment 4: a WRAPPED comment is one head plus four-space continuations, not several heads", () => {
  const detail =
    "the body nests 4 blocks deep, at or above the chosen threshold of 4 for TypeScript, and the reader has to hold every one of those branches in their head at once";
  const card = makeCard({
    languageId: "typescript",
    headLine: LONG_START,
    spec: { nesting: flagged("nesting", [{ line: 601, detail }]) },
  });
  const plan = planInjection(LONG_TS_REGION, LONG_START, card, NONE_HELD);
  const added = addedLines(LONG_TS_REGION, plan.text.split("\n"));
  assert.ok(
    added.length >= 2,
    `a comment this long must wrap rather than emit one 200-column line: ${JSON.stringify(added)}`,
  );
  const found = comments(plan.text, "//");
  assert.strictEqual(
    found.length,
    1,
    `one criticism, one head: a re-tagged continuation reads as a second finding: ${JSON.stringify(added)}`,
  );
  assert.ok(found[0].continuations.length >= 1, "and it did wrap");
  const headTextColumn = found[0].head.indexOf("C80 ") + "C80 ".length;
  for (const line of found[0].continuations) {
    assert.match(
      line,
      new RegExp(`^  //${CONT_SPACES}\\S`),
      `a continuation is the indent, the token, then the hanging indent, then text: ${JSON.stringify(line)}`,
    );
    assert.strictEqual(
      textColumn(line),
      headTextColumn,
      `the prose hangs under the head's own text, which is what the indent is FOR: ${JSON.stringify(found[0].head)} vs ${JSON.stringify(line)}`,
    );
    assert.ok(
      !line.includes("C80"),
      `the tag does not repeat, or the sentence reads as sawn in half: ${JSON.stringify(line)}`,
    );
  }
  assert.strictEqual(plan.planted, 1, "a wrapped comment is still ONE planted comment");
});

test("Amendment 4: wrapped lines respect the 80-column width", () => {
  const detail =
    "the body nests four blocks deep and the reader has to hold every one of those branches in their head at once while they read the rest of it";
  const card = makeCard({
    languageId: "typescript",
    headLine: LONG_START,
    spec: { nesting: flagged("nesting", [{ line: 601, detail }]) },
  });
  const plan = planInjection(LONG_TS_REGION, LONG_START, card, NONE_HELD);
  const added = addedLines(LONG_TS_REGION, plan.text.split("\n"));
  for (const line of added) {
    assert.ok(
      line.length <= 80,
      `every word here is short, so no line has an excuse to overrun: ${JSON.stringify(line)} is ${line.length}`,
    );
  }
});

// ===========================================================================
// Blast radius
// ===========================================================================

// The blast clause rides the long form, which is now the only form.

test("contract §'What gets planted': blastRadius rides a signature-level row's comment", () => {
  const card = makeCard({
    languageId: "typescript",
    headLine: LONG_START,
    spec: { clock: flagged("clock", [{ line: 601, detail: "reads Date.now here" }]) },
    blast: { clock: 7 },
  });
  const plan = planInjection(LONG_TS_REGION, LONG_START, card, NONE_HELD);
  assert.ok(SIGNATURE_LEVEL.has("clock"), "fixture premise: clock is signature-level");
  assert.strictEqual(
    attachments(plan.text, "//")[0].trailing,
    false,
    "the comment was planted above, which is the only placement there is",
  );
  const [only] = comments(plan.text, "//");
  assert.ok(only !== undefined, `a comment was planted: ${JSON.stringify(plan.text)}`);
  assert.match(
    only.prose,
    /\b7 call sites\b/,
    "the measured count reaches the source, plural at 7, read off the rejoined prose because the clause can straddle a wrap",
  );
});

test("contract §'What gets planted': a measured 1 is singular and a measured 0 is words, not silence", () => {
  const withRadius = (n) =>
    makeCard({
      languageId: "typescript",
      headLine: LONG_START,
      spec: { clock: flagged("clock", [{ line: 601, detail: "reads Date.now here" }]) },
      blast: { clock: n },
    });
  const [one] = comments(planInjection(LONG_TS_REGION, LONG_START, withRadius(1), NONE_HELD).text, "//");
  const [zero] = comments(planInjection(LONG_TS_REGION, LONG_START, withRadius(0), NONE_HELD).text, "//");
  assert.ok(one !== undefined && zero !== undefined, "both cases planted a comment");
  assert.match(one.prose, /\b1 call site\b/, "singular at 1");
  // Amendment 5: a measured zero is WORDS. `0 call sites ride on this
  // signature` reads like a machine that did not know the answer.
  assert.match(
    zero.prose,
    /no call sites/i,
    "a MEASURED zero renders as words; it is not the same as an unmeasured one",
  );
  assert.doesNotMatch(zero.prose, /0/, "and the digit never appears at zero");
});

test("contract §'What gets planted': no blastRadius means the comment says nothing about call sites", () => {
  const card = makeCard({
    languageId: "typescript",
    headLine: LONG_START,
    spec: { clock: flagged("clock", [{ line: 601, detail: "reads Date.now here" }]) },
  });
  const plan = planInjection(LONG_TS_REGION, LONG_START, card, NONE_HELD);
  assert.strictEqual(plan.planted, 1, "the row did plant, so the absence below is not vacuous");
  assert.doesNotMatch(
    comments(plan.text, "//")[0].prose,
    /call site/i,
    "an unmeasured radius produces no clause at all: not 'no call sites', not '0', not 'unknown'",
  );
});

test("contract §'What gets planted': a body-local row never carries a call-site count", () => {
  const card = makeCard({
    languageId: "typescript",
    headLine: LONG_START,
    spec: { nesting: flagged("nesting", [{ line: 601, detail: "the body nests 3 blocks deep" }]) },
    blast: { nesting: 9 },
  });
  const plan = planInjection(LONG_TS_REGION, LONG_START, card, NONE_HELD);
  assert.ok(!SIGNATURE_LEVEL.has("nesting"), "fixture premise: nesting is body-local");
  assert.strictEqual(
    attachments(plan.text, "//")[0].trailing,
    false,
    "the comment was planted above, so a missing clause below is a real absence",
  );
  assert.doesNotMatch(
    comments(plan.text, "//")[0].prose,
    /call site/i,
    "blastRadius rides signature-level rows ONLY; a nesting fix stays inside the function",
  );
});

// ===========================================================================
// Stripping
// ===========================================================================

const STRIPPABLE_TS = [
  "export function widen(a: number, b: number): number {",
  "  // C80 clock: stale words from an earlier run. Untestable. Pass it in.",
  "  const now = Date.now(); // C80 world: another stale one. Inject the reader.",
  "  // an ordinary comment that is nobody's business but the author's",
  "  return a + b; // TODO: the author's own note",
  "}",
];

test("contract §'Idempotence': a whole-line C80 comment is stripped and counted", () => {
  const card = makeCard({ languageId: "typescript", headLine: TS_START });
  const plan = planInjection(STRIPPABLE_TS, TS_START, card, NONE_HELD);
  assert.strictEqual(plan.stripped, 2, "one whole-line and one trailing C80 comment");
  assert.doesNotMatch(plan.text, /C80 /, "no C80 comment survives the strip");
  assert.doesNotMatch(plan.text, /stale words from an earlier run/, "the words went with it");
});

test("contract §'Idempotence': stripping a trailing comment leaves NO trailing whitespace", () => {
  const card = makeCard({ languageId: "typescript", headLine: TS_START });
  const out = planInjection(STRIPPABLE_TS, TS_START, card, NONE_HELD).text.split("\n");
  assert.ok(
    out.includes("  const now = Date.now();"),
    `the code line comes back exactly, with no dangling space: ${JSON.stringify(out)}`,
  );
  for (const line of out) {
    assert.doesNotMatch(line, /[ \t]+$/, `no line ends in whitespace: ${JSON.stringify(line)}`);
  }
});

test("Amendment 1 §2: a WRAPPED pre-existing comment counts as ONE stripped comment", () => {
  const region = [
    "export function widen(a: number, b: number): number {",
    "  // C80 nesting: the body nests 4 blocks deep, at or above the chosen",
    "  //     threshold of 4 for TypeScript. Split it.",
    "  // C80 clock: reads the wall clock. Untestable. Pass it in.",
    "  return a + b;",
    "}",
  ];
  const card = makeCard({ languageId: "typescript", headLine: TS_START });
  const plan = planInjection(region, TS_START, card, NONE_HELD);
  assert.strictEqual(
    plan.stripped,
    2,
    "three tagged lines, two criticisms; a human counts criticisms",
  );
  assert.doesNotMatch(plan.text, /C80 /, "and the head lines went");
  assert.doesNotMatch(
    plan.text,
    /threshold of 4 for TypeScript/,
    "the continuation went with its head, or the strip leaves an orphaned half-sentence",
  );
  assert.strictEqual(
    plan.text,
    [region[0], region[4], region[5]].join("\n"),
    "the code that was not a comment is untouched",
  );
});

test("Amendment 4: a hand-written comment beneath a head is NOT eaten by the strip", () => {
  const region = [
    "export function widen(a: number, b: number): number {",
    "  // C80 clock: reads the wall clock. Untestable. Pass it in.",
    "  // my own note, one space after the token",
    "  //     an indented note of my own",
    "  return a + b;",
    "}",
  ];
  const card = makeCard({ languageId: "typescript", headLine: TS_START });
  const plan = planInjection(region, TS_START, card, NONE_HELD);
  const out = plan.text.split("\n");
  assert.strictEqual(plan.stripped, 1, "one head, and the run stops at the first non-continuation");
  assert.ok(
    out.includes("  // my own note, one space after the token"),
    `one space is not four, so a person's comment survives: ${JSON.stringify(out)}`,
  );
  assert.ok(
    !out.includes("  // C80 clock: reads the wall clock. Untestable. Pass it in."),
    "and the head itself did go",
  );
});

test("contract §'Idempotence': a strip only takes C80 comments, and leaves every other comment alone", () => {
  const card = makeCard({ languageId: "typescript", headLine: TS_START });
  const out = planInjection(STRIPPABLE_TS, TS_START, card, NONE_HELD).text.split("\n");
  assert.ok(
    out.includes("  // an ordinary comment that is nobody's business but the author's"),
    "a plain comment line survives untouched",
  );
  assert.ok(
    out.includes("  return a + b; // TODO: the author's own note"),
    "a plain trailing comment survives untouched",
  );
  assert.strictEqual(out.length, STRIPPABLE_TS.length - 1, "exactly one line was removed");
});

test("contract §'Idempotence': a TAB-indented whole-line C80 comment is stripped too", () => {
  const region = [
    "func widen(a int, b int) int {",
    "\t// C80 clock: stale words from an earlier run. Untestable. Pass it in.",
    "\tnow := time.Now()\t// C80 world: a tab before the token. Inject the reader.",
    "\treturn a + b",
    "}",
  ];
  const card = makeCard({ languageId: "go", headLine: GO_START });
  const plan = planInjection(region, GO_START, card, NONE_HELD);
  assert.strictEqual(plan.stripped, 2, "tab indent and a tab before the token both strip");
  assert.doesNotMatch(plan.text, /C80 /, "nothing survived");
  assert.ok(
    plan.text.split("\n").includes("\tnow := time.Now()"),
    `the code line keeps its tab indent and loses its trailing tab: ${JSON.stringify(plan.text)}`,
  );
});

test("contract §'Idempotence': Python's `#` C80 comments strip, and a shebang-style comment does not", () => {
  const region = [
    "def widen(a, b):",
    "    # C80 clock: stale words from an earlier run. Untestable. Pass it in.",
    "    now = time.time()  # C80 world: another stale one. Inject the reader.",
    "    # noqa: E501 - the author's own note",
    "    return a + b",
  ];
  const card = makeCard({ languageId: "python", headLine: PY_START });
  const plan = planInjection(region, PY_START, card, NONE_HELD);
  assert.strictEqual(plan.stripped, 2, "both # C80 comments strip");
  assert.ok(
    plan.text.split("\n").includes("    now = time.time()"),
    "no trailing whitespace after the trailing strip",
  );
  assert.ok(
    plan.text.split("\n").includes("    # noqa: E501 - the author's own note"),
    "a non-C80 # comment survives",
  );
});

test("contract §'Nothing to say': a region that HAD comments and now has no findings still strips them", () => {
  const card = makeCard({ languageId: "typescript", headLine: TS_START });
  const plan = planInjection(STRIPPABLE_TS, TS_START, card, NONE_HELD);
  assert.strictEqual(plan.planted, 0, "no row is elevated, so nothing was planted");
  assert.ok(plan.stripped > 0, "but the old comments were removed");
  assert.notStrictEqual(
    plan.text,
    STRIPPABLE_TS.join("\n"),
    "that is a real proposal: the criticism was addressed and the comments should go",
  );
});

test("contract §'Nothing to say': planted, stripped and text are three separate answers", () => {
  const cleanRegionCleanCard = planInjection(
    TS_REGION,
    TS_START,
    makeCard({ languageId: "typescript", headLine: TS_START }),
    NONE_HELD,
  );
  const dirtyRegionCleanCard = planInjection(
    STRIPPABLE_TS,
    TS_START,
    makeCard({ languageId: "typescript", headLine: TS_START }),
    NONE_HELD,
  );
  const cleanRegionFlaggedCard = planInjection(
    TS_REGION,
    TS_START,
    makeCard({
      languageId: "typescript",
      headLine: TS_START,
      spec: { clock: flagged("clock", [{ line: 201, detail: "reads Date.now here" }]) },
    }),
    NONE_HELD,
  );
  assert.deepStrictEqual(
    [
      cleanRegionCleanCard.planted,
      cleanRegionCleanCard.stripped,
      cleanRegionCleanCard.text === TS_REGION.join("\n"),
    ],
    [0, 0, true],
    "nothing to say and nothing to remove: no proposal",
  );
  assert.deepStrictEqual(
    [dirtyRegionCleanCard.planted, dirtyRegionCleanCard.stripped > 0],
    [0, true],
    "nothing to say but something to remove: still a proposal",
  );
  assert.deepStrictEqual(
    [cleanRegionFlaggedCard.planted, cleanRegionFlaggedCard.stripped],
    [1, 0],
    "something to say and nothing to remove",
  );
});

// ===========================================================================
// Idempotence
// ===========================================================================

/** Replans over the previous plan's own text, the way a second press does. */
function replan(regionLines, startLine, card, policy, times) {
  let lines = regionLines.slice();
  const plans = [];
  for (let i = 0; i < times; i++) {
    const plan = planInjection(lines, startLine, card, policy);
    plans.push(plan);
    lines = plan.text.split("\n");
  }
  return plans;
}

const BUSY_CARD = () =>
  makeCard({
    languageId: "typescript",
    headLine: TS_START,
    spec: {
      "param-count": flagged("param-count", [
        { line: 200, detail: "asks the caller for 2 parameters" },
      ]),
      clock: flagged("clock", [{ line: 201, detail: "reads Date.now here" }]),
      world: flagged("world", [
        { line: 203, detail: "opens a file here" },
        { line: 205, detail: "reads a directory here" },
      ]),
      nesting: flagged("nesting", [
        {
          line: 202,
          detail:
            "the body nests 4 blocks deep, at or above the chosen threshold of 4 for TypeScript, which is more than a reader holds",
        },
      ]),
      undocumented: flagged("undocumented", [
        { line: 197, detail: "public and carries no doc comment" },
      ]),
    },
    blast: { clock: 3, "param-count": 12 },
  });

test("contract §'Idempotence': plan twice, and the second plan's text equals the first", () => {
  const [first, second] = replan(TS_REGION, TS_START, BUSY_CARD(), NONE_HELD, 2);
  assert.ok(first.planted > 0, "the fixture actually plants something");
  assert.strictEqual(second.text, first.text, "the second press does not double the comments");
  assert.strictEqual(second.planted, first.planted, "it plants the same number");
  assert.strictEqual(
    second.stripped,
    first.planted,
    "Amendment 1 §2: stripped counts COMMENTS, so the second press strips exactly the first press's comments, before mapping the findings again",
  );
});

test("contract §'Idempotence': the second press strips exactly what the first press planted", () => {
  // Three short details, three separate lines, three comments either way you
  // count them.
  const card = makeCard({
    languageId: "typescript",
    headLine: TS_START,
    spec: {
      clock: flagged("clock", [{ line: 201, detail: "reads Date.now here" }]),
      world: flagged("world", [
        { line: 203, detail: "opens a file here" },
        { line: 205, detail: "reads a directory here" },
      ]),
    },
  });
  const [first, second] = replan(TS_REGION, TS_START, card, NONE_HELD, 2);
  assert.strictEqual(first.planted, 3, "three findings planted");
  assert.strictEqual(first.stripped, 0, "the region arrived clean");
  assert.strictEqual(second.stripped, 3, "the second press removed the first press's three");
  assert.strictEqual(second.planted, 3, "and put three back");
  assert.strictEqual(second.text, first.text, "so the text did not move");
});

test("contract §'Idempotence': ten presses leave the comments the first press left", () => {
  const plans = replan(TS_REGION, TS_START, BUSY_CARD(), NONE_HELD, 10);
  const firstText = plans[0].text;
  for (let i = 1; i < plans.length; i++) {
    assert.strictEqual(plans[i].text, firstText, `press ${i + 1} matches press 1`);
    assert.strictEqual(plans[i].planted, plans[0].planted, `press ${i + 1} plants the same count`);
  }
  const headTotal = DIMS.reduce((n, d) => n + headCount(firstText, d), 0);
  assert.strictEqual(
    DIMS.reduce((n, d) => n + headCount(plans[9].text, d), 0),
    headTotal,
    "the tenth press has not buried the code",
  );
});

test("contract §'Idempotence': the findings still map correctly after a strip, on tabs and on `#`", () => {
  const goCard = makeCard({
    languageId: "go",
    headLine: GO_START,
    spec: {
      clock: flagged("clock", [{ line: 401, detail: "reads time.Now here" }]),
      nesting: flagged("nesting", [{ line: 403, detail: "the body nests 2 blocks deep" }]),
    },
  });
  const pyCard = makeCard({
    languageId: "python",
    headLine: PY_START,
    spec: {
      "param-count": flagged("param-count", [{ line: 300, detail: "asks the caller for 2 parameters" }]),
      clock: flagged("clock", [{ line: 302, detail: "reads time.time here" }]),
    },
  });
  const go = replan(GO_REGION, GO_START, goCard, NONE_HELD, 3);
  const py = replan(PY_REGION, PY_START, pyCard, NONE_HELD, 3);
  assert.strictEqual(go[2].text, go[0].text, "Go, tabs and all, is stable across three presses");
  assert.strictEqual(py[2].text, py[0].text, "Python is stable across three presses");
  assert.deepStrictEqual(
    attachments(go[2].text, "//").map((a) => a.code),
    attachments(go[0].text, "//").map((a) => a.code),
    "the third press attached every comment to the same line as the first",
  );
  assert.deepStrictEqual(
    attachments(py[2].text, "#").map((a) => a.code),
    attachments(py[0].text, "#").map((a) => a.code),
    "and Python did too, which only holds if the mapping runs on the STRIPPED region",
  );
});

test("contract §'Idempotence': a re-run over hand-edited comments replaces rather than stacks", () => {
  const first = planInjection(TS_REGION, TS_START, BUSY_CARD(), NONE_HELD);
  const meddled = first.text
    .split("\n")
    .map((l) => (l.includes("C80 clock: ") ? l.replace("C80 clock: ", "C80 clock: EDITED ") : l));
  const second = planInjection(meddled, TS_START, BUSY_CARD(), NONE_HELD);
  assert.strictEqual(second.text, first.text, "the edited comment was replaced, not kept alongside");
  assert.doesNotMatch(second.text, /EDITED/, "the hand edit is gone, not duplicated");
});

// ===========================================================================
// Line endings
// ===========================================================================

test("contract §'Line endings': no fixture, in any language, produces a \\r", () => {
  const cases = [
    [TS_REGION, TS_START, BUSY_CARD(), NONE_HELD],
    [STRIPPABLE_TS, TS_START, makeCard({ languageId: "typescript", headLine: TS_START }), NONE_HELD],
    [
      PY_REGION,
      PY_START,
      makeCard({
        languageId: "python",
        headLine: PY_START,
        spec: { clock: flagged("clock", [{ line: 302, detail: "reads time.time here" }]) },
      }),
      NONE_HELD,
    ],
    [
      GO_REGION,
      GO_START,
      makeCard({
        languageId: "go",
        headLine: GO_START,
        spec: { world: flagged("world", [{ line: 403, detail: "opens a file here" }]) },
      }),
      NONE_HELD,
    ],
  ];
  for (const [lines, start, card, policy] of cases) {
    // planInjection already asserts the absence of \r; this pins that the
    // cases above actually ran and produced text.
    const plan = planInjection(lines, start, card, policy);
    assert.ok(plan.text.length > 0, "each case produced text");
  }
});
