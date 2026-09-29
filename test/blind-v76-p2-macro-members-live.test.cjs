// BLIND ORACLE (LIVE), session-v76 phases 2 and 3, against the real
// rust-analyzer on PATH through RaLspExtractor.
//
// Binds session-v76/contract-p2.md. The fake-transport file next door
// (blind-v76-p2-macro-members.test.cjs) replays captured wire items; this one
// asks the server itself, because the whole fallback rests on what
// rust-analyzer does with a macro-generated type and a replay cannot notice the
// server changing its answer.
//
// THE CRATE IS A SCRATCH COPY of test/fixtures/extraction-macro-ids (target/
// excluded), never the fixture itself, with two additions the contract's rows
// need and the fixture does not carry:
//   * src/probe.rs: `Gauge::empty()`, the only way to put a real `Gauge::`
//     completion site in front of the server (C1's qualifier rows).
//   * src/holder.rs: `Holder { open: OpenId, sealed: SealedId }` and two
//     targets, so OpenId and SealedId render as data shapes (C4).
// Neither spells `GhostId`, so C3's "no path anywhere" still holds.
// CARGO_TARGET_DIR points into the OS temp dir so nothing lands in the repo.
//
// READINESS GATE. Every row first proves the server answers (a hover on
// StreamKey returns its struct). A dead or unindexed server otherwise passes
// every refusal row here: "no completion asked" and "zero references" are also
// what a server that answers nothing produces.
//
// The wire is counted by wrapping the transport's own request/notify on the
// instance, so a retry inside the transport counts as a second ask.
//
// Skips (never fails) without rust-analyzer on PATH. SKIP_LIVE=1 skips all.
// Run: node --test --test-concurrency=1 test/blind-v76-p2-macro-members-live.test.cjs

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");
const esbuild = require("esbuild");
const { execFileSync } = require("child_process");
const { pathToFileURL } = require("node:url");
const { bundleCore } = require("./.blind-util.cjs");

const SKIP_LIVE = process.env.SKIP_LIVE === "1";
const LIVE_TIMEOUT = 300_000;
const raOnPath = (() => {
  try {
    execFileSync("rust-analyzer", ["--version"], { timeout: 30_000, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

let core;
let coreCleanup = () => {};
let coreErr;
try {
  ({ mod: core, cleanup: coreCleanup } = bundleCore(
    "blind-v76-p2-live-core",
    `export { RaLspExtractor } from "../src/core/raLspClient";
export { resolveCrossFileShape } from "../src/core/crossFileShape";
export { renderMemberSignatures } from "../src/core/extraction";
export { renderFimCandidates } from "../src/core/fimInject";\n`,
  ));
} catch (e) {
  coreErr = e;
}

const STUB = path.join(__dirname, ".blind-v76-p2-live-vscode-stub.cjs");
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
const mkUri = (s) => ({ toString: () => String(s), fsPath: String(s).replace(/^file:\\/\\//, ""), path: String(s).replace(/^file:\\/\\//, ""), scheme: "file" });
const keyOf = (a) => (typeof a === "string" ? a : (a && a.toString ? a.toString() : String(a)));
module.exports = {
  Position, Range, Selection, WorkspaceEdit: class {},
  EventEmitter: class { constructor(){ this.event=()=>({dispose(){}}); } fire(){} dispose(){} },
  ThemeColor: class {}, MarkdownString: class { constructor(v) { this.value = v || ""; } },
  Uri: { parse: mkUri, file: (p) => mkUri("file://" + p) },
  SymbolKind: { File:0, Module:1, Namespace:2, Package:3, Class:4, Method:5, Property:6,
    Field:7, Constructor:8, Enum:9, Interface:10, Function:11, Variable:12, Constant:13,
    String:14, Number:15, Boolean:16, Array:17, Object:18, Key:19, Null:20, EnumMember:21,
    Struct:22, Event:23, Operator:24, TypeParameter:25 },
  ProgressLocation: { SourceControl:1, Window:10, Notification:15 },
  EndOfLine: { LF:1, CRLF:2 },
  languages: { getDiagnostics: () => [] },
  window: { createOutputChannel: () => ({ appendLine() {}, append() {}, show() {}, dispose() {} }) },
  commands: { executeCommand: async () => undefined },
  workspace: {
    getConfiguration: () => ({ get: (k, f) => f, has: () => false, inspect: () => undefined, update: async () => {} }),
    get textDocuments() { return []; },
    openTextDocument: (arg) => {
      const files = globalThis.__V76P2LIVE_FILES__ || {};
      const key = keyOf(arg);
      return Promise.resolve({ uri: mkUri(key), languageId: "rust", version: 1, getText: () => files[key] });
    },
  },
};
`,
);
const ENTRY = path.join(__dirname, ".blind-v76-p2-live-fngen.entry.ts");
const OUTFILE = path.join(__dirname, ".blind-v76-p2-live-fngen.bundle.cjs");
let fngen;
let fngenErr;
try {
  fs.writeFileSync(ENTRY, `export { resolvePrefill } from "../src/vscode/fnGen";\n`);
  esbuild.buildSync({ entryPoints: [ENTRY], bundle: true, outfile: OUTFILE, format: "cjs", platform: "node", alias: { vscode: STUB } });
  fngen = require(OUTFILE);
} catch (e) {
  fngenErr = e;
}
const V = require(STUB);

// ===========================================================================
// The scratch crate.
// ===========================================================================

const FIXTURE = path.join(__dirname, "fixtures", "extraction-macro-ids");
let crateRoot;
let targetDir;
const FILES = {}; // uri -> text, every .rs file in the scratch crate
const U = {};

const PROBE_RS = ["use crate::plain::Gauge;", "", "pub fn g() -> Gauge {", "    Gauge::empty()", "}", ""].join("\n");
const HOLDER_RS = [
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
].join("\n");

function buildCrate() {
  crateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "blind-v76-p2-live-"));
  fs.cpSync(FIXTURE, crateRoot, { recursive: true, filter: (src) => !src.split(path.sep).includes("target") });
  fs.writeFileSync(path.join(crateRoot, "src", "probe.rs"), PROBE_RS);
  fs.writeFileSync(path.join(crateRoot, "src", "holder.rs"), HOLDER_RS);
  fs.appendFileSync(path.join(crateRoot, "src", "lib.rs"), "pub mod probe;\npub mod holder;\n");
  for (const f of fs.readdirSync(path.join(crateRoot, "src"))) {
    const uri = pathToFileURL(path.join(crateRoot, "src", f)).href;
    FILES[uri] = fs.readFileSync(path.join(crateRoot, "src", f), "utf8");
    U[f.replace(/\.rs$/, "")] = uri;
  }
  // The property C3 stands on, checked on the copy the server sees.
  for (const [uri, text] of Object.entries(FILES)) {
    const code = text.split("\n").map((l) => (l.includes("//") ? l.slice(0, l.indexOf("//")) : l)).join("\n");
    assert.ok(!code.includes("GhostId::"), `the scratch crate spells GhostId:: in code (${uri}); C3 rows would be meaningless`);
  }
}

// One server for the file. Its wire is recorded by wrapping the transport's own
// request/notify on the instance.
const WIRE = [];
let exP;
const extras = []; // fresh sessions, disposed at the end
function extractor() {
  return (exP ||= (async () => {
    buildCrate();
    targetDir = fs.mkdtempSync(path.join(os.tmpdir(), "blind-v76-p2-live-target-"));
    return startRa(WIRE);
  })());
}
/** A NEW rust-analyzer session on the scratch crate. Amendment 1 memoizes per
 *  extractor, so a row that counts a first walk's asks needs its own. */
async function freshExtractor() {
  await extractor(); // the crate exists and the first server has indexed it
  const ex = await startRa(WIRE);
  extras.push(ex);
  return ex;
}
async function startRa(wireLog) {
  {
    const savedTarget = process.env.CARGO_TARGET_DIR;
    process.env.CARGO_TARGET_DIR = targetDir;
    let ex;
    try {
      ex = await core.RaLspExtractor.start({ workspaceRoot: crateRoot });
    } finally {
      if (savedTarget === undefined) delete process.env.CARGO_TARGET_DIR;
      else process.env.CARGO_TARGET_DIR = savedTarget;
    }
    const req = ex.request.bind(ex);
    ex.request = (method, params) => {
      wireLog.push({ method, params });
      return req(method, params);
    };
    const note = ex.notify.bind(ex);
    ex.notify = (method, params) => {
      wireLog.push({ method, params });
      return note(method, params);
    };
    for (const [uri, text] of Object.entries(FILES)) ex.openDocument(uri, text);
    await ex.whenReady(LIVE_TIMEOUT - 30_000);
    return ex;
  }
}

test.after(async () => {
  for (const ex of extras) {
    try {
      ex.dispose();
    } catch {}
  }
  try {
    if (exP) (await exP).dispose();
  } catch {}
  coreCleanup();
  for (const f of [STUB, ENTRY, OUTFILE]) fs.rmSync(f, { force: true });
  if (crateRoot) fs.rmSync(crateRoot, { recursive: true, force: true });
  if (targetDir) fs.rmSync(targetDir, { recursive: true, force: true });
});

test("bundle guard: the headless transport, resolver and fn-gen facade build", (ctx) => {
  if (SKIP_LIVE) return ctx.skip("SKIP_LIVE=1");
  if (coreErr) assert.fail(`core bundle failed: ${coreErr.message}`);
  if (fngenErr) assert.fail(`fn-gen bundle failed: ${fngenErr.message}`);
});

const lines = (uri) => FILES[uri].split("\n");
function siteOf(uri, lineNeedle, word) {
  const ls = lines(uri);
  const line = ls.findIndex((l) => l.includes(lineNeedle));
  assert.ok(line >= 0, `fixture moved: no line contains ${JSON.stringify(lineNeedle)}`);
  return { uri, line, character: ls[line].indexOf(word, ls[line].indexOf(lineNeedle)) + 1 };
}
function pathSite(uri, typeName) {
  const ls = lines(uri);
  const line = ls.findIndex((l) => l.includes(`${typeName}::`) && !l.trimStart().startsWith("//"));
  assert.ok(line >= 0, `fixture moved: no ${typeName}:: in ${uri}`);
  return { uri, line, character: ls[line].indexOf(`${typeName}::`) + typeName.length + 2 };
}
const wordAt = (uri, pos) => {
  const line = (FILES[uri] || "").split("\n")[pos.line] || "";
  const w = (c) => /[A-Za-z0-9_]/.test(c || "");
  let s = pos.character;
  let e = pos.character;
  while (s > 0 && w(line[s - 1])) s--;
  while (e < line.length && w(line[e])) e++;
  return line.slice(s, e);
};
const pathTypeAt = (uri, pos) => {
  const before = ((FILES[uri] || "").split("\n")[pos.line] || "").slice(0, pos.character);
  const m = /([A-Za-z_][A-Za-z0-9_]*)::[A-Za-z0-9_]*$/.exec(before);
  return m ? m[1] : undefined;
};
const asks = (wire, method) => wire.filter((m) => m.method === method);
const refAsksFor = (wire, name) =>
  asks(wire, "textDocument/references").filter((m) => wordAt(m.params.textDocument.uri, m.params.position) === name);
const completionAsksFor = (wire, name) =>
  asks(wire, "textDocument/completion").filter((m) => pathTypeAt(m.params.textDocument.uri, m.params.position) === name);
const showWire = (wire) =>
  wire
    .filter((m) => m.method.startsWith("textDocument/") && m.method !== "textDocument/didOpen")
    .map((m) => `${m.method} ${m.params.textDocument.uri.split("/").pop()}${m.params.position ? `:${m.params.position.line}:${m.params.position.character}` : ""}`)
    .join("\n    ");

/** The readiness gate: the server must answer a hover on StreamKey with its
 *  struct. Asserted, so a dead server FAILS the row instead of passing it. */
async function readyExtractor(given) {
  const ex = given || (await extractor());
  const hover = await ex.hoverSurface(siteOf(U.key, "pub struct StreamKey", "StreamKey"));
  assert.ok(hover && /pub struct StreamKey\b/.test(hover.signature), `rust-analyzer is not answering (hover=${JSON.stringify(hover)}); every refusal row here would pass vacuously`);
  return ex;
}

const ltest = (name, fn, opts = {}) =>
  test(name, { timeout: LIVE_TIMEOUT, ...opts }, async (ctx) => {
    if (SKIP_LIVE) return ctx.skip("SKIP_LIVE=1");
    if (coreErr || fngenErr) return ctx.skip("bundle broken; see the bundle guard");
    if (!raOnPath) return ctx.skip("rust-analyzer not on PATH");
    return fn(ctx);
  });

async function onWire(fn) {
  const from = WIRE.length;
  const value = await fn();
  return { value, wire: WIRE.slice(from) };
}
const BOUND = { D_MAX: 2, N_MAX: 8 };
async function walk(rootSite, given, files = FILES) {
  const ex = await readyExtractor(given);
  return onWire(() => core.resolveCrossFileShape(ex, rootSite, BOUND, async (uri) => files[uri]));
}
const methodsOf = (shape, name) => shape.types.get(name)?.methods ?? [];
const has = (ls, re) => ls.some((l) => re.test(l));
const MACRO_SIGS = [
  [/\bnew\(u128\) -> /, "new(u128) -> ..."],
  [/\bget\(self\) -> u128\b/, "get(self) -> u128"],
  [/\bis_sentinel\(self\) -> bool\b/, "is_sentinel(self) -> bool"],
];

// ===========================================================================
// C1, live.
// ===========================================================================

ltest("C1 live: Gauge:: members keep signatures; settle shows async, level_unchecked and from_raw show unsafe", async () => {
  const ex = await readyExtractor();
  const members = await ex.completeMembers(pathSite(U.probe, "Gauge"));
  const by = new Map(members.map((m) => [m.name, m]));
  for (const name of ["empty", "level", "level_unchecked", "settle", "from_raw"]) {
    assert.ok(by.get(name)?.signature, `${name} has no signature: ${JSON.stringify(by.get(name))} (all: ${JSON.stringify(members.map((m) => m.name))})`);
  }
  const rendered = core.renderMemberSignatures(members).split("\n");
  const line = (name) => rendered.find((l) => new RegExp(`\\b${name}\\(`).test(l)) || "";
  const dump = `\n  rendered:\n    ${rendered.join("\n    ")}`;
  assert.match(line("settle"), /\basync\b/, `settle is async${dump}`);
  assert.match(line("level_unchecked"), /\bunsafe\b/, `level_unchecked is unsafe${dump}`);
  assert.match(line("from_raw"), /\bunsafe\b/, `from_raw is const unsafe${dump}`);
  assert.match(line("from_raw"), /from_raw\(u32\) -> Gauge\b/, `from_raw's types${dump}`);
  assert.match(line("empty"), /empty\(\) -> Gauge\b/, `empty's return type${dump}`);
});

ltest("C1 live: the TenantId:: member-site FIM block carries new/get/is_sentinel with types", async () => {
  const ex = await readyExtractor();
  const members = await ex.completeMembers(pathSite(U.key, "TenantId"));
  const block = core.renderFimCandidates(members, "");
  assert.ok(block, `the block rendered nothing, i.e. (none). members=${JSON.stringify(members)}`);
  for (const [re, what] of MACRO_SIGS) assert.match(block, re, `the FIM block lacks ${what}:\n${block}`);
  assert.match(block, /\bnew\(u128\) -> TenantId\b/, block);
});

// ===========================================================================
// C2 and C3, live walk.
// ===========================================================================

ltest("C2 live: StreamKey's walk shows TenantId and StreamId with new/get/is_sentinel signatures, inherent only", async () => {
  const { value: shape, wire } = await walk(siteOf(U.key, "pub fn describe(key: &StreamKey)", "StreamKey"));
  const inherent = new Set(["new", "get", "is_sentinel", "SENTINEL"]);
  for (const T of ["TenantId", "StreamId"]) {
    const methods = methodsOf(shape, T);
    for (const [re, what] of MACRO_SIGS) {
      assert.ok(has(methods, re), `${T} lacks ${what}: ${JSON.stringify(methods)}\n  wire:\n    ${showWire(wire)}`);
    }
    for (const l of methods) {
      const name = (/([A-Za-z_][A-Za-z0-9_]*)\s*[(:]/.exec(l) || [])[1];
      assert.ok(inherent.has(name), `${T}: non-inherent member ${JSON.stringify(l)}`);
    }
  }
});

ltest("C2+C3 live wire (first walk, fresh session): references then ONE completion per pathed macro type; GhostId gets references and NO completion; nothing edited", async () => {
  const { wire } = await walk(siteOf(U.key, "pub fn describe(key: &StreamKey)", "StreamKey"), await freshExtractor());
  const dump = `\n  wire:\n    ${showWire(wire)}`;
  for (const T of ["TenantId", "StreamId"]) {
    const refs = refAsksFor(wire, T);
    const comps = completionAsksFor(wire, T);
    assert.equal(refs.length, 1, `${T}: references asks${dump}`);
    assert.equal(comps.length, 1, `${T}: completion asks (a retry counts)${dump}`);
    assert.equal(comps[0].params.textDocument.uri, U.key, `${T}: the completion must sit at the existing path in key.rs${dump}`);
    assert.ok(wire.indexOf(refs[0]) < wire.indexOf(comps[0]), `${T}: references before completion${dump}`);
  }
  assert.equal(refAsksFor(wire, "GhostId").length, 1, `GhostId: references asks${dump}`);
  assert.equal(completionAsksFor(wire, "GhostId").length, 0, `GhostId: completion asked${dump}`);
  assert.equal(asks(wire, "textDocument/completion").filter((m) => m.params.textDocument.uri === U.ids).length, 0, `a completion went to the def file${dump}`);
  assert.equal(asks(wire, "textDocument/didChange").length, 0, `a didChange went out${dump}`);
  for (const m of asks(wire, "textDocument/didOpen")) {
    assert.equal(m.params.textDocument.text, FILES[m.params.textDocument.uri], `didOpen with text that is not the file's bytes: ${m.params.textDocument.uri}`);
  }
});

for (const [T, root] of [
  ["Gauge", () => siteOf(U.probe, "pub fn g() -> Gauge", "Gauge")],
  ["SealedId", () => siteOf(U.holder, "pub fn seal(s: SealedId)", "SealedId")],
]) {
  ltest(`C2 live: resolving ${T} (outline answered) makes zero references asks and zero completion asks`, async () => {
    const { value: shape, wire } = await walk(root());
    const dump = `\n  wire:\n    ${showWire(wire)}`;
    assert.ok(methodsOf(shape, T).length > 0, `${T} resolved no outline members, so the zero counts prove nothing${dump}`);
    assert.equal(asks(wire, "textDocument/references").length, 0, `${T}: references${dump}`);
    assert.equal(asks(wire, "textDocument/completion").length, 0, `${T}: completion${dump}`);
  });
}

// ===========================================================================
// Through the fn-gen pre-fill facade, live.
// ===========================================================================

function makeDoc(uri) {
  const text = FILES[uri];
  const ls = text.split("\n");
  const offsetAt = (p) => {
    let o = 0;
    for (let i = 0; i < Math.min(p.line, ls.length); i++) o += ls[i].length + 1;
    return Math.min(o + p.character, text.length);
  };
  const positionAt = (off) => {
    let o = 0;
    for (let l = 0; l < ls.length; l++) {
      if (off <= o + ls[l].length) return new V.Position(l, off - o);
      o += ls[l].length + 1;
    }
    return new V.Position(ls.length - 1, 0);
  };
  return {
    uri: V.Uri.parse(uri),
    fileName: uri.replace(/^file:\/\//, ""),
    languageId: "rust",
    version: 1,
    lineCount: ls.length,
    offsetAt,
    positionAt,
    getText: (r) => (r ? text.slice(offsetAt(r.start), offsetAt(r.end)) : text),
    lineAt: (arg) => {
      const n = typeof arg === "number" ? arg : arg.line;
      const t = ls[n] ?? "";
      const m = t.match(/\S/);
      return { lineNumber: n, text: t, range: new V.Range(n, 0, n, t.length), firstNonWhitespaceCharacterIndex: m ? m.index : t.length, isEmptyOrWhitespace: !m };
    },
  };
}
async function prefill(uri, signature, symbolName) {
  const ex = await readyExtractor();
  const text = FILES[uri];
  const start = text.indexOf(signature);
  assert.ok(start >= 0, `fixture moved: ${signature}`);
  const record = {
    span: { start, end: text.indexOf("\n}", start) + 2 },
    signature,
    docComment: undefined,
    symbolName,
    languageId: "rust",
    kind: "function",
    bodyOnly: false,
    headerIndent: "",
    bodyIndent: "    ",
    docstringRefusal: undefined,
  };
  const logs = [];
  globalThis.__V76P2LIVE_FILES__ = FILES;
  let out;
  try {
    out = await fngen.resolvePrefill(ex, makeDoc(uri), record, (l) => logs.push(String(l)));
  } finally {
    delete globalThis.__V76P2LIVE_FILES__;
  }
  return { text: out || "", logs };
}
const dumpPrefill = (r) => `\n  LOGS:\n    ${r.logs.join("\n    ")}\n  PAYLOAD:\n${r.text}`;

ltest("C3 live: the describe(StreamKey) pre-fill channel names GhostId and says macro-generated", async () => {
  const r = await prefill(U.key, "pub fn describe(key: &StreamKey) -> u128", "describe");
  assert.ok(r.logs.some((l) => /\bGhostId\b/.test(l) && l.includes("macro-generated")), `no channel line names GhostId with "macro-generated"${dumpPrefill(r)}`);
});

ltest("C2 live: the describe(StreamKey) pre-fill prompt carries TenantId's and StreamId's new/get/is_sentinel", async () => {
  const r = await prefill(U.key, "pub fn describe(key: &StreamKey) -> u128", "describe");
  for (const [re, what] of MACRO_SIGS) assert.match(r.text, re, `the prompt lacks ${what}${dumpPrefill(r)}`);
  assert.match(r.text, /\bnew\(u128\) -> (TenantId|Self)\b/, dumpPrefill(r));
});

ltest("C4 live: TenantId renders `pub struct TenantId(/* private */ u128)`", async () => {
  const r = await prefill(U.key, "pub fn describe(key: &StreamKey) -> u128", "describe");
  assert.ok(r.text.includes("pub struct TenantId(/* private */ u128)"), dumpPrefill(r));
});

ltest("C4 live: SealedId renders /* private */, OpenId stays `pub struct OpenId(pub u128)`", async () => {
  const r = await prefill(U.holder, "pub fn total(h: &Holder) -> u128", "total");
  assert.ok(r.text.includes("pub struct SealedId(/* private */ u128)"), `SealedId${dumpPrefill(r)}`);
  assert.ok(r.text.includes("pub struct OpenId(pub u128)"), `OpenId${dumpPrefill(r)}`);
  assert.ok(!/OpenId\(\/\* private \*\//.test(r.text), `OpenId's public field was marked private${dumpPrefill(r)}`);
});

// Outside contract-p2, recorded as a todo so it reports without failing the
// file. rust-analyzer's documentSymbol detail for `pub async fn settle` and
// `pub unsafe fn level_unchecked` is plain `fn(&self) -> u32` (PROVEN with
// `rust-analyzer symbols` on plain.rs), so a Gauge surface sourced from the
// outline hides both qualifiers even after C1. C1 covers completion only.
ltest(
  "OUTSIDE CONTRACT: Gauge's walk-rendered (outline) surface shows async and unsafe",
  async () => {
    const { value: shape } = await walk(siteOf(U.probe, "pub fn g() -> Gauge", "Gauge"));
    const methods = methodsOf(shape, "Gauge");
    const line = (n) => methods.find((l) => new RegExp(`\\b${n}\\(`).test(l)) || "";
    assert.match(line("settle"), /\basync\b/, JSON.stringify(methods));
    assert.match(line("level_unchecked"), /\bunsafe\b/, JSON.stringify(methods));
    assert.match(line("from_raw"), /\bunsafe\b/, JSON.stringify(methods));
  },
  { todo: "not in contract-p2: the outline detail drops async/unsafe; orchestrator's call" },
);

// ===========================================================================
// Amendment 1, live: memoized per session while the def text is unchanged.
// The empty-references leg is not forceable on a real server; the fake file
// covers it.
// ===========================================================================

ltest("A1 live: a second walk on the same session makes zero references and completion asks, and still renders", async () => {
  const ex = await freshExtractor();
  const root = () => siteOf(U.key, "pub fn describe(key: &StreamKey)", "StreamKey");
  const first = await walk(root(), ex);
  assert.equal(refAsksFor(first.wire, "TenantId").length, 1, `the first walk must ask (harness check)\n    ${showWire(first.wire)}`);
  const second = await walk(root(), ex);
  const dump = `\n  second wire:\n    ${showWire(second.wire)}`;
  for (const T of ["TenantId", "StreamId", "GhostId"]) {
    assert.equal(refAsksFor(second.wire, T).length, 0, `${T}: references asked again${dump}`);
    assert.equal(completionAsksFor(second.wire, T).length, 0, `${T}: completion asked again${dump}`);
  }
  for (const [re, what] of MACRO_SIGS) {
    assert.ok(has(methodsOf(second.value, "TenantId"), re), `the memoized walk lost ${what}${dump}`);
  }
});

ltest("A1 live: changing the def file's text makes the next walk ask again", async () => {
  const ex = await freshExtractor();
  const root = () => siteOf(U.key, "pub fn describe(key: &StreamKey)", "StreamKey");
  await walk(root(), ex);
  const edited = { ...FILES, [U.ids]: FILES[U.ids] + "// edited\n" };
  ex.applyEdit(U.ids, edited[U.ids]);
  const { value: shape, wire } = await walk(root(), ex, edited);
  const dump = `\n  wire:\n    ${showWire(wire)}`;
  assert.equal(refAsksFor(wire, "TenantId").length, 1, `TenantId: references after the edit${dump}`);
  assert.equal(completionAsksFor(wire, "TenantId").length, 1, `TenantId: completion after the edit${dump}`);
  assert.ok(has(methodsOf(shape, "TenantId"), /\bget\(self\) -> u128\b/), `${JSON.stringify(methodsOf(shape, "TenantId"))}${dump}`);
});
