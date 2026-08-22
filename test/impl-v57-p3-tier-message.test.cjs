// Implementer oracle, session-v57 phase 3 (roadmap item 63, third string):
// gaps the blind file leaves open.
//
// The blind file drives the rendered toast end to end through
// `column80.generateFunction` and the tighten gesture, with a real
// `buildFnGenService` behind the seam. What it cannot see, because it was
// written against the contract alone:
//   * THE RULE ITSELF, in isolation. The blind file can only reach
//     `tierDisabledToast` through a whole service build, so it exercises two
//     inputs: one line, and three lines. Every edge is driven here directly.
//     The CONDITIONAL POINTER in particular: a pointer appended when nothing
//     was dropped is a promise with nothing behind it, and the blind file has
//     no row that would catch it.
//   * THE OTHER TWO RENDER SITES. The blind file reaches the carve gate and
//     the tighten gate. The repair gate and the TDD gate render the same tier
//     message and are pinned here - BEHAVIOURALLY, by driving
//     `column80.generateTests` and `column80.repairFunction` through the blind
//     file's own harness with a MULTI-LINE failure injected, and holding each
//     one's notification to no newline and no `Error:` while its channel line
//     from the same drive keeps all three lines. The TDD gate carries one extra
//     row: its sentence must not read `line The full message`, which is what a
//     period appended BEFORE the cut renders (the cut eats the period and glues
//     the pointer onto a half-sentence). That was a real defect on this gate.
//   * THE NON-ERROR THROW. The fix reads `err.message`, which only exists on an
//     Error. A transport or a host call can reject with a string, a plain
//     object, or undefined, and the message must still be a sentence. Driven,
//     not grepped: `ensureDir` throws a STRING through the harness and the
//     rendered notification must carry `boom` and never the word `undefined`.
//   * THE LEAF RULE. `toastText.ts` is where this had to live: `fnGen.ts`
//     registers `tightenDocComment`, so a value edge from tighten back to fnGen
//     is a cycle. A row goes red if the leaf grows an import.
//   * THE STRUCTURAL PIN. Four gestures render a tier message. A row goes red
//     if one of them interpolates it raw again, which is exactly how this one
//     was missed by session-v56's sweep.
//
// Run: node --test test/impl-v57-p3-tier-message.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const fs = require("node:fs");
const esbuild = require("esbuild");

const VSCODE = path.join(__dirname, "..", "src", "vscode");

// The leaf has no vscode in it, so it bundles bare.
const ENTRY = path.join(__dirname, ".impl-v57-p3.entry.ts");
const OUT = path.join(__dirname, ".impl-v57-p3.bundle.cjs");
fs.writeFileSync(ENTRY, `export { firstLine, tierDisabledToast } from "../src/vscode/toastText";\n`);
esbuild.buildSync({ entryPoints: [ENTRY], bundle: true, outfile: OUT, format: "cjs", platform: "node" });
const { tierDisabledToast } = require(OUT);

const POINTER = "The full message is in the output channel.";

// ---------------------------------------------------------------------------
// The gesture harness. Copied from test/blind-v57-p3-tier-message.test.cjs
// (its stub, its bundle, its fixture, its drive), because that file is a blind
// artifact and must not be edited to export anything. Only the minimum is
// copied, and it is copied with different temp-file names so the two files can
// run in one `node --test` invocation without fighting over a path.
//
// Two deliberate deltas from the blind copy:
//   * `runOracle` is stubbed. The repair gate does NOT return after its
//     refusal - it goes on to check-and-surface through the oracle - and this
//     file is about the refusal it rendered on the way past, not the oracle.
//   * `ensureDir` takes a THROWER rather than a message, so a row can throw a
//     bare string and not just an Error.
// ---------------------------------------------------------------------------

const GWROOT = path.join(__dirname, ".impl-v57-p3-workspace");
const GSTUB = path.join(__dirname, ".impl-v57-p3-stub.cjs");
const GENTRY = path.join(__dirname, ".impl-v57-p3-gesture.entry.ts");
const GOUT = path.join(__dirname, ".impl-v57-p3-gesture.bundle.cjs");

test.after(() => {
  for (const f of [ENTRY, OUT, GENTRY, GOUT, GSTUB]) fs.rmSync(f, { force: true });
  fs.rmSync(GWROOT, { recursive: true, force: true });
});

fs.mkdirSync(path.join(GWROOT, "src"), { recursive: true });
fs.writeFileSync(
  path.join(GWROOT, "package.json"),
  '{"name":"w","version":"0.0.0","scripts":{"test":"vitest run"},"devDependencies":{"vitest":"^1.0.0"}}\n',
);

fs.writeFileSync(
  GSTUB,
  `
const WROOT = ${JSON.stringify(GWROOT)};
const state = {
  config: {}, messages: [], commands: {}, activeTextEditor: undefined,
  snippetInserts: [], appliedEdits: [], executeCalls: [], terminals: [],
  textDocuments: [], warnResponses: [],
  symbols: undefined, symbolsSet: false,
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
    get workspaceFolders() { return [{ uri: Uri.file(WROOT), name: "w", index: 0 }]; },
    getWorkspaceFolder: () => ({ uri: Uri.file(WROOT), name: "w", index: 0 }),
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
    setStatusBarMessage: () => ({ dispose() {} }),
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

let gestureBundleErr;
let registerFnGen;
let buildFnGenService;
let ContextBlockStore;
let __state;
let Position;
let Range;
try {
  fs.writeFileSync(
    GENTRY,
    `export { registerFnGen, buildFnGenService } from "../src/vscode/fnGen";
export { ContextBlockStore } from "../src/core/contextBlocks";
export { __state, Position, Range } from "vscode";\n`,
  );
  esbuild.buildSync({ entryPoints: [GENTRY], bundle: true, outfile: GOUT, format: "cjs", platform: "node", alias: { vscode: GSTUB } });
  ({ registerFnGen, buildFnGenService, ContextBlockStore, __state, Position, Range } = require(GOUT));
} catch (e) {
  gestureBundleErr = e;
}

const GSRC =
  "// this walker keeps a shard mem cache for each of the client sets and drops every entry it can prove is stale\n" +
  "export function walk() {\n" +
  "  return 1;\n" +
  "}\n" +
  "\n";
const GFILE = "file://" + path.join(GWROOT, "src", "walk.ts");
fs.writeFileSync(path.join(GWROOT, "src", "walk.ts"), GSRC);

function makeDoc() {
  const src = GSRC;
  const lineStarts = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === "\n") lineStarts.push(i + 1);
  const offsetAt = (pos) => Math.min((lineStarts[pos.line] ?? src.length) + pos.character, src.length);
  const fsPath = GFILE.replace(/^file:\/\//, "");
  return {
    languageId: "typescript",
    version: 1,
    isDirty: false,
    isClosed: false,
    lineCount: src.split("\n").length,
    fileName: fsPath,
    uri: { fsPath, path: fsPath, scheme: "file", toString: () => GFILE, with() { return this; } },
    getText(range) {
      return range ? src.slice(offsetAt(range.start), offsetAt(range.end)) : src;
    },
    offsetAt,
    positionAt(offset) {
      let line = 0;
      while (line + 1 < lineStarts.length && lineStarts[line + 1] <= offset) line++;
      return new Position(line, offset - lineStarts[line]);
    },
    lineAt(arg) {
      const n = typeof arg === "number" ? arg : arg.line;
      const text = src.split("\n")[n] ?? "";
      const m = text.match(/\S/);
      return {
        lineNumber: n,
        text,
        range: new Range(n, 0, n, text.length),
        firstNonWhitespaceCharacterIndex: m ? m.index : text.length,
        isEmptyOrWhitespace: !m,
      };
    },
    save: async () => true,
  };
}

const symbolsFor = () => [
  { name: "walk", detail: "", kind: 11, range: new Range(1, 0, 3, 1), selectionRange: new Range(1, 16, 1, 20), children: [] },
];

const IN_FUNCTION = [2, 4];

function selectionAt(a) {
  const p = new Position(a[0], a[1]);
  const sel = new Range(p, p);
  sel.active = p;
  sel.anchor = p;
  return sel;
}

const GEN = "column80.generateFunction";
const TDD = "column80.generateTests";
const REPAIR = "column80.repairFunction";
const MULTI = "first line\nsecond line\nthird line";
const CLI_PRESENT = { stdout: "2.1.224 (Claude Code)\n", exitCode: 0 };
const GSTORAGE = path.join(GWROOT, ".storage");

const waitFor = async (predicate, tries = 400) => {
  for (let i = 0; i < tries; i++) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, 5));
  }
  return false;
};

/** A PRESENT CLI so the build clears the PATH probe, and a caller-supplied
 *  thrower for the working-directory creation so the build lands on the
 *  cwd-unusable arm. */
const failingDeps = (thrower) => ({
  storagePath: GSTORAGE,
  run: async () => CLI_PRESENT,
  ensureDir: thrower,
});

/** Register the product's gestures against the REAL cwd-unusable tier, invoke
 *  one gesture as the user does, and capture BOTH surfaces from that drive. */
async function drive({ command, thrower, cursor = IN_FUNCTION }) {
  __state.config = { fnGenProvider: "claude-code" };
  __state.messages = [];
  __state.commands = {};
  __state.executeCalls = [];
  __state.appliedEdits = [];
  __state.snippetInserts = [];
  __state.warnResponses = [];
  const doc = makeDoc();
  __state.textDocuments = [doc];
  __state.symbols = symbolsFor();
  __state.symbolsSet = true;

  const lines = [];
  const output = { lines, appendLine: (l) => lines.push(l), append() {}, show() {}, clear() {}, dispose() {} };
  const context = { subscriptions: [], globalStorageUri: { fsPath: GSTORAGE } };
  let built;

  registerFnGen(context, output, new ContextBlockStore(() => {}), {
    buildService: async (out, log) => {
      built = await buildFnGenService(out, log, undefined, failingDeps(thrower));
      return built;
    },
    claudeCode: failingDeps(thrower),
    // The repair gate refuses and then keeps going, to check and surface. This
    // file is about the refusal, so the oracle is a no-op.
    runOracle: async () => {},
  });

  const registered = await waitFor(() => typeof __state.commands[command] === "function" && built !== undefined);
  assert.ok(
    registered,
    `harness: ${command} never registered (or the service never built); commands seen: ` +
      JSON.stringify(Object.keys(__state.commands)),
  );

  __state.activeTextEditor = {
    document: doc,
    viewColumn: 1,
    options: { tabSize: 4, insertSpaces: true },
    selection: selectionAt(cursor),
    insertSnippet: async (snippet, range) => { __state.snippetInserts.push({ value: snippet.value, range }); return true; },
    revealRange: () => {},
    edit: async () => true,
  };

  __state.messages = [];
  const channelBefore = lines.length;

  await __state.commands[command]();
  await new Promise((r) => setTimeout(r, 60));

  const messages = __state.messages.map((m) => m.message).filter((m) => typeof m === "string");
  const channel = lines.slice(channelBefore);

  for (const d of context.subscriptions) {
    try { d.dispose?.(); } catch { /* teardown only */ }
  }
  try { built.service.dispose(); } catch { /* teardown only */ }

  return { tier: built.tier, messages, channel };
}

/** The notifications a drive is held to: every user-facing message that tells
 *  the user something is disabled or unavailable. The repair gate's sentence
 *  leads with "repair is unavailable", so /disabled/i alone would miss it. */
const refusalToasts = (r) => r.messages.filter((m) => /disabled|unavailable/i.test(m));

const show = (label, r) =>
  `\n[${label}] tier.fnGenEnabled=${r.tier.fnGenEnabled}` +
  `\n[${label}] notifications (${r.messages.length}): ${JSON.stringify(r.messages, null, 1)}` +
  `\n[${label}] channel (${r.channel.length}): ${JSON.stringify(r.channel, null, 1)}`;

const gtest = (name, fn) =>
  test(name, async () => {
    if (gestureBundleErr) {
      assert.fail(`gesture harness bundle failed to build: ${gestureBundleErr.stack || gestureBundleErr.message}`);
    }
    return fn();
  });

// ---------------------------------------------------------------------------
// The rule, every edge.
// ---------------------------------------------------------------------------

test("a one-line message is returned unchanged, with NO pointer", () => {
  const why = "Function generation is disabled: this tier has no local model. FIM still works.";
  assert.strictEqual(tierDisabledToast(why), why);
});

test("a multi-line message keeps its first line and GAINS the pointer", () => {
  const out = tierDisabledToast("first line\nsecond line\nthird line");
  assert.strictEqual(out, `first line ${POINTER}`);
});

test("the pointer is conditional, which is the whole point", () => {
  // A pointer on a message that dropped nothing names a channel the user has no
  // reason to open, and it is the same false promise the phase-1 review found
  // on the transport side (session-v57/scraps.md S57-1).
  assert.ok(!tierDisabledToast("one line only").includes(POINTER));
  assert.ok(tierDisabledToast("one line\nplus a second").includes(POINTER));
});

test("trailing whitespace is not a second line", () => {
  // firstLine trims, so "a\n" has one line of content and nothing was dropped.
  assert.strictEqual(tierDisabledToast("a message   "), "a message");
  assert.strictEqual(tierDisabledToast("a message\n"), "a message");
  assert.strictEqual(tierDisabledToast("a message\n\n  \n"), "a message");
});

test("a leading blank line is skipped rather than rendered as an empty toast", () => {
  assert.strictEqual(tierDisabledToast("\n\nthe real line"), "the real line");
});

test("an empty message produces an empty string, never the word undefined", () => {
  assert.strictEqual(tierDisabledToast(""), "");
  assert.strictEqual(tierDisabledToast("   "), "");
  assert.ok(!tierDisabledToast("").includes("undefined"));
});

test("a very long single line is NOT cut: this rule is about lines, not length", () => {
  // The transports own the length bound (phases 1 and 2). A tier message is
  // product-authored text, and silently cutting it here would hide an authored
  // sentence rather than a server's payload.
  const long = `x${"y".repeat(5000)}`;
  assert.strictEqual(tierDisabledToast(long), long);
});

// ---------------------------------------------------------------------------
// The non-Error throw. `err.message` is what killed the `Error:` prefix.
// ---------------------------------------------------------------------------

gtest("the cwd-unusable message survives a non-Error throw", async () => {
  // Driven, not grepped. The grep this row used to open with
  // (`src.includes("err instanceof Error ? err.message : String(err)")`) was
  // satisfied by an unrelated pre-existing line elsewhere in the same file, so
  // it would have stayed green with the cwd site broken. `ensureDir` throws a
  // bare STRING here, which is what a host call or a transport can reject with,
  // and the rendered notification is what answers.
  const r = await drive({ command: GEN, thrower: () => { throw "boom"; } });
  const toasts = refusalToasts(r);
  assert.ok(toasts.length > 0, `no refusal notification to test${show("non-Error", r)}`);
  for (const t of toasts) {
    assert.ok(
      !t.includes("undefined"),
      "reading .message off a thrown string yields undefined, and the toast then reads " +
        `'working directory X (undefined)'.${show("non-Error", r)}`,
    );
    assert.ok(
      t.includes("boom"),
      `the thrown value is the only detail the user has, and it must reach the toast.${show("non-Error", r)}`,
    );
  }

  const src = fs.readFileSync(path.join(VSCODE, "fnGen.ts"), "utf8");
  assert.ok(
    !/could not create its working directory \$\{cwd\} \(\$\{String\(err\)\}\)/.test(src),
    "String(err) puts an `Error:` envelope at the detail position, which is the internal jargon " +
      "every sibling message in the product now keeps out.",
  );
});

// ---------------------------------------------------------------------------
// The leaf rule, and the four render sites.
// ---------------------------------------------------------------------------

test("the leaf stays a leaf: toastText.ts imports nothing", () => {
  const src = fs.readFileSync(path.join(VSCODE, "toastText.ts"), "utf8");
  assert.ok(
    !/^\s*import\b/m.test(src),
    "toastText.ts must import nothing. fnGen.ts registers tightenDocComment, so a value edge from " +
      "tighten back to fnGen is a cycle, and this helper is rendered by both.",
  );
});

test("every gesture that renders a tier message renders it through the rule", () => {
  const fnGen = fs.readFileSync(path.join(VSCODE, "fnGen.ts"), "utf8");
  const tighten = fs.readFileSync(path.join(VSCODE, "tightenDocComment.ts"), "utf8");

  for (const [file, src, raw] of [
    [
      "fnGen.ts",
      fnGen,
      [
        "showWarningMessage(`Column 80: ${why}`)",
        '`Column 80: ${tier?.message ?? "the hardware tier is unavailable for generation"}.`',
      ],
    ],
    [
      "tightenDocComment.ts",
      tighten,
      ['`Column 80: ${wiring.tierMessage() ?? "the hardware tier disables function generation"}`'],
    ],
  ]) {
    for (const form of raw) {
      assert.ok(
        !src.includes(form),
        `${file} must not render a tier message raw: ${JSON.stringify(form)}. A tier message can ` +
          "interpolate a thrown error, and a notification that carries a newline is roadmap item " +
          "63's third string.",
      );
    }
  }

  // The carve gate, the TDD gate and the tighten gate all go through the helper;
  // the repair gate embeds the message mid-sentence and carries the same
  // conditional pointer inline.
  assert.strictEqual(
    (fnGen.match(/tierDisabledToast\(/g) ?? []).length,
    2,
    "fnGen.ts renders a bare tier message at exactly two gates, carve and TDD",
  );
  assert.ok(/tierDisabledToast\(/.test(tighten), "tightenDocComment.ts renders one");
  assert.ok(
    /repair is unavailable - \$\{firstLine\(why\)\}/.test(fnGen),
    "the repair gate embeds the message mid-sentence, so it takes firstLine directly",
  );
  // session-v58 phase 2: the condition was `firstLine(why) === why.trim()`,
  // which INFERRED "the cut dropped something" from trim()'s own line-break
  // set. Once firstLine widened past `\n`, the two sets stopped agreeing -
  // trim() strips U+2028 and U+2029 and not NEL - so the leaf now STATES the
  // rule and this site calls it. The clause this row pins is unchanged: the
  // pointer is still conditional and still earned.
  assert.ok(
    /Errors are still checked and surfaced\.` \+\s*\(hasMoreThanOneLine\(why\)/.test(fnGen),
    "and carries the same CONDITIONAL pointer, so it does not promise a channel it did not need",
  );
});

test("the channel keeps the message at every gate, not just the reason code", () => {
  const fnGen = fs.readFileSync(path.join(VSCODE, "fnGen.ts"), "utf8");
  const tighten = fs.readFileSync(path.join(VSCODE, "tightenDocComment.ts"), "utf8");
  for (const [file, src, form] of [
    ["fnGen.ts", fnGen, "`[carve] fn-gen disabled: ${why}`"],
    ["fnGen.ts", fnGen, "`[tdd] tests skipped: tier ${gate.reason}: ${why}`"],
    ["tightenDocComment.ts", tighten, "`[tighten] refused: tier ${gate.reason}: ${why}`"],
  ]) {
    assert.ok(
      src.includes(form),
      `${file} must log ${JSON.stringify(form)}. The toast now shortens the message, so a channel ` +
        "line carrying only the reason CODE leaves the dropped text nowhere at all.",
    );
  }
  assert.ok(
    fnGen.includes("check-and-surface only: ${why}"),
    "the repair gate's channel line must carry the message too",
  );
});

// ---------------------------------------------------------------------------
// The other two render sites, driven. The blind file sweeps the carve gate and
// the tighten gate; these are the two gates nothing drove, and until now they
// were held only by a source-text grep, which cannot see what the user reads.
// ---------------------------------------------------------------------------

gtest("harness witness: both untested gates really render a refusal, and really write a channel line (captures printed)", async () => {
  const thrower = () => { throw new Error(MULTI); };
  const tdd = await drive({ command: TDD, thrower });
  const repair = await drive({ command: REPAIR, thrower });
  // Printed on purpose: a row that cannot produce the case is a fact about the
  // rig, so the captures are on the record green or red.
  console.log("=== impl-v57-p3 gate captures ===" + show("tdd", tdd) + show("repair", repair));

  for (const [label, r] of [["tdd", tdd], ["repair", repair]]) {
    assert.strictEqual(r.tier.fnGenEnabled, false, `harness: the ${label} drive must reach a DISABLED tier`);
    assert.ok(refusalToasts(r).length > 0, `harness: the ${label} gate rendered no refusal notification${show(label, r)}`);
    assert.ok(r.channel.length > 0, `harness: the ${label} gate wrote nothing to the channel${show(label, r)}`);
  }
});

for (const [label, command] of [["the TDD gate", TDD], ["the repair gate", REPAIR]]) {
  gtest(`${label} renders one line, with no "Error:", over a MULTI-LINE tier message`, async () => {
    const r = await drive({ command, thrower: () => { throw new Error(MULTI); } });
    const toasts = refusalToasts(r);
    assert.ok(toasts.length > 0, `no refusal notification to test${show(label, r)}`);
    for (const t of toasts) {
      assert.ok(!t.includes("\n"), `${label}: the notification embeds a newline.${show(label, r)}`);
      assert.ok(!t.includes("\r"), `${label}: the notification embeds a carriage return.${show(label, r)}`);
      assert.ok(
        !t.includes("Error:"),
        `${label}: the notification carries an "Error:" envelope at the detail position, which is the ` +
          `internal jargon every sibling message in the product now keeps out.${show(label, r)}`,
      );
    }
  });

  gtest(`${label} keeps the whole multi-line message on the channel line for the same drive`, async () => {
    const r = await drive({ command, thrower: () => { throw new Error(MULTI); } });
    const pieces = MULTI.split("\n");
    assert.ok(
      r.channel.some((l) => pieces.every((p) => l.includes(p))),
      `${label}: the toast now shortens the message, so no channel line carrying the whole of ` +
        `${JSON.stringify(MULTI)} means the dropped text is nowhere at all.${show(label, r)}`,
    );
  });
}

gtest("the TDD gate's sentence is well formed: the period goes on the CUT clause, never into the text being cut", async () => {
  // The real defect: the gate built `${why}.` and handed THAT in to be cut, so
  // the cut ate the period it had just added and glued the channel pointer onto
  // a half-sentence - "... (first line The full message is in the output
  // channel." This row is what keeps that fixed.
  const r = await drive({ command: TDD, thrower: () => { throw new Error(MULTI); } });
  const toasts = refusalToasts(r);
  assert.ok(toasts.length > 0, `no refusal notification to test${show("tdd", r)}`);
  for (const t of toasts) {
    assert.ok(
      !t.includes("line The full message"),
      `the TDD gate's punctuation was applied before the cut, so the cut removed it and the pointer ` +
        `is glued onto a truncated clause.${show("tdd", r)}`,
    );
  }
});
