// ADVERSARIAL REVIEW - session-v41 phase 3 (the example gate).
// Same rules as adversarial-v41-p1/p2: FAILING rows are defect claims with
// their evidence; PASSING rows are attacks that did not land, kept as the
// record so triage does not re-run the hunts.
//
// Sections:
//   CN - census truth: the 7 junk example blocks in the v41 census2 results
//        (real corpus rows), each fed to the shipped predicate. Skipped when
//        the artifact is absent.
//   M  - the matcher (exampleNamesItsType), including the RULING the
//        coordinator asked for on comment-only mentions.
//   E  - the enclosing-impl refusal (prioritizedTypes + the brace-balance
//        enclosure check), on the REAL corpus files the census junk blocks
//        came from, and on authored miscount traps.
//        E4 is a finding: the enclosure check counts RAW braces
//        (fnGen.ts ~1510-1517), so a brace inside a STRING LITERAL in a
//        closed sibling impl inflates the balance and the sibling is judged
//        enclosing; its generic params are then refused as candidates, and a
//        real local type sharing a param's name (the frozen blind-v7 P3
//        shape, `pub struct T`) is evicted from the candidate list.
//        E5 is a finding: the check keys on the LAST `impl<` header before
//        the fn (fnGen.ts ~1487-1488), so a closed `impl<U>` inside an
//        EARLIER method's body shadows the real enclosing impl and its
//        params escape refusal - the wasted candidate slot the refusal
//        exists to free.
//
// Run: SKIP_LIVE=1 node --test test/adversarial-v41-p3.test.cjs

// THE MEASUREMENT RIG LIVES IN A DIFFERENT REPOSITORY (2026-08-10). It and the
// session archives were split into a private repo because they carry corpora
// taken against private client code and cannot be published, so a public clone
// has no `session-complxity-research/` and the rows below have no subject.
//
// The whole file skips, with the reason on the channel. It SKIPS rather than
// passing vacuously: a row that goes green when the thing it tests is absent is
// the false green this suite exists to prevent. Where a baseline can be
// vendored instead, vendor it (see test/fixtures/prompt) and do not use this.
const { RIG_PRESENT, SKIP_REASON } = require("./.rig-present.cjs");
if (!RIG_PRESENT) {
  require("node:test")("rig-dependent rows", { skip: SKIP_REASON }, () => {});
  return;
}

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const esbuild = require("esbuild");
const { bundleCore } = require("./.blind-util.cjs");

const { mod: coreMod, cleanup: coreCleanup } = bundleCore(
  "adversarial-v41-p3-core",
  `export { exampleNamesItsType } from "../src/core/extraction";\n`,
);
const { exampleNamesItsType } = coreMod;
test.after(coreCleanup);

const CORPUS = path.join(os.homedir(), "sandbox", "complexity-study-acme");
const realFile = (rel) => {
  const p = path.join(CORPUS, rel);
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : undefined;
};
const CENSUS = path.join(__dirname, "..", "session-complxity-research", "data", "results-v41-census2.json");

// ===========================================================================
// CN. The census's own junk blocks, through the shipped predicate.
// ===========================================================================

test("CN1: all 7 junk example blocks in results-v41-census2.json refuse under the shipped predicate", (ctx) => {
  if (!fs.existsSync(CENSUS)) return ctx.skip("census artifact missing");
  const rows = Object.values(JSON.parse(fs.readFileSync(CENSUS, "utf8")));
  const blocks = [];
  for (const r of rows) {
    const surf = String(r.injectedSurface || "");
    for (const m of surf.matchAll(
      /Usage example for `([^`]+)` \(from its docs, this compiles\):\n```rust\n([\s\S]*?)\n```/g,
    )) {
      blocks.push({ id: r.id, type: m[1], code: m[2] });
    }
  }
  assert.equal(blocks.length, 7, `census2 carries 7 example blocks; found ${blocks.length}`);
  const kept = blocks.filter((b) => exampleNamesItsType(b.type, b.code));
  assert.deepEqual(
    kept.map((b) => `${b.id} ${b.type}`),
    [],
    "every census junk block must refuse - one kept means the gate misses a measured lie",
  );
});

// ===========================================================================
// M. THE MATCHER.
// ===========================================================================

test("M1: constructor-chain and macro-wrapped mentions KEEP (no false refusal)", () => {
  assert.equal(exampleNamesItsType("Widget", "let w = Widget::new();\nw.grow(3);"), true);
  assert.equal(exampleNamesItsType("Widget", "let v = vec![Widget::default()];"), true);
  assert.equal(exampleNamesItsType("Widget", "let w: cache::Widget = make();"), true, "path-qualified mention in code");
});

test("M2: word-boundary and case: Client is not HttpClient, not Client_v2, not client", () => {
  assert.equal(exampleNamesItsType("Client", "let c = HttpClient::new();"), false);
  assert.equal(exampleNamesItsType("Client", "let c = Client_v2::new();"), false);
  assert.equal(exampleNamesItsType("Client", "let client = connect();"), false);
});

test("M3: RULING - a type named ONLY in the example's own comment KEEPS (implementer's choice, upheld with a caveat)", () => {
  // Upheld: the 40-of-49 sizing was taken under the census's TEXTUAL
  // predicate (goal: "spike-2's printed 38 used a substring check...the
  // oracles state the word-boundary predicate"), and the gate must speak the
  // same predicate or its kill-count attribution (three-point census, one
  // list) breaks. A comment-only mention leaves a residual lie-sliver in
  // "this compiles" - that is item 37's surviving sliver per decision rule 3,
  // a re-headering question, NOT a matcher question. Flagged, not failed.
  assert.equal(
    exampleNamesItsType("Widget", "// Widget is configured elsewhere\nlet x = make();"),
    true,
  );
});

test("M4: heads the predicate cannot read refuse - the safe direction", () => {
  assert.equal(exampleNamesItsType("Größe", "let g = Größe::new();"), false, "non-ASCII ident: refuse, documented");
  assert.equal(exampleNamesItsType("", "let x = 1;"), false);
  assert.equal(exampleNamesItsType("(A, B)", "let x = 1;"), false);
});

test("M5: r# raw-ident heads match either spelling; generics strip to the head", () => {
  assert.equal(exampleNamesItsType("r#type", "let t = r#type::new();"), true);
  assert.equal(exampleNamesItsType("Vec<ShardCache>", "let v: Vec<u8> = Vec::new();"), true, "Vec<T> head reduces to Vec");
  assert.equal(exampleNamesItsType("cache::ShardCache<V>", "let c = ShardCache::new();"), true);
});

// ===========================================================================
// Harness for prioritizedTypes (fnGen, vscode stub bundle).
// ===========================================================================

const STUB = path.join(__dirname, ".adversarial-v41-p3-vscode-stub.cjs");
fs.writeFileSync(
  STUB,
  `
class Position { constructor(l, c) { this.line = l; this.character = c; } }
class Range {
  constructor(a, b, c, d) {
    if (typeof a === "number") { this.start = new Position(a, b); this.end = new Position(c, d); }
    else { this.start = a; this.end = b; }
  }
}
class Selection extends Range {}
const mkUri = (s) => ({ toString: () => String(s), fsPath: String(s), path: String(s) });
module.exports = {
  Position, Range, Selection, WorkspaceEdit: class {},
  EventEmitter: class { constructor(){ this.event=()=>({dispose(){}}); } fire(){} dispose(){} },
  ThemeColor: class {}, MarkdownString: class {},
  Uri: { parse: mkUri, file: mkUri },
  SymbolKind: {}, ProgressLocation: {}, EndOfLine: { LF:1, CRLF:2 },
  languages: {}, window: {}, commands: { executeCommand: async () => undefined },
  workspace: { getConfiguration: () => ({ get: (k, f) => f }), openTextDocument: async () => ({ getText: () => "" }) },
};
`,
);
const ENTRY = path.join(__dirname, ".adversarial-v41-p3-fngen.entry.ts");
const OUT = path.join(__dirname, ".adversarial-v41-p3-fngen.bundle.cjs");
let prioritizedTypes;
let bundleErr;
try {
  fs.writeFileSync(ENTRY, `export { prioritizedTypes } from "../src/vscode/fnGen";\n`);
  esbuild.buildSync({ entryPoints: [ENTRY], bundle: true, outfile: OUT, format: "cjs", platform: "node", alias: { vscode: STUB } });
  ({ prioritizedTypes } = require(OUT));
} catch (e) {
  bundleErr = e;
}
test.after(() => [STUB, ENTRY, OUT].forEach((f) => fs.rmSync(f, { force: true })));

const ptest = (name, fn) =>
  test(name, (ctx) => {
    if (bundleErr) return ctx.skip(`fnGen bundle broken: ${bundleErr.message}`);
    if (typeof prioritizedTypes !== "function") return ctx.skip("prioritizedTypes not exported");
    return fn(ctx);
  });

// ===========================================================================
// E. THE ENCLOSURE CHECK.
// ===========================================================================

ptest("E1: REAL shard_mem_cache.rs - the enclosing impl's V is refused at the candidate leg (the census V junk block's root)", (ctx) => {
  const src = realFile("acme_memcache/src/shard_mem_cache.rs");
  if (src === undefined) return ctx.skip("corpus file missing");
  const signature = "pub fn schema_cache_insert(&mut self, key: SchemaKey, value: CachedSchema<V>)";
  assert.ok(src.includes(signature), "precondition: the real signature is present");
  const out = prioritizedTypes(signature, undefined, src, new Set());
  assert.ok(!out.includes("V"), `V is the enclosing impl's parameter and must be refused; got ${JSON.stringify(out)}`);
  assert.ok(out.includes("SchemaKey"), `real param types survive; got ${JSON.stringify(out)}`);
  assert.ok(out.includes("CachedSchema"), `real param types survive; got ${JSON.stringify(out)}`);
});

ptest("E2: REAL shard_wal.rs - open()'s R and D (enclosing impl params) are refused (the census D junk block's root)", (ctx) => {
  const src = realFile("acme_shard/src/shard_wal.rs");
  if (src === undefined) return ctx.skip("corpus file missing");
  const signature =
    "pub async fn open(config: InternalShardConfig, node_status: ValidatedNodeStatus, replication_client: R, s3_downloader: D) -> Result<Self, ReadyUpError>";
  assert.ok(src.includes(signature), "precondition: the real signature is present");
  const out = prioritizedTypes(signature, undefined, src, new Set());
  assert.ok(!out.includes("R"), `R is the enclosing impl's parameter; got ${JSON.stringify(out)}`);
  assert.ok(!out.includes("D"), `D is the enclosing impl's parameter; got ${JSON.stringify(out)}`);
  assert.ok(out.includes("InternalShardConfig"), `real param types survive; got ${JSON.stringify(out)}`);
});

ptest("E3: a CLOSED sibling impl<T> before a free fn does not refuse T - the blind-v7 P3 local struct survives", () => {
  const src = [
    "pub struct T;",
    "",
    "pub struct Other;",
    "impl<T> Holder<T> {",
    "    pub fn a(&self) {}",
    "}",
    "",
    "pub fn go(x: T) -> u32 {",
    "    todo!()",
    "}",
    "",
  ].join("\n");
  const signature = "pub fn go(x: T) -> u32";
  const out = prioritizedTypes(signature, undefined, src, new Set(["T", "Other"]));
  assert.ok(
    out.includes("T"),
    `the sibling impl closed before the fn; refusing T here evicts a real local type (blind-v7 P3's pin). got ${JSON.stringify(out)}`,
  );
});

ptest("E4: a string-literal brace inside the closed sibling impl must not flip it to 'enclosing' (raw brace count)", () => {
  // Identical to E3 plus one line: the sibling's method body contains a "{"
  // string literal. The enclosure check counts raw braces between the
  // header's `>` and the fn, so the literal inflates the balance to 1 and the
  // CLOSED sibling reads as enclosing; T - a real local struct, the frozen
  // blind-v7 P3 shape - is then refused at the candidate leg.
  const src = [
    "pub struct T;",
    "",
    "impl<T> Holder<T> {",
    "    pub fn a(&self) -> String {",
    '        let open = "{";',
    "        open.to_string()",
    "    }",
    "}",
    "",
    "pub fn go(x: T) -> u32 {",
    "    todo!()",
    "}",
    "",
  ].join("\n");
  const signature = "pub fn go(x: T) -> u32";
  const out = prioritizedTypes(signature, undefined, src, new Set(["T"]));
  assert.ok(
    out.includes("T"),
    `the sibling impl is CLOSED; a "{" inside its string literal miscounted the balance and its ` +
      `params were refused against a fn outside its scope. got ${JSON.stringify(out)}`,
  );
});

ptest("E5: a closed impl<U> inside an EARLIER method's body must not shadow the real enclosing impl<V>", () => {
  // The check takes the LAST `impl<` header before the fn. The inner impl is
  // closed, so its balance reads non-enclosing and the function returns the
  // EMPTY set - the real enclosing impl's V escapes refusal and spends the
  // candidate slot the refusal exists to free.
  const src = [
    "pub struct Outer<V> {",
    "    v: V,",
    "}",
    "impl<V> Outer<V> {",
    "    pub fn earlier(&self) {",
    "        struct Local;",
    "        impl<U> From<U> for Local {",
    "            fn from(_: U) -> Local { Local }",
    "        }",
    "    }",
    "    pub fn target(&self, extra: V, cfg: RealCfg) -> u32 {",
    "        todo!()",
    "    }",
    "}",
    "",
  ].join("\n");
  const signature = "pub fn target(&self, extra: V, cfg: RealCfg) -> u32";
  const out = prioritizedTypes(signature, undefined, src, new Set());
  assert.ok(
    !out.includes("V"),
    `V is the enclosing impl's parameter; the closed inner impl<U> shadowed the header scan and V ` +
      `leaked into the candidates. got ${JSON.stringify(out)}`,
  );
  assert.ok(out.includes("RealCfg"), `the real type still survives. got ${JSON.stringify(out)}`);
});
