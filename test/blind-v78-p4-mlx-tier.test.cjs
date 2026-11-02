// Blind oracle, session-v78 phase 4: the MLX tag on Apple Silicon.
// Binding contract: session-v78/contract-p4.md (goal.md Part B).
//
// Black-box. Drives the public seams only: computeTier/applyTier/TIER_TABLE in
// core, and resolveTier/runFirstRunFlow in the vscode layer behind a stub vscode
// (the same stub shape test/impl5-vscode.test.cjs uses). Fallback behaviour is
// asserted at the existing seams - pull calls, [carve] channel lines, the
// notifications shown - and never through an internal name the contract leaves
// open.
//
// Run: node --test test/blind-v78-p4-mlx-tier.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");

const MLX = "qwen3.8:27b-mlx";
const GGUF = "qwen3.8:27b";
const MODEL_14B = "qwen2.5-coder:14b-instruct-q4_K_M";
const MODEL_30B = "qwen3-coder:30b";
const FIM_MODEL = "qwen2.5-coder:1.5b-base";
const MB = 1048576;

// A bare GGUF mention: the 27b tag not followed by "-mlx".
const BARE_GGUF = /qwen3\.8:27b(?!-mlx)/;

// ---- bundle: core + vscode layer against a stub vscode

const STUB = path.join(__dirname, ".blind-v78-p4-stub.cjs");
fs.writeFileSync(
  STUB,
  `
const state = {
  config: {},
  configInfo: {},
  updates: [],
  messages: [],
  // A policy, not a queue: (kind, message, actions) => choice. The contract
  // does not fix how many prompts a fallback takes or what the button says.
  respond: () => undefined,
  quickPickImpl: null,
  commands: {},
  terminals: [],
};
class EventEmitter {
  constructor() { this.handlers = []; }
  get event() { return (fn) => { this.handlers.push(fn); return { dispose() {} }; }; }
  fire(x) { for (const h of this.handlers) h(x); }
  dispose() {}
}
const show = (kind) => async (message, ...actions) => {
  const items = actions.filter((a) => typeof a === "string" || (a && typeof a.title === "string"));
  state.messages.push({ kind, message, actions: items });
  return state.respond(kind, message, items);
};
module.exports = {
  __state: state,
  EventEmitter,
  ProgressLocation: { Notification: 15 },
  ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
  SymbolKind: { Function: 11, Method: 5, Constructor: 8 },
  ThemeColor: class { constructor(id) { this.id = id; } },
  workspace: {
    getConfiguration: () => ({
      get: (key, fallback) => (key in state.config ? state.config[key] : fallback),
      inspect: (key) => state.configInfo[key],
      update: async (key, value, target) => { state.updates.push({ key, value, target }); state.config[key] = value; },
    }),
    onDidChangeConfiguration: () => ({ dispose() {} }),
    registerTextDocumentContentProvider: () => ({ dispose() {} }),
  },
  window: {
    showInformationMessage: show("info"),
    showWarningMessage: show("warn"),
    showErrorMessage: show("error"),
    showQuickPick: async (items, opts) => (state.quickPickImpl ? state.quickPickImpl(items, opts) : undefined),
    withProgress: async (opts, task) =>
      task({ report: () => {} }, { onCancellationRequested: () => ({ dispose() {} }) }),
    createTerminal: (opts) => {
      const t = { name: opts.name, shown: false, sent: [], show() { this.shown = true; }, sendText(s) { this.sent.push(s); } };
      state.terminals.push(t);
      return t;
    },
    get terminals() { return state.terminals; },
    tabGroups: { all: [], onDidChangeTabs: () => ({ dispose() {} }), close: async () => {} },
  },
  commands: {
    registerCommand: (id, fn) => { state.commands[id] = fn; return { dispose() {} }; },
  },
  env: {
    openExternal: async (uri) => true,
  },
  Uri: { parse: (s) => s },
};
`,
);

const entry = path.join(__dirname, ".blind-v78-p4.entry.ts");
const outfile = path.join(__dirname, ".blind-v78-p4.bundle.cjs");
fs.writeFileSync(
  entry,
  `export { computeTier, applyTier, TIER_TABLE } from "../src/core/tiers";
export { DEFAULT_FNGEN_CONFIG } from "../src/core/config";
export { runFirstRunFlow, resolveTier } from "../src/vscode/firstRun";
export { __state } from "vscode";\n`,
);
esbuild.buildSync({
  entryPoints: [entry],
  bundle: true,
  outfile,
  format: "cjs",
  platform: "node",
  alias: { vscode: STUB },
  logLevel: "silent",
});
const { computeTier, applyTier, TIER_TABLE, runFirstRunFlow, resolveTier, __state } = require(outfile);
test.after(() => {
  fs.rmSync(entry, { force: true });
  fs.rmSync(outfile, { force: true });
  fs.rmSync(STUB, { force: true });
});

// ---- shared helpers

const baseConfig = () => ({
  apiBase: "http://localhost:11434",
  model: MODEL_30B,
  fallbackModel: MODEL_14B,
  maxTokens: 512,
  temperature: 0.2,
});

const MAC_24 = () => computeTier(36864, 36864, { unifiedMemory: true });

const resetState = () => {
  __state.config = {};
  __state.configInfo = {};
  __state.updates = [];
  __state.messages = [];
  __state.respond = () => undefined;
  __state.quickPickImpl = async (items) => items[0]; // accept the detected default
  __state.commands = {};
  __state.terminals = [];
};

const output = () => {
  const lines = [];
  return { lines, appendLine: (l) => lines.push(l) };
};

const label = (a) => (typeof a === "string" ? a : a.title);
// Consent: click the download action on any offer. Picks the action that reads
// like a download; falls back to the first action.
const ACCEPT_DOWNLOADS = (kind, message, actions) => {
  if (actions.length === 0) return undefined;
  return actions.find((a) => /download|pull/i.test(label(a))) ?? actions[0];
};
const DECLINE_ALL = () => undefined;

const macProbe = (memMB = 36864) => ({
  platformInfo: () => ({ platform: "darwin", arch: "arm64" }),
  runCommand: async () => {
    throw new Error("nvidia-smi must not be spawned on Apple Silicon");
  },
  totalMemBytes: () => memMB * MB,
});
const cuda24Probe = () => ({
  runCommand: async () => ({ stdout: "24564\n", exitCode: 0 }),
  totalMemBytes: () => 61826 * MB,
  platformInfo: () => ({ platform: "linux", arch: "x64" }),
});

// Pull fake: per-model outcome; records every call.
const scriptedPull = (failures = {}) => {
  const calls = [];
  const pull = async (apiBase, model, signal, onProgress) => {
    calls.push(model);
    onProgress(undefined, "pulling manifest");
    if (failures[model]) throw failures[model];
    onProgress(1, "success");
  };
  return { calls, pull };
};

const fakeContext = () => {
  const store = {};
  return {
    subscriptions: [],
    globalState: {
      get: (k) => store[k],
      update: async (k, v) => {
        store[k] = v;
      },
    },
  };
};

const offeredModels = (out) =>
  out.lines
    .map((l) => /^\[carve\] pull offered model=(\S+)/.exec(l))
    .filter(Boolean)
    .map((m) => m[1]);
const pullLines = (out) => out.lines.filter((l) => l.startsWith("[carve] pull "));
const tierLine = (out) => out.lines.find((l) => l.startsWith("[carve] tier="));
const show = (out) => JSON.stringify(out.lines, null, 1);

// ---- rule 1: the table

test("rule 1: only the 24gb row carries an Apple Silicon tag, and it is the MLX build of its own model", () => {
  const rows = TIER_TABLE.map((r) => ({ id: r.id, gguf: r.fnGenModel, mlx: r.appleSiliconModel }));
  for (const r of rows) {
    if (r.id === "24gb") {
      assert.strictEqual(r.gguf, GGUF, "the row's GGUF tag is unchanged");
      assert.strictEqual(r.mlx, MLX, "row 24gb: the MLX tag");
    } else {
      assert.strictEqual(r.mlx, undefined, `row ${r.id}: no product model of this row has an MLX tag`);
    }
  }
});

// ---- rules 2-3: pure selection and fold, one table

const CASES = [
  {
    name: "Mac 36GB (24gb row): MLX tag, think false, no carve",
    sel: () => computeTier(36864, 36864, { unifiedMemory: true }),
    explicitModel: undefined,
    want: { id: "24gb", selModel: MLX, model: MLX, think: false },
  },
  {
    name: "Mac 24GB unified (24gb row, nominal 24 reports under): MLX tag",
    sel: () => computeTier(24576, 24576, { unifiedMemory: true }),
    explicitModel: undefined,
    want: { id: "24gb", selModel: MLX, model: MLX, think: false },
  },
  {
    name: "Mac 16GB (16gb-low-ram row): the 14b GGUF, no substitution",
    sel: () => computeTier(16384, 16384, { unifiedMemory: true }),
    explicitModel: undefined,
    want: { id: "16gb-low-ram", selModel: MODEL_14B, model: MODEL_14B, think: undefined },
  },
  {
    name: "CUDA 24GB, no flag: the GGUF tag",
    sel: () => computeTier(24576, 61826),
    explicitModel: undefined,
    want: { id: "24gb", selModel: GGUF, model: GGUF, think: false },
  },
  {
    name: "CUDA 24GB, unifiedMemory false: the GGUF tag",
    sel: () => computeTier(24576, 61826, { unifiedMemory: false }),
    explicitModel: undefined,
    want: { id: "24gb", selModel: GGUF, model: GGUF, think: false },
  },
  {
    name: "Mac 24gb, explicit foreign fnGenModel: the user's tag wins, no think, no carve",
    sel: MAC_24,
    explicitModel: "llama3.3:70b",
    want: { id: "24gb", selModel: MLX, model: "llama3.3:70b", think: undefined },
  },
  {
    // contract-p4 Amendment (S78-8): the GGUF fallback of the selected tag is the
    // same reasoning model, so the row's think:false follows it.
    name: "Mac 24gb, explicit fnGenModel = the GGUF fallback tag: wins, and gets think false (Amendment S78-8)",
    sel: MAC_24,
    explicitModel: GGUF,
    want: { id: "24gb", selModel: MLX, model: GGUF, think: false },
  },
  {
    name: "Mac 24gb, explicit fnGenModel = the MLX tag: equal to the selected tag, so think rides",
    sel: MAC_24,
    explicitModel: MLX,
    want: { id: "24gb", selModel: MLX, model: MLX, think: false },
  },
];

test("rules 2-3: computeTier substitutes on unified memory, and applyTier's tag rules follow the selected tag", async (t) => {
  for (const c of CASES) {
    await t.test(c.name, () => {
      const sel = c.sel();
      assert.strictEqual(sel.id, c.want.id, `${c.name}: tier id`);
      assert.strictEqual(sel.fnGenEnabled, true, `${c.name}: fn-gen enabled`);
      assert.strictEqual(sel.fnGenModel, c.want.selModel, `${c.name}: selected tag`);
      assert.ok(!("fnGenNumGpu" in sel) || c.name.startsWith("CUDA"), `${c.name}: no carve on unified memory`);

      const explicit = c.explicitModel !== undefined;
      const config = explicit ? { ...baseConfig(), model: c.explicitModel } : baseConfig();
      const out = applyTier(config, sel, explicit);
      assert.strictEqual(out.model, c.want.model, `${c.name}: effective model`);
      assert.ok(!("numGpu" in out), `${c.name}: no numGpu`);
      if (c.want.think === undefined) {
        assert.ok(!("think" in out), `${c.name}: think key absent, got ${JSON.stringify(out)}`);
      } else {
        assert.strictEqual(out.think, c.want.think, `${c.name}: think`);
      }
    });
  }
});

test("rule 2: the substituted selection keeps the key-absent discipline (no undefined-valued keys)", () => {
  const sel = MAC_24();
  for (const [k, v] of Object.entries(sel)) {
    assert.notStrictEqual(v, undefined, `key ${k} is present with value undefined`);
  }
  assert.strictEqual(sel.fnGenThink, false, "think false travels with the MLX tag on the selection");
});

// ---- rules 4 and 6: resolveTier, override and the evidence line

test("rule 4: hardwareTier override 24gb on a Mac selects the MLX tag (and think false rides it)", async () => {
  resetState();
  __state.config = { hardwareTier: "24gb" };
  const out = output();
  const { selection } = await resolveTier(out, macProbe());
  assert.strictEqual(selection.id, "24gb");
  assert.strictEqual(selection.fnGenModel, MLX, show(out));
  assert.ok(!("fnGenNumGpu" in selection), "no carve on a Mac");
  const folded = applyTier(baseConfig(), selection, false);
  assert.strictEqual(folded.model, MLX);
  assert.strictEqual(folded.think, false, "think false is the same model's flag, override or not");
  const line = tierLine(out);
  assert.match(line, /reason=override/);
  assert.match(line, /apple-silicon/, `the override line says apple-silicon when substituted: ${line}`);
  assert.ok(line.includes(MLX), `and names the tag: ${line}`);
});

test("rule 4: hardwareTier override 24gb on a CUDA box selects the GGUF tag, no apple-silicon word", async () => {
  resetState();
  __state.config = { hardwareTier: "24gb" };
  const out = output();
  const { selection } = await resolveTier(out, cuda24Probe());
  assert.strictEqual(selection.fnGenModel, GGUF);
  const line = tierLine(out);
  assert.doesNotMatch(line, /apple-silicon/, line);
  assert.doesNotMatch(line, /-mlx/, line);
});

test("rule 6: the auto [carve] tier line on a Mac 24gb says apple-silicon and names the MLX tag", async () => {
  resetState();
  const out = output();
  const { selection } = await resolveTier(out, macProbe());
  assert.strictEqual(selection.fnGenModel, MLX);
  const line = tierLine(out);
  assert.match(line, /^\[carve\] tier=24gb reason=auto /, line);
  assert.match(line, /apple-silicon/, line);
  assert.ok(line.includes(MLX), line);
});

test("rule 6: no substitution, no apple-silicon word - Mac 16GB and CUDA 24GB", async (t) => {
  for (const [name, probe, model] of [
    ["Mac 16GB", macProbe(16384), MODEL_14B],
    ["CUDA 24GB", cuda24Probe(), GGUF],
  ]) {
    await t.test(name, async () => {
      resetState();
      const out = output();
      const { selection } = await resolveTier(out, probe);
      assert.strictEqual(selection.fnGenModel, model, `${name}: model`);
      const line = tierLine(out);
      assert.doesNotMatch(line, /apple-silicon/, `${name}: ${line}`);
      assert.ok(line.includes(`fnGen=${model}`), `${name}: ${line}`);
    });
  }
});

// ---- rule 5: first run with an injected pull

test("rule 5: Mac, MLX pull FAILS -> the GGUF tag is offered once and lands; one line names the failed tag and why", async () => {
  resetState();
  __state.respond = ACCEPT_DOWNLOADS;
  const out = output();
  const why = "pull model manifest: this server cannot run MLX models";
  const { calls, pull } = scriptedPull({ [MLX]: new Error(why) });
  await runFirstRunFlow(fakeContext(), out, { probe: macProbe(), listModels: async () => [FIM_MODEL], pull });

  assert.deepStrictEqual(offeredModels(out), [MLX, GGUF], `MLX first, then GGUF exactly once: ${show(out)}`);
  assert.deepStrictEqual(calls, [MLX, GGUF], "one pull per consented offer, nothing silent");
  assert.ok(
    out.lines.some((l) => new RegExp(`^\\[carve\\] pull done model=${GGUF.replace(".", "\\.")} ms=\\d+$`).test(l)),
    `the GGUF landed: ${show(out)}`,
  );
  const failedLines = out.lines.filter((l) => l.includes(MLX) && l.includes(why));
  assert.strictEqual(failedLines.length, 1, `exactly one channel line names the failed MLX tag and why: ${show(out)}`);
  assert.ok(
    !out.lines.some((l) => l.startsWith("[carve] fn-gen disabled")),
    `fn-gen is not disabled once the GGUF landed: ${show(out)}`,
  );
  // One consent per download: two offers, two prompts, no third.
  const offers = __state.messages.filter((m) => m.actions.length > 0 && (m.message.includes(MLX) || BARE_GGUF.test(m.message)));
  assert.strictEqual(offers.length, 2, `one prompt per tag: ${JSON.stringify(__state.messages)}`);
});

test("rule 5: Mac, MLX pull fails and the GGUF offer is ALSO declined -> nothing pulled beyond the MLX attempt, fn-gen disabled", async () => {
  resetState();
  let n = 0;
  __state.respond = (kind, message, actions) => (n++ === 0 ? ACCEPT_DOWNLOADS(kind, message, actions) : undefined);
  const out = output();
  const { calls, pull } = scriptedPull({ [MLX]: new Error("boom") });
  await runFirstRunFlow(fakeContext(), out, { probe: macProbe(), listModels: async () => [FIM_MODEL], pull });
  assert.deepStrictEqual(calls, [MLX], `no silent GGUF download: ${show(out)}`);
  assert.strictEqual(offeredModels(out).filter((m) => m === GGUF).length, 1, "GGUF offered once");
  assert.ok(out.lines.some((l) => l.startsWith("[carve] fn-gen disabled")), show(out));
});

test("rule 5: Mac with the GGUF present and MLX absent -> the MLX tag is offered; declined, the session uses the GGUF with one line", async () => {
  resetState();
  __state.respond = DECLINE_ALL;
  const out = output();
  const { calls, pull } = scriptedPull();
  await runFirstRunFlow(fakeContext(), out, {
    probe: macProbe(),
    listModels: async () => [FIM_MODEL, GGUF],
    pull,
  });
  assert.deepStrictEqual(offeredModels(out), [MLX], `the normal missing-model offer, for the MLX tag: ${show(out)}`);
  assert.deepStrictEqual(calls, [], "declined: no download at all");
  assert.ok(
    !out.lines.some((l) => l.startsWith("[carve] fn-gen disabled")),
    `the GGUF on disk keeps fn-gen on: ${show(out)}`,
  );
  const ggufLines = out.lines.filter((l) => BARE_GGUF.test(l));
  assert.strictEqual(ggufLines.length, 1, `exactly one channel line names the GGUF tag in use: ${show(out)}`);
  assert.doesNotMatch(ggufLines[0], /pull offered/, "it is not a second offer");
});

test("rule 5: Mac with the MLX tag present -> no offer, no pull, no fallback line", async () => {
  resetState();
  __state.respond = ACCEPT_DOWNLOADS;
  const out = output();
  const { calls, pull } = scriptedPull();
  await runFirstRunFlow(fakeContext(), out, {
    probe: macProbe(),
    listModels: async () => [FIM_MODEL, MLX],
    pull,
  });
  assert.deepStrictEqual(pullLines(out), [], show(out));
  assert.deepStrictEqual(calls, []);
  assert.ok(!out.lines.some((l) => BARE_GGUF.test(l)), `the GGUF tag is never mentioned: ${show(out)}`);
  assert.ok(!out.lines.some((l) => l.startsWith("[carve] fn-gen disabled")), show(out));
});

test("rule 5 guard: a CUDA 24GB box missing its model is offered the GGUF tag, never MLX", async () => {
  resetState();
  __state.respond = DECLINE_ALL;
  const out = output();
  const { calls, pull } = scriptedPull();
  await runFirstRunFlow(fakeContext(), out, { probe: cuda24Probe(), listModels: async () => [FIM_MODEL], pull });
  assert.deepStrictEqual(offeredModels(out), [GGUF], show(out));
  assert.ok(!out.lines.some((l) => l.includes("-mlx")), show(out));
  assert.deepStrictEqual(calls, []);
});
