// Blind oracle: session-v31 phase 6, the VS Code wiring.
//
// SUPERSEDES test/blind-derust-tdd.test.cjs, which pins the Rust-only refusal
// as a promise. docs/supersessions.md S2 records that supersession and S3
// records the third document write path this file pins. The old promise is
// deliberately false for four languages once phase 6 lands; the NEW promise
// still has teeth and this file is where it lives:
//
//   a document whose language has NO registered leg is refused BY NAME, makes
//   no model call, and touches no buffer. Only the language list changed.
//
// What this file pins, by contract clause:
//   1. contract-phase6 section 2  - the per-language gate replaces the
//      Rust-only refusal.
//   2. contract-phase6 section 1 / goal.md "Human decision 1" / S3 - the third
//      write path: preview against empty, reject leaves nothing, accept
//      creates + opens + inserts, blank values in the PREVIEW too, a test FILE
//      and never a test PROJECT.
//   3. contract-phase6 section 3 - the four no-run outcomes become four
//      distinct sentences, none of them suggesting a forbidden command, and
//      the `passed + failed > 0` green rule still holding.
//   4. scraps D5 - the zero-hole floor generalised: the locator does not have
//      to be wrong to lie, only silent.
//   5. contract-phase6 section 4 - a whole-file plan is previewed, detected by
//      SHAPE (start === 0 && end === existingText.length over a non-empty
//      file), never by mode string.
//   6. scraps D4 - package.json's `when` clause and tddLangFor's registry are
//      THE SAME SET, pinned in one place.
//   7. contract-phase6 section 4 - snippet escaping: a literal `$` or `${` in
//      generated test text inserts literally, never as a tabstop.
//
// Harness: the blind-derust-tdd pattern. The whole extension is activated
// against a stub vscode, prompts are captured at a fake in-process Ollama
// server, extraction answers ride the stub's commands.executeCommand. Three
// things are added because phase 6's contract is about files:
//
//   - the workspace is a REAL temp directory with real projects in it, so
//     "leaves no file behind" is checked by walking the disk rather than by
//     trusting one channel;
//   - workspace.fs and workspace.applyEdit really write, so a create through
//     any channel is observable the same way;
//   - every surface the human could be SHOWN is recorded (messages, opened
//     documents, content-provider output, diff command arguments), so "the
//     guessed value appears nowhere" is checked against all of them.
//
// Assertions are stable structural properties and substrings, never exact
// human prose. Fixtures are DERIVED from the captures in session-v31/goal.md
// and are labelled as such at each definition. Never reads src/**.
//
// Guard: a missing surface is ONE loud failure and every other row SKIPS.
//
// Run: SKIP_LIVE=1 node --test test/blind-v31-wiring.test.cjs
// (Hermetic: the "server" is in-process, the toolchain is a shell script this
// file writes; no model, no network, no ollama, no go, no dotnet.)

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

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "blind-v31-wiring-"));
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
  *)
    printf '%s\\n' 'V31UNCLASSIFIEDSTDOUT'
    printf '%s\\n' 'V31UNCLASSIFIEDSTDERR' 1>&2
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

const STUB = path.join(__dirname, ".blind-v31-wiring-stub.cjs");
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
      const preset = (globalThis.__V31_DOCS__ || {})[key];
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

const entry = path.join(__dirname, ".blind-v31-wiring.entry.ts");
const outfile = path.join(__dirname, ".blind-v31-wiring.bundle.cjs");
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
  globalThis.__V31_DOCS__ = docs || {};
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
// 1. The per-language gate replaces the Rust-only refusal.
//    [contract-phase6 section 2 + section 5, docs/supersessions.md S2]
// ===========================================================================

for (const lang of LANGS) {
  gtest(`gate (${lang.id}): the Rust-only refusal is GONE - no message says "Rust-only" on a ${lang.id} document [S2 'the TDD gesture stops being Rust-only'; supersedes blind-derust-tdd]`, async () => {
    const { cmdError, texts } = await driveGate(lang);
    assert.strictEqual(cmdError, undefined, `the gesture must settle without crashing, got ${cmdError && cmdError.stack}`);
    assert.ok(
      !texts.some((t) => /Rust-only/i.test(t)),
      `blind-derust-tdd pinned this message as a promise; S2 makes it false for ${lang.id}. MESSAGES: ${JSON.stringify(texts)}`
    );
  });

  gtest(`gate (${lang.id}): the gesture is not refused FOR BEING ${lang.id} - no message blames the language [contract-phase6 section 2 'Resolved: proceed']`, async () => {
    const { texts } = await driveGate(lang);
    const blaming = texts.filter((t) => blamesLanguage(t, lang.displayRe));
    assert.deepStrictEqual(
      blaming,
      [],
      `${lang.id} has a registered leg, so no refusal may name the language as the reason. MESSAGES: ${JSON.stringify(texts)}`
    );
  });

  gtest(`gate (${lang.id}): the gesture reaches the generation service - a resolved leg PROCEEDS rather than refusing quietly [contract-phase6 section 2 'Resolved: proceed']`, async () => {
    const { genRequests, texts, logs } = await driveGate(lang);
    assert.ok(
      genRequests.length >= 1,
      `a documented, visible, scalar-returning free function in ${lang.id} must reach the model once the leg is wired. MESSAGES: ${JSON.stringify(texts)} LOGS: ${JSON.stringify(logs.slice(-10))}`
    );
  });
}

gtest("gate (ruby, generateTests): a language with NO registered leg is refused BY NAME - exactly one message, and it names ruby [contract-phase6 section 2 'Unresolved: refuse by NAMING the language'. Only the language LIST changed; the promise did not]", async () => {
  const { cmdError, messages, texts } = await driveRuby("column80.generateTests");
  assert.strictEqual(cmdError, undefined, `the refusal must settle without crashing, got ${cmdError && cmdError.stack}`);
  assert.strictEqual(
    messages.length,
    1,
    `a refused test-gen shows exactly one message, got ${messages.length}: ${JSON.stringify(texts)}`
  );
  assert.ok(
    messages[0].kind === "warn" || messages[0].kind === "info",
    `the refusal is a warning or information message, not ${JSON.stringify(messages[0].kind)}`
  );
  assert.ok(
    RUBY.displayRe.test(texts[0]),
    `the refusal names the document's language. MESSAGE: ${JSON.stringify(texts[0])}`
  );
  assert.ok(
    !/Rust-only/i.test(texts[0]),
    `after S2 there is no Rust-only gate to name; the refusal is about ruby having no leg. MESSAGE: ${JSON.stringify(texts[0])}`
  );
});

gtest("gate (ruby, generateTests): the refusal is INERT - no model call, no buffer edit, no snippet, no workspace edit [contract-phase6 section 2; the blind-derust-tdd promise, re-cut]", async () => {
  const { genRequests, editorEdits, snippetInserts, appliedEdits, fsWrites } = await driveRuby("column80.generateTests");
  assert.strictEqual(genRequests.length, 0, `a refused test-gen must not reach the model; prompts sent: ${genRequests.length}`);
  assert.strictEqual(editorEdits, 0, "a refused test-gen never edits an editor buffer");
  assert.strictEqual(snippetInserts.length, 0, `a refused test-gen never inserts a snippet: ${JSON.stringify(snippetInserts)}`);
  assert.strictEqual(appliedEdits, 0, "a refused test-gen never applies a workspace edit");
  assert.deepStrictEqual(fsWrites, [], `a refused test-gen never writes a file: ${JSON.stringify(fsWrites)}`);
});

gtest("gate (ruby, generateTests): the refusal does not imply the gesture EXISTS and only a runner is missing [contract-phase6 section 2 'must not imply the gesture exists and only a runner is missing']", async () => {
  const { texts } = await driveRuby("column80.generateTests");
  assert.ok(
    !texts.some((t) => /no test rung|runner (is )?(not|missing)|no (test )?runner|framework (is )?(not )?(configured|installed)/i.test(t)),
    `the refusal is about the LANGUAGE, not about a missing runner. MESSAGES: ${JSON.stringify(texts)}`
  );
});

gtest("gate (ruby, runTddTests): the run half refuses by NAME too, inert, with the same wording rule [contract-phase6 section 2 'Both commands']", async () => {
  const { cmdError, texts, genRequests, appliedEdits, snippetInserts } = await driveRuby("column80.runTddTests");
  assert.strictEqual(cmdError, undefined, `the refusal must settle without crashing, got ${cmdError && cmdError.stack}`);
  assert.ok(texts.length >= 1, `the run half must SAY it refuses. ${diag()}`);
  assert.ok(
    texts.some((t) => RUBY.displayRe.test(t)),
    `the run-tests refusal names the document's language. MESSAGES: ${JSON.stringify(texts)}`
  );
  assert.ok(!texts.some((t) => /Rust-only/i.test(t)), `"Rust-only" is superseded by S2. MESSAGES: ${JSON.stringify(texts)}`);
  assert.strictEqual(genRequests.length, 0, "a refused run must not reach the model");
  assert.strictEqual(appliedEdits, 0, "a refused run never applies a workspace edit");
  assert.strictEqual(snippetInserts.length, 0, "a refused run never inserts a snippet");
});

// ===========================================================================
// 6. The `when` clause and the id set. [contract-phase6 section 2 'Write the
//    set down once, in one place, and pin it'; scraps D4]
//
//    The seam's coverage grew unnoticed once already: `javascriptreact`
//    appeared in the seam without ever being in a contract. These rows make
//    the command palette and the seam ONE set, so neither can drift.
// ===========================================================================

const PKG = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
const TDD_COMMANDS = ["column80.generateTests", "column80.runTddTests"];

// Every languageId the four legs plus Rust could plausibly claim, plus a wide
// negative set. The universe is widened by whatever package.json names, so an
// id nobody predicted still fails this row rather than slipping through.
const CANDIDATE_IDS = [
  "rust", "go", "typescript", "typescriptreact", "javascript", "javascriptreact",
  "python", "csharp", "java", "ruby", "cpp", "c", "php", "kotlin", "swift", "scala",
  "dart", "lua", "perl", "haskell", "elixir", "zig", "fsharp", "vb", "objective-c",
  "objective-cpp", "groovy", "powershell", "shellscript", "sql", "r", "julia",
  "plaintext", "markdown", "json", "jsonc", "yaml", "toml", "xml", "html", "css",
];

const whenClausesFor = (commandId) => {
  const out = [];
  const contributes = PKG.contributes || {};
  for (const c of contributes.commands || []) {
    if (c.command === commandId && typeof c.when === "string") out.push(c.when);
  }
  const menus = contributes.menus || {};
  for (const key of Object.keys(menus)) {
    for (const item of menus[key] || []) {
      if (item.command === commandId && typeof item.when === "string") out.push(item.when);
    }
  }
  return out;
};

const langIdsFromWhen = (when) => {
  const ids = new Set();
  for (const m of when.matchAll(/resourceLangId\s*(?:==|=~)?\s*['"]?([A-Za-z0-9_+#-]+)['"]?/g)) {
    if (m[1] && m[1] !== "resourceLangId") ids.add(m[1]);
  }
  for (const m of when.matchAll(/resourceLangId\s*=~\s*\/([^/]+)\//g)) {
    for (const part of m[1].replace(/[\^$()\\b]/g, "").split("|")) {
      const t = part.trim();
      if (t) ids.add(t);
    }
  }
  ids.delete("resourceLangId");
  return ids;
};

for (const commandId of TDD_COMMANDS) {
  gtest(`when clause (${commandId}): package.json gates the command on resourceLangId - it does not sit in the palette for every file type [contract-phase6 section 2 'package.json gains a when clause. Use resourceLangId']`, () => {
    const clauses = whenClausesFor(commandId);
    assert.ok(
      clauses.length >= 1,
      `${commandId} must carry a when clause in contributes.commands or contributes.menus; found none`
    );
    assert.ok(
      clauses.some((c) => /resourceLangId/.test(c)),
      `the enablement clause must be keyed on resourceLangId. FOUND: ${JSON.stringify(clauses)}`
    );
  });

  gtest(`when clause (${commandId}): the palette's id set and tddLangFor's registry are THE SAME SET - the seam and the command palette cannot drift [scraps D4 'write the set down once, in one place, and pin it']`, () => {
    const clauses = whenClausesFor(commandId);
    if (clauses.length === 0) assert.fail(`${commandId} has no when clause, so the two sets cannot be compared; see the row above`);
    const declared = new Set();
    for (const c of clauses) for (const id of langIdsFromWhen(c)) declared.add(id);
    const universe = new Set([...CANDIDATE_IDS, ...declared]);
    const resolved = new Set([...universe].filter((id) => tddLangFor(id) !== undefined));
    const missingFromPalette = [...resolved].filter((id) => !declared.has(id)).sort();
    const missingFromSeam = [...declared].filter((id) => !resolved.has(id)).sort();
    assert.deepStrictEqual(
      { missingFromPalette, missingFromSeam },
      { missingFromPalette: [], missingFromSeam: [] },
      `tddLangFor resolves ${JSON.stringify([...resolved].sort())} and package.json declares ${JSON.stringify([...declared].sort())}. ` +
        `Ids the seam supports but the palette hides: ${JSON.stringify(missingFromPalette)}. ` +
        `Ids the palette offers but the seam refuses: ${JSON.stringify(missingFromSeam)}.`
    );
  });
}

gtest("when clause: BOTH TDD commands are gated on the same id set - one command palette entry cannot offer a language the other refuses [scraps D4]", () => {
  const sets = TDD_COMMANDS.map((c) => {
    const ids = new Set();
    for (const clause of whenClausesFor(c)) for (const id of langIdsFromWhen(clause)) ids.add(id);
    return [...ids].sort();
  });
  assert.deepStrictEqual(sets[0], sets[1], `generateTests and runTddTests must be gated identically: ${JSON.stringify(sets)}`);
  assert.ok(sets[0].length > 0, "the gated id set is empty, so no when clause was found on either command");
});

gtest("registry: rust plus the four legs resolve, and a language with no leg does not - the id set that phase 6 froze [contract-phase6 section 2 + goal.md 'Human decision 2: all four languages']", () => {
  for (const id of ["rust", "go", "typescript", "python", "csharp"]) {
    assert.ok(tddLangFor(id) !== undefined, `tddLangFor(${JSON.stringify(id)}) must resolve after phase 5`);
  }
  for (const id of ["ruby", "java", "cpp", "plaintext"]) {
    assert.strictEqual(tddLangFor(id), undefined, `tddLangFor(${JSON.stringify(id)}) must stay undefined`);
  }
});

// ===========================================================================
// 2. The third write path. [contract-phase6 section 1, goal.md "Human
//    decision 1: a third write path ships", docs/supersessions.md S3]
//
//    Go is the vehicle: sibling placement, a stdlib rung that always detects,
//    and no framework config to arrange. The fixture is DERIVED.
// ===========================================================================

const BASELINE = snapshot();

const resetFixture = () => {
  for (const rel of walk(ROOT)) {
    const p = path.join(ROOT, rel);
    if (!(rel in BASELINE)) fs.rmSync(p, { force: true });
    else if (fs.readFileSync(p, "utf8") !== BASELINE[rel]) fs.writeFileSync(p, BASELINE[rel]);
  }
};

const GO_LANG = LANGS[0];
const GO_TEST_NAME = "TestAggregateFanoutHappy";
const actionsOffered = (messages) =>
  JSON.stringify(messages.map((m) => ({ kind: m.kind, message: m.message, actions: (m.actions || []).map(labelOf) })));

// One reject drive and one accept drive, memoized; every row below reads one
// of the two.
let rejectDriveP;
const driveReject = () =>
  (rejectDriveP ||= (async () => {
    await harness();
    resetFixture();
    const before = snapshot();
    const r = await driveGen(GO_LANG, { answer: answerReject });
    return { ...r, before, after: snapshot(), delta: diffSnapshot(before, snapshot()) };
  })());

let acceptDriveP;
const driveAccept = () =>
  (acceptDriveP ||= (async () => {
    await driveReject();
    resetFixture();
    const before = snapshot();
    const r = await driveGen(GO_LANG, { answer: answerAccept, answerPick: pickAccept });
    const after = snapshot();
    // Captured HERE, not later: a subsequent drive resets the fixture.
    const createdText = fs.existsSync(GO_TEST_FILE) ? fs.readFileSync(GO_TEST_FILE, "utf8") : undefined;
    return { ...r, before, after, createdText, delta: diffSnapshot(before, after) };
  })());

// A row that asserts "nothing happened" is only worth reading if the gesture
// actually RAN. Every negative row below states that precondition first, so a
// refusal upstream cannot make it pass vacuously.
const assertGestureRan = (r, what) =>
  assert.ok(
    r.genRequests.length >= 1,
    `${what} never reached the model, so this row would pass vacuously. ${diag()} MESSAGES: ${JSON.stringify(r.texts)}`
  );

gtest("write path (preview): the WHOLE new test file is previewed against EMPTY before anything is created [contract-phase6 section 1 'Preview the whole new file as a diff against empty']", async () => {
  const { shown, delta, messages } = await driveReject();
  const previews = shown.filter((s) => s.includes(GO_TEST_NAME));
  assert.ok(
    previews.length >= 1,
    `the human must be SHOWN the generated test before it exists. No shown surface carried ${GO_TEST_NAME}. OFFERED: ${actionsOffered(messages)} SURFACES: ${JSON.stringify(shown.map((s) => s.slice(0, 200)))}`
  );
  assert.ok(
    previews.some((s) => /(^|\n)\s*package\s+atlas\b/.test(s)),
    `the preview is the WHOLE file against empty, so it carries the file's own package declaration, not just the appended region. PREVIEWS: ${JSON.stringify(previews.map((s) => s.slice(0, 400)))}`
  );
  assert.deepStrictEqual(
    delta.created,
    [],
    `nothing is created before the human answers. CREATED: ${JSON.stringify(delta.created)}`
  );
});

gtest("write path (reject): reject writes NOTHING and leaves NO file behind - no created file, no workspace edit, no snippet [contract-phase6 section 1 'Reject writes nothing and leaves no file behind'; S3]", async () => {
  const r = await driveReject();
  const { delta, appliedEdits, snippetInserts, fsWrites, cmdError } = r;
  assertGestureRan(r, "the rejected test-gen");
  assert.strictEqual(cmdError, undefined, `a rejected proposal must settle cleanly, got ${cmdError && cmdError.stack}`);
  assert.strictEqual(fs.existsSync(GO_TEST_FILE), false, "the rejected test file must not exist on disk");
  assert.deepStrictEqual(delta.created, [], `reject creates no file anywhere in the workspace: ${JSON.stringify(delta.created)}`);
  assert.deepStrictEqual(delta.changed, [], `reject changes no existing file: ${JSON.stringify(delta.changed)}`);
  assert.deepStrictEqual(delta.deleted, [], `reject deletes no file: ${JSON.stringify(delta.deleted)}`);
  assert.strictEqual(appliedEdits, 0, "reject applies no workspace edit");
  assert.deepStrictEqual(snippetInserts, [], `reject inserts no snippet: ${JSON.stringify(snippetInserts)}`);
  assert.deepStrictEqual(fsWrites, [], `reject touches no file through any vscode fs channel: ${JSON.stringify(fsWrites)}`);
});

gtest("write path (preview): the expected values are BLANK IN THE PREVIEW TOO - the model's guessed value appears in nothing the human is shown [contract-phase6 section 1 'The expected values are blank in the PREVIEW too'; goal.md 'never appears in a preview either']", async () => {
  const { shown, messages } = await driveReject();
  assert.ok(
    shown.some((s) => s.includes(GO_TEST_NAME)),
    `the preview must be observable for this row to mean anything; it was not. OFFERED: ${actionsOffered(messages)}`
  );
  const leaks = shown.filter((s) => s.includes(GUESS));
  assert.deepStrictEqual(
    leaks.map((s) => s.slice(0, 300)),
    [],
    `the model guessed ${GUESS}; it must not appear anywhere the human looks, including a diff they only read.`
  );
});

gtest("write path (accept): accept CREATES the test file, OPENS it, and inserts the blank-value snippet into it [contract-phase6 section 1 'the file is created, opened, and the blank-value snippet is inserted']", async () => {
  const { delta, snippetInserts, cmdError, messages, shown } = await driveAccept();
  assert.strictEqual(cmdError, undefined, `an accepted proposal must settle cleanly, got ${cmdError && cmdError.stack}`);
  assert.ok(
    fs.existsSync(GO_TEST_FILE),
    `accept creates the sibling test file. CREATED: ${JSON.stringify(delta.created)} OFFERED: ${actionsOffered(messages)}`
  );
  assert.ok(
    __state.shownDocs.some((d) => String(d.key).includes("atlas_test.go")),
    `accept OPENS the file it created, so the human can Tab the holes. OPENED: ${JSON.stringify(__state.shownDocs.map((d) => d.key))}`
  );
  const intoTest = snippetInserts.filter((s) => String(s.uri || "").includes("atlas_test.go"));
  assert.ok(
    intoTest.length >= 1,
    `the blank-value snippet is inserted into the created file, not the source buffer. INSERTS: ${JSON.stringify(snippetInserts.map((s) => ({ uri: s.uri, head: String(s.value).slice(0, 120) })))}`
  );
  assert.ok(
    intoTest.some((s) => /\$\{\d/.test(s.value)),
    `the inserted snippet carries tabstop holes for the human to type into. INSERTS: ${JSON.stringify(intoTest.map((s) => s.value.slice(0, 300)))}`
  );
  assert.ok(shown.length >= 0);
});

gtest("write path (accept): the model's guessed expected value never reaches the buffer or the disk [goal.md 'Constraints that do not move': the human types every expected value]", async () => {
  const r = await driveAccept();
  const { written, after } = r;
  assertGestureRan(r, "the accepted test-gen");
  const inserted = written.filter((s) => s.includes(GUESS));
  assert.deepStrictEqual(inserted.map((s) => s.slice(0, 300)), [], `the guess ${GUESS} must never be inserted`);
  const onDisk = Object.keys(after).filter((rel) => after[rel].includes(GUESS));
  assert.deepStrictEqual(onDisk, [], `the guess ${GUESS} must never land on disk. FILES: ${JSON.stringify(onDisk)}`);
});

gtest("write path (accept): the gesture creates a test FILE and never a test PROJECT, a config file or a manifest [contract-phase6 section 1 boundary + section 6 'Never create a test PROJECT, a config file, a manifest, or install anything']", async () => {
  const r = await driveAccept();
  const { delta } = r;
  assertGestureRan(r, "the accepted test-gen");
  const artefacts = delta.created.concat(delta.changed).filter((rel) => PROJECT_ARTEFACT.test(rel));
  assert.deepStrictEqual(
    artefacts,
    [],
    `the human's boundary is a test FILE only. Created or changed project artefacts: ${JSON.stringify(artefacts)}`
  );
  assert.deepStrictEqual(delta.deleted, [], `the gesture deletes nothing: ${JSON.stringify(delta.deleted)}`);
  const stray = delta.created.filter((rel) => !/_test\.go$/.test(rel));
  assert.deepStrictEqual(
    stray,
    [],
    `accept creates exactly the one sibling test file and nothing else: ${JSON.stringify(delta.created)}`
  );
});

gtest("write path: no message anywhere in the gesture suggests a command the product forbids - never `go get`, never an install [contract-phase6 section 3 'Name the problem and stop' + goal.md 'Never install a framework']", async () => {
  const reject = await driveReject();
  const accept = await driveAccept();
  assertGestureRan(reject, "the rejected test-gen");
  assertGestureRan(accept, "the accepted test-gen");
  const forbidden = /\bgo get\b|\bnpm (i|install|add)\b|\byarn add\b|\bpnpm (i|install|add)\b|\bpip3? install\b|\bdotnet (add|restore|tool install)\b|\bcargo (install|add)\b|\bapt(-get)? install\b|\bbrew install\b/i;
  const offenders = reject.texts.concat(accept.texts).filter((t) => forbidden.test(t));
  assert.deepStrictEqual(offenders, [], `a message suggested a forbidden command: ${JSON.stringify(offenders)}`);
});

// ===========================================================================
// 7. Snippet escaping per language. [contract-phase6 section 4 'Snippet
//    escaping on every new leg': the human's own `$` and `${` must not become
//    tabstops]
// ===========================================================================

// DERIVED fixture: the literal dollars live in the failure message, not in the
// expected value, so the blanker cannot remove them by doing its job.
const GO_REPLY_DOLLARS = fence(
  "go",
  `func TestAggregateFanoutDollars(t *testing.T) {
	got := AggregateFanout(3)
	want := ${GUESS}
	if got != want {
		t.Errorf("cost $5 and \${rate}: got %d want %d", got, want)
	}
}`
);

let dollarDriveP;
const driveDollars = () =>
  (dollarDriveP ||= (async () => {
    await driveAccept();
    resetFixture();
    const r = await driveGen({ ...GO_LANG, reply: () => GO_REPLY_DOLLARS }, { answer: answerAccept, answerPick: pickAccept });
    return r;
  })());

gtest("snippet escaping (go): a literal `$` and `${` in the generated test text insert literally, never as a tabstop [contract-phase6 section 4 'or the human's own $ and ${ become tabstops']", async () => {
  const { snippetInserts, messages } = await driveDollars();
  assert.ok(
    snippetInserts.length >= 1,
    `no snippet was inserted, so the escaping cannot be observed. OFFERED: ${actionsOffered(messages)}`
  );
  const carrying = snippetInserts.filter((s) => /rate|cost/.test(s.value));
  assert.ok(
    carrying.length >= 1,
    `the generated text carrying the literal dollars must reach a snippet. INSERTS: ${JSON.stringify(snippetInserts.map((s) => s.value.slice(0, 300)))}`
  );
  for (const s of carrying) {
    // Remove the escape sequences the snippet grammar defines, then look for
    // anything the grammar would still read as a tabstop or a variable.
    const stripped = s.value.replace(/\\[$}\\]/g, "");
    assert.ok(
      !/\$\{rate\}/.test(stripped),
      `"\${rate}" must be escaped, or VS Code reads it as a snippet variable. SNIPPET: ${JSON.stringify(s.value)}`
    );
    assert.ok(
      !/\$5/.test(stripped),
      `"$5" must be escaped, or VS Code reads it as tabstop 5. SNIPPET: ${JSON.stringify(s.value)}`
    );
  }
});

// ===========================================================================
// 4. The zero-hole floor, generalised. [scraps D5; contract-phase6 section 4
//    'the locator FAILS OPEN and the floor is all-or-nothing']
//
//    The locator does not have to be WRONG to lie, only SILENT. One assertion
//    it cannot resolve still leaves the others producing holes, so a total
//    check passes and the model's guess ships.
// ===========================================================================

// DERIVED fixture: two assertions. The first is the idiom the Go locator is
// built for. The second is `var want = <v>`, named in scraps D5 as a MEASURED
// silent miss in Go and Python. If phase 6 instead teaches the locator this
// shape, this row must be re-cut against a shape that is still silent; the row
// above it, which pins the invariant rather than the mechanism, is the one
// that must hold either way.
const GO_REPLY_FAILOPEN = fence(
  "go",
  `func TestAggregateFanoutHappy(t *testing.T) {
	got := AggregateFanout(3)
	want := ${GUESS}
	if got != want {
		t.Errorf("AggregateFanout(3) = %d, want %d", got, want)
	}
}

func TestAggregateFanoutZero(t *testing.T) {
	got := AggregateFanout(0)
	var want = ${GUESS2}
	if got != want {
		t.Errorf("AggregateFanout(0) = %d, want %d", got, want)
	}
}`
);

let failOpenDriveP;
const driveFailOpen = () =>
  (failOpenDriveP ||= (async () => {
    await driveDollars();
    resetFixture();
    const before = snapshot();
    const r = await driveGen({ ...GO_LANG, reply: () => GO_REPLY_FAILOPEN }, { answer: answerAccept, answerPick: pickAccept });
    const after = snapshot();
    return { ...r, delta: diffSnapshot(before, after) };
  })());

gtest("fail-open floor: the locator does not have to be WRONG to lie, only SILENT - a guess it could not blank never reaches a preview, a buffer or the disk [scraps D5; goal.md item 6 'the human types every expected value']", async () => {
  const r = await driveFailOpen();
  const { shown, written, delta, after } = r;
  assertGestureRan(r, "the fail-open test-gen");
  const leaked = [];
  for (const s of shown) if (s.includes(GUESS2)) leaked.push("shown: " + s.slice(0, 200));
  for (const s of written) if (s.includes(GUESS2)) leaked.push("written: " + s.slice(0, 200));
  for (const rel of delta.created.concat(delta.changed)) if ((after[rel] || "").includes(GUESS2)) leaked.push("disk: " + rel);
  assert.deepStrictEqual(
    leaked,
    [],
    `${GUESS2} is the expected value of an assertion the locator walked but could not resolve. The other assertion still produced a hole, so a total-holes check passes and the guess ships. It must not.`
  );
});

gtest("fail-open floor: a pass in which ANY walked assertion could not be blanked is REFUSED, not inserted [contract-phase6 section 4 'refuse the whole pass when any assertion the locator WALKED could not be resolved to a span']", async () => {
  const r = await driveFailOpen();
  const { delta, snippetInserts, appliedEdits, texts } = r;
  assertGestureRan(r, "the fail-open test-gen");
  assert.deepStrictEqual(
    delta.created,
    [],
    `an unblankable pass creates nothing. CREATED: ${JSON.stringify(delta.created)}`
  );
  assert.deepStrictEqual(snippetInserts, [], `an unblankable pass inserts no snippet: ${JSON.stringify(snippetInserts.map((s) => s.value.slice(0, 200)))}`);
  assert.strictEqual(appliedEdits, 0, "an unblankable pass applies no workspace edit");
  assert.ok(texts.length >= 1, `the refusal must SAY something rather than failing silently. ${diag()}`);
});

// ===========================================================================
// 5. The whole-file plan must be previewed. [contract-phase6 section 4 'The
//    whole-file plan wall': a plan that adds an import spans the whole file
//    and is indistinguishable BY MODE from a small append]
// ===========================================================================

// DERIVED fixture: a hand-written sibling test file with NO import block, so
// adding tests must add `import "testing"`, which makes the plan span the
// whole file. The file is non-empty and the human owns it.
const GO_EXISTING_TEST = `package atlas

// helperExisting is the human's own code and the gesture must not clobber it.
func helperExisting() int {
	return 1
}
`;

let wholeFileDriveP;
const driveWholeFile = () =>
  (wholeFileDriveP ||= (async () => {
    await driveFailOpen();
    resetFixture();
    fs.writeFileSync(GO_TEST_FILE, GO_EXISTING_TEST);
    const before = snapshot();
    const r = await driveGen(GO_LANG, { answer: answerReject });
    const after = snapshot();
    return { ...r, delta: diffSnapshot(before, after), finalText: fs.existsSync(GO_TEST_FILE) ? fs.readFileSync(GO_TEST_FILE, "utf8") : undefined };
  })());

gtest("whole-file plan: a plan whose span covers a NON-EMPTY existing document is reviewed before it writes, whatever its mode string says [contract-phase6 section 4 'Widen the review gate to that shape, not to the mode string']", async () => {
  const { shown, messages } = await driveWholeFile();
  assert.ok(
    shown.some((s) => s.includes(GO_TEST_NAME)),
    `a plan that rewrites the human's existing test file must be SHOWN before it lands. No shown surface carried ${GO_TEST_NAME}. OFFERED: ${actionsOffered(messages)} SURFACES: ${JSON.stringify(shown.map((s) => s.slice(0, 200)))}`
  );
});

gtest("whole-file plan: rejecting it leaves the human's existing test file byte-identical [contract-phase6 section 4 'a whole-file rewrite would take the no-preview branch and land in the buffer with no diff']", async () => {
  const r = await driveWholeFile();
  const { delta, finalText } = r;
  assertGestureRan(r, "the whole-file test-gen");
  assert.strictEqual(finalText, GO_EXISTING_TEST, "the human's own test file must be untouched after a reject");
  assert.deepStrictEqual(delta.changed, [], `reject changes nothing: ${JSON.stringify(delta.changed)}`);
  assert.deepStrictEqual(delta.created, [], `reject creates nothing: ${JSON.stringify(delta.created)}`);
});

// ===========================================================================
// 3. The four no-run outcomes become four distinct sentences.
//    [contract-phase6 section 3; contract-seam 'The three no-run outcomes are
//    DIFFERENT, and telling them apart is the point'; scraps D6]
//
//    Today every `ran: false` is reported as "the tests did not compile".
//    Forced deterministically with a fake `go` on PATH whose every byte is one
//    of goal.md item 2's measured captures. DERIVED.
// ===========================================================================

// The human Tabs the holes; this is that, mechanically, so the run rung has a
// real generated file with the product's own markers in it.
const SENTINEL_D = "@@V31DOLLAR@@";
const SENTINEL_B = "@@V31BRACE@@";
const SENTINEL_S = "@@V31SLASH@@";
const resolveSnippet = (value) => {
  let s = String(value);
  s = s.replace(/\\\$/g, SENTINEL_D).replace(/\\\}/g, SENTINEL_B).replace(/\\\\/g, SENTINEL_S);
  s = s.replace(/\$\{(\d+):([^{}]*)\}/g, (_m, _n, d) => (/^\s*(\/\*[\s\S]*?\*\/|#[^\n]*)\s*$/.test(d) ? "1" : d));
  s = s.replace(/\$\{(\d+)\}/g, "1");
  s = s.replace(/\$(\d+)/g, (_m, n) => (n === "0" ? "" : "1"));
  return s.split(SENTINEL_D).join("$").split(SENTINEL_B).join("}").split(SENTINEL_S).join("\\");
};

let prepError;
let preparedP;
const preparedGoTests = () =>
  (preparedP ||= (async () => {
    const accept = await driveAccept();
    let text = accept.createdText;
    if (text === undefined) {
      throw new Error(
        `the accept path created no test file, so the run rung cannot be reached. CREATED: ${JSON.stringify(accept.delta.created)} OFFERED: ${actionsOffered(accept.messages)}`
      );
    }
    const intoTest = accept.snippetInserts.filter((s) => String(s.uri || "").includes("atlas_test.go"));
    if (!text.includes(GO_TEST_NAME) && intoTest.length >= 1) text = resolveSnippet(intoTest[intoTest.length - 1].value);
    if (text.includes("${")) text = resolveSnippet(text);
    if (!text.includes(GO_TEST_NAME)) {
      throw new Error(
        `the created file carries no generated test, so the run rung has nothing to scope to. FILE: ${JSON.stringify(text.slice(0, 400))} INSERTS: ${JSON.stringify(intoTest.map((s) => s.value.slice(0, 200)))}`
      );
    }
    return text;
  })().catch((e) => {
    prepError = e;
    throw e;
  }));

const runDriveP = {};
const driveRun = (mode) =>
  (runDriveP[mode] ||= (async () => {
    const prepared = await preparedGoTests();
    resetFixture();
    fs.writeFileSync(GO_TEST_FILE, prepared);
    const origPath = process.env.PATH;
    const origMode = process.env.V31_GO_MODE;
    process.env.PATH = mode === "env" ? EMPTYBIN : FAKEBIN + path.delimiter + origPath;
    process.env.V31_GO_MODE = mode;
    try {
      const doc = docFor(GO_LANG);
      const r = await driveSettled("column80.runTddTests", {
        doc,
        cursor: cursorFor(GO_LANG),
        handlers: emptyHandlers(GO_LANG.symbols(GO_LANG.text)),
        docs: { ["file://" + GO_LANG.file]: doc },
        settleMs: 20000,
      });
      return { ...r, reported: r.texts.concat(r.logs).join("\n") };
    } finally {
      process.env.PATH = origPath;
      if (origMode === undefined) delete process.env.V31_GO_MODE;
      else process.env.V31_GO_MODE = origMode;
    }
  })());

// What the human READS: the messages when there are any, the channel when
// there are not.
const human = (r) => (r.texts.length ? r.texts.join("\n") : r.reported);
const runDiag = (r) => `MESSAGES: ${JSON.stringify(r.texts)} CHANNEL: ${JSON.stringify(r.logs.slice(-14))}`;

const rtest = (name, fn) =>
  gtest(name, (ctx) => {
    if (prepError) return ctx.skip("the run rung was not reachable; see the prerequisite row");
    return fn(ctx);
  });

gtest("run rung (prerequisite): the accepted test file is on disk with the product's own markers, so the four no-run outcomes can be driven [harness guard: one loud failure, the four rows below skip]", async () => {
  await preparedGoTests();
});

rtest("no-run outcome (buildError): the human is told the tests did not COMPILE, and is shown the compiler's own message [contract-phase6 section 3 row 1]", async () => {
  const r = await driveRun("build");
  assert.ok(/compil/i.test(human(r)), `a build error is the one case that DOES say compile. ${runDiag(r)}`);
  assert.ok(
    /nopeSymbol/.test(r.reported),
    `the compiler's own message must reach the human, not just the fact of a failure. ${runDiag(r)}`
  );
});

rtest("no-run outcome (environmentError): the human is NOT told about a compile error, and IS told what is missing [contract-phase6 section 3 row 2 'Never a compile error'; goal.md 'sends the human hunting a compile error that does not exist']", async () => {
  const r = await driveRun("env");
  assert.ok(r.texts.length + r.logs.length > 0, `a run that cannot start must SAY so. ${runDiag(r)}`);
  assert.ok(
    !/compil/i.test(human(r)),
    `the runner could not START; nothing was compiled and nothing failed to compile. ${runDiag(r)}`
  );
  assert.ok(/\bgo\b/i.test(human(r)), `the message names what is missing, which is the runner itself. ${runDiag(r)}`);
  assert.ok(
    /(not found|could not|cannot|unable|missing|ENOENT|failed to start)/i.test(human(r)),
    `the message says the run could not START. ${runDiag(r)}`
  );
});

rtest("no-run outcome (environmentError): the message names the problem and STOPS - never `go get`, never an install [contract-phase6 section 3 'Name the problem and stop. Never run it, never offer to']", async () => {
  const r = await driveRun("env");
  const forbidden = /\bgo get\b|\bgo mod download\b|\bnpm (i|install|add)\b|\bpip3? install\b|\bdotnet (add|restore|tool install)\b|\bcargo (install|add)\b|\bapt(-get)? install\b|\bbrew install\b/i;
  assert.ok(!forbidden.test(human(r)), `the message suggested a command the product forbids. ${runDiag(r)}`);
  const offeredActions = r.messages.flatMap((m) => (m.actions || []).map(labelOf));
  assert.ok(
    !offeredActions.some((a) => /install|get|download|fetch|restore/i.test(a)),
    `no action button may offer to install anything: ${JSON.stringify(offeredActions)}`
  );
});

rtest("no-run outcome (filterMatchedNothing): the human is told the FILTER matched nothing, is shown the filter, and is not told about a compile error [contract-phase6 section 3 row 3]", async () => {
  const r = await driveRun("filter");
  assert.ok(r.texts.length + r.logs.length > 0, `a filter miss must SAY so. ${runDiag(r)}`);
  assert.ok(!/compil/i.test(human(r)), `nothing failed to compile; the run happened and matched nothing. ${runDiag(r)}`);
  assert.ok(
    /(filter|matched nothing|no tests? (were )?(selected|matched|found|to run)|selected (no|zero))/i.test(human(r)),
    `the human must read that the FILTER matched nothing. ${runDiag(r)}`
  );
  assert.ok(
    r.reported.includes(GO_TEST_NAME),
    `the message names the filter, so the human can see what was asked for. ${runDiag(r)}`
  );
});

rtest("no-run outcome (filterMatchedNothing): it does NOT read as a pass - the `passed + failed > 0` green rule still holds [contract-phase6 section 3 'Never a pass' + 'The green rule does not move'; goal.md item 2 'The false green']", async () => {
  const r = await driveRun("filter");
  const claimsGreen = /(tests? passed|all tests? pass|passed\s*[:=]?\s*[1-9]|succeeded|success)/i;
  const offenders = r.texts.filter((t) => claimsGreen.test(t));
  assert.deepStrictEqual(
    offenders,
    [],
    `the runner exited 0 and printed PASS with zero tests executed. Green requires passed + failed > 0. ${runDiag(r)}`
  );
});

rtest("no-run outcome (unclassified): the human is told plainly that the runner produced NO RESULT, and is shown what it said on BOTH streams [contract-phase6 section 3 row 4 'Do not invent a bucket for it'; scraps D6]", async () => {
  const r = await driveRun("silent");
  assert.ok(r.texts.length + r.logs.length > 0, `an unclassified no-run must SAY so rather than going quiet. ${runDiag(r)}`);
  assert.ok(!/compil/i.test(human(r)), `an unclassified outcome is not a compile error. ${runDiag(r)}`);
  assert.ok(
    /(no result|produced (no|nothing)|nothing to report|could not tell|no test results|unrecognis|unrecogniz)/i.test(human(r)),
    `honest ignorance: the sentence says the runner produced no result. ${runDiag(r)}`
  );
  assert.ok(r.reported.includes("V31UNCLASSIFIEDSTDOUT"), `what the runner said on STDOUT must be shown. ${runDiag(r)}`);
  assert.ok(
    r.reported.includes("V31UNCLASSIFIEDSTDERR"),
    `what the runner said on STDERR must be shown. Phase 2 established the precedent: a leg reading only one stream reports a failure with no message. ${runDiag(r)}`
  );
});

rtest("no-run outcomes: the four sentences are DISTINCT - no two of the four read the same [contract-phase6 section 3 'four honest sentences'; today all four are 'the tests did not compile']", async () => {
  const modes = ["build", "env", "filter", "silent"];
  const seen = {};
  for (const m of modes) {
    const r = await driveRun(m);
    seen[m] = human(r).replace(/\s+/g, " ").trim();
  }
  const pairs = [];
  for (let i = 0; i < modes.length; i++) {
    for (let j = i + 1; j < modes.length; j++) {
      if (seen[modes[i]] && seen[modes[i]] === seen[modes[j]]) pairs.push([modes[i], modes[j]]);
    }
  }
  assert.deepStrictEqual(pairs, [], `these outcomes read identically: ${JSON.stringify(pairs)}. SENTENCES: ${JSON.stringify(seen)}`);
});

rtest("no-run outcomes: no message in ANY of the four suggests a command the product forbids [contract-phase6 section 3 + section 6 'never install anything']", async () => {
  const forbidden = /\bgo get\b|\bgo mod download\b|\bnpm (i|install|add)\b|\bpip3? install\b|\bdotnet (add|restore|tool install)\b|\bcargo (install|add)\b|\bapt(-get)? install\b|\bbrew install\b/i;
  const offenders = [];
  for (const m of ["build", "env", "filter", "silent"]) {
    const r = await driveRun(m);
    for (const t of r.texts) if (forbidden.test(t)) offenders.push(`${m}: ${t}`);
  }
  assert.deepStrictEqual(offenders, [], `a message suggested a forbidden command: ${JSON.stringify(offenders)}`);
});

// ===========================================================================
// Rust is byte-frozen apart from the ratified supersessions. One smoke row,
// because the per-language gate is the thing most able to dim it by accident.
// [contract-phase6 section 6 'Rust's behaviour stays byte-frozen']
// ===========================================================================

const RUST_SRC = `/// Sums the widget mass.
fn total_mass(w: u64) -> u64 {
    0
}
`;

gtest("rust smoke: the per-language gate never fires on a rust document, and the rust chain still reaches the generation service [contract-phase6 section 6 'Rust's behaviour stays byte-frozen']", async () => {
  const file = w("rustcrate/src/mass.rs", RUST_SRC);
  w("rustcrate/Cargo.toml", '[package]\nname = "probe"\nversion = "0.1.0"\nedition = "2021"\n');
  const doc = makeDoc(RUST_SRC, file, "rust");
  const sig = posOf(RUST_SRC, "fn total_mass");
  const nameCh = RUST_SRC.split("\n")[sig.line].indexOf("total_mass");
  const symbols = [
    dsym("total_mass", 11, vr(sig.line - 1, 0, sig.line + 2, 1), vr(sig.line, nameCh, sig.line, nameCh + "total_mass".length)),
  ];
  const r = await driveSettled("column80.generateTests", {
    doc,
    cursor: posOf(RUST_SRC, "    0"),
    handlers: emptyHandlers(symbols),
    docs: { ["file://" + file]: doc },
    reply: () => "```rust\n#[cfg(test)]\nmod tests {\n    use super::*;\n\n    #[test]\n    fn sums() { assert_eq!(total_mass(1), 1); }\n}\n```",
    answer: answerReject,
  });
  assert.ok(!r.texts.some((t) => /Rust-only/i.test(t)), `the gate must never fire on rust. MESSAGES: ${JSON.stringify(r.texts)}`);
  assert.ok(r.genRequests.length >= 1, `an eligible rust test-gen still reaches the generation service. ${runDiag(r)}`);
});
