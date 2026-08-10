// ADVERSARIAL REVIEW evidence for session-v32 phase 1 (doc-comment attachment).
//
// Every test in this file is a claim about a DEFECT. A failure here is the
// evidence, not a regression to fix by editing this file. The harness shape is
// copied from test/impl-v32-p1-resolve.test.cjs (same vscode stub, same fake
// document) with the temp file names changed so the two can run concurrently.
//
// Run: SKIP_LIVE=1 node --test test/review-v32-p1.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");
const { bundleCore } = require("./.blind-util.cjs");

// ---------------------------------------------------------------------------
// Leg 1: the pure functions, straight out of src/core/symbols.ts.
// ---------------------------------------------------------------------------
const core = bundleCore(
  "review-v32-p1-core",
  `export { attachRunStart, attachedCandidateIndex, declarationHeadLine } from "../src/core/symbols";`,
);
const { attachRunStart, attachedCandidateIndex, declarationHeadLine } = core.mod;

function lines(source) {
  const rows = source.split("\n");
  return (line) => rows[line] ?? "";
}

// ---------------------------------------------------------------------------
// Leg 2: the real resolveFunctionAtCursor over a fake vscode module.
// ---------------------------------------------------------------------------
const STUB = path.join(__dirname, ".review-v32-p1-stub.cjs");
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
    get textDocuments() { return globalThis.__V32R1_OPEN_DOCS__ || []; },
    openTextDocument: async (arg) => {
      const key = typeof arg === "string" ? arg : arg && arg.toString ? arg.toString() : String(arg);
      const docs = globalThis.__V32R1_DOCS__ || {};
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
        return (globalThis.__V32R1_SYMBOLS__ || {})[key];
      }
      return undefined;
    },
  },
};
`,
);

const vEntry = path.join(__dirname, ".review-v32-p1-v.entry.ts");
const vOut = path.join(__dirname, ".review-v32-p1-v.bundle.cjs");
let surf = {};
let surfErr;
try {
  fs.writeFileSync(vEntry, `export { resolveFunctionAtCursor, resolveBlockAtCursor } from "../src/vscode/fnGen";\n`);
  esbuild.buildSync({ entryPoints: [vEntry], bundle: true, outfile: vOut, format: "cjs", platform: "node", alias: { vscode: STUB } });
  surf = require(vOut);
} catch (e) {
  surfErr = e;
}

test.after(() => {
  core.cleanup();
  for (const f of [STUB, vEntry, vOut]) fs.rmSync(f, { force: true });
});

const { Position, Range, Uri } = require(STUB);
const P = (l, c) => new Position(l, c);
const R = (sl, sc, el, ec) => new Range(sl, sc, el, ec);
const K = { Namespace: 2, Class: 4, Method: 5, Property: 6, Field: 7, Enum: 9, Interface: 10, Function: 11, EnumMember: 21, Struct: 22 };
const sym = (name, kind, range, sel, children = []) => ({ name, detail: "", kind, range, selectionRange: sel, children });

const gtest = (name, fn) =>
  test(name, (ctx) => {
    if (surfErr) return ctx.skip(`surface bundle failed to build: ${surfErr.message}`);
    return fn(ctx);
  });

function makeDoc(text, uriStr, languageId) {
  const rows = text.split("\n");
  const offsetAt = (pos) => {
    let o = 0;
    for (let i = 0; i < Math.min(pos.line, rows.length); i++) o += rows[i].length + 1;
    return Math.min(o + pos.character, text.length);
  };
  const positionAt = (off) => {
    let o = 0;
    for (let l = 0; l < rows.length; l++) {
      if (off <= o + rows[l].length) return P(l, off - o);
      o += rows[l].length + 1;
    }
    return P(rows.length - 1, rows[rows.length - 1].length);
  };
  const doc = {
    uri: Uri.parse(uriStr),
    fileName: uriStr.replace(/^file:\/\//, ""),
    languageId,
    version: 1,
    lineCount: rows.length,
    lineAtCalls: 0,
    offsetAt,
    positionAt,
    getText: (r) => (r ? text.slice(offsetAt(r.start), offsetAt(r.end)) : text),
    lineAt: (arg) => {
      doc.lineAtCalls++;
      const n = typeof arg === "number" ? arg : arg.line;
      const t = rows[n] ?? "";
      const m = t.match(/\S/);
      return { lineNumber: n, text: t, range: R(n, 0, n, t.length), firstNonWhitespaceCharacterIndex: m ? m.index : t.length, isEmptyOrWhitespace: !m };
    },
  };
  return doc;
}

let docSeq = 0;
function docFor(fixture) {
  const uriStr = `file:///review/${docSeq++}-${fixture.name}`;
  const doc = makeDoc(fixture.text, uriStr, fixture.languageId);
  globalThis.__V32R1_SYMBOLS__ = { [uriStr]: fixture.symbols(R) };
  globalThis.__V32R1_DOCS__ = { [uriStr]: doc };
  globalThis.__V32R1_OPEN_DOCS__ = [doc];
  return doc;
}

async function resolveAt(fixture, line, character, admitTypes) {
  const doc = docFor(fixture);
  return surf.resolveFunctionAtCursor(doc, P(line, character), admitTypes);
}

// ===========================================================================
// FINDING 1. The closer guard only refuses the CLOSER LINE as a run start. A
// line ABOVE a closer is still confirmed, because declarationHeadLine's
// shrink-forward rule answers `nameLine` for it. So the trivia run reaches
// across a `};` / `});` into whatever block sits above it, and a cursor on a
// comment — or on a bare `[...]` line — inside that block attaches to the
// declaration below the closer.
// ===========================================================================

test("REVIEW 1a: a comment line ABOVE a closer is confirmed as a run start", () => {
  const src = [
    "registerAll({", // 0
    "  widgets: true,", // 1
    "  // audits are opt-in for now", // 2  <- cursor
    "});", // 3
    "/** Fan out the stripe totals. */", // 4
    "export function stripeFanout(): number { return 0; }", // 5
  ].join("\n");
  const getLine = lines(src);
  // The mechanism, pinned: the down-walk from line 2 breaks on `});` and
  // shrink-forwards to nameLine, which attachRunStart reads as a confirmation.
  assert.strictEqual(declarationHeadLine(getLine, 2, 5, []), 5, "line 2 audits as trivia of line 5");
  // The run must be the doc line only. It is not.
  assert.strictEqual(attachRunStart(getLine, 5, []), 4, "the run for stripeFanout is line 4, the doc");
  assert.strictEqual(
    attachedCandidateIndex([{ nameLine: 5 }], getLine, 2, []),
    -1,
    "a comment inside the object literal does not document stripeFanout",
  );
});

test("REVIEW 1b: a bare `[...]` CODE line above a closer is confirmed too", () => {
  const src = [
    "    static readonly Dictionary<string, int> Bands = new()", // 0
    "    {", // 1
    '        ["lo"] = 1,', // 2  <- a CODE line
    "        // the tail band is inclusive", // 3
    "    };", // 4
    "    /// <summary>Totals the bands.</summary>", // 5
    "    public static int Total() => 0;", // 6
  ].join("\n");
  const getLine = lines(src);
  // `["lo"] = 1,` starts with `[`, which declarationHeadLine reads as a C#
  // attribute; the walk then skips the comment, breaks on `};`, and
  // shrink-forwards to the name line. A code line has just been declared trivia.
  assert.strictEqual(
    attachRunStart(getLine, 6, []),
    5,
    "Total's trivia run is its `///` line, not the dictionary initializer",
  );
  assert.strictEqual(
    attachedCandidateIndex([{ nameLine: 6 }], getLine, 2, []),
    -1,
    "a cursor on a dictionary entry does not document Total",
  );
});

gtest("REVIEW 1c: csharp — a cursor in a field initializer resolves to the next METHOD", async () => {
  const fixture = {
    name: "Fns.cs",
    languageId: "csharp",
    text: [
      "public class Fns", // 0
      "{", // 1
      "    static readonly Dictionary<string, int> Bands = new()", // 2
      "    {", // 3
      '        ["lo"] = 1,', // 4
      "        // the tail band is inclusive", // 5   <- cursor
      "    };", // 6
      "    /// <summary>Totals the bands.</summary>", // 7
      "    public static int Total() => 0;", // 8
      "}", // 9
    ].join("\n"),
    // Roslyn: the class range covers the whole class; `///` is excluded from the
    // method range (scout finding 1). Fields are Field kind, never admitted.
    symbols: (R) => [
      sym("Fns", K.Class, R(0, 0, 9, 1), R(0, 13, 0, 16), [
        sym("Bands", K.Field, R(2, 4, 6, 6), R(2, 47, 2, 52)),
        sym("Total", K.Method, R(8, 4, 8, 35), R(8, 22, 8, 27)),
      ]),
    ],
  };
  // admitTypes = false: today this refuses (the cursor is in no function).
  assert.strictEqual(
    (await resolveAt(fixture, 5, 10, false))?.symbolName,
    undefined,
    "a comment in a field initializer is not Total's doc comment",
  );
  // admitTypes = true: today this answers the class. Either way it must not
  // become Total, whose body a generate/repair gesture would then rewrite.
  assert.notStrictEqual(
    (await resolveAt(fixture, 5, 10, true))?.symbolName,
    "Total",
    "admitTypes=true must not drift from the class to Total",
  );
  // And the cursor on the CODE line above the comment, same shape.
  assert.notStrictEqual(
    (await resolveAt(fixture, 4, 10, true))?.symbolName,
    "Total",
    "a cursor on `[\"lo\"] = 1,` must not resolve to Total",
  );
});

gtest("REVIEW 1d: typescript — a cursor in a module-scope object literal resolves to the next function", async () => {
  const fixture = {
    name: "register.ts",
    languageId: "typescript",
    text: [
      "registerAll({", // 0
      "  widgets: true,", // 1
      "  // audits are opt-in for now", // 2  <- cursor
      "});", // 3
      "/** Fan out the stripe totals. */", // 4
      "export function stripeFanout(): number {", // 5
      "  return 0;", // 6
      "}", // 7
    ].join("\n"),
    symbols: (R) => [sym("stripeFanout", K.Function, R(5, 0, 7, 1), R(5, 16, 5, 28))],
  };
  assert.strictEqual(
    await resolveAt(fixture, 2, 5, false),
    undefined,
    "a comment inside a call argument is not the next function's doc comment",
  );
});

gtest("REVIEW 1e: rust — a trailing comment inside a struct body resolves to the next fn", async () => {
  const fixture = {
    name: "lib.rs",
    languageId: "rust",
    text: [
      "/// A stripe of work.", // 0
      "pub struct Stripe {", // 1
      "    pub lo: u32,", // 2
      "    // TODO: add `hi` once the oracle lands", // 3  <- cursor
      "}", // 4
      "/// Totals the stripe.", // 5
      "pub fn total(s: &Stripe) -> u32 {", // 6
      "    s.lo", // 7
      "}", // 8
    ].join("\n"),
    // rust-analyzer INCLUDES the doc comment in the range (scout finding 1).
    symbols: (R) => [
      sym("Stripe", K.Struct, R(0, 0, 4, 1), R(1, 11, 1, 17), [sym("lo", K.Field, R(2, 4, 2, 16), R(2, 8, 2, 10))]),
      sym("total", K.Function, R(5, 0, 8, 1), R(6, 7, 6, 12)),
    ],
  };
  // The cursor is INSIDE the struct's own range, and the struct is an admitted
  // target. The attachment pass fires anyway (the answer is a container) and
  // moves the target off the thing the cursor is inside.
  assert.strictEqual(
    (await resolveAt(fixture, 3, 10, true))?.symbolName,
    "Stripe",
    "a comment inside the struct body belongs to the struct the cursor is in",
  );
});

gtest("REVIEW 1f: the same run defect drags a CONTEXT BLOCK's first line into the block above it", async () => {
  // resolveBlockAtCursor (fnGen.ts:511, already wired) takes attachRunStart as
  // the block's first line, so finding 1 is not confined to the generate target:
  // the panel entry starts mid-initializer, and its frozen text — the exact
  // bytes that reach the prompt — carries code the human did not point at.
  const fixture = {
    name: "Fns.cs",
    languageId: "csharp",
    text: [
      "public class Fns", // 0
      "{", // 1
      "    static readonly Dictionary<string, int> Bands = new()", // 2
      "    {", // 3
      '        ["lo"] = 1,', // 4
      "        // the tail band is inclusive", // 5
      "    };", // 6
      "    /// <summary>Totals the bands.</summary>", // 7
      "    public static int Total() => 0;", // 8
      "}", // 9
    ].join("\n"),
    symbols: (R) => [
      sym("Fns", K.Class, R(0, 0, 9, 1), R(0, 13, 0, 16), [
        sym("Bands", K.Field, R(2, 4, 6, 6), R(2, 47, 2, 52)),
        sym("Total", K.Method, R(8, 4, 8, 35), R(8, 22, 8, 27)),
      ]),
    ],
  };
  const doc = docFor(fixture);
  const block = await surf.resolveBlockAtCursor(doc, P(8, 25));
  assert.strictEqual(block?.symbol.name, "Total");
  assert.strictEqual(block?.firstLine, 7, "Total's block starts at its `///` line");
});

// ===========================================================================
// FINDING 2. maxMisses IS a correctness knob for block comments. Every interior
// line of a `/** ... */` fails the audit (declarationHeadLine only enters
// block-comment state on the OPENER), so a doc comment longer than the miss
// budget never confirms and the attach silently does not happen.
// ===========================================================================

function jsdoc(interiorLines) {
  const rows = ["/**"];
  for (let i = 0; i < interiorLines; i++) rows.push(` * @param a${i} the ${i}th thing`);
  rows.push(" */");
  rows.push("export function stripeFanout(): number {");
  rows.push("  return 0;");
  rows.push("}");
  return { text: rows.join("\n"), nameLine: interiorLines + 2 };
}

test("REVIEW 2a: a long JSDoc stops attaching, and the cliff is the miss budget", () => {
  const measured = [];
  for (let n = 1; n <= 25; n++) {
    const { text, nameLine } = jsdoc(n);
    const getLine = lines(text);
    measured.push({ interior: n, attaches: attachRunStart(getLine, nameLine, []) === 0 });
  }
  const firstFailure = measured.find((m) => !m.attaches);
  assert.strictEqual(
    firstFailure,
    undefined,
    `a JSDoc with ${firstFailure ? firstFailure.interior : "?"} interior lines no longer attaches ` +
      `(cliff at ${firstFailure ? firstFailure.interior : "?"}; ` +
      `attaching sizes: ${measured.filter((m) => m.attaches).map((m) => m.interior).join(",")})`,
  );
});

gtest("REVIEW 2b: typescript — a 20-line JSDoc refuses instead of resolving to its function", async () => {
  const { text, nameLine } = jsdoc(20);
  const fixture = {
    name: "long.ts",
    languageId: "typescript",
    text,
    symbols: (R) => [sym("stripeFanout", K.Function, R(nameLine, 0, nameLine + 2, 1), R(nameLine, 16, nameLine, 28))],
  };
  // Cursor on the first interior line of the doc block: the flagship TS case,
  // just longer than the spike's fixtures.
  const r = await resolveAt(fixture, 1, 5, false);
  assert.strictEqual(r?.symbolName, "stripeFanout", "a long doc comment is still a doc comment");
});

// ===========================================================================
// FINDING 3. flattenOfKind reads `selectionRange` off EVERY symbol in the tree,
// including children. hasDocumentSymbolShape validates TOP-LEVEL entries only,
// and its own doc says so. A child without selectionRange used to matter only
// when the cursor was inside it; now it throws whenever the pass fires.
// ===========================================================================

gtest("REVIEW 3: a child symbol without selectionRange throws instead of degrading", async () => {
  const fixture = {
    name: "ragged.ts",
    languageId: "typescript",
    text: [
      "/** Fan out. */", // 0  <- cursor
      "export function stripeFanout(): number {", // 1
      "  return 0;", // 2
      "}", // 3
      "export class Ragged {", // 4
      "  weird(): void {}", // 5
      "}", // 6
    ].join("\n"),
    symbols: (R) => [
      sym("stripeFanout", K.Function, R(1, 0, 3, 1), R(1, 16, 1, 28)),
      {
        name: "Ragged",
        detail: "",
        kind: K.Class,
        range: R(4, 0, 6, 1),
        selectionRange: R(4, 13, 4, 19),
        // A provider that answers a hierarchy but omits selectionRange on a
        // child. hasDocumentSymbolShape passes: it checks top level only.
        children: [{ name: "weird", detail: "", kind: K.Method, range: R(5, 2, 5, 18), children: [] }],
      },
    ],
  };
  const r = await resolveAt(fixture, 0, 5, false);
  assert.strictEqual(r?.symbolName, "stripeFanout", "the ragged sibling must not break resolution");
});

// ===========================================================================
// FINDING 4. Cost. The pass is quadratic in the length of a contiguous comment
// run, because every candidate line is audited by a walk that runs from that
// line all the way down to the name line. `document.lineAt` allocates.
// ===========================================================================

gtest("REVIEW 4a: a long commented-out block makes the pass quadratic in lineAt calls", async () => {
  const rows = [];
  for (let i = 0; i < 200; i++) rows.push(`// const legacy${i} = ${i};`);
  rows.push("/** Fan out. */");
  rows.push("export function stripeFanout(): number {");
  rows.push("  return 0;");
  rows.push("}");
  const nameLine = 201;
  const fixture = {
    name: "legacy.ts",
    languageId: "typescript",
    text: rows.join("\n"),
    symbols: (R) => [sym("stripeFanout", K.Function, R(nameLine, 0, nameLine + 2, 1), R(nameLine, 16, nameLine, 28))],
  };
  const doc = docFor(fixture);
  await surf.resolveFunctionAtCursor(doc, P(0, 3), false);
  // A linear pass over the run would be ~200 lineAt calls plus the head walk.
  assert.ok(
    doc.lineAtCalls < 1000,
    `one resolution cost ${doc.lineAtCalls} document.lineAt calls over a 201-line trivia run`,
  );
});

gtest("REVIEW 4b: the pass sweeps every candidate even when the cursor line is blank", async () => {
  // The contract states a cursor on a blank line can never attach. The pass
  // still walks every declaration below it before finding that out.
  const rows = [];
  const nameLines = [];
  rows.push("");
  for (let i = 0; i < 60; i++) {
    rows.push("/**");
    rows.push(` * Function ${i}.`);
    rows.push(" */");
    nameLines.push(rows.length);
    rows.push(`export function f${i}(): number {`);
    rows.push("  return 0;");
    rows.push("}");
  }
  const fixture = {
    name: "many.ts",
    languageId: "typescript",
    text: rows.join("\n"),
    symbols: (R) => nameLines.map((nl, i) => sym(`f${i}`, K.Function, R(nl, 0, nl + 2, 1), R(nl, 16, nl, 18 + String(i).length))),
  };
  const blank = docFor(fixture);
  assert.strictEqual(await surf.resolveFunctionAtCursor(blank, P(0, 0), false), undefined);
  const inBody = docFor(fixture);
  await surf.resolveFunctionAtCursor(inBody, P(nameLines[0] + 1, 3), false);
  assert.ok(
    blank.lineAtCalls <= inBody.lineAtCalls,
    `a blank-line cursor cost ${blank.lineAtCalls} lineAt calls; a body cursor cost ${inBody.lineAtCalls}`,
  );
});

// ===========================================================================
// FINDING 5. Python has no closers, so the run walks straight out of an
// indented block into a dedented declaration. Indentation is the language's
// own block structure and the predicate cannot see it.
//
// Fixture caveat, stated because it matters: Pylance was measured to EXCLUDE a
// leading `#` run from a symbol range (scout finding 1). The range end used here
// (last statement, trailing comment excluded) is the same shape, but was not
// separately measured.
// ===========================================================================

gtest("REVIEW 5: python — a trailing comment in one method's body resolves to the NEXT method", async () => {
  const fixture = {
    name: "fns.py",
    languageId: "python",
    text: [
      "class Fns:", // 0
      "    def total(self) -> int:", // 1
      "        return 1", // 2
      "        # TODO: handle the empty band", // 3  <- cursor
      "    def audit(self) -> None:", // 4
      "        pass", // 5
    ].join("\n"),
    symbols: (R) => [
      sym("Fns", K.Class, R(0, 0, 5, 12), R(0, 6, 0, 9), [
        sym("total", K.Method, R(1, 4, 2, 16), R(1, 8, 1, 13)),
        sym("audit", K.Method, R(4, 4, 5, 12), R(4, 8, 4, 13)),
      ]),
    ],
  };
  const r = await resolveAt(fixture, 3, 12, false);
  assert.notStrictEqual(
    r?.symbolName,
    "audit",
    "a comment at the end of total's body is not audit's doc comment",
  );
});

// ===========================================================================
// CATEGORY 2 CHECK (expected to PASS): the post-accept oracle re-resolves at
// positionAt(span.start), the declaration head. Scout finding 9 says the head
// always sits inside its own symbol's range, so the pass never fires there.
// This asserts the property directly on every language fixture, including the
// C# shape whose range starts on an attribute line.
// ===========================================================================

gtest("CATEGORY 2: re-resolving at span.start is a fixed point in all five languages", async () => {
  const fixtures = [
    {
      label: "rust",
      admitTypes: false,
      cursor: [0, 4],
      fixture: {
        name: "lib.rs",
        languageId: "rust",
        text: ["/// Fan out.", "pub fn stripe_total_fanout() -> u32 {", "    0", "}"].join("\n"),
        symbols: (R) => [sym("stripe_total_fanout", K.Function, R(0, 0, 3, 1), R(1, 7, 1, 26))],
      },
    },
    {
      label: "typescript",
      admitTypes: false,
      cursor: [1, 4],
      fixture: {
        name: "fanout.ts",
        languageId: "typescript",
        text: ["/**", " * Fan out.", " */", "export function stripeFanout(): number {", "  return 0;", "}"].join("\n"),
        symbols: (R) => [sym("stripeFanout", K.Function, R(3, 0, 5, 1), R(3, 16, 3, 28))],
      },
    },
    {
      label: "csharp (range starts on the attribute line)",
      admitTypes: true,
      cursor: [4, 10],
      fixture: {
        name: "Fns.cs",
        languageId: "csharp",
        text: [
          "namespace Playground;",
          "",
          "public class Fns",
          "{",
          "    /// <summary>Fan out.</summary>",
          "    [Fact]",
          "    public static int StripeFanout()",
          "    {",
          "        return 0;",
          "    }",
          "}",
        ].join("\n"),
        symbols: (R) => [
          sym("Playground", K.Namespace, R(0, 0, 10, 1), R(0, 10, 0, 20), [
            sym("Fns", K.Class, R(2, 0, 10, 1), R(2, 13, 2, 16), [sym("StripeFanout", K.Method, R(5, 4, 9, 5), R(6, 22, 6, 34))]),
          ]),
        ],
      },
    },
    {
      label: "go",
      admitTypes: false,
      cursor: [2, 6],
      fixture: {
        name: "fanout.go",
        languageId: "go",
        text: ["package main", "", "// stripeFanout fans out.", "func stripeFanout() uint32 {", "\treturn 0", "}"].join("\n"),
        symbols: (R) => [sym("stripeFanout", K.Function, R(3, 0, 5, 1), R(3, 5, 3, 17))],
      },
    },
    {
      // The type-target arm of the oracle path: `injectionEnabled` is what the
      // re-resolution passes, so a struct target re-resolves with types
      // admitted, the pass fires (a struct is not a FUNCTION_KIND), and it must
      // still not move. Uses the REVIEW 1e geometry deliberately: even with a
      // false run below it, the HEAD position is a fixed point.
      label: "rust struct target (admitTypes, the oracle arm)",
      admitTypes: true,
      cursor: [0, 4],
      fixture: {
        name: "lib.rs",
        languageId: "rust",
        text: [
          "/// A stripe of work.",
          "pub struct Stripe {",
          "    pub lo: u32,",
          "    // TODO: add `hi` once the oracle lands",
          "}",
          "/// Totals the stripe.",
          "pub fn total(s: &Stripe) -> u32 {",
          "    s.lo",
          "}",
        ].join("\n"),
        symbols: (R) => [
          sym("Stripe", K.Struct, R(0, 0, 4, 1), R(1, 11, 1, 17), [sym("lo", K.Field, R(2, 4, 2, 16), R(2, 8, 2, 10))]),
          sym("total", K.Function, R(5, 0, 8, 1), R(6, 7, 6, 12)),
        ],
      },
    },
    {
      label: "python",
      admitTypes: false,
      cursor: [0, 4],
      fixture: {
        name: "fns.py",
        languageId: "python",
        text: ["# fan out", "def stripe_fanout() -> int:", "    return 0"].join("\n"),
        symbols: (R) => [sym("stripe_fanout", K.Function, R(1, 0, 2, 12), R(1, 4, 1, 17))],
      },
    },
  ];
  for (const row of fixtures) {
    const first = await resolveAt(row.fixture, row.cursor[0], row.cursor[1], row.admitTypes);
    assert.ok(first, `${row.label}: the doc cursor resolves`);
    const doc = docFor(row.fixture);
    const again = await surf.resolveFunctionAtCursor(doc, doc.positionAt(first.span.start), row.admitTypes);
    assert.strictEqual(again?.symbolName, first.symbolName, `${row.label}: same symbol`);
    assert.deepStrictEqual(again?.span, first.span, `${row.label}: same span`);
    assert.strictEqual(again?.signature, first.signature, `${row.label}: same signature`);
    assert.strictEqual(again?.docComment, first.docComment, `${row.label}: same doc`);
  }
});
