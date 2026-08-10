// ADVERSARIAL REVIEW of session-v31 phase 6 (the VS Code wiring).
//
// Not a blind oracle and not a contract pin: every row here is an ATTACK on the
// phase 6 implementation. A row that FAILS is a defect claim with its evidence
// attached; a row that passes is a claim I could not make stick.
//
// The black-box half reuses the blind-v31-wiring harness verbatim (stub vscode,
// real temp workspace, in-process fake Ollama) so the write path is driven
// through the real command. The core half bundles the seam directly.
//
// Run: SKIP_LIVE=1 node --test test/review-v31-phase6.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const os = require("os");
const http = require("node:http");
const esbuild = require("esbuild");

const GUESS = "4242424";
const GUESS2 = "7777777";

// ---------------------------------------------------------------------------
// The real temp workspace. Every fixture project below is DERIVED from the
// corpus shapes goal.md measured (react-mobx-mvvm's vitest package.json,
// mcp-graph-engine's testpaths, Contoso's IsTestProject + ProjectReference
// pair, a stdlib go.mod). None of it is copied from a real repo; it is the
// smallest shape carrying the signals each leg's detection reads.
// ---------------------------------------------------------------------------

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "review-v31-phase6-"));
const w = (rel, text) => {
  const p = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
  return p;
};

// DERIVED fixture: Go module, stdlib testing, sibling _test.go placement.
const GO_SRC = `package atlas

// AggregateFanout returns the fan-out for n shards.
func AggregateFanout(n int) int {
	return 0
}
`;
w("gomod/go.mod", "module probe\n\ngo 1.22\n");
const GO_FILE = w("gomod/atlas.go", GO_SRC);
const GO_TEST_FILE = path.join(ROOT, "gomod", "atlas_test.go");

// DERIVED fixture: vitest project, the react-mobx-mvvm shape.
const TS_SRC = `/** Reads the order total. */
export function readOrder(o: number): number {
	return 0;
}
`;
w(
  "ts/package.json",
  JSON.stringify(
    { name: "probe", version: "0.0.0", scripts: { test: "vitest run" }, devDependencies: { vitest: "^4.1.7" } },
    null,
    2
  ) + "\n"
);
const TS_FILE = w("ts/src/orders.ts", TS_SRC);

// DERIVED fixture: pytest project, the mcp-graph-engine testpaths shape.
const PY_SRC = `# Reads the order total.
def read_order(order: int) -> int:
    """Reads the order total."""
    return 0
`;
w("py/pyproject.toml", '[tool.pytest.ini_options]\ntestpaths = ["tests"]\n');
fs.mkdirSync(path.join(ROOT, "py", "tests"), { recursive: true });
const PY_FILE = w("py/orders.py", PY_SRC);

// DERIVED fixture: the Contoso pair, a source project and a <Source>.Tests
// peer carrying IsTestProject, Microsoft.NET.Test.Sdk, MSTest and a
// ProjectReference back. InternalsVisibleTo appears nowhere, per Amendment 1.
const CS_SRC = `namespace Orders
{
    public class Ledger
    {
        /// <summary>Reads the order total.</summary>
        public static int ReadOrder(int o)
        {
            return 0;
        }
    }
}
`;
w(
  "cs/Orders/Orders.csproj",
  `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup><TargetFramework>net10.0</TargetFramework></PropertyGroup>
</Project>
`
);
const CS_FILE = w("cs/Orders/Orders.cs", CS_SRC);
w(
  "cs/Orders.Tests/Orders.Tests.csproj",
  `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <IsTestProject>true</IsTestProject>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Microsoft.NET.Test.Sdk" Version="18.0.0" />
    <PackageReference Include="MSTest" Version="4.0.1" />
  </ItemGroup>
  <ItemGroup>
    <ProjectReference Include="..\\Orders\\Orders.csproj" />
  </ItemGroup>
</Project>
`
);

// DERIVED fixture: a language that will never have a registered leg. Ruby is
// chosen deliberately - it is not in goal.md's five and not on any roadmap
// item, so this row keeps its teeth however the language list grows.
const RB_SRC = `# Reads the order total.
def read_order(order)
  0
end
`;
const RB_FILE = w("rb/orders.rb", RB_SRC);

// A fake `go` on PATH, so the no-run outcomes are forced deterministically
// without a toolchain. DERIVED: every byte it prints is one of goal.md item
// 2's measured captures (the build failure, the no-tests-to-run false green).
const FAKEBIN = path.join(ROOT, "fakebin");
const EMPTYBIN = path.join(ROOT, "emptybin");
fs.mkdirSync(FAKEBIN, { recursive: true });
fs.mkdirSync(EMPTYBIN, { recursive: true });
const GO_SHIM = path.join(FAKEBIN, "go");
fs.writeFileSync(
  GO_SHIM,
  `#!/bin/sh
# Only 'go test' is answered; every other subcommand is a silent success so
# that a compiler-oracle probe cannot change the outcome under measurement.
if [ "$1" != "test" ]; then exit 0; fi
json=0
for a in "$@"; do case "$a" in -json|--json) json=1;; esac; done
case "$V31_GO_MODE" in
  build)
    if [ "$json" = "1" ]; then
      printf '%s\\n' '{"ImportPath":"probe","Action":"build-output","Output":"# probe\\n"}'
      printf '%s\\n' '{"ImportPath":"probe","Action":"build-output","Output":"./atlas_test.go:9:14: undefined: nopeSymbol\\n"}'
      printf '%s\\n' '{"ImportPath":"probe","Action":"build-fail"}'
      exit 1
    fi
    printf '%s\\n' 'FAIL	probe [build failed]'
    printf '%s\\n' './atlas_test.go:9:14: undefined: nopeSymbol' 1>&2
    exit 2
    ;;
  filter)
    if [ "$json" = "1" ]; then
      printf '%s\\n' '{"Package":"probe","Action":"output","Output":"testing: warning: no tests to run\\n"}'
      printf '%s\\n' '{"Package":"probe","Action":"output","Output":"PASS\\n"}'
      printf '%s\\n' '{"Package":"probe","Action":"output","Output":"ok  \\tprobe\\t0.001s [no tests to run]\\n"}'
      printf '%s\\n' '{"Package":"probe","Action":"pass","Elapsed":0.001}'
      exit 0
    fi
    printf '%s\\n' 'testing: warning: no tests to run'
    printf '%s\\n' 'PASS'
    printf '%s\\n' 'ok  	probe	0.001s [no tests to run]'
    exit 0
    ;;
  skip)
    if [ "$json" = "1" ]; then
      printf '%s\\n' '{"Package":"probe","Action":"run","Test":"TestAggregateFanoutHappy"}'
      printf '%s\\n' '{"Package":"probe","Action":"output","Test":"TestAggregateFanoutHappy","Output":"    atlas_test.go:9: needs a fixture\\n"}'
      printf '%s\\n' '{"Package":"probe","Action":"skip","Test":"TestAggregateFanoutHappy","Elapsed":0}'
      printf '%s\\n' '{"Package":"probe","Action":"skip","Elapsed":0}'
      exit 0
    fi
    printf '%s\\n' '--- SKIP: TestAggregateFanoutHappy (0.00s)'
    printf '%s\\n' 'ok  	probe	0.001s'
    exit 0
    ;;
  *)
    printf '%s\\n' 'RV31UNCLASSIFIEDSTDOUT'
    printf '%s\\n' 'RV31UNCLASSIFIEDSTDERR' 1>&2
    exit 3
    ;;
esac
`
);
fs.chmodSync(GO_SHIM, 0o755);

// ---------------------------------------------------------------------------
// The vscode stub. blind-derust-tdd's shape plus the phase 6 observation
// points: every SHOWN surface is recorded, and every WRITE channel really
// writes to the temp workspace so a create is observable however it is done.
// ---------------------------------------------------------------------------

const STUB = path.join(__dirname, ".review-v31-phase6-stub.cjs");
fs.writeFileSync(
  STUB,
  `
const nodeFs = require("fs");
const nodePath = require("path");
const state = {
  config: {}, messages: [], commands: {}, executeCalls: [], commandHandlers: {},
  outputLines: [], inlineProviders: [], contentProviders: {},
  textDocuments: [], visibleTextEditors: [], activeTextEditor: undefined,
  collections: [], appliedEdits: [], editorEdits: [], snippetInserts: [],
  openedDocs: [], shownDocs: [], fsWrites: [], picks: [],
  answer: null, answerPick: null, workspaceRoot: "/proj",
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
  contains(p) {
    const s = this.start, e = this.end;
    const ps = p.start ? p.start : p;
    const pe = p.end ? p.end : p;
    const geS = ps.line > s.line || (ps.line === s.line && ps.character >= s.character);
    const leE = pe.line < e.line || (pe.line === e.line && pe.character <= e.character);
    return geS && leE;
  }
  with(start, end) { return new Range(start || this.start, end || this.end); }
  intersection() { return undefined; }
  union(o) { return o; }
}
class Selection extends Range {
  constructor(a, b, c, d) { super(a, b, c, d); this.anchor = this.start; this.active = this.end; this.isReversed = false; }
}
class WorkspaceEdit {
  constructor() { this._entries = []; this._files = []; }
  replace(uri, range, text) { this._entries.push([uri, [{ range, newText: text }]]); }
  insert(uri, pos, text) { this._entries.push([uri, [{ range: new Range(pos, pos), newText: text }]]); }
  delete(uri, range) { this._entries.push([uri, [{ range, newText: "" }]]); }
  createFile(uri, options) { this._files.push({ op: "create", uri, options }); }
  deleteFile(uri, options) { this._files.push({ op: "delete", uri, options }); }
  renameFile(from, to, options) { this._files.push({ op: "rename", uri: to, from, options }); }
  entries() { return this._entries; }
  get size() { return this._entries.length + this._files.length; }
}
class EventEmitter {
  constructor() { this.handlers = []; }
  get event() { return (fn) => { this.handlers.push(fn); return { dispose() {} }; }; }
  fire(x) { for (const h of this.handlers) h(x); }
  dispose() {}
}
class ThemeColor { constructor(id) { this.id = id; } }
class MarkdownString {
  constructor(value) { this.value = value || ""; this.isTrusted = false; }
  appendCodeblock(t, lang) { this.value += "\\n\`\`\`" + (lang || "") + "\\n" + t + "\\n\`\`\`\\n"; }
  appendMarkdown(t) { this.value += t; }
  appendText(t) { this.value += t; }
}
class Diagnostic { constructor(range, message, severity) { this.range = range; this.message = message; this.severity = severity; } }
class SnippetString { constructor(value) { this.value = value || ""; } appendText(t) { this.value += t; return this; } appendTabstop() { return this; } }
class InlineCompletionItem { constructor(insertText, range, command) { this.insertText = insertText; this.range = range; this.command = command; } }
class InlineCompletionList { constructor(items) { this.items = items; } }
class TreeItem { constructor(label, collapsibleState) { this.label = label; this.collapsibleState = collapsibleState; } }
class Location { constructor(uri, rangeOrPos) { this.uri = uri; this.range = rangeOrPos; } }
class Hover { constructor(contents, range) { this.contents = Array.isArray(contents) ? contents : [contents]; this.range = range; } }
class RelativePattern { constructor(base, pattern) { this.base = base; this.pattern = pattern; } }
class CancellationTokenSource {
  constructor() { this.token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) }; }
  cancel() { this.token.isCancellationRequested = true; }
  dispose() {}
}
const mkUri = (full, fsPath) => ({
  scheme: full.includes("://") ? full.slice(0, full.indexOf("://")) : "file",
  fsPath, path: fsPath, query: "", fragment: "",
  toString: () => full,
  with() { return this; },
  toJSON() { return full; },
});
const Uri = {
  file: (p) => mkUri("file://" + p, p),
  parse: (s) => mkUri(String(s), String(s).replace(/^[a-zA-Z+-]+:\\/\\//, "")),
  joinPath: (base, ...segs) => Uri.file([base.fsPath, ...segs].join("/")),
  from: (c) => {
    const full =
      (c.scheme || "file") + "://" + (c.authority || "") + (c.path || "") +
      (c.query ? "?" + c.query : "") + (c.fragment ? "#" + c.fragment : "");
    const u = mkUri(full, c.path || "");
    u.scheme = c.scheme || "file";
    u.query = c.query || "";
    u.fragment = c.fragment || "";
    return u;
  },
};
const disposable = () => ({ dispose() {} });

// Offsets over a real text, so a WorkspaceEdit can be applied to real bytes.
const offsetOf = (text, pos) => {
  const lines = text.split("\\n");
  let o = 0;
  for (let i = 0; i < Math.min(pos.line, lines.length); i++) o += lines[i].length + 1;
  return Math.min(o + pos.character, text.length);
};
const readIfFile = (p) => { try { return nodeFs.readFileSync(p, "utf8"); } catch { return undefined; } };
const mkDocFromText = (uri, text, languageId) => {
  const lines = String(text).split("\\n");
  return {
    uri, fileName: uri.fsPath, languageId: languageId || "plaintext", version: 1,
    isDirty: false, isUntitled: false, isClosed: false, eol: 1, lineCount: lines.length,
    getText: (r) => (r ? String(text).slice(offsetOf(text, r.start), offsetOf(text, r.end)) : String(text)),
    offsetAt: (p) => offsetOf(text, p),
    positionAt: (off) => {
      let o = 0;
      for (let l = 0; l < lines.length; l++) {
        if (off <= o + lines[l].length) return new Position(l, off - o);
        o += lines[l].length + 1;
      }
      return new Position(lines.length - 1, lines[lines.length - 1].length);
    },
    lineAt: (n) => {
      const i = typeof n === "number" ? n : n.line;
      const t = lines[i] || "";
      const m = t.match(/\\S/);
      return { lineNumber: i, text: t, firstNonWhitespaceCharacterIndex: m ? m.index : t.length,
        isEmptyOrWhitespace: !m, range: new Range(i, 0, i, t.length),
        rangeIncludingLineBreak: new Range(i, 0, i + 1, 0) };
    },
    getWordRangeAtPosition: () => undefined,
    save: async () => true,
  };
};

module.exports = {
  __state: state,
  version: "1.85.0",
  Position, Range, Selection, WorkspaceEdit, EventEmitter, ThemeColor, MarkdownString,
  Diagnostic, SnippetString, InlineCompletionItem, InlineCompletionList, TreeItem,
  Location, Hover, RelativePattern, CancellationTokenSource, Uri,
  DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
  SymbolKind: { File: 0, Module: 1, Namespace: 2, Package: 3, Class: 4, Method: 5, Property: 6,
    Field: 7, Constructor: 8, Enum: 9, Interface: 10, Function: 11, Variable: 12, Constant: 13,
    String: 14, Number: 15, Boolean: 16, Array: 17, Object: 18, Key: 19, Null: 20, EnumMember: 21,
    Struct: 22, Event: 23, Operator: 24, TypeParameter: 25 },
  CompletionItemKind: { Text: 0, Method: 1, Function: 2, Constructor: 3, Field: 4, Variable: 5,
    Class: 6, Interface: 7, Module: 8, Property: 9, Unit: 10, Value: 11, Enum: 12, Keyword: 13,
    Snippet: 14, Color: 15, File: 16, Reference: 17, Folder: 18, EnumMember: 19, Constant: 20,
    Struct: 21, Event: 22, Operator: 23, TypeParameter: 24 },
  InlineCompletionTriggerKind: { Invoke: 0, Automatic: 1 },
  StatusBarAlignment: { Left: 1, Right: 2 },
  OverviewRulerLane: { Left: 1, Center: 2, Right: 4, Full: 7 },
  ProgressLocation: { SourceControl: 1, Window: 10, Notification: 15 },
  ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  EndOfLine: { LF: 1, CRLF: 2 },
  ViewColumn: { Active: -1, Beside: -2, One: 1, Two: 2 },
  TextEditorRevealType: { Default: 0, InCenter: 1, InCenterIfOutsideViewport: 2, AtTop: 3 },
  FileType: { Unknown: 0, File: 1, Directory: 2, SymbolicLink: 64 },
  CodeActionKind: { QuickFix: { value: "quickfix" }, Refactor: { value: "refactor" } },
  workspace: {
    getConfiguration: (section) => ({
      get: (key, fallback) => {
        if (key in state.config) return state.config[key];
        const full = section ? section + "." + key : key;
        if (full in state.config) return state.config[full];
        return fallback;
      },
      has: (key) => key in state.config,
      inspect: () => undefined,
      update: async () => {},
    }),
    onDidChangeConfiguration: () => disposable(),
    onDidChangeTextDocument: () => disposable(),
    onDidOpenTextDocument: () => disposable(),
    onDidCloseTextDocument: () => disposable(),
    onDidRenameFiles: () => disposable(),
    onDidDeleteFiles: () => disposable(),
    onDidSaveTextDocument: () => disposable(),
    registerTextDocumentContentProvider: (scheme, provider) => {
      state.contentProviders[scheme] = provider;
      return disposable();
    },
    get textDocuments() { return state.textDocuments; },
    openTextDocument: async (arg) => {
      if (arg && typeof arg === "object" && typeof arg.content === "string") {
        const doc = mkDocFromText(Uri.parse("untitled:v31"), arg.content, arg.language);
        doc.isUntitled = true;
        state.openedDocs.push({ key: "untitled", text: arg.content });
        return doc;
      }
      const uri = typeof arg === "string" ? (arg.includes("://") ? Uri.parse(arg) : Uri.file(arg)) : arg;
      const key = uri && uri.toString ? uri.toString() : String(arg);
      const preset = (globalThis.__RV31_DOCS__ || {})[key];
      if (preset) { state.openedDocs.push({ key, text: preset.getText() }); return preset; }
      const scheme = uri && uri.scheme ? uri.scheme : "file";
      if (scheme === "file") {
        const onDisk = readIfFile(uri.fsPath);
        if (onDisk !== undefined) {
          state.openedDocs.push({ key, text: onDisk });
          return mkDocFromText(uri, onDisk, undefined);
        }
      }
      const provider = state.contentProviders[scheme];
      const text = provider ? await provider.provideTextDocumentContent(uri, { isCancellationRequested: false }) : "";
      state.openedDocs.push({ key, text: String(text || "") });
      return mkDocFromText(uri, String(text || ""), undefined);
    },
    applyEdit: async (edit) => {
      state.appliedEdits.push(edit);
      for (const f of (edit && edit._files) || []) {
        const p = f.uri && f.uri.fsPath;
        if (!p) continue;
        if (f.op === "create") {
          nodeFs.mkdirSync(nodePath.dirname(p), { recursive: true });
          if (!nodeFs.existsSync(p) || (f.options && f.options.overwrite)) nodeFs.writeFileSync(p, "");
          state.fsWrites.push({ how: "WorkspaceEdit.createFile", path: p });
        } else if (f.op === "delete") {
          try { nodeFs.rmSync(p, { force: true, recursive: true }); } catch {}
          state.fsWrites.push({ how: "WorkspaceEdit.deleteFile", path: p });
        }
      }
      const byPath = new Map();
      for (const [uri, edits] of (edit && edit.entries ? edit.entries() : [])) {
        const p = uri && uri.fsPath;
        if (!p) continue;
        if (!byPath.has(p)) byPath.set(p, []);
        for (const e of edits) byPath.get(p).push(e);
      }
      for (const [p, edits] of byPath) {
        let text = readIfFile(p);
        if (text === undefined) continue;
        const resolved = edits
          .map((e) => ({ s: offsetOf(text, e.range.start), e: offsetOf(text, e.range.end), t: e.newText }))
          .sort((a, b) => b.s - a.s);
        for (const r of resolved) text = text.slice(0, r.s) + r.t + text.slice(r.e);
        nodeFs.writeFileSync(p, text);
        state.fsWrites.push({ how: "WorkspaceEdit.textEdit", path: p });
      }
      return true;
    },
    get workspaceFolders() { return [{ uri: Uri.file(state.workspaceRoot), name: "probe", index: 0 }]; },
    asRelativePath: (u) => String(u && u.fsPath ? u.fsPath : u).replace(state.workspaceRoot + "/", ""),
    createFileSystemWatcher: () => ({ onDidChange: () => disposable(), onDidCreate: () => disposable(), onDidDelete: () => disposable(), dispose() {} }),
    fs: {
      stat: async (uri) => {
        const st = nodeFs.statSync(uri.fsPath);
        return { type: st.isDirectory() ? 2 : 1, ctime: 0, mtime: 0, size: st.size };
      },
      readFile: async (uri) => new Uint8Array(nodeFs.readFileSync(uri.fsPath)),
      writeFile: async (uri, bytes) => {
        nodeFs.mkdirSync(nodePath.dirname(uri.fsPath), { recursive: true });
        nodeFs.writeFileSync(uri.fsPath, Buffer.from(bytes));
        state.fsWrites.push({ how: "workspace.fs.writeFile", path: uri.fsPath });
      },
      createDirectory: async (uri) => {
        nodeFs.mkdirSync(uri.fsPath, { recursive: true });
        state.fsWrites.push({ how: "workspace.fs.createDirectory", path: uri.fsPath });
      },
      delete: async (uri) => {
        try { nodeFs.rmSync(uri.fsPath, { force: true, recursive: true }); } catch {}
        state.fsWrites.push({ how: "workspace.fs.delete", path: uri.fsPath });
      },
      readDirectory: async (uri) => nodeFs.readdirSync(uri.fsPath).map((n) => [n, 1]),
    },
  },
  languages: {
    createDiagnosticCollection: (name) => {
      const c = { name, set() {}, delete() {}, clear() {}, dispose() {} };
      state.collections.push(c);
      return c;
    },
    registerInlineCompletionItemProvider: (selector, provider) => {
      state.inlineProviders.push({ selector, provider });
      return disposable();
    },
    registerCodeActionsProvider: () => disposable(),
    registerCodeLensProvider: () => disposable(),
    registerHoverProvider: () => disposable(),
    getDiagnostics: () => [],
    onDidChangeDiagnostics: () => disposable(),
    setLanguageConfiguration: () => disposable(),
  },
  window: {
    createOutputChannel: (name) => ({
      name,
      appendLine: (l) => state.outputLines.push(l),
      append: (l) => state.outputLines.push(l),
      replace() {}, show() {}, hide() {}, clear() {}, dispose() {},
    }),
    createStatusBarItem: () => ({ text: "", tooltip: "", command: undefined, backgroundColor: undefined, show() {}, hide() {}, dispose() {} }),
    createTextEditorDecorationType: (opts) => ({ opts, dispose() {} }),
    get visibleTextEditors() { return state.visibleTextEditors; },
    get activeTextEditor() { return state.activeTextEditor; },
    onDidChangeActiveTextEditor: () => disposable(),
    onDidChangeTextEditorSelection: () => disposable(),
    onDidChangeVisibleTextEditors: () => disposable(),
    showInformationMessage: async (message, ...rest) => {
      const actions = rest.filter((r) => typeof r === "string" || (r && typeof r.title === "string"));
      state.messages.push({ kind: "info", message, actions });
      return state.answer ? state.answer("info", message, actions) : undefined;
    },
    showWarningMessage: async (message, ...rest) => {
      const actions = rest.filter((r) => typeof r === "string" || (r && typeof r.title === "string"));
      state.messages.push({ kind: "warn", message, actions });
      return state.answer ? state.answer("warn", message, actions) : undefined;
    },
    showErrorMessage: async (message, ...rest) => {
      const actions = rest.filter((r) => typeof r === "string" || (r && typeof r.title === "string"));
      state.messages.push({ kind: "error", message, actions });
      return state.answer ? state.answer("error", message, actions) : undefined;
    },
    showQuickPick: async (items, options) => {
      const resolved = await items;
      state.picks.push({ items: resolved, options });
      return state.answerPick ? state.answerPick(resolved, options) : undefined;
    },
    showInputBox: async () => undefined,
    withProgress: async (opts, task) => task({ report: () => {} }, { isCancellationRequested: false, onCancellationRequested: () => disposable() }),
    setStatusBarMessage: () => disposable(),
    showTextDocument: async (docOrUri, opts) => {
      let document = docOrUri;
      if (!docOrUri || typeof docOrUri.getText !== "function") {
        const uri = typeof docOrUri === "string" ? Uri.file(docOrUri) : docOrUri;
        const onDisk = uri && uri.fsPath ? readIfFile(uri.fsPath) : undefined;
        document = mkDocFromText(uri || Uri.file("/unknown"), onDisk === undefined ? "" : onDisk, undefined);
      }
      state.shownDocs.push({ key: document.uri && document.uri.toString ? document.uri.toString() : "", text: document.getText() });
      return {
        document,
        selection: new Selection(new Position(0, 0), new Position(0, 0)),
        selections: [new Selection(new Position(0, 0), new Position(0, 0))],
        options: {}, viewColumn: 1,
        edit: async () => { state.editorEdits.push({ how: "showTextDocument.edit", uri: String(document.uri) }); return true; },
        insertSnippet: async (s) => {
          state.snippetInserts.push({ uri: document.uri && document.uri.fsPath, value: s && s.value });
          return true;
        },
        setDecorations() {}, revealRange() {},
      };
    },
    tabGroups: { all: [], onDidChangeTabs: () => disposable(), close: async () => {} },
    createTreeView: () => ({ dispose() {}, onDidChangeSelection: () => disposable(), onDidChangeVisibility: () => disposable(), reveal: async () => {} }),
    registerTreeDataProvider: () => disposable(),
    registerWebviewViewProvider: () => disposable(),
    activeColorTheme: { kind: 1 },
  },
  commands: {
    registerCommand: (id, fn) => { state.commands[id] = fn; return disposable(); },
    executeCommand: async (id, ...args) => {
      state.executeCalls.push({ id, args });
      const h = state.commandHandlers[id];
      if (h) return h(...args);
      if (state.commands[id]) return state.commands[id](...args);
      return undefined;
    },
    getCommands: async () => Object.keys(state.commands),
  },
  env: { appName: "stub", machineId: "stub", clipboard: { writeText: async () => {} }, openExternal: async () => true },
  extensions: { getExtension: () => undefined, all: [] },
};
`
);

// ---------------------------------------------------------------------------
// Bundle the extension entry AND the seam's one construction point, with the
// stub aliased in. Guard pattern: a broken bundle, a missing activate or a
// missing tddLangFor is ONE loud failure and everything else skips.
// ---------------------------------------------------------------------------

const entry = path.join(__dirname, ".review-v31-phase6.entry.ts");
const outfile = path.join(__dirname, ".review-v31-phase6.bundle.cjs");
let mod = {};
let bundleError;
try {
  fs.writeFileSync(
    entry,
    `export { activate } from "../src/vscode/extension";
export { tddLangFor } from "../src/core/tddLang";
export { __state, Position, Range, Selection, Uri, Location } from "vscode";\n`
  );
  esbuild.buildSync({ entryPoints: [entry], bundle: true, outfile, format: "cjs", platform: "node", alias: { vscode: STUB } });
  mod = require(outfile);
} catch (e) {
  bundleError = e;
}
if (!bundleError && typeof mod.activate !== "function") {
  bundleError = new Error("the bundle built but exports no activate function");
}
if (!bundleError && typeof mod.tddLangFor !== "function") {
  bundleError = new Error("the bundle built but src/core/tddLang.ts exports no tddLangFor");
}
const { activate, tddLangFor, __state, Position, Selection, Uri } = mod;

test.after(() => {
  fs.rmSync(entry, { force: true });
  fs.rmSync(outfile, { force: true });
  fs.rmSync(STUB, { force: true });
  fs.rmSync(ROOT, { force: true, recursive: true });
});

test("bundle: the extension entry and the tddLangFor seam build and activate against the stub [harness guard: one loud failure, everything else skips]", async () => {
  if (bundleError) assert.fail(`the surface is not buildable: ${bundleError.message}`);
  await harness();
});

const gtest = (name, fn) =>
  test(name, (ctx) => {
    if (bundleError) return ctx.skip("the surface did not build; see the bundle guard row");
    return fn(ctx);
  });

// ---------------------------------------------------------------------------
// Fake Ollama server: the no-generation observation point. /api/tags reports
// every configured model present, so no model gate can explain a refusal and
// the only honest gate left is the one under measurement.
// ---------------------------------------------------------------------------

const MODELS = ["fake-fim", "fake-30b", "fake-14b"];

function startServer() {
  const srv = { requests: [], replyFor: null };
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", () => {
      let body;
      try { body = raw ? JSON.parse(raw) : undefined; } catch { body = { raw }; }
      srv.requests.push({ method: req.method, url: req.url, body });
      if (req.url === "/api/tags") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ models: MODELS.map((name) => ({ name, model: name })) }));
        return;
      }
      if (req.url === "/api/generate") {
        const text = (srv.replyFor && srv.replyFor(body)) || "0";
        res.writeHead(200, { "Content-Type": "application/x-ndjson" });
        res.write(JSON.stringify({ response: text }) + "\n");
        res.write(JSON.stringify({ response: "", done: true, done_reason: "stop" }) + "\n");
        res.end();
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end("{}");
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      srv.apiBase = `http://127.0.0.1:${server.address().port}`;
      srv.close = () => new Promise((r) => server.close(r));
      resolve(srv);
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (predicate, what, tries = 400, soft = false) => {
  for (let i = 0; i < tries; i++) {
    if (predicate()) return true;
    await sleep(25);
  }
  if (soft) return false;
  assert.fail(`timed out waiting for ${what}`);
};

// ---------------------------------------------------------------------------
// One-time activation.
// ---------------------------------------------------------------------------

let harnessP;
let serverRef;
const harness = () =>
  (harnessP ||= (async () => {
    if (bundleError) throw bundleError;
    const srv = await startServer();
    serverRef = srv;
    __state.workspaceRoot = ROOT;
    __state.config = {
      enabled: true,
      apiBase: srv.apiBase,
      fimModel: "fake-fim",
      fnGenModel: "fake-30b",
      fnGenFallbackModel: "fake-14b",
      fnGenProvider: "ollama",
      cloudApiKey: "",
      cloudApiBase: "",
      hardwareTier: "16gb-large-ram",
      maxTokens: 512,
      temperature: 0.01,
      debounceMs: 0,
      prefixChars: 3000,
      suffixChars: 1000,
      multiline: true,
      repairEnabled: false,
      compilerDirectedInjection: true,
    };
    const mem = { get: (k, f) => f, update: async () => {}, keys: () => [], setKeysForSync() {} };
    const context = {
      subscriptions: [],
      globalState: mem,
      workspaceState: mem,
      secrets: { get: async () => undefined, store: async () => {}, delete: async () => {}, onDidChange: () => ({ dispose() {} }) },
      extensionUri: Uri.file("/ext"),
      extensionPath: "/ext",
      extensionMode: 1,
      asAbsolutePath: (p) => "/ext/" + p,
      globalStorageUri: Uri.file(path.join(ROOT, "storage")),
      logUri: Uri.file(path.join(ROOT, "log")),
      environmentVariableCollection: { replace() {}, append() {}, prepend() {}, clear() {} },
    };
    await activate(context);
    await waitFor(() => typeof __state.commands["column80.generateTests"] === "function", "generateTests registration");
    await waitFor(() => __state.outputLines.some((l) => l.includes("tier=")), "tier resolution line", 200, true);
    return { srv, context };
  })());

test.after(async () => {
  try {
    if (serverRef) await serverRef.close();
  } catch {}
});

// ---------------------------------------------------------------------------
// Document / editor fakes. The editor RECORDS edit and insertSnippet, so a
// buffer mutation on refusal is observable.
// ---------------------------------------------------------------------------

function makeDoc(text, filePath, languageId) {
  const uriStr = "file://" + filePath;
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
    fileName: filePath,
    languageId,
    version: 1,
    isDirty: false,
    isUntitled: false,
    isClosed: false,
    eol: 1,
    lineCount: lines.length,
    save: async () => true,
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
        range: new mod.Range(n, 0, n, t.length),
        rangeIncludingLineBreak: new mod.Range(n, 0, n + 1, 0),
        firstNonWhitespaceCharacterIndex: m ? m.index : t.length,
        isEmptyOrWhitespace: !m,
      };
    },
    getWordRangeAtPosition: (pos) => {
      const t = lines[pos.line] ?? "";
      const isWord = (c) => /[A-Za-z0-9_$]/.test(c);
      let s = Math.min(pos.character, t.length);
      let e = s;
      while (s > 0 && isWord(t[s - 1])) s--;
      while (e < t.length && isWord(t[e])) e++;
      return e > s ? new mod.Range(pos.line, s, pos.line, e) : undefined;
    },
  };
}

const makeEditor = (doc, pos) => {
  const edits = [];
  const snippets = [];
  return {
    document: doc,
    selection: new Selection(pos, pos),
    selections: [new Selection(pos, pos)],
    options: { tabSize: 4, insertSpaces: true },
    viewColumn: 1,
    edit: async (cb) => { edits.push(cb); return true; },
    insertSnippet: async (s) => { snippets.push({ uri: doc.fileName, value: s && s.value }); return true; },
    setDecorations() {},
    revealRange() {},
    __edits: edits,
    __snippets: snippets,
  };
};

const posOf = (text, needle, nth = 0) => {
  let idx = -1;
  for (let i = 0; i <= nth; i++) {
    idx = text.indexOf(needle, idx + 1);
    assert.ok(idx >= 0, `fixture needle not found (occurrence ${i}): ${JSON.stringify(needle)}`);
  }
  const before = text.slice(0, idx);
  const line = (before.match(/\n/g) || []).length;
  return new Position(line, idx - (before.lastIndexOf("\n") + 1));
};

const vr = (sl, sc, el, ec) => new mod.Range(sl, sc, el, ec);
const dsym = (name, kind, range, selectionRange, children = [], detail = "") => ({
  name, detail, kind, range, selectionRange, children,
});

const emptyHandlers = (symbols) => ({
  "vscode.executeDocumentSymbolProvider": () => symbols,
  "vscode.executeDefinitionProvider": () => undefined,
  "vscode.executeHoverProvider": () => undefined,
  "vscode.executeCompletionItemProvider": () => undefined,
  "vscode.executeCodeActionProvider": () => undefined,
});

// ---------------------------------------------------------------------------
// Disk observation. The workspace is real, so "leaves no file behind" is a
// walk of the tree rather than trust in one channel.
// ---------------------------------------------------------------------------

const walk = (dir, acc = []) => {
  for (const name of fs.readdirSync(dir)) {
    if (name === "fakebin" || name === "emptybin") continue;
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, acc);
    else acc.push(path.relative(ROOT, p));
  }
  return acc.sort();
};
const snapshot = () => {
  const out = {};
  for (const rel of walk(ROOT)) out[rel] = fs.readFileSync(path.join(ROOT, rel), "utf8");
  return out;
};
const diffSnapshot = (before, after) => {
  const created = Object.keys(after).filter((k) => !(k in before));
  const changed = Object.keys(after).filter((k) => k in before && before[k] !== after[k]);
  const deleted = Object.keys(before).filter((k) => !(k in after));
  return { created, changed, deleted };
};

// A test PROJECT, a config file or a manifest, by name. The human's boundary.
const PROJECT_ARTEFACT = /(^|\/)(go\.mod|go\.sum|go\.work|package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|vitest\.config\.[cm]?[jt]s|jest\.config\.[cm]?[jt]s|tsconfig(\..*)?\.json|pyproject\.toml|setup\.py|setup\.cfg|tox\.ini|requirements[^/]*\.txt|conftest\.py|pytest\.ini|Cargo\.toml|[^/]+\.csproj|[^/]+\.sln|[^/]+\.props|nuget\.config|Directory\.Build\.[^/]+)$/i;

// ---------------------------------------------------------------------------
// Surface collection: everything the human could have been SHOWN.
// ---------------------------------------------------------------------------

async function shownSurfaces() {
  const out = [];
  for (const m of __state.messages) out.push(String(m.message));
  for (const p of __state.picks) out.push(JSON.stringify(p.items));
  for (const d of __state.openedDocs) out.push(String(d.text || ""));
  for (const d of __state.shownDocs) out.push(String(d.text || ""));
  for (const c of __state.executeCalls) {
    if (!/diff|preview|open|show/i.test(String(c.id))) continue;
    for (const a of c.args || []) {
      if (typeof a === "string") { out.push(a); continue; }
      if (!a || typeof a.toString !== "function") continue;
      const s = String(a);
      out.push(s);
      const scheme = s.includes("://") ? s.slice(0, s.indexOf("://")) : null;
      const provider = scheme && __state.contentProviders[scheme];
      if (!provider) continue;
      try {
        const text = await provider.provideTextDocumentContent(a, { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) });
        out.push(String(text || ""));
      } catch {}
    }
  }
  return out;
}

const writtenSurfaces = (editor) => {
  const out = [];
  for (const s of __state.snippetInserts) out.push(String(s.value || ""));
  for (const s of (editor ? editor.__snippets : [])) out.push(String(s.value || ""));
  for (const e of __state.appliedEdits) {
    for (const [, edits] of e.entries ? e.entries() : []) for (const x of edits) out.push(String(x.newText || ""));
  }
  return out;
};

const allSnippets = (editor) =>
  __state.snippetInserts.concat(editor ? editor.__snippets : []).map((s) => ({ uri: s.uri, value: String(s.value || "") }));

// ---------------------------------------------------------------------------
// Drive helpers.
// ---------------------------------------------------------------------------

const ACCEPT_RE = /^(accept|apply|insert|create|write|yes|ok|generate|continue|proceed)\b/i;
const REJECT_RE = /^(reject|discard|cancel|no|dismiss|not now)\b/i;
const labelOf = (a) => (typeof a === "string" ? a : a && a.title ? a.title : "");

const answerAccept = (kind, message, actions) => {
  const hit = (actions || []).find((a) => ACCEPT_RE.test(labelOf(a)));
  return hit;
};
const answerReject = (kind, message, actions) => {
  const hit = (actions || []).find((a) => REJECT_RE.test(labelOf(a)));
  return hit; // undefined when there is no explicit reject: dismissing IS rejecting
};
const pickAccept = (items) => (items || []).find((i) => ACCEPT_RE.test(labelOf(i) || (i && i.label) || ""));

const resetDrive = (handlers, docs, editor, answer, answerPick) => {
  __state.commandHandlers = handlers || {};
  __state.messages.length = 0;
  __state.executeCalls.length = 0;
  __state.appliedEdits.length = 0;
  __state.editorEdits.length = 0;
  __state.snippetInserts.length = 0;
  __state.openedDocs.length = 0;
  __state.shownDocs.length = 0;
  __state.fsWrites.length = 0;
  __state.picks.length = 0;
  __state.answer = answer || null;
  __state.answerPick = answerPick || null;
  globalThis.__RV31_DOCS__ = docs || {};
  __state.activeTextEditor = editor;
  __state.textDocuments = editor ? [editor.document] : [];
  __state.visibleTextEditors = editor ? [editor] : [];
  serverRef.requests.length = 0;
  serverRef.replyFor = null;
};

const diag = () =>
  `messages=${JSON.stringify(__state.messages.map((m) => m.kind + ": " + m.message))} lastLog=${JSON.stringify(__state.outputLines.slice(-10))}`;

// Drive a gesture to settlement, then report everything the contracts here
// constrain. Settlement is raced against a generation request because a
// preview path may park on UI the stub cannot supply; the extra wait gives
// the preview and any post-accept write time to land.
async function driveSettled(commandId, opts) {
  const { doc, cursor, handlers, docs, reply, answer, answerPick, settleMs = 4000 } = opts;
  await harness();
  const editor = makeEditor(doc, cursor);
  const logMark = __state.outputLines.length;
  resetDrive(handlers, docs, editor, answer, answerPick);
  serverRef.replyFor = reply || null;
  const cmd = __state.commands[commandId];
  assert.strictEqual(typeof cmd, "function", `${commandId} must be registered`);
  let cmdError;
  let cmdSettled = false;
  Promise.resolve()
    .then(() => cmd())
    .then(
      () => { cmdSettled = true; },
      (e) => { cmdError = e; cmdSettled = true; }
    );
  await waitFor(
    () => cmdSettled || serverRef.requests.some((r) => r.url === "/api/generate"),
    `${commandId} to settle or reach the generation service`
  );
  await waitFor(() => cmdSettled, `${commandId} to settle`, Math.ceil(settleMs / 25), true);
  await sleep(250);
  return {
    editor,
    cmdError,
    genRequests: serverRef.requests.filter((r) => r.url === "/api/generate"),
    messages: __state.messages.slice(),
    texts: __state.messages.map((m) => String(m.message)),
    logs: __state.outputLines.slice(logMark),
    editorEdits: editor.__edits.length + __state.editorEdits.length,
    snippetInserts: allSnippets(editor),
    appliedEdits: __state.appliedEdits.length,
    fsWrites: __state.fsWrites.slice(),
    shown: await shownSurfaces(),
    written: writtenSurfaces(editor),
  };
}

// ---------------------------------------------------------------------------
// Per-language fixtures. All DERIVED. Each carries a documented, visible,
// scalar-returning free function so that no leg's testability classifier has
// an honest reason to refuse it: the LANGUAGE gate is then the only thing
// under measurement.
// ---------------------------------------------------------------------------

const fence = (lang, body) => "```" + lang + "\n" + body + "\n```";

const GO_REPLY = fence(
  "go",
  `func TestAggregateFanoutHappy(t *testing.T) {
	got := AggregateFanout(3)
	want := ${GUESS}
	if got != want {
		t.Errorf("AggregateFanout(3) = %d, want %d", got, want)
	}
}`
);

const TS_REPLY = fence(
  "typescript",
  `describe('readOrder', () => {
  it('reads the order total', () => {
    expect(readOrder(3)).toBe(${GUESS});
  });
});`
);

const PY_REPLY = fence(
  "python",
  `def test_read_order_happy():
    assert read_order(3) == ${GUESS}`
);

const CS_REPLY = fence(
  "csharp",
  `[TestMethod]
public void ReadOrderHappy()
{
    Assert.AreEqual(${GUESS}, Ledger.ReadOrder(3));
}`
);

const LANGS = [
  {
    id: "go",
    displayRe: /\bgo\b|golang/i,
    file: GO_FILE,
    text: GO_SRC,
    cursorNeedle: "\treturn 0",
    reply: () => GO_REPLY,
    symbols: (text) => {
      const sig = posOf(text, "func AggregateFanout");
      const nameCh = text.split("\n")[sig.line].indexOf("AggregateFanout");
      return [dsym("AggregateFanout", 11, vr(sig.line - 1, 0, sig.line + 2, 1), vr(sig.line, nameCh, sig.line, nameCh + "AggregateFanout".length))];
    },
  },
  {
    id: "typescript",
    displayRe: /typescript/i,
    file: TS_FILE,
    text: TS_SRC,
    cursorNeedle: "\treturn 0;",
    reply: () => TS_REPLY,
    symbols: (text) => {
      const sig = posOf(text, "export function readOrder");
      const nameCh = text.split("\n")[sig.line].indexOf("readOrder");
      return [dsym("readOrder", 11, vr(sig.line - 1, 0, sig.line + 2, 1), vr(sig.line, nameCh, sig.line, nameCh + "readOrder".length))];
    },
  },
  {
    id: "python",
    displayRe: /python/i,
    file: PY_FILE,
    text: PY_SRC,
    cursorNeedle: "    return 0",
    reply: () => PY_REPLY,
    symbols: (text) => {
      const sig = posOf(text, "def read_order");
      const nameCh = text.split("\n")[sig.line].indexOf("read_order");
      return [dsym("read_order", 11, vr(sig.line - 1, 0, sig.line + 2, 12), vr(sig.line, nameCh, sig.line, nameCh + "read_order".length))];
    },
  },
  {
    id: "csharp",
    displayRe: /csharp|c#/i,
    file: CS_FILE,
    text: CS_SRC,
    cursorNeedle: "            return 0;",
    reply: () => CS_REPLY,
    symbols: (text) => {
      const ns = posOf(text, "namespace Orders");
      const cls = posOf(text, "public class Ledger");
      const sig = posOf(text, "public static int ReadOrder");
      const nameCh = text.split("\n")[sig.line].indexOf("ReadOrder");
      const last = text.split("\n").length - 1;
      return [
        dsym("Orders", 2, vr(ns.line, 0, last, 1), vr(ns.line, 10, ns.line, 16), [
          dsym("Ledger", 4, vr(cls.line, 0, last - 1, 5), vr(cls.line, 17, cls.line, 23), [
            dsym("ReadOrder", 5, vr(sig.line - 1, 0, sig.line + 3, 9), vr(sig.line, nameCh, sig.line, nameCh + "ReadOrder".length)),
          ]),
        ]),
      ];
    },
  },
];

// The unregistered language. It must be refused BY NAME.
const RUBY = {
  id: "ruby",
  displayRe: /ruby/i,
  file: RB_FILE,
  text: RB_SRC,
  cursorNeedle: "  0",
  symbols: (text) => {
    const sig = posOf(text, "def read_order");
    const nameCh = text.split("\n")[sig.line].indexOf("read_order");
    return [dsym("read_order", 11, vr(sig.line - 1, 0, sig.line + 2, 3), vr(sig.line, nameCh, sig.line, nameCh + "read_order".length))];
  },
};

const docFor = (lang) => makeDoc(lang.text, lang.file, lang.id);
const cursorFor = (lang) => posOf(lang.text, lang.cursorNeedle);

const driveGen = (lang, extra = {}) => {
  const doc = docFor(lang);
  return driveSettled("column80.generateTests", {
    doc,
    cursor: cursorFor(lang),
    handlers: emptyHandlers(lang.symbols(lang.text)),
    docs: { ["file://" + lang.file]: doc },
    reply: lang.reply ? lang.reply : undefined,
    ...extra,
  });
};

// One memoized gate drive per language; every gate row reads the same drive.
const gateDriveP = {};
const driveGate = (lang) => (gateDriveP[lang.id] ||= driveGen(lang, { answer: answerReject }));

const rubyGenP = { gen: null, run: null };
const driveRuby = (commandId) => {
  const key = commandId === "column80.generateTests" ? "gen" : "run";
  return (rubyGenP[key] ||= (async () => {
    const doc = docFor(RUBY);
    return driveSettled(commandId, {
      doc,
      cursor: cursorFor(RUBY),
      handlers: emptyHandlers(RUBY.symbols(RUBY.text)),
      docs: { ["file://" + RUBY.file]: doc },
    });
  })());
};

// A refusal that blames the LANGUAGE, structurally: it names the language AND
// says the gesture does not exist for it. The four registered languages must
// produce none; ruby must produce one.
const LANGUAGE_REFUSAL = /(rust-only|only supports?|not supported|unsupported|no (tdd|test)[^.]*\b(for|in)\b|has no (registered )?(leg|support)|not registered|does not support)/i;
const blamesLanguage = (text, displayRe) => displayRe.test(text) && LANGUAGE_REFUSAL.test(text);
// ===========================================================================
// A second, core-level bundle for the attacks that do not need a running
// extension: the D5 floor per framework, the prompt, and the reply guard.
// ===========================================================================

const { bundleCore } = require("./.blind-util.cjs");

const core = bundleCore(
  "review-v31-phase6-core",
  `export { tddLangFor, tddLanguageIds, blankExpectedValues } from "../src/core/tddLang";\n` +
    `export { blankTestModule, rustUnresolvedAssertions } from "../src/core/testAssembly";\n` +
    `export { runFrameworkTestsAt } from "../src/core/compilerOracle";\n` +
    `export { goUnresolvedAssertions, goExpectedValueSpans } from "../src/core/tddGo";\n` +
    `export { tsUnresolvedAssertions, tsExpectedValueSpans } from "../src/core/tddTs";\n` +
    `export { pytestUnresolvedAssertions, unittestUnresolvedAssertions, pytestExpectedValueSpans, unittestExpectedValueSpans } from "../src/core/tddPy";\n` +
    `export { mstestUnresolvedAssertions, xunitUnresolvedAssertions, nunitUnresolvedAssertions, mstestExpectedValueSpans, xunitExpectedValueSpans, nunitExpectedValueSpans } from "../src/core/tddCs";\n` +
    `export { assembleTestGenPrompt } from "../src/core/prompt";\n` +
    `export { extractTestFunctions, extractTestModule } from "../src/core/instructPostprocess";\n`
);
const C = core.mod;
test.after(() => core.cleanup());

const frameworkById = (languageId, id) => {
  const lang = C.tddLangFor(languageId);
  assert.ok(lang, `tddLangFor(${languageId})`);
  const f = lang.frameworks.find((x) => x.id === id);
  assert.ok(f, `${languageId} has no framework ${id}`);
  return f;
};

// ===========================================================================
// ATTACK 4. scraps D5, the all-or-nothing floor, per framework.
//
// Two questions per framework: does a module mixing a resolvable and an
// UNRESOLVABLE assertion get refused, and does a fully resolvable module get
// through? A floor that refuses everything is worse than no floor.
// ===========================================================================

// Each entry: a module every locator resolves completely, and a module mixing
// one resolvable assertion with one the locator cannot place.
const D5 = [
  {
    what: "rust/libtest",
    lang: "rust",
    fw: "libtest",
    clean: `#[test]\nfn a() { assert_eq!(add(2, 2), 4); }\n#[test]\nfn b() { assert_eq!(add(1, 1), 2); }`,
    mixed: `#[test]\nfn a() { assert_eq!(add(2, 2), 4); }\n#[test]\nfn b() { assert_eq!(add(1, 1)); }`,
  },
  {
    what: "go/gotest",
    lang: "go",
    fw: "gotest",
    clean:
      `func TestA(t *testing.T) {\n\tgot := Add(2, 2)\n\twant := 4\n\tif got != want { t.Errorf("x") }\n}\n` +
      `func TestB(t *testing.T) {\n\tgot := Add(1, 1)\n\twant := 2\n\tif got != want { t.Errorf("x") }\n}`,
    mixed:
      `func TestA(t *testing.T) {\n\tgot := Add(2, 2)\n\twant := 4\n\tif got != want { t.Errorf("x") }\n}\n` +
      `func TestB(t *testing.T) {\n\tgot := Add(1, 1)\n\tvar want = 2\n\tif got != want { t.Errorf("x") }\n}`,
  },
  {
    what: "typescript/vitest",
    lang: "typescript",
    fw: "vitest",
    clean: `it('a', () => { expect(add(2, 2)).toBe(4); });\nit('b', () => { expect(add(1, 1)).toBe(2); });`,
    mixed: `it('a', () => { expect(add(2, 2)).toBe(4); });\nit('b', () => { expect(add(1, 1)).toBeGreaterThan(1); });`,
  },
  {
    what: "python/pytest",
    lang: "python",
    fw: "pytest",
    clean: `def test_a():\n    assert add(2, 2) == 4\n\ndef test_b():\n    assert add(1, 1) == 2`,
    mixed: `def test_a():\n    assert add(2, 2) == 4\n\ndef test_b():\n    assert add(1, 1) != 3`,
  },
  {
    what: "python/unittest",
    lang: "python",
    fw: "unittest",
    clean:
      `class T(unittest.TestCase):\n    def test_a(self):\n        self.assertEqual(add(2, 2), 4)\n` +
      `    def test_b(self):\n        self.assertEqual(add(1, 1), 2)`,
    mixed:
      `class T(unittest.TestCase):\n    def test_a(self):\n        self.assertEqual(add(2, 2), 4)\n` +
      `    def test_b(self):\n        self.assertNotEqual(add(1, 1), 3)`,
  },
  {
    what: "csharp/mstest",
    lang: "csharp",
    fw: "mstest",
    clean: `[TestMethod]\npublic void A() { Assert.AreEqual(4, Add(2, 2)); }\n[TestMethod]\npublic void B() { Assert.AreEqual(2, Add(1, 1)); }`,
    mixed: `[TestMethod]\npublic void A() { Assert.AreEqual(4, Add(2, 2)); }\n[TestMethod]\npublic void B() { Assert.AreEqual(Add(1, 1)); }`,
  },
  {
    what: "csharp/xunit",
    lang: "csharp",
    fw: "xunit",
    clean: `[Fact]\npublic void A() { Assert.Equal(4, Add(2, 2)); }\n[Fact]\npublic void B() { Assert.Equal(2, Add(1, 1)); }`,
    mixed: `[Fact]\npublic void A() { Assert.Equal(4, Add(2, 2)); }\n[Fact]\npublic void B() { Assert.Equal(Add(1, 1)); }`,
  },
  {
    what: "csharp/nunit",
    lang: "csharp",
    fw: "nunit",
    clean: `[Test]\npublic void A() { Assert.That(Add(2, 2), Is.EqualTo(4)); }\n[Test]\npublic void B() { Assert.That(Add(1, 1), Is.EqualTo(2)); }`,
    mixed: `[Test]\npublic void A() { Assert.That(Add(2, 2), Is.EqualTo(4)); }\n[Test]\npublic void B() { Assert.That(Add(1, 1), Is.GreaterThan(1)); }`,
  },
];

for (const d of D5) {
  test(`D5 (${d.what}): every framework declares unresolvedAssertions, or the floor is not there at all`, () => {
    const f = frameworkById(d.lang, d.fw);
    assert.strictEqual(typeof f.unresolvedAssertions, "function", `${d.fw} declares no unresolvedAssertions`);
  });

  test(`D5 (${d.what}): a FULLY resolvable module is NOT refused - a floor that refuses everything is worse than no floor`, () => {
    const f = frameworkById(d.lang, d.fw);
    const spans = f.expectedValueSpans(d.clean);
    const n = f.unresolvedAssertions(d.clean);
    assert.ok(spans.length >= 2, `sanity: the locator must resolve both assertions, got ${spans.length}. TEXT:\n${d.clean}`);
    assert.strictEqual(n, 0, `a module the locator fully resolved was reported as carrying ${n} unresolved site(s), so the whole pass is refused. TEXT:\n${d.clean}`);
  });

  test(`D5 (${d.what}): a module MIXING a resolvable and an unresolvable assertion refuses the WHOLE pass`, () => {
    const f = frameworkById(d.lang, d.fw);
    const spans = f.expectedValueSpans(d.mixed);
    const n = f.unresolvedAssertions(d.mixed);
    assert.ok(spans.length >= 1, `sanity: the OTHER assertion still produces a hole, which is exactly why a holes-only floor is blind. TEXT:\n${d.mixed}`);
    assert.ok(n > 0, `the locator produced ${spans.length} span(s) and reported ${n} unresolved: the model's guessed value ships beside the blanked one. TEXT:\n${d.mixed}`);
  });
}

// The fail-open shapes the floor does not see. Each of these is the D5 failure
// mode verbatim: the OTHER assertion produces a hole, so blanked.holes > 0, and
// unresolvedAssertions says zero, so the consumer inserts a pass with the
// model's guessed expected value standing unblanked in it.
const FAIL_OPEN = [
  {
    what: "csharp/nunit, NUnit's own CLASSIC assertion model",
    lang: "csharp",
    fw: "nunit",
    guess: "4242424",
    text: `[Test]\npublic void A() { Assert.That(Add(2, 2), Is.EqualTo(4)); }\n[Test]\npublic void B() { Assert.AreEqual(4242424, Add(1, 1)); }`,
  },
  {
    what: "csharp/mstest, CollectionAssert",
    lang: "csharp",
    fw: "mstest",
    guess: "4242424",
    text: `[TestMethod]\npublic void A() { Assert.AreEqual(4, Add(2, 2)); }\n[TestMethod]\npublic void B() { CollectionAssert.AreEqual(new[] { 4242424 }, Widen(1)); }`,
  },
  {
    what: "csharp/mstest, StringAssert",
    lang: "csharp",
    fw: "mstest",
    guess: "abc-4242424",
    text: `[TestMethod]\npublic void A() { Assert.AreEqual(4, Add(2, 2)); }\n[TestMethod]\npublic void B() { StringAssert.StartsWith(Name(1), "abc-4242424"); }`,
  },
];

for (const f of FAIL_OPEN) {
  test(`D5 fail-open (${f.what}): a walked-past assertion carrying a guessed value is neither blanked nor counted`, () => {
    const fw = frameworkById(f.lang, f.fw);
    const spans = fw.expectedValueSpans(f.text);
    const n = fw.unresolvedAssertions(f.text);
    const blanked = spans.map((s) => f.text.slice(s.start, s.end));
    assert.ok(spans.length >= 1, "sanity: the first assertion is resolved, so holes > 0 and the zero-hole floor passes");
    assert.ok(
      !blanked.some((b) => b.includes(f.guess)),
      `sanity: the guess is NOT one of the blanked spans (blanked: ${JSON.stringify(blanked)})`
    );
    assert.ok(
      n > 0,
      `the guessed value ${f.guess} is neither blanked (spans: ${JSON.stringify(blanked)}) nor counted as unresolved (count ${n}), ` +
        `so the consumer inserts it into the human's file. TEXT:\n${f.text}`
    );
  });
}

// Over-refusal: ordinary idioms of each language that carry a value the locator
// does not place, so the floor refuses a pass that is otherwise perfectly good.
const OVER_REFUSE = [
  {
    what: "go/gotest, a TestMain the module legitimately declares",
    lang: "go",
    fw: "gotest",
    text:
      `func TestMain(m *testing.M) {\n\tos.Exit(m.Run())\n}\n` +
      `func TestA(t *testing.T) {\n\tgot := Add(2, 2)\n\twant := 4\n\tif got != want { t.Errorf("x") }\n}`,
  },
  {
    what: "typescript/vitest, toBeGreaterThan",
    lang: "typescript",
    fw: "vitest",
    text: `it('a', () => { expect(add(2, 2)).toBe(4); });\nit('b', () => { expect(count()).toBeGreaterThan(0); });`,
    deliberate:
      "`toBeGreaterThan(0)` carries an expected value the locator cannot place, so counting it is the " +
      "documented unknown-matcher-is-a-miss rule. Loop 2 kept it: over-refusing is the safe direction, and " +
      "the alternative is the model's guess shipping unblanked.",
  },
  {
    what: "python/pytest, assert len(x) > 0",
    lang: "python",
    fw: "pytest",
    text: `def test_a():\n    assert add(2, 2) == 4\n\ndef test_b():\n    assert len(items()) > 0`,
    deliberate:
      "`>` is in PY_UNRESOLVED_COMPARISONS by design: it carries an expected `0` the locator does not " +
      "blank. Loop 2 kept it, for the same reason as the vitest row.",
  },
  {
    what: "csharp/nunit, Is.Not.Null",
    lang: "csharp",
    fw: "nunit",
    text: `[Test]\npublic void A() { Assert.That(Add(2, 2), Is.EqualTo(4)); }\n[Test]\npublic void B() { Assert.That(Name(1), Is.Not.Null); }`,
    deliberate:
      "nunitUnresolvedAssertions documents this: telling `Is.Not.Null` (no value) from `Is.GreaterThan(0)` " +
      "(a value) needs the constraint vocabulary this leg does not model, so both count. Loop 2 kept it.",
  },
];

for (const o of OVER_REFUSE) {
  test(`D5 over-refusal (${o.what}): an ordinary idiom of the language refuses the WHOLE pass`, (ctx) => {
    // A DELIBERATE, documented over-refusal is not a defect to force green. The
    // row stays here, named and skipped with its reason, so the decision is
    // readable rather than deleted.
    if (o.deliberate) {
      return ctx.skip(`deliberate over-refusal, ratified in loop 2: ${o.deliberate}`);
    }
    const fw = frameworkById(o.lang, o.fw);
    const n = fw.unresolvedAssertions(o.text);
    assert.strictEqual(
      n,
      0,
      `the floor reports ${n} unresolved site(s) on a module whose only expected value the locator DID resolve, ` +
        `so nothing is written and the human is told the pass could not be blanked. TEXT:\n${o.text}`
    );
  });
}

// ===========================================================================
// ATTACK 2. The four no-run sentences, and Rust's byte-freeze inside them.
// ===========================================================================

test("no-run: classifiesBuildError is set on every framework whose parse names its own build errors, and ABSENT on cargo", () => {
  const rows = [];
  for (const id of C.tddLanguageIds()) {
    for (const f of C.tddLangFor(id).frameworks) rows.push([id, f.id, f.classifiesBuildError]);
  }
  const libtest = rows.filter((r) => r[1] === "libtest");
  assert.ok(libtest.length > 0, "libtest must be registered");
  for (const r of libtest) {
    assert.strictEqual(r[2], undefined, `cargo's compile error IS stderr, so libtest must not classify: ${JSON.stringify(r)}`);
  }
  for (const r of rows.filter((x) => x[1] !== "libtest")) {
    assert.strictEqual(r[2], true, `${r[1]} takes the unclassified sentence only when it says it classifies: ${JSON.stringify(r)}`);
  }
});

// ===========================================================================
// ATTACK 3. The prompt and the reply guard, which the contract never mentioned.
// ===========================================================================

test("prompt: the RUST branch is byte-identical to the pre-phase-6 assembler (differential, against 73b85a7's own bytes)", () => {
  const os2 = require("os");
  const dir = fs.mkdtempSync(path.join(os2.tmpdir(), "review-v31-oldprompt-"));
  // THE BASELINE IS A COMMITTED FIXTURE, not a git revision (2026-08-10). It
  // used to be `git show 73b85a7:src/core/prompt.ts`, which meant the row only
  // ran where that object happened to be reachable: it survived a shallow
  // clone by luck and died the moment the history was rewritten. The bytes are
  // the parent of the phase-6 commit, vendored, so the differential runs on any
  // clone forever. Same evidence, no dependency on what git happens to hold.
  const old = fs.readFileSync(path.join(__dirname, "fixtures", "prompt", "pre-v31-phase6.ts"), "utf8");
  fs.writeFileSync(path.join(dir, "prompt.ts"), old);
  // The one relative import, stubbed: nothing on the test-gen path calls it.
  fs.writeFileSync(path.join(dir, "punt.ts"), `export function noPuntInstructionFor(_k: string): string { return ""; }\n`);
  fs.writeFileSync(path.join(dir, "entry.ts"), `export { assembleTestGenPrompt } from "./prompt";\n`);
  const outfile = path.join(dir, "bundle.cjs");
  esbuild.buildSync({ entryPoints: [path.join(dir, "entry.ts")], bundle: true, outfile, format: "cjs", platform: "node" });
  const before = require(outfile).assembleTestGenPrompt;

  const inputs = [
    { signature: "pub fn widen(n: i32) -> i64", docComment: "/// Widens." },
    { signature: "pub fn widen(n: i32) -> i64", docComment: "/// Widens.", languageId: "rust" },
    { signature: "pub fn widen(n: i32) -> i64", docComment: "/// Widens.", languageId: "rust", calleeSurface: "pub struct P;" },
    { signature: "pub fn widen(n: i32) -> i64", calleeSurface: "pub struct P;" },
  ];
  for (const i of inputs) {
    assert.strictEqual(
      C.assembleTestGenPrompt(i),
      before(i),
      `the Rust test-gen prompt moved for input ${JSON.stringify(i)}`
    );
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

// Each leg's own reply shape, as the blind harness's fixtures spell it, must
// survive the guard the phase 6 service now applies to it. A guard that rejects
// its own leg's reply shape is the failure mode.
const GUARD_SHAPES = [
  ["go", `func TestA(t *testing.T) {\n\tgot := Add(2, 2)\n\twant := 4\n\tif got != want { t.Errorf("x") }\n}`],
  ["typescript", `describe('add', () => {\n  it('adds', () => { expect(add(2, 2)).toBe(4); });\n});`],
  ["typescriptreact", `describe('add', () => {\n  it('adds', () => { expect(add(2, 2)).toBe(4); });\n});`],
  ["javascript", `describe('add', () => {\n  test('adds', () => { expect(add(2, 2)).toBe(4); });\n});`],
  ["javascriptreact", `it('adds', () => { expect(add(2, 2)).toBe(4); });`],
  ["python", `def test_add():\n    assert add(2, 2) == 4`],
  ["python-unittest", `class T(unittest.TestCase):\n    def test_add(self):\n        self.assertEqual(add(2, 2), 4)`],
  ["csharp", `[TestMethod]\npublic void Adds()\n{\n    Assert.AreEqual(4, Add(2, 2));\n}`],
  ["csharp-xunit", `[Fact]\npublic void Adds()\n{\n    Assert.Equal(4, Add(2, 2));\n}`],
  ["csharp-nunit", `[Test]\npublic void Adds()\n{\n    Assert.That(Add(2, 2), Is.EqualTo(4));\n}`],
];

for (const [tag, body] of GUARD_SHAPES) {
  const languageId = tag.split("-")[0];
  test(`guard (${tag}): the reply shape this leg's own scaffold and locator need survives extractTestFunctions`, () => {
    const reply = "```" + languageId + "\n" + body + "\n```";
    const got = C.extractTestFunctions(reply, languageId);
    assert.ok(got !== undefined, `the guard rejected its own leg's reply shape, so the gesture reports "generation does not contain ${languageId} test functions". REPLY:\n${reply}`);
    assert.ok(got.testCount >= 1, `testCount was ${got.testCount}`);
  });
}

test("prompt (python/unittest): the reply-shape clause and the resolved framework's assertion idiom contradict each other in one prompt", () => {
  const unittest = frameworkById("python", "unittest");
  const prompt = C.assembleTestGenPrompt({
    signature: "def add(a: int, b: int) -> int",
    docComment: "Adds.",
    languageId: "python",
    languageName: "Python",
    assertionInstruction: unittest.assertionInstruction,
  });
  const demandsBare = /ONLY top-level `def test_\.\.\.\(\):` functions and nothing else/.test(prompt);
  const demandsClass = /class deriving from `unittest\.TestCase`/.test(prompt);
  assert.ok(
    !(demandsBare && demandsClass),
    `one prompt tells the model to emit ONLY top-level test functions and nothing else, and also to put every test on a unittest.TestCase class. ` +
      `A model that obeys the shape clause emits bare functions, which python -m unittest does not collect and whose asserts unittestExpectedValueSpans cannot blank. PROMPT:\n${prompt}`
  );
});

test("prompt (python/unittest): a shape-obedient reply produces ZERO blankable spans, so the whole pass is refused", () => {
  const unittest = frameworkById("python", "unittest");
  const obedient = `def test_add():\n    assert add(2, 2) == 4\n\ndef test_add_zero():\n    assert add(0, 0) == 0`;
  const spans = unittest.expectedValueSpans(obedient);
  assert.ok(
    spans.length > 0,
    `the reply shape the prompt asks for yields ${spans.length} expected-value spans under the unittest locator, so the consumer's zero-hole floor refuses the pass and nothing is ever written. REPLY:\n${obedient}`
  );
});

test("prompt: every registered languageId gets a reply-shape clause of its own, not the generic fallback", () => {
  const generic = "Reply with ONE fenced code block containing ONLY the test functions and nothing else";
  const onGeneric = [];
  for (const id of C.tddLanguageIds()) {
    if (id === "rust") continue;
    const p = C.assembleTestGenPrompt({ signature: "f", docComment: "d", languageId: id, languageName: id, assertionInstruction: "x" });
    if (p.includes(generic)) onGeneric.push(id);
  }
  assert.deepStrictEqual(
    onGeneric,
    [],
    `these registered languageIds fall back to the generic reply shape while their sibling ids get a specific one: ${JSON.stringify(onGeneric)}`
  );
});

// ===========================================================================
// ATTACK 5. placementWithoutProject, declared only by Rust.
// ===========================================================================

test("placementWithoutProject: ONLY rust declares it, so no other leg can author over a placement refusal", () => {
  const declaring = C.tddLanguageIds().filter((id) => typeof C.tddLangFor(id).placementWithoutProject === "function");
  assert.deepStrictEqual(declaring, ["rust"], `legs declaring the escape hatch: ${JSON.stringify(declaring)}`);
});

test("placementWithoutProject: rust's fallback reports the target as EXISTING, so it can never reach the file-creating write path", () => {
  const p = C.tddLangFor("rust").placementWithoutProject("/nowhere/lib.rs");
  assert.strictEqual(p.exists, true, "a false here would send Rust down the new-file write path, which Rust has never had");
  assert.strictEqual(p.mode, "same-file");
  assert.strictEqual(p.targetPath, "/nowhere/lib.rs");
});

// ===========================================================================
// ATTACK 6. tddLanguageIds() and package.json (scraps D4).
// ===========================================================================

const PKG2 = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
const declaredIdsFor = (commandId) => {
  const ids = new Set();
  const push = (when) => {
    for (const m of String(when).matchAll(/resourceLangId\s*==\s*['"]?([A-Za-z0-9_+#-]+)['"]?/g)) ids.add(m[1]);
  };
  for (const c of PKG2.contributes.commands || []) {
    if (c.command === commandId) {
      if (c.when) push(c.when);
      if (c.enablement) push(c.enablement);
    }
  }
  for (const key of Object.keys(PKG2.contributes.menus || {})) {
    for (const item of PKG2.contributes.menus[key] || []) {
      if (item.command === commandId && item.when) push(item.when);
    }
  }
  return [...ids].sort();
};

for (const commandId of ["column80.generateTests", "column80.runTddTests"]) {
  test(`D4 (${commandId}): package.json's declared id set is EXACTLY tddLanguageIds(), compared directly rather than by probing a hand-kept candidate list`, () => {
    assert.deepStrictEqual(declaredIdsFor(commandId), [...C.tddLanguageIds()].sort());
  });
}

// ===========================================================================
// ATTACK 9. The differential pin on blankTestModule, widened.
// ===========================================================================

test("the WIRED blanker matches blankTestModule on inputs carrying snippet-active characters, which the shipped differential pin does not cover", () => {
  const lang = C.tddLangFor("rust");
  const fw = lang.frameworks[0];
  const cases = [
    `assert_eq!(fmt(1), "cost is $5");`,
    `assert_eq!(fmt(1), "a \\\\ b");`,
    `assert_eq!(fmt(1), "\${rate}");`,
    `#[test]\nfn a() { assert_eq!(add(2, 2), 4); }\n#[test]\nfn b() { assert_eq!(add(1, 1), 2); }`,
  ];
  for (const text of cases) {
    const shipped = C.blankTestModule(text, "i32");
    const wired = C.blankExpectedValues(lang, fw, text, "i32");
    assert.strictEqual(wired.snippet, shipped.snippet, `wired vs blankTestModule diverged on:\n${text}`);
    assert.strictEqual(wired.holes, shipped.holes, `hole count diverged on:\n${text}`);
  }
});

// ===========================================================================
// ATTACK 1. The third write path, driven through the real command.
// ===========================================================================

const clearGoTest = () => {
  try { fs.rmSync(GO_TEST_FILE, { force: true }); } catch {}
};

const GO = LANGS.find((l) => l.id === "go");

gtest("write path (accept): the target file APPEARING between the preview and the accept is silently truncated - the human consented to a create, not to a clobber", async () => {
  clearGoTest();
  const SENTINEL = "// the human's own tests, written while the diff tab was open\nfunc TestHuman(t *testing.T) {}\n";
  let planted = false;
  const answer = (kind, message, actions) => {
    if (/create/i.test(String(message)) && !planted) {
      // Between the preview opening and the human answering it, the file
      // appears: another tool, another window, the human's own hand.
      fs.writeFileSync(GO_TEST_FILE, "package atlas\n\n" + SENTINEL);
      planted = true;
    }
    return (actions || []).find((a) => ACCEPT_RE.test(labelOf(a)));
  };
  const r = await driveGen(GO, { answer });
  const onDisk = fs.existsSync(GO_TEST_FILE) ? fs.readFileSync(GO_TEST_FILE, "utf8") : "(no file)";
  assert.ok(planted, `the create prompt never appeared, so the race could not be staged. ${diag()}`);
  assert.ok(
    onDisk.includes("TestHuman"),
    `the accept wrote an empty file over content that appeared after the preview. ` +
      `ON DISK NOW: ${JSON.stringify(onDisk)}. MESSAGES: ${JSON.stringify(r.texts)}`
  );
  clearGoTest();
});

gtest("write path (accept): nothing warns the human that the file they are about to create already exists", async () => {
  clearGoTest();
  let planted = false;
  const answer = (kind, message, actions) => {
    if (/create/i.test(String(message)) && !planted) {
      fs.writeFileSync(GO_TEST_FILE, "package atlas\n\nfunc TestHuman(t *testing.T) {}\n");
      planted = true;
    }
    return (actions || []).find((a) => ACCEPT_RE.test(labelOf(a)));
  };
  const r = await driveGen(GO, { answer });
  const warned = r.texts.some((t) => /already exists|overwrit|replac|clobber/i.test(t));
  assert.ok(warned, `no message mentions that the target already existed. MESSAGES: ${JSON.stringify(r.texts)}`);
  clearGoTest();
});

gtest("write path: the model's guessed expected value never reaches the OUTPUT CHANNEL either, which is a surface the human reads", async () => {
  clearGoTest();
  const r = await driveGen(GO, { answer: answerAccept });
  const leaks = r.logs.filter((l) => l.includes(GUESS));
  assert.deepStrictEqual(leaks, [], `the guess appears on the evidence channel: ${JSON.stringify(leaks)}`);
  clearGoTest();
});

gtest("write path (reject): no untitled document is opened - the fallback affordance was not the one that shipped", async () => {
  clearGoTest();
  await driveGen(GO, { answer: answerReject });
  const untitled = __state.openedDocs.filter((d) => d.key === "untitled");
  assert.deepStrictEqual(untitled, [], `reject opened an untitled document: ${JSON.stringify(untitled)}`);
  assert.strictEqual(fs.existsSync(GO_TEST_FILE), false, "and no file on disk");
});

gtest("write path (reject): the directory the target would live in is not created either", async () => {
  clearGoTest();
  const r = await driveGen(GO, { answer: answerReject });
  const dirWrites = r.fsWrites.filter((w) => w.how === "workspace.fs.createDirectory");
  assert.deepStrictEqual(dirWrites, [], `reject created directories: ${JSON.stringify(dirWrites)}`);
});

// ===========================================================================
// ATTACK 7. The whole-file review gate, by SHAPE.
// ===========================================================================

const diffCalls = () => __state.executeCalls.filter((c) => String(c.id) === "vscode.diff");

gtest("review gate: a SMALL APPEND into an existing test file is NOT previewed - an over-eager gate that previews every append is its own defect", async () => {
  clearGoTest();
  // The import the plan would otherwise have to add is already there, so the
  // plan is a narrow append at end of file.
  fs.writeFileSync(
    GO_TEST_FILE,
    `package atlas\n\nimport "testing"\n\nfunc TestExisting(t *testing.T) {\n\t_ = AggregateFanout(1)\n}\n`
  );
  const r = await driveGen(GO, { answer: answerAccept });
  const previews = diffCalls();
  assert.deepStrictEqual(
    previews.map((c) => String(c.args && c.args[2])),
    [],
    `a plain append opened a diff review. MESSAGES: ${JSON.stringify(r.texts)}`
  );
  assert.ok(r.snippetInserts.length > 0, `the append still has to land. ${diag()}`);
  clearGoTest();
});

gtest("review gate: a plan spanning the WHOLE non-empty test file IS previewed, whatever its mode string says", async () => {
  clearGoTest();
  // No `import "testing"`, so the plan must add one and therefore spans the
  // whole file: the shape the mode string cannot express.
  fs.writeFileSync(GO_TEST_FILE, `package atlas\n\nfunc helper() int { return 1 }\n`);
  const before = fs.readFileSync(GO_TEST_FILE, "utf8");
  const r = await driveGen(GO, { answer: answerReject });
  assert.ok(diffCalls().length > 0, `a whole-file rewrite landed with no diff. MESSAGES: ${JSON.stringify(r.texts)}`);
  assert.strictEqual(fs.readFileSync(GO_TEST_FILE, "utf8"), before, "and rejecting leaves it byte-identical");
  clearGoTest();
});

// ===========================================================================
// ATTACK 2 (continued). The outcome the four sentences do not cover: a run that
// RAN, executed nothing, and is therefore not green under the `passed + failed
// > 0` rule. `reportNoRun` is not reached (res.ran is true) and `res.success` is
// false, so the consumer falls through to the RED-divergence branch.
// ===========================================================================

test("no-run: a run whose tests were all SKIPPED is ran:true and success:false, so it takes neither the four sentences nor the pass", async () => {
  const res = await C.runFrameworkTestsAt(
    {
      id: "fake",
      buildCommand: (p) => ({ command: "true", args: [], cwd: p.runRoot }),
      parseOutput: () => ({
        ran: true,
        cases: [{ name: "test_a", outcome: "ignored" }],
        failures: [],
        passed: 0,
        failed: 0,
        ignored: 1,
        casesComplete: true,
      }),
    },
    { runRoot: "/w" },
    ["test_a"],
    { runCommand: async () => ({ stdout: "", stderr: "", exitCode: 0 }) }
  );
  // The SHAPE this row originally attacked, restated as the thing it is: the
  // parse is right, the green rule is right, and the fifth outcome is real. The
  // original assertion here was `res.failed > 0`, which can only be satisfied by
  // making the parse LIE about a failure that did not happen. What the defect was
  // actually about is what the CONSUMER says, so that is measured below, driven
  // through the real command.
  assert.strictEqual(res.ran, true, "so reportNoRun's four sentences are never reached");
  assert.strictEqual(res.success, false, "and the green rule correctly refuses it");
  assert.strictEqual(res.failed, 0, "nothing failed: every test was skipped");
  assert.strictEqual(res.passed, 0, "and nothing passed either");
});

// The consumer half of the same attack, black-box. The fake `go` reports one
// generated test SKIPPED, which is `ran: true`, `passed + failed === 0`.
const SENTINEL_D = "@@RV31DOLLAR@@";
const SENTINEL_B = "@@RV31BRACE@@";
const SENTINEL_S = "@@RV31SLASH@@";
const resolveSnippet = (value) => {
  let s = String(value);
  s = s.replace(/\\\$/g, SENTINEL_D).replace(/\\\}/g, SENTINEL_B).replace(/\\\\/g, SENTINEL_S);
  s = s.replace(/\$\{(\d+):([^{}]*)\}/g, (_m, _n, d) => (/^\s*(\/\*[\s\S]*?\*\/|#[^\n]*)\s*$/.test(d) ? "1" : d));
  s = s.replace(/\$\{(\d+)\}/g, "1");
  s = s.replace(/\$(\d+)/g, (_m, n) => (n === "0" ? "" : "1"));
  return s.split(SENTINEL_D).join("$").split(SENTINEL_B).join("}").split(SENTINEL_S).join("\\");
};

const GO_TEST_NAME = "TestAggregateFanoutHappy";
let skipRunP;
const driveSkippedRun = () =>
  (skipRunP ||= (async () => {
    clearGoTest();
    // Author the file through the real accept path, so the product's own markers
    // are what the rung scopes to; then resolve the snippet holes to a value.
    const accept = await driveGen(GO, { answer: answerAccept, answerPick: pickAccept });
    let text = fs.existsSync(GO_TEST_FILE) ? fs.readFileSync(GO_TEST_FILE, "utf8") : "";
    const intoTest = accept.snippetInserts.filter((s) => String(s.uri || "").includes("atlas_test.go"));
    if (!text.includes(GO_TEST_NAME) && intoTest.length >= 1) text = resolveSnippet(intoTest[intoTest.length - 1].value);
    if (text.includes("${")) text = resolveSnippet(text);
    assert.ok(
      text.includes(GO_TEST_NAME),
      `the accept path produced no scoped test, so the rung has nothing to run. FILE: ${JSON.stringify(text.slice(0, 400))}`
    );
    fs.writeFileSync(GO_TEST_FILE, text);
    const origPath = process.env.PATH;
    const origMode = process.env.V31_GO_MODE;
    process.env.PATH = FAKEBIN + path.delimiter + origPath;
    process.env.V31_GO_MODE = "skip";
    try {
      const doc = docFor(GO);
      const r = await driveSettled("column80.runTddTests", {
        doc,
        cursor: cursorFor(GO),
        handlers: emptyHandlers(GO.symbols(GO.text)),
        docs: { ["file://" + GO.file]: doc },
        settleMs: 20000,
      });
      return { ...r, reported: r.texts.concat(r.logs).join("\n") };
    } finally {
      process.env.PATH = origPath;
      if (origMode === undefined) delete process.env.V31_GO_MODE;
      else process.env.V31_GO_MODE = origMode;
      clearGoTest();
    }
  })());

gtest("no-run (the fifth outcome): an all-SKIPPED run is not reported as a RED divergence naming zero failures", async () => {
  const r = await driveSkippedRun();
  const read = r.texts.length ? r.texts.join("\n") : r.reported;
  assert.ok(r.texts.length > 0, `an all-skipped run must SAY something. CHANNEL: ${JSON.stringify(r.logs.slice(-14))}`);
  assert.ok(
    !/0 test\(s\) failed/.test(read),
    `a red naming zero failures points the human at an implementation that was never exercised. READ: ${JSON.stringify(read)}`
  );
  assert.ok(
    !/divergence between the ratified tests and the implementation/.test(read),
    `nothing diverged: nothing ran. READ: ${JSON.stringify(read)}`
  );
});

gtest("no-run (the fifth outcome): the human is told the tests were SKIPPED, and it does not read as a pass", async () => {
  const r = await driveSkippedRun();
  const read = r.texts.length ? r.texts.join("\n") : r.reported;
  assert.ok(/skip/i.test(read), `the honest word is SKIPPED. READ: ${JSON.stringify(read)}`);
  const claimsGreen = /(tests? passed|all tests? pass|passed\s*[:=]?\s*[1-9]|succeeded)/i;
  assert.deepStrictEqual(
    r.texts.filter((t) => claimsGreen.test(t)),
    [],
    `zero executed tests is never green: the passed + failed > 0 rule holds. READ: ${JSON.stringify(read)}`
  );
});
