// BLIND CONTRACT ORACLE - session-v41, phase 3: the example gate.
//
// Written from the session goal (phase-3 section, decision rules 2 and 3) and
// from the phase-3 contract handed to this oracle. Harness conventions
// copied from test/blind-v41-p2-alias-tiers.test.cjs (vscode stub, resolvePrefill
// product path, makeDoc shape) and test/blind-v38-p1-enum-render.test.cjs
// (example-leg stub `example: async (c, prefer) => examples[prefer]`, the
// renderedTypes reader, the empty-shape-struct fallthrough fixture family) -
// their BEHAVIOUR was not consulted. NO phase-3 implementation was read; none
// exists.
//
// ---------------------------------------------------------------------------
// THE CONTRACT
// ---------------------------------------------------------------------------
//
// GATE AT RENDER: a usage-example block whose code never names the type it is
// headed with is REFUSED - the block is not emitted, and the render falls back
// to whatever the non-example branch gives that type (the API-surface branch,
// or nothing when nothing else exists - but never the lying block). The match
// is a WORD-BOUNDARY match of the headed type's LAST PATH SEGMENT against the
// example code: `V` must not match `Vec`; `Client` must not match
// `HttpClientFactory` and not `HttpClient` either; an exact word hit keeps.
//
// GENERIC-PARAM REFUSAL: a declared generic parameter of the target function
// is never an example candidate at all - no example block headed by a bare
// declared param may render, regardless of what its code contains (even code
// that names the param as an exact word). Same refusal family as v38 item 3.
// MEASURED while authoring (see Q7): a param declared on the fn's OWN
// signature (`fn decide<E>(...)`) is already skipped upstream today; the live
// hole - and this oracle's red - is a param declared by the target's
// ENCLOSING impl, which the fn's signature text never shows and which today
// renders a junk block headed `E`.
//
// SURVIVORS: an example block whose code DOES name its headed type renders
// exactly as today, byte-identical (the RngCore/ToHex class). The header
// sentence is UNCHANGED in this phase - re-headering is decision rule 3's LOSS
// branch, not this build.
//
// THE PURE SEAM, pinned by this oracle (the implementer must provide it):
//
//   exampleNamesItsType(headedType: string, code: string): boolean
//   exported from src/core/extraction
//
// headedType is the type name as the render leg heads the block with (may be a
// `::`-qualified path, may carry generic args); code is the example body. TRUE
// iff the last path segment, generic args stripped, matches the code at a word
// boundary, case-sensitively.
//
// ---------------------------------------------------------------------------
// ROWS
//
//   A1  junk block refused (PRODUCT PATH, red today): an empty-shape struct
//       falls to the example leg and the resolver serves unrelated-docs code
//       never naming the type - the block must be ABSENT and no junk token may
//       reach the payload. Nothing else exists for the type, so the honest
//       fallback is nothing (row F owns the diagnostic line).
//   A2  never-the-lying-block, surface available (PRODUCT PATH, green pin):
//       a field-bearing struct with a junk example on offer renders its
//       API-surface branch and not one junk token - pins the fallback
//       direction against a gate that reorders the legs.
//   B   true block survives byte-identical (PRODUCT PATH, green pin): code
//       names the headed type at a word boundary; the block's bytes - header
//       sentence included - are FROZEN from a pre-build run of this file.
//   C1  substring trap (PURE, skips red today via the seam guard): headed `V`,
//       code `let v = Vec::new();` - REFUSED. Pins both the `Vec` substring
//       and the lowercase `v` (case-sensitive).
//   C2  word-boundary both directions (PURE): `Client` matches
//       `Client::connect()`; `Client` does NOT match `HttpClientFactory` nor
//       `HttpClient` nor `Client_v2`.
//   D1  path-segment match (PURE): headed `some::path::Type`, code names bare
//       `Type` - KEPT; headed `wal::store::LeaseStore`, code naming only
//       `Store` - REFUSED; headed `cache::ShardCache<V>`, code naming
//       `ShardCache` - KEPT (generic args are stripped from the match unit,
//       see Q1).
//   E1  declared-generic-param refusal (PRODUCT PATH, red today): the target
//       is `pub fn decide(&self, p0: E, p1: V, p2: D)` inside
//       `impl<E, V, D> Holder<E, V, D>`; examples are on offer for all three,
//       one of them naming `E` as an exact word - NO example block headed by
//       a bare declared param renders. Today all three junk blocks render.
//   E2  fn-declared generic param stays refused (PRODUCT PATH, green pin):
//       `fn decide<E>(p0: E)` already yields no block for `E` today; the
//       build must not loosen that skip.
//   F   control (PRODUCT PATH, green pin): a type with NO example and no
//       surface still emits its honest injected-nothing channel line naming
//       the type - the gate must not silently eat the diagnostic.
//   G   control (PRODUCT PATH, green pin): non-example injection paths - the
//       phase-1 trait surface and the phase-2 alias tier-1 line - are
//       byte-unchanged whether or not a junk example is on offer.
//
// EXPECTED RED BASELINE, MEASURED 2026-08-07 against the post-phase-2 working
// tree: the PURE-SEAM guard is the one loud failure for C1/C2/D1 (the export
// does not exist; those rows skip behind it); A1 and E1 are red on their own
// product-path assertions - the junk blocks render today, under the exact
// header "Usage example for `X` (from its docs, this compiles):". A2, B, E2,
// F, G are green no-regression pins. After the build every row must pass on
// its own assertion.
//
// ---------------------------------------------------------------------------
// CONTRACT AMBIGUITIES HIT WHILE WRITING THIS. Pinned here, called out at rows.
//
//   Q1  Generic args on the headed type. `ShardCache<V>`'s literal last
//       segment can never word-boundary-match real code, which would refuse
//       every generic-headed TRUE block and contradict the survivor clause.
//       PINNED: strip generic args before matching (D1 asserts it).
//   Q2  Case. Types are case-sensitive names; PINNED case-sensitive (C1: `v`
//       in the code does not keep a block headed `V`).
//   Q3  What "falls back" to for an empty-shape type: nothing renders and the
//       diagnostic line stands (A1 + F). The surface-instead direction is
//       pinned at A2 where a surface exists.
//   Q4  The refused block's OWN channel line (does the gate log the refusal?)
//       is NOT pinned - the contract pins only that the existing
//       injected-nothing diagnostic survives (F).
//   Q5  The seam location. PINNED to src/core/extraction: the goal places the
//       example machinery there (`extraction.ts:1404`), and the gate is a
//       language-generic predicate over header and code, so it lives beside
//       the harvest, not in the vscode layer.
//   Q6  Whether the generic-param refusal must ALSO suppress the example()
//       CALL or only the block. Not pinned to the call: E1 asserts on the
//       payload, the observable. A refusal that still consults the resolver
//       but never renders is green.
//   Q7  The contract's generic-param example (`E`, `V`, `D` from
//       `fn f<E, V, D>(...)`) turned out to be the shape that CANNOT go red:
//       measured while authoring, a fn-declared param never reaches the
//       example leg in this harness today. The census's E/V/D therefore
//       reached it down the enclosing-impl shape, the one a signature-text
//       skip cannot see - E1 is authored on that shape, E2 pins the existing
//       fn-declared skip. The contract's intent (no bare declared param ever
//       heads a block) covers both.
//
// Run: SKIP_LIVE=1 node --test test/blind-v41-p3-example-gate.test.cjs

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const esbuild = require("esbuild");
const { bundleCore } = require("./.blind-util.cjs");

// ===========================================================================
// HARNESS 1. The pure seam, bundled headless. The export does not exist
// before the build (esbuild WARNS and bundles `undefined`), so this guard is
// the one loud failure and the pure rows skip behind it.
// ===========================================================================

let exampleNamesItsType;
let coreCleanup = () => {};
let coreBundleErr;
try {
  const b = bundleCore(
    "blind-v41-p3-example-gate",
    `export { exampleNamesItsType } from "../src/core/extraction";\n`,
  );
  coreCleanup = b.cleanup;
  ({ exampleNamesItsType } = b.mod);
} catch (e) {
  coreBundleErr = e;
  fs.rmSync(path.join(__dirname, ".blind-v41-p3-example-gate.entry.ts"), { force: true });
}
test.after(() => coreCleanup());

const seamMissing = typeof exampleNamesItsType !== "function";
test("pure-seam guard: exampleNamesItsType(headedType, code) builds headless from src/core/extraction", () => {
  if (coreBundleErr) assert.fail(`core bundle failed to build: ${coreBundleErr.message}`);
  assert.equal(
    typeof exampleNamesItsType,
    "function",
    "exampleNamesItsType must be exported from src/core/extraction - the seam this oracle pins (Q5)",
  );
});
const ptest = (name, fn) =>
  test(name, (ctx) => {
    if (coreBundleErr || seamMissing) return ctx.skip("pure seam missing; see the pure-seam guard");
    return fn(ctx);
  });

// ===========================================================================
// HARNESS 2. resolvePrefill bundled against a vscode stub - the product path:
// the gate sits at render inside the walk, so a pure-function oracle alone
// would miss the wiring. Stub copied from blind-v41-p2, own file names.
// ===========================================================================

const STUB = path.join(__dirname, ".blind-v41-p3-vscode-stub.cjs");
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
  languages: {}, window: {}, commands: { executeCommand: async () => undefined },
  workspace: {
    getConfiguration: () => ({ get: (k, f) => f, has: () => false, inspect: () => undefined, update: async () => {} }),
    openTextDocument: (arg) => {
      const files = globalThis.__BLIND41P3_FILES__ || {};
      const key = keyOf(arg);
      return Promise.resolve({ uri: mkUri(key), getText: () => files[key] });
    },
  },
};
`,
);

const ENTRY = path.join(__dirname, ".blind-v41-p3.entry.ts");
const OUTFILE = path.join(__dirname, ".blind-v41-p3.bundle.cjs");
let resolvePrefill;
let bundleErr;
try {
  fs.writeFileSync(ENTRY, `export { resolvePrefill } from "../src/vscode/fnGen";\n`);
  esbuild.buildSync({ entryPoints: [ENTRY], bundle: true, outfile: OUTFILE, format: "cjs", platform: "node", alias: { vscode: STUB } });
  ({ resolvePrefill } = require(OUTFILE));
} catch (e) {
  bundleErr = e;
}
const V = (() => { try { return require(STUB); } catch { return undefined; } })();
test.after(() => [STUB, ENTRY, OUTFILE].forEach((f) => fs.rmSync(f, { force: true })));

test("product bundle guard: resolvePrefill builds headless against the vscode stub", () => {
  if (bundleErr) assert.fail(`bundle failed to build: ${bundleErr.message}`);
  assert.equal(typeof resolvePrefill, "function", "resolvePrefill must be exported from src/vscode/fnGen");
});
const productMissing = typeof resolvePrefill !== "function";
const btest = (name, fn) =>
  test(name, (ctx) => {
    if (bundleErr || productMissing) return ctx.skip("bundle broken; see the product bundle guard");
    return fn(ctx);
  });

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
    return new V.Position(lines.length - 1, 0);
  };
  return {
    uri: { toString: () => uriStr },
    offsetAt,
    positionAt,
    getText: (r) => (r ? text.slice(offsetAt(r.start), offsetAt(r.end)) : text),
  };
}

const wordAt = (text, cursor) => {
  const line = (text || "").split("\n")[cursor.line] ?? "";
  const isWord = (c) => /[A-Za-z0-9_]/.test(c);
  let s = Math.min(cursor.character, line.length);
  let e = s;
  while (s > 0 && isWord(line[s - 1])) s--;
  while (e < line.length && isWord(line[e])) e++;
  return line.slice(s, e) || undefined;
};

// defTypes: { name: { uri, hover, members } }. membersOfType answers ONLY at
// the type's own def file - blind-v41-p2's Q6, the proven server shape the
// shipped phase-2 walk was built against. examples: { name: code } consumed by
// the example leg via `prefer` (the blind-v38-p1 shape).
function makeExtractor(files, defTypes, examples) {
  const known = new Set(Object.keys(defTypes));
  const calls = { example: [] };
  const typeAtCursor = (uri, cursor) => {
    const text = files[uri];
    if (text === undefined) return undefined;
    const w = wordAt(text, cursor);
    if (w && known.has(w)) return w;
    const line = text.split("\n")[cursor.line] ?? "";
    const on = [...known].filter((t) => new RegExp(`\\b${t}\\b`).test(line));
    return on.length === 1 ? on[0] : undefined;
  };
  const defLocFor = (t) => {
    const uri = defTypes[t].uri;
    const lines = (files[uri] || "").split("\n");
    let ln = lines.findIndex((l) => new RegExp(`\\b(?:type|struct|enum|trait)\\s+${t}\\b`).test(l));
    if (ln < 0) ln = lines.findIndex((l) => new RegExp(`\\b${t}\\b`).test(l));
    if (ln < 0) return undefined;
    const ch = lines[ln].indexOf(t);
    return { uri, range: { startLine: ln, startCharacter: ch, endLine: ln, endCharacter: ch + t.length } };
  };
  return {
    calls,
    ext: {
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
        if (!t) return [];
        return c.uri === defTypes[t].uri ? defTypes[t].members || [] : [];
      },
      example: async (c, prefer) => {
        calls.example.push(prefer);
        return examples[prefer];
      },
      completeMembers: async () => [],
      qualifyImport: async () => [],
    },
  };
}

const WS = "file:///work/v41p3";

// types: [{ name, uri, hover, src, members }]. opts.generics: e.g. "<E, V, D>"
// declares them on the fn itself; opts.enclosing: e.g. "<E, V, D>" declares
// them on an enclosing impl instead (the target becomes a &self method - the
// corpus shape where the fn's own signature never declares the params).
// opts.examples: { name: code }.
async function runPrefill(paramTypes, types, opts = {}) {
  const mainUri = `${WS}/main.rs`;
  const generics = opts.generics || "";
  let signature, src, headerIndent, bodyIndent;
  if (opts.enclosing) {
    signature = `pub fn decide(&self, ${paramTypes.map((t, i) => `p${i}: ${t}`).join(", ")}) -> u32`;
    src = [
      `pub struct Holder${opts.enclosing} {`,
      `    marker: std::marker::PhantomData<${opts.enclosing.replace("<", "(").replace(">", ")")}>,`,
      `}`,
      ``,
      `impl${opts.enclosing} Holder${opts.enclosing} {`,
      `    /// Decide the outcome.`,
      `    ${signature} {`,
      `        todo!()`,
      `    }`,
      `}`,
      ``,
    ].join("\n");
    headerIndent = "    ";
    bodyIndent = "        ";
  } else {
    signature = `pub fn decide${generics}(${paramTypes.map((t, i) => `p${i}: ${t}`).join(", ")}) -> u32`;
    src = `/// Decide the outcome.\n${signature} {\n    todo!()\n}\n`;
    headerIndent = "";
    bodyIndent = "    ";
  }
  const files = { [mainUri]: src };
  const defTypes = {};
  for (const t of types) {
    if (t.uri && t.src !== undefined) files[t.uri] = t.src;
    defTypes[t.name] = t;
  }
  const record = {
    span: {
      start: src.indexOf(signature),
      end: opts.enclosing ? src.indexOf("    }") + "    }".length : src.length - 1,
    },
    signature,
    docComment: "Decide the outcome.",
    symbolName: "decide",
    languageId: "rust",
    kind: "function",
    bodyOnly: false,
    headerIndent,
    bodyIndent,
    docstringRefusal: undefined,
  };
  const logs = [];
  const { ext, calls } = makeExtractor(files, defTypes, opts.examples || {});
  globalThis.__BLIND41P3_FILES__ = files;
  let out;
  try {
    out = await resolvePrefill(ext, makeDoc(src, mainUri), record, (l) => logs.push(String(l)));
  } finally {
    delete globalThis.__BLIND41P3_FILES__;
  }
  return { text: out || "", logs, calls };
}

const show = (v) => JSON.stringify(v);
const dump = (r) => `\n  LOGS=${show(r.logs)}\n  FULL PAYLOAD:\n${r.text}`;

// The example-leg header this repo has used unchanged since v7 and which
// blind-v38-p1 already binds to. The gate refuses the BLOCK, so after the
// build this header must be absent for a refused type; for a survivor it is
// the frozen bytes' first line.
const viaExample = (r, n) => new RegExp("Usage example for `" + n + "`").test(r.text);

// A rendered block for the type, header-agnostic: a backticked name on a line
// at most two above a fence (the blind-v38-p1 reader).
const renderedBlockFor = (r, n) => {
  const lines = (r.text || "").split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (!new RegExp("`" + n + "`").test(lines[i])) continue;
    if ((lines[i + 1] || "").startsWith("```") || (lines[i + 2] || "").startsWith("```")) return true;
  }
  return false;
};

// ===========================================================================
// FIXTURES. Authored, modeled on the census shapes the goal names
// (ReplicationClient's 9 junk blocks; RngCore/ToHex as the survivor class;
// E/V/D as the generic params that reached the leg). No fixture is quoted
// from the corpus.
// ===========================================================================

// A1: the empty-shape struct is the proven fallthrough to the example leg
// (blind-v38-p1 B1's fixture family). The junk code is unrelated-docs
// hashing prose-code that never says ReplState.
const URI_REPLSTATE = `${WS}/repl_state.rs`;
const T_REPLSTATE = {
  name: "ReplState",
  uri: URI_REPLSTATE,
  hover: "pub struct ReplState { /* private fields */ }",
  src: "pub struct ReplState { /* private fields */ }\n",
  members: [],
};
const JUNK_EXAMPLE = [
  "let mut hasher = Sha256::new();",
  'hasher.update(b"payload");',
  "let digest = hasher.finalize();",
].join("\n");

// A2: a surface-bearing struct; the junk example on offer must never displace
// or accompany the API surface.
const URI_WALCONFIG = `${WS}/wal_config.rs`;
const T_WALCONFIG = {
  name: "WalConfig",
  uri: URI_WALCONFIG,
  hover: ["pub struct WalConfig {", "    pub segment_bytes: u64,", "    pub fsync_every: u32,", "}"].join("\n"),
  src: [
    "pub struct WalConfig {",
    "    pub segment_bytes: u64,",
    "    pub fsync_every: u32,",
    "}",
    "",
  ].join("\n"),
  members: [],
};

// B: the survivor. Empty-shape hover (so the example leg is reached), code
// names the headed type at a word boundary.
const URI_HEXWRITER = `${WS}/hex_writer.rs`;
const T_HEXWRITER = {
  name: "HexWriter",
  uri: URI_HEXWRITER,
  hover: "pub struct HexWriter { /* private fields */ }",
  src: "pub struct HexWriter { /* private fields */ }\n",
  members: [],
};
const HEXWRITER_EXAMPLE = [
  "let mut w = HexWriter::with_capacity(64);",
  "w.push_bytes(&[0xde, 0xad]);",
  "let s = w.finish();",
].join("\n");

// E: the declared generic params. Each gets an empty-shape-ish hover so the
// example leg is reached today, and an example on offer. The `E` example
// names E as an EXACT WORD: only the generic-param refusal can kill it, not
// the word-boundary gate. V and D are the goal's own spike-2 traps.
const genericParam = (n) => ({ name: n, uri: `${WS}/main.rs`, hover: n, members: [] });
const GENERIC_EXAMPLES = {
  E: "let e: E = E::default();",
  V: "let v = Vec::new();",
  D: "let d = Duration::from_secs(1);",
};

// F: nothing renderable, no example. The honest channel line must survive.
const URI_OPAQUE = `${WS}/opaque_thing.rs`;
const T_OPAQUE = {
  name: "OpaqueThing",
  uri: URI_OPAQUE,
  hover: "pub struct OpaqueThing { /* private fields */ }",
  src: "pub struct OpaqueThing { /* private fields */ }\n",
  members: [],
};

// G: the phase-1 trait (bare hover, surface recovered from def source) and
// the phase-2 std-target alias (tier-1 line only).
const URI_VALIDATE = `${WS}/validate.rs`;
const T_VALIDATE = {
  name: "Validate",
  uri: URI_VALIDATE,
  hover: "pub trait Validate",
  src: [
    "/// Validates a raw event payload before it is admitted to the WAL.",
    "pub trait Validate {",
    "    fn validate(&self, event_value: &[u8]) -> Result<(), String>;",
    "}",
    "",
  ].join("\n"),
  members: [],
};
const URI_SYNC = `${WS}/sync_result.rs`;
const T_SYNC = {
  name: "SyncResult",
  uri: URI_SYNC,
  hover: "pub type SyncResult = Result<(), String>",
  src: ["pub type SyncResult = Result<(), String>;", ""].join("\n"),
  members: [],
};

// ===========================================================================
// PURE ROWS. Skip behind the pure-seam guard until the export exists.
// ===========================================================================

ptest("C1 [rust]: substring trap - headed `V`, code `let v = Vec::new();` is REFUSED", () => {
  assert.equal(
    exampleNamesItsType("V", "let v = Vec::new();"),
    false,
    "`V` must not match inside `Vec` (substring), and the lowercase `v` binding must not count either (Q2: case-sensitive)",
  );
  assert.equal(
    exampleNamesItsType("D", "let d = Duration::from_secs(1);"),
    false,
    "`D` must not match inside `Duration` - the spike-2 false-keep this gate exists to close",
  );
});

ptest("C2 [rust]: word boundary, both directions pinned", () => {
  assert.equal(
    exampleNamesItsType("Client", "let c = Client::connect(addr);"),
    true,
    "an exact word hit MUST count - refusing it deletes the RngCore/ToHex survivor class",
  );
  assert.equal(
    exampleNamesItsType("Client", "let f = HttpClientFactory::build();"),
    false,
    "`Client` inside `HttpClientFactory` is a substring, not a name",
  );
  assert.equal(
    exampleNamesItsType("Client", "let h = HttpClient::new();"),
    false,
    "`Client` inside `HttpClient` is a substring, not a name (\\bClient\\b does not match)",
  );
  assert.equal(
    exampleNamesItsType("Client", "let c2 = Client_v2::new();"),
    false,
    "underscore is a word character; `Client_v2` does not name `Client`",
  );
});

ptest("D1 [rust]: the match unit is the path's LAST SEGMENT, generic args stripped", () => {
  assert.equal(
    exampleNamesItsType("some::path::Type", "let t = Type::new();"),
    true,
    "a path-headed type matches on its last segment - bare `Type` in the code keeps the block",
  );
  assert.equal(
    exampleNamesItsType("wal::store::LeaseStore", "let s = Store::open(dir);"),
    false,
    "the last segment is `LeaseStore`; code naming only `Store` never names it",
  );
  assert.equal(
    exampleNamesItsType("cache::ShardCache<V>", "let c = ShardCache::with_shards(4);"),
    true,
    "Q1: generic args are stripped from the match unit - a literal `ShardCache<V>` word can never occur " +
      "in real code, and refusing every generic-headed TRUE block contradicts the survivor clause",
  );
});

// ===========================================================================
// PRODUCT ROWS.
// ===========================================================================

btest("A1 [rust]: a junk example block is REFUSED - not emitted, no junk token in the payload", async () => {
  const r = await runPrefill(["ReplState"], [T_REPLSTATE], { examples: { ReplState: JUNK_EXAMPLE } });
  assert.ok(
    !viaExample(r, "ReplState"),
    `the block's code never says ReplState; emitting it under a header claiming it demonstrates ` +
      `ReplState is the lie the census caught 40 times in 49 blocks.${dump(r)}`,
  );
  assert.ok(
    !/Sha256|hasher|finalize/.test(r.text),
    `no token of the unrelated-docs code may reach the payload - the block is refused whole, not trimmed.${dump(r)}`,
  );
  assert.ok(
    !renderedBlockFor(r, "ReplState"),
    `nothing else exists for this type (empty shape, no members), so the honest render is NO block at ` +
      `all - never the lying one (Q3).${dump(r)}`,
  );
});

btest("A2 [rust]: a surface-bearing type never renders the junk block - the API surface is the payload", async () => {
  const r = await runPrefill(["WalConfig"], [T_WALCONFIG], { examples: { WalConfig: JUNK_EXAMPLE } });
  assert.ok(
    /segment_bytes/.test(r.text) && /fsync_every/.test(r.text),
    `the struct's own fields are the surface and must render.${dump(r)}`,
  );
  assert.ok(
    !/Sha256|hasher|finalize/.test(r.text),
    `the junk example on offer must not displace or accompany the surface - never the lying block, ` +
      `whichever leg a rewrite consults first.${dump(r)}`,
  );
});

btest("B [rust]: a TRUE example block survives - code names the headed type at a word boundary", async () => {
  const r = await runPrefill(["HexWriter"], [T_HEXWRITER], { examples: { HexWriter: HEXWRITER_EXAMPLE } });
  assert.ok(
    viaExample(r, "HexWriter"),
    `the survivor class (RngCore 7/7, ToHex 2/2): a block whose code names its type is correct and ` +
      `must keep rendering down the example leg.${dump(r)}`,
  );
  assert.ok(
    r.text.includes(HEXWRITER_EXAMPLE),
    `the example code must arrive verbatim and contiguous.${dump(r)}`,
  );
  // The byte pin. FROZEN from a run of this file against the pre-build tree
  // (2026-08-07): header sentence included, since the header is unchanged in
  // this phase (re-headering is decision rule 3's LOSS branch). If this goes
  // red after the build, the gate moved a survivor's bytes; re-baselining it
  // is a decision to argue in writing, not a quiet edit.
  const FROZEN_BLOCK =
    "Usage example for `HexWriter` (from its docs, this compiles):\n" +
    "```rust\n" +
    HEXWRITER_EXAMPLE +
    "\n```";
  assert.ok(
    r.text.includes(FROZEN_BLOCK),
    `the surviving block must render byte-identical to today, header sentence included.` +
      `\n  EXPECTED BLOCK:\n${FROZEN_BLOCK}${dump(r)}`,
  );
});

btest("E1 [rust]: a generic param declared by the ENCLOSING impl is never an example candidate", async () => {
  // The corpus shape. A param the fn's own signature does not declare
  // (`impl<E, V, D> Holder<E, V, D> { pub fn decide(&self, p0: E, ...) }`) is
  // invisible to a signature-text skip, resolves like any name, and today
  // renders a junk example block (measured while authoring this file). The
  // fn-declared form is E2's territory - it is ALREADY skipped upstream today,
  // so this row is where the red lives and where declaredGenericParams
  // (fnGen.ts:1380, which sees the doc, not just the signature) must reach.
  const r = await runPrefill(["E", "V", "D"], [genericParam("E"), genericParam("V"), genericParam("D")], {
    enclosing: "<E, V, D>",
    examples: GENERIC_EXAMPLES,
  });
  for (const p of ["E", "V", "D"]) {
    assert.ok(
      !viaExample(r, p),
      `\`${p}\` is a declared generic parameter of the target's enclosing impl; an example block headed ` +
        `by a bare type variable is a category error regardless of its code - the E example even names E ` +
        `as an exact word, so only the generic-param refusal can hold this, not the word-boundary gate.${dump(r)}`,
    );
    assert.ok(!renderedBlockFor(r, p), `no block of any kind headed bare \`${p}\`.${dump(r)}`);
  }
  assert.ok(
    !/E::default|Vec::new|Duration::from_secs/.test(r.text),
    `no token of any generic-param example may reach the payload.${dump(r)}`,
  );
});

btest("E2 [rust]: a generic param declared on the fn ITSELF stays refused (green today, pins no-regression)", async () => {
  // Measured while authoring: `pub fn decide<E>(p0: E)` already yields no
  // example call for E in this harness. The gate build must not loosen that
  // existing skip while adding the enclosing-impl reach.
  const r = await runPrefill(["E"], [genericParam("E")], {
    generics: "<E>",
    examples: { E: GENERIC_EXAMPLES.E },
  });
  assert.ok(!viaExample(r, "E"), `a fn-declared generic param must never head an example block.${dump(r)}`);
  assert.ok(!/E::default/.test(r.text), `and no token of its example may reach the payload.${dump(r)}`);
});

btest("F [rust]: CONTROL - a type with no example and no surface keeps its honest injected-nothing channel line", async () => {
  const r = await runPrefill(["OpaqueThing"], [T_OPAQUE], { examples: {} });
  assert.ok(!renderedBlockFor(r, "OpaqueThing"), `precondition: nothing renders for this type.${dump(r)}`);
  assert.ok(
    r.logs.some((l) => /OpaqueThing/.test(l)),
    `the channel line naming the type is the census's raw material (the "nothing renderable" line); ` +
      `the gate must not silently eat the diagnostic.${dump(r)}`,
  );
});

btest("G [rust]: CONTROL - phase-1 trait surface and phase-2 alias line are byte-unchanged by the gate", async () => {
  const clean = await runPrefill(["Validate", "SyncResult"], [T_VALIDATE, T_SYNC], { examples: {} });
  const offered = await runPrefill(["Validate", "SyncResult"], [T_VALIDATE, T_SYNC], {
    examples: { Validate: JUNK_EXAMPLE, SyncResult: JUNK_EXAMPLE },
  });
  // Non-vacuity: the two non-example paths render at all.
  assert.ok(
    /fn validate\(&self, event_value: &\[u8\]\)/.test(clean.text),
    `precondition: the phase-1 recovered trait surface renders.${dump(clean)}`,
  );
  assert.ok(
    /type SyncResult\s*=\s*Result<\(\), String>/.test(clean.text),
    `precondition: the phase-2 tier-1 alias line renders.${dump(clean)}`,
  );
  assert.equal(
    offered.text,
    clean.text,
    `a junk example ON OFFER for types whose surface comes from the non-example branches must change ` +
      `nothing: the gate touches only the example leg.` +
      `\n  CLEAN:\n${clean.text}\n  OFFERED:\n${offered.text}`,
  );
});
