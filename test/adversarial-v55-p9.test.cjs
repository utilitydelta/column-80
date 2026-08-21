// ADVERSARIAL REVIEW - session-v55 phase 9 ("a stdlib type does not get a
// use-path hint"). Attacks the FIX and the BLIND ORACLE's reachability claim.
// Black-box over `resolvePrefill`, harness copied from
// test/blind-v55-p9-std-usepath.test.cjs so the two files drive the entry point
// identically.
//
// WHAT IS ATTACKED HERE
//
//  A. The oracle's reachability claim. Its header says "a sysroot type reached
//     only as a FIELD of a workspace struct (nested types never reach the import
//     map at all, workspace or not)". That is false. `shape.types` carries every
//     type the walk emitted, root AND nested, and the collection loop the fix
//     guards iterates all of them. The field hop is skipped only for names in
//     `STD_TYPE_NAMES` (28 names), and `File`, `BufReader`, `SocketAddr`,
//     `AtomicU64`, `SystemTime` are not among them. The 1.3.0 provenance
//     pre-check only judges the ROOT candidate, so the field hop reaches the
//     collection site with a WARM resolver - no cold miss required.
//
//  B. Item 4's accounting, on the surface the fix actually covers. The oracle
//     bound "still accounted for by name in the noBlock ledger" for a ROOT
//     candidate. A nested type is not a candidate and gets no ledger entry.
//
//  C. The registry carve-out. The contract says a crates.io hint "is the feature
//     working". `deriveUsePath` derives the FILE layout path with no knowledge of
//     module visibility or re-exports. Kept as a KNOWN WRONG row pinning today's
//     output; the fix is the reachability rewrite, in scraps for the human.
//
// SETTLED AT TRIAGE, and it reverses this file's own framing of A2. The review
// argued the withheld stdlib hints were "frequently CORRECT and NEEDED", so the
// phase made the prompt worse. Measured against the real rustup sysroot and real
// `rustc`, one `use` line per file: 15 of 53 compile, 38 fail, 35 of those
// E0603. `use std::fs::File;` is real; `use std::io::buffered::bufreader::
// BufReader;` and `use core::net::socket_addr::SocketAddr;` are not. The guard
// removes 38 wrong lines at the price of 15 right ones, and `usePath.ts:67`
// already ratified that trade: no import hint beats a wrong one.
//
//  D. The guard's short-circuit order, when one name is seen twice.
//
// Run: SKIP_LIVE=1 node --test test/adversarial-v55-p9.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const os = require("os");
const esbuild = require("esbuild");

const STUB = path.join(__dirname, ".adv-v55-p9-vscode-stub.cjs");
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
const decode = (s) => { try { return decodeURIComponent(s); } catch { return s; } };
class Uri {
  constructor(full, fsPath) {
    this.scheme = full.includes("://") ? full.slice(0, full.indexOf("://")) : "file";
    this.fsPath = fsPath; this.path = fsPath; this.query = ""; this.fragment = ""; this._full = full;
  }
  toString() { return this._full; }
  with() { return this; }
  toJSON() { return this._full; }
  static file(p) { return new Uri("file://" + p, p); }
  static parse(s) { return new Uri(String(s), decode(String(s).replace(/^[a-zA-Z+-]+:\\/\\//, ""))); }
  static joinPath(base, ...segs) { return Uri.file([base.fsPath, ...segs].join("/")); }
}
const keyOf = (a) => (typeof a === "string" ? a : (a && a.toString ? a.toString() : String(a)));
module.exports = {
  Position, Range, Selection, WorkspaceEdit, EventEmitter, ThemeColor, MarkdownString, Uri,
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
      const files = globalThis.__ADVV55P9_FILES__ || {};
      const key = keyOf(arg);
      return Promise.resolve({ uri: Uri.parse(key), getText: () => files[key] });
    },
  },
};
`,
);

const ENTRY = path.join(__dirname, ".adv-v55-p9.entry.ts");
const OUTFILE = path.join(__dirname, ".adv-v55-p9.bundle.cjs");
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

test("bundle guard", () => {
  if (bundleErr) assert.fail(`bundle failed to build: ${bundleErr.message}`);
  assert.ok(typeof resolvePrefill === "function");
});
const btest = (name, fn) =>
  test(name, (ctx) => {
    if (bundleErr) return ctx.skip("bundle failed to build");
    return fn(ctx);
  });

// ===========================================================================
// TREES ON DISK
// ===========================================================================

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "adv-v55-p9-"));
test.after(() => fs.rmSync(ROOT, { recursive: true, force: true }));

const write = (p, text) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
  return p;
};
const manifest = (name) => `[package]\nname = "${name}"\nversion = "0.0.0"\nedition = "2021"\n`;
function crate(dir, name) {
  write(path.join(dir, "Cargo.toml"), manifest(name));
  return dir;
}

const WS = path.join(ROOT, "work", "acme");
crate(WS, "acme-core");
const MAIN = path.join(WS, "src", "api_keys.rs");
const WS_TYPES = path.join(WS, "src", "store", "types.rs");
const WS_NESTED_TWIN = path.join(WS, "src", "store", "handles.rs");
const IMPORT_TARGET = path.join(WS, "tests", "gen_build_store.rs");

// rustup's real tail. `library/std/src/fs.rs` is where `File` really lives, so
// the derived hint here is the CORRECT `use std::fs::File;`.
const RUSTUP = path.join(ROOT, "home", "dev", ".rustup", "toolchains", "stable-x86_64-unknown-linux-gnu", "lib", "rustlib", "src", "rust", "library");
crate(path.join(RUSTUP, "std"), "std");
const SYSROOT_FS = path.join(RUSTUP, "std", "src", "fs.rs");
const SYSROOT_PATH = path.join(RUSTUP, "std", "src", "path.rs");

// A crates.io dependency whose type is declared in a PRIVATE module and
// re-exported at the crate root. Explicitly not in this phase; the fixture is
// the evidence the contract asked for.
const REG = crate(
  path.join(ROOT, "home", "dev", ".cargo", "registry", "src", "index.crates.io-6f17d22bba15001f", "serde-1.0.210"),
  "serde",
);
const REG_LIB = path.join(REG, "src", "lib.rs");
const REG_DEF = path.join(REG, "src", "ser", "mod.rs");

const uriOf = (p) => "file://" + p.replace(/ /g, "%20");

// ===========================================================================
// SOURCES
// ===========================================================================

// The workspace root collaborator, carrying a FIELD of the external type. The
// field-edge walk anchors on this literal text, so the field line has to be here.
const wsTypesSrc = (fieldType) => `pub struct ApiKeysConfig {
    pub tenant_id: u32,
    pub handle: ${fieldType},
}

impl ApiKeysConfig {
    pub fn tenant_of(&self) -> u32 {
        self.tenant_id
    }
}

pub struct KeyStore {
    pub live: u32,
}

impl KeyStore {
    pub fn live_of(&self) -> u32 {
        self.live
    }
}
`;

const extSrc = (name) => `pub struct ${name} {
    inner: OsString,
}

impl ${name} {
    pub fn as_os_string(&self) -> &OsString {
        &self.inner
    }
}
`;

const MAIN_SRC = `/// Build the key store from \`seed\`.
pub fn build_store(seed: u32, cfg: ApiKeysConfig) -> KeyStore {
    todo!()
}
`;

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

const DECL = (n) => new RegExp(`\\b(?:struct|class|record|interface|enum|type|trait)\\s+${n}\\b`);

function makeExtractor(files, defTypes, coldMiss) {
  const known = new Set(Object.keys(defTypes));
  const miss = new Set(coldMiss || []);
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
  return {
    definition: async (c) => {
      const t = typeAtCursor(c.uri, c);
      if (t !== undefined && miss.has(t)) {
        miss.delete(t);
        return undefined;
      }
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

function memberIn(files, uri, name, signature, kind = "method") {
  const lines = (files[uri] || "").split("\n");
  const line = lines.findIndex((l) => new RegExp(`\\b${name}\\b`).test(l));
  const character = line >= 0 ? Math.max(lines[line].indexOf(name), 0) : 0;
  const r = {
    start: { line, character },
    end: { line, character: character + name.length },
    startLine: line,
    startCharacter: character,
    endLine: line,
    endCharacter: character + name.length,
  };
  return { name, signature, kind, uri, line, character, position: { line, character }, declLine: line, range: r, selectionRange: r, location: { uri, range: r } };
}

const SK = { Function: 11 };
const lineOf = (src, needle) => {
  const i = src.indexOf(needle);
  assert.ok(i >= 0, `fixture bug: ${JSON.stringify(needle)} not in source`);
  return src.slice(0, i).split("\n").length - 1;
};
function rng(src, from, to) {
  const lines = src.split("\n");
  const sl = lineOf(src, from);
  const el = to === undefined ? lines.length - 1 : lineOf(src, to);
  return new V.Range(sl, 0, el, lines[el].length);
}
const dsym = (name, kind, range) => ({ name, detail: "", kind, range, selectionRange: range, children: [] });

const useLines = (text) => (text || "").split("\n").filter((l) => /^use\s+\S.*;$/.test(l.trim())).map((l) => l.trim());
const usePathsFor = (text, name) => useLines(text).filter((l) => new RegExp(`[{,:\\s]${name}\\s*[},;]`).test(l));
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
const dump = (r) =>
  `\n  NESTED DEF URI: ${r.defUri}\n  USE LINES: ${JSON.stringify(useLines(r.text))}\n  BLOCKS: ${JSON.stringify(headerTypes(r.text))}` +
  `\n  LEDGER: ${JSON.stringify(r.ledger)}\n  LOGS: ${JSON.stringify(r.logs)}\n  SURFACE:\n${r.text}`;

// ---------------------------------------------------------------------------
// ONE RUN. The signature names ONLY workspace types. The external type arrives
// as a FIELD of `ApiKeysConfig`, which is the shape the oracle declared could
// not reach the import map. `cold` defaults to FALSE: the whole point is that
// this needs no cold-miss resolver.
// ---------------------------------------------------------------------------
async function runNested({ fieldType = "File", fieldDefPath, cold = false } = {}) {
  const wsTypes = wsTypesSrc(fieldType);
  const defUri = uriOf(fieldDefPath);
  const files = {
    [uriOf(MAIN)]: MAIN_SRC,
    [uriOf(WS_TYPES)]: wsTypes,
    [defUri]: extSrc(fieldType),
  };
  write(WS_TYPES, wsTypes);
  write(fieldDefPath, extSrc(fieldType));
  const defTypes = {
    [fieldType]: {
      uri: defUri,
      hover: `pub struct ${fieldType} { inner: OsString }`,
      members: [memberIn(files, defUri, "as_os_string", "as_os_string(&self) -> &OsString")],
    },
    ApiKeysConfig: {
      uri: uriOf(WS_TYPES),
      hover: `pub struct ApiKeysConfig { pub tenant_id: u32, pub handle: ${fieldType} }`,
      members: [memberIn(files, uriOf(WS_TYPES), "tenant_of", "tenant_of(&self) -> u32")],
    },
    KeyStore: {
      uri: uriOf(WS_TYPES),
      hover: "pub struct KeyStore { pub live: u32 }",
      members: [memberIn(files, uriOf(WS_TYPES), "live_of", "live_of(&self) -> u32")],
    },
  };
  const start = MAIN_SRC.indexOf("pub fn build_store");
  const endIdx = MAIN_SRC.indexOf("todo!()\n}", start);
  const record = {
    span: { start, end: endIdx + "todo!()\n}".length },
    signature: "pub fn build_store(seed: u32, cfg: ApiKeysConfig) -> KeyStore",
    docComment: "/// Build the key store from `seed`.",
    symbolName: "build_store",
    languageId: "rust",
    kind: "function",
    bodyOnly: false,
    headerIndent: "",
    bodyIndent: "    ",
    docstringRefusal: undefined,
    symbols: [dsym("build_store", SK.Function, rng(MAIN_SRC, "pub fn build_store", "    todo!()"))],
  };
  const ext = makeExtractor(files, defTypes, cold ? [fieldType] : []);
  const logs = [];
  let ledger;
  globalThis.__ADVV55P9_FILES__ = files;
  let out;
  try {
    out = await resolvePrefill(ext, makeDoc(MAIN_SRC, uriOf(MAIN)), record, (l) => logs.push(l), {
      forConstruction: true,
      importTargetPath: IMPORT_TARGET,
      onLedger: (l) => (ledger = l),
    });
  } finally {
    delete globalThis.__ADVV55P9_FILES__;
  }
  return { out, text: out || "", logs, ledger, fieldType, defUri };
}

// ===========================================================================
// FINDING A. The oracle's reachability claim is false.
//
// A1 is the WITNESS, and it is the row that matters: the identical scenario with
// the nested definition inside the WORKSPACE derives a hint. That proves a
// NESTED type reaches `importTypes`, which the oracle says never happens - and
// with a WARM resolver, which the oracle says is impossible.
// ===========================================================================

btest("[A1] a NESTED collaborator (a field of a workspace struct) DOES reach the import map - the oracle's 'nested types never reach the import map at all' is false", async () => {
  const r = await runNested({ fieldType: "File", fieldDefPath: WS_NESTED_TWIN });
  assert.ok(
    usePathsFor(r.text, "File").length > 0,
    `\`File\` is named nowhere in the signature. It arrives only as a field of \`ApiKeysConfig\`, and it carries an import hint - so the collection site at fnGen.ts:2831 iterates nested types too, exactly as its own comment at :2647-2649 says ("Every resolved type (root and nested)"). The oracle's header claim rules this shape out and is wrong.${dump(r)}`,
  );
  assert.ok(
    usePathsFor(r.text, "File").some((l) => l.includes("crate::store::handles")),
    `and the hint is derived from the nested def's own path.${dump(r)}`,
  );
});

btest("[A2] the same nested collaborator defined in the SYSROOT, with a WARM resolver, reaches the same collection site - no cold miss needed, so this is a steady-state defect, not a cold-start one", async () => {
  // `File` is NOT in STD_TYPE_NAMES (crossFileShape.ts:203-210 lists 28 names;
  // File, BufReader, SocketAddr, AtomicU64, SystemTime are all absent), so the
  // field hop is not skipped by name. The 1.3.0 provenance pre-check judges only
  // the ROOT candidate (`ApiKeysConfig`, a workspace type), so nothing refuses
  // this before the walk.
  const r = await runNested({ fieldType: "File", fieldDefPath: SYSROOT_FS, cold: false });
  // Post-fix this is green. Pre-fix (guard removed) it emits `use std::fs::File;`.
  assert.deepStrictEqual(
    usePathsFor(r.text, "File"),
    [],
    `a sysroot-defined nested type must contribute no import hint.${dump(r)}`,
  );
  // NON-VACUITY, and the load-bearing half: the type really did reach the walk.
  // If it did not, the row above is "the type was not there anyway".
  // NON-VACUITY: `File` really was emitted by the walk and really is in the
  // prompt (its data shape is rendered inside `ApiKeysConfig`'s block, and the
  // ledger lists it under `visited`). So the collection loop at fnGen.ts:2831
  // saw it, with its sysroot defUri, on a warm resolver.
  assert.ok(
    (r.ledger?.visited || []).includes("File"),
    `NON-VACUITY: the walk must have emitted \`File\`, or this row measures nothing.${dump(r)}`,
  );
  assert.ok(
    /pub struct File \{ inner: OsString \}/.test(r.text),
    `NON-VACUITY: and its shape must be in the prompt.${dump(r)}`,
  );
});

// ===========================================================================
// FINDING B. Item 4's accounting does not extend to the surface the fix covers.
// The oracle bound "still accounted for by name in the noBlock ledger with a
// stdlib reason" for a ROOT candidate. A nested type is not a candidate.
// ===========================================================================

// RETARGETED AT TRIAGE. The observation stands and the remedy this row first
// demanded was wrong. `noBlock` is documented one-to-one on CANDIDATES
// (`fnGen.ts:2651-2655`) and feeds the `kept= injected= no-block=` arithmetic,
// so putting a nested field-hop type in it corrupts that line and every consumer
// of the ledger. The gap is closed with a channel line instead, which is the
// evidence shape this repo uses everywhere else.
btest("[B] a nested sysroot type whose hint the fix withholds is named on the channel - a refusal nobody can see is a refusal nobody can debug", async () => {
  const r = await runNested({ fieldType: "File", fieldDefPath: SYSROOT_FS, cold: false });
  const withheld = (r.logs || []).filter((l) => l.includes("import hint withheld") && l.includes("File"));
  assert.strictEqual(
    withheld.length,
    1,
    `the fix withholds File's import hint on this shape, so the channel must say so and name it. The ledger is deliberately NOT the place: noBlock is one-to-one on candidates and a field-hop type was never one.${dump(r)}`,
  );
  assert.strictEqual(
    (r.ledger?.noBlock || []).filter((e) => e.type === "File").length,
    0,
    `and it must NOT be in noBlock: that ledger feeds the kept/injected/no-block arithmetic and a nested type in it corrupts the line.${dump(r)}`,
  );
});

// ===========================================================================
// FINDING C. The registry carve-out was a deferral, not a correctness claim.
// `deriveUsePath` derives the FILE LAYOUT path. It never reads a `mod`
// declaration's visibility and never follows a `pub use`. The repo already
// carried the measurement: 110 of 249 derived `use` lines compiling on glommio,
// with 136 of the failures E0603.
//
// FLIPPED by session-v56 phase 6 (item 56). The row below pinned that wrong
// behaviour on purpose and said so: "THIS ROW GOES RED WHEN THAT LANDS, and that
// red is success". It landed - `renderImportHint` now runs the same reachability
// walk the Tighten gesture's import row uses (`rustReach.reachableSegments`) -
// so the assertion is now the RE-EXPORTED path the crate actually publishes.
// The fixture is untouched: same private `mod ser;`, same `pub use`.
// ===========================================================================

btest("[C] a crates.io type declared in a PRIVATE module gets a hint naming the crate's `pub use` re-export, not the private module", async () => {
  write(REG_LIB, `mod ser;\npub use ser::Serialize;\n`);
  const src = `pub trait Serialize {
    fn serialize(&self) -> u32;
}
`;
  write(REG_DEF, src);
  const wsTypes = wsTypesSrc("u32").replace("pub handle: u32,", "pub handle: u32,");
  write(WS_TYPES, wsTypes);
  const mainSrc = `/// Build the key store from \`seed\`.
pub fn build_store(seed: u32, cfg: Serialize) -> KeyStore {
    todo!()
}
`;
  const files = {
    [uriOf(MAIN)]: mainSrc,
    [uriOf(WS_TYPES)]: wsTypes,
    [uriOf(REG_DEF)]: src,
  };
  const defTypes = {
    Serialize: {
      uri: uriOf(REG_DEF),
      hover: "pub trait Serialize",
      members: [memberIn(files, uriOf(REG_DEF), "serialize", "serialize(&self) -> u32")],
    },
    KeyStore: {
      uri: uriOf(WS_TYPES),
      hover: "pub struct KeyStore { pub live: u32 }",
      members: [memberIn(files, uriOf(WS_TYPES), "live_of", "live_of(&self) -> u32")],
    },
  };
  const start = mainSrc.indexOf("pub fn build_store");
  const endIdx = mainSrc.indexOf("todo!()\n}", start);
  const record = {
    span: { start, end: endIdx + "todo!()\n}".length },
    signature: "pub fn build_store(seed: u32, cfg: Serialize) -> KeyStore",
    docComment: "/// Build the key store from `seed`.",
    symbolName: "build_store",
    languageId: "rust",
    kind: "function",
    bodyOnly: false,
    headerIndent: "",
    bodyIndent: "    ",
    docstringRefusal: undefined,
    symbols: [dsym("build_store", SK.Function, rng(mainSrc, "pub fn build_store", "    todo!()"))],
  };
  const ext = makeExtractor(files, defTypes, []);
  const logs = [];
  globalThis.__ADVV55P9_FILES__ = files;
  let out;
  try {
    out = await resolvePrefill(ext, makeDoc(mainSrc, uriOf(MAIN)), record, (l) => logs.push(l), {
      forConstruction: true,
      importTargetPath: IMPORT_TARGET,
    });
  } finally {
    delete globalThis.__ADVV55P9_FILES__;
  }
  const r = { out, text: out || "", logs, defUri: uriOf(REG_DEF) };
  const hints = usePathsFor(r.text, "Serialize");
  assert.ok(hints.length > 0, `fixture precondition: the registry type must carry a hint at all.${dump(r)}`);
  assert.ok(
    hints.every((l) => !/serde::ser::/.test(l)) && hints.some((l) => /use serde::Serialize;/.test(l)),
    `The crate's lib.rs declares \`mod ser;\` PRIVATE and re-exports at \`serde::Serialize\`, so \`serde::ser::Serialize\` is E0603 and the only compiling hint is the re-export. Withholding it instead (widening \`isRustSysrootDef\` to the registry) was never the answer: a crates.io API is the one thing the model cannot know. FLIPPED in session-v56 phase 6 from the old KNOWN-WRONG pin, which asserted \`serde::ser::\` and said its own red would be success.\n  HINTS: ${JSON.stringify(hints)}${dump(r)}`,
  );
});


// ===========================================================================
// FINDING D. PLACEMENT HAS A BLACK-BOX WITNESS after all, and the diff passes it.
//
// The contract's item 1 asks for the filter at the COLLECTION SITE rather than in
// the renderer, and both the contract and the oracle record that as a claim with
// no observable difference. There is one: `importTypes` is a first-writer-wins
// map (`!importTypes.has(name)`), so WHERE the refusal happens decides whether a
// later WORKSPACE sighting of the same name can still claim the slot.
//
//   collection site (the diff): the sysroot sighting never enters the map, the
//     later workspace sighting does, and the prompt carries `use crate::…`.
//   renderer: the sysroot sighting owns the slot, the workspace sighting is
//     dropped by the dedup, and the renderer then withholds the only entry there
//     was - so the prompt carries NO hint for a type defined in the project.
//
// Two candidates, one type NAME, two definitions. `Handle` is not in
// `STD_TYPE_NAMES`, so neither field hop is skipped by name.
// ===========================================================================

const WS_HANDLES = path.join(WS, "src", "store", "handles.rs");
const WS_HANDLE_DEF = path.join(WS, "src", "store", "local.rs");
const SYSROOT_HANDLE = path.join(RUSTUP, "std", "src", "handle.rs");

btest("[D] PLACEMENT WITNESS: one name, a sysroot def seen FIRST and a workspace def seen SECOND - the collection-site filter lets the project definition claim the import slot, which a renderer-side filter could not", async () => {
  const typesSrc = `pub struct ApiKeysConfig {
    pub tenant_id: u32,
    pub handle: Handle,
}

impl ApiKeysConfig {
    pub fn tenant_of(&self) -> u32 {
        self.tenant_id
    }
}
`;
  const handlesSrc = `pub struct KeyStore {
    pub live: u32,
    pub handle: Handle,
}

impl KeyStore {
    pub fn live_of(&self) -> u32 {
        self.live
    }
}
`;
  const handleDefSrc = `pub struct Handle {
    inner: u64,
}

impl Handle {
    pub fn raw(&self) -> u64 {
        self.inner
    }
}
`;
  write(WS_TYPES, typesSrc);
  write(WS_HANDLES, handlesSrc);
  write(WS_HANDLE_DEF, handleDefSrc);
  write(SYSROOT_HANDLE, handleDefSrc);

  const U = {
    main: uriOf(MAIN),
    types: uriOf(WS_TYPES),
    handles: uriOf(WS_HANDLES),
    wsHandle: uriOf(WS_HANDLE_DEF),
    sysHandle: uriOf(SYSROOT_HANDLE),
  };
  const files = {
    [U.main]: MAIN_SRC,
    [U.types]: typesSrc,
    [U.handles]: handlesSrc,
    [U.wsHandle]: handleDefSrc,
    [U.sysHandle]: handleDefSrc,
  };
  // The whole point: `Handle` resolves to the SYSROOT from `types.rs` and to the
  // WORKSPACE from `handles.rs`. Same name, two definitions, and the sysroot one
  // is reached first.
  const defOf = (uri, word) => {
    if (word === "ApiKeysConfig") return U.types;
    if (word === "KeyStore") return U.handles;
    if (word !== "Handle") return undefined;
    if (uri === U.types) return U.sysHandle;
    if (uri === U.handles) return U.wsHandle;
    return uri === U.sysHandle || uri === U.wsHandle ? uri : undefined;
  };
  const hovers = {
    [U.types]: "pub struct ApiKeysConfig { pub tenant_id: u32, pub handle: Handle }",
    [U.handles]: "pub struct KeyStore { pub live: u32, pub handle: Handle }",
    [U.wsHandle]: "pub struct Handle { inner: u64 }",
    [U.sysHandle]: "pub struct Handle { inner: u64 }",
  };
  const membersFor = (uri) => {
    if (uri === U.types) return [memberIn(files, U.types, "tenant_of", "tenant_of(&self) -> u32")];
    if (uri === U.handles) return [memberIn(files, U.handles, "live_of", "live_of(&self) -> u32")];
    return [memberIn(files, uri, "raw", "raw(&self) -> u64")];
  };
  const nameAt = (uri, c) => {
    const text = files[uri];
    if (text === undefined) return undefined;
    const w = wordAt(text, c);
    if (w && ["ApiKeysConfig", "KeyStore", "Handle"].includes(w)) return w;
    const line = (text.split("\n")[c.line] ?? "");
    for (const t of ["ApiKeysConfig", "KeyStore", "Handle"]) if (new RegExp(`\\b${t}\\b`).test(line)) return t;
    return undefined;
  };
  const ext = {
    definition: async (c) => {
      const w = nameAt(c.uri, c);
      const uri = w ? defOf(c.uri, w) : undefined;
      if (!uri) return undefined;
      const lines = (files[uri] || "").split("\n");
      const ln = lines.findIndex((l) => DECL(w).test(l));
      if (ln < 0) return undefined;
      const ch = lines[ln].indexOf(w);
      return { uri, range: { startLine: ln, startCharacter: ch, endLine: ln, endCharacter: ch + w.length } };
    },
    hoverSurface: async (c) => (hovers[c.uri] ? { signature: hovers[c.uri] } : undefined),
    membersOfType: async (c) => membersFor(c.uri),
    example: async () => undefined,
    completeMembers: async () => [],
    qualifyImport: async () => undefined,
  };
  const start = MAIN_SRC.indexOf("pub fn build_store");
  const endIdx = MAIN_SRC.indexOf("todo!()\n}", start);
  const record = {
    span: { start, end: endIdx + "todo!()\n}".length },
    signature: "pub fn build_store(seed: u32, cfg: ApiKeysConfig) -> KeyStore",
    docComment: "/// Build the key store from `seed`.",
    symbolName: "build_store",
    languageId: "rust",
    kind: "function",
    bodyOnly: false,
    headerIndent: "",
    bodyIndent: "    ",
    docstringRefusal: undefined,
    symbols: [dsym("build_store", SK.Function, rng(MAIN_SRC, "pub fn build_store", "    todo!()"))],
  };
  const logs = [];
  let ledger;
  globalThis.__ADVV55P9_FILES__ = files;
  let out;
  try {
    out = await resolvePrefill(ext, makeDoc(MAIN_SRC, U.main), record, (l) => logs.push(l), {
      forConstruction: true,
      importTargetPath: IMPORT_TARGET,
      onLedger: (l) => (ledger = l),
    });
  } finally {
    delete globalThis.__ADVV55P9_FILES__;
  }
  const r = { out, text: out || "", logs, ledger, defUri: `${U.sysHandle} (first) then ${U.wsHandle} (second)` };

  // Precondition: both sightings really happened, in that order.
  assert.ok(
    (r.ledger?.visited || []).includes("ApiKeysConfig") && (r.ledger?.visited || []).includes("KeyStore"),
    `fixture precondition: both candidates must have been walked.${dump(r)}`,
  );
  assert.ok(
    !/^use\s+(std|core|alloc)::/m.test(r.text),
    `the sysroot sighting must contribute nothing.${dump(r)}`,
  );
  // THE WITNESS. A renderer-side filter would leave this empty.
  assert.ok(
    usePathsFor(r.text, "Handle").some((l) => l.includes("crate::store::local")),
    `PLACEMENT: \`Handle\` is defined in the project at src/store/local.rs and is reached by the SECOND candidate. Because the collection site refuses the sysroot sighting outright, the map slot is still free when the project sighting arrives. A filter placed in the renderer would have let the sysroot sighting take the slot first and would then withhold it, costing a PROJECT type its import line - contract item 2, the regression that matters. This is the black-box witness the contract and the oracle both say does not exist.${dump(r)}`,
  );
});
