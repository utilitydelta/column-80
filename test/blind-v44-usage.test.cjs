// Blind oracle: the usage / cache instrument on the Claude Code backend
// (src/core/claudeCodeInstruct.ts, session-v44 phase 1).
//
// Written from the phase-1 contract ONLY, BEFORE the implementation
// existed. The oracle never read src/core/claudeCodeInstruct.ts. Every
// assertion below traces to a sentence in that contract; the row numbers match
// its "Testing shape" list 1..13, and rows named "extra" trace to a sentence in
// its prose (the Scope section or an Honesty rule) that the numbered list does
// not cover.
//
// KNOWN CONTRADICTION IN THE SPEC, and this file follows the more specific
// sentence: the ttl bullet list says `none` when `cache_creation` is present
// and both buckets are 0, while testing-shape row 9 says `?` for that same
// payload when there is also a write. Row 9 below asserts `?` because it is
// the sentence written about this exact case and it carries its reasoning
// ("there is a write and nothing attributes it"). If the implementation says
// `none` there, the contract has to pick, not this file.
//
// KNOWINGLY UNTESTED: honesty rule 3's non-finite clause. NaN and Infinity
// cannot cross a JSON transport - `JSON.parse` rejects the literals and
// `JSON.stringify` turns them into null - so no shim payload can put one in
// front of the module. The null case stands in for it.
//
// Transport under test is a spawned `claude` binary, so the fixture is the
// same fake `claude` shim test/blind-v43-claudecode.test.cjs uses: a script
// written into a temp dir at test time that prints canned stdout and exits
// with a canned code. No network, no real CLI, no dependence on this machine's
// login state. Assertions read the lines the config's `log` hook receives.
//
// Run: SKIP_LIVE=1 node --test test/blind-v44-usage.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "blind-v44-usage",
  `export { makeClaudeCodeInstruct } from "../src/core/claudeCodeInstruct";\n`
);
const { makeClaudeCodeInstruct } = mod;
test.after(cleanup);

// ---------------------------------------------------------------------------
// the fake `claude` shim (harness copied from blind-v43-claudecode.test.cjs)
// ---------------------------------------------------------------------------

const SHIM_SRC = `#!/usr/bin/env node
"use strict";
const fs = require("fs");
const path = require("path");
const rec = path.join(__dirname, "rec");
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, "shim-config.json"), "utf8"));
const at = (n) => path.join(rec, n);
fs.writeFileSync(at("argv.json"), JSON.stringify(process.argv.slice(2)));
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
  process.exitCode = cfg.exitCode || 0;
}
const bomb = setTimeout(() => process.exit(99), 10000);
process.stdin.on("data", () => {});
process.stdin.on("end", () => { clearTimeout(bomb); emit(); });
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

function makeShim(opts = {}) {
  const dir = tmpDir("c80-v44-shim-");
  fs.mkdirSync(path.join(dir, "rec"));
  fs.writeFileSync(
    path.join(dir, "shim-config.json"),
    JSON.stringify({ stdout: "", stderr: "", exitCode: 0, ...opts })
  );
  const bin = path.join(dir, "claude");
  fs.writeFileSync(bin, SHIM_SRC, { mode: 0o755 });
  fs.chmodSync(bin, 0o755);
  return { binary: bin };
}

const PROMPT = "// write the body\nfn add(a: i32, b: i32) -> i32 {\n";
const BASE = {
  apiBase: "http://localhost:19999",
  model: "claude-opus-5",
  prompt: PROMPT,
  maxTokens: 2048,
  temperature: 0.2,
  numGpu: 30,
  numCtx: 16384,
  think: false,
};

// A well-formed success payload; pass `undefined` for a field to omit it.
// `usage` is absent unless a row puts it there, so honesty rule 1 has a
// fixture and every other row states its own usage explicitly.
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

// One successful round against a canned stdout. Returns the result and every
// line the log hook saw.
async function round(stdout, params = {}) {
  const lines = [];
  const shim = makeShim({ stdout });
  const cwd = tmpDir("c80-v44-cwd-");
  const fn = makeClaudeCodeInstruct({ cwd, binary: shim.binary, log: (l) => lines.push(l) });
  const out = await fn({ signal: new AbortController().signal, ...BASE, ...params });
  assert.ok(lines.length >= 1, "a successful round must log an evidence line to read");
  return { out, lines, line: lines[0] };
}

// The shorthand every usage row uses: build a reply carrying this `usage`
// object and hand back the evidence line.
async function usageLine(usage, over = {}) {
  const { line } = await round(reply({ usage, ...over }));
  return line;
}

// The six appended fields, in the contract's written order, as one group.
const TAIL_RE =
  /(^|\s)in=(\S+) out=(\S+) cwrite=(\S+) cread=(\S+) ttl=(\S+) billed-eq=(\S+)/;

// The fields that were on the line before this phase, in their v43 order.
//
// SUPERSEDED by session-v44 phase 2: `cache-mode=` now sits between model= and
// ttft= (the phase-2 contract, "Evidence"). Phase 1's rule that the
// accounting fields TERMINATE the line is unaffected, and so is every other
// field's spelling, order and value, which is what this row exists to guard.
const HEAD_RE =
  /^\[claude-code\] fence-strip=(?:yes|no) num_turns=\S+ model=\S+ cache-mode=\S+ ttft=\d+ms total=\d+ms cli-ttft=-?\d+ms cli-total=-?\d+ms/;

function tail(line) {
  const m = line.match(TAIL_RE);
  assert.ok(
    m,
    `the line must carry the six appended fields in the contract's order\n` +
      `  expected: in=<n> out=<n> cwrite=<n> cread=<n> ttl=<1h|5m|mixed|none|?> billed-eq=<n>\n` +
      `  got:      ${line}`
  );
  return { in: m[2], out: m[3], cwrite: m[4], cread: m[5], ttl: m[6], billedEq: m[7] };
}

// Reads one field wherever it sits, without demanding the whole group. Used by
// the rows that assert a single field's rendering.
function field(line, name) {
  const m = line.match(new RegExp(`(?:^|\\s)${name}=(\\S*)`));
  return m === null ? null : m[1];
}

// The six field names plus the absent marker, for the rows that assert that
// NOTHING was appended.
const SIX = ["in", "out", "cwrite", "cread", "ttl", "billed-eq"];

// ---------------------------------------------------------------------------
// row 1: the captured real payload
// ---------------------------------------------------------------------------

test("row 1: the captured payload renders in=2 out=11 cwrite=7664 cread=15548 ttl=1h billed-eq=16885", async () => {
  // The contract's own trimmed capture, byte for byte.
  //
  // SUPERSEDED by amendment A1 (ruled 2026-08-08). This row was written red on
  // purpose: the contract's formula gave 16884.8 and its worked example claimed
  // 16897, and the oracle refused to pick. A1 ruled the FORMULA normative and
  // corrected the example, so the number here is now 16885. The defect was in
  // the spec's arithmetic, which is the whole reason the blind pass runs first.
  const line = await usageLine({
    input_tokens: 2,
    cache_creation_input_tokens: 7664,
    cache_read_input_tokens: 15548,
    output_tokens: 11,
    cache_creation: { ephemeral_1h_input_tokens: 7664, ephemeral_5m_input_tokens: 0 },
  });
  assert.ok(
    line.includes("in=2 out=11 cwrite=7664 cread=15548 ttl=1h billed-eq=16885"),
    `the contract's worked example, as one contiguous run of fields\n  got: ${line}`
  );
});

test("row 1b DRIFT DETECTOR: the live-captured session-v43/claude-json-sample.json maps through", async () => {
  // If this row is red and row 1 is green, the real CLI's usage field names
  // moved. Re-capture the payload and follow the CLI; do not edit this
  // expectation to fit the code. The capture also carries usage fields this
  // contract does not name (server_tool_use, service_tier, iterations, speed),
  // which the "ignored rather than rejected" sentence says must not matter.
  // Carries row 1's corrected number (amendment A1).
  const raw = fs.readFileSync(
    // VENDORED (2026-08-10): the session folders moved to a private repo, and a
    // contract row must run on every clone. See test/fixtures/claude-code.
    path.join(__dirname, "fixtures", "claude-code", "claude-json-sample.json"),
    "utf8"
  );
  const { line } = await round(raw);
  assert.ok(
    line.includes("in=2 out=11 cwrite=7664 cread=15548 ttl=1h billed-eq=16885"),
    `the real capture is the source of the contract's worked example\n  got: ${line}`
  );
});

// ---------------------------------------------------------------------------
// rows 2-4: absent, not-an-object, empty (honesty rules 1 and 2)
// ---------------------------------------------------------------------------

test("row 2: no usage key appends usage=absent and none of the six fields", async () => {
  const { line } = await round(reply({}));
  assert.ok(
    /(^|\s)usage=absent(\s|$)/.test(line),
    `an absent usage renders as the single token usage=absent\n  got: ${line}`
  );
  for (const name of SIX) {
    assert.strictEqual(
      field(line, name),
      null,
      `zero means measured zero: ${name}= must not appear at all when usage is absent\n  got: ${line}`
    );
  }
});

test("row 3: a usage that is not an object is treated exactly as absent", async () => {
  for (const bad of ["yes", 42, null]) {
    const line = await usageLine(bad);
    assert.ok(
      /(^|\s)usage=absent(\s|$)/.test(line),
      `usage=${JSON.stringify(bad)} is not an object, so it renders usage=absent\n  got: ${line}`
    );
    for (const name of SIX) {
      assert.strictEqual(
        field(line, name),
        null,
        `usage=${JSON.stringify(bad)} must append no ${name}= field\n  got: ${line}`
      );
    }
  }
});

test("row 4: an empty usage object renders in=? out=? cwrite=? cread=? ttl=? billed-eq=?", async () => {
  // The object is present, so this is not the absent case: every field is
  // individually missing.
  //
  // MOVED by amendment A2 (ruled 2026-08-08, off this oracle's gap 9). The
  // contract first said a missing cwrite renders ttl=none. It does not: `none`
  // asserts a write did not happen, and the same rule that stops cwrite
  // claiming 0 stops ttl claiming none. A missing write is `?`.
  const line = await usageLine({});
  assert.ok(
    line.includes("in=? out=? cwrite=? cread=? ttl=? billed-eq=?"),
    `an empty usage object is measured-nothing, not measured-zero\n  got: ${line}`
  );
  assert.ok(
    !/(^|\s)usage=absent(\s|$)/.test(line),
    `an empty object IS a usage object, so the absent marker must not appear\n  got: ${line}`
  );
});

// ---------------------------------------------------------------------------
// rows 5-9: the ttl bucket and its weights
// ---------------------------------------------------------------------------

test("row 5: a pure cache-read round reports ttl=none and a billed-eq dominated by the 0.1x term", async () => {
  // 5 + 2*0 + 1.25*0 + 0.1*20000 = 2005. The read is 20000 raw tokens and
  // costs 2000 equivalents; that gap is the whole point of the field.
  const line = await usageLine({
    input_tokens: 5,
    output_tokens: 7,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 20000,
    cache_creation: { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 0 },
  });
  const t = tail(line);
  assert.strictEqual(t.ttl, "none", `cwrite is 0, so there was no write to attribute\n  got: ${line}`);
  assert.strictEqual(t.billedEq, "2005", `expected 5 + 0.1*20000 = 2005\n  got: ${line}`);
  assert.strictEqual(t.cread, "20000", "the raw read count is reported unweighted");
});

test("row 6: a write in the 5-minute bucket reports ttl=5m and prices it at 1.25x", async () => {
  // 10 + 1.25*4000 + 0.1*0 = 5010. At the 1-hour weight it would be 8010, so
  // a module using the wrong multiplier cannot pass this row by luck.
  const line = await usageLine({
    input_tokens: 10,
    output_tokens: 3,
    cache_creation_input_tokens: 4000,
    cache_read_input_tokens: 0,
    cache_creation: { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 4000 },
  });
  const t = tail(line);
  assert.strictEqual(t.ttl, "5m", `only the 5m bucket is non-zero\n  got: ${line}`);
  assert.strictEqual(t.billedEq, "5010", `expected 10 + 1.25*4000 = 5010\n  got: ${line}`);
});

test("row 7: both buckets non-zero reports ttl=mixed and prices each bucket at its own weight", async () => {
  // 3 + 2*1000 + 1.25*800 + 0.1*10 = 3004. A module weighting the whole 1800
  // at either single rate lands on 3604 or 2254.
  const line = await usageLine({
    input_tokens: 3,
    output_tokens: 4,
    cache_creation_input_tokens: 1800,
    cache_read_input_tokens: 10,
    cache_creation: { ephemeral_1h_input_tokens: 1000, ephemeral_5m_input_tokens: 800 },
  });
  const t = tail(line);
  assert.strictEqual(t.ttl, "mixed", `both buckets carry tokens\n  got: ${line}`);
  assert.strictEqual(t.cwrite, "1800", "cwrite stays the CLI's own total, not the sum of the buckets");
  assert.strictEqual(t.billedEq, "3004", `expected 3 + 2*1000 + 1.25*800 + 0.1*10 = 3004\n  got: ${line}`);
});

test("row 8: a write with no cache_creation object reports ttl=? and prices the whole write at 2x", async () => {
  // 1 + 2*500 = 1001. The basis was assumed rather than read, and ttl=? is
  // what says so on the line.
  const line = await usageLine({
    input_tokens: 1,
    output_tokens: 2,
    cache_creation_input_tokens: 500,
    cache_read_input_tokens: 0,
  });
  const t = tail(line);
  assert.strictEqual(t.ttl, "?", `there was a write and nothing to attribute it to\n  got: ${line}`);
  assert.strictEqual(t.billedEq, "1001", `expected 1 + 2*500 = 1001 (the ruled 1-hour rate)\n  got: ${line}`);
});

test("row 9: cache_creation present with both buckets 0 and cwrite > 0 also reports ttl=?", async () => {
  // The contract's ttl bullet list says `none` for a present-and-both-zero
  // cache_creation; testing-shape row 9 says `?` for that payload when there
  // is also a write, and gives the reason. This file follows row 9 as the
  // more specific sentence. The disagreement is reported as a contract gap.
  const line = await usageLine({
    input_tokens: 1,
    output_tokens: 2,
    cache_creation_input_tokens: 500,
    cache_read_input_tokens: 0,
    cache_creation: { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 0 },
  });
  const t = tail(line);
  assert.strictEqual(
    t.ttl,
    "?",
    `there is a write and the object attributes none of it\n  got: ${line}`
  );
  // Honesty rule 4 names the billed-eq inputs as in, cwrite and cread, and all
  // three arrived. Whether the unattributed 500 is priced at 2x or dropped is
  // NOT stated for this shape, so this row asserts only that the field is
  // computed rather than refused.
  assert.notStrictEqual(
    t.billedEq,
    "?",
    `in, cwrite and cread all arrived, so billed-eq has every input it needs\n  got: ${line}`
  );
});

// ---------------------------------------------------------------------------
// row 10: honesty rules 3 and 4
// ---------------------------------------------------------------------------

test("row 10: a non-numeric input_tokens renders in=? AND billed-eq=?", async () => {
  const line = await usageLine({
    input_tokens: "lots",
    output_tokens: 11,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 100,
  });
  const t = tail(line);
  assert.strictEqual(t.in, "?", `in=0 would be a lie; in=? is a fact\n  got: ${line}`);
  assert.strictEqual(t.billedEq, "?", `billed-eq needs in, so it refuses too\n  got: ${line}`);
  assert.strictEqual(t.out, "11", "the fields that did arrive still render their values");
});

test("extra (rule 3): a null or boolean cwrite/cread renders ? on that field and ? on billed-eq", async () => {
  const missingWrite = await usageLine({
    input_tokens: 2,
    output_tokens: 3,
    cache_creation_input_tokens: null,
    cache_read_input_tokens: 100,
  });
  assert.strictEqual(field(missingWrite, "cwrite"), "?", `null is not a number\n  got: ${missingWrite}`);
  assert.strictEqual(
    field(missingWrite, "billed-eq"),
    "?",
    `cwrite is a billed-eq input, so its absence refuses the derivation\n  got: ${missingWrite}`
  );

  const missingRead = await usageLine({
    input_tokens: 2,
    output_tokens: 3,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: true,
  });
  assert.strictEqual(field(missingRead, "cread"), "?", `a boolean is not a number\n  got: ${missingRead}`);
  assert.strictEqual(
    field(missingRead, "billed-eq"),
    "?",
    `cread is a billed-eq input\n  got: ${missingRead}`
  );
});

test("extra (rule 4): out is NOT a billed-eq input, so a missing out does not refuse the derivation", async () => {
  // 2 + 0 + 0.1*100 = 12. Output tokens are priced on a different scale and
  // are not in the formula at all.
  const line = await usageLine({
    input_tokens: 2,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 100,
  });
  const t = tail(line);
  assert.strictEqual(t.out, "?", `a missing output_tokens renders ?\n  got: ${line}`);
  assert.strictEqual(t.billedEq, "12", `expected 2 + 0.1*100 = 12, with out playing no part\n  got: ${line}`);
});

test("extra (rule 4): a missing TTL split does not refuse billed-eq, it takes the 2x rule", async () => {
  // Same payload as row 8, asserted from the other direction: the split's
  // absence is handled by the 2x rule, not by rendering ?.
  const line = await usageLine({
    input_tokens: 0,
    output_tokens: 1,
    cache_creation_input_tokens: 100,
    cache_read_input_tokens: 0,
  });
  assert.strictEqual(field(line, "billed-eq"), "200", `expected 2*100 = 200\n  got: ${line}`);
});

test("extra (rule 6): negative token counts are reported as they arrive and fed to the arithmetic", async () => {
  // -5 + 2*0 + 1.25*0 + 0.1*(-30) = -8. The CLI inventing a negative count is
  // not this file's problem to hide.
  const line = await usageLine({
    input_tokens: -5,
    output_tokens: 1,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: -30,
  });
  const t = tail(line);
  assert.strictEqual(t.in, "-5", `a negative number is a number\n  got: ${line}`);
  assert.strictEqual(t.cread, "-30", `reported as it arrived, not clamped\n  got: ${line}`);
  assert.strictEqual(t.billedEq, "-8", `expected -5 + 0.1*-30 = -8\n  got: ${line}`);
});

// ---------------------------------------------------------------------------
// rows 11-12: nothing that was already there moves
// ---------------------------------------------------------------------------

test("row 11: the pre-phase fields keep their spelling, order and value", async () => {
  // The value half is asserted without knowing what the values should be: the
  // same round is run with and without a usage object, and everything up to
  // cli-total must be byte-identical between them.
  const payload = {
    result: "```rust\na + b\n```",
    num_turns: 1,
    ttft_ms: 111,
    duration_ms: 222,
  };
  const bare = (await round(reply(payload))).line;
  const withUsage = (
    await round(
      reply({
        ...payload,
        usage: {
          input_tokens: 2,
          output_tokens: 11,
          cache_creation_input_tokens: 7664,
          cache_read_input_tokens: 15548,
          cache_creation: { ephemeral_1h_input_tokens: 7664, ephemeral_5m_input_tokens: 0 },
        },
      })
    )
  ).line;

  for (const [label, line] of [["without usage", bare], ["with usage", withUsage]]) {
    const m = line.match(HEAD_RE);
    assert.ok(m, `${label}: the pre-phase fields keep their order and spelling\n  got: ${line}`);
  }
  // ttft= and total= are the module's own wall clock (v43 amendment B4), so
  // two separate spawns are allowed to differ by a millisecond. Their digits
  // are masked and their presence is already pinned by HEAD_RE; every other
  // byte of the pre-phase head must match.
  const mask = (line) => line.match(HEAD_RE)[0].replace(/=\d+ms/g, "=<n>ms");
  assert.strictEqual(
    mask(withUsage),
    mask(bare),
    "adding a usage object must not change the pre-phase fields' spelling, order or value"
  );
  assert.ok(
    withUsage.includes("cli-ttft=111ms cli-total=222ms"),
    `the CLI's own figures still render from the payload unchanged\n  got: ${withUsage}`
  );
  assert.ok(
    withUsage.includes("cli-total=222ms in="),
    `the six fields are APPENDED, directly after the last pre-phase field\n  got: ${withUsage}`
  );
});

test("row 12: a failed round appends nothing - no usage fields, no absent marker", async () => {
  const lines = [];
  const shim = makeShim({ stderr: "boom: the CLI fell over\n", exitCode: 2 });
  const cwd = tmpDir("c80-v44-cwd-");
  const fn = makeClaudeCodeInstruct({ cwd, binary: shim.binary, log: (l) => lines.push(l) });
  await assert.rejects(fn({ signal: new AbortController().signal, ...BASE }));

  const failed = lines.filter((l) => /round=failed/.test(l));
  assert.strictEqual(
    failed.length,
    1,
    `the failure line keeps its current shape: round=failed reason=...\n  got: ${JSON.stringify(lines)}`
  );
  assert.ok(/reason=exit/.test(failed[0]), `the reason is still on the line\n  got: ${failed[0]}`);
  for (const name of [...SIX, "usage"]) {
    assert.strictEqual(
      field(failed[0], name),
      null,
      `a round that never produced a reply has no usage to report, so ${name}= must be absent\n  got: ${failed[0]}`
    );
  }
});

// ---------------------------------------------------------------------------
// row 13: rounding
// ---------------------------------------------------------------------------

test("row 13: billed-eq rounds to the nearest integer and the line carries no decimal point", async () => {
  // 1 + 0.1*3 = 1.3 -> 1, and 1 + 0.1*7 = 1.7 -> 2. Neither is a half, so the
  // tie-break rule the contract does not state is not exercised here.
  const down = await usageLine({
    input_tokens: 1,
    output_tokens: 1,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 3,
  });
  assert.strictEqual(field(down, "billed-eq"), "1", `1.3 rounds down to 1\n  got: ${down}`);

  const up = await usageLine({
    input_tokens: 1,
    output_tokens: 1,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 7,
  });
  assert.strictEqual(field(up, "billed-eq"), "2", `1.7 rounds up to 2\n  got: ${up}`);

  // The 1.25x weight is the other decimal source: 3*1.25 = 3.75 -> 4.
  const quarter = await usageLine({
    input_tokens: 0,
    output_tokens: 1,
    cache_creation_input_tokens: 3,
    cache_read_input_tokens: 0,
    cache_creation: { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 3 },
  });
  assert.strictEqual(field(quarter, "billed-eq"), "4", `1.25*3 = 3.75 rounds to 4\n  got: ${quarter}`);

  for (const line of [down, up, quarter]) {
    const t = tail(line);
    for (const [name, value] of Object.entries(t)) {
      assert.ok(
        !value.includes("."),
        `the line never carries a decimal point; ${name}=${value} does\n  got: ${line}`
      );
    }
  }
});

// ---------------------------------------------------------------------------
// extras: contract sentences outside the numbered rows
// ---------------------------------------------------------------------------

test("extra (Scope): InstructGenerateResult keeps its exact shape - this phase adds no result fields", async () => {
  const { out } = await round(
    reply({
      usage: {
        input_tokens: 2,
        output_tokens: 11,
        cache_creation_input_tokens: 7664,
        cache_read_input_tokens: 15548,
        cache_creation: { ephemeral_1h_input_tokens: 7664, ephemeral_5m_input_tokens: 0 },
      },
    })
  );
  assert.deepStrictEqual(
    Object.keys(out).sort(),
    ["doneReason", "text", "totalMs", "ttftMs"],
    "the instrument is the evidence line only; the result gains no usage fields"
  );
});

test("extra (reply parsing): unknown fields inside usage are ignored, never rejected", async () => {
  // An unknown field is the CLI gaining a feature, not this round failing.
  const line = await usageLine({
    input_tokens: 2,
    output_tokens: 11,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    cache_creation: {
      ephemeral_1h_input_tokens: 0,
      ephemeral_5m_input_tokens: 0,
      ephemeral_24h_input_tokens: 999,
    },
    service_tier: "standard",
    some_new_bucket: { nested: true },
  });
  const t = tail(line);
  assert.strictEqual(t.in, "2");
  assert.strictEqual(t.billedEq, "2", "expected 2 + 0 + 0 = 2, with the unknown bucket ignored");
});
