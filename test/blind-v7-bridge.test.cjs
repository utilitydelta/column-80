// v7 phase-2 bridge unit oracle (headless, no rust-analyzer): the cross-file
// resolver's output, adapted by toResolveStruct, drives the SAME walkDataShape
// seam v6 used - proving the ONE resolver feeds the pure walk without changing
// it. A hand-built CrossFileShape stands in for a live resolve (the graph has
// ALREADY crossed files), so the walk's emission, bound, and edge-following are
// tested in isolation.
//
// Run: node --test test/blind-v7-bridge.test.cjs   (no live deps)
const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "blind-v7-bridge",
  `export { renderDerivedDef, toResolveStruct } from "../src/core/crossFileShape";
export { walkDataShape } from "../src/core/dataShape";\n`
);
const { renderDerivedDef, toResolveStruct, walkDataShape } = mod;
test.after(cleanup);

// signature = the raw hover text the data-shape block emits verbatim (v6 bytes).
const sigOf = (name, fields) => `pub struct ${name} {\n` + fields.map((f) => `    pub ${f.name}: ${f.typeName},`).join("\n") + `\n}`;
const T = (name, fields, methods) => [name, { name, signature: sigOf(name, fields), fields, methods, methodsResolved: true }];
// Order -> Customer -> Address(-> Region, NOT in the map: a stop edge)
//       -> LineItem. Region absent proves a non-derived field-type is not walked.
const shape = () => ({
  types: new Map([
    T("Order", [{ name: "reference", typeName: "String" }, { name: "placed_by", typeName: "Customer" }, { name: "entries", typeName: "Vec<LineItem>" }], ["net_minor_units(&self) -> u64"]),
    T("Customer", [{ name: "display_name", typeName: "String" }, { name: "ship_to", typeName: "Address" }], ["is_patron(&self) -> bool"]),
    T("Address", [{ name: "locale", typeName: "String" }, { name: "region", typeName: "Region" }], []),
    T("LineItem", [{ name: "sku", typeName: "String" }], []),
  ]),
  dropped: [],
});
const BOUND = { D_MAX: 2, B_MAX: 4, N_MAX: 6, TOK_MAX: 200 };

test("renderDerivedDef emits the raw hover signature verbatim (v6-stable data-shape bytes)", () => {
  const def = renderDerivedDef(shape().types.get("Order"));
  assert.match(def, /pub struct Order \{/, "the hover `pub struct` form is preserved");
  assert.match(def, /pub reference: String,/);
  assert.match(def, /pub placed_by: Customer,/);
  assert.match(def, /pub entries: Vec<LineItem>,/);
});

test("renderDerivedDef falls back to a synthesized def when hover did not resolve", () => {
  const t = { name: "Tile", signature: "", fields: [{ name: "morton_code", typeName: "u64" }], methods: [], methodsResolved: false };
  const def = renderDerivedDef(t);
  assert.match(def, /struct Tile \{/);
  assert.match(def, /morton_code: u64,/);
});

test("toResolveStruct: unknown type -> undefined (honest miss, walk stops)", () => {
  assert.strictEqual(toResolveStruct(shape())("Nope"), undefined);
});

test("toResolveStruct: fields carry ONLY walkable edges, isLocal iff the resolver derived that type", () => {
  const res = toResolveStruct(shape())("Order");
  // String is not a struct edge; Customer and LineItem are derived (isLocal).
  assert.deepStrictEqual(res.fields, [
    { name: "placed_by", typeName: "Customer", isLocal: true },
    { name: "entries", typeName: "LineItem", isLocal: true },
  ]);
  // Address.region -> Region is NOT in the shape, so it is not a walkable edge.
  const addr = toResolveStruct(shape())("Address");
  assert.deepStrictEqual(addr.fields, [{ name: "region", typeName: "Region", isLocal: false }]);
});

test("walkDataShape over the bridged resolver emits the reachable graph, each type once, crossing edges", () => {
  const walk = walkDataShape("Order", toResolveStruct(shape()), BOUND);
  for (const name of ["Order", "Customer", "LineItem", "Address"]) {
    assert.ok(walk.block.includes(`struct ${name} {`), `walk must emit ${name}; got:\n${walk.block}`);
  }
  // Region is beyond depth 2 AND not derived: never emitted.
  assert.ok(!walk.block.includes("struct Region"), "Region (undrived, depth 3) must not be emitted");
  // Emit-once: each struct header appears exactly once.
  for (const name of ["Order", "Customer", "LineItem", "Address"]) {
    const n = walk.block.split(`struct ${name} {`).length - 1;
    assert.strictEqual(n, 1, `${name} must be emitted exactly once, got ${n}`);
  }
});

test("walkDataShape N_MAX caps the emitted set and names the drop (never silent)", () => {
  const walk = walkDataShape("Order", toResolveStruct(shape()), { ...BOUND, N_MAX: 2 });
  const emitted = ["Order", "Customer", "LineItem", "Address"].filter((n) => walk.block.includes(`struct ${n} {`));
  assert.strictEqual(emitted.length, 2, `N_MAX=2 must emit exactly 2, got ${emitted.length}`);
  assert.ok(walk.dropped.length > 0, "a dropped type must be named when N_MAX truncates");
  // dropped disjoint from emitted.
  for (const d of walk.dropped) {
    assert.ok(!emitted.includes(d), `dropped ${d} must not also be emitted`);
  }
});
