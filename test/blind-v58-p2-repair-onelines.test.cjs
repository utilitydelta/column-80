// Blind oracle, session-v58 phase 2: "the repair toasts and the line-break
// set" (roadmap item 69, second and third shapes). Contract:
// session-v58/contract-phase2.md. Written BEFORE the fix, against the CONTRACT.
//
// WHAT THIS FILE PINS, and how each clause is driven.
//
//   C1  a multi-line diagnostic toasts ONE line on BOTH repair surfaces
//       -> rows C1 [give-up route-exhausted], C1 [give-up cap-exhausted],
//          C1 [refine]
//   C2  the channel pointer is conditional and truthful
//       -> rows C2 [give-up pointer], C2 [refine pointer] (multi-line, pointer
//          OWED) and C2 [give-up single: no pointer], C2 [refine single: no
//          pointer] (single-line, pointer FORBIDDEN and the sentence byte-
//          identical to the branch point)
//   C3  the channel holds the WHOLE diagnostic on both surfaces
//       -> rows C3 [give-up channel], C3 [refine channel]
//   C4  the rest of each sentence survives
//       -> rows C4 [give-up sentence], C4 [refine undo clause]
//   C5  firstLine cuts on the full line-break set
//       -> rows C5 [<break>] x6, C5 [mixed] (all six rotations, so no rotation
//          can pass merely because "\n" happened to lead), C5 [leading blanks]
//          x3, C5 [edges]
//   C6  the widening does not move the ordinary cut
//       -> row C6 [no new cut on the \n-only corpus] (the regression clause)
//   C7  the v57 oracle's bare-\r assertion finally has a case that fires
//       -> row C7 [tier failure carrying a bare CR]
//   plus the tierDisabledToast conditional-pointer rule under the widened set
//       -> row C2 [tierDisabledToast pointer under the widened set]
//   C8  NOT THIS FILE'S. The implementer runs the full gate and records the
//       re-cut list in progress.md.
//
// HOW THE TWO REPAIR SURFACES ARE DRIVEN. Through the REAL session entry point
// `runPostAcceptOracle` -> executeSession, over a REAL tsc check of a real
// TypeScript workspace built by this file in a temp dir (tsconfig.json plus a
// node_modules/typescript symlink to the repo's own compiler, which is what
// the TS oracle insists on). No diagnostic object is hand-built anywhere: every
// message asserted here is one tsc actually emitted, parsed by the product's own
// tsOracle, and carried to the notification by the product's own code path.
//   * the GIVE-UP surface is reached by handing the session a function that is
//     already broken and a scripted model that keeps returning broken text:
//     `why=route-exhausted` (a round that did not reduce the error count) and
//     `why=cap-exhausted` (two rounds spent, errors still there) are BOTH driven,
//     because the contract names both.
//   * the REFINE surface is reached with `manualRefine: true` on a CLEAN
//     function whose refine reply introduces the error. This is the sharp case:
//     the diagnostic sits mid-sentence with the undo clause behind it.
//
// THE DIAGNOSTIC SHAPES. Authored as source, not as strings:
//   MULTI - a genuine TS2322 assignability error over an array of object
//           literals, which tsc elaborates into FOUR lines (three "\n" after
//           tsOracle's `current.message += "\n" + line` folds the indented
//           elaboration in). The four segments are quoted in D4 below; they are
//           TSC's words, not the product's.
//   SINGLE- a genuine TS2304 "Cannot find name" error, which is one line. This
//           is the branch-point-identity control.
//
// WHAT WAS READ, and nothing else. The contract; src/vscode/toastText.ts (a
// leaf, needed to pin C6's regression reference and the conditional-pointer
// rule); the two toast sentences at src/vscode/oracleSurface.ts:973-976 and
// :1611-1614 (the contract's C4 is explicitly about keeping the rest of each
// sentence, and session-v57 phase 4's oracle took the same allowance);
// src/core/tsOracle.ts:371 (how a multi-line message is built). The BODIES of
// the two functions the phase will change were not read past those sites, and
// no assertion here depends on how the fix is written. Harness mechanics were
// borrowed from test/impl-v29-p4-refine-flow.test.cjs (the precedent drive of
// this same entry point) and test/blind-v57-p3-tier-message.test.cjs (the tier
// drive C7 requires); those are test files, not product source.
//
// BINDINGS THE CONTRACT LEAVES OPEN, resolved and REPORTED:
//   * "NO LINE BREAK OF ANY KIND IN THE WIDENED SET" (C1). Bound to: the
//     notification contains none of "\n", "\r", U+2028, U+2029, U+0085. "\r\n"
//     is covered by "\r".
//   * "THE CHANNEL POINTER" (C2). Bound to /channel/i on the notification, the
//     same binding the v56 and v57 oracles used for a pointer sentence. The
//     exact wording is NOT asserted, so the implementer may reuse
//     tierDisabledToast's sentence or write another.
//   * "BYTE-IDENTICAL TO THE BRANCH POINT" (C2, falsifier 2). This is a
//     SNAPSHOT and is declared as one: GIVE_UP_SINGLE and REFINE_SINGLE below
//     are the two sentences transcribed from the branch-point tree (HEAD
//     bb32501) as this rig actually produced them. There is no honest way to
//     derive them - they are product prose - and the contract's own falsifier
//     asks for identity against the branch point, which is what a snapshot is
//     for. The doubled period in REFINE_SINGLE ("...'.." ) is the branch
//     point's own quirk and is preserved on purpose: the contract puts any
//     rewording out of scope.
//   * "THE CHANNEL HOLDS THE WHOLE DIAGNOSTIC" (C3). Bound to: some SINGLE
//     entry appended to the session's output channel contains all four
//     segments of the diagnostic. One entry, not four scattered ones - a fix
//     that shortens the toast and leaves a 70-char digest behind satisfies
//     nothing. An entry may itself carry newlines; it is the channel.
//   * "THE UNDO CLAUSE IS STILL PRESENT AND STILL LAST" (C4, falsifier 3).
//     AMBIGUOUS AS WRITTEN, resolved and reported: C2 requires a pointer
//     sentence on the multi-line refine toast, and a pointer appended at the
//     end would make the undo clause not literally last. Bound to the reading
//     that keeps both clauses satisfiable: the undo clause is present, it
//     starts AFTER the diagnostic's first line, and everything following it is
//     either nothing or a single channel-pointer sentence. A fix that swallows
//     the undo clause, or that reorders it in front of the diagnostic, fails.
//   * "STILL NAMES THE ERROR COUNT AND THE SYMBOL" (C4, give-up). Bound to:
//     the notification contains "1 error" and the resolved symbol name "pick".
//   * C6's REFERENCE. Not a snapshot: the branch-point rule is reimplemented
//     inline (`branchPointFirstLine`) and the widened firstLine must agree with
//     it on every corpus string that contains only "\n" or no break at all.
//     That is the whole of C6 - the widening may only ADD cut points.
//   * C7's DRIVE. Reproduced from test/blind-v57-p3-tier-message.test.cjs
//     rather than imported: that file is not a module and the contract says to
//     inject through its mechanism, not to edit it. Same seam
//     (ClaudeCodeDeps.ensureDir throwing), same gesture
//     (column80.generateFunction), same "which message is the notification"
//     binding (/disabled/i).
//
// TWO TRAPS, both real, both handled here:
//   1. String.prototype.trim strips U+2028 and U+2029 (LineTerminators) but NOT
//      U+0085 (category Cc). tierDisabledToast's `one === why.trim()` therefore
//      behaves differently across the set. Every assertion about the pointer is
//      bound to OBSERVED behaviour on a mid-string break, where all five
//      characters agree, and the trailing-break case is reported below rather
//      than asserted.
//   2. A raw U+2028/U+2029 in a .cjs file is a syntax error. Every separator in
//      this file is built with String.fromCharCode; there is not one raw
//      occurrence, including in comments.
//
// REPORTED, NOT ASSERTED - a contract gap. C2 says the pointer is appended
// "exactly when the cut removed something". For a message whose ONLY break is a
// TRAILING one ("a" + NEL), the cut removes nothing a human would miss, yet
// tierDisabledToast's equality test will disagree for U+0085 (trim leaves it)
// and agree for U+2028/U+2029 (trim eats them). The contract does not say which
// is right, so no row here demands either. If the phase cares, the contract
// needs a sentence.
//
// EXPECTED TODAY (pre-fix): see the per-row EXPECT comments.
//
// Run: node --test test/blind-v58-p2-repair-onelines.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const esbuild = require("esbuild");
const { bundleCore } = require("./.blind-util.cjs");

// ---------------------------------------------------------------------------
// The line-break set. Built by code point: a raw U+2028 or U+2029 in a .cjs
// file terminates the line the parser is on and breaks the file.
// ---------------------------------------------------------------------------

const LF = "\n";
const CR = "\r";
const CRLF = "\r\n";
const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);
const NEL = String.fromCharCode(0x0085);

/** The six forms C5 enumerates, with printable names for failure messages. */
const BREAKS = [
  ["LF (\\n)", LF],
  ["CRLF (\\r\\n)", CRLF],
  ["bare CR (\\r)", CR],
  ["U+2028 LINE SEPARATOR", LS],
  ["U+2029 PARAGRAPH SEPARATOR", PS],
  ["U+0085 NEL", NEL],
];

/** The single characters any of the six can leave behind. */
const BREAK_CHARS = [
  ["\\n", LF],
  ["\\r", CR],
  ["U+2028", LS],
  ["U+2029", PS],
  ["U+0085", NEL],
];

const breaksIn = (s) => BREAK_CHARS.filter(([, c]) => s.includes(c)).map(([n]) => n);
const printable = (s) =>
  JSON.stringify(s)
    .replace(new RegExp(LS, "g"), "<U+2028>")
    .replace(new RegExp(PS, "g"), "<U+2029>")
    .replace(new RegExp(NEL, "g"), "<U+0085>");

// ---------------------------------------------------------------------------
// Bundle 1: the leaf under C5/C6. toastText.ts imports nothing, so it needs no
// vscode stub.
// ---------------------------------------------------------------------------

let toast = {};
let toastErr;
let toastCleanup = () => {};
try {
  const b = bundleCore(
    "blind-v58-p2-toast",
    `export { firstLine, tierDisabledToast } from "../src/vscode/toastText";\n`,
  );
  toast = b.mod;
  toastCleanup = b.cleanup;
} catch (e) {
  toastErr = e;
}

// ---------------------------------------------------------------------------
// Bundle 2: the vscode surfaces. One stub and one bundle serve both drives -
// the repair session (runPostAcceptOracle) and the tier gesture (registerFnGen).
// The stub is the v57 phase-3 oracle's, which is itself the v56 phase-2
// precedent; `wroot` is a state field here because two drives use two roots.
// ---------------------------------------------------------------------------

const STUB = path.join(__dirname, ".blind-v58-p2-stub.cjs");
fs.writeFileSync(
  STUB,
  `
const state = (globalThis.__v58p2 = globalThis.__v58p2 || {
  config: {}, messages: [], commands: {}, activeTextEditor: undefined,
  snippetInserts: [], appliedEdits: [], executeCalls: [], terminals: [],
  textDocuments: [], warnResponses: [], symbols: undefined, wroot: "/",
});
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
  from: (parts) => ({ ...parts, fsPath: parts.path, toString: () => parts.scheme + "://" + parts.path }),
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
    get workspaceFolders() { return [{ uri: Uri.file(state.wroot), name: "w", index: 0 }]; },
    getWorkspaceFolder: () => ({ uri: Uri.file(state.wroot), name: "w", index: 0 }),
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
    setStatusBarMessage: (message) => { state.messages.push({ kind: "status", message }); return { dispose() {} }; },
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

const ENTRY = path.join(__dirname, ".blind-v58-p2.entry.ts");
const OUTFILE = path.join(__dirname, ".blind-v58-p2.bundle.cjs");
let surfaceErr;
let runPostAcceptOracle;
let FnGenService;
let registerFnGen;
let buildFnGenService;
let ContextBlockStore;
try {
  fs.writeFileSync(
    ENTRY,
    `export { runPostAcceptOracle } from "../src/vscode/oracleSurface";
export { FnGenService } from "../src/core/fnGenService";
export { registerFnGen, buildFnGenService } from "../src/vscode/fnGen";
export { ContextBlockStore } from "../src/core/contextBlocks";\n`,
  );
  esbuild.buildSync({
    entryPoints: [ENTRY],
    bundle: true,
    outfile: OUTFILE,
    format: "cjs",
    platform: "node",
    alias: { vscode: STUB },
  });
  ({ runPostAcceptOracle, FnGenService, registerFnGen, buildFnGenService, ContextBlockStore } = require(OUTFILE));
} catch (e) {
  surfaceErr = e;
}
// The stub is bundled in by the alias; the bundled copy publishes onto
// globalThis, and that is the instance the product writes to.
const stubState = globalThis.__v58p2;

test.after(() => {
  toastCleanup();
  for (const f of [ENTRY, OUTFILE, STUB]) fs.rmSync(f, { force: true });
});

// ===========================================================================
// THE REPAIR DRIVE. A real TypeScript workspace, a real tsc, the real session.
// ===========================================================================

const REPO_TS = path.join(__dirname, "..", "node_modules", "typescript");

/** The clean function the refine rows start from. `Leaf[]` with a string field
 *  is chosen so a single wrong literal produces the FOUR-line elaboration. */
const CLEAN_SRC =
  "type Leaf = { leaf: string };\n" +
  "\n" +
  "export function pick(): Leaf[] {\n" +
  '  const v = [{ leaf: "a" }];\n' +
  "  return v;\n" +
  "}\n";

/** tsc's four lines for the assignability error this fixture provokes. TSC's
 *  words, transcribed from a real run; nothing here is the product's prose. */
const D4 = [
  "Type '{ leaf: number; }[]' is not assignable to type 'Leaf[]'.",
  "Type '{ leaf: number; }' is not assignable to type 'Leaf'.",
  "Types of property 'leaf' are incompatible.",
  "Type 'number' is not assignable to type 'string'.",
];

const brokenBody = (n) => `export function pick(): Leaf[] {\n  const v = [{ leaf: ${n} }];\n  return v;\n}`;
const undefinedBody = (name) => `export function pick(): Leaf[] {\n  return ${name};\n}`;

/** SNAPSHOTS of the branch point (HEAD bb32501), declared as such in the header.
 *  A single-line diagnostic must leave these two sentences untouched. */
const GIVE_UP_SINGLE =
  "Column 80: repair stopped with 1 error still in pick. First: TS2304: Cannot find name 'missingIdentifierTwo'.";
const REFINE_SINGLE =
  "Column 80: the refine of pick introduced 1 error that were not there before. " +
  "First: TS2304: Cannot find name 'missingIdentifier'.. " +
  "Undo it with the editor's own undo (the build was clean before this change).";

/** The clause C4 says the refine toast must still end with. */
const UNDO_CLAUSE = "Undo it with the editor's own undo (the build was clean before this change).";

function makeWorkspace(initial) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "blind-v58-p2-"));
  fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  fs.mkdirSync(path.join(dir, "node_modules"), { recursive: true });
  // The TS oracle refuses a tsconfig without a PROJECT typescript, by design.
  fs.symlinkSync(REPO_TS, path.join(dir, "node_modules", "typescript"), "dir");
  fs.writeFileSync(
    path.join(dir, "tsconfig.json"),
    JSON.stringify(
      { compilerOptions: { strict: true, noEmit: true, target: "ES2020", moduleResolution: "node" }, include: ["src"] },
      null,
      2,
    ) + "\n",
  );
  fs.writeFileSync(path.join(dir, "src", "target.ts"), initial);
  fs.writeFileSync(
    path.join(dir, "src", "caller.ts"),
    'import { pick } from "./target";\n\nexport function useIt(): number {\n  return pick().length;\n}\n',
  );
  return dir;
}

/** A TextDocument over a file on disk, re-read every time: the session saves
 *  and re-checks, so a snapshotted buffer would lie to the second check. */
const fileDocument = (file) => ({
  languageId: "typescript",
  isDirty: true,
  isClosed: false,
  version: 1,
  uri: { fsPath: file, path: file, scheme: "file", toString: () => "file://" + file },
  getText(range) {
    const t = fs.readFileSync(file, "utf8");
    return range ? t.slice(this.offsetAt(range.start), this.offsetAt(range.end)) : t;
  },
  offsetAt(pos) {
    if (pos && typeof pos.offset === "number") return pos.offset;
    const lines = fs.readFileSync(file, "utf8").split("\n");
    let o = 0;
    for (let i = 0; i < Math.min(pos.line, lines.length); i++) o += lines[i].length + 1;
    return Math.min(o + pos.character, lines.join("\n").length);
  },
  positionAt(offset) {
    const t = fs.readFileSync(file, "utf8");
    const before = t.slice(0, offset);
    const nl = before.lastIndexOf("\n");
    return { offset, line: before.split("\n").length - 1, character: offset - nl - 1 };
  },
  lineAt(line) {
    const t = fs.readFileSync(file, "utf8").split("\n")[line] ?? "";
    return { text: t, range: { start: { line, character: 0 }, end: { line, character: t.length } } };
  },
  save: async () => true,
});

const pickResolver = async (document) => {
  const t = document.getText();
  const start = t.indexOf("export function pick");
  if (start < 0) return undefined;
  const end = t.indexOf("\n}", start) + 2;
  return {
    span: { start, end },
    signature: t.slice(start, t.indexOf("{", start)).trimEnd(),
    docComment: undefined,
    symbolName: "pick",
    languageId: "typescript",
    kind: "function",
    bodyOnly: false,
    headerIndent: "",
    bodyIndent: "",
  };
};

const scriptedService = (replies) => {
  const prompts = [];
  const service = new FnGenService(
    { apiBase: "http://fake:1", model: "scripted", fallbackModel: "x", maxTokens: 512, temperature: 0.2 },
    async () => {
      const body = replies[Math.min(prompts.length, replies.length - 1)];
      prompts.push(body);
      return { text: "```typescript\n" + body + "\n```", ttftMs: 1, totalMs: 2, doneReason: "stop" };
    },
  );
  return { service, prompts };
};

/** An extractor with a reference leg, so the refine gesture has a usage window
 *  and actually spends its round. */
const refExtractor = (caller) => ({
  completeMembers: async () => [],
  example: async () => undefined,
  membersOfType: async () => [],
  references: async () => [{ uri: "file://" + caller, line: 3, character: 9, endLine: 3, endCharacter: 13 }],
});

async function driveRepair({ initial, replies, manualRefine }) {
  const dir = makeWorkspace(initial);
  try {
    const file = path.join(dir, "src", "target.ts");
    const caller = path.join(dir, "src", "caller.ts");
    const t = fs.readFileSync(file, "utf8");
    const start = t.indexOf("export function pick");
    const end = t.indexOf("\n}", start) + 2;
    const lines = [];
    const { service } = scriptedService(replies);
    stubState.config = {};
    stubState.messages = [];
    stubState.wroot = dir;
    await runPostAcceptOracle({
      document: fileDocument(file),
      landedSpan: { start, end },
      source: "fngen",
      service,
      output: { lines, appendLine: (l) => lines.push(l) },
      presenter: {
        present: async (req) => {
          const cur = fs.readFileSync(file, "utf8");
          fs.writeFileSync(file, cur.slice(0, req.span.start) + req.text + cur.slice(req.span.end));
          return "accept";
        },
      },
      resolveFunction: pickResolver,
      repairTierGate: { allowed: true },
      manualRefine,
      extractor: refExtractor(caller),
    });
    const warnings = stubState.messages.filter((m) => m.kind === "warn").map((m) => m.message);
    return { channel: lines, warnings, messages: [...stubState.messages] };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** The five scenarios, each driven at most once. tsc runs twice or three times
 *  per drive, so a row that wants a scenario waits on the same promise. */
const SCENARIOS = {
  // route-exhausted: one round that does not reduce the error count.
  "give-up route-exhausted, MULTI-LINE": () =>
    driveRepair({
      initial: CLEAN_SRC.replace('const v = [{ leaf: "a" }];', "const v = [{ leaf: 1 }];"),
      replies: [brokenBody(2), brokenBody(3)],
      manualRefine: false,
    }),
  // cap-exhausted: round 1 clears one of two errors (so the loop keeps going),
  // round 2 spends the cap with the multi-line one still standing.
  "give-up cap-exhausted, MULTI-LINE": () =>
    driveRepair({
      initial:
        "type Leaf = { leaf: string };\n\nexport function pick(): Leaf[] {\n  const w = missingIdentifier;\n" +
        "  const v = [{ leaf: 1 }];\n  return v;\n}\n",
      replies: [brokenBody(2), brokenBody(3), brokenBody(4)],
      manualRefine: false,
    }),
  "give-up route-exhausted, SINGLE-LINE": () =>
    driveRepair({
      initial: CLEAN_SRC.replace('  const v = [{ leaf: "a" }];\n  return v;', "  return missingIdentifier;"),
      replies: [undefinedBody("missingIdentifierTwo"), undefinedBody("missingIdentifierThree")],
      manualRefine: false,
    }),
  "refine, MULTI-LINE": () => driveRepair({ initial: CLEAN_SRC, replies: [brokenBody(1)], manualRefine: true }),
  "refine, SINGLE-LINE": () =>
    driveRepair({ initial: CLEAN_SRC, replies: [undefinedBody("missingIdentifier")], manualRefine: true }),
};

const cache = new Map();
function scenario(name) {
  if (!cache.has(name)) cache.set(name, SCENARIOS[name]());
  return cache.get(name);
}

const showRepair = (name, r) =>
  `\n[${name}] warnings (${r.warnings.length}): ${JSON.stringify(r.warnings, null, 1)}` +
  `\n[${name}] channel (${r.channel.length}): ${JSON.stringify(r.channel, null, 1)}`;

/** The one notification each repair surface owes. Bound to: the warning the
 *  drive produced. A drive that produced none, or more than one, is a harness
 *  failure and says so rather than quietly picking one. */
function soleWarning(name, r) {
  assert.strictEqual(
    r.warnings.length,
    1,
    `harness: scenario ${JSON.stringify(name)} owed exactly one warning notification.${showRepair(name, r)}`,
  );
  return r.warnings[0];
}

const REPAIR_TIMEOUT = 180000;
const rtest = (name, fn) =>
  test(name, { timeout: REPAIR_TIMEOUT }, async () => {
    if (surfaceErr) assert.fail(`harness bundle failed: ${surfaceErr.stack || surfaceErr.message}`);
    if (!fs.existsSync(REPO_TS)) assert.fail(`harness: no project typescript at ${REPO_TS}; the TS oracle cannot run`);
    return fn();
  });

// ===========================================================================
// Harness witness. If this is red, every repair verdict below is void.
// ===========================================================================

rtest("harness witness: both repair surfaces really fire, over a real four-line tsc diagnostic", async () => {
  for (const name of ["give-up route-exhausted, MULTI-LINE", "give-up cap-exhausted, MULTI-LINE", "refine, MULTI-LINE"]) {
    const r = await scenario(name);
    const w = soleWarning(name, r);
    // Printed on purpose: a row that cannot produce the case is worthless, so
    // the captures are on the record whether the run is green or red.
    console.log(`=== blind-v58-p2 capture [${name}] ===` + showRepair(name, r));
    const everywhere = [w, ...r.channel].join(" ");
    for (const seg of D4) {
      assert.ok(
        everywhere.includes(seg),
        `harness: the drive never produced the four-line assignability error; segment ${JSON.stringify(seg)} ` +
          `appears on neither surface.${showRepair(name, r)}`,
      );
    }
  }
  for (const name of ["give-up route-exhausted, SINGLE-LINE", "refine, SINGLE-LINE"]) {
    const r = await scenario(name);
    const w = soleWarning(name, r);
    console.log(`=== blind-v58-p2 capture [${name}] ===` + showRepair(name, r));
    assert.ok(
      /Cannot find name/.test(w),
      `harness: the SINGLE-LINE scenario did not produce the one-line TS2304.${showRepair(name, r)}`,
    );
  }
});

// ===========================================================================
// C1: a multi-line diagnostic toasts ONE line, on both repair surfaces.
// EXPECT TODAY: all three RED - the raw message is interpolated whole and
// carries three newlines.
// ===========================================================================

for (const name of [
  "give-up route-exhausted, MULTI-LINE",
  "give-up cap-exhausted, MULTI-LINE",
  "refine, MULTI-LINE",
]) {
  rtest(`C1 [${name}]: the notification carries no line break of any kind`, async () => {
    const r = await scenario(name);
    const w = soleWarning(name, r);
    assert.deepStrictEqual(
      breaksIn(w),
      [],
      `C1: "Neither notification contains a line break of any kind in the widened set, whatever the ` +
        `diagnostic carries." This one embeds ${breaksIn(w).join(", ")}.${showRepair(name, r)}`,
    );
  });
}

// ===========================================================================
// C2: the pointer is conditional and truthful.
// EXPECT TODAY: the two multi-line rows RED (no pointer is appended anywhere
// on these two sites); the two single-line rows GREEN, and they are the
// regression guards - they must stay green after the fix.
// ===========================================================================

for (const name of [
  "give-up route-exhausted, MULTI-LINE",
  "give-up cap-exhausted, MULTI-LINE",
  "refine, MULTI-LINE",
]) {
  rtest(`C2 [${name}]: the cut removed something, so the channel pointer is owed`, async () => {
    const r = await scenario(name);
    const w = soleWarning(name, r);
    assert.ok(
      /channel/i.test(w),
      `C2: "The channel-pointer sentence is appended exactly when the cut removed something." Three of the ` +
        `diagnostic's four lines were cut and the notification points nowhere.${showRepair(name, r)}`,
    );
  });
}

rtest("C2 [give-up SINGLE-LINE]: no pointer, and the sentence is byte-identical to the branch point", async () => {
  const name = "give-up route-exhausted, SINGLE-LINE";
  const r = await scenario(name);
  const w = soleWarning(name, r);
  assert.ok(
    !/channel/i.test(w),
    `C2: "A single-line diagnostic gets no pointer." Nothing was cut and the notification promises the ` +
      `channel has more.${showRepair(name, r)}`,
  );
  assert.strictEqual(
    w,
    GIVE_UP_SINGLE,
    `C2 / falsifier 2: the give-up sentence is not byte-identical to the branch point. Rewording this ` +
      `sentence is out of scope for the phase.${showRepair(name, r)}`,
  );
});

rtest("C2 [refine SINGLE-LINE]: no pointer, and the sentence is byte-identical to the branch point", async () => {
  const name = "refine, SINGLE-LINE";
  const r = await scenario(name);
  const w = soleWarning(name, r);
  assert.ok(
    !/channel/i.test(w),
    `C2: "A single-line diagnostic gets no pointer."${showRepair(name, r)}`,
  );
  assert.strictEqual(
    w,
    REFINE_SINGLE,
    `C2 / falsifier 2: the refine sentence is not byte-identical to the branch point. The doubled period ` +
      `after the diagnostic is the branch point's own and rewording is out of scope.${showRepair(name, r)}`,
  );
});

// ===========================================================================
// C3: the channel holds the WHOLE diagnostic, on both surfaces.
// EXPECT TODAY: both RED. The give-up site writes no channel line for the
// message at all; the refine site's :1608 line is a 70-char digest.
// ===========================================================================

for (const name of ["give-up route-exhausted, MULTI-LINE", "refine, MULTI-LINE"]) {
  rtest(`C3 [${name}]: one channel entry carries all four lines of the diagnostic`, async () => {
    const r = await scenario(name);
    const whole = r.channel.filter((l) => D4.every((seg) => l.includes(seg)));
    assert.ok(
      whole.length > 0,
      `C3: "Where the toast points at the channel, the channel has more than the toast." No single channel ` +
        `entry carries all four lines of the diagnostic. A digest is not the whole message.${showRepair(name, r)}`,
    );
  });
}

// ===========================================================================
// C4: the rest of each sentence survives. Only the diagnostic is cut.
// EXPECT TODAY: both GREEN - nothing is cut yet, so nothing is lost yet. These
// are the rows that catch a naive cut, and they must stay green after the fix.
// ===========================================================================

rtest("C4 [give-up]: the error count and the symbol still survive the cut", async () => {
  const name = "give-up route-exhausted, MULTI-LINE";
  const r = await scenario(name);
  const w = soleWarning(name, r);
  assert.ok(/\b1 error\b/.test(w), `C4: "The give-up toast still names the error count."${showRepair(name, r)}`);
  assert.ok(/\bpick\b/.test(w), `C4: "...and the symbol."${showRepair(name, r)}`);
  assert.ok(
    w.includes(D4[0]),
    `C4: only the diagnostic's CONTINUATION lines may be cut; its first line is what the sentence promises ` +
      `with "First:".${showRepair(name, r)}`,
  );
});

rtest("C4 [refine]: the symbol, the count, and the undo clause all survive, and the undo clause stays last", async () => {
  const name = "refine, MULTI-LINE";
  const r = await scenario(name);
  const w = soleWarning(name, r);
  assert.ok(/\bpick\b/.test(w), `C4: "The refine toast still names the symbol."${showRepair(name, r)}`);
  assert.ok(/\b1 error\b/.test(w), `C4: "...the count."${showRepair(name, r)}`);
  const at = w.indexOf(UNDO_CLAUSE);
  assert.ok(
    at >= 0,
    `C4 / falsifier 3: "the undo clause is still present". The diagnostic sits mid-sentence and a naive cut ` +
      `swallows everything behind it.${showRepair(name, r)}`,
  );
  const firstLineAt = w.indexOf(D4[0]);
  assert.ok(
    firstLineAt >= 0 && at > firstLineAt,
    `C4 / falsifier 3: "and still last". The undo clause must follow the diagnostic, not precede it.` +
      `${showRepair(name, r)}`,
  );
  // Bound as the header reports: nothing may follow the undo clause except a
  // single channel-pointer sentence.
  const tail = w.slice(at + UNDO_CLAUSE.length).trim();
  assert.ok(
    tail === "" || /channel/i.test(tail),
    `C4 / falsifier 3: the undo clause is followed by ${printable(tail)}, which is neither nothing nor a ` +
      `channel pointer.${showRepair(name, r)}`,
  );
});

// ===========================================================================
// C5: firstLine cuts on the full line-break set.
// EXPECT TODAY: LF and CRLF GREEN (CRLF only because trim() eats the \r);
// bare CR, U+2028, U+2029 and U+0085 RED, and the mixed row RED.
// ===========================================================================

const ttest = (name, fn) =>
  test(name, () => {
    if (toastErr) assert.fail(`harness: toastText bundle failed: ${toastErr.stack || toastErr.message}`);
    assert.strictEqual(typeof toast.firstLine, "function", "harness: firstLine is not exported");
    return fn();
  });

for (const [label, sep] of BREAKS) {
  ttest(`C5 [${label}]: firstLine returns the first segment, trimmed, with no break left in it`, () => {
    const input = "alpha beta" + sep + "gamma delta" + sep + "epsilon";
    const got = toast.firstLine(input);
    assert.strictEqual(
      got,
      "alpha beta",
      `C5: "firstLine returns the first non-blank segment, trimmed" for ${label}. Got ${printable(got)} from ` +
        `${printable(input)}.`,
    );
    assert.deepStrictEqual(
      breaksIn(got),
      [],
      `C5: "the result contains none of those six" for ${label}. Got ${printable(got)}.`,
    );
  });
}

// Falsifier 4's mixed string, driven SIX ways: each of the six forms takes a
// turn leading, with the other five behind it. A mixed string that always leads
// with "\n" proves nothing - "\n" already cuts - so the leading form is rotated
// and every rotation must cut at position one.
ttest("C5 [mixed]: a string carrying all six forms cuts at whichever comes first, in every rotation", () => {
  for (let i = 0; i < BREAKS.length; i++) {
    const order = BREAKS.map((_, k) => BREAKS[(i + k) % BREAKS.length]);
    const input =
      "one" + order.map(([, sep], k) => sep + ["two", "three", "four", "five", "six", "seven"][k]).join("");
    const got = toast.firstLine(input);
    assert.strictEqual(
      got,
      "one",
      `C5 / falsifier 4: mixed forms led by ${order[0][0]}. Got ${printable(got)} from ${printable(input)}.`,
    );
    assert.deepStrictEqual(
      breaksIn(got),
      [],
      `C5: the result still carries a break when ${order[0][0]} leads: ${printable(got)}.`,
    );
  }
});

// Falsifier 5: leading blank segments. The first NON-BLANK segment wins, which
// is what the "\n" behaviour already does.
// EXPECT TODAY: the CR and U+2028 rows GREEN by accident (trim() strips all
// three characters), the U+0085 row RED (trim leaves NEL alone - trap 1).
for (const [label, sep] of [["bare CR (\\r)", CR], ["U+2028", LS], ["U+0085 NEL", NEL]]) {
  ttest(`C5 [leading blanks, ${label}]: the first NON-BLANK segment wins`, () => {
    const input = sep + sep + sep + "real text";
    const got = toast.firstLine(input);
    assert.strictEqual(
      got,
      "real text",
      `C5 / falsifier 5: leading blank segments before ${label}. Got ${printable(got)}.`,
    );
    assert.deepStrictEqual(breaksIn(got), [], `C5: the result still carries a break: ${printable(got)}.`);
  });
}

// Falsifier 6, plus the lone trailing CR.
// EXPECT TODAY: all GREEN. These are edge guards, not defect probes.
ttest("C5 [edges]: empty, undefined, nothing-but-breaks, and a lone trailing CR", () => {
  assert.strictEqual(toast.firstLine(""), "", 'C5 / falsifier 6: firstLine("") must be "".');
  assert.strictEqual(toast.firstLine(undefined), "", "C5 / falsifier 6: firstLine(undefined) must be \"\".");
  for (const [label, sep] of BREAKS) {
    const only = sep + sep + sep;
    assert.strictEqual(
      toast.firstLine(only),
      "",
      `C5 / falsifier 6: a string of nothing but ${label} must return "". Got ${printable(toast.firstLine(only))}.`,
    );
  }
  assert.strictEqual(
    toast.firstLine("tail" + CR),
    "tail",
    "C5: a lone trailing CR leaves the one segment, trimmed.",
  );
  assert.deepStrictEqual(breaksIn(toast.firstLine("tail" + NEL)), [], "C5: a lone trailing NEL must not survive.");
});

// ===========================================================================
// C6: the widening does not move the ordinary cut. THE REGRESSION CLAUSE.
// The reference is the branch-point rule reimplemented, not a snapshot, so a
// widened firstLine must agree with it everywhere "\n" is the only break.
// EXPECT TODAY: GREEN, and it must stay green. This is the row that matters.
// ===========================================================================

const branchPointFirstLine = (s) => (s ?? "").split("\n").find((l) => l.trim().length > 0)?.trim() ?? "";

/** Strings the product actually produces, containing only "\n" or no break at
 *  all. Nothing here may contain \r, U+2028, U+2029 or U+0085. */
const LF_ONLY_CORPUS = [
  undefined,
  "",
  "a single line",
  "   padded on both sides   ",
  "\n",
  "\n\n\n",
  "first\nsecond",
  "\n\nfirst\nsecond",
  "   \n   \n  real text  \n  more  ",
  "trailing newline\n",
  "EACCES: permission denied, mkdir '/x'",
  D4.join("\n  "),
  "Column 80: repair stopped with 2 errors still in pick.\n  elaboration",
  "error[E0308]: mismatched types\n  expected `u64`, found `&str`\n  note: in this expansion",
  "  \t \n\t leading whitespace segment wins only when non-blank \t ",
];

ttest("C6 [no new cut on the LF-only corpus]: the widening only ADDS cut points, it never moves one", () => {
  for (const s of LF_ONLY_CORPUS) {
    if (s !== undefined) {
      assert.deepStrictEqual(
        breaksIn(s).filter((n) => n !== "\\n"),
        [],
        `harness: the C6 corpus must contain only "\\n"; ${printable(s)} carries something else, so this row ` +
          `would be testing C5 instead of C6.`,
      );
    }
    assert.strictEqual(
      toast.firstLine(s),
      branchPointFirstLine(s),
      `C6: "Every message the product actually produces that contains only \\n (or no break at all) cuts ` +
        `exactly where it cut at the branch point." Input ${printable(String(s))}: branch point returned ` +
        `${printable(branchPointFirstLine(s))}, widened returned ${printable(toast.firstLine(s))}.`,
    );
  }
});

// ===========================================================================
// tierDisabledToast's conditional-pointer rule under the widened set.
// The rule is C2's, and this is the leaf that owns it. A `why` broken by a
// mid-string break now loses text, so the pointer becomes owed.
// EXPECT TODAY: the LF row GREEN; the CR, U+2028, U+2029 and NEL rows RED (the
// message survives whole into the toast, so no pointer is appended and the
// toast renders as two visual lines).
// ===========================================================================

for (const [label, sep] of [["LF (\\n)", LF], ["bare CR (\\r)", CR], ["U+2028", LS], ["U+2029", PS], ["U+0085 NEL", NEL]]) {
  ttest(`C2 [tierDisabledToast pointer under the widened set, ${label}]: a cut message gets the pointer`, () => {
    const why = "the working directory could not be created" + sep + "caused by: permission denied";
    const got = toast.tierDisabledToast(why);
    assert.deepStrictEqual(
      breaksIn(got),
      [],
      `C1/C5: a disabled-tier toast must be one line whatever the tier message carried. Got ${printable(got)}.`,
    );
    assert.ok(
      /channel/i.test(got),
      `C2: "The channel-pointer sentence is appended exactly when the cut removed something." The ${label} ` +
        `after the first clause was cut and nothing points at the channel. Got ${printable(got)}.`,
    );
  });
}

ttest("C2 [tierDisabledToast: a one-line why still gets NO pointer]", () => {
  const why = "function generation is disabled";
  const got = toast.tierDisabledToast(why);
  assert.strictEqual(got, why, "C2: nothing was cut, so nothing may be appended.");
  assert.strictEqual(toast.tierDisabledToast(why, "."), why + ".", "C2: the caller's punctuation still lands.");
});

// ===========================================================================
// C7: the v57 oracle's bare-\r assertion finally has a case that fires.
//
// The drive is test/blind-v57-p3-tier-message.test.cjs's, reproduced rather
// than edited: the Claude Code backend is selected, the CLI probe answers
// PRESENT, and the injected ClaudeCodeDeps.ensureDir throws - except the
// failure text here is broken by BARE CARRIAGE RETURNS. Every failure that file
// injects uses "\n", which is why its !includes("\r") assertion has never
// fired.
// EXPECT TODAY: RED. The tier message reaches the toast with its \r intact and
// no pointer, so it renders as three visual lines.
// ===========================================================================

const CR_FAILURE = "first line" + CR + "second line" + CR + "third line";
const CR_WROOT = path.join(__dirname, ".blind-v58-p2-workspace");
const CR_STORAGE = path.join(CR_WROOT, ".storage");

const waitFor = async (predicate, tries = 400) => {
  for (let i = 0; i < tries; i++) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, 5));
  }
  return false;
};

const crDeps = () => ({
  storagePath: CR_STORAGE,
  run: async () => ({ stdout: "2.1.224 (Claude Code)\n", exitCode: 0 }),
  ensureDir: () => {
    throw new Error(CR_FAILURE);
  },
});

async function driveTier() {
  fs.mkdirSync(path.join(CR_WROOT, "src"), { recursive: true });
  fs.writeFileSync(
    path.join(CR_WROOT, "package.json"),
    '{"name":"w","version":"0.0.0","scripts":{"test":"vitest run"},"devDependencies":{"vitest":"^1.0.0"}}\n',
  );
  const SRC =
    "// this walker keeps a shard mem cache for each of the client sets and drops every entry it can prove is stale\n" +
    "export function walk() {\n" +
    "  return 1;\n" +
    "}\n" +
    "\n";
  const fsPath = path.join(CR_WROOT, "src", "walk.ts");
  fs.writeFileSync(fsPath, SRC);

  stubState.config = { fnGenProvider: "claude-code" };
  stubState.messages = [];
  stubState.commands = {};
  stubState.executeCalls = [];
  stubState.wroot = CR_WROOT;

  const lineStarts = [0];
  for (let i = 0; i < SRC.length; i++) if (SRC[i] === "\n") lineStarts.push(i + 1);
  const offsetAt = (pos) => Math.min((lineStarts[pos.line] ?? SRC.length) + pos.character, SRC.length);
  const doc = {
    languageId: "typescript",
    version: 1,
    isDirty: false,
    isClosed: false,
    lineCount: SRC.split("\n").length,
    fileName: fsPath,
    uri: { fsPath, path: fsPath, scheme: "file", toString: () => "file://" + fsPath, with() { return this; } },
    getText: (range) => (range ? SRC.slice(offsetAt(range.start), offsetAt(range.end)) : SRC),
    offsetAt,
    positionAt(offset) {
      let line = 0;
      while (line + 1 < lineStarts.length && lineStarts[line + 1] <= offset) line++;
      return { line, character: offset - lineStarts[line] };
    },
    lineAt(arg) {
      const n = typeof arg === "number" ? arg : arg.line;
      const text = SRC.split("\n")[n] ?? "";
      const m = text.match(/\S/);
      return {
        lineNumber: n,
        text,
        range: { start: { line: n, character: 0 }, end: { line: n, character: text.length } },
        firstNonWhitespaceCharacterIndex: m ? m.index : text.length,
        isEmptyOrWhitespace: !m,
      };
    },
    save: async () => true,
  };
  stubState.textDocuments = [doc];
  stubState.symbols = [
    { name: "walk", detail: "", kind: 11, range: { start: { line: 1, character: 0 }, end: { line: 3, character: 1 } }, selectionRange: { start: { line: 1, character: 16 }, end: { line: 1, character: 20 } }, children: [] },
  ];

  const lines = [];
  const output = { lines, appendLine: (l) => lines.push(l), append() {}, show() {}, clear() {}, dispose() {} };
  const context = { subscriptions: [], globalStorageUri: { fsPath: CR_STORAGE } };
  let built;
  registerFnGen(context, output, new ContextBlockStore(() => {}), {
    buildService: async (out, log) => {
      built = await buildFnGenService(out, log, undefined, crDeps());
      return built;
    },
    claudeCode: crDeps(),
  });

  const ready = await waitFor(
    () => typeof stubState.commands["column80.generateFunction"] === "function" && built !== undefined,
  );
  assert.ok(ready, `harness: the gesture never registered; saw ${JSON.stringify(Object.keys(stubState.commands))}`);

  const pos = { line: 2, character: 4 };
  const sel = { start: pos, end: pos, active: pos, anchor: pos, isEmpty: true };
  stubState.activeTextEditor = {
    document: doc,
    viewColumn: 1,
    options: { tabSize: 4, insertSpaces: true },
    selection: sel,
    insertSnippet: async () => true,
    revealRange: () => {},
    edit: async () => true,
  };

  stubState.messages = [];
  const before = lines.length;
  await stubState.commands["column80.generateFunction"]();
  await new Promise((r) => setTimeout(r, 60));
  const messages = stubState.messages.map((m) => m.message).filter((m) => typeof m === "string");

  for (const d of context.subscriptions) {
    try { d.dispose?.(); } catch { /* teardown only */ }
  }
  try { built.service.dispose(); } catch { /* teardown only */ }
  fs.rmSync(CR_WROOT, { recursive: true, force: true });

  return { messages, channel: lines.slice(before), tier: built.tier };
}

test("C7 [tier failure carrying a bare CR]: one line, with the pointer, and the channel keeps the rest", { timeout: 120000 }, async () => {
  if (surfaceErr) assert.fail(`harness bundle failed: ${surfaceErr.stack || surfaceErr.message}`);
  const r = await driveTier();
  console.log(
    "=== blind-v58-p2 capture [C7 bare CR tier failure] ===" +
      `\n[C7] tier.fnGenEnabled=${r.tier.fnGenEnabled}` +
      `\n[C7] notifications: ${JSON.stringify(r.messages, null, 1)}` +
      `\n[C7] channel: ${JSON.stringify(r.channel, null, 1)}`,
  );
  assert.strictEqual(r.tier.fnGenEnabled, false, "harness: the injected ensureDir throw must yield a DISABLED tier");
  const toasts = r.messages.filter((m) => /disabled/i.test(m));
  assert.ok(toasts.length > 0, `harness: the gesture produced no disabled notification; got ${JSON.stringify(r.messages)}`);
  for (const t of toasts) {
    assert.deepStrictEqual(
      breaksIn(t),
      [],
      `C7: "Before this phase that case renders two lines; after it, one." The bare carriage returns survived ` +
        `into the notification: ${printable(t)}`,
    );
    assert.ok(
      /channel/i.test(t),
      `C7: "...one, with the pointer." The cut removed two of the three lines and the notification points ` +
        `nowhere: ${printable(t)}`,
    );
  }
  // The pointer must be truthful (C2): what the toast dropped, the channel keeps.
  const dropped = CR_FAILURE.split(CR).filter((p) => !toasts.some((t) => t.includes(p)));
  for (const d of dropped) {
    assert.ok(
      r.channel.some((l) => l.includes(d)),
      `C2/C7: the notification points at the channel but the channel does not carry ${JSON.stringify(d)}. ` +
        `Channel: ${JSON.stringify(r.channel)}`,
    );
  }
});
