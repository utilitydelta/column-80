// Implementer oracle for the v8 shape-fidelity fix: nestedConstructors surfaces
// the CONSTRUCTORS of the non-root types in a resolved shape, so a blind test
// builds a private-field type via its `::new` instead of a struct literal that
// will not compile. Pure over a synthetic CrossFileShape — no rust-analyzer.
//
// Run: SKIP_LIVE=1 node --test test/impl-v8-nested-ctors.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-v8-nested-ctors",
  `export { nestedConstructors } from "../src/core/crossFileShape";\n`,
);
const { nestedConstructors } = mod;
test.after(cleanup);

// Build a CrossFileShape from { typeName: methods[] }, insertion order preserved.
function shapeOf(spec) {
  const types = new Map();
  for (const [name, methods] of spec) {
    types.set(name, { name, signature: "", fields: [], methods, methodsResolved: true });
  }
  return { types, dropped: [] };
}

test("surfaces a nested type's constructor, prefixed with the type; excludes the ROOT's own", () => {
  const shape = shapeOf([
    ["Order", ["new(reference: &str, placed_by: Customer, entries: Vec<LineItem>) -> Self", "net_minor_units(&self) -> u64"]],
    ["Customer", ["new(display_name: String, ship_to: Address, tier: u8) -> Self", "is_patron(&self) -> bool"]],
  ]);
  const out = nestedConstructors(shape, "Order");
  assert.strictEqual(out, "Customer::new(display_name: String, ship_to: Address, tier: u8) -> Self");
  assert.ok(!out.includes("Order::new"), "the root's own constructor is not repeated (it renders in the root methods)");
  assert.ok(!out.includes("is_patron"), "a non-constructor method is excluded");
  assert.ok(!out.includes("net_minor_units"), "the root's non-constructor method is excluded");
});

test("recognizes new / try_new / from / try_from / with_* / default and any `-> Self` return", () => {
  const shape = shapeOf([
    ["Root", []],
    ["A", ["new() -> Self"]],
    ["B", ["from(v: u8) -> Self"]],
    ["C", ["try_from(v: u8) -> Result<Self, Error>"]],
    ["D", ["with_capacity(n: usize) -> Self"]],
    ["E", ["default() -> Self"]],
    ["F", ["build(self) -> Widget"]], // name-based ctor even without -> Self
    ["G", ["make(v: u8) -> Self"]], // not a ctor NAME, but returns Self -> included
    ["H", ["len(&self) -> usize"]], // neither -> excluded
  ]);
  const out = nestedConstructors(shape, "Root");
  for (const want of ["A::new", "B::from", "C::try_from", "D::with_capacity", "E::default", "F::build", "G::make"]) {
    assert.ok(out.includes(want), `${want} must be recognized as constructor-shaped`);
  }
  assert.ok(!out.includes("H::len"), "an instance method (len) is not a constructor");
});

test("deterministic order (shape insertion order) and capped at MEMBER_CAP (24) total", () => {
  const spec = [["Root", []]];
  for (let i = 0; i < 40; i++) {
    spec.push([`T${i}`, [`new(v: u8) -> Self`]]);
  }
  const out = nestedConstructors(shapeOf(spec), "Root");
  const lines = out.split("\n");
  assert.strictEqual(lines.length, 24, "capped at MEMBER_CAP total lines");
  assert.strictEqual(lines[0], "T0::new(v: u8) -> Self", "first line is the first-inserted nested type (deterministic)");
});

test("undefined when no non-root type has a constructor", () => {
  const shape = shapeOf([
    ["Order", ["new() -> Self"]], // root ctor does not count
    ["Address", ["locale(&self) -> &str"]], // only instance methods
  ]);
  assert.strictEqual(nestedConstructors(shape, "Order"), undefined);
});
