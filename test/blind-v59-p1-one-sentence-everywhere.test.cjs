// Blind oracle, session-v59 phase 1: "one throw class, one sentence, on every
// surface". Written BEFORE the change, against that phase's CONTRACT and
// nothing else. No implementation of translateServiceReject,
// generationFailedToast, offerModelPull's catch or runProposer's catch was read
// while writing this file.
//
// ===========================================================================
// WHAT THIS FILE PINS
// ===========================================================================
//
// The contract's central claim is an AGREEMENT claim, not a wording claim:
//
//   "for a given HttpStatusError, the crafted sentence that
//    translateServiceReject returns appears in the toast text of all three
//    surfaces."
//
// The three surfaces and their drivers, from the contract's own table:
//
//   fn-gen / test-gen   generationFailedToast(err, gesture)
//   download toast      offerModelPull's catch, on an HttpStatusError from
//                       pullModel
//   tighten             runProposer's catch
//
// NO SENTENCE IS EVER TYPED INTO THIS FILE. The expected text is taken out of
// the product, from `translateServiceReject` - the facade the contract exports
// and names as the definition - and the other two surfaces are asserted to
// carry it. A rewording therefore re-baselines this file instead of breaking
// it, and a build that crafts a sentence for one surface and forgets another is
// the only thing these rows can fail on.
//
// The two literals that ARE typed here are the two the contract itself writes
// down, and it writes them down because they must not move:
//
//   * `The re-wrap needs no model.` - the tighten warning's second clause,
//     under "What must NOT change".
//   * the five line-break characters, which the contract binds by naming
//     `firstLine` in `src/vscode/toastText.ts` as the bound; that module's own
//     comment declares the set as LF, CR, U+2028, U+2029 and U+0085 (CRLF being
//     the pair). This file re-states the SET, never the wording.
//
// ===========================================================================
// HOW THE ERRORS ARE PRODUCED: A REAL SOCKET, NEVER A HAND-BUILT ERROR
// ===========================================================================
//
// Every HttpStatusError in this file comes off a real `http.createServer`
// answering a real status line, driven through the product's own transport
// (`generateInstruct` for the gesture surfaces, `pullModel` for the download
// one). A hand-typed `new HttpStatusError("ollama", 429, "...")` would prove
// that the product translates an error THIS FILE built, which is a different
// and much weaker claim - a server cannot be trusted to set a status, so the
// row that matters is the one where the transport sets it.
//
// The tighten surface has no HTTP transport of its own: its proposer round goes
// through the injected generate fn. So the SAME error object the ollama
// transport really threw is re-thrown from that seam. The error is real; only
// its delivery point is arranged.
//
// ===========================================================================
// THE DRIVES ARE THE PRODUCT'S OWN, END TO END
// ===========================================================================
//
//   gesture   `generationFailedToast(err, gesture)` called directly. The
//             contract names it as this surface's driver, so this is the
//             surface, not a stand-in for it. The registered gesture is driven
//             too, in P0, to prove the seam still reaches the same text.
//   download  `offerModelPull` (the exported vscode-layer flow) against a real
//             server answering the status, with the human ratifying the
//             download. `firstRun.ts`'s own toast is read off the vscode stub.
//   tighten   the REGISTERED `column80.tightenDocComment` command, against a
//             real file with a doc comment, with the REAL `buildFnGenService`
//             behind the `buildService` seam and a REAL `FnGenService` whose
//             only substitution is the transport fn (the constructor's own
//             injection seam). The warning is read off the vscode stub.
//
// The harness is the session-v56 phase-4 oracle's rig for the gesture and
// tighten drives and the session-v58 phase-7 oracle's rig for the pull drive;
// both are current and green on this tree.
//
// ===========================================================================
// BINDINGS THE CONTRACT LEAVES OPEN, RESOLVED AND REPORTED
// ===========================================================================
//
//   * "THE SAME CRAFTED SENTENCE BODY" is split into two clauses with separate
//     diagnostics, because they can fail for different reasons:
//       (a) each surface's toast CONTAINS the sentence translateServiceReject
//           returns for the error that surface actually received;
//       (b) the gesture arm's sentence and the pull arm's sentence, for the
//           same status class, are the SAME string.
//     Clause (b) is where a build that names the transport inside the sentence
//     ("Ollama is rate limiting you" vs "the pull is rate limiting you") would
//     land, and its diagnostic says so: that is a contract question, not a test
//     defect, because the contract says "the SAME crafted sentence body".
//   * WHICH 5xx. The contract says "any 5xx" and offers 503, so 503 is driven.
//     One member per class is what the contract's table asks for; the 500-599
//     range is already pinned by `test/blind-v58-p7-http-status-classes.test.cjs`
//     and is not re-litigated here.
//   * "CONTAINS", not "equals". The gesture surface is where the sentence is
//     defined, so there it is an equality; the other two surfaces may frame it
//     ("Column 80: the download failed - <sentence>"), and the contract only
//     claims the sentence APPEARS. Containment is the honest binding.
//   * THE UNCLASSIFIED CASE is bound as: `translateServiceReject` returns
//     undefined for a 418, and no surface's 418 toast carries any of the four
//     classified sentences. Gated on all four classified sentences existing
//     first, or the ban would pass loudest on a tree with no sentences at all.
//   * THE CHANNEL POINTER's wording is lifted out of the product with a
//     sentinel rather than typed, so the pointer row re-baselines on a
//     rewording instead of going falsely red.
//   * THE LEAF CLAIM is a source-shape claim and gets a source-shape row: find
//     the file under `src/` that DECLARES both exports, assert it is none of
//     the three named modules, and walk its relative imports transitively
//     asserting none of them is one of the three either. That is the contract's
//     "or anything that imports them", checked one graph rather than one hop.
//
// ===========================================================================
// MEASURED WHILE THE PHASE WAS PART BUILT, AND SAID SO
// ===========================================================================
//
// THE TREE MOVED UNDER THIS FILE, which is worth recording rather than
// smoothing over. When it was written, `translateServiceReject` and
// `generationFailedToast` were both declared in `fnGen.ts` and C6 was expected
// red. By the time it was first RUN, the working tree carried an untracked
// `src/vscode/failureToast.ts` and a modified `fnGen.ts`: the contract's "move,
// not a rewrite" had already landed uncommitted. So the first measurement below
// is against a HALF-BUILT tree, and the C6 green is a fact about that tree, not
// about the branch point.
//
//   17 rows. 4 RED, 13 GREEN.
//
//   RED   C1 [401] [403] [429] [503]  - and both remaining surfaces are short:
//                                       the download toast still renders the
//                                       raw transport text with the provider's
//                                       JSON in it, and the tighten warning
//                                       still says "the model could not be
//                                       reached" at a 401, a 429 and a 503,
//                                       where the server was reached and
//                                       refused. Those are contract defects 1
//                                       and 2 verbatim.
//   GREEN C2 [tighten clause] x5      - the clause is there today
//   GREEN C3 [one line] x2            - firstLine already bounds all three
//   GREEN C4 [unclassified 418]       - and NOT vacuously: its precondition
//                                       needs all four class sentences to
//                                       exist, and on this tree they do
//   GREEN C5 [unknown error] x2       - THE PLUMBING ROWS. They use the same
//                                       bundle, the same facade and the same
//                                       derivation-from-the-product as C1, so a
//                                       green C5 beside a red C1 says the rig
//                                       works and the surfaces do not.
//   GREEN C6 [leaf module]            - failureToast.ts, reaching 2 modules
//                                       transitively, none of the three
//   GREEN G1, P0                      - harness and probe. P0 drives all three
//                                       surfaces and asserts each produced its
//                                       toast, which is the proof the two
//                                       vscode drives really ran rather than
//                                       silently doing nothing.
//
// Run: node --test test/blind-v59-p1-one-sentence-everywhere.test.cjs

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const path = require("node:path");
const fs = require("node:fs");
const esbuild = require("esbuild");

const ROOT = path.join(__dirname, "..");

// ---------------------------------------------------------------------------
// The vscode stub. The session-v56 phase-4 stub (drives REGISTERED gestures,
// answerable info/warn queues, host seams, a workspace.fs that really writes)
// with the session-v58 phase-7 stub's extra registrations folded in.
// ---------------------------------------------------------------------------

const WROOT = path.join(__dirname, ".blind-v59-p1-workspace");
fs.rmSync(WROOT, { recursive: true, force: true });
fs.mkdirSync(path.join(WROOT, "src"), { recursive: true });
fs.writeFileSync(
  path.join(WROOT, "package.json"),
  '{"name":"w","version":"0.0.0","scripts":{"test":"vitest run"},"devDependencies":{"vitest":"^1.0.0"}}\n',
);

const STUB = path.join(__dirname, ".blind-v59-p1-stub.cjs");
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
    onDidRenameFiles: () => ({ dispose() {} }),
    onDidDeleteFiles: () => ({ dispose() {} }),
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
    registerTreeDataProvider: () => ({ dispose() {} }),
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
    onDidChangeVisibleTextEditors: () => ({ dispose() {} }),
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

// ---------------------------------------------------------------------------
// The bundle. The two facade functions are taken from `fnGen.ts`, which the
// contract guarantees keeps exporting them ("fnGen.ts re-exports or imports
// them; existing importers of fnGen.ts do not break"). That is deliberate: this
// file must not have to guess the new leaf's filename, and C6 finds it by
// searching the source instead.
// ---------------------------------------------------------------------------

const ENTRY = path.join(__dirname, ".blind-v59-p1.entry.ts");
const OUTFILE = path.join(__dirname, ".blind-v59-p1.bundle.cjs");
let B = {};
let bundleErr;
try {
  fs.writeFileSync(
    ENTRY,
    `export { registerFnGen, buildFnGenService, generationFailedToast, translateServiceReject } from "../src/vscode/fnGen";
export { offerModelPull } from "../src/vscode/firstRun";
export { generateInstruct, pullModel } from "../src/core/ollama";
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
    if (bundleErr) return ctx.skip("bundle failed to build; see the G1 harness guard row");
    return fn(ctx);
  });

// ---------------------------------------------------------------------------
// Servers.
// ---------------------------------------------------------------------------

function serve(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({
        base: `http://127.0.0.1:${server.address().port}`,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

const jsonStatus = (status, body) => (_req, res) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(body);
};

// ---------------------------------------------------------------------------
// The fixture the tighten gesture needs: a real file with a doc comment above a
// return-annotated function, plus a symbol hierarchy.
// ---------------------------------------------------------------------------

const REMOTE_HOST = "http://ml-box.invalid:11434";
const MODEL = "qwen3-coder:480b";
const MB = 1048576;

const SRC =
  "// this walker keeps a shard mem cache for each of the client sets and drops every entry it can prove is stale\n" +
  "export function walk(): number {\n" +
  "  return 1;\n" +
  "}\n" +
  "\n";
const FSPATH = path.join(WROOT, "src", "walk.ts");
fs.writeFileSync(FSPATH, SRC);

const CONFIG = { apiBase: REMOTE_HOST, fnGenModel: MODEL, repairEnabled: true };
const CFG = { apiBase: REMOTE_HOST, model: MODEL, fallbackModel: MODEL, maxTokens: 512, temperature: 0.2 };
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
// The registered-gesture drive (session-v56 phase 4's rig).
// ---------------------------------------------------------------------------

const TIGHTEN = "column80.tightenDocComment";
const GEN = "column80.generateFunction";

async function driveCommand({ command, cursor, generateFn, infoResponses, settle = 250 }) {
  const st = B.__state;
  st.wroot = WROOT;
  st.config = { ...CONFIG };
  st.messages = [];
  st.commands = {};
  st.executeCalls = [];
  st.appliedEdits = [];
  st.snippetInserts = [];
  st.terminals = [];
  st.warnResponses = [];
  st.infoResponses = infoResponses ? infoResponses.slice() : [];
  const doc = makeDoc();
  st.textDocuments = [doc];
  st.symbols = symbolsFor();

  const lines = [];
  const output = { lines, appendLine: (l) => lines.push(String(l)), append() {}, show() {}, clear() {}, dispose() {} };
  let built;
  const context = { subscriptions: [], globalStorageUri: { fsPath: path.join(WROOT, ".storage") } };
  try {
    B.registerFnGen(context, output, new B.ContextBlockStore(() => {}), {
      buildService: async (out, log) => {
        built = await B.buildFnGenService(out, log, probeOpts, { listModels: async () => [MODEL] });
        try {
          built.service.dispose();
        } catch {
          /* teardown only */
        }
        built = { ...built, service: new B.FnGenService({ ...CFG }, generateFn, log) };
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
      edit: async (cb) => {
        cb({ replace() {}, insert() {}, delete() {} });
        return true;
      },
    };
    st.messages = [];
    await st.commands[command]();
    await new Promise((r) => setTimeout(r, settle));
    return {
      toasts: st.messages.map((m) => ({ kind: m.kind, message: String(m.message) })),
      channel: lines.slice(),
    };
  } finally {
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

// ---------------------------------------------------------------------------
// The pull drive (session-v58 phase 7's rig), against a real server.
// ---------------------------------------------------------------------------

async function drivePull(status, body) {
  const st = B.__state;
  st.messages = [];
  st.infoResponses = ["Download"];
  st.warnResponses = [];
  const lines = [];
  const output = { appendLine: (l) => lines.push(String(l)) };
  const srv = await serve(jsonStatus(status, body));
  let landed;
  try {
    landed = await B.offerModelPull(srv.base, "test-model", output, "the model is missing");
  } finally {
    await srv.close();
  }
  const toasts = st.messages.map((m) => ({ kind: m.kind, message: String(m.message) }));
  st.messages = [];
  return { landed, channel: lines, toasts };
}

// ---------------------------------------------------------------------------
// Real HttpStatusErrors off a real socket.
// ---------------------------------------------------------------------------

async function realGenerateError(status, body) {
  const srv = await serve(jsonStatus(status, body));
  try {
    await B.generateInstruct({
      apiBase: srv.base,
      model: "test-model",
      prompt: "write a function",
      maxTokens: 64,
      temperature: 0,
      signal: new AbortController().signal,
      log: () => undefined,
    });
    return undefined;
  } catch (err) {
    return err;
  } finally {
    await srv.close();
  }
}

async function realPullError(status, body) {
  const srv = await serve(jsonStatus(status, body));
  try {
    await B.pullModel(srv.base, "test-model", new AbortController().signal, () => undefined, () => undefined);
    return undefined;
  } catch (err) {
    return err;
  } finally {
    await srv.close();
  }
}

// ---------------------------------------------------------------------------
// Bodies and statuses.
// ---------------------------------------------------------------------------

const REQ_ID = "req_011CQxWn7TeAPOOL";
const HOSTILE = JSON.stringify({
  error: { type: "rate_limit_error", message: "you have exceeded your per-minute token quota", code: 429 },
  request_id: REQ_ID,
});

/** A body carrying every break in the set `firstLine` bounds, so C3 drives the
 *  widened rule rather than only LF. Assembled with explicit escapes and NOT
 *  through JSON.stringify, which would turn each break into two harmless
 *  characters and leave nothing for the cut to do. */
const BREAKY =
  '{"error":"first line\nsecond line\rthird\\u2028fourth\\u2029fifth\\u0085sixth line"}';

const CLASSIFIED = [401, 403, 429, 503];
const UNCLASSIFIED = 418;

const GESTURE = "function generation";
/** LF, CR, U+2028, U+2029 and U+0085 - the set `src/vscode/toastText.ts`
 *  declares, and the set the contract binds these toasts to by naming
 *  `firstLine` as the bound. The SET is re-stated here; no wording ever is. */
const BREAKS = /[\n\r\u2028\u2029\u0085]/;
const short = (s) => (typeof s === "string" && s.length > 300 ? `${s.slice(0, 300)}... (${s.length} chars)` : s);
const show = (v) => JSON.stringify(short(v));
const lineOf = (t) => `[${t.kind}] ${show(t.message)}`;

// ---------------------------------------------------------------------------
// Observations, memoised. Rows are independent assertions over shared drives.
// ---------------------------------------------------------------------------

const memo = new Map();
const once = (key, make) => {
  if (!memo.has(key)) memo.set(key, make());
  return memo.get(key);
};

/** All three surfaces for one status and one body. */
function surfaces(status, body, tag) {
  return once(`surfaces|${status}|${tag}`, async () => {
    const genErr = await realGenerateError(status, body);
    const pullErr = await realPullError(status, body);
    const pull = await drivePull(status, body);
    const tighten = await driveCommand({
      command: TIGHTEN,
      cursor: IN_COMMENT,
      generateFn: async () => {
        throw genErr;
      },
      infoResponses: [],
    });
    const warns = (r) => r.toasts.filter((t) => t.kind === "warn" || t.kind === "error");
    return {
      status,
      tag,
      genErr,
      pullErr,
      genToast: genErr === undefined ? undefined : B.generationFailedToast(genErr, GESTURE),
      genSentence: genErr === undefined ? undefined : B.translateServiceReject(genErr),
      pullSentence: pullErr === undefined ? undefined : B.translateServiceReject(pullErr),
      pullToasts: warns(pull),
      pullAll: pull.toasts,
      pullLanded: pull.landed,
      tightenToasts: warns(tighten),
      tightenAll: tighten.toasts,
      tightenChannel: tighten.channel,
    };
  });
}

const hostileAt = (status) => surfaces(status, HOSTILE, "hostile");
const breakyAt = (status) => surfaces(status, BREAKY, "breaky");

/** The channel pointer, taken out of the product rather than typed here. */
const SENTINEL = "ZZ-DETAIL-ZZ";
const POINTER = bundleErr
  ? ""
  : String(B.generationFailedToast(new Error(`${SENTINEL}\nsecond line`), GESTURE)).split(SENTINEL)[1] || "";

/** The one clause the contract writes down and forbids moving. */
const REWRAP_CLAUSE = "The re-wrap needs no model.";

// ===========================================================================
// G1 - HARNESS. Without this, a green run can mean the bundle never built.
// ===========================================================================

test("G1 [harness]: the bundle builds headless and the facade, the transports and the gestures are all reachable", async () => {
  if (bundleErr) assert.fail(`bundle failed: ${bundleErr.stack || bundleErr.message}`);
  for (const name of [
    "registerFnGen",
    "buildFnGenService",
    "generationFailedToast",
    "translateServiceReject",
    "offerModelPull",
    "generateInstruct",
    "pullModel",
    "FnGenService",
  ]) {
    assert.equal(typeof B[name], "function", `${name} must be callable for this file to drive it`);
  }
  const err = await realGenerateError(503, HOSTILE);
  assert.ok(err instanceof Error, "the ollama transport must throw on a 503");
  assert.equal(
    err.status,
    503,
    "harness: the typed HttpStatusError is session-v58's, already on this tree. Every row below hands " +
      `the product an error the TRANSPORT typed, never one this file built. Got status ${String(err.status)}`,
  );
  assert.ok(
    typeof err.transport === "string" && err.transport.trim() !== "",
    `harness: and it names its transport, got ${show(err.transport)}`,
  );
  assert.ok(
    POINTER.trim() !== "" && !POINTER.includes(SENTINEL),
    `harness: the channel pointer must be derivable from the product's own catch-all, got ${show(POINTER)}. ` +
      "C5 pins the product's wording, never one typed into this file",
  );
});

// ===========================================================================
// P0 - PROBE. Prints all three surfaces at every status, and asserts only the
// thing a silent rig would fail: that each drive really produced a toast.
// ===========================================================================

btest("P0 [probe]: all three surfaces at every status, and each drive really fired", async () => {
  console.error("\n=== P0 table: three surfaces, hostile JSON body ===");
  for (const status of [...CLASSIFIED, UNCLASSIFIED]) {
    const s = await hostileAt(status);
    console.error("--- status %d ---", status);
    console.error("  throw       : %s", show(s.genErr && s.genErr.message));
    console.error("  tsr(gen)    : %s", show(s.genSentence));
    console.error("  tsr(pull)   : %s", show(s.pullSentence));
    console.error("  gesture     : %s", show(s.genToast));
    console.error("  download    : %s", s.pullToasts.map(lineOf).join(" | "));
    console.error("  tighten     : %s", s.tightenToasts.map(lineOf).join(" | "));
    assert.equal(
      s.pullToasts.length,
      1,
      `harness: the download surface must show exactly ONE warning at ${status}, so a row reading ` +
        `pullToasts[0] is reading the download toast. Saw: ${JSON.stringify(s.pullAll.map(lineOf))}`,
    );
    assert.equal(
      s.pullLanded,
      false,
      "harness: and the pull must report failure, or the catch under test never ran",
    );
    assert.ok(
      s.tightenToasts.length >= 1,
      `harness: the tighten gesture must warn when its proposer round fails at ${status}, or the catch ` +
        `under test never ran. Saw: ${JSON.stringify(s.tightenAll.map(lineOf))}`,
    );
  }
  console.error("=== end P0 table ===\n");
});

// ===========================================================================
// C1 - THE CENTRAL CLAIM. One crafted sentence, all three surfaces.
// ===========================================================================

for (const status of CLASSIFIED) {
  btest(`C1 [${status}]: the crafted sentence appears on the gesture, the download and the tighten toasts`, async () => {
    const s = await hostileAt(status);
    assert.ok(s.genErr instanceof Error, `precondition: the transport must throw on a ${status}`);
    assert.ok(s.pullErr instanceof Error, `precondition: the pull transport must throw on a ${status}`);

    // PRECONDITION. Without it every "contains" below passes vacuously on a
    // tree that crafts nothing, which is exactly today's tree.
    assert.ok(
      typeof s.genSentence === "string" && s.genSentence.trim() !== "",
      `C1 PRECONDITION: translateServiceReject crafted nothing for a ${status}. The contract defines the ` +
        "sentence as what this facade returns, so with nothing there the three surfaces have nothing to " +
        `agree on and every clause below would pass on an empty claim.\n` +
        `  throw: ${show(s.genErr.message)}\n` +
        `  tsr  : ${show(s.genSentence)}`,
    );

    // (a) the gesture surface. The contract names generationFailedToast as this
    //     surface's driver, so the sentence must be what it renders.
    assert.ok(
      String(s.genToast).includes(s.genSentence),
      `C1(a): the fn-gen/test-gen toast must carry the crafted sentence.\n` +
        `  sentence: ${show(s.genSentence)}\n` +
        `  toast   : ${show(s.genToast)}`,
    );

    // (b) the two arms agree on the sentence for the same class. If this is the
    //     only clause that fails, the build put the transport's name inside the
    //     sentence - a contract question, not a test defect.
    assert.equal(
      s.pullSentence,
      s.genSentence,
      `C1(b): "for each, ALL THREE surfaces produce the SAME crafted sentence body". The generate arm and ` +
        `the pull arm answered a ${status} with different sentences. If the difference is the transport's ` +
        "name, the contract sentence is the thing to settle, not this row.\n" +
        `  generate: ${show(s.genSentence)}\n` +
        `  pull    : ${show(s.pullSentence)}`,
    );

    // (c) and (d). RE-CUT 2026-08-23, and the reason is the whole point of the
    // row, so it is written here rather than in a commit nobody reads next to
    // the code.
    //
    // These two clauses used to assert that the WHOLE generation sentence is a
    // substring of the other two surfaces' toasts. That is what
    // contract-phase1.md demanded, this file was written blind against it, and
    // the demand was WRONG. Session-v59's batched adversarial review drove the
    // consequence: the tighten gesture does not stop at its warning - it goes on
    // through its gates and applies the re-wrap - so carrying the generation
    // sentence whole made the product say "so nothing was written" in the same
    // notification that announced the write, with "The re-wrap needs no model."
    // beside it making the contradiction explicit. The download toast told the
    // user to run a gesture, for a click on Download.
    //
    // So the contract narrowed (S31, NOT YET RATIFIED) and this row narrows with
    // it - and it gets STRICTER, not looser. The old clause asked one question,
    // "is the sentence in there". This asks three, and the second and third are
    // new: the three surfaces must SHARE their diagnosis, each must then say what
    // actually happened HERE, and neither of the other two may repeat the
    // generation arm's consequence. A build that reverts to one sentence
    // everywhere now fails on the third question, which the old clause could not
    // even ask.
    //
    // Nothing below is typed out of a spec. The shared half is the three
    // surfaces' own longest common prefix, and the generation arm's consequence
    // is what remains of ITS sentence after that prefix. Both are read off the
    // product, which is the discipline the rest of this file keeps.
    const surfaces = [
      ["(c) the model download toast", s.pullToasts.map((t) => t.message)],
      ["(d) the tighten warning", s.tightenToasts.map((t) => t.message)],
    ];
    const bearer = (texts) => texts.find((t) => t.startsWith("Column 80: ")) ?? texts[0] ?? "";
    const common = surfaces.reduce((acc, [, texts]) => sharedHead(acc, bearer(texts)), s.genSentence);

    // The diagnosis has to be a real claim about what went wrong. "Column 80: "
    // is 11 characters every toast carries, so a build that shared nothing else
    // would satisfy a bare "they have a common prefix" check on the brand alone.
    assert.ok(
      common.length > "Column 80: ".length + 12,
      `C1(c/d) PRECONDITION: the three surfaces share only ${show(common)} at ${status}, which is the ` +
        "brand and no diagnosis. One throw class must still produce one DIAGNOSIS everywhere; only the " +
        "consequence and the retry are allowed to differ by surface.\n" +
        `  gesture : ${show(s.genSentence)}\n` +
        surfaces.map(([label, texts]) => `  ${label}: ${show(texts.join(" | "))}`).join("\n"),
    );

    const genConsequence = s.genSentence.slice(common.length).trim();
    const wrong = [];
    for (const [label, texts] of surfaces) {
      const text = bearer(texts);
      if (!text.includes(common)) {
        wrong.push([label, "the shared diagnosis is missing, so this surface disagrees about what happened", text]);
      } else if (genConsequence !== "" && text.includes(genConsequence)) {
        wrong.push([
          label,
          `it repeats the GENERATION arm's consequence, ${show(genConsequence)}, which is not true here - ` +
            "this is the defect the review drove, and the reason the contract narrowed",
          text,
        ]);
      } else if (text.trim() === common.trim()) {
        wrong.push([label, "it carries the diagnosis and then says nothing about what happened HERE", text]);
      }
    }
    assert.equal(
      wrong.length,
      0,
      `C1: one throw class, one DIAGNOSIS on all three surfaces, and each surface's own consequence. At ` +
        `${status}, ${wrong.length} of the 2 surfaces past the gesture are wrong.\n` +
        `  shared diagnosis : ${show(common)}\n` +
        `  gesture says then: ${show(genConsequence)}\n` +
        wrong.map(([label, why, text]) => `  ${label}\n      why : ${why}\n      saw : ${show(text)}`).join("\n"),
    );
  });
}

/** The longest common prefix of two strings, cut back to a word boundary.
 *
 *  Cut back because a raw prefix can end mid-word: "rate limiting these
 *  requests, so nothing" and "...so no type names" share up to "so no", and a
 *  diagnosis that ends inside a word is not a claim anybody can read. */
function sharedHead(a, b) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const cut = a.slice(0, i);
  const lastSpace = cut.lastIndexOf(" ");
  return lastSpace === -1 ? cut : cut.slice(0, lastSpace);
}

// ===========================================================================
// C2 - THE TIGHTEN CLAUSE THAT MUST NOT MOVE.
// ===========================================================================

for (const status of [...CLASSIFIED, UNCLASSIFIED]) {
  btest(`C2 [tighten clause ${status}]: the warning still says "${REWRAP_CLAUSE}"`, async () => {
    const s = await hostileAt(status);
    assert.ok(
      s.tightenToasts.length >= 1,
      `precondition: the tighten gesture never warned on a ${status}, so this row proves nothing. ` +
        `Saw: ${JSON.stringify(s.tightenAll.map(lineOf))}`,
    );
    assert.ok(
      s.tightenToasts.some((t) => t.message.includes(REWRAP_CLAUSE)),
      `C2: "What must NOT change" - the second clause stays. It is what makes the failure a warning ` +
        "rather than an error, and it is still true whatever the model did.\n" +
        `  warning: ${show(s.tightenToasts.map((t) => t.message).join(" | "))}`,
    );
  });
}

// ===========================================================================
// C3 - EVERY TOAST IS ONE LINE, even when the error carries every break in the
// set `firstLine` bounds.
// ===========================================================================

for (const status of [503, UNCLASSIFIED]) {
  btest(`C3 [one line ${status}]: no surface renders a break, on an error whose message carries all five`, async () => {
    const s = await breakyAt(status);
    assert.ok(s.genErr instanceof Error, `precondition: the transport must throw on a ${status}`);
    assert.ok(
      BREAKS.test(s.genErr.message),
      `precondition: the thrown message must actually carry the breaks, or this row is a tautology. ` +
        `Got ${show(s.genErr.message)}`,
    );
    const rows = [
      ["the fn-gen gesture", [{ kind: "gesture", message: String(s.genToast) }]],
      ["the model download", s.pullToasts],
      ["the tighten gesture", s.tightenToasts],
    ];
    for (const [label, toasts] of rows) {
      assert.ok(toasts.length >= 1, `precondition: ${label} produced no toast at ${status}`);
      for (const t of toasts) {
        assert.ok(
          !BREAKS.test(t.message),
          `C3: "Every toast stays ONE line. The bound is firstLine from src/vscode/toastText.ts." ` +
            `${label} rendered a line break at ${status}. A notification carrying one renders as two ` +
            `visual rows and the channel pointer falls off the bottom.\n  toast: ${show(t.message)}`,
        );
      }
    }
  });
}

// ===========================================================================
// C4 - AN UNCLASSIFIED STATUS DRAWS NO CLASSIFIED SENTENCE.
// ===========================================================================

btest(`C4 [unclassified ${UNCLASSIFIED}]: no surface borrows a classified class's sentence`, async () => {
  const sentences = [];
  for (const status of CLASSIFIED) {
    const s = await hostileAt(status);
    sentences.push([status, s.genSentence]);
  }
  // PRECONDITION. A ban list on a tree with no sentences bans nothing.
  for (const [status, sentence] of sentences) {
    assert.ok(
      typeof sentence === "string" && sentence.trim() !== "",
      `C4 PRECONDITION: there is no crafted sentence for a ${status} yet, so "the 418 must not draw it" ` +
        "is a ban on the empty string and would pass on any tree at all",
    );
  }
  const odd = await hostileAt(UNCLASSIFIED);
  assert.equal(
    odd.genSentence,
    undefined,
    `C4: "An UNCLASSIFIED status (say 418) keeps each surface's existing wording." A crafted sentence for ` +
      `a ${UNCLASSIFIED} is a class where the contract says there is none.\n  tsr: ${show(odd.genSentence)}`,
  );
  const surfacesOf418 = [
    ["the fn-gen gesture", [String(odd.genToast)]],
    ["the model download", odd.pullToasts.map((t) => t.message)],
    ["the tighten gesture", odd.tightenToasts.map((t) => t.message)],
  ];
  for (const [label, texts] of surfacesOf418) {
    for (const text of texts) {
      for (const [status, sentence] of sentences) {
        assert.ok(
          !text.includes(sentence),
          `C4: ${label} answered a ${UNCLASSIFIED} with the ${status} class's sentence. The provider's own ` +
            "message is the actionable half of an unclassified failure, and a borrowed class sentence " +
            `states a next action nobody measured.\n  sentence: ${show(sentence)}\n  toast   : ${show(text)}`,
        );
      }
    }
  }
});

// ===========================================================================
// C5 - THE UNKNOWN ERROR. One line, with the channel pointer.
//
// THE PLUMBING ROW. It uses the same bundle, the same facade and the same
// derivation-from-the-product as C1, and it is green today: a red C1 next to a
// green C5 says the rig works and the feature is absent.
// ===========================================================================

btest("C5 [unknown error]: generationFailedToast still renders one line with the channel pointer", () => {
  const err = new Error("the flux capacitor failed\n    at internalFrame (deep.ts:12:3)\nsecond internal detail");
  const toast = B.generationFailedToast(err, GESTURE);
  assert.ok(
    !BREAKS.test(toast),
    `C5: a toast is one line, unknown error or not. Got ${show(toast)}`,
  );
  assert.ok(
    !toast.includes("at internalFrame") && !toast.includes("second internal detail"),
    `C5: and nothing past the first line reaches it. Got ${show(toast)}`,
  );
  assert.ok(
    toast.includes(POINTER.trim()),
    `C5: the cut dropped two lines, so the toast must point at the channel. The pointer's wording is ` +
      `lifted out of the product, not typed here: ${show(POINTER.trim())}\n  toast: ${show(toast)}`,
  );
});

btest("C5 [unknown error, tighten]: the tighten warning is one line too, and keeps its clause", async () => {
  const multi = new Error("the flux capacitor failed\n    at internalFrame (deep.ts:12:3)");
  const r = await driveCommand({
    command: TIGHTEN,
    cursor: IN_COMMENT,
    generateFn: async () => {
      throw multi;
    },
    infoResponses: [],
  });
  const warns = r.toasts.filter((t) => t.kind === "warn" || t.kind === "error");
  assert.ok(
    warns.length >= 1,
    `precondition: the tighten proposer failure must reach the user. Saw ${JSON.stringify(r.toasts.map(lineOf))}`,
  );
  for (const t of warns) {
    assert.ok(!BREAKS.test(t.message), `C5: the tighten warning is one line. Got ${show(t.message)}`);
    assert.ok(
      !t.message.includes("at internalFrame"),
      `C5: and no stack frame reaches it. Got ${show(t.message)}`,
    );
  }
  assert.ok(
    warns.some((t) => t.message.includes(REWRAP_CLAUSE)),
    `C5: the clause survives an unknown error too.\n  warning: ${show(warns.map((t) => t.message).join(" | "))}`,
  );
});

// ===========================================================================
// C6 - THE LEAF CLAIM. A source-shape claim gets a source-shape row.
// ===========================================================================

const OWNERS = ["src/vscode/fnGen.ts", "src/vscode/firstRun.ts", "src/vscode/tightenDocComment.ts"];

function tsFilesUnder(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) tsFilesUnder(full, out);
    else if (name.endsWith(".ts")) out.push(full);
  }
  return out;
}

/** Every relative specifier an import or a re-export line names. */
function relativeSpecifiers(text) {
  const out = [];
  const re = /^\s*(?:import|export)\b[^\n]*?from\s+["'](\.[^"']+)["']/gm;
  let m;
  while ((m = re.exec(text)) !== null) out.push(m[1]);
  const bare = /^\s*import\s+["'](\.[^"']+)["']/gm;
  while ((m = bare.exec(text)) !== null) out.push(m[1]);
  return out;
}

function resolveSpecifier(fromFile, spec) {
  const base = path.resolve(path.dirname(fromFile), spec);
  for (const candidate of [`${base}.ts`, path.join(base, "index.ts")]) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return undefined;
}

btest("C6 [leaf module]: the module declaring the two exports is not one of the three, and never reaches them", () => {
  const files = tsFilesUnder(path.join(ROOT, "src"));
  const declares = files.filter((f) => {
    const text = fs.readFileSync(f, "utf8");
    return (
      /export\s+function\s+translateServiceReject\b/.test(text) &&
      /export\s+function\s+generationFailedToast\b/.test(text)
    );
  });
  assert.equal(
    declares.length,
    1,
    `C6: exactly one module must DECLARE both exports ("this is a move, not a rewrite"). Found ` +
      `${declares.length}: ${JSON.stringify(declares.map((f) => path.relative(ROOT, f)))}`,
  );
  const leaf = declares[0];
  const rel = path.relative(ROOT, leaf).split(path.sep).join("/");
  assert.ok(
    !OWNERS.includes(rel),
    `C6: "a leaf module ... exports" the two functions, and fnGen.ts "re-exports or imports them". The ` +
      `declarations are still in ${rel}, so the download and the tighten surfaces cannot take them without ` +
      "the import edge the contract forbids",
  );

  // "no import edge back into fnGen.ts, firstRun.ts, tightenDocComment.ts or
  // anything that imports them" - walked TRANSITIVELY, because a one-hop check
  // passes happily on a leaf that imports a helper that imports fnGen.
  const seen = new Set([leaf]);
  const via = new Map([[leaf, [rel]]]);
  const queue = [leaf];
  while (queue.length > 0) {
    const file = queue.shift();
    const text = fs.readFileSync(file, "utf8");
    for (const spec of relativeSpecifiers(text)) {
      const target = resolveSpecifier(file, spec);
      if (target === undefined || seen.has(target)) continue;
      seen.add(target);
      const targetRel = path.relative(ROOT, target).split(path.sep).join("/");
      const path_ = [...via.get(file), targetRel];
      via.set(target, path_);
      assert.ok(
        !OWNERS.includes(targetRel),
        `C6: the leaf must have "no import edge back into fnGen.ts, firstRun.ts, tightenDocComment.ts or ` +
          `anything that imports them". It reaches ${targetRel} via ${path_.join(" -> ")}. That edge is a ` +
          "cycle waiting to happen: fnGen registers the other two, so a value edge back closes the loop",
      );
      queue.push(target);
    }
  }
  console.error(
    "\nC6 [leaf module]: %s, reaching %d modules transitively, none of them %s\n",
    rel,
    seen.size - 1,
    JSON.stringify(OWNERS),
  );
});
