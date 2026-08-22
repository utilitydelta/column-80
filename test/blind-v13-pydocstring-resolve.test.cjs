// BLIND ORACLE — v13 (Python docstring-is-the-spec), the RESOLVER surface.
// Drives the REAL `resolveFunctionAtCursor` (src/vscode/fnGen) over a FAKE
// vscode module. Black-box: never reads the not-yet-written Python doc arm /
// span-shrink. From the goal + the scout (Fork A) + the Python scout's
// geometry ONLY.
//
// THE CONTRACT (Fork A — span-exclusion). For a Python def/class WITH a leading
// docstring the resolver must:
//   - docComment := the CLEANED docstring (quotes stripped, PEP-257 dedented) —
//     NOT undefined, NOT the raw literal.
//   - span.start := the offset just PAST the docstring (span excludes it); the
//     buffer docstring stays OUTSIDE the span (byte-exact preservation is
//     structural). span.end unchanged (range.end).
//   - bodyOnly := true.
//   - signature := the header (`def f(...):` / `class C:`), unchanged.
// A Python target WITHOUT a docstring is the NO-REGRESSION pin: docComment
// undefined, span [headStart..range.end] unchanged, bodyOnly falsy — GREEN today
// AND after the phase. A Rust FROZEN cross-guard pins that a Python-only change
// does not perturb shared resolution.
//
// The resolved-object shape is fixed by the consumer tests (impl-v3-structgen):
//   r = { kind, symbolName, signature, docComment, span: { start, end }, bodyOnly? }
// where span.start/span.end are BYTE OFFSETS into the document text.
//
// The WITH-docstring assertions are RED until the Python doc arm + span shrink
// land (today the resolver has no Python doc arm: docComment is undefined and the
// span covers the docstring). The no-doc pins + the Rust guard are GREEN today.
// A red no-doc/Rust guard = this file mismodelled the current call; fix the guard.
//
// Run: SKIP_LIVE=1 node --test test/blind-v13-pydocstring-resolve.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");

// ===========================================================================
// A structural vscode stub (real Position/Range/Uri). Copied verbatim from
// test/blind-v12-admit-python.test.cjs.
// ===========================================================================

const STUB = path.join(__dirname, ".blind-v13-pydoc-stub.cjs");
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
    get textDocuments() { return globalThis.__V13PY_OPEN_DOCS__ || []; },
    openTextDocument: async (arg) => {
      const key = typeof arg === "string" ? arg : arg && arg.toString ? arg.toString() : String(arg);
      const docs = globalThis.__V13PY_DOCS__ || {};
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
        return (globalThis.__V13PY_SYMBOLS__ || {})[key];
      }
      return undefined;
    },
  },
};
`,
);

const vEntry = path.join(__dirname, ".blind-v13-pydoc-resolve.entry.ts");
const vOut = path.join(__dirname, ".blind-v13-pydoc-resolve.bundle.cjs");
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

const gtest = (name, fn) =>
  test(name, (ctx) => {
    if (surfErr) return ctx.skip(`surface bundle failed to build; see the bundle guard: ${surfErr.message}`);
    return fn(ctx);
  });

test("bundle guard: resolveFunctionAtCursor (fnGen) builds headless against the vscode stub", () => {
  if (surfErr) assert.fail(`surface bundle failed: ${surfErr.message}`);
});

// Document backed by fixture text (copied from blind-v12-admit-python).
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

const sym = (name, kind, range, sel, children = []) => ({ name, detail: "", kind, range, selectionRange: sel, children });
const withSymbols = (uriStr, doc, symbols, run) => {
  globalThis.__V13PY_SYMBOLS__ = { [uriStr]: symbols };
  globalThis.__V13PY_DOCS__ = { [uriStr]: doc };
  globalThis.__V13PY_OPEN_DOCS__ = [doc];
  return run();
};

const K = { Class: 4, Method: 5, Function: 11, Variable: 12, Struct: 22, Field: 7 };

// ===========================================================================
// PYTHON fixture. Line map (0-indexed) — ranges derived from the text so they
// match what pyright reports (range.start at col 0 for a top-level def/class,
// range.end at the last body line's end = that line's length, selectionRange on
// the name). Geometry consistent with scout-v13 (functions) + scout-py (class).
// ===========================================================================

const PY_LINES = [
  "def add(a: int, b: int) -> int:", // 0
  '    """Add two ints."""', // 1
  "    return a + b", // 2
  "", // 3
  "def parse(data: bytes):", // 4
  '    """Parse the wire format.', // 5
  "", // 6
  "    second line, indented body follows.", // 7
  '    """', // 8
  "    return data", // 9
  "", // 10
  "def nodoc(x: int) -> int:", // 11
  "    return x + 1", // 12
  "", // 13
  "class ServerConfig:", // 14
  '    """A server config."""', // 15
  "    port = 0", // 16
  '    host = ""', // 17
  "", // 18
  "class NoDocClass:", // 19
  "    x: int = 0", // 20
  "", // 21
  "def only_doc() -> None:", // 22
  '    """A stub whose body is only this docstring."""', // 23
];
const PY_TEXT = PY_LINES.join("\n") + "\n";
const PY_URI = "file:///proj/fixture.py";
const pyDoc = makeDoc(PY_TEXT, PY_URI, "python");

// Build a documentSymbol whose ranges are derived from the fixture text.
const mksym = (name, kind, startLine, endLine, children = []) => {
  const nameCol = PY_LINES[startLine].indexOf(name);
  return sym(
    name,
    kind,
    R(startLine, 0, endLine, PY_LINES[endLine].length),
    R(startLine, nameCol, startLine, nameCol + name.length),
    children,
  );
};

const PY_SYMBOLS = [
  mksym("add", K.Function, 0, 2),
  mksym("parse", K.Function, 4, 9),
  mksym("nodoc", K.Function, 11, 12),
  mksym("ServerConfig", K.Class, 14, 17),
  mksym("NoDocClass", K.Class, 19, 20),
  mksym("only_doc", K.Function, 22, 23),
];

const pyResolve = (line, ch, admitTypes = true) =>
  withSymbols(PY_URI, pyDoc, PY_SYMBOLS, () => V.resolveFunctionAtCursor(pyDoc, P(line, ch), admitTypes));

const offOf = (line, ch) => pyDoc.offsetAt(P(line, ch));
const spanText = (r) => PY_TEXT.slice(r.span.start, r.span.end);

// ===========================================================================
// WITH a leading docstring — the Fork A contract. RED until the doc arm + span
// shrink land.
// ===========================================================================

// Each case: where to cursor, the header, the raw buffer docstring (must stay
// OUTSIDE the span, byte-exact), the endLine (span.end == range.end), and an
// assertion over the CLEANED docComment.
const DOC_CASES = [
  {
    name: "single-line docstring function (add)",
    cursor: [0, 5], endLine: 2, header: "def add(a: int, b: int) -> int:",
    raw: '"""Add two ints."""',
    cleaned: (dc) => assert.strictEqual(dc, "Add two ints.", `docComment must be the cleaned docstring, got ${JSON.stringify(dc)}`),
  },
  {
    name: "multi-line docstring function (parse)",
    cursor: [4, 6], endLine: 9, header: "def parse(data: bytes):",
    raw: '"""Parse the wire format.\n\n    second line, indented body follows.\n    """',
    cleaned: (dc) => {
      assert.ok(typeof dc === "string" && !dc.includes('"""'), `cleaned, quotes gone, got ${JSON.stringify(dc)}`);
      assert.ok(dc.includes("Parse the wire format."), "summary survives");
      assert.ok(dc.split("\n").some((l) => l === "second line, indented body follows."), `body dedented to col 0, got ${JSON.stringify(dc)}`);
    },
  },
  {
    name: "class with a docstring (ServerConfig)",
    cursor: [14, 8], endLine: 17, header: "class ServerConfig:",
    raw: '"""A server config."""',
    cleaned: (dc) => assert.strictEqual(dc, "A server config.", `docComment must be the cleaned docstring, got ${JSON.stringify(dc)}`),
  },
  {
    name: "docstring-only body (only_doc)",
    cursor: [22, 6], endLine: 23, header: "def only_doc() -> None:",
    raw: '"""A stub whose body is only this docstring."""',
    cleaned: (dc) => assert.strictEqual(dc, "A stub whose body is only this docstring.", `docComment must be the cleaned docstring, got ${JSON.stringify(dc)}`),
  },
];

for (const c of DOC_CASES) {
  gtest(`resolve WITH docstring: ${c.name} — docComment cleaned, span excludes the docstring, bodyOnly true, signature unchanged [contract: Fork A]`, async () => {
    const r = await pyResolve(c.cursor[0], c.cursor[1]);
    assert.ok(r, "the docstring-bearing target resolves");

    // docComment := the CLEANED docstring (never the raw literal, never undefined).
    c.cleaned(r.docComment);
    assert.notStrictEqual(r.docComment, c.raw, "docComment must be the CLEANED form, not the raw literal");

    // Fork A: the buffer docstring is OUTSIDE the shrunk span, byte-exact.
    assert.ok(!spanText(r).includes(c.raw), `the span must NOT contain the docstring (Fork A span-exclusion), span=${JSON.stringify(spanText(r))}`);
    const docIdx = PY_TEXT.indexOf(c.raw);
    assert.ok(docIdx >= 0, "the raw docstring exists in the buffer");
    assert.ok(docIdx < r.span.start, "the docstring bytes lie BEFORE span.start (preserved outside the generated region)");

    // span.start moved to AFTER the docstring; span.end unchanged (range.end).
    assert.ok(r.span.start >= docIdx + c.raw.length, "span.start is at/after the docstring close");
    assert.strictEqual(r.span.end, offOf(c.endLine, PY_LINES[c.endLine].length), "span.end stays at range.end (only the start moves)");

    // bodyOnly signal + unchanged header.
    assert.strictEqual(r.bodyOnly, true, "a preserved-docstring target must set bodyOnly=true");
    assert.strictEqual(r.signature, c.header, `the signature stays the header, got ${JSON.stringify(r.signature)}`);
  });
}

// ===========================================================================
// WITHOUT a docstring — the NO-REGRESSION pin. GREEN today AND after the phase.
// ===========================================================================

const NODOC_CASES = [
  { name: "function with no docstring (nodoc)", cursor: [11, 6], startLine: 11, endLine: 12, header: "def nodoc(x: int) -> int:", kind: "function" },
  { name: "class with no docstring (NoDocClass)", cursor: [19, 8], startLine: 19, endLine: 20, header: "class NoDocClass:", kind: "class" },
];

for (const c of NODOC_CASES) {
  gtest(`resolve NO docstring: ${c.name} — docComment undefined, span [headStart..range.end], bodyOnly falsy [contract: no regression]`, async () => {
    const r = await pyResolve(c.cursor[0], c.cursor[1]);
    assert.ok(r, "a no-docstring target still resolves");
    assert.strictEqual(r.docComment, undefined, `no docstring -> docComment unchanged (undefined), got ${JSON.stringify(r.docComment)}`);
    assert.ok(!r.bodyOnly, `no docstring -> bodyOnly falsy, got ${JSON.stringify(r.bodyOnly)}`);
    assert.strictEqual(r.span.start, offOf(c.startLine, 0), "span.start unchanged (headStart at col 0)");
    assert.strictEqual(r.span.end, offOf(c.endLine, PY_LINES[c.endLine].length), "span.end unchanged (range.end)");
    assert.strictEqual(r.signature, c.header, `the signature is the header, got ${JSON.stringify(r.signature)}`);
  });
}

// ===========================================================================
// FROZEN cross-guard — a Rust struct resolves exactly as before. Pinned so a
// Python change touching shared resolution is caught. GREEN today AND after.
// ===========================================================================

const RS_URI = "file:///proj/lib.rs";
const RS_TEXT =
  "/// Server config.\n" + // 0
  "pub struct ServerConfig {\n" + // 1
  "    port: u16,\n" + // 2
  "}\n"; // 3
const rsServerConfig = sym("ServerConfig", K.Struct, R(0, 0, 3, 1), R(1, 11, 1, 23), [sym("port : u16", K.Field, R(2, 4, 2, 13), R(2, 4, 2, 8))]);
const rsDoc = makeDoc(RS_TEXT, RS_URI, "rust");
const rsResolve = (line, ch) =>
  withSymbols(RS_URI, rsDoc, [rsServerConfig], () => V.resolveFunctionAtCursor(rsDoc, P(line, ch), true));

gtest("FROZEN cross-guard: a Rust struct resolves unchanged — docComment kept, span excludes the doc, bodyOnly absent [invariant: shared resolution untouched]", async () => {
  const r = await rsResolve(1, 11);
  assert.ok(r, "the Rust struct resolves");
  assert.strictEqual(r.kind, "struct", `Rust struct kind unchanged, got ${JSON.stringify(r.kind)}`);
  assert.ok(r.docComment && r.docComment.includes("Server config"), `the Rust /// doc is carried, got ${JSON.stringify(r.docComment)}`);
  assert.ok(!r.bodyOnly, "bodyOnly must NOT be set for Rust (Python-only signal)");
  const st = RS_TEXT.slice(r.span.start, r.span.end);
  assert.ok(st.startsWith("pub struct ServerConfig"), `the span starts at the struct header (doc outside), got ${JSON.stringify(st)}`);
  assert.ok(!st.includes("/// Server config."), "the Rust doc comment stays OUTSIDE the span, unchanged");
});
