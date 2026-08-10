// Blind oracle (set B): the repair round must inject the user's manually-added
// context LIVE, read at prompt-assembly time through
// PostAcceptContext.readContextBlocks. Drives a REAL cargo-check repair on a
// broken repairbench function (impl5 end-to-end pattern) with a scripted
// FnGenService whose generate fn CAPTURES the prompt it is handed.
//
// Contract pins:
//  - readContextBlocks present => the captured repair prompt carries the
//    `Context: ...` section for the returned block (the dropped-context bug
//    fixed).
//  - the getter is read LIVE at round time, not snapshotted (invariant bar 3):
//    a getter that records calls must be invoked during the repair.
//  - readContextBlocks absent => no `Context:` section (today's bytes; this one
//    is GREEN before and after).
//
// Never reads the new fnGen command body; drives runPostAcceptOracle directly.
// Expected RED until readContextBlocks is wired into the repair round.
//
// Run: SKIP_LIVE=1 node --test test/blind-repair-livecontext.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const os = require("os");
const esbuild = require("esbuild");

const STUB = path.join(__dirname, ".blind-repair-livecontext-stub.cjs");
fs.writeFileSync(
  STUB,
  `
const state = { collections: [], visibleTextEditors: [], messages: [] };
class Position { constructor(line, character) { this.line = line; this.character = character; } }
class Range {
  constructor(a, b, c, d) {
    if (typeof a === "number") { this.start = new Position(a, b); this.end = new Position(c, d); }
    else { this.start = a; this.end = b; }
  }
}
class ThemeColor { constructor(id) { this.id = id; } }
class MarkdownString { constructor() { this.blocks = []; } appendCodeblock(t) { this.blocks.push(t); } }
class Diagnostic { constructor(range, message, severity) { this.range = range; this.message = message; this.severity = severity; } }
const Uri = {
  file: (p) => ({ fsPath: p, path: p, scheme: "file", toString: () => "file://" + p }),
  parse: (s) => ({ raw: s, toString: () => s }),
};
module.exports = {
  __state: state,
  Position, Range, ThemeColor, MarkdownString, Diagnostic, Uri,
  DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
  workspace: {
    getConfiguration: () => ({ get: (k, fb) => fb, inspect: () => undefined, update: async () => {} }),
  },
  languages: {
    createDiagnosticCollection: (name) => {
      const c = { name, set() {}, delete() {}, clear() {}, dispose() {} };
      state.collections.push(c);
      return c;
    },
  },
  window: {
    createTextEditorDecorationType: (opts) => ({ opts, dispose() {} }),
    get visibleTextEditors() { return state.visibleTextEditors; },
    showWarningMessage: async (message) => { state.messages.push({ kind: "warn", message }); },
    showInformationMessage: async (message) => { state.messages.push({ kind: "info", message }); },
    setStatusBarMessage: () => ({ dispose() {} }),
  },
  commands: {
    executeCommand: async () => undefined,
  },
};
`,
);

const entry = path.join(__dirname, ".blind-repair-livecontext.entry.ts");
const outfile = path.join(__dirname, ".blind-repair-livecontext.bundle.cjs");
fs.writeFileSync(
  entry,
  `export { runPostAcceptOracle } from "../src/vscode/oracleSurface";
export { FnGenService } from "../src/core/fnGenService";\n`,
);
esbuild.buildSync({
  entryPoints: [entry],
  bundle: true,
  outfile,
  format: "cjs",
  platform: "node",
  alias: { vscode: STUB },
});
const { runPostAcceptOracle, FnGenService } = require(outfile);
test.after(() => {
  fs.rmSync(entry, { force: true });
  fs.rmSync(outfile, { force: true });
  fs.rmSync(STUB, { force: true });
});

const REPAIRBENCH = path.join(__dirname, "fixtures", "repairbench");
const scratchCopy = (tag) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `blindrepair-${tag}-`));
  fs.cpSync(REPAIRBENCH, dir, { recursive: true });
  return dir;
};

const breakParseDuration = (crate) => {
  const file = path.join(crate, "src", "task1.rs");
  fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace('"s" => Some(number),', '"s" => Some("thirty"),'));
  return file;
};

const output = () => {
  const lines = [];
  return { lines, appendLine: (l) => lines.push(l) };
};

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

const fnResolver = (fnName) => async (document) => {
  const t = document.getText();
  const start = t.indexOf(`pub fn ${fnName}`);
  if (start < 0) return undefined;
  const end = t.indexOf("\n}", start) + 2;
  return {
    span: { start, end },
    signature: t.slice(start, t.indexOf("{", start)).trimEnd(),
    docComment: undefined,
    symbolName: fnName,
    languageId: "rust",
  };
};

const recordingPresenter = (file) => ({
  present: async (req) => {
    const t = fs.readFileSync(file, "utf8");
    fs.writeFileSync(file, t.slice(0, req.span.start) + req.text + t.slice(req.span.end));
    return "accept";
  },
});

// A scripted FnGenService that (a) captures every prompt it is handed and
// (b) returns the known-good fixed body so the round completes cleanly.
const capturingService = (fixed) => {
  const prompts = [];
  const service = new FnGenService(
    { apiBase: "http://fake:1", model: "scripted-30b", fallbackModel: "x", maxTokens: 512, temperature: 0.2 },
    async ({ prompt }) => {
      prompts.push(prompt);
      return { text: "```rust\n" + fixed + "\n```", ttftMs: 1, totalMs: 2, doneReason: "stop" };
    },
  );
  return { service, prompts };
};

const fixedBody = (file, fnStart, fnEnd) =>
  fs
    .readFileSync(file, "utf8")
    .slice(fnStart, fnEnd)
    .replace('"s" => Some("thirty"),', '"s" => Some(number),');

const runRepair = async (readContextBlocks) => {
  const crate = scratchCopy("live");
  try {
    const file = breakParseDuration(crate);
    const t = fs.readFileSync(file, "utf8");
    const fnStart = t.indexOf("pub fn parse_duration");
    const fnEnd = t.indexOf("\n}", fnStart) + 2;
    const fixed = fixedBody(file, fnStart, fnEnd);
    const { service, prompts } = capturingService(fixed);
    const out = output();
    const ctx = {
      document: fileDocument(file),
      landedSpan: { start: fnStart, end: fnEnd },
      source: "fim",
      service,
      output: out,
      presenter: recordingPresenter(file),
      resolveFunction: fnResolver("parse_duration"),
      repairTierGate: { allowed: true },
    };
    if (readContextBlocks) ctx.readContextBlocks = readContextBlocks;
    await runPostAcceptOracle(ctx);
    return { prompts, out };
  } finally {
    fs.rmSync(crate, { recursive: true, force: true });
  }
};

const CTX_BLOCK = { uri: "file:///notes/pool.rs", range: { startLine: 10, endLine: 12 }, text: "// desired: pool.max = 8\n" };
const CTX_SECTION = "Context: file:///notes/pool.rs#L10-L12\n```\n// desired: pool.max = 8\n```";

test("readContextBlocks present: the captured repair prompt carries the Context section for the returned block", async () => {
  const { prompts, out } = await runRepair(() => [CTX_BLOCK]);
  assert.ok(prompts.length > 0, `a repair round must have fired, got lines ${JSON.stringify(out.lines)}`);
  assert.ok(
    prompts.some((p) => p.includes(CTX_SECTION)),
    `the manually-added context must reach the repair prompt, got prompt:\n${prompts[0]}`
  );
});

test("bar 3 (live read): readContextBlocks is invoked DURING the repair round, not snapshotted, and the prompt reflects its return", async () => {
  let calls = 0;
  const { prompts } = await runRepair(() => {
    calls += 1;
    return [CTX_BLOCK];
  });
  assert.ok(prompts.length > 0, "a repair round must have fired");
  assert.ok(calls > 0, "the getter must be read live at round time");
  assert.ok(prompts.some((p) => p.includes(CTX_SECTION)), "the prompt reflects the getter's live return");
});

// GREEN before and after: absent getter keeps today's no-context bytes.
test("readContextBlocks absent: the repair prompt has no Context section (today's bytes preserved)", async () => {
  const { prompts } = await runRepair(undefined);
  assert.ok(prompts.length > 0, "a repair round must have fired");
  assert.ok(prompts.every((p) => !p.includes("Context:")), "no context is injected when no getter is provided");
});
