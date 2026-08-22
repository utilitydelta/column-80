// session-v51 phase 2: THE GATHER STOPS WHERE THE RENDER STOPS.
//
// `resolveCrossFileShape` buys a definition(), a hover and a documentSymbol for
// every collaborator it reaches. `walkDataShape`, which renders the block, walks
// at most B_MAX distinct LOCAL field types per node. Measured over 20 real pgx
// roots (`docs/architecture/surface-injection.md`, "The hover fan-out: what it
// gathers against what reaches the prompt"): 117 types gathered, 86 inside the
// render's own BFS, 63 actually rendered. 31 types - 26% of everything gathered,
// 11 of the 26 on `pgx.Conn` - sat outside the render's BFS, so no budget at any
// stop could ever have spent them. Each cost three round trips, and a hover into
// a package gopls has not type-checked measured 71ms and 76ms against 0.15ms
// warm, recorded in that same section.
//
// `CrossFileBound.B_MAX` is the opt-in that stops that. These rows hold three
// things, and the third is the one that matters:
//
//   1. the cap actually cuts the round trips (counted at a fake transport);
//   2. it is ABSENT-BY-DEFAULT - a caller that passes no B_MAX gets today's walk
//      call for call, which is what keeps Rust, TypeScript, C#, Python and the
//      whole FIM path where they are;
//   3. THE RENDERED BLOCK IS BYTE-IDENTICAL. The cap is only sound if the render
//      could not have used what it removes, so every structural row is followed
//      by a render row that puts the capped and uncapped shapes through the
//      product's own `walkDataShape` + `toResolveStruct` and compares bytes.
//
// AND A FACADE ROW. `a-hooks-object-can-be-wired-to-nothing` and `bind-the-
// oracle-to-the-facade`: a bound the resolver honours and no caller passes is a
// dead feature that every unit row above would still call green. The last rows
// drive `resolvePrefill` itself over a Go document and a C# document and assert
// that Go's gather stops and C#'s does not.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");

// ===========================================================================
// HARNESS A: the core resolver + the product's own renderer, bundled pure.
// ===========================================================================
const A_ENTRY = path.join(__dirname, ".impl-v51-p2-core.entry.ts");
const A_OUT = path.join(__dirname, ".impl-v51-p2-core.bundle.cjs");
let CORE = {};
let coreErr;
try {
  fs.writeFileSync(
    A_ENTRY,
    `export { resolveCrossFileShape, toResolveStruct } from "../src/core/crossFileShape";
export { walkDataShape } from "../src/core/dataShape";\n`,
  );
  esbuild.buildSync({ entryPoints: [A_ENTRY], bundle: true, outfile: A_OUT, format: "cjs", platform: "node" });
  CORE = require(A_OUT);
} catch (e) {
  coreErr = e;
}

// ===========================================================================
// HARNESS B: `resolvePrefill`, the facade, against a structural vscode stub.
// ===========================================================================
const STUB = path.join(__dirname, ".impl-v51-p2-vscode-stub.cjs");
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
    const ps = p.start ? p.start : p, pe = p.end ? p.end : p;
    const geS = ps.line > this.start.line || (ps.line === this.start.line && ps.character >= this.start.character);
    const leE = pe.line < this.end.line || (pe.line === this.end.line && pe.character <= this.end.character);
    return geS && leE;
  }
  with(s, e) { return new Range(s || this.start, e || this.end); }
}
const mkUri = (s) => ({ toString: () => String(s), fsPath: String(s), path: String(s) });
const keyOf = (a) => (typeof a === "string" ? a : (a && a.toString ? a.toString() : String(a)));
module.exports = {
  Position, Range, Selection: class extends Range {}, WorkspaceEdit: class {},
  EventEmitter: class { constructor(){ this.event=()=>({dispose(){}}); } fire(){} dispose(){} },
  ThemeColor: class {}, MarkdownString: class {},
  InlineCompletionItem: class { constructor(text, range) { this.insertText = text; this.range = range; } },
  InlineCompletionTriggerKind: { Invoke: 0, Automatic: 1 },
  Uri: { parse: mkUri, file: mkUri },
  SymbolKind: { File:0, Module:1, Namespace:2, Package:3, Class:4, Method:5, Property:6,
    Field:7, Constructor:8, Enum:9, Interface:10, Function:11, Variable:12, Constant:13,
    String:14, Number:15, Boolean:16, Array:17, Object:18, Key:19, Null:20, EnumMember:21,
    Struct:22, Event:23, Operator:24, TypeParameter:25 },
  ProgressLocation: { SourceControl:1, Window:10, Notification:15 },
  EndOfLine: { LF:1, CRLF:2 },
  languages: {},
  window: {
    createOutputChannel: () => ({ name: "column80", append(){}, appendLine(){}, replace(){}, clear(){}, show(){}, hide(){}, dispose(){} }),
    showInformationMessage: async () => undefined,
    showWarningMessage: async () => undefined,
    showErrorMessage: async () => undefined,
    activeTextEditor: undefined,
    onDidChangeActiveTextEditor: () => ({ dispose() {} }),
    withProgress: async (_o, t) => t({ report(){} }, { isCancellationRequested: false, onCancellationRequested: () => ({ dispose(){} }) }),
  },
  commands: { executeCommand: async () => undefined },
  workspace: {
    textDocuments: [],
    getConfiguration: () => ({
      get: (k, f) => {
        const c = globalThis.__V51P2_CFG__ || {};
        return Object.prototype.hasOwnProperty.call(c, k) ? c[k] : f;
      },
      has: () => false, inspect: () => undefined, update: async () => {},
    }),
    openTextDocument: (arg) =>
      Promise.resolve({ uri: mkUri(keyOf(arg)), getText: () => (globalThis.__V51P2_FILES__ || {})[keyOf(arg)] }),
  },
};
`,
);
const B_ENTRY = path.join(__dirname, ".impl-v51-p2-facade.entry.ts");
const B_OUT = path.join(__dirname, ".impl-v51-p2-facade.bundle.cjs");
let FACADE = {};
let facadeErr;
try {
  fs.writeFileSync(B_ENTRY, `export { resolvePrefill } from "../src/vscode/fnGen";\n`);
  esbuild.buildSync({
    entryPoints: [B_ENTRY],
    bundle: true,
    outfile: B_OUT,
    format: "cjs",
    platform: "node",
    alias: { vscode: STUB },
  });
  FACADE = require(B_OUT);
} catch (e) {
  facadeErr = e;
}
const V = (() => {
  try {
    return require(STUB);
  } catch {
    return undefined;
  }
})();

test.after(() => [A_ENTRY, A_OUT, STUB, B_ENTRY, B_OUT].forEach((f) => fs.rmSync(f, { force: true })));

// A bundle failure is a LOUD row, never a skip.
const ctest = (name, fn) =>
  test(name, (t) => {
    if (coreErr) assert.fail(`the core bundle did not build: ${coreErr.message}`);
    return fn(t);
  });
const btest = (name, fn) =>
  test(name, (t) => {
    if (coreErr) assert.fail(`the core bundle did not build: ${coreErr.message}`);
    if (facadeErr) assert.fail(`the facade bundle did not build: ${facadeErr.message}`);
    return fn(t);
  });

// ===========================================================================
// THE FIXTURE. A Rust-shaped file, so the walk runs on the NO-HOOKS default
// path - the one every frozen Rust row rides - and a cap that misbehaved there
// would be caught by this file first.
//
// `Root` has `childCount` field types, each its own struct with `grandChildren`
// fields of its own, so both the root's fan-out and a depth-1 node's fan-out are
// under test. `deadFirst` makes the first N candidates unresolvable, which is
// the case that separates a commit-counted cap from a push-counted one.
// ===========================================================================
const URI = "file:///w/v51p2/lib.rs";

function fixture({ childCount = 10, grandChildren = 0, deadFirst = 0 } = {}) {
  const lines = [];
  const declLine = new Map();
  lines.push("pub struct Root {");
  for (let i = 1; i <= childCount; i++) {
    lines.push(`    f${i}: C${i},`);
  }
  lines.push("}");
  declLine.set("Root", 0);
  for (let i = 1; i <= childCount; i++) {
    declLine.set(`C${i}`, lines.length);
    lines.push(`pub struct C${i} {`);
    for (let g = 1; g <= grandChildren; g++) {
      lines.push(`    g${g}: G${i}_${g},`);
    }
    lines.push("}");
  }
  for (let i = 1; i <= childCount; i++) {
    for (let g = 1; g <= grandChildren; g++) {
      declLine.set(`G${i}_${g}`, lines.length);
      lines.push(`pub struct G${i}_${g} {`);
      lines.push("}");
    }
  }
  const text = lines.join("\n");
  const dead = new Set(Array.from({ length: deadFirst }, (_, i) => `C${i + 1}`));

  const wordAt = (cursor) => {
    const line = text.split("\n")[cursor.line] ?? "";
    const isWord = (ch) => /[A-Za-z0-9_]/.test(ch);
    let s = Math.min(cursor.character, line.length);
    let e = s;
    while (s > 0 && isWord(line[s - 1])) s--;
    while (e < line.length && isWord(line[e])) e++;
    return e > s ? line.slice(s, e) : undefined;
  };
  const signatureOf = (name) => {
    const at = declLine.get(name);
    const body = [];
    for (let i = at + 1; !text.split("\n")[i].startsWith("}"); i++) {
      body.push(text.split("\n")[i].trim());
    }
    return `pub struct ${name} { ${body.join(" ")} }`.replace(/,\s*}/, " }");
  };

  const rec = { definitions: [], hovers: [], members: [], opens: [] };
  const extractor = {
    async completeMembers() {
      return [];
    },
    async definition(cursor) {
      const w = wordAt(cursor);
      rec.definitions.push(w);
      if (w === undefined || !declLine.has(w) || dead.has(w)) return undefined;
      const line = declLine.get(w);
      const ch = text.split("\n")[line].indexOf(w);
      return { uri: URI, range: { startLine: line, startCharacter: ch, endLine: line, endCharacter: ch + w.length } };
    },
    async hoverSurface(cursor) {
      const w = wordAt(cursor);
      rec.hovers.push(w);
      return w !== undefined && declLine.has(w) ? { signature: signatureOf(w) } : undefined;
    },
    async membersOfType(cursor) {
      rec.members.push(wordAt(cursor));
      return [];
    },
    async example() {
      return undefined;
    },
    async qualifyImport() {
      return undefined;
    },
  };
  const openFile = async (u) => {
    rec.opens.push(u);
    return u === URI ? text : undefined;
  };
  const rootSite = { uri: URI, line: 0, character: text.split("\n")[0].indexOf("Root") };
  return { text, declLine, extractor, openFile, rec, rootSite };
}

const walk = (f, bound) =>
  CORE.resolveCrossFileShape(f.extractor, f.rootSite, bound, f.openFile, undefined, "Root");

// The product's own render of a shape, at the install default's shape of bounds.
// If the cap removed something the render wanted, these bytes move.
const RENDER_BOUNDS = { D_MAX: 2, B_MAX: 6, N_MAX: 24, TOK_MAX: 400 };
const render = (shape, bounds = RENDER_BOUNDS, remainingChars = 2400) =>
  CORE.walkDataShape("Root", CORE.toResolveStruct(shape), bounds, {
    visited: new Set(),
    remainingChars,
    droppedBy: new Map(),
    memberBlocks: new Set(),
  });

const names = (shape) => [...shape.types.keys()];
const dump = (shape, f) =>
  `\n  emitted: ${names(shape).join(", ")}` +
  `\n  dropped: ${shape.dropped.join(", ")}` +
  `\n  definition() on: ${f.rec.definitions.join(", ")}` +
  `\n  hover on: ${f.rec.hovers.join(", ")}`;

// ===========================================================================
// P2-1. ABSENT B_MAX IS TODAY'S WALK. The default path must not move: Rust,
// TypeScript, C#, Python and every FIM caller pass no B_MAX at all.
// ===========================================================================
ctest("P2-1 a bound with no B_MAX gathers every field candidate, call for call", async () => {
  const f = fixture({ childCount: 10 });
  const shape = await walk(f, { D_MAX: 2, N_MAX: 30 });
  assert.equal(names(shape).length, 11, `the uncapped gather must reach Root and all ten children${dump(shape, f)}`);
  assert.equal(f.rec.hovers.length, 11, `one hover per gathered type${dump(shape, f)}`);
  assert.deepEqual(shape.dropped, [], `nothing is dropped when no cap is passed${dump(shape, f)}`);
});

// ===========================================================================
// P2-2. THE CAP CUTS THE ROUND TRIPS. Six children commit; the four behind them
// never buy a definition, a hover or a documentSymbol, and they are NAMED.
// ===========================================================================
ctest("P2-2 B_MAX stops the gather at the render's own per-node fan-out", async () => {
  const f = fixture({ childCount: 10 });
  const shape = await walk(f, { D_MAX: 2, N_MAX: 30, B_MAX: 6 });
  assert.deepEqual(
    names(shape),
    ["Root", "C1", "C2", "C3", "C4", "C5", "C6"],
    `the gather keeps the first six field children in declaration order${dump(shape, f)}`,
  );
  assert.deepEqual(
    shape.dropped,
    ["C7", "C8", "C9", "C10"],
    `a type the cap refused is named, never silent${dump(shape, f)}`,
  );
  assert.equal(f.rec.hovers.length, 7, `seven types resolved means seven hovers, not eleven${dump(shape, f)}`);
  assert.ok(
    !f.rec.definitions.includes("C7") && !f.rec.definitions.includes("C10"),
    `a capped child must cost NO definition round trip${dump(shape, f)}`,
  );
});

// ===========================================================================
// P2-3. THE RENDER IS BYTE-IDENTICAL. This is the row the whole change rests on:
// the cap may only remove types the renderer could never have reached.
// ===========================================================================
ctest("P2-3 the rendered data-shape block is byte-identical with and without the cap", async () => {
  for (const shapeOf of [
    { label: "flat, ten children", opts: { childCount: 10 } },
    { label: "ten children with four grandchildren each", opts: { childCount: 10, grandChildren: 4 } },
    { label: "eight children with eight grandchildren each", opts: { childCount: 8, grandChildren: 8 } },
    { label: "three children, under the cap", opts: { childCount: 3, grandChildren: 2 } },
  ]) {
    const open = await walk(fixture(shapeOf.opts), { D_MAX: 2, N_MAX: 30 });
    const capped = await walk(fixture(shapeOf.opts), { D_MAX: 2, N_MAX: 30, B_MAX: RENDER_BOUNDS.B_MAX });
    const a = render(open);
    const b = render(capped);
    assert.equal(
      b.block,
      a.block,
      `${shapeOf.label}: the capped gather must render the same bytes\n  uncapped:\n${a.block}\n  capped:\n${b.block}`,
    );
    assert.deepEqual(
      b.defs.map((d) => d.name),
      a.defs.map((d) => d.name),
      `${shapeOf.label}: the same defs, in the same order`,
    );
  }
});

// ===========================================================================
// P2-4. A FAILED CANDIDATE COSTS THE RENDER NO SLOT, SO IT COSTS THE GATHER
// NONE EITHER. This is the row that separates a commit-counted cap from a
// push-counted one: with the first three candidates unresolvable, the render's
// six local slots go to C4..C9, and a push-counted cap would stop at C6 and
// starve the block of three types it renders today.
// ===========================================================================
ctest("P2-4 candidates that fail to resolve do not spend the cap", async () => {
  const f = fixture({ childCount: 12, deadFirst: 3 });
  const shape = await walk(f, { D_MAX: 2, N_MAX: 30, B_MAX: 6 });
  assert.deepEqual(
    names(shape),
    ["Root", "C4", "C5", "C6", "C7", "C8", "C9"],
    `three dead candidates must not consume the parent's six emitting slots${dump(shape, f)}`,
  );
  const open = await walk(fixture({ childCount: 12, deadFirst: 3 }), { D_MAX: 2, N_MAX: 30 });
  assert.equal(render(f === undefined ? open : shape).block, render(open).block, "and the block still renders identically");
});

// ===========================================================================
// P2-5. THE CAP IS PER NODE, NOT PER WALK. Each depth-1 type gets its own six.
// ===========================================================================
ctest("P2-5 every node carries its own fan-out budget", async () => {
  const f = fixture({ childCount: 2, grandChildren: 9 });
  const shape = await walk(f, { D_MAX: 2, N_MAX: 30, B_MAX: 6 });
  const kept = names(shape);
  assert.ok(kept.includes("C1") && kept.includes("C2"), `both children survive a two-wide root${dump(shape, f)}`);
  for (const parent of [1, 2]) {
    const mine = kept.filter((n) => n.startsWith(`G${parent}_`));
    assert.equal(mine.length, 6, `C${parent} gets its own six grandchildren, not a share of one pool${dump(shape, f)}`);
  }
});

// ===========================================================================
// THE FACADE ROWS. A bound nothing passes is a dead feature.
// ===========================================================================
const GO_URI = "file:///w/v51p2/app.go";

// A Go fixture in the shape the Go hooks read: a gopls struct hover, which is a
// fenced `type X struct { ... }` declaration with `Name Type` fields.
function goFixture(childCount) {
  const lines = ["package app", "", "type Root struct {"];
  for (let i = 1; i <= childCount; i++) {
    lines.push(`\tF${i} C${i}`);
  }
  lines.push("}", "");
  const declLine = new Map([["Root", 2]]);
  for (let i = 1; i <= childCount; i++) {
    declLine.set(`C${i}`, lines.length);
    lines.push(`type C${i} struct {`, "\tN int", "}", "");
  }
  lines.push("func Build(r Root) error {", "\treturn nil", "}", "");
  const text = lines.join("\n");
  const src = text.split("\n");
  const wordAt = (cursor) => {
    const line = src[cursor.line] ?? "";
    const isWord = (ch) => /[A-Za-z0-9_]/.test(ch);
    let s = Math.min(cursor.character, line.length);
    let e = s;
    while (s > 0 && isWord(line[s - 1])) s--;
    while (e < line.length && isWord(line[e])) e++;
    return e > s ? line.slice(s, e) : undefined;
  };
  const hoverFor = (name) => {
    const at = declLine.get(name);
    const body = [];
    for (let i = at; !/^}/.test(src[i]); i++) {
      body.push(src[i]);
    }
    body.push("}");
    return "```go\n" + body.join("\n") + "\n```";
  };
  const rec = { hovers: [], definitions: [] };
  const extractor = {
    async completeMembers() {
      return [];
    },
    async definition(cursor) {
      const w = wordAt(cursor);
      rec.definitions.push(w);
      if (w === undefined || !declLine.has(w)) return undefined;
      const line = declLine.get(w);
      const ch = src[line].indexOf(w);
      return { uri: GO_URI, range: { startLine: line, startCharacter: ch, endLine: line, endCharacter: ch + w.length } };
    },
    async hoverSurface(cursor) {
      const w = wordAt(cursor);
      rec.hovers.push(w);
      return w !== undefined && declLine.has(w) ? { signature: hoverFor(w) } : undefined;
    },
    async membersOfType() {
      return [];
    },
    async example() {
      return undefined;
    },
    async qualifyImport() {
      return undefined;
    },
  };
  return { text, extractor, rec };
}

function makeDoc(text, uriStr, languageId) {
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
    return new V.Position(Math.max(lines.length - 1, 0), 0);
  };
  return {
    languageId,
    version: 1,
    uri: { toString: () => uriStr },
    offsetAt,
    positionAt,
    getText: (r) => (r ? text.slice(offsetAt(r.start), offsetAt(r.end)) : text),
  };
}

btest("P2-6 a Go pre-fill gesture stops its gather at the render's fan-out", async () => {
  const f = goFixture(14);
  const signature = "func Build(r Root) error {";
  const record = {
    span: { start: f.text.indexOf(signature), end: f.text.length - 1 },
    signature,
    docComment: "Build it.",
    symbolName: "Build",
    languageId: "go",
    kind: "function",
    bodyOnly: false,
    headerIndent: "",
    bodyIndent: "\t",
  };
  globalThis.__V51P2_FILES__ = { ...(globalThis.__V51P2_FILES__ || {}), [GO_URI]: f.text };
  await FACADE.resolvePrefill(f.extractor, makeDoc(f.text, GO_URI, "go"), record, () => {});
  const childHovers = f.rec.hovers.filter((h) => /^C\d+$/.test(h ?? ""));
  assert.ok(
    childHovers.length <= 6,
    `a Go gesture must not hover more than the render's six field children per node; it hovered ` +
      `${childHovers.length}: ${childHovers.join(", ")}. A bound the resolver honours and no caller passes is a dead feature.`,
  );
  assert.ok(
    childHovers.length >= 6,
    `and it must still reach all six the render renders; it hovered ${childHovers.length}: ${childHovers.join(", ")}`,
  );
});

btest("P2-7 a language that did not opt in keeps its whole gather", async () => {
  // The same fixture handed to the pre-fill as TypeScript, which renders through
  // the same walk but has NOT opted in. It must gather everything, so the opt-in
  // is proved to be an opt-in rather than a global change wearing a flag.
  const TS_URI = "file:///w/v51p2/app.ts";
  const childCount = 14;
  const lines = ["export interface Root {"];
  for (let i = 1; i <= childCount; i++) lines.push(`  f${i}: C${i};`);
  lines.push("}");
  const declLine = new Map([["Root", 0]]);
  for (let i = 1; i <= childCount; i++) {
    declLine.set(`C${i}`, lines.length);
    lines.push(`export interface C${i} {`, "  n: number;", "}");
  }
  lines.push("export function build(r: Root): void {", "  return;", "}", "");
  const text = lines.join("\n");
  const src = text.split("\n");
  const wordAt = (cursor) => {
    const line = src[cursor.line] ?? "";
    const isWord = (ch) => /[A-Za-z0-9_]/.test(ch);
    let s = Math.min(cursor.character, line.length);
    let e = s;
    while (s > 0 && isWord(line[s - 1])) s--;
    while (e < line.length && isWord(line[e])) e++;
    return e > s ? line.slice(s, e) : undefined;
  };
  const hoverFor = (name) => {
    const at = declLine.get(name);
    const body = [];
    for (let i = at + 1; !/^}/.test(src[i]); i++) body.push(src[i].trim().replace(/;$/, ""));
    return `interface ${name} {\n    ${body.join(";\n    ")};\n}`;
  };
  const hovers = [];
  const extractor = {
    async completeMembers() {
      return [];
    },
    async definition(cursor) {
      const w = wordAt(cursor);
      if (w === undefined || !declLine.has(w)) return undefined;
      const line = declLine.get(w);
      const ch = src[line].indexOf(w);
      return { uri: TS_URI, range: { startLine: line, startCharacter: ch, endLine: line, endCharacter: ch + w.length } };
    },
    async hoverSurface(cursor) {
      const w = wordAt(cursor);
      hovers.push(w);
      return w !== undefined && declLine.has(w) ? { signature: hoverFor(w) } : undefined;
    },
    async membersOfType() {
      return [];
    },
    async example() {
      return undefined;
    },
    async qualifyImport() {
      return undefined;
    },
  };
  const signature = "export function build(r: Root): void {";
  const record = {
    span: { start: text.indexOf(signature), end: text.length - 1 },
    signature,
    docComment: "Build it.",
    symbolName: "build",
    languageId: "typescript",
    kind: "function",
    bodyOnly: false,
    headerIndent: "",
    bodyIndent: "  ",
  };
  globalThis.__V51P2_FILES__ = { ...(globalThis.__V51P2_FILES__ || {}), [TS_URI]: text };
  await FACADE.resolvePrefill(extractor, makeDoc(text, TS_URI, "typescript"), record, () => {});
  const childHovers = hovers.filter((h) => /^C\d+$/.test(h ?? ""));
  assert.ok(
    childHovers.length > 6,
    `TypeScript did not opt in, so its gather must be unchanged; it hovered only ${childHovers.length} children ` +
      `(${childHovers.join(", ")}), which means the cap leaked out of Go.`,
  );
});
