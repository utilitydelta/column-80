// Blind oracle, session-v56 phase 2: "disabled means inert, everywhere"
// (roadmap item 58). Written BEFORE the fix, against the phase 2 contract.
//
// WHAT THIS FILE PINS. A disabled fn-gen service - whatever the tier's reason -
// must make every transport-using gesture refuse instead of dialling:
//   contract 1  every gesture refuses on a disabled tier
//   contract 2  the refusal names the tier's recorded reason, not a generic one
//   contract 3  a refused gesture issues NO network request (the load-bearing
//               row: a spy on the HTTP layer records ZERO calls)
//   contract 4  an enabled service behaves exactly as today
//
// REAL TIERS ONLY. No tier object is hand-built here. Every row drives the
// product's own construction (`buildFnGenService`, reached through
// `registerFnGen`'s `buildService` seam so the registered gestures and the
// captured tier come from the SAME build):
//   - remote host, model list empty  -> the phase-1 disabled remote tier
//   - below-12gb hardware probe      -> the disabled local tier
//   - remote host carrying the model -> the enabled remote tier
// The hardware probe and the model-list call are injected host seams
// (`probeOpts`, `FnGenBackendDeps.listModels` - the same seams the v56 phase-1
// oracle used), so no packet leaves and no nvidia-smi spawns. Every host is
// under `.invalid` (RFC 2606) as a second fence.
//
// THE NETWORK SPY. `globalThis.fetch` (undici, the path the FIM watchdog oracle
// pinned the product's transports to) plus `http.request/get` and
// `https.request/get` are wrapped to RECORD. The enabled row doubles as the
// rig's own witness: it must see at least one recorded dial, so a disabled-row
// zero can never be the spy missing the seam while the product dials for real.
//
// BINDINGS THE CONTRACT LEAVES OPEN, resolved by precedent and REPORTED:
//   * USER SURFACE. Contract 2 says the refusal "names the tier's reason" but
//     not which toast. Bound to: some user-facing message shown AT INVOKE TIME
//     (info/warn/error) CONTAINS the tier's recorded `message` string - the
//     field the v55/v56 oracles pinned as the disable reason. A paraphrase or
//     an activation-time-only toast reads red.
//   * REGISTRATION. The contract says the gesture "refuses", which this file
//     reads as: the command is still registered and invokable on a disabled
//     tier. A fix that unregisters instead reads red with "not registered".
//   * PRE-FLIGHT. Contract 3 says "no network request". The repair gesture's
//     server pre-flight (`FnGenDeps.listModels`) is a network request in the
//     real product, so it is injected as a recorder and counted.
//
// EXPECTED TODAY (pre-fix): the tighten disabled rows RED (the gesture dials a
// live transport on a disabled tier), the enabled row GREEN, the other-gesture
// guard rows GREEN (believed gated fail-closed).
//
// Run: node --test test/blind-v56-p2-disabled-inert.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const fs = require("node:fs");
const http = require("node:http");
const https = require("node:https");
const esbuild = require("esbuild");

// ---------------------------------------------------------------------------
// The vscode stub. Copied from the v55 phase-1 blind oracle (the precedent
// harness for driving REGISTERED gestures), plus `showQuickPick` so the real
// tighten review's cancel path has a host answer (undefined = cancel).
// ---------------------------------------------------------------------------

// A REAL workspace directory on disk, so a gesture that inspects the project
// (TDD run walks up for a package.json) refuses for product reasons, never
// because the rig's workspace was imaginary.
const WROOT = path.join(__dirname, ".blind-v56-p2-workspace");
fs.mkdirSync(path.join(WROOT, "src"), { recursive: true });
fs.writeFileSync(
  path.join(WROOT, "package.json"),
  '{"name":"w","version":"0.0.0","scripts":{"test":"vitest run"},"devDependencies":{"vitest":"^1.0.0"}}\n',
);

const STUB = path.join(__dirname, ".blind-v56-p2-stub.cjs");
fs.writeFileSync(
  STUB,
  `
const WROOT = ${JSON.stringify(WROOT)};
const state = {
  config: {}, messages: [], commands: {}, activeTextEditor: undefined,
  snippetInserts: [], appliedEdits: [], executeCalls: [], terminals: [],
  textDocuments: [], warnResponses: [],
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
    get workspaceFolders() { return [{ uri: Uri.file(WROOT), name: "w", index: 0 }]; },
    getWorkspaceFolder: () => ({ uri: Uri.file(WROOT), name: "w", index: 0 }),
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
    tabGroups: { all: [], onDidChangeTabs: () => ({ dispose() {} }), close: async () => {} },
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

const entry = path.join(__dirname, ".blind-v56-p2.entry.ts");
const outfile = path.join(__dirname, ".blind-v56-p2.bundle.cjs");
let bundleErr;
let registerFnGen;
let buildFnGenService;
let ContextBlockStore;
let __state;
let Position;
let Range;
try {
  fs.writeFileSync(
    entry,
    `export { registerFnGen, buildFnGenService } from "../src/vscode/fnGen";
export { ContextBlockStore } from "../src/core/contextBlocks";
export { __state, Position, Range } from "vscode";\n`,
  );
  esbuild.buildSync({ entryPoints: [entry], bundle: true, outfile, format: "cjs", platform: "node", alias: { vscode: STUB } });
  ({ registerFnGen, buildFnGenService, ContextBlockStore, __state, Position, Range } = require(outfile));
} catch (e) {
  bundleErr = e;
}

test.after(() => {
  for (const f of [entry, outfile, STUB]) fs.rmSync(f, { force: true });
  fs.rmSync(WROOT, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// The network spy: every way the bundled product can reach a server from this
// process, wrapped to RECORD. fetch answers with an Ollama-shaped streaming
// reply so an enabled dial parses instead of crashing; http/https record and
// refuse (nothing in the product is expected to use them - a recorded entry
// there is still a dial).
// ---------------------------------------------------------------------------

const netCalls = [];
const enc = new TextEncoder();

const realFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  netCalls.push({ via: "fetch", url: String(url) });
  const payload = enc.encode(JSON.stringify({ response: "shard mem cache\n", done: true, done_reason: "stop" }) + "\n");
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    headers: { get: () => null },
    body: new ReadableStream({
      start(c) {
        c.enqueue(payload);
        c.close();
      },
    }),
    json: async () => ({ response: "shard mem cache\n", done: true }),
    text: async () => JSON.stringify({ response: "shard mem cache\n", done: true }),
    arrayBuffer: async () => payload.buffer,
  };
};

const realHttpRequest = http.request;
const realHttpGet = http.get;
const realHttpsRequest = https.request;
const realHttpsGet = https.get;
const recordAndRefuse = (via) => (...args) => {
  netCalls.push({ via, target: String(args[0] && (args[0].href || args[0].hostname || args[0])) });
  throw new Error("blind-v56-p2 network spy: this process must not dial");
};
http.request = recordAndRefuse("http.request");
http.get = recordAndRefuse("http.get");
https.request = recordAndRefuse("https.request");
https.get = recordAndRefuse("https.get");

test.after(() => {
  globalThis.fetch = realFetch;
  http.request = realHttpRequest;
  http.get = realHttpGet;
  https.request = realHttpsRequest;
  https.get = realHttpsGet;
});

// ---------------------------------------------------------------------------
// Fixture: a dictated over-80-column comment above a real function, the shape
// the tighten command exists for. The same document serves every gesture; the
// symbol hierarchy makes the function resolvable so nothing refuses for
// fixture reasons before the tier gate has had its say.
// ---------------------------------------------------------------------------

const REMOTE_HOST = "http://ml-box.invalid:11434";
const MODEL = "qwen3-coder:480b";
const MB = 1048576;

const SRC =
  "// this walker keeps a shard mem cache for each of the client sets and drops every entry it can prove is stale\n" +
  "export function walk() {\n" +
  "  return 1;\n" +
  "}\n" +
  "\n";
const FILE = "file://" + path.join(WROOT, "src", "walk.ts");
fs.writeFileSync(path.join(WROOT, "src", "walk.ts"), SRC);

function makeDoc() {
  const src = SRC;
  const lineStarts = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === "\n") lineStarts.push(i + 1);
  const offsetAt = (pos) => Math.min((lineStarts[pos.line] ?? src.length) + pos.character, src.length);
  const fsPath = FILE.replace(/^file:\/\//, "");
  return {
    languageId: "typescript",
    version: 1,
    isDirty: false,
    isClosed: false,
    lineCount: src.split("\n").length,
    fileName: fsPath,
    uri: { fsPath, path: fsPath, scheme: "file", toString: () => FILE, with() { return this; } },
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

const symbolsFor = () => [
  { name: "walk", detail: "", kind: 11, range: new Range(1, 0, 3, 1), selectionRange: new Range(1, 16, 1, 20), children: [] },
];

const IN_COMMENT = [0, 20];
const IN_FUNCTION = [2, 4];

function selectionAt(a) {
  const p = new Position(a[0], a[1]);
  const sel = new Range(p, p);
  sel.active = p;
  sel.anchor = p;
  return sel;
}

// ---------------------------------------------------------------------------
// Scenarios: three REAL tiers out of the product's own construction.
// ---------------------------------------------------------------------------

const SCENARIOS = {
  // Phase-1 disabled remote tier: reachable host, zero models.
  "remote-empty": {
    config: { apiBase: REMOTE_HOST, fnGenModel: MODEL, repairEnabled: true },
    probe: { stdout: "16303\n", ramMB: 61826 },
    models: [],
    wantEnabled: false,
  },
  // Disabled local tier: the below-12gb hardware probe.
  "below-12gb": {
    config: { fnGenModel: MODEL, repairEnabled: true },
    probe: { stdout: "8192\n", ramMB: 61826 },
    models: [MODEL],
    wantEnabled: false,
  },
  // Enabled remote tier: the host carries the configured model.
  "remote-ready": {
    config: { apiBase: REMOTE_HOST, fnGenModel: MODEL, repairEnabled: true },
    probe: { stdout: "16303\n", ramMB: 61826 },
    models: [MODEL],
    wantEnabled: true,
  },
};

const TIGHTEN = "column80.tightenDocComment";
const GEN = "column80.generateFunction";
const REPAIR = "column80.repairFunction";
const TDD_GEN = "column80.generateTests";
const TDD_RUN = "column80.runTddTests";

const waitFor = async (predicate, tries = 400) => {
  for (let i = 0; i < tries; i++) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, 5));
  }
  return false;
};

/** Build the REAL service for a scenario (no registration): the tier witness. */
async function buildTier(name) {
  const sc = SCENARIOS[name];
  const lines = [];
  const output = { lines, appendLine: (l) => lines.push(l), append() {}, show() {}, clear() {}, dispose() {} };
  __state.config = { ...sc.config };
  const probeOpts = {
    runCommand: async () => ({ stdout: sc.probe.stdout, exitCode: 0 }),
    totalMemBytes: () => sc.probe.ramMB * MB,
    platformInfo: () => ({ platform: "linux", arch: "x64" }),
  };
  return buildFnGenService(output, () => {}, probeOpts, { listModels: async () => sc.models });
}

/** Register the product's gestures against a scenario's REAL tier, invoke one
 *  registered command, and record everything a user or a server would see. */
async function drive({ scenario, command, cursor }) {
  const sc = SCENARIOS[scenario];
  assert.ok(sc, `harness: unknown scenario ${scenario}`);

  __state.config = { ...sc.config };
  __state.messages = [];
  __state.commands = {};
  __state.executeCalls = [];
  __state.appliedEdits = [];
  __state.snippetInserts = [];
  __state.terminals = [];
  __state.warnResponses = [];
  const doc = makeDoc();
  __state.textDocuments = [doc];
  __state.symbols = symbolsFor();
  __state.symbolsSet = true;

  const lines = [];
  const output = { lines, appendLine: (l) => lines.push(l), append() {}, show() {}, clear() {}, dispose() {} };
  const probeOpts = {
    runCommand: async () => ({ stdout: sc.probe.stdout, exitCode: 0 }),
    totalMemBytes: () => sc.probe.ramMB * MB,
    platformInfo: () => ({ platform: "linux", arch: "x64" }),
  };
  const preflightCalls = [];
  let built;
  const context = { subscriptions: [], globalStorageUri: { fsPath: path.join(WROOT, ".storage") } };

  registerFnGen(context, output, new ContextBlockStore(() => {}), {
    // The REAL construction, with only host seams injected: the product's own
    // buildFnGenService decides the tier. Never a hand-built tier object.
    buildService: async (out, log) => {
      built = await buildFnGenService(out, log, probeOpts, { listModels: async () => sc.models });
      return built;
    },
    // Repair's server pre-flight, injected as a recorder: in the real product
    // this call IS a network request, so contract 3 counts it.
    listModels: async (...args) => {
      preflightCalls.push(args);
      return sc.models;
    },
    ollamaCheck: async () => ({ stdout: "ollama version 0.0.0", exitCode: 0 }),
  });

  const registered = await waitFor(() => typeof __state.commands[command] === "function" && built !== undefined);
  assert.ok(
    registered,
    `${scenario}: ${command} never registered (or the service never built). ` +
      `A disabled service whose gestures cannot even be invoked cannot refuse with a reason (contract 2); ` +
      `commands seen: ${JSON.stringify(Object.keys(__state.commands))}`,
  );

  __state.activeTextEditor = {
    document: doc,
    viewColumn: 1,
    options: { tabSize: 4, insertSpaces: true },
    selection: selectionAt(cursor),
    insertSnippet: async (snippet, range) => { __state.snippetInserts.push({ value: snippet.value, range }); return true; },
    revealRange: () => {},
    edit: async () => true,
  };

  // Everything from here on is what INVOKING the gesture did.
  __state.messages = [];
  const netBefore = netCalls.length;
  const preflightBefore = preflightCalls.length;

  await __state.commands[command]();
  await new Promise((r) => setTimeout(r, 40));

  const dials = netCalls.slice(netBefore);
  const preflights = preflightCalls.slice(preflightBefore);
  const messages = __state.messages.map((m) => m.message);

  for (const d of context.subscriptions) {
    try { d.dispose?.(); } catch { /* teardown only */ }
  }
  try { built.service.dispose(); } catch { /* teardown only */ }

  return { tier: built.tier, dials, preflights, messages, lines, edits: __state.appliedEdits };
}

const gtest = (name, fn) =>
  test(name, async () => {
    if (bundleErr) assert.fail(`harness bundle failed to build: ${bundleErr.stack || bundleErr.message}`);
    return fn();
  });

// ===========================================================================
// Harness guards. If either is red, every verdict below is suspect.
// ===========================================================================

test("harness guard: the fnGen surface bundles headless against the vscode stub", () => {
  if (bundleErr) assert.fail(`bundle failed: ${bundleErr.stack || bundleErr.message}`);
});

gtest("harness guard: the product's own construction yields the three real tiers this file drives", async () => {
  const empty = await buildTier("remote-empty");
  assert.strictEqual(empty.tier.fnGenEnabled, false, "remote host with zero models must be a DISABLED tier (phase 1)");
  assert.ok(typeof empty.tier.message === "string" && empty.tier.message.trim() !== "", "a disabled tier records its reason");
  empty.service.dispose();

  const low = await buildTier("below-12gb");
  assert.strictEqual(low.tier.fnGenEnabled, false, "an 8GB probe must be a DISABLED tier");
  assert.ok(typeof low.tier.message === "string" && low.tier.message.trim() !== "", "a disabled tier records its reason");
  low.service.dispose();

  const ready = await buildTier("remote-ready");
  assert.strictEqual(ready.tier.fnGenEnabled, true, "the host carrying the model must be an ENABLED tier");
  ready.service.dispose();

  assert.notStrictEqual(empty.tier.message, low.tier.message, "two different causes record two different reasons, or contract 2 is untestable");
});

// ===========================================================================
// Contract 4 first: the ENABLED row. This row is ALSO the rig's witness that
// the fixture really reaches the transport - a zero on the disabled rows means
// nothing unless this row proves the pipeline dials when the tier allows it.
// ===========================================================================

gtest("contract 4 [tighten x enabled remote]: the gesture proceeds past the gate - the spy records a dial (or a non-tier refusal, never a disabled story)", async () => {
  const r = await drive({ scenario: "remote-ready", command: TIGHTEN, cursor: IN_COMMENT });
  assert.ok(
    !r.messages.some((m) => /disabled/i.test(m)),
    `an enabled tier must never surface a disabled story: ${JSON.stringify(r.messages)}`,
  );
  if (r.dials.length === 0) {
    // No dial recorded. If the product then complained the server was down, it
    // dialled somewhere the spy cannot see - the disabled rows' zeros would be
    // void, so this fails LOUDLY as a missed seam rather than passing.
    assert.ok(
      !r.messages.some((m) => /unreachable|could not be reached|not running/i.test(m)),
      `the spy missed the HTTP seam: the product reports the server unreachable but the spy recorded no dial. ` +
        `Every disabled-row zero below is void. Messages: ${JSON.stringify(r.messages)}`,
    );
    assert.ok(
      r.messages.length > 0 || r.edits.length > 0,
      `enabled tier, no dial, no user surface, no edit: the gesture went nowhere the rig can see. ` +
        `Channel: ${JSON.stringify(r.lines)}`,
    );
  } else {
    assert.ok(r.dials.length >= 1, "the enabled gesture dials as before");
  }
});

// ===========================================================================
// Contracts 1-3 on the known offender: Tighten Doc Comment, on BOTH real
// disabled tiers. The no-network row is the load-bearing one.
// ===========================================================================

for (const scenario of ["remote-empty", "below-12gb"]) {
  gtest(`contract 3 [tighten x ${scenario}]: a disabled tier means ZERO network calls from the gesture`, async () => {
    const r = await drive({ scenario, command: TIGHTEN, cursor: IN_COMMENT });
    assert.strictEqual(r.tier.fnGenEnabled, false, `harness: ${scenario} must be a disabled tier`);
    assert.deepStrictEqual(
      r.dials,
      [],
      `contract 3: "No network request is issued by a refused gesture. Refusal happens before the ` +
        `transport is touched." The disabled (${scenario}) tier's tighten gesture dialled: ${JSON.stringify(r.dials)}`,
    );
  });

  gtest(`contract 2 [tighten x ${scenario}]: the refusal carries the tier's recorded reason`, async () => {
    const r = await drive({ scenario, command: TIGHTEN, cursor: IN_COMMENT });
    const reason = r.tier.message;
    assert.ok(typeof reason === "string" && reason.trim() !== "", `harness: the ${scenario} tier must have recorded a reason`);
    assert.ok(
      r.messages.length > 0,
      `contract 1: invoking tighten on a disabled (${scenario}) tier must refuse ON THE USER SURFACE, ` +
        `not proceed or go silent. No message was shown. Channel: ${JSON.stringify(r.lines)}`,
    );
    assert.ok(
      r.messages.some((m) => typeof m === "string" && m.includes(reason)),
      `contract 2: "The refusal names the tier's reason (the same reason the service recorded when it ` +
        `disabled), not a generic failure." Recorded reason: ${JSON.stringify(reason)}. ` +
        `Messages shown: ${JSON.stringify(r.messages)}`,
    );
  });
}

// ===========================================================================
// Contract 1's sweep: the other transport-using gestures, believed gated today
// (the fail-closed precedent). Regression guards: expected GREEN.
// ===========================================================================

const OTHER_GESTURES = [
  ["generate", GEN, IN_FUNCTION],
  ["repair", REPAIR, IN_FUNCTION],
  ["TDD generate", TDD_GEN, IN_FUNCTION],
  ["TDD run", TDD_RUN, IN_FUNCTION],
];

for (const [label, command, cursor] of OTHER_GESTURES) {
  gtest(`contract 3 guard [${label} x remote-empty]: zero network calls on a disabled tier (believed gated today)`, async () => {
    const r = await drive({ scenario: "remote-empty", command, cursor });
    assert.strictEqual(r.tier.fnGenEnabled, false, "harness: remote-empty must be a disabled tier");
    assert.deepStrictEqual(
      r.dials,
      [],
      `contract 3: the ${label} gesture dialled on a disabled tier: ${JSON.stringify(r.dials)}`,
    );
    assert.deepStrictEqual(
      r.preflights,
      [],
      `contract 3: the ${label} gesture ran its server pre-flight (a network request in the real product) ` +
        `on a disabled tier`,
    );
    assert.deepStrictEqual(__state.snippetInserts ?? [], [], `a refused ${label} writes nothing`);
  });
}

// Contract 2 across the sweep, on the OTHER disabled tier. The contract binds
// "EVERY gesture that would use its transport", so this is asserted for the
// gestures that indisputably do. TDD RUN is deliberately not in this sweep:
// driven here it refuses upstream for a state reason ("no generated tests for
// walk") with ZERO network calls - its no-network guard row covers it - and
// whether the tier reason must pre-empt an unrelated no-network refusal is a
// contract ambiguity this file reports rather than resolves.
const TRANSPORT_GESTURES = OTHER_GESTURES.filter(([label]) => label !== "TDD run");

gtest("contract 2 sweep [transport gestures x below-12gb]: each refusal carries the tier's recorded reason", async () => {
  const misses = [];
  for (const [label, command, cursor] of TRANSPORT_GESTURES) {
    const r = await drive({ scenario: "below-12gb", command, cursor });
    const reason = r.tier.message;
    if (r.messages.length === 0) {
      misses.push(`${label}: refused in silence (no user-facing message at all)`);
    } else if (!r.messages.some((m) => typeof m === "string" && m.includes(reason))) {
      misses.push(`${label}: no message carries the recorded reason ${JSON.stringify(reason)}; got ${JSON.stringify(r.messages)}`);
    }
  }
  assert.deepStrictEqual(
    misses,
    [],
    `contract 2 binds EVERY gesture on a disabled tier:\n${misses.join("\n")}`,
  );
});
