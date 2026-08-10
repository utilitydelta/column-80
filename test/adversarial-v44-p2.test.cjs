// Adversarial review: session-v44 phase 2, the fork transport for Claude Code.
//
// Written AFTER the implementation, with the implementation read. Every row
// here is an attempt to break something the blind oracle did not reach: the
// windows around an abort, the depth of the single-flight slot, what a turn-1
// serving failure costs, and whether the split can lose a byte.
//
// Rows named CLEAN are the attacks that failed. They are kept because a green
// row that tried hard is evidence too, and because they pin behaviour the next
// session could break without noticing.
//
// Run: node --test test/adversarial-v44-p2.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { bundleCore, sleep } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "adv-v44-p2",
  `export { makeClaudeCodeInstruct, MIN_PREFIX_BYTES } from "../src/core/claudeCodeInstruct";
export * as prompt from "../src/core/prompt";
export * as cloud from "../src/core/cloudInstruct";\n`
);
const { makeClaudeCodeInstruct, MIN_PREFIX_BYTES, prompt: P, cloud: CL } = mod;
test.after(cleanup);

// ---------------------------------------------------------------------------
// the multi-spawn fake `claude` shim (same mechanics as blind-v44-fork)
// ---------------------------------------------------------------------------

const SHIM_SRC = `#!/usr/bin/env node
"use strict";
const fs = require("fs");
const path = require("path");
const rec = path.join(__dirname, "rec");
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, "shim-config.json"), "utf8"));
let idx = 0;
for (;;) {
  try { fs.closeSync(fs.openSync(path.join(rec, "claim-" + idx), "wx")); break; }
  catch (e) { if (e.code !== "EEXIST") throw e; idx++; }
}
const at = (n) => path.join(rec, idx + "." + n);
const reply = (cfg.replies && cfg.replies[idx]) || cfg.fallback || {};
fs.writeFileSync(at("pid.txt"), String(process.pid));
fs.writeFileSync(at("argv.json"), JSON.stringify(process.argv.slice(2)));
function writeAll(fd, s) {
  const b = Buffer.from(s, "utf8");
  let off = 0;
  while (off < b.length) {
    try { off += fs.writeSync(fd, b, off, b.length - off); }
    catch (e) { if (e.code !== "EAGAIN") throw e; }
  }
}
const sub = (s) => String(s).split("__INDEX__").join(String(idx));
function emit() {
  if (reply.stderr) writeAll(2, sub(reply.stderr));
  if (reply.stdout) writeAll(1, sub(reply.stdout));
  fs.writeFileSync(at("finished.txt"), "1");
  process.exitCode = reply.exitCode || 0;
}
const bomb = setTimeout(() => { process.exit(99); }, 10000);
const chunks = [];
process.stdin.on("data", (d) => chunks.push(d));
process.stdin.on("end", () => {
  clearTimeout(bomb);
  fs.writeFileSync(at("stdin.bin"), Buffer.concat(chunks));
  if (reply.sleepMs) setTimeout(emit, reply.sleepMs);
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

function makeShim(replies = [], fallback = {}) {
  const dir = tmpDir("c80-adv44-shim-");
  const rec = path.join(dir, "rec");
  fs.mkdirSync(rec);
  fs.writeFileSync(path.join(dir, "shim-config.json"), JSON.stringify({ replies, fallback }));
  const bin = path.join(dir, "claude");
  fs.writeFileSync(bin, SHIM_SRC, { mode: 0o755 });
  fs.chmodSync(bin, 0o755);
  const at = (i, n) => path.join(rec, `${i}.${n}`);
  const count = () => fs.readdirSync(rec).filter((f) => /^claim-\d+$/.test(f)).length;
  const one = (i) => ({
    index: i,
    argv: fs.existsSync(at(i, "argv.json")) ? JSON.parse(fs.readFileSync(at(i, "argv.json"), "utf8")) : null,
    stdin: fs.existsSync(at(i, "stdin.bin")) ? fs.readFileSync(at(i, "stdin.bin"), "utf8") : null,
    // Tolerated, not required. The child claims its index with an atomic
    // O_EXCL create BEFORE it writes anything else, so a row that reads a spawn
    // the moment count() sees it can arrive between the claim and this file. An
    // eager read there threw ENOENT under load, which is a flaky row and a
    // false regression hunt for whoever meets it next.
    pid: fs.existsSync(at(i, "pid.txt")) ? Number(fs.readFileSync(at(i, "pid.txt"), "utf8")) : undefined,
  });
  return { binary: bin, count, spawn: one, all: () => Array.from({ length: count() }, (_, i) => one(i)) };
}

const TAIL = "// write the body\nfn add(a: i32, b: i32) -> i32 {\n";
const BASE = {
  apiBase: "http://localhost:19999",
  model: "claude-opus-5",
  maxTokens: 2048,
  temperature: 0.2,
  numGpu: 30,
  numCtx: 16384,
  think: false,
};

function reply(over = {}) {
  const out = {
    type: "result",
    subtype: "success",
    is_error: false,
    num_turns: 1,
    session_id: "sid-__INDEX__-0123456789abcdef",
    ttft_ms: 111,
    duration_ms: 222,
    stop_reason: "end_turn",
    result: "a + b",
    ...over,
  };
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return JSON.stringify(out);
}
const sid = (i) => `sid-${i}-0123456789abcdef`;
const OK_REPLY = { stdout: reply() };
const okWith = (over, extra = {}) => ({ stdout: reply(over), ...extra });

function prefixOf(n, fill = "c") {
  const head = "// file:///w/ctx.rs 1-40\nCONTEXT_SENTINEL_ALPHA\n";
  return (head + fill.repeat(n)).slice(0, n);
}
const promptFor = (prefix, tail = TAIL) => `${prefix}\n\n${tail}`;

// A generator instance plus the knobs the attacks need: a log hook that can
// fire back into the test, and a per-call AbortSignal.
function rig(replies = [], fallback = OK_REPLY, config = {}, onLine = () => undefined) {
  const shim = makeShim(replies, fallback);
  const cwd = tmpDir("c80-adv44-cwd-");
  const lines = [];
  const fn = makeClaudeCodeInstruct({
    cwd,
    binary: shim.binary,
    log: (l) => {
      lines.push(l);
      onLine(l);
    },
    ...config,
  });
  return {
    shim,
    cwd,
    lines,
    fn,
    call: (extra = {}) => fn({ signal: new AbortController().signal, prompt: TAIL, ...BASE, ...extra }),
  };
}

const resumeOf = (argv) => {
  const at = (argv ?? []).indexOf("--resume");
  return at === -1 ? null : argv[at + 1];
};
const isTurn1 = (sp) => resumeOf(sp.argv) === null;
const field = (line, name) => {
  const m = line.match(new RegExp(`(?:^|\\s)${name}=(\\S*)`));
  return m === null ? null : m[1];
};
const roundLines = (lines) => lines.filter((l) => /^\[claude-code\]/.test(l) && /fence-strip=/.test(l));

async function waitFor(pred, ms, what) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (pred()) return;
    await sleep(20);
  }
  throw new Error(`timed out waiting for ${what}`);
}
const settled = (p) => p.then((v) => ({ ok: true, v }), (e) => ({ ok: false, e }));

// ---------------------------------------------------------------------------
// A1: the window between turn 1 and turn 2 has no abort check
// ---------------------------------------------------------------------------

test("A1: an abort landing between turn 1 and turn 2 still spawns turn 2 and resolves the cancelled round", async () => {
  // The transport checks `signal.aborted` once, at the top of the round, and
  // then again only inside the two catch blocks. Between turn 1 resolving and
  // turn 2 spawning there is no check at all, and `spawnClaude` attaches its
  // abort listener with addEventListener - which never fires for a signal that
  // is ALREADY aborted. So the child starts, runs to completion, and the
  // subscription pays for a generation the user cancelled.
  //
  // The turn-1 evidence line is logged synchronously inside warmTurn1, before
  // it returns the session id, so aborting from the log hook lands the signal
  // exactly in that window with no timing luck involved.
  const prefix = prefixOf(4096);
  const body = promptFor(prefix);
  const ac = new AbortController();
  const r = rig([], OK_REPLY, {}, (line) => {
    if (/turn1=warmed/.test(line)) {
      ac.abort();
    }
  });

  const out = await settled(r.fn({ signal: ac.signal, prompt: body, cachePrefix: prefix, ...BASE }));
  await sleep(300);

  assert.strictEqual(
    out.ok,
    false,
    `a round whose signal aborted must reject with an AbortError, not hand back a generation.\n` +
      `  spawns: ${r.shim.count()} (turn 1, and turn 2 if it started after the abort)`
  );
  assert.strictEqual(
    r.shim.count(),
    1,
    "contract row 10 / decision rule: an aborted round never starts turn 2, and never spends the subscription " +
      "on a reply nobody reads. Turn 1 had already spawned; the abort landed before turn 2."
  );
});

test("A2: a waiter sharing an in-flight turn 1 spawns its fork after its OWN abort", async () => {
  // Amendment B8 rules that a waiter decides on its own signal. It does, for
  // the FAILURE direction (another round's cancellation must not fail it). The
  // success direction has no check: the shared warm resolves, the waiter walks
  // straight into oneRound with an aborted signal, and spends a whole
  // generation. The window here is not a microtask - it is the entire duration
  // of turn 1, measured at 2 to 12 seconds live.
  const prefix = prefixOf(4096);
  const body = promptFor(prefix);
  const r = rig([okWith({}, { sleepMs: 500 })], OK_REPLY);

  const acA = new AbortController();
  const acB = new AbortController();
  const pA = settled(r.fn({ signal: acA.signal, prompt: body, cachePrefix: prefix, ...BASE }));
  const pB = settled(r.fn({ signal: acB.signal, prompt: body, cachePrefix: prefix, ...BASE }));

  await waitFor(() => r.shim.count() >= 1, 3000, "turn 1 to spawn");
  assert.strictEqual(r.shim.count(), 1, "precondition: the two rounds share ONE turn 1");
  acB.abort();

  const [a, b] = [await pA, await pB];
  await sleep(300);

  assert.strictEqual(a.ok, true, "precondition: the round that was not cancelled still succeeds");
  assert.strictEqual(
    b.ok,
    false,
    "the cancelled waiter must reject with an AbortError rather than deliver a generation"
  );
  const forks = r.shim.all().filter((s) => !isTurn1(s));
  assert.strictEqual(
    forks.length,
    1,
    "only the live round's fork may spawn: the cancelled waiter must not pay for a generation nobody reads"
  );
});

// ---------------------------------------------------------------------------
// A3: the single-flight slot is one entry deep
// ---------------------------------------------------------------------------

test("A3: a third round on a hash whose warm is still in flight builds a SECOND turn 1 for the same block set", async () => {
  // "A second round arriving with the SAME hash awaits the in-flight turn 1
  // rather than starting its own." ForkCache tracks ONE inflight promise and
  // ONE inflightHash, so a round on a different hash overwrites the slot and
  // the next round on the ORIGINAL hash no longer matches anything. Two turn 1s
  // for one block set, both billed, one immediately orphaned.
  const p1 = prefixOf(4096);
  const p2 = `${p1.slice(0, 2000)}X${p1.slice(2001)}`;
  const r = rig([], okWith({}, { sleepMs: 250 }));

  const results = await Promise.all([
    r.call({ prompt: promptFor(p1), cachePrefix: p1 }),
    r.call({ prompt: promptFor(p2), cachePrefix: p2 }),
    r.call({ prompt: promptFor(p1), cachePrefix: p1 }),
  ]);
  assert.strictEqual(results.length, 3, "precondition: all three rounds completed");

  const turn1s = r.shim.all().filter(isTurn1);
  const byPayload = new Map();
  for (const t of turn1s) {
    const payload = t.stdin.slice(0, 4096);
    byPayload.set(payload, (byPayload.get(payload) ?? 0) + 1);
  }
  assert.strictEqual(
    byPayload.get(p1),
    1,
    `one block set means one turn 1, however many rounds race for it: two rounds on the same hash ` +
      `must share the in-flight warm.\n  turn-1 spawns per payload: ${JSON.stringify([...byPayload.values()])}`
  );
  assert.strictEqual(turn1s.length, 2, "two distinct block sets, two checkpoints, and no more");
});

// ---------------------------------------------------------------------------
// A4: a throttled turn 1 buys a second call against the throttle
// ---------------------------------------------------------------------------

test("A4: a turn-1 SERVING FAILURE degrades into a second spawn and reports the round as a success", async () => {
  // goal.md's Degrading rule: "retrying a throttle makes it worse", and row 9
  // holds the fork round to it. Turn 1 is exempted by the contract's step 5
  // ("any failure building turn 1 -> single-shot"), so a rate-limited CLI gets
  // hit twice, and if the second call happens to land the round returns SUCCESS
  // with the serving failure buried in cache-degraded=. v45's rig aborts a run
  // on a serving failure, and this is the shape that hides one from it.
  const prefix = prefixOf(4096);
  const body = promptFor(prefix);
  const r = rig([{ stderr: "Claude AI usage limit reached\n", exitCode: 1 }], OK_REPLY);

  const out = await settled(r.call({ prompt: body, cachePrefix: prefix }));

  const line = roundLines(r.lines)[0];
  assert.strictEqual(
    r.shim.count(),
    1,
    `a throttle is a fact about the hour, not about the checkpoint: no second call goes out against it.\n` +
      `  round resolved: ${out.ok}\n  round line: ${line ?? "<none>"}`
  );
  assert.strictEqual(out.ok, false, "the round must surface the serving failure rather than swallow it");
  if (line !== undefined) {
    assert.ok(
      ["cli-error", "exit", "bad-json", "no-session"].includes(field(line, "cache-degraded")),
      `amendment B5 rules the cache-degraded vocabulary: cli-error, exit, bad-json, no-session.\n  got: ${line}`
    );
  }
});

test("A5: a turn-1 TIMEOUT is also retried, so one round can hold two full timeout windows", async () => {
  // "timeout (expensive by definition)" is on the never-retry list for the fork
  // round. Turn 1 is not on it, so a hung CLI costs the configured cap twice
  // before the round gives up or answers.
  const prefix = prefixOf(4096);
  const body = promptFor(prefix);
  const r = rig([okWith({}, { sleepMs: 5000 })], OK_REPLY, { timeoutMs: 300 });

  const t0 = Date.now();
  await settled(r.call({ prompt: body, cachePrefix: prefix }));
  const elapsed = Date.now() - t0;
  await sleep(200);

  assert.strictEqual(
    r.shim.count(),
    1,
    `a timed-out turn 1 must not buy a second full-length call.\n  elapsed: ${elapsed}ms against a 300ms cap`
  );
});

// ---------------------------------------------------------------------------
// A6: a degraded round logs itself as a failure too
// ---------------------------------------------------------------------------

test("A6: a round that degrades and SUCCEEDS still writes a round=failed evidence line", async () => {
  // oneRound logs `round=failed reason=...` from its own catch, and runRound
  // then retries and logs the successful degraded line. The channel therefore
  // carries one failure line per successful degrade, which is what a human and
  // v45's rig both count failures from.
  const prefix = prefixOf(4096);
  const body = promptFor(prefix);
  const r = rig([OK_REPLY, OK_REPLY, okWith({ is_error: true, subtype: "error_during_execution" })]);
  await r.call({ prompt: body, cachePrefix: prefix });
  r.lines.length = 0;

  const out = await r.call({ prompt: body, cachePrefix: prefix });
  assert.strictEqual(out.text, "a + b", "precondition: the degrade succeeded");
  assert.deepStrictEqual(
    r.lines.filter((l) => /round=failed/.test(l)),
    [],
    `a round that succeeded must not also report itself failed: the degrade is the recovery, and the ` +
      `cache-degraded field already names it.\n  got: ${JSON.stringify(r.lines)}`
  );
});

// ---------------------------------------------------------------------------
// A7: the checkpoint is not keyed on the model
// ---------------------------------------------------------------------------

// TRIAGE RULING 2026-08-08, kept verbatim from the deleted `todo` marker:
//
//   DEFERRED by triage 2026-08-08 as scraps S44-4. Real, and NOT reachable through
//   today's wiring: one fn-gen service holds one config.model and one transport
//   instance, fallbackModel is a settings-level substitution rather than a
//   per-round retry, and a settings change rebuilds the service and drops the
//   cache. This row reaches it only by calling the transport directly with two
//   models. Keying on the model would also contradict the contract's 'the key IS
//   the content' sentence for a case that cannot occur. Red on purpose: it is the
//   tripwire for the day a caller varies params.model across rounds against ONE
//   transport instance, which a rig comparing model arms would.
//
// CONVERTED 2026-08-10 (session-v48 phase 0, G4): this row USED to assert
// `resumeOf(second.argv) !== sid(0)` - that a round asking for a different
// --model must warm its own checkpoint. It was red on purpose under the ruling
// above. It now asserts the same expression's actual value: the second round
// DOES resume the first model's session id, because the key is the payload
// bytes alone. The tripwire is unchanged in force, only inverted in polarity -
// the day the key gains a model rung, this row goes red and names why.
test("KNOWN WRONG: a round forks a checkpoint minted under a DIFFERENT --model", async () => {
  // The key is the payload bytes alone. Anthropic caches per model, so a fork
  // carrying --model B off a checkpoint built under --model A can only miss.
  // Not reachable through today's wiring (one service, one config.model, one
  // transport instance), so this is a seam property rather than a live bug.
  const prefix = prefixOf(4096);
  const body = promptFor(prefix);
  const r = rig();
  await r.call({ prompt: body, cachePrefix: prefix, model: "claude-opus-5" });
  await r.call({ prompt: body, cachePrefix: prefix, model: "claude-haiku-4-5" });

  const second = r.shim.spawn(2);
  const modelOf = (argv) => argv[argv.indexOf("--model") + 1];
  assert.strictEqual(modelOf(second.argv), "claude-haiku-4-5", "precondition: the round asked for the other model");
  assert.strictEqual(
    resumeOf(second.argv),
    sid(0),
    "today the key is the payload bytes alone, so the haiku round resumes the checkpoint opus minted; " +
      "a checkpoint that belonged to the model that minted it would resume something else"
  );
});

// ---------------------------------------------------------------------------
// CLEAN rows: attacks that failed
// ---------------------------------------------------------------------------

test("CLEAN: the split is byte-exact even when the prefix repeats, holds separators, and is multibyte", () => {
  // The split is by LENGTH after a startsWith check, never by searching for the
  // separator, so a payload that contains blank lines or reproduces itself in
  // the tail cannot move the cut. Asserted through the transport by
  // reconstructing the prompt from what the fork actually received.
  const block = "Context: file:///w/a.rs#L1-L9\n```\nlet s = \"\\n\\n\";\n\nlet e = 'é';\n```";
  const prefix = `${block}\n\n${block}\n\n${"é".repeat(1200)}`;
  assert.ok(Buffer.byteLength(prefix, "utf8") >= MIN_PREFIX_BYTES, "fixture: above the floor in BYTES");
  // The tail repeats the prefix verbatim, so any separator search would cut late.
  const tail = `${prefix}\n\nfn f() {\n`;
  const body = `${prefix}\n\n${tail}`;

  const r = rig();
  return r.call({ prompt: body, cachePrefix: prefix }).then(() => {
    assert.strictEqual(r.shim.count(), 2, "above the floor and a genuine prefix: warm then fork");
    assert.strictEqual(r.shim.spawn(1).stdin, tail, "the fork carries exactly the bytes after the FIRST separator");
    assert.strictEqual(
      `${prefix}\n\n${r.shim.spawn(1).stdin}`,
      body,
      "prefix + separator + fork stdin reconstructs the prompt: no byte dropped, none duplicated"
    );
    assert.strictEqual(r.shim.spawn(0).stdin.slice(0, prefix.length), prefix, "turn 1 carried the payload verbatim");
  });
});

test("CLEAN: the floor is measured in BYTES, so a multibyte payload under 2048 chars still clears it", async () => {
  const prefix = "é".repeat(1024); // 1024 chars, 2048 bytes
  assert.strictEqual(Buffer.byteLength(prefix, "utf8"), MIN_PREFIX_BYTES, "fixture: exactly the floor in bytes");
  const r = rig();
  await r.call({ prompt: promptFor(prefix), cachePrefix: prefix });
  assert.strictEqual(r.shim.count(), 2, "a byte floor read as a character floor would have sent this single-shot");
});

test("CLEAN: the stored key and the stored session are written as one pair, so a lost race cannot serve a stale checkpoint", async () => {
  // Two rounds on DIFFERENT payloads race their warms; the slow one lands last
  // and owns the slot. The attack is whether a hash from one warm can ever be
  // stored beside a session id from the other. It cannot: ForkCache writes both
  // fields in one synchronous step inside the warm's own continuation.
  const p1 = prefixOf(4096);
  const p2 = `${p1.slice(0, 2000)}X${p1.slice(2001)}`;
  const r = rig([okWith({}, { sleepMs: 400 }), okWith({}, { sleepMs: 30 })], OK_REPLY);
  await Promise.all([
    r.call({ prompt: promptFor(p1), cachePrefix: p1 }),
    r.call({ prompt: promptFor(p2), cachePrefix: p2 }),
  ]);
  r.lines.length = 0;

  // Whichever payload owns the slot now, a third round on it must resume the
  // session that THAT payload's turn 1 minted, never the other one's.
  const turn1s = r.shim.all().filter(isTurn1);
  const mintedBy = new Map(turn1s.map((t) => [t.stdin.slice(0, 4096), sid(t.index)]));
  for (const p of [p1, p2]) {
    const before = r.shim.count();
    await r.call({ prompt: promptFor(p), cachePrefix: p });
    const spawns = r.shim.all().slice(before);
    const fork = spawns.find((s) => !isTurn1(s));
    const freshTurn1 = spawns.find(isTurn1);
    const expected = freshTurn1 === undefined ? mintedBy.get(p) : sid(freshTurn1.index);
    assert.strictEqual(
      resumeOf(fork.argv),
      expected,
      "a fork resumes the checkpoint built from ITS OWN payload bytes, or a freshly minted one"
    );
    if (freshTurn1 !== undefined) {
      assert.strictEqual(freshTurn1.stdin.slice(0, 4096), p, "and a fresh turn 1 carries the payload it was asked for");
    }
  }
});

test("CLEAN: a payload that shrinks to a leading substring never leaves the removed block out of the round", async () => {
  // The staleness shape the guard has to catch: the prompt was assembled with
  // two blocks and the prefix was rendered from one. startsWith still passes,
  // so the transport splits - and the second block must still reach the model,
  // in turn 2.
  const b1 = "Context: file:///w/a.rs#L1-L9\n```\n" + "a".repeat(3000) + "\n```";
  const b2 = "Context: file:///w/b.rs#L1-L4\nSENTINEL_SECOND_BLOCK";
  const body = `${b1}\n\n${b2}\n\n${TAIL}`;
  const r = rig();
  await r.call({ prompt: body, cachePrefix: b1 });

  assert.strictEqual(r.shim.count(), 2, "a genuine leading substring above the floor still forks");
  assert.ok(
    r.shim.spawn(1).stdin.includes("SENTINEL_SECOND_BLOCK"),
    "everything the prefix does not cover rides turn 2: no block can be dropped by the split"
  );
  assert.ok(
    !r.shim.spawn(0).stdin.includes("SENTINEL_SECOND_BLOCK"),
    "and turn 1 cached only what it was handed"
  );
});

test("CLEAN: the ollama-path assemblers still decompose into renderContextPrefix plus their block-free bytes", () => {
  // Decision rule 1 at the assembly seam: adding the prefix renderer must not
  // have moved one byte of what the local path sends.
  const blocks = [
    { uri: "file:///w/a.rs", range: { startLine: 3, endLine: 9 }, text: "struct Acc;" },
    { uri: "file:///w/b.rs", range: { startLine: 1, endLine: 4 }, text: "fn helper() {}\n" },
  ];
  const prefix = P.renderContextPrefix(blocks);
  const withBlocks = P.assembleFnGenPrompt({ signature: "fn add()", docComment: "/// Adds.", languageId: "rust", contextBlocks: blocks });
  const without = P.assembleFnGenPrompt({ signature: "fn add()", docComment: "/// Adds.", languageId: "rust" });
  assert.strictEqual(withBlocks, `${prefix}\n\n${without}`, "the blocks are a pure prepend");
  assert.strictEqual(P.renderContextPrefix([]), "", "amendment B7: no blocks is the empty string");
  assert.strictEqual(P.renderContextPrefix(undefined), "", "and so is an absent list");
  assert.strictEqual(P.SECTION_SEPARATOR, "\n\n", "the exported separator is the one the transport splits on");
});

test("CLEAN: the cloud client's request body does not change by one byte when cachePrefix is set", async (t) => {
  const requests = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", () => {
      requests.push(raw);
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "a + b" }, finish_reason: null }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n`);
      res.write("data: [DONE]\n\n");
      res.end();
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => new Promise((r) => server.close(r)));

  const fn = CL.makeCloudInstruct({ baseUrl: `http://127.0.0.1:${server.address().port}/v1`, apiKey: "k" });
  const prefix = prefixOf(4096);
  const params = { model: "claude-opus-5", prompt: promptFor(prefix), maxTokens: 512, temperature: 0.2, apiBase: "" };
  await fn({ ...params, signal: new AbortController().signal });
  await fn({ ...params, cachePrefix: prefix, signal: new AbortController().signal });

  assert.strictEqual(requests.length, 2, "one POST each");
  assert.strictEqual(requests[1], requests[0], "decision rule 1 covers the cloud path too");
  assert.ok(!requests[1].includes("cachePrefix"), "the field has no transport here and must not leak into the body");
});

test("CLEAN: an already-aborted round reaches no CLI at all", async () => {
  const prefix = prefixOf(4096);
  const ac = new AbortController();
  ac.abort();
  const r = rig();
  const out = await settled(r.fn({ signal: ac.signal, prompt: promptFor(prefix), cachePrefix: prefix, ...BASE }));
  assert.strictEqual(out.ok, false);
  assert.strictEqual(out.e.name, "AbortError");
  assert.strictEqual(r.shim.count(), 0, "no turn 1 and no fork: the subscription pays nothing for a dead round");
});
