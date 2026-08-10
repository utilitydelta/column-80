// Implementer test for session-v31 phase 1, loop 2: the ZERO-HOLE FLOOR on
// column80.generateTests.
//
// Migrated from the phase-1 adversarial review, which found that nothing refused
// a blank-value pass that located no expected value. `assert!(add(2, 2) == 4)`
// and a one-argument `assert_eq!(add(2, 2))` both yield zero spans;
// blankTestModule then returns the module text VERBATIM with holes: 0, so the
// model's GUESSED value would be written into the buffer under an
// "inserted" message. That is the blank-value invariant inverted, which
// goal.md item 6 names as the failure mode that makes the product LIE rather
// than merely break.
//
// The fix is at the CONSUMER: blankTestModule's signature and behaviour are
// frozen (blind-v8-assembly pins them), so the handler refuses instead. These
// tests drive the real command against a stub extension host and assert on the
// two things a leak would show up in: the buffer, and the diff preview.
//
// Run: SKIP_LIVE=1 node --test test/impl-v31-zerohole.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");

// ---------------------------------------------------------------------------
// The vscode stub. Every channel that could WRITE is recorded rather than
// swallowed: insertSnippet on the editor, workspace.applyEdit, and the
// `vscode.diff` executeCommand the proposal preview opens.
// ---------------------------------------------------------------------------

const STUB = path.join(__dirname, ".impl-v31-zerohole-stub.cjs");
fs.writeFileSync(
  STUB,
  `
const state = {
  config: {}, messages: [], commands: {}, activeTextEditor: undefined,
  snippetInserts: [], appliedEdits: [], executeCalls: [], symbols: [],
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
  contains(pos) {
    const p = pos.start ? pos.start : pos;
    const afterStart = p.line > this.start.line || (p.line === this.start.line && p.character >= this.start.character);
    const beforeEnd = p.line < this.end.line || (p.line === this.end.line && p.character <= this.end.character);
    return afterStart && beforeEnd;
  }
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
class MarkdownString { appendCodeblock() {} }
class Diagnostic { constructor(range, message) { this.range = range; this.message = message; } }
class TabInputTextDiff { constructor(original, modified) { this.original = original; this.modified = modified; } }
const Uri = {
  file: (p) => ({ fsPath: p, path: p, scheme: "file", toString: () => "file://" + p }),
  from: (parts) => ({ ...parts, fsPath: parts.path, toString: () => parts.scheme + "://" + parts.path + "?" + (parts.query || "") }),
  parse: (s) => ({ raw: s, toString: () => s }),
};
module.exports = {
  __state: state,
  Position, Range, Selection, SnippetString, WorkspaceEdit, EventEmitter,
  ThemeColor, MarkdownString, Diagnostic, TabInputTextDiff, Uri,
  DiagnosticSeverity: { Error: 0, Warning: 1 },
  SymbolKind: { Function: 11, Method: 5, Constructor: 8, Struct: 22, Enum: 9 },
  ProgressLocation: { Notification: 15, Window: 10 },
  ConfigurationTarget: { Global: 1 },
  workspace: {
    getConfiguration: () => ({
      get: (key, fallback) => (key in state.config ? state.config[key] : fallback),
      inspect: () => undefined, update: async () => {},
    }),
    onDidChangeConfiguration: () => ({ dispose() {} }),
    registerTextDocumentContentProvider: () => ({ dispose() {} }),
    get textDocuments() { return []; },
    applyEdit: async (edit) => { state.appliedEdits.push(edit); return true; },
  },
  languages: {
    createDiagnosticCollection: (name) => ({ name, set() {}, delete() {}, clear() {}, dispose() {} }),
  },
  window: {
    createTextEditorDecorationType: (opts) => ({ opts, dispose() {} }),
    get visibleTextEditors() { return []; },
    get activeTextEditor() { return state.activeTextEditor; },
    showTextDocument: async () => state.activeTextEditor,
    showInformationMessage: async (message) => { state.messages.push({ kind: "info", message }); },
    showWarningMessage: async (message, ...actions) => { state.messages.push({ kind: "warn", message, actions }); return undefined; },
    showErrorMessage: async (message) => { state.messages.push({ kind: "error", message }); },
    withProgress: async (opts, task) => task({ report: () => {} }, { onCancellationRequested: () => ({ dispose() {} }) }),
    setStatusBarMessage: () => ({ dispose() {} }),
    createTerminal: (opts) => ({ name: opts.name, show() {}, sendText() {} }),
    get terminals() { return []; },
    tabGroups: { all: [], onDidChangeTabs: () => ({ dispose() {} }), close: async () => {} },
  },
  commands: {
    registerCommand: (id, fn) => { state.commands[id] = fn; return { dispose() {} }; },
    executeCommand: async (id, ...args) => {
      state.executeCalls.push({ id, args });
      return id === "vscode.executeDocumentSymbolProvider" ? state.symbols : undefined;
    },
  },
};
`,
);

const entry = path.join(__dirname, ".impl-v31-zerohole.entry.ts");
const outfile = path.join(__dirname, ".impl-v31-zerohole.bundle.cjs");
fs.writeFileSync(
  entry,
  `export { registerFnGen } from "../src/vscode/fnGen";
export { FnGenService } from "../src/core/fnGenService";
export { ContextBlockStore } from "../src/core/contextBlocks";
export { blankTestModule, planTestInsertion } from "../src/core/testAssembly";
export { __state, Position, Range } from "vscode";\n`,
);
esbuild.buildSync({ entryPoints: [entry], bundle: true, outfile, format: "cjs", platform: "node", alias: { vscode: STUB } });
const { registerFnGen, FnGenService, ContextBlockStore, blankTestModule, planTestInsertion, __state, Position, Range } = require(outfile);
test.after(() => {
  fs.rmSync(entry, { force: true });
  fs.rmSync(outfile, { force: true });
  fs.rmSync(STUB, { force: true });
});

const GEN_TESTS_CMD = "column80.generateTests";

// A doc-commented, non-async, value-returning fn: everything the honest-failure
// classifier needs to say "testable", so the ONLY thing under test below is what
// the handler does with the model's reply.
const HEAD = "/// Adds two numbers.\npub fn add(a: i32, b: i32) -> i32 {\n    a + b\n}\n";
const MARKED_REGION =
  "\n#[cfg(test)]\nmod tests {\n    use super::*;\n    // column80-tests:add:begin\n" +
  "    #[test]\n    fn adds() { assert_eq!(add(1, 1), 2); }\n    // column80-tests:add:end\n}\n";

// An in-memory rust document over `src`, supplying exactly what
// resolveFunctionAtCursor and the insertion path read.
function makeDoc(src) {
  const lineStarts = [0];
  for (let i = 0; i < src.length; i++) {
    if (src[i] === "\n") lineStarts.push(i + 1);
  }
  const offsetAt = (pos) => lineStarts[pos.line] + pos.character;
  return {
    languageId: "rust",
    version: 1,
    isDirty: false,
    isClosed: false,
    uri: { fsPath: "/w/src/lib.rs", path: "/w/src/lib.rs", scheme: "file", toString: () => "file:///w/src/lib.rs" },
    getText(range) {
      return range ? src.slice(offsetAt(range.start), offsetAt(range.end)) : src;
    },
    offsetAt,
    positionAt(offset) {
      let line = 0;
      while (line + 1 < lineStarts.length && lineStarts[line + 1] <= offset) line++;
      return { line, character: offset - lineStarts[line], offset };
    },
    lineAt(line) {
      const text = src.split("\n")[line] ?? "";
      return { text, firstNonWhitespaceCharacterIndex: text.length - text.trimStart().length };
    },
    save: async () => true,
  };
}

const fence = (body) => "```rust\n" + body + "\n```";
const MODULE = (assertion) =>
  `#[cfg(test)]\nmod tests {\n    use super::*;\n\n    #[test]\n    fn adds() {\n        ${assertion}\n    }\n}`;

// Register with a canned model reply, put the cursor inside `add`, drive the
// command, and hand back everything a leak would show up in.
async function driveGenerateTests(src, reply) {
  const doc = makeDoc(src);
  __state.config = {};
  __state.messages = [];
  __state.commands = {};
  __state.snippetInserts = [];
  __state.appliedEdits = [];
  __state.executeCalls = [];
  // rust-analyzer includes the `///` doc lines in the symbol range, and the doc
  // channel reads them out of that range, so the range starts at line 0.
  __state.symbols = [
    { name: "add", kind: 11, range: new Range(0, 0, 3, 1), selectionRange: new Range(1, 7, 1, 10), children: [] },
  ];
  const lines = [];
  const output = { lines, appendLine: (l) => lines.push(l) };
  const service = new FnGenService(
    { apiBase: "http://127.0.0.1:1", model: "fake-30b", maxTokens: 256, temperature: 0.2 },
    async () => ({ text: reply, ttftMs: 1, totalMs: 2 }),
  );
  registerFnGen({ subscriptions: [] }, output, new ContextBlockStore(() => {}), {
    buildService: async () => ({
      service,
      tier: { id: "24gb", fnGenEnabled: true, fnGenModel: "fake-30b", provisional: false },
      config: {},
    }),
  });
  const editor = {
    document: doc,
    viewColumn: 1,
    selection: { active: new Position(2, 4) },
    insertSnippet: async (snippet, range) => {
      __state.snippetInserts.push({ value: snippet.value, range });
      return true;
    },
  };
  __state.activeTextEditor = editor;
  await __state.commands[GEN_TESTS_CMD]();
  service.dispose();
  return { doc, lines, messages: __state.messages, snippets: __state.snippetInserts, execs: __state.executeCalls };
}

const diffOpened = (execs) => execs.some((c) => c.id === "vscode.diff");
const wrote = (r) => r.snippets.length > 0 || __state.appliedEdits.length > 0;

// ---------------------------------------------------------------------------
// 1. The floor itself, on both shapes the review demonstrated.
// ---------------------------------------------------------------------------

const ZERO_HOLE_REPLIES = {
  "a plain `assert!(call() == guess)`": "assert!(add(2, 2) == 4);",
  "an `assert_eq!` missing its second argument": "assert_eq!(add(2, 2));",
};

for (const [label, assertion] of Object.entries(ZERO_HOLE_REPLIES)) {
  test(`zero-hole floor: ${label} writes NOTHING and says why`, async () => {
    const r = await driveGenerateTests(HEAD, fence(MODULE(assertion)));

    // The premise: this really is a zero-hole pass, not a reply the locator handled.
    const plan = planTestInsertion(HEAD, MODULE(assertion), { markerId: "add" });
    assert.strictEqual(blankTestModule(plan.text, "i32").holes, 0, "sanity: the locator finds nothing to blank");

    assert.strictEqual(r.snippets.length, 0, "no snippet: the model's guess must never reach the buffer");
    assert.strictEqual(__state.appliedEdits.length, 0, "and no workspace edit either");
    const warn = r.messages.find((m) => m.kind === "warn");
    assert.ok(warn, "the human is told, not left with a silent no-op");
    assert.match(warn.message, /no expected value/i, "the message names WHAT could not be located");
    assert.match(warn.message, /\badd\b/, "and names the function");
    assert.match(warn.message, /nothing was written/i, "and says plainly that the buffer is untouched");
    assert.ok(
      !r.messages.some((m) => m.kind === "info" && /inserted/i.test(m.message)),
      "and is never told tests were inserted",
    );
    assert.ok(r.lines.some((l) => /^\[tdd\] refused: no expected value/.test(l)), "the reason is on the evidence channel");
  });
}

// ---------------------------------------------------------------------------
// 2. The regen path: the guard fires BEFORE the preview, because a preview of an
//    unblanked test leaks the guess exactly as the buffer would.
// ---------------------------------------------------------------------------

test("zero-hole floor: the replace-generated path refuses before the diff preview is ever opened", async () => {
  const src = HEAD + MARKED_REGION;
  const plan = planTestInsertion(src, MODULE("assert!(add(2, 2) == 4);"), { markerId: "add" });
  assert.strictEqual(plan.mode, "replace-generated", "sanity: this fixture takes the preview path");

  const r = await driveGenerateTests(src, fence(MODULE("assert!(add(2, 2) == 4);")));

  assert.strictEqual(diffOpened(r.execs), false, "a preview of an unblanked test is itself a leak of the guess");
  assert.strictEqual(wrote(r), false, "and nothing is written");
  assert.ok(r.messages.some((m) => m.kind === "warn" && /no expected value/i.test(m.message)));
});

// ---------------------------------------------------------------------------
// 3. The control. A floor that also refuses the good pass is a broken feature,
//    not a safe one.
// ---------------------------------------------------------------------------

test("a located expected value still inserts, blanked, and the message counts the holes", async () => {
  const r = await driveGenerateTests(HEAD, fence(MODULE("assert_eq!(add(2, 2), 4);")));

  assert.strictEqual(r.snippets.length, 1, "the ordinary pass still writes");
  const snippet = r.snippets[0].value;
  assert.ok(snippet.includes("add(2, 2)"), "the call under test survives");
  assert.ok(!snippet.includes(", 4)"), "the model's guessed value does not");
  assert.ok(/\$\{1[:}]/.test(snippet), "and the human gets a tabstop to type it into");
  const info = r.messages.find((m) => m.kind === "info");
  assert.ok(info, "the human is told what to do next");
  assert.match(info.message, /Tab through the 1 blank value/);
});
