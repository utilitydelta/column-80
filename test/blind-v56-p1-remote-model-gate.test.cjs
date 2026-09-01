// Blind oracle: session-v56 phase 1, a reachable remote host with zero models
// is not ready (roadmap item 57).
//
// Written from that phase's contract ONLY, BEFORE the fix. Every test
// names the contract behaviour (1..4) or falsification bullet it pins. The
// oracle read no implementation of the remote-arm enable decision: it read the
// facade's exported signature (`buildFnGenService(output, log, probeOpts?,
// deps?)`), `DEFAULT_FNGEN_CONFIG`, and the precedent oracle for the same arm
// (test/blind-v55-p2-remote-apibase.test.cjs), whose harness - the vscode
// stub, the esbuild bundle, the injected `listModels` seam - is copied here.
//
// Two bindings the contract leaves open, resolved by precedent and REPORTED:
//
//  * USER SURFACE. The contract says the disable reason reaches "the user
//    surface" but does not name the field. The v55 oracle pinned the disabled
//    remote arm's user-facing reason to `tier.message`; this file binds there.
//  * MODEL-LIST SEAM. The model-list endpoint is stubbed the way the v55 fix
//    resolved it: `listModels` on the deps bag (fourth parameter), answering
//    `string[] | undefined`. `[]` is therefore the contract's "reachable, zero
//    models" and `undefined` its "unreachable". If phase 1 adds a second call
//    for the model list instead of reading the one it already makes, the
//    injected fake still answers it IF it rides the same `listModels` seam;
//    a differently-named seam turns these rows red with "the injected
//    model-list stub was never consulted", an honest missed-seam report.
//
// Hermetic: every host is under `.invalid` (RFC 2606, never resolves) and
// every build injects `probeOpts`, so no packet leaves and no nvidia-smi is
// spawned by this file on any row.
//
// Run: node --test test/blind-v56-p1-remote-model-gate.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const esbuild = require("esbuild");

// ---------------------------------------------------------------------------
// bundle src/vscode/* against a stub `vscode`
// (mechanism copied from test/blind-v55-p2-remote-apibase.test.cjs)
// ---------------------------------------------------------------------------

const STUB = path.join(__dirname, ".blind-v56-p1-stub.cjs");
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

const entry = path.join(__dirname, ".blind-v56-p1.entry.ts");
const outfile = path.join(__dirname, ".blind-v56-p1.bundle.cjs");
fs.writeFileSync(
  entry,
  `export { buildFnGenService } from "../src/vscode/fnGen";
export { DEFAULT_FNGEN_CONFIG } from "../src/core/config";
export { __state } from "vscode";\n`
);
esbuild.buildSync({
  entryPoints: [entry],
  bundle: true,
  outfile,
  format: "cjs",
  platform: "node",
  alias: { vscode: STUB },
});
const { buildFnGenService, DEFAULT_FNGEN_CONFIG, __state } = require(outfile);
test.after(() => {
  fs.rmSync(entry, { force: true });
  fs.rmSync(outfile, { force: true });
  fs.rmSync(STUB, { force: true });
});

// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------

const REMOTE_HOST = "http://ml-box.invalid:11434";
const REMOTE_HOSTNAME = "ml-box.invalid";

// The configured model. Deliberately not the shipped default and not any tier
// row's model, so "the reason names the CONFIGURED model" is distinguishable
// from "the reason names whatever model the code had lying around".
const CONFIGURED_MODEL = "qwen3-coder:480b";

// Model lists the stubbed endpoint answers with.
const EMPTY_LIST = [];
const LIST_WITH_MODEL = ["llama3:8b", CONFIGURED_MODEL, "mistral:7b"];
const LIST_WITHOUT_MODEL = ["llama3:8b", "mistral:7b"];
const UNREACHABLE = undefined;

// ---------------------------------------------------------------------------
// harness
// ---------------------------------------------------------------------------

const resetState = () => {
  __state.config = {};
  __state.configInfo = {};
  __state.updates = [];
  __state.messages = [];
};

/** Recording model-list stub for the deps bag - the v55-resolved seam. */
function modelListStub(answer) {
  const calls = [];
  const listModels = async (...args) => {
    calls.push(args);
    return typeof answer === "function" ? answer(...args) : answer;
  };
  return { calls, deps: { listModels } };
}

/** Recording hardware probe (16GB reference box). Always injected so no row
 *  can spawn nvidia-smi; zero calls on remote rows is the no-VRAM evidence. */
function recordingProbe() {
  const calls = [];
  return {
    calls,
    opts: {
      runCommand: async (command, args) => {
        calls.push({ kind: "runCommand", command, args });
        return { stdout: "16303\n", exitCode: 0 };
      },
      totalMemBytes: () => {
        calls.push({ kind: "totalMemBytes" });
        return 61826 * 1048576;
      },
      platformInfo: () => ({ platform: "linux", arch: "x64" }),
    },
  };
}

/** One build at the public facade, remote-configured unless config overrides. */
async function build({ answer, config = { apiBase: REMOTE_HOST, fnGenModel: CONFIGURED_MODEL } }) {
  resetState();
  __state.config = config;
  const out = { lines: [], appendLine(l) { this.lines.push(l); } };
  const log = [];
  const stub = modelListStub(answer);
  const probe = recordingProbe();
  const built = await buildFnGenService(out, (l) => log.push(l), probe.opts, stub.deps);
  return { ...built, out, log, stub, probe, evidence: [...log, ...out.lines] };
}

/** Precondition shared by every reachable-host row: the verdict must have come
 *  from the injected endpoint, not from a seam this file failed to bind. */
function assertSeamConsulted(built) {
  assert.ok(
    built.stub.calls.length > 0,
    "the injected model-list stub was never consulted - the harness missed the seam, this row's verdict is void"
  );
}

// ===========================================================================
// BEHAVIOUR 1 / FALSIFICATION 1: a reachable host with ZERO models DISABLES
// ===========================================================================

test("behaviour 1: a reachable host whose model list is empty DISABLES fn-gen at enable time", async () => {
  const built = await build({ answer: EMPTY_LIST });
  assertSeamConsulted(built);

  assert.strictEqual(built.tier.id, "remote");
  assert.strictEqual(
    built.tier.fnGenEnabled,
    false,
    'contract: "A reachable host whose model list is empty DISABLES fn-gen" - an empty list means the server carries nothing, readiness is reachable AND carries the model'
  );
  built.service.dispose();
});

test("behaviour 1: the empty-list disable reason NAMES the missing model and the host", async () => {
  const built = await build({ answer: EMPTY_LIST });
  assertSeamConsulted(built);

  const msg = built.tier.message;
  assert.ok(
    typeof msg === "string" && msg.trim() !== "",
    `the user surface receives a disable reason, got ${JSON.stringify(msg)} - "The user learns this at enable time, not as an opaque model-not-found on the first generate"`
  );
  assert.ok(msg.includes(CONFIGURED_MODEL), `the reason NAMES the missing model, got ${JSON.stringify(msg)}`);
  assert.ok(msg.includes(REMOTE_HOSTNAME), `the reason NAMES the host, got ${JSON.stringify(msg)}`);
  built.service.dispose();
});

test("behaviour 1 rider: with no fnGenModel set, the reason names the shipped default - that IS the configured model then", async () => {
  assert.ok(
    typeof DEFAULT_FNGEN_CONFIG.model === "string" && DEFAULT_FNGEN_CONFIG.model !== "",
    "precondition: the shipped default model tag exists"
  );
  const built = await build({ answer: EMPTY_LIST, config: { apiBase: REMOTE_HOST } });
  assertSeamConsulted(built);

  assert.strictEqual(built.tier.fnGenEnabled, false, "an empty list disables regardless of who chose the model");
  assert.ok(
    typeof built.tier.message === "string" && built.tier.message.includes(DEFAULT_FNGEN_CONFIG.model),
    `the reason names the model the arm would actually request, got ${JSON.stringify(built.tier.message)}`
  );
  built.service.dispose();
});

// ===========================================================================
// BEHAVIOUR 2 / FALSIFICATION 2: the list CARRIES the model - enabled as today
// ===========================================================================

test("behaviour 2: a reachable host whose list carries the configured model ENABLES fn-gen, exactly as today", async () => {
  const built = await build({ answer: LIST_WITH_MODEL });
  assertSeamConsulted(built);

  assert.strictEqual(built.tier.id, "remote");
  assert.strictEqual(
    built.tier.fnGenEnabled,
    true,
    `a ready host must not be refused, message was ${JSON.stringify(built.tier.message)}`
  );
  assert.strictEqual(built.tier.message, undefined, "an enabled tier carries no disable reason");
  assert.strictEqual(built.config.model, CONFIGURED_MODEL, "and the configured model is what the service will request");
  assert.ok(built.service && typeof built.service.generate === "function", "a real service was built");
  built.service.dispose();
});

// ===========================================================================
// BEHAVIOUR 3: an UNREACHABLE host behaves exactly as today
// ===========================================================================

test("behaviour 3: an unreachable host still disables with the existing wording - names the host, never the GPU", async () => {
  const built = await build({ answer: UNREACHABLE });
  assertSeamConsulted(built);

  assert.strictEqual(built.tier.id, "remote");
  assert.strictEqual(built.tier.fnGenEnabled, false, "fail CLOSED on an unreachable host, unchanged");
  const msg = built.tier.message;
  assert.ok(typeof msg === "string" && msg.includes(REMOTE_HOSTNAME), `the message still names the host, got ${JSON.stringify(msg)}`);
  for (const banned of [/GPU/i, /VRAM/i, /nvidia/i]) {
    assert.ok(!banned.test(msg), `the unreachable wording is not to change, and it never mentioned the GPU: ${JSON.stringify(msg)}`);
  }
  built.service.dispose();
});

// ===========================================================================
// BEHAVIOUR 4 / FALSIFICATION 3: OTHER models only - case 1, not case 2
// ===========================================================================

test("behaviour 4: a host carrying only OTHER models disables, and the reason names the CONFIGURED model", async () => {
  const built = await build({ answer: LIST_WITHOUT_MODEL });
  assertSeamConsulted(built);

  assert.strictEqual(
    built.tier.fnGenEnabled,
    false,
    'contract: "A reachable host carrying OTHER models but not the configured one is case 1, not case 2" - a non-empty list is not readiness'
  );
  const msg = built.tier.message;
  assert.ok(
    typeof msg === "string" && msg.includes(CONFIGURED_MODEL),
    `the reason names the CONFIGURED model, not one the host happens to carry, got ${JSON.stringify(msg)}`
  );
  assert.ok(msg.includes(REMOTE_HOSTNAME), `case 1 names the host, and this IS case 1, got ${JSON.stringify(msg)}`);
  built.service.dispose();
});

// ===========================================================================
// NON-BEHAVIOUR: the channel records the decision; nothing else moved
// ===========================================================================

test("non-behaviour: the channel keeps a line recording the disable decision (wording free, so only the host is pinned)", async () => {
  const built = await build({ answer: EMPTY_LIST });
  assert.ok(
    built.evidence.some((l) => l.includes(REMOTE_HOSTNAME)),
    `some channel line records the remote decision against this host, got ${JSON.stringify(built.evidence)}`
  );
  built.service.dispose();
});

test("non-behaviour: the model gate spawns no hardware probe - an unready host must not degrade into the local VRAM story", async () => {
  for (const [label, answer] of [
    ["empty list", EMPTY_LIST],
    ["other models", LIST_WITHOUT_MODEL],
    ["carries the model", LIST_WITH_MODEL],
  ]) {
    const built = await build({ answer });
    assert.deepStrictEqual(
      built.probe.calls,
      [],
      `${label}: the remote arm probed THIS machine - "No change to local-tier VRAM gating" cuts both ways`
    );
    built.service.dispose();
  }
});

test("non-behaviour: the default apiBase still walks the local tier table, untouched by the model gate", async () => {
  const built = await build({ answer: LIST_WITH_MODEL, config: {} });
  assert.ok(built.probe.calls.length > 0, "the local hardware probe still runs on the default endpoint");
  assert.strictEqual(built.tier.id, "16gb-large-ram", "the reference box still resolves its table row");
  assert.strictEqual(built.stub.calls.length, 0, "and no model-list call is spent on localhost");
  built.service.dispose();
});
