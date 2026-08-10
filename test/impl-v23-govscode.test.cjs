// Implementer's suite for the v23 VSCODE-LAYER Go rows (session-v23
// dispatch-map rows 2, 11, 15, 20, 21, 22 + the product transport). The blind
// v23 suites pin the core contract (goExtraction / goLspExtractor / goOracle);
// this suite exercises the vscode-side rows the way the sibling languages'
// impl suites do: the enum bridges (vscode renumbers both LSP enums one
// lower), the Go type anchor + its dispatch, the prefill candidate seam
// (impl-v10-gestures section 6's Go analog), the type-gen admission
// (blind-v12-admit's Go analog), the product transport against a fake runner
// (the csExtractor/pyExtractor convention), and the extractorFor registry row.
// Each case names the invariant it proves.
//
// Run: SKIP_LIVE=1 node --test test/impl-v23-govscode.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");
const { bundleCore } = require("./.blind-util.cjs");

// ---- Bundle 1: pure core helpers + the vscode-free product transport. ----
// goExtractor.ts never imports vscode (the injected runner does), so it
// bundles through the plain core bundler like csExtractor/pyExtractor do in
// their blind suites.
const { mod: core, cleanup: coreCleanup } = bundleCore(
  "impl-v23-govscode-core",
  `export { goFindTypeAnchorInText } from "../src/core/fimWholeBlock";\n` +
    `export { findArgTypeAnchor } from "../src/core/argTypeSurface";\n` +
    `export { goVscodeCompletionKind, goVscodeSymbolRole, goLspSymbolRole } from "../src/core/goExtraction";\n` +
    `export { GoCommandExtractor } from "../src/vscode/goExtractor";\n`,
);

// ---- Bundle 2: fnGen (imports vscode) vs a STRUCTURAL stub — real
// Position/Range so resolveFunctionAtCursor's span math runs honestly, plus
// the executeCommand hook the admission cases feed symbols through. The stub
// is the blind-v12-admit shape with this suite's own globals. ----
const STUB = path.join(__dirname, ".impl-v23-govscode-stub.cjs");
fs.writeFileSync(
  STUB,
  `
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
const mkUri = (full, fsPath) => ({
  scheme: full.includes("://") ? full.slice(0, full.indexOf("://")) : "file",
  fsPath, path: fsPath, query: "", fragment: "",
  toString: () => full, with() { return this; }, toJSON() { return full; },
});
const Uri = {
  file: (p) => mkUri("file://" + p, p),
  parse: (s) => mkUri(String(s), String(s).replace(/^[a-zA-Z+-]+:\\/\\//, "")),
  joinPath: (base, ...segs) => Uri.file([base.fsPath, ...segs].join("/")),
};
const disposable = () => ({ dispose() {} });
class MarkdownString { constructor(v) { this.value = v || ""; } appendCodeblock(t, l) { this.value += "\\n\`\`\`" + (l || "") + "\\n" + t + "\\n\`\`\`\\n"; } appendMarkdown(t) { this.value += t; } appendText(t) { this.value += t; } }
class ThemeColor { constructor(id) { this.id = id; } }
class Diagnostic { constructor(range, message, severity) { this.range = range; this.message = message; this.severity = severity; } }
class EventEmitter { constructor() { this.h = []; } get event() { return (fn) => { this.h.push(fn); return disposable(); }; } fire(x) { for (const f of this.h) f(x); } dispose() {} }
module.exports = {
  Position, Range, Uri, MarkdownString, ThemeColor, Diagnostic, EventEmitter,
  DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
  SymbolKind: { File: 0, Module: 1, Namespace: 2, Package: 3, Class: 4, Method: 5, Property: 6,
    Field: 7, Constructor: 8, Enum: 9, Interface: 10, Function: 11, Variable: 12, Constant: 13,
    String: 14, Number: 15, Boolean: 16, Array: 17, Object: 18, Key: 19, Null: 20, EnumMember: 21,
    Struct: 22, Event: 23, Operator: 24, TypeParameter: 25 },
  CompletionItemKind: { Method: 1, Function: 2, Field: 4, Variable: 5, Class: 6, Property: 9, Enum: 12, Constant: 20, Struct: 21 },
  OverviewRulerLane: { Left: 1, Center: 2, Right: 4, Full: 7 },
  workspace: {
    getConfiguration: () => ({ get: (k, f) => f, has: () => false, inspect: () => undefined, update: async () => {} }),
    onDidChangeConfiguration: () => disposable(),
    onDidChangeTextDocument: () => disposable(),
    onDidCloseTextDocument: () => disposable(),
    get textDocuments() { return globalThis.__V23GO_OPEN_DOCS__ || []; },
    openTextDocument: async (arg) => {
      const key = typeof arg === "string" ? arg : arg && arg.toString ? arg.toString() : String(arg);
      const docs = globalThis.__V23GO_DOCS__ || {};
      if (docs[key]) return docs[key];
      return { uri: Uri.parse(key), languageId: "plaintext", version: 1, lineCount: 0, getText: () => "", lineAt: () => ({ text: "", firstNonWhitespaceCharacterIndex: 0, isEmptyOrWhitespace: true, range: new Range(0, 0, 0, 0) }), offsetAt: () => 0, positionAt: () => new Position(0, 0) };
    },
  },
  languages: {
    createDiagnosticCollection: (name) => ({ name, set() {}, delete() {}, clear() {}, dispose() {} }),
    getDiagnostics: () => [],
    onDidChangeDiagnostics: () => disposable(),
  },
  window: {
    createOutputChannel: (name) => ({ name, appendLine() {}, append() {}, replace() {}, show() {}, hide() {}, clear() {}, dispose() {} }),
    createTextEditorDecorationType: (opts) => ({ opts, dispose() {} }),
    showInformationMessage: async () => undefined,
    showWarningMessage: async () => undefined,
    showErrorMessage: async () => undefined,
    activeColorTheme: { kind: 1 },
  },
  commands: {
    registerCommand: () => disposable(),
    executeCommand: async (id, uri) => {
      if (id === "vscode.executeDocumentSymbolProvider") {
        const key = uri && uri.toString ? uri.toString() : String(uri);
        return (globalThis.__V23GO_SYMBOLS__ || {})[key];
      }
      return undefined;
    },
  },
};
`,
);

const fEntry = path.join(__dirname, ".impl-v23-govscode-f.entry.ts");
const fOut = path.join(__dirname, ".impl-v23-govscode-f.bundle.cjs");
fs.writeFileSync(
  fEntry,
  `export { resolveFunctionAtCursor, goLocalTypeDefinitions, goPrioritizedTypes } from "../src/vscode/fnGen";\n`,
);
esbuild.buildSync({ entryPoints: [fEntry], bundle: true, outfile: fOut, format: "cjs", platform: "node", alias: { vscode: STUB } });
const fn = require(fOut);

// ---- Bundle 3: extractors.ts (registry) vs a permissive Proxy stub — the
// blind-v10-csextractor sequencing-flip convention. ----
const PROXY_STUB = path.join(__dirname, ".impl-v23-govscode-proxy.js");
const xEntry = path.join(__dirname, ".impl-v23-govscode-x.entry.ts");
const xOut = path.join(__dirname, ".impl-v23-govscode-x.bundle.cjs");
fs.writeFileSync(
  PROXY_STUB,
  "const h={get:()=>new Proxy(function(){},h),apply:()=>undefined};module.exports=new Proxy(function(){},h);",
);
fs.writeFileSync(xEntry, `export { extractorFor } from "../src/vscode/extractors";\n`);
esbuild.buildSync({ entryPoints: [xEntry], bundle: true, outfile: xOut, format: "cjs", platform: "node", alias: { vscode: PROXY_STUB } });
const reg = require(xOut);

test.after(() => {
  coreCleanup();
  for (const f of [STUB, fEntry, fOut, PROXY_STUB, xEntry, xOut]) fs.rmSync(f, { force: true });
});

const { Position, Range, Uri } = require(STUB);
const P = (l, c) => new Position(l, c);
const R = (sl, sc, el, ec) => new Range(sl, sc, el, ec);

// ===========================================================================
// 1. The enum bridges. vscode renumbers BOTH LSP enums one lower; a wrong
//    bridge silently reclassifies every member, so the tables are pinned.
// ===========================================================================

test("goVscodeCompletionKind: the +1 bridge lands each vscode kind on the LSP number the two-rule filter speaks", () => {
  // Snippet 14->15 is the load-bearing pair: the filter drops LSP 15, so an
  // unbridged vscode Snippet (14) would sail through as a postfix `var!` member.
  assert.strictEqual(core.goVscodeCompletionKind(14), 15);
  assert.strictEqual(core.goVscodeCompletionKind(1), 2); // Method
  assert.strictEqual(core.goVscodeCompletionKind(2), 3); // Function
  assert.strictEqual(core.goVscodeCompletionKind(4), 5); // Field
  assert.strictEqual(core.goVscodeCompletionKind(undefined), undefined);
  assert.strictEqual(core.goVscodeCompletionKind("5"), undefined);
});

test("goVscodeSymbolRole: vscode Struct/Interface/Class contain, Method joins, Field is a field — one below the LSP table", () => {
  assert.strictEqual(core.goVscodeSymbolRole(22), "container"); // Struct
  assert.strictEqual(core.goVscodeSymbolRole(10), "container"); // Interface
  assert.strictEqual(core.goVscodeSymbolRole(4), "container"); // Class (named non-struct type)
  assert.strictEqual(core.goVscodeSymbolRole(5), "method");
  assert.strictEqual(core.goVscodeSymbolRole(7), "field");
  assert.strictEqual(core.goVscodeSymbolRole(11), "other"); // Function: never a member
  assert.strictEqual(core.goVscodeSymbolRole(undefined), "other");
});

test("the two role tables agree modulo the renumbering: vscode kind k plays the role LSP kind k+1 plays", () => {
  for (let k = 0; k <= 25; k++) {
    assert.strictEqual(
      core.goVscodeSymbolRole(k),
      core.goLspSymbolRole(k + 1),
      `vscode kind ${k} diverged from LSP kind ${k + 1}`,
    );
  }
});

// ===========================================================================
// 2. goFindTypeAnchorInText — the impl-v11-phase4 Python anchor cases, Go-shaped.
// ===========================================================================

test("goFindTypeAnchorInText: prefers a line inside an `import ( ... )` block over a later code use", () => {
  const text = 'package main\n\nimport (\n\t"go-scratch/atlas"\n)\n\nfunc f(t atlas.Tile) {}\n';
  assert.deepStrictEqual(core.goFindTypeAnchorInText(text, "atlas"), {
    line: 3,
    character: '\t"go-scratch/'.length,
  });
});

test("goFindTypeAnchorInText: prefers a bare `import \"strings\"` line", () => {
  const text = 'package main\n\nimport "strings"\n\nvar b strings.Builder\n';
  assert.deepStrictEqual(core.goFindTypeAnchorInText(text, "strings"), { line: 2, character: 'import "'.length });
});

test("goFindTypeAnchorInText: with no import hit, falls to the first NON-comment reference", () => {
  const text = "// Tile appears in this comment first\nfunc f(t Tile) uint8 {\n\treturn t.Lod\n}\n";
  assert.deepStrictEqual(core.goFindTypeAnchorInText(text, "Tile"), { line: 1, character: "func f(t ".length });
});

test("goFindTypeAnchorInText: a type named ONLY in a `//` comment does not anchor", () => {
  assert.strictEqual(core.goFindTypeAnchorInText("// uses a Tile somewhere\n", "Tile"), undefined);
});

test("goFindTypeAnchorInText: past the block's `)` the import rung is closed again", () => {
  // `Tile` after the block must anchor via the CODE fallback, not read as an
  // import line — a stuck-open flag would call every line an import.
  const text = 'import (\n\t"fmt"\n)\n\nfunc g(t Tile) {}\n';
  assert.deepStrictEqual(core.goFindTypeAnchorInText(text, "Tile"), { line: 4, character: "func g(t ".length });
});

test("goFindTypeAnchorInText: an empty type name is undefined", () => {
  assert.strictEqual(core.goFindTypeAnchorInText('import "fmt"\n', ""), undefined);
});

test("findArgTypeAnchor dispatches the go arm: an import-path segment NEVER anchors - the first CODE occurrence wins [review F24 inversion]", () => {
  // Go imports name PACKAGES, never types: an import-line preference could
  // only ever FALSE-anchor (a lowercase type sharing a path segment lands
  // definition() on the package). The Go arm anchors at the first
  // non-comment code occurrence, comments skipped.
  const text = '// pkgish is discussed here\nimport (\n\t"corp/pkgish"\n)\n\nx := pkgish.Thing()\n';
  const at = core.findArgTypeAnchor("pkgish", { uri: "file:///m/a.go", languageId: "go", text });
  assert.strictEqual(at.line, 2, "the import line IS the first non-comment textual occurrence and stays a plain occurrence");
  const noImport = 'y := 1\nx := pkgish.Thing()\n';
  const at2 = core.findArgTypeAnchor("pkgish", { uri: "file:///m/a.go", languageId: "go", text: noImport });
  assert.strictEqual(at2.line, 1);
});

// ===========================================================================
// 3. The prefill candidate seam (impl-v10-gestures section 6, Go analog).
// ===========================================================================

test("goLocalTypeDefinitions: column-0 `type X` anchors at the name; a comment line never anchors; first wins", () => {
  const src =
    "package atlas\n" +
    "\n" +
    "// type Fake struct — prose, not a decl\n" +
    "type Stripe struct {\n" +
    "\ttiles []Tile\n" +
    "}\n" +
    "\n" +
    "type LodBand interface {\n" +
    "\tSpans(lod uint8) bool\n" +
    "}\n" +
    "\n" +
    "type Stripe struct{}\n";
  const map = fn.goLocalTypeDefinitions(src);
  assert.deepStrictEqual(map.get("Stripe"), { line: 3, character: "type ".length });
  assert.deepStrictEqual(map.get("LodBand"), { line: 7, character: "type ".length });
  assert.strictEqual(map.has("Fake"), false);
  assert.strictEqual(map.size, 2);
});

test("goPrioritizedTypes: the receiver and param/return types are candidates; the declared method name NEVER is (the capitalized-func-name trap)", () => {
  const got = fn.goPrioritizedTypes(
    "func (s *Stripe) Summarize(byLod map[uint8][]Tile) (uint32, error)",
    undefined,
    "",
    new Set(),
    "(*Stripe).Summarize",
  );
  assert.deepStrictEqual(got, ["Stripe", "Tile"]);
});

test("goPrioritizedTypes: std stop-set and single letters filtered; user types kept", () => {
  const got = fn.goPrioritizedTypes("func Wait(t time.Time, w Widget, x T)", undefined, "", new Set(), "Wait");
  assert.deepStrictEqual(got, ["Widget"]);
});

test("goPrioritizedTypes: a backtick-quoted doc type joins AFTER the signature types; the doc's opening name (the reduced excludeName) does not", () => {
  const got = fn.goPrioritizedTypes(
    "func (s *Stripe) Summarize() error",
    "Summarize pairs each `LodBand` with its `Summarize` count.",
    "",
    new Set(),
    "(*Stripe).Summarize",
  );
  assert.deepStrictEqual(got, ["Stripe", "LodBand"]);
});

test("goPrioritizedTypes: a referenced file-local definition is a candidate through the local leg", () => {
  const got = fn.goPrioritizedTypes("func f(h helperGadget) int", undefined, "", new Set(["helperGadget"]), "f");
  assert.deepStrictEqual(got, ["helperGadget"]);
});

// ===========================================================================
// 4. Type-gen admission (typeKindsFor's go row) through the real
//    resolveFunctionAtCursor — the blind-v12-admit geometry, Go fixture.
//
//  0 package main
//  1
//  2 type Stripe struct {
//  3 	tiles []int
//  4 	band  int
//  5 }
//  6
//  7 type LodBand interface {
//  8 	Spans(lod uint8) bool
//  9 }
// 10
// 11 type Celsius float64
// 12
// 13 func (s *Stripe) Enroll(code uint64) {
// 14 	s.tiles = append(s.tiles, int(code))
// 15 }
// ===========================================================================

const GO_URI = "file:///mod/fixture.go";
const GO_TEXT =
  "package main\n" + // 0
  "\n" + // 1
  "type Stripe struct {\n" + // 2
  "\ttiles []int\n" + // 3
  "\tband  int\n" + // 4
  "}\n" + // 5
  "\n" + // 6
  "type LodBand interface {\n" + // 7
  "\tSpans(lod uint8) bool\n" + // 8
  "}\n" + // 9
  "\n" + // 10
  "type Celsius float64\n" + // 11
  "\n" + // 12
  "func (s *Stripe) Enroll(code uint64) {\n" + // 13
  "\ts.tiles = append(s.tiles, int(code))\n" + // 14
  "}\n"; // 15

// vscode SymbolKind numbers, the shape gopls's tree reaches the extension in:
// methods TOP-LEVEL as `(*Stripe).Enroll`, fields as the struct's children.
const K = { Class: 4, Method: 5, Field: 7, Interface: 10, Struct: 22 };
const sym = (name, kind, range, sel, children = []) => ({ name, detail: "", kind, range, selectionRange: sel, children });
const GO_SYMBOLS = [
  sym("Stripe", K.Struct, R(2, 0, 5, 1), R(2, 5, 2, 11), [
    sym("tiles", K.Field, R(3, 1, 3, 12), R(3, 1, 3, 6)),
    sym("band", K.Field, R(4, 1, 4, 10), R(4, 1, 4, 5)),
  ]),
  sym("LodBand", K.Interface, R(7, 0, 9, 1), R(7, 5, 7, 12), [
    sym("Spans", K.Method, R(8, 1, 8, 22), R(8, 1, 8, 6)),
  ]),
  sym("Celsius", K.Class, R(11, 0, 11, 20), R(11, 5, 11, 12)),
  sym("(*Stripe).Enroll", K.Method, R(13, 0, 15, 1), R(13, 17, 13, 23)),
];

function makeDoc(text, uriStr, languageId) {
  const lines = text.split("\n");
  const offsetAt = (pos) => {
    let o = 0;
    for (let i = 0; i < Math.min(pos.line, lines.length); i++) o += lines[i].length + 1;
    return Math.min(o + pos.character, text.length);
  };
  const positionAt = (off) => {
    let o = 0;
    for (let l = 0; l < lines.length; l++) {
      if (off <= o + lines[l].length) return P(l, off - o);
      o += lines[l].length + 1;
    }
    return P(lines.length - 1, lines[lines.length - 1].length);
  };
  return {
    uri: Uri.parse(uriStr),
    fileName: uriStr.replace(/^file:\/\//, ""),
    languageId,
    version: 1,
    lineCount: lines.length,
    offsetAt,
    positionAt,
    getText: (r) => (r ? text.slice(offsetAt(r.start), offsetAt(r.end)) : text),
    lineAt: (arg) => {
      const n = typeof arg === "number" ? arg : arg.line;
      const t = lines[n] ?? "";
      const m = t.match(/\S/);
      return { lineNumber: n, text: t, range: R(n, 0, n, t.length), firstNonWhitespaceCharacterIndex: m ? m.index : t.length, isEmptyOrWhitespace: !m };
    },
  };
}

async function resolveGoAt(line, character, admitTypes) {
  const doc = makeDoc(GO_TEXT, GO_URI, "go");
  globalThis.__V23GO_SYMBOLS__ = { [GO_URI]: GO_SYMBOLS };
  globalThis.__V23GO_DOCS__ = { [GO_URI]: doc };
  globalThis.__V23GO_OPEN_DOCS__ = [doc];
  return fn.resolveFunctionAtCursor(doc, P(line, character), admitTypes);
}

test("go admission: a cursor inside a struct body resolves the STRUCT when types are admitted", async () => {
  const r = await resolveGoAt(3, 4, true);
  assert.ok(r, "the struct target resolved");
  assert.strictEqual(r.symbolName, "Stripe");
  assert.strictEqual(r.kind, "struct");
});

test("go admission: a cursor on the interface HEADER resolves the INTERFACE (braced member list, a legal target; a cursor inside a member wins deepest-match, the blind-v12 rule)", async () => {
  const r = await resolveGoAt(7, 18, true);
  assert.ok(r, "the interface target resolved");
  assert.strictEqual(r.symbolName, "LodBand");
  assert.strictEqual(r.kind, "interface");
});

test("go admission: a named non-struct type (gopls kind Class) is NOT admitted — no body block to generate into", async () => {
  const r = await resolveGoAt(11, 8, true);
  assert.strictEqual(r, undefined);
});

test("go admission: admitTypes=false keeps v1 function-only resolution — the struct does not resolve", async () => {
  const r = await resolveGoAt(3, 4, false);
  assert.strictEqual(r, undefined);
});

test("go admission: a cursor inside a method body resolves the METHOD as a function target, not a type", async () => {
  const r = await resolveGoAt(14, 4, true);
  assert.ok(r, "the method target resolved");
  assert.strictEqual(r.symbolName, "(*Stripe).Enroll");
  assert.strictEqual(r.kind, "function");
});

// ===========================================================================
// 5. GoCommandExtractor against a fake runner — the mapping the blind product
//    tier proves live, pinned headless the way the C#/Python transports are.
// ===========================================================================

const CURSOR = { uri: "file:///mod/broken.go", line: 1, character: 4 };

function recordingRunner(answers) {
  const calls = [];
  const run = async (command, cursor, opts) => {
    calls.push({ command, cursor, opts });
    if (answers[command] instanceof Error) throw answers[command];
    return answers[command];
  };
  return { run, calls };
}

test("completeMembers: vscode kinds bridge to the two-rule filter — Snippet(14) and deep completions dropped, Method(1)/Field(4) mapped, signature spliced", async () => {
  const { run } = recordingRunner({
    "vscode.executeCompletionItemProvider": [
      { label: "Enroll", kind: 1, detail: "func(code uint64)" },
      { label: "var!", kind: 14, detail: "" },
      { label: "band.Ceiling", kind: 4, detail: "uint8" },
      { label: { label: "Morton" }, kind: 4, detail: "uint64" },
    ],
  });
  const ex = new core.GoCommandExtractor(run, () => "\ts.\n");
  const got = await ex.completeMembers({ uri: CURSOR.uri, line: 0, character: "\ts.".length });
  assert.deepStrictEqual(got, [
    { name: "Enroll", signature: "Enroll(code uint64)", kind: "method" },
    { name: "Morton", signature: "Morton uint64", kind: "field" },
  ]);
});

test("completeMembers: the member-site gate — a non-dot site returns [] WITHOUT dispatching (the world list never reads as members)", async () => {
  const { run, calls } = recordingRunner({ "vscode.executeCompletionItemProvider": [] });
  const ex = new core.GoCommandExtractor(run, () => "\tx := 42\n");
  const got = await ex.completeMembers({ uri: CURSOR.uri, line: 0, character: 5 });
  assert.deepStrictEqual(got, []);
  assert.strictEqual(calls.length, 0, "no command dispatched at a non-member site");
});

test("completeMembers: a type assertion `v.(` fails the identifier-dot shape and returns [] — upstream keeps that site ungated", async () => {
  const { run, calls } = recordingRunner({ "vscode.executeCompletionItemProvider": [] });
  const ex = new core.GoCommandExtractor(run, () => "\tx := v.(\n");
  const got = await ex.completeMembers({ uri: CURSOR.uri, line: 0, character: "\tx := v.(".length });
  assert.deepStrictEqual(got, []);
  assert.strictEqual(calls.length, 0);
});

test("completeMembers: a THROWING runner REJECTS — a dead LS must never read as 'definitively no members'", async () => {
  const { run } = recordingRunner({ "vscode.executeCompletionItemProvider": new Error("LS is down") });
  const ex = new core.GoCommandExtractor(run, () => "\ts.\n");
  await assert.rejects(() => ex.completeMembers({ uri: CURSOR.uri, line: 0, character: "\ts.".length }));
});

test("completeMembers: an all-Text answer travels as evidence-only fallback; mixed answers keep only the semantic members", async () => {
  const { run } = recordingRunner({
    "vscode.executeCompletionItemProvider": [{ label: "foo", kind: 0 }],
  });
  const ex = new core.GoCommandExtractor(run, () => "\ts.\n");
  const got = await ex.completeMembers({ uri: CURSOR.uri, line: 0, character: "\ts.".length });
  assert.deepStrictEqual(got, [{ name: "foo", kind: "text" }]);
});

test("hoverSurface: the ```go fence is the signature, the --- section the doc, the pkg.go.dev link never surfaces", async () => {
  const { run } = recordingRunner({
    "vscode.executeHoverProvider": [
      { contents: [{ value: "```go\nfunc (s *Stripe) Enroll(code uint64)\n```\n---\nEnroll registers a tile.\n\n---\n[`atlas.Stripe` on pkg.go.dev](https://pkg.go.dev/x)\n" }] },
    ],
  });
  const ex = new core.GoCommandExtractor(run);
  const got = await ex.hoverSurface(CURSOR);
  assert.deepStrictEqual(got, {
    signature: "func (s *Stripe) Enroll(code uint64)",
    doc: "Enroll registers a tile.",
  });
});

test("definition: a LocationLink's SELECTION range wins over its full targetRange (the follow-up must land on the name token)", async () => {
  const { run } = recordingRunner({
    "vscode.executeDefinitionProvider": [
      {
        targetUri: { toString: () => "file:///mod/atlas/atlas.go" },
        targetRange: { start: { line: 39, character: 0 }, end: { line: 43, character: 1 } },
        targetSelectionRange: { start: { line: 39, character: 5 }, end: { line: 39, character: 11 } },
      },
    ],
  });
  const ex = new core.GoCommandExtractor(run);
  const got = await ex.definition(CURSOR);
  assert.deepStrictEqual(got, {
    uri: "file:///mod/atlas/atlas.go",
    range: { startLine: 39, startCharacter: 5, endLine: 39, endCharacter: 11 },
  });
});

test("example: dark by decision — resolves undefined with ZERO runner dispatches (the locked C#/TS resolution)", async () => {
  const { run, calls } = recordingRunner({});
  const ex = new core.GoCommandExtractor(run);
  assert.strictEqual(await ex.example(CURSOR), undefined);
  assert.strictEqual(calls.length, 0, "example must not spend a round trip");
});

const mkWorkspaceEdit = (pairs) => ({ entries: () => pairs });
const IMPORT_EDIT = {
  range: { start: { line: 2, character: 0 }, end: { line: 2, character: 0 } },
  newText: '\t"go-scratch/atlas"\n',
};

test("qualifyImport: ONE Add-import action yields the out-of-span imports-region edit, requested over the widened identifier", async () => {
  const uri = "file:///mod/playground/limits.go";
  const { run, calls } = recordingRunner({
    "vscode.executeCodeActionProvider": [
      { title: 'Add import: "go-scratch/atlas"', edit: mkWorkspaceEdit([[uri, [IMPORT_EDIT]]]) },
      { title: "Fill in return values", edit: mkWorkspaceEdit([[uri, [IMPORT_EDIT]]]) },
    ],
  });
  const line = "\t_ = atlas.TileFromMorton(1, 0)";
  const ex = new core.GoCommandExtractor(run, () => line + "\n");
  const got = await ex.qualifyImport({ uri, line: 0, character: line.indexOf("atlas") + 2 });
  assert.deepStrictEqual(got, {
    range: { startLine: 2, startCharacter: 0, endLine: 2, endCharacter: 0 },
    newText: '\t"go-scratch/atlas"\n',
  });
  // The request widened to the whole identifier: start at `atlas`, end past it.
  const call = calls[0];
  assert.strictEqual(call.cursor.character, line.indexOf("atlas"));
  assert.strictEqual(call.opts.endCursor.character, line.indexOf("atlas") + "atlas".length);
});

test("qualifyImport: TWO Add-import candidates is an ambiguity the model never resolves — honest-dark", async () => {
  const uri = "file:///mod/playground/limits.go";
  const { run } = recordingRunner({
    "vscode.executeCodeActionProvider": [
      { title: 'Add import: "corp/atlas"', edit: mkWorkspaceEdit([[uri, [IMPORT_EDIT]]]) },
      { title: 'Add import: "other/atlas"', edit: mkWorkspaceEdit([[uri, [IMPORT_EDIT]]]) },
    ],
  });
  const ex = new core.GoCommandExtractor(run, () => "\t_ = atlas.T()\n");
  assert.strictEqual(await ex.qualifyImport({ uri, line: 0, character: 6 }), undefined);
});

test("qualifyImport: an edit touching a DIFFERENT file than the cursor's own is refused (same-file single-edit contract)", async () => {
  const uri = "file:///mod/playground/limits.go";
  const { run } = recordingRunner({
    "vscode.executeCodeActionProvider": [
      { title: 'Add import: "go-scratch/atlas"', edit: mkWorkspaceEdit([["file:///elsewhere.go", [IMPORT_EDIT]]]) },
    ],
  });
  const ex = new core.GoCommandExtractor(run, () => "\t_ = atlas.T()\n");
  assert.strictEqual(await ex.qualifyImport({ uri, line: 0, character: 6 }), undefined);
});

test("membersOfType: the receiver-sibling join through the VSCODE role table — fields as children, `(*Stripe).Enroll` joined, the other receiver's method excluded", async () => {
  const { run } = recordingRunner({
    "vscode.executeDocumentSymbolProvider": [
      {
        name: "Stripe",
        kind: 22,
        range: { start: { line: 2, character: 0 }, end: { line: 5, character: 1 } },
        selectionRange: { start: { line: 2, character: 5 }, end: { line: 2, character: 11 } },
        children: [
          { name: "tiles", kind: 7, detail: "[]Tile" },
          { name: "band", kind: 7, detail: "LodBand" },
        ],
      },
      { name: "(*Stripe).Enroll", kind: 5, detail: "func(code uint64)" },
      { name: "(Tile).Encloses", kind: 5, detail: "func(other Tile) bool" },
    ],
  });
  const ex = new core.GoCommandExtractor(run);
  const got = await ex.membersOfType({ uri: "file:///mod/atlas/atlas.go", line: 2, character: 6 });
  assert.deepStrictEqual(got, [
    { name: "tiles", signature: "tiles []Tile", kind: "field" },
    { name: "band", signature: "band LodBand", kind: "field" },
    { name: "Enroll", signature: "Enroll(code uint64)", kind: "method" },
  ]);
});

test("membersOfType: a throwing runner degrades to [] (unlike completeMembers — no output gate keys on this shape)", async () => {
  const { run } = recordingRunner({ "vscode.executeDocumentSymbolProvider": new Error("LS is down") });
  const ex = new core.GoCommandExtractor(run);
  assert.deepStrictEqual(await ex.membersOfType({ uri: "file:///x.go", line: 0, character: 0 }), []);
});

// ===========================================================================
// 5b. resolveTypeCursorByName — session-v40 item 2's anchor leg, product
//     transport. Same selection as the headless GoLspExtractor
//     (resolveGoTypeCursorWithHint), dispatched through
//     vscode.executeWorkspaceSymbolProvider — the CsCommandExtractor sibling.
// ===========================================================================

function symbolRunner(answer) {
  const calls = [];
  const runSymbol = async (query) => {
    calls.push(query);
    if (answer instanceof Error) throw answer;
    return answer;
  };
  return { runSymbol, calls };
}

test("resolveTypeCursorByName: an unambiguous exact-name struct hit resolves through the vscode role table (Struct=22)", async () => {
  const { runSymbol } = symbolRunner([
    {
      name: "Command",
      kind: 22, // vscode Struct
      containerName: "github.com/spf13/cobra",
      location: { uri: { toString: () => "file:///cobra/command.go" }, range: { start: { line: 53, character: 5 } } },
    },
    {
      name: "getCommand",
      kind: 11, // vscode Function
      containerName: "github.com/spf13/cobra",
      location: { uri: { toString: () => "file:///cobra/x_test.go" }, range: { start: { line: 10, character: 5 } } },
    },
  ]);
  const ex = new core.GoCommandExtractor(async () => undefined, undefined, runSymbol);
  const got = await ex.resolveTypeCursorByName("Command");
  assert.deepStrictEqual(got, { uri: "file:///cobra/command.go", line: 53, character: 5 });
});

test("resolveTypeCursorByName: two distinct packages declaring the same type name refuses outright, never a guess", async () => {
  const { runSymbol } = symbolRunner([
    { name: "Widget", kind: 22, containerName: "example.com/a", location: { uri: { toString: () => "file:///a/widget.go" }, range: { start: { line: 0, character: 5 } } } },
    { name: "Widget", kind: 22, containerName: "example.com/b", location: { uri: { toString: () => "file:///b/widget.go" }, range: { start: { line: 0, character: 5 } } } },
  ]);
  const ex = new core.GoCommandExtractor(async () => undefined, undefined, runSymbol);
  assert.strictEqual(await ex.resolveTypeCursorByName("Widget"), undefined);
});

test("resolveTypeCursorByName: hint.container disambiguates two packages by path suffix, without any extra dispatch", async () => {
  const { runSymbol, calls } = symbolRunner([
    { name: "Widget", kind: 22, containerName: "example.com/a", location: { uri: { toString: () => "file:///a/widget.go" }, range: { start: { line: 0, character: 5 } } } },
    { name: "Widget", kind: 22, containerName: "example.com/b", location: { uri: { toString: () => "file:///b/widget.go" }, range: { start: { line: 0, character: 5 } } } },
  ]);
  const ex = new core.GoCommandExtractor(async () => undefined, undefined, runSymbol);
  const got = await ex.resolveTypeCursorByName("Widget", { container: "example.com/b" });
  assert.deepStrictEqual(got, { uri: "file:///b/widget.go", line: 0, character: 5 });
  assert.deepStrictEqual(calls, ["Widget"], "one workspace-symbol dispatch, no hover fan-out for the hint");
});

test("resolveTypeCursorByName: an absent runSymbol degrades to undefined with ZERO dispatches", async () => {
  let dispatched = false;
  const ex = new core.GoCommandExtractor(async () => {
    dispatched = true;
  });
  assert.strictEqual(await ex.resolveTypeCursorByName("Command"), undefined);
  assert.strictEqual(dispatched, false);
});

test("resolveTypeCursorByName: a throwing runSymbol degrades to undefined, never rejects", async () => {
  const { runSymbol } = symbolRunner(new Error("LS is down"));
  const ex = new core.GoCommandExtractor(async () => undefined, undefined, runSymbol);
  assert.strictEqual(await ex.resolveTypeCursorByName("Command"), undefined);
});

test("resolveTypeCursorByName: no exact-name type in the fuzzy hit list resolves to undefined", async () => {
  const { runSymbol } = symbolRunner([
    { name: "getCommand", kind: 11, containerName: "github.com/spf13/cobra", location: { uri: { toString: () => "file:///cobra/x.go" }, range: { start: { line: 0, character: 0 } } } },
  ]);
  const ex = new core.GoCommandExtractor(async () => undefined, undefined, runSymbol);
  assert.strictEqual(await ex.resolveTypeCursorByName("Command"), undefined);
});

// ===========================================================================
// 6. The registry row (dispatch-map row 2) — the blind-v10 sequencing-flip
//    convention: go resolves its OWN class, never the Rust fallthrough.
// ===========================================================================

test("extractorFor('go') resolves the Go product extractor, a distinct class from the Rust default", () => {
  const go = reg.extractorFor("go");
  assert.ok(go, "go resolves a product extractor");
  assert.strictEqual(go.constructor.name, "GoCommandExtractor");
  assert.notStrictEqual(go.constructor, reg.extractorFor("rust").constructor, "not the Rust fallthrough");
});
