// Blind oracle (v12 type-gen, PYTHON): ADMISSION + genKind through the real
// `resolveFunctionAtCursor` (src/vscode/fnGen) driven over a FAKE vscode module.
// Black-box: never reads the not-yet-written Python type branch of fnGen.
//
// THE CONTRACT (session-v12/scout-py.md). pyright reports Class (vscode
// SymbolKind 4) for a plain class, a @dataclass, AND an Enum subclass — kind
// alone cannot tell them apart (scout-py.md Q1, PROVEN). So Phase 2 admits
// Python Class as a type target and CLASSIFIES it by reading the header text the
// symbol's own ranges bracket:
//   - decorator lines live in [range.start.line .. selectionRange.start.line)
//   - the `class NAME(bases):` line at selectionRange.start.line carries the
//     base list; an enum base (Enum/IntEnum/StrEnum/Flag/IntFlag/*Enum) ->
//     genKind "enum", otherwise (plain / @dataclass / non-enum base) -> "class".
// With admitTypes=true a cursor on a class HEADER resolves that class ("class"
// or "enum"); a cursor INSIDE a method body resolves the METHOD ("function").
// With admitTypes=false NO Python type is admitted (function-only, v1).
//
// NO PYTHON "nothing to generate" REFUSAL. Python has no structurally-empty
// class — every class has a body (members, `pass`, `...`, or a docstring;
// scout-py.md Q4). So a pass-only class (`EmptyPass`) and the one-liner
// (`class OneLiner: pass`, single-line range) MUST RESOLVE (kind "class"), NOT
// return undefined. The brace-less "nothing to generate" refusal that Rust /
// C# positional-records raise lives in the generateFunction COMMAND, NOT in
// resolveFunctionAtCursor — it cannot be unit-tested here. The Python contract
// this file CAN pin is that resolveFunctionAtCursor RESOLVES the pass-only /
// one-liner classes (which it must, for the command to even reach generation).
// IMPLEMENTER NOTE: the command's brace-less guard must be GATED to skip Python
// (Python classes always have a splice target), so it never refuses a Python
// class the resolver admitted here.
//
// SymbolKind uses vscode's OWN numbering (Class=4, Method=5, ...) — the numbers
// the LS client hands the extension. scout-py.md reports pyright's raw LSP kinds
// (Class=5, Method=6, Variable=13, Constant=14); the vscode command layer hands
// the extension vscode kinds (LSP-1): Class=4, Method=5. This file uses the
// vscode numbers the resolver actually sees (as blind-v12-admit-csts does).
//
// The Python admissions are RED until Phase 2 admits Python Class + classifies.
// The Rust/C#/TS cross-guards are GREEN today (Phase 1 landed) — a red guard =
// this file mismodelled the current call; fix the harness, not the contract.
//
// Run: SKIP_LIVE=1 node --test test/blind-v12-admit-python.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");

// ===========================================================================
// A structural vscode stub (real Position/Range/Uri so the innermost-walk span
// math + Range.contains run honestly). Copied verbatim from
// test/blind-v12-admit-csts.test.cjs.
// ===========================================================================

const STUB = path.join(__dirname, ".blind-v12-admit-py-stub.cjs");
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
    get textDocuments() { return globalThis.__V12PY_OPEN_DOCS__ || []; },
    openTextDocument: async (arg) => {
      const key = typeof arg === "string" ? arg : arg && arg.toString ? arg.toString() : String(arg);
      const docs = globalThis.__V12PY_DOCS__ || {};
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
        return (globalThis.__V12PY_SYMBOLS__ || {})[key];
      }
      return undefined;
    },
  },
};
`,
);

const vEntry = path.join(__dirname, ".blind-v12-admit-py.entry.ts");
const vOut = path.join(__dirname, ".blind-v12-admit-py.bundle.cjs");
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

// Skip (not fail) the body while the bundle is broken, so a red run stays one
// loud failure at the bundle guard rather than a wall of TypeErrors.
const gtest = (name, fn) =>
  test(name, (ctx) => {
    if (surfErr) return ctx.skip(`surface bundle failed to build; see the bundle guard: ${surfErr.message}`);
    return fn(ctx);
  });

test("bundle guard: resolveFunctionAtCursor (fnGen) builds headless against the vscode stub", () => {
  if (surfErr) assert.fail(`surface bundle failed: ${surfErr.message}`);
});

// A document backed by fixture text; ranges come from the documentSymbol tree.
// (Copied from blind-v12-admit-csts.)
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

// Symbol node helper. `kind` is the vscode SymbolKind number.
const sym = (name, kind, range, sel, children = []) => ({ name, detail: "", kind, range, selectionRange: sel, children });

const withSymbols = (uriStr, doc, symbols, storeKey, run) => {
  globalThis.__V12PY_SYMBOLS__ = { [uriStr]: symbols };
  globalThis.__V12PY_DOCS__ = { [uriStr]: doc };
  globalThis.__V12PY_OPEN_DOCS__ = [doc];
  return run();
};

// vscode SymbolKind numbers used below.
const K = { Namespace: 2, Class: 4, Method: 5, Property: 6, Field: 7, Enum: 9, Interface: 10, Function: 11, Variable: 12, Constant: 13, EnumMember: 21, Struct: 22 };

// ===========================================================================
// PYTHON fixture — the scout-py.md geometry, byte-for-byte on the line map so
// the ranges below line up with the text. 0-indexed lines:
//
//  0 from dataclasses import dataclass
//  1 from enum import Enum
//  2
//  3
//  4 class ServerConfig:
//  5     """A server config."""
//  6
//  7     def __init__(self) -> None:
//  8         self.port = 0
//  9         self.host = ""
// 10
// 11     def reset(self) -> None:
// 12         self.port = 0
// 13
// 14
// 15 @dataclass
// 16 class Point:
// 17     x: int
// 18     y: int
// 19
// 20
// 21 class Color(Enum):
// 22     RED = 1
// 23     GREEN = 2
// 24     BLUE = 3
// 25
// 26
// 27 class EmptyPass:
// 28     pass
// 29
// 30
// 31 class DocOnly:
// 32     """Only a docstring, no members."""
// 33
// 34
// 35 class Sub(ServerConfig):
// 36     extra: int = 0
// 37
// 38
// 39 class OneLiner: pass
// ===========================================================================

const PY_URI = "file:///proj/fixture.py";
const PY_TEXT =
  "from dataclasses import dataclass\n" + // 0
  "from enum import Enum\n" + // 1
  "\n" + // 2
  "\n" + // 3
  "class ServerConfig:\n" + // 4
  '    """A server config."""\n' + // 5
  "\n" + // 6
  "    def __init__(self) -> None:\n" + // 7
  "        self.port = 0\n" + // 8
  '        self.host = ""\n' + // 9
  "\n" + // 10
  "    def reset(self) -> None:\n" + // 11
  "        self.port = 0\n" + // 12
  "\n" + // 13
  "\n" + // 14
  "@dataclass\n" + // 15
  "class Point:\n" + // 16
  "    x: int\n" + // 17
  "    y: int\n" + // 18
  "\n" + // 19
  "\n" + // 20
  "class Color(Enum):\n" + // 21
  "    RED = 1\n" + // 22
  "    GREEN = 2\n" + // 23
  "    BLUE = 3\n" + // 24
  "\n" + // 25
  "\n" + // 26
  "class EmptyPass:\n" + // 27
  "    pass\n" + // 28
  "\n" + // 29
  "\n" + // 30
  "class DocOnly:\n" + // 31
  '    """Only a docstring, no members."""\n' + // 32
  "\n" + // 33
  "\n" + // 34
  "class Sub(ServerConfig):\n" + // 35
  "    extra: int = 0\n" + // 36
  "\n" + // 37
  "\n" + // 38
  "class OneLiner: pass\n"; // 39

// Ranges transcribed verbatim from scout-py.md (converted to vscode kinds:
// pyright Class 5 -> vscode 4, Method 6 -> 5, Variable 13 -> 12, Constant 14 ->
// 13 — the numbers the resolver sees through the command layer).
const pyServerConfig = sym("ServerConfig", K.Class, R(4, 0, 12, 21), R(4, 6, 4, 18), [
  sym("__init__", K.Method, R(7, 4, 9, 22), R(7, 8, 7, 16)),
  sym("reset", K.Method, R(11, 4, 12, 21), R(11, 8, 11, 13)),
  sym("port", K.Variable, R(8, 13, 8, 17), R(8, 13, 8, 17)),
  sym("host", K.Variable, R(9, 13, 9, 17), R(9, 13, 9, 17)),
]);
// @dataclass: range.start on the decorator line 15, selectionRange on the
// class-name line 16.
const pyPoint = sym("Point", K.Class, R(15, 0, 18, 10), R(16, 6, 16, 11), [
  sym("x", K.Variable, R(17, 4, 17, 5), R(17, 4, 17, 5)),
  sym("y", K.Variable, R(18, 4, 18, 5), R(18, 4, 18, 5)),
]);
// Enum subclass: pyright reports it as Class(5->4), NOT Enum. Children are
// Constant(14->13) — the UNSOUND signal; classification must key on the base.
const pyColor = sym("Color", K.Class, R(21, 0, 24, 12), R(21, 6, 21, 11), [
  sym("RED", K.Constant, R(22, 4, 22, 7), R(22, 4, 22, 7)),
  sym("GREEN", K.Constant, R(23, 4, 23, 9), R(23, 4, 23, 9)),
  sym("BLUE", K.Constant, R(24, 4, 24, 8), R(24, 4, 24, 8)),
]);
// pass-only body; range spans the class line AND the `pass` line. No children.
const pyEmptyPass = sym("EmptyPass", K.Class, R(27, 0, 28, 8), R(27, 6, 27, 15), []);
// one-liner: header and body share one line; single-line range; no children.
const pyOneLiner = sym("OneLiner", K.Class, R(39, 0, 39, 20), R(39, 6, 39, 14), []);
const PY_SYMBOLS = [pyServerConfig, pyPoint, pyColor, pyEmptyPass, pyOneLiner];

const pyDoc = makeDoc(PY_TEXT, PY_URI, "python");
const pyResolve = (line, ch, admitTypes) =>
  withSymbols(PY_URI, pyDoc, PY_SYMBOLS, "py", () => V.resolveFunctionAtCursor(pyDoc, P(line, ch), admitTypes));

// ===========================================================================
// NEW — Python admission + classification. RED until Phase 2 admits Python
// Class and classifies plain/@dataclass -> "class", Enum-subclass -> "enum".
// ===========================================================================

gtest('Python plain-class header cursor resolves genKind "class" [contract: Python admits Class]', async () => {
  const r = await pyResolve(4, 10, true); // on `class ServerConfig:` (the name)
  assert.ok(r, "the Python plain class resolves under admitTypes=true");
  assert.strictEqual(r.kind, "class", `a plain Python class header must resolve genKind "class", got ${JSON.stringify(r && r.kind)}`);
});

gtest('Python @dataclass header cursor (on the class-name line) resolves genKind "class" [contract: @dataclass is a class, not an enum]', async () => {
  const r = await pyResolve(16, 8, true); // on `class Point:` (selectionRange line)
  assert.ok(r, "the @dataclass class resolves under admitTypes=true");
  assert.strictEqual(r.kind, "class", `a @dataclass header must resolve genKind "class", got ${JSON.stringify(r && r.kind)}`);
});

gtest('Python Enum-subclass header cursor resolves genKind "enum" (the base-list classification fires) [contract: enum base -> enum]', async () => {
  const r = await pyResolve(21, 8, true); // on `class Color(Enum):`
  assert.ok(r, "the Enum subclass resolves under admitTypes=true");
  assert.strictEqual(r.kind, "enum", `an Enum subclass header must resolve genKind "enum" (base list has Enum), got ${JSON.stringify(r && r.kind)}`);
});

gtest('Python cursor INSIDE a method body resolves genKind "function" (the method shadows the class) [contract: innermost walk]', async () => {
  const r = await pyResolve(12, 10, true); // inside reset() body: `self.port = 0`
  assert.ok(r, "the method body resolves");
  assert.strictEqual(r.kind, "function", `a cursor in a method body must resolve the METHOD, got ${JSON.stringify(r && r.kind)}`);
});

gtest('Python pass-only class (EmptyPass) header cursor RESOLVES genKind "class" — never undefined (no nothing-to-generate for Python) [contract: pass-only resolves]', async () => {
  const r = await pyResolve(27, 10, true); // on `class EmptyPass:`
  assert.notStrictEqual(r, undefined, "a pass-only Python class must NOT be rejected — Python has no structurally-empty class");
  assert.ok(r, "the pass-only class resolves");
  assert.strictEqual(r.kind, "class", `a pass-only class must resolve genKind "class", got ${JSON.stringify(r && r.kind)}`);
});

gtest('Python one-liner (class OneLiner: pass, single-line range) header cursor RESOLVES genKind "class" [contract: single-line range is fine]', async () => {
  const r = await pyResolve(39, 8, true); // on `class OneLiner: pass`
  assert.notStrictEqual(r, undefined, "the one-liner class must NOT be rejected for its single-line range");
  assert.ok(r, "the one-liner class resolves");
  assert.strictEqual(r.kind, "class", `the one-liner class must resolve genKind "class", got ${JSON.stringify(r && r.kind)}`);
});

gtest("Python injection-off admits no type — every Python type header -> undefined (function-only, v1) [contract: admitTypes=false is v1]", async () => {
  assert.strictEqual(await pyResolve(4, 10, false), undefined, "plain class header must not resolve with admitTypes=false");
  assert.strictEqual(await pyResolve(16, 8, false), undefined, "@dataclass header must not resolve with admitTypes=false");
  assert.strictEqual(await pyResolve(21, 8, false), undefined, "Enum subclass header must not resolve with admitTypes=false");
  assert.strictEqual(await pyResolve(27, 10, false), undefined, "pass-only class header must not resolve with admitTypes=false");
  assert.strictEqual(await pyResolve(39, 8, false), undefined, "one-liner class header must not resolve with admitTypes=false");
});

// ===========================================================================
// FROZEN cross-guards — one Rust, one C#, one TS. Phase 1 landed, so all three
// type-header admissions are GREEN today. Pinned so a Python change that touches
// the SHARED admission (typeKindsFor / the innermost walk / genKind) is caught.
// A red guard here = this file mismodelled the current call; fix the harness.
// ===========================================================================

// -- Rust: a struct header still resolves "struct" (v1 FROZEN admit set) -----
const RS_URI = "file:///proj/lib.rs";
const RS_TEXT =
  "/// Server config.\n" + // 0
  "pub struct ServerConfig {\n" + // 1
  "    port: u16,\n" + // 2
  "}\n"; // 3
const rsServerConfig = sym("ServerConfig", K.Struct, R(0, 0, 3, 1), R(1, 11, 1, 23), [
  sym("port : u16", K.Field, R(2, 4, 2, 13), R(2, 4, 2, 8)),
]);
const rsDoc = makeDoc(RS_TEXT, RS_URI, "rust");
const rsResolve = (line, ch, admitTypes) =>
  withSymbols(RS_URI, rsDoc, [rsServerConfig], "rs", () => V.resolveFunctionAtCursor(rsDoc, P(line, ch), admitTypes));

gtest('FROZEN cross-guard: a Rust struct header still resolves genKind "struct" [invariant: shared admission unchanged]', async () => {
  const r = await rsResolve(1, 11, true);
  assert.ok(r, "the Rust struct resolves under admitTypes=true");
  assert.strictEqual(r.kind, "struct", `a Rust struct header must still resolve "struct", got ${JSON.stringify(r && r.kind)}`);
});

// -- C#: a class header still resolves "class" (Phase 1 admit set) -----------
const CS_URI = "file:///proj/Demo.cs";
const CS_TEXT =
  "namespace Demo;\n" + // 0
  "\n" + // 1
  "public class ServerConfig\n" + // 2
  "{\n" + // 3
  "    public int Port { get; set; }\n" + // 4
  "}\n"; // 5
const csServerConfig = sym("ServerConfig", K.Class, R(2, 0, 5, 1), R(2, 13, 2, 25), [
  sym("Port : int", K.Property, R(4, 4, 4, 33), R(4, 15, 4, 19)),
]);
const CS_SYMBOLS = [sym("Demo", K.Namespace, R(0, 0, 5, 1), R(0, 10, 0, 14), [csServerConfig])];
const csDoc = makeDoc(CS_TEXT, CS_URI, "csharp");
const csResolve = (line, ch, admitTypes) =>
  withSymbols(CS_URI, csDoc, CS_SYMBOLS, "cs", () => V.resolveFunctionAtCursor(csDoc, P(line, ch), admitTypes));

gtest('FROZEN cross-guard: a C# class header still resolves genKind "class" [invariant: shared admission unchanged]', async () => {
  const r = await csResolve(2, 15, true);
  assert.ok(r, "the C# class resolves under admitTypes=true");
  assert.strictEqual(r.kind, "class", `a C# class header must still resolve "class", got ${JSON.stringify(r && r.kind)}`);
});

// -- TS: a class header still resolves "class" (Phase 1 admit set) -----------
const TS_URI = "file:///proj/fixture.ts";
const TS_TEXT =
  "export class ServerConfig {\n" + // 0
  "  port = 0;\n" + // 1
  "}\n"; // 2
const tsServerConfig = sym("ServerConfig", K.Class, R(0, 0, 2, 1), R(0, 13, 0, 25), [
  sym("port", K.Property, R(1, 2, 1, 11), R(1, 2, 1, 6)),
]);
const tsDoc = makeDoc(TS_TEXT, TS_URI, "typescript");
const tsResolve = (line, ch, admitTypes) =>
  withSymbols(TS_URI, tsDoc, [tsServerConfig], "ts", () => V.resolveFunctionAtCursor(tsDoc, P(line, ch), admitTypes));

gtest('FROZEN cross-guard: a TS class header still resolves genKind "class" [invariant: shared admission unchanged]', async () => {
  const r = await tsResolve(0, 15, true);
  assert.ok(r, "the TS class resolves under admitTypes=true");
  assert.strictEqual(r.kind, "class", `a TS class header must still resolve "class", got ${JSON.stringify(r && r.kind)}`);
});
