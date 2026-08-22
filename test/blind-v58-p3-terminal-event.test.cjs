// Blind oracle, session-v58 phase 3: "the stream that ended wrong" (roadmap
// item 67, terminal-event half).
// Written BEFORE the fix, against the contract only.
//
// ===========================================================================
// WHAT THIS FILE PINS
// ===========================================================================
//
// A model server that delivers half a reply and then closes the socket without
// a terminal marker is, to two of the three fn-gen transports, indistinguishable
// from a short successful generation. Driven live on 2026-08-21 the cloud arm
// answered:
//
//     RESOLVED {"text":"fn add(a: i32, b: i32) -> i32 {\n    a + b", ...}
//
// and the local arm did the same. Both guards downstream are clear - doneReason
// is undefined so the truncation reject never fires, the text is non-empty so
// the empty reject never fires - and a half function is proposed to the user as
// a finished one. `anthropicInstruct` is the only arm that feels the cut, via
// its `sawStop` flag; this phase gives the other two the same sense.
//
// The rule, ruled in goal.md and not re-litigated by this file:
//   * CLOUD: complete when a `finish_reason` arrived OR a `[DONE]` sentinel
//     arrived. Neither is a cut. A provider that sends neither goes red, and
//     that is an ACCEPTED RISK the contract records rather than an oversight -
//     see the F5 row.
//   * LOCAL: complete when a `done: true` frame arrived. No frame is a cut.
//
// THE PLACEMENT FORK matters to what is tested here. goal.md said to put the
// local check in `generateInstruct`'s reader loop; `generateInstruct` has no
// reader loop, and the loop it tail-calls is shared with `generateFim`. The
// contract resolves it: the signal is TRACKED in the shared reader and SPENT in
// `generateInstruct` only. That is why C6 exists and why it is a REGRESSION row:
// if the guard lands on the keystroke path, FIM starts throwing on a cut and C6
// goes red. C6 is the row that says the phase landed in the wrong place.
//
// ===========================================================================
// REGRESSION ROWS - GREEN ON BOTH SIDES OF THE FIX
// ===========================================================================
//
// These are NOT weak rows and they are NOT expected to flip. They are green at
// the branch point and must stay green after the phase lands. A reader
// triaging this file should read a red one as a REGRESSION, never as "the
// feature has not landed yet":
//
//     C4 [cloud finish_reason, no DONE]      C4 [cloud DONE, no finish_reason]
//     C5 [local stop]  C5 [local length]     C5 [cloud both]  C5 [cloud length]
//     C6 [fim cut]     C6 [fim shape]        C7 [fim stopWhen]
//     C8 [local abort] C8 [cloud abort]
//     F6 [local done frame, no done_reason]
//
// ===========================================================================
// THE HARNESS REQUIREMENT THAT DECIDES WHETHER THIS FILE TESTS ANYTHING
// ===========================================================================
//
// A mid-reply cut is a socket that CLOSES after delivering content, with no
// terminal marker, and the close must still look to the client like the end of
// the body rather than a transport fault. That framing was measured before a
// single row was written, because two of the three plausible harnesses test
// something else entirely:
//
//   * `res.end()` after the frames is a CLEAN close. Node has already sent the
//     chunked terminator, so the reader ends normally. That IS a legitimate
//     shape for the cloud arm's F5 row (a provider that finishes without
//     either signal) but it is NOT the mid-reply cut.
//   * `res.destroy()` on a default Node response is a chunked body truncated
//     before its terminator. Measured here on node v24.12.0: undici rejects
//     the read with `TypeError: terminated` on ALL THREE arms - including
//     generateFim, which the contract requires to resolve. That case already
//     throws at the branch point, so a "cut" row built on it would be green
//     for the wrong reason and C6 would be red for the wrong reason.
//   * `res.useChunkedEncodingByDefault = false` plus `Connection: close`, THEN
//     `res.destroy()`. The body is framed by connection close, which is
//     legitimate HTTP, so the socket close reads as end-of-body and the reader
//     loop ends with no terminal marker and no error. Measured here, this
//     reproduces S57-8 byte for byte on both arms:
//         RESOLVED {"text":"fn add(a: i32, b: i32) -> i32 {\n    a + b", ...}
//     That is the harness this file uses for every cut row, and G2 prints both
//     framings side by side so the distinction stays on the record.
//
// The destroy itself copies the v57 fake server's `cut` scenario: write the
// frames, then `res.destroy()` on a short timer so the frames are on the wire
// before the close.
//
// ===========================================================================
// BINDINGS THE CONTRACT LEAVES OPEN, RESOLVED AND REPORTED
// ===========================================================================
//
//   * THE SENTENCE (C1/C2/C3). Never written down in this file. The reference
//     is computed at run time by driving an EXISTING silent-server throw
//     through the real translator: the cloud arm against a 204, which makes
//     fetch hand back a null body and makes the product throw its own
//     "response has no body" string. Both the throw AND the sentence therefore
//     come out of the product. This is the only way to prove C3's "no second
//     sentence was crafted" - a literal would pass even if the phase invented
//     a new one and re-worded the old.
//   * THE GESTURE ARGUMENT. Bound to "function generation" everywhere, so any
//     difference between rows is the ERROR's doing and never the gesture's.
//   * "REJECTS AS AN ABORT" (C8). Bound to the product's own predicate, copied
//     from src/vscode/firstRun.ts's `isAbort`: name === "AbortError" OR
//     /abort/i over String(err). Measured today: both arms reject with an
//     AbortError whose message is "This operation was aborted".
//   * C3's ANCHORING (C3 [index 0]). The contract says each new marker sits at
//     index 0 of its throw because the row is `anchored` and matches with
//     startsWith. Probed from outside by prefixing the message the product
//     actually threw: an anchored marker stops matching, a marker bolted on as
//     an unanchored substring row keeps matching. That is the whole difference
//     and it is visible without reading the table.
//   * C10's COUPLING (C10 [local] / C10 [cloud]). A blind file cannot re-word a
//     throw site. It can pin the equivalent: the sentence must be earned by the
//     message's own HEAD, so mutating the head loses it. Reword the throw
//     without touching the marker set and C1/C2 go red; that pair IS the
//     coupling, and C10 pins that the coupling is head-shaped rather than a
//     blanket match on some word like "stream" that a re-word would keep.
//   * C7's REACHABILITY, reported as a limitation. `stopWhen` is a parameter of
//     the shared reader, and `generateInstruct` does not accept one -
//     `generateFim` is the only caller that passes it. From outside the module
//     there is therefore no way to drive an instruct-path stream that ends by
//     `stopWhen`, so C7 is exercised through `generateFim`, where it overlaps
//     C6. The contract anticipates this ("C6 covers it") and asks for the
//     explicit `stopped` read anyway; that half is the implementer's structural
//     row, not this file's.
//   * C5's "THE TRUNCATION REJECT STILL FIRES". Bound to `doneReason` arriving
//     at the caller as "length" on both arms. The reject itself lives in the
//     fn-gen service and is already pinned elsewhere; what this phase could
//     break is the field reaching it, so that is what is measured.
//   * THE LOCAL CLEAN-END ROW (C1 [local clean-end]). The local rule is "the
//     loop ended without a done: true frame", which a clean `res.end()` after
//     content frames also satisfies. Not spelled out as its own falsifier, so
//     it is filed under C1 and reported here as an inference from the rule's
//     wording rather than from a listed falsifier.
//
// ===========================================================================
// EXPECTED AT THE BRANCH POINT (measured, not predicted)
// ===========================================================================
//
//   RED   C1 [local], C1 [local clean-end], C2 [cloud], C9 [S57-8]:
//         all four RESOLVE today with the partial text.
//   RED   C3 [both new throws], C3 [index 0], C10 [local], C10 [cloud]:
//         no throw exists yet, so there is no message to translate or anchor.
//   RED   F5 [cloud neither, clean end]: resolves today.
//   GREEN everything in the REGRESSION list above, plus G1/G2/C3 [reference
//         shape], which describe machinery that already exists.
//
// Run: node --test test/blind-v58-p3-terminal-event.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const path = require("node:path");
const fs = require("node:fs");
const esbuild = require("esbuild");

// ---------------------------------------------------------------------------
// The vscode stub: blind-v57-p4's stub, unchanged. Only generationFailedToast
// is needed and it is a pure string function, but the module graph behind
// src/vscode/fnGen.ts touches most of the vscode API at import time, so the
// precedent stub is reused verbatim rather than trimmed.
// ---------------------------------------------------------------------------

const STUB = path.join(__dirname, ".blind-v58-p3-stub.cjs");
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

const ENTRY = path.join(__dirname, ".blind-v58-p3.entry.ts");
const OUTFILE = path.join(__dirname, ".blind-v58-p3.bundle.cjs");
let B = {};
let bundleErr;
try {
  fs.writeFileSync(
    ENTRY,
    `export { generateInstruct, generateFim } from "../src/core/ollama";\n` +
      `export { makeCloudInstruct } from "../src/core/cloudInstruct";\n` +
      `export { generationFailedToast } from "../src/vscode/fnGen";\n`,
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

const ND = "application/x-ndjson";
const SSE = "text/event-stream";
const nd = (o) => `${JSON.stringify(o)}\n`;
const sseFrame = (o) => `data: ${JSON.stringify(o)}\n\n`;
const DONE_SENTINEL = "data: [DONE]\n\n";

/** Sockets are tracked and destroyed on close: several rows leave a response
 *  hanging on purpose (the abort rows), and server.close() waits forever on an
 *  open connection. */
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

/** THE MID-REPLY CUT. Connection-close framing, so the socket close reads as
 *  end-of-body rather than a truncated chunked body, then res.destroy() the way
 *  the v57 fake server's `cut` scenario does it. See the harness note
 *  in the header: this framing is what makes the row test the contract's case
 *  instead of undici's `terminated`. */
const cutServer = (frames, ctype) => (_req, res) => {
  res.useChunkedEncodingByDefault = false;
  res.shouldKeepAlive = false;
  res.writeHead(200, { "content-type": ctype, connection: "close" });
  for (const f of frames) res.write(f);
  setTimeout(() => res.destroy(), 150);
};

/** The SAME frames over default chunked framing, destroyed before the
 *  terminator. Used only by the G2 probe, to keep the difference on the record.
 *  This is a transport fault, not the case under test. */
const chunkedCutServer = (frames, ctype) => (_req, res) => {
  res.writeHead(200, { "content-type": ctype });
  for (const f of frames) res.write(f);
  setTimeout(() => res.destroy(), 150);
};

/** A clean, complete HTTP response carrying exactly these frames. */
const cleanServer = (frames, ctype) => (_req, res) => {
  res.writeHead(200, { "content-type": ctype });
  for (const f of frames) res.write(f);
  res.end();
};

/** Frames, then silence forever. The abort rows cancel into this. */
const hangServer = (frames, ctype) => (_req, res) => {
  res.writeHead(200, { "content-type": ctype });
  for (const f of frames) res.write(f);
};

/** 204: the only clean way to make fetch() hand back a null body on a 2xx, and
 *  therefore the way to make a transport throw its EXISTING silent-server
 *  string without this file writing that string down. */
const noBodyServer = () => (_req, res) => {
  res.writeHead(204, {});
  res.end();
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
// Drives. The three product entry points, plus an outcome record so a row can
// assert on "resolved with X" and "rejected with Y" through one shape.
// ---------------------------------------------------------------------------

const GESTURE = "function generation";

const instructParams = (base, signal) => ({
  apiBase: base,
  model: "test-model",
  prompt: "write a function that adds two integers",
  maxTokens: 256,
  temperature: 0,
  signal: signal ?? new AbortController().signal,
});

const driveLocal = (base, signal) => B.generateInstruct(instructParams(base, signal));

const driveCloud = (base, signal) =>
  B.makeCloudInstruct({ baseUrl: base, apiKey: "test-key" })(instructParams(base, signal));

const driveFim = (base, extra = {}) =>
  B.generateFim({
    apiBase: base,
    model: "test-model",
    prefix: "fn add(a: i32, b: i32) -> i32 {",
    suffix: "}",
    maxTokens: 256,
    temperature: 0,
    signal: new AbortController().signal,
    ...extra,
  });

async function outcome(fn) {
  try {
    return { ok: true, value: await fn() };
  } catch (err) {
    return { ok: false, err, name: err instanceof Error ? err.name : "", message: err instanceof Error ? err.message : String(err) };
  }
}

const toast = (err) => B.generationFailedToast(err, GESTURE);

// The product's own abort predicate, copied from src/vscode/firstRun.ts.
const isAbort = (err) => (err instanceof Error && err.name === "AbortError") || /abort/i.test(String(err));

const short = (s) => (typeof s === "string" && s.length > 200 ? `${s.slice(0, 200)}... (${s.length} chars)` : s);

// The S57-8 recording, verbatim. The only place in this file where a product
// STRING is written down, and it is written down because C9 is defined as "this
// exact output must stop happening".
const HALF_FUNCTION = "fn add(a: i32, b: i32) -> i32 {\n    a + b";
const CUT_FRAME_1 = "fn add(a: i32, b: i32) -> i32 {\n";
const CUT_FRAME_2 = "    a + b";

const LOCAL_CUT_FRAMES = [nd({ response: CUT_FRAME_1 }), nd({ response: CUT_FRAME_2 })];
const CLOUD_CUT_FRAMES = [
  sseFrame({ choices: [{ delta: { content: CUT_FRAME_1 } }] }),
  sseFrame({ choices: [{ delta: { content: CUT_FRAME_2 } }] }),
];

// ---------------------------------------------------------------------------
// THE REFERENCE SENTENCE. Driven out of the product once, cached. See the
// binding note in the header: both the throw and the sentence come from the
// product, so this file cannot go stale on a re-wording, only re-baseline.
// ---------------------------------------------------------------------------

let referenceCache;
async function reference() {
  if (referenceCache === undefined) {
    const got = await withServer(noBodyServer(), (base) => outcome(() => driveCloud(base)));
    assert.strictEqual(
      got.ok,
      false,
      "harness: a 204 must make the cloud transport throw its existing silent-server string; " +
        `it resolved with ${JSON.stringify(got.value)} instead, so the reference cannot be read out of the product`,
    );
    referenceCache = { sentence: toast(got.err), thrown: got.message };
  }
  return referenceCache;
}

// ===========================================================================
// G - HARNESS GUARDS. If either is red, every verdict below is suspect.
// ===========================================================================

test("G1 [harness]: the bundle builds headless and exports the three drives plus the translator", () => {
  if (bundleErr) assert.fail(`bundle failed to build: ${bundleErr.stack || bundleErr.message}`);
  for (const name of ["generateInstruct", "generateFim", "makeCloudInstruct", "generationFailedToast"]) {
    assert.strictEqual(typeof B[name], "function", `${name} must be exported for this file to drive it`);
  }
});

btest("G2 [harness]: the cut server delivers its frames before closing, and is not a clean close", async () => {
  // POSITIVE CONTROL. If the frames did not reach the client the cut rows would
  // be testing an empty stream, and "it threw" would prove nothing about a
  // mid-reply cut. generateFim is used because it must resolve on BOTH sides of
  // the fix, so this control is stable across the phase.
  const got = await withServer(cutServer(LOCAL_CUT_FRAMES, ND), (base) => outcome(() => driveFim(base)));
  assert.strictEqual(got.ok, true, `harness: the cut server must deliver a partial reply, got a throw: ${got.message}`);
  assert.strictEqual(
    got.value.text,
    HALF_FUNCTION,
    "harness: both content frames must arrive before the socket closes, otherwise the cut rows are " +
      "measuring a truncated delivery rather than a missing terminal marker",
  );

  // THE FRAMING DISTINCTION, printed rather than asserted. A chunked body
  // destroyed before its terminator is a transport fault that already throws;
  // it is NOT the case this contract is about.
  const chunked = await withServer(chunkedCutServer(LOCAL_CUT_FRAMES, ND), (base) => outcome(() => driveFim(base)));
  console.error("\n=== G2: framing probe (generateFim against two content frames then a socket close) ===");
  console.error("connection-close framing (THE CASE UNDER TEST): %s", got.ok ? `RESOLVED ${JSON.stringify(got.value)}` : `THREW ${got.name}: ${got.message}`);
  console.error("chunked framing (a transport fault, not this case): %s", chunked.ok ? `RESOLVED ${JSON.stringify(chunked.value)}` : `THREW ${chunked.name}: ${chunked.message}`);
  console.error("=== end G2 ===\n");
});

// ===========================================================================
// P0 - the probe table. Asserts nothing; prints what every arm does today so a
// reader can see which rows flipped and which never moved.
// ===========================================================================

btest("P0 [probe]: what each arm does with a mid-reply cut, and what the user would be told", async () => {
  const ref = await reference();
  const rows = [
    ["local  generateInstruct", () => withServer(cutServer(LOCAL_CUT_FRAMES, ND), (b) => outcome(() => driveLocal(b)))],
    ["cloud  streamChat", () => withServer(cutServer(CLOUD_CUT_FRAMES, SSE), (b) => outcome(() => driveCloud(b)))],
    ["fim    generateFim", () => withServer(cutServer(LOCAL_CUT_FRAMES, ND), (b) => outcome(() => driveFim(b)))],
  ];
  console.error("\n=== P0 table: mid-reply cut, two content frames then res.destroy() ===");
  console.error("reference throw   : %j", ref.thrown);
  console.error("reference sentence: %j", ref.sentence);
  console.error("---");
  for (const [label, run] of rows) {
    const got = await run();
    console.error("arm     : %s", label);
    if (got.ok) {
      console.error("outcome : RESOLVED %j", got.value);
    } else {
      console.error("outcome : THREW %s %j", got.name, short(got.message));
      console.error("toast   : %j", toast(got.err));
      console.error("== ref  : %s", toast(got.err) === ref.sentence);
    }
    console.error("---");
  }
  console.error("=== end P0 table ===\n");
});

// ===========================================================================
// C1 - a mid-reply cut on the LOCAL arm throws, and the toast is the class's
// own sentence. RED at the branch point: it resolves with the half function.
// ===========================================================================

btest("C1 [local]: generateInstruct against a mid-reply cut rejects with the silent-server sentence", async () => {
  const ref = await reference();
  const got = await withServer(cutServer(LOCAL_CUT_FRAMES, ND), (base) => outcome(() => driveLocal(base)));
  assert.strictEqual(
    got.ok,
    false,
    `C1: the local arm delivered two content frames and then the socket closed with no done:true frame. ` +
      `That is a cut, not a generation, and it must not resolve. Got: RESOLVED ${JSON.stringify(got.value)}`,
  );
  assert.ok(
    !isAbort(got.err),
    `C1: a server that went silent is not a cancellation - C8 depends on those staying distinct. Got: ${got.name}: ${got.message}`,
  );
  assert.strictEqual(
    toast(got.err),
    ref.sentence,
    `C1 + C3: the rejection must reach the user as the sentence this class already owns.\n` +
      `  thrown   : ${JSON.stringify(short(got.message))}\n` +
      `  toast    : ${JSON.stringify(toast(got.err))}\n` +
      `  reference: ${JSON.stringify(ref.sentence)}  (read out of the product, from ${JSON.stringify(ref.thrown)})`,
  );
});

btest("C1 [local clean-end]: a local stream that ends cleanly with no done:true frame is also a cut", async () => {
  // Inferred from the rule's wording ("the loop ended without a done: true
  // frame"), not from a listed falsifier - see the header binding. A server
  // that closes tidily without ever saying it finished has told the client
  // nothing about whether the reply is whole.
  const ref = await reference();
  const got = await withServer(cleanServer([nd({ response: CUT_FRAME_1 }), nd({ response: CUT_FRAME_2 })], ND), (base) =>
    outcome(() => driveLocal(base)),
  );
  assert.strictEqual(
    got.ok,
    false,
    `C1: no done:true frame ever arrived, so nothing said the reply was whole. Got: RESOLVED ${JSON.stringify(got.value)}`,
  );
  assert.strictEqual(toast(got.err), ref.sentence, `C1: same class, same sentence. Got: ${JSON.stringify(toast(got.err))}`);
});

// ===========================================================================
// C2 / C9 - the cloud arm. C9 is S57-8's exact reproduction.
// ===========================================================================

btest("C2 [cloud]: streamChat against a mid-reply cut rejects with the silent-server sentence", async () => {
  const ref = await reference();
  const got = await withServer(cutServer(CLOUD_CUT_FRAMES, SSE), (base) => outcome(() => driveCloud(base)));
  assert.strictEqual(
    got.ok,
    false,
    `C2: two content deltas arrived and then the socket closed with neither a finish_reason nor a [DONE]. ` +
      `Got: RESOLVED ${JSON.stringify(got.value)}`,
  );
  assert.ok(
    !isAbort(got.err),
    `C2: a silent server is not a cancellation. Got: ${got.name}: ${got.message}`,
  );
  assert.strictEqual(
    toast(got.err),
    ref.sentence,
    `C2 + C3: the cloud cut must speak the same sentence as every other silent server.\n` +
      `  thrown   : ${JSON.stringify(short(got.message))}\n` +
      `  toast    : ${JSON.stringify(toast(got.err))}\n` +
      `  reference: ${JSON.stringify(ref.sentence)}`,
  );
});

btest("C9 [S57-8]: the recorded half function is unreproducible", async () => {
  const got = await withServer(cutServer(CLOUD_CUT_FRAMES, SSE), (base) => outcome(() => driveCloud(base)));
  if (got.ok) {
    assert.notStrictEqual(
      got.value.text,
      HALF_FUNCTION,
      "C9: this is the S57-8 drive, byte for byte. The recorded output was\n" +
        `  RESOLVED {"text":${JSON.stringify(HALF_FUNCTION)}, ...}\n` +
        "and it is the row that closes roadmap item 67: a function body ending in the middle of an " +
        "expression, with no closing brace, handed to the user as a finished generation. Both service " +
        `guards clear it (doneReason=${JSON.stringify(got.value.doneReason)}, text non-empty), so nothing ` +
        "downstream can catch it.",
    );
    assert.fail(
      `C9: the drive must not resolve at all. Got: RESOLVED ${JSON.stringify(got.value)}`,
    );
  }
});

// ===========================================================================
// C3 - one sentence, and it is anchored at index 0.
// ===========================================================================

btest("C3 [reference shape]: the existing silent-server sentence is one non-empty line of plain English", async () => {
  // A guard on C1/C2/C3: if the reference were "" or multi-line, every equality
  // above could be satisfied by a fix that made all arms equally useless.
  const ref = await reference();
  assert.ok(typeof ref.sentence === "string" && ref.sentence.trim() !== "", `the reference must exist. Got ${JSON.stringify(ref.sentence)}`);
  assert.ok(!ref.sentence.includes("\n"), `a notification is one line. Got ${JSON.stringify(ref.sentence)}`);
  assert.ok(ref.sentence.length > 20, `the sentence must name what happened and what to do. Got ${JSON.stringify(ref.sentence)}`);
  for (const banned of ["finish_reason", "[DONE]", "done_reason", "message_stop", "no body", "Error:"]) {
    assert.ok(!ref.sentence.includes(banned), `API vocabulary reached the screen: ${JSON.stringify(banned)} in ${JSON.stringify(ref.sentence)}`);
  }
});

btest("C3 [one sentence]: both new throws map onto the EXISTING row, not onto a second sentence", async () => {
  const ref = await reference();
  const arms = [
    ["local", cutServer(LOCAL_CUT_FRAMES, ND), driveLocal],
    ["cloud", cutServer(CLOUD_CUT_FRAMES, SSE), driveCloud],
  ];
  for (const [label, handler, drive] of arms) {
    const got = await withServer(handler, (base) => outcome(() => drive(base)));
    assert.strictEqual(got.ok, false, `C3: the ${label} arm must throw before its sentence can be checked`);
    assert.strictEqual(
      toast(got.err),
      ref.sentence,
      `C3: "No second sentence is crafted for the same event." The ${label} arm's cut must produce the ` +
        `SAME string as the silent-server throw the product already owns.\n` +
        `  got      : ${JSON.stringify(toast(got.err))}\n` +
        `  reference: ${JSON.stringify(ref.sentence)}`,
    );
  }
});

btest("C3 [index 0]: each new marker is ANCHORED - prefixing the thrown message loses the sentence", async () => {
  // The contract: "Each new marker sits at index 0 of its throw string, because
  // that row is `anchored` and matches with `startsWith`." From outside, the
  // difference between an anchored marker and one bolted on as a substring row
  // is exactly this: put anything in front of the message and the anchored
  // match stops, the substring match does not. A substring marker is forgeable
  // by a server whose error text happens to contain it, which is the defect the
  // anchored row was introduced to close.
  const ref = await reference();
  const arms = [
    ["local", cutServer(LOCAL_CUT_FRAMES, ND), driveLocal],
    ["cloud", cutServer(CLOUD_CUT_FRAMES, SSE), driveCloud],
  ];
  for (const [label, handler, drive] of arms) {
    const got = await withServer(handler, (base) => outcome(() => drive(base)));
    assert.strictEqual(got.ok, false, `C3 [index 0]: the ${label} arm must throw first`);
    assert.strictEqual(toast(got.err), ref.sentence, `C3 [index 0]: precondition - the ${label} arm's own message must earn the sentence`);
    for (const prefix of ["Warning: ", "the server said: ", "x"]) {
      const moved = toast(new Error(prefix + got.message));
      assert.notStrictEqual(
        moved,
        ref.sentence,
        `C3 [index 0]: the ${label} arm's marker must match with startsWith, so a message that merely ` +
          `CONTAINS it must not draw the sentence. Prefixed with ${JSON.stringify(prefix)} it still did, ` +
          `which means the marker was added as an unanchored substring row.`,
      );
    }
  }
});

// ===========================================================================
// C10 - coupling. A blind file cannot re-word a throw site; it can pin that the
// sentence is earned by the message's own HEAD, so a re-word loses it. Together
// with C1/C2 (which go red on a re-word that does not update the table) that is
// falsifier 11 from outside.
// ===========================================================================

for (const [label, mkHandler, drive] of [
  ["local", () => cutServer(LOCAL_CUT_FRAMES, ND), (b) => driveLocal(b)],
  ["cloud", () => cutServer(CLOUD_CUT_FRAMES, SSE), (b) => driveCloud(b)],
]) {
  btest(`C10 [${label}]: the sentence is coupled to the throw's head, not to some word inside it`, async () => {
    const ref = await reference();
    const got = await withServer(mkHandler(), (base) => outcome(() => drive(base)));
    assert.strictEqual(got.ok, false, `C10: the ${label} arm must throw first`);
    assert.strictEqual(toast(got.err), ref.sentence, `C10: precondition - the real message earns the sentence`);
    // Cut the head off. Whatever the marker is, it started at index 0, so this
    // message no longer carries it. If the sentence survives, the match is on
    // something loose in the middle and a re-worded head would keep drawing it -
    // which is a coupling row that can never go red.
    const beheaded = got.message.slice(4);
    assert.notStrictEqual(
      toast(new Error(beheaded)),
      ref.sentence,
      `C10: removing the first four characters of ${JSON.stringify(short(got.message))} must break the ` +
        "match. It did not, so the marker is not the head and the coupling comment at the throw site " +
        "guards nothing.",
    );
  });
}

// ===========================================================================
// C4 - REGRESSION. Both cloud tolerances survive. These are the working
// providers the terminal rule exists to keep, and both are green on both sides.
// ===========================================================================

btest("C4 [cloud finish_reason, no DONE]: REGRESSION - resolves", async () => {
  const got = await withServer(
    cleanServer([sseFrame({ choices: [{ delta: { content: "fn add() {}" } }] }), sseFrame({ choices: [{ delta: {}, finish_reason: "stop" }] })], SSE),
    (base) => outcome(() => driveCloud(base)),
  );
  assert.strictEqual(got.ok, true, `C4: a provider that omits [DONE] is a working provider, not a cut. Got: ${got.name}: ${got.message}`);
  assert.strictEqual(got.value.text, "fn add() {}");
  assert.strictEqual(got.value.doneReason, "stop");
});

btest("C4 [cloud DONE, no finish_reason]: REGRESSION - resolves", async () => {
  const got = await withServer(
    cleanServer([sseFrame({ choices: [{ delta: { content: "fn add() {}" } }] }), DONE_SENTINEL], SSE),
    (base) => outcome(() => driveCloud(base)),
  );
  assert.strictEqual(got.ok, true, `C4: a provider that sends only [DONE] is a working provider. Got: ${got.name}: ${got.message}`);
  assert.strictEqual(got.value.text, "fn add() {}");
});

// ===========================================================================
// C5 - REGRESSION. The happy paths, with the truncation signal intact on both
// arms. The truncation reject downstream reads doneReason; if this phase drops
// it, a reply cut at num_predict lands in the user's file.
// ===========================================================================

for (const [label, reason] of [
  ["stop", "stop"],
  ["length", "length"],
]) {
  btest(`C5 [local ${label}]: REGRESSION - a complete local stream resolves with text, timings and doneReason`, async () => {
    const got = await withServer(
      cleanServer([nd({ response: "fn add(a: i32, b: i32) -> i32 {\n" }), nd({ response: "    a + b\n}" }), nd({ done: true, done_reason: reason })], ND),
      (base) => outcome(() => driveLocal(base)),
    );
    assert.strictEqual(got.ok, true, `C5: a complete stream must resolve. Got: ${got.name}: ${got.message}`);
    assert.strictEqual(got.value.text, "fn add(a: i32, b: i32) -> i32 {\n    a + b\n}");
    assert.strictEqual(
      got.value.doneReason,
      reason,
      `C5: done_reason must still reach the caller - the fn-gen service's truncation reject is the only ` +
        "thing standing between a reply cut at num_predict and the user's file",
    );
    assert.strictEqual(typeof got.value.ttftMs, "number", "C5: ttftMs must survive");
    assert.strictEqual(typeof got.value.totalMs, "number", "C5: totalMs must survive");
    assert.ok(got.value.ttftMs <= got.value.totalMs, "C5: ttft can never be later than total");
  });

  btest(`C5 [cloud ${label}]: REGRESSION - a complete cloud stream with both signals resolves`, async () => {
    const got = await withServer(
      cleanServer(
        [
          sseFrame({ choices: [{ delta: { content: "fn add(a: i32, b: i32) -> i32 {\n" } }] }),
          sseFrame({ choices: [{ delta: { content: "    a + b\n}" } }] }),
          sseFrame({ choices: [{ delta: {}, finish_reason: reason }] }),
          DONE_SENTINEL,
        ],
        SSE,
      ),
      (base) => outcome(() => driveCloud(base)),
    );
    assert.strictEqual(got.ok, true, `C5: a complete stream must resolve. Got: ${got.name}: ${got.message}`);
    assert.strictEqual(got.value.text, "fn add(a: i32, b: i32) -> i32 {\n    a + b\n}");
    assert.strictEqual(got.value.doneReason, reason, "C5: finish_reason must still reach the caller as doneReason");
    assert.strictEqual(typeof got.value.ttftMs, "number", "C5: ttftMs must survive");
    assert.strictEqual(typeof got.value.totalMs, "number", "C5: totalMs must survive");
  });
}

// ===========================================================================
// C6 - THE PLACEMENT ROW, and a REGRESSION. If either of these goes red the
// guard landed in the shared reader instead of in generateInstruct, the
// keystroke path started throwing on a cut, and the phase is wrong. This is not
// a weak row: it is the reason the contract overrode goal.md.
// ===========================================================================

btest("C6 [fim cut]: REGRESSION - generateFim against a mid-reply cut still resolves with the partial text", async () => {
  const got = await withServer(cutServer(LOCAL_CUT_FRAMES, ND), (base) => outcome(() => driveFim(base)));
  assert.strictEqual(
    got.ok,
    true,
    `C6: FIM is the per-keystroke path. A partial infill is a usable suggestion, and the terminal-event ` +
      `check lands on the INSTRUCT path only. A throw here means the guard was placed in the shared ` +
      `reader. Got: ${got.name}: ${got.message}`,
  );
  assert.strictEqual(
    got.value.text,
    HALF_FUNCTION,
    "C6: byte-identical to the branch point - whatever text arrived, in full",
  );
});

btest("C6 [fim shape]: REGRESSION - a happy-path FIM result carries exactly the fields it always did", async () => {
  // The contract's mechanism gives the shared reader's result a new `sawDone`
  // field. generateFim must not grow one: "its behaviour does not change by one
  // byte". A leaked field is how a caller downstream starts branching on the
  // instruct path's business inside the keystroke path.
  const got = await withServer(
    cleanServer([nd({ response: "return a + b;" }), nd({ done: true, done_reason: "stop" })], ND),
    (base) => outcome(() => driveFim(base)),
  );
  assert.strictEqual(got.ok, true, `C6: a complete FIM stream must resolve. Got: ${got.name}: ${got.message}`);
  assert.deepStrictEqual(
    Object.keys(got.value).sort(),
    ["text", "totalMs", "ttftMs"],
    `C6: the FIM result shape is unchanged. Got: ${JSON.stringify(got.value)}`,
  );
});

// ===========================================================================
// C7 - REGRESSION. A stream ended by stopWhen has no done frame by
// construction, and must not be read as a cut. See the reachability limitation
// in the header: generateFim is the only caller that can pass stopWhen, so from
// outside this row overlaps C6.
// ===========================================================================

btest("C7 [fim stopWhen]: REGRESSION - a stream the bound ended is not a cut", async () => {
  const got = await withServer(
    // The server never finishes: only stopWhen can end this read, so there is
    // no done frame anywhere in the drive.
    hangServer([nd({ response: "return a + b;\n" }), nd({ response: "// more text nobody wants\n" })], ND),
    (base) => outcome(() => driveFim(base, { stopWhen: (t) => t.includes("\n") })),
  );
  assert.strictEqual(got.ok, true, `C7: stopWhen ends the read cleanly - no throw. Got: ${got.name}: ${got.message}`);
  assert.strictEqual(got.value.stopped, true, "C7: the caller must still be told the bound ended it");
  assert.strictEqual(got.value.text, "return a + b;\n", "C7: the text read so far, unchanged");
});

// ===========================================================================
// C8 - REGRESSION. Cancellation stays a distinct outcome from failure. Phase 5
// depends on this: a cancelled generation must never tell the user to go check
// a server that is perfectly healthy.
// ===========================================================================

for (const [label, frames, ctype, drive] of [
  ["local", [nd({ response: CUT_FRAME_1 })], ND, driveLocal],
  ["cloud", [sseFrame({ choices: [{ delta: { content: CUT_FRAME_1 } }] })], SSE, driveCloud],
]) {
  btest(`C8 [${label} abort]: REGRESSION - an aborted generation rejects as an abort, not as a silent server`, async () => {
    const ref = await reference();
    const ac = new AbortController();
    const got = await withServer(hangServer(frames, ctype), (base) => {
      setTimeout(() => ac.abort(), 120);
      return outcome(() => drive(base, ac.signal));
    });
    assert.strictEqual(got.ok, false, `C8: an aborted generation must reject. Got: RESOLVED ${JSON.stringify(got.value)}`);
    assert.ok(
      isAbort(got.err),
      `C8: the rejection must still read as a cancellation to the product's own isAbort. Got: ${got.name}: ${got.message}`,
    );
    assert.notStrictEqual(
      toast(got.err),
      ref.sentence,
      `C8: "Cancellation is a different outcome from failure." The user pressed cancel; telling them the ` +
        `server went silent is a false diagnosis and it is the wrong remedy. Got: ${JSON.stringify(toast(got.err))}`,
    );
  });
}

// ===========================================================================
// F5 - THE ACCEPTED RISK, pinned so it is a decision rather than an accident.
//
// The cloud terminal rule turns a provider that sends NEITHER a finish_reason
// NOR a [DONE] into a failure, even when it closed the connection tidily and
// text arrived. The contract accepts this: nothing in this repo has watched a
// real cloud endpoint finish a stream, S57-8's warning stands, and the session
// close hands the human a real-endpoint drive as the thing that would witness
// it. If a real provider is later found in this shape, THIS row is the one that
// gets re-cut, and the re-cut is a decision someone makes on purpose.
// ===========================================================================

btest("F5 [cloud neither, clean end]: rejects - the ACCEPTED RISK, recorded", async () => {
  const ref = await reference();
  const got = await withServer(
    cleanServer([sseFrame({ choices: [{ delta: { content: "fn add() {}" } }] })], SSE),
    (base) => outcome(() => driveCloud(base)),
  );
  assert.strictEqual(
    got.ok,
    false,
    `F5: the stream ended with neither signal. Under the terminal rule that is a cut, whether or not the ` +
      `close was tidy and whether or not text arrived. Got: RESOLVED ${JSON.stringify(got.value)}`,
  );
  assert.strictEqual(toast(got.err), ref.sentence, "F5: and it is the same class, so the same sentence");
});

// ===========================================================================
// F6 - THE SHARP ONE. A guard written as `doneReason === undefined` passes
// every other row in this file and fails only this one.
//
// handleLine sets doneReason from the frame's done_reason field, and a server
// that sends {"done":true} with no done_reason leaves it undefined. That server
// finished. doneReason answers "what did the model say about finishing";
// sawDone answers "did the frame arrive". Only the second one is the question.
// ===========================================================================

btest("F6 [local done frame, no done_reason]: resolves, with doneReason undefined", async () => {
  const got = await withServer(
    cleanServer([nd({ response: "fn add() {}" }), nd({ done: true })], ND),
    (base) => outcome(() => driveLocal(base)),
  );
  assert.strictEqual(
    got.ok,
    true,
    `F6: the done frame ARRIVED. A guard that reads doneReason instead of the frame calls this a cut and ` +
      `throws away a complete generation from any server that omits done_reason. Got: ${got.name}: ${got.message}`,
  );
  assert.strictEqual(got.value.text, "fn add() {}");
  assert.strictEqual(
    got.value.doneReason,
    undefined,
    "F6: and the field stays undefined - the fix must not invent a done_reason to satisfy its own guard, " +
      "because 'length' is the only value the truncation reject may ever see and inventing 'stop' would " +
      "hide a real truncation",
  );
});
