// Implementer tests for P2 (on top of the blind oracle blind-v8-testability):
// the triaged review fix D1 — RECEIVER must match a lifetime-annotated borrow
// receiver (`&'a self`, `&'a mut self`), which a lifetime-heavy DB codebase has.
// A method leaking to `testable` is the worse (hollow-test) error. New
// contract-derived cases; the blind oracle's assertions are untouched.
//
// Run: SKIP_LIVE=1 node --test test/impl-v8-testability.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-v8-testability",
  `export { classifyTestability } from "../src/core/testability";\n`
);
const { classifyTestability } = mod;
test.after(cleanup);

const DOC = "/// Iterate the entries.";

test("lifetime-annotated shared receiver `&'a self` is needs-fixture (not testable)", () => {
  const v = classifyTestability("pub fn iter<'a>(&'a self) -> Iter<'a, Entry>", DOC);
  assert.strictEqual(v.testable, false, "a method with a lifetime receiver is not a free-fn target");
  assert.strictEqual(v.reason, "needs-fixture", "`&'a self` is a self receiver");
});

test("lifetime-annotated mutable receiver `&'a mut self` is needs-fixture", () => {
  const v = classifyTestability("fn drain<'a>(&'a mut self) -> Drain<'a>", DOC);
  assert.strictEqual(v.testable, false);
  assert.strictEqual(v.reason, "needs-fixture");
});

test("`'static`-lifetime receiver still detected", () => {
  const v = classifyTestability("fn leak(&'static self) -> &'static str", DOC);
  assert.strictEqual(v.reason, "needs-fixture");
});

test("regression: a `Self`-bearing PARAM (not a receiver) stays a free function", () => {
  // `&HashMap<K, Self>` is a param type, not a receiver; must not trip RECEIVER.
  const v = classifyTestability("fn merge(into: &mut Vec<Self>, from: &[Self]) -> usize", DOC);
  assert.strictEqual(v.testable, true, "no self receiver -> still a free-fn target");
});
