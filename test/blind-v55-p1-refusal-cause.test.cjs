// Blind oracle, session-v55 phase 1: "fn-gen refusals name their real cause".
// Contract: session-v55/contract-phase1.md.
//
// `executeDocumentSymbolProvider` is the ONLY thing the resolver asks, and its
// answer splits four ways. Today all four collapse to one `undefined` return and
// every gesture renders the same "move your cursor" toast, so a first-run user
// with no language server installed is told to fix something that was already
// right. This file pins the split.
//
// BLIND DISCIPLINE. The contract says the cause must be exposed to callers but
// deliberately does not dictate a shape (a tagged return, a second out-param, a
// thrown value - all satisfy it). So nothing here binds to a function name, a
// return type, or an internal slug constant. Every assertion is on the two
// things a USER can see:
//   - the warning text the gesture shows, and
//   - the `[fngen] refused: ` line on the extension's own output channel.
// The four causes are driven purely by what the stubbed symbol provider answers:
//   undefined -> no-provider
//   []        -> empty-tree
//   flat SymbolInformation[] (no selectionRange, no children) -> flat-symbols
//   good hierarchy, cursor outside every symbol -> no-symbol-at-cursor
//
// EXPECTED RED until phase 1 lands. Every failure below should read as "the
// product still shows one message / logs nothing", never as a harness fault -
// the two harness-guard tests at the top exist to make that distinction loud.
//
// Run: SKIP_LIVE=1 node --test test/blind-v55-p1-refusal-cause.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");

// ---------------------------------------------------------------------------
// The vscode stub. Structural Position/Range (so Range.contains does real span
// math), a settable `state.symbols` that the symbol-provider command answers
// with VERBATIM - including `undefined` - and full capture of every user-facing
// channel: showWarningMessage / showInformationMessage / showErrorMessage.
// ---------------------------------------------------------------------------

const STUB = path.join(__dirname, ".blind-v55-p1-stub.cjs");
fs.writeFileSync(
  STUB,
  `
const state = {
  config: {}, messages: [], commands: {}, activeTextEditor: undefined,
  snippetInserts: [], appliedEdits: [], executeCalls: [], terminals: [],
  textDocuments: [], warnResponses: [],
  // Deliberately a distinct sentinel from undefined so a test that forgets to
  // set symbols cannot masquerade as the no-provider case.
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
      has: () => false, inspect: () => undefined, update: async () => {},
    }),
    onDidChangeConfiguration: () => ({ dispose() {} }),
    onDidChangeTextDocument: () => ({ dispose() {} }),
    onDidCloseTextDocument: () => ({ dispose() {} }),
    registerTextDocumentContentProvider: () => ({ dispose() {} }),
    get textDocuments() { return state.textDocuments; },
    get workspaceFolders() { return [{ uri: Uri.file("/w"), name: "w", index: 0 }]; },
    getWorkspaceFolder: () => ({ uri: Uri.file("/w"), name: "w", index: 0 }),
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
      if (id === "vscode.executeDocumentSymbolProvider") {
        if (!state.symbolsSet) throw new Error("harness fault: a test drove a gesture without setting state.symbols");
        return state.symbols;
      }
      return undefined;
    },
  },
};
`,
);

const entry = path.join(__dirname, ".blind-v55-p1.entry.ts");
const outfile = path.join(__dirname, ".blind-v55-p1.bundle.cjs");
let bundleErr;
let registerFnGen;
let resolveFunctionAtCursor;
let ContextBlockStore;
let __state;
let Position;
let Range;
try {
  fs.writeFileSync(
    entry,
    `export { registerFnGen, resolveFunctionAtCursor } from "../src/vscode/fnGen";
export { ContextBlockStore } from "../src/core/contextBlocks";
export { __state, Position, Range } from "vscode";\n`,
  );
  esbuild.buildSync({ entryPoints: [entry], bundle: true, outfile, format: "cjs", platform: "node", alias: { vscode: STUB } });
  ({ registerFnGen, resolveFunctionAtCursor, ContextBlockStore, __state, Position, Range } = require(outfile));
} catch (e) {
  bundleErr = e;
}

test.after(() => {
  for (const f of [entry, outfile, STUB]) fs.rmSync(f, { force: true });
});

// ---------------------------------------------------------------------------
// Fixtures: one function per language, a cursor inside it, and a cursor far
// below it. The bodies are irrelevant to every refusal (the provider answer is
// what splits the cause) but they are real so the success-path rung is real.
// ---------------------------------------------------------------------------

const FIXTURES = {
  rust: {
    uri: "file:///w/src/lib.rs",
    src: "/// Adds two numbers.\npub fn add(a: i32, b: i32) -> i32 {\n    a + b\n}\n\n// nothing here\n",
    // range covers the doc + fn (rust-analyzer includes `///` in the range).
    range: [0, 0, 3, 1],
    nameRange: [1, 7, 1, 10],
    kind: 11, // Function
    inside: [2, 4],
  },
  go: {
    uri: "file:///w/pkg/add.go",
    src: "package pkg\n\n// Add adds two numbers.\nfunc Add(a int, b int) int {\n\treturn a + b\n}\n\n// nothing here\n",
    range: [3, 0, 5, 1],
    nameRange: [3, 5, 3, 8],
    kind: 11,
    inside: [4, 3],
  },
  csharp: {
    uri: "file:///w/Calc.cs",
    src: "namespace W;\npublic class Calc\n{\n    public int Add(int a, int b)\n    {\n        return a + b;\n    }\n}\n\n// nothing here\n",
    range: [3, 4, 6, 5],
    nameRange: [3, 15, 3, 18],
    kind: 5, // Method
    inside: [5, 8],
  },
  python: {
    uri: "file:///w/calc.py",
    src: '"""Module."""\n\n\ndef add(a: int, b: int) -> int:\n    """Adds two numbers."""\n    return a + b\n\n\n# nothing here\n',
    range: [3, 0, 5, 16],
    nameRange: [3, 4, 3, 7],
    kind: 11,
    inside: [5, 8],
  },
  typescript: {
    uri: "file:///w/src/calc.ts",
    src: "/** Adds two numbers. */\nexport function add(a: number, b: number): number {\n  return a + b;\n}\n\n// nothing here\n",
    range: [0, 0, 3, 1],
    nameRange: [1, 16, 1, 19],
    kind: 11,
    inside: [2, 4],
  },
  javascript: {
    uri: "file:///w/src/calc.js",
    src: "/** Adds two numbers. */\nexport function add(a, b) {\n  return a + b;\n}\n\n// nothing here\n",
    range: [0, 0, 3, 1],
    nameRange: [1, 16, 1, 19],
    kind: 11,
    inside: [2, 4],
  },
};

const R = (a) => new Range(a[0], a[1], a[2], a[3]);
const P = (a) => new Position(a[0], a[1]);

// A cursor on the last line of every fixture: after the closing brace, inside
// no symbol at all. This is the ONLY cause that is genuinely the human's fault.
const outsideCursor = (fx) => {
  const lines = fx.src.split("\n");
  return [lines.length - 2, 0];
};

function makeDoc(fx, languageId) {
  const src = fx.src;
  const lineStarts = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === "\n") lineStarts.push(i + 1);
  const offsetAt = (pos) => Math.min((lineStarts[pos.line] ?? src.length) + pos.character, src.length);
  const fsPath = fx.uri.replace(/^file:\/\//, "");
  return {
    languageId,
    version: 1,
    isDirty: false,
    isClosed: false,
    lineCount: src.split("\n").length,
    fileName: fsPath,
    uri: { fsPath, path: fsPath, scheme: "file", toString: () => fx.uri, with() { return this; } },
    getText(range) {
      return range ? src.slice(offsetAt(range.start), offsetAt(range.end)) : src;
    },
    offsetAt,
    positionAt(offset) {
      let line = 0;
      while (line + 1 < lineStarts.length && lineStarts[line + 1] <= offset) line++;
      return new Position(line, offset - lineStarts[line]);
    },
    lineAt(arg) {
      const n = typeof arg === "number" ? arg : arg.line;
      const text = src.split("\n")[n] ?? "";
      const m = text.match(/\S/);
      return {
        lineNumber: n,
        text,
        range: new Range(n, 0, n, text.length),
        firstNonWhitespaceCharacterIndex: m ? m.index : text.length,
        isEmptyOrWhitespace: !m,
      };
    },
    save: async () => true,
  };
}

// ---- the four provider answers, as functions of a fixture -----------------

const hierarchy = (fx) => [
  { name: "add", detail: "", kind: fx.kind, range: R(fx.range), selectionRange: R(fx.nameRange), children: [] },
];
// The SymbolInformation shape a non-hierarchical server returns: a flat list,
// `location` instead of `range`, and NO selectionRange / NO children. The
// location deliberately COVERS the cursor, so this can never be mistaken for
// the no-symbol-at-cursor case.
const flatSymbols = (fx) => [
  { name: "add", kind: fx.kind, containerName: "", location: { uri: { toString: () => fx.uri }, range: R(fx.range) } },
];

const PROVIDER_ANSWERS = {
  "no-provider": () => undefined,
  "empty-tree": () => [],
  "flat-symbols": flatSymbols,
  "no-symbol-at-cursor": hierarchy,
};

// ---------------------------------------------------------------------------
// Driving a gesture. All four gestures need a RESOLVED tier before they will so
// much as consult the symbol provider (impl5's fail-closed rule), so the tier
// flow is injected, never probed. The service records calls and returns nothing:
// a refusal must never reach it, and the success rung asserts it WAS reached.
// ---------------------------------------------------------------------------

const GEN = "column80.generateFunction";
const REPAIR = "column80.repairFunction";
const TDD_GEN = "column80.generateTests";
const TDD_RUN = "column80.runTddTests";
const ALL_GESTURES = [GEN, REPAIR, TDD_GEN, TDD_RUN];

const REFUSAL_PREFIX = "[fngen] refused: ";

const waitFor = async (predicate, tries = 200) => {
  for (let i = 0; i < tries; i++) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, 5));
  }
  return false;
};

async function drive({ command, languageId = "rust", answer = "no-provider", cursor, config = {} }) {
  const fx = FIXTURES[languageId];
  assert.ok(fx, `harness: no fixture for ${languageId}`);
  const doc = makeDoc(fx, languageId);

  __state.config = { repairEnabled: true, compilerDirectedInjection: false, apiBase: "http://127.0.0.1:9", ...config };
  __state.messages = [];
  __state.commands = {};
  __state.executeCalls = [];
  __state.appliedEdits = [];
  __state.snippetInserts = [];
  __state.terminals = [];
  __state.textDocuments = [doc];
  __state.warnResponses = [];
  __state.symbols = PROVIDER_ANSWERS[answer](fx);
  __state.symbolsSet = true;

  const lines = [];
  const output = { lines, appendLine: (l) => lines.push(l), append() {}, show() {}, clear() {}, dispose() {} };
  const serviceCalls = [];
  const oracleCalls = [];
  const service = {
    dispose() {},
    logOutcome() {},
    get modelTag() { return "fake-30b"; },
    generate: async (req) => { serviceCalls.push({ how: "generate", req }); return undefined; },
    generateRaw: async (req) => { serviceCalls.push({ how: "generateRaw", req }); return undefined; },
  };

  registerFnGen({ subscriptions: [], globalStorageUri: { fsPath: "/w/.storage" } }, output, new ContextBlockStore(() => {}), {
    buildService: async () => ({ service, tier: { id: "24gb", fnGenEnabled: true, fnGenModel: "fake-30b", provisional: false, message: "ok" }, config: {} }),
    // The repair gesture pre-flights the server; keep it UP so the refusal under
    // test is the resolver's, not a server-down message.
    listModels: async () => ["fake-30b"],
    ollamaCheck: async () => ({ stdout: "ollama version 0.0.0", exitCode: 0 }),
    runOracle: async (ctx) => { oracleCalls.push(ctx); },
  });
  await waitFor(() => typeof __state.commands[command] === "function");

  const active = cursor ?? fx.inside;
  __state.activeTextEditor = {
    document: doc,
    viewColumn: 1,
    selection: selectionAt(active),
    insertSnippet: async (snippet, range) => { __state.snippetInserts.push({ value: snippet.value, range }); return true; },
    revealRange: () => {},
    edit: async () => true,
  };

  const cmd = __state.commands[command];
  assert.strictEqual(typeof cmd, "function", `harness: ${command} is not registered`);
  await cmd();
  // Some gestures finish their user-facing message on a later microtask turn.
  await new Promise((r) => setTimeout(r, 20));

  const warnings = __state.messages.filter((m) => m.kind === "warn").map((m) => m.message);
  const refusalLines = lines.filter((l) => l.startsWith(REFUSAL_PREFIX));
  // The prompt-budget leg emits a DIFFERENTLY SHAPED line under the same
  // `[fngen] refused: ` prefix, so the two are separated here: refusalLines is
  // the contract-item-7 population (the prefix, as the contract words it), and
  // causeLines is the subset that actually declares a cause. Counting the broad
  // population on a refusal path stays right - a refusal never reaches a budget
  // - while the success rungs assert on causeLines so an unrelated budget line
  // can never fake a red.
  const causeLines = refusalLines.filter((l) => /cause=/.test(l));
  const consultedProvider = __state.executeCalls.some((c) => c.id === "vscode.executeDocumentSymbolProvider");
  return { lines, warnings, refusalLines, causeLines, serviceCalls, oracleCalls, consultedProvider, messages: __state.messages };
}

// A minimal empty Selection at the cursor (start == end == active == anchor).
function selectionAt(a) {
  const p = P(a);
  const sel = new Range(p, p);
  sel.active = p;
  sel.anchor = p;
  return sel;
}

// The single warning a refusal shows. Item 2 is about "the message", singular,
// so more than one warning on a refusal is itself a contract violation.
function soleWarning(r, what) {
  assert.strictEqual(
    r.warnings.length,
    1,
    `${what}: a refusal must show exactly ONE warning (the cause's message). Got ${JSON.stringify(r.warnings)}`,
  );
  return r.warnings[0];
}

// The declared cause on a refusal line, read as a WHOLE field rather than a
// tail-substring: `cause=no-provider (rust)` -> "no-provider". A substring read
// would let `no-symbol-at-cursor` satisfy a test asking for `cursor`, and would
// happily "parse" a slug out of a line that never declared one.
function slugOf(line) {
  const m = /cause=([a-z-]+)/.exec(line);
  return m ? m[1] : undefined;
}

// Item 7: exactly one `[fngen] refused: ` line, declaring exactly this cause.
function assertRefusalLine(r, slug, what) {
  assert.strictEqual(
    r.refusalLines.length,
    1,
    `${what}: exactly one "${REFUSAL_PREFIX}" channel line per refusal (contract item 7). Got ${JSON.stringify(r.refusalLines)} out of ${JSON.stringify(r.lines)}`,
  );
  assert.strictEqual(
    slugOf(r.refusalLines[0]),
    slug,
    `${what}: the refusal line must declare cause=${slug}. Got ${JSON.stringify(r.refusalLines[0])}`,
  );
}

const gtest = (name, fn) =>
  test(name, async () => {
    if (bundleErr) assert.fail(`harness bundle failed to build (see the bundle guard test): ${bundleErr.message}`);
    return fn();
  });

// ===========================================================================
// Harness guards. If either of these is red, EVERY failure below is suspect.
// ===========================================================================

test("harness guard: the fnGen surface bundles headless against the vscode stub", () => {
  if (bundleErr) assert.fail(`bundle failed: ${bundleErr.stack || bundleErr.message}`);
});

gtest("harness guard: all four gestures register, and a good hierarchy with the cursor INSIDE resolves (so the fixtures are real)", async () => {
  const r = await drive({ command: GEN, answer: "no-symbol-at-cursor" });
  for (const id of ALL_GESTURES) {
    assert.strictEqual(typeof __state.commands[id], "function", `${id} must be registered`);
  }
  const fx = FIXTURES.rust;
  const doc = makeDoc(fx, "rust");
  __state.symbols = hierarchy(fx);
  __state.symbolsSet = true;
  const resolved = await resolveFunctionAtCursor(doc, P(fx.inside), true);
  assert.ok(resolved, "the rust fixture must resolve with the cursor inside the function; if not, every case below is measuring the harness");
  assert.ok(r.consultedProvider, "the gesture must actually consult the symbol provider (else the tier gate, not the resolver, is what refused)");
});

// ===========================================================================
// The four causes, driven through the GENERATE gesture.
// Items 1, 2, 4, 5, 6, 7.
// ===========================================================================

// NOTE on wording: `undefined` back from executeDocumentSymbolProvider does not
// PROVE the extension is absent - VS Code collapses an empty result to undefined
// before an extension sees it, so a healthy server over a symbol-less file lands
// here too. The contract's requirement is that the message NAME the expected
// server for the language, not that it accuse the user of not installing it, so
// that is all this asserts.
gtest("cause no-provider (provider returned undefined): the message names the language's server, NOT the cursor, and logs the slug", async () => {
  const r = await drive({ command: GEN, answer: "no-provider" });
  const msg = soleWarning(r, "no-provider");
  assert.match(msg, /rust-analyzer/i, `a rust document with no provider must name rust-analyzer. Got ${JSON.stringify(msg)}`);
  assert.ok(
    !/cursor/i.test(msg),
    `a missing language server is not the human's cursor; the message must not blame it. Got ${JSON.stringify(msg)}`,
  );
  assertRefusalLine(r, "no-provider", "no-provider");
  assert.deepStrictEqual(r.serviceCalls, [], "a refusal never reaches the model");
});

gtest("cause empty-tree (provider returned []): the message says the server may still be indexing, tells nobody to install anything, and blames no cursor", async () => {
  const r = await drive({ command: GEN, answer: "empty-tree" });
  const msg = soleWarning(r, "empty-tree");
  assert.match(msg, /index/i, `contract item 4: empty-tree must say the server may still be indexing. Got ${JSON.stringify(msg)}`);
  assert.ok(!/install/i.test(msg), `item 4: an up-but-empty server must not tell the user to install anything. Got ${JSON.stringify(msg)}`);
  assert.ok(!/cursor/i.test(msg), `item 4: an up-but-empty server must not blame the cursor. Got ${JSON.stringify(msg)}`);
  assertRefusalLine(r, "empty-tree", "empty-tree");
  assert.deepStrictEqual(r.serviceCalls, [], "a refusal never reaches the model");
});

gtest("cause flat-symbols (SymbolInformation[], no selectionRange): the message keeps today's meaning - a HIERARCHICAL document symbol provider is required", async () => {
  const r = await drive({ command: GEN, answer: "flat-symbols" });
  const msg = soleWarning(r, "flat-symbols");
  assert.match(msg, /hierarch/i, `contract item 5: flat-symbols must say the language needs a hierarchical document symbol provider. Got ${JSON.stringify(msg)}`);
  assert.match(msg, /symbol/i, `item 5: the message names document symbols. Got ${JSON.stringify(msg)}`);
  assert.ok(!/cursor/i.test(msg), `item 5: a flat server shape is not the human's cursor. Got ${JSON.stringify(msg)}`);
  assertRefusalLine(r, "flat-symbols", "flat-symbols");
  assert.deepStrictEqual(r.serviceCalls, [], "a refusal never reaches the model");
});

// Type admission rides `compilerDirectedInjection` (the setting the gesture
// reads to decide whether a struct/enum header is a generatable target). The
// contract's item 6 wording is the admission-ON branch, so it is set here.
gtest("cause no-symbol-at-cursor (good hierarchy, cursor outside every symbol, type admission ON): today's wording survives - cursor, function, generatable type header", async () => {
  const fx = FIXTURES.rust;
  const r = await drive({
    command: GEN,
    answer: "no-symbol-at-cursor",
    cursor: outsideCursor(fx),
    config: { compilerDirectedInjection: true },
  });
  const msg = soleWarning(r, "no-symbol-at-cursor");
  assert.match(msg, /cursor/i, `contract item 6: this is the one case that IS the cursor, and the wording must not regress. Got ${JSON.stringify(msg)}`);
  assert.match(msg, /function/i, `item 6: the message names a function. Got ${JSON.stringify(msg)}`);
  assert.match(msg, /type header/i, `item 6: with type admission on it still names a generatable type header. Got ${JSON.stringify(msg)}`);
  // Anti-swap: generate's wording must not be another gesture's.
  assert.ok(!/repair/i.test(msg), `generate must not borrow repair's wording. Got ${JSON.stringify(msg)}`);
  assert.ok(!/TDD/i.test(msg), `generate must not borrow a TDD gesture's wording. Got ${JSON.stringify(msg)}`);
  assertRefusalLine(r, "no-symbol-at-cursor", "no-symbol-at-cursor");
  assert.deepStrictEqual(r.serviceCalls, [], "a refusal never reaches the model");
});

gtest("cause no-symbol-at-cursor (type admission OFF): the function-only wording survives, and it still logs the no-symbol-at-cursor slug", async () => {
  const fx = FIXTURES.rust;
  const r = await drive({ command: GEN, answer: "no-symbol-at-cursor", cursor: outsideCursor(fx) });
  const msg = soleWarning(r, "no-symbol-at-cursor/admission-off");
  assert.match(msg, /cursor/i, `item 6: the admission-off branch still names the cursor. Got ${JSON.stringify(msg)}`);
  assert.match(msg, /function/i, `item 6: the admission-off branch still names a function. Got ${JSON.stringify(msg)}`);
  assert.ok(
    !/rust-analyzer|hierarch|index/i.test(msg),
    `item 6: this cause is the human's cursor, so it must not borrow another cause's blame. Got ${JSON.stringify(msg)}`,
  );
  // Anti-swap: with admission OFF there is no type target, so the type-header
  // clause must not leak in, and neither may another gesture's wording.
  assert.ok(!/type header/i.test(msg), `item 6: admission off has no generatable type target. Got ${JSON.stringify(msg)}`);
  assert.ok(!/repair/i.test(msg), `generate must not borrow repair's wording. Got ${JSON.stringify(msg)}`);
  assert.ok(!/TDD/i.test(msg), `generate must not borrow a TDD gesture's wording. Got ${JSON.stringify(msg)}`);
  assertRefusalLine(r, "no-symbol-at-cursor", "no-symbol-at-cursor/admission-off");
});

gtest("item 2: the four causes produce four PAIRWISE DISTINCT user-facing messages (today all four are the same string)", async () => {
  const fx = FIXTURES.rust;
  const seen = {};
  for (const answer of ["no-provider", "empty-tree", "flat-symbols", "no-symbol-at-cursor"]) {
    const r = await drive({
      command: GEN,
      answer,
      cursor: answer === "no-symbol-at-cursor" ? outsideCursor(fx) : undefined,
    });
    assert.ok(r.warnings.length >= 1, `${answer} must show the user something, not refuse in silence`);
    seen[answer] = r.warnings.join(" | ");
  }
  const distinct = new Set(Object.values(seen));
  assert.strictEqual(
    distinct.size,
    4,
    `contract item 2: no two causes may share a message. Got:\n${Object.entries(seen).map(([k, v]) => `  ${k}: ${JSON.stringify(v)}`).join("\n")}`,
  );
});

gtest("item 7: the four refusals log four DISTINCT slugs, one line each (today this branch logs nothing at all)", async () => {
  const fx = FIXTURES.rust;
  const slugs = [];
  for (const answer of ["no-provider", "empty-tree", "flat-symbols", "no-symbol-at-cursor"]) {
    const r = await drive({
      command: GEN,
      answer,
      cursor: answer === "no-symbol-at-cursor" ? outsideCursor(fx) : undefined,
    });
    assert.strictEqual(r.refusalLines.length, 1, `${answer}: exactly one "${REFUSAL_PREFIX}" line. Got ${JSON.stringify(r.refusalLines)}`);
    const slug = slugOf(r.refusalLines[0]);
    assert.ok(slug, `${answer}: the refusal line must declare a cause= field. Got ${JSON.stringify(r.refusalLines[0])}`);
    slugs.push(slug);
  }
  assert.strictEqual(new Set(slugs).size, 4, `the channel must distinguish all four causes. Got ${JSON.stringify(slugs)}`);
});

// ===========================================================================
// Item 3: the language-server naming table for no-provider.
// One test per row so a single wrong row reads as a single named failure.
// ===========================================================================

gtest("item 3 (rust): no-provider names rust-analyzer", async () => {
  const msg = soleWarning(await drive({ command: GEN, languageId: "rust", answer: "no-provider" }), "rust/no-provider");
  assert.match(msg, /rust-analyzer/i, `Got ${JSON.stringify(msg)}`);
});

gtest("item 3 (go): no-provider names gopls", async () => {
  const msg = soleWarning(await drive({ command: GEN, languageId: "go", answer: "no-provider" }), "go/no-provider");
  assert.match(msg, /gopls/i, `Got ${JSON.stringify(msg)}`);
});

gtest("item 3 (csharp): no-provider names the C# extension / Roslyn", async () => {
  const msg = soleWarning(await drive({ command: GEN, languageId: "csharp", answer: "no-provider" }), "csharp/no-provider");
  assert.match(msg, /C#|Roslyn/i, `a csharp document must name the C# extension or Roslyn. Got ${JSON.stringify(msg)}`);
});

gtest("item 3 (python): no-provider names Pylance", async () => {
  const msg = soleWarning(await drive({ command: GEN, languageId: "python", answer: "no-provider" }), "python/no-provider");
  assert.match(msg, /Pylance/i, `Got ${JSON.stringify(msg)}`);
});

gtest("item 3 (typescript): no-provider names the BUILT-IN TypeScript language features and never tells the user to install an extension", async () => {
  const msg = soleWarning(await drive({ command: GEN, languageId: "typescript", answer: "no-provider" }), "typescript/no-provider");
  assert.match(msg, /typescript/i, `the message names the TypeScript language features. Got ${JSON.stringify(msg)}`);
  assert.match(msg, /built[- ]?in/i, `item 3: TS ships with VS Code, so the message says so. Got ${JSON.stringify(msg)}`);
  assert.ok(
    !/install/i.test(msg),
    `item 3: TypeScript is built in - the message must NOT tell the user to install an extension. Got ${JSON.stringify(msg)}`,
  );
  assert.ok(!/rust-analyzer|gopls|Pylance/i.test(msg), `a TS document must not name another language's server. Got ${JSON.stringify(msg)}`);
});

gtest("item 3 (javascript): no-provider shares the TypeScript row - built in, no install instruction", async () => {
  const msg = soleWarning(await drive({ command: GEN, languageId: "javascript", answer: "no-provider" }), "javascript/no-provider");
  assert.match(msg, /typescript/i, `javascript rides the TypeScript language features. Got ${JSON.stringify(msg)}`);
  assert.ok(!/install/i.test(msg), `item 3: the built-in row must not tell the user to install anything. Got ${JSON.stringify(msg)}`);
});

// ===========================================================================
// Item 8: all four gestures inherit the split, because the fix is at the
// resolver. Driven with no-provider (the cause that motivated the item).
// ===========================================================================

for (const [label, command] of [
  ["generate", GEN],
  ["repair", REPAIR],
  ["TDD generate", TDD_GEN],
  ["TDD run", TDD_RUN],
]) {
  gtest(`item 8 (${label}): the ${command} gesture names the missing language server and logs the no-provider slug`, async () => {
    const r = await drive({ command, answer: "no-provider" });
    assert.ok(r.warnings.length >= 1, `${label} must tell the user something`);
    assert.ok(
      r.warnings.some((m) => /rust-analyzer/i.test(m)),
      `${label}: a rust document with no symbol provider must name rust-analyzer. Got ${JSON.stringify(r.warnings)}`,
    );
    assertRefusalLine(r, "no-provider", `${label}/no-provider`);
  });
}

// ===========================================================================
// HOLE A (found by mutation testing): item 6 was only checked on GENERATE, so
// three mutations survived - `refusalMessage` ignoring its per-gesture cursor
// text entirely, and repair's or TDD-generate's text swapped for generate's.
//
// The four gestures do NOT share this message: only the human's-cursor cause is
// gesture-specific (repair repairs, TDD targets a function to test), while the
// three server-fault causes are the resolver's and must be identical everywhere.
// Both halves of that are pinned below. Each gesture asserts a clause no other
// gesture's text contains, so any swap in either direction fails.
// ===========================================================================

gtest("item 6 (repair): the cursor refusal says the function is wanted TO REPAIR, and is nobody else's wording", async () => {
  const fx = FIXTURES.rust;
  const r = await drive({ command: REPAIR, answer: "no-symbol-at-cursor", cursor: outsideCursor(fx) });
  const msg = soleWarning(r, "repair/no-symbol-at-cursor");
  assert.match(msg, /repair/i, `repair's cursor message must say what it would repair. Got ${JSON.stringify(msg)}`);
  assert.match(msg, /cursor/i, `it still names the cursor. Got ${JSON.stringify(msg)}`);
  assert.match(msg, /function/i, `it still names a function. Got ${JSON.stringify(msg)}`);
  assert.ok(!/TDD/i.test(msg), `repair must not borrow a TDD gesture's wording. Got ${JSON.stringify(msg)}`);
  assert.ok(
    !/type header/i.test(msg),
    `repair targets a function body, so generate's type-header clause must not leak in. Got ${JSON.stringify(msg)}`,
  );
  assertRefusalLine(r, "no-symbol-at-cursor", "repair/no-symbol-at-cursor");
});

gtest("item 6 (TDD generate): the cursor refusal is about generating TDD tests for a FUNCTION, never a type header", async () => {
  const fx = FIXTURES.rust;
  const r = await drive({ command: TDD_GEN, answer: "no-symbol-at-cursor", cursor: outsideCursor(fx) });
  const msg = soleWarning(r, "tdd-generate/no-symbol-at-cursor");
  assert.match(msg, /TDD/i, `TDD generate's cursor message must name the TDD gesture. Got ${JSON.stringify(msg)}`);
  assert.match(msg, /generate/i, `it is the GENERATE half of TDD. Got ${JSON.stringify(msg)}`);
  assert.match(msg, /cursor/i, `it still names the cursor. Got ${JSON.stringify(msg)}`);
  assert.match(msg, /function/i, `it still names a function. Got ${JSON.stringify(msg)}`);
  assert.ok(!/repair/i.test(msg), `TDD generate must not borrow repair's wording. Got ${JSON.stringify(msg)}`);
  assert.ok(
    !/type header/i.test(msg),
    `TDD only targets functions, so offering a generatable TYPE HEADER would be a lie. Got ${JSON.stringify(msg)}`,
  );
  assertRefusalLine(r, "no-symbol-at-cursor", "tdd-generate/no-symbol-at-cursor");
});

gtest("item 6 (TDD run): the cursor refusal is about RUNNING a function's TDD tests, never generating or repairing", async () => {
  const fx = FIXTURES.rust;
  const r = await drive({ command: TDD_RUN, answer: "no-symbol-at-cursor", cursor: outsideCursor(fx) });
  const msg = soleWarning(r, "tdd-run/no-symbol-at-cursor");
  assert.match(msg, /TDD/i, `TDD run's cursor message must name the TDD gesture. Got ${JSON.stringify(msg)}`);
  assert.match(msg, /run/i, `it is the RUN half of TDD. Got ${JSON.stringify(msg)}`);
  assert.match(msg, /cursor/i, `it still names the cursor. Got ${JSON.stringify(msg)}`);
  assert.match(msg, /function/i, `it still names a function. Got ${JSON.stringify(msg)}`);
  assert.ok(!/repair/i.test(msg), `TDD run must not borrow repair's wording. Got ${JSON.stringify(msg)}`);
  assert.ok(
    !/type header/i.test(msg),
    `TDD only targets functions, so offering a generatable TYPE HEADER would be a lie. Got ${JSON.stringify(msg)}`,
  );
  assertRefusalLine(r, "no-symbol-at-cursor", "tdd-run/no-symbol-at-cursor");
});

gtest("item 6 (anti-swap): the four gestures' cursor messages are PAIRWISE DISTINCT, under both admission states", async () => {
  const fx = FIXTURES.rust;
  for (const admit of [false, true]) {
    const byGesture = {};
    for (const [label, command] of [["generate", GEN], ["repair", REPAIR], ["TDD generate", TDD_GEN], ["TDD run", TDD_RUN]]) {
      const r = await drive({
        command,
        answer: "no-symbol-at-cursor",
        cursor: outsideCursor(fx),
        config: { compilerDirectedInjection: admit },
      });
      byGesture[label] = soleWarning(r, `${label}/no-symbol-at-cursor/admit=${admit}`);
    }
    assert.strictEqual(
      new Set(Object.values(byGesture)).size,
      4,
      `admitTypes=${admit}: each gesture states what IT wanted at the cursor, so no two may share a string. Got:\n` +
        Object.entries(byGesture).map(([k, v]) => `  ${k}: ${JSON.stringify(v)}`).join("\n"),
    );
  }
});

gtest("item 8 (the other half): the three SERVER-fault causes are gesture-INVARIANT, because the fix is at the resolver", async () => {
  for (const answer of ["no-provider", "empty-tree", "flat-symbols"]) {
    const byGesture = {};
    for (const [label, command] of [["generate", GEN], ["repair", REPAIR], ["TDD generate", TDD_GEN], ["TDD run", TDD_RUN]]) {
      byGesture[label] = soleWarning(await drive({ command, answer }), `${label}/${answer}`);
    }
    assert.strictEqual(
      new Set(Object.values(byGesture)).size,
      1,
      `${answer} is the language server's fault, not the gesture's, so all four gestures must say the SAME thing. Got:\n` +
        Object.entries(byGesture).map(([k, v]) => `  ${k}: ${JSON.stringify(v)}`).join("\n"),
    );
  }
});

// ===========================================================================
// HOLE B (found by mutation testing): item 7 was only enforced on generate for
// all four causes and on the other three gestures for no-provider only, which
// left 12 of the 16 (gesture, cause) pairs undriven - a gesture could log
// nothing for a cause and the suite would not notice. This sweeps all 16.
// ===========================================================================

gtest("item 7 (full sweep): every one of the 16 (gesture, cause) pairs emits exactly ONE refusal line declaring that cause", async () => {
  const fx = FIXTURES.rust;
  const misses = [];
  for (const [label, command] of [["generate", GEN], ["repair", REPAIR], ["TDD generate", TDD_GEN], ["TDD run", TDD_RUN]]) {
    for (const answer of ["no-provider", "empty-tree", "flat-symbols", "no-symbol-at-cursor"]) {
      const r = await drive({
        command,
        answer,
        cursor: answer === "no-symbol-at-cursor" ? outsideCursor(fx) : undefined,
      });
      if (r.refusalLines.length !== 1) {
        misses.push(`${label} x ${answer}: expected exactly 1 "${REFUSAL_PREFIX}" line, got ${r.refusalLines.length} ${JSON.stringify(r.refusalLines)}`);
        continue;
      }
      const slug = slugOf(r.refusalLines[0]);
      if (slug !== answer) {
        misses.push(`${label} x ${answer}: line must declare cause=${answer}, got ${JSON.stringify(r.refusalLines[0])}`);
      }
    }
  }
  assert.deepStrictEqual(misses, [], `contract item 7 across all 16 pairs:\n${misses.join("\n")}`);
});

// ===========================================================================
// Item 9: the success path is untouched. A refusal-path change that breaks a
// resolution would pass every test above.
// ===========================================================================

gtest("item 9 (resolver): a good hierarchy with the cursor INSIDE the function still resolves, with and without type admission", async () => {
  for (const languageId of ["rust", "go", "csharp", "python", "typescript"]) {
    const fx = FIXTURES[languageId];
    const doc = makeDoc(fx, languageId);
    __state.symbols = hierarchy(fx);
    __state.symbolsSet = true;
    for (const admitTypes of [false, true]) {
      const resolved = await resolveFunctionAtCursor(doc, P(fx.inside), admitTypes);
      assert.ok(resolved, `${languageId} (admitTypes=${admitTypes}): a resolvable function must still resolve after the refusal split`);
      assert.ok(
        typeof resolved.signature === "string" && resolved.signature.length > 0,
        `${languageId}: the resolved signature must survive. Got ${JSON.stringify(resolved.signature)}`,
      );
    }
  }
});

gtest("item 9 (generate gesture): a resolvable cursor reaches the model and emits NO refusal line and NO refusal warning", async () => {
  const r = await drive({ command: GEN, answer: "no-symbol-at-cursor" }); // good hierarchy, cursor INSIDE
  assert.deepStrictEqual(r.causeLines, [], `a success path must never declare a refusal cause. Got ${JSON.stringify(r.causeLines)}`);
  assert.ok(
    !r.warnings.some((m) => /cursor|rust-analyzer|hierarch|index/i.test(m)),
    `a success path must show none of the four refusal messages. Got ${JSON.stringify(r.warnings)}`,
  );
  assert.ok(
    r.serviceCalls.length >= 1,
    `the resolved function must reach the model seam (else this rung proves nothing about the success path). Got ${JSON.stringify(r.serviceCalls)}`,
  );
});

gtest("item 9 (repair gesture): a resolvable cursor runs the oracle and emits no refusal line", async () => {
  const r = await drive({ command: REPAIR, answer: "no-symbol-at-cursor" }); // cursor INSIDE
  assert.deepStrictEqual(r.causeLines, [], `a resolved repair must never declare a refusal cause. Got ${JSON.stringify(r.causeLines)}`);
  assert.strictEqual(r.oracleCalls.length, 1, `a resolved function still drives exactly one oracle pass. Got ${r.oracleCalls.length}`);
});

// ===========================================================================
// The contract's Docs clause: the user manual must state that a language server
// extension is required. Not a numbered item, but the contract says the line
// "must exist after this phase", and it is checkable black-box.
// ===========================================================================

gtest("docs: the user manual's Requirements section states that a language server extension is required", () => {
  const manual = fs.readFileSync(path.join(__dirname, "..", "docs", "user-manual.md"), "utf8");
  const requirements = manual.slice(manual.indexOf("### Requirements"));
  const section = requirements.slice(0, requirements.indexOf("\n### ", 1));
  assert.match(section, /language server/i, "Requirements must name the language server dependency");
  assert.match(section, /rust-analyzer/i, "and name the per-language servers the gestures need");
  assert.match(section, /Pylance/i, "including Pylance for Python");
});
