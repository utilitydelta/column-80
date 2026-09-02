// Blind oracle for session-v67 phase 0 (contracts/phase0-kill-guard.md): never
// signal a child that has no pid. Written against the contract only; nothing
// under src/ was read beyond exported signatures. Rows that need strace skip
// with a reason when `which strace` finds nothing. Rule 8 (twenty green runs
// of review-v66-p12) is the implementer's row, not this file's.
//
// Run: SKIP_LIVE=1 node --test test/blind-v67-p0-kill.test.cjs
//
// A word on the dice. Before the guard, rule 1's sequence sends SIGKILL to a
// garbage pid. One of the outcomes is that THIS runner dies; a run that ends in
// "Killed" with no summary is the defect, not a harness fault.

const test = require("node:test");
const { describe } = test;
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { bundleCore, sleep } = require("./.blind-util.cjs");

const TAG = "blind-v67-p0-kill";
const { mod, cleanup } = bundleCore(
  TAG,
  'export * from "../src/core/capture"; export * from "../src/core/claudeCodeInstruct"; export * from "../src/core/recogniser"; export * from "../src/core/hardware";\n'
);
const { CaptureTake, makeClaudeCodeInstruct, Recogniser, probeCommandRunner } = mod;
const BUNDLE = path.join(__dirname, `.${TAG}.bundle.cjs`);

const FIX = path.join(__dirname, "fixtures", "dictation");
const FAKE_CAPTURE = path.join(FIX, "fake-capture.cjs");
const STRACE = (() => {
  const r = spawnSync("which", ["strace"], { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : undefined;
})();
const PID_MAX = Number(fs.readFileSync("/proc/sys/kernel/pid_max", "utf8").trim());

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "c80-v67p0-"));
test.after(() => {
  cleanup();
  fs.rmSync(TMP, { recursive: true, force: true });
});

let seq = 0;
const tmpFile = (name) => path.join(TMP, `${++seq}-${name}`);
const missingPath = () => tmpFile("no-such-binary");

function writeScript(name, source, mode = 0o755) {
  const p = tmpFile(name);
  fs.writeFileSync(p, source, { mode });
  return p;
}

// A file that exists and is not executable: spawn reaches the kernel and
// fails with EACCES. A missing path may be caught by an existsSync gate
// before any spawn; this one cannot be.
const nonExecutable = () => writeScript("not-executable", "#!/bin/sh\nexit 0\n", 0o644);

// Records escapes from the process while a row runs. `uncaughtException`
// listeners suppress the crash, so the count is the evidence.
function escapeTrap() {
  const escaped = [];
  const onU = (e) => escaped.push(`uncaughtException: ${e && e.message}`);
  const onR = (e) => escaped.push(`unhandledRejection: ${e && e.message}`);
  process.on("uncaughtException", onU);
  process.on("unhandledRejection", onR);
  return {
    escaped,
    release: () => {
      process.off("uncaughtException", onU);
      process.off("unhandledRejection", onR);
    },
  };
}

function withTimeout(promise, ms, what) {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} did not settle within ${ms}ms`)), ms);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

async function waitFor(pred, ms, what) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await pred()) return;
    await sleep(20);
  }
  assert.fail(`timed out after ${ms}ms waiting for ${what}`);
}

const safeAbort = (take) => {
  try {
    take.abort();
  } catch {}
};

// Runs `body` (JS source with `mod` bound to the bundle) as its own node
// process under strace, tracing kill(2) only. Returns the kill lines.
function straceRun(name, body) {
  const script = writeScript(
    `${name}.cjs`,
    `const mod = require(${JSON.stringify(BUNDLE)});\n` +
      `const sleep = (ms) => new Promise((r) => setTimeout(r, ms));\n` +
      `(async () => {\n${body}\n})().then(() => process.exit(0), (e) => { console.error("script error:", e && e.message); process.exit(3); });\n`
  );
  const trace = tmpFile(`${name}.strace`);
  const r = spawnSync(STRACE, ["-f", "-e", "trace=kill", "-o", trace, process.execPath, script], {
    encoding: "utf8",
    timeout: 60_000,
  });
  const lines = fs.existsSync(trace) ? fs.readFileSync(trace, "utf8").split("\n") : [];
  const kills = lines.filter((l) => /\bkill\(/.test(l));
  return { status: r.status, signal: r.signal, stdout: r.stdout, stderr: r.stderr, kills };
}

const noKillMessage = (r, what) =>
  `expected no kill(2) under strace for ${what}; saw ${r.kills.length} line(s): ${r.kills.join(" | ")} (script exit ${r.status}${
    r.signal ? ` signal ${r.signal}` : ""
  }; stderr: ${(r.stderr || "").trim()})`;

// ---- rules 1 to 5: CaptureTake in-process.

describe("phase 0: CaptureTake never signals a child without a pid", () => {
  test("rule 1: abort() at once after start(<missing path>) returns false, throws nothing, and nothing escapes", async () => {
    const trap = escapeTrap();
    const missing = missingPath();
    const take = CaptureTake.start(missing, undefined);
    try {
      let returned;
      assert.doesNotThrow(() => {
        returned = take.abort();
      }, "abort() must not throw synchronously after a failed spawn");
      assert.strictEqual(returned, false, `expected abort() to return false (no pid to signal); saw ${JSON.stringify(returned)}`);
      // Node delivers the spawn error on the next tick; give it several.
      await sleep(200);
      assert.deepStrictEqual(trap.escaped, [], `expected nothing to escape the process; saw ${trap.escaped.join(" | ")}`);
    } finally {
      trap.release();
      await withTimeout(take.stop(), 5000, "stop after the missing-path abort").catch(() => {});
    }
  });

  test("rule 2: after rule 1's sequence stop() resolves, failure is binary-missing, stderr names the path, onExit stays silent", async () => {
    const trap = escapeTrap();
    const missing = missingPath();
    const exits = [];
    const take = CaptureTake.start(missing, undefined, { onExit: (r) => exits.push(r) });
    try {
      take.abort();
      const r = await withTimeout(take.stop(), 5000, "stop after the missing-path abort");
      assert.strictEqual(take.failure, "binary-missing", `expected take.failure "binary-missing"; saw ${JSON.stringify(take.failure)}`);
      assert.ok(
        typeof take.stderr === "string" && take.stderr.includes(missing),
        `expected take.stderr to name the missing path ${missing}; saw ${JSON.stringify(take.stderr)}`
      );
      assert.ok(r.stderr.includes(missing), `expected the result's stderr to name the missing path; saw ${JSON.stringify(r.stderr)}`);
      assert.strictEqual(r.exitCode, null, `expected exitCode null for a child that never ran; saw ${r.exitCode}`);
      await sleep(100);
      assert.strictEqual(exits.length, 0, `expected onExit not to fire for an aborted take; fired ${exits.length} time(s)`);
      assert.deepStrictEqual(trap.escaped, [], `expected nothing to escape the process; saw ${trap.escaped.join(" | ")}`);
    } finally {
      trap.release();
    }
  });

  test("rule 3: abort() on a spawned child returns true, the child exits by signal, stop() resolves", { timeout: 10_000 }, async () => {
    const take = CaptureTake.start(FAKE_CAPTURE, undefined);
    try {
      await sleep(150);
      const returned = take.abort();
      assert.strictEqual(returned, true, `expected abort() to return true for a child with a pid; saw ${JSON.stringify(returned)}`);
      const t0 = Date.now();
      const r = await withTimeout(take.stop(), 5000, "stop after abort");
      const elapsed = Date.now() - t0;
      assert.ok(elapsed < 2500, `expected stop to resolve well inside the grace period after a kill; took ${elapsed}ms`);
      // A signal exit carries no exit code.
      assert.strictEqual(r.exitCode, null, `expected exitCode null (exit by signal); saw ${r.exitCode}`);
    } finally {
      safeAbort(take);
    }
  });

  test("rule 4: the second abort() returns false; abort() after a self-exit returns false; both aborts on a missing path return false", { timeout: 10_000 }, async () => {
    // (a) twice on a live child.
    const live = CaptureTake.start(FAKE_CAPTURE, undefined);
    try {
      await sleep(150);
      const first = live.abort();
      const second = live.abort();
      assert.strictEqual(first, true, `live child, first abort: expected true; saw ${JSON.stringify(first)}`);
      assert.strictEqual(second, false, `live child, second abort: expected false (already signalled); saw ${JSON.stringify(second)}`);
      await withTimeout(live.stop(), 5000, "stop after two aborts");
    } finally {
      safeAbort(live);
    }

    // (b) after the child exited on its own (onExit is the contract's signal of that).
    const exitZero = writeScript("exit-0.sh", `#!/bin/sh\nexec "${process.execPath}" "${FAKE_CAPTURE}" --exit 0\n`);
    const exits = [];
    const done = CaptureTake.start(exitZero, undefined, { onExit: (r) => exits.push(r) });
    try {
      await waitFor(() => exits.length > 0, 5000, "onExit after the child's own exit");
      const after = done.abort();
      assert.strictEqual(after, false, `abort after a self-exit: expected false; saw ${JSON.stringify(after)}`);
      await withTimeout(done.stop(), 5000, "stop after a self-exit");
    } finally {
      safeAbort(done);
    }

    // (c) twice on a missing path: no pid at any point.
    const trap = escapeTrap();
    const gone = CaptureTake.start(missingPath(), undefined);
    try {
      const a = gone.abort();
      const b = gone.abort();
      assert.strictEqual(a, false, `missing path, first abort: expected false; saw ${JSON.stringify(a)}`);
      assert.strictEqual(b, false, `missing path, second abort: expected false; saw ${JSON.stringify(b)}`);
      await withTimeout(gone.stop(), 5000, "stop after two missing-path aborts");
      await sleep(100);
      assert.deepStrictEqual(trap.escaped, [], `expected nothing to escape the process; saw ${trap.escaped.join(" | ")}`);
    } finally {
      trap.release();
    }
  });

  // CONTRACT AMBIGUITY: rule 5 says the grace timer's no-pid branch is never
  // reached and the guard is "unconditional in code". A black-box row cannot
  // see code. It can see two things: a child with a pid that ignores stdin is
  // still killed by the timer (the guard lets a real pid through), and a
  // missing-path take stopped WITHOUT abort settles long before the grace
  // period with nothing escaping.
  test("rule 5: the stop grace timer still kills a real child, and a missing-path stop() without abort settles at once", { timeout: 15_000 }, async () => {
    const ignoring = writeScript("never-exits.cjs", `#!/usr/bin/env node\nprocess.stdin.resume();\nsetInterval(() => {}, 1000);\n`);
    const take = CaptureTake.start(ignoring, undefined);
    try {
      await sleep(100);
      const t0 = Date.now();
      const r = await withTimeout(take.stop(), 10_000, "stop of a child that ignores stdin");
      const elapsed = Date.now() - t0;
      assert.ok(elapsed >= 2500 && elapsed < 6000, `expected the grace kill around 3s; stop resolved after ${elapsed}ms`);
      assert.strictEqual(r.exitCode, null, `expected a signal exit (exitCode null) from the grace kill; saw ${r.exitCode}`);
    } finally {
      safeAbort(take);
    }

    const trap = escapeTrap();
    const missing = missingPath();
    const gone = CaptureTake.start(missing, undefined);
    try {
      const t0 = Date.now();
      const r = await withTimeout(gone.stop(), 5000, "stop of a missing-path take");
      const elapsed = Date.now() - t0;
      assert.ok(elapsed < 1500, `expected a missing-path stop to settle before the grace period; took ${elapsed}ms`);
      assert.strictEqual(gone.failure, "binary-missing", `expected failure "binary-missing"; saw ${JSON.stringify(gone.failure)}`);
      assert.ok(r.stderr.includes(missing), `expected stderr to name ${missing}; saw ${JSON.stringify(r.stderr)}`);
      await sleep(3500);
      assert.deepStrictEqual(trap.escaped, [], `expected nothing to escape after the grace period; saw ${trap.escaped.join(" | ")}`);
    } finally {
      trap.release();
    }
  });
});

// ---- rule 6: the strace witness.

describe("phase 0 rule 6: strace sees no kill(2) for a child that never spawned", () => {
  test("rule 6: start(<missing>) then abort() then stop() under strace -f -e trace=kill produces no kill( line", { timeout: 60_000 }, (t) => {
    if (!STRACE) return t.skip("strace is not on this box (which strace found nothing)");
    const missing = missingPath();
    const r = straceRun(
      "r6-missing",
      `const take = mod.CaptureTake.start(${JSON.stringify(missing)}, undefined);\n` +
        `const aborted = take.abort();\n` +
        `const result = await take.stop();\n` +
        `console.log(JSON.stringify({ aborted, failure: take.failure, exitCode: result.exitCode }));`
    );
    assert.strictEqual(r.status, 0, `expected the scratch script to exit 0; exit ${r.status} signal ${r.signal}; stderr: ${(r.stderr || "").trim()}`);
    assert.deepStrictEqual(r.kills, [], noKillMessage(r, "start(<missing>) + abort() + stop()"));
  });

  test("rule 6 positive control: abort() on the fake recorder under strace shows kill(<real pid>, SIGKILL)", { timeout: 60_000 }, (t) => {
    if (!STRACE) return t.skip("strace is not on this box (which strace found nothing)");
    const r = straceRun(
      "r6-control",
      `const take = mod.CaptureTake.start(${JSON.stringify(FAKE_CAPTURE)}, undefined);\n` +
        `await sleep(200);\n` +
        `const aborted = take.abort();\n` +
        `const result = await take.stop();\n` +
        `console.log(JSON.stringify({ aborted, exitCode: result.exitCode }));`
    );
    assert.strictEqual(r.status, 0, `expected the control script to exit 0; exit ${r.status} signal ${r.signal}; stderr: ${(r.stderr || "").trim()}`);
    const sigkills = r.kills.map((l) => l.match(/\bkill\((-?\d+), SIGKILL\)/)).filter(Boolean);
    assert.ok(sigkills.length >= 1, `expected at least one kill(<pid>, SIGKILL) line; kill lines seen: ${r.kills.join(" | ") || "(none)"}`);
    for (const m of sigkills) {
      const pid = Number(m[1]);
      assert.ok(pid > 0 && pid < PID_MAX, `expected a real pid (0 < pid < ${PID_MAX}); saw ${pid} in "${m[0]}"`);
    }
    assert.ok(/"aborted":true/.test(r.stdout), `expected the control's abort() to return true; script printed ${r.stdout.trim()}`);
  });
});

// ---- rule 7: the sweep. Each surface gets the same rule: signal only when
// pid !== undefined. The only outside witness of a garbage kill is strace, so
// each reachable surface has an in-process row (rejects, nothing escapes) and
// an strace row (no kill( line).

describe("phase 0 rule 7 sweep: claudeCodeInstruct", () => {
  const params = (signal) => ({
    apiBase: "http://127.0.0.1:1",
    model: "claude-sonnet",
    prompt: "say nothing",
    maxTokens: 8,
    temperature: 0,
    signal,
  });
  const emptyCwd = () => {
    const d = tmpFile("instruct-cwd");
    fs.mkdirSync(d);
    return d;
  };

  for (const [label, binaryOf] of [
    ["missing path", missingPath],
    ["non-executable file", nonExecutable],
  ]) {
    test(`rule 7a: AbortSignal aborted on the spawn tick of a ${label} rejects and nothing escapes`, { timeout: 15_000 }, async () => {
      const trap = escapeTrap();
      try {
        const gen = makeClaudeCodeInstruct({ cwd: emptyCwd(), binary: binaryOf() });
        const ac = new AbortController();
        const p = gen(params(ac.signal));
        ac.abort();
        await assert.rejects(withTimeout(p, 10_000, "the instruct round"), (e) => {
          assert.ok(e instanceof Error, `expected an Error rejection; saw ${String(e)}`);
          assert.ok(!/did not settle/.test(e.message), e.message);
          return true;
        });
        await sleep(200);
        assert.deepStrictEqual(trap.escaped, [], `expected nothing to escape the process; saw ${trap.escaped.join(" | ")}`);
      } finally {
        trap.release();
      }
    });

    test(`rule 7a: timeoutMs 0 on a ${label} rejects and nothing escapes`, { timeout: 15_000 }, async () => {
      const trap = escapeTrap();
      try {
        const gen = makeClaudeCodeInstruct({ cwd: emptyCwd(), binary: binaryOf(), timeoutMs: 0 });
        const ac = new AbortController();
        await assert.rejects(withTimeout(gen(params(ac.signal)), 10_000, "the instruct round"), (e) => {
          assert.ok(!/did not settle/.test(e.message), e.message);
          return true;
        });
        await sleep(200);
        assert.deepStrictEqual(trap.escaped, [], `expected nothing to escape the process; saw ${trap.escaped.join(" | ")}`);
      } finally {
        trap.release();
      }
    });

    test(`rule 7a witness: same-tick abort and timeoutMs 0 on a ${label} send no kill(2) under strace`, { timeout: 60_000 }, (t) => {
      if (!STRACE) return t.skip("strace is not on this box (which strace found nothing)");
      const cwd = emptyCwd();
      const binary = binaryOf();
      const r = straceRun(
        `r7a-${label.replace(/\W+/g, "-")}`,
        `const p = { apiBase: "http://127.0.0.1:1", model: "claude-sonnet", prompt: "say nothing", maxTokens: 8, temperature: 0 };\n` +
          `const gen = mod.makeClaudeCodeInstruct({ cwd: ${JSON.stringify(cwd)}, binary: ${JSON.stringify(binary)} });\n` +
          `const ac = new AbortController();\n` +
          `const round = gen({ ...p, signal: ac.signal });\n` +
          `ac.abort();\n` +
          `await round.catch((e) => console.log("abort round rejected:", e.message));\n` +
          `const gen0 = mod.makeClaudeCodeInstruct({ cwd: ${JSON.stringify(cwd)}, binary: ${JSON.stringify(binary)}, timeoutMs: 0 });\n` +
          `await gen0({ ...p, signal: new AbortController().signal }).catch((e) => console.log("timeout round rejected:", e.message));\n` +
          `await sleep(300);`
      );
      assert.strictEqual(r.status, 0, `expected the scratch script to exit 0; exit ${r.status} signal ${r.signal}; stderr: ${(r.stderr || "").trim()}`);
      assert.deepStrictEqual(r.kills, [], noKillMessage(r, `claudeCodeInstruct on a ${label}`));
    });
  }
});

describe("phase 0 rule 7 sweep: Recogniser", () => {
  // CONTRACT AMBIGUITY: rule 7 names `dispose()` on "a Recogniser whose server
  // binary is missing". `Recogniser.start` is the only way to get an instance
  // and it rejects for a binary that cannot spawn, so dispose() on that
  // instance is unreachable from outside. The row binds what is reachable: the
  // start path of a binary whose spawn fails, which must reject without the
  // start deadline's kill touching a garbage pid.
  const model = () => {
    const p = tmpFile("ggml-fake.bin");
    fs.writeFileSync(p, "{}");
    return p;
  };

  for (const [label, binaryOf] of [
    ["missing path", missingPath],
    ["non-executable file", nonExecutable],
  ]) {
    test(`rule 7b: Recogniser.start on a ${label} rejects promptly and nothing escapes`, { timeout: 30_000 }, async () => {
      const trap = escapeTrap();
      try {
        const t0 = Date.now();
        await assert.rejects(withTimeout(Recogniser.start({ binary: binaryOf(), model: model() }), 25_000, "Recogniser.start"), (e) => {
          assert.ok(!/did not settle/.test(e.message), e.message);
          return true;
        });
        const elapsed = Date.now() - t0;
        assert.ok(elapsed < 5000, `expected a spawn failure to reject at once, not at the start deadline; took ${elapsed}ms`);
        await sleep(200);
        assert.deepStrictEqual(trap.escaped, [], `expected nothing to escape the process; saw ${trap.escaped.join(" | ")}`);
      } finally {
        trap.release();
      }
    });

    test(`rule 7b witness: Recogniser.start on a ${label} sends no kill(2) under strace`, { timeout: 60_000 }, (t) => {
      if (!STRACE) return t.skip("strace is not on this box (which strace found nothing)");
      const r = straceRun(
        `r7b-${label.replace(/\W+/g, "-")}`,
        `await mod.Recogniser.start({ binary: ${JSON.stringify(binaryOf())}, model: ${JSON.stringify(model())} })\n` +
          `  .then((rec) => { rec.dispose(); console.log("started?!"); }, (e) => console.log("rejected:", e.message));\n` +
          `await sleep(300);`
      );
      assert.strictEqual(r.status, 0, `expected the scratch script to exit 0; exit ${r.status} signal ${r.signal}; stderr: ${(r.stderr || "").trim()}`);
      assert.deepStrictEqual(r.kills, [], noKillMessage(r, `Recogniser.start on a ${label}`));
    });
  }
});

describe("phase 0 rule 7 sweep: probeCommandRunner", () => {
  test("rule 7c: timeoutMs 0 with a missing command rejects with the spawn error, not a timeout", { timeout: 15_000 }, async () => {
    const trap = escapeTrap();
    const missing = missingPath();
    try {
      await assert.rejects(withTimeout(probeCommandRunner(0)(missing, []), 10_000, "the probe"), (e) => {
        assert.ok(e instanceof Error, `expected an Error rejection; saw ${String(e)}`);
        assert.ok(
          e.code === "ENOENT" || /ENOENT/.test(e.message),
          `expected the spawn error (ENOENT) for ${missing}; saw code=${e.code} message=${JSON.stringify(e.message)}`
        );
        return true;
      });
      await sleep(200);
      assert.deepStrictEqual(trap.escaped, [], `expected nothing to escape the process; saw ${trap.escaped.join(" | ")}`);
    } finally {
      trap.release();
    }
  });

  test("rule 7c witness: timeoutMs 0 with a missing command sends no kill(2) under strace", { timeout: 60_000 }, (t) => {
    if (!STRACE) return t.skip("strace is not on this box (which strace found nothing)");
    const r = straceRun(
      "r7c-probe",
      `await mod.probeCommandRunner(0)(${JSON.stringify(missingPath())}, []).then(\n` +
        `  (v) => console.log("resolved?!", JSON.stringify(v)), (e) => console.log("rejected:", e.message));\n` +
        `await sleep(300);`
    );
    assert.strictEqual(r.status, 0, `expected the scratch script to exit 0; exit ${r.status} signal ${r.signal}; stderr: ${(r.stderr || "").trim()}`);
    assert.deepStrictEqual(r.kills, [], noKillMessage(r, "probeCommandRunner(0) on a missing command"));
  });
});

describe("phase 0 rule 7 sweep: the four LSP clients", () => {
  // Each client's constructor is private and `start` resolves only after a
  // real server answers initialize; rust-analyzer and dotnet are resolved off
  // PATH inside start. dispose() is unreachable without a live server, so
  // these rows skip by name. The implementer's rule 8 run and a code review
  // carry this part of the sweep.
  for (const [client, why] of [
    ["raLspClient.dispose()", "RaLspExtractor.start spawns rust-analyzer off PATH; no seam to hand it a missing binary"],
    ["goLspExtractor.dispose()", "GoLspExtractor.start waits for gopls to answer initialize; a missing gopls never yields an instance to dispose"],
    ["csLspExtractor.dispose()", "CsLspExtractor.start spawns dotnet with a server dll; needs a real Roslyn LSP to yield an instance"],
    ["pyLspExtractor.dispose()", "PyLspExtractor.start waits for pyright to answer initialize; a missing server never yields an instance to dispose"],
  ]) {
    test(`rule 7d: ${client} guards proc.kill() on pid`, (t) => {
      t.skip(`not reachable blind: ${why}`);
    });
  }
});
