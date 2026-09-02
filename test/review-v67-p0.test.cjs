// Adversarial review of session-v67 phase 0 (contracts/phase0-kill-guard.md). Each row
// names the finding it belongs to and the line it attacks. A row that is red here is red
// on purpose: it is the evidence for the finding, not a regression.
//
// Run: SKIP_LIVE=1 node --test test/review-v67-p0.test.cjs
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { ChildProcess, spawnSync, spawn } = require("child_process");
const { bundleCore, sleep } = require("./.blind-util.cjs");

const TAG = "review-v67-p0";
const { mod, cleanup } = bundleCore(
  TAG,
  'export { Recogniser } from "../src/core/recogniser"; export { muteSpeakers } from "../src/core/speakerMute"; export { signalChild } from "../src/core/signalChild";\n',
);
const { Recogniser, signalChild } = mod;
const BUNDLE = path.join(__dirname, `.${TAG}.bundle.cjs`);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "c80-v67-review-"));
const MISSING = path.join(TMP, "no-such-binary");
const STRACE = spawnSync("which", ["strace"]).status === 0 ? "strace" : undefined;

test.after(() => {
  cleanup();
  fs.rmSync(TMP, { recursive: true, force: true });
});

// Finding 1 (attacks test/impl-v67-p0-kill.test.cjs:174-181, the recogniser row). The
// row hands Recogniser.start a MISSING path. src/core/recogniser.ts:97 rejects on
// existsSync before any spawn, so the row's "signals nothing" is true of a code path with
// no child in it. The guard at recogniser.ts:142 is never on the stack. RED by design.
// AMENDED 2026-09-03 (triage, DO): the impl row now hands over a NON-EXECUTABLE file, which
// passes existsSync and fails at spawn (EACCES). This row pins that shape: the file reaches
// a spawn, so the guard is on the stack. The missing-path shape stays as the counter-check.
test("finding 1: a non-executable recogniser binary reaches a spawn; a missing path does not", async () => {
  const realSpawn = ChildProcess.prototype.spawn;
  let spawns = 0;
  ChildProcess.prototype.spawn = function (...args) {
    spawns += 1;
    return realSpawn.apply(this, args);
  };
  try {
    const model = path.join(TMP, "ggml-fake.bin");
    fs.writeFileSync(model, "x");
    await assert.rejects(Recogniser.start({ binary: MISSING, model }), /binary-missing/);
    assert.strictEqual(spawns, 0, `Recogniser.start(<missing path>) spawned ${spawns} children; existsSync should reject first`);
    const notExec = path.join(TMP, "not-exec-server");
    fs.writeFileSync(notExec, "#!/bin/sh\n", { mode: 0o644 });
    await assert.rejects(Recogniser.start({ binary: notExec, model }));
    assert.ok(spawns >= 1, `Recogniser.start(<non-executable>) spawned ${spawns} children; the impl row exercises no kill guard`);
  } finally {
    ChildProcess.prototype.spawn = realSpawn;
  }
});

// Finding 2 (attacks the sweep ruling in session-v67/goal.md "Phase 0, ruled" item 1,
// which names "the speaker mute helpers", and the contract's rule 7 which omits them).
// src/core/speakerMute.ts:21 runs execFile with `timeout: 3000`; Node's own timer calls
// child.kill on the handle. No row in either file covers it. This one does: the linux
// lever with an empty PATH makes every mixer command a failed spawn. Green means Node's
// error lands before its timer and the kill finds no handle; a kill( line here would be
// a hole the guard does not reach.
test("finding 2 witness: muteSpeakers on a PATH with no mixer commands makes no kill(2)", { skip: STRACE === undefined && "strace not installed" }, () => {
  const script = path.join(TMP, "mute-witness.cjs");
  fs.writeFileSync(
    script,
    `const { muteSpeakers } = require(${JSON.stringify(BUNDLE)});\n` +
      `process.env.PATH = ${JSON.stringify(TMP)};\n` +
      `(async () => {\n` +
      `  const h = await muteSpeakers("linux");\n` +
      `  await h.restore();\n` +
      `  await new Promise((r) => setTimeout(r, 3500));\n` +
      `  process.stdout.write(JSON.stringify({ applied: h.applied, reason: h.reason ?? null }));\n` +
      `})();\n`,
  );
  const out = path.join(TMP, "mute.strace");
  const run = spawnSync(STRACE, ["-f", "-e", "trace=kill", "-o", out, process.execPath, script], { encoding: "utf8", timeout: 30_000 });
  assert.equal(run.status, 0, run.stderr);
  const result = JSON.parse(run.stdout);
  assert.equal(result.applied, false, JSON.stringify(result));
  const lines = fs.readFileSync(out, "utf8").split("\n").filter((l) => /\bkill\(/.test(l));
  assert.deepEqual(lines, []);
});

// Finding 3 (attacks src/core/signalChild.ts:12, "True when the signal was sent"). A
// child that exited and was reaped keeps its pid but Node has dropped the handle; the
// helper must answer false there and make no syscall. Pins the claim the helper's comment
// makes, and only that claim.
test("finding 3: signalChild on a reaped child with its pid still set returns false and calls nothing", async () => {
  const child = spawn(process.execPath, ["-e", "0"], { stdio: "ignore" });
  await new Promise((r) => child.once("exit", r));
  await sleep(10);
  assert.ok(Number.isInteger(child.pid) && child.pid > 0, "Node keeps the pid after exit");
  assert.equal(signalChild(child, "SIGKILL"), false);
  assert.equal(child.killed, false, "no signal was recorded on the handle");
});
