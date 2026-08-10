// BLIND ORACLE - v7 phase 4: FIM whole-block injection (the types-in-play struct
// GRAPH injected into the FIM prefix as a comment block). Black-box contract test
// against the settled surface ONLY:
//   - src/core/fimWholeBlock.ts  (wholeBlockSite, renderWholeBlockInjection,
//                                  createInjectionCache) - all currently throwing
//                                  stubs, so this file is RED by contract.
//   - src/core/completionService.ts (the 50ms INJECTION_DEADLINE_MS degrade bar).
// Never reads an impl body; the fakes model StructResolution / methodsOf directly,
// exactly like the blind-v6-item3-walk / blind-v7-prepare graph fakes.
//
// Robustness: every fake struct def carries a unique sentinel `<<DEF Name>>`, so
// "which struct defs were rendered" is read straight out of the block regardless
// of how the implementer renders it, and a type-name that only appears as a FIELD
// type (e.g. `customer: Customer`) is not mistaken for that type's def being out.
//
// Run: SKIP_LIVE=1 node --test test/blind-v7-fim-wholeblock.test.cjs
// Expected: RED - the fimWholeBlock stubs throw "not implemented".

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore, sleep } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "blind-v7-fim-wholeblock",
  `export { wholeBlockSite, renderWholeBlockInjection, createInjectionCache } from "../src/core/fimWholeBlock";
export { CompletionService } from "../src/core/completionService";\n`,
);
const { wholeBlockSite, renderWholeBlockInjection, createInjectionCache, CompletionService } = mod;
test.after(cleanup);

// ---- The 2-D walk bounds (from dataShape WalkBounds). Generous by default; the
// N_MAX-tightened variant is used only to prove the render respects the bound.
const BOUNDS = { D_MAX: 3, B_MAX: 6, N_MAX: 8, TOK_MAX: 2000 };
const BIG_TOKEN_BUDGET = 4000; // chars/4 - deliberately non-binding in shape tests

// ===========================================================================
// 1. wholeBlockSite detection.
// ===========================================================================

// A prefix whose cursor sits inside an EMPTY (whitespace-only) function body,
// over a cross-file signature naming a PascalCase type.
const EMPTY_BODY_PREFIX =
  "use crate::model::Order;\n\npub fn top_order_value(orders: &[Order]) -> u64 {\n    ";

test("wholeBlockSite: cursor in an empty body over a cross-file signature returns the signature + its types-in-play", () => {
  const site = wholeBlockSite(EMPTY_BODY_PREFIX);
  assert.ok(site, "an empty-body site resolves (not undefined)");
  assert.ok(Array.isArray(site.types), "types is an array");
  assert.ok(site.types.includes("Order"), `Order is a type-in-play; got ${JSON.stringify(site.types)}`);
  assert.strictEqual(typeof site.signature, "string", "signature is the enclosing fn signature string");
  assert.match(site.signature, /top_order_value/, "the signature is the enclosing fn's");
});

test("wholeBlockSite: a cursor MID-EXPRESSION (body already has content) is NOT a whole-block site", () => {
  const midExpr =
    "pub fn top_order_value(orders: &[Order]) -> u64 {\n    orders.iter().";
  assert.strictEqual(
    wholeBlockSite(midExpr),
    undefined,
    "a non-empty body (real content after `{`) returns undefined",
  );
});

test("wholeBlockSite: no enclosing fn returns undefined", () => {
  const noFn = "let orders: Vec<Order> = vec![];\n    ";
  assert.strictEqual(wholeBlockSite(noFn), undefined, "no enclosing fn signature => undefined");
});

test("wholeBlockSite: an enclosing fn naming NO PascalCase type returns undefined", () => {
  const noTypes = "fn f(x: u64) -> u64 {\n    ";
  assert.strictEqual(
    wholeBlockSite(noTypes),
    undefined,
    "a signature whose only types are std/primitive (u64) is not a whole-block site",
  );
});

test("wholeBlockSite: a multi-type signature dedups the type set, excludes std (Vec), and is the SIGNATURE's types not a file-wide scrape", () => {
  // `Decoy` is a PascalCase type named ELSEWHERE in the file (an unrelated fn),
  // never in the enclosing signature - it must NOT leak into types-in-play.
  const prefix =
    "struct Decoy {}\nfn helper(d: Decoy) {}\n\n" +
    "pub fn codes_within(tiles: &[Tile], bound: &Tile) -> Vec<u64> {\n    ";
  const site = wholeBlockSite(prefix);
  assert.ok(site, "the whole-block site resolves");
  assert.ok(site.types.includes("Tile"), `Tile is a type-in-play; got ${JSON.stringify(site.types)}`);
  // Deduped: Tile appears twice in the signature (two params) but once in the set.
  assert.strictEqual(
    site.types.filter((t) => t === "Tile").length,
    1,
    `Tile is deduped to a single entry; got ${JSON.stringify(site.types)}`,
  );
  // Vec<u64> is std - NOT a type-in-play to derive.
  assert.ok(!site.types.includes("Vec"), `Vec is std, not a type-in-play; got ${JSON.stringify(site.types)}`);
  // The set is the SIGNATURE's types, not a file-wide PascalCase scrape.
  assert.ok(
    !site.types.includes("Decoy"),
    `Decoy is named elsewhere in the file, never in the enclosing signature - must not leak; got ${JSON.stringify(site.types)}`,
  );
});

// ===========================================================================
// 2. renderWholeBlockInjection over a HAND-BUILT resolveStruct + methodsOf.
//    A small Order -> Customer struct graph, modelled as StructResolution.
// ===========================================================================

// A struct def carries a unique `<<DEF Name>>` sentinel so "was THIS type's def
// rendered" is readable regardless of the type appearing as a field elsewhere.
const defOf = (name, body) => `<<DEF ${name}>> pub struct ${name} { ${body} }`;
const localField = (fieldName, typeName) => ({ name: fieldName, typeName, isLocal: true });
const primField = (fieldName, typeName) => ({ name: fieldName, typeName, isLocal: false });

// Order { id: u64, customer: Customer }, Customer { name: String }.
function orderCustomerGraph() {
  const map = new Map([
    ["Order", { def: defOf("Order", "id: u64, customer: Customer"), fields: [primField("id", "u64"), localField("customer", "Customer")] }],
    ["Customer", { def: defOf("Customer", "name: String"), fields: [primField("name", "String")] }],
  ]);
  const methods = new Map([
    ["Order", ["pub fn total_value(&self) -> u64", "pub fn primary_customer(&self) -> &Customer"]],
    ["Customer", ["pub fn display_name(&self) -> String"]],
  ]);
  const asked = { struct: [], methods: [] };
  const resolveStruct = (t) => { asked.struct.push(t); return map.get(t); };
  const methodsOf = (t) => { asked.methods.push(t); return methods.get(t) ?? []; };
  return { resolveStruct, methodsOf, asked };
}

// Every DEF sentinel in the block, in order.
const renderedDefs = (block) => [...(block || "").matchAll(/<<DEF (\w+)>>/g)].map((m) => m[1]);
const nonEmptyLines = (block) => block.split("\n").filter((l) => l.trim() !== "");

test("renderWholeBlockInjection: the output is a COMMENT block - every non-empty line starts with //", () => {
  const g = orderCustomerGraph();
  const block = renderWholeBlockInjection(["Order"], g.resolveStruct, g.methodsOf, BOUNDS, BIG_TOKEN_BUDGET);
  assert.ok(block, "a resolvable root renders a block (not undefined)");
  for (const line of nonEmptyLines(block)) {
    assert.ok(line.startsWith("//"), `every non-empty line is a comment; offending line: ${JSON.stringify(line)}`);
  }
});

test("renderWholeBlockInjection: carries the reachable struct defs (field names) AND the root's method signatures", () => {
  const g = orderCustomerGraph();
  const block = renderWholeBlockInjection(["Order"], g.resolveStruct, g.methodsOf, BOUNDS, BIG_TOKEN_BUDGET);
  assert.ok(block);
  const defs = renderedDefs(block);
  // The root and its reachable nested local type both have their defs rendered.
  assert.ok(defs.includes("Order"), `Order's def rendered; got ${JSON.stringify(defs)}`);
  assert.ok(defs.includes("Customer"), `the reachable nested Customer def rendered; got ${JSON.stringify(defs)}`);
  // Struct-def field text is present (the data-shape, not just names).
  assert.match(block, /customer/, "Order's field `customer` present");
  assert.match(block, /name/, "Customer's field `name` present");
  // The root's method signatures ride the block (from methodsOf).
  assert.match(block, /total_value/, "root method total_value present");
  assert.match(block, /primary_customer/, "root method primary_customer present");
});

test("renderWholeBlockInjection: BOUNDED - a tiny N_MAX drops reachable types (never emits past the cap)", () => {
  const g = orderCustomerGraph();
  const tight = { ...BOUNDS, N_MAX: 1 };
  const block = renderWholeBlockInjection(["Order"], g.resolveStruct, g.methodsOf, tight, BIG_TOKEN_BUDGET);
  assert.ok(block, "still renders the root within the cap");
  const defs = renderedDefs(block);
  assert.ok(defs.length <= 1, `N_MAX=1 caps rendered defs at 1; got ${JSON.stringify(defs)}`);
  assert.ok(defs.includes("Order"), "the root survives the cap");
  assert.ok(
    !block.includes("<<DEF Customer>>"),
    "Customer's DEF is dropped by N_MAX=1 (it may still appear as Order's field type, but not as an emitted def)",
  );
});

test("renderWholeBlockInjection: no INVENTION - only defs that exist in the fake graph appear", () => {
  const g = orderCustomerGraph();
  const block = renderWholeBlockInjection(["Order"], g.resolveStruct, g.methodsOf, BOUNDS, BIG_TOKEN_BUDGET);
  assert.ok(block);
  const defs = new Set(renderedDefs(block));
  for (const d of defs) {
    assert.ok(["Order", "Customer"].includes(d), `rendered def \`${d}\` is not in the fake graph - invention`);
  }
});

test("renderWholeBlockInjection: undefined when resolveStruct returns undefined for every root (honest degrade)", () => {
  const resolveStruct = () => undefined;
  const methodsOf = () => [];
  const block = renderWholeBlockInjection(["Order", "Customer"], resolveStruct, methodsOf, BOUNDS, BIG_TOKEN_BUDGET);
  assert.strictEqual(block, undefined, "nothing resolves => undefined (degrade to plain FIM)");
});

// ===========================================================================
// 3. createInjectionCache - per-(uri, version) cache; a newer version invalidates.
// ===========================================================================

test("createInjectionCache: get returns the block only for the exact (uri, version); a version bump drops the old entry; uris are independent", () => {
  const cache = createInjectionCache();
  const A = "file:///a.rs";
  const B = "file:///b.rs";

  cache.set(A, 1, "BLOCK_A_V1");
  assert.strictEqual(cache.get(A, 1), "BLOCK_A_V1", "exact (uri, version) hit");
  assert.strictEqual(cache.get(A, 2), undefined, "a newer version is a miss (stale)");
  assert.strictEqual(cache.get(A, 0), undefined, "a different version is a miss");

  cache.set(A, 2, "BLOCK_A_V2");
  assert.strictEqual(cache.get(A, 2), "BLOCK_A_V2", "the new version hits");
  assert.strictEqual(cache.get(A, 1), undefined, "the old version was invalidated by the newer set");

  cache.set(B, 1, "BLOCK_B_V1");
  assert.strictEqual(cache.get(B, 1), "BLOCK_B_V1", "a different uri is stored independently");
  assert.strictEqual(cache.get(A, 2), "BLOCK_A_V2", "storing another uri did not disturb A's entry");
});

// ===========================================================================
// 4. The 50ms degrade bar (INJECTION_DEADLINE_MS) via CompletionService.
//    A slow resolveInjection (>50ms) degrades to plain FIM and never blocks the
//    keystroke; a fast one (<50ms) injects the block into the FIM prefix.
//    Pattern (fake generate + config) copied from blind-service.test.cjs.
// ===========================================================================

const CFG = {
  apiBase: "http://127.0.0.1:1", // never reached: generate is injected
  model: "fake-model",
  maxTokens: 64,
  temperature: 0.01,
  debounceMs: 0,
  prefixChars: 4000,
  suffixChars: 1000,
  multiline: true,
  cacheCapacity: 10,
};

// Records the params it was called with (so we can read the injected prefix).
function makeGenerate(text = "todo!()") {
  const calls = [];
  const fn = async (params) => {
    calls.push(params);
    return { text, ttftMs: 5, totalMs: 10 };
  };
  return { fn, calls };
}

// The block a warm resolveInjection would produce; its sentinel is unmistakable.
const INJECTED_BLOCK = "// WHOLEBLOCK_INJECTED\n// pub struct Order { id: u64 }";
const REQ = { prefix: "pub fn top_order_value(orders: &[Order]) -> u64 {\n    ", suffix: "\n}\n", manual: true };

test("degrade bar: a resolveInjection SLOWER than 50ms degrades to plain FIM - the block is NOT injected, and complete() still returns", async () => {
  const g = makeGenerate();
  const svc = new CompletionService(CFG, g.fn);
  const t0 = Date.now();
  const out = await svc.complete({
    ...REQ,
    resolveInjection: async () => { await sleep(120); return INJECTED_BLOCK; },
  });
  const elapsed = Date.now() - t0;
  assert.ok(out, "the completion still resolves (keystroke not blocked, degraded to plain)");
  assert.strictEqual(g.calls.length, 1, "generate ran despite the slow resolver");
  assert.ok(
    !g.calls[0].prefix.includes("WHOLEBLOCK_INJECTED"),
    "the slow-resolved block was NOT injected into the generate prefix (degraded to plain FIM)",
  );
  assert.ok(
    elapsed < 110,
    `complete did not wait the full 120ms resolve - it cut over at the ~50ms deadline (elapsed ${elapsed}ms)`,
  );
  svc.dispose();
});

test("degrade bar: a resolveInjection FASTER than 50ms injects the block into the FIM prefix", async () => {
  const g = makeGenerate();
  const svc = new CompletionService(CFG, g.fn);
  const out = await svc.complete({
    ...REQ,
    resolveInjection: async () => INJECTED_BLOCK, // resolves immediately (<50ms)
  });
  assert.ok(out, "the completion resolves");
  assert.strictEqual(g.calls.length, 1, "generate ran once");
  assert.ok(
    g.calls[0].prefix.includes("WHOLEBLOCK_INJECTED"),
    `the fast-resolved block IS injected into the generate prefix; got prefix: ${JSON.stringify(g.calls[0].prefix)}`,
  );
  svc.dispose();
});

test("degrade bar: the keystroke is never blocked - complete() returns whether the resolver is fast, slow, or throws", async () => {
  const g = makeGenerate();
  const svc = new CompletionService(CFG, g.fn);
  // A throwing resolver must degrade, not surface.
  const out = await svc.complete({
    ...REQ,
    resolveInjection: async () => { throw new Error("rust-analyzer exploded"); },
  });
  assert.ok(out, "a throwing resolver still yields a plain-FIM completion");
  assert.ok(!g.calls[0].prefix.includes("WHOLEBLOCK_INJECTED"), "nothing injected on a throwing resolver");
  svc.dispose();
});
