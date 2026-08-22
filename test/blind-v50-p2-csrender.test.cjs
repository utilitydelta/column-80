// BLIND ORACLE - session-v50 phase 2, "C#'s data-shape render".
//
// Binds to the phase-2 contract and to nothing else. `csShapeBlock`
// and `goShapeBlock` in src/vscode/fnGen.ts were never opened, and neither was
// csShapeGraphBlock's body in src/core/csExtraction.ts. What WAS read, and only
// far enough to drive the render headlessly: the exported `CompletionMember`
// shape in src/core/extraction.ts, the exported `CrossFileShape` and
// `CrossFileShapeHooks` declarations in src/core/crossFileShape.ts, and the
// exported signatures of `resolvePrefill`, `prefillLangFor`,
// `resolveCrossFileShape` and `shapeHooksFor`. Every expectation below comes
// from the contract's own sentences, except the frozen pre-phase-2 strings,
// which are what "byte-identical to today" MEANS and are labelled where they
// appear.
//
// ---------------------------------------------------------------------------
// THE LEFT-HAND SIDE, AND WHY IT COMES FROM A COMMIT.
//
// C2-2's first two guards say "byte-identical to today", so they need a
// left-hand side. The working tree was not usable for one: at 2026-08-11 while
// this file was being written, src/vscode/fnGen.ts went from unmodified to
// modified between two shell commands seconds apart, and C#'s `dialReach` was
// observed as "graph" in an archive tree and "walk" in the working tree in the
// same minute. A baseline scraped off a half-written build is the trap in the
// `measuring-a-moving-artifact` note.
//
// So every frozen string below was captured from COMMIT 19f1e6f ("session-v49:
// Go's field leg, the C# seam, and three instrument repairs"), the tip of
// session-v49 and the last commit before session-v50 started. Method:
// `git archive 19f1e6f src | tar -x` into a scratch tree, bundle
// src/vscode/fnGen.ts from THERE against the same vscode stub this file uses,
// and run the identical fixture code that appears below. At 19f1e6f, C# reads
// `dialReach: "graph"`, renders no data-shape block for any of these fixtures,
// and carries every field as a member line - which is exactly the "today" the
// contract's guards are measured against.
//
// Only TWO product strings are frozen: the two member-block header forms. Every
// member BODY line this file compares against is a signature this file's own
// fixture handed the extractor, so the baselines are built rather than
// transcribed and cannot drift with a rewording of the members themselves.
//
// ---------------------------------------------------------------------------
// WHAT WAS EXPECTED RED, AND WHAT THE FIRST RUN ACTUALLY FOUND.
//
// The brief for this file said C2-1, C2-3 and C2-4 were unbuilt and their rows
// would be red on arrival. They are not: phase 2 landed in the working tree
// WHILE this file was being written. Reported rather than hidden, because a
// reader needs to know that these rows were authored against a subject that was
// moving, and that the author had seen the built render's bytes before the last
// row was finished. The mitigation, applied throughout: every assertion is
// phrased from a contract sentence, the frontier row is a DIFFERENTIAL between
// two fixtures rather than a match against the product's wording, and no row
// pins a string this file did not either quote from the contract or capture
// from 19f1e6f.
//
// ROWS RED ON ARRIVAL (first run, 2026-08-11): ONE, and it is a tripwire that
// came due rather than a hole in the render.
//
//   C2-3c   test/blind-v49-p0-freewins.test.cjs records csharp as "graph"; the
//           product now answers "walk". "The v49 tripwire rows exist for this
//           and are expected to move; each one moves with its reason recorded."
//           Red until the recording happens.
//
// WHICH ROWS ARE DETECTORS, MEASURED RATHER THAN ASSERTED. Every row in this
// file was re-run against a tree whose src/ is commit 19f1e6f verbatim (the
// same archive the baselines came from), so "would this row have caught the
// absence of phase 2" is a number rather than an opinion. 13 of the 18 rows go
// red there. The five that do not are the tripwires:
//
//   TRIPWIRES (green at 19f1e6f AND green now - their job is to stay green):
//     C2-1e         no fields, no block. Free while nothing renders; it catches
//                   the build that starts emitting empty bodies.
//     C2-2 control  the walk's parsed field list. It has held since v49 phase 2
//                   widened the seam; it is here because every C2-2 row applies
//                   that list as its criterion.
//     C2-2 guard 1  no block, member list unchanged. Free while nothing
//                   renders; it catches the build that sheds unconditionally.
//     C2-4c         the emitted set must not move, and it has not.
//     C2-3c         inverts: green at 19f1e6f, red now, which is what a
//                   tripwire coming due looks like.
//
//   DETECTORS (red at 19f1e6f, green now):
//     C2-2 CORE is the load-bearing one. It does not ask "did the right things
//           go"; it asks the contract's two questions together - is the member
//           list a SUBSEQUENCE of its pre-phase-2 self (nothing added, nothing
//           reworded, order intact), and is every line that left a field the
//           walk parsed for THAT type and the block actually rendered. A build
//           that shed by scanning the member text, that shed the root's field
//           names out of a collaborator's block, or that dropped a whole member
//           block it could not fit turns this red with the offending lines
//           printed. Its anti-vacuity control is what makes it red at 19f1e6f:
//           a run that sheds nothing scores nothing.
//     C2-2 guards 3 and 4 carry the adversarial half: `Balance` is a FIELD of
//           the root and a METHOD of the collaborator in the same fixture, so a
//           first-token match against the wrong type's field list, or a global
//           by-name shed, loses a callable method.
//     C2-2 guard 2 the truncated own-def. WIDE_N is TUNED, not guessed: 90 is
//           the count where the `... N more fields` marker fires AND the member
//           block still renders, at both commits. At 120 with longer names the
//           member block stops rendering at all and the row would have measured
//           the budget instead of the shed.
//     C2-1a..d, C2-3a, C2-3b, C2-4a, C2-4b are the render, the dial and the
//           disclosure themselves.
//
// Nothing here needs a live language server, so SKIP_LIVE=1 changes nothing.
//
// Run: SKIP_LIVE=1 node --test test/blind-v50-p2-csrender.test.cjs

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");

const ROOT = path.join(__dirname, "..");
const show = (v) => JSON.stringify(v);
const B = (s) => Buffer.byteLength(String(s), "utf8");
const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ===========================================================================
// HARNESS A. The walk, bundled pure. No vscode anywhere on this path. Used by
// ONE row: the control that says what the walk's parsed field list actually is,
// because C2-2's third guard names that list as the matching criterion.
// ===========================================================================

const A_ENTRY = path.join(__dirname, ".blind-v50-p2-walk.entry.ts");
const A_OUT = path.join(__dirname, ".blind-v50-p2-walk.bundle.cjs");
let WALK = {};
let walkErr;
try {
  fs.writeFileSync(A_ENTRY, `export { resolveCrossFileShape, shapeHooksFor } from "../src/core/crossFileShape";\n`);
  esbuild.buildSync({ entryPoints: [A_ENTRY], bundle: true, outfile: A_OUT, format: "cjs", platform: "node" });
  WALK = require(A_OUT);
} catch (e) {
  walkErr = e;
}

// ===========================================================================
// HARNESS B. `resolvePrefill` and the exported language table, bundled headless
// against a STRUCTURAL vscode stub. Stub mechanics copied verbatim from
// test/blind-v49-p1-go-fields.test.cjs; the output channel is a REAL object
// because resolvePrefill leaves background work in flight and a straggler that
// logs into `{}` throws after the row that started it has ended.
// ===========================================================================

const STUB = path.join(__dirname, ".blind-v50-p2-vscode-stub.cjs");
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
        const c = globalThis.__V50P2_CFG__ || {};
        return Object.prototype.hasOwnProperty.call(c, k) ? c[k] : f;
      },
      has: () => false, inspect: () => undefined, update: async () => {},
    }),
    openTextDocument: (arg) =>
      Promise.resolve({ uri: mkUri(keyOf(arg)), getText: () => (globalThis.__V50P2_FILES__ || {})[keyOf(arg)] }),
  },
};
`,
);

const B_ENTRY = path.join(__dirname, ".blind-v50-p2-fn.entry.ts");
const B_OUT = path.join(__dirname, ".blind-v50-p2-fn.bundle.cjs");
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
    if (walkErr) assert.fail(`the crossFileShape bundle did not build: ${walkErr.message}`);
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
  if (walkErr) assert.fail(`crossFileShape bundle failed: ${walkErr.message}`);
  if (fnErr) assert.fail(`fnGen bundle failed: ${fnErr.message}`);
  for (const n of ["resolveCrossFileShape", "shapeHooksFor"]) {
    assert.equal(typeof WALK[n], "function", `${n} must be exported`);
  }
  for (const n of ["resolvePrefill", "prefillLangFor"]) {
    assert.equal(typeof FN[n], "function", `${n} must be exported from src/vscode/fnGen`);
  }
  assert.ok(WALK.shapeHooksFor("csharp"), "the C# hooks must resolve - the contract names them as the resolver half");
});

// ===========================================================================
// THE FIXTURES.
//
// Roslyn's class hover is the class head and nothing else, and C#'s fields
// arrive STRUCTURED on membersOfType written `Name : Type` with a declLine.
// That is the shape every fixture below hands the fake extractor. No fixture
// invents a C# hover body, because Roslyn does not produce one.
// ===========================================================================

const URI = "file:///w/v50p2/App.cs";
const F = (name, typeName, declLine) => ({ name, kind: "field", signature: `${name} : ${typeName}`, declLine });
const M = (name, signature) => ({ name, kind: "method", signature });

// ---------------------------------------------------------------------------
// BODY. The C2-1/C2-2 workhorse. Three deliberate traps in one file:
//
//   * `Balance` is a FIELD of the root AND a METHOD of the collaborator. A shed
//     that matches names globally, or matches a member line's first token
//     against the WRONG type's field list, loses `Balance(int) : bool`.
//   * `Settle(int) : bool` is a method of the root whose name is nowhere in any
//     field list, so it pins "methods are never shed" directly.
//   * `Ghost` is declared in the same file and named by nothing. The walk never
//     reaches it, so the block must never render it.
// ---------------------------------------------------------------------------

const BODY_DECLS = [
  /*  0 */ "public class Ledger",
  /*  1 */ "{",
  /*  2 */ "    public Party Owner;",
  /*  3 */ "    public int Balance;",
  /*  4 */ "    public bool Settle(int amount) { return true; }",
  /*  5 */ "}",
  /*  6 */ "",
  /*  7 */ "public class Party",
  /*  8 */ "{",
  /*  9 */ "    public Address Addr;",
  /* 10 */ "    public string Name;",
  /* 11 */ "    public bool Balance(int n) { return true; }",
  /* 12 */ "}",
  /* 13 */ "",
  /* 14 */ "public class Address",
  /* 15 */ "{",
  /* 16 */ "    public string Line1;",
  /* 17 */ "}",
  /* 18 */ "",
  /* 19 */ "public class Ghost",
  /* 20 */ "{",
  /* 21 */ "    public string Boo;",
  /* 22 */ "}",
];

const FIX_BODY = {
  root: "Ledger",
  decls: BODY_DECLS,
  hovers: { Ledger: "class App.Ledger", Party: "class App.Party", Address: "class App.Address", Ghost: "class App.Ghost" },
  members: {
    Ledger: [F("Owner", "Party", 2), F("Balance", "int", 3), M("Settle", "Settle(int) : bool")],
    Party: [F("Addr", "Address", 9), F("Name", "string", 10), M("Balance", "Balance(int) : bool")],
    Address: [F("Line1", "string", 16)],
    // Present so a render that reached Ghost COULD render something for it. It
    // must not: nothing names Ghost as a field type or in a signature.
    Ghost: [F("Boo", "string", 21)],
  },
};

// ---------------------------------------------------------------------------
// NOFIELDS. Every member is a method, so the walk parses no fields and C2-1's
// "a type the walk resolved NO fields for renders no data-shape block at all"
// is constructed rather than hoped for. This is also C2-2 guard 1's fixture.
// ---------------------------------------------------------------------------

const FIX_NOFIELDS = {
  root: "Kiosk",
  decls: [
    "public class Kiosk",
    "{",
    "    public bool Open(int slot) { return true; }",
    "    public int Tally() { return 0; }",
    "}",
  ],
  hovers: { Kiosk: "class App.Kiosk" },
  members: { Kiosk: [M("Open", "Open(int) : bool"), M("Tally", "Tally() : int")] },
};

// ---------------------------------------------------------------------------
// WIDE. C2-2 guard 2's fixture, and the count is TUNED rather than guessed: 90
// short-named fields is the point where the own-def truncates AND the member
// block still renders, at BOTH commits. Fewer and the own-def fits whole; the
// same field count with longer names and the member block stops rendering at
// all, which would make the guard measure the budget instead of the shed.
//
// If a future build moves either edge, this row fails LOUDLY on its own
// condition (see the row) rather than passing while measuring something else.
// ---------------------------------------------------------------------------

const WIDE_N = 90;
const wideField = (i) => `Fa${String(i).padStart(2, "0")}`;
const FIX_WIDE = {
  root: "Ledger",
  decls: ["public class Ledger", "{"]
    .concat(Array.from({ length: WIDE_N }, (_, i) => `    public string ${wideField(i)};`))
    .concat(["    public bool Settle(int amount) { return true; }", "}"]),
  hovers: { Ledger: "class App.Ledger" },
  members: {
    Ledger: Array.from({ length: WIDE_N }, (_, i) => F(wideField(i), "string", 2 + i)).concat([M("Settle", "Settle(int) : bool")]),
  },
};

// ---------------------------------------------------------------------------
// CHAIN and SHORT. C2-4's pair. CHAIN is the contract's depth-3 shape with
// local names: Depot -> Sensor -> Job -> JobState, so `JobState` sits one hop
// past a depth-2 frontier. SHORT is the SAME graph with the last hop removed,
// so `Job` names no collaborator at all.
//
// The pair is the point. "A developer reading the channel can tell the
// difference between 'no collaborator there' and 'a collaborator we did not
// expand'" is a claim about two runs differing, and a differential needs no
// guess at how the product spells its own line.
// ---------------------------------------------------------------------------

const CHAIN_DECLS = [
  /*  0 */ "public class Depot",
  /*  1 */ "{",
  /*  2 */ "    public Sensor Probe;",
  /*  3 */ "    public int Count;",
  /*  4 */ "}",
  /*  5 */ "",
  /*  6 */ "public class Sensor",
  /*  7 */ "{",
  /*  8 */ "    public Job Current;",
  /*  9 */ "}",
  /* 10 */ "",
  /* 11 */ "public class Job",
  /* 12 */ "{",
  /* 13 */ "    public JobState State;",
  /* 14 */ "}",
  /* 15 */ "",
  /* 16 */ "public class JobState",
  /* 17 */ "{",
  /* 18 */ "    public string Label;",
  /* 19 */ "}",
];

const FIX_CHAIN = {
  root: "Depot",
  decls: CHAIN_DECLS,
  hovers: { Depot: "class App.Depot", Sensor: "class App.Sensor", Job: "class App.Job", JobState: "class App.JobState" },
  members: {
    Depot: [F("Probe", "Sensor", 2), F("Count", "int", 3), M("Refresh", "Refresh() : bool")],
    Sensor: [F("Current", "Job", 8)],
    Job: [F("State", "JobState", 13)],
    JobState: [F("Label", "string", 18)],
  },
};

// The same graph, one hop shorter: `Job` holds a primitive, so the frontier
// names nothing new.
const FIX_SHORT = {
  root: "Depot",
  decls: CHAIN_DECLS.slice(0, 15),
  hovers: { Depot: "class App.Depot", Sensor: "class App.Sensor", Job: "class App.Job" },
  members: {
    Depot: [F("Probe", "Sensor", 2), F("Count", "int", 3), M("Refresh", "Refresh() : bool")],
    Sensor: [F("Current", "Job", 8)],
    Job: [F("Tag", "string", 13)],
  },
};

// ===========================================================================
// THE PROMPT HARNESS. One C# gesture per fixture: the declarations, a doc
// comment, and a method to fill whose parameter names the root. Modelled on
// test/blind-v49-p1-go-fields.test.cjs's `fiveGesture`, which is the shape that
// is already known to produce C# candidates.
// ===========================================================================

const wordAt = (text, cursor) => {
  const line = (text || "").split("\n")[cursor.line] ?? "";
  const isWord = (ch) => /[A-Za-z0-9_]/.test(ch);
  let s = Math.min(cursor.character, line.length);
  let e = s;
  while (s > 0 && isWord(line[s - 1])) s--;
  while (e < line.length && isWord(line[e])) e++;
  return e > s ? line.slice(s, e) : undefined;
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
    return new V.Position(Math.max(lines.length - 1, 0), 0);
  };
  return {
    uri: { toString: () => uriStr },
    offsetAt,
    positionAt,
    getText: (r) => (r ? text.slice(offsetAt(r.start), offsetAt(r.end)) : text),
  };
}

const srcOf = (fix) =>
  fix.decls
    .concat([
      "",
      "/// <summary>Rebuild the registry.</summary>",
      `public uint Build(${fix.root} p0)`,
      "{",
      "    throw new NotImplementedException();",
      "}",
      "",
    ])
    .join("\n");

// A fake transport that answers from the fixture's own table, keyed by the type
// name at the cursor - which is how a real server behaves: the walk hands it a
// position, not a name. Every call is recorded so a row can say what was asked.
function csExtractor(fix, src, calls) {
  const files = { [URI]: src };
  const known = new Set(Object.keys(fix.members));
  const lines = src.split("\n");
  const typeAt = (c) => {
    const text = files[c.uri];
    if (text === undefined) return undefined;
    const w = wordAt(text, c);
    if (w && known.has(w)) return w;
    const line = text.split("\n")[c.line] ?? "";
    const on = [...new Set(line.match(/[A-Za-z_][A-Za-z0-9_]*/g) || [])].filter((x) => known.has(x));
    return on.length === 1 ? on[0] : undefined;
  };
  const declLineOf = (t) => lines.findIndex((l) => new RegExp(`class ${t}\\b`).test(l));
  return {
    definition: async (c) => {
      const t = typeAt(c);
      calls.push({ op: "definition", word: wordAt(files[c.uri], c), t, line: c.line, character: c.character });
      if (!t) return undefined;
      const ln = declLineOf(t);
      if (ln < 0) return undefined;
      const ch = lines[ln].indexOf(t);
      return { uri: URI, range: { startLine: ln, startCharacter: ch, endLine: ln, endCharacter: ch + t.length } };
    },
    hoverSurface: async (c) => {
      const t = typeAt(c);
      calls.push({ op: "hover", t });
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

async function csGesture(fix) {
  const src = srcOf(fix);
  const signature = `public uint Build(${fix.root} p0)`;
  const record = {
    span: { start: src.indexOf(signature), end: src.length - 1 },
    signature,
    docComment: "Rebuild the registry.",
    symbolName: "Build",
    languageId: "csharp",
    kind: "method",
    bodyOnly: false,
    headerIndent: "",
    bodyIndent: "    ",
  };
  const logs = [];
  const calls = [];
  // MERGED, never deleted: resolvePrefill leaves background work in flight and a
  // straggler that finds the file map gone reports as an unhandled rejection
  // after the row that started it has ended.
  globalThis.__V50P2_FILES__ = { ...(globalThis.__V50P2_FILES__ || {}), [URI]: src };
  const out = await FN.resolvePrefill(csExtractor(fix, src, calls), makeDoc(src, URI), record, (l) => logs.push(String(l)));
  return { text: out || "", logs, calls, src, fix };
}

// The two prompt sections, read by their leading phrase plus the fenced block
// that follows. The "Data shape of" phrase is the contract's own, quoted from
// C2-1; "Members of" is the block that already exists.
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
// THE PRE-PHASE-2 BASELINE, commit 19f1e6f. See the file header for the method.
//
// Only the two HEADER forms are frozen product strings. The body of a member
// block is this file's own fixture signatures, in the order the fixture handed
// them over, capped at the first `memberCap` - which is what a member block was
// at 19f1e6f for every fixture in this file, verified by running them there.
// ---------------------------------------------------------------------------

const HEAD_MEMBER_HEADER = (t) => `Members of \`${t}\` (real signatures, use these exact names, do not invent):`;
const HEAD_SUBSET_HEADER = (t, kept, total) =>
  `Members of \`${t}\` (a subset — the first ${kept} of ${total}; real signatures, use these exact names, do not invent):`;
const HEAD_MEMBER_CAP = 48; // the `members=48` the channel prints at the install-default `small` stop

const headMemberSection = (fix, typeName) => {
  const all = fix.members[typeName].map((m) => m.signature);
  const head =
    all.length > HEAD_MEMBER_CAP ? HEAD_SUBSET_HEADER(typeName, HEAD_MEMBER_CAP, all.length) : HEAD_MEMBER_HEADER(typeName);
  return [head, "```cs", ...all.slice(0, HEAD_MEMBER_CAP), "```"].join("\n");
};

// ===========================================================================
// SECTION C2-1. A C# root with fields renders a data-shape block.
// ===========================================================================

ftest("C2-1a: a `Data shape of` block renders for a C# root with fields, cs-fenced, AHEAD of the member list", async () => {
  const r = await csGesture(FIX_BODY);
  assert.ok(B(r.text) > 0, `CONTROL - the gesture must inject something at all${dumpPrompt(r)}`);
  const shape = shapeSection(r.text, "Ledger");
  assert.ok(
    shape,
    `no data-shape block rendered for a C# class the walk resolves two fields for. "C# derives fields today ` +
      `and throws the shape away" - C2-1 is the render that stops throwing it away, and without it nothing ` +
      `else in this section has a subject.${dumpPrompt(r)}`,
  );
  // The contract's own wording, quoted from C2-1, and the fence it names.
  assert.equal(
    r.text.split("\n").find((l) => l.startsWith("Data shape of ")),
    "Data shape of `Ledger` (fields and types, nested):",
    `"A \`Data shape of \\\`X\\\` (fields and types, nested):\` block ... Same wording and same shape as Go's."` +
      `${dumpPrompt(r)}`,
  );
  assert.ok(shape.split("\n")[1] === "```cs", `the block must be cs-fenced; its fence line is ${show(shape.split("\n")[1])}${dumpPrompt(r)}`);
  const members = memberSection(r.text, "Ledger");
  assert.ok(members, `the member list must still exist - C2-2 sheds from it, C2-1 does not delete it${dumpPrompt(r)}`);
  assert.ok(
    r.text.indexOf(shape) < r.text.indexOf(members),
    `"ahead of the member list". The shape block starts at ${r.text.indexOf(shape)} and the member list at ` +
      `${r.text.indexOf(members)}${dumpPrompt(r)}`,
  );
});

ftest("C2-1b: every field the block renders carries its TYPE, as the declaration writes it", async () => {
  const r = await csGesture(FIX_BODY);
  const shape = shapeSection(r.text, "Ledger");
  assert.ok(shape, `CONTROL - the block must render for this row to have a subject${dumpPrompt(r)}`);
  const declared = [
    ["Owner", "Party"],
    ["Balance", "int"],
    ["Addr", "Address"],
    ["Name", "string"],
    ["Line1", "string"],
  ];
  const named = declared.filter(([n]) => new RegExp(`(^|\\W)${n}\\b`).test(shape));
  assert.ok(named.length > 0, `CONTROL - the block must name at least one field${dumpPrompt(r)}`);
  for (const [name, type] of named) {
    assert.ok(
      new RegExp(`^\\s*${name}\\b.*\\b${escapeRe(type)}\\s*$`, "m").test(shape),
      `"Fields carry their types." \`${name}\` is in the block without \`${type}\` on its line. A field name ` +
        `with no type is a name the model has to guess a constructor argument for.${dumpPrompt(r)}`,
    );
  }
});

// A type is EMITTED when its OWN body was rendered, which is not the same as
// its name appearing: `State : JobState` names `JobState` as a field type while
// emitting nothing for it. The tell that needs no guess at the product's def
// wording is the type's own field, which only its own body can carry. Each
// chain type below has a uniquely-named field for exactly this purpose.
const CHAIN_OWN_FIELD = { Depot: "Probe", Sensor: "Current", Job: "State", JobState: "Label" };
const emitted = (text) => Object.keys(CHAIN_OWN_FIELD).filter((t) => new RegExp(`\\b${CHAIN_OWN_FIELD[t]}\\b`).test(String(text)));

ftest("C2-1c: collaborators nest to depth 2, and the block stops there", async () => {
  const r = await csGesture(FIX_CHAIN);
  const shape = shapeSection(r.text, "Depot");
  assert.ok(shape, `CONTROL - the block must render for the chain root${dumpPrompt(r)}`);
  for (const t of ["Sensor", "Job"]) {
    assert.ok(
      new RegExp(`\\b${CHAIN_OWN_FIELD[t]}\\b`).test(shape),
      `"Collaborators nest to depth 2." \`${t}\` is at depth ${t === "Sensor" ? 1 : 2} of ` +
        `Depot -> Sensor -> Job and the block carries no body for it - its own field ` +
        `\`${CHAIN_OWN_FIELD[t]}\` is nowhere in the block.${dumpPrompt(r)}`,
    );
  }
  assert.equal(
    new RegExp(`\\b${CHAIN_OWN_FIELD.JobState}\\b`).test(shape),
    false,
    `\`JobState\` is at depth 3 and the block rendered its field \`${CHAIN_OWN_FIELD.JobState}\`. "Depth ` +
      `stays 2 this session" - a block that expands it is reaching further than the walk was asked to, and ` +
      `C2-4 exists precisely because it does NOT.${dumpPrompt(r)}`,
  );
});

ftest("C2-1d: the block never renders a type the walk did not reach", async () => {
  const r = await csGesture(FIX_BODY);
  const shape = shapeSection(r.text, "Ledger");
  assert.ok(shape, `CONTROL - the block must render${dumpPrompt(r)}`);
  assert.ok(shape.includes("Party"), `CONTROL - a type the walk DID reach must be in the block${dumpPrompt(r)}`);
  // `Ghost` sits between `Address` and the gesture in the same file, and nothing
  // names it: no field is typed Ghost, no member signature mentions it. A render
  // built from the walk cannot see it; a render built from the file text can.
  for (const bad of ["Ghost", "Boo"]) {
    assert.equal(
      shape.includes(bad),
      false,
      `${show(bad)} belongs to a class in the same file that no field type and no signature names, so the ` +
        `walk never reached it. A block that carries it was built from the buffer rather than from the ` +
        `walk.${dumpPrompt(r)}`,
    );
  }
});

ftest("C2-1e: a type the walk resolved NO fields for renders no data-shape block at all", async () => {
  const r = await csGesture(FIX_NOFIELDS);
  assert.ok(B(r.text) > 0, `CONTROL - the gesture must inject something${dumpPrompt(r)}`);
  assert.ok(
    memberSection(r.text, "Kiosk"),
    `CONTROL - the member list must be there, or "no shape block" is a claim about an empty injection${dumpPrompt(r)}`,
  );
  assert.equal(
    anyShapeBlock(r.text),
    false,
    `every member of \`Kiosk\` is a method, so the walk parses no fields for it. "A type the walk resolved NO ` +
      `fields for renders no data-shape block at all" - an empty \`class App.Kiosk { }\` costs bytes and ` +
      `tells the model nothing.${dumpPrompt(r)}`,
  );
});

// ===========================================================================
// SECTION C2-2. The member list sheds exactly the fields the shape block
// rendered, and only those.
//
// "Go's guards transfer verbatim and they are the point."
// ===========================================================================

// The walk's OWN parsed field list, which C2-2's third guard names as the
// matching criterion. Driven headlessly through the same hooks the resolver
// half uses, so the criterion the rows below apply is the product's, not this
// file's reading of a signature.
function walkDriver(fix) {
  const src = srcOf(fix);
  const files = { [URI]: src };
  const calls = [];
  const extractor = csExtractor(fix, src, calls);
  const rootLine = src.split("\n").findIndex((l) => new RegExp(`class ${fix.root}\\b`).test(l));
  return {
    calls,
    shape: () =>
      WALK.resolveCrossFileShape(
        extractor,
        { uri: URI, line: rootLine, character: src.split("\n")[rootLine].indexOf(fix.root) },
        { D_MAX: 2, N_MAX: 24 },
        async (uri) => files[uri],
        WALK.shapeHooksFor("csharp"),
      ),
  };
}

wtest("C2-2 control: the walk's parsed field list is exactly the fixture's FIELD members, per type", async () => {
  // Without this, every row below that says "a name in the walk's parsed field
  // list" would be applying this file's guess at what that list holds.
  const shape = await walkDriver(FIX_BODY).shape();
  for (const t of ["Ledger", "Party", "Address"]) {
    assert.ok(shape.types.has(t), `CONTROL - the walk must reach ${show(t)}; reached ${show([...shape.types.keys()])}`);
    const got = (shape.types.get(t).fields ?? []).map((f) => f.name);
    const want = FIX_BODY.members[t].filter((m) => m.kind === "field").map((m) => m.name);
    assert.deepEqual(
      got,
      want,
      `the walk's field list for ${show(t)} is ${show(got)}; this file's rows treat it as ${show(want)}. ` +
        `If these ever diverge the shed criterion below is being applied against the wrong list.`,
    );
  }
});

ftest("C2-2 guard 1: NO shape block rendered means the member list is BYTE-IDENTICAL to today", async () => {
  const r = await csGesture(FIX_NOFIELDS);
  assert.equal(
    anyShapeBlock(r.text),
    false,
    `CONTROL - this fixture's members are all methods, so nothing can render. If a block appeared, the ` +
      `fixture no longer constructs guard 1's condition${dumpPrompt(r)}`,
  );
  const members = memberSection(r.text, "Kiosk");
  assert.ok(members, `the member list must be there at all${dumpPrompt(r)}`);
  assert.equal(
    members,
    headMemberSection(FIX_NOFIELDS, "Kiosk"),
    `"No shape block rendered means the member list is BYTE-IDENTICAL to today." This is the member section ` +
      `this same fixture produced at commit 19f1e6f, byte for byte.${dumpPrompt(r)}`,
  );
});

ftest("C2-2 CORE: the member list is a SUBSEQUENCE of its pre-phase-2 self, and every line that left is a field the block rendered", async () => {
  // The load-bearing row. It reads the two contract clauses together rather
  // than one at a time, so no wrong build can satisfy it by halves:
  //
  //   * nothing may be ADDED, REWORDED or REORDERED - the surviving lines must
  //     appear in the 19f1e6f block, in that order;
  //   * every line that LEFT must name a field that the walk parsed for THAT
  //     type and that the shape block actually rendered.
  //
  // A build that sheds by reading the member text, that sheds the root's field
  // names out of a collaborator's block, or that drops a member block it could
  // not fit, fails here with the offending lines printed.
  const r = await csGesture(FIX_BODY);
  const shape = shapeSection(r.text, "Ledger") ?? "";
  const walked = await walkDriver(FIX_BODY).shape();

  const report = [];
  let shedAnything = false;
  for (const t of ["Ledger", "Party", "Address"]) {
    const base = bodyLines(headMemberSection(FIX_BODY, t));
    const now = bodyLines(memberSection(r.text, t)) ?? [];
    // Subsequence, in order. `i` walks the baseline; every current line must be
    // findable at or after the cursor.
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
      `${t}'s member block carries lines that were not in its 19f1e6f block, or carries them out of order. ` +
        `The shed is a REMOVAL, never a rewrite.\n${report.join("\n")}${dumpPrompt(r)}`,
    );
    assert.deepEqual(
      badShed,
      [],
      `${t} lost member lines that the shape block did not render as fields OF ${t}. "The member list sheds ` +
        `exactly the fields the shape block rendered, and only those" - a line that leaves without the block ` +
        `taking it over is information the developer had this morning and does not have ` +
        `now.\n${report.join("\n")}${dumpPrompt(r)}`,
    );
  }
  // ANTI-VACUITY. A run where nothing was shed satisfies both assertions above
  // for free, and says nothing about the shed being exact.
  assert.ok(
    shedAnything,
    `CONTROL - not one member line was shed anywhere in a fixture whose shape block rendered five fields. ` +
      `Either the render did not ship or the shed did, and this row is scoring neither.` +
      `\n${report.join("\n")}${dumpPrompt(r)}`,
  );
});

ftest("C2-2 guard 2: a TRUNCATED own-def means no shedding at all - fields are cut from one place or the other, never both", async () => {
  const r = await csGesture(FIX_WIDE);
  const shape = shapeSection(r.text, "Ledger");
  // The CONDITION has to be constructed before it can be tested. A fixture that
  // stops constructing it would pass this row while measuring the ordinary case,
  // so it fails LOUDLY instead. It is a fixture defect, not a product defect,
  // and the fix is to re-tune WIDE_N, not to re-cut the row.
  assert.ok(
    shape,
    `FIXTURE: no data-shape block rendered for a ${WIDE_N}-field class, so the truncated form guard 2 is ` +
      `about was never constructed.${dumpPrompt(r)}`,
  );
  assert.ok(
    /\.\.\. \d+ more fields/.test(shape),
    `FIXTURE: the own-def rendered whole. Guard 2 needs the walk's \`... N more fields\` marker; widen ` +
      `WIDE_N until it fires.${dumpPrompt(r)}`,
  );
  const members = memberSection(r.text, "Ledger");
  assert.ok(
    members,
    `FIXTURE: the member block did not render at all, so this row cannot tell a shed from a budget drop. ` +
      `WIDE_N is tuned to the point where the marker fires AND the member block survives; re-tune ` +
      `it.${dumpPrompt(r)}`,
  );
  assert.equal(
    members,
    headMemberSection(FIX_WIDE, "Ledger"),
    `"A truncated own-def means no shedding at all. Fields may be cut from one place or the other, never ` +
      `from both." The own-def was cut, so the member list must be exactly what it was at 19f1e6f.` +
      `${dumpPrompt(r)}`,
  );
});

ftest("C2-2 guard 3: methods are never shed, including one whose first token is a field name", async () => {
  const r = await csGesture(FIX_BODY);
  const shape = shapeSection(r.text, "Ledger");
  assert.ok(shape, `CONTROL - the block must render, or nothing can be shed and this row is free${dumpPrompt(r)}`);
  assert.ok(
    shape.includes("Balance"),
    `CONTROL - the block must render the root's \`Balance\` FIELD, which is what makes the collaborator's ` +
      `\`Balance\` METHOD the trap this row is about${dumpPrompt(r)}`,
  );
  assert.ok(
    r.text.includes("Settle(int) : bool"),
    `"Methods are never shed." \`Settle\` is a method of the root and its name is in no field list at all, ` +
      `so nothing can excuse its loss.${dumpPrompt(r)}`,
  );
  assert.ok(
    r.text.includes("Balance(int) : bool"),
    `\`Balance(int) : bool\` is a METHOD of \`Party\`. \`Balance\` is a FIELD of \`Ledger\`, and the shape ` +
      `block rendered it. "A member line is a field line exactly when its first token is a name in the ` +
      `walk's parsed field list, never by guessing from its text" - and \`Balance\` is not in PARTY's field ` +
      `list. A shed that matched this line lost a callable method.${dumpPrompt(r)}`,
  );
});

ftest("C2-2 guard 4: shedding is per type - a collaborator's member block is unaffected by the ROOT's shape block", async () => {
  const r = await csGesture(FIX_BODY);
  const shape = shapeSection(r.text, "Ledger");
  assert.ok(shape, `CONTROL - the block must render${dumpPrompt(r)}`);
  const walked = await walkDriver(FIX_BODY).shape();
  const rootFields = new Set(((walked.types.get("Ledger") || {}).fields ?? []).map((f) => f.name));
  assert.ok(rootFields.has("Balance"), `CONTROL - \`Balance\` must be one of the ROOT's parsed fields; got ${show([...rootFields])}`);
  const partyFields = new Set(((walked.types.get("Party") || {}).fields ?? []).map((f) => f.name));
  assert.equal(partyFields.has("Balance"), false, `CONTROL - and it must NOT be one of Party's; got ${show([...partyFields])}`);

  const party = memberSection(r.text, "Party");
  const base = bodyLines(headMemberSection(FIX_BODY, "Party"));
  const now = bodyLines(party) ?? [];
  const removed = base.filter((l) => !now.includes(l));
  const crossType = removed.filter((l) => rootFields.has(firstToken(l)) && !partyFields.has(firstToken(l)));
  assert.deepEqual(
    crossType,
    [],
    `\`Party\` lost member lines whose names are fields of the ROOT and not of \`Party\`. "Shedding is per ` +
      `type: a collaborator's own member block is unaffected by what the ROOT's shape block rendered."\n` +
      `  Party kept ${show(now)}\n  Party lost ${show(removed)}\n  root fields ${show([...rootFields])}` +
      `${dumpPrompt(r)}`,
  );
});

// ===========================================================================
// SECTION C2-3. `dialReach` for C# is "walk", in the same change.
// ===========================================================================

const PREFIX = "[fngen] injected context:";

ftest("C2-3a: `CS_PREFILL_LANG.dialReach` has moved from `graph` to `walk`", () => {
  const entry = FN.prefillLangFor("csharp");
  assert.ok(entry && "dialReach" in entry, `CONTROL - the language table must expose a reach for csharp: ${show(entry)}`);
  assert.equal(
    entry.dialReach,
    "walk",
    `"\`CS_PREFILL_LANG.dialReach\` moves from \`"graph"\` to \`"walk"\`, in the same change." A field walk ` +
      `makes \`graph\` false, and the classification is what drives the line C2-3 is about.`,
  );
});

ftest("C2-3b: the `injected context` line stops saying breadth, total types and depth buy C# nothing", async () => {
  const r = await csGesture(FIX_BODY);
  const lines = r.logs.filter((l) => l.includes(PREFIX));
  assert.equal(lines.length, 1, `CONTROL - csharp must log exactly one ${show(PREFIX)} line; got ${show(lines)}${dumpPrompt(r)}`);
  const line = lines[0];
  assert.equal(
    /buys?\s+nothing/i.test(line),
    false,
    `"The \`[fngen] injected context:\` line must stop saying breadth and depth buy C# nothing, because a ` +
      `field walk makes that false."\n  ${line}`,
  );
  assert.equal(
    /no data-shape walk/i.test(line),
    false,
    `and it must stop saying C# has no data-shape walk. C2-1 gives it one.\n  ${line}`,
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

ftest("C2-3c: the v49 phase-0 tripwire came due - its recorded value for csharp IS the live value", () => {
  // "The v49 tripwire rows exist for this and are expected to move; each one
  // moves with its reason recorded." Bound on the phase-0 file's SOURCE, so it
  // is red both ways round: if the product moved and the file did not, and if
  // the file was re-cut to a value the product does not hold.
  const P0 = path.join(__dirname, "blind-v49-p0-freewins.test.cjs");
  assert.ok(fs.existsSync(P0), `${P0} must exist - it is the file that records the per-language reach`);
  const src = fs.readFileSync(P0, "utf8");
  const table = /const REACH = \{([\s\S]*?)\};/.exec(src);
  assert.ok(table, `CONTROL - the reach table must still be readable from that file; it is what this row scores`);
  const row = /\bcsharp:\s*"([a-z]+)"/.exec(table[1]);
  assert.ok(row, `CONTROL - the table must still carry a row for csharp: ${show(table[1])}`);
  const live = FN.prefillLangFor("csharp").dialReach;
  assert.equal(
    row[1],
    live,
    `test/blind-v49-p0-freewins.test.cjs records csharp as ${show(row[1])} and the product answers ${show(live)}. ` +
      `Those two move together, in one commit, with the reason recorded alongside.`,
  );
});

// ===========================================================================
// SECTION C2-4. A collaborator the walk reached and could not expand is NAMED.
//
// The rows here are a DIFFERENTIAL between CHAIN (a type one hop past the
// frontier) and SHORT (the same graph with nothing past it). An oracle that
// pinned the product's wording for this line would be writing the
// implementation's sentence into a test; a pair of runs that must differ, and
// must differ by naming that type, binds the contract's actual claim.
// ===========================================================================

ftest("C2-4a: a type named by a field at the depth frontier is NAMED on the channel", async () => {
  const r = await csGesture(FIX_CHAIN);
  assert.ok(r.logs.length > 0, `CONTROL - the gesture must have said something on the channel at all${dumpPrompt(r)}`);
  const channel = r.logs.join("\n");
  assert.equal(
    emitted(r.text).includes("JobState"),
    false,
    `CONTROL - \`JobState\` must not be EMITTED into the prompt, or there is no disclosure problem to solve. ` +
      `Emitted: ${show(emitted(r.text))}${dumpPrompt(r)}`,
  );
  assert.ok(
    channel.includes("JobState"),
    `\`Depot -> Sensor -> Job -> JobState\` puts \`JobState\` one hop past the depth-2 frontier: the walk ` +
      `reached the field that names it and stopped before enqueueing it. "A type named by a field of a type ` +
      `at the depth frontier is reported on the channel as reached and not expanded, naming the type." It is ` +
      `in neither the prompt nor the channel, which is the silent absence C2-4 forbids.${dumpPrompt(r)}`,
  );
});

ftest("C2-4b: 'no collaborator there' and 'a collaborator we did not expand' read DIFFERENTLY", async () => {
  const long = await csGesture(FIX_CHAIN);
  const short = await csGesture(FIX_SHORT);
  const strip = (r) => r.logs.filter((l) => !l.includes(PREFIX)).join("\n");
  const a = strip(long);
  const b = strip(short);
  assert.ok(
    shapeSection(short.text, "Depot"),
    `CONTROL - the SHORT fixture must render its own block, or the two runs differ for a reason that has ` +
      `nothing to do with the frontier${dumpPrompt(short)}`,
  );
  assert.notEqual(
    a,
    b,
    `the two runs walk the same graph; the only difference is that \`Job\` holds a \`JobState\` in one and a ` +
      `\`string\` in the other. Their channels are identical, so a developer cannot tell the two cases ` +
      `apart.\n--- CHAIN ---\n${a}\n--- SHORT ---\n${b}`,
  );
  // And the difference must be the DISCLOSURE, not noise: the short run must not
  // name a type that was never there.
  for (const phantom of ["JobState", "Label"]) {
    assert.equal(
      b.includes(phantom),
      false,
      `the SHORT fixture declares no \`${phantom}\` anywhere in its own source, and its channel names it. A ` +
        `report that fires when the frontier named nothing turns the disclosure into noise.\n--- SHORT ---\n${b}`,
    );
  }
});

ftest("C2-4c: nothing about which types are EMITTED changes - this is a channel line, not new reach", async () => {
  const r = await csGesture(FIX_CHAIN);
  assert.ok(B(r.text) > 0, `CONTROL - the gesture must inject something${dumpPrompt(r)}`);
  assert.deepEqual(
    emitted(r.text),
    ["Depot", "Sensor", "Job"],
    `the emitted set at 19f1e6f was \`Depot\`, \`Sensor\` and \`Job\` - the same three, reached through the ` +
      `same depth-2 bound. "Nothing about which types are EMITTED changes."${dumpPrompt(r)}`,
  );
});
