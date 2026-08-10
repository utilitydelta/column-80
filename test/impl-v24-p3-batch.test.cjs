// IMPLEMENTATION TESTS — session-v24 phase 3, the four batched fixes.
// What the blind oracle (test/blind-v24-p3-batch.test.cjs) could not see:
//
//   * ITEM 9 — the Python plain-function (no docstring, kind=function)
//     re-indent. The oracle recorded this as a `todo`, having measured that
//     editor.edit / insertSnippet / setDecorations observe nothing for a
//     completed generation. They do not, but the PREVIEW does: the proposal
//     presenter registers a TextDocumentContentProvider for the
//     `column80-fngen` scheme and writes the spliced full text into it before
//     it opens the diff. That provider is a real, product-visible seam, so
//     item 9 is proven end to end here, through the same extension harness.
//     Same seam proves the Rust leg is WIRED (fix 5), not merely exported.
//
//   * reindentRustBody's string awareness at the byte level. The oracle's two
//     item-8 rows assert the string interiors correctly but then demand the
//     code line land at 8 spaces when the contract its own item-6 control
//     proves (prepend `indent`) puts it at 12. Those rows cannot pass; the
//     claim they were written to make is proven here instead, plus the shapes
//     Rust has and its siblings do not: nested block comments, lifetimes
//     against char literals, byte and raw-byte strings.
//
//   * puntDiagnosis — the prose lift that makes the fix-6 message the model's
//     own reason rather than a generic failure string.
//
// Run: SKIP_LIVE=1 node --test test/impl-v24-p3-batch.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const http = require("node:http");
const esbuild = require("esbuild");
const { bundleCore } = require("./.blind-util.cjs");

const REPO = path.join(__dirname, "..");

// ===========================================================================
// A — the pure legs: reindentRustBody and puntDiagnosis.
// ===========================================================================

const { mod: A, cleanup: aCleanup } = bundleCore(
  "impl-v24-p3-core",
  `export { reindentRustBody } from "../src/core/extraction";
export { puntDiagnosis, looksLikePunt } from "../src/core/punt";\n`,
);
test.after(() => aCleanup());
const { reindentRustBody, puntDiagnosis } = A;

// The shipped contract, identical to the TS/C#/Python legs: line 1 is kept,
// every later non-blank code line gets `indent` PREPENDED to what it already
// has, blank lines stay blank, string interiors are byte-exact.
const prepended = (text, indent) =>
  text
    .split("\n")
    .map((l, i) => (i === 0 || l === "" ? l : indent + l))
    .join("\n");

const RUST_BODY =
  "fn expire_stale(&mut self, now: Instant) -> usize {\n" +
  "    let mut n = 0;\n" +
  "\n" +
  "    for seg in self.segments.iter() {\n" +
  "        n += 1;\n" +
  "    }\n" +
  "    n\n" +
  "}";

test("reindentRustBody: a nested target shifts every line but the first, by the anchor indent", () => {
  assert.strictEqual(reindentRustBody(RUST_BODY, "    "), prepended(RUST_BODY, "    "));
});

test("reindentRustBody: indent '' is byte-identical — a top-level target never moves", () => {
  assert.strictEqual(reindentRustBody(RUST_BODY, ""), RUST_BODY);
});

test("reindentRustBody: a blank body line stays empty rather than gaining trailing whitespace", () => {
  assert.ok(reindentRustBody(RUST_BODY, "        ").split("\n").includes(""));
});

// The claim the oracle's item-8 rows were written to make, asserted at the
// byte level: the string interior is untouched AND the code line around it
// moves by exactly `indent`. Each row names the cross-line shape it pins.
const STRING_CASES = [
  {
    name: "a raw string r#\"...\"# spanning three lines",
    body:
      'fn sql(&self) -> &str {\n' +
      '    let q = r#"SELECT seq\nFROM wal\nWHERE lo > 0"#;\n' +
      "    q\n" +
      "}",
    frozen: ["FROM wal", 'WHERE lo > 0"#;'],
  },
  {
    name: "a plain \"...\" literal spanning lines (legal in Rust, unlike C#/TS)",
    body: 'fn banner(&self) -> String {\n    let b = "first\nsecond";\n    b.to_string()\n}',
    frozen: ['second";'],
  },
  {
    name: "a raw string with two hashes, closed only by \"##",
    body: 'fn q(&self) -> &str {\n    let s = r##"a "# b\nstill inside"##;\n    s\n}',
    frozen: ['still inside"##;'],
  },
  {
    name: "a raw BYTE string br#\"...\"#",
    body: 'fn bytes(&self) -> &[u8] {\n    let b = br#"line one\nline two"#;\n    b\n}',
    frozen: ["line two\"#;"],
  },
  {
    name: "an escaped quote inside a spanning plain string does not close it",
    body: 'fn msg(&self) -> String {\n    let m = "he said \\"hi\\"\nand left";\n    m\n}',
    frozen: ['and left";'],
  },
];

for (const c of STRING_CASES) {
  test(`reindentRustBody: string-literal aware — ${c.name}`, () => {
    const out = reindentRustBody(c.body, "        ");
    const lines = out.split("\n");
    for (const frozen of c.frozen) {
      assert.ok(
        lines.includes(frozen),
        `a line INSIDE the string literal was shifted (expected byte-exact ${JSON.stringify(frozen)}). OUT:\n${out}`,
      );
    }
    // The code line that OPENS the string is code, so it takes the full
    // prepend: its own indent plus the anchor's.
    const opener = c.body.split("\n")[1];
    assert.ok(
      lines.includes("        " + opener),
      `the code line opening the string must be re-indented to ${JSON.stringify("        " + opener)}. OUT:\n${out}`,
    );
  });
}

// Rust shapes with no sibling in the other legs. None of these carries a
// cross-line string, so the WHOLE output must be the plain prepend: a scan that
// mis-reads any of them would freeze a later line and the equality catches it.
const SHAPE_CASES = [
  ["a NESTED block comment closes at its own depth, not at the inner `*/`", "fn f(&self) -> u8 {\n    /* outer /* inner */ still outer */\n    1\n}"],
  ["a lifetime ('a) is not read as an unterminated char literal", "fn borrow<'a>(&'a self) -> &'a str {\n    self.name\n    // trailing\n}"],
  ["a char literal ('\\'') is consumed whole", "fn tick(&self) -> char {\n    let c = '\\'';\n    c\n}"],
  ["a // comment containing a lone quote does not open a string", 'fn f(&self) -> u8 {\n    // don\'t "worry\n    2\n}'],
  ["an identifier ending in r before a string is not a raw-string prefix", 'fn f(&self) -> usize {\n    let ptr = "x";\n    ptr.len()\n}'],
];

for (const [name, body] of SHAPE_CASES) {
  test(`reindentRustBody: ${name}`, () => {
    assert.strictEqual(reindentRustBody(body, "        "), prepended(body, "        "));
  });
}

// --- puntDiagnosis ---------------------------------------------------------

const DIAGNOSIS_CASES = [
  {
    name: "a // comment carrying the model's reason (the capture's shape)",
    code: "fn f(&self) -> u64 {\n    // we don't have access to the actual cache state\n    todo!()\n}",
    want: "we don't have access to the actual cache state",
  },
  {
    name: "a Python # comment",
    code: "def f(self):\n    # the caller never passes the registry\n    raise NotImplementedError",
    want: "the caller never passes the registry",
  },
  {
    name: "a message inside the stub macro itself",
    code: 'fn f() {\n    unimplemented!("needs the segment index")\n}',
    want: "needs the segment index",
  },
  {
    name: "a C# NotImplementedException message",
    code: 'void F() {\n    throw new NotImplementedException("no repository was injected");\n}',
    want: "no repository was injected",
  },
];

for (const c of DIAGNOSIS_CASES) {
  test(`puntDiagnosis lifts the model's reason: ${c.name}`, () => {
    const got = puntDiagnosis(c.code);
    assert.ok(got !== undefined && got.includes(c.want), `wanted ${JSON.stringify(c.want)}, got ${JSON.stringify(got)}`);
  });
}

test("puntDiagnosis: a stub that explained nothing yields undefined, so the message falls back rather than lying", () => {
  assert.strictEqual(puntDiagnosis("fn f() -> u64 {\n    todo!()\n}"), undefined);
});

test("puntDiagnosis: a Rust attribute is not prose — #[derive(Debug)] never reads as a reason", () => {
  assert.strictEqual(puntDiagnosis("#[derive(Debug)]\nfn f() {\n    todo!()\n}"), undefined);
});

// ===========================================================================
// B — the preview seam: the extension activated against a stub vscode with a
// fake in-process Ollama. The proposal presenter writes the spliced full text
// into its TextDocumentContentProvider before it opens the diff, so the text
// a generation actually proposes IS observable from outside. This is the seam
// item 9 needs and the oracle did not find.
// ===========================================================================

const STUB = path.join(__dirname, ".impl-v24-p3-stub.cjs");
fs.writeFileSync(
  STUB,
  `
const state = {
  config: {}, messages: [], commands: {}, executeCalls: [], commandHandlers: {},
  outputLines: [], contentProviders: {}, textDocuments: [], visibleTextEditors: [],
  activeTextEditor: undefined,
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
  appendCodeblock(t, lang) { this.value += "\\n" + t; }
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
      const docs = globalThis.__IMPL_V24P3_DOCS__ || {};
      if (docs[key]) return docs[key];
      return { uri: typeof arg === "string" ? Uri.parse(arg) : arg, languageId: "plaintext", version: 1, lineCount: 1, getText: () => "", save: async () => true };
    },
    applyEdit: async () => true,
    get workspaceFolders() { return [{ uri: Uri.file("/proj"), name: "proj", index: 0 }]; },
    asRelativePath: (u) => String(u),
    createFileSystemWatcher: () => ({ onDidChange: () => disposable(), onDidCreate: () => disposable(), onDidDelete: () => disposable(), dispose() {} }),
    fs: { stat: async () => ({ type: 1 }), readFile: async () => new Uint8Array() },
  },
  languages: {
    createDiagnosticCollection: (name) => ({ name, set() {}, delete() {}, clear() {}, dispose() {} }),
    registerInlineCompletionItemProvider: () => disposable(),
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
    showTextDocument: async (docOrUri) => ({ document: docOrUri, selection: new Selection(new Position(0, 0), new Position(0, 0)), options: {}, viewColumn: 1, edit: async () => true, insertSnippet: async () => true, setDecorations() {}, revealRange() {} }),
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
`,
);

const ENTRY = path.join(__dirname, ".impl-v24-p3.entry.ts");
const OUT = path.join(__dirname, ".impl-v24-p3.bundle.cjs");
let X = {};
let xErr;
try {
  fs.writeFileSync(
    ENTRY,
    `export { activate } from "../src/vscode/extension";
export { __state, Position, Range, Selection, Uri } from "vscode";\n`,
  );
  esbuild.buildSync({ entryPoints: [ENTRY], bundle: true, outfile: OUT, format: "cjs", platform: "node", alias: { vscode: STUB } });
  X = require(OUT);
} catch (e) {
  xErr = e;
}
test.after(() => [STUB, ENTRY, OUT].forEach((f) => fs.rmSync(f, { force: true })));

test("harness guard: the extension bundle builds and activates against the stub", async () => {
  if (xErr) assert.fail(`the surface is not buildable: ${xErr.message}`);
  await harness();
});

const xtest = (name, fn) =>
  test(name, (ctx) => (xErr ? ctx.skip("extension bundle failed; see the harness guard") : fn(ctx)));

const MODELS = ["fake-fim", "fake-30b", "fake-14b"];
function startServer() {
  const srv = { requests: [], replyFor: null };
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", () => {
      let body;
      try {
        body = raw ? JSON.parse(raw) : undefined;
      } catch {
        body = { raw };
      }
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
const waitFor = async (predicate, tries = 200) => {
  for (let i = 0; i < tries; i++) {
    if (predicate()) return true;
    await sleep(25);
  }
  return false;
};

let harnessP;
let srv;
const harness = () =>
  (harnessP ||= (async () => {
    if (xErr) throw xErr;
    srv = await startServer();
    X.__state.config = {
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
    await X.activate({
      subscriptions: [],
      globalState: mem,
      workspaceState: mem,
      secrets: { get: async () => undefined, store: async () => {}, delete: async () => {}, onDidChange: () => ({ dispose() {} }) },
      extensionUri: X.Uri.file("/ext"),
      extensionPath: "/ext",
      extensionMode: 1,
      asAbsolutePath: (p) => "/ext/" + p,
      globalStorageUri: X.Uri.file("/tmp/impl-v24-p3-storage"),
      logUri: X.Uri.file("/tmp/impl-v24-p3-log"),
      environmentVariableCollection: { replace() {}, append() {}, prepend() {}, clear() {} },
    });
    await waitFor(() => typeof X.__state.commands["column80.generateFunction"] === "function");
    await waitFor(() => X.__state.outputLines.some((l) => l.includes("tier=")));
    return srv;
  })());

test.after(async () => {
  try {
    if (srv) await srv.close();
  } catch {}
});

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
      if (off <= o + lines[l].length) return new X.Position(l, off - o);
      o += lines[l].length + 1;
    }
    return new X.Position(lines.length - 1, lines[lines.length - 1].length);
  };
  return {
    uri: X.Uri.parse(uriStr),
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
        range: new X.Range(n, 0, n, t.length),
        rangeIncludingLineBreak: new X.Range(n, 0, n + 1, 0),
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
      return e > s ? new X.Range(pos.line, s, pos.line, e) : undefined;
    },
  };
}

const posOf = (text, needle) => {
  const idx = text.indexOf(needle);
  assert.ok(idx >= 0, `fixture needle not found: ${JSON.stringify(needle)}`);
  const before = text.slice(0, idx);
  return new X.Position((before.match(/\n/g) || []).length, idx - (before.lastIndexOf("\n") + 1));
};
const vr = (sl, sc, el, ec) => new X.Range(sl, sc, el, ec);
const dsym = (name, kind, range, selectionRange, children = [], detail = "") => ({ name, detail, kind, range, selectionRange, children });

/**
 * Drive one generateFunction gesture and return the text the proposal PREVIEW
 * holds. That preview is the whole document with the span replaced by what the
 * generation proposes, written before the diff opens, so it is exactly the
 * bytes the human is asked to consent to.
 */
async function proposedDocument({ doc, uri, cursor, symbols, reply }) {
  await harness();
  X.__state.commandHandlers = {
    "vscode.executeDocumentSymbolProvider": () => symbols,
    "vscode.executeDefinitionProvider": () => undefined,
    "vscode.executeHoverProvider": () => undefined,
    "vscode.executeCompletionItemProvider": () => undefined,
    "vscode.executeCodeActionProvider": () => undefined,
  };
  X.__state.messages.length = 0;
  X.__state.executeCalls.length = 0;
  X.__state.outputLines.length = 0;
  globalThis.__IMPL_V24P3_DOCS__ = { [uri]: doc };
  const editor = {
    document: doc,
    selection: new X.Selection(cursor, cursor),
    selections: [new X.Selection(cursor, cursor)],
    options: { tabSize: 4, insertSpaces: true },
    viewColumn: 1,
    edit: async () => true,
    insertSnippet: async () => true,
    setDecorations() {},
    revealRange() {},
  };
  X.__state.activeTextEditor = editor;
  X.__state.textDocuments = [doc];
  X.__state.visibleTextEditors = [editor];
  srv.requests.length = 0;
  srv.replyFor = reply;
  // present() never settles without a human gesture, so the gesture runs
  // detached and the preview is read once the diff call has been made.
  void Promise.resolve()
    .then(() => X.__state.commands["column80.generateFunction"]())
    .catch(() => {});
  const opened = await waitFor(() => X.__state.executeCalls.some((c) => c.id === "vscode.diff"), 120);
  const lines = X.__state.outputLines.slice();
  assert.ok(opened, `no proposal was ever presented. CHANNEL:\n${lines.join("\n")}`);
  const diff = X.__state.executeCalls.find((c) => c.id === "vscode.diff");
  const provider = X.__state.contentProviders["column80-fngen"];
  assert.ok(provider, "the presenter must register its preview content provider");
  const text = await provider.provideTextDocumentContent(diff.args[1]);
  // Settle the pending gesture so it cannot bleed into the next row.
  const reject = X.__state.commands["column80.proposalReject"];
  if (typeof reject === "function") {
    try {
      await reject(diff.args[1]);
    } catch {}
  }
  return { text, lines };
}

const PY_URI = "file:///proj/src/cache.py";

// item 9 — the gap v13 left: a Python target with NO docstring resolves as
// kind=function and bodyOnly=false, which fell through every re-indent branch.
xtest("item 9: a nested Python plain function (no docstring) is re-indented to the anchor depth before it is proposed", async () => {
  const text = "class Cache:\n    def total(self, key):\n        \n";
  const clsSig = posOf(text, "class Cache");
  const mSig = posOf(text, "    def total");
  const doc = makeDoc(text, PY_URI, "python");
  const method = dsym("total", 5, vr(mSig.line, 4, mSig.line + 1, 8), vr(mSig.line, 8, mSig.line, 8 + "total".length));
  const symbols = [dsym("Cache", 4, vr(clsSig.line, 0, mSig.line + 1, 8), vr(clsSig.line, 6, clsSig.line, 6 + "Cache".length), [method])];
  const { text: proposed } = await proposedDocument({
    doc,
    uri: PY_URI,
    cursor: new X.Position(mSig.line + 1, 8),
    symbols,
    reply: () => "```python\ndef total(self, key):\n    return self.items[key]\n```",
  });
  assert.ok(
    proposed.includes("\n        return self.items[key]"),
    `the body landed at the model's flush-left column, which is an IndentationError in the buffer. PROPOSED:\n${proposed}`,
  );
  assert.ok(
    proposed.includes("\n    def total(self, key):"),
    `the header line must keep the document's own indent, never gain a second copy. PROPOSED:\n${proposed}`,
  );
});

// The regression bar for the same dispatch: widening it from "type kinds only"
// to "every non-bodyOnly Python target" must not move a top-level function.
xtest("item 9 (regression bar): a TOP-LEVEL Python function is proposed byte-for-byte, unshifted", async () => {
  const uri = "file:///proj/src/free.py";
  const text = "def total(key):\n    \n";
  const sig = posOf(text, "def total");
  const doc = makeDoc(text, uri, "python");
  const symbols = [dsym("total", 11, vr(sig.line, 0, sig.line + 1, 4), vr(sig.line, 4, sig.line, 4 + "total".length))];
  const { text: proposed } = await proposedDocument({
    doc,
    uri,
    cursor: new X.Position(sig.line + 1, 4),
    symbols,
    reply: () => "```python\ndef total(key):\n    return key\n```",
  });
  assert.ok(
    proposed.includes("def total(key):\n    return key"),
    `a top-level target must not move by a single byte. PROPOSED:\n${proposed}`,
  );
});

// Fix 5, end to end: the leg exists AND the Rust generate path calls it. The
// capture's defect was the body at column 4 under a column-4 signature inside
// an impl block, with the closing brace at column 0.
xtest("fix 5 (wiring): a Rust method inside an impl block is re-indented before it is proposed", async () => {
  const uri = "file:///proj/src/log_segments_cache.rs";
  const text = "impl LogSegmentsCache {\n    fn wal_seq(&self) -> u64 {\n\n    }\n}\n";
  const implSig = posOf(text, "impl LogSegmentsCache");
  const mSig = posOf(text, "    fn wal_seq");
  const doc = makeDoc(text, uri, "rust");
  const method = dsym("wal_seq", 5, vr(mSig.line, 4, mSig.line + 2, 5), vr(mSig.line, 7, mSig.line, 7 + "wal_seq".length));
  const symbols = [
    dsym("LogSegmentsCache", 4, vr(implSig.line, 0, mSig.line + 3, 1), vr(implSig.line, 5, implSig.line, 5 + "LogSegmentsCache".length), [method]),
  ];
  const { text: proposed } = await proposedDocument({
    doc,
    uri,
    cursor: new X.Position(mSig.line + 1, 0),
    symbols,
    reply: () => "```rust\nfn wal_seq(&self) -> u64 {\n    self.hi\n}\n```",
  });
  assert.ok(
    proposed.includes("\n        self.hi"),
    `the Rust body must land one level under its signature, not at the model's column. PROPOSED:\n${proposed}`,
  );
  assert.ok(
    proposed.includes("\n    }"),
    `the closing brace must land at the signature's column, not at column 0. PROPOSED:\n${proposed}`,
  );
});
