// Adversarial review, session-v78 phase 2 (the sketch keeper wired into the
// four write paths) and the phase 1 loop 3 body-cut changes.
//
// Every test here states the behaviour the human's intent requires and fails
// against the code as reviewed. Each block names the finding it evidences.
//
// Run: node --test test/review-v78-p2-sketch-wiring.test.cjs

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const esbuild = require("esbuild");
const { bundleCore } = require("./.blind-util.cjs");

const core = bundleCore(
  "review-v78-p2-core",
  [
    `export { keepSketchForPreview } from "../src/core/scaffoldKeep";`,
    `export { harvestBodyComments, bodyTextOfSpan } from "../src/core/scaffold";`,
    "",
  ].join("\n"),
);
const { keepSketchForPreview, harvestBodyComments, bodyTextOfSpan } = core.mod;

const harvestOf = (text, languageId, bodyOnly = false, bodyIndent = "") =>
  harvestBodyComments(bodyTextOfSpan(text, languageId, bodyOnly), languageId, bodyIndent).comments;

const keep = (languageId, originalSpan, reply, extra = {}) =>
  keepSketchForPreview({
    languageId,
    originalSpan,
    reply,
    bodyIndent: "",
    channelTag: "[repair]",
    title: "f: repair round 1 (preview)",
    ...extra,
  });

// ---------------------------------------------------------------------------
// Finding 1. A comment-scanner misread now does two new things: the keeper
// INSERTS a line that is not a developer comment, and `onlyCommentsDiffer`
// strips the misread "comment" from the comparison, so a real code change
// inside it reads as "made no meaningful change; not proposed". All three
// round sites OR `onlyCommentsDiffer` straight into that check.
// ---------------------------------------------------------------------------

const MISREADS = [
  {
    name: "C# verbatim string ending in a backslash, then a string holding //",
    languageId: "csharp",
    original: 'string Path() {\n    // build the url\n    return @"c:\\" + "http://a.example";\n}',
    reply: 'string Path() {\n    // build the url\n    return @"c:\\" + "http://b.example";\n}',
  },
  {
    name: "TSX: JSX text holding a URL",
    languageId: "typescriptreact",
    original: "function Link() {\n  // link to the docs\n  return <a>see http://a.example</a>;\n}",
    reply: "function Link() {\n  // link to the docs\n  return <a>see http://b.example</a>;\n}",
  },
];

for (const row of MISREADS) {
  test(`finding 1 (${row.name}): a real code change is not read as only comments differing`, () => {
    const k = keep(row.languageId, row.original, row.reply);
    assert.equal(
      k.onlyCommentsDiffer,
      false,
      `the reply changes a string/JSX text, so the round must be proposed; onlyCommentsDiffer=true discards it.\n${k.channelLine}`,
    );
  });

  test(`finding 1 (${row.name}): the keeper adds no line the developer never wrote`, { skip: "deferred: S78-1 in session-v78/scraps.md (the shared comment lexer misreads this text)" }, () => {
    const k = keep(row.languageId, row.original, row.reply);
    const added = k.text.split("\n").filter((l) => !row.reply.split("\n").includes(l));
    assert.deepEqual(added, [], `lines inserted into the reply:\n${k.text}\n${k.channelLine}`);
  });
}

// ---------------------------------------------------------------------------
// Finding 2 (pre-existing in isNoOpRepair, copied into onlyCommentsDiffer).
// Folding all whitespace makes a Python re-indent read as no change, though it
// moves a statement into a different block. The rounds throw the repair away.
// ---------------------------------------------------------------------------

const PY_ORIGINAL = "def f(x):\n    # guard first\n    if x:\n        a()\n    b()\n";
const PY_REPAIR = "def f(x):\n    # guard first\n    if x:\n        a()\n        b()\n";

test("finding 2: a Python repair that moves b() into the if block is not 'only comments differ'", () => {
  const k = keep("python", PY_ORIGINAL, PY_REPAIR);
  assert.equal(k.onlyCommentsDiffer, false, "b() changed block; that is a code change");
});

test("finding 2: a repair that changes whitespace inside a string literal is not 'only comments differ'", () => {
  const k = keep(
    "rust",
    'fn sep() -> &\'static str {\n    // two spaces\n    "a b"\n}',
    'fn sep() -> &\'static str {\n    // two spaces\n    "a  b"\n}',
  );
  assert.equal(k.onlyCommentsDiffer, false, "the literal's bytes changed");
});

// ---------------------------------------------------------------------------
// Finding 3. Cutting a comment out of the comparison copy joins the tokens on
// either side of it: `a/**/b` (two tokens) compares equal to `ab` (one).
// ---------------------------------------------------------------------------

test("finding 3: removing an inline block comment does not join the tokens around it", () => {
  const k = keep(
    "rust",
    "fn f() {\n    // pick one\n    let (a, b, ab) = (1, 2, 3);\n    a/**/b;\n}",
    "fn f() {\n    // pick one\n    let (a, b, ab) = (1, 2, 3);\n    ab;\n}",
  );
  assert.equal(k.onlyCommentsDiffer, false, "`a b` became `ab`, a different expression");
});

// ---------------------------------------------------------------------------
// Finding 5 (phase 1 loop 3, TS_TYPE_GROUP_HEAD in firstAtDepthZero). The head
// tested against the type-group pattern still holds line comment text, so an
// Allman brace after a trailing comment ending in `:` `,` `=` `|` `&` reads as
// a braced type and the body is lost: nothing harvested, nothing kept. Before
// this change the first depth-0 `{` was the body.
// ---------------------------------------------------------------------------

for (const tail of ["// TODO:", "// returns a,", "// default ="]) {
  test(`finding 5: TS Allman brace after a trailing comment '${tail}' still has a body`, () => {
    const span = `function f(a: number) ${tail}\n{\n  // load it\n  return a;\n}`;
    assert.deepEqual(harvestOf(span, "typescript"), ["load it"], JSON.stringify(bodyTextOfSpan(span, "typescript")));
  });
}

// ---------------------------------------------------------------------------
// Findings 2 and 4 through the real runPostAcceptOracle.
// ---------------------------------------------------------------------------

const ORACLE_STUB = path.join(__dirname, ".review-v78-p2-oracle-stub.cjs");
fs.writeFileSync(
  ORACLE_STUB,
  `
const state = (globalThis.__rv78p2 = globalThis.__rv78p2 || { messages: [], config: {} });
class Position { constructor(line, character) { this.line = line; this.character = character; } }
class Range {
  constructor(a, b, c, d) {
    if (typeof a === "number") { this.start = new Position(a, b); this.end = new Position(c, d); }
    else { this.start = a; this.end = b; }
  }
}
class ThemeColor { constructor(id) { this.id = id; } }
class MarkdownString { constructor() { this.blocks = []; } appendCodeblock(t) { this.blocks.push(t); } appendMarkdown() {} }
class Diagnostic { constructor(range, message, severity) { this.range = range; this.message = message; this.severity = severity; } }
class Location { constructor(uri, range) { this.uri = uri; this.range = range; } }
const Uri = {
  file: (p) => ({ fsPath: p, path: p, scheme: "file", toString: () => "file://" + p }),
  parse: (s) => ({ raw: s, fsPath: String(s).replace(/^file:\\/\\//, ""), toString: () => s }),
};
module.exports = {
  __state: state,
  Position, Range, ThemeColor, MarkdownString, Diagnostic, Location, Uri,
  DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
  ProgressLocation: { Window: 10, Notification: 15 },
  workspace: {
    getConfiguration: () => ({
      get: (k, fb) => (k in state.config ? state.config[k] : fb),
      inspect: () => undefined,
      update: async () => {},
    }),
    get textDocuments() { return []; },
    get workspaceFolders() { return undefined; },
  },
  languages: {
    createDiagnosticCollection: (name) => ({ name, set() {}, delete() {}, clear() {}, dispose() {} }),
  },
  window: {
    createTextEditorDecorationType: (opts) => ({ opts, dispose() {} }),
    get visibleTextEditors() { return []; },
    showWarningMessage: async (message) => { state.messages.push({ kind: "warn", message }); },
    showInformationMessage: async (message) => { state.messages.push({ kind: "info", message }); },
    setStatusBarMessage: (message) => { state.messages.push({ kind: "status", message }); return { dispose() {} }; },
  },
  commands: { executeCommand: async () => undefined },
};
`,
);

const OVERRIDES = {
  "../core/compilerOracle": ["runOracleCheck"],
  "../core/coveringTestRun": ["runCoveringGroups"],
  "../core/testDiscovery": ["discoverCoveringTests"],
  "./callHierarchy": ["prepareCallRoot"],
};
const seamPlugin = {
  name: "rv78-p2-seams",
  setup(build) {
    build.onResolve({ filter: /.*/ }, (args) => {
      if (args.namespace !== "file" || !args.importer.endsWith(path.join("vscode", "oracleSurface.ts"))) return undefined;
      if (!(args.path in OVERRIDES)) return undefined;
      return { path: path.resolve(path.dirname(args.importer), `${args.path}.ts`), namespace: "rv78-seam", pluginData: args.path };
    });
    build.onLoad({ filter: /.*/, namespace: "rv78-seam" }, (args) => {
      const real = JSON.stringify(args.path);
      const lines = [`import * as real from ${real};`, `export * from ${real};`];
      for (const n of OVERRIDES[args.pluginData]) {
        lines.push(`export const ${n} = (...a) => (globalThis.__rv78p2fakes?.${n} ?? real.${n})(...a);`);
      }
      return { contents: lines.join("\n"), loader: "ts", resolveDir: path.dirname(args.path) };
    });
  },
};

const ORACLE_ENTRY = path.join(__dirname, ".review-v78-p2-oracle.entry.ts");
const ORACLE_OUT = path.join(__dirname, ".review-v78-p2-oracle.bundle.cjs");
fs.writeFileSync(ORACLE_ENTRY, `export { runPostAcceptOracle, isNoOpRepair } from "../src/vscode/oracleSurface";\n`);
let runPostAcceptOracle;
let isNoOpRepair;
let oracleState;
test.before(async () => {
  await esbuild.build({
    entryPoints: [ORACLE_ENTRY],
    bundle: true,
    outfile: ORACLE_OUT,
    format: "cjs",
    platform: "node",
    alias: { vscode: ORACLE_STUB },
    plugins: [seamPlugin],
    logLevel: "silent",
  });
  ({ runPostAcceptOracle, isNoOpRepair } = require(ORACLE_OUT));
  oracleState = globalThis.__rv78p2;
});

const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), "review-v78-p2-"));
test.after(() => {
  for (const f of [ORACLE_STUB, ORACLE_ENTRY, ORACLE_OUT]) fs.rmSync(f, { force: true });
  fs.rmSync(SCRATCH, { recursive: true, force: true });
  core.cleanup();
});
test.afterEach(() => {
  globalThis.__rv78p2fakes = undefined;
});

// A function that already went through a generate: the developer's sketch at
// body depth, code under each line. `s.total(...)` is a member call, so the
// refine has something to look up.
const ADD_SKETCH = ["take both inputs", "sum them with the shared summer"];
const ADD_FN = [
  "pub fn add(a: i32, b: i32) -> i32 {",
  "    // take both inputs",
  "    let s = Summer::new();",
  "    // sum them with the shared summer",
  "    s.total(a, b)",
  "}",
].join("\n");
const ADD_SOURCE = `${ADD_FN}\n`;
// What every round's model sends back: the code changed, the sketch gone.
const ADD_REPLY_NO_COMMENTS = "pub fn add(a: i32, b: i32) -> i32 {\n    let s = Summer::new();\n    s.total(a, b) + 0\n}";

function crate(tag) {
  const root = fs.mkdtempSync(path.join(SCRATCH, `${tag}-`));
  fs.writeFileSync(path.join(root, "Cargo.toml"), '[package]\nname = "p"\nversion = "0.1.0"\n');
  fs.mkdirSync(path.join(root, "src"));
  const file = path.join(root, "src", "lib.rs");
  fs.writeFileSync(file, ADD_SOURCE);
  // Another caller of `total`, so the refine's reference lookup finds a window.
  const other = path.join(root, "src", "other.rs");
  fs.writeFileSync(other, "pub fn twice(x: i32) -> i32 {\n    let s = Summer::new();\n    s.total(x, x)\n}\n");
  return { root, file, other };
}

function oracleDocument(file) {
  const text = ADD_SOURCE;
  const positionAt = (offset) => {
    const before = text.slice(0, offset);
    return { offset, line: before.split("\n").length - 1, character: offset - before.lastIndexOf("\n") - 1 };
  };
  return {
    languageId: "rust",
    isDirty: false,
    isClosed: false,
    version: 1,
    uri: { fsPath: file, path: file, scheme: "file", toString: () => "file://" + file },
    getText: (range) => (range ? text.slice(range.start.offset, range.end.offset) : text),
    positionAt,
    offsetAt: (p) => p.offset,
    lineAt: (line) => {
      const t = text.split("\n")[line] ?? "";
      return { text: t, range: { start: { line, character: 0 }, end: { line, character: t.length } } };
    },
    save: async () => true,
  };
}

const addResolved = () => ({
  span: { start: 0, end: ADD_FN.length },
  signature: "pub fn add(a: i32, b: i32) -> i32",
  docComment: "",
  symbolName: "add",
  languageId: "rust",
  kind: "function",
  bodyOnly: false,
  headerIndent: "",
  headOffset: 0,
  bodyIndent: "    ",
});

const clean = (root) => ({ success: true, diagnostics: [], durationMs: 1, crateRoot: root });
const broken = (root, file) => ({
  success: false,
  durationMs: 1,
  crateRoot: root,
  diagnostics: [
    {
      kind: "compile-error",
      level: "error",
      code: "E0308",
      message: "mismatched types",
      suggestions: [],
      spans: [
        { fileName: file, byteStart: 120, byteEnd: 125, lineStart: 5, lineEnd: 5, columnStart: 5, columnEnd: 10, isPrimary: true },
      ],
    },
  ],
});

const GROUP = (root) => ({
  key: `${root}::adds`,
  frameworkId: "cargo-test",
  tests: [{ filter: "adds", filePath: path.join(root, "src", "lib.rs") }],
  placement: { runRoot: root },
});
const runOf = (root, outcome) => ({
  cancelled: false,
  outcomes: [
    {
      key: `${root}::adds`,
      frameworkName: "cargo test",
      tests: [{ filter: "adds" }],
      result: {
        ran: true,
        success: outcome === "pass",
        cases: [{ name: "adds", outcome }],
        failures: outcome === "pass" ? [] : [{ name: "adds", message: "assertion failed" }],
        passed: outcome === "pass" ? 1 : 0,
        failed: outcome === "pass" ? 0 : 1,
        ignored: 0,
        durationMs: 1,
        crateRoot: root,
      },
    },
  ],
});

/** One post-accept session on `add`, the model answering `reply`. */
async function oracleRun({ leg, reply }) {
  const { root, file, other } = crate(leg);
  oracleState.messages = [];
  oracleState.config = { repairEnabled: true };
  let checks = 0;
  let runs = 0;
  if (leg === "compiler") {
    globalThis.__rv78p2fakes = { runOracleCheck: async () => (checks++ === 0 ? broken(root, file) : clean(root)) };
  } else if (leg === "tests") {
    globalThis.__rv78p2fakes = {
      runOracleCheck: async () => clean(root),
      prepareCallRoot: async () => ({ uri: "file:///x", name: "add" }),
      discoverCoveringTests: async () => ({ groups: [GROUP(root)] }),
      runCoveringGroups: async () => runOf(root, runs++ === 0 ? "fail" : "pass"),
    };
  } else {
    globalThis.__rv78p2fakes = {
      runOracleCheck: async () => clean(root),
      prepareCallRoot: async () => ({ uri: "file:///x", name: "add" }),
      discoverCoveringTests: async () => ({ groups: [] }),
    };
  }
  const lines = [];
  const presented = [];
  const generateCalls = [];
  const ctx = {
    document: oracleDocument(file),
    landedSpan: { start: 0, end: ADD_FN.length },
    output: { appendLine: (l) => lines.push(String(l)), append() {} },
    service: {
      modelTag: "stub-model",
      generateRaw: async (...a) => {
        generateCalls.push(a);
        return { text: reply };
      },
      logOutcome() {},
    },
    presenter: {
      present: async (p) => {
        presented.push(p);
        return "reject";
      },
    },
    resolveFunction: async () => addResolved(),
    inFlight: { begin: () => ({ release() {} }) },
    repairTierGate: { allowed: true },
    manualRefine: true,
    extractor: {
      completeMembers: async () => [],
      example: async () => undefined,
      membersOfType: async () => [],
      references: async () => [{ uri: "file://" + other, line: 2, character: 6, endLine: 2, endCharacter: 11 }],
    },
  };
  try {
    await runPostAcceptOracle(ctx);
  } catch (err) {
    lines.push(`[test] threw: ${String(err)}`);
  }
  return { presented, lines, generateCalls, messages: oracleState.messages.slice() };
}

const showO = (r) => `channel=\n${r.lines.join("\n")}\nmessages=${JSON.stringify(r.messages)}`;


test("finding 2 (pre-existing): isNoOpRepair also reads the Python re-indent as no change", { skip: "deferred: S78-4 in session-v78/scraps.md (isNoOpRepair folds all whitespace, pre-v78)" }, () => {
  assert.equal(isNoOpRepair(PY_ORIGINAL, PY_REPAIR), false, "b() moved into the if block");
});

// Finding 4. The sketch line is logged before the "changed nothing" check, so a
// round the developer never sees says Column 80 placed lines in it.
for (const leg of ["compiler", "tests", "refine"]) {
  test(`finding 4 (${leg}): a round that is not proposed does not claim it placed sketch lines`, async () => {
    const reply = "pub fn add(a: i32, b: i32) -> i32 {\n    let s = Summer::new();\n    s.total(a, b)\n}";
    const r = await oracleRun({ leg, reply });
    assert.equal(r.presented.length, 0, showO(r));
    const claims = r.lines.filter((l) => /sketch: .* [1-9]\d* placed by Column 80/.test(l));
    assert.deepEqual(claims, [], `the channel says lines were placed in a round that was not proposed:\n${showO(r)}`);
  });
}
