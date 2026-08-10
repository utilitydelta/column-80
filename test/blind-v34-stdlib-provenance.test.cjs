// BLIND ORACLE - session-v34 item 1, "Stdlib types get no surface rendered",
// plus Amendment A. Black-box over `resolvePrefill` only.
//
// THE CONTRACT, restated from `session-v34/goal.md` item 1 + Amendment A:
//
//   1. A ROOT candidate type whose definition lives in the Rust standard
//      library renders NOTHING - no data shape, no member list, no worked
//      example. It may still be NAMED if the ordering names it.
//   2. The test is PROVENANCE, not a name blocklist. A stdlib definition lives
//      under the rustup toolchain's library source
//      (`.../lib/rustlib/src/rust/library/{std,core,alloc}/src/...`); a project
//      definition lives under the workspace.
//   3. The existing drop log stays and GAINS THE REASON: a type skipped for
//      being stdlib says so on the `[fngen]` channel.
//   4. A PROJECT type that WRAPS a stdlib type still renders in full. The rule
//      is about the ROOT being rendered, not about stdlib types appearing
//      anywhere inside a shape.
//   5. The closing instruction is scoped to the types whose blocks actually
//      rendered; a skipped stdlib type must not appear in it.
//   6. This is Rust's rule. typescript, csharp, python and go must not change.
//
// WHY EVERY STDLIB ROW IS PAIRED WITH A WORKSPACE ARM. The claim under test is
// a DIFFERENCE made by provenance alone, so each stdlib row runs the identical
// scenario twice - same type name, same hover, same members, same def text -
// moving only the def URI. The workspace arm is the non-vacuity guard: if the
// type never rendered in the first place (a pre-existing name filter, a cap, a
// harness defect), the workspace arm fails loudly instead of the stdlib arm
// passing for a reason that has nothing to do with this contract. A green
// stdlib arm next to a red workspace arm is a harness report, not a pass.
//
// WHAT IS DELIBERATELY NOT TESTED. The contract does not say the freed budget
// is reallocated, does not say what the drop line's prose is, and does not say
// the instruction NAMES the types that did render (that is v24 item 1, a
// different contract). None of those are asserted here.
//
// FIXTURE CHOICE, and it is not arbitrary. A type that never reaches the
// candidate list cannot demonstrate anything about this contract, because it
// renders nothing either way. `Result` and `Option` are out because Amendment A
// records they never reach it; `String` is out because it is in the Rust
// prelude; and `BTreeMap` measured out too, which this file found by probing
// candidacy through the same public entry point before choosing a fixture. The
// three types used are `Path` (std), `Duration` (core) and `BinaryHeap`
// (alloc), each confirmed to reach the list by its own workspace arm.
//
// STATE WHEN WRITTEN: 23 rows, all GREEN. Item 1's implementation had already
// landed when this file first ran, so these rows are a regression pin rather
// than a red-before-green round, and the file says so instead of pretending
// otherwise. Two things make the greens worth something anyway. Every stdlib row
// is a measured DIFFERENCE against its own workspace arm, so the pass states
// positively that the shipped rule is provenance and not a name blocklist - a
// blocklist fails the workspace arm. And the three lookalike-path rows plus the
// four other-language rows are directions no row of the shipped work needed to
// go. The only row that measured RED during authoring was a FIXTURE defect of
// this file, recorded below.
//
// BLIND: nothing here reads src/vscode/fnGen.ts or src/core/crossFileShape.ts.
// esbuild resolves them at bundle time. Every assertion is on the STRING
// resolvePrefill returns and on the lines its `log` callback receives. No
// expected value below was captured by running the code.
//
// Run: SKIP_LIVE=1 node --test test/blind-v34-stdlib-provenance.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");

// ===========================================================================
// Harness. resolvePrefill bundled headless against a STRUCTURAL vscode stub,
// copied from test/blind-v24-p1-receiver.test.cjs so both files drive the
// entry point the same way. workspace.openTextDocument serves a uri->text map
// through a process global.
// ===========================================================================

const STUB = path.join(__dirname, ".blind-v34-stdlib-vscode-stub.cjs");
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
class WorkspaceEdit {}
class EventEmitter { constructor(){ this.event=()=>({dispose(){}}); } fire(){} dispose(){} }
class ThemeColor {}
class MarkdownString {}
const mkUri = (s) => ({ toString: () => String(s), fsPath: String(s), path: String(s) });
const keyOf = (a) => (typeof a === "string" ? a : (a && a.toString ? a.toString() : String(a)));
module.exports = {
  Position, Range, Selection, WorkspaceEdit, EventEmitter, ThemeColor, MarkdownString,
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
      const files = globalThis.__V34_FILES__ || {};
      const key = keyOf(arg);
      return Promise.resolve({ uri: mkUri(key), getText: () => files[key] });
    },
  },
};
`,
);

const ENTRY = path.join(__dirname, ".blind-v34-stdlib.entry.ts");
const OUTFILE = path.join(__dirname, ".blind-v34-stdlib.bundle.cjs");
let resolvePrefill;
let bundleErr;
try {
  fs.writeFileSync(ENTRY, `export { resolvePrefill } from "../src/vscode/fnGen";\n`);
  esbuild.buildSync({ entryPoints: [ENTRY], bundle: true, outfile: OUTFILE, format: "cjs", platform: "node", alias: { vscode: STUB } });
  ({ resolvePrefill } = require(OUTFILE));
} catch (e) {
  bundleErr = e;
}
const V = require(STUB);
test.after(() => [STUB, ENTRY, OUTFILE].forEach((f) => fs.rmSync(f, { force: true })));

// A broken bundle must be ONE loud failure, never a wall of TypeErrors that
// could be mistaken for contract failures.
test("bundle guard: resolvePrefill builds headless against the vscode stub", () => {
  if (bundleErr) assert.fail(`bundle failed to build: ${bundleErr.message}`);
  assert.ok(typeof resolvePrefill === "function", "resolvePrefill must be an exported function");
});
const btest = (name, fn) =>
  test(name, (ctx) => {
    if (bundleErr) return ctx.skip("bundle failed to build; see the bundle guard");
    return fn(ctx);
  });

// --- Fake vscode.TextDocument over a source string. -------------------------
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

function wordAt(text, cursor) {
  const line = text.split("\n")[cursor.line] ?? "";
  const isWord = (c) => /[A-Za-z0-9_]/.test(c);
  let s = Math.min(cursor.character, line.length);
  let e = s;
  while (s > 0 && isWord(line[s - 1])) s--;
  while (e < line.length && isWord(line[e])) e++;
  return line.slice(s, e) || undefined;
}

const DECL = (n) => new RegExp(`\\b(?:struct|class|record|interface|enum|type)\\s+${n}\\b`);

// --- Fake SurfaceExtractor. THIS is what makes the contract testable
// headlessly: `defTypes[T].uri` is the provenance the resolver reports back, so
// a row chooses whether a type came from the toolchain or from the workspace by
// choosing one string.
function makeExtractor(cfg) {
  const files = cfg.files;
  const defTypes = cfg.defTypes || {};
  const examples = cfg.examples || {};
  const known = new Set(Object.keys(defTypes));
  const calls = { definition: [], hoverSurface: [], membersOfType: [], example: [] };

  const typeAtCursor = (uri, cursor) => {
    const text = files[uri];
    if (text === undefined) return undefined;
    const w = wordAt(text, cursor);
    if (w && known.has(w)) return w;
    const line = text.split("\n")[cursor.line] ?? "";
    for (const t of known) if (new RegExp(`\\b${t}\\b`).test(line)) return t;
    return undefined;
  };

  const defLocFor = (t) => {
    const uri = defTypes[t].uri;
    const lines = (files[uri] || "").split("\n");
    const ln = lines.findIndex((l) => DECL(t).test(l));
    if (ln < 0) return undefined;
    const ch = lines[ln].indexOf(t);
    return { uri, range: { startLine: ln, startCharacter: ch, endLine: ln, endCharacter: ch + t.length } };
  };

  const ext = {
    definition: async (c) => { calls.definition.push(c); const t = typeAtCursor(c.uri, c); return t ? defLocFor(t) : undefined; },
    hoverSurface: async (c) => { calls.hoverSurface.push(c); const t = typeAtCursor(c.uri, c); const h = t ? defTypes[t].hover : undefined; return h ? { signature: h } : undefined; },
    membersOfType: async (c) => { calls.membersOfType.push(c); const t = typeAtCursor(c.uri, c); return (t && defTypes[t].members) || []; },
    example: async (c, prefer) => { calls.example.push(prefer); return examples[prefer]; },
    completeMembers: async () => [],
    qualifyImport: async () => undefined,
  };
  return { ext, calls };
}

// A member as the SurfaceExtractor yields it, carrying a SUPERSET of the
// plausible declaration-position carriers (copied from
// blind-v24-p2-surface.test.cjs). The visibility filter needs a position; the
// field name it travels under is not part of any external contract, so the
// fixture supplies all of them and keeps member names unique per def file.
function memberIn(files, uri, name, signature, kind = "method") {
  const lines = (files[uri] || "").split("\n");
  const line = lines.findIndex((l) => new RegExp(`\\b${name.replace(/[#$]/g, "\\$&")}\\b`).test(l));
  const character = line >= 0 ? Math.max(lines[line].indexOf(name), 0) : 0;
  const r = {
    start: { line, character },
    end: { line, character: character + name.length },
    startLine: line,
    startCharacter: character,
    endLine: line,
    endCharacter: character + name.length,
  };
  return {
    name, signature, kind, uri, line, character,
    position: { line, character },
    declLine: line,
    range: r,
    selectionRange: r,
    location: { uri, range: r },
  };
}

// --- Document-symbol fixtures. Every target below is module scope, so the tree
// carries the file's TYPES and no container encloses the target: the "no
// receiver" control shape of session-v24 phase 1. Candidates therefore come
// from the signature and the doc comment alone, which is what item 1 is about.
const SK = { Class: 4, Method: 5, Field: 7, Function: 11, Object: 18, Struct: 22 };
const lineOf = (src, needle) => {
  const i = src.indexOf(needle);
  assert.ok(i >= 0, `fixture bug: ${JSON.stringify(needle)} not in source`);
  return src.slice(0, i).split("\n").length - 1;
};
function rng(src, from, to) {
  const lines = src.split("\n");
  const sl = lineOf(src, from);
  const el = to === undefined ? lines.length - 1 : lineOf(src, to);
  const r = new V.Range(sl, 0, el, lines[el].length);
  Object.defineProperty(r, "__line", { value: lines[sl], enumerable: false });
  return r;
}
// FIDELITY: `selectionRange` covers the NAME TOKEN on the node's first line,
// which is what every server measured in session-v24/measure-midedit.md
// reports - never the whole node span.
function nameSelection(name, range) {
  const line = range.__line;
  if (typeof line !== "string") return range;
  const ch = line.indexOf(name);
  if (ch < 0) return range;
  return new V.Range(range.start.line, ch, range.start.line, ch + name.length);
}
const dsym = (name, kind, range, children = [], detail = "") => ({
  name, detail, kind, range,
  selectionRange: nameSelection(name, range),
  children,
});

// ===========================================================================
// Reading the payload back without pinning any block vocabulary. A block header
// is a line carrying a backticked identifier followed by a fenced code block
// within two lines - true of every header shape today and of any this item may
// introduce, so no wording is frozen.
// ===========================================================================
function headerTypes(out) {
  const lines = (out || "").split("\n");
  const names = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /`([A-Za-z_][A-Za-z0-9_]*)`/.exec(lines[i]);
    if (!m) continue;
    if (!((lines[i + 1] || "").startsWith("```") || (lines[i + 2] || "").startsWith("```"))) continue;
    if (!names.includes(m[1])) names.push(m[1]);
  }
  return names;
}

// The two closing instructions the pre-fill renders. Both are pinned verbatim
// by older frozen oracles; neither is invented here.
const FROZEN_PHRASE = "Call ONLY methods and constructors";
const ALT_PHRASE = "Use ONLY the members and types";
function instructionOf(payload) {
  const text = payload || "";
  const idx = [FROZEN_PHRASE, ALT_PHRASE].map((p) => text.indexOf(p)).filter((i) => i >= 0);
  if (idx.length === 0) return undefined;
  return text.slice(Math.min(...idx));
}

// A stdlib-ish reason, in any wording. The contract forbids pinning prose that
// this file invented, so the assertion is on the type name being present AND a
// stdlib-ish word being present on the same line.
const STDLIB_REASON = /\bstd\b|stdlib|std lib|standard library|rustup|toolchain/i;

const dump = (r) => `\n  NAMES=${JSON.stringify(r.names)}\n  LOGS=${JSON.stringify(r.logs)}\n  OUT:\n${r.text}`;

async function runPrefill(scn) {
  const src = scn.files[scn.mainUri];
  const start = src.indexOf(scn.spanStart);
  assert.ok(start >= 0, `fixture bug: spanStart ${JSON.stringify(scn.spanStart)} not in ${scn.mainUri}`);
  const endIdx = src.indexOf(scn.spanEnd, start);
  assert.ok(endIdx >= 0, `fixture bug: spanEnd ${JSON.stringify(scn.spanEnd)} not after spanStart in ${scn.mainUri}`);
  const record = {
    span: { start, end: endIdx + scn.spanEnd.length },
    signature: scn.signature,
    docComment: scn.docComment,
    symbolName: scn.symbolName,
    languageId: scn.languageId,
    kind: "function",
    bodyOnly: false,
    headerIndent: "",
    bodyIndent: "    ",
    docstringRefusal: undefined,
  };
  if ("tree" in scn) record.symbols = scn.tree;
  const { ext, calls } = makeExtractor(scn);
  const logs = [];
  globalThis.__V34_FILES__ = scn.files;
  let out;
  try {
    out = await resolvePrefill(ext, makeDoc(src, scn.mainUri), record, (l) => logs.push(l));
  } finally {
    delete globalThis.__V34_FILES__;
  }
  return { out, text: out || "", logs, calls, names: headerTypes(out) };
}

// ===========================================================================
// THE RUST FIXTURE. One workspace file with several module-scope targets, and
// three stdlib types each of which has TWO possible def URIs - one under the
// rustup toolchain, one under the workspace - carrying byte-identical text.
// The URIs are the shapes the contract names.
// ===========================================================================

const WS = "file:///home/user/sandbox/complexity-study-acme/acme/src";
const LIB = "file:///home/user/.rustup/toolchains/stable-x86_64-unknown-linux-gnu/lib/rustlib/src/rust/library";

const RS_MAIN = `${WS}/api_keys.rs`;
const STD_PATH_URI = `${LIB}/std/src/path.rs`;
const CORE_TIME_URI = `${LIB}/core/src/time.rs`;
const ALLOC_HEAP_URI = `${LIB}/alloc/src/collections/binary_heap/mod.rs`;
// The workspace twins. Same file text, same type, same members: only the
// directory differs, which is the whole of the claim.
const WS_PATH_URI = `${WS}/vendored/path.rs`;
const WS_TIME_URI = `${WS}/vendored/time.rs`;
const WS_HEAP_URI = `${WS}/vendored/heap.rs`;
const WS_DEFS_URI = `${WS}/types.rs`;

const RS_MAIN_SRC = `use std::collections::BinaryHeap;
use std::path::Path;
use std::time::Duration;

/// Load the api keys from \`dir\`.
pub fn load_api_keys(dir: &Path) -> Result<ApiKeysConfig, ApiKeysError> {
    todo!()
}

/// Expire a key after \`ttl\`.
pub fn expire_key(ttl: Duration) -> Result<ApiKeysConfig, ApiKeysError> {
    todo!()
}

/// Index the live keys held in \`heap\`.
pub fn index_keys(heap: BinaryHeap<u32>) -> Result<ApiKeysConfig, ApiKeysError> {
    todo!()
}

/// Make a config from \`seed\`.
pub fn make_config(seed: u32) -> ApiKeysConfig {
    todo!()
}

/// Build the key store from \`seed\`.
pub fn build_store(seed: u32) -> KeyStore {
    todo!()
}

/// Load everything under \`dir\` within \`ttl\`.
pub fn load_all(dir: &Path, ttl: Duration, cfg: ApiKeysConfig) -> u32 {
    todo!()
}
`;

// The project types. `KeyStore` is the item-1 guard-rail shape: a project
// struct whose FIELDS are stdlib types.
const WS_DEFS_SRC = `pub struct ApiKeysConfig {
    pub primary_rw: [u8; 32],
    pub tenant_id: u32,
}

impl ApiKeysConfig {
    pub fn tenant_of(&self) -> u32 {
        self.tenant_id
    }
}

pub struct ApiKeysError {
    pub detail: u32,
}

impl ApiKeysError {
    pub fn detail_code(&self) -> u32 {
        self.detail
    }
}

pub struct KeyStore {
    pub root: PathBuf,
    pub live: BTreeMap<u32, u32>,
}

impl KeyStore {
    pub fn root_of(&self) -> &Path {
        &self.root
    }
}
`;

// The three stdlib def texts. `Path`'s private `inner` field is the leak
// Amendment A records the product injecting today under a header reading "use
// these exact names, do not invent".
const PATH_SRC = `pub struct Path {
    inner: OsStr,
}

impl Path {
    pub fn as_os_str(&self) -> &OsStr {
        &self.inner
    }

    pub fn to_path_buf(&self) -> PathBuf {
        todo!()
    }
}
`;

const TIME_SRC = `pub struct Duration {
    secs: u64,
    nanos: u32,
}

impl Duration {
    pub fn from_secs(secs: u64) -> Duration {
        todo!()
    }

    pub fn as_millis(&self) -> u128 {
        todo!()
    }
}
`;

const HEAP_SRC = `pub struct BinaryHeap<T> {
    data: Vec<T>,
}

impl<T> BinaryHeap<T> {
    pub fn push_at(&mut self, item: T) {
        todo!()
    }

    pub fn peek_at(&self) -> Option<&T> {
        todo!()
    }
}
`;

const RS_FILES = {
  [RS_MAIN]: RS_MAIN_SRC,
  [WS_DEFS_URI]: WS_DEFS_SRC,
  [STD_PATH_URI]: PATH_SRC,
  [WS_PATH_URI]: PATH_SRC,
  [CORE_TIME_URI]: TIME_SRC,
  [WS_TIME_URI]: TIME_SRC,
  [ALLOC_HEAP_URI]: HEAP_SRC,
  [WS_HEAP_URI]: HEAP_SRC,
};

// The project types' tree. No node encloses any target, so no receiver resolves
// and the payload is exactly the signature-named candidates' blocks.
const RS_TREE = () => [
  dsym("load_api_keys", SK.Function, rng(RS_MAIN_SRC, "pub fn load_api_keys", "    todo!()"), []),
];

const rsDef = (uris) => ({
  Path: {
    uri: uris.Path,
    hover: "pub struct Path { inner: OsStr }",
    members: [
      memberIn(RS_FILES, uris.Path, "as_os_str", "as_os_str(&self) -> &OsStr"),
      memberIn(RS_FILES, uris.Path, "to_path_buf", "to_path_buf(&self) -> PathBuf"),
    ],
  },
  Duration: {
    uri: uris.Duration,
    hover: "pub struct Duration { secs: u64, nanos: u32 }",
    members: [
      memberIn(RS_FILES, uris.Duration, "from_secs", "from_secs(secs: u64) -> Duration"),
      memberIn(RS_FILES, uris.Duration, "as_millis", "as_millis(&self) -> u128"),
    ],
  },
  BinaryHeap: {
    uri: uris.BinaryHeap,
    hover: "pub struct BinaryHeap<T> { data: Vec<T> }",
    members: [
      memberIn(RS_FILES, uris.BinaryHeap, "push_at", "push_at(&mut self, item: T)"),
      memberIn(RS_FILES, uris.BinaryHeap, "peek_at", "peek_at(&self) -> Option<&T>"),
    ],
  },
  ApiKeysConfig: {
    uri: WS_DEFS_URI,
    hover: "pub struct ApiKeysConfig { pub primary_rw: [u8; 32], pub tenant_id: u32 }",
    members: [memberIn(RS_FILES, WS_DEFS_URI, "tenant_of", "tenant_of(&self) -> u32")],
  },
  ApiKeysError: {
    uri: WS_DEFS_URI,
    hover: "pub struct ApiKeysError { pub detail: u32 }",
    members: [memberIn(RS_FILES, WS_DEFS_URI, "detail_code", "detail_code(&self) -> u32")],
  },
  KeyStore: {
    uri: WS_DEFS_URI,
    hover: "pub struct KeyStore { pub root: PathBuf, pub live: BTreeMap<u32, u32> }",
    members: [memberIn(RS_FILES, WS_DEFS_URI, "root_of", "root_of(&self) -> &Path")],
  },
});

// The toolchain arm and the workspace arm, differing in one string each.
const TOOLCHAIN_URIS = { Path: STD_PATH_URI, Duration: CORE_TIME_URI, BinaryHeap: ALLOC_HEAP_URI };
const WORKSPACE_URIS = { Path: WS_PATH_URI, Duration: WS_TIME_URI, BinaryHeap: WS_HEAP_URI };

const RS_TARGETS = {
  load_api_keys: {
    spanStart: "pub fn load_api_keys",
    signature: "pub fn load_api_keys(dir: &Path) -> Result<ApiKeysConfig, ApiKeysError>",
    docComment: "/// Load the api keys from `dir`.",
    symbolName: "load_api_keys",
  },
  expire_key: {
    spanStart: "pub fn expire_key",
    signature: "pub fn expire_key(ttl: Duration) -> Result<ApiKeysConfig, ApiKeysError>",
    docComment: "/// Expire a key after `ttl`.",
    symbolName: "expire_key",
  },
  index_keys: {
    spanStart: "pub fn index_keys",
    signature: "pub fn index_keys(heap: BinaryHeap<u32>) -> Result<ApiKeysConfig, ApiKeysError>",
    docComment: "/// Index the live keys held in `heap`.",
    symbolName: "index_keys",
  },
  make_config: {
    spanStart: "pub fn make_config",
    signature: "pub fn make_config(seed: u32) -> ApiKeysConfig",
    docComment: "/// Make a config from `seed`.",
    symbolName: "make_config",
  },
  build_store: {
    spanStart: "pub fn build_store",
    signature: "pub fn build_store(seed: u32) -> KeyStore",
    docComment: "/// Build the key store from `seed`.",
    symbolName: "build_store",
  },
  load_all: {
    spanStart: "pub fn load_all",
    signature: "pub fn load_all(dir: &Path, ttl: Duration, cfg: ApiKeysConfig) -> u32",
    docComment: "/// Load everything under `dir` within `ttl`.",
    symbolName: "load_all",
  },
};

const rustScn = (target, uris) => ({
  languageId: "rust",
  mainUri: RS_MAIN,
  files: RS_FILES,
  tree: RS_TREE(),
  defTypes: rsDef(uris),
  spanEnd: "todo!()\n}",
  ...RS_TARGETS[target],
});

// The text a type's block can only have come from: its data shape's own field
// list and its rendered member signatures. Asserting on these as well as on the
// fenced-header list is what stops a "renders nothing" pass that merely moved
// the header wording.
const BLOCK_EVIDENCE = {
  Path: ["inner: OsStr", "as_os_str", "to_path_buf"],
  Duration: ["secs: u64", "from_secs", "as_millis"],
  BinaryHeap: ["data: Vec<T>", "push_at", "peek_at"],
  ApiKeysConfig: ["primary_rw", "tenant_of"],
  ApiKeysError: ["detail_code"],
  KeyStore: ["root_of"],
};

function assertRendersNothing(r, type, where) {
  assert.ok(
    !r.names.includes(type),
    `${where}: \`${type}\` is defined in the Rust standard library, so it must render NO block - no data shape, no member list. It may be NAMED, but a fenced block under its name is exactly the budget item 1 reclaims.${dump(r)}`,
  );
  for (const needle of BLOCK_EVIDENCE[type]) {
    assert.ok(
      !r.text.includes(needle),
      `${where}: the payload still carries \`${type}\`'s own surface text ${JSON.stringify(needle)}. Dropping the header while keeping the content is not the fix.${dump(r)}`,
    );
  }
}

function assertRendersFully(r, type, where) {
  assert.ok(
    r.names.includes(type),
    `${where}: \`${type}\` is defined under the workspace, so its block must render exactly as before. If this row is red while its stdlib twin is green, the difference is NOT provenance and the stdlib row proves nothing.${dump(r)}`,
  );
  for (const needle of BLOCK_EVIDENCE[type]) {
    assert.ok(
      r.text.includes(needle),
      `${where}: \`${type}\` rendered a header but not its surface text ${JSON.stringify(needle)}.${dump(r)}`,
    );
  }
}

// ===========================================================================
// ROWS 1-3. A root candidate defined under the toolchain's library source
// renders nothing, for each of the three crates the contract names. Each row
// asserts the negative on the stdlib arm AND the positive on the workspace arm,
// in the same test, so a pass is always a measured difference.
// ===========================================================================

const CRATES = [
  {
    crate: "std",
    type: "Path",
    target: "load_api_keys",
    defUri: STD_PATH_URI,
    // Amendment A's witnessed row: today `Path` spends the largest block in the
    // payload on a private field and two dozen signatures.
    why: "the witnessed row - `Path` renders a data shape whose only field is the private `inner: OsStr`",
  },
  {
    crate: "core",
    type: "Duration",
    target: "expire_key",
    defUri: CORE_TIME_URI,
    // `core/src/option.rs` is the contract's own core example, but Amendment A
    // records that `Option` never reaches the candidate list, so a row built on
    // it could not distinguish the fix from the status quo. `core::time` is the
    // same provenance with a type that does reach it.
    why: "a core type that does reach the candidate list, unlike `Option`",
  },
  {
    crate: "alloc",
    type: "BinaryHeap",
    target: "index_keys",
    defUri: ALLOC_HEAP_URI,
    // `alloc/src/string.rs` is the contract's alloc example, but `String` is in
    // the Rust prelude and never reaches the candidate list. Nor, as this file
    // found the hard way, does `BTreeMap`: the pre-existing name filter already
    // removes it, so a row built on it would prove nothing either.
    // `BinaryHeap` is alloc and does reach the list.
    why: "an alloc type that does reach the candidate list, unlike `String` and `BTreeMap`",
  },
];

for (const { crate, type, target, defUri, why } of CRATES) {
  // INTENT: provenance decides. The same type, the same hover, the same members
  // and the same def text render a full block from the workspace and nothing at
  // all from the toolchain's library source. Nothing in the pair varies except
  // the directory the definition sits in, which is the honest test the contract
  // asks for in place of a name blocklist.
  btest(`item 1 [${crate}]: a root candidate defined under ${defUri.slice(defUri.indexOf("/library/"))} renders NO block, while the identical type defined under the workspace renders in full (${why})`, async () => {
    const std = await runPrefill(rustScn(target, { ...TOOLCHAIN_URIS }));
    const ws = await runPrefill(rustScn(target, { ...WORKSPACE_URIS }));
    assertRendersFully(ws, type, `[${crate}] workspace arm (the non-vacuity guard)`);
    assertRendersNothing(std, type, `[${crate}] toolchain arm`);
  });

  // INTENT: a silent skip is how a wrong surface hid for two sessions. Guard
  // rail 1 keeps the existing drop line and adds the reason, so a reader of the
  // channel can tell this skip apart from "nothing resolvable" and from a cap
  // drop. The prose is not pinned - only the type name and a stdlib-ish reason,
  // on the same line, on the `[fngen]` channel. Per crate, because a reason
  // wired to one crate's path and not the others is a live failure mode.
  btest(`item 1 guard rail 1 [${crate}]: the skip of \`${type}\` is logged on the [fngen] channel, naming the type AND giving a stdlib reason`, async () => {
    const r = await runPrefill(rustScn(target, { ...TOOLCHAIN_URIS }));
    const named = r.logs.filter((l) => new RegExp(`\\b${type}\\b`).test(l));
    assert.ok(
      named.length > 0,
      `[${crate}] guard rail 1: the existing drop log stays, so some line must name the skipped type \`${type}\`${dump(r)}`,
    );
    const withReason = named.filter((l) => STDLIB_REASON.test(l));
    assert.ok(
      withReason.length > 0,
      `[${crate}] guard rail 1: the drop line GAINS THE REASON - a type skipped for being stdlib must say so. Lines naming \`${type}\`: ${JSON.stringify(named)}${dump(r)}`,
    );
    assert.ok(
      withReason.some((l) => l.includes("[fngen]")),
      `[${crate}] the reason belongs on the [fngen] channel, where every other pre-fill drop line lives. Lines with a stdlib reason: ${JSON.stringify(withReason)}${dump(r)}`,
    );
  });

  // INTENT: the workspace twin must not be logged as a stdlib skip. Same type,
  // same name, definition inside the project: an implementation that reads the
  // NAME rather than the PROVENANCE passes the row above and fails this one.
  btest(`item 1 [${crate}]: the workspace twin of \`${type}\` is never logged as a stdlib skip - the log follows provenance, not the name`, async () => {
    const r = await runPrefill(rustScn(target, { ...WORKSPACE_URIS }));
    assert.deepStrictEqual(
      r.logs.filter((l) => new RegExp(`\\b${type}\\b`).test(l) && STDLIB_REASON.test(l)),
      [],
      `[${crate}] \`${type}\` is defined under the workspace in this arm; nothing may call it stdlib${dump(r)}`,
    );
  });
}

// INTENT: skipping the stdlib root must not kill the payload. The project types
// named by the same signature still render, so the pre-fill is reallocating the
// budget rather than falling silent.
btest("item 1: a payload whose stdlib candidate is skipped still renders its PROJECT candidates - the skip frees the block, it does not abandon the prefill", async () => {
  const r = await runPrefill(rustScn("load_api_keys", { ...TOOLCHAIN_URIS }));
  assert.ok(r.out !== undefined, `a prefill naming two project types must still produce a payload${dump(r)}`);
  assertRendersFully(r, "ApiKeysConfig", "project candidate alongside a skipped `Path`");
  assertRendersFully(r, "ApiKeysError", "project candidate alongside a skipped `Path`");
});

// ===========================================================================
// ROW 4. The workspace root is untouched. Item 1 changes what happens to a
// stdlib definition and nothing else; a project type resolved from the
// workspace renders its data shape and its member list as before.
// ===========================================================================

// INTENT: the rule must not become "render less". A target whose only candidate
// is a project type gets the same full block it gets today, header, fields and
// members, with no stdlib type anywhere in the scenario to confuse the test.
btest("item 1: a root candidate defined under the workspace renders its data shape and its member list as before", async () => {
  const r = await runPrefill(rustScn("make_config", { ...TOOLCHAIN_URIS }));
  assertRendersFully(r, "ApiKeysConfig", "a project-only prefill");
  assert.ok(
    r.text.includes("tenant_id"),
    `the whole data shape is still quoted, not a trimmed version of it${dump(r)}`,
  );
});

// INTENT: "under the workspace" has to mean the DIRECTORY, not a word in the
// path. A project is free to have a module called `std` and a directory called
// `library`, and `src/library/std/src/path.rs` under the workspace is a project
// file however much it reads like the toolchain's. A substring check on
// `/library/` or on `/std/` passes every row above and drops a real project
// type here, which is the failure no other row can see.
for (const dir of ["library/std/src", "std/src", "rustlib/src/rust/library/core/src"]) {
  btest(`item 1: a workspace file at src/${dir}/path.rs is a PROJECT definition and renders in full - provenance is the directory, not a word in the path`, async () => {
    const lookalike = `${WS}/${dir}/path.rs`;
    const files = { ...RS_FILES, [lookalike]: PATH_SRC };
    const scn = { ...rustScn("load_api_keys", { ...TOOLCHAIN_URIS }), files };
    scn.defTypes = { ...scn.defTypes, Path: { ...rsDef({ ...WORKSPACE_URIS }).Path, uri: lookalike } };
    scn.defTypes.Path.members = scn.defTypes.Path.members.map((m) => ({ ...m, uri: lookalike, location: { uri: lookalike, range: m.range } }));
    const r = await runPrefill(scn);
    assertRendersFully(r, "Path", `a workspace path that resembles the toolchain (${lookalike})`);
  });
}

// ===========================================================================
// ROW 5. The drop log's negative half. The positive half rides the per-crate
// loop above. [item 1 guard rail 1]
// ===========================================================================

// INTENT: the reason must be a REASON, not a new default. A project type that
// renders normally must not pick up a stdlib drop line, or the log stops
// distinguishing anything.
btest("item 1: a project candidate that renders is never given a stdlib drop reason", async () => {
  const r = await runPrefill(rustScn("make_config", { ...TOOLCHAIN_URIS }));
  const bogus = r.logs.filter((l) => /\bApiKeysConfig\b/.test(l) && STDLIB_REASON.test(l));
  assert.deepStrictEqual(
    bogus,
    [],
    `\`ApiKeysConfig\` is a workspace type that rendered; nothing may call it stdlib${dump(r)}`,
  );
});

// ===========================================================================
// ROW 6. A project type that WRAPS stdlib types still renders in full.
// [item 1 guard rail 2: "the rule is about the ROOT being rendered, not about
// types appearing anywhere in a shape"]
// ===========================================================================

// INTENT: the cheap wrong implementation greps the rendered shape for stdlib
// names. `KeyStore` is a workspace struct whose two fields are `PathBuf` and
// `BTreeMap<u32, u32>`, so that implementation drops the one block the model
// most needs. The root's provenance is the only thing that may decide.
btest("item 1 guard rail 2: a PROJECT struct whose fields are stdlib types renders its own data shape in full, stdlib field types and all", async () => {
  const r = await runPrefill(rustScn("build_store", { ...TOOLCHAIN_URIS }));
  assertRendersFully(r, "KeyStore", "a project type wrapping stdlib types");
  assert.ok(
    r.text.includes("PathBuf"),
    `the field whose TYPE is stdlib stays in the shape - the rule is about the root, not about stdlib names appearing anywhere${dump(r)}`,
  );
  assert.ok(
    r.text.includes("BTreeMap"),
    `and so does the second one${dump(r)}`,
  );
});

// ===========================================================================
// ROW 7. The closing instruction is scoped to what rendered. [contract point 5]
// ===========================================================================

// INTENT: the instruction that closes the surface reads "use these exact names,
// do not invent". Naming a type whose block was skipped tells the model the
// opposite of the truth: it constrains a surface the model was never shown.
// Only the negative is asserted here - that the skipped type is absent - because
// scoping the instruction to what DID render is a different contract (v24 item
// 1) and this file does not re-litigate it.
btest("item 1 point 5: the closing instruction does not name the skipped stdlib type", async () => {
  const r = await runPrefill(rustScn("load_api_keys", { ...TOOLCHAIN_URIS }));
  const instruction = instructionOf(r.out);
  assert.ok(
    instruction,
    `a payload that rendered project blocks still closes with an instruction; without one this row cannot say anything${dump(r)}`,
  );
  assert.ok(
    !/\bPath\b/.test(instruction),
    `point 5: \`Path\` rendered no block, so the instruction must not claim to scope it.\n  INSTRUCTION: ${JSON.stringify(instruction)}${dump(r)}`,
  );
});

// ===========================================================================
// ROW 8. A MIXED candidate list. Two stdlib roots from two different crates
// alongside a project type in one signature.
// ===========================================================================

// INTENT: the rule has to hold per candidate, not per payload. With `Path`
// (std), `Duration` (core) and `ApiKeysConfig` (workspace) all named by one
// signature, the two stdlib roots go and the project one stays, in the same run.
// An implementation that skips the whole walk once it sees a stdlib type, or
// that only checks the first candidate, fails here and nowhere else.
btest("item 1: a mixed candidate list - two stdlib roots from two crates render nothing while the project type in the same signature renders in full", async () => {
  const std = await runPrefill(rustScn("load_all", { ...TOOLCHAIN_URIS }));
  const ws = await runPrefill(rustScn("load_all", { ...WORKSPACE_URIS }));
  // The non-vacuity guard first: all three render when all three are workspace.
  for (const t of ["Path", "Duration", "ApiKeysConfig"]) {
    assertRendersFully(ws, t, "mixed list, all-workspace arm (the non-vacuity guard)");
  }
  assertRendersFully(std, "ApiKeysConfig", "mixed list, the project type");
  assertRendersNothing(std, "Path", "mixed list, the std root");
  assertRendersNothing(std, "Duration", "mixed list, the core root");
});

// ===========================================================================
// ROW 9. THE OTHER FOUR LANGUAGES DO NOT MOVE. [contract point 6]
//
// Each language runs the identical scenario twice, moving its collaborator's
// definition from a workspace path to that language's own installed-library
// path. The payload must be byte-identical: this is Rust's rule, and a
// provenance check written at a shared seam would change all five at once.
// ===========================================================================

const OTHER_LANGS = [
  {
    languageId: "typescript",
    mainUri: "file:///home/user/sandbox/app/src/keys.ts",
    src: `/** Load the keys from \`cfg\`. */
export function loadKeys(cfg: KeyConfig): number {
  throw new Error("todo");
}
`,
    spanStart: "export function loadKeys",
    spanEnd: 'throw new Error("todo");\n}',
    signature: "export function loadKeys(cfg: KeyConfig): number",
    docComment: "/** Load the keys from `cfg`. */",
    symbolName: "loadKeys",
    projectUri: "file:///home/user/sandbox/app/src/config.ts",
    libraryUri: "file:///home/user/sandbox/app/node_modules/typescript/lib/lib.es5.d.ts",
    defSrc: `export class KeyConfig {
  slots: number = 0;

  rollActive(): number {
    return 0;
  }
}
`,
    hover: "class KeyConfig",
    members: [["slots", "slots: number", "field"], ["rollActive", "rollActive(): number", "method"]],
    evidence: ["rollActive"],
  },
  {
    languageId: "csharp",
    mainUri: "file:///home/user/sandbox/app/src/Keys.cs",
    src: `namespace App;

public static class Keys
{
    /// <summary>Load the keys from cfg.</summary>
    public static int LoadKeys(KeyConfig cfg)
    {
        throw new NotImplementedException();
    }
}
`,
    spanStart: "public static int LoadKeys",
    spanEnd: "throw new NotImplementedException();\n    }",
    signature: "public static int LoadKeys(KeyConfig cfg)",
    docComment: "/// <summary>Load the keys from cfg.</summary>",
    symbolName: "LoadKeys",
    projectUri: "file:///home/user/sandbox/app/src/KeyConfig.cs",
    libraryUri: "file:///usr/share/dotnet/packs/Microsoft.NETCore.App.Ref/8.0.0/ref/net8.0/System.Collections.cs",
    defSrc: `namespace App;

public class KeyConfig
{
    public int Slots;

    public long RollActive()
    {
        return 0;
    }
}
`,
    hover: "class KeyConfig",
    members: [["Slots", "Slots : int", "field"], ["RollActive", "RollActive() : long", "method"]],
    evidence: ["RollActive"],
  },
  {
    languageId: "python",
    mainUri: "file:///home/user/sandbox/app/keys.py",
    src: `def load_keys(cfg: KeyConfig) -> int:
    """Load the keys from cfg."""
    raise NotImplementedError
`,
    spanStart: "def load_keys",
    spanEnd: "raise NotImplementedError",
    signature: "def load_keys(cfg: KeyConfig) -> int",
    docComment: '"""Load the keys from cfg."""',
    symbolName: "load_keys",
    projectUri: "file:///home/user/sandbox/app/config.py",
    libraryUri: "file:///usr/lib/python3.12/dataclasses.py",
    defSrc: `class KeyConfig:
    slots: int = 0

    def roll_active(self) -> int:
        return 0
`,
    hover: "class KeyConfig",
    members: [["slots", "slots: int", "field"], ["roll_active", "roll_active(self) -> int", "method"]],
    evidence: ["roll_active"],
  },
  {
    languageId: "go",
    mainUri: "file:///home/user/sandbox/app/keys/keys.go",
    src: `package keys

// LoadKeys loads the keys from cfg.
func LoadKeys(cfg KeyConfig) uint32 {
\tpanic("todo")
}
`,
    spanStart: "func LoadKeys",
    spanEnd: 'panic("todo")\n}',
    signature: "func LoadKeys(cfg KeyConfig) uint32",
    docComment: "// LoadKeys loads the keys from cfg.",
    symbolName: "LoadKeys",
    projectUri: "file:///home/user/sandbox/app/keys/config.go",
    libraryUri: "file:///usr/local/go/src/time/time.go",
    defSrc: `package keys

type KeyConfig struct {
\tSlots uint32
}

func (c *KeyConfig) RollActive() uint32 {
\treturn 0
}
`,
    hover: "type KeyConfig struct { Slots uint32 }",
    members: [["Slots", "Slots uint32", "field"], ["RollActive", "RollActive() uint32", "method"]],
    evidence: ["RollActive"],
  },
];

for (const L of OTHER_LANGS) {
  // INTENT: item 1 is Rust's rule. The same collaborator, moved from the
  // project tree into the language's installed library tree, must produce the
  // same bytes for the four other languages. The identity assertion is paired
  // with a non-vacuity check, because two empty payloads are also identical and
  // would prove nothing.
  btest(`item 1 point 6 [${L.languageId}]: moving the collaborator's definition into the installed library tree changes NOTHING - the payload is byte-identical, because this is Rust's rule`, async () => {
    const mk = (defUri) => {
      const files = { [L.mainUri]: L.src, [defUri]: L.defSrc };
      return {
        languageId: L.languageId,
        mainUri: L.mainUri,
        files,
        tree: [],
        defTypes: {
          KeyConfig: {
            uri: defUri,
            hover: L.hover,
            members: L.members.map(([n, s, k]) => memberIn(files, defUri, n, s, k)),
          },
        },
        spanStart: L.spanStart,
        spanEnd: L.spanEnd,
        signature: L.signature,
        docComment: L.docComment,
        symbolName: L.symbolName,
      };
    };
    const project = await runPrefill(mk(L.projectUri));
    const library = await runPrefill(mk(L.libraryUri));
    // Non-vacuity: the project arm must actually carry the collaborator's
    // surface, or the identity below is a comparison of two nothings.
    assert.ok(
      project.names.includes("KeyConfig"),
      `[${L.languageId}] the project arm must render the collaborator's block, or this row compares two empty payloads and asserts nothing${dump(project)}`,
    );
    for (const needle of L.evidence) {
      assert.ok(
        project.text.includes(needle),
        `[${L.languageId}] the project arm must carry ${JSON.stringify(needle)}${dump(project)}`,
      );
    }
    assert.strictEqual(
      library.out,
      project.out,
      `[${L.languageId}] point 6: the other four languages must not change. A provenance check placed at a shared seam moves all five at once, and this row is where that shows up.\n  PROJECT ARM:\n${project.text}\n  LIBRARY ARM:\n${library.text}`,
    );
    assert.deepStrictEqual(
      library.logs.filter((l) => STDLIB_REASON.test(l)),
      [],
      `[${L.languageId}] and no stdlib skip reason may appear on a non-Rust channel${dump(library)}`,
    );
  });
}

