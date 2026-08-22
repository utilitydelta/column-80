// Blind oracle, session-v58 phase 6: "Claude Code speaks through its own
// reasons" (roadmap item 68, first half - the structural pass, first case).
// Written BEFORE the change, against the CONTRACT and nothing else.
//
// ===========================================================================
// WHAT THIS FILE PINS
// ===========================================================================
//
// Claude Code is a live fn-gen backend and item 66 gave it nothing. Its throws
// interpolate CLI text straight into the detail position, so the `Error:` token
// every other message now keeps off the screen sails through:
//
//     "Claude Code exited 1: Error: connection closed"
//       -> "Column 80: function generation failed - Claude Code exited 1:
//           Error: connection closed. The full message is in the output
//           channel."
//
// The fix is a STRUCTURAL pass, not more marker rows: every Claude Code failure
// is a `ClaudeCodeError` carrying a `reason`, and `name === "ClaudeCodeError"`
// identifies the class without an import. The pass runs in FRONT of the
// anchored pass in `translateServiceReject` and switches on the typed field.
//
// The contract carries four verified corrections to roadmap item 68, and this
// file is written to all four:
//   1. the field is `reason`, not item 68's `kind`
//   2. there are TEN reasons, not the five item 68 names - every one of them
//      gets a row here (ELEVEN as built; see the re-cut note below)
//   3. the translator lives in `src/vscode/fnGen.ts`; there is no
//      `src/core/fnGen.ts`
//   4. SIX throws interpolate CLI text, not item 68's two, and the pair item 68
//      quotes is not the pair its own falsifier names - all six are driven here
//
// ===========================================================================
// RE-CUT AFTER THE BUILD: A FIFTH CORRECTION, WHICH THIS FILE FOUND
// ===========================================================================
//
// The contract's table of six interpolating throws misses a SEVENTH:
// `claudeCodeInstruct.ts:626`, `Claude Code could not start: ${err.message}`,
// which interpolates a Node `ErrnoException` rather than CLI output. It was
// driven here as a thirteenth `exit` case, and the finding that it is a third
// "could not start" message landing in the CLI-failed group was filed as a
// defect and ruled on. It now throws its own reason, `spawn-failed`. The
// union is ELEVEN values, ten of which can reach a toast.
//
// Three consequences, all pinned below:
//   * the MESSAGE is untouched (the phase forbids rewording a throw), so the
//     C4 row for it is a straight regression - the errno the sentence refuses
//     to show is still in the channel
//   * the sentence carries NO cause. Triage took this file's pre-build ban list
//     over the adversarial review's argument that the errno is actionable: the
//     two ENOENT siblings earn C3's exception because their interpolation is
//     product prose end to end, this one carries an errno token
//   * `exit` is in DEGRADABLE and `spawn-failed` deliberately is not, so an
//     unspawnable binary no longer clears a live fork checkpoint and re-runs
//     the whole prompt against the same unspawnable binary. That is BEHAVIOUR,
//     and `[spawn-failed is not degradable]` is the row for it
//
// FOUR ROWS WERE RE-CUT, all red on the one moved reason and all sanctioned:
// `G2 [harness]` (its expected set), `C1 [pass placement: 626 ...]`,
// `C1 [reason drives it: exit]` (three drives through one reason became two),
// and `C3 [no cli text: 626 ...]`. Three rows were ADDED, all earned by the
// split: `[spawn-failed is its own voice]`, `[spawn-failed is not degradable]`,
// and the C4 row for the untouched message.
//
// ===========================================================================
// HOW THE THROWS ARE PRODUCED: A FAKE CLI, NOT A HAND-BUILT ERROR
// ===========================================================================
//
// C3 is the point of the phase, and its claim is about REAL throw messages -
// the strings `classifyFailure` builds by interpolating what the CLI actually
// wrote. A hand-typed `new ClaudeCodeError("exit", "...")` would only test a
// string this file invented, so every C3 row instead drives the real
// `makeClaudeCodeInstruct` against a fake `claude` binary: a `/bin/sh` script
// that writes chosen bytes to stdout and stderr and exits with a chosen code.
// The product spawns it, reads it, classifies it, and throws its own message.
// Thirteen of those drives cover every reason that can reach a toast and all
// six interpolating sites, plus the seventh at :626 and the bare-exit-code one
// at :774.
//
// That is also this file's half of C7 ("each sentence's row goes red if its
// reason's throw site changes"). Nothing here restates a throw string as an
// expectation except the ONE the contract quotes byte-for-byte, S57-10.
//
// WHERE A SYNTHETIC ERROR IS USED - falsifiers 5, 6 and 7, and C6 - the class
// is IMPORTED from `src/core/claudeCodeInstruct.ts` rather than faked by
// setting `name` and `reason` on a plain `Error`. Reason: C5 is about identity,
// and a file that forges identity in the same breath as it tests forgery cannot
// tell the two apart. The imported constructor sets `name` and `reason` the way
// the product does; the FORGERY rows deliberately do the opposite and use a
// plain `Error`, which is the whole distinction under test. The one reason that
// cannot come from the real constructor - a value outside the union, falsifier
// 5 - still goes through it, because TypeScript's union is erased at runtime.
//
// ===========================================================================
// REGRESSION ROWS - GREEN ON BOTH SIDES, AND THE BIG ONES
// ===========================================================================
//
// NOT weak rows. A red one means phase 6 broke something that already worked,
// never "the feature has not landed yet":
//
//   C2 [41-row corpus, byte-identical]   <- the big one. Five phases of v56/v57
//                                           translation work is what it guards.
//   F8 [non-Error rejects]               <- the same clause, off the Error path
//   C4 [raw message unchanged] x13       <- the throw strings are the channel's
//                                           copy and this phase must not touch
//                                           them
//   C5 [forgery: plain Error]            <- green now, green after
//   C5 [forgery: class name in text]     <- green now, green after
//   C5 [forgery: reason without name]    <- green now, green after
//   C6 [no-session degrades, live]       <- green now, green after
//   G1, G2 [harness]
//
// FORWARD GUARDS - green now and vacuously so, because no structural pass
// exists yet to degrade or crash. They start earning their keep the moment it
// is written, and a green here is not evidence the phase landed:
//
//   F5 [unknown reason degrades]   F7 [no reason] [reason undefined]
//   [reason null] [reason a number] [reason an object]
//   C6 [no-session draws no sentence]
//
// ===========================================================================
// BINDINGS THE CONTRACT LEAVES OPEN, RESOLVED AND REPORTED
// ===========================================================================
//
//   * THE TEN SENTENCES. Never written down. The contract fixes what each must
//     DO, not what it says, so every headline assertion is
//     `toast !== generationFailedToast(new Error(<the same message>), gesture)`
//     - the crafted sentence must differ from what that exact message gets
//     today. Both sides come out of the product, so a re-wording cannot make
//     this file stale, only re-baseline it.
//   * "NAMES WHAT HAPPENED AND A NEXT ACTION". Not machine-checkable in
//     general, so it is bound per contract-table row to the narrowest probe the
//     table itself licenses: `logged-out` must name logging in; the two
//     `could not start` reasons must carry their path or binary name;
//     `serving-failure` must point at trying again; the `exit`/`cli-error`/
//     `bad-json`/`agentic` family must point at the channel ("the full text in
//     the channel" is the table's own wording). Each probe is a permissive
//     alternation, so only a sentence with NO next action in it fails.
//   * "REASONS MAY SHARE A SENTENCE". Not over-constrained. Sameness is
//     asserted only where the contract asserts it: falsifier 4 says all three
//     `serving-failure` shapes get the provider-trouble sentence, so those
//     three are pinned EQUAL. The three `exit` drives are pinned equal too -
//     not as a wording claim but as the sharpest available proof that the pass
//     switches on the REASON: three wildly different messages, one reason, one
//     sentence. DIFFERENCE is asserted only between groups whose next action
//     the table makes plainly different (log in / wait / read the channel /
//     install-or-fix-the-path). `timeout` is left free to share with the
//     channel family, since the table does not say it may not.
//   * THE HOUSE VOICE. Every sentence in the existing table opens
//     "Column 80: ", and item 66's one-voice rule is what this phase extends.
//     Bound as an assertion, and reported here because it is a binding.
//   * THE GESTURE ARGUMENT. "function generation" everywhere, so any difference
//     between rows is the ERROR's doing and never the gesture's.
//   * "NO EXIT CODE" (C3). Bound to two probes per drive: the toast must not
//     contain the product's own `exited <code>` phrasing, and must not contain
//     the code as a standalone word. Codes 1 and 3 are used, so a sentence that
//     happens to say "try again in a minute" is not at risk.
//   * C4's CHANNEL LINE. `fnGenService` logs `[fngen] request failed: ` +
//     `String(err)`. A black-box file cannot reach into that logger without
//     standing up the whole service, so C4 is pinned at the only place this
//     phase could break it: the ERROR itself. The raw message and `String(err)`
//     must still carry the CLI text whole. The template around them is one line
//     of `fnGenService` that this phase does not touch.
//   * C7's OTHER HALF IS UNTESTABLE FROM OUTSIDE. "The throw sites carry a
//     comment naming the pass" is a claim about prose in the source. Recorded,
//     not asserted.
//   * THE C2 GOLDEN TABLE. Captured from THIS tree at the branch point
//     (HEAD 3831d3c). It is the only shape a "byte-identical before and after"
//     claim can take in a file written before the change: the "before" has to
//     be written down. 41 rows - every marker in the reject table bare and with
//     a prefix in front of it, every payload-carrier head, and the catch-all's
//     own shapes.
//
// ===========================================================================
// EXPECTED AT THE BRANCH POINT (measured against HEAD 3831d3c, not predicted)
// ===========================================================================
//
//   65 rows at the branch point. 39 red, 26 green. (68 rows after the re-cut
//   above; all 68 green against the built phase.)
//
//   RED   C1 [pass placement] x13    - translateServiceReject returns
//                                      undefined for every ClaudeCodeError
//   RED   C1 [reason drives it: exit], C1 [reason drives it: serving-failure]
//   RED   C3 [no cli text] x13
//   RED   F1 [S57-10 reproduction]
//   RED   F3 [logged-out names login]
//   RED   F4 [three serving-failure shapes agree]
//   RED   [channel family] x4, [start family], [timeout], [groups differ]
//   RED   C5 [same text, different identity]
//   GREEN every row listed under REGRESSION and FORWARD GUARDS above.
//         P0 asserts nothing.
//
// The three rows added on the re-cut were written after the build and are green
// on arrival, so each was mutation-checked rather than trusted.
// `[spawn-failed is not degradable]` was re-run with round 2 failing as `exit`
// instead: it goes red and names the second turn 1 in its diagnostic. That row
// is measuring DEGRADABLE membership, not passing on a coincidence.
//
// FOUR OF THOSE RED ROWS ARE RED BY A PRECONDITION, NOT BY A LEAK.
// `C3 [no cli text: logged-out]`, `[binary-missing]` and `[bad-cwd]` are the
// three reasons whose throw interpolates no CLI output at all, so C3's ban list
// is satisfied by today's catch-all and those rows would pass vacuously. Each
// C3 row therefore asserts FIRST that a sentence was crafted at all, and the
// same precondition guards `[groups differ]` - four different raw messages
// already produce four different catch-alls. Without those two guards, four
// rows in this file would be green at the branch point and would read as
// evidence the phase had landed.
//
// Run: node --test test/blind-v58-p6-claude-code-reasons.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const esbuild = require("esbuild");

// ---------------------------------------------------------------------------
// The vscode stub: blind-v58-p4's stub, verbatim. Only three pure functions are
// needed out of src/vscode/fnGen.ts, but the module graph behind it touches
// most of the vscode API at import time, so the precedent stub is reused rather
// than trimmed.
// ---------------------------------------------------------------------------

const STUB = path.join(__dirname, ".blind-v58-p6-stub.cjs");
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

const ENTRY = path.join(__dirname, ".blind-v58-p6.entry.ts");
const OUTFILE = path.join(__dirname, ".blind-v58-p6.bundle.cjs");
let B = {};
let bundleErr;
try {
  fs.writeFileSync(
    ENTRY,
    `export { generationFailedToast, translateServiceReject } from "../src/vscode/fnGen";\n` +
      `export { ClaudeCodeError, makeClaudeCodeInstruct, MIN_PREFIX_BYTES } from "../src/core/claudeCodeInstruct";\n` +
      `export { SECTION_SEPARATOR } from "../src/core/prompt";\n`,
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

// The fake CLI lives in its own temp directory: it is also the neutral cwd the
// backend spawns in, and the bad-cwd row needs a path UNDER it that is not
// there.
const CLIDIR = fs.mkdtempSync(path.join(os.tmpdir(), "col80-p6-"));

test.after(() => {
  for (const f of [STUB, ENTRY, OUTFILE]) fs.rmSync(f, { force: true });
  fs.rmSync(CLIDIR, { recursive: true, force: true });
});

const btest = (name, fn) =>
  test(name, (ctx) => {
    if (bundleErr) return ctx.skip("bundle failed to build; see the G1 harness guard row");
    return fn(ctx);
  });

// ---------------------------------------------------------------------------
// The fake CLI.
// ---------------------------------------------------------------------------

let scriptSeq = 0;
function script(body) {
  const p = path.join(CLIDIR, `cli-${scriptSeq++}.sh`);
  fs.writeFileSync(p, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  return p;
}

/** A `claude` that writes exactly these bytes and exits with exactly this code.
 *  The payloads go to files and are `cat`ed, so no shell quoting can mangle the
 *  hostile text this file is built around. */
function fakeCli(stdout, stderr, code) {
  const so = path.join(CLIDIR, `out-${scriptSeq}.txt`);
  const se = path.join(CLIDIR, `err-${scriptSeq}.txt`);
  fs.writeFileSync(so, stdout);
  fs.writeFileSync(se, stderr);
  return script(`cat ${JSON.stringify(so)}\ncat ${JSON.stringify(se)} >&2\nexit ${code}`);
}

const GESTURE = "function generation";
const toast = (err) => B.generationFailedToast(err, GESTURE);
const short = (s) => (typeof s === "string" && s.length > 260 ? `${s.slice(0, 260)}... (${s.length} chars)` : s);

/** What the toast would be today for a message with no Claude Code identity on
 *  it. Every headline row compares against this, so no sentence is written
 *  down. */
const catchAllFor = (message) => B.generationFailedToast(new Error(message), GESTURE);

async function driveClaudeCode(config) {
  const gen = B.makeClaudeCodeInstruct({ cwd: CLIDIR, ...config });
  try {
    const value = await gen({
      apiBase: "",
      model: "",
      prompt: "write a function that adds two integers",
      maxTokens: 256,
      temperature: 0,
      signal: new AbortController().signal,
    });
    return { ok: true, value };
  } catch (err) {
    return {
      ok: false,
      err,
      errName: err instanceof Error ? err.name : "",
      reason: err && typeof err === "object" ? err.reason : undefined,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

// ---------------------------------------------------------------------------
// HOSTILE CLI OUTPUT. Every one of these carries at least one of the tokens C3
// bans: an `Error:` head, a `subtype=`, an exit code, a stack path.
// ---------------------------------------------------------------------------

/** The S57-10 recording, byte-for-byte. The CLI wrote this line and exited 1. */
const S57_10_CLI_LINE = "Error: connection closed";
/** The exact toast-detail the contract quotes as today's defect. */
const S57_10_THROW = "Claude Code exited 1: Error: connection closed";

const H_THROTTLE = "Error: 429 rate limit exceeded (subtype=rate_limit) at /home/u/.claude/cli.js:99";
const H_JUNK = "Error: <!DOCTYPE html> subtype=nope exit 7 garbage from a proxy";
const H_STATUS = "429 overloaded; Error: subtype=throttle";
const MISSING_BINARY = "claude-not-here-p6";
const GONE_DIR = "cwd-that-is-not-there-p6";

/**
 * The thirteen drives. `site` is the contract's line number for the six
 * interpolating throws (table in "Corrections from phase 0's cite walk"), or a
 * note for the rest. `banned` is what C3 forbids on screen for that drive, over
 * and above the blanket list; `carries` is what the toast MUST keep, and only
 * the two `could not start` reasons have one - that is C3's stated exception,
 * pinned here so it is a decision rather than a leak.
 */
const DRIVES = {
  "722 serving-failure (firstLine(diagnostics))": {
    reason: "serving-failure",
    config: () => ({ binary: fakeCli("", `${H_THROTTLE}\n`, 1) }),
    banned: ["429", "rate limit exceeded", "cli.js", "subtype=", "Error:"],
  },
  "728 exit (firstLine(stdout + stderr)) - S57-10": {
    reason: "exit",
    config: () => ({ binary: fakeCli(`${S57_10_CLI_LINE}\n`, "", 1) }),
    exactThrow: S57_10_THROW,
    banned: ["connection closed", "Error:", "exited 1"],
    bannedCode: 1,
  },
  "731 bad-json (firstLine(stdout))": {
    reason: "bad-json",
    config: () => ({ binary: fakeCli(`${H_JUNK}\n`, "", 0) }),
    banned: ["DOCTYPE", "subtype=", "Error:", "proxy"],
  },
  "738 serving-failure (reply.api_error_status)": {
    reason: "serving-failure",
    config: () => ({
      binary: fakeCli(JSON.stringify({ result: "x", api_error_status: H_STATUS }), "", 0),
    }),
    banned: ["429", "subtype=", "Error:", "upstream status"],
  },
  "754 serving-failure (firstLine(reply.result))": {
    reason: "serving-failure",
    config: () => ({
      binary: fakeCli(JSON.stringify({ result: H_THROTTLE, is_error: true }), "", 0),
    }),
    banned: ["429", "rate limit exceeded", "cli.js", "subtype=", "Error:"],
  },
  "759 cli-error (subtype= plus firstLine(reply.result))": {
    reason: "cli-error",
    config: () => ({
      binary: fakeCli(
        JSON.stringify({ result: S57_10_CLI_LINE, is_error: true, subtype: "error_during_execution" }),
        "",
        0,
      ),
    }),
    banned: ["subtype=", "error_during_execution", "connection closed", "Error:"],
  },
  "774 exit (a code beside a well-formed reply)": {
    reason: "exit",
    config: () => ({
      binary: fakeCli(JSON.stringify({ result: "fn a() {}", subtype: "success", num_turns: 1 }), "", 3),
    }),
    banned: ["exited 3", "well-formed"],
    bannedCode: 3,
  },
  // RE-CUT after the build. This drive was written as a THIRTEENTH `exit` case
  // and its finding - that :626 is a third "could not start" message landing in
  // the CLI-failed group - was filed as a defect and ruled on: :626 now throws
  // the new reason `spawn-failed`. The MESSAGE is untouched, which is why the
  // ban list below is unchanged and why the C4 row for it still holds.
  //
  // The ban list is also the position triage took over the adversarial review's.
  // The review argued the errno is the most actionable of the three causes and
  // should be on screen; this file had already ruled the other way before the
  // build, and the reasoning stands: the two ENOENT siblings earn C3's exception
  // because their interpolation is product prose end to end, while this one
  // interpolates Node's ErrnoException with its errno token in it. Hence no
  // `carries` list here, and `ENOENT` on the blanket list.
  "626 spawn-failed (a spawn diagnostic, not CLI output)": {
    reason: "spawn-failed",
    config: () => {
      // A file that exists and is not executable: spawn fails EACCES, which is
      // NOT the ENOENT the two `could not start` reasons are separated by. The
      // only coverage of a non-ENOENT spawn failure, and now the only coverage
      // of the new reason.
      const p = path.join(CLIDIR, "not-executable-p6.sh");
      fs.writeFileSync(p, "#!/bin/sh\ntrue\n", { mode: 0o644 });
      return { binary: p };
    },
    banned: ["EACCES", "spawn ", "not-executable-p6"],
  },
  agentic: {
    reason: "agentic",
    config: () => ({
      binary: fakeCli(
        JSON.stringify({ result: "I read three files and edited one.", subtype: "success", num_turns: 4 }),
        "",
        0,
      ),
    }),
    banned: ["num_turns", "transcript", "I read three files"],
  },
  "logged-out": {
    reason: "logged-out",
    config: () => ({ binary: fakeCli("", "Invalid API key. You are not logged in.\n", 1) }),
    banned: ["Invalid API key"],
  },
  "binary-missing": {
    reason: "binary-missing",
    config: () => ({ binary: path.join(CLIDIR, MISSING_BINARY) }),
    banned: ["Error:", "ENOENT"],
    // C3's stated exception: a binary name this product wrote, not CLI output.
    carries: MISSING_BINARY,
  },
  "bad-cwd": {
    reason: "bad-cwd",
    config: () => ({ binary: fakeCli("{}", "", 0), cwd: path.join(CLIDIR, GONE_DIR) }),
    banned: ["Error:", "ENOENT"],
    // C3's stated exception: a path this product wrote.
    carries: GONE_DIR,
  },
  timeout: {
    reason: "timeout",
    // `exec` so the sleep REPLACES the shell: the product's SIGKILL then lands
    // on the sleep itself and nothing outlives the row. The 150ms deadline
    // against a 2s sleep is a 13x margin, which is why this row is not on the
    // load-sensitive list.
    config: () => ({ binary: script("exec sleep 2"), timeoutMs: 150 }),
    banned: ["150ms", "did not answer within"],
  },
};

/** C3's blanket list: internal vocabulary that must never reach a notification,
 *  whichever drive produced it. */
const NEVER_ON_SCREEN = ["Error:", "subtype=", "stdout", "stderr", "ENOENT", "ClaudeCodeError"];

const drivenCache = new Map();
async function driven(label) {
  if (!drivenCache.has(label)) {
    const spec = DRIVES[label];
    const got = await driveClaudeCode(spec.config());
    drivenCache.set(label, got);
  }
  return drivenCache.get(label);
}

/** Drive it, and refuse to grade anything unless the drive produced the throw
 *  the contract's table says that site produces. A row that graded a DIFFERENT
 *  failure would be measuring the fake CLI, not the product. */
async function throwFrom(label) {
  const spec = DRIVES[label];
  const got = await driven(label);
  assert.strictEqual(
    got.ok,
    false,
    `harness [${label}]: the drive must fail so there is a throw to grade. It RESOLVED with ` +
      `${JSON.stringify(got.value)}`,
  );
  assert.strictEqual(
    got.errName,
    "ClaudeCodeError",
    `harness [${label}]: the backend must throw its typed failure. Got ${got.errName}: ${short(got.message)}`,
  );
  assert.strictEqual(
    got.reason,
    spec.reason,
    `harness [${label}]: the contract's table says this site throws reason ${JSON.stringify(spec.reason)}. ` +
      `Got ${JSON.stringify(got.reason)} with message ${JSON.stringify(short(got.message))}. Either the ` +
      `throw site moved (C7: this row is SUPPOSED to go red for that) or the fake CLI stopped reproducing it`,
  );
  return got;
}

const ALL_DRIVES = Object.keys(DRIVES);

// ===========================================================================
// G - HARNESS GUARDS. If either is red, every verdict below is suspect.
// ===========================================================================

test("G1 [harness]: the bundle builds headless and exports the translator, the class and the drive", () => {
  if (bundleErr) assert.fail(`bundle failed to build: ${bundleErr.stack || bundleErr.message}`);
  for (const name of ["generationFailedToast", "translateServiceReject", "makeClaudeCodeInstruct"]) {
    assert.strictEqual(typeof B[name], "function", `${name} must be exported for this file to drive it`);
  }
  assert.strictEqual(typeof B.ClaudeCodeError, "function", "ClaudeCodeError must be exported as a class");
  const e = new B.ClaudeCodeError("exit", "probe");
  assert.strictEqual(e.name, "ClaudeCodeError", "correction 1: `name` is the identity the pass reads");
  assert.strictEqual(e.reason, "exit", "correction 1: the field is `reason`, NOT item 68's `kind`");
  assert.strictEqual(e.kind, undefined, "correction 1, stated the other way round: there is no `kind` field");
});

btest("G2 [harness]: all thirteen drives reproduce their contract-table reason", async () => {
  // Without this, a C3 row could pass because the fake CLI produced a DIFFERENT
  // failure whose sentence happens to be clean.
  const seen = new Set();
  for (const label of ALL_DRIVES) {
    const got = await throwFrom(label);
    seen.add(got.reason);
  }
  // RE-CUT: the union is ELEVEN values since :626 was split out, and ten of
  // them can reach a toast. The eleventh, `no-session`, is C6's whole subject
  // and is driven separately.
  const expected = [
    "agentic",
    "bad-cwd",
    "bad-json",
    "binary-missing",
    "cli-error",
    "exit",
    "logged-out",
    "serving-failure",
    "spawn-failed",
    "timeout",
  ];
  assert.deepStrictEqual(
    [...seen].sort(),
    expected,
    "harness: the drives must cover every reason that can reach a toast, or correction 2's reason-count " +
      "claim is only tested where it was easy",
  );
});

// ===========================================================================
// P - PROBE. Asserts nothing. Prints what every drive does today so a reader
// can see exactly which rows flipped.
// ===========================================================================

btest("P0 [probe]: every reason, its real throw, and what the user is told today", async () => {
  console.error("\n=== P0 table: thirteen live drives of the Claude Code backend ===");
  for (const label of ALL_DRIVES) {
    const got = await driven(label);
    console.error("drive   : %s", label);
    if (got.ok) {
      console.error("outcome : RESOLVED %j", got.value);
    } else {
      console.error("reason  : %j", got.reason);
      console.error("throw   : %j", short(got.message));
      console.error("toast   : %j", short(toast(got.err)));
      console.error("tsr     : %j", short(B.translateServiceReject(got.err)));
      console.error("== catch-all for the same message: %s", toast(got.err) === catchAllFor(got.message));
    }
    console.error("---");
  }
  console.error("=== end P0 table ===\n");
});

// ===========================================================================
// C1 - THE STRUCTURAL PASS EXISTS AND RUNS INSIDE translateServiceReject.
//
// The contract puts it "before the anchored pass, before PAYLOAD_CARRIERS,
// before the substring pass" - all three of which live in
// `translateServiceReject`. So the observable form of C1 is that
// `translateServiceReject` itself stops returning undefined for a
// ClaudeCodeError, and that what it returns is what reaches the screen.
// ===========================================================================

for (const label of ALL_DRIVES) {
  btest(`C1 [pass placement: ${label}]: translateServiceReject returns the sentence, and it is what is toasted`, async () => {
    const got = await throwFrom(label);
    const sentence = B.translateServiceReject(got.err);
    assert.ok(
      typeof sentence === "string" && sentence.trim() !== "",
      `C1: the structural pass runs FIRST, inside translateServiceReject, and switches on ` +
        `err.name === "ClaudeCodeError" plus err.reason. Reason ${JSON.stringify(got.reason)} drew nothing.\n` +
        `  throw : ${JSON.stringify(short(got.message))}\n` +
        `  got   : ${JSON.stringify(sentence)}`,
    );
    assert.strictEqual(
      toast(got.err),
      sentence,
      "C1: the crafted sentence is what the gesture shows. If these differ, the pass is in the wrong place",
    );
    assert.notStrictEqual(
      toast(got.err),
      catchAllFor(got.message),
      `C1: the toast is still exactly what this message gets today with no Claude Code identity on it, ` +
        `which means no sentence was crafted for reason ${JSON.stringify(got.reason)}`,
    );
  });
}

btest("C1 [reason drives it: exit]: two different exit messages, one reason, one sentence", async () => {
  // RE-CUT. This was three drives through one reason; :626 has moved out to
  // `spawn-failed` and the row that replaces its third leg is
  // `[spawn-failed is its own voice]` below.
  //
  // Still the sharpest available proof that the pass switches on the TYPED
  // FIELD and not on the text. These two throws share nothing but their reason:
  // "Claude Code exited 1: Error: connection closed" and
  // "Claude Code exited 3 despite a well-formed reply."
  const a = await throwFrom("728 exit (firstLine(stdout + stderr)) - S57-10");
  const b = await throwFrom("774 exit (a code beside a well-formed reply)");
  assert.notStrictEqual(
    a.message,
    b.message,
    "harness: the two exit drives must produce different messages, or this row proves nothing",
  );
  assert.strictEqual(
    toast(a.err),
    toast(b.err),
    `C1: same reason, different text, so the same sentence.\n  a: ${JSON.stringify(short(toast(a.err)))}\n` +
      `  b: ${JSON.stringify(short(toast(b.err)))}`,
  );
});

btest("[spawn-failed is its own voice]: a backend that never started does not say the CLI failed", async () => {
  // The ruling this file's own finding produced. The message is byte-identical
  // to what it was when it threw `exit`, so nothing but the REASON can separate
  // these two sentences - which is the whole argument for splitting the reason
  // rather than matching text inside the shared one.
  const spawned = await throwFrom("626 spawn-failed (a spawn diagnostic, not CLI output)");
  const cliFailed = await throwFrom("774 exit (a code beside a well-formed reply)");
  const cannotStart = await throwFrom("binary-missing");
  const t = toast(spawned.err);

  assert.notStrictEqual(
    t,
    toast(cliFailed.err),
    `a user reading "the CLI failed" about a binary that never ran is told the wrong thing.\n` +
      `  spawn-failed: ${JSON.stringify(short(t))}\n  exit        : ${JSON.stringify(short(toast(cliFailed.err)))}`,
  );
  assert.notStrictEqual(
    t,
    toast(cannotStart.err),
    "and it is not one of the two ENOENT could-not-start sentences either - those name a remedy this one " +
      "has no cause to name",
  );
  assert.ok(
    /start/i.test(t),
    `it must say the backend could not start. Got ${JSON.stringify(short(t))}`,
  );
  assert.ok(
    /channel/i.test(t),
    `and, carrying no cause, it must point at the channel for the one. Got ${JSON.stringify(short(t))}`,
  );
  // C3's exception is exactly two reasons wide and this is not one of them. The
  // per-drive C3 row bans the errno and the path; this pins the positive half of
  // the same ruling - the sentence names no cause at all.
  assert.ok(
    !t.includes(CLIDIR) && !/errno|EACCES|EPERM|EMFILE/i.test(t),
    `Node's ErrnoException carries an errno token, which is why this reason does not earn C3's exception. ` +
      `Got ${JSON.stringify(short(t))}`,
  );
});

btest("[spawn-failed is not degradable]: an unspawnable binary does not clear a live fork checkpoint", async () => {
  // BEHAVIOUR, not wording, and the consequence of the split that nobody had
  // spotted. `exit` is in DEGRADABLE: while :626 threw it, an unspawnable
  // binary cleared a live checkpoint and re-ran the whole prompt against the
  // same unspawnable binary, failing identically. Observed from outside by
  // whether the NEXT round has to warm again.
  //
  // Round 1 establishes a checkpoint with an executable binary. The same file is
  // then chmod'ed non-executable, so round 2's fork spawn fails EACCES. Round 3
  // restores it: if the checkpoint survived, round 3 forks with no `turn1=`
  // line; if it was cleared, round 3 must warm a second turn 1.
  const counter = path.join(CLIDIR, "degradable-count.txt");
  const warmReply = path.join(CLIDIR, "degradable-warm.json");
  const genReply = path.join(CLIDIR, "degradable-gen.json");
  fs.writeFileSync(warmReply, JSON.stringify({ result: "understood", subtype: "success", num_turns: 1, session_id: "sess-keep" }));
  fs.writeFileSync(genReply, JSON.stringify({ result: "fn add(a: i32, b: i32) -> i32 { a + b }", subtype: "success", num_turns: 1, session_id: "sess-keep" }));
  const binary = path.join(CLIDIR, "degradable-cli.sh");
  const body =
    `#!/bin/sh\n` +
    `N=$(cat ${JSON.stringify(counter)} 2>/dev/null || echo 0)\n` +
    `N=$((N+1))\n` +
    `echo $N > ${JSON.stringify(counter)}\n` +
    `if [ "$N" = "1" ]; then cat ${JSON.stringify(warmReply)}; else cat ${JSON.stringify(genReply)}; fi\n` +
    `exit 0\n`;
  fs.writeFileSync(binary, body, { mode: 0o755 });

  const prefix = "// a pinned context block line\n".repeat(200);
  const logs = [];
  const gen = B.makeClaudeCodeInstruct({ cwd: CLIDIR, binary, log: (l) => logs.push(l) });
  const round = () =>
    gen({
      apiBase: "",
      model: "",
      prompt: prefix + B.SECTION_SEPARATOR + "write a function that adds two integers",
      cachePrefix: prefix,
      maxTokens: 256,
      temperature: 0,
      signal: new AbortController().signal,
    });

  await round();
  assert.ok(
    logs.some((l) => l.includes("turn1=")),
    `harness: round 1 must build a checkpoint, or there is nothing for round 2 to fail to clear. Logs:\n${logs.join("\n")}`,
  );

  fs.chmodSync(binary, 0o644);
  const before = logs.length;
  let failure;
  try {
    await round();
    assert.fail("harness: round 2 must fail - the binary is not executable");
  } catch (err) {
    failure = err;
  }
  assert.strictEqual(
    failure.reason,
    "spawn-failed",
    `harness: round 2 must fail as spawn-failed. Got ${JSON.stringify(failure.reason)}: ${short(failure.message)}`,
  );
  const round2 = logs.slice(before);
  assert.ok(
    !round2.some((l) => l.includes("cache-degraded")),
    `spawn-failed is deliberately NOT in DEGRADABLE, so round 2 must not degrade to a whole-prompt round ` +
      `against the same unspawnable binary. Logs:\n${round2.join("\n")}`,
  );

  fs.chmodSync(binary, 0o755);
  const beforeThree = logs.length;
  const value = await round();
  const round3 = logs.slice(beforeThree);
  assert.strictEqual(value.text, "fn add(a: i32, b: i32) -> i32 { a + b }", "harness: round 3 must succeed");
  assert.ok(
    !round3.some((l) => l.includes("turn1=")),
    `the checkpoint must have survived round 2. A second turn 1 here means spawn-failed reached ` +
      `cache.clearIf, which is the degrade this split removed. Logs:\n${round3.join("\n")}`,
  );
});

btest("C1 [reason drives it: serving-failure]: two different throttle messages, one sentence", async () => {
  const a = await throwFrom("722 serving-failure (firstLine(diagnostics))");
  const b = await throwFrom("738 serving-failure (reply.api_error_status)");
  assert.notStrictEqual(a.message, b.message, "harness: the two drives must differ, or this row proves nothing");
  assert.strictEqual(
    toast(a.err),
    toast(b.err),
    `C1: same reason, different text, so the same sentence.\n  a: ${JSON.stringify(short(toast(a.err)))}\n` +
      `  b: ${JSON.stringify(short(toast(b.err)))}`,
  );
});

// ===========================================================================
// C3 - NO CLI TEXT ON SCREEN. The point of the phase, driven with hostile CLI
// output through every one of the six interpolating throws plus the two that
// carry a code or a spawn diagnostic.
// ===========================================================================

for (const label of ALL_DRIVES) {
  btest(`C3 [no cli text: ${label}]: the CLI's own words do not reach the notification`, async () => {
    const spec = DRIVES[label];
    const got = await throwFrom(label);
    const t = toast(got.err);

    // THE PRECONDITION, and the reason every one of these thirteen rows is red
    // at the branch point rather than only the ten with an interpolation in
    // them. CLI text is on screen today BECAUSE no sentence is crafted; the
    // three reasons whose throw interpolates nothing (logged-out and the two
    // "could not start") would otherwise pass this row vacuously and look like
    // evidence the phase had landed.
    assert.notStrictEqual(
      t,
      catchAllFor(got.message),
      `C3: reason ${JSON.stringify(got.reason)} still gets exactly what its raw message gets today - the ` +
        `catch-all with the throw pasted into the detail position. There is no sentence yet, so there is ` +
        `nothing keeping the CLI's words off the screen.\n  throw: ${JSON.stringify(short(got.message))}`,
    );

    assert.ok(typeof t === "string" && t.trim() !== "", `C3: there must be a sentence. Got ${JSON.stringify(t)}`);
    assert.ok(!t.includes("\n"), `C3: a notification is one line. Got ${JSON.stringify(short(t))}`);
    assert.ok(
      t.startsWith("Column 80:"),
      `C3: the house voice, the same one every row in the reject table already uses. Got ${JSON.stringify(short(t))}`,
    );
    assert.ok(
      t.length > 30,
      `C3: the sentence must name what happened and a next action, not just a label. Got ${JSON.stringify(t)}`,
    );

    for (const token of NEVER_ON_SCREEN) {
      assert.ok(
        !t.includes(token),
        `C3: internal vocabulary reached the screen - ${JSON.stringify(token)} in ${JSON.stringify(short(t))}`,
      );
    }
    for (const token of spec.banned) {
      assert.ok(
        !t.includes(token),
        `C3: the CLI's own output reached the screen - ${JSON.stringify(token)} in ${JSON.stringify(short(t))}.\n` +
          `  throw was: ${JSON.stringify(short(got.message))}`,
      );
    }
    if (spec.bannedCode !== undefined) {
      const code = String(spec.bannedCode);
      assert.ok(
        !new RegExp(`(^|[^0-9])${code}([^0-9]|$)`).test(t),
        `C3: "no exit code". The process exited ${code} and that number is on screen: ${JSON.stringify(short(t))}`,
      );
    }
    if (spec.carries !== undefined) {
      // C3's STATED EXCEPTION, pinned positively so it is a decision and not a
      // leak: these two reasons are the only ones whose cause is safe on screen,
      // because the interpolated text is a path or a binary name this product
      // wrote, not CLI output.
      assert.ok(
        t.includes(spec.carries),
        `C3 exception: reason ${JSON.stringify(spec.reason)} must say the backend cannot start WITH the ` +
          `one-line cause - the ${spec.reason === "bad-cwd" ? "path" : "binary name"} ` +
          `${JSON.stringify(spec.carries)}. Got ${JSON.stringify(short(t))}`,
      );
    } else {
      // And the exception is exactly two reasons wide.
      assert.ok(
        !t.includes(CLIDIR),
        `C3: a filesystem path leaked into a sentence that is not one of the two "could not start" ` +
          `reasons: ${JSON.stringify(short(t))}`,
      );
    }
  });
}

// ===========================================================================
// F1 - THE S57-10 REPRODUCTION. The row this item exists for, byte-for-byte as
// recorded.
// ===========================================================================

btest("F1 [S57-10 reproduction]: `Claude Code exited 1: Error: connection closed` is not what the user reads", async () => {
  const got = await throwFrom("728 exit (firstLine(stdout + stderr)) - S57-10");
  // The one throw string this file restates, because the contract quotes it
  // byte-for-byte as the recorded defect. It is also C4: the throw is unchanged.
  assert.strictEqual(
    got.message,
    S57_10_THROW,
    "harness + C4: the recorded throw must still be produced exactly. This phase changes translation, not " +
      "the throw strings",
  );
  const t = toast(got.err);
  assert.notStrictEqual(
    t,
    catchAllFor(S57_10_THROW),
    "F1: this is the defect verbatim - the CLI's `Error: connection closed` sails through the catch-all " +
      "because the v56 row bans `Error:` only at the detail position and here it sits after the backend's " +
      `own prefix.\n  toast: ${JSON.stringify(short(t))}`,
  );
  assert.ok(!t.includes("Error:"), `F1: no \`Error:\` on screen. Got ${JSON.stringify(short(t))}`);
  assert.ok(!t.includes("connection closed"), `F1: no CLI text on screen. Got ${JSON.stringify(short(t))}`);
  assert.ok(!t.includes("exited 1"), `F1: no exit code on screen. Got ${JSON.stringify(short(t))}`);
});

// ===========================================================================
// F3 / F4 / the sentence table - what each sentence must DO.
// ===========================================================================

btest("F3 [logged-out names login]: the sentence names logging in as the next action", async () => {
  const got = await throwFrom("logged-out");
  const t = toast(got.err);
  assert.notStrictEqual(t, catchAllFor(got.message), "F3: logged-out must draw a crafted sentence");
  assert.ok(
    /log ?in|login|logged in|sign ?in/i.test(t),
    `F3: the contract's table says this sentence names logging in as the next action. ` +
      `Got ${JSON.stringify(short(t))}`,
  );
});

btest("F4 [three serving-failure shapes agree]: 722, 738 and 754 all get the provider-trouble sentence", async () => {
  const a = await throwFrom("722 serving-failure (firstLine(diagnostics))");
  const b = await throwFrom("738 serving-failure (reply.api_error_status)");
  const c = await throwFrom("754 serving-failure (firstLine(reply.result))");
  const [ta, tb, tc] = [toast(a.err), toast(b.err), toast(c.err)];
  assert.notStrictEqual(ta, catchAllFor(a.message), "F4: serving-failure must draw a crafted sentence");
  assert.strictEqual(ta, tb, `F4: 722 and 738 must agree.\n  ${JSON.stringify(short(ta))}\n  ${JSON.stringify(short(tb))}`);
  assert.strictEqual(tb, tc, `F4: 738 and 754 must agree.\n  ${JSON.stringify(short(tb))}\n  ${JSON.stringify(short(tc))}`);
  assert.ok(
    /again|shortly|later|retry|wait|moment|minute/i.test(ta),
    `F4: the contract's table says "the provider is having trouble, try again shortly". Got ${JSON.stringify(short(ta))}`,
  );
});

for (const label of [
  "728 exit (firstLine(stdout + stderr)) - S57-10",
  "759 cli-error (subtype= plus firstLine(reply.result))",
  "731 bad-json (firstLine(stdout))",
  "agentic",
]) {
  btest(`[channel family: ${label}]: one honest line, and the full text is in the channel`, async () => {
    const got = await throwFrom(label);
    const t = toast(got.err);
    assert.notStrictEqual(t, catchAllFor(got.message), "the reason must draw a crafted sentence");
    assert.ok(
      /channel/i.test(t),
      `the contract's table groups exit / cli-error / bad-json / agentic as "the CLI failed, one honest ` +
        `line, the full text in the channel". Got ${JSON.stringify(short(t))}`,
    );
  });
}

btest("[start family]: binary-missing and bad-cwd say the backend cannot start, with the cause", async () => {
  const a = await throwFrom("binary-missing");
  const b = await throwFrom("bad-cwd");
  for (const [label, got] of [["binary-missing", a], ["bad-cwd", b]]) {
    const t = toast(got.err);
    assert.notStrictEqual(t, catchAllFor(got.message), `${label} must draw a crafted sentence`);
    assert.ok(
      /start|launch|run|find|install|path|director/i.test(t),
      `${label}: the table says "say the backend cannot start, with the one-line cause". ` +
        `Got ${JSON.stringify(short(t))}`,
    );
  }
});

btest("[timeout]: the sentence says the CLI did not answer in time, without the deadline in ms", async () => {
  const got = await throwFrom("timeout");
  const t = toast(got.err);
  assert.notStrictEqual(t, catchAllFor(got.message), "timeout must draw a crafted sentence");
  assert.ok(
    /again|shortly|later|retry|wait|channel|moment|minute/i.test(t),
    `the table gives timeout its own row ("the CLI did not answer in time"), and the phase's own rule is ` +
      `that every sentence names a next action. Got ${JSON.stringify(short(t))}`,
  );
  assert.ok(!/\d+ ?ms/.test(t), `an internal deadline in milliseconds is not a next action. Got ${JSON.stringify(short(t))}`);
});

btest("[groups differ]: four groups with four different next actions get four different sentences", async () => {
  // Deliberately NOT a claim that all ten sentences are distinct - the contract
  // says reasons may share a sentence where the next action is the same, and
  // this file does not over-constrain that. These four groups are the ones whose
  // next action the table makes plainly different: log in / wait for the
  // provider / read the channel / install or fix the path.
  const loggedOut = toast((await throwFrom("logged-out")).err);
  const throttled = toast((await throwFrom("722 serving-failure (firstLine(diagnostics))")).err);
  const cliFailed = toast((await throwFrom("731 bad-json (firstLine(stdout))")).err);
  const cannotStart = toast((await throwFrom("binary-missing")).err);
  const groups = { loggedOut, throttled, cliFailed, cannotStart };
  const names = Object.keys(groups);
  // The precondition. Four different RAW MESSAGES already produce four
  // different catch-alls, so without this the row is green at the branch point
  // and proves nothing at all.
  for (const [label, message] of [
    ["loggedOut", (await throwFrom("logged-out")).message],
    ["throttled", (await throwFrom("722 serving-failure (firstLine(diagnostics))")).message],
    ["cliFailed", (await throwFrom("731 bad-json (firstLine(stdout))")).message],
    ["cannotStart", (await throwFrom("binary-missing")).message],
  ]) {
    assert.notStrictEqual(
      groups[label],
      catchAllFor(message),
      `${label} is still the catch-all, so the four "different sentences" below are only four different ` +
        `raw messages wearing the same template`,
    );
  }
  for (let i = 0; i < names.length; i += 1) {
    for (let j = i + 1; j < names.length; j += 1) {
      assert.notStrictEqual(
        groups[names[i]],
        groups[names[j]],
        `${names[i]} and ${names[j]} name different next actions and must not share one wording.\n` +
          `  ${names[i]}: ${JSON.stringify(short(groups[names[i]]))}\n` +
          `  ${names[j]}: ${JSON.stringify(short(groups[names[j]]))}`,
      );
    }
  }
});

// ===========================================================================
// C4 - THE CHANNEL KEEPS IT WHOLE. REGRESSION: green now, green after.
//
// `fnGenService` logs `[fngen] request failed: ${String(err)}`. This phase
// changes translation, not the throw strings, so the ERROR is where C4 is
// pinned: the raw message and String(err) must still carry the CLI text.
// ===========================================================================

const C4_EXPECT = {
  "722 serving-failure (firstLine(diagnostics))": H_THROTTLE,
  "728 exit (firstLine(stdout + stderr)) - S57-10": S57_10_CLI_LINE,
  "731 bad-json (firstLine(stdout))": H_JUNK,
  "738 serving-failure (reply.api_error_status)": H_STATUS,
  "754 serving-failure (firstLine(reply.result))": H_THROTTLE,
  "759 cli-error (subtype= plus firstLine(reply.result))": S57_10_CLI_LINE,
  "binary-missing": MISSING_BINARY,
  "bad-cwd": GONE_DIR,
  // Added on the re-cut. :626 changed REASON and nothing else; the phase's
  // out-of-scope line forbids rewording a throw, and this is where that is
  // checked. The errno the sentence refuses to show is still in the channel.
  "626 spawn-failed (a spawn diagnostic, not CLI output)": "EACCES",
};

for (const [label, kept] of Object.entries(C4_EXPECT)) {
  btest(`C4 [raw message unchanged: ${label}]: REGRESSION - the CLI text still reaches the channel`, async () => {
    const got = await throwFrom(label);
    assert.ok(
      got.message.includes(kept),
      `C4: the throw strings are the channel's copy and stay as they are. ${JSON.stringify(kept)} is no ` +
        `longer in the message: ${JSON.stringify(short(got.message))}`,
    );
    assert.ok(
      String(got.err).includes(kept),
      `C4: the channel line interpolates String(err), and that is what carries the diagnostic. Got ` +
        `${JSON.stringify(short(String(got.err)))}`,
    );
  });
}

// ===========================================================================
// C5 - IDENTITY, NOT TEXT. The pass reads `name` and `reason`. A server or a CLI
// that puts `ClaudeCodeError` or a reason string inside its OWN output must not
// be able to draw a sentence.
// ===========================================================================

btest("C5 [same text, different identity]: the real throw and a forgery of it must part company", async () => {
  // The headline forgery row. The forgery's message is the REAL throw's message,
  // byte for byte, read off the live drive. Today they are indistinguishable
  // because the translator only reads text; after the phase the identity decides.
  const got = await throwFrom("728 exit (firstLine(stdout + stderr)) - S57-10");
  const forged = new Error(got.message);
  assert.strictEqual(forged.name, "Error", "harness: the forgery must be a plain Error");
  assert.notStrictEqual(
    toast(got.err),
    toast(forged),
    `C5: two errors with identical messages, one carrying the backend's identity and one not. The pass ` +
      `reads identity, so the sentences must differ.\n  real   : ${JSON.stringify(short(toast(got.err)))}\n` +
      `  forged : ${JSON.stringify(short(toast(forged)))}`,
  );
});

btest("C5 [forgery: plain Error]: REGRESSION - a message that merely BEGINS `Claude Code` draws nothing", async () => {
  const forged = new Error(S57_10_THROW);
  assert.strictEqual(
    B.translateServiceReject(forged),
    undefined,
    `C5: a plain Error whose message starts with "Claude Code" is a server, a proxy or another subsystem ` +
      `quoting us. It has no reason, so it gets no sentence. Got ` +
      `${JSON.stringify(short(B.translateServiceReject(forged)))}`,
  );
  assert.strictEqual(
    toast(forged),
    catchAllFor(S57_10_THROW),
    "C5: and what it gets is exactly today's catch-all, unchanged",
  );
});

btest("C5 [forgery: class name in text]: REGRESSION - a message CONTAINING `ClaudeCodeError` draws nothing", async () => {
  for (const message of [
    "the server said ClaudeCodeError reason=logged-out",
    "ClaudeCodeError: Claude Code is not logged in. Run `claude` in a terminal, then `/login`.",
    "upstream returned: {\"name\":\"ClaudeCodeError\",\"reason\":\"serving-failure\"}",
  ]) {
    const forged = new Error(message);
    assert.strictEqual(
      B.translateServiceReject(forged),
      undefined,
      `C5: identity is a property of the object, never a substring of its text. ` +
        `${JSON.stringify(message)} drew ${JSON.stringify(short(B.translateServiceReject(forged)))}`,
    );
    assert.strictEqual(toast(forged), catchAllFor(message), "C5: today's catch-all, unchanged");
  }
});

btest("C5 [forgery: reason without name]: REGRESSION - a `reason` field on a plain Error draws nothing", async () => {
  // The other half of "the pass reads `name` AND `reason`". An object that
  // carries the field but not the identity is not this backend.
  for (const reason of ["logged-out", "serving-failure", "exit"]) {
    const forged = new Error(`something upstream failed and tagged itself ${reason}`);
    forged.reason = reason;
    assert.strictEqual(
      B.translateServiceReject(forged),
      undefined,
      `C5: name is still "Error" here, so this is not a Claude Code failure. reason=${reason} drew ` +
        `${JSON.stringify(short(B.translateServiceReject(forged)))}`,
    );
    assert.strictEqual(toast(forged), catchAllFor(forged.message), "C5: today's catch-all, unchanged");
  }
});

// ===========================================================================
// F5 - AN UNKNOWN REASON DEGRADES TO TODAY'S CATCH-ALL. C2's "it only ever
// NARROWS", from the inside. FORWARD GUARD: green now, meaningful after.
// ===========================================================================

btest("F5 [unknown reason degrades]: FORWARD GUARD - a reason outside the union gets what it gets today", async () => {
  const message = "Claude Code did something new: Error: subtype=novel exit 9";
  const reasons = [
    "not-a-real-reason",
    // Item 68's own wrong field name, in the reason position.
    "kind",
    "",
    "exit ",
    // ADDED ON THE RE-CUT, AND THIS FILE MISSED THEM FIRST TIME. The
    // adversarial review found that a bare object-literal lookup inherits from
    // Object.prototype, so these six names were not "unrecognised" at all:
    // `constructor` returned the raw message with its `Error:` token intact,
    // `toString` rendered "[object Object]", and `__proto__` threw a TypeError
    // out of generationFailedToast - which runs inside the gesture's own catch,
    // so the user got no toast at all. My four values above are all ordinary
    // strings and none of them would have caught it. The fix is a
    // hasOwnProperty guard; these rows are what hold it.
    "constructor",
    "toString",
    "valueOf",
    "hasOwnProperty",
    "__proto__",
    "isPrototypeOf",
  ];
  for (const reason of reasons) {
    const err = new B.ClaudeCodeError(reason, message);
    assert.strictEqual(err.name, "ClaudeCodeError", "harness: the real constructor sets the identity");
    let got;
    assert.doesNotThrow(() => {
      got = toast(err);
    }, `C2/F5: an unrecognised reason (${JSON.stringify(reason)}) must not throw out of the gesture's catch`);
    assert.strictEqual(
      got,
      catchAllFor(message),
      `C2/F5: an unrecognised reason (${JSON.stringify(reason)}) must fall through to the passes that ` +
        `exist today. The pass only ever NARROWS.\n  got      : ${JSON.stringify(short(toast(err)))}\n` +
        `  catch-all: ${JSON.stringify(short(catchAllFor(message)))}`,
    );
  }
});

// ===========================================================================
// F7 - A ClaudeCodeError WITH NO REASON DOES NOT CRASH THE TRANSLATOR.
// FORWARD GUARD: green now, meaningful after.
// ===========================================================================

for (const [label, reason] of [
  ["no reason at all", Symbol("absent")],
  ["reason undefined", undefined],
  ["reason null", null],
  ["reason a number", 42],
  ["reason an object", { reason: "logged-out" }],
  ["reason an array", ["logged-out"]],
]) {
  btest(`F7 [${label}]: FORWARD GUARD - the translator survives an identity with no usable reason`, () => {
    if (bundleErr) return;
    const message = "Claude Code failed in a shape nobody has written down yet";
    const err = new Error(message);
    err.name = "ClaudeCodeError";
    if (typeof reason !== "symbol") err.reason = reason;

    let sentence;
    assert.doesNotThrow(() => {
      sentence = B.translateServiceReject(err);
    }, "F7: a switch with no default, or a lookup on undefined, is how this crashes");
    let t;
    assert.doesNotThrow(() => {
      t = toast(err);
    }, "F7: and the same through the gesture's catch-all");
    assert.ok(typeof t === "string" && t.trim() !== "", `F7: the user still gets a sentence. Got ${JSON.stringify(t)}`);
    assert.ok(!t.includes("\n"), `F7: and it is one line. Got ${JSON.stringify(short(t))}`);
    assert.ok(
      !t.includes("undefined") && !t.includes("[object Object]"),
      `F7: nor a rendered internal value. Got ${JSON.stringify(short(t))}`,
    );
    console.error("F7 [%s]: tsr=%j toast=%j", label, short(sentence), short(t));
  });
}

// ===========================================================================
// C6 - `no-session` IS NOT A ROUND FAILURE.
//
// The union's own comment says it degrades to a whole-prompt round and says so
// on the evidence line, never surfacing as a round failure. Two rows: the live
// one proves the reachability claim, and the translator one pins that the pass
// does not INVENT a reachability it does not have.
// ===========================================================================

btest("C6 [no-session degrades, live]: REGRESSION - a warm with no session id ends in a successful round", async () => {
  // Turn 1 replies with a perfectly parseable success that carries no
  // `session_id`; the second spawn answers the whole prompt. If a toast ever
  // appears for this reason, the sentence table would need a row it must not
  // have.
  const counter = path.join(CLIDIR, "no-session-count.txt");
  const turn1 = path.join(CLIDIR, "no-session-1.json");
  const turn2 = path.join(CLIDIR, "no-session-2.json");
  fs.writeFileSync(turn1, JSON.stringify({ result: "ok", subtype: "success", num_turns: 1 }));
  fs.writeFileSync(
    turn2,
    JSON.stringify({ result: "fn add(a: i32, b: i32) -> i32 { a + b }", subtype: "success", num_turns: 1, session_id: "sess-2" }),
  );
  const binary = script(
    `N=$(cat ${JSON.stringify(counter)} 2>/dev/null || echo 0)\n` +
      `N=$((N+1))\n` +
      `echo $N > ${JSON.stringify(counter)}\n` +
      `if [ "$N" = "1" ]; then cat ${JSON.stringify(turn1)}; else cat ${JSON.stringify(turn2)}; fi\n` +
      `exit 0`,
  );

  // A cache prefix over the fork floor, and a prompt that genuinely begins with
  // it - anything else is served single-shot and turn 1 never happens.
  const prefix = "// a pinned context block line\n".repeat(200);
  assert.ok(
    Buffer.byteLength(prefix, "utf8") >= B.MIN_PREFIX_BYTES,
    "harness: the prefix must clear the fork floor or no turn 1 is spawned and this row tests nothing",
  );
  const logs = [];
  const gen = B.makeClaudeCodeInstruct({ cwd: CLIDIR, binary, log: (l) => logs.push(l) });
  const value = await gen({
    apiBase: "",
    model: "",
    prompt: prefix + B.SECTION_SEPARATOR + "write a function that adds two integers",
    cachePrefix: prefix,
    maxTokens: 256,
    temperature: 0,
    signal: new AbortController().signal,
  });

  assert.strictEqual(
    value.text,
    "fn add(a: i32, b: i32) -> i32 { a + b }",
    `C6: a warm with no session id degrades to a whole-prompt round and that round SUCCEEDS. There is no ` +
      `failure here and therefore no toast. Logs:\n${logs.join("\n")}`,
  );
  assert.ok(
    logs.some((l) => l.includes("no-session")),
    `C6: "...and says so on the evidence line". Logs:\n${logs.join("\n")}`,
  );
});

btest("C6 [no-session draws no sentence]: FORWARD GUARD - the pass must not invent a reachability", () => {
  if (bundleErr) return;
  const message = "Claude Code returned no session id to fork from.";
  const err = new B.ClaudeCodeError("no-session", message);
  assert.strictEqual(
    B.translateServiceReject(err),
    undefined,
    `C6: no-session never reaches a toast, so it gets no sentence. A sentence here is a claim about a ` +
      `screen this failure never touches. Got ${JSON.stringify(short(B.translateServiceReject(err)))}`,
  );
  assert.strictEqual(toast(err), catchAllFor(message), "C6: and it falls through to today's catch-all");
});

// ===========================================================================
// C2 + F8 - THE REGRESSION CLAUSE. THE BIG ONE.
//
// "Adding this pass must not change ANY message that is not a
// ClaudeCodeError." The corpus below is the existing translation surface: every
// marker in the reject table, bare and with a prefix in front of it (which is
// what separates the anchored rows from the substring rows), every
// payload-carrier head, and the catch-all's own shapes including the two
// forgeries C5 names.
//
// The expected values are a GOLDEN CAPTURE taken from this tree at the branch
// point, HEAD 3831d3c. A file written before the change has no other way to say
// "byte-identical before and after": the before has to be written down. If one
// of these goes red, phase 6 reached a message it had no business touching -
// and five phases of v56/v57 translation work is what this row protects.
// ===========================================================================

const TRUNCATED = "Column 80: the model's reply was cut off mid-function, so nothing was written - run the gesture again.";
const NO_TESTS = "Column 80: the model's reply contained no usable tests, so nothing was written - run the gesture again.";
const FENCED =
  "Column 80: the model wrapped its reply in markdown that cannot land in source code, so nothing was written - run the gesture again.";
const WRONG_FN =
  "Column 80: the model answered with something other than the requested function, so nothing was written - run the gesture again.";
const NO_CODE = "Column 80: the model's reply contained no usable code, so nothing was written - run the gesture again.";
const SILENT =
  "Column 80: the model server went silent mid-reply, so nothing was written - check the server, then run the gesture again.";

const PREFIXED = (marker) => `the fn-gen service rejected this: ${marker} (round 2)`;
const CARRIED = (head) => `${head} something the server said: generation was empty after postprocess`;

/** [label, message, expected translateServiceReject, expected generationFailedToast] */
const GOLDEN = [
  // -- substring rows: matched bare AND behind a prefix ---------------------
  ["truncated/bare", "generation truncated at num_predict", TRUNCATED, TRUNCATED],
  ["truncated/prefixed", PREFIXED("generation truncated at num_predict"), TRUNCATED, TRUNCATED],
  ["tests/bare", "does not contain a test module", NO_TESTS, NO_TESTS],
  ["tests/prefixed", PREFIXED("does not contain a test module"), NO_TESTS, NO_TESTS],
  ["tests2/bare", "test functions (no fenced block", NO_TESTS, NO_TESTS],
  ["tests2/prefixed", PREFIXED("test functions (no fenced block"), NO_TESTS, NO_TESTS],
  ["fence/bare", "generation contains a code-fence line", FENCED, FENCED],
  ["fence/prefixed", PREFIXED("generation contains a code-fence line"), FENCED, FENCED],
  ["wrongfn/bare", "generation does not contain the requested function", WRONG_FN, WRONG_FN],
  ["wrongfn/prefixed", PREFIXED("generation does not contain the requested function"), WRONG_FN, WRONG_FN],
  ["empty/bare", "generation was empty after postprocess", NO_CODE, NO_CODE],
  ["empty/prefixed", PREFIXED("generation was empty after postprocess"), NO_CODE, NO_CODE],

  // -- anchored rows: the sentence bare, the CATCH-ALL behind a prefix ------
  ["silent/ollama-cut/bare", "Ollama stream cut:", SILENT, SILENT],
  [
    "silent/ollama-cut/prefixed",
    PREFIXED("Ollama stream cut:"),
    undefined,
    "Column 80: function generation failed - the fn-gen service rejected this: Ollama stream cut: (round 2). The full message is in the output channel.",
  ],
  ["silent/ollama-nobody/bare", "Ollama: response has no body", SILENT, SILENT],
  [
    "silent/ollama-nobody/prefixed",
    PREFIXED("Ollama: response has no body"),
    undefined,
    "Column 80: function generation failed - the fn-gen service rejected this: Ollama: response has no body (round 2). The full message is in the output channel.",
  ],
  ["silent/anthropic-stop/bare", "Anthropic: the stream ended before message_stop", SILENT, SILENT],
  [
    "silent/anthropic-stop/prefixed",
    PREFIXED("Anthropic: the stream ended before message_stop"),
    undefined,
    "Column 80: function generation failed - the fn-gen service rejected this: Anthropic: the stream ended before message_stop (round 2). The full message is in the output channel.",
  ],
  ["silent/anthropic-nobody/bare", "Anthropic: response has no body", SILENT, SILENT],
  [
    "silent/anthropic-nobody/prefixed",
    PREFIXED("Anthropic: response has no body"),
    undefined,
    "Column 80: function generation failed - the fn-gen service rejected this: Anthropic: response has no body (round 2). The full message is in the output channel.",
  ],
  ["silent/cloud-nobody/bare", "Cloud: response has no body", SILENT, SILENT],
  [
    "silent/cloud-nobody/prefixed",
    PREFIXED("Cloud: response has no body"),
    undefined,
    "Column 80: function generation failed - the fn-gen service rejected this: Cloud: response has no body (round 2). The full message is in the output channel.",
  ],
  ["silent/ollama-done/bare", "Ollama: the stream ended before its done frame", SILENT, SILENT],
  [
    "silent/ollama-done/prefixed",
    PREFIXED("Ollama: the stream ended before its done frame"),
    undefined,
    "Column 80: function generation failed - the fn-gen service rejected this: Ollama: the stream ended before its done frame (round 2). The full message is in the output channel.",
  ],
  ["silent/cloud-terminal/bare", "Cloud: the stream ended before any terminal signal", SILENT, SILENT],
  [
    "silent/cloud-terminal/prefixed",
    PREFIXED("Cloud: the stream ended before any terminal signal"),
    undefined,
    "Column 80: function generation failed - the fn-gen service rejected this: Cloud: the stream ended before any terminal signal (round 2). The full message is in the output channel.",
  ],

  // -- payload carriers: a service marker inside server text draws nothing --
  [
    "carrier/ollama-error",
    CARRIED("Ollama error:"),
    undefined,
    "Column 80: function generation failed - Ollama error: something the server said: generation was empty after postprocess. The full message is in the output channel.",
  ],
  // The one carrier that IS also an anchored marker, so it keeps its sentence.
  ["carrier/ollama-cut", CARRIED("Ollama stream cut:"), SILENT, SILENT],
  [
    "carrier/ollama-space",
    CARRIED("Ollama "),
    undefined,
    "Column 80: function generation failed - Ollama  something the server said: generation was empty after postprocess. The full message is in the output channel.",
  ],
  [
    "carrier/anthropic-mid-reply",
    CARRIED("Anthropic reported an error mid-reply:"),
    undefined,
    "Column 80: function generation failed - Anthropic reported an error mid-reply: something the server said: generation was empty after postprocess. The full message is in the output channel.",
  ],
  [
    "carrier/anthropic-space",
    CARRIED("Anthropic "),
    undefined,
    "Column 80: function generation failed - Anthropic  something the server said: generation was empty after postprocess. The full message is in the output channel.",
  ],
  [
    "carrier/cloud-mid-reply",
    CARRIED("Cloud reported an error mid-reply:"),
    undefined,
    "Column 80: function generation failed - Cloud reported an error mid-reply: something the server said: generation was empty after postprocess. The full message is in the output channel.",
  ],
  [
    "carrier/cloud-space",
    CARRIED("Cloud "),
    undefined,
    "Column 80: function generation failed - Cloud  something the server said: generation was empty after postprocess. The full message is in the output channel.",
  ],

  // -- the catch-all's own shapes ------------------------------------------
  [
    "catchall/plain",
    "socket hang up",
    undefined,
    "Column 80: function generation failed - socket hang up. The full message is in the output channel.",
  ],
  [
    "catchall/error-colon",
    "Error: fetch failed",
    undefined,
    "Column 80: function generation failed - Error: fetch failed. The full message is in the output channel.",
  ],
  [
    "catchall/multiline",
    "first line of the dump\nsecond line\nthird",
    undefined,
    "Column 80: function generation failed - first line of the dump. The full message is in the output channel.",
  ],
  ["catchall/empty", "", undefined, "Column 80: function generation failed. The full message is in the output channel."],
  [
    "catchall/trailing-dot",
    "the request was refused.",
    undefined,
    "Column 80: function generation failed - the request was refused. The full message is in the output channel.",
  ],
  [
    "catchall/claude-code-forgery",
    S57_10_THROW,
    undefined,
    "Column 80: function generation failed - Claude Code exited 1: Error: connection closed. The full message is in the output channel.",
  ],
  [
    "catchall/class-name-forgery",
    "the server said ClaudeCodeError reason=logged-out",
    undefined,
    "Column 80: function generation failed - the server said ClaudeCodeError reason=logged-out. The full message is in the output channel.",
  ],
  [
    "catchall/bare-reason-word",
    "logged-out",
    undefined,
    "Column 80: function generation failed - logged-out. The full message is in the output channel.",
  ],
];

btest("C2 [41-row corpus, byte-identical]: REGRESSION - the existing translation surface is untouched", () => {
  if (bundleErr) return;
  assert.strictEqual(GOLDEN.length, 41, "harness: the corpus lost or gained a row");
  const drift = [];
  for (const [label, message, wantTsr, wantToast] of GOLDEN) {
    const err = new Error(message);
    const gotTsr = B.translateServiceReject(err);
    const gotToast = toast(err);
    if (gotTsr !== wantTsr) drift.push(`${label} tsr\n    want ${JSON.stringify(wantTsr)}\n    got  ${JSON.stringify(gotTsr)}`);
    if (gotToast !== wantToast) {
      drift.push(`${label} toast\n    want ${JSON.stringify(wantToast)}\n    got  ${JSON.stringify(gotToast)}`);
    }
  }
  assert.deepStrictEqual(
    drift,
    [],
    `C2: the structural pass only ever NARROWS. It changed ${drift.length} output(s) on messages that are ` +
      `not ClaudeCodeErrors:\n  ${drift.join("\n  ")}`,
  );
});

btest("C2 [long detail]: REGRESSION - an oversized detail renders through the identical template", () => {
  if (bundleErr) return;
  // Derived rather than pasted: the 1200-character body is substituted into the
  // plain catch-all golden, so this row asserts the template is the same one
  // without writing a 1200-character literal into the file.
  const filler = "y".repeat(1200);
  const want = GOLDEN.find(([l]) => l === "catchall/plain")[3].replace("socket hang up", filler);
  assert.strictEqual(
    toast(new Error(filler)),
    want,
    "C2: the catch-all's rendering of a long detail changed. That is not this phase's business",
  );
});

btest("F8 [non-Error rejects]: REGRESSION - the same clause, off the Error path", () => {
  if (bundleErr) return;
  // `translateServiceReject` falls back to String(err) for a non-Error. A
  // structural pass that reads `err.name` without checking what `err` IS would
  // throw here on null or undefined.
  const rows = [
    ["a bare string reject", "Column 80: function generation failed - a bare string reject. The full message is in the output channel."],
    [42, "Column 80: function generation failed - 42. The full message is in the output channel."],
    [null, "Column 80: function generation failed - null. The full message is in the output channel."],
    [undefined, "Column 80: function generation failed - undefined. The full message is in the output channel."],
    [
      { toString: () => "an object that stringifies" },
      "Column 80: function generation failed - an object that stringifies. The full message is in the output channel.",
    ],
    // The nastiest one: a plain object wearing the identity but not an Error.
    // Whatever the pass decides here, it must not crash, and today it is the
    // catch-all.
    [
      { name: "ClaudeCodeError", reason: "logged-out" },
      "Column 80: function generation failed - [object Object]. The full message is in the output channel.",
    ],
  ];
  for (const [value, want] of rows) {
    let got;
    assert.doesNotThrow(() => {
      got = toast(value);
    }, `F8: a non-Error reject must not crash the translator. Value: ${String(value)}`);
    assert.strictEqual(
      got,
      want,
      `F8/C2: a non-Error reject changed.\n  value: ${String(value)}\n  want : ${JSON.stringify(want)}\n` +
        `  got  : ${JSON.stringify(got)}`,
    );
  }
});
