// Blind oracle: the TDD gesture attempts generation for a function with no doc
// comment.
//
// Human request, verbatim: "generate TDD refuses if there is no doc comment;
// but often it's obvious by fn name and not required. don't make it a fail,
// just attempt the tdd gen".
//
// Contract, three points, all five languages (Rust, Go, C#, Python, TS):
//   1. No doc comment (no `///`, no docstring) is no longer a refusal. With an
//      assertable return value, generation is ATTEMPTED: a prompt is assembled
//      and the backend is called.
//   2. Every other refusal is unchanged. A function with no value to assert is
//      still refused, doc comment or not, with the SAME reason its documented
//      twin gets.
//   3. The prompt for an undocumented function names the function and its
//      signature, and carries no empty doc/contract block implying a contract
//      that is not there.
//
// Two layers:
//   - THE FACADE. column80.generateTests is driven end to end against a stub
//     vscode, with a fake in-process Ollama server as the capturing backend.
//     "The model was asked" is a request at /api/generate; nothing else counts.
//     Harness copied from test/blind-v31-wiring.test.cjs (real temp workspace,
//     real project files so placement and framework detection succeed).
//   - THE GATE. tddLangFor(id).classifyTestability, the product's own gate,
//     compared twin against twin: the same signature documented and not.
//
// Each language carries a DOCUMENTED value-returning control that must reach
// the backend. It is green before and after the change: it proves the harness
// can make generation happen, so a red undocumented row is the doc-comment
// gate and not a rig that cannot produce the case.
//
// Run: SKIP_LIVE=1 node --test test/blind-tdd-nodoc.test.cjs
// (Hermetic: no model, no network, no toolchain.)

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const os = require("os");
const http = require("node:http");
const esbuild = require("esbuild");

const GUESS = "4242424";
const GUESS2 = "7777777";

// ---------------------------------------------------------------------------
// The real temp workspace. Every fixture project below is DERIVED from the
// corpus shapes goal.md measured (react-mobx-mvvm's vitest package.json,
// mcp-graph-engine's testpaths, Contoso's IsTestProject + ProjectReference
// pair, a stdlib go.mod). None of it is copied from a real repo; it is the
// smallest shape carrying the signals each leg's detection reads.
// ---------------------------------------------------------------------------

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "blind-tdd-nodoc-"));
const w = (rel, text) => {
  const p = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
  return p;
};
// ---------------------------------------------------------------------------
// The vscode stub. blind-derust-tdd's shape plus the phase 6 observation
// points: every SHOWN surface is recorded, and every WRITE channel really
// writes to the temp workspace so a create is observable however it is done.
// ---------------------------------------------------------------------------

const STUB = path.join(__dirname, ".blind-tdd-nodoc-stub.cjs");
fs.writeFileSync(
  STUB,
  `
const nodeFs = require("fs");
const nodePath = require("path");
const state = {
  config: {}, messages: [], commands: {}, executeCalls: [], commandHandlers: {},
  outputLines: [], inlineProviders: [], contentProviders: {},
  textDocuments: [], visibleTextEditors: [], activeTextEditor: undefined,
  collections: [], appliedEdits: [], editorEdits: [], snippetInserts: [],
  openedDocs: [], shownDocs: [], fsWrites: [], picks: [],
  answer: null, answerPick: null, workspaceRoot: "/proj",
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
  constructor() { this._entries = []; this._files = []; }
  replace(uri, range, text) { this._entries.push([uri, [{ range, newText: text }]]); }
  insert(uri, pos, text) { this._entries.push([uri, [{ range: new Range(pos, pos), newText: text }]]); }
  delete(uri, range) { this._entries.push([uri, [{ range, newText: "" }]]); }
  createFile(uri, options) { this._files.push({ op: "create", uri, options }); }
  deleteFile(uri, options) { this._files.push({ op: "delete", uri, options }); }
  renameFile(from, to, options) { this._files.push({ op: "rename", uri: to, from, options }); }
  entries() { return this._entries; }
  get size() { return this._entries.length + this._files.length; }
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

// Offsets over a real text, so a WorkspaceEdit can be applied to real bytes.
const offsetOf = (text, pos) => {
  const lines = text.split("\\n");
  let o = 0;
  for (let i = 0; i < Math.min(pos.line, lines.length); i++) o += lines[i].length + 1;
  return Math.min(o + pos.character, text.length);
};
const readIfFile = (p) => { try { return nodeFs.readFileSync(p, "utf8"); } catch { return undefined; } };
const mkDocFromText = (uri, text, languageId) => {
  const lines = String(text).split("\\n");
  return {
    uri, fileName: uri.fsPath, languageId: languageId || "plaintext", version: 1,
    isDirty: false, isUntitled: false, isClosed: false, eol: 1, lineCount: lines.length,
    getText: (r) => (r ? String(text).slice(offsetOf(text, r.start), offsetOf(text, r.end)) : String(text)),
    offsetAt: (p) => offsetOf(text, p),
    positionAt: (off) => {
      let o = 0;
      for (let l = 0; l < lines.length; l++) {
        if (off <= o + lines[l].length) return new Position(l, off - o);
        o += lines[l].length + 1;
      }
      return new Position(lines.length - 1, lines[lines.length - 1].length);
    },
    lineAt: (n) => {
      const i = typeof n === "number" ? n : n.line;
      const t = lines[i] || "";
      const m = t.match(/\\S/);
      return { lineNumber: i, text: t, firstNonWhitespaceCharacterIndex: m ? m.index : t.length,
        isEmptyOrWhitespace: !m, range: new Range(i, 0, i, t.length),
        rangeIncludingLineBreak: new Range(i, 0, i + 1, 0) };
    },
    getWordRangeAtPosition: () => undefined,
    save: async () => true,
  };
};

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
  FileType: { Unknown: 0, File: 1, Directory: 2, SymbolicLink: 64 },
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
      if (arg && typeof arg === "object" && typeof arg.content === "string") {
        const doc = mkDocFromText(Uri.parse("untitled:v31"), arg.content, arg.language);
        doc.isUntitled = true;
        state.openedDocs.push({ key: "untitled", text: arg.content });
        return doc;
      }
      const uri = typeof arg === "string" ? (arg.includes("://") ? Uri.parse(arg) : Uri.file(arg)) : arg;
      const key = uri && uri.toString ? uri.toString() : String(arg);
      const preset = (globalThis.__V31_DOCS__ || {})[key];
      if (preset) { state.openedDocs.push({ key, text: preset.getText() }); return preset; }
      const scheme = uri && uri.scheme ? uri.scheme : "file";
      if (scheme === "file") {
        const onDisk = readIfFile(uri.fsPath);
        if (onDisk !== undefined) {
          state.openedDocs.push({ key, text: onDisk });
          return mkDocFromText(uri, onDisk, undefined);
        }
      }
      const provider = state.contentProviders[scheme];
      const text = provider ? await provider.provideTextDocumentContent(uri, { isCancellationRequested: false }) : "";
      state.openedDocs.push({ key, text: String(text || "") });
      return mkDocFromText(uri, String(text || ""), undefined);
    },
    applyEdit: async (edit) => {
      state.appliedEdits.push(edit);
      for (const f of (edit && edit._files) || []) {
        const p = f.uri && f.uri.fsPath;
        if (!p) continue;
        if (f.op === "create") {
          nodeFs.mkdirSync(nodePath.dirname(p), { recursive: true });
          if (!nodeFs.existsSync(p) || (f.options && f.options.overwrite)) nodeFs.writeFileSync(p, "");
          state.fsWrites.push({ how: "WorkspaceEdit.createFile", path: p });
        } else if (f.op === "delete") {
          try { nodeFs.rmSync(p, { force: true, recursive: true }); } catch {}
          state.fsWrites.push({ how: "WorkspaceEdit.deleteFile", path: p });
        }
      }
      const byPath = new Map();
      for (const [uri, edits] of (edit && edit.entries ? edit.entries() : [])) {
        const p = uri && uri.fsPath;
        if (!p) continue;
        if (!byPath.has(p)) byPath.set(p, []);
        for (const e of edits) byPath.get(p).push(e);
      }
      for (const [p, edits] of byPath) {
        let text = readIfFile(p);
        if (text === undefined) continue;
        const resolved = edits
          .map((e) => ({ s: offsetOf(text, e.range.start), e: offsetOf(text, e.range.end), t: e.newText }))
          .sort((a, b) => b.s - a.s);
        for (const r of resolved) text = text.slice(0, r.s) + r.t + text.slice(r.e);
        nodeFs.writeFileSync(p, text);
        state.fsWrites.push({ how: "WorkspaceEdit.textEdit", path: p });
      }
      return true;
    },
    get workspaceFolders() { return [{ uri: Uri.file(state.workspaceRoot), name: "probe", index: 0 }]; },
    asRelativePath: (u) => String(u && u.fsPath ? u.fsPath : u).replace(state.workspaceRoot + "/", ""),
    createFileSystemWatcher: () => ({ onDidChange: () => disposable(), onDidCreate: () => disposable(), onDidDelete: () => disposable(), dispose() {} }),
    fs: {
      stat: async (uri) => {
        const st = nodeFs.statSync(uri.fsPath);
        return { type: st.isDirectory() ? 2 : 1, ctime: 0, mtime: 0, size: st.size };
      },
      readFile: async (uri) => new Uint8Array(nodeFs.readFileSync(uri.fsPath)),
      writeFile: async (uri, bytes) => {
        nodeFs.mkdirSync(nodePath.dirname(uri.fsPath), { recursive: true });
        nodeFs.writeFileSync(uri.fsPath, Buffer.from(bytes));
        state.fsWrites.push({ how: "workspace.fs.writeFile", path: uri.fsPath });
      },
      createDirectory: async (uri) => {
        nodeFs.mkdirSync(uri.fsPath, { recursive: true });
        state.fsWrites.push({ how: "workspace.fs.createDirectory", path: uri.fsPath });
      },
      delete: async (uri) => {
        try { nodeFs.rmSync(uri.fsPath, { force: true, recursive: true }); } catch {}
        state.fsWrites.push({ how: "workspace.fs.delete", path: uri.fsPath });
      },
      readDirectory: async (uri) => nodeFs.readdirSync(uri.fsPath).map((n) => [n, 1]),
    },
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
    showInformationMessage: async (message, ...rest) => {
      const actions = rest.filter((r) => typeof r === "string" || (r && typeof r.title === "string"));
      state.messages.push({ kind: "info", message, actions });
      return state.answer ? state.answer("info", message, actions) : undefined;
    },
    showWarningMessage: async (message, ...rest) => {
      const actions = rest.filter((r) => typeof r === "string" || (r && typeof r.title === "string"));
      state.messages.push({ kind: "warn", message, actions });
      return state.answer ? state.answer("warn", message, actions) : undefined;
    },
    showErrorMessage: async (message, ...rest) => {
      const actions = rest.filter((r) => typeof r === "string" || (r && typeof r.title === "string"));
      state.messages.push({ kind: "error", message, actions });
      return state.answer ? state.answer("error", message, actions) : undefined;
    },
    showQuickPick: async (items, options) => {
      const resolved = await items;
      state.picks.push({ items: resolved, options });
      return state.answerPick ? state.answerPick(resolved, options) : undefined;
    },
    showInputBox: async () => undefined,
    withProgress: async (opts, task) => task({ report: () => {} }, { isCancellationRequested: false, onCancellationRequested: () => disposable() }),
    setStatusBarMessage: () => disposable(),
    showTextDocument: async (docOrUri, opts) => {
      let document = docOrUri;
      if (!docOrUri || typeof docOrUri.getText !== "function") {
        const uri = typeof docOrUri === "string" ? Uri.file(docOrUri) : docOrUri;
        const onDisk = uri && uri.fsPath ? readIfFile(uri.fsPath) : undefined;
        document = mkDocFromText(uri || Uri.file("/unknown"), onDisk === undefined ? "" : onDisk, undefined);
      }
      state.shownDocs.push({ key: document.uri && document.uri.toString ? document.uri.toString() : "", text: document.getText() });
      return {
        document,
        selection: new Selection(new Position(0, 0), new Position(0, 0)),
        selections: [new Selection(new Position(0, 0), new Position(0, 0))],
        options: {}, viewColumn: 1,
        edit: async () => { state.editorEdits.push({ how: "showTextDocument.edit", uri: String(document.uri) }); return true; },
        insertSnippet: async (s) => {
          state.snippetInserts.push({ uri: document.uri && document.uri.fsPath, value: s && s.value });
          return true;
        },
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
// Bundle the extension entry AND the seam's one construction point, with the
// stub aliased in. Guard pattern: a broken bundle, a missing activate or a
// missing tddLangFor is ONE loud failure and everything else skips.
// ---------------------------------------------------------------------------

const entry = path.join(__dirname, ".blind-tdd-nodoc.entry.ts");
const outfile = path.join(__dirname, ".blind-tdd-nodoc.bundle.cjs");
let mod = {};
let bundleError;
try {
  fs.writeFileSync(
    entry,
    `export { activate } from "../src/vscode/extension";
export { tddLangFor } from "../src/core/tddLang";
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
if (!bundleError && typeof mod.tddLangFor !== "function") {
  bundleError = new Error("the bundle built but src/core/tddLang.ts exports no tddLangFor");
}
const { activate, tddLangFor, __state, Position, Selection, Uri } = mod;

test.after(() => {
  fs.rmSync(entry, { force: true });
  fs.rmSync(outfile, { force: true });
  fs.rmSync(STUB, { force: true });
  fs.rmSync(ROOT, { force: true, recursive: true });
});

test("bundle: the extension entry and the tddLangFor seam build and activate against the stub [harness guard: one loud failure, everything else skips]", async () => {
  if (bundleError) assert.fail(`the surface is not buildable: ${bundleError.message}`);
  await harness();
});

const gtest = (name, fn) =>
  test(name, (ctx) => {
    if (bundleError) return ctx.skip("the surface did not build; see the bundle guard row");
    return fn(ctx);
  });

// ---------------------------------------------------------------------------
// Fake Ollama server: the no-generation observation point. /api/tags reports
// every configured model present, so no model gate can explain a refusal and
// the only honest gate left is the one under measurement.
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
// One-time activation.
// ---------------------------------------------------------------------------

let harnessP;
let serverRef;
const harness = () =>
  (harnessP ||= (async () => {
    if (bundleError) throw bundleError;
    const srv = await startServer();
    serverRef = srv;
    __state.workspaceRoot = ROOT;
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
      maxTokens: 512,
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
      globalStorageUri: Uri.file(path.join(ROOT, "storage")),
      logUri: Uri.file(path.join(ROOT, "log")),
      environmentVariableCollection: { replace() {}, append() {}, prepend() {}, clear() {} },
    };
    await activate(context);
    await waitFor(() => typeof __state.commands["column80.generateTests"] === "function", "generateTests registration");
    await waitFor(() => __state.outputLines.some((l) => l.includes("tier=")), "tier resolution line", 200, true);
    return { srv, context };
  })());

test.after(async () => {
  try {
    if (serverRef) await serverRef.close();
  } catch {}
});

// ---------------------------------------------------------------------------
// Document / editor fakes. The editor RECORDS edit and insertSnippet, so a
// buffer mutation on refusal is observable.
// ---------------------------------------------------------------------------

function makeDoc(text, filePath, languageId) {
  const uriStr = "file://" + filePath;
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
    fileName: filePath,
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
    insertSnippet: async (s) => { snippets.push({ uri: doc.fileName, value: s && s.value }); return true; },
    setDecorations() {},
    revealRange() {},
    __edits: edits,
    __snippets: snippets,
  };
};

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

const vr = (sl, sc, el, ec) => new mod.Range(sl, sc, el, ec);
const dsym = (name, kind, range, selectionRange, children = [], detail = "") => ({
  name, detail, kind, range, selectionRange, children,
});

const emptyHandlers = (symbols) => ({
  "vscode.executeDocumentSymbolProvider": () => symbols,
  "vscode.executeDefinitionProvider": () => undefined,
  "vscode.executeHoverProvider": () => undefined,
  "vscode.executeCompletionItemProvider": () => undefined,
  "vscode.executeCodeActionProvider": () => undefined,
});

// ---------------------------------------------------------------------------
// Disk observation. The workspace is real, so "leaves no file behind" is a
// walk of the tree rather than trust in one channel.
// ---------------------------------------------------------------------------

const walk = (dir, acc = []) => {
  for (const name of fs.readdirSync(dir)) {
    if (name === "fakebin" || name === "emptybin") continue;
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, acc);
    else acc.push(path.relative(ROOT, p));
  }
  return acc.sort();
};
const snapshot = () => {
  const out = {};
  for (const rel of walk(ROOT)) out[rel] = fs.readFileSync(path.join(ROOT, rel), "utf8");
  return out;
};
const diffSnapshot = (before, after) => {
  const created = Object.keys(after).filter((k) => !(k in before));
  const changed = Object.keys(after).filter((k) => k in before && before[k] !== after[k]);
  const deleted = Object.keys(before).filter((k) => !(k in after));
  return { created, changed, deleted };
};

// A test PROJECT, a config file or a manifest, by name. The human's boundary.
const PROJECT_ARTEFACT = /(^|\/)(go\.mod|go\.sum|go\.work|package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|vitest\.config\.[cm]?[jt]s|jest\.config\.[cm]?[jt]s|tsconfig(\..*)?\.json|pyproject\.toml|setup\.py|setup\.cfg|tox\.ini|requirements[^/]*\.txt|conftest\.py|pytest\.ini|Cargo\.toml|[^/]+\.csproj|[^/]+\.sln|[^/]+\.props|nuget\.config|Directory\.Build\.[^/]+)$/i;

// ---------------------------------------------------------------------------
// Surface collection: everything the human could have been SHOWN.
// ---------------------------------------------------------------------------

async function shownSurfaces() {
  const out = [];
  for (const m of __state.messages) out.push(String(m.message));
  for (const p of __state.picks) out.push(JSON.stringify(p.items));
  for (const d of __state.openedDocs) out.push(String(d.text || ""));
  for (const d of __state.shownDocs) out.push(String(d.text || ""));
  for (const c of __state.executeCalls) {
    if (!/diff|preview|open|show/i.test(String(c.id))) continue;
    for (const a of c.args || []) {
      if (typeof a === "string") { out.push(a); continue; }
      if (!a || typeof a.toString !== "function") continue;
      const s = String(a);
      out.push(s);
      const scheme = s.includes("://") ? s.slice(0, s.indexOf("://")) : null;
      const provider = scheme && __state.contentProviders[scheme];
      if (!provider) continue;
      try {
        const text = await provider.provideTextDocumentContent(a, { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) });
        out.push(String(text || ""));
      } catch {}
    }
  }
  return out;
}

const writtenSurfaces = (editor) => {
  const out = [];
  for (const s of __state.snippetInserts) out.push(String(s.value || ""));
  for (const s of (editor ? editor.__snippets : [])) out.push(String(s.value || ""));
  for (const e of __state.appliedEdits) {
    for (const [, edits] of e.entries ? e.entries() : []) for (const x of edits) out.push(String(x.newText || ""));
  }
  return out;
};

const allSnippets = (editor) =>
  __state.snippetInserts.concat(editor ? editor.__snippets : []).map((s) => ({ uri: s.uri, value: String(s.value || "") }));

// ---------------------------------------------------------------------------
// Drive helpers.
// ---------------------------------------------------------------------------

const ACCEPT_RE = /^(accept|apply|insert|create|write|yes|ok|generate|continue|proceed)\b/i;
const REJECT_RE = /^(reject|discard|cancel|no|dismiss|not now)\b/i;
const labelOf = (a) => (typeof a === "string" ? a : a && a.title ? a.title : "");

const answerAccept = (kind, message, actions) => {
  const hit = (actions || []).find((a) => ACCEPT_RE.test(labelOf(a)));
  return hit;
};
const answerReject = (kind, message, actions) => {
  const hit = (actions || []).find((a) => REJECT_RE.test(labelOf(a)));
  return hit; // undefined when there is no explicit reject: dismissing IS rejecting
};
const pickAccept = (items) => (items || []).find((i) => ACCEPT_RE.test(labelOf(i) || (i && i.label) || ""));

const resetDrive = (handlers, docs, editor, answer, answerPick) => {
  __state.commandHandlers = handlers || {};
  __state.messages.length = 0;
  __state.executeCalls.length = 0;
  __state.appliedEdits.length = 0;
  __state.editorEdits.length = 0;
  __state.snippetInserts.length = 0;
  __state.openedDocs.length = 0;
  __state.shownDocs.length = 0;
  __state.fsWrites.length = 0;
  __state.picks.length = 0;
  __state.answer = answer || null;
  __state.answerPick = answerPick || null;
  globalThis.__V31_DOCS__ = docs || {};
  __state.activeTextEditor = editor;
  __state.textDocuments = editor ? [editor.document] : [];
  __state.visibleTextEditors = editor ? [editor] : [];
  serverRef.requests.length = 0;
  serverRef.replyFor = null;
};

const diag = () =>
  `messages=${JSON.stringify(__state.messages.map((m) => m.kind + ": " + m.message))} lastLog=${JSON.stringify(__state.outputLines.slice(-10))}`;

// Drive a gesture to settlement, then report everything the contracts here
// constrain. Settlement is raced against a generation request because a
// preview path may park on UI the stub cannot supply; the extra wait gives
// the preview and any post-accept write time to land.
async function driveSettled(commandId, opts) {
  const { doc, cursor, handlers, docs, reply, answer, answerPick, settleMs = 4000 } = opts;
  await harness();
  const editor = makeEditor(doc, cursor);
  const logMark = __state.outputLines.length;
  resetDrive(handlers, docs, editor, answer, answerPick);
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
  await waitFor(
    () => cmdSettled || serverRef.requests.some((r) => r.url === "/api/generate"),
    `${commandId} to settle or reach the generation service`
  );
  await waitFor(() => cmdSettled, `${commandId} to settle`, Math.ceil(settleMs / 25), true);
  await sleep(250);
  return {
    editor,
    cmdError,
    genRequests: serverRef.requests.filter((r) => r.url === "/api/generate"),
    messages: __state.messages.slice(),
    texts: __state.messages.map((m) => String(m.message)),
    logs: __state.outputLines.slice(logMark),
    editorEdits: editor.__edits.length + __state.editorEdits.length,
    snippetInserts: allSnippets(editor),
    appliedEdits: __state.appliedEdits.length,
    fsWrites: __state.fsWrites.slice(),
    shown: await shownSurfaces(),
    written: writtenSurfaces(editor),
  };
}


// ---------------------------------------------------------------------------
// Fixtures. One project per (language, documented?, returns?) so every drive
// has its own placement and no two functions share a file. Each project is the
// smallest shape its leg's placement and framework detection accept, copied in
// kind from blind-v31-wiring (go.mod, a vitest package.json, pytest testpaths,
// the MSTest peer project, a Cargo.toml).
// ---------------------------------------------------------------------------

const SPEC = {
  rust: {
    val: { name: "total_mass", sig: "pub fn total_mass(w: u64) -> u64", doc: "/// Sums the widget mass.", body: ["    0"] },
    void: { name: "log_mass", sig: "pub fn log_mass(w: u64)", doc: "/// Logs the widget mass.", body: ["    let _ = w;"] },
  },
  go: {
    val: { name: "AggregateFanout", sig: "func AggregateFanout(n int) int", doc: "// AggregateFanout returns the fan-out for n shards.", body: ["\treturn 0"] },
    void: { name: "Flush", sig: "func Flush(n int)", doc: "// Flush flushes n shards.", body: ["\t_ = n"] },
  },
  typescript: {
    val: { name: "readOrder", sig: "export function readOrder(o: number): number", doc: "/** Reads the order total. */", body: ["\treturn 0;"] },
    void: { name: "logOrder", sig: "export function logOrder(o: number): void", doc: "/** Logs the order total. */", body: ["\tvoid o;"] },
  },
  python: {
    val: { name: "read_order", sig: "def read_order(order: int) -> int", doc: '    """Reads the order total."""', body: ["    return 0"] },
    void: { name: "log_order", sig: "def log_order(order: int) -> None", doc: '    """Logs the order total."""', body: ["    print(order)"] },
  },
  csharp: {
    val: { name: "ReadOrder", sig: "public static int ReadOrder(int o)", doc: "/// <summary>Reads the order total.</summary>", body: ["            return 0;"] },
    void: { name: "LogOrder", sig: "public static void LogOrder(int o)", doc: "/// <summary>Logs the order total.</summary>", body: ["            _ = o;"] },
  },
};
const IDS = ["rust", "go", "typescript", "python", "csharp"];

// Builds the source text, writes the project, returns everything a drive needs.
function buildFixture(id, shape, documented) {
  const s = SPEC[id][shape];
  const dir = `${id}-${shape}-${documented ? "doc" : "nodoc"}`;
  let text;
  let file;
  if (id === "rust") {
    w(`${dir}/Cargo.toml`, '[package]\nname = "probe"\nversion = "0.1.0"\nedition = "2021"\n');
    text = (documented ? s.doc + "\n" : "") + `${s.sig} {\n${s.body.join("\n")}\n}\n`;
    file = w(`${dir}/src/lib.rs`, text);
  } else if (id === "go") {
    w(`${dir}/go.mod`, "module probe\n\ngo 1.22\n");
    text = `package atlas\n\n` + (documented ? s.doc + "\n" : "") + `${s.sig} {\n${s.body.join("\n")}\n}\n`;
    file = w(`${dir}/atlas.go`, text);
  } else if (id === "typescript") {
    w(
      `${dir}/package.json`,
      JSON.stringify({ name: "probe", version: "0.0.0", scripts: { test: "vitest run" }, devDependencies: { vitest: "^4.1.7" } }, null, 2) + "\n"
    );
    text = (documented ? s.doc + "\n" : "") + `${s.sig} {\n${s.body.join("\n")}\n}\n`;
    file = w(`${dir}/src/orders.ts`, text);
  } else if (id === "python") {
    w(`${dir}/pyproject.toml`, '[tool.pytest.ini_options]\ntestpaths = ["tests"]\n');
    fs.mkdirSync(path.join(ROOT, dir, "tests"), { recursive: true });
    text = `${s.sig}:\n` + (documented ? s.doc + "\n" : "") + `${s.body.join("\n")}\n`;
    file = w(`${dir}/orders.py`, text);
  } else {
    w(`${dir}/Orders/Orders.csproj`, `<Project Sdk="Microsoft.NET.Sdk">\n  <PropertyGroup><TargetFramework>net10.0</TargetFramework></PropertyGroup>\n</Project>\n`);
    w(
      `${dir}/Orders.Tests/Orders.Tests.csproj`,
      `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <IsTestProject>true</IsTestProject>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Microsoft.NET.Test.Sdk" Version="18.0.0" />
    <PackageReference Include="MSTest" Version="4.0.1" />
  </ItemGroup>
  <ItemGroup>
    <ProjectReference Include="..\\Orders\\Orders.csproj" />
  </ItemGroup>
</Project>
`
    );
    text =
      "namespace Orders\n{\n    public class Ledger\n    {\n" +
      (documented ? "        " + s.doc + "\n" : "") +
      `        ${s.sig}\n        {\n${s.body.join("\n")}\n        }\n    }\n}\n`;
    file = w(`${dir}/Orders/Orders.cs`, text);
  }
  return { id, shape, documented, spec: s, text, file };
}

// Document symbols the way a language server hands them over: the function's
// range covers its doc comment when there is one (Python's docstring is inside
// the body anyway), and C# nests the method in its namespace and class.
function symbolsFor(fx) {
  const lines = fx.text.split("\n");
  const sigPos = posOf(fx.text, fx.spec.sig);
  const nameCh = lines[sigPos.line].indexOf(fx.spec.name, sigPos.character);
  const sel = vr(sigPos.line, nameCh, sigPos.line, nameCh + fx.spec.name.length);
  const docAbove = fx.documented && fx.id !== "python";
  const start = docAbove ? sigPos.line - 1 : sigPos.line;
  if (fx.id === "csharp") {
    const end = sigPos.line + 3;
    const last = lines.length - 2;
    return [
      dsym("Orders", 2, vr(0, 0, last, 1), vr(0, 10, 0, 16), [
        dsym("Ledger", 4, vr(2, 4, last - 1, 5), vr(2, 17, 2, 23), [
          dsym(fx.spec.name, 5, vr(start, 8, end, 9), sel),
        ]),
      ]),
    ];
  }
  let end = lines.length - 1;
  while (end > 0 && lines[end].trim() === "") end--;
  return [dsym(fx.spec.name, 11, vr(start, 0, end, lines[end].length), sel)];
}

const fence = (lang, body) => "```" + lang + "\n" + body + "\n```";
const REPLY = {
  rust: () => fence("rust", "#[cfg(test)]\nmod tests {\n    use super::*;\n\n    #[test]\n    fn sums() { assert_eq!(total_mass(1), 4242424); }\n}"),
  go: () => fence("go", "func TestAggregateFanoutHappy(t *testing.T) {\n\tgot := AggregateFanout(3)\n\twant := 4242424\n\tif got != want {\n\t\tt.Errorf(\"got %d, want %d\", got, want)\n\t}\n}"),
  typescript: () => fence("typescript", "describe('readOrder', () => {\n  it('reads', () => {\n    expect(readOrder(3)).toBe(4242424);\n  });\n});"),
  python: () => fence("python", "def test_read_order_happy():\n    assert read_order(3) == 4242424"),
  csharp: () => fence("csharp", "[TestMethod]\npublic void ReadOrderHappy()\n{\n    Assert.AreEqual(4242424, Ledger.ReadOrder(3));\n}"),
};

// One memoized drive per fixture; several rows read the same drive.
const drives = {};
const drive = (id, shape, documented) => {
  const key = `${id}/${shape}/${documented}`;
  return (drives[key] ||= (async () => {
    const fx = buildFixture(id, shape, documented);
    const doc = makeDoc(fx.text, fx.file, id);
    const r = await driveSettled("column80.generateTests", {
      doc,
      cursor: posOf(fx.text, fx.spec.body[0]),
      handlers: emptyHandlers(symbolsFor(fx)),
      docs: { ["file://" + fx.file]: doc },
      reply: REPLY[id],
      answer: answerReject,
    });
    return { fx, r };
  })());
};

// Every string the backend was handed, wherever the request put it.
const strings = (v, acc = []) => {
  if (typeof v === "string") acc.push(v);
  else if (Array.isArray(v)) for (const x of v) strings(x, acc);
  else if (v && typeof v === "object") for (const k of Object.keys(v)) strings(v[k], acc);
  return acc;
};
const promptOf = (r) => r.genRequests.map((q) => strings(q.body).join("\n")).join("\n=====\n");

const refusals = (r) => r.texts.filter((t) => /no tests generated|refus|cannot|can't|no contract/i.test(t));
const DOC_BLAME = /doc comment|docstring|`\/\/\/`|no contract/i;
const show = (r) => `MESSAGES: ${JSON.stringify(r.texts)}\nCHANNEL: ${JSON.stringify(r.logs.filter((l) => /\[tdd\]/.test(l)).slice(-8))}\nMODEL CALLS: ${r.genRequests.length}`;

// ===========================================================================
// FACADE rows: column80.generateTests, end to end, model calls counted at the
// fake backend.
// ===========================================================================

for (const id of IDS) {
  gtest(`facade (${id}) guard: a DOCUMENTED value-returning function reaches the backend [harness guard: the rig can produce a model call, so a red undocumented row is the gate, not the rig]`, async () => {
    const { r } = await drive(id, "val", true);
    assert.strictEqual(r.cmdError, undefined, `the command threw: ${r.cmdError && r.cmdError.stack}`);
    assert.ok(r.genRequests.length >= 1, `documented control made no model call.\n${show(r)}`);
  });

  gtest(`facade (${id}) contract 1: an UNDOCUMENTED value-returning function is attempted - the backend is called, and no refusal blames the missing doc comment`, async () => {
    const { r } = await drive(id, "val", false);
    assert.strictEqual(r.cmdError, undefined, `the command threw: ${r.cmdError && r.cmdError.stack}`);
    const blamed = refusals(r).filter((t) => DOC_BLAME.test(t));
    assert.deepStrictEqual(blamed, [], `the gesture refused over the missing doc comment.\n${show(r)}`);
    assert.ok(r.genRequests.length >= 1, `no model call for an undocumented function with a value to assert.\n${show(r)}`);
  });

  gtest(`facade (${id}) contract 3: the undocumented prompt names the function and its signature, and carries no empty doc/contract block`, async () => {
    const { fx, r } = await drive(id, "val", false);
    if (r.genRequests.length === 0) assert.fail(`no prompt to inspect: the gesture never called the backend (contract 1 is red).\n${show(r)}`);
    const p = promptOf(r);
    const { r: rDoc } = await drive(id, "val", true);
    const pDoc = promptOf(rDoc);
    assert.ok(p.includes(fx.spec.name), `the prompt does not name ${fx.spec.name}.\n---- PROMPT ----\n${p}`);
    assert.ok(p.includes(fx.spec.sig), `the prompt does not carry the signature ${JSON.stringify(fx.spec.sig)}.\n---- PROMPT ----\n${p}`);
    assert.ok(!/```[\w#+-]*[ \t]*\n\s*```/.test(p), `the prompt carries an empty fenced block.\n---- PROMPT ----\n${p}`);
    const lines = p.split("\n");
    for (let i = 0; i < lines.length - 1; i++) {
      if (!/\b(doc(umentation)?[ -]?comments?|docstrings?|contract)\b[^\n]*:\s*$/i.test(lines[i])) continue;
      const next = lines[i + 1].trim();
      assert.ok(
        !(next === "" || /^(-{3,}|={3,}|```)$/.test(next) || next === "undefined"),
        `line ${i + 1} opens a doc/contract section that is empty: ${JSON.stringify(lines[i])} then ${JSON.stringify(lines[i + 1])}.\n---- PROMPT ----\n${p}`
      );
    }
    const undef = (s) => (s.match(/\bundefined\b/g) || []).length;
    assert.ok(undef(p) <= undef(pDoc), `the undocumented prompt says "undefined" more often than its documented twin: a missing doc rendered as a value.\n---- PROMPT ----\n${p}`);
    assert.ok(!p.includes(fx.spec.doc.trim()), `the undocumented prompt carries doc text that is not in the file.\n---- PROMPT ----\n${p}`);
  });

  gtest(`facade (${id}) contract 2: an UNDOCUMENTED function with no value to assert is still refused, with no model call`, async () => {
    const { r } = await drive(id, "void", false);
    assert.strictEqual(r.cmdError, undefined, `the command threw: ${r.cmdError && r.cmdError.stack}`);
    assert.strictEqual(r.genRequests.length, 0, `a function with nothing to assert reached the backend.\n${show(r)}`);
    assert.ok(refusals(r).length >= 1, `no refusal was shown.\n${show(r)}`);
  });

  gtest(`facade (${id}) contract 2: the undocumented no-value refusal is the SAME sentence its documented twin gets, and does not blame the doc comment`, async () => {
    const { r: rDoc } = await drive(id, "void", true);
    const { r } = await drive(id, "void", false);
    assert.strictEqual(rDoc.genRequests.length, 0, `documented no-value twin reached the backend, so it cannot anchor this row.\n${show(rDoc)}`);
    const want = refusals(rDoc);
    assert.ok(want.length >= 1, `documented no-value twin shows no refusal to compare against.\n${show(rDoc)}`);
    assert.deepStrictEqual(refusals(r), want, `undocumented refusal differs from the documented twin's.\nUNDOCUMENTED ${show(r)}\nDOCUMENTED ${show(rDoc)}`);
    assert.ok(!refusals(r).some((t) => DOC_BLAME.test(t)), `the refusal blames the doc comment.\n${show(r)}`);
  });
}

// ===========================================================================
// GATE rows: the per-language classifier, twin against twin.
// ===========================================================================

const DOC_FOR = {
  rust: "/// Does the thing.",
  go: "// Thing does the thing.",
  typescript: "/** Does the thing. */",
  python: "Does the thing.",
  csharp: "/// <summary>Does the thing.</summary>",
};

// Signatures whose refusal has nothing to do with a doc comment.
const OTHER_REFUSALS = {
  rust: ["pub fn read_all(f: File) -> u64", "pub fn get(&self) -> u64", "pub async fn fetch(k: u64) -> u64"],
  go: ["func (s *Store) Get(k string) int"],
  typescript: ["function readOrder(o: number): number"],
  python: ["def get(self, k: int) -> int:"],
  csharp: ["private static int ReadOrder(int o)", "public int Get(int k)"],
};

const verdict = (id, sig, doc) => tddLangFor(id).classifyTestability(sig, doc);

for (const id of IDS) {
  const val = SPEC[id].val.sig + (id === "python" ? ":" : "");
  const none = SPEC[id].void.sig + (id === "python" ? ":" : "");

  gtest(`gate (${id}) contract 1: classifyTestability admits an undocumented value-returning signature (doc undefined and doc "")`, () => {
    for (const doc of [undefined, ""]) {
      const v = verdict(id, val, doc);
      assert.strictEqual(v.testable, true, `${JSON.stringify(val)} with doc=${JSON.stringify(doc)}: ${JSON.stringify(v)}`);
    }
    assert.strictEqual(verdict(id, val, DOC_FOR[id]).testable, true, `documented control is not testable, so the row cannot judge: ${JSON.stringify(verdict(id, val, DOC_FOR[id]))}`);
  });

  gtest(`gate (${id}) contract 2: an undocumented no-value signature gets its documented twin's refusal, byte for byte`, () => {
    const want = verdict(id, none, DOC_FOR[id]);
    assert.strictEqual(want.testable, false, `documented no-value twin is not refused: ${JSON.stringify(want)}`);
    for (const doc of [undefined, ""]) {
      assert.deepStrictEqual(verdict(id, none, doc), want, `${JSON.stringify(none)} doc=${JSON.stringify(doc)}`);
    }
  });

  gtest(`gate (${id}) contract 2: every other refusal is unchanged - undocumented twin equals documented twin`, () => {
    for (const sig of OTHER_REFUSALS[id]) {
      const want = verdict(id, sig, DOC_FOR[id]);
      assert.strictEqual(want.testable, false, `fixture defect: documented ${JSON.stringify(sig)} is not a refusal: ${JSON.stringify(want)}`);
      for (const doc of [undefined, ""]) {
        assert.deepStrictEqual(verdict(id, sig, doc), want, `${JSON.stringify(sig)} doc=${JSON.stringify(doc)}`);
      }
    }
  });
}
