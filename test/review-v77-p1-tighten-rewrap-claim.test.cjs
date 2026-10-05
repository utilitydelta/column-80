// Adversarial review of session-v77 phase 1: TIGHTEN_VOICE's new consequence
// clause "so only the re-wrap is offered" is false when the comment is already
// wrapped. The gesture then ends `nothing` ("the comment is already wrapped"),
// so the warning promises a re-wrap the user never sees. The old clause, "so no
// type names were offered", was true on every path.
//
// Harness copied from impl-v59-p1fix-surface-consequence.test.cjs.
//
// Run: SKIP_LIVE=1 node --test test/review-v77-p1-tighten-rewrap-claim.test.cjs


const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const fs = require("node:fs");
const esbuild = require("esbuild");

// ---------------------------------------------------------------------------
// Harness. One vscode stub, EXTERNAL to the bundle so this file and the product
// share one `__state`. Same stub the phase 1 implementer file drives.
// ---------------------------------------------------------------------------

const STUB = path.join(__dirname, ".review-v77-p1-tighten-stub.cjs");
fs.writeFileSync(
  STUB,
  `
const state = { config: {}, messages: [], commands: {}, appliedEdits: [], infoResponses: [], diffThrows: undefined };
class Position {
  constructor(line, character) { this.line = line; this.character = character; }
  translate(l = 0, c = 0) { return new Position(this.line + l, this.character + c); }
}
class Range {
  constructor(a, b, c, d) {
    if (typeof a === "number") { this.start = new Position(a, b); this.end = new Position(c, d); }
    else { this.start = a; this.end = b; }
  }
}
class WorkspaceEdit {
  constructor() { this._entries = []; }
  replace(uri, range, text) { this._entries.push([uri, [{ range, newText: text }]]); }
  entries() { return this._entries; }
}
class EventEmitter {
  constructor() { this.handlers = []; }
  get event() { return (fn) => { this.handlers.push(fn); return { dispose() {} }; }; }
  fire(x) { for (const h of this.handlers) h(x); }
  dispose() {}
}
class ThemeColor { constructor(id) { this.id = id; } }
class MarkdownString { constructor() {} appendCodeblock() {} appendMarkdown() {} appendText() {} }
class Diagnostic { constructor(range, message, severity) { this.range = range; this.message = message; this.severity = severity; } }
class TabInputTextDiff { constructor(original, modified) { this.original = original; this.modified = modified; } }
const Uri = {
  file: (p) => ({ fsPath: p, path: p, scheme: "file", toString: () => "file://" + p, with() { return this; } }),
  from: (parts) => ({ ...parts, fsPath: parts.path, toString: () => parts.scheme + "://" + parts.path + "?" + (parts.query || "") }),
  parse: (s) => { const p = String(s).replace(/^file:\\/\\//, ""); return { raw: s, fsPath: p, path: p, scheme: "file", toString: () => String(s), with() { return this; } }; },
  joinPath: (base, ...segs) => Uri.file([base.fsPath, ...segs].join("/")),
};
module.exports = {
  __state: state,
  Position, Range, WorkspaceEdit, EventEmitter, ThemeColor, MarkdownString, Diagnostic, TabInputTextDiff, Uri,
  EndOfLine: { LF: 1, CRLF: 2 },
  DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
  SymbolKind: { File: 0, Module: 1, Namespace: 2, Package: 3, Class: 4, Method: 5, Property: 6,
    Field: 7, Constructor: 8, Enum: 9, Interface: 10, Function: 11, Variable: 12, Constant: 13,
    String: 14, Number: 15, Boolean: 16, Array: 17, Object: 18, Key: 19, Null: 20, EnumMember: 21,
    Struct: 22, Event: 23, Operator: 24, TypeParameter: 25 },
  CompletionItemKind: { Method: 1, Function: 2, Field: 4, Variable: 5, Class: 6, Property: 9, Enum: 12, Constant: 20, Struct: 21 },
  ProgressLocation: { Notification: 15, Window: 10 },
  ConfigurationTarget: { Global: 1, Workspace: 2 },
  OverviewRulerLane: { Left: 1, Center: 2, Right: 4, Full: 7 },
  workspace: {
    workspaceFolders: [{ uri: Uri.file("/repo") }],
    getConfiguration: () => ({ get: (key, fallback) => (key in state.config ? state.config[key] : fallback), has: () => false, inspect: () => undefined, update: async () => {} }),
    onDidChangeConfiguration: () => ({ dispose() {} }),
    onDidChangeTextDocument: () => ({ dispose() {} }),
    registerTextDocumentContentProvider: () => ({ dispose() {} }),
    textDocuments: [],
    applyEdit: async (edit) => { state.appliedEdits.push(edit); return true; },
  },
  languages: {
    createDiagnosticCollection: (name) => ({ name, set() {}, delete() {}, clear() {}, dispose() {} }),
  },
  window: {
    createOutputChannel: (name) => ({ name, appendLine() {}, append() {}, show() {}, dispose() {} }),
    createTextEditorDecorationType: (opts) => ({ opts, dispose() {} }),
    visibleTextEditors: [],
    showInformationMessage: async (message, ...actions) => { state.messages.push({ kind: "info", message, actions }); return state.infoResponses.shift(); },
    showWarningMessage: async (message, ...actions) => { state.messages.push({ kind: "warn", message, actions }); return undefined; },
    showErrorMessage: async (message, ...actions) => { state.messages.push({ kind: "error", message, actions }); return undefined; },
    showQuickPick: async () => undefined,
    setStatusBarMessage: (message) => { state.messages.push({ kind: "status", message }); return { dispose() {} }; },
    withProgress: async (opts, task) => task({ report: () => {} }, { onCancellationRequested: () => ({ dispose() {} }) }),
    tabGroups: { all: [], activeTabGroup: undefined, onDidChangeTabs: () => ({ dispose() {} }), close: async () => {} },
  },
  commands: {
    registerCommand: (id, fn) => { state.commands[id] = fn; return { dispose() {} }; },
    executeCommand: async (id) => {
      if (id === "vscode.diff" && state.diffThrows !== undefined) throw state.diffThrows;
      return undefined;
    },
  },
};
`,
);

const vs = require(STUB);

const ENTRY = path.join(__dirname, ".review-v77-p1-tighten.entry.ts");
const OUTFILE = path.join(__dirname, ".review-v77-p1-tighten.bundle.cjs");
let B = {};
let bundleErr;
try {
  fs.writeFileSync(
    ENTRY,
    `export { HttpStatusError } from "../src/core/errorBound";
export { translateServiceReject, generationFailedToast } from "../src/vscode/failureToast";
export { offerModelPull } from "../src/vscode/firstRun";
export { tightenDocComment } from "../src/vscode/tightenDocComment";
export { ProposalPresenter } from "../src/vscode/fnGen";\n`,
  );
  esbuild.buildSync({
    entryPoints: [ENTRY],
    bundle: true,
    outfile: OUTFILE,
    format: "cjs",
    platform: "node",
    alias: { vscode: STUB },
    external: [STUB],
  });
  B = require(OUTFILE);
} catch (e) {
  bundleErr = e;
}
test.after(() => [STUB, ENTRY, OUTFILE].forEach((f) => fs.rmSync(f, { force: true })));

const btest = (name, fn) =>
  test(name, (ctx) => {
    if (bundleErr) return ctx.skip("bundle failed to build; see row H1");
    return fn(ctx);
  });

const show = (s) => JSON.stringify(s);
const BREAKS = /[\n\r\u2028\u2029\u0085]/;

function makeDoc(text, uriStr, languageId) {
  const lines = text.split("\n");
  const offsetAt = (p) => {
    let o = 0;
    for (let i = 0; i < Math.min(p.line, lines.length); i++) o += lines[i].length + 1;
    return Math.min(o + p.character, text.length);
  };
  const positionAt = (off) => {
    let o = 0;
    for (let l = 0; l < lines.length; l++) {
      if (off <= o + lines[l].length) return { line: l, character: off - o };
      o += lines[l].length + 1;
    }
    return { line: lines.length - 1, character: 0 };
  };
  return {
    languageId,
    version: 1,
    isClosed: false,
    uri: { toString: () => uriStr, fsPath: uriStr, path: uriStr },
    offsetAt,
    positionAt,
    getText: (r) => (r ? text.slice(offsetAt(r.start), offsetAt(r.end)) : text),
    lineAt: (l) => ({ text: lines[l] }),
  };
}

async function driveTighten(err, text) {
  const doc = makeDoc(text, TS_FILE, "typescript");
  const warnings = [];
  const wiring = {
    presenter: { confirmDiff: async () => "accept" },
    resolveFunction: async () => ({ languageId: "typescript", symbolName: "walk" }),
    resolvePrefill: async () => undefined,
    prefillLangFor: () => ({ localTypeDefs: () => new Map(), typeReference: () => undefined }),
    extractorFor: () => undefined,
    transport: () => async () => {
      throw err;
    },
    modelTag: () => "test-model",
  };
  const deps = {
    querySymbols: async () => [],
    fileExists: () => false,
    readFile: () => undefined,
    workspaceRoot: () => "/repo",
    config: () => ({
      apiBase: "http://127.0.0.1:1/",
      model: "test-model",
      fallbackModel: "x",
      maxTokens: 2048,
      temperature: 0,
      numCtx: 16384,
    }),
    windowed: () => true,
    review: async () => [],
    applyEdit: async () => true,
    warn: (m) => warnings.push(m),
  };
  const result = await B.tightenDocComment(doc, { line: 0, character: 10 }, () => {}, wiring, deps);
  return { warnings, result };
}

const TS_FILE = "/repo/src/walk.ts";
// Short enough that the re-wrap changes nothing.
const WRAPPED = "// keeps the cache\nexport function walk() {}\n";
const httpErr = (status) => new B.HttpStatusError("ollama", status, `Ollama ${status} Service Unavailable`);

for (const status of [401, 429, 503]) {
  btest(`tighten/${status}, comment already wrapped: the warning does not promise a re-wrap that never comes`, async () => {
    const { warnings, result } = await driveTighten(httpErr(status), WRAPPED);
    // Since phase 4 DG23 the "already wrapped" end is channel-only after a
    // proposer failure, so the precondition reads the result, not a warning.
    assert.ok(
      result.status === "nothing" && /already wrapped/.test(result.reason),
      `precondition: the same press ends "already wrapped". Got ${show(result)}`,
    );
    assert.ok(warnings.length >= 1, `precondition: the proposer failure warned. Got ${show(warnings)}`);
    assert.ok(
      !/re-wrap is offered/.test(warnings[0]),
      `the warning says a re-wrap is offered, and the same press ends "already wrapped".\n  got: ${show(warnings[0])}\n  result: ${show(result)}`,
    );
  });
}
