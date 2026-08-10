// ADVERSARIAL REVIEW - session-v41 phase 2 (alias resolution, two tiers).
// Fresh-context reviewer's evidence file, same rules as adversarial-v41-p1:
// FAILING rows are defect claims with evidence; PASSING rows are attacks that
// did not land, kept as the record.
//
// Sections:
//   AC - the REAL census aliases (MemCache, SyncResult, R, EntryHashBytes)
//        through resolvePrefill (product path, vscode stub) with the real
//        corpus files. Skipped if the sandbox is absent.
//   W  - walk-level attacks on aliasChaseHead / aliasTargetCursor / the
//        copy-up, driven through resolveCrossFileShape (the impl suite's
//        harness convention).
//        W1 is the finding: `aliasChaseHead`'s decl regex takes `[^=\n]*=`,
//        which stops at the FIRST `=` on the decl. A generic-parameter
//        DEFAULT (`pub type Cache<K = MyKey> = Store<K>` - legal, idiomatic
//        Rust: `pub type Cache<K = String> = HashMap<K, u32>`) puts its `=`
//        before the alias's own, so the DEFAULT type is parsed as the RHS
//        head, chased, walked, and the post-walk copy-up hands the ALIAS the
//        default type's method list. Wrong surface under the alias's name,
//        in the compiler's voice. aliasTargetCursor makes the same first-`=`
//        cut, so the anchor agrees with the wrong parse and nothing refuses.
//        (None of the 4 census aliases carries a default, so corpus rows
//        cannot see it - incidence today is zero, the bar is still the bar.)
//
// Run: SKIP_LIVE=1 node --test test/adversarial-v41-p2.test.cjs

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const esbuild = require("esbuild");
const { bundleCore } = require("./.blind-util.cjs");

const CORPUS = path.join(os.homedir(), "sandbox", "complexity-study-acme");
const real = (rel) => {
  const p = path.join(CORPUS, rel);
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : undefined;
};
const dump = (t) => `\n  GOT:\n${t}`;
const countOf = (text, re) => (text.match(new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g")) || []).length;

// ===========================================================================
// Walk-level harness (bundleCore, the impl-v41-p2 conventions).
// ===========================================================================

const { mod: coreMod, cleanup: coreCleanup } = bundleCore(
  "adversarial-v41-p2-core",
  `export { resolveCrossFileShape } from "../src/core/crossFileShape";\n`,
);
const { resolveCrossFileShape } = coreMod;
test.after(coreCleanup);

const WS = "file:///work/adv41p2";
const SYSROOT_RESULT =
  "file:///home/user/.rustup/toolchains/stable-x86_64-unknown-linux-gnu/lib/rustlib/src/rust/library/core/src/result.rs";

const wordAt = (text, cursor) => {
  const line = (text || "").split("\n")[cursor.line] ?? "";
  const isWord = (c) => /[A-Za-z0-9_]/.test(c);
  let s = Math.min(cursor.character, line.length);
  let e = s;
  while (s > 0 && isWord(line[s - 1])) s--;
  while (e < line.length && isWord(line[e])) e++;
  return line.slice(s, e) || undefined;
};

function makeWalkExtractor(files, defTypes) {
  const known = new Set(Object.keys(defTypes));
  const typeAt = (c) => {
    const w = wordAt(files[c.uri], c);
    return w && known.has(w) ? w : undefined;
  };
  return {
    definition: async (c) => {
      const t = typeAt(c);
      if (!t) return undefined;
      const uri = defTypes[t].uri;
      const lines = (files[uri] || "").split("\n");
      let ln = lines.findIndex((l) => new RegExp(`\\b(?:type|struct|enum|trait)\\s+${t}\\b`).test(l));
      if (ln < 0) ln = 0;
      const ch = Math.max(0, lines[ln].indexOf(t));
      return { uri, range: { startLine: ln, startCharacter: ch, endLine: ln, endCharacter: ch + t.length } };
    },
    hoverSurface: async (c) => {
      const t = typeAt(c);
      return t && defTypes[t].hover ? { signature: defTypes[t].hover } : undefined;
    },
    membersOfType: async (c) => {
      const t = typeAt(c);
      if (!t) return [];
      return c.uri === defTypes[t].uri ? defTypes[t].members || [] : [];
    },
  };
}

async function walk(rootName, types, opts = {}) {
  const mainUri = `${WS}/main.rs`;
  const main = `pub fn use_it(x: ${rootName}) -> u32 {\n    todo!()\n}\n`;
  const files = { [mainUri]: main };
  const defTypes = {};
  for (const t of types) {
    files[t.uri] = t.src;
    defTypes[t.name] = t;
  }
  const openFile = async (uri) => (opts.unreadable?.includes(uri) ? undefined : files[uri]);
  const rootSite = { uri: mainUri, line: 0, character: main.indexOf(rootName) };
  return resolveCrossFileShape(makeWalkExtractor(files, defTypes), rootSite, { D_MAX: 2, N_MAX: 8 }, openFile);
}

// ===========================================================================
// W1 - THE FINDING. A generic-parameter default's `=` is taken as the alias's
// `=`; the DEFAULT is chased and its methods are copied onto the alias.
// ===========================================================================

test("W1: a generic-default alias chases its RHS head, never the default type (pub type Cache<K = MyKey> = Store<K>)", async () => {
  const myKey = {
    name: "MyKey",
    uri: `${WS}/my_key.rs`,
    hover: ["pub struct MyKey {", "    pub raw: u64,", "}"].join("\n"),
    src: [
      "pub struct MyKey {",
      "    pub raw: u64,",
      "}",
      "impl MyKey {",
      "    pub fn hash_hint(&self) -> u64 { self.raw }",
      "}",
      "",
    ].join("\n"),
    members: [{ name: "hash_hint", kind: "method", signature: "hash_hint(&self) -> u64" }],
  };
  const store = {
    name: "Store",
    uri: `${WS}/store.rs`,
    hover: ["pub struct Store<K> {", "    pub len: usize,", "}"].join("\n"),
    src: [
      "pub struct Store<K> {",
      "    pub len: usize,",
      "}",
      "impl<K> Store<K> {",
      "    pub fn insert(&mut self, key: K) {}",
      "}",
      "",
    ].join("\n"),
    members: [{ name: "insert", kind: "method", signature: "insert(&mut self, key: K)" }],
  };
  const alias = {
    name: "Cache",
    uri: `${WS}/cache.rs`,
    hover: "pub type Cache<K = MyKey> = Store<K>",
    src: ["pub type Cache<K = MyKey> = Store<K>;", ""].join("\n"),
    members: [],
  };
  const shape = await walk("Cache", [alias, myKey, store]);
  const cache = shape.types.get("Cache");
  assert.ok(cache, "the alias root resolves");
  // The alias's `=` is the SECOND one on the decl; the target is Store. A
  // chase that lands on MyKey read the default parameter's `=` as the
  // declaration's, and everything downstream (aliasTarget edge, method
  // copy-up) inherits the wrong type.
  assert.notEqual(
    cache.aliasTarget,
    "MyKey",
    `the chase took the generic DEFAULT as the alias target; the copy-up then hands ` +
      `\`Cache\` MyKey's methods (${JSON.stringify(cache.methods)}) and the data-shape edge ` +
      `renders MyKey's def as what \`Cache\` means - a wrong surface in the compiler's voice`,
  );
  assert.ok(
    !cache.methods.some((m) => /hash_hint/.test(m)),
    `MyKey's method surface leaked onto the alias: ${JSON.stringify(cache.methods)}`,
  );
});

// ===========================================================================
// W2-W5: attacks on the guard rails that did not (or did) land.
// ===========================================================================

test("W2: a PROJECT type literally named Result IS chased (provenance is by path, not name)", async () => {
  const projectResult = {
    name: "Result",
    uri: `${WS}/result.rs`,
    hover: ["pub struct Result {", "    pub code: u32,", "}"].join("\n"),
    src: [
      "pub struct Result {",
      "    pub code: u32,",
      "}",
      "impl Result {",
      "    pub fn ok(&self) -> bool { self.code == 0 }",
      "}",
      "",
    ].join("\n"),
    members: [{ name: "ok", kind: "method", signature: "ok(&self) -> bool" }],
  };
  const alias = {
    name: "Res",
    uri: `${WS}/res.rs`,
    hover: "pub type Res = Result",
    src: ["pub type Res = Result;", ""].join("\n"),
    members: [],
  };
  const shape = await walk("Res", [alias, projectResult]);
  assert.equal(shape.types.get("Res")?.aliasTarget, "Result", "project-defined shadow of a std name must chase");
  assert.ok(shape.types.has("Result"), "the project Result entered the walk");
  assert.ok(
    shape.types.get("Res")?.methods.some((m) => /ok\(/.test(m)),
    "the copy-up carries the project target's surface",
  );
});

test("W3: a chased target whose def file is unreadable degrades honestly - no throw, tier-1 line kept", async () => {
  const target = {
    name: "Blob",
    uri: `${WS}/blob.rs`,
    hover: ["pub struct Blob {", "    pub len: usize,", "}"].join("\n"),
    src: ["pub struct Blob {", "    pub len: usize,", "}", ""].join("\n"),
    members: [{ name: "clear", kind: "method", signature: "clear(&mut self)" }],
  };
  const alias = {
    name: "Payload",
    uri: `${WS}/payload.rs`,
    hover: "pub type Payload = Blob",
    src: ["pub type Payload = Blob;", ""].join("\n"),
    members: [],
  };
  const shape = await walk("Payload", [alias, target], { unreadable: [`${WS}/blob.rs`] });
  const payload = shape.types.get("Payload");
  assert.ok(payload, "the alias still resolves");
  assert.match(payload.signature, /type Payload = Blob/, "tier-1 line survives");
  const blob = shape.types.get("Blob");
  if (blob) {
    assert.equal(blob.methodsResolved, false, "an unreadable def cannot claim member enumeration ran");
    assert.deepEqual(payload.methods, [], "no methods exist to copy up; inventing them would be the lie");
  }
});

test("W4: a multi-line alias declaration skips the chase without throwing; tier 1 stands", async () => {
  const target = {
    name: "Wide",
    uri: `${WS}/wide.rs`,
    hover: ["pub struct Wide {", "    pub w: u32,", "}"].join("\n"),
    src: ["pub struct Wide {", "    pub w: u32,", "}", ""].join("\n"),
    members: [],
  };
  const alias = {
    name: "Split",
    uri: `${WS}/split.rs`,
    hover: "pub type Split = Wide",
    // The decl line carries only `pub type Split =`; the RHS is on the next
    // line, so aliasTargetCursor finds no target ident after the `=`.
    src: ["pub type Split =", "    Wide;", ""].join("\n"),
    members: [],
  };
  const shape = await walk("Split", [alias, target]);
  const split = shape.types.get("Split");
  assert.ok(split, "the alias resolves");
  assert.equal(split.aliasTarget, undefined, "no anchor on the decl line means no chase - documented degrade");
});

test("W5: an alias whose RHS is its own generic parameter (pub type Chan<Fut2> = Fut2) must not emit the parameter as a type", async () => {
  // Legal Rust (`pub type Identity<T> = T;`). `Fut2` is multi-character, so
  // the single-capital skipCandidate cannot stop it; definition() at the RHS
  // ident resolves the PARAMETER's own declaration on the same line, and the
  // hover there is chrome, not a type. Emulated with the chrome hover RA
  // gives a type parameter; if the walk emits it, a junk def line renders on
  // the alias's data-shape edge.
  const alias = {
    name: "Chan",
    uri: `${WS}/chan.rs`,
    hover: "pub type Chan<Fut2> = Fut2",
    src: ["pub type Chan<Fut2> = Fut2;", ""].join("\n"),
    members: [],
  };
  const param = {
    name: "Fut2",
    uri: `${WS}/chan.rs`, // the parameter "defines" at the alias's own line
    hover: "Fut2",
    src: alias.src,
    members: [],
  };
  const shape = await walk("Chan", [alias, param]);
  assert.ok(
    !shape.types.has("Fut2"),
    `the generic parameter was emitted as a walked type (signature ${JSON.stringify(
      shape.types.get("Fut2")?.signature,
    )}); its chrome hover renders as a junk def on the alias edge`,
  );
});

// ===========================================================================
// Product-path harness (resolvePrefill + vscode stub), the adversarial-p1
// convention with p2 file names.
// ===========================================================================

const STUB = path.join(__dirname, ".adversarial-v41-p2-vscode-stub.cjs");
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
      const files = globalThis.__ADV41P2_FILES__ || {};
      const key = keyOf(arg);
      return Promise.resolve({ uri: mkUri(key), getText: () => files[key] });
    },
  },
};
`,
);
const G_ENTRY = path.join(__dirname, ".adversarial-v41-p2-prefill.entry.ts");
const G_OUT = path.join(__dirname, ".adversarial-v41-p2-prefill.bundle.cjs");
let resolvePrefill;
let gBundleErr;
try {
  fs.writeFileSync(G_ENTRY, `export { resolvePrefill } from "../src/vscode/fnGen";\n`);
  esbuild.buildSync({ entryPoints: [G_ENTRY], bundle: true, outfile: G_OUT, format: "cjs", platform: "node", alias: { vscode: STUB } });
  ({ resolvePrefill } = require(G_OUT));
} catch (e) {
  gBundleErr = e;
}
const V = (() => { try { return require(STUB); } catch { return undefined; } })();
test.after(() => [STUB, G_ENTRY, G_OUT].forEach((f) => fs.rmSync(f, { force: true })));

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

async function runPrefill(paramType, filesIn, defTypes) {
  const mainUri = `${WS}/pf/main.rs`;
  const signature = `pub fn decide(p0: ${paramType}) -> u32`;
  const src = `/// Decide the outcome.\n${signature} {\n    todo!()\n}\n`;
  const files = { [mainUri]: src, ...filesIn };
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
  const ext = makeWalkExtractor(files, defTypes);
  ext.example = async () => undefined;
  ext.completeMembers = async () => [];
  ext.qualifyImport = async () => undefined;
  globalThis.__ADV41P2_FILES__ = files;
  try {
    return (await resolvePrefill(ext, makeDoc(src, mainUri), record, () => {})) || "";
  } finally {
    delete globalThis.__ADV41P2_FILES__;
  }
}

const actest = (name, rels, fn) =>
  test(name, (ctx) => {
    if (gBundleErr) return ctx.skip(`prefill bundle broken: ${gBundleErr.message}`);
    const srcs = rels.map(real);
    if (srcs.some((s) => s === undefined)) return ctx.skip(`corpus file missing among: ${rels.join(", ")}`);
    return fn(...srcs);
  });

// ===========================================================================
// AC - the real census aliases, end to end.
// ===========================================================================

actest(
  "AC1: MemCache (real shard_wal_sync.rs + real shard_mem_cache.rs) - both names in the prompt, target surface present, method list rendered ONCE",
  ["acme_shard/src/shard_wal_sync.rs", "acme_memcache/src/shard_mem_cache.rs"],
  async (aliasSrc, targetSrc) => {
    const aliasUri = `${WS}/pf/shard_wal_sync.rs`;
    const targetUri = `${WS}/pf/shard_mem_cache.rs`;
    const text = await runPrefill(
      "MemCache",
      { [aliasUri]: aliasSrc, [targetUri]: targetSrc },
      {
        MemCache: { uri: aliasUri, hover: "type MemCache = ShardMemCache<CompiledValidator>" },
        ShardMemCache: {
          uri: targetUri,
          hover: [
            "pub struct ShardMemCache<V: Validate> {",
            "    recent_write_cache_bytes: u64,",
            "    cache_current_bytes: u64,",
            "}",
          ].join("\n"),
          members: [
            {
              name: "aggregate_client_load_status",
              kind: "method",
              signature:
                "aggregate_client_load_status(&mut self, aggregate_key: &AggregateKey, aggregate_client_key: &AggregateClientKey) -> (bool, Option<u64>)",
            },
          ],
        },
      },
    );
    assert.ok(
      /type MemCache = ShardMemCache<CompiledValidator>/.test(text),
      `the alias line (BOTH names) must reach the prompt - v22 measured alias call sites at 0.0% recall without it.${dump(text)}`,
    );
    assert.ok(
      /struct ShardMemCache/.test(text),
      `the chased target's def must render after the alias line.${dump(text)}`,
    );
    assert.ok(
      /aggregate_client_load_status/.test(text),
      `the target's method surface must be reachable through the alias.${dump(text)}`,
    );
    assert.equal(
      countOf(text, /aggregate_client_load_status\(/),
      1,
      `the copied method list must render exactly once, not once under each name.${dump(text)}`,
    );
  },
);

actest(
  "AC2: SyncResult (real coordinator.rs) - tier-1 line renders; the std Result chase is refused on provenance",
  ["acme_shard/src/amortisation/coordinator.rs"],
  async (aliasSrc) => {
    const aliasUri = `${WS}/pf/coordinator.rs`;
    const sysrootUri = SYSROOT_RESULT;
    const text = await runPrefill(
      "SyncResult",
      { [aliasUri]: aliasSrc, [sysrootUri]: "pub enum Result<T, E> {\n    Ok(T),\n    Err(E),\n}\n" },
      {
        SyncResult: { uri: aliasUri, hover: "pub type SyncResult<E> = Result<(), E>" },
        Result: {
          uri: sysrootUri,
          hover: "pub enum Result<T, E> {\n    Ok(T),\n    Err(E),\n}",
          members: [],
        },
      },
    );
    assert.ok(
      /pub type SyncResult<E> = Result<\(\), E>/.test(text),
      `the tier-1 line is the whole payload for a std target.${dump(text)}`,
    );
    assert.ok(
      !/pub enum Result<T, E>/.test(text),
      `the std Result def must NOT render: the chase is refused on sysroot provenance.${dump(text)}`,
    );
  },
);

actest(
  "AC3: EntryHashBytes (real constants.rs) - the `{const}` hover ships as-is, tier 1, no chase",
  ["acme_wal/src/constants.rs"],
  async (aliasSrc) => {
    const aliasUri = `${WS}/pf/constants.rs`;
    const text = await runPrefill(
      "EntryHashBytes",
      { [aliasUri]: aliasSrc },
      { EntryHashBytes: { uri: aliasUri, hover: "pub type EntryHashBytes = [u8; {const}]" } },
    );
    assert.ok(
      /pub type EntryHashBytes = \[u8; \{const\}\]/.test(text),
      `tier 1 ships the hover verbatim (goal: recovering 32 is a loop decision, not required).${dump(text)}`,
    );
  },
);

actest(
  "AC4: R (real common.rs) - RHS head Result is std; tier-1 line only, nothing invented",
  ["acme_integration_tests/src/common.rs"],
  async (aliasSrc) => {
    const aliasUri = `${WS}/pf/common.rs`;
    const text = await runPrefill(
      "R",
      { [aliasUri]: aliasSrc, [SYSROOT_RESULT]: "pub enum Result<T, E> { Ok(T), Err(E) }\n" },
      {
        R: { uri: aliasUri, hover: "pub type R = Result<(), Box<dyn Error>>" },
        Result: { uri: SYSROOT_RESULT, hover: "pub enum Result<T, E> { Ok(T), Err(E) }", members: [] },
      },
    );
    assert.ok(
      /pub type R = Result<\(\), Box<dyn Error>>/.test(text),
      `the one-line alias hover is the honest whole answer for R.${dump(text)}`,
    );
    assert.ok(!/Ok\(T\)/.test(text), `no std internals in the prompt.${dump(text)}`);
  },
);
