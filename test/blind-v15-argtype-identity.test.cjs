// BLIND ORACLE - v15, the ARGUMENT-TYPE IDENTITY contract.
//
// What is under test: the argument-type leg of the member-site injection, as
// reachable from the shipped surface - the three product transports
// (TsCommandExtractor, CsCommandExtractor, PyCommandExtractor), the type-anchor
// finders (findTypeAnchorInText / pyFindTypeAnchorInText), the parameter-type
// scan (argumentTypeNames) and the renderer (renderFimCandidates). None of
// those bodies is read here; esbuild resolves the modules at bundle time only.
// Written against session-v15/goal.md build step 1.
//
// THE PROMISE. At a member site the extension injects the receiver's members,
// and under a header reading "to build a X:" it injects the construction
// surface of a type X that one of those members TAKES. The contract this file
// encodes is narrower and harder than "something is injected":
//
//     whatever appears under "to build a X:" must actually belong to type X.
//
// A block that renders the header and then lists members of some OTHER
// declaration is a false statement to the model, and worse than injecting
// nothing, because the model follows it.
//
// THE FIXTURE IS A TRAP, ON PURPOSE. The cursor's own file holds a class of
// five unrelated helpers - TileSite, StripeMutatorSite, MemberOverloadSite,
// EnumSite, FreshSite - and REFERENCES the argument type Tile inside one of
// them. Tile itself is DEFINED IN A DIFFERENT FILE, with a two-argument
// constructor and a SubtendedChildren method. The two symbol trees share no
// member name, so it is always decidable which one a resolution reached. The
// same five helper names are used in all three languages, against local naming
// convention, so the negative assertion reads identically everywhere.
//
// A resolution that reads the CURRENT file's symbols lands inside the helper
// class and yields the five helpers. Rendering those under "to build a Tile:"
// is the failure this file exists to catch.
//
// HOW THE RESOLUTION IS DRIVEN. The provider's own glue is a private method on
// FimCompletionProvider and needs vscode, so these tests compose the type
// resolution from the exported primitives, and they compose it GENEROUSLY: a
// by-name workspace resolution is tried first, and an anchor-plus-definition
// walk second. Any honest strategy that reaches Tile's definition passes. The
// demand is that SOME exported primitive reaches Tile's own surface, in every
// language, and that none of them ever hands back the helper class's.
//
// EXPECTED RED until the fix lands. Do not relax an assertion to make one pass.
//
// Run: SKIP_LIVE=1 node --test test/blind-v15-argtype-identity.test.cjs
// (Hermetic: fake runners, no vscode, no model, no network.)

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const { bundleCore } = require("./.blind-util.cjs");

let mod = {};
let cleanup = () => {};
let bundleError;
try {
  ({ mod, cleanup } = bundleCore(
    "blind-v15-argtype-identity",
    `export { TsCommandExtractor } from "../src/vscode/tsExtractor";\n` +
      `export { CsCommandExtractor } from "../src/vscode/csExtractor";\n` +
      `export { PyCommandExtractor } from "../src/vscode/pyExtractor";\n` +
      `export { renderFimCandidates, lineCommentFor, argumentTypeNames } from "../src/core/fimInject";\n` +
      `export { findTypeAnchorInText, pyFindTypeAnchorInText } from "../src/core/fimWholeBlock";\n`
  ));
} catch (e) {
  bundleError = e;
  cleanup = () => {
    fs.rmSync(path.join(__dirname, ".blind-v15-argtype-identity.entry.ts"), { force: true });
    fs.rmSync(path.join(__dirname, ".blind-v15-argtype-identity.bundle.cjs"), { force: true });
  };
}
test.after(() => cleanup());

test("harness: the product transports, the anchor finders and the renderer bundle headless [any red here is a build problem, not a contract failure]", () => {
  if (bundleError) assert.fail(`the bundle does not build: ${bundleError.message}`);
});

const gtest = (name, fn) =>
  test(name, (ctx) => {
    if (bundleError) return ctx.skip("bundle failed to build; see the harness test");
    return fn(ctx);
  });

// ORIGINAL RULING, kept verbatim:
//
//   The cross-file leg is UNBUILT, and has been since v14. Three rows below carry
//   its whole demand and go red against main. They are marked `todo` rather than
//   deleted or relaxed: every assertion stands exactly as written, node --test
//   reports them apart from the passes, and the run stops being red for a gap that
//   is already a roadmap item. Take the todo off when the leg lands; do not soften
//   an assertion to take it off sooner.
//
//   Marked per LANGUAGE, not per row, because each row is green in the languages
//   that are not listed and a blanket todo would throw that coverage away.
//
//   const UNBUILT = "cross-file argument-type resolution is unbuilt (docs/roadmap.md item 1)";
//
// CONVERTED 2026-08-10 (session-v48 phase 0, G4): a test that must be red is not
// a test. The `todo` marker is gone. The per-language split stays, and it now
// splits the BODY as well as the marker: the language that HAS the behaviour
// keeps the original demand verbatim, and the languages that do not get a
// `KNOWN WRONG:` leg asserting, to an exact value, what the unbuilt leg actually
// produces today. Each such leg goes red the moment the leg lands, which is what
// marks the demand as met - the assertion was not softened, it was inverted.
// The title has to be split too, and for the same reason the body is. Prefixing
// `KNOWN WRONG:` onto a name that states the DEMAND yields a row reading
// "KNOWN WRONG: <the correct behaviour>", which is its own opposite. The
// inverted leg takes `wrongName`, which states what the code actually does.
const gtodo = (todo, name, wrongName, fn) =>
  test(todo ? `KNOWN WRONG: ${wrongName}` : name, (ctx) => {
    if (bundleError) return ctx.skip("bundle failed to build; see the harness test");
    return fn(ctx);
  });

// ---------------------------------------------------------------------------
// vscode stand-ins. Coordinates are 0-based line / UTF-16 column. SymbolKind is
// the VSCODE numbering the command API hands a product transport.
// ---------------------------------------------------------------------------

const SK = { Class: 4, Method: 5, Property: 6, Field: 7, Constructor: 8, Function: 11, Variable: 12 };

const CMD = {
  hover: "vscode.executeHoverProvider",
  definition: "vscode.executeDefinitionProvider",
  docSymbol: "vscode.executeDocumentSymbolProvider",
};

const vr = (sl, sc, el, ec) => ({ start: { line: sl, character: sc }, end: { line: el, character: ec } });

// Real vscode's documentSymbol `detail` is per-language. tsserver and Pylance
// hand back the empty string; Roslyn hands back the member's signature in its
// own descent dialect ("Tile(int, int)", "MortonCode : int"). The C# nodes below
// carry that captured dialect; every other node defaults to empty.
const dsym = (name, kind, range, children = [], detail = "") => ({
  name,
  detail,
  kind,
  range,
  selectionRange: vr(range.start.line, range.start.character, range.start.line, range.start.character + 1),
  children,
});

const hoverAnswer = (md) => [{ contents: [{ value: md }] }];

const locationAt = (uri, line, character) => [
  { uri: { toString: () => uri }, range: vr(line, character, line, character + 4) },
];

const runnerFor = (handlers) => {
  const calls = [];
  const run = async (command, cursor, opts) => {
    calls.push({ command, cursor, opts });
    const h = handlers[command];
    if (h === undefined) return undefined;
    return typeof h === "function" ? h(cursor, opts) : h;
  };
  return { run, calls };
};

// ---------------------------------------------------------------------------
// The five helper names that must never be presented as Tile's surface. This
// list is the heart of the contract.
// ---------------------------------------------------------------------------

const HELPERS = ["TileSite", "StripeMutatorSite", "MemberOverloadSite", "EnumSite", "FreshSite"];

const CTOR_ARITY = 2; // Tile(mortonCode, lod)

// ---------------------------------------------------------------------------
// Fixtures. Two files per language: the SITE file (the helper class, which
// merely mentions Tile) and the TYPE file (where Tile actually lives).
// ---------------------------------------------------------------------------

const CS_SITE = [
  "using System;",
  "using Atlas.Cartography;",
  "",
  "public static class Fim",
  "{",
  "    public static void TileSite(Stripe stripe)",
  "    {",
  "        Tile tile = Cartography.TileFromMorton(42, 3);",
  "        stripe.",
  "    }",
  "",
  "    public static void StripeMutatorSite(Stripe stripe) { }",
  "",
  "    public static void MemberOverloadSite(Stripe stripe) { }",
  "",
  "    public static void EnumSite(Stripe stripe) { }",
  "",
  "    public static void FreshSite(Stripe stripe) { }",
  "}",
  "",
].join("\n");

const CS_TYPE = [
  "public class Tile",
  "{",
  "    public int MortonCode;",
  "    public int Lod;",
  "    public Tile(int mortonCode, int lod)",
  "    {",
  "        MortonCode = mortonCode;",
  "        Lod = lod;",
  "    }",
  "    public Tile[] SubtendedChildren() => new Tile[4];",
  "    public string Key() => $\"{MortonCode}:{Lod}\";",
  "}",
  "",
].join("\n");

const TS_SITE = [
  'import { Stripe } from "./stripe";',
  'import { Tile } from "./tile";',
  "",
  "export class Fim {",
  "  static TileSite(stripe: Stripe): void {",
  "    const tile: Tile = cartography.tileFromMorton(42, 3);",
  "    stripe.",
  "  }",
  "  static StripeMutatorSite(stripe: Stripe): void {}",
  "  static MemberOverloadSite(stripe: Stripe): void {}",
  "  static EnumSite(stripe: Stripe): void {}",
  "  static FreshSite(stripe: Stripe): void {}",
  "}",
  "",
].join("\n");

const TS_TYPE = [
  "export class Tile {",
  "  mortonCode: number;",
  "  lod: number;",
  "  constructor(mortonCode: number, lod: number) {",
  "    this.mortonCode = mortonCode;",
  "    this.lod = lod;",
  "  }",
  "  SubtendedChildren(): Tile[] { return []; }",
  "  Key(): string { return `${this.mortonCode}:${this.lod}`; }",
  "}",
  "",
].join("\n");

const PY_SITE = [
  "from stripe import Stripe",
  "from tile import Tile",
  "",
  "",
  "class Fim:",
  "    @staticmethod",
  "    def TileSite(stripe: Stripe) -> None:",
  "        tile: Tile = cartography.tile_from_morton(42, 3)",
  "        stripe.",
  "",
  "    @staticmethod",
  "    def StripeMutatorSite(stripe: Stripe) -> None: ...",
  "",
  "    @staticmethod",
  "    def MemberOverloadSite(stripe: Stripe) -> None: ...",
  "",
  "    @staticmethod",
  "    def EnumSite(stripe: Stripe) -> None: ...",
  "",
  "    @staticmethod",
  "    def FreshSite(stripe: Stripe) -> None: ...",
  "",
].join("\n");

const PY_TYPE = [
  "class Tile:",
  "    def __init__(self, morton_code: int, lod: int) -> None:",
  "        self.morton_code = morton_code",
  "        self.lod = lod",
  "",
  "    def SubtendedChildren(self) -> list:",
  "        return []",
  "",
  "    def Key(self) -> str:",
  '        return f"{self.morton_code}:{self.lod}"',
  "",
].join("\n");

const mem = (name, signature, kind = "method") => ({ name, signature, kind });

const LANGS = [
  {
    id: "typescript",
    extractor: "TsCommandExtractor",
    siteUri: "file:///fake/ws/fim.ts",
    typeUri: "file:///fake/ws/tile.ts",
    siteSource: TS_SITE,
    typeSource: TS_TYPE,
    ctorName: "constructor",
    // Where Tile's own name token sits in the TYPE file.
    typeDefCursor: { line: 0, character: 13 },
    // The member site: after `stripe.`
    siteCursor: { line: 6, character: 11 },
    tileMemberNames: ["mortonCode", "lod", "constructor", "SubtendedChildren", "Key"],
    siteSymbols: [
      dsym("Fim", SK.Class, vr(3, 0, 12, 1), [
        dsym("TileSite", SK.Method, vr(4, 2, 7, 3)),
        dsym("StripeMutatorSite", SK.Method, vr(8, 2, 8, 51)),
        dsym("MemberOverloadSite", SK.Method, vr(9, 2, 9, 52)),
        dsym("EnumSite", SK.Method, vr(10, 2, 10, 42)),
        dsym("FreshSite", SK.Method, vr(11, 2, 11, 43)),
      ]),
    ],
    typeSymbols: [
      dsym("Tile", SK.Class, vr(0, 0, 9, 1), [
        dsym("mortonCode", SK.Property, vr(1, 2, 1, 22)),
        dsym("lod", SK.Property, vr(2, 2, 2, 15)),
        dsym("constructor", SK.Constructor, vr(3, 2, 6, 3)),
        dsym("SubtendedChildren", SK.Method, vr(7, 2, 7, 44)),
        dsym("Key", SK.Method, vr(8, 2, 8, 62)),
      ]),
    ],
    siteHoverByLine: {
      4: "```typescript\n(method) Fim.TileSite(stripe: Stripe): void\n```",
      8: "```typescript\n(method) Fim.StripeMutatorSite(stripe: Stripe): void\n```",
      9: "```typescript\n(method) Fim.MemberOverloadSite(stripe: Stripe): void\n```",
      10: "```typescript\n(method) Fim.EnumSite(stripe: Stripe): void\n```",
      11: "```typescript\n(method) Fim.FreshSite(stripe: Stripe): void\n```",
    },
    typeHoverByLine: {
      1: "```typescript\n(property) Tile.mortonCode: number\n```",
      2: "```typescript\n(property) Tile.lod: number\n```",
      3: "```typescript\nconstructor Tile(mortonCode: number, lod: number): Tile\n```",
      7: "```typescript\n(method) Tile.SubtendedChildren(): Tile[]\n```",
      8: "```typescript\n(method) Tile.Key(): string\n```",
    },
    receiver: [
      mem("EnrollTile", "EnrollTile(tile: Tile): boolean"),
      mem("AggregateFanout", "AggregateFanout(): number"),
    ],
  },
  {
    id: "csharp",
    extractor: "CsCommandExtractor",
    siteUri: "file:///fake/ws/Fim.cs",
    typeUri: "file:///fake/ws/Tile.cs",
    siteSource: CS_SITE,
    typeSource: CS_TYPE,
    ctorName: "Tile",
    typeDefCursor: { line: 0, character: 13 },
    siteCursor: { line: 8, character: 15 },
    tileMemberNames: ["MortonCode", "Lod", "Tile", "SubtendedChildren", "Key"],
    siteSymbols: [
      dsym("Fim", SK.Class, vr(3, 0, 18, 1), [
        dsym("TileSite", SK.Method, vr(5, 4, 9, 5)),
        dsym("StripeMutatorSite", SK.Method, vr(11, 4, 11, 59)),
        dsym("MemberOverloadSite", SK.Method, vr(13, 4, 13, 60)),
        dsym("EnumSite", SK.Method, vr(15, 4, 15, 50)),
        dsym("FreshSite", SK.Method, vr(17, 4, 17, 51)),
      ]),
    ],
    typeSymbols: [
      dsym("Tile", SK.Class, vr(0, 0, 11, 1), [
        dsym("MortonCode", SK.Field, vr(2, 4, 2, 27), [], "MortonCode : int"),
        dsym("Lod", SK.Field, vr(3, 4, 3, 20), [], "Lod : int"),
        dsym("Tile", SK.Constructor, vr(4, 4, 8, 5), [], "Tile(int, int)"),
        dsym("SubtendedChildren", SK.Method, vr(9, 4, 9, 53), [], "SubtendedChildren() : Tile[]"),
        dsym("Key", SK.Method, vr(10, 4, 10, 54), [], "Key() : string"),
      ]),
    ],
    siteHoverByLine: {
      5: "```csharp\nvoid Fim.TileSite(Stripe stripe)\n```",
      11: "```csharp\nvoid Fim.StripeMutatorSite(Stripe stripe)\n```",
      13: "```csharp\nvoid Fim.MemberOverloadSite(Stripe stripe)\n```",
      15: "```csharp\nvoid Fim.EnumSite(Stripe stripe)\n```",
      17: "```csharp\nvoid Fim.FreshSite(Stripe stripe)\n```",
    },
    typeHoverByLine: {
      2: "```csharp\nint Tile.MortonCode\n```",
      3: "```csharp\nint Tile.Lod\n```",
      4: "```csharp\nTile.Tile(int mortonCode, int lod)\n```",
      9: "```csharp\nTile[] Tile.SubtendedChildren()\n```",
      10: "```csharp\nstring Tile.Key()\n```",
    },
    receiver: [
      mem("EnrollTile", "EnrollTile(Tile) : bool"),
      mem("AggregateFanout", "AggregateFanout() : int"),
    ],
  },
  {
    id: "python",
    extractor: "PyCommandExtractor",
    siteUri: "file:///fake/ws/fim.py",
    typeUri: "file:///fake/ws/tile.py",
    siteSource: PY_SITE,
    typeSource: PY_TYPE,
    ctorName: "__init__",
    typeDefCursor: { line: 0, character: 6 },
    siteCursor: { line: 8, character: 15 },
    tileMemberNames: ["__init__", "SubtendedChildren", "Key"],
    siteSymbols: [
      dsym("Fim", SK.Class, vr(4, 0, 20, 55), [
        dsym("TileSite", SK.Method, vr(6, 4, 8, 15)),
        dsym("StripeMutatorSite", SK.Method, vr(11, 4, 11, 54)),
        dsym("MemberOverloadSite", SK.Method, vr(14, 4, 14, 55)),
        dsym("EnumSite", SK.Method, vr(17, 4, 17, 45)),
        dsym("FreshSite", SK.Method, vr(20, 4, 20, 46)),
      ]),
    ],
    typeSymbols: [
      dsym("Tile", SK.Class, vr(0, 0, 9, 48), [
        dsym("__init__", SK.Method, vr(1, 4, 3, 21), [
          dsym("morton_code", SK.Variable, vr(2, 8, 2, 29)),
          dsym("lod", SK.Variable, vr(3, 8, 3, 16)),
        ]),
        dsym("SubtendedChildren", SK.Method, vr(5, 4, 6, 17)),
        dsym("Key", SK.Method, vr(8, 4, 9, 48)),
      ]),
    ],
    siteHoverByLine: {
      6: "```python\ndef TileSite(stripe: Stripe) -> None\n```",
      11: "```python\ndef StripeMutatorSite(stripe: Stripe) -> None\n```",
      14: "```python\ndef MemberOverloadSite(stripe: Stripe) -> None\n```",
      17: "```python\ndef EnumSite(stripe: Stripe) -> None\n```",
      20: "```python\ndef FreshSite(stripe: Stripe) -> None\n```",
    },
    typeHoverByLine: {
      // Captured from Pylance in a real extension host. See the sibling note in
      // blind-v15-product-argtypes.test.cjs.
      1: "```python\n(method) def __init__(\n    self: Self@Tile,\n    morton_code: int,\n    lod: int\n) -> None\n```",
      5: "```python\ndef SubtendedChildren(self) -> list\n```",
      8: "```python\ndef Key(self) -> str\n```",
    },
    receiver: [
      mem("EnrollTile", "EnrollTile(self, tile: Tile) -> bool"),
      mem("AggregateFanout", "AggregateFanout(self) -> int"),
    ],
  },
];

// ---------------------------------------------------------------------------
// Transport wiring. `definitionMode` picks what the language server answers for
// the Tile reference in the SITE file:
//   "toType"        - the honest answer, Tile's own file
//   "none"          - the server cannot anchor the reference at all
//   "referenceSite" - the server answers the reference position itself, which
//                     is inside the helper class. The trap.
// ---------------------------------------------------------------------------

function transportFor(lang, opts = {}) {
  const {
    definitionMode = "toType",
    typeSymbols = lang.typeSymbols,
    workspaceSymbols = true,
    hover = true,
  } = opts;

  const handlers = {
    [CMD.docSymbol]: (cursor) => (cursor.uri === lang.typeUri ? typeSymbols : lang.siteSymbols),
  };
  if (hover) {
    handlers[CMD.hover] = (cursor) => {
      const table = cursor.uri === lang.typeUri ? lang.typeHoverByLine : lang.siteHoverByLine;
      const md = table[cursor.line];
      return md === undefined ? undefined : hoverAnswer(md);
    };
  }
  handlers[CMD.definition] = (cursor) => {
    if (definitionMode === "none") return undefined;
    if (definitionMode === "referenceSite") {
      return locationAt(lang.siteUri, cursor.line, cursor.character);
    }
    return locationAt(lang.typeUri, lang.typeDefCursor.line, lang.typeDefCursor.character);
  };

  const { run, calls } = runnerFor(handlers);
  const readText = (uri) => {
    if (uri === lang.siteUri) return lang.siteSource;
    if (uri === lang.typeUri) return lang.typeSource;
    return undefined;
  };
  // The workspace-symbol leg, offered to any transport that accepts one. A
  // transport that does not take a third argument simply ignores it.
  const runSymbol = async (query) => {
    if (!workspaceSymbols) return [];
    const all = [
      {
        name: "Fim",
        kind: SK.Class,
        containerName: "Atlas",
        location: { uri: { toString: () => lang.siteUri }, range: vr(3, 20, 3, 23) },
      },
      {
        name: "Tile",
        kind: SK.Class,
        containerName: "Atlas",
        location: {
          uri: { toString: () => lang.typeUri },
          range: vr(lang.typeDefCursor.line, lang.typeDefCursor.character, lang.typeDefCursor.line, lang.typeDefCursor.character + 4),
        },
      },
    ];
    return all.filter((s) => s.name === query);
  };

  const Ctor = mod[lang.extractor];
  return { extractor: new Ctor(run, readText, runSymbol), calls };
}

const anchorFor = (lang, type) =>
  lang.id === "python"
    ? mod.pyFindTypeAnchorInText(lang.siteSource, type)
    : mod.findTypeAnchorInText(lang.siteSource, type);

// The GENEROUS composition: try every exported way to reach a named type's
// definition. Any honest strategy passes; the test never does the
// disambiguation itself.
async function resolveTypeSurface(lang, extractor, typeName) {
  let cursor;
  if (typeof extractor.resolveTypeCursorByName === "function") {
    cursor = (await extractor.resolveTypeCursorByName(typeName)) ?? undefined;
  }
  if (!cursor) {
    const anchor = anchorFor(lang, typeName);
    if (anchor) {
      const def = await extractor.definition({ uri: lang.siteUri, line: anchor.line, character: anchor.character });
      if (def) {
        cursor = { uri: def.uri, line: def.range.startLine, character: def.range.startCharacter };
      }
    }
  }
  if (!cursor) return { cursor: undefined, members: [] };
  return { cursor, members: await extractor.membersOfType(cursor) };
}

// ---------------------------------------------------------------------------
// Block reading. The header, the names listed under it, and the whole text.
// ---------------------------------------------------------------------------

const blockFor = (lang, members) =>
  mod.renderFimCandidates(lang.receiver, "", mod.lineCommentFor(lang.id), [{ name: "Tile", members }]);

const receiverOnly = (lang) => mod.renderFimCandidates(lang.receiver, "", mod.lineCommentFor(lang.id));

function argSectionNames(lang, block) {
  if (block === undefined) return undefined;
  const prefix = mod.lineCommentFor(lang.id);
  const ls = String(block).split("\n");
  const start = ls.indexOf(`${prefix} to build a Tile:`);
  if (start < 0) return undefined;
  const names = [];
  for (const line of ls.slice(start + 1)) {
    const body = line.slice(prefix.length + 1).trim();
    if (body.length === 0) continue;
    if (body.startsWith("to build a ")) break; // the next type's section
    const m = /^([A-Za-z_$][A-Za-z0-9_$]*)/.exec(body);
    names.push(m ? m[1] : body);
  }
  return names;
}

// Parameter count of a rendered signature, receiver dropped. -1 when the line
// carries no parameter list at all.
const IMPLICIT_RECEIVER = /^(&\s*mut\s+self|&\s*self|self)\b/;
function paramCount(signature) {
  if (typeof signature !== "string") return -1;
  const open = signature.indexOf("(");
  if (open < 0) return -1;
  let depth = 0;
  let close = -1;
  for (let i = open; i < signature.length; i++) {
    const c = signature[i];
    if (c === "(" || c === "<" || c === "[") depth++;
    else if (c === ")" || c === ">" || c === "]") {
      depth--;
      if (depth === 0 && c === ")") {
        close = i;
        break;
      }
    }
  }
  if (close < 0) return -1;
  const inner = signature.slice(open + 1, close);
  const parts = [];
  let d = 0;
  let start = 0;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (c === "(" || c === "<" || c === "[") d++;
    else if (c === ")" || c === ">" || c === "]") d--;
    else if (c === "," && d === 0) {
      parts.push(inner.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(inner.slice(start));
  return parts.map((p) => p.trim()).filter((p) => p.length > 0 && !IMPLICIT_RECEIVER.test(p)).length;
}

const namesOf = (members) => members.map((m) => m.name);

// ===========================================================================
// 0. Fixture validity. The two symbol trees must be a real trap: distinct
// member sets, both reachable, both carrying signatures. If any of these go
// red the fixture is broken and the rest of the file proves nothing.
// ===========================================================================

for (const lang of LANGS) {
  gtest(`${lang.id}: fixture - the parameter-type scan names Tile from the receiver's members, which is what starts the whole leg`, () => {
    const types = mod.argumentTypeNames(lang.receiver, lang.id);
    assert.ok(types.includes("Tile"), `EnrollTile takes a Tile, so Tile must be in the scan; got ${JSON.stringify(types)}`);
  });

  gtest(`${lang.id}: fixture - the SITE file's symbol tree and Tile's symbol tree share no member name, so a resolution's target is always decidable`, async () => {
    const { extractor } = transportFor(lang);
    const atSite = await extractor.membersOfType({ uri: lang.siteUri, line: lang.siteCursor.line, character: lang.siteCursor.character });
    const atType = await extractor.membersOfType({ uri: lang.typeUri, ...lang.typeDefCursor });
    assert.deepStrictEqual(
      namesOf(atSite).slice().sort(),
      HELPERS.slice().sort(),
      `the cursor's own file must resolve to exactly the five helpers, or the trap is not armed; got ${JSON.stringify(namesOf(atSite))}`
    );
    // Which of Tile's members survive is the identity arm's business, not the
    // fixture's. The fixture only needs Tile's file to resolve to Tile's own
    // names and nothing else.
    assert.ok(namesOf(atType).length > 0, `Tile's own file must resolve to something; got ${JSON.stringify(namesOf(atType))}`);
    const notTiles = namesOf(atType).filter((n) => !lang.tileMemberNames.includes(n));
    assert.deepStrictEqual(notTiles, [], `Tile's file must resolve only to Tile's members; got ${JSON.stringify(namesOf(atType))}`);
    const overlap = namesOf(atSite).filter((n) => namesOf(atType).includes(n));
    assert.deepStrictEqual(overlap, [], `the two trees must be disjoint for the identity assertion to mean anything; got ${JSON.stringify(overlap)}`);
  });
}

// ===========================================================================
// 1. THE HEART. The construction surface resolved for Tile is Tile's, and the
// rendered block never names the enclosing file's helpers.
// [goal.md build step 1: "Resolve the argument types' constructors"]
// ===========================================================================

for (const lang of LANGS) {
  gtest(`${lang.id}: identity - resolving the argument type Tile yields TILE's members, and never the enclosing helper class's [the false-statement guard]`, async () => {
    const { extractor } = transportFor(lang);
    const { cursor, members } = await resolveTypeSurface(lang, extractor, "Tile");
    assert.ok(cursor, "Tile is defined in this workspace, so some exported primitive must reach its definition");
    assert.strictEqual(
      cursor.uri,
      lang.typeUri,
      `the resolution must land in Tile's OWN file, not the cursor's; got ${cursor.uri}`
    );
    const got = namesOf(members);
    const leaked = got.filter((n) => HELPERS.includes(n));
    assert.deepStrictEqual(
      leaked,
      [],
      `these are members of the enclosing helper class, not of Tile, and presenting them as Tile's surface is a false statement to the model; got ${JSON.stringify(got)}`
    );
    for (const expected of [lang.ctorName, "SubtendedChildren"]) {
      assert.ok(
        got.includes(expected),
        `Tile's own ${expected} must reach the surface; got ${JSON.stringify(got)}`
      );
    }
  });

  gtest(`${lang.id}: identity - the rendered block carries "to build a Tile:" and every name under it is a Tile member`, async () => {
    const { extractor } = transportFor(lang);
    const { members } = await resolveTypeSurface(lang, extractor, "Tile");
    const block = blockFor(lang, members);
    assert.ok(block !== undefined, "the receiver's members carry signatures, so a block must render");
    const listed = argSectionNames(lang, block);
    assert.ok(
      listed !== undefined,
      `Tile resolves in this workspace, so its construction surface must be injected, not silently dropped:\n${block}`
    );
    assert.ok(listed.length > 0, `a header with nothing under it is worse than no header:\n${block}`);
    const foreign = listed.filter((n) => !lang.tileMemberNames.includes(n));
    assert.deepStrictEqual(
      foreign,
      [],
      `every name under "to build a Tile:" must belong to Tile:\n${block}`
    );
  });

  gtest(`${lang.id}: identity - no helper name from the cursor's own file appears ANYWHERE in the injected block [the negative assertion this file exists for]`, async () => {
    const { extractor } = transportFor(lang);
    const { members } = await resolveTypeSurface(lang, extractor, "Tile");
    const block = String(blockFor(lang, members) ?? "");
    const present = HELPERS.filter((h) => block.includes(h));
    assert.deepStrictEqual(
      present,
      [],
      `the enclosing file's helper functions are not part of any type's surface and must never be injected:\n${block}`
    );
  });

  gtest(`${lang.id}: identity - the block states Tile's ${CTOR_ARITY}-argument construction, so \`new Tile(1)\` is unwritable from it [goal.md "constructor arity 0/8"]`, async () => {
    const { extractor } = transportFor(lang);
    const { members } = await resolveTypeSurface(lang, extractor, "Tile");
    const block = blockFor(lang, members);
    const prefix = mod.lineCommentFor(lang.id);
    const ls = String(block ?? "").split("\n");
    const start = ls.indexOf(`${prefix} to build a Tile:`);
    assert.ok(start >= 0, `the construction section must be present:\n${block}`);
    const bodies = ls.slice(start + 1).map((l) => l.slice(prefix.length + 1));
    assert.ok(
      bodies.some((l) => paramCount(l) === CTOR_ARITY),
      `a line under "to build a Tile:" must state ${CTOR_ARITY} constructor arguments:\n${block}`
    );
  });
}

// ===========================================================================
// 2. The reference site is NOT the definition. When the language server answers
// the Tile reference with the reference's own position - inside the helper
// class - the resolution must not hand back the helper class as Tile.
// ===========================================================================

for (const lang of LANGS) {
  // C# only: the C# transport hands back the enclosing helper class, which is the
  // false statement to the model this whole file exists to catch. TS and Python
  // already refuse it.
  //
  // CONVERTED 2026-08-10: for C# this row USED to assert `leaked` and `present`
  // are both [] - no helper name reaches Tile's surface or the block. C# fails
  // that. The C# leg now asserts the exact leak the shipped transport produces,
  // so the row is green and still binds the same two expressions to exact
  // values. TS and Python keep the original demand unchanged.
  gtodo(lang.id === "csharp", `${lang.id}: cross-file - when the language server answers the Tile reference with the REFERENCE POSITION (inside the helper class), the helper members are never presented as Tile's surface`, `${lang.id}: cross-file - a definition answer at the REFERENCE POSITION presents every helper class in the cursor file as Tile's surface, and the renderer is what stops it`, async () => {
    const { extractor } = transportFor(lang, { definitionMode: "referenceSite", workspaceSymbols: false });
    const { members } = await resolveTypeSurface(lang, extractor, "Tile");
    const got = namesOf(members);
    const leaked = got.filter((n) => HELPERS.includes(n));
    const block = String(blockFor(lang, members) ?? "");
    const present = HELPERS.filter((h) => block.includes(h));
    if (lang.id === "csharp") {
      // The defect, stated exactly. The C# transport accepts the reference
      // position as Tile's definition and hands back the ENCLOSING file's
      // helper classes, every one of them, and the renderer prints them under
      // "to build a Tile:". Red here means the cross-file leg landed.
      assert.deepStrictEqual(
        leaked,
        HELPERS,
        `KNOWN WRONG: C# presents all five of the cursor file's helper classes as Tile's surface; got ${JSON.stringify(got)}`
      );
      assert.deepStrictEqual(
        present,
        [],
        `the leak stops at the renderer - the helper symbols carry no signature, so no name reaches the block:\n${block}`
      );
      assert.strictEqual(
        block,
        receiverOnly(lang),
        `and the block degrades to receiver-only, byte-identical:\n${block}`
      );
      return;
    }
    assert.deepStrictEqual(
      leaked,
      [],
      `the enclosing declaration is not Tile; a container whose name is not the type must be refused, not rendered as its construction surface; got ${JSON.stringify(got)}`
    );
    assert.deepStrictEqual(present, [], `and nothing from the helper class reaches the block:\n${block}`);
  });

  // TS and Python only: neither has a by-name workspace-symbol leg, so a type
  // whose definition the server will not point at is simply unreachable. C# has one.
  //
  // CONVERTED 2026-08-10: for TS and Python this row USED to assert that
  // `cursor` is truthy, lands in Tile's own file, and carries Tile's
  // constructor. Neither language has a by-name leg, so all three fail. The
  // TS/Python legs now assert the exact unreachability the shipped transports
  // produce - no cursor, no members, and a block byte-identical to the
  // receiver-only fallback. C# keeps the original demand unchanged.
  gtodo(lang.id !== "csharp", `${lang.id}: cross-file - with NO usable definition answer for the reference, Tile is still reached by NAME, because Tile is defined in this workspace`, `${lang.id}: cross-file - with NO usable definition answer, Tile is not reached at all: there is no by-name workspace-symbol leg in this transport`, async () => {
    const { extractor } = transportFor(lang, { definitionMode: "none" });
    const { cursor, members } = await resolveTypeSurface(lang, extractor, "Tile");
    if (lang.id !== "csharp") {
      // The gap, stated exactly. Red here means the by-name leg landed for this
      // language.
      assert.strictEqual(
        cursor,
        undefined,
        `KNOWN WRONG: ${lang.id} has no by-name workspace-symbol leg, so a type the server will not point at is unreachable; got ${JSON.stringify(cursor)}`
      );
      assert.deepStrictEqual(
        namesOf(members),
        [],
        `KNOWN WRONG: and with no cursor there is no surface at all; got ${JSON.stringify(namesOf(members))}`
      );
      assert.strictEqual(
        blockFor(lang, members),
        receiverOnly(lang),
        "and the degrade is honest: byte-identical to the receiver-only block, with no 'to build a Tile:' header"
      );
      return;
    }
    assert.ok(
      cursor,
      "a type named in a member's signature and defined elsewhere in the workspace must still be reachable; a per-file cursor is not the only leg"
    );
    assert.strictEqual(cursor.uri, lang.typeUri, `the by-name leg must land in Tile's own file; got ${cursor.uri}`);
    const got = namesOf(members);
    assert.ok(got.includes(lang.ctorName), `Tile's constructor must reach the surface by the name leg; got ${JSON.stringify(got)}`);
    assert.deepStrictEqual(got.filter((n) => HELPERS.includes(n)), [], `and no helper leaks in; got ${JSON.stringify(got)}`);
  });
}

// ===========================================================================
// 3. Honest degrade. A type that resolves to nothing renders NO header. A bare
// "to build a Tile:" is worse than omitting the section.
// ===========================================================================

for (const lang of LANGS) {
  for (const { why, opts } of [
    { why: "the server answers no definition and no workspace symbol", opts: { definitionMode: "none", workspaceSymbols: false } },
    { why: "Tile's own file yields an empty symbol list", opts: { typeSymbols: [], workspaceSymbols: false } },
    { why: "Tile's own file yields a non-symbol shape", opts: { typeSymbols: { not: "symbols" }, workspaceSymbols: false } },
    { why: "Tile's own file yields nothing at all", opts: { typeSymbols: null, workspaceSymbols: false } },
  ]) {
    gtest(`${lang.id}: degrade - when ${why}, the block is EXACTLY the receiver-only block and no "to build a" header is rendered`, async () => {
      const { extractor } = transportFor(lang, opts);
      const { members } = await resolveTypeSurface(lang, extractor, "Tile");
      const block = blockFor(lang, members);
      assert.ok(
        !String(block ?? "").includes("to build a"),
        `an unresolved type must render no header; a header over nothing or over foreign content is worse than silence:\n${block}`
      );
      assert.strictEqual(
        block,
        receiverOnly(lang),
        `the fallback is today's receiver-only behaviour, byte-identical:\n${block}`
      );
      const present = HELPERS.filter((h) => String(block ?? "").includes(h));
      assert.deepStrictEqual(present, [], `and no helper name appears in the fallback either:\n${block}`);
    });
  }
}
