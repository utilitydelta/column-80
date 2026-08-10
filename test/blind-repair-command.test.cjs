// Blind oracle (set C): the manual "Repair Function" command contract.
// registerFnGen must register `column80.repairFunction`. Its
// guards, and the runOracle seam it drives, are pinned here against a stub
// vscode with an injected runOracle spy (FnGenDeps.runOracle). The command
// calls (deps.runOracle ?? runPostAcceptOracle)(ctx), so the spy captures the
// ctx the command builds without running a real repair.
//
// Guards pinned:
//  - No active editor            => warning shown, runOracle NEVER called.
//  - Active editor, no resolvable function (no symbol provider in the stub, so
//    resolution returns undefined naturally) => warning shown, spy NOT called.
//  - Closed tier gate (noGpuProbe / disabled tier) => honest "unavailable"
//    message, no repair round attempted (spy NOT called). See ASSUMPTION below.
//
// Never reads the new command body; drives the registered command id and
// inspects the injected seam. Expected RED until the command exists (today the
// id is unregistered, so the command lookup is undefined).
//
// ASSUMPTION (stated per the brief): the unit stub has no document-symbol
// provider, so resolveFunctionAtCursor returns undefined and the no-resolvable-
// function guard fires before any tier-gated repair. The closed-gate case
// therefore collapses to the same "no round attempted" observable here; the
// gate's own semantics (closed gate still runs check-and-surface, repair
// disabled) are covered at the runPostAcceptOracle level by impl5-fnGen and by
// set B. Driving a SUCCESSFUL resolution needs a DocumentSymbol-provider stub
// (DocumentSymbol[] with range.contains/selectionRange + document.offsetAt +
// lineAt().firstNonWhitespaceCharacterIndex); that is too brittle in this stub,
// so the resolved-span wiring is left to set B + these guards, per the brief.
//
// Run: SKIP_LIVE=1 node --test test/blind-repair-command.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");

const STUB = path.join(__dirname, ".blind-repair-command-stub.cjs");
fs.writeFileSync(
  STUB,
  `
const state = {
  config: {}, messages: [], commands: {}, executeCalls: [],
  collections: [], visibleTextEditors: [], textDocuments: [], activeTextEditor: undefined,
};
class Position { constructor(line, character) { this.line = line; this.character = character; } }
class Range {
  constructor(a, b, c, d) {
    if (typeof a === "number") { this.start = new Position(a, b); this.end = new Position(c, d); }
    else { this.start = a; this.end = b; }
  }
}
class EventEmitter {
  constructor() { this.handlers = []; }
  get event() { return (fn) => { this.handlers.push(fn); return { dispose() {} }; }; }
  fire(x) { for (const h of this.handlers) h(x); }
  dispose() {}
}
class ThemeColor { constructor(id) { this.id = id; } }
class MarkdownString { constructor() { this.blocks = []; } appendCodeblock(t) { this.blocks.push(t); } }
class Diagnostic { constructor(range, message, severity) { this.range = range; this.message = message; this.severity = severity; } }
const Uri = {
  file: (p) => ({ fsPath: p, path: p, scheme: "file", toString: () => "file://" + p }),
  parse: (s) => ({ raw: s, toString: () => s }),
};
module.exports = {
  __state: state,
  Position, Range, EventEmitter, ThemeColor, MarkdownString, Diagnostic, Uri,
  DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
  SymbolKind: { Function: 11, Method: 5, Constructor: 8, Struct: 22, Enum: 9 },
  ProgressLocation: { Notification: 15, Window: 10 },
  ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
  workspace: {
    getConfiguration: () => ({
      get: (key, fallback) => (key in state.config ? state.config[key] : fallback),
      inspect: () => undefined,
      update: async () => {},
    }),
    onDidChangeConfiguration: () => ({ dispose() {} }),
    registerTextDocumentContentProvider: () => ({ dispose() {} }),
    get textDocuments() { return state.textDocuments; },
    applyEdit: async () => true,
  },
  languages: {
    createDiagnosticCollection: (name) => {
      const c = { name, set() {}, delete() {}, clear() {}, dispose() {} };
      state.collections.push(c);
      return c;
    },
  },
  window: {
    createTextEditorDecorationType: (opts) => ({ opts, dispose() {} }),
    get visibleTextEditors() { return state.visibleTextEditors; },
    get activeTextEditor() { return state.activeTextEditor; },
    showInformationMessage: async (message, ...actions) => { state.messages.push({ kind: "info", message, actions }); },
    showWarningMessage: async (message, ...actions) => { state.messages.push({ kind: "warn", message, actions }); },
    showErrorMessage: async (message) => { state.messages.push({ kind: "error", message }); },
    withProgress: async (opts, task) => task({ report: () => {} }, { onCancellationRequested: () => ({ dispose() {} }) }),
    setStatusBarMessage: () => ({ dispose() {} }),
    tabGroups: { all: [], onDidChangeTabs: () => ({ dispose() {} }), close: async () => {} },
  },
  commands: {
    registerCommand: (id, fn) => { state.commands[id] = fn; return { dispose() {} }; },
    executeCommand: async (id, ...args) => { state.executeCalls.push({ id, args }); return undefined; },
  },
};
`,
);

const entry = path.join(__dirname, ".blind-repair-command.entry.ts");
const outfile = path.join(__dirname, ".blind-repair-command.bundle.cjs");
fs.writeFileSync(
  entry,
  `export { registerFnGen } from "../src/vscode/fnGen";
export { runPostAcceptOracle } from "../src/vscode/oracleSurface";
export { ContextBlockStore } from "../src/core/contextBlocks";
export { __state } from "vscode";\n`,
);
esbuild.buildSync({
  entryPoints: [entry],
  bundle: true,
  outfile,
  format: "cjs",
  platform: "node",
  alias: { vscode: STUB },
});
const { registerFnGen, ContextBlockStore, __state } = require(outfile);
test.after(() => {
  fs.rmSync(entry, { force: true });
  fs.rmSync(outfile, { force: true });
  fs.rmSync(STUB, { force: true });
});

const REPAIR_CMD = "column80.repairFunction";

const resetState = () => {
  __state.config = {};
  __state.messages = [];
  __state.commands = {};
  __state.executeCalls = [];
  __state.visibleTextEditors = [];
  __state.textDocuments = [];
  __state.activeTextEditor = undefined;
};

const output = () => {
  const lines = [];
  return { lines, appendLine: (l) => lines.push(l) };
};

const fakeContext = () => ({ subscriptions: [] });

// Injected probes (impl5 pattern): never touch host hardware.
const referenceProbe = () => ({
  runCommand: async () => ({ stdout: "16303\n", exitCode: 0 }),
  totalMemBytes: () => 61826 * 1048576,
});
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

// A rust editor whose cursor resolves to no function (no symbol provider in the
// stub => resolveFunctionAtCursor returns undefined).
const rustEditor = () => ({
  document: { languageId: "rust", version: 1, uri: { fsPath: "/x.rs", toString: () => "file:///x.rs" } },
  selection: { active: { line: 0, character: 0 } },
});

// Register with an injected runOracle spy so the command's oracle call (if any)
// is captured instead of running a real repair.
const registerWithSpy = async (probeOpts) => {
  const out = output();
  const oracleCalls = [];
  const runOracle = async (ctx) => { oracleCalls.push(ctx); };
  registerFnGen(fakeContext(), out, new ContextBlockStore(() => {}), { probeOpts, runOracle });
  await waitFor(() => out.lines.some((l) => l.startsWith("[carve] tier=")), "tier resolution");
  return { out, oracleCalls };
};

test("C1: registerFnGen registers the column80.repairFunction command", async () => {
  resetState();
  __state.config = { repairEnabled: true };
  await registerWithSpy(referenceProbe());
  assert.strictEqual(typeof __state.commands[REPAIR_CMD], "function", "the repair command must be registered");
});

test("C2: no active editor => warning shown, runOracle spy NEVER called", async () => {
  resetState();
  __state.config = { repairEnabled: true };
  const { oracleCalls } = await registerWithSpy(referenceProbe());
  __state.activeTextEditor = undefined;

  const cmd = __state.commands[REPAIR_CMD];
  assert.strictEqual(typeof cmd, "function", "repair command must be registered before it can be driven");
  await cmd();

  assert.deepStrictEqual(oracleCalls, [], "no editor => no oracle round");
  assert.ok(__state.messages.some((m) => m.kind === "warn"), "the user gets an honest warning, not silence");
});

test("C3: active editor but no resolvable function => warning shown, runOracle spy NOT called", async () => {
  resetState();
  __state.config = { repairEnabled: true };
  const { oracleCalls } = await registerWithSpy(referenceProbe());
  __state.activeTextEditor = rustEditor();

  const cmd = __state.commands[REPAIR_CMD];
  assert.strictEqual(typeof cmd, "function", "repair command must be registered before it can be driven");
  await cmd();

  assert.deepStrictEqual(oracleCalls, [], "no function at the cursor => no oracle round");
  assert.ok(__state.messages.some((m) => m.kind === "warn"), "an honest 'no function here' warning is shown");
});

test("C4: closed tier gate (disabled tier) => honest message, no repair round attempted", async () => {
  resetState();
  __state.config = { repairEnabled: true };
  const { oracleCalls } = await registerWithSpy(noGpuProbe());
  __state.activeTextEditor = rustEditor();

  const cmd = __state.commands[REPAIR_CMD];
  assert.strictEqual(typeof cmd, "function", "repair command must be registered before it can be driven");
  await cmd();

  // No repair round is attempted (see ASSUMPTION at top: the no-function guard
  // dominates in this stub; the gate's own closed-path repair-disable is
  // covered by impl5-fnGen + set B).
  assert.deepStrictEqual(oracleCalls, [], "a closed gate never runs a repair round from the command");
  assert.ok(__state.messages.some((m) => m.kind === "warn"), "the command gives an honest message, not silence");
});

// Resolved-span wiring (runOracle fires with landedSpan == resolved span and
// readContextBlocks present) is intentionally NOT covered here: it needs a
// DocumentSymbol-provider stub that is too brittle in this harness. Covered by
// set B (readContextBlocks reaches the prompt) plus the guards above, per the
// brief. Left as a skipped placeholder so the gap is visible, not silent.
test("C5: resolved function drives runOracle with the resolved span + readContextBlocks (needs symbol-provider stub)", { skip: "needs a DocumentSymbol-provider stub; wiring covered by set B + guards C1-C4" }, () => {});
