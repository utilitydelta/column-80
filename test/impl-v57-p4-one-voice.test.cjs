// Implementer oracle, session-v57 phase 4 (roadmap item 66): gaps the blind
// file leaves open.
//
// The blind file proves the outcome: five throws, one sentence, no API
// vocabulary on the screen, and the match surviving any payload a server picks.
// What it cannot see, because it was written against the contract alone:
//   * THE COUPLING, which is contract clause 6 and is explicitly the
//     implementer's. Session-v56's review reworded all seven throw sites in
//     plausible ways and the coupling row went red on every one, which is how
//     that mechanism is known to be test-enforced rather than comment-enforced.
//     The five transport throws this phase adds get the same treatment: each
//     marker is pinned at its throw site, in the file that throws it.
//   * EVERY MARKER IS A HEAD. The anchored row matches with startsWith, so a
//     marker that is not at index 0 of its throw is dead on arrival and nothing
//     would say so: the row would just quietly fall through to the catch-all.
//     Each marker is checked against the source it claims to come from.
//   * THE ORDER, which is behaviour and not an optimisation. An anchored row is
//     tried before any unanchored one, because "begins with" is a stronger
//     claim than "contains" and the weaker one is satisfiable by text a server
//     chose. Reversing the passes is what the row catches.
//   * THE SERVICE ROWS ARE UNCHANGED. This phase re-shaped the table that six
//     existing rows live in. Every one of them still produces the sentence it
//     produced before, and the two that share a sentence still share it.
//   * OVER-MATCHING. `startsWith` on a prefix like "Ollama: response has no
//     body" must not swallow a DIFFERENT failure that happens to begin the same
//     way. The pull path's "Ollama: pull response has no body" is exactly that
//     case, and it must NOT be translated: it never reaches this table.
//
// Run: node --test test/impl-v57-p4-one-voice.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const fs = require("node:fs");
const esbuild = require("esbuild");

const SRC = path.join(__dirname, "..", "src");
const read = (...p) => fs.readFileSync(path.join(SRC, ...p), "utf8");

// fnGen.ts needs a `vscode` to resolve against while it loads. The stub is the
// v56 phase-4 oracle's, reused verbatim through the phase-4 blind file: fnGen
// subclasses and destructures several vscode shapes at import time, so a
// trimmed stub does not load. This file only calls two pure string functions
// once it has.
const STUB = path.join(__dirname, ".impl-v57-p4-stub.cjs");
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

const ENTRY = path.join(__dirname, ".impl-v57-p4.entry.ts");
const OUT = path.join(__dirname, ".impl-v57-p4.bundle.cjs");
fs.writeFileSync(ENTRY, `export { translateServiceReject, generationFailedToast } from "../src/vscode/fnGen";\n`);
esbuild.buildSync({
  entryPoints: [ENTRY],
  bundle: true,
  outfile: OUT,
  format: "cjs",
  platform: "node",
  alias: { vscode: STUB },
});
const { translateServiceReject, generationFailedToast } = require(OUT);
test.after(() => {
  for (const f of [STUB, ENTRY, OUT]) fs.rmSync(f, { force: true });
});

// ---------------------------------------------------------------------------
// THE COUPLING. Each marker, pinned in the file that throws it.
// ---------------------------------------------------------------------------

// `throwTemplate` is the source text the transport must keep. `marker` is what
// the table matches, and it must be the HEAD of the message the template builds.
const TRANSPORT_THROWS = [
  {
    arm: "ollama stream cut",
    file: ["core", "ollama.ts"],
    throwTemplate: "`Ollama stream cut: ${cutBy} (${apiBase})`",
    marker: "Ollama stream cut:",
    sample: "Ollama stream cut: silent for 30000ms before any data (http://h:11434)",
  },
  {
    arm: "ollama no body",
    file: ["core", "ollama.ts"],
    throwTemplate: '"Ollama: response has no body"',
    marker: "Ollama: response has no body",
    sample: "Ollama: response has no body",
  },
  {
    arm: "anthropic no message_stop",
    file: ["core", "anthropicInstruct.ts"],
    throwTemplate: '"Anthropic: the stream ended before message_stop, so the reply is incomplete"',
    marker: "Anthropic: the stream ended before message_stop",
    sample: "Anthropic: the stream ended before message_stop, so the reply is incomplete",
  },
  {
    arm: "anthropic no body",
    file: ["core", "anthropicInstruct.ts"],
    throwTemplate: '"Anthropic: response has no body"',
    marker: "Anthropic: response has no body",
    sample: "Anthropic: response has no body",
  },
  {
    arm: "cloud no body",
    file: ["core", "cloudInstruct.ts"],
    throwTemplate: '"Cloud: response has no body"',
    marker: "Cloud: response has no body",
    sample: "Cloud: response has no body",
  },
];

// The sentence is read out of the product rather than written here, so a
// rewording of it is a one-line diff and not a test edit.
const SILENT_SERVER = translateServiceReject(new Error(TRANSPORT_THROWS[0].sample));

test("the reference sentence exists and names both the cause and the next action", () => {
  assert.ok(typeof SILENT_SERVER === "string" && SILENT_SERVER.length > 20, "no sentence to compare against");
  assert.ok(!SILENT_SERVER.includes("\n"), "one line");
});

for (const row of TRANSPORT_THROWS) {
  test(`marker coupling [${row.arm}]: the transport keeps the throw template the table matches`, () => {
    const src = read(...row.file);
    assert.ok(
      src.includes(row.throwTemplate),
      `COUPLING: ${row.file.join("/")} must keep throwing ${row.throwTemplate}. fnGen.ts ` +
        `SERVICE_REJECT_TOASTS matches this failure on ${JSON.stringify(row.marker)}, and moving the ` +
        "wording without the table demotes the toast to the catch-all, which is the API vocabulary " +
        "roadmap item 66 exists to keep off the screen.",
    );
    assert.strictEqual(translateServiceReject(new Error(row.sample)), SILENT_SERVER);
  });

  test(`marker is a HEAD [${row.arm}]: the head of the real message translates, a shifted one does not`, () => {
    // The point of anchoring is that the marker is matched at index 0 and
    // nowhere else. Asserting that this file's own literals agree with each
    // other proves nothing, so both halves are driven through the product: the
    // real message translates, and the same message with one character in front
    // of it does not.
    assert.strictEqual(translateServiceReject(new Error(row.sample)), SILENT_SERVER);
    assert.strictEqual(
      translateServiceReject(new Error(` ${row.sample}`)),
      undefined,
      "anchored means anchored: a marker one character off the head is not this failure",
    );
    // And the throw template itself must open with the marker, or the row is
    // dead on arrival in the product while this file's sample keeps it green.
    const head = row.throwTemplate.replace(/^[`"]/, "");
    assert.ok(
      head.startsWith(row.marker),
      `the throw template must open with the marker, got ${JSON.stringify(head.slice(0, 60))}`,
    );
  });
}

// ---------------------------------------------------------------------------
// THE ORDER, AND THE PAYLOAD GUARD. Anchoring alone does not close the forgery.
// ---------------------------------------------------------------------------

test("an anchored row beats an unanchored one, whatever the server put in the payload", () => {
  const forged = new Error(
    "Ollama stream cut: generation was empty after postprocess and generation truncated at num_predict (http://h:1)",
  );
  assert.strictEqual(
    translateServiceReject(forged),
    SILENT_SERVER,
    "the transport row must win: it matched at index 0, the service rows matched only somewhere inside " +
      "text the server chose.",
  );
});

// Every message here OPENS with a transport head and carries a service reject's
// exact words in the part the server supplied. None of them is that reject.
// These are the reachable forgeries: each of these throws really does
// interpolate server text, and none of them carries a crafted sentence, so
// anchoring alone leaves every one of them falling through to the substring
// rows. This is what PAYLOAD_CARRIERS closes.
const FORGERIES = [
  ["ollama in-200 error field", "Ollama error: generation was empty after postprocess"],
  ["ollama in-200, second marker", "Ollama error: generation truncated at num_predict, please retry"],
  ["ollama http status", 'Ollama 503 Service Unavailable: {"error":"generation was empty after postprocess"}'],
  ["anthropic http status", 'Anthropic 529 Overloaded: {"error":"generation contains a code-fence line"}'],
  ["cloud http status", 'Cloud 429 Too Many Requests: {"error":"generation was empty after postprocess"}'],
  [
    "anthropic error frame",
    "Anthropic reported an error mid-reply: generation does not contain the requested function",
  ],
];

for (const [name, thrown] of FORGERIES) {
  test(`payload guard [${name}]: a service marker inside server text is the SERVER talking`, () => {
    assert.strictEqual(
      translateServiceReject(new Error(thrown)),
      undefined,
      "a message that opens with a transport head is a payload carrier. A service reject's words " +
        "found inside it were put there by the server, and answering them with that reject's " +
        "sentence tells the user a cause that did not happen.",
    );
    const toastText = generationFailedToast(new Error(thrown), "function generation");
    assert.ok(toastText.includes("function generation failed"), "it falls to the catch-all");
    assert.ok(!toastText.includes("\n"), "one line");
  });
}

test("the payload guard does not swallow a real service reject", () => {
  // The guard keys on the HEAD. A service reject does not have a transport head,
  // so every one of them must still translate. The six rows below the FORGERIES
  // block cover the wordings; this row covers the mechanism.
  assert.notStrictEqual(translateServiceReject(new Error("generation was empty after postprocess")), undefined);
  assert.notStrictEqual(
    translateServiceReject(new Error("[fngen] generation was empty after postprocess")),
    undefined,
    "a product-internal prefix is not a transport head",
  );
});

// ---------------------------------------------------------------------------
// NO API VOCABULARY, and the catch-all still works.
// ---------------------------------------------------------------------------

test("none of the five transport failures puts API vocabulary on the screen", () => {
  for (const row of TRANSPORT_THROWS) {
    const toast = generationFailedToast(new Error(row.sample), "function generation");
    for (const jargon of ["message_stop", "no body", "stream error", "Error:", "SSE", "HTTP"]) {
      assert.ok(
        !toast.includes(jargon),
        `[${row.arm}] the toast must not carry ${JSON.stringify(jargon)}: ${toast}`,
      );
    }
  }
});

test("an unrelated failure still gets the catch-all, one line plus the channel", () => {
  const toast = generationFailedToast(new Error("the disk went away"), "function generation");
  assert.notStrictEqual(toast, SILENT_SERVER);
  assert.ok(!toast.includes("\n"));
  assert.ok(/output channel/i.test(toast));
});

// ---------------------------------------------------------------------------
// OVER-MATCHING. A prefix must not swallow a different failure.
// ---------------------------------------------------------------------------

test("the pull path's own no-body failure is NOT translated by the generate path's marker", () => {
  // "Ollama: pull response has no body" begins with "Ollama: " and contains
  // "response has no body", so an unanchored marker would swallow it. It must
  // not be swallowed: the pull path never reaches this table, it renders its own
  // sentence through firstRun, and translating it here would be a sentence
  // nobody asked for arriving on a surface that did not call this function.
  assert.strictEqual(translateServiceReject(new Error("Ollama: pull response has no body")), undefined);
  assert.ok(read("core", "ollama.ts").includes('"Ollama: pull response has no body"'));
});

test("a marker matched mid-message on an anchored row does NOT fire", () => {
  assert.strictEqual(
    translateServiceReject(new Error("wrapped: Cloud: response has no body")),
    undefined,
    "anchored means anchored. A message that merely CONTAINS a transport marker is not that failure.",
  );
});

test("the Anthropic in-stream error frame keeps the provider's cause and gets no crafted sentence", () => {
  // RE-CUT, on a measurement taken during the session. This frame is
  // Anthropic's GENERIC error envelope: a rate limit,
  // an invalid key and a malformed request all arrive through it. Item 66 listed
  // it as a stream cut, and translating it told a rate-limited user to check a
  // server that is fine, with the real reason taken off the screen.
  for (const cause of ["invalid x-api-key", "Number of request tokens has exceeded your per-minute rate limit"]) {
    const thrown = `Anthropic reported an error mid-reply: ${cause}`;
    assert.strictEqual(translateServiceReject(new Error(thrown)), undefined);
    const toastText = generationFailedToast(new Error(thrown), "function generation");
    assert.ok(toastText.includes(cause), `the actionable half survives: ${toastText}`);
    for (const jargon of ["stream error", "SSE", "Error:"]) {
      assert.ok(!toastText.includes(jargon), `${jargon} reached the screen: ${toastText}`);
    }
  }
  assert.ok(
    read("core", "anthropicInstruct.ts").includes("`Anthropic reported an error mid-reply: ${boundBody("),
    "COUPLING: the throw must keep the plain wording. Putting `stream error` back puts API " +
      "vocabulary on the screen, and the phrase is banned by the phase's blind file.",
  );
});

// ---------------------------------------------------------------------------
// THE SIX SERVICE ROWS ARE UNCHANGED by the reshaping of the table.
// ---------------------------------------------------------------------------

const SERVICE_SAMPLES = [
  ["generation truncated at num_predict (128 tokens)", "cut off mid-function"],
  ["generation does not contain a test module (rust)", "no usable tests"],
  ["generation does not contain rust test functions (no fenced block either)", "no usable tests"],
  ["generation contains a code-fence line", "markdown"],
  ["generation does not contain the requested function `walk`", "something other than the requested function"],
  ["generation was empty after postprocess", "no usable code"],
];

for (const [thrown, phrase] of SERVICE_SAMPLES) {
  test(`service row unchanged: ${JSON.stringify(thrown.slice(0, 44))}`, () => {
    const got = translateServiceReject(new Error(thrown));
    assert.ok(got !== undefined, "the service reject must still translate");
    assert.ok(got.includes(phrase), `expected ${JSON.stringify(phrase)} in ${JSON.stringify(got)}`);
    assert.notStrictEqual(got, SILENT_SERVER, "and must not have been captured by the transport row");
  });
}

test("the two test-refusal wordings still share one sentence", () => {
  assert.strictEqual(
    translateServiceReject(new Error("generation does not contain a test module (rust)")),
    translateServiceReject(new Error("generation does not contain go test functions (no fenced block either)")),
  );
});
