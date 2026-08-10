// Implementation-side pins for session-v44 phase 2, written against the fixes
// the adversarial review and its triage produced. The blind file proves the
// contract; this file pins the four behaviours the review had to find because
// nothing was asserting them:
//
// 1. A cancelled round spawns NOTHING, in every window, including the one
//    between turn 1 and turn 2 where the abort listener can never fire.
// 2. Single-flight is keyed by hash, so a third round cannot evict an in-flight
//    warm and buy a second turn 1 for a block set that already has one coming.
// 3. Only the failure shapes a lost checkpoint takes may degrade. A throttle
//    fails the round, and it fails it exactly once on the channel.
// 4. A degraded round splices ONE generation. It is the only path in the file
//    that runs a round twice, so two chunks would be a user-visible corruption.
//
// Run: SKIP_LIVE=1 node --test test/impl-v44-fork.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-v44-fork",
  `export { makeClaudeCodeInstruct, MIN_PREFIX_BYTES } from "../src/core/claudeCodeInstruct";\n`
);
const { makeClaudeCodeInstruct, MIN_PREFIX_BYTES } = mod;
test.after(cleanup);

// A `claude` that claims an index atomically, records its argv and stdin, then
// serves the reply configured for that index. `sleepMs` holds the child open so
// a test can land an abort inside a known window.
const SHIM_SRC = `#!/usr/bin/env node
"use strict";
const fs = require("fs");
const path = require("path");
const rec = path.join(__dirname, "rec");
let i = 0;
for (;;) {
  try { fs.writeFileSync(path.join(rec, "claim-" + i), "", { flag: "wx" }); break; }
  catch (e) { if (e.code !== "EEXIST") throw e; i++; }
}
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, "replies.json"), "utf8"));
fs.writeFileSync(path.join(rec, "argv-" + i + ".json"), JSON.stringify(process.argv.slice(2)));
const chunks = [];
process.stdin.on("data", (d) => chunks.push(d));
process.stdin.on("end", () => {
  fs.writeFileSync(path.join(rec, "stdin-" + i + ".txt"), Buffer.concat(chunks));
  const reply = cfg.replies[Math.min(i, cfg.replies.length - 1)];
  const emit = () => process.stdout.write(JSON.stringify(reply));
  if (cfg.sleepMs) setTimeout(emit, cfg.sleepMs); else emit();
});
`;

const tmpDirs = [];
test.after(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
});

function rig(replies, sleepMs = 0) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "c80-v44-impl-")));
  tmpDirs.push(dir);
  const rec = path.join(dir, "rec");
  fs.mkdirSync(rec);
  fs.writeFileSync(path.join(dir, "replies.json"), JSON.stringify({ replies, sleepMs }));
  const bin = path.join(dir, "claude");
  fs.writeFileSync(bin, SHIM_SRC, { mode: 0o755 });
  fs.chmodSync(bin, 0o755);
  const lines = [];
  return {
    lines,
    fn: makeClaudeCodeInstruct({ cwd: dir, binary: bin, log: (l) => lines.push(l) }),
    spawns: () => fs.readdirSync(rec).filter((f) => /^claim-\d+$/.test(f)).length,
    stdin: (i) => fs.readFileSync(path.join(rec, `stdin-${i}.txt`), "utf8"),
    argv: (i) => JSON.parse(fs.readFileSync(path.join(rec, `argv-${i}.json`), "utf8")),
    turn1Lines: () => lines.filter((l) => /turn1=/.test(l)),
    roundLine: () => lines.find((l) => /fence-strip=/.test(l)),
  };
}

const ok = (result, session) => ({
  type: "result",
  subtype: "success",
  is_error: false,
  num_turns: 1,
  stop_reason: "end_turn",
  result,
  session_id: session,
  ttft_ms: 1,
  duration_ms: 2,
});
const cliError = (text) => ({ type: "result", subtype: "error_during_execution", is_error: true, result: text });
const throttled = () => ({ type: "result", subtype: "success", is_error: false, num_turns: 1, result: "ok", api_error_status: 429 });

// A prefix comfortably over the floor, and a prompt that leads with it.
const prefixOf = (marker) =>
  `Context: file:///ref.ts#L1-L400\n\`\`\`\n${marker}\n${"const filler = 1;\n".repeat(200)}\`\`\``;
const promptFor = (prefix) => `${prefix}\n\nWrite the function.\n\n\`\`\`ts\nexport function f(): void\n\`\`\``;

function call(rig, prefix, signal, onChunk) {
  return rig.fn({
    apiBase: "",
    model: "claude-opus-5",
    prompt: promptFor(prefix),
    cachePrefix: prefix,
    maxTokens: 256,
    temperature: 0,
    signal: signal ?? new AbortController().signal,
    onChunk,
  });
}

const isAbort = (err) => err instanceof Error && err.name === "AbortError";

// ---------------------------------------------------------------------------
// 1. a cancelled round spends nothing
// ---------------------------------------------------------------------------

// The window the review found: `addEventListener` never fires for a signal that
// is ALREADY aborted, so an abort landing after turn 1 resolved and before
// turn 2 spawned used to run the whole generation and return it.
test("an abort landing between turn 1 and turn 2 spawns no generation", async () => {
  const prefix = prefixOf("between-turns");
  const r = rig([ok("understood", "sid-between"), ok("export function f(): void {}")]);
  const controller = new AbortController();
  // The turn-1 evidence line is written on the success path out of turn 1, which
  // is exactly the window. No timing luck needed.
  const armed = makeArm(r, controller);
  await armed;
  await assert.rejects(call(r, prefix, controller.signal), isAbort);
  assert.strictEqual(r.spawns(), 1, "turn 1 ran; the generation must not have");
});

function makeArm(r, controller) {
  const original = r.lines.push.bind(r.lines);
  r.lines.push = (line) => {
    if (/turn1=warmed/.test(line)) {
      controller.abort();
    }
    return original(line);
  };
  return Promise.resolve();
}

test("a waiter sharing an in-flight turn 1 is not handed a generation after its own abort", async () => {
  const prefix = prefixOf("shared-warm");
  // 150ms of turn 1 is a wide window: live it is 2 to 12 seconds.
  const r = rig([ok("understood", "sid-shared"), ok("export function f(): void {}"), ok("export function g(): void {}")], 150);
  const first = new AbortController();
  const second = new AbortController();
  const a = call(r, prefix, first.signal);
  const b = call(r, prefix, second.signal);
  second.abort();
  await assert.rejects(b, isAbort);
  await a;
  assert.strictEqual(r.spawns(), 2, "one turn 1 and one fork: the cancelled waiter spawned nothing");
});

test("a round already aborted never reaches the CLI at all", async () => {
  const prefix = prefixOf("dead-on-arrival");
  const r = rig([ok("understood", "sid-x"), ok("fn")]);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(call(r, prefix, controller.signal), isAbort);
  assert.strictEqual(r.spawns(), 0);
});

// ---------------------------------------------------------------------------
// 2. single-flight is keyed by hash
// ---------------------------------------------------------------------------

// One slot meant a round on a DIFFERENT block set evicted the in-flight entry,
// and the next round on the original one built a second turn 1 for a checkpoint
// that was already coming. Every extra turn 1 is a full cache write off the
// user's subscription for a session orphaned the moment it exists.
test("a third round cannot make a second turn 1 for a payload whose warm is in flight", async () => {
  const p1 = prefixOf("payload-one");
  const p2 = prefixOf("payload-two");
  const r = rig(
    [
      ok("understood", "sid-p1"),
      ok("understood", "sid-p2"),
      ok("gen a"),
      ok("gen b"),
      ok("gen c"),
    ],
    120
  );
  const rounds = [call(r, p1), call(r, p2), call(r, p1)];
  await Promise.all(rounds);
  assert.strictEqual(
    r.turn1Lines().length,
    2,
    `one turn 1 per payload, not one per round: ${JSON.stringify(r.turn1Lines())}`
  );
});

// ---------------------------------------------------------------------------
// 3. only a lost checkpoint may degrade
// ---------------------------------------------------------------------------

test("a turn-1 serving failure fails the round rather than buying a second call", async () => {
  const prefix = prefixOf("throttled-warm");
  const r = rig([throttled(), ok("export function f(): void {}")]);
  await assert.rejects(call(r, prefix), (err) => err.reason === "serving-failure");
  assert.strictEqual(r.spawns(), 1, "retrying a throttle makes it worse");
  const failures = r.lines.filter((l) => /round=failed/.test(l));
  assert.deepStrictEqual(failures, ["[claude-code] round=failed reason=serving-failure model=claude-opus-5"]);
});

test("a turn-1 cli-error degrades to a whole-prompt round and names the reason", async () => {
  const prefix = prefixOf("broken-warm");
  const r = rig([cliError("No conversation found"), ok("export function f(): void {}")]);
  const out = await call(r, prefix);
  assert.strictEqual(out.text, "export function f(): void {}");
  assert.strictEqual(r.stdin(1), promptFor(prefix), "the degraded round carries the WHOLE prompt");
  assert.match(r.roundLine(), /cache-mode=degraded cache-degraded=cli-error/);
});

// A successful degrade is a successful round. A `round=failed` line beside it is
// a phantom failure for anyone counting them out of the channel, and phase 4 and
// v45's rig both do.
test("a round that degrades and succeeds logs no failure line", async () => {
  const prefix = prefixOf("degrade-clean");
  const r = rig([ok("understood", "sid-d"), cliError("No conversation found"), ok("export function f(): void {}")]);
  await call(r, prefix);
  assert.deepStrictEqual(
    r.lines.filter((l) => /round=failed/.test(l)),
    [],
    `a successful degrade is not a failure: ${JSON.stringify(r.lines)}`
  );
});

// ---------------------------------------------------------------------------
// 4. a degraded round splices one generation, not two
// ---------------------------------------------------------------------------

test("the degrade path fires onChunk exactly once", async () => {
  const prefix = prefixOf("one-chunk");
  const r = rig([ok("understood", "sid-c"), cliError("No conversation found"), ok("export function f(): void {}")]);
  const chunks = [];
  await call(r, prefix, undefined, (c) => chunks.push(c));
  assert.deepStrictEqual(chunks, ["export function f(): void {}"], "two chunks would splice twice");
});

// ---------------------------------------------------------------------------
// the floor, pinned to the exported constant rather than to a magic number
// ---------------------------------------------------------------------------

test("MIN_PREFIX_BYTES is the floor, and it is measured in bytes", async () => {
  assert.strictEqual(MIN_PREFIX_BYTES, 2048);
  // One byte short, in BYTES: 1024 two-byte characters is 2048 bytes and 1024
  // UTF-16 units, so a length-based floor would refuse this and a byte-based
  // one takes it.
  const wide = "é".repeat(MIN_PREFIX_BYTES / 2);
  const r = rig([ok("understood", "sid-w"), ok("fn")]);
  await call(r, wide);
  assert.strictEqual(r.spawns(), 2, "2048 BYTES clears the floor even at half the character count");
});
