// Blind oracle: "TDD gesture honesty" - the per-language gate on
// column80.generateTests and column80.runTddTests.
//
// RE-CUT in session-v31 phase 6, and ONLY its language list moved. This file was
// written when the gesture was Rust-only and pinned that refusal as a promise:
// on a python / typescript / csharp document, exactly one message containing
// "Rust-only". Supersession S2 in docs/supersessions.md makes that promise
// deliberately false for four languages, and there is no Rust-only gate left to
// name - a refusal describing a gate that no longer exists is a lie. So the
// fixtures moved to languages with NO registered leg, and every other assertion
// in this file is untouched. The contract kept its teeth:
//
//  1. On a document whose language has NO registered leg (ruby / java / cpp
//     here) the command shows EXACTLY ONE user-facing message (warning or
//     information) that NAMES the document's language, does NOT say "Rust-only",
//     makes NO model/generation request, and never touches the buffer (no editor
//     edit, no snippet, no workspace.applyEdit).
//  2. On a rust document the gesture is unchanged - it proceeds past the gate
//     (the full Rust chain is pinned by the blind-v8 suites; here one smoke
//     case proves a rust document is NOT refused: no gate message, and the
//     gesture still reaches the generation service).
//
// The three languages are chosen so the row keeps its teeth however the
// supported list grows: none of ruby, java or cpp is in goal.md's five or on any
// roadmap item. The per-language gate for the FIVE supported languages, the
// write paths and the run outcomes are pinned by blind-v31-wiring.
//
// Harness: the blind-v9-gestures pattern verbatim - the whole extension is
// activated against a stub vscode, prompts are captured at a fake in-process
// Ollama server, extraction answers ride the stub's commands.executeCommand.
// The unregistered fixtures answer document symbols (a resolvable target), so
// the LANGUAGE gate is the only honest reason to refuse. Assertions match stable
// substrings (the language name), never exact message bytes. Never reads src/**.
//
// Run: SKIP_LIVE=1 node --test test/blind-derust-tdd.test.cjs
// (Hermetic: the "server" is in-process; no model, no network, no ollama.)

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const http = require("node:http");
const esbuild = require("esbuild");

// ---------------------------------------------------------------------------
// The vscode stub (blind-v9-gestures shape). Everything activation touches is
// recorded into __state or a safe no-op. Buffer-mutation channels the contract
// forbids on refusal are RECORDED, never just swallowed: workspace.applyEdit,
// and edit/insertSnippet on any editor the stub hands out.
// ---------------------------------------------------------------------------

const STUB = path.join(__dirname, ".blind-derust-tdd-stub.cjs");
fs.writeFileSync(
  STUB,
  `
const state = {
  config: {}, messages: [], commands: {}, executeCalls: [], commandHandlers: {},
  outputLines: [], inlineProviders: [], contentProviders: {},
  textDocuments: [], visibleTextEditors: [], activeTextEditor: undefined,
  collections: [], appliedEdits: [], editorEdits: [], snippetInserts: [],
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
      const docs = globalThis.__DERUST_DOCS__ || {};
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
    applyEdit: async (edit) => { state.appliedEdits.push(edit); return true; },
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
      return {
        document,
        selection: new Selection(new Position(0, 0), new Position(0, 0)),
        options: {}, viewColumn: 1,
        edit: async (cb) => { state.editorEdits.push("showTextDocument.edit"); return true; },
        insertSnippet: async (s) => { state.snippetInserts.push(s && s.value); return true; },
        setDecorations() {}, revealRange() {},
      };
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
// Bundle the extension's public entry with the stub aliased in. Guard pattern:
// a broken bundle or a missing activate is ONE loud failure, everything else
// skips.
// ---------------------------------------------------------------------------

const entry = path.join(__dirname, ".blind-derust-tdd.entry.ts");
const outfile = path.join(__dirname, ".blind-derust-tdd.bundle.cjs");
let mod = {};
let bundleError;
try {
  fs.writeFileSync(
    entry,
    `export { activate } from "../src/vscode/extension";
export { __state, Position, Range, Selection, Uri, Location } from "vscode";\n`
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

test("bundle: the extension entry builds and activates against the stub [harness guard]", async () => {
  if (bundleError) assert.fail(`the surface is not buildable: ${bundleError.message}`);
  await harness(); // activation itself must not throw
});

const gtest = (name, fn) =>
  test(name, (ctx) => {
    if (bundleError) return ctx.skip("bundle failed to build; see the bundle test");
    return fn(ctx);
  });

// ---------------------------------------------------------------------------
// Fake Ollama server: the no-generation observation point. /api/tags reports
// every configured model present, so no model gate can explain a refusal;
// the ONLY honest gate left on a non-rust document is the language.
// ---------------------------------------------------------------------------

const MODELS = ["fake-fim", "fake-30b", "fake-14b"];

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
        res.end(JSON.stringify({ models: MODELS.map((name) => ({ name, model: name })) }));
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
const waitFor = async (predicate, what, tries = 400, soft = false) => {
  for (let i = 0; i < tries; i++) {
    if (predicate()) return true;
    await sleep(25);
  }
  if (soft) return false;
  assert.fail(`timed out waiting for ${what}`);
};

// ---------------------------------------------------------------------------
// One-time activation (blind-v9-gestures config shape).
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
      globalStorageUri: Uri.file("/tmp/blind-derust-tdd-storage"),
      logUri: Uri.file("/tmp/blind-derust-tdd-log"),
      environmentVariableCollection: { replace() {}, append() {}, prepend() {}, clear() {} },
    };
    await activate(context);
    await waitFor(() => typeof __state.commands["column80.generateTests"] === "function", "generateTests registration");
    // Tier resolution logs a [carve] tier= line; wait softly so a changed log
    // format degrades to a slower first drive, not a dead harness.
    await waitFor(() => __state.outputLines.some((l) => l.includes("tier=")), "tier resolution line", 200, true);
    return { srv, context };
  })());

test.after(async () => {
  try {
    if (serverRef) await serverRef.close();
  } catch {}
});

// ---------------------------------------------------------------------------
// Document / editor fakes (blind-v9-gestures mechanics; the editor RECORDS
// edit/insertSnippet so a buffer mutation on refusal is observable).
// ---------------------------------------------------------------------------

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

const makeEditor = (doc, pos) => {
  const edits = [];
  const snippets = [];
  return {
    document: doc,
    selection: new Selection(pos, pos),
    selections: [new Selection(pos, pos)],
    options: { tabSize: 4, insertSpaces: true },
    viewColumn: 1,
    edit: async (cb) => { edits.push(cb); return true; },
    insertSnippet: async (s) => { snippets.push(s && s.value); return true; },
    setDecorations() {},
    revealRange() {},
    __edits: edits,
    __snippets: snippets,
  };
};

// Position helpers (blind-v9 conventions): computed, never counted.
const posOf = (text, needle, nth = 0) => {
  let idx = -1;
  for (let i = 0; i <= nth; i++) {
    idx = text.indexOf(needle, idx + 1);
    assert.ok(idx >= 0, `fixture needle not found (occurrence ${i}): ${JSON.stringify(needle)}`);
  }
  const before = text.slice(0, idx);
  const line = (before.match(/\n/g) || []).length;
  return new Position(line, idx - (before.lastIndexOf("\n") + 1));
};

// vscode-shaped fixture builders.
const vr = (sl, sc, el, ec) => new mod.Range(sl, sc, el, ec);
const dsym = (name, kind, range, selectionRange, children = [], detail = "") => ({
  name, detail, kind, range, selectionRange, children,
});

// ---------------------------------------------------------------------------
// Drive helpers (blind-v9-gestures shapes).
// ---------------------------------------------------------------------------

const resetDrive = (handlers, docs, editor) => {
  __state.commandHandlers = handlers || {};
  __state.messages.length = 0;
  __state.executeCalls.length = 0;
  __state.appliedEdits.length = 0;
  __state.editorEdits.length = 0;
  __state.snippetInserts.length = 0;
  globalThis.__DERUST_DOCS__ = docs || {};
  __state.activeTextEditor = editor;
  __state.textDocuments = editor ? [editor.document] : [];
  __state.visibleTextEditors = editor ? [editor] : [];
  serverRef.requests.length = 0;
  serverRef.replyFor = null;
};

const diag = () =>
  `messages=${JSON.stringify(__state.messages)} lastLog=${JSON.stringify(__state.outputLines.slice(-6))}`;

// Drive a gesture command to SETTLEMENT (the refusal path must complete), then
// report everything the refusal contract constrains.
async function driveSettled(commandId, { doc, cursor, handlers, docs, reply }) {
  await harness();
  const editor = makeEditor(doc, cursor);
  resetDrive(handlers, docs, editor);
  serverRef.replyFor = reply || null;
  const cmd = __state.commands[commandId];
  assert.strictEqual(typeof cmd, "function", `${commandId} must be registered`);
  let cmdError;
  let cmdSettled = false;
  Promise.resolve()
    .then(() => cmd())
    .then(
      () => { cmdSettled = true; },
      (e) => { cmdError = e; cmdSettled = true; }
    );
  // The rust path may park on UI the stub never supplies (accept/reject), so
  // settlement is raced against a generation request - either observation is a
  // complete drive for the contracts pinned here.
  await waitFor(
    () => cmdSettled || serverRef.requests.some((r) => r.url === "/api/generate"),
    `${commandId} to settle or reach the generation service`
  );
  // Let any trailing async work (a second message, a late request) land before
  // the exactly-one / exactly-none assertions read the recorders.
  await sleep(150);
  return {
    cmdError,
    genRequests: serverRef.requests.filter((r) => r.url === "/api/generate"),
    messages: __state.messages.slice(),
    editorEdits: editor.__edits.length + __state.editorEdits.length,
    snippetInserts: editor.__snippets.length + __state.snippetInserts.length,
    appliedEdits: __state.appliedEdits.length,
  };
}

// ---------------------------------------------------------------------------
// UNREGISTERED-language fixtures: one real documented function per language,
// with resolvable document symbols, so the LANGUAGE gate is the only honest
// reason to refuse. Extraction beyond symbols answers undefined (the blind-v9
// "empty" mode) - a refusal that depends on extraction darkness is not the
// promised gate.
//
// ruby, java and cpp are chosen deliberately: none is in goal.md's five and none
// is on any roadmap item, so this row keeps its teeth however the supported list
// grows.
// ---------------------------------------------------------------------------

const RB_TEXT = `# Reads the order total.
def read_order(order)
  0
end
`;
const JAVA_TEXT = `public class Orders {
    /** Reads the order total. */
    public int readOrder(int o) {
        return 0;
    }
}
`;
const CPP_TEXT = `// Reads the order total.
int read_order(int o) {
    return 0;
}
`;

const UNREGISTERED = [
  {
    languageId: "ruby",
    nameRe: /ruby/i,
    nameWhy: "ruby",
    uri: "file:///proj/src/orders.rb",
    text: RB_TEXT,
    cursorNeedle: "  0",
    symbols: (text) => {
      const sig = posOf(text, "def read_order");
      const nameCh = text.split("\n")[sig.line].indexOf("read_order");
      return [dsym("read_order", 11, vr(sig.line - 1, 0, sig.line + 2, 3), vr(sig.line, nameCh, sig.line, nameCh + "read_order".length))];
    },
  },
  {
    languageId: "java",
    nameRe: /java/i,
    nameWhy: "java",
    uri: "file:///proj/src/Orders.java",
    text: JAVA_TEXT,
    cursorNeedle: "        return 0;",
    symbols: (text) => {
      const cls = posOf(text, "public class Orders");
      const sig = posOf(text, "public int readOrder");
      const nameCh = text.split("\n")[sig.line].indexOf("readOrder");
      return [
        dsym("Orders", 4, vr(cls.line, 0, text.split("\n").length - 1, 1), vr(cls.line, 13, cls.line, 19), [
          dsym("readOrder", 5, vr(sig.line - 1, 0, sig.line + 2, 5), vr(sig.line, nameCh, sig.line, nameCh + "readOrder".length)),
        ]),
      ];
    },
  },
  {
    languageId: "cpp",
    nameRe: /cpp|c\+\+/i,
    nameWhy: "cpp (or C++)",
    uri: "file:///proj/src/orders.cpp",
    text: CPP_TEXT,
    cursorNeedle: "    return 0;",
    symbols: (text) => {
      const sig = posOf(text, "int read_order");
      const nameCh = text.split("\n")[sig.line].indexOf("read_order");
      return [dsym("read_order", 11, vr(sig.line - 1, 0, sig.line + 2, 1), vr(sig.line, nameCh, sig.line, nameCh + "read_order".length))];
    },
  },
];

const emptyHandlers = (symbols) => ({
  "vscode.executeDocumentSymbolProvider": () => symbols,
  "vscode.executeDefinitionProvider": () => undefined,
  "vscode.executeHoverProvider": () => undefined,
  "vscode.executeCompletionItemProvider": () => undefined,
  "vscode.executeCodeActionProvider": () => undefined,
});

// One drive per language, memoized; every assertion group reads the same drive.
const refusalDriveP = {};
const driveRefusal = (lang) =>
  (refusalDriveP[lang.languageId] ||= (async () => {
    const doc = makeDoc(lang.text, lang.uri, lang.languageId);
    const cursor = posOf(lang.text, lang.cursorNeedle);
    return driveSettled("column80.generateTests", {
      doc,
      cursor: new Position(cursor.line + 1, 0),
      handlers: emptyHandlers(lang.symbols(lang.text)),
      docs: { [lang.uri]: doc },
    });
  })());

// ===========================================================================
// 1. The gate on non-rust documents. [P1 'TDD gesture honesty'] RED today:
// the Rust-only gate does not exist yet.
// ===========================================================================

for (const lang of UNREGISTERED) {
  gtest(`test-gen gate (${lang.languageId}): exactly ONE user-facing message, a warning or information - never silence, never a pile, never an error dialog [P1 'shows exactly one message (warning or information)']`, async () => {
    const { cmdError, messages } = await driveRefusal(lang);
    assert.strictEqual(cmdError, undefined, `the refusal must settle without crashing, got ${cmdError && cmdError.message}`);
    assert.strictEqual(
      messages.length,
      1,
      `a refused test-gen shows exactly one message, got ${messages.length}: ${JSON.stringify(messages)}`
    );
    assert.ok(
      messages[0].kind === "warn" || messages[0].kind === "info",
      `the refusal is a warning or information message, not ${JSON.stringify(messages[0].kind)}`
    );
  });

  gtest(`test-gen gate (${lang.languageId}): the refusal NAMES the document's language (${lang.nameWhy}) and no longer says "Rust-only" [re-cut for docs/supersessions.md S2: only the language list moved]`, async () => {
    const { messages } = await driveRefusal(lang);
    assert.ok(messages.length >= 1, `a refusal message must exist to carry the wording; got none. ${diag()}`);
    const texts = messages.map((m) => String(m.message));
    assert.ok(
      texts.some((t) => lang.nameRe.test(t)),
      `the refusal names the document's language (${lang.nameWhy}). MESSAGES: ${JSON.stringify(texts)}`
    );
    assert.ok(
      !texts.some((t) => /Rust-only/i.test(t)),
      `after S2 there is no Rust-only gate to name; the refusal is about ${lang.languageId} having no leg. MESSAGES: ${JSON.stringify(texts)}`
    );
  });

  gtest(`test-gen gate (${lang.languageId}): NO generation request, NO buffer edit, NO snippet - the refusal is inert [P1 'no model request, never modifies the buffer']`, async () => {
    const { genRequests, editorEdits, snippetInserts, appliedEdits } = await driveRefusal(lang);
    assert.strictEqual(
      genRequests.length,
      0,
      `a refused test-gen must not reach the model; prompts sent: ${JSON.stringify(genRequests.map((r) => r.body && r.body.prompt))}`
    );
    assert.strictEqual(editorEdits, 0, "a refused test-gen never edits an editor buffer");
    assert.strictEqual(snippetInserts, 0, "a refused test-gen never inserts a snippet");
    assert.strictEqual(appliedEdits, 0, "a refused test-gen never applies a workspace edit");
  });
}

// ===========================================================================
// 2. Rust smoke: the gate does NOT catch rust. [P1 'rust behavior unchanged']
// GREEN today and it stays green - the full Rust chain is pinned by the
// blind-v8 suites; this one case proves the NEW gate never fires on rust.
// ===========================================================================

const RUST_TEXT = `/// Sums the widget mass.
fn total_mass(w: u64) -> u64 {

}
`;
const testModReply = () =>
  "```rust\n#[cfg(test)]\nmod tests {\n    use super::*;\n\n    #[test]\n    fn sums() { assert_eq!(1, 1); }\n}\n```";

gtest("test-gen gate (rust smoke): a rust document is NOT refused - no Rust-only message, and the gesture still proceeds to the generation service [P1 'invoked on rust, behavior unchanged']", async () => {
  const uri = "file:///proj/src/mass.rs";
  const doc = makeDoc(RUST_TEXT, uri, "rust");
  const sig = posOf(RUST_TEXT, "fn total_mass");
  const nameCh = RUST_TEXT.split("\n")[sig.line].indexOf("total_mass");
  // rust-analyzer's symbol range INCLUDES the leading /// doc line (the shape
  // the doc scanner is calibrated against, per the blind-v9 harness note), so
  // the range starts one line above the signature - otherwise the doc comment
  // never resolves and the eligibility gate honestly refuses "no doc comment".
  const symbols = [
    dsym("total_mass", 11, vr(sig.line - 1, 0, sig.line + 2, 1), vr(sig.line, nameCh, sig.line, nameCh + "total_mass".length)),
  ];
  const { genRequests, messages } = await driveSettled("column80.generateTests", {
    doc,
    cursor: new Position(sig.line + 1, 0),
    handlers: emptyHandlers(symbols),
    docs: { [uri]: doc },
    reply: testModReply,
  });
  const texts = messages.map((m) => String(m.message));
  assert.ok(
    !texts.some((t) => /Rust-only/i.test(t)),
    `the Rust-only gate must never fire on a rust document. MESSAGES: ${JSON.stringify(texts)}`
  );
  assert.ok(
    genRequests.length >= 1,
    `an eligible rust test-gen still reaches the generation service - the gate cannot dim the rust chain. ${diag()}`
  );
});

// ===========================================================================
// 3. The OTHER half of the gesture: Run TDD Tests. [P1 triage do-list] Same
// honesty contract as generateTests - a non-rust document gets the Rust-only
// refusal, never "no test rung for <lang>" (which implies TDD exists for the
// language and only a runner is missing). RED today.
// ===========================================================================

const runRefusalDriveP = {};
const driveRunRefusal = (lang) =>
  (runRefusalDriveP[lang.languageId] ||= (async () => {
    const doc = makeDoc(lang.text, lang.uri, lang.languageId);
    const cursor = posOf(lang.text, lang.cursorNeedle);
    return driveSettled("column80.runTddTests", {
      doc,
      cursor: new Position(cursor.line + 1, 0),
      handlers: emptyHandlers(lang.symbols(lang.text)),
      docs: { [lang.uri]: doc },
    });
  })());

for (const lang of UNREGISTERED) {
  gtest(`run-tests gate (${lang.languageId}): the refusal NAMES the language and no longer says "Rust-only" - never "no test rung" [re-cut for docs/supersessions.md S2; the run half keeps the same wording rule as the generateTests gate]`, async () => {
    const { cmdError, messages } = await driveRunRefusal(lang);
    assert.strictEqual(cmdError, undefined, `the refusal must settle without crashing, got ${cmdError && cmdError.message}`);
    const texts = messages.map((m) => String(m.message));
    assert.ok(
      !texts.some((t) => /Rust-only/i.test(t)),
      `after S2 there is no Rust-only gate to name. MESSAGES: ${JSON.stringify(texts)}`
    );
    assert.ok(
      texts.some((t) => lang.nameRe.test(t)),
      `the run-tests refusal names the document's language (${lang.nameWhy}). MESSAGES: ${JSON.stringify(texts)}`
    );
    assert.ok(
      !texts.some((t) => /no test rung/i.test(t)),
      `"no test rung" implies the gesture exists for ${lang.languageId}; the honest refusal replaces it. MESSAGES: ${JSON.stringify(texts)}`
    );
  });
}

gtest("run-tests gate (rust smoke): a rust document is NOT refused by the language gate [P1 'rust behavior unchanged']", async () => {
  const uri = "file:///proj/src/mass_run.rs";
  const doc = makeDoc(RUST_TEXT, uri, "rust");
  const sig = posOf(RUST_TEXT, "fn total_mass");
  const nameCh = RUST_TEXT.split("\n")[sig.line].indexOf("total_mass");
  const symbols = [
    dsym("total_mass", 11, vr(sig.line - 1, 0, sig.line + 2, 1), vr(sig.line, nameCh, sig.line, nameCh + "total_mass".length)),
  ];
  const { messages } = await driveSettled("column80.runTddTests", {
    doc,
    cursor: new Position(sig.line + 1, 0),
    handlers: emptyHandlers(symbols),
    docs: { [uri]: doc },
  });
  const texts = messages.map((m) => String(m.message));
  assert.ok(
    !texts.some((t) => /Rust-only/i.test(t)),
    `the Rust-only gate must never fire on a rust document. MESSAGES: ${JSON.stringify(texts)}`
  );
});
