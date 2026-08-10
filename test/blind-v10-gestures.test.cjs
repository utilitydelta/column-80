// Blind oracle: v10 phase 4 - wiring the C# GESTURES (fn-gen / FIM whole-block /
// compiler-directed repair) for the `csharp` language id, and paying down the
// six "defaults-to-Rust" behavior forks the phase-1 review catalogued
// (session-v10/scraps.md F2, F3a-e). Black-box: never reads the not-yet-written
// csharp branches; tests the DISPATCH surface + goal + REAL captured C# inputs.
//
// THE FROZEN-BYTES INVARIANT (phase4-brief): every fork fix is a NEW csharp
// branch; the Rust/TS prompt bytes stay byte-for-byte identical. So each C#
// contract here is paired with a frozen guard that pins the current Rust/TS
// value of the same dispatched helper - a single altered Rust/TS byte is a
// regression, caught here as well as by blind3/blind7 prompt-identity.
//
// Contracts pinned (one per phase-4 item; RED until phase 4 lands the csharp
// branches, GREEN after - and the frozen guards stay GREEN throughout):
//   1  C# signature slice: expression-bodied `public int Foo() => 1;` ->
//      `public int Foo()` (NOT eating `=> 1;`); block-bodied stays correct;
//      interface `int Baz();` -> `int Baz()`. Today csharp falls to the Rust
//      `{`-slicer (F3a). [via resolveFunctionAtCursor - the dispatched signature]
//   2  A `///`-documented C# member's doc reaches the fn-gen prompt. The Roslyn
//      LS EXCLUDES `///` from range.start (PROVEN phase 1 + re-captured below),
//      and the compensating upward scan is TS-gated, so csharp loses its doc
//      today (F2). [via resolveFunctionAtCursor.docComment]
//   3  The C# fn-gen PREFILL is its own entry, not RUST_PREFILL_LANG: it is
//      signatures-only (the goal's finding 5), so it does NOT consult the Rust
//      worked-example fallback and does NOT carry the Rust FIRM_INSTRUCTION
//      (F3b). [via resolvePrefill with a fake extractor] Fence flavor pinned live.
//   4  The C# repair surface no longer classifies-dark: a real CS1061 diagnostic
//      routed through resolveSurfaceInjection over a csharp document yields an
//      injection, where today it falls to the rustc-shaped classifier that
//      cannot read a CS#### code and returns nothing (F3c). [resolveSurfaceInjection]
//   5  wholeBlockSiteFor("csharp") resolves a detector that recognizes a real C#
//      method header and stays dark on a non-header line (the FIM whole-block go-
//      live). [pure registry]
//   6  extractorFor("csharp") resolves the C# product extractor - the phase-3
//      sequencing flip (it is asserted DARK by the phase-3 suite; that flips here
//      atomically, honestly). [extractors, bundled headless vs a vscode stub]
//   7  THE FROZEN GUARD: the Rust/TS dispatched-helper values (assembleFnGenPrompt
//      bytes, the signature slice, the whole-block + extractor registries) equal
//      their captured pre-phase-4 baselines. Byte drift here is a regression.
//
// The live rungs (a real C# fn-gen prefill fence + a real repair round that
// closes the loop, plus F3d unresolved-name-cursor / F3e repair-branch against
// real CS#### diagnostics) live in blind-v10-gestures-live.test.cjs (gated).
//
// Run: SKIP_LIVE=1 node --test test/blind-v10-gestures.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");
const { bundleCore } = require("./.blind-util.cjs");

// ===========================================================================
// Bundle 1: the PURE core helpers (no vscode) - the frozen prompt builder, the
// whole-block registry, the Rust firm instruction + signature slice baselines.
// ===========================================================================

let pure = {};
let pureCleanup = () => {};
let pureErr;
try {
  ({ mod: pure, cleanup: pureCleanup } = bundleCore(
    "blind-v10-gestures-pure",
    `export { assembleFnGenPrompt } from "../src/core/prompt";\n` +
      `export { wholeBlockSiteFor } from "../src/core/fimWholeBlock";\n` +
      `export { tsSignatureFromSpanText } from "../src/core/tsExtraction";\n` +
      `export { FIRM_INSTRUCTION, unresolvedNameCursor } from "../src/core/compilerDirected";\n`,
  ));
} catch (e) {
  pureErr = e;
}

// ===========================================================================
// Bundle 2: the vscode-importing dispatch surface (fnGen + oracleSurface),
// bundled against a STRUCTURAL vscode stub (real Position/Range/Uri so span
// math and Range.contains run; commands.executeDocumentSymbolProvider answers
// from a global fixture map). SymbolKind uses vscode's OWN numbering (Method=5)
// - the numbering the LS client hands the extension.
// ===========================================================================

const STUB = path.join(__dirname, ".blind-v10-gestures-stub.cjs");
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
    get textDocuments() { return globalThis.__CS_OPEN_DOCS__ || []; },
    openTextDocument: async (arg) => {
      const key = typeof arg === "string" ? arg : arg && arg.toString ? arg.toString() : String(arg);
      const docs = globalThis.__CS_DOCS__ || {};
      if (docs[key]) return docs[key];
      return { uri: Uri.parse(key), languageId: "csharp", version: 1, lineCount: 0, getText: () => "", lineAt: () => ({ text: "", firstNonWhitespaceCharacterIndex: 0, isEmptyOrWhitespace: true, range: new Range(0, 0, 0, 0) }), offsetAt: () => 0, positionAt: () => new Position(0, 0) };
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
        return (globalThis.__CS_SYMBOLS__ || {})[key];
      }
      return undefined;
    },
  },
};
`,
);

const vEntry = path.join(__dirname, ".blind-v10-gestures-v.entry.ts");
const vOut = path.join(__dirname, ".blind-v10-gestures-v.bundle.cjs");
let surf = {};
let surfErr;
try {
  fs.writeFileSync(
    vEntry,
    `export { resolveFunctionAtCursor, resolvePrefill } from "../src/vscode/fnGen";\n` +
      `export { resolveSurfaceInjection } from "../src/vscode/oracleSurface";\n`,
  );
  esbuild.buildSync({ entryPoints: [vEntry], bundle: true, outfile: vOut, format: "cjs", platform: "node", alias: { vscode: STUB } });
  surf = require(vOut);
} catch (e) {
  surfErr = e;
}

// ===========================================================================
// Bundle 3: extractorFor - imports vscode, bundled headless vs a permissive
// Proxy stub (the phase-3 lock's exact mechanism; that lock asserts csharp DARK,
// this one asserts the phase-4 flip).
// ===========================================================================

const PROXY_STUB = path.join(__dirname, ".blind-v10-gestures-proxy.js");
const eEntry = path.join(__dirname, ".blind-v10-gestures-e.entry.ts");
const eOut = path.join(__dirname, ".blind-v10-gestures-e.bundle.cjs");
let extractorFor;
let extractorErr;
try {
  fs.writeFileSync(PROXY_STUB, "const h={get:()=>new Proxy(function(){},h),apply:()=>undefined};module.exports=new Proxy(function(){},h);");
  fs.writeFileSync(eEntry, `export { extractorFor } from "../src/vscode/extractors";\n`);
  esbuild.buildSync({ entryPoints: [eEntry], bundle: true, outfile: eOut, format: "cjs", platform: "node", alias: { vscode: PROXY_STUB } });
  ({ extractorFor } = require(eOut));
} catch (e) {
  extractorErr = e;
}

test.after(() => {
  pureCleanup();
  for (const f of [STUB, vEntry, vOut, PROXY_STUB, eEntry, eOut]) fs.rmSync(f, { force: true });
});

// Each family skips (not fails) while its bundle is broken, so a red run stays
// one loud failure per bundle rather than a wall of TypeErrors.
const gtest = (name, brokenFlag, fn) =>
  test(name, (ctx) => {
    const err = brokenFlag();
    if (err) return ctx.skip(`bundle failed to build; see the bundle guard: ${err.message}`);
    return fn(ctx);
  });

test("bundle guard: the pure core helpers build", () => {
  if (pureErr) assert.fail(`pure bundle failed: ${pureErr.message}`);
});
test("bundle guard: the vscode dispatch surface (fnGen + oracleSurface) builds headless", () => {
  if (surfErr) assert.fail(`surface bundle failed: ${surfErr.message}`);
});
test("bundle guard: extractorFor builds headless vs a vscode stub", () => {
  if (extractorErr) assert.fail(`extractors bundle failed: ${extractorErr.message}`);
});

// ---------------------------------------------------------------------------
// A C# document + hierarchical documentSymbol fixture. Ranges below are the
// REAL Roslyn LS documentSymbol output re-captured this phase against the
// installed LS (dotnet 10.0.110), reproduced structurally: range.start on the
// NAME line for a bare/`///`-documented member (`///` EXCLUDED), on the
// attribute/opening line only for attributed members (not exercised here).
// SymbolKind.Method = 5 (vscode numbering).
// ---------------------------------------------------------------------------

const V = surf; // alias
const P = (l, c) => new (require(STUB).Position)(l, c);
const R = (sl, sc, el, ec) => new (require(STUB).Range)(sl, sc, el, ec);

function makeCsDoc(text, uriStr) {
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
    uri: require(STUB).Uri.parse(uriStr),
    fileName: uriStr.replace(/^file:\/\//, ""),
    languageId: "csharp",
    version: 1,
    lineCount: lines.length,
    offsetAt,
    positionAt,
    getText: (r) => (r ? text.slice(offsetAt(r.start), offsetAt(r.end)) : text),
    lineAt: (arg) => {
      const n = typeof arg === "number" ? arg : arg.line;
      const t = lines[n] ?? "";
      const m = t.match(/\S/);
      return {
        lineNumber: n,
        text: t,
        range: R(n, 0, n, t.length),
        firstNonWhitespaceCharacterIndex: m ? m.index : t.length,
        isEmptyOrWhitespace: !m,
      };
    },
  };
}

// One member symbol (Method kind) with the given range + name-line selection.
const method = (name, rangeStartLine, rangeStartCh, rangeEndLine, rangeEndCh, nameLine, nameCh) => ({
  name,
  detail: "",
  kind: 5, // SymbolKind.Method
  range: R(rangeStartLine, rangeStartCh, rangeEndLine, rangeEndCh),
  selectionRange: R(nameLine, nameCh, nameLine, nameCh + name.length),
  children: [],
});

// Install the fixture symbols for a uri so executeDocumentSymbolProvider answers.
const withSymbols = (uriStr, symbols, run) => {
  globalThis.__CS_SYMBOLS__ = { [uriStr]: symbols };
  globalThis.__CS_DOCS__ = {};
  globalThis.__CS_OPEN_DOCS__ = [];
  return run();
};

// ===========================================================================
// 1. C# signature slice (F3a). [surface: fnGen.ts:195 dispatch]
// ===========================================================================

// Expression-bodied: `    public int Foo() => 1;` (single line). Real range
// 9:4-9:26; spanText = `public int Foo() => 1;`. The Rust `{`-slicer (no `{`)
// keeps the whole line INCLUDING `=> 1;`; the C# slicer must stop at `=>`.
gtest("C# signature slice: expression-bodied member stops at `=>`, never eats the body [F3a; surface: csSignatureFromSpanText stops at `{` OR `=>` OR `;`]", () => surfErr, async () => {
  const uri = "file:///proj/Expr.cs";
  const text = `namespace P;\npublic class C\n{\n    public int Foo() => 1;\n}\n`;
  const nameLine = 3;
  const doc = makeCsDoc(text, uri);
  const sym = method("Foo", nameLine, 4, nameLine, 26, nameLine, "    public int ".length);
  const resolved = await withSymbols(uri, [sym], () => V.resolveFunctionAtCursor(doc, P(nameLine, 15)));
  assert.ok(resolved, "the C# method resolves a span");
  assert.strictEqual(resolved.signature, "public int Foo()", `expected the header alone, got ${JSON.stringify(resolved.signature)} (the Rust slicer eats \`=> 1;\`)`);
  assert.ok(!resolved.signature.includes("=>"), "the expression body must not survive into the signature");
});

// Block-bodied: `    public int Bar()` then `    {`...`    }`. Real range
// 11:4-14:5. The Rust `{`-slicer already stops at the brace, so this stays
// correct - pinned so the NEW csharp branch does not regress the shared case.
gtest("C# signature slice: block-bodied member is the header up to the brace (stays correct under the new branch) [F3a]", () => surfErr, async () => {
  const uri = "file:///proj/Block.cs";
  const text = `namespace P;\npublic class C\n{\n    public int Bar()\n    {\n        return 2;\n    }\n}\n`;
  const nameLine = 3;
  const doc = makeCsDoc(text, uri);
  const sym = method("Bar", nameLine, 4, 6, 5, nameLine, "    public int ".length);
  const resolved = await withSymbols(uri, [sym], () => V.resolveFunctionAtCursor(doc, P(nameLine, 15)));
  assert.ok(resolved, "the block-bodied method resolves");
  assert.strictEqual(resolved.signature, "public int Bar()", `expected the header, got ${JSON.stringify(resolved.signature)}`);
});

// Interface member: `    int Baz();` (`;`-terminated, no `{`). Real range
// 4:4-4:14; spanText = `int Baz();`. The Rust slicer keeps the trailing `;`;
// the C# slicer must stop at `;`.
gtest("C# signature slice: interface member drops the terminating `;` [F3a; interface members are `;`-terminated]", () => surfErr, async () => {
  const uri = "file:///proj/Iface.cs";
  const text = `namespace P;\npublic interface I\n{\n    int Baz();\n}\n`;
  const nameLine = 3;
  const doc = makeCsDoc(text, uri);
  const sym = method("Baz", nameLine, 4, nameLine, 14, nameLine, "    int ".length);
  const resolved = await withSymbols(uri, [sym], () => V.resolveFunctionAtCursor(doc, P(nameLine, 9)));
  assert.ok(resolved, "the interface member resolves");
  assert.strictEqual(resolved.signature, "int Baz()", `expected the semicolon-stripped header, got ${JSON.stringify(resolved.signature)}`);
});

// Frozen guard: the Rust and TS dispatched slicers are unchanged. Rust via
// resolveFunctionAtCursor over a rust document (the `{`-slicer); TS via the
// exported tsSignatureFromSpanText.
gtest("FROZEN: the Rust signature slice is byte-unchanged for a rust member [invariant: Rust bytes identical]", () => surfErr, async () => {
  const uri = "file:///proj/mass.rs";
  const text = `/// Sums the widget mass.\nfn total_mass(w: &Widget) -> u64 {\n    0\n}\n`;
  const nameLine = 1;
  const doc = makeCsDoc(text, uri);
  doc.languageId = "rust";
  const sym = { name: "total_mass", detail: "", kind: 11, range: R(0, 0, 3, 1), selectionRange: R(nameLine, 3, nameLine, 13), children: [] };
  const resolved = await withSymbols(uri, [sym], () => V.resolveFunctionAtCursor(doc, P(nameLine, 5)));
  assert.ok(resolved, "the rust fn resolves");
  assert.strictEqual(resolved.signature, "fn total_mass(w: &Widget) -> u64", "the frozen Rust slicer value must not move");
  assert.strictEqual(resolved.docComment, "/// Sums the widget mass.", "the rust doc (in-range trivia) is unchanged");
});

gtest("FROZEN: the TS signature slice (tsSignatureFromSpanText) is byte-unchanged [invariant: TS bytes identical]", () => pureErr, () => {
  assert.strictEqual(
    pure.tsSignatureFromSpanText("export function readOrder(o: Order): number {"),
    "export function readOrder(o: Order): number",
    "the frozen TS depth-aware slicer value must not move",
  );
});

// ===========================================================================
// 2. C# `///` doc reaches the fn-gen prompt (F2). The `///` sits ONE line above
// the head and OUTSIDE the symbol range (Roslyn excludes it), so the trivia
// slice is empty and the TS-gated upward scan is skipped - docComment undefined
// today. The csharp branch must scan the `///` run above the head.
// ===========================================================================

gtest("C# doc channel: a `///`-documented member's doc reaches the resolved fn-gen context [F2; `///` EXCLUDED from range.start, so an upward scan is required]", () => surfErr, async () => {
  const uri = "file:///proj/Doc.cs";
  // Doc line is line 3; the member NAME/range.start is line 4 (doc OUTSIDE range).
  const text =
    `namespace P;\npublic class C\n{\n    /// <summary>Adds DOC_SENTINEL mass.</summary>\n    public int Massed(int w)\n    {\n        return w;\n    }\n}\n`;
  const nameLine = 4;
  const doc = makeCsDoc(text, uri);
  const sym = method("Massed", nameLine, 4, 7, 5, nameLine, "    public int ".length);
  const resolved = await withSymbols(uri, [sym], () => V.resolveFunctionAtCursor(doc, P(nameLine, 16)));
  assert.ok(resolved, "the documented member resolves");
  assert.ok(
    resolved.docComment !== undefined && resolved.docComment.includes("DOC_SENTINEL"),
    `the human-authored /// doc must reach the fn-gen context, got docComment=${JSON.stringify(resolved.docComment)}`,
  );
});

// The COMMON C# shape: a member with BOTH an attribute AND a `///` doc. The
// Roslyn LS INCLUDES the attribute in range.start but EXCLUDES the `///` (PROVEN
// phase 1), so trivia is the ATTRIBUTE and the doc sits ABOVE it, outside the
// range. The doc channel must carry the real `/// <summary>` (not the attribute
// alone) — an attributed+documented method is most real C# (`[HttpGet]`, `[Fact]`,
// `[Required]`).
gtest("C# doc channel: an ATTRIBUTED member's `///` doc still reaches the prompt (the attribute is trivia, the doc sits above it) [F2; attributes IN range.start, `///` NOT]", () => surfErr, async () => {
  const uri = "file:///proj/Attr.cs";
  // Doc line 3 (OUTSIDE range), attribute line 4 (range.start), name line 5.
  const text =
    `namespace P;\npublic class C\n{\n    /// <summary>Adds DOC_SENTINEL mass.</summary>\n    [HttpGet("/x")]\n    public int Massed(int w)\n    {\n        return w;\n    }\n}\n`;
  const attrLine = 4;
  const nameLine = 5;
  const doc = makeCsDoc(text, uri);
  // range.start on the ATTRIBUTE line (the LS includes it); name on the name line.
  const sym = method("Massed", attrLine, 4, 8, 5, nameLine, "    public int ".length);
  const resolved = await withSymbols(uri, [sym], () => V.resolveFunctionAtCursor(doc, P(nameLine, 16)));
  assert.ok(resolved, "the attributed member resolves");
  assert.ok(
    resolved.docComment !== undefined && resolved.docComment.includes("DOC_SENTINEL"),
    `the human-authored /// doc must reach the prompt even under an attribute, got docComment=${JSON.stringify(resolved.docComment)}`,
  );
});

// Frozen guard for the doc channel is folded into the FROZEN rust slice test
// above (rust in-range doc unchanged).

// ===========================================================================
// 3. C# prefill lang (F3b) - DEFERRED TO THE LIVE RUNG (blind-v10-gestures-live).
// F3b's real symptom is that csharp on RUST_PREFILL_LANG gets a Rust candidate
// parser that cannot read a C# type-first signature (`public int Handle(Widget
// w)`), so NO surface resolves and the prefill is empty - there is no Rust-
// flavored leak to catch headlessly (it is GREEN for the wrong reason). The
// honest contract is POSITIVE and needs a REAL C# surface: a csharp fn-gen with
// a resolvable user type injects a signatures-only, ```cs-fenced prefill block
// (never ```rust, never the worked-example fallback). That rides the real
// Roslyn LS in the live suite. Verified headless here only insofar as
// resolvePrefill is bundleable and the fence is languageId-driven (test 7c).
// ===========================================================================

// ===========================================================================
// 4. C# repair surface no longer classifies-dark (F3c). A REAL CS1061 (member
// does not exist) routed through resolveSurfaceInjection over a csharp document
// must produce an injection. Today csharp -> RUST_REPAIR_LANG, whose rustc-
// shaped classifier cannot read a CS#### code, so it classifies nothing and the
// injection is empty (undefined). The captured message/location are the real
// Roslyn/dotnet output (dotnet 10.0.110).
// ===========================================================================

gtest("C# repair: a real CS1061 diagnostic yields a repair injection (not classifier-dark on the Rust path) [F3c; surface: repairLangFor(csharp) is a C# entry]", () => surfErr, async () => {
  const uri = "file:///proj/Repair.cs";
  const text = `namespace D;\npublic class Broken\n{\n    public int A()\n    {\n        var s = "hi";\n        return s.Frobnicate();\n    }\n}\n`;
  const doc = makeCsDoc(text, uri);
  const MEMBER_SENTINEL = "Length";
  // Permissive C# member surface so whatever the C# member-block leg calls, it
  // resolves the receiver `string`'s members (with a sentinel to observe).
  const csMembers = [
    { name: MEMBER_SENTINEL, kind: "method", signature: `${MEMBER_SENTINEL}(): int` },
    { name: "Substring", kind: "method", signature: "Substring(startIndex: int): string" },
  ];
  const fakeExtractor = {
    completeMembers: async () => csMembers,
    hoverSurface: async () => ({ signature: "class string", doc: undefined }),
    definition: async () => undefined,
    membersOfType: async () => csMembers,
    qualifyImport: async () => undefined,
    example: async () => undefined,
  };
  // The neutral Diagnostic shape (CsOracle -> repair.ts): real CS1061 at 7:18.
  const cs1061 = {
    kind: "compile-error",
    level: "error",
    code: "CS1061",
    message:
      "'string' does not contain a definition for 'Frobnicate' and no accessible extension method 'Frobnicate' accepting a first argument of type 'string' could be found",
    spans: [{ fileName: doc.fileName, byteStart: 0, byteEnd: 0, lineStart: 7, lineEnd: 7, columnStart: 18, columnEnd: 28, isPrimary: true }],
    suggestions: [],
  };
  globalThis.__CS_SYMBOLS__ = {};
  globalThis.__CS_DOCS__ = { [uri]: doc };
  globalThis.__CS_OPEN_DOCS__ = [doc];
  let injection;
  await assert.doesNotReject(async () => {
    injection = await V.resolveSurfaceInjection(fakeExtractor, doc, [cs1061], () => {});
  }, "resolveSurfaceInjection must never throw on a C# diagnostic");
  assert.ok(
    injection !== undefined && injection.length > 0,
    "a real CS1061 must classify as a member hallucination and inject the receiver's surface; today the rustc classifier reads no CS#### code and returns nothing (F3c)",
  );
});

// Frozen guard: a Rust diagnostic still routes through the Rust repair surface
// unchanged - an E0599 (rustc member-miss) still classifies and injects, so
// wiring csharp did not disturb the Rust repair path.
gtest("FROZEN: a Rust E0599 diagnostic still yields a repair injection through the Rust surface [invariant: Rust repair path unchanged]", () => surfErr, async () => {
  const uri = "file:///proj/repair.rs";
  const text = `fn main() {\n    let s = String::new();\n    s.frobnicate();\n}\n`;
  const doc = makeCsDoc(text, uri);
  doc.languageId = "rust";
  const rustMembers = [
    { name: "len", kind: "method", signature: "len(&self) -> usize" },
    { name: "push", kind: "method", signature: "push(&mut self, ch: char)" },
  ];
  const fakeExtractor = {
    completeMembers: async () => rustMembers,
    hoverSurface: async () => ({ signature: "struct String", doc: undefined }),
    definition: async () => undefined,
    membersOfType: async () => rustMembers,
    qualifyImport: async () => undefined,
    example: async () => undefined,
  };
  const e0599 = {
    kind: "compile-error",
    level: "error",
    code: "E0599",
    message: "no method named `frobnicate` found for struct `String` in the current scope",
    spans: [{ fileName: doc.fileName, byteStart: 0, byteEnd: 0, lineStart: 3, lineEnd: 3, columnStart: 7, columnEnd: 17, isPrimary: true }],
    suggestions: [],
  };
  globalThis.__CS_DOCS__ = { [uri]: doc };
  globalThis.__CS_OPEN_DOCS__ = [doc];
  const injection = await V.resolveSurfaceInjection(fakeExtractor, doc, [e0599], () => {});
  assert.ok(injection !== undefined && injection.length > 0, "the Rust repair surface must still classify + inject an E0599 member miss unchanged");
});

// ===========================================================================
// 5. wholeBlockSiteFor("csharp") resolves a detector (FIM whole-block go-live).
// The detector recognizes a real C# method HEADER and returns { signature,
// types } with the user type in play; it stays dark on a non-header line.
// ===========================================================================

// Real C# header prefix: the cursor sits in the empty body just opened. Types
// in play: the PascalCase parameter type `Widget`.
const CS_HEADER_PREFIX = `namespace P;\npublic class C\n{\n    public int Fill(Widget w)\n    {\n        `;
// A non-header site: a blank line mid-expression, no enclosing method header.
const CS_NON_HEADER_PREFIX = `namespace P;\npublic class C\n{\n    public int Fill(Widget w)\n    {\n        var total = Merge(\n        `;

gtest("FIM whole-block: wholeBlockSiteFor('csharp') resolves a detector [go-live; phase-3 asserts it DARK, this flips it]", () => pureErr, () => {
  assert.strictEqual(typeof pure.wholeBlockSiteFor("csharp"), "function", "csharp must resolve a whole-block detector after phase 4");
});

gtest("FIM whole-block: the C# detector recognizes a real method header and returns its signature + the user type in play", () => pureErr, () => {
  const detect = pure.wholeBlockSiteFor("csharp");
  if (typeof detect !== "function") return assert.fail("no csharp whole-block detector (see the go-live test)");
  const site = detect(CS_HEADER_PREFIX);
  assert.ok(site, "an empty C# method body just after a header is a whole-block site");
  assert.ok(/\bFill\b/.test(site.signature), `the detector returns the method signature, got ${JSON.stringify(site.signature)}`);
  assert.ok(Array.isArray(site.types) && site.types.includes("Widget"), `the parameter type Widget is a type in play, got ${JSON.stringify(site.types)}`);
});

gtest("FIM whole-block: the C# detector stays dark on a non-header (mid-expression) site", () => pureErr, () => {
  const detect = pure.wholeBlockSiteFor("csharp");
  if (typeof detect !== "function") return assert.fail("no csharp whole-block detector (see the go-live test)");
  assert.strictEqual(detect(CS_NON_HEADER_PREFIX), undefined, "a mid-expression body (real content since the brace) is not a whole-block site");
});

gtest("FROZEN: wholeBlockSiteFor still resolves rust + typescript detectors [invariant: existing languages undisturbed]", () => pureErr, () => {
  assert.strictEqual(typeof pure.wholeBlockSiteFor("rust"), "function", "rust detector must still resolve");
  assert.strictEqual(typeof pure.wholeBlockSiteFor("typescript"), "function", "ts detector must still resolve");
  assert.strictEqual(pure.wholeBlockSiteFor("cobol"), undefined, "an unknown id stays dark (the seam default)");
});

// ===========================================================================
// 6. extractorFor("csharp") resolves the C# product extractor (the sequencing
// flip: phase 3 asserts it DARK, phase 4 registers it atomically). It must be a
// DISTINCT extractor from the rust one.
// ===========================================================================

gtest("extractorFor('csharp') resolves the C# product extractor (phase-4 flip) [surface: extractors.ts::extractorFor]", () => extractorErr, () => {
  const cs = extractorFor("csharp");
  assert.ok(cs, "csharp resolves an extractor after phase 4 (undefined through phase 3)");
});

gtest("extractorFor: the csharp extractor is DISTINCT from the rust one (not the Rust default) [surface: a NEW branch, never the Rust fallthrough]", () => extractorErr, () => {
  const cs = extractorFor("csharp");
  const rust = extractorFor("rust");
  assert.ok(cs, "csharp resolves");
  assert.ok(rust, "rust resolves");
  assert.notStrictEqual(cs.constructor, rust.constructor, "the C# extractor must be its own class, not the RaCommandExtractor");
});

gtest("FROZEN: extractorFor still resolves rust + typescript, and stays dark for an unknown id [invariant: existing extractors undisturbed]", () => extractorErr, () => {
  assert.ok(extractorFor("rust"), "rust extractor must still resolve");
  assert.ok(extractorFor("typescript"), "typescript extractor must still resolve");
  assert.strictEqual(extractorFor("cobol"), undefined, "unknown id stays dark");
});

// ===========================================================================
// 7. THE FROZEN GUARD (byte level): assembleFnGenPrompt for Rust and TS equals
// the exact pre-phase-4 baseline bytes captured through this harness. This is
// the local mirror of blind3/blind7 prompt-identity: wiring csharp must move
// ZERO Rust/TS prompt bytes. (The per-helper frozen guards are inline above.)
// ===========================================================================

const RUST_PROMPT_SNAPSHOT =
  "Implement the function below. Reply with one fenced code block containing the complete function definition, signature and body. The block must contain only this one function: no imports, no other functions, no code before or after it. Output nothing outside the code block.\n\n```rust\n/// Sums the widget mass.\nfn total_mass(w: &Widget) -> u64\n```";
const TS_PROMPT_SNAPSHOT =
  "Implement the function below. Reply with one fenced code block containing the complete function definition, signature and body. The block must contain only this one function: no imports, no other functions, no code before or after it. Output nothing outside the code block.\n\n```typescript\nexport function readOrder(o: Order): number\n```";

gtest("FROZEN: assembleFnGenPrompt bytes for a Rust target equal the pre-phase-4 baseline [invariant: blind3/blind7 prompt-identity mirror]", () => pureErr, () => {
  const got = pure.assembleFnGenPrompt({ signature: "fn total_mass(w: &Widget) -> u64", docComment: "/// Sums the widget mass.", languageId: "rust" });
  assert.strictEqual(got, RUST_PROMPT_SNAPSHOT, `the Rust fn-gen prompt bytes moved off baseline. CAPTURED:\n${JSON.stringify(got)}`);
});

gtest("FROZEN: assembleFnGenPrompt bytes for a TS target equal the pre-phase-4 baseline [invariant: blind3/blind7 prompt-identity mirror]", () => pureErr, () => {
  const got = pure.assembleFnGenPrompt({ signature: "export function readOrder(o: Order): number", languageId: "typescript" });
  assert.strictEqual(got, TS_PROMPT_SNAPSHOT, `the TS fn-gen prompt bytes moved off baseline. CAPTURED:\n${JSON.stringify(got)}`);
});

// A sibling sanity pin: the target fence is languageId-driven, so a csharp
// target already fences ```csharp (the flavor bug lives in the PREFILL, not the
// target block). GREEN today; documents the seam the C# prefill rides.
gtest("assembleFnGenPrompt: a csharp target block is fenced ```csharp (fence is languageId-driven) [seam documentation]", () => pureErr, () => {
  const got = pure.assembleFnGenPrompt({ signature: "public int Foo()", languageId: "csharp" });
  assert.ok(got.includes("```csharp\npublic int Foo()\n```"), `the csharp target fence must be languageId-driven. GOT:\n${JSON.stringify(got)}`);
  assert.ok(!got.includes("```rust"), "a csharp target must never carry a rust fence");
});
