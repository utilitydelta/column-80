// Blind oracle, session-v58 phase 7: "the HTTP statuses become sentences"
// (roadmap item 68, second half - the structural pass, second case).
// Written BEFORE the change, against the phase-7 CONTRACT and nothing else.
//
// ===========================================================================
// WHAT THIS FILE PINS
// ===========================================================================
//
// Three HTTP transports put a raw provider JSON body where a sentence belongs:
//
//     Column 80: function generation failed - Ollama 503 Service Unavailable:
//     {"error":{"type":"rate_limit_error",...}}. The full message is in the
//     output channel.
//
// Phase 7 makes the STATUS CLASS the sentence. A typed error in a leaf carries
// {transport, status}; the structural pass phase 6 added switches on `status`
// for its second case; 401/403, 429, 5xx and everything else each get one
// sentence naming one next action, and the provider's body stays in the
// channel.
//
// FOUR SITES, THREE OF THEM CONSUMERS OF `generationFailedToast`:
//   ollama.ts generate, ollama.ts pullModel, anthropicInstruct.ts,
//   cloudInstruct.ts. The pull site is the odd one: `firstRun.ts` builds its
//   own toast and never calls `generationFailedToast`, which is C7.
//
// ===========================================================================
// RE-CUT AFTER THE PHASE-7 REVIEW: THE FALLBACK GOT ITS RULING REVERSED
// ===========================================================================
//
// The first cut of this file read the contract's fourth table row - "anything
// else: the generic failure sentence, with the status number" - as a CRAFTED
// sentence carrying the number, and 12 rows were gated on that. Driven at the
// branch point, that sentence DELETED the provider's own remedy: an ollama 404
// toasted `model "test-model" not found, try pulling it first` before and
// "HTTP 404, see the channel" after. Anthropic's 400 carries `prompt is too
// long: 250000 tokens > 200000 maximum`; the cloud arm's 413 carries
// `context_length_exceeded`. Those are exactly the statuses where the BODY is
// the next action, and exactly the ones with no class.
//
// RULED: an unclassified status gets NO crafted sentence and falls through to
// the catch-all - S20's ratified reasoning one layer out. C5 is NOT dropped by
// that: the catch-all renders the number, the remedy and the pointer together.
//
// WHAT MOVED HERE, and it is a strengthening rather than a retreat:
//   * the C5 group now drives the three bodies the review measured, not this
//     file's hostile JSON, and asserts the remedy token is ON SCREEN. That
//     clause is the one that would have caught the HIGH, so it is the sharpest
//     row in the group: a fallback sentence that swallows the reason turns it
//     red.
//   * `requireFallthrough` replaces `requireCrafted` there, and it is a
//     STRONGER precondition, not a weaker one: it pins `translateServiceReject
//     === undefined` and `toast === catch-all`, so a crafted fallback fails on
//     the mechanism before any wording is judged.
//   * `C4 [next action: other]` is gone; the fallback is not a class.
//   * `C4/C6 [arm x status]` runs over the CLASSIFIED statuses only. C6's ban
//     is a claim about a class, and the fallback keeps its body deliberately.
//   * the 5xx class is a RANGE, 500-599: 504 and Cloudflare's 520-524 are
//     driven, and the row says in its own diagnostic why an enumeration of four
//     is the bug.
//   * two rows are NEW, both from the same review: `C4 [transport split]` (the
//     local arm must not be sent to `column80.cloudApiKey`, which its own
//     description says the local backend ignores - naming it is the S20 failure
//     of a remedy that does not exist) and `C4 [pointer]` (401/403 and 429
//     carry the channel pointer, because the body separates an invalid key from
//     an exhausted balance and a rate limit from a dead quota, and the class
//     sentence cannot).
//
// ===========================================================================
// HOW THE FAILURES ARE PRODUCED: REAL SOCKETS, NEVER A HAND-BUILT ERROR
// ===========================================================================
//
// Every status row drives the real transport against a real `http.createServer`
// answering a real status line. A hand-typed `new Error("Ollama 429 ...")` would
// test a string this file invented, and worse, it would be indistinguishable
// from the forgery falsifier 5 exists to catch. The only hand-built errors in
// this file are in the FORGERY rows, where a plain `Error` carrying a real
// throw's exact text is the whole point.
//
// ===========================================================================
// TWO MATERIALISED TREES, BECAUSE A DERIVATION SLIDES WITH THE CODE
// ===========================================================================
//
// C2 says byte-identical "proven against a real branch-point worktree, not
// against a derivation". Phase 1's oracle derived its expectation from the
// product's own `boundBody` and a live `Response`; a phase that moved the bound
// on both surfaces at once would move that expectation with it and stay green.
// So this file materialises the trees instead, with `git archive <ref> src |
// tar -x`, and drives BOTH against the SAME server:
//
//   BASE_OLD = 6861edd   the branch point the contract names. C2's tree.
//   BASE_P6  = 5190b7a   this session's HEAD as phase 7 begins. The right base
//                        for falsifier 7 (`[http-body]` is phase 1's line, born
//                        inside this session) and for C8 (phase 6's sentences,
//                        born one commit ago). Trivially green until the build
//                        lands, and load bearing the moment it does.
//
// `git archive` rather than a checkout: it writes the tree somewhere else and
// never touches the working copy. G2/G3 prove each extracted tree really is the
// older one, because a "worktree" that is secretly a copy of `now` proves
// nothing at all.
//
// ===========================================================================
// REGRESSION ROWS - GREEN ON BOTH SIDES. THE ONES THAT PROTECT SIX PHASES
// ===========================================================================
//
// A red one means phase 7 broke something that already worked, never "the
// feature has not landed yet":
//
//   C2 [4 arms x 8 body shapes]  <- THE BIG ONE, 32 rows. Falsifier 2. Every
//   C2 [4 arms x status sweep]      session-v57 blind row, every phase-1 blind
//                                   row and `fnGenService`'s channel copy are
//                                   built out of these four strings.
//   F7 [http-body unchanged] x4  <- falsifier 7, against BASE_P6.
//   C8 [phase 6 corpus] x1       <- all ten Claude Code sentences, against
//                                   BASE_P6. Falsifier 6's regression half.
//   C8 [translation surface] x1  <- 24 message shapes through
//                                   generationFailedToast, against BASE_P6.
//                                   Falsifier 4's surface half.
//   F5 [forgery] x5              <- a server saying "429" in a 200 body, and a
//                                   plain Error wearing a real 429's text.
//   C7 [pull toast] [pull channel]
//   happy path x2
//
// FALSIFIER 4 IS DISCHARGED BY MEASUREMENT, NOT BY RE-RUNNING OTHER FILES.
// "Every session-v57 and phase-1 blind row that pins these strings passes
// untouched" is a claim about four strings and one channel line. C2 compares
// the strings tree-against-tree over 8 body shapes and 8 statuses on all four
// sites; F7 compares the channel line the same way. A row here that shells out
// to `node --test` on those files would add minutes of gate time and three
// load-sensitive rows, and would prove less.
//
// ===========================================================================
// BINDINGS THE CONTRACT LEAVES OPEN, RESOLVED AND REPORTED
// ===========================================================================
//
//   * THE FOUR SENTENCES. Never written down: "exact words are this phase's to
//     craft". Every headline row asserts `toast !== generationFailedToast(new
//     Error(<the same message>), gesture)` - the crafted sentence must differ
//     from what that exact message gets today. Both sides come out of the
//     product, so a rewording re-baselines this file rather than breaking it.
//   * "NAMES A NEXT ACTION" is not machine-checkable in general. Bound per
//     contract-table row to the narrowest probe the table itself licenses:
//     401/403 must name the key or the credential; 429 must point at waiting or
//     running it again; 5xx must point at trying again; the fallback must point
//     at the channel or at checking something. Each probe is a permissive
//     alternation, so only a sentence with NO next action in it fails.
//   * THE POINTER'S WORDING is never typed here. It is lifted out of the
//     product by rendering the catch-all around a sentinel detail and taking
//     what follows it, so the pointer rows re-baseline on a rewording instead
//     of going falsely red.
//   * "A CLASS, NOT A CODE" (C4) vs "THE FALLBACK CARRIES THE NUMBER" (C5).
//     A build may reasonably decide to put the status number in EVERY sentence.
//     That is not this file's call, so the class-agreement rows compare the two
//     members of a class with digit runs normalised to `#`, which tests the
//     CLASS claim without ruling on the numbering choice. The group-distinctness
//     rows use the normalised strings too: four sentences that differ only by a
//     number are one sentence with a number in it, and C4 asks for four.
//   * THE TYPED ERROR'S FIELDS. `{transport, status}` is fixed by the contract,
//     so `err.status` (number) and `err.transport` (string) are asserted by
//     name. Nothing else about the class is asserted, except C1's leaf claim.
//   * C1'S LEAF CLAIM is a source-shape claim, so it gets a source-shape row:
//     find the file under `src/` declaring the thrown class, assert it sits in
//     `src/core`, is not one of the three transports, and its import lines name
//     no transport and no `vscode`. That is the "check the direction before
//     writing the file" the contract asks for, and it is the only row in this
//     file that reads product source.
//   * THE TRANSPORT TOKEN. `err.transport` is matched case-insensitively
//     against the name the throw already uses - ollama, ollama, anthropic,
//     cloud. The pull site may call itself `ollama` or `ollama-pull`; both
//     satisfy /ollama/i.
//   * C7'S TWO ACCEPTABLE OUTCOMES. The contract explicitly does not decide
//     whether the pull gains class sentences. The row therefore accepts EITHER
//     "byte-identical to BASE_P6's pull toast" OR "a crafted, one-line,
//     house-voice sentence with no JSON in it", prints which one it saw, and
//     fails on anything else. An unnoticed change is not a valid build.
//   * NO JSON (C6) is bound as: no `{`, no `}`, no `":`, and none of the
//     hostile body's own distinctive tokens (`request_id`, the request id
//     itself, `rate_limit_error`). A sentence saying "rate limited" in prose is
//     deliberately allowed; the provider's field names are not.
//   * THE GESTURE ARGUMENT is "function generation" everywhere, so any
//     difference between rows is the ERROR's doing and never the gesture's.
//   * 529 has no reason phrase in Node's table (`statusText` is "unknown"), and
//     that is fine: nothing here reads the reason phrase except C2, which
//     compares it tree-against-tree rather than to a literal.
//
// ===========================================================================
// A CONTRACT FINDING, FILED BEFORE THE BUILD
// ===========================================================================
//
// C2 says `String(err)` is byte-identical. `String(err)` renders `${name}:
// ${message}`, and the ONE precedent for a typed error in this repo -
// `ClaudeCodeError` - sets `this.name = "ClaudeCodeError"` in its constructor,
// which is also how phase 6's pass identifies it. If phase 7 copies that idiom
// then `String(err)` becomes `HttpStatusError: Ollama 503 ...` at all four
// sites, C2 fails as written, and `fnGenService`'s `[fngen] request failed:
// ${String(err)}` line moves with it.
//
// So the C2 rows assert the MESSAGE first and `String(err)` second, with
// separate diagnostics, and the second one's diagnostic says exactly this: if
// the message matches and `String(err)` does not, the class set `name` and the
// pass must identify itself some other way (`instanceof` from the leaf, or a
// marker field). That is a contract question, not a test defect.
//
// ===========================================================================
// MEASURED AT THE BRANCH POINT (HEAD 5190b7a, run, not predicted)
// ===========================================================================
//
//   128 rows. 71 RED, 57 GREEN, 0 skipped. duration_ms about 450.
//
//   Every red row is red on the ABSENT FEATURE and nothing else: either
//   `err.status === undefined` (there is no typed error yet) or the `crafted`
//   precondition (the toast is still byte-identical to the catch-all).
//
//   AFTER THE BUILD AND THE RE-CUT: 154 rows, all green, duration_ms about 520.
//   The 26 rows added or re-cut for the review's HIGH were written AFTER the
//   build and are green on arrival, so they are not evidence of anything on
//   their own. Two things are recorded instead of trusting them:
//     * P0's part-2 table prints all 18 fallback drives, so the values every
//       C5 clause reads are on the record next to the row that reads them.
//     * the clause SET was run against the reverted design's sentence
//       (`the model provider answered with HTTP 404, ...`): "carries the
//       number" passes, and "no crafted sentence", "toast === catch-all" and
//       "carries the REMEDY" all fail. That is the proof the re-cut matters -
//       the number clause alone, which is what the first cut had, would have
//       let the HIGH through. Checked at row-logic level rather than by
//       mutating `src/`, which two other authors were editing at the time.
//
//   The pre-re-cut split, for the record:
//
//   RED   C1 [typed error] x4          - the throws are plain Errors today
//   RED   C1 [leaf]                    - there is no class to find
//   RED   C1 [pass placement] x3       - translateServiceReject returns
//                                        undefined for every status throw
//                                        (all four heads are PAYLOAD_CARRIERS)
//   RED   C4/C6 [arm x status] x24     - today's toast IS the catch-all, JSON
//                                        and all
//   RED   C4 [class agreement] x6, [groups differ] x3, [next action] x12
//   RED   C5 [fallback number] x9      - red on the crafted precondition
//   RED   C6 [body in channel not toast] x3
//   RED   C3 [status not body] x3, C3 [same text, different identity] x1
//   GREEN every row listed under REGRESSION above, plus P0 which asserts
//         nothing.
//
// FIVE ROWS WOULD PASS VACUOUSLY WITHOUT A PRECONDITION, and phase 6's oracle
// found four of its own rows green that way. Every ban-list and every
// difference row here asserts FIRST that a sentence was crafted at all:
//   * C5's "the sentence carries 418" - today's catch-all already carries 418,
//     because the raw message does
//   * C4's "four groups, four sentences" - today's four catch-alls already
//     differ, because the raw messages do
//   * C6's "no JSON" on a status with no crafted sentence - a toast that is the
//     catch-all is exactly the defect, so `crafted` must come first
//   * C3's "same status, different body, same sentence" - today the two differ,
//     so the row is red for the right reason and never green for the wrong one
//   * F5's forgery rows assert the forged error was really thrown and really
//     carries the forged tokens before banning anything
//
// ===========================================================================
// THE GREEN ROWS WERE MUTATION-CHECKED, NOT TRUSTED
// ===========================================================================
//
// A regression row written before the change is green on arrival, which is
// exactly the state in which a row that tests nothing looks identical to one
// that tests everything. Three mutations were applied to the product, run, and
// reverted:
//
//   * `Ollama ${status}` -> `Ollama HTTP ${status}` at both ollama throw sites:
//     18 C2 rows went red, and so did `C7 [pull toast]` - which is the row
//     catching the pull consumer moving, and the reason it is written as
//     "unchanged OR clean", not as a comment.
//   * `[http-body] ... server body` -> `... raw server body` in errorBound:
//     all four F7 rows went red.
//   * a text pass `if (/\b429\b/.test(text)) return <a sentence>` added to
//     `translateServiceReject`: all five F5 forgery rows went red, plus both
//     C8 rows and all four C3 rows. That mutation IS the defect falsifier 5
//     exists for, and every row that should have caught it did.
//
// Run: node --test test/blind-v58-p7-http-status-classes.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const cp = require("node:child_process");
const esbuild = require("esbuild");

const T0 = Date.now();

const ROOT = path.join(__dirname, "..");
const BASE_OLD_REF = "6861edd";
const BASE_P6_REF = "5190b7a";

// ---------------------------------------------------------------------------
// The vscode stub. `firstRun.ts` (C7) and `fnGen.ts` both import vscode; the
// stub is EXTERNAL to the bundles so this file and the product code share one
// module instance and one `__state`.
// ---------------------------------------------------------------------------

const STUB = path.join(__dirname, ".blind-v58-p7-stub.cjs");
fs.writeFileSync(
  STUB,
  `
const nodeFs = require("node:fs");
const state = {
  config: {}, messages: [], commands: {}, activeTextEditor: undefined,
  executeCalls: [], terminals: [], textDocuments: [],
  warnResponses: [], infoResponses: [], symbols: undefined, wroot: "/",
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
    onDidRenameFiles: () => ({ dispose() {} }),
    onDidDeleteFiles: () => ({ dispose() {} }),
    registerTextDocumentContentProvider: () => ({ dispose() {} }),
    get textDocuments() { return state.textDocuments; },
    get workspaceFolders() { return [{ uri: Uri.file(state.wroot), name: "w", index: 0 }]; },
    getWorkspaceFolder: () => ({ uri: Uri.file(state.wroot), name: "w", index: 0 }),
    openTextDocument: async () => state.activeTextEditor && state.activeTextEditor.document,
    applyEdit: async () => true,
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
    registerTreeDataProvider: () => ({ dispose() {} }),
    get visibleTextEditors() { return state.activeTextEditor ? [state.activeTextEditor] : []; },
    get activeTextEditor() { return state.activeTextEditor; },
    showTextDocument: async () => state.activeTextEditor,
    showInformationMessage: async (message, ...actions) => { state.messages.push({ kind: "info", message, actions }); return state.infoResponses.shift(); },
    showWarningMessage: async (message, ...actions) => { state.messages.push({ kind: "warn", message, actions }); return state.warnResponses.shift(); },
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
    onDidChangeVisibleTextEditors: () => ({ dispose() {} }),
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

const vs = require(STUB);

// ---------------------------------------------------------------------------
// The three trees.
// ---------------------------------------------------------------------------

const TMP_OLD = fs.mkdtempSync(path.join(os.tmpdir(), "blind-v58-p7-old-"));
const TMP_P6 = fs.mkdtempSync(path.join(os.tmpdir(), "blind-v58-p7-p6-"));
const artifacts = [STUB];

function bundle(tag, entrySource) {
  const entry = path.join(__dirname, `.blind-v58-p7-${tag}.entry.ts`);
  const outfile = path.join(__dirname, `.blind-v58-p7-${tag}.bundle.cjs`);
  artifacts.push(entry, outfile);
  fs.writeFileSync(entry, entrySource);
  esbuild.buildSync({
    entryPoints: [entry],
    bundle: true,
    outfile,
    format: "cjs",
    platform: "node",
    alias: { vscode: STUB },
    external: [STUB],
  });
  return require(outfile);
}

function extract(ref, dir) {
  cp.execSync(`git archive ${ref} src | tar -x -C ${JSON.stringify(dir)}`, {
    cwd: ROOT,
    shell: "/bin/bash",
    stdio: ["ignore", "ignore", "pipe"],
  });
}

/** The transports and the two toast builders, from one tree. `export *` on the
 *  leaf so a symbol phase 7 has not written yet is `undefined` in a guard row
 *  rather than a module-load failure. */
const ENTRY_FOR = (root) =>
  `export * from ${JSON.stringify(path.join(root, "src/core/errorBound"))};\n` +
  `export { generateInstruct, pullModel } from ${JSON.stringify(path.join(root, "src/core/ollama"))};\n` +
  `export { makeAnthropicInstruct } from ${JSON.stringify(path.join(root, "src/core/anthropicInstruct"))};\n` +
  `export { makeCloudInstruct } from ${JSON.stringify(path.join(root, "src/core/cloudInstruct"))};\n` +
  `export { offerModelPull } from ${JSON.stringify(path.join(root, "src/vscode/firstRun"))};\n`;

let NOW = {};
let BASE_OLD = {};
let BASE_P6 = {};
let oldErrorBoundSource = "";
let p6FnGenSource = "";
let setupErr;
try {
  extract(BASE_OLD_REF, TMP_OLD);
  extract(BASE_P6_REF, TMP_P6);
  oldErrorBoundSource = fs.readFileSync(path.join(TMP_OLD, "src/core/errorBound.ts"), "utf8");
  p6FnGenSource = fs.readFileSync(path.join(TMP_P6, "src/vscode/fnGen.ts"), "utf8");
  NOW = bundle(
    "now",
    `${ENTRY_FOR(ROOT)}` +
      `export { generationFailedToast, translateServiceReject } from "../src/vscode/fnGen";\n` +
      `export { DOWNLOAD_VOICE } from "../src/vscode/failureToast";\n` +
      `export { ClaudeCodeError } from "../src/core/claudeCodeInstruct";\n`,
  );
  BASE_OLD = bundle("old", ENTRY_FOR(TMP_OLD));
  BASE_P6 = bundle(
    "p6",
    `${ENTRY_FOR(TMP_P6)}` +
      `export { generationFailedToast, translateServiceReject } from ${JSON.stringify(
        path.join(TMP_P6, "src/vscode/fnGen"),
      )};\n`,
  );
} catch (e) {
  setupErr = e;
}

test.after(() => {
  for (const f of artifacts) fs.rmSync(f, { force: true });
  fs.rmSync(TMP_OLD, { recursive: true, force: true });
  fs.rmSync(TMP_P6, { recursive: true, force: true });
});

const btest = (name, fn) =>
  test(name, (ctx) => {
    if (setupErr) return ctx.skip("setup failed; see the G1 harness guard row");
    return fn(ctx);
  });

// ---------------------------------------------------------------------------
// Plumbing. One catch-all server per drive so no row has to know a path.
// ---------------------------------------------------------------------------

function serve(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({
        base: `http://127.0.0.1:${server.address().port}`,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

const plain = (status, body) => (_req, res) => {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(body);
};

const jsonStatus = (status, body) => (_req, res) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(body);
};

/** Headers promise a body, the socket dies before it arrives, `text()` rejects.
 *  Content-Length rather than a chunked cut: `res.destroy()` on a default
 *  chunked response makes undici reject with `TypeError: terminated`, which is a
 *  different failure from an unreadable body. */
const torn = (_req, res) => {
  res.writeHead(500, { "Content-Type": "text/plain", "Content-Length": "1000" });
  res.write("partial-");
  setTimeout(() => res.socket.destroy(), 10).unref();
};

const streamOf = (lines, contentType) => (_req, res) => {
  res.writeHead(200, { "Content-Type": contentType });
  for (const line of lines) res.write(line);
  res.end();
};

const ndjson = (obj) => `${JSON.stringify(obj)}\n`;
const sse = (obj) => `data: ${JSON.stringify(obj)}\n\n`;

const PARAMS = (base) => ({
  apiBase: base,
  model: "test-model",
  prompt: "write a function",
  maxTokens: 64,
  temperature: 0,
  signal: new AbortController().signal,
});

async function caught(fn) {
  try {
    return { ok: true, value: await fn() };
  } catch (err) {
    return { ok: false, err };
  }
}

// The four HTTP-status sites. `gen` marks the three that reach
// `generationFailedToast`; the pull site is C7's and reaches `firstRun.ts`.
const ARMS = [
  {
    name: "ollama-generate",
    who: /ollama/i,
    gen: true,
    drive: (M, base, log) => M.generateInstruct({ ...PARAMS(base), log }),
  },
  {
    name: "ollama-pull",
    who: /ollama/i,
    gen: false,
    drive: (M, base, log) =>
      M.pullModel(base, "test-model", new AbortController().signal, () => undefined, log),
  },
  {
    name: "anthropic",
    who: /anthropic/i,
    gen: true,
    drive: (M, base, log) => M.makeAnthropicInstruct({ baseUrl: base, apiKey: "k", log })(PARAMS(base)),
  },
  {
    name: "cloud",
    who: /cloud/i,
    gen: true,
    drive: (M, base, log) => M.makeCloudInstruct({ baseUrl: base, apiKey: "k", log })(PARAMS(base)),
  },
];
const GEN_ARMS = ARMS.filter((a) => a.gen);

const GESTURE = "function generation";
const toastOf = (err) => NOW.generationFailedToast(err, GESTURE);
/** What this exact message gets today with no typed identity on it. No sentence
 *  is ever written down in this file; this is the baseline every headline row
 *  compares against. */
const catchAllFor = (message) => NOW.generationFailedToast(new Error(message), GESTURE);
const short = (s) => (typeof s === "string" && s.length > 240 ? `${s.slice(0, 240)}... (${s.length} chars)` : s);
const show = (v) => JSON.stringify(short(v));

// ---------------------------------------------------------------------------
// Drives, memoised. Rows are independent assertions over shared observations;
// re-spinning a server per row would triple the file's wall clock for nothing.
// ---------------------------------------------------------------------------

const memo = new Map();
const once = (key, make) => {
  if (!memo.has(key)) memo.set(key, make());
  return memo.get(key);
};

/** Drive `mods` against ONE server, in order, and collect each one's throw and
 *  its channel lines. One server so a reason phrase, a socket tear and a body
 *  size are literally the same event for every tree. */
async function driveAll(arm, handler, mods) {
  const srv = await serve(handler);
  const out = [];
  try {
    for (const M of mods) {
      const lines = [];
      const r = await caught(() => arm.drive(M, srv.base, (l) => lines.push(String(l))));
      out.push({
        ok: r.ok,
        err: r.err,
        message: r.err instanceof Error ? r.err.message : r.ok ? undefined : String(r.err),
        lines,
      });
    }
  } finally {
    await srv.close();
  }
  return out;
}

/** NOW alone, decorated with everything a screen row needs. */
function driveNow(arm, tag, handler) {
  return once(`now|${arm.name}|${tag}`, async () => {
    const [r] = await driveAll(arm, handler, [NOW]);
    const err = r.err;
    return {
      arm: arm.name,
      tag,
      ok: r.ok,
      err,
      message: r.message,
      lines: r.lines,
      status: err && typeof err === "object" ? err.status : undefined,
      transport: err && typeof err === "object" ? err.transport : undefined,
      toast: r.ok ? undefined : toastOf(err),
      tsr: r.ok ? undefined : NOW.translateServiceReject(err),
      catchAll: r.ok ? undefined : catchAllFor(r.message),
    };
  });
}

/** NOW and a base tree, against the same server. */
function drivePair(arm, tag, handler, base) {
  return once(`pair|${base.tag}|${arm.name}|${tag}`, async () => {
    const [now, old] = await driveAll(arm, handler, [NOW, base.mod]);
    return { now, old };
  });
}

const OLD = { tag: "old", mod: BASE_OLD, ref: BASE_OLD_REF };
const P6 = { tag: "p6", mod: BASE_P6, ref: BASE_P6_REF };

// ---------------------------------------------------------------------------
// The bodies and the statuses.
// ---------------------------------------------------------------------------

/** A provider body that is hostile in the two ways that matter: it is JSON, and
 *  it names a status class of its own choosing. Used for every screen row, so
 *  C6 and falsifier 5 are tested by the same drives that test C4. */
const REQ_ID = "req_011CQxWn7TeAPOOL";
const HOSTILE = JSON.stringify({
  error: { type: "rate_limit_error", message: "you have exceeded your per-minute token quota", code: 429 },
  request_id: REQ_ID,
});
/** The same shape with a DIFFERENT class named inside it. C3's material: the
 *  status is 503, the body insists it is a 401. */
const LIAR_401 = JSON.stringify({
  error: { type: "authentication_error", message: "401 invalid x-api-key", code: 401 },
  request_id: REQ_ID,
});
const BENIGN = "upstream is unwell";

const JSON_TOKENS = ["{", "}", '":', "request_id", REQ_ID, "rate_limit_error"];

const CLASSES = {
  auth: [401, 403],
  rate: [429],
  // A RANGE, not an enumeration. The review's fix: the first cut listed
  // 500/502/503/529 and dropped 504 - the commonest after 503 - and
  // Cloudflare's 520-524 onto the fallback path.
  server: [500, 502, 503, 504, 520, 524, 529, 599],
};
const CLASSIFIED = [...CLASSES.auth, ...CLASSES.rate, ...CLASSES.server];

/**
 * THE FALLBACK STATUSES, AND WHY THEIR BODIES ARE REAL ONES.
 *
 * Re-cut after the phase-7 review's HIGH reversed the fallback ruling. The
 * first cut of this file assumed an unclassified status got a crafted sentence
 * carrying its number; driven at the branch point, that sentence DELETED the
 * provider's own remedy - an ollama 404 stopped saying `model "x" not found,
 * try pulling it first` and started saying "HTTP 404, see the channel".
 *
 * RULED: an unclassified status gets NO crafted sentence and falls through to
 * the catch-all, which is S20's ratified reasoning one layer out - no class
 * means no crafted sentence, because the provider's own message is the
 * actionable half. C5 is not dropped by that: the catch-all renders the number,
 * the remedy AND the channel pointer.
 *
 * So these bodies are the three the review measured, not this file's hostile
 * JSON: each carries a remedy the class table cannot state, and each row below
 * asserts that remedy is still on the screen. A future fallback sentence that
 * swallows the reason turns those rows red, which is the whole point of the
 * re-cut.
 *
 * [status, body, the remedy token that must survive to the toast]
 */
const FALLBACKS = [
  [404, '{"error":"model \\"test-model\\" not found, try pulling it first"}', "try pulling it first"],
  [
    400,
    '{"type":"error","error":{"type":"invalid_request_error","message":"prompt is too long: 250000 tokens > 200000 maximum"}}',
    "prompt is too long",
  ],
  [
    413,
    '{"error":{"code":"context_length_exceeded","message":"this model\'s maximum context length is 8192 tokens"}}',
    "context_length_exceeded",
  ],
  // The contract's own three examples, with a body that carries no remedy at
  // all. The number and the pointer are all there is to keep here.
  [418, HOSTILE, REQ_ID],
  [451, HOSTILE, REQ_ID],
  [300, HOSTILE, REQ_ID],
];
const FALLBACK_STATUSES = FALLBACKS.map(([s]) => s);
const ALL_STATUSES = [...CLASSIFIED, ...FALLBACK_STATUSES];

const hostile = (status) => driveNowFor(status, HOSTILE);
function driveNowFor(status, body) {
  return (arm) => driveNow(arm, `s${status}|${body.length}|${body.slice(0, 12)}`, jsonStatus(status, body));
}

/** Digit runs to `#`. The class-agreement and group-difference rows compare
 *  normalised sentences, so a build that carries the status number in every
 *  sentence is not failed for a choice the contract leaves open. */
const normal = (s) => String(s).replace(/\d+/g, "#");

const crafted = (d) => d.toast !== undefined && d.toast !== d.catchAll;

function requireCrafted(d, clause) {
  assert.ok(
    !d.ok,
    `${clause}: the arm must fail on a ${d.tag} - nothing was thrown, so there is no sentence to judge`,
  );
  assert.ok(
    crafted(d),
    `${clause}: PRECONDITION. No sentence was crafted for ${d.arm} ${d.status === undefined ? d.tag : d.status}: ` +
      `the toast is byte-identical to what this exact message gets today with no typed identity on it. ` +
      `Every ban and every difference below this line would pass vacuously.\n` +
      `  throw    : ${show(d.message)}\n` +
      `  toast    : ${show(d.toast)}\n` +
      `  catch-all: ${show(d.catchAll)}`,
  );
}

/** The channel pointer, taken out of the product rather than typed here. The
 *  catch-all is `Column 80: <gesture> failed - <detail>. <pointer>`, so a
 *  sentinel detail isolates the pointer whatever its wording is. */
const SENTINEL_DETAIL = "ZZ-DETAIL-ZZ";
const POINTER = String(catchAllFor(SENTINEL_DETAIL)).split(`${SENTINEL_DETAIL}. `)[1] || "";

// ===========================================================================
// G - HARNESS. Without these, a green run can mean the trees never built.
// ===========================================================================

test("G1 [harness]: three trees bundle headless and export the four sites", () => {
  if (setupErr) assert.fail(`setup failed: ${setupErr.stack || setupErr.message}`);
  for (const [label, M] of [
    ["now", NOW],
    [BASE_OLD_REF, BASE_OLD],
    [BASE_P6_REF, BASE_P6],
  ]) {
    for (const name of ["generateInstruct", "pullModel", "makeAnthropicInstruct", "makeCloudInstruct", "offerModelPull"]) {
      assert.strictEqual(typeof M[name], "function", `${label}: ${name} must be callable for this file to drive it`);
    }
  }
  assert.strictEqual(typeof NOW.generationFailedToast, "function");
  assert.strictEqual(typeof NOW.translateServiceReject, "function");
  assert.strictEqual(typeof BASE_P6.generationFailedToast, "function");
  assert.strictEqual(typeof NOW.ClaudeCodeError, "function", "falsifier 6 needs phase 6's class");
  assert.ok(
    POINTER.trim() !== "" && !POINTER.includes(SENTINEL_DETAIL),
    `harness: the channel pointer must be derivable from the catch-all, got ${show(POINTER)}. The pointer ` +
      "rows below are pinning the product's own wording, never one typed into this file",
  );
});

test(`G2 [harness]: the ${BASE_OLD_REF} tree really is the branch point, not a copy of now`, () => {
  if (setupErr) assert.fail(`setup failed: ${setupErr.stack || setupErr.message}`);
  assert.ok(
    !/channelBodyLine/.test(oldErrorBoundSource),
    `${BASE_OLD_REF} predates phase 1, so its errorBound.ts cannot know channelBodyLine. A base tree that ` +
      "is secretly the working copy makes every C2 row a tautology",
  );
  assert.strictEqual(
    typeof BASE_OLD.channelBodyLine,
    "undefined",
    "and the bundled base must not have it either",
  );
  assert.strictEqual(typeof NOW.channelBodyLine, "function", "while the current tree does");
});

test(`G3 [harness]: the ${BASE_P6_REF} tree carries phase 6 and phase 1`, () => {
  if (setupErr) assert.fail(`setup failed: ${setupErr.stack || setupErr.message}`);
  assert.ok(
    /ClaudeCodeError/.test(p6FnGenSource),
    `${BASE_P6_REF} is this session's HEAD as phase 7 begins, so phase 6's structural pass must be in it - ` +
      "C8 compares against it and would otherwise compare against nothing",
  );
  assert.strictEqual(typeof BASE_P6.channelBodyLine, "function", "and phase 1's channel line with it");
});

// ===========================================================================
// P0 - PROBE. Asserts nothing. Prints what every arm does at every status
// today, so a reader can see exactly which rows flipped.
// ===========================================================================

btest("P0 [probe]: every classified status, and every fallback with a real remedy in it", async () => {
  const line = (label, d) => {
    console.error("%s", label);
    console.error("  throw    : %s", show(d.message));
    console.error("  status fd: %s  transport fd: %s", String(d.status), String(d.transport));
    console.error("  toast    : %s", show(d.toast));
    console.error("  tsr      : %s", show(d.tsr));
    console.error("  == catch-all: %s", String(d.toast === d.catchAll));
  };
  console.error("\n=== P0 table, part 1: the classified statuses, hostile JSON body ===");
  for (const arm of GEN_ARMS) {
    for (const status of CLASSIFIED) line(`${arm.name} ${status}`, await hostile(status)(arm));
  }
  // Part 2 is the review's HIGH, on the record. Every one of these must be the
  // catch-all, with the provider's remedy still in it.
  console.error("\n=== P0 table, part 2: the unclassified statuses, real provider remedies ===");
  for (const arm of GEN_ARMS) {
    for (const fb of FALLBACKS) line(`${arm.name} ${fb[0]} (remedy: ${JSON.stringify(fb[2])})`, await fallbackDrive(arm, fb));
  }
  console.error("=== end P0 table ===\n");
});

// ===========================================================================
// C1 - A TYPED ERROR, IN A LEAF, CARRYING {transport, status}.
// ===========================================================================

for (const arm of ARMS) {
  btest(`C1 [typed error: ${arm.name}]: the throw carries the numeric status and the transport`, async () => {
    const d = await driveNow(arm, "c1-503", jsonStatus(503, HOSTILE));
    assert.ok(!d.ok && d.err instanceof Error, "the arm must throw an Error");
    assert.strictEqual(
      d.status,
      503,
      "C1: the status site must throw the typed error, carrying the numeric status. A plain Error carries " +
        "nothing the structural pass can switch on, which is the whole phase.\n" +
        `  throw: ${show(d.message)}\n` +
        `  err.status: ${String(d.status)} (typeof ${typeof d.status})`,
    );
    assert.ok(
      typeof d.transport === "string" && d.transport.trim() !== "",
      `C1: the typed error carries the transport too. Got ${show(d.transport)}`,
    );
    assert.ok(
      arm.who.test(d.transport),
      `C1: err.transport must name this transport (${arm.who}), got ${show(d.transport)}`,
    );
  });
}

btest("C1 [status is the server's]: the field is read off the response, not fixed", async () => {
  const a = await driveNow(ARMS[0], "c1-429", jsonStatus(429, HOSTILE));
  const b = await driveNow(ARMS[0], "c1-503", jsonStatus(503, HOSTILE));
  assert.strictEqual(a.status, 429, "C1: a 429 carries 429");
  assert.strictEqual(b.status, 503, "C1: a 503 carries 503");
});

btest("C1 [leaf]: the class is declared in src/core and imports no transport", async () => {
  const d = await driveNow(ARMS[0], "c1-503", jsonStatus(503, HOSTILE));
  const className = d.err && d.err.constructor ? d.err.constructor.name : "Error";
  assert.notStrictEqual(
    className,
    "Error",
    "C1: the status sites must throw a typed class, not a bare Error. Nothing to locate yet.",
  );
  const hits = [];
  for (const dir of [path.join(ROOT, "src", "core"), path.join(ROOT, "src", "vscode")]) {
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith(".ts")) continue;
      const full = path.join(dir, f);
      const text = fs.readFileSync(full, "utf8");
      if (new RegExp(`class\\s+${className}\\b`).test(text)) hits.push({ full, text });
    }
  }
  assert.strictEqual(hits.length, 1, `C1: expected exactly one declaration of ${className}, found ${hits.length}`);
  const { full, text } = hits[0];
  const rel = path.relative(ROOT, full);
  assert.ok(rel.startsWith("src/core/"), `C1: the class belongs in a leaf under src/core, found at ${rel}`);
  assert.ok(
    !/^src\/core\/(ollama|anthropicInstruct|cloudInstruct)\.ts$/.test(rel),
    `C1: the class cannot live in a transport - all three throw it, so ${rel} is a cycle waiting to happen`,
  );
  const imports = text.split("\n").filter((l) => /^\s*import\b/.test(l));
  for (const bad of ["./ollama", "./anthropicInstruct", "./cloudInstruct", "./claudeCodeInstruct", "vscode"]) {
    assert.ok(
      !imports.some((l) => l.includes(`"${bad}"`)),
      `C1: "check the direction before writing the file" - ${rel} imports ${bad}:\n  ${imports.join("\n  ")}`,
    );
  }
});

for (const arm of GEN_ARMS) {
  btest(`C1 [pass placement: ${arm.name}]: translateServiceReject returns the sentence, and it is toasted`, async () => {
    const d = await hostile(503)(arm);
    assert.ok(
      typeof d.tsr === "string" && d.tsr.trim() !== "",
      "C1/C3: the structural pass runs inside translateServiceReject, the same pass phase 6 added. A 503 " +
        `drew nothing.\n  throw: ${show(d.message)}\n  tsr  : ${show(d.tsr)}`,
    );
    assert.strictEqual(
      d.toast,
      d.tsr,
      "C1: the crafted sentence is what the gesture shows. If these differ, the pass is in the wrong place",
    );
  });
}

// ===========================================================================
// C2 - `String(err)` IS BYTE-IDENTICAL AT ALL FOUR SITES.
//
// Falsifier 2, proven the strong way: both trees driven against ONE server, no
// expectation derived from the product's own bound and no literal snapshotted.
// The body shapes are the contract's list.
// ===========================================================================

const SHAPES = [
  ["an empty body", plain(500, "")],
  ["a 200-char body", plain(500, "s".repeat(200))],
  ["a body exactly at the toast budget", plain(500, "q".repeat(400))],
  ["one char over the toast budget", plain(500, "o".repeat(401))],
  ["a 102400-char body", plain(500, "x".repeat(102400))],
  // 399 'a', one emoji (two code units), 50 'b': the pair straddles the cut.
  ["a surrogate pair straddling the cut", plain(500, `${"a".repeat(399)}\u{1F600}${"b".repeat(50)}`)],
  [
    "a 6000-char reason phrase",
    (_req, res) => {
      res.writeHead(500, "R".repeat(6000), { "Content-Type": "text/plain" });
      res.end("body");
    },
  ],
  ["an unreadable body", torn],
];

for (const arm of ARMS) {
  for (const [label, handler] of SHAPES) {
    btest(`C2 [${arm.name}]: REGRESSION - String(err) matches the ${BASE_OLD_REF} worktree, ${label}`, async () => {
      const { now, old } = await drivePair(arm, `shape:${label}`, handler, OLD);
      assert.ok(!now.ok && !old.ok, `both trees must throw on ${label}`);
      assert.strictEqual(
        now.message,
        old.message,
        `C2: the throw's MESSAGE moved. Every session-v57 blind row, every phase-1 blind row and ` +
          `fnGenService's channel copy are built out of this string. Proven against ${BASE_OLD_REF}, ` +
          `materialised and driven against the same socket.\n` +
          `  now : ${show(now.message)}\n` +
          `  ${BASE_OLD_REF}: ${show(old.message)}`,
      );
      assert.strictEqual(
        String(now.err),
        String(old.err),
        `C2: the message is byte-identical but String(err) is not, so the typed class set \`name\`. ` +
          `String(err) renders \`\${name}: \${message}\`, and it is the copy fnGenService writes to the ` +
          `channel as "[fngen] request failed: ...". The class must identify itself some other way - ` +
          `instanceof from the leaf, or a marker field - or C2 has to be relaxed on purpose.\n` +
          `  now : ${show(String(now.err))}\n` +
          `  ${BASE_OLD_REF}: ${show(String(old.err))}`,
      );
    });
  }

  btest(`C2 [${arm.name}]: REGRESSION - every status renders identically to ${BASE_OLD_REF}`, async () => {
    for (const status of ALL_STATUSES) {
      const { now, old } = await drivePair(arm, `sweep:${status}`, jsonStatus(status, HOSTILE), OLD);
      assert.ok(!now.ok && !old.ok, `both trees must throw on ${status}`);
      assert.strictEqual(
        now.message,
        old.message,
        `C2: status ${status} - "for every status, every reason phrase and every body size"`,
      );
      assert.strictEqual(String(now.err), String(old.err), `C2: status ${status} - String(err) moved`);
    }
  });
}

// ===========================================================================
// C3 - THE PASS SWITCHES ON `status`, NOT ON TEXT.
// ===========================================================================

for (const arm of GEN_ARMS) {
  btest(`C3 [${arm.name}]: a 503 whose body claims 401 is still told as a 503`, async () => {
    const liar = await driveNow(arm, "liar503", jsonStatus(503, LIAR_401));
    const plainOne = await driveNow(arm, "benign503", jsonStatus(503, BENIGN));
    const real401 = await hostile(401)(arm);
    requireCrafted(liar, "C3");
    requireCrafted(plainOne, "C3");
    requireCrafted(real401, "C3");
    assert.strictEqual(
      liar.toast,
      plainOne.toast,
      "C3: two 503s with different bodies are one event. If the body can move the sentence, a server " +
        `picks the sentence.\n  liar  : ${show(liar.toast)}\n  benign: ${show(plainOne.toast)}`,
    );
    assert.notStrictEqual(
      normal(liar.toast),
      normal(real401.toast),
      "C3: and a body saying 401 must NOT draw the 401 sentence off a 503",
    );
  });
}

btest("C3 [same text, different identity]: a real 429 and a plain Error of its text part company", async () => {
  const d = await hostile(429)(GEN_ARMS[0]);
  requireCrafted(d, "C3");
  const forged = NOW.generationFailedToast(new Error(d.message), GESTURE);
  assert.notStrictEqual(
    d.toast,
    forged,
    "C3: the pass reads a field the TRANSPORT set. A plain Error carrying the identical message is a " +
      "server's words with no status behind them, and it must keep getting today's catch-all",
  );
  assert.strictEqual(
    forged,
    d.catchAll,
    "C3: ...and that catch-all is unchanged - the forgery gets exactly what it gets today",
  );
});

// ===========================================================================
// C4 + C6 - EACH CLASS IS A SENTENCE, WITH A NEXT ACTION, AND NO JSON.
//
// Every drive here serves the hostile JSON body, so the same observation
// carries C4's "a sentence was crafted" and C6's "the body did not reach the
// screen". The precondition is C4's; the bans below it are C6's, and without
// the precondition they would pass loudest on a tree with no sentences at all.
//
// CLASSIFIED STATUSES ONLY. C6's "no JSON on screen" is a claim about a CLASS -
// "for every class, the provider's body does not reach the toast" - and after
// the review's HIGH an unclassified status has no class and keeps its body on
// purpose. The fallback statuses are pinned in the C5 group below, where the
// body reaching the screen is the assertion rather than the ban.
// ===========================================================================

for (const arm of GEN_ARMS) {
  for (const status of CLASSIFIED) {
    btest(`C4/C6 [${arm.name} ${status}]: one crafted line, house voice, no JSON`, async () => {
      const d = await hostile(status)(arm);
      requireCrafted(d, "C4");
      assert.ok(
        d.toast.startsWith("Column 80: "),
        `C4: item 66's one voice - every crafted sentence opens "Column 80: ". Got ${show(d.toast)}`,
      );
      assert.ok(!d.toast.includes("\n"), `C4: a toast is one line. Got ${show(d.toast)}`);
      for (const token of JSON_TOKENS) {
        assert.ok(
          !d.toast.includes(token),
          `C6: the provider's body must not reach the screen. Found ${JSON.stringify(token)} in ` +
            `${show(d.toast)}`,
        );
      }
      assert.ok(
        !d.toast.includes("Error:"),
        `C4: no internal jargon on screen either. Got ${show(d.toast)}`,
      );
    });
  }
}

for (const arm of GEN_ARMS) {
  btest(`C4 [${arm.name}]: 401 and 403 are one class`, async () => {
    const a = await hostile(401)(arm);
    const b = await hostile(403)(arm);
    requireCrafted(a, "C4");
    requireCrafted(b, "C4");
    assert.strictEqual(
      normal(a.toast),
      normal(b.toast),
      "C4: the table says CLASSES, not codes: a refused key is one problem with one next action. " +
        "(Compared with digit runs normalised, so a build that names the status in every sentence is " +
        `not failed for it.)\n  401: ${show(a.toast)}\n  403: ${show(b.toast)}`,
    );
  });

  btest(`C4 [${arm.name}]: the 5xx class is a RANGE, not a list of four`, async () => {
    const seen = [];
    for (const status of CLASSES.server) {
      const d = await hostile(status)(arm);
      requireCrafted(
        d,
        `C4: 5xx is a range (>= 500 && < 600). ${status} drew no sentence, which is the enumeration bug ` +
          "the review found: a list of four drops 504 - the commonest after 503 - and Cloudflare's " +
          "520-524 onto the fallback path. C4",
      );
      seen.push([status, d.toast]);
    }
    for (const [status, t] of seen.slice(1)) {
      assert.strictEqual(
        normal(t),
        normal(seen[0][1]),
        `C4: ${status} and ${seen[0][0]} are both "the provider is having trouble" and want the same next ` +
          `action.\n  ${seen[0][0]}: ${show(seen[0][1])}\n  ${status}: ${show(t)}`,
      );
    }
  });

  btest(`C4 [${arm.name}]: three classes and the fallback, four different outcomes`, async () => {
    const groups = {};
    for (const [name, list] of Object.entries(CLASSES)) {
      const d = await hostile(list[0])(arm);
      requireCrafted(d, "C4");
      groups[name] = normal(d.toast);
    }
    // The fallback is the fourth outcome and it is NOT a crafted sentence
    // (ruled after the review's HIGH). It still has to be distinguishable from
    // all three classes, and it is - by carrying the provider's own words.
    const fb = await fallbackDrive(arm, FALLBACKS[0]);
    requireFallthrough(fb, "C4");
    groups.fallback = normal(fb.toast);
    const names = Object.keys(groups);
    for (let i = 0; i < names.length; i++) {
      for (let j = i + 1; j < names.length; j++) {
        assert.notStrictEqual(
          groups[names[i]],
          groups[names[j]],
          `C4: ${names[i]} and ${names[j]} draw the same sentence once the status number is normalised ` +
            "away, so they are one sentence with a number in it and the classes are not distinct.\n" +
            `  ${names[i]}: ${show(groups[names[i]])}\n  ${names[j]}: ${show(groups[names[j]])}`,
        );
      }
    }
  });
}

const NEXT_ACTION = [
  ["auth", 401, /key|credential|token|auth|sign in|log in/i, "check the API key setting"],
  ["rate", 429, /wait|again|later|retry|shortly|moment|minute/i, "wait and run the gesture again"],
  ["server", 503, /again|later|shortly|retry|moment/i, "try again shortly"],
];

for (const arm of GEN_ARMS) {
  for (const [name, status, probe, want] of NEXT_ACTION) {
    btest(`C4 [next action: ${arm.name} ${name}]: the sentence says what to do, not only what happened`, async () => {
      const d = await hostile(status)(arm);
      requireCrafted(d, "C4");
      assert.ok(
        probe.test(d.toast),
        `C4: the ${name} class means "${want}" and the sentence must carry a next action. Probe ${probe} ` +
          `found nothing in ${show(d.toast)}`,
      );
    });
  }
}

// ---------------------------------------------------------------------------
// THE TWO CLASSES THAT CANNOT SAY EVERYTHING THEY KNOW keep the pointer.
// From the review: a 401 body separates an invalid key from an exhausted credit
// balance, and a 429 body separates a rate limit from a dead quota. The class
// sentence cannot state either difference; the channel can, so the sentence has
// to send the user there.
// ---------------------------------------------------------------------------

for (const arm of GEN_ARMS) {
  for (const status of [401, 403, 429]) {
    btest(`C4 [pointer: ${arm.name} ${status}]: the class sentence points at the channel`, async () => {
      const d = await hostile(status)(arm);
      requireCrafted(d, "C4");
      assert.ok(
        d.toast.includes(POINTER),
        `C4: a ${status} sentence names a class, and the body under it names the case - an invalid key ` +
          `against an exhausted balance, a rate limit against a dead quota. The pointer is what keeps that ` +
          `reachable.\n  want the product's own pointer: ${show(POINTER)}\n  got: ${show(d.toast)}`,
      );
    });
  }
}

// ---------------------------------------------------------------------------
// 401/403 SPLITS ON THE TRANSPORT. The product has ONE key setting,
// `column80.cloudApiKey`, and its own description says the local backend
// ignores it - so a single sentence sent an ollama user to a control that
// cannot help them. The local variant names no setting at all, deliberately.
// ---------------------------------------------------------------------------

for (const status of [401, 403]) {
  btest(`C4 [transport split: ${status}]: the local arm is not sent to a cloud key setting`, async () => {
    const local = await hostile(status)(ARMS[0]);
    const remotes = [await hostile(status)(ARMS[2]), await hostile(status)(ARMS[3])];
    requireCrafted(local, "C4");
    for (const r of remotes) requireCrafted(r, "C4");
    for (const r of remotes) {
      assert.notStrictEqual(
        normal(local.toast),
        normal(r.toast),
        `C4: the ${status} sentence splits on err.transport. The local backend has no key setting, so it ` +
          `cannot get the same sentence as ${r.arm}.\n  ollama: ${show(local.toast)}\n  ${r.arm}: ${show(r.toast)}`,
      );
      assert.ok(
        /column80\./.test(r.toast),
        `C4: the keyed transports name the setting the user has to fix: ${show(r.toast)}`,
      );
    }
    assert.ok(
      !/column80\.|setting/i.test(local.toast),
      `C4: and the local variant names NO setting, because there is none that helps it. Naming one is the ` +
        `S20 failure - a crafted sentence pointing at a remedy that does not exist: ${show(local.toast)}`,
    );
  });
}

// ===========================================================================
// C5 - AN UNCLASSIFIED STATUS. RE-CUT, and this is the group the review's HIGH
// reversed.
//
// The property is no longer "a crafted sentence carrying the number". It is:
// NO crafted sentence, and the catch-all carries THREE things - the status
// number, the provider's own remedy, and the channel pointer. The middle one is
// what the first cut of this phase deleted, and it is the clause that turns
// this file red if a fallback sentence ever comes back.
// ===========================================================================

function fallbackDrive(arm, [status, body]) {
  return driveNow(arm, `fallback${status}`, jsonStatus(status, body));
}

function requireFallthrough(d, clause) {
  assert.ok(!d.ok, `${clause}: the arm must fail on an unclassified status`);
  assert.strictEqual(
    d.tsr,
    undefined,
    `${clause}: RULED - an unclassified status gets NO crafted sentence. S20's reasoning one layer out: ` +
      `no class means no crafted sentence, because the provider's own message is the actionable half. ` +
      `translateServiceReject returned ${show(d.tsr)}`,
  );
  assert.strictEqual(
    d.toast,
    d.catchAll,
    `${clause}: ...so the toast is exactly the catch-all for this message.\n` +
      `  toast    : ${show(d.toast)}\n  catch-all: ${show(d.catchAll)}`,
  );
}

for (const arm of GEN_ARMS) {
  for (const fb of FALLBACKS) {
    const [status, , remedy] = fb;
    btest(`C5 [${arm.name} ${status}]: no class, so the number, the remedy and the pointer all survive`, async () => {
      const d = await fallbackDrive(arm, fb);
      // PRECONDITION. Without it the three assertions below are claims about a
      // remedy the throw never carried.
      assert.ok(
        d.message.includes(remedy),
        `harness: the provider's remedy must reach the throw before it can reach the screen. ` +
          `${JSON.stringify(remedy)} is absent from ${show(d.message)}`,
      );
      requireFallthrough(d, "C5");
      assert.ok(
        new RegExp(`\\b${status}\\b`).test(d.toast),
        `C5: "a number a user can search for is worth more than a sentence that hides it". ` +
          `${status} is absent from ${show(d.toast)}`,
      );
      assert.ok(
        d.toast.includes(remedy),
        `C5/HIGH: THE PROVIDER'S REMEDY IS THE NEXT ACTION at an unclassified status, and a crafted ` +
          `sentence has nothing to put in its place. This is the defect the phase-7 review caught: an ` +
          `ollama 404 stopped saying "try pulling it first" and started saying "HTTP 404, see the ` +
          `channel". ${JSON.stringify(remedy)} must be on screen.\n  toast: ${show(d.toast)}`,
      );
      assert.ok(
        d.toast.includes(POINTER),
        `C5: and the pointer, because the body on screen is bounded and the channel's is not: ${show(d.toast)}`,
      );
      assert.ok(!d.toast.includes("\n"), `C5: still one line: ${show(d.toast)}`);
      // The screen's copy is bounded; the channel's is not. Both surfaces keep
      // the provider's answer at an unclassified status, which is the whole
      // reason the fallback can afford to have no sentence of its own.
      const raw = d.lines.filter((l) => l.startsWith("[http-body]"));
      assert.strictEqual(raw.length, 1, `C6: phase 1's raw line is still written at ${status}`);
      assert.ok(raw[0].includes(remedy), `C6: and it carries the provider's whole answer: ${show(raw[0])}`);
    });
  }
}

// ===========================================================================
// C6 - THE BODY IS IN THE CHANNEL, TWICE, AND ON SCREEN NEVER.
// ===========================================================================

for (const arm of GEN_ARMS) {
  btest(`C6 [${arm.name}]: the hostile body is on the channel while the toast is clean`, async () => {
    const d = await hostile(503)(arm);
    const http1 = d.lines.filter((l) => l.startsWith("[http-body]"));
    assert.strictEqual(
      http1.length,
      1,
      `C6: phase 1's raw line must still be there - it is half of "the full message is in the output ` +
        `channel". Lines: ${JSON.stringify(d.lines.map((l) => l.slice(0, 100)))}`,
    );
    assert.ok(http1[0].includes(REQ_ID), "C6: and it carries the provider's own body, request id and all");
    requireCrafted(d, "C6");
    assert.ok(!d.toast.includes(REQ_ID), `C6: while the screen has none of it: ${show(d.toast)}`);
  });
}

// ===========================================================================
// C7 - THE PULL PATH. The second consumer, and the one that does not call
// generationFailedToast. Either outcome is a valid build; an unnoticed change
// is not.
// ===========================================================================

async function drivePull(M, status, body) {
  vs.__state.messages.length = 0;
  vs.__state.infoResponses.length = 0;
  vs.__state.infoResponses.push("Download");
  const lines = [];
  const output = { appendLine: (l) => lines.push(String(l)) };
  const srv = await serve(jsonStatus(status, body));
  let landed;
  try {
    landed = await M.offerModelPull(srv.base, "test-model", output, "the model is missing");
  } finally {
    await srv.close();
  }
  const warns = vs.__state.messages.filter((m) => m.kind === "warn").map((m) => m.message);
  vs.__state.messages.length = 0;
  return { landed, lines, warns };
}

// RE-CUT, session-v59 phase 1. This row was written with TWO acceptable
// outcomes because phase 7's contract deliberately did not decide whether the
// pull would gain class sentences: it pinned "unchanged from the baseline, OR a
// clean one-line house-voice sentence with no JSON", so that whichever way the
// build went, an UNNOTICED move would still be caught.
//
// Phase 1 of session-v59 decided it. The download surface draws the class
// sentence, and the row that accepts either answer can no longer catch a revert
// to the baseline's raw JSON - the disjunction would swallow it. So the row now
// pins the one outcome that shipped. The old wording is above; what it was
// guarding against is unchanged.
btest("C7 [pull toast]: the download toast IS the class sentence, not the baseline's raw JSON", async () => {
  const now = await drivePull(NOW, 503, HOSTILE);
  const before = await drivePull(BASE_P6, 503, HOSTILE);
  assert.strictEqual(now.landed, false, "the pull must report failure");
  assert.strictEqual(now.warns.length, 1, `firstRun.ts must still show exactly one toast, got ${now.warns.length}`);
  assert.strictEqual(before.warns.length, 1, `harness: ${BASE_P6_REF} must show one too, got ${before.warns.length}`);
  const t = now.warns[0];
  console.error(
    "\nC7 [pull toast]\n  now : %s\n  %s: %s\n",
    show(t),
    BASE_P6_REF,
    show(before.warns[0]),
  );
  // The generate arm's own answer for the same status, asked of the translator
  // directly. A literal here would be a second copy of the sentence to keep in
  // step, which is the failure item 66 closed.
  const generated = NOW.translateServiceReject(new NOW.HttpStatusError("ollama", 503, "Ollama 503 x"));
  assert.notStrictEqual(generated, undefined, "PRECONDITION: 503 is a classified status");
  // RE-CUT ON THE NARROWED CONTRACT (`docs/supersessions.md` S31). This row used
  // to demand the two surfaces render one string. They still speak with one
  // voice about WHAT HAPPENED - the diagnosis half is byte-identical - but the
  // rest of the sentence is about the gesture, and there is no gesture behind a
  // Download click. "So nothing was written - run the gesture again" named a
  // control this surface does not have.
  const want = NOW.translateServiceReject(
    new NOW.HttpStatusError("ollama", 503, "Ollama 503 x"),
    NOW.DOWNLOAD_VOICE,
  );
  assert.strictEqual(
    t,
    want,
    `C7: the pull's throw is byte-identical to the generate site's, so the two surfaces must speak with ` +
      `one voice.\n  now : ${show(t)}\n  want: ${show(want)}`,
  );
  const diagnosis = generated.split(",")[0];
  assert.ok(
    t.startsWith(diagnosis),
    `C7: and the half that says what the server did is the generate arm's, word for word.\n` +
      `  now      : ${show(t)}\n  diagnosis: ${show(diagnosis)}`,
  );
  assert.notStrictEqual(t, before.warns[0], `C7: and it is no longer ${BASE_P6_REF}'s wording`);
  assert.ok(!t.includes("\n") && !JSON_TOKENS.some((x) => t.includes(x)), `C7: one line, no JSON: ${show(t)}`);
});

btest("C7 [pull channel]: REGRESSION - the pull's own channel lines survive", async () => {
  const now = await drivePull(NOW, 503, HOSTILE);
  assert.ok(
    now.lines.some((l) => l.startsWith("[carve] pull ratified")),
    `C7: the trust contract's ratify line: ${JSON.stringify(now.lines.map((l) => l.slice(0, 80)))}`,
  );
  assert.ok(
    now.lines.some((l) => l.startsWith("[carve] pull failed")),
    "C7: a failed pull is logged as failed",
  );
  assert.ok(
    !now.lines.some((l) => l.startsWith("[carve] pull cancelled")),
    "C7: and never mistaken for a cancellation - firstRun's isAbort tests String(err), so a typed error " +
      "whose name or message carries the word would silently become a cancel",
  );
  const raw = now.lines.filter((l) => l.startsWith("[http-body]"));
  assert.strictEqual(raw.length, 1, "C7: phase 1's raw line is written on the pull path too");
  assert.ok(raw[0].includes(REQ_ID), "C7: carrying the provider's whole body");
});

// ===========================================================================
// FALSIFIER 5 - FORGERY. The pass switches on a number the TRANSPORT set.
// ===========================================================================

const FORGED_TEXT = "429 Service Unavailable - slow down";

const FORGERIES = [
  {
    name: "ollama-generate",
    arm: ARMS[0],
    handler: streamOf([ndjson({ error: FORGED_TEXT })], "application/x-ndjson"),
  },
  {
    name: "anthropic",
    arm: ARMS[2],
    handler: streamOf([sse({ type: "error", error: { message: FORGED_TEXT } })], "text/event-stream"),
  },
  {
    name: "cloud",
    arm: ARMS[3],
    handler: streamOf([sse({ error: { message: FORGED_TEXT } })], "text/event-stream"),
  },
];

for (const f of FORGERIES) {
  btest(`F5 [forgery: ${f.name}]: REGRESSION - a 200 body saying 429 draws no class sentence`, async () => {
    const d = await driveNow(f.arm, "forge200", f.handler);
    // PRECONDITION. Without it this row bans a sentence in a run where nothing
    // was thrown at all.
    assert.ok(!d.ok, "the forged in-stream error must still be thrown");
    assert.ok(
      d.message.includes("429") && d.message.includes("Service Unavailable"),
      `harness: the forged tokens must survive into the message, or there is nothing to forge with. ` +
        `Got ${show(d.message)}`,
    );
    assert.strictEqual(
      d.status,
      undefined,
      "F5: the transport set no status, because the transport saw a 200. A typed status here means the " +
        "class is being built from text",
    );
    assert.strictEqual(
      d.tsr,
      undefined,
      `F5: this message's head is a PAYLOAD_CARRIERS entry and it must keep falling through. ` +
        `Got ${show(d.tsr)}`,
    );
    assert.strictEqual(
      d.toast,
      d.catchAll,
      "F5: so the user reads exactly what this message gets today. A class sentence here is the server " +
        "choosing its own diagnosis",
    );
  });
}

btest("F5 [forgery: plain Error]: REGRESSION - a hand-built copy of a real 503 throw draws nothing", async () => {
  const d = await hostile(503)(GEN_ARMS[0]);
  const fake = new Error(d.message);
  assert.strictEqual(
    NOW.translateServiceReject(fake),
    undefined,
    "F5: identity, never text. A plain Error carrying the identical string has no status behind it",
  );
  assert.strictEqual(
    NOW.generationFailedToast(fake, GESTURE),
    BASE_P6.generationFailedToast(fake, GESTURE),
    `F5: and it renders exactly as it did at ${BASE_P6_REF}`,
  );
});

btest("F5 [forgery: a status field on a plain Error]: REGRESSION - the field alone is not the identity", async () => {
  const fake = new Error("Ollama 429 Too Many Requests: {\"error\":\"nope\"}");
  fake.status = 429;
  fake.transport = "ollama";
  const got = NOW.generationFailedToast(fake, GESTURE);
  assert.strictEqual(
    got,
    BASE_P6.generationFailedToast(new Error(fake.message), GESTURE),
    "F5: phase 6 settled this shape for ClaudeCodeError - a plain object wearing the right fields is not " +
      "the class. `err instanceof <the leaf's class>` is the test; a duck-typed `typeof err.status === " +
      `"number"` + " is forgeable by anything that reaches the catch, including a JSON parse failure " +
      `carrying its own fields.\n  got: ${show(got)}`,
  );
});

// ===========================================================================
// FALSIFIER 6 - THE TWO CASES DO NOT INTERFERE.
// ===========================================================================

btest("F6 [phase 6 still fires]: REGRESSION - a ClaudeCodeError keeps its own sentence", async () => {
  const cce = new NOW.ClaudeCodeError("serving-failure", "Claude Code upstream status 429.");
  const got = NOW.translateServiceReject(cce);
  assert.ok(typeof got === "string" && got.trim() !== "", "phase 6's pass must still return a sentence");
  assert.strictEqual(
    got,
    BASE_P6.translateServiceReject(cce),
    `F6: byte-identical to ${BASE_P6_REF}. Phase 7 adds a case; it does not touch phase 6's`,
  );
});

btest("F6 [neither pass swallows the other]: a 429 throw and a ClaudeCodeError saying 429", async () => {
  const cce = new NOW.ClaudeCodeError("serving-failure", "Claude Code upstream status 429.");
  const cceToast = NOW.generationFailedToast(cce, GESTURE);
  const d = await hostile(429)(GEN_ARMS[0]);
  requireCrafted(d, "F6");
  assert.notStrictEqual(
    d.err.name,
    "ClaudeCodeError",
    "F6: the HTTP class must not wear phase 6's identity, or phase 6's map decides HTTP failures",
  );
  assert.notStrictEqual(
    d.toast,
    cceToast,
    "F6: a Claude Code rate limit and an Ollama 429 are two different backends and two different next " +
      `actions.\n  http 429: ${show(d.toast)}\n  cce     : ${show(cceToast)}`,
  );
  assert.strictEqual(
    cceToast,
    BASE_P6.generationFailedToast(cce, GESTURE),
    "F6: and phase 6's side of it did not move",
  );
});

btest("F6 [a ClaudeCodeError with a status field]: phase 6 wins, because it runs first", async () => {
  const cce = new NOW.ClaudeCodeError("timeout", "Claude Code did not answer in 60000ms.");
  cce.status = 503;
  assert.strictEqual(
    NOW.generationFailedToast(cce, GESTURE),
    BASE_P6.generationFailedToast(new NOW.ClaudeCodeError("timeout", cce.message), GESTURE),
    "F6: phase 6's case is placed first and stays first. A ClaudeCodeError that happens to carry a status " +
      "must not be re-diagnosed as an HTTP failure",
  );
});

// ===========================================================================
// FALSIFIER 7 - PHASE 1'S `[http-body]` LINE IS UNCHANGED ON EVERY STATUS.
// ===========================================================================

for (const arm of ARMS) {
  btest(`F7 [${arm.name}]: REGRESSION - the [http-body] line matches ${BASE_P6_REF} on every status`, async () => {
    for (const status of ALL_STATUSES) {
      const { now, old } = await drivePair(arm, `f7:${status}`, jsonStatus(status, HOSTILE), P6);
      const a = now.lines.filter((l) => l.startsWith("[http-body]"));
      const b = old.lines.filter((l) => l.startsWith("[http-body]"));
      assert.ok(a.length >= 1, `harness: no [http-body] line at ${status} on ${arm.name}`);
      assert.deepStrictEqual(
        a,
        b,
        `F7: the channel is the surface this whole session is buying. Status ${status} moved it:\n` +
          `  now : ${JSON.stringify(a.map((l) => l.slice(0, 160)))}\n` +
          `  ${BASE_P6_REF}: ${JSON.stringify(b.map((l) => l.slice(0, 160)))}`,
      );
    }
  });
}

// ===========================================================================
// C8 - PHASE 6 AND THE WHOLE TRANSLATION SURFACE ARE UNDAMAGED.
// Falsifier 4's surface half: 24 message shapes and ten reasons, compared
// tree-against-tree so no sentence is written down here either.
// ===========================================================================

const CCE_REASONS = [
  "logged-out",
  "binary-missing",
  "bad-cwd",
  "spawn-failed",
  "serving-failure",
  "timeout",
  "exit",
  "cli-error",
  "bad-json",
  "agentic",
  "no-session",
  "not-a-reason-at-all",
];

btest(`C8 [phase 6 corpus]: REGRESSION - all twelve reasons render as they did at ${BASE_P6_REF}`, () => {
  const diffs = [];
  let live = 0;
  for (const reason of CCE_REASONS) {
    const message = `Claude Code failed (${reason}): 429 Service Unavailable`;
    const err = new NOW.ClaudeCodeError(reason, message);
    const a = NOW.generationFailedToast(err, GESTURE);
    const b = BASE_P6.generationFailedToast(err, GESTURE);
    if (a !== b) diffs.push({ reason, now: short(a), was: short(b) });
    if (b !== BASE_P6.generationFailedToast(new Error(message), GESTURE)) live++;
  }
  // LIVENESS. The comparison is against frozen code, so it cannot go vacuous on
  // its own - but a later edit that guts this corpus would leave a green row
  // comparing nothing. Ten of the twelve reasons draw a crafted sentence at
  // BASE_P6; the other two are the documented fall-throughs.
  assert.ok(live >= 10, `harness: only ${live} of ${CCE_REASONS.length} reasons draw a sentence at ${BASE_P6_REF}`);
  assert.deepStrictEqual(diffs, [], "C8: phase 6's ten sentences and its two fall-throughs are untouched");
});

const SURFACE = [
  "",
  "generation truncated at num_predict",
  "generation was empty after postprocess",
  "generation contains a code-fence line",
  "generation does not contain the requested function",
  "does not contain a test module",
  "test functions (no fenced block",
  "Ollama stream cut: silent for 20000ms after 12 chars (http://x)",
  "Ollama: response has no body",
  "Ollama: the stream ended before its done frame, so the reply is incomplete",
  "Anthropic: the stream ended before message_stop, so the reply is incomplete",
  "Anthropic: response has no body",
  "Cloud: response has no body",
  "Cloud: the stream ended before any terminal signal, so the reply is incomplete",
  `Ollama error: ${FORGED_TEXT}`,
  `Anthropic reported an error mid-reply: ${FORGED_TEXT}`,
  `Cloud reported an error mid-reply: ${FORGED_TEXT}`,
  "Ollama 500 Internal Server Error: generation was empty after postprocess",
  "Anthropic 429 Too Many Requests: generation truncated at num_predict",
  `Cloud 503 Service Unavailable: ${HOSTILE}`,
  "something nobody has a row for",
  "a multi-line failure\nwith a second line the toast must drop",
  "a detail that ends in a period.",
  "x".repeat(3000),
];

btest(`C8 [translation surface]: REGRESSION - 24 message shapes render as they did at ${BASE_P6_REF}`, () => {
  const diffs = [];
  for (const message of SURFACE) {
    const err = new Error(message);
    const a = NOW.generationFailedToast(err, GESTURE);
    const b = BASE_P6.generationFailedToast(err, GESTURE);
    if (a !== b) diffs.push({ message: short(message), now: short(a), was: short(b) });
    const ta = NOW.translateServiceReject(err);
    const tb = BASE_P6.translateServiceReject(err);
    if (ta !== tb) diffs.push({ message: short(message), tsrNow: short(ta), tsrWas: short(tb) });
  }
  for (const odd of [undefined, null, 42, "a bare string reject", { message: "an object, not an Error" }]) {
    const a = NOW.generationFailedToast(odd, GESTURE);
    const b = BASE_P6.generationFailedToast(odd, GESTURE);
    if (a !== b) diffs.push({ reject: String(odd), now: short(a), was: short(b) });
  }
  // LIVENESS, as above: at BASE_P6 this corpus draws crafted sentences for the
  // service-reject rows and falls through for the payload carriers. If a later
  // edit leaves it drawing nothing, the row is comparing two empty surfaces.
  const live = SURFACE.filter((m) => BASE_P6.translateServiceReject(new Error(m)) !== undefined).length;
  assert.ok(live >= 8, `harness: only ${live} of ${SURFACE.length} shapes draw a sentence at ${BASE_P6_REF}`);
  assert.deepStrictEqual(
    diffs,
    [],
    "C8: falsifier 4. Phase 7 only ever narrows: nothing that is not a typed HTTP error may reach a " +
      "different sentence than it does today, including the shapes that merely LOOK like status throws",
  );
});

// ===========================================================================
// THE HAPPY PATH. A pass that fires on success is worse than no pass.
// ===========================================================================

const HAPPY = [
  {
    name: "ollama-generate",
    arm: ARMS[0],
    handler: streamOf(
      [ndjson({ response: "fn ok" }), ndjson({ done: true, done_reason: "stop" })],
      "application/x-ndjson",
    ),
  },
  {
    name: "cloud",
    arm: ARMS[3],
    handler: streamOf(
      [
        sse({ choices: [{ delta: { content: "fn ok" } }] }),
        sse({ choices: [{ delta: {}, finish_reason: "stop" }] }),
        "data: [DONE]\n\n",
      ],
      "text/event-stream",
    ),
  },
];

for (const h of HAPPY) {
  btest(`happy path [${h.name}]: REGRESSION - a 200 still succeeds and logs no [http-body]`, async () => {
    const d = await driveNow(h.arm, "happy", h.handler);
    assert.ok(d.ok, `the arm must succeed: ${show(d.message)}`);
    assert.strictEqual(
      d.lines.filter((l) => l.startsWith("[http-body]")).length,
      0,
      "a diagnostic that fires on every 200 is a worse channel than no diagnostic",
    );
  });
}

test.after(() => {
  console.error("\nblind-v58-p7 duration_ms=%d\n", Date.now() - T0);
});
