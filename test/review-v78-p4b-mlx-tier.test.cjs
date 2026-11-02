// Adversarial review, session-v78 phase 4 loop 2: the catalogue re-check
// (re-expressed after triage-p4b to the background-retry shape). Each red row is a finding. No row dials a server: every lister is
// injected and answers from memory.
//
// Run: node --test test/review-v78-p4b-mlx-tier.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const fs = require("node:fs");
const esbuild = require("esbuild");

const MLX = "qwen3.8:27b-mlx";
const GGUF = "qwen3.8:27b";
const FIM = "qwen2.5-coder:1.5b-base";
const GB = 1024 * 1024 * 1024;
const macProbe = (gb) => ({
  platformInfo: () => ({ platform: "darwin", arch: "arm64" }),
  totalMemBytes: () => gb * GB,
  runCommand: async () => ({ exitCode: 1, stdout: "" }),
});
const channel = () => {
  const lines = [];
  return { lines, appendLine: (l) => lines.push(l) };
};

const FG_WROOT = path.join(__dirname, ".review-v78-p4b-workspace");
fs.mkdirSync(path.join(FG_WROOT, "src"), { recursive: true });
fs.writeFileSync(
  path.join(FG_WROOT, "package.json"),
  '{"name":"w","version":"0.0.0","scripts":{"test":"vitest run"},"devDependencies":{"vitest":"^1.0.0"}}\n',
);

const FG_STUB = path.join(__dirname, ".review-v78-p4b-fngen-stub.cjs");
fs.writeFileSync(
  FG_STUB,
  `
const WROOT = ${JSON.stringify(FG_WROOT)};
const state = {
  config: {}, messages: [], commands: {}, activeTextEditor: undefined,
  snippetInserts: [], appliedEdits: [], executeCalls: [], terminals: [],
  textDocuments: [], warnResponses: [],
  symbols: undefined, symbolsSet: false,
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
      has: () => false, inspect: (key) => (state.configInfo || {})[key], update: async () => {},
    }),
    onDidChangeConfiguration: (fn) => { (state.configHandlers = state.configHandlers || []).push(fn); return { dispose() {} }; },
    onDidChangeTextDocument: () => ({ dispose() {} }),
    onDidCloseTextDocument: () => ({ dispose() {} }),
    registerTextDocumentContentProvider: () => ({ dispose() {} }),
    get textDocuments() { return state.textDocuments; },
    get workspaceFolders() { return [{ uri: Uri.file(WROOT), name: "w", index: 0 }]; },
    getWorkspaceFolder: () => ({ uri: Uri.file(WROOT), name: "w", index: 0 }),
    openTextDocument: async () => state.activeTextEditor && state.activeTextEditor.document,
    applyEdit: async (edit) => { state.appliedEdits.push(edit); return true; },
    fs: { stat: async () => { throw new Error("ENOENT"); } },
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
    showInformationMessage: async (message, ...actions) => { state.messages.push({ kind: "info", message, actions }); return undefined; },
    showWarningMessage: async (message, ...actions) => { state.messages.push({ kind: "warn", message, actions }); return (state.warnResponses || []).shift(); },
    showErrorMessage: async (message, ...actions) => { state.messages.push({ kind: "error", message, actions }); return undefined; },
    showQuickPick: async (items, opts) => (state.quickPickImpl ? state.quickPickImpl(items, opts) : undefined),
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
    tabGroups: { all: [], onDidChangeTabs: () => ({ dispose() {} }), close: async () => {} },
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

const FG_ENTRY = path.join(__dirname, ".review-v78-p4b-fngen.entry.ts");
const FG_OUT = path.join(__dirname, ".review-v78-p4b-fngen.bundle.cjs");
fs.writeFileSync(
  FG_ENTRY,
  `export { registerFnGen, buildFnGenService } from "../src/vscode/fnGen";
export { ContextBlockStore } from "../src/core/contextBlocks";
export { __state as fgState } from "vscode";\n`,
);
esbuild.buildSync({ entryPoints: [FG_ENTRY], bundle: true, outfile: FG_OUT, format: "cjs", platform: "node", alias: { vscode: FG_STUB }, logLevel: "silent" });
test.after(() => {
  for (const f of [FG_ENTRY, FG_OUT, FG_STUB]) fs.rmSync(f, { force: true });
  fs.rmSync(FG_WROOT, { recursive: true, force: true });
});

const tick = () => new Promise((r) => setImmediate(r));
async function until(cond, what) {
  for (let i = 0; i < 400; i += 1) {
    if (cond()) return;
    await tick();
  }
  throw new Error(`timed out waiting for ${what}`);
}

function world(listModels) {
  const FG = require(FG_OUT);
  FG.fgState.config = {};
  FG.fgState.configInfo = {};
  FG.fgState.configHandlers = [];
  FG.fgState.activeTextEditor = undefined;
  FG.fgState.symbols = undefined;
  const builds = [];
  const out = channel();
  const context = { subscriptions: [], globalStorageUri: { fsPath: path.join(FG_WROOT, "storage") } };
  const wiring = FG.registerFnGen(context, out, new FG.ContextBlockStore(() => {}), {
    buildService: async (o, log) => {
      const b = await FG.buildFnGenService(o, log, macProbe(36), { listModels });
      // Record disposal: the session's live service is the one built last that
      // no later rebuild disposed.
      const inner = b.service.dispose.bind(b.service);
      b.disposed = false;
      b.service.dispose = () => {
        b.disposed = true;
        inner();
      };
      builds.push(b);
      return b;
    },
  });
  const close = () => {
    for (const s of context.subscriptions) s.dispose?.();
  };
  return { FG, builds, out, wiring, context, close };
}

const { mock } = test;
const RETRY_WINDOW_MS = 180_000; // past the triage's "about two minutes"
async function flush() {
  for (let i = 0; i < 20; i += 1) await tick();
}
async function advance(ms, step = 1000) {
  for (let t = 0; t < ms; t += step) {
    mock.timers.tick(step);
    await flush();
  }
}

// 1. A settings change that lands while the re-check is reading the catalogue.
// The re-check captured "no explicit model" before its read, finishes LAST, and
// replaces the service the settings rebuild made for the user's explicit model.
test("an explicit fnGenModel set while the re-check is in flight is the model the session runs", async (t) => {
  // Shape-agnostic trigger: a gesture (loop 2 shape) and the passing of time
  // (triage-p4b Do B background retry) both get a chance to start the re-check.
  mock.timers.enable({ apis: ["setTimeout"] });
  t.after(() => mock.timers.reset());
  let listed = 0;
  let release;
  const blocked = new Promise((r) => {
    release = r;
  });
  const w = world(async () => {
    listed += 1;
    if (listed === 1) return undefined; // activation: server not answering
    return blocked; // the re-check: server slow
  });
  try {
    await until(() => w.builds.length === 1, "activation build");
    assert.strictEqual(w.builds[0].recheck, true);
    void w.wiring.tierGate();
    for (let ms = 0; ms < RETRY_WINDOW_MS && listed < 2; ms += 1000) await advance(1000);
    assert.strictEqual(listed, 2, "the re-check never started");
    // The user sets a model by hand; VS Code fires the change.
    w.FG.fgState.config.fnGenModel = "my-model:7b";
    w.FG.fgState.configInfo.fnGenModel = { globalValue: "my-model:7b" };
    for (const h of w.FG.fgState.configHandlers) h({ affectsConfiguration: () => true });
    await until(() => w.builds.length === 2, "settings rebuild");
    assert.strictEqual(w.builds[1].config.model, "my-model:7b");
    release([FIM, GGUF]);
    await until(() => w.builds.length === 3, "re-check rebuild");
    await flush();
    const live = w.builds.filter((b) => !b.disposed);
    assert.strictEqual(live.length, 1, "exactly one build is live");
    assert.strictEqual(
      live[0].config.model,
      "my-model:7b",
      "the re-check, started under the old settings, overwrote the service built for the new one",
    );
  } finally {
    w.close();
  }
});

// Rows 2 and 3 follow triage-p4b Do B: the re-check runs as a bounded
// background retry (about two minutes at most), never on the gesture path.
// Time is driven with node:test mock timers on setTimeout, enabled BEFORE
// registerFnGen so the retry timer is a mock one. setImmediate stays real, so
// `until`/`flush` still drain the async rebuild chain between ticks.
function refusedGenerate(w) {
  const file = path.join(FG_WROOT, "src", "lib.rs");
  const doc = {
    languageId: "rust",
    uri: { fsPath: file, path: file, scheme: "file", toString: () => "file://" + file },
    fileName: file,
    version: 1,
    getText: () => "fn main() {}\n",
    positionAt: () => ({ line: 0, character: 0 }),
    offsetAt: () => 0,
    lineAt: () => ({ text: "fn main() {}" }),
    lineCount: 1,
  };
  w.FG.fgState.activeTextEditor = {
    document: doc,
    selection: { active: { line: 0, character: 0 }, start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
  };
  w.FG.fgState.symbols = undefined; // no provider: the gesture is refused
  w.FG.fgState.messages = [];
  return w.FG.fgState.commands["column80.generateFunction"]();
}

// 2. Item 58: a refused gesture issues no network request, whether a background
// retry is still pending or has already given up.
test("a refused Generate Function Body reads no catalogue, with or without a pending background retry", async (t) => {
  mock.timers.enable({ apis: ["setTimeout"] });
  t.after(() => mock.timers.reset());
  let listed = 0;
  const w = world(async () => {
    listed += 1;
    return undefined; // the server never answers
  });
  try {
    await until(() => w.builds.length >= 1, "activation build");
    const atActivation = listed;
    assert.strictEqual(atActivation, 1);
    // Retry pending (no time has passed since activation).
    await refusedGenerate(w);
    assert.ok(w.FG.fgState.messages.some((m) => m.kind === "warn"), "the gesture was refused with a warning");
    assert.strictEqual(listed, atActivation, "a refused gesture read the catalogue while a retry was pending (item 58)");
    // Retry window over.
    await advance(RETRY_WINDOW_MS);
    const afterWindow = listed;
    await refusedGenerate(w);
    assert.ok(w.FG.fgState.messages.some((m) => m.kind === "warn"), "the gesture was refused with a warning");
    assert.strictEqual(listed, afterWindow, "a refused gesture read the catalogue after the retries ended (item 58)");
  } finally {
    w.close();
  }
});

// 3. Ollama down the whole time: the gesture path never reads the catalogue,
// the background retry gives up with ONE line, and no line promises that "the
// first generation checks again".
test("server staying down: gestures read nothing, the give-up line appears once, nothing promises a first-generation check", async (t) => {
  mock.timers.enable({ apis: ["setTimeout"] });
  t.after(() => mock.timers.reset());
  let listed = 0;
  const w = world(async () => {
    listed += 1;
    return undefined;
  });
  try {
    await until(() => w.builds.length >= 1, "activation build");
    assert.strictEqual(listed, 1);
    for (let i = 0; i < 3; i += 1) await w.wiring.tierGate();
    assert.strictEqual(listed, 1, "tierGate read the catalogue on the gesture path");
    await advance(RETRY_WINDOW_MS);
    assert.ok(listed > 1, `no background retry read the catalogue within ${RETRY_WINDOW_MS}ms (the case never fired)`);
    const readsAtGiveUp = listed;
    for (let i = 0; i < 3; i += 1) await w.wiring.tierGate();
    await advance(60_000);
    assert.strictEqual(listed, readsAtGiveUp, "the catalogue was read again after the retry gave up");
    const giveUp = w.out.lines.filter((l) => l.startsWith("[carve] fn-gen model still not checked"));
    assert.strictEqual(giveUp.length, 1, `give-up lines:\n${w.out.lines.join("\n")}`);
    assert.ok(giveUp[0].includes(MLX), giveUp[0]);
    const promise = w.out.lines.filter((l) => /first generation checks again/.test(l));
    assert.deepStrictEqual(promise, [], "a channel line promises a check at the first generation");
  } finally {
    w.close();
  }
});

// Guard for the background shape: a retry that gets an answer settles the tag
// with one "fn-gen uses" line and stops reading.
test("a background retry that gets an answer settles on the GGUF tag once and stops", async (t) => {
  mock.timers.enable({ apis: ["setTimeout"] });
  t.after(() => mock.timers.reset());
  let listed = 0;
  const w = world(async () => {
    listed += 1;
    return listed === 1 ? undefined : [FIM, GGUF];
  });
  try {
    await until(() => w.builds.length >= 1, "activation build");
    await advance(RETRY_WINDOW_MS);
    assert.strictEqual(listed, 2, "one retry read, then no more");
    const live = w.builds.filter((b) => !b.disposed);
    assert.strictEqual(live.length, 1);
    assert.strictEqual(live[0].config.model, GGUF);
    assert.strictEqual(w.out.lines.filter((l) => l.startsWith(`[carve] fn-gen uses ${GGUF}`)).length, 1);
  } finally {
    w.close();
  }
});

// Guards (expected green).
test("guard: an explicit fnGenModel on a Mac never arms the re-check", async () => {
  let listed = 0;
  const FG = require(FG_OUT);
  FG.fgState.config = { fnGenModel: "my-model:7b" };
  FG.fgState.configInfo = { fnGenModel: { globalValue: "my-model:7b" } };
  const b = await FG.buildFnGenService(channel(), () => {}, macProbe(36), {
    listModels: async () => {
      listed += 1;
      return undefined;
    },
  });
  assert.strictEqual(listed, 0);
  assert.strictEqual(b.recheck, undefined);
  assert.strictEqual(b.config.model, "my-model:7b");
});
