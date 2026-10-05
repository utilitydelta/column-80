"use strict";

// session-v77 phase 5, lane 1: settings and activation. A hardware tier override held in a
// workspace or folder survives the first-run write, and the flow says so. Harness copied from
// impl-v77-p4-lane3 (the real extension against the shared activation stub).
//
// Run: SKIP_LIVE=1 node --test test/impl-v77-p5-lane1.test.cjs

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { bundleActivation } = require("./.activation-stub.cjs");

const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), "impl-v77-p5-lane1-"));
// Three native dirs: none of the binaries, a recorder that sleeps, and recorders that exit
// non-zero with nothing on stderr.
const EMPTY_DIR = path.join(SCRATCH, "empty");
const SLEEP_DIR = path.join(SCRATCH, "sleep");
const EXIT_DIR = path.join(SCRATCH, "exit");
const STOP_EXIT_DIR = path.join(SCRATCH, "stop-exit");
for (const [dir, script] of [
  [EMPTY_DIR, undefined],
  [SLEEP_DIR, "#!/bin/sh\nexec sleep 3\n"],
  [EXIT_DIR, "#!/bin/sh\nexit 9\n"],
  [STOP_EXIT_DIR, "#!/bin/sh\nread x\nexit 9\n"],
]) {
  fs.mkdirSync(dir, { recursive: true });
  if (script !== undefined) {
    fs.writeFileSync(path.join(dir, "whisper-server"), "");
    fs.writeFileSync(path.join(dir, "column80-capture"), script);
    fs.chmodSync(path.join(dir, "column80-capture"), 0o755);
  }
}
const MODEL_PRESENT = path.join(SCRATCH, "base.en.bin");
const MODEL_ABSENT = path.join(SCRATCH, "missing-base.en.bin");
fs.writeFileSync(MODEL_PRESENT, "");
process.env.COLUMN80_VAD_MODEL = path.join(SCRATCH, "missing-vad.bin");

const built = bundleActivation(
  "impl-v77-p5-lane1",
  `export { Dictation, registerDictation } from "../src/vscode/dictation";
export { runFirstRunFlow, registerFirstRun, offerRaSnippetFix, offerRaHoverCapFix } from "../src/vscode/firstRun";
export { window, workspace, env } from "vscode";\n`,
);
const { activate, Dictation, registerDictation, runFirstRunFlow, registerFirstRun, offerRaSnippetFix, offerRaHoverCapFix } =
  built.mod;
const { __state, window, workspace, env, Position } = built.mod;

const originalFetch = globalThis.fetch;
test.after(() => {
  globalThis.fetch = originalFetch;
  built.cleanup();
  fs.rmSync(SCRATCH, { recursive: true, force: true });
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FIM_MODEL = "qwen2.5-coder:1.5b-base";
const MODEL_30B = "qwen3-coder:30b";

// ---- configuration: one store keyed `section.key`, an update log, and two failure knobs

const cfg = { store: {}, updates: [], pinned: {}, updateError: undefined };
workspace.getConfiguration = (section) => {
  const full = (key) => (section ? `${section}.${key}` : key);
  return {
    get: (key, fallback) => {
      const k = full(key);
      if (k in cfg.pinned) return cfg.pinned[k];
      return k in cfg.store ? cfg.store[k] : fallback;
    },
    has: (key) => full(key) in cfg.store,
    inspect: () => undefined,
    update: async (key, value, target) => {
      if (cfg.updateError !== undefined) throw cfg.updateError;
      cfg.updates.push({ key: full(key), value, target });
      cfg.store[full(key)] = value;
    },
  };
};

const statusMessages = [];
window.setStatusBarMessage = (text) => {
  statusMessages.push(String(text));
  return { dispose() {} };
};
const originalShowInfo = window.showInformationMessage;
const originalQuickPick = window.showQuickPick;

function reset(store = {}) {
  cfg.store = { "column80.dictation.muteSpeakers": false, "column80.dictation.partials": false, ...store };
  cfg.updates = [];
  cfg.pinned = {};
  cfg.updateError = undefined;
  __state.messages = [];
  __state.executeCalls = [];
  __state.commands = {};
  __state.visibleTextEditors = [];
  __state.activeTextEditor = undefined;
  statusMessages.length = 0;
  window.showInformationMessage = originalShowInfo;
  window.showQuickPick = originalQuickPick;
  delete env.remoteName;
}

const channel = () => {
  const lines = [];
  return { lines, appendLine: (l) => lines.push(String(l)), append() {}, show() {} };
};
const memento = (store = {}) => ({ get: (k) => store[k], update: async (k, v) => { store[k] = v; }, keys: () => Object.keys(store) });
const extContext = () => ({
  subscriptions: [],
  extensionPath: SCRATCH,
  globalStorageUri: { fsPath: SCRATCH },
  globalState: memento({ "column80.firstRunDone": true }),
  workspaceState: memento(),
});

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

// ---------------------------------------------------------------------------
// P5A-6: the tier write lands at Global; an override in a narrower scope survives it
// ---------------------------------------------------------------------------

const OVERRIDE_WARNING =
  "Column 80: a workspace or folder setting still sets column80.hardwareTier. Change it there.";
const tierWarnings = () => __state.messages.filter((m) => m.kind === "warn" && /column80\.hardwareTier/.test(m.message));

for (const row of [
  { name: "the detected row", pick: (items) => items[0] },
  { name: "an explicit tier", pick: (items) => items.find((i) => i.value === "24gb") },
]) {
  test(`P5A-6: picking ${row.name} under a workspace hardwareTier override says the override still wins`, async () => {
    reset({ "column80.hardwareTier": "16gb-low-ram" });
    cfg.pinned["column80.hardwareTier"] = "16gb-low-ram";
    window.showQuickPick = async (items) => row.pick(items);
    await runFirstRunFlow(extContext(), channel(), { probe: referenceProbe(), listModels: async () => [FIM_MODEL, MODEL_30B] });
    assert.deepEqual(
      tierWarnings().map((m) => m.message),
      [OVERRIDE_WARNING],
      `${row.name}: ${JSON.stringify(__state.messages)}`,
    );
  });

  test(`P5A-6 control: picking ${row.name} with no narrower override raises no override warning`, async () => {
    reset({ "column80.hardwareTier": "16gb-low-ram" });
    window.showQuickPick = async (items) => row.pick(items);
    await runFirstRunFlow(extContext(), channel(), { probe: referenceProbe(), listModels: async () => [FIM_MODEL, MODEL_30B] });
    assert.deepEqual(tierWarnings(), [], `${row.name}: ${JSON.stringify(__state.messages)}`);
  });
}
