// Implementer rows for supersession S40 (2026-09-29): the TDD gesture ATTEMPTS
// a function with no doc comment instead of refusing it.
//
// Human request, verbatim: "generate TDD refuses if there is no doc comment;
// but often it's obvious by fn name and not required. don't make it a fail,
// just attempt the tdd gen".
//
// Three layers:
//   1. THE GATE. Each leg's classifier admits an undocumented target and keeps
//      every other refusal, twin against twin.
//   2. THE PROMPT. assembleTestGenPrompt on an undocumented target says there is
//      no doc comment, names the signature, renders no empty doc line, and
//      never claims "the doc comment and the signature" as the contract.
//   3. THE GESTURE. column80.generateTests driven against a stub vscode with a
//      capturing fake backend: an undocumented function reaches the model, in
//      all five languages, and an undocumented void one still does not.
//
// Run: SKIP_LIVE=1 node --test test/impl-tdd-nodoc.test.cjs
// (Hermetic: the backend is an in-process function; no model, no network.)

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const os = require("os");
const esbuild = require("esbuild");

// ---------------------------------------------------------------------------
// A real temp workspace: placement and framework detection read the disk.
// ---------------------------------------------------------------------------

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "impl-tdd-nodoc-"));
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

const STUB = path.join(__dirname, ".impl-tdd-nodoc-stub.cjs");
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

const entry = path.join(__dirname, ".impl-tdd-nodoc.entry.ts");
const outfile = path.join(__dirname, ".impl-tdd-nodoc.bundle.cjs");
fs.writeFileSync(
  entry,
  `export { registerFnGen } from "../src/vscode/fnGen";
export { FnGenService } from "../src/core/fnGenService";
export { ContextBlockStore } from "../src/core/contextBlocks";
export { assembleTestGenPrompt, contractDocComment } from "../src/core/prompt";
export { tddLangFor } from "../src/core/tddLang";
export { __state, Position, Range } from "vscode";\n`,
);
esbuild.buildSync({ entryPoints: [entry], bundle: true, outfile, format: "cjs", platform: "node", alias: { vscode: STUB } });
const { registerFnGen, FnGenService, ContextBlockStore, assembleTestGenPrompt, contractDocComment, tddLangFor, __state, Position, Range } =
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
async function drive(L, variant, explicit) {
  const s = explicit ?? sourceFor(L, variant);
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

// ---------------------------------------------------------------------------
// 1. The gate.
// ---------------------------------------------------------------------------

test("gate: every leg admits an undocumented value-returning function, for undefined, empty and whitespace docs", () => {
  for (const L of LANGS) {
    for (const doc of [undefined, "", "  \n\t"]) {
      const v = tddLangFor(L.id).classifyTestability(L.sig, doc);
      assert.deepStrictEqual(v, { testable: true }, `${L.id} doc=${JSON.stringify(doc)}`);
    }
  }
});

test("gate: an undocumented void function is refused with the SAME verdict as its documented twin", () => {
  const voidSig = {
    rust: "pub fn log_it(n: i32)",
    go: "func LogIt(n int)",
    typescript: "export function logIt(n: number): void {",
    python: "def log_it(n: int) -> None:",
    csharp: "public static void LogIt(int n)",
  };
  const DOC = "/// Logs n.";
  for (const L of LANGS) {
    const lang = tddLangFor(L.id);
    const bare = lang.classifyTestability(voidSig[L.id], undefined);
    assert.strictEqual(bare.reason, "underspecified", `${L.id}: ${JSON.stringify(bare)}`);
    assert.deepStrictEqual(bare, lang.classifyTestability(voidSig[L.id], DOC), `${L.id}: the doc comment moved the verdict`);
  }
});

// ---------------------------------------------------------------------------
// 2. The prompt.
// ---------------------------------------------------------------------------

test("prompt: an undocumented target says so, names the signature, and never claims a doc comment as the contract", () => {
  for (const L of LANGS) {
    for (const docComment of [undefined, "", "   "]) {
      const p = assembleTestGenPrompt({ signature: L.sig, docComment, languageId: L.id, languageName: L.id });
      const label = `${L.id} doc=${JSON.stringify(docComment)}`;
      const noun = L.id === "python" ? "docstring" : "doc comment";
      assert.ok(p.includes(`It has NO ${noun}`), `${label}: the prompt must say there is no ${noun}\n${p}`);
      assert.ok(/name and signature/.test(p), `${label}: the prompt must point at the name and signature\n${p}`);
      assert.ok(!p.includes("the doc comment and the signature"), `${label}: claims a doc comment it does not have\n${p}`);
      assert.ok(p.includes(L.sig), `${label}: the signature is missing`);
      // The target block is the signature alone: no blank or whitespace doc line
      // ahead of it inside the fence.
      const fenceOpen = "```" + L.id + "\n";
      const at = p.lastIndexOf(fenceOpen);
      assert.ok(at >= 0, `${label}: no target fence`);
      assert.ok(p.slice(at + fenceOpen.length).startsWith(L.sig), `${label}: something sits above the signature\n${p.slice(at)}`);
    }
  }
});

test("prompt: a documented target keeps the documented opening and its doc comment", () => {
  for (const L of LANGS) {
    const docComment = L.id === "python" ? "Clamps n." : "/// Clamps n.";
    const p = assembleTestGenPrompt({ signature: L.sig, docComment, languageId: L.id, languageName: L.id });
    assert.ok(p.includes("the doc comment and the signature"), `${L.id}: the documented opening moved`);
    assert.ok(!/It has NO (doc comment|docstring)/.test(p), `${L.id}: a documented target was told it has none`);
    assert.ok(p.includes(docComment), `${L.id}: the doc comment is not in the prompt`);
  }
});

// ---------------------------------------------------------------------------
// 3. The gesture.
// ---------------------------------------------------------------------------

for (const L of LANGS) {
  test(`gesture ${L.id}: the documented control reaches the model (the harness can make the call happen)`, async () => {
    const r = await drive(L, "documented");
    assert.strictEqual(r.prompts.length, 1, `expected one model call${say(r)}`);
    assert.ok(r.prompts[0].includes("the doc comment and the signature"), "documented opening");
  });

  test(`gesture ${L.id}: an UNDOCUMENTED function reaches the model with the no-doc prompt`, async () => {
    const r = await drive(L, "undocumented");
    assert.ok(!r.messages.some((m) => /not auto-testable/.test(m.message)), `refused${say(r)}`);
    assert.strictEqual(r.prompts.length, 1, `expected one model call${say(r)}`);
    const p = r.prompts[0];
    assert.ok(p.includes(L.name), "the prompt names the function");
    assert.ok(/It has NO (doc comment|docstring)/.test(p), `the prompt says there is no doc comment\n${p}`);
    assert.ok(!p.includes("the doc comment and the signature"), "the prompt claims a doc comment");
    // Blind: the body is never sent. Every fixture body names `bodysentinel`.
    assert.ok(!p.includes("bodysentinel"), `the body leaked into the blind prompt\n${p}`);
  });

  test(`gesture ${L.id}: an undocumented VOID function is still refused and makes no model call`, async () => {
    const r = await drive(L, "void");
    assert.strictEqual(r.prompts.length, 0, `a void target reached the model${say(r)}`);
    assert.ok(
      r.messages.some((m) => /not auto-testable/.test(m.message) && /nothing to assert|return/.test(m.message)),
      `the refusal names the return value${say(r)}`,
    );
  });
}

// ---------------------------------------------------------------------------
// 4. Review findings: attribute trivia is not a doc, a refused Python docstring
//    is still a contract, and the coverage sentence follows the opening.
// ---------------------------------------------------------------------------

test("contractDocComment: attribute and decorator lines alone are no doc; any real doc line keeps the text unchanged", () => {
  const rows = [
    ["rust", "#[inline]", undefined],
    ["rust", "#[cfg(test)]\n#[inline]", undefined],
    ["rust", "/// Clamps n.\n#[inline]", "/// Clamps n.\n#[inline]"],
    ["csharp", "[Pure]", undefined],
    ["csharp", '[Route("a",\n    Name = "b")]', undefined],
    ["csharp", "/// <summary>Clamps.</summary>\n[Pure]", "/// <summary>Clamps.</summary>\n[Pure]"],
    ["typescript", "@Get()", undefined],
    ["typescript", "@UseGuards({\n  a: 1,\n})", undefined],
    ["typescript", "/** Clamps. */\n@Get()", "/** Clamps. */\n@Get()"],
    ["go", "// ClampTo clamps.", "// ClampTo clamps."],
    ["rust", "   ", undefined],
    ["rust", undefined, undefined],
  ];
  for (const [id, doc, want] of rows) {
    assert.strictEqual(contractDocComment(id, doc), want, `${id} ${JSON.stringify(doc)}`);
  }
});

test("prompt: the coverage sentence follows the opening - no 'contract's named edge' cases when there is no doc", () => {
  for (const L of LANGS) {
    const bare = assembleTestGenPrompt({ signature: L.sig, languageId: L.id, languageName: L.id });
    assert.ok(!bare.includes("the contract's named edge and failure cases"), `${L.id}: undocumented prompt asks for named cases`);
    assert.ok(bare.includes("the edge cases the name and types make plain"), `${L.id}: undocumented coverage phrase missing`);
    const documented = assembleTestGenPrompt({ signature: L.sig, docComment: "/// Clamps.", languageId: L.id, languageName: L.id });
    assert.ok(documented.includes("the contract's named edge and failure cases"), `${L.id}: documented coverage moved`);
  }
});

test("prompt: an attribute-only doc gets the undocumented prompt and no attribute where the doc would be", () => {
  const p = assembleTestGenPrompt({ signature: "pub fn clamp_to(n: i32) -> i32", docComment: "#[inline]", languageId: "rust" });
  assert.ok(p.includes("It has NO doc comment"), p);
  assert.ok(!p.includes("#[inline]"), p);
});

const PY = LANGS.find((L) => L.id === "python");
const pySource = (text, startLine, endLine, headLine) => ({ text, startLine, endLine, headLine, name: "clamp_to" });

test("gesture python: a decorated undocumented function is told it has NO docstring, not handed the decorator", async () => {
  const text = "@functools.cache\ndef clamp_to(n: int, lo: int, hi: int) -> int:\n    bodysentinel = n\n    return bodysentinel\n";
  const r = await drive(PY, "undocumented", pySource(text, 0, 3, 1));
  assert.strictEqual(r.prompts.length, 1, say(r));
  assert.ok(/It has NO docstring/.test(r.prompts[0]), r.prompts[0]);
  assert.ok(!r.prompts[0].includes("functools.cache\ndef"), `the decorator stood in for the docstring\n${r.prompts[0]}`);
});

for (const [label, text] of [
  ["concatenated", 'def clamp_to(n: int, lo: int, hi: int) -> int:\n    """Clamps n into [lo, hi]."""  " Raises if lo > hi."\n    return n\n'],
  ["header-line", 'def clamp_to(n: int, lo: int, hi: int) -> int: """Clamps n into [lo, hi]."""\n    return n\n'],
]) {
  test(`gesture python: a ${label} docstring Generate refuses to preserve is still the test contract`, async () => {
    const lines = text.split("\n").length - 2;
    const r = await drive(PY, "documented", pySource(text, 0, lines, 0));
    assert.strictEqual(r.prompts.length, 1, say(r));
    assert.ok(!/It has NO docstring/.test(r.prompts[0]), r.prompts[0]);
    assert.ok(r.prompts[0].includes("Clamps n into [lo, hi]."), `the docstring never reached the prompt\n${r.prompts[0]}`);
  });
}
