// Implementation-side pins for session-v44 phase 1: the token accounting on the
// `[claude-code]` evidence line.
//
// White-box sibling of test/blind-v44-usage.test.cjs. The blind file proves the
// contract; this file proves the two things the contract cannot state on its
// own:
//
// 1. The derived `billed-eq` reproduces goal.md's cost table EXACTLY, on the
//    numbers that came out of live calls on 2026-08-08. That table is the whole
//    argument for building phase 2, so an arithmetic slip here would make the
//    channel agree with a decision it never actually checked.
// 2. Reporting a round's usage changed nothing about the round: same text, same
//    doneReason, same fields ahead of it on the line.
//
// Run: SKIP_LIVE=1 node --test test/impl-v44-usage.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-v44-usage",
  `export { makeClaudeCodeInstruct } from "../src/core/claudeCodeInstruct";\n`
);
const { makeClaudeCodeInstruct } = mod;
test.after(cleanup);

// A `claude` that reads stdin, prints one canned JSON payload and exits. Small
// on purpose: the timing, kill and abort mechanics already have a shim in
// test/blind-v43-claudecode.test.cjs, and nothing here needs them.
const SHIM_SRC = `#!/usr/bin/env node
"use strict";
const fs = require("fs");
const path = require("path");
const out = fs.readFileSync(path.join(__dirname, "stdout.txt"), "utf8");
process.stdin.resume();
process.stdin.on("end", () => process.stdout.write(out));
`;

const tmpDirs = [];
test.after(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
});

function shimFor(payload) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "c80-v44-")));
  tmpDirs.push(dir);
  fs.writeFileSync(path.join(dir, "stdout.txt"), JSON.stringify(payload));
  const bin = path.join(dir, "claude");
  fs.writeFileSync(bin, SHIM_SRC, { mode: 0o755 });
  fs.chmodSync(bin, 0o755);
  return { binary: bin, cwd: dir };
}

// Runs one round against a shim serving `payload` and hands back the
// `[claude-code]` evidence line plus the result.
async function round(payload) {
  const { binary, cwd } = shimFor(payload);
  const lines = [];
  const generate = makeClaudeCodeInstruct({ cwd, binary, log: (l) => lines.push(l) });
  const result = await generate({
    apiBase: "",
    model: "claude-sonnet-4-5",
    prompt: "write a function",
    maxTokens: 512,
    temperature: 0,
    signal: new AbortController().signal,
  });
  return { line: lines.find((l) => l.startsWith("[claude-code]")), result, lines };
}

function reply(usage) {
  return {
    type: "result",
    subtype: "success",
    is_error: false,
    num_turns: 1,
    stop_reason: "end_turn",
    ttft_ms: 900,
    duration_ms: 1200,
    result: "fn f() {}",
    ...(usage === undefined ? {} : { usage }),
  };
}

function field(line, name) {
  const m = new RegExp(`(?:^| )${name}=([^ ]*)`).exec(line);
  return m === null ? undefined : m[1];
}

// ---------------------------------------------------------------------------
// goal.md's cost table, reproduced through the product's own evidence line
// ---------------------------------------------------------------------------

// Single-shot, measured live 2026-08-08: a generation whose 39KB of context
// blocks got no partial credit and was re-written in full. goal.md prices it at
// 22,761 base-input-token equivalents.
test("billed-eq reproduces goal.md's single-shot row (22,761)", async () => {
  const { line } = await round(
    reply({
      input_tokens: 10,
      output_tokens: 240,
      cache_creation_input_tokens: 11061,
      cache_read_input_tokens: 6291,
      cache_creation: { ephemeral_1h_input_tokens: 11061, ephemeral_5m_input_tokens: 0 },
    })
  );
  assert.strictEqual(field(line, "billed-eq"), "22761");
  assert.strictEqual(field(line, "ttl"), "1h");
});

// The same generation forked from a warm turn 1: the write collapses to 84
// tokens and the whole context arrives as a read. goal.md prices it at 1,908,
// which is the 11.9x the session is being built for.
test("billed-eq reproduces goal.md's two-turn fork row (1,908), 11.9x cheaper", async () => {
  const { line } = await round(
    reply({
      input_tokens: 10,
      output_tokens: 240,
      cache_creation_input_tokens: 84,
      cache_read_input_tokens: 17296,
      cache_creation: { ephemeral_1h_input_tokens: 84, ephemeral_5m_input_tokens: 0 },
    })
  );
  assert.strictEqual(field(line, "billed-eq"), "1908");
  assert.ok(22761 / Number(field(line, "billed-eq")) > 11.9);
});

// The regenerate gesture: an identical prompt is the one case the CLI's own
// breakpoint already serves, and it writes nothing at all.
test("an exact-match round reports no write and a read-dominated cost", async () => {
  const { line } = await round(
    reply({
      input_tokens: 10,
      output_tokens: 240,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 17353,
      cache_creation: { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 0 },
    })
  );
  assert.strictEqual(field(line, "cwrite"), "0");
  assert.strictEqual(field(line, "ttl"), "none");
  assert.strictEqual(field(line, "billed-eq"), "1745");
});

// ---------------------------------------------------------------------------
// the write weights, one row per bucket
// ---------------------------------------------------------------------------

test("a 5-minute write is priced at 1.25x, not 2x", async () => {
  const { line } = await round(
    reply({
      input_tokens: 0,
      output_tokens: 1,
      cache_creation_input_tokens: 1000,
      cache_read_input_tokens: 0,
      cache_creation: { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 1000 },
    })
  );
  assert.strictEqual(field(line, "ttl"), "5m");
  assert.strictEqual(field(line, "billed-eq"), "1250");
});

test("a mixed write prices each bucket at its own weight", async () => {
  const { line } = await round(
    reply({
      input_tokens: 0,
      output_tokens: 1,
      cache_creation_input_tokens: 1400,
      cache_read_input_tokens: 0,
      cache_creation: { ephemeral_1h_input_tokens: 1000, ephemeral_5m_input_tokens: 400 },
    })
  );
  assert.strictEqual(field(line, "ttl"), "mixed");
  assert.strictEqual(field(line, "billed-eq"), "2500");
});

// An unattributed write is charged at the 1-hour rate because that is the rate
// every observed write has used, and `ttl=?` on the same line is what tells the
// reader the basis was assumed rather than read.
test("an unattributed write reports ttl=? and is priced at 2x", async () => {
  const { line } = await round(
    reply({
      input_tokens: 0,
      output_tokens: 1,
      cache_creation_input_tokens: 500,
      cache_read_input_tokens: 0,
    })
  );
  assert.strictEqual(field(line, "ttl"), "?");
  assert.strictEqual(field(line, "billed-eq"), "1000");
});

// ---------------------------------------------------------------------------
// absent is not zero
// ---------------------------------------------------------------------------

test("a reply with no usage says so and reports no numbers", async () => {
  const { line } = await round(reply(undefined));
  assert.match(line, /usage=absent/);
  for (const name of ["in", "out", "cwrite", "cread", "ttl", "billed-eq"]) {
    assert.strictEqual(field(line, name), undefined, `${name} must not appear`);
  }
});

test("a missing field reports ? and poisons billed-eq", async () => {
  const { line } = await round(
    reply({ output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 100 })
  );
  assert.strictEqual(field(line, "in"), "?");
  assert.strictEqual(field(line, "billed-eq"), "?");
});

// ---------------------------------------------------------------------------
// the round itself did not move
// ---------------------------------------------------------------------------

test("the fields ahead of usage keep their spelling, order and values", async () => {
  const { line, result } = await round(
    reply({
      input_tokens: 1,
      output_tokens: 2,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation: { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 0 },
    })
  );
  // `cache-mode=` was added between model= and ttft= by phase 2, under its
  // contract's "Evidence" section. Everything else on the head keeps its
  // spelling, order and value, which is what this row guards.
  assert.match(
    line,
    /^\[claude-code\] fence-strip=no num_turns=1 model=claude-sonnet-4-5 cache-mode=single-shot ttft=\d+ms total=\d+ms cli-ttft=900ms cli-total=1200ms /
  );
  assert.strictEqual(result.text, "fn f() {}");
  assert.strictEqual(result.doneReason, "stop");
});

test("a failed round logs its old line and appends no accounting", async () => {
  const { binary, cwd } = shimFor({ type: "result", is_error: true, subtype: "error_during_execution", result: "boom" });
  const lines = [];
  const generate = makeClaudeCodeInstruct({ cwd, binary, log: (l) => lines.push(l) });
  await assert.rejects(
    generate({
      apiBase: "",
      model: "claude-sonnet-4-5",
      prompt: "p",
      maxTokens: 512,
      temperature: 0,
      signal: new AbortController().signal,
    })
  );
  const failed = lines.find((l) => l.includes("round=failed"));
  assert.strictEqual(failed, "[claude-code] round=failed reason=cli-error model=claude-sonnet-4-5");
});
