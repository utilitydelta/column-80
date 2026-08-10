// IMPLEMENTER test - session-v46 phase 0b: the byte-identity gate.
//
// The contract's whole point at identity defaults: routing the tuning
// constants through the budget profile changes NO prompt by a byte. The pins
// below are sha256 + byte length of (a) the resolvePrefill surface and (b) the
// full assembled fn-gen prompt on a fixed fixture, for the two languages that
// exercise both budget legs (rust = the shared base, csharp = the factored
// leg). The values were measured against the PRE-SEAM tree (the working tree
// at commit 271b84a, before src/core/budgetProfile.ts existed) with this exact
// fixture, so a red here means the seam moved real prompt bytes.
//
// The fixture is the review-v45-p3 shape: six candidate types against the
// type cap of 4, six long member signatures each, wide enough that the budget,
// the member cap and the type cap all bind.
//
// Run: SKIP_LIVE=1 node --test test/impl-v46-p0b-prompt-identity.test.cjs

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const esbuild = require("esbuild");

// Measured pre-seam, 2026-08-09.
const PINS = {
  rust: {
    surfaceBytes: 3340,
    surfaceSha: "9a1259d5984c070f4a86dd93af2d55ee1103a33ebc440103916fe4709ebe03ab",
    promptBytes: 3946,
    promptSha: "872097aff88f525677e10723c8e7a077a283a4e864befa0a13e476d313e0cc9b",
  },
  csharp: {
    surfaceBytes: 961,
    surfaceSha: "90dc43cbd1a5b37d609d50c60eda2fad360b6d4ce784a888eadbe4c44d9df7a5",
    promptBytes: 1557,
    promptSha: "7dfe3a53c26be59fdc1423eb146107a0ade244319be3c7e1a89651767a37ad12",
  },
};

const STUB = path.join(__dirname, ".v46p0b-identity-vscode-stub.cjs");
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
    getConfiguration: () => ({ get: (k, f) => f, has: () => false, inspect: () => undefined, update: async () => {} }),
    openTextDocument: (arg) => {
      const files = globalThis.__V46P0B_FILES__ || {};
      const key = keyOf(arg);
      return Promise.resolve({ uri: mkUri(key), getText: () => files[key] });
    },
  },
};
`,
);
const ENTRY = path.join(__dirname, ".v46p0b-identity.entry.ts");
const OUT = path.join(__dirname, ".v46p0b-identity.bundle.cjs");
fs.writeFileSync(
  ENTRY,
  `export { resolvePrefill } from "../src/vscode/fnGen";\nexport { assembleFnGenPrompt } from "../src/core/prompt";\n`,
);
esbuild.buildSync({ entryPoints: [ENTRY], bundle: true, outfile: OUT, format: "cjs", platform: "node", alias: { vscode: STUB } });
const M = require(OUT);
const V = require(STUB);
test.after(() => [STUB, ENTRY, OUT].forEach((f) => fs.rmSync(f, { force: true })));

const WS = "file:///work/v46p0b";
const SIX = ["Alpha", "Beta", "Gamma", "Delta", "Epsilon", "Zeta"];
const csMembers = (t) =>
  Array.from({ length: 6 }, (_, i) => ({
    name: `Compute${i}`,
    kind: "method",
    signature: `public System.Threading.Tasks.Task<uint> Compute${i}(uint operandNumber${i}, string labelForOperand${i})`,
    uri: `${WS}/${t.toLowerCase()}.cs`,
    line: 0,
    character: 13,
  }));
const rustMembers = (t) =>
  Array.from({ length: 6 }, (_, i) => ({
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

const sha = (s) => crypto.createHash("sha256").update(s ?? "", "utf8").digest("hex");

for (const [languageId, pin] of Object.entries(PINS)) {
  test(`the assembled ${languageId} fn-gen prompt is byte-identical to the pre-seam build`, async () => {
    const F = FIXTURES[languageId];
    const mainUri = `${WS}/main.${F.ext}`;
    const signature = F.signature(SIX);
    const src = `${F.docLine}\n${signature} {\n${F.body}\n`;
    const files = { [mainUri]: src };
    const defTypes = {};
    for (const t of SIX) {
      const uri = `${WS}/${t.toLowerCase()}.${F.ext}`;
      files[uri] = F.def(t);
      defTypes[t] = { uri, hover: F.hover(t), members: F.members(t) };
    }
    const record = {
      span: { start: src.indexOf(signature), end: src.length - 1 },
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
    globalThis.__V46P0B_FILES__ = files;
    let surface;
    try {
      surface = await M.resolvePrefill(makeExtractor(files, defTypes), makeDoc(src, mainUri), record, () => {});
    } finally {
      delete globalThis.__V46P0B_FILES__;
    }
    const prompt = M.assembleFnGenPrompt({
      signature,
      docComment: F.doc,
      contextBlocks: [],
      languageId,
      injectedSurface: surface,
      noPunt: true,
    });
    assert.equal(Buffer.byteLength(surface ?? "", "utf8"), pin.surfaceBytes, "surface byte length");
    assert.equal(sha(surface), pin.surfaceSha, "surface sha256");
    assert.equal(Buffer.byteLength(prompt, "utf8"), pin.promptBytes, "prompt byte length");
    assert.equal(sha(prompt), pin.promptSha, "prompt sha256");
  });
}
