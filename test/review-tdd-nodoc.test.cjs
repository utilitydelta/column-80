// Adversarial review of supersession S40 (Generate Tests attempts a function
// with no doc comment). Rows that FAIL name a defect; rows that pass pin a
// checked-and-clean attack.
//
// Run: SKIP_LIVE=1 node --test test/review-tdd-nodoc.test.cjs
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const os = require("os");
const esbuild = require("esbuild");

// ---------------------------------------------------------------------------
// A real temp workspace: placement and framework detection read the disk.
// ---------------------------------------------------------------------------

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "review-tdd-nodoc-"));
const w = (rel, text) => {
  const p = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
  return p;
};
w("rs/Cargo.toml", '[package]\nname = "probe"\nversion = "0.1.0"\nedition = "2021"\n');
w("gomod/go.mod", "module probe\n\ngo 1.22\n");
w(
  "ts/package.json",
  JSON.stringify({ name: "probe", version: "0.0.0", scripts: { test: "vitest run" }, devDependencies: { vitest: "^4.1.7" } }) + "\n",
);
w("py/pyproject.toml", '[tool.pytest.ini_options]\ntestpaths = ["tests"]\n');
fs.mkdirSync(path.join(ROOT, "py", "tests"), { recursive: true });
w("cs/Orders/Orders.csproj", '<Project Sdk="Microsoft.NET.Sdk">\n  <PropertyGroup><TargetFramework>net10.0</TargetFramework></PropertyGroup>\n</Project>\n');
w(
  "cs/Orders.Tests/Orders.Tests.csproj",
  `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup><TargetFramework>net10.0</TargetFramework><IsTestProject>true</IsTestProject></PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Microsoft.NET.Test.Sdk" Version="18.0.0" />
    <PackageReference Include="MSTest" Version="4.0.1" />
  </ItemGroup>
  <ItemGroup><ProjectReference Include="..\\Orders\\Orders.csproj" /></ItemGroup>
</Project>
`,
);

// ---------------------------------------------------------------------------
// The vscode stub: the zero-hole harness's shape, plus the workspace surface a
// non-Rust placement reads.
// ---------------------------------------------------------------------------

const STUB = path.join(__dirname, ".review-tdd-nodoc-stub.cjs");
fs.writeFileSync(
  STUB,
  `
const nodeFs = require("fs");
const state = { config: {}, messages: [], commands: {}, activeTextEditor: undefined,
  snippetInserts: [], appliedEdits: [], executeCalls: [], symbols: [], root: "/" };
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
  get isEmpty() { return this.start.isEqual(this.end); }
  contains(pos) {
    const p = pos.start ? pos.start : pos;
    const afterStart = p.line > this.start.line || (p.line === this.start.line && p.character >= this.start.character);
    const beforeEnd = p.line < this.end.line || (p.line === this.end.line && p.character <= this.end.character);
    return afterStart && beforeEnd;
  }
}
class Selection extends Range {
  constructor(a, b, c, d) { super(a, b, c, d); this.anchor = this.start; this.active = this.end; }
}
class SnippetString { constructor(value) { this.value = value; } }
class WorkspaceEdit {
  constructor() { this._entries = []; }
  replace(uri, range, text) { this._entries.push([uri, [{ range, newText: text }]]); }
  insert(uri, pos, text) { this._entries.push([uri, [{ range: new Range(pos, pos), newText: text }]]); }
  createFile() {}
  entries() { return this._entries; }
}
class EventEmitter {
  constructor() { this.handlers = []; }
  get event() { return (fn) => { this.handlers.push(fn); return { dispose() {} }; }; }
  fire(x) { for (const h of this.handlers) h(x); }
  dispose() {}
}
class ThemeColor { constructor(id) { this.id = id; } }
class MarkdownString { appendCodeblock() {} }
class Diagnostic { constructor(range, message) { this.range = range; this.message = message; } }
class TabInputTextDiff { constructor(original, modified) { this.original = original; this.modified = modified; } }
const Uri = {
  file: (p) => ({ fsPath: p, path: p, scheme: "file", toString: () => "file://" + p }),
  from: (parts) => ({ ...parts, fsPath: parts.path, toString: () => parts.scheme + "://" + parts.path + "?" + (parts.query || "") }),
  parse: (s) => ({ raw: s, toString: () => s }),
  joinPath: (base, ...segs) => Uri.file([base.fsPath, ...segs].join("/")),
};
const disposable = () => ({ dispose() {} });
module.exports = {
  __state: state,
  Position, Range, Selection, SnippetString, WorkspaceEdit, EventEmitter,
  ThemeColor, MarkdownString, Diagnostic, TabInputTextDiff, Uri,
  DiagnosticSeverity: { Error: 0, Warning: 1 },
  SymbolKind: { Function: 11, Method: 5, Constructor: 8, Struct: 22, Enum: 9, Class: 4 },
  ProgressLocation: { Notification: 15, Window: 10 },
  ConfigurationTarget: { Global: 1 },
  workspace: {
    getConfiguration: () => ({
      get: (key, fallback) => (key in state.config ? state.config[key] : fallback),
      inspect: () => undefined, update: async () => {},
    }),
    onDidChangeConfiguration: disposable,
    registerTextDocumentContentProvider: disposable,
    get textDocuments() { return []; },
    get workspaceFolders() { return [{ uri: Uri.file(state.root), name: "probe", index: 0 }]; },
    getWorkspaceFolder: () => ({ uri: Uri.file(state.root), name: "probe", index: 0 }),
    applyEdit: async (edit) => { state.appliedEdits.push(edit); return true; },
    openTextDocument: async () => undefined,
    fs: {
      stat: async (uri) => { const st = nodeFs.statSync(uri.fsPath); return { type: st.isDirectory() ? 2 : 1, size: st.size }; },
      readFile: async (uri) => new Uint8Array(nodeFs.readFileSync(uri.fsPath)),
      writeFile: async () => {},
      createDirectory: async () => {},
    },
  },
  languages: {
    createDiagnosticCollection: (name) => ({ name, set() {}, delete() {}, clear() {}, dispose() {} }),
    getDiagnostics: () => [],
  },
  window: {
    createTextEditorDecorationType: (opts) => ({ opts, dispose() {} }),
    get visibleTextEditors() { return []; },
    get activeTextEditor() { return state.activeTextEditor; },
    showTextDocument: async () => state.activeTextEditor,
    showInformationMessage: async (message) => { state.messages.push({ kind: "info", message }); },
    showWarningMessage: async (message, ...actions) => { state.messages.push({ kind: "warn", message, actions }); return undefined; },
    showErrorMessage: async (message) => { state.messages.push({ kind: "error", message }); },
    withProgress: async (opts, task) => task({ report: () => {} }, { onCancellationRequested: () => ({ dispose() {} }) }),
    setStatusBarMessage: disposable,
    createTerminal: (opts) => ({ name: opts.name, show() {}, sendText() {} }),
    get terminals() { return []; },
    tabGroups: { all: [], onDidChangeTabs: disposable, close: async () => {} },
  },
  commands: {
    registerCommand: (id, fn) => { state.commands[id] = fn; return { dispose() {} }; },
    executeCommand: async (id, ...args) => {
      state.executeCalls.push({ id, args });
      return id === "vscode.executeDocumentSymbolProvider" ? state.symbols : undefined;
    },
  },
};
`,
);

const entry = path.join(__dirname, ".review-tdd-nodoc.entry.ts");
const outfile = path.join(__dirname, ".review-tdd-nodoc.bundle.cjs");
fs.writeFileSync(
  entry,
  `export { registerFnGen } from "../src/vscode/fnGen";
export { FnGenService } from "../src/core/fnGenService";
export { ContextBlockStore } from "../src/core/contextBlocks";
export { assembleTestGenPrompt } from "../src/core/prompt";
export { tddLangFor } from "../src/core/tddLang";
export { __state, Position, Range } from "vscode";\n`,
);
esbuild.buildSync({ entryPoints: [entry], bundle: true, outfile, format: "cjs", platform: "node", alias: { vscode: STUB } });
const { registerFnGen, FnGenService, ContextBlockStore, assembleTestGenPrompt, tddLangFor, __state, Position, Range } =
  require(outfile);
test.after(() => {
  for (const f of [entry, outfile, STUB]) fs.rmSync(f, { force: true });
  fs.rmSync(ROOT, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// The five languages. Each row: an undocumented value-returning function, its
// documented twin, and an undocumented void function that must stay refused.
// `range` is the symbol range [startLine, endLine]; `sel` the name's line.
// ---------------------------------------------------------------------------

const LANGS = [
  {
    id: "rust",
    file: "rs/src/lib.rs",
    doc: "/// Clamps n into [lo, hi].\n",
    fn: "pub fn clamp_to(n: i32, lo: i32, hi: i32) -> i32 {\n    let bodysentinel = n;\n    bodysentinel\n}\n",
    sig: "pub fn clamp_to(n: i32, lo: i32, hi: i32) -> i32",
    name: "clamp_to",
    voidFn: "pub fn log_it(n: i32) {\n    let _ = n;\n}\n",
    voidName: "log_it",
  },
  {
    id: "go",
    file: "gomod/atlas.go",
    prefix: "package atlas\n\n",
    doc: "// ClampTo clamps n into [lo, hi].\n",
    fn: "func ClampTo(n int, lo int, hi int) int {\n\tbodysentinel := n\n\treturn bodysentinel\n}\n",
    sig: "func ClampTo(n int, lo int, hi int) int",
    name: "ClampTo",
    voidFn: "func LogIt(n int) {\n\t_ = n\n}\n",
    voidName: "LogIt",
  },
  {
    id: "typescript",
    file: "ts/src/orders.ts",
    doc: "/** Clamps n into [lo, hi]. */\n",
    fn: "export function clampTo(n: number, lo: number, hi: number): number {\n\tconst bodysentinel = n;\n\treturn bodysentinel;\n}\n",
    sig: "export function clampTo(n: number, lo: number, hi: number): number",
    name: "clampTo",
    voidFn: "export function logIt(n: number): void {\n\tvoid n;\n}\n",
    voidName: "logIt",
  },
  {
    id: "python",
    file: "py/orders.py",
    // A docstring sits INSIDE the def, so the documented twin carries it there.
    doc: null,
    fn: "def clamp_to(n: int, lo: int, hi: int) -> int:\n    bodysentinel = n\n    return bodysentinel\n",
    docFn: 'def clamp_to(n: int, lo: int, hi: int) -> int:\n    """Clamps n into [lo, hi]."""\n    return n\n',
    sig: "def clamp_to(n: int, lo: int, hi: int) -> int:",
    name: "clamp_to",
    voidFn: "def log_it(n: int) -> None:\n    return None\n",
    voidName: "log_it",
  },
  {
    id: "csharp",
    file: "cs/Orders/Orders.cs",
    prefix: "namespace Orders\n{\npublic class Ledger\n{\n",
    suffix: "}\n}\n",
    doc: "/// <summary>Clamps n into [lo, hi].</summary>\n",
    fn: "public static int ClampTo(int n, int lo, int hi)\n{\n    var bodysentinel = n;\n    return bodysentinel;\n}\n",
    sig: "public static int ClampTo(int n, int lo, int hi)",
    name: "ClampTo",
    voidFn: "public static void LogIt(int n)\n{\n}\n",
    voidName: "LogIt",
  },
];

/** The source text for one row, and where the function sits in it. */
function sourceFor(L, variant) {
  const prefix = L.prefix ?? "";
  const doc = variant === "documented" && L.doc ? L.doc : "";
  const body = variant === "void" ? L.voidFn : variant === "documented" && L.docFn ? L.docFn : L.fn;
  const text = prefix + doc + body + (L.suffix ?? "");
  const startLine = prefix.split("\n").length - 1;
  const endLine = startLine + (doc + body).split("\n").length - 2;
  const headLine = startLine + doc.split("\n").length - 1;
  return { text, startLine, endLine, headLine, name: variant === "void" ? L.voidName : L.name };
}

function makeDoc(languageId, fsPath, src) {
  const lineStarts = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === "\n") lineStarts.push(i + 1);
  const offsetAt = (pos) => Math.min(lineStarts[Math.min(pos.line, lineStarts.length - 1)] + pos.character, src.length);
  const lines = src.split("\n");
  return {
    languageId,
    version: 1,
    isDirty: false,
    isClosed: false,
    lineCount: lines.length,
    uri: { fsPath, path: fsPath, scheme: "file", toString: () => "file://" + fsPath },
    getText(range) {
      return range ? src.slice(offsetAt(range.start), offsetAt(range.end)) : src;
    },
    offsetAt,
    positionAt(offset) {
      let line = 0;
      while (line + 1 < lineStarts.length && lineStarts[line + 1] <= offset) line++;
      return new Position(line, offset - lineStarts[line]);
    },
    lineAt(n) {
      const i = typeof n === "number" ? n : n.line;
      const text = lines[i] ?? "";
      return {
        lineNumber: i,
        text,
        firstNonWhitespaceCharacterIndex: text.length - text.trimStart().length,
        isEmptyOrWhitespace: text.trim() === "",
        range: new Range(i, 0, i, text.length),
      };
    },
    save: async () => true,
  };
}

/** Drive column80.generateTests with the cursor inside the row's function and
 *  a backend that records every prompt it is handed. */
async function drive(L, variant) {
  const s = sourceFor(L, variant);
  const fsPath = w(L.file, s.text);
  const doc = makeDoc(L.id, fsPath, s.text);
  __state.config = {};
  __state.messages = [];
  __state.commands = {};
  __state.snippetInserts = [];
  __state.appliedEdits = [];
  __state.executeCalls = [];
  __state.root = ROOT;
  const nameCol = doc.lineAt(s.headLine).text.indexOf(s.name);
  const endText = doc.lineAt(s.endLine).text;
  __state.symbols = [
    {
      name: s.name,
      kind: 11,
      range: new Range(s.startLine, 0, s.endLine, endText.length),
      selectionRange: new Range(s.headLine, nameCol, s.headLine, nameCol + s.name.length),
      children: [],
    },
  ];
  const prompts = [];
  const lines = [];
  const output = { lines, appendLine: (l) => lines.push(l) };
  const service = new FnGenService(
    { apiBase: "http://127.0.0.1:1", model: "fake-30b", maxTokens: 256, temperature: 0.2 },
    async (params) => {
      prompts.push(params.prompt);
      // Not a test module: the gesture refuses the reply after the call, which
      // keeps this row about whether the call happened and nothing downstream.
      return { text: "no tests here", ttftMs: 1, totalMs: 2 };
    },
  );
  registerFnGen({ subscriptions: [] }, output, new ContextBlockStore(() => {}), {
    buildService: async () => ({
      service,
      tier: { id: "24gb", fnGenEnabled: true, fnGenModel: "fake-30b", provisional: false },
      config: {},
    }),
  });
  const bodyLine = s.headLine + 1;
  __state.activeTextEditor = {
    document: doc,
    viewColumn: 1,
    selection: { active: new Position(bodyLine, 2) },
    insertSnippet: async (snippet, range) => {
      __state.snippetInserts.push({ value: snippet.value, range });
      return true;
    },
  };
  await __state.commands["column80.generateTests"]();
  service.dispose();
  return { prompts, lines, messages: __state.messages.slice() };
}

const say = (r) => `\n--- channel ---\n${r.lines.join("\n")}\n--- toasts ---\n${JSON.stringify(r.messages)}`;

/** Drive the gesture on an arbitrary source. `range` = [startLine, endLine]. */
async function driveSrc(id, file, text, startLine, endLine, headLine, name) {
  const r = await (async () => {
    const fsPath = w(file, text);
    const doc = makeDoc(id, fsPath, text);
    __state.config = {}; __state.messages = []; __state.commands = {};
    __state.snippetInserts = []; __state.appliedEdits = []; __state.executeCalls = [];
    __state.root = ROOT;
    const nameCol = doc.lineAt(headLine).text.indexOf(name);
    __state.symbols = [{
      name, kind: 11,
      range: new Range(startLine, 0, endLine, doc.lineAt(endLine).text.length),
      selectionRange: new Range(headLine, nameCol, headLine, nameCol + name.length),
      children: [],
    }];
    const prompts = []; const lines = [];
    const output = { lines, appendLine: (l) => lines.push(l) };
    const service = new FnGenService(
      { apiBase: "http://127.0.0.1:1", model: "fake-30b", maxTokens: 256, temperature: 0.2 },
      async (params) => { prompts.push(params.prompt); return { text: "no tests here", ttftMs: 1, totalMs: 2 }; },
    );
    registerFnGen({ subscriptions: [] }, output, new ContextBlockStore(() => {}), {
      buildService: async () => ({ service, tier: { id: "24gb", fnGenEnabled: true, fnGenModel: "fake-30b", provisional: false }, config: {} }),
    });
    __state.activeTextEditor = {
      document: doc, viewColumn: 1,
      selection: { active: new Position(headLine + 1, 2) },
      insertSnippet: async () => true,
    };
    await __state.commands["column80.generateTests"]();
    service.dispose();
    return { prompts, lines, messages: __state.messages.slice() };
  })();
  return r;
}

// ---- Finding: Python docstrings the resolver drops are told "NO docstring" ----
// resolveFunction (fnGen.ts ~573) sets `docstringRefusal` and leaves docComment
// undefined for an implicitly concatenated docstring. generate() honours that
// refusal; generateTests never reads it. Before S40 the classifier refused (with a
// false "no docstring"); now the model is TOLD there is none, and the human's
// docstring never reaches the blind pass.
test("DEFECT python: a function with a concatenated docstring is not told it has NO docstring", async () => {
  const text = 'def clamp_to(n: int, lo: int, hi: int) -> int:\n    """Clamps n into [lo, hi]."""  " Raises ValueError if lo > hi."\n    return n\n';
  const r = await driveSrc("python", "py/concat.py", text, 0, 2, 0, "clamp_to");
  assert.strictEqual(r.prompts.length, 1, say(r));
  assert.ok(!/It has NO docstring/.test(r.prompts[0]), `the prompt denies a docstring the source has\n${r.prompts[0]}`);
});

// ---- Finding: attribute/decorator trivia counts as a doc comment --------------
// The documented/undocumented split keys on non-empty trivia, and the resolver
// hands attribute-only trivia over AS docComment (fnGen.ts ~497-533). So an
// undocumented `[Pure]` method gets "the doc comment and the signature" and an
// attribute line where the doc should be.
test("DEFECT csharp: an undocumented but attributed method gets the no-doc opening", async () => {
  const text = "namespace Orders\n{\npublic class Ledger\n{\n[Pure]\npublic static int ClampTo(int n, int lo, int hi)\n{\n    return n;\n}\n}\n}\n";
  const r = await driveSrc("csharp", "cs/Orders/Attr.cs", text, 4, 8, 5, "ClampTo");
  assert.strictEqual(r.prompts.length, 1, say(r));
  assert.ok(/It has NO doc comment/.test(r.prompts[0]), `an attribute was treated as the contract\n${r.prompts[0]}`);
});

test("DEFECT rust: an undocumented but attributed fn gets the no-doc opening", async () => {
  const text = "#[inline]\npub fn clamp_to(n: i32, lo: i32, hi: i32) -> i32 {\n    n\n}\n";
  const r = await driveSrc("rust", "rs/src/attr.rs", text, 0, 3, 1, "clamp_to");
  assert.strictEqual(r.prompts.length, 1, say(r));
  assert.ok(/It has NO doc comment/.test(r.prompts[0]), `an attribute was treated as the contract\n${r.prompts[0]}`);
});

// ---- Clean: the classifier ignores the doc entirely, so twins cannot differ ----
test("clean: documented and undocumented twins get identical verdicts across every leg and many shapes", () => {
  const sigs = {
    rust: ["pub fn f(n: i32) -> i32", "pub fn f(n: i32)", "pub fn f(&self) -> i32", "pub async fn f() -> i32", "pub fn f(p: &Path) -> io::Result<String>"],
    go: ["func F(n int) int", "func F(n int)", "func (s *S) F() int", "func F(fh *os.File) int", "func F() (int, int, int)"],
    typescript: ["export function f(n: number): number {", "function f(n: number): number {", "export function f(n: number): void {", "export async function f(): Promise<void> {"],
    python: ["def f(n: int) -> int:", "def f(self) -> int:", "def f(n):", "async def f() -> int:", "def f(p: Path) -> str:"],
    csharp: ["public static int F(int n)", "private static int F(int n)", "public static void F(int n)", "public int F(int n)", "public static async void F()"],
  };
  const docs = ["/// x", "// x", '"""x"""', "x"];
  for (const [id, list] of Object.entries(sigs)) {
    const lang = tddLangFor(id);
    for (const s of list) {
      const bare = lang.classifyTestability(s, undefined);
      for (const d of docs) assert.deepStrictEqual(lang.classifyTestability(s, d), bare, `${id} ${s} doc=${d}`);
    }
  }
});

// ---- Finding: the manual still quotes the pre-S40 TS refusal ------------------
test("DEFECT docs: the user manual no longer says the TS corpus refused every function for lack of docs", () => {
  const manual = fs.readFileSync(path.join(__dirname, "..", "docs", "user-manual.md"), "utf8");
  assert.ok(!/refused every one of its 157 functions, mostly because it documents 7%/.test(manual), "user-manual.md still carries the pre-S40 claim");
});
