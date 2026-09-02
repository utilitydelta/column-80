// session-v65 phase 4/5 adversarial review: the dictate-then-FIM gesture.
//
// Failing rows are EVIDENCE, not regressions to fix by editing this file. Each
// row names the source line it attacks. The adapter (`src/vscode/dictation.ts`)
// and the provider (`src/vscode/completionProvider.ts`) are bundled REAL against
// the shared activation stub, the way `impl-v55-p23-activation-stub.test.cjs`
// does; nothing here is a hand-rolled approximation of either.
//
// Run: SKIP_LIVE=1 node --test test/adversarial-v65-p4-gesture.test.cjs
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { bundleActivation } = require("./.activation-stub.cjs");

// No native binaries, no model: every path resolves into an empty scratch dir so
// a spawn fails ENOENT and `existsSync(model)` is false, without touching the box.
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), "adv-v65-"));
process.env.COLUMN80_NATIVE_DIR = SCRATCH;
process.env.COLUMN80_WHISPER_MODEL = path.join(SCRATCH, "missing-base.en.bin");
process.env.COLUMN80_VAD_MODEL = path.join(SCRATCH, "missing-vad.bin");

const built = bundleActivation(
  "adversarial-v65-p4",
  `export { Dictation } from "../src/vscode/dictation";
export { env, window } from "vscode";
export { membersWithHoverSignatures, hoverBackfillOptions } from "../src/core/extraction";
export { pyLspSymbolRole, toPySymbolMember } from "../src/core/pyExtraction";\n`,
);
test.after(() => {
  built.cleanup();
  fs.rmSync(SCRATCH, { recursive: true, force: true });
});
const { Dictation, providerModule, __state, Position, env, window } = built.mod;
const CORE = built.mod;

const URI = "file:///w/v65/app.py";

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
      uri: { toString: () => URI },
      languageId: "python",
      version: 1,
      eol: 1,
      lineCount: Math.max(lines.length, line + 1),
      getText: () => text,
      lineAt: (n) => ({ text: lines[n] ?? "    ", range: { end: new Position(n, (lines[n] ?? "    ").length) } }),
    },
    selection: { active: new Position(line, 4) },
    setDecorations() {},
  };
}
const requesting = (line) => ({ phase: "requesting", site: { uri: URI, line }, languageId: "python", indentColumns: 4, heard: "Retry." });

// ---------------------------------------------------------------------------
// The whole-block fixture, copied from blind-v51-p3-capsplit so the resolver
// walks a real transport shape: a Python class whose members hover.
// ---------------------------------------------------------------------------
const ROOT = "GraphEngine";
const N = 3;
const memberName = (i) => `method_${i}`;
const SRC = [`class ${ROOT}:`, ...Array.from({ length: N }, (_, i) => `    def ${memberName(i)}(self, a: int) -> None: ...`), "", `def build(p0: ${ROOT}) -> int:`, "    raise NotImplementedError", ""].join("\n");
const SYMBOLS = [
  {
    name: ROOT,
    kind: 5,
    detail: "",
    range: { start: { line: 0, character: 0 }, end: { line: N + 1, character: 0 } },
    selectionRange: { start: { line: 0, character: 6 }, end: { line: 0, character: 6 + ROOT.length } },
    children: Array.from({ length: N }, (_, i) => ({
      name: memberName(i),
      kind: 12,
      detail: "",
      range: { start: { line: 1 + i, character: 4 }, end: { line: 1 + i, character: 60 } },
      selectionRange: { start: { line: 1 + i, character: 8 }, end: { line: 1 + i, character: 8 + memberName(i).length } },
    })),
  },
];
const wordAt = (text, cursor) => {
  const line = text.split("\n")[cursor.line] ?? "";
  const isWord = (ch) => /[A-Za-z0-9_]/.test(ch);
  let s = Math.min(cursor.character, line.length);
  let e = s;
  while (s > 0 && isWord(line[s - 1])) s--;
  while (e < line.length && isWord(line[e])) e++;
  return e > s ? line.slice(s, e) : undefined;
};
const extractor = {
  async completeMembers() { return []; },
  async definition(cursor) {
    return wordAt(SRC, cursor) === ROOT ? { uri: URI, range: { startLine: 0, startCharacter: 6, endLine: 0, endCharacter: 6 + ROOT.length } } : undefined;
  },
  async hoverSurface(cursor) { return wordAt(SRC, cursor) === ROOT ? { signature: `class ${ROOT}` } : undefined; },
  async membersOfType(defCursor, budgetMs, opts) {
    return CORE.membersWithHoverSignatures(SYMBOLS, defCursor, CORE.pyLspSymbolRole, CORE.toPySymbolMember,
      async (at) => { const i = at.line - 1; return i >= 0 && i < N ? `(method) def ${memberName(i)}(self, a: int) -> None` : undefined; },
      CORE.hoverBackfillOptions(budgetMs, opts));
  },
  async example() { return undefined; },
  async qualifyImport() { return undefined; },
};
function makeDoc(text) {
  const lines = text.split("\n");
  const offsetAt = (p) => { let o = 0; for (let i = 0; i < Math.min(p.line, lines.length); i++) o += lines[i].length + 1; return Math.min(o + p.character, text.length); };
  const positionAt = (off) => { let o = 0; for (let l = 0; l < lines.length; l++) { if (off <= o + lines[l].length) return new Position(l, off - o); o += lines[l].length + 1; } return new Position(0, 0); };
  return { languageId: "python", version: 1, uri: { toString: () => URI }, offsetAt, positionAt, getText: (r) => (r ? text.slice(offsetAt(r.start), offsetAt(r.end)) : text) };
}

// ---------------------------------------------------------------------------
// R1. resolveWholeBlock({ forIntent: true }) says it "neither reads nor fills"
// the per-file-version cache (completionProvider.ts ~1474) and then fills it
// unconditionally at ~1570. The dictated root list becomes the next keystroke's
// whole-block block for that file version.
// ---------------------------------------------------------------------------
test("R1: a dictated whole-block resolve must not fill the per-file-version injection cache", async () => {
  globalThis.__V9_DOCS__ = { [URI]: { getText: () => SRC } };
  const { output } = channel();
  const provider = newProvider(output);
  const dictated = await provider.resolveWholeBlock(makeDoc(SRC), extractor, [ROOT], { forIntent: true });
  assert.ok(typeof dictated === "string" && dictated.includes(ROOT), `CONTROL: the dictated resolve rendered a block: ${JSON.stringify(dictated)}`);
  assert.equal(
    provider.injectionCache.get(URI, 1),
    undefined,
    `the dictated block was written to injectionCache(${URI}, v1): ${JSON.stringify(provider.injectionCache.get(URI, 1))}`,
  );
  // And what the next plain keystroke at this version gets: a root that resolves
  // to nothing should inject nothing, and instead is answered with the dictation's block.
  const plain = await provider.resolveWholeBlock(makeDoc(SRC), extractor, ["NoSuchType"]);
  assert.equal(plain, undefined, `a plain whole-block resolve for an unresolvable root was served the DICTATED block from the cache: ${JSON.stringify(plain)}`);
});

// ---------------------------------------------------------------------------
// R2. Contract rule 27: the mic stays open while the caret moves and "the intent
// rides on the site of the PRESS". triggerFim (dictation.ts ~557) checks only the
// URI and fires editor.action.inlineSuggest.trigger wherever the caret is; the
// provider's takeIntent (completionProvider.ts ~887) is keyed on position.line
// and drops the intent, then serves a PLAIN downgraded ghost at the caret.
// ---------------------------------------------------------------------------
test("R2: a caret moved off the press line during the take still gets the comment at the press site", async () => {
  const { output, lines } = channel();
  const provider = newProvider(output);
  const d = newDictation(output, { armIntent: (i) => provider.armIntent(i) });
  __state.activeTextEditor = editorAt(20, "\n".repeat(30));
  __state.executeCalls = [];
  d.state = requesting(10);
  d.dispatch({ type: "intent", comment: "# Retry the fetch.", matched: 0, refused: 0 });
  // The trigger is hide-then-trigger behind a focus check, all promise-chained.
  await new Promise((r) => setTimeout(r, 30));
  assert.ok(__state.executeCalls.some((c) => c.id === "editor.action.inlineSuggest.trigger"), "CONTROL: the trigger fired");
  // What the provider does with the request the trigger produces: the caret's line.
  const taken = provider.takeIntent(URI, __state.activeTextEditor.selection.active.line);
  assert.ok(
    taken !== undefined && d.phase === "requesting",
    `the intent spoken at line 10 was dropped because the trigger's request came from the caret at line 20; phase=${d.phase}; channel:\n${lines.filter((l) => l.includes("dictate")).join("\n")}`,
  );
});

// ---------------------------------------------------------------------------
// R3. `served` carries no identity. armIntent (completionProvider.ts ~255) calls
// the REPLACED intent's onServed(false) and the adapter dispatches it into the
// SUCCESSOR gesture, which is in `requesting`: rule 21 ends it. The successor's
// own serve then lands in idle and is ignored. Reachable whenever a trigger did
// not reach takeIntent (column80.fim off, inline suggest disabled by the user,
// or the editor declining the trigger) and the user re-presses to try again.
// ---------------------------------------------------------------------------
test("R3: an unserved earlier intent must not end the gesture that replaces it", () => {
  const { output, lines } = channel();
  const provider = newProvider(output);
  const d = newDictation(output, { armIntent: (i) => provider.armIntent(i) });
  __state.activeTextEditor = editorAt(10, "\n".repeat(30));
  d.state = requesting(10);
  d.dispatch({ type: "intent", comment: "# First.", matched: 0, refused: 0 }); // armed, never consumed
  // Re-press (rule 3), take, transcript: the successor is in requesting again.
  d.state = requesting(10);
  d.dispatch({ type: "intent", comment: "# Second.", matched: 0, refused: 0 });
  const phaseAfterArm = d.phase;
  const taken = provider.takeIntent(URI, 10);
  assert.ok(taken !== undefined, "CONTROL: the second intent is the armed one");
  taken.onServed(true);
  assert.equal(
    d.phase,
    "ghost",
    `the replaced intent's onServed(false) ended the successor (phase after arm: ${phaseAfterArm}); the ghost is on screen with the gesture idle:\n${lines.filter((l) => l.includes("dictate")).join("\n")}`,
  );
});

// ---------------------------------------------------------------------------
// R4. refuse("model-missing") calls ensureReady(true) (dictation.ts ~603), which
// re-offers the download while the first offer's toast or download is still open.
// ---------------------------------------------------------------------------
test("R4 (RE-RULED 2026-09-02): a press while the activation offer is still open DOES raise a fresh offer; the download itself is single-flight", async () => {
  // The human hit the old rule on the first try: the activation toast had folded into the
  // notification bell with its promise pending, the press was de-duplicated against it, and
  // the status bar said "not downloaded yet" with nothing visible to click. Now every press
  // re-offers in the foreground, and two Download clicks start one download.
  const { output } = channel();
  const original = window.showInformationMessage;
  window.showInformationMessage = (message, ...actions) => {
    __state.messages.push({ kind: "info", message, actions });
    return new Promise(() => {}); // the toast stays open
  };
  try {
    __state.messages = [];
    const d = newDictation(output);
    void d.ensureReady(true); // activation's offer
    await new Promise((r) => setImmediate(r));
    d.execute({ type: "refuse", kind: "model-missing" }); // the press's refusal
    await new Promise((r) => setImmediate(r));
    const offers = __state.messages.filter((m) => /speech model/.test(m.message));
    assert.equal(offers.length, 2, `the press must put a fresh offer in front of the user: ${offers.map((m) => m.message).join(" | ")}`);
    // Two clicks, one download: fetchModel for the same destination returns the same promise.
    const spec = { name: "x", url: "http://127.0.0.1:1/none", file: "x.bin", bytes: 1, sha256: "00" };
    const dest = path.join(os.tmpdir(), `c80-r4-${process.pid}`, "x.bin");
    const a = d.fetchModel(spec, dest);
    const b = d.fetchModel(spec, dest);
    assert.strictEqual(a, b, "the second Download click joins the in-flight download");
    await Promise.allSettled([a, b]);
  } finally {
    window.showInformationMessage = original;
  }
});

// ---------------------------------------------------------------------------
// R5. Ruling 4: Remote is refused at the PRESS (vscode.env.remoteName). ensureReady
// (dictation.ts ~172) never reads it, so the remote host is offered a 150MB
// download and, once present, a resident recogniser for a gesture that refuses.
// ---------------------------------------------------------------------------
test("R5: on a Remote host the speech model must not be offered at activation", async () => {
  const { output } = channel();
  env.remoteName = "ssh-remote";
  try {
    __state.messages = [];
    const d = newDictation(output);
    await d.ensureReady(true);
    const offers = __state.messages.filter((m) => /speech model/.test(m.message));
    assert.equal(offers.length, 0, `offered on the remote host: ${offers.map((m) => m.message).join(" | ")}`);
  } finally {
    delete env.remoteName;
  }
});

// ---------------------------------------------------------------------------
// R6. documentNames (dictation.ts ~103): kind is `^[A-Z]`, so a SCREAMING
// constant is a "type" and becomes a resolver root; camel detection wants a
// lowercase-then-uppercase pair, so `HTTPServer`/`IOError` are never harvested.
// ---------------------------------------------------------------------------
test("R6: the harvest labels a constant a type and misses acronym-led class names", () => {
  const { output, lines } = channel();
  const d = newDictation(output);
  __state.activeTextEditor = editorAt(3, "MAX_RETRIES = 3\nclass HTTPServer:\n    pass\n");
  d.state = { phase: "idle" }; // the dispatched `intent` is ignored; only the harvest is under test
  d.buildIntent("Retry up to max retries times on the http server.", "python", 4);
  const log = lines.find((l) => l.startsWith("[dictate] backticks:")) ?? "(no backticks line)";
  // TRIAGED: `HTTPServer` IS a type root (upper start, lower letters inside); only the constant
  // must be kept out.
  assert.deepEqual(d.pendingRoots, ["HTTPServer"], `MAX_RETRIES was handed to the type resolver as a root: ${JSON.stringify(d.pendingRoots)}; ${log}`);
  assert.ok(/matched=.*HTTPServer/.test(log), `HTTPServer was not harvested, so "http server" matched nothing: ${log}`);
});

// ---------------------------------------------------------------------------
// R7. Harvest cost per gesture on a 500KB document (measurement, reported).
// ---------------------------------------------------------------------------
test("R7: documentNames over 500KB stays inside a keystroke's budget", () => {
  const { output } = channel();
  const d = newDictation(output);
  const unit = "def enroll_tile(self, shard_key):\n    return ShardMemCache.lookup(shard_key, MAX_DEPTH)\n";
  const big = unit.repeat(Math.ceil(512_000 / unit.length));
  __state.activeTextEditor = editorAt(0, big);
  d.state = { phase: "idle" };
  const t0 = process.hrtime.bigint();
  d.buildIntent("Enroll the tile.", "python", 0);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  console.log(`[adv-v65] documentNames over ${(big.length / 1024).toFixed(0)}KB: ${ms.toFixed(1)}ms`);
  assert.ok(ms < 100, `${ms.toFixed(1)}ms`);
});

// ---------------------------------------------------------------------------
// R8. Context keys the adapter sets and never clears: `column80.recording` goes
// true in startCapture (~436) and false only in stopCapture (~465), so the
// abort paths (press in arming, error, child death) leave it true;
// `column80.dictationGhost` is set from renderIndicator and never cleared by
// dispose(), so an extension host restart mid-ghost leaves Escape bound to a
// command that no longer exists.
// ---------------------------------------------------------------------------
test("R8: abort-capture and dispose clear the context keys they raised", async () => {
  const { output } = channel();
  const d = newDictation(output);
  __state.activeTextEditor = editorAt(0, "x\n");
  __state.executeCalls = [];
  // TRIAGED: the keys follow the PHASE through dispatch (raised on arming/recording and on
  // ghost, cleared on any way back to idle and on dispose), not the individual actions.
  const ready = { remote: false, binaryPresent: true, modelPresent: true, recogniserAlive: true, served: true, commentRow: true, inComment: false };
  d.dispatch({ type: "press", site: { uri: URI, line: 0 }, languageId: "python", indentColumns: 0, now: 1, ready, ghostVisible: false });
  d.dispatch({ type: "error", message: "boom" });
  await new Promise((r) => setTimeout(r, 50)); // let the ENOENT child settle
  const recording = __state.executeCalls.filter((c) => c.id === "setContext" && c.args[0] === "column80.recording").map((c) => c.args[1]);
  assert.deepEqual(recording, [true, false], `column80.recording after press then error: ${JSON.stringify(recording)}`);

  __state.executeCalls = [];
  d.state = requesting(0);
  d.dispatch({ type: "served", ghost: true });
  d.dispose();
  const ghost = __state.executeCalls.filter((c) => c.id === "setContext" && c.args[0] === "column80.dictationGhost").map((c) => c.args[1]);
  assert.deepEqual(ghost, [true, false], `column80.dictationGhost across served then dispose: ${JSON.stringify(ghost)}`);
});
