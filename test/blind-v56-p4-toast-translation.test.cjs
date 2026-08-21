// Blind oracle, session-v56 phase 4: "translate the service rejects, close the
// catch-alls" (roadmap item 63, first half). Contract:
// session-v56/contract-phase4.md. Written BEFORE the fix.
//
// WHAT THIS FILE PINS. One string serves two audiences today: the service
// throws channel-grade messages and the gesture catch-alls forward them raw to
// a toast, `Error:` prefix included. After this phase the vscode layer owns
// toast wording and the service keeps its channel wording byte for byte:
//   contract 1  each of the SIX service rejects, reaching a user-facing
//               gesture, toasts a crafted human sentence: `Column 80:` prefix,
//               no `Error:`, no `num_predict`, no `done_reason`, no internal
//               jargon, cause plus next action
//   contract 2  the CHANNEL keeps the internal string verbatim
//   contract 3  every catch-all that can show `String(err)` unbounded (fn-gen,
//               test-gen, tighten, first-run's download) shows at most the
//               FIRST line plus a pointer that the full message is in the
//               channel
//   contract 4  the disabled-tier warning never renders `Column 80: undefined`
//   contract 5  file-IO toasts may keep first-line `String(err)` detail but
//               render ONE line only
//   non-behaviour: server-unreachable and window-refusal translations exist
//               today and must not be reworded (pinned pre-fix, below)
//
// THE DRIVE IS THE PRODUCT'S OWN, END TO END. Every reject reaches the user
// through a REGISTERED gesture: `registerFnGen` against the vscode stub (the
// v56 phase-2 oracle's precedent harness), the REAL `buildFnGenService` behind
// the `buildService` seam, and a REAL `FnGenService` whose only substitution
// is the scripted transport fn (the constructor's own injection seam, the
// blind-v56-p3 precedent). Five of the six rejects are produced ORGANICALLY by
// the service's own guards - the scripted transport only returns the reply
// shape that trips each guard (doneReason "length", a fence line, a wrong
// head, an empty body, a prose non-test reply). The sixth, the stream cut, is
// thrown BY the transport seam with the transport's real wording, because in
// the product that string is born in the transport (src/core/ollama.ts).
// First-run's download failure is driven through `offerModelPull` (the
// exported vscode-layer flow) with its own `deps.pull` seam throwing.
//
// THE SIX INTERNAL STRINGS are copied from the service's throw sites
// (src/core/fnGenService.ts, src/core/ollama.ts) - they are fixtures for this
// file, and contract 2 pins them on the channel verbatim.
//
// BINDINGS THE CONTRACT LEAVES OPEN, resolved and REPORTED:
//   * WHICH TOAST QUALIFIES (contract 1). "A crafted human sentence" is bound
//     to: at least one user-facing message that starts with "Column 80:", is
//     longer than 40 characters, contains no backtick, no `Error:`, no
//     `undefined`; and NO message of any kind carries `done_reason`,
//     `num_predict`, or the raw internal string verbatim.
//   * "AT MOST THE FIRST LINE" (contract 3). Bound to: no user-facing message
//     contains any line of the error PAST the first, and some message points
//     at the channel (/output|channel/i). The first line itself MAY appear
//     ("at most"), so its presence is not required.
//   * THE CHANNEL (contract 2). Bound to: any line the gesture put on the
//     extension's output channel (the service's evidence lines route there).
//   * CONTRACT 4's undefined-message tier. Probed through the product's OWN
//     constructions only (see the ambiguity row): every disabled tier
//     buildFnGenService can construct today carries a non-empty message, so
//     the message-less warning is NOT REACHABLE through product construction
//     from this rig. Reported as an ambiguity, not resolved by hand-building
//     a tier object. What IS asserted: a real disabled-tier drive puts no
//     "undefined" on either surface.
//   * CONTRACT 5's file-IO toast. Driven on the test-gen new-file path: the
//     file is created, `workspace.openTextDocument` (a host seam) throws a
//     multi-line error, and today's "was created but could not be opened"
//     toast renders it. One line only is the assertion.
//
// EXPECTED TODAY (pre-fix):
//   RED   the six contract-1 toast rows (today: "... failed: Error: <raw>")
//   RED   the contract-2 channel row for the EMPTY reject only (the service
//         logs "(dropped: empty after postprocess)" but never the full throw
//         string; the other five are on the channel verbatim already)
//   RED   the four contract-3 first-line rows (full multi-line shown, no
//         channel pointer)
//   GREEN the four contract-3 channel rows (catch-alls already log verbatim)
//   GREEN contract 4's no-undefined row (every constructible tier has a
//         message)
//   RED   contract 5's one-line row (String(err) rendered unbounded)
//   GREEN the server-unreachable and window-refusal pins (regression guards)
//
// Run: node --test test/blind-v56-p4-toast-translation.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const fs = require("node:fs");
const esbuild = require("esbuild");

// ---------------------------------------------------------------------------
// The vscode stub: the v56 phase-2 stub (drives REGISTERED gestures), plus an
// answerable info-message queue (the tighten Apply and the TDD create-file
// prompts), host seams that can throw (openTextDocument, applyEdit,
// editor.edit), and a workspace.fs that really creates files so the TDD
// new-file path runs to its open step.
// ---------------------------------------------------------------------------

const WROOT = path.join(__dirname, ".blind-v56-p4-workspace");
fs.rmSync(WROOT, { recursive: true, force: true });
fs.mkdirSync(path.join(WROOT, "src"), { recursive: true });
fs.writeFileSync(
  path.join(WROOT, "package.json"),
  '{"name":"w","version":"0.0.0","scripts":{"test":"vitest run"},"devDependencies":{"vitest":"^1.0.0"}}\n',
);

const STUB = path.join(__dirname, ".blind-v56-p4-stub.cjs");
fs.writeFileSync(
  STUB,
  `
const nodeFs = require("node:fs");
const state = {
  config: {}, messages: [], commands: {}, activeTextEditor: undefined,
  snippetInserts: [], appliedEdits: [], executeCalls: [], terminals: [],
  textDocuments: [], warnResponses: [], infoResponses: [],
  symbols: undefined, wroot: "/",
  openTextDocumentImpl: undefined, applyEditImpl: undefined,
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
  EndOfLine: { LF: 1, CRLF: 2 },
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
    get workspaceFolders() { return [{ uri: Uri.file(state.wroot), name: "w", index: 0 }]; },
    getWorkspaceFolder: () => ({ uri: Uri.file(state.wroot), name: "w", index: 0 }),
    openTextDocument: async (...args) => {
      if (state.openTextDocumentImpl) return state.openTextDocumentImpl(...args);
      return state.activeTextEditor && state.activeTextEditor.document;
    },
    applyEdit: async (edit) => {
      if (state.applyEditImpl) return state.applyEditImpl(edit);
      state.appliedEdits.push(edit);
      return true;
    },
    fs: {
      stat: async () => { throw new Error("ENOENT"); },
      createDirectory: async (uri) => { nodeFs.mkdirSync(uri.fsPath, { recursive: true }); },
      writeFile: async (uri, bytes) => { nodeFs.writeFileSync(uri.fsPath, Buffer.from(bytes)); },
      readFile: async (uri) => nodeFs.readFileSync(uri.fsPath),
      delete: async (uri) => { nodeFs.rmSync(uri.fsPath, { force: true, recursive: true }); },
    },
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
    showQuickPick: async () => undefined,
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
    tabGroups: { all: [], activeTabGroup: undefined, onDidChangeTabs: () => ({ dispose() {} }), close: async () => {} },
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

const ENTRY = path.join(__dirname, ".blind-v56-p4.entry.ts");
const OUTFILE = path.join(__dirname, ".blind-v56-p4.bundle.cjs");
let B = {};
let bundleErr;
try {
  fs.writeFileSync(
    ENTRY,
    `export { registerFnGen, buildFnGenService } from "../src/vscode/fnGen";
export { offerModelPull } from "../src/vscode/firstRun";
export { FnGenService } from "../src/core/fnGenService";
export { ContextBlockStore } from "../src/core/contextBlocks";
export { __state, Position, Range } from "vscode";\n`,
  );
  esbuild.buildSync({
    entryPoints: [ENTRY],
    bundle: true,
    outfile: OUTFILE,
    format: "cjs",
    platform: "node",
    alias: { vscode: STUB },
  });
  B = require(OUTFILE);
} catch (e) {
  bundleErr = e;
}

test.after(() => {
  for (const f of [STUB, ENTRY, OUTFILE]) fs.rmSync(f, { force: true });
  fs.rmSync(WROOT, { recursive: true, force: true });
});

const btest = (name, fn) =>
  test(name, (ctx) => {
    if (bundleErr) return ctx.skip("bundle failed to build; see the harness guard row");
    return fn(ctx);
  });

// ---------------------------------------------------------------------------
// Fixture: a real TS file on disk with a doc-commented, RETURN-ANNOTATED
// function (the TDD testability gate needs the annotation), symbol hierarchy
// supplied, cursor placements for each gesture.
// ---------------------------------------------------------------------------

const REMOTE_HOST = "http://ml-box.invalid:11434";
const MODEL = "qwen3-coder:480b";
const MB = 1048576;
const MAX_TOKENS = 512;

const SRC =
  "// this walker keeps a shard mem cache for each of the client sets and drops every entry it can prove is stale\n" +
  "export function walk(): number {\n" +
  "  return 1;\n" +
  "}\n" +
  "\n";
const FSPATH = path.join(WROOT, "src", "walk.ts");
fs.writeFileSync(FSPATH, SRC);

const CONFIG = { apiBase: REMOTE_HOST, fnGenModel: MODEL, repairEnabled: true };
const CFG = { apiBase: REMOTE_HOST, model: MODEL, fallbackModel: MODEL, maxTokens: MAX_TOKENS, temperature: 0.2 };
const probeOpts = { runCommand: async () => ({ stdout: "16303\n", exitCode: 0 }), totalMemBytes: () => 61826 * MB };

function makeDoc() {
  const src = SRC;
  const lineStarts = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === "\n") lineStarts.push(i + 1);
  const offsetAt = (pos) => Math.min((lineStarts[pos.line] ?? src.length) + pos.character, src.length);
  return {
    languageId: "typescript",
    version: 1,
    isDirty: false,
    isClosed: false,
    eol: 1,
    lineCount: src.split("\n").length,
    fileName: FSPATH,
    uri: { fsPath: FSPATH, path: FSPATH, scheme: "file", toString: () => "file://" + FSPATH, with() { return this; } },
    getText(range) {
      return range ? src.slice(offsetAt(range.start), offsetAt(range.end)) : src;
    },
    offsetAt,
    positionAt(offset) {
      let line = 0;
      while (line + 1 < lineStarts.length && lineStarts[line + 1] <= offset) line++;
      return new B.Position(line, offset - lineStarts[line]);
    },
    lineAt(arg) {
      const n = typeof arg === "number" ? arg : arg.line;
      const text = src.split("\n")[n] ?? "";
      const m = text.match(/\S/);
      return {
        lineNumber: n,
        text,
        range: new B.Range(n, 0, n, text.length),
        firstNonWhitespaceCharacterIndex: m ? m.index : text.length,
        isEmptyOrWhitespace: !m,
      };
    },
    save: async () => true,
  };
}

const symbolsFor = () => [
  { name: "walk", detail: "", kind: 11, range: new B.Range(1, 0, 3, 1), selectionRange: new B.Range(1, 16, 1, 20), children: [] },
];
const IN_COMMENT = [0, 20];
const IN_FUNCTION = [2, 4];

function selectionAt(a) {
  const p = new B.Position(a[0], a[1]);
  const sel = new B.Range(p, p);
  sel.active = p;
  sel.anchor = p;
  return sel;
}

const waitFor = async (predicate, tries = 400) => {
  for (let i = 0; i < tries; i++) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, 5));
  }
  return false;
};

// ---------------------------------------------------------------------------
// The drive: register the product's gestures (REAL buildFnGenService behind
// the buildService seam), optionally substitute the transport fn on a REAL
// FnGenService (the constructor's injection seam), invoke one registered
// command, record every toast and every channel line.
// ---------------------------------------------------------------------------

const GEN = "column80.generateFunction";
const TDD_GEN = "column80.generateTests";
const TIGHTEN = "column80.tightenDocComment";

async function driveOnce({ command, cursor, generateFn, cfg, config, infoResponses, openTextDocumentImpl, applyEditImpl, editImpl, listEmpty, settle = 150 }) {
  const st = B.__state;
  st.wroot = WROOT;
  st.config = { ...(config ?? CONFIG) };
  st.messages = [];
  st.commands = {};
  st.executeCalls = [];
  st.appliedEdits = [];
  st.snippetInserts = [];
  st.terminals = [];
  st.warnResponses = [];
  st.infoResponses = infoResponses ? infoResponses.slice() : [];
  st.openTextDocumentImpl = openTextDocumentImpl;
  st.applyEditImpl = applyEditImpl;
  const doc = makeDoc();
  st.textDocuments = [doc];
  st.symbols = symbolsFor();

  const lines = [];
  const output = { lines, appendLine: (l) => lines.push(l), append() {}, show() {}, clear() {}, dispose() {} };
  let built;
  const context = { subscriptions: [], globalStorageUri: { fsPath: path.join(WROOT, ".storage") } };
  try {
    B.registerFnGen(context, output, new B.ContextBlockStore(() => {}), {
      buildService: async (out, log) => {
        built = await B.buildFnGenService(out, log, probeOpts, { listModels: async () => (listEmpty ? [] : [MODEL]) });
        if (generateFn) {
          // The one substitution: the transport fn, through the service
          // constructor's own seam. Every guard between transport and toast is
          // the product's.
          try {
            built.service.dispose();
          } catch {
            /* teardown only */
          }
          built = { ...built, service: new B.FnGenService({ ...CFG, ...(cfg || {}) }, generateFn, log) };
        }
        return built;
      },
      listModels: async () => [MODEL],
      ollamaCheck: async () => ({ stdout: "ollama version 0.0.0", exitCode: 0 }),
    });
    const registered = await waitFor(() => typeof st.commands[command] === "function" && built !== undefined);
    assert.ok(
      registered,
      `harness: ${command} never registered (or the service never built); commands seen: ${JSON.stringify(Object.keys(st.commands))}`,
    );

    st.activeTextEditor = {
      document: doc,
      viewColumn: 1,
      options: { tabSize: 4, insertSpaces: true },
      selection: selectionAt(cursor),
      insertSnippet: async (snippet, range) => {
        st.snippetInserts.push({ value: snippet.value, range });
        return true;
      },
      revealRange: () => {},
      edit: editImpl || (async (cb) => {
        cb({ replace() {}, insert() {}, delete() {} });
        return true;
      }),
    };
    st.messages = [];
    await st.commands[command]();
    await new Promise((r) => setTimeout(r, settle));
    return {
      tier: built.tier,
      toasts: st.messages.map((m) => ({ kind: m.kind, message: String(m.message) })),
      channel: lines.slice(),
    };
  } finally {
    st.openTextDocumentImpl = undefined;
    st.applyEditImpl = undefined;
    for (const d of context.subscriptions) {
      try {
        d.dispose?.();
      } catch {
        /* teardown only */
      }
    }
    try {
      built?.service?.dispose();
    } catch {
      /* teardown only */
    }
  }
}

// One drive per scenario, shared across its rows.
const memo = new Map();
const drive = (key, opts) => {
  if (!memo.has(key)) memo.set(key, driveOnce(opts));
  return memo.get(key);
};

const fmt = (r) =>
  `toasts=${JSON.stringify(r.toasts.map((t) => `${t.kind}: ${t.message}`))}\n` +
  `channel=${JSON.stringify(r.channel)}`;

// ---------------------------------------------------------------------------
// The six rejects. INTERNAL strings copied verbatim from the service's throw
// sites; each scenario's transport reply is what makes the service's OWN guard
// throw it (the stream cut is thrown by the transport seam, where it is born).
// ---------------------------------------------------------------------------

const STREAM_CUT = `Ollama stream cut: silent for 30000ms before any data (${REMOTE_HOST})`;

const REJECTS = [
  {
    key: "truncation",
    command: GEN,
    cursor: IN_FUNCTION,
    internal: `generation truncated at num_predict=${MAX_TOKENS} (done_reason=length)`,
    evidence: /\[fngen\] request failed: generation truncated at num_predict=/,
    generateFn: async () => ({ text: "export function walk(): number {\n  return 2;\n}", ttftMs: 1, totalMs: 2, doneReason: "length" }),
  },
  {
    key: "fence",
    command: GEN,
    cursor: IN_FUNCTION,
    internal: "generation contains a code-fence line (unclosed or nested fence in the reply)",
    evidence: /\[fngen\] request failed: generation contains a code-fence line/,
    generateFn: async () => ({ text: "export function walk(): number {\n```\n}", ttftMs: 1, totalMs: 2, doneReason: "stop" }),
  },
  {
    key: "missing-head",
    command: GEN,
    cursor: IN_FUNCTION,
    internal: "generation does not contain the requested function (declaration head not in the reply)",
    evidence: /\[fngen\] request failed: generation does not contain the requested function/,
    generateFn: async () => ({ text: "function somethingElse() {\n  return 3;\n}", ttftMs: 1, totalMs: 2, doneReason: "stop" }),
  },
  {
    key: "empty",
    command: GEN,
    cursor: IN_FUNCTION,
    internal: "generation was empty after postprocess",
    evidence: /\(dropped: empty after postprocess\)/,
    generateFn: async () => ({ text: "", ttftMs: 1, totalMs: 2, doneReason: "stop" }),
  },
  {
    key: "stream-cut",
    command: GEN,
    cursor: IN_FUNCTION,
    internal: STREAM_CUT,
    evidence: /\[fngen\] request failed: .*Ollama stream cut/,
    generateFn: async () => {
      throw new Error(STREAM_CUT);
    },
  },
  {
    key: "test-module-refusal",
    command: TDD_GEN,
    cursor: IN_FUNCTION,
    internal: "generation does not contain typescript test functions (no fenced block with a test function in it)",
    evidence: /\[fngen\] request failed: generation does not contain typescript test functions/,
    generateFn: async () => ({ text: "I cannot write tests for this function, sorry.", ttftMs: 1, totalMs: 2, doneReason: "stop" }),
  },
];

// ===========================================================================
// Harness guard. If red, every verdict below is suspect.
// ===========================================================================

test("G1 [harness]: the gesture surface bundles headless against the stub and exports what this file drives", () => {
  if (bundleErr) assert.fail(`bundle failed to build: ${bundleErr.stack || bundleErr.message}`);
  for (const n of ["registerFnGen", "buildFnGenService", "offerModelPull", "FnGenService", "ContextBlockStore"]) {
    assert.ok(B[n] !== undefined, `${n} must be exported for this file to drive it`);
  }
});

// ===========================================================================
// Contract 1 + 2: the six rejects. Toast is a crafted human sentence; channel
// keeps the internal string verbatim.
// ===========================================================================

for (const rj of REJECTS) {
  const opts = { command: rj.command, cursor: rj.cursor, generateFn: rj.generateFn };

  btest(`C1 [${rj.key}]: the toast is a crafted human sentence, not the internal string`, async () => {
    const r = await drive(rj.key, opts);
    assert.ok(
      r.channel.some((l) => rj.evidence.test(l)),
      `precondition: the rig must actually make the service produce this reject ` +
        `(its evidence line is missing from the channel), so this row proves nothing.\n${fmt(r)}`,
    );
    assert.ok(r.toasts.length > 0, `contract 1: the reject must reach the user as a toast, not silence.\n${fmt(r)}`);
    for (const t of r.toasts) {
      assert.ok(
        !t.message.includes("done_reason"),
        `contract 1: no user-facing message may say "done_reason". Got: ${JSON.stringify(t.message)}`,
      );
      assert.ok(
        !t.message.includes("num_predict"),
        `contract 1: no user-facing message may say "num_predict". Got: ${JSON.stringify(t.message)}`,
      );
      assert.ok(
        !t.message.includes(rj.internal),
        `contract 1: the raw internal string must never reach a toast verbatim. Got: ${JSON.stringify(t.message)}`,
      );
      assert.ok(
        !t.message.includes("Error:"),
        `contract 1: "no \`Error:\` prefix" - anywhere in a user-facing message. Got: ${JSON.stringify(t.message)}`,
      );
    }
    const crafted = r.toasts.filter(
      (t) =>
        t.message.startsWith("Column 80:") &&
        t.message.length > 40 &&
        !t.message.includes("\`") &&
        !t.message.includes("undefined"),
    );
    assert.ok(
      crafted.length >= 1,
      `contract 1: at least one toast must be the crafted sentence - "Column 80:" prefix, ` +
        `longer than 40 chars, no backtick-fenced internals, no "undefined".\n${fmt(r)}`,
    );
  });

  btest(`C2 [${rj.key}]: the channel keeps the internal string verbatim`, async () => {
    const r = await drive(rj.key, opts);
    assert.ok(
      r.channel.some((l) => rj.evidence.test(l)),
      `precondition: the reject never fired, so this row proves nothing.\n${fmt(r)}`,
    );
    assert.ok(
      r.channel.some((l) => l.includes(rj.internal)),
      `contract 2: "The CHANNEL keeps the internal string verbatim." Expected some channel line to ` +
        `contain ${JSON.stringify(rj.internal)}.\n${fmt(r)}`,
    );
  });
}

// ===========================================================================
// Contract 3: an arbitrary multi-line unknown error through each catch-all -
// toast shows at most the FIRST line plus a channel pointer; the channel gets
// the whole thing.
// ===========================================================================

const MULTI_L1 = "the flux capacitor failed";
const MULTI_L2 = "at internalFrame (deep.ts:12:3)";
const MULTI_L3 = "second internal detail line";
const MULTI = `${MULTI_L1}\n    ${MULTI_L2}\n${MULTI_L3}`;
const throwMulti = async () => {
  throw new Error(MULTI);
};

const CATCH_ALLS = [
  {
    key: "catchall-fngen",
    label: "fn-gen",
    opts: { command: GEN, cursor: IN_FUNCTION, generateFn: throwMulti },
  },
  {
    key: "catchall-testgen",
    label: "test-gen",
    opts: { command: TDD_GEN, cursor: IN_FUNCTION, generateFn: throwMulti },
  },
  {
    key: "catchall-tighten",
    label: "tighten",
    // The proposer round's own failure is HANDLED (a clean toast exists for
    // it), so the unknown error is raised where tighten has no specific
    // handler: the apply step. The human clicks Apply on the product's own
    // re-wrap prompt; both edit seams (editor.edit, workspace.applyEdit)
    // throw the multi-line error, and the gesture's catch-all owns it.
    opts: {
      command: TIGHTEN,
      cursor: IN_COMMENT,
      generateFn: async () => ({ text: "walker keeps a shard mem cache", ttftMs: 1, totalMs: 2, doneReason: "stop" }),
      infoResponses: ["Apply"],
      applyEditImpl: throwMulti,
      editImpl: throwMulti,
      settle: 250,
    },
  },
];

for (const ca of CATCH_ALLS) {
  btest(`C3a [${ca.label}]: the catch-all toasts at most the FIRST line, plus a pointer to the channel`, async () => {
    const r = await drive(ca.key, ca.opts);
    assert.ok(
      r.channel.some((l) => l.includes(MULTI_L1)),
      `precondition: the rig never got the unknown error into the ${ca.label} catch-all ` +
        `(its first line is nowhere on the channel), so this row proves nothing.\n${fmt(r)}`,
    );
    assert.ok(r.toasts.length > 0, `the unknown failure must reach the user, not vanish.\n${fmt(r)}`);
    for (const t of r.toasts) {
      assert.ok(
        !t.message.includes(MULTI_L2) && !t.message.includes(MULTI_L3),
        `contract 3: the catch-all "shows at most the first line" - no line past the first may ` +
          `reach a toast. Got: ${JSON.stringify(t.message)}`,
      );
      assert.ok(
        !t.message.includes("\n"),
        `contract 3: a bounded toast is ONE line. Got: ${JSON.stringify(t.message)}`,
      );
    }
    assert.ok(
      r.toasts.some((t) => /output|channel/i.test(t.message)),
      `contract 3: "... plus a pointer that the full message is in the channel." No toast points ` +
        `the user at the channel.\n${fmt(r)}`,
    );
  });

  btest(`C3b [${ca.label}]: the channel gets the full multi-line message`, async () => {
    const r = await drive(ca.key, ca.opts);
    assert.ok(
      r.channel.some((l) => l.includes(MULTI_L1) && l.includes(MULTI_L2) && l.includes(MULTI_L3)),
      `contract 3: the channel keeps the WHOLE message; the toast is the only bounded surface.\n${fmt(r)}`,
    );
  });
}

// First-run's download catch-all: offerModelPull is the vscode-layer flow (its
// deps.pull seam is the download). The human ratifies the download; the pull
// throws the multi-line error.
btest("C3a [first-run download]: the download failure toasts at most the FIRST line, plus a channel pointer", async () => {
  const st = B.__state;
  st.messages = [];
  st.infoResponses = ["Download"];
  const lines = [];
  const output = { appendLine: (l) => lines.push(l), append() {}, show() {}, clear() {}, dispose() {} };
  const landed = await B.offerModelPull(REMOTE_HOST, MODEL, output, "the tier needs this model", { pull: throwMulti });
  assert.strictEqual(landed, false, "a failed pull must report the model as not landed");
  assert.ok(
    lines.some((l) => l.includes(MULTI_L1)),
    `precondition: the pull failure never reached the channel, so this row proves nothing. channel=${JSON.stringify(lines)}`,
  );
  const failureToasts = st.messages.filter((m) => !/Download .*\?/.test(m.message));
  assert.ok(failureToasts.length > 0, `the failed download must reach the user. toasts=${JSON.stringify(st.messages)}`);
  for (const t of failureToasts) {
    assert.ok(
      !String(t.message).includes(MULTI_L2) && !String(t.message).includes(MULTI_L3) && !String(t.message).includes("\n"),
      `contract 3: the download-failure toast is bounded to the first line. Got: ${JSON.stringify(t.message)}`,
    );
  }
  assert.ok(
    failureToasts.some((t) => /output|channel/i.test(String(t.message))),
    `contract 3: the toast must point at the channel for the full story. toasts=${JSON.stringify(st.messages)}`,
  );
});

btest("C3b [first-run download]: the channel gets the full multi-line message", async () => {
  const st = B.__state;
  st.messages = [];
  st.infoResponses = ["Download"];
  const lines = [];
  const output = { appendLine: (l) => lines.push(l), append() {}, show() {}, clear() {}, dispose() {} };
  await B.offerModelPull(REMOTE_HOST, MODEL, output, "the tier needs this model", { pull: throwMulti });
  assert.ok(
    lines.some((l) => l.includes(MULTI_L1) && l.includes(MULTI_L2) && l.includes(MULTI_L3)),
    `contract 3: the channel keeps the whole message. channel=${JSON.stringify(lines)}`,
  );
});

// ===========================================================================
// Contract 4: no "Column 80: undefined". AMBIGUITY, REPORTED NOT RESOLVED:
// every disabled tier the product's own construction can produce today carries
// a non-empty message (probed below across the local, remote, both cloud, and
// claude-code arms), so a message-LESS disabled tier is not reachable from
// this rig without hand-building a tier object - which this file refuses to
// do. What is asserted instead: the product's constructions all carry the
// message (the witness that keeps the ambiguity honest), and a REAL
// disabled-tier drive puts no "undefined" on either surface.
// ===========================================================================

btest("C4a [witness]: every product-constructed disabled tier carries a non-empty message", async () => {
  const st = B.__state;
  const build = async (config, deps) => {
    st.config = config;
    const output = { appendLine() {}, append() {}, show() {}, clear() {}, dispose() {} };
    const built = await B.buildFnGenService(output, () => {}, probeOpts, deps);
    try {
      built.service.dispose();
    } catch {
      /* teardown only */
    }
    return built.tier;
  };
  const tiers = {
    "remote-empty": await build({ apiBase: REMOTE_HOST, fnGenModel: MODEL }, { listModels: async () => [] }),
    "cloud-openai-no-endpoint": await build({ fnGenProvider: "openai-compatible", fnGenModel: MODEL }, { listModels: async () => [MODEL] }),
    "cloud-anthropic-no-key": await build({ fnGenProvider: "anthropic", fnGenModel: MODEL }, { listModels: async () => [MODEL] }),
    "claude-code-no-dir": await build({ fnGenProvider: "claude-code", fnGenModel: MODEL }, { listModels: async () => [MODEL], runCommand: async () => ({ stdout: "", exitCode: 1 }) }),
  };
  for (const [name, tier] of Object.entries(tiers)) {
    assert.strictEqual(tier.fnGenEnabled, false, `witness: ${name} must be a disabled tier`);
    assert.ok(
      typeof tier.message === "string" && tier.message.trim() !== "" && !tier.message.includes("undefined"),
      `contract 4's ambiguity witness: the ${name} tier must carry a real message ` +
        `(got ${JSON.stringify(tier.message)}). If this row ever fails, the message-less warning ` +
        `IS product-reachable and the ambiguity in this file's header is stale.`,
    );
  }
});

btest("C4b [disabled tier x generate]: no surface renders the string 'undefined'", async () => {
  // No generateFn: the product's own inert service for the disabled tier
  // (remote host, empty model list - the phase-1 disabled remote tier).
  const rr = await drive("disabled-remote-empty", {
    command: GEN,
    cursor: IN_FUNCTION,
    listEmpty: true,
  });
  assert.strictEqual(rr.tier.fnGenEnabled, false, `harness: the drive must run on a DISABLED tier.\n${fmt(rr)}`);
  for (const t of rr.toasts) {
    assert.ok(
      !t.message.includes("undefined"),
      `contract 4: "the disabled-tier warning that can render \`Column 80: undefined\`" - no toast ` +
        `may contain "undefined". Got: ${JSON.stringify(t.message)}`,
    );
  }
  for (const l of rr.channel) {
    assert.ok(
      !/Column 80: undefined|message=undefined|: undefined$/.test(l),
      `contract 4: the matching channel line gets the same fallback. Got: ${JSON.stringify(l)}`,
    );
  }
});

// ===========================================================================
// Non-behaviour pins (regression guards, GREEN today by design): the
// server-unreachable and window-refusal translations exist and must not be
// reworded by this phase. Wordings captured pre-fix, 2026-08-21.
// ===========================================================================

const unreachableErr = () => {
  const e = new TypeError("fetch failed");
  e.cause = { code: "ECONNREFUSED" };
  return e;
};

btest("P1 [pin]: server-unreachable via generate keeps today's wording", async () => {
  const r = await drive("pin-unreachable-gen", {
    command: GEN,
    cursor: IN_FUNCTION,
    generateFn: async () => {
      throw unreachableErr();
    },
  });
  assert.ok(
    r.toasts.some((t) => t.message === "Column 80: the Ollama server isn't running, so function generation can't reach a model."),
    `non-behaviour: "Server-unreachable ... translations already exist; do not reword them." ` +
      `Pinned pre-fix wording missing.\n${fmt(r)}`,
  );
});

btest("P2 [pin]: server-unreachable via test-gen keeps today's wording", async () => {
  const r = await drive("pin-unreachable-tdd", {
    command: TDD_GEN,
    cursor: IN_FUNCTION,
    generateFn: async () => {
      throw unreachableErr();
    },
  });
  assert.ok(
    r.toasts.some((t) => t.message === "Column 80: the Ollama server isn't running, so tests can't be generated."),
    `non-behaviour: pinned pre-fix wording missing.\n${fmt(r)}`,
  );
});

btest("P3 [pin]: the window-refusal translation keeps today's opening sentence", async () => {
  // A numCtx far below the request makes the service's own arbitration refuse
  // before any model call; the existing translation toasts it.
  const r = await drive("pin-window-refusal", {
    command: GEN,
    cursor: IN_FUNCTION,
    cfg: { numCtx: 64 },
    generateFn: async () => ({ text: "x", ttftMs: 1, totalMs: 2, doneReason: "stop" }),
  });
  assert.ok(
    r.channel.some((l) => l.startsWith("[fngen] refused: estimated prompt")),
    `precondition: the window refusal never fired, so this row proves nothing.\n${fmt(r)}`,
  );
  assert.ok(
    r.toasts.some((t) =>
      t.message.startsWith("Column 80: this prompt does not fit the model's context window, so nothing was generated."),
    ),
    `non-behaviour: "window-refusal translations already exist; do not reword them." ` +
      `Pinned pre-fix opening sentence missing.\n${fmt(r)}`,
  );
});

// ===========================================================================
// Contract 5: file-IO toasts may keep first-line String(err) detail but render
// ONE line only. Driven on the TDD new-file path: the human ratifies the file,
// the file is really created, and the host's openTextDocument throws a
// multi-line error into today's "was created but could not be opened" toast.
// ===========================================================================

btest("C5 [file-IO]: the could-not-be-opened toast renders one line only", async () => {
  const IO_MULTI = "EACCES: permission denied\nopen '/x/y'\nmore io detail";
  const r = await drive("file-io", {
    command: TDD_GEN,
    cursor: IN_FUNCTION,
    generateFn: async () => ({
      text: "```ts\ntest('walk returns 1', () => { expect(walk()).toBe(1); });\n```",
      ttftMs: 1,
      totalMs: 2,
      doneReason: "stop",
    }),
    infoResponses: ["Create the test file"],
    openTextDocumentImpl: async () => {
      throw new Error(IO_MULTI);
    },
    settle: 350,
  });
  const ioToasts = r.toasts.filter((t) => /could not be (created|opened)/.test(t.message));
  assert.ok(
    ioToasts.length >= 1,
    `precondition: the rig never reached a file-IO toast (the create prompt's button label may have ` +
      `changed, or the new-file path stopped before open), so this row proves nothing.\n${fmt(r)}`,
  );
  for (const t of ioToasts) {
    assert.ok(
      !t.message.includes("\n"),
      `contract 5: a file-IO toast "must not render more than one line". Got: ${JSON.stringify(t.message)}`,
    );
  }
});
