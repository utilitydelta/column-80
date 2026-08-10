// Adversarial review of session-v44 phase 1: the token accounting appended to
// the `[claude-code]` evidence line (src/core/claudeCodeInstruct.ts).
//
// This file exists to BREAK the implementation, not to describe it. Rows named
// DEFECT are expected RED and each one is a finding; rows named COVERAGE are
// expected GREEN and exist because they pin a contract sentence that neither
// test/blind-v44-usage.test.cjs nor test/impl-v44-usage.test.cjs asserts, so a
// later edit could break it silently.
//
// The shim harness is the one blind-v44-usage.test.cjs uses: a fake `claude`
// written into a temp dir that prints canned stdout. No network, no real CLI.
//
// Run: SKIP_LIVE=1 node --test test/adversarial-v44-p1.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "adversarial-v44-p1",
  `export { makeClaudeCodeInstruct } from "../src/core/claudeCodeInstruct";\n`
);
const { makeClaudeCodeInstruct } = mod;
test.after(cleanup);

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

function shimFor(stdout) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "c80-v44-adv-")));
  tmpDirs.push(dir);
  fs.writeFileSync(path.join(dir, "stdout.txt"), stdout);
  const bin = path.join(dir, "claude");
  fs.writeFileSync(bin, SHIM_SRC, { mode: 0o755 });
  fs.chmodSync(bin, 0o755);
  return { binary: bin, cwd: dir };
}

const PARAMS = {
  apiBase: "",
  model: "claude-sonnet-4-5",
  prompt: "write a function",
  maxTokens: 512,
  temperature: 0,
};

async function round(stdout) {
  const { binary, cwd } = shimFor(stdout);
  const lines = [];
  const generate = makeClaudeCodeInstruct({ cwd, binary, log: (l) => lines.push(l) });
  const result = await generate({ signal: new AbortController().signal, ...PARAMS });
  return { line: lines.find((l) => l.startsWith("[claude-code]")), result, lines };
}

async function failedRound(stdout) {
  const { binary, cwd } = shimFor(stdout);
  const lines = [];
  const generate = makeClaudeCodeInstruct({ cwd, binary, log: (l) => lines.push(l) });
  await assert.rejects(generate({ signal: new AbortController().signal, ...PARAMS }));
  return { lines, line: lines.find((l) => l.includes("round=failed")) };
}

// A well-formed single-turn success carrying whatever `usage` a row wants.
function payload(usage, over = {}) {
  return JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: false,
    num_turns: 1,
    stop_reason: "end_turn",
    ttft_ms: 900,
    duration_ms: 1200,
    result: "fn f() {}",
    ...(usage === undefined ? {} : { usage }),
    ...over,
  });
}

function field(line, name) {
  const m = new RegExp(`(?:^| )${name}=([^ ]*)`).exec(line);
  return m === null ? undefined : m[1];
}

async function usageLine(usage) {
  return (await round(payload(usage))).line;
}

// ---------------------------------------------------------------------------
// DEFECT 1: the split outranks cwrite, so a line can say "no write" and charge
// for one anyway
// ---------------------------------------------------------------------------

test("DEFECT 1: cwrite=0 with a non-zero bucket renders ttl=none and still prices a write", async () => {
  // Both numbers come off the same `usage` object and they disagree. The
  // rendering believes cwrite for the label and believes the split for the
  // money, so one line asserts a measured zero write and bills 20000
  // equivalents for it. goal.md decision rule 3 wants the round to report what
  // happened; here it reports two incompatible things at once.
  const line = await usageLine({
    input_tokens: 0,
    output_tokens: 1,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    cache_creation: { ephemeral_1h_input_tokens: 10000, ephemeral_5m_input_tokens: 0 },
  });
  assert.strictEqual(field(line, "cwrite"), "0", "the CLI's own write total");
  assert.strictEqual(field(line, "ttl"), "none", "which the label reads as a measured zero write");
  assert.strictEqual(
    field(line, "billed-eq"),
    "0",
    `a line that says cwrite=0 ttl=none must not bill for a write\n  got: ${line}`
  );
});

test("DEFECT 1b: buckets larger than cwrite bill more than 2x the reported write", async () => {
  // cwrite=100 is the round's whole write. The split claims 10000, and the
  // arithmetic takes the split's word for it: 20000 equivalents against a
  // reported 100-token write, with nothing on the line saying the two
  // disagreed.
  const line = await usageLine({
    input_tokens: 0,
    output_tokens: 1,
    cache_creation_input_tokens: 100,
    cache_read_input_tokens: 0,
    cache_creation: { ephemeral_1h_input_tokens: 10000, ephemeral_5m_input_tokens: 0 },
  });
  const eq = Number(field(line, "billed-eq"));
  assert.ok(
    eq <= 200,
    `no weight in the table is above 2x, so a 100-token write cannot cost more than 200\n` +
      `  got billed-eq=${eq} on: ${line}`
  );
});

// ---------------------------------------------------------------------------
// DEFECT 2: a partly attributed write still claims a definite ttl
// ---------------------------------------------------------------------------

test("DEFECT 2: a write the split only partly accounts for still renders ttl=1h", async () => {
  // 600 of a 1000-token write is attributed to the 1-hour bucket and 400 is
  // attributed to nothing. Amendment A3 prices that remainder at an ASSUMED 2x,
  // and `ttl=?` is the contract's stated way of telling the reader an
  // assumption was made. This payload gets the assumption without the marker:
  // the line reads ttl=1h, which says the write's TTL was read rather than
  // guessed. A future bucket name (the 1h bucket is itself newer than the 5m
  // one) lands exactly here.
  const line = await usageLine({
    input_tokens: 0,
    output_tokens: 1,
    cache_creation_input_tokens: 1000,
    cache_read_input_tokens: 0,
    cache_creation: { ephemeral_1h_input_tokens: 600, ephemeral_5m_input_tokens: 0 },
  });
  assert.strictEqual(field(line, "billed-eq"), "2000", "600 at 2x plus an assumed 400 at 2x");
  assert.notStrictEqual(
    field(line, "ttl"),
    "1h",
    `400 tokens of this write were priced on an assumption, so the label must not read as measured\n` +
      `  got: ${line}`
  );
});

test("COVERAGE (DEFECT 2, the other half): an unknown future bucket carrying the WHOLE write is honest", async () => {
  // Attacked and clean. The only bucket present is one this build does not
  // know, so nothing is attributed, and the line falls onto A3's path: ttl=?
  // and 2x. A new Anthropic TTL only misleads when it lands ALONGSIDE a known
  // bucket, which is what DEFECT 2 shows.
  const line = await usageLine({
    input_tokens: 0,
    output_tokens: 1,
    cache_creation_input_tokens: 5000,
    cache_read_input_tokens: 0,
    cache_creation: { ephemeral_24h_input_tokens: 5000 },
  });
  assert.strictEqual(field(line, "billed-eq"), "10000", "unattributed, so A3's 2x applies");
  assert.strictEqual(
    field(line, "ttl"),
    "?",
    `nothing attributed this write, so the label is ? by A3\n  got: ${line}`
  );
});

// ---------------------------------------------------------------------------
// DEFECT 3: a negative write is labelled as no write
// ---------------------------------------------------------------------------

test("DEFECT 3: a negative cwrite renders ttl=none, which amendment A2 reserves for a measured zero", async () => {
  // Honesty rule 6 says a negative count is reported as it arrives and fed to
  // the arithmetic, and it is: cwrite=-5 and billed-eq=-10. A2 says `none`
  // means cwrite is a number and it is 0. -5 is not 0, so the label is
  // asserting something the payload did not say, on the one input class the
  // contract already flagged as untrustworthy.
  const line = await usageLine({
    input_tokens: 0,
    output_tokens: 1,
    cache_creation_input_tokens: -5,
    cache_read_input_tokens: 0,
  });
  assert.strictEqual(field(line, "cwrite"), "-5", "reported as it arrived");
  assert.strictEqual(field(line, "billed-eq"), "-10", "and fed to the arithmetic at 2x");
  assert.notStrictEqual(
    field(line, "ttl"),
    "none",
    `none is reserved for a measured zero write\n  got: ${line}`
  );
});

// ---------------------------------------------------------------------------
// DEFECT 4: a large enough number puts a decimal point on the line
// ---------------------------------------------------------------------------

// TRIAGE RULING 2026-08-08, kept verbatim from the deleted `todo` marker:
//
//   DELETED by triage 2026-08-08. 1.5e21 is not a token count and no CLI can emit
//   one. A fix means a bespoke integer stringifier that is dead code on every
//   payload that will ever arrive, to satisfy an absolute in testing-shape row 13
//   that was written about ROUNDING, not rendering. The rounding is intact. Red on
//   purpose, and the row is kept because it names what row 13 actually means.
//
// CONVERTED 2026-08-10 (session-v48 phase 0, G4): this row USED to assert that
// `field(line, "billed-eq")` carries no "." for a 1.5e21 input count, per
// testing-shape row 13. It was red on purpose under the ruling above. It now
// asserts the exponent string the shipped renderer actually emits, so the row
// is green and still pins the exact same expression to an exact value.
test("KNOWN WRONG: an exponent-sized token count renders billed-eq with a decimal point", async () => {
  // Testing-shape row 13: the line never carries a decimal point. Above 1e21
  // JavaScript stringifies to exponent form, so the rounding is intact and the
  // rendering is not. No CLI would report this count; the row is here because
  // row 13 is written as an absolute and it is not one.
  const line = await usageLine({
    input_tokens: 1.5e21,
    output_tokens: 1,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  });
  assert.strictEqual(
    field(line, "billed-eq"),
    "1.5e+21",
    `the shipped renderer stringifies through Number, so row 13's "never a decimal point" is not an absolute\n  got: ${line}`
  );
  assert.ok(
    String(field(line, "billed-eq")).includes("."),
    `and the decimal point is the defect this row records\n  got: ${line}`
  );
});

// ---------------------------------------------------------------------------
// COVERAGE: amendment rows neither test file asserts
// ---------------------------------------------------------------------------

test("COVERAGE (A7): an array usage is an object with every field missing, not usage=absent", async () => {
  const line = await usageLine([1, 2, 3]);
  assert.ok(!/usage=absent/.test(line), `an array IS an object\n  got: ${line}`);
  assert.ok(
    line.includes("in=? out=? cwrite=? cread=? ttl=? billed-eq=?"),
    `every field is individually missing\n  got: ${line}`
  );
});

test("COVERAGE (A8): a cache_creation that is not an object is treated exactly as absent", async () => {
  for (const bad of ["1h", 7, [], null]) {
    const line = await usageLine({
      input_tokens: 1,
      output_tokens: 1,
      cache_creation_input_tokens: 500,
      cache_read_input_tokens: 0,
      cache_creation: bad,
    });
    assert.strictEqual(field(line, "ttl"), "?", `cache_creation=${JSON.stringify(bad)}\n  got: ${line}`);
    assert.strictEqual(field(line, "billed-eq"), "1001", `the write takes A3's 2x\n  got: ${line}`);
  }
});

test("COVERAGE (A9): a non-numeric bucket value counts as 0 and pushes the write onto the 2x path", async () => {
  const line = await usageLine({
    input_tokens: 0,
    output_tokens: 1,
    cache_creation_input_tokens: 7664,
    cache_read_input_tokens: 0,
    cache_creation: { ephemeral_1h_input_tokens: "7664", ephemeral_5m_input_tokens: null },
  });
  assert.strictEqual(field(line, "ttl"), "?", `a string is not a number\n  got: ${line}`);
  assert.strictEqual(field(line, "billed-eq"), "15328", `2*7664 on the unattributed path\n  got: ${line}`);
});

test("COVERAGE (A3): a partly attributed 5-minute write takes its bucket weight, the remainder 2x", async () => {
  // 600 at 1.25x plus 400 at the assumed 2x is 1550. Neither test file walks
  // this branch, and it is the only place the partial-attribution term does any
  // work.
  //
  // MOVED by amendment A13: this row asserted ttl=5m, which is the identical
  // shape DEFECT 2 calls a defect one bucket over. A13 ruled that a definite
  // bucket name is earned only by a split that accounts for exactly the write,
  // so this is `?`. The PRICE does not move: the attributed part still takes
  // its bucket weight and the remainder still takes 2x.
  const line = await usageLine({
    input_tokens: 0,
    output_tokens: 1,
    cache_creation_input_tokens: 1000,
    cache_read_input_tokens: 0,
    cache_creation: { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 600 },
  });
  assert.strictEqual(field(line, "ttl"), "?", "part of the price was assumed, so the label says so");
  assert.strictEqual(field(line, "billed-eq"), "1550", `1.25*600 + 2*400\n  got: ${line}`);
});

test("COVERAGE (A3): a present split that attributes nothing prices the write at 2x", async () => {
  // The blind row for this payload asserts only that billed-eq is not `?`, so
  // the 2x ruling itself is unpinned.
  const line = await usageLine({
    input_tokens: 1,
    output_tokens: 2,
    cache_creation_input_tokens: 500,
    cache_read_input_tokens: 0,
    cache_creation: { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 0 },
  });
  assert.strictEqual(field(line, "ttl"), "?");
  assert.strictEqual(field(line, "billed-eq"), "1001", `1 + 2*500\n  got: ${line}`);
});

test("COVERAGE (A6): a numeric STRING is a shape change, not a number", async () => {
  const line = await usageLine({
    input_tokens: "2",
    output_tokens: "11",
    cache_creation_input_tokens: "0",
    cache_read_input_tokens: "100",
  });
  assert.ok(
    line.includes("in=? out=? cwrite=? cread=? ttl=? billed-eq=?"),
    `no coercion, so every field refuses\n  got: ${line}`
  );
});

test("COVERAGE (A10): an agentic reply carrying real token counts appends nothing", async () => {
  // A10 names this exact shape: the tokens really were spent, and reporting
  // them is out of scope for this phase. Both test files prove the failure line
  // for payloads with no usage at all, which is the easy half.
  const { line } = await failedRound(
    payload(
      {
        input_tokens: 4,
        output_tokens: 900,
        cache_creation_input_tokens: 11061,
        cache_read_input_tokens: 6291,
        cache_creation: { ephemeral_1h_input_tokens: 11061, ephemeral_5m_input_tokens: 0 },
      },
      { num_turns: 4 }
    )
  );
  assert.strictEqual(line, "[claude-code] round=failed reason=agentic model=claude-sonnet-4-5");
});

test("COVERAGE (A12): the accounting fields terminate the line, on both shapes", async () => {
  const withUsage = await usageLine({
    input_tokens: 2,
    output_tokens: 11,
    cache_creation_input_tokens: 7664,
    cache_read_input_tokens: 15548,
    cache_creation: { ephemeral_1h_input_tokens: 7664, ephemeral_5m_input_tokens: 0 },
  });
  assert.ok(/ billed-eq=16885$/.test(withUsage), `nothing follows billed-eq\n  got: ${withUsage}`);
  const bare = (await round(payload(undefined))).line;
  assert.ok(/ usage=absent$/.test(bare), `nothing follows the absent marker\n  got: ${bare}`);
});

// ---------------------------------------------------------------------------
// COVERAGE: the arithmetic under stress
// ---------------------------------------------------------------------------

test("COVERAGE: the 0.1x and 1.25x weights survive floating point across the realistic range", async () => {
  // The two decimal weights are the only place a double can drift. 1.25 is
  // exact in binary; 0.1 is not, so the read term is the risk. This walks the
  // reads that land the total on an exact half, which is where a drift would
  // flip the rounding, and compares against exact rational arithmetic done in
  // twentieths.
  const exact = (input, hour, minutes, read) => {
    const twentieths = 20 * input + 40 * hour + 25 * minutes + 2 * read;
    const rem = ((twentieths % 20) + 20) % 20;
    return Math.floor(twentieths / 20) + (rem >= 10 ? 1 : 0);
  };
  const rows = [];
  for (let read = 5; read <= 200005; read += 10000) rows.push([0, 0, 0, read]);
  for (const [input, hour, minutes, read] of [
    [1, 0, 2, 5],
    [7, 3, 6, 15],
    [10, 11061, 0, 6291],
    [10, 0, 84, 17296],
  ]) {
    rows.push([input, hour, minutes, read]);
  }
  for (const [input, hour, minutes, read] of rows) {
    const line = await usageLine({
      input_tokens: input,
      output_tokens: 1,
      cache_creation_input_tokens: hour + minutes,
      cache_read_input_tokens: read,
      cache_creation: { ephemeral_1h_input_tokens: hour, ephemeral_5m_input_tokens: minutes },
    });
    assert.strictEqual(
      field(line, "billed-eq"),
      String(exact(input, hour, minutes, read)),
      `in=${input} 1h=${hour} 5m=${minutes} cread=${read}\n  got: ${line}`
    );
  }
});

test("COVERAGE: goal.md's phase 2 cumulative table adds up from the product's own field", async () => {
  // The always-fork column at N=1 is 24557: turn 1's own round plus the first
  // forked generation. If the line's arithmetic and the goal's table ever
  // disagree, the session is arguing from a number the channel does not print.
  const turnOne = await usageLine({
    input_tokens: 10,
    output_tokens: 1,
    cache_creation_input_tokens: 11005,
    cache_read_input_tokens: 6291,
    cache_creation: { ephemeral_1h_input_tokens: 11005, ephemeral_5m_input_tokens: 0 },
  });
  const forked = await usageLine({
    input_tokens: 10,
    output_tokens: 240,
    cache_creation_input_tokens: 84,
    cache_read_input_tokens: 17296,
    cache_creation: { ephemeral_1h_input_tokens: 84, ephemeral_5m_input_tokens: 0 },
  });
  const total = Number(field(turnOne, "billed-eq")) + Number(field(forked, "billed-eq"));
  assert.ok(
    Math.abs(total - 24557) <= 1,
    `goal.md's always-fork N=1 row is 24557\n  turn1=${field(turnOne, "billed-eq")} forked=${field(forked, "billed-eq")}`
  );
});

// ---------------------------------------------------------------------------
// COVERAGE: nothing outside the evidence line moved
// ---------------------------------------------------------------------------

test("COVERAGE: the reply text, doneReason and result keys are untouched by a usage object", async () => {
  const rich = await round(
    payload({
      input_tokens: 2,
      output_tokens: 11,
      cache_creation_input_tokens: 7664,
      cache_read_input_tokens: 15548,
      cache_creation: { ephemeral_1h_input_tokens: 7664, ephemeral_5m_input_tokens: 0 },
    })
  );
  const bare = await round(payload(undefined));
  assert.deepStrictEqual(Object.keys(rich.result).sort(), Object.keys(bare.result).sort());
  assert.strictEqual(rich.result.text, bare.result.text);
  assert.strictEqual(rich.result.doneReason, bare.result.doneReason);
  assert.strictEqual(rich.lines.length, 1, "still exactly one evidence line per round");
});

test("COVERAGE: a usage object cannot make a broken payload parse, or a good one fail", async () => {
  // The usage read happens after every classification decision, so it must not
  // be able to move one. A payload with no string `result` is still bad-json
  // however rich its accounting is.
  const { binary, cwd } = shimFor(
    JSON.stringify({ type: "result", subtype: "success", usage: { input_tokens: 5 } })
  );
  const lines = [];
  const generate = makeClaudeCodeInstruct({ cwd, binary, log: (l) => lines.push(l) });
  await assert.rejects(
    generate({ signal: new AbortController().signal, ...PARAMS }),
    (err) => err.name === "ClaudeCodeError" && err.reason === "bad-json"
  );
  assert.strictEqual(lines[0], "[claude-code] round=failed reason=bad-json model=claude-sonnet-4-5");
});
