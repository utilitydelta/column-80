// Adversarial review: session-v58 phase 7, the HTTP status classes
// (src/core/errorBound.ts `HttpStatusError`; src/vscode/fnGen.ts
// `httpStatusSentence` / `translateHttpStatus`).
//
// Written AFTER the implementation and after the blind oracle
// (test/blind-v58-p7-http-status-classes.test.cjs, 128 rows green). Its job is
// the opposite of the oracle's: every row here is an attempt to break the
// thing, and a row that stays green is a claim of CLEAN, not decoration.
//
// Contract: session-v58/contract-phase7.md, including amendments A1-A4.
//
// ---------------------------------------------------------------------------
// WHERE THIS DIFFERS FROM THE ORACLE
// ---------------------------------------------------------------------------
//
// The oracle proves the MESSAGE and String(err) byte-identical against two
// materialised worktrees. A class can change more than its message, so the
// facet rows here compare seven observables at once - message, String(err),
// name, the stack's first line, instanceof Error, the Object.prototype.toString
// tag, and the JSON/inspect/own-keys serialisations - and the drift row PINS
// the three that legitimately moved so a later change cannot widen them
// unnoticed.
//
// The oracle's status set is {401,403,429,500,502,503,529,418,451,300}. This
// file sweeps the statuses these four providers actually return and the oracle
// never asked for: 400, 404, 408, 409, 413, 422, 504, 520-524.
//
// ---------------------------------------------------------------------------
// THE RE-CUT
// ---------------------------------------------------------------------------
//
// The first cut of this file found one HIGH there: the unclassified fallback
// answered "the model provider answered with HTTP 404" and DELETED the only
// actionable thing on screen - ollama's `model not found, try pulling it
// first`, Anthropic's `prompt is too long`, the cloud arm's
// `context_length_exceeded`. Triage closed it by returning undefined for an
// unclassified status so the existing catch-all renders it, widened the 5xx
// class to a range, split 401/403 on `err.transport`, and gave the auth and
// rate-limit sentences the channel pointer.
//
// So the rows that FOUND those are now the rows that guard the fixes, and they
// pin the PROPERTY rather than the mechanism: B2 and B3 say the unclassified
// toast still carries the provider's reason, and any future fallback sentence
// that swallows it turns this file red.
//
// ---------------------------------------------------------------------------
// ROW NAMING
// ---------------------------------------------------------------------------
//
//   REGRESSION - green means nothing moved.
//   HIGH, closed - green means a defect this file found is fixed and guarded.
//   closed     - green means a lesser finding is fixed and guarded.
//   FINDING    - green means a cost is present and pinned, deferred with a
//                scrap number. Read the assertion message; the prose report
//                carries the severity.
//
// Baseline ref is PINNED at the diff's parent rather than HEAD: once phase 7 is
// committed a HEAD baseline would compare the change against itself.
//
// Run: node --test test/adversarial-v58-p7.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const cp = require("node:child_process");
const http = require("node:http");
const util = require("node:util");
const esbuild = require("esbuild");

const ROOT = path.dirname(__dirname);

/** session-v58 phase 6: the last commit before the status classes. */
const BASE_REF = "5190b7a";

const T0 = Date.now();

// ---------------------------------------------------------------------------
// The vscode stub: blind-v58-p6's stub, verbatim, for the reason that file
// gives - only pure string functions are needed out of src/vscode/fnGen.ts, but
// its module graph touches most of the vscode API at import time.
// ---------------------------------------------------------------------------

const STUB = path.join(__dirname, ".adv-v58-p7-stub.cjs");
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

// ---------------------------------------------------------------------------
// Three bundles: the working tree, the branch point, and a SECOND copy of the
// working tree (the instanceof-across-bundles row needs two module instances).
// ---------------------------------------------------------------------------

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "adv-v58-p7-"));
const artifacts = [STUB];

function bundle(tag, entrySource) {
  const entry = path.join(__dirname, `.adv-v58-p7-${tag}.entry.ts`);
  const outfile = path.join(__dirname, `.adv-v58-p7-${tag}.bundle.cjs`);
  artifacts.push(entry, outfile);
  fs.writeFileSync(entry, entrySource);
  esbuild.buildSync({
    entryPoints: [entry],
    bundle: true,
    outfile,
    format: "cjs",
    platform: "node",
    alias: { vscode: STUB },
  });
  return require(outfile);
}

const q = (p) => JSON.stringify(p);
const ENTRY_FOR = (root) =>
  `export * from ${q(path.join(root, "src/core/errorBound"))};\n` +
  `export { generateInstruct, pullModel } from ${q(path.join(root, "src/core/ollama"))};\n` +
  `export { makeAnthropicInstruct } from ${q(path.join(root, "src/core/anthropicInstruct"))};\n` +
  `export { makeCloudInstruct } from ${q(path.join(root, "src/core/cloudInstruct"))};\n` +
  `export { generationFailedToast, translateServiceReject } from ${q(path.join(root, "src/vscode/fnGen"))};\n` +
  `export { ClaudeCodeError } from ${q(path.join(root, "src/core/claudeCodeInstruct"))};\n`;

let NOW = {};
let TWIN = {};
let BASE = {};
let baseFnGenSource = "";
let setupErr;
try {
  // `git archive` rather than a checkout: it writes the tree somewhere else and
  // never touches the working copy.
  cp.execSync(`git archive ${BASE_REF} src | tar -x -C ${q(TMP)}`, {
    cwd: ROOT,
    shell: "/bin/bash",
    stdio: ["ignore", "ignore", "pipe"],
  });
  baseFnGenSource = fs.readFileSync(path.join(TMP, "src/vscode/fnGen.ts"), "utf8");
  NOW = bundle("now", ENTRY_FOR(ROOT));
  TWIN = bundle("twin", ENTRY_FOR(ROOT));
  BASE = bundle("base", ENTRY_FOR(TMP));
} catch (e) {
  setupErr = e;
}

test.after(() => {
  for (const f of artifacts) fs.rmSync(f, { force: true });
  fs.rmSync(TMP, { recursive: true, force: true });
  console.error(`\n[adv-v58-p7] duration_ms=${Date.now() - T0}\n`);
});

const btest = (name, fn) =>
  test(name, (ctx) => {
    if (setupErr) assert.fail(`setup failed: ${setupErr.stack || setupErr.message}`);
    return fn(ctx);
  });

const short = (s) => (typeof s === "string" && s.length > 240 ? `${s.slice(0, 240)}... (${s.length} chars)` : s);
const show = (v) => JSON.stringify(short(v));

// ---------------------------------------------------------------------------
// Servers and drives.
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
const plain = (status, body) => (_req, res) => {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(body);
};
/** Headers promise a body, the socket dies before it arrives, `text()` rejects.
 *  Content-Length rather than a chunked cut: `res.destroy()` on a default
 *  chunked response gives `TypeError: terminated`, a different failure. The
 *  timer is unref'd so it can never hold the loop open. */
const torn = (_req, res) => {
  res.writeHead(500, { "Content-Type": "text/plain", "Content-Length": "1000" });
  res.write("partial-");
  setTimeout(() => res.socket.destroy(), 10).unref();
};

const PARAMS = (base) => ({
  apiBase: base,
  model: "test-model",
  prompt: "write a function",
  maxTokens: 64,
  temperature: 0,
  signal: new AbortController().signal,
});

const ARMS = [
  { name: "ollama-generate", gen: true, drive: (M, base, log) => M.generateInstruct({ ...PARAMS(base), log }) },
  {
    name: "ollama-pull",
    gen: false,
    drive: (M, base, log) => M.pullModel(base, "test-model", new AbortController().signal, () => undefined, log),
  },
  {
    name: "anthropic",
    gen: true,
    drive: (M, base, log) => M.makeAnthropicInstruct({ baseUrl: base, apiKey: "k", log })(PARAMS(base)),
  },
  {
    name: "cloud",
    gen: true,
    drive: (M, base, log) => M.makeCloudInstruct({ baseUrl: base, apiKey: "k", log })(PARAMS(base)),
  },
];
const GEN_ARMS = ARMS.filter((a) => a.gen);

const memo = new Map();
const once = (key, make) => {
  if (!memo.has(key)) memo.set(key, make());
  return memo.get(key);
};

async function caught(fn) {
  try {
    return { ok: true, value: await fn() };
  } catch (err) {
    return { ok: false, err };
  }
}

/** Drive both trees against the SAME socket, in order, so a reason phrase, a
 *  body size and a socket tear are literally one event for both. */
function drivePair(arm, tag, handler) {
  return once(`pair|${arm.name}|${tag}`, async () => {
    const srv = await serve(handler);
    const out = [];
    try {
      for (const M of [NOW, BASE]) {
        const lines = [];
        const r = await caught(() => arm.drive(M, srv.base, (l) => lines.push(String(l))));
        out.push({ ok: r.ok, err: r.err, lines });
      }
    } finally {
      await srv.close();
    }
    return { now: out[0], old: out[1] };
  });
}

/** The seven observables a caller could branch on. Not just the message: the
 *  whole point of the row is that a CLASS can move something else. */
function facets(err) {
  return {
    message: err instanceof Error ? err.message : String(err),
    string: String(err),
    name: err && err.name,
    stackHead: typeof err?.stack === "string" ? err.stack.split("\n")[0] : "<no stack>",
    isError: err instanceof Error,
    tag: Object.prototype.toString.call(err),
    errorLike: Object.prototype.toString.call(err) === "[object Error]",
  };
}

const GESTURE = "function generation";
const toastNow = (err) => NOW.generationFailedToast(err, GESTURE);
const toastBase = (err) => BASE.generationFailedToast(err, GESTURE);
/** What this exact message got with no typed identity on it. No sentence is
 *  ever written down in this file. */
const catchAll = (message) => NOW.generationFailedToast(new Error(message), GESTURE);
const crafted = (err) => toastNow(err) !== catchAll(err instanceof Error ? err.message : String(err));

// ===========================================================================
// G - HARNESS. Without these a green run can mean the trees never built.
// ===========================================================================

test("G1 [harness]: both trees bundle, and the baseline really is the parent", () => {
  if (setupErr) assert.fail(`setup failed: ${setupErr.stack || setupErr.message}`);
  for (const nm of ["generateInstruct", "pullModel", "makeAnthropicInstruct", "makeCloudInstruct",
    "generationFailedToast", "translateServiceReject", "ClaudeCodeError"]) {
    assert.strictEqual(typeof NOW[nm], "function", `the working tree must export ${nm}`);
    assert.strictEqual(typeof BASE[nm], "function", `${BASE_REF} must export ${nm}`);
  }
  assert.strictEqual(typeof NOW.HttpStatusError, "function", "the working tree declares HttpStatusError");
  assert.strictEqual(
    BASE.HttpStatusError,
    undefined,
    `${BASE_REF} must NOT have the class, or this file is comparing the change against itself`,
  );
  assert.strictEqual(typeof TWIN.HttpStatusError, "function", "the twin bundle built too");
  assert.notStrictEqual(TWIN.HttpStatusError, NOW.HttpStatusError, "the twin is a SECOND class object");
});

// ===========================================================================
// A - THE FACETS. A class can change more than its message.
// ===========================================================================

const SHAPES = [
  ["an empty body", plain(500, "")],
  ["a 200-char body", plain(500, "s".repeat(200))],
  ["a body exactly at the toast budget", plain(500, "q".repeat(400))],
  ["one char over the toast budget", plain(500, "o".repeat(401))],
  ["a 102400-char body", plain(500, "x".repeat(102400))],
  ["a surrogate pair straddling the cut", plain(500, `${"a".repeat(399)}\u{1F600}${"b".repeat(50)}`)],
  ["a 6000-char reason phrase", (_req, res) => { res.writeHead(500, "R".repeat(6000), { "Content-Type": "text/plain" }); res.end("body"); }],
  ["an unreadable body (torn socket)", torn],
];

for (const arm of ARMS) {
  for (const [label, handler] of SHAPES) {
    btest(`A1 [${arm.name}]: REGRESSION - all seven observables match ${BASE_REF}, ${label}`, async () => {
      const { now, old } = await drivePair(arm, `shape:${label}`, handler);
      assert.ok(!now.ok && !old.ok, `both trees must throw on ${label}`);
      const a = facets(now.err);
      const b = facets(old.err);
      for (const k of Object.keys(b)) {
        assert.deepStrictEqual(
          a[k],
          b[k],
          `A1: the observable \`${k}\` moved between ${BASE_REF} and the working tree. The oracle pins ` +
            `message and String(err); this row pins what a LOGGER, a name switch and an instanceof ` +
            `branch see too.\n  now : ${show(a[k])}\n  ${BASE_REF}: ${show(b[k])}`,
        );
      }
    });
  }
}

/** What these four providers actually return, not only what the contract named.
 *  400 is Anthropic's "prompt is too long" and OpenAI's context_length_exceeded;
 *  404 is ollama's "model not found"; 504 and 520-524 are what a Cloudflare-
 *  fronted provider emits when it is having trouble. */
const WIDE_STATUSES = [400, 401, 402, 403, 404, 408, 409, 413, 418, 422, 429, 451,
  500, 502, 503, 504, 520, 521, 522, 524, 529];

for (const arm of ARMS) {
  btest(`A2 [${arm.name}]: REGRESSION - twenty-one statuses render identically to ${BASE_REF}`, async () => {
    for (const status of WIDE_STATUSES) {
      const { now, old } = await drivePair(arm, `wide:${status}`, jsonStatus(status, JSON.stringify({ error: "x" })));
      assert.ok(!now.ok && !old.ok, `both trees must throw on ${status}`);
      const a = facets(now.err);
      const b = facets(old.err);
      assert.deepStrictEqual(a, b, `A2: status ${status} moved an observable\n  now : ${show(JSON.stringify(a))}\n  ${BASE_REF}: ${show(JSON.stringify(b))}`);
    }
  });
}

btest("A3 [serialisation drift]: the three facets that DID move, pinned to exactly {transport,status}", async () => {
  const { now, old } = await drivePair(ARMS[0], "wide:503", jsonStatus(503, JSON.stringify({ error: "x" })));
  assert.ok(!now.ok && !old.ok, "PRECONDITION: both trees threw");
  // Non-vacuous: the baseline really did serialise to nothing.
  assert.strictEqual(JSON.stringify(old.err), "{}", "PRECONDITION: a plain Error JSON-stringifies to {}");
  assert.deepStrictEqual(Object.keys(old.err), [], "PRECONDITION: a plain Error has no own enumerable keys");
  assert.deepStrictEqual(
    Object.keys(now.err),
    ["transport", "status"],
    "A3: the typed error's own ENUMERABLE keys are the phase's new public surface. TS parameter " +
      "properties are enumerable, so JSON.stringify(err) went from `{}` to a populated object and " +
      "util.inspect now prints the fields after the stack. Neither is read anywhere in src/ today; " +
      "this row exists so a later field cannot join them unnoticed.\n" +
      `  keys: ${show(JSON.stringify(Object.keys(now.err)))}`,
  );
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(now.err)),
    { transport: "ollama", status: 503 },
    "A3: and that is exactly what JSON.stringify now emits",
  );
  assert.ok(
    util.inspect(now.err).includes("status: 503"),
    `A3: util.inspect prints them too. Got: ${show(util.inspect(now.err))}`,
  );
});

btest("A4 [identity]: instanceof Error holds, the tag is unchanged, and `name` is left alone", async () => {
  for (const arm of ARMS) {
    const { now } = await drivePair(arm, "wide:503", jsonStatus(503, JSON.stringify({ error: "x" })));
    const err = now.err;
    assert.ok(err instanceof Error, `A4 [${arm.name}]: callers branch on instanceof Error - it must still hold`);
    assert.ok(err instanceof NOW.HttpStatusError, `A4 [${arm.name}]: and on the class, which is how the pass finds it`);
    assert.strictEqual(err.name, "Error", `A4 [${arm.name}]: amendment A1 - name is NOT set. Got ${show(err.name)}`);
    assert.strictEqual(Object.prototype.toString.call(err), "[object Error]", `A4 [${arm.name}]: the tag is unchanged`);
    assert.ok(!String(err).includes("HttpStatusError"), `A4 [${arm.name}]: the class name is nowhere in String(err)`);
    assert.ok(!String(err.stack).split("\n")[0].includes("HttpStatusError"), `A4 [${arm.name}]: nor in the stack's first line`);
    assert.strictEqual(err.constructor, NOW.HttpStatusError, `A4 [${arm.name}]: the constructor IS the subclass`);
    // The cost of leaving `name`: a switch on name cannot tell this from any
    // other Error, and minify mangles constructor.name in the shipped bundle.
    assert.strictEqual(err.name, new Error("x").name, "A4: a name switch cannot distinguish this from a plain Error");
  }
});

// ===========================================================================
// B - THE CLASS TABLE, over the statuses these providers actually return.
//
// RE-CUT after triage. The first cut of this file found the HIGH here: the
// unclassified fallback answered "the model provider answered with HTTP 404"
// and deleted the provider's own remedy. Triage closed it by returning
// undefined for an unclassified status and letting the existing catch-all
// render it - so the rows that FOUND the defect are now the rows that guard the
// fix, and B2 states the property directly: the unclassified toast still
// carries the provider's reason. A future fallback sentence that swallows it
// turns this file red.
// ===========================================================================

/** Every character a notification treats as a line break. Built with
 *  `String.fromCharCode` on purpose: a raw U+2028 in a .cjs file makes the file
 *  fail to PARSE, which is a green-looking way to delete a whole review. */
const BREAKS = ["\n", "\r", String.fromCharCode(0x2028), String.fromCharCode(0x2029)];

/** The crafted sentence for a status on an arm, or `undefined` where the
 *  translator declines to craft one. A real typed error through the real
 *  translator: cheaper than a socket and identical in what it exercises. */
const sentenceOn = (transport, status, message = `Cloud ${status} Reason: {"error":"x"}`) =>
  NOW.translateServiceReject(new NOW.HttpStatusError(transport, status, message));
/** The default arm for the class rows. 401 and 403 split on the transport since
 *  the re-cut and get their own rows; every other class is arm-blind. */
const sentenceFor = (status, message) => sentenceOn("cloud", status, message);

/** Every status this file believes carries a crafted sentence, and every status
 *  it believes falls through. Stated once so no row can quietly disagree. */
const CLASSED = [401, 403, 429, 500, 502, 503, 504, 507, 520, 521, 522, 524, 529, 599];
const UNCLASSED = [300, 400, 402, 404, 408, 409, 413, 418, 422, 451, 499, 600];

btest("B1 [probe]: the whole table, crafted and fallen-through, printed", () => {
  console.error("\n=== B1: status -> what the user reads ===");
  for (const status of [...CLASSED, ...UNCLASSED].sort((a, b) => a - b)) {
    const s = sentenceFor(status);
    const err = new NOW.HttpStatusError("cloud", status, `Cloud ${status} Reason: {"error":"provider said why"}`);
    console.error("  %d %s %s", status, s === undefined ? "[falls through] ->" : "[class] ->", toastNow(err));
  }
  console.error("=== end B1 ===\n");
  // Non-vacuous: the two sets must actually be the two sets.
  for (const status of CLASSED) {
    assert.strictEqual(typeof sentenceFor(status), "string", `B1: ${status} must carry a crafted sentence`);
    assert.ok(sentenceFor(status).startsWith("Column 80: "), `B1: ${status} must speak in the house voice`);
  }
  for (const status of UNCLASSED) {
    assert.strictEqual(sentenceFor(status), undefined, `B1: ${status} must fall through to the catch-all`);
  }
});

/** The three statuses where the provider's body IS the next action, with the
 *  bodies those providers really send. */
const REMEDIES = [
  { arm: ARMS[0], status: 404, needle: "not found, try pulling it first",
    body: JSON.stringify({ error: 'model "test-model" not found, try pulling it first' }) },
  { arm: ARMS[2], status: 400, needle: "prompt is too long",
    body: JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "prompt is too long: 250000 tokens > 200000 maximum" } }) },
  { arm: ARMS[3], status: 413, needle: "context_length_exceeded",
    body: JSON.stringify({ error: { message: "context_length_exceeded: reduce the prompt", code: "context_length_exceeded" } }) },
];

for (const r of REMEDIES) {
  btest(`B2 [HIGH, closed]: the ${r.status} remedy is back on screen, byte-identical to ${BASE_REF}`, async () => {
    const { now, old } = await drivePair(r.arm, `remedy:${r.status}`, jsonStatus(r.status, r.body));
    assert.ok(!now.ok && !old.ok, "PRECONDITION: both trees threw");
    const before = toastBase(old.err);
    const after = toastNow(now.err);
    assert.ok(before.includes(r.needle), `PRECONDITION: at ${BASE_REF} the user read the remedy. Got ${show(before)}`);
    assert.ok(
      after.includes(r.needle),
      `B2: THE HIGH. An unclassified status must not trade the provider's own remedy for a status ` +
        `number. This is the property, not the mechanism: any future fallback sentence that swallows ` +
        `the body fails here.\n  now : ${show(after)}\n  ${BASE_REF}: ${show(before)}`,
    );
    assert.ok(after.includes(String(r.status)), `B2: and the number is still on screen. Got ${show(after)}`);
    assert.ok(after.includes("output channel"), `B2: and the channel pointer. Got ${show(after)}`);
    assert.strictEqual(
      after,
      before,
      `B2: byte-identical to the branch point, which is the whole of what the fix claims`,
    );
  });
}

btest("B3 [HIGH, closed]: the property holds for every unclassified status on every arm", async () => {
  // The sweep B2 does for three real bodies, over the whole unclassified set,
  // with a reason the toast must carry through.
  const REASON = "provider-said-this-and-it-matters";
  let checked = 0;
  for (const arm of GEN_ARMS) {
    for (const status of UNCLASSED) {
      if (status < 400) continue; // fetch follows 3xx; nothing throws below 400
      const { now, old } = await drivePair(arm, `sweep-unclassed:${status}`, jsonStatus(status, JSON.stringify({ error: REASON })));
      assert.ok(!now.ok && !old.ok, `PRECONDITION: ${arm.name} ${status} threw on both trees`);
      assert.strictEqual(
        NOW.translateServiceReject(now.err),
        undefined,
        `B3: ${arm.name} ${status} must draw NO crafted sentence`,
      );
      const after = toastNow(now.err);
      assert.ok(after.includes(REASON), `B3: ${arm.name} ${status} lost the provider's reason. Got ${show(after)}`);
      assert.strictEqual(after, toastBase(old.err), `B3: ${arm.name} ${status} is not the ${BASE_REF} toast`);
      checked += 1;
    }
  }
  assert.ok(checked >= 24, `B3: PRECONDITION - the sweep must actually run. Checked ${checked}`);
  console.error("[B3] %d arm-status pairs restored to the branch-point toast", checked);
});

btest("B4 [closed]: the 5xx class is a RANGE now, so 504 and 520-524 are inside it", () => {
  const inClass = sentenceFor(503);
  assert.strictEqual(typeof inClass, "string", "PRECONDITION: 503 carries the class sentence");
  for (const status of [500, 501, 502, 503, 504, 507, 520, 521, 522, 524, 529, 598, 599]) {
    assert.strictEqual(
      sentenceFor(status),
      inClass,
      `B4: ${status} is a 5xx and "try again shortly" is its next action too. The first cut enumerated ` +
        `{500,502,503,529} and dropped a gateway timeout and every Cloudflare origin failure onto the ` +
        `path the HIGH was about.`,
    );
  }
  assert.strictEqual(sentenceFor(499), undefined, "B4: and the range does not leak below 500");
  assert.strictEqual(sentenceFor(600), undefined, "B4: nor above 599");
});

btest("B5 [closed]: the unclassified set is exactly the statuses with no next action to name", () => {
  // 404 and 418 no longer share a sentence, because neither has one.
  for (const status of [400, 402, 404, 408, 409, 413, 418, 422, 451]) {
    assert.strictEqual(
      sentenceFor(status),
      undefined,
      `B5: ${status} must fall through - the product has no remedy to name and the provider does`,
    );
  }
  assert.notStrictEqual(sentenceFor(401), undefined, "B5: PRECONDITION - a classed status still crafts");
});

btest("B6 [FINDING, deferred S58-16]: 429 offers one remedy for two causes", () => {
  const s = sentenceFor(429);
  assert.ok(s.includes("wait"), `PRECONDITION: the 429 sentence says wait. Got ${show(s)}`);
  assert.ok(
    !/quota|credit|billing|plan/i.test(s),
    "B6: OpenAI-shape providers return 429 with `insufficient_quota` when the account is out of " +
      "credit, and waiting never clears that. Deferred: the re-cut added the channel pointer, so the " +
      "body that says which cause it is is at least advertised now.",
  );
  assert.ok(s.includes("output channel"), "B6: and that mitigation is present");
});

btest("B7 [robustness]: a status that is not a plain integer crafts nothing and still toasts one line", () => {
  for (const status of [0, -1, 1.5, NaN, Infinity, -Infinity]) {
    assert.strictEqual(
      sentenceFor(status),
      undefined,
      `B7: ${status} must craft no sentence. NaN fails both comparisons and Infinity fails the upper ` +
        `bound - the range check is written to depend on that, so this row guards it.`,
    );
    const t = toastNow(new NOW.HttpStatusError("cloud", status, `Cloud ${status} Reason: {"error":"x"}`));
    for (const b of BREAKS) assert.ok(!t.includes(b), `B7: ${status} must stay one line`);
    assert.ok(t.startsWith("Column 80: "), `B7: ${status} keeps the house voice`);
  }
});

// ===========================================================================
// C - THE SENTENCES. Phase 6 shipped two that named settings which do not
//     exist; this pass checks the same way, against package.json.
// ===========================================================================

const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const CFG = PKG.contributes.configuration;
const CFG_BLOCKS = Array.isArray(CFG) ? CFG : [CFG];
const SETTINGS = Object.assign({}, ...CFG_BLOCKS.map((b) => b.properties));

btest("C1 [the next action exists]: every setting a sentence names is a real setting", () => {
  // Stronger than the first cut, which only checked that a settings PAGE with
  // that title exists. This reads the identifiers out of the sentences and
  // looks each one up.
  let named = 0;
  for (const transport of ["cloud", "anthropic", "ollama"]) {
    for (const status of CLASSED) {
      const s = sentenceOn(transport, status);
      for (const m of s.matchAll(/column80\.[A-Za-z0-9_.]+/g)) {
        assert.ok(
          Object.prototype.hasOwnProperty.call(SETTINGS, m[0]),
          `C1: ${transport} ${status} sends the user to ${m[0]}, which package.json does not declare. ` +
            `That is phase 6's defect, and this row is the check that caught it there.`,
        );
        named += 1;
      }
    }
  }
  assert.ok(named >= 1, "C1: PRECONDITION - at least one sentence must name a setting, or this bans nothing");
  console.error("[C1] %d setting references in the class sentences, all declared", named);
});

btest("C2 [closed]: the key sentence splits on the transport, and the local arm names no setting", () => {
  const local = sentenceOn("ollama", 401);
  const cloud = sentenceOn("cloud", 401);
  assert.notStrictEqual(local, cloud, "C2: the two arms must not share one sentence - the next action differs");
  assert.strictEqual(sentenceOn("ollama", 403), local, "C2: 403 splits the same way");
  assert.strictEqual(sentenceOn("anthropic", 403), cloud, "C2: and anthropic is on the cloud side");
  const desc = SETTINGS["column80.cloudApiKey"].description || SETTINGS["column80.cloudApiKey"].markdownDescription;
  assert.ok(/ignored by the local/i.test(desc), "PRECONDITION: package.json says the key setting is ignored by ollama");
  assert.ok(
    !/column80\./.test(local),
    `C2: the local variant must name NO setting - the product's only key setting is one package.json ` +
      `says that backend ignores.\n  local: ${show(local)}`,
  );
  assert.ok(cloud.includes("column80.cloudApiKey"), `C2: and the cloud variant names the one that works. Got ${show(cloud)}`);
  // The split is on the typed field, not on the message text: a body naming
  // ollama cannot move a cloud arm onto the local sentence.
  assert.strictEqual(
    sentenceOn("cloud", 401, "Cloud 401 ollama ollama ollama: {\"error\":\"ollama\"}"),
    cloud,
    "C2: and the split reads err.transport, not the message",
  );
});

btest("C3 [house voice]: every crafted sentence is one line, no jargon, no dash", () => {
  for (const transport of ["cloud", "anthropic", "ollama"]) {
    for (const status of CLASSED) {
      const s = sentenceOn(transport, status);
      const at = `${transport} ${status}`;
      for (const b of BREAKS) assert.ok(!s.includes(b), `C3: ${at} must be ONE line`);
      assert.ok(s.startsWith("Column 80: "), `C3: ${at} must open in the house voice`);
      assert.ok(s.endsWith("."), `C3: ${at} must end in a full stop. Got ${show(s)}`);
      assert.ok(!s.includes("Error:"), `C3: ${at} must not leak the Error token`);
      assert.ok(!/[{}]|":/.test(s), `C3: ${at} must carry no JSON`);
      assert.ok(!s.includes(String.fromCharCode(0x2014)), `C3: ${at} must not use an em dash`);
      assert.ok(s.length < 240, `C3: ${at} must fit a notification. ${s.length} chars`);
    }
  }
});

btest("C4 [closed]: every crafted sentence now points at the channel", () => {
  const missing = [];
  for (const transport of ["cloud", "anthropic", "ollama"]) {
    for (const status of CLASSED) {
      if (!sentenceOn(transport, status).includes("output channel")) missing.push(`${transport} ${status}`);
    }
  }
  assert.deepStrictEqual(
    missing,
    [],
    "C4: the first cut left the auth and rate-limit sentences without the pointer, which is where the " +
      "body says WHICH permission and WHICH limit. All four classes carry it now.",
  );
});

btest("C5 [FINDING, deferred S58-15]: a crafted sentence still discards the gesture that failed", async () => {
  const { now, old } = await drivePair(ARMS[0], "wide:429", jsonStatus(429, JSON.stringify({ error: "x" })));
  assert.ok(!now.ok && !old.ok, "PRECONDITION: both threw");
  const before = BASE.generationFailedToast(old.err, "test generation");
  const after = NOW.generationFailedToast(now.err, "test generation");
  assert.ok(before.includes("test generation"), `PRECONDITION: at ${BASE_REF} the toast named the gesture. Got ${show(before)}`);
  assert.ok(
    !after.includes("test generation"),
    "C5: the crafted sentence ignores the `gesture` argument, so the same words appear whether function " +
      `generation or test generation failed. Deferred with the table.\n  after: ${show(after)}`,
  );
  assert.strictEqual(after, NOW.generationFailedToast(now.err, "function generation"), "C5: byte-identical across gestures");
  // Narrowed by the HIGH's fix: an unclassified status falls to the catch-all,
  // which does name the gesture. The loss is confined to the classed statuses.
  const four04 = new NOW.HttpStatusError("ollama", 404, 'Ollama 404 Not Found: {"error":"model not found"}');
  assert.ok(
    NOW.generationFailedToast(four04, "test generation").includes("test generation"),
    "C5: and an unclassified status names the gesture again, so the fix shrank this too",
  );
});

btest("C6 [FINDING, deferred S58-14]: the 5xx toast still does not say which arm failed", async () => {
  const afters = new Set();
  for (const arm of GEN_ARMS) {
    const { now, old } = await drivePair(arm, "wide:503", jsonStatus(503, JSON.stringify({ error: "x" })));
    assert.ok(!now.ok && !old.ok, `PRECONDITION: ${arm.name} threw`);
    assert.ok(/Ollama|Anthropic|Cloud/.test(toastBase(old.err)), `PRECONDITION: ${arm.name}'s old toast named the arm`);
    assert.ok(typeof now.err.transport === "string" && now.err.transport !== "", `PRECONDITION: ${arm.name} carries a transport`);
    afters.add(toastNow(now.err));
  }
  assert.strictEqual(
    afters.size,
    1,
    "C6: three arms, one 5xx sentence. Deferred: fn-gen runs one backend at a time and the user chose " +
      "it in a setting. Recorded because the 401 class DID need the split, so the field is now read on " +
      "one class and not the others.",
  );
  assert.notStrictEqual(
    sentenceOn("ollama", 401),
    sentenceOn("cloud", 401),
    "C6: and that is the contrast - where the next action really differed, the transport is read",
  );
});

// ===========================================================================
// D - FORGERY AND ORDERING.
// ===========================================================================

btest("D1 [forgery]: a 200 whose reason phrase AND body both shout 429 draws no class sentence", async () => {
  const liar = (_req, res) => {
    res.writeHead(200, "Too Many Requests", { "Content-Type": "application/json" });
    res.end(`${JSON.stringify({ error: { code: 429, message: "Service Unavailable 503 rate_limit_error" } })}\n`);
  };
  let banRan = 0;
  for (const arm of GEN_ARMS) {
    const { now } = await drivePair(arm, "forge200", liar);
    const err = now.ok ? undefined : now.err;
    if (err !== undefined) banRan += 1;
    console.error("[D1] %s -> %s", arm.name, now.ok ? "resolved" : show(String(err)));
    // Non-vacuous both ways: either the arm resolved (no error to classify) or
    // it threw something that is NOT the typed class.
    if (err !== undefined) {
      assert.ok(
        !(err instanceof NOW.HttpStatusError),
        `D1 [${arm.name}]: a 200 must never produce the typed status error. Got ${show(String(err))}`,
      );
      const t = NOW.translateServiceReject(err);
      assert.notStrictEqual(t, sentenceFor(429), `D1 [${arm.name}]: and never the 429 class sentence`);
      assert.notStrictEqual(t, sentenceFor(503), `D1 [${arm.name}]: nor the 5xx one`);
    }
  }
  assert.ok(
    banRan >= 1,
    "D1: PRECONDITION - a ban-list row passes loudest when there is nothing to ban. At least one arm " +
      "must actually have thrown on the lying 200, or the whole row is three skipped branches.",
  );
});

btest("D2 [forgery]: a plain Error wearing a status field is not the identity", () => {
  const forged = Object.assign(new Error('Ollama 429 Too Many Requests: {"error":"x"}'), { status: 429, transport: "ollama" });
  assert.strictEqual(
    NOW.translateServiceReject(forged),
    undefined,
    "D2: the pass is instanceof, not duck typing - a field a caught object happens to carry must not buy a sentence",
  );
  assert.ok(
    NOW.generationFailedToast(forged, GESTURE).includes("429"),
    "D2: it falls to the catch-all, which still shows the message",
  );
});

btest("D3 [ordering]: the status pass runs ahead of the anchored service rows", () => {
  // Every real throw's message begins with a PAYLOAD_CARRIERS head, so no
  // service row can legitimately match one. This row states what happens if a
  // future throw's head changes: the status wins, unconditionally.
  const markers = [...baseFnGenSource.matchAll(/markers:\s*\[([^\]]*)\]/g)]
    .flatMap((m) => [...m[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((x) => JSON.parse(`"${x[1]}"`)));
  assert.ok(markers.length >= 6, `PRECONDITION: markers extracted from ${BASE_REF}'s fnGen. Got ${markers.length}`);
  let shadowed = 0;
  for (const marker of markers) {
    const plainOne = BASE.translateServiceReject(new Error(`${marker} and then some`));
    if (plainOne === undefined) continue;
    const typed = NOW.translateServiceReject(new NOW.HttpStatusError("ollama", 503, `${marker} and then some`));
    assert.strictEqual(
      typed,
      sentenceFor(503),
      `D3: a typed 503 whose message starts with ${show(marker)} must take the STATUS sentence`,
    );
    shadowed += 1;
  }
  assert.ok(shadowed >= 3, `D3: PRECONDITION - at least three service markers were actually exercised. Got ${shadowed}`);
});

btest("D4 [ordering]: phase 6 wins over a real status, and a real status wins over nothing", () => {
  const cc = new NOW.ClaudeCodeError("exit", "cli said 429 Too Many Requests");
  assert.notStrictEqual(NOW.translateServiceReject(cc), undefined, "PRECONDITION: phase 6 still fires");
  assert.notStrictEqual(NOW.translateServiceReject(cc), sentenceFor(429), "D4: and it is not the HTTP sentence");
  const both = Object.assign(new NOW.HttpStatusError("ollama", 503, 'Ollama 503 x: {"error":"y"}'), {
    name: "ClaudeCodeError",
    reason: "exit",
  });
  assert.notStrictEqual(
    NOW.translateServiceReject(both),
    sentenceFor(503),
    "D4: a typed status wearing phase 6's name and reason takes phase 6's sentence. Unreachable from " +
      "any throw site (the class does not set `name`), but it is what the `??` order means: a NAME " +
      "beats a real type.",
  );
});

// ===========================================================================
// E - THE NARROWING CLAIM, over the whole existing translation surface.
// ===========================================================================

btest("E1 [narrowing]: REGRESSION - nothing that is not an HttpStatusError changed, over a generated corpus", () => {
  // Generated from the BASE tree's own source, so nothing is written down here
  // and nothing can be written down wrong.
  const literals = [...baseFnGenSource.matchAll(/"((?:[^"\\\n]|\\.){6,160})"/g)]
    .map((m) => { try { return JSON.parse(`"${m[1]}"`); } catch { return undefined; } })
    .filter((s) => typeof s === "string" && s.includes(" "));
  const uniq = [...new Set(literals)];
  assert.ok(uniq.length >= 100, `E1: PRECONDITION - a wide corpus. Got ${uniq.length}`);
  // The reason keys, out of the BASE tree's own sentence map.
  const mapStart = baseFnGenSource.indexOf("const CLAUDE_CODE_SENTENCES");
  const mapBody = baseFnGenSource.slice(mapStart, baseFnGenSource.indexOf("\n};", mapStart));
  const reasons = [...mapBody.matchAll(/^\s{2}"?([\w-]+)"?:\s*\(/gm)].map((m) => m[1]);
  assert.ok(reasons.length >= 8, `E1: PRECONDITION - the phase 6 reasons were found. Got ${reasons.length}`);
  const cases = [];
  for (const s of uniq) {
    cases.push(new Error(s), new Error(`${s} and then some server text`), new Error(`head noise ${s}`));
  }
  for (const r of [...new Set(reasons)].slice(0, 40)) {
    cases.push(new NOW.ClaudeCodeError(r, `claude code said something about ${r}`));
  }
  cases.push(new Error(""), new Error("\n"), new TypeError("Cannot convert object to primitive value"));
  const nonErrors = [undefined, null, 0, 42, "", "a bare string", { message: "not an Error" }, [1, 2]];

  let translated = 0;
  for (const err of cases) {
    assert.ok(!(err instanceof NOW.HttpStatusError), "E1: the corpus must contain no typed status errors");
    // A ClaudeCodeError from the NOW bundle is not the BASE bundle's class, but
    // phase 6 identifies by `name`, which crosses bundles - so both trees see it.
    const a = NOW.translateServiceReject(err);
    const b = BASE.translateServiceReject(err);
    assert.strictEqual(a, b, `E1: translateServiceReject moved for ${show(err.message)}\n  now : ${show(a)}\n  ${BASE_REF}: ${show(b)}`);
    assert.strictEqual(
      NOW.generationFailedToast(err, GESTURE),
      BASE.generationFailedToast(err, GESTURE),
      `E1: generationFailedToast moved for ${show(err.message)}`,
    );
    if (a !== undefined) translated += 1;
  }
  for (const v of nonErrors) {
    assert.strictEqual(NOW.translateServiceReject(v), BASE.translateServiceReject(v), `E1: non-Error ${show(String(v))} moved`);
    assert.strictEqual(NOW.generationFailedToast(v, GESTURE), BASE.generationFailedToast(v, GESTURE), `E1: non-Error toast moved`);
  }
  assert.ok(
    translated >= 10,
    `E1: PRECONDITION - the corpus must actually REACH the translation table, or every row above is ` +
      `two undefineds compared. Sentences drawn: ${translated} of ${cases.length}`,
  );
  console.error("[E1] corpus %d errors + %d non-errors, %d drew a sentence", cases.length, nonErrors.length, translated);
});

// ===========================================================================
// F - THE PULL ASYMMETRY (amendment A3), judged rather than accepted.
// ===========================================================================

btest("F1 [pull]: REGRESSION - the pull throw is byte-identical and the pull channel lines survive", async () => {
  const body = JSON.stringify({ error: "server busy" });
  const { now, old } = await drivePair(ARMS[1], "pull503", jsonStatus(503, body));
  assert.ok(!now.ok && !old.ok, "PRECONDITION: both trees threw on the pull");
  assert.deepStrictEqual(facets(now.err), facets(old.err), "F1: nothing the pull path reads moved");
  assert.deepStrictEqual(now.lines, old.lines, `F1: the pull's own channel lines moved\n  now : ${show(JSON.stringify(now.lines))}`);
  assert.ok(now.lines.some((l) => l.includes("ollama-pull") && l.includes("503")), "F1: PRECONDITION - the [http-body] line fired");
});

// F2 AND F3 ARE INVERTED, session-v59 phase 1. Both were written as FINDING
// rows: they asserted that `firstRun.ts` and `tightenDocComment.ts` could NOT
// see the translator, and each held while that was the shipped truth. Phase 1
// lifted the table into `src/vscode/failureToast.ts` and wired both surfaces to
// it, so the two rows now pin the closure instead of the defect. The old
// assertions are kept in the messages below, because a row that pins a fix
// should say what the fix was for.

btest("F2 [CLOSED, was FINDING ruled A3]: the pull path renders the sentence its own throw qualifies for", async () => {
  const body = JSON.stringify({ error: "server busy" });
  const { now } = await drivePair(ARMS[1], "pull503", jsonStatus(503, body));
  assert.ok(now.err instanceof NOW.HttpStatusError, "PRECONDITION: pullModel throws the typed class too");
  assert.strictEqual(
    NOW.translateServiceReject(now.err),
    sentenceFor(503),
    "PRECONDITION: a sentence exists for it",
  );
  const firstRunSource = fs.readFileSync(path.join(ROOT, "src/vscode/firstRun.ts"), "utf8");
  assert.ok(
    /translateServiceReject/.test(firstRunSource),
    "F2: firstRun.ts reaches the translator now. It did not when this row was written, and the " +
      "residue A3 accepted was that the class was thrown at a fourth site purely to keep the message " +
      "identical while the download toast put the provider's JSON on screen.",
  );
  assert.ok(
    !sentenceFor(503).includes('{"error"'),
    `F2: and what the download user reads carries no JSON. Got ${show(sentenceFor(503))}`,
  );
});

btest("F3 [CLOSED, was FINDING recorded S58-7]: the fourth model surface stops stating a false cause", () => {
  const tighten = fs.readFileSync(path.join(ROOT, "src/vscode/tightenDocComment.ts"), "utf8");
  assert.ok(
    tighten.includes("the model could not be reached, so no type names were offered"),
    "PRECONDITION: the unclassified branch keeps the gesture's own sentence - no class, no craft",
  );
  assert.ok(
    /translateServiceReject/.test(tighten),
    "F3: the tighten gesture used to catch EVERY transport failure in one place and say the model " +
      "could not be reached. A 401 was reached and refused the key; a 429 was reached and throttled. " +
      "That surface can see the class sentences now.",
  );
});

// ===========================================================================
// H - THE IDENTITY IS BUNDLE-LOCAL. instanceof is not a name.
// ===========================================================================

btest("H1 [property]: instanceof does not cross a bundle boundary, and production has one bundle", () => {
  const twin = new TWIN.HttpStatusError("ollama", 503, 'Ollama 503 x: {"error":"y"}');
  assert.ok(twin instanceof Error, "PRECONDITION: the twin's error is still an Error");
  assert.ok(twin instanceof TWIN.HttpStatusError, "PRECONDITION: and its own class");
  assert.ok(!(twin instanceof NOW.HttpStatusError), "PRECONDITION: two bundles, two classes");
  assert.strictEqual(
    NOW.translateServiceReject(twin),
    undefined,
    "H1: a typed status error built in a second bundle of the SAME source draws no sentence. Phase 6 " +
      "identifies by `name`, which survives this; phase 7's instanceof does not. Harmless today - " +
      "esbuild.mjs ships one extension bundle - and it is the reason the leaf must stay one copy.",
  );
});

// ===========================================================================
// X - ADJACENT. Found while driving phase 7's forgery row; not phase 7's code.
// ===========================================================================

// RE-CUT, session-v59 phase 2. This row was a FINDING: it pinned the defect it
// had just discovered, so it would stay green until someone fixed it. S58-9 was
// taken up and the fix landed, so the row is now a GUARD on the closed hole,
// asserting the opposite of what it used to.
//
// The drive is unchanged, and it keeps its own red-before-green: `drivePair`
// runs the SAME socket against the working tree and against a worktree of the
// branch point, so every row below shows the old behaviour beside the new one.
// A fix nobody can see failing is a fix that comes back.
btest("X1 [WAS A FINDING, S58-9]: the ollama in-stream error path renders the provider's reason", async () => {
  const src = fs.readFileSync(path.join(ROOT, "src/core/ollama.ts"), "utf8");
  assert.ok(
    !src.includes("`Ollama error: ${boundBody(String(evt.error))}`"),
    "X1: the String() coercion is gone from the ollama in-stream site",
  );
  const object = (_req, res) => {
    res.writeHead(200, { "Content-Type": "application/x-ndjson" });
    res.end(`${JSON.stringify({ error: { type: "rate_limit", message: "slow down" } })}\n`);
  };
  const { now, old } = await drivePair(ARMS[0], "instream-object", object);
  assert.ok(!now.ok, "PRECONDITION: it threw");
  assert.ok(
    old.err.message.includes("[object Object]"),
    `X1: PRECONDITION - the branch point really did render the placeholder. Without this the row ` +
      `below cannot tell a fix from a test that never had anything to catch.\n  got: ${show(old.err.message)}`,
  );
  assert.ok(
    now.err.message.includes("slow down"),
    `X1: an object envelope must carry the provider's own reason. It used to render [object Object] ` +
      `and throw the reason away, which is the failure roadmap item 67 closed on the other two arms ` +
      `first.\n  got: ${show(now.err.message)}`,
  );

  // Worse: `String()` on the shape the providerReason doc names could THROW,
  // from inside the reader, carrying no marker the translation table can see.
  const hostileToString = (_req, res) => {
    res.writeHead(200, { "Content-Type": "application/x-ndjson" });
    res.end(`${JSON.stringify({ error: { toString: 1, message: "the real reason" } })}\n`);
  };
  const bad = await drivePair(ARMS[0], "instream-tostring", hostileToString);
  assert.ok(!bad.now.ok, "X1: PRECONDITION - it threw");
  assert.ok(
    /Cannot convert object to primitive value/.test(bad.old.err.message),
    `X1: PRECONDITION - the branch point really did raise the TypeError out of the reader.\n  got: ` +
      `${show(bad.old.err.message)}`,
  );
  assert.ok(
    !/Cannot convert object to primitive value/.test(bad.now.err.message),
    `X1: plain JSON from a server used to put a raw TypeError on the gesture's catch-all, with no ` +
      `Ollama marker on it at all.\n  got: ${show(bad.now.err.message)}`,
  );
  assert.ok(
    !toastNow(bad.now.err).includes("Cannot convert object to primitive value"),
    `X1: and it used to reach the screen. Got ${show(toastNow(bad.now.err))}`,
  );
});

btest("H2 [the production build has one copy of the leaf]", () => {
  const build = fs.readFileSync(path.join(ROOT, "esbuild.mjs"), "utf8");
  assert.ok(build.includes(`entryPoints: ["src/vscode/extension.ts"]`), "H2: one extension entry point");
  assert.ok(!build.includes("splitting"), "H2: no code splitting, so the leaf is bundled once");
  // The second bundle esbuild.mjs builds (test-vscode/.build/product.js) is a
  // separate module graph. It must not export a surface that would hand a typed
  // status error across to the extension bundle.
  const surface = build.slice(build.indexOf("productSurface"));
  for (const name of ["generateInstruct", "makeCloudInstruct", "makeAnthropicInstruct", "translateServiceReject"]) {
    assert.ok(
      !surface.includes(name),
      `H2: the integration-tier bundle exports ${name}, which would put a second copy of the leaf on a ` +
        `path that can hand an error to the extension bundle, where instanceof would silently fail`,
    );
  }
});
