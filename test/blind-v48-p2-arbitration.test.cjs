// BLIND ORACLE - session-v48 phases 2 + 3: arbitration, refusal, and the
// dropped edges. Every assertion below is bound to `session-v48/contract-phase2.md`
// (P1..P8 and "What must NOT change"). Nothing here has read src/core/prompt.ts,
// src/core/fnGenService.ts, src/vscode/fnGen.ts, src/core/dataShape.ts or any
// module phase 2 adds. Written while the implementation was in flight, so a red
// row is the correct initial state.
//
// Run: SKIP_LIVE=1 node --test test/blind-v48-p2-arbitration.test.cjs
//
// ---------------------------------------------------------------------------
// THE SEAM, AND WHY THIS ONE. The contract names properties, never a symbol for
// its own central mechanism - no module, no function, no result type beyond the
// three token names. So the seam was DISCOVERED by probing exports and running
// today's code, never by reading it:
//
//   * `FnGenService` (src/core/fnGenService.ts) is the only place that turns a
//     request into the prompt string: driven headless with an injected generate
//     fn, today's prompt is byte-identical to `assembleFnGenPrompt({signature,
//     docComment, contextBlocks, languageId, injectedSurface})`, and the config
//     it is built with carries BOTH `numCtx` (16384) and `maxTokens` (2048) -
//     i.e. every term of P1's `numCtx - maxTokens` is already in its hand, and
//     the injected surface already reaches it as a string. So P3's ladder, P4's
//     "no model call", P6's channel line and P7's byte-identity are all
//     observable there, and that is where the rows below bind.
//   * `resolvePrefill` (src/vscode/fnGen.ts) is where the data-shape walk runs,
//     so P8 binds there, over a vscode stub.
//   * `walkDataShape` (src/core/dataShape.ts) is named BY the contract, and its
//     `{block, dropped}` shape is taken from the existing v6 oracle's header.
//
// If the implementer put arbitration ABOVE the service (in src/vscode/fnGen.ts,
// which never assembles the prompt and so cannot count `fixedTok`), the P2..P7
// rows here go red and the report says the contract left the seam unstated.
//
// WORDING. The contract fixes no message wording, so every message/channel
// assertion binds to the contract's OWN vocabulary: `Column 80:` (P4), the word
// "inject" for the product's share (P2/P5 name it `injectedTok` and the setting
// `column80.injectedContext`), and the window number itself. Stated as an
// ambiguity in the report rather than softened here.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");

// ---------------------------------------------------------------------------
// Bundle. One entry over both seams; the vscode alias is inert for the core
// modules. A broken/mid-edit tree must be ONE loud failure, never a wall of
// TypeErrors that could be mistaken for contract failures.
// ---------------------------------------------------------------------------

const STUB = path.join(__dirname, ".blind-v48-p2-vscode-stub.cjs");
fs.writeFileSync(
  STUB,
  `
class Position {
  constructor(line, character) { this.line = line; this.character = character; }
  isBefore(o) { return this.line < o.line || (this.line === o.line && this.character < o.character); }
  isBeforeOrEqual(o) { return this.isBefore(o) || this.isEqual(o); }
  isAfter(o) { return !this.isBeforeOrEqual(o); }
  isAfterOrEqual(o) { return !this.isBefore(o); }
  isEqual(o) { return this.line === o.line && this.character === o.character; }
  compareTo(o) { return this.isEqual(o) ? 0 : this.isBefore(o) ? -1 : 1; }
  translate(l = 0, c = 0) { return new Position(this.line + l, this.character + c); }
  with(line, character) { return new Position(line === undefined ? this.line : line, character === undefined ? this.character : character); }
}
class Range {
  constructor(a, b, c, d) {
    if (typeof a === "number") { this.start = new Position(a, b); this.end = new Position(c, d); }
    else { this.start = a; this.end = b; }
  }
  get isEmpty() { return this.start.line === this.end.line && this.start.character === this.end.character; }
  get isSingleLine() { return this.start.line === this.end.line; }
  contains(p) {
    const ps = p.start ? p.start : p, pe = p.end ? p.end : p;
    const geS = ps.line > this.start.line || (ps.line === this.start.line && ps.character >= this.start.character);
    const leE = pe.line < this.end.line || (pe.line === this.end.line && pe.character <= this.end.character);
    return geS && leE;
  }
  with(s, e) { return new Range(s || this.start, e || this.end); }
}
class Selection extends Range {}
class WorkspaceEdit {}
class EventEmitter { constructor(){ this.event=()=>({dispose(){}}); } fire(){} dispose(){} }
class ThemeColor {}
class MarkdownString {}
const mkUri = (s) => ({ toString: () => String(s), fsPath: String(s), path: String(s) });
const keyOf = (arg) => (typeof arg === "string" ? arg : (arg && arg.toString ? arg.toString() : String(arg)));
module.exports = {
  Position, Range, Selection, WorkspaceEdit, EventEmitter, ThemeColor, MarkdownString,
  Uri: { parse: mkUri, file: mkUri },
  SymbolKind: { File:0, Module:1, Namespace:2, Package:3, Class:4, Method:5, Property:6,
    Field:7, Constructor:8, Enum:9, Interface:10, Function:11, Variable:12, Constant:13,
    String:14, Number:15, Boolean:16, Array:17, Object:18, Key:19, Null:20, EnumMember:21,
    Struct:22, Event:23, Operator:24, TypeParameter:25 },
  ProgressLocation: { SourceControl:1, Window:10, Notification:15 },
  EndOfLine: { LF:1, CRLF:2 },
  languages: {}, window: {}, commands: { executeCommand: async () => undefined },
  workspace: {
    getConfiguration: () => ({ get: (k, f) => f, has: () => false, inspect: () => undefined, update: async () => {} }),
    openTextDocument: (arg) => {
      const files = globalThis.__V48P2_FILES__ || {};
      const key = keyOf(arg);
      return Promise.resolve({ uri: mkUri(key), getText: () => files[key] });
    },
  },
};
`,
);

const ENTRY = path.join(__dirname, ".blind-v48-p2.entry.ts");
const OUTFILE = path.join(__dirname, ".blind-v48-p2.bundle.cjs");
let B = {};
let bundleErr;
try {
  fs.writeFileSync(
    ENTRY,
    `export { FnGenService } from "../src/core/fnGenService";
export { assembleFnGenPrompt } from "../src/core/prompt";
export { walkDataShape } from "../src/core/dataShape";
export { GEN_NUM_CTX, GEN_MAX_TOKENS, FRONTIER_MAX_TOKENS, GEN_TIMEOUT_MS, modelClassFor } from "../src/core/budgetProfile";
export { DEFAULT_FNGEN_CONFIG } from "../src/core/config";
export { resolvePrefill } from "../src/vscode/fnGen";\n`,
  );
  esbuild.buildSync({ entryPoints: [ENTRY], bundle: true, outfile: OUTFILE, format: "cjs", platform: "node", alias: { vscode: STUB } });
  B = require(OUTFILE);
} catch (e) {
  bundleErr = e;
}
const V = require(STUB);
test.after(() => [STUB, ENTRY, OUTFILE].forEach((f) => fs.rmSync(f, { force: true })));

test("bundle guard: every seam this oracle binds to builds headless", () => {
  if (bundleErr) assert.fail(`bundle failed to build: ${bundleErr.message}`);
  for (const n of ["FnGenService", "assembleFnGenPrompt", "walkDataShape", "GEN_NUM_CTX", "GEN_MAX_TOKENS", "resolvePrefill"]) {
    assert.ok(B[n] !== undefined, `${n} must be exported`);
  }
});
const btest = (name, fn) =>
  test(name, (ctx) => {
    if (bundleErr) return ctx.skip("bundle failed to build; see the bundle guard");
    return fn(ctx);
  });

// ---------------------------------------------------------------------------
// P1's numbers, computed here from the contract's own words so no row below
// re-derives them from the product.
// ---------------------------------------------------------------------------

const NUM_CTX = 16384;
const MAX_TOKENS = 2048;
const AVAILABLE = NUM_CTX - MAX_TOKENS; // 14336
const AVAILABLE_CHARS = AVAILABLE * 4; // the chars/4 proxy P2 names

// ---------------------------------------------------------------------------
// Service harness. An injected generate fn IS the model call: if it records a
// call, the model was called. A refusal is read off whatever the call hands
// back - thrown or resolved - because the contract fixes the message but not
// the mechanism.
// ---------------------------------------------------------------------------

const SIGNATURE = "pub fn build(p0: Root) -> u32";
const DOC = "/// Build the thing.";
const RAW = "```rust\npub fn build(p0: Root) -> u32 {\n    0\n}\n```";

const localCfg = (o = {}) => ({
  apiBase: "http://127.0.0.1:1", // never reached: generate is injected
  model: "fake-30b",
  maxTokens: MAX_TOKENS,
  temperature: 0.2,
  numCtx: NUM_CTX,
  ...o,
});

// Every string reachable from a value, so "a user-visible message exists" is
// asserted without pinning WHERE the implementer carried it.
function stringsOf(v, depth = 0, out = []) {
  if (v == null || depth > 4) return out;
  if (typeof v === "string") { out.push(v); return out; }
  if (v instanceof Error) { out.push(String(v.message)); stringsOf({ ...v }, depth + 1, out); return out; }
  if (Array.isArray(v)) { for (const x of v) stringsOf(x, depth + 1, out); return out; }
  if (typeof v === "object") { for (const k of Object.keys(v)) stringsOf(v[k], depth + 1, out); return out; }
  return out;
}

async function runGen(cfg, req) {
  const calls = [];
  const logs = [];
  const gen = async (p) => {
    calls.push(p);
    if (p.onChunk) p.onChunk("");
    return { text: RAW, ttftMs: 1, totalMs: 2 };
  };
  const svc = new B.FnGenService(cfg, gen, (l) => logs.push(String(l)));
  let result;
  let error;
  try {
    result = await svc.generate(req);
  } catch (e) {
    error = e;
  }
  svc.dispose();
  return {
    calls,
    logs,
    result,
    error,
    called: calls.length > 0,
    prompt: calls.length ? String(calls[0].prompt) : undefined,
    // Everything a caller could show a human or write to a buffer.
    surfaced: stringsOf(result).concat(stringsOf(error)),
  };
}

// ---- Fixture builders. Sentinels make "what survived" readable without
// pinning any layout.

const devBlock = (i, chars) => ({
  uri: `file:///work/v48/dev${i}.rs`,
  range: { startLine: 0, endLine: 1 },
  text: `// DEVSENTINEL${i}\n` + `pub const PAD${i}: &str = "${"d".repeat(Math.max(0, chars - 60))}";\n`,
});
const devBlocks = (n, chars) => Array.from({ length: n }, (_, i) => devBlock(i, chars));
const devSentinel = (i) => `DEVSENTINEL${i}`;

// An injected surface shaped like a real pre-fill payload: one labelled block
// per type, blank-line separated, each carrying a unique sentinel so a shrink
// is countable however the implementer cuts.
const injBlock = (i) =>
  "Data shape of `Type" + i + "` (fields and types, nested):\n" +
  "```rust\npub struct Type" + i + " {\n" +
  "    pub injsentinel_" + i + ": u32,\n" +
  "    pub label_for_the_slot_number_" + i + ": String,\n" +
  "    pub another_wide_field_name_" + i + ": Vec<u8>,\n}\n```";
const injSurface = (n) => Array.from({ length: n }, (_, i) => injBlock(i)).join("\n\n");
const injCount = (s) => (String(s || "").match(/injsentinel_\d+/g) || []).length;

const req = (o = {}) => ({ signature: SIGNATURE, docComment: DOC, languageId: "rust", ...o });

const todaysPrompt = (o = {}) =>
  B.assembleFnGenPrompt({
    signature: SIGNATURE,
    docComment: DOC,
    contextBlocks: o.contextBlocks ?? [],
    languageId: "rust",
    injectedSurface: o.injectedSurface,
  });

const NEW_LINE = /window|shrink|shrunk|refus|budget|arbitr|14336|does not fit|too large|too big/i;
const newLines = (logs) => logs.filter((l) => NEW_LINE.test(l));

// ===========================================================================
// W. P1's window, and the "What must NOT change" constants.
// ===========================================================================

btest("W1 [P1]: the local window is numCtx - maxTokens, and at the shipped values that is 14336", () => {
  assert.strictEqual(B.GEN_NUM_CTX, NUM_CTX, "GEN_NUM_CTX is on the must-not-change list");
  assert.strictEqual(B.GEN_MAX_TOKENS, MAX_TOKENS, "GEN_MAX_TOKENS is on the must-not-change list");
  assert.strictEqual(B.GEN_NUM_CTX - B.GEN_MAX_TOKENS, 14336, "P1: the space a prompt may occupy");
});

btest("W2 [must not change]: FRONTIER_MAX_TOKENS and GEN_TIMEOUT_MS are untouched", () => {
  assert.strictEqual(B.FRONTIER_MAX_TOKENS, 64000);
  assert.strictEqual(B.GEN_TIMEOUT_MS, 120000);
});

btest("W3 [P1]: the shipped fn-gen config still carries both terms of the window", () => {
  assert.strictEqual(B.DEFAULT_FNGEN_CONFIG.numCtx, NUM_CTX);
  assert.strictEqual(B.DEFAULT_FNGEN_CONFIG.maxTokens, MAX_TOKENS);
});

btest("W4 [P1]: the class split arbitration keys off still answers frontier for a cloud provider", () => {
  assert.strictEqual(B.modelClassFor("anthropic", "claude-x"), "frontier");
  assert.strictEqual(B.modelClassFor("openai", "gpt-x"), "frontier");
  assert.notStrictEqual(B.modelClassFor("ollama", "qwen3-coder:30b"), "frontier", "a local tag is not frontier");
});

// ===========================================================================
// P7 / P3 rung 2. Nothing changes when nothing is tight.
// ===========================================================================

btest("N1 [P7, P3.2]: a prompt that fits is handed to the model byte-identical to today's assembly", async () => {
  const blocks = devBlocks(1, 2000);
  const surface = injSurface(10);
  const r = await runGen(localCfg(), req({ contextBlocks: blocks, injectedSurface: surface }));
  assert.ok(r.called, "a fitting prompt reaches the model");
  const expected = todaysPrompt({ contextBlocks: blocks, injectedSurface: surface });
  assert.ok(expected.length <= AVAILABLE_CHARS, `fixture bug: the fitting case must fit (${expected.length} chars)`);
  assert.strictEqual(r.prompt, expected, "P7: byte-identical to today's prompt");
});

btest("N2 [P7]: a prompt that fits adds no channel line", async () => {
  const blocks = devBlocks(1, 2000);
  const r = await runGen(localCfg(), req({ contextBlocks: blocks, injectedSurface: injSurface(10) }));
  assert.deepStrictEqual(newLines(r.logs), [], `P7: no arbitration line for a prompt that fits, got ${JSON.stringify(r.logs)}`);
});

btest("N3 [P3.2, must not change]: context blocks stay budget-exempt - a big-but-fitting context does not cost the developer any injection", async () => {
  const surface = injSurface(20);
  const small = await runGen(localCfg(), req({ contextBlocks: devBlocks(1, 500), injectedSurface: surface }));
  const big = await runGen(localCfg(), req({ contextBlocks: devBlocks(4, 5000), injectedSurface: surface }));
  assert.ok(small.called && big.called, "both fit, so both reach the model");
  assert.strictEqual(injCount(big.prompt), injCount(small.prompt), "adding context must not remove injected types while the total still fits");
  assert.strictEqual(injCount(big.prompt), injCount(surface), "the whole injected surface survives");
});

// ===========================================================================
// P2. The estimate is conservative: it may over-estimate, it must never
// under-estimate and let a truncation through.
// ===========================================================================

btest("E1 [P2]: no prompt the model is ever handed exceeds the window on the contract's own chars/4 proxy", async () => {
  const sizes = [5, 20, 60, 120, 260, 500];
  let accepted = 0;
  for (const n of sizes) {
    const r = await runGen(localCfg(), req({ contextBlocks: devBlocks(1, 4000), injectedSurface: injSurface(n) }));
    if (!r.called) continue;
    accepted++;
    const est = Math.ceil(r.prompt.length / 4);
    assert.ok(
      est <= AVAILABLE,
      `P2: an accepted prompt estimates ${est} tokens against a window of ${AVAILABLE} (injected blocks=${n}, ${r.prompt.length} chars). ` +
        `Under-estimating is the one direction the contract forbids: ollama truncates the HEAD and nothing says so.`,
    );
  }
  assert.ok(accepted > 0, "not vacuous: at least one size must be accepted, or the product refuses everything");
});

btest("E2 [P2]: the smallest case is accepted, so E1 cannot pass by refusing everything", async () => {
  const r = await runGen(localCfg(), req({ contextBlocks: devBlocks(1, 4000), injectedSurface: injSurface(5) }));
  assert.ok(r.called, "a small prompt must still reach the model");
});

// ===========================================================================
// P3 rung 3. Over the line, ONLY the injected surface gives.
// ===========================================================================

btest("S1 [P3.3]: a prompt over the line still reaches the model - shrink, not refusal, while zero injection would fit", async () => {
  const blocks = devBlocks(4, 4000); // ~16k chars, ~4k tokens: nowhere near the window on its own
  const r = await runGen(localCfg(), req({ contextBlocks: blocks, injectedSurface: injSurface(300) }));
  assert.ok(r.called, "P3.3: the ladder shrinks before it refuses - at zero injection this prompt fits easily");
});

btest("S2 [P3.3]: the shrink cuts the injected surface and nothing else", async () => {
  const blocks = devBlocks(4, 4000);
  const surface = injSurface(300);
  const r = await runGen(localCfg(), req({ contextBlocks: blocks, injectedSurface: surface }));
  assert.ok(r.called, "precondition: this case shrinks rather than refuses");
  assert.ok(injCount(surface) === 300, "fixture bug: the surface must carry 300 countable types");
  assert.ok(injCount(r.prompt) < 300, `P3.3: the injected surface must shrink (still ${injCount(r.prompt)} of 300 types)`);
  assert.ok(Math.ceil(r.prompt.length / 4) <= AVAILABLE, "P3.3: shrink 'until the total fits'");
  for (let i = 0; i < blocks.length; i++) {
    assert.ok(r.prompt.includes(devSentinel(i)), `P3.3: developer block ${i} must survive the shrink untouched`);
  }
});

btest("S3 [P3.3]: every byte of every developer block survives a shrink, not just its sentinel", async () => {
  const blocks = devBlocks(4, 4000);
  const r = await runGen(localCfg(), req({ contextBlocks: blocks, injectedSurface: injSurface(300) }));
  assert.ok(r.called, "precondition: this case shrinks rather than refuses");
  for (const b of blocks) {
    assert.ok(r.prompt.includes(b.text.trim()), `P3.3: the developer's block text is never trimmed (${b.uri})`);
  }
});

// ===========================================================================
// THE CENTREPIECE. The load-bearing asymmetry: developer context is never
// shrunk and never dropped, at any size, even when it alone breaks the budget.
// The human's ruling, in test form.
// ===========================================================================

btest("A1 [the ruling]: when shrinking the developer's blocks is the ONLY thing that would make it fit, the product refuses instead", async () => {
  // 58,000 chars of context = ~14,500 tokens against a 14,336 window, with
  // ZERO injection. Trimming ~2% off the developer's own blocks would fit.
  // The contract forbids that: theirs shrinks nothing, and ours is already 0.
  const blocks = devBlocks(29, 2000);
  const total = blocks.reduce((n, b) => n + b.text.length, 0);
  assert.ok(total > AVAILABLE_CHARS, `fixture bug: developer context must exceed the window on its own (${total} chars vs ${AVAILABLE_CHARS})`);
  assert.ok(total < AVAILABLE_CHARS * 1.1, "fixture bug: a small trim of THEIR bytes would have fitted, which is the point of this row");
  const r = await runGen(localCfg(), req({ contextBlocks: blocks }));
  assert.ok(!r.called, "P3.4: refuse, do not shrink the developer's blocks to make room");
});

btest("A2 [the ruling]: the developer's blocks are never dropped either - a refusal is not 'silently send it without their context'", async () => {
  const blocks = devBlocks(29, 2000);
  const r = await runGen(localCfg(), req({ contextBlocks: blocks }));
  if (r.called) {
    for (let i = 0; i < blocks.length; i++) {
      assert.ok(r.prompt.includes(devSentinel(i)), `a developer block was dropped to make the prompt fit (block ${i})`);
    }
    assert.fail("P3.4: with zero injection and the context alone over the window, the only contract-legal outcome is a refusal");
  }
});

btest("A3 [the ruling]: at any size, no accepted prompt has lost a developer block", async () => {
  for (const [n, chars] of [[1, 500], [4, 4000], [10, 4000], [20, 2000], [29, 2000], [40, 4000]]) {
    const blocks = devBlocks(n, chars);
    const r = await runGen(localCfg(), req({ contextBlocks: blocks, injectedSurface: injSurface(200) }));
    if (!r.called) continue;
    for (let i = 0; i < n; i++) {
      assert.ok(r.prompt.includes(devSentinel(i)), `developer block ${i} of ${n} (${chars} chars each) vanished from an accepted prompt`);
    }
  }
});

// ===========================================================================
// P3 rung 4 + P4. What a refusal is - four separate assertions, because a
// refusal that quietly still called the model is the worst possible outcome.
// ===========================================================================

const REFUSE_BLOCKS = devBlocks(20, 4000); // 80k chars = ~20k tokens, no injection
const refuseRun = () => runGen(localCfg(), req({ contextBlocks: REFUSE_BLOCKS }));

btest("R1 [P4]: a refusal makes NO model call", async () => {
  const r = await refuseRun();
  assert.strictEqual(r.calls.length, 0, "P4: no model call. Calling anyway is the silent-truncation defect with extra steps.");
});

btest("R2 [P4]: a refusal produces no generated text, so there is nothing to write to the buffer", async () => {
  const r = await refuseRun();
  const text = r.result && typeof r.result === "object" ? r.result.text : r.result;
  assert.ok(!text, `P4: no buffer write, no proposal, no ghost - got ${JSON.stringify(text)}`);
});

btest("R3 [P4]: a refusal surfaces a user-visible message in the product's refusal voice", async () => {
  const r = await refuseRun();
  const hit = r.surfaced.find((s) => /Column 80/.test(s));
  assert.ok(
    hit,
    `P4: a user-visible 'Column 80: ...' message must be carried back to the caller (thrown or returned), not left on the channel. ` +
      `Surfaced strings: ${JSON.stringify(r.surfaced.slice(0, 6))}`,
  );
});

btest("R4 [P4]: a refusal writes a channel line carrying the same numbers", async () => {
  const r = await refuseRun();
  const hit = r.logs.find((l) => /refus|does not fit|too large|too big|over the window/i.test(l) && /\d/.test(l));
  assert.ok(hit, `P4: a channel line with the numbers, got ${JSON.stringify(r.logs)}`);
  assert.match(hit, new RegExp(String(AVAILABLE)), `P4: the channel line states the window it measured against`);
});

// ===========================================================================
// P5. The honest breakdown, with teeth.
// ===========================================================================

const refuseMessage = async () => {
  const r = await refuseRun();
  const msg = r.surfaced.find((s) => /Column 80/.test(s)) || r.surfaced.sort((a, b) => b.length - a.length)[0] || "";
  return { r, msg };
};

btest("P5a: the message states the estimated total and the window it is measured against", async () => {
  const { msg } = await refuseMessage();
  assert.ok(msg, "no message to inspect");
  assert.match(msg, new RegExp(String(AVAILABLE)), `P5: the window (${AVAILABLE}) must appear: ${JSON.stringify(msg)}`);
  const nums = (msg.match(/\d[\d,]*/g) || []).map((s) => Number(s.replace(/,/g, "")));
  assert.ok(nums.some((n) => n > AVAILABLE), `P5: the estimated total must appear and it is larger than the window: ${JSON.stringify(msg)}`);
});

btest("P5b: the message states how much of the total is the developer's own added context", async () => {
  const { msg } = await refuseMessage();
  assert.match(msg, /context|blocks|you added|your/i, `P5: the developer's share must be named: ${JSON.stringify(msg)}`);
});

btest("P5c [the honesty constraint]: the message states the PRODUCT's own injected share - and says so even though it is zero", async () => {
  const { msg } = await refuseMessage();
  assert.match(
    msg,
    /inject/i,
    `P5: a refusal message without the product's own injected share is a DEFECT by the contract - it blames the developer for our bytes: ${JSON.stringify(msg)}`,
  );
  assert.match(
    msg,
    /inject[^\n]{0,80}\b0\b|\b0\b[^\n]{0,80}inject/i,
    `P5: at refusal time our share is 0 and the message must SAY 0 rather than omit the line - ` +
      `"we already dropped all of ours" is exactly the fact that makes the refusal fair: ${JSON.stringify(msg)}`,
  );
});

btest("P5d: the message says what the developer can do - remove context blocks, or lower column80.injectedContext", async () => {
  const { msg } = await refuseMessage();
  assert.match(msg, /remove|delete|drop/i, `P5: "remove context blocks" must be offered: ${JSON.stringify(msg)}`);
  assert.match(msg, /column80\.injectedContext/, `P5: the setting must be named: ${JSON.stringify(msg)}`);
});

btest("P5f [P2]: the message states its numbers as approximate, because chars/4 is a proxy", async () => {
  const { msg } = await refuseMessage();
  assert.ok(msg, "no message to inspect");
  assert.match(
    msg,
    /~|≈|about|approx|estimat|roughly|around/i,
    `P2: "the estimate is stated as approximate wherever it is shown to a human": ${JSON.stringify(msg)}`,
  );
});

btest("P5e: the channel line carries the same breakdown as the message, including our own share", async () => {
  const r = await refuseRun();
  const line = r.logs.find((l) => /refus|does not fit|too large|too big|over the window/i.test(l)) || "";
  assert.ok(line, `P4/P5: no refusal channel line in ${JSON.stringify(r.logs)}`);
  assert.match(line, new RegExp(String(AVAILABLE)), "the channel line states the window");
  assert.match(line, /inject/i, "the channel line states the product's own injected share");
});

// ===========================================================================
// P6. A shrink is visible.
// ===========================================================================

btest("P6a: a shrink is announced on the channel", async () => {
  const r = await runGen(localCfg(), req({ contextBlocks: devBlocks(4, 4000), injectedSurface: injSurface(300) }));
  assert.ok(r.called, "precondition: this case shrinks rather than refuses");
  const line = r.logs.find((l) => /shrink|shrunk|shrank|cut|dropped|reduced/i.test(l) && /inject|surface|type/i.test(l));
  assert.ok(line, `P6: a silent shrink is the same class of defect as a silent truncation. Logs: ${JSON.stringify(r.logs)}`);
});

btest("P6b: the shrink line carries the before and after counts", async () => {
  const r = await runGen(localCfg(), req({ contextBlocks: devBlocks(4, 4000), injectedSurface: injSurface(300) }));
  const line = r.logs.find((l) => /shrink|shrunk|shrank|cut|dropped|reduced/i.test(l) && /inject|surface|type/i.test(l)) || "";
  assert.ok(line, "no shrink line to inspect");
  const nums = (line.match(/\d+/g) || []).length;
  assert.ok(nums >= 2, `P6: "from what to what" needs two counts, got ${JSON.stringify(line)}`);
});

btest("P6c: the shrink line says the developer's context was preserved", async () => {
  const r = await runGen(localCfg(), req({ contextBlocks: devBlocks(4, 4000), injectedSurface: injSurface(300) }));
  const line = r.logs.find((l) => /preserv|kept|untouched|intact|unchanged|never/i.test(l) && /context|developer|your|block/i.test(l)) || "";
  assert.ok(line, `P6: the line must say the developer's context was preserved. Logs: ${JSON.stringify(r.logs)}`);
});

// ===========================================================================
// P1, the frontier leg. The whole path is skipped: no estimate, no shrink, no
// refusal, prompt assembled exactly as today.
// ===========================================================================

btest("F1 [P1]: a frontier config is exempt - a prompt far past the local window is still handed to the model, byte-identical", async () => {
  const blocks = devBlocks(20, 4000);
  const surface = injSurface(300);
  const r = await runGen(
    localCfg({ provider: "anthropic", model: "claude-sonnet-4", maxTokens: 64000, numCtx: undefined }),
    req({ contextBlocks: blocks, injectedSurface: surface }),
  );
  assert.ok(r.called, "P1: no local window means nothing to arbitrate - no refusal is possible");
  assert.strictEqual(r.prompt, todaysPrompt({ contextBlocks: blocks, injectedSurface: surface }), "P1: 'assembled exactly as it is today'");
});

btest("F2 [P1]: a frontier config adds no arbitration channel line", async () => {
  const r = await runGen(
    localCfg({ provider: "anthropic", model: "claude-sonnet-4", maxTokens: 64000, numCtx: undefined }),
    req({ contextBlocks: devBlocks(20, 4000), injectedSurface: injSurface(300) }),
  );
  assert.deepStrictEqual(newLines(r.logs), [], `P1: no estimate is taken on the frontier path, got ${JSON.stringify(r.logs)}`);
});

btest("F3 [P1]: the frontier output ceiling is never subtracted from a local window - a small prompt is not refused by 16384 - 64000", async () => {
  const r = await runGen(localCfg({ maxTokens: B.FRONTIER_MAX_TOKENS, numCtx: undefined }), req({ contextBlocks: devBlocks(1, 500) }));
  assert.ok(r.called, "an arbitration that computes numCtx - FRONTIER_MAX_TOKENS refuses every prompt at a negative window");
});

// ===========================================================================
// Phase 3 / P8. The dropped edges.
// ===========================================================================

btest("D1 [P8]: walkDataShape records the names a cap dropped, and they never overlap what it emitted", () => {
  const BOUNDS = { D_MAX: 2, B_MAX: 4, N_MAX: 6, TOK_MAX: 200 };
  const map = new Map();
  const kids = Array.from({ length: 20 }, (_, i) => `Kid${String(i).padStart(2, "0")}`);
  map.set("Root", {
    def: "<<STRUCTDEF Root>> pub struct Root { " + kids.map((k, i) => `f${i}: ${k}`).join(", ") + " }",
    fields: kids.map((k, i) => ({ name: `f${i}`, typeName: k, isLocal: true })),
  });
  for (const k of kids) {
    map.set(k, { def: `<<STRUCTDEF ${k}>> pub struct ${k} { slot: u32, label: String }`, fields: [] });
  }
  const resolveStruct = (t) => map.get(t);
  const out = B.walkDataShape("Root", resolveStruct, BOUNDS);
  const block = String(out.block ?? out.text ?? "");
  const dropped = out.dropped ?? [];
  const emitted = (block.match(/<<STRUCTDEF ([A-Za-z0-9_]+)>>/g) || []).map((m) => m.replace(/<<STRUCTDEF |>>/g, ""));
  assert.ok(Array.isArray(dropped), "WalkResult.dropped is the list P8 puts on the channel");
  assert.ok(dropped.length > 0, "fixture bug: a 20-wide graph against B_MAX=4/N_MAX=6 must drop something");
  for (const d of dropped) {
    assert.ok(!emitted.includes(d), `P8: dropped is 'guaranteed not to overlap what was emitted', but ${d} is in both`);
  }
});

// --- The fn-gen channel. Real prefill over a vscode stub, one language.

function makeDoc(text, uriStr) {
  const lines = text.split("\n");
  const offsetAt = (p) => {
    let o = 0;
    for (let i = 0; i < Math.min(p.line, lines.length); i++) o += lines[i].length + 1;
    return Math.min(o + p.character, text.length);
  };
  const positionAt = (off) => {
    let o = 0;
    for (let l = 0; l < lines.length; l++) {
      if (off <= o + lines[l].length) return new V.Position(l, off - o);
      o += lines[l].length + 1;
    }
    return new V.Position(lines.length - 1, 0);
  };
  return { uri: { toString: () => uriStr }, offsetAt, positionAt, getText: (r) => (r ? text.slice(offsetAt(r.start), offsetAt(r.end)) : text) };
}

const wordAt = (text, cursor) => {
  const line = (text || "").split("\n")[cursor.line] ?? "";
  const isWord = (c) => /[A-Za-z0-9_]/.test(c);
  let s = Math.min(cursor.character, line.length);
  let e = s;
  while (s > 0 && isWord(line[s - 1])) s--;
  while (e < line.length && isWord(line[e])) e++;
  return line.slice(s, e) || undefined;
};

function makeExtractor(files, defTypes) {
  const known = new Set(Object.keys(defTypes));
  const typeAtCursor = (uri, cursor) => {
    const text = files[uri];
    if (text === undefined) return undefined;
    const w = wordAt(text, cursor);
    if (w && known.has(w)) return w;
    const line = text.split("\n")[cursor.line] ?? "";
    const on = [...known].filter((t) => new RegExp(`\\b${t}\\b`).test(line));
    return on.length === 1 ? on[0] : undefined;
  };
  const defLocFor = (t) => {
    const uri = defTypes[t].uri;
    const lines = (files[uri] || "").split("\n");
    const ln = lines.findIndex((l) => new RegExp(`\\b${t}\\b`).test(l));
    if (ln < 0) return undefined;
    const ch = lines[ln].indexOf(t);
    return { uri, range: { startLine: ln, startCharacter: ch, endLine: ln, endCharacter: ch + t.length } };
  };
  return {
    definition: async (c) => {
      const t = typeAtCursor(c.uri, c);
      return t ? defLocFor(t) : undefined;
    },
    hoverSurface: async (c) => {
      const t = typeAtCursor(c.uri, c);
      const h = t ? defTypes[t].hover : undefined;
      return h ? { signature: h } : undefined;
    },
    membersOfType: async () => [],
    example: async () => undefined,
    completeMembers: async () => [],
    qualifyImport: async () => undefined,
  };
}

const WS = "file:///work/v48p8";

async function runPrefill(nSubs) {
  const subs = Array.from({ length: nSubs }, (_, i) => `Sub${String(i).padStart(2, "0")}`);
  const rootDef = `pub struct Root {\n${subs.map((s, i) => `    pub field_${i}: ${s},`).join("\n")}\n}\n`;
  const files = {};
  const defTypes = {};
  const rootUri = `${WS}/root.rs`;
  files[rootUri] = rootDef;
  defTypes["Root"] = { uri: rootUri, hover: rootDef.trim() };
  for (const s of subs) {
    const u = `${WS}/${s.toLowerCase()}.rs`;
    files[u] = `pub struct ${s} { pub slot_number_field: u32, pub label_for_the_slot: String }\n`;
    defTypes[s] = { uri: u, hover: `pub struct ${s} {\n    pub slot_number_field: u32,\n    pub label_for_the_slot: String,\n}` };
  }
  const mainUri = `${WS}/main.rs`;
  const signature = "pub fn build(p0: Root) -> u32";
  const src = `/// Build the thing.\n${signature} {\n    todo!()\n}\n`;
  files[mainUri] = src;
  const start = src.indexOf(signature);
  const record = {
    span: { start, end: src.length - 1 },
    signature,
    docComment: "Build the thing.",
    symbolName: "build",
    languageId: "rust",
    kind: "function",
    bodyOnly: false,
    headerIndent: "",
    bodyIndent: "    ",
    docstringRefusal: undefined,
  };
  const logs = [];
  globalThis.__V48P2_FILES__ = files;
  let out;
  try {
    out = await B.resolvePrefill(makeExtractor(files, defTypes), makeDoc(src, mainUri), record, (l) => logs.push(String(l)));
  } finally {
    delete globalThis.__V48P2_FILES__;
  }
  return { text: out || "", logs, subs };
}

// A prefill run is a few seconds, so the two readings of P8 share one.
const prefillCache = new Map();
const prefillOnce = (n) => {
  if (!prefillCache.has(n)) prefillCache.set(n, runPrefill(n));
  return prefillCache.get(n);
};

btest("D2 [P8]: the names a cap dropped entirely reach the fn-gen channel", async () => {
  const r = await prefillOnce(30);
  assert.ok(r.text.includes("pub struct Root"), `fixture bug: the walk must have run and injected something. Payload: ${JSON.stringify(r.text.slice(0, 200))}`);
  const line = r.logs.find((l) => /drop/i.test(l));
  assert.ok(line, `P8: a stop that starves the model must be visible, not inferred. Logs: ${JSON.stringify(r.logs)}`);
  const named = r.subs.filter((s) => line.includes(s));
  assert.ok(named.length > 0, `P8: "Name the types" - the line names none of ${r.subs.length} candidates: ${JSON.stringify(line)}`);
  assert.match(line, /walk|shape|cap|budget|breadth|type/i, `P8: "say what dropped them": ${JSON.stringify(line)}`);
});

// D2 takes the lenient reading of P8's "say what dropped them" (name the
// mechanism). D4 takes the strict one - name the CAP, which is the only reading
// that makes the dial legible: "one who sees eleven names knows exactly what
// raising it buys" only holds if the line says WHICH stop did the dropping.
// The clause is ambiguous; both readings get a row rather than a softened one.
btest("D4 [P8, strict reading]: the dropped line names the cap that dropped them, not just the walk", async () => {
  const r = await prefillOnce(30);
  const line = r.logs.find((l) => /drop/i.test(l)) || "";
  assert.ok(line, "no dropped line to inspect");
  assert.match(
    line,
    /breadth|width|per-type|total types|type cap|token budget|budget|cap|stop/i,
    `P8: "say what dropped them" - a developer cannot tell which stop to raise from ${JSON.stringify(line)}`,
  );
});

btest("D3 [P8]: a walk that dropped nothing adds no line - empty stays silent", async () => {
  const r = await prefillOnce(2);
  assert.ok(r.text.includes("pub struct Sub00"), `fixture bug: a 2-wide walk must emit both subs. Payload: ${JSON.stringify(r.text.slice(0, 300))}`);
  const line = r.logs.find((l) => /drop/i.test(l));
  assert.strictEqual(line, undefined, `P8: "Empty stays silent" - a developer on 'small' whose channel says nothing must be able to trust it. Got ${JSON.stringify(line)}`);
});

// ===========================================================================
// What must NOT change: the FIM path never runs any of this.
// ===========================================================================

btest("X1 [must not change]: nothing in the fn-gen refusal path leaks into a prompt the FIM path would build", async () => {
  // The FIM path has no context blocks and no injected surface; the fn-gen
  // assembler is the only thing this phase may touch. A bare fn-gen request
  // with neither must be byte-identical to today's, which is the same shape a
  // FIM-adjacent gesture produces.
  const r = await runGen(localCfg(), req({}));
  assert.ok(r.called, "a bare request is never refused");
  assert.strictEqual(r.prompt, todaysPrompt({}), "the bare prompt is untouched");
  assert.deepStrictEqual(newLines(r.logs), [], `no arbitration line on a bare request, got ${JSON.stringify(r.logs)}`);
});
