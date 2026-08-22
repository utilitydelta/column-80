// Blind oracle for P4 item 2a: the P-map bar - `RaCommandExtractor.membersOfType`
// maps a hierarchical documentSymbol response into CompletionMember[]. PURE /
// headless (blind6-command-adapter pattern: vscode stub + esbuild vscode alias +
// fake RaCommandRunner). Contract: the P4 item 2a surface document (P-map).
// Empirical documentSymbol shape: investigation-item2.md §1(A).
//
// membersOfType does NOT exist yet, so every case is RED-before-green
// ("membersOfType is not a function"). The FILE still LOADS (esbuild bundles the
// surface without typechecking); the assertions are the falsification bars the
// implementer turns green. Runs under SKIP_LIVE (headless - no live gate).
//
// Run: SKIP_LIVE=1 node --test test/blind-v6-item2a-adapter.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");

const STUB = path.join(__dirname, ".blind-v6-item2a-adapter-vscode-stub.cjs");
fs.writeFileSync(
  STUB,
  `
module.exports = {
  CompletionItemKind: {
    Text: 0, Method: 1, Function: 2, Constructor: 3, Field: 4, Variable: 5,
    Class: 6, Interface: 7, Module: 8, Property: 9, Unit: 10, Value: 11,
    Enum: 12, Keyword: 13, Snippet: 14, Color: 15, File: 16, Reference: 17,
    Folder: 18, EnumMember: 19, Constant: 20, Struct: 21, Event: 22,
    Operator: 23, TypeParameter: 24,
  },
  // vscode.SymbolKind (0-indexed) - the documentSymbol enum. Distinct from
  // CompletionItemKind: Struct=22, Method=5, Field=7, Function=11, Object=18.
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

const entry = path.join(__dirname, ".blind-v6-item2a-adapter.entry.ts");
const outfile = path.join(__dirname, ".blind-v6-item2a-adapter.bundle.cjs");
fs.writeFileSync(
  entry,
  `export { RaCommandExtractor } from "../src/vscode/raExtractor";
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
const { RaCommandExtractor, renderMemberSignatures } = require(outfile);
test.after(() => {
  fs.rmSync(entry, { force: true });
  fs.rmSync(outfile, { force: true });
  fs.rmSync(STUB, { force: true });
});

// vscode.SymbolKind values the documentSymbol payload uses.
const SK = { Struct: 22, Field: 7, Method: 5, Function: 11, Object: 18 };
const R = (sl, sc, el, ec) => ({ start: { line: sl, character: sc }, end: { line: el, character: ec } });

const URI = "file:///x/lib.rs";
// Cursor CHOICE: the struct definition name (line 6, char 11) - matches the
// CohortRegister struct selectionRange, the anchor item 2 yields for a doc-only
// local type. It sits inside the struct symbol range (L6-8) but the METHODS live
// in the SIBLING impl symbol (L10-39) - so a correct membersOfType must gather
// the struct's field AND descend the sibling impl blocks (SURFACE-p4-item2a).
const STRUCT_CURSOR = { uri: URI, line: 6, character: 11 };
// A position in NO symbol range (the `use` line, L2) - outside every container.
const OUTSIDE_CURSOR = { uri: URI, line: 2, character: 0 };
// A position inside the free fn tally_cohort_seven (L45-47) - a NON-container.
const NONCONTAINER_CURSOR = { uri: URI, line: 46, character: 4 };

// Faithful hierarchical DocumentSymbol[] for the cohort-tally lib.rs, per §1(A).
// ASSUMED vscode.DocumentSymbol shape: { name, detail, kind, range,
// selectionRange, children }. Method/fn `detail` carries the AST signature WITH
// parameter names (the richer-than-completion form §1(A) documents).
const cohortDocSymbols = () => [
  {
    name: "CohortRegister",
    detail: undefined,
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
    kind: SK.Object,
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
    kind: SK.Function,
    range: R(45, 0, 47, 1),
    selectionRange: R(45, 3, 45, 21),
    children: [],
  },
];

// Fake RaCommandRunner: dispatch on the command string. documentSymbol provider
// returns the authored DocumentSymbol[]; everything else returns undefined.
const docSymRunner = (symbols) => async (command) => {
  const c = String(command).toLowerCase();
  if (c.includes("documentsymbol")) return symbols;
  return undefined;
};

const byName = (members, name) => members.find((m) => m.name === name);

// ---- P-map: hierarchical documentSymbol -> CompletionMember[] (kinds + detail
// -> signature). Field from the struct child, methods/fn from the sibling impl.
test("P-map: documentSymbol descent yields the field + sibling-impl members with kinds and signatures", async () => {
  const extractor = new RaCommandExtractor(docSymRunner(cohortDocSymbols()));
  const members = await extractor.membersOfType(STRUCT_CURSOR);

  const names = members.map((m) => m.name);
  for (const n of ["by_cohort", "new", "induct", "tally_cohort"]) {
    assert.ok(names.includes(n), `member set must include ${n}, got ${JSON.stringify(names)}`);
  }

  const field = byName(members, "by_cohort");
  assert.strictEqual(field.kind, "field", "by_cohort maps to a field member (SymbolKind.Field -> field)");

  const ctor = byName(members, "new");
  assert.strictEqual(ctor.kind, "function", "new maps to a function member (SymbolKind.Function -> function)");
  assert.ok(ctor.signature && ctor.signature.startsWith("new("), `new signature from detail, got ${JSON.stringify(ctor.signature)}`);

  const induct = byName(members, "induct");
  assert.strictEqual(induct.kind, "method", "induct maps to a method member (SymbolKind.Method -> method)");
  assert.ok(induct.signature && induct.signature.startsWith("induct("), `induct signature from detail, got ${JSON.stringify(induct.signature)}`);
  assert.ok(induct.signature.includes("&mut self"), `induct signature retains &mut self, got ${JSON.stringify(induct.signature)}`);

  const tally = byName(members, "tally_cohort");
  assert.strictEqual(tally.kind, "method", "tally_cohort maps to a method member");
  assert.ok(tally.signature && tally.signature.startsWith("tally_cohort("), `tally_cohort signature from detail, got ${JSON.stringify(tally.signature)}`);
  assert.ok(tally.signature.includes("usize"), `tally_cohort signature retains the return type, got ${JSON.stringify(tally.signature)}`);

  // The renderer drops the field (no fn signature) and surfaces the methods -
  // the same pure helper the completion path uses.
  const rendered = renderMemberSignatures(members);
  assert.ok(rendered.includes("induct("), `rendered payload surfaces induct, got ${JSON.stringify(rendered)}`);
  assert.ok(rendered.includes("tally_cohort("), `rendered payload surfaces tally_cohort, got ${JSON.stringify(rendered)}`);
});

// ---- degrade: cursor OUTSIDE any container -> [] (no struct/enum/impl encloses
// the position).
test("P-map: cursor outside any container yields []", async () => {
  const extractor = new RaCommandExtractor(docSymRunner(cohortDocSymbols()));
  assert.deepStrictEqual(await extractor.membersOfType(OUTSIDE_CURSOR), [], "no enclosing container -> []");
});

// ---- degrade: cursor on a NON-container (a free fn) -> [] (a fn is not a
// struct/enum/impl the capability enumerates).
test("P-map: cursor on a non-container (free fn) yields []", async () => {
  const extractor = new RaCommandExtractor(docSymRunner(cohortDocSymbols()));
  assert.deepStrictEqual(await extractor.membersOfType(NONCONTAINER_CURSOR), [], "non-container symbol -> []");
});

// ---- never throws: absent documentSymbol provider (runner -> undefined)
// degrades to [], and an empty symbol list degrades to [].
test("P-map: absent/empty documentSymbol response degrades to [] and never throws", async () => {
  const absent = new RaCommandExtractor(async () => undefined);
  assert.deepStrictEqual(await absent.membersOfType(STRUCT_CURSOR), [], "absent provider -> []");
  const empty = new RaCommandExtractor(docSymRunner([]));
  assert.deepStrictEqual(await empty.membersOfType(STRUCT_CURSOR), [], "empty symbol list -> []");
});

// ---- F1: wrong-type method leak. A sibling `impl From<Register> for Cohort`
// is Cohort's impl, not Register's - its `from` method must NOT appear in
// membersOfType(Register). A bare `\bRegister\b` substring against the impl
// header WOULD leak it (Register appears inside the generic argument); the
// self-type parse (impl's type is the token after `for`) rejects it.
const f1DocSymbols = () => [
  {
    name: "Register",
    detail: undefined,
    kind: SK.Struct,
    range: R(0, 0, 2, 1),
    selectionRange: R(0, 11, 0, 19),
    children: [
      { name: "id", detail: "u64", kind: SK.Field, range: R(1, 4, 1, 12), selectionRange: R(1, 4, 1, 6), children: [] },
    ],
  },
  {
    name: "impl From<Register> for Cohort",
    detail: undefined,
    kind: SK.Object,
    range: R(4, 0, 8, 1),
    selectionRange: R(4, 5, 4, 30),
    children: [
      { name: "from", detail: "fn(r: Register) -> Cohort", kind: SK.Method, range: R(5, 4, 7, 5), selectionRange: R(5, 11, 5, 15), children: [] },
    ],
  },
];
const F1_REGISTER_CURSOR = { uri: URI, line: 0, character: 11 };

test("P-map (F1): a trait impl FOR another type does not leak its method into membersOfType", async () => {
  const extractor = new RaCommandExtractor(docSymRunner(f1DocSymbols()));
  const members = await extractor.membersOfType(F1_REGISTER_CURSOR);
  const names = members.map((m) => m.name);
  assert.ok(!names.includes("from"), `must NOT leak Cohort's from into Register's members, got ${JSON.stringify(names)}`);
  // Register's own members only: the field `id` (renders to nothing), no methods.
  for (const n of names) {
    assert.strictEqual(n, "id", `only Register's own members allowed, got stray ${JSON.stringify(n)}`);
  }
  assert.strictEqual(renderMemberSignatures(members), "", "Register has no methods -> empty rendered surface");
});

// ---- F2: module-nested type. Most real local types live in a `mod`, so the
// descent must recurse: `mod foo { struct S; impl S { fn m } }` at S's def cursor
// (inside the module) must return S's members incl. `m`, gathering the impl that
// sits as a SIBLING of the struct inside the module's children.
const SK_MODULE = 1; // vscode.SymbolKind.Module
const f2DocSymbols = () => [
  {
    name: "foo",
    detail: undefined,
    kind: SK_MODULE,
    range: R(0, 0, 10, 1),
    selectionRange: R(0, 4, 0, 7),
    children: [
      {
        name: "S",
        detail: undefined,
        kind: SK.Struct,
        range: R(1, 4, 3, 5),
        selectionRange: R(1, 15, 1, 16),
        children: [
          { name: "v", detail: "u32", kind: SK.Field, range: R(2, 8, 2, 16), selectionRange: R(2, 8, 2, 9), children: [] },
        ],
      },
      {
        name: "impl S",
        detail: undefined,
        kind: SK.Object,
        range: R(5, 4, 9, 5),
        selectionRange: R(5, 9, 5, 10),
        children: [
          { name: "m", detail: "fn(&self) -> u32", kind: SK.Method, range: R(6, 8, 8, 9), selectionRange: R(6, 11, 6, 12), children: [] },
        ],
      },
    ],
  },
];
const F2_S_CURSOR = { uri: URI, line: 1, character: 15 };

test("P-map (F2): a module-nested type resolves its members via recursive descent", async () => {
  const extractor = new RaCommandExtractor(docSymRunner(f2DocSymbols()));
  const members = await extractor.membersOfType(F2_S_CURSOR);
  const names = members.map((m) => m.name);
  assert.ok(names.includes("v"), `struct field surfaced, got ${JSON.stringify(names)}`);
  assert.ok(names.includes("m"), `module-nested impl method surfaced, got ${JSON.stringify(names)}`);
  const method = byName(members, "m");
  assert.strictEqual(method.kind, "method", "m maps to a method member");
  assert.ok(renderMemberSignatures(members).includes("m("), "rendered surface includes the nested method m");
});
