// BLIND ORACLE, session-v76 phases 2 and 3: a macro-generated type gets its
// members, and a tuple struct's private field says so.
//
// Binds session-v76/contract-p2.md (C1 to C4). Written without reading any
// implementation of it. Everything here drives a product entry point that
// existed before the session and asserts on what a transport observes: the
// requests that reach a language server, the rendered text, and the channel.
//
// TWO FAKE TRANSPORTS, and why the fake is not a plain SurfaceExtractor object.
// C1 is a mapping inside the transports (a completion item's `detail` becomes a
// member's signature), and the goal lets the fallback live "in resolveCrossFileShape
// (or the Rust extractor under it)". A fake that replaced the extractor would
// see neither. So the fakes sit one layer lower:
//
//   * HEADLESS: a fake `rust-analyzer` executable on PATH, spoken to by the real
//     RaLspExtractor over stdio. It logs every message it receives, so a count
//     of `textDocument/references` or `textDocument/completion` is a count of
//     real wire requests, retries included.
//   * VS CODE: the real RaCommandExtractor over an injected command runner that
//     answers vscode-shaped results and records every command.
//
// THE WIRE IS CAPTURED, not invented. Every hover, definition, reference list,
// documentSymbol tree and completion item for the fixture types below was
// recorded from rust-analyzer 1.96.0 on test/fixtures/extraction-macro-ids on
// 2026-09-29 (the definition lands on the bare `TenantId` token inside
// `newtype_id!(TenantId);`, `references` with includeDeclaration:false still
// returns that token, completion at `TenantId::` returns `const fn` details).
// The VS Code item labels (`new(…)`, sortText 7fffffe8/7ffffff6) follow the
// host capture in probe.md. Additions that are NOT captured, and why:
//   * `fmt(as Debug)` and `as_bytes(as IntoBytes)` join TenantId's completion.
//     The fixture's own trait items are all universal (Clone, PartialEq, Into)
//     and are dropped by existing filters, so without a non-universal trait
//     member "inherent only" could not fail. The acme capture in probe.md had 46
//     such items (zerocopy, serde); the label and sortText shape is theirs.
//   * `quiet.rs`, `shapes.rs`, `probe.rs` are virtual files the fake serves: a
//     macro type whose `::` path completes EMPTY (probe.md: 154 of 215 synthetic
//     cursors came back empty), and hand-written struct, trait, alias and generic
//     parameter shapes with empty member lists.
//   * The host-shaped trait items are left out of the VS Code rows. The host
//     labels trait members without `(as Trait)` and tier-stamps them 0, and the
//     contract hands that discriminator to the implementer's host-tier proof.
//     Inherent-only is asserted on the headless wire only.
//
// NOT ASSERTED: the deadline clause of C2 (no observable number in the
// contract), `SENTINEL` rendering either way, the exact wording of the C3 line
// beyond the two named substrings.
//
// Run: node --test test/blind-v76-p2-macro-members.test.cjs

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");
const esbuild = require("esbuild");
const { pathToFileURL } = require("node:url");
const { bundleCore } = require("./.blind-util.cjs");

// ===========================================================================
// Bundles: core (transport + resolver + pure renderers) and the fn-gen facade
// against a recording vscode stub.
// ===========================================================================

let core;
let coreCleanup = () => {};
let coreErr;
try {
  ({ mod: core, cleanup: coreCleanup } = bundleCore(
    "blind-v76-p2-core",
    `export { RaLspExtractor } from "../src/core/raLspClient";
export { resolveCrossFileShape } from "../src/core/crossFileShape";
export { renderMemberSignatures } from "../src/core/extraction";
export { renderFimCandidates } from "../src/core/fimInject";\n`,
  ));
} catch (e) {
  coreErr = e;
}

const STUB = path.join(__dirname, ".blind-v76-p2-vscode-stub.cjs");
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
const rec = () => (globalThis.__V76P2_VSCODE__ ||= { applyEdit: 0, workspaceEdits: 0, openWithContent: 0, executeCommand: [] });
const mkUri = (s) => ({ toString: () => String(s), fsPath: String(s).replace(/^file:\\/\\//, ""), path: String(s).replace(/^file:\\/\\//, ""), scheme: "file" });
const keyOf = (a) => (typeof a === "string" ? a : (a && a.toString ? a.toString() : String(a)));
module.exports = {
  Position, Range, Selection,
  WorkspaceEdit: class { constructor() { rec().workspaceEdits++; } replace() {} insert() {} delete() {} set() {} entries() { return []; } },
  EventEmitter: class { constructor(){ this.event=()=>({dispose(){}}); } fire(){} dispose(){} },
  ThemeColor: class {}, MarkdownString: class { constructor(v) { this.value = v || ""; } },
  Uri: { parse: mkUri, file: (p) => mkUri("file://" + p) },
  SymbolKind: { File:0, Module:1, Namespace:2, Package:3, Class:4, Method:5, Property:6,
    Field:7, Constructor:8, Enum:9, Interface:10, Function:11, Variable:12, Constant:13,
    String:14, Number:15, Boolean:16, Array:17, Object:18, Key:19, Null:20, EnumMember:21,
    Struct:22, Event:23, Operator:24, TypeParameter:25 },
  CompletionItemKind: { Text: 0, Method: 1, Function: 2, Constructor: 3, Field: 4, Variable: 5,
    Class: 6, Interface: 7, Module: 8, Property: 9, Unit: 10, Value: 11, Enum: 12, Keyword: 13,
    Snippet: 14, Color: 15, File: 16, Reference: 17, Folder: 18, EnumMember: 19, Constant: 20,
    Struct: 21, Event: 22, Operator: 23, TypeParameter: 24 },
  ProgressLocation: { SourceControl:1, Window:10, Notification:15 },
  EndOfLine: { LF:1, CRLF:2 },
  languages: { getDiagnostics: () => [] },
  window: { createOutputChannel: () => ({ appendLine() {}, append() {}, show() {}, dispose() {} }) },
  commands: { executeCommand: async (...a) => { rec().executeCommand.push(String(a[0])); return undefined; } },
  workspace: {
    getConfiguration: () => ({ get: (k, f) => f, has: () => false, inspect: () => undefined, update: async () => {} }),
    applyEdit: async () => { rec().applyEdit++; return true; },
    get textDocuments() { return []; },
    openTextDocument: (arg) => {
      if (arg && typeof arg === "object" && !arg.toString().startsWith("file:") && ("content" in arg || "language" in arg)) {
        rec().openWithContent++;
      }
      const files = globalThis.__V76P2_FILES__ || {};
      const key = keyOf(arg);
      return Promise.resolve({ uri: mkUri(key), languageId: "rust", version: 1, getText: () => files[key] });
    },
  },
};
`,
);
const ENTRY = path.join(__dirname, ".blind-v76-p2-fngen.entry.ts");
const OUTFILE = path.join(__dirname, ".blind-v76-p2-fngen.bundle.cjs");
let fngen;
let fngenErr;
try {
  fs.writeFileSync(
    ENTRY,
    `export { resolvePrefill } from "../src/vscode/fnGen";
export { RaCommandExtractor } from "../src/vscode/raExtractor";\n`,
  );
  esbuild.buildSync({ entryPoints: [ENTRY], bundle: true, outfile: OUTFILE, format: "cjs", platform: "node", alias: { vscode: STUB } });
  fngen = require(OUTFILE);
} catch (e) {
  fngenErr = e;
}
const V = require(STUB);

const FAKE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "blind-v76-p2-fake-ra-"));
let headless; // the shared RaLspExtractor for rows that count nothing
const started = []; // every extractor this file started, for disposal
test.after(() => {
  for (const ex of started) {
    try {
      ex.dispose();
    } catch {}
  }
  coreCleanup();
  for (const f of [STUB, ENTRY, OUTFILE]) fs.rmSync(f, { force: true });
  fs.rmSync(FAKE_DIR, { recursive: true, force: true });
});

test("bundle guard: the transports, the resolver and the fn-gen facade build headless", () => {
  if (coreErr) assert.fail(`core bundle failed: ${coreErr.message}`);
  if (fngenErr) assert.fail(`fn-gen bundle failed: ${fngenErr.message}`);
});
const btest = (name, fn) =>
  test(name, (ctx) => {
    if (coreErr || fngenErr) return ctx.skip("bundle broken; see the bundle guard");
    return fn(ctx);
  });

// ===========================================================================
// The world: the real fixture files plus three virtual ones.
// ===========================================================================

const FIX_SRC = path.join(__dirname, "fixtures", "extraction-macro-ids", "src");
const uriOf = (name) => pathToFileURL(path.join(FIX_SRC, name)).href;
const U = {
  ids: uriOf("ids.rs"),
  key: uriOf("key.rs"),
  plain: uriOf("plain.rs"),
  quiet: uriOf("quiet.rs"),
  shapes: uriOf("shapes.rs"),
  probe: uriOf("probe.rs"),
  holder: uriOf("holder.rs"),
};

const FILES = {
  [U.ids]: fs.readFileSync(path.join(FIX_SRC, "ids.rs"), "utf8"),
  [U.key]: fs.readFileSync(path.join(FIX_SRC, "key.rs"), "utf8"),
  [U.plain]: fs.readFileSync(path.join(FIX_SRC, "plain.rs"), "utf8"),
  // A macro type whose existing `QuietId::` path completes to nothing.
  [U.quiet]: [
    "macro_rules! quiet_id {",
    "    ($name:ident) => {",
    "        pub struct $name(u128);",
    "        impl $name {",
    "            pub const fn new(raw: u128) -> Self { Self(raw) }",
    "        }",
    "    };",
    "}",
    "",
    "quiet_id!(QuietId);",
    "",
    "pub fn quiet() -> QuietId {",
    "    QuietId::new(1)",
    "}",
    "",
  ].join("\n"),
  // Hand-written shapes with EMPTY member lists. None is macro-generated.
  [U.shapes]: [
    "pub struct Bare(u128);",
    "",
    "pub trait Sealer {}",
    "",
    "pub type Handle = Bare;",
    "",
    "pub fn take<T: Copy>(x: T, b: Bare, s: &dyn Sealer, h: Handle) -> u128 {",
    "    0",
    "}",
    "",
  ].join("\n"),
  // Walk roots for the plain types, and a real `Gauge::` completion site.
  [U.probe]: [
    "use crate::plain::{Gauge, SealedId};",
    "use crate::quiet::QuietId;",
    "",
    "/// Read the gauge.",
    "pub fn read_gauge(g: &Gauge) -> u32 {",
    "    todo!()",
    "}",
    "",
    "pub fn sealed_hold(s: SealedId) -> u128 {",
    "    0",
    "}",
    "",
    "pub fn quiet_hold(q: QuietId) -> u128 {",
    "    0",
    "}",
    "",
    "pub fn g() -> Gauge {",
    "    Gauge::empty()",
    "}",
    "",
  ].join("\n"),
  // C4 targets: a struct holding both hand-written tuple structs, so each
  // renders as a nested data shape the way TenantId does under StreamKey.
  [U.holder]: [
    "use crate::plain::{OpenId, SealedId};",
    "",
    "pub struct Holder {",
    "    pub open: OpenId,",
    "    pub sealed: SealedId,",
    "}",
    "",
    "/// Sum the two ids.",
    "pub fn total(h: &Holder) -> u128 {",
    "    todo!()",
    "}",
    "",
    "/// Unwrap a sealed id.",
    "pub fn seal(s: SealedId) -> u128 {",
    "    todo!()",
    "}",
    "",
  ].join("\n"),
};
const FILE_ORDER = [U.ids, U.key, U.plain, U.quiet, U.shapes, U.probe, U.holder];

const linesOf = (uri) => FILES[uri].split("\n");
/** The cursor ON `word` (one column in), on the first line containing `lineNeedle`. */
function siteOf(uri, lineNeedle, word) {
  const lines = linesOf(uri);
  const line = lines.findIndex((l) => l.includes(lineNeedle));
  assert.ok(line >= 0, `fixture moved: no line in ${uri} contains ${JSON.stringify(lineNeedle)}`);
  const at = lines[line].indexOf(word, lines[line].indexOf(lineNeedle));
  return { uri, line, character: at + 1 };
}
/** The cursor just after `Type::` on the first line containing `Type::`. */
function pathSite(uri, typeName) {
  const lines = linesOf(uri);
  const line = lines.findIndex((l) => l.includes(`${typeName}::`));
  assert.ok(line >= 0, `fixture moved: no ${typeName}:: in ${uri}`);
  return { uri, line, character: lines[line].indexOf(`${typeName}::`) + typeName.length + 2 };
}
function rangeOfWord(uri, lineNeedle, word) {
  const lines = linesOf(uri);
  const line = lines.findIndex((l) => l.includes(lineNeedle));
  const ch = lines[line].indexOf(word, lines[line].indexOf(lineNeedle));
  return { start: { line, character: ch }, end: { line, character: ch + word.length } };
}

// rust-analyzer 1.96.0 hover markdown, verbatim shape (captured), per module.
const md = (mod, sig, layout) =>
  `\n\`\`\`rust\nextraction_macro_ids::${mod}\n\`\`\`\n\n\`\`\`rust\n${sig}\n\`\`\`` + (layout ? `\n\n---\n\n${layout}` : "");

// types: def location, hover, whether the def is a macro-invocation token.
const TYPES = {
  TenantId: { def: { uri: U.ids, range: rangeOfWord(U.ids, "newtype_id!(TenantId)", "TenantId") }, hover: md("ids", "pub struct TenantId(u128)", "size = 16 (0x10), align = 0x10, no Drop"), macro: true },
  StreamId: { def: { uri: U.ids, range: rangeOfWord(U.ids, "newtype_id!(StreamId)", "StreamId") }, hover: md("ids", "pub struct StreamId(u128)", "size = 16 (0x10), align = 0x10, no Drop"), macro: true },
  GhostId: { def: { uri: U.ids, range: rangeOfWord(U.ids, "newtype_id!(GhostId)", "GhostId") }, hover: md("ids", "pub struct GhostId(u128)", "size = 16 (0x10), align = 0x10, no Drop"), macro: true },
  QuietId: { def: { uri: U.quiet, range: rangeOfWord(U.quiet, "quiet_id!(QuietId)", "QuietId") }, hover: md("quiet", "pub struct QuietId(u128)"), macro: true },
  StreamKey: { def: { uri: U.key, range: rangeOfWord(U.key, "pub struct StreamKey", "StreamKey") }, hover: md("key", "pub struct StreamKey {\n    pub tenant: TenantId,\n    pub stream: StreamId,\n    pub ghost: GhostId,\n}", "size = 48 (0x30), align = 0x10, no Drop") },
  Gauge: { def: { uri: U.plain, range: rangeOfWord(U.plain, "pub struct Gauge", "Gauge") }, hover: md("plain", "pub struct Gauge {\n    level: u32,\n}", "size = 4, align = 0x4, no Drop") },
  OpenId: { def: { uri: U.plain, range: rangeOfWord(U.plain, "pub struct OpenId", "OpenId") }, hover: md("plain", "pub struct OpenId(pub u128)", "size = 16 (0x10), align = 0x10, no Drop") },
  SealedId: { def: { uri: U.plain, range: rangeOfWord(U.plain, "pub struct SealedId", "SealedId") }, hover: md("plain", "pub struct SealedId(u128)", "size = 16 (0x10), align = 0x10, no Drop") },
  Holder: { def: { uri: U.holder, range: rangeOfWord(U.holder, "pub struct Holder", "Holder") }, hover: md("holder", "pub struct Holder {\n    pub open: OpenId,\n    pub sealed: SealedId,\n}", "size = 32 (0x20), align = 0x10, no Drop") },
  Bare: { def: { uri: U.shapes, range: rangeOfWord(U.shapes, "pub struct Bare", "Bare") }, hover: md("shapes", "pub struct Bare(u128)") },
  Sealer: { def: { uri: U.shapes, range: rangeOfWord(U.shapes, "pub trait Sealer", "Sealer") }, hover: md("shapes", "pub trait Sealer") },
  Handle: { def: { uri: U.shapes, range: rangeOfWord(U.shapes, "pub type Handle", "Handle") }, hover: md("shapes", "pub type Handle = Bare") },
  T: { def: { uri: U.shapes, range: rangeOfWord(U.shapes, "take<T", "T") }, hover: "\n```rust\nT: Copy\n```" },
};

// references: every whole-word occurrence in CODE, in file order. Comments are
// skipped: rust-analyzer never returns a comment as a reference, and both
// fixture files spell `GhostId::` and `TenantId` inside comments. It returned
// the macro-invocation token even with includeDeclaration:false (captured); a
// hand-written declaration is the declaration and is dropped. For TenantId this
// reproduces the captured list exactly (ids 29:12, key 0:36 3:16 9:23 20:25 21:4).
for (const [name, t] of Object.entries(TYPES)) {
  t.refs = [];
  for (const uri of FILE_ORDER) {
    linesOf(uri).forEach((text, line) => {
      const re = new RegExp(`\\b${name}\\b`, "g");
      const commentAt = text.indexOf("//");
      let m;
      while ((m = re.exec(text))) {
        if (commentAt >= 0 && m.index > commentAt) continue;
        const isDef = uri === t.def.uri && line === t.def.range.start.line && m.index === t.def.range.start.character;
        t.refs.push({ uri, range: { start: { line, character: m.index }, end: { line, character: m.index + name.length } }, decl: isDef && !t.macro });
      }
    });
  }
}

// documentSymbol, LSP numbering. ids/key/plain captured; the virtual files are
// the same shape.
const R = (l0, c0, l1, c1) => ({ start: { line: l0, character: c0 }, end: { line: l1, character: c1 } });
const fnSyms = (uri) =>
  linesOf(uri).flatMap((text, line) => {
    const m = /pub fn (\w+)/.exec(text);
    return m ? [{ name: m[1], detail: "fn()", kind: 12, range: R(line, 0, line, text.length), selectionRange: R(line, m.index + 7, line, m.index + 7 + m[1].length) }] : [];
  });
const SYMBOLS = {
  [U.ids]: [{ name: "newtype_id", kind: 12, range: R(0, 0, 27, 1), selectionRange: R(3, 13, 3, 23) }],
  [U.key]: [
    { name: "StreamKey", kind: 23, range: R(2, 0, 6, 1), selectionRange: R(2, 11, 2, 20), children: [
      { name: "tenant", detail: "TenantId", kind: 8, range: R(3, 4, 3, 24), selectionRange: R(3, 8, 3, 14) },
      { name: "stream", detail: "StreamId", kind: 8, range: R(4, 4, 4, 24), selectionRange: R(4, 8, 4, 14) },
      { name: "ghost", detail: "GhostId", kind: 8, range: R(5, 4, 5, 22), selectionRange: R(5, 8, 5, 13) } ] },
    { name: "impl StreamKey", kind: 19, range: R(8, 0, 16, 1), selectionRange: R(8, 5, 8, 14), children: [
      { name: "new", detail: "fn(tenant: TenantId, stream: StreamId, ghost: GhostId) -> Self", kind: 12, range: R(9, 4, 11, 5), selectionRange: R(9, 11, 9, 14) },
      { name: "is_blank", detail: "fn(&self) -> bool", kind: 6, range: R(13, 4, 15, 5), selectionRange: R(13, 11, 13, 19) } ] },
    { name: "first_tenant", detail: "fn() -> TenantId", kind: 12, range: R(18, 0, 22, 1), selectionRange: R(20, 7, 20, 19) },
    { name: "blank_stream", detail: "fn() -> StreamId", kind: 12, range: R(24, 0, 26, 1), selectionRange: R(24, 7, 24, 19) },
    { name: "describe", detail: "fn(key: &StreamKey) -> u128", kind: 12, range: R(28, 0, 30, 1), selectionRange: R(28, 7, 28, 15) },
  ],
  [U.plain]: [
    { name: "Gauge", kind: 23, range: R(2, 0, 5, 1), selectionRange: R(3, 11, 3, 16), children: [
      { name: "level", detail: "u32", kind: 8, range: R(4, 4, 4, 14), selectionRange: R(4, 4, 4, 9) } ] },
    { name: "impl Gauge", kind: 19, range: R(7, 0, 27, 1), selectionRange: R(7, 5, 7, 10), children: [
      { name: "empty", detail: "fn() -> Self", kind: 12, range: R(8, 4, 10, 5), selectionRange: R(8, 17, 8, 22) },
      { name: "level", detail: "fn(&self) -> u32", kind: 6, range: R(12, 4, 14, 5), selectionRange: R(12, 11, 12, 16) },
      { name: "level_unchecked", detail: "fn(&self) -> u32", kind: 6, range: R(16, 4, 18, 5), selectionRange: R(16, 18, 16, 33) },
      { name: "settle", detail: "fn(&self) -> u32", kind: 6, range: R(20, 4, 22, 5), selectionRange: R(20, 17, 20, 23) },
      { name: "from_raw", detail: "fn(level: u32) -> Self", kind: 12, range: R(24, 4, 26, 5), selectionRange: R(24, 24, 24, 32) } ] },
    { name: "OpenId", kind: 23, range: R(29, 0, 30, 28), selectionRange: R(30, 11, 30, 17) },
    { name: "SealedId", kind: 23, range: R(32, 0, 33, 26), selectionRange: R(33, 11, 33, 19) },
    { name: "impl SealedId", kind: 19, range: R(35, 0, 39, 1), selectionRange: R(35, 5, 35, 13), children: [
      { name: "new", detail: "fn(raw: u128) -> Self", kind: 12, range: R(36, 4, 38, 5), selectionRange: R(36, 11, 36, 14) } ] },
  ],
  [U.quiet]: [{ name: "quiet_id", kind: 12, range: R(0, 0, 7, 1), selectionRange: R(0, 13, 0, 21) }, ...fnSyms(U.quiet)],
  [U.shapes]: [
    { name: "Bare", kind: 23, range: R(0, 0, 0, 22), selectionRange: R(0, 11, 0, 15) },
    { name: "Sealer", kind: 11, range: R(2, 0, 2, 19), selectionRange: R(2, 10, 2, 16) },
    { name: "Handle", kind: 26, range: R(4, 0, 4, 23), selectionRange: R(4, 9, 4, 15) },
    ...fnSyms(U.shapes),
  ],
  [U.probe]: fnSyms(U.probe),
  [U.holder]: [
    { name: "Holder", kind: 23, range: R(2, 0, 5, 1), selectionRange: R(2, 11, 2, 17), children: [
      { name: "open", detail: "OpenId", kind: 8, range: R(3, 4, 3, 20), selectionRange: R(3, 8, 3, 12) },
      { name: "sealed", detail: "SealedId", kind: 8, range: R(4, 4, 4, 24), selectionRange: R(4, 8, 4, 14) } ] },
    ...fnSyms(U.holder),
  ],
};

// Completion at `Type::`, headless labels (captured 2026-09-29). TenantId gets
// two non-universal trait members on top (see the header).
const tenantLike = (T) => [
  { label: "eq(as PartialEq)", kind: 2, detail: "fn(&self, &Rhs) -> bool", sortText: "80000009" },
  { label: "try_from(as TryFrom)", kind: 3, detail: "fn(T) -> Result<Self, <Self as TryFrom<T>>::Error>", sortText: "80000004" },
  { label: "clone_from(as Clone)", kind: 2, detail: "fn(&mut self, &Self)", sortText: "80000004" },
  { label: "to_owned(as ToOwned)", kind: 2, detail: "fn(&self) -> <Self as ToOwned>::Owned", sortText: "80000004" },
  { label: "new", kind: 3, detail: `const fn(u128) -> ${T}`, sortText: "7fffffdf" },
  { label: "ne(as PartialEq)", kind: 2, detail: "fn(&self, &Rhs) -> bool", sortText: "80000009" },
  { label: "from(as From)", kind: 3, detail: "fn(T) -> Self", sortText: "80000004" },
  { label: "try_into(as TryInto)", kind: 2, detail: "fn(self) -> Result<T, <Self as TryInto<T>>::Error>", sortText: "80000004" },
  { label: "clone_into(as ToOwned)", kind: 2, detail: "fn(&self, &mut <Self as ToOwned>::Owned)", sortText: "80000004" },
  { label: "SENTINEL", kind: 21, detail: "pub const SENTINEL: Self", sortText: "7fffffff" },
  { label: "get", kind: 2, detail: "const fn(self) -> u128", sortText: "7fffffff" },
  { label: "clone(as Clone)", kind: 2, detail: "fn(&self) -> Self", sortText: "80000004" },
  { label: "into(as Into)", kind: 2, detail: "fn(self) -> T", sortText: "80000004" },
  { label: "is_sentinel", kind: 2, detail: "const fn(self) -> bool", sortText: "7fffffff" },
  { label: "fmt(as Debug)", kind: 2, detail: "fn(&self, &mut Formatter<'_>) -> Result<(), Error>", sortText: "80000004" },
  { label: "as_bytes(as IntoBytes)", kind: 2, detail: "fn(&self) -> &[u8]", sortText: "80000004" },
];
const COMPLETION = {
  TenantId: tenantLike("TenantId"),
  StreamId: tenantLike("StreamId"),
  QuietId: [],
  Gauge: [
    { label: "try_into(as TryInto)", kind: 2, detail: "fn(self) -> Result<T, <Self as TryInto<T>>::Error>", sortText: "80000004" },
    { label: "clone_into(as ToOwned)", kind: 2, detail: "fn(&self, &mut <Self as ToOwned>::Owned)", sortText: "80000004" },
    { label: "settle", kind: 2, detail: "async fn(&self) -> u32", sortText: "7fffffff" },
    { label: "try_from(as TryFrom)", kind: 3, detail: "fn(T) -> Result<Self, <Self as TryFrom<T>>::Error>", sortText: "80000004" },
    { label: "clone_from(as Clone)", kind: 2, detail: "fn(&mut self, &Self)", sortText: "80000004" },
    { label: "to_owned(as ToOwned)", kind: 2, detail: "fn(&self) -> <Self as ToOwned>::Owned", sortText: "80000004" },
    { label: "level_unchecked", kind: 2, detail: "unsafe fn(&self) -> u32", sortText: "7fffffff" },
    { label: "clone(as Clone)", kind: 2, detail: "fn(&self) -> Self", sortText: "80000004" },
    { label: "into(as Into)", kind: 2, detail: "fn(self) -> T", sortText: "80000004" },
    { label: "level", kind: 2, detail: "fn(&self) -> u32", sortText: "7fffffff" },
    { label: "from(as From)", kind: 3, detail: "fn(T) -> Self", sortText: "80000004" },
    { label: "from_raw", kind: 3, detail: "const unsafe fn(u32) -> Gauge", sortText: "7fffffdf" },
    { label: "empty", kind: 3, detail: "const fn() -> Gauge", sortText: "7fffffde" },
  ],
};

// ===========================================================================
// Headless: a fake rust-analyzer on PATH.
// ===========================================================================

const WORLD_PATH = path.join(FAKE_DIR, "world.json");
const LOG_PATH = path.join(FAKE_DIR, "wire.log");
fs.writeFileSync(
  WORLD_PATH,
  JSON.stringify({
    files: FILES,
    types: Object.fromEntries(Object.entries(TYPES).map(([n, t]) => [n, { def: t.def, hover: t.hover, refs: t.refs }])),
    symbols: SYMBOLS,
    completion: COMPLETION,
  }),
);
fs.writeFileSync(LOG_PATH, "");
const SERVER = path.join(FAKE_DIR, "rust-analyzer");
fs.writeFileSync(
  SERVER,
  `#!/usr/bin/env node
const fs = require("fs");
const world = JSON.parse(fs.readFileSync(${JSON.stringify(WORLD_PATH)}, "utf8"));
const LOG = ${JSON.stringify(LOG_PATH)};
let buf = Buffer.alloc(0);
process.stdin.on("data", (c) => {
  buf = Buffer.concat([buf, c]);
  for (;;) {
    const s = buf.indexOf("\\r\\n\\r\\n");
    if (s < 0) return;
    const m = /Content-Length: (\\d+)/i.exec(buf.subarray(0, s).toString());
    const n = Number(m[1]);
    if (buf.length < s + 4 + n) return;
    const msg = JSON.parse(buf.subarray(s + 4, s + 4 + n).toString("utf8"));
    buf = buf.subarray(s + 4 + n);
    handle(msg);
  }
});
function send(msg) {
  const b = Buffer.from(JSON.stringify(msg));
  process.stdout.write("Content-Length: " + b.length + "\\r\\n\\r\\n");
  process.stdout.write(b);
}
function wordAt(uri, pos) {
  const t = world.files[uri];
  if (t === undefined || !pos) return undefined;
  const line = t.split("\\n")[pos.line] || "";
  const w = (c) => /[A-Za-z0-9_]/.test(c || "");
  let s = pos.character, e = pos.character;
  while (s > 0 && w(line[s - 1])) s--;
  while (e < line.length && w(line[e])) e++;
  return line.slice(s, e) || undefined;
}
function handle(msg) {
  fs.appendFileSync(LOG, JSON.stringify({ method: msg.method, id: msg.id, params: msg.params }) + "\\n");
  if (msg.method === "exit") process.exit(0);
  if (msg.id === undefined || msg.method === undefined) return;
  const p = msg.params || {};
  const uri = p.textDocument && p.textDocument.uri;
  const type = (() => { const w = wordAt(uri, p.position); return w && world.types[w] ? world.types[w] : undefined; })();
  let result = null;
  switch (msg.method) {
    case "initialize": result = { capabilities: {} }; break;
    case "textDocument/definition": result = type ? [{ uri: type.def.uri, range: type.def.range }] : null; break;
    case "textDocument/hover": result = type && type.hover ? { contents: { kind: "markdown", value: type.hover } } : null; break;
    case "textDocument/documentSymbol": result = world.symbols[uri] || []; break;
    case "textDocument/references": {
      // Amendment 1 rows: a type named in the control file answers [] (a
      // cancelled or not-ready server), until the file is removed.
      let emptyFor = [];
      try { emptyFor = JSON.parse(fs.readFileSync(${JSON.stringify(path.join(FAKE_DIR, "refs-empty.json"))}, "utf8")); } catch {}
      const w0 = wordAt(uri, p.position);
      if (w0 && emptyFor.includes(w0)) { result = []; break; }
      const all = !!(p.context && p.context.includeDeclaration);
      result = type ? type.refs.filter((r) => all || !r.decl).map((r) => ({ uri: r.uri, range: r.range })) : [];
      break;
    }
    case "textDocument/completion": {
      const line = ((world.files[uri] || "").split("\\n")[p.position.line] || "").slice(0, p.position.character);
      const m = /([A-Za-z_][A-Za-z0-9_]*)::[A-Za-z0-9_]*$/.exec(line);
      result = m && world.completion[m[1]] ? world.completion[m[1]] : [];
      break;
    }
    case "completionItem/resolve": result = p; break;
    default: result = null;
  }
  send({ jsonrpc: "2.0", id: msg.id, result });
}
`,
);
fs.chmodSync(SERVER, 0o755);

/** A NEW server session. Amendment 1 memoizes per extractor, so any row that
 *  counts a first walk's asks starts its own. */
async function freshHeadless() {
  const saved = process.env.PATH;
  process.env.PATH = `${FAKE_DIR}${path.delimiter}${saved}`;
  try {
    const ex = await core.RaLspExtractor.start({ workspaceRoot: FAKE_DIR });
    started.push(ex);
    return ex;
  } finally {
    process.env.PATH = saved;
  }
}
async function headlessExtractor() {
  return (headless ||= await freshHeadless());
}
const REFS_EMPTY = path.join(FAKE_DIR, "refs-empty.json");
const setEmptyRefs = (names) => (names.length ? fs.writeFileSync(REFS_EMPTY, JSON.stringify(names)) : fs.rmSync(REFS_EMPTY, { force: true }));

/** Run `fn` and return the wire messages the fake server received during it. */
async function onWire(fn) {
  const before = fs.readFileSync(LOG_PATH, "utf8").length;
  const value = await fn();
  const text = fs.readFileSync(LOG_PATH, "utf8").slice(before);
  const wire = text.split("\n").filter(Boolean).map((l) => JSON.parse(l));
  return { value, wire };
}

const wordAtCursor = (uri, pos) => {
  const line = (FILES[uri] || "").split("\n")[pos.line] || "";
  const w = (c) => /[A-Za-z0-9_]/.test(c || "");
  let s = pos.character;
  let e = pos.character;
  while (s > 0 && w(line[s - 1])) s--;
  while (e < line.length && w(line[e])) e++;
  return line.slice(s, e);
};
/** The type a `Type::` completion cursor completes on, or undefined. */
const pathTypeAt = (uri, pos) => {
  const before = ((FILES[uri] || "").split("\n")[pos.line] || "").slice(0, pos.character);
  const m = /([A-Za-z_][A-Za-z0-9_]*)::[A-Za-z0-9_]*$/.exec(before);
  return m ? m[1] : undefined;
};
const asks = (wire, method) => wire.filter((m) => m.method === method);
const refAsksFor = (wire, name) =>
  asks(wire, "textDocument/references").filter((m) => wordAtCursor(m.params.textDocument.uri, m.params.position) === name);
const completionAsksFor = (wire, name) =>
  asks(wire, "textDocument/completion").filter((m) => pathTypeAt(m.params.textDocument.uri, m.params.position) === name);
const showWire = (wire) =>
  wire
    .filter((m) => m.method && m.method.startsWith("textDocument/") && m.method !== "textDocument/didOpen")
    .map((m) => `${m.method} ${m.params.textDocument.uri.split("/").pop()}:${m.params.position ? `${m.params.position.line}:${m.params.position.character}` : ""}`)
    .join("\n    ");

const BOUND = { D_MAX: 2, N_MAX: 8 };
/** One walk. Without `ex`, a fresh server session, so the walk is a first walk.
 *  `files` overrides the text the resolver reads (the def-text-changed rows). */
async function walkHeadless(rootSite, ex, files = FILES) {
  ex ||= await freshHeadless();
  const openFile = async (uri) => {
    const text = files[uri];
    if (text !== undefined) ex.openDocument(uri, text);
    return text;
  };
  return onWire(() => core.resolveCrossFileShape(ex, rootSite, BOUND, openFile));
}

const ROOT = {
  StreamKey: () => siteOf(U.key, "pub fn describe(key: &StreamKey)", "StreamKey"),
  GhostId: () => siteOf(U.key, "pub ghost: GhostId", "GhostId"),
  Gauge: () => siteOf(U.probe, "pub fn read_gauge(g: &Gauge)", "Gauge"),
  SealedId: () => siteOf(U.probe, "pub fn sealed_hold(s: SealedId)", "SealedId"),
  QuietId: () => siteOf(U.probe, "pub fn quiet_hold(q: QuietId)", "QuietId"),
  Bare: () => siteOf(U.shapes, "b: Bare", "Bare"),
  Sealer: () => siteOf(U.shapes, "&dyn Sealer", "Sealer"),
  Handle: () => siteOf(U.shapes, "h: Handle", "Handle"),
  T: () => siteOf(U.shapes, "x: T", "T"),
};

const methodsOf = (shape, name) => shape.types.get(name)?.methods ?? [];
const has = (lines, re) => lines.some((l) => re.test(l));
const MACRO_SIGS = (T) => [
  [/\bnew\(u128\) -> /, `new(u128) -> ...`],
  [/\bget\(self\) -> u128\b/, "get(self) -> u128"],
  [/\bis_sentinel\(self\) -> bool\b/, "is_sentinel(self) -> bool"],
];

// ===========================================================================
// C1. Qualified Rust functions keep their signature, both transports.
// ===========================================================================

function assertQualifiedGauge(members, transport) {
  const by = new Map(members.map((m) => [m.name, m]));
  for (const name of ["empty", "level", "level_unchecked", "settle", "from_raw"]) {
    assert.ok(by.has(name), `${transport}: ${name} is missing from Gauge:: completion: ${JSON.stringify(members.map((m) => m.name))}`);
    assert.ok(by.get(name).signature, `${transport}: ${name} came out with NO signature (C1): ${JSON.stringify(by.get(name))}`);
  }
  const rendered = core.renderMemberSignatures(members).split("\n");
  const line = (name) => rendered.find((l) => new RegExp(`\\b${name}\\(`).test(l));
  const dump = `\n  rendered:\n    ${rendered.join("\n    ")}`;
  for (const name of ["empty", "level", "level_unchecked", "settle", "from_raw"]) {
    assert.ok(line(name), `${transport}: no rendered line for ${name}${dump}`);
  }
  assert.match(line("settle"), /\basync\b/, `${transport}: settle is async and the rendered line hides it${dump}`);
  assert.match(line("level_unchecked"), /\bunsafe\b/, `${transport}: level_unchecked is unsafe and the rendered line hides it${dump}`);
  assert.match(line("from_raw"), /\bunsafe\b/, `${transport}: from_raw is const unsafe and the rendered line hides unsafe${dump}`);
  assert.match(line("from_raw"), /from_raw\(u32\) -> Gauge\b/, `${transport}: from_raw lost its parameter or return type${dump}`);
  assert.match(line("empty"), /empty\(\) -> Gauge\b/, `${transport}: empty lost its return type${dump}`);
  assert.match(line("level"), /level\(&self\) -> u32\b/, `${transport}: a plain fn must still render as before${dump}`);
  assert.doesNotMatch(line("level"), /\b(async|unsafe)\b/, `${transport}: a plain fn grew a qualifier${dump}`);
}

btest("C1 headless: Gauge:: members with const/unsafe/async details all keep a signature, async and unsafe stay visible", async () => {
  const ex = await headlessExtractor();
  const members = await ex.completeMembers(pathSite(U.probe, "Gauge"));
  assertQualifiedGauge(members, "headless");
});

btest("C1 headless: the TenantId:: member-site FIM block carries new/get/is_sentinel with types, not (none)", async () => {
  const ex = await headlessExtractor();
  const members = await ex.completeMembers(pathSite(U.key, "TenantId"));
  const block = core.renderFimCandidates(members, "");
  assert.ok(block, `the member-site block rendered nothing, which the prompt logs as (none). members=${JSON.stringify(members)}`);
  for (const [re, what] of MACRO_SIGS("TenantId")) {
    assert.match(block, re, `the FIM block lacks ${what}:\n${block}`);
  }
  assert.match(block, /\bnew\(u128\) -> TenantId\b/, `new's return type is TenantId:\n${block}`);
});

// VS Code transport: the host labels `new(…)` and ranks inherent members
// 7fffffe8/7ffffff6 (probe.md host capture). Gauge's host labels follow the same
// pattern with the headless details.
const hostItem = (name, kind, detail, sortText = "7ffffff6") => ({ label: `${name}(…)`, kind, detail, sortText });
const HOST_COMPLETION = {
  TenantId: [
    hostItem("new", 2, "const fn(u128) -> TenantId", "7fffffe8"),
    { label: "SENTINEL", kind: 20, detail: "pub const SENTINEL: Self", sortText: "7ffffff6" },
    hostItem("get", 1, "const fn(self) -> u128"),
    hostItem("is_sentinel", 1, "const fn(self) -> bool"),
  ],
  StreamId: [
    hostItem("new", 2, "const fn(u128) -> StreamId", "7fffffe8"),
    { label: "SENTINEL", kind: 20, detail: "pub const SENTINEL: Self", sortText: "7ffffff6" },
    hostItem("get", 1, "const fn(self) -> u128"),
    hostItem("is_sentinel", 1, "const fn(self) -> bool"),
  ],
  Gauge: [
    hostItem("empty", 2, "const fn() -> Gauge", "7fffffe8"),
    hostItem("level", 1, "fn(&self) -> u32"),
    hostItem("level_unchecked", 1, "unsafe fn(&self) -> u32"),
    hostItem("settle", 1, "async fn(&self) -> u32"),
    hostItem("from_raw", 2, "const unsafe fn(u32) -> Gauge", "7fffffe8"),
  ],
};

const vUri = (s) => ({ toString: () => s });
const vSyms = (nodes) =>
  (nodes || []).map((n) => ({ name: n.name, detail: n.detail ?? "", kind: n.kind - 1, range: n.range, selectionRange: n.selectionRange, children: vSyms(n.children) }));
/** A recording vscode command runner answering from the same world. */
function commandRunner(calls) {
  return async (command, cursor, opts) => {
    calls.push({ command: String(command), cursor, opts });
    const c = String(command);
    const w = wordAtCursor(cursor.uri, cursor);
    const t = TYPES[w];
    if (c === "vscode.executeDefinitionProvider") return t ? [{ uri: vUri(t.def.uri), range: t.def.range }] : [];
    if (c === "vscode.executeHoverProvider") return t ? [{ contents: [{ value: t.hover }] }] : [];
    if (c === "vscode.executeDocumentSymbolProvider") return vSyms(SYMBOLS[cursor.uri]);
    if (c === "vscode.executeReferenceProvider") return t ? t.refs.map((r) => ({ uri: vUri(r.uri), range: r.range })) : [];
    if (c === "vscode.executeCompletionItemProvider") {
      const type = pathTypeAt(cursor.uri, cursor);
      return { items: (type && HOST_COMPLETION[type]) || [] };
    }
    return undefined;
  };
}

btest("C1 VS Code transport: Gauge:: members with qualified details keep a signature, async and unsafe stay visible", async () => {
  const ex = new fngen.RaCommandExtractor(commandRunner([]));
  const members = await ex.completeMembers(pathSite(U.probe, "Gauge"));
  assertQualifiedGauge(members, "vscode");
});

btest("C1 VS Code transport: the TenantId:: member-site FIM block carries new/get/is_sentinel with types", async () => {
  const ex = new fngen.RaCommandExtractor(commandRunner([]));
  const members = await ex.completeMembers(pathSite(U.key, "TenantId"));
  const block = core.renderFimCandidates(members, "");
  assert.ok(block, `the member-site block rendered nothing. members=${JSON.stringify(members)}`);
  for (const [re, what] of MACRO_SIGS("TenantId")) {
    assert.match(block, re, `the FIM block lacks ${what}:\n${block}`);
  }
});

// ===========================================================================
// C2. The macro-member fallback in the shared resolver (headless wire).
// ===========================================================================

btest("C2 headless: StreamKey's walk renders TenantId and StreamId with new/get/is_sentinel signatures", async () => {
  const { value: shape, wire } = await walkHeadless(ROOT.StreamKey());
  for (const T of ["TenantId", "StreamId"]) {
    const methods = methodsOf(shape, T);
    for (const [re, what] of MACRO_SIGS(T)) {
      assert.ok(has(methods, re), `${T} lacks ${what} in its API surface. methods=${JSON.stringify(methods)}\n  wire:\n    ${showWire(wire)}`);
    }
    assert.ok(has(methods, new RegExp(`\\bnew\\(u128\\) -> (${T}|Self)\\b`)), `${T}::new returns the type: ${JSON.stringify(methods)}`);
  }
});

btest("C2 headless: the fallback keeps INHERENT members only; no trait member reaches the API surface", async () => {
  const { value: shape } = await walkHeadless(ROOT.StreamKey());
  const inherent = new Set(["new", "get", "is_sentinel", "SENTINEL"]);
  for (const T of ["TenantId", "StreamId"]) {
    const methods = methodsOf(shape, T);
    assert.ok(methods.length > 0, `${T} rendered no members at all, so this row proves nothing yet`);
    for (const line of methods) {
      const name = (/([A-Za-z_][A-Za-z0-9_]*)\s*[(:]/.exec(line) || [])[1];
      assert.ok(inherent.has(name), `${T}: a non-inherent member reached the surface: ${JSON.stringify(line)} (all: ${JSON.stringify(methods)})`);
    }
  }
});

btest("C2 headless: per macro type, references() once, then ONE completion at the existing `Type::` path, in that order", async () => {
  const { wire } = await walkHeadless(ROOT.StreamKey());
  const dump = `\n  wire:\n    ${showWire(wire)}`;
  for (const T of ["TenantId", "StreamId"]) {
    const refs = refAsksFor(wire, T);
    const comps = completionAsksFor(wire, T);
    assert.equal(refs.length, 1, `${T}: references asks${dump}`);
    assert.equal(comps.length, 1, `${T}: completion asks at a ${T}:: path${dump}`);
    const want = pathSite(U.key, T);
    const got = comps[0].params;
    assert.deepEqual(
      { uri: got.textDocument.uri, line: got.position.line, character: got.position.character },
      { uri: want.uri, line: want.line, character: want.character },
      `${T}: the completion must sit just after the first reference followed by \`::\` (key.rs)`,
    );
    assert.ok(wire.indexOf(refs[0]) < wire.indexOf(comps[0]), `${T}: references must be asked before the completion${dump}`);
  }
  const stray = asks(wire, "textDocument/completion").filter((m) => !["TenantId", "StreamId"].includes(pathTypeAt(m.params.textDocument.uri, m.params.position)));
  assert.equal(stray.length, 0, `completion asked somewhere other than an existing TenantId::/StreamId:: path${dump}`);
});

btest("C2 headless: the fallback edits no document (no didChange, no scratch didOpen, every didOpen is the file's own bytes)", async () => {
  const { wire } = await walkHeadless(ROOT.StreamKey());
  assert.equal(asks(wire, "textDocument/didChange").length, 0, "a didChange went to the server during the walk");
  assert.equal(asks(wire, "workspace/applyEdit").length, 0);
  for (const m of asks(wire, "textDocument/didOpen")) {
    const { uri, text } = m.params.textDocument;
    assert.ok(uri in FILES, `a document the workspace does not have was opened: ${uri}`);
    assert.equal(text, FILES[uri], `didOpen of ${uri} carried text that is not the file's own bytes`);
  }
});

btest("C2 headless: a macro type whose `::` path completes EMPTY is asked exactly once (no retry loop)", async () => {
  const { value: shape, wire } = await walkHeadless(ROOT.QuietId());
  const dump = `\n  wire:\n    ${showWire(wire)}`;
  assert.ok(shape.types.has("QuietId") || shape.dropped.includes("QuietId"), `the walk never reached QuietId${dump}`);
  assert.equal(refAsksFor(wire, "QuietId").length, 1, `QuietId: references asks${dump}`);
  assert.equal(completionAsksFor(wire, "QuietId").length, 1, `QuietId: ONE completion ask, whatever it returns${dump}`);
});

// Pre-implementation baseline, measured with this harness on 2026-09-29: the
// walk rooted at each of these made this many completion asks. The contract
// allows nothing beyond it.
const BASELINE_COMPLETIONS = { Gauge: 0, SealedId: 0 };
for (const T of ["Gauge", "SealedId"]) {
  btest(`C2 headless: resolving ${T} (outline answered) makes ZERO references asks and no extra completion asks`, async () => {
    const { value: shape, wire } = await walkHeadless(ROOT[T]());
    const dump = `\n  wire:\n    ${showWire(wire)}`;
    assert.ok(methodsOf(shape, T).length > 0, `${T} must resolve its outline members (harness check)${dump}`);
    assert.equal(asks(wire, "textDocument/references").length, 0, `${T}: references asked${dump}`);
    assert.equal(asks(wire, "textDocument/completion").length, BASELINE_COMPLETIONS[T], `${T}: completion asks${dump}`);
  });
}

btest("C2 headless: StreamKey itself (outline answered) is never the subject of a references ask", async () => {
  const { wire } = await walkHeadless(ROOT.StreamKey());
  assert.equal(refAsksFor(wire, "StreamKey").length, 0, `\n  wire:\n    ${showWire(wire)}`);
  assert.equal(completionAsksFor(wire, "StreamKey").length, 0);
});

for (const [T, what] of [
  ["Bare", "a hand-written tuple struct with no impl"],
  ["Sealer", "a trait"],
  ["Handle", "a type alias"],
  ["T", "a generic parameter"],
]) {
  btest(`C2 headless: the fallback does not fire for ${what} (${T}) whose member list is empty`, async () => {
    const { wire } = await walkHeadless(ROOT[T]());
    const dump = `\n  wire:\n    ${showWire(wire)}`;
    assert.ok(asks(wire, "textDocument/hover").length > 0, `the walk never looked at ${T} (harness check)${dump}`);
    assert.equal(asks(wire, "textDocument/references").length, 0, `${T}: references asked${dump}`);
    assert.equal(asks(wire, "textDocument/completion").length, 0, `${T}: completion asked${dump}`);
  });
}

// ===========================================================================
// C3. No path: no completion ask, and the channel says so in words.
// ===========================================================================

btest("C3 headless: GhostId has no `GhostId::` anywhere: references asked, NO completion asked", async () => {
  for (const root of [ROOT.GhostId(), ROOT.StreamKey()]) {
    const { wire } = await walkHeadless(root);
    const dump = `\n  wire:\n    ${showWire(wire)}`;
    assert.equal(refAsksFor(wire, "GhostId").length, 1, `GhostId: references asks${dump}`);
    assert.equal(completionAsksFor(wire, "GhostId").length, 0, `GhostId: completion asked${dump}`);
    const onGhostFile = asks(wire, "textDocument/completion").filter((m) => m.params.textDocument.uri === U.ids);
    assert.equal(onGhostFile.length, 0, `a completion went to the def file (a synthetic cursor)${dump}`);
  }
});

// ===========================================================================
// Through the fn-gen pre-fill facade: channel (C3), surface (C2) and data
// shape (C4), headless transport.
// ===========================================================================

function makeDoc(uri) {
  const text = FILES[uri];
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
    uri: V.Uri.parse(uri),
    fileName: uri.replace(/^file:\/\//, ""),
    languageId: "rust",
    version: 1,
    lineCount: lines.length,
    offsetAt,
    positionAt,
    getText: (r) => (r ? text.slice(offsetAt(r.start), offsetAt(r.end)) : text),
    lineAt: (arg) => {
      const n = typeof arg === "number" ? arg : arg.line;
      const t = lines[n] ?? "";
      const m = t.match(/\S/);
      return { lineNumber: n, text: t, range: new V.Range(n, 0, n, t.length), firstNonWhitespaceCharacterIndex: m ? m.index : t.length, isEmptyOrWhitespace: !m };
    },
  };
}

async function prefill(extractor, uri, signature, symbolName, files = FILES) {
  const text = FILES[uri];
  const start = text.indexOf(signature);
  assert.ok(start >= 0, `fixture moved: ${signature}`);
  const end = text.indexOf("\n}", start) + 2;
  const docLine = text.slice(0, start).split("\n").slice(-2, -1)[0] || "";
  const record = {
    span: { start, end },
    signature,
    docComment: docLine.startsWith("///") ? docLine.replace(/^\/\/\/\s?/, "") : undefined,
    symbolName,
    languageId: "rust",
    kind: "function",
    bodyOnly: false,
    headerIndent: "",
    bodyIndent: "    ",
    docstringRefusal: undefined,
  };
  const logs = [];
  globalThis.__V76P2_FILES__ = files;
  globalThis.__V76P2_VSCODE__ = undefined;
  let out;
  try {
    out = await fngen.resolvePrefill(extractor, makeDoc(uri), record, (l) => logs.push(String(l)));
  } finally {
    delete globalThis.__V76P2_FILES__;
  }
  return { text: out || "", logs, vscode: globalThis.__V76P2_VSCODE__ };
}
const dumpPrefill = (r) => `\n  LOGS:\n    ${r.logs.join("\n    ")}\n  PAYLOAD:\n${r.text}`;

btest("C3 through the pre-fill: the channel names GhostId and says macro-generated", async () => {
  const ex = await freshHeadless();
  const r = await prefill(ex, U.key, "pub fn describe(key: &StreamKey) -> u128", "describe");
  const line = r.logs.find((l) => /\bGhostId\b/.test(l) && l.includes("macro-generated"));
  assert.ok(line, `no channel line names GhostId with "macro-generated"${dumpPrefill(r)}`);
});

btest("C2 through the pre-fill: the describe(StreamKey) prompt carries TenantId's new/get/is_sentinel", async () => {
  const ex = await freshHeadless();
  const r = await prefill(ex, U.key, "pub fn describe(key: &StreamKey) -> u128", "describe");
  for (const [re, what] of MACRO_SIGS("TenantId")) {
    assert.match(r.text, re, `the pre-fill surface lacks ${what}${dumpPrefill(r)}`);
  }
});

btest("C4 through the pre-fill: TenantId's data shape says its tuple field is private", async () => {
  const ex = await freshHeadless();
  const r = await prefill(ex, U.key, "pub fn describe(key: &StreamKey) -> u128", "describe");
  assert.ok(r.text.includes("pub struct TenantId(/* private */ u128)"), `missing \`pub struct TenantId(/* private */ u128)\`${dumpPrefill(r)}`);
  assert.ok(!/pub struct TenantId\(u128\)/.test(r.text), `the bare \`pub struct TenantId(u128)\` still renders${dumpPrefill(r)}`);
});

btest("C4 through the pre-fill: SealedId (hand-written, private field) renders /* private */", async () => {
  const ex = await freshHeadless();
  const r = await prefill(ex, U.holder, "pub fn seal(s: SealedId) -> u128", "seal");
  assert.ok(r.text.includes("pub struct SealedId(/* private */ u128)"), `missing \`pub struct SealedId(/* private */ u128)\`${dumpPrefill(r)}`);
  assert.ok(!/pub struct SealedId\(u128\)/.test(r.text), `the bare form still renders${dumpPrefill(r)}`);
});

btest("C4 through the pre-fill: nested under Holder, OpenId stays `pub struct OpenId(pub u128)` and SealedId says /* private */", async () => {
  const ex = await freshHeadless();
  const r = await prefill(ex, U.holder, "pub fn total(h: &Holder) -> u128", "total");
  assert.ok(r.text.includes("pub struct OpenId(pub u128)"), `missing \`pub struct OpenId(pub u128)\`${dumpPrefill(r)}`);
  assert.ok(!/OpenId\(\/\* private \*\//.test(r.text), `a public field was marked private${dumpPrefill(r)}`);
  assert.ok(r.text.includes("pub struct SealedId(/* private */ u128)"), `missing \`pub struct SealedId(/* private */ u128)\`${dumpPrefill(r)}`);
});

// ===========================================================================
// C2 and C3 on the VS Code command transport.
// ===========================================================================

async function walkCommand(rootSite) {
  const calls = [];
  const ex = new fngen.RaCommandExtractor(commandRunner(calls));
  globalThis.__V76P2_VSCODE__ = undefined;
  const shape = await core.resolveCrossFileShape(ex, rootSite, BOUND, async (uri) => FILES[uri]);
  return { shape, calls, vscode: globalThis.__V76P2_VSCODE__ };
}
const showCalls = (calls) =>
  calls.map((c) => `${c.command.replace("vscode.execute", "")} ${c.cursor.uri.split("/").pop()}:${c.cursor.line}:${c.cursor.character}`).join("\n    ");

btest("C2 VS Code transport: StreamKey's walk renders TenantId/StreamId members through one completion at each `::` path", async () => {
  const { shape, calls } = await walkCommand(ROOT.StreamKey());
  const dump = `\n  calls:\n    ${showCalls(calls)}`;
  for (const T of ["TenantId", "StreamId"]) {
    const methods = methodsOf(shape, T);
    for (const [re, what] of MACRO_SIGS(T)) {
      assert.ok(has(methods, re), `${T} lacks ${what}: ${JSON.stringify(methods)}${dump}`);
    }
    const refs = calls.filter((c) => c.command === "vscode.executeReferenceProvider" && wordAtCursor(c.cursor.uri, c.cursor) === T);
    const comps = calls.filter((c) => c.command === "vscode.executeCompletionItemProvider" && pathTypeAt(c.cursor.uri, c.cursor) === T);
    assert.equal(refs.length, 1, `${T}: reference commands${dump}`);
    assert.equal(comps.length, 1, `${T}: completion commands at a ${T}:: path${dump}`);
  }
  const ghostComps = calls.filter((c) => c.command === "vscode.executeCompletionItemProvider" && pathTypeAt(c.cursor.uri, c.cursor) === undefined);
  assert.equal(ghostComps.length, 0, `a completion ran at a cursor that is not an existing \`Type::\` path${dump}`);
});

btest("C2 VS Code transport: the fallback edits nothing (no applyEdit, no WorkspaceEdit, no scratch document, no side-channel command)", async () => {
  const { calls, vscode } = await walkCommand(ROOT.StreamKey());
  const v = vscode || { applyEdit: 0, workspaceEdits: 0, openWithContent: 0, executeCommand: [] };
  assert.equal(v.applyEdit, 0, "workspace.applyEdit was called");
  assert.equal(v.workspaceEdits, 0, "a WorkspaceEdit was built");
  assert.equal(v.openWithContent, 0, "an untitled/content document was opened");
  assert.deepEqual(v.executeCommand, [], "a vscode command bypassed the injected runner");
  const known = new Set([
    "vscode.executeDefinitionProvider",
    "vscode.executeHoverProvider",
    "vscode.executeDocumentSymbolProvider",
    "vscode.executeReferenceProvider",
    "vscode.executeCompletionItemProvider",
  ]);
  const other = calls.filter((c) => !known.has(c.command));
  assert.deepEqual(other.map((c) => c.command), [], "the walk dispatched a command outside the five read-only providers");
});

btest("C2 VS Code transport: Gauge and SealedId (outline answered) cost zero reference commands", async () => {
  for (const T of ["Gauge", "SealedId"]) {
    const { calls } = await walkCommand(ROOT[T]());
    const refs = calls.filter((c) => c.command === "vscode.executeReferenceProvider");
    assert.equal(refs.length, 0, `${T}: reference commands\n    ${showCalls(calls)}`);
  }
});

// ===========================================================================
// Amendment 1: memoized per extractor while the def text is unchanged; an
// EMPTY references() answer is "unavailable", never "no path", never memoized.
// ===========================================================================

btest("A1 headless: a second walk on the SAME extractor makes zero references and zero completion asks", async () => {
  const ex = await freshHeadless();
  const first = await walkHeadless(ROOT.StreamKey(), ex);
  const firstDump = `\n  first wire:\n    ${showWire(first.wire)}`;
  assert.equal(refAsksFor(first.wire, "TenantId").length, 1, `the first walk must ask (harness check)${firstDump}`);
  const second = await walkHeadless(ROOT.StreamKey(), ex);
  const dump = `\n  second wire:\n    ${showWire(second.wire)}`;
  for (const T of ["TenantId", "StreamId", "GhostId"]) {
    assert.equal(refAsksFor(second.wire, T).length, 0, `${T}: references asked again${dump}`);
    assert.equal(completionAsksFor(second.wire, T).length, 0, `${T}: completion asked again${dump}`);
  }
  for (const T of ["TenantId", "StreamId"]) {
    const methods = methodsOf(second.value, T);
    for (const [re, what] of MACRO_SIGS(T)) {
      assert.ok(has(methods, re), `${T}: the memoized walk lost ${what}: ${JSON.stringify(methods)}`);
    }
  }
});

btest("A1 headless: a new extractor is a new session and asks again", async () => {
  await walkHeadless(ROOT.StreamKey(), await freshHeadless());
  const { wire } = await walkHeadless(ROOT.StreamKey(), await freshHeadless());
  assert.equal(refAsksFor(wire, "TenantId").length, 1, `\n    ${showWire(wire)}`);
  assert.equal(completionAsksFor(wire, "TenantId").length, 1, `\n    ${showWire(wire)}`);
});

btest("A1 headless: changing the def file's text makes the next walk ask again", async () => {
  const ex = await freshHeadless();
  await walkHeadless(ROOT.StreamKey(), ex);
  // An appended comment: every position the server answers with stays valid.
  const edited = { ...FILES, [U.ids]: FILES[U.ids] + "// edited\n" };
  ex.applyEdit(U.ids, edited[U.ids]);
  const { value: shape, wire } = await walkHeadless(ROOT.StreamKey(), ex, edited);
  const dump = `\n  wire:\n    ${showWire(wire)}`;
  assert.equal(refAsksFor(wire, "TenantId").length, 1, `TenantId: references after the def text changed${dump}`);
  assert.equal(completionAsksFor(wire, "TenantId").length, 1, `TenantId: completion after the def text changed${dump}`);
  assert.equal(refAsksFor(wire, "GhostId").length, 1, `GhostId: references after the def text changed${dump}`);
  assert.ok(has(methodsOf(shape, "TenantId"), /\bget\(self\) -> u128\b/), JSON.stringify(methodsOf(shape, "TenantId")));
});

const noPathWording = (l) => /\bno\b[^.]*\bpath\b|\bnowhere\b|\bnever spell/i.test(l);

btest("A1 pre-fill: an EMPTY references() reply says unknown-this-time with macro-generated, never 'no path'; a later reply is honoured", async () => {
  const ex = await freshHeadless();
  let r;
  let wire;
  setEmptyRefs(["TenantId"]);
  try {
    ({ value: r, wire } = await onWire(() => prefill(ex, U.key, "pub fn describe(key: &StreamKey) -> u128", "describe")));
  } finally {
    setEmptyRefs([]);
  }
  const dump = dumpPrefill(r) + `\n  wire:\n    ${showWire(wire)}`;
  assert.ok(refAsksFor(wire, "TenantId").length >= 1, `TenantId: references was never asked, so the empty reply was never seen${dump}`);
  assert.equal(completionAsksFor(wire, "TenantId").length, 0, `TenantId: completion asked with no reference to complete at${dump}`);
  const tenantLines = r.logs.filter((l) => /\bTenantId\b/.test(l));
  assert.ok(tenantLines.some((l) => l.includes("macro-generated")), `no channel line names TenantId with "macro-generated"${dump}`);
  for (const l of tenantLines) {
    assert.ok(!noPathWording(l), `an empty references() reply was reported as no path: ${JSON.stringify(l)}${dump}`);
  }
  assert.ok(!r.text.includes("API surface for `TenantId`"), `TenantId members rendered with no completion behind them${dump}`);

  // The same extractor, the server answering now: not memoized, so it asks
  // and renders.
  const later = await onWire(() => prefill(ex, U.key, "pub fn describe(key: &StreamKey) -> u128", "describe"));
  const dump2 = dumpPrefill(later.value) + `\n  wire:\n    ${showWire(later.wire)}`;
  assert.equal(refAsksFor(later.wire, "TenantId").length, 1, `the empty answer was memoized: no second references ask${dump2}`);
  assert.equal(completionAsksFor(later.wire, "TenantId").length, 1, dump2);
  assert.match(later.value.text, /API surface for `TenantId`[\s\S]*?\bnew\(u128\) -> /, `TenantId's members did not render once the server answered${dump2}`);
});
