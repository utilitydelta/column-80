// REVIEW rows - the session-v48 phase 2+3 adversarial-review loop-back.
//
// Seven defects, all ruled DO. These rows are the evidence, and the ones that
// matter most are driven through the REAL gesture path rather than through the
// seam they share, because the whole of D1 is that three of the four ways into
// the model never reached the guard at all:
//
//   D1/D7 - `generateRaw` and `generateTests` now estimate the prompt they were
//           handed and REFUSE when it does not fit. Four call sites prove it:
//           the punt circle-back retry and test-gen through the registered
//           commands (harness C), repair and refine through
//           `runPostAcceptOracle` against a real cargo check (harness R).
//   D2    - the refusal message states ALL THREE shares and offers only the
//           remedies that apply to the case in hand.
//   D3    - a `budget` drop reports the cap that ACTUALLY bound, per-walk or
//           shared aggregate.
//   D4    - one entry per dropped type, attributed to the cause that lost it.
//   D5    - the arbitration line overrides the pre-fill's "raise the stop".
//   D6    - the estimate is conservative on dense source and on non-ASCII text.
//
// Run: SKIP_LIVE=1 node --test test/review-v48-p2-loopback.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const os = require("os");
const esbuild = require("esbuild");

const NUM_CTX = 16384;
const MAX_TOKENS = 2048;
const AVAILABLE = NUM_CTX - MAX_TOKENS;

// ===========================================================================
// HARNESS R - the oracle surface over a real cargo check (the
// blind-repair-livecontext pattern). Repair and refine live here.
// ===========================================================================

const R_STUB = path.join(__dirname, ".review-v48-p2-r-stub.cjs");
fs.writeFileSync(
  R_STUB,
  `
const state = { config: {}, collections: [], visibleTextEditors: [], messages: [] };
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
  parse: (s) => { const p = String(s).startsWith("file://") ? String(s).slice(7) : String(s); return { raw: s, fsPath: p, path: p, scheme: "file", toString: () => String(s) }; },
};
module.exports = {
  __state: state,
  Position, Range, ThemeColor, MarkdownString, Diagnostic, Uri,
  DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
  workspace: {
    textDocuments: [],
    getConfiguration: () => ({
      get: (k, fb) => (k in state.config ? state.config[k] : fb),
      inspect: () => undefined,
      update: async () => {},
    }),
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
  commands: { executeCommand: async () => undefined },
};
`,
);

const R_ENTRY = path.join(__dirname, ".review-v48-p2-r.entry.ts");
const R_OUT = path.join(__dirname, ".review-v48-p2-r.bundle.cjs");
fs.writeFileSync(
  R_ENTRY,
  `export { runPostAcceptOracle } from "../src/vscode/oracleSurface";
export { FnGenService } from "../src/core/fnGenService";
export { __state } from "vscode";\n`,
);
esbuild.buildSync({ entryPoints: [R_ENTRY], bundle: true, outfile: R_OUT, format: "cjs", platform: "node", alias: { vscode: R_STUB } });
const R = require(R_OUT);

// ===========================================================================
// HARNESS C - the registered commands over a structural stub (the
// impl-v3-structgen pattern). The punt circle-back and test-gen live here.
// ===========================================================================

const C_STUB = path.join(__dirname, ".review-v48-p2-c-stub.cjs");
fs.writeFileSync(
  C_STUB,
  `
const state = {
  config: {}, messages: [], warnResponses: [], infoResponses: [], commands: {},
  executeCalls: [], symbols: undefined, activeTextEditor: undefined, docVersion: 1,
  textDocuments: [],
};
class Position { constructor(line, character) { this.line = line; this.character = character; } }
class Range {
  constructor(a, b, c, d) {
    if (typeof a === "number") { this.start = new Position(a, b); this.end = new Position(c, d); }
    else { this.start = a; this.end = b; }
  }
  contains(p) {
    const afterStart = p.line > this.start.line || (p.line === this.start.line && p.character >= this.start.character);
    const beforeEnd = p.line < this.end.line || (p.line === this.end.line && p.character <= this.end.character);
    return afterStart && beforeEnd;
  }
}
class EventEmitter { constructor(){ this.h=[]; } get event(){ return (fn)=>{ this.h.push(fn); return {dispose(){}}; }; } fire(x){ for (const f of this.h) f(x); } dispose(){} }
class WorkspaceEdit { replace() {} }
class SnippetString { constructor(v) { this.value = v || ""; } }
const Uri = {
  file: (p) => ({ fsPath: p, path: p, scheme: "file", toString: () => "file://" + p }),
  parse: (s) => ({ raw: s, fsPath: String(s), toString: () => String(s) }),
  from: (o) => ({ ...o, toString: () => o.scheme + "://" + o.path + "?" + (o.query ?? "") }),
};
const SymbolKind = { Method: 5, Field: 7, Constructor: 8, Enum: 9, Function: 11, EnumMember: 21, Struct: 22 };
module.exports = {
  __state: state,
  Position, Range, EventEmitter, WorkspaceEdit, SnippetString, Uri, SymbolKind,
  ProgressLocation: { Notification: 15, Window: 10 },
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
    openTextDocument: async () => undefined,
    applyEdit: async () => true,
  },
  window: {
    get activeTextEditor() { return state.activeTextEditor; },
    showInformationMessage: async (message, ...a) => { state.messages.push({ kind: "info", message, a }); return state.infoResponses.shift(); },
    showWarningMessage: async (message, ...a) => { state.messages.push({ kind: "warn", message, a }); return state.warnResponses.shift(); },
    showErrorMessage: async (message) => { state.messages.push({ kind: "error", message }); },
    withProgress: async (opts, task) => task({ report: () => {} }, { onCancellationRequested: () => ({ dispose() {} }) }),
    setStatusBarMessage: () => ({ dispose() {} }),
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

const C_ENTRY = path.join(__dirname, ".review-v48-p2-c.entry.ts");
const C_OUT = path.join(__dirname, ".review-v48-p2-c.bundle.cjs");
fs.writeFileSync(
  C_ENTRY,
  `export { registerFnGen } from "../src/vscode/fnGen";
export { FnGenService } from "../src/core/fnGenService";
export { ContextBlockStore } from "../src/core/contextBlocks";
export { assembleFnGenPrompt } from "../src/core/prompt";
export { estimateTextTok, promptRefusalMessage, arbitratePrompt } from "../src/core/promptBudget";
export { walkDataShape } from "../src/core/dataShape";
export { Position, Range, SymbolKind, __state } from "vscode";\n`,
);
esbuild.buildSync({ entryPoints: [C_ENTRY], bundle: true, outfile: C_OUT, format: "cjs", platform: "node", alias: { vscode: C_STUB } });
const C = require(C_OUT);

test.after(() => {
  for (const f of [R_STUB, R_ENTRY, R_OUT, C_STUB, C_ENTRY, C_OUT]) {
    fs.rmSync(f, { force: true });
  }
});

// ---------------------------------------------------------------------------
// Shared fixtures.
// ---------------------------------------------------------------------------

// ~72k characters of the developer's own context: ~24k tokens at the ASCII
// rate, against a 14336-token window. Nothing the arbitration may shrink.
const HUGE_BLOCK = {
  uri: "file:///work/notes/huge.rs",
  range: { startLine: 1, endLine: 2 },
  text: `// the developer's own file\npub const NOTES: &str = "${"n".repeat(72000)}";\n`,
};

const output = () => {
  const lines = [];
  return { lines, appendLine: (l) => lines.push(l) };
};

const refusalLines = (lines) => lines.filter((l) => l.startsWith("[fngen] refused:"));
const genLines = (lines) => lines.filter((l) => l.startsWith("[fngen] gen "));

// ===========================================================================
// D1 - PATHS 1 AND 2: repair and refine, through runPostAcceptOracle against a
// real cargo check.
// ===========================================================================

const REPAIRBENCH = path.join(__dirname, "fixtures", "repairbench");
const scratchCopy = (tag) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `rv48-${tag}-`));
  fs.cpSync(REPAIRBENCH, dir, { recursive: true });
  return dir;
};

const fileDocument = (file) => ({
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
    const pre = t.slice(0, offset);
    const line = pre.split("\n").length - 1;
    return { offset, line, character: offset - (pre.lastIndexOf("\n") + 1) };
  },
  lineAt(line) {
    const t = fs.readFileSync(file, "utf8").split("\n")[line] ?? "";
    return { text: t, range: { start: { line, character: 0 }, end: { line, character: t.length } } };
  },
  save: async () => true,
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
    headerIndent: "",
    bodyIndent: "    ",
  };
};

// A real FnGenService with a LOCAL window, whose transport records every call
// it is asked to make. If the array is empty, nothing was sent.
const windowedService = (out) => {
  const prompts = [];
  const service = new R.FnGenService(
    { apiBase: "http://127.0.0.1:1", model: "fake-30b", maxTokens: MAX_TOKENS, temperature: 0.2, numCtx: NUM_CTX },
    async ({ prompt }) => {
      prompts.push(prompt);
      return { text: "```rust\nfn x() {}\n```", ttftMs: 1, totalMs: 2, doneReason: "stop" };
    },
    // The service's own channel IS the extension's output channel in the
    // product (buildFnGenService wires them together), so the refusal line has
    // to land where the [repair] lines land.
    (l) => out.lines.push(String(l)),
  );
  return { service, prompts };
};

const breakParseDuration = (crate) => {
  const file = path.join(crate, "src", "task1.rs");
  fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace('"s" => Some(number),', '"s" => Some("thirty"),'));
  return file;
};

test("D1 path 1 [repair]: an over-window repair prompt is refused, not sent, and the developer is told", async () => {
  R.__state.config = { repairEnabled: true };
  R.__state.messages = [];
  const crate = scratchCopy("repair");
  try {
    const file = breakParseDuration(crate);
    const t = fs.readFileSync(file, "utf8");
    const fnStart = t.indexOf("pub fn parse_duration");
    const fnEnd = t.indexOf("\n}", fnStart) + 2;
    const out = output();
    const { service, prompts } = windowedService(out);
    await R.runPostAcceptOracle({
      document: fileDocument(file),
      landedSpan: { start: fnStart, end: fnEnd },
      source: "fim",
      service,
      output: out,
      presenter: { present: async () => "reject" },
      resolveFunction: fnResolver("parse_duration"),
      repairTierGate: { allowed: true },
      readContextBlocks: async () => [HUGE_BLOCK],
    });
    assert.ok(
      out.lines.some((l) => l.startsWith("[repair] round 1/2")),
      `the repair round must have been reached: ${JSON.stringify(out.lines)}`,
    );
    assert.deepStrictEqual(prompts, [], "P4: no model call - the oversized repair prompt was never sent");
    const refused = refusalLines(out.lines);
    assert.strictEqual(refused.length, 1, `one refusal line on the channel, got ${JSON.stringify(out.lines)}`);
    assert.match(refused[0], new RegExp(String(AVAILABLE)), "the channel line states the window");
    const warn = R.__state.messages.find((m) => m.kind === "warn" && /^Column 80: /.test(m.message));
    assert.ok(warn, `the refusal must reach the user, not just the channel: ${JSON.stringify(R.__state.messages)}`);
    assert.match(warn.message, /does not fit/, warn.message);
  } finally {
    fs.rmSync(crate, { recursive: true, force: true });
  }
});

test("D1 path 2 [refine]: an over-window refine prompt is refused, not sent, and the developer is told", async () => {
  R.__state.config = { repairEnabled: true };
  R.__state.messages = [];
  const crate = scratchCopy("refine");
  try {
    // A CLEAN crate: refine is the branch of the same decision that fires when
    // the compiler has nothing to say. It is a direct user gesture reachable
    // with no preceding generation, which is why it is the sharpest case.
    const file = path.join(crate, "src", "task1.rs");
    const t = fs.readFileSync(file, "utf8");
    const fnStart = t.indexOf("pub fn parse_duration");
    const fnEnd = t.indexOf("\n}", fnStart) + 2;
    // A real, readable usage site OUTSIDE the span for the reference leg to
    // return, so a usage window can actually be cut and a prompt assembled.
    const caller = path.join(crate, "src", "callers.rs");
    fs.writeFileSync(caller, "pub fn demo() {\n    let n = \"30s\".parse::<u64>().ok();\n    let _ = n;\n}\n");
    const out = output();
    const { service, prompts } = windowedService(out);
    await R.runPostAcceptOracle({
      document: fileDocument(file),
      landedSpan: { start: fnStart, end: fnEnd },
      source: "manual",
      service,
      output: out,
      presenter: { present: async () => "reject" },
      resolveFunction: fnResolver("parse_duration"),
      repairTierGate: { allowed: true },
      manualRefine: true,
      extractor: {
        references: async () => [{ uri: "file://" + caller, line: 1 }],
        definition: async () => undefined,
        hoverSurface: async () => undefined,
        membersOfType: async () => [],
        example: async () => undefined,
        completeMembers: async () => [],
        qualifyImport: async () => undefined,
      },
      readContextBlocks: async () => [HUGE_BLOCK],
    });
    assert.ok(
      out.lines.some((l) => /^\[repair\] refine round 1\//.test(l)),
      `the refine round must have been reached: ${JSON.stringify(out.lines)}`,
    );
    assert.deepStrictEqual(prompts, [], "P4: no model call - the oversized refine prompt was never sent");
    assert.strictEqual(refusalLines(out.lines).length, 1, `one refusal line, got ${JSON.stringify(out.lines)}`);
    const warn = R.__state.messages.find((m) => m.kind === "warn" && /^Column 80: /.test(m.message));
    assert.ok(warn, `roadmap item 43's "no guard on any path" was literally true for refine: ${JSON.stringify(R.__state.messages)}`);
  } finally {
    fs.rmSync(crate, { recursive: true, force: true });
  }
});

// ===========================================================================
// D1 - PATHS 3 AND 4: the punt circle-back retry and test-gen, through the
// registered commands.
// ===========================================================================

const posAt = (text, off) => {
  const pre = text.slice(0, off);
  return new C.Position(pre.split("\n").length - 1, off - (pre.lastIndexOf("\n") + 1));
};
const rangeFor = (text, a, b) => new C.Range(posAt(text, a), posAt(text, b));

function memDoc(text, over = {}) {
  const lineStart = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") lineStart.push(i + 1);
  const offsetOf = (line, character) => lineStart[line] + character;
  return {
    languageId: "rust",
    fileName: "/work/x.rs",
    isDirty: false,
    isClosed: false,
    get version() {
      return C.__state.docVersion;
    },
    uri: { fsPath: "/work/x.rs", path: "/work/x.rs", scheme: "file", toString: () => "file:///work/x.rs" },
    getText(range) {
      if (!range) return text;
      return text.slice(offsetOf(range.start.line, range.start.character), offsetOf(range.end.line, range.end.character));
    },
    offsetAt(pos) {
      return offsetOf(pos.line, pos.character);
    },
    positionAt(off) {
      let line = 0;
      while (line + 1 < lineStart.length && lineStart[line + 1] <= off) line++;
      return new C.Position(line, off - lineStart[line]);
    },
    lineAt(line) {
      const t = text.split("\n")[line] ?? "";
      return { text: t, lineNumber: line, firstNonWhitespaceCharacterIndex: t.length - t.trimStart().length };
    },
    save: async () => true,
    ...over,
  };
}

const resetC = () => {
  C.__state.config = {};
  C.__state.messages = [];
  C.__state.warnResponses = [];
  C.__state.infoResponses = [];
  C.__state.commands = {};
  C.__state.executeCalls = [];
  C.__state.symbols = undefined;
  C.__state.activeTextEditor = undefined;
  C.__state.docVersion = 1;
  C.__state.textDocuments = [];
};

// The target: a plain Rust function with a doc comment. `fnSrc(docChars)` pads
// the DOC COMMENT, which is charged to the irreducible `fixed` share.
function fnSrc(docChars) {
  const pad = docChars > 0 ? `/// ${"z".repeat(docChars)}\n` : "";
  return `//! Fixture.\n\n/// Adds two numbers.\n${pad}pub fn add(a: i32, b: i32) -> i32 {\n    todo!()\n}\n`;
}

function fnSymbols(src) {
  const docOff = src.indexOf("/// Adds two numbers.");
  const fnOff = src.indexOf("pub fn add");
  const closeOff = src.indexOf("\n}", fnOff) + 2;
  const nameOff = src.indexOf("add", fnOff);
  return [
    {
      name: "add",
      kind: C.SymbolKind.Function,
      range: rangeFor(src, docOff, closeOff),
      selectionRange: rangeFor(src, nameOff, nameOff + 3),
      children: [],
    },
  ];
}

const waitFor = async (predicate, what, tries = 800) => {
  for (let i = 0; i < tries; i++) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.fail(`timed out waiting for ${what}`);
};

test("D1 path 3 [punt retry]: the circle-back prompt is refused rather than sent, and the stub's reason reaches the user", async () => {
  resetC();
  // Injection on: the punt circle-back is gated on it.
  C.__state.config = { compilerDirectedInjection: true, apiBase: "http://127.0.0.1:1", fnGenModel: "fake-30b" };
  const src = fnSrc(0);
  C.__state.symbols = fnSymbols(src);
  const doc = memDoc(src);
  C.__state.activeTextEditor = { document: doc, selection: { active: posAt(src, src.indexOf("pub fn add") + 4) } };

  // THE DEFECT, in fixture form, at the size the review measured it: a first
  // prompt that PASSES arbitration close to the line (the developer's own
  // context blocks are what put it there), answered with a stub of the size a
  // 2048-token ceiling allows. The retry is that stub PLUS the original prompt
  // PLUS the anti-punt directive, so it is strictly larger than the prompt that
  // just passed - and it was going out unchecked.
  const ctxUri = "file:///work/notes.rs";
  const ctxText = `// the developer's own notes\npub const NOTES: &str = "${"n".repeat(40000)}";\n`;
  C.__state.textDocuments = [{ uri: { toString: () => ctxUri }, getText: () => ctxText }];
  const store = new C.ContextBlockStore(() => {});
  store.add({ uri: ctxUri, range: { startLine: 1, endLine: 2 }, text: ctxText, version: 1 });
  const stub = `pub fn add(a: i32, b: i32) -> i32 {\n${"    // reasoning about why this cannot be written yet\n".repeat(120)}    todo!()\n}`;
  const prompts = [];
  const out = output();
  const service = new C.FnGenService(
    { apiBase: "http://127.0.0.1:1", model: "fake-30b", maxTokens: MAX_TOKENS, temperature: 0.2, numCtx: NUM_CTX },
    async ({ prompt }) => {
      prompts.push(prompt);
      // The document moves once the first generation is served, so the preview
      // discards on its own staleness guard instead of blocking this test on a
      // consent gate that has no UI here. Nothing under test runs after it.
      C.__state.docVersion += 1;
      return { text: "```rust\n" + stub + "\n```", ttftMs: 1, totalMs: 2, doneReason: "stop" };
    },
    // The service logs to the extension's output channel in the product, so the
    // refusal line has to land beside the command's own lines.
    (l) => out.lines.push(String(l)),
  );
  C.registerFnGen({ subscriptions: [], globalStorageUri: { fsPath: "/tmp/rv48" } }, out, store, {
    buildService: async () => ({ service, tier: { fnGenEnabled: true, message: "ok" }, config: { numCtx: NUM_CTX } }),
  });
  await C.__state.commands["column80.generateFunction"]();
  await waitFor(
    () => out.lines.some((l) => l.includes("punt regeneration refused")),
    `the punt retry's refusal line; channel was ${JSON.stringify(out.lines)}`,
  );

  assert.strictEqual(prompts.length, 1, `exactly one model call: the retry was refused, not sent (got ${prompts.length})`);
  assert.strictEqual(refusalLines(out.lines).length, 1, `one refusal line, got ${JSON.stringify(out.lines.slice(-8))}`);
  const warn = C.__state.messages.find((m) => m.kind === "warn" && /^Column 80: /.test(m.message));
  assert.ok(warn, `the human is about to be shown a stub and is owed the reason: ${JSON.stringify(C.__state.messages)}`);
  assert.match(warn.message, /does not fit/, warn.message);
  assert.match(warn.message, /stub/, "and it says which gesture was refused");
});

test("D1 path 4 [test-gen]: an over-window test prompt is refused rather than sent", async () => {
  resetC();
  C.__state.config = { compilerDirectedInjection: true, apiBase: "http://127.0.0.1:1", fnGenModel: "fake-30b" };
  // 60k characters of doc comment. The contract IS the test-gen prompt, so a
  // doc that large is over the window on its own - and it is the D2 case too:
  // no context blocks, no injection, the `fixed` share alone.
  const src = fnSrc(60000);
  const crate = scratchCopy("testgen");
  const target = path.join(crate, "src", "target.rs");
  fs.writeFileSync(target, src);
  C.__state.symbols = fnSymbols(src);
  const doc = memDoc(src, { fileName: target, uri: { fsPath: target, path: target, scheme: "file", toString: () => "file://" + target } });
  C.__state.activeTextEditor = { document: doc, selection: { active: posAt(src, src.indexOf("pub fn add") + 4) } };
  const prompts = [];
  const out = output();
  const service = new C.FnGenService(
    { apiBase: "http://127.0.0.1:1", model: "fake-30b", maxTokens: MAX_TOKENS, temperature: 0.2, numCtx: NUM_CTX },
    async ({ prompt }) => {
      prompts.push(prompt);
      return { text: "```rust\n#[cfg(test)]\nmod tests { #[test] fn t() { assert_eq!(1, 1); } }\n```", ttftMs: 1, totalMs: 2, doneReason: "stop" };
    },
    (l) => out.lines.push(String(l)),
  );
  C.registerFnGen({ subscriptions: [], globalStorageUri: { fsPath: "/tmp/rv48" } }, out, new C.ContextBlockStore(() => {}), {
    buildService: async () => ({ service, tier: { fnGenEnabled: true, message: "ok" }, config: { numCtx: NUM_CTX } }),
  });
  await C.__state.commands["column80.generateTests"]();

  assert.deepStrictEqual(prompts, [], "no model call: the oversized test prompt was never sent");
  assert.strictEqual(refusalLines(out.lines).length, 1, `one refusal line, got ${JSON.stringify(out.lines.slice(-8))}`);
  const warn = C.__state.messages.find((m) => m.kind === "warn" && /^Column 80: /.test(m.message));
  assert.ok(warn, `test-gen must surface the refusal too: ${JSON.stringify(C.__state.messages)}`);
  // D2 in the same breath: nothing here is a context block and nothing is
  // injected, so the message must not tell them to remove one.
  assert.match(warn.message, /request itself is over the window/, warn.message);
  fs.rmSync(crate, { recursive: true, force: true });
});

// ===========================================================================
// D2 - the refusal message states all three shares, and only applicable
// remedies.
// ===========================================================================

const refuseWith = (developerTok, fixedTok) =>
  C.arbitratePrompt({
    windowed: true,
    numCtx: NUM_CTX,
    maxTokens: MAX_TOKENS,
    developerTok,
    fixedTok,
    injectedBlocks: 0,
    injectedTokFor: () => 0,
  });

test("D2: the message states ALL THREE shares, so the numbers it quotes add up", () => {
  const d = refuseWith(9000, 9000);
  const msg = C.promptRefusalMessage(d);
  assert.match(msg, /9000 tokens/, `the developer's share: ${msg}`);
  assert.match(msg, /is 0 tokens/, `the injected share, stated even at zero: ${msg}`);
  assert.match(msg, /about 9000 tokens are the request itself/, `the fixed share, which used to be missing entirely: ${msg}`);
  // The three shares account for the total, which is what the old message could
  // not do: it quoted 34842 tokens and named 0 of them.
  assert.match(msg, new RegExp(`about ${d.totalTok} tokens against`), msg);
  assert.equal(d.developerTok + d.injectedTok + d.fixedTok, d.totalTok, "and the arithmetic actually closes");
});

test("D2: when `fixed` alone overflows, the message says so and does not tell them to remove a context block", () => {
  // The reachable case from the review: a function whose body is a long
  // commented-out block, no context blocks, no injection.
  const msg = C.promptRefusalMessage(refuseWith(0, AVAILABLE + 5000));
  assert.match(msg, /request itself is over the window before any context is added/, msg);
  assert.match(msg, /doc comment|commented-out body/, "and it names what `fixed` is made of, which they can act on");
  assert.ok(!/Remove a context block/.test(msg), `it must not offer a remedy that cannot work: ${msg}`);
  assert.match(msg, /Lowering `column80\.injectedContext` will not help/, "and it says the dial is not the answer either");
});

test("D2: when their context is the weight, removing a block IS offered - the remedy tracks the case", () => {
  const msg = C.promptRefusalMessage(refuseWith(AVAILABLE + 100, 200));
  assert.match(msg, /Remove a context block/, msg);
  assert.match(msg, /Lowering `column80\.injectedContext` will not help/, "the dial is still named, and still honestly");
});

// ===========================================================================
// D3 / D4 - the drop ledger.
// ===========================================================================

const wideGraph = (n) => {
  const kids = Array.from({ length: n }, (_, i) => `K${String(i).padStart(2, "0")}`);
  const map = new Map();
  map.set("Root", {
    def: "pub struct Root {\n" + kids.map((k, i) => `    f${i}: ${k},`).join("\n") + "\n}",
    fields: kids.map((k, i) => ({ name: `f${i}`, typeName: k, isLocal: true })),
  });
  for (const k of kids) {
    map.set(k, { def: `pub struct ${k} {\n    slot_number_field: u32,\n    label_for_the_slot: String,\n}`, fields: [] });
  }
  return { map, kids };
};

test("D3: a budget drop reports the SHARED aggregate when that is what bound, not the per-walk cap", () => {
  const { map } = wideGraph(12);
  // A generous per-walk TOK_MAX against an almost-spent shared aggregate: the
  // aggregate is the binder, and the pre-D3 line would have printed 5000.
  const shared = { visited: new Set(), remainingChars: 120, droppedBy: new Map() };
  const out = C.walkDataShape("Root", (t) => map.get(t), { D_MAX: 2, B_MAX: 12, N_MAX: 20, TOK_MAX: 5000 }, shared);
  const budgetDrops = out.droppedBy.filter((d) => d.cause === "budget");
  assert.ok(budgetDrops.length > 0, `the fixture must produce budget drops: ${JSON.stringify(out.droppedBy)}`);
  for (const d of budgetDrops) {
    assert.ok(d.budgetBound, `every budget drop carries the bound that did it: ${JSON.stringify(d)}`);
    assert.strictEqual(d.budgetBound.kind, "shared", "the aggregate was tighter than the walk's own 5000 tok");
    assert.strictEqual(d.budgetBound.tok, 30, "120 chars is 30 tok, and 30 is the number that was in force");
  }
});

test("D3: with no shared state the per-walk cap is the binder, and it is reported as such", () => {
  const { map } = wideGraph(12);
  const out = C.walkDataShape("Root", (t) => map.get(t), { D_MAX: 2, B_MAX: 12, N_MAX: 20, TOK_MAX: 30 });
  const budgetDrops = out.droppedBy.filter((d) => d.cause === "budget");
  assert.ok(budgetDrops.length > 0);
  assert.strictEqual(budgetDrops[0].budgetBound.kind, "walk");
  assert.strictEqual(budgetDrops[0].budgetBound.tok, 30);
});

test("D4: one entry per dropped type, and the cause is the one that actually lost it", () => {
  // The review's shape: a type refused at one node's breadth cap, reached again
  // via another node, emitted, then lost to the render budget. Pre-D4 it
  // appeared TWICE with two different causes and inflated every count.
  const map = new Map();
  map.set("Root", {
    def: "pub struct Root {\n    a: A,\n    b: B,\n    c: C,\n}",
    fields: [
      { name: "a", typeName: "A", isLocal: true },
      { name: "b", typeName: "B", isLocal: true },
      { name: "c", typeName: "C", isLocal: true },
    ],
  });
  map.set("A", { def: "pub struct A {\n    padding_field_name: u32,\n}", fields: [] });
  map.set("B", { def: "pub struct B {\n    padding_field_name: u32,\n}", fields: [] });
  map.set("C", { def: "pub struct C {\n    padding_field_name: u32,\n}", fields: [] });
  // B_MAX=1 drops B and C at the root's fan-out; the tiny render budget then
  // loses A and Root as well.
  const out = C.walkDataShape("Root", (t) => map.get(t), { D_MAX: 2, B_MAX: 1, N_MAX: 20, TOK_MAX: 4 });
  assert.strictEqual(new Set(out.dropped).size, out.dropped.length, `no name may appear twice: ${JSON.stringify(out.dropped)}`);
  assert.strictEqual(out.droppedBy.length, out.dropped.length, "droppedBy stays parallel to dropped");
  for (const d of out.droppedBy) {
    assert.ok(!out.block.includes(`pub struct ${d.name} `), `${d.name} is reported dropped and also emitted`);
  }
});

test("D4: the per-gesture ledger keeps ONE entry per name, so its size is a count of distinct types", () => {
  const ledger = new Map();
  const shared = { visited: new Set(), remainingChars: 200, droppedBy: ledger };
  const { map } = wideGraph(8);
  C.walkDataShape("Root", (t) => map.get(t), { D_MAX: 2, B_MAX: 2, N_MAX: 20, TOK_MAX: 4000 }, shared);
  // A second walk over the same graph re-loses some of the same names.
  C.walkDataShape("Root", (t) => map.get(t), { D_MAX: 2, B_MAX: 2, N_MAX: 20, TOK_MAX: 4000 }, shared);
  const names = [...ledger.keys()];
  assert.strictEqual(new Set(names).size, names.length, "a Map cannot double-count, which is the point of keying by name");
  for (const [name, entry] of ledger) {
    assert.strictEqual(entry.name, name, "the ledger's value is the whole DroppedType, cause and bound included");
    assert.ok(["total-types", "breadth", "budget"].includes(entry.cause));
  }
});

// ===========================================================================
// D5 - the arbitration line overrides the pre-fill's "raise the stop".
// ===========================================================================

test("D5: a refusal line explicitly supersedes the earlier `raise column80.injectedContext` advice", () => {
  const lines = [];
  const service = new C.FnGenService(
    { apiBase: "http://127.0.0.1:1", model: "fake-30b", maxTokens: MAX_TOKENS, temperature: 0.2, numCtx: NUM_CTX },
    async () => ({ text: "x", ttftMs: 1, totalMs: 2 }),
    (l) => lines.push(String(l)),
  );
  return service
    .generate({ signature: "pub fn add(a: i32, b: i32) -> i32", languageId: "rust", contextBlocks: [HUGE_BLOCK] })
    .then(
      () => assert.fail("this prompt must be refused"),
      () => {
        const refused = lines.find((l) => l.startsWith("[fngen] refused:"));
        assert.ok(refused, JSON.stringify(lines));
        assert.match(
          refused,
          /raise `column80\.injectedContext`" advice logged earlier in this gesture is superseded/,
          `the pre-fill's own line is already out and cannot be recalled: ${refused}`,
        );
        service.dispose();
      },
    );
});

test("D5: a shrink line carries the same override, because raising the stop enlarges exactly what was cut", () => {
  const lines = [];
  const service = new C.FnGenService(
    { apiBase: "http://127.0.0.1:1", model: "fake-30b", maxTokens: MAX_TOKENS, temperature: 0.2, numCtx: NUM_CTX },
    async () => ({ text: "```rust\npub fn add(a: i32, b: i32) -> i32 { 0 }\n```", ttftMs: 1, totalMs: 2 }),
    (l) => lines.push(String(l)),
  );
  const block = { uri: "file:///work/dev.rs", range: { startLine: 0, endLine: 1 }, text: `// dev\npub const P: &str = "${"d".repeat(36000)}";\n` };
  const surface = Array.from(
    { length: 200 },
    (_, i) => "Data shape of `T" + i + "` (fields and types, nested):\n```rust\npub struct T" + i + " { s: u32 }\n```",
  ).join("\n\n");
  return service
    .generate({ signature: "pub fn add(a: i32, b: i32) -> i32", languageId: "rust", contextBlocks: [block], injectedSurface: surface })
    .then((r) => {
      assert.ok(r, "this case shrinks rather than refusing");
      const shrunk = lines.find((l) => l.includes("injected surface shrunk"));
      assert.ok(shrunk, JSON.stringify(lines));
      assert.match(shrunk, /is superseded/, shrunk);
      service.dispose();
    });
});

// ===========================================================================
// D6 - the estimate is conservative in the direction the contract requires.
// ===========================================================================

test("D6: same UTF-16 length, very different cost - the old chars/4 could not tell them apart", () => {
  const N = 25355;
  const ascii = "a".repeat(N);
  const cjk = "数".repeat(N);
  // One unit short of N, because an astral character is two UTF-16 units and
  // N is odd; the old chars/4 estimate is the same 6339 either way.
  const emoji = "🙂".repeat((N - 1) / 2);
  const old = (s) => Math.ceil(s.length / 4);
  for (const s of [ascii, cjk, emoji]) {
    assert.strictEqual(old(s), 6339, "the old estimate: identical for all three");
  }
  assert.strictEqual(C.estimateTextTok(ascii), 8452, "ASCII now charges at 3 chars/token");
  assert.strictEqual(C.estimateTextTok(cjk), N, "CJK charges a token per character, which is what a BPE of this class does");
  assert.strictEqual(C.estimateTextTok(emoji), emoji.length, "an astral character is 2 UTF-16 units and costs 2 - over, never under");
  assert.ok(C.estimateTextTok(cjk) > AVAILABLE, "and this is the prompt the old estimate waved through at 6339");
});

test("D6: a TYPICAL fn-gen prompt is nowhere near the window, so the pessimism does not bind in practice", () => {
  // The measured typical fn-gen prompt is ~1100 tokens on the old proxy (and
  // p90 ~1295, docs/constants.md). This reconstructs one of that size - 28
  // injected type blocks over a documented signature - and shows what the new,
  // more pessimistic estimate does to it. Measured: 1136 -> 1562 tok against a
  // 14336 window, so 12774 tokens of headroom remain and the change cannot bind
  // on an ordinary gesture.
  const prompt = C.assembleFnGenPrompt({
    signature: "pub fn parse_duration(s: &str) -> Option<u64>",
    docComment: "/// Parses a duration string like \"30s\" into total seconds.\n/// Returns None for empty input or an unknown suffix.",
    languageId: "rust",
    injectedSurface: Array.from(
      { length: 28 },
      (_, i) => "Data shape of `T" + i + "` (fields and types, nested):\n```rust\npub struct T" + i + " {\n    pub slot_number_field: u32,\n    pub label_for_the_slot: String,\n}\n```",
    ).join("\n\n"),
  });
  const before = Math.ceil(prompt.length / 4);
  const after = C.estimateTextTok(prompt);
  assert.ok(before > 1000 && before < 1400, `fixture: the measured typical size, got ${before} tok on the old proxy`);
  assert.ok(after < AVAILABLE / 4, `a typical prompt stays far under the window: ${after} of ${AVAILABLE}`);
  assert.ok(AVAILABLE - after > 10000, `and the headroom is not marginal: ${AVAILABLE - after} tok left`);
  assert.ok(after / before < 1.45, `the pessimism is bounded: ${before} -> ${after}`);
});
