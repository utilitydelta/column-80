// Blind oracle, session-v56 phase 3: "the FIM discard toast becomes a channel
// line" (roadmap item 64, mechanical half). Contract:
// session-v56/contract-phase3.md. Written BEFORE the fix.
//
// WHAT THIS FILE PINS. A background repair session started by a FIM accept
// that loses the document-version race to the user's own typing must put its
// discard on the CHANNEL (or the status-bar surface), never a toast; a session
// from an explicit gesture keeps today's warning toast; and the discard is
// still recorded on the outcome log in both cases:
//   contract 1  source "fim"  -> NO toast of any severity; a channel line (or
//               status-bar message) records the discard and why
//   contract 2  source not "fim" -> the warning toast fires with today's
//               wording (the "generation discarded" shape), unchanged
//   contract 3  logOutcome("discarded") or equivalent lands in BOTH cases -
//               this change is about the surface, not the record
//
// THE DRIVE IS THE PRODUCT'S OWN, END TO END. Each session row goes through
// `runPostAcceptOracle` with the REAL `ProposalPresenter` and a REAL
// `FnGenService` (scripted generate fn, the blind-repair-livecontext
// precedent): a scratch copy of the repairbench crate, `parse_duration`
// broken, a real `cargo check` finding the error, a real repair round, and
// the real present/discard path deciding the surface. The session's `source`
// is set where the product sets it - `PostAcceptContext.source` - so wherever
// the fix threads it, these rows see the result.
//
// THE VERSION RACE IS THE PRODUCT'S OWN. No internal is monkey-patched. The
// stub document is a live host document whose `version` is real state; the
// scripted generate fn plays the human who KEEPS TYPING while the background
// round runs: on every model call it appends a line to the document and bumps
// `version` - strictly after the round resolved its span, exactly the race
// the contract describes. What counts as a version-race loss is untouched
// (`ProposalRequest.versionAtResolve`: "any mismatch at a guard point
// discards, never applies" - the exported type's own words).
//
// BINDINGS THE CONTRACT LEAVES OPEN, resolved by reading and REPORTED:
//   * WHERE THE FIM LINE LANDS. Contract 1 allows "a CHANNEL line (or the
//     existing status-bar surface)". Bound to: any line on the session's
//     output channel, the service's evidence log (the extension routes it to
//     the same channel), or a status-bar message. The bare evidence token
//     "[fngen] outcome=discarded" does NOT satisfy it - the contract demands
//     the line say WHAT was discarded AND WHY, and that token says neither.
//   * THE "WHY". Unpinned wording; bound to a reason-shaped token
//     (/version|edit|chang|typ|stale|race|moved|newer/i) on the same line.
//   * TOAST WORDING. Contract 2 says "unchanged wording"; pinned as the
//     /generation discarded/i shape on a WARNING toast, not exact bytes.
//   * A SOURCE-LESS present(). The explicit fn-gen command calls present()
//     directly, outside any repair session. Contract 2 covers "anything not
//     'fim'", so a direct, source-less present() driven to the same race is
//     bound to KEEP the toast (guard row G3).
//
// EXPECTED TODAY (pre-fix): the fim no-toast row RED (the discard toasts a
// warning today) and likely the fim channel-line row RED; the fngen toast row
// GREEN; both outcome-log rows GREEN; harness/witness rows GREEN.
//
// Run: node --test test/blind-v56-p3-fim-discard-surface.test.cjs
// (needs cargo on PATH: the repair session runs a real `cargo check`.)

const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const esbuild = require("esbuild");

// ---------------------------------------------------------------------------
// The vscode stub: the v55-p7 stub that already drove the REAL
// ProposalPresenter end to end (diff tab answered by firing the product's own
// column80.proposalAccept command), plus status-bar recording and an
// applyEdit hook so an accepted splice can land on the live document like a
// host would land it (version bump included).
// ---------------------------------------------------------------------------

const STUB = path.join(__dirname, ".blind-v56-p3-stub.cjs");
fs.writeFileSync(
  STUB,
  `
const state = { config: {}, messages: [], statusBar: [], commands: {}, appliedEdits: [], executeCalls: [], onApplyEdit: undefined };
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
    workspaceFolders: [],
    getWorkspaceFolder: () => undefined,
    openTextDocument: async () => undefined,
    applyEdit: async (edit) => {
      state.appliedEdits.push(edit);
      if (state.onApplyEdit) state.onApplyEdit(edit);
      return true;
    },
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
    setStatusBarMessage: (message) => { state.statusBar.push({ message }); return { dispose() {} }; },
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
        // present() registers its decision resolver only after this call
        // resolves; a synchronous accept would land before anyone listens.
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

const ENTRY = path.join(__dirname, ".blind-v56-p3.entry.ts");
const OUTFILE = path.join(__dirname, ".blind-v56-p3.bundle.cjs");
let B = {};
let bundleErr;
try {
  fs.writeFileSync(
    ENTRY,
    `export { runPostAcceptOracle } from "../src/vscode/oracleSurface";
export { ProposalPresenter } from "../src/vscode/fnGen";
export { FnGenService } from "../src/core/fnGenService";
export { __state, Position, Range } from "vscode";\n`,
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
    if (bundleErr) return ctx.skip("bundle failed to build; see the harness guard row");
    return fn(ctx);
  });

// ---------------------------------------------------------------------------
// A LIVE host document over a real file. `version` is real, mutable state,
// and `__type(snippet)` is the human typing: text changes, version moves -
// the product's own race signal, no internal touched. `__applyEntries` lands
// an accepted WorkspaceEdit the way a host would: text changes, version moves.
// ---------------------------------------------------------------------------

function makeLiveDoc(file, languageId) {
  const d = { text: fs.readFileSync(file, "utf8"), version: 1 };
  const lineStarts = () => {
    const ls = [0];
    for (let i = 0; i < d.text.length; i++) if (d.text[i] === "\n") ls.push(i + 1);
    return ls;
  };
  const offsetOf = (pos) => {
    const ls = lineStarts();
    return Math.min((ls[pos.line] ?? d.text.length) + pos.character, d.text.length);
  };
  const doc = {
    languageId,
    get version() {
      return d.version;
    },
    isDirty: false,
    isClosed: false,
    eol: 1,
    get lineCount() {
      return lineStarts().length;
    },
    fileName: file,
    uri: { fsPath: file, path: file, scheme: "file", toString: () => "file://" + file, with() { return this; } },
    getText(range) {
      return range === undefined ? d.text : d.text.slice(offsetOf(range.start), offsetOf(range.end));
    },
    offsetAt: offsetOf,
    positionAt(offset) {
      const ls = lineStarts();
      const off = Math.max(0, Math.min(offset, d.text.length));
      let line = 0;
      while (line + 1 < ls.length && ls[line + 1] <= off) line++;
      return new B.Position(line, off - ls[line]);
    },
    lineAt(arg) {
      const n = typeof arg === "number" ? arg : arg.line;
      const t = d.text.split("\n")[n] ?? "";
      const m = t.match(/\S/);
      return {
        lineNumber: n,
        text: t,
        range: new B.Range(n, 0, n, t.length),
        firstNonWhitespaceCharacterIndex: m ? m.index : t.length,
        isEmptyOrWhitespace: !m,
      };
    },
    save: async () => true,
  };
  doc.__type = (snippet) => {
    d.text += snippet;
    d.version += 1;
    fs.writeFileSync(file, d.text);
  };
  doc.__applyEntries = (edit) => {
    const flat = edit.entries().flatMap(([, es]) => es);
    flat
      .map((e) => ({ start: offsetOf(e.range.start), end: offsetOf(e.range.end), text: e.newText }))
      .sort((a, b) => b.start - a.start)
      .forEach((e) => {
        d.text = d.text.slice(0, e.start) + e.text + d.text.slice(e.end);
      });
    d.version += 1;
    fs.writeFileSync(file, d.text);
  };
  return doc;
}

// ---------------------------------------------------------------------------
// The repairbench drive (blind-repair-livecontext precedent): scratch crate,
// parse_duration broken, real cargo check, scripted service returning the
// known-good body. The only difference per scenario is `source` and whether
// the human keeps typing while the round runs.
// ---------------------------------------------------------------------------

const REPAIRBENCH = path.join(__dirname, "fixtures", "repairbench");
const CFG = { apiBase: "http://fake.invalid:1", model: "scripted-30b", fallbackModel: "x", maxTokens: 512, temperature: 0.2 };

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

async function driveSession({ source, race }) {
  const crate = fs.mkdtempSync(path.join(os.tmpdir(), `blind-v56-p3-${source}-`));
  let service;
  try {
    fs.cpSync(REPAIRBENCH, crate, { recursive: true });
    const file = path.join(crate, "src", "task1.rs");
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace('"s" => Some(number),', '"s" => Some("thirty"),'));

    const doc = makeLiveDoc(file, "rust");
    const t0 = doc.getText();
    const fnStart = t0.indexOf("pub fn parse_duration");
    const fnEnd = t0.indexOf("\n}", fnStart) + 2;
    assert.ok(fnStart >= 0 && fnEnd > fnStart, "harness: the broken parse_duration must exist in the fixture");
    const fixed = t0.slice(fnStart, fnEnd).replace('"s" => Some("thirty"),', '"s" => Some(number),');

    const svcLines = [];
    let rounds = 0;
    service = new B.FnGenService(
      CFG,
      async () => {
        rounds += 1;
        if (race) {
          // The human keeps typing while the background round runs: strictly
          // AFTER this round resolved its span (the prompt in hand is built
          // from that resolution), the document's version moves. Every round
          // races, so every proposal must discard, never apply.
          doc.__type(`\n// the human typed this while round ${rounds} ran\n`);
        }
        return { text: "```rust\n" + fixed + "\n```", ttftMs: 1, totalMs: 2, doneReason: "stop" };
      },
      (l) => svcLines.push(l),
    );

    const channel = [];
    const out = { lines: channel, appendLine: (l) => channel.push(l), append() {}, show() {}, clear() {}, dispose() {} };
    const st = B.__state;
    st.messages = [];
    st.statusBar = [];
    st.appliedEdits = [];
    st.onApplyEdit = (edit) => doc.__applyEntries(edit);

    await B.runPostAcceptOracle({
      document: doc,
      landedSpan: { start: fnStart, end: fnEnd },
      source,
      service,
      output: out,
      presenter: new B.ProposalPresenter({ subscriptions: [] }),
      resolveFunction: fnResolver("parse_duration"),
      repairTierGate: { allowed: true },
    });

    return {
      rounds,
      svcLines: svcLines.slice(),
      channel: channel.slice(),
      toasts: st.messages.slice(),
      statusBar: st.statusBar.map((s) => s.message),
      appliedCount: st.appliedEdits.length,
    };
  } finally {
    try {
      service?.dispose();
    } catch {
      /* teardown only */
    }
    B.__state.onApplyEdit = undefined;
    fs.rmSync(crate, { recursive: true, force: true });
  }
}

// One drive per scenario, shared across its rows (a cargo check per drive is
// the price of the real path; rows must not multiply it).
const memo = new Map();
const drive = (source, race) => {
  const key = `${source}:${race}`;
  if (!memo.has(key)) memo.set(key, driveSession({ source, race }));
  return memo.get(key);
};

// ---- shared bindings -------------------------------------------------------

const OUTCOME_DISCARDED = "[fngen] outcome=discarded";
const isBareOutcome = (l) => /^\[fngen\] outcome=/.test(l.trim());
// A line that records the discard AND carries a reason-shaped token (the
// "why" binding reported in the header).
const discardStoryLines = (r) =>
  [...r.channel, ...r.svcLines, ...r.statusBar].filter(
    (l) => /discard/i.test(l) && !isBareOutcome(l) && /version|edit|chang|typ|stale|race|moved|newer/i.test(l),
  );

const fmt = (r) =>
  `toasts=${JSON.stringify(r.toasts.map((t) => `${t.kind}: ${t.message}`))}\n` +
  `channel=${JSON.stringify(r.channel)}\n` +
  `service-log=${JSON.stringify(r.svcLines)}\n` +
  `status-bar=${JSON.stringify(r.statusBar)}`;

// ===========================================================================
// Harness guards. If any is red, every verdict below is suspect.
// ===========================================================================

test("G1 [harness]: the oracle surface, the real presenter, and the service bundle headless against the stub", () => {
  if (bundleErr) assert.fail(`bundle failed to build: ${bundleErr.stack || bundleErr.message}`);
  for (const n of ["runPostAcceptOracle", "ProposalPresenter", "FnGenService"]) {
    assert.ok(B[n] !== undefined, `${n} must be exported for this file to drive it`);
  }
});

btest("G2 [witness]: with NO race, the same rig reaches the REAL present path and the proposal is accepted", async () => {
  // This row is what makes a "discarded" verdict below meaningful: the rig can
  // drive a session all the way through cargo check, a model round, the real
  // diff-accept machinery, and an applied splice. A discard elsewhere is then
  // the version guard's doing, not the rig failing short of present().
  const r = await drive("fngen", false);
  assert.ok(r.rounds >= 1, `a repair round must have fired.\n${fmt(r)}`);
  assert.ok(
    r.svcLines.includes("[fngen] outcome=accept"),
    `the no-race control must end in an ACCEPT on the outcome log.\n${fmt(r)}`,
  );
  assert.ok(r.appliedCount >= 1, `the accepted proposal must reach workspace.applyEdit.\n${fmt(r)}`);
});

btest("G3 [guard]: a source-less present() driven straight to the version race still warns - the explicit gesture's own splice keeps its toast", async () => {
  // The fn-gen command calls present() directly, outside any repair session.
  // Contract 2: everything that is not a "fim" session toasts exactly as
  // today. Reported binding: a present() with no session source is an
  // explicit gesture's.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "blind-v56-p3-direct-"));
  try {
    const file = path.join(dir, "calc.ts");
    const text =
      "/** Adds two numbers. */\n" +
      "export function add(a: number, b: number): number {\n" +
      "  return 0;\n" +
      "}\n";
    fs.writeFileSync(file, text);
    const doc = makeLiveDoc(file, "typescript");
    const span = { start: text.indexOf("export function"), end: text.lastIndexOf("}") + 1 };
    const versionAtResolve = doc.version;
    // The human types AFTER the resolve and BEFORE the proposal presents: the
    // document's version moves, by the document's own mechanism.
    doc.__type("\n// typed while the model ran\n");

    const st = B.__state;
    st.messages = [];
    st.statusBar = [];
    st.appliedEdits = [];
    const outcomes = [];
    const outcome = await new B.ProposalPresenter({ subscriptions: [] }).present({
      document: doc,
      span,
      versionAtResolve,
      title: "add: generated body (preview)",
      text: "export function add(a: number, b: number): number {\n  return a + b;\n}",
      service: { logOutcome: (o) => outcomes.push(o) },
    });

    assert.strictEqual(outcome, "discarded", "the version guard must refuse to apply over the human's newer text");
    assert.deepStrictEqual(outcomes, ["discarded"], "the outcome log records the discard");
    assert.strictEqual(st.appliedEdits.length, 0, "a discarded proposal writes nothing");
    assert.ok(
      st.messages.some((m) => m.kind === "warn" && /generation discarded/i.test(m.message)),
      `the explicit path's warning toast, today's wording. Toasts: ${JSON.stringify(st.messages)}`,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ===========================================================================
// Contract 1: the FIM-sourced session's version-race discard is CHANNEL-ONLY.
// ===========================================================================

btest("C1a [fim x race]: NO toast of any severity for the background session's discard", async () => {
  const r = await drive("fim", true);
  assert.ok(
    r.svcLines.includes(OUTCOME_DISCARDED),
    `precondition: the rig must actually produce a version-race discard (contract 3's record proves it fired). ` +
      `No discard happened, so this row proves nothing.\n${fmt(r)}`,
  );
  assert.deepStrictEqual(
    r.toasts.map((t) => `${t.kind}: ${t.message}`),
    [],
    `contract 1: "A discard in a session whose source is 'fim' produces a CHANNEL line ... and NO toast." ` +
      `The background session the user never invoked raised a toast.\n${fmt(r)}`,
  );
});

btest("C1b [fim x race]: a channel line (or status-bar message) records WHAT was discarded and WHY", async () => {
  const r = await drive("fim", true);
  assert.ok(
    r.svcLines.includes(OUTCOME_DISCARDED),
    `precondition: no version-race discard fired, so this row proves nothing.\n${fmt(r)}`,
  );
  assert.ok(
    discardStoryLines(r).length >= 1,
    `contract 1: "The channel line still says what was discarded and why." No channel/status-bar line tells the ` +
      `story - the bare "${OUTCOME_DISCARDED}" evidence token says neither what nor why, so it does not count.\n${fmt(r)}`,
  );
});

btest("C3a [fim x race]: the discard outcome is still on the outcome log", async () => {
  const r = await drive("fim", true);
  assert.ok(
    r.svcLines.includes(OUTCOME_DISCARDED),
    `contract 3: "The discard outcome is still logged ... in both cases - this change is about the surface, ` +
      `not the record."\n${fmt(r)}`,
  );
  assert.strictEqual(r.appliedCount, 0, `a discarded proposal must never reach workspace.applyEdit.\n${fmt(r)}`);
});

// ===========================================================================
// Contract 2: the explicit-gesture session keeps today's toast, unchanged.
// ===========================================================================

btest("C2a [fngen x race]: the warning toast fires with today's wording", async () => {
  const r = await drive("fngen", true);
  assert.ok(
    r.svcLines.includes(OUTCOME_DISCARDED),
    `precondition: no version-race discard fired, so this row proves nothing.\n${fmt(r)}`,
  );
  const warns = r.toasts.filter((t) => t.kind === "warn");
  assert.ok(
    warns.length >= 1,
    `contract 2: a session from an explicit gesture "still toasts exactly as today" - at WARNING weight.\n${fmt(r)}`,
  );
  assert.ok(
    warns.some((t) => /generation discarded/i.test(t.message)),
    `contract 2 pins the wording unchanged: the "generation discarded" shape. ` +
      `Warnings shown: ${JSON.stringify(warns.map((t) => t.message))}`,
  );
});

btest("C3b [fngen x race]: the discard outcome is still on the outcome log, and nothing was applied", async () => {
  const r = await drive("fngen", true);
  assert.ok(
    r.svcLines.includes(OUTCOME_DISCARDED),
    `contract 3: the explicit-gesture discard must still be recorded.\n${fmt(r)}`,
  );
  assert.strictEqual(r.appliedCount, 0, `a discarded proposal must never reach workspace.applyEdit.\n${fmt(r)}`);
});
