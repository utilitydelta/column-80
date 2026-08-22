// Implementer oracle, session-v59 phase 1 repair: the cause is shared, the
// consequence is the surface's own.
//
// THREE DEFECTS, all found by the phase 1 adversarial review.
//
// D1 - the ride-along cut lands inside a parenthesis. Five of the six discard
//      reasons are product prose; the sixth interpolates `String(err)`. Phase 1
//      wrapped the WHOLE sentence in `firstLine`, so the cut fell between the
//      brackets and glued the period to a truncated clause:
//        "...the preview could not be opened (Error: the diff editor is gone."
//      Second half of the same defect: the dropped tail reached NOWHERE.
//      `logOutcome("discarded")` never received the reason, so the cut
//      destroyed the only copy and a channel pointer would have been a promise
//      with nothing behind it.
//
// D2 - the tighten toast says "nothing was written" in the notification
//      announcing the write. The gesture does not stop at the warn: it goes on
//      through the delta and existence gates and applies the re-wrap. The
//      download toast has the same shape of lie in its other half - it tells a
//      user who clicked Download to "run the gesture again".
//
// D3 - "typed status only" is not what the code did. `firstRun.ts` passed the
//      WHOLE translator gated on `err instanceof HttpStatusError`, so an
//      UNCLASSIFIED status fell through to the anchored, payload-carrier and
//      substring passes. A 404 whose message carried a generation reject's
//      marker drew that reject's sentence on a download toast.
//
// THE RULING D2 IMPLEMENTS. Every status sentence has the shape
//   `Column 80: <CAUSE>, so nothing was written - <REMEDY>. <pointer>`
// The CAUSE is surface-independent and true everywhere. The consequence and the
// remedy are not. They split: one throw class still produces one DIAGNOSIS on
// every surface, and only the consequence half varies.
//
// THE HARD CONSTRAINT. The generation gesture's four class sentences stay BYTE
// IDENTICAL. Row F1 types them out so a drift cannot pass.
//
// ROWS
//   H1  the bundle builds and every driver is reachable
//   F1  the four generation sentences are byte-identical to before the split
//   D1a a multi-line discard reason never renders an unclosed bracket
//   D1b the reason the toast dropped reaches the channel, so the pointer is true
//   D1c control - a single-line reason is byte-identical to today's
//   D2a the tighten warning does not claim nothing was written
//   D2b the tighten warning still carries the class DIAGNOSIS and its clause
//   D2c the download toast does not tell a Download click to run the gesture
//   D2d the download toast still carries the class DIAGNOSIS
//   D3a a typed but unclassified status draws no crafted sentence on a download
//
// Run: node --test test/impl-v59-p1fix-surface-consequence.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const fs = require("node:fs");
const esbuild = require("esbuild");

// ---------------------------------------------------------------------------
// Harness. One vscode stub, EXTERNAL to the bundle so this file and the product
// share one `__state`. Same stub the phase 1 implementer file drives.
// ---------------------------------------------------------------------------

const STUB = path.join(__dirname, ".impl-v59-p1fix-stub.cjs");
fs.writeFileSync(
  STUB,
  `
const state = { config: {}, messages: [], commands: {}, appliedEdits: [], infoResponses: [], diffThrows: undefined };
class Position {
  constructor(line, character) { this.line = line; this.character = character; }
  translate(l = 0, c = 0) { return new Position(this.line + l, this.character + c); }
}
class Range {
  constructor(a, b, c, d) {
    if (typeof a === "number") { this.start = new Position(a, b); this.end = new Position(c, d); }
    else { this.start = a; this.end = b; }
  }
}
class WorkspaceEdit {
  constructor() { this._entries = []; }
  replace(uri, range, text) { this._entries.push([uri, [{ range, newText: text }]]); }
  entries() { return this._entries; }
}
class EventEmitter {
  constructor() { this.handlers = []; }
  get event() { return (fn) => { this.handlers.push(fn); return { dispose() {} }; }; }
  fire(x) { for (const h of this.handlers) h(x); }
  dispose() {}
}
class ThemeColor { constructor(id) { this.id = id; } }
class MarkdownString { constructor() {} appendCodeblock() {} appendMarkdown() {} appendText() {} }
class Diagnostic { constructor(range, message, severity) { this.range = range; this.message = message; this.severity = severity; } }
class TabInputTextDiff { constructor(original, modified) { this.original = original; this.modified = modified; } }
const Uri = {
  file: (p) => ({ fsPath: p, path: p, scheme: "file", toString: () => "file://" + p, with() { return this; } }),
  from: (parts) => ({ ...parts, fsPath: parts.path, toString: () => parts.scheme + "://" + parts.path + "?" + (parts.query || "") }),
  parse: (s) => { const p = String(s).replace(/^file:\\/\\//, ""); return { raw: s, fsPath: p, path: p, scheme: "file", toString: () => String(s), with() { return this; } }; },
  joinPath: (base, ...segs) => Uri.file([base.fsPath, ...segs].join("/")),
};
module.exports = {
  __state: state,
  Position, Range, WorkspaceEdit, EventEmitter, ThemeColor, MarkdownString, Diagnostic, TabInputTextDiff, Uri,
  EndOfLine: { LF: 1, CRLF: 2 },
  DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
  SymbolKind: { File: 0, Module: 1, Namespace: 2, Package: 3, Class: 4, Method: 5, Property: 6,
    Field: 7, Constructor: 8, Enum: 9, Interface: 10, Function: 11, Variable: 12, Constant: 13,
    String: 14, Number: 15, Boolean: 16, Array: 17, Object: 18, Key: 19, Null: 20, EnumMember: 21,
    Struct: 22, Event: 23, Operator: 24, TypeParameter: 25 },
  CompletionItemKind: { Method: 1, Function: 2, Field: 4, Variable: 5, Class: 6, Property: 9, Enum: 12, Constant: 20, Struct: 21 },
  ProgressLocation: { Notification: 15, Window: 10 },
  ConfigurationTarget: { Global: 1, Workspace: 2 },
  OverviewRulerLane: { Left: 1, Center: 2, Right: 4, Full: 7 },
  workspace: {
    workspaceFolders: [{ uri: Uri.file("/repo") }],
    getConfiguration: () => ({ get: (key, fallback) => (key in state.config ? state.config[key] : fallback), has: () => false, inspect: () => undefined, update: async () => {} }),
    onDidChangeConfiguration: () => ({ dispose() {} }),
    onDidChangeTextDocument: () => ({ dispose() {} }),
    registerTextDocumentContentProvider: () => ({ dispose() {} }),
    textDocuments: [],
    applyEdit: async (edit) => { state.appliedEdits.push(edit); return true; },
  },
  languages: {
    createDiagnosticCollection: (name) => ({ name, set() {}, delete() {}, clear() {}, dispose() {} }),
  },
  window: {
    createOutputChannel: (name) => ({ name, appendLine() {}, append() {}, show() {}, dispose() {} }),
    createTextEditorDecorationType: (opts) => ({ opts, dispose() {} }),
    visibleTextEditors: [],
    showInformationMessage: async (message, ...actions) => { state.messages.push({ kind: "info", message, actions }); return state.infoResponses.shift(); },
    showWarningMessage: async (message, ...actions) => { state.messages.push({ kind: "warn", message, actions }); return undefined; },
    showErrorMessage: async (message, ...actions) => { state.messages.push({ kind: "error", message, actions }); return undefined; },
    showQuickPick: async () => undefined,
    setStatusBarMessage: (message) => { state.messages.push({ kind: "status", message }); return { dispose() {} }; },
    withProgress: async (opts, task) => task({ report: () => {} }, { onCancellationRequested: () => ({ dispose() {} }) }),
    tabGroups: { all: [], activeTabGroup: undefined, onDidChangeTabs: () => ({ dispose() {} }), close: async () => {} },
  },
  commands: {
    registerCommand: (id, fn) => { state.commands[id] = fn; return { dispose() {} }; },
    executeCommand: async (id) => {
      if (id === "vscode.diff" && state.diffThrows !== undefined) throw state.diffThrows;
      return undefined;
    },
  },
};
`,
);

const vs = require(STUB);

const ENTRY = path.join(__dirname, ".impl-v59-p1fix.entry.ts");
const OUTFILE = path.join(__dirname, ".impl-v59-p1fix.bundle.cjs");
let B = {};
let bundleErr;
try {
  fs.writeFileSync(
    ENTRY,
    `export { HttpStatusError } from "../src/core/errorBound";
export { translateServiceReject, generationFailedToast } from "../src/vscode/failureToast";
export { offerModelPull } from "../src/vscode/firstRun";
export { tightenDocComment } from "../src/vscode/tightenDocComment";
export { ProposalPresenter } from "../src/vscode/fnGen";\n`,
  );
  esbuild.buildSync({
    entryPoints: [ENTRY],
    bundle: true,
    outfile: OUTFILE,
    format: "cjs",
    platform: "node",
    alias: { vscode: STUB },
    external: [STUB],
  });
  B = require(OUTFILE);
} catch (e) {
  bundleErr = e;
}
test.after(() => [STUB, ENTRY, OUTFILE].forEach((f) => fs.rmSync(f, { force: true })));

const btest = (name, fn) =>
  test(name, (ctx) => {
    if (bundleErr) return ctx.skip("bundle failed to build; see row H1");
    return fn(ctx);
  });

const show = (s) => JSON.stringify(s);
const BREAKS = /[\n\r\u2028\u2029\u0085]/;

const HOSTILE_BODY = '{"error":{"type":"overloaded_error","message":"upstream is busy"}}';
const httpErr = (status, transport = "ollama") =>
  new B.HttpStatusError(transport, status, `Ollama ${status} Service Unavailable: ${HOSTILE_BODY}`);

const CLASSIFIED = [401, 403, 429, 503];

/** The clause the generation surfaces state and the other two must not. */
const WRITE_CLAUSE = "so nothing was written";
/** The remedy only a gesture surface can offer. */
const GESTURE_REMEDY = "run the gesture again";

// ===========================================================================
// H1 - harness
// ===========================================================================

test("H1 [harness]: the bundle builds and every driver is reachable", () => {
  if (bundleErr) assert.fail(`bundle failed to build: ${bundleErr.stack || bundleErr.message}`);
  for (const name of [
    "HttpStatusError",
    "translateServiceReject",
    "generationFailedToast",
    "offerModelPull",
    "tightenDocComment",
    "ProposalPresenter",
  ]) {
    assert.ok(B[name] !== undefined, `${name} must be exported`);
  }
});

// ===========================================================================
// F1 - THE HARD CONSTRAINT. The generation gesture regresses on nothing.
//
// Typed out rather than read back from the product, on purpose: a row that
// compares the product to itself cannot see a rewording, and a rewording is
// exactly what a sentence factored into two halves is at risk of.
// ===========================================================================

const GENERATION_SENTENCES = [
  [
    401,
    "ollama",
    "Column 80: the local model server refused the request as unauthorised, so nothing was written - " +
      "check the server's own authentication. The full message is in the output channel.",
  ],
  [
    403,
    "ollama",
    "Column 80: the local model server refused the request as unauthorised, so nothing was written - " +
      "check the server's own authentication. The full message is in the output channel.",
  ],
  [
    401,
    "cloud",
    "Column 80: the model provider refused the API key, so nothing was written - check " +
      "`column80.cloudApiKey`, then run the gesture again. The full message is in the output channel.",
  ],
  [
    403,
    "anthropic",
    "Column 80: the model provider refused the API key, so nothing was written - check " +
      "`column80.cloudApiKey`, then run the gesture again. The full message is in the output channel.",
  ],
  [
    429,
    "ollama",
    "Column 80: the model provider is rate limiting these requests, so nothing was written - " +
      "wait, then run the gesture again. The full message is in the output channel.",
  ],
  [
    429,
    "cloud",
    "Column 80: the model provider is rate limiting these requests, so nothing was written - " +
      "wait, then run the gesture again. The full message is in the output channel.",
  ],
  [
    503,
    "ollama",
    "Column 80: the model provider is having trouble, so nothing was written - try again " +
      "shortly. The full message is in the output channel.",
  ],
  [
    500,
    "cloud",
    "Column 80: the model provider is having trouble, so nothing was written - try again " +
      "shortly. The full message is in the output channel.",
  ],
];

for (const [status, transport, want] of GENERATION_SENTENCES) {
  btest(`F1 [${transport}/${status}]: the generation sentence is byte-identical to before the split`, () => {
    const err = httpErr(status, transport);
    assert.strictEqual(
      B.translateServiceReject(err),
      want,
      `F1: the split factors the sentence, it does not reword it. The generation surface must regress ` +
        `on nothing.\n  got : ${show(B.translateServiceReject(err))}\n  want: ${show(want)}`,
    );
    assert.strictEqual(
      B.generationFailedToast(err, "function generation"),
      want,
      "F1: and the gesture catch-all renders exactly that",
    );
  });
}

// ===========================================================================
// D1 - the discard toast
// ===========================================================================

const memDoc = (text) => {
  const d = { text, version: 1, closed: false };
  return {
    languageId: "rust",
    isDirty: false,
    get isClosed() {
      return d.closed;
    },
    eol: 1,
    get version() {
      return d.version;
    },
    uri: { fsPath: "/mem/target.rs", path: "/mem/target.rs", scheme: "file", toString: () => "file:///mem/target.rs", with() { return this; } },
    getText(range) {
      return range === undefined ? d.text : d.text.slice(range.start.offset ?? 0, range.end.offset ?? d.text.length);
    },
    positionAt: (offset) => ({ line: 0, character: offset, offset }),
    offsetAt: (pos) => pos.offset ?? pos.character,
    save: async () => true,
  };
};

const DISCARD_TEXT = "pub fn f() -> u32 {\n    0\n}\n";

/** The preview-open failure: the only discard cause that interpolates a caught
 *  error, and so the only one that can carry a break. `logOutcome` is recorded
 *  whole, because half of D1 is that the reason never reached it. */
async function drivePreviewFailure(err) {
  vs.__state.messages.length = 0;
  vs.__state.diffThrows = err;
  const outcomes = [];
  const doc = memDoc(DISCARD_TEXT);
  const outcome = await new B.ProposalPresenter({ subscriptions: [] }).present({
    document: doc,
    span: { start: 0, end: DISCARD_TEXT.length - 1 },
    versionAtResolve: doc.version,
    title: "f: generated body (preview)",
    text: "pub fn f() -> u32 {\n    1\n}",
    service: { logOutcome: (...args) => outcomes.push(args) },
  });
  vs.__state.diffThrows = undefined;
  const warns = vs.__state.messages.filter((m) => m.kind === "warn").map((m) => m.message);
  vs.__state.messages.length = 0;
  return { outcome, warns, outcomes };
}

const MULTILINE_ERR = () =>
  new Error("the diff editor is gone\n  at Object.<anonymous> (/x.js:1:1)\n  at Module._compile");

btest("D1a [discard]: a multi-line reason never renders an unclosed bracket", async () => {
  const got = await drivePreviewFailure(MULTILINE_ERR());
  assert.strictEqual(got.outcome, "discarded", "PRECONDITION: the preview failure still discards");
  assert.strictEqual(got.warns.length, 1, `exactly one toast, got ${show(got.warns)}`);
  const t = got.warns[0];
  assert.ok(!BREAKS.test(t), `D1a: the toast is still one line: ${show(t)}`);
  const opens = (t.match(/\(/g) || []).length;
  const closes = (t.match(/\)/g) || []).length;
  assert.strictEqual(
    opens,
    closes,
    `D1a: the cut landed INSIDE the brackets. Phase 1 wrapped the whole sentence in firstLine, so a ` +
      `reason carrying a break loses its closing bracket and the period is glued to a truncated ` +
      `clause.\n  got: ${show(t)}\n  opens=${opens} closes=${closes}`,
  );
  assert.ok(
    /\)\.( |$)/.test(t),
    `D1a: the sentence's own period sits OUTSIDE the bracket pair, after it, not welded to the cut.\n` +
      `  got: ${show(t)}`,
  );
});

btest("D1b [discard]: the tail the cut dropped reaches the channel, so the pointer is a true promise", async () => {
  const got = await drivePreviewFailure(MULTILINE_ERR());
  const t = got.warns[0];
  assert.ok(
    t.includes("The full message is in the output channel."),
    `D1b: the cut dropped two lines, so the toast owes the reader a pointer at where they went.\n` +
      `  got: ${show(t)}`,
  );
  assert.strictEqual(got.outcomes.length, 1, `exactly one logOutcome call, got ${show(got.outcomes)}`);
  const [outcome, detail] = got.outcomes[0];
  assert.strictEqual(outcome, "discarded", "D1b: still recorded as a system discard, not a human reject");
  assert.ok(
    detail !== undefined && JSON.stringify(detail).includes("at Module._compile"),
    `D1b: a pointer at the channel is a promise, and until the reason is handed to logOutcome the ` +
      `channel has no copy of it - the cut destroys the only one there is.\n` +
      `  logOutcome args: ${show(got.outcomes[0])}`,
  );
});

btest("D1c [discard control]: a single-line reason is byte-identical to today's", async () => {
  const got = await drivePreviewFailure(new Error("the diff editor is gone"));
  assert.deepStrictEqual(
    got.warns,
    ["Column 80: generation discarded — the preview could not be opened (Error: the diff editor is gone)."],
    "D1c: nothing was dropped, so no pointer, and the wording does not move",
  );
});

btest("D1d [discard control]: a literal reason keeps its wording and gets no pointer", async () => {
  // The five product-prose reasons take the same path. This drives the closed
  // document, which is a `channel-if-wired` reason, so with no callback wired it
  // toasts - and must read exactly as it always has.
  vs.__state.messages.length = 0;
  const doc = memDoc(DISCARD_TEXT);
  doc.isDirty = false;
  const closedDoc = { ...doc, isClosed: true, getText: doc.getText.bind(doc) };
  const outcome = await new B.ProposalPresenter({ subscriptions: [] }).present({
    document: closedDoc,
    span: { start: 0, end: DISCARD_TEXT.length - 1 },
    versionAtResolve: closedDoc.version,
    title: "f: generated body (preview)",
    text: "pub fn f() -> u32 {\n    1\n}",
    service: { logOutcome: () => {} },
  });
  const warns = vs.__state.messages.filter((m) => m.kind === "warn").map((m) => m.message);
  vs.__state.messages.length = 0;
  assert.strictEqual(outcome, "discarded");
  assert.deepStrictEqual(warns, [
    "Column 80: generation discarded — the document was closed during generation.",
  ]);
});

// ===========================================================================
// D2 - the surface's own consequence
// ===========================================================================

const TIGHTEN_TAIL = "The re-wrap needs no model.";

const TS_FILE = "/repo/src/walk.ts";
const DICTATED =
  "// this walker keeps a shard mem cache for each of the client sets and drops every entry it can prove is stale\n" +
  "export function walk() {}\n";

function makeDoc(text, uriStr, languageId) {
  const lines = text.split("\n");
  const offsetAt = (p) => {
    let o = 0;
    for (let i = 0; i < Math.min(p.line, lines.length); i++) o += lines[i].length + 1;
    return Math.min(o + p.character, text.length);
  };
  const positionAt = (off) => {
    let o = 0;
    for (let l = 0; l < lines.length; l++) {
      if (off <= o + lines[l].length) return { line: l, character: off - o };
      o += lines[l].length + 1;
    }
    return { line: lines.length - 1, character: 0 };
  };
  return {
    languageId,
    version: 1,
    isClosed: false,
    uri: { toString: () => uriStr, fsPath: uriStr, path: uriStr },
    offsetAt,
    positionAt,
    getText: (r) => (r ? text.slice(offsetAt(r.start), offsetAt(r.end)) : text),
    lineAt: (l) => ({ text: lines[l] }),
  };
}

async function driveTighten(err) {
  const doc = makeDoc(DICTATED, TS_FILE, "typescript");
  const warnings = [];
  const wiring = {
    presenter: { confirmDiff: async () => "accept" },
    resolveFunction: async () => ({ languageId: "typescript", symbolName: "walk" }),
    resolvePrefill: async () => undefined,
    prefillLangFor: () => ({ localTypeDefs: () => new Map(), typeReference: () => undefined }),
    extractorFor: () => undefined,
    transport: () => async () => {
      throw err;
    },
    modelTag: () => "test-model",
  };
  const deps = {
    querySymbols: async () => [],
    fileExists: () => false,
    readFile: () => undefined,
    workspaceRoot: () => "/repo",
    config: () => ({
      apiBase: "http://127.0.0.1:1/",
      model: "test-model",
      fallbackModel: "x",
      maxTokens: 2048,
      temperature: 0,
      numCtx: 16384,
    }),
    windowed: () => true,
    review: async () => [],
    applyEdit: async () => true,
    warn: (m) => warnings.push(m),
  };
  await B.tightenDocComment(doc, { line: 0, character: 20 }, () => {}, wiring, deps);
  return warnings;
}

async function drivePull(err) {
  vs.__state.messages.length = 0;
  vs.__state.infoResponses.length = 0;
  vs.__state.infoResponses.push("Download");
  const lines = [];
  const output = { appendLine: (l) => lines.push(String(l)) };
  const landed = await B.offerModelPull("http://127.0.0.1:1/", "test-model", output, "the model is missing", {
    pull: async () => {
      throw err;
    },
  });
  const warns = vs.__state.messages.filter((m) => m.kind === "warn").map((m) => m.message);
  vs.__state.messages.length = 0;
  return { landed, lines, warns };
}

/** The half of the sentence that is surface-independent: everything before the
 *  consequence clause. Read out of the product's own generation sentence rather
 *  than typed, so a reworded cause re-baselines this instead of breaking it. */
const diagnosisOf = (err) => {
  const full = B.translateServiceReject(err);
  return typeof full === "string" ? full.split(",")[0] : undefined;
};

for (const status of CLASSIFIED) {
  btest(`D2a [tighten/${status}]: the warning does not claim nothing was written`, async () => {
    const warnings = await driveTighten(httpErr(status));
    assert.strictEqual(warnings.length, 1, `exactly one warning, got ${show(warnings)}`);
    assert.ok(
      !warnings[0].includes(WRITE_CLAUSE),
      `D2a: the tighten gesture does NOT stop at this warn. It proceeds through the delta and existence ` +
        `gates and applies the re-wrap, so "${WRITE_CLAUSE}" is contradicted by the second clause of the ` +
        `same notification.\n  got: ${show(warnings[0])}`,
    );
  });

  btest(`D2b [tighten/${status}]: the class DIAGNOSIS and the second clause both survive`, async () => {
    const err = httpErr(status);
    const warnings = await driveTighten(err);
    const diagnosis = diagnosisOf(err);
    assert.ok(
      typeof diagnosis === "string" && diagnosis.trim() !== "",
      `PRECONDITION: ${status} must be classified or this row bans the empty string`,
    );
    assert.ok(
      warnings[0].includes(diagnosis),
      `D2b: only the consequence half varies. One throw class still produces one diagnosis on every ` +
        `surface.\n  got      : ${show(warnings[0])}\n  diagnosis: ${show(diagnosis)}`,
    );
    assert.ok(warnings[0].endsWith(TIGHTEN_TAIL), `D2b: the second clause stays: ${show(warnings[0])}`);
    assert.ok(!BREAKS.test(warnings[0]), `D2b: one line only: ${show(warnings[0])}`);
  });

  btest(`D2c [download/${status}]: a Download click is not told to run the gesture again`, async () => {
    const got = await drivePull(httpErr(status));
    assert.strictEqual(got.landed, false, "the pull must report failure");
    assert.strictEqual(got.warns.length, 1, `exactly one toast, got ${show(got.warns)}`);
    assert.ok(
      !got.warns[0].includes(GESTURE_REMEDY),
      `D2c: there is no gesture here. The user clicked Download in a notification, and the remedy has ` +
        `to name a control that exists.\n  got: ${show(got.warns[0])}`,
    );
    assert.ok(
      !got.warns[0].includes(WRITE_CLAUSE),
      `D2c: a download writes a model, not source. Say what happened to the download.\n` +
        `  got: ${show(got.warns[0])}`,
    );
  });

  btest(`D2d [download/${status}]: the class DIAGNOSIS still reaches the download toast`, async () => {
    const err = httpErr(status);
    const got = await drivePull(err);
    const diagnosis = diagnosisOf(err);
    assert.ok(
      got.warns[0].includes(diagnosis),
      `D2d: the download surface still says what the server did. That half never varies.\n` +
        `  got      : ${show(got.warns[0])}\n  diagnosis: ${show(diagnosis)}`,
    );
    assert.ok(!BREAKS.test(got.warns[0]), `D2d: one line only: ${show(got.warns[0])}`);
  });
}

// ===========================================================================
// D3 - typed status ONLY, said by the code rather than by a comment
// ===========================================================================

btest("D3a [download/typed-unclassified]: a 404 carrying a generation marker draws no crafted sentence", async () => {
  // The driven proof from the phase 1 review. `firstRun.ts` gated the WHOLE
  // translator on `err instanceof HttpStatusError`, so an unclassified status
  // fell straight through to the anchored, payload-carrier and substring passes
  // - and this message carries a generation reject's marker under NO carrier
  // head, so the substring pass took it. "The model's reply contained no usable
  // code" is not a thing that happens to a download.
  //
  // Unreachable through `pullModel` today, which heads every message
  // `Ollama <status> ...` and so trips the `"Ollama "` carrier. That makes the
  // surface protected by a table two modules away rather than by the gate whose
  // own comment claims the protection.
  const err = new B.HttpStatusError("ollama", 404, "pull failed: generation was empty after postprocess");
  const leaked = B.translateServiceReject(err);
  assert.ok(
    typeof leaked === "string" && leaked.includes("no usable code"),
    `PRECONDITION: the whole translator must still answer this error with a generation reject's ` +
      `sentence, or this row proves nothing.\n  got: ${show(leaked)}`,
  );
  const got = await drivePull(err);
  assert.deepStrictEqual(
    got.warns,
    [`Column 80: the download failed - ${err.message}. The full message is in the output channel.`],
    `D3a: an unclassified status has no class, so the provider's own message is the actionable half. ` +
      `The download surface must consult the TYPED STATUS and nothing else.`,
  );
});

btest("D3b [download/typed-unclassified control]: a 418 still keeps today's wording", async () => {
  const odd = new B.HttpStatusError("ollama", 418, 'Ollama 418 I am a teapot: {"error":"short and stout"}');
  const got = await drivePull(odd);
  assert.deepStrictEqual(got.warns, [
    `Column 80: the download failed - ${odd.message}. The full message is in the output channel.`,
  ]);
});
