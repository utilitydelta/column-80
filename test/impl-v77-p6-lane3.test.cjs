"use strict";

// session-v77 phase 6, lane 3, row R2 (goal.md Amendment 3, S77-26 #2). The re-wrap needs no
// model, so a closed tier no longer refuses Tighten Doc Comment: the command re-wraps, skips the
// proposer, and the review says type names need function generation. Each row drives the
// registered command through the shared activation stub.
//
// Run: node --test test/impl-v77-p6-lane3.test.cjs

const test = require("node:test");
const assert = require("node:assert/strict");
const { bundleActivation } = require("./.activation-stub.cjs");

const built = bundleActivation(
  "impl-v77-p6-lane3",
  `export { registerTightenDocComment } from "../src/vscode/tightenDocComment";\n`,
);
const B = built.mod;
const { __state, Position } = B;
test.after(() => built.cleanup());

const NOTE = "type names need function generation, which is off";
const TIER_MESSAGE = "Function generation is disabled: no usable GPU detected. It needs at least 12GB of VRAM.";

function makeDoc(text) {
  const lines = text.split("\n");
  const offsetAt = (p) => {
    let o = 0;
    for (let i = 0; i < Math.min(p.line, lines.length); i++) o += lines[i].length + 1;
    return Math.min(o + p.character, text.length);
  };
  const positionAt = (off) => {
    let o = 0;
    for (let l = 0; l < lines.length; l++) {
      if (off <= o + lines[l].length) return new Position(l, off - o);
      o += lines[l].length + 1;
    }
    return new Position(lines.length - 1, 0);
  };
  const uri = "file:///w/v77/walk.ts";
  return {
    languageId: "typescript",
    version: 1,
    isClosed: false,
    eol: 1,
    lineCount: lines.length,
    uri: { toString: () => uri, fsPath: "/w/v77/walk.ts", path: "/w/v77/walk.ts", scheme: "file" },
    offsetAt,
    positionAt,
    getText: (r) => (r ? text.slice(offsetAt(r.start), offsetAt(r.end)) : text),
    lineAt: (l) => ({ text: lines[typeof l === "number" ? l : l.line] ?? "" }),
  };
}

// 112 columns: the re-wrap alone changes it.
const LONG =
  "// this walker keeps a shard mem cache for each of the client sets and drops every entry it can prove is stale\n" +
  "export function walk() {}\n";
const WRAPPED = "// keeps the cache\nexport function walk() {}\n";

async function press({ text, gate, args }) {
  __state.messages = [];
  __state.commands = {};
  const lines = [];
  const calls = { transport: 0, reviews: [], edits: [] };
  const wiring = {
    presenter: { confirmDiff: async () => "accept" },
    resolveFunction: async () => undefined,
    resolvePrefill: async () => undefined,
    prefillLangFor: () => ({ localTypeDefs: () => new Map(), typeReference: () => undefined }),
    extractorFor: () => undefined,
    transport: () => {
      calls.transport++;
      return async () => ({ text: "shard mem cache\n" });
    },
    modelTag: () => "test-model",
    tierGate: async () => gate,
    tierMessage: () => TIER_MESSAGE,
  };
  const deps = {
    querySymbols: async () => [],
    fileExists: () => false,
    readFile: () => undefined,
    workspaceRoot: () => "/w",
    config: () => ({ apiBase: "http://127.0.0.1:1/", model: "m", fallbackModel: "m", maxTokens: 2048, temperature: 0, numCtx: 16384 }),
    windowed: () => true,
    review: async (r) => {
      calls.reviews.push(r);
      return [];
    },
    applyEdit: async (_doc, start, end, replacement) => {
      calls.edits.push({ start, end, replacement });
      return true;
    },
  };
  B.registerTightenDocComment({ subscriptions: [] }, { appendLine: (l) => lines.push(String(l)) }, wiring, deps);
  __state.activeTextEditor = { document: makeDoc(text), selection: { active: new Position(0, 4) }, options: { tabSize: 4 } };
  try {
    await (args === undefined ? __state.commands["column80.tightenDocComment"]() : __state.commands["column80.tightenDocComment"](args));
  } finally {
    __state.activeTextEditor = undefined;
  }
  const warns = __state.messages.filter((m) => m.kind === "warn").map((m) => m.message);
  return { lines, warns, ...calls };
}

const CLOSED = { allowed: false, reason: "tier-disabled" };

test("R2: on a closed tier, Tighten re-wraps an over-long comment and never reads the transport", async () => {
  const got = await press({ text: LONG, gate: CLOSED });
  assert.deepEqual(got.warns, [], `a closed tier refused the re-wrap: ${JSON.stringify(got.warns)}`);
  assert.equal(got.transport, 0, "the proposer ran on a closed tier");
  assert.equal(got.reviews.length, 1, `no review opened:\n${got.lines.join("\n")}`);
  assert.equal(got.reviews[0].rewraps, true);
  assert.equal(got.edits.length, 1, "the accepted re-wrap was not written");
  assert.ok(got.edits[0].replacement.split("\n").every((l) => l.length <= 80), got.edits[0].replacement);
});

test("R2: the closed-tier review says type names need function generation", async () => {
  const got = await press({ text: LONG, gate: CLOSED });
  assert.ok(got.reviews[0]?.notes.includes(NOTE), `notes: ${JSON.stringify(got.reviews[0]?.notes)}`);
});

test("R2: the channel keeps the tier's recorded reason", async () => {
  const got = await press({ text: LONG, gate: CLOSED });
  assert.ok(got.lines.some((l) => l.startsWith("[tighten]") && l.includes(TIER_MESSAGE)), got.lines.join("\n"));
});

test("R2 control: an open tier runs the proposer and shows no generation-off note", async () => {
  const got = await press({ text: LONG, gate: { allowed: true } });
  assert.equal(got.transport, 1);
  assert.ok(!got.reviews[0].notes.includes(NOTE), JSON.stringify(got.reviews[0].notes));
});

test("R2: on a closed tier, an already-wrapped comment warns once, and does not claim it checked for type names", async () => {
  const got = await press({ text: WRAPPED, gate: CLOSED });
  assert.equal(got.warns.length, 1, JSON.stringify(got.warns));
  assert.match(got.warns[0], /^Column 80: nothing to tighten\./);
  assert.ok(!/names no type to mark/.test(got.warns[0]), got.warns[0]);
  assert.ok(got.warns[0].includes(NOTE), got.warns[0]);
});

test("R2: Tighten handed off by dictation on a closed tier still opens the re-wrap review", async () => {
  const got = await press({ text: LONG, gate: CLOSED, args: { source: "dictation" } });
  assert.deepEqual(got.warns, []);
  assert.equal(got.reviews.length, 1);
  assert.equal(got.transport, 0);
});

test("R2 unchanged: an unresolved tier still refuses and names Select Hardware Tier", async () => {
  const got = await press({ text: LONG, gate: { allowed: false, reason: "tier-unresolved" } });
  assert.equal(got.reviews.length, 0);
  assert.equal(got.warns.length, 1);
  assert.match(got.warns[0], /Select Hardware Tier/);
});
