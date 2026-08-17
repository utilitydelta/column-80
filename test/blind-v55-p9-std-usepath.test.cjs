// BLIND ORACLE - session-v55 phase 9, "a stdlib type does not get a use-path
// hint" (`session-v55/contract-phase9.md`, queue Q23). Black-box over
// `resolvePrefill` only.
//
// THE CONTRACT, restated from contract-phase9.md "What must hold":
//
//   1. A stdlib-defined collaborator contributes NO use-path hint.
//   2. A workspace type STILL gets its hint. The two failure directions are not
//      symmetric; this is the regression that matters.
//   3. The predicate is `isRustSysrootDef` (`crossFileShape.ts`), total over any
//      string a resolver can return, including a URI whose percent-decode throws.
//   4. Filtering the hint does not REMOVE the type: it still reaches the prompt
//      assembly and is still accounted for by name. Dropping stdlib types out of
//      the walk is a different, larger, wrong change.
//   5. A layout the predicate does not recognise degrades to TODAY'S BEHAVIOUR,
//      never to silence.
//   6. Non-Rust languages are unaffected.
//   NOT IN THIS PHASE: cargo registry defs. `use serde::Serialize;` is the
//      feature working, so a registry-defined type must KEEP its hint.
//
// -------------------------------------------------------------------------
// HOW THE DEFECT WAS REPRODUCED, AND WHAT DID NOT REPRODUCE IT
//
// The filed defect is a `use std::…` line in the test-gen prompt. Reaching it
// from the public seam took work, and the shape matters, so it is recorded here
// rather than left implicit in a fixture.
//
// These shapes do NOT produce a `use std::…` line at HEAD, all measured through
// `resolvePrefill` before this file was written: a sysroot type named in the
// signature (as a parameter, behind `&`, inside `Vec<…>`, path-qualified, or as
// the return type); a sysroot type reached only as a FIELD of a workspace struct
// WHOSE NAME IS IN `STD_TYPE_NAMES` (the field hop's stop set, 28 prelude-ish
// names); a sysroot type behind a workspace `type` alias; a sysroot type
// arriving through
// `extraCandidates` + `extraCursors`; and a sysroot receiver. In every one of
// them the shipped provenance PRE-CHECK (the `[fngen] … provenance-checked N`
// leg, in since 1.3.0) resolves the definition cheaply, recognises the sysroot
// and refuses the candidate BEFORE it is resolved, so it never reaches the
// import map.
//
// CORRECTED AFTER THE ADVERSARIAL REVIEW. The field-hop claim above was drawn
// too wide, and the correction matters because the wider version is the argument
// a reader would use to delete the guard. The field hop skips only
// `STD_TYPE_NAMES`; a sysroot type OUTSIDE that set - `File`, `BufReader`,
// `SocketAddr`, `AtomicU64`, `SystemTime` - reached as a field of a workspace
// struct walks into the import map with a WARM resolver, because the 1.3.0
// pre-check judges only the ROOT candidate. See `[A1]` and `[A2]` in
// `test/adversarial-v55-p9.test.cjs`. The cold-miss route below is one way in,
// not the only one.
//
// The shape that ALSO reproduces it: the same signature-named sysroot type, with
// a resolver whose FIRST `definition()` for that name misses. The pre-check then
// has no URI to judge, the candidate survives it, the full resolution answers
// with the sysroot URI, the type lands in the import map, and only the LATE
// refusal catches it - which withholds the block and not the import line. The
// prompt then carries `use std::path::PathBuf;` for a type it renders nothing
// about. A first-miss-then-answer resolver is not a contrivance: rust-analyzer
// answers "no definition" while it is still indexing, and the product's own
// definition calls run against a budget, so a first call that comes back empty
// and a second that answers is ordinary cold-server behaviour.
//
// EVERY ARM HERE USES THAT COLD-MISS RESOLVER, including the workspace arms, so
// the arms differ in ONE STRING - the definition URI - exactly as the falsifier
// asks ("both halves in one fixture").
//
// -------------------------------------------------------------------------
// FIXTURES: WHAT IS REAL AND WHAT IS SYNTHETIC
//
// REAL, in the sense of being a layout a toolchain actually writes on disk (and
// pinned against the installed toolchain by the fidelity row below when this box
// has one):
//   * `<sysroot>/lib/rustlib/src/rust/library/{std,core}/Cargo.toml` carrying
//     `[package] name = "std"` / `"core"`, with sources under `…/src/`. Checked
//     against a real rustup install: the manifest is there and that is what
//     `deriveUsePath` reads to build the `use std::…` line.
//   * the distro-packaged tail `/usr/lib/rustlib/src/rust/library/…`.
//   * the cargo registry tail
//     `<CARGO_HOME>/.cargo/registry/src/index.crates.io-6f17d22bba15001f/<crate>-<ver>/`.
//   * a workspace crate: `Cargo.toml` + `src/…`, with the test-gen import target
//     under `tests/`.
// The directory trees are BUILT ON DISK in a temp dir, because the import
// derivation reads the filesystem (it looks for the owning `Cargo.toml`). They
// are replicas of those layouts, not copies of the installed toolchain.
//
// SYNTHETIC, and labelled so at each row:
//   * `<root>/opt/rust-src/library/std/…` - the "layout the predicate does not
//     recognise" of item 5. No real toolchain on this box writes it; it stands
//     for one that does not put the sources under `/lib/rustlib/src/rust/`.
//   * the `50%_done` and `My Toolchains` prefixes - real filenames (both are
//     legal), used to drive the percent-decode paths of item 3.
//   * the two workspace lookalikes and the `lib/rustlib` short-segment crate -
//     project trees named to resemble the toolchain, which is the false-positive
//     direction the predicate's own doc says must not be taken.
//   * the type surfaces (`PathBuf { inner: OsString }`) are stand-ins, not the
//     real std sources. Nothing here asserts on std's actual API.
//
// -------------------------------------------------------------------------
// STATE WHEN WRITTEN (measured, not assumed): 22 rows, 5 RED and 17 GREEN.
// The RED rows are the ones binding item 1 - the `use std::…` line is in the
// prompt today, and each failure prints it. The GREEN rows are the regression
// rows (item 2, item 5, item 6, the registry carve-out, item 4's accounting):
// they state what the fix must NOT break, and each says at its own site why a
// green there is worth having.
//
// BLIND: nothing here reads the body of `src/vscode/fnGen.ts`. esbuild resolves
// it at bundle time. Every assertion is on the string `resolvePrefill` returns,
// on the `PrefillLedger` it hands `onLedger`, and on the lines its `log`
// callback receives.
//
// Run: SKIP_LIVE=1 node --test test/blind-v55-p9-std-usepath.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const os = require("os");
const esbuild = require("esbuild");

// ===========================================================================
// Harness. Copied from test/blind-v34-stdlib-provenance.test.cjs (the file that
// black-boxes the sibling provenance rule) so both drive the entry point the
// same way, with ONE deliberate change: `Uri` is a class whose `fsPath` strips
// the scheme and percent-decodes, as `test/.vscode-stub.cjs` and real
// `vscode.Uri` both do. The v34 stub's `fsPath` was the whole URI string, which
// no filesystem lookup can use - and this phase's payload is derived by reading
// the filesystem, so that shortcut would make every import row vacuous.
// ===========================================================================

const STUB = path.join(__dirname, ".blind-v55-p9-vscode-stub.cjs");
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
// TOTAL by construction: a URI with a lone '%' is a legal file name and
// decodeURIComponent throws on it. Real vscode hands back a usable fsPath for
// such a file; a stub that threw would make the malformed-URI rows measure the
// harness instead of the product.
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
      const files = globalThis.__V55P9_FILES__ || {};
      const key = keyOf(arg);
      return Promise.resolve({ uri: Uri.parse(key), getText: () => files[key] });
    },
  },
};
`,
);

const ENTRY = path.join(__dirname, ".blind-v55-p9.entry.ts");
const OUTFILE = path.join(__dirname, ".blind-v55-p9.bundle.cjs");
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

test("bundle guard: resolvePrefill builds headless against the vscode stub", () => {
  if (bundleErr) assert.fail(`bundle failed to build: ${bundleErr.message}`);
  assert.ok(typeof resolvePrefill === "function", "resolvePrefill must be an exported function");
});
const btest = (name, fn) =>
  test(name, (ctx) => {
    if (bundleErr) return ctx.skip("bundle failed to build; see the bundle guard");
    return fn(ctx);
  });

// ===========================================================================
// THE TREES ON DISK. The import derivation walks the real filesystem for the
// owning Cargo.toml, so these have to exist as directories, not as strings.
// ===========================================================================

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "blind-v55-p9-"));
test.after(() => fs.rmSync(ROOT, { recursive: true, force: true }));

const write = (p, text) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
  return p;
};
const manifest = (name) => `[package]\nname = "${name}"\nversion = "0.0.0"\nedition = "2021"\n`;

// A crate whose sources live under `<dir>/src`, with `<dir>/Cargo.toml`.
function crate(dir, name) {
  write(path.join(dir, "Cargo.toml"), manifest(name));
  return dir;
}

// --- the workspace under test ----------------------------------------------
const WS = path.join(ROOT, "work", "acme");
crate(WS, "acme-core");
const MAIN = path.join(WS, "src", "api_keys.rs");
const WS_TYPES = path.join(WS, "src", "store", "types.rs");
const WS_TWIN = path.join(WS, "src", "store", "vendored.rs");
// The two workspace LOOKALIKES: project files whose directories read like the
// toolchain's. Both are under the crate's own `src/`, so both derive a hint.
const WS_LOOKALIKE_LIBRARY = path.join(WS, "src", "library", "std", "src", "path.rs");
const WS_LOOKALIKE_RUSTLIB = path.join(WS, "src", "rustlib", "src", "rust", "library", "core", "src", "path.rs");
// The test-gen import target: a file under the same crate, so a workspace type
// derives `crate::…` exactly as the gesture does for a real blind test.
const IMPORT_TARGET = path.join(WS, "tests", "gen_build_store.rs");

// --- the toolchains --------------------------------------------------------
// REAL SHAPE: rustup's tail is `<toolchain>/lib/rustlib/src/rust/library/<crate>`,
// each crate carrying its own Cargo.toml with `name = "std"` / `"core"`.
const RUSTUP = path.join(ROOT, "home", "dev", ".rustup", "toolchains", "stable-x86_64-unknown-linux-gnu", "lib", "rustlib", "src", "rust", "library");
const SYSROOT_STD = path.join(crate(path.join(RUSTUP, "std"), "std"), "src", "path.rs");
const SYSROOT_CORE = path.join(crate(path.join(RUSTUP, "core"), "core"), "src", "time.rs");
// REAL SHAPE: a distro-packaged toolchain writes the same tail under /usr.
const DISTRO_STD = path.join(crate(path.join(ROOT, "usr", "lib", "rustlib", "src", "rust", "library", "std"), "std"), "src", "path.rs");
// SYNTHETIC: a source layout with no `/lib/rustlib/src/rust/` segment at all.
const ODD_STD = path.join(crate(path.join(ROOT, "opt", "rust-src", "library", "std"), "std"), "src", "path.rs");
// SYNTHETIC PREFIXES, REAL TAILS. `50%_done` makes the URI's percent-decode
// throw; `My Toolchains` makes a well-formed URI that only decodes correctly.
const PCT_STD = path.join(crate(path.join(ROOT, "50%_done", ".rustup", "toolchains", "stable", "lib", "rustlib", "src", "rust", "library", "std"), "std"), "src", "path.rs");
const SPACE_STD = path.join(crate(path.join(ROOT, "My Toolchains", "stable", "lib", "rustlib", "src", "rust", "library", "std"), "std"), "src", "path.rs");
// SYNTHETIC: the short-segment trap the predicate's doc names. A PROJECT crate
// at `<root>/lib/rustlib` matches `/lib/rustlib/src/` and must not match
// `/lib/rustlib/src/rust/`.
const SHIM_SRC = path.join(crate(path.join(ROOT, "lib", "rustlib"), "rustlib-shim"), "src", "keys.rs");
// REAL SHAPE: what cargo writes under CARGO_HOME. Explicitly NOT in this phase.
const REGISTRY_SRC = path.join(crate(path.join(ROOT, "home", "dev", ".cargo", "registry", "src", "index.crates.io-6f17d22bba15001f", "serde-1.0.210"), "serde"), "src", "lib.rs");

// ===========================================================================
// FIXTURE FIDELITY. A sysroot path that a real toolchain does not write would
// make every row here pass for the wrong reason. When this box has rust-src
// installed, the replica above is checked against it; when it does not, the row
// says so rather than passing quietly.
// ===========================================================================

test("fixture fidelity: the sysroot replica matches the installed toolchain's layout", (t) => {
  let real;
  try {
    real = require("child_process").execFileSync("rustc", ["--print", "sysroot"], { encoding: "utf8" }).trim();
  } catch {
    return t.skip("no rustc on this box; the replica is built from the layout the predicate's doc names");
  }
  const lib = path.join(real, "lib", "rustlib", "src", "rust", "library");
  if (!fs.existsSync(lib)) {
    return t.skip(`no rust-src component at ${lib}; nothing to compare the replica against`);
  }
  for (const c of ["std", "core"]) {
    const toml = path.join(lib, c, "Cargo.toml");
    assert.ok(fs.existsSync(toml), `the installed toolchain must carry ${toml} - the manifest the use path is derived from`);
    assert.match(
      fs.readFileSync(toml, "utf8"),
      new RegExp(`name\\s*=\\s*"${c}"`),
      `${toml} must name the crate \`${c}\`, which is the string that becomes the \`use ${c}::…\` prefix`,
    );
  }
  // And the replica's tail is the installed one's tail.
  const realTail = path.join(real, "lib", "rustlib", "src", "rust", "library", "std", "src", "path.rs").slice(real.length);
  assert.ok(
    SYSROOT_STD.endsWith(realTail),
    `the replica ${SYSROOT_STD} must end with the installed toolchain's tail ${realTail}`,
  );
});

// ===========================================================================
// SOURCES. One workspace file with the target, one with the project types, and
// one stand-in surface reused by every external def so that the arms differ in
// the DEFINITION URI and in nothing else.
// ===========================================================================

const EXT_SRC = (name) => `pub struct ${name} {
    inner: OsString,
}

impl ${name} {
    pub fn as_os_string(&self) -> &OsString {
        &self.inner
    }

    pub fn push_seg(&mut self, s: &str) {
        todo!()
    }
}
`;

const WS_TYPES_SRC = `pub struct ApiKeysConfig {
    pub tenant_id: u32,
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

const mainSrc = (extName) => `/// Build the key store from \`seed\`.
pub fn build_store(seed: u32, root: ${extName}, cfg: ApiKeysConfig) -> KeyStore {
    todo!()
}
`;

write(WS_TYPES, WS_TYPES_SRC);
for (const [p, n] of [
  [WS_TWIN, "PathBuf"],
  [WS_LOOKALIKE_LIBRARY, "PathBuf"],
  [WS_LOOKALIKE_RUSTLIB, "PathBuf"],
  [SYSROOT_STD, "PathBuf"],
  [SYSROOT_CORE, "Duration"],
  [DISTRO_STD, "PathBuf"],
  [ODD_STD, "PathBuf"],
  [PCT_STD, "PathBuf"],
  [SPACE_STD, "PathBuf"],
  [SHIM_SRC, "KeyShim"],
  [REGISTRY_SRC, "Serialize"],
]) {
  write(p, EXT_SRC(n));
}

// A path as the resolver reports it. `file://` + the path, percent-encoding the
// characters vscode encodes; a lone `%` in a file name is NOT encodable and
// travels raw, which is the decode-throws case item 3 names.
const uriOf = (p) => "file://" + p.replace(/ /g, "%20");

// ===========================================================================
// The fake server. Same shape as blind-v34's, with the cold-miss leg described
// in the header: the FIRST `definition()` for a named type answers `undefined`,
// every later one answers. Applied to the external type in every arm, so the
// arms stay comparable.
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
      // The cold server: the first ask for this name comes back empty.
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

// ---------------------------------------------------------------------------
// One run. `extName` is the external collaborator's name, `extPath` the file its
// definition lives in. Everything else is fixed, so a row is a statement about
// that one path.
// ---------------------------------------------------------------------------
async function runPrefill({ extName = "PathBuf", extPath, extUri, cold = true, opts } = {}) {
  const src = mainSrc(extName);
  const defUri = extUri ?? uriOf(extPath);
  const files = {
    [uriOf(MAIN)]: src,
    [uriOf(WS_TYPES)]: WS_TYPES_SRC,
    [defUri]: EXT_SRC(extName),
  };
  const defTypes = {
    [extName]: {
      uri: defUri,
      hover: `pub struct ${extName} { inner: OsString }`,
      members: [
        memberIn(files, defUri, "as_os_string", "as_os_string(&self) -> &OsString"),
        memberIn(files, defUri, "push_seg", "push_seg(&mut self, s: &str)"),
      ],
    },
    ApiKeysConfig: {
      uri: uriOf(WS_TYPES),
      hover: "pub struct ApiKeysConfig { pub tenant_id: u32 }",
      members: [memberIn(files, uriOf(WS_TYPES), "tenant_of", "tenant_of(&self) -> u32")],
    },
    KeyStore: {
      uri: uriOf(WS_TYPES),
      hover: "pub struct KeyStore { pub live: u32 }",
      members: [memberIn(files, uriOf(WS_TYPES), "live_of", "live_of(&self) -> u32")],
    },
  };
  const start = src.indexOf("pub fn build_store");
  const endIdx = src.indexOf("todo!()\n}", start);
  const record = {
    span: { start, end: endIdx + "todo!()\n}".length },
    signature: `pub fn build_store(seed: u32, root: ${extName}, cfg: ApiKeysConfig) -> KeyStore`,
    docComment: "/// Build the key store from `seed`.",
    symbolName: "build_store",
    languageId: "rust",
    kind: "function",
    bodyOnly: false,
    headerIndent: "",
    bodyIndent: "    ",
    docstringRefusal: undefined,
    symbols: [dsym("build_store", SK.Function, rng(src, "pub fn build_store", "    todo!()"))],
  };
  const ext = makeExtractor(files, defTypes, cold ? [extName] : []);
  const logs = [];
  let ledger;
  globalThis.__V55P9_FILES__ = files;
  let out;
  try {
    out = await resolvePrefill(ext, makeDoc(src, uriOf(MAIN)), record, (l) => logs.push(l), {
      forConstruction: true,
      importTargetPath: IMPORT_TARGET,
      onLedger: (l) => (ledger = l),
      ...opts,
    });
  } finally {
    delete globalThis.__V55P9_FILES__;
  }
  return { out, text: out || "", logs, ledger, extName, defUri };
}

// Every `use …;` line the surface carries, in order.
const useLines = (text) => (text || "").split("\n").filter((l) => /^use\s+\S.*;$/.test(l.trim())).map((l) => l.trim());
// The use lines that import a given type name.
const usePathsFor = (text, name) => useLines(text).filter((l) => new RegExp(`[{,:\\s]${name}\\s*[},;]`).test(l));
// The type names whose own block rendered (header + fence within two lines).
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
  `\n  DEF URI: ${r.defUri}\n  USE LINES: ${JSON.stringify(useLines(r.text))}\n  BLOCKS: ${JSON.stringify(headerTypes(r.text))}` +
  `\n  LOGS: ${JSON.stringify(r.logs)}\n  SURFACE:\n${r.text}`;

// The non-vacuity guard every stdlib row is paired with: the identical scenario
// with the definition moved into the workspace MUST produce a hint. A stdlib row
// that is green next to a red workspace arm is a harness report, not a pass.
async function workspaceArm() {
  const ws = await runPrefill({ extPath: WS_TWIN });
  assert.ok(
    usePathsFor(ws.text, "PathBuf").length > 0,
    `NON-VACUITY: the workspace twin at ${WS_TWIN} must contribute a use-path hint, or every stdlib row below passes for a reason that has nothing to do with provenance.${dump(ws)}`,
  );
  return ws;
}

// ===========================================================================
// ROWS 1-3. [contract item 1] A stdlib-defined collaborator contributes NO
// use-path hint, for each real sysroot layout. Each row asserts the negative on
// the toolchain arm AND the positive on the workspace arm, so a pass is always a
// measured difference and never "the type was not there anyway".
// RED at the time of writing: the line is `use std::path::PathBuf;`.
// ===========================================================================

const SYSROOT_ARMS = [
  {
    what: "rustup, std",
    extName: "PathBuf",
    defPath: SYSROOT_STD,
    crate: "std",
    why: "the filed shape: rustup's own tail, `library/std/Cargo.toml` naming the crate `std`",
  },
  {
    what: "rustup, core",
    extName: "Duration",
    defPath: SYSROOT_CORE,
    crate: "core",
    why: "the same tail one crate over - a filter wired to the word `std` passes the row above and fails here",
  },
  {
    what: "distro-packaged",
    extName: "PathBuf",
    defPath: DISTRO_STD,
    crate: "std",
    why: "the same tail under /usr, which is what a distro rust-src package writes",
  },
];

for (const arm of SYSROOT_ARMS) {
  btest(`[item 1] (${arm.what}) a collaborator defined at ${arm.defPath.slice(ROOT.length)} contributes NO use-path hint, while the identical type defined under the workspace still does (${arm.why})`, async () => {
    const ws = await workspaceArm();
    const r = await runPrefill({ extName: arm.extName, extPath: arm.defPath });
    assert.deepStrictEqual(
      usePathsFor(r.text, arm.extName),
      [],
      `item 1: \`${arm.extName}\` is defined in the ${arm.crate} sources of the toolchain. The prompt must carry no import line for it: the type is in the prelude or one line away, and the path this derives is read off a directory layout that was never meant to be read that way.${dump(r)}`,
    );
    assert.ok(
      !/^use\s+(std|core|alloc|proc_macro)::/m.test(r.text),
      `item 1: no \`use ${arm.crate}::…\` line may appear anywhere in the surface.${dump(r)}`,
    );
    // The measured difference. The workspace arm ran the same scenario with one
    // string changed.
    assert.ok(
      usePathsFor(ws.text, "PathBuf").length > 0,
      `the workspace arm is the non-vacuity guard and it must be green.${dump(ws)}`,
    );
  });
}

// The other half of item 1, and it is GREEN today: with a resolver that answers
// the FIRST time, the shipped pre-check refuses the candidate before it is
// resolved and no hint is derived either. The row is a pin, not a claim about
// the fix - whatever the collection site starts filtering, this path must not
// start emitting.
btest("[item 1] with a warm resolver the same sysroot collaborator also contributes no hint - the two ways in must agree", async () => {
  const ws = await workspaceArm();
  const r = await runPrefill({ extPath: SYSROOT_STD, cold: false });
  assert.deepStrictEqual(
    usePathsFor(r.text, "PathBuf"),
    [],
    `item 1: the same type, the same path, a resolver that answers first time. No import line either way.${dump(r)}`,
  );
  assert.ok(usePathsFor(ws.text, "PathBuf").length > 0, `and the workspace arm still hints.${dump(ws)}`);
});

// ===========================================================================
// ROWS 4-5. [contract item 1 + item 3] The predicate is total over the URI forms
// a resolver can report. `isRustSysrootDef` is documented to take the URI AS
// REPORTED - a percent-encoded one and one whose decode THROWS both have to be
// judged, and the collection loop it is called from has no `try` of its own.
// RED at the time of writing.
// ===========================================================================

btest("[item 1, item 3] a sysroot under a directory whose name makes the URI's percent-decode THROW is still filtered, and the prefill still returns its other blocks", async () => {
  await workspaceArm();
  // `50%_done` is a legal directory name and `%_d` is not a valid escape, so
  // decodeURIComponent throws on this URI. The predicate's own comment says the
  // raw form is then the best reading available - and the raw form still carries
  // the segment.
  const r = await runPrefill({ extPath: PCT_STD });
  assert.deepStrictEqual(
    usePathsFor(r.text, "PathBuf"),
    [],
    `item 3: a URI that cannot be percent-decoded is still a sysroot path in its raw form, and must still be refused a hint.${dump(r)}`,
  );
  // Totality has a second half: nothing may throw. The prefill still produced a
  // surface with the project types in it.
  assert.ok(r.out !== undefined, `item 3: the prefill must still return a surface - a throw here would take out the whole gesture.${dump(r)}`);
  for (const t of ["ApiKeysConfig", "KeyStore"]) {
    assert.ok(headerTypes(r.text).includes(t), `the project type \`${t}\` must still render.${dump(r)}`);
  }
});

btest("[item 1, item 3] a sysroot under a directory with a SPACE, reported as a percent-ENCODED uri, is still filtered", async () => {
  await workspaceArm();
  // `My Toolchains` travels as `My%20Toolchains`. This is the ordinary case on a
  // machine whose home directory has a space in it, and it is the direction a
  // raw-string-only test would miss.
  const r = await runPrefill({ extPath: SPACE_STD });
  assert.ok(r.defUri.includes("%20"), `fixture precondition: the def uri must be percent-encoded, got ${r.defUri}`);
  assert.deepStrictEqual(
    usePathsFor(r.text, "PathBuf"),
    [],
    `item 3: a percent-encoded sysroot URI is a sysroot URI.${dump(r)}`,
  );
});

// ===========================================================================
// ROW 6. [contract item 4] Filtering the hint must not REMOVE the type.
//
// THIS IS THE ROW THAT TELLS THE TWO FIXES APART, and it is the reason the file
// exists in this shape. Withholding the import line is a one-line refusal at the
// collection site; dropping stdlib types out of the walk is a different change
// that also frees the candidate's slot, removes it from the ledger, and takes
// its drop line off the channel. Both fixes make rows 1-5 green. Only the wrong
// one makes this row red.
//
// GREEN today, and it says so: the accounting below is what the shipped code
// already does. It is here as a one-way door - the fix must not move it.
//
// WHAT THIS ROW CANNOT SAY, and the contract should be corrected on it: item 4's
// literal wording is that the collaborator "still reaches the prompt with its
// shape and its members". It does not, and it did not before this phase either -
// session-v34 item 1 already refuses a stdlib ROOT its block, and that refusal
// is what the `noBlock` entry below IS. Measured, both before this row was
// written and by the row itself. So the operative half of item 4 is what is
// bound here: the type still reaches the prompt ASSEMBLY, spends its candidacy
// there, and is still accounted for BY NAME with its reason.
// ===========================================================================

const STDLIB_REASON = /\bstd\b|stdlib|std lib|standard library|rustup|toolchain/i;

btest("[item 4] the filtered collaborator is NOT dropped out of the walk: it still reaches the prompt assembly and is still accounted for by name, with a stdlib reason, on the channel AND in the ledger", async () => {
  const r = await runPrefill({ extPath: SYSROOT_STD });

  const named = (r.ledger?.noBlock || []).filter((e) => e.type === "PathBuf");
  assert.strictEqual(
    named.length,
    1,
    `item 4: \`PathBuf\` must still appear in the ledger's no-block list - that entry is the record that the candidate reached the prompt assembly and was refused THERE. A fix that skips stdlib candidates earlier in the walk deletes this entry, and with it the only evidence a reader has that the type was considered at all.\n  LEDGER: ${JSON.stringify(r.ledger)}${dump(r)}`,
  );
  assert.match(
    named[0].reason,
    STDLIB_REASON,
    `item 4: and the entry keeps its reason. The wording is not pinned; a stdlib-ish word is.\n  LEDGER: ${JSON.stringify(r.ledger)}`,
  );
  const channel = r.logs.filter((l) => /\bPathBuf\b/.test(l) && STDLIB_REASON.test(l));
  assert.ok(
    channel.length > 0,
    `item 4: the same must hold on the [fngen] channel (session-v34 guard rail 1). Lines naming the type: ${JSON.stringify(r.logs.filter((l) => /\bPathBuf\b/.test(l)))}${dump(r)}`,
  );
  assert.ok(channel.some((l) => l.includes("[fngen]")), `the reason belongs on the [fngen] channel: ${JSON.stringify(channel)}`);

  // And the rest of the prompt is untouched: the project types still render, and
  // no fourth type is pulled in to fill a slot the stdlib type did not vacate.
  assert.deepStrictEqual(
    headerTypes(r.text).filter((t) => t !== "PathBuf"),
    ["ApiKeysConfig", "KeyStore"],
    `item 4: withholding an import line must not change WHICH types render.${dump(r)}`,
  );
  assert.deepStrictEqual(
    [...(r.ledger?.rendered || [])],
    ["ApiKeysConfig", "KeyStore"],
    `item 4: nor which types the ledger reports as rendered.\n  LEDGER: ${JSON.stringify(r.ledger)}`,
  );
});

btest("[item 4] the project collaborators' own hints and blocks survive the stdlib refusal in the same prompt", async () => {
  const r = await runPrefill({ extPath: SYSROOT_STD });
  for (const t of ["ApiKeysConfig", "KeyStore"]) {
    assert.ok(
      usePathsFor(r.text, t).length > 0,
      `item 4/item 2: \`${t}\` is a workspace type named by the same signature; refusing the stdlib type's hint must not cost it its own.${dump(r)}`,
    );
    assert.ok(r.text.includes(`${t}`), `\`${t}\` must still be in the surface.${dump(r)}`);
  }
  assert.ok(r.text.includes("tenant_of"), `and its member list is still there.${dump(r)}`);
});

// ===========================================================================
// ROWS 7-9. [contract item 2] The regression that matters. A workspace type
// still gets its hint - including when its directory reads like the toolchain's.
// "Under the workspace" has to mean the SEGMENT the predicate tests, not a word
// in the path: a project is free to have a module called `library` or `rustlib`.
// GREEN today. These are the rows a hastily-written second predicate breaks.
// ===========================================================================

const WORKSPACE_ARMS = [
  {
    what: "an ordinary workspace module",
    defPath: WS_TWIN,
    expect: "crate::store::vendored",
    why: "the plain positive - the same type, the same hover, the same members, defined in the project",
  },
  {
    what: "a workspace module named `library/std`",
    defPath: WS_LOOKALIKE_LIBRARY,
    expect: "crate::library::std::src::path",
    why: "a substring test on `/library/std/` drops a real project type here and nowhere else",
  },
  {
    what: "a workspace module named `rustlib/src/rust/library/core`",
    defPath: WS_LOOKALIKE_RUSTLIB,
    expect: "crate::rustlib::src::rust::library::core::src::path",
    why: "it carries `/rustlib/src/rust/` and still is not `/lib/rustlib/src/rust/`",
  },
];

for (const arm of WORKSPACE_ARMS) {
  btest(`[item 2] a workspace type at ${arm.defPath.slice(WS.length + 1)} STILL gets its use-path hint (${arm.why})`, async () => {
    const r = await runPrefill({ extPath: arm.defPath });
    const hints = usePathsFor(r.text, "PathBuf");
    assert.ok(
      hints.length > 0,
      `item 2: refusing a PROJECT type starves the model of the one thing it cannot know. This type is defined inside the workspace crate and must keep its import line.${dump(r)}`,
    );
    assert.ok(
      hints.some((l) => l.includes(arm.expect)),
      `item 2: and the hint is the module path the definition actually sits at (expected to contain \`${arm.expect}\`).${dump(r)}`,
    );
  });
}

btest("[item 2, item 3] the SHORT segment is not the test: a project crate at `<root>/lib/rustlib` matches `/lib/rustlib/src/` and still keeps its hint", async () => {
  // The predicate's doc names this exact trap: the shorter `/lib/rustlib/src/`
  // matches a workspace whose own crate is named `lib`, and the two failure
  // directions are not symmetric. A fix that writes its own, shorter test passes
  // every row above and fails here.
  const r = await runPrefill({ extName: "KeyShim", extPath: SHIM_SRC });
  assert.ok(
    r.defUri.includes("/lib/rustlib/src/"),
    `fixture precondition: the def path must carry the SHORT segment, got ${r.defUri}`,
  );
  assert.ok(
    !r.defUri.includes("/lib/rustlib/src/rust/"),
    `fixture precondition: and must NOT carry the long one, got ${r.defUri}`,
  );
  const hints = usePathsFor(r.text, "KeyShim");
  assert.ok(
    hints.length > 0,
    `item 3: \`rustlib_shim\` is a project crate that happens to live at <root>/lib/rustlib. It must keep its import line.${dump(r)}`,
  );
  assert.ok(
    hints.some((l) => l.includes("rustlib_shim")),
    `and the hint names the crate its Cargo.toml declares.${dump(r)}`,
  );
});

// ===========================================================================
// ROW 10. Explicitly NOT in this phase: the cargo registry. `isCargoRegistryDef`
// is the sibling predicate and adding it here is the tempting tidy-up the
// contract forbids: a crates.io dependency genuinely needs
// `use serde::Serialize;`, so its hint is the feature working.
// GREEN today, and it is a fence rather than a claim about the fix.
// ===========================================================================

btest("[NOT in this phase] a type defined in the cargo registry KEEPS its use-path hint - the sibling predicate must not be added here", async () => {
  const r = await runPrefill({ extName: "Serialize", extPath: REGISTRY_SRC });
  assert.ok(
    r.defUri.includes("/.cargo/registry/src/"),
    `fixture precondition: the def must be under the registry cargo writes, got ${r.defUri}`,
  );
  const hints = usePathsFor(r.text, "Serialize");
  assert.ok(
    hints.length > 0,
    `the contract is explicit: a crates.io dependency needs its import, and the hint is the feature working. If registry paths derive badly too, that is a separate entry with its own evidence.${dump(r)}`,
  );
  assert.ok(hints.some((l) => l.includes("serde")), `and the hint is derived from the crate's own manifest.${dump(r)}`);
});

// ===========================================================================
// ROW 11. [contract item 5] A layout the predicate does not recognise degrades
// to TODAY'S BEHAVIOUR, never to silence. This phase does not narrow the
// predicate, so a source tree with no `/lib/rustlib/src/rust/` segment keeps
// both its block and its hint.
// GREEN today. It is the row that catches an over-broad fix - one that reads the
// crate name out of the manifest, or matches `/library/std/`, would make this
// red while making rows 1-5 green.
// ===========================================================================

btest("[item 5] an UNRECOGNISED source layout degrades to today's behaviour: the type keeps its block AND its hint, rather than falling silent", async () => {
  // SYNTHETIC layout: `<root>/opt/rust-src/library/std/src/path.rs`. The
  // manifest there says `name = "std"` exactly as the toolchain's does, so a fix
  // that reads the crate NAME rather than the PATH cannot tell them apart.
  const r = await runPrefill({ extPath: ODD_STD });
  assert.ok(
    !r.defUri.includes("/lib/rustlib/src/rust/"),
    `fixture precondition: this layout must not carry the segment the predicate tests, got ${r.defUri}`,
  );
  assert.ok(
    headerTypes(r.text).includes("PathBuf"),
    `item 5: the predicate does not recognise this layout, so nothing about this type changes - its block renders as it does today.${dump(r)}`,
  );
  assert.ok(
    usePathsFor(r.text, "PathBuf").length > 0,
    `item 5: and its hint is still derived. The degrade is to today's behaviour, never to silence, and this phase does not narrow the predicate.${dump(r)}`,
  );
});

// ===========================================================================
// ROW 12. [contract item 6] Non-Rust languages are unaffected.
//
// The import derivation is not language-gated - it is `deriveUsePath` for every
// language, and it yields nothing outside a cargo crate. So to make item 6 say
// anything at all, the non-Rust fixture is placed INSIDE the cargo crate, which
// is the only arrangement in which those languages HAVE a hint to lose. It is an
// odd tree and it is deliberate: with the collaborator outside a crate both arms
// carry no hint, and a row comparing two nothings pins nothing.
// GREEN today.
// ===========================================================================

const OTHER_LANGS = [
  {
    languageId: "typescript",
    mainRel: "src/ui/keys.ts",
    projectRel: "src/ui/config.ts",
    libraryRel: "src/ui/node_modules/typescript/lib/lib.es5.d.ts",
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
    defSrc: `export class KeyConfig {
  slots: number = 0;

  rollActive(): number {
    return 0;
  }
}
`,
    hover: "class KeyConfig",
    members: [["slots", "slots: number", "field"], ["rollActive", "rollActive(): number", "method"]],
    evidence: "rollActive",
  },
  {
    languageId: "go",
    mainRel: "src/svc/keys.go",
    projectRel: "src/svc/config.go",
    libraryRel: "src/svc/goroot/src/time/time.go",
    src: `package svc

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
    defSrc: `package svc

type KeyConfig struct {
\tSlots uint32
}

func (c *KeyConfig) RollActive() uint32 {
\treturn 0
}
`,
    hover: "type KeyConfig struct { Slots uint32 }",
    members: [["Slots", "Slots uint32", "field"], ["RollActive", "RollActive() uint32", "method"]],
    evidence: "RollActive",
  },
];

for (const L of OTHER_LANGS) {
  btest(`[item 6] (${L.languageId}) moving the collaborator's definition into the installed library tree withholds NOTHING - same blocks, and the hint is still derived. This is Rust's rule.`, async () => {
    const mainPath = path.join(WS, L.mainRel);
    write(mainPath, L.src);
    const run = async (rel) => {
      const defPath = write(path.join(WS, rel), L.defSrc);
      const files = { [uriOf(mainPath)]: L.src, [uriOf(defPath)]: L.defSrc };
      const defTypes = {
        KeyConfig: {
          uri: uriOf(defPath),
          hover: L.hover,
          members: L.members.map(([n, s, k]) => memberIn(files, uriOf(defPath), n, s, k)),
        },
      };
      const start = L.src.indexOf(L.spanStart);
      const endIdx = L.src.indexOf(L.spanEnd, start);
      const record = {
        span: { start, end: endIdx + L.spanEnd.length },
        signature: L.signature,
        docComment: L.docComment,
        symbolName: L.symbolName,
        languageId: L.languageId,
        kind: "function",
        bodyOnly: false,
        headerIndent: "",
        bodyIndent: "    ",
        docstringRefusal: undefined,
        symbols: [],
      };
      const ext = makeExtractor(files, defTypes, []);
      const logs = [];
      globalThis.__V55P9_FILES__ = files;
      let out;
      try {
        out = await resolvePrefill(ext, makeDoc(L.src, uriOf(mainPath)), record, (l) => logs.push(l), {
          forConstruction: true,
          importTargetPath: IMPORT_TARGET,
        });
      } finally {
        delete globalThis.__V55P9_FILES__;
      }
      return { out, text: out || "", logs, defUri: uriOf(defPath) };
    };
    const project = await run(L.projectRel);
    const library = await run(L.libraryRel);
    // Non-vacuity, both halves: the arms must carry the collaborator's surface,
    // and they must carry a hint - otherwise this is two nothings compared.
    assert.ok(
      project.text.includes(L.evidence),
      `[${L.languageId}] the project arm must render the collaborator's members, or the identity below asserts nothing.${dump(project)}`,
    );
    assert.ok(
      usePathsFor(project.text, "KeyConfig").length > 0,
      `[${L.languageId}] the project arm must carry an import hint, or a filter change is unobservable here and the row pins nothing.${dump(project)}`,
    );
    // The claim is that NOTHING is withheld from the library arm. Its hint is
    // derived from its own path, so the two arms' hint TEXT differs by
    // construction; everything else must be byte-identical, and the hint must be
    // there at all.
    assert.ok(
      usePathsFor(library.text, "KeyConfig").length > 0,
      `[${L.languageId}] item 6: the collaborator's definition is under this language's installed library tree, and this is Rust's rule - the hint must still be derived. Silence here is a filter written at a language-agnostic seam.${dump(library)}`,
    );
    const withoutHints = (t) => t.split("\n").filter((l) => !/^use\s+\S.*;$/.test(l.trim())).join("\n");
    assert.strictEqual(
      withoutHints(library.text),
      withoutHints(project.text),
      `[${L.languageId}] item 6: apart from the hint each arm derives from its own path, moving the definition into the installed library tree must change nothing.\n  PROJECT ARM:\n${project.text}\n  LIBRARY ARM:\n${library.text}`,
    );
    assert.deepStrictEqual(
      library.logs.filter((l) => STDLIB_REASON.test(l)),
      [],
      `[${L.languageId}] and no stdlib refusal may appear on a non-Rust channel.${dump(library)}`,
    );
  });
}

// ===========================================================================
// ROW 13. [contract item 3] Totality, taken to the edge. The collection loop the
// predicate is called from has no `try` of its own, so a def URI the resolver
// reports in a shape nobody planned for must produce an answer, not an
// exception. None of these are file URIs at all.
// GREEN today.
// ===========================================================================

const ROGUE_URIS = [
  ["a lone percent in a non-file scheme", "untitled:Untitled-1%"],
  ["a bare word", "not-a-uri"],
  ["an empty string", ""],
  ["a scheme with no path", "file://"],
];

for (const [what, uri] of ROGUE_URIS) {
  btest(`[item 3] a def uri that is ${what} produces an answer, not a throw - the prefill still returns its project blocks`, async () => {
    const r = await runPrefill({ extUri: uri });
    assert.ok(
      r.out !== undefined,
      `item 3: the predicate is total over any string a resolver can hand back, and it is called inside a loop with no try. A throw here loses the whole prefill for one malformed URI.${dump(r)}`,
    );
    for (const t of ["ApiKeysConfig", "KeyStore"]) {
      assert.ok(headerTypes(r.text).includes(t), `the project type \`${t}\` must still render.${dump(r)}`);
    }
  });
}
