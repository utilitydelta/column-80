// BLIND ORACLE - session-v56 phase 6 (item 56, "the import hint derives paths
// that compile"). Written against the phase 6 contract BEFORE the
// implementation exists. Nothing in here was derived from reading the body of
// `renderImportHint`, `deriveUsePath`, or `rustImport`: only the exported
// signature `renderImportHint(types, targetFilePath, deps)` and the way the
// shipped suite already constructs inputs for it.
//
// Run: SKIP_LIVE=1 node --test test/blind-v56-p6-import-hint-reachability.test.cjs
//
// ===========================================================================
// PER-ROW FORECAST, written before the first run (this is the evidence the
// file was authored blind). "TODAY" = the tree at session-v56 with phase 6
// NOT yet implemented.
// ===========================================================================
//
//  ROW 1 / clause 1 (private module carrying a `pub use` re-export).
//    EXPECT RED TODAY. The contract states the path is derived from the FILE
//    TREE with no knowledge of module visibility, so a def at
//    `<serde>/src/ser.rs` must render `use serde::ser::Serialize;` today even
//    though `lib.rs` says `mod ser;` (private) and `pub use ser::Serialize;`.
//    The row asserts the RE-EXPORTED path `use serde::Serialize;`, so it fails
//    with the private chain in the actual. If it fails any other way - a throw,
//    an undefined, a third path - the contract's premise about today's output
//    is wrong and that is reported, not papered over.
//  ROW 1b / clause 1 (the re-export sits one level down, not at crate root).
//    EXPECT RED TODAY, same mechanism: `netlib/src/net/mod.rs` declares
//    `mod tcp;` private and re-exports, so the compiling path is
//    `netlib::net::TcpStream` and today's file-tree walk yields
//    `netlib::net::tcp::TcpStream`.
//
//  ROW 2 / clause 2 (reachability cannot be proven -> render nothing).
//    EXPECT RED TODAY. `lib.rs` declares `mod ser;` private and re-exports a
//    DIFFERENT name (`pub use ser::Serializer;`), so there is no provable path
//    to `Serialize` at all. Today's derivation cannot know that and must emit
//    the private guess. The row asserts the name is ABSENT from the render.
//    The "does not crash / no placeholder" halves of the row should pass today
//    (today's output is a well-formed, merely wrong, `use` line), so the
//    expected failure is the absence assertion alone.
//
//  ROW 3 / clause 3 (an already-correct path renders unchanged).
//    EXPECT GREEN TODAY and GREEN AFTER. These are regression pins, and 3a is
//    deliberately the exact string the shipped suite already pins, so a
//    reachability rewrite that starts refusing whenever it cannot READ a
//    `lib.rs` turns this red and that red is a real defect, not a surprise.
//
//  ROW 4 / clause 4 (non-Rust hints byte-identical across the change).
//    EXPECT GREEN TODAY and GREEN AFTER.
//    4a is at the `renderImportHint` surface: the export takes no language
//    parameter (see SURFACE GAP below), so "non-Rust" there means a def file
//    under no Cargo.toml. Pinned as `undefined`, in four languages.
//    4b is at the product surface, `resolvePrefill` in test-gen mode, driven
//    through the synthetic file system idiom of
//    test/adversarial-v55-p9.test.cjs. The two expected strings are BYTE
//    CAPTURES of a pre-fix run, which is the only way to pin "identical before
//    and after" from a file authored before the fix. They must survive phase 6
//    unchanged, character for character.
//
// SURFACE GAP (reported, not worked around): `renderImportHint` has no language
// parameter and its caller wraps its output in a hard-coded ```rust fence, so
// the hint is Rust-only and clause 4's "non-Rust languages' hints" has no
// direct expression at that export. Row 4b therefore pins the non-Rust PRE-FILL
// SURFACE at `resolvePrefill`, which is where a non-Rust prompt would show the
// drift. The export that would have made 4a a real cross-language row is a
// language-aware `renderImportHint(types, targetFilePath, deps, languageId)`;
// no such export exists and none is invented here.
//
// NOT TESTED ON PURPOSE: contract clause 6 (the sysroot carve-out) is a
// conditional the implementer decides, and clause 5 (the Tighten gesture keeps
// its v55 behaviour) is pinned by that gesture's own suite.

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const os = require("os");
const esbuild = require("esbuild");
const { bundleCore } = require("./.blind-util.cjs");

// ===========================================================================
// PART A - the pure surface. `renderImportHint(types, targetFilePath, deps)`
// with an injected file system, the idiom the shipped usePath suite uses.
// ===========================================================================

const { mod: core, cleanup: cleanupCore } = bundleCore(
  "blind-v56-p6-core",
  `export { deriveUsePath, renderImportHint } from "../src/core/usePath";\n`,
);
const { deriveUsePath, renderImportHint } = core;
test.after(cleanupCore);

// `files` is the set of paths that exist; `contents` maps path -> text. A path
// present in `contents` is implicitly present in `files` too, so a fixture
// cannot accidentally describe a readable file that does not exist.
function fsOf(files, contents = {}) {
  const exists = new Set([...files, ...Object.keys(contents)]);
  return {
    fileExists: (p) => exists.has(p),
    readFile: (p) => (p in contents ? contents[p] : undefined),
  };
}
const manifest = (name) => `[package]\nname = "${name}"\nversion = "0.1.0"\nedition = "2021"\n`;

// The gesture's target: a test file in a workspace crate.
const PG = "/repo/crates/playground";
const TARGET = `${PG}/tests/gen_build_store.rs`;

test("surface guard: renderImportHint is exported and callable", () => {
  assert.strictEqual(typeof renderImportHint, "function", "renderImportHint must be an exported function");
  assert.strictEqual(renderImportHint.length, 3, "signature is (types, targetFilePath, deps)");
});

// ---------------------------------------------------------------------------
// ROW 1 - contract clause 1 / falsification bullet 1.
// "For a Rust type whose file-tree path crosses a private module with a
//  `pub use` re-export, the rendered import hint names the RE-EXPORTED path."
//
// The fixture is unambiguous on purpose:
//   serde/Cargo.toml       name = "serde"
//   serde/src/lib.rs       `mod ser;`               <- PRIVATE, no `pub`
//                          `pub use ser::Serialize;` <- the only public route
//   serde/src/ser.rs       `pub trait Serialize`
// `serde::ser::Serialize` is E0603. `serde::Serialize` compiles.
// ---------------------------------------------------------------------------

const SERDE = "/home/dev/.cargo/registry/src/index.crates.io-6f17d22bba15001f/serde-1.0.210";
const serdeFs = (libSrc) =>
  fsOf(new Set([`${PG}/Cargo.toml`]), {
    [`${SERDE}/Cargo.toml`]: manifest("serde"),
    [`${SERDE}/src/lib.rs`]: libSrc,
    [`${SERDE}/src/ser.rs`]: `pub trait Serialize {\n    fn serialize(&self) -> u32;\n}\n`,
  });

test("[ROW 1 / clause 1] a def behind a PRIVATE module with a crate-root `pub use` renders the RE-EXPORTED path, not the private chain", () => {
  const deps = serdeFs(`mod ser;\npub use ser::Serialize;\n`);
  const hint = renderImportHint([{ name: "Serialize", defPath: `${SERDE}/src/ser.rs` }], TARGET, deps);
  const raw = deriveUsePath(`${SERDE}/src/ser.rs`, TARGET, deps);
  assert.strictEqual(
    hint,
    "use serde::Serialize;",
    `contract clause 1. \`lib.rs\` declares \`mod ser;\` with no \`pub\`, so \`serde::ser\` is private and \`use serde::ser::Serialize;\` is E0603. The only reachable path is the re-export at the crate root. FORECAST: this is RED before phase 6 because the path is derived from the file tree alone.\n  RAW deriveUsePath: ${JSON.stringify(raw)}\n  RENDERED: ${JSON.stringify(hint)}`,
  );
});

test("[ROW 1b / clause 1] the re-export one level down: a private `mod tcp;` inside a PUBLIC `net` module renders `netlib::net::TcpStream`", () => {
  const LIB = "/repo/crates/netlib";
  const deps = fsOf(new Set([`${PG}/Cargo.toml`]), {
    [`${LIB}/Cargo.toml`]: manifest("netlib"),
    [`${LIB}/src/lib.rs`]: `pub mod net;\n`,
    [`${LIB}/src/net/mod.rs`]: `mod tcp;\npub use tcp::TcpStream;\n`,
    [`${LIB}/src/net/tcp.rs`]: `pub struct TcpStream {\n    fd: i32,\n}\n`,
  });
  const hint = renderImportHint([{ name: "TcpStream", defPath: `${LIB}/src/net/tcp.rs` }], TARGET, deps);
  const raw = deriveUsePath(`${LIB}/src/net/tcp.rs`, TARGET, deps);
  assert.strictEqual(
    hint,
    "use netlib::net::TcpStream;",
    `contract clause 1, with the private segment in the middle of the chain rather than at the crate root. \`net\` is public, \`net::tcp\` is not, and \`net\` re-exports the type. FORECAST: RED before phase 6 (today's file-tree walk yields \`netlib::net::tcp::TcpStream\`).\n  RAW deriveUsePath: ${JSON.stringify(raw)}\n  RENDERED: ${JSON.stringify(hint)}`,
  );
});

// ---------------------------------------------------------------------------
// ROW 2 - contract clause 2 / falsification bullet 2.
// "Where reachability cannot be proven, the hint REFUSES that type (renders
//  nothing for it) rather than guessing. A wrong hint is worse than no hint."
//
// Same private module, but the re-export names a DIFFERENT type. There is no
// public route to `Serialize` anywhere in the crate, so no path can be proven
// and the honest render is silence.
// ---------------------------------------------------------------------------

const UNPROVABLE_LIB = `mod ser;\npub use ser::Serializer;\n`;

test("[ROW 2 / clause 2] a type with no provable public route renders NOTHING - alone, the whole hint is undefined", () => {
  const deps = serdeFs(UNPROVABLE_LIB);
  let hint;
  assert.doesNotThrow(() => {
    hint = renderImportHint([{ name: "Serialize", defPath: `${SERDE}/src/ser.rs` }], TARGET, deps);
  }, "clause 2: an unprovable type is a refusal, never a throw");
  assert.strictEqual(
    hint,
    undefined,
    `contract clause 2. \`lib.rs\` re-exports \`Serializer\`, not \`Serialize\`, and \`mod ser;\` is private, so NO path to \`Serialize\` compiles. The hint must be withheld. FORECAST: RED before phase 6, with \`use serde::ser::Serialize;\` in the actual - the guess the contract calls worse than nothing.\n  RENDERED: ${JSON.stringify(hint)}`,
  );
});

test("[ROW 2 / clause 2] an unprovable type is dropped from a MIXED render: the provable line survives, the unprovable name appears nowhere and leaves no placeholder", () => {
  const deps = fsOf(new Set([`${PG}/Cargo.toml`]), {
    [`${SERDE}/Cargo.toml`]: manifest("serde"),
    [`${SERDE}/src/lib.rs`]: UNPROVABLE_LIB,
    [`${SERDE}/src/ser.rs`]: `pub trait Serialize {\n    fn serialize(&self) -> u32;\n}\n`,
  });
  let hint;
  assert.doesNotThrow(() => {
    hint = renderImportHint(
      [
        { name: "Serialize", defPath: `${SERDE}/src/ser.rs` },
        { name: "Order", defPath: `${PG}/src/orders.rs` },
      ],
      TARGET,
      deps,
    );
  }, "clause 2: a refusal in one entry must not take the render down");
  assert.strictEqual(
    hint,
    "use crate::orders::Order;",
    `contract clause 2 plus clause 3 in one render: the workspace type keeps its line, the unprovable one contributes nothing at all - no name, no commented stub, no \`???\`. FORECAST: RED before phase 6, actual carries an extra \`use serde::ser::Serialize;\` line.\n  RENDERED: ${JSON.stringify(hint)}`,
  );
  assert.ok(
    hint === undefined || !/Serialize/.test(hint),
    `clause 2, stated as the absence it is: the unprovable name must not occur anywhere in the rendered text.\n  RENDERED: ${JSON.stringify(hint)}`,
  );
});

// ---------------------------------------------------------------------------
// ROW 3 - contract clause 3 / falsification bullet 3.
// "Paths that were already correct keep rendering unchanged."
// 3a is the exact string the shipped suite pins, with NO readable crate source
// at all - the case a strict "prove it or refuse it" rewrite would regress.
// ---------------------------------------------------------------------------

test("[ROW 3a / clause 3] a same-crate module path renders exactly as it ships today, with no crate source readable", () => {
  const hint = renderImportHint(
    [{ name: "Order", defPath: `${PG}/src/orders.rs` }],
    TARGET,
    fsOf(new Set([`${PG}/Cargo.toml`])),
  );
  assert.strictEqual(
    hint,
    "use crate::orders::Order;",
    "contract clause 3. This is the shipped behaviour with an EMPTY contents map: nothing about the module tree is readable. A rewrite that refuses whenever it cannot read a `lib.rs` breaks every same-crate hint the product renders. FORECAST: GREEN today, and it must stay green.",
  );
});

test("[ROW 3b / clause 3] a genuinely public cross-crate path (`pub mod`, no re-export anywhere) renders unchanged", () => {
  const ATLAS = "/repo/crates/atlas";
  const deps = fsOf(new Set([`${PG}/Cargo.toml`]), {
    [`${ATLAS}/Cargo.toml`]: manifest("atlas"),
    [`${ATLAS}/src/lib.rs`]: `pub mod geo;\n`,
    [`${ATLAS}/src/geo.rs`]: `pub struct Coord {\n    pub lat: f64,\n}\n`,
  });
  const hint = renderImportHint([{ name: "Coord", defPath: `${ATLAS}/src/geo.rs` }], TARGET, deps);
  assert.strictEqual(
    hint,
    "use atlas::geo::Coord;",
    "contract clause 3. `pub mod geo;` is public, the file-tree path is already the compiling path, and the rewrite must leave it alone rather than hunt for a re-export that does not exist. FORECAST: GREEN today.",
  );
});

test("[ROW 3c / clause 3] grouping and sort order of correct paths are unchanged", () => {
  const hint = renderImportHint(
    [
      { name: "Order", defPath: `${PG}/src/orders.rs` },
      { name: "Customer", defPath: `${PG}/src/orders.rs` },
      { name: "Widget", defPath: `${PG}/src/ui.rs` },
    ],
    TARGET,
    fsOf(new Set([`${PG}/Cargo.toml`])),
  );
  assert.strictEqual(
    hint,
    "use crate::orders::{Customer, Order};\nuse crate::ui::Widget;",
    "contract clause 3, on the rendering itself rather than one path: one line per module, module paths sorted, names sorted, braces only when a module contributes more than one name. FORECAST: GREEN today.",
  );
});

// ---------------------------------------------------------------------------
// ROW 4a - contract clause 4 at the pure surface. The export is Rust-only (see
// the SURFACE GAP in the header), so the honest pin here is: a def file that
// sits under no Cargo.toml contributes nothing, in every language, and the
// reachability rewrite must not change that into a guess.
// ---------------------------------------------------------------------------

const NON_RUST = [
  ["typescript", "/repo/web/src/types.ts", "/repo/web/test/buildStore.test.ts", "ApiKeysConfig"],
  ["python", "/repo/svc/pkg/types.py", "/repo/svc/tests/test_build_store.py", "ApiKeysConfig"],
  ["csharp", "/repo/dotnet/src/Types.cs", "/repo/dotnet/tests/BuildStoreTests.cs", "KeyStore"],
  ["go", "/repo/svc/internal/types.go", "/repo/svc/internal/types_test.go", "KeyStore"],
];

for (const [lang, defPath, targetPath, name] of NON_RUST) {
  test(`[ROW 4a / clause 4] a ${lang} def path contributes no hint, before and after`, () => {
    let hint;
    assert.doesNotThrow(() => {
      hint = renderImportHint([{ name, defPath }], targetPath, fsOf(new Set()));
    }, "a non-Rust path must not throw");
    assert.strictEqual(
      hint,
      undefined,
      `contract clause 4. Nothing in this tree is a Rust crate, so there is no \`use\` line to render and the rewrite must not invent one. FORECAST: GREEN today.\n  RENDERED: ${JSON.stringify(hint)}`,
    );
  });
}

// ===========================================================================
// PART B - ROW 4b, contract clause 4 at the product surface.
//
// `renderImportHint` takes no language, so the only place a non-Rust prompt can
// drift is the pre-fill surface the gesture actually builds. This drives
// `resolvePrefill` in test-gen mode (`forConstruction`, `importTargetPath` set -
// the same mode the Rust import hint is rendered in) over a synthetic file
// system, the idiom from test/adversarial-v55-p9.test.cjs, so no toolchain and
// no language server are needed.
//
// The two expected strings below are BYTE CAPTURES taken from a pre-fix run.
// That is deliberate and is the only way to express "identical before and
// after" in a file written before "after" exists. If phase 6 changes a single
// character of either, this row goes red and the change is a clause 4
// violation until someone argues otherwise.
// ===========================================================================

const B_STUB = path.join(__dirname, ".blind-v56-p6-vscode-stub.cjs");
fs.writeFileSync(
  B_STUB,
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

const B_ENTRY = path.join(__dirname, ".blind-v56-p6.entry.ts");
const B_OUT = path.join(__dirname, ".blind-v56-p6.bundle.cjs");
let resolvePrefill;
let bundleErr;
try {
  fs.writeFileSync(B_ENTRY, `export { resolvePrefill } from "../src/vscode/fnGen";\n`);
  esbuild.buildSync({
    entryPoints: [B_ENTRY],
    bundle: true,
    outfile: B_OUT,
    format: "cjs",
    platform: "node",
    alias: { vscode: B_STUB },
  });
  ({ resolvePrefill } = require(B_OUT));
} catch (e) {
  bundleErr = e;
}
const V = require(B_STUB);
test.after(() => [B_STUB, B_ENTRY, B_OUT].forEach((f) => fs.rmSync(f, { force: true })));

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "blind-v56-p6-"));
test.after(() => fs.rmSync(ROOT, { recursive: true, force: true }));
const write = (p, t) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, t);
  return p;
};
const uriOf = (p) => "file://" + p.replace(/ /g, "%20");

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
function memberIn(files, uri, name, signature, kind) {
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
function makeExtractor(files, defTypes) {
  const known = new Set(Object.keys(defTypes));
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

async function runPrefill({ mainPath, mainSrc, typesPath, typesSrc, defTypes, record, importTargetPath }) {
  write(mainPath, mainSrc);
  write(typesPath, typesSrc);
  const files = { [uriOf(mainPath)]: mainSrc, [uriOf(typesPath)]: typesSrc };
  const ext = makeExtractor(files, defTypes(files, uriOf(typesPath)));
  const logs = [];
  globalThis.__ADVV55P9_FILES__ = files;
  let out;
  try {
    out = await resolvePrefill(ext, makeDoc(mainSrc, uriOf(mainPath)), record, (l) => logs.push(l), {
      forConstruction: true,
      importTargetPath,
    });
  } finally {
    delete globalThis.__ADVV55P9_FILES__;
  }
  return { out, logs };
}

const btest = (name, fn) =>
  test(name, (ctx) => {
    if (bundleErr) return assert.fail(`bundle failed to build: ${bundleErr.message}`);
    return fn(ctx);
  });

// --- TypeScript -------------------------------------------------------------

const TS_DIR = path.join(ROOT, "web", "src");
const TS_TYPES_SRC = `export interface ApiKeysConfig {
  tenantId: number;
  label: string;
}

export interface KeyStore {
  live: number;
}
`;
const TS_MAIN_SRC = `import { ApiKeysConfig, KeyStore } from "./types";

/** Build the key store from seed. */
export function buildStore(seed: number, cfg: ApiKeysConfig): KeyStore {
  throw new Error("todo");
}
`;
// BYTE PIN, captured pre-fix. Any character of drift in phase 6 is a clause 4 failure.
const TS_EXPECTED = [
  "Data shape of `ApiKeysConfig` (fields and types, nested):",
  "```ts",
  "interface ApiKeysConfig { tenantId: number; label: string }",
  "```",
  "",
  "Members of `ApiKeysConfig` (real signatures, use these exact names, do not invent):",
  "```ts",
  "tenantId: number",
  "```",
  "",
  "Data shape of `KeyStore` (fields and types, nested):",
  "```ts",
  "interface KeyStore { live: number }",
  "```",
  "",
  "Members of `KeyStore` (real signatures, use these exact names, do not invent):",
  "```ts",
  "live: number",
  "```",
  "",
  "Use ONLY the members and types of `ApiKeysConfig` and `KeyStore` that appear in the surface above. Do not invent members, fields, or types beyond that surface. Everything else in the file is unaffected by this: other values in scope, this function's own locals, sibling functions, and standard-library types stay allowed.",
].join("\n");

btest("[ROW 4b / clause 4] the TypeScript pre-fill surface is byte-identical, and carries no import hint", async () => {
  const mainPath = path.join(TS_DIR, "apiKeys.ts");
  const start = TS_MAIN_SRC.indexOf("export function buildStore");
  const endMark = `throw new Error("todo");\n}`;
  const end = TS_MAIN_SRC.indexOf(endMark, start) + endMark.length;
  const { out } = await runPrefill({
    mainPath,
    mainSrc: TS_MAIN_SRC,
    typesPath: path.join(TS_DIR, "types.ts"),
    typesSrc: TS_TYPES_SRC,
    defTypes: (files, u) => ({
      ApiKeysConfig: { uri: u, hover: "interface ApiKeysConfig { tenantId: number; label: string }", members: [memberIn(files, u, "tenantId", "tenantId: number", "property")] },
      KeyStore: { uri: u, hover: "interface KeyStore { live: number }", members: [memberIn(files, u, "live", "live: number", "property")] },
    }),
    record: {
      span: { start, end },
      signature: "export function buildStore(seed: number, cfg: ApiKeysConfig): KeyStore",
      docComment: "/** Build the key store from seed. */",
      symbolName: "buildStore",
      languageId: "typescript",
      kind: "function",
      bodyOnly: false,
      headerIndent: "",
      bodyIndent: "  ",
      docstringRefusal: undefined,
      symbols: [dsym("buildStore", SK.Function, rng(TS_MAIN_SRC, "export function buildStore", `  throw new Error("todo");`))],
    },
    importTargetPath: path.join(ROOT, "web", "test", "buildStore.test.ts"),
  });
  assert.strictEqual(
    out,
    TS_EXPECTED,
    "contract clause 4: the TypeScript pre-fill surface must be byte-identical before and after the Rust reachability rewrite. FORECAST: GREEN today (this string IS the pre-fix capture); red here means phase 6 leaked into a non-Rust language.",
  );
  assert.ok(!/Import these collaborators/.test(out || ""), "clause 4: no import hint block on a non-Rust prompt");
  assert.ok(!/^use\s/m.test(out || ""), "clause 4: no Rust `use` line on a non-Rust prompt");
});

// --- Python -----------------------------------------------------------------

const PY_DIR = path.join(ROOT, "svc", "pkg");
const PY_TYPES_SRC = `class ApiKeysConfig:
    def __init__(self, tenant_id: int, label: str) -> None:
        self.tenant_id = tenant_id
        self.label = label


class KeyStore:
    def __init__(self, live: int) -> None:
        self.live = live
`;
const PY_MAIN_SRC = `from .types import ApiKeysConfig, KeyStore


def build_store(seed: int, cfg: ApiKeysConfig) -> KeyStore:
    """Build the key store from seed."""
    raise NotImplementedError
`;
// BYTE PIN, captured pre-fix.
const PY_EXPECTED = [
  "Members of `ApiKeysConfig` (real signatures, use these exact names, do not invent):",
  "```python",
  "tenant_id: int",
  "```",
  "",
  "Members of `KeyStore` (real signatures, use these exact names, do not invent):",
  "```python",
  "live: int",
  "```",
  "",
  "Use ONLY the members and types of `ApiKeysConfig` and `KeyStore` that appear in the surface above. Do not invent members, attributes, or types beyond that surface. Everything else in the file is unaffected by this: other values in scope, this function's own locals, sibling functions, and standard-library types stay allowed.",
].join("\n");

btest("[ROW 4b / clause 4] the Python pre-fill surface is byte-identical, and carries no import hint", async () => {
  const mainPath = path.join(PY_DIR, "api_keys.py");
  const start = PY_MAIN_SRC.indexOf("def build_store");
  const endMark = "raise NotImplementedError";
  const end = PY_MAIN_SRC.indexOf(endMark, start) + endMark.length;
  const { out } = await runPrefill({
    mainPath,
    mainSrc: PY_MAIN_SRC,
    typesPath: path.join(PY_DIR, "types.py"),
    typesSrc: PY_TYPES_SRC,
    defTypes: (files, u) => ({
      ApiKeysConfig: { uri: u, hover: "class ApiKeysConfig(tenant_id: int, label: str)", members: [memberIn(files, u, "tenant_id", "tenant_id: int", "property")] },
      KeyStore: { uri: u, hover: "class KeyStore(live: int)", members: [memberIn(files, u, "live", "live: int", "property")] },
    }),
    record: {
      span: { start, end },
      signature: "def build_store(seed: int, cfg: ApiKeysConfig) -> KeyStore:",
      docComment: `"""Build the key store from seed."""`,
      symbolName: "build_store",
      languageId: "python",
      kind: "function",
      bodyOnly: false,
      headerIndent: "",
      bodyIndent: "    ",
      docstringRefusal: undefined,
      symbols: [dsym("build_store", SK.Function, rng(PY_MAIN_SRC, "def build_store", "    raise NotImplementedError"))],
    },
    importTargetPath: path.join(ROOT, "svc", "tests", "test_build_store.py"),
  });
  assert.strictEqual(
    out,
    PY_EXPECTED,
    "contract clause 4: the Python pre-fill surface must be byte-identical before and after. FORECAST: GREEN today.",
  );
  assert.ok(!/Import these collaborators/.test(out || ""), "clause 4: no import hint block on a non-Rust prompt");
  assert.ok(!/^use\s/m.test(out || ""), "clause 4: no Rust `use` line on a non-Rust prompt");
});
