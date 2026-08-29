// White-box: the Criticize injection planner (session-v62 phase 2).
//
// This is the module that decides what lands in a person's source file, so the
// properties it has to carry are the ones a developer notices the second time
// they press the gesture:
//
//  - IDEMPOTENCE IS THE WHOLE FEATURE. Press twice, accept twice, and the
//    function has what it had after the first accept. That only holds if the
//    strip pass takes back exactly what the plant pass wrote, and if the
//    findings are mapped onto the STRIPPED region rather than the incoming one.
//  - NOTHING VANISHES. A finding whose line falls outside the region attaches
//    to the region's first line. A card that says three failures and a diff
//    that shows two is the worst outcome this module has.
//  - THREE FIELDS, THREE ANSWERS. planted 0 / stripped 0 is "no proposal";
//    planted 0 / stripped > 0 is "the criticism was addressed, take the
//    comments out". Collapsing them loses a real proposal.
//
// Placement is ONE rule since the human's ruling of 2026-08-28: every comment
// goes directly above its offending line, at that line's own indent. There is
// no trailing form. The trailing STRIP survives, because a previous build could
// have planted one and a person can hand-write one.
//
// A wrapped comment is ONE tag and a hanging indent, not a tag per line. Two
// `C80` heads read as two findings and saw the sentence in half, so the shape
// tested here is the contract's own specimen: continuation prose starts at the
// same column as the head's prose.
//
// Run: node --test test/impl-v62-p2-planner.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-v62-p2-planner",
  `export * from "../src/core/criticizePlan";
export { VOICE, C80_TAG, VOICE_COLUMN } from "../src/core/criticizeVoice";
export { signatureLevel } from "../src/core/criticizeScore";\n`,
);
test.after(cleanup);

const { planInjection, VOICE, C80_TAG, VOICE_COLUMN, signatureLevel } = mod;

/** The fourteen in rubric reading order, retyped. Retyped deliberately: this IS
 *  "card order" for the several-findings-on-one-line rule, and a list imported
 *  from the module under test could not notice the order moving. */
const DIMENSIONS = [
  "clock", "prng", "env", "world",
  "adjacent-params", "bool-param", "param-count",
  "undocumented", "unenforced-precondition", "cqs",
  "pass-through", "nesting",
  "unadmitted-failure",
  "section-comment",
];

const GROUP_OF = {
  clock: "honesty", prng: "honesty", env: "honesty", world: "honesty",
  "adjacent-params": "signature-empathy", "bool-param": "signature-empathy",
  "param-count": "signature-empathy",
  undocumented: "contract", "unenforced-precondition": "contract", cqs: "contract",
  "pass-through": "altitude", nesting: "altitude", "section-comment": "altitude",
  "unadmitted-failure": "safety",
};

const NONE_HELD = { held: [] };

const flagged = (dim, findings) => ({
  state: "flagged",
  findings: findings.map((f) => ({
    dimension: dim,
    line: f.line,
    evidence: f.evidence ?? "someCall()",
    detail: f.detail,
  })),
});

const blind = (dim) => ({ state: "blind", reason: `${dim}: this language cannot answer that` });

/** A whole fourteen-row card in rubric order. `elevated` is filled in the way
 *  `scoreFunction` fills it unless the caller deliberately corrupts it. */
function makeCard(opts) {
  const spec = opts.spec ?? {};
  const blast = opts.blast ?? {};
  const override = opts.elevatedOverride ?? {};
  return {
    name: opts.name ?? "widen",
    languageId: opts.languageId,
    headLine: opts.headLine,
    rows: DIMENSIONS.map((dim) => {
      const outcome = spec[dim] ?? { state: "clean" };
      const row = {
        dimension: dim,
        title: `title for ${dim}`,
        group: GROUP_OF[dim],
        source: `curriculum line for ${dim}`,
        outcome,
        elevated: dim in override ? override[dim] : outcome.state === "flagged",
      };
      if (dim in blast) row.blastRadius = blast[dim];
      return row;
    }),
  };
}

// ---------------------------------------------------------------------------
// Fixtures in three shapes: a `//` language on spaces, a `#` language, and a
// `//` language on TABS. Go and Rust indent with tabs, and an indent copied as
// spaces misaligns every comment this module plants in them.
// ---------------------------------------------------------------------------

const TS_START = 200;
const TS_REGION = [
  "export function widen(a: number, b: number): number {", // 200
  "  const now = Date.now();",                             // 201
  "  if (a > b) {",                                        // 202
  "    return a;",                                         // 203
  "  }",                                                   // 204
  "  return b;",                                           // 205
  "}",                                                     // 206
];

const PY_START = 300;
const PY_REGION = [
  "def widen(a, b):",          // 300
  '    """Widen a to b."""',   // 301
  "    now = time.time()",     // 302
  "    return a + b",          // 303
];

const GO_START = 400;
const GO_REGION = [
  "func widen(a int, b int) int {", // 400
  "\tnow := time.Now()",            // 401
  "\tif a > b {",                   // 402
  "\t\treturn a",                   // 403
  "\t}",                            // 404
  "\treturn b",                     // 405
  "}",                              // 406
];

const tokenFor = (languageId) => (languageId === "python" ? "#" : "//");
const indentOf = (line) => /^[ \t]*/.exec(line)[0];

/** Lines in the plan that were not in the input, as a multiset difference. */
function addedLines(input, out) {
  const counts = new Map();
  for (const l of input) counts.set(l, (counts.get(l) || 0) + 1);
  const added = [];
  for (const l of out) {
    const c = counts.get(l) || 0;
    if (c > 0) counts.set(l, c - 1);
    else added.push(l);
  }
  return added;
}

/** True when the line opens a criticism: the token, the tag, then one of the
 *  fourteen dimension ids. */
function headOf(line, token) {
  const trimmed = line.trim();
  const marker = `${token} ${C80_TAG}`;
  if (!trimmed.startsWith(marker)) return undefined;
  const m = /^([a-z][a-z-]*): /.exec(trimmed.slice(marker.length));
  return m !== null && DIMENSIONS.includes(m[1]) ? m[1] : undefined;
}

/** True when the line hangs under a head: the token, then the hanging indent.
 *  A hand-written `// my own note` has ONE space and is not this. */
function isContinuation(line, token) {
  return new RegExp(`^[ \\t]*${token === "#" ? "#" : "//"} {2,}\\S`).test(line);
}

/** One entry per comment, in output order: the dimension, the lines the comment
 *  occupies, and the code line it sits above. */
function comments(text, token) {
  const lines = text.split("\n");
  const kind = lines.map((l) =>
    headOf(l, token) !== undefined
      ? "head"
      : isContinuation(l, token)
        ? "cont"
        : "code",
  );
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (kind[i] !== "head") continue;
    let end = i + 1;
    while (end < lines.length && kind[end] === "cont") end++;
    let code = end;
    while (code < lines.length && kind[code] !== "code") code++;
    out.push({
      dim: headOf(lines[i], token),
      lines: lines.slice(i, end),
      code: code < lines.length ? lines[code] : "",
      at: i,
    });
  }
  return out;
}

/** Kept for the cases that only care where a comment landed. */
const attachments = (text, token) => comments(text, token);

/** The prose of one comment, indent, token, tag and hanging indent removed, as
 *  one sentence group. A wrapped comment is NOT byte-contiguous in the file. */
function proseOf(comment, token) {
  return comment.lines
    .map((l, i) =>
      i === 0
        ? l.trim().slice(`${token} ${C80_TAG}`.length)
        : l.trim().slice(token.length).trim(),
    )
    .join(" ")
    .replace(/\s+/g, " ");
}

const headCount = (text, dim) =>
  text.split("\n").filter((l) => l.includes(`${C80_TAG}${dim}: `)).length;

// ===========================================================================
// The exported surface
// ===========================================================================

test("planInjection is exported and returns the three fields", () => {
  assert.strictEqual(typeof planInjection, "function");
  const plan = planInjection(TS_REGION, TS_START, makeCard({ languageId: "typescript", headLine: TS_START }), NONE_HELD);
  assert.strictEqual(typeof plan.text, "string");
  assert.ok(Number.isInteger(plan.planted));
  assert.ok(Number.isInteger(plan.stripped));
});

test("the module never imports vscode, and is pure of the clock and of I/O", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "src", "core", "criticizePlan.ts"),
    "utf8",
  );
  assert.doesNotMatch(src, /from\s+"vscode"/, "src/core never imports vscode");
  // Comments out first: the module's own header quotes a `Date.now` specimen of
  // the criticism it plants, and a scan that cannot tell prose from code would
  // read that as the module reading the clock.
  const code = src
    .split("\n")
    .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
    .join("\n");
  assert.doesNotMatch(code, /Date\.now|Math\.random|require\(|fs\./, "no clock, no randomness, no I/O");
});

test("an empty region returns the empty plan and does not throw", () => {
  const plan = planInjection([], 10, makeCard({ languageId: "typescript", headLine: 10 }), NONE_HELD);
  assert.deepStrictEqual(plan, { text: "", planted: 0, stripped: 0 });
});

// ===========================================================================
// What plants
// ===========================================================================

test("an all-clean card returns the region unchanged, and both counts are zero", () => {
  const plan = planInjection(TS_REGION, TS_START, makeCard({ languageId: "typescript", headLine: TS_START }), NONE_HELD);
  assert.strictEqual(plan.text, TS_REGION.join("\n"), "text is the region, joined with \\n");
  assert.strictEqual(plan.planted, 0);
  assert.strictEqual(plan.stripped, 0);
});

test("text carries no trailing newline: the presenter splices it into a span", () => {
  const plan = planInjection(TS_REGION, TS_START, makeCard({ languageId: "typescript", headLine: TS_START }), NONE_HELD);
  assert.doesNotMatch(plan.text, /\n$/);
});

test("a blind row is a refusal and plants nothing", () => {
  const card = makeCard({
    languageId: "typescript",
    headLine: TS_START,
    spec: { clock: blind("clock"), world: blind("world") },
  });
  const plan = planInjection(TS_REGION, TS_START, card, NONE_HELD);
  assert.strictEqual(plan.planted, 0, "a refusal does not belong in source");
  assert.strictEqual(plan.text, TS_REGION.join("\n"));
});

test("the POLICY decides, and a stale row.elevated of false does not suppress a flagged row", () => {
  const card = makeCard({
    languageId: "typescript",
    headLine: TS_START,
    spec: { clock: flagged("clock", [{ line: 201, detail: "reads the wall clock" }]) },
    elevatedOverride: { clock: false },
  });
  assert.strictEqual(
    planInjection(TS_REGION, TS_START, card, NONE_HELD).planted,
    1,
    "row.elevated is a stale convenience; criticizeRender ignores it for the same reason",
  );
});

test("the POLICY decides, and a stale row.elevated of true does not resurrect a held row", () => {
  const card = makeCard({
    languageId: "typescript",
    headLine: TS_START,
    spec: { nesting: flagged("nesting", [{ line: 202, detail: "the body nests 3 blocks deep" }]) },
    elevatedOverride: { nesting: true },
  });
  assert.strictEqual(planInjection(TS_REGION, TS_START, card, { held: ["nesting"] }).planted, 0);
});

test("one comment per FINDING, not per row, each at its own document line", () => {
  const card = makeCard({
    languageId: "typescript",
    headLine: TS_START,
    spec: {
      world: flagged("world", [
        { line: 201, detail: "opens a file" },
        { line: 203, detail: "reads a directory" },
        { line: 205, detail: "writes a file" },
      ]),
    },
  });
  const plan = planInjection(TS_REGION, TS_START, card, NONE_HELD);
  assert.strictEqual(plan.planted, 3);
  assert.strictEqual(headCount(plan.text, "world"), 3);
  assert.deepStrictEqual(
    attachments(plan.text, "//").map((a) => a.code),
    ["  const now = Date.now();", "    return a;", "  return b;"],
  );
});

test("planted is the SUM of findings across rows", () => {
  const card = makeCard({
    languageId: "typescript",
    headLine: TS_START,
    spec: {
      clock: flagged("clock", [{ line: 201, detail: "reads the wall clock" }]),
      world: flagged("world", [
        { line: 203, detail: "opens a file" },
        { line: 205, detail: "reads a directory" },
      ]),
    },
  });
  assert.strictEqual(planInjection(TS_REGION, TS_START, card, NONE_HELD).planted, 3);
});

// ===========================================================================
// Placement: above the line, at that line's own indent, always
// ===========================================================================

test("a comment sits DIRECTLY above its line, and the line itself is untouched", () => {
  const card = makeCard({
    languageId: "typescript",
    headLine: TS_START,
    spec: { clock: flagged("clock", [{ line: 203, detail: "reads the wall clock" }]) },
  });
  const plan = planInjection(TS_REGION, TS_START, card, NONE_HELD);
  const lines = plan.text.split("\n");
  const at = lines.indexOf("    return a;");
  assert.ok(at > 0, "the offending line survives, byte for byte");
  const [comment] = comments(plan.text, "//");
  assert.strictEqual(comments(plan.text, "//").length, 1, "one criticism, not two");
  assert.strictEqual(comment.dim, "clock");
  assert.strictEqual(
    comment.at + comment.lines.length,
    at,
    "the comment's last line is the line before the offending one: nothing sits between them",
  );
});

test("a short code line takes the comment ABOVE it too: there is no trailing form", () => {
  const region = ["function f() {", "  a();", "}"];
  const card = makeCard({
    languageId: "typescript",
    headLine: 700,
    spec: { clock: flagged("clock", [{ line: 701, detail: "reads the wall clock" }]) },
  });
  const plan = planInjection(region, 700, card, NONE_HELD);
  assert.ok(
    plan.text.split("\n").includes("  a();"),
    "the six-column code line comes back byte for byte, with nothing appended",
  );
  assert.strictEqual(
    attachments(plan.text, "//")[0].code,
    "  a();",
    "even where a trailing comment would have fitted, the comment goes above",
  );
});

test("the indent is the OFFENDING line's own, not the region's and not zero", () => {
  const card = makeCard({
    languageId: "typescript",
    headLine: TS_START,
    spec: { clock: flagged("clock", [{ line: 203, detail: "reads the wall clock" }]) },
  });
  const lines = planInjection(TS_REGION, TS_START, card, NONE_HELD).text.split("\n");
  const at = lines.indexOf("    return a;");
  assert.strictEqual(indentOf(lines[at - 1]), "    ");
});

test("TAB indent is copied as TABS, because Go and Rust are indented with them", () => {
  const card = makeCard({
    languageId: "go",
    headLine: GO_START,
    spec: { world: flagged("world", [{ line: 403, detail: "opens a file" }]) },
  });
  const lines = planInjection(GO_REGION, GO_START, card, NONE_HELD).text.split("\n");
  const at = lines.indexOf("\t\treturn a");
  assert.ok(at > 0);
  assert.strictEqual(indentOf(lines[at - 1]), "\t\t", "spaces here would misalign every Go comment");
});

test("Python gets `#`, and never a `//` that is not a comment there", () => {
  const card = makeCard({
    languageId: "python",
    headLine: PY_START,
    spec: { clock: flagged("clock", [{ line: 302, detail: "reads the wall clock" }]) },
  });
  const plan = planInjection(PY_REGION, PY_START, card, NONE_HELD);
  assert.match(plan.text, new RegExp(`# ${C80_TAG}clock: `));
  assert.doesNotMatch(plan.text, /\/\//);
  const lines = plan.text.split("\n");
  assert.strictEqual(indentOf(lines[lines.indexOf("    now = time.time()") - 1]), "    ");
});

test("several findings on ONE line each get their own comment above it, in card order", () => {
  const card = makeCard({
    languageId: "typescript",
    headLine: TS_START,
    spec: {
      nesting: flagged("nesting", [{ line: 201, detail: "the body nests 3 blocks deep" }]),
      clock: flagged("clock", [{ line: 201, detail: "reads the wall clock" }]),
      world: flagged("world", [{ line: 201, detail: "opens a file" }]),
    },
  });
  const plan = planInjection(TS_REGION, TS_START, card, NONE_HELD);
  assert.strictEqual(plan.planted, 3);
  assert.deepStrictEqual(
    attachments(plan.text, "//").map((a) => a.dim),
    ["clock", "world", "nesting"],
    "honesty rows before the altitude row, which is the order the card lists them",
  );
  const lines = plan.text.split("\n");
  assert.ok(lines.every((l) => !l.startsWith("  const now = Date.now(); ")), "none went trailing");
});

test("two findings of the same dimension on one line both render: it fired twice", () => {
  const card = makeCard({
    languageId: "typescript",
    headLine: TS_START,
    spec: {
      world: flagged("world", [
        { line: 201, detail: "opens a file" },
        { line: 201, detail: "reads a directory" },
      ]),
    },
  });
  const plan = planInjection(TS_REGION, TS_START, card, NONE_HELD);
  assert.strictEqual(plan.planted, 2, "no dedupe: one comment per finding is the rule");
  assert.ok(plan.text.includes("opens a file"));
  assert.ok(plan.text.includes("reads a directory"));
});

// ===========================================================================
// The region rule
// ===========================================================================

test("a finding on the FIRST region line lands there: adjacent-params and param-count fire on the head", () => {
  const card = makeCard({
    languageId: "typescript",
    headLine: TS_START,
    spec: { "param-count": flagged("param-count", [{ line: TS_START, detail: "asks for 2 parameters" }]) },
  });
  const plan = planInjection(TS_REGION, TS_START, card, NONE_HELD);
  assert.strictEqual(plan.planted, 1);
  assert.strictEqual(attachments(plan.text, "//")[0].code, TS_REGION[0]);
});

test("a finding on the LAST region line lands there", () => {
  const last = TS_START + TS_REGION.length - 1;
  const card = makeCard({
    languageId: "typescript",
    headLine: TS_START,
    spec: { cqs: flagged("cqs", [{ line: last, detail: "returns and mutates" }]) },
  });
  const plan = planInjection(TS_REGION, TS_START, card, NONE_HELD);
  assert.strictEqual(attachments(plan.text, "//")[0].code, "}");
});

test("a finding ABOVE the region attaches to the region's first line and is never dropped", () => {
  const card = makeCard({
    languageId: "typescript",
    headLine: TS_START,
    spec: { undocumented: flagged("undocumented", [{ line: TS_START - 3, detail: "no doc comment" }]) },
  });
  const plan = planInjection(TS_REGION, TS_START, card, NONE_HELD);
  assert.strictEqual(plan.planted, 1, "the card says one failure, so the diff must show one");
  assert.strictEqual(attachments(plan.text, "//")[0].code, TS_REGION[0]);
});

test("a finding BELOW the region attaches to the region's FIRST line, not the last", () => {
  const card = makeCard({
    languageId: "typescript",
    headLine: TS_START,
    spec: { cqs: flagged("cqs", [{ line: TS_START + 99, detail: "returns and mutates" }]) },
  });
  const plan = planInjection(TS_REGION, TS_START, card, NONE_HELD);
  assert.strictEqual(attachments(plan.text, "//")[0].code, TS_REGION[0]);
});

test("a finding with a nonsense line number is still planted, at the first line", () => {
  for (const line of [undefined, Number.NaN, -4, 2.5]) {
    const card = makeCard({
      languageId: "typescript",
      headLine: TS_START,
      spec: { cqs: flagged("cqs", [{ line, detail: "returns and mutates" }]) },
    });
    const plan = planInjection(TS_REGION, TS_START, card, NONE_HELD);
    assert.strictEqual(plan.planted, 1, `line ${String(line)} still plants`);
    assert.strictEqual(attachments(plan.text, "//")[0].code, TS_REGION[0]);
  }
});

test("a one-line region takes a finding on it and one outside it", () => {
  const card = makeCard({
    languageId: "typescript",
    headLine: 500,
    spec: {
      cqs: flagged("cqs", [{ line: 500, detail: "returns and mutates" }]),
      "pass-through": flagged("pass-through", [{ line: 9000, detail: "adds no depth" }]),
    },
  });
  assert.strictEqual(planInjection(["  return a + b;"], 500, card, NONE_HELD).planted, 2);
});

// ===========================================================================
// The tag, the wrap, the detail
// ===========================================================================

const WRAPPING_DETAIL =
  "the body nests 4 blocks deep, at or above the chosen threshold of 4 for TypeScript, and every one of those branches has to be held at once";

test("ONE tag per criticism: a wrapped comment carries the head once, not on every line", () => {
  const card = makeCard({
    languageId: "typescript",
    headLine: TS_START,
    spec: { nesting: flagged("nesting", [{ line: 203, detail: WRAPPING_DETAIL }]) },
  });
  const plan = planInjection(TS_REGION, TS_START, card, NONE_HELD);
  const added = addedLines(TS_REGION, plan.text.split("\n"));
  assert.ok(added.length >= 3, `this comment must wrap: ${JSON.stringify(added)}`);
  assert.strictEqual(plan.planted, 1, "a wrapped comment is ONE planted comment");
  assert.strictEqual(
    added.filter((l) => l.includes(C80_TAG)).length,
    1,
    `two C80 heads read as two findings: ${JSON.stringify(added)}`,
  );
  assert.strictEqual(headCount(plan.text, "nesting"), 1, "one dimension head in the whole region");
});

test("a continuation hangs under the head: the token, then the width of `C80 `", () => {
  const card = makeCard({
    languageId: "typescript",
    headLine: TS_START,
    spec: { nesting: flagged("nesting", [{ line: 203, detail: WRAPPING_DETAIL }]) },
  });
  const plan = planInjection(TS_REGION, TS_START, card, NONE_HELD);
  const [comment] = comments(plan.text, "//");
  assert.ok(comment.lines.length >= 2, "it wrapped");
  // Where the head's PROSE starts, which is what a continuation hangs under.
  const headProse = comment.lines[0].indexOf(`${C80_TAG}nesting:`) + C80_TAG.length;
  for (const line of comment.lines.slice(1)) {
    assert.match(
      line,
      /^\s*\/\/ +\S/,
      `a continuation carries the token and nothing else: ${JSON.stringify(line)}`,
    );
    assert.doesNotMatch(line, new RegExp(C80_TAG), "and never a second tag");
    assert.strictEqual(
      /\S/.exec(line.slice(line.indexOf("//") + 2)).index + line.indexOf("//") + 2,
      headProse,
      `the prose hangs under the head's prose: ${JSON.stringify(comment.lines)}`,
    );
  }
});

test("a continuation cannot be confused with a comment somebody wrote", () => {
  const card = makeCard({
    languageId: "typescript",
    headLine: TS_START,
    spec: { nesting: flagged("nesting", [{ line: 203, detail: WRAPPING_DETAIL }]) },
  });
  const [comment] = comments(planInjection(TS_REGION, TS_START, card, NONE_HELD).text, "//");
  for (const line of comment.lines.slice(1)) {
    const spaces = /^\s*\/\/( +)/.exec(line)[1].length;
    assert.ok(
      spaces >= 4,
      `one space is what a hand-written comment has, and it must not match: ${JSON.stringify(line)}`,
    );
  }
});

test("wrapped lines respect the 80-column budget, tabs counted at their real cost", () => {
  const detail =
    "the body nests four blocks deep and the reader has to hold every one of those branches in their head while they read the rest of it";
  const card = makeCard({
    languageId: "go",
    headLine: GO_START,
    spec: { nesting: flagged("nesting", [{ line: 403, detail }]) },
  });
  const plan = planInjection(GO_REGION, GO_START, card, NONE_HELD);
  const added = addedLines(GO_REGION, plan.text.split("\n"));
  assert.ok(added.length >= 2, "it wrapped");
  for (const line of added) {
    const width = [...line].reduce((n, ch) => n + (ch === "\t" ? 4 : 1), 0);
    assert.ok(width <= VOICE_COLUMN, `${JSON.stringify(line)} is ${width} columns`);
  }
});

test("the detector's detail reaches the source verbatim, once the indent, token and tag come off", () => {
  const detail = "the body nests 4 blocks deep, at or above the chosen threshold of 4 for TypeScript";
  const card = makeCard({
    languageId: "typescript",
    headLine: TS_START,
    spec: { nesting: flagged("nesting", [{ line: 203, detail }]) },
  });
  const plan = planInjection(TS_REGION, TS_START, card, NONE_HELD);
  const prose = proseOf(comments(plan.text, "//")[0], "//").replace(/^nesting:\s*/, "");
  assert.ok(prose.startsWith(detail), `the detectors own that text: ${JSON.stringify(plan.text)}`);
});

test("the comment ends on the table's fix beat, so the order is the last thing read", () => {
  const card = makeCard({
    languageId: "typescript",
    headLine: TS_START,
    spec: { clock: flagged("clock", [{ line: 203, detail: "reads the wall clock" }]) },
    blast: { clock: 4 },
  });
  const plan = planInjection(TS_REGION, TS_START, card, NONE_HELD);
  const prose = proseOf(comments(plan.text, "//")[0], "//");
  assert.ok(prose.endsWith("Pass it in."), `got ${JSON.stringify(prose)}`);
});

// ===========================================================================
// Blast radius
// ===========================================================================

test("a measured radius rides a signature-level row", () => {
  const card = makeCard({
    languageId: "typescript",
    headLine: TS_START,
    spec: { clock: flagged("clock", [{ line: 203, detail: "reads the wall clock" }]) },
    blast: { clock: 7 },
  });
  assert.ok(signatureLevel("clock"), "fixture premise");
  assert.match(planInjection(TS_REGION, TS_START, card, NONE_HELD).text, /\b7 call sites\b/);
});

test("a measured 1 is singular and a measured 0 is words", () => {
  const withRadius = (n) =>
    makeCard({
      languageId: "typescript",
      headLine: TS_START,
      spec: { clock: flagged("clock", [{ line: 203, detail: "reads the wall clock" }]) },
      blast: { clock: n },
    });
  assert.match(planInjection(TS_REGION, TS_START, withRadius(1), NONE_HELD).text, /\b1 call site\b/);
  // A MEASURED zero renders as WORDS, which is phase 1's own spelling of it.
  // The point is that it is not silence: an unmeasured radius says nothing at
  // all, and the two may not share a spelling.
  assert.match(planInjection(TS_REGION, TS_START, withRadius(0), NONE_HELD).text, /No call sites\b/);
});

test("an absent radius says nothing about call sites", () => {
  const card = makeCard({
    languageId: "typescript",
    headLine: TS_START,
    spec: { clock: flagged("clock", [{ line: 203, detail: "reads the wall clock" }]) },
  });
  const plan = planInjection(TS_REGION, TS_START, card, NONE_HELD);
  assert.strictEqual(plan.planted, 1, "the row planted, so the absence below is not vacuous");
  assert.doesNotMatch(plan.text, /call site/);
});

test("a body-local row never carries a count, however the card was filled in", () => {
  const card = makeCard({
    languageId: "typescript",
    headLine: TS_START,
    spec: { nesting: flagged("nesting", [{ line: 203, detail: "the body nests 3 blocks deep" }]) },
    blast: { nesting: 9 },
  });
  assert.ok(!signatureLevel("nesting"), "fixture premise: a nesting fix stays inside the function");
  assert.doesNotMatch(planInjection(TS_REGION, TS_START, card, NONE_HELD).text, /call site/);
});

test("a corrupt radius is UNMEASURED and produces no clause, and phase 1 is never handed it", () => {
  // `1e21` is an integer and a non-negative one, and it renders `1e+21 call
  // sites`. Above 2^53 a count is not exactly representable, so it was never a
  // measurement and it does not get a measurement's spelling.
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -1, 2.5, "6", null, 1e21]) {
    const card = makeCard({
      languageId: "typescript",
      headLine: TS_START,
      spec: { clock: flagged("clock", [{ line: 203, detail: "reads the wall clock" }]) },
      blast: { clock: bad },
    });
    const plan = planInjection(TS_REGION, TS_START, card, NONE_HELD);
    assert.strictEqual(plan.planted, 1, `${String(bad)} still plants a comment`);
    assert.doesNotMatch(plan.text, /call site/, `${String(bad)} rendered a clause`);
  }
});

// ===========================================================================
// Stripping
// ===========================================================================

const STRIPPABLE_TS = [
  "export function widen(a: number, b: number): number {",
  "  // C80 clock: stale words from an earlier run. Untestable. Pass it in.",
  "  const now = Date.now(); // C80 world: a legacy trailing one. Inject the reader.",
  "  // an ordinary comment that is nobody's business but the author's",
  "  return a + b; // TODO: the author's own note",
  "}",
];

test("a whole-line C80 comment and a legacy trailing one both strip, and count one each", () => {
  const card = makeCard({ languageId: "typescript", headLine: TS_START });
  const plan = planInjection(STRIPPABLE_TS, TS_START, card, NONE_HELD);
  assert.strictEqual(plan.stripped, 2);
  assert.doesNotMatch(plan.text, /C80 /);
});

test("stripping a trailing comment leaves the code line with NO trailing whitespace", () => {
  const card = makeCard({ languageId: "typescript", headLine: TS_START });
  const out = planInjection(STRIPPABLE_TS, TS_START, card, NONE_HELD).text.split("\n");
  assert.ok(out.includes("  const now = Date.now();"));
  for (const line of out) assert.doesNotMatch(line, /[ \t]+$/);
});

test("a strip takes C80 comments and nothing else", () => {
  const card = makeCard({ languageId: "typescript", headLine: TS_START });
  const out = planInjection(STRIPPABLE_TS, TS_START, card, NONE_HELD).text.split("\n");
  assert.ok(out.includes("  // an ordinary comment that is nobody's business but the author's"));
  assert.ok(out.includes("  return a + b; // TODO: the author's own note"));
  assert.strictEqual(out.length, STRIPPABLE_TS.length - 1, "exactly one line went away");
});

test("a TAB-indented C80 line strips, and a tab before a legacy trailing token strips too", () => {
  const region = [
    "func widen(a int, b int) int {",
    "\t// C80 clock: stale words. Untestable. Pass it in.",
    "\tnow := time.Now()\t// C80 world: a tab before the token. Inject the reader.",
    "\treturn a + b",
    "}",
  ];
  const plan = planInjection(region, GO_START, makeCard({ languageId: "go", headLine: GO_START }), NONE_HELD);
  assert.strictEqual(plan.stripped, 2);
  assert.ok(plan.text.split("\n").includes("\tnow := time.Now()"), "the tab indent stays, the tab tail goes");
});

test("Python's `#` C80 comments strip, and its other `#` comments do not", () => {
  const region = [
    "def widen(a, b):",
    "    # C80 clock: stale words. Untestable. Pass it in.",
    "    now = time.time()  # C80 world: a legacy trailing one. Inject the reader.",
    "    # noqa: E501 - the author's own note",
    "    return a + b",
  ];
  const plan = planInjection(region, PY_START, makeCard({ languageId: "python", headLine: PY_START }), NONE_HELD);
  assert.strictEqual(plan.stripped, 2);
  assert.ok(plan.text.split("\n").includes("    now = time.time()"));
  assert.ok(plan.text.split("\n").includes("    # noqa: E501 - the author's own note"));
});

test("stripped counts COMMENTS, not lines: a wrapped C80 comment is one", () => {
  const detail =
    "the body nests 4 blocks deep, at or above the chosen threshold of 4 for TypeScript, and every branch has to be held at once";
  const card = makeCard({
    languageId: "typescript",
    headLine: TS_START,
    spec: { nesting: flagged("nesting", [{ line: 203, detail }]) },
  });
  const first = planInjection(TS_REGION, TS_START, card, NONE_HELD);
  const addedCount = addedLines(TS_REGION, first.text.split("\n")).length;
  assert.ok(addedCount >= 3, "the fixture wrapped onto several lines");
  const second = planInjection(first.text.split("\n"), TS_START, card, NONE_HELD);
  assert.strictEqual(second.stripped, 1, "a human counts criticisms, not lines");
});

test("a hand-written comment under a head is not eaten: one space is not the hanging indent", () => {
  const region = [
    "export function widen(a: number, b: number): number {",
    "  // C80 clock: stale words. Untestable. Pass it in.",
    "  // the author's own note, sitting right under it",
    "  return a + b;",
    "}",
  ];
  const plan = planInjection(region, TS_START, makeCard({ languageId: "typescript", headLine: TS_START }), NONE_HELD);
  assert.strictEqual(plan.stripped, 1, "one criticism went");
  assert.ok(
    plan.text.split("\n").includes("  // the author's own note, sitting right under it"),
    `the exact hanging indent is what keeps this line safe: ${JSON.stringify(plan.text)}`,
  );
});

test("a continuation is only a continuation inside a run a head opened", () => {
  const region = [
    "export function widen(a: number, b: number): number {",
    "  //     an aligned note of the author's own, under no head at all",
    "  return a + b;",
    "}",
  ];
  const plan = planInjection(region, TS_START, makeCard({ languageId: "typescript", headLine: TS_START }), NONE_HELD);
  assert.strictEqual(plan.text, region.join("\n"), "nothing above it was a criticism");
  assert.strictEqual(plan.stripped, 0);
});

test("the superseded tag-per-line shape still strips, so an older build's comments come out", () => {
  const region = [
    "export function widen(a: number, b: number): number {",
    "  // C80 clock: reads Date.now here. No call sites ride on this signature.",
    "  // C80 Hidden wall-clock read. Untestable. Pass it in.",
    "  return a + b;",
    "}",
  ];
  const plan = planInjection(region, TS_START, makeCard({ languageId: "typescript", headLine: TS_START }), NONE_HELD);
  assert.strictEqual(plan.stripped, 1, "one criticism, however its second line was spelled");
  assert.doesNotMatch(plan.text, /C80/, "no orphaned half-sentence is left behind");
});

test("a C80 tag inside a string literal is data, not criticism, and is not stripped", () => {
  const region = [
    "export function widen(a: number, b: number): number {",
    '  log("// C80 clock: this is data, not criticism");',
    "  return a + b;",
    "}",
  ];
  const plan = planInjection(region, TS_START, makeCard({ languageId: "typescript", headLine: TS_START }), NONE_HELD);
  assert.strictEqual(plan.text, region.join("\n"));
  assert.strictEqual(plan.stripped, 0);
});

test("planted 0 with stripped > 0 is a real proposal, and the text moved", () => {
  const plan = planInjection(STRIPPABLE_TS, TS_START, makeCard({ languageId: "typescript", headLine: TS_START }), NONE_HELD);
  assert.strictEqual(plan.planted, 0, "the criticism was addressed");
  assert.ok(plan.stripped > 0, "so the stale comments come out");
  assert.notStrictEqual(plan.text, STRIPPABLE_TS.join("\n"));
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

const BUSY_CARD = (languageId, headLine, lines) =>
  makeCard({
    languageId,
    headLine,
    spec: {
      "param-count": flagged("param-count", [{ line: headLine, detail: "asks for 2 parameters" }]),
      clock: flagged("clock", [{ line: headLine + 1, detail: "reads the wall clock" }]),
      world: flagged("world", [
        { line: headLine + 3, detail: "opens a file" },
        { line: headLine + 5, detail: "reads a directory" },
      ]),
      nesting: flagged("nesting", [
        {
          line: headLine + 2,
          detail: "the body nests 4 blocks deep, at or above the chosen threshold of 4, which is more than a reader holds",
        },
      ]),
      undocumented: flagged("undocumented", [{ line: headLine - 3, detail: "no doc comment" }]),
    },
    blast: { clock: 3, "param-count": 12 },
  });

test("ten presses leave exactly what the first press left, in all three shapes", () => {
  const cases = [
    ["typescript", TS_REGION, TS_START],
    ["go", GO_REGION, GO_START],
    ["python", PY_REGION, PY_START],
  ];
  for (const [languageId, region, start] of cases) {
    const card = BUSY_CARD(languageId, start, region);
    const plans = replan(region, start, card, NONE_HELD, 10);
    assert.ok(plans[0].planted > 0, `${languageId}: the fixture plants something`);
    for (let i = 1; i < plans.length; i++) {
      assert.strictEqual(plans[i].text, plans[0].text, `${languageId}: press ${i + 1} matches press 1`);
      assert.strictEqual(plans[i].planted, plans[0].planted, `${languageId}: same count`);
    }
  }
});

test("the second press strips exactly what the first press planted, and puts it back", () => {
  const card = makeCard({
    languageId: "typescript",
    headLine: TS_START,
    spec: {
      clock: flagged("clock", [{ line: 201, detail: "reads the wall clock" }]),
      world: flagged("world", [
        { line: 203, detail: "opens a file" },
        { line: 205, detail: "reads a directory" },
      ]),
    },
  });
  const [first, second] = replan(TS_REGION, TS_START, card, NONE_HELD, 2);
  assert.strictEqual(first.planted, 3);
  assert.strictEqual(first.stripped, 0, "the region arrived clean");
  assert.strictEqual(second.stripped, 3);
  assert.strictEqual(second.planted, 3);
  assert.strictEqual(second.text, first.text);
});

test("the findings map onto the STRIPPED region, so a second press attaches to the same lines", () => {
  const card = BUSY_CARD("go", GO_START, GO_REGION);
  const plans = replan(GO_REGION, GO_START, card, NONE_HELD, 3);
  assert.deepStrictEqual(
    attachments(plans[2].text, "//").map((a) => a.code),
    attachments(plans[0].text, "//").map((a) => a.code),
    "mapping against the incoming lines would drift the comments down the body",
  );
});

test("a hand-edited C80 comment is replaced, not kept alongside", () => {
  const card = BUSY_CARD("typescript", TS_START, TS_REGION);
  const first = planInjection(TS_REGION, TS_START, card, NONE_HELD);
  const meddled = first.text
    .split("\n")
    .map((l) => l.replace(`${C80_TAG}clock: `, `${C80_TAG}clock: EDITED `));
  const second = planInjection(meddled, TS_START, card, NONE_HELD);
  assert.strictEqual(second.text, first.text);
  assert.doesNotMatch(second.text, /EDITED/);
});

// ===========================================================================
// Line endings
// ===========================================================================

test("an incoming \\r is normalised out and none is ever emitted", () => {
  const region = TS_REGION.map((l) => `${l}\r`);
  const card = makeCard({
    languageId: "typescript",
    headLine: TS_START,
    spec: { clock: flagged("clock", [{ line: 201, detail: "reads the wall clock" }]) },
  });
  const plan = planInjection(region, TS_START, card, NONE_HELD);
  assert.doesNotMatch(plan.text, /\r/, "the presenter owns EOL through withDocumentEol");
  assert.strictEqual(plan.planted, 1);
});

// ===========================================================================
// The voice rules survive the join
// ===========================================================================

test("no comment this module can plant carries a citation, a hedge or a second person", () => {
  const BANNED = [
    "consider", "might", "maybe", "perhaps", "probably",
    "you", "your", "we", "our", "please", "just", "simply", "recommend", "suggest",
  ];
  for (const dim of DIMENSIONS) {
    const card = makeCard({
      languageId: "typescript",
      headLine: TS_START,
      spec: { [dim]: flagged(dim, [{ line: 203, detail: "" }]) },
      blast: { [dim]: 2024 },
    });
    const plan = planInjection(TS_REGION, TS_START, card, NONE_HELD);
    assert.strictEqual(plan.planted, 1, `${dim} plants`);
    const words = proseOf(comments(plan.text, "//")[0], "//");
    // The blast radius is a COUNT, so the year rule never applied to it. Strip
    // it before the citation check rather than capping a real measurement.
    const authored = words.replace(/\b2024 call sites\b/, "N call sites");
    assert.doesNotMatch(authored, /\b(19|20)\d{2}\b/, `${dim} carries a citation year`);
    assert.doesNotMatch(authored, /\?/, `${dim} asks a question`);
    for (const banned of BANNED) {
      assert.doesNotMatch(authored, new RegExp(`\\b${banned}\\b`, "i"), `${dim} says "${banned}"`);
    }
  }
});

test("all fourteen dimensions plant words, so none injects a blank comment", () => {
  for (const dim of DIMENSIONS) {
    assert.ok(typeof VOICE[dim] === "string" && VOICE[dim].length > 0, `${dim} has a phrase`);
    const card = makeCard({
      languageId: "typescript",
      headLine: TS_START,
      spec: { [dim]: flagged(dim, [{ line: 203, detail: "the detector's own words" }]) },
    });
    const plan = planInjection(TS_REGION, TS_START, card, NONE_HELD);
    assert.strictEqual(plan.planted, 1, `${dim} planted`);
    assert.strictEqual(headCount(plan.text, dim), 1, `${dim} has one head`);
  }
});
