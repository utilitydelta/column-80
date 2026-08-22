// Implementer oracle, session-v59 phase 1: one throw class, one sentence, on
// every surface.
//
// The defect this drives: `translateServiceReject` lived inside
// `src/vscode/fnGen.ts`, so only the fn-gen and test-gen catch-alls could reach
// it. The model download toast rendered the provider's raw JSON, and the
// tighten gesture answered a 401, a 429 and a 503 with one hardcoded sentence
// saying the model could not be reached - false for all three, because the
// server was reached and it refused.
//
// WHAT THIS TIER CAN SEE. All three surfaces are drivable headless through
// their own seams: `offerModelPull` takes `deps.pull`, `tightenDocComment`
// takes `wiring.transport` and `deps.warn`, and `ProposalPresenter.present`
// takes a request record. One bundle holds all three plus `errorBound`, so
// `instanceof HttpStatusError` is the same class the product tests.
//
// WHAT IT CANNOT. Whether a real notification renders the sentence on one row;
// that is the human's dogfood window.
//
// ROWS
//   1  the bundle builds and exports the three surfaces
//   2  the download toast IS the class sentence, in the download's own voice
//   3  an unclassified status and a plain Error keep today's download wording
//   4  the download toast is one line and carries no JSON
//   5  the pull's channel line and its cancel branch are untouched
//   6  the tighten warning carries the class diagnosis AND keeps its second clause
//   7  an unclassified failure keeps the tighten sentence byte for byte
//   8  the invariant: one throw class, one DIAGNOSIS on all three
//   9  ride-along - a multi-line discard reason renders one line, brackets closed
//  10  control - a single-line discard reason is byte-identical to today's
//
// ROWS 2, 6 AND 8 WERE RE-CUT. They pinned the same SENTENCE on all three
// surfaces, and the phase 1 adversarial review found that sentence false on two
// of them: the tighten gesture writes, and the download has no gesture to run
// again. The consequence half is now the surface's own and the diagnosis half is
// what they agree on. `docs/supersessions.md` S31.
//
// Run: node --test test/impl-v59-p1-one-sentence-surfaces.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const fs = require("node:fs");
const esbuild = require("esbuild");

// ---------------------------------------------------------------------------
// Harness. One vscode stub, EXTERNAL to the bundle so this file and the product
// share one `__state`.
// ---------------------------------------------------------------------------

const STUB = path.join(__dirname, ".impl-v59-p1-stub.cjs");
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

const ENTRY = path.join(__dirname, ".impl-v59-p1.entry.ts");
const OUTFILE = path.join(__dirname, ".impl-v59-p1.bundle.cjs");
let B = {};
let bundleErr;
try {
  fs.writeFileSync(
    ENTRY,
    `export { HttpStatusError } from "../src/core/errorBound";
export { translateServiceReject, generationFailedToast, DOWNLOAD_VOICE, TIGHTEN_VOICE } from "../src/vscode/failureToast";
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
    if (bundleErr) return ctx.skip("bundle failed to build; see row 1");
    return fn(ctx);
  });

const show = (s) => JSON.stringify(s);
const JSON_TOKENS = ['{"', '":', "}", "[", "]"];

/** A hostile 503 body, the shape the v58 rows drove: the provider's own JSON,
 *  which is what used to reach the download toast. */
const HOSTILE_BODY = '{"error":{"type":"overloaded_error","message":"upstream is busy"}}';
const httpErr = (status, transport = "ollama") =>
  new B.HttpStatusError(transport, status, `Ollama ${status} Service Unavailable: ${HOSTILE_BODY}`);

/** The four classified classes, one representative each. */
const CLASSIFIED = [401, 403, 429, 503];

/** THE CONTRACT NARROWED, and rows 2, 6 and 8 are re-cut on it.
 *
 *  This file first pinned the SAME SENTENCE on all three surfaces, and that was
 *  wrong on two of them. Every status sentence reads
 *  `Column 80: <CAUSE>, so nothing was written - <REMEDY>.` The cause is what
 *  the server did, so it travels; the consequence and the remedy are about the
 *  gesture and do not. The tighten gesture carries on past its warn and applies
 *  the re-wrap, so "nothing was written" arrived in the same notification as the
 *  write, beside "The re-wrap needs no model." - the product contradicting
 *  itself in one sentence. The download has no gesture to run again.
 *
 *  So each surface supplies its own consequence, the generation gestures' words
 *  stay byte-identical, and what all three still agree on is the DIAGNOSIS. That
 *  half is what these rows compare. `docs/supersessions.md` S31. */
const diagnosisOf = (err) => {
  const full = B.translateServiceReject(err);
  return typeof full === "string" ? full.split(",")[0] : undefined;
};

// ===========================================================================
// 1 - harness
// ===========================================================================

test("row 1: the bundle builds and exports all three surfaces plus the translator", () => {
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
  for (const status of CLASSIFIED) {
    assert.notStrictEqual(
      B.translateServiceReject(httpErr(status)),
      undefined,
      `PRECONDITION: ${status} must be a classified status or every row below compares two undefineds`,
    );
  }
});

// ===========================================================================
// 2-5 - the download toast
// ===========================================================================

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

for (const status of CLASSIFIED) {
  btest(`row 2 [download/${status}]: the toast IS the class sentence, not the provider's JSON`, async () => {
    const err = httpErr(status);
    const got = await drivePull(err);
    assert.strictEqual(got.landed, false, "the pull must report failure");
    assert.strictEqual(got.warns.length, 1, `exactly one toast, got ${got.warns.length}`);
    assert.strictEqual(
      got.warns[0],
      B.translateServiceReject(err, B.DOWNLOAD_VOICE),
      `row 2: the download surface draws the class's crafted sentence in its OWN voice - same ` +
        `diagnosis, its own consequence.\n  got     : ${show(got.warns[0])}\n` +
        `  expected: ${show(B.translateServiceReject(err, B.DOWNLOAD_VOICE))}`,
    );
    assert.ok(
      got.warns[0].includes(diagnosisOf(err)),
      `row 2: and the diagnosis half is the one every other surface gives.\n` +
        `  got      : ${show(got.warns[0])}\n  diagnosis: ${show(diagnosisOf(err))}`,
    );
  });
}

btest("row 3 [download/unclassified]: a 418 and a plain Error keep today's wording, byte for byte", async () => {
  const odd = new B.HttpStatusError("ollama", 418, 'Ollama 418 I am a teapot: {"error":"short and stout"}');
  assert.strictEqual(B.translateServiceReject(odd), undefined, "PRECONDITION: 418 has no class");
  const got = await drivePull(odd);
  assert.deepStrictEqual(got.warns, [
    `Column 80: the download failed - ${odd.message}. The full message is in the output channel.`,
  ]);

  const plain = new Error("the socket went away");
  const got2 = await drivePull(plain);
  assert.deepStrictEqual(got2.warns, [
    "Column 80: the download failed - the socket went away. The full message is in the output channel.",
  ]);
});

btest("row 4 [download]: the classified toast is one line and carries no JSON", async () => {
  for (const status of CLASSIFIED) {
    const got = await drivePull(httpErr(status));
    const t = got.warns[0];
    assert.ok(!/[\n\r\u2028\u2029\u0085]/.test(t), `row 4: ${status} rendered a break: ${show(t)}`);
    for (const token of JSON_TOKENS) {
      assert.ok(!t.includes(token), `row 4: ${status} put ${show(token)} on screen: ${show(t)}`);
    }
    assert.ok(t.startsWith("Column 80: "), `row 4: ${status} lost the house voice: ${show(t)}`);
  }
});

btest("row 5 [download]: the channel line and the cancel branch are untouched", async () => {
  const err = httpErr(503);
  const got = await drivePull(err);
  assert.ok(
    got.lines.some((l) => l === `[carve] pull failed model=test-model: ${err.message}`),
    `row 5: the channel keeps the whole bounded message, translation or not: ${show(got.lines)}`,
  );
  assert.ok(got.lines.some((l) => l.startsWith("[carve] pull ratified")), "row 5: the ratify line survives");

  const abort = new Error("aborted");
  abort.name = "AbortError";
  const cancelled = await drivePull(abort);
  assert.deepStrictEqual(cancelled.warns, [], "row 5: a cancel toasts nothing, before and after");
  assert.ok(
    cancelled.lines.some((l) => l.startsWith("[carve] pull cancelled")),
    `row 5: a cancel is logged as a cancel: ${show(cancelled.lines)}`,
  );
});

btest("row 5b [download/forgery]: a registry that puts a generation reject in its error field draws no sentence", async () => {
  // `pullModel`'s in-stream throw (`ollama.ts`, the `evt.error` line) carries
  // server-chosen text under NO payload-carrier head, so the substring pass
  // would take it at its word. Every row that pass can match is a generation
  // reject, and none of them is true of a download: routing the whole
  // translator onto this surface would let a hostile registry pick the
  // sentence. The download asks about the typed status only.
  for (const marker of [
    "generation was empty after postprocess",
    "generation truncated at num_predict",
    "generation contains a code-fence line",
  ]) {
    const got = await drivePull(new Error(marker));
    assert.deepStrictEqual(got.warns, [
      `Column 80: the download failed - ${marker}. The full message is in the output channel.`,
    ]);
  }
});

// ===========================================================================
// 6-7 - the tighten gesture
// ===========================================================================

const TIGHTEN_TAIL = "The re-wrap needs no model.";
const TIGHTEN_TODAY =
  "Column 80: the model could not be reached, so no type names were offered. The re-wrap needs no model.";

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

/** One tighten invocation whose proposer round throws `err`. Every other seam
 *  is inert: no symbols, no anchors, no edit. The warning is the whole
 *  observation. */
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

for (const status of CLASSIFIED) {
  btest(`row 6 [tighten/${status}]: the warning carries the class sentence and keeps its second clause`, async () => {
    const err = httpErr(status);
    const warnings = await driveTighten(err);
    assert.strictEqual(warnings.length, 1, `exactly one warning, got ${show(warnings)}`);
    const sentence = B.translateServiceReject(err, B.TIGHTEN_VOICE);
    assert.ok(
      warnings[0].includes(sentence),
      `row 6: the tighten surface must say what actually happened. The server was REACHED and it ` +
        `refused.\n  got     : ${show(warnings[0])}\n  must hold: ${show(sentence)}`,
    );
    assert.ok(
      warnings[0].includes(diagnosisOf(err)),
      `row 6: the diagnosis is the half that travels, and it is the same one the other two surfaces ` +
        `give.\n  got      : ${show(warnings[0])}\n  diagnosis: ${show(diagnosisOf(err))}`,
    );
    assert.ok(
      !warnings[0].includes("so nothing was written"),
      `row 6: this gesture WRITES. It proceeds past the warn through the delta and existence gates and ` +
        `applies the re-wrap, which the very next clause says.\n  got: ${show(warnings[0])}`,
    );
    assert.ok(
      warnings[0].endsWith(TIGHTEN_TAIL),
      `row 6: the second clause is what makes this a warning rather than a refusal, and it is still ` +
        `true.\n  got: ${show(warnings[0])}`,
    );
    assert.ok(!/[\n\r\u2028\u2029\u0085]/.test(warnings[0]), `row 6: one line only: ${show(warnings[0])}`);
    for (const token of JSON_TOKENS) {
      assert.ok(!warnings[0].includes(token), `row 6: ${show(token)} reached the screen: ${show(warnings[0])}`);
    }
  });
}

btest("row 7 [tighten/unclassified]: today's sentence survives byte for byte", async () => {
  for (const err of [new Error("server unreachable"), new B.HttpStatusError("ollama", 418, "Ollama 418 teapot")]) {
    assert.strictEqual(B.translateServiceReject(err), undefined, `PRECONDITION: ${err.message} has no class`);
    assert.deepStrictEqual(
      await driveTighten(err),
      [TIGHTEN_TODAY],
      `row 7: no class means no crafted sentence, on this surface as on every other`,
    );
  }
});

// ===========================================================================
// 8 - the invariant
// ===========================================================================

for (const status of CLASSIFIED) {
  btest(`row 8 [invariant/${status}]: one throw class, one diagnosis on all three surfaces`, async () => {
    const err = httpErr(status);
    const diagnosis = diagnosisOf(err);
    assert.ok(
      typeof diagnosis === "string" && diagnosis.trim() !== "",
      `row 8 PRECONDITION: ${status} must be classified, or every clause below bans the empty string`,
    );
    const pull = (await drivePull(err)).warns[0];
    const tighten = (await driveTighten(err))[0];
    const fngen = B.generationFailedToast(err, "function generation");
    for (const [surface, text] of [
      ["fn-gen", fngen],
      ["download", pull],
      ["tighten", tighten],
    ]) {
      assert.ok(
        text.includes(diagnosis),
        `row 8: ${surface} does not carry the class diagnosis.\n  got : ${show(text)}\n` +
          `  want: ${show(diagnosis)}`,
      );
    }
    // AND THE CONSEQUENCES REALLY DIFFER. Without this the row above passes on
    // a build that never split anything - the diagnosis is a prefix of the
    // generation sentence, so three identical sentences satisfy it too.
    assert.notStrictEqual(pull, fngen, "row 8: the download's consequence is not the gesture's");
    assert.ok(
      !tighten.includes("so nothing was written") && !pull.includes("so nothing was written"),
      `row 8: only the generation gestures write source.\n  download: ${show(pull)}\n` +
        `  tighten : ${show(tighten)}`,
    );
  });
}

// ===========================================================================
// 9-10 - the ride-along: the discard toast is one line
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

/** The preview-open failure: the one discard cause that interpolates a caught
 *  error, which is the only one that can carry a break. */
async function drivePreviewFailure(err) {
  vs.__state.messages.length = 0;
  vs.__state.diffThrows = err;
  const doc = memDoc(DISCARD_TEXT);
  const outcome = await new B.ProposalPresenter({ subscriptions: [] }).present({
    document: doc,
    span: { start: 0, end: DISCARD_TEXT.length - 1 },
    versionAtResolve: doc.version,
    title: "f: generated body (preview)",
    text: "pub fn f() -> u32 {\n    1\n}",
    service: { logOutcome: () => {} },
  });
  vs.__state.diffThrows = undefined;
  const warns = vs.__state.messages.filter((m) => m.kind === "warn").map((m) => m.message);
  vs.__state.messages.length = 0;
  return { outcome, warns };
}

btest("row 9 [ride-along]: a multi-line discard reason renders one line", async () => {
  const err = new Error("the diff editor is gone\n  at Object.<anonymous> (/x.js:1:1)\n  at Module._compile");
  const got = await drivePreviewFailure(err);
  assert.strictEqual(got.outcome, "discarded", "PRECONDITION: the preview failure still discards");
  assert.strictEqual(got.warns.length, 1, `exactly one toast, got ${show(got.warns)}`);
  assert.ok(
    !/[\n\r\u2028\u2029\u0085]/.test(got.warns[0]),
    `row 9: a notification carrying a break renders as two rows with no channel pointer, which is the ` +
      `defect item 63 closed for the other strings.\n  got: ${show(got.warns[0])}`,
  );
  assert.ok(
    got.warns[0].startsWith("Column 80: generation discarded — the preview could not be opened ("),
    `row 9: the wording is unchanged, only the cut is added: ${show(got.warns[0])}`,
  );
  // STRENGTHENED after the phase 1 review. The row above passed on
  // "...could not be opened (Error: the diff editor is gone." - an unclosed
  // bracket with the sentence's period welded to a truncated clause - because
  // the only thing it asked about was the head. The cut belongs at the
  // interpolation, inside the bracket pair, never across it.
  const opens = (got.warns[0].match(/\(/g) || []).length;
  const closes = (got.warns[0].match(/\)/g) || []).length;
  assert.strictEqual(
    opens,
    closes,
    `row 9: the cut landed inside the brackets and the pair never closed.\n  got: ${show(got.warns[0])}`,
  );
  assert.ok(
    /\)\.( |$)/.test(got.warns[0]),
    `row 9: the period is the SENTENCE's, so it sits after the closing bracket rather than glued to a ` +
      `cut clause.\n  got: ${show(got.warns[0])}`,
  );
});

btest("row 10 [ride-along control]: a single-line reason is byte-identical to today's", async () => {
  const got = await drivePreviewFailure(new Error("the diff editor is gone"));
  assert.deepStrictEqual(got.warns, [
    "Column 80: generation discarded — the preview could not be opened (Error: the diff editor is gone).",
  ]);
});
