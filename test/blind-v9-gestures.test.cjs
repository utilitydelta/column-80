// Blind oracle: v9 phase 4A - the generation-side gestures for TypeScript
// (session-v9/phase4-surface.md, "Iron constraints" + "4A contract" only; 4B
// is a later rung and is NOT tested here). Black-box: never reads src/**.
//
// Harness: the whole extension is activated against a stub vscode (the
// blind-repair-command pattern, widened), and prompts are captured at a fake
// in-process Ollama server (the blind2-ollama pattern) - the one seam every
// generation must cross whatever the internal wiring looks like. Extraction
// answers ride the stub's commands.executeCommand with vscode-SHAPED fixtures
// per phase3-surface (completion items with detail, quickinfo hover fences,
// Locations, DocumentSymbols); cross-file texts are served through
// workspace.openTextDocument (the blind-v7-prepare-xfile convention).
//
// Contract pinned (4A):
//  1. fn-gen on a TS document with a resolvable surface injects a ts-fenced
//     block carrying the fixture's REAL signatures - signatures-only (no doc
//     example payload), no ```rust fence, no rust-flavored text. RED today.
//  2. fn-gen on a TS document where nothing resolves degrades to v1 bytes:
//     empty-answering extraction and throwing extraction produce BYTE-
//     IDENTICAL prompts, with no fixture content.
//  3. Rust prompts are untouched: nothing-injected rust drives are byte-
//     identical across degrade modes, keep the frozen v1 shape (```rust fence
//     + the frozen instruction line), and carry no TS-flavored constants.
//  4. FIM whole-block for TS: empty function/arrow/method bodies engage (the
//     injected shape context reaches the FIM prefix; the arrow case carries
//     no `fn` token anywhere, so the rust fn-keyword heuristic CANNOT be what
//     fires it). RED today. Non-body sites (a blank line inside an expression,
//     a cursor on an `fn`-NAMED identifier - the round-1 false-fire class)
//     stay plain v1 FIM bytes.
//  5. test-gen on TS is OUT of v9 (4A amendment 2): the two pins here hold the
//     honest-dark behavior in place - no TS test prompt, an honest ineligible
//     message, no crash - whatever the extraction answers. GREEN today and
//     they stay green. The test-RUN rung's honest no-rung skip is pinned
//     elsewhere (phase 2), not here.
//  7. (4A amendment 3) The fn-gen DOC CHANNEL recognizes a /** JSDoc */
//     immediately above the target on TS documents, with REAL TS symbol
//     ranges (doc lines OUTSIDE the range). RED today.
//  8. (4A amendment 5) The TS v1 degrade prompt is pinned against a byte
//     SNAPSHOT captured from the pre-4A build (a doc-less target, so the
//     amendment-3 doc channel cannot legitimately move the bytes). GREEN
//     today; catches a regression shifting BOTH degrade modes off v1.
//  6. Member-site FIM for TS is ALREADY live (phase 3): one guard that the
//     member-site drive still returns candidates, so 4A cannot regress it.
//
// Layout bytes of the injected block are NOT pinned (the surface leaves TS
// header constants free); only content presence, fencing, and language flavor.
// Fixture convention: document-symbol ranges include the leading doc-comment
// line by default (the rust-analyzer shape today's doc scanner is calibrated
// against); the amendment-3 pin uses the REAL TS shape (doc outside range).
//
// Run: SKIP_LIVE=1 node --test test/blind-v9-gestures.test.cjs
// (Hermetic: the "server" is in-process; no model, no network, no ollama.)

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const http = require("node:http");
const esbuild = require("esbuild");

// ---------------------------------------------------------------------------
// The vscode stub. Everything activation touches is either recorded into
// __state or a safe no-op. commands.executeCommand dispatches to a per-drive
// handler map (state.commandHandlers) so each test decides what the extraction
// commands answer; unanswered ids fall back to registered extension commands,
// then undefined.
// ---------------------------------------------------------------------------

const STUB = path.join(__dirname, ".blind-v9-gestures-stub.cjs");
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
// src/vscode/extension.ts per esbuild.mjs - the one public construction point)
// with the stub aliased in. Guard pattern: a broken bundle or a missing
// activate is ONE loud failure, everything else skips.
// ---------------------------------------------------------------------------

const entry = path.join(__dirname, ".blind-v9-gestures.entry.ts");
const outfile = path.join(__dirname, ".blind-v9-gestures.bundle.cjs");
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
// Fake Ollama server: the prompt-capture point. Speaks ndjson /api/generate
// and answers /api/tags with every configured model present, so no gate in
// the extension can honestly refuse for missing models.
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
// One-time activation. Config: explicit hardware tier (a tier id overrides the
// probe, per the package.json contract), fake apiBase, zero debounce.
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
      globalStorageUri: Uri.file("/tmp/blind-v9-gestures-storage"),
      logUri: Uri.file("/tmp/blind-v9-gestures-log"),
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
// Document / editor fakes (blind-v7-prepare-xfile mechanics, widened with
// lineAt/getWordRangeAtPosition so symbol-based resolution can run).
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

// Position helpers (blind-v9-extractor conventions): computed, never counted.
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
const posAfter = (text, needle, nth = 0) => {
  const p = posOf(text, needle, nth);
  return new Position(p.line, p.character + needle.length);
};

const wordAt = (text, cursor) => {
  const line = text.split("\n")[cursor.line] ?? "";
  const isWord = (c) => /[A-Za-z0-9_$]/.test(c);
  let s = Math.min(cursor.character, line.length);
  let e = s;
  while (s > 0 && isWord(line[s - 1])) s--;
  while (e < line.length && isWord(line[e])) e++;
  const w = line.slice(s, e);
  return w.length > 0 ? w : undefined;
};

// vscode-shaped fixture builders (phase3-surface shapes).
const vr = (sl, sc, el, ec) => new mod.Range(sl, sc, el, ec);
const dsym = (name, kind, range, selectionRange, children = [], detail = "") => ({
  name, detail, kind, range, selectionRange, children,
});

// ---------------------------------------------------------------------------
// Shared TS fixture surface (fn-gen and test-gen): consumer.ts names Order in
// the signature; domain.ts holds the alias defs. TWO cross-file hops (Order ->
// Customer) prove the ONE-resolver ride, per the blind-v7-prepare-xfile
// precedent.
// ---------------------------------------------------------------------------

const DOMAIN_URI = "file:///proj/src/domain.ts";
const DOMAIN_TS = `export type Order = { reference: string; placedBy: Customer };

export type Customer = { displayName: string };
`;
const ORDER_HOVER = "type Order = { reference: string; placedBy: Customer }";
const CUSTOMER_HOVER = "type Customer = { displayName: string }";
// Doc prose with an example payload: signatures-only means this NEVER appears.
const ORDER_DOC = "The order shape. Example: order.total() EXAMPLE_PAYLOAD_SENTINEL";

const consumerTs = (uri, docBlock, opts = {}) => {
  const text = `import { Order } from "./domain";

${docBlock === undefined ? "/** Reads the order total. */" : docBlock}
export function readOrder(o: Order): number {

}
`;
  const sig = posOf(text, "export function readOrder");
  const doc = makeDoc(text, uri, "typescript");
  // Default symbol range includes the doc line (the rust-analyzer shape);
  // opts.realTsRange uses the REAL TS document-symbol shape, where doc lines
  // sit OUTSIDE the symbol range (4A amendment 3's condition).
  const rangeStartLine = opts.realTsRange ? sig.line : sig.line - 1;
  return {
    text,
    doc,
    cursor: new Position(sig.line + 1, 0), // the empty body line
    symbols: [
      dsym(
        "readOrder",
        11, // SymbolKind.Function
        vr(rangeStartLine, 0, sig.line + 2, 1),
        vr(sig.line, text.split("\n")[sig.line].indexOf("readOrder"), sig.line, text.split("\n")[sig.line].indexOf("readOrder") + "readOrder".length)
      ),
    ],
  };
};

const KNOWN_TS = new Set(["Order", "Customer"]);
const tsTypeAt = (uriStr, cursor, consumerText, consumerUri) => {
  const text = uriStr === consumerUri ? consumerText : uriStr === DOMAIN_URI ? DOMAIN_TS : undefined;
  if (text === undefined) return undefined;
  const w = wordAt(text, cursor);
  if (w && KNOWN_TS.has(w)) return w;
  const line = text.split("\n")[cursor.line] ?? "";
  for (const t of KNOWN_TS) if (new RegExp(`\\b${t}\\b`).test(line)) return t;
  return undefined;
};
const tsDefLoc = (typeName) => {
  const lines = DOMAIN_TS.split("\n");
  const ln = lines.findIndex((l) => new RegExp(`\\btype ${typeName}\\b`).test(l));
  const ch = lines[ln].indexOf(typeName);
  return new mod.Location(Uri.parse(DOMAIN_URI), vr(ln, ch, ln, ch + typeName.length));
};

const uriKeyOf = (arg) => (typeof arg === "string" ? arg : arg && arg.toString ? arg.toString() : String(arg));
const posArgOf = (args) => args.find((a) => a && typeof a === "object" && typeof a.line === "number" && typeof a.character === "number");

// Extraction handlers over the shared TS surface. `mode`:
//   "answer"  - full fixture answers (resolvable surface)
//   "empty"   - extraction answers empty/undefined; symbols still resolve
//   "dark"    - extraction throws (swallowed per phase 3); symbols still resolve
function tsHandlers(consumer, consumerUri, mode) {
  const dark = () => { throw new Error("extraction dark"); };
  const symbolsFor = (uriStr) => {
    if (uriStr === consumerUri) return consumer.symbols;
    if (uriStr === DOMAIN_URI && mode === "answer") {
      const orderLn = posOf(DOMAIN_TS, "Order").line;
      const custLn = posOf(DOMAIN_TS, "Customer", 1).line;
      return [
        dsym("Order", 10, vr(orderLn, 0, orderLn, 62), vr(orderLn, 12, orderLn, 17), [
          dsym("reference", 6, vr(orderLn, 20, orderLn, 38), vr(orderLn, 20, orderLn, 29)),
          dsym("placedBy", 6, vr(orderLn, 40, orderLn, 58), vr(orderLn, 40, orderLn, 48)),
        ]),
        dsym("Customer", 10, vr(custLn, 0, custLn, 46), vr(custLn, 12, custLn, 20), [
          dsym("displayName", 6, vr(custLn, 23, custLn, 42), vr(custLn, 23, custLn, 34)),
        ]),
      ];
    }
    return [];
  };
  return {
    "vscode.executeDocumentSymbolProvider": (uriArg) => symbolsFor(uriKeyOf(uriArg)),
    "vscode.executeDefinitionProvider": (uriArg, ...rest) => {
      if (mode === "dark") dark();
      if (mode !== "answer") return undefined;
      const pos = posArgOf(rest);
      const t = pos && tsTypeAt(uriKeyOf(uriArg), pos, consumer.text, consumerUri);
      return t ? [tsDefLoc(t)] : [];
    },
    "vscode.executeHoverProvider": (uriArg, ...rest) => {
      if (mode === "dark") dark();
      if (mode !== "answer") return undefined;
      const pos = posArgOf(rest);
      const t = pos && tsTypeAt(uriKeyOf(uriArg), pos, consumer.text, consumerUri);
      if (t === "Order") return [{ contents: [{ value: "```typescript\n" + ORDER_HOVER + "\n```\n" + ORDER_DOC + "\n" }] }];
      if (t === "Customer") return [{ contents: [{ value: "```typescript\n" + CUSTOMER_HOVER + "\n```\n" }] }];
      return [];
    },
    "vscode.executeCompletionItemProvider": () => {
      if (mode === "dark") dark();
      if (mode !== "answer") return undefined;
      return {
        isIncomplete: false,
        items: [
          { label: "reference", kind: 9, detail: "(property) Order.reference: string" },
          { label: "placedBy", kind: 9, detail: "(property) Order.placedBy: Customer" },
        ],
      };
    },
    "vscode.executeCodeActionProvider": () => {
      if (mode === "dark") dark();
      return undefined;
    },
  };
}

// ---------------------------------------------------------------------------
// Drive helpers.
// ---------------------------------------------------------------------------

const resetDrive = (handlers, docs, editor) => {
  __state.commandHandlers = handlers || {};
  __state.messages.length = 0;
  __state.executeCalls.length = 0;
  globalThis.__V9_DOCS__ = docs || {};
  __state.activeTextEditor = editor;
  __state.textDocuments = editor ? [editor.document] : [];
  __state.visibleTextEditors = editor ? [editor] : [];
  serverRef.requests.length = 0;
  serverRef.replyFor = null;
};

const diag = () =>
  `messages=${JSON.stringify(__state.messages)} lastLog=${JSON.stringify(__state.outputLines.slice(-6))}`;

// Drive a registered gesture command; return the captured /api/generate prompt.
async function driveGesture(commandId, { doc, cursor, handlers, docs, reply }) {
  await harness();
  resetDrive(handlers, docs, makeEditor(doc, cursor));
  serverRef.replyFor = reply || null;
  const cmd = __state.commands[commandId];
  assert.strictEqual(typeof cmd, "function", `${commandId} must be registered`);
  // The drive is capture-driven, not completion-driven: after the prompt hits
  // the generation service the command may keep waiting on UI the stub never
  // supplies (accept/reject), or fail in presenter plumbing - both are out of
  // scope for a prompt pin, so the command promise is raced, never awaited to
  // completion.
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
    `a generation request from ${commandId}`,
    400,
    true
  );
  const ok = serverRef.requests.some((r) => r.url === "/api/generate");
  assert.ok(ok, `${commandId} never reached the generation service; cmdError=${cmdError && cmdError.message}; ${diag()}`);
  const gen = serverRef.requests.filter((r) => r.url === "/api/generate");
  return gen[gen.length - 1].body.prompt;
}

const tsFnReply = () => "```typescript\nexport function readOrder(o: Order): number {\n  return 0;\n}\n```";
const rustFnReply = () => "```rust\nfn total_mass(w: &Widget) -> u64 {\n    0\n}\n```";
const testModReply = () =>
  "```rust\n#[cfg(test)]\nmod tests {\n    use super::*;\n\n    #[test]\n    fn reads() { assert_eq!(1, 1); }\n}\n```";

// Drive the inline completion provider; return the captured FIM request body.
async function driveFim({ doc, cursor, handlers, docs, replyText, expectRequest = true, selected, steps }) {
  await harness();
  const editor = makeEditor(doc, cursor);
  resetDrive(handlers, docs, editor);
  serverRef.replyFor = () => replyText || "0";
  assert.ok(__state.inlineProviders.length >= 1, "activation registered an inline completion provider");
  const { provider } = __state.inlineProviders[0];
  const token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) };
  // `steps` drives a SEQUENCE of requests through the same provider instance,
  // which is what a widget gesture is: a selected request, then the Escape's
  // unselected one at the same state. `selected` is the single-request form.
  let out;
  for (const sci of steps || [selected]) {
    out = await provider.provideInlineCompletionItems(doc, cursor, { triggerKind: 0, selectedCompletionInfo: sci }, token);
  }
  if (expectRequest) {
    const ok = await waitFor(() => serverRef.requests.some((r) => r.url === "/api/generate"), "a FIM generation request", 200, true);
    assert.ok(ok, `the FIM drive never reached the generation service; ${diag()}`);
  }
  const gen = serverRef.requests.filter((r) => r.url === "/api/generate");
  return { out, body: gen.length ? gen[gen.length - 1].body : undefined, executeCalls: __state.executeCalls.slice() };
}

// The injected ts-fenced block: a ```ts or ```typescript fence whose BODY
// contains the given needle. Distinguishes the injected block from the v1
// signature fence (which is also ```typescript for a TS document but carries
// only the target signature).
const tsFencedBlockWith = (prompt, needle) => {
  const re = /```(?:ts|typescript)\n([\s\S]*?)```/g;
  for (let m; (m = re.exec(prompt)); ) if (m[1].includes(needle)) return m[1];
  return undefined;
};

// ===========================================================================
// 1. fn-gen prefill for TS: the injected block. [surface: '4A contract -
// fn-gen / test-gen prefill for TS'] RED until 4A lands.
// ===========================================================================

let tsInjectedPromptP;
const tsInjectedPrompt = () =>
  (tsInjectedPromptP ||= (async () => {
    const uri = "file:///proj/src/consumer-inject.ts";
    const c = consumerTs(uri);
    return driveGesture("column80.generateFunction", {
      doc: c.doc,
      cursor: c.cursor,
      handlers: tsHandlers(c, uri, "answer"),
      docs: { [uri]: c.doc, [DOMAIN_URI]: makeDoc(DOMAIN_TS, DOMAIN_URI, "typescript") },
      reply: tsFnReply,
    });
  })());

gtest("fn-gen TS: the injected block is ts-fenced and carries the fixture's REAL root-type signatures [surface: 'The injected block in a TS prompt is fenced ```ts (never ```rust), carries real signatures']", async () => {
  const prompt = await tsInjectedPrompt();
  const block = tsFencedBlockWith(prompt, "placedBy");
  assert.ok(
    block,
    `a ts-fenced block containing Order's real shape (field placedBy) must reach the prompt. PROMPT:\n${prompt}`
  );
  assert.match(block, /reference\??\s*:\s*string/, `Order.reference keeps its real type in the injected block. BLOCK:\n${block}`);
  assert.match(block, /\bCustomer\b/, `the field type Customer is named. BLOCK:\n${block}`);
});

gtest("fn-gen TS: the nested cross-file shape rides the ONE resolver (Customer.displayName injected) [surface: 'Cross-file shape resolution rides the ONE resolveCrossFileShape with per-language hooks']", async () => {
  const prompt = await tsInjectedPrompt();
  assert.ok(
    prompt.includes("displayName"),
    `the nested out-of-file type Customer's real field displayName must be injected (definition() hop -> re-anchor -> second hop). PROMPT:\n${prompt}`
  );
});

gtest("fn-gen TS: signatures-only and no invention - the doc example payload and unresolved names never appear [surface: 'signatures-only, no example payload' + 'No fabricated surface, ever']", async () => {
  const prompt = await tsInjectedPrompt();
  assert.ok(!prompt.includes("EXAMPLE_PAYLOAD_SENTINEL"), `the hover doc's example payload leaked into the prompt. PROMPT:\n${prompt}`);
  assert.ok(!/\bInvoice\b/.test(prompt), "no invented type may appear");
  assert.ok(!/shippingAddress/.test(prompt), "no invented field may appear");
});

gtest("fn-gen TS: no rust flavor - no ```rust fence, no rust wording, no Rust-syntax rendering [surface: 'fenced ```ts (never ```rust)' + 'header text is TS-OWNED constants']", async () => {
  const prompt = await tsInjectedPrompt();
  assert.ok(!prompt.includes("```rust"), `a TS prompt must never carry a rust fence. PROMPT:\n${prompt}`);
  assert.ok(!/\brust\b/i.test(prompt), `a TS prompt must not carry rust-flavored text. PROMPT:\n${prompt}`);
  assert.ok(!/pub struct|&self/.test(prompt), `the TS renderer must emit TS syntax, not Rust struct/impl shapes. PROMPT:\n${prompt}`);
});

// ===========================================================================
// 2. fn-gen degrade for TS: v1 bytes. [surface: 'Degrade: no candidate types,
// no resolution, or extractor dark => injectedSurface undefined => v1 bytes']
// ===========================================================================

gtest("fn-gen TS degrade: empty-answering and dark (throwing) extraction produce BYTE-IDENTICAL prompts with no fixture content [surface: 'Injection degrade ... v1-byte-identical prompts']", async () => {
  const uriA = "file:///proj/src/consumer-empty.ts";
  const cA = consumerTs(uriA);
  const emptyPrompt = await driveGesture("column80.generateFunction", {
    doc: cA.doc,
    cursor: cA.cursor,
    handlers: tsHandlers(cA, uriA, "empty"),
    docs: { [uriA]: cA.doc },
    reply: tsFnReply,
  });
  const uriB = "file:///proj/src/consumer-dark.ts";
  const cB = consumerTs(uriB);
  const darkPrompt = await driveGesture("column80.generateFunction", {
    doc: cB.doc,
    cursor: cB.cursor,
    handlers: tsHandlers(cB, uriB, "dark"),
    docs: { [uriB]: cB.doc },
    reply: tsFnReply,
  });
  assert.strictEqual(darkPrompt, emptyPrompt, "nothing-resolves and extractor-dark must land on the SAME v1 bytes");
  for (const leak of ["placedBy", "displayName", "reference: string", "EXAMPLE_PAYLOAD_SENTINEL"]) {
    assert.ok(!emptyPrompt.includes(leak), `no fixture surface content in a degraded prompt (found ${JSON.stringify(leak)}):\n${emptyPrompt}`);
  }
  assert.ok(emptyPrompt.includes("readOrder"), "the degraded prompt is still the real v1 fn-gen prompt for this function");
});

// ===========================================================================
// 2b. The fn-gen DOC CHANNEL on TS: a /** JSDoc */ immediately above the
// target reaches the prompt even though REAL TS document symbols exclude the
// doc lines from the symbol range. [surface: 4A amendment 3] RED today.
// ===========================================================================

gtest("fn-gen TS doc channel: a /** JSDoc */ above the target reaches the prompt with REAL TS symbol ranges (doc OUTSIDE the range) [surface: 4A amendment 3 'the doc scanner recognizes a /** ... */ JSDoc block ... even though TS document symbols exclude the doc lines']", async () => {
  const uri = "file:///proj/src/consumer-jsdoc.ts";
  const c = consumerTs(uri, "/** Reads the order total. JSDOC_DOC_SENTINEL */", { realTsRange: true });
  const prompt = await driveGesture("column80.generateFunction", {
    doc: c.doc,
    cursor: c.cursor,
    handlers: tsHandlers(c, uri, "empty"),
    docs: { [uri]: c.doc },
    reply: tsFnReply,
  });
  assert.ok(
    prompt.includes("JSDOC_DOC_SENTINEL"),
    `the human-authored JSDoc directing the generation must reach the fn-gen prompt. PROMPT:\n${prompt}`
  );
});

// ===========================================================================
// 2c. The TS v1 baseline snapshot. [surface: 4A amendment 5] The bytes below
// were captured from the pre-4A build through THIS harness, over a DOC-LESS
// target (so the amendment-3 doc channel cannot legitimately move them). A
// change here means the TS v1 degrade prompt itself shifted - catching a
// regression that moves BOTH degrade modes identically off v1.
// ===========================================================================

// SUPERSEDED 2026-07-18 (de-rust slice, session-v11): the no-stub directive is
// per-language now, so the TS degrade prompt carries the neutral directive
// instead of the Rust macro names (todo!/unimplemented!/panic!) the pre-4A
// capture embedded. One deliberate re-capture; everything else is the same bytes.
const TS_V1_SNAPSHOT =
  "Implement the function below. Reply with one fenced code block containing the complete function definition, signature and body. The block must contain only this one function: no imports, no other functions, no code before or after it. Output nothing outside the code block. Implement the described behaviour fully and for real. Do not return a placeholder or stub, and do not throw or return an error that merely says the work is not implemented.\n\n```typescript\nexport function readOrder(o: Order): number\n```";

gtest("fn-gen TS v1 baseline: the degrade prompt for a doc-less target equals the stored pre-4A snapshot bytes [surface: 4A amendment 5 'The TS v1 prompt baseline gets a blind SNAPSHOT pin']", async () => {
  const uri = "file:///proj/src/consumer-snapshot.ts";
  const c = consumerTs(uri, "");
  const prompt = await driveGesture("column80.generateFunction", {
    doc: c.doc,
    cursor: c.cursor,
    handlers: tsHandlers(c, uri, "empty"),
    docs: { [uri]: c.doc },
    reply: tsFnReply,
  });
  assert.strictEqual(
    prompt,
    TS_V1_SNAPSHOT,
    `the TS v1 degrade bytes moved off the pre-4A baseline. CAPTURED:\n${JSON.stringify(prompt)}`
  );
});

// ===========================================================================
// 3. Rust unaffected. [surface: 'fn-gen prompt bytes for existing RUST paths
// stay byte-identical' - pinned here as: nothing-injected rust == v1 bytes
// through THIS harness, with no TS-flavored constants]
// ===========================================================================

const RUST_TS = `/// Sums the widget mass.
fn total_mass(w: &Widget) -> u64 {

}
`;
const rustFixture = (uri) => {
  const text = RUST_TS;
  const sig = posOf(text, "fn total_mass");
  const doc = makeDoc(text, uri, "rust");
  const nameCh = text.split("\n")[sig.line].indexOf("total_mass");
  return {
    doc,
    cursor: new Position(sig.line + 1, 0),
    symbols: [dsym("total_mass", 11, vr(sig.line, 0, sig.line + 2, 1), vr(sig.line, nameCh, sig.line, nameCh + "total_mass".length))],
  };
};
const rustHandlers = (fix, mode) => ({
  "vscode.executeDocumentSymbolProvider": () => fix.symbols,
  "vscode.executeDefinitionProvider": () => { if (mode === "dark") throw new Error("dark"); return undefined; },
  "vscode.executeHoverProvider": () => { if (mode === "dark") throw new Error("dark"); return undefined; },
  "vscode.executeCompletionItemProvider": () => { if (mode === "dark") throw new Error("dark"); return undefined; },
  "vscode.executeCodeActionProvider": () => { if (mode === "dark") throw new Error("dark"); return undefined; },
});

// The frozen v1 instruction line (already pinned byte-exact by the blind3
// prompt-identity artifact; safe to reuse as the v1-shape anchor).
const V1_INSTR =
  "Implement the function below. Reply with one fenced code block containing the complete function definition, signature and body. The block must contain only this one function: no imports, no other functions, no code before or after it. Output nothing outside the code block.";

gtest("rust unaffected: nothing-injected rust drives are byte-identical, keep the frozen v1 shape, and carry no TS constants [surface: iron constraint 'RUST paths stay byte-identical' + 'TS gets NEW constants']", async () => {
  const fixA = rustFixture("file:///proj/src/mass_a.rs");
  const emptyPrompt = await driveGesture("column80.generateFunction", {
    doc: fixA.doc,
    cursor: fixA.cursor,
    handlers: rustHandlers(fixA, "empty"),
    docs: {},
    reply: rustFnReply,
  });
  const fixB = rustFixture("file:///proj/src/mass_b.rs");
  const darkPrompt = await driveGesture("column80.generateFunction", {
    doc: fixB.doc,
    cursor: fixB.cursor,
    handlers: rustHandlers(fixB, "dark"),
    docs: {},
    reply: rustFnReply,
  });
  assert.strictEqual(darkPrompt, emptyPrompt, "rust degrade modes must land on the same v1 bytes");
  assert.ok(emptyPrompt.includes("```rust\n"), `the rust prompt keeps its rust fence. PROMPT:\n${emptyPrompt}`);
  assert.ok(emptyPrompt.includes("total_mass"), "the rust prompt carries the target signature");
  assert.ok(emptyPrompt.includes(V1_INSTR), `the frozen v1 instruction line survives this harness. PROMPT:\n${emptyPrompt}`);
  assert.ok(!/```(?:ts|typescript)\b/.test(emptyPrompt), "no ts fence in a rust prompt");
  assert.ok(!/\btypescript\b/i.test(emptyPrompt), "no TS-flavored constants in a rust prompt");
});

// ===========================================================================
// 4. FIM whole-block for TS. [surface: 'FIM whole-block for TS'] Engagement
// is observed at the generation seam: the injected shape context reaches the
// FIM prefix (its content can ONLY come from the stub's extraction answers,
// so extraction dispatch is proven transitively). Degrade/non-sites are plain
// v1 FIM bytes: prompt == the document prefix, suffix == the document suffix.
// ===========================================================================

const ALIAS_URI = "file:///proj/src/alias.ts";
const ALIAS_TS = `export type Alias = { brightness: number; contrastMode: string };
`;
const ALIAS_HOVER = "type Alias = { brightness: number; contrastMode: string }";

const aliasHandlers = (consumerText, consumerUri) => ({
  "vscode.executeDocumentSymbolProvider": (uriArg) => {
    if (uriKeyOf(uriArg) !== ALIAS_URI) return [];
    const ln = posOf(ALIAS_TS, "Alias").line;
    return [
      dsym("Alias", 10, vr(ln, 0, ln, 66), vr(ln, 12, ln, 17), [
        dsym("brightness", 6, vr(ln, 22, ln, 40), vr(ln, 22, ln, 32)),
        dsym("contrastMode", 6, vr(ln, 42, ln, 62), vr(ln, 42, ln, 54)),
      ]),
    ];
  },
  "vscode.executeDefinitionProvider": (uriArg, ...rest) => {
    const pos = posArgOf(rest);
    const text = uriKeyOf(uriArg) === consumerUri ? consumerText : uriKeyOf(uriArg) === ALIAS_URI ? ALIAS_TS : undefined;
    if (!pos || text === undefined) return [];
    const w = wordAt(text, pos);
    const line = text.split("\n")[pos.line] ?? "";
    if (w === "Alias" || /\bAlias\b/.test(line)) {
      const ln = posOf(ALIAS_TS, "Alias").line;
      const ch = ALIAS_TS.split("\n")[ln].indexOf("Alias");
      return [new mod.Location(Uri.parse(ALIAS_URI), vr(ln, ch, ln, ch + "Alias".length))];
    }
    return [];
  },
  "vscode.executeHoverProvider": (uriArg, ...rest) => {
    const pos = posArgOf(rest);
    const text = uriKeyOf(uriArg) === consumerUri ? consumerText : uriKeyOf(uriArg) === ALIAS_URI ? ALIAS_TS : undefined;
    if (!pos || text === undefined) return [];
    const w = wordAt(text, pos);
    const line = text.split("\n")[pos.line] ?? "";
    if (w === "Alias" || /\bAlias\b/.test(line)) {
      return [{ contents: [{ value: "```typescript\n" + ALIAS_HOVER + "\n```\n" }] }];
    }
    return [];
  },
  "vscode.executeCompletionItemProvider": () => ({
    isIncomplete: false,
    items: [
      { label: "brightness", kind: 9, detail: "(property) Alias.brightness: number" },
      { label: "contrastMode", kind: 9, detail: "(property) Alias.contrastMode: string" },
    ],
  }),
});

const fimDocs = (uri, doc) => ({ [uri]: doc, [ALIAS_URI]: makeDoc(ALIAS_TS, ALIAS_URI, "typescript") });

// Whole-block engagement sites: function body, arrow body (NO `fn` token
// anywhere in the file - the rust fn-keyword heuristic cannot be what fires
// it), class method body. All RED until the TS detector exists.
const WB_SITES = [
  {
    why: "an empty function body engages [surface: 'fires at empty function/method/arrow bodies']",
    uri: "file:///proj/src/wb-fn.ts",
    text: `import { Alias } from "./alias";\n\nexport function fill(a: Alias): number {\n  \n}\n`,
    cursorAfter: "number {\n  ",
  },
  {
    why: "an empty ARROW body engages - the file contains no `fn` token, so the rust keyword heuristic cannot be the detector [surface: 'const f = (a: A) => { }' + 'NOT at fn-named params/idents']",
    uri: "file:///proj/src/wb-arrow.ts",
    text: `import { Alias } from "./alias";\n\nexport const fill = (x: Alias): number => {\n  \n};\n`,
    cursorAfter: "=> {\n  ",
  },
  {
    why: "an empty class METHOD body engages [surface: 'class methods']",
    uri: "file:///proj/src/wb-method.ts",
    text: `import { Alias } from "./alias";\n\nexport class Painter {\n  render(a: Alias): number {\n    \n  }\n}\n`,
    cursorAfter: "number {\n    ",
  },
  {
    why: "an empty body whose PARAMETER is named fn still engages - engagement is unconditional on param names [surface: 4A amendment 1 'process(fn: () => void) { } ... ENGAGES whole-block']",
    uri: "file:///proj/src/wb-fnparam.ts",
    text: `import { Alias } from "./alias";\n\nexport class Runner {\n  process(fn: (a: Alias) => void) {\n    \n  }\n}\n`,
    cursorAfter: "void) {\n    ",
  },
];

for (const site of WB_SITES) {
  gtest(`FIM whole-block TS: ${site.why}`, async () => {
    const doc = makeDoc(site.text, site.uri, "typescript");
    const cursor = posAfter(site.text, site.cursorAfter);
    const { body } = await driveFim({
      doc,
      cursor,
      handlers: aliasHandlers(site.text, site.uri),
      docs: fimDocs(site.uri, doc),
    });
    assert.ok(body, "a FIM request reached the generation service");
    const plainPrefix = site.text.slice(0, doc.offsetAt(cursor));
    assert.ok(
      body.prompt.includes("brightness"),
      `the resolved Alias shape (field brightness) must reach the FIM prefix - whole-block injection engaged. PREFIX SENT:\n${body.prompt}`
    );
    assert.notStrictEqual(body.prompt, plainPrefix, "an engaged whole-block site cannot send the plain v1 prefix");
  });
}

// Non-sites: plain v1 FIM bytes, byte-exact. The fixture file carries the
// round-1 false-fire shape (a parameter NAMED fn) so a lingering rust-keyword
// detector firing off the `fn` token is caught as non-plain bytes.
const NON_SITES = [
  {
    why: "a blank line inside an expression (body already has content) stays plain v1 FIM [surface: 'degrade to no injection = v1 FIM behavior']",
    uri: "file:///proj/src/nb-expr.ts",
    text: `import { Alias } from "./alias";\n\nexport function outer(fn: (a: Alias) => void): number {\n  fn(seed);\n  const total = merge(\n  \n  );\n  return total;\n}\n`,
    cursorAfter: "merge(\n  ",
  },
  {
    why: "a cursor on an identifier NAMED fn (the round-1 false-fire class) stays plain v1 FIM [surface: 'NOT at `fn`-named params/idents (the round-1 false-fire class)']",
    uri: "file:///proj/src/nb-fnident.ts",
    text: `import { Alias } from "./alias";\n\nexport function outer(fn: (a: Alias) => void): number {\n  fn\n  return 0;\n}\n`,
    cursorAfter: "void): number {\n  fn",
  },
];

for (const site of NON_SITES) {
  gtest(`FIM whole-block TS: ${site.why}`, async () => {
    const doc = makeDoc(site.text, site.uri, "typescript");
    const cursor = posAfter(site.text, site.cursorAfter);
    const { body } = await driveFim({
      doc,
      cursor,
      handlers: aliasHandlers(site.text, site.uri),
      docs: fimDocs(site.uri, doc),
    });
    assert.ok(body, "the plain FIM request still reached the generation service");
    const plainPrefix = site.text.slice(0, doc.offsetAt(cursor));
    const plainSuffix = site.text.slice(doc.offsetAt(cursor));
    assert.strictEqual(body.prompt, plainPrefix, "a non-body site sends the UNTOUCHED document prefix (v1 FIM bytes)");
    assert.strictEqual(body.suffix, plainSuffix, "a non-body site sends the untouched document suffix");
    assert.ok(!body.prompt.includes("brightness"), "no shape context is injected at a non-body site");
  });
}

// ===========================================================================
// 5. test-gen on TS is OUT of v9 (4A amendment 2): pin the honest-dark
// behavior in place so 4A cannot silently change it. No TS test prompt is
// produced, the user gets an honest message (never silence), the command
// settles without crashing - whatever the extraction answers.
// ===========================================================================

// Drive a gesture command expecting NO generation: wait for the command to
// settle, then report what reached the service and what the user saw.
async function driveGestureDark(commandId, { doc, cursor, handlers, docs }) {
  await harness();
  resetDrive(handlers, docs, makeEditor(doc, cursor));
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
  await waitFor(() => cmdSettled, `${commandId} to settle`);
  return {
    cmdError,
    genRequests: serverRef.requests.filter((r) => r.url === "/api/generate"),
    messages: __state.messages.slice(),
  };
}

const TESTGEN_DARK_CASES = [
  { label: "resolvable surface", mode: "answer" },
  { label: "dark extraction", mode: "dark" },
];

for (const c of TESTGEN_DARK_CASES) {
  gtest(`test-gen TS stays honest-dark (${c.label}): no TS test prompt, an honest message, no crash [surface: 4A amendment 2 'Test-gen on TS is OUT of 4A (and v9) ... keeps its honest ineligible behavior unchanged']`, async () => {
    const uri = `file:///proj/src/consumer-testgen-${c.mode}.ts`;
    const fix = consumerTs(uri, "/// Returns the order total in minor units.");
    const { cmdError, genRequests, messages } = await driveGestureDark("column80.generateTests", {
      doc: fix.doc,
      cursor: fix.cursor,
      handlers: tsHandlers(fix, uri, c.mode),
      docs: { [uri]: fix.doc, [DOMAIN_URI]: makeDoc(DOMAIN_TS, DOMAIN_URI, "typescript") },
    });
    assert.strictEqual(cmdError, undefined, `test-gen on TS must settle without crashing, got ${cmdError && cmdError.message}`);
    assert.strictEqual(genRequests.length, 0, `no TS test prompt may reach the generation service, got ${JSON.stringify(genRequests.map((r) => r.body && r.body.prompt))}`);
    assert.ok(messages.length >= 1, "the gesture reports its ineligibility honestly, never silence");
  });
}

// ===========================================================================
// 6. Member-site FIM for TS is already live (phase 3): guard only. [task
// rider: 'one guard test that your harness's member-site drive still returns
// candidates (so 4A cannot regress it silently)']
// ===========================================================================

gtest("member-site FIM TS guard: a `store.` site still returns candidates through this harness [phase 3 live behavior; 4A must not regress it]", async () => {
  const uri = "file:///proj/src/member.ts";
  const text = `import { store } from "./store";\n\nexport function pick(): string {\n  return store.\n}\n`;
  const doc = makeDoc(text, uri, "typescript");
  const cursor = posAfter(text, "return store.");
  const handlers = {
    "vscode.executeDocumentSymbolProvider": () => [],
    "vscode.executeCompletionItemProvider": () => ({
      isIncomplete: false,
      items: [
        { label: "theme", kind: 9, detail: "(property) Store.theme: string" },
        { label: "setTheme", kind: 1, detail: "(method) Store.setTheme(theme: string): void" },
      ],
    }),
    "vscode.executeDefinitionProvider": () => [],
    "vscode.executeHoverProvider": () => [],
  };
  const { out } = await driveFim({ doc, cursor, handlers, docs: { [uri]: doc }, replyText: "theme;" });
  const items = out && (Array.isArray(out) ? out : out.items);
  assert.ok(items && items.length >= 1, `the member-site drive must still return candidates, got ${JSON.stringify(out)}; ${diag()}`);
});

// ===========================================================================
// 7. v20's second Escape, through the REAL extension wiring. The provider's
// own contract is covered by test/blind-v20-second-escape.test.cjs; what only
// this harness can reach is what activate() actually registered: which editor
// command each branch of the dismissal runs, and the context key the
// keybinding is gated on. A swapped pair of command ids delivers the exact
// opposite of the gesture and no provider test can see it.
// ===========================================================================

// Each row gets its OWN file. The harness activates the extension once and
// shares the provider across tests, and a dismissal is remembered against the
// state it was taken at, so two rows at one cursor would have the second
// inherit the first's refusal.
const memberSiteDoc = (tag) => {
  const uri = `file:///proj/src/second-escape-${tag}.ts`;
  const text = `import { store } from "./store";\n\nexport function pick(): string {\n  return store.\n}\n`;
  return { uri, doc: makeDoc(text, uri, "typescript"), cursor: posAfter(text, "return store.") };
};

const memberHandlers = () => ({
  "vscode.executeDocumentSymbolProvider": () => [],
  "vscode.executeCompletionItemProvider": () => ({
    isIncomplete: false,
    items: [
      { label: "theme", kind: 9, detail: "(property) Store.theme: string" },
      { label: "setTheme", kind: 1, detail: "(method) Store.setTheme(theme: string): void" },
    ],
  }),
  "vscode.executeDefinitionProvider": () => [],
  "vscode.executeHoverProvider": () => [],
});

// The widget highlighting `theme`, then the Escape: an unselected request at
// the same position and version, which is what leaves a sticky scope behind.
const widgetThenEscape = (cursor) => [
  // A plain-object range: the vscode stub's Range class lives inside the stub
  // file, not this module, and the provider only ever reads start/end.
  {
    text: "setTheme",
    range: {
      start: { line: cursor.line, character: cursor.character },
      end: { line: cursor.line, character: cursor.character },
    },
  },
  undefined,
];

// Rewritten under TRIAGE authority 2026-07-26, review-p34.md target 4 and
// note 6: superseded by v21's ratified hide-first dismissal; the old pin
// asserted the refuted bare-trigger design. An explicit trigger preserves the
// currently drawn item by identity and re-selects it, so without the hide the
// ghost being dismissed is the ghost that comes back; the hide files a
// truthful REJECTED for a ghost the user is actively rejecting.
gtest("v20: with a scoped ghost held, the dismissal hides the scoped ghost FIRST, then closes the widget, then re-triggers [triage D11]", async () => {
  const { uri, doc, cursor } = memberSiteDoc("branch");
  await driveFim({
    doc,
    cursor,
    handlers: memberHandlers(),
    docs: { [uri]: doc },
    replyText: '("dark");',
    steps: widgetThenEscape(cursor),
  });
  const cmd = __state.commands["column80.dismissScopedGhost"];
  assert.strictEqual(typeof cmd, "function", "activation must register column80.dismissScopedGhost, or the keybinding presses nothing");
  const before = __state.executeCalls.length;
  await cmd();
  const ran = __state.executeCalls.slice(before).map((c) => c.id);
  assert.ok(
    ran.includes("editor.action.inlineSuggest.trigger"),
    `a held scope must end in a RE-RENDER, got ${JSON.stringify(ran)}; ${diag()}`
  );
  // The hide comes first: the trigger's identity preservation would otherwise
  // re-select the very ghost being dismissed and park the unscoped answer at
  // index 1 (review-p34.md finding 1's mechanism, at the dismissal).
  assert.ok(
    ran.indexOf("editor.action.inlineSuggest.hide") >= 0 &&
      ran.indexOf("editor.action.inlineSuggest.hide") < ran.indexOf("editor.action.inlineSuggest.trigger"),
    `the scoped ghost must be hidden BEFORE the re-render, or preservation re-selects it; got ${JSON.stringify(ran)}`
  );
  // The widget goes before the trigger too, or the re-render is invisible:
  // VS Code draws a ghost while the widget is open only if it extends the
  // highlight, and the whole point of this gesture is a ghost that names a
  // DIFFERENT member.
  assert.ok(
    ran.indexOf("hideSuggestWidget") >= 0 &&
      ran.indexOf("hideSuggestWidget") < ran.indexOf("editor.action.inlineSuggest.trigger"),
    `the suggest widget must be closed BEFORE the re-render, or the editor drops the item without a word; got ${JSON.stringify(ran)}`
  );
});

gtest("v20: with nothing held, the dismissal falls back to the editor's own hide - a keybinding that fired against a scope already gone must not eat the key [triage D11]", async () => {
  await harness();
  resetDrive({}, {}, undefined);
  const cmd = __state.commands["column80.dismissScopedGhost"];
  assert.strictEqual(typeof cmd, "function", "activation must register column80.dismissScopedGhost");
  await cmd();
  const ran = __state.executeCalls.map((c) => c.id);
  assert.ok(
    ran.includes("editor.action.inlineSuggest.hide"),
    `with no scope held the developer must get the Escape they pressed, got ${JSON.stringify(ran)}; ${diag()}`
  );
  assert.ok(
    !ran.includes("editor.action.inlineSuggest.trigger"),
    `and must not re-trigger a ghost nobody asked for, got ${JSON.stringify(ran)}`
  );
  assert.ok(
    !ran.includes("hideSuggestWidget"),
    `nor close a widget it was never asked to touch, got ${JSON.stringify(ran)}`
  );
});

gtest("v20: the context key the keybinding is gated on is set by the real wiring, true when the scoped ghost is drawn and false once it is dismissed [triage D11 - a key that never moves means the binding never fires]", async () => {
  const { uri, doc, cursor } = memberSiteDoc("key");
  await driveFim({
    doc,
    cursor,
    handlers: memberHandlers(),
    docs: { [uri]: doc },
    // The scoped prompt already ends with `setTheme`, so the ghost has to be
    // what FOLLOWS the member name. A ghost re-spelling it is refused, and
    // then nothing renders and the key never moves.
    replyText: '("dark");',
    steps: widgetThenEscape(cursor),
  });
  const keyCalls = () =>
    __state.executeCalls.filter((c) => c.id === "setContext" && c.args[0] === "column80.scopedGhost").map((c) => c.args[1]);
  assert.deepStrictEqual(
    keyCalls(),
    [true],
    `the scoped ghost must arm the context key exactly once, got ${JSON.stringify(keyCalls())}; ${diag()}`
  );
  await __state.commands["column80.dismissScopedGhost"]();
  assert.deepStrictEqual(
    keyCalls(),
    [true, false],
    `and the dismissal must disarm it, or the next Escape fires against a scope that is gone; got ${JSON.stringify(keyCalls())}`
  );
});
