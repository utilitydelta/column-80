"use strict";

// session-v77 phase 4, lane 3: the behaviour rows of the journey re-trace for first run, the
// tab completion toggle, the rust-analyzer nudges and dictation. Each row fails on the tree
// before its fix. One bundle: the real extension against the shared activation stub, with
// configuration, quick pick, status bar and fetch replaced per row.
//
// Run: SKIP_LIVE=1 node --test test/impl-v77-p4-lane3.test.cjs

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { bundleActivation } = require("./.activation-stub.cjs");

const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), "impl-v77-p4-lane3-"));
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
  "impl-v77-p4-lane3",
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
// First run
// ---------------------------------------------------------------------------

test("DA5: first run on a no-GPU box, detected row picked: no generation-disabled toast, the channel line stays", async () => {
  reset();
  window.showQuickPick = async (items) => items[0];
  const out = channel();
  await runFirstRunFlow(extContext(), out, { probe: noGpuProbe(), listModels: async () => [FIM_MODEL] });
  const toasts = __state.messages.filter((m) => /Function generation is disabled/.test(m.message));
  assert.deepEqual(toasts, [], `the pick row already said it: ${JSON.stringify(toasts)}`);
  assert.ok(out.lines.some((l) => l.startsWith("[carve] fn-gen disabled: Function generation is disabled")), out.lines.join("\n"));
});

test("DA15: picking the detected row over an earlier override writes auto back", async () => {
  reset({ "column80.hardwareTier": "16gb-low-ram" });
  window.showQuickPick = async (items) => items[0];
  await runFirstRunFlow(extContext(), channel(), { probe: referenceProbe(), listModels: async () => [FIM_MODEL, MODEL_30B] });
  assert.deepEqual(cfg.updates, [{ key: "column80.hardwareTier", value: "auto", target: 1 }]);
});

test("DA15 control: picking the detected row with the setting already on auto writes nothing", async () => {
  reset();
  window.showQuickPick = async (items) => items[0];
  await runFirstRunFlow(extContext(), channel(), { probe: referenceProbe(), listModels: async () => [FIM_MODEL, MODEL_30B] });
  assert.deepEqual(cfg.updates, []);
});

test("DA16: Select Hardware Tier that throws says so in a warning, not only on the channel", async () => {
  reset();
  window.showQuickPick = async () => {
    throw new Error("quick pick blew up");
  };
  const out = channel();
  registerFirstRun(extContext(), out, { probe: referenceProbe(), listModels: async () => [FIM_MODEL] });
  await __state.commands["column80.selectHardwareTier"]();
  const warns = __state.messages.filter((m) => m.kind === "warn");
  assert.equal(warns.length, 1, JSON.stringify(__state.messages));
  assert.match(warns[0].message, /Select Hardware Tier failed/);
  assert.ok(out.lines.some((l) => l.startsWith("[carve] tier flow failed:")), out.lines.join("\n"));
});

// ---------------------------------------------------------------------------
// The rust-analyzer nudges
// ---------------------------------------------------------------------------

test("DA31: a second member site while the snippet offer is open raises no hover offer", async () => {
  reset();
  const shown = [];
  window.showInformationMessage = (message, ...actions) => {
    shown.push(message);
    return new Promise(() => {}); // the snippet toast stays open
  };
  const ctx = extContext();
  const out = channel();
  // The member-site hook as activation wires it: snippet first, hover once it settles.
  const hook = () => offerRaSnippetFix(ctx, "rust", out).then(() => offerRaHoverCapFix(ctx, "rust", out));
  void hook();
  await sleep(10);
  void hook();
  await sleep(10);
  assert.equal(shown.length, 1, `two rust-analyzer questions on screen at once: ${JSON.stringify(shown)}`);
});

// ---------------------------------------------------------------------------
// The tab completion toggle, driven through activation
// ---------------------------------------------------------------------------

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

test("DA22: a toggle that works says so on the status bar, both directions", async () => {
  reset({ "column80.enabled": true, "column80.fimModel": FIM_MODEL, "column80.dictation.enabled": false });
  fimReady();
  await activateOnce();
  statusMessages.length = 0;
  await toggle();
  assert.equal(cfg.store["column80.enabled"], false, "CONTROL: the toggle turned it off");
  assert.deepEqual(statusMessages, ["Column 80: tab completion off."]);
  statusMessages.length = 0;
  await toggle();
  assert.equal(cfg.store["column80.enabled"], true, "CONTROL: the toggle turned it on");
  assert.deepEqual(statusMessages, ["Column 80: tab completion on."]);
  assert.deepEqual(__state.messages, [], "a ready model raises nothing else");
});

test("DA23: a write that throws warns once", async () => {
  reset({ "column80.enabled": false, "column80.fimModel": FIM_MODEL, "column80.dictation.enabled": false });
  fimReady();
  await activateOnce();
  cfg.updateError = new Error("settings.json is read-only");
  await toggle();
  const warns = __state.messages.filter((m) => m.kind === "warn");
  assert.deepEqual(
    warns.map((m) => m.message),
    ["Column 80: could not change tab completion. The full message is in the output channel."],
  );
});

test("DA23: a write another scope overrides warns once and names column80.enabled", async () => {
  reset({ "column80.enabled": true, "column80.fimModel": FIM_MODEL, "column80.dictation.enabled": false });
  fimReady();
  await activateOnce();
  cfg.pinned["column80.enabled"] = true;
  await toggle();
  const warns = __state.messages.filter((m) => m.kind === "warn");
  assert.equal(warns.length, 1, JSON.stringify(__state.messages));
  assert.match(warns[0].message, /column80\.enabled/);
  assert.deepEqual(statusMessages, [], "an overridden write is not reported as done");
});

// ---------------------------------------------------------------------------
// Dictation
// ---------------------------------------------------------------------------

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

test("DC1: a press with the model missing raises the offer and nothing on the status bar", async () => {
  const { d } = dictation();
  try {
    d.execute({ type: "refuse", kind: "model-missing" });
    await sleep(20);
    assert.deepEqual(statusMessages, [], "the offer toast is the message; the status bar repeated it");
    assert.equal(speechOffers().length, 1, JSON.stringify(__state.messages));
  } finally {
    d.dispose();
  }
});

test("DC36: a press while the speech model downloads says it is still downloading, and offers nothing", async () => {
  const { d } = dictation();
  try {
    d.downloads.set(d.paths.model, new Promise(() => {}));
    d.execute({ type: "refuse", kind: "model-missing" });
    await sleep(20);
    assert.deepEqual(statusMessages, ["Column 80: the speech model is still downloading."]);
    assert.deepEqual(speechOffers(), []);
  } finally {
    d.downloads.clear();
    d.dispose();
  }
});

test("DC5: an edit landed on the site but no accept arrived: the take ends with no status message", async () => {
  const { d, lines } = dictation({ wiring: { armIntent() {}, dictatedIsLatest: () => true } });
  try {
    d.state = ghost();
    d.commitAndWatch();
    d.landedSinceCommit = true;
    await sleep(800);
    assert.equal(d.phase, "idle");
    assert.deepEqual(statusMessages, [], `the code is in the buffer, the user was told it was not: ${JSON.stringify(statusMessages)}`);
    assert.ok(lines.some((l) => l.includes("an edit landed on the site but no accept arrived")), lines.join("\n"));
  } finally {
    d.dispose();
  }
});

test("DC7: a decode with the recogniser dead restarts it, so 'dictate again in a moment' is true", async () => {
  const { d } = dictation();
  let starts = 0;
  d.startRecogniser = () => {
    starts += 1;
    return Promise.resolve();
  };
  try {
    d.recogniser = { alive: false, dispose() {} };
    d.state = finalising();
    d.dispatch({ type: "stopped", pcmBytes: 3200 });
    assert.equal(starts, 1);
    assert.deepEqual(statusMessages, ["Column 80: the speech recogniser was not running. Dictate again in a moment."]);
  } finally {
    d.dispose();
  }
});

test("DC31: no recorder binaries: the speech model is not offered", async () => {
  const { d, lines } = dictation({ native: EMPTY_DIR });
  try {
    await d.ensureReady(true);
    assert.deepEqual(speechOffers(), [], "a 148MB download that can never run");
    assert.ok(lines.includes("[dictate] recorder binaries missing; model not offered"), lines.join("\n"));
  } finally {
    d.dispose();
  }
});

test("DC31 control: with the binaries present the model is still offered", async () => {
  const { d } = dictation();
  try {
    await d.ensureReady(true);
    assert.equal(speechOffers().length, 1);
  } finally {
    d.dispose();
  }
});

test("DC33: Download Speech Model with dictation off says so, through the registered command", async () => {
  reset({ "column80.dictation.enabled": false });
  process.env.COLUMN80_NATIVE_DIR = SLEEP_DIR;
  process.env.COLUMN80_WHISPER_MODEL = MODEL_ABSENT;
  const ctx = extContext();
  const d = registerDictation(ctx, channel(), { armIntent() {} });
  try {
    await __state.commands["column80.downloadSpeechModel"]();
    assert.deepEqual(
      __state.messages.map((m) => m.message),
      ["Column 80: dictation is off. Turn on column80.dictation.enabled first."],
    );
  } finally {
    d.dispose();
  }
});

test("DC33: over Remote it says dictation is not available there, and offers nothing", async () => {
  const { d } = dictation();
  env.remoteName = "ssh-remote";
  try {
    await d.downloadSpeechModel();
    assert.deepEqual(
      __state.messages.map((m) => m.message),
      ["Column 80: dictation needs the microphone on this machine; not available over Remote yet."],
    );
  } finally {
    delete env.remoteName;
    d.dispose();
  }
});

test("DC33: with the model already on disk it says so, and offers nothing", async () => {
  const { d } = dictation({ model: MODEL_PRESENT });
  d.startRecogniser = () => Promise.resolve();
  try {
    await d.downloadSpeechModel();
    assert.deepEqual(__state.messages.map((m) => m.message), ["Column 80: the speech model is already downloaded."]);
  } finally {
    d.dispose();
  }
});

test("DC33: with the model missing it offers the download", async () => {
  const { d } = dictation();
  try {
    await d.downloadSpeechModel();
    assert.equal(speechOffers().length, 1, JSON.stringify(__state.messages));
    assert.equal(__state.messages.length, 1);
  } finally {
    d.dispose();
  }
});

test("N3: a recorder that exits non-zero with empty stderr leaves its exit code on the channel", async () => {
  const { d, lines } = dictation({ native: EXIT_DIR });
  try {
    d.state = recording();
    d.startCapture();
    await sleep(300);
    assert.ok(lines.some((l) => l.startsWith("[dictate] capture exited code=9 signal=none")), lines.join("\n"));
    assert.deepEqual(statusMessages, ["Column 80: dictation stopped on an error. The full message is in the output channel."]);
  } finally {
    d.dispose();
  }
});

test("N3: the stop path logs the exit code too", async () => {
  const { d, lines } = dictation({ native: STOP_EXIT_DIR });
  try {
    d.state = recording();
    d.startCapture();
    await sleep(100);
    d.stopCapture();
    await sleep(300);
    assert.ok(lines.some((l) => l.startsWith("[dictate] capture exited code=9 signal=none")), lines.join("\n"));
  } finally {
    d.dispose();
  }
});

// ---------------------------------------------------------------------------
// Q5 seam: the hand-off tells Tighten it came from dictation
// ---------------------------------------------------------------------------

function editorAt(text) {
  let current = text;
  const rows = () => current.split("\n");
  const ed = {
    document: {
      uri: { toString: () => URI, scheme: "file" },
      languageId: "typescript",
      version: 1,
      eol: 1,
      get lineCount() {
        return rows().length;
      },
      getText: () => current,
      lineAt: (n) => ({ text: rows()[n] ?? "", range: { end: new Position(n, (rows()[n] ?? "").length) } }),
    },
    viewColumn: 1,
    selection: { active: new Position(0, text.length) },
    setDecorations() {},
    revealRange() {},
    async edit(cb) {
      cb({
        insert: (p, t) => {
          const r = rows();
          r[p.line] = (r[p.line] ?? "").slice(0, p.character) + t + (r[p.line] ?? "").slice(p.character);
          current = r.join("\n");
        },
      });
      return true;
    },
  };
  return ed;
}

// HELD, not applied: blind-v67-p2-adapter "rules 8, 10" asserts the hand-off passes no
// arguments, and the lane rules forbid changing what a blind row observes. The row stays as the
// red test the seam needs once that contract is ratified.
test("Q5 seam: the dictated comment hands over to Tighten with { source: 'dictation' }", async () => {
  const { d, lines } = dictation({ model: MODEL_PRESENT });
  const editor = editorAt("//");
  __state.activeTextEditor = editor;
  __state.visibleTextEditors = [editor];
  try {
    d.pressCharacter = 2;
    d.state = { ...finalising(), commentSite: true };
    d.dispatch({ type: "transcript", text: "this is the sentence", decodeMs: 5 });
    await sleep(60);
    const calls = __state.executeCalls.filter((c) => c.id === "column80.tightenDocComment");
    assert.equal(calls.length, 1, lines.join("\n"));
    assert.deepEqual(calls[0].args[0], { source: "dictation" });
  } finally {
    d.dispose();
  }
});
