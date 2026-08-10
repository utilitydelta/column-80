// Implementer oracle: tier discipline on EVERY model-call entry point,
// failing CLOSED (P5-F1+F3), and repair evidence naming the model that
// actually served the round (P5-F2). registerFnGen-level: the registered
// commands are driven against a stub vscode with injected tier flows, so
// the wiring itself is what these tests pin - not the core session
// mechanics (impl4 owns those). Written red against the fail-open code
// first; green is the fix.
//
// Run: npm test

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const os = require("os");
const esbuild = require("esbuild");

const STUB = path.join(__dirname, ".impl5-fngen-stub.cjs");
fs.writeFileSync(
  STUB,
  `
const path = require("path");
const state = {
  config: {}, messages: [], infoResponses: [], warnResponses: [],
  commands: {}, executeCalls: [], collections: [], visibleTextEditors: [],
  textDocuments: [], activeTextEditor: undefined,
};
class Position {
  constructor(line, character) { this.line = line; this.character = character; }
}
class Range {
  constructor(a, b, c, d) {
    if (typeof a === "number") { this.start = new Position(a, b); this.end = new Position(c, d); }
    else { this.start = a; this.end = b; }
  }
}
class EventEmitter {
  constructor() { this.handlers = []; }
  get event() { return (fn) => { this.handlers.push(fn); return { dispose() {} }; }; }
  fire(x) { for (const h of this.handlers) h(x); }
  dispose() {}
}
class ThemeColor { constructor(id) { this.id = id; } }
class MarkdownString { constructor() { this.blocks = []; } appendCodeblock(t) { this.blocks.push(t); } }
class Diagnostic { constructor(range, message, severity) { this.range = range; this.message = message; this.severity = severity; } }
class WorkspaceEdit { replace() {} }
const Uri = {
  file: (p) => ({ fsPath: p, path: p, scheme: "file", toString: () => "file://" + p }),
  parse: (s) => ({ raw: s, toString: () => s }),
  from: (o) => ({ ...o, toString: () => o.scheme + "://" + o.path + "?" + (o.query ?? "") }),
};
module.exports = {
  __state: state,
  Position, Range, EventEmitter, ThemeColor, MarkdownString, Diagnostic, Uri, WorkspaceEdit,
  DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
  SymbolKind: { Function: 11, Method: 5, Constructor: 8 },
  ProgressLocation: { Notification: 15 },
  ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
  TabInputTextDiff: class {},
  workspace: {
    getConfiguration: () => ({
      get: (key, fallback) => (key in state.config ? state.config[key] : fallback),
      inspect: () => undefined,
      update: async () => {},
    }),
    onDidChangeConfiguration: () => ({ dispose() {} }),
    registerTextDocumentContentProvider: () => ({ dispose() {} }),
    get textDocuments() { return state.textDocuments; },
    applyEdit: async () => true,
  },
  languages: {
    createDiagnosticCollection: (name) => {
      const c = { name, entries: new Map(), set(u, l) { this.entries.set(u.toString(), l); }, delete() {}, clear() {}, dispose() {} };
      state.collections.push(c);
      return c;
    },
  },
  window: {
    createTextEditorDecorationType: (opts) => ({ opts, dispose() {} }),
    get visibleTextEditors() { return state.visibleTextEditors; },
    get activeTextEditor() { return state.activeTextEditor; },
    showInformationMessage: async (message, ...actions) => {
      state.messages.push({ kind: "info", message, actions });
      return state.infoResponses.shift();
    },
    showWarningMessage: async (message, ...actions) => {
      state.messages.push({ kind: "warn", message, actions });
      return state.warnResponses.shift();
    },
    showErrorMessage: async (message) => { state.messages.push({ kind: "error", message }); },
    withProgress: async (opts, task) =>
      task({ report: () => {} }, { onCancellationRequested: () => ({ dispose() {} }) }),
    tabGroups: { all: [], onDidChangeTabs: () => ({ dispose() {} }), close: async () => {} },
  },
  commands: {
    registerCommand: (id, fn) => { state.commands[id] = fn; return { dispose() {} }; },
    executeCommand: async (id, ...args) => { state.executeCalls.push({ id, args }); return undefined; },
  },
};
`,
);

const entry = path.join(__dirname, ".impl5-fngen.entry.ts");
const outfile = path.join(__dirname, ".impl5-fngen.bundle.cjs");
fs.writeFileSync(
  entry,
  `export { registerFnGen, isServerUnreachable } from "../src/vscode/fnGen";
export { runPostAcceptOracle } from "../src/vscode/oracleSurface";
export { FnGenService } from "../src/core/fnGenService";
export { ContextBlockStore } from "../src/core/contextBlocks";
export { __state } from "vscode";\n`,
);
esbuild.buildSync({
  entryPoints: [entry],
  bundle: true,
  outfile,
  format: "cjs",
  platform: "node",
  alias: { vscode: STUB },
});
const { registerFnGen, isServerUnreachable, runPostAcceptOracle, FnGenService, ContextBlockStore, __state } = require(outfile);
test.after(() => {
  fs.rmSync(entry, { force: true });
  fs.rmSync(outfile, { force: true });
  fs.rmSync(STUB, { force: true });
});

const REPAIRBENCH = path.join(__dirname, "fixtures", "repairbench");
const scratchCopy = (tag) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `impl5-${tag}-`));
  fs.cpSync(REPAIRBENCH, dir, { recursive: true });
  return dir;
};

const resetState = () => {
  __state.config = {};
  __state.messages = [];
  __state.infoResponses = [];
  __state.warnResponses = [];
  __state.commands = {};
  __state.executeCalls = [];
  __state.visibleTextEditors = [];
  __state.textDocuments = [];
  __state.activeTextEditor = undefined;
};

const output = () => {
  const lines = [];
  return { lines, appendLine: (l) => lines.push(l) };
};

const fakeContext = () => ({ subscriptions: [] });

// Injected probes: the tier-gate scenarios never touch host hardware
// (P5-F9 rider discipline applies to this whole file).
const referenceProbe = () => ({
  runCommand: async () => ({ stdout: "16303\n", exitCode: 0 }),
  totalMemBytes: () => 61826 * 1048576,
});
const noGpuProbe = () => ({
  runCommand: async () => {
    throw Object.assign(new Error("spawn nvidia-smi ENOENT"), { code: "ENOENT" });
  },
  totalMemBytes: () => 61826 * 1048576,
});

const waitFor = async (predicate, what, tries = 1200) => {
  for (let i = 0; i < tries; i++) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  assert.fail(`timed out waiting for ${what}`);
};

// File-backed document fake (impl4 pattern): Range-based getText slices the
// live file via offset-bearing positions.
const fileDocument = (file, over = {}) => ({
  languageId: "rust",
  isDirty: false,
  isClosed: false,
  version: 1,
  uri: { fsPath: file, path: file, scheme: "file", toString: () => "file://" + file },
  getText(range) {
    const t = fs.readFileSync(file, "utf8");
    return range ? t.slice(range.start.offset, range.end.offset) : t;
  },
  positionAt(offset) {
    const t = fs.readFileSync(file, "utf8");
    return { offset, line: t.slice(0, offset).split("\n").length - 1 };
  },
  lineAt(line) {
    const t = fs.readFileSync(file, "utf8").split("\n")[line] ?? "";
    return { text: t, range: { start: { line, character: 0 }, end: { line, character: t.length } } };
  },
  save: async () => true,
  ...over,
});

const fnResolver = (fnName, docComment) => async (document) => {
  const t = document.getText();
  const start = t.indexOf(`pub fn ${fnName}`);
  if (start < 0) {
    return undefined;
  }
  const end = t.indexOf("\n}", start) + 2;
  return {
    span: { start, end },
    signature: t.slice(start, t.indexOf("{", start)).trimEnd(),
    docComment,
    symbolName: fnName,
    languageId: "rust",
  };
};

const recordingPresenter = (file) => {
  const proposals = [];
  return {
    proposals,
    present: async (req) => {
      proposals.push(req);
      const t = fs.readFileSync(file, "utf8");
      fs.writeFileSync(file, t.slice(0, req.span.start) + req.text + t.slice(req.span.end));
      return "accept";
    },
  };
};

const breakParseDuration = (crate) => {
  const file = path.join(crate, "src", "task1.rs");
  fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace('"s" => Some(number),', '"s" => Some("thirty"),'));
  return file;
};

const fnGenLines = (lines) => lines.filter((l) => l.startsWith("[fngen]"));
const modelCallEvidence = (lines) =>
  lines.filter((l) => l.startsWith("[repair] decision") || l.startsWith("[repair] round") || l.startsWith("[fngen] gen"));

// ---- P5-F1/F3: rebuild rejection fails CLOSED on the command path

test("P5-F1/F3 (throwing tier flow): generateFunction with an unresolved tier makes ZERO model-ward progress and says why", async () => {
  resetState();
  __state.config = { repairEnabled: true, apiBase: "http://127.0.0.1:9" };
  const out = output();
  registerFnGen(fakeContext(), out, new ContextBlockStore(() => {}), {
    buildService: async () => {
      throw new Error("boom: tier flow exploded");
    },
  });
  await waitFor(() => out.lines.some((l) => l.startsWith("[carve] tier flow failed")), "rebuild rejection on the record");

  __state.activeTextEditor = {
    document: { languageId: "rust", version: 1, uri: { toString: () => "file:///x.rs" } },
    selection: { active: { line: 0, character: 0 } },
  };
  await __state.commands["column80.generateFunction"]();

  assert.deepStrictEqual(
    __state.executeCalls.map((c) => c.id),
    [],
    "fail closed: an unresolved tier never even consults the symbol provider, let alone a model"
  );
  assert.deepStrictEqual(fnGenLines(out.lines), [], "zero model calls");
  assert.ok(
    out.lines.some((l) => l.startsWith("[carve] fn-gen skipped: tier unresolved")),
    `the skip is on the record, got ${JSON.stringify(out.lines)}`
  );
  const warn = __state.messages.find((m) => m.kind === "warn");
  assert.ok(warn, "the command path gets an honest message, not silence");
  assert.match(warn.message, /hardware tier could not be resolved/);
  assert.match(warn.message, /Select Hardware Tier/, "names the gesture that fixes it");
});

// Generate-path server-down classification: a refused/reset connection or a
// bare "fetch failed" TypeError is the server being down (offer "Start ollama
// serve"), while a real generation fault must NOT be misread as server-down and
// hidden behind the wrong button. isServerUnreachable is the gate for that fork.
test("isServerUnreachable classifies connection failures as server-down and everything else as a real fault", () => {
  const refused = Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
  const reset = Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } });
  const dns = Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } });
  const bareFetch = new TypeError("fetch failed"); // Node without a surfaced cause
  const cases = [
    { name: "ECONNREFUSED", err: refused, want: true },
    { name: "ECONNRESET", err: reset, want: true },
    { name: "ENOTFOUND", err: dns, want: true },
    { name: "bare fetch-failed TypeError", err: bareFetch, want: true },
    { name: "Ollama 500 from a live server", err: new Error("Ollama 500 Internal Server Error"), want: false },
    { name: "model punt / generation fault", err: new Error("model returned an empty body"), want: false },
    { name: "abort", err: Object.assign(new Error("aborted"), { name: "AbortError" }), want: false },
    { name: "non-error value", err: "fetch failed", want: false },
  ];
  for (const c of cases) {
    assert.strictEqual(isServerUnreachable(c.err), c.want, `${c.name} should be ${c.want ? "server-down" : "a real fault"}`);
  }
});

test("P5-F1/F3 (disabled tier, command path): below-12gb surfaces the honest message, zero model-ward progress", async () => {
  resetState();
  __state.config = { repairEnabled: true, apiBase: "http://127.0.0.1:9" };
  const out = output();
  registerFnGen(fakeContext(), out, new ContextBlockStore(() => {}), { probeOpts: noGpuProbe() });
  await waitFor(() => out.lines.some((l) => l.startsWith("[carve] tier=")), "tier resolution");

  __state.activeTextEditor = {
    document: { languageId: "rust", version: 1, uri: { toString: () => "file:///x.rs" } },
    selection: { active: { line: 0, character: 0 } },
  };
  await __state.commands["column80.generateFunction"]();

  assert.deepStrictEqual(__state.executeCalls, [], "no symbol resolution on a disabled tier");
  assert.deepStrictEqual(fnGenLines(out.lines), []);
  assert.ok(out.lines.some((l) => l.startsWith("[carve] fn-gen disabled: ")));
  const warn = __state.messages.find((m) => m.kind === "warn");
  assert.match(warn.message, /no usable GPU detected/);
});

// ---- P5-F1/F3: disabled tier on the FIM-accept path - check-and-surface
// runs, repair ends pre-generateRaw with a logged reason

test("P5-F1/F3 (disabled-tier FIM accept): check-and-surface still runs, repair gate closes pre-generateRaw with reason on the record", async () => {
  resetState();
  __state.config = { repairEnabled: true, apiBase: "http://127.0.0.1:9" };
  const crate = scratchCopy("fimgate");
  try {
    const file = breakParseDuration(crate);
    const doc = fileDocument(file);
    __state.textDocuments = [doc];

    const out = output();
    registerFnGen(fakeContext(), out, new ContextBlockStore(() => {}), { probeOpts: noGpuProbe() });
    await waitFor(() => out.lines.some((l) => l.startsWith("[carve] tier=")), "tier resolution");

    const t = fs.readFileSync(file, "utf8");
    const spanStart = t.indexOf("pub fn parse_duration");
    const spanEnd = t.indexOf("\n}", spanStart) + 2;
    __state.commands["column80.fimAccepted"]("file://" + file, spanStart, spanEnd - spanStart);

    await waitFor(() => out.lines.some((l) => l.startsWith("[repair] surface ")), "the session to surface");

    assert.ok(
      out.lines.some((l) => /^\[oracle\] check done ms=\d+ errors=1 warnings=0 success=false$/.test(l)),
      `check-and-surface ran on the disabled tier, got ${JSON.stringify(out.lines)}`
    );
    assert.ok(
      out.lines.includes("[repair] gate closed reason=tier-disabled"),
      `the pre-generateRaw reason is logged, got ${JSON.stringify(out.lines)}`
    );
    assert.ok(out.lines.includes("[repair] surface why=disabled errors=1 warnings=0"));
    assert.deepStrictEqual(
      modelCallEvidence(out.lines),
      [],
      "zero repair decisions, zero rounds, zero [fngen] traffic on a disabled tier"
    );
  } finally {
    fs.rmSync(crate, { recursive: true, force: true });
  }
});

test("P5-F1/F3 (unresolved-tier FIM accept): repair gate closes with reason=tier-unresolved, check-and-surface still runs", async () => {
  resetState();
  __state.config = { repairEnabled: true, apiBase: "http://127.0.0.1:9" };
  const crate = scratchCopy("fimunres");
  try {
    const file = breakParseDuration(crate);
    const doc = fileDocument(file);
    __state.textDocuments = [doc];

    const out = output();
    registerFnGen(fakeContext(), out, new ContextBlockStore(() => {}), {
      buildService: async () => {
        throw new Error("boom: tier flow exploded");
      },
    });
    await waitFor(() => out.lines.some((l) => l.startsWith("[carve] tier flow failed")), "rebuild rejection");

    const t = fs.readFileSync(file, "utf8");
    const spanStart = t.indexOf("pub fn parse_duration");
    __state.commands["column80.fimAccepted"]("file://" + file, spanStart, 40);

    await waitFor(() => out.lines.some((l) => l.startsWith("[repair] surface ")), "the session to surface");
    assert.ok(out.lines.includes("[repair] gate closed reason=tier-unresolved"), `got ${JSON.stringify(out.lines)}`);
    assert.ok(out.lines.some((l) => l.startsWith("[repair] surface why=disabled")));
    assert.deepStrictEqual(modelCallEvidence(out.lines), []);
  } finally {
    fs.rmSync(crate, { recursive: true, force: true });
  }
});

// ---- P5-F1/F3: enabled tier still repairs (the gate opens, not just closes)

test("P5-F1/F3 (enabled tier control): reference tier + open gate still executes a repair round end to end", async () => {
  resetState();
  __state.config = { repairEnabled: true };
  const crate = scratchCopy("gateopen");
  try {
    const file = breakParseDuration(crate);
    const original = fs.readFileSync(file, "utf8");
    const fnStart = original.indexOf("pub fn parse_duration");
    const fnEnd = original.indexOf("\n}", fnStart) + 2;
    const fixed = original.slice(fnStart, fnEnd).replace('"s" => Some("thirty"),', '"s" => Some(number),');

    const service = new FnGenService(
      { apiBase: "http://fake:1", model: "scripted-30b", fallbackModel: "x", maxTokens: 512, temperature: 0.2 },
      async () => ({ text: "```rust\n" + fixed + "\n```", ttftMs: 1, totalMs: 2, doneReason: "stop" }),
    );
    const out = output();
    await runPostAcceptOracle({
      document: fileDocument(file),
      landedSpan: { start: fnStart, end: fnEnd },
      source: "fim",
      service,
      output: out,
      presenter: recordingPresenter(file),
      resolveFunction: fnResolver("parse_duration"),
      repairTierGate: { allowed: true },
    });
    assert.ok(out.lines.includes("[repair] outcome round=1 result=clean"), `got ${JSON.stringify(out.lines)}`);
    assert.ok(!out.lines.some((l) => l.startsWith("[repair] gate closed")), "an open gate leaves no closed-gate line");
  } finally {
    fs.rmSync(crate, { recursive: true, force: true });
  }
});

// ---- P5-F2: evidence names the model that served the round

test("P5-F2: repair round evidence names the service's actual model, pinned where base and applied models differ", async () => {
  resetState();
  // Base settings say the default 30b; the service (as applyTier would
  // build it on the low-RAM tier) carries a different tag. The evidence
  // must name the tag that served the round.
  __state.config = { repairEnabled: true };
  const crate = scratchCopy("modeltag");
  try {
    const file = breakParseDuration(crate);
    const original = fs.readFileSync(file, "utf8");
    const fnStart = original.indexOf("pub fn parse_duration");
    const fnEnd = original.indexOf("\n}", fnStart) + 2;
    const fixed = original.slice(fnStart, fnEnd).replace('"s" => Some("thirty"),', '"s" => Some(number),');

    const service = new FnGenService(
      { apiBase: "http://fake:1", model: "applied-14b:tier", fallbackModel: "x", maxTokens: 512, temperature: 0.2 },
      async () => ({ text: "```rust\n" + fixed + "\n```", ttftMs: 1, totalMs: 2, doneReason: "stop" }),
    );
    const out = output();
    await runPostAcceptOracle({
      document: fileDocument(file),
      landedSpan: { start: fnStart, end: fnEnd },
      source: "fim",
      service,
      output: out,
      presenter: recordingPresenter(file),
      resolveFunction: fnResolver("parse_duration"),
      repairTierGate: { allowed: true },
    });
    const roundLine = out.lines.find((l) => l.startsWith("[repair] round 1/2 "));
    assert.strictEqual(
      roundLine,
      "[repair] round 1/2 model=applied-14b:tier route=cross-model",
      `evidence must name the model that served the round, got ${JSON.stringify(out.lines.filter((l) => l.startsWith("[repair]")))}`
    );
  } finally {
    fs.rmSync(crate, { recursive: true, force: true });
  }
});
