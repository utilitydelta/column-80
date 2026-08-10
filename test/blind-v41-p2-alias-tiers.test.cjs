// BLIND CONTRACT ORACLE - session-v41, phase 2: alias resolution, two tiers.
//
// Written from `session-v41/goal.md` (phase-2 section, the three-way evidence
// split, decision rule 1) and from the phase-2 contract handed to this oracle.
// Harness conventions copied from test/blind-v41-p1-trait-recovery.test.cjs and
// the G1/G2 rows of test/adversarial-v41-p1.test.cjs (vscode stub, resolvePrefill
// product path, makeDoc/makeExtractor shapes, member item shape
// `{ name, kind, signature }` from blind-v39-p1) - their BEHAVIOUR was not
// consulted. NO phase-2 implementation was read; none exists.
//
// ---------------------------------------------------------------------------
// THE CONTRACT
// ---------------------------------------------------------------------------
//
// TIER 1 (always): a candidate whose hover is a type-alias declaration
// (`type X = ...;` / `pub type X<T> = ...;`) injects its one-line hover as its
// surface instead of injecting nothing. The line renders through the admission
// seam phase 1 widened (`isSelfDescribingDeclaration`). Std/external targets
// get tier 1 ONLY - the std chase stays refused on provenance; `[u8; {const}]`
// ships as the hover gives it (thin, not false).
//
// TIER 2 (project targets only): the alias hover's RHS head identifier, when
// PROJECT-defined, is resolved from the alias's def site and walked as any
// type is. The rendered surface SPEAKS BOTH NAMES - alias and target - on one
// line (v22: a block naming only the target scores 0.0% at alias call sites).
// Methods require the def-site hop: definition() at the target ident, then
// membersOfType at the TARGET's def site (spike-3b: 0 members at the alias
// line, the full list only at the def site - the stub enforces exactly that).
//
// ---------------------------------------------------------------------------
// ROWS (all product-path: resolvePrefill through the vscode stub)
//
//   A  tier 1 for std-target aliases: `SyncResult` and `EntryHashBytes`
//      one-liners present verbatim; NO chase into Result even though the stub
//      answers a rustlib-path def WITH members - std member surface in the
//      payload is red.
//   B  tier 2 for a project-target alias (`MemCache = ShardMemCache<...>`):
//      a both-names line; target FIELDS present; target METHODS present -
//      the def-site-hop PIN: the stub returns members ONLY at the target's
//      own def file, so methods in the payload prove definition()-then-members
//      ran at the def site. Red if the chase resolves the target but loses
//      its members.
//   C  generic alias (`type Cache<V> = ShardCache<V>`): the RHS HEAD is
//      chased, not the generic param - target fields present.
//   D  RHS head is a non-type (`fn(u32) -> bool`) or unresolvable path
//      (`ffi::RawHandle`): tier 1 only, no invented surface, never throws.
//   E  duplicate-decl pin: the same alias name anchored at two different def
//      sites, same target - the rendered payload is byte-identical.
//   F  alias-to-alias: PINNED to single hop, no transitive chase (the goal's
//      refuse-unless-proven bar) - the terminal concrete type's fields must
//      NOT render through two hops; the alias's own line must.
//   G  CONTROL: a plain struct candidate renders as phase 1 left it - fields,
//      methods, and NO alias-shaped `type` line. GREEN today; pins
//      no-regression.
//   H  trait-target alias (`type Checker = dyn Validate`): tier-1 line
//      unconditional; the hop into the phase-1-recovered trait either
//      composes CORRECTLY (full method signature, no leak) or refuses
//      honestly - a mangled trait surface is red (A12-style pin).
//
// EXPECTED RED, and the baseline this file must show before any phase-2 code:
// A, B, C, D, E, F, H red - a type-alias hover renders NOTHING today (the
// census's "nothing renderable" line), so every one-liner assertion fails.
// G green (struct path is phase-1 territory and phase 1 is green); the bundle
// guard green (resolvePrefill exists).
//
// ---------------------------------------------------------------------------
// CONTRACT AMBIGUITIES HIT WHILE WRITING THIS. Pinned here, called out at rows.
//
//   Q1  Exact both-names wording is NOT pinned. The row spec says "one-liner
//       or header carries BOTH names", and the alias one-liner itself
//       (`type MemCache = ShardMemCache<...>`) satisfies it. The assertion is
//       "some payload line carries both names", nothing tighter.
//   Q2  `EntryHashBytes`: the goal says `{const}` ships as-is, and recovering
//       `32` is an optional loop decision. Both render green; any OTHER RHS
//       is red.
//   Q3  Row F picks: single hop, NO transitive chase. The terminal concrete
//       type's fields are forbidden through the double alias; whether the
//       intermediate alias's own line ALSO renders is left open on purpose.
//   Q4  Row H picks the A12 shape: compose-correctly or refuse-the-hop are
//       both green, a mangled or leaking trait surface is red; the tier-1
//       line is unconditional either way.
//   Q5  Row E pins byte equality of the WHOLE payload across the two anchor
//       sites - the payload is the rendered surface, and nothing in the
//       contract lets a def-site path leak into prompt bytes.
//   Q6  Harness deviation from the v39 stub, deliberate: membersOfType
//       answers ONLY when the cursor sits in the type's own def file. That is
//       spike-3b's PROVEN server shape (0 members at the alias line, 112 at
//       the def site) and it is what makes row B a def-site-hop pin instead
//       of a freebie.
//   Q7  Row A cannot tell "refused on provenance" from "chase not attempted";
//       both are the contract outcome (tier 1 only), so the row asserts the
//       observable: no std member surface in the payload.
//
// Run: SKIP_LIVE=1 node --test test/blind-v41-p2-alias-tiers.test.cjs

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const esbuild = require("esbuild");

// ===========================================================================
// HARNESS. resolvePrefill bundled against a vscode stub - the product path:
// the tier decision lives in the walk, so a pure-function oracle would miss
// the wiring. Stub copied from adversarial-v41-p1's G section, own file names.
// ===========================================================================

const STUB = path.join(__dirname, ".blind-v41-p2-vscode-stub.cjs");
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
      const files = globalThis.__BLIND41P2_FILES__ || {};
      const key = keyOf(arg);
      return Promise.resolve({ uri: mkUri(key), getText: () => files[key] });
    },
  },
};
`,
);

const ENTRY = path.join(__dirname, ".blind-v41-p2.entry.ts");
const OUTFILE = path.join(__dirname, ".blind-v41-p2.bundle.cjs");
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

test("bundle guard: resolvePrefill builds headless against the vscode stub", () => {
  if (bundleErr) assert.fail(`bundle failed to build: ${bundleErr.message}`);
  assert.equal(typeof resolvePrefill, "function", "resolvePrefill must be exported from src/vscode/fnGen");
});
const exportsMissing = typeof resolvePrefill !== "function";
const btest = (name, fn) =>
  test(name, (ctx) => {
    if (bundleErr || exportsMissing) return ctx.skip("bundle broken; see the bundle guard");
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

// defTypes: { name: { uri, hover, members } }. Q6: membersOfType answers ONLY
// at the type's own def file - spike-3b's proven server shape (0 members at
// the alias decl line, the full list only at the target's def site). The hop
// definition()-then-membersOfType is therefore the only way to a method list.
function makeExtractor(files, defTypes) {
  const known = new Set(Object.keys(defTypes));
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
    example: async () => undefined,
    completeMembers: async () => [],
    qualifyImport: async () => undefined,
  };
}

const WS = "file:///work/v41p2";

// paramTypes: the parameter type TEXTS in signature order (may carry generic
// args). types: [{ name, uri, hover, src, members }].
async function runPrefill(paramTypes, types) {
  const mainUri = `${WS}/main.rs`;
  const signature = `pub fn decide(${paramTypes.map((t, i) => `p${i}: ${t}`).join(", ")}) -> u32`;
  const src = `/// Decide the outcome.\n${signature} {\n    todo!()\n}\n`;
  const files = { [mainUri]: src };
  const defTypes = {};
  for (const t of types) {
    files[t.uri] = t.src;
    defTypes[t.name] = t;
  }
  const record = {
    span: { start: src.indexOf(signature), end: src.length - 1 },
    signature,
    docComment: "Decide the outcome.",
    symbolName: "decide",
    languageId: "rust",
    kind: "function",
    bodyOnly: false,
    headerIndent: "",
    bodyIndent: "    ",
    docstringRefusal: undefined,
  };
  const logs = [];
  globalThis.__BLIND41P2_FILES__ = files;
  let out;
  try {
    out = await resolvePrefill(makeExtractor(files, defTypes), makeDoc(src, mainUri), record, (l) => logs.push(String(l)));
  } finally {
    delete globalThis.__BLIND41P2_FILES__;
  }
  return { text: out || "", logs };
}

const show = (v) => JSON.stringify(v);
const dump = (r) => `\n  LOGS=${show(r.logs)}\n  FULL PAYLOAD:\n${r.text}`;
const hasLine = (text, re) => (text || "").split("\n").some((l) => re.test(l));
// Q1: "one-liner or header carries both names" - some single line carries both.
const bothOnOneLine = (text, a, b) =>
  (text || "").split("\n").some((l) => new RegExp(`\\b${a}\\b`).test(l) && new RegExp(`\\b${b}\\b`).test(l));

// ===========================================================================
// FIXTURES. Authored, modeled on the census aliases the goal names
// (`type MemCache = ShardMemCache<CompiledValidator>;`, `SyncResult`,
// `EntryHashBytes`). No fixture is quoted from the corpus.
// ===========================================================================

// --- A: std-target aliases. Result IS resolvable in this stub, at a rustlib
// path, WITH a member list - the trap: a chase that ignores provenance renders
// `is_ok`/`unwrap` and goes red.
const URI_SYNC = `${WS}/sync_result.rs`;
const URI_HASH = `${WS}/entry_hash.rs`;
const URI_STD_RESULT =
  "file:///home/user/.rustup/toolchains/stable-x86_64-unknown-linux-gnu/lib/rustlib/src/rust/library/core/src/result.rs";
const T_SYNC = {
  name: "SyncResult",
  uri: URI_SYNC,
  hover: "pub type SyncResult = Result<(), String>",
  src: ["/// Outcome of a WAL sync pass.", "pub type SyncResult = Result<(), String>;", ""].join("\n"),
  members: [],
};
const T_HASH = {
  name: "EntryHashBytes",
  uri: URI_HASH,
  // The hover the census proved: the const is elided by the server. Thin, not false.
  hover: "pub type EntryHashBytes = [u8; {const}]",
  src: ["pub const ENTRY_HASH_LEN: usize = 32;", "pub type EntryHashBytes = [u8; ENTRY_HASH_LEN];", ""].join("\n"),
  members: [],
};
const T_STD_RESULT = {
  name: "Result",
  uri: URI_STD_RESULT,
  hover: "pub enum Result<T, E> {\n    Ok(T),\n    Err(E),\n}",
  src: "pub enum Result<T, E> {\n    Ok(T),\n    Err(E),\n}\n",
  members: [
    { name: "is_ok", kind: "method", signature: "is_ok(&self) -> bool" },
    { name: "unwrap", kind: "method", signature: "unwrap(self) -> T" },
  ],
};

// --- B/E: the census's biggest alias, 12 failing rows. Realistic module shape.
const URI_MEMCACHE = `${WS}/memcache.rs`;
const URI_MEMCACHE_B = `${WS}/replica/memcache_local.rs`;
const URI_SHARDCACHE = `${WS}/shard_mem_cache.rs`;
const SRC_MEMCACHE = [
  "use crate::shard_mem_cache::ShardMemCache;",
  "use crate::compiled_validator::CompiledValidator;",
  "",
  "/// The node-local cache of compiled validators.",
  "pub type MemCache = ShardMemCache<CompiledValidator>;",
  "",
].join("\n");
const T_MEMCACHE = {
  name: "MemCache",
  uri: URI_MEMCACHE,
  hover: "pub type MemCache = ShardMemCache<CompiledValidator>",
  src: SRC_MEMCACHE,
  members: [],
};
const T_SHARDCACHE = {
  name: "ShardMemCache",
  uri: URI_SHARDCACHE,
  // spike-3b's PROVEN shape: hover on the target ident returns the FULL
  // field-bearing struct declaration.
  hover: [
    "pub struct ShardMemCache<V> {",
    "    pub shard_count: u32,",
    "    pub max_entries_per_shard: usize,",
    "    pub ttl_secs: u64,",
    "}",
  ].join("\n"),
  src: [
    "pub struct ShardMemCache<V> {",
    "    pub shard_count: u32,",
    "    pub max_entries_per_shard: usize,",
    "    pub ttl_secs: u64,",
    "}",
    "",
    "impl<V> ShardMemCache<V> {",
    "    pub fn get(&self, key: &str) -> Option<Arc<V>> {",
    "        None",
    "    }",
    "    pub fn insert(&self, key: String, value: V) -> bool {",
    "        false",
    "    }",
    "    pub fn purge_expired(&self) -> usize {",
    "        0",
    "    }",
    "}",
    "",
  ].join("\n"),
  members: [
    { name: "get", kind: "method", signature: "get(&self, key: &str) -> Option<Arc<V>>" },
    { name: "insert", kind: "method", signature: "insert(&self, key: String, value: V) -> bool" },
    { name: "purge_expired", kind: "method", signature: "purge_expired(&self) -> usize" },
  ],
};

// --- C: generic alias. The RHS head is ShardCache; a head parser that grabs
// the generic param chases `V`, finds nothing, and renders no fields.
const URI_CACHE = `${WS}/cache.rs`;
const URI_GEN_TARGET = `${WS}/shard_cache.rs`;
const T_CACHE = {
  name: "Cache",
  uri: URI_CACHE,
  hover: "pub type Cache<V> = ShardCache<V>",
  src: ["pub type Cache<V> = ShardCache<V>;", ""].join("\n"),
  members: [],
};
const T_GEN_TARGET = {
  name: "ShardCache",
  uri: URI_GEN_TARGET,
  hover: ["pub struct ShardCache<V> {", "    pub slots: Vec<V>,", "    pub capacity: usize,", "}"].join("\n"),
  src: [
    "pub struct ShardCache<V> {",
    "    pub slots: Vec<V>,",
    "    pub capacity: usize,",
    "}",
    "",
    "impl<V> ShardCache<V> {",
    "    pub fn lookup(&self, idx: usize) -> Option<&V> {",
    "        self.slots.get(idx)",
    "    }",
    "}",
    "",
  ].join("\n"),
  members: [{ name: "lookup", kind: "method", signature: "lookup(&self, idx: usize) -> Option<&V>" }],
};

// --- D: degenerate RHS heads. A fn-pointer and an unresolvable path.
const URI_CALLBACK = `${WS}/callback.rs`;
const URI_RAWHANDLE = `${WS}/raw_handle.rs`;
const T_CALLBACK = {
  name: "Callback",
  uri: URI_CALLBACK,
  hover: "pub type Callback = fn(u32) -> bool",
  src: ["pub type Callback = fn(u32) -> bool;", ""].join("\n"),
  members: [],
};
const T_RAWHANDLE = {
  name: "RawHandleAlias",
  uri: URI_RAWHANDLE,
  hover: "pub type RawHandleAlias = ffi::RawHandle",
  src: ["pub type RawHandleAlias = ffi::RawHandle;", ""].join("\n"),
  members: [],
};

// --- F: alias-to-alias. EventResult -> StoreResult -> StoreReceipt.
const URI_EVRES = `${WS}/event_result.rs`;
const URI_STORES = `${WS}/store_result.rs`;
const URI_RECEIPT = `${WS}/store_receipt.rs`;
const T_EVRES = {
  name: "EventResult",
  uri: URI_EVRES,
  hover: "pub type EventResult = StoreResult",
  src: ["pub type EventResult = StoreResult;", ""].join("\n"),
  members: [],
};
const T_STORES = {
  name: "StoreResult",
  uri: URI_STORES,
  hover: "pub type StoreResult = StoreReceipt",
  src: ["pub type StoreResult = StoreReceipt;", ""].join("\n"),
  members: [],
};
const T_RECEIPT = {
  name: "StoreReceipt",
  uri: URI_RECEIPT,
  hover: ["pub struct StoreReceipt {", "    pub receipt_id: u64,", "    pub wal_offset: u64,", "}"].join("\n"),
  src: [
    "pub struct StoreReceipt {",
    "    pub receipt_id: u64,",
    "    pub wal_offset: u64,",
    "}",
    "",
    "impl StoreReceipt {",
    "    pub fn ack(&self) -> bool {",
    "        true",
    "    }",
    "}",
    "",
  ].join("\n"),
  members: [{ name: "ack", kind: "method", signature: "ack(&self) -> bool" }],
};

// --- G: the struct control. No alias anywhere near it.
const URI_SHARDCONFIG = `${WS}/shard_config.rs`;
const T_SHARDCONFIG = {
  name: "ShardConfig",
  uri: URI_SHARDCONFIG,
  hover: ["pub struct ShardConfig {", "    pub shard_count: u32,", "    pub replication_factor: u8,", "}"].join("\n"),
  src: [
    "pub struct ShardConfig {",
    "    pub shard_count: u32,",
    "    pub replication_factor: u8,",
    "}",
    "",
    "impl ShardConfig {",
    "    pub fn validate_layout(&self) -> Result<(), String> {",
    "        Ok(())",
    "    }",
    "}",
    "",
  ].join("\n"),
  members: [{ name: "validate_layout", kind: "method", signature: "validate_layout(&self) -> Result<(), String>" }],
};

// --- H: trait-target alias. Validate answers the bare four-word hover with an
// empty member list (the phase-1 shape); its surface exists only in the def
// source, so a composed chase must ride phase 1's recovery.
const URI_CHECKER = `${WS}/checker.rs`;
const URI_VALIDATE = `${WS}/validate.rs`;
const T_CHECKER = {
  name: "Checker",
  uri: URI_CHECKER,
  hover: "pub type Checker = dyn Validate",
  src: ["pub type Checker = dyn Validate;", ""].join("\n"),
  members: [],
};
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

// ===========================================================================
// THE ROWS.
// ===========================================================================

btest("A [rust]: tier 1 - std-target alias one-liners inject verbatim; the std chase stays refused", async () => {
  const r = await runPrefill(["SyncResult", "EntryHashBytes"], [T_SYNC, T_HASH, T_STD_RESULT]);
  assert.ok(
    hasLine(r.text, /type SyncResult\s*=\s*Result<\(\), String>/),
    `tier 1 is unconditional: the alias's one-line hover is its surface, not nothing.${dump(r)}`,
  );
  assert.ok(
    hasLine(r.text, /type EntryHashBytes\s*=\s*\[u8;\s*(\{const\}|32)\]/),
    `the hover's line ships as given - \`{const}\` is thin, not false (Q2: a loop-recovered 32 is also green).${dump(r)}`,
  );
  // The trap: the stub RESOLVES Result at a rustlib path and would hand over
  // members. Provenance must refuse the chase (Q7: asserted on the outcome).
  assert.ok(
    !/is_ok|unwrap/.test(r.text),
    `std member surface reached the payload: the chase into Result violates the provenance refusal.${dump(r)}`,
  );
  assert.ok(
    !hasLine(r.text, /pub enum Result/),
    `Result's own declaration is a std surface; tier 1 ships the alias LINE only.${dump(r)}`,
  );
});

btest("B [rust]: tier 2 - project-target alias speaks both names, target fields AND methods render (the def-site-hop PIN)", async () => {
  const r = await runPrefill(["MemCache"], [T_MEMCACHE, T_SHARDCACHE]);
  assert.ok(
    bothOnOneLine(r.text, "MemCache", "ShardMemCache"),
    `no payload line names BOTH the alias and its target (v22: target-only naming scores 0.0% at ` +
      `alias call sites; Q1: the one-liner itself satisfies this).${dump(r)}`,
  );
  for (const f of [/shard_count/, /max_entries_per_shard/, /ttl_secs/]) {
    assert.ok(f.test(r.text), `target field ${f} missing: the walk did not reach ShardMemCache's shape.${dump(r)}`);
  }
  // The PIN: the stub answers membersOfType ONLY at shard_mem_cache.rs (Q6),
  // so these three lines can arrive one way alone: definition() at the target
  // ident, then membersOfType at the TARGET's def site. Red if the chase
  // resolves the target but loses its members.
  for (const m of [/get\(&self, key: &str\)/, /insert\(&self, key: String/, /purge_expired\(&self\)/]) {
    assert.ok(
      m.test(r.text),
      `target METHOD ${m} missing: the def-site hop (definition() then membersOfType at the ` +
        `target's def site) did not run - the alias resolved but lost its member surface.${dump(r)}`,
    );
  }
});

btest("C [rust]: generic alias - the RHS HEAD is chased, not the generic param", async () => {
  const r = await runPrefill(["Cache<u64>"], [T_CACHE, T_GEN_TARGET]);
  assert.ok(
    bothOnOneLine(r.text, "Cache", "ShardCache"),
    `no payload line names both the generic alias and its target head.${dump(r)}`,
  );
  for (const f of [/slots/, /capacity/]) {
    assert.ok(
      f.test(r.text),
      `target field ${f} missing: a head parser that took \`V\` (the generic param) instead of ` +
        `\`ShardCache\` chases nothing and renders nothing.${dump(r)}`,
    );
  }
  assert.ok(/lookup\(&self, idx: usize\)/.test(r.text), `the target's method surface via the def-site hop.${dump(r)}`);
});

btest("D [rust]: non-type / unresolvable RHS heads - tier 1 only, no invented surface, never throws", async () => {
  // Reaching the assertions at all is the never-throws half of the row.
  const r = await runPrefill(["Callback", "RawHandleAlias"], [T_CALLBACK, T_RAWHANDLE]);
  assert.ok(
    hasLine(r.text, /type Callback\s*=\s*fn\(u32\)\s*->\s*bool/),
    `a fn-pointer RHS has no head to chase, but tier 1 is unconditional: the line still injects.${dump(r)}`,
  );
  assert.ok(
    hasLine(r.text, /type RawHandleAlias\s*=\s*ffi::RawHandle/),
    `an unresolvable path RHS: tier 1 line still injects.${dump(r)}`,
  );
  assert.ok(
    !/RawHandle \{|Callback \{/.test(r.text),
    `no target resolved, so no braced surface may exist for either alias - anything here is invented.${dump(r)}`,
  );
});

btest("E [rust]: duplicate-decl pin - the same alias anchored at two different def sites renders the same surface", async () => {
  // The goal's five-MemCache-decls row: same name, same target, different
  // module-local def sites. Whichever site anchors, the surface is the same.
  const siteA = await runPrefill(["MemCache"], [T_MEMCACHE, T_SHARDCACHE]);
  const siteB = await runPrefill(
    ["MemCache"],
    [{ ...T_MEMCACHE, uri: URI_MEMCACHE_B, src: SRC_MEMCACHE }, T_SHARDCACHE],
  );
  // Non-vacuity first: two empty payloads are equal and prove nothing.
  assert.ok(
    bothOnOneLine(siteA.text, "MemCache", "ShardMemCache"),
    `precondition: the alias renders at site A at all.${dump(siteA)}`,
  );
  assert.equal(
    siteB.text,
    siteA.text,
    `the rendered payload differs by anchor site (Q5: pinned to byte equality - nothing in the ` +
      `contract lets a def-site path leak into prompt bytes).` +
      `\n  SITE A:\n${siteA.text}\n  SITE B:\n${siteB.text}`,
  );
});

btest("F [rust]: alias-to-alias - single hop, NO transitive chase (pinned per the refuse-unless-proven bar)", async () => {
  const r = await runPrefill(["EventResult"], [T_EVRES, T_STORES, T_RECEIPT]);
  assert.ok(
    hasLine(r.text, /type EventResult\s*=\s*StoreResult/),
    `tier 1 is unconditional even when the target is itself an alias.${dump(r)}`,
  );
  // Q3: the pin. StoreReceipt sits TWO hops away; its surface arriving means a
  // transitive chase ran. Whether StoreResult's own line also renders is left
  // open on purpose.
  assert.ok(
    !/receipt_id|wal_offset|ack\(&self\)/.test(r.text),
    `StoreReceipt's surface arrived through a double alias hop: the transitive chase is refused ` +
      `(single hop, then stop honestly).${dump(r)}`,
  );
});

btest("G [rust]: CONTROL - a plain struct candidate is untouched by the alias path (green today, pins no-regression)", async () => {
  const r = await runPrefill(["ShardConfig"], [T_SHARDCONFIG]);
  assert.ok(/shard_count/.test(r.text) && /replication_factor/.test(r.text), `the struct's fields render as phase 1 left them.${dump(r)}`);
  assert.ok(/validate_layout\(&self\)/.test(r.text), `the struct's method surface renders as phase 1 left it.${dump(r)}`);
  assert.ok(
    !hasLine(r.text, /type ShardConfig\s*=/),
    `no alias-shaped line may appear for a struct: the alias code path may not touch a non-alias hover.${dump(r)}`,
  );
});

btest("H [rust]: trait-target alias - tier-1 line unconditional; the hop composes with phase-1 recovery CORRECTLY or refuses honestly", async () => {
  const r = await runPrefill(["Checker"], [T_CHECKER, T_VALIDATE]);
  assert.ok(
    hasLine(r.text, /type Checker\s*=\s*dyn Validate/),
    `tier 1 is unconditional: the alias line injects whatever the target is.${dump(r)}`,
  );
  // Q4, the A12 shape: if any Validate surface rendered, it must be the
  // phase-1-recovered surface, correct and leak-free; a mangle is red.
  // Refusing the hop entirely (tier-1 line only) is also green.
  if (/fn validate/.test(r.text)) {
    assert.ok(
      /fn validate\(&self, event_value: &\[u8\]\)\s*->\s*Result<\(\), String>\s*;/.test(r.text),
      `mangled: the trait method rendered but not as its semicolon-terminated signature.${dump(r)}`,
    );
    assert.ok(
      bothOnOneLine(r.text, "Checker", "Validate"),
      `a composed trait surface must still speak both names on one line (Q1).${dump(r)}`,
    );
  }
  assert.ok(
    !/Validates a raw event/.test(r.text),
    `doc prose is not surface, composed or not.${dump(r)}`,
  );
});
