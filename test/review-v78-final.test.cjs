// Final adversarial review, session-v78 (phase 6). Each red row is a finding.
// Unit level only: no row dials a server or a model. Rows 1 and 3 drive
// registerFnGen / runFirstRunFlow behind a stub vscode (harness copied from
// review-v78-p4b, renamed so the two files never share scratch paths).
//
// Run: SKIP_LIVE=1 node --test test/review-v78-final.test.cjs

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

const FG_WROOT = path.join(__dirname, ".review-v78-final-workspace");
fs.mkdirSync(path.join(FG_WROOT, "src"), { recursive: true });
fs.writeFileSync(
  path.join(FG_WROOT, "package.json"),
  '{"name":"w","version":"0.0.0","scripts":{"test":"vitest run"},"devDependencies":{"vitest":"^1.0.0"}}\n',
);

const FG_STUB = path.join(__dirname, ".review-v78-final-fngen-stub.cjs");
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
    showInformationMessage: async (message, ...actions) => { state.messages.push({ kind: "info", message, actions }); return (state.infoResponses || []).shift(); },
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

const FG_ENTRY = path.join(__dirname, ".review-v78-final-fngen.entry.ts");
const FG_OUT = path.join(__dirname, ".review-v78-final-fngen.bundle.cjs");
fs.writeFileSync(
  FG_ENTRY,
  `export { registerFnGen, buildFnGenService } from "../src/vscode/fnGen";
export { ContextBlockStore } from "../src/core/contextBlocks";
export { runFirstRunFlow } from "../src/vscode/firstRun";
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

const { bundleCore } = require("./.blind-util.cjs");
const core = bundleCore(
  "review-v78-final-core",
  [`export { keepSketch } from "../src/core/scaffoldKeep";`, ""].join("\n"),
);
test.after(() => core.cleanup());
const { keepSketch } = core.mod;

// 1. Deactivation while a background catalogue retry is in flight. stopRecheck
// clears only a PENDING timer; the retry already running finishes after
// deactivate, installs a service nobody disposes, and (server still down)
// arms the next retry, which keeps probing and reading the catalogue for up
// to ~110s after the extension was deactivated.
test("deactivate during an in-flight catalogue retry: no later reads, every built service disposed", async (t) => {
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
    if (listed === 2) return blocked; // first retry: in flight at deactivate
    return undefined;
  });
  await until(() => w.builds.length === 1, "activation build");
  for (let ms = 0; ms < RETRY_WINDOW_MS && listed < 2; ms += 1000) await advance(1000);
  assert.strictEqual(listed, 2, "the retry never started (the case never fired)");
  w.close(); // extension deactivated
  release(undefined); // the in-flight retry's read comes back: still down
  await until(() => w.builds.length === 2, "in-flight retry build");
  await advance(RETRY_WINDOW_MS);
  assert.strictEqual(listed, 2, `catalogue read ${listed - 2} more time(s) after deactivate`);
  const live = w.builds.filter((b) => !b.disposed);
  assert.strictEqual(live.length, 0, "a service built after deactivate was never disposed");
});

// 2. slotIndents takes the first sketch unit's indent. A sketch comment on the
// opener line (`fn f() { // step one`) has as its "indent" the whitespace after
// the `{`, so the slot and the moved code land at one space.
test("a sketch comment on the opener line does not set the slot indent to the gap after `{`", () => {
  const r = keepSketch({
    languageId: "rust",
    originalSpan: "fn f() { // step one\n}",
    reply: "fn f() { a() }",
    bodyIndent: "",
  });
  assert.deepStrictEqual(r.placedByTool, ["step one"]);
  assert.strictEqual(r.text, "fn f() {\n    // step one\n    a()\n}", JSON.stringify(r.text));
});

// 3. Non-Mac users must see the pre-v78 behaviour. A landed fn-gen pull on a
// CUDA box now calls fnGenModelChanged, i.e. a second full tier rebuild (probe
// spawn plus a repeated [carve] block on the channel) that changes nothing:
// the CUDA selection never depended on what is installed.
test("CUDA 24GB first run: a landed fn-gen pull does not trigger a tier rebuild", async () => {
  const FG = require(FG_OUT);
  FG.fgState.config = {};
  FG.fgState.configInfo = {};
  FG.fgState.quickPickImpl = (items) => items[0]; // use detected tier
  FG.fgState.infoResponses = ["Download", "Download"];
  const cuda24 = {
    platformInfo: () => ({ platform: "linux", arch: "x64" }),
    totalMemBytes: () => 64 * GB,
    runCommand: async (cmd) =>
      /nvidia-smi/.test(String(cmd)) ? { exitCode: 0, stdout: "24576\n" } : { exitCode: 1, stdout: "" },
  };
  let changed = 0;
  const pulled = [];
  const out = channel();
  await FG.runFirstRunFlow({ globalState: { get: () => undefined, update: async () => {} } }, out, {
    probe: cuda24,
    listModels: async () => [FIM],
    pull: async (_base, model) => {
      pulled.push(model);
    },
    fnGenModelChanged: () => {
      changed += 1;
    },
  });
  FG.fgState.infoResponses = [];
  FG.fgState.quickPickImpl = undefined;
  assert.ok(pulled.includes(GGUF), `the case never fired: pulled ${JSON.stringify(pulled)}\n${out.lines.join("\n")}`);
  assert.strictEqual(changed, 0, "a CUDA box rebuilt its tier after the pull");
});

// 4. The speed claim says two different things to the same user. CHANGELOG:
// "about twice as fast"; user manual: "about three times faster". measurement-p5
// says the size of the gain is not established (MLX decode fell from ~50 to
// ~20 tok/s during the run), so at most one factor, or none, should ship.
test("CHANGELOG and user manual do not give the MLX speed-up two different factors", () => {
  const root = path.join(__dirname, "..");
  const changelog = fs.readFileSync(path.join(root, "CHANGELOG.md"), "utf8");
  // The newest section, whatever its heading: "## Unreleased" during the build, "## 3.9.0" after release.
  const top = changelog.indexOf("\n## ");
  const unreleased = changelog.slice(top, changelog.indexOf("\n## ", top + 1));
  const manual = fs.readFileSync(path.join(root, "docs/user-manual.md"), "utf8");
  const apple = manual.slice(manual.indexOf("**Apple Silicon.**"), manual.indexOf("\n\n", manual.indexOf("**Apple Silicon.**")));
  const factor = (s) => (/about (twice|two times|three times)/.exec(s) || [])[1];
  const a = factor(unreleased);
  const b = factor(apple);
  assert.ok(a !== undefined || b !== undefined, "neither states a factor (the case never fired)");
  assert.strictEqual(a, b, `CHANGELOG says "about ${a}", user manual says "about ${b}"`);
});
