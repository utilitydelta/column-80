// Blind oracle (v12 type-gen, C# + TS): ADMISSION + genKind through the real
// `resolveFunctionAtCursor` (src/vscode/fnGen) driven over a FAKE vscode module.
// The contract (the scout's Q1/Q2, per-language admit sets):
//   typeKindsFor(languageId):   // vscode SymbolKind numbers
//     rust    -> {Struct, Enum}            FROZEN — a trait (Interface) never admitted
//     csharp  -> {Class, Struct, Enum}     + Class; Interface EXCLUDED (bodyless members)
//     ts      -> {Class, Interface, Enum}  + Class + Interface; no Struct in TS
// With admitTypes=true a cursor on a type HEADER resolves that type (genKind
// "class"/"struct"/"enum"/"interface"); a cursor in a METHOD body resolves the
// METHOD (genKind "function"); a cursor on a property/field walks UP to the
// enclosing type (Property/Field are not admitted). With admitTypes=false NO
// type is admitted for any language (function-only, v1 behaviour).
//
// Black-box: never reads the not-yet-written csharp/ts type branches. The C#
// class + TS class/interface admissions and the per-language genKinds are RED
// until phase 1 lands; the Rust FROZEN admissions (struct/enum admitted, trait
// excluded) and the injection-off guard are GREEN today (a red frozen guard =
// this file mismodelled the current behaviour; fix the harness, not the
// contract). SymbolKind uses vscode's OWN numbering (Class=4, Method=5,
// Struct=22, Enum=9, Interface=10) — the numbering the LS client hands the
// extension, PROVEN in scout.md.
//
// Run: SKIP_LIVE=1 node --test test/blind-v12-admit-csts.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");

// ===========================================================================
// A structural vscode stub: real Position/Range/Uri so the innermost-walk span
// math + Range.contains run honestly; executeDocumentSymbolProvider answers
// from a global fixture map. (Copied from the blind-v10 gestures harness.)
// ===========================================================================

const STUB = path.join(__dirname, ".blind-v12-admit-stub.cjs");
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
    get textDocuments() { return globalThis.__V12_OPEN_DOCS__ || []; },
    openTextDocument: async (arg) => {
      const key = typeof arg === "string" ? arg : arg && arg.toString ? arg.toString() : String(arg);
      const docs = globalThis.__V12_DOCS__ || {};
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
        return (globalThis.__V12_SYMBOLS__ || {})[key];
      }
      return undefined;
    },
  },
};
`,
);

const vEntry = path.join(__dirname, ".blind-v12-admit-v.entry.ts");
const vOut = path.join(__dirname, ".blind-v12-admit-v.bundle.cjs");
let surf = {};
let surfErr;
try {
  fs.writeFileSync(vEntry, `export { resolveFunctionAtCursor } from "../src/vscode/fnGen";\n`);
  esbuild.buildSync({ entryPoints: [vEntry], bundle: true, outfile: vOut, format: "cjs", platform: "node", alias: { vscode: STUB } });
  surf = require(vOut);
} catch (e) {
  surfErr = e;
}

test.after(() => {
  for (const f of [STUB, vEntry, vOut]) fs.rmSync(f, { force: true });
});

const V = surf;
const { Position, Range, Uri } = require(STUB);
const P = (l, c) => new Position(l, c);
const R = (sl, sc, el, ec) => new Range(sl, sc, el, ec);

// A test that skips (not fails) while the bundle is broken, so a red run stays
// one loud failure at the bundle guard rather than a wall of TypeErrors.
const gtest = (name, fn) =>
  test(name, (ctx) => {
    if (surfErr) return ctx.skip(`surface bundle failed to build; see the bundle guard: ${surfErr.message}`);
    return fn(ctx);
  });

test("bundle guard: resolveFunctionAtCursor (fnGen) builds headless against the vscode stub", () => {
  if (surfErr) assert.fail(`surface bundle failed: ${surfErr.message}`);
});

// A document backed by fixture text; ranges come from the documentSymbol tree.
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

// Symbol node helpers. `kind` is the vscode SymbolKind number.
const sym = (name, kind, range, sel, children = []) => ({ name, detail: "", kind, range, selectionRange: sel, children });

const withSymbols = (uriStr, doc, symbols, run) => {
  globalThis.__V12_SYMBOLS__ = { [uriStr]: symbols };
  globalThis.__V12_DOCS__ = { [uriStr]: doc };
  globalThis.__V12_OPEN_DOCS__ = [doc];
  return run();
};

// vscode SymbolKind numbers used below.
const K = { Namespace: 2, Class: 4, Method: 5, Property: 6, Field: 7, Enum: 9, Interface: 10, Function: 11, EnumMember: 21, Struct: 22 };

// ===========================================================================
// C# fixture — the scout Demo.cs geometry (file-scoped Namespace wrapper; a
// class with property + method children, a struct with fields, an enum with
// members, a bodyless-member interface). 0-indexed lines below.
// ===========================================================================
//  0 namespace Demo;
//  1
//  2 /// <summary>A server config.</summary>
//  3 public class ServerConfig
//  4 {
//  5     public int Port { get; set; }
//  6     public string Host { get; set; }
//  7
//  8     public void Reset()
//  9     {
// 10         Port = 0;
// 11     }
// 12 }
// 13
// 14 public struct Vec2
// 15 {
// 16     public float X;
// 17     public float Y;
// 18 }
// 19
// 20 public enum Color
// 21 {
// 22     Red,
// 23     Green,
// 24     Blue,
// 25 }
// 26
// 27 public interface IShape
// 28 {
// 29     double Area();
// 30 }
const CS_URI = "file:///proj/Demo.cs";
const CS_TEXT =
  "namespace Demo;\n" +
  "\n" +
  "/// <summary>A server config.</summary>\n" +
  "public class ServerConfig\n" +
  "{\n" +
  "    public int Port { get; set; }\n" +
  "    public string Host { get; set; }\n" +
  "\n" +
  "    public void Reset()\n" +
  "    {\n" +
  "        Port = 0;\n" +
  "    }\n" +
  "}\n" +
  "\n" +
  "public struct Vec2\n" +
  "{\n" +
  "    public float X;\n" +
  "    public float Y;\n" +
  "}\n" +
  "\n" +
  "public enum Color\n" +
  "{\n" +
  "    Red,\n" +
  "    Green,\n" +
  "    Blue,\n" +
  "}\n" +
  "\n" +
  "public interface IShape\n" +
  "{\n" +
  "    double Area();\n" +
  "}\n";

const csServerConfig = sym("ServerConfig", K.Class, R(3, 0, 12, 1), R(3, 13, 3, 25), [
  sym("Port : int", K.Property, R(5, 4, 5, 33), R(5, 15, 5, 19)),
  sym("Host : string", K.Property, R(6, 4, 6, 36), R(6, 18, 6, 22)),
  sym("Reset() : void", K.Method, R(8, 4, 11, 5), R(8, 16, 8, 21)),
]);
const csVec2 = sym("Vec2", K.Struct, R(14, 0, 18, 1), R(14, 14, 14, 18), [
  sym("X : float", K.Field, R(16, 17, 16, 18), R(16, 17, 16, 18)),
  sym("Y : float", K.Field, R(17, 17, 17, 18), R(17, 17, 17, 18)),
]);
const csColor = sym("Color", K.Enum, R(20, 0, 25, 1), R(20, 12, 20, 17), [
  sym("Red", K.EnumMember, R(22, 4, 22, 7), R(22, 4, 22, 7)),
  sym("Green", K.EnumMember, R(23, 4, 23, 9), R(23, 4, 23, 9)),
  sym("Blue", K.EnumMember, R(24, 4, 24, 8), R(24, 4, 24, 8)),
]);
const csIShape = sym("IShape", K.Interface, R(27, 0, 30, 1), R(27, 17, 27, 23), [
  sym("Area() : double", K.Method, R(29, 4, 29, 18), R(29, 11, 29, 15)), // bodyless single-line
]);
// File-scoped namespace wraps every type as a child; the walk must descend it.
const CS_SYMBOLS = [sym("Demo", K.Namespace, R(0, 0, 30, 1), R(0, 10, 0, 14), [csServerConfig, csVec2, csColor, csIShape])];

const csDoc = makeDoc(CS_TEXT, CS_URI, "csharp");
const csResolve = (line, ch, admitTypes) =>
  withSymbols(CS_URI, csDoc, CS_SYMBOLS, () => V.resolveFunctionAtCursor(csDoc, P(line, ch), admitTypes));

// ===========================================================================
// TS fixture — the scout ServerConfig/Shape/Color geometry. No namespace
// wrapper; top-level type declarations. 0-indexed lines.
// ===========================================================================
//  0 export class ServerConfig {
//  1   port = 0;
//  2   host = "";
//  3
//  4   reset(): void {
//  5     this.port = 0;
//  6   }
//  7 }
//  8
//  9 export interface Shape {
// 10   area(): number;
// 11   name: string;
// 12 }
// 13
// 14 export enum Color {
// 15   Red,
// 16   Green,
// 17   Blue,
// 18 }
const TS_URI = "file:///proj/fixture.ts";
const TS_TEXT =
  "export class ServerConfig {\n" +
  "  port = 0;\n" +
  '  host = "";\n' +
  "\n" +
  "  reset(): void {\n" +
  "    this.port = 0;\n" +
  "  }\n" +
  "}\n" +
  "\n" +
  "export interface Shape {\n" +
  "  area(): number;\n" +
  "  name: string;\n" +
  "}\n" +
  "\n" +
  "export enum Color {\n" +
  "  Red,\n" +
  "  Green,\n" +
  "  Blue,\n" +
  "}\n";

const tsServerConfig = sym("ServerConfig", K.Class, R(0, 0, 7, 1), R(0, 13, 0, 25), [
  sym("port", K.Property, R(1, 2, 1, 11), R(1, 2, 1, 6)),
  sym("host", K.Property, R(2, 2, 2, 12), R(2, 2, 2, 6)),
  sym("reset", K.Method, R(4, 2, 6, 3), R(4, 2, 4, 7)),
]);
const tsShape = sym("Shape", K.Interface, R(9, 0, 12, 1), R(9, 17, 9, 22), [
  sym("area", K.Method, R(10, 2, 10, 17), R(10, 2, 10, 6)), // bodyless
  sym("name", K.Property, R(11, 2, 11, 15), R(11, 2, 11, 6)),
]);
const tsColor = sym("Color", K.Enum, R(14, 0, 18, 1), R(14, 12, 14, 17), [
  sym("Red", K.EnumMember, R(15, 2, 15, 5), R(15, 2, 15, 5)),
  sym("Green", K.EnumMember, R(16, 2, 16, 7), R(16, 2, 16, 7)),
  sym("Blue", K.EnumMember, R(17, 2, 17, 6), R(17, 2, 17, 6)),
]);
const TS_SYMBOLS = [tsServerConfig, tsShape, tsColor];

const tsDoc = makeDoc(TS_TEXT, TS_URI, "typescript");
const tsResolve = (line, ch, admitTypes) =>
  withSymbols(TS_URI, tsDoc, TS_SYMBOLS, () => V.resolveFunctionAtCursor(tsDoc, P(line, ch), admitTypes));

// ===========================================================================
// Rust fixture — FROZEN. A struct, an enum, and a trait (Interface kind). The
// trait is the frozen guard: a Rust Interface is NEVER admitted. 0-indexed.
// ===========================================================================
//  0 /// A protocol message.
//  1 pub enum Message {
//  2     Ping,
//  3     Pong,
//  4 }
//  5
//  6 /// Server config.
//  7 pub struct ServerConfig {
//  8     port: u16,
//  9 }
// 10
// 11 /// A shape.
// 12 pub trait Shape {
// 13     fn area(&self) -> f64;
// 14 }
const RS_URI = "file:///proj/lib.rs";
const RS_TEXT =
  "/// A protocol message.\n" +
  "pub enum Message {\n" +
  "    Ping,\n" +
  "    Pong,\n" +
  "}\n" +
  "\n" +
  "/// Server config.\n" +
  "pub struct ServerConfig {\n" +
  "    port: u16,\n" +
  "}\n" +
  "\n" +
  "/// A shape.\n" +
  "pub trait Shape {\n" +
  "    fn area(&self) -> f64;\n" +
  "}\n";

// Rust doc `///` is in-range trivia (range.start on the doc line — the model
// scout.md / blind-v10 confirm for Rust).
const rsMessage = sym("Message", K.Enum, R(0, 0, 4, 1), R(1, 9, 1, 16), [
  sym("Ping", K.EnumMember, R(2, 4, 2, 8), R(2, 4, 2, 8)),
  sym("Pong", K.EnumMember, R(3, 4, 3, 8), R(3, 4, 3, 8)),
]);
const rsServerConfig = sym("ServerConfig", K.Struct, R(6, 0, 9, 1), R(7, 11, 7, 23), [
  sym("port : u16", K.Field, R(8, 4, 8, 13), R(8, 4, 8, 8)),
]);
const rsShapeTrait = sym("Shape", K.Interface, R(11, 0, 14, 1), R(12, 10, 12, 15), [
  sym("area", K.Method, R(13, 4, 13, 26), R(13, 7, 13, 11)), // bodyless trait method
]);
const RS_SYMBOLS = [rsMessage, rsServerConfig, rsShapeTrait];

const rsDoc = makeDoc(RS_TEXT, RS_URI, "rust");
const rsResolve = (line, ch, admitTypes) =>
  withSymbols(RS_URI, rsDoc, RS_SYMBOLS, () => V.resolveFunctionAtCursor(rsDoc, P(line, ch), admitTypes));

// ===========================================================================
// FROZEN — Rust admission unchanged. struct->"struct", enum->"enum" admitted;
// a Rust trait (Interface) NEVER admitted; injection-off admits no type. GREEN
// today (a red frozen guard means the harness mismodelled the current call).
// ===========================================================================

gtest('FROZEN: Rust struct header resolves genKind "struct" [invariant: Rust admit set {Struct,Enum}]', async () => {
  const r = await rsResolve(7, 11, true); // on `pub struct ServerConfig`
  assert.ok(r, "the rust struct resolves under admitTypes=true");
  assert.strictEqual(r.kind, "struct", `a Rust struct header must resolve genKind "struct", got ${JSON.stringify(r.kind)}`);
});

gtest('FROZEN: Rust enum header resolves genKind "enum" [invariant: Rust admit set {Struct,Enum}]', async () => {
  const r = await rsResolve(1, 9, true); // on `pub enum Message`
  assert.ok(r, "the rust enum resolves under admitTypes=true");
  assert.strictEqual(r.kind, "enum", `a Rust enum header must resolve genKind "enum", got ${JSON.stringify(r.kind)}`);
});

gtest("FROZEN: a Rust trait (Interface kind) is NEVER admitted — undefined [invariant: the frozen bodyless-splice guard]", async () => {
  const r = await rsResolve(12, 10, true); // on `pub trait Shape`
  assert.strictEqual(r, undefined, "a Rust trait must never become a type-gen target, even with admitTypes=true");
});

gtest("FROZEN: injection-off admits no Rust type (struct/enum header -> undefined) [invariant: admitTypes=false is v1]", async () => {
  assert.strictEqual(await rsResolve(7, 11, false), undefined, "a struct header must not resolve with admitTypes=false");
  assert.strictEqual(await rsResolve(1, 9, false), undefined, "an enum header must not resolve with admitTypes=false");
});

// ===========================================================================
// NEW — C# admission. RED until phase 1 adds Class to the C# admit set and the
// per-language genKind. class->"class", struct->"struct", enum->"enum";
// interface EXCLUDED (undefined); method body -> "function"; property line
// walks UP to the class.
// ===========================================================================

gtest('C# class header resolves genKind "class" [contract: C# admits Class]', async () => {
  const r = await csResolve(3, 15, true); // on `public class ServerConfig`
  assert.ok(r, "the C# class resolves under admitTypes=true");
  assert.strictEqual(r.kind, "class", `a C# class header must resolve genKind "class", got ${JSON.stringify(r && r.kind)}`);
});

gtest('C# struct header resolves genKind "struct" [contract: C# admits Struct]', async () => {
  const r = await csResolve(14, 14, true); // on `public struct Vec2`
  assert.ok(r, "the C# struct resolves");
  assert.strictEqual(r.kind, "struct", `a C# struct header must resolve genKind "struct", got ${JSON.stringify(r && r.kind)}`);
});

gtest('C# enum header resolves genKind "enum" [contract: C# admits Enum]', async () => {
  const r = await csResolve(20, 12, true); // on `public enum Color`
  assert.ok(r, "the C# enum resolves");
  assert.strictEqual(r.kind, "enum", `a C# enum header must resolve genKind "enum", got ${JSON.stringify(r && r.kind)}`);
});

gtest("C# interface header is EXCLUDED — undefined (bodyless members) [contract: C# excludes Interface]", async () => {
  const r = await csResolve(27, 17, true); // on `public interface IShape`
  assert.strictEqual(r, undefined, "a C# interface must never be a type-gen target (interface members are bodyless)");
});

gtest('C# cursor INSIDE a class method body resolves genKind "function" (the method shadows the class) [contract: innermost walk]', async () => {
  const r = await csResolve(10, 10, true); // inside Reset() body: `Port = 0;`
  assert.ok(r, "the method body resolves");
  assert.strictEqual(r.kind, "function", `a cursor in a method body must resolve the METHOD, got ${JSON.stringify(r && r.kind)}`);
});

gtest('C# cursor on a property line walks UP to the enclosing class — genKind "class" (Property not admitted) [contract: walk-up]', async () => {
  const r = await csResolve(5, 20, true); // on the `Port` property line
  assert.ok(r, "the property line resolves to some admitted ancestor");
  assert.strictEqual(r.kind, "class", `a cursor on a property must walk up to the class, got ${JSON.stringify(r && r.kind)}`);
});

gtest("C# injection-off admits no type (class/struct/enum header -> undefined) [contract: admitTypes=false is v1]", async () => {
  assert.strictEqual(await csResolve(3, 15, false), undefined, "class header must not resolve with admitTypes=false");
  assert.strictEqual(await csResolve(14, 14, false), undefined, "struct header must not resolve with admitTypes=false");
  assert.strictEqual(await csResolve(20, 12, false), undefined, "enum header must not resolve with admitTypes=false");
});

// ===========================================================================
// NEW — TS admission. RED until phase 1 adds Class + Interface to the TS admit
// set and the per-language genKind. class->"class", interface->"interface",
// enum->"enum"; method body -> "function".
// ===========================================================================

gtest('TS class header resolves genKind "class" [contract: TS admits Class]', async () => {
  const r = await tsResolve(0, 15, true); // on `export class ServerConfig`
  assert.ok(r, "the TS class resolves under admitTypes=true");
  assert.strictEqual(r.kind, "class", `a TS class header must resolve genKind "class", got ${JSON.stringify(r && r.kind)}`);
});

gtest('TS interface header resolves genKind "interface" (ADMITTED — the container is braced) [contract: TS admits Interface]', async () => {
  const r = await tsResolve(9, 17, true); // on `export interface Shape`
  assert.ok(r, "the TS interface resolves under admitTypes=true");
  assert.strictEqual(r.kind, "interface", `a TS interface header must resolve genKind "interface", got ${JSON.stringify(r && r.kind)}`);
});

gtest('TS enum header resolves genKind "enum" [contract: TS admits Enum]', async () => {
  const r = await tsResolve(14, 12, true); // on `export enum Color`
  assert.ok(r, "the TS enum resolves");
  assert.strictEqual(r.kind, "enum", `a TS enum header must resolve genKind "enum", got ${JSON.stringify(r && r.kind)}`);
});

gtest('TS cursor INSIDE a class method body resolves genKind "function" (the method shadows the class) [contract: innermost walk]', async () => {
  const r = await tsResolve(5, 10, true); // inside reset() body: `this.port = 0;`
  assert.ok(r, "the method body resolves");
  assert.strictEqual(r.kind, "function", `a cursor in a method body must resolve the METHOD, got ${JSON.stringify(r && r.kind)}`);
});

gtest("TS injection-off admits no type (class/interface/enum header -> undefined) [contract: admitTypes=false is v1]", async () => {
  assert.strictEqual(await tsResolve(0, 15, false), undefined, "class header must not resolve with admitTypes=false");
  assert.strictEqual(await tsResolve(9, 17, false), undefined, "interface header must not resolve with admitTypes=false");
  assert.strictEqual(await tsResolve(14, 12, false), undefined, "enum header must not resolve with admitTypes=false");
});
