// BLIND ORACLE - "localSymbols per-language + unregistered-language honest
// gate". Black-box: never reads src/**. Two contracts, both observed through
// the blind-v9-gestures harness family (the whole extension activated against
// a stub vscode, prompts captured at a fake in-process Ollama server, buffer
// mutation channels RECORDED per the blind-derust-tdd stub):
//
//  A. localSymbols per-language (fn-gen prompt, injection enabled, driving
//     column80.generateFunction). When the target's signature/doc references
//     names DEFINED at the top level of the SAME file, the prompt carries an
//     already-in-scope section ("... defined in this file and are already in
//     scope: ...") naming those definitions:
//      1. TypeScript: top-level `export function helper`, `export class
//         Widget`, `interface Order`, `export const RATE`; target
//         `export function readOrder(o: Order): number` with a JSDoc naming
//         `Widget` in backticks. The section must appear, name Order and
//         Widget, and its wording must be language-neutral - never the Rust
//         phrase "use import" (neutral: e.g. "do NOT add an import").
//         Negative guard: helper and RATE are referenced by NOTHING and must
//         not appear in the section.
//      2. Python: top-level `def helper` and `class Cohort:`; target
//         `def read_cohort(c: Cohort) -> int:` whose doc (a `#` comment above
//         AND a docstring - both carried so either doc channel suffices)
//         backtick-references `helper`. Section names Cohort and helper; same
//         neutral-wording rule.
//      3. C#: the section NEVER appears, whatever the file contains (the
//         mechanism is deliberately dark for C#). Frozen guard.
//      4. Rust smoke: a target referencing a same-file `pub struct` still
//         gets the section (unchanged mechanism; the full rust leg is pinned
//         by the blind-v5 suites).
//
//  B. Unregistered-language honest gate (column80.generateFunction):
//      5. On a document whose languageId is NOT registered (rust, typescript,
//         typescriptreact, javascript, javascriptreact, csharp, python) -
//         "go" here - the command shows exactly ONE user-facing message that
//         names the language and says generation is not supported for it,
//         makes NO model request, and never modifies the buffer.
//      6. Registered-language smoke: the same drive on a typescript document
//         shows no such message and DOES reach the generation service.
//
// Expected today: A-1/A-2 RED (the mechanism is Rust-only); A-3 GREEN (frozen
// guard); A-4 GREEN; B-5 RED (no gate exists); B-6 GREEN.
//
// Run: SKIP_LIVE=1 node --test test/blind-derust-localsyms-gate.test.cjs
// (Hermetic: the "server" is in-process; no model, no network, no ollama.)

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const http = require("node:http");
const esbuild = require("esbuild");

// ---------------------------------------------------------------------------
// The vscode stub (blind-derust-tdd shape). Everything activation touches is
// recorded into __state or a safe no-op. Buffer-mutation channels the gate
// contract forbids are RECORDED, never just swallowed: workspace.applyEdit,
// and edit/insertSnippet on any editor the stub hands out.
// ---------------------------------------------------------------------------

const STUB = path.join(__dirname, ".blind-derust-localsyms-gate-stub.cjs");
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
      const docs = globalThis.__LSGATE_DOCS__ || {};
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

const entry = path.join(__dirname, ".blind-derust-localsyms-gate.entry.ts");
const outfile = path.join(__dirname, ".blind-derust-localsyms-gate.bundle.cjs");
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
// Fake Ollama server: the prompt-capture / no-request observation point.
// /api/tags reports every configured model present, so no model gate can
// honestly refuse; on the "go" document the LANGUAGE is the only honest gate.
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
// One-time activation (blind-v9-gestures config shape; injection enabled).
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
      globalStorageUri: Uri.file("/tmp/blind-derust-localsyms-gate-storage"),
      logUri: Uri.file("/tmp/blind-derust-localsyms-gate-log"),
      environmentVariableCollection: { replace() {}, append() {}, prepend() {}, clear() {} },
    };
    await activate(context);
    await waitFor(() => typeof __state.commands["column80.generateFunction"] === "function", "generateFunction registration");
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
// edit/insertSnippet so a buffer mutation on the gate path is observable).
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
const posOf = (text, needle) => {
  const idx = text.indexOf(needle);
  assert.ok(idx >= 0, `fixture needle not found: ${JSON.stringify(needle)}`);
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
// Drive helpers (blind-derust family shapes).
// ---------------------------------------------------------------------------

const resetDrive = (handlers, docs, editor) => {
  __state.commandHandlers = handlers || {};
  __state.messages.length = 0;
  __state.executeCalls.length = 0;
  __state.appliedEdits.length = 0;
  __state.editorEdits.length = 0;
  __state.snippetInserts.length = 0;
  globalThis.__LSGATE_DOCS__ = docs || {};
  __state.activeTextEditor = editor;
  __state.textDocuments = editor ? [editor.document] : [];
  __state.visibleTextEditors = editor ? [editor] : [];
  serverRef.requests.length = 0;
  serverRef.replyFor = null;
};

const diag = () =>
  `messages=${JSON.stringify(__state.messages)} lastLog=${JSON.stringify(__state.outputLines.slice(-6))}`;

const fireCommand = (commandId) => {
  const cmd = __state.commands[commandId];
  assert.strictEqual(typeof cmd, "function", `${commandId} must be registered`);
  const status = { settled: false, error: undefined };
  Promise.resolve()
    .then(() => cmd())
    .then(
      () => { status.settled = true; },
      (e) => { status.error = e; status.settled = true; }
    );
  return status;
};

const genRequests = () => serverRef.requests.filter((r) => r.url === "/api/generate");

// Drive a gesture; return the FIRST captured /api/generate prompt (the initial
// fn-gen prompt, never a later circle-back). Capture-driven, never awaited to
// completion: proposal UI the stub never supplies is out of scope here.
async function driveGesture(commandId, { doc, cursor, handlers, docs, reply }) {
  await harness();
  resetDrive(handlers, docs, makeEditor(doc, cursor));
  serverRef.replyFor = reply || null;
  const status = fireCommand(commandId);
  await waitFor(
    () => status.settled || genRequests().length > 0,
    `a generation request from ${commandId}`,
    400,
    true
  );
  assert.ok(
    genRequests().length > 0,
    `${commandId} never reached the generation service; cmdError=${status.error && status.error.message}; ${diag()}`
  );
  return genRequests()[0].body.prompt;
}

// Drive a gesture to SETTLEMENT (the gate path must complete), then report
// everything the gate contract constrains.
async function driveSettled(commandId, { doc, cursor, handlers, docs, reply }) {
  await harness();
  const editor = makeEditor(doc, cursor);
  resetDrive(handlers, docs, editor);
  serverRef.replyFor = reply || null;
  const status = fireCommand(commandId);
  // A generating path may park on UI the stub never supplies (accept/reject),
  // so settlement is raced against a generation request - either observation
  // is a complete drive for the contracts pinned here.
  await waitFor(
    () => status.settled || genRequests().length > 0,
    `${commandId} to settle or reach the generation service`
  );
  // Let trailing async work (a second message, a late request) land before
  // the exactly-one / exactly-none assertions read the recorders.
  await sleep(150);
  return {
    cmdError: status.error,
    genRequests: genRequests(),
    messages: __state.messages.slice(),
    editorEdits: editor.__edits.length + __state.editorEdits.length,
    snippetInserts: editor.__snippets.length + __state.snippetInserts.length,
    appliedEdits: __state.appliedEdits.length,
  };
}

const emptyHandlers = (symbols) => ({
  "vscode.executeDocumentSymbolProvider": () => symbols,
  "vscode.executeDefinitionProvider": () => undefined,
  "vscode.executeHoverProvider": () => undefined,
  "vscode.executeCompletionItemProvider": () => undefined,
  "vscode.executeCodeActionProvider": () => undefined,
});

// ---------------------------------------------------------------------------
// The already-in-scope section: located by its stable wording anchor (the
// contract's section reads "The following names are defined in this file and
// are already in scope: ..."), captured as the anchor line plus any adjacent
// non-blank non-fence lines (a wrapped name list stays inside the chunk).
// Name assertions run against THE CHUNK only - the signature fence also names
// Order/Cohort, so a whole-prompt includes() would pass trivially and prove
// nothing (the blind-v5-promptleg lesson).
// ---------------------------------------------------------------------------

const SECTION_RE = /defined in this file|in scope/i;
const inScopeSection = (prompt) => {
  const lines = prompt.split("\n");
  const i = lines.findIndex((l) => SECTION_RE.test(l));
  if (i === -1) return undefined;
  const chunk = [lines[i]];
  for (let j = i + 1; j < lines.length && lines[j].trim() !== "" && !lines[j].startsWith("```"); j++) {
    chunk.push(lines[j]);
  }
  return chunk.join("\n");
};

// The Rust-flavored phrase the neutral wording must not carry: "use import"
// (with or without backticks around `use`, singular or plural). Neutral
// wording (e.g. "do NOT add an import") never matches.
const RUST_USE_RE = /`?use`?\s+imports?/i;

// ---------------------------------------------------------------------------
// Contract A fixtures. Extraction beyond document symbols answers undefined
// (the blind-v9 "empty" mode): nothing cross-file resolves, so the same-file
// localSymbols leg is the only thing that can put the section in the prompt.
// Full top-level symbol lists are served so a symbol-driven OR a text-scan
// implementation both see every definition.
// ---------------------------------------------------------------------------

const nameRangeIn = (text, line, name) => {
  const ch = text.split("\n")[line].indexOf(name);
  return vr(line, ch, line, ch + name.length);
};

// TS: Order referenced by the signature, Widget backtick-referenced by the
// JSDoc; helper and RATE referenced by NOTHING (the negative guard). The
// target symbol uses the REAL TS range shape (JSDoc OUTSIDE the range), the
// shape the blind-v9 doc-channel pin proved green.
const TS_URI = "file:///proj/src/order_board.ts";
const TS_TEXT = `export function helper(n: number): number {
  return n * 2;
}

export class Widget {
  label = "";
}

interface Order {
  total: number;
}

export const RATE = 3;

/** Sums each \`Widget\` line item. */
export function readOrder(o: Order): number {

}
`;
const tsFixture = (uri) => {
  const helper = posOf(TS_TEXT, "export function helper");
  const widget = posOf(TS_TEXT, "export class Widget");
  const order = posOf(TS_TEXT, "interface Order");
  const rate = posOf(TS_TEXT, "export const RATE");
  const target = posOf(TS_TEXT, "export function readOrder");
  return {
    doc: makeDoc(TS_TEXT, uri, "typescript"),
    cursor: new Position(target.line + 1, 0),
    symbols: [
      dsym("helper", 11, vr(helper.line, 0, helper.line + 2, 1), nameRangeIn(TS_TEXT, helper.line, "helper")),
      dsym("Widget", 4, vr(widget.line, 0, widget.line + 2, 1), nameRangeIn(TS_TEXT, widget.line, "Widget")),
      dsym("Order", 10, vr(order.line, 0, order.line + 2, 1), nameRangeIn(TS_TEXT, order.line, "Order")),
      dsym("RATE", 12, vr(rate.line, 0, rate.line, TS_TEXT.split("\n")[rate.line].length), nameRangeIn(TS_TEXT, rate.line, "RATE")),
      dsym("readOrder", 11, vr(target.line, 0, target.line + 2, 1), nameRangeIn(TS_TEXT, target.line, "readOrder")),
    ],
  };
};
const tsReply = () => "```typescript\nexport function readOrder(o: Order): number {\n  return 0;\n}\n```";

// Python: Cohort referenced by the signature, helper backtick-referenced by
// the doc. The doc channel for python is range-to-head trivia (the real
// Pylance shape pinned by blind-v11-pycursor: a decorated def's symbol range
// starts at the DECORATOR line, and a `#` comment between decorator and def
// rides the trivia into the doc channel). So the target is decorated, the `#`
// doc sits between decorator and def, and the symbol range starts at the
// decorator. The docstring is a belt-and-braces duplicate, not load-bearing.
const PY_URI = "file:///proj/src/cohorts.py";
const PY_TEXT = `def helper(n):
    return n * 2


class Cohort:
    def __init__(self):
        self.members = []


@cache
# Counts members gathered by \`helper\`.
def read_cohort(c: Cohort) -> int:
    """Counts members gathered by \`helper\`."""

`;
const pyFixture = (uri) => {
  const helper = posOf(PY_TEXT, "def helper");
  const cohort = posOf(PY_TEXT, "class Cohort:");
  const init = posOf(PY_TEXT, "def __init__");
  const deco = posOf(PY_TEXT, "@cache");
  const target = posOf(PY_TEXT, "def read_cohort");
  return {
    doc: makeDoc(PY_TEXT, uri, "python"),
    cursor: new Position(target.line + 2, 4),
    symbols: [
      dsym("helper", 11, vr(helper.line, 0, helper.line + 1, 16), nameRangeIn(PY_TEXT, helper.line, "helper")),
      dsym("Cohort", 4, vr(cohort.line, 0, cohort.line + 2, 25), nameRangeIn(PY_TEXT, cohort.line, "Cohort"), [
        dsym("__init__", 5, vr(init.line, 4, init.line + 1, 25), nameRangeIn(PY_TEXT, init.line, "__init__")),
      ]),
      dsym("read_cohort", 11, vr(deco.line, 0, target.line + 2, 4), nameRangeIn(PY_TEXT, target.line, "read_cohort")),
    ],
  };
};
const pyReply = () => "```python\ndef read_cohort(c: Cohort) -> int:\n    return len(c.members)\n```";

// C#: the file HAS a top-level type the signature references (Basket), so if
// the mechanism ever half-fires on csharp this fixture catches it.
const CS_URI = "file:///proj/src/Weighing.cs";
const CS_TEXT = `namespace P;

public class Basket
{
    public int Weight;
}

public class Scales
{
    /// <summary>Weighs a Basket.</summary>
    public int Weigh(Basket b)
    {

    }
}
`;
const csFixture = (uri) => {
  const basket = posOf(CS_TEXT, "public class Basket");
  const weight = posOf(CS_TEXT, "public int Weight;");
  const scales = posOf(CS_TEXT, "public class Scales");
  const weigh = posOf(CS_TEXT, "public int Weigh(");
  return {
    doc: makeDoc(CS_TEXT, uri, "csharp"),
    cursor: new Position(weigh.line + 2, 8),
    symbols: [
      dsym("Basket", 4, vr(basket.line, 0, basket.line + 3, 1), nameRangeIn(CS_TEXT, basket.line, "Basket"), [
        dsym("Weight", 7, vr(weight.line, 4, weight.line, 22), nameRangeIn(CS_TEXT, weight.line, "Weight")),
      ]),
      dsym("Scales", 4, vr(scales.line, 0, CS_TEXT.split("\n").length - 2, 1), nameRangeIn(CS_TEXT, scales.line, "Scales"), [
        dsym("Weigh", 5, vr(weigh.line, 4, weigh.line + 3, 5), nameRangeIn(CS_TEXT, weigh.line, "Weigh")),
      ]),
    ],
  };
};
const csReply = () => "```csharp\npublic int Weigh(Basket b)\n{\n    return b.Weight;\n}\n```";

// Rust smoke: Manifest is a same-file pub struct named in the signature. The
// target symbol range INCLUDES the doc line (the rust-analyzer shape the doc
// scanner is calibrated against, per the blind-v9 fixture convention).
const RUST_URI = "file:///proj/src/manifest.rs";
const RUST_TEXT = `pub struct Manifest {
    pub entries: u32,
}

/// Seals the given Manifest.
fn seal(m: &Manifest) -> u64 {

}
`;
const rustFixture = (uri) => {
  const manifest = posOf(RUST_TEXT, "pub struct Manifest");
  const target = posOf(RUST_TEXT, "fn seal");
  return {
    doc: makeDoc(RUST_TEXT, uri, "rust"),
    cursor: new Position(target.line + 1, 0),
    symbols: [
      dsym("Manifest", 22, vr(manifest.line, 0, manifest.line + 2, 1), nameRangeIn(RUST_TEXT, manifest.line, "Manifest")),
      dsym("seal", 11, vr(target.line - 1, 0, target.line + 2, 1), nameRangeIn(RUST_TEXT, target.line, "seal")),
    ],
  };
};
const rustReply = () => "```rust\nfn seal(m: &Manifest) -> u64 {\n    m.entries as u64\n}\n```";

// Go (unregistered): a real documented function with resolvable symbols, so
// the LANGUAGE gate is the only honest reason to refuse.
const GO_URI = "file:///proj/src/ledger.go";
const GO_TEXT = `package main

// TotalLedger sums the ledger entries.
func TotalLedger(entries []int) int {

}
`;
const goFixture = (uri) => {
  const target = posOf(GO_TEXT, "func TotalLedger");
  return {
    doc: makeDoc(GO_TEXT, uri, "zig"),
    cursor: new Position(target.line + 1, 0),
    symbols: [
      dsym("TotalLedger", 11, vr(target.line, 0, target.line + 2, 1), nameRangeIn(GO_TEXT, target.line, "TotalLedger")),
    ],
  };
};

// Lazy one-shot drives; every assertion group reads the same drive.
const driveCache = {};
const capturedPrompt = (lang) =>
  (driveCache[lang] ||= (async () => {
    const cases = {
      typescript: { fixture: tsFixture, uri: TS_URI, reply: tsReply },
      python: { fixture: pyFixture, uri: PY_URI, reply: pyReply },
      csharp: { fixture: csFixture, uri: CS_URI, reply: csReply },
      rust: { fixture: rustFixture, uri: RUST_URI, reply: rustReply },
    };
    const c = cases[lang];
    const fix = c.fixture(c.uri);
    return driveGesture("column80.generateFunction", {
      doc: fix.doc,
      cursor: fix.cursor,
      handlers: emptyHandlers(fix.symbols),
      docs: { [c.uri]: fix.doc },
      reply: c.reply,
    });
  })());

// ===========================================================================
// A-1. TypeScript: the section fires and is neutral. RED today (the mechanism
// is Rust-only; if it half-fires on TS, the content/wording pins go red).
// ===========================================================================

gtest("A1 fn-gen TS: the already-in-scope section appears and names the referenced same-file definitions (Order from the signature, Widget from the backticked JSDoc)", async () => {
  const prompt = await capturedPrompt("typescript");
  const section = inScopeSection(prompt);
  assert.ok(
    section,
    `a TS target whose signature/doc references same-file top-level definitions must get the already-in-scope section. PROMPT:\n${prompt}`
  );
  assert.ok(/\bOrder\b/.test(section), `the signature-referenced interface Order is named IN the section. SECTION:\n${section}`);
  assert.ok(/\bWidget\b/.test(section), `the JSDoc-backtick-referenced class Widget is named IN the section. SECTION:\n${section}`);
});

gtest("A1 fn-gen TS: the section wording is language-neutral - never the Rust phrase \"use import\"", async () => {
  const prompt = await capturedPrompt("typescript");
  const section = inScopeSection(prompt);
  assert.ok(section, `the section must exist to carry the neutral wording. PROMPT:\n${prompt}`);
  assert.ok(
    !RUST_USE_RE.test(section),
    `a TS section must not speak Rust ("use import"); neutral wording only (e.g. "do NOT add an import"). SECTION:\n${section}`
  );
});

gtest("A1 negative guard fn-gen TS: top-level names referenced by NOTHING (helper, RATE) never appear in the section", async () => {
  const prompt = await capturedPrompt("typescript");
  const section = inScopeSection(prompt);
  // No section today is a vacuous pass here (A1's presence pin carries the
  // red); once the section exists this guard bites: referenced names only.
  if (section === undefined) return;
  assert.ok(!/\bhelper\b/.test(section), `unreferenced top-level helper leaked into the section. SECTION:\n${section}`);
  assert.ok(!/\bRATE\b/.test(section), `unreferenced top-level RATE leaked into the section. SECTION:\n${section}`);
});

// ===========================================================================
// A-2. Python: the section fires and is neutral. RED today.
// ===========================================================================

gtest("A2 fn-gen Python: the already-in-scope section appears and names Cohort (signature) and helper (backticked doc reference)", async () => {
  const prompt = await capturedPrompt("python");
  const section = inScopeSection(prompt);
  assert.ok(
    section,
    `a python target whose signature/doc references same-file top-level definitions must get the already-in-scope section. PROMPT:\n${prompt}`
  );
  assert.ok(/\bCohort\b/.test(section), `the signature-referenced class Cohort is named IN the section. SECTION:\n${section}`);
  assert.ok(/\bhelper\b/.test(section), `the doc-backtick-referenced def helper is named IN the section. SECTION:\n${section}`);
});

gtest("A2 fn-gen Python: the section wording is language-neutral - never the Rust phrase \"use import\"", async () => {
  const prompt = await capturedPrompt("python");
  const section = inScopeSection(prompt);
  assert.ok(section, `the section must exist to carry the neutral wording. PROMPT:\n${prompt}`);
  assert.ok(
    !RUST_USE_RE.test(section),
    `a python section must not speak Rust ("use import"); neutral wording only. SECTION:\n${section}`
  );
});

// ===========================================================================
// A-3. C#: the section NEVER appears (deliberately dark). Frozen guard,
// expected GREEN today and it stays green.
// ===========================================================================

gtest("A3 fn-gen C#: no already-in-scope section, ever - even with a same-file type (Basket) named in the signature [frozen guard]", async () => {
  const prompt = await capturedPrompt("csharp");
  assert.ok(
    inScopeSection(prompt) === undefined,
    `csharp is deliberately dark for the localSymbols mechanism; no section may appear. PROMPT:\n${prompt}`
  );
});

// ===========================================================================
// A-4. Rust smoke: unchanged mechanism (the full leg is pinned by blind-v5).
// GREEN today and it stays green.
// ===========================================================================

gtest("A4 fn-gen Rust smoke: a target referencing a same-file pub struct still gets the section naming it (unchanged mechanism)", async () => {
  const prompt = await capturedPrompt("rust");
  const section = inScopeSection(prompt);
  assert.ok(section, `the rust localSymbols section must still fire. PROMPT:\n${prompt}`);
  assert.ok(/\bManifest\b/.test(section), `the same-file pub struct Manifest is named IN the section. SECTION:\n${section}`);
});

// ===========================================================================
// B-5. The unregistered-language honest gate. Probed with "go" until v23
// registered Go (isRegisteredLanguage row) and superseded that pin — the
// pyoracle-precedent edit; "zig" carries the same contract on the same
// fixture text (the gate keys on languageId, never on syntax).
// ===========================================================================

let goDriveP;
const goDrive = () =>
  (goDriveP ||= (async () => {
    const fix = goFixture(GO_URI);
    return driveSettled("column80.generateFunction", {
      doc: fix.doc,
      cursor: fix.cursor,
      handlers: emptyHandlers(fix.symbols),
      docs: { [GO_URI]: fix.doc },
    });
  })());

gtest("B5 fn-gen gate (zig): exactly ONE user-facing message, naming the language (zig) and saying generation is not supported for it - never silence, never a pile", async () => {
  const { cmdError, messages } = await goDrive();
  assert.strictEqual(cmdError, undefined, `the gate must settle without crashing, got ${cmdError && cmdError.message}`);
  assert.strictEqual(
    messages.length,
    1,
    `a gated fn-gen shows exactly one message, got ${messages.length}: ${JSON.stringify(messages)}`
  );
  const text = String(messages[0].message);
  assert.ok(/\bzig\b/i.test(text), `the message names the document's language ("zig"). MESSAGE: ${JSON.stringify(text)}`);
  assert.ok(
    /not (yet )?(supported|wired)|supports/i.test(text),
    `the message says generation is not supported for this language. MESSAGE: ${JSON.stringify(text)}`
  );
});

gtest("B5 fn-gen gate (zig): NO model request, NO buffer edit, NO snippet, NO workspace edit - the gate is inert", async () => {
  const { genRequests: gen, editorEdits, snippetInserts, appliedEdits } = await goDrive();
  assert.strictEqual(
    gen.length,
    0,
    `a gated fn-gen must not reach the model; prompts sent: ${JSON.stringify(gen.map((r) => r.body && r.body.prompt))}`
  );
  assert.strictEqual(editorEdits, 0, "a gated fn-gen never edits an editor buffer");
  assert.strictEqual(snippetInserts, 0, "a gated fn-gen never inserts a snippet");
  assert.strictEqual(appliedEdits, 0, "a gated fn-gen never applies a workspace edit");
});

// ===========================================================================
// B-6. Registered-language smoke: typescript passes the gate. GREEN today and
// it stays green - the new gate must never catch a registered language.
// ===========================================================================

gtest("B6 fn-gen smoke (typescript): no not-supported message, and the drive DOES reach the generation service", async () => {
  const uri = "file:///proj/src/order_board_smoke.ts";
  const fix = tsFixture(uri);
  const { cmdError, genRequests: gen, messages } = await driveSettled("column80.generateFunction", {
    doc: fix.doc,
    cursor: fix.cursor,
    handlers: emptyHandlers(fix.symbols),
    docs: { [uri]: fix.doc },
    reply: tsReply,
  });
  assert.ok(
    gen.length >= 1,
    `a typescript fn-gen must pass the gate and reach the generation service; cmdError=${cmdError && cmdError.message}; ${diag()}`
  );
  const gateShaped = messages.filter((m) => /not (yet )?(supported|wired)/i.test(String(m.message)));
  assert.strictEqual(
    gateShaped.length,
    0,
    `no not-supported message may appear on a registered language, got ${JSON.stringify(gateShaped)}`
  );
});

// ===========================================================================
// B-7. The same honest gate on Repair Function [phase-3/4 triage do-list]:
// today a "go" repair resolves via the symbol provider, may probe the model
// server, shows the verify spinner, then dies in the oracle's silent
// no-oracle branch - a spinner that vanishes with NO message. The contract:
// one honest refusal naming the language, before any of that fires.
// ===========================================================================

gtest("B7 repair gate (zig): exactly ONE user-facing message naming the language and saying repair is not supported - never a silent no-op", async () => {
  const fix = goFixture("file:///proj/pkg/repair_main.go");
  const { cmdError, messages, genRequests: gen, editorEdits, snippetInserts, appliedEdits } = await driveSettled(
    "column80.repairFunction",
    {
      doc: fix.doc,
      cursor: fix.cursor,
      handlers: emptyHandlers(fix.symbols),
      docs: { "file:///proj/pkg/repair_main.go": fix.doc },
    },
  );
  assert.strictEqual(cmdError, undefined, `the gate must settle without crashing, got ${cmdError && cmdError.message}`);
  assert.strictEqual(
    messages.length,
    1,
    `a gated repair shows exactly one message, got ${messages.length}: ${JSON.stringify(messages)}`
  );
  const text = String(messages[0].message);
  assert.ok(/\bzig\b/i.test(text), `the refusal names the document's language ("zig"). MESSAGE: ${JSON.stringify(text)}`);
  assert.ok(
    /not (yet )?(supported|wired)|supports/i.test(text),
    `the refusal says repair is not supported for this language. MESSAGE: ${JSON.stringify(text)}`
  );
  assert.strictEqual(gen.length, 0, "a gated repair never reaches the model");
  assert.strictEqual(editorEdits + snippetInserts + appliedEdits, 0, "a gated repair never touches the buffer");
});
