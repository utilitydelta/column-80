// BLIND ORACLE - session-v50 phase 3, "Python's field leg".
//
// Binds to the phase-3 contract and to nothing else. The four bodies
// the brief fences off were never opened: `pyFieldsFromMembers`,
// `pyFieldTypeCursor` and `pyRenderDerivedDef` in src/core/pyExtraction.ts, and
// `pyShapeBlock` in src/vscode/fnGen.ts. What WAS read, and only far enough to
// build a fixture a real transport would also satisfy: the exported
// `CompletionMember` and `HoverBackfillOptions` declarations in
// src/core/extraction.ts, the exported `CrossFileShapeHooks` and `DerivedType`
// declarations plus `PY_STD_TYPE_NAMES` in src/core/crossFileShape.ts, and the
// exported signatures of `resolvePrefill`, `prefillLangFor`,
// `resolveCrossFileShape`, `shapeHooksFor` and `membersWithHoverSignatures`.
//
// ---------------------------------------------------------------------------
// ONE FIXTURE DECISION THAT NEEDED A SOURCE, AND WHERE IT CAME FROM.
//
// C3-1 writes a field member's signature as `(variable) matcher: Matcher`. That
// is Pylance's QUICKINFO text, and the product's Python transport strips the
// `(variable) ` kind chrome before a member ever reaches the walk -
// `renderPyMemberSignature`'s own doc comment states the transform
// (`(variable) _lod: int` -> `_lod: int`). So the fixtures below hand the fake
// transport the POST-STRIP form, which is what `membersOfType` actually
// returns, and C3-1e binds the chromed form separately as its own row rather
// than letting a wording gap between the contract and the transport decide
// every other row in the file.
//
// ---------------------------------------------------------------------------
// THE LEFT-HAND SIDE, AND WHY IT COMES FROM A COMMIT.
//
// C3-3's first guard says "byte-identical to today", so it needs a left-hand
// side, and the working tree cannot supply one: while this file was being
// written, `prefillLangFor("python").dialReach` was observed as "signatures" in
// one run and "walk" in a run minutes later, and the rendered def head went
// from `Ledger:` to `class Ledger:` between the same two runs. A baseline
// scraped off a half-written build is the trap in the `measuring-a-moving-
// artifact` note.
//
// So the baseline is COMMIT 19f1e6f ("session-v49: Go's field leg, the C# seam,
// and three instrument repairs"), the tip of session-v49 and the last commit
// before session-v50. Method: `git archive 19f1e6f src | tar -x` into a scratch
// tree, point this file's entry imports at THAT src, and run the identical
// fixture code. At 19f1e6f Python reads `dialReach: "signatures"`, renders no
// data-shape block for any fixture here, and carries every field as a member
// line - which is the "today" C3-3 guard 1 is measured against.
//
// Only ONE product string is frozen: the member-block header form. Every member
// BODY line compared against is a signature this file's own fixture handed the
// extractor, so the baseline is built rather than transcribed.
//
// ---------------------------------------------------------------------------
// WHAT THE FIRST RUN FOUND, AND WHICH ROWS ARE DETECTORS.
//
// Every row was re-run against a tree whose src/ is 19f1e6f verbatim, so
// "would this row have caught the absence of phase 3" is a number rather than
// an opinion. 23 rows. 6 red on the working tree, 14 detectors, 3 tripwires.
//
// RED ON THE WORKING TREE, and every one of them is red at 19f1e6f too:
//
//   C3-2a/b/c/d  NO PYTHON FIELD ANCHORS AT ALL. The walk parses the fields and
//                then spends ZERO definition round trips on any of them: every
//                candidate goes straight onto `dropped`, for the annotated
//                shape, the constructor-call shape and the dataclass shape
//                alike. C3-2c prints `annotation rule: DROPPED; constructor-call
//                rule: DROPPED`, so this is not one rule missing, it is the hop
//                never firing. That is why this section is bound through the
//                facade and not through the cursor helper: a helper that answers
//                by hand and is never reached by the walk is the failure in the
//                `a-hooks-object-can-be-wired-to-nothing` note.
//   C3-3b        follows from the above. The chain renders `Depot` and stops;
//                nothing nests, because nothing anchors.
//   C3-1c        `Unknown` is a walk candidate. It rides inside
//                `DiGraph[Unknown, ...]` on every partially-inferred generic and
//                comes back on `dropped` alongside the real types. Costless
//                while nothing anchors; one wasted definition round trip per
//                such field the moment C3-2 lands.
//
// TRIPWIRES (green at 19f1e6f AND green now - their job is to stay green):
//   the bundle guard; C3-1e (the transport's kind chrome never becomes a field);
//   C3-3 guard 1 (no block, member list unchanged - free while nothing renders,
//   and it catches the build that sheds unconditionally).
//
// DETECTORS (red at 19f1e6f, green now): C3-1a, C3-1b, C3-1d, C3-2e, the C3-3
// criterion control, C3-3a, C3-3 guards 2, 3 and 4, C3-4a, C3-4b, C3-6a, C3-6b
// and C3-6c. Several of those are red at 19f1e6f on their own CONTROL rather
// than on the property, which is the honest shape: with no parsed fields there
// is nothing to shed and nothing to render, so a row that scored the shed would
// have been scoring an empty run.
//
// TWO STANDING NOTES, because they are properties of the file:
//
//   * C3-2c is the two-rule row. `self.x: T = ...` and `self.x = Foo()` are
//     structurally different and the fixture carries one of each, resolvable
//     only by its own rule: a build with rule 1 alone resolves `Matcher` and
//     loses `EventLog`, a build with rule 2 alone loses `Matcher`, and the row
//     prints which half answered so a report can quote it.
//   * C3-2e is satisfied for free while nothing anchors, and becomes
//     load-bearing the moment C3-2c goes green. Its own row says so.
//
// Nothing here needs a live language server, so SKIP_LIVE=1 changes nothing.
//
// Run: SKIP_LIVE=1 node --test test/blind-v50-p3-pyfields.test.cjs

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");

const show = (v) => JSON.stringify(v);
const B = (s) => Buffer.byteLength(String(s), "utf8");

// ===========================================================================
// HARNESS A. The walk, bundled pure. No vscode anywhere on this path.
// ===========================================================================

const A_ENTRY = path.join(__dirname, ".blind-v50-p3-walk.entry.ts");
const A_OUT = path.join(__dirname, ".blind-v50-p3-walk.bundle.cjs");
let WALK = {};
let walkErr;
try {
  fs.writeFileSync(
    A_ENTRY,
    `export { resolveCrossFileShape, shapeHooksFor, PY_STD_TYPE_NAMES } from "../src/core/crossFileShape";
export { membersWithHoverSignatures, HOVER_SIGNATURE_CAP, HOVER_FANOUT_BUDGET_MS } from "../src/core/extraction";\n`,
  );
  esbuild.buildSync({ entryPoints: [A_ENTRY], bundle: true, outfile: A_OUT, format: "cjs", platform: "node" });
  WALK = require(A_OUT);
} catch (e) {
  walkErr = e;
}

// ===========================================================================
// HARNESS B. `resolvePrefill` and the exported language table, bundled headless
// against a STRUCTURAL vscode stub. Stub mechanics copied verbatim from
// test/blind-v50-p2-csrender.test.cjs, which took them from
// test/blind-v49-p1-go-fields.test.cjs; the output channel is a REAL object
// because resolvePrefill leaves background work in flight and a straggler that
// logs into `{}` throws after the row that started it has ended.
// ===========================================================================

const STUB = path.join(__dirname, ".blind-v50-p3-vscode-stub.cjs");
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
    getConfiguration: () => ({
      get: (k, f) => {
        const c = globalThis.__V50P3_CFG__ || {};
        return Object.prototype.hasOwnProperty.call(c, k) ? c[k] : f;
      },
      has: () => false, inspect: () => undefined, update: async () => {},
    }),
    openTextDocument: (arg) =>
      Promise.resolve({ uri: mkUri(keyOf(arg)), getText: () => (globalThis.__V50P3_FILES__ || {})[keyOf(arg)] }),
  },
};
`,
);

const B_ENTRY = path.join(__dirname, ".blind-v50-p3-fn.entry.ts");
const B_OUT = path.join(__dirname, ".blind-v50-p3-fn.bundle.cjs");
let FN = {};
let fnErr;
try {
  fs.writeFileSync(B_ENTRY, `export { resolvePrefill, prefillLangFor } from "../src/vscode/fnGen";\n`);
  esbuild.buildSync({
    entryPoints: [B_ENTRY],
    bundle: true,
    outfile: B_OUT,
    format: "cjs",
    platform: "node",
    alias: { vscode: STUB },
  });
  FN = require(B_OUT);
} catch (e) {
  fnErr = e;
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
const wtest = (name, fn) =>
  test(name, (ctx) => {
    if (walkErr) assert.fail(`the crossFileShape/extraction bundle did not build: ${walkErr.message}`);
    assert.equal(typeof WALK.resolveCrossFileShape, "function", "resolveCrossFileShape must be exported");
    return fn(ctx);
  });
const ftest = (name, fn) =>
  test(name, (ctx) => {
    if (fnErr) assert.fail(`the fnGen bundle did not build: ${fnErr.message}`);
    assert.equal(typeof FN.resolvePrefill, "function", "resolvePrefill must be exported from src/vscode/fnGen");
    return fn(ctx);
  });

test("guard: both bundles build headless and every entry point this file drives is exported", () => {
  if (walkErr) assert.fail(`crossFileShape/extraction bundle failed: ${walkErr.message}`);
  if (fnErr) assert.fail(`fnGen bundle failed: ${fnErr.message}`);
  for (const n of ["resolveCrossFileShape", "shapeHooksFor", "membersWithHoverSignatures"]) {
    assert.equal(typeof WALK[n], "function", `${n} must be exported`);
  }
  for (const n of ["resolvePrefill", "prefillLangFor"]) {
    assert.equal(typeof FN[n], "function", `${n} must be exported from src/vscode/fnGen`);
  }
  assert.ok(WALK.shapeHooksFor("python"), "the Python hooks must resolve - the contract names them as the resolver half");
});

// ===========================================================================
// THE TRANSPORT FIXTURE.
//
// A pyright class hover is `(class) Foo` and carries no field body, so no
// fixture below invents one. The fields arrive on `membersOfType`, written
// `name: Type`, which is the form `renderPyMemberSignature` produces. The fake
// transport answers from the fixture's own table keyed by the word under the
// cursor, which is how a real server behaves: the walk hands it a POSITION, and
// every call is recorded WITH ITS CURSOR so a row can say exactly where an
// anchor landed - which is what C3-2 is about.
// ===========================================================================

const URI = "file:///w/v50p3/app.py";
const F = (name, typeName, declLine) => ({ name, kind: "field", signature: `${name}: ${typeName}`, declLine });
const Fbare = (name, declLine) => ({ name, kind: "field", declLine });
const M = (name, signature) => ({ name, kind: "method", signature });

const wordAt = (text, cursor) => {
  const line = (text || "").split("\n")[cursor.line] ?? "";
  const isWord = (ch) => /[A-Za-z0-9_]/.test(ch);
  let s = Math.min(cursor.character, line.length);
  let e = s;
  while (s > 0 && isWord(line[s - 1])) s--;
  while (e < line.length && isWord(line[e])) e++;
  return e > s ? line.slice(s, e) : undefined;
};

function pyExtractor(fix, src, calls) {
  const lines = src.split("\n");
  const known = new Set(Object.keys(fix.members));
  const typeAt = (c) => {
    const w = wordAt(src, c);
    return w && known.has(w) ? w : undefined;
  };
  const declLineOf = (t) => lines.findIndex((l) => new RegExp(`^\\s*class ${t}\\b`).test(l));
  return {
    definition: async (c) => {
      const word = wordAt(src, c);
      const t = typeAt(c);
      calls.push({ op: "definition", word, line: c.line, character: c.character });
      if (!t) return undefined;
      const ln = declLineOf(t);
      if (ln < 0) return undefined;
      const ch = lines[ln].indexOf(t);
      return { uri: URI, range: { startLine: ln, startCharacter: ch, endLine: ln, endCharacter: ch + t.length } };
    },
    hoverSurface: async (c) => {
      const t = typeAt(c);
      calls.push({ op: "hover", word: wordAt(src, c), t });
      return t && fix.hovers[t] ? { signature: fix.hovers[t] } : undefined;
    },
    membersOfType: async (c) => {
      const t = typeAt(c);
      calls.push({ op: "members", t });
      return t ? (fix.members[t] || []).map((m) => ({ ...m })) : [];
    },
    example: async () => undefined,
    completeMembers: async () => [],
    qualifyImport: async () => undefined,
  };
}

// The gesture the prompt rows drive: the declarations, a docstring, and a
// function to fill whose parameter names the root.
const srcOf = (fix) =>
  fix.decls
    .concat(["", `def build(p0: ${fix.root}) -> int:`, '    """Rebuild the registry."""', "    raise NotImplementedError", ""])
    .join("\n");

const hoversFor = (fix) => Object.fromEntries(Object.keys(fix.members).map((t) => [t, `(class) ${t}`]));

// Depth 2, which is what C3-3 renders to. The total-type bound is generous so no
// row below is bounded by the fixture rather than by the property it tests.
const BOUND = { D_MAX: 2, N_MAX: 24 };
const pyHooks = () => WALK.shapeHooksFor("python");
const keys = (shape) => [...shape.types.keys()];
const fieldsOf = (shape, name) => (shape.types.get(name)?.fields ?? []).map((f) => ({ name: f.name, typeName: f.typeName }));
const fieldNames = (shape, name) => fieldsOf(shape, name).map((f) => f.name);

// Drive the walk itself, through the facade the contract names.
function walkRun(fix) {
  const src = srcOf(fix);
  const calls = [];
  const extractor = pyExtractor({ ...fix, hovers: fix.hovers ?? hoversFor(fix) }, src, calls);
  const lines = src.split("\n");
  const anchorLine = lines.findIndex((l) => l.startsWith("def build("));
  return {
    src,
    calls,
    anchors: (name) => calls.filter((c) => c.op === "definition" && c.word === name),
    spent: (name) => calls.filter((c) => c.op === "definition" && c.word === name).length,
    shape: () =>
      WALK.resolveCrossFileShape(
        extractor,
        { uri: URI, line: anchorLine, character: lines[anchorLine].indexOf(fix.root) },
        BOUND,
        async (u) => (u === URI ? src : undefined),
        pyHooks(),
      ),
  };
}

const dumpWalk = (shape, r) =>
  `\n  types: ${show(keys(shape))}` +
  `\n  dropped: ${show(shape.dropped)}` +
  `\n  fields: ${show(Object.fromEntries(keys(shape).map((k) => [k, fieldsOf(shape, k)])))}` +
  `\n  round trips: ${show(r.calls.filter((c) => c.op === "definition").map((c) => `${c.word}@${c.line}:${c.character}`))}`;

// ===========================================================================
// THE FIXTURES.
// ===========================================================================

// ---------------------------------------------------------------------------
// TRANSPORT. C3-1's fixture, and its member signatures are the contract's own
// three worked examples with the transport's kind chrome stripped. `Unknown` is
// pyright's placeholder and rides inside the `DiGraph[...]` argument list
// exactly the way the contract writes it.
// ---------------------------------------------------------------------------

const FIX_TRANSPORT = {
  root: "GraphEngine",
  decls: [
    /*  0 */ "class Matcher:",
    /*  1 */ "    def __init__(self) -> None:",
    /*  2 */ '        self.pattern: str = ""',
    /*  3 */ "",
    /*  4 */ "class Event:",
    /*  5 */ "    def __init__(self) -> None:",
    /*  6 */ '        self.kind: str = ""',
    /*  7 */ "",
    /*  8 */ "class GraphEngine:",
    /*  9 */ "    def __init__(self) -> None:",
    /* 10 */ "        self.matcher: Matcher = _make()",
    /* 11 */ "        self._events: list[Event] = []",
    /* 12 */ "        self.graph = _build()",
    /* 13 */ "        self.mode: Optional[str] = None",
    /* 14 */ "        self.opaque = _opaque()",
  ],
  members: {
    GraphEngine: [
      F("matcher", "Matcher", 10),
      F("_events", "list[Event]", 11),
      F("graph", "DiGraph[Unknown, dict[str, Any], dict[str, Any]]", 12),
      F("mode", "Optional[str]", 13),
      // A member the transport could not sign. C3-1: "A member with no signature
      // yields no field."
      Fbare("opaque", 14),
      M("run", "run(n: int) -> bool"),
    ],
    Matcher: [F("pattern", "str", 2)],
    Event: [F("kind", "str", 6)],
  },
};

// ---------------------------------------------------------------------------
// TWORULES. C3-2's fixture, and the whole point of the file.
//
//   line 10  `self.matcher: Matcher = _make()`   ANNOTATION. The type token
//            sits after the colon; the callee is `_make` and names no type.
//   line 11  `self.events = EventLog()`          CONSTRUCTOR CALL. There is no
//            colon at all; the token that resolves is the callee.
//
// A build that knows only rule 1 resolves `Matcher` and drops `EventLog`. A
// build that knows only rule 2 does the reverse. Only a build with both
// resolves both, which is what C3-2c scores.
// ---------------------------------------------------------------------------

const FIX_TWORULES = {
  root: "Engine",
  decls: [
    /*  0 */ "class Matcher:",
    /*  1 */ "    def __init__(self) -> None:",
    /*  2 */ '        self.pattern: str = ""',
    /*  3 */ "",
    /*  4 */ "class EventLog:",
    /*  5 */ "    def __init__(self) -> None:",
    /*  6 */ '        self.tag: str = ""',
    /*  7 */ "",
    /*  8 */ "class Engine:",
    /*  9 */ "    def __init__(self) -> None:",
    /* 10 */ "        self.matcher: Matcher = _make()",
    /* 11 */ "        self.events = EventLog()",
    /* 12 */ "        self.count: int = 0",
  ],
  members: {
    Engine: [F("matcher", "Matcher", 10), F("events", "EventLog", 11), F("count", "int", 12)],
    Matcher: [F("pattern", "str", 2)],
    EventLog: [F("tag", "str", 6)],
  },
};
const TWORULES_ANNOTATED_LINE = 10;
const TWORULES_CALL_LINE = 11;

// ---------------------------------------------------------------------------
// DATACLASS. C3-2's third shape: "A `@dataclass` body (`position: int`) anchors
// like shape 1." The declaration is at class scope with no `self.` prefix.
// ---------------------------------------------------------------------------

const FIX_DATACLASS = {
  root: "Marker",
  decls: [
    /*  0 */ "from dataclasses import dataclass",
    /*  1 */ "",
    /*  2 */ "class Coord:",
    /*  3 */ "    def __init__(self) -> None:",
    /*  4 */ "        self.x: int = 0",
    /*  5 */ "",
    /*  6 */ "@dataclass",
    /*  7 */ "class Marker:",
    /*  8 */ "    position: Coord",
    /*  9 */ "    label: str",
  ],
  members: {
    Marker: [F("position", "Coord", 8), F("label", "str", 9)],
    Coord: [F("x", "int", 4)],
  },
};
const DATACLASS_FIELD_LINE = 8;

// ---------------------------------------------------------------------------
// SHADOW. C3-2's last clause: a field whose candidate token is nowhere on its
// own declaration line. SYNTHETIC and deliberately so - the divergence is
// manufactured by having the transport report a type the source line does not
// spell, which is what an outlived buffer or a re-exported name looks like.
// ---------------------------------------------------------------------------

const FIX_SHADOW = {
  root: "Engine",
  decls: [
    /*  0 */ "class Matcher:",
    /*  1 */ "    def __init__(self) -> None:",
    /*  2 */ '        self.pattern: str = ""',
    /*  3 */ "",
    /*  4 */ "class Hidden:",
    /*  5 */ "    def __init__(self) -> None:",
    /*  6 */ '        self.tag: str = ""',
    /*  7 */ "",
    /*  8 */ "class Engine:",
    /*  9 */ "    def __init__(self) -> None:",
    /* 10 */ "        self.matcher: Matcher = _make()",
    /* 11 */ "        self.shadow = _elsewhere()",
  ],
  members: {
    Engine: [F("matcher", "Matcher", 10), F("shadow", "Hidden", 11)],
    Matcher: [F("pattern", "str", 2)],
    Hidden: [F("tag", "str", 6)],
  },
};

// ---------------------------------------------------------------------------
// BODY. The C3-3 workhorse. Four deliberate traps in one file:
//
//   * `owner` is a FIELD of the root AND a METHOD of the collaborator. A shed
//     that matches names globally, or matches a member line's first token
//     against the WRONG type's field list, loses `owner(n: int) -> bool`.
//   * `name_of(n: int) -> str` is a method of the root whose name STARTS with
//     the root's field `name`. A prefix match sheds a callable.
//   * `describe(owner: Party) -> str` carries a field name inside its text. A
//     shed that scans the member text rather than matching the first token
//     against the parsed field list loses it.
//   * `Ghost` is declared in the same file and named by nothing. The walk never
//     reaches it, so the block must never render it.
// ---------------------------------------------------------------------------

const FIX_BODY = {
  root: "Ledger",
  decls: [
    /*  0 */ "class Address:",
    /*  1 */ "    def __init__(self) -> None:",
    /*  2 */ '        self.line1: str = ""',
    /*  3 */ "",
    /*  4 */ "class Party:",
    /*  5 */ "    def __init__(self) -> None:",
    /*  6 */ "        self.addr = Address()",
    /*  7 */ '        self.label: str = ""',
    /*  8 */ "",
    /*  9 */ "    def owner(self, n: int) -> bool:",
    /* 10 */ "        return True",
    /* 11 */ "",
    /* 12 */ "class Ghost:",
    /* 13 */ "    def __init__(self) -> None:",
    /* 14 */ '        self.boo: str = ""',
    /* 15 */ "",
    /* 16 */ "class Ledger:",
    /* 17 */ "    def __init__(self) -> None:",
    /* 18 */ "        self.owner: Party = _make()",
    /* 19 */ '        self.name: str = ""',
    /* 20 */ "",
    /* 21 */ "    def name_of(self, n: int) -> str:",
    /* 22 */ '        return ""',
    /* 23 */ "",
    /* 24 */ "    def settle(self, amount: int) -> bool:",
    /* 25 */ "        return True",
    /* 26 */ "",
    /* 27 */ "    def describe(self, owner: Party) -> str:",
    /* 28 */ '        return ""',
  ],
  members: {
    Ledger: [
      F("owner", "Party", 18),
      F("name", "str", 19),
      M("name_of", "name_of(n: int) -> str"),
      M("settle", "settle(amount: int) -> bool"),
      M("describe", "describe(owner: Party) -> str"),
    ],
    Party: [F("addr", "Address", 6), F("label", "str", 7), M("owner", "owner(n: int) -> bool")],
    Address: [F("line1", "str", 2)],
    // Present so a render that reached Ghost COULD render something for it. It
    // must not: nothing names Ghost as a field type or in a signature.
    Ghost: [F("boo", "str", 14)],
  },
};

// ---------------------------------------------------------------------------
// NOFIELDS. Every member is a method, so the walk parses no fields and C3-3
// guard 1's condition is constructed rather than hoped for.
// ---------------------------------------------------------------------------

const FIX_NOFIELDS = {
  root: "Kiosk",
  decls: [
    "class Kiosk:",
    "    def open(self, slot: int) -> bool:",
    "        return True",
    "",
    "    def tally(self) -> int:",
    "        return 0",
  ],
  members: { Kiosk: [M("open", "open(slot: int) -> bool"), M("tally", "tally() -> int")] },
};

// ---------------------------------------------------------------------------
// WIDE. C3-3's fourth guard, in the form that is TRUE FOR PYTHON.
//
// Go's guard is "a truncated own-def sheds nothing", and it needs a truncated
// own-def: a gopls struct hover is a brace body and the walk cuts it at a field
// boundary, leaving a `... N more fields` marker. A Python def has no braces -
// it is synthesised from the parsed field list - so there is no partial form to
// cut to, and the walk emits it ATOMICALLY: whole, or not at all. The guard
// binds in that shape below, and it protects the same property Go's does, which
// is that a field is never cut from the shape block AND from the member list at
// the same time.
// ---------------------------------------------------------------------------

const WIDE_N = 90;
const wideField = (i) => `fa${String(i).padStart(2, "0")}`;
const FIX_WIDE = {
  root: "Ledger",
  decls: ["class Ledger:", "    def __init__(self) -> None:"]
    .concat(Array.from({ length: WIDE_N }, (_, i) => `        self.${wideField(i)}: str = ""`))
    .concat(["", "    def settle(self, amount: int) -> bool:", "        return True"]),
  members: {
    Ledger: Array.from({ length: WIDE_N }, (_, i) => F(wideField(i), "str", 2 + i)).concat([
      M("settle", "settle(amount: int) -> bool"),
    ]),
  },
};

// ---------------------------------------------------------------------------
// CHAIN. C3-3's depth clause: Depot -> Sensor -> Job -> JobState, so `JobState`
// sits one hop past a depth-2 frontier. Every link is a CONSTRUCTOR CALL below
// the root, so the chain is unreachable at all without C3-2's second rule.
// ---------------------------------------------------------------------------

const FIX_CHAIN = {
  root: "Depot",
  decls: [
    /*  0 */ "class JobState:",
    /*  1 */ "    def __init__(self) -> None:",
    /*  2 */ '        self.label: str = ""',
    /*  3 */ "",
    /*  4 */ "class Job:",
    /*  5 */ "    def __init__(self) -> None:",
    /*  6 */ "        self.state = JobState()",
    /*  7 */ "",
    /*  8 */ "class Sensor:",
    /*  9 */ "    def __init__(self) -> None:",
    /* 10 */ "        self.current = Job()",
    /* 11 */ "",
    /* 12 */ "class Depot:",
    /* 13 */ "    def __init__(self) -> None:",
    /* 14 */ "        self.probe: Sensor = _make()",
    /* 15 */ "        self.count: int = 0",
  ],
  members: {
    Depot: [F("probe", "Sensor", 14), F("count", "int", 15), M("refresh", "refresh() -> bool")],
    Sensor: [F("current", "Job", 10)],
    Job: [F("state", "JobState", 6)],
    JobState: [F("label", "str", 2)],
  },
};

// A type is EMITTED when its OWN body was rendered, which is not the same as its
// name appearing: `state: JobState` names `JobState` while emitting nothing for
// it. The tell that needs no guess at the product's def wording is the type's
// own field, which only its own body can carry.
const CHAIN_OWN_FIELD = { Depot: "probe", Sensor: "current", Job: "state", JobState: "label" };
const emittedChain = (text) =>
  Object.keys(CHAIN_OWN_FIELD).filter((t) => new RegExp(`\\b${CHAIN_OWN_FIELD[t]}\\b`).test(String(text)));

// ===========================================================================
// THE PROMPT HARNESS.
// ===========================================================================

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
    return new V.Position(Math.max(lines.length - 1, 0), 0);
  };
  return {
    uri: { toString: () => uriStr },
    offsetAt,
    positionAt,
    getText: (r) => (r ? text.slice(offsetAt(r.start), offsetAt(r.end)) : text),
  };
}

async function pyGesture(fix) {
  const src = srcOf(fix);
  const signature = `def build(p0: ${fix.root}) -> int:`;
  const record = {
    span: { start: src.indexOf(signature), end: src.length - 1 },
    signature,
    docComment: "Rebuild the registry.",
    symbolName: "build",
    languageId: "python",
    kind: "function",
    bodyOnly: false,
    headerIndent: "",
    bodyIndent: "    ",
  };
  const logs = [];
  const calls = [];
  // MERGED, never replaced: resolvePrefill leaves background work in flight and
  // a straggler that finds the file map gone reports as an unhandled rejection
  // after the row that started it has ended.
  globalThis.__V50P3_FILES__ = { ...(globalThis.__V50P3_FILES__ || {}), [URI]: src };
  const out = await FN.resolvePrefill(
    pyExtractor({ ...fix, hovers: fix.hovers ?? hoversFor(fix) }, src, calls),
    makeDoc(src, URI),
    record,
    (l) => logs.push(String(l)),
  );
  return { text: out || "", logs, calls, src, fix };
}

const sectionOf = (text, lead, typeName) => {
  const re = new RegExp(`^${lead}[^\\n]*\`${typeName}\`[^\\n]*:\\n\`\`\`[a-z]*\\n[\\s\\S]*?\\n\`\`\``, "m");
  const m = re.exec(String(text));
  return m ? m[0] : undefined;
};
const memberSection = (text, typeName) => sectionOf(text, "Members of ", typeName);
const shapeSection = (text, typeName) => sectionOf(text, "Data shape of ", typeName);
const anyShapeBlock = (text) => /^Data shape of /m.test(String(text));
const bodyLines = (section) => (section ? section.split("\n").slice(2, -1) : undefined);
const firstToken = (line) => (String(line).trim().match(/^[A-Za-z_][A-Za-z0-9_]*/) || [""])[0];
const dumpPrompt = (r) =>
  `\n--- PROMPT (${B(r.text)}B) ---\n${r.text || "(empty)"}\n--- CHANNEL ---\n${r.logs.join("\n") || "(silent)"}\n---`;

// ---------------------------------------------------------------------------
// THE PRE-PHASE-3 BASELINE, commit 19f1e6f. See the file header for the method.
//
// One frozen product string: the member-block header. The BODY is this file's
// own fixture signatures in the order the fixture handed them over, capped at
// the first `memberCap` - which is what a member block was at 19f1e6f for every
// fixture here, verified by running them there.
// ---------------------------------------------------------------------------

const HEAD_MEMBER_HEADER = (t) => `Members of \`${t}\` (real signatures, use these exact names, do not invent):`;
const HEAD_SUBSET_HEADER = (t, kept, total) =>
  `Members of \`${t}\` (a subset — the first ${kept} of ${total}; real signatures, use these exact names, do not invent):`;
const HEAD_MEMBER_CAP = 48; // the `members=48` the channel prints at the install-default `small` stop

const headMemberSection = (fix, typeName) => {
  const all = fix.members[typeName].filter((m) => m.signature !== undefined).map((m) => m.signature);
  const head =
    all.length > HEAD_MEMBER_CAP ? HEAD_SUBSET_HEADER(typeName, HEAD_MEMBER_CAP, all.length) : HEAD_MEMBER_HEADER(typeName);
  return [head, "```python", ...all.slice(0, HEAD_MEMBER_CAP), "```"].join("\n");
};

// ===========================================================================
// SECTION C3-1. Pass 1, a type per field.
// ===========================================================================

wtest("C3-1a: every field member's type is parsed off its signature, in MEMBER ORDER, as written", async () => {
  const r = walkRun(FIX_TRANSPORT);
  const shape = await r.shape();
  assert.ok(shape.types.has("GraphEngine"), `CONTROL - the root must resolve at all${dumpWalk(shape, r)}`);
  const got = fieldsOf(shape, "GraphEngine");
  assert.ok(
    got.length > 0,
    `Python derived NO fields from a member list carrying four signed field members. "pyShapeHooks.parseFields ` +
      `returns those fields with their parsed types, in member order."${dumpWalk(shape, r)}`,
  );
  // The contract's own three worked examples, plus one `typing` case.
  for (const [name, typeName] of [
    ["matcher", "Matcher"],
    ["_events", "list[Event]"],
    ["graph", "DiGraph[Unknown, dict[str, Any], dict[str, Any]]"],
    ["mode", "Optional[str]"],
  ]) {
    const hit = got.find((x) => x.name === name);
    assert.ok(hit, `the field ${show(name)} is missing; derived ${show(got.map((x) => x.name))}${dumpWalk(shape, r)}`);
    assert.equal(
      hit.typeName,
      typeName,
      `${name}: the type must be the type AS WRITTEN. A parse that normalises the generic or drops its ` +
        `arguments cannot anchor the hop at the token it names`,
    );
  }
  // MEMBER ORDER, which is the order the transport handed them over.
  const order = ["matcher", "_events", "graph", "mode"].map((n) => got.findIndex((x) => x.name === n));
  assert.deepEqual(
    [...order].sort((a, b) => a - b),
    order,
    `member order: the four appear at ${show(order)} in ${show(got.map((x) => x.name))}`,
  );
});

wtest("C3-1b: a member with no signature yields no field, and a method yields no field", async () => {
  const r = walkRun(FIX_TRANSPORT);
  const shape = await r.shape();
  const got = fieldsOf(shape, "GraphEngine");
  assert.ok(got.length > 0, `CONTROL - the parse must have produced fields${dumpWalk(shape, r)}`);
  assert.equal(
    got.some((x) => x.name === "opaque"),
    false,
    `\`opaque\` arrived with no signature at all. "A member with no signature yields no field." A field with ` +
      `no type is a name the block would print with nothing after the colon.${dumpWalk(shape, r)}`,
  );
  assert.equal(
    got.some((x) => x.name === "run"),
    false,
    `\`run\` is a METHOD. A method read as a field puts a callable in the data shape block, where the model ` +
      `reads it as an attribute.${dumpWalk(shape, r)}`,
  );
});

wtest("C3-1c: a std/`typing` name is never a walk candidate, and `Unknown` is pyright chrome", async () => {
  const r = walkRun(FIX_TRANSPORT);
  const shape = await r.shape();
  assert.ok(fieldsOf(shape, "GraphEngine").length > 0, `CONTROL - the parse must have produced fields${dumpWalk(shape, r)}`);
  // A candidate is a name the walk SPENDS a round trip on and then either emits
  // or reports. A non-candidate does neither, so this is the honest test of
  // "never becomes a candidate" without naming a private function.
  const touched = (name) => shape.types.has(name) || (shape.dropped ?? []).includes(name) || r.spent(name) > 0;
  for (const std of ["Optional", "Any", "Dict"]) {
    assert.equal(
      touched(std),
      false,
      `${show(std)} is a \`typing\` name in PY_STD_TYPE_NAMES and the walk touched it. Every one of these ` +
        `spends a slot the real graph needed.${dumpWalk(shape, r)}`,
    );
  }
  assert.equal(
    touched("Unknown"),
    false,
    `"\`Unknown\` is pyright's own placeholder and never becomes a candidate." It rides inside ` +
      `\`DiGraph[Unknown, ...]\` on every partially-inferred generic pyright reports, so a walk that treats it ` +
      `as a type name buys a definition round trip per such field and lands on nothing.${dumpWalk(shape, r)}`,
  );
});

wtest("C3-1d: a generic's ARGUMENT is a candidate - `list[Event]` reaches `Event`", async () => {
  const r = walkRun(FIX_TRANSPORT);
  const shape = await r.shape();
  assert.ok(fieldsOf(shape, "GraphEngine").length > 0, `CONTROL - the parse must have produced fields${dumpWalk(shape, r)}`);
  // Bound as "the walk took it up", not "the walk resolved it": whether the hop
  // lands is C3-2's question. A candidate is emitted, or reported as dropped, or
  // paid for with a round trip. A NON-candidate is none of the three, which is
  // what C3-1c holds `Unknown` to - so the two rows read as a pair.
  const touched = (name) => shape.types.has(name) || (shape.dropped ?? []).includes(name) || r.spent(name) > 0;
  assert.ok(
    touched("Event"),
    `"A generic's arguments are candidates the same way every other language treats them: \`list[Event]\` ` +
      `reaches \`Event\`." The container name is std and the argument is the project type; a parse that stops ` +
      `at the container walks nothing on a codebase that holds its collaborators in lists.${dumpWalk(shape, r)}`,
  );
  assert.ok(
    touched("DiGraph"),
    `and \`DiGraph\`, the generic HEAD of a non-std type, is a candidate too${dumpWalk(shape, r)}`,
  );
});

wtest("C3-1e: the transport's kind chrome never becomes a field named `variable`", async () => {
  // C3-1 writes the signature as `(variable) matcher: Matcher`, which is
  // Pylance's quickinfo text. The product's transport strips that chrome before
  // the member reaches the walk (`renderPyMemberSignature`). This row does not
  // decide which form the parse must accept - it holds the floor that matters
  // either way: the chrome must never be read as a declaration.
  const fix = {
    root: "Chrome",
    decls: ["class Chrome:", "    def __init__(self) -> None:", "        self.matcher: Matcher = _make()"],
    members: { Chrome: [{ name: "matcher", kind: "field", signature: "(variable) matcher: Matcher", declLine: 2 }] },
  };
  const r = walkRun(fix);
  const shape = await r.shape();
  assert.ok(shape.types.has("Chrome"), `CONTROL - the root must resolve${dumpWalk(shape, r)}`);
  const got = fieldsOf(shape, "Chrome");
  for (const bad of ["variable", "class", "method", "property"]) {
    assert.equal(
      got.some((x) => x.name === bad || x.typeName === bad),
      false,
      `${show(bad)} is Pylance's UI kind annotation, not part of any declaration, and it came back as a ` +
        `field.${dumpWalk(shape, r)}`,
    );
  }
  // eslint-disable-next-line no-console
  console.log(`  [C3-1e] the chromed form \`(variable) matcher: Matcher\` parses to: ${show(got)}`);
});

// ===========================================================================
// SECTION C3-2. Pass 2, a cursor per field, and it is TWO rules.
//
// Bound through the FACADE the contract names, never by calling the cursor
// helper directly. A helper that answers correctly by hand and is never reached
// by the walk is the `a-hooks-object-can-be-wired-to-nothing` failure, and a
// direct call cannot see it.
// ===========================================================================

wtest("C3-2a: SHAPE 1, `self.x: T = ...` - the anchor lands on the type token AFTER the colon", async () => {
  const r = walkRun(FIX_TWORULES);
  const shape = await r.shape();
  assert.ok(
    fieldNames(shape, "Engine").includes("matcher"),
    `CONTROL - the field must be parsed before it can be anchored${dumpWalk(shape, r)}`,
  );
  const hits = r.anchors("Matcher");
  assert.ok(
    hits.length > 0,
    `no cursor was ever placed on \`Matcher\` in \`self.matcher: Matcher = _make()\`. "The hop anchors on the ` +
      `declaration line ... The type token sits after the colon."${dumpWalk(shape, r)}`,
  );
  const line = FIX_TWORULES.decls[TWORULES_ANNOTATED_LINE];
  const tokenAt = line.indexOf("Matcher");
  const colonAt = line.indexOf(":");
  for (const hit of hits) {
    assert.equal(hit.uri ?? URI, URI, "the cursor must be in the type's own declaring file");
    assert.equal(
      hit.line,
      TWORULES_ANNOTATED_LINE,
      `the cursor must be on the field's OWN declaration line (${TWORULES_ANNOTATED_LINE}, ${show(line)}); got ` +
        `line ${hit.line}`,
    );
    assert.ok(
      hit.character >= tokenAt && hit.character < tokenAt + "Matcher".length,
      `the cursor must be INSIDE the annotation token. \`Matcher\` occupies columns ${tokenAt}..` +
        `${tokenAt + "Matcher".length}; the cursor was at ${hit.character}`,
    );
    assert.ok(
      hit.character > colonAt,
      `and AFTER the colon at column ${colonAt}. The lowercase \`matcher\` before it is the ATTRIBUTE, and a ` +
        `cursor there resolves the attribute rather than its type`,
    );
  }
  assert.ok(shape.types.has("Matcher"), `and the annotated collaborator must reach the shape${dumpWalk(shape, r)}`);
});

wtest("C3-2b: SHAPE 2, `self.x = Foo()` - a CONSTRUCTOR CALL anchors on the CALLEE", async () => {
  // The row the contract calls out by name: "A cursor rule that only knows shape
  // 1 silently drops every un-annotated field, and the largest real Python class
  // on this box is shape 2." There is no colon on this line at all, so a rule
  // written for shape 1 finds nothing and the field goes dark.
  const r = walkRun(FIX_TWORULES);
  const shape = await r.shape();
  assert.ok(
    fieldNames(shape, "Engine").includes("events"),
    `CONTROL - the field must be parsed before it can be anchored${dumpWalk(shape, r)}`,
  );
  const hits = r.anchors("EventLog");
  assert.ok(
    hits.length > 0,
    `no cursor was ever placed on \`EventLog\` in \`self.events = EventLog()\`. That line has NO COLON: ` +
      `"There is no type after a colon to find, and the token that resolves is the callee." A build that only ` +
      `knows the annotation shape drops every un-annotated attribute in the codebase.${dumpWalk(shape, r)}`,
  );
  const line = FIX_TWORULES.decls[TWORULES_CALL_LINE];
  const calleeAt = line.indexOf("EventLog");
  for (const hit of hits) {
    assert.equal(
      hit.line,
      TWORULES_CALL_LINE,
      `the cursor must be on the field's OWN declaration line (${TWORULES_CALL_LINE}, ${show(line)}); got line ${hit.line}`,
    );
    assert.ok(
      hit.character >= calleeAt && hit.character < calleeAt + "EventLog".length,
      `the cursor must be INSIDE the callee token. \`EventLog\` occupies columns ${calleeAt}..` +
        `${calleeAt + "EventLog".length}; the cursor was at ${hit.character}`,
    );
  }
  assert.ok(shape.types.has("EventLog"), `and the constructed collaborator must reach the shape${dumpWalk(shape, r)}`);
});

wtest("C3-2c: BOTH rules exist - one class, one annotated field and one constructed field, both resolve", async () => {
  // THE TWO-RULE ROW. Rule 1 alone resolves Matcher and loses EventLog; rule 2
  // alone does the reverse. Only both resolve both, and the row prints which
  // half answered so a report can quote it rather than infer it.
  const r = walkRun(FIX_TWORULES);
  const shape = await r.shape();
  const derived = fieldNames(shape, "Engine");
  assert.deepEqual(
    derived,
    ["matcher", "events", "count"],
    `CONTROL - all three fields must be parsed, or this row is measuring an empty parse${dumpWalk(shape, r)}`,
  );
  const annotated = shape.types.has("Matcher");
  const constructed = shape.types.has("EventLog");
  // eslint-disable-next-line no-console
  console.log(
    `  [C3-2c] annotation rule: ${annotated ? "RESOLVED" : "DROPPED"}; constructor-call rule: ` +
      `${constructed ? "RESOLVED" : "DROPPED"}`,
  );
  assert.deepEqual(
    { annotated, constructed },
    { annotated: true, constructed: true },
    `"Both must anchor." \`self.matcher: Matcher = _make()\` is shape 1 and \`self.events = EventLog()\` is ` +
      `shape 2, in the same __init__ of the same class. A build carrying one rule resolves one of them, which ` +
      `is exactly the silent half-answer C3-2 exists to forbid.${dumpWalk(shape, r)}`,
  );
});

wtest("C3-2d: a `@dataclass` body anchors like shape 1 - a bare `position: Coord` at class scope", async () => {
  const r = walkRun(FIX_DATACLASS);
  const shape = await r.shape();
  assert.ok(
    fieldNames(shape, "Marker").includes("position"),
    `CONTROL - the dataclass field must be parsed${dumpWalk(shape, r)}`,
  );
  const hits = r.anchors("Coord");
  assert.ok(
    hits.length > 0,
    `no cursor was placed on \`Coord\` in \`position: Coord\`. "A \`@dataclass\` body (\`position: int\`) ` +
      `anchors like shape 1." The declaration has no \`self.\` prefix and sits at class scope, which is the ` +
      `one structural difference from shape 1 inside __init__.${dumpWalk(shape, r)}`,
  );
  const line = FIX_DATACLASS.decls[DATACLASS_FIELD_LINE];
  const tokenAt = line.indexOf("Coord");
  for (const hit of hits) {
    assert.equal(hit.line, DATACLASS_FIELD_LINE, `the cursor must be on line ${DATACLASS_FIELD_LINE} (${show(line)}); got ${hit.line}`);
    assert.ok(
      hit.character >= tokenAt && hit.character < tokenAt + "Coord".length,
      `and inside the token at columns ${tokenAt}..${tokenAt + "Coord".length}; got ${hit.character}`,
    );
  }
  assert.ok(shape.types.has("Coord"), `and the dataclass's collaborator must reach the shape${dumpWalk(shape, r)}`);
});

wtest("C3-2e: a field with no anchorable token yields NO edge and is RECORDED as dropped [SYNTHETIC]", async () => {
  // SYNTHETIC: the transport reports `shadow: Hidden` while the source line says
  // `self.shadow = _elsewhere()`, so the candidate token is nowhere on its own
  // declaration line. That is what an outlived buffer or a re-exported alias
  // looks like from here.
  //
  // NOTE FOR THE READER OF A GREEN. While NO Python field anchors at all this
  // row is satisfied for free - everything is dropped, including this. It
  // becomes load-bearing the moment C3-2c goes green, and it is the guard that
  // stops the fix from turning an unanchorable field into an invented edge.
  const r = walkRun(FIX_SHADOW);
  const shape = await r.shape();
  assert.ok(
    fieldNames(shape, "Engine").includes("shadow"),
    `CONTROL - the field itself must be parsed from the member list; got ${show(fieldNames(shape, "Engine"))}${dumpWalk(shape, r)}`,
  );
  assert.equal(
    shape.types.has("Hidden"),
    false,
    `\`Hidden\` has no anchorable position on its field's own line, so it must not be emitted${dumpWalk(shape, r)}`,
  );
  assert.ok(
    (shape.dropped ?? []).includes("Hidden"),
    `"the walk records the type as dropped rather than pretending it resolved". \`Hidden\` was neither ` +
      `emitted nor reported. Dropped: ${show(shape.dropped)}${dumpWalk(shape, r)}`,
  );
});

// ===========================================================================
// SECTION C3-3. The render, same shape and same guards as Go and C#.
// ===========================================================================

wtest("C3-3 control: the walk's parsed field list is exactly the fixture's SIGNED FIELD members, per type", async () => {
  // Without this, every guard below that says "a name in the walk's parsed field
  // list" would be applying this file's guess at what that list holds.
  const shape = await walkRun(FIX_BODY).shape();
  for (const t of keys(shape)) {
    const got = fieldNames(shape, t);
    const want = (FIX_BODY.members[t] ?? [])
      .filter((m) => m.kind === "field" && m.signature !== undefined)
      .map((m) => m.name);
    assert.deepEqual(
      got,
      want,
      `the walk's field list for ${show(t)} is ${show(got)}; this file's guards treat it as ${show(want)}. ` +
        `If these diverge, the shed criterion below is being applied against the wrong list.`,
    );
  }
  assert.ok(shape.types.has("Ledger"), `CONTROL - the root must be one of the types checked; got ${show(keys(shape))}`);
});

ftest("C3-3a: a `Data shape of` block renders for a Python root with fields, python-fenced, AHEAD of the member list", async () => {
  const r = await pyGesture(FIX_BODY);
  assert.ok(B(r.text) > 0, `CONTROL - the gesture must inject something at all${dumpPrompt(r)}`);
  const shape = shapeSection(r.text, "Ledger");
  assert.ok(
    shape,
    `no data-shape block rendered for a Python class the walk parses two fields for. Python "is the only one ` +
      `of the five that loses the field TYPE and not just the edge", and this block is where the bought type ` +
      `lands.${dumpPrompt(r)}`,
  );
  assert.equal(
    r.text.split("\n").find((l) => l.startsWith("Data shape of ")),
    "Data shape of `Ledger` (fields and types, nested):",
    `the contract's own wording: "A \`Data shape of \\\`X\\\` (fields and types, nested):\` block".${dumpPrompt(r)}`,
  );
  assert.equal(
    shape.split("\n")[1],
    "```python",
    `the block must be python-fenced; its fence line is ${show(shape.split("\n")[1])}${dumpPrompt(r)}`,
  );
  const members = memberSection(r.text, "Ledger");
  assert.ok(members, `the member list must still exist - the guards shed from it, they do not delete it${dumpPrompt(r)}`);
  assert.ok(
    r.text.indexOf(shape) < r.text.indexOf(members),
    `"ahead of the member list". The shape block starts at ${r.text.indexOf(shape)} and the member list at ` +
      `${r.text.indexOf(members)}${dumpPrompt(r)}`,
  );
  // Every field the block names carries its type, which is the whole point of
  // paying for the hover.
  for (const [name, typeName] of [["owner", "Party"], ["name", "str"]]) {
    assert.ok(
      new RegExp(`^\\s*${name}\\b.*\\b${typeName}\\s*$`, "m").test(shape),
      `\`${name}\` is in the block without \`${typeName}\` on its line. Python's field arrives as a name with ` +
        `no type until something hovers it, and the product paid for that hover.${dumpPrompt(r)}`,
    );
  }
  // And the block never carries a type the walk did not reach. `Ghost` sits in
  // the same file and nothing names it.
  for (const bad of ["Ghost", "boo"]) {
    assert.equal(
      shape.includes(bad),
      false,
      `${show(bad)} belongs to a class in the same file that no field type and no signature names, so the walk ` +
        `never reached it. A block that carries it was built from the buffer rather than from the walk.${dumpPrompt(r)}`,
    );
  }
});

ftest("C3-3b: collaborators nest to depth 2, and the block stops there", async () => {
  const r = await pyGesture(FIX_CHAIN);
  const shape = shapeSection(r.text, "Depot");
  assert.ok(shape, `CONTROL - the block must render for the chain root${dumpPrompt(r)}`);
  for (const t of ["Sensor", "Job"]) {
    assert.ok(
      new RegExp(`\\b${CHAIN_OWN_FIELD[t]}\\b`).test(shape),
      `"collaborators nested to depth 2". \`${t}\` is at depth ${t === "Sensor" ? 1 : 2} of ` +
        `Depot -> Sensor -> Job and the block carries no body for it - its own field \`${CHAIN_OWN_FIELD[t]}\` ` +
        `is nowhere in the block. Note every link below the root is a CONSTRUCTOR CALL, so this row cannot ` +
        `pass without C3-2's second rule.${dumpPrompt(r)}`,
    );
  }
  assert.equal(
    new RegExp(`\\b${CHAIN_OWN_FIELD.JobState}\\b`).test(shape),
    false,
    `\`JobState\` is at depth 3 and the block rendered its field \`${CHAIN_OWN_FIELD.JobState}\`. The contract ` +
      `renders "collaborators nested to depth 2"; a block that expands further is reaching past what the walk ` +
      `was asked for.${dumpPrompt(r)}`,
  );
});

ftest("C3-3 guard 1: NO shape block rendered means the member list is BYTE-IDENTICAL to today", async () => {
  const r = await pyGesture(FIX_NOFIELDS);
  assert.equal(
    anyShapeBlock(r.text),
    false,
    `CONTROL - this fixture's members are all methods, so the walk parses no fields and nothing can render. If ` +
      `a block appeared, the fixture no longer constructs guard 1's condition${dumpPrompt(r)}`,
  );
  const members = memberSection(r.text, "Kiosk");
  assert.ok(members, `the member list must be there at all${dumpPrompt(r)}`);
  assert.equal(
    members,
    headMemberSection(FIX_NOFIELDS, "Kiosk"),
    `"No shape block means the member list is byte-identical to today." This is the member section this same ` +
      `fixture produced at commit 19f1e6f, byte for byte.${dumpPrompt(r)}`,
  );
});

ftest("C3-3 guard 2: the member list is a SUBSEQUENCE of its pre-phase-3 self, and every line that left is a field the block rendered", async () => {
  // The load-bearing row. It reads the guard's two halves together so no wrong
  // build can satisfy it by halves:
  //
  //   * nothing may be ADDED, REWORDED or REORDERED - the surviving lines must
  //     appear in the 19f1e6f block, in that order;
  //   * every line that LEFT must name a field the walk parsed for THAT type and
  //     that the shape block actually rendered.
  //
  // A build that sheds by scanning the member text, that sheds the root's field
  // names out of a collaborator's block, or that drops a member block it could
  // not fit, fails here with the offending lines printed.
  const r = await pyGesture(FIX_BODY);
  const shape = shapeSection(r.text, "Ledger") ?? "";
  const walked = await walkRun(FIX_BODY).shape();

  const present = ["Ledger", "Party", "Address"].filter((t) => memberSection(r.text, t) !== undefined);
  assert.ok(present.includes("Ledger"), `CONTROL - the root's member block must be in the prompt${dumpPrompt(r)}`);

  const report = [];
  let shedAnything = false;
  for (const t of present) {
    const base = bodyLines(headMemberSection(FIX_BODY, t));
    const now = bodyLines(memberSection(r.text, t)) ?? [];
    let i = 0;
    const stray = [];
    for (const line of now) {
      const at = base.indexOf(line, i);
      if (at < 0) stray.push(line);
      else i = at + 1;
    }
    const removed = base.filter((l) => !now.includes(l));
    if (removed.length > 0) shedAnything = true;
    const walkFields = new Set(((walked.types.get(t) || {}).fields ?? []).map((f) => f.name));
    const badShed = removed.filter((l) => !walkFields.has(firstToken(l)) || !shape.includes(firstToken(l)));
    report.push(
      `  ${t}: kept ${show(now)}\n    removed ${show(removed)}\n    walk fields ${show([...walkFields])}` +
        `\n    stray ${show(stray)}  illegally removed ${show(badShed)}`,
    );
    assert.deepEqual(
      stray,
      [],
      `${t}'s member block carries lines that were not in its 19f1e6f block, or carries them out of order. The ` +
        `shed is a REMOVAL, never a rewrite.\n${report.join("\n")}${dumpPrompt(r)}`,
    );
    assert.deepEqual(
      badShed,
      [],
      `${t} lost member lines that the shape block did not render as fields OF ${t}. "Only fields the shape ` +
        `block rendered are shed, matched by name against the parsed field list" - a line that leaves without ` +
        `the block taking it over is information the developer had this morning and does not have ` +
        `now.\n${report.join("\n")}${dumpPrompt(r)}`,
    );
  }
  // ANTI-VACUITY. A run where nothing was shed satisfies both assertions above
  // for free and says nothing about the shed being exact.
  assert.ok(
    shedAnything,
    `CONTROL - not one member line was shed anywhere in a fixture whose shape block rendered fields. Either the ` +
      `render did not ship or the shed did, and this row is scoring neither.\n${report.join("\n")}${dumpPrompt(r)}`,
  );
});

ftest("C3-3 guard 3: methods are never shed, including a prefix collision and a field name inside a signature", async () => {
  const r = await pyGesture(FIX_BODY);
  const shape = shapeSection(r.text, "Ledger");
  assert.ok(shape, `CONTROL - the block must render, or nothing can be shed and this row is free${dumpPrompt(r)}`);
  for (const f of ["owner", "name"]) {
    assert.ok(
      shape.includes(f),
      `CONTROL - the block must render the root's \`${f}\` FIELD, which is what makes the collisions below the ` +
        `trap this row is about${dumpPrompt(r)}`,
    );
  }
  assert.ok(
    r.text.includes("settle(amount: int) -> bool"),
    `"Methods are never shed." \`settle\` is a method of the root and its name is in no field list at all, so ` +
      `nothing can excuse its loss.${dumpPrompt(r)}`,
  );
  assert.ok(
    r.text.includes("name_of(n: int) -> str"),
    `\`name_of\` is a METHOD whose name STARTS with the root's field \`name\`, which the shape block rendered. ` +
      `A shed matching by prefix rather than by whole name against the parsed field list loses a ` +
      `callable.${dumpPrompt(r)}`,
  );
  assert.ok(
    r.text.includes("describe(owner: Party) -> str"),
    `\`describe\` is a METHOD whose SIGNATURE TEXT carries the field name \`owner\`. "matched by name against ` +
      `the parsed field list and never guessed from the text" - a shed that greps the member line for a shed ` +
      `field's name takes this one with it.${dumpPrompt(r)}`,
  );
  const party = memberSection(r.text, "Party");
  if (party) {
    assert.ok(
      party.includes("owner(n: int) -> bool"),
      `\`owner(n: int) -> bool\` is a METHOD of \`Party\`. \`owner\` is a FIELD of \`Ledger\` and the shape ` +
        `block rendered it, but it is not in PARTY's field list. A shed that matched this line globally lost a ` +
        `callable method.${dumpPrompt(r)}`,
    );
  }
});

ftest("C3-3 guard 4: Python's own-def is ATOMIC - whole or absent, and an absent one sheds nothing", async () => {
  // GO'S GUARD IS "a truncated own-def sheds nothing", AND PYTHON HAS NO
  // TRUNCATED FORM. A gopls struct hover is a brace body, so Go's walk can cut
  // it at a field boundary and leave a `... N more fields` marker; the guard
  // exists so that a cut own-def does not ALSO shed the member lines, which
  // would delete the field from both places at once. A Python def carries no
  // braces - it is synthesised from the parsed field list - so there is no
  // partial form to cut to and the walk emits it atomically. Bound here in the
  // form that is true for Python, protecting the same property: a field is never
  // missing from the shape block AND from the member list.
  const r = await pyGesture(FIX_WIDE);
  const shape = shapeSection(r.text, "Ledger");
  const members = memberSection(r.text, "Ledger");
  const walked = await walkRun(FIX_WIDE).shape();
  const parsed = fieldNames(walked, "Ledger");
  assert.equal(
    parsed.length,
    WIDE_N,
    `CONTROL - the walk must parse all ${WIDE_N} fields, or this row is not applying the pressure it was ` +
      `written for; parsed ${parsed.length}`,
  );
  if (shape === undefined) {
    assert.ok(members, `FIXTURE: neither block rendered, so this row can measure nothing at all${dumpPrompt(r)}`);
    assert.equal(
      members,
      headMemberSection(FIX_WIDE, "Ledger"),
      `no own-def rendered at all, so nothing may be shed: the member list must be exactly what it was at ` +
        `19f1e6f. "Fields are cut from one place or the other, never both."${dumpPrompt(r)}`,
    );
    return;
  }
  assert.equal(
    /\.\.\. \d+ more fields/.test(shape),
    false,
    `the block carries Go's truncation marker. A Python def has no brace body to cut, so a partial def here is ` +
      `a rendered declaration that claims to be the class and is not.${dumpPrompt(r)}`,
  );
  const missing = parsed.filter((n) => !new RegExp(`(^|\\W)${n}\\b`).test(shape));
  assert.deepEqual(
    missing,
    [],
    `the own-def rendered for \`Ledger\` and ${missing.length} of its ${WIDE_N} parsed fields are not in it. ` +
      `Atomic means whole: a field that is neither in the block nor (below) in the member list is gone from ` +
      `the prompt entirely.${dumpPrompt(r)}`,
  );
  assert.ok(members, `and the member block must survive alongside it${dumpPrompt(r)}`);
  const base = bodyLines(headMemberSection(FIX_WIDE, "Ledger"));
  const now = bodyLines(members) ?? [];
  const gone = base.filter((l) => !now.includes(l)).map(firstToken);
  const notRendered = gone.filter((n) => !new RegExp(`(^|\\W)${n}\\b`).test(shape));
  assert.deepEqual(
    notRendered,
    [],
    `these member lines were shed while the shape block does not carry their field: ${show(notRendered)}. That ` +
      `is the both-places cut this guard exists to stop.${dumpPrompt(r)}`,
  );
});

// ===========================================================================
// SECTION C3-4. `dialReach` for Python is "walk".
// ===========================================================================

const PREFIX = "[fngen] injected context:";

ftest("C3-4a: `PY_PREFILL_LANG.dialReach` has moved from `signatures` to `walk`", () => {
  const entry = FN.prefillLangFor("python");
  assert.ok(entry && "dialReach" in entry, `CONTROL - the language table must expose a reach for python: ${show(entry)}`);
  assert.equal(
    entry.dialReach,
    "walk",
    `"\`PY_PREFILL_LANG.dialReach\` moves from \`"signatures"\` to \`"walk"\` in the same change." The ` +
      `classification is what drives the channel line C3-4 is about, so it moves with the walk or the line ` +
      `keeps telling a developer their dials do nothing.`,
  );
});

ftest("C3-4b: the `injected context` line stops calling depth, breadth and the total-type cap inert", async () => {
  const r = await pyGesture(FIX_BODY);
  const lines = r.logs.filter((l) => l.includes(PREFIX));
  assert.equal(lines.length, 1, `CONTROL - python must log exactly one ${show(PREFIX)} line; got ${show(lines)}${dumpPrompt(r)}`);
  const line = lines[0];
  assert.equal(
    /buys?\s+nothing/i.test(line),
    false,
    `"Python's channel line currently says depth, breadth and the total-type cap are inert on this path. A ` +
      `field walk makes that false."\n  ${line}`,
  );
  assert.equal(
    /\binert\b/i.test(line),
    false,
    `and it must stop calling those dials inert for the same reason\n  ${line}`,
  );
  assert.equal(
    /no data-shape walk/i.test(line),
    false,
    `and it must stop saying Python has no data-shape walk. C3-3 gives it one.\n  ${line}`,
  );
  // The positive half: a language whose dial reaches the walk has to print the
  // dials the walk spends, or the line stops being a reason to turn them.
  for (const dial of [/\bbreadth=/, /\btypes=/, /\bdepth=/]) {
    assert.ok(
      dial.test(line),
      `a \`walk\` language's line carries the dials the walk actually spends; ${String(dial)} is missing.\n  ${line}`,
    );
  }
});

// ===========================================================================
// SECTION C3-6. `unusable` is a distinct cause from `budget`.
//
// Three causes now, not two: `count` (never asked), `budget` (asked, the clock
// ran out), `unusable` (asked, answered, and the language's builder refused the
// reply). The first row measures the DERIVATION, at the one place that can know
// the difference; the rest measure the DISCLOSURE, because a cause nobody can
// read is a cause that vanished.
// ===========================================================================

const CAP_URI = "file:///w/v50p3/caps.py";
const at = (line, character) => ({ line, character });
const symNode = (name, kind, line) => ({
  name,
  kind,
  range: { start: at(line, 4), end: at(line, 40) },
  selectionRange: { start: at(line, 4), end: at(line, 4 + name.length) },
  children: [],
});
const CAP_ROLE = (k) => (k === "class" ? "container" : k);
const CAP_BUILD = (label, detail, kind) => ({ name: label, kind, ...(detail === undefined ? {} : { signature: detail }) });

wtest("C3-6a: the fan-out derives THREE causes - never asked, asked and timed out, asked and refused", async () => {
  // One container, four members, a cap of three slots. `alpha` answers usably.
  // `beta` answers INSTANTLY with text that names nobody, so the builder refuses
  // it and the clock was never involved - the case the contract measured at 5
  // members in v49. `gamma` is asked and never answers inside the budget.
  // `delta` is past the cap and is never asked at all.
  const cls = {
    name: "Engine",
    kind: "class",
    range: { start: at(0, 0), end: at(20, 0) },
    selectionRange: { start: at(0, 6), end: at(0, 12) },
    children: [symNode("alpha", "field", 2), symNode("beta", "field", 3), symNode("gamma", "field", 4), symNode("delta", "field", 5)],
  };
  const nameAtLine = ["", "", "alpha", "beta", "gamma", "delta"];
  const members = await WALK.membersWithHoverSignatures(
    [cls],
    { uri: CAP_URI, line: 1, character: 0 },
    CAP_ROLE,
    CAP_BUILD,
    async (c) => {
      const n = nameAtLine[c.line];
      if (n === "alpha") return "alpha: int";
      // Names another symbol entirely, so the builder cannot use it as this
      // member's declaration.
      if (n === "beta") return "somebody_else: int";
      // Answers, but long after the budget. The margin is an order of magnitude
      // so a loaded box cannot turn this row's colour.
      if (n === "gamma") return new Promise((res) => setTimeout(() => res("gamma: int"), 500));
      return undefined;
    },
    { cap: 3, budgetMs: 30 },
  );
  const byName = Object.fromEntries(members.map((m) => [m.name, m]));
  assert.equal(byName.alpha?.signature, "alpha: int", `CONTROL - a usable answer must be USED; got ${show(byName.alpha)}`);
  assert.equal(byName.alpha?.capped, undefined, `CONTROL - and must not be marked capped: ${show(byName.alpha)}`);
  assert.equal(
    byName.delta?.capped,
    "count",
    `\`delta\` is past a cap of 3 and was never asked. "A member whose hover never returned inside the budget ` +
      `reports \`budget\`" is a different sentence and a different dial: ${show(byName.delta)}`,
  );
  assert.equal(
    byName.gamma?.capped,
    "budget",
    `\`gamma\` was asked and the clock ran out on it: ${show(byName.gamma)}`,
  );
  assert.equal(
    byName.beta?.capped,
    "unusable",
    `\`beta\`'s hover ANSWERED, instantly, with text naming another symbol, and the builder refused it. "A ` +
      `member whose hover returned and could not be used reports \`unusable\`." Reporting it as \`budget\` ` +
      `sends a reader to the fan-out clock when the dial that matters is the builder: ${show(byName.beta)}`,
  );
  // And the three are genuinely three, not two spellings of one.
  assert.equal(
    new Set([byName.delta?.capped, byName.gamma?.capped, byName.beta?.capped]).size,
    3,
    `the three causes must be distinct values: ${show(members.map((m) => [m.name, m.capped]))}`,
  );
});

// A gesture whose transport hands back one capped member, so the DISCLOSURE can
// be read without a real hover. The name is the same in all three runs, so the
// only thing that can differ between their channels is the CAUSE.
const cappedFixture = (cause) => ({
  root: "Ledger",
  decls: ["class Ledger:", "    def __init__(self) -> None:", "        self.owner: Party = _make()"],
  members: {
    Ledger: [F("owner", "Party", 2), { name: "orphan", kind: "method", capped: cause }],
  },
});
const capLines = (r) => r.logs.filter((l) => !l.includes(PREFIX) && l.includes("orphan")).join("\n");

ftest("C3-6b: the three causes read DIFFERENTLY on the channel - none is a synonym for another", async () => {
  const runs = {};
  for (const cause of ["count", "budget", "unusable"]) {
    const r = await pyGesture(cappedFixture(cause));
    runs[cause] = { line: capLines(r), r };
    assert.ok(
      runs[cause].line.length > 0,
      `the \`${cause}\` cap said nothing about \`orphan\` on the channel. "Neither vanishes silently" - and a ` +
        `member absent from a "use these exact names" block with no line anywhere reads as a member the type ` +
        `does not have.${dumpPrompt(r)}`,
    );
  }
  const pairs = [["count", "budget"], ["count", "unusable"], ["budget", "unusable"]];
  for (const [a, b] of pairs) {
    assert.notEqual(
      runs[a].line,
      runs[b].line,
      `the ${show(a)} and ${show(b)} runs cap the same member of the same class and their channel lines are ` +
        `identical, so a developer cannot tell which dial to turn. That is the whole of C3-6.\n` +
        `  ${a}: ${runs[a].line}\n  ${b}: ${runs[b].line}`,
    );
  }
  // eslint-disable-next-line no-console
  for (const c of ["count", "budget", "unusable"]) console.log(`  [C3-6b] ${c}: ${runs[c].line}`);
});

ftest("C3-6c: with all three causes in one type, all three members are named and none vanishes", async () => {
  const fix = {
    root: "Ledger",
    decls: ["class Ledger:", "    def __init__(self) -> None:", "        self.owner: Party = _make()"],
    members: {
      Ledger: [
        F("owner", "Party", 2),
        { name: "never_asked", kind: "method", capped: "count" },
        { name: "ran_out", kind: "method", capped: "budget" },
        { name: "refused", kind: "field", capped: "unusable" },
      ],
    },
  };
  const r = await pyGesture(fix);
  const channel = r.logs.join("\n");
  for (const name of ["never_asked", "ran_out", "refused"]) {
    assert.ok(
      channel.includes(name),
      `\`${name}\` was dropped from the block by a cap and the channel does not name it. "Neither vanishes ` +
        `silently" - the walk has always named the TYPES it dropped, and this is the same promise one level ` +
        `down.${dumpPrompt(r)}`,
    );
  }
  // A member the caps did NOT touch must not be swept into the report.
  assert.equal(
    /\bowner\b/.test(channel.split("\n").filter((l) => l.includes("never_asked")).join("\n")),
    false,
    `\`owner\` was signed and rendered; naming it on the cap line turns the disclosure into noise.${dumpPrompt(r)}`,
  );
});
