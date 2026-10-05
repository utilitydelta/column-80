"use strict";

// session-v77 phase 6, lane 2 (goal.md Amendment 3): R1 and R8.
//
// R1: activation does not offer the speech model; the first press does.
// R8: a comment-site dictation is not refused for a language outside column80.fimLanguages.
//
// Run: SKIP_LIVE=1 node --test test/impl-v77-p6-lane2.test.cjs

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { bundleActivation } = require("./.activation-stub.cjs");
const { bundleCore } = require("./.blind-util.cjs");

const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), "impl-v77-p6-lane2-"));
// The recorder binaries are present (DC31 withholds the offer without them), the model is not.
fs.writeFileSync(path.join(SCRATCH, "whisper-server"), "");
fs.writeFileSync(path.join(SCRATCH, "column80-capture"), "");
process.env.COLUMN80_NATIVE_DIR = SCRATCH;
process.env.COLUMN80_WHISPER_MODEL = path.join(SCRATCH, "missing-base.en.bin");
process.env.COLUMN80_VAD_MODEL = path.join(SCRATCH, "missing-vad.bin");

const built = bundleActivation(
  "impl-v77-p6-lane2",
  `export { Dictation, registerDictation } from "../src/vscode/dictation";
export { window, workspace, env } from "vscode";\n`,
);
const core = bundleCore("impl-v77-p6-lane2-reducer", 'export * from "../src/core/dictationGesture";\n');
test.after(() => {
  built.cleanup();
  core.cleanup();
  fs.rmSync(SCRATCH, { recursive: true, force: true });
});
const { registerDictation, __state, window } = built.mod;
const { reduce, IDLE } = core.mod;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const speechOffers = () => __state.messages.filter((m) => /speech model/.test(m.message));
const extContext = () => ({ subscriptions: [], extensionPath: SCRATCH, globalStorageUri: { fsPath: SCRATCH } });
const channel = () => {
  const lines = [];
  return { lines, appendLine: (l) => lines.push(String(l)), append() {}, show() {} };
};

// ---- R1

test("R1: activation (registerDictation) puts no speech model offer on screen", async () => {
  __state.config = { "dictation.muteSpeakers": false, "dictation.partials": false };
  __state.messages = [];
  const d = registerDictation(extContext(), channel(), { armIntent() {} });
  try {
    await sleep(30);
    assert.deepEqual(speechOffers(), [], JSON.stringify(__state.messages));
  } finally {
    d.dispose();
  }
});

test("R1 control: after activation, the first press with the model missing makes the offer", async () => {
  __state.config = { "dictation.muteSpeakers": false, "dictation.partials": false };
  __state.messages = [];
  const original = window.showInformationMessage;
  window.showInformationMessage = (message, ...actions) => {
    __state.messages.push({ kind: "info", message, actions });
    return Promise.resolve(undefined);
  };
  const d = registerDictation(extContext(), channel(), { armIntent() {} });
  try {
    await sleep(30);
    d.execute({ type: "refuse", kind: "model-missing" });
    await sleep(30);
    assert.equal(speechOffers().length, 1, JSON.stringify(__state.messages));
  } finally {
    window.showInformationMessage = original;
    d.dispose();
  }
});

// ---- R8

const READY = {
  remote: false,
  binaryPresent: true,
  modelPresent: true,
  recogniserAlive: true,
  served: false,
  commentRow: true,
  inComment: true,
};
const press = (ready) => ({
  type: "press",
  site: { uri: "file:///w/a.lua", line: 3 },
  languageId: "lua",
  indentColumns: 0,
  now: 1000,
  ghostVisible: false,
  ready: { ...READY, ...ready },
});

test("R8: a press inside a comment in a language FIM does not serve arms a comment site", () => {
  const out = reduce(IDLE, press({}));
  assert.equal(out.state.phase, "arming");
  assert.equal(out.state.commentSite, true);
  assert.ok(!out.actions.some((a) => a.type === "refuse"), JSON.stringify(out.actions));
});

test("R8 control: the same press on a code line still refuses not-served", () => {
  const out = reduce(IDLE, press({ inComment: false }));
  assert.equal(out.state.phase, "idle");
  assert.deepEqual(out.actions[0], { type: "refuse", kind: "not-served", detail: "lua" });
});

test("R8: the checks before served still refuse at a comment site", () => {
  for (const [ready, kind] of [
    [{ remote: true }, "remote"],
    [{ modelPresent: false }, "model-missing"],
    [{ recogniserAlive: false }, "server-down"],
  ]) {
    const out = reduce(IDLE, press(ready));
    assert.equal(out.actions[0].kind, kind);
  }
});
