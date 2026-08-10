// BLIND ORACLE - "punt handling de-rust" (phase 2). The punt detector and the
// fn-gen no-stub directive were Rust-only; the promise now covers the C# and
// Python stub idioms, and non-Rust prompts stop naming Rust macros. Black-box:
// never reads src/**. Two seams:
//
//   A. looksLikePunt (pure, bundled headless via the impl-punt import pattern):
//      C# `throw new NotImplementedException(...)` and Python
//      `raise NotImplementedError(...)` flag as punts; the existing Rust
//      markers (todo!/unimplemented!) stay flagged; legitimate bodies in all
//      three languages stay false.
//   B. The fn-gen no-stub directive is PER-LANGUAGE, observed at the one seam
//      every generation crosses (the blind-v9-gestures harness: full extension
//      activated against a stub vscode, prompts captured at a fake in-process
//      Ollama server, injection enabled):
//        - python prompts carry the firm directive ("placeholder or stub"),
//          name NotImplementedError, and carry NO rust macro names;
//        - csharp prompts likewise with NotImplementedException;
//        - typescript prompts carry the directive with no rust macro names;
//        - rust prompts still name todo!() (one smoke pin; the full rust bytes
//          are pinned byte-exact by blind3/blind7/blind-v9).
//   C. The punt circle-back fires on the new idioms end-to-end: a python
//      fn-gen whose FIRST model reply is a `raise NotImplementedError` stub
//      issues a SECOND /api/generate request (the anti-punt re-prompt).
//
// Expected today: the A-section C#/Python punt cases and the B/C de-rust cases
// are RED (the markers and per-language directive do not exist yet); the
// frozen Rust behavior (rust markers, real bodies, rust todo!() smoke) is
// GREEN and stays green.
//
// Run: SKIP_LIVE=1 node --test test/blind-derust-punt.test.cjs
// (Hermetic: the "server" is in-process; no model, no network, no ollama.)

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const http = require("node:http");
const esbuild = require("esbuild");
const { bundleCore } = require("./.blind-util.cjs");

// ===========================================================================
// A. looksLikePunt - pure, bundled headless (the impl-punt import pattern).
// ===========================================================================

let pure = {};
let pureCleanup = () => {};
let pureErr;
try {
  ({ mod: pure, cleanup: pureCleanup } = bundleCore(
    "blind-derust-punt-pure",
    `export { looksLikePunt } from "../src/core/punt";\n`,
  ));
} catch (e) {
  pureErr = e;
}
const { looksLikePunt } = pure;

test("bundle guard: the punt core builds headless", () => {
  if (pureErr) assert.fail(`punt core bundle failed: ${pureErr.message}`);
});

const ptest = (name, fn) =>
  test(name, (ctx) => {
    if (pureErr) return ctx.skip("punt core bundle failed; see the bundle guard");
    return fn(ctx);
  });

// NEW idioms (RED today): the C# and Python stub bodies small models return.
const NEW_PUNTS = [
  ["C# throw NotImplementedException()", "public void Upload()\n{\n    throw new NotImplementedException();\n}"],
  ["C# throw NotImplementedException(msg)", 'public int Total()\n{\n    throw new NotImplementedException("write me later");\n}'],
  // The no-imports prompt instruction steers models toward the qualified form.
  ["C# throw System.NotImplementedException()", "public void Upload()\n{\n    throw new System.NotImplementedException();\n}"],
  ["Python bare raise NotImplementedError", "def upload(bucket):\n    raise NotImplementedError"],
  ["Python raise NotImplementedError(msg)", 'def total(orders):\n    raise NotImplementedError("write me later")'],
];
for (const [label, code] of NEW_PUNTS) {
  ptest(`looksLikePunt flags the new idiom: ${label}`, () =>
    assert.strictEqual(looksLikePunt(code), true, `must flag as a punt:\n${code}`));
}

// FROZEN Rust markers (GREEN today, must stay green).
const RUST_PUNTS = [
  ["todo!()", "fn f() -> bool {\n    todo!()\n}"],
  ["unimplemented!(msg)", 'fn f() {\n    unimplemented!("later")\n}'],
];
for (const [label, code] of RUST_PUNTS) {
  ptest(`looksLikePunt still flags the Rust marker: ${label} (unchanged)`, () =>
    assert.strictEqual(looksLikePunt(code), true, `the existing Rust marker must stay flagged:\n${code}`));
}

// Over-trigger guard (GREEN today, must stay green): plain bodies with no stub
// marker - in each language - stay false. (Catch-clauses containing the
// identifier are out of contract and not tested.)
const REAL_BODIES = [
  ["Rust real body", "fn add(a: i32, b: i32) -> i32 {\n    a + b\n}"],
  ["C# real body", "public int Add(int a, int b)\n{\n    return a + b;\n}"],
  ["Python real body", "def add(a, b):\n    return a + b"],
];
for (const [label, code] of REAL_BODIES) {
  ptest(`looksLikePunt stays false on a legitimate body: ${label}`, () =>
    assert.strictEqual(looksLikePunt(code), false, `must NOT flag a real implementation:\n${code}`));
}

// ===========================================================================
// B/C harness - the blind-v9-gestures pattern verbatim: the whole extension
// activated against a stub vscode, prompts captured at a fake in-process
// Ollama server (the one seam every generation crosses).
// ===========================================================================

const STUB = path.join(__dirname, ".blind-derust-punt-stub.cjs");
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

const entry = path.join(__dirname, ".blind-derust-punt.entry.ts");
const outfile = path.join(__dirname, ".blind-derust-punt.bundle.cjs");
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
  pureCleanup();
  fs.rmSync(entry, { force: true });
  fs.rmSync(outfile, { force: true });
  fs.rmSync(STUB, { force: true });
});

test("bundle: the extension entry builds and activates against the stub [harness guard]", async () => {
  if (bundleError) assert.fail(`the surface is not buildable: ${bundleError.message}`);
  await harness();
});

const gtest = (name, fn) =>
  test(name, (ctx) => {
    if (bundleError) return ctx.skip("bundle failed to build; see the bundle test");
    return fn(ctx);
  });

// Fake Ollama server: the prompt-capture point (ndjson /api/generate; /api/tags
// lists every configured model so no gate can honestly refuse).
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

// One-time activation. Injection enabled (compilerDirectedInjection: true).
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
      globalStorageUri: Uri.file("/tmp/blind-derust-punt-storage"),
      logUri: Uri.file("/tmp/blind-derust-punt-log"),
      environmentVariableCollection: { replace() {}, append() {}, prepend() {}, clear() {} },
    };
    await activate(context);
    await waitFor(() => typeof __state.commands["column80.generateFunction"] === "function", "generateFunction registration");
    await waitFor(() => __state.outputLines.some((l) => l.includes("tier=")), "tier resolution line", 200, true);
    return { srv, context };
  })());

test.after(async () => {
  try {
    if (serverRef) await serverRef.close();
  } catch {}
});

// Document / editor fakes (the blind-v9-gestures mechanics).
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

const makeEditor = (doc, pos) => ({
  document: doc,
  selection: new Selection(pos, pos),
  selections: [new Selection(pos, pos)],
  options: { tabSize: 4, insertSpaces: true },
  viewColumn: 1,
  edit: async () => true,
  insertSnippet: async () => true,
  setDecorations() {},
  revealRange() {},
});

const posOf = (text, needle) => {
  const idx = text.indexOf(needle);
  assert.ok(idx >= 0, `fixture needle not found: ${JSON.stringify(needle)}`);
  const before = text.slice(0, idx);
  const line = (before.match(/\n/g) || []).length;
  return new Position(line, idx - (before.lastIndexOf("\n") + 1));
};

const vr = (sl, sc, el, ec) => new mod.Range(sl, sc, el, ec);
const dsym = (name, kind, range, selectionRange, children = [], detail = "") => ({
  name, detail, kind, range, selectionRange, children,
});

const resetDrive = (handlers, docs, editor) => {
  __state.commandHandlers = handlers || {};
  __state.messages.length = 0;
  __state.executeCalls.length = 0;
  globalThis.__DERUST_DOCS__ = docs || {};
  __state.activeTextEditor = editor;
  __state.textDocuments = editor ? [editor.document] : [];
  __state.visibleTextEditors = editor ? [editor] : [];
  serverRef.requests.length = 0;
  serverRef.replyFor = null;
};

const diag = () =>
  `messages=${JSON.stringify(__state.messages)} lastLog=${JSON.stringify(__state.outputLines.slice(-6))}`;

// Fire a gesture command without awaiting completion (capture-driven, the v9
// convention: UI acceptance is out of scope for a prompt pin).
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
// fn-gen prompt, never a later circle-back).
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

// ---------------------------------------------------------------------------
// Per-language fn-gen fixtures: a doc-less target with an empty body, symbols
// answered by the stub's documentSymbol handler, all other extraction commands
// answering empty (the degrade path - injection stays enabled, nothing
// resolves, so the prompt is the v1 bytes plus the no-stub directive).
// ---------------------------------------------------------------------------

const emptyHandlers = (symbols) => ({
  "vscode.executeDocumentSymbolProvider": () => symbols,
  "vscode.executeDefinitionProvider": () => undefined,
  "vscode.executeHoverProvider": () => undefined,
  "vscode.executeCompletionItemProvider": () => undefined,
  "vscode.executeCodeActionProvider": () => undefined,
});

const pyFixture = (uri) => {
  const text = "def read_order(order: Order) -> int:\n    \n";
  const sig = posOf(text, "def read_order");
  const nameCh = "def ".length;
  const doc = makeDoc(text, uri, "python");
  return {
    doc,
    cursor: new Position(sig.line + 1, 4),
    symbols: [dsym("read_order", 11, vr(sig.line, 0, sig.line + 1, 4), vr(sig.line, nameCh, sig.line, nameCh + "read_order".length))],
  };
};
const pyReply = () => "```python\ndef read_order(order: Order) -> int:\n    return order.total\n```";
const pyPuntReply = () => "```python\ndef read_order(order: Order) -> int:\n    raise NotImplementedError\n```";

const csFixture = (uri) => {
  const text = "namespace P;\npublic class C\n{\n    public int Bar()\n    {\n        \n    }\n}\n";
  const sig = posOf(text, "public int Bar()");
  const nameCh = text.split("\n")[sig.line].indexOf("Bar");
  const doc = makeDoc(text, uri, "csharp");
  return {
    doc,
    cursor: new Position(sig.line + 2, 8),
    symbols: [dsym("Bar", 5, vr(sig.line, 4, sig.line + 3, 5), vr(sig.line, nameCh, sig.line, nameCh + "Bar".length))],
  };
};
const csReply = () => "```csharp\npublic int Bar()\n{\n    return 2;\n}\n```";

const tsFixture = (uri) => {
  const text = "export function readOrder(o: Order): number {\n\n}\n";
  const sig = posOf(text, "export function readOrder");
  const nameCh = text.split("\n")[sig.line].indexOf("readOrder");
  const doc = makeDoc(text, uri, "typescript");
  return {
    doc,
    cursor: new Position(sig.line + 1, 0),
    symbols: [dsym("readOrder", 11, vr(sig.line, 0, sig.line + 2, 1), vr(sig.line, nameCh, sig.line, nameCh + "readOrder".length))],
  };
};
const tsReply = () => "```typescript\nexport function readOrder(o: Order): number {\n  return 0;\n}\n```";

const rustFixture = (uri) => {
  const text = "fn total_mass(w: &Widget) -> u64 {\n\n}\n";
  const sig = posOf(text, "fn total_mass");
  const nameCh = text.split("\n")[sig.line].indexOf("total_mass");
  const doc = makeDoc(text, uri, "rust");
  return {
    doc,
    cursor: new Position(sig.line + 1, 0),
    symbols: [dsym("total_mass", 11, vr(sig.line, 0, sig.line + 2, 1), vr(sig.line, nameCh, sig.line, nameCh + "total_mass".length))],
  };
};
const rustReply = () => "```rust\nfn total_mass(w: &Widget) -> u64 {\n    0\n}\n```";

// Lazy one-shot prompt captures per language.
const promptCache = {};
const capturedPrompt = (lang) =>
  (promptCache[lang] ||= (async () => {
    const cases = {
      python: { fixture: pyFixture, uri: "file:///proj/src/orders_directive.py", reply: pyReply },
      csharp: { fixture: csFixture, uri: "file:///proj/src/OrdersDirective.cs", reply: csReply },
      typescript: { fixture: tsFixture, uri: "file:///proj/src/ordersDirective.ts", reply: tsReply },
      rust: { fixture: rustFixture, uri: "file:///proj/src/orders_directive.rs", reply: rustReply },
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
// B. The per-language no-stub directive, observed in the captured prompt.
// ===========================================================================

const RUST_MACROS = ["todo!(", "unimplemented!(", "panic!("];

const DIRECTIVE_CASES = [
  { lang: "python", names: "NotImplementedError" },
  { lang: "csharp", names: "NotImplementedException" },
  { lang: "typescript", names: undefined },
];

for (const { lang, names } of DIRECTIVE_CASES) {
  gtest(`fn-gen ${lang}: the prompt carries the firm no-stub directive ("placeholder or stub")`, async () => {
    const prompt = await capturedPrompt(lang);
    assert.ok(
      prompt.includes("placeholder or stub"),
      `a ${lang} fn-gen prompt with injection on must carry the firm no-stub directive. PROMPT:\n${prompt}`
    );
  });

  gtest(`fn-gen ${lang}: the directive is de-rusted - no Rust macro names in a ${lang} prompt`, async () => {
    const prompt = await capturedPrompt(lang);
    for (const macro of RUST_MACROS) {
      assert.ok(
        !prompt.includes(macro),
        `a ${lang} prompt must not name the Rust macro ${JSON.stringify(macro)}. PROMPT:\n${prompt}`
      );
    }
  });

  if (names) {
    gtest(`fn-gen ${lang}: the directive names the ${lang} stub idiom (${names})`, async () => {
      const prompt = await capturedPrompt(lang);
      assert.ok(
        prompt.includes(names),
        `a ${lang} prompt's no-stub directive must name ${names}. PROMPT:\n${prompt}`
      );
    });
  }
}

// Rust smoke pin: the rust directive is unchanged. This literal IS the byte-exact
// anchor for the Rust no-stub sentence - since the TS_V1_SNAPSHOT supersession no
// other test file carries these bytes (blind3/blind7 pin noPunt-OFF prompts, and
// impl-punt's check is self-referential against the exported constant).
const RUST_NO_PUNT_BYTES =
  "Implement the described behaviour fully and for real. Do not return a placeholder or stub, do not use todo!(), unimplemented!(), or panic!(), and do not return an error that merely says the work is not implemented.";
gtest("fn-gen rust smoke: the rust prompt still carries the exact Rust no-stub directive bytes (unchanged)", async () => {
  const prompt = await capturedPrompt("rust");
  assert.ok(
    prompt.includes(RUST_NO_PUNT_BYTES),
    `the rust no-stub directive bytes moved. PROMPT:\n${prompt}`
  );
});

// ===========================================================================
// C. The punt circle-back on the Python idiom, end-to-end: a first reply whose
// body is `raise NotImplementedError` must trigger a SECOND /api/generate (the
// anti-punt re-prompt), the same circle-back the Rust markers already get.
// ===========================================================================

gtest("punt circle-back python: a `raise NotImplementedError` first reply triggers a second model request (the re-prompt)", async () => {
  await harness();
  const uri = "file:///proj/src/orders_punt.py";
  const fix = pyFixture(uri);
  resetDrive(emptyHandlers(fix.symbols), { [uri]: fix.doc }, makeEditor(fix.doc, fix.cursor));
  let replies = 0;
  serverRef.replyFor = () => (++replies === 1 ? pyPuntReply() : pyReply());
  const status = fireCommand("column80.generateFunction");
  // First the initial generation must fire at all...
  await waitFor(() => genRequests().length >= 1, "the initial python fn-gen request", 400, true);
  assert.ok(genRequests().length >= 1, `the python fn-gen never reached the generation service; cmdError=${status.error && status.error.message}; ${diag()}`);
  // ...then the circle-back: a second request within the wait budget.
  await waitFor(() => genRequests().length >= 2, "the anti-punt re-prompt request", 240, true);
  const gen = genRequests();
  assert.ok(
    gen.length >= 2,
    `a python stub reply (raise NotImplementedError) must trigger the anti-punt circle-back - a SECOND /api/generate - got ${gen.length} request(s); cmdError=${status.error && status.error.message}; ${diag()}`
  );
  assert.notStrictEqual(
    gen[1].body.prompt,
    gen[0].body.prompt,
    "the second request is a re-prompt, not a duplicate of the first"
  );
});
