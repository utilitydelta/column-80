// Blind oracle, session-v57 phase 3: "the tier message that skipped the sweep"
// (roadmap item 63, third string). Contract: session-v57/contract-phase3.md.
// Written BEFORE the fix, against the CONTRACT ONLY: no assertion here is
// copied from the product's message construction, its tier gate, its toast
// table or src/vscode/toastText.ts. None of those were read.
//
// THE SCENARIO, IDENTICAL IN EVERY ROW. The Claude Code backend is selected
// (`fnGenProvider: "claude-code"`), the CLI probe answers PRESENT, and the
// injected directory-creation seam (`ClaudeCodeDeps.ensureDir`) THROWS an
// ordinary Error. Nothing touches the filesystem, nothing spawns, nothing
// dials. The tier that comes out is the product's own `cwd-unusable` tier -
// never a hand-built tier object.
//
// WHAT PINS WHAT:
//   contract 1  "the notification is one line"        -> rows 1a (single-line
//               failure) and 1b (MULTI-LINE failure, the falsification tail)
//   contract 2  "no `Error:` at the detail position"  -> rows 2a and 2b
//   contract 3  "the failing path is still named"     -> row 3
//   contract 4  "the channel keeps everything"        -> rows 4a and 4b
//   contract 5  "the tier still fails closed"         -> row 5
//
// THE FALSIFICATION TAIL. Row 1b/2b/4b inject `new Error("first line\nsecond
// line\nthird line")`. A real `mkdirSync` EACCES is one line, so a fix that
// only ever gets tested against one is indistinguishable from no fix at all on
// the newline clause. The multi-line row is what separates "the notification
// is built as one line" from "the notification happened to be one line".
//
// WHAT THIS FILE DRIVES. The RENDERED TOAST, through the product's registered
// gesture - confirmed reachable before anything was asserted (the harness
// witness row below prints both captured surfaces). `registerFnGen` against
// the vscode stub (the v56 phase-2 precedent harness), the REAL
// `buildFnGenService` behind the `buildService` seam, `column80.generateFunction`
// invoked as the user invokes it. The notification is whatever the stub's
// `showWarningMessage`/`showErrorMessage` was handed; the channel is whatever
// the same drive appended to the extension's output channel. Row 5 is the one
// row that does NOT need the gesture: it calls `buildFnGenService` directly,
// because "fails closed rather than throwing out of the service build" is a
// statement about the build.
//
// BINDINGS THE CONTRACT LEAVES OPEN, resolved and REPORTED:
//   * "NO `Error:` PREFIX AT THE DETAIL POSITION" (contract 2). Bound exactly
//     as the contract's own bindings section binds it: the notification text
//     does not contain the substring `Error:`. Case-sensitive, anywhere in the
//     string. The contract's wider "any other language-runtime envelope
//     wording" is NOT bound to a list of my own invention: only `Error:` is
//     asserted, because that is the one the contract names.
//   * "ONE LINE" (contract 1). Bound as the contract binds it: no `\n` in the
//     notification text. A trailing `\r` would also be a break; `\r` is
//     asserted absent too, as the same clause under a different encoding.
//   * WHICH MESSAGE IS "THE NOTIFICATION" (all clauses). Bound to: every
//     user-facing message the drive produced that mentions being disabled
//     (/disabled/i). If more than one appears, EVERY one must satisfy the
//     clause - a one-line toast beside a raw multi-line one is not a fix.
//   * "STILL NAMES THE WORKING DIRECTORY" (contract 3). Bound to: the
//     notification contains the injected `storagePath` as a substring. The
//     product derives the actual directory under that path; asserting the
//     derived leaf name would be asserting an implementation literal, so the
//     ancestor the rig itself injected is what is asserted.
//   * "STILL SAYS FUNCTION GENERATION IS DISABLED" (contract 3). Bound to:
//     /function generation is disabled/i on the notification.
//   * "THE CHANNEL" (contract 4). Bound to: any line the SAME drive appended
//     to the extension's output channel. `column80.generateFunction` is the
//     gesture used for this clause because its drive puts the disabled event
//     on both surfaces; `column80.tightenDocComment` toasts the same text but
//     records a short reason code on the channel instead, so tighten is swept
//     for clauses 1-3 only and is deliberately not held to clause 4.
//   * "WHATEVER THE NOTIFICATION DROPS, THE CHANNEL KEEPS" (contract 4).
//     Bound to two conjuncts: (a) every line of the injected failure text that
//     is absent from the notification is present on the channel, and (b) the
//     channel carries the full message in one piece, i.e. some single channel
//     line contains every line of the injected failure text. Conjunct (b) is
//     what stops a "fix" that shortens both surfaces at once.
//   * ROW 5's "FAILS CLOSED". Bound to: `buildFnGenService` RESOLVES (does not
//     reject), and the resolved tier reports fn-gen not enabled. Nothing is
//     asserted about the tier's wording in that row.
//
// AMBIGUITY REPORTED, NOT RESOLVED. Contract 2 also forbids "any other
// language-runtime envelope wording" without enumerating it. This file does
// not invent that enumeration. If a fix replaces `Error:` with, say,
// `EACCES:` at the same position, every row here passes and the contract's
// spirit may still be unmet. That is a contract gap, reported here.
//
// EXPECTED TODAY (pre-fix): the `Error:` rows RED on both surfaces' notifications,
// the multi-line newline row RED, the single-line newline row GREEN (a one-line
// mkdirSync error happens to fit), contract 3 GREEN, contract 4 GREEN (the
// channel carries the whole thing today because the notification does too),
// contract 5 GREEN.
//
// Run: node --test test/blind-v57-p3-tier-message.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const fs = require("node:fs");
const esbuild = require("esbuild");

// ---------------------------------------------------------------------------
// The vscode stub, copied verbatim from the v56 phase-2 blind oracle (the
// precedent harness for driving REGISTERED gestures headless). Nothing in it
// reads src/**; esbuild resolves the product at bundle time only.
// ---------------------------------------------------------------------------

const WROOT = path.join(__dirname, ".blind-v57-p3-workspace");
fs.mkdirSync(path.join(WROOT, "src"), { recursive: true });
fs.writeFileSync(
  path.join(WROOT, "package.json"),
  '{"name":"w","version":"0.0.0","scripts":{"test":"vitest run"},"devDependencies":{"vitest":"^1.0.0"}}\n',
);

const STUB = path.join(__dirname, ".blind-v57-p3-stub.cjs");
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
      has: () => false, inspect: () => undefined, update: async () => {},
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
    showQuickPick: async () => undefined,
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

const entry = path.join(__dirname, ".blind-v57-p3.entry.ts");
const outfile = path.join(__dirname, ".blind-v57-p3.bundle.cjs");
let bundleErr;
let registerFnGen;
let buildFnGenService;
let ContextBlockStore;
let __state;
let Position;
let Range;
try {
  fs.writeFileSync(
    entry,
    `export { registerFnGen, buildFnGenService } from "../src/vscode/fnGen";
export { ContextBlockStore } from "../src/core/contextBlocks";
export { __state, Position, Range } from "vscode";\n`,
  );
  esbuild.buildSync({ entryPoints: [entry], bundle: true, outfile, format: "cjs", platform: "node", alias: { vscode: STUB } });
  ({ registerFnGen, buildFnGenService, ContextBlockStore, __state, Position, Range } = require(outfile));
} catch (e) {
  bundleErr = e;
}

test.after(() => {
  for (const f of [entry, outfile, STUB]) fs.rmSync(f, { force: true });
  fs.rmSync(WROOT, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// The fixture: a real function under a dictated comment, so the gesture gets
// as far as the tier gate for PRODUCT reasons and never refuses because the
// rig's document was imaginary.
// ---------------------------------------------------------------------------

const SRC =
  "// this walker keeps a shard mem cache for each of the client sets and drops every entry it can prove is stale\n" +
  "export function walk() {\n" +
  "  return 1;\n" +
  "}\n" +
  "\n";
const FILE = "file://" + path.join(WROOT, "src", "walk.ts");
fs.writeFileSync(path.join(WROOT, "src", "walk.ts"), SRC);

function makeDoc() {
  const src = SRC;
  const lineStarts = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === "\n") lineStarts.push(i + 1);
  const offsetAt = (pos) => Math.min((lineStarts[pos.line] ?? src.length) + pos.character, src.length);
  const fsPath = FILE.replace(/^file:\/\//, "");
  return {
    languageId: "typescript",
    version: 1,
    isDirty: false,
    isClosed: false,
    lineCount: src.split("\n").length,
    fileName: fsPath,
    uri: { fsPath, path: fsPath, scheme: "file", toString: () => FILE, with() { return this; } },
    getText(range) {
      return range ? src.slice(offsetAt(range.start), offsetAt(range.end)) : src;
    },
    offsetAt,
    positionAt(offset) {
      let line = 0;
      while (line + 1 < lineStarts.length && lineStarts[line + 1] <= offset) line++;
      return new Position(line, offset - lineStarts[line]);
    },
    lineAt(arg) {
      const n = typeof arg === "number" ? arg : arg.line;
      const text = src.split("\n")[n] ?? "";
      const m = text.match(/\S/);
      return {
        lineNumber: n,
        text,
        range: new Range(n, 0, n, text.length),
        firstNonWhitespaceCharacterIndex: m ? m.index : text.length,
        isEmptyOrWhitespace: !m,
      };
    },
    save: async () => true,
  };
}

const symbolsFor = () => [
  { name: "walk", detail: "", kind: 11, range: new Range(1, 0, 3, 1), selectionRange: new Range(1, 16, 1, 20), children: [] },
];

const IN_COMMENT = [0, 20];
const IN_FUNCTION = [2, 4];

function selectionAt(a) {
  const p = new Position(a[0], a[1]);
  const sel = new Range(p, p);
  sel.active = p;
  sel.anchor = p;
  return sel;
}

// ---------------------------------------------------------------------------
// The two failure texts. SINGLE is the shape a real mkdirSync throws; MULTI is
// the falsification tail.
// ---------------------------------------------------------------------------

const SINGLE = "EACCES: permission denied, mkdir '/x'";
const MULTI = "first line\nsecond line\nthird line";

const GEN = "column80.generateFunction";
const TIGHTEN = "column80.tightenDocComment";
const CLI_PRESENT = { stdout: "2.1.224 (Claude Code)\n", exitCode: 0 };
const STORAGE = path.join(WROOT, ".storage");

const waitFor = async (predicate, tries = 400) => {
  for (let i = 0; i < tries; i++) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, 5));
  }
  return false;
};

/** The deps that make the Claude Code backend's working-directory creation
 *  fail: a PRESENT CLI so the build gets past the PATH probe, and a throwing
 *  `ensureDir` so it reaches the cwd-unusable arm. */
const failingDeps = (failure) => ({
  storagePath: STORAGE,
  run: async () => CLI_PRESENT,
  ensureDir: () => {
    throw new Error(failure);
  },
});

/** Register the product's gestures against the REAL cwd-unusable tier, invoke
 *  one gesture as the user does, and capture BOTH surfaces from that one
 *  drive. */
async function drive({ command, failure, cursor }) {
  __state.config = { fnGenProvider: "claude-code" };
  __state.messages = [];
  __state.commands = {};
  __state.executeCalls = [];
  __state.appliedEdits = [];
  __state.snippetInserts = [];
  __state.warnResponses = [];
  const doc = makeDoc();
  __state.textDocuments = [doc];
  __state.symbols = symbolsFor();
  __state.symbolsSet = true;

  const lines = [];
  const output = { lines, appendLine: (l) => lines.push(l), append() {}, show() {}, clear() {}, dispose() {} };
  const context = { subscriptions: [], globalStorageUri: { fsPath: STORAGE } };
  let built;

  registerFnGen(context, output, new ContextBlockStore(() => {}), {
    // The REAL construction with only host seams injected: the product's own
    // buildFnGenService decides the tier.
    buildService: async (out, log) => {
      built = await buildFnGenService(out, log, undefined, failingDeps(failure));
      return built;
    },
    claudeCode: failingDeps(failure),
  });

  const registered = await waitFor(() => typeof __state.commands[command] === "function" && built !== undefined);
  assert.ok(
    registered,
    `harness: ${command} never registered (or the service never built); commands seen: ` +
      JSON.stringify(Object.keys(__state.commands)),
  );

  __state.activeTextEditor = {
    document: doc,
    viewColumn: 1,
    options: { tabSize: 4, insertSpaces: true },
    selection: selectionAt(cursor),
    insertSnippet: async (snippet, range) => { __state.snippetInserts.push({ value: snippet.value, range }); return true; },
    revealRange: () => {},
    edit: async () => true,
  };

  // Everything from here on is what INVOKING the gesture did.
  __state.messages = [];
  const channelBefore = lines.length;

  await __state.commands[command]();
  await new Promise((r) => setTimeout(r, 60));

  const messages = __state.messages.map((m) => m.message).filter((m) => typeof m === "string");
  const channel = lines.slice(channelBefore);

  for (const d of context.subscriptions) {
    try { d.dispose?.(); } catch { /* teardown only */ }
  }
  try { built.service.dispose(); } catch { /* teardown only */ }

  return { tier: built.tier, messages, channel, allChannel: lines };
}

/** The notifications this file holds to the contract: every user-facing
 *  message from the drive that tells the user something is disabled. */
const disabledToasts = (r) => r.messages.filter((m) => /disabled/i.test(m));

const show = (label, r) => {
  const t = disabledToasts(r);
  return (
    `\n[${label}] tier.fnGenEnabled=${r.tier.fnGenEnabled}` +
    `\n[${label}] notifications (${r.messages.length}): ${JSON.stringify(r.messages, null, 1)}` +
    `\n[${label}] disabled-notifications (${t.length}): ${JSON.stringify(t, null, 1)}` +
    `\n[${label}] channel (${r.channel.length}): ${JSON.stringify(r.channel, null, 1)}`
  );
};

const gtest = (name, fn) =>
  test(name, async () => {
    if (bundleErr) assert.fail(`harness bundle failed to build: ${bundleErr.stack || bundleErr.message}`);
    return fn();
  });

// ===========================================================================
// Harness witnesses. If either is red, every verdict below is void.
// ===========================================================================

test("harness guard: the fnGen surface bundles headless against the vscode stub", () => {
  if (bundleErr) assert.fail(`bundle failed: ${bundleErr.stack || bundleErr.message}`);
});

gtest("harness witness: the drive really reaches the rendered notification AND the channel (captures printed)", async () => {
  const single = await drive({ command: GEN, failure: SINGLE, cursor: IN_FUNCTION });
  const multi = await drive({ command: GEN, failure: MULTI, cursor: IN_FUNCTION });
  // Printed on purpose: a row that cannot produce the case is worthless, so
  // the captures are on the record whether the run is green or red.
  console.log("=== blind-v57-p3 captures ===" + show("single", single) + show("multi", multi));

  assert.strictEqual(single.tier.fnGenEnabled, false, "harness: the injected ensureDir throw must yield a DISABLED tier");
  assert.ok(
    disabledToasts(single).length > 0,
    `harness: the gesture produced no disabled notification, so no clause below can be tested.${show("single", single)}`,
  );
  assert.ok(
    single.channel.length > 0,
    `harness: the gesture put nothing on the output channel, so contract 4 cannot be tested.${show("single", single)}`,
  );
  assert.ok(
    disabledToasts(multi).length > 0,
    `harness: the MULTI-LINE row produced no disabled notification.${show("multi", multi)}`,
  );
});

// ===========================================================================
// Contract 1: the notification is one line.
// ===========================================================================

for (const [label, failure] of [["1a single-line failure", SINGLE], ["1b MULTI-LINE failure (falsification tail)", MULTI]]) {
  gtest(`contract 1 [${label}]: the disabled-tier notification carries no newline`, async () => {
    const r = await drive({ command: GEN, failure, cursor: IN_FUNCTION });
    const toasts = disabledToasts(r);
    assert.ok(toasts.length > 0, `no disabled notification to test${show(label, r)}`);
    for (const t of toasts) {
      assert.ok(
        !t.includes("\n"),
        `contract 1: "A tier disabled for cwd-unusable toasts a single line, with no embedded newline, ` +
          `whatever the underlying failure said." This notification embeds a newline.${show(label, r)}`,
      );
      assert.ok(
        !t.includes("\r"),
        `contract 1: the notification embeds a carriage return, which is the same line break in another encoding.${show(label, r)}`,
      );
    }
  });
}

// ===========================================================================
// Contract 2: no `Error:` at the detail position.
// ===========================================================================

for (const [label, failure] of [["2a single-line failure", SINGLE], ["2b MULTI-LINE failure", MULTI]]) {
  gtest(`contract 2 [${label}]: the disabled-tier notification contains no "Error:"`, async () => {
    const r = await drive({ command: GEN, failure, cursor: IN_FUNCTION });
    const toasts = disabledToasts(r);
    assert.ok(toasts.length > 0, `no disabled notification to test${show(label, r)}`);
    for (const t of toasts) {
      assert.ok(
        !t.includes("Error:"),
        `contract 2: "The message does not carry an Error: prefix ... Every sibling failure message in the ` +
          `product now carries none; this one must match." Bound (by the contract's own bindings section) to: ` +
          `the notification text does not contain the substring "Error:".${show(label, r)}`,
      );
    }
  });
}

// ===========================================================================
// Contract 3: the failing path is still named.
// ===========================================================================

gtest("contract 3 [3 single-line failure]: the notification still says function generation is disabled AND still names the working directory", async () => {
  const r = await drive({ command: GEN, failure: SINGLE, cursor: IN_FUNCTION });
  const toasts = disabledToasts(r);
  assert.ok(toasts.length > 0, `no disabled notification to test${show("3", r)}`);
  assert.ok(
    toasts.some((t) => /function generation is disabled/i.test(t)),
    `contract 3: "The message still says function generation is disabled".${show("3", r)}`,
  );
  assert.ok(
    toasts.some((t) => t.includes(STORAGE)),
    `contract 3: "and still names the working directory that could not be created, so the user can act on it." ` +
      `Bound to: the notification contains the injected storagePath ${JSON.stringify(STORAGE)}.${show("3", r)}`,
  );
});

// ===========================================================================
// Contract 4: the channel keeps everything the notification dropped.
// ===========================================================================

for (const [label, failure] of [["4a single-line failure", SINGLE], ["4b MULTI-LINE failure (falsification tail)", MULTI]]) {
  gtest(`contract 4 [${label}]: whatever the notification dropped, the output channel line for the same event keeps`, async () => {
    const r = await drive({ command: GEN, failure, cursor: IN_FUNCTION });
    const toasts = disabledToasts(r);
    assert.ok(toasts.length > 0, `no disabled notification to test${show(label, r)}`);
    assert.ok(r.channel.length > 0, `no channel line from the same drive${show(label, r)}`);

    const pieces = failure.split("\n");
    const notification = toasts.join("\n");
    const dropped = pieces.filter((p) => !notification.includes(p));

    for (const d of dropped) {
      assert.ok(
        r.channel.some((l) => l.includes(d)),
        `contract 4: "Whatever the notification drops, the output channel line for the same event keeps the ` +
          `full message." The notification dropped ${JSON.stringify(d)} and no channel line carries it.${show(label, r)}`,
      );
    }

    assert.ok(
      r.channel.some((l) => pieces.every((p) => l.includes(p))),
      `contract 4: no SINGLE channel line carries the full message (every part of ` +
        `${JSON.stringify(failure)}). A fix that shortens both surfaces at once satisfies "the notification ` +
        `dropped nothing" and still loses the detail.${show(label, r)}`,
    );
  });
}

// ===========================================================================
// Contract 5: the tier still fails closed.
// ===========================================================================

for (const [label, failure] of [["5a single-line failure", SINGLE], ["5b MULTI-LINE failure", MULTI]]) {
  gtest(`contract 5 [${label}]: a working directory that cannot be created disables the tier rather than throwing out of the service build`, async () => {
    __state.config = { fnGenProvider: "claude-code" };
    const lines = [];
    const output = { lines, appendLine: (l) => lines.push(l), append() {}, show() {}, clear() {}, dispose() {} };
    let built;
    try {
      built = await buildFnGenService(output, (l) => lines.push(l), undefined, failingDeps(failure));
    } catch (e) {
      assert.fail(
        `contract 5: "A working directory that cannot be created disables the tier rather than throwing out of ` +
          `the service build." buildFnGenService threw: ${e && (e.stack || e.message)}`,
      );
    }
    assert.strictEqual(
      built.tier.fnGenEnabled,
      false,
      `contract 5: the build returned an ENABLED tier over a working directory that could not be created. ` +
        `Channel: ${JSON.stringify(lines)}`,
    );
    try { built.service.dispose(); } catch { /* teardown only */ }
  });
}

// ===========================================================================
// Clause 1-3 sweep on the SECOND gesture that renders this tier's message.
// Tighten toasts the same disabled story; its channel records a short reason
// code rather than the message, so it is deliberately NOT held to contract 4.
// ===========================================================================

gtest("contract 1+2 sweep [tighten x MULTI-LINE failure]: the second gesture's notification is one line and carries no \"Error:\"", async () => {
  const r = await drive({ command: TIGHTEN, failure: MULTI, cursor: IN_COMMENT });
  const toasts = disabledToasts(r);
  assert.ok(toasts.length > 0, `tighten produced no disabled notification${show("tighten", r)}`);
  for (const t of toasts) {
    assert.ok(!t.includes("\n"), `contract 1 on the tighten gesture: the notification embeds a newline.${show("tighten", r)}`);
    assert.ok(!t.includes("Error:"), `contract 2 on the tighten gesture: the notification contains "Error:".${show("tighten", r)}`);
  }
});
