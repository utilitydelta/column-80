// Blind oracle: the fork transport for Claude Code
// (src/core/claudeCodeInstruct.ts, src/core/prompt.ts, src/core/fnGenService.ts,
// session-v44 phase 2).
//
// Written from that phase's contract ONLY, BEFORE the implementation
// existed. The oracle never read src/core/claudeCodeInstruct.ts or any other
// file under src/. Every assertion below traces to a sentence in that contract;
// the numbered rows match its "Testing shape" list 1..16, and rows named
// "extra" trace to a sentence in its prose (Scope, The cache key IS the
// content, The seam, What the transport does, Degrading, Evidence) that the
// numbered list does not cover.
//
// Red rows are the expected state on the first run: the transport does not
// fork yet, so every spawn-count row fails on the count. A row that goes red
// on a missing export fails with "must export ..." rather than on a bundle
// error, which is why the modules are imported as namespaces.
//
// KNOWN CONTRACT GAPS this file works around, reported with the run:
//   - the turn-1 instruction constant is not written down, so the turn-1 rows
//     assert the prefix and a non-empty instruction after it, never its text.
//   - `bytes=<n>` on the turn-1 line is not defined as the prefix bytes or the
//     whole turn-1 stdin, so the rows assert it is at least the prefix length.
//   - the `cache-degraded=<reason>` vocabulary is only named for the fork-round
//     failures (cli-error, exit, bad-json); the turn-1 failure shapes borrow it
//     here and the missing-session_id shape asserts only a non-empty token.
//
// Transport under test is a spawned `claude` binary, so the fixture is the fake
// `claude` shim from test/blind-v43-claudecode.test.cjs, extended: every spawn
// claims the next free index with an atomic O_EXCL create, records its argv,
// cwd, stdin and pid under that index, and serves the canned reply configured
// for that index. That is what makes a two-turn sequence observable. No
// network, no real CLI, no dependence on this machine's login state.
//
// Run: SKIP_LIVE=1 node --test test/blind-v44-fork.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { bundleCore, sleep } = require("./.blind-util.cjs");

// Namespace imports on purpose: `renderContextPrefix` does not exist yet, and a
// named re-export of a missing binding is an esbuild error that would take the
// whole file down instead of one row.
const { mod, cleanup } = bundleCore(
  "blind-v44-fork",
  `export { makeClaudeCodeInstruct } from "../src/core/claudeCodeInstruct";
export * as prompt from "../src/core/prompt";
export * as repair from "../src/core/repair";
export * as refine from "../src/core/refine";
export * as ollama from "../src/core/ollama";
export * as fnGenService from "../src/core/fnGenService";\n`
);
const { makeClaudeCodeInstruct, prompt: P, repair: R, refine: RF, ollama: OL, fnGenService: FS } = mod;
test.after(cleanup);

// ---------------------------------------------------------------------------
// the multi-spawn fake `claude` shim
// ---------------------------------------------------------------------------

// Index claim is an O_EXCL create, so two concurrent children never take the
// same slot and the recording is complete even when the module races itself.
// `__INDEX__` in a canned stdout is replaced by the claimed index, which is how
// every spawn gets a session id the test can name without knowing the order.
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
fs.writeFileSync(at("cwd.txt"), process.cwd());
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
const bomb = setTimeout(() => {
  fs.writeFileSync(at("no-stdin-end.txt"), "1");
  process.exit(99);
}, 10000);
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

// replies: per-spawn-index { stdout, stderr, exitCode, sleepMs }; fallback
// serves every index the list does not cover.
function makeShim(replies = [], fallback = {}) {
  const dir = tmpDir("c80-v44f-shim-");
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
    argv: JSON.parse(fs.readFileSync(at(i, "argv.json"), "utf8")),
    cwd: fs.readFileSync(at(i, "cwd.txt"), "utf8"),
    stdin: fs.existsSync(at(i, "stdin.bin")) ? fs.readFileSync(at(i, "stdin.bin"), "utf8") : null,
    // Tolerated, not required. The child claims its index with an atomic
    // O_EXCL create BEFORE it writes anything else, so a row that reads a spawn
    // the moment count() sees it can arrive between the claim and this file. An
    // eager read there threw ENOENT under load, which is a flaky row and a
    // false regression hunt for whoever meets it next.
    pid: fs.existsSync(at(i, "pid.txt")) ? Number(fs.readFileSync(at(i, "pid.txt"), "utf8")) : undefined,
    finished: () => fs.existsSync(at(i, "finished.txt")),
  });
  return {
    binary: bin,
    count,
    spawn: one,
    all: () => Array.from({ length: count() }, (_, i) => one(i)),
  };
}

// The full InstructGenerateParams surface, so no row can pass or fail on a
// missing knob. `cachePrefix` is added per row.
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

// One generator instance. The cache state lives on the returned fn, so every
// row about a second round calls `rig.call` twice rather than rebuilding.
function rig(replies = [], fallback = OK_REPLY, config = {}) {
  const shim = makeShim(replies, fallback);
  const cwd = tmpDir("c80-v44f-cwd-");
  const lines = [];
  const fn = makeClaudeCodeInstruct({ cwd, binary: shim.binary, log: (l) => lines.push(l), ...config });
  return {
    shim,
    cwd,
    lines,
    call: (extra = {}) => fn({ signal: new AbortController().signal, prompt: TAIL, ...BASE, ...extra }),
  };
}

// A well-formed success payload; pass `undefined` for a field to omit it. The
// session id carries the spawn index so a fork's `--resume` value names the
// exact spawn that minted it, and its first 8 chars are distinct per index.
function reply(over = {}) {
  const out = {
    type: "result",
    subtype: "success",
    is_error: false,
    num_turns: 1,
    session_id: "sid-__INDEX__-0123456789abcdef",
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
const sid = (i) => `sid-${i}-0123456789abcdef`;
const OK_REPLY = { stdout: reply() };
const okWith = (over, extra = {}) => ({ stdout: reply(over), ...extra });

// A prefix of exactly n bytes that looks like rendered blocks (ASCII only, so
// bytes and characters agree).
function prefixOf(n, fill = "c") {
  const head = "// file:///w/ctx.rs 1-40\nCONTEXT_SENTINEL_ALPHA\n";
  return (head + fill.repeat(n)).slice(0, n);
}
const promptFor = (prefix, tail = TAIL) => `${prefix}\n\n${tail}`;

// ---------------------------------------------------------------------------
// evidence-line readers
// ---------------------------------------------------------------------------

// "exactly one cache-mode field, placed immediately after model= and before
// ttft=". The two clauses are asserted separately so a line that satisfies one
// and not the other says which.
function modeOf(line) {
  const hits = line.match(/cache-mode=/g) || [];
  assert.strictEqual(hits.length, 1, `exactly one cache-mode field per successful round\n  got: ${line}`);
  const m = line.match(/(?:^|\s)model=\S+ cache-mode=(\S+)(?:\s|$)/);
  assert.ok(
    m,
    `cache-mode sits immediately after model=\n` +
      `  expected: ... model=<id> cache-mode=<forked|warmed|single-shot|below-floor|degraded> ...\n` +
      `  got:      ${line}`
  );
  assert.ok(
    line.indexOf(" ttft=") > line.indexOf("cache-mode="),
    `cache-mode sits before ttft=\n  got: ${line}`
  );
  return m[1];
}

// MOVED by amendment B1 (ruled 2026-08-08 off this oracle's gap 3). The
// contract said cache-degraded sits at the END of the line, which collides with
// phase 1's amendment A12: the accounting fields terminate it. A12 was ruled
// first, the accounting is what phase 4 parses, and the reason reads better
// beside the fact it explains. It sits immediately after cache-mode=degraded.
function degradedReason(line) {
  const why = field(line, "cache-degraded");
  assert.ok(
    why !== null && why.length > 0,
    `a degraded round carries its reason as cache-degraded=<reason>\n  got: ${line}`
  );
  assert.ok(
    /cache-mode=degraded cache-degraded=\S+/.test(line),
    `cache-degraded is written immediately after cache-mode=degraded\n  got: ${line}`
  );
  assert.ok(
    line.indexOf(" cache-degraded=") < line.indexOf(" ttft="),
    `the accounting fields still terminate the line (phase 1, A12)\n  got: ${line}`
  );
  return why;
}

// RULED by amendment B3 (this oracle's gap 1): the turn-1 instruction, verbatim.
// Turn 1's stdin is prefix + "\n\n" + this.
const TURN1_INSTRUCTION =
  "The code above is reference material for the function generation requests that follow. " +
  "Do not write any code yet. Reply with exactly one word: understood.";

const isTurn1Line = (l) => /(?:^|\s)turn1=/.test(l);
function roundLine(lines) {
  const rounds = lines.filter((l) => /^\[claude-code\]/.test(l) && !isTurn1Line(l) && /fence-strip=/.test(l));
  assert.strictEqual(rounds.length, 1, `exactly one round evidence line\n  got: ${JSON.stringify(lines)}`);
  return rounds[0];
}
const roundLines = (lines) =>
  lines.filter((l) => /^\[claude-code\]/.test(l) && !isTurn1Line(l) && /fence-strip=/.test(l));
const turn1Lines = (lines) => lines.filter(isTurn1Line);

// The six phase-1 accounting fields, in the phase-1 contract's order.
const TAIL_RE = /(?:^|\s)in=(\S+) out=(\S+) cwrite=(\S+) cread=(\S+) ttl=(\S+) billed-eq=(\S+)/;

const field = (line, name) => {
  const m = line.match(new RegExp(`(?:^|\\s)${name}=(\\S*)`));
  return m === null ? null : m[1];
};

// argv readers. The contract fixes the fork's flags, not their position, so
// membership plus the --resume adjacency is what is pinned.
function resumeOf(argv) {
  const at = argv.indexOf("--resume");
  return at === -1 ? null : argv[at + 1];
}
const isFork = (argv) => argv.includes("--fork-session");
function assertBaseArgs(argv, what) {
  assert.ok(argv.includes("--strict-mcp-config"), `${what}: --strict-mcp-config is isolation, on EVERY spawn`);
  const at = argv.indexOf("--tools");
  assert.ok(at >= 0, `${what}: --tools is cost, on EVERY spawn`);
  assert.strictEqual(argv[at + 1], "", `${what}: --tools takes the empty value`);
}

async function waitFor(pred, ms, what) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (pred()) return;
    await sleep(20);
  }
  throw new Error(`timed out waiting for ${what}`);
}
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
// row 1: no cachePrefix
// ---------------------------------------------------------------------------

test("row 1: no cachePrefix - one spawn, stdin is the whole prompt, no --resume, cache-mode=single-shot", async () => {
  const r = rig();
  const out = await r.call({ prompt: TAIL });

  assert.strictEqual(r.shim.count(), 1, "an absent prefix is a single-shot round: one spawn");
  const sp = r.shim.spawn(0);
  assert.strictEqual(sp.stdin, TAIL, "stdin carries the whole prompt, byte for byte");
  assert.strictEqual(resumeOf(sp.argv), null, "nothing to resume");
  assert.ok(!isFork(sp.argv), "nothing to fork from");
  assert.strictEqual(modeOf(roundLine(r.lines)), "single-shot", `no prefix means single-shot\n  got: ${r.lines.join(" | ")}`);
  assert.strictEqual(out.text, "a + b");
  assert.strictEqual(turn1Lines(r.lines).length, 0, "no turn 1 happened, so no turn-1 line");
});

// ---------------------------------------------------------------------------
// row 2: cold warm
// ---------------------------------------------------------------------------

test("row 2: a prefix above the floor, cold - TWO spawns, turn 1 then the fork, cache-mode=warmed", async () => {
  const prefix = prefixOf(4096);
  const body = promptFor(prefix);
  const r = rig();
  const out = await r.call({ prompt: body, cachePrefix: prefix });

  assert.strictEqual(r.shim.count(), 2, "a cold prefix above the floor builds a checkpoint and then forks from it");
  const [one, two] = r.shim.all();

  // Turn 1: the prefix, a blank line, and one instruction constant. Amendment
  // B3 wrote that constant down, so it is now asserted as text rather than as
  // "non-empty and not the prompt".
  assert.strictEqual(
    one.stdin,
    `${prefix}\n\n${TURN1_INSTRUCTION}`,
    "turn 1's stdin is the prefix, a blank line, and the ruled instruction"
  );
  assert.notStrictEqual(one.stdin, body, "turn 1 is NOT the generation prompt");
  assert.strictEqual(resumeOf(one.argv), null, "turn 1 has nothing to resume: it is the checkpoint being built");
  assert.ok(!isFork(one.argv), "turn 1 does not fork");
  assertBaseArgs(one.argv, "turn 1");
  assert.strictEqual(one.cwd, r.cwd, "turn 1 spawns in the same neutral cwd as every other round");

  // Turn 2: the fork.
  assert.strictEqual(resumeOf(two.argv), sid(0), "turn 2 resumes the session id turn 1 returned");
  assert.ok(isFork(two.argv), "--fork-session is what keeps the checkpoint reusable");
  assertBaseArgs(two.argv, "turn 2");
  assert.strictEqual(
    two.stdin,
    TAIL,
    "turn 2's stdin is the prompt with the prefix AND the separating blank line removed"
  );
  assert.ok(!two.stdin.includes("CONTEXT_SENTINEL_ALPHA"), "the prefix does not ride the fork round again");

  assert.strictEqual(modeOf(roundLine(r.lines)), "warmed", `this round built the checkpoint\n  got: ${r.lines.join(" | ")}`);
  assert.strictEqual(out.text, "a + b", "the round's text comes from turn 2, never from turn 1");
});

test("extra (Turn 1): the turn-1 evidence line carries turn1=warmed, the first 8 chars of the session, bytes and timings", async () => {
  const prefix = prefixOf(4096);
  const r = rig();
  await r.call({ prompt: promptFor(prefix), cachePrefix: prefix });

  const t1 = turn1Lines(r.lines);
  assert.strictEqual(t1.length, 1, `turn 1 gets its own evidence line so its cost is visible\n  got: ${JSON.stringify(r.lines)}`);
  // MOVED by amendment B2: the turn-1 line carries total= and no ttft=. A
  // non-streaming call has no time-to-first-token distinct from its total, and
  // the round line only still carries both because v43's field order has
  // consumers. A new line does not print the same number twice.
  const m = t1[0].match(/^\[claude-code\] turn1=warmed session=(\S+) bytes=(\d+) total=(\d+)ms/);
  assert.ok(
    m,
    `the ruled turn-1 shape\n` +
      `  expected: [claude-code] turn1=warmed session=<first 8 chars> bytes=<n> total=<n>ms <phase-1 accounting>\n` +
      `  got:      ${t1[0]}`
  );
  assert.strictEqual(m[1], sid(0).slice(0, 8), "session= is the first 8 characters of the session id");
  // RULED by amendment B4 (this oracle's gap 2): bytes= is the WHOLE turn-1
  // stdin, prefix plus separator plus instruction, because what it exists to
  // report is what that call sent.
  assert.strictEqual(
    Number(m[2]),
    Buffer.byteLength(prefix + "\n\n" + TURN1_INSTRUCTION, "utf8"),
    `bytes= is the whole turn-1 stdin, not just the prefix`
  );
});

// ---------------------------------------------------------------------------
// row 3: the second round forks
// ---------------------------------------------------------------------------

test("row 3: a second round with the SAME prefix - ONE spawn, --resume the same id, cache-mode=forked, turn 1 does not run again", async () => {
  const prefix = prefixOf(4096);
  const r = rig();
  await r.call({ prompt: promptFor(prefix), cachePrefix: prefix });
  assert.strictEqual(r.shim.count(), 2, "precondition: the first round warmed");
  r.lines.length = 0;

  const out = await r.call({ prompt: promptFor(prefix), cachePrefix: prefix });
  assert.strictEqual(r.shim.count(), 3, "a hash match is ONE spawn, not two");

  const third = r.shim.spawn(2);
  assert.strictEqual(resumeOf(third.argv), sid(0), "the second round forks from the SAME checkpoint turn 1 minted");
  assert.ok(isFork(third.argv), "--fork-session leaves the checkpoint reusable for a third round");
  assert.strictEqual(third.stdin, TAIL, "the fork's stdin is the prompt minus the prefix and its separator");

  assert.strictEqual(modeOf(roundLine(r.lines)), "forked", `served from a live checkpoint\n  got: ${r.lines.join(" | ")}`);
  assert.strictEqual(turn1Lines(r.lines).length, 0, "turn 1 did not run, so it logs nothing");
  assert.strictEqual(out.text, "a + b");
});

// ---------------------------------------------------------------------------
// row 4: THE STALENESS ROW
// ---------------------------------------------------------------------------

test("row 4 STALENESS: a prefix differing by ONE BYTE warms again, stores the NEW session, and never resumes the old one", async () => {
  // The whole feature's correctness risk in one row. The key is a hash of the
  // exact bytes of the turn-1 payload, so a single changed byte is a different
  // key. The two prefixes are the SAME LENGTH and differ in the MIDDLE: a key
  // built from the length, the first bytes, the last bytes, a block id, a file
  // path or a range fingerprint all pass a weaker version of this row and fail
  // this one.
  const p1 = prefixOf(4096);
  const p2 = `${p1.slice(0, 2000)}X${p1.slice(2001)}`;
  assert.strictEqual(p1.length, p2.length, "fixture: same length");
  assert.strictEqual(
    [...p1].filter((c, i) => c !== p2[i]).length,
    1,
    "fixture: exactly one byte differs, and it is at offset 2000, in the middle"
  );

  const r = rig();
  await r.call({ prompt: promptFor(p1), cachePrefix: p1 });
  assert.strictEqual(r.shim.count(), 2, "precondition: round 1 warmed on p1");
  r.lines.length = 0;

  await r.call({ prompt: promptFor(p2), cachePrefix: p2 });
  assert.strictEqual(
    r.shim.count(),
    4,
    "one changed byte is a different payload: a new turn 1 and a new fork, NOT a reuse of the p1 checkpoint"
  );

  const [t1b, forkB] = [r.shim.spawn(2), r.shim.spawn(3)];
  assert.strictEqual(resumeOf(t1b.argv), null, "the new turn 1 builds a checkpoint, it does not resume one");
  assert.ok(t1b.stdin.startsWith(`${p2}\n\n`), "the new turn 1 carries the NEW payload bytes");
  assert.ok(!t1b.stdin.startsWith(`${p1}\n\n`), "it does not carry the old payload");
  assert.strictEqual(resumeOf(forkB.argv), sid(2), "the fork resumes the session the NEW turn 1 minted");
  assert.ok(isFork(forkB.argv), "--fork-session on the new checkpoint");
  assert.strictEqual(modeOf(roundLine(r.lines)), "warmed", `a mismatch builds a new turn 1\n  got: ${r.lines.join(" | ")}`);

  // The old session is dropped, not kept beside the new one: state is one entry.
  const resumed = r.shim.all().map((s) => resumeOf(s.argv)).filter(Boolean);
  assert.deepStrictEqual(resumed, [sid(0), sid(2)], "each round resumed its own checkpoint, in order, and no other");

  // And the NEW id is what a third round on p2 forks from. Without this, a
  // module could warm every round and still pass everything above.
  r.lines.length = 0;
  await r.call({ prompt: promptFor(p2), cachePrefix: p2 });
  assert.strictEqual(r.shim.count(), 5, "the new checkpoint is live: the third round is ONE spawn");
  assert.strictEqual(resumeOf(r.shim.spawn(4).argv), sid(2), "it resumes the NEW session id, never the p1 one");
  assert.strictEqual(modeOf(roundLine(r.lines)), "forked");

  // Going back to p1 is a mismatch again: one entry, last write wins.
  r.lines.length = 0;
  await r.call({ prompt: promptFor(p1), cachePrefix: p1 });
  assert.strictEqual(r.shim.count(), 7, "state is ONE entry, so the p1 checkpoint is gone and p1 warms again");
  assert.strictEqual(modeOf(roundLine(r.lines)), "warmed");
  assert.strictEqual(resumeOf(r.shim.spawn(6).argv), sid(5), "the fork resumes the freshly minted p1 session");
});

test("row 4b (the cache-key table, row 3): an edit OUTSIDE every pinned range leaves the payload identical and the cache holds", async () => {
  // "The third row is what makes the feature worth building." Same prefix
  // bytes, a different generation prompt: one spawn, and the fork carries the
  // NEW tail.
  const prefix = prefixOf(4096);
  const r = rig();
  await r.call({ prompt: promptFor(prefix), cachePrefix: prefix });
  r.lines.length = 0;

  const newTail = "// write the OTHER body\nfn sub(a: i32, b: i32) -> i32 {\n";
  await r.call({ prompt: promptFor(prefix, newTail), cachePrefix: prefix });

  assert.strictEqual(r.shim.count(), 3, "the payload did not change, so no new turn 1");
  const fork = r.shim.spawn(2);
  assert.strictEqual(resumeOf(fork.argv), sid(0), "the checkpoint held");
  assert.strictEqual(fork.stdin, newTail, "the fork carries the new tail, so the model sees the new question");
  assert.strictEqual(modeOf(roundLine(r.lines)), "forked");
});

// ---------------------------------------------------------------------------
// row 5: not actually a prefix
// ---------------------------------------------------------------------------

test("row 5: a prefix that is not a prefix of the prompt - one spawn, whole prompt, cache-mode=single-shot, nothing throws", async () => {
  const prefix = prefixOf(4096);
  const body = promptFor(prefixOf(4096, "d")); // same length, different bytes
  assert.ok(!body.startsWith(prefix), "fixture: the declared prefix really is not one");

  const r = rig();
  const out = await r.call({ prompt: body, cachePrefix: prefix });

  assert.strictEqual(r.shim.count(), 1, "the drift guard fails SAFE: a single-shot round, never a throw");
  assert.strictEqual(r.shim.spawn(0).stdin, body, "the whole prompt goes over stdin");
  assert.strictEqual(resumeOf(r.shim.spawn(0).argv), null);
  assert.strictEqual(modeOf(roundLine(r.lines)), "single-shot", `got: ${r.lines.join(" | ")}`);
  assert.strictEqual(out.text, "a + b", "the round still succeeds");
});

test("extra (seam rule 2): the separator is part of the check - prefix + one newline is NOT a match", async () => {
  // The transport verifies `prompt.startsWith(cachePrefix + "\\n\\n")`. A prompt
  // that starts with the prefix but only one newline fails that check, so the
  // round is single-shot and says so.
  const prefix = prefixOf(4096);
  const body = `${prefix}\n${TAIL}`;
  assert.ok(body.startsWith(prefix), "fixture: it IS a leading substring");
  assert.ok(!body.startsWith(`${prefix}\n\n`), "fixture: but the separator is not the ruled one");

  const r = rig();
  await r.call({ prompt: body, cachePrefix: prefix });
  assert.strictEqual(r.shim.count(), 1, "no split without the ruled separator");
  assert.strictEqual(r.shim.spawn(0).stdin, body, "the whole prompt, unsplit");
  assert.strictEqual(modeOf(roundLine(r.lines)), "single-shot", `got: ${r.lines.join(" | ")}`);
});

test("extra (step 1): an empty prefix is a single-shot round, not a below-floor one", async () => {
  const r = rig();
  await r.call({ prompt: TAIL, cachePrefix: "" });
  assert.strictEqual(r.shim.count(), 1);
  assert.strictEqual(r.shim.spawn(0).stdin, TAIL);
  assert.strictEqual(
    modeOf(roundLine(r.lines)),
    "single-shot",
    `step 1 names the empty prefix before the floor is consulted\n  got: ${r.lines.join(" | ")}`
  );
});

// ---------------------------------------------------------------------------
// row 6: the floor
// ---------------------------------------------------------------------------

test("row 6: a 2047-byte prefix is below-floor and single-spawn; 2048 bytes warms", async () => {
  const under = prefixOf(2047);
  const below = rig();
  await below.call({ prompt: promptFor(under), cachePrefix: under });
  assert.strictEqual(below.shim.count(), 1, "below MIN_PREFIX_BYTES the round trip buys nothing");
  assert.strictEqual(
    below.shim.spawn(0).stdin,
    promptFor(under),
    "a below-floor round still sends the whole prompt"
  );
  assert.strictEqual(
    modeOf(roundLine(below.lines)),
    "below-floor",
    `deliberately not forked, and the line says which\n  got: ${below.lines.join(" | ")}`
  );

  const at = prefixOf(2048);
  const warm = rig();
  await warm.call({ prompt: promptFor(at), cachePrefix: at });
  assert.strictEqual(warm.shim.count(), 2, "MIN_PREFIX_BYTES = 2048 is the floor, and 2048 clears it");
  assert.strictEqual(modeOf(roundLine(warm.lines)), "warmed", `got: ${warm.lines.join(" | ")}`);
});

test("extra (order): step 1 beats step 2 - a short prefix that is not a prefix is single-shot, not below-floor", async () => {
  const r = rig();
  await r.call({ prompt: TAIL, cachePrefix: "not-a-prefix-at-all" });
  assert.strictEqual(r.shim.count(), 1);
  assert.strictEqual(
    modeOf(roundLine(r.lines)),
    "single-shot",
    `the steps run in the contract's order\n  got: ${r.lines.join(" | ")}`
  );
});

// ---------------------------------------------------------------------------
// row 7: turn 1 fails
// ---------------------------------------------------------------------------

const TURN1_FAILURES = [
  { name: "non-zero exit", spawn: { stderr: "boom: the CLI fell over\n", exitCode: 2 }, reason: "exit" },
  { name: "unparseable output", spawn: { stdout: "this is not json {\n", exitCode: 0 }, reason: "bad-json" },
  { name: "no session_id", spawn: { stdout: reply({ session_id: undefined }), exitCode: 0 }, reason: null },
];

for (const shape of TURN1_FAILURES) {
  test(`row 7: turn 1 fails (${shape.name}) - ONE further spawn with the WHOLE prompt, the round SUCCEEDS, cache-mode=degraded`, async () => {
    const prefix = prefixOf(4096);
    const body = promptFor(prefix);
    const r = rig([shape.spawn]);
    const out = await r.call({ prompt: body, cachePrefix: prefix });

    assert.strictEqual(out.text, "a + b", "the round NEVER fails for a caching reason");
    assert.strictEqual(r.shim.count(), 2, "the failed turn 1, then exactly one single-shot round");
    assert.strictEqual(r.shim.spawn(1).stdin, body, "the fallback carries the WHOLE prompt, prefix included");
    assert.strictEqual(resumeOf(r.shim.spawn(1).argv), null, "there is no session to resume");

    const line = roundLine(r.lines);
    assert.strictEqual(modeOf(line), "degraded", `a caching failure fell back to a whole-prompt round\n  got: ${line}`);
    const why = degradedReason(line);
    if (shape.reason !== null) {
      assert.strictEqual(why, shape.reason, `the reason names the failure shape\n  got: ${line}`);
    }

    // "No session is stored, so the next round warms again."
    r.lines.length = 0;
    await r.call({ prompt: body, cachePrefix: prefix });
    assert.strictEqual(r.shim.count(), 4, "state was cleared, so the next round builds a turn 1 again");
    assert.strictEqual(resumeOf(r.shim.spawn(3).argv), sid(2), "and forks from the session THAT turn 1 minted");
    assert.strictEqual(modeOf(roundLine(r.lines)), "warmed");
  });
}

// ---------------------------------------------------------------------------
// rows 8-9: degrading on the fork round
// ---------------------------------------------------------------------------

test("row 8: a forked round failing with cli-error retries EXACTLY once as single-shot, succeeds, cache-mode=degraded", async () => {
  const prefix = prefixOf(4096);
  const body = promptFor(prefix);
  // spawn 0 turn 1, spawn 1 the first round's fork, spawn 2 the second round's
  // fork (is_error), spawn 3 the single-shot retry.
  const r = rig([OK_REPLY, OK_REPLY, okWith({ is_error: true, subtype: "error_during_execution" })]);
  await r.call({ prompt: body, cachePrefix: prefix });
  assert.strictEqual(r.shim.count(), 2, "precondition: the first round warmed");
  r.lines.length = 0;

  const out = await r.call({ prompt: body, cachePrefix: prefix });
  assert.strictEqual(out.text, "a + b", "a dead or unforkable session is a degrade, not a failure");
  assert.strictEqual(r.shim.count(), 4, "the failed fork, then EXACTLY one retry");
  assert.strictEqual(r.shim.spawn(3).stdin, body, "the retry's stdin is the whole prompt");
  assert.strictEqual(resumeOf(r.shim.spawn(3).argv), null, "the retry is single-shot: nothing is resumed");

  const line = roundLine(r.lines);
  assert.strictEqual(modeOf(line), "degraded", `reported from what HAPPENED, not what was intended\n  got: ${line}`);
  assert.strictEqual(degradedReason(line), "cli-error", `the reason tells a broken session from an expired one\n  got: ${line}`);

  // "with state cleared": the next round warms rather than forking again.
  r.lines.length = 0;
  await r.call({ prompt: body, cachePrefix: prefix });
  assert.strictEqual(r.shim.count(), 6, "state was cleared by the degrade, so the next round warms");
  assert.strictEqual(modeOf(roundLine(r.lines)), "warmed");
});

test("row 9: a forked round failing with a serving failure does NOT retry, rejects serving-failure, and leaves the state alone", async () => {
  const prefix = prefixOf(4096);
  const body = promptFor(prefix);
  const r = rig([OK_REPLY, OK_REPLY, { stderr: "Claude AI usage limit reached\n", exitCode: 1 }]);
  await r.call({ prompt: body, cachePrefix: prefix });
  assert.strictEqual(r.shim.count(), 2, "precondition: the first round warmed");
  r.lines.length = 0;

  await assert.rejects(
    r.call({ prompt: body, cachePrefix: prefix }),
    (err) => {
      assert.strictEqual(err.name, "ClaudeCodeError", `expected the taxonomy error; got ${err.name}`);
      assert.strictEqual(err.reason, "serving-failure", "retrying a throttle makes it worse");
      return true;
    }
  );
  assert.strictEqual(r.shim.count(), 3, "NO retry: exactly the one failed fork");
  assert.strictEqual(roundLines(r.lines).length, 0, "a failed round has no successful-round line to carry cache-mode");

  // "the state is left alone": the next round still forks from the same id.
  r.lines.length = 0;
  await r.call({ prompt: body, cachePrefix: prefix });
  assert.strictEqual(r.shim.count(), 4, "the checkpoint survived a serving failure");
  assert.strictEqual(resumeOf(r.shim.spawn(3).argv), sid(0), "same session, untouched");
  assert.strictEqual(modeOf(roundLine(r.lines)), "forked");
});

test("extra (Degrading): a forked round that TIMES OUT is not retried either", async () => {
  const prefix = prefixOf(4096);
  const body = promptFor(prefix);
  // spawn 2 is the fork and it sits past the configured cap. The cap must clear
  // the shim's own startup: `#!/usr/bin/env node` resolves node through the PATH,
  // which on a fnm-managed box adds ~450ms before the shim even answers, so a
  // cap near that latency races the warmup's immediate OK_REPLY.
  const r = rig([OK_REPLY, OK_REPLY, okWith({}, { sleepMs: 5000 })], OK_REPLY, { timeoutMs: 1000 });
  await r.call({ prompt: body, cachePrefix: prefix });
  assert.strictEqual(r.shim.count(), 2, "precondition: warmed");

  await assert.rejects(r.call({ prompt: body, cachePrefix: prefix }), (err) => {
    assert.strictEqual(err.reason, "timeout", `timeout is expensive by definition and is not retried; got ${err.reason}`);
    return true;
  });
  await sleep(200);
  assert.strictEqual(r.shim.count(), 3, "no retry spawn followed the timeout");
});

// ---------------------------------------------------------------------------
// row 10: abort during turn 1
// ---------------------------------------------------------------------------

test("row 10: an abort during turn 1 kills the child, rejects AbortError, and no turn 2 spawns", async () => {
  const prefix = prefixOf(4096);
  const body = promptFor(prefix);
  const shim = makeShim([okWith({}, { sleepMs: 4000 })], OK_REPLY);
  const cwd = tmpDir("c80-v44f-cwd-");
  const fn = makeClaudeCodeInstruct({ cwd, binary: shim.binary });
  const ac = new AbortController();
  const p = fn({ signal: ac.signal, prompt: body, cachePrefix: prefix, ...BASE });

  await waitFor(() => shim.count() >= 1, 3000, "the first child to start");
  const one = shim.spawn(0);
  // Without this the row would pass against a transport that never forks at
  // all: it is the assertion that says the killed child WAS turn 1.
  await waitFor(() => shim.spawn(0).stdin !== null, 3000, "the first child to receive its stdin");
  assert.ok(
    shim.spawn(0).stdin.startsWith(`${prefix}\n\n`),
    "the aborted round was in TURN 1, not in a whole-prompt single-shot round"
  );
  assert.notStrictEqual(shim.spawn(0).stdin, body, "turn 1 is not the generation prompt");

  ac.abort();
  await assert.rejects(p, (err) => {
    assert.strictEqual(err.name, "AbortError", "an aborted round keeps the platform contract, it is not in the taxonomy");
    return true;
  });

  assert.ok(await waitDead(one.pid), `the turn-1 child (pid ${one.pid}) must be killed on abort`);
  await sleep(400);
  assert.strictEqual(shim.count(), 1, "an aborted round never starts turn 2");
  assert.ok(!shim.spawn(0).finished(), "a killed child never reaches its post-sleep write");
});

// ---------------------------------------------------------------------------
// rows 11-12: single-flight
// ---------------------------------------------------------------------------

test("row 11: two concurrent rounds with the same prefix - turn 1 spawns ONCE, both succeed, both fork from that session", async () => {
  const prefix = prefixOf(4096);
  const body = promptFor(prefix);
  // The turn-1 spawn sits for 300ms, so the second round certainly arrives
  // while the warm is in flight.
  const r = rig([okWith({}, { sleepMs: 300 })], OK_REPLY);
  const [a, b] = await Promise.all([
    r.call({ prompt: body, cachePrefix: prefix }),
    r.call({ prompt: body, cachePrefix: prefix }),
  ]);

  assert.strictEqual(a.text, "a + b", "both rounds succeed");
  assert.strictEqual(b.text, "a + b");
  assert.strictEqual(r.shim.count(), 3, "a warm in progress is SHARED: one turn 1, two forks");

  const spawns = r.shim.all();
  const turn1s = spawns.filter((s) => resumeOf(s.argv) === null);
  const forks = spawns.filter((s) => resumeOf(s.argv) !== null);
  assert.strictEqual(turn1s.length, 1, "exactly one checkpoint was built");
  assert.strictEqual(forks.length, 2, "both rounds forked");
  for (const f of forks) {
    assert.strictEqual(resumeOf(f.argv), sid(turn1s[0].index), "both forks resume the SAME session id");
    assert.ok(isFork(f.argv), "--fork-session on both");
    assert.strictEqual(f.stdin, TAIL, "each fork carries the prompt minus the prefix");
  }
  assert.strictEqual(turn1Lines(r.lines).length, 1, "one turn 1 ran, so one turn-1 line was logged");
});

test("row 12: two concurrent rounds with DIFFERENT prefixes each warm their own", async () => {
  const p1 = prefixOf(4096);
  const p2 = `${p1.slice(0, 2000)}X${p1.slice(2001)}`;
  const r = rig([okWith({}, { sleepMs: 200 }), okWith({}, { sleepMs: 200 })], OK_REPLY);
  const [a, b] = await Promise.all([
    r.call({ prompt: promptFor(p1), cachePrefix: p1 }),
    r.call({ prompt: promptFor(p2), cachePrefix: p2 }),
  ]);

  assert.strictEqual(a.text, "a + b");
  assert.strictEqual(b.text, "a + b");
  assert.strictEqual(r.shim.count(), 4, "a different hash does not wait: two turn 1s and two forks");

  const spawns = r.shim.all();
  const turn1s = spawns.filter((s) => resumeOf(s.argv) === null);
  const forks = spawns.filter((s) => resumeOf(s.argv) !== null);
  assert.strictEqual(turn1s.length, 2, "each round built its own checkpoint");
  assert.strictEqual(forks.length, 2, "each round forked");
  const payloads = turn1s.map((s) => s.stdin.slice(0, 4096)).sort();
  assert.deepStrictEqual(payloads, [p1, p2].sort(), "each turn 1 carried its OWN payload bytes");
  const resumed = forks.map((f) => resumeOf(f.argv)).sort();
  assert.deepStrictEqual(
    resumed,
    turn1s.map((s) => sid(s.index)).sort(),
    "each fork resumed a session one of these turn 1s minted"
  );
  assert.strictEqual(new Set(resumed).size, 2, "the two rounds did not collapse onto one checkpoint");
});

// ---------------------------------------------------------------------------
// row 13: phase 1's accounting survives
// ---------------------------------------------------------------------------

test("row 13: phase 1's accounting fields appear on BOTH the turn-1 line and the round line, same spelling and order", async () => {
  const prefix = prefixOf(4096);
  const turn1Usage = {
    input_tokens: 1,
    output_tokens: 1,
    cache_creation_input_tokens: 3000,
    cache_read_input_tokens: 0,
    cache_creation: { ephemeral_1h_input_tokens: 3000, ephemeral_5m_input_tokens: 0 },
  };
  const roundUsage = {
    input_tokens: 2,
    output_tokens: 11,
    cache_creation_input_tokens: 84,
    cache_read_input_tokens: 15548,
    cache_creation: { ephemeral_1h_input_tokens: 84, ephemeral_5m_input_tokens: 0 },
  };
  const r = rig([okWith({ usage: turn1Usage }), okWith({ usage: roundUsage })]);
  await r.call({ prompt: promptFor(prefix), cachePrefix: prefix });

  const t1 = turn1Lines(r.lines);
  assert.strictEqual(t1.length, 1, `turn 1 is a real expense and phase 4 has to see it\n  got: ${JSON.stringify(r.lines)}`);
  assert.ok(
    t1[0].includes("in=1 out=1 cwrite=3000 cread=0 ttl=1h billed-eq=6001"),
    `the turn-1 line carries phase 1's six fields, unchanged\n  expected 1 + 2*3000 = 6001\n  got: ${t1[0]}`
  );

  const line = roundLine(r.lines);
  assert.ok(
    line.includes("in=2 out=11 cwrite=84 cread=15548 ttl=1h billed-eq=1725"),
    `the round line keeps phase 1's six fields\n  expected 2 + 2*84 + 0.1*15548 = 1724.8 -> 1725\n  got: ${line}`
  );
  assert.ok(TAIL_RE.test(t1[0]) && TAIL_RE.test(line), "the six fields keep phase 1's order on both lines");
});

// ---------------------------------------------------------------------------
// row 14: one renderer, so the prefix and the prompt cannot drift
// ---------------------------------------------------------------------------

const BLOCKS = [
  { uri: "file:///w/a.rs", range: { startLine: 3, endLine: 9 }, text: "struct Acc;\nSENTINEL_BLOCK_ALPHA" },
  { uri: "file:///w/b.rs", range: { startLine: 1, endLine: 4 }, text: "fn helper() {}\nSENTINEL_BLOCK_BETA" },
];

function renderContextPrefix(blocks) {
  assert.strictEqual(
    typeof P.renderContextPrefix,
    "function",
    "prompt.ts must export renderContextPrefix(blocks): it is the single source of the prefix bytes (seam rule 3)"
  );
  return P.renderContextPrefix(blocks);
}

const FNGEN_INPUT = {
  signature: "fn add(a: i32, b: i32) -> i32",
  docComment: "/// Adds.",
  languageId: "rust",
};
const REPAIR_INPUT = {
  languageId: "rust",
  docComment: "/// Adds.",
  code: "fn add(a: i32, b: i32) -> i32 { a }",
  diagnostics: [
    {
      kind: "compile-error",
      level: "error",
      code: "E0308",
      message: "mismatched types",
      spans: [],
      suggestions: [],
      rendered: "error[E0308]: mismatched types\n",
    },
  ],
};
const REFINE_INPUT = { languageId: "rust", code: "fn add(a: i32, b: i32) -> i32 { a + b }" };

const ASSEMBLERS = [
  { name: "assembleFnGenPrompt", fn: (extra) => P.assembleFnGenPrompt({ ...FNGEN_INPUT, ...extra }) },
  { name: "assembleRepairPrompt", fn: (extra) => R.assembleRepairPrompt({ ...REPAIR_INPUT, ...extra }) },
  { name: "assembleRefinePrompt", fn: (extra) => RF.assembleRefinePrompt({ ...REFINE_INPUT, ...extra }) },
];

for (const a of ASSEMBLERS) {
  test(`row 14: renderContextPrefix output is exactly the leading bytes ${a.name} emits for the same blocks`, () => {
    const prefix = renderContextPrefix(BLOCKS);
    const body = a.fn({ contextBlocks: BLOCKS });

    assert.ok(
      body.startsWith(prefix),
      `${a.name} must render its leading blocks through renderContextPrefix\n` +
        `  prefix: ${JSON.stringify(prefix.slice(0, 200))}\n` +
        `  prompt: ${JSON.stringify(body.slice(0, 200))}`
    );
    // Seam rule 2: the transport splits on prefix + "\n\n". If the assembler
    // used any other separator, every real round would silently be single-shot.
    assert.ok(
      body.startsWith(`${prefix}\n\n`),
      `${a.name}'s prefix must be followed by the ruled blank line, or the transport's guard sends every round single-shot\n` +
        `  got after the prefix: ${JSON.stringify(body.slice(prefix.length, prefix.length + 20))}`
    );
    // "The stable head of prompt: the rendered context blocks and NOTHING
    // else": no block bytes survive past the prefix.
    const rest = body.slice(prefix.length + 2);
    for (const sentinel of ["SENTINEL_BLOCK_ALPHA", "SENTINEL_BLOCK_BETA"]) {
      assert.ok(
        !rest.includes(sentinel),
        `${a.name}: every block byte belongs to the prefix, so ${sentinel} must not appear after it`
      );
    }
    assert.ok(prefix.includes("SENTINEL_BLOCK_ALPHA") && prefix.includes("SENTINEL_BLOCK_BETA"), "both blocks are in the prefix");
  });
}

test("row 14 (identity): a no-block prompt is unchanged, and the block prompt is the prefix, the blank line, and that same prompt", () => {
  // The "byte-identical to what it produced before this phase" half, asserted
  // the only way a file written before the change can assert it: the assembler
  // with blocks must decompose into the prefix plus the assembler without.
  const prefix = renderContextPrefix(BLOCKS);
  for (const a of ASSEMBLERS) {
    const withBlocks = a.fn({ contextBlocks: BLOCKS });
    const without = a.fn({});
    assert.strictEqual(
      withBlocks,
      `${prefix}\n\n${without}`,
      `${a.name}: adding blocks prepends the prefix and the separator, and changes nothing else`
    );
  }
});

test("extra (seam rule 3): renderContextPrefix is a pure function of the block bytes", () => {
  const a = renderContextPrefix(BLOCKS);
  assert.strictEqual(a, renderContextPrefix(BLOCKS), "same blocks, same bytes, every time");

  const reordered = [BLOCKS[1], BLOCKS[0]];
  assert.notStrictEqual(
    renderContextPrefix(reordered),
    a,
    "reordering blocks changes the payload bytes, which is what forces a new turn 1"
  );

  const edited = [{ ...BLOCKS[0], text: `${BLOCKS[0].text}!` }, BLOCKS[1]];
  assert.notStrictEqual(renderContextPrefix(edited), a, "an edit INSIDE a pinned range changes the payload bytes");

  assert.notStrictEqual(renderContextPrefix([BLOCKS[0]]), a, "removing a block changes the payload bytes");
});

// ---------------------------------------------------------------------------
// row 15: the ollama path does not move
// ---------------------------------------------------------------------------

function startServer(handler) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", () => {
      requests.push({ method: req.method, url: req.url, raw });
      handler(req, res);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({
        apiBase: `http://127.0.0.1:${server.address().port}`,
        requests,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

test("row 15: the ollama client's request body is byte-identical whether or not cachePrefix is set", async (t) => {
  const srv = await startServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/x-ndjson" });
    res.write(`${JSON.stringify({ response: "a + b" })}\n`);
    res.write(`${JSON.stringify({ response: "", done: true })}\n`);
    res.end();
  });
  t.after(srv.close);

  const prefix = prefixOf(4096);
  const params = {
    apiBase: srv.apiBase,
    model: "qwen3-coder:30b",
    prompt: promptFor(prefix),
    maxTokens: 512,
    temperature: 0.2,
    numGpu: 30,
  };
  await OL.generateInstruct({ ...params, signal: new AbortController().signal });
  await OL.generateInstruct({ ...params, cachePrefix: prefix, signal: new AbortController().signal });

  assert.strictEqual(srv.requests.length, 2, "one POST each");
  assert.strictEqual(srv.requests[0].url, srv.requests[1].url, "same endpoint");
  assert.strictEqual(srv.requests[0].method, srv.requests[1].method);
  assert.strictEqual(
    srv.requests[1].raw,
    srv.requests[0].raw,
    "decision rule 1: a caching change must never alter what the model sees on the ollama path"
  );
  assert.ok(!srv.requests[1].raw.includes("cachePrefix"), "the field has no transport here and must not leak into the body");
});

// ---------------------------------------------------------------------------
// row 16: FnGenService computes and forwards the prefix
// ---------------------------------------------------------------------------

const SVC_CFG = {
  apiBase: "http://127.0.0.1:1", // never reached: generate is injected
  model: "fake-30b",
  fallbackModel: "fake-14b",
  maxTokens: 128,
  temperature: 0.2,
};
const SVC_REQ = { signature: "fn add(a: i32, b: i32) -> i32", docComment: "/// Adds.", languageId: "rust" };
const SVC_RAW = "```rust\nfn add(a: i32, b: i32) -> i32 {\n    a + b\n}\n```";

function capturingService() {
  const calls = [];
  const svc = new FS.FnGenService(SVC_CFG, async (params) => {
    calls.push(params);
    return { text: SVC_RAW, ttftMs: 1, totalMs: 2 };
  });
  return { svc, calls };
}

test("row 16: generate() forwards a prefix computed from its request's blocks; a request with no blocks forwards nothing", async () => {
  const withBlocks = capturingService();
  await withBlocks.svc.generate({ ...SVC_REQ, contextBlocks: BLOCKS });
  assert.strictEqual(withBlocks.calls.length, 1, "one generate, one call to the transport");
  assert.strictEqual(
    withBlocks.calls[0].cachePrefix,
    renderContextPrefix(BLOCKS),
    "the service computes the prefix through the ONE renderer, so the prefix and the prompt cannot drift"
  );
  assert.ok(
    withBlocks.calls[0].prompt.startsWith(`${withBlocks.calls[0].cachePrefix}\n\n`),
    "and what it forwards really is the stable head of what it assembled"
  );
  withBlocks.svc.dispose();

  const bare = capturingService();
  await bare.svc.generate({ ...SVC_REQ });
  assert.strictEqual(bare.calls.length, 1);
  assert.strictEqual(
    bare.calls[0].cachePrefix,
    undefined,
    "no blocks means no stable head, which is a single-shot round"
  );
  bare.svc.dispose();

  const empty = capturingService();
  await empty.svc.generate({ ...SVC_REQ, contextBlocks: [] });
  assert.strictEqual(
    empty.calls[0].cachePrefix,
    undefined,
    "an empty block list is the same nothing as no block list"
  );
  empty.svc.dispose();
});

test("extra (seam rule 4): generateRaw carries contextBlocks, so repair, refine and TDD reach the same checkpoint", async () => {
  const withBlocks = capturingService();
  const body = `${renderContextPrefix(BLOCKS)}\n\nfix this code`;
  await withBlocks.svc.generateRaw(body, { contextBlocks: BLOCKS });
  assert.strictEqual(withBlocks.calls.length, 1);
  assert.strictEqual(
    withBlocks.calls[0].cachePrefix,
    renderContextPrefix(BLOCKS),
    "one fork session per block set serves generate, repair, refine and TDD"
  );
  withBlocks.svc.dispose();

  const bare = capturingService();
  await bare.svc.generateRaw("fix this code", {});
  assert.strictEqual(
    bare.calls[0].cachePrefix,
    undefined,
    "a raw round with no blocks forwards no prefix"
  );
  bare.svc.dispose();
});

// ---------------------------------------------------------------------------
// extras: prose the numbered rows do not reach
// ---------------------------------------------------------------------------

test("extra (Turn 1): turn 1 and turn 2 EACH get the full configured timeout", async () => {
  // Both children sit for 1000ms against a 1800ms cap. Per-turn, the round
  // completes; a cap shared across the warm would fire at 1800ms of the ~2000ms
  // the two turns take together. The sleep and cap are sized to clear the shim's
  // own startup (~450ms through `#!/usr/bin/env node` on a fnm-managed box), so
  // the per-turn vs shared distinction holds on a slow PATH and a fast one.
  const prefix = prefixOf(4096);
  const r = rig([okWith({}, { sleepMs: 1000 }), okWith({}, { sleepMs: 1000 })], OK_REPLY, { timeoutMs: 1800 });
  const out = await r.call({ prompt: promptFor(prefix), cachePrefix: prefix });
  assert.strictEqual(out.text, "a + b", "a warm round may take up to twice as long as a single-shot one");
  assert.strictEqual(r.shim.count(), 2);
});

test("extra (Evidence): the mode is reported from what HAPPENED - a forked round that read nothing from cache still says forked", async () => {
  // Two fields, two jobs, no inference between them: cread is what says whether
  // the cache actually paid, and it does not get to rewrite cache-mode.
  const prefix = prefixOf(4096);
  const noRead = {
    input_tokens: 2,
    output_tokens: 11,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    cache_creation: { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 0 },
  };
  const r = rig([OK_REPLY, OK_REPLY, okWith({ usage: noRead })]);
  await r.call({ prompt: promptFor(prefix), cachePrefix: prefix });
  r.lines.length = 0;
  await r.call({ prompt: promptFor(prefix), cachePrefix: prefix });

  const line = roundLine(r.lines);
  assert.strictEqual(modeOf(line), "forked", `that is how the round was served\n  got: ${line}`);
  assert.strictEqual(field(line, "cread"), "0", "and the accounting is free to say the cache paid nothing");
});

test("extra (Where the session files go): nothing product-owned leaks - every spawn, turn 1 included, runs in the neutral cwd", async () => {
  const prefix = prefixOf(4096);
  const r = rig();
  await r.call({ prompt: promptFor(prefix), cachePrefix: prefix });
  for (const sp of r.shim.all()) {
    assert.strictEqual(sp.cwd, r.cwd, `spawn ${sp.index} ran in the product-owned empty dir, never the workspace`);
  }
});

test("extra (What the transport does): the state is owned by the instance, so a second instance shares no checkpoint", async () => {
  // "A settings change rebuilds the service and drops it, which is a degrade,
  // not a failure." A fresh instance is the rebuilt service.
  const prefix = prefixOf(4096);
  const body = promptFor(prefix);
  const shim = makeShim([], OK_REPLY);
  const cwd = tmpDir("c80-v44f-cwd-");
  const call = (fn) => fn({ signal: new AbortController().signal, prompt: body, cachePrefix: prefix, ...BASE });

  const first = makeClaudeCodeInstruct({ cwd, binary: shim.binary });
  await call(first);
  assert.strictEqual(shim.count(), 2, "precondition: the first instance warmed");

  const second = makeClaudeCodeInstruct({ cwd, binary: shim.binary });
  await call(second);
  assert.strictEqual(shim.count(), 4, "a rebuilt transport starts cold: it warms rather than resuming a checkpoint it does not own");
  assert.strictEqual(resumeOf(shim.spawn(3).argv), sid(2), "and forks from its OWN turn 1");
});
