// Blind oracle, session-v55 phase 7: "a generated body does not change the
// file's line endings" (queue Q15).
//
// Written from session-v55/contract-phase7.md ALONE. Nothing here was written
// from a fix; the only things read out of `src/` were the SEAMS this file has to
// drive, and they are named below so a reviewer can check that claim cheaply.
//
// Run: SKIP_LIVE=1 node --test test/blind-v55-p7-eol.test.cjs
//
// =============================================================================
// THE OBSERVABLE
// =============================================================================
// Every row asserts on the TEXT THAT REACHES `vscode.workspace.applyEdit`, read
// back off the stub's own `WorkspaceEdit`. No helper name, no internal function,
// no module-level export is asserted anywhere in this file: the contract says
// "one helper at the vscode layer", but a helper that exists and is not called
// at the write is the defect class this project has already shipped once (a
// hooks object registered nowhere), so the write is the only thing measured.
//
// Deliberately NOT captured through a `deps.applyEdit` seam. `tightenDocComment`
// offers one (`TightenDeps.applyEdit`), and taking it would bypass the module's
// own `defaultApplyEdit` — so a fix landed INSIDE that function would read as
// still-broken here forever. Driving the default and catching the edit at the
// host is the only capture point that survives the fix landing on either side of
// that boundary.
//
// =============================================================================
// THE THREE SEAMS DRIVEN
// =============================================================================
//  1. `ProposalPresenter.present({document, span, versionAtResolve, title, text,
//     service})` — the generate/repair splice (`fnGen.ts:1048`). The stub answers
//     `vscode.diff` and then fires `column80.proposalAccept` on the preview URI,
//     which is exactly the title-bar gesture, so the real accept path runs.
//  2. `tightenDocComment(document, position, log, wiring, deps)` — the tighten
//     write (`tightenDocComment.ts:1346`), driven with the review injected and
//     the WRITE left real.
//  3. `FnGenService.generate({signature, docComment, languageId})` with an
//     injected generate fn — contract item 7, the doc-comment duplication. See
//     the note on item 7 below for why the write sites cannot answer it.
//
// The third WRITE path (contract item 6) is NOT covered here. What was found
// about it is stated at the bottom of this file.
//
// =============================================================================
// WHAT IS REAL ABOUT THESE FIXTURES
// =============================================================================
// Three phases this session were derailed by fixtures modelling a shape the
// product never emits, so each fixture's provenance:
//
//  * The bodies handed to `present()` are whole-function replies with the
//    header, which is what the generate path splices into a header-inclusive
//    span. The CRLF ones are what a model that mirrors a CRLF prompt returns.
//  * The mixed reply (item 3) is the shape a model produces when it echoes a
//    CRLF prompt fragment and then continues in its own LF: the echoed line
//    keeps CRLF, the generated lines do not.
//  * The doc comments in the item 7 rows are BOTH shapes the resolver really
//    produces, and they differ by language. `resolveFunctionAtCursor` builds the
//    Rust doc channel from `document.getText(range)` — a raw slice, so in a CRLF
//    buffer it CARRIES `\r\n` — while the C#/TS arms build it from
//    `document.lineAt(n).text` joined with `"\n"`, which is LF even in a CRLF
//    buffer. So "CRLF doc comment" and "LF doc comment in a CRLF file" are both
//    production shapes, and rows C2 and C3 are one of each. They are BODY-ONLY
//    requests because that is the production shape of a Python docstring target
//    and because a whole-function request masks the dedup entirely — see the
//    note above those rows.
//  * The tighten fixtures are the phase-5 command's own shapes (a dictated
//    over-long `//` line; a one-line Python docstring) re-cut with CRLF.
//
// The one fixture that is NOT everyday: B3, a file whose LAST line is a comment
// with no trailing newline. It is legal, git-visible, and it is the shape that
// makes a region-local EOL derivation disagree with the document.
//
// =============================================================================
// CONTRACT HOLES (none of these is asserted; each is reported)
// =============================================================================
//  H1. A LONE `\r` (classic-Mac line terminator) in a reply. Item 3 says "a
//      mixed reply is normalised whole" but the mix it names is LF-vs-CRLF. A
//      bare `\r` may be a terminator or may be a deliberate carriage return in
//      generated text; the contract does not decide, so no row asserts it.
//  H2. THE PREVIEW. `present()` builds the diff the human accepts from the SAME
//      `text` it later splices. If the fix lands only at `edit.replace`, the
//      human reviews an LF body and a CRLF body lands. Byte-identical in
//      meaning, not in bytes. The contract never mentions the preview, so this
//      file does not assert preview/apply agreement — but the fix should put
//      the normalisation ahead of the preview build, not between it and the
//      write, and no row here will catch it if it does not.
//  H3. ITEM 7 IS NOT REACHABLE FROM THE SHAPE THE CONTRACT PRESCRIBES. The
//      duplication happens in `FnGenService.generate`, in the core layer, BEFORE
//      any write: the dedup guard tests `text.startsWith(docComment)` and then
//      that the next character is `"\n"` or end-of-text. A CRLF reply fails the
//      second test even when both sides are CRLF, so the doc comment survives
//      into the span and lands twice. A "helper at the vscode layer applied at
//      every write" normalises the endings of a body that ALREADY contains the
//      duplicate. Item 7 needs the reply normalised (or the comparison made
//      EOL-blind) upstream of that guard. Rows C1-C3 are stated against the
//      service's output for that reason, and they are the rows most likely to be
//      argued as out of phase 7's scope. Measured: with the reply and the
//      docstring BOTH in CRLF, the copy still lands — so this is not only an
//      endings MISMATCH, it is the guard's anchor.
//  H4. Item 4 says an ending-less document "takes the platform default VS Code
//      reports for it". `document.eol` is the only channel that reports it, so
//      rows A5/A6 read `document.eol` and nothing else. If the intended answer
//      were `files.eol` from configuration, no row here would see the
//      difference.
//
// =============================================================================
// ROWS
// =============================================================================
//   G1  the bundle builds and both seams are exported          (harness guard)
//   G2  the presenter rig reaches the real write               (harness guard)
//   G3  the tighten rig reaches the real write                 (harness guard)
//   A1  LF reply into a CRLF document                          (items 1, 2)
//   A2  CRLF reply into an LF document                         (items 1, 2)
//   A3  mixed reply into a CRLF document                       (item 3)
//   A4  mixed reply into an LF document                        (item 3)
//   A5  CRLF document with no line ending anywhere in it       (item 4)
//   A6  LF document with no line ending anywhere in it         (items 4, 8)
//   A7  `\r\n` INSIDE a string literal survives                (item 5)
//   A8  ... and the real terminators around it still move      (items 5, 1)
//   A9  a reply that already matches is byte-identical         (item 8)
//   B1  tighten: a `//` comment rewrapped in a CRLF file       (items 1, 6)
//   B2  tighten: a one-line docstring in a CRLF file           (items 1, 6)
//   B3  tighten: last line, no trailing newline, CRLF file     (items 1, 6)
//   B4  tighten: an LF file is left LF                         (items 6, 8)
//   C1  a CRLF reply does not duplicate an LF docstring        (item 7)
//   C2  ... nor a CRLF one, where both sides agree             (item 7)
//   C3  ... nor a multi-line LF one                            (item 7)
//
// At the time of writing: 19 rows, 10 red, 9 green. The nine are the three
// harness guards, the four no-op/safety rows that must STAY green (A6, A7, A9,
// B4), and B1 + B2 — the tighten path's own region-local derivation, which gets
// three of its four cases right on its own and misses B3.

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");

// ---------------------------------------------------------------------------
// The vscode stub. Structural Position/Range, a WorkspaceEdit that records what
// it was handed, and an `executeCommand` that answers `vscode.diff` by firing
// the real accept command on the preview URI a tick later — which is the
// title-bar button, not a back door: `present()` registers that command itself.
// ---------------------------------------------------------------------------

const STUB = path.join(__dirname, ".blind-v55-p7-stub.cjs");
fs.writeFileSync(
  STUB,
  `
const state = { config: {}, messages: [], commands: {}, appliedEdits: [], executeCalls: [] };
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
  parse: (s) => ({ raw: s, fsPath: String(s), path: String(s), scheme: "file", toString: () => String(s), with() { return this; } }),
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
    textDocuments: [],
    workspaceFolders: [{ uri: Uri.file("/repo"), name: "repo", index: 0 }],
    getWorkspaceFolder: () => ({ uri: Uri.file("/repo"), name: "repo", index: 0 }),
    openTextDocument: async () => undefined,
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
    visibleTextEditors: [],
    activeTextEditor: undefined,
    showTextDocument: async () => undefined,
    showInformationMessage: async (message, ...actions) => { state.messages.push({ kind: "info", message, actions }); return undefined; },
    showWarningMessage: async (message, ...actions) => { state.messages.push({ kind: "warn", message, actions }); return undefined; },
    showErrorMessage: async (message, ...actions) => { state.messages.push({ kind: "error", message, actions }); return undefined; },
    showQuickPick: async () => undefined,
    withProgress: async (opts, task) => task({ report: () => {} }, { onCancellationRequested: () => ({ dispose() {} }) }),
    setStatusBarMessage: () => ({ dispose() {} }),
    createStatusBarItem: () => ({ text: "", tooltip: "", command: undefined, show() {}, hide() {}, dispose() {} }),
    activeColorTheme: { kind: 1 },
    tabGroups: { all: [], activeTabGroup: undefined, onDidChangeTabs: () => ({ dispose() {} }), close: async () => {} },
  },
  commands: {
    registerCommand: (id, fn) => { state.commands[id] = fn; return { dispose() {} }; },
    executeCommand: async (id, ...args) => {
      state.executeCalls.push({ id, args });
      if (id === "vscode.diff") {
        // The human presses the diff tab's Accept button. Scheduled, because
        // present() only registers its decision resolver AFTER this call
        // resolves; a synchronous accept would land before anyone is listening
        // and the row would hang instead of failing.
        const previewUri = args[1];
        setTimeout(() => {
          const accept = state.commands["column80.proposalAccept"];
          if (typeof accept !== "function") throw new Error("harness fault: no accept command was registered");
          accept(previewUri);
        }, 0);
      }
      return undefined;
    },
  },
};
`,
);

const ENTRY = path.join(__dirname, ".blind-v55-p7.entry.ts");
const OUTFILE = path.join(__dirname, ".blind-v55-p7.bundle.cjs");
let B = {};
let bundleErr;
try {
  fs.writeFileSync(
    ENTRY,
    `export { ProposalPresenter } from "../src/vscode/fnGen";
export { tightenDocComment } from "../src/vscode/tightenDocComment";
export { FnGenService } from "../src/core/fnGenService";
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
  B = require(OUTFILE);
} catch (e) {
  bundleErr = e;
}

test.after(() => [STUB, ENTRY, OUTFILE].forEach((f) => fs.rmSync(f, { force: true })));

const btest = (name, fn) =>
  test(name, (ctx) => {
    if (bundleErr) return ctx.skip("bundle failed to build; see row G1");
    return fn(ctx);
  });

// ---------------------------------------------------------------------------
// A document the write paths can drive. Line starts are scanned off the RAW
// text, so a CRLF buffer's offsets are the real ones; `lineAt().text` drops the
// `\r` exactly as VS Code's does, which is what makes an LF doc comment
// possible inside a CRLF file.
// ---------------------------------------------------------------------------

function makeDoc(text, opts = {}) {
  const eol = opts.eol ?? (text.includes("\r\n") ? 2 : 1); // EndOfLine.CRLF / .LF
  const lineStarts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") lineStarts.push(i + 1);
  const lineTextAt = (n) => {
    const start = lineStarts[n];
    if (start === undefined) return "";
    const next = lineStarts[n + 1];
    const raw = next === undefined ? text.slice(start) : text.slice(start, next - 1);
    return raw.endsWith("\r") ? raw.slice(0, -1) : raw;
  };
  const offsetAt = (pos) => {
    const start = lineStarts[pos.line] ?? text.length;
    return Math.min(start + pos.character, text.length);
  };
  // A plain {line, character}: the product only ever hands these to the stub's
  // Range constructor, which reads the two fields and stores them. Nothing calls
  // a Position method on them, so class identity would be decoration.
  const positionAt = (offset) => {
    const off = Math.max(0, Math.min(offset, text.length));
    let line = 0;
    while (line + 1 < lineStarts.length && lineStarts[line + 1] <= off) line++;
    return { line, character: off - lineStarts[line] };
  };
  const fsPath = opts.fsPath ?? "/repo/src/calc.ts";
  return {
    languageId: opts.languageId ?? "typescript",
    version: 1,
    isDirty: false,
    isClosed: false,
    eol,
    lineCount: lineStarts.length,
    fileName: fsPath,
    uri: { fsPath, path: fsPath, scheme: "file", toString: () => "file://" + fsPath, with() { return this; } },
    getText(range) {
      return range === undefined ? text : text.slice(offsetAt(range.start), offsetAt(range.end));
    },
    offsetAt,
    positionAt,
    lineAt(arg) {
      const n = typeof arg === "number" ? arg : arg.line;
      const t = lineTextAt(n);
      const m = t.match(/\S/);
      return {
        lineNumber: n,
        text: t,
        range: { start: { line: n, character: 0 }, end: { line: n, character: t.length } },
        firstNonWhitespaceCharacterIndex: m ? m.index : t.length,
        isEmptyOrWhitespace: !m,
      };
    },
    save: async () => true,
  };
}

// ---- assertions on line endings -------------------------------------------

/** Every real line terminator in a string, in order. An escape SEQUENCE
 *  (backslash r backslash n) is two ordinary characters and never matches. */
const breaksOf = (s) => s.match(/\r\n|\n|\r/g) ?? [];

function assertAllCrlf(applied, why) {
  const breaks = breaksOf(applied);
  assert.ok(breaks.length > 0, `harness: the fixture must contain line breaks — ${why}`);
  assert.deepStrictEqual(
    [...new Set(breaks)],
    ["\r\n"],
    `${why}\nEvery terminator must be CRLF. Got: ${JSON.stringify(applied)}`,
  );
  assert.ok(!applied.includes("\r\r"), `${why}\nA doubled \\r means a naive \\n -> \\r\\n replace ran over text that was already CRLF: ${JSON.stringify(applied)}`);
}

function assertAllLf(applied, why) {
  const breaks = breaksOf(applied);
  assert.ok(breaks.length > 0, `harness: the fixture must contain line breaks — ${why}`);
  assert.deepStrictEqual(
    [...new Set(breaks)],
    ["\n"],
    `${why}\nEvery terminator must be LF. Got: ${JSON.stringify(applied)}`,
  );
  assert.ok(!applied.includes("\r"), `${why}\nNo carriage return may reach an LF document: ${JSON.stringify(applied)}`);
}

// ===========================================================================
// Seam 1: ProposalPresenter.present — the generate/repair splice
// ===========================================================================

/** One proposal, accepted, with the text that reached applyEdit handed back. */
async function present(docText, replyText, opts = {}) {
  const state = B.__state;
  state.appliedEdits.length = 0;
  state.messages.length = 0;
  const document = makeDoc(docText, opts);
  const span = opts.span ?? { start: 0, end: docText.length };
  const presenter = new B.ProposalPresenter({ subscriptions: [] });
  const outcomes = [];
  const outcome = await presenter.present({
    document,
    span,
    versionAtResolve: document.version,
    title: "add: generated body (preview)",
    text: replyText,
    service: { logOutcome: (o, extra) => outcomes.push({ o, extra }) },
  });
  const edits = state.appliedEdits.flatMap((e) => e.entries().flatMap(([, es]) => es));
  return { outcome, edits, applied: edits.length === 1 ? edits[0].newText : undefined, outcomes, messages: state.messages };
}

// Whole-function replies with the header, which is what the generate path
// splices into a header-inclusive span.
const LF_DOC =
  "/** Adds two numbers. */\n" +
  "export function add(a: number, b: number): number {\n" +
  "  return 0;\n" +
  "}\n";
const CRLF_DOC = LF_DOC.replace(/\n/g, "\r\n");
const spanOf = (text) => ({ start: text.indexOf("export function"), end: text.lastIndexOf("}") + 1 });

const LF_REPLY =
  "export function add(a: number, b: number): number {\n" +
  "  const sum = a + b;\n" +
  "  return sum;\n" +
  "}";
const CRLF_REPLY = LF_REPLY.replace(/\n/g, "\r\n");
// A model that echoed a CRLF prompt fragment and then continued in its own LF.
const MIXED_REPLY =
  "export function add(a: number, b: number): number {\r\n" +
  "  const sum = a + b;\n" +
  "  return sum;\n" +
  "}";

btest("G1 [harness]: the bundle builds and both write seams are exported", () => {
  if (bundleErr) assert.fail(`bundle failed to build: ${bundleErr.message}`);
  for (const n of ["ProposalPresenter", "tightenDocComment", "FnGenService"]) {
    assert.ok(B[n] !== undefined, `${n} must be exported for this file to drive it`);
  }
});

btest("G2 [harness]: the rig reaches the real splice — one accepted proposal, one applyEdit, the reply in it", async () => {
  const r = await present(LF_DOC, LF_REPLY, { span: spanOf(LF_DOC) });
  assert.strictEqual(r.outcome, "accept", `the accept gesture must settle the proposal: ${JSON.stringify(r.messages)}`);
  assert.strictEqual(r.edits.length, 1, "exactly one WorkspaceEdit text edit reaches the host");
  assert.strictEqual(r.applied, LF_REPLY, "an LF reply into an LF document is the reply, verbatim");
  assert.deepStrictEqual(r.outcomes.map((x) => x.o), ["accept"], "the evidence channel records the accept");
});

btest("A1 [items 1, 2]: an LF reply into a CRLF document is spliced as CRLF", async () => {
  const r = await present(CRLF_DOC, LF_REPLY, { span: spanOf(CRLF_DOC) });
  assert.strictEqual(r.outcome, "accept");
  assertAllCrlf(r.applied, "The document is CRLF (document.eol === EndOfLine.CRLF) and the model answered LF.");
});

btest("A2 [items 1, 2]: a CRLF reply into an LF document is spliced as LF", async () => {
  const r = await present(LF_DOC, CRLF_REPLY, { span: spanOf(LF_DOC) });
  assert.strictEqual(r.outcome, "accept");
  assertAllLf(r.applied, "The document is LF (document.eol === EndOfLine.LF) and the model answered CRLF.");
});

btest("A3 [item 3]: a MIXED reply into a CRLF document is normalised whole", async () => {
  const r = await present(CRLF_DOC, MIXED_REPLY, { span: spanOf(CRLF_DOC) });
  assert.strictEqual(r.outcome, "accept");
  assertAllCrlf(r.applied, "One reply carrying both endings must land with exactly one, the document's.");
  assert.strictEqual(breaksOf(r.applied).length, breaksOf(MIXED_REPLY).length, "normalising must not add or drop a line");
});

btest("A4 [item 3]: a MIXED reply into an LF document is normalised whole", async () => {
  const r = await present(LF_DOC, MIXED_REPLY, { span: spanOf(LF_DOC) });
  assert.strictEqual(r.outcome, "accept");
  assertAllLf(r.applied, "One reply carrying both endings must land with exactly one, the document's.");
  assert.strictEqual(breaksOf(r.applied).length, breaksOf(MIXED_REPLY).length, "normalising must not add or drop a line");
});

// Item 4. A document with NO line ending anywhere: `document.eol` is the only
// thing that reports what this file's ending is, and it is the answer.
const ONE_LINE_DOC = "export function add(a: number, b: number): number { return 0; }";

btest("A5 [item 4]: a CRLF document with no line ending yet takes CRLF, and does not crash", async () => {
  const r = await present(ONE_LINE_DOC, LF_REPLY, { eol: 2, span: { start: 0, end: ONE_LINE_DOC.length } });
  assert.strictEqual(r.outcome, "accept", "an ending-less document must not be special-cased into a refusal");
  assertAllCrlf(r.applied, "The buffer has no terminator to copy, so document.eol (CRLF) decides.");
});

btest("A6 [items 4, 8]: an LF document with no line ending yet takes LF, and pays nothing", async () => {
  const r = await present(ONE_LINE_DOC, LF_REPLY, { eol: 1, span: { start: 0, end: ONE_LINE_DOC.length } });
  assert.strictEqual(r.outcome, "accept");
  assert.strictEqual(r.applied, LF_REPLY, "already the document's ending: byte-identical");
});

// Item 5, split in two so the safety half cannot be lost when the other half
// goes green. A1-A4 pass under a text-level `replace(/\r?\n/g, eol)`; A7 is what
// fails if anyone reaches for the source's ESCAPE sequences instead.
const ESCAPE_REPLY =
  "export function add(a: number, b: number): number {\n" +
  '  const sep = "a\\r\\nb";\n' +
  "  return (a + b) + sep.length;\n" +
  "}";
// Six source characters: quote a backslash r backslash n b quote.
const ESCAPE_LITERAL = '"a\\r\\nb"';

btest("A7 [item 5]: a `\\r\\n` written as SOURCE TEXT inside a string literal is not touched", async () => {
  assert.ok(
    ESCAPE_REPLY.includes(ESCAPE_LITERAL) && !ESCAPE_REPLY.includes("a\r\nb"),
    "harness: the fixture must carry the ESCAPE SEQUENCE, not a real terminator",
  );
  for (const [docText, label] of [[CRLF_DOC, "CRLF"], [LF_DOC, "LF"]]) {
    const r = await present(docText, ESCAPE_REPLY, { span: spanOf(docText) });
    assert.strictEqual(r.outcome, "accept");
    assert.ok(
      r.applied.includes(ESCAPE_LITERAL),
      `${label} document: the two characters backslash-r backslash-n are the human's source code, not a line ending. ` +
        `Rewriting them changes what the program DOES. Got: ${JSON.stringify(r.applied)}`,
    );
    assert.strictEqual(
      (r.applied.match(/\\r\\n/g) ?? []).length,
      1,
      `${label} document: exactly the one escape sequence the reply had, neither duplicated nor consumed`,
    );
  }
});

btest("A8 [items 5, 1]: the REAL terminators around that literal still move to the document's", async () => {
  const r = await present(CRLF_DOC, ESCAPE_REPLY, { span: spanOf(CRLF_DOC) });
  assert.strictEqual(r.outcome, "accept");
  assertAllCrlf(r.applied, "The escape sequence is exempt; the three real line breaks are not.");
  assert.strictEqual(breaksOf(r.applied).length, 3, "three real line breaks in, three out");
});

btest("A9 [item 8]: a reply that already matches the document is byte-identical after normalisation", async () => {
  const crlf = await present(CRLF_DOC, CRLF_REPLY, { span: spanOf(CRLF_DOC) });
  assert.strictEqual(crlf.applied, CRLF_REPLY, "CRLF into CRLF: the common case changes nothing");
  const lf = await present(LF_DOC, LF_REPLY, { span: spanOf(LF_DOC) });
  assert.strictEqual(lf.applied, LF_REPLY, "LF into LF: the common case changes nothing");
});

// ===========================================================================
// Seam 2: tightenDocComment — the second write path (item 6)
// ===========================================================================

// The phase-5 command's own dictated sentence: 106 columns, so the render
// rewraps it whatever else happens, and the write is reached with no model row
// accepted at all.
const SENTENCE =
  "this walker keeps a shard mem cache for each of the client sets and drops every entry it can prove is stale";

async function tighten(text, opts = {}) {
  const state = B.__state;
  state.appliedEdits.length = 0;
  const languageId = opts.languageId ?? "typescript";
  const document = makeDoc(text, { languageId, fsPath: opts.fsPath ?? "/repo/src/walk.ts" });
  const logs = [];
  const warnings = [];
  const wiring = {
    presenter: { confirmDiff: async () => "accept" },
    resolveFunction: async () => ({ languageId, symbolName: "walk" }),
    resolvePrefill: async () => undefined,
    prefillLangFor: () => ({ localTypeDefs: () => new Map(), typeReference: () => undefined }),
    extractorFor: () => undefined,
    // No proposal survives, so no row is offered and the RENDER is the whole
    // edit. That is deliberate: the rewrap is the part of this command that
    // writes line endings, and a row would only add noise to an EOL assertion.
    transport: () => async () => ({ text: "", ttftMs: 1, totalMs: 2 }),
    modelTag: () => "test-model",
  };
  const deps = {
    querySymbols: async () => [],
    fileExists: () => false,
    readFile: () => undefined,
    workspaceRoot: () => "/repo",
    config: () => ({ apiBase: "http://127.0.0.1:1", model: "m", fallbackModel: "f", maxTokens: 2048, temperature: 0, numCtx: 16384 }),
    windowed: () => true,
    // The REVIEW is injected (it is a human, not a write); the WRITE is left
    // real so the edit goes through the module's own defaultApplyEdit.
    review: async (review) => review.rows.map((r, i) => (r.checked ? i : -1)).filter((i) => i >= 0),
    warn: (m) => warnings.push(m),
  };
  const cursor = document.positionAt(opts.cursor ?? text.indexOf("shard mem cache") + 4);
  const outcome = await B.tightenDocComment(document, cursor, (l) => logs.push(l), wiring, deps);
  const edits = state.appliedEdits.flatMap((e) => e.entries().flatMap(([, es]) => es));
  return { outcome, logs, warnings, edits, applied: edits.length === 1 ? edits[0].newText : undefined };
}

btest("G3 [harness]: the tighten rig reaches the real write — one applyEdit through defaultApplyEdit", async () => {
  const r = await tighten(`// ${SENTENCE}\nexport function walk() {}\n`);
  assert.strictEqual(r.outcome.status, "applied", `the fixture must rewrap and write: ${JSON.stringify(r.outcome)} ${r.warnings.join(" | ")}`);
  assert.strictEqual(r.edits.length, 1, "the tighten write reaches vscode.workspace.applyEdit, not only the deps seam");
  assert.ok(breaksOf(r.applied).length > 0, "the rewrap produces more than one line");
});

btest("B1 [items 1, 6]: tighten rewraps a `//` comment in a CRLF file into CRLF", async () => {
  const r = await tighten(`// ${SENTENCE}\r\nexport function walk() {}\r\n`);
  assert.strictEqual(r.outcome.status, "applied", `${JSON.stringify(r.outcome)} ${r.warnings.join(" | ")}`);
  assertAllCrlf(r.applied, "The second write path is a write: the document's endings govern it too.");
});

btest("B2 [items 1, 6]: tighten expands a ONE-LINE docstring in a CRLF Python file into CRLF lines", async () => {
  // The one-line docstring is the shape that makes a region-local derivation
  // wrong: there is no terminator INSIDE the region to copy, and the render
  // always emits the delimiters on their own lines.
  const r = await tighten(`def walk():\r\n    """${SENTENCE}"""\r\n`, { languageId: "python", fsPath: "/repo/src/walk.py" });
  assert.strictEqual(r.outcome.status, "applied", `${JSON.stringify(r.outcome)} ${r.warnings.join(" | ")}`);
  assertAllCrlf(r.applied, "A one-line docstring becomes three or more lines; every one of those breaks is new text this code chose.");
});

btest("B3 [items 1, 6]: tighten rewraps the LAST line of a CRLF file that has no trailing newline", async () => {
  const r = await tighten(`export function walk() {}\r\n// ${SENTENCE}`);
  assert.strictEqual(r.outcome.status, "applied", `${JSON.stringify(r.outcome)} ${r.warnings.join(" | ")}`);
  assertAllCrlf(r.applied, "The region carries no terminator of its own, and the FILE is CRLF.");
});

btest("B4 [items 6, 8]: tighten leaves an LF file LF", async () => {
  const r = await tighten(`def walk():\n    """${SENTENCE}"""\n`, { languageId: "python", fsPath: "/repo/src/walk.py" });
  assert.strictEqual(r.outcome.status, "applied", `${JSON.stringify(r.outcome)} ${r.warnings.join(" | ")}`);
  assertAllLf(r.applied, "Nothing about this change may push CRLF into an LF file.");
});

// ===========================================================================
// Item 7: the doc-comment duplication
// ===========================================================================
// Driven at `FnGenService.generate`, because that is where the duplicate is
// made: the doc comment lives OUTSIDE the span, and the service strips a
// re-typed copy off the front of the reply before anything is spliced. See hole
// H3 for why no write-site fix can reach this.
//
// A BODY-ONLY TARGET, and that is not a convenience. On a whole-function request
// the service ALSO trims the reply to the requested function, and that trim
// removes leading comment lines on its way past — so a whole-function fixture
// goes green whatever the dedup does, and would be a row that cannot fail. The
// body-only request is exempt from the trim (a body has no declaration head to
// anchor on), which leaves the dedup as the only thing between a re-typed
// docstring and the buffer. It is also the queue's own shape: a Python
// docstring target is body-only in production, always.
//
// The LF control inside each row is what keeps these honest — it proves the
// dedup is alive and doing the work, so a CRLF failure beside it is the
// endings and nothing else.

const FN_CONFIG = { apiBase: "http://127.0.0.1:1", model: "fake", fallbackModel: "fake-small", maxTokens: 128, temperature: 0 };
const PY_SIG = "def add(a: int, b: int) -> int";

/** One body-only generation with an injected model reply; the spliceable text
 *  comes back, or the refusal that stopped it. */
async function generatedBody(docComment, raw) {
  const svc = new B.FnGenService(FN_CONFIG, async () => ({ text: raw, ttftMs: 1, totalMs: 2 }));
  try {
    const out = await svc.generate({ signature: PY_SIG, docComment, languageId: "python", bodyOnly: true });
    return { text: out === undefined ? "" : out.text };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  } finally {
    svc.dispose();
  }
}

/** How many times the doc comment appears in the text that would be spliced,
 *  compared with the line endings taken out of the way — the comparison the
 *  product's own guard does NOT make, which is why the copy gets through. */
function copies(text, docComment) {
  const flat = (s) => s.replace(/\r\n/g, "\n");
  const needle = flat(docComment);
  const hay = flat(text);
  let n = 0;
  for (let i = hay.indexOf(needle); i !== -1; i = hay.indexOf(needle, i + 1)) n++;
  return n;
}

/** The reply a model gives when it re-types the docstring above the body. */
const bodyReply = (eol, doc) => ["```python", doc, "return a + b", "```"].join(eol);

async function assertNoSecondCopy(doc, raw, why) {
  const r = await generatedBody(doc, raw);
  assert.ok(r.error === undefined, `${why}\nThe reply was refused outright: ${r.error}`);
  assert.strictEqual(
    copies(r.text, doc),
    0,
    `${why}\nThe docstring is preserved OUTSIDE the span, so a copy inside it is the SECOND copy in the file. Got: ${JSON.stringify(r.text)}`,
  );
}

btest("C1 [item 7]: a CRLF reply does not re-type an LF docstring into the body span", async () => {
  // Both halves are production shapes. The C#/TS arms of the resolver build the
  // doc channel from `lineAt(n).text` joined with "\n", so an LF doc comment out
  // of a CRLF buffer is what those languages hand the service.
  const doc = '"""Adds two numbers."""';
  await assertNoSecondCopy(doc, bodyReply("\n", doc), "CONTROL: LF reply, LF docstring. If this fails the dedup is broken outright and the CRLF rows below prove nothing.");
  await assertNoSecondCopy(doc, bodyReply("\r\n", doc), "A CRLF reply re-typing an LF docstring.");
});

btest("C2 [item 7]: a CRLF reply does not re-type a CRLF docstring either — agreement is not enough", async () => {
  // The Rust arm slices its doc channel straight out of `document.getText()`, so
  // in a CRLF buffer the doc comment CARRIES \r\n. Here BOTH sides are CRLF and
  // the copy still lands, because the strip is anchored on the character AFTER
  // the match and `\r` is not a newline.
  const lf = '"""Adds two numbers.\n\nWraps on overflow."""';
  const crlf = lf.replace(/\n/g, "\r\n");
  await assertNoSecondCopy(lf, bodyReply("\n", lf), "CONTROL: LF reply, LF multi-line docstring.");
  await assertNoSecondCopy(crlf, bodyReply("\r\n", crlf), "A CRLF reply re-typing a CRLF docstring: the two sides AGREE and the copy still lands.");
});

btest("C3 [item 7]: nor a multi-line LF docstring when the reply is CRLF", async () => {
  const doc = '"""Adds two numbers.\n\nWraps on overflow."""';
  await assertNoSecondCopy(doc, bodyReply("\n", doc), "CONTROL: LF reply, LF multi-line docstring.");
  await assertNoSecondCopy(doc, bodyReply("\r\n", doc.replace(/\n/g, "\r\n")), "The prefix comparison fails on the endings alone: the model wrote the same words the human did.");
});

// =============================================================================
// THE THIRD WRITE PATH (contract item 6) — what was found, and why no row
// =============================================================================
// It is `createTestFileWithSnippet` in fnGen.ts (~6474), reached from the
// `column80.generateTests` gesture when the target test file does not exist. It
// is NOT a WorkspaceEdit: it creates the file EMPTY through
// `workspace.fs.writeFile`, opens it, and then puts the generated text in as a
// `vscode.SnippetString` through `editor.insertSnippet`. So "the text handed to
// applyEdit" is not its observable at all — the observable is the SnippetString.
//
// CAN it carry the defect? Yes, in principle: the snippet's newlines are the
// model's, and the file they land in is brand new, so item 4 governs it (an
// empty document reports whatever ending VS Code picks for it, which on a CRLF
// host is CRLF). A generated test file written entirely in LF on a CRLF host is
// the same defect item 4 exists to close.
//
// It is not covered here, for two reasons, both stated so the gap is visible:
//
//  1. REASONED, NOT PROVEN: VS Code's snippet session is believed to re-join
//     each text run on `model.getEOL()` while it adjusts indentation, which
//     would make BOTH snippet paths EOL-safe by the platform rather than by this
//     code. That belief is from knowledge of the editor, not from a witness on
//     this box, and this project has already been burned once by source-cited
//     research inverting platform truth. It needs a live witness (a real
//     extension host inserting an LF snippet into a CRLF buffer) before anyone
//     concludes the path is safe. `test-vscode/` is where that witness belongs.
//  2. The only existing drive that reaches this path is the real-repo rig in
//     `test/blind-v31-wiring.test.cjs` (a temp Go module, a fake in-process
//     Ollama, ~900 lines of harness). Re-cutting that inside a blind file to
//     assert one string would have been a fixture-fault risk far larger than the
//     row's value, and a harness fault reads exactly like a product defect.
//
// AND THE CONTRACT UNDERCOUNTS. Item 6 says "there is more than one" and names
// three. There is a FOURTH: the same `column80.generateTests` gesture, when the
// target file ALREADY exists, inserts the blank-value snippet into that existing
// buffer (fnGen.ts ~6230). That one is an insertion of model-authored newlines
// into a document that already has endings of its own — the mixed-endings case
// exactly, and the one write of the four where a mismatch is guaranteed to show
// up in a git diff. Whatever is decided for the third path applies to it, and
// the contract does not name it.
