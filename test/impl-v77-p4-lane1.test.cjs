// Implementer test, session-v77 phase 4 lane 1: the behaviour rows of the
// journey re-trace that land in fnGen.ts and runTestsReport.ts.
//
//   DD2  a cloud or remote failure is not blamed on a local Ollama
//   DD5  an aborted stub retry opens nothing
//   DE40 every discovered test excluded: the toast does not blame the runner
//   DF23 repair with repairEnabled off needs no model server
//   NF3  a check that could not spawn is one message (the status bar), not two
//
// Drives the REGISTERED commands through registerFnGen against a vscode stub,
// with the buildService / runOracle / listModels seams the product already has.
//
// Run: node --test test/impl-v77-p4-lane1.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const fs = require("node:fs");
const esbuild = require("esbuild");

const WROOT = path.join(__dirname, ".impl-v77-p4-lane1-workspace");
fs.rmSync(WROOT, { recursive: true, force: true });
fs.mkdirSync(path.join(WROOT, "src"), { recursive: true });
fs.writeFileSync(path.join(WROOT, "package.json"), '{"name":"w","version":"0.0.0"}\n');

const STUB = path.join(__dirname, ".impl-v77-p4-lane1-stub.cjs");
fs.writeFileSync(
  STUB,
  `
const state = {
  config: {}, messages: [], commands: {}, activeTextEditor: undefined,
  executeCalls: [], terminals: [], textDocuments: [], symbols: undefined, wroot: "/",
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
const push = (kind) => async (message, ...actions) => { state.messages.push({ kind, message, actions }); return undefined; };
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
    openTextDocument: async () => state.activeTextEditor && state.activeTextEditor.document,
    applyEdit: async () => true,
    fs: {
      stat: async () => { throw new Error("ENOENT"); },
      createDirectory: async () => {}, writeFile: async () => {},
      readFile: async () => Buffer.from(""), delete: async () => {},
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
    showInformationMessage: push("info"),
    showWarningMessage: push("warn"),
    showErrorMessage: push("error"),
    showQuickPick: async () => undefined,
    withProgress: async (opts, task) => task({ report: () => {} }, { onCancellationRequested: () => ({ dispose() {} }) }),
    setStatusBarMessage: (text) => { state.messages.push({ kind: "status", message: text, actions: [] }); return { dispose() {} }; },
    createStatusBarItem: () => ({ text: "", tooltip: "", command: undefined, show() {}, hide() {}, dispose() {} }),
    createTerminal: (opts) => { const t = { name: opts && opts.name, show() {}, sendText() {}, dispose() {} }; state.terminals.push(t); return t; },
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

const ENTRY = path.join(__dirname, ".impl-v77-p4-lane1.entry.ts");
const OUTFILE = path.join(__dirname, ".impl-v77-p4-lane1.bundle.cjs");
fs.writeFileSync(
  ENTRY,
  `export { registerFnGen } from "../src/vscode/fnGen";
export { FnGenService } from "../src/core/fnGenService";
export { ContextBlockStore } from "../src/core/contextBlocks";
export { renderRunTestsReport } from "../src/core/runTestsReport";
export { __state, Position, Range } from "vscode";\n`,
);
esbuild.buildSync({ entryPoints: [ENTRY], bundle: true, outfile: OUTFILE, format: "cjs", platform: "node", alias: { vscode: STUB } });
const B = require(OUTFILE);

test.after(() => {
  for (const f of [STUB, ENTRY, OUTFILE]) fs.rmSync(f, { force: true });
  fs.rmSync(WROOT, { recursive: true, force: true });
});

const MODEL = "qwen3-coder:30b";
const CFG = { apiBase: "http://localhost:11434", model: MODEL, fallbackModel: MODEL, maxTokens: 512, temperature: 0.2 };
const SRC = "// walks the shard cache and drops every entry it can prove is stale\nexport function walk(): number {\n  return 1;\n}\n";
const FSPATH = path.join(WROOT, "src", "walk.ts");
fs.writeFileSync(FSPATH, SRC);

function makeDoc() {
  const lineStarts = [0];
  for (let i = 0; i < SRC.length; i++) if (SRC[i] === "\n") lineStarts.push(i + 1);
  const offsetAt = (pos) => Math.min((lineStarts[pos.line] ?? SRC.length) + pos.character, SRC.length);
  return {
    languageId: "typescript",
    version: 1,
    isDirty: false,
    isClosed: false,
    eol: 1,
    lineCount: SRC.split("\n").length,
    fileName: FSPATH,
    uri: { fsPath: FSPATH, path: FSPATH, scheme: "file", toString: () => "file://" + FSPATH, with() { return this; } },
    getText(range) {
      return range ? SRC.slice(offsetAt(range.start), offsetAt(range.end)) : SRC;
    },
    offsetAt,
    positionAt(offset) {
      let line = 0;
      while (line + 1 < lineStarts.length && lineStarts[line + 1] <= offset) line++;
      return new B.Position(line, offset - lineStarts[line]);
    },
    lineAt(arg) {
      const n = typeof arg === "number" ? arg : arg.line;
      const text = SRC.split("\n")[n] ?? "";
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

const waitFor = async (predicate, tries = 400) => {
  for (let i = 0; i < tries; i++) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, 5));
  }
  return false;
};

const OPEN_TIER = { id: "cloud", fnGenEnabled: true, provisional: false };

/** Register, put the cursor inside `walk`, fire one command, record everything.
 *  The command is NOT awaited: a path that reaches the presenter waits on a
 *  human verdict that never comes here. `settle` bounds the wait instead. */
async function drive({ command, config = {}, service, runOracle, listModels = async () => [MODEL], settle = 200 }) {
  const st = B.__state;
  st.wroot = WROOT;
  st.config = { ...config };
  st.messages = [];
  st.commands = {};
  st.executeCalls = [];
  st.terminals = [];
  const doc = makeDoc();
  st.textDocuments = [doc];
  st.symbols = [
    { name: "walk", detail: "", kind: 11, range: new B.Range(1, 0, 3, 1), selectionRange: new B.Range(1, 16, 1, 20), children: [] },
  ];
  const lines = [];
  const output = { lines, appendLine: (l) => lines.push(l), append() {}, show() {}, clear() {}, dispose() {} };
  const context = { subscriptions: [], globalStorageUri: { fsPath: path.join(WROOT, ".storage") } };
  const oracleCalls = [];
  B.registerFnGen(context, output, new B.ContextBlockStore(() => {}), {
    buildService: async () => ({ tier: OPEN_TIER, service: service ?? { dispose() {} }, config: CFG }),
    runOracle: async (ctx) => {
      oracleCalls.push(ctx);
      if (runOracle) await runOracle(ctx);
    },
    listModels,
    ollamaCheck: async () => ({ stdout: "ollama version 0.0.0", exitCode: 0 }),
  });
  assert.ok(await waitFor(() => typeof st.commands[command] === "function"), `harness: ${command} never registered`);
  // Let the tier rebuild settle so the gate reads the open tier.
  await new Promise((r) => setTimeout(r, 20));
  const p = new B.Position(2, 4);
  const sel = new B.Range(p, p);
  sel.active = p;
  sel.anchor = p;
  st.activeTextEditor = {
    document: doc,
    viewColumn: 1,
    options: { tabSize: 2, insertSpaces: true },
    selection: sel,
    insertSnippet: async () => true,
    revealRange: () => {},
    edit: async (cb) => {
      cb({ replace() {}, insert() {}, delete() {} });
      return true;
    },
  };
  st.messages = [];
  void Promise.resolve(st.commands[command]()).catch((err) => lines.push(`[test] command threw: ${String(err)}`));
  await new Promise((r) => setTimeout(r, settle));
  const toasts = st.messages.filter((m) => m.kind !== "status");
  const result = {
    toasts,
    status: st.messages.filter((m) => m.kind === "status").map((m) => String(m.message)),
    channel: lines.slice(),
    executeCalls: st.executeCalls.slice(),
    oracleCalls,
  };
  st.activeTextEditor = undefined;
  for (const d of context.subscriptions) {
    try {
      d.dispose?.();
    } catch {
      /* teardown only */
    }
  }
  return result;
}

const show = (r) => `toasts=${JSON.stringify(r.toasts)}\nchannel=${JSON.stringify(r.channel)}`;

const fetchFailed = () => {
  const e = new TypeError("fetch failed");
  e.cause = { code: "ECONNREFUSED" };
  return e;
};
const failingService = (log) =>
  new B.FnGenService(CFG, async () => {
    throw fetchFailed();
  }, log ?? (() => {}));

// ---------------------------------------------------------------------------
// DD2: the backend decides the sentence, and only a local Ollama gets the
// Start ollama serve button.
// ---------------------------------------------------------------------------

test("DD2: a cloud provider that cannot be reached is not blamed on a local Ollama", async () => {
  const r = await drive({
    command: "column80.generateFunction",
    config: { fnGenProvider: "openai", cloudApiKey: "k" },
    service: failingService(),
  });
  const errors = r.toasts.filter((t) => t.kind === "error" || t.kind === "warn");
  assert.strictEqual(errors.length, 1, `one toast for one failure.\n${show(r)}`);
  assert.match(errors[0].message, /could not reach OpenAI/, show(r));
  assert.match(errors[0].message, /column80\.cloudApiBase/, show(r));
  assert.ok(!/Ollama/.test(errors[0].message), `a cloud failure must not name Ollama.\n${show(r)}`);
  assert.deepStrictEqual(errors[0].actions, [], "no Start ollama serve on a cloud backend");
});

test("DD2: a remote Ollama that stops answering names the host and offers no local start", async () => {
  const host = "http://gpu-box.invalid:11434";
  const r = await drive({ command: "column80.generateFunction", config: { apiBase: host }, service: failingService() });
  const errors = r.toasts.filter((t) => t.kind === "error" || t.kind === "warn");
  assert.strictEqual(errors.length, 1, show(r));
  assert.strictEqual(
    errors[0].message,
    `Column 80: the Ollama server at ${host} did not answer, so nothing was written. Check that it is running.`,
  );
  assert.deepStrictEqual(errors[0].actions, [], "starting THIS box's server would not help a remote host");
});

test("DD2 control: a local Ollama keeps its sentence and the Start ollama serve button", async () => {
  const r = await drive({ command: "column80.generateFunction", service: failingService() });
  const errors = r.toasts.filter((t) => t.kind === "error" || t.kind === "warn");
  assert.strictEqual(errors.length, 1, show(r));
  assert.strictEqual(errors[0].message, "Column 80: the Ollama server is not answering, so nothing was generated.");
  assert.deepStrictEqual(errors[0].actions, ["Start ollama serve"]);
});

test("DD2: Repair Function Body against a remote Ollama that is down names the host, no local start", async () => {
  const host = "http://gpu-box.invalid:11434";
  const r = await drive({
    command: "column80.repairFunction",
    config: { apiBase: host, repairEnabled: true },
    listModels: async () => undefined,
  });
  const warns = r.toasts.filter((t) => t.kind === "warn");
  assert.strictEqual(warns.length, 1, show(r));
  assert.strictEqual(
    warns[0].message,
    `Column 80: the Ollama server at ${host} did not answer, so the function was not repaired. Check that it is running.`,
  );
  assert.deepStrictEqual(warns[0].actions, []);
  assert.strictEqual(r.oracleCalls.length, 0, "a down server still runs no round");
});

// ---------------------------------------------------------------------------
// DD5: the user cancelled the stub retry; nothing opens behind their back.
// ---------------------------------------------------------------------------

test("DD5: an aborted stub retry presents nothing and toasts nothing", async () => {
  const svc = new B.FnGenService(
    CFG,
    async () => ({ text: 'export function walk(): number {\n  throw new Error("not implemented");\n}', ttftMs: 1, totalMs: 2, doneReason: "stop" }),
    () => {},
  );
  let retries = 0;
  svc.generateRaw = async () => {
    retries++;
    return undefined;
  };
  const r = await drive({
    command: "column80.generateFunction",
    config: { compilerDirectedInjection: true },
    service: svc,
    settle: 400,
  });
  assert.strictEqual(retries, 1, `precondition: the punt retry must have run.\n${show(r)}`);
  assert.ok(r.channel.some((l) => l.includes("regeneration was aborted")), show(r));
  assert.deepStrictEqual(
    r.executeCalls.filter((c) => c.id === "vscode.diff").map((c) => c.args[2]),
    [],
    `the cancelled retry must not open a preview.\n${show(r)}`,
  );
  assert.deepStrictEqual(r.toasts, [], show(r));
});

// ---------------------------------------------------------------------------
// DF23 and NF3: Repair Function Body.
// ---------------------------------------------------------------------------

test("DF23: repairEnabled off needs no model server, so a down Ollama does not refuse the press", async () => {
  const r = await drive({
    command: "column80.repairFunction",
    config: { repairEnabled: false },
    listModels: async () => undefined,
  });
  assert.ok(!r.toasts.some((t) => /Ollama/.test(t.message)), show(r));
  assert.strictEqual(r.oracleCalls.length, 1, `the check still runs.\n${show(r)}`);
});

test("NF3: a check that could not spawn its tool is one message, the status bar's, not a second toast", async () => {
  const r = await drive({
    command: "column80.repairFunction",
    config: { repairEnabled: true },
    // runOracleCheck marks the spawn rejection once its status bar line is up
    // (markShown, session-v77 P5A-5); the skip keys on that mark.
    runOracle: async () => {
      throw Object.assign(new Error("spawn go ENOENT"), { code: "ENOENT", syscall: "spawn go", shownToUser: true });
    },
  });
  assert.strictEqual(r.oracleCalls.length, 1, show(r));
  assert.deepStrictEqual(r.toasts.filter((t) => t.kind === "warn"), [], show(r));
  assert.ok(r.channel.some((l) => l.includes("[oracle] manual repair failed")), "the channel keeps the error");
});

test("NF3 control: any other throw still toasts once, under the command's palette name", async () => {
  const r = await drive({
    command: "column80.repairFunction",
    config: { repairEnabled: true },
    runOracle: async () => {
      throw new Error("could not save /w/lib.rs before the check");
    },
  });
  assert.deepStrictEqual(
    r.toasts.filter((t) => t.kind === "warn").map((t) => t.message),
    ["Column 80: Repair Function Body stopped (could not save /w/lib.rs before the check). The full message is in the output channel."],
  );
});

test("NF3 control: a spawn failure nobody announced still toasts (the skip keys on the mark, not the shape)", async () => {
  const r = await drive({
    command: "column80.repairFunction",
    config: { repairEnabled: true },
    runOracle: async () => {
      throw Object.assign(new Error("spawn go ENOENT"), { code: "ENOENT", syscall: "spawn go" });
    },
  });
  assert.deepStrictEqual(
    r.toasts.filter((t) => t.kind === "warn").map((t) => t.message),
    ["Column 80: Repair Function Body stopped (spawn go ENOENT). The full message is in the output channel."],
  );
});

// ---------------------------------------------------------------------------
// DE40: found tests, ran none, and the runner is not to blame.
// ---------------------------------------------------------------------------

test("DE40: every discovered test excluded or unrunnable warns that none ran, without blaming the runner", () => {
  const entry = (name, extra) => ({ name, filter: name, filePath: "/repo/src/lib.rs", distance: 1, path: ["walk", name], ...extra });
  const r = B.renderRunTestsReport({
    symbolName: "walk",
    languageId: "rust",
    scopeWord: "crate",
    discovery: {
      discovered: [
        entry("settles", { excluded: { marker: "#[ignore]", where: "declaration" } }),
        entry("totals", { unrunnable: "the server's name for this test cannot become a runner filter" }),
      ],
      groups: [],
      provenZero: false,
      walk: { requests: 3, nodesAdmitted: 3, failedRequests: 0, outOfScope: 0 },
    },
    outcomes: [],
  });
  assert.strictEqual(r.severity, "warning");
  assert.ok(!r.toast.includes("runner produced no result"), r.toast);
  assert.match(r.toast, /found 2 covering tests for walk but ran none/, r.toast);
});
