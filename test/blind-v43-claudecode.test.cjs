// Blind oracle: Claude Code headless backend contract
// (src/core/claudeCodeInstruct.ts, session-v43 phase 1).
//
// Written from session-v43/contract-phase1.md ONLY. The oracle never read the
// implementation; every assertion below traces to a sentence in that contract,
// and the row numbers match the contract's "Testing shape" list 1..24. Rows
// named "row A<n>" come from the contract's amendments section (ruled
// 2026-08-08), which wins wherever it conflicts with the text above it.
//
// SUPERSESSIONS: amendments B1-B5 (ruled 2026-08-08 after the adversarial
// review) moved three rows. B4 is the one that changed an expectation rather
// than adding one: the result's ttftMs/totalMs are now the module's WALL
// CLOCK, and the CLI's self-reported ttft_ms/duration_ms moved onto the
// evidence line as cli-ttft/cli-total. Row 23, row 24 and the evidence-line
// extra carry the reasoning at their heads. No other row was touched.
//
// Knowingly untested: the two non-colon clauses of the local-tag rule (both
// shipped tags contain a colon today, so the colon clause subsumes them), and
// the 120000ms default timeout. B5 closes the latter by exporting a readable
// DEFAULT_TIMEOUT_MS; the one-line pin is not in this file yet because the
// edit authorization for this pass covered only the three superseded rows.
//
// Transport under test is a spawned `claude` binary, so the fixture is a fake
// `claude` shim written into a temp dir at test time: it records its argv, its
// cwd and its stdin to files, then prints whatever canned stdout/stderr that
// row needs and exits with that row's code. No network, no real CLI, no
// dependence on this machine's login state.
//
// Run: SKIP_LIVE=1 node --test test/blind-v43-claudecode.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { getEventListeners } = require("node:events");
const { bundleCore, sleep } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "blind-v43-claudecode",
  `export { makeClaudeCodeInstruct } from "../src/core/claudeCodeInstruct";\n` +
    `export { DEFAULT_FNGEN_CONFIG } from "../src/core/config";\n`
);
const { makeClaudeCodeInstruct, DEFAULT_FNGEN_CONFIG } = mod;
test.after(cleanup);

// ---------------------------------------------------------------------------
// the fake `claude` shim
// ---------------------------------------------------------------------------

// Records argv/cwd/stdin beside itself, then emits its canned reply. Writes
// `finished` only AFTER its configured sleep, so a killed child is provable by
// that file's absence as well as by its pid being gone. Self-destructs if
// stdin is never closed, so a contract violation shows up as a red row and not
// as a hung suite.
const SHIM_SRC = `#!/usr/bin/env node
"use strict";
const fs = require("fs");
const path = require("path");
const rec = path.join(__dirname, "rec");
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, "shim-config.json"), "utf8"));
const at = (n) => path.join(rec, n);
fs.writeFileSync(at("pid.txt"), String(process.pid));
fs.writeFileSync(at("argv.json"), JSON.stringify(process.argv.slice(2)));
fs.writeFileSync(at("cwd.txt"), process.cwd());
function writeAll(fd, s) {
  const b = Buffer.from(s, "utf8");
  let off = 0;
  while (off < b.length) {
    try { off += fs.writeSync(fd, b, off, b.length - off); }
    catch (e) { if (e.code !== "EAGAIN") throw e; }
  }
}
function emit() {
  if (cfg.stderr) writeAll(2, cfg.stderr);
  if (cfg.stdout) writeAll(1, cfg.stdout);
  fs.writeFileSync(at("finished.txt"), "1");
  process.exitCode = cfg.exitCode || 0;
}
const bomb = setTimeout(() => {
  fs.writeFileSync(at("no-stdin-end.txt"), "1");
  process.exit(99);
}, 10000);
const chunks = [];
process.stdin.on("data", (d) => chunks.push(d));
process.stdin.on("end", () => {
  clearTimeout(bomb);
  fs.writeFileSync(at("stdin.bin"), Buffer.concat(chunks));
  if (cfg.sleepMs) setTimeout(emit, cfg.sleepMs);
  else emit();
});
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

// opts: { stdout, stderr, exitCode, sleepMs }
function makeShim(opts = {}) {
  const dir = tmpDir("c80-v43-shim-");
  const rec = path.join(dir, "rec");
  fs.mkdirSync(rec);
  fs.writeFileSync(
    path.join(dir, "shim-config.json"),
    JSON.stringify({ stdout: "", stderr: "", exitCode: 0, sleepMs: 0, ...opts })
  );
  const bin = path.join(dir, "claude");
  fs.writeFileSync(bin, SHIM_SRC, { mode: 0o755 });
  fs.chmodSync(bin, 0o755);
  const at = (n) => path.join(rec, n);
  return {
    binary: bin,
    dir,
    spawned: () => fs.existsSync(at("argv.json")),
    argv: () => JSON.parse(fs.readFileSync(at("argv.json"), "utf8")),
    cwd: () => fs.readFileSync(at("cwd.txt"), "utf8"),
    stdin: () => fs.readFileSync(at("stdin.bin")),
    pid: () => Number(fs.readFileSync(at("pid.txt"), "utf8")),
    finished: () => fs.existsSync(at("finished.txt")),
    pidWritten: () => fs.existsSync(at("pid.txt")),
  };
}

// The full InstructGenerateParams surface (src/core/ollama.ts), including the
// knobs the contract calls "ignored params": they must be accepted on every
// round without error, so every row passes them.
const PROMPT = "// write the body\nfn add(a: i32, b: i32) -> i32 {\n";
const DEAD_API_BASE = "http://localhost:19999";
const BASE = {
  apiBase: DEAD_API_BASE,
  model: "claude-opus-5",
  prompt: PROMPT,
  maxTokens: 2048,
  temperature: 0.2,
  numGpu: 30,
  numCtx: 16384,
  think: false,
};

// One generator bound to a fresh empty spawn cwd. `cwd` is returned so row 19
// can compare against the exact string handed to the module.
function harness(shim, config = {}) {
  const cwd = tmpDir("c80-v43-cwd-");
  const fn = makeClaudeCodeInstruct({ cwd, binary: shim.binary, ...config });
  return {
    cwd,
    call: (extra = {}) =>
      fn({ signal: new AbortController().signal, ...BASE, ...extra }),
  };
}

// A well-formed success payload; pass `undefined` for a field to omit it.
function reply(over = {}) {
  const out = {
    type: "result",
    subtype: "success",
    is_error: false,
    num_turns: 1,
    session_id: "test-session",
    total_cost_usd: 0.01,
    ttft_ms: 111,
    duration_ms: 222,
    stop_reason: "end_turn",
    result: "a + b",
    ...over,
  };
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return JSON.stringify(out);
}

const ok = (result, over = {}) => makeShim({ stdout: reply({ result, ...over }) });

// A1: the interior comes back with NO trailing newline. Only the two fence
// lines and the newline that terminated the last interior line go; every other
// byte, including interior blank lines and indentation, is held.
function assertStripped(actual, interior, msg) {
  assert.strictEqual(
    actual,
    interior,
    `${msg}\n  expected interior exactly:\n  ${JSON.stringify(interior)}\n  got:\n  ${JSON.stringify(actual)}`
  );
}

const isClaudeCodeError = (reason) => (err) => {
  assert.strictEqual(err.name, "ClaudeCodeError", `error name (reason=${err.reason})`);
  assert.strictEqual(err.reason, reason, `error reason (message: ${err.message})`);
  return true;
};

async function waitFor(pred, ms, what) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (pred()) return;
    await sleep(20);
  }
  throw new Error(`timed out waiting for ${what}`);
}

// True once the pid is gone. Node reaps its own children, so the zombie window
// is milliseconds; the poll covers it.
async function waitDead(pid, ms = 3000) {
  const t0 = Date.now();
  for (;;) {
    try {
      process.kill(pid, 0);
    } catch (e) {
      if (e.code === "ESRCH") return true;
    }
    if (Date.now() - t0 > ms) return false;
    await sleep(25);
  }
}

// ---------------------------------------------------------------------------
// rows 1-5: the fence strip (exactly one outer pair)
// ---------------------------------------------------------------------------

test("row 1: a reply with no fence passes through byte-identical", async () => {
  const body = "fn add(a: i32, b: i32) -> i32 {\n    a + b\n}";
  const out = await harness(ok(body)).call();
  assert.strictEqual(out.text, body, "no fence lines means no strip and no rewrite");
});

test("row 2: one outer pair with a language tag is stripped, the tag consumed, no trailing newline (A1)", async () => {
  // A1's first worked example, byte for byte.
  const worked = await harness(ok("```rust\na + b\n```")).call();
  assertStripped(worked.text, "a + b", "A1 worked example: ```rust\\na + b\\n``` -> 'a + b' exactly");

  const out = await harness(ok("```rust\nlet x = 1;\n    let y = 2;\n```")).call();
  assertStripped(out.text, "let x = 1;\n    let y = 2;", "the interior's indentation is byte-identical");
});

test("row 3: one outer pair with no language tag is stripped, interior blank lines held (A1)", async () => {
  const out = await harness(ok("```\nlet y = 2;\n```")).call();
  assertStripped(out.text, "let y = 2;", "a bare ``` open line still opens the outer pair");

  // A1's second worked example: the interior blank line survives.
  const blanks = await harness(ok("```\nfoo\n\nbar\n```")).call();
  assertStripped(blanks.text, "foo\n\nbar", "A1 worked example: ```\\nfoo\\n\\nbar\\n``` -> 'foo\\n\\nbar' exactly");
});

test("row 4: a nested inner fence pair survives byte-exact inside the stripped outer pair", async () => {
  const outer = "```md\nExample:\n\n```rust\nlet a = 1;\n```\n\nEnd\n```";
  const out = await harness(ok(outer)).call();
  assertStripped(
    out.text,
    "Example:\n\n```rust\nlet a = 1;\n```\n\nEnd",
    "only the FIRST and LAST lines go; the inner pair and the interior blank lines are content"
  );

  // The doc-comment shape the Rust corpus actually produces.
  const doc = "```rust\n/// ```\n/// let a = 1;\n/// ```\nfn f() {}\n```";
  const out2 = await harness(ok(doc)).call();
  assertStripped(out2.text, "/// ```\n/// let a = 1;\n/// ```\nfn f() {}", "doc-comment fences are interior text");
});

test("row 5: unterminated / unopened / lone fences are NOT stripped", async () => {
  const openOnly = "```rust\nlet z = 3;";
  assert.strictEqual((await harness(ok(openOnly)).call()).text, openOnly, "opens but never closes -> untouched");

  const closeOnly = "let q = 1;\n```";
  assert.strictEqual((await harness(ok(closeOnly)).call()).text, closeOnly, "closes but never opens -> untouched");

  const lone = "```";
  assert.strictEqual((await harness(ok(lone)).call()).text, lone, "one lone fence line: first and last are the SAME line -> untouched");
});

// ---------------------------------------------------------------------------
// rows 6-7: stop_reason mapping
// ---------------------------------------------------------------------------

test("row 6: stop_reason end_turn -> doneReason 'stop'; unknown reasons pass through; absent -> undefined", async () => {
  const endTurn = await harness(ok("a + b", { stop_reason: "end_turn" })).call();
  assert.strictEqual(endTurn.doneReason, "stop");

  const other = await harness(ok("a + b", { stop_reason: "tool_use" })).call();
  assert.strictEqual(other.doneReason, "tool_use", "anything else is passed through verbatim");

  const absent = await harness(ok("a + b", { stop_reason: undefined })).call();
  assert.strictEqual(absent.doneReason, undefined, "absent stop_reason leaves doneReason undefined");
});

test("row 7: stop_reason max_tokens -> doneReason 'length' so the truncation guard fires", async () => {
  const out = await harness(ok("half a fn", { stop_reason: "max_tokens" })).call();
  assert.strictEqual(out.doneReason, "length");
});

// ---------------------------------------------------------------------------
// rows 8-13: the failure taxonomy
// ---------------------------------------------------------------------------

test("row 8: num_turns 2 rejects with reason 'agentic' - that reply is not a generation", async () => {
  const shim = ok("a + b", { num_turns: 2 });
  await assert.rejects(harness(shim).call(), isClaudeCodeError("agentic"));
});

test("row A5: only a NUMBER strictly greater than 1 is agentic - absent, null and non-numeric all succeed", async () => {
  const lines = [];
  const roundWith = async (over) => {
    const shim = ok("a + b", over);
    const cwd = tmpDir("c80-v43-cwd-");
    const fn = makeClaudeCodeInstruct({ cwd, binary: shim.binary, log: (l) => lines.push(l) });
    return fn({ signal: new AbortController().signal, ...BASE, model: "claude-opus-5" });
  };

  assert.strictEqual((await roundWith({ num_turns: undefined })).text, "a + b", "absent num_turns is not agentic");
  assert.strictEqual((await roundWith({ num_turns: null })).text, "a + b", "null num_turns is not agentic");
  assert.strictEqual((await roundWith({ num_turns: "two" })).text, "a + b", "non-numeric num_turns is not agentic");
  assert.strictEqual((await roundWith({ num_turns: 1 })).text, "a + b", "one turn is the normal case");

  assert.strictEqual(lines.length, 4, "one evidence line per successful round");
  for (const [i, line] of lines.slice(0, 3).entries()) {
    assert.match(line, /num_turns=\?/, `round ${i} had a non-number num_turns, so the line renders num_turns=?`);
  }
  assert.match(lines[3], /num_turns=1/, "a numeric num_turns renders as its value");
});

test("row 9: 'Not logged in' text classifies as 'logged-out' regardless of exit code", async () => {
  const onStderr = makeShim({ stderr: "Not logged in. Run `claude` then /login\n", exitCode: 1 });
  await assert.rejects(harness(onStderr).call(), isClaudeCodeError("logged-out"));

  // Classification order: logged-out is decided before the exit code and before
  // the JSON parse, so exit 0 with unparseable stdout is still logged-out.
  const onStdoutExitZero = makeShim({ stdout: "Not logged in\n", exitCode: 0 });
  await assert.rejects(harness(onStdoutExitZero).call(), isClaudeCodeError("logged-out"));
});

test("row 10: the binary is not on PATH -> reason 'binary-missing' (spawn ENOENT)", async (t) => {
  const emptyPath = tmpDir("c80-v43-nopath-");
  const cwd = tmpDir("c80-v43-cwd-");
  const saved = process.env.PATH;
  process.env.PATH = emptyPath;
  t.after(() => {
    process.env.PATH = saved;
  });

  // No config.binary: the default "claude" must be resolved through PATH.
  // The cwd is real, which is what separates this row from the bad-cwd row:
  // both surface as a spawn ENOENT and the module must tell them apart (A6).
  assert.ok(fs.existsSync(cwd), "precondition: the spawn cwd really is present");
  const fn = makeClaudeCodeInstruct({ cwd });
  await assert.rejects(
    fn({ signal: new AbortController().signal, ...BASE }),
    isClaudeCodeError("binary-missing")
  );
});

test("row 11: a non-zero exit that is nothing else -> reason 'exit'", async () => {
  const shim = makeShim({ stderr: "boom: the CLI fell over\n", exitCode: 2 });
  await assert.rejects(harness(shim).call(), isClaudeCodeError("exit"));
});

test("row 12: exit 0 with unparseable stdout, or with no string result, -> reason 'bad-json'", async () => {
  const garbage = makeShim({ stdout: "this is not json {\n", exitCode: 0 });
  await assert.rejects(harness(garbage).call(), isClaudeCodeError("bad-json"));

  const noResult = makeShim({ stdout: reply({ result: undefined }), exitCode: 0 });
  await assert.rejects(harness(noResult).call(), isClaudeCodeError("bad-json"));

  const wrongType = makeShim({ stdout: reply({ result: 42 }), exitCode: 0 });
  await assert.rejects(harness(wrongType).call(), isClaudeCodeError("bad-json"), "a non-string result is not a generation");
});

test("row 13: the serving-failure regex (A3) matches on combined stdout+stderr", async () => {
  // A3's written pattern:
  // /rate[ _-]?limit|overloaded|usage limit|quota exceeded|\b429\b|\b529\b/i
  const cases = [
    "Claude AI usage limit reached\n",
    "rate limit exceeded, try again later\n",
    "API Error: 429 too many requests\n",
    "API Error: 529 Overloaded\n",
    "quota exceeded for this organization\n",
  ];
  for (const text of cases) {
    const shim = makeShim({ stderr: text, exitCode: 1 });
    await assert.rejects(
      harness(shim).call(),
      isClaudeCodeError("serving-failure"),
      `serving-failure family: ${JSON.stringify(text)}`
    );
  }
});

test("row 13b: A3's api_error_status leg - 429 in the JSON field on an otherwise clean payload", async () => {
  // Everything else about this reply is a success: exit 0, is_error false,
  // subtype success, num_turns 1, a real string result. Only the JSON's
  // api_error_status carries the code, and the contract says the pattern is
  // additionally applied to that field.
  const shim = makeShim({ stdout: reply({ api_error_status: 429 }), exitCode: 0 });
  await assert.rejects(
    harness(shim).call(),
    isClaudeCodeError("serving-failure"),
    "api_error_status 429 is a serving failure even when the round otherwise looks clean"
  );
});

test("row A6 (new taxonomy row): a cwd that does not exist is 'bad-cwd', NOT 'binary-missing'", async () => {
  // The binary genuinely exists and is executable; only the spawn's cwd is
  // gone. Node reports both as ENOENT, and telling this user their `claude` is
  // not installed would be a lie.
  const shim = ok("a + b");
  const missingCwd = path.join(tmpDir("c80-v43-gonecwd-"), "does-not-exist");
  assert.ok(!fs.existsSync(missingCwd), "precondition: the cwd really is absent");
  assert.ok(fs.existsSync(shim.binary), "precondition: the binary really is present");

  const fn = makeClaudeCodeInstruct({ cwd: missingCwd, binary: shim.binary });
  await assert.rejects(
    fn({ signal: new AbortController().signal, ...BASE }),
    isClaudeCodeError("bad-cwd"),
    "an ENOENT spawn must be disambiguated by checking config.cwd before blaming the binary"
  );
  assert.ok(!shim.spawned(), "the child never ran, so it recorded nothing");
});

// ---------------------------------------------------------------------------
// rows 14-16: abort and watchdog
// ---------------------------------------------------------------------------

test("row 14: abort mid-flight rejects AbortError AND the child is dead", async () => {
  const shim = makeShim({ stdout: reply(), sleepMs: 4000 });
  const cwd = tmpDir("c80-v43-cwd-");
  const fn = makeClaudeCodeInstruct({ cwd, binary: shim.binary });
  const ac = new AbortController();
  const p = fn({ signal: ac.signal, ...BASE });

  await waitFor(() => shim.pidWritten(), 3000, "the shim to start and record its pid");
  const pid = shim.pid();
  // A9: the listener is a real addEventListener registration, so it is visible
  // in flight; that is what makes the zero after settle mean something.
  assert.ok(
    getEventListeners(ac.signal, "abort").length >= 1,
    "an in-flight round holds an abort listener registered with addEventListener"
  );
  ac.abort();

  await assert.rejects(p, (err) => {
    assert.strictEqual(err.name, "AbortError", "abort is NOT in the taxonomy; it keeps the platform contract");
    return true;
  });

  assert.ok(await waitDead(pid), `the child (pid ${pid}) must be killed on abort, it is still running`);
  await sleep(400);
  assert.ok(!shim.finished(), "the shim would have written its reply after a 4s sleep; a killed child never does");
  assert.strictEqual(
    getEventListeners(ac.signal, "abort").length,
    0,
    "the abort listener is removed on settle"
  );

  // Settle includes a happy settle: a resolved round must not leak either.
  const clean = new AbortController();
  const okShim = ok("a + b");
  await harness(okShim).call({ signal: clean.signal });
  assert.strictEqual(
    getEventListeners(clean.signal, "abort").length,
    0,
    "the abort listener is removed after a SUCCESSFUL round too"
  );
});

test("row 15: an already-aborted signal rejects immediately with NO spawn", async () => {
  const shim = ok("a + b");
  const h = harness(shim);
  await assert.rejects(h.call({ signal: AbortSignal.abort() }), (err) => {
    // A4: both the pre-aborted and the mid-flight case use exactly "AbortError".
    assert.strictEqual(err.name, "AbortError", "a pre-aborted call rejects as an abort, not as a taxonomy failure");
    return true;
  });
  await sleep(150);
  assert.ok(!shim.spawned(), "no child may be spawned for an already-aborted signal (the shim recorded no argv)");
});

test("row 16: the watchdog fires -> reason 'timeout' and the child is dead", async () => {
  const shim = makeShim({ stdout: reply(), sleepMs: 5000 });
  const h = harness(shim, { timeoutMs: 250 });
  const t0 = Date.now();
  await assert.rejects(h.call(), isClaudeCodeError("timeout"));
  const elapsed = Date.now() - t0;
  assert.ok(elapsed < 3000, `the configured 250ms cap fired, not the shim's own 5s sleep (took ${elapsed}ms)`);

  const pid = shim.pid();
  assert.ok(await waitDead(pid), `the child (pid ${pid}) must be killed when the cap fires, it is still running`);
  await sleep(400);
  assert.ok(!shim.finished(), "a killed child never reaches its post-sleep write");
});

// ---------------------------------------------------------------------------
// rows 17-21: the spawn itself
// ---------------------------------------------------------------------------

// SUPERSEDED by contract amendment D1 (human ruling, 2026-08-08): `--tools ""`
// joined the fixed argv. Previously this was the four args without it.
//
// Not cosmetic, and the reason belongs where the row can see it: the built-in
// tool definitions were measured at ~18.7k of the ~23.2k input context every
// call carried, for a toolbelt a prompt-to-text generation can never use.
// Generated code was byte-identical with and without. The empty string is a
// real argv element, which is exactly what these rows are here to pin - a
// backend that dropped it would silently go back to paying the toolbelt.
const ARGV_CORE = ["-p", "--output-format", "json", "--strict-mcp-config", "--tools", ""];

test("row 17: --model is omitted for local ollama tags (shipped default, fallback, anything with a colon)", async () => {
  const shipped = ok("a + b");
  await harness(shipped).call({ model: DEFAULT_FNGEN_CONFIG.model });
  assert.deepStrictEqual(
    shipped.argv(),
    ARGV_CORE,
    `the shipped local default (${DEFAULT_FNGEN_CONFIG.model}) must never reach Anthropic`
  );

  const fallback = ok("a + b");
  await harness(fallback).call({ model: DEFAULT_FNGEN_CONFIG.fallbackModel });
  assert.ok(!fallback.argv().includes("--model"), `the shipped fallback (${DEFAULT_FNGEN_CONFIG.fallbackModel}) is a local tag too`);

  const colon = ok("a + b");
  await harness(colon).call({ model: "some-other-model:q4_K_M" });
  assert.ok(!colon.argv().includes("--model"), "any id containing a colon is the ollama name:tag shape");
});

test("row 18: --model is passed, last and in order, for a frontier id", async () => {
  const shim = ok("a + b");
  await harness(shim).call({ model: "claude-opus-5" });
  assert.deepStrictEqual(shim.argv(), [...ARGV_CORE, "--model", "claude-opus-5"], "exact argv, in the contract's order");
});

test("row 19: the spawn's cwd IS config.cwd, read back from the child's own recording", async () => {
  const shim = ok("a + b");
  const h = harness(shim);
  await h.call();
  assert.strictEqual(shim.cwd(), h.cwd, "the child ran in the product-owned empty dir, never the workspace");
});

test("row 20: --strict-mcp-config present, --bare absent, prompt and dead knobs not in argv", async () => {
  const shim = ok("a + b");
  await harness(shim).call();
  const argv = shim.argv();
  assert.ok(argv.includes("--strict-mcp-config"), "mandatory on EVERY spawn: user-scope MCP servers otherwise attach in any cwd");
  assert.ok(!argv.includes("--bare"), "subscription mode is the ruled billing mode");

  const joined = argv.join(String.fromCharCode(10));
  assert.ok(!joined.includes(PROMPT), "the prompt is never an argv element");
  assert.ok(!joined.includes("write the body"), "not even a fragment of the prompt is in argv");
  for (const dead of [DEAD_API_BASE, "16384", "30", "0.2", "2048", "--think", "--temperature", "--max-tokens"]) {
    assert.ok(!argv.includes(dead), `ignored param ${dead} has no transport on this backend and must not appear in argv`);
  }
});

// Amendment D1. Its own row because the flag is a COST and SAFETY contract, not
// an argv detail, and `deepStrictEqual` on the whole array would not say why it
// mattered when it went red.
test("row 20b (D1): --tools is passed an EMPTY value, disabling the built-in toolbelt", async () => {
  const shim = ok("a + b");
  await harness(shim).call();
  const argv = shim.argv();

  const at = argv.indexOf("--tools");
  assert.ok(at >= 0, "the built-in tool definitions cost ~18.7k input tokens on EVERY call, for tools a prompt-to-text generation can never use");
  assert.strictEqual(
    argv[at + 1],
    "",
    "the value must be the empty string: any other value re-enables a tool set, and an omitted value would swallow the next flag"
  );
  // A model with no tools cannot take a second turn, which is what makes the
  // agentic-reply trap structural rather than merely detected.
  assert.ok(!argv.includes("--system-prompt"), "D1 ruled the system prompt NOT replaced: quality evidence was two easy samples");
});

test("row 21: the prompt arrives on stdin byte-identical, then stdin closes", async () => {
  const prompt =
    "// write the body: unicode é ✓, tabs and trailing space\n" +
    "\tfn add(a: i32, b: i32) -> i32 {\n" +
    "// `backticks` and ``` fences in the prompt   \n";
  const shim = ok("a + b");
  await harness(shim).call({ prompt });
  assert.deepStrictEqual(
    shim.stdin(),
    Buffer.from(prompt, "utf8"),
    "stdin carries the assembled prompt verbatim: no added newline, no wrapper, nothing dropped"
  );
});

// ---------------------------------------------------------------------------
// rows 22-23: streaming callback and timings
// ---------------------------------------------------------------------------

test("row 22: onChunk fires exactly once with the final post-strip text, and never on failure", async () => {
  const chunks = [];
  const out = await harness(ok("```rust\nlet x = 1;\n```")).call({ onChunk: (c) => chunks.push(c) });
  assert.strictEqual(chunks.length, 1, "non-streaming transport: exactly one call");
  assert.strictEqual(chunks[0], out.text, "the chunk is the FINAL text, after the fence strip");
  assertStripped(chunks[0], "let x = 1;", "the chunk carries stripped text, not the fenced original");

  const failed = [];
  const bad = makeShim({ stderr: "boom\n", exitCode: 2 });
  await assert.rejects(harness(bad).call({ onChunk: (c) => failed.push(c) }), isClaudeCodeError("exit"));
  assert.deepStrictEqual(failed, [], "onChunk is not called when the round fails");
});

// SUPERSEDED by B4 (ruled 2026-08-08, after the adversarial review).
// This row previously asserted ttftMs === ttft_ms and totalMs === duration_ms
// with the contract's absent-field fallbacks. B4 reverses that: the result's
// timings are now the MODULE'S WALL CLOCK, because duration_ms excludes the
// spawn, the CLI boot and the global context reload that rides every
// subscription call (the sample reports 1730ms for a round whose real cost is
// ~15.2s, and 1730 is not even the CLI's own wall clock: duration_api_ms on
// the same capture reads 2641). The CLI's figures are not discarded, they move
// onto the evidence line as cli-ttft / cli-total. Non-streaming transport
// means nothing arrives before the whole reply, so ttftMs === totalMs always.
test("row 23 (B4): timings are the module's wall clock; the CLI's own numbers ride the evidence line", async () => {
  const lines = [];
  // The planted CLI numbers are absurdly small for a child that really sits
  // for 300ms, so a module still reading them cannot pass by luck.
  const slow = makeShim({ stdout: reply({ result: "a + b", ttft_ms: 3, duration_ms: 5 }), sleepMs: 300 });
  const cwd = tmpDir("c80-v43-cwd-");
  const fn = makeClaudeCodeInstruct({ cwd, binary: slow.binary, log: (l) => lines.push(l) });
  const out = await fn({ signal: new AbortController().signal, ...BASE, model: "claude-opus-5" });

  assert.ok(
    Number.isFinite(out.totalMs) && out.totalMs >= 300,
    `totalMs is wall clock, so it must cover the child's real 300ms; got ${out.totalMs}ms`
  );
  assert.notStrictEqual(out.totalMs, 5, "totalMs is NOT the CLI's self-reported duration_ms");
  assert.notStrictEqual(out.ttftMs, 3, "ttftMs is NOT the CLI's self-reported ttft_ms");
  assert.strictEqual(out.ttftMs, out.totalMs, "non-streaming transport: there is no honest time-to-first-token");

  assert.strictEqual(lines.length, 1);
  assert.ok(lines[0].includes("cli-ttft=3ms"), `the CLI's ttft_ms is reported as cli-ttft; got ${lines[0]}`);
  assert.ok(lines[0].includes("cli-total=5ms"), `the CLI's duration_ms is reported as cli-total; got ${lines[0]}`);
  assert.ok(lines[0].includes(`total=${out.totalMs}ms`), `total= is still the mapped wall clock (A8); got ${lines[0]}`);

  // Absent CLI fields render -1: there is nothing to fall back FROM any more,
  // so the line must say the CLI was silent rather than borrow a number.
  const silent = [];
  const shim2 = makeShim({ stdout: reply({ result: "a + b", ttft_ms: undefined, duration_ms: undefined }) });
  const cwd2 = tmpDir("c80-v43-cwd-");
  const fn2 = makeClaudeCodeInstruct({ cwd: cwd2, binary: shim2.binary, log: (l) => silent.push(l) });
  const out2 = await fn2({ signal: new AbortController().signal, ...BASE, model: "claude-opus-5" });

  assert.ok(silent[0].includes("cli-ttft=-1ms"), `an absent ttft_ms renders -1; got ${silent[0]}`);
  assert.ok(silent[0].includes("cli-total=-1ms"), `an absent duration_ms renders -1; got ${silent[0]}`);
  assert.ok(Number.isFinite(out2.totalMs) && out2.totalMs > 0, "the wall clock is still a real measurement");
  assert.strictEqual(out2.ttftMs, out2.totalMs);
});

// ---------------------------------------------------------------------------
// row 24: the drift detector
// ---------------------------------------------------------------------------

test("row 24 CONTRACT ROW: the recorded REAL `claude -p --output-format json` payload maps through", async () => {
  // VENDORED FIXTURE, not a session path (2026-08-10). This is a CONTRACT ROW:
  // it pins a real captured `claude -p --output-format json` payload, so it must
  // run on every clone. It used to read session-v43/, which now lives in a
  // private repo, and the row silently stopped running the moment that split
  // happened. 1.6KB, no client code.
  const samplePath = path.join(__dirname, "fixtures", "claude-code", "claude-json-sample.json");
  const raw = fs.readFileSync(samplePath, "utf8");
  const drift =
    "DRIFT DETECTOR: this row feeds the live-captured payload at " +
    "session-v43/claude-json-sample.json through the module unchanged. If it is red, either the " +
    "real `claude` CLI's JSON field names moved or the module's mapping did - re-capture the " +
    "payload and follow the CLI, do not edit this expectation to fit the code.";

  // SUPERSEDED by B4: this row keeps its job as the drift detector, but the
  // capture's ttft_ms / duration_ms are no longer readable from the result
  // (those are wall clock now), so their field names are pinned through the
  // evidence line's cli-ttft / cli-total instead. Same drift, same red, one
  // channel over.
  const lines = [];
  const shim = makeShim({ stdout: raw, exitCode: 0 });
  const cwd = tmpDir("c80-v43-cwd-");
  const fn = makeClaudeCodeInstruct({ cwd, binary: shim.binary, log: (l) => lines.push(l) });
  const out = await fn({ signal: new AbortController().signal, ...BASE, model: "claude-opus-5" });

  assertStripped(out.text, "a + b", drift + "\n  field: result (the capture is fence-wrapped with a rust tag)");
  assert.strictEqual(lines.length, 1, `${drift}\n  one evidence line per successful round`);
  assert.ok(
    lines[0].includes("cli-ttft=1707ms"),
    `${drift}\n  field: ttft_ms -> cli-ttft on the evidence line; got ${lines[0]}`
  );
  assert.ok(
    lines[0].includes("cli-total=1730ms"),
    `${drift}\n  field: duration_ms -> cli-total (NOT duration_api_ms, which reads 2641 on this capture); got ${lines[0]}`
  );
  assert.ok(
    Number.isFinite(out.totalMs) && out.totalMs !== 1730,
    `${drift}\n  the result carries the module's wall clock, never the capture's 1730ms; got ${out.totalMs}`
  );
  assert.strictEqual(out.doneReason, "stop", `${drift}\n  field: stop_reason "end_turn" -> doneReason "stop"`);
  assert.deepStrictEqual(
    Object.keys(out).sort(),
    ["doneReason", "totalMs", "ttftMs", "text"].sort(),
    `${drift}\n  the result shape is exactly InstructGenerateResult; this build adds no fields`
  );
});

// ---------------------------------------------------------------------------
// extras: contract sentences outside the numbered rows
// ---------------------------------------------------------------------------

test("extra: unknown JSON fields are ignored, never an error", async () => {
  const shim = makeShim({
    stdout: reply({ some_new_field: { nested: true }, another: [1, 2, 3] }),
  });
  const out = await harness(shim).call();
  assert.strictEqual(out.text, "a + b");
});

test("row A2 (new taxonomy row): is_error true, or a subtype other than 'success', rejects with reason 'cli-error'", async () => {
  await assert.rejects(
    harness(makeShim({ stdout: reply({ is_error: true }) })).call(),
    isClaudeCodeError("cli-error")
  );
  await assert.rejects(
    harness(makeShim({ stdout: reply({ subtype: "error_during_execution" }) })).call(),
    isClaudeCodeError("cli-error")
  );
});

test("row A2b: classification order survives the new row - text beats the CLI's error flag", async () => {
  // Same is_error:true payload both times. The text decides, exactly as the
  // original classification order says: logged-out and serving-failure are
  // resolved before cli-error.
  const loggedOut = makeShim({
    stdout: reply({ is_error: true, subtype: "error_during_execution" }),
    stderr: "Not logged in. Run `claude` then /login\n",
  });
  await assert.rejects(
    harness(loggedOut).call(),
    isClaudeCodeError("logged-out"),
    "an is_error payload whose text says 'Not logged in' is logged-out, never cli-error"
  );

  const throttled = makeShim({
    stdout: reply({ is_error: true, subtype: "error_during_execution" }),
    stderr: "rate limit reached for claude-opus-5\n",
  });
  await assert.rejects(
    harness(throttled).call(),
    isClaudeCodeError("serving-failure"),
    "an is_error payload whose text says 'rate limit' is serving-failure, never cli-error"
  );
});

// SUPERSEDED by B4: the line gained cli-ttft / cli-total, which carry the
// CLI's self-reported figures now that ttft= / total= are the module's wall
// clock.
//
// SUPERSEDED AGAIN by session-v44 phase 2, which puts `cache-mode=` between
// model= and ttft= (session-v44/contract-phase2.md, "Evidence"). Every other
// field keeps its spelling, order and value, which is what this row still
// guards. Ruled shape:
//   [claude-code] fence-strip=<yes|no> num_turns=<n|?> model=<id|cli-default>
//                 cache-mode=<mode> ttft=<n>ms total=<n>ms
//                 cli-ttft=<n>ms cli-total=<n>ms <accounting>
test("extra (B4): the evidence line - exactly one per successful round, in the ruled shape", async () => {
  const lines = [];
  const shim = ok("```rust\nlet x = 1;\n```", { ttft_ms: 111, duration_ms: 222, num_turns: 1 });
  const cwd = tmpDir("c80-v43-cwd-");
  const fn = makeClaudeCodeInstruct({ cwd, binary: shim.binary, log: (l) => lines.push(l) });
  const out = await fn({ signal: new AbortController().signal, ...BASE, model: "claude-opus-5" });

  assert.strictEqual(lines.length, 1, "exactly one line per successful round");
  const line = lines[0];
  // Fields in the ruled order, with a free tail so a later field can be added
  // without a false red ("carrying at least" is the contract's wording).
  const shape =
    /^\[claude-code\] fence-strip=yes num_turns=1 model=claude-opus-5 cache-mode=single-shot ttft=(\d+)ms total=(\d+)ms cli-ttft=111ms cli-total=222ms\b/;
  const m = line.match(shape);
  assert.ok(m, `the line must follow the ruled shape\n  ruled: ${shape}\n  got:   ${line}`);
  // A8 survives B4: ttft= / total= are the numbers the RESULT carries, which
  // are now the wall clock; cli-ttft / cli-total are the CLI's own, labelled.
  assert.strictEqual(Number(m[1]), out.ttftMs, "ttft= is the mapped ttftMs");
  assert.strictEqual(Number(m[2]), out.totalMs, "total= is the mapped totalMs");
  assert.notStrictEqual(out.totalMs, 222, "the wall clock is not the CLI's duration_ms");
});

test("extra: the evidence line says model=cli-default when --model was omitted, fence-strip=no when nothing was stripped", async () => {
  const lines = [];
  // Timings absent from the JSON, so both numbers come from the fallbacks; A8
  // says the line still carries those exact mapped numbers.
  const shim = makeShim({ stdout: reply({ result: "a + b", ttft_ms: undefined, duration_ms: undefined }), sleepMs: 300 });
  const cwd = tmpDir("c80-v43-cwd-");
  const fn = makeClaudeCodeInstruct({ cwd, binary: shim.binary, log: (l) => lines.push(l) });
  const out = await fn({ signal: new AbortController().signal, ...BASE, model: DEFAULT_FNGEN_CONFIG.model });

  assert.strictEqual(lines.length, 1);
  assert.match(lines[0], /model=cli-default/, "an omitted --model is reported as cli-default, never as the ollama tag");
  assert.match(lines[0], /fence-strip=no/);
  assert.ok(lines[0].includes(`ttft=${out.ttftMs}ms`), `A8: ttft= is the mapped value even on the fallback path; got ${lines[0]}`);
  assert.ok(lines[0].includes(`total=${out.totalMs}ms`), `A8: total= is the mapped value even on the fallback path; got ${lines[0]}`);
});

test("extra: a failed round logs a line carrying its taxonomy reason", async () => {
  const lines = [];
  const shim = makeShim({ stderr: "boom\n", exitCode: 2 });
  const cwd = tmpDir("c80-v43-cwd-");
  const fn = makeClaudeCodeInstruct({ cwd, binary: shim.binary, log: (l) => lines.push(l) });
  await assert.rejects(fn({ signal: new AbortController().signal, ...BASE }), isClaudeCodeError("exit"));
  assert.ok(
    lines.some((l) => /reason=exit/.test(l)),
    `a failure logs its reason; got ${JSON.stringify(lines)}`
  );
});
