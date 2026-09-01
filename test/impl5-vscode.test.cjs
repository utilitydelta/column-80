// Implementer oracle: the phase-5 vscode layer, bundled against a stub
// `vscode` module. Covers the structural half of never-auto-pull (ruling 6:
// offerModelPull is the sole pull path in the vscode layer, the ratify line
// is on the record BEFORE the request starts, and every [carve] pull line
// matches the surface's format list), tier override plumbing through
// readTierConfig/resolveTier, the first-run flow with injected fakes, and
// the P2-F12 seam: readFnGenConfig no longer hardcodes the carve and
// buildFnGenService derives it from the resolved tier.
//
// Run: npm test

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");

// ---- structural never-auto-pull [surface: 'Never-auto-pull, as a contract' + ruling 6]

const SRC = path.join(__dirname, "..", "src");
const read = (...p) => fs.readFileSync(path.join(SRC, ...p), "utf8");
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

test("structural: no vscode-layer file except firstRun.ts references pullModel at all", () => {
  const offenders = fs
    .readdirSync(path.join(SRC, "vscode"))
    .filter((f) => f.endsWith(".ts") && f !== "firstRun.ts")
    .filter((f) => read("vscode", f).includes("pullModel"));
  assert.deepStrictEqual(offenders, []);
});

test("structural: core contains no pullModel call site outside its definition module", () => {
  const offenders = fs
    .readdirSync(path.join(SRC, "core"))
    .filter((f) => f.endsWith(".ts") && f !== "ollama.ts")
    .filter((f) => read("core", f).includes("pullModel"));
  assert.deepStrictEqual(offenders, []);
});

test("structural: within firstRun.ts every pullModel reference is the import, the deps seam type, or inside offerModelPull", () => {
  const code = stripComments(read("vscode", "firstRun.ts"));
  const withoutImport = code.replace(/import\s*\{[^}]*\}\s*from\s*"\.\.\/core\/ollama";/, "");
  const withoutDepsType = withoutImport.replace(/pull\?\s*:\s*typeof pullModel;/, "");
  const bodyStart = withoutDepsType.indexOf("export async function offerModelPull");
  assert.ok(bodyStart >= 0, "offerModelPull exists");
  const bodyEnd = withoutDepsType.indexOf("\nconst isAbort", bodyStart);
  assert.ok(bodyEnd > bodyStart, "offerModelPull body delimits before its helpers");
  const outside = withoutDepsType.slice(0, bodyStart) + withoutDepsType.slice(bodyEnd);
  assert.ok(!outside.includes("pullModel"), "no pull path outside offerModelPull");
  assert.ok(withoutDepsType.slice(bodyStart, bodyEnd).includes("pullModel"), "offerModelPull is where the default binds");
});

test("structural: the settings enum is exactly auto + the four tier ids, in table order", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(SRC, "..", "package.json"), "utf8"));
  assert.deepStrictEqual(pkg.contributes.configuration.properties["column80.hardwareTier"].enum, [
    "auto",
    "24gb",
    "16gb-large-ram",
    "16gb-low-ram",
    "below-12gb",
  ]);
});

// ---- bundle the layer against a stub vscode

const STUB = path.join(__dirname, ".impl5-vscode-stub.cjs");
fs.writeFileSync(
  STUB,
  `
const state = {
  config: {},        // effective values by key
  configInfo: {},    // inspect() answers by key
  updates: [],       // recorded configuration update() calls
  messages: [],      // every notification shown
  infoResponses: [], // queued showInformationMessage answers
  warnResponses: [],
  errorResponses: [], // queued showErrorMessage answers
  opened: [],         // env.openExternal URIs
  quickPickImpl: null,
  commands: {},
  terminals: [],
};
class EventEmitter {
  constructor() { this.handlers = []; }
  get event() { return (fn) => { this.handlers.push(fn); return { dispose() {} }; }; }
  fire(x) { for (const h of this.handlers) h(x); }
  dispose() {}
}
module.exports = {
  __state: state,
  EventEmitter,
  ProgressLocation: { Notification: 15 },
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
    showInformationMessage: async (message, ...actions) => {
      state.messages.push({ kind: "info", message, actions });
      return state.infoResponses.shift();
    },
    showWarningMessage: async (message, ...actions) => {
      state.messages.push({ kind: "warn", message, actions });
      return state.warnResponses.shift();
    },
    showErrorMessage: async (message, ...actions) => {
      state.messages.push({ kind: "error", message, actions });
      return state.errorResponses.shift();
    },
    showQuickPick: async (items, opts) => (state.quickPickImpl ? state.quickPickImpl(items, opts) : undefined),
    withProgress: async (opts, task) =>
      task({ report: () => {} }, { onCancellationRequested: () => ({ dispose() {} }) }),
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
  },
  env: {
    openExternal: async (uri) => { state.opened.push(String(uri)); return true; },
  },
  Uri: { parse: (s) => s },
};
`,
);

const entry = path.join(__dirname, ".impl5-vscode.entry.ts");
const outfile = path.join(__dirname, ".impl5-vscode.bundle.cjs");
fs.writeFileSync(
  entry,
  `export { warnIfFimNotReady, resolveToggleWhileEnabled } from "../src/vscode/extension";
export { runFirstRunFlow, resolveTier, offerModelPull, registerFirstRun } from "../src/vscode/firstRun";
export { readTierConfig, readFnGenConfig } from "../src/vscode/config";
export { buildFnGenService } from "../src/vscode/fnGen";
export { computeTier } from "../src/core/tiers";
export { DEFAULT_FNGEN_CONFIG, REFERENCE_CARVE_NUM_GPU } from "../src/core/config";
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
const {
  warnIfFimNotReady,
  resolveToggleWhileEnabled,
  runFirstRunFlow,
  resolveTier,
  offerModelPull,
  registerFirstRun,
  readTierConfig,
  readFnGenConfig,
  buildFnGenService,
  DEFAULT_FNGEN_CONFIG,
  REFERENCE_CARVE_NUM_GPU,
  __state,
} = require(outfile);
test.after(() => {
  fs.rmSync(entry, { force: true });
  fs.rmSync(outfile, { force: true });
  fs.rmSync(STUB, { force: true });
});

// Ollama IS on PATH: `ollama --version` exits 0. Injected so the "Start ollama
// serve" consent path opens the terminal deterministically (without spawning a
// real process or depending on a host ollama). The not-installed path is proven
// separately in test/impl-v8-apple-silicon (ollamaInstalled) + below.
const OLLAMA_INSTALLED = async () => ({ stdout: "ollama version 0.0.0", exitCode: 0 });
const OLLAMA_ABSENT = async () => {
  throw Object.assign(new Error("spawn ollama ENOENT"), { code: "ENOENT" });
};

const FIM_MODEL = "qwen2.5-coder:1.5b-base";
const MODEL_30B = "qwen3-coder:30b";
const MODEL_14B = "qwen2.5-coder:14b-instruct-q4_K_M";

const resetState = () => {
  __state.config = {};
  __state.configInfo = {};
  __state.updates = [];
  __state.messages = [];
  __state.infoResponses = [];
  __state.warnResponses = [];
  __state.errorResponses = [];
  __state.opened = [];
  __state.quickPickImpl = null;
  __state.commands = {};
  __state.terminals = [];
};

const output = () => {
  const lines = [];
  return { lines, appendLine: (l) => lines.push(l) };
};

// Injected reference-box probe: the values the surface captured live.
const referenceProbe = () => ({
  runCommand: async () => ({ stdout: "16303\n", exitCode: 0 }),
  totalMemBytes: () => 61826 * 1048576,
  platformInfo: () => ({ platform: "linux", arch: "x64" }),
});
const noGpuProbe = () => ({
  runCommand: async () => {
    throw Object.assign(new Error("spawn nvidia-smi ENOENT"), { code: "ENOENT" });
  },
  totalMemBytes: () => 61826 * 1048576,
  platformInfo: () => ({ platform: "linux", arch: "x64" }),
});

// A pull fake that records the evidence lines already emitted at request
// time - the ratify-before-request ordering assert hangs on this capture.
const recordingPull = (out, behavior) => {
  const calls = [];
  const pull = async (apiBase, model, signal, onProgress) => {
    calls.push({ apiBase, model, isSignal: signal instanceof AbortSignal, linesAtCall: [...out.lines] });
    onProgress(undefined, "pulling manifest");
    onProgress(0.5, "pulling sha256:aaa");
    onProgress(1, "success");
    if (behavior instanceof Error) throw behavior;
  };
  return { calls, pull };
};

const fakeContext = () => {
  const store = {};
  return {
    subscriptions: [],
    globalState: {
      get: (k) => store[k],
      update: async (k, v) => {
        store[k] = v;
      },
    },
  };
};

const waitFor = async (predicate, what) => {
  for (let i = 0; i < 200; i++) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.fail(`timed out waiting for ${what}`);
};

// ---- offerModelPull: the ratify sequence [surface: 'Never-auto-pull, as a contract' 1-3]

test("decline: offered then declined lines byte-shaped per the surface, the pull fn never runs, nothing changes", async () => {
  resetState();
  const out = output();
  __state.infoResponses = [undefined]; // dismissed = declined
  const { calls, pull } = recordingPull(out);
  const landed = await offerModelPull("http://x:1", MODEL_30B, out, "function generation needs its model", { pull });
  assert.strictEqual(landed, false);
  assert.deepStrictEqual(out.lines, [
    `[carve] pull offered model=${MODEL_30B} why=function generation needs its model`,
    `[carve] pull declined model=${MODEL_30B}`,
  ]);
  assert.deepStrictEqual(calls, [], "no download without the ratify click");
});

test("Download click: the ratified line is on the record BEFORE the request starts; done line carries integer ms", async () => {
  resetState();
  const out = output();
  __state.infoResponses = ["Download"];
  const { calls, pull } = recordingPull(out);
  const landed = await offerModelPull("http://x:1", MODEL_30B, out, "w", { pull });
  assert.strictEqual(landed, true);
  assert.strictEqual(calls.length, 1, "exactly one pull request");
  assert.strictEqual(calls[0].model, MODEL_30B);
  assert.ok(calls[0].isSignal, "the pull gets a real AbortSignal - no default-argument path in the caller either");
  assert.strictEqual(
    calls[0].linesAtCall[calls[0].linesAtCall.length - 1],
    `[carve] pull ratified model=${MODEL_30B}`,
    "ratify precedes the request, structurally: it was the last line at request time"
  );
  assert.strictEqual(out.lines[0], `[carve] pull offered model=${MODEL_30B} why=w`);
  assert.strictEqual(out.lines[1], `[carve] pull ratified model=${MODEL_30B}`);
  assert.match(out.lines[2], new RegExp(`^\\[carve\\] pull done model=${MODEL_30B} ms=\\d+$`));
  assert.strictEqual(out.lines.length, 3);
});

test("pull failure: [carve] pull failed with the error text; returns false", async () => {
  resetState();
  const out = output();
  __state.infoResponses = ["Download"];
  const { pull } = recordingPull(out, new Error("pull model manifest: file does not exist"));
  const landed = await offerModelPull("http://x:1", MODEL_14B, out, "w", { pull });
  assert.strictEqual(landed, false);
  assert.strictEqual(out.lines[2], `[carve] pull failed model=${MODEL_14B}: pull model manifest: file does not exist`);
});

test("pull cancel: an abort rejection logs [carve] pull cancelled, not failed", async () => {
  resetState();
  const out = output();
  __state.infoResponses = ["Download"];
  const abortErr = new Error("The operation was aborted");
  abortErr.name = "AbortError";
  const { pull } = recordingPull(out, abortErr);
  const landed = await offerModelPull("http://x:1", MODEL_30B, out, "w", { pull });
  assert.strictEqual(landed, false);
  assert.strictEqual(out.lines[2], `[carve] pull cancelled model=${MODEL_30B}`);
});

// ---- readTierConfig / readFnGenConfig: the settings half of the seam

test("readTierConfig: defaults to auto/non-explicit; garbage tier values degrade to auto", () => {
  resetState();
  assert.deepStrictEqual(readTierConfig(), { hardwareTier: "auto", explicitFnGenModel: false });
  __state.config = { hardwareTier: "48gb-imagined" };
  assert.strictEqual(readTierConfig().hardwareTier, "auto");
  __state.config = { hardwareTier: "16gb-low-ram" };
  assert.strictEqual(readTierConfig().hardwareTier, "16gb-low-ram");
});

test("readTierConfig: explicitFnGenModel means a human wrote a NON-EMPTY value in some scope", () => {
  resetState();
  __state.configInfo = { fnGenModel: { globalValue: "llama3.1:70b-instruct" } };
  assert.strictEqual(readTierConfig().explicitFnGenModel, true);
  __state.configInfo = { fnGenModel: { globalValue: "  " } };
  assert.strictEqual(readTierConfig().explicitFnGenModel, false, "a cleared settings field is an un-choice");
  __state.configInfo = { fnGenModel: { workspaceValue: MODEL_30B } };
  assert.strictEqual(readTierConfig().explicitFnGenModel, true, "explicit even when the value equals the default tag");
});

test("SEAM: readFnGenConfig no longer hardcodes the carve - numGpu comes from applyTier alone", () => {
  resetState();
  const cfg = readFnGenConfig();
  assert.strictEqual(cfg.numGpu, undefined, "the P2-F12 constant read is gone");
  assert.ok(!("numGpu" in cfg), "key-absent per ruling 3");
  assert.strictEqual(cfg.model, MODEL_30B);
  assert.strictEqual(cfg.fallbackModel, MODEL_14B);
});

// ---- resolveTier: override plumbing [surface: 'resolveTier is the per-session resolution']

test("resolveTier auto on reference values: probe evidence then tier line reason=auto, carve 30", async () => {
  resetState();
  const out = output();
  const { selection } = await resolveTier(out, referenceProbe());
  assert.strictEqual(selection.id, "16gb-large-ram");
  assert.strictEqual(selection.fnGenNumGpu, REFERENCE_CARVE_NUM_GPU);
  assert.deepStrictEqual(out.lines, [
    "[carve] probe vram=16303 ram=61826",
    "[carve] tier=16gb-large-ram reason=auto vram=16303 ram=61826 numGpu=30 fnGen=qwen3-coder:30b provisional=false",
  ]);
});

test("resolveTier override: the setting supplies the tier, reason=override, probe values still render", async () => {
  resetState();
  __state.config = { hardwareTier: "below-12gb" };
  const out = output();
  const { selection } = await resolveTier(out, referenceProbe());
  assert.strictEqual(selection.id, "below-12gb");
  assert.strictEqual(selection.fnGenEnabled, false);
  assert.match(selection.message, /hardwareTier setting/, "the honest reason is the human's own setting, not a hardware claim");
  assert.strictEqual(
    out.lines[1],
    "[carve] tier=below-12gb reason=override vram=16303 ram=61826 numGpu=- fnGen=disabled provisional=false"
  );
});

test("resolveTier override to the carve row rides the row's carve regardless of probed values", async () => {
  resetState();
  __state.config = { hardwareTier: "16gb-large-ram" };
  const out = output();
  const { selection } = await resolveTier(out, noGpuProbe());
  assert.strictEqual(selection.id, "16gb-large-ram");
  assert.strictEqual(selection.fnGenNumGpu, 30);
  assert.strictEqual(
    out.lines[2],
    "[carve] tier=16gb-large-ram reason=override vram=- ram=61826 numGpu=30 fnGen=qwen3-coder:30b provisional=false"
  );
});

// ---- buildFnGenService: the computed carve reaches the fn-gen service

test("SEAM: buildFnGenService on auto + reference probe hands the service the tier-computed carve", async () => {
  resetState();
  const out = output();
  const built = await buildFnGenService(out, () => {}, referenceProbe());
  assert.strictEqual(built.tier.id, "16gb-large-ram");
  assert.strictEqual(built.config.model, MODEL_30B);
  assert.strictEqual(built.config.numGpu, 30, "computed by applyTier, not read from a constant");
  assert.ok(built.service && typeof built.service.generate === "function", "a real FnGenService was built on that config");
  built.service.dispose();
});

test("SEAM: an explicit foreign fnGenModel keeps the human's tag and drops the carve on the way to the service", async () => {
  resetState();
  __state.config = { fnGenModel: "llama3.1:70b-instruct" };
  __state.configInfo = { fnGenModel: { globalValue: "llama3.1:70b-instruct" } };
  const built = await buildFnGenService(output(), () => {}, referenceProbe());
  assert.strictEqual(built.config.model, "llama3.1:70b-instruct");
  assert.ok(!("numGpu" in built.config), "no mis-carve rides a foreign tag");
  built.service.dispose();
});

test("SEAM: hardwareTier override 16gb-low-ram routes the service to the fallback 14b with no carve", async () => {
  resetState();
  __state.config = { hardwareTier: "16gb-low-ram" };
  const built = await buildFnGenService(output(), () => {}, referenceProbe());
  assert.strictEqual(built.tier.id, "16gb-low-ram");
  assert.strictEqual(built.config.model, MODEL_14B);
  assert.ok(!("numGpu" in built.config));
  built.service.dispose();
});

test("SEAM: disabled tier hands the service a field-identical base config; the gate lives at the command, not in config surgery", async () => {
  resetState();
  __state.config = { hardwareTier: "below-12gb" };
  const built = await buildFnGenService(output(), () => {}, referenceProbe());
  assert.strictEqual(built.tier.fnGenEnabled, false);
  assert.deepStrictEqual(built.config, { ...DEFAULT_FNGEN_CONFIG });
  built.service.dispose();
});

// ---- runFirstRunFlow with injected fakes [surface: 'First-run flow']

test("first-run, accept the detected default: hardwareTier stays auto (no settings write), present models mean no pull offer", async () => {
  resetState();
  const out = output();
  __state.quickPickImpl = async (items) => {
    assert.strictEqual(items.length, 5, "detected default + all four tiers");
    assert.strictEqual(items[0].value, "auto");
    assert.match(items[0].label, /16gb-large-ram/);
    assert.match(items[1].detail, /provisional/, "the 24gb item says provisional honestly");
    return items[0];
  };
  await runFirstRunFlow(fakeContext(), out, {
    probe: referenceProbe(),
    listModels: async () => [FIM_MODEL, MODEL_30B],
  });
  assert.deepStrictEqual(__state.updates, [], "accepting the computed default keeps auto so hardware changes re-adapt");
  assert.ok(!out.lines.some((l) => l.includes("pull offered")), "nothing missing, nothing offered");
});

test("first-run, missing fn-gen model, Download: offered -> ratified -> done for exactly the missing model", async () => {
  resetState();
  const out = output();
  __state.quickPickImpl = async (items) => items[0];
  __state.infoResponses = ["Download"];
  const { calls, pull } = recordingPull(out);
  await runFirstRunFlow(fakeContext(), out, {
    probe: referenceProbe(),
    listModels: async () => [FIM_MODEL],
    pull,
  });
  const pullLines = out.lines.filter((l) => l.startsWith("[carve] pull"));
  assert.strictEqual(pullLines[0], `[carve] pull offered model=${MODEL_30B} why=function generation on the 16gb-large-ram tier needs its model`);
  assert.strictEqual(pullLines[1], `[carve] pull ratified model=${MODEL_30B}`);
  assert.match(pullLines[2], /^\[carve\] pull done model=qwen3-coder:30b ms=\d+$/);
  assert.strictEqual(pullLines.length, 3);
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(
    calls[0].linesAtCall[calls[0].linesAtCall.length - 1],
    `[carve] pull ratified model=${MODEL_30B}`,
    "ratify-before-request holds inside the flow too"
  );
});

test("first-run, decline the fn-gen download: declined line, then the honest fn-gen disabled statement naming the fix", async () => {
  resetState();
  const out = output();
  __state.quickPickImpl = async (items) => items[0];
  __state.infoResponses = [undefined];
  const { calls, pull } = recordingPull(out);
  await runFirstRunFlow(fakeContext(), out, {
    probe: referenceProbe(),
    listModels: async () => [FIM_MODEL],
    pull,
  });
  assert.deepStrictEqual(calls, []);
  assert.ok(out.lines.includes(`[carve] pull declined model=${MODEL_30B}`));
  const disabled = out.lines.find((l) => l.startsWith("[carve] fn-gen disabled: "));
  assert.ok(disabled, `got ${JSON.stringify(out.lines)}`);
  assert.match(disabled, /qwen3-coder:30b/, "names what is missing");
  assert.match(disabled, /Select Hardware Tier/, "names the one-click that fixes it");
  assert.match(disabled, /FIM tab-completion still works/, "names what still works");
});

test("first-run, explicit override pick: tier id persists to settings, override evidence logged, the OVERRIDE tier's model is what gets offered", async () => {
  resetState();
  const out = output();
  __state.quickPickImpl = async (items) => items.find((i) => i.value === "16gb-low-ram");
  __state.infoResponses = [undefined];
  const { pull } = recordingPull(out);
  await runFirstRunFlow(fakeContext(), out, {
    probe: referenceProbe(),
    listModels: async () => [FIM_MODEL, MODEL_30B],
    pull,
  });
  assert.deepStrictEqual(
    __state.updates.map((u) => ({ key: u.key, value: u.value })),
    [{ key: "hardwareTier", value: "16gb-low-ram" }]
  );
  assert.ok(out.lines.some((l) => l.startsWith("[carve] tier=16gb-low-ram reason=override ")));
  assert.ok(
    out.lines.includes(`[carve] pull offered model=${MODEL_14B} why=function generation on the 16gb-low-ram tier needs its model`),
    `the 14b is the missing one under the override, got ${JSON.stringify(out.lines)}`
  );
});

test("first-run on a no-GPU box: below-12gb honesty path, no fn-gen model asked for, byte-exact disable message surfaced", async () => {
  resetState();
  const out = output();
  __state.quickPickImpl = async (items) => items[0];
  const { calls, pull } = recordingPull(out);
  await runFirstRunFlow(fakeContext(), out, {
    probe: noGpuProbe(),
    listModels: async () => [FIM_MODEL],
    pull,
  });
  assert.ok(
    out.lines.includes(
      "[carve] fn-gen disabled: Function generation is disabled: no usable GPU detected. It needs at least 12GB of VRAM. FIM tab-completion still works."
    ),
    `got ${JSON.stringify(out.lines)}`
  );
  assert.deepStrictEqual(calls, [], "FIM is present and fn-gen is disabled: nothing to pull");
});

test("first-run, server down: models cannot be checked, Start ollama serve opens a visible terminal, no pull is ever offered", async () => {
  resetState();
  const out = output();
  __state.quickPickImpl = async (items) => items[0];
  __state.warnResponses = ["Start ollama serve"];
  const { calls, pull } = recordingPull(out);
  await runFirstRunFlow(fakeContext(), out, {
    probe: referenceProbe(),
    listModels: async () => undefined,
    pull,
    ollamaCheck: OLLAMA_INSTALLED,
  });
  assert.deepStrictEqual(calls, []);
  assert.ok(!out.lines.some((l) => l.includes("pull offered")));
  assert.strictEqual(__state.terminals.length, 1);
  assert.strictEqual(__state.terminals[0].shown, true);
  assert.deepStrictEqual(__state.terminals[0].sent, ["ollama serve"], "user-initiated only");
});

// Enabling FIM autocomplete when the pieces that make ghost text appear are
// missing must offer the fix, not flip the setting into silence. The branch
// on listModels: undefined = server down (offer Start), [] / no-FIM = model
// absent (point at the download), model present = stay quiet.
test("warnIfFimNotReady, server down: offers Start ollama serve and opens the terminal on consent", async () => {
  resetState();
  const out = output();
  __state.warnResponses = ["Start ollama serve"];
  await warnIfFimNotReady(out, async () => undefined, OLLAMA_INSTALLED);
  assert.strictEqual(__state.terminals.length, 1, "the server-start gesture is user-ratified");
  assert.deepStrictEqual(__state.terminals[0].sent, ["ollama serve"]);
  const warn = __state.messages.find((m) => m.kind === "warn");
  assert.match(warn.message, /server isn't running/);
});

test("Start ollama serve when the CLI is NOT installed: no terminal, an error that points at the installer", async () => {
  resetState();
  const out = output();
  __state.warnResponses = ["Start ollama serve"]; // consent to start
  __state.errorResponses = ["Install Ollama"]; // then click through to the installer
  await warnIfFimNotReady(out, async () => undefined, OLLAMA_ABSENT);
  assert.strictEqual(__state.terminals.length, 0, "no doomed `ollama serve` terminal when the CLI is absent");
  const err = __state.messages.find((m) => m.kind === "error");
  assert.ok(err, "an error names the missing install");
  assert.match(err.message, /isn't installed/);
  assert.deepStrictEqual(err.actions, ["Install Ollama"]);
  assert.ok(__state.opened.some((u) => u.includes("ollama.com")), "the installer page opens on consent");
  assert.ok(out.lines.some((l) => l.includes("ollama not found on PATH")), "the reason is on the record");
});

test("warnIfFimNotReady, server down but declined: no terminal is ever spawned", async () => {
  resetState();
  const out = output();
  __state.warnResponses = [undefined]; // dismissed the warning
  await warnIfFimNotReady(out, async () => undefined);
  assert.strictEqual(__state.terminals.length, 0, "no spawn without the click");
});

test("warnIfFimNotReady, server up but FIM model absent: points at the download, spawns nothing", async () => {
  resetState();
  __state.config = { fimModel: FIM_MODEL };
  const out = output();
  await warnIfFimNotReady(out, async () => [MODEL_30B]); // server answers, but no FIM model
  assert.strictEqual(__state.terminals.length, 0);
  const info = __state.messages.find((m) => m.kind === "info");
  assert.ok(info.message.includes(FIM_MODEL), "names the missing model so the user knows what to pull");
  assert.match(info.message, /isn't installed/);
  assert.match(info.message, /Select Hardware Tier/);
});

test("warnIfFimNotReady, everything ready: stays completely quiet", async () => {
  resetState();
  __state.config = { fimModel: FIM_MODEL };
  const out = output();
  await warnIfFimNotReady(out, async () => [FIM_MODEL, MODEL_30B]);
  assert.strictEqual(__state.terminals.length, 0);
  assert.strictEqual(__state.messages.length, 0, "no nagging when the pieces are all present");
});

// The two-press bug: toggling while autocomplete was already on-but-silent
// (server down) used to just flip it off, so the "start the server" prompt was
// only reachable on a SECOND toggle. resolveToggleWhileEnabled makes the fix
// reachable in one press while keeping disable one press away too.
test("resolveToggleWhileEnabled, on-but-server-down: one press offers Start (leaves enabled), not a silent flip-off", async () => {
  resetState();
  const out = output();
  __state.warnResponses = ["Start ollama serve"];
  const decision = await resolveToggleWhileEnabled(out, async () => undefined, OLLAMA_INSTALLED);
  assert.strictEqual(decision, "leave-enabled", "the setting stays on; the toggle didn't disable a fixable feature");
  assert.strictEqual(__state.terminals.length, 1, "one press reaches the server start");
  assert.deepStrictEqual(__state.terminals[0].sent, ["ollama serve"]);
  const warn = __state.messages.find((m) => m.kind === "warn");
  assert.deepStrictEqual(warn.actions, ["Start ollama serve", "Disable autocomplete"], "both intents in one prompt");
});

test("resolveToggleWhileEnabled, on-but-server-down, user picks Disable: turns off in one press, no terminal", async () => {
  resetState();
  const out = output();
  __state.warnResponses = ["Disable autocomplete"];
  const decision = await resolveToggleWhileEnabled(out, async () => undefined);
  assert.strictEqual(decision, "disable", "disabling stays reachable in a single press");
  assert.strictEqual(__state.terminals.length, 0);
});

test("resolveToggleWhileEnabled, on-but-server-down, dismissed: leaves enabled, spawns nothing", async () => {
  resetState();
  const out = output();
  __state.warnResponses = [undefined];
  const decision = await resolveToggleWhileEnabled(out, async () => undefined);
  assert.strictEqual(decision, "leave-enabled");
  assert.strictEqual(__state.terminals.length, 0);
});

test("resolveToggleWhileEnabled, working normally: a toggle press disables, no prompt", async () => {
  resetState();
  __state.config = { fimModel: FIM_MODEL };
  const out = output();
  const decision = await resolveToggleWhileEnabled(out, async () => [FIM_MODEL]);
  assert.strictEqual(decision, "disable", "when it actually works, toggle just turns it off");
  assert.strictEqual(__state.messages.length, 0, "no interruption on a healthy turn-off");
});

test("resolveToggleWhileEnabled, on-but-model-missing: offers disable and names the download, spawns nothing", async () => {
  resetState();
  __state.config = { fimModel: FIM_MODEL };
  const out = output();
  __state.warnResponses = ["Disable autocomplete"];
  const decision = await resolveToggleWhileEnabled(out, async () => [MODEL_30B]);
  assert.strictEqual(decision, "disable");
  assert.strictEqual(__state.terminals.length, 0);
  const warn = __state.messages.find((m) => m.kind === "warn");
  assert.ok(warn.message.includes(FIM_MODEL));
  assert.match(warn.message, /Select Hardware Tier/);
});

test("P5-F7: the server-down branch names the re-run gesture in the notification AND the channel, matching the decline path's wording", async () => {
  resetState();
  const out = output();
  __state.quickPickImpl = async (items) => items[0];
  // Both shapes: user starts the server, and user dismisses the warning -
  // neither may strand the flow without the way back on the record.
  for (const response of ["Start ollama serve", undefined]) {
    out.lines.length = 0;
    __state.messages.length = 0;
    __state.warnResponses = [response];
    await runFirstRunFlow(fakeContext(), out, {
      probe: referenceProbe(),
      listModels: async () => undefined,
    });
    const warn = __state.messages.find((m) => m.kind === "warn" && /server is not answering/.test(m.message));
    assert.ok(warn, "the warning notification exists");
    assert.match(warn.message, /run "Column 80: Select Hardware Tier"/, "notification names the re-run gesture");
    const channel = out.lines.find((l) => l.startsWith("[carve] tier flow incomplete: server down"));
    assert.ok(channel, `the channel carries the incomplete-flow line, got ${JSON.stringify(out.lines)}`);
    assert.match(channel, /run "Column 80: Select Hardware Tier"/, "channel names the re-run gesture");
  }
});

test("first-run dismissed at the QuickPick: nothing persists, nothing downloads, no disable claim", async () => {
  resetState();
  const out = output();
  __state.quickPickImpl = async () => undefined;
  const { calls, pull } = recordingPull(out);
  await runFirstRunFlow(fakeContext(), out, {
    probe: referenceProbe(),
    listModels: async () => [],
    pull,
  });
  assert.deepStrictEqual(__state.updates, []);
  assert.deepStrictEqual(calls, []);
  assert.ok(!out.lines.some((l) => l.includes("pull offered")));
});

// ---- registerFirstRun: once per install + always-on command

test("registerFirstRun: activation runs the flow once per install; a second activation stays quiet; the command re-runs on demand", async () => {
  resetState();
  const context = fakeContext();
  const out = output();
  __state.quickPickImpl = async () => undefined; // dismiss: flow ends after the tier evidence
  // P5-F9 rider: the probe is injected, so this test (and through it the
  // unit suite's registerFirstRun path) never spawns host nvidia-smi.
  const deps = { probe: referenceProbe(), listModels: async () => [FIM_MODEL, MODEL_30B] };
  registerFirstRun(context, out, deps);
  await waitFor(() => out.lines.some((l) => l.startsWith("[carve] tier=")), "the activation-time first run");
  const linesAfterFirst = out.lines.length;

  registerFirstRun(context, out, deps); // same install: the globalState gate holds
  await new Promise((r) => setTimeout(r, 50));
  assert.strictEqual(out.lines.length, linesAfterFirst, "no second automatic flow");

  assert.ok(__state.commands["column80.selectHardwareTier"], "the command is registered");
  await __state.commands["column80.selectHardwareTier"]();
  assert.ok(out.lines.length > linesAfterFirst, "on-demand re-run works forever");
  assert.deepStrictEqual(
    out.lines.filter((l) => l.startsWith("[carve] probe vram=")),
    ["[carve] probe vram=16303 ram=61826", "[carve] probe vram=16303 ram=61826"],
    "every probe in this test came from the injected fake, never host hardware"
  );
});

// ---- session-v55 phase 2: the remote apiBase arm reaches the FLOW, not just
// the build [surface: 'First-run flow', roadmap item 19]
//
// buildFnGenService grew a remote arm and runFirstRunFlow did not, so on a
// remote apiBase a user was told BOTH "no usable GPU detected" (here, at
// activation and on every Select Hardware Tier) and "tier=remote fnGen=enabled"
// (by the build). The first sentence is the one item 19 exists to stop
// printing, and this is where a user meets it first.

const REMOTE_HOST = "http://ml-box.invalid:11434";

test("remote apiBase: the flow does not tell a user with a GPU server that they have no usable GPU", async () => {
  resetState();
  __state.config = { apiBase: REMOTE_HOST };
  __state.quickPickImpl = async (items) => items[0];
  const out = output();
  await runFirstRunFlow(fakeContext(), out, {
    probe: noGpuProbe(),
    listModels: async () => [FIM_MODEL],
  });
  const shown = __state.messages.map((m) => m.message).join("\n");
  assert.ok(
    !/no usable GPU/i.test(shown),
    `must not blame local VRAM when the model is served elsewhere: ${JSON.stringify(__state.messages)}`
  );
  assert.ok(
    !out.lines.some((l) => l.startsWith("[carve] fn-gen disabled: ")),
    "and must not log the local disabled line either"
  );
  assert.ok(
    out.lines.includes(`[carve] fn-gen backend=remote host=${REMOTE_HOST} (no local fn-gen model pull)`),
    `the channel names which backend suppressed it: ${JSON.stringify(out.lines)}`
  );
});

test("remote apiBase: the LOCAL tier row's model is never offered to somebody else's server", async () => {
  resetState();
  // A 16GB box, so the tier resolves and fn-gen is locally "enabled". This is
  // the case where the flow offered to download qwen3-coder:30b - this box's
  // tier row - onto the remote host, citing this box's tier as the reason,
  // while the service was coming up on the user's own fnGenModel.
  // fnGenModel is set but NOT explicit (no configInfo entry), which is the
  // case applyTier substitutes the tier row's model into. Marking it explicit
  // here would make this row pass vacuously: applyTier would keep 480b and
  // 30b would never be a candidate to offer.
  __state.config = { apiBase: REMOTE_HOST, fnGenModel: "qwen3-coder:480b" };
  __state.quickPickImpl = async (items) => items[0];
  __state.infoResponses = ["Download"];
  const out = output();
  const { calls, pull } = recordingPull(out);
  await runFirstRunFlow(fakeContext(), out, {
    probe: referenceProbe(),
    listModels: async () => [FIM_MODEL],
    pull,
  });
  const offered = out.lines.filter((l) => l.startsWith("[carve] pull offered"));
  assert.ok(
    !offered.some((l) => l.includes(MODEL_30B)),
    `the local row's model must never be offered to a remote host: ${JSON.stringify(offered)}`
  );
  assert.ok(
    !calls.some((c) => c.model === MODEL_30B),
    `and never actually pulled there: ${JSON.stringify(calls.map((c) => c.model))}`
  );
});

test("remote apiBase: FIM's own model IS still offered, and now it is offered on the LOCAL host", async () => {
  resetState();
  __state.config = { apiBase: REMOTE_HOST };
  __state.quickPickImpl = async (items) => items[0];
  __state.infoResponses = [undefined];
  const out = output();
  const { pull } = recordingPull(out);
  await runFirstRunFlow(fakeContext(), out, { probe: noGpuProbe(), listModels: async () => [], pull });
  const offered = out.lines.filter((l) => l.startsWith("[carve] pull offered"));
  assert.ok(
    offered.some((l) => l.includes(FIM_MODEL)),
    `FIM is not suppressed, its model is still offered: ${JSON.stringify(out.lines)}`
  );
});

test("the default apiBase is untouched: the local disabled message still prints on a no-GPU box", async () => {
  resetState();
  __state.quickPickImpl = async (items) => items[0];
  const out = output();
  await runFirstRunFlow(fakeContext(), out, {
    probe: noGpuProbe(),
    listModels: async () => [FIM_MODEL],
  });
  assert.ok(
    __state.messages.some((m) => /no usable GPU/i.test(m.message)),
    `the honest local message must survive: ${JSON.stringify(__state.messages)}`
  );
  assert.ok(out.lines.some((l) => l.startsWith("[carve] fn-gen disabled: ")), "and its channel line with it");
  assert.ok(!out.lines.some((l) => l.includes("backend=remote")), "and nothing claims a remote backend");
});

test("0.0.0.0 is THIS box, so the tier gate still governs it", async () => {
  resetState();
  // The regression this rule exists to stop. OLLAMA_HOST=0.0.0.0 is the normal
  // way to expose ollama, so clients get pointed at http://0.0.0.0:11434
  // routinely. Reading that as "somebody else's machine" would let a 6GB laptop
  // slide past the tier gate onto the 30b default instead of the honest
  // below-12gb refusal.
  __state.config = { apiBase: "http://0.0.0.0:11434" };
  __state.quickPickImpl = async (items) => items[0];
  const out = output();
  await runFirstRunFlow(fakeContext(), out, {
    probe: noGpuProbe(),
    listModels: async () => [FIM_MODEL],
  });
  assert.ok(
    __state.messages.some((m) => /no usable GPU/i.test(m.message)),
    `0.0.0.0 is local, so the local probe is the right measurement: ${JSON.stringify(__state.messages)}`
  );
  assert.ok(!out.lines.some((l) => l.includes("backend=remote")), "and no remote carve is claimed");
});
