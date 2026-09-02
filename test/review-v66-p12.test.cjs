// session-v66 phases 1 and 2, adversarial review. Failing rows are EVIDENCE for the
// findings in the review, not regressions to fix by editing this file; each row names
// the source line it attacks. Pure rows bundle src/core through bundleCore, the way
// blind-v66-p1-shape does. The adapter rows bundle the REAL Dictation and provider
// against the shared activation stub, the way adversarial-v65-p4-gesture does, because
// the landing watch and Escape live in src/vscode/dictation.ts and nothing pure sees them.
//
// Run: SKIP_LIVE=1 node --test test/review-v66-p12.test.cjs
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { bundleCore } = require("./.blind-util.cjs");
const { bundleActivation } = require("./.activation-stub.cjs");

const core = bundleCore("review-v66-p12", 'export * from "../src/core/dictationDoc";\n');
const { declarationGhost } = core.mod;

const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), "review-v66-"));
process.env.COLUMN80_NATIVE_DIR = SCRATCH;
process.env.COLUMN80_WHISPER_MODEL = path.join(SCRATCH, "missing-base.en.bin");
process.env.COLUMN80_VAD_MODEL = path.join(SCRATCH, "missing-vad.bin");
const built = bundleActivation("review-v66-p12", 'export { Dictation } from "../src/vscode/dictation";\n');
const { Dictation, providerModule, __state, Position } = built.mod;

test.after(() => {
  core.cleanup();
  built.cleanup();
  fs.rmSync(SCRATCH, { recursive: true, force: true });
});

const URI = "file:///w/v66/mod.ts";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function channel() {
  const lines = [];
  return { lines, output: { appendLine: (l) => lines.push(String(l)), append: () => {} } };
}
function newProvider(output) {
  return new providerModule.FimCompletionProvider(() => ({}), output);
}
function newDictation(output, wiring) {
  __state.config = { "dictation.muteSpeakers": false, "dictation.partials": false };
  const context = { extensionPath: SCRATCH, subscriptions: [], globalStorageUri: { fsPath: SCRATCH } };
  return new Dictation(context, output, wiring ?? { armIntent() {} });
}
function editorAt(line, text = "") {
  const lines = text.split("\n");
  return {
    document: {
      uri: { toString: () => URI, scheme: "file" },
      languageId: "typescript",
      version: 1,
      eol: 1,
      lineCount: Math.max(lines.length, line + 1),
      getText: () => text,
      lineAt: (n) => ({ text: lines[n] ?? "", range: { end: new Position(n, (lines[n] ?? "").length) } }),
    },
    selection: { active: new Position(line, 0) },
    setDecorations() {},
    revealRange() {},
  };
}
const requesting = (line) => ({ phase: "requesting", site: { uri: URI, line }, languageId: "typescript", indentColumns: 0, heard: "A point." });
const ghostAt = (line) => ({ phase: "ghost", site: { uri: URI, line }, languageId: "typescript", indentColumns: 0, heard: "A point." });
const editOn = (line) => ({ document: { uri: { toString: () => URI, scheme: "file" } }, contentChanges: [{ range: { start: { line } } }] });
const dictateLines = (lines) => lines.filter((l) => l.includes("[dictate]")).join("\n");

// ---------------------------------------------------------------------------
// P1-A. The `closed` test (dictationDoc.ts ~111) is anchored at end of string, and the C#
// allman branch still fires on the words. A head the model finishes with a trailing
// comment is the v65 record defect again: `{`, a body line and `}` under a `;`.
// ---------------------------------------------------------------------------
test("P1-A: a C# head that closed itself and carries a trailing comment still opens nothing", () => {
  const rec = declarationGhost("public record Point(int X, int Y); // a point", "A point.", "csharp", "\n", "", "    ");
  assert.ok(!rec.text.includes("{"), `a closed record head grew a body: ${JSON.stringify(rec.text)}`);
  const prop = declarationGhost("public int Count { get; set; } // the count", "The count.", "csharp", "\n", "    ", "    ");
  assert.ok(!/\{\n\s*\n\s*\}/.test(prop.text), `a closed auto-property grew a body: ${JSON.stringify(prop.text)}`);
});

// ---------------------------------------------------------------------------
// P1-B. Behaviour change the contract does not name: the provider's new refusal
// (completionProvider.ts ~1233) is `declaration.text.trim() === ""`, and a python
// INDENTED site with an empty head builds "\n    " (rule 13 says byte-identical to v65),
// which v65 served as a newline-only ghost and v66 refuses. Pinned so the change is on
// the record; it is arguably an improvement.
// ---------------------------------------------------------------------------
test("P1-B: python, indented, empty head: the text is whitespace-only, so the provider now refuses what v65 served", () => {
  const g = declarationGhost(undefined, "Say.", "python", "\n", "    ", "    ");
  assert.equal(g.text, "\n    ");
  assert.equal(g.text.trim(), "", "this is the shape the v66 provider refuses as 'the model served an empty head'");
});

// ---------------------------------------------------------------------------
// P1-C. fimBound.ts (this session, headThroughAttributes) now serves a dictated head as TWO
// lines, `#[derive(Debug)]` then `pub enum Kind {`, and declarationGhost (~105) pushes the
// whole served string as ONE line, so the indent is added once, in front of the attribute.
// Inside a block the real head lands at column 0 (contract rule 6: every later line starts
// with `indent`). In Python a decorated method inside a class body dedents to module level.
// ---------------------------------------------------------------------------
test("P1-C: a two-line served head (attribute, then head) keeps the site's indent on its second line", () => {
  const rs = declarationGhost("#[derive(Debug)]\npub enum Kind {", "The kind.", "rust", "\n", "    ", "    ");
  const rsLines = rs.text.split("\n");
  assert.ok(rsLines.slice(1).every((l) => l.startsWith("    ")), `a later line lost the indent: ${JSON.stringify(rs.text)}`);
  const py = declarationGhost("@property\ndef area(self) -> float:", "The area.", "python", "\n", "    ", "    ");
  const pyLines = py.text.split("\n");
  assert.ok(pyLines.slice(1).every((l) => l.startsWith("    ")), `the def line dedented to column 0 inside the class: ${JSON.stringify(py.text)}`);
});

// ---------------------------------------------------------------------------
// P2-A. Escape in `requesting` AFTER the provider consumed the intent. `disarm-intent`
// (dictation.ts ~570) bumps gestureId and calls provider.disarmIntent, which finds
// pendingIntent already undefined (completionProvider.ts ~294 took it at request start).
// The in-flight request completes, settleIntent(true) -> onServed(true) -> the adapter logs
// "served answer for an earlier gesture ignored" (~836) and returns; the provider still
// returns its items (~1265) and the editor draws the ghost with the gesture idle. Escape
// did not stop the ghost. The row asks for a hide after the disowned serve.
// ---------------------------------------------------------------------------
test("P2-A: Escape while the dictated request is in flight must not leave the late ghost drawn with the gesture idle", async () => {
  const { output, lines } = channel();
  const provider = newProvider(output);
  const d = newDictation(output, { armIntent: (i) => provider.armIntent(i), disarmIntent: () => provider.disarmIntent() });
  __state.activeTextEditor = editorAt(10, "\n".repeat(30));
  __state.executeCalls = [];
  d.state = requesting(10);
  d.dispatch({ type: "intent", comment: "// A point.", matched: 0, refused: 0 });
  await sleep(20);
  const taken = provider.takeIntent(URI, 10);
  assert.ok(taken !== undefined, "CONTROL: the request consumed the intent before Escape");
  d.cancel();
  assert.equal(d.phase, "idle", "CONTROL: Escape in requesting went idle");
  const mark = __state.executeCalls.length;
  const answer = taken.onServed(true); // the provider's settleIntent(true), then `return items`
  await sleep(20);
  const hidAfter = __state.executeCalls.slice(mark).some((c) => c.id === "editor.action.inlineSuggest.hide");
  assert.ok(
    answer === false || hidAfter,
    `the disowned serve was neither refused to the provider (onServed returned ${answer}) nor hidden afterwards; the editor draws a ghost the gesture already cancelled:\n${dictateLines(lines)}`,
  );
});

// ---------------------------------------------------------------------------
// P2-B. Escape in `requesting` BEFORE the trigger reached the provider. armAndTrigger
// (dictation.ts ~857) chains hide -> trigger on promises and nothing cancels the chain,
// so `editor.action.inlineSuggest.trigger` fires after the cancel: a request the human
// just cancelled, served as a plain automatic FIM at the site when column80.enabled is on.
// ---------------------------------------------------------------------------
test("P2-B: Escape right after the intent armed must not let the inline-suggest trigger fire afterwards", async () => {
  const { output } = channel();
  const provider = newProvider(output);
  const d = newDictation(output, { armIntent: (i) => provider.armIntent(i), disarmIntent: () => provider.disarmIntent() });
  __state.activeTextEditor = editorAt(10, "\n".repeat(30));
  __state.executeCalls = [];
  d.state = requesting(10);
  d.dispatch({ type: "intent", comment: "// A point.", matched: 0, refused: 0 });
  d.cancel();
  assert.equal(provider.pendingIntent, undefined, "CONTROL: the intent was disarmed");
  const mark = __state.executeCalls.length;
  await sleep(30);
  const triggeredAfter = __state.executeCalls.slice(mark).filter((c) => c.id === "editor.action.inlineSuggest.trigger");
  assert.equal(triggeredAfter.length, 0, `the trigger fired ${triggeredAfter.length} time(s) after Escape; downgradeNextManual=${provider.downgradeNextManual}`);
});

// ---------------------------------------------------------------------------
// P2-C. The landing watch starts only on the commit's RESOLVE (commitAndWatch, dictation.ts
// ~528); the rejection arm (~532) logs and returns, and schedules no retry either. A commit that throws leaves the gesture in
// `ghost` with the stale label, the exact symptom this session is about.
// ---------------------------------------------------------------------------
test("P2-C: an auto-commit that rejects still ends the gesture inside the grace", async () => {
  const { output, lines } = channel();
  const d = newDictation(output);
  __state.activeTextEditor = editorAt(10, "\n".repeat(30));
  __state.commandHandlers["editor.action.inlineSuggest.commit"] = () => Promise.reject(new Error("no inline completion to commit"));
  try {
    d.state = requesting(10);
    d.dispatch({ type: "served", ghost: true });
    assert.equal(d.phase, "ghost", "CONTROL: served put the gesture in ghost");
    await sleep(120 + 3 * 300 + 300);
    assert.equal(d.phase, "idle", `the gesture is still in ${d.phase} after the commit rejected:\n${dictateLines(lines)}`);
  } finally {
    delete __state.commandHandlers["editor.action.inlineSuggest.commit"];
  }
});

// ---------------------------------------------------------------------------
// P2-D. Controls for the landing watch (should pass): a commit that lands nothing ends
// the gesture with the channel line; a commit whose edit arrives on the site keeps it.
// ---------------------------------------------------------------------------
test("P2-D control: a resolved commit with no site edit ends the gesture; with the site edit it stays in ghost", async () => {
  const { output, lines } = channel();
  const d = newDictation(output);
  __state.activeTextEditor = editorAt(10, "\n".repeat(30));
  d.state = requesting(10);
  d.dispatch({ type: "served", ghost: true });
  await sleep(120 + 3 * 300 + 300);
  assert.equal(d.phase, "idle");
  assert.ok(lines.some((l) => l.includes("[dictate] nothing landed")), dictateLines(lines));

  const second = channel();
  const d2 = newDictation(second.output);
  d2.state = requesting(10);
  d2.dispatch({ type: "served", ghost: true });
  await sleep(160);
  d2.onDocumentChanged(editOn(10));
  // AMENDED 2026-09-02 (review round 2, finding 5): an edit on the site with NO accept command
  // is the goal's reasoned third defect, and the gesture must not sit in `ghost` on it. After
  // the watch sees the edit it grants one more grace for the accept, then ends the gesture.
  await sleep(300);
  assert.equal(d2.phase, "ghost", `still waiting for the accept inside the grace: ${dictateLines(second.lines)}`);
  await sleep(3 * 300 + 300);
  assert.equal(d2.phase, "idle", dictateLines(second.lines));
  assert.ok(second.lines.some((l) => l.includes("an edit landed on the site but no accept arrived")), dictateLines(second.lines));
});

// ---------------------------------------------------------------------------
// P2-E. Control: Escape in arming and recording goes idle, clears both context keys and
// never triggers or transcribes (rule 12).
// ---------------------------------------------------------------------------
test("P2-E control: Escape in arming and recording goes idle with the keys down and nothing requested", async () => {
  const { output, lines } = channel();
  const d = newDictation(output);
  __state.activeTextEditor = editorAt(0, "x\n");
  const ready = { remote: false, binaryPresent: true, modelPresent: true, recogniserAlive: true, served: true, commentRow: true, inComment: false };
  __state.executeCalls = [];
  d.dispatch({ type: "press", site: { uri: URI, line: 0 }, languageId: "typescript", indentColumns: 0, now: 1, ready, ghostVisible: false });
  assert.equal(d.phase, "arming");
  d.cancel();
  assert.equal(d.phase, "idle");
  await sleep(50);
  const keys = __state.executeCalls.filter((c) => c.id === "setContext").map((c) => `${c.args[0]}=${c.args[1]}`);
  assert.ok(keys.includes("column80.recording=false"), keys.join(" "));
  assert.ok(!__state.executeCalls.some((c) => c.id === "editor.action.inlineSuggest.trigger"));
  assert.ok(lines.some((l) => l.includes("cancelled by Escape before the mic opened")), dictateLines(lines));
});
