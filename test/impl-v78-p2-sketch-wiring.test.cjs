// The sketch survives every write path: Generate Function, the compiler repair
// round, the test repair round and the refine round all run the sketch keeper
// on the reply after placement and before the "changed nothing" comparison.
//
// Three rigs:
//   1. the pure helper every site calls (keepSketchForPreview): counts, the
//      channel line, the title note;
//   2. Generate Function through the REGISTERED command (registerFnGen over a
//      vscode stub, a scripted FnGenService, the real ProposalPresenter: the
//      preview text is read back off its content provider);
//   3. the three oracle rounds through the real runPostAcceptOracle, with the
//      check, test discovery, the covering run and the call-hierarchy anchor
//      faked at oracleSurface's imports (review-v77-p5a-testleg's seams).
//
// Run: node --test test/impl-v78-p2-sketch-wiring.test.cjs

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const esbuild = require("esbuild");
const { bundleCore } = require("./.blind-util.cjs");

// ---------------------------------------------------------------------------
// Shared: what "the sketch survived" means, read with the product's harvest.
// ---------------------------------------------------------------------------

const core = bundleCore(
  "impl-v78-p2-core",
  [
    `export { keepSketchForPreview } from "../src/core/scaffoldKeep";`,
    `export { harvestBodyComments, bodyTextOfSpan } from "../src/core/scaffold";`,
    `export { assembleFnGenPrompt } from "../src/core/prompt";`,
    "",
  ].join("\n"),
);
const { keepSketchForPreview, harvestBodyComments, bodyTextOfSpan, assembleFnGenPrompt } = core.mod;

const harvestOf = (text, languageId, bodyOnly = false, bodyIndent = "") =>
  harvestBodyComments(bodyTextOfSpan(text, languageId, bodyOnly), languageId, bodyIndent).comments;

function assertInOrder(text, lines, why) {
  let at = -1;
  for (const line of lines) {
    const next = text.indexOf(line, at + 1);
    assert.ok(next > at, `${why}: "${line}" missing or out of order in:\n${text}`);
    at = next;
  }
}

const RUST_SKETCH = [
  "say hello world",
  "get two numbers from user",
  "use the add function to add the numbers together",
  "dump the output to console",
];
// The human's own stub, comments at column 0 as typed (goal.md Part A).
const RUST_STUB = `fn main() {\n${RUST_SKETCH.map((l) => `// ${l}`).join("\n")}\n}`;
const RUST_REPLY_NO_COMMENTS = [
  "fn main() {",
  '    println!("hello world");',
  "    let a = read_number();",
  "    let b = read_number();",
  "    let sum = add(a, b);",
  '    println!("{}", sum);',
  "}",
].join("\n");

// ---------------------------------------------------------------------------
// 1. The helper.
// ---------------------------------------------------------------------------

test("helper: no sketch returns the reply, the title and no channel line, unchanged", () => {
  const reply = "fn main() {\n    // the model's own note\n    run();\n}";
  const r = keepSketchForPreview({
    languageId: "rust",
    originalSpan: "fn main() {\n    todo!()\n}",
    reply,
    channelTag: "[fngen]",
    title: "main: generated body (preview)",
  });
  assert.equal(r.text, reply);
  assert.equal(r.title, "main: generated body (preview)");
  assert.equal(r.channelLine, undefined);
});

test("helper: title and channel line, one row per outcome", () => {
  const base = "main: generated body (preview)";
  const kept = `fn main() {\n${RUST_SKETCH.map((l) => `    // ${l}\n    step();`).join("\n")}\n}`;
  const rows = [
    {
      name: "every line kept by the model: no title note",
      reply: kept,
      title: base,
      line: "[fngen] sketch: 4 kept by the model, 0 placed by Column 80, 0 could not be placed",
    },
    {
      name: "every line dropped: restored, listed",
      reply: RUST_REPLY_NO_COMMENTS,
      title: "main: generated body (preview, 4 sketch comments restored)",
      line:
        "[fngen] sketch: 0 kept by the model, 4 placed by Column 80, 0 could not be placed; placed: " +
        RUST_SKETCH.join(" | "),
    },
    {
      name: "one line dropped: singular",
      reply: kept.replace("    // dump the output to console\n", ""),
      title: "main: generated body (preview, 1 sketch comment restored)",
      line:
        "[fngen] sketch: 3 kept by the model, 1 placed by Column 80, 0 could not be placed; placed: dump the output to console",
    },
    {
      name: "a one-line reply gets a slot made: restored",
      reply: "fn main() { run() }",
      title: "main: generated body (preview, 4 sketch comments restored)",
      line:
        "[fngen] sketch: 0 kept by the model, 4 placed by Column 80, 0 could not be placed; placed: " +
        RUST_SKETCH.join(" | "),
    },
  ];
  for (const row of rows) {
    const r = keepSketchForPreview({
      languageId: "rust",
      originalSpan: RUST_STUB,
      reply: row.reply,
      channelTag: "[fngen]",
      title: base,
    });
    assert.equal(r.title, row.title, row.name);
    assert.equal(r.channelLine, row.line, row.name);
    assert.ok(!/\u2014/.test(r.title + r.channelLine), `${row.name}: no em dash in user strings`);
  }
});

test("helper: a reply with no body to hold the sketch carries a refusal; any other reply carries none", () => {
  const rows = [
    { name: "empty body", reply: "fn main() {}", refused: true },
    { name: "empty reply", reply: "", refused: true },
    { name: "signature only", reply: "fn main();", refused: true },
    { name: "one-line body", reply: "fn main() { run() }", refused: false },
    { name: "multi-line body", reply: RUST_REPLY_NO_COMMENTS, refused: false },
  ];
  for (const row of rows) {
    const r = keepSketchForPreview({
      languageId: "rust",
      originalSpan: RUST_STUB,
      reply: row.reply,
      channelTag: "[repair]",
      title: "main: repair round 1 (preview)",
    });
    if (row.refused) {
      assert.equal(r.refusal, "the reply has no function body to keep the sketch comments in", row.name);
      assert.equal(r.text, row.reply, `${row.name}: the reply is untouched`);
    } else {
      assert.equal(r.refusal, undefined, row.name);
    }
  }
  const sketchless = keepSketchForPreview({
    languageId: "rust",
    originalSpan: "fn main() {\n    todo!()\n}",
    reply: "",
    channelTag: "[repair]",
    title: "t (preview)",
  });
  assert.equal(sketchless.refusal, undefined, "no sketch: today's behaviour, never refused here");
});

test("helper: onlyCommentsDiffer is true only for a sketch-bearing span whose code did not change", () => {
  const sketched = "fn f() {\n    // first\n    a();\n    // second\n    b();\n}";
  const rows = [
    { name: "sketch dropped, code same", span: sketched, reply: "fn f() {\n    a();\n    b();\n}", want: true },
    { name: "sketch dropped, code changed", span: sketched, reply: "fn f() {\n    a();\n    c();\n}", want: false },
    {
      // The cheap direction: a pointless diff the developer rejects, never a discarded fix.
      name: "a model-added comment line is a change",
      span: sketched,
      reply: sketched.replace("b();", "// note\n    b();"),
      want: false,
    },
    { name: "no sketch: comment-only change is not this flag's business", span: "fn f() {\n    a();\n}", reply: "fn f() {\n    // note\n    a();\n}", want: false },
    { name: "comment lines dropped, blank lines left in their place", span: sketched, reply: "fn f() {\n\n    a();\n\n    b();\n}", want: true },
    {
      // Chosen direction: proposing a pointless diff is cheap, discarding a real fix is not.
      name: "a trailing sketch comment dropped from a code line is a change",
      span: "fn f() {\n    // first\n    a(); // step\n}",
      reply: "fn f() {\n    a();\n}",
      want: false,
    },
    { name: "a multi-line block sketch comment dropped", span: "fn f() {\n    /* first\n       and more */\n    a();\n}", reply: "fn f() {\n    a();\n}", want: true },
    { name: "CRLF on both sides, comments dropped only", span: sketched.replace(/\n/g, "\r\n"), reply: "fn f() {\r\n    a();\r\n    b();\r\n}", want: true },
    { name: "a comment inside a line never joins tokens", span: "fn f() {\n    // first\n    a/**/b;\n}", reply: "fn f() {\n    ab;\n}", want: false },
    { name: "python re-indent is a change", span: "def f():\n    # first\n    if x:\n        a()\n    b()\n", reply: "def f():\n    if x:\n        a()\n        b()\n", want: false },
  ];
  for (const row of rows) {
    const r = keepSketchForPreview({ languageId: "rust", originalSpan: row.span, reply: row.reply, channelTag: "[repair]", title: "f (preview)" });
    assert.equal(r.onlyCommentsDiffer, row.want, row.name);
  }
});

test("prompt: the scaffold section asks for the sketch kept word for word; no sketch keeps the old bytes", () => {
  const base = { signature: "fn main()", languageId: "rust" };
  const without = assembleFnGenPrompt(base);
  assert.equal(assembleFnGenPrompt({ ...base, scaffoldComments: [] }), without);
  assert.ok(!/word for word/.test(without), "the instruction must not appear with no sketch");
  const withSketch = assembleFnGenPrompt({ ...base, scaffoldComments: RUST_SKETCH });
  assert.match(
    withSketch,
    /- dump the output to console\nKeep each of these lines in the body, word for word, as a comment at the body's own depth, in this order, directly above the code that does it\./,
  );
});

// The vscode stub for the registered-command rig (impl-v77-p4-lane1's, plus a
// content-provider read of every diff the presenter opens).
const STUB = path.join(__dirname, ".impl-v78-p2-fngen-stub.cjs");
fs.writeFileSync(
  STUB,
  `
const state = {
  config: {}, messages: [], commands: {}, activeTextEditor: undefined,
  executeCalls: [], terminals: [], textDocuments: [], symbols: undefined, wroot: "/", providers: [], diffs: [],
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
const push = (kind) => async (message, ...actions) => { state.messages.push({ kind, message, actions }); return undefined; };
module.exports = {
  __state: state,
  Position, Range, Selection, SnippetString, WorkspaceEdit, EventEmitter,
  ThemeColor, MarkdownString, Diagnostic, TabInputTextDiff, Uri,
  EndOfLine: { LF: 1, CRLF: 2 },
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
      has: () => false, inspect: () => undefined, update: async () => {},
    }),
    onDidChangeConfiguration: () => ({ dispose() {} }),
    onDidChangeTextDocument: () => ({ dispose() {} }),
    onDidCloseTextDocument: () => ({ dispose() {} }),
    registerTextDocumentContentProvider: (scheme, provider) => { state.providers.push(provider); return { dispose() {} }; },
    get textDocuments() { return state.textDocuments; },
    get workspaceFolders() { return [{ uri: Uri.file(state.wroot), name: "w", index: 0 }]; },
    getWorkspaceFolder: () => ({ uri: Uri.file(state.wroot), name: "w", index: 0 }),
    openTextDocument: async () => state.activeTextEditor && state.activeTextEditor.document,
    applyEdit: async () => true,
    fs: {
      stat: async () => { throw new Error("ENOENT"); },
      createDirectory: async () => {}, writeFile: async () => {},
      readFile: async () => Buffer.from(""), delete: async () => {},
    },
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
    showInformationMessage: push("info"),
    showWarningMessage: push("warn"),
    showErrorMessage: push("error"),
    showQuickPick: async () => undefined,
    withProgress: async (opts, task) => task({ report: () => {} }, { onCancellationRequested: () => ({ dispose() {} }) }),
    setStatusBarMessage: (text) => { state.messages.push({ kind: "status", message: text, actions: [] }); return { dispose() {} }; },
    createStatusBarItem: () => ({ text: "", tooltip: "", command: undefined, show() {}, hide() {}, dispose() {} }),
    createTerminal: (opts) => { const t = { name: opts && opts.name, show() {}, sendText() {}, dispose() {} }; state.terminals.push(t); return t; },
    get terminals() { return state.terminals; },
    activeColorTheme: { kind: 1 },
    tabGroups: { all: [], activeTabGroup: undefined, onDidChangeTabs: () => ({ dispose() {} }), close: async () => {} },
  },
  commands: {
    registerCommand: (id, fn) => { state.commands[id] = fn; return { dispose() {} }; },
    executeCommand: async (id, ...args) => {
      state.executeCalls.push({ id, args });
      if (id === "vscode.executeDocumentSymbolProvider") return state.symbols;
      if (id === "vscode.diff") {
        const text = state.providers.map((p) => p.provideTextDocumentContent(args[1])).find((t) => t) ?? "";
        state.diffs.push({ title: args[2], text });
      }
      return undefined;
    },
  },
};
`,
);


// ---------------------------------------------------------------------------
// 2. Generate Function through the registered command.
// ---------------------------------------------------------------------------

const WROOT = path.join(__dirname, ".impl-v78-p2-workspace");
fs.rmSync(WROOT, { recursive: true, force: true });
fs.mkdirSync(path.join(WROOT, "src"), { recursive: true });

const ENTRY = path.join(__dirname, ".impl-v78-p2-fngen.entry.ts");
const OUTFILE = path.join(__dirname, ".impl-v78-p2-fngen.bundle.cjs");
fs.writeFileSync(
  ENTRY,
  `export { registerFnGen } from "../src/vscode/fnGen";
export { FnGenService } from "../src/core/fnGenService";
export { ContextBlockStore } from "../src/core/contextBlocks";
export { __state, Position, Range } from "vscode";\n`,
);
esbuild.buildSync({ entryPoints: [ENTRY], bundle: true, outfile: OUTFILE, format: "cjs", platform: "node", alias: { vscode: STUB } });
const B = require(OUTFILE);

const MODEL = "qwen3-coder:30b";
const CFG = { apiBase: "http://localhost:11434", model: MODEL, fallbackModel: MODEL, maxTokens: 512, temperature: 0.2 };
const OPEN_TIER = { id: "cloud", fnGenEnabled: true, provisional: false };

function makeDoc(src, languageId, fsPath) {
  const lineStarts = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === "\n") lineStarts.push(i + 1);
  const offsetAt = (pos) => Math.min((lineStarts[pos.line] ?? src.length) + pos.character, src.length);
  return {
    languageId,
    version: 1,
    isDirty: false,
    isClosed: false,
    eol: 1,
    lineCount: src.split("\n").length,
    fileName: fsPath,
    uri: { fsPath, path: fsPath, scheme: "file", toString: () => "file://" + fsPath, with() { return this; } },
    getText(range) {
      return range ? src.slice(offsetAt(range.start), offsetAt(range.end)) : src;
    },
    offsetAt,
    positionAt(offset) {
      let line = 0;
      while (line + 1 < lineStarts.length && lineStarts[line + 1] <= offset) line++;
      return new B.Position(line, offset - lineStarts[line]);
    },
    lineAt(arg) {
      const n = typeof arg === "number" ? arg : arg.line;
      const text = src.split("\n")[n] ?? "";
      const m = text.match(/\S/);
      return {
        lineNumber: n,
        text,
        range: new B.Range(n, 0, n, text.length),
        firstNonWhitespaceCharacterIndex: m ? m.index : text.length,
        isEmptyOrWhitespace: !m,
      };
    },
    save: async () => true,
  };
}

const waitFor = async (predicate, tries = 400) => {
  for (let i = 0; i < tries; i++) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, 5));
  }
  return false;
};

/** A service whose model answers every call with `reply`, recording each prompt. */
function scripted(reply, fence) {
  const prompts = [];
  const service = new B.FnGenService(
    CFG,
    async (req) => {
      prompts.push(req.prompt);
      return { text: "```" + fence + "\n" + reply + "\n```", ttftMs: 1, totalMs: 2, doneReason: "stop" };
    },
    () => {},
  );
  return { service, prompts };
}

/** Fires Generate Function with the cursor on `cursorLine` of `src`, and
 *  returns the preview the real presenter opened. The function symbol spans
 *  `fnLines` (first and last line of the definition). */
async function generate({ src, languageId, ext, name, fnLines, cursorLine, reply, fence }) {
  const st = B.__state;
  const fsPath = path.join(WROOT, "src", `main.${ext}`);
  fs.writeFileSync(fsPath, src);
  st.wroot = WROOT;
  st.config = {};
  st.messages = [];
  st.commands = {};
  st.executeCalls = [];
  st.providers = [];
  st.diffs = [];
  const doc = makeDoc(src, languageId, fsPath);
  st.textDocuments = [doc];
  const lastLen = src.split("\n")[fnLines[1]].length;
  const head = src.split("\n")[fnLines[0]];
  const nameAt = head.indexOf(name);
  st.symbols = [
    {
      name,
      detail: "",
      kind: 11,
      range: new B.Range(fnLines[0], 0, fnLines[1], lastLen),
      selectionRange: new B.Range(fnLines[0], nameAt, fnLines[0], nameAt + name.length),
      children: [],
    },
  ];
  const lines = [];
  const output = { lines, appendLine: (l) => lines.push(l), append() {}, show() {}, clear() {}, dispose() {} };
  const context = { subscriptions: [], globalStorageUri: { fsPath: path.join(WROOT, ".storage") } };
  const { service, prompts } = scripted(reply, fence);
  B.registerFnGen(context, output, new B.ContextBlockStore(() => {}), {
    buildService: async () => ({ tier: OPEN_TIER, service, config: CFG }),
    runOracle: async () => {},
    listModels: async () => [MODEL],
    ollamaCheck: async () => ({ stdout: "ollama version 0.0.0", exitCode: 0 }),
  });
  assert.ok(await waitFor(() => typeof st.commands["column80.generateFunction"] === "function"), "harness: never registered");
  await new Promise((r) => setTimeout(r, 20));
  const p = new B.Position(cursorLine, 1);
  const sel = new B.Range(p, p);
  sel.active = p;
  sel.anchor = p;
  st.activeTextEditor = {
    document: doc,
    viewColumn: 1,
    options: { tabSize: 4, insertSpaces: true },
    selection: sel,
    insertSnippet: async () => true,
    revealRange: () => {},
    edit: async (cb) => {
      cb({ replace() {}, insert() {}, delete() {} });
      return true;
    },
  };
  // Not awaited: the presenter waits on a verdict that never comes here.
  void Promise.resolve(st.commands["column80.generateFunction"]()).catch((err) => lines.push(`[test] threw: ${String(err)}`));
  await waitFor(() => st.diffs.length > 0 || lines.some((l) => l.startsWith("[test] threw")));
  const result = { diffs: st.diffs.slice(), channel: lines.slice(), prompts, toasts: st.messages.slice() };
  st.activeTextEditor = undefined;
  for (const d of context.subscriptions) {
    try {
      d.dispose?.();
    } catch {
      /* teardown only */
    }
  }
  return result;
}

const show = (r) => `channel=\n${r.channel.join("\n")}\ntoasts=${JSON.stringify(r.toasts)}`;

const RUST_GEN = {
  src: `${RUST_STUB}\n`,
  languageId: "rust",
  ext: "rs",
  name: "main",
  fnLines: [0, 5],
  cursorLine: 2,
  fence: "rust",
};

const sketchSection = (prompt) => {
  const m = prompt.match(/The developer sketched the body as comments[\s\S]*?(?=\n\n|$)/);
  return m ? m[0] : undefined;
};

test("generate: a reply that drops every sketch line previews with the sketch back, in order", async () => {
  const r = await generate({ ...RUST_GEN, reply: RUST_REPLY_NO_COMMENTS });
  assert.equal(r.diffs.length, 1, show(r));
  const { title, text } = r.diffs[0];
  assert.equal(title, "main: generated body (preview, 4 sketch comments restored)", show(r));
  assert.deepEqual(harvestOf(text, "rust"), RUST_SKETCH, `the preview's harvest is the sketch.\n${text}`);
  assert.ok(
    r.channel.includes(
      "[fngen] sketch: 0 kept by the model, 4 placed by Column 80, 0 could not be placed; placed: " + RUST_SKETCH.join(" | "),
    ),
    show(r),
  );
  // The reply's code lines are all there, untouched.
  assertInOrder(text, RUST_REPLY_NO_COMMENTS.split("\n").slice(1, -1), "reply lines");
});

test("generate: the prompt asks for the sketch kept, word for word", async () => {
  const r = await generate({ ...RUST_GEN, reply: RUST_REPLY_NO_COMMENTS });
  assert.equal(r.prompts.length, 1, show(r));
  assert.match(sketchSection(r.prompts[0]) ?? "", /word for word/, r.prompts[0]);
});

test("generate round trip: regenerating on the accepted result reads the same sketch section", async () => {
  const first = await generate({ ...RUST_GEN, reply: RUST_REPLY_NO_COMMENTS });
  const landed = first.diffs[0].text;
  const lastLine = landed.replace(/\n$/, "").split("\n").length - 1;
  const second = await generate({ ...RUST_GEN, src: landed, fnLines: [0, lastLine], reply: RUST_REPLY_NO_COMMENTS });
  assert.equal(second.diffs.length, 1, show(second));
  const a = sketchSection(first.prompts[0]);
  assert.ok(a !== undefined, first.prompts[0]);
  assert.equal(sketchSection(second.prompts[0]), a, `second prompt:\n${second.prompts[0]}`);
  assert.equal(second.diffs[0].title, "main: generated body (preview, 4 sketch comments restored)");
});

test("generate: a one-line reply gets a slot made and is presented with the sketch restored inside the body", async () => {
  const reply = "fn main() { run() }";
  const r = await generate({ ...RUST_GEN, reply });
  assert.equal(r.diffs.length, 1, show(r));
  assert.equal(r.diffs[0].title, "main: generated body (preview, 4 sketch comments restored)");
  assert.equal(r.diffs[0].text, `fn main() {\n${RUST_SKETCH.map((l) => `    // ${l}\n`).join("")}    run()\n}\n`);
});

test("generate: an empty-bodied reply with a sketch is refused: nothing presented, one warning", async () => {
  const r = await generate({ ...RUST_GEN, reply: "fn main() {}" });
  assert.equal(r.diffs.length, 0, show(r));
  assert.ok(r.channel.includes("[fngen] refused: the reply has no function body to keep the sketch comments in"), show(r));
  const warns = r.toasts.filter((t) => t.kind === "warn");
  assert.equal(warns.length, 1, show(r));
  assert.match(warns[0].message, /had no function body, so nothing was changed/);
  assert.ok(!/\u2014/.test(warns[0].message));
});

test("generate: an empty-bodied reply with no sketch is presented, as today", async () => {
  const r = await generate({ ...RUST_GEN, src: "fn main() {\n    todo!()\n}\n", fnLines: [0, 2], cursorLine: 1, reply: "fn main() {}" });
  assert.equal(r.diffs.length, 1, show(r));
  assert.equal(r.diffs[0].title, "main: generated body (preview)");
});

test("generate: a stub with no sketch keeps today's title and logs no sketch line", async () => {
  const r = await generate({
    ...RUST_GEN,
    src: "fn main() {\n    todo!()\n}\n",
    fnLines: [0, 2],
    cursorLine: 1,
    reply: RUST_REPLY_NO_COMMENTS,
  });
  assert.equal(r.diffs.length, 1, show(r));
  assert.equal(r.diffs[0].title, "main: generated body (preview)");
  assert.ok(!r.channel.some((l) => / sketch: /.test(l)), show(r));
});

test("generate, Python below a preserved docstring: the body-only reply keeps the sketch", async () => {
  const src = 'def walk():\n    """Walk the cache and drop what is stale."""\n    # load the cache\n    # drop every stale entry\n    pass\n';
  const r = await generate({
    src,
    languageId: "python",
    ext: "py",
    name: "walk",
    fnLines: [0, 4],
    cursorLine: 4,
    fence: "python",
    reply: "    cache = load()\n    return [e for e in cache if not e.stale]",
  });
  assert.equal(r.diffs.length, 1, show(r));
  const { title, text } = r.diffs[0];
  assert.equal(title, "walk: generated body (preview, 2 sketch comments restored)", show(r));
  assert.ok(text.includes('"""Walk the cache and drop what is stale."""'), `docstring preserved:\n${text}`);
  assertInOrder(text, ["    # load the cache", "    # drop every stale entry", "    cache = load()"], "python sketch");
});

// ---------------------------------------------------------------------------
// 3. The oracle rounds through the real runPostAcceptOracle.
// ---------------------------------------------------------------------------

const ORACLE_STUB = path.join(__dirname, ".impl-v78-p2-oracle-stub.cjs");
fs.writeFileSync(
  ORACLE_STUB,
  `
const state = (globalThis.__v78p2 = globalThis.__v78p2 || { messages: [], config: {} });
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

const ORACLE_ENTRY = path.join(__dirname, ".impl-v78-p2-oracle.entry.ts");
const ORACLE_OUT = path.join(__dirname, ".impl-v78-p2-oracle.bundle.cjs");
fs.writeFileSync(ORACLE_ENTRY, `export { runPostAcceptOracle } from "../src/vscode/oracleSurface";\n`);
let runPostAcceptOracle;
let oracleState;
test.before(async () => {
  await esbuild.build({
    entryPoints: [ORACLE_ENTRY],
    bundle: true,
    outfile: ORACLE_OUT,
    format: "cjs",
    platform: "node",
    alias: { vscode: ORACLE_STUB },
    plugins: [seamPlugin],
    logLevel: "silent",
  });
  ({ runPostAcceptOracle } = require(ORACLE_OUT));
  oracleState = globalThis.__v78p2;
});

const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), "impl-v78-p2-"));
test.after(() => {
  for (const f of [STUB, ENTRY, OUTFILE, ORACLE_STUB, ORACLE_ENTRY, ORACLE_OUT]) fs.rmSync(f, { force: true });
  fs.rmSync(WROOT, { recursive: true, force: true });
  fs.rmSync(SCRATCH, { recursive: true, force: true });
  core.cleanup();
});
test.afterEach(() => {
  globalThis.__v78p2fakes = undefined;
});

// A function that already went through a generate: the developer's sketch at
// body depth, code under each line. `s.total(...)` is a member call, so the
// refine has something to look up.
const ADD_SKETCH = ["take both inputs", "sum them with the shared summer"];
const ADD_FN = [
  "pub fn add(a: i32, b: i32) -> i32 {",
  "    // take both inputs",
  "    let s = Summer::new();",
  "    // sum them with the shared summer",
  "    s.total(a, b)",
  "}",
].join("\n");
const ADD_SOURCE = `${ADD_FN}\n`;
// What every round's model sends back: the code changed, the sketch gone.
const ADD_REPLY_NO_COMMENTS = "pub fn add(a: i32, b: i32) -> i32 {\n    let s = Summer::new();\n    s.total(a, b) + 0\n}";

function crate(tag) {
  const root = fs.mkdtempSync(path.join(SCRATCH, `${tag}-`));
  fs.writeFileSync(path.join(root, "Cargo.toml"), '[package]\nname = "p"\nversion = "0.1.0"\n');
  fs.mkdirSync(path.join(root, "src"));
  const file = path.join(root, "src", "lib.rs");
  fs.writeFileSync(file, ADD_SOURCE);
  // Another caller of `total`, so the refine's reference lookup finds a window.
  const other = path.join(root, "src", "other.rs");
  fs.writeFileSync(other, "pub fn twice(x: i32) -> i32 {\n    let s = Summer::new();\n    s.total(x, x)\n}\n");
  return { root, file, other };
}

function oracleDocument(file) {
  const text = ADD_SOURCE;
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

const addResolved = () => ({
  span: { start: 0, end: ADD_FN.length },
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
const broken = (root, file) => ({
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
        { fileName: file, byteStart: 120, byteEnd: 125, lineStart: 5, lineEnd: 5, columnStart: 5, columnEnd: 10, isPrimary: true },
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
const runOf = (root, outcome) => ({
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
        failures: outcome === "pass" ? [] : [{ name: "adds", message: "assertion failed" }],
        passed: outcome === "pass" ? 1 : 0,
        failed: outcome === "pass" ? 0 : 1,
        ignored: 0,
        durationMs: 1,
        crateRoot: root,
      },
    },
  ],
});

/** One post-accept session on `add`, the model answering `reply`. */
async function oracleRun({ leg, reply }) {
  const { root, file, other } = crate(leg);
  oracleState.messages = [];
  oracleState.config = { repairEnabled: true };
  let checks = 0;
  let runs = 0;
  if (leg === "compiler") {
    globalThis.__v78p2fakes = { runOracleCheck: async () => (checks++ === 0 ? broken(root, file) : clean(root)) };
  } else if (leg === "tests") {
    globalThis.__v78p2fakes = {
      runOracleCheck: async () => clean(root),
      prepareCallRoot: async () => ({ uri: "file:///x", name: "add" }),
      discoverCoveringTests: async () => ({ groups: [GROUP(root)] }),
      runCoveringGroups: async () => runOf(root, runs++ === 0 ? "fail" : "pass"),
    };
  } else {
    globalThis.__v78p2fakes = {
      runOracleCheck: async () => clean(root),
      prepareCallRoot: async () => ({ uri: "file:///x", name: "add" }),
      discoverCoveringTests: async () => ({ groups: [] }),
    };
  }
  const lines = [];
  const presented = [];
  const generateCalls = [];
  const ctx = {
    document: oracleDocument(file),
    landedSpan: { start: 0, end: ADD_FN.length },
    output: { appendLine: (l) => lines.push(String(l)), append() {} },
    service: {
      modelTag: "stub-model",
      generateRaw: async (...a) => {
        generateCalls.push(a);
        return { text: reply };
      },
      logOutcome() {},
    },
    presenter: {
      present: async (p) => {
        presented.push(p);
        return "reject";
      },
    },
    resolveFunction: async () => addResolved(),
    inFlight: { begin: () => ({ release() {} }) },
    repairTierGate: { allowed: true },
    manualRefine: true,
    extractor: {
      completeMembers: async () => [],
      example: async () => undefined,
      membersOfType: async () => [],
      references: async () => [{ uri: "file://" + other, line: 2, character: 6, endLine: 2, endCharacter: 11 }],
    },
  };
  try {
    await runPostAcceptOracle(ctx);
  } catch (err) {
    lines.push(`[test] threw: ${String(err)}`);
  }
  return { presented, lines, generateCalls, messages: oracleState.messages.slice() };
}

const showO = (r) => `channel=\n${r.lines.join("\n")}\nmessages=${JSON.stringify(r.messages)}`;

// One row per write path, all through the one harness. Generate Function is
// row 2's rig above, asserted on the same terms.
const ROUND_ROWS = [
  { leg: "compiler", tag: "[repair]", title: "add: repair round 1 (preview, 2 sketch comments restored)" },
  { leg: "tests", tag: "[tests]", title: "add: repair from failing tests, round 1 (preview, 2 sketch comments restored)" },
  { leg: "refine", tag: "[repair]", title: "add: match how the repo uses its calls (preview, 2 sketch comments restored)" },
];

for (const row of ROUND_ROWS) {
  test(`${row.leg} round: a reply that drops the sketch is presented with it back, in order`, async () => {
    const r = await oracleRun({ leg: row.leg, reply: ADD_REPLY_NO_COMMENTS });
    assert.equal(r.presented.length, 1, `${row.leg}: one diff.\n${showO(r)}`);
    const p = r.presented[0];
    assert.equal(p.title, row.title, `${row.leg}\n${showO(r)}`);
    assert.deepEqual(harvestOf(p.text, "rust"), ADD_SKETCH, `${row.leg}: presented text:\n${p.text}`);
    // Every line dropped: no kept line gives placement evidence, so they land
    // together above the first code line (contract-p1 clarification).
    assertInOrder(p.text, ["    // take both inputs", "    // sum them with the shared summer", "    let s = Summer::new();", "    s.total(a, b) + 0"], row.leg);
    assert.ok(
      r.lines.includes(
        `${row.tag} sketch: 0 kept by the model, 2 placed by Column 80, 0 could not be placed; placed: ${ADD_SKETCH.join(" | ")}`,
      ),
      `${row.leg}\n${showO(r)}`,
    );
  });
}

test("compiler round: a reply equal to the function but for its dropped comments is unchanged, not proposed", async () => {
  const reply = "pub fn add(a: i32, b: i32) -> i32 {\n    let s = Summer::new();\n    s.total(a, b)\n}";
  const r = await oracleRun({ leg: "compiler", reply });
  assert.equal(r.presented.length, 0, showO(r));
  assert.ok(r.lines.some((l) => /round 1 made no meaningful change; not proposed/.test(l)), showO(r));
});

test("tests round: dropped comments alone read as unchanged too", async () => {
  const reply = "pub fn add(a: i32, b: i32) -> i32 {\n    let s = Summer::new();\n    s.total(a, b)\n}";
  const r = await oracleRun({ leg: "tests", reply });
  assert.equal(r.presented.length, 0, showO(r));
  assert.ok(r.lines.some((l) => /\[tests\] round 1 returned the function unchanged; not proposed/.test(l)), showO(r));
});

test("refine round: dropped comments alone read as unchanged too", async () => {
  const reply = "pub fn add(a: i32, b: i32) -> i32 {\n    let s = Summer::new();\n    s.total(a, b)\n}";
  const r = await oracleRun({ leg: "refine", reply });
  assert.equal(r.presented.length, 0, showO(r));
  assert.ok(r.lines.some((l) => /refine outcome round=1 result=unchanged/.test(l)), showO(r));
});

test("compiler round: a one-line reply gets a slot made and the sketch restored", async () => {
  const reply = "pub fn add(a: i32, b: i32) -> i32 { Summer::new().total(a, b) + 0 }";
  const r = await oracleRun({ leg: "compiler", reply });
  assert.equal(r.presented.length, 1, showO(r));
  assert.equal(
    r.presented[0].text,
    "pub fn add(a: i32, b: i32) -> i32 {\n    // take both inputs\n    // sum them with the shared summer\n    Summer::new().total(a, b) + 0\n}",
  );
  assert.equal(r.presented[0].title, "add: repair round 1 (preview, 2 sketch comments restored)");
});

for (const leg of ["compiler", "tests", "refine"]) {
  test(`${leg} round: an empty-bodied reply with a sketch is refused, not presented, and claims no placement`, async () => {
    const r = await oracleRun({ leg, reply: "pub fn add(a: i32, b: i32) -> i32 {}" });
    assert.equal(r.presented.length, 0, showO(r));
    assert.ok(r.lines.some((l) => /refused: the reply has no function body to keep the sketch comments in/.test(l)), showO(r));
    assert.ok(r.lines.some((l) => /outcome round=1 result=refused/.test(l)), showO(r));
    assert.ok(!r.lines.some((l) => / sketch: /.test(l)), `a round not proposed claims nothing.\n${showO(r)}`);
  });
}

test("compiler round: a reply that differs only by dropped comments logs no sketch line, since it is not proposed", async () => {
  const reply = "pub fn add(a: i32, b: i32) -> i32 {\n    let s = Summer::new();\n    s.total(a, b)\n}";
  const r = await oracleRun({ leg: "compiler", reply });
  assert.equal(r.presented.length, 0, showO(r));
  assert.ok(!r.lines.some((l) => / sketch: /.test(l)), showO(r));
});

test("compiler round: a reply that keeps the sketch keeps today's title", async () => {
  const reply = ADD_FN.replace("s.total(a, b)", "s.total(a, b) + 0");
  const r = await oracleRun({ leg: "compiler", reply });
  assert.equal(r.presented.length, 1, showO(r));
  assert.equal(r.presented[0].title, "add: repair round 1 (preview)");
  assert.equal(r.presented[0].text, reply);
  assert.ok(r.lines.includes("[repair] sketch: 2 kept by the model, 0 placed by Column 80, 0 could not be placed"), showO(r));
});
