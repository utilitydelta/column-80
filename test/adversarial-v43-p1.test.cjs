// ADVERSARIAL review evidence for session-v43 phase 1
// (src/core/claudeCodeInstruct.ts). Every test here is a defect claim, not a
// contract row: each one is written to go RED against the shipped module and to
// name what it costs a user.
//
// Run: SKIP_LIVE=1 node --test test/adversarial-v43-p1.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { bundleCore, sleep } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "adv-v43-claudecode",
  `export { makeClaudeCodeInstruct } from "../src/core/claudeCodeInstruct";\n` +
    `export { DEFAULT_FNGEN_CONFIG } from "../src/core/config";\n`
);
const { makeClaudeCodeInstruct } = mod;
test.after(cleanup);

// ---------------------------------------------------------------------------
// a shim with byte-level control over how stdout is CHUNKED
// ---------------------------------------------------------------------------

// Unlike the blind oracle's shim, this one writes stdout as an explicit list of
// base64 chunks with a delay between them, so a chunk boundary can be placed at
// a chosen byte offset. Real pipes split at 64KB and at whatever the writer
// flushed; this makes that split deterministic.
const SHIM_SRC = `#!/usr/bin/env node
"use strict";
const fs = require("fs");
const path = require("path");
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, "shim-config.json"), "utf8"));
const rec = path.join(__dirname, "rec");
function writeAll(fd, b) {
  let off = 0;
  while (off < b.length) {
    try { off += fs.writeSync(fd, b, off, b.length - off); }
    catch (e) { if (e.code !== "EAGAIN" && e.code !== "EPIPE") throw e; if (e.code === "EPIPE") return; }
  }
}
function emitChunks(i) {
  if (i >= cfg.chunks.length) {
    fs.writeFileSync(path.join(rec, "finished.txt"), "1");
    process.exitCode = cfg.exitCode || 0;
    return;
  }
  writeAll(1, Buffer.from(cfg.chunks[i], "base64"));
  setTimeout(() => emitChunks(i + 1), cfg.chunkDelayMs || 30);
}
function go() {
  if (cfg.stderr) writeAll(2, Buffer.from(cfg.stderr, "utf8"));
  emitChunks(0);
}
if (cfg.ignoreStdin) {
  go();
} else {
  const chunks = [];
  process.stdin.on("data", (d) => chunks.push(d));
  process.stdin.on("end", () => {
    fs.writeFileSync(path.join(rec, "stdin.bin"), Buffer.concat(chunks));
    go();
  });
}
`;

const tmpDirs = [];
function tmpDir(prefix) {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  tmpDirs.push(d);
  return d;
}
test.after(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
});

// opts: { chunks: Buffer[], stderr, exitCode, chunkDelayMs, ignoreStdin }
function makeShim(opts = {}) {
  const dir = tmpDir("c80-adv43-shim-");
  fs.mkdirSync(path.join(dir, "rec"));
  const chunks = (opts.chunks ?? []).map((b) => Buffer.from(b).toString("base64"));
  fs.writeFileSync(
    path.join(dir, "shim-config.json"),
    JSON.stringify({ stderr: "", exitCode: 0, chunkDelayMs: 30, ignoreStdin: false, ...opts, chunks })
  );
  const bin = path.join(dir, "claude");
  fs.writeFileSync(bin, SHIM_SRC, { mode: 0o755 });
  fs.chmodSync(bin, 0o755);
  return {
    binary: bin,
    finished: () => fs.existsSync(path.join(dir, "rec", "finished.txt")),
  };
}

const BASE = {
  apiBase: "http://localhost:19999",
  model: "claude-opus-5",
  prompt: "// write the body\n",
  maxTokens: 2048,
  temperature: 0.2,
};

function call(shim, extra = {}, config = {}) {
  const cwd = tmpDir("c80-adv43-cwd-");
  const fn = makeClaudeCodeInstruct({ cwd, binary: shim.binary, ...config });
  return fn({ signal: new AbortController().signal, ...BASE, ...extra });
}

// A realistic success payload, shaped like the live JSON sample the v43 scout
// captured off the CLI.
function payload(over = {}) {
  const usage = { input_tokens: 2, output_tokens: 11, ...(over.usage ?? {}) };
  const out = {
    type: "result",
    subtype: "success",
    is_error: false,
    num_turns: 1,
    session_id: "adv-session",
    duration_api_ms: 2641,
    duration_ms: 1730,
    ttft_ms: 1707,
    stop_reason: "end_turn",
    api_error_status: null,
    result: "a + b",
    ...over,
    usage,
  };
  return JSON.stringify(out);
}

const oneChunk = (s, opts = {}) => makeShim({ chunks: [Buffer.from(s, "utf8")], ...opts });

// ---------------------------------------------------------------------------
// DEFECT 1: stdout is decoded per-chunk, so a multibyte character split across
// a pipe read is silently replaced. `stdout += d` stringifies each Buffer on
// its own; ollama.ts and cloudInstruct.ts both use a streaming TextDecoder.
// ---------------------------------------------------------------------------

test("DEFECT 1: a UTF-8 character split across two stdout chunks is silently corrupted", async () => {
  const body = 'let s = "café ☕";';
  const json = payload({ result: body });
  const buf = Buffer.from(json, "utf8");
  // Split inside the two-byte "é" (0xC3 0xA9).
  const at = buf.indexOf(0xc3) + 1;
  assert.ok(at > 1 && buf[at] === 0xa9, "precondition: the split lands mid-character");

  const shim = makeShim({ chunks: [buf.subarray(0, at), buf.subarray(at)] });
  const out = await call(shim);
  assert.strictEqual(
    out.text,
    body,
    "the reply must survive an arbitrary pipe chunk boundary; a per-chunk Buffer->string " +
      "concat turns the straddling character into U+FFFD replacement bytes, and this text is " +
      "spliced straight into the user's source file"
  );
});

test("DEFECT 1b: the same split on a big reply is what a real 64KB pipe read does", async () => {
  // >64KB forces node's own chunking even without the shim's help, so this is
  // the shape a real generation with any non-ASCII byte in it hits by chance.
  const body = "// " + "x".repeat(70000) + "\nlet s = \"naïve\";";
  const json = payload({ result: body });
  const buf = Buffer.from(json, "utf8");
  const at = buf.indexOf(Buffer.from("ï", "utf8")) + 1;
  const shim = makeShim({ chunks: [buf.subarray(0, at), buf.subarray(at)] });
  const out = await call(shim);
  assert.strictEqual(out.text.slice(-16), 'let s = "naïve";', "the tail of a large reply is corrupted the same way");
});

// ---------------------------------------------------------------------------
// DEFECT 2: the serving-failure and logged-out patterns are tested against
// stdout, and stdout CONTAINS the model's own reply. A generation whose text
// mentions rate limiting, or a 429, is classified as a serving failure.
// ---------------------------------------------------------------------------

test("DEFECT 2: a generated function ABOUT rate limiting is rejected as 'serving-failure'", async () => {
  const body = [
    "fn check_rate_limit(hits: u32) -> bool {",
    "    // the caller is over the rate limit for this window",
    "    hits > 100",
    "}",
  ].join("\n");
  const shim = oneChunk(payload({ result: body }));
  const out = await call(shim);
  assert.strictEqual(
    out.text,
    body,
    "a perfectly good generation must not be classified by the words IN it; the module tests " +
      "stdout, and stdout is the JSON carrying the model's reply"
  );
});

test("DEFECT 2b: a generated function that returns HTTP 429 is rejected as 'serving-failure'", async () => {
  const body = 'if too_many { return Err(HttpError::new(429, "slow down")); }';
  const shim = oneChunk(payload({ result: body }));
  const out = await call(shim);
  assert.strictEqual(out.text, body, "a 429 literal in generated code is code, not a throttle report");
});

test("DEFECT 2c: a generated auth guard containing 'not logged in' is rejected as 'logged-out'", async () => {
  const body = 'if session.is_none() { return Err("user is not logged in".into()); }';
  const shim = oneChunk(payload({ result: body }));
  const out = await call(shim);
  assert.strictEqual(
    out.text,
    body,
    "the user is told to run `/login` because their generated string literal says 'not logged in'"
  );
});

test("DEFECT 2d: a CLEAN round whose usage counter happens to be 429 is rejected as 'serving-failure'", async () => {
  // Nothing about this round is a throttle: exit 0, is_error false, subtype
  // success, api_error_status null, a real result string. Only a token count in
  // the payload reads 429, and \b429\b matches it because the JSON puts a
  // non-word character on each side.
  const shim = oneChunk(payload({ result: "a + b", usage: { input_tokens: 2, output_tokens: 429 } }));
  const out = await call(shim);
  assert.strictEqual(
    out.text,
    "a + b",
    "the serving-failure regex is applied to the whole JSON blob, so any standalone 429/529 " +
      "in ANY numeric field (output_tokens, ttft_ms, duration_ms, contextWindow, ...) fails an " +
      "otherwise perfect round, intermittently and unreproducibly"
  );
});

// ---------------------------------------------------------------------------
// DEFECT 3: a misclassified failure puts the ENTIRE single-line JSON payload
// into the Error message, which fnGenService logs verbatim.
// ---------------------------------------------------------------------------

test("DEFECT 3: the failure message embeds the whole payload, unbounded", async () => {
  // Independent of DEFECT 2: a plain non-zero exit whose stdout carries the
  // CLI's own one-line result JSON. firstLine() splits on "\n" and a minified
  // JSON object has none, so "the first line" is the entire document.
  const body = "fn f() {\n" + "    let _ = 1;\n".repeat(1500) + "}";
  const shim = oneChunk(payload({ result: body }), { exitCode: 2 });
  await assert.rejects(call(shim), (err) => {
    assert.ok(
      err.message.length < 500,
      `a one-line JSON payload makes firstLine() return the whole blob; this message is ` +
        `${err.message.length} bytes and fnGenService logs it verbatim as ` +
        `"[fngen] request failed: ${"${String(err)}"}"`
    );
    return true;
  });
});

// ---------------------------------------------------------------------------
// DEFECT 4: kill("SIGKILL") reaches the CLI, not its descendants. `claude` is
// an agent that spawns tool subprocesses; killing the parent orphans them.
// ---------------------------------------------------------------------------

// RULED 2026-08-08, triage: DEFER (scraps S43-1). The fix is `detached: true`
// plus `process.kill(-pid)`, and negative-pid signalling is not portable to
// Windows, which this extension ships on - a design call, not a phase-1 patch.
//
// So this row was INVERTED into a characterization test: it now asserts the
// limitation as it stands, and it is GREEN. A permanently red row in `npm test`
// would break the release pipeline and train the next reader to ignore red,
// which is worse than an honest recording of a known gap.
//
// WHEN THIS ROW GOES RED, THE LIMITATION WAS FIXED. That is good news: delete
// the inversion, restore the original assertion (the orphan marker must NOT
// exist), and strike S43-1 from the scraps.
test("KNOWN LIMITATION (S43-1): the kill signals the CLI only, not its process group", async () => {
  const dir = tmpDir("c80-adv43-tree-");
  fs.mkdirSync(path.join(dir, "rec"));
  const marker = path.join(dir, "rec", "grandchild-ran.txt");
  // A shim that behaves the way `claude` does: it spawns a helper (a tool call)
  // and then keeps working. The watchdog kills the shim; the helper is not in
  // the signal's blast radius.
  //
  // Timing is load-bearing and must be generous on BOTH sides of the kill. The
  // shim's `#!/usr/bin/env node` shebang resolves `node` through the PATH, which
  // on a fnm-managed box is a shim that adds ~400ms before the helper even
  // spawns; a 250ms watchdog would kill the shim before the helper exists and
  // the row would pass for the wrong reason (no orphan to observe). The
  // watchdog therefore waits past the spawn, and the helper's own timer is
  // longer than the watchdog so its write lands AFTER the kill on a fast box
  // too - otherwise the marker would be written before the kill and the row
  // would pass even if the kill reached the process group.
  const bin = path.join(dir, "claude");
  fs.writeFileSync(
    bin,
    `#!/usr/bin/env node\n` +
      `"use strict";\n` +
      `const { spawn } = require("child_process");\n` +
      `const MARKER = ${JSON.stringify(marker)};\n` +
      `const code = "setTimeout(function(){require('fs').writeFileSync(process.argv[1],'1');},2000)";\n` +
      `spawn(process.execPath, ["-e", code, MARKER], { stdio: "ignore" });\n` +
      `process.stdin.resume();\n` +
      `setTimeout(() => {}, 60000);\n`,
    { mode: 0o755 }
  );
  fs.chmodSync(bin, 0o755);

  const cwd = tmpDir("c80-adv43-cwd-");
  const fn = makeClaudeCodeInstruct({ cwd, binary: bin, timeoutMs: 1500 });
  await assert.rejects(fn({ signal: new AbortController().signal, ...BASE }), (e) => e.reason === "timeout");
  await sleep(4000);
  assert.ok(
    fs.existsSync(marker),
    "EXPECTED THE ORPHAN, and it is gone - which means the kill now reaches the process group " +
      "and the limitation recorded as S43-1 has been fixed. Restore this row's original " +
      "assertion (`!fs.existsSync(marker)`), delete the inversion comment above it, and strike " +
      "S43-1 from session-v43/scraps.md"
  );
});

// ---------------------------------------------------------------------------
// DEFECT 5: totalMs is the CLI's self-reported duration, so it excludes
// everything the transport costs. A rig recording this number is not recording
// what the user waited.
// ---------------------------------------------------------------------------

test("DEFECT 5: totalMs reports the CLI's number, not the round's cost", async () => {
  const shim = makeShim({ chunks: [Buffer.from(payload({ duration_ms: 5, ttft_ms: 5 }), "utf8")], chunkDelayMs: 0 });
  const t0 = Date.now();
  const out = await call(shim);
  const wall = Date.now() - t0;
  assert.ok(
    out.totalMs >= wall * 0.5,
    `the round really took ${wall}ms and reported totalMs=${out.totalMs}: process spawn, CLI ` +
      `startup and the ~26-40k token global context are all outside the CLI's own duration_ms, ` +
      `so a v44 arm comparing this backend's latency against ollama's would compare a partial ` +
      `number against a whole one`
  );
});

// ---------------------------------------------------------------------------
// Attacks that found nothing: kept as regression rows.
// ---------------------------------------------------------------------------

test("clean: a 400KB ASCII reply arrives whole (no buffering limit, no truncation)", async () => {
  const body = "fn big() {\n" + "    let _ = 1;\n".repeat(25000) + "}";
  const shim = oneChunk(payload({ result: body }));
  const out = await call(shim);
  assert.strictEqual(out.text.length, body.length, "spawn has no maxBuffer; the whole reply survives");
  assert.strictEqual(out.text, body);
});

test("clean: a child that exits without ever reading stdin still settles (EPIPE swallowed)", async () => {
  const shim = makeShim({ chunks: [Buffer.from(payload(), "utf8")], ignoreStdin: true });
  const big = "// prompt\n" + "z".repeat(2_000_000);
  const out = await Promise.race([
    call(shim, { prompt: big }),
    sleep(8000).then(() => {
      throw new Error("the promise never settled: a 2MB stdin write to a child that closed its stdin hung the round");
    }),
  ]);
  assert.strictEqual(out.text, "a + b");
});

test("clean: a reply of only whitespace, and a fence pair with an empty interior, do not throw", async () => {
  const blank = await call(oneChunk(payload({ result: "   \n\n  " })));
  assert.strictEqual(blank.text, "   \n\n  ", "an all-blank reply is returned untouched, not crashed on");

  const emptyPair = await call(oneChunk(payload({ result: "```rust\n```" })));
  assert.strictEqual(emptyPair.text, "", "two adjacent fence lines strip to an empty interior; fnGenService rejects it downstream");
});

test("clean: CRLF fences strip, and the interior keeps its \\r byte-exact", async () => {
  const out = await call(oneChunk(payload({ result: "```rust\r\na + b\r\n```\r\n" })));
  assert.strictEqual(out.text, "a + b\r", "A1 says the interior is byte-exact; the \\r is interior");
});

test("clean: an indented fence pair and a tab-tagged fence both strip", async () => {
  const indented = await call(oneChunk(payload({ result: "   ```rust\n    a + b\n   ```" })));
  assert.strictEqual(indented.text, "    a + b", "^\\s*``` allows an indented pair; the interior indent is held");
});

test("clean: an empty or whitespace-only model id omits --model rather than sending an empty arg", async () => {
  const shim = oneChunk(payload());
  const out = await call(shim, { model: "   " });
  assert.strictEqual(out.text, "a + b");
});
