// IMPLEMENTER test - session-v46 phase 0 fix loop 2: a CELL_OVERRIDES entry
// reaches the WALK SPEND.
//
// The phase-0 adversarial review found the walk's spend bypassing the profile:
// `prefillTotalTok` preferred `lang.dataShapeTotalTok`, and CS_PREFILL_LANG
// always sets it, so a `frontier/csharp` cell could move `surfaceBudgetTok` in
// `budgetProfileFor` while resolvePrefill kept spending the module constant.
// The fix resolves the language slot through the budget cell at the call site
// (fnGen.ts, `langWalkBudget`). This proves the routing the way the sibling
// impl-v46-p0b tests prove derivation: by patching the bundled
// `var CELL_OVERRIDES = {};` and watching the rendered surface move.
//
// Three rows, all comparative (no byte pins - identity bytes are pinned by
// impl-v46-p0b-prompt-identity):
//   1. frontier/csharp cell at 900 renders MORE surface than identity.
//   2. the cell is language-scoped: Rust does not move with it.
//   3. the cell is class-scoped: a local-mid C# run does not move with it.
//
// Run: SKIP_LIVE=1 node --test test/impl-v46-p0-cell-override-walk.test.cjs

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const esbuild = require("esbuild");

const STUB = path.join(__dirname, ".v46p0c-cell-vscode-stub.cjs");
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
}
class Selection extends Range {}
const mkUri = (s) => ({ toString: () => String(s), fsPath: String(s), path: String(s) });
const keyOf = (a) => (typeof a === "string" ? a : (a && a.toString ? a.toString() : String(a)));
module.exports = {
  Position, Range, Selection, WorkspaceEdit: class {},
  EventEmitter: class { constructor(){ this.event=()=>({dispose(){}}); } fire(){} dispose(){} },
  ThemeColor: class {}, MarkdownString: class {},
  Uri: { parse: mkUri, file: mkUri },
  SymbolKind: { File:0, Module:1, Namespace:2, Package:3, Class:4, Method:5, Property:6,
    Field:7, Constructor:8, Enum:9, Interface:10, Function:11, Variable:12, Constant:13,
    String:14, Number:15, Boolean:16, Array:17, Object:18, Key:19, Null:20, EnumMember:21,
    Struct:22, Event:23, Operator:24, TypeParameter:25 },
  ProgressLocation: { SourceControl:1, Window:10, Notification:15 },
  EndOfLine: { LF:1, CRLF:2 },
  languages: {}, window: {}, commands: { executeCommand: async () => undefined },
  workspace: {
    // The provider setting is what fnGenModelClass reads to pick the serving
    // class, so the test switches it per row through a global.
    getConfiguration: () => ({
      get: (k, f) => (k === "fnGenProvider" ? (globalThis.__V46P0C_PROVIDER__ ?? f) : f),
      has: () => false, inspect: () => undefined, update: async () => {},
    }),
    openTextDocument: (arg) => {
      const files = globalThis.__V46P0C_FILES__ || {};
      const key = keyOf(arg);
      return Promise.resolve({ uri: mkUri(key), getText: () => files[key] });
    },
  },
};
`,
);
const ENTRY = path.join(__dirname, ".v46p0c-cell.entry.ts");
const OUT = path.join(__dirname, ".v46p0c-cell.bundle.cjs");
const OUT_CELL = path.join(__dirname, ".v46p0c-cell.cell900.bundle.cjs");
fs.writeFileSync(ENTRY, `export { resolvePrefill } from "../src/vscode/fnGen";\n`);
esbuild.buildSync({ entryPoints: [ENTRY], bundle: true, outfile: OUT, format: "cjs", platform: "node", alias: { vscode: STUB } });
const src = fs.readFileSync(OUT, "utf8");
const reCell = /var CELL_OVERRIDES = \{\};/g;
assert.equal((src.match(reCell) ?? []).length, 1, "the empty CELL_OVERRIDES table is not in the bundle under the shape this test patches");
fs.writeFileSync(OUT_CELL, src.replace(reCell, 'var CELL_OVERRIDES = { "frontier/csharp": { surfaceBudgetTok: 900 } };'));
const M = require(OUT);
const MCELL = require(OUT_CELL);
const V = require(STUB);
test.after(() => [STUB, ENTRY, OUT, OUT_CELL].forEach((f) => fs.rmSync(f, { force: true })));

const WS = "file:///work/v46p0c";
const SIX = ["Alpha", "Beta", "Gamma", "Delta", "Epsilon", "Zeta"];
// Twelve long members per type, so the identity aggregate budget binds hard and
// a moved cell has visible room to admit more.
const csMembers = (t) =>
  Array.from({ length: 12 }, (_, i) => ({
    name: `Compute${i}`,
    kind: "method",
    signature: `public System.Threading.Tasks.Task<uint> Compute${i}(uint operandNumber${i}, string labelForOperand${i})`,
    uri: `${WS}/${t.toLowerCase()}.cs`,
    line: 0,
    character: 13,
  }));
const rustMembers = (t) =>
  Array.from({ length: 12 }, (_, i) => ({
    name: `compute${i}`,
    kind: "method",
    signature: `pub fn compute${i}(&self, operand_number_${i}: u32, label_for_operand_${i}: &str) -> u32`,
    uri: `${WS}/${t.toLowerCase()}.rs`,
    line: 0,
    character: 7,
  }));

const FIXTURES = {
  csharp: {
    ext: "cs",
    symbol: "Build",
    doc: "Build the thing.",
    docLine: "/// <summary>Build the thing.</summary>",
    signature: (n) => `public uint Build(${n.map((t, i) => `${t} p${i}`).join(", ")})`,
    body: "    throw new NotImplementedException();\n}",
    bodyIndent: "    ",
    def: (t) => `public class ${t} { public uint Slot; }\n`,
    hover: (t) => `class ${t}`,
    members: csMembers,
  },
  rust: {
    ext: "rs",
    symbol: "build",
    doc: "Build the thing.",
    docLine: "/// Build the thing.",
    signature: (n) => `pub fn build(${n.map((t, i) => `p${i}: ${t}`).join(", ")}) -> u32`,
    body: "    todo!()\n}",
    bodyIndent: "    ",
    def: (t) => `pub struct ${t} { pub slot_number_field: u32, pub label_for_the_slot: String }\n`,
    hover: (t) => `pub struct ${t} {\n    pub slot_number_field: u32,\n    pub label_for_the_slot: String,\n}`,
    members: rustMembers,
  },
};

function makeDoc(text, uriStr) {
  const lines = text.split("\n");
  const offsetAt = (p) => {
    let o = 0;
    for (let i = 0; i < Math.min(p.line, lines.length); i++) o += lines[i].length + 1;
    return Math.min(o + p.character, text.length);
  };
  const positionAt = (off) => {
    let o = 0;
    for (let l = 0; l < lines.length; l++) {
      if (off <= o + lines[l].length) return new V.Position(l, off - o);
      o += lines[l].length + 1;
    }
    return new V.Position(lines.length - 1, 0);
  };
  return {
    uri: { toString: () => uriStr },
    offsetAt,
    positionAt,
    getText: (r) => (r ? text.slice(offsetAt(r.start), offsetAt(r.end)) : text),
  };
}

const wordAt = (text, cursor) => {
  const line = (text || "").split("\n")[cursor.line] ?? "";
  const isWord = (c) => /[A-Za-z0-9_]/.test(c);
  let s = Math.min(cursor.character, line.length);
  let e = s;
  while (s > 0 && isWord(line[s - 1])) s--;
  while (e < line.length && isWord(line[e])) e++;
  return line.slice(s, e) || undefined;
};

function makeExtractor(files, defTypes) {
  const known = new Set(Object.keys(defTypes));
  const typeAtCursor = (uri, cursor) => {
    const text = files[uri];
    if (text === undefined) return undefined;
    const w = wordAt(text, cursor);
    if (w && known.has(w)) return w;
    const line = text.split("\n")[cursor.line] ?? "";
    const on = [...known].filter((t) => new RegExp(`\\b${t}\\b`).test(line));
    return on.length === 1 ? on[0] : undefined;
  };
  const defLocFor = (t) => {
    const uri = defTypes[t].uri;
    const lines = (files[uri] || "").split("\n");
    const ln = lines.findIndex((l) => new RegExp(`\\b${t}\\b`).test(l));
    if (ln < 0) return undefined;
    const ch = lines[ln].indexOf(t);
    return { uri, range: { startLine: ln, startCharacter: ch, endLine: ln, endCharacter: ch + t.length } };
  };
  return {
    definition: async (c) => {
      const t = typeAtCursor(c.uri, c);
      return t ? defLocFor(t) : undefined;
    },
    hoverSurface: async (c) => {
      const t = typeAtCursor(c.uri, c);
      const h = t ? defTypes[t].hover : undefined;
      return h ? { signature: h } : undefined;
    },
    membersOfType: async (c) => {
      const t = typeAtCursor(c.uri, c);
      return (t && defTypes[t].members) || [];
    },
    example: async () => undefined,
    completeMembers: async () => [],
    qualifyImport: async () => undefined,
  };
}

async function runPrefill(mod, languageId, provider) {
  const F = FIXTURES[languageId];
  const mainUri = `${WS}/main.${F.ext}`;
  const signature = F.signature(SIX);
  const src2 = `${F.docLine}\n${signature} {\n${F.body}\n`;
  const files = { [mainUri]: src2 };
  const defTypes = {};
  for (const t of SIX) {
    const uri = `${WS}/${t.toLowerCase()}.${F.ext}`;
    files[uri] = F.def(t);
    defTypes[t] = { uri, hover: F.hover(t), members: F.members(t) };
  }
  const record = {
    span: { start: src2.indexOf(signature), end: src2.length - 1 },
    signature,
    docComment: F.doc,
    symbolName: F.symbol,
    languageId,
    kind: "function",
    bodyOnly: false,
    headerIndent: "",
    bodyIndent: F.bodyIndent,
    docstringRefusal: undefined,
  };
  globalThis.__V46P0C_FILES__ = files;
  globalThis.__V46P0C_PROVIDER__ = provider;
  try {
    return (await mod.resolvePrefill(makeExtractor(files, defTypes), makeDoc(src2, mainUri), record, () => {})) ?? "";
  } finally {
    delete globalThis.__V46P0C_FILES__;
    delete globalThis.__V46P0C_PROVIDER__;
  }
}

test("a frontier/csharp cell moving surfaceBudgetTok moves the WALK SPEND: more surface renders", async () => {
  const identity = await runPrefill(M, "csharp", "claude-code");
  const moved = await runPrefill(MCELL, "csharp", "claude-code");
  assert.ok(
    moved.length > identity.length,
    `the cell must reach the walk: 300 -> 900 rendered ${identity.length} -> ${moved.length} chars\n` +
      `[identity]\n${identity}\n[moved]\n${moved}`,
  );
});

test("the cell is language-scoped: Rust does not move with frontier/csharp", async () => {
  const identity = await runPrefill(M, "rust", "claude-code");
  const withCell = await runPrefill(MCELL, "rust", "claude-code");
  assert.equal(withCell, identity, "a csharp cell must not change a Rust prefill by a byte");
});

test("the cell is class-scoped: a local-mid C# run does not move with frontier/csharp", async () => {
  const identity = await runPrefill(M, "csharp", "ollama");
  const withCell = await runPrefill(MCELL, "csharp", "ollama");
  assert.equal(withCell, identity, "a frontier cell must not change a local-mid prefill by a byte");
});
