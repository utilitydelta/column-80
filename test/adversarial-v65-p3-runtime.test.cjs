// ADVERSARIAL REVIEW - session-v65 phase 3 (contracts/phase3-runtime.md): the
// recogniser and the recorder as processes, the speaker mute, the download.
// Rules as ever: FAILING rows are defect claims with evidence, PASSING rows
// are attacks that did not land, kept as the record. Rows that need a binary
// or a model skip with the reason when the file is absent.
//
// Sections:
//   R - Recogniser: the freePort/spawn TOCTOU (four starts at once, and a
//       stranger already answering on the chosen port), a child that floods
//       stderr, a child that ignores SIGTERM at the 20s timeout, transcribe
//       racing dispose, a 200 with a non-JSON body, the real server on
//       offset/duration past the end, a 60s take, threads 0 and -1, a VAD
//       model path that does not exist, the exited line firing once.
//   C - CaptureTake: stop before the first chunk, a fat tail after stdin
//       closes (does the setImmediate turn catch it?), abort then stop,
//       the pcm getter's cost, hooks that throw, a device name with spaces
//       and quotes, --list printing JSON then exiting 2, the new onExit hook,
//       and the REAL binary's chunk cadence on a monitor device.
//   M - speakerMute: run throwing, code null, restore twice, real output
//       shapes, a run that resolves without stdout.
//   D - downloadFile: a dest directory that does not exist, content-length
//       longer than the body, redirects, progress monotonicity, abort after
//       completion, upper-case sha256, modelPresent on a dir and a symlink.
//   X - leaks: process.getActiveResourcesInfo() before and after each module.
//
// Run: SKIP_LIVE=1 node --test test/adversarial-v65-p3-runtime.test.cjs

const test = require("node:test");
const { describe, after } = test;
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const net = require("net");
const path = require("path");
const http = require("http");
const crypto = require("crypto");
const { bundleCore, sleep } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "adversarial-v65-p3-runtime",
  'export * from "../src/core/nativeLayout"; export * from "../src/core/recogniser"; export * from "../src/core/capture"; export * from "../src/core/speakerMute"; export * from "../src/core/modelFile";\n'
);
const { Recogniser, listCaptureDevices, CaptureTake, muteSpeakers, downloadFile, modelPresent, SPEECH_MODEL } = mod;

const ROOT = path.resolve(__dirname, "..");
const FIX = path.join(__dirname, "fixtures", "dictation");
const FAKE_CAPTURE = path.join(FIX, "fake-capture.cjs");
const FAKE_WHISPER = path.join(FIX, "fake-whisper-server.cjs");
const REAL_WHISPER = path.join(ROOT, "native", "bin", "linux-x64", "whisper-server");
const REAL_CAPTURE = path.join(ROOT, "native", "bin", "linux-x64", "column80-capture");
const SPEECH_MODEL_PATH =
  process.env.COLUMN80_WHISPER_MODEL || path.join(ROOT, "session-v65", "spikes", "wcpp", "models", "ggml-base.en.bin");
const pcmOf = (file) => fs.readFileSync(path.join(FIX, file)).subarray(44);

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "c80-adv-p3-"));
test.after(() => {
  cleanup();
  fs.rmSync(TMP, { recursive: true, force: true });
});
let seq = 0;
const tmpFile = (name) => path.join(TMP, `${++seq}-${name}`);
function writeScript(name, source) {
  const p = tmpFile(name);
  fs.writeFileSync(p, "#!/usr/bin/env node\n" + source, { mode: 0o755 });
  return p;
}
function fakeModel(cfg) {
  const p = tmpFile("ggml-fake.bin");
  fs.writeFileSync(p, JSON.stringify(cfg));
  return p;
}
function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
}
function killQuiet(pid) {
  try {
    process.kill(pid, "SIGKILL");
  } catch {}
}
async function waitFor(pred, ms, what) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await pred()) return;
    await sleep(20);
  }
  assert.fail(`timed out after ${ms}ms waiting for ${what}`);
}
const withTimeout = (p, ms, what) =>
  Promise.race([p, sleep(ms).then(() => Promise.reject(new Error(`HUNG: ${what} did not settle in ${ms}ms`)))]);
const realMissing = !fs.existsSync(REAL_WHISPER)
  ? `whisper-server absent at ${REAL_WHISPER}`
  : !fs.existsSync(SPEECH_MODEL_PATH)
    ? `speech model absent at ${SPEECH_MODEL_PATH}`
    : undefined;

// ---- R: Recogniser.

describe("R: recogniser, fake server", () => {
  const recs = [];
  after(() => recs.forEach((r) => r.dispose()));

  test("R1: four concurrent starts get four different ports and all answer (freePort/spawn TOCTOU)", { timeout: 60000 }, async () => {
    const model = fakeModel({ mode: "serve" });
    const four = await Promise.all([0, 1, 2, 3].map(() => Recogniser.start({ binary: FAKE_WHISPER, model })));
    recs.push(...four);
    const ports = four.map((r) => r.port);
    assert.strictEqual(new Set(ports).size, 4, `ports ${ports.join(",")}`);
    for (const r of four) {
      const out = await r.transcribe(pcmOf("threat-level-3s.wav"));
      assert.strictEqual(out.text, "  Fake heard this. \n");
    }
  });

  test("R2: a stranger already answering on the chosen port: start must not resolve against it", { timeout: 20000 }, async () => {
    // Force freePort to hand back a port a stranger holds. The bundle reads
    // net.createServer at call time, so a patch on the module object lands.
    const stranger = http.createServer((_req, res) => res.end("stranger"));
    await new Promise((r) => stranger.listen(0, "127.0.0.1", r));
    const strangerPort = stranger.address().port;
    const orig = net.createServer;
    net.createServer = () => ({
      once() {},
      listen(_p, _h, cb) {
        cb();
      },
      address: () => ({ port: strangerPort }),
      close: (cb) => cb(),
    });
    const logs = [];
    const model = fakeModel({ mode: "serve" });
    let rec;
    try {
      rec = await Recogniser.start({ binary: FAKE_WHISPER, model, log: (l) => logs.push(l) });
    } catch (e) {
      // The contract's answer: the child exited first (EADDRINUSE), so start rejects.
      assert.match(e.message, /exited with code/);
      stranger.close();
      return;
    } finally {
      net.createServer = orig;
    }
    recs.push(rec);
    const exitAtResolve = rec.child.exitCode;
    await sleep(1500);
    stranger.close();
    assert.fail(
      `start RESOLVED on the stranger's port ${rec.port} with child.exitCode=${exitAtResolve} already; 1.5s later alive=${rec.alive}, child.exitCode=${rec.child.exitCode}; log:\n${logs.join("\n")}`,
    );
  });

  test("R2b: the child dies during the poll's await fetch: alive stays true forever (exit listener attached too late)", { timeout: 20000 }, async () => {
    const stranger = http.createServer((_req, res) => setTimeout(() => res.end("slow stranger"), 400));
    await new Promise((r) => stranger.listen(0, "127.0.0.1", r));
    const strangerPort = stranger.address().port;
    const orig = net.createServer;
    net.createServer = () => ({ once() {}, listen(_p, _h, cb) { cb(); }, address: () => ({ port: strangerPort }), close: (cb) => cb() });
    const logs = [];
    const model = fakeModel({ mode: "serve" });
    let rec;
    try {
      rec = await Recogniser.start({ binary: FAKE_WHISPER, model, log: (l) => logs.push(l) });
    } catch (e) {
      assert.match(e.message, /exited with code/);
      return;
    } finally {
      net.createServer = orig;
      stranger.close();
    }
    recs.push(rec);
    await sleep(1000);
    assert.ok(
      !rec.alive,
      `start resolved with child.exitCode=${rec.child.exitCode} already; 1s later alive=${rec.alive}, child.exitCode=${rec.child.exitCode}; exited line logged=${logs.some((l) => /exited/.test(l))}`,
    );
  });

  test("R3: a child that floods stderr does not block, and transcribe still answers", { timeout: 30000 }, async () => {
    const flood = writeScript(
      "flood-whisper.cjs",
      `const line = "x".repeat(1024) + "\\n";
       setInterval(() => { for (let i = 0; i < 64; i++) process.stderr.write(line); }, 1);
       require(${JSON.stringify(FAKE_WHISPER)});`,
    );
    const model = fakeModel({ mode: "serve" });
    const rec = await Recogniser.start({ binary: flood, model });
    recs.push(rec);
    await sleep(1000);
    const t0 = Date.now();
    const out = await withTimeout(rec.transcribe(pcmOf("threat-level-3s.wav")), 5000, "transcribe under stderr flood");
    assert.strictEqual(out.text, "  Fake heard this. \n");
    assert.ok(Date.now() - t0 < 2000, `transcribe took ${Date.now() - t0}ms under the flood`);
  });

  test("R4: 200 with a non-JSON body rejects with a sentence naming the recogniser (not a bare SyntaxError)", { timeout: 20000 }, async () => {
    const bad = writeScript(
      "nonjson-whisper.cjs",
      `const http = require("http"); const a = process.argv;
       const port = Number(a[a.indexOf("--port") + 1]);
       http.createServer((req, res) => { res.statusCode = 200; res.end(req.url === "/inference" ? "<html>busy</html>" : "up"); }).listen(port, "127.0.0.1");`,
    );
    const model = fakeModel({});
    const rec = await Recogniser.start({ binary: bad, model });
    recs.push(rec);
    let msg;
    try {
      await rec.transcribe(pcmOf("threat-level-3s.wav"));
      assert.fail("resolved on an HTML body");
    } catch (e) {
      msg = e.message;
    }
    assert.match(msg, /recogniser|server-down/i, `message was: ${msg}`);
  });

  test("R5: 200 with {} resolves empty text (documented)", { timeout: 20000 }, async () => {
    const model = fakeModel({ mode: "serve", text: undefined });
    const empty = writeScript(
      "empty-json-whisper.cjs",
      `const http = require("http"); const a = process.argv;
       const port = Number(a[a.indexOf("--port") + 1]);
       http.createServer((req, res) => { res.setHeader("content-type","application/json"); res.end("{}"); }).listen(port, "127.0.0.1");`,
    );
    const rec = await Recogniser.start({ binary: empty, model });
    recs.push(rec);
    const out = await rec.transcribe(pcmOf("threat-level-3s.wav"));
    assert.strictEqual(out.text, "");
  });

  test("R6: transcribe racing dispose rejects server-down, not AbortError, and nothing hangs", { timeout: 20000 }, async () => {
    const delayFile = tmpFile("delay");
    fs.writeFileSync(delayFile, "1500");
    const model = fakeModel({ mode: "serve", delayFile });
    const rec = await Recogniser.start({ binary: FAKE_WHISPER, model });
    const p = rec.transcribe(pcmOf("threat-level-3s.wav"));
    await sleep(100);
    rec.dispose();
    await assert.rejects(withTimeout(p, 5000, "transcribe after dispose"), (e) => {
      assert.match(e.message, /server-down/, e.message);
      assert.notStrictEqual(e.name, "AbortError");
      return true;
    });
  });

  test("R7: the exited log line fires exactly once when the child dies on its own", { timeout: 20000 }, async () => {
    const logs = [];
    const model = fakeModel({ mode: "serve" });
    const rec = await Recogniser.start({ binary: FAKE_WHISPER, model, log: (l) => logs.push(l) });
    recs.push(rec);
    await new Promise((resolve, reject) => http.get({ host: "127.0.0.1", port: rec.port, path: "/quit" }, (r) => r.resume().on("end", resolve)).on("error", reject));
    await waitFor(() => !rec.alive, 3000, "alive to drop");
    await sleep(200);
    rec.dispose();
    await sleep(50);
    const exited = logs.filter((l) => l.startsWith("[dictate] recogniser exited"));
    assert.deepStrictEqual(exited, ["[dictate] recogniser exited code=3"]);
  });

  test("R8: threads 0, -1 and 1.5 are clamped to a whole thread count (FIXED after review)", { timeout: 20000 }, async () => {
    for (const [threads, expected] of [[0, "1"], [-1, "1"], [1.5, "1"]]) {
      const argvFile = tmpFile("argv.json");
      const model = fakeModel({ mode: "exit", exitCode: 1, argvFile });
      await assert.rejects(Recogniser.start({ binary: FAKE_WHISPER, model, threads }));
      const argv = JSON.parse(fs.readFileSync(argvFile, "utf8"));
      assert.strictEqual(argv[argv.indexOf("-t") + 1], expected);
    }
  });
});

describe("R: the 20s timeout against a child that ignores SIGTERM", () => {
  test("R9: after the timeout the child is dead (contract rule 1); SIGTERM alone is not a kill", { timeout: 40000 }, async () => {
    const pidFile = tmpFile("pid");
    const stubborn = writeScript(
      "stubborn-whisper.cjs",
      `require("fs").writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
       process.on("SIGTERM", () => {}); process.on("SIGINT", () => {});
       setInterval(() => {}, 1000);`,
    );
    const model = fakeModel({});
    let pid;
    try {
      await assert.rejects(Recogniser.start({ binary: stubborn, model }), /did not come up in time/);
      pid = Number(fs.readFileSync(pidFile, "utf8"));
      await sleep(1000);
      assert.ok(!pidAlive(pid), `pid ${pid} is still alive 1s after start rejected on the 20s timeout`);
    } finally {
      if (pid) killQuiet(pid);
    }
  });
});

describe("R-real: the real whisper-server", () => {
  let rec;
  after(() => rec && rec.dispose());
  const gate = (t) => {
    if (realMissing) return t.skip(realMissing), false;
    if (!rec) return t.skip("start row failed"), false;
    return true;
  };

  test("R10: starts", { timeout: 60000 }, async (t) => {
    if (realMissing) return t.skip(realMissing);
    rec = await Recogniser.start({ binary: REAL_WHISPER, model: SPEECH_MODEL_PATH });
  });

  test("R11: offsetMs past the take's end: status, text, time (measurement)", { timeout: 30000 }, async (t) => {
    if (!gate(t)) return;
    const pcm = pcmOf("threat-level-3s.wav");
    const results = [];
    for (const opts of [{ offsetMs: 10000 }, { offsetMs: 2000, durationMs: 60000 }, { offsetMs: 2900, durationMs: 50 }]) {
      const t0 = Date.now();
      try {
        const out = await withTimeout(rec.transcribe(pcm, opts), 15000, "past-end transcribe");
        results.push(`${JSON.stringify(opts)} -> 200 text=${JSON.stringify(out.text)} in ${Date.now() - t0}ms`);
      } catch (e) {
        results.push(`${JSON.stringify(opts)} -> REJECT ${e.message} in ${Date.now() - t0}ms`);
      }
    }
    t.diagnostic(results.join(" | "));
    assert.strictEqual(rec.alive, true, "server survived");
    assert.ok(!results.some((r) => /HUNG/.test(r)), results.join("\n"));
  });

  test("R12: a 60s take through one request (measurement)", { timeout: 120000 }, async (t) => {
    if (!gate(t)) return;
    const one = Buffer.concat([pcmOf("threat-level-3s.wav"), pcmOf("min-max-6s.wav"), pcmOf("fallback-batch-11s.wav")]);
    const sixty = Buffer.concat([one, one, one]);
    const t0 = Date.now();
    const out = await withTimeout(rec.transcribe(sixty), 100000, "60s transcribe");
    const ms = Date.now() - t0;
    t.diagnostic(`60s take (${sixty.length} bytes, ${(sixty.length / 32000).toFixed(1)}s): ${ms}ms, ${out.text.length} chars, threat-level x${(out.text.match(/threat level/gi) || []).length}, fallback x${(out.text.match(/(fallback|full-back) batch/gi) || []).length}`);
    assert.ok((out.text.match(/threat level/gi) || []).length >= 2, `expected all three repeats heard; text: ${out.text}`);
  });

  test("R13: threads 0 / -1 against the real server (measurement)", { timeout: 60000 }, async (t) => {
    if (realMissing) return t.skip(realMissing);
    const notes = [];
    for (const threads of [0, -1]) {
      let r;
      try {
        r = await Recogniser.start({ binary: REAL_WHISPER, model: SPEECH_MODEL_PATH, threads });
        const t0 = Date.now();
        const out = await withTimeout(r.transcribe(pcmOf("threat-level-3s.wav")), 20000, `transcribe with -t ${threads}`);
        notes.push(`-t ${threads}: started, decode ${Date.now() - t0}ms text=${JSON.stringify(out.text.trim())}`);
      } catch (e) {
        notes.push(`-t ${threads}: ${e.message}`);
      } finally {
        r?.dispose();
      }
    }
    t.diagnostic(notes.join(" | "));
  });

  test("R14: a vadModel path that does not exist is not checked before spawn; what does the server do?", { timeout: 60000 }, async (t) => {
    if (realMissing) return t.skip(realMissing);
    const logs = [];
    let r;
    try {
      r = await Recogniser.start({ binary: REAL_WHISPER, model: SPEECH_MODEL_PATH, vadModel: path.join(TMP, "no-such-vad.bin"), log: (l) => logs.push(l) });
    } catch (e) {
      t.diagnostic(`start rejected: ${e.message}`);
      assert.match(e.message, /vad/i, `the rejection should name the VAD model; got: ${e.message}`);
      return;
    }
    const probe = async (opts) => {
      try {
        const out = await withTimeout(r.transcribe(pcmOf("threat-level-3s.wav"), opts), 20000, "transcribe with missing vad");
        return `answered ${JSON.stringify(out.text.trim())}`;
      } catch (e) {
        return `rejected: ${e.message}`;
      }
    };
    try {
      const withVad = await probe({});
      const noVad = await probe({ vad: false });
      assert.fail(`start resolved with a missing VAD model (alive=${r.alive}); transcribe ${withVad}; with vad:false ${noVad}; log: ${logs.join(" | ")}`);
    } finally {
      r.dispose();
    }
  });

  test("R15: dispose kills the real server within 2s (SIGTERM honoured)", { timeout: 20000 }, async (t) => {
    if (!gate(t)) return;
    const pid = rec.child.pid;
    rec.dispose();
    await waitFor(() => !pidAlive(pid), 2000, `real whisper-server pid ${pid} to die`);
    rec = undefined;
  });
});

// ---- C: CaptureTake.

describe("C: CaptureTake", () => {
  test("C1: stop before the first stdout chunk still returns the tail slice", { timeout: 10000 }, async () => {
    const take = CaptureTake.start(FAKE_CAPTURE, undefined);
    const out = await take.stop();
    assert.strictEqual(out.exitCode, 0);
    assert.ok(out.pcm.length >= 640, `got ${out.pcm.length} bytes`);
  });

  test("C2: a fat tail (4MB) written after stdin closes is fully in stop()'s pcm", { timeout: 15000 }, async () => {
    const fat = writeScript(
      "fat-tail-capture.cjs",
      `process.stdin.resume();
       process.stdin.on("end", () => { process.stdout.write(Buffer.alloc(4 * 1024 * 1024, 7), () => process.exit(0)); });`,
    );
    const take = CaptureTake.start(fat, undefined);
    await sleep(200);
    const out = await take.stop();
    assert.strictEqual(out.exitCode, 0);
    assert.strictEqual(out.pcm.length, 4 * 1024 * 1024, `stop returned ${out.pcm.length} of 4194304 tail bytes`);
  });

  test("C3: abort then stop resolves with exitCode null", { timeout: 10000 }, async () => {
    const take = CaptureTake.start(FAKE_CAPTURE, undefined);
    await sleep(100);
    take.abort();
    const out = await withTimeout(take.stop(), 5000, "stop after abort");
    assert.strictEqual(out.exitCode, null);
  });

  test("C4: pcm getter cost on a 60s take, 100 reads (measurement)", async (t) => {
    const chunker = writeScript("burst-capture.cjs", `process.stdin.resume(); process.stdin.on("end", () => process.exit(0));`);
    const take = CaptureTake.start(chunker, undefined);
    // Feed 3000 slices of 640 bytes straight into the take's private chunk list, the shape a 60s take has.
    for (let i = 0; i < 3000; i++) take.chunks.push(Buffer.alloc(640, i & 0xff));
    const t0 = process.hrtime.bigint();
    let n = 0;
    for (let i = 0; i < 100; i++) n += take.pcm.length;
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    await take.stop();
    t.diagnostic(`100 pcm reads of a 60s take (${n / 100} bytes): ${ms.toFixed(1)}ms total, ${(ms / 100).toFixed(2)}ms each`);
    assert.ok(ms < 2000);
  });

  test("C5: onFirstBuffer throwing loses the first chunk and escapes as an uncaught exception", { timeout: 10000 }, async () => {
    const prev = process.rawListeners("uncaughtException");
    process.removeAllListeners("uncaughtException");
    const uncaught = [];
    process.on("uncaughtException", (e) => uncaught.push(e.message));
    let take;
    try {
      take = CaptureTake.start(FAKE_CAPTURE, undefined, {
        onFirstBuffer: () => {
          throw new Error("ui hook blew up");
        },
      });
      await sleep(300);
      const out = await take.stop();
      const expected = pcmOf("threat-level-3s.wav");
      const firstKept = out.pcm.subarray(0, 640).equals(expected.subarray(0, 640));
      assert.ok(
        firstKept && uncaught.length === 0,
        `first chunk kept=${firstKept} (pcm starts with fixture offset ${expected.indexOf(out.pcm.subarray(0, 640))}); escaped to process as uncaughtException: ${JSON.stringify(uncaught)}`,
      );
    } finally {
      process.removeAllListeners("uncaughtException");
      for (const l of prev) process.on("uncaughtException", l);
    }
  });

  test("C6: onChunk throwing escapes as an uncaught exception (the chunk itself is kept)", { timeout: 10000 }, async () => {
    const prev = process.rawListeners("uncaughtException");
    process.removeAllListeners("uncaughtException");
    const uncaught = [];
    process.on("uncaughtException", (e) => uncaught.push(e.message));
    try {
      let calls = 0;
      const take = CaptureTake.start(FAKE_CAPTURE, undefined, {
        onChunk: () => {
          if (++calls === 2) throw new Error("chunk hook blew up");
        },
      });
      await sleep(300);
      const out = await take.stop();
      assert.ok(out.pcm.length >= 640 * 5, `bytes ${out.pcm.length}`);
      assert.deepStrictEqual(uncaught, [], `hook throw escaped to process: ${uncaught.join(",")}`);
    } finally {
      process.removeAllListeners("uncaughtException");
      for (const l of prev) process.on("uncaughtException", l);
    }
  });

  test("C7: a device name with spaces, quotes and a dollar reaches argv verbatim", { timeout: 10000 }, async () => {
    const name = `Monitor of "USB" Audio $HOME 'x'`;
    const take = CaptureTake.start(FAKE_CAPTURE, name);
    await sleep(100);
    const out = await take.stop();
    const line = out.stderr.split("\n").find((l) => l.startsWith("argv "));
    assert.deepStrictEqual(JSON.parse(line.slice(5)), ["--device", name]);
  });

  test("C8: --list printing a device array then exiting 2: exit 2 wins, the array is dropped (documented)", async () => {
    const both = writeScript("list-then-2.cjs", `process.stdout.write('[{"name":"Mic","default":true}]\\n', () => process.exit(2));`);
    assert.deepStrictEqual(await listCaptureDevices(both), []);
  });

  test("C9: onExit (new hook) fires with the whole tail when the child dies on its own", { timeout: 10000 }, async () => {
    const dies = writeScript(
      "dies-capture.cjs",
      `process.stdin.resume();
       setTimeout(() => { process.stdout.write(Buffer.alloc(4 * 1024 * 1024, 9), () => process.exit(1)); }, 100);`,
    );
    const seen = [];
    const take = CaptureTake.start(dies, undefined, { onExit: (r) => seen.push(r) });
    await waitFor(() => seen.length > 0, 5000, "onExit");
    assert.strictEqual(seen[0].exitCode, 1);
    assert.strictEqual(seen[0].pcm.length, 4 * 1024 * 1024, `onExit saw ${seen[0].pcm.length} of 4194304 bytes`);
    await take.stop();
  });

  test("C10: onExit fires for a binary that cannot be spawned (ENOENT), unless stop() asked first (FIXED after review)", { timeout: 5000 }, async () => {
    const seen = [];
    const take = CaptureTake.start(path.join(TMP, "no-such-capture"), undefined, { onExit: (r) => seen.push(r) });
    // TRIAGED: a stop() issued before the spawn error lands owns the exit, by the hook's own
    // rule ("not fired for an exit that stop asked for"); the child's own failure fires it.
    await sleep(60);
    const out = await take.stop();
    assert.strictEqual(out.exitCode, null);
    assert.strictEqual(take.failure, "binary-missing");
    await sleep(100);
    assert.strictEqual(seen.length, 1, `onExit fired ${seen.length} times for ENOENT`);
  });
});

describe("C-real: column80-capture", () => {
  const missing = fs.existsSync(REAL_CAPTURE) ? undefined : `column80-capture absent at ${REAL_CAPTURE}`;

  test("C11: 2s real capture on a monitor device: chunk cadence, sizes, first buffer (measurement)", { timeout: 20000 }, async (t) => {
    if (missing) return t.skip(missing);
    const devices = await listCaptureDevices(REAL_CAPTURE);
    const monitor = devices.find((d) => d.name === "Monitor of USB Audio Analog Stereo") || devices.find((d) => /^Monitor of/.test(d.name));
    if (!monitor) return t.skip(`no monitor device in ${JSON.stringify(devices)}`);
    const stamps = [];
    const sizes = [];
    let last = 0;
    const take = CaptureTake.start(REAL_CAPTURE, monitor.name, {
      onChunk: (n) => {
        stamps.push(Date.now());
        sizes.push(n - last);
        last = n;
      },
    });
    await sleep(2000);
    const out = await take.stop();
    const gaps = stamps.slice(1).map((s, i) => s - stamps[i]).sort((a, b) => a - b);
    const q = (p) => gaps[Math.min(gaps.length - 1, Math.floor(p * gaps.length))];
    const sz = [...sizes].sort((a, b) => a - b);
    t.diagnostic(
      `device=${JSON.stringify(monitor.name)} firstBufferMs=${take.firstBufferMs} chunks=${stamps.length} bytes=${out.pcm.length} exit=${out.exitCode} gaps(ms) p50=${q(0.5)} p90=${q(0.9)} max=${gaps[gaps.length - 1]} sizes(B) min=${sz[0]} p50=${sz[Math.floor(sz.length / 2)]} max=${sz[sz.length - 1]} stderr=${JSON.stringify(out.stderr)}`,
    );
    assert.strictEqual(out.exitCode, 0, out.stderr);
    assert.ok(out.pcm.length >= 32000 * 1.5, `only ${out.pcm.length} bytes in 2s`);
    assert.ok(q(0.5) <= 100, `median chunk gap ${q(0.5)}ms`);
  });
});

// ---- M: speakerMute.

describe("M: speakerMute", () => {
  const scripted = (answers, calls) => async (cmd, args) => {
    calls.push([cmd, ...args].join(" "));
    const a = answers[cmd];
    if (a instanceof Error) throw a;
    return a ?? { code: 0, stdout: "" };
  };

  test("M1: wpctl read throws, pactl says Mute: yes: nothing applied, reason names pactl", async () => {
    const calls = [];
    const h = await muteSpeakers("linux", scripted({ wpctl: new Error("ENOENT"), pactl: { code: 0, stdout: "Mute: yes\n" } }, calls));
    assert.strictEqual(h.applied, false);
    assert.match(h.reason, /pactl/);
    assert.deepStrictEqual(calls, ["wpctl get-volume @DEFAULT_AUDIO_SINK@", "pactl get-sink-mute @DEFAULT_SINK@"]);
  });

  test("M2: wpctl read code null (execFile timeout) falls through to pactl", async () => {
    const calls = [];
    const h = await muteSpeakers("linux", scripted({ wpctl: { code: null, stdout: "" }, pactl: { code: 0, stdout: "Mute: no\n" } }, calls));
    assert.strictEqual(h.applied, true);
    assert.deepStrictEqual(calls, ["wpctl get-volume @DEFAULT_AUDIO_SINK@", "pactl get-sink-mute @DEFAULT_SINK@", "pactl set-sink-mute @DEFAULT_SINK@ 1"]);
  });

  test("M3: restore twice runs the unmute twice (not idempotent; documented)", async () => {
    const calls = [];
    const h = await muteSpeakers("linux", scripted({ wpctl: { code: 0, stdout: "Volume: 0.40\n" } }, calls));
    await h.restore();
    await h.restore();
    assert.deepStrictEqual(calls.filter((c) => c.endsWith(" 0")), ["wpctl set-mute @DEFAULT_AUDIO_SINK@ 0", "wpctl set-mute @DEFAULT_AUDIO_SINK@ 0"]);
  });

  test("M4: real output shapes: 'Volume: 0.40 [MUTED]' muted, 'Volume: 0.40' not, darwin 'true\\n' muted", async () => {
    const a = await muteSpeakers("linux", scripted({ wpctl: { code: 0, stdout: "Volume: 0.40 [MUTED]\n" } }, []));
    assert.strictEqual(a.applied, false);
    const b = await muteSpeakers("linux", scripted({ wpctl: { code: 0, stdout: "Volume: 0.40\n" } }, []));
    assert.strictEqual(b.applied, true);
    const c = await muteSpeakers("darwin", scripted({ osascript: { code: 0, stdout: "true\n" } }, []));
    assert.strictEqual(c.applied, false);
  });

  test("M5: a run resolving without stdout (code 0) must not make muteSpeakers reject (rule 4)", async () => {
    const h = await muteSpeakers("linux", async () => ({ code: 0 }));
    assert.strictEqual(typeof h.applied, "boolean");
  });

  test("M6: restore whose unmute fails leaves no signal to the caller (documented)", async () => {
    const h = await muteSpeakers("linux", async (cmd, args) => (args[0] === "set-mute" && args[2] === "0" ? { code: 1, stdout: "" } : { code: 0, stdout: "Volume: 0.5\n" }));
    assert.strictEqual(h.applied, true);
    assert.strictEqual(await h.restore(), undefined);
  });
});

// ---- D: modelFile.

describe("D: downloadFile", () => {
  const KNOWN = Buffer.alloc(40000);
  for (let i = 0; i < KNOWN.length; i++) KNOWN[i] = (i * 13 + 5) & 0xff;
  const KNOWN_SHA = crypto.createHash("sha256").update(KNOWN).digest("hex");
  let server;
  let base;
  test.before(async () => {
    server = http.createServer((req, res) => {
      if (req.url === "/len") {
        res.setHeader("content-length", String(KNOWN.length));
        let off = 0;
        const tick = () => {
          if (off >= KNOWN.length) return res.end();
          res.write(KNOWN.subarray(off, off + 8192));
          off += 8192;
          setTimeout(tick, 5);
        };
        tick();
        return;
      }
      if (req.url === "/short") {
        // Promises 1MB, sends 16KB, closes the socket.
        res.setHeader("content-length", String(1024 * 1024));
        res.write(Buffer.alloc(16384, 1));
        setTimeout(() => res.socket.destroy(), 30);
        return;
      }
      if (req.url === "/redir") {
        res.statusCode = 302;
        res.setHeader("location", "/len");
        res.end();
        return;
      }
      res.statusCode = 404;
      res.end("no");
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  test.after(() => server?.close());

  test("D1: a dest whose directory does not exist is created, promptly, with no unhandled rejection (FIXED after review: was a hang)", { timeout: 15000 }, async () => {
    const prevRej = process.rawListeners("unhandledRejection");
    process.removeAllListeners("unhandledRejection");
    const unhandled = [];
    process.on("unhandledRejection", (e) => unhandled.push(e instanceof Error ? e.message : String(e)));
    const dest = path.join(TMP, "no-such-dir", "model.bin");
    try {
      await withTimeout(downloadFile(`${base}/len`, dest), 8000, "download into a missing directory");
      assert.ok(fs.existsSync(dest), "the file landed in the created directory");
      assert.ok(!fs.existsSync(dest + ".part"), ".part is gone");
      assert.deepStrictEqual(unhandled, []);
      await sleep(50);
      assert.deepStrictEqual(unhandled, [], `unhandled rejection(s): ${unhandled.join(" | ")}`);
    } finally {
      process.removeAllListeners("unhandledRejection");
      for (const l of prevRej) process.on("unhandledRejection", l);
    }
  });

  test("D2: content-length longer than the body, then close: rejects, no hang, .part removed", { timeout: 15000 }, async () => {
    const dest = tmpFile("short.bin");
    await assert.rejects(withTimeout(downloadFile(`${base}/short`, dest), 8000, "short body download"), (e) => {
      assert.ok(!/HUNG/.test(e.message), e.message);
      return true;
    });
    assert.ok(!fs.existsSync(dest + ".part"), ".part removed");
    assert.ok(!fs.existsSync(dest), "dest never written");
  });

  test("D3: a 302 is followed by the default fetch and res.status is the final 200 (documented)", async () => {
    const dest = tmpFile("redir.bin");
    await downloadFile(`${base}/redir`, dest, { sha256: KNOWN_SHA });
    assert.ok(fs.readFileSync(dest).equals(KNOWN));
  });

  test("D4: onProgress is monotone in both arguments and ends at 1", async () => {
    const dest = tmpFile("mono.bin");
    const seen = [];
    await downloadFile(`${base}/len`, dest, { onProgress: (f, b) => seen.push([f, b]) });
    for (let i = 1; i < seen.length; i++) {
      assert.ok(seen[i][0] >= seen[i - 1][0] && seen[i][1] >= seen[i - 1][1], `non-monotone at ${i}: ${seen[i - 1]} -> ${seen[i]}`);
    }
    assert.strictEqual(seen[seen.length - 1][0], 1);
  });

  test("D5: abort after completion is a no-op; dest stays", async () => {
    const dest = tmpFile("late-abort.bin");
    const ac = new AbortController();
    await downloadFile(`${base}/len`, dest, { signal: ac.signal });
    ac.abort();
    await sleep(20);
    assert.strictEqual(fs.statSync(dest).size, KNOWN.length);
  });

  test("D6: sha256 given in upper case still matches", async () => {
    const dest = tmpFile("upper.bin");
    await downloadFile(`${base}/len`, dest, { sha256: KNOWN_SHA.toUpperCase() });
    assert.ok(fs.existsSync(dest));
  });

  test("D7: modelPresent is false on a directory and follows a symlink", async () => {
    const dir = tmpFile("as-dir");
    fs.mkdirSync(dir);
    assert.strictEqual(await modelPresent(dir, { ...SPEECH_MODEL, bytes: 4096 }), false);
    const target = tmpFile("target.bin");
    fs.writeFileSync(target, Buffer.alloc(1234));
    const link = tmpFile("link.bin");
    fs.symlinkSync(target, link);
    assert.strictEqual(await modelPresent(link, { ...SPEECH_MODEL, bytes: 1234 }), true);
  });
});

// ---- X: leaks.

describe("X: active resources before and after each module", () => {
  const snapshot = () => process.getActiveResourcesInfo().sort();
  const diff = (before, after) => {
    const counts = {};
    for (const r of after) counts[r] = (counts[r] || 0) + 1;
    for (const r of before) counts[r] = (counts[r] || 0) - 1;
    return Object.entries(counts).filter(([, n]) => n > 0);
  };

  test("X1: Recogniser start+transcribe+dispose leaves nothing behind once the child has exited", { timeout: 30000 }, async (t) => {
    const before = snapshot();
    const model = fakeModel({ mode: "serve" });
    const rec = await Recogniser.start({ binary: FAKE_WHISPER, model });
    const pid = rec.child.pid;
    await rec.transcribe(pcmOf("threat-level-3s.wav"));
    rec.dispose();
    await waitFor(() => !pidAlive(pid), 3000, "child exit");
    const soon = diff(before, snapshot());
    await sleep(5000);
    const d = diff(before, snapshot());
    t.diagnostic(`delta right after: ${JSON.stringify(soon)}; after 5s: ${JSON.stringify(d)}`);
    assert.deepStrictEqual(d, [], JSON.stringify(d));
  });

  test("X2: CaptureTake start+stop leaves nothing behind", { timeout: 20000 }, async (t) => {
    const before = snapshot();
    const take = CaptureTake.start(FAKE_CAPTURE, undefined);
    await sleep(100);
    await take.stop();
    await sleep(200);
    const d = diff(before, snapshot());
    t.diagnostic(`delta: ${JSON.stringify(d)}`);
    assert.deepStrictEqual(d, []);
  });

  test("X3: downloadFile leaves nothing behind", { timeout: 30000 }, async (t) => {
    const server = http.createServer((_q, res) => res.end(Buffer.alloc(1000, 2)));
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const before = snapshot();
    await downloadFile(`http://127.0.0.1:${server.address().port}/x`, tmpFile("leak.bin"));
    const soon = diff(before, snapshot());
    await sleep(5000);
    const d = diff(before, snapshot());
    server.close();
    t.diagnostic(`delta right after: ${JSON.stringify(soon)}; after 5s: ${JSON.stringify(d)}`);
    assert.deepStrictEqual(d, [], JSON.stringify(d));
  });
});
