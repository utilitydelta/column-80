// Adversarial review, session-v78 phase 4: the MLX tag on Apple Silicon.
//
// Each red row is a finding. Every model list here is injected and no row dials
// a server: the lister seams answer from memory, the remote host is under the
// `.invalid` TLD.
//
// Run: node --test test/review-v78-p4-mlx-tier.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const esbuild = require("esbuild");

const WROOT = path.join(__dirname, ".review-v78-p4-workspace");
fs.mkdirSync(path.join(WROOT, "src"), { recursive: true });
fs.writeFileSync(
  path.join(WROOT, "package.json"),
  '{"name":"w","version":"0.0.0","scripts":{"test":"vitest run"},"devDependencies":{"vitest":"^1.0.0"}}\n',
);

const STUB = path.join(__dirname, ".review-v78-p4-stub.cjs");
fs.writeFileSync(
  STUB,
  `
const WROOT = ${JSON.stringify(WROOT)};
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
    onDidChangeConfiguration: () => ({ dispose() {} }),
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

const entry = path.join(__dirname, ".review-v78-p4.entry.ts");
const outfile = path.join(__dirname, ".review-v78-p4.bundle.cjs");
fs.writeFileSync(
  entry,
  `export { registerFnGen, buildFnGenService } from "../src/vscode/fnGen";
export { runFirstRunFlow } from "../src/vscode/firstRun";
export { ContextBlockStore } from "../src/core/contextBlocks";
export { __state } from "vscode";\n`,
);
esbuild.buildSync({ entryPoints: [entry], bundle: true, outfile, format: "cjs", platform: "node", alias: { vscode: STUB }, logLevel: "silent" });
const { registerFnGen, buildFnGenService, runFirstRunFlow, ContextBlockStore, __state } = require(outfile);
test.after(() => {
  for (const f of [entry, outfile, STUB]) fs.rmSync(f, { force: true });
  fs.rmSync(WROOT, { recursive: true, force: true });
});

const MLX = "qwen3.8:27b-mlx";
const GGUF = "qwen3.8:27b";
const FIM = "qwen2.5-coder:1.5b-base";
const GB = 1024 * 1024 * 1024;

const macProbe = {
  platformInfo: () => ({ platform: "darwin", arch: "arm64" }),
  totalMemBytes: () => 36 * GB,
  runCommand: async () => ({ exitCode: 1, stdout: "" }),
};

const channel = () => {
  const lines = [];
  return { lines, appendLine: (l) => lines.push(l), append() {}, show() {}, clear() {}, dispose() {} };
};
const show = (out) => "\n" + out.lines.join("\n");
const usesLines = (out) => out.lines.filter((l) => l.startsWith(`[carve] fn-gen uses ${GGUF}`));

function reset(config = {}, configInfo = {}) {
  __state.quickPickImpl = null;
  __state.config = { ...config };
  __state.configInfo = { ...configInfo };
  __state.messages = [];
}

const build = (out, models, extra = {}) => {
  let listed = 0;
  return buildFnGenService(out, (l) => out.appendLine(l), macProbe, {
    listModels: async () => {
      listed += 1;
      return models === undefined ? undefined : [...models];
    },
    ...extra,
  }).then((b) => ({ ...b, listed }));
};

// ---------------------------------------------------------------------------
// Finding: an explicit fnGenModel still triggers the catalogue swap.

test("explicit fnGenModel on a Mac: no channel line claims fn-gen uses the GGUF tag, and no catalogue read", async () => {
  reset({ fnGenModel: "llama3:8b" }, { fnGenModel: { globalValue: "llama3:8b" } });
  const out = channel();
  let listed = 0;
  const built = await buildFnGenService(out, (l) => out.appendLine(l), macProbe, {
    listModels: async () => {
      listed += 1;
      return [FIM, GGUF];
    },
  });
  assert.strictEqual(built.config.model, "llama3:8b", "harness: the explicit model is what runs");
  assert.deepStrictEqual(usesLines(out), [], `the channel names a model that is not running:${show(out)}`);
  assert.strictEqual(listed, 0, "a catalogue read for a selection the explicit model overrides");
});

test("explicit qwen3.8:27b on a Mac gets think:false whatever the catalogue holds (contract-p4 Amendment S78-8)", async () => {
  const rows = [
    ["both tags installed", [FIM, GGUF, MLX]],
    ["only the GGUF tag installed", [FIM, GGUF]],
    ["neither installed", [FIM]],
    ["server not answering", undefined],
  ];
  for (const [label, models] of rows) {
    reset({ fnGenModel: GGUF }, { fnGenModel: { globalValue: GGUF } });
    const out = channel();
    const built = await buildFnGenService(out, (l) => out.appendLine(l), macProbe, {
      listModels: async () => (models === undefined ? undefined : [...models]),
    });
    assert.strictEqual(built.config.model, GGUF, label);
    assert.strictEqual(built.config.think, false, `${label}: think=${built.config.think}`);
  }
});

test("guard: explicit llama3:8b on a Mac gets no think flag whatever the catalogue holds", async () => {
  for (const models of [[FIM, GGUF, MLX], [FIM, GGUF], [FIM], undefined]) {
    reset({ fnGenModel: "llama3:8b" }, { fnGenModel: { globalValue: "llama3:8b" } });
    const out = channel();
    const built = await buildFnGenService(out, (l) => out.appendLine(l), macProbe, {
      listModels: async () => (models === undefined ? undefined : [...models]),
    });
    assert.strictEqual(built.config.model, "llama3:8b");
    assert.ok(!("think" in built.config), `${JSON.stringify(models)}: think=${built.config.think}`);
  }
});

// ---------------------------------------------------------------------------
// Finding: a catalogue read that does not answer is silent, and the session
// pins the MLX tag for its whole life.

test("Mac, ollama not answering at activation: the channel says the MLX tag was never checked", async () => {
  reset();
  const out = channel();
  const built = await build(out, undefined);
  assert.strictEqual(built.config.model, MLX, "harness: unknown catalogue keeps the MLX tag");
  assert.strictEqual(built.listed, 1);
  assert.ok(
    out.lines.some((l) => l.includes(MLX) && /not (checked|verified)|did not answer|not answering|unreachable/.test(l)),
    `an existing GGUF-only Mac user whose ollama starts after VS Code runs a tag that is not there, silently:${show(out)}`,
  );
});

// ---------------------------------------------------------------------------
// Finding: the local catalogue read is signalled, not raced. The remote arm
// races its read for exactly this reason (a seam that ignores the signal).

test("Mac: a catalogue read that ignores its abort signal does not hold the build past the 2000ms bound", async () => {
  reset();
  const out = channel();
  const started = Date.now();
  const hang = new Promise(() => {});
  const result = await Promise.race([
    buildFnGenService(out, (l) => out.appendLine(l), macProbe, { listModels: () => hang }).then(() => "built"),
    new Promise((r) => setTimeout(() => r("hung"), 3500)),
  ]);
  assert.strictEqual(result, "built", `still waiting after ${Date.now() - started}ms`);
});

// ---------------------------------------------------------------------------
// Guards (expected green): no non-Mac or remote path takes the MLX tag.

test("guard: a Mac pointed at a remote apiBase never selects the MLX tag", async () => {
  reset({ apiBase: "http://linux-box.invalid:11434" });
  const out = channel();
  const built = await buildFnGenService(out, (l) => out.appendLine(l), macProbe, { listModels: async () => [GGUF] });
  assert.notStrictEqual(built.config.model, MLX, show(out));
  assert.ok(!out.lines.some((l) => l.includes("-mlx")), show(out));
});

test("guard: Linux arm64 and an Intel-under-Rosetta-shaped darwin x64 without hw.optional.arm64 never select MLX", async () => {
  const probes = [
    { platformInfo: () => ({ platform: "linux", arch: "arm64" }), totalMemBytes: () => 64 * GB, runCommand: async () => ({ exitCode: 0, stdout: "24576\n" }) },
    { platformInfo: () => ({ platform: "darwin", arch: "x64" }), totalMemBytes: () => 64 * GB, runCommand: async (cmd) => (cmd === "nvidia-smi" ? ({ exitCode: 0, stdout: "24576\n" }) : ({ exitCode: 1, stdout: "" })) },
  ];
  for (const p of probes) {
    for (const tier of ["auto", "24gb"]) {
      reset({ hardwareTier: tier });
      const out = channel();
      const built = await buildFnGenService(out, (l) => out.appendLine(l), p, { listModels: async () => [MLX] });
      assert.strictEqual(built.config.model, GGUF, `${p.platformInfo().platform}/${tier}${show(out)}`);
      assert.strictEqual(built.config.think, false, "think rides the GGUF row tag");
    }
  }
});

test("guard: the auto Mac path sends think:false on both tags (via the built config the transport reads)", async () => {
  for (const models of [[FIM, MLX], [FIM, GGUF]]) {
    reset();
    const built = await build(channel(), models);
    assert.strictEqual(built.config.think, false, String(built.config.model));
  }
});

// ---------------------------------------------------------------------------
// Finding: the GGUF-stands-in path logs its line, then the refresh it triggers
// logs the same line again (the real refresh is buildFnGenService on rebuild).

test("first-run, GGUF installed and MLX declined: one 'fn-gen uses' line across the flow and the refresh it triggers", async () => {
  reset();
  __state.quickPickImpl = async (items) => items[0];
  const out = channel();
  await runFirstRunFlow({}, out, {
    probe: macProbe,
    listModels: async () => [FIM, GGUF],
    pull: async () => {
      throw new Error("no pull in this row");
    },
    fnGenModelChanged: () => build(out, [FIM, GGUF]),
  });
  await new Promise((r) => setTimeout(r, 50));
  assert.strictEqual(usesLines(out).length, 1, show(out));
});

// ---------------------------------------------------------------------------
// Finding: refreshTier rebuilds (and disposes, which aborts in-flight work)
// even when the stand-in is the model the session already runs.

test("refreshTier with no model change does not dispose the live service (dispose aborts an in-flight generation)", { skip: "triage-p4 finding 6 deleted: after Do 4 refreshTier fires only when a download landed" }, async () => {
  reset();
  const out = channel();
  const context = { subscriptions: [], globalStorageUri: { fsPath: path.join(WROOT, "storage") } };
  const builds = [];
  const wiring = registerFnGen(context, out, new ContextBlockStore(() => {}), {
    buildService: async (o, log) => {
      const b = await buildFnGenService(o, log, macProbe, { listModels: async () => [FIM, GGUF] });
      let disposed = false;
      const real = b.service.dispose.bind(b.service);
      b.service.dispose = () => {
        disposed = true;
        real();
      };
      builds.push({ b, isDisposed: () => disposed });
      return b;
    },
  });
  await wiring.tierGate();
  assert.strictEqual(builds.length, 1);
  assert.strictEqual(builds[0].b.config.model, GGUF, "harness: activation already resolved the GGUF tag");
  wiring.refreshTier();
  await wiring.tierGate();
  assert.strictEqual(builds[builds.length - 1].b.config.model, GGUF);
  assert.strictEqual(builds[0].isDisposed(), false, "the session's service was torn down for a refresh that changed nothing");
});
