// White-box: the Criticize gesture's decisions (session-v61 phase 5).
//
// The gesture itself lives in `src/vscode/criticize.ts` and needs a host, so
// everything it DECIDES was pushed into `src/core/criticizeGesture.ts` and
// `src/core/criticizeBlast.ts` where a headless row can reach it. What is left
// in the vscode layer is the editor, the transport and the channel.
//
// The three things this file must prove, named in the phase contract:
//
//  - the unregistered-language refusal NAMES the language. A generic "cannot do
//    that here" leaves a developer unable to tell a broken feature from a file
//    out of scope, and a named refusal is a shipped state (2.4.0 refuses
//    TypeScript for covering tests in those words).
//  - the slice built from a DOCUMENT includes the doc comment. Measured on the
//    graded set: a slice that begins at the declaration head reads 29% of
//    documented Rust functions as undocumented, and this session hit that trap
//    twice. Dimensions 9 and 10 both read the doc.
//  - an undefined blast radius renders NO "call site" text. "0 call sites" is a
//    claim the walk never made, and a reader cannot tell a measured zero from
//    an unmeasured one.
//
// Run: node --test test/impl-v61-p5-gesture.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-v61-p5-gesture",
  `export * from "../src/core/criticizeGesture";
export { blastRadius, countIsSupported, unsupportedNote, BLAST_BOUNDS } from "../src/core/criticizeBlast";
export { sliceFunction } from "../src/core/criticizeSlice";
export { scoreFunction, DEFAULT_ELEVATION, signatureLevel } from "../src/core/criticizeScore";
export { renderScorecard } from "../src/core/criticizeRender";
export { criticizeLangFor } from "../src/core/criticizeLang";
export { docLines } from "../src/core/criticizeTypes";\n`,
);
test.after(cleanup);

const {
  unregisteredLanguageToast, unregisteredLanguageReason,
  NO_EDITOR_TOAST, NO_EDITOR_REASON, NO_FUNCTION_TOAST, NO_FUNCTION_REASON,
  sliceRefusalReason, refusalLine, critiqueLine, scoringLine, summaryLine,
  blastLine, explainerSkippedLine, CANCELLED_LINE, CRITIQUE_PREFIX,
  summariseCard, criticizeToast, explainableRows, wantsBlastRadius,
  EXPLAIN_ROW_CAP, RUBRIC_SIZE,
  blastRadius, countIsSupported, unsupportedNote,
  sliceFunction, scoreFunction, DEFAULT_ELEVATION, signatureLevel,
  renderScorecard, criticizeLangFor, docLines,
} = mod;

const RUST = criticizeLangFor("rust");

// ---------------------------------------------------------------------------
// 1. The refusals
// ---------------------------------------------------------------------------

test("the unregistered-language refusal names the language, on both surfaces", () => {
  for (const id of ["ruby", "haskell", "plaintext", "jsonc"]) {
    assert.equal(criticizeLangFor(id), undefined, `${id} must not be registered`);
    const toast = unregisteredLanguageToast(id);
    assert.ok(toast.includes(id), `the toast must name ${id}: ${toast}`);
    assert.ok(toast.startsWith("Column 80: "), toast);
    assert.equal(toast.split("\n").length, 1, "the toast is one line");
    const reason = unregisteredLanguageReason(id);
    assert.ok(reason.includes(id), `the channel reason must name ${id}: ${reason}`);
    // The falsifier: a refusal that names a DIFFERENT language would be worse
    // than a generic one, so pin that only this language appears.
    assert.ok(!toast.includes("rust"), toast);
  }
});

test("every refusal sentence is non-empty and says why", () => {
  const reasons = [
    NO_EDITOR_REASON,
    NO_FUNCTION_REASON,
    unregisteredLanguageReason("ruby"),
    sliceRefusalReason("parse_header"),
  ];
  for (const reason of reasons) {
    assert.ok(reason.trim().length > 20, `a refusal must be a sentence: ${reason}`);
  }
  assert.ok(sliceRefusalReason("parse_header").includes("parse_header"));
  for (const toast of [NO_EDITOR_TOAST, NO_FUNCTION_TOAST]) {
    assert.ok(toast.startsWith("Column 80: "), toast);
    assert.equal(toast.split("\n").length, 1);
  }
});

test("every evidence line carries the [critique] prefix", () => {
  assert.equal(CRITIQUE_PREFIX, "[critique]");
  const lines = [
    refusalLine("because"),
    critiqueLine("something happened"),
    scoringLine("parse_header", "rust", 12),
    summaryLine({ elevated: 1, blind: 2, held: 3 }),
    blastLine("clock", 14),
    explainerSkippedLine("tier tier-disabled"),
    CANCELLED_LINE,
  ];
  for (const line of lines) {
    assert.ok(line.startsWith("[critique] "), line);
  }
  assert.equal(scoringLine("parse_header", "rust", 12), "[critique] scoring parse_header (rust) at line 12");
  assert.equal(blastLine("clock", 14), "[critique] blast radius: 14 call sites for clock");
  assert.ok(summaryLine({ elevated: 3, blind: 1, held: 0 }).includes(`3 of ${RUBRIC_SIZE} dimensions elevated`));
  assert.equal(CANCELLED_LINE, "[critique] cancelled");
});

// ---------------------------------------------------------------------------
// 2. The slice, and the trap in it
// ---------------------------------------------------------------------------

// A real document, not a hand-built unit. The point of the row is that the
// SLICER walks up from the declaration head; a test that built the unit itself
// would be measuring its own slicer, which is the session-v29 defect.
const RUST_DOC = [
  "use std::time::Instant;",
  "",
  "/// Parses a header.",
  "///",
  "/// The caller must ensure `raw` is non-empty.",
  "#[inline]",
  "pub fn parse_header(raw: &str) -> Header {",
  "    let started = Instant::now();",
  "    Header::from(raw, started)",
  "}",
];
// 1-based: the `pub fn` line is 7, the closing brace is 10.
const HEAD_LINE = 7;
const END_LINE = 10;

test("the slice built from a document includes the doc comment", () => {
  const unit = sliceFunction(RUST_DOC, HEAD_LINE, END_LINE, "parse_header", RUST);
  assert.ok(unit !== undefined, "the slice must be built");
  // It starts at the FIRST doc line, three lines above the head.
  assert.equal(unit.startLine, 3);
  assert.equal(unit.lines[0].trim(), "/// Parses a header.");
  assert.ok(unit.headIndex > 0, "headIndex 0 would mean the doc was never in the slice");
  assert.equal(unit.lines[unit.headIndex].trim(), "pub fn parse_header(raw: &str) -> Header {");
  // The attribute survives between the doc and the head, which is what makes
  // the walk reach past it instead of stopping there.
  assert.ok(unit.lines.some((l) => l.trim() === "#[inline]"));
});

test("the doc harvester reads that slice as documented, and a head-first slice does not", () => {
  const unit = sliceFunction(RUST_DOC, HEAD_LINE, END_LINE, "parse_header", RUST);
  const doc = docLines(unit, RUST);
  assert.ok(doc.length > 0, "the doc must be readable off the product's own slice");
  assert.ok(doc.join(" ").includes("must ensure"), doc.join(" "));

  // THE TRAP, spelled out as a red row. A unit whose lines begin at the
  // declaration head has headIndex 0, and the upward doc read finds nothing:
  // 29% of documented Rust functions, silently, as undocumented.
  const headFirst = {
    languageId: "rust",
    name: "parse_header",
    lines: RUST_DOC.slice(HEAD_LINE - 1, END_LINE),
    startLine: HEAD_LINE,
    headIndex: 0,
    bodyIndex: 1,
  };
  assert.deepEqual(docLines(headFirst, RUST), [], "this is the defect the slicer exists to prevent");
});

test("a slice that cannot be built is a refusal, never an empty-but-valid unit", () => {
  assert.equal(sliceFunction([], 1, 1, "f", RUST), undefined);
  assert.equal(sliceFunction(RUST_DOC, 0, 5, "f", RUST), undefined);
  assert.equal(sliceFunction(RUST_DOC, 5, 4, "f", RUST), undefined);
  // A range holding only doc lines has no declaration head in it.
  assert.equal(sliceFunction(["/// only a comment"], 1, 1, "f", RUST), undefined);
});

// ---------------------------------------------------------------------------
// 3. An undefined blast radius renders nothing
// ---------------------------------------------------------------------------

function cardFor(lines, headLine, endLine, name) {
  const unit = sliceFunction(lines, headLine, endLine, name, RUST);
  return scoreFunction(unit, RUST, DEFAULT_ELEVATION);
}

test("an undefined blast radius renders no call-site text anywhere on the card", () => {
  const card = cardFor(RUST_DOC, HEAD_LINE, END_LINE, "parse_header");
  for (const row of card.rows) {
    assert.equal(row.blastRadius, undefined, `${row.dimension} carried a radius nothing measured`);
  }
  const text = renderScorecard(card, DEFAULT_ELEVATION);
  assert.ok(!/call site/.test(text), "an unmeasured radius must not produce the words");
  assert.ok(!/\b0 call/.test(text), "and it must never be spelled as a zero");
});

test("a measured zero and an unmeasured one do not share a spelling", () => {
  const card = cardFor(RUST_DOC, HEAD_LINE, END_LINE, "parse_header");
  const measured = {
    ...card,
    rows: card.rows.map((row) =>
      row.dimension === "clock" && row.outcome.state === "flagged"
        ? { ...row, blastRadius: 0 }
        : row,
    ),
  };
  const zeroText = renderScorecard(measured, DEFAULT_ELEVATION);
  const absentText = renderScorecard(card, DEFAULT_ELEVATION);
  assert.notEqual(zeroText, absentText, "the two states must be distinguishable");
  assert.ok(zeroText.includes("found no call sites"), zeroText);
});

// ---------------------------------------------------------------------------
// 4. The walk, and when it refuses to hand back a number
// ---------------------------------------------------------------------------

const walkResult = (over) => ({
  tests: [],
  requests: 1,
  nodesAdmitted: 0,
  depthReached: 1,
  outOfScope: 0,
  failedRequests: 0,
  ...over,
});

test("a partial walk never supports a count, and says which bound produced it", () => {
  assert.equal(countIsSupported(walkResult({})), true);
  assert.equal(countIsSupported(walkResult({ stoppedBy: "depth" })), true, "the depth cap is this walk's own design");
  for (const stop of ["cancelled", "hang-guard", "requests", "nodes"]) {
    const r = walkResult({ stoppedBy: stop });
    assert.equal(countIsSupported(r), false, stop);
    assert.ok(unsupportedNote(r).length > 20, stop);
  }
  const rejected = walkResult({ failedRequests: 2 });
  assert.equal(countIsSupported(rejected), false, "a rejected request leaves callers unseen");
  assert.ok(unsupportedNote(rejected).includes("2"));
  const refused = walkResult({ outOfScope: 3 });
  assert.equal(countIsSupported(refused), false);
});

const node = (name, line) => ({ name, filePath: `/w/${name}.rs`, line, nameLine: line, handle: {} });

test("the walk counts direct call sites and nothing deeper", async () => {
  const target = node("parse_header", 6);
  const callers = [node("a", 1), node("b", 2), node("c", 3)];
  let requests = 0;
  const outcome = await blastRadius({
    target,
    resolveCallers: async (n) => {
      requests++;
      // Grandcallers exist and must NOT be counted: a signature change edits
      // the direct call sites, not the whole reachable graph above them.
      return n.name === "parse_header" ? callers : [node("far", 9)];
    },
  });
  assert.equal(outcome.callSites, 3);
  assert.equal(requests, 1, "one level, one request");
  assert.ok(outcome.note.includes("3"));
});

test("no call-hierarchy root leaves the radius undefined and says why", async () => {
  const outcome = await blastRadius({ target: undefined, resolveCallers: async () => [] });
  assert.equal(outcome.callSites, undefined);
  assert.ok(outcome.note.includes("call-hierarchy root"), outcome.note);
});

test("a cancelled walk leaves the radius undefined and never zero", async () => {
  const outcome = await blastRadius({
    target: node("parse_header", 6),
    resolveCallers: async () => [],
    signal: { aborted: true },
  });
  assert.equal(outcome.callSites, undefined);
  assert.ok(/cancel/i.test(outcome.note), outcome.note);
});

test("a walk whose every request rejects reports no number rather than zero", async () => {
  const outcome = await blastRadius({
    target: node("parse_header", 6),
    resolveCallers: async () => {
      throw new Error("server said no");
    },
  });
  assert.equal(outcome.callSites, undefined, "zero here would be a lie the walk never told");
});

test("a genuine zero is a number, because the walk did enumerate it", async () => {
  const outcome = await blastRadius({
    target: node("parse_header", 6),
    resolveCallers: async () => [],
  });
  assert.equal(outcome.callSites, 0);
});

// ---------------------------------------------------------------------------
// 5. The summary and the toast
// ---------------------------------------------------------------------------

test("the summary counts elevated, blind and held separately", () => {
  const card = cardFor(RUST_DOC, HEAD_LINE, END_LINE, "parse_header");
  const summary = summariseCard(card, DEFAULT_ELEVATION);
  assert.equal(summary.elevated + summary.blind + summary.held <= RUBRIC_SIZE, true);
  assert.ok(summary.elevated >= 1, "this function reads the clock and states a precondition");
  // A held dimension is flagged and NOT elevated: the two counts must not
  // share a slot, or a ruling on dimension 15 would move a number nobody meant.
  const held = summariseCard(card, { held: card.rows.map((r) => r.dimension) });
  assert.equal(held.elevated, 0);
  assert.ok(held.held >= 1);
});

test("the toast is one bounded line and never carries the card", () => {
  const card = cardFor(RUST_DOC, HEAD_LINE, END_LINE, "parse_header");
  const summary = summariseCard(card, DEFAULT_ELEVATION);
  const toast = criticizeToast(card.name, summary);
  assert.equal(toast.split("\n").length, 1);
  assert.ok(toast.length < 200, toast);
  assert.ok(toast.includes("output channel"));
  assert.ok(!toast.includes("clock"), "the card's rows belong in the channel");
});

test("a card with nothing elevated toasts the ruled wording", () => {
  const toast = criticizeToast("f", { elevated: 0, blind: 0, held: 0 });
  assert.ok(toast.includes("this pass found nothing above the evidence bar"), toast);
  assert.ok(!/\bclean\b/.test(toast), "clean is a claim this pass has no instrument for");
  assert.ok(!/correct/.test(toast), toast);
});

// ---------------------------------------------------------------------------
// 6. What the explainer is allowed to see
// ---------------------------------------------------------------------------

test("only elevated rows are explainable, and the cap bounds them", () => {
  const card = cardFor(RUST_DOC, HEAD_LINE, END_LINE, "parse_header");
  const rows = explainableRows(card, DEFAULT_ELEVATION);
  for (const row of rows) {
    assert.equal(row.outcome.state, "flagged");
  }
  assert.ok(rows.length <= EXPLAIN_ROW_CAP);
  // A held dimension is never handed to a model: the card deliberately puts no
  // prose on a row it deliberately keeps below the bar.
  const allHeld = explainableRows(card, { held: card.rows.map((r) => r.dimension) });
  assert.equal(allHeld.length, 0);
  assert.equal(explainableRows(card, DEFAULT_ELEVATION, 0).length, 0);
});

test("the walk is skipped when no elevated row could display its number", () => {
  const card = cardFor(RUST_DOC, HEAD_LINE, END_LINE, "parse_header");
  assert.equal(wantsBlastRadius(card, DEFAULT_ELEVATION), true, "the clock row is signature-level");
  const bodyLocalOnly = {
    ...card,
    rows: card.rows.filter((r) => !signatureLevel(r.dimension)),
  };
  assert.equal(wantsBlastRadius(bodyLocalOnly, DEFAULT_ELEVATION), false);
});

// ---------------------------------------------------------------------------
// 7. It writes nothing
// ---------------------------------------------------------------------------

test("the gesture module reaches no document edit API on any branch", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "src", "vscode", "criticize.ts"),
    "utf8",
  );
  // A source pin rather than a host row, and deliberately so: the contract is
  // that no branch reaches a write, and a host test can only visit the branches
  // it manages to provoke. Every write in this extension goes through one of
  // these names, so their absence is the whole of the claim.
  for (const banned of [
    "WorkspaceEdit",
    "applyEdit",
    "ProposalPresenter",
    "presenter",
    ".edit(",
    "insertSnippet",
    "createDiagnosticCollection",
    "languages.createDiagnostic",
  ]) {
    assert.ok(!source.includes(banned), `criticize.ts must not reach ${banned}`);
  }
});

test("the gesture is registered under one command id and no keybinding", () => {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"),
  );
  const commands = pkg.contributes.commands.filter((c) =>
    c.command.toLowerCase().includes("critici"),
  );
  assert.equal(commands.length, 1, "ONE gesture: no criticize file, no second entry per audience");
  assert.equal(commands[0].command, "column80.criticizeFunction");
  assert.equal(commands[0].category, "Column 80");
  assert.equal(commands[0].title, "Criticize Function");
  const bindings = (pkg.contributes.keybindings ?? []).filter((k) =>
    String(k.command).toLowerCase().includes("critici"),
  );
  assert.equal(bindings.length, 0, "a gesture a developer asks for gets no default key");
});
