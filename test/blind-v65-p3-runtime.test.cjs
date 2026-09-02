// Blind oracle for session-v65 phase 3 (contracts/phase3-runtime.md): the
// recogniser and the recorder as processes, the speaker mute, the model
// download, and the native binary layout. Written against the contract only;
// nothing under src/ was read. Rows needing whisper-server, the capture
// binary, or the speech model skip with a reason when the file is absent.
//
// Run: SKIP_LIVE=1 node --test test/blind-v65-p3-runtime.test.cjs

const test = require("node:test");
const { describe, after } = test;
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const crypto = require("crypto");
const { bundleCore, sleep } = require("./.blind-util.cjs");
// The forms the product's decoder produced for the fixtures (test/fixtures/dictation/README.md).
const THREAT_FORMS = [
  "Add the threat level column to the select list 2.",
  "Add the threat level column to the select list two.",
];
const FALLBACK_FORMS = [
  "Make a fallback batch from 1 through 5 off Genesis hash. Insert it into the downloader, catch up the test components and record the tip hash as tip after 5.",
  "Make a full-back batch from 1 through 5 off Genesis hash. Insert it into the downloader, catch up the test components and record the tip hash as tip after 5.",
];

const { mod, cleanup } = bundleCore(
  "blind-v65-p3-runtime",
  'export * from "../src/core/nativeLayout"; export * from "../src/core/recogniser"; export * from "../src/core/capture"; export * from "../src/core/speakerMute"; export * from "../src/core/modelFile";\n'
);
const {
  nativeTarget,
  nativeBinaryPath,
  Recogniser,
  listCaptureDevices,
  CaptureTake,
  classifyCaptureExit,
  muteSpeakers,
  SPEECH_MODEL,
  VAD_MODEL,
  downloadFile,
  modelPresent,
} = mod;

const ROOT = path.resolve(__dirname, "..");
const FIX = path.join(__dirname, "fixtures", "dictation");
const FAKE_CAPTURE = path.join(FIX, "fake-capture.cjs");
const FAKE_WHISPER = path.join(FIX, "fake-whisper-server.cjs");
const REAL_WHISPER = path.join(ROOT, "native", "bin", "linux-x64", "whisper-server");
const REAL_CAPTURE = path.join(ROOT, "native", "bin", "linux-x64", "column80-capture");
const SPEECH_MODEL_PATH =
  process.env.COLUMN80_WHISPER_MODEL || path.join(ROOT, "session-v65", "spikes", "wcpp", "models", "ggml-base.en.bin");

// The contract defines the PCM as the file body after byte 44.
const pcmOf = (file) => fs.readFileSync(path.join(FIX, file)).subarray(44);

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "c80-p3-"));
test.after(() => {
  cleanup();
  fs.rmSync(TMP, { recursive: true, force: true });
});

let seq = 0;
const tmpFile = (name) => path.join(TMP, `${++seq}-${name}`);

function writeScript(name, source) {
  const p = tmpFile(name);
  fs.writeFileSync(p, source, { mode: 0o755 });
  return p;
}

// A config "model" for the fake whisper server; it must exist on disk.
function fakeModel(cfg) {
  const p = tmpFile("ggml-fake.bin");
  fs.writeFileSync(p, JSON.stringify(cfg));
  return p;
}

async function waitFor(pred, ms, what) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await pred()) return;
    await sleep(20);
  }
  assert.fail(`timed out after ${ms}ms waiting for ${what}`);
}

function httpGet(port, route = "/") {
  return new Promise((resolve, reject) => {
    http
      .get({ host: "127.0.0.1", port, path: route }, (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
      })
      .on("error", reject);
  });
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
}

// ---- nativeLayout: pure.

describe("nativeLayout", () => {
  for (const [platform, arch, target] of [
    ["linux", "x64", "linux-x64"],
    ["darwin", "arm64", "darwin-arm64"],
    ["win32", "x64", "win32-x64"],
  ]) {
    test(`nativeTarget(${platform}, ${arch}) is ${target}`, () => {
      assert.strictEqual(nativeTarget(platform, arch), target);
    });
  }

  test("nativeBinaryPath on linux is <root>/native/bin/linux-x64/<name> with no suffix", () => {
    const got = nativeBinaryPath("/some/root", "whisper-server", "linux", "x64");
    assert.strictEqual(got, path.join("/some/root", "native", "bin", "linux-x64", "whisper-server"));
  });

  test("nativeBinaryPath on darwin-arm64 has no suffix", () => {
    const got = nativeBinaryPath("/r", "column80-capture", "darwin", "arm64");
    assert.strictEqual(got, path.join("/r", "native", "bin", "darwin-arm64", "column80-capture"));
  });

  test("nativeBinaryPath on win32 appends .exe", () => {
    // Separator choice on a posix box is the implementation's; compare with
    // slashes normalised.
    const got = nativeBinaryPath("C:/r", "whisper-server", "win32", "x64").replace(/\\/g, "/");
    assert.ok(got.endsWith("native/bin/win32-x64/whisper-server.exe"), got);
    assert.ok(got.startsWith("C:/r"), got);
  });

  test("nativeBinaryPath does not check existence", () => {
    const got = nativeBinaryPath("/definitely/not/here", "nothing", "linux", "x64");
    assert.strictEqual(typeof got, "string");
    assert.ok(!fs.existsSync(got));
  });
});

// ---- Recogniser: start failures, no server needed.

describe("recogniser: start failures", () => {
  test("rule 2: missing binary rejects with binary-missing and does not spawn", async () => {
    const model = fakeModel({ mode: "serve" });
    const logs = [];
    await assert.rejects(
      Recogniser.start({ binary: path.join(TMP, "no-such-whisper"), model, log: (l) => logs.push(l) }),
      (e) => /binary-missing/.test(e.message)
    );
    assert.ok(logs.some((l) => l.startsWith("[dictate] recogniser failed to start: ")), logs.join("\n"));
  });

  test("rule 2: missing model rejects with model-missing and does not spawn", async () => {
    const argvFile = tmpFile("argv.json");
    // The binary exists (node itself); the model does not. Nothing may spawn,
    // so no argv file can appear even if the binary were the fake.
    await assert.rejects(
      Recogniser.start({ binary: process.execPath, model: path.join(TMP, "no-such-model.bin") }),
      (e) => /model-missing/.test(e.message)
    );
    assert.ok(!fs.existsSync(argvFile));
  });

  test("rule 1: child exiting first rejects with the exit code and the last stderr line, and logs the failure", async () => {
    const model = fakeModel({ mode: "exit", exitCode: 7 });
    const logs = [];
    await assert.rejects(Recogniser.start({ binary: FAKE_WHISPER, model, log: (l) => logs.push(l) }), (e) => {
      assert.match(e.message, /7/);
      assert.match(e.message, /model file is garbage/);
      return true;
    });
    const failed = logs.find((l) => l.startsWith("[dictate] recogniser failed to start: "));
    assert.ok(failed, logs.join("\n"));
    assert.ok(failed.length > "[dictate] recogniser failed to start: ".length, "reason is present");
  });

  test("rule 1: argv is -m <model> --host 127.0.0.1 --port <n> -t 8 by default", async () => {
    const argvFile = tmpFile("argv.json");
    const model = fakeModel({ mode: "exit", argvFile });
    await assert.rejects(Recogniser.start({ binary: FAKE_WHISPER, model }));
    const argv = JSON.parse(fs.readFileSync(argvFile, "utf8"));
    const at = (flag) => argv[argv.indexOf(flag) + 1];
    assert.strictEqual(at("-m"), model);
    assert.strictEqual(at("--host"), "127.0.0.1");
    assert.match(at("--port"), /^\d+$/);
    const port = Number(at("--port"));
    assert.ok(port > 0 && port < 65536, `port ${port}`);
    assert.strictEqual(at("-t"), "8");
    assert.ok(!argv.includes("--vad"), "no --vad without a vadModel");
    assert.ok(!argv.includes("--vad-model"));
  });

  test("rule 1: threads and vadModel ride on argv", async () => {
    const argvFile = tmpFile("argv.json");
    const model = fakeModel({ mode: "exit", argvFile });
    const vadModel = tmpFile("ggml-silero.bin");
    fs.writeFileSync(vadModel, "vad");
    await assert.rejects(Recogniser.start({ binary: FAKE_WHISPER, model, vadModel, threads: 3 }));
    const argv = JSON.parse(fs.readFileSync(argvFile, "utf8"));
    const at = (flag) => argv[argv.indexOf(flag) + 1];
    assert.strictEqual(at("-t"), "3");
    assert.ok(argv.includes("--vad"), argv.join(" "));
    assert.strictEqual(at("--vad-model"), vadModel);
    assert.strictEqual(at("--vad-min-silence-duration-ms"), "500");
  });

  test("rule 1: a child that never listens rejects after 20s and is dead afterwards", { timeout: 40000 }, async () => {
    const pidFile = tmpFile("pid");
    const model = fakeModel({ mode: "hang", pidFile });
    const t0 = Date.now();
    let pid;
    try {
      await assert.rejects(Recogniser.start({ binary: FAKE_WHISPER, model }), (e) => /did not come up in time/i.test(e.message));
      const elapsed = Date.now() - t0;
      assert.ok(elapsed >= 19000 && elapsed < 30000, `rejected after ${elapsed}ms`);
      pid = Number(fs.readFileSync(pidFile, "utf8"));
      await waitFor(() => !pidAlive(pid), 3000, `pid ${pid} to die`);
    } finally {
      if (pid && pidAlive(pid)) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {}
      }
    }
  });
});

// ---- Recogniser against the fake server: the request shape.

describe("recogniser: fake server, request shape", () => {
  const fieldsFile = tmpFile("fields.json");
  const delayFile = tmpFile("delay");
  const model = fakeModel({ mode: "serve", fieldsFile, delayFile, text: "  Fake heard this. \n" });
  const logs = [];
  let rec;
  after(() => {
    if (rec) rec.dispose();
    fs.rmSync(delayFile, { force: true });
  });

  const fields = () => JSON.parse(fs.readFileSync(fieldsFile, "utf8"));

  test("rule 1/4: start resolves once GET / answers, and logs the started line with the port", { timeout: 60000 }, async () => {
    rec = await Recogniser.start({ binary: FAKE_WHISPER, model, log: (l) => logs.push(l) });
    assert.strictEqual(rec.alive, true);
    const line = logs.find((l) => l.startsWith("[dictate] recogniser started "));
    assert.ok(line, logs.join("\n"));
    const m = new RegExp(`^\\[dictate\\] recogniser started port=(\\d+) model=${path.basename(model).replace(/\./g, "\\.")} ms=(\\d+)$`).exec(line);
    assert.ok(m, line);
    assert.strictEqual(Number(m[1]), rec.port);
  });

  test("rule 3: port is a real free port the child is reachable on", async (t) => {
    if (!rec) return t.skip("start row failed");
    assert.ok(Number.isInteger(rec.port) && rec.port > 0 && rec.port < 65536, `port ${rec.port}`);
    const res = await httpGet(rec.port);
    assert.strictEqual(res.body, "fake whisper");
  });

  test("rule 5: transcribe posts a WAV as field file with response_format=json temperature=0 beam_size=5 vad=false", async (t) => {
    if (!rec) return t.skip("start row failed");
    const pcm = pcmOf("threat-level-3s.wav");
    fs.rmSync(fieldsFile, { force: true });
    const out = await rec.transcribe(pcm);
    assert.strictEqual(out.text, "  Fake heard this. \n", "text is verbatim, untrimmed");
    const f = fields();
    assert.strictEqual(f.response_format, "json");
    assert.strictEqual(f.temperature, "0");
    assert.strictEqual(f.beam_size, "5");
    assert.strictEqual(f.vad, "false");
    assert.ok(f.file && typeof f.file === "object", "file part present");
    assert.strictEqual(f.file.head, "RIFF");
    assert.strictEqual(f.file.bytes, pcm.length + 44, "wavHeader (44 bytes) plus the PCM");
    assert.ok(!("offset_t" in f), "no offset_t unless asked");
    assert.ok(!("duration" in f), "no duration unless asked");
  });

  test("rule 5: offsetMs/durationMs ride as offset_t/duration without slicing the buffer", async (t) => {
    if (!rec) return t.skip("start row failed");
    const pcm = pcmOf("threat-level-3s.wav");
    fs.rmSync(fieldsFile, { force: true });
    await rec.transcribe(pcm, { offsetMs: 1000, durationMs: 500 });
    const f = fields();
    // Careful reading: the server's fields take milliseconds, so the numbers
    // pass through unchanged.
    assert.strictEqual(f.offset_t, "1000");
    assert.strictEqual(f.duration, "500");
    assert.strictEqual(f.file.bytes, pcm.length + 44, "the whole buffer still goes up");
  });

  test("rule 5: decodeMs is the rounded wall time of the request", async (t) => {
    if (!rec) return t.skip("start row failed");
    fs.writeFileSync(delayFile, "300");
    try {
      const out = await rec.transcribe(pcmOf("threat-level-3s.wav"));
      assert.ok(Number.isInteger(out.decodeMs), `decodeMs ${out.decodeMs}`);
      assert.ok(out.decodeMs >= 250 && out.decodeMs < 5000, `decodeMs ${out.decodeMs}`);
    } finally {
      fs.rmSync(delayFile, { force: true });
    }
  });

  test("rule 6: an aborted signal rejects with AbortError and the recogniser stays usable", async (t) => {
    if (!rec) return t.skip("start row failed");
    fs.writeFileSync(delayFile, "2000");
    try {
      const ctl = new AbortController();
      const p = rec.transcribe(pcmOf("threat-level-3s.wav"), { signal: ctl.signal });
      setTimeout(() => ctl.abort(), 50);
      await assert.rejects(p, (e) => e.name === "AbortError");
    } finally {
      fs.rmSync(delayFile, { force: true });
    }
    assert.strictEqual(rec.alive, true);
    const out = await rec.transcribe(pcmOf("threat-level-3s.wav"));
    assert.strictEqual(out.text, "  Fake heard this. \n");
  });

  test("rule 8: empty PCM resolves empty text without contacting the server", async (t) => {
    if (!rec) return t.skip("start row failed");
    fs.rmSync(fieldsFile, { force: true });
    const out = await rec.transcribe(new Uint8Array(0));
    assert.strictEqual(out.text, "");
    assert.ok(Number.isInteger(out.decodeMs));
    await sleep(100);
    assert.ok(!fs.existsSync(fieldsFile), "the server saw no request");
  });
});

describe("recogniser: fake server started with a VAD model", () => {
  const fieldsFile = tmpFile("fields.json");
  const model = fakeModel({ mode: "serve", fieldsFile });
  const vadModel = tmpFile("ggml-silero.bin");
  fs.writeFileSync(vadModel, "vad");
  let rec;
  after(() => rec && rec.dispose());

  test("rule 5: vad=true by default when started with a VAD model", { timeout: 60000 }, async () => {
    rec = await Recogniser.start({ binary: FAKE_WHISPER, model, vadModel });
    await rec.transcribe(pcmOf("threat-level-3s.wav"));
    assert.strictEqual(JSON.parse(fs.readFileSync(fieldsFile, "utf8")).vad, "true");
  });

  test("rule 5: opts.vad false sends vad=false", async (t) => {
    if (!rec) return t.skip("start row failed");
    await rec.transcribe(pcmOf("threat-level-3s.wav"), { vad: false });
    assert.strictEqual(JSON.parse(fs.readFileSync(fieldsFile, "utf8")).vad, "false");
  });
});

describe("recogniser: any HTTP status on /, then dispose", () => {
  const model = fakeModel({ mode: "serve", rootStatus: 503 });
  let rec;
  after(() => rec && rec.dispose());

  test("rule 1: a 503 on GET / still counts as up", { timeout: 60000 }, async () => {
    rec = await Recogniser.start({ binary: FAKE_WHISPER, model });
    assert.strictEqual(rec.alive, true);
    assert.strictEqual((await httpGet(rec.port)).status, 503);
  });

  test("rule 7: dispose kills the child, alive is false, and dispose is idempotent", async (t) => {
    if (!rec) return t.skip("start row failed");
    const port = rec.port;
    rec.dispose();
    await waitFor(() => !rec.alive, 3000, "alive to drop");
    assert.strictEqual(rec.alive, false);
    await waitFor(() => httpGet(port).then(() => false, () => true), 3000, "the port to close");
    assert.doesNotThrow(() => rec.dispose());
    assert.doesNotThrow(() => rec.dispose());
    assert.strictEqual(rec.alive, false);
  });

  test("rule 6: transcribe on a disposed recogniser rejects with server-down", async (t) => {
    if (!rec) return t.skip("start row failed");
    await assert.rejects(rec.transcribe(pcmOf("threat-level-3s.wav")), (e) => /server-down/.test(e.message));
  });
});

describe("recogniser: the child exits on its own", () => {
  const model = fakeModel({ mode: "serve" });
  const logs = [];
  let rec;
  after(() => rec && rec.dispose());

  test("rule 4/7: exited log line carries the code and alive turns false", { timeout: 60000 }, async () => {
    rec = await Recogniser.start({ binary: FAKE_WHISPER, model, log: (l) => logs.push(l) });
    await httpGet(rec.port, "/quit");
    await waitFor(() => !rec.alive, 3000, "alive to drop after the child exits");
    await waitFor(() => logs.some((l) => l.startsWith("[dictate] recogniser exited ")), 3000, "the exited log line");
    const line = logs.find((l) => l.startsWith("[dictate] recogniser exited "));
    assert.strictEqual(line, "[dictate] recogniser exited code=3");
  });

  test("rule 6: transcribe on a dead recogniser rejects with server-down", async (t) => {
    if (!rec) return t.skip("start row failed");
    await assert.rejects(rec.transcribe(pcmOf("threat-level-3s.wav")), (e) => /server-down/.test(e.message));
  });
});

// ---- Recogniser against the real whisper-server: the witness rows.

describe("recogniser: real whisper-server", () => {
  const missing = !fs.existsSync(REAL_WHISPER)
    ? `whisper-server absent at ${REAL_WHISPER} (npm run native:build)`
    : !fs.existsSync(SPEECH_MODEL_PATH)
      ? `speech model absent at ${SPEECH_MODEL_PATH}`
      : undefined;
  let rec;
  after(() => rec && rec.dispose());
  const gate = (t) => {
    if (missing) return t.skip(missing), false;
    if (!rec) return t.skip("start row failed"), false;
    return true;
  };

  test("rule 1/3/4: starts, reports a reachable port, logs the started line", { timeout: 60000 }, async (t) => {
    if (missing) return t.skip(missing);
    const logs = [];
    rec = await Recogniser.start({ binary: REAL_WHISPER, model: SPEECH_MODEL_PATH, log: (l) => logs.push(l) });
    assert.strictEqual(rec.alive, true);
    assert.ok(Number.isInteger(rec.port) && rec.port > 0 && rec.port < 65536);
    const res = await httpGet(rec.port);
    assert.ok(Number.isInteger(res.status));
    const line = logs.find((l) => l.startsWith("[dictate] recogniser started "));
    assert.ok(line, logs.join("\n"));
    assert.match(line, new RegExp(`^\\[dictate\\] recogniser started port=${rec.port} model=${path.basename(SPEECH_MODEL_PATH).replace(/\./g, "\\.")} ms=\\d+$`));
  });

  test("witness: threat-level-3s.wav", { timeout: 30000 }, async (t) => {
    if (!gate(t)) return;
    const out = await rec.transcribe(pcmOf("threat-level-3s.wav"));
    // TRIAGED 2026-09-02: the README's heard column now lists every form this decoder
    // produced; it is not run-to-run stable between "2" and "two".
    assert.ok(THREAT_FORMS.includes(out.text.trim()), out.text);
    assert.ok(Number.isInteger(out.decodeMs));
  });

  test("witness: min-max-6s.wav decodes warm under 1500ms", { timeout: 30000 }, async (t) => {
    if (!gate(t)) return;
    const out = await rec.transcribe(pcmOf("min-max-6s.wav"));
    assert.strictEqual(out.text.trim(), "Set the min and max event timestamp fields on self from the min and max arguments.");
    assert.ok(out.decodeMs < 1500, `decodeMs ${out.decodeMs}`);
  });

  test("witness: fallback-batch-11s.wav", { timeout: 30000 }, async (t) => {
    if (!gate(t)) return;
    const out = await rec.transcribe(pcmOf("fallback-batch-11s.wav"));
    // TRIAGED 2026-09-02: see the README; whitespace normalised, both heard forms accepted.
    const heard = out.text.replace(/\s+/g, " ").trim();
    assert.ok(FALLBACK_FORMS.includes(heard), out.text);
  });

  test("rule 6: abort mid-decode, then the recogniser still answers", { timeout: 30000 }, async (t) => {
    if (!gate(t)) return;
    const ctl = new AbortController();
    const p = rec.transcribe(pcmOf("fallback-batch-11s.wav"), { signal: ctl.signal });
    setTimeout(() => ctl.abort(), 5);
    await assert.rejects(p, (e) => e.name === "AbortError");
    assert.strictEqual(rec.alive, true);
    const out = await rec.transcribe(pcmOf("threat-level-3s.wav"));
    assert.ok(THREAT_FORMS.includes(out.text.trim()), out.text);
  });

  test("rule 6/7: dispose, then alive false and transcribe rejects server-down", async (t) => {
    if (!gate(t)) return;
    rec.dispose();
    await waitFor(() => !rec.alive, 3000, "alive to drop");
    assert.strictEqual(rec.alive, false);
    await assert.rejects(rec.transcribe(pcmOf("threat-level-3s.wav")), (e) => /server-down/.test(e.message));
    assert.doesNotThrow(() => rec.dispose());
  });
});

// ---- Capture: the fake recorder.

describe("capture: listCaptureDevices", () => {
  test("rule 1: parses the JSON array the binary prints on --list", async () => {
    const devices = await listCaptureDevices(FAKE_CAPTURE);
    assert.deepStrictEqual(devices, [
      { name: "Built-in Microphone", default: true },
      { name: "USB Headset", default: false },
    ]);
  });

  test("rule 1: exit code 2 resolves []", async () => {
    const bin = writeScript("list-exit-2.sh", `#!/bin/sh\nexec "${process.execPath}" "${FAKE_CAPTURE}" --exit 2\n`);
    assert.deepStrictEqual(await listCaptureDevices(bin), []);
  });

  test("rule 1: a missing binary rejects with binary-missing", async () => {
    await assert.rejects(listCaptureDevices(path.join(TMP, "no-such-capture")), (e) => /binary-missing/.test(e.message));
  });

  test("rule 1: malformed stdout rejects with a message naming --list", async () => {
    const bin = writeScript("list-bad.cjs", `#!/usr/bin/env node\nprocess.stdout.write("this is not json\\n");\n`);
    await assert.rejects(listCaptureDevices(bin), (e) => /--list/.test(e.message));
  });

  test("witness: the REAL column80-capture --list", { timeout: 15000 }, async (t) => {
    if (!fs.existsSync(REAL_CAPTURE)) return t.skip(`column80-capture absent at ${REAL_CAPTURE} (npm run native:build)`);
    const devices = await listCaptureDevices(REAL_CAPTURE);
    assert.ok(Array.isArray(devices));
    for (const d of devices) {
      assert.strictEqual(typeof d.name, "string");
      assert.strictEqual(typeof d.default, "boolean");
    }
    if (devices.length > 0) {
      assert.strictEqual(devices.filter((d) => d.default).length, 1, JSON.stringify(devices));
    }
  });
});

describe("capture: CaptureTake with the fake recorder", () => {
  const body = pcmOf("threat-level-3s.wav");
  const argvFromStderr = (stderr) => {
    const line = stderr.split("\n").find((l) => l.startsWith("argv "));
    assert.ok(line, `no argv line in stderr: ${JSON.stringify(stderr)}`);
    return JSON.parse(line.slice(5));
  };
  const safeAbort = (take) => {
    try {
      take.abort();
    } catch {}
  };

  test("rule 2: no device means no arguments; startedAt is the spawn time", async () => {
    const before = Date.now();
    const take = CaptureTake.start(FAKE_CAPTURE, undefined);
    try {
      assert.ok(take.startedAt >= before && take.startedAt <= Date.now() + 1);
      await sleep(100);
      const r = await take.stop();
      assert.strictEqual(r.exitCode, 0);
      assert.deepStrictEqual(argvFromStderr(r.stderr), []);
    } finally {
      safeAbort(take);
    }
  });

  test("rule 2: an empty device string also means no arguments", async () => {
    const take = CaptureTake.start(FAKE_CAPTURE, "");
    try {
      await sleep(60);
      const r = await take.stop();
      assert.deepStrictEqual(argvFromStderr(r.stderr), []);
    } finally {
      safeAbort(take);
    }
  });

  test("rule 2: --device <name> reaches the child's argv", async () => {
    const take = CaptureTake.start(FAKE_CAPTURE, "hw:1,0");
    try {
      await sleep(60);
      const r = await take.stop();
      assert.deepStrictEqual(argvFromStderr(r.stderr), ["--device", "hw:1,0"]);
    } finally {
      safeAbort(take);
    }
  });

  test("rule 2: onFirstBuffer fires once within 500ms with Date.now() - startedAt, and firstBufferMs matches", async () => {
    const firsts = [];
    const take = CaptureTake.start(FAKE_CAPTURE, undefined, { onFirstBuffer: (ms) => firsts.push(ms) });
    try {
      await waitFor(() => firsts.length > 0, 1000, "the first buffer");
      assert.ok(firsts[0] >= 0 && firsts[0] < 500, `first buffer at ${firsts[0]}ms`);
      assert.strictEqual(take.firstBufferMs, firsts[0]);
      await sleep(150);
      assert.strictEqual(firsts.length, 1, "fires once");
      await take.stop();
      assert.strictEqual(firsts.length, 1);
      assert.strictEqual(take.firstBufferMs, firsts[0]);
    } finally {
      safeAbort(take);
    }
  });

  test("rule 2: firstBufferMs is undefined before any stdout", async () => {
    const bin = writeScript("silent.cjs", `#!/usr/bin/env node\nprocess.stdin.resume();\nprocess.stdin.on("end", () => process.exit(0));\n`);
    const take = CaptureTake.start(bin, undefined);
    try {
      await sleep(100);
      assert.strictEqual(take.firstBufferMs, undefined);
      assert.strictEqual(take.pcm.length, 0);
      const r = await take.stop();
      assert.strictEqual(r.exitCode, 0);
      assert.strictEqual(r.pcm.length, 0);
    } finally {
      safeAbort(take);
    }
  });

  test("rule 2: onChunk carries the running byte count and pcm grows as bytes arrive", async () => {
    const counts = [];
    const take = CaptureTake.start(FAKE_CAPTURE, undefined, { onChunk: (n) => counts.push(n) });
    try {
      await sleep(250);
      assert.ok(counts.length >= 3, `chunks seen: ${counts.length}`);
      for (let i = 1; i < counts.length; i++) assert.ok(counts[i] > counts[i - 1], "running count grows");
      assert.strictEqual(counts[counts.length - 1], take.pcm.length);
      assert.ok(take.pcm.subarray(0, 640).equals(body.subarray(0, 640)), "the first slice is the fixture's");
      await take.stop();
    } finally {
      safeAbort(take);
    }
  });

  test("rule 3: stop closes stdin and includes the tail written afterwards", async () => {
    const take = CaptureTake.start(FAKE_CAPTURE, undefined);
    try {
      await sleep(300);
      const before = take.pcm.length;
      assert.ok(before >= 640, `bytes before stop ${before}`);
      const r = await take.stop();
      assert.strictEqual(r.exitCode, 0);
      assert.ok(r.pcm.length >= before + 640, `tail included: ${r.pcm.length} vs ${before}`);
      assert.strictEqual(r.pcm.length % 640, 0);
      assert.ok(r.pcm.equals(body.subarray(0, r.pcm.length)), "bytes are the fixture body in order");
      assert.ok(take.pcm.equals(r.pcm), "pcm getter matches the result");
    } finally {
      safeAbort(take);
    }
  });

  test("rule 3 witness: after the full fixture streams, stop returns the full body plus the tail", { timeout: 15000 }, async () => {
    const take = CaptureTake.start(FAKE_CAPTURE, undefined);
    try {
      await waitFor(() => take.pcm.length >= body.length, 8000, "the full fixture body");
      const before = take.pcm.length;
      const r = await take.stop();
      assert.strictEqual(r.exitCode, 0);
      assert.ok(r.pcm.subarray(0, body.length).equals(body), "full fixture body");
      assert.ok(r.pcm.length >= before + 640, "tail included");
    } finally {
      safeAbort(take);
    }
  });

  test("rule 3: stop twice returns the same promise", async () => {
    const take = CaptureTake.start(FAKE_CAPTURE, undefined);
    try {
      await sleep(60);
      const a = take.stop();
      const b = take.stop();
      assert.strictEqual(a, b);
      await a;
      assert.strictEqual(take.stop(), a);
    } finally {
      safeAbort(take);
    }
  });

  test("rule 3: a child that ignores stdin closing is killed after 3 seconds", { timeout: 15000 }, async () => {
    const bin = writeScript("never-exits.cjs", `#!/usr/bin/env node\nprocess.stdin.resume();\nsetInterval(() => {}, 1000);\n`);
    const take = CaptureTake.start(bin, undefined);
    try {
      await sleep(100);
      const t0 = Date.now();
      const r = await take.stop();
      const elapsed = Date.now() - t0;
      assert.ok(elapsed >= 2800 && elapsed < 6000, `stop resolved after ${elapsed}ms`);
      assert.notStrictEqual(r.exitCode, 0, "a kill does not produce exit 0");
    } finally {
      safeAbort(take);
    }
  });

  test("rule 4: abort kills the child at once and a later stop still resolves", { timeout: 10000 }, async () => {
    const take = CaptureTake.start(FAKE_CAPTURE, undefined);
    try {
      await sleep(100);
      take.abort();
      const t0 = Date.now();
      const r = await take.stop();
      assert.ok(Date.now() - t0 < 2500, "resolves well before the 3s stop deadline");
      assert.notStrictEqual(r.exitCode, 0);
      assert.ok(Buffer.isBuffer(r.pcm));
    } finally {
      safeAbort(take);
    }
  });

  test("rule 5: an ENOENT binary makes stop resolve with exitCode null and the error text in stderr", async () => {
    const take = CaptureTake.start(path.join(TMP, "no-such-capture"), undefined);
    try {
      const r = await take.stop();
      assert.strictEqual(r.exitCode, null);
      assert.match(r.stderr, /ENOENT/);
      assert.strictEqual(r.pcm.length, 0);
    } finally {
      safeAbort(take);
    }
  });

  for (const [code, expected] of [
    [2, "no-device"],
    [3, "device-denied"],
    [9, "failed"],
  ]) {
    test(`witness: a recorder exiting ${code} classifies ${expected}`, async () => {
      const bin = writeScript(`exit-${code}.sh`, `#!/bin/sh\nexec "${process.execPath}" "${FAKE_CAPTURE}" --exit ${code}\n`);
      const take = CaptureTake.start(bin, undefined);
      try {
        const r = await take.stop();
        assert.strictEqual(r.exitCode, code);
        assert.strictEqual(classifyCaptureExit(r.exitCode), expected);
      } finally {
        safeAbort(take);
      }
    });
  }
});

describe("capture: classifyCaptureExit", () => {
  const enoent = Object.assign(new Error("spawn /x/column80-capture ENOENT"), {
    code: "ENOENT",
    errno: -2,
    syscall: "spawn /x/column80-capture",
    path: "/x/column80-capture",
  });

  test("rule 6: 0 and null without an error are undefined", () => {
    assert.strictEqual(classifyCaptureExit(0), undefined);
    assert.strictEqual(classifyCaptureExit(null), undefined);
    assert.strictEqual(classifyCaptureExit(0, undefined), undefined);
  });

  test("rule 6: 2 is no-device, 3 is device-denied, anything else is failed", () => {
    assert.strictEqual(classifyCaptureExit(2), "no-device");
    assert.strictEqual(classifyCaptureExit(3), "device-denied");
    assert.strictEqual(classifyCaptureExit(1), "failed");
    assert.strictEqual(classifyCaptureExit(4), "failed");
    assert.strictEqual(classifyCaptureExit(137), "failed");
    assert.strictEqual(classifyCaptureExit(-1), "failed");
  });

  test("rule 5/6: an ENOENT error is binary-missing whatever the code", () => {
    assert.strictEqual(classifyCaptureExit(null, enoent), "binary-missing");
    assert.strictEqual(classifyCaptureExit(0, enoent), "binary-missing");
    assert.strictEqual(classifyCaptureExit(2, enoent), "binary-missing");
    assert.strictEqual(classifyCaptureExit(3, enoent), "binary-missing");
  });

  test("rule 6: a non-ENOENT spawn error with a code still classifies by the code", () => {
    // Careful reading: only ENOENT is named; another error does not upgrade
    // the classification to binary-missing.
    const eacces = Object.assign(new Error("spawn EACCES"), { code: "EACCES" });
    assert.notStrictEqual(classifyCaptureExit(2, eacces), "binary-missing");
  });
});

// ---- speakerMute: injected run, exact command sequence.

describe("speakerMute", () => {
  // Builds a run that answers per (cmd, first arg) and records every call.
  function recorder(table) {
    const calls = [];
    const run = async (cmd, args) => {
      calls.push([cmd, ...args]);
      const key = `${cmd} ${args[0]}`;
      const answer = table[key] ?? table[cmd];
      if (answer === undefined) throw Object.assign(new Error(`spawn ${cmd} ENOENT`), { code: "ENOENT" });
      if (typeof answer === "function") return answer(args);
      return answer;
    };
    return { calls, run };
  }
  const ok = (stdout) => ({ code: 0, stdout });

  test("rule 1: linux unmuted: wpctl get-volume, set-mute 1, restore set-mute 0", async () => {
    const { calls, run } = recorder({ "wpctl get-volume": ok("Volume: 0.50\n"), "wpctl set-mute": ok("") });
    const h = await muteSpeakers("linux", run);
    assert.strictEqual(h.applied, true);
    assert.deepStrictEqual(calls, [
      ["wpctl", "get-volume", "@DEFAULT_AUDIO_SINK@"],
      ["wpctl", "set-mute", "@DEFAULT_AUDIO_SINK@", "1"],
    ]);
    await h.restore();
    assert.deepStrictEqual(calls[2], ["wpctl", "set-mute", "@DEFAULT_AUDIO_SINK@", "0"]);
    assert.strictEqual(calls.length, 3);
  });

  test("rule 1: linux already muted: only get-volume runs, restore is a no-op", async () => {
    const { calls, run } = recorder({ "wpctl get-volume": ok("Volume: 0.50 [MUTED]\n"), "wpctl set-mute": ok("") });
    const h = await muteSpeakers("linux", run);
    assert.strictEqual(h.applied, false);
    assert.match(h.reason ?? "", /muted/i);
    assert.deepStrictEqual(calls, [["wpctl", "get-volume", "@DEFAULT_AUDIO_SINK@"]]);
    await h.restore();
    assert.strictEqual(calls.length, 1);
  });

  test("rule 1: linux wpctl non-zero falls through to pactl get/set-sink-mute", async () => {
    const { calls, run } = recorder({
      "wpctl get-volume": { code: 1, stdout: "" },
      "pactl get-sink-mute": ok("Mute: no\n"),
      "pactl set-sink-mute": ok(""),
    });
    const h = await muteSpeakers("linux", run);
    assert.strictEqual(h.applied, true);
    assert.deepStrictEqual(calls, [
      ["wpctl", "get-volume", "@DEFAULT_AUDIO_SINK@"],
      ["pactl", "get-sink-mute", "@DEFAULT_SINK@"],
      ["pactl", "set-sink-mute", "@DEFAULT_SINK@", "1"],
    ]);
    await h.restore();
    assert.deepStrictEqual(calls[3], ["pactl", "set-sink-mute", "@DEFAULT_SINK@", "0"]);
    assert.strictEqual(calls.length, 4);
  });

  test("rule 1: linux wpctl throwing (not installed) also falls through to pactl", async () => {
    const { calls, run } = recorder({ "pactl get-sink-mute": ok("Mute: no\n"), "pactl set-sink-mute": ok("") });
    const h = await muteSpeakers("linux", run);
    assert.strictEqual(h.applied, true);
    assert.deepStrictEqual(calls, [
      ["wpctl", "get-volume", "@DEFAULT_AUDIO_SINK@"],
      ["pactl", "get-sink-mute", "@DEFAULT_SINK@"],
      ["pactl", "set-sink-mute", "@DEFAULT_SINK@", "1"],
    ]);
  });

  test("rule 1: linux pactl reports already muted: nothing applied", async () => {
    const { calls, run } = recorder({ "wpctl get-volume": { code: 1, stdout: "" }, "pactl get-sink-mute": ok("Mute: yes\n") });
    const h = await muteSpeakers("linux", run);
    assert.strictEqual(h.applied, false);
    assert.match(h.reason ?? "", /muted/i);
    assert.deepStrictEqual(calls, [
      ["wpctl", "get-volume", "@DEFAULT_AUDIO_SINK@"],
      ["pactl", "get-sink-mute", "@DEFAULT_SINK@"],
    ]);
    await h.restore();
    assert.strictEqual(calls.length, 2);
  });

  test("rule 1: linux both failing: applied false, reason names wpctl and pactl, never rejects", async () => {
    const { calls, run } = recorder({ "wpctl get-volume": { code: 1, stdout: "" }, "pactl get-sink-mute": { code: 1, stdout: "" } });
    const h = await muteSpeakers("linux", run);
    assert.strictEqual(h.applied, false);
    assert.match(h.reason ?? "", /wpctl/);
    assert.match(h.reason ?? "", /pactl/);
    assert.deepStrictEqual(calls, [
      ["wpctl", "get-volume", "@DEFAULT_AUDIO_SINK@"],
      ["pactl", "get-sink-mute", "@DEFAULT_SINK@"],
    ]);
    await h.restore();
    assert.strictEqual(calls.length, 2, "restore runs nothing when nothing was applied");
  });

  test("rule 4: linux with a run that always throws resolves rather than rejects", async () => {
    const h = await muteSpeakers("linux", async () => {
      throw new Error("boom");
    });
    assert.strictEqual(h.applied, false);
    assert.match(h.reason ?? "", /wpctl/);
    assert.match(h.reason ?? "", /pactl/);
    await h.restore();
  });

  test("rule 2: darwin unmuted: osascript query, set true, restore sets false", async () => {
    const { calls, run } = recorder({
      osascript: (args) => (args[1].startsWith("output muted") ? ok("false\n") : ok("")),
    });
    const h = await muteSpeakers("darwin", run);
    assert.strictEqual(h.applied, true);
    assert.deepStrictEqual(calls, [
      ["osascript", "-e", "output muted of (get volume settings)"],
      ["osascript", "-e", "set volume output muted true"],
    ]);
    await h.restore();
    assert.deepStrictEqual(calls[2], ["osascript", "-e", "set volume output muted false"]);
    assert.strictEqual(calls.length, 3);
  });

  test("rule 2: darwin already muted: only the query runs", async () => {
    const { calls, run } = recorder({ osascript: ok("true\n") });
    const h = await muteSpeakers("darwin", run);
    assert.strictEqual(h.applied, false);
    assert.deepStrictEqual(calls, [["osascript", "-e", "output muted of (get volume settings)"]]);
    await h.restore();
    assert.strictEqual(calls.length, 1);
  });

  test("rule 3: win32 applies nothing, runs nothing, and says so", async () => {
    const { calls, run } = recorder({});
    const h = await muteSpeakers("win32", run);
    assert.strictEqual(h.applied, false);
    assert.strictEqual(h.reason, "no speaker mute on win32 yet");
    assert.deepStrictEqual(calls, []);
    await h.restore();
    assert.deepStrictEqual(calls, []);
  });

  test("rule 3: any other platform gets the same treatment with its name", async () => {
    const { calls, run } = recorder({});
    const h = await muteSpeakers("freebsd", run);
    assert.strictEqual(h.applied, false);
    assert.strictEqual(h.reason, "no speaker mute on freebsd yet");
    assert.deepStrictEqual(calls, []);
  });
});

// ---- modelFile: local http server, temp dests.

describe("modelFile", () => {
  const KNOWN = Buffer.alloc(50000);
  for (let i = 0; i < KNOWN.length; i++) KNOWN[i] = (i * 7 + 3) & 0xff;
  const KNOWN_SHA = crypto.createHash("sha256").update(KNOWN).digest("hex");
  const slowSockets = new Set();
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
      if (req.url === "/nolen") {
        // No content-length: node sends chunked.
        res.write(KNOWN.subarray(0, 20000));
        setTimeout(() => res.end(KNOWN.subarray(20000)), 20);
        return;
      }
      if (req.url === "/slow") {
        slowSockets.add(res);
        res.write(Buffer.alloc(1024, 1));
        const timer = setInterval(() => res.write(Buffer.alloc(1024, 1)), 100);
        res.on("close", () => {
          clearInterval(timer);
          slowSockets.delete(res);
        });
        return;
      }
      res.statusCode = 404;
      res.end("not here");
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  test.after(() => {
    for (const res of slowSockets) res.destroy();
    server?.close();
  });

  const dest = (name) => tmpFile(name);
  const expectFailedClean = (d) => {
    assert.ok(!fs.existsSync(d + ".part"), ".part removed");
    assert.ok(!fs.existsSync(d), "dest never written");
  };

  test("constants: SPEECH_MODEL and VAD_MODEL are the contract's specs", () => {
    // The contract gives one string per spec (the file name); `name` is a
    // separate field it does not pin, so only require it non-empty.
    const strip = ({ name, ...rest }) => (assert.ok(typeof name === "string" && name.length > 0, "name"), rest);
    assert.deepStrictEqual(strip(SPEECH_MODEL), {
      url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin",
      file: "ggml-base.en.bin",
      bytes: 147964211,
      sha256: "a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002",
    });
    assert.deepStrictEqual(strip(VAD_MODEL), {
      url: "https://huggingface.co/ggml-org/whisper-vad/resolve/main/ggml-silero-v5.1.2.bin",
      file: "ggml-silero-v5.1.2.bin",
      bytes: 885098,
      sha256: "29940d98d42b91fbd05ce489f3ecf7c72f0a42f027e4875919a28fb4c04ea2cf",
    });
  });

  test("rule 1: success with content-length: bytes land at dest, .part is gone, progress reaches 1", async () => {
    const d = dest("with-len.bin");
    const progress = [];
    await downloadFile(`${base}/len`, d, { onProgress: (f, b) => progress.push([f, b]) });
    assert.ok(fs.readFileSync(d).equals(KNOWN));
    assert.ok(!fs.existsSync(d + ".part"));
    assert.ok(progress.length >= 1, "progress called at least once");
    let lastBytes = -1;
    for (const [f, b] of progress) {
      assert.ok(typeof f === "number" && f >= 0 && f <= 1, `fraction ${f}`);
      assert.ok(b >= lastBytes, "bytes never go backwards");
      assert.ok(Math.abs(f - b / KNOWN.length) < 1e-9, `fraction ${f} is bytes/content-length for ${b}`);
      lastBytes = b;
    }
    assert.strictEqual(progress[progress.length - 1][1], KNOWN.length);
    assert.strictEqual(progress[progress.length - 1][0], 1);
  });

  test("rule 1: success without content-length: fraction is undefined, bytes still count", async () => {
    const d = dest("no-len.bin");
    const progress = [];
    await downloadFile(`${base}/nolen`, d, { onProgress: (f, b) => progress.push([f, b]) });
    assert.ok(fs.readFileSync(d).equals(KNOWN));
    assert.ok(!fs.existsSync(d + ".part"));
    assert.ok(progress.length >= 1);
    for (const [f] of progress) assert.strictEqual(f, undefined);
    assert.strictEqual(progress[progress.length - 1][1], KNOWN.length);
  });

  test("rule 1: the download goes through .part before dest exists", async () => {
    const d = dest("staged.bin");
    let sawPart = false;
    let sawDestEarly = false;
    await downloadFile(`${base}/len`, d, {
      onProgress: () => {
        if (fs.existsSync(d + ".part")) sawPart = true;
        if (fs.existsSync(d)) sawDestEarly = true;
      },
    });
    assert.ok(sawPart, ".part existed while streaming");
    assert.ok(!sawDestEarly, "dest did not exist while streaming");
    assert.ok(fs.existsSync(d));
  });

  test("rule 1: a 404 rejects with the status in the message and leaves nothing behind", async () => {
    const d = dest("missing.bin");
    await assert.rejects(downloadFile(`${base}/missing`, d), (e) => /404/.test(e.message));
    expectFailedClean(d);
  });

  test("rule 1: aborting mid-stream rejects with AbortError and removes .part", { timeout: 15000 }, async () => {
    const d = dest("aborted.bin");
    const ctl = new AbortController();
    let fired = false;
    const p = downloadFile(`${base}/slow`, d, {
      signal: ctl.signal,
      onProgress: () => {
        if (!fired) {
          fired = true;
          setTimeout(() => ctl.abort(), 50);
        }
      },
    });
    await assert.rejects(p, (e) => e.name === "AbortError");
    assert.ok(fired, "at least one chunk arrived before the abort");
    expectFailedClean(d);
  });

  test("rule 1: an already-aborted signal rejects with AbortError and writes nothing", async () => {
    const d = dest("pre-aborted.bin");
    const ctl = new AbortController();
    ctl.abort();
    await assert.rejects(downloadFile(`${base}/len`, d, { signal: ctl.signal }), (e) => e.name === "AbortError");
    expectFailedClean(d);
  });

  test("rule 1: a matching sha256 resolves and dest holds the bytes", async () => {
    const d = dest("hashed-ok.bin");
    await downloadFile(`${base}/len`, d, { sha256: KNOWN_SHA });
    assert.ok(fs.readFileSync(d).equals(KNOWN));
    assert.ok(!fs.existsSync(d + ".part"));
  });

  test("rule 1: a wrong sha256 rejects naming sha256, removes .part, never writes dest", async () => {
    const d = dest("hashed-bad.bin");
    await assert.rejects(downloadFile(`${base}/len`, d, { sha256: "0".repeat(64) }), (e) => /sha256/.test(e.message));
    expectFailedClean(d);
  });

  test("rule 3: fetchImpl is the seam the download goes through", async () => {
    const d = dest("via-seam.bin");
    const seen = [];
    const fetchImpl = (url, init) => {
      seen.push(String(url));
      return fetch(url, init);
    };
    await downloadFile(`${base}/len`, d, { fetchImpl });
    assert.deepStrictEqual(seen, [`${base}/len`]);
    assert.ok(fs.readFileSync(d).equals(KNOWN));
  });

  test("rule 3: a fetchImpl answering from memory needs no server at all", async () => {
    const d = dest("from-memory.bin");
    const fetchImpl = async () => new Response(KNOWN, { status: 200, headers: { "content-length": String(KNOWN.length) } });
    await downloadFile("https://example.invalid/model.bin", d, { fetchImpl, sha256: KNOWN_SHA });
    assert.ok(fs.readFileSync(d).equals(KNOWN));
  });

  test("rule 2: modelPresent is true only for exactly spec.bytes, and never hashes", async () => {
    const spec = { name: "t", url: "http://x/t.bin", file: "t.bin", bytes: 10, sha256: KNOWN_SHA };
    const exact = dest("exact.bin");
    fs.writeFileSync(exact, Buffer.alloc(10, 0xab)); // content does not hash to spec.sha256
    assert.strictEqual(await modelPresent(exact, spec), true);
    const short = dest("short.bin");
    fs.writeFileSync(short, Buffer.alloc(9));
    assert.strictEqual(await modelPresent(short, spec), false);
    const long = dest("long.bin");
    fs.writeFileSync(long, Buffer.alloc(11));
    assert.strictEqual(await modelPresent(long, spec), false);
    assert.strictEqual(await modelPresent(dest("absent.bin"), spec), false);
  });

  test("rule 2: modelPresent ignores a leftover .part", async () => {
    const spec = { name: "t", url: "http://x/t.bin", file: "t.bin", bytes: 10, sha256: KNOWN_SHA };
    const d = dest("only-part.bin");
    fs.writeFileSync(d + ".part", Buffer.alloc(10));
    assert.strictEqual(await modelPresent(d, spec), false);
  });
});
