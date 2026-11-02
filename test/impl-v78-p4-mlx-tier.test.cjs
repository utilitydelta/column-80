// Implementer oracle, session-v78 phase 4: the MLX tag on Apple Silicon.
//
// Only `qwen3.8:27b` has an MLX build among the product's models, and only the
// 24gb row runs it. On unified memory that row's tag becomes `qwen3.8:27b-mlx`,
// and everything that rides the row's exact tag (think, carve) follows the tag
// actually selected. The first-run flow offers the MLX tag, falls back to the
// GGUF tag once when the MLX pull fails, and a session whose box has only the
// GGUF tag runs that rather than a tag that is not there.
//
// Run: node --test test/impl-v78-p4-mlx-tier.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const fs = require("node:fs");
const esbuild = require("esbuild");

const MLX = "qwen3.8:27b-mlx";
const GGUF = "qwen3.8:27b";
const MODEL_14B = "qwen2.5-coder:14b-instruct-q4_K_M";
const FIM = "qwen2.5-coder:1.5b-base";
const GB = 1024 * 1024 * 1024;

// ---------------------------------------------------------------------------
// The vscode stub, the same shape test/blind-v55-p3-firstrun-once.test.cjs uses.

const STUB = path.join(__dirname, ".impl-v78-p4-stub.cjs");
fs.writeFileSync(
  STUB,
  `
const state = {
  config: {}, configInfo: {}, updates: [], messages: [],
  infoResponses: [], warnResponses: [], errorResponses: [],
  quickPickImpl: null, commands: {}, terminals: [],
};
module.exports = {
  __state: state,
  ProgressLocation: { Notification: 15 },
  ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
  workspace: {
    getConfiguration: () => ({
      get: (key, fallback) => (key in state.config ? state.config[key] : fallback),
      inspect: (key) => state.configInfo[key],
      update: async (key, value, target) => { state.updates.push({ key, value, target }); state.config[key] = value; },
    }),
  },
  window: {
    showInformationMessage: async (message, ...actions) => {
      state.messages.push({ kind: "info", message, actions });
      return state.infoResponses.shift();
    },
    showWarningMessage: async (message, ...actions) => {
      state.messages.push({ kind: "warn", message, actions });
      return state.warnResponses.shift();
    },
    showErrorMessage: async (message, ...actions) => {
      state.messages.push({ kind: "error", message, actions });
      return state.errorResponses.shift();
    },
    showQuickPick: async (items, opts) => (state.quickPickImpl ? state.quickPickImpl(items, opts) : undefined),
    withProgress: async (opts, task) =>
      task({ report: () => {} }, { onCancellationRequested: () => ({ dispose() {} }) }),
    get terminals() { return state.terminals; },
  },
  commands: { registerCommand: (id, fn) => { state.commands[id] = fn; return { dispose() {} }; } },
  env: { openExternal: async () => true },
  Uri: { parse: (s) => s },
};
`,
);

const ENTRY = path.join(__dirname, ".impl-v78-p4.entry.ts");
const OUT = path.join(__dirname, ".impl-v78-p4.bundle.cjs");
fs.writeFileSync(
  ENTRY,
  `export { resolveTier, runFirstRunFlow } from "../src/vscode/firstRun";
export { TIER_TABLE, computeTier, applyTier, tierLogLine, preferInstalledTag, appleSiliconFallback } from "../src/core/tiers";
export { DEFAULT_FNGEN_CONFIG } from "../src/core/config";
export { __state } from "vscode";\n`,
);
esbuild.buildSync({
  entryPoints: [ENTRY],
  bundle: true,
  outfile: OUT,
  format: "cjs",
  platform: "node",
  alias: { vscode: STUB },
  logLevel: "silent",
});

test.after(() => {
  for (const f of [ENTRY, OUT, STUB]) fs.rmSync(f, { force: true });
});

const freshWorld = () => {
  delete require.cache[require.resolve(OUT)];
  return require(OUT);
};

const W = freshWorld();
const { TIER_TABLE, computeTier, applyTier, tierLogLine, preferInstalledTag, appleSiliconFallback, DEFAULT_FNGEN_CONFIG } = W;

// ---------------------------------------------------------------------------
// The table and computeTier.

test("only the 24gb row carries an Apple Silicon tag, and it is the 27b MLX build", () => {
  const tagged = TIER_TABLE.filter((r) => r.appleSiliconModel !== undefined).map((r) => [r.id, r.appleSiliconModel]);
  assert.deepStrictEqual(tagged, [["24gb", MLX]]);
});

const MAC = { unifiedMemory: true };
const TIER_ROWS = [
  // [label, vram, ram, opts, id, model, think, numGpu]
  ["Mac 24GB", 24576, 24576, MAC, "24gb", MLX, false, undefined],
  ["Mac 64GB", 61826, 61826, MAC, "24gb", MLX, false, undefined],
  ["Mac 16GB lands on the low-ram row and keeps its GGUF 14b", 16384, 16384, MAC, "16gb-low-ram", MODEL_14B, undefined, undefined],
  ["CUDA 24GB keeps the GGUF tag", 24576, 65536, undefined, "24gb", GGUF, false, undefined],
  ["CUDA 24GB with unifiedMemory false keeps the GGUF tag", 24576, 65536, { unifiedMemory: false }, "24gb", GGUF, false, undefined],
];

test("computeTier substitutes the MLX tag only on unified memory and only on a row that has one", () => {
  for (const [label, vram, ram, opts, id, model, think, numGpu] of TIER_ROWS) {
    const sel = computeTier(vram, ram, opts);
    assert.strictEqual(sel.id, id, label);
    assert.strictEqual(sel.fnGenModel, model, label);
    assert.strictEqual(sel.fnGenThink, think, label);
    assert.strictEqual(sel.fnGenNumGpu, numGpu, label);
    assert.ok(!("appleSiliconModel" in sel), `${label}: the row's field is not a selection field`);
  }
});

test("the carve is still stripped on unified memory (16gb-large-ram on a Mac-shaped probe)", () => {
  const sel = computeTier(16000, 32768, MAC);
  assert.strictEqual(sel.id, "16gb-large-ram");
  assert.ok(!("fnGenNumGpu" in sel));
  assert.strictEqual(sel.fnGenModel, DEFAULT_FNGEN_CONFIG.model, "no MLX tag exists for the 30b");
});

// ---------------------------------------------------------------------------
// applyTier: think and carve follow the SELECTED tag.

test("applyTier on a Mac 24gb runs the MLX tag with thinking off and no carve", () => {
  const out = applyTier({ ...DEFAULT_FNGEN_CONFIG }, computeTier(24576, 24576, MAC), false);
  assert.strictEqual(out.model, MLX);
  assert.strictEqual(out.think, false);
  assert.ok(!("numGpu" in out));
});

// Re-expressed for the contract-p4 Amendment (S78-8): the explicit GGUF tag is the
// row's own model, so it keeps think false as it did before the MLX tag existed.
test("an explicit fnGenModel on a Mac wins; the row's think rides either tag of the row's model and nothing else", () => {
  const rows = [
    // [explicit, think]
    [GGUF, false],
    [MLX, false],
    ["llama3:8b", undefined],
  ];
  for (const [explicit, think] of rows) {
    const out = applyTier({ ...DEFAULT_FNGEN_CONFIG, model: explicit }, computeTier(24576, 24576, MAC), true);
    assert.strictEqual(out.model, explicit, explicit);
    assert.strictEqual(out.think, think, explicit);
    assert.strictEqual("think" in out, think !== undefined, `${explicit}: key-absent when no think applies`);
    assert.ok(!("numGpu" in out), explicit);
  }
  const cuda = applyTier({ ...DEFAULT_FNGEN_CONFIG, model: MLX }, computeTier(24576, 65536), true);
  assert.ok(!("think" in cuda), "on CUDA the MLX tag is not the row's model's fallback, it is a foreign tag");
});

// ---------------------------------------------------------------------------
// The [carve] tier line.

test("the tier line names the MLX tag and says apple-silicon only when the substitution happened", () => {
  const mac = tierLogLine(computeTier(24576, 24576, MAC), 24576, 24576, "auto");
  assert.match(mac, /fnGen=qwen3\.8:27b-mlx /);
  assert.match(mac, /apple-silicon/);
  const cuda = tierLogLine(computeTier(24576, 65536), 24576, 65536, "auto");
  assert.match(cuda, /fnGen=qwen3\.8:27b /);
  assert.doesNotMatch(cuda, /apple-silicon/);
  const mac16 = tierLogLine(computeTier(16384, 16384, MAC), 16384, 16384, "auto");
  assert.doesNotMatch(mac16, /apple-silicon/, "a Mac on a row with no MLX tag had no substitution");
});

// ---------------------------------------------------------------------------
// preferInstalledTag / appleSiliconFallback, the pure halves of the session rule.

test("appleSiliconFallback names the GGUF tag only for a selection that took the MLX tag", () => {
  assert.strictEqual(appleSiliconFallback(computeTier(24576, 24576, MAC)), GGUF);
  assert.strictEqual(appleSiliconFallback(computeTier(24576, 65536)), undefined);
  assert.strictEqual(appleSiliconFallback(computeTier(16384, 16384, MAC)), undefined);
  assert.strictEqual(appleSiliconFallback(computeTier(4096, 4096, MAC)), undefined);
});

test("preferInstalledTag runs the GGUF tag only when the MLX tag is absent and the GGUF tag is installed", () => {
  const mac = computeTier(24576, 24576, MAC);
  const rows = [
    // [label, models, expected tag]
    ["GGUF only", [FIM, GGUF], GGUF],
    ["GGUF only, untagged latest form does not count as the 27b", [FIM, "qwen3.8:latest"], MLX],
    ["both installed", [FIM, GGUF, MLX], MLX],
    ["MLX only", [FIM, MLX], MLX],
    ["neither", [FIM], MLX],
    ["server not answering", undefined, MLX],
  ];
  for (const [label, models, tag] of rows) {
    const sel = preferInstalledTag(mac, models);
    assert.strictEqual(sel.fnGenModel, tag, label);
    assert.strictEqual(sel.fnGenThink, false, `${label}: think rides both tags of the same model`);
  }
  const cuda = computeTier(24576, 65536);
  assert.deepStrictEqual(preferInstalledTag(cuda, [FIM]), cuda, "a CUDA selection is never touched");
});

test("applyTier over the GGUF fallback still turns thinking off", () => {
  const sel = preferInstalledTag(computeTier(24576, 24576, MAC), [FIM, GGUF]);
  const out = applyTier({ ...DEFAULT_FNGEN_CONFIG }, sel, false);
  assert.strictEqual(out.model, GGUF);
  assert.strictEqual(out.think, false);
});

// ---------------------------------------------------------------------------
// The vscode layer: resolveTier and the first-run flow.

const macProbe = (gb) => ({
  platformInfo: () => ({ platform: "darwin", arch: "arm64" }),
  totalMemBytes: () => gb * GB,
  runCommand: async () => ({ exitCode: 1, stdout: "" }),
});
const cudaProbe = (vramMB) => ({
  platformInfo: () => ({ platform: "linux", arch: "x64" }),
  totalMemBytes: () => 64 * GB,
  runCommand: async () => ({ exitCode: 0, stdout: `${vramMB}\n` }),
});

const channel = () => {
  const lines = [];
  return { lines, appendLine: (l) => lines.push(l) };
};

// The CUDA row is also the regression row for overrideSelection dropping the
// row's think flag: before v78 an override to 24gb ran qwen3.8:27b reasoning.
test("hardwareTier override 24gb runs the MLX tag on a Mac and the GGUF tag elsewhere, thinking off on both", async () => {
  const rows = [
    ["Mac", macProbe(36), MLX],
    ["CUDA", cudaProbe(24576), GGUF],
  ];
  for (const [label, probe, tag] of rows) {
    const w = freshWorld();
    w.__state.config.hardwareTier = "24gb";
    const out = channel();
    const { selection } = await w.resolveTier(out, probe, async () => [FIM, GGUF, MLX]);
    assert.strictEqual(selection.fnGenModel, tag, label);
    assert.strictEqual(selection.fnGenThink, false, label);
    const tierLine = out.lines.find((l) => l.startsWith("[carve] tier="));
    assert.match(tierLine, /reason=override/, label);
    assert.strictEqual(/apple-silicon/.test(tierLine), tag === MLX, label);
    const folded = w.applyTier({ ...W.DEFAULT_FNGEN_CONFIG }, selection, false);
    assert.strictEqual(folded.think, false, `${label}: the folded config carries think false`);
  }
});

test("resolveTier lists nothing unless a lister is handed in (the unit suite never dials a real server)", async () => {
  const w = freshWorld();
  const { selection } = await w.resolveTier(channel(), macProbe(36));
  assert.strictEqual(selection.fnGenModel, MLX);
});

test("resolveTier on a Mac with only the GGUF tag installed runs it, with one channel line", async () => {
  const w = freshWorld();
  const out = channel();
  const { selection } = await w.resolveTier(out, macProbe(36), async () => [FIM, GGUF]);
  assert.strictEqual(selection.fnGenModel, GGUF);
  const fallback = out.lines.filter((l) => l.includes(MLX) && l.includes(`uses ${GGUF}`));
  assert.strictEqual(fallback.length, 1, out.lines.join("\n"));
});

test("resolveTier on a Mac with the MLX tag installed runs it and says nothing extra", async () => {
  const w = freshWorld();
  const out = channel();
  const { selection } = await w.resolveTier(out, macProbe(36), async () => [FIM, MLX, GGUF]);
  assert.strictEqual(selection.fnGenModel, MLX);
  assert.ok(!out.lines.some((l) => l.includes(`uses ${GGUF}`)));
});

test("resolveTier on a CUDA box never lists models", async () => {
  const w = freshWorld();
  let listed = 0;
  await w.resolveTier(channel(), cudaProbe(24576), async () => {
    listed += 1;
    return [];
  });
  assert.strictEqual(listed, 0);
});

/** Drive the first-run flow on a 36GB Mac with the detected tier accepted. */
async function macFirstRun({ installed, infoResponses, pullFails = [] }) {
  const w = freshWorld();
  w.__state.quickPickImpl = async (items) => items[0];
  w.__state.infoResponses.push(...infoResponses);
  const out = channel();
  const pulls = [];
  let settled = 0;
  await w.runFirstRunFlow({}, out, {
    probe: macProbe(36),
    listModels: async () => [...installed],
    pull: async (_base, model) => {
      pulls.push(model);
      if (pullFails.includes(model)) {
        throw new Error(`pull model manifest: 412: this model requires a newer version of Ollama`);
      }
    },
    fnGenModelChanged: () => {
      settled += 1;
    },
  });
  const offers = out.lines.filter((l) => l.startsWith("[carve] pull offered")).map((l) => /model=(\S+)/.exec(l)[1]);
  return { w, out, pulls, offers, settled };
}

test("MLX pull fails: the GGUF tag is offered once with one channel line naming the failed tag, and lands", async () => {
  const r = await macFirstRun({ installed: [FIM], infoResponses: ["Download", "Download"], pullFails: [MLX] });
  assert.deepStrictEqual(r.offers, [MLX, GGUF]);
  assert.deepStrictEqual(r.pulls, [MLX, GGUF]);
  // The existing pull-failed line is the one line naming the failed tag and why;
  // nothing repeats the error text.
  const why = r.out.lines.filter((l) => /newer version of Ollama/.test(l));
  assert.strictEqual(why.length, 1, r.out.lines.join("\n"));
  assert.ok(why[0].startsWith(`[carve] pull failed model=${MLX}:`), why[0]);
  const ggufOffer = r.out.lines.find((l) => l.startsWith(`[carve] pull offered model=${GGUF} `));
  assert.ok(ggufOffer.includes(MLX), `the second offer says which tag failed: ${ggufOffer}`);
  const prompt = r.w.__state.messages.find((m) => m.kind === "info" && m.message.endsWith(`Download ${GGUF}?`));
  assert.ok(prompt.message.includes(MLX), prompt.message);
  assert.ok(!r.out.lines.some((l) => l.includes("fn-gen disabled")), r.out.lines.join("\n"));
  assert.strictEqual(r.settled, 1, "the session is told a different tag landed");
});

test("MLX pull fails and the GGUF offer is declined: generation stays off, named once", async () => {
  const r = await macFirstRun({ installed: [FIM], infoResponses: ["Download", undefined], pullFails: [MLX] });
  assert.deepStrictEqual(r.pulls, [MLX], "no download without a Download click");
  assert.deepStrictEqual(r.offers, [MLX, GGUF]);
  assert.strictEqual(r.out.lines.filter((l) => l.includes("fn-gen disabled")).length, 1);
  assert.strictEqual(r.settled, 0);
});

test("MLX pull fails with the GGUF tag already installed: no second offer, the GGUF tag runs", async () => {
  const r = await macFirstRun({ installed: [FIM, GGUF], infoResponses: ["Download"], pullFails: [MLX] });
  assert.deepStrictEqual(r.offers, [MLX]);
  assert.deepStrictEqual(r.pulls, [MLX]);
  assert.strictEqual(r.out.lines.filter((l) => l.includes(MLX) && l.includes(`uses ${GGUF}`)).length, 1);
  assert.ok(!r.out.lines.some((l) => l.includes("fn-gen disabled")));
  assert.strictEqual(r.settled, 0, "the GGUF tag on disk is what activation already resolved; no refresh");
});

test("GGUF installed, MLX offered and declined: the GGUF tag runs, one channel line, no toast", async () => {
  const r = await macFirstRun({ installed: [FIM, GGUF], infoResponses: [undefined] });
  assert.deepStrictEqual(r.offers, [MLX], "the normal missing-model offer, for the MLX tag");
  assert.deepStrictEqual(r.pulls, []);
  assert.strictEqual(r.out.lines.filter((l) => l.includes(MLX) && l.includes(`uses ${GGUF}`)).length, 1);
  assert.ok(!r.out.lines.some((l) => l.includes("fn-gen disabled")));
  const toasts = r.w.__state.messages.filter((m) => m.kind !== "info" || !m.message.includes("Download"));
  assert.deepStrictEqual(toasts, [], "nothing beyond the offer itself");
  assert.strictEqual(r.settled, 0, "the GGUF tag on disk is what activation already resolved; no refresh");
  const uses = r.out.lines.find((l) => l.includes(`uses ${GGUF}`));
  assert.ok(uses.includes("Select Hardware Tier"), `the line names the way to the MLX build: ${uses}`);
});

test("neither installed, MLX declined: no GGUF offer, generation off as before", async () => {
  const r = await macFirstRun({ installed: [FIM], infoResponses: [undefined] });
  assert.deepStrictEqual(r.offers, [MLX]);
  assert.deepStrictEqual(r.pulls, []);
  assert.strictEqual(r.out.lines.filter((l) => l.includes("fn-gen disabled")).length, 1);
  assert.strictEqual(r.settled, 0);
});

test("MLX installed: no offer, no pull", async () => {
  const r = await macFirstRun({ installed: [FIM, MLX], infoResponses: [] });
  assert.deepStrictEqual(r.offers, []);
  assert.deepStrictEqual(r.pulls, []);
  assert.strictEqual(r.settled, 0);
});

test("MLX pull lands: the session is told, no fallback line", async () => {
  const r = await macFirstRun({ installed: [FIM], infoResponses: ["Download"] });
  assert.deepStrictEqual(r.pulls, [MLX]);
  assert.ok(!r.out.lines.some((l) => l.includes(`uses ${GGUF}`) || /model=qwen3\.8:27b(?!-mlx)/.test(l)));
  assert.strictEqual(r.settled, 1);
});


test("CUDA 24GB: a landed fn-gen pull does not tell the session, its tier never read the catalogue", async () => {
  const w = freshWorld();
  w.__state.quickPickImpl = async (items) => items[0];
  w.__state.infoResponses.push("Download");
  const pulls = [];
  let settled = 0;
  await w.runFirstRunFlow({}, channel(), {
    probe: cudaProbe(24576),
    listModels: async () => [FIM],
    pull: async (_base, model) => {
      pulls.push(model);
    },
    fnGenModelChanged: () => {
      settled += 1;
    },
  });
  assert.deepStrictEqual(pulls, [GGUF], "the case fired: the CUDA row's fn-gen tag was pulled");
  assert.strictEqual(settled, 0);
});

// ---------------------------------------------------------------------------
// The activation re-check: registerFnGen behind the fuller stub that
// test/review-v78-p4-mlx-tier.test.cjs uses (copied, with its own temp names,
// because a review artifact must not be edited to export anything).

const FG_WROOT = path.join(__dirname, ".impl-v78-p4-workspace");
fs.mkdirSync(path.join(FG_WROOT, "src"), { recursive: true });
fs.writeFileSync(
  path.join(FG_WROOT, "package.json"),
  '{"name":"w","version":"0.0.0","scripts":{"test":"vitest run"},"devDependencies":{"vitest":"^1.0.0"}}\n',
);

const FG_STUB = path.join(__dirname, ".impl-v78-p4-fngen-stub.cjs");
fs.writeFileSync(
  FG_STUB,
  `
const WROOT = ${JSON.stringify(FG_WROOT)};
const state = {
  config: {}, messages: [], commands: {}, activeTextEditor: undefined,
  snippetInserts: [], appliedEdits: [], executeCalls: [], terminals: [],
  textDocuments: [], warnResponses: [],
  symbols: undefined, symbolsSet: false,
};
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
  contains(pos) {
    const s = pos.start ? pos.start : pos;
    const e = pos.end ? pos.end : pos;
    const afterStart = s.line > this.start.line || (s.line === this.start.line && s.character >= this.start.character);
    const beforeEnd = e.line < this.end.line || (e.line === this.end.line && e.character <= this.end.character);
    return afterStart && beforeEnd;
  }
  with(start, end) { return new Range(start || this.start, end || this.end); }
}
class Selection extends Range {
  constructor(a, b, c, d) { super(a, b, c, d); this.anchor = this.start; this.active = this.end; }
}
class SnippetString { constructor(value) { this.value = value; } }
class WorkspaceEdit {
  constructor() { this._entries = []; }
  replace(uri, range, text) { this._entries.push([uri, [{ range, newText: text }]]); }
  insert(uri, pos, text) { this._entries.push([uri, [{ range: new Range(pos, pos), newText: text }]]); }
  entries() { return this._entries; }
}
class EventEmitter {
  constructor() { this.handlers = []; }
  get event() { return (fn) => { this.handlers.push(fn); return { dispose() {} }; }; }
  fire(x) { for (const h of this.handlers) h(x); }
  dispose() {}
}
class ThemeColor { constructor(id) { this.id = id; } }
class MarkdownString { constructor(v) { this.value = v || ""; } appendCodeblock() {} appendMarkdown() {} appendText() {} }
class Diagnostic { constructor(range, message, severity) { this.range = range; this.message = message; this.severity = severity; } }
class TabInputTextDiff { constructor(original, modified) { this.original = original; this.modified = modified; } }
const Uri = {
  file: (p) => ({ fsPath: p, path: p, scheme: "file", toString: () => "file://" + p, with() { return this; } }),
  from: (parts) => ({ ...parts, fsPath: parts.path, toString: () => parts.scheme + "://" + parts.path + "?" + (parts.query || "") }),
  parse: (s) => ({ raw: s, fsPath: String(s).replace(/^file:\\/\\//, ""), path: String(s).replace(/^file:\\/\\//, ""), scheme: "file", toString: () => String(s), with() { return this; } }),
  joinPath: (base, ...segs) => Uri.file([base.fsPath, ...segs].join("/")),
};
module.exports = {
  __state: state,
  Position, Range, Selection, SnippetString, WorkspaceEdit, EventEmitter,
  ThemeColor, MarkdownString, Diagnostic, TabInputTextDiff, Uri,
  DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
  SymbolKind: { File: 0, Module: 1, Namespace: 2, Package: 3, Class: 4, Method: 5, Property: 6,
    Field: 7, Constructor: 8, Enum: 9, Interface: 10, Function: 11, Variable: 12, Constant: 13,
    String: 14, Number: 15, Boolean: 16, Array: 17, Object: 18, Key: 19, Null: 20, EnumMember: 21,
    Struct: 22, Event: 23, Operator: 24, TypeParameter: 25 },
  CompletionItemKind: { Method: 1, Function: 2, Field: 4, Variable: 5, Class: 6, Property: 9, Enum: 12, Constant: 20, Struct: 21 },
  ProgressLocation: { Notification: 15, Window: 10, SourceControl: 1 },
  ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
  OverviewRulerLane: { Left: 1, Center: 2, Right: 4, Full: 7 },
  workspace: {
    getConfiguration: () => ({
      get: (key, fallback) => (key in state.config ? state.config[key] : fallback),
      has: () => false, inspect: (key) => (state.configInfo || {})[key], update: async () => {},
    }),
    onDidChangeConfiguration: (fn) => { (state.configHandlers = state.configHandlers || []).push(fn); return { dispose() {} }; },
    onDidChangeTextDocument: () => ({ dispose() {} }),
    onDidCloseTextDocument: () => ({ dispose() {} }),
    registerTextDocumentContentProvider: () => ({ dispose() {} }),
    get textDocuments() { return state.textDocuments; },
    get workspaceFolders() { return [{ uri: Uri.file(WROOT), name: "w", index: 0 }]; },
    getWorkspaceFolder: () => ({ uri: Uri.file(WROOT), name: "w", index: 0 }),
    openTextDocument: async () => state.activeTextEditor && state.activeTextEditor.document,
    applyEdit: async (edit) => { state.appliedEdits.push(edit); return true; },
    fs: { stat: async () => { throw new Error("ENOENT"); } },
  },
  languages: {
    createDiagnosticCollection: (name) => ({ name, set() {}, delete() {}, clear() {}, dispose() {} }),
    getDiagnostics: () => [],
    onDidChangeDiagnostics: () => ({ dispose() {} }),
  },
  window: {
    createOutputChannel: (name) => ({ name, appendLine() {}, append() {}, replace() {}, show() {}, hide() {}, clear() {}, dispose() {} }),
    createTextEditorDecorationType: (opts) => ({ opts, dispose() {} }),
    get visibleTextEditors() { return state.activeTextEditor ? [state.activeTextEditor] : []; },
    get activeTextEditor() { return state.activeTextEditor; },
    showTextDocument: async () => state.activeTextEditor,
    showInformationMessage: async (message, ...actions) => { state.messages.push({ kind: "info", message, actions }); return undefined; },
    showWarningMessage: async (message, ...actions) => { state.messages.push({ kind: "warn", message, actions }); return (state.warnResponses || []).shift(); },
    showErrorMessage: async (message, ...actions) => { state.messages.push({ kind: "error", message, actions }); return undefined; },
    showQuickPick: async (items, opts) => (state.quickPickImpl ? state.quickPickImpl(items, opts) : undefined),
    withProgress: async (opts, task) => task({ report: () => {} }, { onCancellationRequested: () => ({ dispose() {} }) }),
    setStatusBarMessage: () => ({ dispose() {} }),
    createStatusBarItem: () => ({ text: "", tooltip: "", command: undefined, show() {}, hide() {}, dispose() {} }),
    createTerminal: (opts) => {
      const t = { name: opts && opts.name, shown: false, sent: [], show() { this.shown = true; }, sendText(s) { this.sent.push(s); }, dispose() {} };
      state.terminals.push(t);
      return t;
    },
    get terminals() { return state.terminals; },
    activeColorTheme: { kind: 1 },
    tabGroups: { all: [], onDidChangeTabs: () => ({ dispose() {} }), close: async () => {} },
  },
  commands: {
    registerCommand: (id, fn) => { state.commands[id] = fn; return { dispose() {} }; },
    executeCommand: async (id, ...args) => {
      state.executeCalls.push({ id, args });
      if (id === "vscode.executeDocumentSymbolProvider") return state.symbols;
      return undefined;
    },
  },
};
`,
);

const FG_ENTRY = path.join(__dirname, ".impl-v78-p4-fngen.entry.ts");
const FG_OUT = path.join(__dirname, ".impl-v78-p4-fngen.bundle.cjs");
fs.writeFileSync(
  FG_ENTRY,
  `export { registerFnGen, buildFnGenService } from "../src/vscode/fnGen";
export { ContextBlockStore } from "../src/core/contextBlocks";
export { __state as fgState } from "vscode";\n`,
);
esbuild.buildSync({ entryPoints: [FG_ENTRY], bundle: true, outfile: FG_OUT, format: "cjs", platform: "node", alias: { vscode: FG_STUB }, logLevel: "silent" });
test.after(() => {
  for (const f of [FG_ENTRY, FG_OUT, FG_STUB]) fs.rmSync(f, { force: true });
  fs.rmSync(FG_WROOT, { recursive: true, force: true });
});

const tick = () => new Promise((r) => setImmediate(r));
async function until(cond, what) {
  for (let i = 0; i < 2000; i += 1) {
    if (cond()) return;
    await tick();
  }
  throw new Error(`timed out waiting for ${what}`);
}

/** registerFnGen on a 36GB Mac with an injected catalogue and retry schedule. */
function fnGenWorld(lister, delays) {
  const FG = require(FG_OUT);
  FG.fgState.config = {};
  FG.fgState.configInfo = {};
  FG.fgState.configHandlers = [];
  const builds = [];
  let listed = 0;
  const out = channel();
  const context = { subscriptions: [], globalStorageUri: { fsPath: path.join(FG_WROOT, "storage") } };
  const wiring = FG.registerFnGen(context, out, new FG.ContextBlockStore(() => {}), {
    catalogueRecheckDelaysMs: delays,
    buildService: async (o, log) => {
      const b = await FG.buildFnGenService(o, log, macProbe(36), {
        listModels: async () => {
          listed += 1;
          return lister(listed);
        },
      });
      const inner = b.service.dispose.bind(b.service);
      b.disposed = false;
      b.service.dispose = () => {
        b.disposed = true;
        inner();
      };
      builds.push(b);
      return b;
    },
  });
  const close = () => {
    for (const s of context.subscriptions) s.dispose?.();
  };
  return { FG, builds, out, wiring, close, listed: () => listed };
}

const notChecked = (out) => out.lines.filter((l) => l.startsWith("[carve] fn-gen model not checked"));
const gaveUp = (out) => out.lines.filter((l) => l.startsWith("[carve] fn-gen model still not checked"));

test("a Mac whose catalogue did not answer at activation settles the tag in the background, with no gesture", async () => {
  const w = fnGenWorld((n) => (n === 1 ? undefined : [FIM, GGUF]), [0, 0, 0]);
  await until(() => w.builds.length === 2, "the background re-check build");
  await w.wiring.tierGate();
  assert.strictEqual(w.listed(), 2, "activation read, then one background re-check");
  assert.strictEqual(w.builds[1].config.model, GGUF);
  assert.strictEqual(notChecked(w.out).length, 1, w.out.lines.join("\n"));
  assert.match(notChecked(w.out)[0], /will check again shortly/);
  assert.strictEqual(w.out.lines.filter((l) => l.startsWith(`[carve] fn-gen uses ${GGUF}`)).length, 1, w.out.lines.join("\n"));
  assert.deepStrictEqual(gaveUp(w.out), []);
  await w.wiring.tierGate();
  await w.wiring.tierGate();
  assert.strictEqual(w.listed(), 2, "gestures read no catalogue");
  w.close();
});

test("a server that never answers: the schedule runs out once, one give-up line, gestures read nothing", async () => {
  const w = fnGenWorld(() => undefined, [0, 0, 0]);
  await until(() => gaveUp(w.out).length === 1, "the give-up line");
  assert.strictEqual(w.listed(), 4, "activation plus three scheduled attempts");
  assert.strictEqual(notChecked(w.out).length, 1, "failed retries print nothing");
  assert.match(gaveUp(w.out)[0], /qwen3\.8:27b-mlx stands$/);
  assert.strictEqual(w.builds[w.builds.length - 1].config.model, MLX);
  for (let i = 0; i < 3; i += 1) await w.wiring.tierGate();
  await new Promise((r) => setTimeout(r, 20));
  assert.strictEqual(w.listed(), 4);
  assert.strictEqual(gaveUp(w.out).length, 1);
  w.close();
});

test("deactivate clears a pending re-check", async () => {
  const w = fnGenWorld(() => undefined, [30, 30]);
  await until(() => w.builds.length === 1, "activation build");
  w.close();
  await new Promise((r) => setTimeout(r, 120));
  assert.strictEqual(w.listed(), 1);
});

test("deactivate during an in-flight re-check: the late build is disposed and arms no further retry", async () => {
  let release;
  const slow = new Promise((r) => {
    release = r;
  });
  const w = fnGenWorld((n) => (n === 2 ? slow : undefined), [0, 0, 0]);
  await until(() => w.listed() === 2, "the re-check is reading");
  w.close();
  release(undefined);
  await until(() => w.builds.length === 2, "the in-flight build finishes");
  await new Promise((r) => setTimeout(r, 50));
  assert.strictEqual(w.listed(), 2, "no catalogue read after deactivate");
  assert.deepStrictEqual(
    w.builds.map((b) => b.disposed),
    [true, true],
    "the build that landed after deactivate was disposed, not installed",
  );
  assert.deepStrictEqual(gaveUp(w.out), [], "no retry was armed, so the schedule never ran out");
});

test("a settings change that sets an explicit model makes the re-check moot and clears it", async () => {
  const w = fnGenWorld(() => undefined, [40, 40]);
  await until(() => w.builds.length === 1, "activation build");
  w.FG.fgState.config.fnGenModel = "my-model:7b";
  w.FG.fgState.configInfo.fnGenModel = { globalValue: "my-model:7b" };
  for (const h of w.FG.fgState.configHandlers) h({ affectsConfiguration: () => true });
  await until(() => w.builds.length === 2, "settings rebuild");
  await new Promise((r) => setTimeout(r, 150));
  assert.strictEqual(w.listed(), 1, "no catalogue read for an explicit model, and no retry");
  assert.strictEqual(w.builds.length, 2);
  assert.deepStrictEqual(gaveUp(w.out), []);
  w.close();
});

test("latest started build wins: a slow earlier build that finishes last is disposed, not installed", async () => {
  let release;
  const slow = new Promise((r) => {
    release = r;
  });
  const w = fnGenWorld((n) => (n === 1 ? undefined : n === 2 ? slow : undefined), [0, 60000]);
  await until(() => w.listed() === 2, "the re-check is reading");
  w.FG.fgState.config.fnGenModel = "my-model:7b";
  w.FG.fgState.configInfo.fnGenModel = { globalValue: "my-model:7b" };
  for (const h of w.FG.fgState.configHandlers) h({ affectsConfiguration: () => true });
  await until(() => w.builds.length === 2, "settings rebuild");
  release([FIM, GGUF]);
  await until(() => w.builds.length === 3, "the stale build finishes");
  await w.wiring.tierGate();
  assert.strictEqual(w.builds[1].config.model, "my-model:7b");
  assert.strictEqual(w.builds[2].config.model, GGUF, "harness: the stale build resolved under the old settings");
  assert.deepStrictEqual(
    w.builds.map((b) => b.disposed),
    [true, false, true],
    "the settings build is the one live service",
  );
  assert.ok(!w.out.lines.some((l) => l.startsWith(`[carve] fn-gen uses ${GGUF}`)), "the dropped build prints nothing");
  w.close();
});

// ---------------------------------------------------------------------------
// Never auto-pull stays structural.

test("pullModel is reached only through offerPull", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "src", "vscode", "firstRun.ts"), "utf8");
  const uses = src.split("\n").filter((l) => /\bpullModel\b/.test(l) && !/^\s*(\/\/|\*)/.test(l));
  assert.strictEqual(uses.length, 3, uses.join("\n")); // import, the offerModelPull type, offerPull's default
  const vscodeDir = path.join(__dirname, "..", "src", "vscode");
  for (const f of fs.readdirSync(vscodeDir).filter((n) => n.endsWith(".ts") && n !== "firstRun.ts")) {
    const text = fs.readFileSync(path.join(vscodeDir, f), "utf8");
    assert.ok(!/\bpullModel\b/.test(text), `${f} must not reach pullModel`);
  }
});
