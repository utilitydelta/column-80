// Implementer oracle, session-v56 phase 5 (roadmap item 63, second half):
// gaps the blind file leaves open.
//
// The blind file proves the two ends of the range - a 100KB body is cut with a
// marker, a short body is untouched - through the real transport entry points.
// What it cannot see, because it was written against the contract alone:
//   * THE BOUNDARY ITSELF. A body one char under the budget, exactly on it,
//     and one char over it. The one-over row is the only one that proves the
//     cut fires at the budget rather than at some larger convenience size.
//   * THE MARKER'S ARITHMETIC. The blind file only asks that four-or-more
//     digits appear. Here the kept head is pulled back out of the error string
//     and the stated count is checked against the chars actually dropped, so a
//     marker that reports the wrong amount goes red.
//   * MULTI-BYTE AT THE CUT POINT. Slicing a JS string by code unit can split
//     a surrogate pair. The cut is aimed straight at one and the string is
//     scanned for an orphaned half.
//   * THE DEGENERATE BODIES. Empty, and non-JSON: neither may be rewritten,
//     and neither may crash the interpolation.
//   * THE WHOLE CODE LIST, BOTH LEVELS. The blind file pins the three new
//     codes and ECONNREFUSED-under-cause. Every recognised code is driven here
//     at `err.code` and at `err.cause.code`, plus the near-misses that must
//     stay unrecognised.
//   * THE CODE LEG IN ISOLATION. `isServerUnreachable` returns true for a bare
//     TypeError("fetch failed") on the message alone. Every code row below
//     uses an envelope whose message cannot match, so a row that passes proves
//     the code leg and not the message leg.
//
// Run: node --test test/impl-v56-p5-bounded-bodies.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const path = require("node:path");
const fs = require("node:fs");
const esbuild = require("esbuild");
const { bundleCore } = require("./.blind-util.cjs");

// The transport, no vscode involved.
const core = bundleCore(
  "impl-v56-p5-core",
  `export { generateInstruct, pullModel } from "../src/core/ollama";\n`,
);
const { generateInstruct, pullModel } = core.mod;

// isServerUnreachable lives in the vscode layer, so the module needs a
// `vscode` to resolve against while it loads. Inert: this file only calls a
// pure classifier.
const STUB = path.join(__dirname, ".impl-v56-p5-stub.cjs");
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

const ENTRY = path.join(__dirname, ".impl-v56-p5.entry.ts");
const OUTFILE = path.join(__dirname, ".impl-v56-p5.bundle.cjs");
fs.writeFileSync(ENTRY, `export { isServerUnreachable } from "../src/vscode/fnGen";\n`);
esbuild.buildSync({
  entryPoints: [ENTRY],
  bundle: true,
  outfile: OUTFILE,
  format: "cjs",
  platform: "node",
  alias: { vscode: STUB },
});
const { isServerUnreachable } = require(OUTFILE);

test.after(() => {
  core.cleanup();
  for (const f of [STUB, ENTRY, OUTFILE]) fs.rmSync(f, { force: true });
});

// ---------------------------------------------------------------------------
// The loopback server and the two drives, same shape as the blind file.
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

/** Same as startServer, but the caller owns the HTTP reason phrase. Node puts
 *  no ceiling on it, so it is a server-controlled half of the error string
 *  exactly like the body is. */
function startServerWithReason(status, reason, body) {
  const server = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      res.writeHead(status, reason, { "content-type": "text/plain" });
      res.end(body);
    });
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () =>
      resolve({ server, base: `http://127.0.0.1:${server.address().port}` }),
    ),
  );
}

async function messageFrom(drive, body, contentType) {
  const srv = await startServer(500, body, contentType);
  try {
    await drive(srv.base);
    assert.fail("a 500 must reject; it resolved instead");
  } catch (err) {
    return String(err && err.message !== undefined ? err.message : err);
  } finally {
    srv.server.close();
  }
}

const generate = (body, contentType) =>
  messageFrom(
    (base) =>
      generateInstruct({
        apiBase: base,
        model: MODEL,
        prompt: "write a function",
        maxTokens: 64,
        temperature: 0.2,
        signal: new AbortController().signal,
      }),
    body,
    contentType || "application/json",
  );

const pull = (body, contentType) =>
  messageFrom(
    (base) => pullModel(base, MODEL, new AbortController().signal, () => {}),
    body,
    contentType || "application/x-ndjson",
  );

// The error template is `Ollama <status> <statusText>: <bounded body>`, so the
// body starts after the first ": ". The marker, when present, is the tail.
const MARKER = /^(.*) \[\+(\d+) chars elided\]$/s;

/** Splits an error message into the body part the transport interpolated and,
 *  if the body was cut, the head that survived plus the count the marker
 *  states. Nothing here assumes the budget's value: the boundary rows measure
 *  it rather than restate it. */
function dissect(msg) {
  const at = msg.indexOf(": ");
  assert.ok(at > 0, `no "Ollama <status> <text>: " prefix in: ${msg}`);
  const interpolated = msg.slice(at + 2);
  const m = MARKER.exec(interpolated);
  return m
    ? { interpolated, cut: true, kept: m[1], stated: Number(m[2]) }
    : { interpolated, cut: false, kept: interpolated, stated: 0 };
}

// The budget is MEASURED, not restated here: the head kept from a body far
// over it is the budget's own value. Measured once, on demand, so every row
// below stands on its own rather than on the row before it.
let budgetProbe;
const budget = () => (budgetProbe = budgetProbe || measureBudget());

async function measureBudget() {
  const body = "a".repeat(100000);
  const d = dissect(await generate(body));
  assert.ok(d.cut, `a 100000-char body must be cut. Got: ${d.interpolated.slice(0, 120)}`);
  assert.strictEqual(d.kept, body.slice(0, d.kept.length), "the kept head must be the body's own head");
  return d.kept.length;
}

// ===========================================================================
// The boundary. One under, exactly on, one over.
// ===========================================================================

test("a body far over the budget keeps a few hundred chars of head, no more", async () => {
  const kept = await budget();
  assert.ok(
    kept > 0 && kept <= 1024,
    `the kept head is ${kept} chars; the contract says "a few hundred bytes of body at most"`,
  );
});

test("a body one char UNDER the budget passes through whole, with no marker", async () => {
  const body = "b".repeat((await budget()) - 1);
  const d = dissect(await generate(body));
  assert.strictEqual(d.cut, false, `nothing was dropped, so no marker may appear: ${d.interpolated}`);
  assert.strictEqual(d.interpolated, body, "an under-budget body must arrive byte for byte");
});

test("a body EXACTLY at the budget passes through whole, with no marker", async () => {
  const body = "c".repeat(await budget());
  const d = dissect(await generate(body));
  assert.strictEqual(d.cut, false, `the budget is inclusive, so a body on it is not cut: ${d.interpolated}`);
  assert.strictEqual(d.interpolated, body, "a body exactly on the budget must arrive byte for byte");
});

test("a body one char OVER the budget is cut, and the marker says one char", async () => {
  const kept = await budget();
  const body = "d".repeat(kept + 1);
  const d = dissect(await generate(body));
  assert.ok(d.cut, "one char over the budget must trip the bound");
  assert.strictEqual(d.kept, body.slice(0, kept), "the head kept is the budget's worth");
  assert.strictEqual(d.stated, 1, "exactly one char was dropped, so the marker must say 1");
});

// ===========================================================================
// The marker's arithmetic: the stated count is what was actually dropped.
// ===========================================================================

for (const [label, drive] of [
  ["generate", generate],
  ["pull", pull],
]) {
  test(`[${label} path] the stated cut count equals the chars actually dropped`, async () => {
    const body = "e".repeat(64 * 1024 + 7);
    const d = dissect(await drive(body));
    assert.ok(d.cut, `${label}: a 64KB body must be cut`);
    assert.strictEqual(
      d.stated,
      body.length - d.kept.length,
      `${label}: the marker claims ${d.stated} chars elided, but ${body.length - d.kept.length} were dropped ` +
        `(${body.length} in, ${d.kept.length} kept). A count that does not match is worse than no count.`,
    );
    assert.strictEqual(d.kept, body.slice(0, d.kept.length), `${label}: the kept head must be the body's head`);
  });
}

// ===========================================================================
// Multi-byte at the cut point. The cut is aimed straight at a surrogate pair.
// ===========================================================================

const LONE_HIGH = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/;
const LONE_LOW = /(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

test("a surrogate pair straddling the cut is dropped whole, never split", async () => {
  // The emoji sits astride the cut: its two code units are the last kept and
  // the first dropped, so a naive slice keeps the high half and orphans it.
  const kept = await budget();
  const body = "f".repeat(kept - 1) + "\u{1F600}" + "g".repeat(50);
  const msg = await generate(body);
  const d = dissect(msg);
  assert.ok(d.cut, "the body is over the budget, so it must be cut");
  assert.ok(!LONE_HIGH.test(msg), `an orphaned high surrogate survived into the error string: ${JSON.stringify(d.kept.slice(-4))}`);
  assert.ok(!LONE_LOW.test(msg), `an orphaned low surrogate survived into the error string: ${JSON.stringify(d.kept.slice(-4))}`);
  assert.strictEqual(d.kept, body.slice(0, kept - 1), "the whole pair goes, so the head stops before it");
  assert.strictEqual(
    d.stated,
    body.length - d.kept.length,
    "dropping the orphan is still a drop: the count must include it",
  );
});

test("multi-byte characters clear of the cut are untouched", async () => {
  const body = '{"error":"modèle introuvable — 日本語 \u{1F600}"}';
  const d = dissect(await generate(body));
  assert.strictEqual(d.cut, false, "a short body is not cut whatever its encoding");
  assert.strictEqual(d.interpolated, body, "a short multi-byte body must arrive byte for byte");
});

// ===========================================================================
// The degenerate bodies.
// ===========================================================================

for (const [label, drive] of [
  ["generate", generate],
  ["pull", pull],
]) {
  test(`[${label} path] an EMPTY body still rejects with the status line, and gains no marker`, async () => {
    const msg = await drive("");
    assert.match(msg, /500/, `${label}: the status line must survive an empty body. Got: ${msg}`);
    const d = dissect(msg);
    assert.strictEqual(d.interpolated, "", `${label}: an empty body must stay empty, not become a marker or a placeholder`);
  });
}

test("a non-JSON body is interpolated verbatim when short", async () => {
  const body = "<html><head><title>502 Bad Gateway</title></head><body>nginx</body></html>";
  const d = dissect(await generate(body, "text/html"));
  assert.strictEqual(d.cut, false, "a short HTML body is under the budget");
  assert.strictEqual(d.interpolated, body, "the bound parses nothing; a non-JSON body passes through");
});

test("a long non-JSON body is cut like any other", async () => {
  const body = `<html><body>${"h".repeat(50000)}</body></html>`;
  const msg = await generate(body, "text/html");
  const d = dissect(msg);
  assert.ok(d.cut, "a 50KB HTML body must be cut");
  assert.ok(msg.length <= 1024, `the whole error string is ${msg.length} chars`);
  assert.strictEqual(d.stated, body.length - d.kept.length, "the count must match what was dropped");
});

// ===========================================================================
// isServerUnreachable: the whole code list, both levels.
//
// EVERY row uses an envelope whose message cannot match /fetch failed/, so a
// green row proves the CODE leg. `isolated` is a plain Error (not a TypeError)
// for the same reason twice over.
// ===========================================================================

const isolated = (extra) => Object.assign(new Error("the ollama call did not complete"), extra);
const RECOGNISED = [
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "UND_ERR_CONNECT_TIMEOUT",
];

// RE-CUT (P5 review MED 3): UND_ERR_HEADERS_TIMEOUT and UND_ERR_SOCKET were in
// this list while the classifier matched the whole UND_ERR_ prefix. They mean
// the server WAS reached, so they moved to NOT_UNREACHABLE below.
const NOT_UNREACHABLE = ["UND_ERR_SOCKET", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_ABORTED"];

test("a mid-stream socket close is not the server being down", () => {
  // The real shape: the server accepted the connection, streamed a token, then
  // the socket died. Offering "Start ollama serve" for a server that answered
  // sends the user to fix something that is not broken.
  const midStream = Object.assign(new TypeError("terminated"), {
    cause: { name: "SocketError", code: "UND_ERR_SOCKET", message: "other side closed" },
  });
  assert.strictEqual(isServerUnreachable(midStream), false);
});

test("only the connect-phase undici code classifies; the reached-the-server ones do not", () => {
  for (const code of NOT_UNREACHABLE) {
    assert.strictEqual(
      isServerUnreachable(isolated({ code })),
      false,
      `${code} means the server was reached, so it must not read as unreachable`,
    );
    assert.strictEqual(isServerUnreachable(isolated({ cause: { code } })), false, `${code} under cause`);
  }
  assert.strictEqual(isServerUnreachable(isolated({ code: "UND_ERR_CONNECT_TIMEOUT" })), true);
});

test("every recognised code classifies unreachable at err.code, on the code leg alone", () => {
  for (const code of RECOGNISED) {
    assert.strictEqual(
      isServerUnreachable(isolated({ code })),
      true,
      `top-level ${code} was not recognised. The envelope message cannot match /fetch failed/, so this row is the code leg.`,
    );
  }
});

test("every recognised code classifies unreachable at err.cause.code, on the code leg alone", () => {
  for (const code of RECOGNISED) {
    assert.strictEqual(
      isServerUnreachable(isolated({ cause: { code } })),
      true,
      `${code} under cause was not recognised. The envelope message cannot match /fetch failed/, so this row is the code leg.`,
    );
  }
});

test("the two levels agree: no code is recognised at one level and not the other", () => {
  for (const code of [...RECOGNISED, "EACCES", "ENOENT", "EPIPE", "EPERM"]) {
    assert.strictEqual(
      isServerUnreachable(isolated({ code })),
      isServerUnreachable(isolated({ cause: { code } })),
      `${code} classifies differently top-level than under cause. A half-wired list is how "the server is down" ` +
        `reaches one caller and the raw catch-all reaches another.`,
    );
  }
});

test("near misses stay unrecognised at both levels", () => {
  const misses = [
    "EACCES",
    "ENOENT",
    "EPIPE",
    "EPERM",
    "ERR_INVALID_ARG_TYPE",
    "NOT_UND_ERR_CONNECT",
    "und_err_connect_timeout", // codes are upper case; a lower-case one is not undici's
    "ETIMEDOUT_LOOKALIKE",
  ];
  for (const code of misses) {
    assert.strictEqual(isServerUnreachable(isolated({ code })), false, `top-level ${code} must not classify`);
    assert.strictEqual(
      isServerUnreachable(isolated({ cause: { code } })),
      false,
      `${code} under cause must not classify - matching ANY cause.code would pass the contract and fail the product`,
    );
  }
});

test("a non-string code is not read as a code", () => {
  // A DOMException carries a numeric legacy `code` (AbortError is 20). Reading
  // it as an errno string would classify a cancel as the server being down.
  for (const code of [20, undefined, null, { toString: () => "ETIMEDOUT" }, ["ETIMEDOUT"]]) {
    assert.strictEqual(
      isServerUnreachable(isolated({ code })),
      false,
      `a ${typeof code} code must not classify: ${String(code)}`,
    );
  }
});

test("non-error values and empty shapes do not classify", () => {
  for (const value of [undefined, null, "ECONNREFUSED", 7, {}, { cause: undefined }, { cause: {} }]) {
    assert.strictEqual(
      isServerUnreachable(value),
      false,
      `${JSON.stringify(value) ?? String(value)} must not classify as unreachable`,
    );
  }
});

test("the message leg is still there: a bare fetch-failed TypeError classifies with no code at all", () => {
  // Pinned, not changed: Node reports a connection failure this way when no
  // cause is surfaced, and the shipped server-unreachable toast depends on it.
  assert.strictEqual(isServerUnreachable(new TypeError("fetch failed")), true);
  assert.strictEqual(
    isServerUnreachable(new Error("fetch failed")),
    false,
    "the message leg is TypeError-only; widening it to any Error is not this contract's work",
  );
});

// ---------------------------------------------------------------------------
// P5 review MED 1: the reason phrase is the OTHER server-controlled half. The
// phase bounded the body and left this one open, so a 2-char body still made a
// 6015-char one-line error string that firstLine cannot shorten.
// ---------------------------------------------------------------------------

async function messageWithReason(drive, reason, body) {
  const srv = await startServerWithReason(500, reason, body);
  try {
    await drive(srv.base);
    assert.fail("a 500 must reject; it resolved instead");
  } catch (err) {
    return String(err && err.message !== undefined ? err.message : err);
  } finally {
    srv.server.close();
  }
}

const REASON_DRIVES = [
  [
    "generate path",
    (base) =>
      generateInstruct({
        apiBase: base,
        model: MODEL,
        prompt: "write a function",
        maxTokens: 64,
        temperature: 0.2,
        signal: new AbortController().signal,
      }),
  ],
  ["pull path", (base) => pullModel(base, MODEL, new AbortController().signal, () => {})],
];

for (const [name, drive] of REASON_DRIVES) {
  test(`[${name}] a 6000-char HTTP reason phrase does not escape the bound`, async () => {
    const msg = await messageWithReason(drive, "R".repeat(6000), "no");
    assert.ok(
      msg.length < 900,
      `the reason phrase escaped the bound: the whole error string is ${msg.length} chars`,
    );
    assert.ok(/500/.test(msg), "the status number survives the bound");
    assert.ok(/\[\+\d+ chars elided\]/.test(msg), "the cut reason phrase states how much went");
    assert.ok(msg.includes("no"), "the short body is still there, uncut");
  });

  test(`[${name}] an ordinary reason phrase is left alone`, async () => {
    const msg = await messageWithReason(drive, "Internal Server Error", "no");
    assert.ok(msg.includes("Internal Server Error"), `the reason phrase was mangled: ${msg}`);
    assert.ok(!/chars elided/.test(msg), "nothing was cut, so no marker");
  });
}
