// ADVERSARIAL REVIEW - session-v64 phases 10 and 12.
//
// Phase 10 turned the four honesty dimensions (clock, prng, env, world) from 67
// regexes into a model's judgement: `src/core/criticizeHonestyModel.ts`, the
// four refusing detectors in `src/core/criticizeHonesty.ts`, `applyHonesty` in
// `src/core/criticizeScore.ts`, and the reordered `runCriticize` / `withHonesty`
// / `withModelRounds` in `src/vscode/criticize.ts`.
//
// Phase 12 added a SECOND command in which the model writes the comment blocks
// and picks the lines: `src/core/criticizeAdvise.ts`, `planAdviceInjection` and
// the widened `isHead` in `src/core/criticizePlan.ts`, and
// `src/vscode/criticizeAdviseCommand.ts`.
//
// HOW TO READ THIS FILE. Every row is GREEN and asserts what the product does
// TODAY. A row whose name starts with `DEFECT` asserts observed behaviour that
// is wrong, and its assertion message names the WANTED behaviour; fixing the
// defect flips that row red, which is the point - it is the evidence, and the
// fixer turns the assertion around. A row whose name starts with `CONTROL`
// asserts behaviour that is correct and was attacked without success. That is
// the coverage half: a review that lists only hits says nothing about what was
// tried.
//
// Everything below drives the product's own slicer, scorer, view, region and
// strip pass, so a row that fires here is the product's reading of a file and
// not a fixture pretending to be one.
//
// Run: SKIP_LIVE=1 node --test test/adversarial-v64-p10p12.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");
const { bundleWithVscodeStub } = require("./.vscode-stub.cjs");

const core = bundleCore(
  "adv-v64-p10p12-core",
  `export { criticizeLangFor } from "../src/core/criticizeLang";
export { sliceFunction } from "../src/core/criticizeSlice";
export { scoreFunction, applyHonesty, DEFAULT_ELEVATION } from "../src/core/criticizeScore";
export { planInjection, planAdviceInjection, stripCriticism, ADVICE_SLUG } from "../src/core/criticizePlan";
export { placeAdvice, readAdviceReply, adviseFunction, buildAdvicePrompt, ADVICE_MAX_BLOCKS } from "../src/core/criticizeAdvise";
export { honestyOutcomes, readHonestyReply, judgeHonesty, buildHonestyPrompt, HONESTY_DIMENSIONS, HONESTY_DETAIL } from "../src/core/criticizeHonestyModel";
export { HONESTY_DETECTORS } from "../src/core/criticizeHonesty";
export { injectionRegion, scoringView, viewLineAtOrAfter, viewLineAtOrBefore } from "../src/core/criticizeGesture";
export { bodyLines } from "../src/core/criticizeTypes";
export { C80_TAG } from "../src/core/criticizeVoice";\n`,
);
const host = bundleWithVscodeStub(
  "adv-v64-p10p12-host",
  `export { registerCriticize, CRITICIZE_COMMAND_ID } from "../src/vscode/criticize";\n`,
);
test.after(() => {
  core.cleanup();
  host.cleanup();
});
const m = core.mod;

// ---------------------------------------------------------------------------
// Shared helpers. All of them go through the product's own slicer/view/region.
// ---------------------------------------------------------------------------

/** Slice a function out of the SCORING VIEW of a whole document, exactly as
 *  both gestures do. Returns everything a planner needs. */
function sliceInDocument(documentLines, languageId, name) {
  const lang = m.criticizeLangFor(languageId);
  const text = documentLines.join("\n");
  const view = m.scoringView(documentLines, languageId);
  const headDocLine = documentLines.findIndex((l) => new RegExp(`\\b${name}\\b`).test(l) && /\b(function|def|fn|func)\b/.test(l)) + 1;
  assert.ok(headDocLine > 0, `the fixture has no declaration line for ${name}`);
  let headOffset = 0;
  for (let i = 0; i < headDocLine - 1; i++) {
    headOffset += documentLines[i].length + 1;
  }
  headOffset += documentLines[headDocLine - 1].search(/\S/);
  const endDocLine = documentLines.length;
  const fn = m.sliceFunction(
    view.lines,
    m.viewLineAtOrAfter(view, headDocLine),
    m.viewLineAtOrBefore(view, endDocLine),
    name,
    lang,
  );
  assert.ok(fn !== undefined, `the slicer refused ${name}, so this row measures the fixture`);
  const region = m.injectionRegion(text, headOffset, text.length, languageId);
  return { lang, fn, view, region, text, regionStartInView: m.viewLineAtOrAfter(view, region.startLine) };
}

/** One press of the MODEL-AUTHORED path, below the model round: place the
 *  blocks, then plan the injection through the same region and strip pass the
 *  command uses. */
function pressAdvise(documentLines, languageId, name, blocks) {
  const ctx = sliceInDocument(documentLines, languageId, name);
  const outcome = m.placeAdvice(ctx.fn, blocks);
  const plan = m.planAdviceInjection(
    ctx.region.lines,
    ctx.regionStartInView,
    languageId,
    outcome.placed.map((e) => ({ line: e.line, dimension: e.block.dimension, text: e.block.text })),
  );
  const next = (ctx.text.slice(0, ctx.region.start) + plan.text + ctx.text.slice(ctx.region.end)).split("\n");
  return { ...ctx, outcome, plan, next };
}

// A TypeScript function with a doc comment, a clock read and a cache write: it
// fires real rubric rows and it has a doc comment for a block to anchor on.
const DOCUMENTED = [
  "const cache = new Map<string, number>();",
  "/** Records a hit. */",
  "export function touch(key: string): number {",
  "  const now = Date.now();",
  "  cache.set(key, now);",
  "  return now;",
  "}",
];

// ===========================================================================
// SECTION 1. `planAdviceInjection` does not clamp, and the unclamped case is
// reachable through the product's own slicer on the commonest shape there is.
// ===========================================================================

test("1a. DEFECT: a block the model anchored on the DOC COMMENT is placed, then silently dropped by planAdviceInjection", () => {
  const run = pressAdvise(DOCUMENTED, "typescript", "touch", [
    { dimension: "undocumented", anchor: "/** Records a hit. */", text: "the doc says nothing about the cache write." },
    { dimension: "clock", anchor: "const now = Date.now();", text: "pass the instant in." },
  ]);

  // The slicer walks UPWARD over the doc comment, so the doc line is inside the
  // unit and A8 makes it anchorable. `injectionRegion` starts at the
  // DECLARATION HEAD and reaches back only over PLANTED comments, so the doc
  // line is one line above the region.
  assert.strictEqual(run.outcome.placed.length, 2, "the fixture must place both blocks or this row measures nothing");
  assert.strictEqual(run.outcome.unplaced.length, 0);
  assert.strictEqual(run.fn.startLine, 2, "the slice must include the doc comment or this row measures nothing");
  assert.strictEqual(run.regionStartInView, 3, "the region must start at the declaration head or this row measures nothing");

  assert.strictEqual(
    run.plan.planted,
    1,
    "WANTED: a block placed on a line of the slice that falls above the injection region must not vanish. " +
      "planInjection's regionIndex attaches an out-of-region finding to the region's FIRST line precisely " +
      "because 'a card that says three failures beside a diff that shows two is the worst outcome this module " +
      "has'. planAdviceInjection drops it instead, and the header's justification ('the model's line did not " +
      "come from this product') is wrong: placeAdvice resolved that line against the real slice, so it did.",
  );
  assert.strictEqual(
    run.plan.text.includes("the doc says nothing"),
    false,
    "the doc-comment block's text never reaches the diff",
  );
});

test("1b. DEFECT: the dropped block leaves NO trace - it is not in `unplaced`, so the command's per-miss channel line never prints", () => {
  const run = pressAdvise(DOCUMENTED, "typescript", "touch", [
    { dimension: "undocumented", anchor: "/** Records a hit. */", text: "the doc says nothing about the cache write." },
    { dimension: "clock", anchor: "const now = Date.now();", text: "pass the instant in." },
  ]);
  // `runAdvise` logs one `block dropped, <reason>` line per entry in
  // `unplaced`, and nothing at all for a `placed` entry that the planner then
  // discards. So this loss is invisible on the only channel a developer reads.
  const dropped = run.outcome.placed.length - run.plan.planted;
  assert.strictEqual(dropped, 1);
  assert.strictEqual(
    run.outcome.unplaced.length,
    0,
    "WANTED: a block that is placed and then discarded by the planner must be reported somewhere - " +
      "either clamped into the region like a detector finding, or moved into `unplaced` with a reason so " +
      "`runAdvise`'s existing `block dropped` loop prints it. Today it is placed, counted as placed, and " +
      "then vanishes between two functions with no line on the channel.",
  );
});

test("1c. DEFECT: when EVERY block is anchored on the doc comment the gesture ends on `nothing to propose` and the human is told nothing at all", () => {
  const run = pressAdvise(DOCUMENTED, "typescript", "touch", [
    { dimension: "undocumented", anchor: "/** Records a hit. */", text: "this contract is a lie: it never mentions the cache." },
  ]);
  assert.strictEqual(run.outcome.placed.length, 1, "the block must place or this row measures nothing");
  assert.strictEqual(run.plan.planted, 0);
  assert.strictEqual(run.plan.stripped, 0);
  // `runAdvise` reaches `proposeAdvice` because `outcome.placed.length !== 0`,
  // and `proposeAdvice` then logs `nothing to propose` and returns with NO
  // toast. The model answered, found something, named a real line of the
  // function, and the developer sees nothing.
  assert.strictEqual(
    run.plan.planted + run.plan.stripped,
    0,
    "the block is still outside the writable region, and it is still not planted",
  );
  // PARTIALLY FIXED 2026-08-29, and this is the half a plan-level row can see.
  // The block is still lost, because clamping it into the region would put a
  // comment ABOUT the doc block underneath the doc block and break the one
  // guarantee this path rests on. What changed is that it is no longer SILENT:
  // `planAdviceInjection` reports the line it could not take, `runAdvise` prints
  // it, and the "nothing to propose" branch now carries a toast naming the doc
  // comment as the cause. Widening the region to include the doc block is the
  // real fix and it is filed as S64-21.
  assert.deepStrictEqual(
    run.plan.outsideRegion,
    [run.outcome.placed[0].line],
    "WANTED and NOW TRUE: a block the region cannot take is named, not swallowed. A dropped block " +
      "with no entry anywhere is a comment the model wrote, the product resolved to a real line, " +
      "and nobody ever heard about.",
  );
});

test("1-control. the RUBRIC path does not lose a finding on the same line: planInjection clamps it into the region", () => {
  const ctx = sliceInDocument(DOCUMENTED, "typescript", "touch");
  const card = m.scoreFunction(ctx.fn, ctx.lang);
  // A finding on the doc-comment line, in the same coordinate system the
  // advice block used. `undocumented` fires on the head; this forces the
  // above-region case directly.
  const forced = {
    ...card,
    rows: card.rows.map((row) =>
      row.dimension === "cqs"
        ? {
            ...row,
            outcome: {
              state: "flagged",
              findings: [{ dimension: "cqs", line: 2, evidence: "/** Records a hit. */", detail: "answers a question and changes the world" }],
            },
          }
        : row,
    ),
  };
  const plan = m.planInjection(ctx.region.lines, ctx.regionStartInView, forced, m.DEFAULT_ELEVATION);
  assert.strictEqual(plan.planted >= 1, true, "the rubric planner keeps an above-region finding");
  assert.strictEqual(
    plan.text.split("\n")[0].includes("C80 cqs:"),
    true,
    `the above-region finding must attach to the region's first line; got:\n${plan.text}`,
  );
});

// ===========================================================================
// SECTION 2. The head the strip pass cannot read back.
//
// `renderAdvice` wraps at column 80 with the tag riding the token, and
// `isHead` requires `<slug>:` followed by WHITESPACE. When the wrap breaks
// immediately after the colon the emitted head ends at the colon, and the
// strip pass no longer recognises a comment this product wrote.
// ===========================================================================

/** Plant one advice block above a line at a chosen indent, and read the head
 *  back through the strip pass. */
function plantAtIndent(indent, dimension, text) {
  const pad = " ".repeat(indent);
  const region = ["function f() {", `${pad}doThing();`, "}"];
  const plan = m.planAdviceInjection(region, 1, "typescript", [{ line: 2, dimension, text }]);
  const restrip = m.stripCriticism(plan.text.split("\n"), "typescript");
  return { plan, restrip, head: plan.text.split("\n")[1] };
}

test("2a. FIXED: every comment the advice path emits is recognised by its own strip pass, wrap or no wrap", () => {
  // 27 columns of indent is seven levels at four spaces, or a Rust
  // `impl`/`fn`/`match`/closure stack. `unenforced-precondition` is one of the
  // fourteen the prompt hands the model, and the prompt asks for a block written
  // "in this function's own identifiers", so a sentence opening on a real
  // identifier is the shape it was asked for.
  const run = plantAtIndent(27, "unenforced-precondition", "resolvePrefillDeadline is never checked before it is used here.");
  assert.strictEqual(run.plan.planted, 1, "the block must plant or this row measures nothing");
  assert.strictEqual(
    run.head.trimEnd().endsWith("unenforced-precondition:"),
    true,
    `the wrap must break at the colon for this row to measure anything; got ${JSON.stringify(run.head)}`,
  );
  // FIXED 2026-08-29: `isHead` accepts the slug's colon at END OF LINE as well
  // as followed by whitespace. The renderer wraps at column 80, so a head whose
  // first word is long enough breaks immediately after the colon and the head
  // line ends there. This row was the DEFECT evidence and is now the regression
  // guard.
  assert.strictEqual(
    run.restrip.stripped,
    1,
    "a comment this product emitted must be recognised by its own strip pass, even when the wrap " +
      "broke the head line at the colon",
  );
});

test("2b. FIXED: a wrapped comment does not stack on the next press", () => {
  const first = plantAtIndent(56, "unenforced-precondition", "check the argument before using it here.");
  assert.strictEqual(
    first.restrip.stripped,
    1,
    "precondition: the head must be RECOGNISED now, or this row is measuring the old defect",
  );
  // THE SECOND PRESS IS PLANNED IN THE PRODUCT'S COORDINATES, and this had to be
  // corrected when the fix landed. `planAdviceInjection` strips before it plants,
  // so a line number taken off the UNSTRIPPED text names a different line once
  // the comment comes out. The product never had that problem: `proposeAdvice`
  // takes its line numbers from the scoring VIEW, which is already stripped.
  // While the head was unrecognised nothing was stripped and the two coordinate
  // systems happened to agree, which is exactly the kind of accident a fix
  // exposes.
  const lines = first.plan.text.split("\n");
  const view = m.scoringView(lines, "typescript");
  const target = view.lines.findIndex((l) => l.includes("doThing();"));
  const second = m.planAdviceInjection(lines, 1, "typescript", [
    { line: target + 1, dimension: "unenforced-precondition", text: "check the argument before using it here." },
  ]);
  const heads = second.text.split("\n").filter((l) => l.includes("C80 unenforced-precondition:")).length;
  assert.strictEqual(
    heads,
    1,
    `one head after a second press: the strip pass takes the first one out. The second press produced:\n${second.text}`,
  );
  assert.strictEqual(second.stripped, 1, "and the channel's number is the number of comments in the diff");
});

test("2c. FIXED: the rubric's scoring view takes a wrapped advice comment OUT, so the detectors score the code", () => {
  const first = plantAtIndent(56, "unenforced-precondition", "check the argument before using it here.");
  const code = ["function f() {", `${" ".repeat(56)}doThing();`, "}"];
  const view = m.scoringView(first.plan.text.split("\n"), "typescript");
  const leaked = view.lines.filter((l) => /^\s*\/\//.test(l));
  assert.strictEqual(
    leaked.length,
    0,
    "`scoringView` exists so the rubric never scores the criticism a previous press planted (S62-7): a " +
      "documented Rust function read as undocumented because a planted block sat between the doc and the " +
      `head. Lines that survived the view:\n${view.lines.join("\n")}`,
  );
  assert.deepStrictEqual(view.lines, code, "the scoring view IS the code, with every planted line gone");
});

test("2-control. at ordinary indents the advice head IS recognised, so section 2 is about the wrap and not about the advice slug", () => {
  for (const indent of [0, 2, 4, 8, 12, 20]) {
    const run = plantAtIndent(indent, "unenforced-precondition", "resolvePrefillDeadline is never checked before it is used here.");
    assert.strictEqual(run.plan.planted, 1);
    assert.strictEqual(run.restrip.stripped, 1, `indent ${indent}: the planted head must strip back out; head=${JSON.stringify(run.head)}`);
  }
});

test("2-control2. the RUBRIC path's own comments survive the same wrap at the deepest indent a real fixture reaches", () => {
  // Twelve nested blocks, which is 26 columns of indent, scored and planted by
  // the real detectors. The rubric's opening words come from the fixed VOICE
  // table, so its head never breaks at the colon here.
  const lines = ["export function outer(): void {"];
  let ind = "  ";
  for (let i = 0; i < 12; i++) {
    lines.push(`${ind}if (true) {`);
    ind += "  ";
  }
  lines.push(`${ind}const now = Date.now();`);
  for (let i = 0; i < 12; i++) {
    ind = ind.slice(2);
    lines.push(`${ind}}`);
  }
  lines.push("}");
  const lang = m.criticizeLangFor("typescript");
  const fn = m.sliceFunction(lines, 1, lines.length, "outer", lang);
  const card = m.scoreFunction(fn, lang);
  const plan = m.planInjection(lines, 1, card, m.DEFAULT_ELEVATION);
  assert.ok(plan.planted >= 1, "the fixture must plant something");
  const restrip = m.stripCriticism(plan.text.split("\n"), "typescript");
  assert.strictEqual(restrip.stripped, plan.planted, "every rubric comment strips back out at 26 columns of indent");
});

// ===========================================================================
// SECTION 3. The widened `isHead`, attacked as the header's own past defect.
// ===========================================================================

test("3-control. a hand-written `// C80 advice:` note IS deleted, but it is COUNTED - the header's past defect (delete without counting) is not back", () => {
  const lines = [
    "export function f(): number {",
    "  // C80 advice: keep this, it is my own note about the review process",
    "  return 1;",
    "}",
  ];
  const out = m.stripCriticism(lines, "typescript");
  // The widening is real: before phase 12 this line survived. It is defensible
  // - the product now emits exactly this shape - and the one rule the header
  // insists on holds: it deletes only what it counts, so the offered diff and
  // the `N stale one(s) stripped` line agree and the human approves what they
  // are shown.
  assert.strictEqual(out.lines.some((l) => l.includes("my own note")), false, "the hand-written note is deleted");
  assert.strictEqual(out.stripped, 1, "and the deletion is counted, so the channel's number matches the diff");
});

test("3-control2. a tagged line that is NOT a head is still left alone, and still not counted", () => {
  const lines = [
    "export function f(): number {",
    "  // C80 is the column limit we keep to",
    "  // C80 advice without a colon is not a head either",
    "  return 1;",
    "}",
  ];
  const out = m.stripCriticism(lines, "typescript");
  assert.strictEqual(out.stripped, 0);
  assert.strictEqual(out.lines.length, lines.length, `nothing may be deleted; got:\n${out.lines.join("\n")}`);
});

test("3-control3. a model dimension the fourteen do not name is planted under `advice` and strips back out, and the model's own word survives in the text", () => {
  const plan = m.planAdviceInjection(
    ["export function touch(key: string): number {", "  const now = Date.now();", "  return now;", "}"],
    1,
    "typescript",
    [{ line: 2, dimension: "wall-clock-dependency", text: "inject the instant." }],
  );
  assert.strictEqual(plan.planted, 1);
  assert.match(plan.text, /C80 advice: wall-clock-dependency\. inject the instant\./);
  assert.strictEqual(m.stripCriticism(plan.text.split("\n"), "typescript").stripped, 1);
});

test("3-control4. a model `text` carrying an embedded C80 marker cannot smuggle a second head past the strip pass", () => {
  const plan = m.planAdviceInjection(
    ["export function touch(key: string): number {", "  const now = Date.now();", "  return now;", "}"],
    1,
    "typescript",
    [{ line: 2, dimension: "clock", text: "bad\n// C80 nesting: injected second head" }],
  );
  const restrip = m.stripCriticism(plan.text.split("\n"), "typescript");
  assert.strictEqual(restrip.stripped, 1, `one head in, one head out; got:\n${plan.text}`);
  assert.strictEqual(restrip.lines.some((l) => l.includes("C80")), false, "nothing of the product's text survives");
});

test("3-control5. the two paths do not stack on each other: rubric after advice, and advice after rubric, both replace", () => {
  const source = ["export function touch(key: string): number {", "  const now = Date.now();", "  return now;", "}"];
  const advice = m.planAdviceInjection(source, 1, "typescript", [
    { dimension: "clock", line: 2, text: "inject the instant." },
  ]);
  assert.strictEqual(advice.planted, 1);
  // The rubric now presses over the advice path's output.
  const lang = m.criticizeLangFor("typescript");
  const view = m.scoringView(advice.text.split("\n"), "typescript");
  assert.deepStrictEqual(view.lines, source, "the rubric's view sees the code, not the model's comment");
  const fn = m.sliceFunction(view.lines, 1, view.lines.length, "touch", lang);
  const card = m.scoreFunction(fn, lang);
  const rubric = m.planInjection(advice.text.split("\n"), 1, card, m.DEFAULT_ELEVATION);
  assert.strictEqual(rubric.stripped, 1, "the rubric strips the model's comment and counts it");
  assert.strictEqual(
    rubric.text.split("\n").filter((l) => l.includes("inject the instant")).length,
    0,
    `the model's comment must not survive the rubric press:\n${rubric.text}`,
  );
  // And back the other way.
  const back = m.planAdviceInjection(rubric.text.split("\n"), 1, "typescript", [
    { dimension: "clock", line: 2, text: "inject the instant." },
  ]);
  assert.strictEqual(back.stripped, rubric.planted, "the advice path strips every rubric comment and counts them all");
});

test("3-control6. two advise presses over a whole document are byte-stable, doc comment and region reach-back included", () => {
  const blocks = [
    { dimension: "clock", anchor: "const now = Date.now();", text: "inject the instant." },
    { dimension: "cqs", anchor: "cache.set(key, now);", text: "this writes and answers in one call." },
  ];
  const first = pressAdvise(DOCUMENTED, "typescript", "touch", blocks);
  assert.strictEqual(first.plan.planted, 2);
  const second = pressAdvise(first.next, "typescript", "touch", blocks);
  assert.strictEqual(second.plan.planted, 2);
  assert.strictEqual(second.plan.stripped, 2, "the second press strips both of the first press's comments");
  assert.deepStrictEqual(second.next, first.next, "two presses on the same answer produce the same file");
});

// ===========================================================================
// SECTION 4. `placeAdvice`'s optional `line` tie-breaker.
// ===========================================================================

const TWICE = [
  "export function pick(flag: boolean): number {",
  "  if (flag) {",
  "    return compute();",
  "  }",
  "  return compute();",
  "}",
];

test("4-control. `line` cannot move a block onto a line the anchor did not name, under every shape I could reach", () => {
  const lang = m.criticizeLangFor("typescript");
  const fn = m.sliceFunction(TWICE, 1, TWICE.length, "pick", lang);
  const attacks = [
    // A line naming a line whose text does NOT match the anchor.
    { dimension: "cqs", anchor: "return compute();", line: 1 },
    { dimension: "cqs", anchor: "return compute();", line: 2 },
    { dimension: "cqs", anchor: "return compute();", line: 6 },
    // Out of the function entirely, in both directions.
    { dimension: "cqs", anchor: "return compute();", line: 0 },
    { dimension: "cqs", anchor: "return compute();", line: -3 },
    { dimension: "cqs", anchor: "return compute();", line: 9999 },
    // Not an integer, not a number, and the JS coercion traps.
    { dimension: "cqs", anchor: "return compute();", line: 3.0000001 },
    { dimension: "cqs", anchor: "return compute();", line: NaN },
    { dimension: "cqs", anchor: "return compute();", line: Infinity },
    { dimension: "cqs", anchor: "return compute();", line: "3" },
    { dimension: "cqs", anchor: "return compute();", line: true },
    { dimension: "cqs", anchor: "return compute();", line: [3] },
    { dimension: "cqs", anchor: "return compute();", line: { valueOf: () => 3 } },
  ];
  for (const block of attacks) {
    const out = m.placeAdvice(fn, [{ ...block, text: "a sentence." }]);
    assert.strictEqual(
      out.placed.length,
      0,
      `line=${JSON.stringify(block.line)} placed a block the anchor's two matches did not resolve: ${JSON.stringify(out.placed)}`,
    );
    assert.strictEqual(out.unplaced[0].reason, "more than one line matches this anchor");
  }
  // And the one case it IS allowed to resolve.
  for (const line of [3, 5]) {
    const out = m.placeAdvice(fn, [{ dimension: "cqs", anchor: "return compute();", line, text: "a sentence." }]);
    assert.strictEqual(out.placed.length, 1, `line=${line} must resolve the tie`);
    assert.strictEqual(out.placed[0].line, line);
  }
});

test("4-control2. a UNIQUE anchor ignores `line` entirely, so a miscounting model still lands on its own quoted text", () => {
  const lang = m.criticizeLangFor("typescript");
  const fn = m.sliceFunction(DOCUMENTED, 3, DOCUMENTED.length, "touch", lang);
  for (const line of [1, 2, 99, -1, NaN, undefined]) {
    const out = m.placeAdvice(fn, [{ dimension: "clock", anchor: "const now = Date.now();", line, text: "s." }]);
    assert.strictEqual(out.placed.length, 1, `line=${line}`);
    assert.strictEqual(out.placed[0].line, 4, `line=${line} moved a uniquely-anchored block`);
  }
});

test("4-control3. `lineText` is the RAW indented document line, and a block cannot be planted on a blank line", () => {
  const lines = [
    "export function pad(): number {",
    "",
    "        const now = Date.now();",
    "}",
  ];
  const lang = m.criticizeLangFor("typescript");
  const fn = m.sliceFunction(lines, 1, lines.length, "pad", lang);
  const out = m.placeAdvice(fn, [
    { dimension: "clock", anchor: "const now = Date.now();", text: "s." },
    { dimension: "cqs", anchor: "", text: "s." },
    { dimension: "cqs", anchor: "   ", text: "s." },
  ]);
  assert.strictEqual(out.placed.length, 1);
  assert.strictEqual(out.placed[0].lineText, "        const now = Date.now();", "lineText keeps the document's indentation");
  assert.strictEqual(out.unplaced.length, 2, "a blank anchor matches nothing");
});

test("4-control4. `placeAdvice` does not mutate its inputs and is repeatable", () => {
  const lang = m.criticizeLangFor("typescript");
  const fn = m.sliceFunction(TWICE, 1, TWICE.length, "pick", lang);
  const before = JSON.stringify(fn);
  const blocks = [{ dimension: "cqs", anchor: "return compute();", line: 5, text: "s." }];
  const a = m.placeAdvice(fn, blocks);
  const b = m.placeAdvice(fn, blocks);
  assert.deepStrictEqual(a, b);
  assert.strictEqual(JSON.stringify(fn), before, "placeAdvice mutated the unit");
  assert.deepStrictEqual(blocks, [{ dimension: "cqs", anchor: "return compute();", line: 5, text: "s." }]);
});

// ===========================================================================
// SECTION 5. The honesty judge's masked/raw split.
// ===========================================================================

test("5a. DEFECT: a line whose only clock is inside its TRAILING COMMENT still carries a finding, and the card quotes the comment as evidence", () => {
  const lines = [
    "export function r(): number {",
    "  return 1; // the caller passes Date.now() in",
    "}",
  ];
  const lang = m.criticizeLangFor("typescript");
  const fn = m.sliceFunction(lines, 1, lines.length, "r", lang);
  const out = m.honestyOutcomes(fn, lang, { clock: [2], prng: [], env: [], world: [] });
  assert.strictEqual(out.clock.state, "flagged");
  assert.strictEqual(
    out.clock.findings[0].evidence,
    "return 1; // the caller passes Date.now() in",
    "WANTED: the masking guard exists so that 'a line with no code left in it cannot carry a finding whatever " +
      "the reply says' (I3). It is applied per LINE, so a line with any code at all on it slips through, and " +
      "the only clock-shaped text on this line is inside a comment. The product then quotes that comment back " +
      "at the developer as the evidence for `reads the wall clock`. Wanted: the masked text is what gets " +
      "quoted-from, or the finding is discarded when the masked line carries nothing the model could have meant.",
  );
});

test("5-control. a line INSIDE a multi-line template literal is not nameable, and neither is a whole-line comment", () => {
  const lines = [
    "export function q(id: string): string {",
    "  const sql = `",
    "    SELECT datetime('now') FROM t",
    "  `;",
    "  // this function reads Date.now() somewhere else",
    "  return sql + id;",
    "}",
  ];
  const lang = m.criticizeLangFor("typescript");
  const fn = m.sliceFunction(lines, 1, lines.length, "q", lang);
  const out = m.honestyOutcomes(fn, lang, { clock: [3, 5], prng: [], env: [], world: [] });
  assert.strictEqual(
    out.clock.state,
    "clean",
    `neither the string body nor the comment may carry a finding; got ${JSON.stringify(out.clock)}`,
  );
});

test("5-control2. a Python docstring line is not nameable either", () => {
  const lines = [
    "def load(path):",
    '    """Reads os.environ and the clock."""',
    "    return path",
  ];
  const lang = m.criticizeLangFor("python");
  const fn = m.sliceFunction(lines, 1, lines.length, "load", lang);
  const out = m.honestyOutcomes(fn, lang, { clock: [2], prng: [], env: [2], world: [2] });
  for (const dim of ["clock", "env", "world"]) {
    assert.strictEqual(out[dim].state, "clean", `${dim} fired on a docstring: ${JSON.stringify(out[dim])}`);
  }
});

test("5-control3. out-of-range, duplicate and nonsense line numbers are discarded, never clamped, and never throw", () => {
  const lang = m.criticizeLangFor("typescript");
  const fn = m.sliceFunction(DOCUMENTED, 3, DOCUMENTED.length, "touch", lang);
  const out = m.honestyOutcomes(fn, lang, {
    clock: [4, 4, 4],
    prng: [0, -1, 1, 2, 999, 1.5, NaN, Infinity],
    env: [],
    world: [Number.MAX_SAFE_INTEGER + 10],
  });
  assert.strictEqual(out.clock.state, "flagged");
  assert.strictEqual(out.clock.findings.length, 1, "one finding per line per dimension");
  assert.strictEqual(out.clock.findings[0].evidence, "const now = Date.now();");
  assert.strictEqual(out.clock.findings[0].detail, m.HONESTY_DETAIL.clock, "the detail is the fixed table's");
  assert.strictEqual(out.prng.state, "clean", `no out-of-range prng line may fire: ${JSON.stringify(out.prng)}`);
  assert.strictEqual(out.world.state, "clean");
});

test("5-control4. the four detectors refuse rather than pass when no round has run, and they say so", () => {
  const lang = m.criticizeLangFor("typescript");
  const fn = m.sliceFunction(DOCUMENTED, 3, DOCUMENTED.length, "touch", lang);
  const card = m.scoreFunction(fn, lang);
  for (const dim of m.HONESTY_DIMENSIONS) {
    const row = card.rows.find((r) => r.dimension === dim);
    assert.strictEqual(row.outcome.state, "blind", `${dim} must be blind before a round has run`);
    assert.ok(row.outcome.reason.length > 0);
    assert.strictEqual(row.elevated, false);
  }
});

test("5-control5. `judgeHonesty` never throws, and every failure shape ends on `blind` naming the backend", async () => {
  const lang = m.criticizeLangFor("typescript");
  const fn = m.sliceFunction(DOCUMENTED, 3, DOCUMENTED.length, "touch", lang);
  const cancel = new Error("user cancelled");
  cancel.name = "Canceled";
  const transports = [
    async () => { throw new Error("connect ECONNREFUSED 127.0.0.1:11434"); },
    async () => { throw cancel; },
    async () => "",
    async () => "I am sorry, I cannot help with that.",
    async () => 42,
    async () => null,
    async () => undefined,
    async () => ({ text: "clock: 4" }),
  ];
  for (const transport of transports) {
    const out = await m.judgeHonesty(transport, fn, lang, {}, "qwen3 at localhost:11434");
    for (const dim of m.HONESTY_DIMENSIONS) {
      assert.strictEqual(out[dim].state, "blind", `${dim} was not blind for ${transport}`);
      assert.ok(
        out[dim].reason.includes("qwen3 at localhost:11434"),
        `the refusal must name the backend; got ${out[dim].reason}`,
      );
    }
  }
});

test("5-control6. the honesty prompt carries no library spelling table", () => {
  const lang = m.criticizeLangFor("typescript");
  const fn = m.sliceFunction(DOCUMENTED, 3, DOCUMENTED.length, "touch", lang);
  const prompt = m.buildHonestyPrompt(fn, lang, { callees: [{ name: "cache.set", doc: "" }] });
  for (const banned of ["Instant::now", "os.environ", "console.log", "Directory.GetFiles", "thread_rng", "SystemTime", "process.env"]) {
    assert.strictEqual(prompt.includes(banned), false, `the prompt smuggled the deleted table back in: ${banned}`);
  }
  // `Date.now()` appears only because it is a line of the FUNCTION, not
  // because the prompt names it as a pattern.
  assert.strictEqual(prompt.split("Date.now()").length - 1, 1, "Date.now appears once, as the function's own line");
});

// ===========================================================================
// SECTION 6. `applyHonesty`'s defaulted policy.
// ===========================================================================

test("6a. FIXED: `applyHonesty` cannot be called without a policy, so one card cannot hold two", () => {
  const lang = m.criticizeLangFor("typescript");
  const fn = m.sliceFunction(DOCUMENTED, 3, DOCUMENTED.length, "touch", lang);
  const custom = { held: ["clock", "prng", "env", "world", "section-comment"] };
  const card = m.scoreFunction(fn, lang, custom);
  const flagged = {
    state: "flagged",
    findings: [{ dimension: "clock", line: 4, evidence: "const now = Date.now();", detail: m.HONESTY_DETAIL.clock }],
  };
  const outcomes = { clock: flagged, prng: { state: "clean" }, env: { state: "clean" }, world: { state: "clean" } };

  const withPolicy = m.applyHonesty(card, outcomes, custom);
  assert.strictEqual(withPolicy.rows.find((r) => r.dimension === "clock").elevated, false, "with the policy it is held");

  // FIXED 2026-08-29: `policy` is REQUIRED. The defaulted parameter was the
  // "second copy would drift, and it would drift silently" the function's own
  // header warns about: a card scored under a custom policy and passed through
  // without one came back with its four honesty rows elevated by
  // DEFAULT_ELEVATION and its other eleven by the caller's, which reads exactly
  // like a correct card. An optional parameter is invisible to tsc; a required
  // one makes every call site say which policy it means.
  assert.strictEqual(
    m.applyHonesty.length,
    3,
    "`applyHonesty` must take the policy as a REQUIRED third parameter. A defaulted one lets a caller " +
      "produce a card holding two policies at once, and tsc cannot see it.",
  );
  assert.strictEqual(
    withPolicy.rows.find((r) => r.dimension === "section-comment").elevated,
    false,
    "and the untouched rows keep the same policy's answer, so one card holds exactly one policy",
  );
});

test("6-control. `applyHonesty` is otherwise faithful: new object, row order kept, blast radius and explanation preserved, unknown keys ignored", () => {
  const lang = m.criticizeLangFor("typescript");
  const fn = m.sliceFunction(DOCUMENTED, 3, DOCUMENTED.length, "touch", lang);
  const card = m.scoreFunction(fn, lang, m.DEFAULT_ELEVATION, 7);
  const seeded = {
    ...card,
    rows: card.rows.map((r) => (r.dimension === "undocumented" ? { ...r, explanation: "keep me" } : r)),
  };
  const before = JSON.stringify(seeded);
  // THE POLICY IS REQUIRED as of 2026-08-29 (row 6a), and it is the card's own.
  const out = m.applyHonesty(
    seeded,
    {
      clock: { state: "clean" },
      nesting: { state: "flagged", findings: [] },
      "not-a-dimension": { state: "clean" },
    },
    m.DEFAULT_ELEVATION,
  );
  assert.strictEqual(JSON.stringify(seeded), before, "applyHonesty mutated its input card");
  assert.notStrictEqual(out, seeded);
  assert.deepStrictEqual(out.rows.map((r) => r.dimension), card.rows.map((r) => r.dimension), "row order kept");
  assert.strictEqual(out.rows.find((r) => r.dimension === "undocumented").explanation, "keep me");
  assert.strictEqual(out.rows.find((r) => r.dimension === "clock").blastRadius, 7, "the blast radius rides through");
  assert.strictEqual(out.rows.find((r) => r.dimension === "prng").outcome.state, "blind", "a dimension not named keeps its refusal");
  // `nesting` is not an honesty dimension, but `applyHonesty` types its map as
  // a partial record of DimensionId and replaces ANY row it finds a key for.
  assert.strictEqual(
    out.rows.find((r) => r.dimension === "nesting").outcome.state,
    "flagged",
    "a non-honesty key in the outcomes map replaces that row too - documented here so a caller knows",
  );
});

// ===========================================================================
// SECTION 7. `readAdviceReply` and `adviseFunction`, attacked for totality.
// ===========================================================================

test("7-control. `readAdviceReply` is total across every malformed shape I could build", () => {
  const inputs = [
    undefined, null, 42, true, [], {}, Symbol.iterator === undefined ? 0 : 1,
    "", "   ", "not json", "{", "[]", "{}", '{"blocks":null}', '{"blocks":{}}', '{"blocks":"x"}',
    '{"blocks":[null,1,"x",[],{}]}',
    '```json\n{"blocks":[]}\n```',
    '{"blocks":[{"dimension":"clock","anchor":"a","text":"t","line":"5"}]}',
    '{"blocks":[{"dimension":"  ","anchor":"a","text":"t"}]}',
    JSON.stringify({ blocks: Array.from({ length: 50 }, (_, i) => ({ dimension: "clock", anchor: `a${i}`, text: "t" })) }),
  ];
  for (const input of inputs) {
    let out;
    assert.doesNotThrow(() => { out = m.readAdviceReply(input); }, `threw on ${JSON.stringify(input)}`);
    if (out.ok === false) {
      assert.strictEqual(out.failure.kind, "unreadable", `every readAdviceReply failure is unreadable, not transport`);
      assert.ok(out.failure.detail.length > 0);
    } else {
      assert.ok(out.blocks.length <= m.ADVICE_MAX_BLOCKS, "the cap holds");
    }
  }
  const capped = m.readAdviceReply(
    JSON.stringify({ blocks: Array.from({ length: 50 }, (_, i) => ({ dimension: "clock", anchor: `a${i}`, text: "t" })) }),
  );
  assert.strictEqual(capped.blocks.length, m.ADVICE_MAX_BLOCKS);
  assert.strictEqual(capped.blocks[0].anchor, "a0", "the survivors are the FIRST valid ones, in reply order");
});

test("7-control2. `adviseFunction` never throws, and the four outcomes stay distinguishable", async () => {
  const lang = m.criticizeLangFor("typescript");
  const fn = m.sliceFunction(DOCUMENTED, 3, DOCUMENTED.length, "touch", lang);
  const cancel = new Error("cancelled");
  cancel.name = "Canceled";

  const dead = await m.adviseFunction(async () => { throw cancel; }, fn, lang, {});
  assert.deepStrictEqual([dead.placed.length, dead.unplaced.length, dead.failure.kind], [0, 0, "transport"]);

  const babble = await m.adviseFunction(async () => "sorry, I cannot", fn, lang, {});
  assert.deepStrictEqual([babble.placed.length, babble.unplaced.length, babble.failure.kind], [0, 0, "unreadable"]);

  const nothing = await m.adviseFunction(async () => '{"blocks":[]}', fn, lang, {});
  assert.deepStrictEqual([nothing.placed.length, nothing.unplaced.length, nothing.failure], [0, 0, undefined]);

  const missed = await m.adviseFunction(
    async () => '{"blocks":[{"dimension":"clock","anchor":"no such line","text":"t"}]}',
    fn,
    lang,
    {},
  );
  assert.deepStrictEqual([missed.placed.length, missed.unplaced.length, missed.failure], [0, 1, undefined]);

  const hit = await m.adviseFunction(
    async () => '{"blocks":[{"dimension":"clock","anchor":"const now = Date.now();","text":"t"}]}',
    fn,
    lang,
    {},
  );
  assert.deepStrictEqual([hit.placed.length, hit.unplaced.length, hit.failure], [1, 0, undefined]);
});

// ===========================================================================
// SECTION 8. The reordering in `src/vscode/criticize.ts`.
//
// The honesty round now runs BEFORE the card is logged, before the blast
// radius and before the explain round, and it builds the shared context bundle
// on the way. Everything below drives the REAL command through the structural
// `vscode` stub, so a row that fires here is the shipped order of operations.
// ===========================================================================

if (host.error) {
  test("harness sanity: the host bundle must build", () => {
    assert.fail(`bundleWithVscodeStub failed: ${host.error && host.error.message}`);
  });
} else {
  const vscode = host.vscode;

  // Fires two elevated rubric rows on its own (two adjacent string parameters
  // and a bool parameter) and carries a real clock read for the honesty judge
  // to name. The second row was `unused-param` until that dimension was
  // deleted 2026-08-29; `adjacent-params` replaces it because these probes need
  // TWO elevated signature-level rows on the head line, not that dimension.
  const SOURCE = [
    "const seen: Map<string, number> = new Map();",
    "/** Records the hit and answers whether it was the first one. */",
    "export function touch(key: string, label: string, warm: boolean): boolean {",
    "  const now = Date.now();",
    "  const first = !seen.has(key + label);",
    "  seen.set(key + label, now);",
    "  return first;",
    "}",
  ].join("\n");

  // A function the fourteen detectors have nothing to say about.
  const QUIET = [
    "/** Joins the label to the count with a bar between them. */",
    "export function join(label: string, count: number): string {",
    "  return `${label}|${count}`;",
    "}",
  ].join("\n");

  const NO_FINDING = "clock: none\nprng: none\nenv: none\nworld: none";

  function makeDoc(text, languageId) {
    const state = { text, version: 1 };
    const doc = {
      uri: vscode.Uri.parse("file:///adv64/p10p12.ts"),
      fileName: "/adv64/p10p12.ts",
      languageId,
      eol: 1,
      get version() {
        return state.version;
      },
      get isClosed() {
        return false;
      },
      get lineCount() {
        return state.text.split("\n").length;
      },
      getText: () => state.text,
      positionAt: (off) => {
        const lines = state.text.split("\n");
        let o = 0;
        for (let l = 0; l < lines.length; l++) {
          if (off <= o + lines[l].length) return new vscode.Position(l, off - o);
          o += lines[l].length + 1;
        }
        return new vscode.Position(lines.length - 1, lines[lines.length - 1].length);
      },
      offsetAt: (p) => {
        const lines = state.text.split("\n");
        let o = 0;
        for (let i = 0; i < Math.min(p.line, lines.length); i++) o += lines[i].length + 1;
        return Math.min(o + p.character, state.text.length);
      },
      lineAt: (arg) => {
        const lines = state.text.split("\n");
        const t = lines[typeof arg === "number" ? arg : arg.line] ?? "";
        const hit = t.match(/\S/);
        return {
          text: t,
          range: new vscode.Range(0, 0, 0, t.length),
          firstNonWhitespaceCharacterIndex: hit ? hit.index : t.length,
          isEmptyOrWhitespace: !hit,
        };
      },
    };
    return { doc, state };
  }

  /** One press of the REAL command. `makeTransport` is the getter the product
   *  reads once per model round, so a caller can make each round behave
   *  differently. */
  async function press(options = {}) {
    const source = options.source ?? SOURCE;
    const languageId = "typescript";
    const { doc, state } = makeDoc(source, languageId);
    const lines = source.split("\n");
    const headLine = lines.findIndex((l) => /\bfunction\s+\w+/.test(l)) + 1;
    let headOffset = 0;
    for (let i = 0; i < headLine - 1; i++) headOffset += lines[i].length + 1;
    headOffset += lines[headLine - 1].search(/\S/);
    const name = (/function\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(lines[headLine - 1]) ?? [])[1] ?? "f";

    globalThis.__C80_ACTIVE__ = { document: doc, selection: { active: new vscode.Position(headLine - 1, 0) } };
    // The fixture's mutable backing store, so a test can type into the document
    // from inside a model round the way a developer does.
    globalThis.__C80_PRESS_STATE__ = state;
    globalThis.__C80_WARNINGS__ = [];
    globalThis.__C80_COMMANDS__ = {};
    const channel = [];
    const output = {
      name: "adv64",
      appendLine: (l) => channel.push(l),
      append() {},
      show() {},
      hide() {},
      clear() {},
      dispose() {},
    };

    host.mod.registerCriticize({ subscriptions: [] }, output, {
      resolveFunction: async () => ({
        span: { start: headOffset, end: source.length },
        headOffset,
        signature: lines[headLine - 1].trim(),
        symbolName: name,
        languageId,
        kind: "function",
        bodyOnly: false,
        headerIndent: "",
      }),
      tierGate: async () => options.tierGate ?? { allowed: true },
      tierMessage: () => undefined,
      transport: options.makeTransport ?? (() => async () => ({ text: NO_FINDING })),
      presenter: () => ({ present: async () => "reject" }),
      resolvePrefill: options.resolvePrefill,
      extractorFor: options.extractorFor,
    });
    await globalThis.__C80_COMMANDS__[host.mod.CRITICIZE_COMMAND_ID]();
    return { channel, state, doc, name, warnings: globalThis.__C80_WARNINGS__ };
  }

  const critique = (run) => run.channel.filter((l) => l.startsWith("[critique]"));
  const hasCard = (run) => run.channel.some((l) => l.includes("Criticize rubric for"));
  /** One dimension's row off the rendered card. `renderScorecard` reaches the
   *  channel as ONE `appendLine` with embedded newlines, so the rows are not
   *  channel entries. */
  const cardRow = (run, dimension) =>
    run.channel
      .join("\n")
      .split("\n")
      .find((l) => new RegExp(`^\\s{2}${dimension}\\s{2,}`).test(l));

  test("8-sanity. a plain press produces a complete card, a scoring line and a summary line", async () => {
    const run = await press();
    assert.ok(hasCard(run), `no card:\n${run.channel.join("\n")}`);
    assert.ok(critique(run).some((l) => l.includes("scoring touch")), "the scoring line prints");
    assert.ok(critique(run).some((l) => /\d+ of 14 dimensions elevated/.test(l)), "the summary line prints");
  });

  test("8a. FIXED: a cancellation in the honesty round still leaves the scoring line, which cost no model at all", async () => {
    const run = await press({
      makeTransport: () => async () => {
        const err = new Error("user cancelled");
        err.name = "Canceled";
        throw err;
      },
    });
    assert.ok(critique(run).some((l) => l.includes("cancelled")), "the cancellation is reported");
    // FIXED 2026-08-29: the scoring line is logged BEFORE the honesty round.
    // It names the function, the language and the head line, and none of those
    // depend on what a model says. `scoreFunction` is synchronous and pure and
    // has already answered ten of the fourteen rows by the time the round
    // starts, so throwing that away on an Escape was discarding work that was
    // done and free.
    assert.ok(
      critique(run).some((l) => l.includes("scoring touch")),
      `the scoring line must survive a cancelled round:\n${critique(run).join("\n")}`,
    );
    // THE SUMMARY LINE STILL GOES, and that is correct rather than a leftover:
    // it counts elevated rows, and four of the fourteen are the cancelled round's
    // to decide. A summary printed here would be a count taken before the
    // counting finished.
    assert.strictEqual(
      critique(run).some((l) => /\d+ of 14 dimensions elevated/.test(l)),
      false,
      "the summary counts elevated rows, four of which the cancelled round never decided",
    );
  });

  test("8b. FIXED: a throw while the shared context bundle is built costs the prompt a block, not the card", async () => {
    // `buildFixContext` wraps each best-effort leg in its own try, EXCEPT the
    // call into `deps.resolvePrefill` itself: `withDeadline` only sees a
    // promise, so a resolver that throws before returning one is uncaught.
    const run = await press({
      extractorFor: () => ({ name: "stub-extractor" }),
      resolvePrefill: () => {
        throw new Error("boom, the resolver blew up");
      },
    });
    // FIXED 2026-08-29: the call into the injected resolver is inside a try of
    // its own. The context bundle exists to feed a model, so a defect in it
    // costs the prompt a block, which is what every other leg in
    // `buildFixContext` already does. Before the fix, one uncaught throw cost
    // the developer all fourteen rows, ten of which were already computed.
    assert.ok(hasCard(run), `the card must render whatever the context bundle did:\n${critique(run).join("\n")}`);
    assert.ok(
      critique(run).some((l) => l.includes("the context bundle failed") && l.includes("boom, the resolver blew up")),
      `and the channel names the failure rather than swallowing it:\n${critique(run).join("\n")}`,
    );
    assert.strictEqual(
      critique(run).some((l) => l.includes("failed:")),
      false,
      "a bundle leg failing is not the gesture failing, and must not be spelled like one",
    );
    assert.strictEqual(run.warnings.length, 0, "no failure toast: the developer got the card they asked for");
  });

  test("8c. DEFECT: on a function with nothing above the bar, the type-shape resolve is paid for anyway, and the card waits behind it", async () => {
    const order = [];
    const run = await press({
      source: QUIET,
      extractorFor: () => ({ name: "stub-extractor" }),
      resolvePrefill: async () => {
        order.push("resolvePrefill");
        return "struct Budget { shard: u64 }";
      },
      makeTransport: () => async () => {
        order.push("model");
        return { text: NO_FINDING };
      },
    });
    assert.ok(critique(run).some((l) => l.includes("0 of 14 dimensions elevated")), "the fixture must be quiet");
    assert.ok(
      critique(run).some((l) => l.includes("no row is above the evidence bar")),
      "and the explain and fix rounds must both skip",
    );
    assert.deepStrictEqual(
      order,
      ["resolvePrefill", "model"],
      "WANTED: the type-shape resolve is not paid for here at all. `judgeHonesty` is handed only " +
        "`context.callees`; the type shapes and the call sites exist for the FIX prompt, which this press " +
        "then skips because no row is above the bar. `FIX_TYPE_SHAPE_MS` bounds that resolve at 8000ms, and " +
        "the card the developer pressed for now sits behind it for a block nothing reads.",
    );
    const at = run.channel.findIndex((l) => l.includes("Criticize rubric for"));
    const resolveAt = run.channel.findIndex((l) => l.includes("type-shape line"));
    assert.ok(resolveAt >= 0 && resolveAt < at, "the resolve is reported before the card is drawn");
  });

  test("8d. DEFECT: a cancellation raised inside the context bundle is swallowed, and the gesture goes on to spend every model round", async () => {
    let rounds = 0;
    const run = await press({
      extractorFor: () => ({ name: "stub-extractor" }),
      resolvePrefill: async () => {
        const err = new Error("user cancelled the resolve");
        err.name = "Canceled";
        throw err;
      },
      makeTransport: () => {
        rounds += 1;
        return async () => ({ text: NO_FINDING });
      },
    });
    assert.ok(
      critique(run).some((l) => l.includes("Canceled: user cancelled the resolve")),
      `the cancellation must reach the channel:\n${critique(run).join("\n")}`,
    );
    assert.strictEqual(
      rounds,
      3,
      "WANTED: 0. `withDeadline`'s failure handler treats every rejection as a lost best-effort leg, " +
        "cancellation included, so a press abandoned during the type-shape resolve still runs the honesty " +
        "round and both rounds of every elevated row. Every other model site in this file checks " +
        "`isExplainCancellation || isCancellation` and rethrows; this one does not look.",
    );
    assert.ok(hasCard(run), "and a card is drawn for a press the developer had already abandoned");
  });

  test("8e. DEFECT: the context leg the HONESTY round depends on reports its own loss under `fix skipped:`, which names a round that had not started", async () => {
    const run = await press({
      resolvePrefill: async () => "struct Budget { shard: u64 }",
      extractorFor: () => undefined,
    });
    const line = critique(run).find((l) => l.includes("surface extractor"));
    assert.notStrictEqual(line, undefined, `no extractor line printed:\n${critique(run).join("\n")}`);
    assert.ok(
      line.includes("fix skipped:"),
      "WANTED: a line about the shared context bundle names the bundle, not one of the two rounds that " +
        "read it. Since phase 10 the same bundle feeds the honesty judge, which decides four of the fourteen " +
        "rows, and it is built before the fix round is even reachable - so `fix skipped:` is now printed " +
        `for a leg that was never about the fix. Got: ${line}`,
    );
    // The clause about ordering is GONE, fixed 2026-08-29: the scoring line now
    // prints before the honesty round, so the reader knows which function is
    // being scored before any context line appears. What remains, and is
    // DEFERRED as S64-22, is the naming: the same sentence in the same position
    // reports a signature that did not parse and a type resolve that timed out,
    // so a reader still cannot tell which round lost what.
    assert.ok(
      critique(run).indexOf(line) > critique(run).findIndex((l) => l.includes("scoring")),
      "the scoring line comes first now, so the context line at least has a function to attach to",
    );
  });

  test("8-control. a CLOSED tier gate leaves the four honesty rows blind naming the gate, renders the whole card, and never touches the transport", async () => {
    const run = await press({
      tierGate: { allowed: false, reason: "tier-disabled" },
      makeTransport: () => {
        throw new Error("must not be called: the gate is closed");
      },
    });
    assert.ok(hasCard(run), "the card is complete without a model");
    assert.strictEqual(run.channel.some((l) => l.includes("must not be called")), false, "the transport is untouched");
    const blind = critique(run).find((l) => l.includes("honesty not judged"));
    assert.ok(blind !== undefined && blind.includes("tier-disabled"), `the gate must name itself: ${blind}`);
    // The four rows say blind on the card, and the word `clean` never appears
    // against one of them.
    for (const dimension of ["clock", "prng", "env", "world"]) {
      const row = cardRow(run, dimension);
      assert.ok(row !== undefined, `the ${dimension} row must render`);
      assert.ok(row.includes("blind"), `${dimension} rendered as ${row.trim()}, and a closed gate must never certify a function`);
    }
    // And the skip reason travels: `fix skipped` still carries `tier-disabled`.
    assert.ok(critique(run).some((l) => l.includes("fix skipped: tier tier-disabled")));
    assert.ok(critique(run).some((l) => l.includes("explainer skipped: tier tier-disabled")));
  });

  test("8-control2. a DEAD backend leaves the four rows blind naming the backend, and the card still renders", async () => {
    const run = await press({
      makeTransport: () => async () => {
        throw new Error("connect ECONNREFUSED 127.0.0.1:11434");
      },
    });
    assert.ok(hasCard(run));
    const blind = critique(run).find((l) => l.includes("honesty not judged"));
    assert.ok(blind.includes("localhost:11434"), `the refusal must name the backend: ${blind}`);
    assert.ok(blind.includes("ECONNREFUSED"), "and carry the cause");
    for (const dimension of ["clock", "prng", "env", "world"]) {
      const row = cardRow(run, dimension);
      assert.ok(row.includes("blind"), `${dimension} rendered as ${row.trim()}`);
    }
    // Phase 1's regression stays fixed: the per-row explain and fix failures
    // still reach the channel with the cause, rather than hiding behind the
    // honesty round's own sentence.
    assert.ok(critique(run).some((l) => /explained 0 of 2 elevated row/.test(l) && l.includes("ECONNREFUSED")));
    assert.ok(critique(run).some((l) => /wrote 0 of 2 fix sentence/.test(l) && l.includes("ECONNREFUSED")));
  });

  test("8-control3. an UNREADABLE answer is blind too, and never four cleans", async () => {
    for (const reply of ["", "   ", "I am sorry, I cannot help with that.", "```\n```", "network: 4"]) {
      const run = await press({ makeTransport: () => async () => ({ text: reply }) });
      const blind = critique(run).find((l) => l.includes("honesty not judged"));
      assert.ok(blind !== undefined, `reply ${JSON.stringify(reply)} was not refused:\n${critique(run).join("\n")}`);
      assert.ok(blind.includes("localhost:11434"), "the refusal names the backend");
      for (const dimension of ["clock", "prng", "env", "world"]) {
        const row = cardRow(run, dimension);
        assert.ok(
          row.includes("blind"),
          `reply ${JSON.stringify(reply)} certified ${dimension} as ${row.trim()}, which is the false certificate phase 10 exists to remove`,
        );
      }
    }
  });

  test("8-control4. a model-decided honesty finding elevates its row, reaches the blast-radius walk and the explain and fix rounds, and lands in the diff", async () => {
    const run = await press({
      makeTransport: () => async () => ({ text: "clock: 4\nprng: none\nenv: none\nworld: none" }),
    });
    // "dimensionS", corrected 2026-08-29 off a real host channel: the count in
    // an "N of 4" phrase agrees with the four, not with the numerator.
    assert.ok(critique(run).some((l) => l.includes("1 of 4 dimensions flagged")), "the round reports what it found");
    assert.ok(critique(run).some((l) => l.includes("3 of 14 dimensions elevated")), "the honesty row joins the two rubric rows");
    // The card quotes the DOCUMENT's own line, never the model's text.
    const evidence = run.channel
      .join("\n")
      .split("\n")
      .find((l) => l.includes("line 4") && l.includes("Date.now()"));
    assert.ok(evidence !== undefined, `the evidence must be the document's line:\n${run.channel.join("\n")}`);
    assert.ok(evidence.includes("reads the wall clock"), "and the detail is the fixed table's");
    // The blast radius is walked for it: `clock` is signature-level, so the row
    // is what makes the walk worth running at all.
    assert.ok(
      critique(run).some((l) => l.includes("call-hierarchy root") || l.includes("call site")),
      "the walk runs for a model-decided signature-level row",
    );
    assert.ok(critique(run).some((l) => l.includes("proposing 3 comments")), "and the finding reaches the diff");
  });

  test("8-control5. the honesty round does not break the staleness anchor: a document edited while it runs still gets the stale notice", async () => {
    let bumped = false;
    const run = await press({
      makeTransport: () => async () => {
        if (!bumped) {
          bumped = true;
          globalThis.__C80_PRESS_STATE__.version = 7;
        }
        return { text: NO_FINDING };
      },
    });
    assert.ok(bumped, "the fixture must reach a model round");
    assert.ok(
      critique(run).some((l) => l.includes("document moved during enrichment: version 1 to 7")),
      `an edit during the honesty round must still raise the stale notice:\n${critique(run).join("\n")}`,
    );
    assert.ok(
      run.channel.some((l) => l.includes("The file changed while this card was being prepared")),
      "and the card itself carries the notice",
    );
    assert.ok(hasCard(run), "and the card still renders");
  });
}
