// Blind oracle, session-v58 phase 4: "the error frame the cloud reader drops"
// (roadmap item 67, third hole). Contract: session-v58/contract-phase4.md,
// as CORRECTED 2026-08-22 per S58-8. Written BEFORE the fix, against the
// contract only.
//
// ===========================================================================
// WHAT THIS FILE PINS
// ===========================================================================
//
// An OpenAI-compatible provider can fail INSIDE a 200. It writes
//
//     data: {"error":{"message":"upstream overloaded","type":"server_error"}}
//
// and then stops. `StreamDelta` declares only `choices`, `handleLine` has no
// error branch, so that frame is parsed, matches nothing, and vanishes. The
// provider said WHY it failed and the user is never told.
//
// The ruling this file tests, quoted from the contract so it is not
// re-litigated here: extending S20 from the Anthropic arm to this one, **a
// generic provider error frame keeps the provider's own message and gets NO
// crafted sentence.** S20's measurement is the reason. On the Anthropic arm a
// rate limit, an invalid key and a malformed request all arrive through one
// generic envelope, and a crafted sentence there told a user with a bad key to
// go and check a server that was fine. The provider's own message is the
// actionable half.
//
// ===========================================================================
// THE CORRECTION, AND WHY THE HEADLINE ROW IS WRITTEN POSITIVELY
// ===========================================================================
//
// The baseline MOVED under this contract while it was being written. At the
// branch point the drive above resolved empty and drew the empty-generation
// sentence ("...contained no usable code..."). Since phase 3 landed, the same
// drive draws the SILENT-SERVER sentence instead ("...the model server went
// silent mid-reply...check the server..."), because an error frame carries
// neither a `finish_reason` nor a `[DONE]` and the new terminal check fires
// first.
//
// So the original falsifier wording - "the toast is NOT the empty-generation
// sentence" - is ALREADY TRUE in the tree. A row written that way cannot go
// fully red, and red-before-green would be satisfied by a row that can never
// fail. Every headline row in this file therefore carries a POSITIVE
// assertion: the toast CONTAINS the provider's own words. Where a negative
// clause is kept it names BOTH wrong sentences, and BOTH are read out of the
// product at run time rather than written down here.
//
// Both wrong sentences are wrong the same way. The provider said it was
// overloaded; one sentence sends the user to check a server that is answering
// fine, the other sends them straight back into the same overloaded provider.
// Wrong cause, wrong remedy, twice over. Neither row is at fault - each is
// correct for what it was handed - so nothing in this file touches either.
//
// ===========================================================================
// REGRESSION ROWS - GREEN ON BOTH SIDES OF THE FIX
// ===========================================================================
//
// NOT weak rows, and NOT expected to flip. They are green at the branch point
// and must stay green after the phase lands. A reader triaging this file must
// read a red one as "phase 4 damaged phase 3", never as "the feature has not
// landed yet":
//
//     C6 [happy, both signals]        C6 [finish_reason, no DONE]
//     C6 [DONE, no finish_reason]     C6 [mid-reply cut]
//     C6 [no error field, empty ok]   G1, G2
//
// ===========================================================================
// FORWARD GUARDS - GREEN NOW, AND ONLY MEANINGFUL AFTER THE PHASE
// ===========================================================================
//
// Falsifier 7's five malformed shapes. Today no error branch exists, so
// nothing can crash in one; these rows are vacuously green and start earning
// their keep the moment the branch is written. Labelled so nobody counts them
// as evidence the phase landed:
//
//     F7 [error is a string] [a number] [an array] [null] [no message]
//
// ===========================================================================
// BINDINGS THE CONTRACT LEAVES OPEN, RESOLVED AND REPORTED
// ===========================================================================
//
//   * THE SILENT-SERVER SENTENCE. Never written down. Driven out of the
//     product: the cloud arm against a 204, which makes fetch hand back a null
//     body and makes the product throw its own "response has no body" string,
//     then through the real `generationFailedToast`. Throw and sentence both
//     come from the product.
//   * THE EMPTY-GENERATION SENTENCE. Driven through the same real translator
//     from the fn-gen service's own reject text, `generation was empty after
//     postprocess`. That marker is a literal here because C5 NAMES it - the
//     forgery row is defined as a provider sending exactly those words - so the
//     literal is the contract's, not this file's invention. The SENTENCE still
//     comes out of the product.
//   * THE ELISION MARKER (C3). Never written down. Read out of the product by
//     driving an EXISTING bounded site - a cloud non-200 whose body is 100_000
//     identical characters - twice, with two different filler characters, and
//     taking the longest common suffix of the two thrown messages. The fillers
//     differ, so the common suffix is exactly the marker and nothing else.
//   * THE PROVIDER'S MESSAGE. "upstream overloaded", the contract's own falsifier
//     1 text and `session-v57/fake-server.mjs`'s `flood-200` shape.
//   * THE GESTURE ARGUMENT. Bound to "function generation" everywhere, so any
//     difference between rows is the ERROR's doing and never the gesture's.
//   * C4's "IT EARNS A PAYLOAD_CARRIERS ENTRY AND NO SERVICE_REJECT_TOASTS ROW".
//     A blind file cannot read a table. It pins the two OBSERVABLE consequences
//     the contract names: `translateServiceReject` returns undefined for this
//     throw (no crafted sentence was invented for it), and no service row
//     matches inside the provider's text (C5, the forgery row). Whether that is
//     achieved by a new head in the list or by an existing broader one is the
//     implementer's business; the consequence is the contract's.
//   * C4's "THE MARKER IS AT INDEX 0". Probed from outside two ways: two drives
//     with different provider messages must share a non-empty common PREFIX and
//     each must carry its provider text at an index greater than zero; and a
//     provider whose message IS another row's anchored marker must not draw that
//     row's sentence.
//   * C7 IS PARTLY UNTESTABLE FROM OUTSIDE. Its substance is "the other two wire
//     shapes are named as not-handled rather than silently assumed absent",
//     which is a claim about prose in the source, not about behaviour. What is
//     testable is what those two shapes DO, so they get a printed probe (P1) and
//     no assertion. The falsification gap is the same one the contract records:
//     nothing here has watched a real OpenAI-compatible endpoint fail
//     mid-stream, and the frame shape is S57-2's recording against a fake
//     server.
//
// ===========================================================================
// EXPECTED AT THE BRANCH POINT (measured, not predicted)
// ===========================================================================
//
//   RED   C1 [frame seen, terminals present]  - resolves empty today
//   RED   C1 [re-cut of adversarial-v58-p3]   - draws the silent-server sentence
//   RED   C2 [provider message on screen], C2 [neither wrong sentence]
//   RED   C3 [100KB bounded]
//   RED   C4 [head is fixed], C4 [head cannot be forged], C4 [no service row]
//   RED   C5 [forgery]
//   RED   C8 [error frame, no terminal signal], C8 [error frame then a cut]
//   RED   F3 [content then error]
//   GREEN every C6 row, every F7 row, G1, G2. P0/P1 assert nothing.
//
// Run: node --test test/blind-v58-p4-cloud-error-frame.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const path = require("node:path");
const fs = require("node:fs");
const esbuild = require("esbuild");

// ---------------------------------------------------------------------------
// The vscode stub: blind-v58-p3's stub, unchanged. Only generationFailedToast
// and translateServiceReject are needed and both are pure string functions, but
// the module graph behind src/vscode/fnGen.ts touches most of the vscode API at
// import time, so the precedent stub is reused verbatim rather than trimmed.
// ---------------------------------------------------------------------------

const STUB = path.join(__dirname, ".blind-v58-p4-stub.cjs");
fs.writeFileSync(
  STUB,
  `
const nodeFs = require("node:fs");
const state = {
  config: {}, messages: [], commands: {}, activeTextEditor: undefined,
  snippetInserts: [], appliedEdits: [], executeCalls: [], terminals: [],
  textDocuments: [], warnResponses: [], infoResponses: [],
  symbols: undefined, wroot: "/",
  openTextDocumentImpl: undefined, applyEditImpl: undefined,
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
    openTextDocument: async (...args) => {
      if (state.openTextDocumentImpl) return state.openTextDocumentImpl(...args);
      return state.activeTextEditor && state.activeTextEditor.document;
    },
    applyEdit: async (edit) => {
      if (state.applyEditImpl) return state.applyEditImpl(edit);
      state.appliedEdits.push(edit);
      return true;
    },
    fs: {
      stat: async () => { throw new Error("ENOENT"); },
      createDirectory: async (uri) => { nodeFs.mkdirSync(uri.fsPath, { recursive: true }); },
      writeFile: async (uri, bytes) => { nodeFs.writeFileSync(uri.fsPath, Buffer.from(bytes)); },
      readFile: async (uri) => nodeFs.readFileSync(uri.fsPath),
      delete: async (uri) => { nodeFs.rmSync(uri.fsPath, { force: true, recursive: true }); },
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
    showInformationMessage: async (message, ...actions) => { state.messages.push({ kind: "info", message, actions }); return (state.infoResponses || []).shift(); },
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
    tabGroups: { all: [], activeTabGroup: undefined, onDidChangeTabs: () => ({ dispose() {} }), close: async () => {} },
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

const ENTRY = path.join(__dirname, ".blind-v58-p4.entry.ts");
const OUTFILE = path.join(__dirname, ".blind-v58-p4.bundle.cjs");
let B = {};
let bundleErr;
try {
  fs.writeFileSync(
    ENTRY,
    `export { makeCloudInstruct } from "../src/core/cloudInstruct";\n` +
      `export { generationFailedToast, translateServiceReject } from "../src/vscode/fnGen";\n`,
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

test.after(() => {
  for (const f of [STUB, ENTRY, OUTFILE]) fs.rmSync(f, { force: true });
});

const btest = (name, fn) =>
  test(name, (ctx) => {
    if (bundleErr) return ctx.skip("bundle failed to build; see the G1 harness guard row");
    return fn(ctx);
  });

// ---------------------------------------------------------------------------
// Servers. Every one is a real node:http listener on a real loopback socket;
// nothing here stubs fetch.
// ---------------------------------------------------------------------------

const SSE = "text/event-stream";
const sseFrame = (o) => `data: ${JSON.stringify(o)}\n\n`;
const DONE_SENTINEL = "data: [DONE]\n\n";

/** An OpenAI-shape in-stream error frame. `session-v57/fake-server.mjs`'s
 *  `flood-200` / `forgery` scenarios write exactly this line. */
const errorFrame = (message, type = "server_error") => sseFrame({ error: { message, type } });

/** Sockets are tracked and destroyed on close: the cut rows leave a response
 *  half written on purpose, and server.close() waits forever on an open
 *  connection. */
function serve(handler) {
  const server = http.createServer(handler);
  const sockets = new Set();
  server.on("connection", (s) => {
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({
        base: `http://127.0.0.1:${server.address().port}`,
        close: () =>
          new Promise((done) => {
            for (const s of sockets) s.destroy();
            server.close(() => done());
          }),
      });
    });
  });
}

/** A clean, complete HTTP response carrying exactly these frames. */
const cleanServer = (frames, ctype) => (_req, res) => {
  res.writeHead(200, { "content-type": ctype });
  for (const f of frames) res.write(f);
  res.end();
};

/** THE MID-REPLY CUT, measured in phase 3 and reused unchanged. Connection-close
 *  framing, so the socket close reads as end-of-body rather than a truncated
 *  chunked body, THEN res.destroy(). Without the framing, undici rejects with
 *  `TypeError: terminated` and the row measures a transport fault instead of the
 *  contract's case. */
const cutServer = (frames, ctype) => (_req, res) => {
  res.useChunkedEncodingByDefault = false;
  res.shouldKeepAlive = false;
  res.writeHead(200, { "content-type": ctype, connection: "close" });
  for (const f of frames) res.write(f);
  setTimeout(() => res.destroy(), 150);
};

/** 204: the only clean way to make fetch() hand back a null body on a 2xx, and
 *  therefore the way to make the cloud transport throw its EXISTING
 *  silent-server string without this file writing that string down. */
const noBodyServer = () => (_req, res) => {
  res.writeHead(204, {});
  res.end();
};

/** A non-200 with a body of this size. The EXISTING bounded site, used only to
 *  read the elision marker out of the product. 500 rather than 400, so the
 *  dialect-learning retry never engages. */
const bigErrorServer = (fill) => (_req, res) => {
  res.writeHead(500, { "content-type": "text/plain" });
  res.end(fill.repeat(100000));
};

async function withServer(handler, fn) {
  const srv = await serve(handler);
  try {
    return await fn(srv.base);
  } finally {
    await srv.close();
  }
}

// ---------------------------------------------------------------------------
// Drives.
// ---------------------------------------------------------------------------

const GESTURE = "function generation";
const PROVIDER_MSG = "upstream overloaded";
// The fn-gen service's own reject text. A literal because C5 defines the
// forgery as a provider sending exactly these words; the SENTENCE it draws is
// still read out of the product below.
const EMPTY_MARKER = "generation was empty after postprocess";

const driveCloud = (base, signal) =>
  B.makeCloudInstruct({ baseUrl: base, apiKey: "test-key" })({
    apiBase: base,
    model: "test-model",
    prompt: "write a function that adds two integers",
    maxTokens: 256,
    temperature: 0,
    signal: signal ?? new AbortController().signal,
  });

async function outcome(fn) {
  try {
    return { ok: true, value: await fn() };
  } catch (err) {
    return {
      ok: false,
      err,
      name: err instanceof Error ? err.name : "",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

const toast = (err) => B.generationFailedToast(err, GESTURE);
const short = (s) => (typeof s === "string" && s.length > 240 ? `${s.slice(0, 240)}... (${s.length} chars)` : s);

const commonPrefix = (a, b) => {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  return a.slice(0, i);
};
const commonSuffix = (a, b) => {
  let i = 0;
  while (i < a.length && i < b.length && a[a.length - 1 - i] === b[b.length - 1 - i]) i += 1;
  return i === 0 ? "" : a.slice(a.length - i);
};

// ---------------------------------------------------------------------------
// THE REFERENCES. Driven out of the product once, cached. See the binding notes
// in the header: this file cannot go stale on a re-wording, only re-baseline.
// ---------------------------------------------------------------------------

let refCache;
async function references() {
  if (refCache === undefined) {
    const silentGot = await withServer(noBodyServer(), (base) => outcome(() => driveCloud(base)));
    assert.strictEqual(
      silentGot.ok,
      false,
      "harness: a 204 must make the cloud transport throw its existing silent-server string; it resolved " +
        `with ${JSON.stringify(silentGot.value)} instead, so the reference cannot be read out of the product`,
    );

    const a = await withServer(bigErrorServer("A"), (base) => outcome(() => driveCloud(base)));
    const b = await withServer(bigErrorServer("B"), (base) => outcome(() => driveCloud(base)));
    assert.strictEqual(a.ok, false, "harness: a 500 must throw so the elision marker can be read out of it");
    assert.strictEqual(b.ok, false, "harness: a 500 must throw so the elision marker can be read out of it");

    refCache = {
      silent: toast(silentGot.err),
      silentThrow: silentGot.message,
      empty: toast(new Error(EMPTY_MARKER)),
      elision: commonSuffix(a.message, b.message),
      boundedLen: a.message.length,
    };
  }
  return refCache;
}

// ===========================================================================
// G - HARNESS GUARDS. If either is red, every verdict below is suspect.
// ===========================================================================

test("G1 [harness]: the bundle builds headless and exports the drive plus both translators", () => {
  if (bundleErr) assert.fail(`bundle failed to build: ${bundleErr.stack || bundleErr.message}`);
  for (const name of ["makeCloudInstruct", "generationFailedToast", "translateServiceReject"]) {
    assert.strictEqual(typeof B[name], "function", `${name} must be exported for this file to drive it`);
  }
});

btest("G2 [harness]: the three references are distinct, product-sourced and usable", async () => {
  // Without this, every row below could be satisfied by a fix that made all
  // three references collapse onto one useless string.
  const ref = await references();

  for (const [label, s] of [["silent-server", ref.silent], ["empty-generation", ref.empty]]) {
    assert.ok(typeof s === "string" && s.trim() !== "", `${label}: the reference must exist. Got ${JSON.stringify(s)}`);
    assert.ok(!s.includes("\n"), `${label}: a notification is one line. Got ${JSON.stringify(s)}`);
    assert.ok(s.length > 20, `${label}: the sentence must name what happened and what to do. Got ${JSON.stringify(s)}`);
  }
  assert.notStrictEqual(
    ref.silent,
    ref.empty,
    "harness: the two WRONG sentences must be different strings, or the negative clauses in C2 collapse " +
      "into one and the correction this file was written for is untestable",
  );
  assert.ok(
    !ref.silent.includes(PROVIDER_MSG) && !ref.empty.includes(PROVIDER_MSG),
    `harness: neither wrong sentence may already contain ${JSON.stringify(PROVIDER_MSG)}, or the positive ` +
      "assertion in C1/C2 would be satisfied by the very sentences it exists to reject",
  );

  assert.ok(
    ref.elision.length > 0 && ref.elision.length < 200,
    `harness: the elision marker must be a short suffix read out of the product. Got ${JSON.stringify(ref.elision)}`,
  );
  assert.ok(
    !ref.elision.includes("A") && !ref.elision.includes("B"),
    `harness: the marker is the common suffix of two 100_000-character bodies filled with DIFFERENT ` +
      `characters, so it cannot contain either filler. Got ${JSON.stringify(ref.elision)}`,
  );
  assert.ok(
    ref.boundedLen < 2000,
    `harness: a 100_000-character body must already be bounded at the existing site, or C3 has no ` +
      `reference behaviour to demand. Thrown message was ${ref.boundedLen} chars`,
  );
});

// ===========================================================================
// P - PROBES. Assert nothing; print what the tree does today so a reader can
// see which rows flipped and which never moved.
// ===========================================================================

btest("P0 [probe]: what the cloud arm does with an in-200 error frame today, and what the user is told", async () => {
  const ref = await references();
  const rows = [
    ["error frame, then finish_reason + [DONE]", [errorFrame(PROVIDER_MSG), sseFrame({ choices: [{ delta: {}, finish_reason: "stop" }] }), DONE_SENTINEL]],
    ["error frame alone, clean end", [errorFrame(PROVIDER_MSG)]],
    ["two content deltas, then an error frame", [sseFrame({ choices: [{ delta: { content: "fn add() {" } }] }), sseFrame({ choices: [{ delta: { content: " 1 " } }] }), errorFrame(PROVIDER_MSG)]],
    ["error frame reading exactly the empty-generation marker", [errorFrame(EMPTY_MARKER)]],
  ];
  console.error("\n=== P0 table: OpenAI-shape error frames inside a 200 ===");
  console.error("silent-server reference : %j", ref.silent);
  console.error("   from throw           : %j", ref.silentThrow);
  console.error("empty-generation ref    : %j", ref.empty);
  console.error("elision marker          : %j", ref.elision);
  console.error("---");
  for (const [label, frames] of rows) {
    const got = await withServer(cleanServer(frames, SSE), (b) => outcome(() => driveCloud(b)));
    console.error("drive   : %s", label);
    if (got.ok) {
      console.error("outcome : RESOLVED %j", got.value);
    } else {
      console.error("outcome : THREW %s %j", got.name, short(got.message));
      console.error("toast   : %j", short(toast(got.err)));
      console.error("== silent ref : %s   == empty ref : %s", toast(got.err) === ref.silent, toast(got.err) === ref.empty);
      console.error("translateServiceReject: %j", short(B.translateServiceReject(got.err)));
    }
    console.error("---");
  }
  console.error("=== end P0 table ===\n");
});

btest("P1 [probe, C7]: the two wire shapes this phase does NOT handle, recorded rather than assumed absent", async () => {
  // C7's substance is a claim about what the source says, which a black-box file
  // cannot read. What it CAN do is record what the two out-of-scope shapes
  // actually do, so the next reader does not have to guess whether they were
  // considered. Neither is asserted on.
  //
  // THE FALSIFICATION GAP, restated from the contract: the handled shape is
  // S57-2's recording against a fake server. Nothing in this repo has watched a
  // real OpenAI-compatible endpoint fail mid-stream. If a real provider uses one
  // of these two forms, this phase does not help it.
  const ref = await references();
  const shapes = [
    // Anthropic's framing: a named SSE event whose data carries the envelope.
    // The `event:` line itself is not a `data:` line, so the reader skips it -
    // but the data line that follows DOES carry an `error` field, so this shape
    // may fall into the new branch by accident. Worth seeing either way.
    ["event: error line, then a data: line", [`event: error\ndata: ${JSON.stringify({ type: "error", error: { type: "overloaded_error", message: PROVIDER_MSG } })}\n\n`]],
    // The dropped connection: no frame at all, just a socket that stops.
    ["dropped connection, no error frame", null],
  ];
  console.error("\n=== P1 table: out-of-scope wire shapes (C7) ===");
  for (const [label, frames] of shapes) {
    const got =
      frames === null
        ? await withServer(cutServer([sseFrame({ choices: [{ delta: { content: "fn add() {" } }] })], SSE), (b) => outcome(() => driveCloud(b)))
        : await withServer(cleanServer(frames, SSE), (b) => outcome(() => driveCloud(b)));
    console.error("shape   : %s", label);
    console.error("outcome : %s", got.ok ? `RESOLVED ${JSON.stringify(got.value)}` : `THREW ${got.name}: ${JSON.stringify(short(got.message))}`);
    if (!got.ok) console.error("toast   : %j (== silent ref: %s)", short(toast(got.err)), toast(got.err) === ref.silent);
    console.error("---");
  }
  console.error("=== end P1 table ===\n");
});

// ===========================================================================
// C1 - THE FRAME IS SEEN. `StreamDelta` gains an `error` field and handleLine a
// branch that throws when it arrives, inside a 200.
//
// The first row is the purest form of C1 and the one that isolates it from
// phase 3: the error frame is FOLLOWED by both terminal signals and a clean
// close, so phase 3's terminal check is satisfied and cannot be what throws.
// Today the frame vanishes and the drive resolves with empty text.
// ===========================================================================

btest("C1 [frame seen, terminals present]: an error frame throws even when the stream ends properly", async () => {
  const got = await withServer(
    cleanServer(
      [errorFrame(PROVIDER_MSG), sseFrame({ choices: [{ delta: {}, finish_reason: "stop" }] }), DONE_SENTINEL],
      SSE,
    ),
    (base) => outcome(() => driveCloud(base)),
  );
  assert.strictEqual(
    got.ok,
    false,
    "C1: the provider wrote an error frame and then finished the stream tidily. Phase 3's terminal check " +
      "is satisfied here, so it cannot be what catches this; only an error branch can. Today the frame is " +
      `parsed, matches nothing and vanishes. Got: RESOLVED ${JSON.stringify(got.value)}`,
  );
  assert.ok(
    got.message.includes(PROVIDER_MSG),
    `C1 + C2: the throw must carry the provider's own message. Got: ${JSON.stringify(short(got.message))}`,
  );
});

btest("C1 [re-cut of adversarial-v58-p3 ACCEPTED [cloud/error frame]]: the sentence this phase changes TO", async () => {
  // The standing rule on rows a phase flips. adversarial-v58-p3 pinned the moved
  // baseline on purpose - "today it is the silent-server sentence; phase 4
  // replaces it with the provider's own reason" - so that row goes red when this
  // phase lands and that red is success. Same drive, re-cut to the new claim.
  const ref = await references();
  const got = await withServer(cleanServer([errorFrame(PROVIDER_MSG)], SSE), (base) => outcome(() => driveCloud(base)));
  assert.strictEqual(got.ok, false, `an error frame is not a generation. Got RESOLVED ${JSON.stringify(got.value)}`);
  assert.ok(
    toast(got.err).includes(PROVIDER_MSG),
    `the provider's own reason must reach the screen.\n` +
      `  thrown : ${JSON.stringify(short(got.message))}\n` +
      `  toast  : ${JSON.stringify(short(toast(got.err)))}\n` +
      `  silent-server reference: ${JSON.stringify(ref.silent)}`,
  );
});

// ===========================================================================
// C2 - THE PROVIDER'S OWN MESSAGE SURVIVES TO THE SCREEN.
// ===========================================================================

btest("C2 [provider message on screen]: the toast names what the provider said", async () => {
  const got = await withServer(cleanServer([errorFrame(PROVIDER_MSG)], SSE), (base) => outcome(() => driveCloud(base)));
  assert.strictEqual(got.ok, false, `C2: the drive must throw before a toast exists. Got RESOLVED ${JSON.stringify(got.value)}`);
  const t = toast(got.err);
  assert.ok(
    t.includes(PROVIDER_MSG),
    `C2: "The toast names 'upstream overloaded'." The provider said why it failed and that is the ` +
      `actionable half - S20's whole finding. Got: ${JSON.stringify(short(t))}`,
  );
  // Secondary, and deliberately after the positive assertion: the sentence must
  // still be one plain line, not an API dump.
  assert.ok(!t.includes("\n"), `C2: a notification is one line. Got ${JSON.stringify(short(t))}`);
  for (const jargon of ["choices", "finish_reason", "[DONE]", "server_error", "Error:"]) {
    assert.ok(!t.includes(jargon), `C2: API vocabulary reached the screen: ${JSON.stringify(jargon)} in ${JSON.stringify(short(t))}`);
  }
});

btest("C2 [neither wrong sentence]: not the empty-generation one and not the silent-server one", async () => {
  // The CORRECTED negative clause. It names BOTH, because phase 3 already made
  // the single-sentence version half true. Both references come out of the
  // product, so a re-wording of either cannot quietly satisfy this row.
  const ref = await references();
  const got = await withServer(cleanServer([errorFrame(PROVIDER_MSG)], SSE), (base) => outcome(() => driveCloud(base)));
  assert.strictEqual(got.ok, false, `C2: the drive must throw. Got RESOLVED ${JSON.stringify(got.value)}`);
  const t = toast(got.err);
  assert.notStrictEqual(
    t,
    ref.silent,
    "C2: the silent-server sentence sends the user to check a server that is answering fine - it answered " +
      `with a reason. This is the half phase 3 moved onto, and the half that must move off.\n` +
      `  silent-server reference: ${JSON.stringify(ref.silent)}`,
  );
  assert.notStrictEqual(
    t,
    ref.empty,
    "C2: the empty-generation sentence sends the user straight back into the same overloaded provider.\n" +
      `  empty-generation reference: ${JSON.stringify(ref.empty)}`,
  );
});

// ===========================================================================
// C3 - IT IS BOUNDED. `session-v57/fake-server.mjs`'s `flood-200`: a 100KB error
// message inside a 200. The marker is read out of the product, never written
// down here.
// ===========================================================================

btest("C3 [100KB bounded]: a 100_000-character provider message reaches the toast elided, not whole", async () => {
  const ref = await references();
  const flood = "x".repeat(100000);
  const got = await withServer(cleanServer([errorFrame(flood)], SSE), (base) => outcome(() => driveCloud(base)));
  assert.strictEqual(got.ok, false, `C3: the drive must throw. Got RESOLVED ${JSON.stringify(got.value)}`);
  const t = toast(got.err);
  assert.ok(
    t.includes(ref.elision) || t.includes(ref.elision.replace(/\.$/, "")),
    `C3: the throw must apply the same bound as the three in-200 sites session-v57 bounded and the one on ` +
      `the Anthropic arm, which means the elision marker read out of the product must appear.\n` +
      `  marker : ${JSON.stringify(ref.elision)}\n` +
      `  toast  : ${JSON.stringify(short(t))}`,
  );
  assert.ok(
    t.length < 2000,
    `C3: "A 100KB error message does not reach a notification whole." The toast is ${t.length} characters`,
  );
  assert.ok(
    !t.includes("x".repeat(2000)),
    "C3: a two-thousand-character run of the provider's filler survived into the notification",
  );
});

// ===========================================================================
// C4 - THE MARKER IS AT INDEX 0, and the row is a PAYLOAD CARRIER rather than a
// crafted sentence. See the binding note: a blind file pins the observable
// consequences, not the table.
// ===========================================================================

btest("C4 [head is fixed]: the throw opens with a fixed prefix and the provider's text starts after it", async () => {
  const first = "upstream overloaded";
  const second = "your account has no remaining quota for this month";
  const a = await withServer(cleanServer([errorFrame(first)], SSE), (base) => outcome(() => driveCloud(base)));
  const b = await withServer(cleanServer([errorFrame(second)], SSE), (base) => outcome(() => driveCloud(base)));
  assert.strictEqual(a.ok, false, `C4: the drive must throw. Got RESOLVED ${JSON.stringify(a.value)}`);
  assert.strictEqual(b.ok, false, `C4: the drive must throw. Got RESOLVED ${JSON.stringify(b.value)}`);

  const idxA = a.message.indexOf(first);
  const idxB = b.message.indexOf(second);
  assert.ok(
    idxA > 0,
    `C4: the provider's text must appear in the throw, and NOT at index 0 - index 0 belongs to the fixed ` +
      `head so the message can be anchored and a server cannot move it.\n  thrown: ${JSON.stringify(short(a.message))}`,
  );
  assert.ok(idxB > 0, `C4: same, for a different provider message.\n  thrown: ${JSON.stringify(short(b.message))}`);

  const head = commonPrefix(a.message, b.message);
  assert.ok(
    head.length > 0,
    "C4: two different provider messages must produce throws that share a non-empty head. They shared " +
      "nothing, so there is no fixed prefix to anchor on",
  );
  assert.ok(
    !head.includes(first) && !head.includes(second),
    `C4: the shared head must be the product's own words, not the provider's. Got ${JSON.stringify(short(head))}`,
  );
  assert.ok(
    a.message.startsWith(head) && b.message.startsWith(head),
    "C4: the head sits at index 0 of both throws",
  );
});

btest("C4 [head cannot be forged]: a provider message that IS another row's anchored marker does not steal it", async () => {
  // The reason index 0 matters. Every transport marker in the toast table is
  // anchored and matched with startsWith; a throw that interpolates server text
  // can otherwise be made to CONTAIN another row's marker by the server. Here the
  // server sends the silent-server marker as its error message.
  const ref = await references();
  const forgedHeads = [
    // Read out of the product: the actual head of the existing silent-server throw.
    ref.silentThrow,
    "Cloud: the stream ended before any terminal signal, so the reply is incomplete",
  ];
  for (const forged of forgedHeads) {
    const got = await withServer(cleanServer([errorFrame(forged)], SSE), (base) => outcome(() => driveCloud(base)));
    assert.strictEqual(got.ok, false, `C4: the drive must throw. Got RESOLVED ${JSON.stringify(got.value)}`);
    assert.ok(
      !got.message.startsWith(forged),
      `C4: the provider chose ${JSON.stringify(short(forged))} as its error text and the throw opened with ` +
        "it. The head is the product's, at index 0, and a server must not be able to move it",
    );
    assert.notStrictEqual(
      toast(got.err),
      ref.silent,
      `C4: a provider whose error text is another row's anchored marker drew that row's sentence. ` +
        `Provider said ${JSON.stringify(short(forged))}, user was told ${JSON.stringify(ref.silent)}`,
    );
  }
});

btest("C4 [no service row]: this frame gets NO crafted sentence of its own", async () => {
  // Per the ruling: a generic provider error frame keeps the provider's message
  // and gets no crafted sentence. The observable form of "it gets no row in
  // SERVICE_REJECT_TOASTS" is that the real translator declines it, so the
  // catch-all renders the provider's words instead of a stand-in.
  const got = await withServer(cleanServer([errorFrame(PROVIDER_MSG)], SSE), (base) => outcome(() => driveCloud(base)));
  assert.strictEqual(got.ok, false, `C4: the drive must throw. Got RESOLVED ${JSON.stringify(got.value)}`);
  assert.strictEqual(
    B.translateServiceReject(got.err),
    undefined,
    "C4: S20's finding is that ONE generic envelope carries a rate limit, a bad key and a malformed " +
      "request, so any single crafted sentence for it is the wrong cause for two of the three. The " +
      `translator must decline this throw. Got: ${JSON.stringify(short(B.translateServiceReject(got.err)))}`,
  );
});

// ===========================================================================
// C5 - THE FORGERY ROUTE STAYS SHUT. `session-v57/fake-server.mjs`'s `forgery`
// scenario, on this arm. This is the exact attack PAYLOAD_CARRIERS exists for.
// ===========================================================================

btest("C5 [forgery]: a provider whose error text IS the empty-generation marker does not draw that sentence", async () => {
  const ref = await references();
  const got = await withServer(cleanServer([errorFrame(EMPTY_MARKER)], SSE), (base) => outcome(() => driveCloud(base)));
  assert.strictEqual(got.ok, false, `C5: the drive must throw. Got RESOLVED ${JSON.stringify(got.value)}`);
  const t = toast(got.err);
  assert.ok(
    t.includes(EMPTY_MARKER),
    `C5: the provider's own text, whatever it says, is what reaches the screen.\n` +
      `  thrown : ${JSON.stringify(short(got.message))}\n  toast : ${JSON.stringify(short(t))}`,
  );
  assert.notStrictEqual(
    t,
    ref.empty,
    "C5: the service's crafted sentence was drawn by text the SERVER chose. A service marker found inside " +
      "a payload is the server talking, not the service, and this is the forgery the payload-carrier guard " +
      `exists to close.\n  empty-generation reference: ${JSON.stringify(ref.empty)}`,
  );
  assert.notStrictEqual(t, ref.silent, `C5: nor the silent-server sentence. Got ${JSON.stringify(short(t))}`);
  assert.strictEqual(
    B.translateServiceReject(got.err),
    undefined,
    "C5: no service row may match inside the provider's text",
  );
});

// ===========================================================================
// C6 - REGRESSION. A stream with no error frame is untouched. Every one of
// these is green at the branch point and must stay green. A red row here means
// phase 4 damaged phase 3, not that the feature has not landed.
// ===========================================================================

btest("C6 [happy, both signals]: REGRESSION - a complete stream resolves with text, timings and doneReason", async () => {
  const got = await withServer(
    cleanServer(
      [
        sseFrame({ choices: [{ delta: { content: "fn add(a: i32, b: i32) -> i32 {\n" } }] }),
        sseFrame({ choices: [{ delta: { content: "    a + b\n}" } }] }),
        sseFrame({ choices: [{ delta: {}, finish_reason: "stop" }] }),
        DONE_SENTINEL,
      ],
      SSE,
    ),
    (base) => outcome(() => driveCloud(base)),
  );
  assert.strictEqual(got.ok, true, `C6: a complete stream must resolve. Got: ${got.name}: ${got.message}`);
  assert.strictEqual(got.value.text, "fn add(a: i32, b: i32) -> i32 {\n    a + b\n}");
  assert.strictEqual(got.value.doneReason, "stop");
  assert.strictEqual(typeof got.value.ttftMs, "number", "C6: ttftMs must survive");
  assert.strictEqual(typeof got.value.totalMs, "number", "C6: totalMs must survive");
});

btest("C6 [finish_reason, no DONE]: REGRESSION - phase 3's first terminal tolerance still holds", async () => {
  const got = await withServer(
    cleanServer(
      [sseFrame({ choices: [{ delta: { content: "fn add() {}" } }] }), sseFrame({ choices: [{ delta: {}, finish_reason: "length" }] })],
      SSE,
    ),
    (base) => outcome(() => driveCloud(base)),
  );
  assert.strictEqual(got.ok, true, `C6: a provider that omits [DONE] is a working provider, not a cut. Got: ${got.name}: ${got.message}`);
  assert.strictEqual(got.value.text, "fn add() {}");
  assert.strictEqual(
    got.value.doneReason,
    "length",
    "C6: the truncation reject downstream reads doneReason - it is the only thing between a reply cut at " +
      "num_predict and the user's file",
  );
});

btest("C6 [DONE, no finish_reason]: REGRESSION - phase 3's second terminal tolerance still holds", async () => {
  const got = await withServer(
    cleanServer([sseFrame({ choices: [{ delta: { content: "fn add() {}" } }] }), DONE_SENTINEL], SSE),
    (base) => outcome(() => driveCloud(base)),
  );
  assert.strictEqual(got.ok, true, `C6: a provider that sends only [DONE] is a working provider. Got: ${got.name}: ${got.message}`);
  assert.strictEqual(got.value.text, "fn add() {}");
});

btest("C6 [mid-reply cut]: REGRESSION - a genuine cut still throws the silent-server sentence", async () => {
  // Phase 3's headline behaviour, unchanged. If phase 4's error branch swallows
  // this - or if the terminal check is moved to make room for it - a half
  // function goes back to being proposed as a finished one.
  const ref = await references();
  const got = await withServer(
    cutServer(
      [sseFrame({ choices: [{ delta: { content: "fn add(a: i32, b: i32) -> i32 {\n" } }] }), sseFrame({ choices: [{ delta: { content: "    a + b" } }] })],
      SSE,
    ),
    (base) => outcome(() => driveCloud(base)),
  );
  assert.strictEqual(
    got.ok,
    false,
    `C6: two content deltas arrived and the socket closed with neither terminal signal and no error frame. ` +
      `That is still a cut. Got: RESOLVED ${JSON.stringify(got.value)}`,
  );
  assert.strictEqual(
    toast(got.err),
    ref.silent,
    `C6: and it is still the silent-server sentence, because no provider said anything about why.\n` +
      `  thrown : ${JSON.stringify(short(got.message))}\n  toast  : ${JSON.stringify(short(toast(got.err)))}`,
  );
});

btest("C6 [no error field, empty ok]: REGRESSION - a stream that finishes with no text is not an error frame", async () => {
  // The empty-generation path stays reachable and stays the service's business.
  // If the new branch fires on an ABSENT error field, this resolves-empty case
  // becomes a transport throw and the empty-generation row - which the contract
  // says is correct for what it is given - stops being reached at all.
  const got = await withServer(
    cleanServer([sseFrame({ choices: [{ delta: {}, finish_reason: "stop" }] }), DONE_SENTINEL], SSE),
    (base) => outcome(() => driveCloud(base)),
  );
  assert.strictEqual(
    got.ok,
    true,
    `C6: no error field arrived, so the transport has nothing to report; an empty generation is the ` +
      `service's reject to make. Got: ${got.name}: ${got.message}`,
  );
  assert.strictEqual(got.value.text, "");
});

// ===========================================================================
// C8 - THE INTERACTION MOST LIKELY TO BE WRONG. An error frame arriving with no
// terminal signal after it must produce the ERROR's message, not phase 3's
// silent-server sentence. The error branch throws from inside handleLine, which
// runs before the terminal check at the end of streamChat, so this should
// follow - but it is exactly the ordering that could be got backwards.
// ===========================================================================

btest("C8 [error frame, no terminal signal]: the error wins over phase 3's cut sentence", async () => {
  const ref = await references();
  const got = await withServer(cleanServer([errorFrame(PROVIDER_MSG)], SSE), (base) => outcome(() => driveCloud(base)));
  assert.strictEqual(got.ok, false, `C8: the drive must throw. Got RESOLVED ${JSON.stringify(got.value)}`);
  assert.ok(
    toast(got.err).includes(PROVIDER_MSG),
    `C8: the stream carried NO finish_reason and NO [DONE], so phase 3's terminal check would also fire ` +
      `here. The error branch runs first, inside handleLine, and its message is the one with a reason in ` +
      `it.\n  thrown : ${JSON.stringify(short(got.message))}\n  toast  : ${JSON.stringify(short(toast(got.err)))}`,
  );
  assert.notStrictEqual(
    toast(got.err),
    ref.silent,
    `C8: if the terminal check wins, the user is told to check a server that answered with a reason. ` +
      `That is this phase's whole complaint. Got: ${JSON.stringify(ref.silent)}`,
  );
});

btest("C8 [error frame then a cut]: the error still wins when the socket dies behind it", async () => {
  // The sharpest ordering case: the provider writes its reason and then the
  // connection dies. Both mechanisms have a claim; the error's is the one with
  // information in it, and it is reached first.
  const ref = await references();
  const got = await withServer(cutServer([errorFrame(PROVIDER_MSG)], SSE), (base) => outcome(() => driveCloud(base)));
  assert.strictEqual(got.ok, false, `C8: the drive must throw. Got RESOLVED ${JSON.stringify(got.value)}`);
  assert.ok(
    toast(got.err).includes(PROVIDER_MSG),
    `C8: the provider said why before the socket died, and that is what the user needs.\n` +
      `  thrown : ${JSON.stringify(short(got.message))}\n  toast  : ${JSON.stringify(short(toast(got.err)))}\n` +
      `  silent-server reference: ${JSON.stringify(ref.silent)}`,
  );
});

// ===========================================================================
// F3 - content deltas AND THEN an error frame. The error wins, and whatever
// text had arrived is not proposed.
// ===========================================================================

btest("F3 [content then error]: the error wins and the partial text is not proposed", async () => {
  const partial = "fn add(a: i32, b: i32) -> i32 {\n";
  const got = await withServer(
    cleanServer(
      [sseFrame({ choices: [{ delta: { content: partial } }] }), sseFrame({ choices: [{ delta: { content: "    a + b" } }] }), errorFrame(PROVIDER_MSG)],
      SSE,
    ),
    (base) => outcome(() => driveCloud(base)),
  );
  assert.strictEqual(
    got.ok,
    false,
    `F3: half a function plus a provider error is not a generation. Resolving here is the S57-8 defect ` +
      `with a reason attached to it. Got: RESOLVED ${JSON.stringify(got.value)}`,
  );
  assert.ok(
    toast(got.err).includes(PROVIDER_MSG),
    `F3: the error is what the user is told about.\n  toast: ${JSON.stringify(short(toast(got.err)))}`,
  );
  assert.ok(
    !got.message.includes(partial),
    `F3: the accumulated text must not be dragged into the failure message. Got ${JSON.stringify(short(got.message))}`,
  );
});

// ===========================================================================
// F7 - FORWARD GUARDS. The `error` field is typed only by us; the wire is
// untrusted. None of these five shapes may crash the reader. `ollama.ts` uses
// `String(...)` before the bound at its own in-200 error site - that is the
// precedent discipline.
//
// GREEN AT THE BRANCH POINT, and vacuously so: no error branch exists yet, so
// nothing can crash in one. These rows start earning their keep the moment the
// branch is written. Do not read a green here as evidence the phase landed.
//
// Note what is NOT asserted. The worked example on the Anthropic arm reads
// `evt.error?.message ?? evt.error?.type ?? "unknown"`, so a bare string or a
// number lands on "unknown" rather than on the value. Demanding the payload
// survive these shapes would contradict the shape this arm is told to copy, so
// only the crash claim is asserted and the outcomes are printed.
// ===========================================================================

for (const [label, field] of [
  ["error is a string", "upstream overloaded"],
  ["error is a number", 429],
  ["error is an array", [{ message: "upstream overloaded" }]],
  ["error is null", null],
  ["error is an object with no message", { type: "server_error", code: 503 }],
]) {
  btest(`F7 [${label}]: FORWARD GUARD - the reader does not crash on an untrusted error field`, async () => {
    const got = await withServer(cleanServer([sseFrame({ error: field })], SSE), (base) => outcome(() => driveCloud(base)));
    console.error("F7 [%s]: %s", label, got.ok ? `RESOLVED ${JSON.stringify(got.value)}` : `THREW ${got.name}: ${JSON.stringify(short(got.message))}`);
    if (!got.ok) {
      assert.ok(
        !["TypeError", "RangeError", "ReferenceError"].includes(got.name),
        `F7: a malformed error field must not crash the reader. Got ${got.name}: ${short(got.message)}`,
      );
      const t = toast(got.err);
      assert.ok(typeof t === "string" && t.trim() !== "", `F7: whatever happened, the user gets a sentence. Got ${JSON.stringify(t)}`);
      assert.ok(!t.includes("\n"), `F7: and it is one line. Got ${JSON.stringify(short(t))}`);
    }
  });
}
