// ADVERSARIAL REVIEW - session-v41 phase 1 (trait surface recovery).
// Fresh-context reviewer's evidence file. Every FAILING row here is a defect
// claim with its evidence; PASSING rows are attacks that did not land, kept so
// the triage agent can see what was tried.
//
// Sections:
//   V  - the A3 dispute: a logic proof that blind row A3 is unsatisfiable.
//   R  - the REAL census traits (Validate, LeaseStore, S3Downloader) fed
//        through recoverTraitSurface from their actual corpus files. These
//        carry 30 of the 53 row-hits. Skipped if the sandbox is absent.
//   P  - the phantom-field finding: the wiring comment at
//        crossFileShape.ts:938-940 claims "Fields parse to nothing off a trait
//        surface" - true for the four-word hover, FALSE for the recovered
//        surface, which now has braces. parseStructHoverFields (the same
//        parseFields the walk calls at :956 on the recovered signature) emits
//        phantom fields off multi-parameter methods, because
//        splitTopLevelCommas (:204) has no `->` guard: the return arrow's `>`
//        drives depth negative and later param-list commas split at "depth 0".
//        The walk then runs candidateTypesOf + anchorFieldType over them
//        (:998-1013); in the REAL lease_store.rs the multi-line param list
//        lines (`        lease: &Lease,`) match fieldTypeCursor's
//        line-start `name:` pattern, so the edge ANCHORS and queues a real
//        definition()/hover walk that did not exist before this phase.
//   G  - the render-gate finding, REWRITTEN post-fix to drive the PRODUCT
//        path (resolvePrefill against a vscode stub). History: the original
//        row proved the pre-fix gate (enum-only admitsEmptyShape) dropped the
//        recovered trait to "nothing renderable"; loop 2 shipped
//        isSelfDescribingDeclaration and the original row's inline copy of
//        the OLD clause became a stale re-derivation - see the ruling at the
//        section header. G1 now goes green on the fix and red on an
//        enum-only regression; G2 guards the fastbloom bar the widening
//        could have broken.
//   X  - parser/trigger attacks that did NOT land (macro_rules, nested fn-local
//        trait, byte strings, raw idents). Kept green as a record.
//
// Run: SKIP_LIVE=1 node --test test/adversarial-v41-p1.test.cjs

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "adversarial-v41-p1",
  `export { isBareTraitHover, recoverTraitSurface, parseStructHoverFields } from "../src/core/crossFileShape";\n`,
);
const { isBareTraitHover, recoverTraitSurface, parseStructHoverFields } = mod;
test.after(cleanup);

const dump = (out) => `\n  GOT:\n${out}`;
const count = (s, ch) => s.split(ch).length - 1;

const CORPUS = path.join(os.homedir(), "sandbox", "complexity-study-acme");
const real = (rel) => {
  const p = path.join(CORPUS, rel);
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : undefined;
};
const rtest = (name, rel, fn) =>
  test(name, (ctx) => {
    const src = real(rel);
    if (src === undefined) return ctx.skip(`corpus file missing: ${rel}`);
    return fn(src);
  });

// ===========================================================================
// V. THE A3 DISPUTE. Verdict: the row is SELF-CONTRADICTORY (oracle defect).
// ===========================================================================

test("V1: blind A3 is unsatisfiable - the required token `max_attempts` contains the forbidden substring `attempt`", () => {
  // A3's assertion 3 REQUIRES this regex to match the output:
  const required = /fn fetch_with_retry\(&self, path: &str, max_attempts: u32\)\s*->\s*Vec<u8>\s*;/;
  // A3's assertion 5 FORBIDS this regex from matching the output:
  const forbidden = /attempt|loop|panic!|retries exhausted|s3\.amazonaws\.com/;
  // Any string the required regex matches, the forbidden regex also matches.
  const minimal = "fn fetch_with_retry(&self, path: &str, max_attempts: u32) -> Vec<u8>;";
  assert.ok(required.test(minimal), "the minimal satisfying string for assertion 3");
  assert.ok(
    forbidden.test(minimal),
    "…and that same string trips assertion 5: `max_attempts` contains `attempt`",
  );
  // The implementation's actual output on A3's fixture is the contract-correct
  // surface (signatures only, no body token except the ones inside the
  // REQUIRED signature), and it fails only on the substring collision.
  const SRC = [
    "pub trait S3Downloader {",
    "    fn fetch(&self, path: &str) -> Vec<u8>;",
    "    fn fetch_with_retry(&self, path: &str, max_attempts: u32) -> Vec<u8> {",
    "        let mut attempt = 0;",
    "        loop {",
    "            attempt += 1;",
    "            if attempt >= max_attempts {",
    '                panic!("retries exhausted");',
    "            }",
    "        }",
    "    }",
    "",
    "    fn endpoint(&self) -> &str {",
    '        "https://s3.amazonaws.com"',
    "    }",
    "}",
    "",
  ].join("\n");
  const out = recoverTraitSurface("pub trait S3Downloader", SRC);
  assert.ok(required.test(out), `the implementation emits the required signature.${dump(out)}`);
  // TRUE body-leak checks (A3's intent, minus the colliding token) all pass:
  assert.ok(!/\battempt\b(?!s)/.test(out.replace(/max_attempts/g, "")), dump(out));
  assert.ok(!/loop|panic!|retries exhausted|s3\.amazonaws\.com/.test(out), dump(out));
  assert.equal(count(out, "{"), 1, dump(out));
});

// ===========================================================================
// R. THE REAL CENSUS TRAITS. 30 of the 53 row-hits ride these three.
// ===========================================================================

rtest("R1: Validate recovers from the real cached_schema.rs, no impl/struct/comment leak", "acme_memcache/src/cached_schema.rs", (src) => {
  const sig = "pub trait Validate";
  const out = recoverTraitSurface(sig, src);
  assert.notEqual(out, sig, `the census's biggest trait (22 hits) must recover.${dump(out)}`);
  assert.ok(/^pub trait Validate \{/.test(out), dump(out));
  assert.ok(
    /fn validate\(&self, event_value: &\[u8\]\)\s*->\s*Result<\(\), String>\s*;/.test(out),
    dump(out),
  );
  assert.ok(!/validator|size_estimate|debug_struct|deep_size|Cached/.test(out), `sibling text leaked.${dump(out)}`);
  assert.equal(count(out, "{"), 1, dump(out));
  assert.equal(count(out, "}"), 1, dump(out));
});

rtest("R2: LeaseStore recovers from the real lease_store.rs - async fns, multi-line param lists, no doc prose", "acme_distributed/src/lease_store.rs", (src) => {
  // NOTE (LOW, cosmetic, observed): a multi-line param list renders as
  // `put_lease_conditional( &self, lease: &Lease, etag: &str, )` - space after
  // the open paren and the source's trailing comma kept. Valid Rust, faithful,
  // within blind Q1's "no further formatting pinned"; regexes below tolerate it.
  const sig = "pub trait LeaseStore";
  const out = recoverTraitSurface(sig, src);
  assert.notEqual(out, sig, `LeaseStore (4 hits) must recover.${dump(out)}`);
  assert.ok(/^pub trait LeaseStore \{/.test(out), dump(out));
  for (const m of [
    /async fn get_lease\(\s*&self\s*\)\s*->\s*Result<Option<LeaseWithEtag>, LeaseStoreError>\s*;/,
    /async fn put_lease_create_only\(\s*&self, lease: &Lease,?\s*\)\s*->\s*Result<String, LeaseStoreError>\s*;/,
    /async fn put_lease_conditional\(\s*&self, lease: &Lease, etag: &str,?\s*\)\s*->\s*Result<String, LeaseStoreError>\s*;/,
    /async fn get_membership\(\s*&self\s*\)\s*->\s*Result<Option<MembershipWithEtag>, LeaseStoreError>\s*;/,
    /async fn put_membership\(\s*&self, membership: &Membership, etag: Option<&str>,?\s*\)\s*->\s*Result<\(\), LeaseStoreError>\s*;/,
  ]) {
    assert.ok(m.test(out), `${m}${dump(out)}`);
  }
  assert.ok(!/CAS protection|CreateOnly|IfMatchETag|→/.test(out), `doc prose leaked.${dump(out)}`);
  assert.ok(!/AlreadyExists|PreconditionFailed|write!/.test(out), `sibling enum/impl leaked.${dump(out)}`);
  assert.equal(count(out, "{"), 1, dump(out));
});

rtest("R3: S3Downloader recovers from the real s3_downloader.rs - no Stub impl body leak", "acme_shard/src/s3_downloader.rs", (src) => {
  const sig = "pub trait S3Downloader";
  const out = recoverTraitSurface(sig, src);
  assert.notEqual(out, sig, `S3Downloader (4 hits) must recover.${dump(out)}`);
  for (const m of [
    /async fn list_objects\(&self, prefix: &str\)\s*->\s*Result<Vec<S3ObjectRef>, S3CatchupError>\s*;/,
    /async fn download\(&self, path: &str\)\s*->\s*Result<Bytes, S3CatchupError>\s*;/,
    /async fn delete\(&self, path: &str\)\s*->\s*Result<\(\), S3CatchupError>\s*;/,
  ]) {
    assert.ok(m.test(out), `${m}${dump(out)}`);
  }
  assert.ok(!/Stub|glommio|sleep|Ok\(/.test(out), `impl body leaked.${dump(out)}`);
  assert.equal(count(out, "{"), 1, dump(out));
});

// ===========================================================================
// P. THE PHANTOM-FIELD FINDING. The walk feeds the RECOVERED signature to
// parseFields (crossFileShape.ts:956); the comment above it (:938-940) claims a
// trait surface parses to no fields. These rows assert that claim. They FAIL.
// ===========================================================================

test("P1: a recovered trait surface parses to ZERO fields (authored two-param methods)", () => {
  const src = [
    "pub trait Store {",
    "    fn get(&self, key: &str) -> Option<Payload>;",
    "    fn put(&self, key: &str, value: Payload) -> Result<Receipt, StoreError>;",
    "    fn evict(&self, key: &str, force: bool) -> bool;",
    "}",
  ].join("\n");
  const out = recoverTraitSurface("pub trait Store", src);
  assert.notEqual(out, "pub trait Store", `precondition: the trait recovers.${dump(out)}`);
  const fields = parseStructHoverFields(out);
  assert.deepEqual(
    fields,
    [],
    `the wiring's invariant ("Fields parse to nothing off a trait surface") is violated: ` +
      `phantom fields ${JSON.stringify(fields.map((f) => f.name))} come off method params ` +
      `because splitTopLevelCommas has no \`->\` guard.${dump(out)}`,
  );
});

rtest("P2: the REAL LeaseStore recovered surface parses to ZERO fields", "acme_distributed/src/lease_store.rs", (src) => {
  const out = recoverTraitSurface("pub trait LeaseStore", src);
  const fields = parseStructHoverFields(out);
  assert.deepEqual(
    fields,
    [],
    `phantom fields off the recovered LeaseStore surface: ` +
      `${JSON.stringify(fields.map((f) => ({ name: f.name, type: f.typeName.slice(0, 60) })))}`,
  );
});

rtest("P3: no phantom field of the recovered LeaseStore surface can ANCHOR in the real def file", "acme_distributed/src/lease_store.rs", (src) => {
  // fieldTypeCursor (crossFileShape.ts:536) anchors a field edge on a def-file
  // line matching `^\s*(pub )?<name>\s*:` inside the body range at the def
  // cursor. lease_store.rs writes multi-line param lists, so
  // `        lease: &Lease,` is a real line - if any phantom field name matches
  // one, the walk QUEUES a definition() walk that phase 1 newly created.
  const out = recoverTraitSurface("pub trait LeaseStore", src);
  const fields = parseStructHoverFields(out);
  const lines = src.split("\n");
  // The walk's bodyRange = structBodyLineRange(defText, defCursor) scans from
  // the TRAIT's decl line to its closing brace; restrict the anchor scan the
  // same way so a hit here is a hit the product's own anchor would take.
  const declLine = lines.findIndex((l) => /^pub trait LeaseStore\b/.test(l));
  assert.ok(declLine >= 0, "precondition: the trait decl line exists");
  let close = declLine;
  for (let depth = 0, i = declLine; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === "{") depth++;
      else if (ch === "}" && --depth === 0) {
        close = i;
      }
    }
    if (close > declLine) break;
  }
  const anchored = [];
  for (const f of fields) {
    const fieldRe = new RegExp(`^\\s*(?:pub\\s+)?${f.name}\\s*:`);
    for (let i = declLine; i <= close; i++) {
      if (fieldRe.test(lines[i])) {
        anchored.push({ field: f.name, line: i + 1, text: lines[i].trim() });
        break;
      }
    }
  }
  assert.deepEqual(
    anchored,
    [],
    `these phantom edges anchor on real def-file lines and enter the walk queue ` +
      `(new definition()/hover round-trips on the FIM-shared seam, N_MAX budget spent): ` +
      `${JSON.stringify(anchored)}`,
  );
});

// ===========================================================================
// G. THE RENDER GATE - REWRITTEN after the loop-2 fix, and the ruling on the
// dispute recorded here. The ORIGINAL G1 computed the gate's three arms with
// an INLINE COPY of the pre-fix enum-only clause. Against the pre-fix tree
// that copy was byte-identical to the product's clause and the finding was
// real (the fix confirms it). Against the FIXED tree it is a stale
// re-derivation: methods hardcoded 0, fields forced 0 by the arrow-guard fix,
// and a clause the product no longer runs - a row no product change can turn
// green. The implementer's dispute is CORRECT, and the standing rule applies
// (harness must use the product mapping). This version drives the PRODUCT
// path: resolvePrefill bundled against a vscode stub (the impl suite's
// pattern, own file names), real corpus def source. It is green on the fix
// and goes red if admitsEmptyShape regresses to enum-only, because the
// recovered surface then never reaches the prompt text.
// ===========================================================================

const esbuild = require("esbuild");
const STUB = path.join(__dirname, ".adversarial-v41-p1-vscode-stub.cjs");
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
      const files = globalThis.__ADV41P1_FILES__ || {};
      const key = keyOf(arg);
      return Promise.resolve({ uri: mkUri(key), getText: () => files[key] });
    },
  },
};
`,
);
const G_ENTRY = path.join(__dirname, ".adversarial-v41-p1-prefill.entry.ts");
const G_OUT = path.join(__dirname, ".adversarial-v41-p1-prefill.bundle.cjs");
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

const wordAt = (text, cursor) => {
  const line = (text || "").split("\n")[cursor.line] ?? "";
  const isWord = (c) => /[A-Za-z0-9_]/.test(c);
  let s = Math.min(cursor.character, line.length);
  let e = s;
  while (s > 0 && isWord(line[s - 1])) s--;
  while (e < line.length && isWord(line[e])) e++;
  return line.slice(s, e) || undefined;
};

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
    const ln = lines.findIndex((l) => new RegExp(`\\btrait[ \\t]+${t}\\b`).test(l));
    const at = ln >= 0 ? ln : lines.findIndex((l) => new RegExp(`\\b${t}\\b`).test(l));
    if (at < 0) return undefined;
    const ch = lines[at].indexOf(t);
    return { uri, range: { startLine: at, startCharacter: ch, endLine: at, endCharacter: ch + t.length } };
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
    membersOfType: async () => [],
    example: async () => undefined,
    completeMembers: async () => [],
    qualifyImport: async () => undefined,
  };
}

const gtest = (name, rel, fn) =>
  test(name, (ctx) => {
    if (gBundleErr) return ctx.skip(`prefill bundle broken: ${gBundleErr.message}`);
    const src = real(rel);
    if (src === undefined) return ctx.skip(`corpus file missing: ${rel}`);
    return fn(src);
  });

gtest("G1 (product path): resolvePrefill renders the recovered Validate surface from the REAL cached_schema.rs", "acme_memcache/src/cached_schema.rs", async (corpusSrc) => {
  const WS = "file:///work/adv41p1";
  const mainUri = `${WS}/main.rs`;
  const defUri = `${WS}/cached_schema.rs`;
  const signature = "pub fn decide(p0: Validate) -> u32";
  const src = `/// Decide the outcome.\n${signature} {\n    todo!()\n}\n`;
  const files = { [mainUri]: src, [defUri]: corpusSrc };
  const defTypes = { Validate: { uri: defUri, hover: "pub trait Validate" } };
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
  globalThis.__ADV41P1_FILES__ = files;
  let text;
  try {
    text = (await resolvePrefill(makeExtractor(files, defTypes), makeDoc(src, mainUri), record, () => {})) || "";
  } finally {
    delete globalThis.__ADV41P1_FILES__;
  }
  assert.ok(
    /pub trait Validate \{/.test(text),
    `the recovered trait head must reach the prompt through the product gate ` +
      `(red again if admitsEmptyShape regresses to enum-only).${dump(text)}`,
  );
  assert.ok(
    /fn validate\(&self, event_value: &\[u8\]\)\s*->\s*Result<\(\), String>\s*;/.test(text),
    `the census trait's method signature, from the real corpus file.${dump(text)}`,
  );
});

gtest("G2 (product path): the widened gate still refuses a private-fields struct stub (fastbloom bar)", "acme_memcache/src/cached_schema.rs", async () => {
  const WS = "file:///work/adv41p1g2";
  const mainUri = `${WS}/main.rs`;
  const defUri = `${WS}/opaque.rs`;
  const signature = "pub fn decide(p0: Opaque) -> u32";
  const src = `/// Decide the outcome.\n${signature} {\n    todo!()\n}\n`;
  // The def file must NOT declare the struct, or v39's elision recovery
  // legitimately restores the private-fields cut from source and the type
  // renders via real fields>0 (first version of this row proved exactly that
  // - a fixture artifact, not a gate hole). A comment-only def file makes the
  // elision recovery refuse, so the gate is tested pure.
  const files = { [mainUri]: src, [defUri]: "// Opaque is re-exported here; its declaration lives in another crate.\n" };
  // The fastbloom shape: a hover whose body is only the private-fields
  // comment, no members, no parseable fields. The pre-fix gate refused it and
  // the widened isSelfDescribingDeclaration must too (struct is not a
  // self-describing head).
  const defTypes = { Opaque: { uri: defUri, hover: "pub struct Opaque { /* private fields */ }" } };
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
  globalThis.__ADV41P1_FILES__ = files;
  let text;
  try {
    text = (await resolvePrefill(makeExtractor(files, defTypes), makeDoc(src, mainUri), record, () => {})) || "";
  } finally {
    delete globalThis.__ADV41P1_FILES__;
  }
  assert.ok(
    !/pub struct Opaque \{/.test(text),
    `the private-fields stub must not render as a shape block: the gate widening ` +
      `may admit self-describing heads only.${dump(text)}`,
  );
});

// ===========================================================================
// X. ATTACKS THAT DID NOT LAND. Green rows, kept as the record of what was
// tried so triage does not re-run the same hunts.
// ===========================================================================

test("X1: macro_rules! carrying `trait X {` beside the real trait refuses whole (duplicate count sees both)", () => {
  const src = [
    "macro_rules! make_validate {",
    "    () => {",
    "        pub trait Validate {",
    "            fn ghost(&self);",
    "        }",
    "    };",
    "}",
    "",
    "pub trait Validate {",
    "    fn validate(&self, v: &[u8]) -> Result<(), String>;",
    "}",
  ].join("\n");
  const sig = "pub trait Validate";
  assert.equal(recoverTraitSurface(sig, src), sig, "refusal, not a mangle - safe direction");
});

test("X2: a fn-local trait of the same name elsewhere in the file refuses whole, never merges", () => {
  const src = [
    "pub fn helper() {",
    "    trait Validate { fn ghost(&self); }",
    "}",
    "pub trait Validate {",
    "    fn validate(&self, v: &[u8]) -> Result<(), String>;",
    "}",
  ].join("\n");
  const sig = "pub trait Validate";
  const out = recoverTraitSurface(sig, src);
  assert.ok(!/ghost/.test(out), `the fn-local ghost must never reach the surface.${dump(out)}`);
  assert.equal(out, sig, "duplicate count refuses whole");
});

test("X3: byte-string braces b\"{\" in a default body close nothing", () => {
  const src = [
    "pub trait Framer {",
    "    fn frame(&self) -> Vec<u8> {",
    '        let b = b"{";',
    "        b.to_vec()",
    "    }",
    "    fn tail(&self) -> u8;",
    "}",
  ].join("\n");
  const out = recoverTraitSurface("pub trait Framer", src);
  assert.ok(/fn tail\(&self\)\s*->\s*u8\s*;/.test(out), `the method after the byte-string body survives.${dump(out)}`);
  assert.ok(!/b"|to_vec/.test(out), dump(out));
});

test("X4: a raw-ident method (`fn r#type`) refuses whole via the metavariable guard - missed recovery, not a mangle", () => {
  const src = ["pub trait Odd {", "    fn r#type(&self) -> u8;", "}"].join("\n");
  const sig = "pub trait Odd";
  assert.equal(recoverTraitSurface(sig, src), sig);
});

test("X5: trigger stays quiet for unit-struct and dyn/impl-Trait hovers (no recovery attempted for empty-membered non-traits)", () => {
  for (const h of [
    "pub struct StubS3Downloader",
    "pub struct Scraper",
    "dyn Validate",
    "impl Validate",
    "pub fn spawn() -> impl Future<Output = ()>",
  ]) {
    assert.equal(isBareTraitHover(h), false, `${JSON.stringify(h)} must not trigger`);
  }
});

test("X7: the arrow guard opens no new hole - shifts (>>), fn-pointer arrows, nested Fn params all still split struct fields correctly", () => {
  for (const [sig, expected] of [
    // The fix's own target shape: an -> arrow before a later field comma.
    ["pub struct A {\n    f: Box<dyn Fn(u8) -> u16>,\n    g: u32,\n}", ["f", "g"]],
    // >> close-close: both `>` must still decrement (no over-greedy guard).
    ["pub struct B {\n    m: HashMap<u32, Vec<u64>>,\n    n: bool,\n}", ["m", "n"]],
    // fn-pointer arrow with a tuple return carrying its own comma.
    ["pub struct C {\n    p: PhantomData<fn() -> (u8, u16)>,\n    q: i8,\n}", ["p", "q"]],
    // Two arrows in one field type.
    ["pub struct D {\n    cmp: fn(&u8) -> fn(&u8) -> bool,\n    next: Option<u8>,\n}", ["cmp", "next"]],
    // A default-type-param `=` directly before `>` (the guard also skips `=>`;
    // `= u8>` has `8` before `>`, so this closes normally).
    ["pub struct E {\n    h: Wrapper<u8>,\n    k: u16,\n}", ["h", "k"]],
  ]) {
    const names = parseStructHoverFields(sig).map((f) => f.name);
    assert.deepEqual(names, expected, `${sig}\n  parsed: ${JSON.stringify(names)}`);
  }
});

test("X6: an assoc const whose default is a string with a brace renders as declared, braces in the LITERAL do not split items", () => {
  const src = [
    "pub trait Templated {",
    '    const OPEN: &\'static str = "{";',
    "    fn render(&self) -> String;",
    "}",
  ].join("\n");
  const out = recoverTraitSurface("pub trait Templated", src);
  // Either faithful render (const + fn) or whole refusal is acceptable; a
  // surface with the const but MISSING `render` would mean the literal's brace
  // split the item list - that is the mangle this row hunts.
  if (out === "pub trait Templated") return;
  assert.ok(/fn render\(&self\)\s*->\s*String\s*;/.test(out), `render dropped: literal brace mangled the split.${dump(out)}`);
  assert.ok(/const OPEN/.test(out), dump(out));
});
