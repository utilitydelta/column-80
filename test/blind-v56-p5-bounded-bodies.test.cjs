// Blind oracle, session-v56 phase 5: "bound the raw bodies, widen unreachable"
// (roadmap item 63, second half). Written BEFORE the fix, against that phase's
// contract only.
//
// WHAT THIS FILE PINS, one row per falsification clause:
//   contract 1  an HTTP error body interpolated into an Ollama error string is
//               BOUNDED: a 100KB body from a misbehaving server yields a
//               bounded error string carrying an elision marker that says how
//               much was cut, with the status line still intact. Both
//               interpolation sites: the GENERATE path (generateInstruct) and
//               the PULL path (pullModel).
//   contract 2  isServerUnreachable additionally recognises ETIMEDOUT,
//               EHOSTUNREACH and undici UND_ERR_* codes, top-level on `err.code`
//               and nested under `err.cause`, matching how the existing codes
//               are matched.
//   contract 3  existing recognised shapes keep working: ECONNREFUSED still
//               classifies as unreachable.
//   (falsification tail) a random unrelated error still does NOT classify.
//   (non-behaviour "not unbounded either", read forward) a SHORT body is
//               passed through intact, with no elision marker: the bound must
//               not mangle a normal error.
//
// THE DRIVE IS BLACK BOX. The two interpolation sites are driven through the
// product's own exported entry points against a real loopback HTTP server that
// answers 500 with the body under test (the blind5-pull / blind-ollama
// precedent). isServerUnreachable is called directly - it is exported from
// src/vscode/fnGen.ts, so no internal reach is needed. Nothing in this file
// reads the bodies of safeText, its interpolation sites, or isServerUnreachable.
//
// BINDINGS THE CONTRACT LEAVES OPEN, resolved and REPORTED:
//   * "BOUNDED" (contract 1). The contract says "a few hundred bytes of body at
//     most". Bound generously to: the whole error string is at most 2048
//     characters. A 100KB body cannot survive that; a few hundred bytes of body
//     plus wording fits it with room to spare.
//   * "ELISION MARKER ... saying how much was cut" (contract 1). Bound to two
//     things present in the error string: (a) an elision word or ellipsis -
//     /elid|truncat|omitt|trimm|\bcut\b|\bmore\b|\.\.\.|…/i, and (b) a decimal
//     run of 4 or more digits, which at this body size can only be the amount
//     cut. To keep (b) honest the body is 100KB of a SINGLE NON-DIGIT
//     CHARACTER, and the loopback base URL (which carries a 5-digit port) is
//     stripped from the string before (b) is scanned. So no digit in the
//     scanned text can come from the body or the URL.
//   * "STATUS LINE PRESERVED" (contract 1). Bound to: the string contains 500.
//   * "SHORT BODY INTACT" (the bound must not mangle). Bound to: the short
//     body's distinctive word survives verbatim, and neither half of the
//     elision marker appears.
//   * THE SHAPES (contract 2). Two per code. TOP-LEVEL is `err.code` on an
//     ordinary Error. NESTED is `err.cause = { code }`, the shape the repo's
//     own tests already use for a recognised code
//     (test/blind-v56-p4-toast-translation.test.cjs uses
//     `TypeError("fetch failed")` with `cause = { code: "ECONNREFUSED" }`).
//     The nested rows here deliberately do NOT use the "fetch failed" message,
//     because a pre-fix probe of the exported classifier showed the MESSAGE
//     "fetch failed" alone is enough to classify unreachable today, with the
//     cause ignored - so a "fetch failed" envelope would make every nested row
//     pass vacuously and prove nothing about the code list. The envelope used
//     is `Error("connect failure to the ollama host")`, which the same probe
//     shows classifies purely on `cause.code`: ECONNREFUSED under it is true
//     today, EACCES under it is false. That isolates the leg the contract
//     widens.
//
// EXPECTED TODAY (pre-fix):
//   RED   C1 rows (generate and pull): the body goes in whole, no marker
//   RED   C2 rows: ETIMEDOUT, EHOSTUNREACH, UND_ERR_CONNECT_TIMEOUT unknown
//   GREEN C3 regression row: ECONNREFUSED
//   GREEN the unrelated-error row
//   GREEN the short-body row (nothing bounds it yet, so it is already intact)
//
// NOT TESTED, and why:
//   * The contract names ECONNREFUSED "et al" for the existing shapes but never
//     lists the other four. They are not discoverable black box from the
//     contract, and guessing them would put invented behaviour in a blind file,
//     so only ECONNREFUSED is pinned as the regression.
//   * TOP-LEVEL `err.code` for the EXISTING codes. A pre-fix probe shows
//     `Object.assign(new Error("connect ECONNREFUSED ..."), { code:
//     "ECONNREFUSED" })` classifies FALSE today: the classifier has no
//     top-level `err.code` leg at all. The contract does not claim one for the
//     existing codes, so this file does not assert it - but it does assert the
//     top-level leg for the three NEW codes, which contract 2's "recognises
//     ETIMEDOUT, EHOSTUNREACH and undici UND_ERR_* codes" does cover. Whoever
//     implements this should decide deliberately whether ECONNREFUSED gets the
//     same top-level leg; the asymmetry is reported, not silently pinned.
//
// Run: node --test test/blind-v56-p5-bounded-bodies.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const path = require("node:path");
const fs = require("node:fs");
const esbuild = require("esbuild");
const { bundleCore } = require("./.blind-util.cjs");

// ---------------------------------------------------------------------------
// Load 1: the core transport entry points, no vscode involved.
// ---------------------------------------------------------------------------

const core = bundleCore(
  "blind-v56-p5-core",
  `export { generateInstruct, pullModel } from "../src/core/ollama";\n`,
);
const { generateInstruct, pullModel } = core.mod;

// ---------------------------------------------------------------------------
// Load 2: isServerUnreachable is exported from the vscode layer, so the module
// needs a `vscode` to resolve against. The stub is inert - this file only calls
// a pure classifier - but it has to satisfy whatever the module touches while
// it loads.
// ---------------------------------------------------------------------------

const STUB = path.join(__dirname, ".blind-v56-p5-stub.cjs");
fs.writeFileSync(
  STUB,
  `
class Position { constructor(line, character) { this.line = line; this.character = character; } translate(l = 0, c = 0) { return new Position(this.line + l, this.character + c); } with(line, character) { return new Position(line === undefined ? this.line : line, character === undefined ? this.character : character); } isBefore(o) { return this.line < o.line || (this.line === o.line && this.character < o.character); } isEqual(o) { return this.line === o.line && this.character === o.character; } isAfter(o) { return !this.isBefore(o) && !this.isEqual(o); } isBeforeOrEqual(o) { return !this.isAfter(o); } isAfterOrEqual(o) { return !this.isBefore(o); } compareTo(o) { return this.isEqual(o) ? 0 : this.isBefore(o) ? -1 : 1; } }
class Range { constructor(a, b, c, d) { if (typeof a === "number") { this.start = new Position(a, b); this.end = new Position(c, d); } else { this.start = a; this.end = b; } } get isEmpty() { return this.start.line === this.end.line && this.start.character === this.end.character; } get isSingleLine() { return this.start.line === this.end.line; } contains() { return false; } with(start, end) { return new Range(start || this.start, end || this.end); } }
class Selection extends Range { constructor(a, b, c, d) { super(a, b, c, d); this.anchor = this.start; this.active = this.end; } }
class SnippetString { constructor(value) { this.value = value; } }
class WorkspaceEdit { constructor() { this._entries = []; } replace() {} insert() {} entries() { return this._entries; } }
class EventEmitter { constructor() { this.handlers = []; } get event() { return (fn) => { this.handlers.push(fn); return { dispose() {} }; }; } fire(x) { for (const h of this.handlers) h(x); } dispose() {} }
class ThemeColor { constructor(id) { this.id = id; } }
class MarkdownString { constructor(v) { this.value = v || ""; } appendCodeblock() {} appendMarkdown() {} appendText() {} }
class Diagnostic { constructor(range, message, severity) { this.range = range; this.message = message; this.severity = severity; } }
class TabInputTextDiff { constructor(original, modified) { this.original = original; this.modified = modified; } }
const Uri = {
  file: (p) => ({ fsPath: p, path: p, scheme: "file", toString: () => "file://" + p, with() { return this; } }),
  from: (parts) => ({ ...parts, fsPath: parts.path, toString: () => String(parts.scheme) + "://" + String(parts.path) }),
  parse: (s) => ({ fsPath: String(s), path: String(s), scheme: "file", toString: () => String(s), with() { return this; } }),
  joinPath: (base, ...segs) => Uri.file([base.fsPath, ...segs].join("/")),
};
module.exports = {
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
    getConfiguration: () => ({ get: (k, fallback) => fallback, has: () => false, inspect: () => undefined, update: async () => {} }),
    onDidChangeConfiguration: () => ({ dispose() {} }),
    onDidChangeTextDocument: () => ({ dispose() {} }),
    onDidCloseTextDocument: () => ({ dispose() {} }),
    registerTextDocumentContentProvider: () => ({ dispose() {} }),
    textDocuments: [], workspaceFolders: undefined,
    getWorkspaceFolder: () => undefined,
    openTextDocument: async () => undefined,
    applyEdit: async () => true,
    fs: { stat: async () => { throw new Error("ENOENT"); }, createDirectory: async () => {}, writeFile: async () => {}, readFile: async () => Buffer.alloc(0), delete: async () => {} },
  },
  languages: {
    createDiagnosticCollection: (name) => ({ name, set() {}, delete() {}, clear() {}, dispose() {} }),
    getDiagnostics: () => [],
    onDidChangeDiagnostics: () => ({ dispose() {} }),
    registerCompletionItemProvider: () => ({ dispose() {} }),
    registerInlineCompletionItemProvider: () => ({ dispose() {} }),
  },
  window: {
    createOutputChannel: (name) => ({ name, appendLine() {}, append() {}, replace() {}, show() {}, hide() {}, clear() {}, dispose() {} }),
    createTextEditorDecorationType: (opts) => ({ opts, dispose() {} }),
    createStatusBarItem: () => ({ show() {}, hide() {}, dispose() {}, text: "", tooltip: "", command: undefined }),
    visibleTextEditors: [], activeTextEditor: undefined,
    onDidChangeActiveTextEditor: () => ({ dispose() {} }),
    onDidChangeTextEditorSelection: () => ({ dispose() {} }),
    showInformationMessage: async () => undefined,
    showWarningMessage: async () => undefined,
    showErrorMessage: async () => undefined,
    withProgress: async (_o, fn) => fn({ report() {} }, { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) }),
    createTerminal: () => ({ show() {}, sendText() {}, dispose() {} }),
    tabGroups: { all: [], close: async () => true, onDidChangeTabs: () => ({ dispose() {} }) },
  },
  commands: {
    registerCommand: () => ({ dispose() {} }),
    registerTextEditorCommand: () => ({ dispose() {} }),
    executeCommand: async () => undefined,
    getCommands: async () => [],
  },
  extensions: { getExtension: () => undefined, all: [] },
  env: { openExternal: async () => true, clipboard: { writeText: async () => {} } },
};
`,
);

const ENTRY = path.join(__dirname, ".blind-v56-p5.entry.ts");
const OUTFILE = path.join(__dirname, ".blind-v56-p5.bundle.cjs");
let V = {};
let bundleErr;
try {
  fs.writeFileSync(ENTRY, `export { isServerUnreachable } from "../src/vscode/fnGen";\n`);
  esbuild.buildSync({
    entryPoints: [ENTRY],
    bundle: true,
    outfile: OUTFILE,
    format: "cjs",
    platform: "node",
    alias: { vscode: STUB },
  });
  V = require(OUTFILE);
} catch (e) {
  bundleErr = e;
}

test.after(() => {
  core.cleanup();
  for (const f of [STUB, ENTRY, OUTFILE]) fs.rmSync(f, { force: true });
});

const vtest = (name, fn) =>
  test(name, (ctx) => {
    if (bundleErr) return ctx.skip(`bundle failed to build: ${bundleErr && bundleErr.message}`);
    return fn(ctx);
  });

// ---------------------------------------------------------------------------
// The loopback server: answers every request with the status and body given.
// ---------------------------------------------------------------------------

function startServer(status, body, contentType) {
  const server = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      res.writeHead(status, { "content-type": contentType || "text/plain" });
      res.end(body);
    });
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () =>
      resolve({ server, base: `http://127.0.0.1:${server.address().port}` }),
    ),
  );
}

const MODEL = "qwen3-coder:30b";

// 100KB of ONE non-digit character: nothing the body contributes can be
// mistaken for the elided-byte count.
const HUGE = "x".repeat(100 * 1024);
const HUGE_LEN = HUGE.length;

// The bound. Generous: "a few hundred bytes of body at most" plus wording.
const BOUND = 2048;

// The two halves of an elision marker.
const ELISION_WORD = /elid|truncat|omitt|trimm|\bcut\b|\bmore\b|\.\.\.|…/i;
const CUT_COUNT = /\d{4,}/;

const strip = (msg, base) => String(msg).split(base).join("<base>");

async function captureGenerate(status, body) {
  const srv = await startServer(status, body, "application/json");
  try {
    await generateInstruct({
      apiBase: srv.base,
      model: MODEL,
      prompt: "write a function",
      maxTokens: 64,
      temperature: 0.2,
      signal: new AbortController().signal,
    });
    return { base: srv.base, err: undefined };
  } catch (err) {
    return { base: srv.base, err };
  } finally {
    srv.server.close();
  }
}

async function capturePull(status, body) {
  const srv = await startServer(status, body, "application/x-ndjson");
  try {
    await pullModel(srv.base, MODEL, new AbortController().signal, () => {});
    return { base: srv.base, err: undefined };
  } catch (err) {
    return { base: srv.base, err };
  } finally {
    srv.server.close();
  }
}

const shown = (msg) => (msg.length > 400 ? `${msg.slice(0, 400)}... [${msg.length} chars total]` : msg);

function assertBounded(label, cap) {
  const { base, err } = cap;
  assert.ok(err, `${label}: a 500 must reject; it resolved instead`);
  const msg = String(err && err.message !== undefined ? err.message : err);
  const scan = strip(msg, base);

  assert.ok(
    msg.length <= BOUND,
    `contract 1 (${label}): "A misbehaving server answering with a 100KB body produces an error string of bounded length (a few hundred bytes of body at most)". ` +
      `The error string is ${msg.length} chars, over the ${BOUND}-char bound. Head: ${shown(msg)}`,
  );
  assert.ok(
    !msg.includes(HUGE),
    `contract 1 (${label}): the whole 100KB body is still inside the error string verbatim.`,
  );
  assert.ok(
    ELISION_WORD.test(scan),
    `contract 1 (${label}): "with an elision marker saying how much was cut". No elision word or ellipsis found. Got: ${shown(msg)}`,
  );
  assert.ok(
    CUT_COUNT.test(scan),
    `contract 1 (${label}): the elision marker must say HOW MUCH was cut (~${HUGE_LEN} chars), so a 4-or-more-digit count must appear. ` +
      `None found once the loopback base URL is stripped. Got: ${shown(scan)}`,
  );
  assert.ok(
    /500/.test(msg),
    `contract 1 (${label}): "status line preserved". No 500 in the error string. Got: ${shown(msg)}`,
  );
}

// ===========================================================================
// Contract 1: bounded bodies, both interpolation sites.
// ===========================================================================

test("C1a [generate path]: a 500 with a 100KB body yields a bounded error string with an elision marker, status preserved", async () => {
  assertBounded("generate", await captureGenerate(500, HUGE));
});

test("C1b [pull path]: a 500 with a 100KB body yields a bounded error string with an elision marker, status preserved", async () => {
  assertBounded("pull", await capturePull(500, HUGE));
});

// ===========================================================================
// The bound must not mangle a normal error: a SHORT body survives intact and
// carries no elision marker. (Contract non-behaviour: "one bounded string is
// acceptable for both" - bounded, not rewritten.)
// ===========================================================================

const SHORT = '{"error":"model qwen3-coder:30b not found, try pulling it first"}';

for (const [label, capture] of [
  ["generate", captureGenerate],
  ["pull", capturePull],
]) {
  test(`C1c [${label} path]: a SHORT body passes through intact, with no elision marker`, async () => {
    const cap = await capture(500, SHORT);
    assert.ok(cap.err, `${label}: a 500 must reject; it resolved instead`);
    const msg = String(cap.err.message !== undefined ? cap.err.message : cap.err);
    const scan = strip(msg, cap.base);
    assert.ok(
      msg.includes("not found, try pulling it first"),
      `contract 1 (${label}): the bound must not mangle a normal error - a short body stays intact. Got: ${shown(msg)}`,
    );
    assert.ok(
      !ELISION_WORD.test(scan),
      `contract 1 (${label}): nothing was cut, so no elision marker may appear. Got: ${shown(msg)}`,
    );
    assert.ok(
      !CUT_COUNT.test(scan.replace(/500/g, "")),
      `contract 1 (${label}): nothing was cut, so no cut-count may appear. Got: ${shown(scan)}`,
    );
  });
}

// ===========================================================================
// Contract 2 + 3: isServerUnreachable.
//
// Both shapes per code: the code top-level on `err.code`, and the undici shape
// the repo's own tests already use - TypeError("fetch failed") with
// `cause = { code }`.
// ===========================================================================

const topLevel = (code) => Object.assign(new Error(`connect ${code} 10.0.0.7:11434`), { code });
// NOT "fetch failed": that message alone classifies unreachable today, which
// would make every nested row pass without testing the code list at all.
const underCause = (code) =>
  Object.assign(new Error("connect failure to the ollama host"), { cause: { code } });
const undiciShape = (code) => Object.assign(new TypeError("fetch failed"), { cause: { code } });

const describe = (err) =>
  `Error(name=${err.name}, message=${JSON.stringify(err.message)}, code=${JSON.stringify(err.code)}, cause=${JSON.stringify(err.cause)})`;

for (const code of ["ETIMEDOUT", "EHOSTUNREACH", "UND_ERR_CONNECT_TIMEOUT"]) {
  vtest(`C2 [${code}]: classified unreachable, top-level and under cause`, () => {
    const top = topLevel(code);
    assert.strictEqual(
      V.isServerUnreachable(top),
      true,
      `contract 2: "isServerUnreachable additionally recognises ETIMEDOUT, EHOSTUNREACH and undici UND_ERR_* codes". ` +
        `Top-level ${code} was not recognised, so a remote mid-connect failure reaches the raw catch-all. ${describe(top)}`,
    );
    const nested = underCause(code);
    assert.strictEqual(
      V.isServerUnreachable(nested),
      true,
      `contract 2: "(including nested under cause, matching how the existing codes are matched)". ` +
        `${code} under cause was not recognised. Note the envelope message is deliberately NOT ` +
        `"fetch failed", which classifies on its own today and would hide this. ${describe(nested)}`,
    );
  });
}

vtest("C3 [regression]: ECONNREFUSED still classifies as unreachable, under cause and in the real undici envelope", () => {
  const nested = underCause("ECONNREFUSED");
  assert.strictEqual(
    V.isServerUnreachable(nested),
    true,
    `contract 3: "Existing recognised shapes keep working: ECONNREFUSED et al still classify as unreachable". ` +
      `The widening must not drop the cause-code leg. ${describe(nested)}`,
  );
  const undici = undiciShape("ECONNREFUSED");
  assert.strictEqual(
    V.isServerUnreachable(undici),
    true,
    `contract 3: this is the exact shape the shipped server-unreachable toast is driven by ` +
      `(test/blind-v56-p4-toast-translation.test.cjs). ${describe(undici)}`,
  );
});

vtest("C4 [falsification tail]: a random unrelated error does NOT classify as unreachable", () => {
  const plain = new Error("boom");
  assert.strictEqual(
    V.isServerUnreachable(plain),
    false,
    `falsification: "A random unrelated error still does NOT classify as unreachable". ${describe(plain)}`,
  );
  const eacces = topLevel("EACCES");
  assert.strictEqual(
    V.isServerUnreachable(eacces),
    false,
    `falsification: an unrelated code must not be swept in by the widening. ${describe(eacces)}`,
  );
  const eaccesNested = underCause("EACCES");
  assert.strictEqual(
    V.isServerUnreachable(eaccesNested),
    false,
    `falsification: an unrelated code under cause must not be swept in by the widening either - ` +
      `matching ANY cause.code would pass contract 2 and fail the product. ${describe(eaccesNested)}`,
  );
});
