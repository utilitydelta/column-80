// BLIND ORACLE - session-v49 phase 1, "Go's field leg".
//
// Binds to the phase-1 contract and to nothing else. While writing
// the assertions in this file, src/core/crossFileShape.ts, src/core/dataShape.ts,
// src/core/goExtraction.ts and src/vscode/fnGen.ts were never opened. The only
// src file read was src/core/extraction.ts, and only far enough to read the
// SHAPE of `CompletionMember` (`{ name, kind, signature? }`) and the method list
// of `SurfaceExtractor`, so a fixture could be built that a real transport would
// also satisfy. No expectation below was copied out of the product.
//
// ---------------------------------------------------------------------------
// THE FIXTURES ARE REAL BYTES WHERE REAL BYTES EXIST.
//
// The captured hover JSON is 4356 bytes of `pgx.Conn` and 5110 bytes
// of `pgx.ConnConfig`, captured live off gopls v0.23.0 against
// ~/sandbox/v42-corpus/pgx by the session-v48 scout. Every P1 row that can run
// on a real hover runs on those bytes, raw, fences and prose and the trailing
// pkg.go.dev line included - the same form the product receives.
//
// Four fixtures are SYNTHETIC, and each says so at its definition, because the
// captured corpus contains no such shape: the anonymous inline struct BODY
// (P1c), the type cycle (P4c), the four-deep chain (P4e), and the field whose
// candidate token is missing from its own declaration line (P2b).
//
// ---------------------------------------------------------------------------
// THE PRE-PHASE-1 CAPTURES, AND WHY THEY COME FROM A COMMIT AND NOT FROM A RUN.
//
// G2, G3 and P6 all say "byte-identical to today"/"to before phase 1", so they
// need a left-hand side. Taking it off the working tree was not available: at
// 2026-08-10 22:05 AEST, while this file was being written, src/vscode/fnGen.ts,
// src/core/crossFileShape.ts and src/core/goExtraction.ts were all being
// modified between one probe and the next, and Go's `dialReach` was observed to
// change from "signatures" to "walk" between two runs eleven minutes apart. A
// baseline scraped off a half-written build is the trap in the
// `measuring-a-moving-artifact` note.
//
// So every frozen string below was captured from COMMIT 00cf79c6ac311442c
// ("session-v48: the context dial, the window guard, and the end of the known-
// red set"), the tip of session-v48 and the last commit before session-v49
// started. Method: `git archive HEAD src | tar -x` into a scratch tree, bundle
// src/vscode/fnGen.ts from THERE against the same vscode stub this file uses,
// and run the identical fixture code that appears below. Verified at capture
// time that rust, typescript, csharp and python render byte-identically at
// 00cf79c and in the working tree, so phase 0 did not move them and these are a
// true phase-1 left-hand side; Go is the one that moved.
//
// ---------------------------------------------------------------------------
// WHAT IS EXPECTED TO BE RED, AND WHY THAT IS THE JOB.
//
//   * Section G (the render decision) and sections P1-P4 were written against
//     an unfinished phase 1. Most of them are expected RED on arrival. A red
//     there is the correct output of a blind oracle, not a regression.
//   * G4 is the ruling row. A field name that vanishes from the whole prompt
//     with nothing on the drop channel is THE defect this phase can ship, and
//     the contract calls it non-negotiable. It is bound on a fixture that
//     forces the truncation rather than on one that hopes for it.
//   * P3 is the row that goes from VACUOUS to LOAD-BEARING. The qualifier-aware
//     single-letter rule was written in session-v37 for a door that phase 1
//     opens. A red there is a genuine defect, never a supersession.
//   * P6a and P6b were GREEN when written and must stay green: they are the
//     four languages phase 1 must not touch.
//   * P5's "whatever the new value is" half cannot be bound to a value by an
//     oracle that must not guess one. It is bound as the two AGREEMENTS the
//     contract states instead - see the section header.
//   * P7 cannot be run here at all. Its one row checks the gate's left-hand
//     side exists and says what the right-hand side needs.
//
// WHAT THIS FILE FOUND WHEN IT WAS FIRST RUN, 2026-08-10 22:15 AEST, against a
// half-landed phase 1. 38 rows, 3 red, all three in section G:
//
//     G1 (both rows)  no data-shape block renders for a resolvable Go struct,
//                     so the field body has not shipped and the member list
//                     still carries every field line - the duplication the
//                     render decision exists to end.
//     G3              same cause: the 120-field fixture cannot construct the
//                     "truncated form" condition while no body renders at all.
//
// Everything in P1, P2, P3 and P4 was ALREADY GREEN: the field parse and the
// anchor had landed by then, including the single-letter rule that had been
// vacuous since v37. Section G is the whole of what was left.
//
// Nothing here needs a live language server, so SKIP_LIVE=1 changes nothing.
//
// Run: SKIP_LIVE=1 CI=1 node --test test/blind-v49-p1-go-fields.test.cjs

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");

const ROOT = path.join(__dirname, "..");
const show = (v) => JSON.stringify(v);
const B = (s) => Buffer.byteLength(String(s), "utf8");

// ===========================================================================
// HARNESS A. The walk, bundled pure. No vscode anywhere on this path.
// ===========================================================================

const A_ENTRY = path.join(__dirname, ".blind-v49-p1-walk.entry.ts");
const A_OUT = path.join(__dirname, ".blind-v49-p1-walk.bundle.cjs");
let WALK = {};
let walkErr;
try {
  fs.writeFileSync(
    A_ENTRY,
    `export { resolveCrossFileShape, shapeHooksFor } from "../src/core/crossFileShape";
export { renderFimCandidates, lineCommentFor } from "../src/core/fimInject";\n`,
  );
  esbuild.buildSync({ entryPoints: [A_ENTRY], bundle: true, outfile: A_OUT, format: "cjs", platform: "node" });
  WALK = require(A_OUT);
} catch (e) {
  walkErr = e;
}

// ===========================================================================
// HARNESS B. `resolvePrefill` and the exported language table, bundled headless
// against a STRUCTURAL vscode stub. Stub mechanics copied verbatim from
// test/blind-v49-p0-freewins.test.cjs, which took them from
// test/impl-v48-p1-context-dial.test.cjs; the output channel is a REAL object
// because resolvePrefill leaves background work in flight and a straggler that
// logs into `{}` throws after the row that started it has ended.
// ===========================================================================

const STUB = path.join(__dirname, ".blind-v49-p1-vscode-stub.cjs");
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
        const c = globalThis.__V49P1_CFG__ || {};
        return Object.prototype.hasOwnProperty.call(c, k) ? c[k] : f;
      },
      has: () => false, inspect: () => undefined, update: async () => {},
    }),
    openTextDocument: (arg) =>
      Promise.resolve({ uri: mkUri(keyOf(arg)), getText: () => (globalThis.__V49P1_FILES__ || {})[keyOf(arg)] }),
  },
};
`,
);

const B_ENTRY = path.join(__dirname, ".blind-v49-p1-fn.entry.ts");
const B_OUT = path.join(__dirname, ".blind-v49-p1-fn.bundle.cjs");
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
    if (walkErr) assert.fail(`the crossFileShape/fimInject bundle did not build: ${walkErr.message}`);
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
  for (const n of ["resolveCrossFileShape", "shapeHooksFor", "renderFimCandidates", "lineCommentFor"]) {
    assert.equal(typeof WALK[n], "function", `${n} must be exported`);
  }
  for (const n of ["resolvePrefill", "prefillLangFor"]) {
    assert.equal(typeof FN[n], "function", `${n} must be exported from src/vscode/fnGen`);
  }
});

// ===========================================================================
// THE REAL CAPTURED HOVERS.
// ===========================================================================

// TRACKED, not read out of a session directory. The capture used to be read
// from `session-v48/`, which `.gitignore` drops, so this file's P1 rows were
// green on the author's box and RED on every fresh clone: CI went red the day
// four sessions' worth of commits were first pushed, and stayed red through a
// release. The guard below is doing its job by FAILING rather than skipping
// (`green-on-my-box-is-not-green`); what was wrong is that the evidence it
// guards was never committed. Copied here byte for byte, hash checked below.
const CAPTURE = path.join(__dirname, "fixtures", "go-hover-capture", "capture-go-hovers.json");
const HOVERS = (() => {
  try {
    return JSON.parse(fs.readFileSync(CAPTURE, "utf8"));
  } catch {
    return undefined;
  }
})();

test("guard: the live gopls capture this file's P1 rows run on is present and is the captured size", () => {
  assert.ok(HOVERS, `${CAPTURE} must exist - every P1 row below runs on those bytes rather than on invented ones`);
  assert.equal(B(HOVERS.Conn), 4356, "pgx.Conn, the 4356 bytes the scout recorded (scout-datashape-3langs.md §2.1)");
  assert.equal(B(HOVERS.ConnConfig), 5110, "pgx.ConnConfig, the 5110 bytes with gopls's synthesised promoted-field table");
});

// The first fenced go block of a hover: the declaration itself. Used ONLY to
// build a plausible def-source file for the fixture's `openFile`, never to
// derive an expectation.
const firstFence = (hover) => {
  const m = /```go\n([\s\S]*?)\n```/.exec(String(hover));
  return m ? m[1] : "";
};

// ===========================================================================
// THE WALK FIXTURE. A fake transport that answers from an in-memory table keyed
// by the word under the cursor, which is how a real server behaves: the walk
// hands it a position, not a name. EVERY call is recorded WITH ITS CURSOR, so a
// row can say how many round trips a field bought and exactly where the anchor
// landed - which is what P2 is about.
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

// `files` maps uri -> text. `defs` maps a type name to { uri, line, character }:
// where a definition provider would place it. `hovers` and `members` are keyed
// by type name. A name absent from `defs` resolves to nothing, the same as a
// server that cannot place it.
function walkFixture({ files, hovers, members = {}, defs }) {
  const calls = [];
  const record = (op, cursor) => {
    const word = wordAt(files[cursor.uri] ?? "", cursor);
    calls.push({ op, word, uri: cursor.uri, line: cursor.line, character: cursor.character });
    return word;
  };
  const extractor = {
    async definition(cursor) {
      const word = record("definition", cursor);
      if (!word || !(word in defs)) return undefined;
      const d = defs[word];
      return {
        uri: d.uri,
        range: { startLine: d.line, startCharacter: d.character, endLine: d.line, endCharacter: d.character + word.length },
      };
    },
    async hoverSurface(cursor) {
      const word = record("hover", cursor);
      return word && word in hovers ? { signature: hovers[word] } : undefined;
    },
    async membersOfType(cursor) {
      const word = record("members", cursor);
      return (members[word] ?? []).map((m) => ({ ...m }));
    },
    async completeMembers() {
      return [];
    },
    async example() {
      return undefined;
    },
    async qualifyImport() {
      return undefined;
    },
  };
  return {
    extractor,
    calls,
    openFile: async (uri) => files[uri],
    rootAt(uri, name, line = 0) {
      const text = (files[uri] || "").split("\n")[line] ?? "";
      return { uri, line, character: text.indexOf(name) };
    },
    spent(name) {
      return calls.filter((c) => c.op === "definition" && c.word === name).length;
    },
    anchors(name) {
      return calls.filter((c) => c.op === "definition" && c.word === name);
    },
  };
}

// Depth 2, per the contract's "Out of scope": depth stays 2. The total-type
// bound is generous so that NO row below is bounded by the fixture rather than
// by the property it is testing.
const GO_BOUND = { D_MAX: 2, N_MAX: 24 };
const goHooks = () => WALK.shapeHooksFor("go");
const keys = (shape) => [...shape.types.keys()];
const fieldsOf = (shape, name) => (shape.types.get(name)?.fields ?? []).map((f) => ({ name: f.name, typeName: f.typeName }));
const fieldNames = (shape, name) => fieldsOf(shape, name).map((f) => f.name);
const dumpWalk = (shape, f) =>
  `\n  types: ${show(keys(shape))}` +
  `\n  dropped: ${show(shape.dropped)}` +
  `\n  fields: ${show(Object.fromEntries(keys(shape).map((k) => [k, fieldsOf(shape, k)])))}` +
  `\n  round trips: ${show(f.calls.filter((c) => c.op === "definition").map((c) => `${c.word}@${c.line}:${c.character}`))}`;

// ---------------------------------------------------------------------------
// The two real-capture walk fixtures. `openFile` returns a def source built
// from the hover's own first fence, which is what the file on disk looks like
// (modulo gopls's chrome comment) and is what the anchor has to read.
// ---------------------------------------------------------------------------

const PGX_URI = "file:///w/pgx/conn.go";
const CONSUMER_URI = "file:///w/pgx/consumer.go";

function realGoFixture(rootName) {
  const decl = firstFence(HOVERS[rootName]);
  const defText = `package pgx\n\n${decl}\n`;
  const defLines = defText.split("\n");
  const declLine = defLines.findIndex((l) => l.startsWith(`type ${rootName} `));
  return walkFixture({
    files: {
      [PGX_URI]: defText,
      [CONSUMER_URI]: `func run(c *${rootName}) {\n\n}\n`,
    },
    // THE RAW CAPTURED HOVER, every byte: both fences, the doc prose, the 42
    // method signatures and the trailing pkg.go.dev line. The scout fed the
    // parser both this and the fence-only form so nobody could attribute an
    // empty answer to the markdown; this file feeds the harder one.
    hovers: { [rootName]: HOVERS[rootName] },
    defs: { [rootName]: { uri: PGX_URI, line: declLine, character: defLines[declLine].indexOf(rootName) } },
    members: { [rootName]: [] },
  });
}

const realGoShape = async (rootName) => {
  const f = realGoFixture(rootName);
  const shape = await WALK.resolveCrossFileShape(
    f.extractor,
    f.rootAt(CONSUMER_URI, rootName),
    GO_BOUND,
    f.openFile,
    goHooks(),
  );
  return { f, shape };
};

// ===========================================================================
// SECTION P1. Go parses its own hover's fields.
//
// EXPECTED RED on arrival. The observable is the walk's own derived field list
// for the type - `shape.types.get(X).fields` - which is what the recursion runs
// on and what the render is built from. No private function is named.
// ===========================================================================

// The contract's worked example, transcribed from contract-phase1.md. These
// four lines are a verbatim subset of the captured `Conn` hover.
const P1_HEADLINE = [
  { name: "pgConn", typeName: "*pgconn.PgConn" },
  { name: "config", typeName: "*ConnConfig" },
  { name: "preparedStatements", typeName: "map[string]*pgconn.StatementDescription" },
  { name: "eqb", typeName: "ExtendedQueryBuilder" },
];

wtest("P1: the contract's worked example - the four named fields come out with the type AS WRITTEN", async () => {
  const { f, shape } = await realGoShape("Conn");
  assert.ok(shape.types.has("Conn"), `CONTROL - the root must resolve at all${dumpWalk(shape, f)}`);
  const got = fieldsOf(shape, "Conn");
  assert.ok(
    got.length > 0,
    `Go derived NO fields from a 4356-byte gopls hover that declares sixteen of them. This is the hole ` +
      `phase 1 closes: the shipped parser wants \`name: Type\` and a Go field line has no colon.${dumpWalk(shape, f)}`,
  );
  for (const want of P1_HEADLINE) {
    const hit = got.find((x) => x.name === want.name);
    assert.ok(hit, `the field ${show(want.name)} is missing; derived ${show(got.map((x) => x.name))}`);
    assert.equal(
      hit.typeName,
      want.typeName,
      `${want.name}: the type must be the type AS WRITTEN in the declaration. A parse that normalises the ` +
        `pointer, the package qualifier or the map away cannot anchor the hop at the token it names`,
    );
  }
});

wtest("P1: sixteen fields, in DECLARATION ORDER, no more and no fewer", async () => {
  // The count is the scout's, measured off the same bytes: "the whole
  // declaration with all 16 fields and their types". Order is asserted as the
  // order the four headline names appear in the hover text itself, so this row
  // needs no transcript of the other twelve.
  const { f, shape } = await realGoShape("Conn");
  const got = fieldNames(shape, "Conn");
  assert.equal(
    got.length,
    16,
    `the captured \`Conn\` declares exactly sixteen fields. Derived ${got.length}: ${show(got)}${dumpWalk(shape, f)}`,
  );
  const order = P1_HEADLINE.map((w) => got.indexOf(w.name));
  assert.deepEqual(
    [...order].sort((a, b) => a - b),
    order,
    `declaration order: ${show(P1_HEADLINE.map((w) => w.name))} appear at ${show(order)} in ${show(got)}`,
  );
});

wtest("P1a: the `// size=304 (0x130), class=320 (0x140)` layout chrome contributes no field", async () => {
  const { f, shape } = await realGoShape("Conn");
  const got = fieldsOf(shape, "Conn");
  assert.ok(got.length > 0, `CONTROL - the parse must have produced fields, or this row measures nothing${dumpWalk(shape, f)}`);
  for (const bad of ["size", "class", "//", "0x130", "0x140"]) {
    assert.equal(
      got.some((x) => x.name === bad || x.typeName === bad),
      false,
      `gopls writes its layout annotation on the header line. ${show(bad)} came back as a field: ${show(got)}`,
    );
  }
  // And the header itself is not a field: `Conn struct {` is not a declaration.
  assert.equal(
    got.some((x) => x.name === "Conn" || /struct \{/.test(x.typeName)),
    false,
    `the header line must not be read as a field of the type it opens: ${show(got)}`,
  );
});

wtest("P1b: doc comments, blank lines and a trailing `// comment` on a field line are all skipped", async () => {
  // `ConnConfig`'s captured hover carries all three shapes in one declaration:
  // three multi-line doc comments above fields, blank separators between them,
  // and `createdByParseConfig bool // Used to enforce created by ParseConfig rule.`
  const { f, shape } = await realGoShape("ConnConfig");
  const got = fieldsOf(shape, "ConnConfig");
  assert.ok(got.length > 0, `CONTROL - the parse must have produced fields${dumpWalk(shape, f)}`);
  const byName = Object.fromEntries(got.map((x) => [x.name, x.typeName]));
  for (const [name, type] of [
    ["Tracer", "QueryTracer"],
    ["connString", "string"],
    ["StatementCacheCapacity", "int"],
    ["DescriptionCacheCapacity", "int"],
    ["DefaultQueryExecMode", "QueryExecMode"],
    ["createdByParseConfig", "bool"],
  ]) {
    assert.equal(byName[name], type, `${name} must derive as ${show(type)}; got ${show(byName[name])} from ${show(got)}`);
  }
  // The trailing comment must not ride along on the type.
  assert.equal(
    /\/\//.test(byName.createdByParseConfig ?? ""),
    false,
    `the trailing \`// Used to enforce created by ParseConfig rule.\` must not become part of the type: ` +
      show(byName.createdByParseConfig),
  );
  // No field is a comment word. `Original`, `StatementCacheCapacity is`, `query`
  // are the first words of the three doc comments in this very hover.
  for (const bad of ["Original", "query", "and", "PGBouncer", "//"]) {
    assert.equal(got.some((x) => x.name === bad), false, `${show(bad)} is doc prose, not a field: ${show(got.map((x) => x.name))}`);
  }
});

// SYNTHETIC. The captured corpus has an anonymous inline struct as a FIELD TYPE
// (`doneChan chan struct{}`, P1f) but no anonymous struct with a BODY, so this
// shape is written by hand. It is the shape P1c names and it is ordinary Go.
const INLINE_STRUCT_HOVER = [
  "type Cfg struct { // size=40 (0x28)",
  "\topts struct {",
  "\t\tRetries int",
  "\t\tVerbose bool",
  "\t}",
  "\tName string",
  "}",
].join("\n");

wtest("P1c: an anonymous inline struct field's own BODY contributes no phantom fields [SYNTHETIC fixture]", async () => {
  const defText = `package app\n\n${INLINE_STRUCT_HOVER}\n`;
  const lines = defText.split("\n");
  const declLine = lines.findIndex((l) => l.startsWith("type Cfg "));
  const f = walkFixture({
    files: { [PGX_URI]: defText, [CONSUMER_URI]: "func run(c *Cfg) {\n\n}\n" },
    hovers: { Cfg: INLINE_STRUCT_HOVER },
    defs: { Cfg: { uri: PGX_URI, line: declLine, character: lines[declLine].indexOf("Cfg") } },
    members: { Cfg: [] },
  });
  const shape = await WALK.resolveCrossFileShape(f.extractor, f.rootAt(CONSUMER_URI, "Cfg"), GO_BOUND, f.openFile, goHooks());
  const got = fieldNames(shape, "Cfg");
  assert.ok(got.length > 0, `CONTROL - the parse must have produced fields${dumpWalk(shape, f)}`);
  assert.ok(got.includes("Name"), `the depth-0 field AFTER the inline body must survive it: ${show(got)}`);
  for (const phantom of ["Retries", "Verbose"]) {
    assert.equal(
      got.includes(phantom),
      false,
      `${show(phantom)} is declared at brace depth 1, inside an anonymous struct. Reading it as a field of ` +
        `\`Cfg\` puts a member in the prompt that \`cfg.${phantom}\` cannot reach.${dumpWalk(shape, f)}`,
    );
  }
});

wtest("P1d: gopls's SECOND fence - the synthesised promoted-field table - is not read as the declaration", async () => {
  // The real thing: `ConnConfig` embeds `pgconn.Config`, and gopls answers with
  // a separate fenced block of 27 `Host string // through Config` rows. It is
  // not the declaration body and must contribute nothing.
  const raw = HOVERS.ConnConfig;
  assert.ok(/\/\/ Embedded fields:/.test(raw), `CONTROL - the captured hover must actually carry the promoted table`);
  assert.ok(/^Host  +string  +\/\/ through Config/m.test(raw), `CONTROL - and its rows must be in the captured form`);
  const { f, shape } = await realGoShape("ConnConfig");
  const got = fieldNames(shape, "ConnConfig");
  assert.ok(got.length > 0, `CONTROL - the parse must have produced fields from the FIRST fence${dumpWalk(shape, f)}`);
  const promoted = [
    "Host", "Port", "Database", "User", "Password", "TLSConfig", "ConnectTimeout", "DialFunc", "LookupFunc",
    "BuildFrontend", "BuildContextWatcherHandler", "RuntimeParams", "KerberosSrvName", "KerberosSpn",
    "Fallbacks", "SSLNegotiation", "AfterNetConnect", "ValidateConnect", "AfterConnect", "OnNotice",
    "OnNotification", "OnPgError", "OAuthTokenProvider", "MinProtocolVersion", "MaxProtocolVersion",
    "ChannelBinding", "RequireAuth",
  ];
  assert.equal(promoted.length, 27, "the scout counted 27 rows in that fence");
  const leaked = promoted.filter((n) => got.includes(n));
  assert.deepEqual(
    leaked,
    [],
    `these came from gopls's synthesised promoted-field table, not from \`ConnConfig\`'s declaration. Reading ` +
      `that fence as a body turns a 7-field type into a 34-field one and spends the type's whole budget on ` +
      `a table the source does not contain.${dumpWalk(shape, f)}`,
  );
  // And the trailing method fence is not a body either.
  assert.equal(got.some((n) => n === "func" || n === "cc"), false, `the method fence must not contribute fields: ${show(got)}`);
});

// The Rust control, in the shape the scout used: the same parser on a
// Rust-shaped hover returned both fields, and that is the leg that must not
// move. Real rust-analyzer render.
const RUST_HOVER = [
  "pub struct Order {",
  "    pub id: u64,",
  "    pub customer: Customer,",
  "    pub lines: Vec<LineItem>,",
  "}",
].join("\n");

wtest("P1e: a Rust hover is not readable as Go fields, and Rust still reads it as Rust", async () => {
  const mk = (lang) => {
    const defText = `${RUST_HOVER}\n`;
    const lines = defText.split("\n");
    return walkFixture({
      files: { [PGX_URI]: defText, [CONSUMER_URI]: "fn run(o: &Order) {\n\n}\n" },
      hovers: { Order: RUST_HOVER },
      defs: { Order: { uri: PGX_URI, line: 0, character: lines[0].indexOf("Order") } },
      members: { Order: [] },
    });
  };
  const fRust = mk();
  const rustShape = await WALK.resolveCrossFileShape(
    fRust.extractor,
    fRust.rootAt(CONSUMER_URI, "Order"),
    GO_BOUND,
    fRust.openFile,
    WALK.shapeHooksFor("rust"),
  );
  const rustFields = fieldNames(rustShape, "Order");
  // CONTROL FIRST. Without this the Go half below would pass against a parser
  // that returns nothing for anything.
  assert.deepEqual(
    rustFields,
    ["id", "customer", "lines"],
    `CONTROL - the Rust leg must still derive all three fields from its own hover. If this is red, phase 1 ` +
      `moved a language it promised not to touch (P6a).${dumpWalk(rustShape, fRust)}`,
  );
  const fGo = mk();
  const goShape = await WALK.resolveCrossFileShape(
    fGo.extractor,
    fGo.rootAt(CONSUMER_URI, "Order"),
    GO_BOUND,
    fGo.openFile,
    goHooks(),
  );
  const goFields = fieldsOf(goShape, "Order");
  for (const rustName of ["id", "customer", "lines"]) {
    assert.equal(
      goFields.some((x) => x.name === rustName),
      false,
      `the Go parse read the Rust field ${show(rustName)}. A \`name: Type\` line is not a Go field ` +
        `declaration and must not be read as one.${dumpWalk(goShape, fGo)}`,
    );
  }
  assert.equal(
    goFields.some((x) => x.name === "pub"),
    false,
    `\`pub id: u64,\` read as \`Name Type\` yields a field called \`pub\`. That is the exact way this ` +
      `parser gets fooled.${dumpWalk(goShape, fGo)}`,
  );
});

wtest("P1f: `doneChan chan struct{}` is a field with no walkable type name, and NOTHING is queued for it", async () => {
  const { f, shape } = await realGoShape("Conn");
  const got = fieldsOf(shape, "Conn");
  assert.ok(got.length > 0, `CONTROL - the parse must have produced fields${dumpWalk(shape, f)}`);
  const done = got.find((x) => x.name === "doneChan");
  assert.ok(done, `"It may appear as a field": \`doneChan\` must be in the list. Got ${show(got.map((x) => x.name))}`);
  // "but nothing may be queued for it". An anonymous inline struct has no name
  // to resolve, so a round trip spent on it is a round trip spent on nothing.
  for (const word of ["struct", "chan", "doneChan"]) {
    assert.equal(
      f.spent(word),
      0,
      `a round trip was spent anchoring ${show(word)} out of \`chan struct{}\`, which names no type. ` +
        `Anchors: ${show(f.anchors(word).map((c) => `${c.line}:${c.character}`))}${dumpWalk(shape, f)}`,
    );
  }
  assert.equal(
    shape.types.has("struct") || shape.types.has("chan"),
    false,
    `nor may either word become an emitted type${dumpWalk(shape, f)}`,
  );
});

wtest("P1g: an EMBEDDED field is either dropped or emitted under its last segment - and never silently gone", async () => {
  // THE CONTRACT DOES NOT SAY WHICH. P1g asks the BUILD to "state which of
  // 'dropped' or 'emitted under its last segment' ships, and hold to it", so an
  // oracle that must not guess binds the DISJUNCTION plus the two properties
  // that hold either way: the choice is deterministic, and the developer can
  // still account for the embedded type. Which branch was taken is printed, so
  // the build's report can quote it rather than invent it.
  const { f, shape } = await realGoShape("ConnConfig");
  const got = fieldsOf(shape, "ConnConfig");
  assert.ok(got.length > 0, `CONTROL - the parse must have produced fields${dumpWalk(shape, f)}`);
  const raw = HOVERS.ConnConfig;
  assert.ok(/^\tpgconn\.Config$/m.test(firstFence(raw)), `CONTROL - the captured declaration must carry the embedded field`);

  const emittedAsLastSegment = got.some((x) => x.name === "Config") || shape.types.has("Config");
  const droppedOutright = !got.some((x) => /(^|\.)Config$/.test(x.name)) && !shape.types.has("Config");
  assert.ok(
    emittedAsLastSegment || droppedOutright,
    `\`pgconn.Config\` came back as neither: ${show(got.map((x) => x.name))}. The two shapes P1g allows are ` +
      `"emitted under its last segment" (a field or type named \`Config\`) and "dropped" (absent ` +
      `everywhere).${dumpWalk(shape, f)}`,
  );
  // Determinism. A rule that answers one way on Monday is not a rule.
  const second = await realGoShape("ConnConfig");
  assert.deepEqual(
    fieldsOf(second.shape, "ConnConfig"),
    got,
    "the same hover must derive the same fields twice - nothing outside the input may reach this",
  );
  // eslint-disable-next-line no-console
  console.log(
    `  [P1g] embedded \`pgconn.Config\` ships as: ${emittedAsLastSegment ? "EMITTED under its last segment" : "DROPPED"}`,
  );
});

// ===========================================================================
// SECTION P2. Go anchors the hop at the field's own type token.
//
// EXPECTED RED on arrival. Today's anchor requires `^\s*(pub )?<field>\s*:` and
// a Go field line has no colon, so it returns nothing for every Go field.
// ===========================================================================

// A same-file, real-shaped Go graph. Every line's column positions matter to
// P2, so the lines are written out with their indices.
const ANCHOR_URI = "file:///w/app/server.go";
const ANCHOR_LINES = [
  /*  0 */ "package app",
  /*  1 */ "",
  /*  2 */ "type Server struct { // size=96 (0x60)",
  /*  3 */ "\tcfg      *Config",
  /*  4 */ "\tmu       sync.Mutex",
  /*  5 */ "\tctx      context.Context",
  /*  6 */ "\tbuf      []byte",
  /*  7 */ "\tdoneChan chan struct{}",
  /*  8 */ "\tcache    map[EntryKey]*Entry",
  /*  9 */ "}",
  /* 10 */ "",
  /* 11 */ "type Config struct {",
  /* 12 */ "\tName string",
  /* 13 */ "}",
  /* 14 */ "",
  /* 15 */ "type Entry struct {",
  /* 16 */ "\tKey EntryKey",
  /* 17 */ "}",
  /* 18 */ "",
  /* 19 */ "type EntryKey struct {",
  /* 20 */ "\tRaw string",
  /* 21 */ "}",
];
const ANCHOR_TEXT = `${ANCHOR_LINES.join("\n")}\n`;
const sliceHover = (from, to) => ANCHOR_LINES.slice(from, to).join("\n");

function anchorFixture(extra = {}) {
  const files = { [ANCHOR_URI]: ANCHOR_TEXT, [CONSUMER_URI]: "func run(s *Server) {\n\n}\n", ...(extra.files || {}) };
  return walkFixture({
    files,
    hovers: {
      Server: sliceHover(2, 10),
      Config: sliceHover(11, 14),
      Entry: sliceHover(15, 18),
      EntryKey: sliceHover(19, 22),
      ...(extra.hovers || {}),
    },
    defs: {
      Server: { uri: ANCHOR_URI, line: 2, character: 5 },
      Config: { uri: ANCHOR_URI, line: 11, character: 5 },
      Entry: { uri: ANCHOR_URI, line: 15, character: 5 },
      EntryKey: { uri: ANCHOR_URI, line: 19, character: 5 },
      ...(extra.defs || {}),
    },
    members: {
      Server: [{ name: "Start", kind: "method", signature: "func (s *Server) Start() error" }],
      Config: [],
      Entry: [],
      EntryKey: [],
      ...(extra.members || {}),
    },
  });
}

const anchorShape = async (f) =>
  WALK.resolveCrossFileShape(f.extractor, f.rootAt(CONSUMER_URI, "Server"), GO_BOUND, f.openFile, goHooks());

wtest("P2a: the anchor lands on the candidate token, AFTER the field name, on the field's own line", async () => {
  const f = anchorFixture();
  const shape = await anchorShape(f);
  assert.ok(shape.types.has("Server"), `CONTROL - the root must resolve${dumpWalk(shape, f)}`);
  assert.ok(
    fieldNames(shape, "Server").length > 0,
    `CONTROL - Go must derive fields before it can anchor one${dumpWalk(shape, f)}`,
  );
  const hits = f.anchors("Config");
  assert.ok(
    hits.length > 0,
    `no cursor was ever placed on \`Config\` in \`cfg      *Config\`. Today's anchor requires a colon on the ` +
      `field line and a Go field line has none, so this is the hole P2 closes.${dumpWalk(shape, f)}`,
  );
  const line3 = ANCHOR_LINES[3];
  const tokenAt = line3.indexOf("Config");
  const nameEnd = line3.indexOf("cfg") + "cfg".length;
  for (const hit of hits) {
    assert.equal(hit.uri, ANCHOR_URI, `the cursor must be in the PARENT's own def source, so \`definition()\` resolves the field's actual type in the parent's scope`);
    assert.equal(hit.line, 3, `the cursor must be on the field's OWN declaration line (line 3, ${show(line3)}); got line ${hit.line}`);
    assert.ok(
      hit.character >= tokenAt && hit.character < tokenAt + "Config".length,
      `the cursor must be INSIDE the candidate token. \`Config\` occupies columns ${tokenAt}..${tokenAt + 5}; ` +
        `the cursor was at ${hit.character}`,
    );
    assert.ok(
      hit.character > nameEnd,
      `and it must be AFTER the field name (which ends at column ${nameEnd}). A cursor on the field NAME is a ` +
        `different LSP leg (typeDefinition) with different failure modes`,
    );
  }
});

wtest("P2b: a candidate whose token is NOT on its declaration line is a reported stop edge, never silent", async () => {
  // SYNTHETIC, and deliberately so: every shape the scout tried anchored
  // cleanly. The mechanism this stands for is real and named in goal.md - a
  // grouped `type ( ... )` declaration is invisible to the column-0 scan, and a
  // hover can outlive the buffer it was read from - but the corpus has no
  // captured instance, so the divergence is manufactured: the hover declares a
  // field the def source does not.
  const hover = ["type Server struct {", "\tcfg    *Config", "\tshadow *Hidden", "}"].join("\n");
  const f = anchorFixture({ hovers: { Server: hover } });
  const shape = await anchorShape(f);
  const derived = fieldNames(shape, "Server");
  assert.ok(derived.includes("shadow"), `CONTROL - the field itself must be derived from the hover; got ${show(derived)}`);
  assert.ok(
    shape.types.has("Config"),
    `CONTROL - the SIBLING field on the same struct must still resolve, or this row is measuring a walk that ` +
      `resolved nothing at all${dumpWalk(shape, f)}`,
  );
  assert.equal(
    shape.types.has("Hidden"),
    false,
    `\`Hidden\` has no anchorable position, so it must not be emitted${dumpWalk(shape, f)}`,
  );
  assert.ok(
    shape.dropped.includes("Hidden"),
    `"a stop edge, and stop edges are reported, never silent". \`Hidden\` was neither emitted nor reported. ` +
      `Dropped: ${show(shape.dropped)}${dumpWalk(shape, f)}`,
  );
});

wtest("P2c: `map[EntryKey]*Entry` names TWO candidate types from one field, and each gets its own anchor", async () => {
  // The contract's own example is `map[string]*pgconn.StatementDescription`,
  // whose two names are a BUILTIN and a project type - so it cannot show two
  // anchors. This fixture makes both halves project types, which is the shape
  // the clause is about: "Each gets its own anchor, and the goal notes each
  // costs a round trip."
  const f = anchorFixture();
  const shape = await anchorShape(f);
  assert.ok(
    fieldNames(shape, "Server").includes("cache"),
    `CONTROL - the map field must be derived at all${dumpWalk(shape, f)}`,
  );
  const line8 = ANCHOR_LINES[8];
  for (const name of ["EntryKey", "Entry"]) {
    const hits = f.anchors(name).filter((c) => c.line === 8);
    assert.ok(
      hits.length > 0,
      `\`${name}\` is one of the two type names in ${show(line8.trim())} and bought no anchor on that line. ` +
        `Anchors seen: ${show(f.calls.filter((c) => c.op === "definition").map((c) => `${c.word}@${c.line}:${c.character}`))}` +
        `${dumpWalk(shape, f)}`,
    );
  }
  const keyAt = f.anchors("EntryKey").filter((c) => c.line === 8).map((c) => c.character);
  const valAt = f.anchors("Entry").filter((c) => c.line === 8).map((c) => c.character);
  assert.ok(
    keyAt.some((k) => !valAt.includes(k)),
    `the two anchors must be at DIFFERENT columns of the same line - the key at ${show(line8.indexOf("EntryKey"))}, ` +
      `the value at ${show(line8.lastIndexOf("Entry"))}. Got key ${show(keyAt)} and value ${show(valAt)}`,
  );
  for (const t of ["Entry", "EntryKey"]) {
    assert.ok(shape.types.has(t), `and both must reach the shape; got ${show(keys(shape))}${dumpWalk(shape, f)}`);
  }
});

// ===========================================================================
// SECTION P3. The single-letter rule is Go's, not Rust's, and it now RUNS.
//
// A test that passed VACUOUSLY here becomes load-bearing. The rule has existed
// since session-v37 and has been unreachable because Go derived no fields; a
// red in this section is a genuine defect, never a supersession.
// ===========================================================================

const P3_URI = "file:///w/app/generic.go";
const P3_LINES = [
  /*  0 */ "package app",
  /*  1 */ "",
  /*  2 */ "type Harness struct {",
  /*  3 */ "\titems  []T",
  /*  4 */ "\tt      *testing.T",
  /*  5 */ "\tconfig *Config",
  /*  6 */ "}",
  /*  7 */ "",
  /*  8 */ "type Config struct {",
  /*  9 */ "\tName string",
  /* 10 */ "}",
  /* 11 */ "",
  /* 12 */ "type T struct {",
  /* 13 */ "\tShadow string",
  /* 14 */ "}",
];
const P3_TEXT = `${P3_LINES.join("\n")}\n`;

const p3Fixture = () =>
  walkFixture({
    files: { [P3_URI]: P3_TEXT, [CONSUMER_URI]: "func run(h *Harness) {\n\n}\n" },
    hovers: {
      Harness: P3_LINES.slice(2, 7).join("\n"),
      Config: P3_LINES.slice(8, 11).join("\n"),
      // Both `T` legs resolve to something, so the walk CAN reach either. It
      // must choose, and the evidence is the field type as written.
      T: P3_LINES.slice(12, 15).join("\n"),
    },
    defs: {
      Harness: { uri: P3_URI, line: 2, character: 5 },
      Config: { uri: P3_URI, line: 8, character: 5 },
      T: { uri: P3_URI, line: 12, character: 5 },
    },
    members: { Harness: [], Config: [], T: [] },
  });

wtest("P3: a bare `T` in `[]T` is a type parameter and buys NO round trip [was vacuous, now load-bearing]", async () => {
  const f = p3Fixture();
  const shape = await WALK.resolveCrossFileShape(f.extractor, f.rootAt(CONSUMER_URI, "Harness"), GO_BOUND, f.openFile, goHooks());
  const derived = fieldNames(shape, "Harness");
  assert.ok(
    derived.includes("items") && derived.includes("t") && derived.includes("config"),
    `CONTROL - all three fields must be derived, or this row is measuring an empty parse: ${show(derived)}${dumpWalk(shape, f)}`,
  );
  assert.ok(
    shape.types.has("Config"),
    `CONTROL - the concrete sibling field in the same struct must resolve, or "T bought nothing" is a claim ` +
      `about a walk that bought nothing at all${dumpWalk(shape, f)}`,
  );
  const bare = f.anchors("T").filter((c) => c.line === 3);
  assert.deepEqual(
    bare.map((c) => c.character),
    [],
    `\`[]T\` on line 3 is a type parameter. The Go standard library declares 186 single-letter structs, so a ` +
      `definition lookup on a bare \`T\` lands somewhere useless and holds a slot a real collaborator ` +
      `needed.${dumpWalk(shape, f)}`,
  );
});

wtest("P3: a QUALIFIED `*testing.T` is a real type and DOES buy its round trip", async () => {
  const f = p3Fixture();
  const shape = await WALK.resolveCrossFileShape(f.extractor, f.rootAt(CONSUMER_URI, "Harness"), GO_BOUND, f.openFile, goHooks());
  assert.ok(
    fieldNames(shape, "Harness").includes("t"),
    `CONTROL - the field must be derived first${dumpWalk(shape, f)}`,
  );
  const qualified = f.anchors("T").filter((c) => c.line === 4);
  assert.ok(
    qualified.length > 0,
    `\`t *testing.T\` on line 4 names a real struct. "The distinguishing evidence is the field type AS ` +
      `WRITTEN - a qualified occurrence is preceded by a dot." A rule that drops every single letter drops ` +
      `\`testing.T\` and \`testing.B\` with it.${dumpWalk(shape, f)}`,
  );
  assert.ok(
    qualified.every((c) => c.character >= P3_LINES[4].lastIndexOf("T")),
    `and the anchor must sit on the \`T\` of \`testing.T\`, at column ${P3_LINES[4].lastIndexOf("T")}; got ` +
      show(qualified.map((c) => c.character)),
  );
});

// ===========================================================================
// SECTION P4. The walk reaches a collaborator graph, and the caps bind.
// ===========================================================================

wtest("P4a: a Go struct with a field of a project type emits BOTH types, not one", async () => {
  const f = anchorFixture();
  const shape = await anchorShape(f);
  assert.ok(shape.types.has("Server"), `CONTROL - the root must resolve${dumpWalk(shape, f)}`);
  assert.ok(
    shape.types.has("Config"),
    `Go emitted one type. It has emitted exactly one type, always, since v1: \`dialReach\` is "signatures" and ` +
      `there is no edge of any kind. Phase 1 is the change that gives it one.${dumpWalk(shape, f)}`,
  );
  assert.ok(keys(shape).length >= 2, `${show(keys(shape))}${dumpWalk(shape, f)}`);
});

wtest("P4b: the hop works CROSS-PACKAGE - a collaborator in another file resolves and is emitted", async () => {
  // The captured shape, at the captured coordinates: `pgConn *pgconn.PgConn` in
  // pgx/conn.go resolves to pgx/pgconn/pgconn.go:76, a different package and a
  // different file (scout §2.2). The def SOURCE carries the same field line the
  // hover does, because the anchor reads the source and a divergence between
  // the two is P2b's case, not this one.
  const HOME = "file:///w/pgx/pgx.go";
  const OTHER = "file:///w/pgx/pgconn/pgconn.go";
  const homeLines = [
    /* 0 */ "package pgx",
    /* 1 */ "",
    /* 2 */ "type Server struct {",
    /* 3 */ "\tcfg    *Config",
    /* 4 */ "\tpgConn *pgconn.PgConn",
    /* 5 */ "}",
    /* 6 */ "",
    /* 7 */ "type Config struct {",
    /* 8 */ "\tName string",
    /* 9 */ "}",
  ];
  const otherLines = ["package pgconn", "", "type PgConn struct {", "\tfrontend string", "}"];
  const f = walkFixture({
    files: {
      [HOME]: `${homeLines.join("\n")}\n`,
      [OTHER]: `${otherLines.join("\n")}\n`,
      [CONSUMER_URI]: "func run(s *Server) {\n\n}\n",
    },
    hovers: {
      Server: homeLines.slice(2, 6).join("\n"),
      Config: homeLines.slice(7, 10).join("\n"),
      PgConn: otherLines.slice(2, 5).join("\n"),
    },
    defs: {
      Server: { uri: HOME, line: 2, character: 5 },
      Config: { uri: HOME, line: 7, character: 5 },
      PgConn: { uri: OTHER, line: 2, character: 5 },
    },
    members: { Server: [], Config: [], PgConn: [] },
  });
  const shape = await WALK.resolveCrossFileShape(f.extractor, f.rootAt(CONSUMER_URI, "Server"), GO_BOUND, f.openFile, goHooks());
  assert.ok(shape.types.has("Config"), `CONTROL - the same-file hop must work in this fixture too${dumpWalk(shape, f)}`);
  assert.ok(
    shape.types.has("PgConn"),
    `the scout resolved \`PgConn\` in \`pgConn *pgconn.PgConn\` to pgconn/pgconn.go:76 live. A package ` +
      `qualifier is not a barrier: the cursor is a POSITION and the server crosses the package for ` +
      `free.${dumpWalk(shape, f)}`,
  );
  const hit = f.anchors("PgConn")[0];
  assert.ok(hit, `and it must have been reached through an anchor, not conjured${dumpWalk(shape, f)}`);
  assert.equal(hit.line, 4, `the anchor sits on the field's own line in the PARENT's file, not in the collaborator's`);
  assert.equal(
    hit.character,
    homeLines[4].lastIndexOf("PgConn"),
    `and on the LAST segment of the qualified name - \`pgconn.PgConn\` names the type \`PgConn\`, at column ` +
      `${homeLines[4].lastIndexOf("PgConn")}; got ${hit.character}`,
  );
});

wtest("P4c: a cycle terminates and each type is emitted ONCE [SYNTHETIC fixture]", async () => {
  // SYNTHETIC. The captured pgx graph has no two-type cycle; the C# corpus does
  // (`CustomerSite` back-references itself through `DpmMonitor`), so the shape
  // is real in the product's world even though this instance is written here.
  const CYC = "file:///w/app/cycle.go";
  const lines = [
    /* 0 */ "package app",
    /* 1 */ "",
    /* 2 */ "type Node struct {",
    /* 3 */ "\tedge *Edge",
    /* 4 */ "}",
    /* 5 */ "",
    /* 6 */ "type Edge struct {",
    /* 7 */ "\tback *Node",
    /* 8 */ "}",
  ];
  const text = `${lines.join("\n")}\n`;
  const f = walkFixture({
    files: { [CYC]: text, [CONSUMER_URI]: "func run(n *Node) {\n\n}\n" },
    hovers: { Node: lines.slice(2, 5).join("\n"), Edge: lines.slice(6, 9).join("\n") },
    defs: { Node: { uri: CYC, line: 2, character: 5 }, Edge: { uri: CYC, line: 6, character: 5 } },
    members: { Node: [], Edge: [] },
  });
  const shape = await WALK.resolveCrossFileShape(f.extractor, f.rootAt(CONSUMER_URI, "Node"), GO_BOUND, f.openFile, goHooks());
  assert.deepEqual(
    keys(shape).sort(),
    ["Edge", "Node"],
    `both halves of the cycle must be emitted, once each${dumpWalk(shape, f)}`,
  );
  // Termination is proved by the row completing, but a walk that looped a few
  // times before giving up would also complete. The round-trip count is the
  // evidence: one anchor per type, not one per revisit.
  assert.ok(f.spent("Node") <= 2, `\`Node\` was anchored ${f.spent("Node")} times - the cycle is being re-walked${dumpWalk(shape, f)}`);
  assert.ok(f.spent("Edge") <= 2, `\`Edge\` was anchored ${f.spent("Edge")} times${dumpWalk(shape, f)}`);
});

wtest("P4d: a std/builtin type is never emitted, and a pure builtin costs no round trip at all", async () => {
  const f = anchorFixture();
  const shape = await anchorShape(f);
  assert.ok(
    shape.types.has("Config"),
    `CONTROL - a PROJECT type in the same struct must be emitted, or "the std types were skipped" is a claim ` +
      `about a walk that skipped everything${dumpWalk(shape, f)}`,
  );
  for (const std of ["Mutex", "Context", "byte", "string", "int"]) {
    assert.equal(
      shape.types.has(std),
      false,
      `${show(std)} was emitted as a collaborator. A developer already knows what a \`sync.Mutex\` is, and ` +
        `each one spends a slot the real graph needed.${dumpWalk(shape, f)}`,
    );
  }
  // The stronger half: a field whose type is a language builtin must not even
  // be asked about. `[]byte` and `chan struct{}` name nothing resolvable.
  for (const word of ["byte", "struct", "chan"]) {
    assert.equal(
      f.spent(word),
      0,
      `a definition round trip was spent on ${show(word)}. On the pre-fill leg each one is real latency ` +
        `against the p95 gate.${dumpWalk(shape, f)}`,
    );
  }
});

wtest("P4e: the depth bound holds at 2 - a type three hops out is not emitted [SYNTHETIC fixture]", async () => {
  // SYNTHETIC. The captured pgx graph is broad rather than deep. Four types in
  // a chain is the smallest fixture that can tell depth 2 from depth 3.
  const CH = "file:///w/app/chain.go";
  const lines = [
    /*  0 */ "package app",
    /*  1 */ "",
    /*  2 */ "type Hop0 struct {",
    /*  3 */ "\tnext *Hop1",
    /*  4 */ "}",
    /*  5 */ "",
    /*  6 */ "type Hop1 struct {",
    /*  7 */ "\tnext *Hop2",
    /*  8 */ "}",
    /*  9 */ "",
    /* 10 */ "type Hop2 struct {",
    /* 11 */ "\tnext *Hop3",
    /* 12 */ "}",
    /* 13 */ "",
    /* 14 */ "type Hop3 struct {",
    /* 15 */ "\tleaf string",
    /* 16 */ "}",
  ];
  const text = `${lines.join("\n")}\n`;
  const at = { Hop0: 2, Hop1: 6, Hop2: 10, Hop3: 14 };
  const f = walkFixture({
    files: { [CH]: text, [CONSUMER_URI]: "func run(h *Hop0) {\n\n}\n" },
    hovers: Object.fromEntries(Object.entries(at).map(([n, l]) => [n, lines.slice(l, l + 3).join("\n")])),
    defs: Object.fromEntries(Object.entries(at).map(([n, l]) => [n, { uri: CH, line: l, character: 5 }])),
    members: { Hop0: [], Hop1: [], Hop2: [], Hop3: [] },
  });
  const shape = await WALK.resolveCrossFileShape(f.extractor, f.rootAt(CONSUMER_URI, "Hop0"), GO_BOUND, f.openFile, goHooks());
  for (const n of ["Hop0", "Hop1", "Hop2"]) {
    assert.ok(shape.types.has(n), `${n} is within depth 2 of the root and must be emitted${dumpWalk(shape, f)}`);
  }
  assert.equal(
    shape.types.has("Hop3"),
    false,
    `\`Hop3\` is three hops from the root and depth is fixed at 2 by session-v48's own reasoning. The ` +
      `contract's "Out of scope" says depth stays 2 in this phase.${dumpWalk(shape, f)}`,
  );
});

// ===========================================================================
// THE PROMPT HARNESS. Sections G, P5 and P6 read the whole injected prompt and
// the whole channel, because that is where the render decision is observable.
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

function promptExtractor(files, defTypes, calls) {
  const known = new Set(Object.keys(defTypes));
  const typeAt = (c) => {
    const w = wordAt(files[c.uri], c);
    return w && known.has(w) ? w : undefined;
  };
  return {
    definition: async (c) => {
      const w = wordAt(files[c.uri], c);
      calls.push({ op: "definition", word: w, line: c.line, character: c.character });
      const t = typeAt(c);
      if (!t) return undefined;
      const d = defTypes[t];
      const ls = files[d.uri].split("\n");
      const ln = ls.findIndex((l) => d.declRe.test(l));
      if (ln < 0) return undefined;
      const ch = Math.max(0, ls[ln].indexOf(t));
      return { uri: d.uri, range: { startLine: ln, startCharacter: ch, endLine: ln, endCharacter: ch + t.length } };
    },
    hoverSurface: async (c) => {
      const t = typeAt(c);
      calls.push({ op: "hover", word: t });
      return t ? { signature: defTypes[t].hover } : undefined;
    },
    membersOfType: async (c) => {
      const t = typeAt(c);
      calls.push({ op: "members", word: t });
      return t ? defTypes[t].members.map((m) => ({ ...m })) : [];
    },
    example: async () => undefined,
    completeMembers: async () => [],
    qualifyImport: async () => undefined,
  };
}

// One Go gesture: a same-file declaration block, a doc comment naming the root
// in backticks (the authored-gesture shape session-v41 measured as the payload
// that actually anchors), and a function to fill in.
const GO_GESTURE_URI = "file:///w/v49p1/app.go";

async function goGesture({ decls, root, defTypes }) {
  const src = ["package app", ""]
    .concat(decls, ["", "// Rebuild rewrites the registry.", "// It works with `" + root + "`.", "func Rebuild() error {", '\tpanic("todo")', "}", ""])
    .join("\n");
  const files = { [GO_GESTURE_URI]: src };
  const record = {
    span: { start: src.indexOf("func Rebuild"), end: src.length - 2 },
    signature: "func Rebuild() error",
    docComment: "// Rebuild rewrites the registry.\n// It works with `" + root + "`.",
    symbolName: "Rebuild",
    languageId: "go",
    kind: "function",
    bodyOnly: false,
    headerIndent: "",
    bodyIndent: "\t",
  };
  const logs = [];
  const calls = [];
  const disclosed = [];
  // MERGED, never deleted: resolvePrefill leaves background work in flight and a
  // straggler that finds the file map gone reports as an unhandled rejection
  // after the row that started it has ended.
  globalThis.__V49P1_FILES__ = { ...(globalThis.__V49P1_FILES__ || {}), ...files };
  const out = await FN.resolvePrefill(promptExtractor(files, defTypes, calls), makeDoc(src, GO_GESTURE_URI), record, (l) =>
    logs.push(String(l)),
  { onDisclosed: (d) => disclosed.push(...d.map((x) => x.name)) });
  return { text: out || "", logs, calls, disclosed, src };
}

// The two prompt sections, read by their own headers. A blind oracle must not
// assume how they are spelled beyond what a run shows, so both are matched by
// the leading phrase plus the fenced block that follows.
const sectionOf = (text, lead, typeName) => {
  const re = new RegExp(`^${lead}[^\\n]*\`${typeName}\`[^\\n]*:\\n\`\`\`[a-z]*\\n[\\s\\S]*?\\n\`\`\``, "m");
  const m = re.exec(String(text));
  return m ? m[0] : undefined;
};
const memberSection = (text, typeName) => sectionOf(text, "Members of ", typeName);
const shapeSection = (text, typeName) => sectionOf(text, "Data shape of ", typeName);
const dumpPrompt = (r) =>
  `\n--- PROMPT (${B(r.text)}B) ---\n${r.text || "(empty)"}\n--- CHANNEL ---\n${r.logs.join("\n") || "(silent)"}\n---`;

// ---------------------------------------------------------------------------
// The Ledger fixtures. `Ledger`, `Party`, `Address` and `Entry` are ordinary
// project types; the shapes are modelled on the captured pgx graph (a pointer
// field to a project struct, a map field, an anonymous channel) but the names
// are local so nothing collides with Go's own std-name stop list.
//
// A NOTE THAT COST AN HOUR: `Conn` cannot be used as a fixture root. Verified
// live against this build - a doc-named candidate called `Conn` is refused
// before any extractor call is made, because `net.Conn` puts the bare name on
// Go's std stop list. Renaming it to `Connx` admits it. So the pgx names are
// used for the WALK rows (where the stop list does not apply) and local names
// for the PROMPT rows.
// ---------------------------------------------------------------------------

const LEDGER_BODY = [
  "type Ledger struct { // size=48 (0x30)",
  "\tbalance int64",
  "\towner   *Party",
  "\tentries map[string]*Entry",
  "}",
];
const LEDGER_TAIL = [
  "",
  "type Party struct {",
  "\tName string",
  "\tAddr *Address",
  "}",
  "",
  "type Address struct {",
  "\tLine1 string",
  "}",
  "",
  "type Entry struct {",
  "\tKey string",
  "}",
];
const LEDGER_MEMBERS = [
  { name: "balance", kind: "field", signature: "balance int64" },
  { name: "owner", kind: "field", signature: "owner *Party" },
  { name: "entries", kind: "field", signature: "entries map[string]*Entry" },
  { name: "Settle", kind: "method", signature: "func (l *Ledger) Settle(ctx context.Context) error" },
  { name: "String", kind: "method", signature: "func (l *Ledger) String() string" },
];
const LEDGER_COLLABS = {
  Party: {
    uri: GO_GESTURE_URI,
    declRe: /^type Party struct/,
    hover: "type Party struct {\n\tName string\n\tAddr *Address\n}",
    members: [
      { name: "Name", kind: "field", signature: "Name string" },
      { name: "Addr", kind: "field", signature: "Addr *Address" },
    ],
  },
  Address: {
    uri: GO_GESTURE_URI,
    declRe: /^type Address struct/,
    hover: "type Address struct {\n\tLine1 string\n}",
    members: [{ name: "Line1", kind: "field", signature: "Line1 string" }],
  },
  Entry: {
    uri: GO_GESTURE_URI,
    declRe: /^type Entry struct/,
    hover: "type Entry struct {\n\tKey string\n}",
    members: [{ name: "Key", kind: "field", signature: "Key string" }],
  },
};

// G1: the hover carries a real body, so a field body CAN render.
const FIX_BODY = {
  root: "Ledger",
  decls: LEDGER_BODY.concat(LEDGER_TAIL),
  defTypes: {
    Ledger: { uri: GO_GESTURE_URI, declRe: /^type Ledger struct/, hover: LEDGER_BODY.join("\n"), members: LEDGER_MEMBERS },
    ...LEDGER_COLLABS,
  },
};

// G2: the head-only hover gopls returns for a type whose body it will not
// render. Nothing is walkable, so no data-shape block can exist.
const FIX_HEADONLY = {
  root: "Ledger",
  decls: LEDGER_BODY.concat(LEDGER_TAIL),
  defTypes: {
    Ledger: { uri: GO_GESTURE_URI, declRe: /^type Ledger struct/, hover: "type Ledger struct", members: LEDGER_MEMBERS },
    ...LEDGER_COLLABS,
  },
};

// G3/G4: a struct wide enough that something must be cut. 120 fields with long
// names, which is not a synthetic exaggeration - `cobra.Command` hovers at 8363
// bytes with 68 field lines and `pgx.Conn` renders 52 members today.
const WIDE_N = 120;
const wideField = (i) => `fieldNumber${String(i).padStart(3, "0")}WithADeliberatelyLongName`;
const wideType = (i) => (i % 7 === 0 ? "*Party" : "string");
const WIDE_BODY = ["type Ledger struct { // size=4096 (0x1000)"]
  .concat(Array.from({ length: WIDE_N }, (_, i) => `\t${wideField(i)} ${wideType(i)}`))
  .concat(["}"]);
const WIDE_MEMBERS = Array.from({ length: WIDE_N }, (_, i) => ({
  name: wideField(i),
  kind: "field",
  signature: `${wideField(i)} ${wideType(i)}`,
})).concat([{ name: "Settle", kind: "method", signature: "func (l *Ledger) Settle(ctx context.Context) error" }]);
const FIX_WIDE = {
  root: "Ledger",
  decls: WIDE_BODY.concat(LEDGER_TAIL),
  defTypes: {
    Ledger: { uri: GO_GESTURE_URI, declRe: /^type Ledger struct/, hover: WIDE_BODY.join("\n"), members: WIDE_MEMBERS },
    ...LEDGER_COLLABS,
  },
};

// ---------------------------------------------------------------------------
// PRE-PHASE-1 CAPTURES, commit 00cf79c6ac311442c, taken 2026-08-10 by running
// the fixtures above against a `git archive HEAD src` tree. See the file header
// for the method and for why a working-tree capture was not usable.
// ---------------------------------------------------------------------------

const HEAD_LEDGER_MEMBERS = [
  "Members of `Ledger` (real signatures, use these exact names, do not invent):",
  "```go",
  "balance int64",
  "owner *Party",
  "entries map[string]*Entry",
  "func (l *Ledger) Settle(ctx context.Context) error",
  "func (l *Ledger) String() string",
  "```",
].join("\n");

const HEAD_WIDE_MEMBERS_HEADER =
  "Members of `Ledger` (a subset — the first 48 of 121; real signatures, use these exact names, do not invent):";

// ===========================================================================
// SECTION G. THE RENDER DECISION.
//
// "The field body ships, and the member list sheds exactly the fields the field
// body actually rendered. Methods stay in the member list, always, untouched."
// ===========================================================================

ftest("G1: when a field body renders, the member list SHEDS those fields and KEEPS every method", async () => {
  const r = await goGesture(FIX_BODY);
  assert.ok(B(r.text) > 0, `CONTROL - the gesture must inject something at all${dumpPrompt(r)}`);
  const shape = shapeSection(r.text, "Ledger");
  assert.ok(
    shape,
    `no data-shape block rendered for a resolvable Go struct with three fields. The render decision says ` +
      `"the field body ships" - this is phase 1's headline deliverable and without it the rest of G1 has no ` +
      `subject.${dumpPrompt(r)}`,
  );
  const rendered = ["balance", "owner", "entries"].filter((n) => new RegExp(`\\b${n}\\b`).test(shape));
  assert.ok(rendered.length > 0, `CONTROL - the block must name at least one field${dumpPrompt(r)}`);

  const members = memberSection(r.text, "Ledger");
  assert.ok(members, `the member list must still exist - G1 sheds fields from it, it does not delete it${dumpPrompt(r)}`);
  for (const name of rendered) {
    assert.equal(
      new RegExp(`^${name} `, "m").test(members),
      false,
      `\`${name}\` is rendered in the field body AND again as a member line. Go's risk is EVICTION, not ` +
        `addition: the same bytes twice is the whole budget spent on half the surface.${dumpPrompt(r)}`,
    );
  }
  for (const method of ["func (l *Ledger) Settle(ctx context.Context) error", "func (l *Ledger) String() string"]) {
    assert.ok(
      members.includes(method),
      `"Methods stay in the member list, always, untouched." Missing: ${show(method)}${dumpPrompt(r)}`,
    );
  }
});

ftest("G1: a field the block did NOT render stays in the member list - the shed is exact, not wholesale", async () => {
  const r = await goGesture(FIX_BODY);
  const shape = shapeSection(r.text, "Ledger");
  const members = memberSection(r.text, "Ledger");
  assert.ok(shape && members, `CONTROL - both sections must be present for this row to have a subject${dumpPrompt(r)}`);
  for (const name of ["balance", "owner", "entries"]) {
    const inBody = new RegExp(`\\b${name}\\b`).test(shape);
    const inMembers = new RegExp(`^${name} `, "m").test(members);
    assert.equal(
      inBody || inMembers,
      true,
      `\`${name}\` is in NEITHER the field body nor the member list. "drops the member lines that correspond ` +
        `to fields the block rendered, and keeps every other member" - a field in neither place is the G4 ` +
        `defect arriving through G1's door.${dumpPrompt(r)}`,
    );
    assert.equal(
      inBody && inMembers,
      false,
      `\`${name}\` is in BOTH. Exactly one of the two places carries a given field.${dumpPrompt(r)}`,
    );
  }
});

ftest("G2: when NO field body renders, the member list is byte-identical to the pre-phase-1 capture", async () => {
  const r = await goGesture(FIX_HEADONLY);
  assert.ok(B(r.text) > 0, `CONTROL - the gesture must inject something${dumpPrompt(r)}`);
  assert.equal(
    shapeSection(r.text, "Ledger"),
    undefined,
    `CONTROL - this fixture's hover is head-only (\`type Ledger struct\`), so there is nothing to render a ` +
      `field body from. If a block appeared, the fixture no longer constructs G2's condition and the ` +
      `assertion below would be about something else.${dumpPrompt(r)}`,
  );
  const members = memberSection(r.text, "Ledger");
  assert.ok(members, `the member list must be there at all${dumpPrompt(r)}`);
  assert.equal(
    members,
    HEAD_LEDGER_MEMBERS,
    `"A walk that resolves nothing must not cost a developer the list they have now." This is the member ` +
      `section this same fixture produced at commit 00cf79c, byte for byte, fields included.${dumpPrompt(r)}`,
  );
});

ftest("G2: and it still carries EVERY field line - the fields are the half that can go missing", async () => {
  const r = await goGesture(FIX_HEADONLY);
  const members = memberSection(r.text, "Ledger");
  assert.ok(members, `CONTROL - the member list must exist${dumpPrompt(r)}`);
  for (const m of LEDGER_MEMBERS) {
    assert.ok(
      members.includes(m.signature),
      `${show(m.kind)} member ${show(m.name)} is missing from a member list that nothing evicted from. ` +
        `Got:\n${members}${dumpPrompt(r)}`,
    );
  }
});

ftest("G3: when the field body renders TRUNCATED, the member list is byte-identical to today, fields included", async () => {
  const r = await goGesture(FIX_WIDE);
  assert.ok(B(r.text) > 0, `CONTROL - the gesture must inject something${dumpPrompt(r)}`);
  const shape = shapeSection(r.text, "Ledger");
  const members = memberSection(r.text, "Ledger");
  assert.ok(members, `CONTROL - the member list must exist${dumpPrompt(r)}`);

  // The G3 CONDITION has to be constructed before it can be tested. If this
  // fixture stops truncating, the row below would pass while measuring the G1
  // case instead - so a fixture that no longer builds the condition is a LOUD
  // failure, not a quiet pass. It is a fixture defect, not a product defect,
  // and the fix is to widen the struct, not to re-cut the row.
  assert.ok(
    shape,
    `FIXTURE: no field body rendered for a 120-field struct, so the "truncated form" G3 is about was never ` +
      `constructed. If the product legitimately declines to render a body this wide, G3's condition has ` +
      `moved and the contract needs re-reading; if the budget simply grew, widen WIDE_N.${dumpPrompt(r)}`,
  );
  const inBody = Array.from({ length: WIDE_N }, (_, i) => wideField(i)).filter((n) => shape.includes(n));
  assert.ok(
    inBody.length > 0 && inBody.length < WIDE_N,
    `FIXTURE: the field body rendered ${inBody.length} of ${WIDE_N} fields. G3 needs a body the walk's budget ` +
      `CUT - all of them or none of them is a different case. Widen WIDE_N until it cuts.${dumpPrompt(r)}`,
  );

  assert.equal(
    members.split("\n")[0],
    HEAD_WIDE_MEMBERS_HEADER,
    `the member list's own header must be what it was at commit 00cf79c - the same subset, the same counts. ` +
      `"Fields may be cut from one place or the other, never from both."${dumpPrompt(r)}`,
  );
  for (let i = 0; i < 48; i++) {
    assert.ok(
      members.includes(`${wideField(i)} ${wideType(i)}`),
      `field ${i} was in the member list at 00cf79c and is gone now, while the field body was ALSO ` +
        `truncated.${dumpPrompt(r)}`,
    );
  }
});

ftest("G4 (THE RULING ROW): no field name disappears from the whole prompt without appearing on the channel", async () => {
  const r = await goGesture(FIX_WIDE);
  assert.ok(B(r.text) > 0, `CONTROL - the gesture must inject something${dumpPrompt(r)}`);
  assert.ok(r.logs.length > 0, `CONTROL - the gesture must have said something on the channel at all${dumpPrompt(r)}`);

  const declared = Array.from({ length: WIDE_N }, (_, i) => wideField(i));
  const inPrompt = declared.filter((n) => r.text.includes(n));
  const missing = declared.filter((n) => !r.text.includes(n));

  // ANTI-VACUITY, both directions. A run where nothing was cut proves nothing,
  // and a run where everything was cut means the prompt is empty.
  assert.ok(
    inPrompt.length > 0,
    `CONTROL - the prompt must carry SOME of the fields, or this row is scoring an empty injection${dumpPrompt(r)}`,
  );
  assert.ok(
    missing.length >= 40,
    `CONTROL - this fixture exists to force a large truncation. Only ${missing.length} of ${WIDE_N} fields were ` +
      `cut, which is not enough to make the accounting claim mean anything. Widen WIDE_N.${dumpPrompt(r)}`,
  );

  const channel = r.logs.join("\n");
  const unaccounted = missing.filter((n) => !channel.includes(n));
  assert.deepEqual(
    unaccounted,
    [],
    `${unaccounted.length} of the ${missing.length} cut field names appear NOWHERE - not in the prompt, not on ` +
      `the channel. This is the R2 ruling and the contract calls it non-negotiable: "Between the member ` +
      `list's own truncation line and the walk's drop line, a developer can always account for what is ` +
      `missing." A field that vanishes silently is a field the model will invent.\nFIRST TEN UNACCOUNTED: ` +
      `${show(unaccounted.slice(0, 10))}${dumpPrompt(r)}`,
  );
});

ftest("G4: the truncation the developer READS is honest about its own size", async () => {
  // The in-prompt half of the same ruling. The channel names the individual
  // losses; the prompt must at least tell the reader that a subset is what they
  // are looking at, or the surface reads as complete and "do not invent" turns
  // into "invent nothing beyond these 48" when there are 121.
  const r = await goGesture(FIX_WIDE);
  const members = memberSection(r.text, "Ledger");
  assert.ok(members, `CONTROL - the member list must exist${dumpPrompt(r)}`);
  const head = members.split("\n")[0];
  const nums = (head.match(/\d+/g) || []).map(Number);
  assert.ok(
    /subset|first \d+|of \d+/i.test(head),
    `the member list is a subset of ${WIDE_N + 1} members and its header does not say so: ${show(head)}${dumpPrompt(r)}`,
  );
  assert.ok(
    nums.includes(WIDE_N + 1),
    `and the header must name the TRUE total (${WIDE_N + 1}); it printed ${show(nums)}${dumpPrompt(r)}`,
  );
});

// ===========================================================================
// SECTION P5. The channel stops lying.
//
// WHAT CANNOT BE BOUND HERE, STATED RATHER THAN GUESSED: the contract says
// "Go's declared dial reach moves off `signatures`" and then "whatever the new
// value is". An oracle that picked "walk" or "graph" would be writing the
// implementation's decision into a test, which is the one thing this file must
// not do. So P5 binds the three things the contract DOES fix:
//   1. the value is no longer `signatures`;
//   2. the phase-0 rows that recorded the old value moved in this same change;
//   3. a language's declared reach and the shape of its channel line still
//      agree - "one fact told twice".
// ===========================================================================

const LANGS = ["rust", "typescript", "csharp", "python", "go"];
const PREFIX = "[fngen] injected context:";

ftest("P5: Go's declared dial reach has moved OFF `signatures`", () => {
  const entry = FN.prefillLangFor("go");
  assert.ok(entry && "dialReach" in entry, `CONTROL - the language table must expose a reach for go: ${show(entry)}`);
  assert.notEqual(
    entry.dialReach,
    "signatures",
    `"Go's declared dial reach moves off \`signatures\`, and the channel line it drives moves with it, in this ` +
      `same change." \`signatures\` means "member signatures only, with no data-shape walk and no graph ` +
      `edges", which is exactly what phase 1 stops being true.`,
  );
  // And it is still one of the vocabulary's values, so a fourth invented here is
  // seen rather than absorbed.
  assert.ok(
    ["walk", "graph"].includes(entry.dialReach),
    `the reach must be one of the classifications the table already has; got ${show(entry.dialReach)}`,
  );
});

ftest("P5: the phase-0 tripwire came due - its recorded value for go IS the live value", () => {
  // "The phase 0 rows that bind today's values MUST be updated here; a red there
  // after phase 1 with no corresponding value moved is a defect." Bound on the
  // phase-0 file's SOURCE, so it is red both ways round: if the product moved
  // and the file did not, and if the file was re-cut to a value the product does
  // not hold.
  const P0 = path.join(__dirname, "blind-v49-p0-freewins.test.cjs");
  assert.ok(fs.existsSync(P0), `${P0} must exist - it is the file that recorded the pre-phase-1 values`);
  const src = fs.readFileSync(P0, "utf8");
  const table = /const REACH = \{([\s\S]*?)\};/.exec(src);
  assert.ok(table, `CONTROL - the phase-0 reach table must still be readable from that file; it is what this row scores`);
  const row = /\bgo:\s*"([a-z]+)"/.exec(table[1]);
  assert.ok(row, `CONTROL - the table must still carry a row for go: ${show(table[1])}`);
  const live = FN.prefillLangFor("go").dialReach;
  assert.equal(
    row[1],
    live,
    `test/blind-v49-p0-freewins.test.cjs records go as ${show(row[1])} and the product answers ${show(live)}. ` +
      `Those two move together, in one commit, with a one-line note saying which leg did it - that is what ` +
      `the phase-0 tripwire's own failure message asks for.`,
  );
});

// The prompt fixtures the P5/P6 rows share: one minimal gesture per language.
// Copied in structure from test/blind-v49-p0-freewins.test.cjs so the two files
// are comparing the same thing.
const WS = "file:///work/v49p1";
const CANDIDATES = ["Cand00", "Cand01", "Cand02"];
const FIVE = {
  rust: {
    ext: "rs",
    symbol: "build",
    docLine: "/// Build the thing.",
    signature: (n) => `pub fn build(${n.map((t, i) => `p${i}: ${t}`).join(", ")}) -> u32`,
    body: "    todo!()\n}",
    bodyIndent: "    ",
    def: (t) => `pub struct ${t} { pub slot_number_field: u32, pub label_for_the_slot: String }\n`,
    hover: (t) => `pub struct ${t} {\n    pub slot_number_field: u32,\n    pub label_for_the_slot: String,\n}`,
    members: () => [{ name: "compute0", kind: "method", signature: "pub fn compute0(&self, a: u32) -> u32" }],
  },
  typescript: {
    ext: "ts",
    symbol: "build",
    docLine: "/** Build the thing. */",
    signature: (n) => `export function build(${n.map((t, i) => `p${i}: ${t}`).join(", ")}): number`,
    body: "  throw new Error();\n}",
    bodyIndent: "  ",
    def: (t) => `export class ${t} { slotNumberField: number = 0; labelForTheSlot: string = ""; }\n`,
    hover: (t) => `class ${t}`,
    members: () => [{ name: "compute0", kind: "method", signature: "compute0(a: number): number" }],
  },
  csharp: {
    ext: "cs",
    symbol: "Build",
    docLine: "/// <summary>Build the thing.</summary>",
    signature: (n) => `public uint Build(${n.map((t, i) => `${t} p${i}`).join(", ")})`,
    body: "    throw new NotImplementedException();\n}",
    bodyIndent: "    ",
    def: (t) => `public class ${t} { public uint SlotNumberField; public string LabelForTheSlot; }\n`,
    hover: (t) => `class ${t}`,
    members: () => [{ name: "Compute0", kind: "method", signature: "public uint Compute0(uint a)" }],
  },
  python: {
    ext: "py",
    symbol: "build",
    docLine: '"""Build the thing."""',
    signature: (n) => `def build(${n.map((t, i) => `p${i}: ${t}`).join(", ")}) -> int:`,
    body: "    raise NotImplementedError",
    bodyIndent: "    ",
    def: (t) => `class ${t}:\n    slot_number_field: int = 0\n    label_for_the_slot: str = ""\n`,
    hover: (t) => `class ${t}`,
    members: () => [{ name: "compute0", kind: "method", signature: "def compute0(self, a: int) -> int" }],
  },
  go: {
    ext: "go",
    symbol: "Build",
    docLine: "// Build the thing.",
    signature: (n) => `func Build(${n.map((t, i) => `p${i} ${t}`).join(", ")}) uint32`,
    body: '\tpanic("todo")\n}',
    bodyIndent: "\t",
    def: (t) => `type ${t} struct { SlotNumberField uint32; LabelForTheSlot string }\n`,
    hover: (t) => `type ${t} struct`,
    members: (t) => [{ name: "Compute0", kind: "method", signature: `func (r *${t}) Compute0(a uint32) uint32` }],
  },
};

function fiveExtractor(files, defTypes) {
  const known = new Set(Object.keys(defTypes));
  const typeAtCursor = (uri, cursor) => {
    const text = files[uri];
    if (text === undefined) return undefined;
    const w = wordAt(text, cursor);
    if (w && known.has(w)) return w;
    const line = text.split("\n")[cursor.line] ?? "";
    const on = [...new Set(line.match(/[A-Za-z_][A-Za-z0-9_]*/g) || [])].filter((x) => known.has(x));
    return on.length === 1 ? on[0] : undefined;
  };
  const defLocFor = (t) => {
    const uri = defTypes[t].uri;
    const lines = (files[uri] || "").split("\n");
    const ln = lines.findIndex((l) => new RegExp(`\\b${t}\\b`).test(l));
    if (ln < 0) return undefined;
    const ch = lines[ln].indexOf(t);
    return { uri, range: { startLine: ln, startCharacter: ch, endLine: ln, endCharacter: ch + t.length } };
  };
  return {
    definition: async (c) => {
      const t = typeAtCursor(c.uri, c);
      return t ? defLocFor(t) : undefined;
    },
    hoverSurface: async (c) => {
      const t = typeAtCursor(c.uri, c);
      const h = t ? defTypes[t].hover : undefined;
      return h ? { signature: h } : undefined;
    },
    membersOfType: async (c) => {
      const t = typeAtCursor(c.uri, c);
      return (t && defTypes[t].members) || [];
    },
    example: async () => undefined,
    completeMembers: async () => [],
    qualifyImport: async () => undefined,
  };
}

async function fiveGesture(languageId) {
  const F = FIVE[languageId];
  const mainUri = `${WS}/main.${F.ext}`;
  const signature = F.signature(CANDIDATES);
  const src =
    languageId === "python"
      ? `${signature}\n    ${F.docLine}\n${F.body}\n`
      : `${F.docLine}\n${signature} {\n${F.body}\n`;
  const files = { [mainUri]: src };
  const defTypes = {};
  for (const t of CANDIDATES) {
    const uri = `${WS}/${t.toLowerCase()}.${F.ext}`;
    files[uri] = F.def(t);
    defTypes[t] = { uri, hover: F.hover(t), members: F.members(t) };
  }
  const record = {
    span: { start: src.indexOf(signature), end: src.length - 1 },
    signature,
    docComment: "Build the thing.",
    symbolName: F.symbol,
    languageId,
    kind: "function",
    bodyOnly: false,
    headerIndent: "",
    bodyIndent: F.bodyIndent,
  };
  const logs = [];
  globalThis.__V49P1_FILES__ = { ...(globalThis.__V49P1_FILES__ || {}), ...files };
  const out = await FN.resolvePrefill(fiveExtractor(files, defTypes), makeDoc(src, mainUri), record, (l) => logs.push(String(l)));
  return { text: out || "", logs, lines: logs.filter((l) => l.includes(PREFIX)) };
}

// The line's SHAPE: its text with every run of digits collapsed, so two
// languages that differ only in the numbers their caps resolved to count as the
// same shape. Shape carries the classification; the numbers carry the stop.
const shapeOfLine = (line) => String(line).replace(/\d+/g, "#");

// ADDED 2026-08-11, session-v50 phase 3. The three classifications the product's
// channel-line builder branches on, and one CARRIER language to drive them.
//
// Why a carrier is needed at all: session-v50 gave C# and Python a field walk of
// their own, so all five languages now declare `walk` and neither `graph` nor
// `signatures` is held by anything. The row below compares rows PAIRWISE, and
// five rows in one class make every pair trivially agree.
//
// Driving a reach runs the product's real path. `dialReach` is read in exactly one
// place, the channel-line builder, and nowhere in the gather or the render, so an
// overridden entry differs from an ordinary gesture only in the branch under test.
// The ANCHOR assertion in the row proves that per run rather than assuming it.
const REACH_VOCAB = ["walk", "graph", "signatures"];
const CARRIER = "rust";
const UNHELD = () => REACH_VOCAB.filter((v) => !LANGS.some((l) => FN.prefillLangFor(l).dialReach === v));

// One carrier gesture with `dialReach` forced. Restored in a `finally` so a failed
// assertion cannot leak a mutated table into the rows that run after this one.
async function lineAtReach(reach) {
  const entry = FN.prefillLangFor(CARRIER);
  assert.ok(entry && "dialReach" in entry, `CONTROL - ${CARRIER} must expose a dialReach to drive`);
  const was = entry.dialReach;
  try {
    entry.dialReach = reach;
    const r = await fiveGesture(CARRIER);
    assert.equal(r.lines.length, 1, `CONTROL - ${CARRIER} at reach=${show(reach)} must log exactly one line`);
    return r.lines[0];
  } finally {
    entry.dialReach = was;
  }
}

// RE-CUT 2026-08-11, session-v50 phase 3, and it is the row's SOURCE that moved
// rather than its expectation. Python followed C# to `walk`, so all five languages
// are classified alike and both CONTROLs fired: reach stopped varying and so did
// line shape. The controls were right - a pairwise agreement claim over five rows
// in one class checks one branch and calls it a partition.
//
// THE JUDGEMENT. The five real languages stay, because they are what this row is
// FOR: it catches a half-move, a declaration edited without its line. Added to them
// is one carrier-driven row per classification no language holds, which puts the
// other branches back in the comparison. A driven row cannot catch a half-move by
// itself - its reach is forced - so it is an ADDITION to the five and never a
// replacement, and the row asserts that count explicitly.
ftest("P5: a language's declared reach and the SHAPE of its channel line are still one fact told twice", async () => {
  // Neither half is compared to a transcribed table here, only to the OTHER
  // half, so a build that moves one and forgets the other turns red even if it
  // moved the one it meant to move. This is the row that catches "the reach
  // moved, the channel kept printing the old story", which the contract says is
  // the single place this change can degrade correctness silently.
  const rows = [];
  for (const lang of LANGS) {
    const r = await fiveGesture(lang);
    assert.equal(r.lines.length, 1, `CONTROL - ${lang} must log exactly one ${show(PREFIX)} line; got ${r.lines.length}`);
    const entry = FN.prefillLangFor(lang);
    assert.ok(entry && "dialReach" in entry, `CONTROL - ${lang} must expose a dialReach`);
    rows.push({ lang, reach: entry.dialReach, line: r.lines[0], shape: shapeOfLine(r.lines[0]), driven: false });
  }
  // ANCHOR. The override drives the product's real path, and the proof is that
  // forcing the carrier to its OWN declared reach reproduces its unforced line
  // byte for byte. Without it the driven rows could be shapes nothing ever prints.
  const plain = rows.find((x) => x.lang === CARRIER);
  assert.ok(plain, `CONTROL - ${CARRIER} must be among the languages read`);
  assert.equal(
    await lineAtReach(plain.reach),
    plain.line,
    `ANCHOR - forcing ${CARRIER} to its own declared reach (${show(plain.reach)}) must reproduce the line it ` +
      `prints unforced. If it does not, the driven rows below are about a fiction.`,
  );
  const unheld = UNHELD();
  for (const reach of unheld) {
    const line = await lineAtReach(reach);
    rows.push({ lang: `${CARRIER}@${reach}`, reach, line, shape: shapeOfLine(line), driven: true });
  }
  const table = rows
    .map((x) => `    ${x.lang.padEnd(16)} reach=${String(x.reach).padEnd(11)}${x.driven ? " (driven)" : ""}\n      ${x.line}`)
    .join("\n");
  assert.equal(
    rows.filter((x) => !x.driven).length,
    LANGS.length,
    `CONTROL - every real language must still be read here; the driven rows are an addition to them\n${table}`,
  );
  assert.ok(new Set(rows.map((x) => x.reach)).size > 1, `CONTROL - reach must vary across the rows read\n${table}`);
  assert.ok(new Set(rows.map((x) => x.shape)).size > 1, `CONTROL - line shape must vary across the rows read\n${table}`);
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i];
      const b = rows[j];
      if ((a.reach === b.reach) === (a.shape === b.shape)) continue;
      const how = (x) => (x.driven ? `${x.lang} (reach DRIVEN on the carrier)` : x.lang);
      assert.fail(
        a.reach === b.reach
          ? `${how(a)} and ${how(b)} are both classified ${show(a.reach)} and print DIFFERENT line shapes.\n${table}`
          : `${how(a)} is ${show(a.reach)} and ${how(b)} is ${show(b.reach)}, and their channel lines are ` +
              `IDENTICAL in shape. One of the two moved and its line did not follow.\n${table}`,
      );
    }
  }
});

ftest("P5: Go's channel line no longer tells a developer the walk buys nothing in this language", async () => {
  // The half of P5 that is a direct consequence of the value moving, whatever
  // the value turns out to be: the "buys nothing" clause is what makes the line
  // a lie the moment a field walk exists, and the contract names that line as
  // the one silent-degradation site.
  const r = await fiveGesture("go");
  assert.equal(r.lines.length, 1, `CONTROL - exactly one line to read; got ${show(r.lines)}`);
  const line = r.lines[0];
  const reach = FN.prefillLangFor("go").dialReach;
  if (reach === "walk") {
    assert.equal(
      /\bbuys?\s+nothing\b/i.test(line),
      false,
      `go now reaches ${show(reach)}, so its line must not carry a "buys nothing" clause at all.\n  ${line}`,
    );
  } else {
    const m = /\bbuys?\s+nothing\b/i.exec(line);
    assert.ok(m, `go reaches ${show(reach)}, which the table's other member (csharp) explains with a clause.\n  ${line}`);
    assert.equal(
      /no data-shape walk/i.test(line),
      false,
      `go reaches ${show(reach)} and its line still says it has no data-shape walk. Phase 1 gives it one.\n  ${line}`,
    );
  }
});

// ===========================================================================
// SECTION P6. NOTHING ELSE MOVES.
//
// GREEN when written and they must STAY green. Every string below is the
// prompt the identical fixture produced at commit 00cf79c - see the file
// header. A red here is phase 1 reaching into a language it promised not to.
// ===========================================================================

const HEAD_PROMPTS = {
  rust: [
    "Data shape of `Cand00` (fields and types, nested):",
    "```rust",
    "pub struct Cand00 {",
    "    pub slot_number_field: u32,",
    "    pub label_for_the_slot: String,",
    "}",
    "```",
    "",
    "API surface for `Cand00` (real signatures, use these exact names, do not invent):",
    "```",
    "pub fn compute0(&self, a: u32) -> u32",
    "```",
    "",
    "Data shape of `Cand01` (fields and types, nested):",
    "```rust",
    "pub struct Cand01 {",
    "    pub slot_number_field: u32,",
    "    pub label_for_the_slot: String,",
    "}",
    "```",
    "",
    "API surface for `Cand01` (real signatures, use these exact names, do not invent):",
    "```",
    "pub fn compute0(&self, a: u32) -> u32",
    "```",
    "",
    "Data shape of `Cand02` (fields and types, nested):",
    "```rust",
    "pub struct Cand02 {",
    "    pub slot_number_field: u32,",
    "    pub label_for_the_slot: String,",
    "}",
    "```",
    "",
    "API surface for `Cand02` (real signatures, use these exact names, do not invent):",
    "```",
    "pub fn compute0(&self, a: u32) -> u32",
    "```",
    "",
    "Call ONLY methods and constructors of `Cand00`, `Cand01` and `Cand02` that appear in the API surface above. Do not invent methods beyond that surface. Everything else in the file is unaffected by this: calls on other values in scope, on the receiver's own fields, on sibling functions, and on standard-library types stay allowed. If a builder chain ends at a method returning the target type, that value IS the target; do not append any further call.",
  ].join("\n"),
  typescript: [
    "Data shape of `Cand00` (fields and types, nested):",
    "```ts",
    "class Cand00",
    "```",
    "",
    "Members of `Cand00` (real signatures, use these exact names, do not invent):",
    "```ts",
    "compute0(a: number): number",
    "```",
    "",
    "Data shape of `Cand01` (fields and types, nested):",
    "```ts",
    "class Cand01",
    "```",
    "",
    "Members of `Cand01` (real signatures, use these exact names, do not invent):",
    "```ts",
    "compute0(a: number): number",
    "```",
    "",
    "Data shape of `Cand02` (fields and types, nested):",
    "```ts",
    "class Cand02",
    "```",
    "",
    "Members of `Cand02` (real signatures, use these exact names, do not invent):",
    "```ts",
    "compute0(a: number): number",
    "```",
    "",
    "Use ONLY the members and types of `Cand00`, `Cand01` and `Cand02` that appear in the surface above. Do not invent members, fields, or types beyond that surface. Everything else in the file is unaffected by this: other values in scope, this function's own locals, sibling functions, and standard-library types stay allowed.",
  ].join("\n"),
  csharp: [
    "Members of `Cand00` (real signatures, use these exact names, do not invent):",
    "```cs",
    "public uint Compute0(uint a)",
    "```",
    "",
    "Members of `Cand01` (real signatures, use these exact names, do not invent):",
    "```cs",
    "public uint Compute0(uint a)",
    "```",
    "",
    "Members of `Cand02` (real signatures, use these exact names, do not invent):",
    "```cs",
    "public uint Compute0(uint a)",
    "```",
    "",
    "Use ONLY the members and types of `Cand00`, `Cand01` and `Cand02` that appear in the surface above. Do not invent members, fields, or types beyond that surface. Everything else in the file is unaffected by this: other values in scope, this function's own locals, sibling functions, and standard-library types stay allowed.",
  ].join("\n"),
  python: [
    "Members of `Cand00` (real signatures, use these exact names, do not invent):",
    "```python",
    "def compute0(self, a: int) -> int",
    "```",
    "",
    "Members of `Cand01` (real signatures, use these exact names, do not invent):",
    "```python",
    "def compute0(self, a: int) -> int",
    "```",
    "",
    "Members of `Cand02` (real signatures, use these exact names, do not invent):",
    "```python",
    "def compute0(self, a: int) -> int",
    "```",
    "",
    "Use ONLY the members and types of `Cand00`, `Cand01` and `Cand02` that appear in the surface above. Do not invent members, attributes, or types beyond that surface. Everything else in the file is unaffected by this: other values in scope, this function's own locals, sibling functions, and standard-library types stay allowed.",
  ].join("\n"),
};

for (const [lang, clause] of [["rust", "P6a"], ["typescript", "P6a"], ["csharp", "P6b"], ["python", "P6b"]]) {
  ftest(`${clause} [${lang}]: the injected prompt is BYTE-IDENTICAL to commit 00cf79c, before phase 1`, async () => {
    const r = await fiveGesture(lang);
    assert.ok(B(r.text) > 0, `CONTROL - the ${lang} gesture must inject something, or byte-identity is trivial`);
    assert.equal(
      r.text,
      HEAD_PROMPTS[lang],
      `${lang} shares the walk and the parser registry with Go. ${clause} says it must not shift.\n` +
        `--- NOW (${B(r.text)}B) ---\n${r.text}\n--- 00cf79c (${B(HEAD_PROMPTS[lang])}B) ---\n${HEAD_PROMPTS[lang]}\n---`,
    );
  });
}

// The FIM injection block for a Go member site, at commit 00cf79c.
const HEAD_FIM_GO = [
    "// available here (use one of these exact names, do not invent):",
    "// func (l *Ledger) Settle(ctx context.Context) error",
    "// func (l *Ledger) String() string",
    "// balance int64",
  ].join("\n");
const FIM_MEMBERS = [
  { name: "Settle", kind: "method", signature: "func (l *Ledger) Settle(ctx context.Context) error" },
  { name: "String", kind: "method", signature: "func (l *Ledger) String() string" },
  { name: "balance", kind: "field", signature: "balance int64" },
];

wtest("P6c: FIM is untouched - the Go member-site injection is byte-identical to commit 00cf79c", () => {
  const token = WALK.lineCommentFor("go");
  assert.equal(token, "//", "CONTROL - Go's own line-comment token");
  const block = WALK.renderFimCandidates(FIM_MEMBERS, "", token);
  assert.ok(B(block) > 0, "CONTROL - the FIM block must render something, or byte-identity is trivial");
  assert.ok(block.includes("Settle"), "CONTROL - and it must carry the members it was handed");
  assert.equal(
    block,
    HEAD_FIM_GO,
    `"FIM is untouched. Its caps spend latency against a keystroke deadline and nothing here runs there."\n` +
      `--- NOW ---\n${block}\n--- 00cf79c ---\n${HEAD_FIM_GO}\n---`,
  );
});

// ===========================================================================
// SECTION P7. THE LATENCY GATE.
//
// THIS FILE CANNOT RUN IT, and saying so is the honest thing to do. The gate is
// "Go's pre-fill leg, warm, at the install default, over the same 20 distinct
// struct roots of the same corpus" - a live gopls against ~/sandbox/v42-corpus,
// which no unit test has. What CAN be bound here is that the gate's left-hand
// side exists and says what the contract quotes it as saying, so the right-hand
// side has something real to be doubled against.
// ===========================================================================

test("P7: the gate's LEFT-HAND SIDE is recorded, and the contract's numbers are the ones in it", () => {
  const f = path.join(__dirname, "fixtures", "go-hover-capture", "baselines.md");
  assert.ok(fs.existsSync(f), `${f} must exist - "without this the latency gate has no left-hand side"`);
  const src = fs.readFileSync(f, "utf8");
  const goRow = src.split("\n").find((l) => /^\|\s*Go\s*\|/.test(l));
  assert.ok(goRow, `the baselines table must carry a Go row; found none in:\n${src.slice(0, 600)}`);
  for (const n of ["59ms", "124ms"]) {
    assert.ok(
      goRow.includes(n),
      `contract-phase1.md P7 quotes "baseline p95 59ms, max 124ms" and cites this file. The Go row reads:\n  ${goRow}`,
    );
  }
  assert.ok(
    goRow.includes("118ms") && goRow.includes("248ms"),
    `and the 2x gate the contract states (p95 <= 118ms, max <= 248ms) must be the doubling of that row:\n  ${goRow}`,
  );
  // The falsification the contract repeats, because a single run's p95 is noise.
  assert.ok(
    /p95 read 16ms on one run and 59ms on the next/.test(src),
    `the baseline must keep its own variance warning - contract-phase1.md P7 repeats it verbatim ("Go's p95 ` +
      `read 16ms and 59ms on two runs of the same 20 rows"). The after-side has to be run MORE THAN ONCE ` +
      `before a 2x verdict is called, and this file is where that instruction lives`,
  );
});
