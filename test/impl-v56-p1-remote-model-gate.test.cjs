// Implementer oracle: session-v56 phase 1 edges the blind contract file leaves
// open (roadmap item 57). The blind rows pin exact-tag membership only; these
// pin the `:latest` alias through the remote arm (ollama catalogues an untagged
// pull as `name:latest`), the tag-mismatch miss, the shared `hasModel` helper's
// table, and the channel line's decision record - wording owned here, not by
// the contract. Complements test/blind-v56-p1-remote-model-gate.test.cjs,
// whose vscode-stub + bundle + `listModels`-seam harness is copied.
//
// Run: node --test test/impl-v56-p1-remote-model-gate.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const esbuild = require("esbuild");
const { bundleCore } = require("./.blind-util.cjs");

// ---------------------------------------------------------------------------
// the pure helper, headless
// ---------------------------------------------------------------------------

const core = bundleCore("impl-v56-p1", `export { hasModel } from "../src/core/ollama";\n`);
const { hasModel } = core.mod;
test.after(core.cleanup);

test("hasModel: exact tag membership", () => {
  assert.strictEqual(hasModel(["qwen3-coder:480b"], "qwen3-coder:480b"), true);
  assert.strictEqual(hasModel([], "qwen3-coder:480b"), false);
  assert.strictEqual(hasModel(["llama3:8b"], "qwen3-coder:480b"), false);
});

test("hasModel: a bare configured name matches its :latest catalogue row", () => {
  assert.strictEqual(hasModel(["qwen3-coder:latest"], "qwen3-coder"), true);
});

test("hasModel: the alias is one-way - a tagged configured name never matches a different tag", () => {
  // `qwen3-coder:480b` configured, only `:latest` pulled: that is a real miss,
  // the server would still answer model-not-found.
  assert.strictEqual(hasModel(["qwen3-coder:latest"], "qwen3-coder:480b"), false);
  // And a bare catalogue row does not satisfy a `:latest` request.
  assert.strictEqual(hasModel(["qwen3-coder"], "qwen3-coder:latest"), false);
});

// ---------------------------------------------------------------------------
// bundle src/vscode/* against a stub `vscode`
// (mechanism copied from test/blind-v56-p1-remote-model-gate.test.cjs)
// ---------------------------------------------------------------------------

const STUB = path.join(__dirname, ".impl-v56-p1-stub.cjs");
fs.writeFileSync(
  STUB,
  `
const state = { config: {}, configInfo: {}, updates: [], messages: [], infoResponses: [], warnResponses: [], errorResponses: [], opened: [], quickPickImpl: null, commands: {}, terminals: [] };
class EventEmitter {
  constructor() { this.handlers = []; }
  get event() { return (fn) => { this.handlers.push(fn); return { dispose() {} }; }; }
  fire(x) { for (const h of this.handlers) h(x); }
  dispose() {}
}
module.exports = {
  __state: state,
  EventEmitter,
  ProgressLocation: { Notification: 15, Window: 10 },
  ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
  SymbolKind: { Function: 11, Method: 5, Constructor: 8 },
  ThemeColor: class { constructor(id) { this.id = id; } },
  workspace: {
    getConfiguration: () => ({
      get: (key, fallback) => (key in state.config ? state.config[key] : fallback),
      inspect: (key) => state.configInfo[key],
      update: async (key, value, target) => { state.updates.push({ key, value, target }); state.config[key] = value; },
    }),
    onDidChangeConfiguration: () => ({ dispose() {} }),
    registerTextDocumentContentProvider: () => ({ dispose() {} }),
  },
  window: {
    showInformationMessage: async (message, ...actions) => { state.messages.push({ kind: "info", message, actions }); return state.infoResponses.shift(); },
    showWarningMessage: async (message, ...actions) => { state.messages.push({ kind: "warn", message, actions }); return state.warnResponses.shift(); },
    showErrorMessage: async (message, ...actions) => { state.messages.push({ kind: "error", message, actions }); return state.errorResponses.shift(); },
    showQuickPick: async (items, opts) => (state.quickPickImpl ? state.quickPickImpl(items, opts) : undefined),
    withProgress: async (opts, task) => task({ report: () => {} }, { onCancellationRequested: () => ({ dispose() {} }) }),
    createTerminal: (opts) => { const t = { name: opts.name, shown: false, sent: [], show() { this.shown = true; }, sendText(s) { this.sent.push(s); } }; state.terminals.push(t); return t; },
    get terminals() { return state.terminals; },
    tabGroups: { all: [], onDidChangeTabs: () => ({ dispose() {} }), close: async () => {} },
  },
  commands: { registerCommand: (id, fn) => { state.commands[id] = fn; return { dispose() {} }; } },
  env: { openExternal: async (uri) => { state.opened.push(String(uri)); return true; } },
  Uri: { parse: (s) => s, file: (s) => ({ fsPath: s, toString: () => s }) },
};
`
);

const entry = path.join(__dirname, ".impl-v56-p1-vscode.entry.ts");
const outfile = path.join(__dirname, ".impl-v56-p1-vscode.bundle.cjs");
fs.writeFileSync(entry, `export { buildFnGenService } from "../src/vscode/fnGen";\nexport { __state } from "vscode";\n`);
esbuild.buildSync({
  entryPoints: [entry],
  bundle: true,
  outfile,
  format: "cjs",
  platform: "node",
  alias: { vscode: STUB },
});
const { buildFnGenService, __state } = require(outfile);
test.after(() => {
  fs.rmSync(entry, { force: true });
  fs.rmSync(outfile, { force: true });
  fs.rmSync(STUB, { force: true });
});

const REMOTE_HOST = "http://ml-box.invalid:11434";

// Hardware probe that fails the row if consulted: the remote arm never probes.
const noProbe = {
  runCommand: async () => {
    throw new Error("the remote arm must not probe this machine");
  },
  totalMemBytes: () => {
    throw new Error("the remote arm must not probe this machine");
  },
};

/** One build at the facade, remote-configured, model list injected. */
async function build(models, config) {
  __state.config = config ?? { apiBase: REMOTE_HOST, fnGenModel: "qwen3-coder" };
  __state.messages = [];
  const out = { lines: [], appendLine(l) { this.lines.push(l); } };
  const log = [];
  const built = await buildFnGenService(out, (l) => log.push(l), noProbe, {
    listModels: async () => models,
  });
  return { ...built, log, out };
}

// ---------------------------------------------------------------------------
// the :latest alias through the remote arm
// ---------------------------------------------------------------------------

test("remote arm: a bare configured model is ENABLED by its :latest catalogue row", async () => {
  const built = await build(["qwen3-coder:latest", "llama3:8b"]);
  assert.strictEqual(built.tier.id, "remote");
  assert.strictEqual(built.tier.fnGenEnabled, true, `the :latest alias satisfies the gate, message was ${JSON.stringify(built.tier.message)}`);
  assert.strictEqual(built.tier.message, undefined);
  built.service.dispose();
});

test("remote arm: a tagged configured model is NOT satisfied by :latest alone", async () => {
  const built = await build(["qwen3-coder:latest"], { apiBase: REMOTE_HOST, fnGenModel: "qwen3-coder:480b" });
  assert.strictEqual(built.tier.fnGenEnabled, false, "a different tag is a real miss");
  assert.ok(built.tier.message.includes("qwen3-coder:480b"), `the reason names the configured tag, got ${JSON.stringify(built.tier.message)}`);
  built.service.dispose();
});

// ---------------------------------------------------------------------------
// the decision record and the surviving service shape
// ---------------------------------------------------------------------------

test("remote arm: the channel line records the model-missing decision distinctly from unreachable", async () => {
  const missing = await build([]);
  assert.ok(
    missing.log.some((l) => l.includes("fnGen=disabled") && l.includes("reason=model-missing") && l.includes("qwen3-coder")),
    `the carve line names the decision and the model, got ${JSON.stringify(missing.log)}`
  );
  missing.service.dispose();
  const down = await build(undefined);
  assert.ok(
    down.log.some((l) => l.includes("fnGen=disabled") && l.includes("reason=unreachable")),
    `the unreachable line is unchanged, got ${JSON.stringify(down.log)}`
  );
  assert.ok(
    down.log.every((l) => !l.includes("reason=model-missing")),
    "an unreachable host is not reported as a missing model"
  );
  down.service.dispose();
});

test("remote arm: the model-missing tier still carries the remote service and config (numGpu carve dropped)", async () => {
  const built = await build([]);
  assert.strictEqual(built.tier.id, "remote");
  assert.strictEqual(built.tier.provisional, false);
  assert.ok(built.service && typeof built.service.generate === "function", "the service object is still built, gated by the tier");
  assert.ok(!("numGpu" in built.config), "the local serving carve never rides to a remote host");
  built.service.dispose();
});
