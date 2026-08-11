// BLIND ORACLE - session-v51 phase 3, "the hover fan-out cap is two numbers".
//
// Binds to session-v51/contract-phase3.md and to nothing else. The four bodies
// the brief fences off were never opened: `membersWithHoverSignatures` and the
// transports' `membersOfType` in src/core/extraction.ts / src/vscode/*, the
// resolver body of `resolveCrossFileShape` in src/core/crossFileShape.ts, and
// `resolvePrefill` in src/vscode/fnGen.ts. What WAS read, and only far enough to
// call things: the exported declarations of `MemberSurfaceOptions`,
// `CompletionMember`, `HoverBackfillOptions` and `SymbolMemberBuilder`, the two
// cap constants and `HOVER_FANOUT_BUDGET_MS`, and the PARAMETER LISTS (not the
// bodies) of `membersWithHoverSignatures`, `hoverBackfillOptions`,
// `resolveCrossFileShape`, `resolvePrefill` and `toPySymbolMember`.
//
// ---------------------------------------------------------------------------
// WHY NO ROW READS A CONSTANT AND CALLS IT A DAY.
//
// `assert.equal(HOVER_SIGNATURE_CAP, 32)` proves the number is typed correctly
// and nothing about who spends it. session-v50 lost a whole leg to an oracle
// bound to a helper while the facade above it was wired to nothing
// (`a-hooks-object-can-be-wired-to-nothing`). A cap is a claim about HOW MANY
// ASKS GO OUT, so every row below drives a FACADE - `resolvePrefill`,
// `FimCompletionProvider.resolveWholeBlock`, `resolveCrossFileShape` - against a
// transport that COUNTS the hover cursors it was asked about, and asserts the
// count.
//
// Both constants are read from the product's exports. No row spells 32 or 48
// more than once, and every assertion message names which constant it is holding
// the product to.
//
// ---------------------------------------------------------------------------
// THE FAKE TRANSPORT, AND WHY IT IS BUILT OUT OF PRODUCT PARTS.
//
// A fake whose `membersOfType` spelled its own `opts?.signatureCap ?? 32` would
// be asserting this file's guess at the product mapping, which is the
// `harness-must-use-the-product-mapping` trap. So the fake is wired the way the
// three real hover transports are, out of the two exported helpers that exist
// for exactly that job:
//
//   membersOfType(defCursor, budgetMs, opts) =>
//     membersWithHoverSignatures(SYMBOLS, defCursor, pyLspSymbolRole,
//       toPySymbolMember, countingHover, hoverBackfillOptions(budgetMs, opts))
//
// `hoverBackfillOptions`' own doc names itself "the ONE place a transport turns
// its two optional `membersOfType` arguments into fan-out options", so that glue
// line is the product's, not this file's. The symbol tree handed to it is a
// pyright-shaped documentSymbol[] with `detail` EMPTY on every child - which is
// what pyright and tsserver actually return, and the reason these two languages
// buy hovers at all. The fixture shape is lifted from
// test/review-v49-p0-pycap.test.cjs, which was built against a real captured
// Roslyn/pyright surface.
//
// Two counters, kept apart on purpose: `fanoutAsks` is the member fan-out (the
// thing the cap bounds) and `typeHovers` is the walk's own hover on the TYPE
// (which no cap touches). A row that conflated them would move whenever the walk
// changed its mind about anything.
//
// ---------------------------------------------------------------------------
// THE FIXTURE SIZES, AND WHY 60 AND 12.
//
// 60 members puts BOTH caps strictly inside the population, so 32 and 48 are
// distinguishable outcomes rather than the same "everything" answer. 12 is
// contract claim 4's class: under both caps, so a build that treats 48 as a
// target instead of a cap over-asks by 36.
//
// ---------------------------------------------------------------------------
// ONE CALL THIS FILE MADE, NAMED. The contract's claim 1 says "on the two
// languages whose servers leave `detail` empty", i.e. Python AND TypeScript. The
// fan-out rows run the PYTHON builder only, because `toPySymbolMember` is the
// exported member builder this file can drive without opening a transport. The
// TypeScript half is covered at the CALLER seam instead (C51-1c records the
// `opts` a TypeScript gesture hands its transport) plus the static tripwire
// C51-5b. Said here rather than buried, because it is a gap: nothing below
// counts a real TypeScript fan-out.
//
// ---------------------------------------------------------------------------
// WAS ANY ROW EVER RED. All 14 pass on the working tree, so "it passes" is worth
// nothing on its own. Three MUTATIONS were run against a copy of the working
// tree, each modelling a build defect the contract forbids, and the ledger below
// is what caught what. A row that appears in no column is decoration.
//
//   M1  PREFILL_HOVER_SIGNATURE_CAP collapsed back to 32 (the split never
//       happened, both paths share a number)
//         RED: the guard, C51-1b, C51-3b
//         Note C51-1a stays GREEN under M1, and that is the cost of reading
//         every bound off the product's exports: with the constant at 32 the
//         count agrees with it. The GUARD's `pre > fim` is what refuses a
//         collapsed pair, which is why it is a row and not a comment.
//   M3  the pre-fill call site passes `undefined` instead of the cap (the
//       `a-hooks-object-can-be-wired-to-nothing` failure, at this seam)
//         RED: C51-1a, C51-1b, C51-1c, C51-2c, C51-4a
//         GREEN, correctly: every FIM and every absent-means-32 row. FIM did
//         not move, and the rows say so.
//   M4  `hoverBackfillOptions` mints the PREFILL default for callers that
//       passed nothing (the leak onto the keystroke path)
//         RED: C51-2a, C51-2c, C51-3a, C51-3b, C51-3c
//         C51-2b stays GREEN under M4 - the FIM caller really does pass
//         nothing, and the leak is downstream of it. That is the whole reason
//         C51-2a counts asks instead of reading the argument, and the reason
//         both rows exist.
//
// A fourth check was run and is recorded as uninformative: the rows against
// commit 968ae62 (the pre-phase-3 tip). `PREFILL_HOVER_SIGNATURE_CAP` and
// `hoverBackfillOptions` do not exist there, so the core bundle does not build
// and 11 rows go red on the build rather than on a measurement. It proves the
// file binds a new API and nothing else.
//
// Nothing here needs a live language server, so SKIP_LIVE=1 changes nothing.
//
// Run: SKIP_LIVE=1 npx node --test test/blind-v51-p3-capsplit.test.cjs

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");

const show = (v) => JSON.stringify(v);

// ===========================================================================
// HARNESS A. The core seam, bundled pure. No vscode on this path.
// ===========================================================================

const A_ENTRY = path.join(__dirname, ".blind-v51-p3-core.entry.ts");
const A_OUT = path.join(__dirname, ".blind-v51-p3-core.bundle.cjs");
let CORE = {};
let coreErr;
try {
  fs.writeFileSync(
    A_ENTRY,
    `export { membersWithHoverSignatures, hoverBackfillOptions, HOVER_SIGNATURE_CAP, PREFILL_HOVER_SIGNATURE_CAP, HOVER_FANOUT_BUDGET_MS } from "../src/core/extraction";
export { pyLspSymbolRole, toPySymbolMember } from "../src/core/pyExtraction";
export { resolveCrossFileShape, shapeHooksFor } from "../src/core/crossFileShape";\n`,
  );
  esbuild.buildSync({ entryPoints: [A_ENTRY], bundle: true, outfile: A_OUT, format: "cjs", platform: "node" });
  CORE = require(A_OUT);
} catch (e) {
  coreErr = e;
}

// ===========================================================================
// HARNESS B. The two FACADES, bundled headless against a structural vscode
// stub. Stub mechanics copied from test/blind-v50-p3-pyfields.test.cjs; the
// output channel is a REAL object because `resolvePrefill` leaves background
// work in flight and a straggler that logs into `{}` throws after the row that
// started it has ended.
// ===========================================================================

const STUB = path.join(__dirname, ".blind-v51-p3-vscode-stub.cjs");
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
class Selection extends Range {}
const mkUri = (s) => ({ toString: () => String(s), fsPath: String(s), path: String(s) });
const keyOf = (a) => (typeof a === "string" ? a : (a && a.toString ? a.toString() : String(a)));
module.exports = {
  Position, Range, Selection, WorkspaceEdit: class {},
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
        const c = globalThis.__V51P3_CFG__ || {};
        return Object.prototype.hasOwnProperty.call(c, k) ? c[k] : f;
      },
      has: () => false, inspect: () => undefined, update: async () => {},
    }),
    openTextDocument: (arg) =>
      Promise.resolve({ uri: mkUri(keyOf(arg)), getText: () => (globalThis.__V51P3_FILES__ || {})[keyOf(arg)] }),
  },
};
`,
);

const B_ENTRY = path.join(__dirname, ".blind-v51-p3-facade.entry.ts");
const B_OUT = path.join(__dirname, ".blind-v51-p3-facade.bundle.cjs");
let FACADE = {};
let facadeErr;
try {
  fs.writeFileSync(
    B_ENTRY,
    `export { resolvePrefill } from "../src/vscode/fnGen";
export { FimCompletionProvider } from "../src/vscode/completionProvider";\n`,
  );
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

// A bundle failure is a LOUD row, never a skip: a file that goes green because
// it could not build the subject is the false green this suite exists to stop.
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
// THE FIXTURE. One Python file: a fat class, then the function the pre-fill
// gesture and the FIM whole-block site both name.
// ===========================================================================

const URI = "file:///w/v51p3/app.py";
const ROOT = "GraphEngine";
const CLASS_LINE = 0;
const FAT_N = 60; // strictly above both caps, so 32 and 48 are different answers
const SMALL_N = 12; // strictly below both caps - contract claim 4's class

const memberName = (i) => `method_${String(i).padStart(2, "0")}`;

// The source text. Every member declares on its own line at CLASS_LINE+1+i, so
// a hover cursor's LINE identifies the member it was asked about with no
// guessing.
function sourceFor(n) {
  const lines = [`class ${ROOT}:`];
  for (let i = 0; i < n; i++) {
    lines.push(`    def ${memberName(i)}(self, a: int) -> None: ...`);
  }
  lines.push("", `def build(p0: ${ROOT}) -> int:`, '    """Rebuild the registry."""', "    raise NotImplementedError", "");
  return lines.join("\n");
}

// The pyright-shaped documentSymbol tree, `detail` EMPTY on every node. That
// emptiness is the whole reason this language buys hovers, so a fixture that
// filled it would test nothing (and is exactly what C51-5a switches on).
function symbolsFor(n, { withDetail = false } = {}) {
  const children = Array.from({ length: n }, (_, i) => {
    const line = CLASS_LINE + 1 + i;
    return {
      name: memberName(i),
      kind: 12, // Function
      detail: withDetail ? `def ${memberName(i)}(self, a: int) -> None` : "",
      range: { start: { line, character: 4 }, end: { line, character: 60 } },
      selectionRange: { start: { line, character: 8 }, end: { line, character: 8 + memberName(i).length } },
    };
  });
  return [
    {
      name: ROOT,
      kind: 5, // Class
      detail: "",
      range: { start: { line: CLASS_LINE, character: 0 }, end: { line: CLASS_LINE + n + 1, character: 0 } },
      selectionRange: { start: { line: CLASS_LINE, character: 6 }, end: { line: CLASS_LINE, character: 6 + ROOT.length } },
      children,
    },
  ];
}

// pyright's own quickinfo wording. `toPySymbolMember` is the product's builder,
// so whatever it makes of this is the product's answer, not this file's.
const hoverTextFor = (i) => `(method) def ${memberName(i)}(self, a: int) -> None`;

const wordAt = (text, cursor) => {
  const line = (text || "").split("\n")[cursor.line] ?? "";
  const isWord = (ch) => /[A-Za-z0-9_]/.test(ch);
  let s = Math.min(cursor.character, line.length);
  let e = s;
  while (s > 0 && isWord(line[s - 1])) s--;
  while (e < line.length && isWord(line[e])) e++;
  return e > s ? line.slice(s, e) : undefined;
};

/** A transport in the shape of the three the contract names: a documentSymbol
 *  descent whose `detail` is empty, backfilled by a hover fan-out. Wired out of
 *  the product's own two helpers (see the file header) so what it honours is the
 *  product's mapping and not this file's. */
function makeTransport(n, { withDetail = false } = {}) {
  const src = sourceFor(n);
  const symbols = symbolsFor(n, { withDetail });
  const rec = {
    // Every `membersOfType` call, with the third argument VERBATIM.
    memberCalls: [],
    // Distinct member-hover cursors, `line:character`. This is the cap's subject.
    fanoutCursors: new Set(),
    fanoutAsks: 0,
    // The walk's own hover on the TYPE. No cap touches it; counted apart so a
    // row can never confuse the two.
    typeHovers: 0,
    definitions: 0,
  };
  const memberHover = async (at) => {
    rec.fanoutAsks++;
    rec.fanoutCursors.add(`${at.line}:${at.character}`);
    const i = at.line - (CLASS_LINE + 1);
    return i >= 0 && i < n ? hoverTextFor(i) : undefined;
  };
  const extractor = {
    async completeMembers() {
      return [];
    },
    async definition(cursor) {
      rec.definitions++;
      if (wordAt(src, cursor) !== ROOT) return undefined;
      return {
        uri: URI,
        range: { startLine: CLASS_LINE, startCharacter: 6, endLine: CLASS_LINE, endCharacter: 6 + ROOT.length },
      };
    },
    async hoverSurface(cursor) {
      rec.typeHovers++;
      return wordAt(src, cursor) === ROOT ? { signature: `class ${ROOT}` } : undefined;
    },
    async membersOfType(defCursor, budgetMs, opts) {
      rec.memberCalls.push({ budgetMs, opts, signatureCap: opts?.signatureCap });
      return CORE.membersWithHoverSignatures(
        symbols,
        defCursor,
        CORE.pyLspSymbolRole,
        CORE.toPySymbolMember,
        memberHover,
        CORE.hoverBackfillOptions(budgetMs, opts),
      );
    },
    async example() {
      return undefined;
    },
    async qualifyImport() {
      return undefined;
    },
  };
  return { src, symbols, rec, extractor };
}

const dumpRec = (rec) =>
  `\n  membersOfType calls: ${show(rec.memberCalls.map((c) => ({ budgetMs: c.budgetMs, signatureCap: c.signatureCap })))}` +
  `\n  member-hover asks: ${rec.fanoutAsks} (distinct cursors ${rec.fanoutCursors.size})` +
  `\n  type hovers: ${rec.typeHovers}; definitions: ${rec.definitions}`;

// ===========================================================================
// THE TWO FACADE DRIVERS.
// ===========================================================================

function makeDoc(text, uriStr, languageId = "python") {
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

/** FACADE 1: the PRE-FILL gesture. Contract claim 1's subject. */
async function prefillOver(t, languageId = "python") {
  const signature = `def build(p0: ${ROOT}) -> int:`;
  const record = {
    span: { start: t.src.indexOf(signature), end: t.src.length - 1 },
    signature,
    docComment: "Rebuild the registry.",
    symbolName: "build",
    languageId,
    kind: "function",
    bodyOnly: false,
    headerIndent: "",
    bodyIndent: "    ",
  };
  const logs = [];
  // MERGED, never replaced: resolvePrefill leaves background work in flight and
  // a straggler that finds the file map gone reports as an unhandled rejection
  // after the row that started it has ended.
  globalThis.__V51P3_FILES__ = { ...(globalThis.__V51P3_FILES__ || {}), [URI]: t.src };
  const text = await FACADE.resolvePrefill(t.extractor, makeDoc(t.src, URI, languageId), record, (l) =>
    logs.push(String(l)),
  );
  return { text: text || "", logs };
}

/** FACADE 2: the FIM WHOLE-BLOCK injection. Contract claim 2's subject, driven
 *  through the provider the contract names by file and method rather than
 *  through the pure renderer downstream of it - the renderer never sees a
 *  transport, so it could not observe a cap either way. */
async function wholeBlockOver(t) {
  globalThis.__V51P3_FILES__ = { ...(globalThis.__V51P3_FILES__ || {}), [URI]: t.src };
  const provider = new FACADE.FimCompletionProvider(
    () => ({}),
    { appendLine: () => {}, append: () => {} },
  );
  return provider.resolveWholeBlock(makeDoc(t.src, URI, "python"), t.extractor, [ROOT]);
}

/** FACADE 3: the shared resolver, called the way a caller that passes nothing
 *  calls it. `signatureCap` is the LAST parameter, so "passes nothing" is
 *  literally an argument list that stops short. */
function walkOver(t, signatureCap) {
  const lines = t.src.split("\n");
  const anchorLine = lines.findIndex((l) => l.startsWith("def build("));
  const rootSite = { uri: URI, line: anchorLine, character: lines[anchorLine].indexOf(ROOT) };
  const bound = { D_MAX: 2, N_MAX: 8 };
  const openFile = async (u) => (u === URI ? t.src : undefined);
  const hooks = CORE.shapeHooksFor("python");
  return signatureCap === undefined
    ? CORE.resolveCrossFileShape(t.extractor, rootSite, bound, openFile, hooks)
    : CORE.resolveCrossFileShape(
        t.extractor,
        rootSite,
        bound,
        openFile,
        hooks,
        undefined,
        undefined,
        undefined,
        undefined,
        signatureCap,
      );
}

const signedIn = (text, i) => new RegExp(`\\b${memberName(i)}\\b`).test(String(text));

// ===========================================================================
// GUARD. Nothing below means anything if the subject did not build, if a facade
// is missing, or if the fixture is not strictly larger than both caps.
// ===========================================================================

test("guard: both bundles build, every facade is exported, and the fixture is strictly larger than BOTH caps", () => {
  if (coreErr) assert.fail(`core bundle failed: ${coreErr.message}`);
  if (facadeErr) assert.fail(`facade bundle failed: ${facadeErr.message}`);
  for (const n of ["membersWithHoverSignatures", "hoverBackfillOptions", "resolveCrossFileShape", "shapeHooksFor", "toPySymbolMember", "pyLspSymbolRole"]) {
    assert.equal(typeof CORE[n], "function", `${n} must be exported - this file's transport is built out of it`);
  }
  assert.equal(typeof FACADE.resolvePrefill, "function", "resolvePrefill must be exported from src/vscode/fnGen");
  assert.equal(
    typeof FACADE.FimCompletionProvider,
    "function",
    "FimCompletionProvider must be exported from src/vscode/completionProvider - it owns the FIM caller",
  );

  const fim = CORE.HOVER_SIGNATURE_CAP;
  const pre = CORE.PREFILL_HOVER_SIGNATURE_CAP;
  assert.equal(typeof fim, "number", "HOVER_SIGNATURE_CAP must be an exported number");
  assert.equal(
    typeof pre,
    "number",
    "PREFILL_HOVER_SIGNATURE_CAP must be an exported number. The contract calls it new; a build that never " +
      "added it cannot have split anything",
  );
  assert.ok(
    pre > fim,
    `"the hover fan-out cap is two numbers", and the pre-fill's must be the larger: ` +
      `PREFILL_HOVER_SIGNATURE_CAP=${pre} vs HOVER_SIGNATURE_CAP=${fim}`,
  );
  assert.ok(
    FAT_N > pre,
    `CONTROL - the fat fixture (${FAT_N}) must exceed PREFILL_HOVER_SIGNATURE_CAP (${pre}), or "up to 48" and ` +
      `"all of them" are the same observation`,
  );
  assert.ok(
    SMALL_N < fim,
    `CONTROL - the small fixture (${SMALL_N}) must be under HOVER_SIGNATURE_CAP (${fim}) for claim 4 to have a subject`,
  );
  // eslint-disable-next-line no-console
  console.log(`  [guard] HOVER_SIGNATURE_CAP=${fim}  PREFILL_HOVER_SIGNATURE_CAP=${pre}  fixture=${FAT_N}`);
});

// ===========================================================================
// C51-1. CONTRACT CLAIM 1: "A pre-fill gesture on a class with more than 32
// members gets up to 48 signed."
// ===========================================================================

btest("C51-1a: a PRE-FILL gesture on a 60-member class spends PREFILL_HOVER_SIGNATURE_CAP hover asks, not HOVER_SIGNATURE_CAP", async () => {
  const t = makeTransport(FAT_N);
  const r = await prefillOver(t);
  const { rec } = t;

  assert.ok(
    rec.memberCalls.length > 0,
    `CONTROL - the gesture must reach the transport's member leg at all, or this row is measuring silence.` +
      `${dumpRec(rec)}\n--- PROMPT ---\n${r.text || "(empty)"}\n--- CHANNEL ---\n${r.logs.join("\n") || "(silent)"}`,
  );
  assert.equal(
    rec.fanoutCursors.size,
    CORE.PREFILL_HOVER_SIGNATURE_CAP,
    `the pre-fill path must spend PREFILL_HOVER_SIGNATURE_CAP (=${CORE.PREFILL_HOVER_SIGNATURE_CAP}) member ` +
      `hovers on a ${FAT_N}-member class. ${rec.fanoutCursors.size} distinct cursors were asked about. ` +
      `HOVER_SIGNATURE_CAP is ${CORE.HOVER_SIGNATURE_CAP}: a count equal to THAT is the un-split build, and a ` +
      `count of ${FAT_N} is no cap at all.${dumpRec(rec)}`,
  );
  // eslint-disable-next-line no-console
  console.log(`  [C51-1a] PRE-FILL over ${FAT_N} members: ${rec.fanoutCursors.size} member hovers, ${rec.typeHovers} type hovers`);
});

btest("C51-1b: and the extra signatures REACH THE PROMPT - a member only a cap above 32 could sign is in the block", async () => {
  // The transport spending the asks is half the claim; "the pre-fill renders
  // signatures the pre-split code did not" is the other half, and only the
  // prompt can answer it. Member index 40 sits strictly between the two caps, so
  // it is signed under PREFILL_HOVER_SIGNATURE_CAP and bare (hence dropped by
  // renderMemberSignatures) under HOVER_SIGNATURE_CAP.
  const between = Math.floor((CORE.HOVER_SIGNATURE_CAP + CORE.PREFILL_HOVER_SIGNATURE_CAP) / 2);
  const t = makeTransport(FAT_N);
  const r = await prefillOver(t);

  assert.ok(
    r.text.length > 0,
    `CONTROL - the gesture must inject something at all${dumpRec(t.rec)}\n--- CHANNEL ---\n${r.logs.join("\n")}`,
  );
  assert.ok(
    signedIn(r.text, 0),
    `CONTROL - the FIRST member must be in the block, or the block is not a member block at all` +
      `\n--- PROMPT ---\n${r.text}`,
  );
  assert.ok(
    signedIn(r.text, between),
    `${memberName(between)} is member ${between} of ${FAT_N}: past HOVER_SIGNATURE_CAP (${CORE.HOVER_SIGNATURE_CAP}) ` +
      `and inside PREFILL_HOVER_SIGNATURE_CAP (${CORE.PREFILL_HOVER_SIGNATURE_CAP}). It is exactly the member the ` +
      `split exists to deliver, and it is absent from the pre-fill prompt.${dumpRec(t.rec)}\n--- PROMPT ---\n${r.text}`,
  );
});

btest("C51-1c: the pre-fill hands its transport PREFILL_HOVER_SIGNATURE_CAP through the documented `opts.signatureCap` seam, on Python AND TypeScript", async () => {
  // The caller-seam row, and the only place TypeScript is observed. It reads the
  // third `membersOfType` argument verbatim: the contract says the path is
  // selected by the CALLER, so a build that reached 48 some other way (a moved
  // constant, a language table) is not the ruled design.
  for (const languageId of ["python", "typescript"]) {
    const t = makeTransport(FAT_N);
    const r = await prefillOver(t, languageId);
    const caps = [...new Set(t.rec.memberCalls.map((c) => c.signatureCap))];
    assert.ok(
      t.rec.memberCalls.length > 0,
      `CONTROL - the ${languageId} gesture must reach membersOfType${dumpRec(t.rec)}\n--- PROMPT ---\n${r.text}`,
    );
    assert.deepEqual(
      caps,
      [CORE.PREFILL_HOVER_SIGNATURE_CAP],
      `${languageId}: every membersOfType call from the pre-fill must carry ` +
        `opts.signatureCap = PREFILL_HOVER_SIGNATURE_CAP (=${CORE.PREFILL_HOVER_SIGNATURE_CAP}). Got ${show(caps)}. ` +
        `\`undefined\` means the caller passes nothing and the transport falls back to HOVER_SIGNATURE_CAP ` +
        `(=${CORE.HOVER_SIGNATURE_CAP}), which is the un-split behaviour.${dumpRec(t.rec)}`,
    );
  }
});

// ===========================================================================
// C51-2. CONTRACT CLAIM 2: "FIM does not move. A whole-block injection over the
// same type still stops at 32."
// ===========================================================================

btest("C51-2a: the FIM WHOLE-BLOCK injection over the same 60-member class stops at HOVER_SIGNATURE_CAP", async () => {
  const t = makeTransport(FAT_N);
  const block = await wholeBlockOver(t);
  const { rec } = t;

  assert.ok(
    rec.memberCalls.length > 0,
    `CONTROL - the whole-block resolution must reach the transport's member leg, or this row measures silence.` +
      `${dumpRec(rec)}\n--- BLOCK ---\n${block === undefined ? "(undefined)" : block}`,
  );
  assert.equal(
    rec.fanoutCursors.size,
    CORE.HOVER_SIGNATURE_CAP,
    `FIM races a keystroke and its number is HOVER_SIGNATURE_CAP (=${CORE.HOVER_SIGNATURE_CAP}). ` +
      `${rec.fanoutCursors.size} distinct member cursors were asked about. A count of ` +
      `${CORE.PREFILL_HOVER_SIGNATURE_CAP} is the pre-fill's cap leaking onto the keystroke path, which the ` +
      `contract puts out of scope by name.${dumpRec(rec)}`,
  );
  // eslint-disable-next-line no-console
  console.log(`  [C51-2a] FIM over the same ${FAT_N} members: ${rec.fanoutCursors.size} member hovers`);
});

btest("C51-2b: the FIM caller passes NOTHING - `opts.signatureCap` is undefined on every whole-block membersOfType call", async () => {
  // "The FIM caller (completionProvider.resolveWholeBlock) passes nothing." A
  // build that passed HOVER_SIGNATURE_CAP explicitly would count the same in
  // C51-2a and would still be wrong: the contract makes the cap OPT-IN on
  // `resolveCrossFileShape` for the same reason `visibility` is, so an explicit
  // FIM cap is a second caller to keep in step forever.
  const t = makeTransport(FAT_N);
  await wholeBlockOver(t);
  const caps = [...new Set(t.rec.memberCalls.map((c) => c.signatureCap))];
  assert.ok(t.rec.memberCalls.length > 0, `CONTROL - the whole-block must reach membersOfType${dumpRec(t.rec)}`);
  assert.deepEqual(
    caps,
    [undefined],
    `the FIM whole-block caller must pass no signatureCap at all; got ${show(caps)}.${dumpRec(t.rec)}`,
  );
});

btest("C51-2c: the two facades, same fixture, same transport shape - the ONLY difference is the cap, and it is the ruled pair", async () => {
  // The paired row. C51-1a and C51-2a each assert one number; this one asserts
  // they are DIFFERENT and which way round, so a build that quietly made both
  // 48 (or both 32) cannot pass by getting one row's constant to agree with it.
  const pre = makeTransport(FAT_N);
  await prefillOver(pre);
  const fim = makeTransport(FAT_N);
  await wholeBlockOver(fim);

  assert.deepEqual(
    { prefill: pre.rec.fanoutCursors.size, fim: fim.rec.fanoutCursors.size },
    { prefill: CORE.PREFILL_HOVER_SIGNATURE_CAP, fim: CORE.HOVER_SIGNATURE_CAP },
    `one type, one transport, two gestures: the pre-fill spends PREFILL_HOVER_SIGNATURE_CAP ` +
      `(=${CORE.PREFILL_HOVER_SIGNATURE_CAP}) and FIM spends HOVER_SIGNATURE_CAP (=${CORE.HOVER_SIGNATURE_CAP}). ` +
      `Equal counts mean the split did not happen or it leaked.` +
      `\n  PRE-FILL${dumpRec(pre.rec)}\n  FIM${dumpRec(fim.rec)}`,
  );
});

// ===========================================================================
// C51-3. CONTRACT CLAIM 3: "Absent means 32."
// ===========================================================================

ctest("C51-3a: resolveCrossFileShape called with NO signatureCap argument spends HOVER_SIGNATURE_CAP", async () => {
  const t = makeTransport(FAT_N);
  const shape = await walkOver(t, undefined);
  assert.ok(
    shape && t.rec.memberCalls.length > 0,
    `CONTROL - the walk must reach the transport's member leg${dumpRec(t.rec)}`,
  );
  assert.deepEqual(
    [...new Set(t.rec.memberCalls.map((c) => c.signatureCap))],
    [undefined],
    `a caller that passes nothing must have nothing forwarded - the resolver must not mint a default of its ` +
      `own${dumpRec(t.rec)}`,
  );
  assert.equal(
    t.rec.fanoutCursors.size,
    CORE.HOVER_SIGNATURE_CAP,
    `"Absent means HOVER_SIGNATURE_CAP (=${CORE.HOVER_SIGNATURE_CAP}), so every caller that passes nothing ` +
      `behaves exactly as before." ${t.rec.fanoutCursors.size} cursors were asked about.${dumpRec(t.rec)}`,
  );
});

ctest("C51-3b: the cap is OPT-IN on resolveCrossFileShape - the last argument is the only difference between two walks", async () => {
  // Anti-vacuity for C51-3a: if the walk could not move at all, "absent means 32"
  // would be true of a build that ignores the argument entirely.
  const bare = makeTransport(FAT_N);
  await walkOver(bare, undefined);
  const opted = makeTransport(FAT_N);
  await walkOver(opted, CORE.PREFILL_HOVER_SIGNATURE_CAP);

  assert.equal(
    opted.rec.fanoutCursors.size,
    CORE.PREFILL_HOVER_SIGNATURE_CAP,
    `the same walk WITH the last argument set to PREFILL_HOVER_SIGNATURE_CAP ` +
      `(=${CORE.PREFILL_HOVER_SIGNATURE_CAP}) must spend that many. A resolver that drops the argument on the ` +
      `floor reads ${CORE.HOVER_SIGNATURE_CAP} here and makes C51-3a vacuous.${dumpRec(opted.rec)}`,
  );
  assert.ok(
    opted.rec.fanoutCursors.size > bare.rec.fanoutCursors.size,
    `and it must be strictly more than the bare call spent (${bare.rec.fanoutCursors.size}), or the argument ` +
      `changes nothing`,
  );
  assert.deepEqual(
    [...new Set(opted.rec.memberCalls.map((c) => c.signatureCap))],
    [CORE.PREFILL_HOVER_SIGNATURE_CAP],
    `the resolver forwards the caller's cap VERBATIM to every transport call; got ` +
      `${show([...new Set(opted.rec.memberCalls.map((c) => c.signatureCap))])}${dumpRec(opted.rec)}`,
  );
});

ctest("C51-3c: a transport called with no opts at all - the headless-probe shape - is at HOVER_SIGNATURE_CAP", async () => {
  // The floor under claim 3's "including every transport's own default and the
  // headless probes". Two calls: no third argument, and an EMPTY options object.
  // Both are "the caller said nothing about a cap".
  const defCursor = { uri: URI, line: CLASS_LINE, character: 6 };
  for (const [label, call] of [
    ["no opts argument", (x) => x.extractor.membersOfType(defCursor, CORE.HOVER_FANOUT_BUDGET_MS)],
    ["an empty opts object", (x) => x.extractor.membersOfType(defCursor, CORE.HOVER_FANOUT_BUDGET_MS, {})],
  ]) {
    const t = makeTransport(FAT_N);
    const members = await call(t);
    assert.equal(
      members.length,
      FAT_N,
      `CONTROL (${label}) - the member SET is never capped, only the signatures are; got ${members.length} of ${FAT_N}`,
    );
    assert.equal(
      t.rec.fanoutCursors.size,
      CORE.HOVER_SIGNATURE_CAP,
      `${label}: a transport told nothing about the path spends HOVER_SIGNATURE_CAP ` +
        `(=${CORE.HOVER_SIGNATURE_CAP}); got ${t.rec.fanoutCursors.size}${dumpRec(t.rec)}`,
    );
    assert.equal(
      members.filter((m) => m.signature !== undefined).length,
      CORE.HOVER_SIGNATURE_CAP,
      `${label}: and exactly that many come back SIGNED - the asks and the signatures are one number`,
    );
  }
});

// ===========================================================================
// C51-4. CONTRACT CLAIM 4: "A cap is never raised past what the caller asked
// for. 48 is a cap, not a target."
// ===========================================================================

btest("C51-4a: a 12-member class buys 12 hovers on the pre-fill path, not PREFILL_HOVER_SIGNATURE_CAP", async () => {
  const t = makeTransport(SMALL_N);
  const r = await prefillOver(t);
  assert.ok(t.rec.memberCalls.length > 0, `CONTROL - the gesture must reach membersOfType${dumpRec(t.rec)}`);
  assert.deepEqual(
    [...new Set(t.rec.memberCalls.map((c) => c.signatureCap))],
    [CORE.PREFILL_HOVER_SIGNATURE_CAP],
    `CONTROL - the pre-fill must still be ASKING for PREFILL_HOVER_SIGNATURE_CAP, or this row is measuring a ` +
      `path with no cap on it${dumpRec(t.rec)}`,
  );
  assert.equal(
    t.rec.fanoutAsks,
    SMALL_N,
    `${SMALL_N} members means ${SMALL_N} round trips. ${t.rec.fanoutAsks} went out against a cap of ` +
      `PREFILL_HOVER_SIGNATURE_CAP (=${CORE.PREFILL_HOVER_SIGNATURE_CAP}): a cap read as a target sends ` +
      `${CORE.PREFILL_HOVER_SIGNATURE_CAP - SMALL_N} requests at nothing, against a server that answers one ` +
      `thing at a time.${dumpRec(t.rec)}`,
  );
  assert.equal(
    t.rec.fanoutCursors.size,
    t.rec.fanoutAsks,
    `and no member is asked about TWICE - a re-ask is a round trip the cap already paid for` + dumpRec(t.rec),
  );
  for (let i = 0; i < SMALL_N; i++) {
    assert.ok(signedIn(r.text, i), `${memberName(i)} is under both caps and must be in the block:\n${r.text}`);
  }
});

ctest("C51-4b: and the same on the FIM number - a 12-member class never spends HOVER_SIGNATURE_CAP asks", async () => {
  const t = makeTransport(SMALL_N);
  await walkOver(t, undefined);
  assert.ok(t.rec.memberCalls.length > 0, `CONTROL - the walk must reach membersOfType${dumpRec(t.rec)}`);
  assert.equal(
    t.rec.fanoutAsks,
    SMALL_N,
    `${t.rec.fanoutAsks} asks for ${SMALL_N} members under HOVER_SIGNATURE_CAP (=${CORE.HOVER_SIGNATURE_CAP})` +
      dumpRec(t.rec),
  );
});

// ===========================================================================
// C51-5. CONTRACT CLAIM 5: "The three non-hover transports are untouched. C#,
// Rust and Go spend no round trip here and the option changes nothing for them."
// ===========================================================================

ctest("C51-5a: a server that POPULATES `detail` spends zero hovers, and its member list is identical at cap 48, cap 32 and absent", async () => {
  // The mechanism the contract's claim rests on: Roslyn, rust-analyzer and gopls
  // fill documentSymbol `detail`, and a member that already carries a signature
  // is never asked about - so there is nothing for a cap to bound. Same fixture,
  // same seam, `detail` filled.
  const defCursor = { uri: URI, line: CLASS_LINE, character: 6 };
  const runs = [];
  for (const [label, opts] of [
    ["absent", undefined],
    ["HOVER_SIGNATURE_CAP", { signatureCap: CORE.HOVER_SIGNATURE_CAP }],
    ["PREFILL_HOVER_SIGNATURE_CAP", { signatureCap: CORE.PREFILL_HOVER_SIGNATURE_CAP }],
  ]) {
    const t = makeTransport(FAT_N, { withDetail: true });
    const members = await t.extractor.membersOfType(defCursor, CORE.HOVER_FANOUT_BUDGET_MS, opts);
    runs.push({ label, asks: t.rec.fanoutAsks, members });
  }
  const control = makeTransport(FAT_N);
  await control.extractor.membersOfType(defCursor, CORE.HOVER_FANOUT_BUDGET_MS, undefined);
  assert.ok(
    control.rec.fanoutAsks > 0,
    `CONTROL - the same fixture with EMPTY detail must buy hovers, or this row proves nothing about the ` +
      `difference detail makes${dumpRec(control.rec)}`,
  );

  for (const run of runs) {
    assert.equal(
      run.asks,
      0,
      `signatureCap=${run.label}: a transport whose server populated every \`detail\` must spend NO hover round ` +
        `trip. It spent ${run.asks}. "C#, Rust and Go spend no round trip here."`,
    );
    assert.equal(
      run.members.filter((m) => m.signature !== undefined).length,
      FAT_N,
      `signatureCap=${run.label}: and every one of the ${FAT_N} members is signed off \`detail\` alone`,
    );
  }
  assert.deepEqual(
    runs[1].members,
    runs[0].members,
    "the option changes nothing for them: HOVER_SIGNATURE_CAP and absent must return the identical member list",
  );
  assert.deepEqual(
    runs[2].members,
    runs[0].members,
    "and so must PREFILL_HOVER_SIGNATURE_CAP - a diff in the C#/Rust/Go leg is a stop, by the contract's own words",
  );
});

test("C51-5b: the hover fan-out seam exists in EXACTLY the three transports the contract names, and in no other", () => {
  // A static tripwire, and it is honest about being one: C51-5a proves the
  // mechanism, this proves the population. The contract names three files that
  // ask hovers and honour the cap, and says the rest ignore it; if a fourth
  // transport grew the seam, C51-5a would still pass and the contract would be
  // stale.
  const HOVER_TRANSPORTS = ["src/vscode/tsExtractor.ts", "src/vscode/pyExtractor.ts", "src/core/pyLspExtractor.ts"];
  const NON_HOVER_TRANSPORTS = [
    "src/vscode/csExtractor.ts",
    "src/vscode/goExtractor.ts",
    "src/vscode/raExtractor.ts",
    "src/core/csLspExtractor.ts",
    "src/core/goLspExtractor.ts",
  ];
  const root = path.join(__dirname, "..");
  const readsSeam = (rel) => {
    const p = path.join(root, rel);
    assert.ok(fs.existsSync(p), `${rel} must exist - the contract names this file by path`);
    return /membersWithHoverSignatures|hoverBackfillOptions/.test(fs.readFileSync(p, "utf8"));
  };
  for (const rel of HOVER_TRANSPORTS) {
    assert.ok(
      readsSeam(rel),
      `${rel} is one of the "three transports that ask hovers and honour the cap" and it does not reach the ` +
        `shared fan-out seam at all`,
    );
  }
  for (const rel of NON_HOVER_TRANSPORTS) {
    assert.equal(
      readsSeam(rel),
      false,
      `${rel} backs C#, Rust or Go. The contract says these "have \`detail\` populated by their servers, ask ` +
        `no hover at all, and ignore it" - a fan-out here is a round trip on a path that had none`,
    );
  }
});
