// A structural `vscode` module for headless tests of src/vscode/**.
//
// Real Position/Range/Uri, so Range.contains and the span math run honestly
// rather than against a mock that agrees with whatever the code does. The
// provider commands answer from globals the test sets, keyed by uri string:
//
//   globalThis.__C80_SYMBOLS__   { [uri]: DocumentSymbol[] }        documentSymbolProvider
//   globalThis.__C80_CHAINS__    { [uri]: (positions) => chains }   selectionRangeProvider
//   globalThis.__C80_DOCS__      { [uri]: document }                openTextDocument
//   globalThis.__C80_OPEN_DOCS__ document[]                         workspace.textDocuments
//   globalThis.__C80_ACTIVE__    editor | undefined                 window.activeTextEditor
//   globalThis.__C80_WARNINGS__  string[]                           showWarningMessage sink
//
// Dot-prefixed so `node --test` does not treat this file as a test. It exports
// the stub SOURCE, which the caller writes to disk and aliases `vscode` to at
// bundle time; esbuild cannot alias a module to an in-memory object.
//
// Adapted from the per-file stubs in test/blind-v10-gestures and
// test/blind-v12-admit-*; those predate this file and are left alone.

const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");

const STUB_SOURCE = String.raw`
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
  contains(p) {
    const ps = p.start ? p.start : p;
    const pe = p.end ? p.end : p;
    const geS = ps.line > this.start.line || (ps.line === this.start.line && ps.character >= this.start.character);
    const leE = pe.line < this.end.line || (pe.line === this.end.line && pe.character <= this.end.character);
    return geS && leE;
  }
  with(start, end) { return new Range(start || this.start, end || this.end); }
}
class Selection extends Range {
  constructor(a, b, c, d) {
    super(a, b, c, d);
    this.anchor = this.start;
    this.active = typeof a === "number" ? new Position(c, d) : b;
  }
}
class SelectionRange {
  constructor(range, parent) { this.range = range; this.parent = parent; }
}
// A CLASS, not a factory returning plain objects. Real vscode.Uri is a class,
// and product code is entitled to say arg instanceof vscode.Uri — which is
// exactly how the add-a-file gesture tells a tree click from junk. A stub that
// hands back object literals makes that check untestable, and the first thing
// it does is throw "Right-hand side of 'instanceof' is not callable".
class Uri {
  constructor(full, fsPath) {
    this.scheme = full.includes("://") ? full.slice(0, full.indexOf("://")) : "file";
    this.fsPath = fsPath;
    this.path = fsPath;
    this.query = "";
    this.fragment = "";
    this._full = full;
  }
  toString() { return this._full; }
  with() { return this; }
  toJSON() { return this._full; }
  static file(p) { return new Uri("file://" + p, p); }
  static parse(s) { return new Uri(String(s), String(s).replace(/^[a-zA-Z+-]+:\/\//, "")); }
  static joinPath(base, ...segs) { return Uri.file([base.fsPath, ...segs].join("/")); }
}
const disposable = () => ({ dispose() {} });
// A code fence, spelled without the character itself: STUB_SOURCE is a
// String.raw template and a literal backtick would close it.
const FENCE = "\n" + String.fromCharCode(96, 96, 96);
class MarkdownString { constructor(v) { this.value = v || ""; } appendCodeblock(t, l) { this.value += FENCE + (l || "") + "\n" + t + FENCE + "\n"; } appendMarkdown(t) { this.value += t; } appendText(t) { this.value += t; } }
class ThemeColor { constructor(id) { this.id = id; } }
class ThemeIcon { constructor(id, color) { this.id = id; this.color = color; } }
class TreeItem { constructor(label, collapsibleState) { this.label = label; this.collapsibleState = collapsibleState; } }
class Diagnostic { constructor(range, message, severity) { this.range = range; this.message = message; this.severity = severity; } }
class EventEmitter { constructor() { this.h = []; } get event() { return (fn) => { this.h.push(fn); return disposable(); }; } fire(x) { for (const f of this.h) f(x); } dispose() {} }
module.exports = {
  Position, Range, Selection, SelectionRange, Uri, MarkdownString, ThemeColor, ThemeIcon, TreeItem, Diagnostic, EventEmitter,
  DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  SymbolKind: { File: 0, Module: 1, Namespace: 2, Package: 3, Class: 4, Method: 5, Property: 6,
    Field: 7, Constructor: 8, Enum: 9, Interface: 10, Function: 11, Variable: 12, Constant: 13,
    String: 14, Number: 15, Boolean: 16, Array: 17, Object: 18, Key: 19, Null: 20, EnumMember: 21,
    Struct: 22, Event: 23, Operator: 24, TypeParameter: 25 },
  CompletionItemKind: { Method: 1, Function: 2, Field: 4, Variable: 5, Class: 6, Property: 9, Enum: 12, Constant: 20, Struct: 21 },
  OverviewRulerLane: { Left: 1, Center: 2, Right: 4, Full: 7 },
  TextEditorRevealType: { Default: 0, InCenter: 1, InCenterIfOutsideViewport: 2, AtTop: 3 },
  workspace: {
    getConfiguration: () => ({ get: (k, f) => f, has: () => false, inspect: () => undefined, update: async () => {} }),
    onDidChangeConfiguration: () => disposable(),
    onDidChangeTextDocument: (fn) => { (globalThis.__C80_ON_CHANGE__ = globalThis.__C80_ON_CHANGE__ || []).push(fn); return disposable(); },
    onDidOpenTextDocument: () => disposable(),
    onDidCloseTextDocument: () => disposable(),
    // The file itself can move or die (session-v33): the panel follows a block's
    // uri across a rename and loses it on a delete. Registration alone is what
    // the harness needs; the handlers are driven directly where a test wants them.
    onDidRenameFiles: () => disposable(),
    onDidDeleteFiles: () => disposable(),
    get textDocuments() { return globalThis.__C80_OPEN_DOCS__ || []; },
    // The workspace itself. __C80_WS_ROOT__ is the one folder; UNSET MEANS NO
    // WORKSPACE, and a product that filters to the workspace then filters
    // everything out. That is the safe default for a stub: a leg that needs a
    // workspace has to say so, rather than inheriting one by accident.
    // No backticks anywhere below: STUB_SOURCE is a String.raw template and one
    // would close it.
    get workspaceFolders() {
      const root = globalThis.__C80_WS_ROOT__;
      return root ? [{ uri: Uri.file(root), name: "stub", index: 0 }] : undefined;
    },
    getWorkspaceFolder: (uri) => {
      const root = globalThis.__C80_WS_ROOT__;
      const p = uri && uri.fsPath ? String(uri.fsPath) : "";
      return root && p.startsWith(root) ? { uri: Uri.file(root), name: "stub", index: 0 } : undefined;
    },
    asRelativePath: (uri, includeWorkspaceFolder) => {
      const root = globalThis.__C80_WS_ROOT__;
      const p = uri && uri.fsPath ? String(uri.fsPath) : String(uri);
      if (!root || !p.startsWith(root)) return p;
      const rel = p.slice(root.length).replace(/^[\\/]+/, "");
      return includeWorkspaceFolder ? "stub/" + rel : rel;
    },
    openTextDocument: async (arg) => {
      const key = typeof arg === "string" ? arg : arg && arg.toString ? arg.toString() : String(arg);
      const docs = globalThis.__C80_DOCS__ || {};
      if (docs[key]) return docs[key];
      throw new Error("cannot open " + key);
    },
  },
  languages: {
    createDiagnosticCollection: (name) => ({ name, set() {}, delete() {}, clear() {}, dispose() {} }),
    // INJECTABLE, like every other surface in this stub. The model-authored
    // review hands the developer's OWN diagnostics to the model, so a test that
    // cannot put one there cannot exercise the leg that carries them.
    getDiagnostics: (uri) => {
      const all = globalThis.__C80_DIAGNOSTICS__;
      if (all === undefined) return [];
      if (Array.isArray(all)) return all;
      const key = uri === undefined ? "" : String(uri.fsPath || uri);
      return all[key] || [];
    },
    onDidChangeDiagnostics: () => disposable(),
  },
  window: {
    createOutputChannel: (name) => ({ name, appendLine() {}, append() {}, replace() {}, show() {}, hide() {}, clear() {}, dispose() {} }),
    createTextEditorDecorationType: (opts) => ({ opts, dispose() {} }),
    registerTreeDataProvider: () => disposable(),
    showInformationMessage: async () => undefined,
    showWarningMessage: async (m) => { (globalThis.__C80_WARNINGS__ = globalThis.__C80_WARNINGS__ || []).push(m); return undefined; },
    showErrorMessage: async (m) => { (globalThis.__C80_ERRORS__ = globalThis.__C80_ERRORS__ || []).push(m); return undefined; },
    showTextDocument: async (d) => ({ document: d, selection: undefined, revealRange() {} }),
    get activeTextEditor() { return globalThis.__C80_ACTIVE__; },
    get visibleTextEditors() { return globalThis.__C80_VISIBLE__ || []; },
    onDidChangeVisibleTextEditors: () => disposable(),
    activeColorTheme: { kind: 1 },
  },
  commands: {
    registerCommand: (id, fn) => { (globalThis.__C80_COMMANDS__ = globalThis.__C80_COMMANDS__ || {})[id] = fn; return disposable(); },
    executeCommand: async (id, uri, arg2) => {
      const key = uri && uri.toString ? uri.toString() : String(uri);
      if (id === "vscode.executeDocumentSymbolProvider") {
        return (globalThis.__C80_SYMBOLS__ || {})[key];
      }
      if (id === "vscode.executeSelectionRangeProvider") {
        const build = (globalThis.__C80_CHAINS__ || {})[key];
        return build ? build(arg2) : undefined;
      }
      // The call hierarchy, both directions. prepareCallHierarchy is keyed by
      // the document's uri and answered with a builder so a test can place a
      // different root per cursor; the two call directions are keyed by the
      // prepared item's NAME, which is the identity a test can hold onto across
      // the command boundary.
      if (id === "vscode.prepareCallHierarchy") {
        const build = (globalThis.__C80_CALL_ROOTS__ || {})[key];
        return typeof build === "function" ? build(arg2) : build;
      }
      if (id === "vscode.provideIncomingCalls") {
        return (globalThis.__C80_INCOMING__ || {})[uri && uri.name];
      }
      if (id === "vscode.provideOutgoingCalls") {
        return (globalThis.__C80_OUTGOING__ || {})[uri && uri.name];
      }
      return undefined;
    },
  },
};
`;

/**
 * Writes the stub, bundles `entrySource` with `vscode` aliased to it, and
 * requires the result. Returns { mod, vscode, cleanup, error }; `error` is set
 * instead of throwing so a test file can report ONE informative bundle failure
 * and skip the rest.
 */
function bundleWithVscodeStub(tag, entrySource) {
  const stub = path.join(__dirname, `.${tag}.stub.cjs`);
  const entry = path.join(__dirname, `.${tag}.entry.ts`);
  const outfile = path.join(__dirname, `.${tag}.bundle.cjs`);
  const cleanup = () => {
    for (const f of [stub, entry, outfile]) fs.rmSync(f, { force: true });
  };
  try {
    fs.writeFileSync(stub, STUB_SOURCE);
    fs.writeFileSync(entry, entrySource);
    esbuild.buildSync({
      entryPoints: [entry],
      bundle: true,
      outfile,
      format: "cjs",
      platform: "node",
      alias: { vscode: stub },
      // EXTERNAL, not inlined. Bundling the stub gives the product code its own
      // copy of the Uri class, and `arg instanceof vscode.Uri` is then false for
      // a Uri the TEST built — the check the add-a-file gesture depends on would
      // look broken when it is the harness that is. External keeps one class
      // identity on both sides of the boundary.
      external: [stub],
    });
    return { mod: require(outfile), vscode: require(stub), cleanup, error: undefined };
  } catch (error) {
    return { mod: {}, vscode: fs.existsSync(stub) ? require(stub) : {}, cleanup, error };
  }
}

/** A TextDocument backed by fixture text. Ranges come from the symbol tree. */
function makeDoc(vscode, text, uriStr, languageId, version = 1) {
  const { Position, Range, Uri } = vscode;
  const lines = text.split("\n");
  const offsetAt = (pos) => {
    let o = 0;
    for (let i = 0; i < Math.min(pos.line, lines.length); i++) o += lines[i].length + 1;
    return Math.min(o + pos.character, text.length);
  };
  const positionAt = (off) => {
    let o = 0;
    for (let l = 0; l < lines.length; l++) {
      if (off <= o + lines[l].length) return new Position(l, off - o);
      o += lines[l].length + 1;
    }
    return new Position(lines.length - 1, lines[lines.length - 1].length);
  };
  return {
    uri: Uri.parse(uriStr),
    fileName: uriStr.replace(/^file:\/\//, ""),
    languageId,
    version,
    lineCount: lines.length,
    offsetAt,
    positionAt,
    getText: (r) => (r ? text.slice(offsetAt(r.start), offsetAt(r.end)) : text),
    lineAt: (arg) => {
      const n = typeof arg === "number" ? arg : arg.line;
      const t = lines[n] ?? "";
      const m = t.match(/\S/);
      return {
        lineNumber: n,
        text: t,
        range: new Range(n, 0, n, t.length),
        firstNonWhitespaceCharacterIndex: m ? m.index : t.length,
        isEmptyOrWhitespace: !m,
      };
    },
  };
}

module.exports = { STUB_SOURCE, bundleWithVscodeStub, makeDoc };
