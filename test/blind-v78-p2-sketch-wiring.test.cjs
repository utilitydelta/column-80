"use strict";

// Blind oracle for session-v78 phase 2: the developer's sketch comments survive
// every path that writes a model reply over a function
// [session-v78/contract-p2.md, falsifiers 1-5; Amendment 1 of goal.md].
//
// Written from the contract and from existing TESTS only. The phase 2 wiring
// (the four sites around placeGeneratedReply in src/vscode/fnGen.ts and
// src/vscode/oracleSurface.ts) was not read.
//
// Two harnesses, both borrowed from tests that already drive these paths:
//
//   G  Generate Function, through the product's own activation and a second
//      registerFnGen over a scripted transport (impl-v77-p1b's rig). The real
//      presenter writes the spliced document to a content provider and opens
//      vscode.diff(left, preview, title); the stub's diff handler reads that
//      preview back, records the title, and presses Accept. The preview is the
//      text present() was handed, spliced into the document.
//   O  runPostAcceptOracle bundled for real, with the compiler check, test
//      discovery, the covering run and the call-hierarchy anchor faked at
//      oracleSurface's imports (impl-v77-p4-lane2's rig). The presenter is the
//      ctx's own, so what present() receives is captured directly.
//
// What is asserted is what the developer sees: the presented text, the channel
// line, the diff title. Titles and channel phrasing are matched by the
// contract's substance (counts, plain words), not by an exact sentence, except
// where the contract gives the line's shape verbatim: the channel line
// `sketch: N kept by the model, M placed by Column 80, K could not be placed`.
//
// EXPECTED RED until phase 2 lands: every "sketch survives" row fails because the
// reply that drops the comments is presented as is. A failure that reads "the
// harness never reached present" is a harness defect instead.
//
// Run: SKIP_LIVE=1 node --test test/blind-v78-p2-sketch-wiring.test.cjs

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");
const esbuild = require("esbuild");
const { bundleActivation } = require("./.activation-stub.cjs");
const { bundleCore } = require("./.blind-util.cjs");

// ===========================================================================
// The sketch, read the product's own way (contract-p1: harvestBodyComments over
// bodyTextOfSpan). Used to grade presented text, never to compute an expected
// string the product must match byte for byte.
// ===========================================================================

const core = bundleCore(
  "blind-v78-p2-core",
  `export { harvestBodyComments, bodyTextOfSpan } from "../src/core/scaffold";\n`,
);
const { harvestBodyComments, bodyTextOfSpan } = core.mod;
const harvest = (spanText, languageId, bodyOnly = false) =>
  harvestBodyComments(bodyTextOfSpan(spanText, languageId, bodyOnly), languageId, "").comments;

const isSubsequence = (needle, hay) => {
  let i = 0;
  for (const h of hay) if (i < needle.length && h === needle[i]) i++;
  return i === needle.length;
};

// The channel line's shape is given verbatim by the contract.
const SKETCH_LINE = /^\[(\w+)\] sketch: (\d+) kept by the model, (\d+) placed by Column 80, (\d+) could not be placed/;
const sketchLines = (lines) =>
  lines
    .map((l, i) => ({ l: String(l), i, m: SKETCH_LINE.exec(String(l)) }))
    .filter((x) => x.m)
    .map((x) => ({ text: x.l, index: x.i, prefix: x.m[1], kept: +x.m[2], placed: +x.m[3], unplaced: +x.m[4] }));

// "with the placed and unplaced lines listed": on the line itself or on the
// lines that follow it, before the next tagged line that is not a listing.
const listedAfter = (lines, at, count) => lines.slice(at, at + 1 + count).join("\n");

// Plain words: no em dash, no internal names (memory: v77 message sweep).
const INTERNAL = /keepSketch|placedByTool|keptByModel|unplaced|scaffold|harvest|placeGeneratedReply/;
function assertPlainTitle(title, row) {
  assert.ok(!title.includes("—"), `${row}: the title carries an em dash: ${title}`);
  assert.ok(!INTERNAL.test(title), `${row}: the title names an internal: ${title}`);
}
// "2 sketch comments restored", "1 sketch comment could not be kept": the count
// and the noun, then the class of verb. The exact sentence is the implementer's.
const titleSaysRestored = (title, n) =>
  new RegExp(`\\b${n} sketch comments?\\b`, "i").test(title) && /restored|put back|placed|kept/i.test(title) && !/could not/i.test(title);

// ===========================================================================
// HARNESS G: Generate Function through activation + registerFnGen.
// ===========================================================================

const built = bundleActivation(
  "blind-v78-p2",
  `export { registerFnGen, buildFnGenService } from "../src/vscode/fnGen";
export { FnGenService } from "../src/core/fnGenService";
export { ContextBlockStore } from "../src/core/contextBlocks";
export { window } from "vscode";
`,
);
const B = built.mod;

const WROOT = fs.mkdtempSync(path.join(os.tmpdir(), "c80-v78p2-"));
fs.mkdirSync(path.join(WROOT, "src"), { recursive: true });
fs.writeFileSync(path.join(WROOT, "Cargo.toml"), '[package]\nname = "p"\nversion = "0.1.0"\n');

const MODEL = "qwen3-coder:480b";
const MB = 1048576;
const PROBE = { runCommand: async () => ({ stdout: "16303\n", exitCode: 0 }), totalMemBytes: () => 61826 * MB };
const CFG = { apiBase: "http://ml-box.invalid:11434", model: MODEL, fallbackModel: MODEL, maxTokens: 512, temperature: 0.2 };

function makeDoc(text, fsPath, languageId) {
  const lineStarts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") lineStarts.push(i + 1);
  const lines = text.split("\n");
  const offsetAt = (pos) => Math.min((lineStarts[pos.line] ?? text.length) + pos.character, text.length);
  const uri = `file://${fsPath}`;
  return {
    languageId,
    version: 1,
    isDirty: false,
    isClosed: false,
    eol: 1,
    lineCount: lines.length,
    fileName: fsPath,
    uri: { fsPath, path: fsPath, scheme: "file", toString: () => uri, with() { return this; } },
    getText: (range) => (range ? text.slice(offsetAt(range.start), offsetAt(range.end)) : text),
    offsetAt,
    positionAt(offset) {
      let line = 0;
      while (line + 1 < lineStarts.length && lineStarts[line + 1] <= offset) line++;
      return new B.Position(line, offset - lineStarts[line]);
    },
    lineAt(arg) {
      const n = typeof arg === "number" ? arg : arg.line;
      const t = lines[n] ?? "";
      const m = t.match(/\S/);
      return {
        lineNumber: n,
        text: t,
        range: new B.Range(n, 0, n, t.length),
        rangeIncludingLineBreak: new B.Range(n, 0, n + 1, 0),
        firstNonWhitespaceCharacterIndex: m ? m.index : t.length,
        isEmptyOrWhitespace: !m,
      };
    },
    getWordRangeAtPosition: () => undefined,
    save: async () => true,
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (predicate, ms = 4000) => {
  for (let waited = 0; waited < ms; waited += 5) {
    if (predicate()) return true;
    await sleep(5);
  }
  return predicate();
};

const G = { channel: [], prompts: [], diffs: [], oracleCalls: [], reply: () => "", ready: false, reason: "" };

async function buildG() {
  const st = B.__state;
  st.config = { apiBase: CFG.apiBase, fnGenModel: MODEL, repairEnabled: true, "dictation.enabled": false };
  B.window.withProgress = async (_opts, task) =>
    task({ report() {} }, { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) });
  const context = {
    subscriptions: [],
    globalState: { get: () => undefined, update: async () => {} },
    workspaceState: { get: () => undefined, update: async () => {} },
    extensionPath: WROOT,
    extensionUri: { fsPath: WROOT, toString: () => `file://${WROOT}` },
    globalStorageUri: { fsPath: path.join(WROOT, ".storage") },
  };
  await B.activate(context);
  const output = { appendLine: (l) => G.channel.push(String(l)), append() {}, replace() {}, show() {}, hide() {}, clear() {}, dispose() {} };
  let service;
  B.registerFnGen({ subscriptions: [], globalStorageUri: { fsPath: path.join(WROOT, ".storage") } }, output, new B.ContextBlockStore(() => {}), {
    buildService: async (out, log) => {
      const real = await B.buildFnGenService(out, log, PROBE, { listModels: async () => [MODEL] });
      try {
        real.service.dispose();
      } catch {
        /* teardown only */
      }
      service = new B.FnGenService(
        CFG,
        async (req) => {
          G.prompts.push(String(req?.prompt ?? ""));
          return { text: G.reply(req), ttftMs: 1, totalMs: 2, doneReason: "stop" };
        },
        log,
      );
      return { ...real, service };
    },
    listModels: async () => [MODEL],
    ollamaCheck: async () => ({ stdout: "ollama version 0.0.0", exitCode: 0 }),
    runOracle: async (ctx) => {
      G.oracleCalls.push(ctx);
    },
  });
  if (!(await waitFor(() => service !== undefined && G.channel.some((l) => l.startsWith("[carve] tier="))))) {
    G.reason = `the tier never resolved: ${JSON.stringify(G.channel)}`;
    return;
  }
  G.ready = true;
}
const gReady = buildG();

/** A fixture: the file text, the function's name, and where its span sits. */
function fixture(name, languageId, text, fnName, kind = 11) {
  const fsPath = path.join(WROOT, "src", name);
  fs.writeFileSync(fsPath, text);
  const lines = text.replace(/\n$/, "").split("\n");
  const headLine = lines.findIndex((l) => new RegExp(`\\b${fnName}\\b`).test(l));
  const lastLine = lines.length - 1;
  const nameCh = lines[headLine].indexOf(fnName);
  return {
    text,
    fsPath,
    languageId,
    symbols: [
      {
        name: fnName,
        detail: "",
        kind,
        range: new B.Range(headLine, 0, lastLine, lines[lastLine].length),
        selectionRange: new B.Range(headLine, nameCh, headLine, nameCh + fnName.length),
        children: [],
      },
    ],
    cursor: new B.Position(Math.min(headLine + 1, lastLine), 0),
  };
}

/** One Generate Function gesture to the preview, then Accept. */
async function generate(fx, reply) {
  await gReady;
  assert.ok(G.ready, `harness G is not up: ${G.reason}`);
  const st = B.__state;
  G.channel.length = 0;
  G.prompts.length = 0;
  G.diffs.length = 0;
  G.oracleCalls.length = 0;
  st.messages.length = 0;
  st.outputLines.length = 0;
  G.reply = typeof reply === "function" ? reply : () => reply;
  const doc = makeDoc(fx.text, fx.fsPath, fx.languageId);
  st.textDocuments = [doc];
  st.commandHandlers = {
    "vscode.executeDocumentSymbolProvider": () => fx.symbols,
    "vscode.diff": async (left, previewUri, title) => {
      const provider = previewUri && st.contentProviders[previewUri.scheme];
      const preview = provider ? await provider.provideTextDocumentContent(previewUri) : undefined;
      G.diffs.push({ title: String(title ?? ""), preview: typeof preview === "string" ? preview : undefined });
      setTimeout(() => st.commands["column80.proposalAccept"](previewUri), 0);
    },
  };
  const selection = new B.Selection(fx.cursor, fx.cursor);
  st.activeTextEditor = {
    document: doc,
    viewColumn: 1,
    options: { tabSize: 4, insertSpaces: true },
    selection,
    selections: [selection],
    insertSnippet: async () => true,
    revealRange: () => {},
    setDecorations() {},
    edit: async (cb) => {
      cb({ replace() {}, insert() {}, delete() {} });
      return true;
    },
  };
  st.visibleTextEditors = [st.activeTextEditor];
  const done = { settled: false };
  Promise.resolve()
    .then(() => st.commands["column80.generateFunction"]())
    .then(
      () => (done.settled = true),
      () => (done.settled = true),
    );
  await waitFor(() => G.diffs.length > 0 || done.settled, 8000);
  await waitFor(() => done.settled, 3000);
  await sleep(50);
  const lines = [...G.channel, ...st.outputLines.map(String)];
  return {
    diff: G.diffs[0],
    prompts: G.prompts.slice(),
    lines,
    messages: st.messages.slice(),
    trace: `channel:\n${lines.join("\n")}`,
  };
}

// The fn-gen prompt's sketch section: the bullets under the "sketched the body
// as comments" label (impl-v32-p6-scaffold pins that label and the "- line"
// rendering). Returns undefined when the prompt carries no such section.
function sketchSection(prompt) {
  const lines = prompt.split("\n");
  const at = lines.findIndex((l) => /sketched the body as comments/i.test(l));
  if (at < 0) return undefined;
  const out = [];
  for (let i = at + 1; i < lines.length; i++) {
    if (lines[i].startsWith("- ")) out.push(lines[i]);
    else if (out.length > 0) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// The human's own stub, byte for byte (goal.md Part A).
const HUMAN_RUST =
  "fn main() {\n" +
  "// say hello world\n" +
  "// get two numbers from user\n" +
  "// use the add function to add the numbers together\n" +
  "// dump the output to console\n" +
  "}\n";
const HUMAN_SKETCH = [
  "say hello world",
  "get two numbers from user",
  "use the add function to add the numbers together",
  "dump the output to console",
];
// The reply that did all four steps and dropped all four comments.
const HUMAN_REPLY_DROPPED =
  "```rust\n" +
  "fn main() {\n" +
  '    println!("hello world");\n' +
  "    let a = read_number();\n" +
  "    let b = read_number();\n" +
  "    let sum = add(a, b);\n" +
  '    println!("{}", sum);\n' +
  "}\n" +
  "```";
const HUMAN_REPLY_KEPT =
  "```rust\n" +
  "fn main() {\n" +
  "    // say hello world\n" +
  '    println!("hello world");\n' +
  "    // get two numbers from user\n" +
  "    let a = read_number();\n" +
  "    let b = read_number();\n" +
  "    // use the add function to add the numbers together\n" +
  "    let sum = add(a, b);\n" +
  "    // dump the output to console\n" +
  '    println!("{}", sum);\n' +
  "}\n" +
  "```";
const HUMAN_REPLY_ONE_LINE = '```rust\nfn main() { println!("{}", add(1, 2)); }\n```';
const ONE_LINE_FN = 'fn main() { println!("{}", add(1, 2)); }';

// The function a repair or refine round reads, as it stands after a generate:
// the developer's lines interleaved with code. Two sketch lines.
const SKETCHED = "pub fn add(a: i32, b: i32) -> i32 {\n    // start from the first number\n    let x = a.abs();\n    // take away the second one\n    x - b\n}\n";
const SKETCHED_SPAN = SKETCHED.slice(0, -1);
const SKETCHED_SKETCH = ["start from the first number", "take away the second one"];
const ROUND_REPLY_DROPPED = "pub fn add(a: i32, b: i32) -> i32 {\n    let x = a.abs();\n    x + b\n}";
const ROUND_REPLY_SAME_BUT_COMMENTS = "pub fn add(a: i32, b: i32) -> i32 {\n    let x = a.abs();\n    x - b\n}";

// Python with a preserved docstring: the body-only path.
const PY_DOC =
  "def total(items):\n" +
  '    """Sum the items."""\n' +
  "    # start the running sum at zero\n" +
  "    # add each item to it\n" +
  "    # hand the sum back\n";
const PY_SKETCH = ["start the running sum at zero", "add each item to it", "hand the sum back"];

// Sanity on the fixtures themselves: the sketch IS what the product harvests.
test("fixture guard: each fixture's sketch is what the product's own harvest reads", () => {
  assert.deepEqual(harvest(HUMAN_RUST.trimEnd(), "rust"), HUMAN_SKETCH);
  assert.deepEqual(harvest(SKETCHED_SPAN, "rust"), SKETCHED_SKETCH);
  assert.deepEqual(harvest(PY_DOC, "python"), PY_SKETCH);
  assert.deepEqual(harvest(ROUND_REPLY_DROPPED, "rust"), [], "the round reply carries no sketch line");
});

// ===========================================================================
// HARNESS O: runPostAcceptOracle with the check and the test machinery faked at
// oracleSurface's import sites.
// ===========================================================================

const O_STUB = path.join(__dirname, ".blind-v78-p2-o-stub.cjs");
fs.writeFileSync(
  O_STUB,
  `
const state = (globalThis.__v78p2o = globalThis.__v78p2o || { messages: [], config: {} });
class Position { constructor(line, character) { this.line = line; this.character = character; } }
class Range {
  constructor(a, b, c, d) {
    if (typeof a === "number") { this.start = new Position(a, b); this.end = new Position(c, d); }
    else { this.start = a; this.end = b; }
  }
}
class ThemeColor { constructor(id) { this.id = id; } }
class MarkdownString { constructor() { this.blocks = []; } appendCodeblock(t) { this.blocks.push(t); } appendMarkdown() {} }
class Diagnostic { constructor(range, message, severity) { this.range = range; this.message = message; this.severity = severity; } }
class Location { constructor(uri, range) { this.uri = uri; this.range = range; } }
const Uri = {
  file: (p) => ({ fsPath: p, path: p, scheme: "file", toString: () => "file://" + p }),
  parse: (s) => ({ raw: s, fsPath: String(s).replace(/^file:\\/\\//, ""), toString: () => s }),
};
module.exports = {
  __state: state,
  Position, Range, ThemeColor, MarkdownString, Diagnostic, Location, Uri,
  DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
  ProgressLocation: { Window: 10, Notification: 15 },
  workspace: {
    getConfiguration: () => ({
      get: (k, fb) => (k in state.config ? state.config[k] : fb),
      inspect: () => undefined,
      update: async () => {},
    }),
    get textDocuments() { return []; },
    get workspaceFolders() { return undefined; },
  },
  languages: {
    createDiagnosticCollection: (name) => ({ name, set() {}, delete() {}, clear() {}, dispose() {} }),
  },
  window: {
    createTextEditorDecorationType: (opts) => ({ opts, dispose() {} }),
    get visibleTextEditors() { return []; },
    showWarningMessage: async (message) => { state.messages.push({ kind: "warn", message }); },
    showInformationMessage: async (message) => { state.messages.push({ kind: "info", message }); },
    setStatusBarMessage: (message) => { state.messages.push({ kind: "status", message }); return { dispose() {} }; },
  },
  commands: { executeCommand: async () => undefined },
};
`,
);

const OVERRIDES = {
  "../core/compilerOracle": ["runOracleCheck"],
  "../core/coveringTestRun": ["runCoveringGroups"],
  "../core/testDiscovery": ["discoverCoveringTests"],
  "./callHierarchy": ["prepareCallRoot"],
};
const seamPlugin = {
  name: "v78-p2-seams",
  setup(build) {
    build.onResolve({ filter: /.*/ }, (args) => {
      if (args.namespace !== "file" || !args.importer.endsWith(path.join("vscode", "oracleSurface.ts"))) return undefined;
      if (!(args.path in OVERRIDES)) return undefined;
      return { path: path.resolve(path.dirname(args.importer), `${args.path}.ts`), namespace: "v78-seam", pluginData: args.path };
    });
    build.onLoad({ filter: /.*/, namespace: "v78-seam" }, (args) => {
      const real = JSON.stringify(args.path);
      const lines = [`import * as real from ${real};`, `export * from ${real};`];
      for (const n of OVERRIDES[args.pluginData]) {
        lines.push(`export const ${n} = (...a) => (globalThis.__v78p2fakes?.${n} ?? real.${n})(...a);`);
      }
      return { contents: lines.join("\n"), loader: "ts", resolveDir: path.dirname(args.path) };
    });
  },
};

const O_ENTRY = path.join(__dirname, ".blind-v78-p2-o.entry.ts");
const O_OUT = path.join(__dirname, ".blind-v78-p2-o.bundle.cjs");
fs.writeFileSync(O_ENTRY, `export { runPostAcceptOracle } from "../src/vscode/oracleSurface";\n`);
let runPostAcceptOracle;
let oState;
test.before(async () => {
  await esbuild.build({
    entryPoints: [O_ENTRY],
    bundle: true,
    outfile: O_OUT,
    format: "cjs",
    platform: "node",
    alias: { vscode: O_STUB },
    plugins: [seamPlugin],
    logLevel: "silent",
  });
  ({ runPostAcceptOracle } = require(O_OUT));
  oState = globalThis.__v78p2o;
});

const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), "blind-v78-p2-"));
test.after(() => {
  for (const f of [O_ENTRY, O_OUT, O_STUB]) fs.rmSync(f, { force: true });
  core.cleanup();
  built.cleanup();
  fs.rmSync(SCRATCH, { recursive: true, force: true });
  fs.rmSync(WROOT, { recursive: true, force: true });
});
test.afterEach(() => {
  globalThis.__v78p2fakes = undefined;
});

function crate(tag) {
  const root = fs.mkdtempSync(path.join(SCRATCH, `${tag}-`));
  fs.writeFileSync(path.join(root, "Cargo.toml"), '[package]\nname = "p"\nversion = "0.1.0"\n');
  fs.mkdirSync(path.join(root, "src"));
  const file = path.join(root, "src", "lib.rs");
  fs.writeFileSync(file, SKETCHED);
  // A caller in another file, for the refine round's reference leg.
  const caller = path.join(root, "src", "use_add.rs");
  fs.writeFileSync(caller, "use crate::add;\n\npub fn caller() -> i32 {\n    let total = add(5, 3);\n    total * 2\n}\n");
  return { root, file, caller };
}

function oDocument(file) {
  const text = SKETCHED;
  const positionAt = (offset) => {
    const before = text.slice(0, offset);
    return { offset, line: before.split("\n").length - 1, character: offset - before.lastIndexOf("\n") - 1 };
  };
  return {
    languageId: "rust",
    isDirty: false,
    isClosed: false,
    version: 1,
    uri: { fsPath: file, path: file, scheme: "file", toString: () => "file://" + file },
    getText: (range) => (range ? text.slice(range.start.offset, range.end.offset) : text),
    positionAt,
    offsetAt: (p) => p.offset,
    lineAt: (line) => {
      const t = text.split("\n")[line] ?? "";
      return { text: t, range: { start: { line, character: 0 }, end: { line, character: t.length } } };
    },
    save: async () => true,
  };
}

const oResolved = () => ({
  span: { start: 0, end: SKETCHED_SPAN.length },
  signature: "pub fn add(a: i32, b: i32) -> i32",
  docComment: "",
  symbolName: "add",
  languageId: "rust",
  kind: "function",
  bodyOnly: false,
  headerIndent: "",
  headOffset: 0,
  bodyIndent: "    ",
});

const clean = (root) => ({ success: true, diagnostics: [], durationMs: 1, crateRoot: root });
const ERR_AT = SKETCHED.indexOf("x - b");
const brokenIn = (root, file) => ({
  success: false,
  durationMs: 1,
  crateRoot: root,
  diagnostics: [
    {
      kind: "compile-error",
      level: "error",
      code: "E0308",
      message: "mismatched types",
      suggestions: [],
      spans: [
        { fileName: file, byteStart: ERR_AT, byteEnd: ERR_AT + 5, lineStart: 5, lineEnd: 5, columnStart: 5, columnEnd: 10, isPrimary: true },
      ],
    },
  ],
});

const GROUP = (root) => ({
  key: `${root}::adds`,
  frameworkId: "cargo-test",
  tests: [{ filter: "adds", filePath: path.join(root, "src", "lib.rs") }],
  placement: { runRoot: root },
});
const testRun = (root, outcome) => ({
  cancelled: false,
  outcomes: [
    {
      key: `${root}::adds`,
      frameworkName: "cargo test",
      tests: [{ filter: "adds" }],
      result: {
        ran: true,
        success: outcome === "pass",
        cases: [{ name: "adds", outcome }],
        failures: outcome === "pass" ? [] : [{ name: "adds", message: "assertion `left == right` failed\n  left: 2\n right: 8" }],
        passed: outcome === "pass" ? 1 : 0,
        failed: outcome === "pass" ? 0 : 1,
        ignored: 0,
        durationMs: 1,
        crateRoot: root,
      },
    },
  ],
});

/** The four ways into a round, set up so exactly the named round is the first
 *  thing to reach present(). Returns the ctx overrides. */
const ROUNDS = {
  "compiler repair round": ({ root, file }) => {
    const checks = [brokenIn(root, file), clean(root)];
    let n = 0;
    globalThis.__v78p2fakes = {
      runOracleCheck: async () => checks[Math.min(n++, checks.length - 1)],
      prepareCallRoot: async () => undefined,
      discoverCoveringTests: async () => ({ groups: [] }),
    };
    return { manualRefine: false, prefix: "repair" };
  },
  "test repair round": ({ root }) => {
    const runs = [testRun(root, "fail"), testRun(root, "pass")];
    let n = 0;
    globalThis.__v78p2fakes = {
      runOracleCheck: async () => clean(root),
      prepareCallRoot: async () => ({ uri: "file:///x", name: "add" }),
      discoverCoveringTests: async () => ({ groups: [GROUP(root)] }),
      runCoveringGroups: async () => runs[Math.min(n++, runs.length - 1)],
    };
    return { manualRefine: true, prefix: "tests" };
  },
  "refine round": ({ root, caller }) => {
    globalThis.__v78p2fakes = {
      runOracleCheck: async () => clean(root),
      prepareCallRoot: async () => undefined,
      discoverCoveringTests: async () => ({ groups: [] }),
    };
    return {
      manualRefine: true,
      // The contract names [repair] and [tests]; refine is not named. Today the
      // refine round logs under [repair] (impl-v29-p4-refine-flow), so either
      // [repair] or a [refine] of its own is accepted. Never [fngen].
      prefix: /^(repair|refine)$/,
      extractor: {
        completeMembers: async () => [],
        example: async () => undefined,
        membersOfType: async () => [],
        references: async () => [{ uri: "file://" + caller, line: 3, character: 16, endLine: 3, endCharacter: 19 }],
      },
    };
  },
};

async function driveRound(roundName, reply) {
  const c = crate(roundName.split(" ")[0]);
  const setup = ROUNDS[roundName](c);
  oState.messages = [];
  oState.config = {};
  const lines = [];
  const presented = [];
  const generateCalls = [];
  const ctx = {
    document: oDocument(c.file),
    landedSpan: { start: 0, end: SKETCHED_SPAN.length },
    output: { appendLine: (l) => lines.push(String(l)), append() {} },
    service: {
      modelTag: "stub-model",
      generateRaw: async (...a) => {
        generateCalls.push(a);
        return { text: reply };
      },
    },
    presenter: {
      present: async (p) => {
        presented.push(p);
        // Reject: the first round is the one under test, and a reject ends it
        // without a second round muddying the channel.
        return "reject";
      },
    },
    resolveFunction: async () => oResolved(),
    inFlight: { begin: () => ({ release() {} }) },
    repairTierGate: { allowed: true },
    manualRefine: setup.manualRefine,
  };
  if (setup.extractor) ctx.extractor = setup.extractor;
  let error;
  try {
    await runPostAcceptOracle(ctx);
  } catch (e) {
    error = e;
  }
  return { presented, lines, generateCalls, messages: oState.messages.slice(), error, setup, trace: `channel:\n${lines.join("\n")}` };
}

const prefixOk = (prefix, want) => (want instanceof RegExp ? want.test(prefix) : prefix === want);

// ===========================================================================
// FALSIFIER 1: one row per write path. The reply drops every sketch line; the
// text handed to present() carries the sketch in order, in the developer's
// words; the channel says how many were placed; the title says so.
// ===========================================================================

test("F1 generate: the human's sketch survives into the preview when the reply drops all four", async () => {
  const fx = fixture("f1_main.rs", "rust", HUMAN_RUST, "main");
  const r = await generate(fx, HUMAN_REPLY_DROPPED);
  assert.ok(r.diff, `harness: the preview never opened. ${r.trace}`);
  assert.ok(typeof r.diff.preview === "string", `harness: the preview had no readable content. ${r.trace}`);
  const fn = r.diff.preview.trimEnd();
  const got = harvest(fn, "rust");
  assert.ok(isSubsequence(HUMAN_SKETCH, got), `the preview lost the sketch.\nharvest: ${JSON.stringify(got)}\nPREVIEW:\n${r.diff.preview}`);
  // The developer's own comment text, opener and words, lands in the body.
  for (const s of HUMAN_SKETCH) assert.ok(fn.includes(`// ${s}`), `"// ${s}" is not in the preview:\n${fn}`);
  // The reply's code is all still there, in order (rule 6 seen through the wiring).
  const code = ['println!("hello world");', "let a = read_number();", "let b = read_number();", "let sum = add(a, b);", 'println!("{}", sum);'];
  let at = -1;
  for (const c of code) {
    const i = fn.indexOf(c, at + 1);
    assert.ok(i > at, `reply line "${c}" is missing or out of order:\n${fn}`);
    at = i;
  }
  const sl = sketchLines(r.lines);
  assert.equal(sl.length, 1, `one sketch line per write. ${r.trace}`);
  assert.equal(sl[0].prefix, "fngen");
  assert.deepEqual([sl[0].kept, sl[0].placed, sl[0].unplaced], [0, 4, 0], sl[0].text);
  const listing = listedAfter(r.lines, sl[0].index, 4);
  for (const s of HUMAN_SKETCH) assert.ok(listing.includes(s), `placed line "${s}" is not listed on the channel:\n${listing}`);
  assert.ok(titleSaysRestored(r.diff.title, 4), `the title must say 4 sketch comments were restored: ${r.diff.title}`);
  assertPlainTitle(r.diff.title, "F1 generate");
});

const ROUND_ROWS = ["compiler repair round", "test repair round", "refine round"];
for (const roundName of ROUND_ROWS) {
  test(`F1 ${roundName}: the developer's sketch survives into present() when the reply drops it`, async () => {
    const r = await driveRound(roundName, ROUND_REPLY_DROPPED);
    assert.ok(r.presented.length >= 1, `harness: the ${roundName} never reached present(). error=${r.error}\n${r.trace}`);
    const p = r.presented[0];
    const got = harvest(p.text, "rust");
    assert.ok(
      isSubsequence(SKETCHED_SKETCH, got),
      `the ${roundName} presented a function without the sketch.\nharvest: ${JSON.stringify(got)}\nTEXT:\n${p.text}`,
    );
    for (const s of SKETCHED_SKETCH) assert.ok(p.text.includes(`// ${s}`), `"// ${s}" is not in the presented text:\n${p.text}`);
    assert.ok(p.text.includes("x + b"), `the round's own fix is gone:\n${p.text}`);
    const sl = sketchLines(r.lines);
    assert.equal(sl.length, 1, `one sketch line per write. ${r.trace}`);
    assert.ok(prefixOk(sl[0].prefix, r.setup.prefix), `the ${roundName} line carries its own prefix, got [${sl[0].prefix}]`);
    assert.notEqual(sl[0].prefix, "fngen", "a round is not a generate");
    assert.deepEqual([sl[0].kept, sl[0].placed, sl[0].unplaced], [0, 2, 0], sl[0].text);
    const listing = listedAfter(r.lines, sl[0].index, 2);
    for (const s of SKETCHED_SKETCH) assert.ok(listing.includes(s), `placed line "${s}" is not listed:\n${listing}`);
    assert.ok(titleSaysRestored(p.title, 2), `the title must say 2 sketch comments were restored: ${p.title}`);
    assertPlainTitle(p.title, roundName);
  });
}

// Control for F1: when the model kept every line, nothing is placed, the channel
// still reports (always when the sketch is non-empty) and the title carries no
// note ("only when M or K is non-zero").
test("F1 control: a reply that kept the sketch gets the channel line with 4 kept and no title note", async () => {
  const fx = fixture("f1_kept.rs", "rust", HUMAN_RUST, "main");
  const r = await generate(fx, HUMAN_REPLY_KEPT);
  assert.ok(r.diff && typeof r.diff.preview === "string", `harness: the preview never opened. ${r.trace}`);
  assert.deepEqual(harvest(r.diff.preview.trimEnd(), "rust"), HUMAN_SKETCH, "nothing doubled, nothing lost");
  const sl = sketchLines(r.lines);
  assert.equal(sl.length, 1, `the channel reports whenever the sketch is non-empty. ${r.trace}`);
  assert.deepEqual([sl[0].kept, sl[0].placed, sl[0].unplaced], [4, 0, 0], sl[0].text);
  assert.ok(!/sketch/i.test(r.diff.title), `no title note when nothing was placed or lost: ${r.diff.title}`);
});

test("F1 control: a stub with no sketch writes no sketch line and no title note", async () => {
  const fx = fixture("f1_nosketch.rs", "rust", "fn main() {\n}\n", "main");
  const r = await generate(fx, HUMAN_REPLY_DROPPED);
  assert.ok(r.diff, `harness: the preview never opened. ${r.trace}`);
  assert.deepEqual(sketchLines(r.lines), [], `no sketch, no line. ${r.trace}`);
  assert.ok(!/sketch/i.test(r.diff.title), r.diff.title);
});

// ===========================================================================
// FALSIFIER 2: the round trip on the human's example. Generate, accept,
// generate again on the result: the second prompt's sketch section equals the
// first.
// ===========================================================================

test("F2 round trip: generating again on the accepted body reads the same sketch", async () => {
  const fx1 = fixture("f2_main.rs", "rust", HUMAN_RUST, "main");
  const first = await generate(fx1, HUMAN_REPLY_DROPPED);
  assert.ok(first.prompts.length >= 1, `harness: no model call on generate 1. ${first.trace}`);
  assert.ok(first.diff && typeof first.diff.preview === "string", `harness: generate 1 never previewed. ${first.trace}`);
  assert.ok(first.diff.preview.length > 0);
  const s1 = sketchSection(first.prompts[0]);
  assert.deepEqual(s1, HUMAN_SKETCH.map((s) => `- ${s}`), `generate 1's prompt must carry the human's sketch:\n${first.prompts[0]}`);

  // Accept landed the preview; the document now holds it. Generate again there.
  const fx2 = fixture("f2_main.rs", "rust", first.diff.preview, "main");
  const second = await generate(fx2, HUMAN_REPLY_DROPPED);
  assert.ok(second.prompts.length >= 1, `harness: no model call on generate 2. ${second.trace}`);
  const s2 = sketchSection(second.prompts[0]);
  assert.deepEqual(
    s2,
    s1,
    `the second prompt's sketch differs from the first.\nACCEPTED:\n${first.diff.preview}\nPROMPT 2:\n${second.prompts[0]}`,
  );
});

// ===========================================================================
// FALSIFIER 3: a reply identical to the current function except for dropped
// comments is "the round changed nothing", as today. Never presented.
// ===========================================================================

for (const roundName of ROUND_ROWS) {
  test(`F3 ${roundName}: a reply that differs only by dropped comments is reported unchanged, not proposed`, async () => {
    const r = await driveRound(roundName, ROUND_REPLY_SAME_BUT_COMMENTS);
    assert.ok(r.generateCalls.length >= 1, `harness: the ${roundName} never called the model. error=${r.error}\n${r.trace}`);
    assert.equal(
      r.presented.length,
      0,
      `a reply that only dropped comments was shown as a diff:\n${r.presented.map((p) => `${p.title}\n${p.text}`).join("\n---\n")}\n${r.trace}`,
    );
    const said = [...r.lines, ...r.messages.map((m) => m.message)].join("\n");
    // Today's vocabulary per round: "returned the function unchanged" (tests,
    // refine), "made no meaningful change ... result=no-change" (compiler).
    assert.match(said, /unchanged|no-change|no meaningful change/i, `the round must say it changed nothing. ${r.trace}`);
  });
}

// The channel line is written just before present, so a round that is not
// proposed claims nothing (contract-p2, "What the developer sees").
for (const roundName of ROUND_ROWS) {
  test(`F3 ${roundName}: a round that is not proposed writes no sketch line`, async () => {
    const r = await driveRound(roundName, ROUND_REPLY_SAME_BUT_COMMENTS);
    assert.ok(r.generateCalls.length >= 1, `harness: the ${roundName} never called the model. error=${r.error}\n${r.trace}`);
    assert.equal(r.presented.length, 0, `precondition: the round was not proposed. ${r.trace}`);
    assert.deepEqual(
      sketchLines(r.lines).map((l) => l.text),
      [],
      `a round that wrote nothing claimed sketch lines were placed. ${r.trace}`,
    );
  });
}

// ===========================================================================
// FALSIFIER 4 (revised, contract-p1 "Rule 9 revised"): a one-line reply gets a
// slot made by line breaks, and the sketch is restored inside the body. Only
// whitespace changes in the reply's own code. A reply with no body to hold the
// sketch (empty, or a signature only) is refused: nothing presented, one plain
// warning.
// ===========================================================================

const noSpace = (t) => t.replace(/\s+/g, "");

test("F4 one-line reply: a slot is made, the sketch is restored inside the body, and it still accepts", async () => {
  const fx = fixture("f4_main.rs", "rust", HUMAN_RUST, "main");
  const r = await generate(fx, HUMAN_REPLY_ONE_LINE);
  assert.ok(r.diff && typeof r.diff.preview === "string", `harness: the preview never opened. ${r.trace}`);
  const fn = r.diff.preview.trimEnd();
  const got = harvest(fn, "rust");
  assert.deepEqual(got, HUMAN_SKETCH, `the one-line reply must get the sketch inside its body, in order:\n${fn}`);
  // Each sketch line sits inside the braces, on its own line.
  const open = fn.indexOf("{");
  const close = fn.lastIndexOf("}");
  for (const s of HUMAN_SKETCH) {
    const line = fn.split("\n").find((l) => l.trim() === `// ${s}`);
    assert.ok(line !== undefined, `"// ${s}" is not on a line of its own:\n${fn}`);
    const at = fn.indexOf(`// ${s}`);
    assert.ok(at > open && at < close, `"// ${s}" landed outside the body:\n${fn}`);
  }
  // No non-whitespace character of the reply's code changed: strip the placed
  // comment lines and all whitespace, and the reply is what is left.
  const withoutSketch = fn
    .split("\n")
    .filter((l) => !HUMAN_SKETCH.some((s) => l.trim() === `// ${s}`))
    .join("\n");
  assert.equal(noSpace(withoutSketch), noSpace(ONE_LINE_FN), `the reply's code changed beyond line breaks:\n${fn}`);
  const sl = sketchLines(r.lines);
  assert.equal(sl.length, 1, `one sketch line per write. ${r.trace}`);
  assert.deepEqual([sl[0].kept, sl[0].placed, sl[0].unplaced], [0, 4, 0], sl[0].text);
  assert.ok(titleSaysRestored(r.diff.title, 4), `the title must say 4 sketch comments were restored: ${r.diff.title}`);
  assertPlainTitle(r.diff.title, "F4");
  assert.ok(await waitFor(() => G.oracleCalls.length > 0, 2000), `accept was blocked. ${r.trace}`);
});

const NO_BODY_REPLIES = [
  { name: "an empty reply", reply: "" },
  { name: "an empty fenced reply", reply: "```rust\n```" },
  { name: "a signature-only reply", reply: "```rust\nfn main()\n```" },
];
for (const row of NO_BODY_REPLIES) {
  test(`F4 no body: ${row.name} to a sketched stub is refused, not presented, with one plain warning`, async () => {
    const fx = fixture("f4_empty.rs", "rust", HUMAN_RUST, "main");
    const r = await generate(fx, row.reply);
    assert.ok(r.prompts.length >= 1, `harness: the model was never asked. ${r.trace}`);
    assert.equal(r.diff, undefined, `${row.name} was presented: ${JSON.stringify(r.diff)}\n${r.trace}`);
    assert.equal(G.oracleCalls.length, 0, "nothing was accepted, so nothing was checked");
    const warns = r.messages.filter((m) => m.kind === "warn" || m.kind === "error");
    assert.equal(warns.length, 1, `one warning, got: ${JSON.stringify(r.messages)}\n${r.trace}`);
    assert.ok(!warns[0].message.includes("\u2014"), `the warning carries an em dash: ${warns[0].message}`);
    assert.ok(!INTERNAL.test(warns[0].message), `the warning names an internal: ${warns[0].message}`);
  });
}

// ===========================================================================
// FALSIFIER 5: Python body-only, docstring preserved.
// ===========================================================================

test("F5 python body-only: the generate path with a preserved docstring keeps the sketch", async () => {
  const fx = fixture("f5_total.py", "python", PY_DOC, "total");
  const reply = "```python\ntotal = 0\nfor item in items:\n    total += item\nreturn total\n```";
  const r = await generate(fx, reply);
  assert.ok(r.diff && typeof r.diff.preview === "string", `harness: the preview never opened. ${r.trace}`);
  const fn = r.diff.preview;
  assert.ok(fn.includes('"""Sum the items."""'), `the docstring must be preserved:\n${fn}`);
  assert.ok(/return total/.test(fn), `harness: the reply did not land:\n${fn}`);
  const got = harvest(fn, "python");
  assert.ok(isSubsequence(PY_SKETCH, got), `the python preview lost the sketch.\nharvest: ${JSON.stringify(got)}\nPREVIEW:\n${fn}`);
  for (const s of PY_SKETCH) assert.ok(fn.includes(`# ${s}`), `"# ${s}" is not in the preview:\n${fn}`);
  // Every sketch line sits inside the body, below the docstring.
  const doc = fn.indexOf('"""Sum the items."""');
  for (const s of PY_SKETCH) assert.ok(fn.indexOf(`# ${s}`) > doc, `"# ${s}" landed above the docstring:\n${fn}`);
  const sl = sketchLines(r.lines);
  assert.equal(sl.length, 1, `one sketch line per write. ${r.trace}`);
  assert.deepEqual([sl[0].kept, sl[0].placed, sl[0].unplaced], [0, 3, 0], sl[0].text);
  assert.ok(titleSaysRestored(r.diff.title, 3), `the title must say 3 sketch comments were restored: ${r.diff.title}`);
});
