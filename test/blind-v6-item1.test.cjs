// BLIND ORACLE — v6 P4 item 1: per-class surface shape.
//
// Black-box contract test for the SHIPPED `resolveSurfaceInjection`
// (src/vscode/oracleSurface.ts) against SURFACE-p4-item1.md. Written WITHOUT
// reading the resolveSurfaceInjection body — only the surface spec and the
// impl9-injection reference pattern for headless bundling.
//
// The contract splits the surface shape BY hallucination class:
//   - unresolved-method (wrong method NAME)  -> MEMBER SIGNATURES first,
//                                               example only as fallback.
//   - unresolved-assoc  (wrong constructor)  -> worked EXAMPLE first (UNCHANGED),
//                                               signatures only as fallback.
//   - other classes (unresolved-crate, ...)  -> UNCHANGED.
//
// classifyHallucination (imported, called empirically — NOT assumed) confirms
// which E0599 wording maps to which kind, so the bars target the right class.
//
// Run: SKIP_LIVE=1 node --test test/blind-v6-item1.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");

// ---- Bundle exactly as impl9-injection.test.cjs does: minimal vscode stub +
// esbuild alias, then require the CJS bundle. Also bundle classifyHallucination
// so the E0599-wording -> class mapping is verified empirically, not assumed.
const STUB = path.join(__dirname, ".blind-v6-item1-vscode-stub.cjs");
fs.writeFileSync(
  STUB,
  `class Position { constructor(line, character) { this.line = line; this.character = character; } }
class Range { constructor(a, b) { this.start = a; this.end = b; } }
module.exports = { Position, Range, languages: {}, window: {}, workspace: {}, ThemeColor: class {}, MarkdownString: class {} };\n`
);
const entry = path.join(__dirname, ".blind-v6-item1.entry.ts");
const outfile = path.join(__dirname, ".blind-v6-item1.bundle.cjs");
fs.writeFileSync(
  entry,
  `export { resolveSurfaceInjection } from "../src/vscode/oracleSurface";
export { classifyHallucination } from "../src/core/compilerDirected";\n`
);
esbuild.buildSync({ entryPoints: [entry], bundle: true, outfile, format: "cjs", platform: "node", alias: { vscode: STUB } });
const { resolveSurfaceInjection, classifyHallucination } = require(outfile);
test.after(() => [STUB, entry, outfile].forEach((f) => fs.rmSync(f, { force: true })));

// A document over a text string with the offset math the glue uses (from impl9).
function makeDoc(text, uriStr) {
  const lines = text.split("\n");
  const offsetAt = (pos) => {
    let o = 0;
    for (let i = 0; i < pos.line; i++) o += lines[i].length + 1;
    return o + pos.character;
  };
  const positionAt = (off) => {
    let o = 0;
    for (let l = 0; l < lines.length; l++) {
      if (off <= o + lines[l].length) return { line: l, character: off - o };
      o += lines[l].length + 1;
    }
    return { line: lines.length - 1, character: 0 };
  };
  return { uri: { toString: () => uriStr }, offsetAt, positionAt, getText: (r) => text.slice(offsetAt(r.start), offsetAt(r.end)) };
}

const diag = (code, message, span) => ({
  kind: "compile-error", level: "error", code, message,
  spans: [{ fileName: "src/main.rs", byteStart: 0, byteEnd: 0, lineStart: span.line + 1, lineEnd: span.line + 1, columnStart: span.character + 1, columnEnd: span.character + 3, isPrimary: true }],
  suggestions: [],
});

// The two E0599 messages the bars ride. Verified empirically below before use.
const METHOD_MISS_MSG = "no method named `count` found for struct `CohortRegister` in the current scope";
const ASSOC_MISS_MSG = "no associated function or constant named `new` found for struct `BloomFilter<S>` in the current scope";

// Members shaped like renderMemberSignatures consumes: it emits only members
// whose `signature` is defined, joined by newlines (see extraction.ts).
const METHOD_MEMBERS = [
  { name: "tally_cohort", signature: "tally_cohort(&self, u32) -> usize", kind: "method" },
  { name: "len", signature: "len(&self) -> usize", kind: "method" },
];
const BUILDER_MEMBERS = [
  { name: "with_num_bits", signature: "with_num_bits(u64) -> BloomFilterBuilder", kind: "function" },
];

const SIGNATURES_MARK = "API surface for";
const EXAMPLE_MARK = "Usage example for";
const FIRM_MARK = /Call ONLY methods and constructors/;

// ---- Empirical classifier check: prove the wording -> class map the bars rely
// on, so a bar that "passes" is testing the class it claims to. Do NOT assume.
test("classifier: E0599 wording maps to the class each bar targets (empirical)", () => {
  const m = classifyHallucination(diag("E0599", METHOD_MISS_MSG, { line: 0, character: 0 }));
  assert.strictEqual(m && m.kind, "unresolved-method", `method-miss wording must classify to unresolved-method (got ${m && m.kind})`);
  const a = classifyHallucination(diag("E0599", ASSOC_MISS_MSG, { line: 0, character: 0 }));
  assert.strictEqual(a && a.kind, "unresolved-assoc", `assoc-miss wording must classify to unresolved-assoc (got ${a && a.kind})`);
});

// ---- Bar 1: method miss + members present -> SIGNATURES form (NOT example).
// RED on current example-first code: it returns the example instead.
test("bar1: method miss with real members yields the SIGNATURES form, not the example", async () => {
  const calls = { example: 0, members: 0 };
  const extractor = {
    example: async () => { calls.example++; return "let r = CohortRegister::new(); assert_eq!(r.tally_cohort(7), 1);"; },
    completeMembers: async () => { calls.members++; return METHOD_MEMBERS; },
  };
  const out = await resolveSurfaceInjection(extractor, makeDoc("fn f() {}", "file:///x/main.rs"), [
    diag("E0599", METHOD_MISS_MSG, { line: 0, character: 4 }),
  ], () => {});
  assert.ok(out, "a payload is produced");
  assert.ok(out.includes(SIGNATURES_MARK), `expected the SIGNATURES form; got: ${out}`);
  assert.ok(out.includes("tally_cohort(&self, u32) -> usize"), "the real member signature is present");
  assert.ok(!out.includes(EXAMPLE_MARK), "the example form must NOT be used for a method miss");
  assert.ok(!out.includes("assert_eq!"), "the example body must not be the payload");
  assert.match(out, FIRM_MARK, "the firm instruction rides the payload");
});

// ---- Bar 2: method miss + no members -> EXAMPLE fallback (never empty).
// Already GREEN on current example-first code.
test("bar2: method miss with no members falls back to the EXAMPLE form (never empty)", async () => {
  const extractor = {
    example: async () => "let r = CohortRegister::new();",
    completeMembers: async () => [],
  };
  const out = await resolveSurfaceInjection(extractor, makeDoc("fn f() {}", "file:///x"), [
    diag("E0599", METHOD_MISS_MSG, { line: 0, character: 0 }),
  ], () => {});
  assert.ok(out, "a payload is produced (graceful degrade, never empty when some surface exists)");
  assert.ok(out.includes(EXAMPLE_MARK), `expected the EXAMPLE fallback; got: ${out}`);
  assert.ok(out.includes("CohortRegister::new()"), "the example body is the payload");
  assert.match(out, FIRM_MARK, "the firm instruction rides the payload");
});

// ---- Bar 3: constructor miss + example present -> EXAMPLE form (UNCHANGED).
// The fastbloom builder case; must not regress. Already GREEN.
test("bar3: constructor miss with a builder example yields the EXAMPLE form (unchanged)", async () => {
  const calls = { example: 0, members: 0 };
  const extractor = {
    example: async () => { calls.example++; return "let f = fastbloom::BloomFilter::with_num_bits(1024).expected_items(100);"; },
    completeMembers: async () => { calls.members++; return BUILDER_MEMBERS; },
  };
  const out = await resolveSurfaceInjection(extractor, makeDoc("fn f() {}", "file:///x"), [
    diag("E0599", ASSOC_MISS_MSG, { line: 0, character: 0 }),
  ], () => {});
  assert.ok(out, "a payload is produced");
  assert.ok(out.includes(EXAMPLE_MARK), `expected the EXAMPLE form for a constructor miss; got: ${out}`);
  assert.ok(out.includes("with_num_bits(1024)"), "the builder example body is the payload");
  assert.ok(!out.includes(SIGNATURES_MARK), "signatures must NOT be used when a builder example resolves");
  assert.match(out, FIRM_MARK, "the firm instruction rides the payload");
});

// ---- Bar 4: constructor miss + no example -> SIGNATURES fallback.
// Already GREEN (example-else-signatures with no example).
test("bar4: constructor miss with no example falls back to the SIGNATURES form", async () => {
  const extractor = {
    example: async () => undefined,
    completeMembers: async () => BUILDER_MEMBERS,
  };
  const out = await resolveSurfaceInjection(extractor, makeDoc("fn f() {}", "file:///x"), [
    diag("E0599", ASSOC_MISS_MSG, { line: 0, character: 0 }),
  ], () => {});
  assert.ok(out, "a payload is produced (graceful degrade)");
  assert.ok(out.includes(SIGNATURES_MARK), `expected the SIGNATURES fallback; got: ${out}`);
  assert.ok(out.includes("with_num_bits(u64) -> BloomFilterBuilder"), "the member signature is the payload");
  assert.ok(!out.includes(EXAMPLE_MARK), "no example form when no example resolves");
});

// ---- Bar 5: an unrelated class still routes to its existing payload (no
// collateral change from the method/assoc split). unresolved-crate + a catalog
// block returns the catalog sentinel verbatim, exactly as impl9 asserts.
test("bar5: an unresolved-crate diagnostic still returns its catalog payload (no collateral change)", async () => {
  const extractor = {
    example: async () => { throw new Error("not for a crate class"); },
    completeMembers: async () => { throw new Error("not for a crate class"); },
  };
  const out = await resolveSurfaceInjection(
    extractor,
    makeDoc("fn f() {}", "file:///x"),
    [diag("E0433", "cannot find module or crate `aws_sdk_s3` in this scope", { line: 0, character: 0 })],
    () => {},
    "CATALOG_BLOCK_SENTINEL",
  );
  assert.strictEqual(out, "CATALOG_BLOCK_SENTINEL", "the catalog is still the payload for a missing crate");
});
