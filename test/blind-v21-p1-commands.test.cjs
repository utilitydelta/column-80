// BLIND CONTRACT TEST - v21 phase 1, item 3: the executed command order.
//
// Written from session-v21/surface-p1.md and nothing else. This file does not
// read src/vscode/extension.ts, src/vscode/completionProvider.ts or
// src/core/completionService.ts; esbuild resolves them at bundle time only.
//
// THESE TESTS ARE EXPECTED RED until v21 phase 1 ships. Red before green. The
// surface introduces no new exported symbol, so nothing here should fail to
// BUILD: a build failure is a harness bug, not a contract failure.
//
// Why item 3 needs its own harness: the thing under test is not a return value
// but the SEQUENCE of commands the product asks the editor to execute, and
// both callers are wired at activation. So the whole extension is activated
// against a stub vscode (the blind-v9-gestures pattern) whose
// commands.executeCommand records every id in order, generation is answered by
// an in-process fake ollama, and the two entry points are driven directly: the
// expiry hook exported alongside the provider, and the registered
// `column80.dismissScopedGhost` command.
//
// What each section pins:
//
//   A. THE EXPIRY. hide, then trigger. An explicit
//      `editor.action.inlineSuggest.trigger` sets VS Code's preserve flag
//      unconditionally and the currently shown scoped item is carried into the
//      fetch by identity, so a trigger with nothing hidden first re-renders
//      the ghost the expiry exists to replace. Driven through the wiring
//      activation produced - a passive scope actually served, then the real
//      1500ms window elapsed - because that is the only expiry the editor ever
//      sees. This is the one row in either v21 file that waits on a real
//      clock.
//   B. THE SECOND ESCAPE, scope-dropped branch. It already closes the suggest
//      widget first and that stays; the inline suggestion must be hidden too,
//      before the trigger.
//   C. THE SECOND ESCAPE, no-scope branch. Unchanged: it hides and returns, so
//      the developer gets the Escape they pressed. No trigger.
//   D. A failing command still writes its failure line and does not throw out
//      of the handler.
//
// Ordering is the whole contract. This tier can only pin the command order; a
// live-editor test is the oracle for whether the order actually clears the
// preserve flag, and the surface says so itself.
//
// Run: SKIP_LIVE=1 node --test test/blind-v21-p1-commands.test.cjs
// (Hermetic: a vscode stub and an in-process HTTP server on localhost. No
// model, no GPU, no real VS Code.)

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const http = require("node:http");
const esbuild = require("esbuild");

// ---------------------------------------------------------------------------
// The vscode stub. Everything activation touches is either recorded into
// __state or a safe no-op. commands.executeCommand appends to
// state.executeCalls, which IS the observable this file is about.
// ---------------------------------------------------------------------------


const STUB = path.join(__dirname, ".blind-v21-p1-commands-stub.cjs");
fs.writeFileSync(
  STUB,
  `
const state = {
  config: {}, messages: [], commands: {}, executeCalls: [], commandHandlers: {},
  outputLines: [], inlineProviders: [], contentProviders: {},
  textDocuments: [], visibleTextEditors: [], activeTextEditor: undefined,
  collections: [],
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
  contains(p) {
    const s = this.start, e = this.end;
    const ps = p.start ? p.start : p;
    const pe = p.end ? p.end : p;
    const geS = ps.line > s.line || (ps.line === s.line && ps.character >= s.character);
    const leE = pe.line < e.line || (pe.line === e.line && pe.character <= e.character);
    return geS && leE;
  }
  with(start, end) { return new Range(start || this.start, end || this.end); }
  intersection() { return undefined; }
  union(o) { return o; }
}
class Selection extends Range {
  constructor(a, b, c, d) { super(a, b, c, d); this.anchor = this.start; this.active = this.end; this.isReversed = false; }
}
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
class MarkdownString {
  constructor(value) { this.value = value || ""; this.isTrusted = false; }
  appendCodeblock(t, lang) { this.value += "\\n\`\`\`" + (lang || "") + "\\n" + t + "\\n\`\`\`\\n"; }
  appendMarkdown(t) { this.value += t; }
  appendText(t) { this.value += t; }
}
class Diagnostic { constructor(range, message, severity) { this.range = range; this.message = message; this.severity = severity; } }
class SnippetString { constructor(value) { this.value = value || ""; } appendText(t) { this.value += t; return this; } appendTabstop() { return this; } }
class InlineCompletionItem { constructor(insertText, range, command) { this.insertText = insertText; this.range = range; this.command = command; } }
class InlineCompletionList { constructor(items) { this.items = items; } }
class TreeItem { constructor(label, collapsibleState) { this.label = label; this.collapsibleState = collapsibleState; } }
class Location { constructor(uri, rangeOrPos) { this.uri = uri; this.range = rangeOrPos; } }
class Hover { constructor(contents, range) { this.contents = Array.isArray(contents) ? contents : [contents]; this.range = range; } }
class RelativePattern { constructor(base, pattern) { this.base = base; this.pattern = pattern; } }
class CancellationTokenSource {
  constructor() { this.token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) }; }
  cancel() { this.token.isCancellationRequested = true; }
  dispose() {}
}
const mkUri = (full, fsPath) => ({
  scheme: full.includes("://") ? full.slice(0, full.indexOf("://")) : "file",
  fsPath, path: fsPath, query: "", fragment: "",
  toString: () => full,
  with() { return this; },
  toJSON() { return full; },
});
const Uri = {
  file: (p) => mkUri("file://" + p, p),
  parse: (s) => mkUri(String(s), String(s).replace(/^[a-zA-Z+-]+:\\/\\//, "")),
  joinPath: (base, ...segs) => Uri.file([base.fsPath, ...segs].join("/")),
  from: (c) => {
    const full =
      (c.scheme || "file") + "://" + (c.authority || "") + (c.path || "") +
      (c.query ? "?" + c.query : "") + (c.fragment ? "#" + c.fragment : "");
    const u = mkUri(full, c.path || "");
    u.scheme = c.scheme || "file";
    u.query = c.query || "";
    u.fragment = c.fragment || "";
    return u;
  },
};
const disposable = () => ({ dispose() {} });
module.exports = {
  __state: state,
  version: "1.85.0",
  Position, Range, Selection, WorkspaceEdit, EventEmitter, ThemeColor, MarkdownString,
  Diagnostic, SnippetString, InlineCompletionItem, InlineCompletionList, TreeItem,
  Location, Hover, RelativePattern, CancellationTokenSource, Uri,
  DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
  SymbolKind: { File: 0, Module: 1, Namespace: 2, Package: 3, Class: 4, Method: 5, Property: 6,
    Field: 7, Constructor: 8, Enum: 9, Interface: 10, Function: 11, Variable: 12, Constant: 13,
    String: 14, Number: 15, Boolean: 16, Array: 17, Object: 18, Key: 19, Null: 20, EnumMember: 21,
    Struct: 22, Event: 23, Operator: 24, TypeParameter: 25 },
  CompletionItemKind: { Text: 0, Method: 1, Function: 2, Constructor: 3, Field: 4, Variable: 5,
    Class: 6, Interface: 7, Module: 8, Property: 9, Unit: 10, Value: 11, Enum: 12, Keyword: 13,
    Snippet: 14, Color: 15, File: 16, Reference: 17, Folder: 18, EnumMember: 19, Constant: 20,
    Struct: 21, Event: 22, Operator: 23, TypeParameter: 24 },
  InlineCompletionTriggerKind: { Invoke: 0, Automatic: 1 },
  StatusBarAlignment: { Left: 1, Right: 2 },
  OverviewRulerLane: { Left: 1, Center: 2, Right: 4, Full: 7 },
  ProgressLocation: { SourceControl: 1, Window: 10, Notification: 15 },
  ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  EndOfLine: { LF: 1, CRLF: 2 },
  ViewColumn: { Active: -1, Beside: -2, One: 1, Two: 2 },
  TextEditorRevealType: { Default: 0, InCenter: 1, InCenterIfOutsideViewport: 2, AtTop: 3 },
  CodeActionKind: { QuickFix: { value: "quickfix" }, Refactor: { value: "refactor" } },
  workspace: {
    getConfiguration: (section) => ({
      get: (key, fallback) => {
        if (key in state.config) return state.config[key];
        const full = section ? section + "." + key : key;
        if (full in state.config) return state.config[full];
        return fallback;
      },
      has: (key) => key in state.config,
      inspect: () => undefined,
      update: async () => {},
    }),
    onDidChangeConfiguration: () => disposable(),
    onDidChangeTextDocument: () => disposable(),
    onDidOpenTextDocument: () => disposable(),
    onDidCloseTextDocument: () => disposable(),
    onDidRenameFiles: () => disposable(),
    onDidDeleteFiles: () => disposable(),
    onDidSaveTextDocument: () => disposable(),
    registerTextDocumentContentProvider: (scheme, provider) => {
      state.contentProviders[scheme] = provider;
      return disposable();
    },
    get textDocuments() { return state.textDocuments; },
    openTextDocument: async (arg) => {
      const key = typeof arg === "string" ? arg : arg && arg.toString ? arg.toString() : String(arg);
      const docs = globalThis.__V9_DOCS__ || {};
      if (docs[key]) return docs[key];
      const scheme = key.includes("://") ? key.slice(0, key.indexOf("://")) : "file";
      const provider = state.contentProviders[scheme];
      const text = provider ? await provider.provideTextDocumentContent(typeof arg === "string" ? Uri.parse(arg) : arg) : "";
      const lines = String(text || "").split("\\n");
      return {
        uri: typeof arg === "string" ? Uri.parse(arg) : arg,
        languageId: "plaintext", version: 1, lineCount: lines.length,
        getText: () => text || "",
        lineAt: (n) => { const i = typeof n === "number" ? n : n.line; const t = lines[i] || ""; return { lineNumber: i, text: t, firstNonWhitespaceCharacterIndex: 0, isEmptyOrWhitespace: t.trim() === "", range: new Range(i, 0, i, t.length) }; },
        offsetAt: () => 0, positionAt: () => new Position(0, 0), save: async () => true,
      };
    },
    applyEdit: async () => true,
    get workspaceFolders() { return [{ uri: Uri.file("/proj"), name: "proj", index: 0 }]; },
    asRelativePath: (u) => String(u),
    createFileSystemWatcher: () => ({ onDidChange: () => disposable(), onDidCreate: () => disposable(), onDidDelete: () => disposable(), dispose() {} }),
    fs: { stat: async () => ({ type: 1 }), readFile: async () => new Uint8Array() },
  },
  languages: {
    createDiagnosticCollection: (name) => {
      const c = { name, set() {}, delete() {}, clear() {}, dispose() {} };
      state.collections.push(c);
      return c;
    },
    registerInlineCompletionItemProvider: (selector, provider) => {
      state.inlineProviders.push({ selector, provider });
      return disposable();
    },
    registerCodeActionsProvider: () => disposable(),
    registerCodeLensProvider: () => disposable(),
    registerHoverProvider: () => disposable(),
    getDiagnostics: () => [],
    onDidChangeDiagnostics: () => disposable(),
    setLanguageConfiguration: () => disposable(),
  },
  window: {
    createOutputChannel: (name) => ({
      name,
      appendLine: (l) => state.outputLines.push(l),
      append: (l) => state.outputLines.push(l),
      replace() {}, show() {}, hide() {}, clear() {}, dispose() {},
    }),
    createStatusBarItem: () => ({ text: "", tooltip: "", command: undefined, backgroundColor: undefined, show() {}, hide() {}, dispose() {} }),
    createTextEditorDecorationType: (opts) => ({ opts, dispose() {} }),
    get visibleTextEditors() { return state.visibleTextEditors; },
    get activeTextEditor() { return state.activeTextEditor; },
    onDidChangeActiveTextEditor: () => disposable(),
    onDidChangeTextEditorSelection: () => disposable(),
    onDidChangeVisibleTextEditors: () => disposable(),
    showInformationMessage: async (message, ...actions) => { state.messages.push({ kind: "info", message, actions }); return undefined; },
    showWarningMessage: async (message, ...actions) => { state.messages.push({ kind: "warn", message, actions }); return undefined; },
    showErrorMessage: async (message, ...actions) => { state.messages.push({ kind: "error", message, actions }); return undefined; },
    showQuickPick: async () => undefined,
    withProgress: async (opts, task) => task({ report: () => {} }, { isCancellationRequested: false, onCancellationRequested: () => disposable() }),
    setStatusBarMessage: () => disposable(),
    showTextDocument: async (docOrUri) => {
      const document = docOrUri && typeof docOrUri.getText === "function" ? docOrUri : { uri: docOrUri, getText: () => "", languageId: "plaintext", version: 1 };
      return { document, selection: new Selection(new Position(0, 0), new Position(0, 0)), options: {}, viewColumn: 1, edit: async () => true, insertSnippet: async () => true, setDecorations() {}, revealRange() {} };
    },
    tabGroups: { all: [], onDidChangeTabs: () => disposable(), close: async () => {} },
    createTreeView: () => ({ dispose() {}, onDidChangeSelection: () => disposable(), onDidChangeVisibility: () => disposable(), reveal: async () => {} }),
    registerTreeDataProvider: () => disposable(),
    registerWebviewViewProvider: () => disposable(),
    activeColorTheme: { kind: 1 },
  },
  commands: {
    registerCommand: (id, fn) => { state.commands[id] = fn; return disposable(); },
    executeCommand: async (id, ...args) => {
      state.executeCalls.push({ id, args });
      const h = state.commandHandlers[id];
      if (h) return h(...args);
      if (state.commands[id]) return state.commands[id](...args);
      return undefined;
    },
    getCommands: async () => Object.keys(state.commands),
  },
  env: { appName: "stub", machineId: "stub", clipboard: { writeText: async () => {} }, openExternal: async () => true },
  extensions: { getExtension: () => undefined, all: [] },
};
`
);

// ---------------------------------------------------------------------------
// Bundle the extension's public entry (package.json "main" builds from
// src/vscode/extension.ts) with the stub aliased in. The provider module rides
// along as a NAMESPACE so a symbol that does not exist is reported as a
// sentence rather than killing the bundle.
// ---------------------------------------------------------------------------

const entry = path.join(__dirname, ".blind-v21-p1-commands.entry.ts");
const outfile = path.join(__dirname, ".blind-v21-p1-commands.bundle.cjs");
let mod = {};
let bundleError;
try {
  fs.writeFileSync(
    entry,
    `export { activate } from "../src/vscode/extension";
export * as providerModule from "../src/vscode/completionProvider";
export { __state, Position, Range, Selection, Uri } from "vscode";\n`
  );
  esbuild.buildSync({ entryPoints: [entry], bundle: true, outfile, format: "cjs", platform: "node", alias: { vscode: STUB } });
  mod = require(outfile);
} catch (e) {
  bundleError = e;
}
if (!bundleError && typeof mod.activate !== "function") {
  bundleError = new Error("the bundle built but exports no activate function");
}
const { activate, __state, Position, Selection, Uri } = mod;

test.after(() => {
  fs.rmSync(entry, { force: true });
  fs.rmSync(outfile, { force: true });
  fs.rmSync(STUB, { force: true });
});

// ---------------------------------------------------------------------------
// Fake ollama: the FIM generation the provider needs before it can serve a
// ghost at all. A scope with no ghost on screen is not the state either of
// these two paths exists to leave.
// ---------------------------------------------------------------------------

function startServer() {
  const srv = { requests: [], replyFor: null };
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", () => {
      let body;
      try { body = raw ? JSON.parse(raw) : undefined; } catch { body = { raw }; }
      srv.requests.push({ method: req.method, url: req.url, body });
      if (req.url === "/api/tags") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ models: ["fake-fim", "fake-30b", "fake-14b"].map((name) => ({ name, model: name })) }));
        return;
      }
      if (req.url === "/api/generate") {
        const text = (srv.replyFor && srv.replyFor(body)) || "0";
        res.writeHead(200, { "Content-Type": "application/x-ndjson" });
        res.write(JSON.stringify({ response: text }) + "\n");
        res.write(JSON.stringify({ response: "", done: true, done_reason: "stop" }) + "\n");
        res.end();
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end("{}");
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      srv.apiBase = `http://127.0.0.1:${server.address().port}`;
      srv.close = () => new Promise((r) => server.close(r));
      resolve(srv);
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (predicate, what, tries = 200, soft = false) => {
  for (let i = 0; i < tries; i++) {
    if (predicate()) return true;
    await sleep(25);
  }
  if (soft) return false;
  assert.fail(`timed out waiting for ${what}`);
};

// ---------------------------------------------------------------------------
// One-time activation.
// ---------------------------------------------------------------------------

let harnessP;
let serverRef;
const harness = () =>
  (harnessP ||= (async () => {
    if (bundleError) throw bundleError;
    const srv = await startServer();
    serverRef = srv;
    __state.config = {
      enabled: true,
      apiBase: srv.apiBase,
      fimModel: "fake-fim",
      fnGenModel: "fake-30b",
      fnGenFallbackModel: "fake-14b",
      fnGenProvider: "ollama",
      cloudApiKey: "",
      cloudApiBase: "",
      hardwareTier: "16gb-large-ram",
      maxTokens: 128,
      temperature: 0.01,
      debounceMs: 0,
      prefixChars: 3000,
      suffixChars: 1000,
      multiline: true,
      repairEnabled: false,
      compilerDirectedInjection: true,
      fimAlternatives: 1,
      // OFF: this file is about a command SEQUENCE, and a gate that refuses
      // the ghost would leave nothing on screen to hide.
      fimMemberGate: false,
      logPrompts: false,
    };
    const mem = { get: (k, f) => f, update: async () => {}, keys: () => [], setKeysForSync() {} };
    const context = {
      subscriptions: [],
      globalState: mem,
      workspaceState: mem,
      secrets: { get: async () => undefined, store: async () => {}, delete: async () => {}, onDidChange: () => ({ dispose() {} }) },
      extensionUri: Uri.file("/ext"),
      extensionPath: "/ext",
      extensionMode: 1,
      asAbsolutePath: (p) => "/ext/" + p,
      globalStorageUri: Uri.file("/tmp/blind-v21-p1-storage"),
      logUri: Uri.file("/tmp/blind-v21-p1-log"),
      environmentVariableCollection: { replace() {}, append() {}, prepend() {}, clear() {} },
    };
    await activate(context);
    await waitFor(() => typeof __state.commands["column80.dismissScopedGhost"] === "function", "the dismissScopedGhost registration", 200, true);
    return { srv, context };
  })());

test.after(async () => {
  try {
    if (serverRef) await serverRef.close();
  } catch {}
});

// ---------------------------------------------------------------------------
// The scenario. `s.en` on a TypeScript document, the widget highlighting
// `.enrollTile`; the Escape after it leaves a sticky-scoped ghost on screen.
// That is the state both paths in item 3 exist to get out of.
// ---------------------------------------------------------------------------

const SOURCE = "let s: Stripe;\ns.en";
const CURSOR = { line: 1, character: 4 };
const PRESELECT = "enrollTile";
const GHOST = "rollTile(tile);"; // the FIM continuation that lands `enrollTile`

const HIDE = "editor.action.inlineSuggest.hide";
const TRIGGER = "editor.action.inlineSuggest.trigger";
const CLOSE_WIDGET = "hideSuggestWidget";

function makeDoc(text, uriStr, languageId) {
  const lines = text.split("\n");
  const offsetAt = (pos) => {
    let o = 0;
    for (let i = 0; i < Math.min(pos.line, lines.length); i++) o += lines[i].length + 1;
    return Math.min(o + pos.character, text.length);
  };
  const positionAt = (off) => {
    let o = 0;
    for (let l = 0; l < lines.length; l++) {
      if (off <= o + lines[l].length) return new Position(l, off - o);
      o += lines[l].length + 1;
    }
    return new Position(lines.length - 1, lines[lines.length - 1].length);
  };
  return {
    uri: Uri.parse(uriStr),
    fileName: uriStr.replace(/^file:\/\//, ""),
    languageId,
    version: 1,
    isDirty: false,
    isUntitled: false,
    isClosed: false,
    eol: 1,
    lineCount: lines.length,
    save: async () => true,
    offsetAt,
    positionAt,
    getText: (r) => (r ? text.slice(offsetAt(r.start), offsetAt(r.end)) : text),
    lineAt: (arg) => {
      const n = typeof arg === "number" ? arg : arg.line;
      const t = lines[n] ?? "";
      const m = t.match(/\S/);
      return {
        lineNumber: n,
        text: t,
        range: new mod.Range(n, 0, n, t.length),
        rangeIncludingLineBreak: new mod.Range(n, 0, n + 1, 0),
        firstNonWhitespaceCharacterIndex: m ? m.index : t.length,
        isEmptyOrWhitespace: !m,
      };
    },
    getWordRangeAtPosition: (pos) => {
      const t = lines[pos.line] ?? "";
      const isWord = (c) => /[A-Za-z0-9_$]/.test(c);
      let s = Math.min(pos.character, t.length);
      let e = s;
      while (s > 0 && isWord(t[s - 1])) s--;
      while (e < t.length && isWord(t[e])) e++;
      return e > s ? new mod.Range(pos.line, s, pos.line, e) : undefined;
    },
  };
}

const selectionInfo = (member) => ({
  text: `.${member}`,
  range: new mod.Range(CURSOR.line, 1, CURSOR.line, CURSOR.character),
});

const ids = () => __state.executeCalls.map((c) => c.id);
const clearCalls = () => {
  __state.executeCalls.length = 0;
};

// Drive the registered inline provider into the state the gesture leaves: a
// sticky-scoped ghost on screen with the widget closed. `steps` is the list of
// selectedCompletionInfo values, one per request - the widget's highlight,
// then the Escape's absence of one.
let driveN = 0;
async function driveToScopedGhost() {
  await harness();
  assert.ok(__state.inlineProviders.length >= 1, "activation registered no inline completion provider");
  const { provider } = __state.inlineProviders[0];
  driveN += 1;
  // A fresh uri per drive: a cached entry from an earlier drive would let a
  // request answer without going through the path that records the scope.
  const doc = makeDoc(SOURCE, `file:///proj/src/scope-${driveN}.ts`, "typescript");
  const pos = new Position(CURSOR.line, CURSOR.character);
  const token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) };
  serverRef.replyFor = () => GHOST;
  __state.activeTextEditor = { document: doc, selection: new Selection(pos, pos), selections: [new Selection(pos, pos)], viewColumn: 1 };
  __state.visibleTextEditors = [__state.activeTextEditor];

  let last;
  for (const sci of [selectionInfo(PRESELECT), undefined]) {
    last = await provider.provideInlineCompletionItems(doc, pos, { triggerKind: 0, selectedCompletionInfo: sci }, token);
  }
  const items = Array.isArray(last) ? last : (last && last.items) || [];
  return { provider, doc, pos, token, items };
}

const gtest = (name, fn) =>
  test(name, (ctx) => {
    if (bundleError) return ctx.skip("bundle failed to build; see the bundle test");
    return fn(ctx);
  });

test("harness: the extension entry builds, activates, and registers the dismissal command [harness guard - red here is a build problem, not a contract failure]", async () => {
  if (bundleError) assert.fail(`the surface is not buildable: ${bundleError.message}`);
  await harness();
  assert.strictEqual(
    typeof __state.commands["column80.dismissScopedGhost"],
    "function",
    `activation must register column80.dismissScopedGhost; registered commands are ${JSON.stringify(Object.keys(__state.commands))}`
  );
});

test("harness: the drive leaves a sticky-scoped ghost on screen [harness guard - the two paths under test only exist in this state]", async () => {
  if (bundleError) assert.fail(`the surface is not buildable: ${bundleError.message}`);
  const { items } = await driveToScopedGhost();
  assert.ok(
    items.length > 0,
    `the Escape must serve a scoped ghost, or there is nothing for a hide to hide; output tail ${JSON.stringify(__state.outputLines.slice(-8))}`
  );
});

// ===========================================================================
// A. THE EXPIRY HOOK. v20's 1500ms window ends by asking the editor to
// re-render unscoped. An explicit trigger sets VS Code's preserve flag
// unconditionally, the shown item is carried into the fetch by identity and
// prepended, and `canBeReused` says yes because nothing was typed - so the
// scoped item stays selected and the unscoped one sits unreachable at index 1.
// Hiding first leaves nothing to preserve.
// ===========================================================================

// EXCLUDED ON CI, and it is the only row in the suite that is. It drives the
// product through a REAL 1500ms window, and on a shared two-core runner the
// drive above does not reliably land a scoped ghost at all: the failing run
// reported ZERO commands after the serve, so there was no expiry to wait for
// rather than an expiry that came late. Widening the budget to 13.5s was tried
// and changed nothing. The gate waits under contention - the sibling
// dark-reason row proved that independently by growing a `gateWait=` segment -
// and a ghost the gate refuses records no scope.
//
// Skipping is the honest form of what was already happening: the row could not
// speak about the product on that hardware. It still runs everywhere else, on
// every developer machine and in the pre-tag local run. The fix is to drive the
// window with a fake clock so no wall time is involved; docs/roadmap.md item 23.
const CI_SKIP = process.env.CI ? "excluded on CI: real-timer row, see docs/roadmap.md item 23" : false;

test("A. the expiry re-render hides the inline suggestion BEFORE it triggers: a passive scope served, the real window elapsed, hide then trigger [surface item 3 'The expiry hook: hide, then trigger']", { skip: CI_SKIP }, async (ctx) => {
  if (bundleError) return ctx.skip("bundle failed to build; see the bundle test");
  const W = (mod.providerModule || {}).PASSIVE_SCOPE_MS;
  assert.strictEqual(typeof W, "number", `PASSIVE_SCOPE_MS must be a number for this row to know how long to wait, got ${JSON.stringify(W)}`);
  // Assert the PRECONDITION rather than discovering its absence as a timeout.
  // Without this, a drive that served nothing and a timer that never fired are
  // the same red, which is how the CI failure read for two runs.
  const { items } = await driveToScopedGhost();
  assert.ok(
    items.length > 0,
    `no scoped ghost was served, so no expiry was ever armed - this row's precondition failed, not its claim; output tail ${JSON.stringify(__state.outputLines.slice(-8))}`
  );
  clearCalls();
  // The one real timer in this file. Everything else is driven directly.
  //
  // This row is not CI-safe and the budget is not why. Widening it from 3000ms
  // to 13500ms was tried and changed nothing: the failing run reported NO
  // commands at all after the serve, so the expiry was never armed, which means
  // the drive above raced rather than the timer running late. Under contention
  // the scoped ghost is not on screen by the time this waits for its expiry.
  // Fixing it properly means driving the window with a fake clock instead of a
  // real one. Until then CI carries it as noise; docs/roadmap.md item 23.
  const saw = await waitFor(() => ids().includes(TRIGGER), "the expiry re-render", Math.ceil((W + 1500) / 25), true);
  assert.ok(
    saw,
    `the ${W}ms window must end in a re-render request; commands executed after the serve were ${JSON.stringify(ids())} - without a trigger the scoped ghost never comes off the screen at all`
  );
  const seq = ids();
  assert.ok(
    seq.includes(HIDE),
    `the production expiry must hide the inline suggestion before triggering; got ${JSON.stringify(seq)}`
  );
  assert.ok(
    seq.indexOf(HIDE) < seq.indexOf(TRIGGER),
    `${HIDE} must come strictly before ${TRIGGER} on the wired path too, got ${JSON.stringify(seq)}`
  );
});

// ===========================================================================
// B. THE SECOND ESCAPE, the branch where a scope WAS dropped. It already
// closes the suggest widget first and that stays. The inline suggestion has to
// be hidden too, for the same reason the expiry does.
// ===========================================================================

gtest("B. the second Escape hides the inline suggestion before triggering, and still closes the suggest widget first [surface item 3 'it already closes the suggest widget first, and that stays. The inline suggestion must be hidden too before the trigger']", async () => {
  await driveToScopedGhost();
  clearCalls();
  await __state.commands["column80.dismissScopedGhost"]();
  await sleep(50);
  const seq = ids();
  assert.ok(
    seq.includes(TRIGGER),
    `the dropped-scope branch re-renders unscoped, so ${TRIGGER} must be executed; got ${JSON.stringify(seq)} - if this is the only failure here, no scope was held and the harness is at fault, not the contract`
  );
  assert.ok(
    seq.includes(HIDE),
    `the inline suggestion must be hidden before the trigger, so ${HIDE} must be executed; got ${JSON.stringify(seq)}`
  );
  assert.ok(
    seq.indexOf(HIDE) < seq.indexOf(TRIGGER),
    `ordering is the whole contract: ${HIDE} strictly before ${TRIGGER}, got ${JSON.stringify(seq)}`
  );
  assert.ok(
    seq.includes(CLOSE_WIDGET),
    `closing the suggest widget first is existing behaviour and stays, so ${CLOSE_WIDGET} must still be executed; got ${JSON.stringify(seq)}`
  );
  assert.ok(
    seq.indexOf(CLOSE_WIDGET) < seq.indexOf(TRIGGER),
    `the widget close still comes before the re-render, got ${JSON.stringify(seq)}`
  );
});

// ===========================================================================
// C. THE SECOND ESCAPE, the branch where NO scope was dropped. Unchanged: it
// hides and returns, so the developer gets the Escape they actually pressed.
// A trigger here would re-render a ghost the developer just dismissed.
// ===========================================================================

gtest("C. with no scope to drop the command hides and returns: no trigger, so the developer gets the Escape they pressed [surface item 3 'The column80.dismissScopedGhost branch where no scope was dropped is unchanged: it hides and returns']", async () => {
  await harness();
  // No drive: nothing is scoped, which is exactly the stale-keybinding state.
  clearCalls();
  await __state.commands["column80.dismissScopedGhost"]();
  await sleep(50);
  const seq = ids();
  assert.ok(
    seq.includes(HIDE),
    `the fall-through is the editor's own Escape, so ${HIDE} must still be executed; got ${JSON.stringify(seq)}`
  );
  assert.ok(
    !seq.includes(TRIGGER),
    `nothing was dropped, so nothing may be re-rendered: ${TRIGGER} must not be executed, got ${JSON.stringify(seq)}`
  );
});

// ===========================================================================
// D. A failure in any of these commands still writes its existing failure line
// and does not throw out of the handler. The handler runs on Escape; an
// exception out of it is a keystroke the developer loses.
// ===========================================================================

gtest("D. a command that rejects does not throw out of the handler, on either branch [surface item 3 'A failure in any of these commands still writes its existing failure line and does not throw out of the handler']", async () => {
  await driveToScopedGhost();
  const boom = () => Promise.reject(new Error("the editor refused"));
  __state.commandHandlers[HIDE] = boom;
  __state.commandHandlers[TRIGGER] = boom;
  __state.commandHandlers[CLOSE_WIDGET] = boom;
  try {
    clearCalls();
    await __state.commands["column80.dismissScopedGhost"]();
    await __state.commands["column80.dismissScopedGhost"]();
    const hooks = (mod.providerModule || {}).REAL_SCOPE_HOOKS;
    if (hooks && typeof hooks.onExpired === "function") await hooks.onExpired();
  } catch (e) {
    assert.fail(`a failing editor command must not escape the handler, but it threw: ${e && e.message}`);
  } finally {
    delete __state.commandHandlers[HIDE];
    delete __state.commandHandlers[TRIGGER];
    delete __state.commandHandlers[CLOSE_WIDGET];
  }
});
