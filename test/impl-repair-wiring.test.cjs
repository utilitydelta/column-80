// Implementer test: closes the falsification gap the blind oracle left skipped
// (set C, C5). The manual repair command's guards are pinned by the blind set;
// what stays untested there is the CORE wiring - a resolved function must drive
// the oracle with the function's own span, source "fngen", the fail-closed
// gate, and a LIVE staged-context reader. That needs a document-symbol provider,
// which this harness supplies. A wrong landedSpan or a dropped readContextBlocks
// would pass every other test in the suite; only this one catches it.
//
// Run: SKIP_LIVE=1 node --test test/impl-repair-wiring.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");

const SRC = "fn broken() -> i32 {\n    return 1;\n}\n";

const STUB = path.join(__dirname, ".impl-repair-wiring-stub.cjs");
fs.writeFileSync(
  STUB,
  `
const state = { config: {}, messages: [], commands: {}, activeTextEditor: undefined, terminals: [], warnResponses: [], textDocuments: [] };
class Position { constructor(line, character) { this.line = line; this.character = character; } }
class Range {
  constructor(a, b, c, d) {
    if (typeof a === "number") { this.start = new Position(a, b); this.end = new Position(c, d); }
    else { this.start = a; this.end = b; }
  }
  contains(pos) {
    const afterStart = pos.line > this.start.line || (pos.line === this.start.line && pos.character >= this.start.character);
    const beforeEnd = pos.line < this.end.line || (pos.line === this.end.line && pos.character <= this.end.character);
    return afterStart && beforeEnd;
  }
}
class EventEmitter {
  constructor() { this.handlers = []; }
  get event() { return (fn) => { this.handlers.push(fn); return { dispose() {} }; }; }
  fire(x) { for (const h of this.handlers) h(x); }
  dispose() {}
}
class ThemeColor { constructor(id) { this.id = id; } }
class MarkdownString { appendCodeblock() {} }
class Diagnostic { constructor(range, message) { this.range = range; this.message = message; } }
const Uri = { file: (p) => ({ fsPath: p, path: p, scheme: "file", toString: () => "file://" + p }) };
// One rust function; the symbol range covers it, selectionRange is the name.
const SYMBOLS = [{
  name: "broken", kind: 11,
  range: new Range(0, 0, 2, 1), selectionRange: new Range(0, 3, 0, 9), children: [],
}];
module.exports = {
  __state: state,
  Position, Range, EventEmitter, ThemeColor, MarkdownString, Diagnostic, Uri,
  DiagnosticSeverity: { Error: 0, Warning: 1 },
  SymbolKind: { Function: 11, Method: 5, Constructor: 8, Struct: 22, Enum: 9 },
  ProgressLocation: { Notification: 15 },
  ConfigurationTarget: { Global: 1 },
  workspace: {
    getConfiguration: () => ({
      get: (key, fallback) => (key in state.config ? state.config[key] : fallback),
      inspect: () => undefined, update: async () => {},
    }),
    onDidChangeConfiguration: () => ({ dispose() {} }),
    registerTextDocumentContentProvider: () => ({ dispose() {} }),
    get textDocuments() { return state.textDocuments; },
    applyEdit: async () => true,
  },
  languages: {
    createDiagnosticCollection: (name) => ({ name, set() {}, delete() {}, clear() {}, dispose() {} }),
  },
  window: {
    createTextEditorDecorationType: (opts) => ({ opts, dispose() {} }),
    get visibleTextEditors() { return []; },
    get activeTextEditor() { return state.activeTextEditor; },
    showInformationMessage: async (message) => { state.messages.push({ kind: "info", message }); },
    showWarningMessage: async (message, ...actions) => { state.messages.push({ kind: "warn", message, actions }); return (state.warnResponses || []).shift(); },
    showErrorMessage: async (message) => { state.messages.push({ kind: "error", message }); },
    withProgress: async (opts, task) => task({ report: () => {} }, { onCancellationRequested: () => ({ dispose() {} }) }),
    setStatusBarMessage: () => ({ dispose() {} }),
    createTerminal: (opts) => {
      const t = { name: opts.name, shown: false, sent: [], show() { this.shown = true; }, sendText(s) { this.sent.push(s); } };
      state.terminals.push(t);
      return t;
    },
    get terminals() { return state.terminals; },
    tabGroups: { all: [], onDidChangeTabs: () => ({ dispose() {} }), close: async () => {} },
  },
  commands: {
    registerCommand: (id, fn) => { state.commands[id] = fn; return { dispose() {} }; },
    executeCommand: async (id) => (id === "vscode.executeDocumentSymbolProvider" ? SYMBOLS : undefined),
  },
};
`,
);

const entry = path.join(__dirname, ".impl-repair-wiring.entry.ts");
const outfile = path.join(__dirname, ".impl-repair-wiring.bundle.cjs");
fs.writeFileSync(
  entry,
  `export { registerFnGen, resolveFunctionAtCursor } from "../src/vscode/fnGen";
export { ContextBlockStore } from "../src/core/contextBlocks";
export { __state } from "vscode";\n`,
);
esbuild.buildSync({ entryPoints: [entry], bundle: true, outfile, format: "cjs", platform: "node", alias: { vscode: STUB } });
const { registerFnGen, resolveFunctionAtCursor, ContextBlockStore, __state } = require(outfile);
test.after(() => {
  fs.rmSync(entry, { force: true });
  fs.rmSync(outfile, { force: true });
  fs.rmSync(STUB, { force: true });
});

const REPAIR_CMD = "column80.repairFunction";

// In-memory rust document over SRC; supplies exactly what resolveFunctionAtCursor
// reads: offsetAt, lineAt (with firstNonWhitespaceCharacterIndex), getText(Range).
const lineStarts = (() => {
  const starts = [0];
  for (let i = 0; i < SRC.length; i++) if (SRC[i] === "\n") starts.push(i + 1);
  return starts;
})();
const offsetAt = (pos) => lineStarts[pos.line] + pos.character;
const doc = {
  languageId: "rust",
  version: 1,
  isDirty: false,
  isClosed: false,
  uri: { fsPath: "/broken.rs", path: "/broken.rs", scheme: "file", toString: () => "file:///broken.rs" },
  getText(range) {
    return range ? SRC.slice(offsetAt(range.start), offsetAt(range.end)) : SRC;
  },
  offsetAt,
  positionAt(offset) {
    let line = 0;
    while (line + 1 < lineStarts.length && lineStarts[line + 1] <= offset) line++;
    return { line, character: offset - lineStarts[line], offset };
  },
  lineAt(line) {
    const text = SRC.split("\n")[line] ?? "";
    return { text, firstNonWhitespaceCharacterIndex: text.length - text.trimStart().length };
  },
  save: async () => true,
};

const output = () => {
  const lines = [];
  return { lines, appendLine: (l) => lines.push(l) };
};

const referenceProbe = () => ({
  runCommand: async () => ({ stdout: "16303\n", exitCode: 0 }),
  totalMemBytes: () => 61826 * 1048576,
});
// No GPU => below-12gb tier => fnGenEnabled false => tierGate closed.
const noGpuProbe = () => ({
  runCommand: async () => {
    throw Object.assign(new Error("spawn nvidia-smi ENOENT"), { code: "ENOENT" });
  },
  totalMemBytes: () => 61826 * 1048576,
});

const waitFor = async (predicate, what, tries = 1200) => {
  for (let i = 0; i < tries; i++) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  assert.fail(`timed out waiting for ${what}`);
};

// Register with a runOracle spy, stage a context block, put the cursor inside
// the one function, and drive the command. Returns the captured oracle ctxs.
// listModels defaults to "server up" so the pre-flight passes; override it to
// exercise the down-server path. terminals records startOllamaTerminal spawns.
const driveRepairCommand = async (probeOpts, listModels = async () => ["qwen3-coder:30b"]) => {
  __state.config = { repairEnabled: true, compilerDirectedInjection: false };
  __state.messages = [];
  __state.commands = {};
  __state.terminals = [];
  const out = output();
  const oracleCalls = [];
  const store = new ContextBlockStore(() => {});
  registerFnGen({ subscriptions: [] }, out, store, {
    probeOpts,
    runOracle: async (ctx) => { oracleCalls.push(ctx); },
    listModels,
    // Ollama IS on PATH so the "Start ollama serve" consent opens the terminal
    // deterministically (no real spawn, no host dependency).
    ollamaCheck: async () => ({ stdout: "ollama version 0.0.0", exitCode: 0 }),
  });
  await waitFor(() => out.lines.some((l) => l.startsWith("[carve] tier=")), "tier resolution");
  // Stage a context block AFTER registration; a live reader must surface it.
  // Since session-v33 "live" means the TEXT too: the reader slices the block's
  // lines out of the document as it reads now, so the notes file has to be an
  // open document here or the block resolves as unreadable and is dropped.
  __state.textDocuments = [
    {
      uri: { toString: () => "file:///notes.rs" },
      getText: () => "// notes\n// pool.max = 8\n// and nothing else\n",
    },
  ];
  store.add({ uri: "file:///notes.rs", range: { startLine: 2, endLine: 2 }, text: "// pool.max = 8", version: 1 });
  __state.activeTextEditor = { document: doc, selection: { active: { line: 1, character: 4 } } };
  await __state.commands[REPAIR_CMD]();
  return { out, oracleCalls };
};

test("C5 (wiring): a resolved function drives the oracle with its own span, source fngen, the open gate, and a live context reader", async () => {
  const expected = await resolveFunctionAtCursor(doc, { line: 1, character: 4 }, false);
  assert.ok(expected, "sanity: the harness must resolve the function (else the test proves nothing)");

  const { oracleCalls } = await driveRepairCommand(referenceProbe());

  assert.strictEqual(oracleCalls.length, 1, "a resolved function runs exactly one oracle pass");
  const ctx = oracleCalls[0];
  assert.deepStrictEqual(ctx.landedSpan, expected.span, "landedSpan is the resolved function's own span");
  assert.strictEqual(ctx.source, "fngen", "manual repair rides the fngen self-repair route");
  assert.strictEqual(ctx.repairTierGate.allowed, true, "the fail-closed gate is passed through, open here");
  assert.strictEqual(typeof ctx.readContextBlocks, "function", "the live staged-context reader is wired");
  assert.deepStrictEqual(
    await ctx.readContextBlocks(),
    [{ uri: "file:///notes.rs", range: { startLine: 2, endLine: 2 }, text: "// pool.max = 8" }],
    "the reader returns the user's staged context, resolved out of the live document",
  );
  assert.strictEqual(typeof ctx.resolveFunction, "function", "the re-resolver is wired for the repair round");
});

// Goal item 4: a closed tier STILL check-and-surfaces from the manual path; only
// repair rounds are barred. Without this, a regression that `return`s after the
// closed-gate warning would drop check-and-surface and pass every other test
// (blind C4 hits the no-function guard first; C5 above only exercises an open
// gate). This is the one finding triage marked Do.
test("closed tier: the manual command STILL runs the oracle, with the closed gate passed through (repair barred, surface preserved)", async () => {
  const { oracleCalls, out } = await driveRepairCommand(noGpuProbe());

  assert.strictEqual(oracleCalls.length, 1, "a closed tier must not skip check-and-surface on the manual path");
  assert.strictEqual(
    oracleCalls[0].repairTierGate.allowed,
    false,
    "the closed gate is passed through so the oracle bars repair rounds but still surfaces",
  );
  assert.ok(
    __state.messages.some((m) => m.kind === "warn" && /repair is unavailable/.test(m.message)),
    "the user gets the honest closed-tier message, not silence",
  );
  assert.ok(
    out.lines.some((l) => l.startsWith("[repair] manual repair: gate closed")),
    "the closed-gate reason is on the record",
  );
});

// Server down: manual repair must offer the SAME "Start ollama serve" gesture
// the generate and FIM paths use, not run a doomed round. Pre-flighted before
// the oracle so the prompt surfaces here, not as a swallowed round failure.
test("server down: the manual command offers Start ollama serve and never runs a repair round", async () => {
  const { oracleCalls, out } = await driveRepairCommand(referenceProbe(), async () => undefined);

  assert.strictEqual(oracleCalls.length, 0, "a down server never runs the oracle from the manual path");
  const warn = __state.messages.find((m) => m.kind === "warn");
  assert.ok(warn, "the user gets an honest message, not a silently failed round");
  assert.match(warn.message, /server isn't running/);
  assert.deepStrictEqual(warn.actions, ["Start ollama serve"], "the start gesture is offered");
  assert.ok(out.lines.some((l) => l.includes("server unreachable; offering start")), "reason on the record");
});

test("server down, user consents: Start ollama serve opens a visible terminal (user-initiated)", async () => {
  __state.warnResponses = ["Start ollama serve"];
  await driveRepairCommand(referenceProbe(), async () => undefined);

  assert.strictEqual(__state.terminals.length, 1, "the server is started only on the explicit click");
  assert.strictEqual(__state.terminals[0].shown, true);
  assert.deepStrictEqual(__state.terminals[0].sent, ["ollama serve"]);
});
