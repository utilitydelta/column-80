// Implementer oracle: session-v56 phase 2 edges the blind contract file leaves
// open (roadmap item 58, "disabled means inert, everywhere"). The blind rows
// pin the GESTURES (refusal, reason, zero dials); these pin the defense-in-depth
// layer underneath - a disabled arm's service carries an INERT transport that
// rejects with the tier's recorded reason, on every arm, so a gate missed
// anywhere still cannot dial - plus the tighten handler's two gate branches the
// blind file cannot reach (tier-unresolved, and the served/refused seam past an
// open gate). Complements test/blind-v56-p2-disabled-inert.test.cjs, whose
// vscode-stub + bundle + injected-seam harness idiom is copied.
//
// Run: node --test test/impl-v56-p2-disabled-inert.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const esbuild = require("esbuild");

// ---------------------------------------------------------------------------
// bundle src/vscode/* against a stub `vscode`
// (mechanism copied from test/impl-v56-p1-remote-model-gate.test.cjs)
// ---------------------------------------------------------------------------

const STUB = path.join(__dirname, ".impl-v56-p2-stub.cjs");
fs.writeFileSync(
  STUB,
  `
const state = { config: {}, messages: [], commands: {}, activeTextEditor: undefined };
class EventEmitter {
  constructor() { this.handlers = []; }
  get event() { return (fn) => { this.handlers.push(fn); return { dispose() {} }; }; }
  fire(x) { for (const h of this.handlers) h(x); }
  dispose() {}
}
class Position { constructor(line, character) { this.line = line; this.character = character; } }
class Range { constructor(a, b) { this.start = a; this.end = b; } }
module.exports = {
  __state: state,
  EventEmitter, Position, Range,
  ThemeColor: class { constructor(id) { this.id = id; } },
  ProgressLocation: { Notification: 15, Window: 10 },
  ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
  SymbolKind: { Function: 11, Method: 5, Constructor: 8, Class: 4, Struct: 22, Enum: 9 },
  workspace: {
    getConfiguration: () => ({
      get: (key, fallback) => (key in state.config ? state.config[key] : fallback),
      inspect: () => undefined,
      update: async () => {},
    }),
    onDidChangeConfiguration: () => ({ dispose() {} }),
    registerTextDocumentContentProvider: () => ({ dispose() {} }),
    textDocuments: [],
  },
  window: {
    showInformationMessage: async (message, ...actions) => { state.messages.push({ kind: "info", message, actions }); return undefined; },
    showWarningMessage: async (message, ...actions) => { state.messages.push({ kind: "warn", message, actions }); return undefined; },
    showErrorMessage: async (message, ...actions) => { state.messages.push({ kind: "error", message, actions }); return undefined; },
    withProgress: async (opts, task) => task({ report: () => {} }, { onCancellationRequested: () => ({ dispose() {} }) }),
    get activeTextEditor() { return state.activeTextEditor; },
    tabGroups: { all: [], onDidChangeTabs: () => ({ dispose() {} }), close: async () => {} },
  },
  commands: { registerCommand: (id, fn) => { state.commands[id] = fn; return { dispose() {} }; } },
  Uri: { parse: (s) => s, file: (s) => ({ fsPath: s, toString: () => s }) },
};
`,
);

const entry = path.join(__dirname, ".impl-v56-p2.entry.ts");
const outfile = path.join(__dirname, ".impl-v56-p2.bundle.cjs");
fs.writeFileSync(
  entry,
  `export { buildFnGenService } from "../src/vscode/fnGen";
export { registerTightenDocComment } from "../src/vscode/tightenDocComment";
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
const { buildFnGenService, registerTightenDocComment, __state } = require(outfile);
test.after(() => {
  fs.rmSync(entry, { force: true });
  fs.rmSync(outfile, { force: true });
  fs.rmSync(STUB, { force: true });
});

// A fetch spy so an inert transport proven "rejecting" is also proven
// non-dialling, and a live one is proven live by its recorded dial. Ollama-
// shaped streaming reply so the live round parses instead of crashing.
const dials = [];
const enc = new TextEncoder();
const realFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  dials.push(String(url));
  const payload = enc.encode(JSON.stringify({ response: "ok\n", done: true, done_reason: "stop" }) + "\n");
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
  };
};
test.after(() => {
  globalThis.fetch = realFetch;
});

const REMOTE_HOST = "http://ml-box.invalid:11434";
const MODEL = "qwen3-coder:480b";
const MB = 1048576;

/** One build at the facade with the probe and model list injected. */
async function build({ config, probe, models }) {
  __state.config = { ...config };
  const log = [];
  const out = { lines: log, appendLine: (l) => log.push(l), append() {}, show() {}, clear() {}, dispose() {} };
  const probeOpts = {
    runCommand: async () => ({ stdout: probe?.stdout ?? "16303\n", exitCode: 0 }),
    totalMemBytes: () => (probe?.ramMB ?? 61826) * MB,
  };
  const built = await buildFnGenService(out, (l) => log.push(l), probeOpts, { listModels: async () => models });
  return { ...built, log };
}

/** A disabled arm's transport must reject with the tier's own recorded reason
 *  and touch no network. One assertion routine, four arms. */
async function assertInert(built, label) {
  assert.strictEqual(built.tier.fnGenEnabled, false, `${label}: the row needs a disabled tier`);
  assert.ok(typeof built.tier.message === "string" && built.tier.message !== "", `${label}: a disabled tier records its reason`);
  const before = dials.length;
  await assert.rejects(
    () => built.service.transport({ apiBase: REMOTE_HOST, model: MODEL, prompt: "x", maxTokens: 8, temperature: 0 }),
    (err) => {
      assert.ok(
        String(err && err.message).includes(built.tier.message),
        `${label}: the inert transport's rejection carries the tier reason ${JSON.stringify(built.tier.message)}, got ${String(err)}`,
      );
      return true;
    },
  );
  assert.deepStrictEqual(dials.slice(before), [], `${label}: an inert transport never dials`);
  built.service.dispose();
}

// ---------------------------------------------------------------------------
// the inert transport, arm by arm
// ---------------------------------------------------------------------------

test("remote arm, unreachable: the disabled service's transport rejects with the tier reason and never dials", async () => {
  const built = await build({
    config: { apiBase: REMOTE_HOST, fnGenModel: MODEL },
    models: undefined,
  });
  await assertInert(built, "remote-unreachable");
});

test("remote arm, model missing: the disabled service's transport rejects with the tier reason and never dials", async () => {
  const built = await build({
    config: { apiBase: REMOTE_HOST, fnGenModel: MODEL },
    models: [],
  });
  await assertInert(built, "remote-model-missing");
});

test("local arm, below-12gb: the disabled service's transport rejects with the tier reason and never dials", async () => {
  const built = await build({
    config: { fnGenModel: MODEL },
    probe: { stdout: "8192\n", ramMB: 61826 },
    models: [MODEL],
  });
  await assertInert(built, "local-below-12gb");
});

test("cloud arm, missing key: the disabled service's transport rejects with the tier reason and never dials", async () => {
  const built = await build({
    config: { fnGenProvider: "openai-compatible", cloudApiBase: "https://api.example.invalid/v1", cloudApiKey: "" },
    models: [MODEL],
  });
  await assertInert(built, "cloud-missing-key");
});

// ---------------------------------------------------------------------------
// the enabled arms stay live: the same construction, one flag apart, still
// hands out a dialling transport - the re-enable half of the ruling.
// ---------------------------------------------------------------------------

test("remote arm, enabled: the service's transport is live (a rebuild that re-enables gets a dialling service)", async () => {
  const built = await build({
    config: { apiBase: REMOTE_HOST, fnGenModel: MODEL },
    models: [MODEL],
  });
  assert.strictEqual(built.tier.fnGenEnabled, true);
  const before = dials.length;
  await built.service.transport({ apiBase: REMOTE_HOST, model: MODEL, prompt: "x", maxTokens: 8, temperature: 0, signal: new AbortController().signal });
  assert.ok(dials.length > before, "the enabled remote transport dials");
  built.service.dispose();
});

test("local arm, enabled: the service's transport is live", async () => {
  const built = await build({
    config: { fnGenModel: MODEL },
    probe: { stdout: "16303\n", ramMB: 61826 },
    models: [MODEL],
  });
  assert.strictEqual(built.tier.fnGenEnabled, true);
  const before = dials.length;
  await built.service.transport({ apiBase: "http://localhost:11434", model: MODEL, prompt: "x", maxTokens: 8, temperature: 0, signal: new AbortController().signal });
  assert.ok(dials.length > before, "the enabled local transport dials");
  built.service.dispose();
});

test("a disabled build keeps the live build's config shape (rebuild-on-config-change still re-derives everything)", async () => {
  const disabled = await build({ config: { apiBase: REMOTE_HOST, fnGenModel: MODEL }, models: [] });
  const enabled = await build({ config: { apiBase: REMOTE_HOST, fnGenModel: MODEL }, models: [MODEL] });
  assert.deepStrictEqual(disabled.config, enabled.config, "only the transport differs between the two builds");
  disabled.service.dispose();
  enabled.service.dispose();
});

// ---------------------------------------------------------------------------
// the tighten handler's gate branches the blind file cannot reach
// ---------------------------------------------------------------------------

const TIGHTEN = "column80.tightenDocComment";

function registerTighten({ gate, message }) {
  __state.commands = {};
  __state.messages = [];
  const log = [];
  const output = { lines: log, appendLine: (l) => log.push(l), append() {}, show() {}, clear() {}, dispose() {} };
  const calls = { transport: 0, resolveFunction: 0 };
  registerTightenDocComment({ subscriptions: [] }, output, {
    presenter: { confirmDiff: async () => "reject" },
    resolveFunction: async () => {
      calls.resolveFunction++;
      return undefined;
    },
    resolvePrefill: async () => undefined,
    prefillLangFor: () => undefined,
    extractorFor: () => undefined,
    transport: () => {
      calls.transport++;
      return async () => ({ text: "", ttftMs: 1, totalMs: 1 });
    },
    modelTag: () => "test-model",
    tierGate: async () => gate,
    tierMessage: () => message,
  });
  return { calls, log };
}

test("tighten handler: a tier-unresolved gate refuses with the Select Hardware Tier remedy, transport untouched", async () => {
  const rig = registerTighten({ gate: { allowed: false, reason: "tier-unresolved" }, message: undefined });
  __state.activeTextEditor = { document: { languageId: "typescript" }, selection: { active: { line: 0, character: 0 } } };
  await __state.commands[TIGHTEN]();
  const warned = __state.messages.map((m) => m.message).join(" | ");
  assert.match(warned, /Select Hardware Tier/, `the unresolved refusal names the remedy, got ${JSON.stringify(warned)}`);
  assert.strictEqual(rig.calls.transport, 0, "the transport thunk is never read on a refused gesture");
  assert.strictEqual(rig.calls.resolveFunction, 0, "no work precedes the gate");
  assert.ok(rig.log.some((l) => l.includes("[tighten] refused: tier tier-unresolved")), `the channel records the refusal, got ${JSON.stringify(rig.log)}`);
});

test("tighten handler: a disabled gate surfaces the tier's recorded reason verbatim", async () => {
  const reason = "Function generation is disabled: the Ollama server at http://ml-box.invalid:11434 did not answer. FIM tab-completion still works.";
  const rig = registerTighten({ gate: { allowed: false, reason: "tier-disabled" }, message: reason });
  __state.activeTextEditor = { document: { languageId: "typescript" }, selection: { active: { line: 0, character: 0 } } };
  await __state.commands[TIGHTEN]();
  assert.ok(
    __state.messages.some((m) => typeof m.message === "string" && m.message.includes(reason)),
    `the refusal carries the tier reason, got ${JSON.stringify(__state.messages)}`,
  );
  assert.strictEqual(rig.calls.transport, 0, "the transport thunk is never read on a refused gesture");
});

test("tighten handler: an open gate proceeds into the pipeline (the pre-gate behaviour is unchanged)", async () => {
  const rig = registerTighten({ gate: { allowed: true }, message: undefined });
  // An unserved language: the pipeline's own first refusal, proof the handler
  // got PAST the gate without needing the whole fixture the blind file drives.
  __state.activeTextEditor = { document: { languageId: "plaintext" }, selection: { active: { line: 0, character: 0 } } };
  await __state.commands[TIGHTEN]();
  const warned = __state.messages.map((m) => m.message).join(" | ");
  assert.match(warned, /does not serve plaintext/, `the pipeline's own refusal fires, got ${JSON.stringify(warned)}`);
  assert.ok(!/disabled/.test(warned), "an open gate never tells a disabled story");
});
