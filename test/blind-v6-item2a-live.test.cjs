// Blind oracle for P4 item 2a: the `membersOfType` extractor capability, LIVE
// against real rust-analyzer on the cohort-tally crate. Contract: the P4 item
// 2a surface document (L1/L2/L3), with the empirical documentSymbol shape from
// the item-2 investigation.
//
// The capability under test does NOT exist yet - `extractor.membersOfType` is
// undefined, so every bar that calls it is RED-before-green ("membersOfType is
// not a function"). L2 (hover) exercises the already-shipped `hoverSurface` and
// is expected to pass; it guards the data-shape input 2b builds on. This file
// is the black-box contract, written without reading the extractor impl bodies.
//
// Blind-oracle discipline (blind6-ra-live pattern): one RA lifecycle, three
// independent bars. The oracle transport (RaLspExtractor) drives real RA; the
// product transport (RaCommandExtractor) is driven through a FROZEN fake
// RaCommandRunner whose documentSymbol response is a faithful hierarchical
// DocumentSymbol[] per investigation §1(A). L3 asserts both render the SAME
// member signatures - the bar that catches the oracle capability asymmetry
// (flat SymbolInformation -> empty members) once membersOfType exists.
//
// Live only. SKIP_LIVE=1 skips it (and does not start RA).
// Run live: node --test --test-concurrency=1 test/blind-v6-item2a-live.test.cjs

const { test, before, after } = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const os = require("os");
const esbuild = require("esbuild");
const { pathToFileURL } = require("url");

const SKIP = process.env.SKIP_LIVE === "1" ? "SKIP_LIVE=1" : false;
const LIVE_TIMEOUT = 180_000;
const READY_TIMEOUT = 120_000;

// One bundle carries BOTH transports plus the pure renderer. The vscode-stub
// alias lets the product-layer file (raExtractor) resolve its `vscode` import
// headlessly (impl*-vscode pattern); the oracle-layer file (raLspClient) does
// not import vscode, so the alias is inert for it. Nothing here reads src/**
// contents - esbuild resolves modules at bundle time only.
const STUB = path.join(__dirname, ".blind-v6-item2a-live-vscode-stub.cjs");
fs.writeFileSync(
  STUB,
  `
module.exports = {
  // completion path enum (existing surface)
  CompletionItemKind: {
    Text: 0, Method: 1, Function: 2, Constructor: 3, Field: 4, Variable: 5,
    Class: 6, Interface: 7, Module: 8, Property: 9, Unit: 10, Value: 11,
    Enum: 12, Keyword: 13, Snippet: 14, Color: 15, File: 16, Reference: 17,
    Folder: 18, EnumMember: 19, Constant: 20, Struct: 21, Event: 22,
    Operator: 23, TypeParameter: 24,
  },
  // documentSymbol path enum (new). vscode.SymbolKind is 0-indexed and DIFFERS
  // from CompletionItemKind: Struct=22, Method=5, Field=7, Function=11.
  SymbolKind: {
    File: 0, Module: 1, Namespace: 2, Package: 3, Class: 4, Method: 5,
    Property: 6, Field: 7, Constructor: 8, Enum: 9, Interface: 10, Function: 11,
    Variable: 12, Constant: 13, String: 14, Number: 15, Boolean: 16, Array: 17,
    Object: 18, Key: 19, Null: 20, EnumMember: 21, Struct: 22, Event: 23,
    Operator: 24, TypeParameter: 25,
  },
  Uri: { parse: (s) => ({ toString: () => s }), file: (s) => ({ toString: () => "file://" + s }) },
  Position: class { constructor(line, character) { this.line = line; this.character = character; } },
  Range: class { constructor(a, b, c, d) { this.start = { line: a, character: b }; this.end = { line: c, character: d }; } },
  MarkdownString: class { constructor(value) { this.value = value; } },
  Hover: class { constructor(contents) { this.contents = contents; } },
  Location: class { constructor(uri, range) { this.uri = uri; this.range = range; } },
  commands: { executeCommand: async () => undefined },
  workspace: {},
};
`
);

const entry = path.join(__dirname, ".blind-v6-item2a-live.entry.ts");
const outfile = path.join(__dirname, ".blind-v6-item2a-live.bundle.cjs");
fs.writeFileSync(
  entry,
  `export { RaLspExtractor } from "../src/core/raLspClient";
export { RaCommandExtractor } from "../src/vscode/raExtractor";
export { renderMemberSignatures } from "../src/core/extraction";\n`
);
esbuild.buildSync({
  entryPoints: [entry],
  bundle: true,
  outfile,
  format: "cjs",
  platform: "node",
  alias: { vscode: STUB },
});
const { RaLspExtractor, RaCommandExtractor, renderMemberSignatures } = require(outfile);
after(() => {
  fs.rmSync(entry, { force: true });
  fs.rmSync(outfile, { force: true });
  fs.rmSync(STUB, { force: true });
});

const FIXTURE = path.join(__dirname, "..", "session-v6", "harness", "fixtures", "cohort-tally", "crate");

// Scratch copy per run; the repo fixture is read-only donor material. Skip the
// committed target/ so RA indexes cleanly from source in the scratch dir.
const scratchCopy = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "blind-v6-2a-"));
  fs.cpSync(FIXTURE, dir, {
    recursive: true,
    filter: (src) => !src.split(path.sep).includes("target"),
  });
  return dir;
};

// defCursor CHOICE (documented): the STRUCT DEFINITION name position. Scan for
// `struct CohortRegister`, take the column of the `CohortRegister` identifier on
// that line -> {line:6, character:11}. This matches investigation §1(A)'s Struct
// selectionRange (sel=L6:11) and §1(D)'s workspace/symbol location, and is the
// anchor the item-2 fileLocalDefinitions scan yields for a doc-only local type.
const structDefCursor = (uri, text) => {
  const lines = text.split("\n");
  for (let line = 0; line < lines.length; line++) {
    if (lines[line].includes("struct CohortRegister")) {
      return { uri, line, character: lines[line].indexOf("CohortRegister") };
    }
  }
  assert.fail("no line contains `struct CohortRegister`");
};

const siteInside = (uri, text, ident) => {
  const lines = text.split("\n");
  for (let line = 0; line < lines.length; line++) {
    if (lines[line].trim().startsWith("//")) continue;
    const at = lines[line].indexOf(ident);
    if (at >= 0) return { uri, line, character: at + 2 };
  }
  assert.fail(`no code line contains ${JSON.stringify(ident)}`);
};

// ---- Faithful hierarchical DocumentSymbol[] for CohortRegister, per §1(A).
// vscode.DocumentSymbol shape ASSUMED: { name, detail, kind, range,
// selectionRange, children }, kind = vscode.SymbolKind (0-indexed). Ranges are
// the real lib.rs spans (0-indexed lines): struct L6-8, impl L10-39, free fn
// L45-47. `detail` carries the AST signature WITH parameter names (§1(A):
// "fn(&self, cohort: u32) -> usize") - the richer-than-completion form.
const SK = { Struct: 22, Field: 7, Method: 5, Function: 11, Object: 18 };
const R = (sl, sc, el, ec) => ({ start: { line: sl, character: sc }, end: { line: el, character: ec } });
const cohortDocSymbols = () => [
  {
    name: "CohortRegister",
    detail: undefined, // struct detail is undefined in RA documentSymbol (§1(A))
    kind: SK.Struct,
    range: R(6, 0, 8, 1),
    selectionRange: R(6, 11, 6, 25),
    children: [
      { name: "by_cohort", detail: "HashMap<u32, Vec<u64>>", kind: SK.Field, range: R(7, 4, 7, 36), selectionRange: R(7, 4, 7, 13), children: [] },
    ],
  },
  {
    name: "impl CohortRegister",
    detail: undefined,
    kind: SK.Object, // impl blocks: vscode SymbolKind ASSUMED Object (no dedicated impl kind)
    range: R(10, 0, 39, 1),
    selectionRange: R(10, 5, 10, 19),
    children: [
      { name: "new", detail: "fn() -> Self", kind: SK.Function, range: R(12, 4, 14, 5), selectionRange: R(12, 11, 12, 14), children: [] },
      { name: "induct", detail: "fn(&mut self, ticket_id: u64, cohort: u32)", kind: SK.Method, range: R(32, 4, 34, 5), selectionRange: R(32, 11, 32, 17), children: [] },
      { name: "tally_cohort", detail: "fn(&self, cohort: u32) -> usize", kind: SK.Method, range: R(36, 4, 38, 5), selectionRange: R(36, 11, 36, 23), children: [] },
    ],
  },
  {
    name: "tally_cohort_seven",
    detail: "fn() -> usize",
    kind: SK.Function, // a NON-container top-level fn
    range: R(45, 0, 47, 1),
    selectionRange: R(45, 3, 45, 21),
    children: [],
  },
];

// Frozen fake RaCommandRunner: dispatch on the command string, return the
// authored documentSymbol[] for the documentSymbol provider command.
const docSymRunner = (symbols) => async (command) => {
  const c = String(command).toLowerCase();
  if (c.includes("documentsymbol")) return symbols;
  return undefined;
};

let ctx = null;

before(async () => {
  if (SKIP) return; // do NOT start RA under SKIP_LIVE
  process.env.CARGO_NET_OFFLINE = "true";
  const workspaceRoot = scratchCopy();
  const mainPath = path.join(workspaceRoot, "src", "lib.rs");
  const uri = pathToFileURL(mainPath).href;
  const text = fs.readFileSync(mainPath, "utf8");
  const extractor = await RaLspExtractor.start({ workspaceRoot });
  extractor.openDocument(uri, text);
  await extractor.whenReady(READY_TIMEOUT);
  ctx = { extractor, workspaceRoot, uri, text };
}, { timeout: LIVE_TIMEOUT });

after(() => {
  if (!ctx) return;
  ctx.extractor.dispose();
  fs.rmSync(ctx.workspaceRoot, { recursive: true, force: true });
});

// ---- L1: real members with signatures from the DEFINITION (RED: membersOfType
// missing). renderMemberSignatures must surface induct + tally_cohort and NO
// invented name. tally_cohort is the decisive method v5 could not reach.
test("L1 membersOfType at CohortRegister def renders real signatures, no invented names", { skip: SKIP, timeout: LIVE_TIMEOUT }, async () => {
  const { extractor, uri, text } = ctx;
  const defCursor = structDefCursor(uri, text);
  const members = await extractor.membersOfType(defCursor);
  const payload = renderMemberSignatures(members);
  assert.ok(payload.includes("induct(&mut self"), `must render induct, got ${JSON.stringify(payload)}`);
  assert.ok(payload.includes("tally_cohort(&self, u32) -> usize"), `must render tally_cohort exactly, got ${JSON.stringify(payload)}`);
  for (const invented of ["count", "add", "insert"]) {
    assert.ok(!payload.includes(invented), `must NOT render invented name ${invented}, got ${JSON.stringify(payload)}`);
  }
});

// ---- L2: data shape via hover (already-shipped hoverSurface; expected GREEN).
// Guards the struct-def input 2b injects alongside the member list.
test("L2 hoverSurface at the struct returns the data shape (pub struct + by_cohort field)", { skip: SKIP, timeout: LIVE_TIMEOUT }, async () => {
  const { extractor, uri, text } = ctx;
  const hover = await extractor.hoverSurface(siteInside(uri, text, "CohortRegister"));
  assert.ok(hover, "struct hover resolves");
  assert.ok(hover.signature.startsWith("pub struct CohortRegister"), `got ${JSON.stringify(hover.signature)}`);
  assert.ok(hover.signature.includes("by_cohort"), `hover names the field by_cohort, got ${JSON.stringify(hover.signature)}`);
  assert.ok(hover.signature.includes("HashMap<u32, Vec<u64>>"), `hover names the field type, got ${JSON.stringify(hover.signature)}`);
});

// ---- L3: transport parity (RED: membersOfType missing on BOTH transports).
// Oracle (real RA) and product (frozen fake documentSymbol runner) must render
// the SAME member signatures. Once implemented, this catches the oracle-side
// capability asymmetry: without hierarchicalDocumentSymbolSupport the oracle
// gets flat SymbolInformation (detail=undefined) -> empty members -> mismatch.
test("L3 oracle and product transports render identical member signatures for CohortRegister", { skip: SKIP, timeout: LIVE_TIMEOUT }, async () => {
  const { extractor, uri, text } = ctx;
  const defCursor = structDefCursor(uri, text);

  const oracleRender = renderMemberSignatures(await extractor.membersOfType(defCursor));

  const product = new RaCommandExtractor(docSymRunner(cohortDocSymbols()));
  const productRender = renderMemberSignatures(await product.membersOfType(defCursor));

  assert.ok(oracleRender.length > 0, "oracle render is non-empty (asymmetry guard: flat SymbolInformation would empty it)");
  assert.strictEqual(productRender, oracleRender, "product and oracle must render identical member signatures");
});
