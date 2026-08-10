// IMPLEMENTER tests for session-v30 phases 3 and 4: the two new legs of a repair
// round.
//
// Three surfaces, three levels:
//
//   1. `refineTargets` ordering (core, pure) - the failing call must lead when a
//      diagnostic anchors the scan, and the standard-library statics the scout
//      measured must never become targets at all.
//   2. `resolveCallOwners` (vscode, over a stubbed server) - the leg must hand
//      back a CURSOR, must drop a std owner, must respect its keep cap, and must
//      say why on the channel when it cannot resolve one.
//   3. `assembleRepairPrompt` section order (core, pure) - where the usage
//      sections land, and that their absence is byte-identical.
//
// What is NOT covered here, said plainly: the end-to-end flow through
// `runPostAcceptOracle`, including the claim that a TERMINAL steer suppresses the
// usage leg. That path needs a real cargo project and a real oracle, and the
// falsification depth of this file stops at the seam.
//
// Run: SKIP_LIVE=1 node --test test/impl-v30-p34-roundlegs.test.cjs

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");
const { bundleCore } = require("./.blind-util.cjs");

const { mod: core, cleanup: cleanupCore } = bundleCore(
  "impl-v30-p34-core",
  `export { refineTargets } from "../src/core/refine";
export { assembleRepairPrompt } from "../src/core/repair";\n`,
);
const { refineTargets, assembleRepairPrompt } = core;

// The vscode layer, with the module aliased to a stub whose documentSymbol
// answer the test controls.
const STUB = path.join(__dirname, ".impl-v30-p34-stub.cjs");
fs.writeFileSync(
  STUB,
  `
const state = (globalThis.__v30p34 = globalThis.__v30p34 || { symbols: [] });
class Position { constructor(line, character) { this.line = line; this.character = character; } }
class Range {
  constructor(a, b, c, d) {
    if (typeof a === "number") { this.start = new Position(a, b); this.end = new Position(c, d); }
    else { this.start = a; this.end = b; }
  }
}
class ThemeColor { constructor(id) { this.id = id; } }
class MarkdownString { constructor() { this.blocks = []; } appendCodeblock(t) { this.blocks.push(t); } }
class Diagnostic { constructor(range, message, severity) { this.range = range; this.message = message; this.severity = severity; } }
const Uri = {
  file: (p) => ({ fsPath: p, path: p, scheme: "file", toString: () => "file://" + p }),
  parse: (s) => ({ raw: s, toString: () => s }),
};
module.exports = {
  __state: state,
  Position, Range, ThemeColor, MarkdownString, Diagnostic, Uri,
  DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
  SymbolKind: { File: 0, Module: 1, Class: 4, Method: 5, Field: 7, Enum: 9, Interface: 10, Function: 11, Object: 18, Struct: 22 },
  workspace: {
    getConfiguration: () => ({ get: (k, fb) => fb, inspect: () => undefined, update: async () => {} }),
    get textDocuments() { return []; },
    openTextDocument: async () => ({ getText: () => "" }),
  },
  languages: { createDiagnosticCollection: (name) => ({ name, set() {}, delete() {}, clear() {}, dispose() {} }) },
  window: {
    createTextEditorDecorationType: (opts) => ({ opts, dispose() {} }),
    get visibleTextEditors() { return []; },
    showWarningMessage: async () => {},
    showInformationMessage: async () => {},
    setStatusBarMessage: () => ({ dispose() {} }),
  },
  commands: { executeCommand: async (cmd) => (cmd === "vscode.executeDocumentSymbolProvider" ? state.symbols : undefined) },
};
`,
);
const entry = path.join(__dirname, ".impl-v30-p34.entry.ts");
const outfile = path.join(__dirname, ".impl-v30-p34.bundle.cjs");
fs.writeFileSync(entry, `export { resolveCallOwners } from "../src/vscode/fnGen";\n`);
esbuild.buildSync({
  entryPoints: [entry],
  bundle: true,
  outfile,
  format: "cjs",
  platform: "node",
  alias: { vscode: STUB },
});
const { resolveCallOwners } = require(outfile);
const stubState = globalThis.__v30p34;
test.after(() => {
  cleanupCore();
  [entry, outfile, STUB].forEach((f) => fs.rmSync(f, { force: true }));
});

// ===========================================================================
// 1. ORDERING. The live capture, verbatim: rustc pointed at the ARGUMENT
// `&active_file.cursor`, not at `.to_shard_log_header`, so a scan that ranked by
// distance to the call name alone would have put the nearer `borrow` first.
// ===========================================================================

const CAPTURE = `pub fn get_shard_log_header_active(
    lsc: &LogSegmentsCache,
    last_received_replication_wal_seq: u64,
    last_self_acked_wal_seq: u64,) -> ShardLogHeader {
    let active_file = lsc.active_file.borrow();
    active_file.metadata.borrow().write.to_shard_log_header(&active_file.cursor, 10, 20)
}`;

const captureTargets = (anchor) =>
  refineTargets({
    languageId: "rust",
    code: CAPTURE,
    spanStartLine: 5,
    spanStartCharacter: 0,
    max: 6,
    anchor,
  }).map((t) => t.name);

test("without an anchor the order is document order, and the failing call is not first", () => {
  const names = captureTargets(undefined);
  assert.deepEqual(names.slice(0, 2), ["borrow", "to_shard_log_header"]);
});

test("anchored at the argument rustc pointed at, the failing call leads", () => {
  const lines = CAPTURE.split("\n");
  const row = 5;
  const column = lines[row].indexOf("&active_file.cursor") + 1;
  const names = captureTargets({ line: 5 + row, character: column });
  assert.equal(names[0], "to_shard_log_header", `got ${JSON.stringify(names)}`);
});

test("the anchor picks the ENCLOSING call, not the nearest name", () => {
  // `borrow` sits closer to the argument by character distance than the call
  // name does, and it does not enclose it. Enclosure wins.
  const lines = CAPTURE.split("\n");
  const row = 5;
  const column = lines[row].indexOf("&active_file.cursor") + 1;
  const targets = refineTargets({
    languageId: "rust",
    code: CAPTURE,
    spanStartLine: 5,
    spanStartCharacter: 0,
    max: 6,
    anchor: { line: 5 + row, character: column },
  });
  const call = targets.find((t) => t.name === "to_shard_log_header");
  const borrow = targets.find((t) => t.name === "borrow");
  assert.ok(call && borrow, "both calls are still targets");
  assert.ok(targets.indexOf(call) < targets.indexOf(borrow), "the enclosing call outranks the nearer one");
});

// The scout measured these as targets in three languages, each one a reference
// round trip spent on the language's call shape rather than the repo's.
const STATIC_CASES = [
  { lang: "csharp", code: `void F() {\n    Console.WriteLine(x);\n    var m = Math.Max(a, b);\n    cache.Store(m);\n}`, gone: ["WriteLine", "Max"], kept: "Store" },
  { lang: "go", code: `func F() {\n    fmt.Println(x)\n    cache.Store(x)\n}`, gone: ["Println"], kept: "Store" },
  { lang: "python", code: `def f(self):\n    blob = json.dumps(x)\n    self.cache.store(blob)\n`, gone: ["dumps"], kept: "store" },
  { lang: "typescript", code: `function f() {\n  console.log(x);\n  cache.store(x);\n}`, gone: ["log"], kept: "store" },
];

for (const c of STATIC_CASES) {
  test(`${c.lang}: a standard-library static is not a target, and the repo's own call still is`, () => {
    const names = refineTargets({
      languageId: c.lang,
      code: c.code,
      spanStartLine: 0,
      spanStartCharacter: 0,
      max: 6,
    })
      .filter((t) => t.via === "member")
      .map((t) => t.name);
    for (const g of c.gone) {
      assert.ok(!names.includes(g), `${g} is still a target: ${JSON.stringify(names)}`);
    }
    assert.ok(names.includes(c.kept), `${c.kept} was dropped too: ${JSON.stringify(names)}`);
  });
}

// ===========================================================================
// 2. THE CALL-OWNER LEG. A bare name cannot be anchored by the pre-fill engine,
// so the only thing that makes this leg work is the cursor it carries.
// ===========================================================================

const doc = {
  languageId: "rust",
  uri: { fsPath: "/x/a.rs", path: "/x/a.rs", scheme: "file", toString: () => "file:///x/a.rs" },
  getText: () => "",
};

const target = (name) => ({ name, line: 5, character: 40, via: "member" });

// rust-analyzer's own shape: the `impl` block is an Object symbol and the struct
// is its SIBLING, so the impl node is the only thing enclosing a method cursor.
const implTree = (typeName, method) => [
  {
    name: `impl ${typeName}`,
    kind: 18,
    range: { start: { line: 90, character: 0 }, end: { line: 120, character: 1 } },
    selectionRange: { start: { line: 90, character: 5 }, end: { line: 90, character: 20 } },
    children: [
      {
        name: method,
        kind: 5,
        range: { start: { line: 95, character: 4 }, end: { line: 99, character: 5 } },
        selectionRange: { start: { line: 95, character: 11 }, end: { line: 95, character: 30 } },
        children: [],
      },
    ],
  },
];

const extractorFor = (defs) => ({
  definition: async (cursor) => defs[cursor.line] ?? defs.default,
  completeMembers: async () => [],
  hoverSurface: async () => undefined,
  membersOfType: async () => [],
  example: async () => undefined,
  qualifyImport: async () => undefined,
});

const DEF = {
  uri: "file:///x/log_segment_cursor.rs",
  range: { startLine: 95, startCharacter: 11, endLine: 95, endCharacter: 30 },
};

test("a resolved owner comes back with the cursor of its DECLARATION, not a bare name", async () => {
  stubState.symbols = implTree("LogSegmentCursor", "to_shard_log_header");
  const lines = [];
  const owners = await resolveCallOwners(
    extractorFor({ default: DEF }),
    doc,
    [target("to_shard_log_header")],
    (l) => lines.push(l),
  );
  assert.equal(owners.length, 1, JSON.stringify(lines));
  assert.equal(owners[0].name, "LogSegmentCursor");
  assert.equal(owners[0].member, "to_shard_log_header");
  assert.equal(owners[0].cursor.uri, "file:///x/log_segment_cursor.rs");
  // The container's own name token, which is where the pre-fill engine resolves
  // a shape from. Not the method's, and not line 0.
  assert.equal(owners[0].cursor.line, 90);
});

test("a std owner is dropped, because its members are the language's and not the repo's", async () => {
  stubState.symbols = implTree("Vec", "push");
  const lines = [];
  const owners = await resolveCallOwners(extractorFor({ default: DEF }), doc, [target("push")], (l) => lines.push(l));
  assert.deepEqual(owners, []);
});

test("the keep cap is 2, because the pre-fill cap downstream is 4 and cuts from the tail", async () => {
  stubState.symbols = [
    ...implTree("AlphaType", "one"),
    {
      name: "impl BetaType",
      kind: 18,
      range: { start: { line: 200, character: 0 }, end: { line: 260, character: 1 } },
      selectionRange: { start: { line: 200, character: 5 }, end: { line: 200, character: 15 } },
      children: [
        {
          name: "two",
          kind: 5,
          range: { start: { line: 205, character: 4 }, end: { line: 209, character: 5 } },
          selectionRange: { start: { line: 205, character: 11 }, end: { line: 205, character: 14 } },
          children: [],
        },
      ],
    },
  ];
  const defs = {
    1: { uri: "file:///x/a.rs", range: { startLine: 95, startCharacter: 11, endLine: 95, endCharacter: 30 } },
    2: { uri: "file:///x/a.rs", range: { startLine: 205, startCharacter: 11, endLine: 205, endCharacter: 14 } },
    3: { uri: "file:///x/a.rs", range: { startLine: 96, startCharacter: 11, endLine: 96, endCharacter: 14 } },
  };
  const owners = await resolveCallOwners(
    extractorFor(defs),
    doc,
    [
      { name: "one", line: 1, character: 4, via: "member" },
      { name: "two", line: 2, character: 4, via: "member" },
      { name: "three", line: 3, character: 4, via: "member" },
    ],
    () => {},
  );
  assert.equal(owners.length, 2, `kept ${owners.map((o) => o.name).join(",")}`);
  assert.deepEqual(owners.map((o) => o.name), ["AlphaType", "BetaType"]);
});

test("a call the server cannot place says so, naming the call and the reason", async () => {
  stubState.symbols = [];
  const lines = [];
  const owners = await resolveCallOwners(
    { ...extractorFor({}), definition: async () => undefined },
    doc,
    [target("to_shard_log_header")],
    (l) => lines.push(l),
  );
  assert.deepEqual(owners, []);
  const line = lines.find((l) => l.includes("call owner unresolved"));
  assert.ok(line, `no line: ${JSON.stringify(lines)}`);
  assert.match(line, /to_shard_log_header/);
  assert.match(line, /no definition/);
});

test("a free function is an honest answer, not a failure", async () => {
  stubState.symbols = [
    {
      name: "parse_config",
      kind: 11,
      range: { start: { line: 90, character: 0 }, end: { line: 99, character: 1 } },
      selectionRange: { start: { line: 90, character: 3 }, end: { line: 90, character: 15 } },
      children: [],
    },
  ];
  const lines = [];
  const owners = await resolveCallOwners(
    extractorFor({ default: { uri: "file:///x/a.rs", range: { startLine: 90, startCharacter: 3, endLine: 90, endCharacter: 15 } } }),
    doc,
    [target("parse_config")],
    (l) => lines.push(l),
  );
  assert.deepEqual(owners, []);
  assert.ok(
    lines.some((l) => l.includes("inside no type")),
    `expected the free-function reason: ${JSON.stringify(lines)}`,
  );
});

test("a type target is never looked up: types are not calls", async () => {
  stubState.symbols = implTree("LogSegmentCursor", "to_shard_log_header");
  let asked = 0;
  const owners = await resolveCallOwners(
    {
      ...extractorFor({ default: DEF }),
      definition: async () => {
        asked++;
        return DEF;
      },
    },
    doc,
    [{ name: "LogHeader", line: 1, character: 4, via: "type" }],
    () => {},
  );
  assert.deepEqual(owners, []);
  assert.equal(asked, 0, "a type target spent a definition round trip");
});

// ===========================================================================
// 3. THE PROMPT. Where the usage sections land, and that absence is identity.
// ===========================================================================

const ERR = {
  kind: "compile-error",
  level: "error",
  code: "E0609",
  message: "no field `cursor` on type `Ref<'_, Rc<SegmentFile>>`",
  rendered: "error[E0609]: no field `cursor` on type `Ref<'_, Rc<SegmentFile>>`",
  spans: [{ fileName: "lib.rs", lineStart: 3, lineEnd: 3, columnStart: 40, columnEnd: 52, isPrimary: true }],
  suggestions: [],
};

test("the usage sections sit between the injected surface and the failing code", () => {
  const prompt = assembleRepairPrompt({
    languageId: "rust",
    code: CAPTURE,
    diagnostics: [ERR],
    surface: "API surface for `LogSegmentCursor`",
    usage: ["How this repository already calls `to_shard_log_header`:\n```\nx.to_shard_log_header(a, b, c)\n```"],
  });
  const surfaceAt = prompt.indexOf("API surface for");
  const usageAt = prompt.indexOf("How this repository already calls");
  const codeAt = prompt.indexOf("The function below failed the compiler check:");
  const diagAt = prompt.indexOf("Compiler diagnostics:");
  assert.ok(surfaceAt >= 0 && usageAt >= 0 && codeAt >= 0 && diagAt >= 0, "every section is present");
  assert.ok(surfaceAt < usageAt, "surface leads usage");
  assert.ok(usageAt < codeAt, "usage sits nearest the code of the injected blocks");
  assert.ok(codeAt < diagAt, "the diagnostics still follow the code");
});

test("no usage reproduces the prompt byte for byte", () => {
  const base = { languageId: "rust", code: CAPTURE, diagnostics: [ERR], surface: "S" };
  assert.equal(assembleRepairPrompt(base), assembleRepairPrompt({ ...base, usage: [] }));
  assert.equal(assembleRepairPrompt(base), assembleRepairPrompt({ ...base, usage: undefined }));
});
