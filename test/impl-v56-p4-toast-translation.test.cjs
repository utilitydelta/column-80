// Implementer oracle, session-v56 phase 4 (roadmap item 63, first half):
// gaps the blind file leaves open.
//
// The blind file proves the six rejects end to end through registered
// gestures. What it cannot see:
//   * the translator unit table: each reject maps to ITS exact sentence, an
//     unknown error to the firstLine-plus-channel-pointer catch-all;
//   * the marker COUPLING, service side: each throw site's message must keep
//     carrying the substring the translator matches on. These rows drive a
//     REAL FnGenService per reject and assert the thrown message contains the
//     marker AND translates - move a throw's wording off its marker without
//     the translator following and the row goes red;
//   * the stream cut is born in the transport (src/core/ollama.ts), where a
//     behavioural drive needs a stalling HTTP stream; its service-side pin is
//     the throw template in source text;
//   * contract 4's message-less tier: the blind file refuses to hand-build a
//     tier object (its C4 ambiguity), so the fallback path never runs there.
//     Here the buildService seam returns a disabled tier WITHOUT a message and
//     both surfaces are asserted - toast and channel line.
//
// Run: node --test test/impl-v56-p4-toast-translation.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const fs = require("node:fs");
const esbuild = require("esbuild");

// ---------------------------------------------------------------------------
// vscode stub: the blind-v56-p4 surface (proven against registerFnGen),
// trimmed of the seams this file does not script.
// ---------------------------------------------------------------------------

const STUB = path.join(__dirname, ".impl-v56-p4-stub.cjs");
fs.writeFileSync(
  STUB,
  `
const state = { config: {}, messages: [], commands: {}, activeTextEditor: undefined, textDocuments: [] };
class Position {
  constructor(line, character) { this.line = line; this.character = character; }
  isBefore(o) { return this.line < o.line || (this.line === o.line && this.character < o.character); }
  isEqual(o) { return this.line === o.line && this.character === o.character; }
  translate(l = 0, c = 0) { return new Position(this.line + l, this.character + c); }
}
class Range {
  constructor(a, b, c, d) {
    if (typeof a === "number") { this.start = new Position(a, b); this.end = new Position(c, d); }
    else { this.start = a; this.end = b; }
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
    registerTextDocumentContentProvider: () => ({ dispose() {} }),
    get textDocuments() { return state.textDocuments; },
    get workspaceFolders() { return [{ uri: Uri.file("/"), name: "w", index: 0 }]; },
    getWorkspaceFolder: () => ({ uri: Uri.file("/"), name: "w", index: 0 }),
    openTextDocument: async () => state.activeTextEditor && state.activeTextEditor.document,
    applyEdit: async () => true,
    fs: {
      stat: async () => { throw new Error("ENOENT"); },
      createDirectory: async () => {},
      writeFile: async () => {},
      readFile: async () => Buffer.from(""),
      delete: async () => {},
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
    showInformationMessage: async (message, ...actions) => { state.messages.push({ kind: "info", message, actions }); return undefined; },
    showWarningMessage: async (message, ...actions) => { state.messages.push({ kind: "warn", message, actions }); return undefined; },
    showErrorMessage: async (message, ...actions) => { state.messages.push({ kind: "error", message, actions }); return undefined; },
    showQuickPick: async () => undefined,
    withProgress: async (opts, task) => task({ report: () => {} }, { onCancellationRequested: () => ({ dispose() {} }) }),
    setStatusBarMessage: () => ({ dispose() {} }),
    createStatusBarItem: () => ({ text: "", tooltip: "", command: undefined, show() {}, hide() {}, dispose() {} }),
    createTerminal: () => ({ name: "t", shown: false, sent: [], show() {}, sendText() {}, dispose() {} }),
    get terminals() { return []; },
    activeColorTheme: { kind: 1 },
    tabGroups: { all: [], activeTabGroup: undefined, onDidChangeTabs: () => ({ dispose() {} }), close: async () => {} },
  },
  commands: {
    registerCommand: (id, fn) => { state.commands[id] = fn; return { dispose() {} }; },
    executeCommand: async () => undefined,
  },
};
`,
);

const ENTRY = path.join(__dirname, ".impl-v56-p4.entry.ts");
const OUTFILE = path.join(__dirname, ".impl-v56-p4.bundle.cjs");
fs.writeFileSync(
  ENTRY,
  `export { registerFnGen, translateServiceReject, generationFailedToast } from "../src/vscode/fnGen";
export { firstLine } from "../src/vscode/toastText";
export { FnGenService } from "../src/core/fnGenService";
export { ContextBlockStore } from "../src/core/contextBlocks";
export { __state } from "vscode";\n`,
);
esbuild.buildSync({
  entryPoints: [ENTRY],
  bundle: true,
  outfile: OUTFILE,
  format: "cjs",
  platform: "node",
  alias: { vscode: STUB },
});
const B = require(OUTFILE);

test.after(() => {
  for (const f of [STUB, ENTRY, OUTFILE]) fs.rmSync(f, { force: true });
});

// ---------------------------------------------------------------------------
// The translator unit table. Sentences pinned EXACTLY: they are the product's
// user-facing wording and a drive-by rewording should be a deliberate diff
// here, not a silent one.
// ---------------------------------------------------------------------------

const SENTENCES = {
  truncation:
    "Column 80: the model's reply was cut off mid-function, so nothing was written - run the gesture again.",
  fence:
    "Column 80: the model wrapped its reply in markdown that cannot land in source code, so nothing was written - run the gesture again.",
  missingHead:
    "Column 80: the model answered with something other than the requested function, so nothing was written - run the gesture again.",
  empty: "Column 80: the model's reply contained no usable code, so nothing was written - run the gesture again.",
  streamCut:
    "Column 80: the model server went silent mid-reply, so nothing was written - check the server, then run the gesture again.",
  testRefusal:
    "Column 80: the model's reply contained no usable tests, so nothing was written - run the gesture again.",
};

const TABLE = [
  ["truncation", "generation truncated at num_predict=512 (done_reason=length)", SENTENCES.truncation],
  ["fence", "generation contains a code-fence line (unclosed or nested fence in the reply)", SENTENCES.fence],
  [
    "missing head",
    "generation does not contain the requested function (declaration head not in the reply)",
    SENTENCES.missingHead,
  ],
  ["empty", "generation was empty after postprocess", SENTENCES.empty],
  ["stream cut", "Ollama stream cut: silent for 20000ms after 512 chars (http://localhost:11434)", SENTENCES.streamCut],
  [
    "test refusal (rust)",
    "generation does not contain a test module (no `#[cfg(test)] mod tests` block with a `#[test]` fn)",
    SENTENCES.testRefusal,
  ],
  [
    "test refusal (non-rust)",
    "generation does not contain typescript test functions (no fenced block with a test function in it)",
    SENTENCES.testRefusal,
  ],
];

for (const [name, internal, sentence] of TABLE) {
  test(`translator table [${name}]: the internal string maps to its crafted sentence`, () => {
    assert.strictEqual(B.translateServiceReject(new Error(internal)), sentence);
    // Non-Error throws translate too: the marker match must not depend on the
    // throw being an Error instance.
    assert.strictEqual(B.translateServiceReject(internal), sentence);
  });
}

test("translator table: an unknown error is NOT translated and falls to the catch-all shape", () => {
  const err = new Error("the flux capacitor failed\n    at internalFrame (deep.ts:12:3)");
  assert.strictEqual(B.translateServiceReject(err), undefined);
  const toast = B.generationFailedToast(err, "function generation");
  // RE-CUT (P4 review MED 1): this row pinned "- Error: the flux capacitor
  // failed" - the catch-all's own fallback put back the prefix the six
  // translations exist to remove. The unknown branch now reads err.message.
  assert.strictEqual(
    toast,
    "Column 80: function generation failed - the flux capacitor failed. The full message is in the output channel.",
  );
  assert.ok(!toast.includes("\n"), "the catch-all toast is one line");
});

test("catch-all fallback: no untranslated error carries the Error: prefix to a toast", () => {
  // The four arms' real transport failures, none of which the table matches.
  const untranslated = [
    new Error('Ollama 500 Internal Server Error: {"error":"llama runner process has terminated"}'),
    new Error("Claude Code exited 1 despite a well-formed reply."),
    new Error("Anthropic: the stream ended before message_stop, so the reply is incomplete"),
    "a bare string throw",
  ];
  for (const err of untranslated) {
    const toast = B.generationFailedToast(err, "function generation");
    assert.strictEqual(B.translateServiceReject(err), undefined, `${err} should not translate`);
    // The prefix is what matters and only at the detail position: a server's
    // own "500 Internal Server Error:" status text is legitimate content.
    assert.ok(
      !toast.includes("failed - Error: "),
      `no Error: prefix at the detail position in ${toast}`,
    );
    assert.ok(!toast.includes("\n"), "one line");
    assert.ok(toast.includes("The full message is in the output channel."), "channel pointer kept");
  }
});

test("catch-all fallback: a message-less error gets the bare sentence, never 'failed - Error.'", () => {
  const toast = B.generationFailedToast(new Error(""), "function generation");
  assert.strictEqual(
    toast,
    "Column 80: function generation failed. The full message is in the output channel.",
  );
  assert.ok(!toast.includes("Error"), "no bare Error word");
  assert.ok(!toast.includes(" - "), "no dangling detail separator");
});

test("catch-all fallback: a message already ending in a period does not render '..'", () => {
  const toast = B.generationFailedToast(
    new Error("Claude Code exited 1 despite a well-formed reply."),
    "function generation",
  );
  assert.ok(!toast.includes(".."), `no doubled period in ${toast}`);
  assert.strictEqual(
    toast,
    "Column 80: function generation failed - Claude Code exited 1 despite a well-formed reply. The full message is in the output channel.",
  );
});

test("translator table: a known reject through the catch-all helper gets its sentence, not the firstLine shape", () => {
  const toast = B.generationFailedToast(new Error(TABLE[0][1]), "function generation");
  assert.strictEqual(toast, SENTENCES.truncation);
});

// ---------------------------------------------------------------------------
// Marker coupling, service side: a REAL FnGenService per reject. Each row
// goes red if the throw's wording moves off the substring the translator
// matches on - the exact regression the throw-site COUPLING comments warn
// about.
// ---------------------------------------------------------------------------

const CFG = {
  apiBase: "http://ml-box.invalid:11434",
  model: "qwen3-coder:480b",
  fallbackModel: "qwen3-coder:480b",
  maxTokens: 512,
  temperature: 0.2,
};
const SIG = "export function walk(): number";
const reply = (text, doneReason = "stop") => async () => ({ text, ttftMs: 1, totalMs: 2, doneReason });

async function rejectFrom(run) {
  try {
    await run();
  } catch (err) {
    return err;
  }
  assert.fail("the service accepted a reply this row needs it to reject");
}

const SERVICE_ROWS = [
  {
    name: "truncation",
    marker: "generation truncated at num_predict",
    sentence: SENTENCES.truncation,
    transport: reply("export function walk(): number {\n  return 2;\n}", "length"),
    drive: (svc) => svc.generate({ signature: SIG, languageId: "typescript" }),
  },
  {
    name: "fence",
    marker: "generation contains a code-fence line",
    sentence: SENTENCES.fence,
    transport: reply("export function walk(): number {\n```\n}"),
    drive: (svc) => svc.generate({ signature: SIG, languageId: "typescript" }),
  },
  {
    name: "missing head",
    marker: "generation does not contain the requested function",
    sentence: SENTENCES.missingHead,
    transport: reply("function somethingElse() {\n  return 3;\n}"),
    drive: (svc) => svc.generate({ signature: SIG, languageId: "typescript" }),
  },
  {
    name: "empty",
    marker: "generation was empty after postprocess",
    sentence: SENTENCES.empty,
    transport: reply(""),
    drive: (svc) => svc.generate({ signature: SIG, languageId: "typescript" }),
  },
  {
    name: "test refusal (rust)",
    marker: "does not contain a test module",
    sentence: SENTENCES.testRefusal,
    transport: reply("I cannot write tests for this function, sorry."),
    drive: (svc) => svc.generateTests({ signature: "fn walk() -> u32", languageId: "rust" }),
  },
  {
    name: "test refusal (non-rust)",
    marker: "test functions (no fenced block",
    sentence: SENTENCES.testRefusal,
    transport: reply("I cannot write tests for this function, sorry."),
    drive: (svc) => svc.generateTests({ signature: SIG, languageId: "typescript" }),
  },
];

for (const row of SERVICE_ROWS) {
  test(`marker coupling [${row.name}]: the service's throw carries the marker and translates`, async () => {
    const lines = [];
    const svc = new B.FnGenService(CFG, row.transport, (l) => lines.push(l));
    try {
      const err = await rejectFrom(() => row.drive(svc));
      assert.ok(err instanceof Error, `the reject must be an Error, got ${String(err)}`);
      assert.ok(
        err.message.includes(row.marker),
        `COUPLING: the throw message must keep the marker substring ${JSON.stringify(row.marker)} ` +
          `(fnGen.ts SERVICE_REJECT_TOASTS matches on it). Got: ${JSON.stringify(err.message)}`,
      );
      assert.strictEqual(B.translateServiceReject(err), row.sentence);
      assert.ok(
        lines.some((l) => l.includes(`[fngen] request failed: ${err.message}`)),
        `the channel keeps the reject's throw string verbatim. channel=${JSON.stringify(lines)}`,
      );
    } finally {
      svc.dispose();
    }
  });
}

test("marker coupling [stream cut]: the transport's throw template carries the marker", () => {
  // The stream cut is born in src/core/ollama.ts and a behavioural drive
  // needs a stalling HTTP stream, so the pin is the throw template itself.
  const src = fs.readFileSync(path.join(__dirname, "..", "src", "core", "ollama.ts"), "utf8");
  assert.ok(
    src.includes("`Ollama stream cut: ${cutBy} (${apiBase})`"),
    'COUPLING: ollama.ts must keep throwing "Ollama stream cut: ..." - fnGen.ts ' +
      "SERVICE_REJECT_TOASTS matches on that substring, and moving the wording " +
      "without the translator demotes the toast to the catch-all.",
  );
  assert.strictEqual(
    B.translateServiceReject(new Error("Ollama stream cut: silent for 30000ms before any data (http://x)")),
    SENTENCES.streamCut,
  );
});

// ---------------------------------------------------------------------------
// Contract 4, the path the blind file cannot reach: a disabled tier WITHOUT a
// message, through registerFnGen's buildService seam. Both surfaces get the
// sibling's fallback - the toast and the channel line.
// ---------------------------------------------------------------------------

const FALLBACK = "the hardware tier is unavailable for generation";

test("message-less disabled tier: toast and channel line both use the fallback, never 'undefined'", async () => {
  const st = B.__state;
  st.config = { apiBase: CFG.apiBase, fnGenModel: CFG.model };
  st.messages = [];
  st.commands = {};
  const lines = [];
  const output = { lines, appendLine: (l) => lines.push(l), append() {}, show() {}, clear() {}, dispose() {} };
  const context = { subscriptions: [], globalStorageUri: { fsPath: path.join(__dirname, ".impl-v56-p4-storage") } };
  try {
    B.registerFnGen(context, output, new B.ContextBlockStore(() => {}), {
      buildService: async () => ({
        tier: { fnGenEnabled: false }, // no message - the C4 rider's case
        service: { dispose() {} },
      }),
    });
    for (let i = 0; i < 400 && typeof st.commands["column80.generateFunction"] !== "function"; i++) {
      await new Promise((r) => setTimeout(r, 5));
    }
    assert.strictEqual(typeof st.commands["column80.generateFunction"], "function", "harness: gesture never registered");
    st.activeTextEditor = { document: { languageId: "typescript" } };
    await st.commands["column80.generateFunction"]();
    await new Promise((r) => setTimeout(r, 50));
    const warn = st.messages.find((m) => m.message.startsWith("Column 80:"));
    assert.ok(warn, `the disabled tier must toast. toasts=${JSON.stringify(st.messages)}`);
    assert.strictEqual(warn.message, `Column 80: ${FALLBACK}`);
    assert.ok(
      lines.some((l) => l === `[carve] fn-gen disabled: ${FALLBACK}`),
      `the matching channel line gets the same fallback. channel=${JSON.stringify(lines)}`,
    );
    for (const m of st.messages) {
      assert.ok(!String(m.message).includes("undefined"), `no toast may say "undefined": ${JSON.stringify(m.message)}`);
    }
    for (const l of lines) {
      assert.ok(!l.includes("undefined"), `no channel line may say "undefined": ${JSON.stringify(l)}`);
    }
  } finally {
    st.activeTextEditor = undefined;
    for (const d of context.subscriptions) {
      try {
        d.dispose?.();
      } catch {
        /* teardown only */
      }
    }
  }
});

// ---------------------------------------------------------------------------
// firstLine itself: the bound every catch-all now leans on.
// ---------------------------------------------------------------------------

test("firstLine: first non-blank line, trimmed; empty and undefined collapse to ''", () => {
  assert.strictEqual(B.firstLine("a\nb\nc"), "a");
  assert.strictEqual(B.firstLine("\n\n  spaced first  \nrest"), "spaced first");
  assert.strictEqual(B.firstLine(""), "");
  assert.strictEqual(B.firstLine(undefined), "");
});
