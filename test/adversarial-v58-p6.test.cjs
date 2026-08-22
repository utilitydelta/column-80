// Adversarial review: session-v58 phase 6, the structural pass that lets the
// Claude Code backend speak through its own `reason`
// (src/vscode/fnGen.ts, `CLAUDE_CODE_SENTENCES` / `translateStructural`).
//
// Written AFTER the implementation and after the blind oracle
// (test/blind-v58-p6-claude-code-reasons.test.cjs, 65 rows green). Its job is
// the opposite of the oracle's: every row here is an attempt to break the
// thing, and a row that stays green is a claim of CLEAN, not decoration.
//
// Contract: session-v58/contract-phase6.md.
//
// ---------------------------------------------------------------------------
// HOW THE NARROWING CLAIM IS PROVEN HERE
// ---------------------------------------------------------------------------
//
// C2 ("adding this pass must not change any message that is not a
// ClaudeCodeError") protects five phases of v56/v57 translation work. The blind
// oracle proves it against a 41-row golden table it wrote down before the
// change. This file proves it differently and wider: it materialises the BRANCH
// POINT's own `src/` out of git, bundles that `fnGen.ts` beside the working
// tree's, and runs both over a generated corpus. Nothing is written down, so
// nothing can be written down wrong; a difference of one byte on any non-
// ClaudeCodeError input is a red row with both strings in the message.
//
// The baseline ref is PINNED rather than `HEAD`. Once phase 6 is committed,
// `HEAD` carries the change and a `HEAD` baseline would make this row compare
// the pass against itself and pass vacuously.
//
// Run: node --test test/adversarial-v58-p6.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const cp = require("node:child_process");
const esbuild = require("esbuild");

const ROOT = path.dirname(__dirname);

/** The branch point: session-v58 phase 5, the last commit before the structural
 *  pass. Pinned, see the header. */
const BASE_REF = "3831d3c";

// ---------------------------------------------------------------------------
// The vscode stub: blind-v58-p6's stub, verbatim, for the reason that file
// gives - only pure string functions are needed out of src/vscode/fnGen.ts, but
// its module graph touches most of the vscode API at import time.
// ---------------------------------------------------------------------------

const STUB = path.join(__dirname, ".adv-v58-p6-stub.cjs");
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

// ---------------------------------------------------------------------------
// Two bundles: the working tree's translator, and the branch point's.
// ---------------------------------------------------------------------------

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "adv-v58-p6-"));
const artifacts = [STUB];

function bundle(tag, entrySource) {
  const entry = path.join(__dirname, `.adv-v58-p6-${tag}.entry.ts`);
  const outfile = path.join(__dirname, `.adv-v58-p6-${tag}.bundle.cjs`);
  artifacts.push(entry, outfile);
  fs.writeFileSync(entry, entrySource);
  esbuild.buildSync({
    entryPoints: [entry],
    bundle: true,
    outfile,
    format: "cjs",
    platform: "node",
    alias: { vscode: STUB },
  });
  return require(outfile);
}

let NOW = {};
let BASE = {};
let baseSource = "";
let setupErr;
try {
  // `git archive` rather than a checkout: it writes the tree somewhere else and
  // never touches the working copy. Every bare import under src/ is a node
  // builtin (verified), so the extracted tree needs no node_modules beside it.
  cp.execSync(`git archive ${BASE_REF} src | tar -x -C ${JSON.stringify(TMP)}`, {
    cwd: ROOT,
    shell: "/bin/bash",
    stdio: ["ignore", "ignore", "pipe"],
  });
  baseSource = fs.readFileSync(path.join(TMP, "src/vscode/fnGen.ts"), "utf8");
  NOW = bundle(
    "now",
    `export { generationFailedToast, translateServiceReject } from "../src/vscode/fnGen";\n` +
      `export { ClaudeCodeError, makeClaudeCodeInstruct, MIN_PREFIX_BYTES } from "../src/core/claudeCodeInstruct";\n` +
      `export { SECTION_SEPARATOR } from "../src/core/prompt";\n`,
  );
  BASE = bundle(
    "base",
    `export { generationFailedToast, translateServiceReject } from ${JSON.stringify(
      path.join(TMP, "src/vscode/fnGen"),
    )};\n`,
  );
} catch (e) {
  setupErr = e;
}

// The fake CLI lives in its own directory, which is also the neutral cwd the
// backend is spawned in.
const CLIDIR = fs.mkdtempSync(path.join(os.tmpdir(), "adv-v58-p6-cli-"));

test.after(() => {
  for (const f of artifacts) fs.rmSync(f, { force: true });
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.rmSync(CLIDIR, { recursive: true, force: true });
});

const GESTURE = "function generation";
const toast = (err) => NOW.generationFailedToast(err, GESTURE);
const short = (s) => (typeof s === "string" && s.length > 300 ? `${s.slice(0, 300)}... (${s.length} chars)` : s);
const show = (v) => JSON.stringify(short(v));

// ---------------------------------------------------------------------------
// The fake CLI: a /bin/sh script that writes chosen bytes and exits with a
// chosen code. Payloads go through files so no shell quoting can mangle them.
// ---------------------------------------------------------------------------

let seq = 0;
function fakeCli(stdout, stderr, code) {
  const n = seq++;
  const so = path.join(CLIDIR, `out-${n}.txt`);
  const se = path.join(CLIDIR, `err-${n}.txt`);
  const sh = path.join(CLIDIR, `cli-${n}.sh`);
  fs.writeFileSync(so, stdout);
  fs.writeFileSync(se, stderr);
  fs.writeFileSync(
    sh,
    `#!/bin/sh\ncat ${JSON.stringify(so)}\ncat ${JSON.stringify(se)} >&2\nexit ${code}\n`,
    { mode: 0o755 },
  );
  return sh;
}

async function drive(config, params) {
  const gen = NOW.makeClaudeCodeInstruct({ cwd: CLIDIR, timeoutMs: 8000, log: () => {}, ...config });
  try {
    const value = await gen({
      apiBase: "",
      model: "",
      prompt: "write a function that adds two integers",
      maxTokens: 256,
      temperature: 0,
      signal: new AbortController().signal,
      ...params,
    });
    return { ok: true, value };
  } catch (err) {
    return {
      ok: false,
      err,
      reason: err && err.reason,
      message: err instanceof Error ? err.message : String(err),
      toast: NOW.generationFailedToast(err, GESTURE),
    };
  }
}

// ---------------------------------------------------------------------------
// The corpus for the narrowing rows. Generated, never written down: every
// marker in the reject table and every payload-carrier head, each put through
// ten decorations, plus the shapes that are not Errors at all.
// ---------------------------------------------------------------------------

const MARKERS = [
  "Ollama stream cut:",
  "Ollama: response has no body",
  "Anthropic: the stream ended before message_stop",
  "Anthropic: response has no body",
  "Cloud: response has no body",
  "Ollama: the stream ended before its done frame",
  "Cloud: the stream ended before any terminal signal",
  "generation truncated at num_predict",
  "does not contain a test module",
  "test functions (no fenced block",
  "generation contains a code-fence line",
  "generation does not contain the requested function",
  "generation was empty after postprocess",
  "Ollama error:",
  "Ollama ",
  "Anthropic reported an error mid-reply:",
  "Anthropic ",
  "Cloud reported an error mid-reply:",
  "Cloud ",
];

const LS = String.fromCharCode(0x2028);
const NEL = String.fromCharCode(0x85);
/** Built rather than written: a raw U+2028 in a regex literal is a parse error. */
const BREAK_RE = new RegExp("\\r\\n|[\\n\\r\\u2028\\u2029\\u0085]");

const DECORATIONS = [
  (s) => s,
  (s) => `${s} and then some trailing detail`,
  (s) => `some prefix ${s}`,
  (s) => `Error: ${s}`,
  (s) => `Claude Code exited 1: ${s}`,
  (s) => s.toUpperCase(),
  (s) => `Ollama 503 Service Unavailable: {"error":"${s}"}`,
  (s) => `Cloud reported an error mid-reply: ${s}`,
  (s) => `Anthropic 429 Too Many Requests: ${s}`,
  (s) => `${s}\nsecond line${LS}third${NEL}fourth`,
];

function errorCorpus() {
  const out = [];
  for (const m of MARKERS) for (const d of DECORATIONS) out.push([`Error(${show(d(m))})`, new Error(d(m))]);
  const named = new Error("generation was empty after postprocess");
  named.name = "ClaudeCodeError"; // C5's forgery: the name without the class
  out.push(["forged name, real marker", named]);
  const withReason = new Error("Claude Code exited 1: Error: connection closed");
  withReason.reason = "logged-out"; // a reason without the name
  out.push(["reason without the name", withReason]);
  out.push(["TypeError carrying a marker", new TypeError("Ollama stream cut: t")]);
  out.push(["empty message", new Error("")]);
  out.push(["message of breaks only", new Error(`\r\n${LS}${NEL}`)]);
  return out;
}

function nonErrorCorpus() {
  return [
    ["a plain string", "plain string"],
    ["a string carrying a marker", "Ollama stream cut: x"],
    ["a number", 42],
    ["zero", 0],
    ["null", null],
    ["undefined", undefined],
    ["true", true],
    ["false", false],
    ["an empty object", {}],
    ["an object with a message field", { message: "Ollama stream cut: y" }],
    ["an array", [1, 2]],
    ["a symbol", Symbol("Ollama stream cut: z")],
    ["a function", () => {}],
    ["a date", new Date(0)],
    ["an object whose toString is a marker", { toString: () => "generation was empty after postprocess" }],
    ["an object with a null prototype", Object.assign(Object.create(null), {})],
  ];
}

/** Both exported entry points, on both bundles, for one input. */
function compare(label, value, failures) {
  const call = (mod, fn) => {
    try {
      return `ok:${JSON.stringify(fn(mod))}`;
    } catch (e) {
      return `threw:${e instanceof Error ? e.message : String(e)}`;
    }
  };
  const probes = [
    ["translateServiceReject", (m) => m.translateServiceReject(value)],
    ["generationFailedToast/fn", (m) => m.generationFailedToast(value, "function generation")],
    ["generationFailedToast/test", (m) => m.generationFailedToast(value, "test generation")],
  ];
  for (const [name, fn] of probes) {
    const before = call(BASE, fn);
    const after = call(NOW, fn);
    if (before !== after) {
      failures.push(`${label} via ${name}\n    branch point: ${short(before)}\n    working tree: ${short(after)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// harness
// ---------------------------------------------------------------------------

test("G1 [harness/two bundles]: the branch point and the working tree both build, and the baseline predates the pass", () => {
  assert.strictEqual(setupErr, undefined, `setup failed: ${setupErr && setupErr.message}`);
  for (const name of ["translateServiceReject", "generationFailedToast"]) {
    assert.strictEqual(typeof NOW[name], "function", `working tree must export ${name}`);
    assert.strictEqual(typeof BASE[name], "function", `branch point must export ${name}`);
  }
  assert.strictEqual(typeof NOW.makeClaudeCodeInstruct, "function");
  assert.strictEqual(typeof NOW.ClaudeCodeError, "function");
  // If this fails the pinned ref has moved past the change and every narrowing
  // row below would be comparing the pass against itself.
  assert.ok(
    !baseSource.includes("CLAUDE_CODE_SENTENCES"),
    `${BASE_REF} already carries the structural pass; the baseline ref must be re-pinned to the commit before it`,
  );
  assert.ok(
    // In the working tree the pass lives in `src/vscode/failureToast.ts`;
    // session-v59 phase 1 lifted it out of fnGen.ts. `baseSource` above still
    // reads the branch point's fnGen.ts, which is where it was then.
    fs.readFileSync(path.join(ROOT, "src/vscode/failureToast.ts"), "utf8").includes("CLAUDE_CODE_SENTENCES"),
    "the working tree must carry the structural pass or there is nothing here to review",
  );
});

// ---------------------------------------------------------------------------
// C2: the narrowing claim, against the branch point itself
// ---------------------------------------------------------------------------

test("CLEAN [narrow/every marker and carrier, ten decorations each]: byte-identical to the branch point", () => {
  const corpus = errorCorpus();
  assert.ok(corpus.length >= 190, `harness: the corpus shrank to ${corpus.length}`);
  const failures = [];
  for (const [label, value] of corpus) compare(label, value, failures);
  assert.deepStrictEqual(failures, [], `the pass changed a non-ClaudeCodeError message:\n  ${failures.join("\n  ")}`);
});

test("CLEAN [narrow/non-Error rejects]: the same clause, off the Error path", () => {
  const failures = [];
  for (const [label, value] of nonErrorCorpus()) compare(label, value, failures);
  assert.deepStrictEqual(failures, [], `the pass changed a non-Error reject:\n  ${failures.join("\n  ")}`);
});

test("CLEAN [narrow/an unrecognised reason is indistinguishable from the branch point]", () => {
  const failures = [];
  for (const reason of ["no-session", "wat", "", "EXIT", "Logged-Out", "logged-out "]) {
    const err = new NOW.ClaudeCodeError(reason, "Claude Code exited 1: Error: connection closed");
    compare(`ClaudeCodeError(${JSON.stringify(reason)})`, err, failures);
  }
  assert.deepStrictEqual(failures, [], `an unlisted reason must get exactly today's answer:\n  ${failures.join("\n  ")}`);
});

// ---------------------------------------------------------------------------
// The identity check
// ---------------------------------------------------------------------------

test("CLEAN [identity/a subclass is still a Claude Code failure]", () => {
  class Wrapped extends NOW.ClaudeCodeError {}
  const sentence = NOW.translateServiceReject(new Wrapped("logged-out", "Claude Code is not logged in."));
  assert.ok(sentence !== undefined && /log/i.test(sentence), `a subclass must be recognised. Got ${show(sentence)}`);
});

test("CLEAN [identity/a Proxy around a real failure is still recognised]", () => {
  const real = new NOW.ClaudeCodeError("logged-out", "Claude Code is not logged in.");
  assert.strictEqual(
    NOW.translateServiceReject(new Proxy(real, {})),
    NOW.translateServiceReject(real),
    "a transparent Proxy must not change the sentence",
  );
});

test("ACCEPTED [identity/a cross-realm ClaudeCodeError falls through]: narrows only, so pinned rather than filed", () => {
  const vm = require("node:vm");
  const alien = vm.runInNewContext(
    "const e = new Error('Claude Code is not logged in.'); e.name = 'ClaudeCodeError'; e.reason = 'logged-out'; e",
    vm.createContext({}),
  );
  assert.strictEqual(alien instanceof Error, false, "precondition: a cross-realm Error fails instanceof");
  assert.strictEqual(
    NOW.translateServiceReject(alien),
    undefined,
    "pinned: `err instanceof Error` is realm-local, so a cross-realm failure gets the catch-all",
  );
  // The RIGHT answer: nothing in this extension makes an error in another
  // realm, so this cannot happen in the product, and when it cannot be
  // recognised it degrades to today's behaviour rather than to a wrong
  // sentence. Pinned so a future realm boundary (a worker, a vm-hosted plugin
  // host) turns this row red instead of quietly losing every sentence.
});

test("ACCEPTED [identity/a name reassigned after construction loses the sentence]", () => {
  const err = new NOW.ClaudeCodeError("exit", "Claude Code exited 1: Error: connection closed");
  err.name = "Error";
  assert.strictEqual(
    NOW.translateServiceReject(err),
    undefined,
    "pinned: identity is read off `name`, which is writable",
  );
  // Nothing in src/ reassigns `name` on a ClaudeCodeError, so this is not
  // reachable today. It is pinned because the stated reason for matching on
  // `name` - "identifies the class without an import" - does not apply in
  // fnGen.ts, which already imports makeClaudeCodeInstruct from the same
  // module. `err instanceof ClaudeCodeError` would be strictly stronger here
  // and would survive this.
});

test("ACCEPTED [identity/an object grafted onto Error.prototype draws a sentence]", () => {
  const fake = Object.create(Error.prototype);
  fake.name = "ClaudeCodeError";
  fake.reason = "logged-out";
  fake.message = "anything at all";
  assert.ok(
    NOW.translateServiceReject(fake) !== undefined,
    "pinned: instanceof + name + reason is satisfiable without the constructor",
  );
  // NOT a C5 violation: C5 is about a CLI or a server putting words in its
  // OUTPUT, and output only ever arrives as text. Forging this shape takes code
  // running in the extension host, which has strictly larger powers already.
});

// ---------------------------------------------------------------------------
// The map lookup
// ---------------------------------------------------------------------------

const INHERITED = ["toString", "valueOf", "constructor", "hasOwnProperty", "isPrototypeOf", "propertyIsEnumerable"];

/** A ClaudeCodeError whose `reason` is a value outside the union. The union is
 *  erased at runtime, which is exactly why contract falsifier 5 exists. */
function withReason(reason, message) {
  const err = new NOW.ClaudeCodeError("exit", message);
  Object.defineProperty(err, "reason", { value: reason, writable: true, configurable: true });
  return err;
}

test("CLEAN [map/inherited keys are not live entries]: a reason named after Object.prototype degrades to the catch-all", () => {
  const message = "Claude Code exited 1: Error: connection closed";
  const expected = NOW.generationFailedToast(new Error(message), GESTURE);
  const bad = [];
  for (const reason of INHERITED) {
    let got;
    try {
      got = NOW.generationFailedToast(withReason(reason, message), GESTURE);
    } catch (e) {
      got = `THREW ${e instanceof Error ? e.message : String(e)}`;
    }
    if (got !== expected) bad.push(`reason ${JSON.stringify(reason)} -> ${show(got)}`);
  }
  assert.deepStrictEqual(
    bad,
    [],
    "contract falsifier 5: a reason not in the union must get today's catch-all. " +
      "`CLAUDE_CODE_SENTENCES[reason]` is an object literal, so every Object.prototype member is a live entry: " +
      '"constructor" returns the raw message with its `Error:` token intact (C3), "toString" toasts ' +
      '"[object Object]", "hasOwnProperty" returns a boolean where a string belongs. ' +
      `An own-property check, Object.create(null) or a Map closes all of them.\n  ${bad.join("\n  ")}`,
  );
});

test("CLEAN [map/__proto__ does not throw out of the failure handler]: the toast builder always returns", () => {
  const err = withReason("__proto__", "Claude Code exited 1: Error: connection closed");
  assert.doesNotThrow(
    () => NOW.generationFailedToast(err, GESTURE),
    "`CLAUDE_CODE_SENTENCES.__proto__` is Object.prototype - an object, so `?.()` does not guard it and the " +
      "lookup raises TypeError. generationFailedToast is called from inside the gesture's own catch block, so " +
      "the user gets no toast at all. The same holds for `__defineGetter__` and friends. " +
      "The function's own comment says a bad shape 'must not ... crash the translator'.",
  );
});

// ---------------------------------------------------------------------------
// The could-not-start exception
// ---------------------------------------------------------------------------

/** Every configuration key the extension actually contributes. */
const SETTINGS = (() => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const c = pkg.contributes && pkg.contributes.configuration;
  const props = Array.isArray(c) ? Object.assign({}, ...c.map((x) => x.properties || {})) : (c && c.properties) || {};
  return Object.keys(props);
})();

test("CLEAN [start/the binary sentence names no setting the product does not contribute]", () => {
  const sentence = toast(
    new NOW.ClaudeCodeError("binary-missing", "Claude Code could not start: `claude` is not on PATH."),
  );
  const claimsASetting = /\bsetting\b/i.test(sentence);
  const exists = SETTINGS.some((k) => /binary|executable|cliPath|claudePath/i.test(k));
  assert.ok(
    !claimsASetting || exists,
    "the sentence sends the user to a setting that does not exist. The extension contributes " +
      `${SETTINGS.length} keys and none of them names the binary; the name is resolved by probing a fixed ` +
      "candidate list (`claude`, `claude.cmd`, `claude.exe`) in resolveClaudeBinary, not from configuration. " +
      "The honest next action is the one the tier-disabled message already uses - put `claude` on PATH. " +
      `Got: ${show(sentence)}`,
  );
});

test("CLEAN [start/the working-directory sentence names no setting the product does not contribute]", () => {
  const sentence = toast(
    new NOW.ClaudeCodeError(
      "bad-cwd",
      "Claude Code could not start: its working directory /home/u/.config/Code/User/globalStorage/x/claude-cwd does not exist.",
    ),
  );
  const claimsASetting = /\bsetting\b/i.test(sentence);
  const exists = SETTINGS.some((k) => /cwd|workingDir|directory|storage/i.test(k));
  assert.ok(
    !claimsASetting || exists,
    "worse than its sibling: the directory is not user-chosen at all. It is " +
      "`globalStorageUri/claude-cwd`, created by buildClaudeCodeFnGenService, so there is no setting to check " +
      "and the user has no way to act on this sentence. A reload rebuilds the service and recreates the " +
      `directory, which is the real remedy. Got: ${show(sentence)}`,
  );
});

test("CLEAN [start/the seventh throw is its own reason and its own sentence]: live, no errno on screen", async () => {
  // RE-CUT. The first cut of this row was red: the throw carried reason `exit`,
  // so a backend that never spawned landed in the shared CLI-failed group and
  // the user read "the Claude Code CLI failed" about a binary that never ran.
  // It is now `spawn-failed` with a could-not-start sentence of its own.
  //
  // The grouping is what this row guards, NOT the cause. I argued the errno was
  // the most actionable of the three could-not-start causes and belonged on
  // screen; triage overruled that and the distinction holds - the two ENOENT
  // siblings earn their interpolation because their messages are product prose
  // end to end, while this one interpolates Node's own ErrnoException. So the
  // ban list below is the point of the row, alongside the grouping.
  const notExecutable = path.join(CLIDIR, "not-executable");
  fs.writeFileSync(notExecutable, "#!/bin/sh\nexit 0\n", { mode: 0o644 });
  const got = await drive({ binary: notExecutable });
  assert.strictEqual(got.ok, false, "precondition: a non-executable binary must fail the round");
  assert.strictEqual(
    got.reason,
    "spawn-failed",
    `a spawn failure that is not ENOENT has its own reason. Got ${got.reason} / ${show(got.message)}`,
  );
  // The message is the channel's copy and did not move with the reason.
  assert.match(got.message, /^Claude Code could not start: /, `precondition: ${show(got.message)}`);
  assert.match(got.message, /EACCES|EPERM|EMFILE/, `precondition: the channel still gets the errno. ${show(got.message)}`);

  assert.match(got.toast, /could not start/, `the sentence must say the backend never started. Got ${show(got.toast)}`);
  assert.ok(
    !/CLI failed/.test(got.toast),
    `a binary that never ran is not a CLI that failed. Got ${show(got.toast)}`,
  );
  for (const banned of ["EACCES", "spawn ", "not-executable", CLIDIR]) {
    assert.ok(
      !got.toast.includes(banned),
      `${JSON.stringify(banned)} is Node's diagnostic, not product prose, and must stay in the channel. ` +
        `Got ${show(got.toast)}`,
    );
  }
  assert.match(got.toast, /output channel/, `and the cause it withholds must be pointed at. Got ${show(got.toast)}`);
});

test("CLEAN [start/spawn-failed is not degradable]: an unspawnable binary is not retried against itself", async () => {
  // The consequence of the reason change, and the half of it that is not about
  // wording: `exit` is in DEGRADABLE, so a fork round that could not spawn used
  // to clear a live checkpoint and re-run the WHOLE prompt against the same
  // unspawnable binary. `spawn-failed` is deliberately outside that set.
  const notExecutable = path.join(CLIDIR, "not-executable-degrade");
  fs.writeFileSync(notExecutable, "#!/bin/sh\nexit 0\n", { mode: 0o644 });
  const lines = [];
  const prefix = "// context block\n".repeat(Math.ceil((NOW.MIN_PREFIX_BYTES + 64) / 17));
  const prompt = `${prefix}${NOW.SECTION_SEPARATOR}write a function that adds two integers`;
  const got = await drive({ binary: notExecutable, log: (l) => lines.push(l) }, { cachePrefix: prefix, prompt });
  assert.strictEqual(got.reason, "spawn-failed", `precondition: got ${got.reason}`);
  assert.ok(
    !lines.some((l) => l.includes("degraded")),
    `a spawn failure must not buy a second round. Channel said:\n  ${lines.join("\n  ")}`,
  );
});

test("CLEAN [start/an exotic line break that cuts the cause leaves the channel pointer]", () => {
  const sentence = toast(
    new NOW.ClaudeCodeError("bad-cwd", `Claude Code could not start: its working directory /a${LS}b does not exist.`),
  );
  assert.ok(
    /output channel/.test(sentence),
    "the two could-not-start sentences interpolate `firstLine(message)` and never append the pointer, so when " +
      "the cut drops content the user reads a truncated path and is not told where the rest is. Every other " +
      "interpolating toast in the product goes through `oneLineWithPointer`, which appends the pointer exactly " +
      `when the cut removed something. LOW: the path is globalStorage-derived, so a break in it is remote. Got: ${show(sentence)}`,
  );
});

test("CLEAN [start/toastText's firstLine is the one in scope]: every break in the widened set is consumed", () => {
  const breaks = ["\n", "\r\n", "\r", LS, String.fromCharCode(0x2029), NEL];
  for (const b of breaks) {
    const sentence = toast(
      new NOW.ClaudeCodeError("bad-cwd", `Claude Code could not start: its working directory /a${b}b does not exist.`),
    );
    assert.strictEqual(
      sentence.split(BREAK_RE).length,
      1,
      `a break U+${b.charCodeAt(b.length - 1).toString(16)} reached the notification: ${show(sentence)}`,
    );
  }
  // claudeCodeInstruct has its own private firstLine that splits on "\n"
  // alone, and it is NOT the one these two sentences use: a bare CR would
  // survive it. This row is what says the widened set is in scope.
});

test("CLEAN [start/the cause the two exception sentences put on screen is product prose]", () => {
  // The only two values either message interpolates are `config.binary` and
  // `config.cwd`, and neither is attacker-controlled: the binary is one of
  // three literals from resolveClaudeBinary's candidate list, the cwd is
  // `globalStorageUri/claude-cwd`. No CLI output reaches either.
  const fromCli = fakeCli("", "", 0);
  assert.ok(fs.existsSync(fromCli), "harness");
  const sentence = toast(
    new NOW.ClaudeCodeError("binary-missing", "Claude Code could not start: `claude` is not on PATH."),
  );
  for (const banned of ["Error:", "subtype=", "exited"]) {
    assert.ok(!sentence.includes(banned), `${banned} must never reach a notification. Got ${show(sentence)}`);
  }
});

// ---------------------------------------------------------------------------
// Sentence quality against the contract's own table
// ---------------------------------------------------------------------------

test("CLEAN [serving/the discarded diagnostic is pointed at]: live", async () => {
  // A real Claude Code throttle: the CLI names the limit and when it resets.
  const got = await drive({
    binary: fakeCli("", "Claude AI usage limit reached|1735689600\n", 1),
  });
  assert.strictEqual(got.reason, "serving-failure", `precondition: got ${got.reason} / ${show(got.message)}`);
  assert.match(got.message, /usage limit reached/, "precondition: the throw carries the CLI's own reason");
  assert.ok(
    /output channel/.test(got.toast),
    "the serving-failure sentence says \"wait a moment, then run the gesture again\" and stops there. Three of " +
      "the ten throw sites feed it and all three interpolate real diagnostic text - `firstLine(diagnostics)`, " +
      "`api_error_status`, `firstLine(reply.result)` - which the sentence discards without saying where it " +
      "went. \"Wait a moment\" is wrong advice for a five-hour quota reset, and the line that would tell the " +
      "user which one they hit is in the channel with nothing pointing at it. The CLI-failed family gets the " +
      `pointer for exactly this reason. Got: ${show(got.toast)}`,
  );
});

test("ACCEPTED [family/agentic reads as a CLI failure]: contract-sanctioned, recorded as a wording call", () => {
  const agentic = toast(
    new NOW.ClaudeCodeError("agentic", "Claude Code took 4 turns; that reply is an agent transcript, not a generation."),
  );
  const exited = toast(new NOW.ClaudeCodeError("exit", "Claude Code exited 1: Error: connection closed"));
  assert.strictEqual(agentic, exited, "pinned: the contract's table puts the two in one group");
  // The CLI did not fail on an `agentic` round: it answered, well-formed, and
  // the product rejected the answer. The sentence's only next action is "read
  // the channel", where every sibling reject in the table says "run the gesture
  // again" - and a rerun is exactly what fixes a stray multi-turn reply.
  // Contract-sanctioned, so pinned rather than filed; it turns red if the group
  // is split.
});

test("CLEAN [timeout/the advice matches a child that has been killed]: live", async () => {
  const slow = path.join(CLIDIR, "slow.sh");
  // `exec`, not a bare `sleep`: the backend SIGKILLs the pid it spawned, which
  // is the shell. Without exec the shell's own `sleep` child survives it,
  // inherits the stdio pipes, and holds this process's event loop open for its
  // full duration long after every row has reported.
  fs.writeFileSync(slow, "#!/bin/sh\nexec sleep 30\n", { mode: 0o755 });
  const started = Date.now();
  const got = await drive({ binary: slow, timeoutMs: 300 });
  const elapsed = Date.now() - started;
  assert.strictEqual(got.reason, "timeout", `precondition: got ${got.reason} / ${show(got.message)}`);
  assert.ok(elapsed < 8000, `the round must end at the bound, not at the sleep. Took ${elapsed}ms`);
  assert.match(got.toast, /did not answer in time/, show(got.toast));
  // spawnClaude SIGKILLs the child before it builds this failure, so "check
  // that the CLI still responds" is advice about the next round rather than
  // about a process still burning quota. It is also the only sentence that
  // carries two next actions, and both are true.
  assert.ok(!/\b300\b/.test(got.toast), `the bound is an implementation number, not user language: ${show(got.toast)}`);
});

// ---------------------------------------------------------------------------
// Reachability
// ---------------------------------------------------------------------------

const UNION = [
  "binary-missing",
  "bad-cwd",
  "logged-out",
  "serving-failure",
  "agentic",
  "cli-error",
  "exit",
  "bad-json",
  "spawn-failed",
  "no-session",
  "timeout",
];

test("CLEAN [reach/every reason but no-session draws a sentence]", () => {
  const drawn = UNION.filter(
    (r) => NOW.translateServiceReject(new NOW.ClaudeCodeError(r, "Claude Code exited 1: Error: connection closed")) !== undefined,
  );
  assert.deepStrictEqual(
    drawn,
    UNION.filter((r) => r !== "no-session"),
    "every reason that can reach a round failure needs a sentence, and the one that cannot must not have one",
  );
});

test("CLEAN [reach/no-session degrades to a whole-prompt round instead of failing]: live", async () => {
  const counter = path.join(CLIDIR, "turns.txt");
  fs.rmSync(counter, { force: true });
  const noSession = JSON.stringify({ result: "understood", subtype: "success", num_turns: 1 });
  const good = JSON.stringify({
    result: "fn add(a: i32, b: i32) -> i32 {\n    a + b\n}",
    subtype: "success",
    num_turns: 1,
    session_id: "s-2",
  });
  const outA = path.join(CLIDIR, "ns-a.json");
  const outB = path.join(CLIDIR, "ns-b.json");
  fs.writeFileSync(outA, noSession);
  fs.writeFileSync(outB, good);
  const sh = path.join(CLIDIR, "ns.sh");
  fs.writeFileSync(
    sh,
    `#!/bin/sh\nif [ -f ${JSON.stringify(counter)} ]; then cat ${JSON.stringify(outB)}; else : > ${JSON.stringify(
      counter,
    )}; cat ${JSON.stringify(outA)}; fi\nexit 0\n`,
    { mode: 0o755 },
  );

  const prefix = "// context block\n".repeat(Math.ceil((NOW.MIN_PREFIX_BYTES + 64) / 17));
  const prompt = `${prefix}${NOW.SECTION_SEPARATOR}write a function that adds two integers`;
  const got = await drive({ binary: sh }, { cachePrefix: prefix, prompt });
  assert.strictEqual(
    got.ok,
    true,
    `a turn-1 warm with no session id must degrade, never surface. Got ${got.reason} / ${show(got.message)}`,
  );
  assert.ok(fs.existsSync(counter), "precondition: turn 1 really ran and really returned no session id");
});

// ---------------------------------------------------------------------------
// Ordering against the payload-carrier guard
// ---------------------------------------------------------------------------

test("CLEAN [order/a carrier head inside a Claude Code message cannot move the sentence]", () => {
  const hostile = [
    "Ollama error: generation was empty after postprocess",
    "Cloud reported an error mid-reply: anything",
    "Anthropic: the stream ended before message_stop",
    "generation truncated at num_predict",
    "Claude Code exited 1: Error: connection closed",
    "",
    `line one\nline two${LS}line three`,
  ];
  for (const reason of UNION.filter((r) => r !== "no-session" && r !== "binary-missing" && r !== "bad-cwd")) {
    const sentences = new Set(hostile.map((m) => NOW.translateServiceReject(new NOW.ClaudeCodeError(reason, m))));
    assert.strictEqual(
      sentences.size,
      1,
      `${reason}: the message must not be able to change the sentence. Got ${show([...sentences].join(" | "))}`,
    );
  }
  // The structural pass runs in front of the payload guard, and this is why
  // that is not a regression: before it, "Claude Code exited 1: <cli text>"
  // matched no carrier head, fell to the substring pass, and a CLI that
  // happened to print "generation was empty after postprocess" drew the
  // model-refusal sentence. The pass closes that for nine reasons.
});

test("CLEAN [order/an unrecognised reason still meets the guard it always met]", () => {
  for (const message of ["Ollama error: generation was empty after postprocess", "Cloud reported an error mid-reply: x"]) {
    const err = new NOW.ClaudeCodeError("no-session", message);
    assert.strictEqual(
      NOW.translateServiceReject(err),
      BASE.translateServiceReject(err),
      "a reason with no entry must reach the payload guard exactly as it did at the branch point",
    );
  }
});

test("CLEAN [channel/the raw message is untouched by the translation]", () => {
  const raw = "Claude Code exited 1: Error: connection closed";
  const err = new NOW.ClaudeCodeError("exit", raw);
  assert.strictEqual(err.message, raw, "C4: the throw string is the channel's copy");
  assert.strictEqual(String(err), `ClaudeCodeError: ${raw}`, "and String(err), which is what fnGenService logs");
  assert.ok(!toast(err).includes("connection closed"), "while the screen gets none of it");
});
