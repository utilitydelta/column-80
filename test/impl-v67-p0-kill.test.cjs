// session-v67 phase 0, white-box (contracts/phase0-kill-guard.md): a child whose spawn
// failed has no pid, and a kill() on it reaches the kernel with a garbage pid. Every
// row here watches the real ChildProcess.prototype.kill, so "signalled nothing" is
// observed at the call, not inferred from the outcome. The strace rows are the
// witness below Node: they run only where strace is installed.
//
// Run: SKIP_LIVE=1 node --test test/impl-v67-p0-kill.test.cjs
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { ChildProcess, spawnSync } = require("child_process");
const { bundleCore, sleep } = require("./.blind-util.cjs");

const TAG = "impl-v67-p0-kill";
const { mod, cleanup } = bundleCore(
  TAG,
  'export * from "../src/core/capture"; export { makeClaudeCodeInstruct } from "../src/core/claudeCodeInstruct"; export { probeCommandRunner } from "../src/core/hardware"; export { Recogniser } from "../src/core/recogniser"; export { signalChild } from "../src/core/signalChild";\n',
);
const { CaptureTake, makeClaudeCodeInstruct, probeCommandRunner, Recogniser, signalChild } = mod;
const BUNDLE = path.join(__dirname, `.${TAG}.bundle.cjs`);

const FAKE_CAPTURE = path.join(__dirname, "fixtures", "dictation", "fake-capture.cjs");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "c80-v67-p0-"));
const MISSING = path.join(TMP, "no-such-recorder");
const STRACE = spawnSync("which", ["strace"]).status === 0 ? "strace" : undefined;

// Every kill() the process makes while the file runs, with the pid Node held at the time.
const kills = [];
const realKill = ChildProcess.prototype.kill;
ChildProcess.prototype.kill = function (sig) {
  kills.push({ pid: this.pid, sig });
  return realKill.call(this, sig);
};
// A garbage-pid kill that lands EPERM re-emits `error` on the child with no listener
// left; that surfaces here.
const uncaught = [];
const onUncaught = (err) => uncaught.push(err);
process.on("uncaughtException", onUncaught);

test.after(() => {
  ChildProcess.prototype.kill = realKill;
  process.off("uncaughtException", onUncaught);
  cleanup();
  fs.rmSync(TMP, { recursive: true, force: true });
});

let seq = 0;
function writeScript(name, source) {
  const p = path.join(TMP, `${++seq}-${name}`);
  fs.writeFileSync(p, source, { mode: 0o755 });
  return p;
}
const fakeRecorder = () =>
  writeScript("recorder.sh", `#!/bin/sh\nexec "${process.execPath}" "${FAKE_CAPTURE}" "$@"\n`);
// A recorder that ignores stdin closing, so stop() has to reach its grace timer.
const deafRecorder = () => {
  const js = writeScript("deaf.cjs", "process.stdin.resume();\nsetInterval(() => process.stdout.write(Buffer.alloc(640)), 20);\n");
  return writeScript("deaf.sh", `#!/bin/sh\nexec "${process.execPath}" "${js}"\n`);
};

const killsSince = (mark) => kills.slice(mark);

test("abort at once after start(<missing path>) sends nothing, returns false, and the take settles binary-missing", async () => {
  const mark = kills.length;
  let exits = 0;
  const take = CaptureTake.start(MISSING, undefined, { onExit: () => exits++ });
  const sent = take.abort();
  assert.equal(sent, false);
  const result = await take.stop();
  assert.equal(take.failure, "binary-missing");
  assert.match(take.stderr, /no-such-recorder/);
  assert.equal(result.exitCode, null);
  await sleep(20);
  assert.equal(exits, 0, "aborted takes never fire onExit");
  assert.deepEqual(killsSince(mark), [], "no signal for a child with no pid");
  assert.deepEqual(uncaught, []);
});

test("abort on a recorder that did spawn returns true and signals its real pid; stop() then resolves", async () => {
  const mark = kills.length;
  const take = CaptureTake.start(fakeRecorder(), undefined);
  await sleep(150);
  assert.equal(take.abort(), true);
  const result = await take.stop();
  assert.equal(result.exitCode, null, "killed by signal, no exit code");
  const sent = killsSince(mark);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].sig, "SIGKILL");
  assert.ok(Number.isInteger(sent[0].pid) && sent[0].pid > 0, `pid ${sent[0].pid}`);
});

test("a second abort sends no second signal, and abort after the child exited on its own returns false", async () => {
  const mark = kills.length;
  const take = CaptureTake.start(fakeRecorder(), undefined);
  await sleep(150);
  assert.equal(take.abort(), true);
  assert.equal(take.abort(), false);
  await take.stop();
  assert.equal(take.abort(), false);
  assert.equal(killsSince(mark).length, 1);

  const exited = CaptureTake.start(writeScript("exit0.sh", `#!/bin/sh\nexec "${process.execPath}" "${FAKE_CAPTURE}" --exit 0\n`), undefined);
  await exited.stop();
  const before = kills.length;
  assert.equal(exited.abort(), false);
  assert.equal(kills.length, before);
});

test("the stop grace timer signals the real pid of a child that ignores stdin closing", async () => {
  const mark = kills.length;
  const take = CaptureTake.start(deafRecorder(), undefined);
  await sleep(150);
  const started = Date.now();
  const result = await take.stop();
  assert.ok(Date.now() - started >= 2500, "reached the grace timer");
  assert.equal(result.exitCode, null);
  const sent = killsSince(mark);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].sig, "SIGKILL");
  assert.ok(Number.isInteger(sent[0].pid) && sent[0].pid > 0);
});

test("signalChild refuses a child with no pid and forwards the signal otherwise", async () => {
  const mark = kills.length;
  const { spawn } = require("child_process");
  const dead = spawn(MISSING, [], { stdio: "ignore" });
  dead.on("error", () => undefined);
  assert.equal(signalChild(dead, "SIGKILL"), false);
  assert.deepEqual(killsSince(mark), []);
  const live = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { stdio: "ignore" });
  const done = new Promise((r) => live.once("exit", r));
  assert.equal(signalChild(live, "SIGKILL"), true);
  await done;
  assert.equal(killsSince(mark).length, 1);
  assert.equal(killsSince(mark)[0].pid, live.pid);
});

test("claude-code: an abort on the spawn tick of a missing binary rejects with the abort error and signals nothing", async () => {
  const mark = kills.length;
  const cwd = fs.mkdtempSync(path.join(TMP, "cc-"));
  const generate = makeClaudeCodeInstruct({ cwd, binary: MISSING, log: () => undefined });
  const controller = new AbortController();
  const p = generate({ signal: controller.signal, apiBase: "", model: "claude-sonnet-4-5", prompt: "write a function", maxTokens: 64, temperature: 0 });
  controller.abort();
  await assert.rejects(p, (err) => err.name === "AbortError");
  await sleep(20);
  assert.deepEqual(killsSince(mark), []);
  assert.deepEqual(uncaught, []);
});

test("claude-code: a timeout of 0 on a missing binary rejects and signals nothing", async () => {
  const mark = kills.length;
  const cwd = fs.mkdtempSync(path.join(TMP, "cc-"));
  const generate = makeClaudeCodeInstruct({ cwd, binary: MISSING, timeoutMs: 0, log: () => undefined });
  await assert.rejects(
    generate({ signal: new AbortController().signal, apiBase: "", model: "claude-sonnet-4-5", prompt: "write a function", maxTokens: 64, temperature: 0 }),
  );
  await sleep(20);
  assert.deepEqual(killsSince(mark), []);
});

test("hardware probe: timeoutMs 0 on a missing command rejects with the spawn error and signals nothing", async () => {
  const mark = kills.length;
  const run = probeCommandRunner(0);
  await assert.rejects(run(MISSING, ["--version"]), (err) => err.code === "ENOENT");
  await sleep(20);
  assert.deepEqual(killsSince(mark), []);
});

test("recogniser: a server binary that fails to spawn signals nothing", async () => {
  const mark = kills.length;
  const model = path.join(TMP, "ggml-fake.bin");
  fs.writeFileSync(model, "x");
  // existsSync passes (the file is there), so this reaches spawn() and fails there
  // (EACCES) — a missing path never gets past the existsSync gate above spawn.
  const notExecutable = path.join(TMP, "not-executable");
  fs.writeFileSync(notExecutable, "#!/bin/sh\nexit 0\n", { mode: 0o644 });
  await assert.rejects(Recogniser.start({ binary: notExecutable, model }), /recogniser failed to start/);
  await sleep(20);
  assert.deepEqual(killsSince(mark), []);
});

// The witness below Node. strace prints every kill(2) the node process and its children
// make; the missing-path run must make none, the fake-recorder run must make exactly the
// one on the child's own pid.
const witnessSrc = (binary) => `
const { CaptureTake } = require(${JSON.stringify(BUNDLE)});
(async () => {
  const take = CaptureTake.start(${JSON.stringify(binary)}, undefined);
  const sent = take.abort();
  await take.stop();
  process.stdout.write(JSON.stringify({ sent, failure: take.failure ?? null }));
})();
`;

function straced(script) {
  const out = path.join(TMP, `${++seq}-strace.log`);
  const run = spawnSync(STRACE, ["-f", "-e", "trace=kill", "-o", out, process.execPath, script], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  const lines = fs.readFileSync(out, "utf8").split("\n").filter((l) => /\bkill\(/.test(l));
  return { result: JSON.parse(run.stdout), lines };
}

test("strace witness: the missing-path abort makes no kill(2) at all", { skip: STRACE === undefined && "strace not installed" }, () => {
  const { result, lines } = straced(writeScript("witness-missing.cjs", witnessSrc(MISSING)));
  assert.deepEqual(result, { sent: false, failure: "binary-missing" });
  assert.deepEqual(lines, []);
});

test("strace witness, positive control: the fake-recorder abort makes one kill(2) on a real pid", { skip: STRACE === undefined && "strace not installed" }, () => {
  const { result, lines } = straced(writeScript("witness-fake.cjs", witnessSrc(fakeRecorder())));
  assert.equal(result.sent, true);
  const pidMax = Number(fs.readFileSync("/proc/sys/kernel/pid_max", "utf8"));
  const sigkills = lines.filter((l) => /SIGKILL/.test(l));
  assert.equal(sigkills.length, 1, lines.join("\n"));
  const pid = Number(/kill\((\d+),/.exec(sigkills[0])[1]);
  assert.ok(pid > 0 && pid < pidMax, sigkills[0]);
});
