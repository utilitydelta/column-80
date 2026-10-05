"use strict";

// REVIEW evidence, session-v77 phase 5 part A (session-v77/review-p5a.md), findings P5A-2,
// P5A-3 and P5A-4. Every row is RED on the tree as reviewed, on purpose.
//
//   P5A-2  Download Speech Model while the speech model is already downloading offers the
//          download again. DC36 fixed this for a dictation press only.
//   P5A-3  Download Speech Model with the model on disk now returns before ensureReady, so
//          the command no longer starts the recogniser (or fetches a missing VAD file). The
//          goal says behaviour other than whether a message shows stays unchanged.
//   P5A-4  Toggle Tab Completion turning it on with the Ollama server down shows the
//          "tab completion on." status bar AND the "on, but ... not answering" warning.
//
// Harness: impl-v77-p4-lane3's, copied (the real extension against the shared activation stub).
//
// Run: SKIP_LIVE=1 node --test test/review-v77-p5a-surfaces.test.cjs

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { bundleActivation } = require("./.activation-stub.cjs");

const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), "review-v77-p5a-surfaces-"));
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
  "review-v77-p5a-surfaces",
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

let toggle;
/** Activation runs once; its toggle handler is kept, since every row's reset clears the
 *  command table. */
async function activateOnce() {
  if (toggle === undefined) {
    await activate(extContext());
    toggle = __state.commands["column80.toggle"];
  }
  __state.messages = [];
}
const fimReady = () => {
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ models: [{ name: FIM_MODEL }] }) });
};

const URI = "file:///w/v77/lane3.ts";
const site = { uri: URI, line: 0 };
const recording = () => ({ phase: "recording", site, languageId: "typescript", indentColumns: 0, pressedAt: Date.now() });
const finalising = () => ({ phase: "finalising", site, languageId: "typescript", indentColumns: 0, pressedAt: Date.now() });
const ghost = () => ({ phase: "ghost", site, languageId: "typescript", indentColumns: 0, heard: "A point." });

/** A Dictation over the given native dir and model file. The adapter resolves its paths at
 *  construction, so the env is set right before. */
function dictation({ native = SLEEP_DIR, model = MODEL_ABSENT, store = {}, wiring } = {}) {
  reset(store);
  process.env.COLUMN80_NATIVE_DIR = native;
  process.env.COLUMN80_WHISPER_MODEL = model;
  const out = channel();
  const d = new Dictation(extContext(), out, wiring ?? { armIntent() {} });
  return { d, lines: out.lines };
}
const speechOffers = () => __state.messages.filter((m) => /speech model/.test(m.message));


test("P5A-2: Download Speech Model during a running download does not offer it again", async () => {
  const { d } = dictation();
  try {
    d.downloads.set(d.paths.model, new Promise(() => {}));
    await Promise.race([d.downloadSpeechModel(), sleep(200)]);
    assert.deepEqual(
      speechOffers().map((m) => m.message),
      [],
      "the command re-offered a download that is already running; the press says 'still downloading'",
    );
  } finally {
    d.downloads.clear();
    d.dispose();
  }
});

test("P5A-3: Download Speech Model with the model on disk still readies dictation, as before the change", async () => {
  const { d } = dictation({ model: MODEL_PRESENT });
  let starts = 0;
  d.startRecogniser = () => {
    starts++;
    return Promise.resolve();
  };
  try {
    await d.downloadSpeechModel();
    assert.equal(
      starts,
      1,
      "before phase 4 the command was ensureReady(true, true), which started the recogniser when the model was present",
    );
  } finally {
    d.dispose();
  }
});

test("P5A-4: turning tab completion on with the server down is one message, not a status bar plus a warning", async () => {
  reset({ "column80.enabled": false, "column80.fimModel": FIM_MODEL, "column80.dictation.enabled": false });
  globalThis.fetch = async () => {
    throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
  };
  await activateOnce();
  statusMessages.length = 0;
  __state.messages = [];
  await toggle();
  assert.equal(cfg.store["column80.enabled"], true, "precondition: the toggle turned it on");
  const warns = __state.messages.filter((m) => m.kind === "warn");
  assert.equal(warns.length, 1, `precondition: the not-answering warning. ${JSON.stringify(__state.messages)}`);
  assert.deepEqual(
    statusMessages,
    [],
    `one event, two messages: ${JSON.stringify(statusMessages)} and ${JSON.stringify(warns[0].message)}`,
  );
});
