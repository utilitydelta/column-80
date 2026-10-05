"use strict";

// The small behaviour fixes that ride along with the message sweep: each row here fails on
// the code before the fix. Dictation adapter rows drive `Dictation` directly through the
// activation stub; the Tighten row drives the registered command.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { bundleActivation } = require("./.activation-stub.cjs");

const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), "impl-v77-p3-"));
process.env.COLUMN80_NATIVE_DIR = SCRATCH;
process.env.COLUMN80_WHISPER_MODEL = path.join(SCRATCH, "missing-base.en.bin");
process.env.COLUMN80_VAD_MODEL = path.join(SCRATCH, "missing-vad.bin");

const built = bundleActivation(
  "impl-v77-p3-behaviour",
  `export { Dictation } from "../src/vscode/dictation";
export { registerTightenDocComment } from "../src/vscode/tightenDocComment";
export { window } from "vscode";\n`,
);
const { Dictation, registerTightenDocComment, __state, window } = built.mod;

test.after(() => {
  built.cleanup();
  fs.rmSync(SCRATCH, { recursive: true, force: true });
});

const URI = "file:///w/v77/mod.ts";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const statusMessages = [];
window.setStatusBarMessage = (text) => {
  statusMessages.push(String(text));
  return { dispose() {} };
};
const originalShowInfo = window.showInformationMessage;
const originalWithProgress = window.withProgress;

function newRig(wiring) {
  const lines = [];
  const output = { appendLine: (l) => lines.push(String(l)), append: () => {} };
  __state.config = { "dictation.muteSpeakers": false, "dictation.partials": false };
  __state.messages = [];
  __state.executeCalls = [];
  statusMessages.length = 0;
  window.showInformationMessage = originalShowInfo;
  window.withProgress = originalWithProgress;
  const context = { extensionPath: SCRATCH, subscriptions: [], globalStorageUri: { fsPath: SCRATCH } };
  const d = new Dictation(context, output, wiring ?? { armIntent() {} });
  return { d, lines };
}
const site = { uri: URI, line: 3 };
const recording = () => ({ phase: "recording", site, languageId: "typescript", indentColumns: 0, pressedAt: Date.now() });
const finalising = () => ({ phase: "finalising", site, languageId: "typescript", indentColumns: 0, pressedAt: Date.now() });
const ghost = () => ({ phase: "ghost", site, languageId: "typescript", indentColumns: 0, heard: "A point." });

/** Drive the speech model offer with the user clicking Download, and the download itself
 *  rejecting with `err`. */
async function downloadRejects(err) {
  const rig = newRig();
  window.showInformationMessage = async (message, ...actions) => {
    __state.messages.push({ kind: "info", message, actions });
    return "Download";
  };
  window.withProgress = async () => {
    throw err;
  };
  const landed = await rig.d.offerModel(true);
  rig.d.dispose();
  return { landed, warns: __state.messages.filter((m) => m.kind === "warn"), lines: rig.lines };
}

test("R-021: Cancel on the speech model download is not reported as a failed download", async () => {
  const abort = new Error("download aborted");
  abort.name = "AbortError";
  const got = await downloadRejects(abort);
  assert.equal(got.landed, false);
  assert.deepEqual(got.warns, [], `a cancel the user asked for raised: ${JSON.stringify(got.warns)}`);
  assert.ok(got.lines.some((l) => l.includes("model download cancelled")), got.lines.join("\n"));
});

test("R-021 control: a real download failure still warns, with the first line and the retry command", async () => {
  const got = await downloadRejects(new Error("download of https://x/ggml.bin answered HTTP 404\nbody"));
  assert.equal(got.warns.length, 1);
  assert.equal(
    got.warns[0].message,
    'Column 80: the speech model did not download (download of https://x/ggml.bin answered HTTP 404). Run "Column 80: Download Speech Model" to try again.',
  );
});

test("R-Q8: a recorder that exits as binary-missing names the platform, not its stderr", () => {
  const { d, lines } = newRig();
  d.state = recording();
  d.dispatch({ type: "stopped", pcmBytes: 0, failure: "binary-missing", stderr: "exec format error: /x/column80-capture" });
  const platform = `${process.platform}-${process.arch}`;
  assert.deepEqual(statusMessages, [`Column 80: dictation is not available on ${platform} yet.`]);
  assert.ok(lines.some((l) => l.includes("exec format error")), "the stderr is on the channel");
  d.dispose();
});

test("DC2: a recorder failure shows a fixed sentence; its stderr goes to the channel only", () => {
  const { d, lines } = newRig();
  d.state = recording();
  d.dispatch({ type: "stopped", pcmBytes: 0, failure: "failed", stderr: "ALSA lib pcm.c:2664\nsecond line" });
  assert.deepEqual(statusMessages, ["Column 80: dictation stopped on an error. The full message is in the output channel."]);
  assert.ok(lines.some((l) => l.includes("ALSA lib pcm.c:2664")), lines.join("\n"));
  d.dispose();
});

test("DC2: a recogniser that is down at decode time shows its own sentence, without a doubled prefix", () => {
  const { d } = newRig();
  d.recogniser = { alive: false, dispose() {} };
  d.state = finalising();
  d.dispatch({ type: "stopped", pcmBytes: 3200 });
  assert.deepEqual(statusMessages, [
    "Column 80: the speech recogniser was not running. Dictate again in a moment.",
  ]);
  d.dispose();
});

test("R-Q9: a dictated ghost replaced by the user's own keystroke ends without a status message", async () => {
  const { d, lines } = newRig({ armIntent() {}, dictatedIsLatest: () => false });
  d.state = ghost();
  d.commitAndWatch();
  await sleep(20);
  assert.equal(d.phase, "idle");
  assert.deepEqual(statusMessages, [], `the user was told about their own keystroke: ${JSON.stringify(statusMessages)}`);
  assert.ok(lines.some((l) => l.includes("superseded by a keystroke")), lines.join("\n"));
  d.dispose();
});

// R-Q12 retired by session-v77 R2: Tighten no longer refuses on a closed tier, so there is no
// refusal sentence to name it. test/impl-v77-p6-lane3.test.cjs pins what it does instead.
