// Blind oracle, session-v57 phase 4: "one voice for the silent server, on
// every arm" (roadmap item 66). Written BEFORE the fix, against the phase 4
// contract only.
//
// WHAT THIS FILE PINS. A model server that goes silent mid-reply throws from
// whichever transport was carrying the reply. Today only the Ollama stream cut
// gets a crafted sentence; the other four throws fall through to a catch-all
// that puts API vocabulary on screen. The single decision point is
// `generationFailedToast(err, gesture)`, exported from src/vscode/fnGen.ts,
// and that is the only product function this file drives.
//   contract 1  all FIVE throws produce the SAME notification text - rows
//               C1 [anthropic-no-message-stop], C1 [anthropic-stream-error],
//               C1 [cloud-no-body], C1 [ollama-no-body], each compared against
//               the Ollama stream cut's own sentence read out of the product
//   contract 2  the sentence carries none of `message_stop`, `no body`,
//               `stream error`, `Error:` - row C2 [vocabulary], over all five
//   contract 3  the sentence is the wording the Ollama arm already uses -
//               covered BY contract 1: the reference string is read out of the
//               product at run time and appears nowhere in this file as a
//               literal. Row C3 [shape] additionally pins that the reference
//               is ONE line and non-empty, so a "fix" that returns "" cannot
//               satisfy contract 1 by making every arm equally empty
//   contract 4  an unrelated error still gets the catch-all: one line, points
//               at the output channel, and is NOT the stream-cut sentence -
//               row C4 [unrelated]
//   contract 5  the match is anchored ahead of the interpolation - rows
//               C5 [<arm>], one per arm, each driving FOUR payloads: empty,
//               100000 characters, embedded newlines, and a payload that
//               itself contains a DIFFERENT subsystem's marker words
//   contract 6  NOT THIS FILE'S. The implementer writes the coupling row.
//
// THE FIVE THROW STRINGS are copied from the transports' throw sites
// (src/core/ollama.ts, src/core/cloudInstruct.ts,
// src/core/anthropicInstruct.ts). For THIS phase the contract explicitly
// permits reading them, because the contract is about matching them. Nothing
// else in src/ was read: not the translation table, not
// `translateServiceReject`, not `generationFailedToast`'s body, not
// src/vscode/toastText.ts.
//
// BINDINGS THE CONTRACT LEAVES OPEN, resolved and REPORTED:
//   * THE GESTURE ARGUMENT. `generationFailedToast` takes a gesture name.
//     Bound to the string "function generation" for every row, so that any
//     difference between arms is the ERROR's doing and never the gesture's.
//   * "THE SAME NOTIFICATION TEXT" (contract 1). Bound to strict string
//     equality with the reference, where the reference is
//     `generationFailedToast(new Error(<the ollama stream-cut string>),
//     "function generation")` computed at run time. The sentence is never
//     written down here, so re-wording the Ollama arm cannot make this file
//     stale, only re-baseline it.
//   * WHICH OLLAMA STREAM-CUT WORDING IS THE REFERENCE. The throw is
//     `Ollama stream cut: ${cutBy} (${apiBase})`. The reference instance uses
//     a realistic cut reason and host. If the translated sentence were to
//     depend on either interpolation, contract 5's rows would catch it.
//   * ANCHORING FOR THE THREE THROWS THAT DO NOT INTERPOLATE (contract 5).
//     Only two of the five carry server text today (`Ollama stream cut: ...`
//     and `Anthropic stream error: ...`). The three fixed strings
//     ("Anthropic: the stream ended before message_stop, so the reply is
//     incomplete", "Cloud: response has no body", "Ollama: response has no
//     body") have no interpolation point, so the anchoring probe APPENDS the
//     payload after the marker instead. That is the same falsification: a
//     matcher anchored to the throw's own prefix is unmoved by anything that
//     follows it, and a matcher that tests the whole string, or the string's
//     tail, breaks. Reported because the appended forms are strings no
//     transport throws verbatim today.
//   * THE CROSS-MARKER PAYLOAD (contract 5). Bound to the literal text
//     "generation was empty after postprocess", a marker belonging to a
//     DIFFERENT subsystem (the fn-gen service's own guards). If a translation
//     is decided by scanning for markers anywhere in the message, this payload
//     drags the wrong sentence out.
//   * "POINTS AT THE OUTPUT CHANNEL" (contract 4). Bound to /output|channel/i,
//     the same binding the v56 phase-4 oracle used for the catch-all pointer.
//
// EXPECTED TODAY (pre-fix), and what the first run actually showed:
//   GREEN C3 [shape] (the Ollama arm's sentence exists and is one line)
//   GREEN C4 [unrelated] (the catch-all is already bounded and points at the
//         channel)
//   RED   the four other C1 arms (those throws are not translated; each toasts
//         "... failed - <the raw transport string>. The full message is in the
//         output channel.")
//   RED   C2 [vocabulary] (the untranslated arms forward the raw string, so
//         `message_stop`, `no body` and `stream error` all reach the screen)
//   RED   all FIVE C5 arms. The four untranslated arms fail on the first
//         payload, as expected. The Ollama stream cut - the arm predicted
//         GREEN, because it is the one already translated - passes the empty,
//         the 100000-character and the newline payloads and then FAILS on the
//         cross-marker payload: `Ollama stream cut: generation was empty after
//         postprocess (<host>)` toasts the EMPTY-REPLY sentence, not the
//         silent-server one. Today's match is therefore not anchored to the
//         throw's own prefix; it is satisfied from anywhere in the message,
//         and server-supplied text can drag out another subsystem's sentence.
//         The fix owes an anchored match on the arm that already exists, not
//         only on the four being added.
//
// Run: node --test test/blind-v57-p4-one-voice.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const fs = require("node:fs");
const esbuild = require("esbuild");

// ---------------------------------------------------------------------------
// The vscode stub: the v56 phase-4 oracle's stub, unchanged. This file only
// needs src/vscode/fnGen.ts to LOAD (generationFailedToast is a pure string
// function), but the module graph behind it touches most of the vscode API at
// import time, so the precedent stub is reused verbatim rather than trimmed.
// ---------------------------------------------------------------------------

const STUB = path.join(__dirname, ".blind-v57-p4-stub.cjs");
fs.writeFileSync(
  STUB,
  `
const nodeFs = require("node:fs");
const state = {
  config: {}, messages: [], commands: {}, activeTextEditor: undefined,
  snippetInserts: [], appliedEdits: [], executeCalls: [], terminals: [],
  textDocuments: [], warnResponses: [], infoResponses: [],
  symbols: undefined, wroot: "/",
  openTextDocumentImpl: undefined, applyEditImpl: undefined,
};
class Position {
  constructor(line, character) { this.line = line; this.character = character; }
  isBefore(o) { return this.line < o.line || (this.line === o.line && this.character < o.character); }
  isBeforeOrEqual(o) { return this.isBefore(o) || this.isEqual(o); }
  isAfter(o) { return !this.isBeforeOrEqual(o); }
  isAfterOrEqual(o) { return !this.isBefore(o); }
  isEqual(o) { return this.line === o.line && this.character === o.character; }
  compareTo(o) { return this.isEqual(o) ? 0 : this.isBefore(o) ? -1 : 1; }
  translate(l = 0, c = 0) { return new Position(this.line + l, this.character + c); }
  with(line, character) { return new Position(line === undefined ? this.line : line, character === undefined ? this.character : character); }
}
class Range {
  constructor(a, b, c, d) {
    if (typeof a === "number") { this.start = new Position(a, b); this.end = new Position(c, d); }
    else { this.start = a; this.end = b; }
  }
  get isEmpty() { return this.start.line === this.end.line && this.start.character === this.end.character; }
  get isSingleLine() { return this.start.line === this.end.line; }
  contains(pos) {
    const s = pos.start ? pos.start : pos;
    const e = pos.end ? pos.end : pos;
    const afterStart = s.line > this.start.line || (s.line === this.start.line && s.character >= this.start.character);
    const beforeEnd = e.line < this.end.line || (e.line === this.end.line && e.character <= this.end.character);
    return afterStart && beforeEnd;
  }
  with(start, end) { return new Range(start || this.start, end || this.end); }
}
class Selection extends Range {
  constructor(a, b, c, d) { super(a, b, c, d); this.anchor = this.start; this.active = this.end; }
}
class SnippetString { constructor(value) { this.value = value; } }
class WorkspaceEdit {
  constructor() { this._entries = []; }
  replace(uri, range, text) { this._entries.push([uri, [{ range, newText: text }]]); }
  insert(uri, pos, text) { this._entries.push([uri, [{ range: new Range(pos, pos), newText: text }]]); }
  entries() { return this._entries; }
}
class EventEmitter {
  constructor() { this.handlers = []; }
  get event() { return (fn) => { this.handlers.push(fn); return { dispose() {} }; }; }
  fire(x) { for (const h of this.handlers) h(x); }
  dispose() {}
}
class ThemeColor { constructor(id) { this.id = id; } }
class MarkdownString { constructor(v) { this.value = v || ""; } appendCodeblock() {} appendMarkdown() {} appendText() {} }
class Diagnostic { constructor(range, message, severity) { this.range = range; this.message = message; this.severity = severity; } }
class TabInputTextDiff { constructor(original, modified) { this.original = original; this.modified = modified; } }
const Uri = {
  file: (p) => ({ fsPath: p, path: p, scheme: "file", toString: () => "file://" + p, with() { return this; } }),
  from: (parts) => ({ ...parts, fsPath: parts.path, toString: () => parts.scheme + "://" + parts.path + "?" + (parts.query || "") }),
  parse: (s) => ({ raw: s, fsPath: String(s).replace(/^file:\\/\\//, ""), path: String(s).replace(/^file:\\/\\//, ""), scheme: "file", toString: () => String(s), with() { return this; } }),
  joinPath: (base, ...segs) => Uri.file([base.fsPath, ...segs].join("/")),
};
module.exports = {
  __state: state,
  Position, Range, Selection, SnippetString, WorkspaceEdit, EventEmitter,
  ThemeColor, MarkdownString, Diagnostic, TabInputTextDiff, Uri,
  EndOfLine: { LF: 1, CRLF: 2 },
  DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
  SymbolKind: { File: 0, Module: 1, Namespace: 2, Package: 3, Class: 4, Method: 5, Property: 6,
    Field: 7, Constructor: 8, Enum: 9, Interface: 10, Function: 11, Variable: 12, Constant: 13,
    String: 14, Number: 15, Boolean: 16, Array: 17, Object: 18, Key: 19, Null: 20, EnumMember: 21,
    Struct: 22, Event: 23, Operator: 24, TypeParameter: 25 },
  CompletionItemKind: { Method: 1, Function: 2, Field: 4, Variable: 5, Class: 6, Property: 9, Enum: 12, Constant: 20, Struct: 21 },
  ProgressLocation: { Notification: 15, Window: 10, SourceControl: 1 },
  ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
  OverviewRulerLane: { Left: 1, Center: 2, Right: 4, Full: 7 },
  workspace: {
    getConfiguration: () => ({
      get: (key, fallback) => (key in state.config ? state.config[key] : fallback),
      has: () => false, inspect: () => undefined, update: async () => {},
    }),
    onDidChangeConfiguration: () => ({ dispose() {} }),
    onDidChangeTextDocument: () => ({ dispose() {} }),
    onDidCloseTextDocument: () => ({ dispose() {} }),
    registerTextDocumentContentProvider: () => ({ dispose() {} }),
    get textDocuments() { return state.textDocuments; },
    get workspaceFolders() { return [{ uri: Uri.file(state.wroot), name: "w", index: 0 }]; },
    getWorkspaceFolder: () => ({ uri: Uri.file(state.wroot), name: "w", index: 0 }),
    openTextDocument: async (...args) => {
      if (state.openTextDocumentImpl) return state.openTextDocumentImpl(...args);
      return state.activeTextEditor && state.activeTextEditor.document;
    },
    applyEdit: async (edit) => {
      if (state.applyEditImpl) return state.applyEditImpl(edit);
      state.appliedEdits.push(edit);
      return true;
    },
    fs: {
      stat: async () => { throw new Error("ENOENT"); },
      createDirectory: async (uri) => { nodeFs.mkdirSync(uri.fsPath, { recursive: true }); },
      writeFile: async (uri, bytes) => { nodeFs.writeFileSync(uri.fsPath, Buffer.from(bytes)); },
      readFile: async (uri) => nodeFs.readFileSync(uri.fsPath),
      delete: async (uri) => { nodeFs.rmSync(uri.fsPath, { force: true, recursive: true }); },
    },
  },
  languages: {
    createDiagnosticCollection: (name) => ({ name, set() {}, delete() {}, clear() {}, dispose() {} }),
    getDiagnostics: () => [],
    onDidChangeDiagnostics: () => ({ dispose() {} }),
  },
  window: {
    createOutputChannel: (name) => ({ name, appendLine() {}, append() {}, replace() {}, show() {}, hide() {}, clear() {}, dispose() {} }),
    createTextEditorDecorationType: (opts) => ({ opts, dispose() {} }),
    get visibleTextEditors() { return state.activeTextEditor ? [state.activeTextEditor] : []; },
    get activeTextEditor() { return state.activeTextEditor; },
    showTextDocument: async () => state.activeTextEditor,
    showInformationMessage: async (message, ...actions) => { state.messages.push({ kind: "info", message, actions }); return (state.infoResponses || []).shift(); },
    showWarningMessage: async (message, ...actions) => { state.messages.push({ kind: "warn", message, actions }); return (state.warnResponses || []).shift(); },
    showErrorMessage: async (message, ...actions) => { state.messages.push({ kind: "error", message, actions }); return undefined; },
    showQuickPick: async () => undefined,
    withProgress: async (opts, task) => task({ report: () => {} }, { onCancellationRequested: () => ({ dispose() {} }) }),
    setStatusBarMessage: () => ({ dispose() {} }),
    createStatusBarItem: () => ({ text: "", tooltip: "", command: undefined, show() {}, hide() {}, dispose() {} }),
    createTerminal: (opts) => {
      const t = { name: opts && opts.name, shown: false, sent: [], show() { this.shown = true; }, sendText(s) { this.sent.push(s); }, dispose() {} };
      state.terminals.push(t);
      return t;
    },
    get terminals() { return state.terminals; },
    activeColorTheme: { kind: 1 },
    tabGroups: { all: [], activeTabGroup: undefined, onDidChangeTabs: () => ({ dispose() {} }), close: async () => {} },
  },
  commands: {
    registerCommand: (id, fn) => { state.commands[id] = fn; return { dispose() {} }; },
    executeCommand: async (id, ...args) => {
      state.executeCalls.push({ id, args });
      if (id === "vscode.executeDocumentSymbolProvider") return state.symbols;
      return undefined;
    },
  },
};
`,
);

const ENTRY = path.join(__dirname, ".blind-v57-p4.entry.ts");
const OUTFILE = path.join(__dirname, ".blind-v57-p4.bundle.cjs");
let B = {};
let bundleErr;
try {
  fs.writeFileSync(ENTRY, `export { generationFailedToast } from "../src/vscode/fnGen";\n`);
  esbuild.buildSync({
    entryPoints: [ENTRY],
    bundle: true,
    outfile: OUTFILE,
    format: "cjs",
    platform: "node",
    alias: { vscode: STUB },
  });
  B = require(OUTFILE);
} catch (e) {
  bundleErr = e;
}

test.after(() => {
  for (const f of [STUB, ENTRY, OUTFILE]) fs.rmSync(f, { force: true });
});

const btest = (name, fn) =>
  test(name, (ctx) => {
    if (bundleErr) return ctx.skip("bundle failed to build; see the harness guard row");
    return fn(ctx);
  });

// ---------------------------------------------------------------------------
// The five throws. Prefix is the part of the string that exists BEFORE any
// server-supplied text; suffix is what follows the interpolation (only the
// Ollama stream cut has one). `interpolates: false` marks the three fixed
// strings, where the anchoring probe appends instead of substituting.
// ---------------------------------------------------------------------------

const GESTURE = "function generation";
const HOST = "http://ml-box.invalid:11434";

const ARMS = [
  {
    key: "ollama-stream-cut",
    where: "src/core/ollama.ts",
    interpolates: true,
    build: (payload) => `Ollama stream cut: ${payload} (${HOST})`,
    real: "silent for 30000ms before any data",
  },
  {
    key: "anthropic-no-message-stop",
    where: "src/core/anthropicInstruct.ts",
    interpolates: false,
    build: (payload) =>
      `Anthropic: the stream ended before message_stop, so the reply is incomplete${payload ? " " + payload : ""}`,
    real: "",
  },
  {
    key: "cloud-no-body",
    where: "src/core/cloudInstruct.ts",
    interpolates: false,
    build: (payload) => `Cloud: response has no body${payload ? " " + payload : ""}`,
    real: "",
  },
  {
    key: "ollama-no-body",
    where: "src/core/ollama.ts",
    interpolates: false,
    build: (payload) => `Ollama: response has no body${payload ? " " + payload : ""}`,
    real: "",
  },
];

const REFERENCE_ARM = ARMS[0];
const toast = (message) => B.generationFailedToast(new Error(message), GESTURE);
const reference = () => toast(REFERENCE_ARM.build(REFERENCE_ARM.real));

// Contract 5's payloads. The last one carries a DIFFERENT subsystem's marker
// words, so a translator that scans anywhere in the message picks the wrong
// sentence and this row goes red.
const PAYLOADS = [
  { name: "empty", value: "" },
  { name: "100000 characters", value: "z".repeat(100000) },
  { name: "embedded newlines", value: "first detail line\nsecond detail line\nthird detail line" },
  { name: "a different subsystem's marker", value: "generation was empty after postprocess" },
];

const short = (s) => (s.length > 160 ? `${s.slice(0, 160)}... (${s.length} chars)` : s);

// ===========================================================================
// Harness guard. If red, every verdict below is suspect.
// ===========================================================================

test("G1 [harness]: src/vscode/fnGen.ts bundles headless against the stub and exports generationFailedToast", () => {
  if (bundleErr) assert.fail(`bundle failed to build: ${bundleErr.stack || bundleErr.message}`);
  assert.strictEqual(
    typeof B.generationFailedToast,
    "function",
    "generationFailedToast must be exported for this file to drive it",
  );
});

// ===========================================================================
// The table. This row asserts nothing; it PRINTS what the product returns for
// each of the five throws today, so a reader can see which arms are already
// translated and which fall through to the catch-all.
// ===========================================================================

btest("P0 [probe]: print what generationFailedToast returns for each of the five throws", () => {
  const ref = reference();
  const rows = ARMS.map((a) => {
    const thrown = a.build(a.real);
    const got = toast(thrown);
    return { arm: a.key, thrown: short(thrown), toast: got, equalsReference: got === ref };
  });
  console.error("\n=== P0 table: generationFailedToast(new Error(<throw>), %j) ===", GESTURE);
  for (const r of rows) {
    console.error("arm    : %s", r.arm);
    console.error("throw  : %s", r.thrown);
    console.error("toast  : %j", r.toast);
    console.error("== ref : %s", r.equalsReference);
    console.error("---");
  }
  console.error("catch-all control (unrelated error): %j", toast("something completely different happened"));
  console.error("=== end P0 table ===\n");
});

// ===========================================================================
// Contract 1 + 3: every arm produces the Ollama arm's own sentence. The
// reference is read out of the product; it is never written down here.
// ===========================================================================

btest("C3 [shape]: the reference sentence is non-empty and ONE line", () => {
  const ref = reference();
  assert.ok(
    typeof ref === "string" && ref.trim() !== "",
    `contract 3: the Ollama arm's crafted sentence must exist. Got: ${JSON.stringify(ref)}`,
  );
  assert.ok(
    !ref.includes("\n"),
    `contract 3 + 4: a notification is ONE line. Got: ${JSON.stringify(ref)}`,
  );
  assert.ok(
    ref.length > 20,
    `contract 3: "it names what happened and what to do next" - an empty or near-empty string cannot, ` +
      `and would let contract 1 pass by making every arm equally blank. Got: ${JSON.stringify(ref)}`,
  );
});

for (const arm of ARMS.slice(1)) {
  btest(`C1 [${arm.key}]: this throw produces the SAME sentence as the Ollama stream cut`, () => {
    const ref = reference();
    const thrown = arm.build(arm.real);
    const got = toast(thrown);
    assert.strictEqual(
      got,
      ref,
      `contract 1: "however it was worded by whichever transport threw it, produces the SAME ` +
        `notification text."\n` +
        `  arm      : ${arm.key} (${arm.where})\n` +
        `  thrown   : ${JSON.stringify(short(thrown))}\n` +
        `  got      : ${JSON.stringify(got)}\n` +
        `  reference: ${JSON.stringify(ref)}`,
    );
  });
}

// ===========================================================================
// Contract 2: no API vocabulary on screen, on any arm.
// ===========================================================================

// RE-CUT by session-v57 phase 4, per the amendment at the end of the goal.
// `stream error` left this list because the throw that carried it is no longer
// translated at all: it is Anthropic's GENERIC in-stream error envelope, not a
// stream cut, and the phase's review measured a rate limit and an invalid API
// key both being told to check a healthy server. The phrase was removed AT THE
// THROW instead, so nothing renders it; the row below pins that.
const BANNED = ["message_stop", "no body", "Error:"];

btest("C2 [vocabulary]: no arm's notification carries message_stop, no body, stream error, or Error:", () => {
  for (const arm of ARMS) {
    const got = toast(arm.build(arm.real));
    for (const banned of BANNED) {
      assert.ok(
        !got.includes(banned),
        `contract 2: "No API vocabulary reaches the screen." The ${arm.key} arm's notification ` +
          `contains ${JSON.stringify(banned)}. Got: ${JSON.stringify(got)}`,
      );
    }
  }
});

// ===========================================================================
// RE-CUT, session-v57 phase 4. The Anthropic in-stream error frame WAS the
// fifth arm of contract 1. The amendment at the end of the goal
// removes it, with the measurement that removed it. Its rows are replaced by
// these two, which pin the opposite and are the stronger pair: the frame keeps
// the provider's own cause, and it still puts no API vocabulary on the screen.
// ===========================================================================

const ANTHROPIC_FRAME = (cause) => `Anthropic reported an error mid-reply: ${cause}`;

btest("RE-CUT [anthropic error frame]: a generic provider error is NOT called a silent server", () => {
  for (const cause of [
    "Number of request tokens has exceeded your per-minute rate limit",
    "invalid x-api-key",
    "max_tokens: 200000 > 8192",
    "overloaded_error",
  ]) {
    const got = toast(ANTHROPIC_FRAME(cause));
    assert.notStrictEqual(
      got,
      reference(),
      `a ${JSON.stringify(cause)} is not a silent server. Telling this user to check the server ` +
        "is the wrong remedy, and it takes the real reason off the screen.",
    );
    assert.ok(got.includes(cause), `the provider's own cause is the actionable half: ${got}`);
  }
});

btest("RE-CUT [anthropic error frame]: it carries no API vocabulary either", () => {
  const got = toast(ANTHROPIC_FRAME("invalid x-api-key"));
  for (const banned of ["stream error", "SSE", "message_stop", "Error:"]) {
    assert.ok(!got.includes(banned), `${JSON.stringify(banned)} reached the screen: ${got}`);
  }
  assert.ok(!got.includes("\n"), "one line");
});

// ===========================================================================
// Contract 4: an unrelated error is untouched by this phase - it keeps the
// catch-all, which is one line and points at the output channel.
// ===========================================================================

btest("C4 [unrelated]: an unrelated error still gets the one-line catch-all, not the stream-cut sentence", () => {
  const got = toast("something completely different happened");
  assert.ok(
    !got.includes("\n"),
    `contract 4: "one line, plus a pointer to the output channel." Got: ${JSON.stringify(got)}`,
  );
  assert.ok(
    /output|channel/i.test(got),
    `contract 4: the catch-all must point the user at the output channel. Got: ${JSON.stringify(got)}`,
  );
  assert.notStrictEqual(
    got,
    reference(),
    `contract 4: "Unrelated errors are unaffected." An error with none of the markers must NOT be ` +
      `swept into the silent-server sentence. Got: ${JSON.stringify(got)}`,
  );
});

// ===========================================================================
// Contract 5: the marker sits BEFORE the interpolation, so nothing the server
// says can break the match. Four payloads per arm.
// ===========================================================================

for (const arm of ARMS) {
  btest(`C5 [${arm.key}]: the match survives any server-supplied payload`, () => {
    const ref = reference();
    for (const p of PAYLOADS) {
      const thrown = arm.build(p.value);
      const got = toast(thrown);
      assert.strictEqual(
        got,
        ref,
        `contract 5: "The marker the translator matches on must sit BEFORE the interpolation."\n` +
          `  arm      : ${arm.key} (${arm.where})\n` +
          `  payload  : ${p.name}${arm.interpolates ? "" : " (APPENDED - this throw has no interpolation point; see the header binding)"}\n` +
          `  thrown   : ${JSON.stringify(short(thrown))}\n` +
          `  got      : ${JSON.stringify(short(got))}\n` +
          `  reference: ${JSON.stringify(ref)}`,
      );
    }
  });
}
