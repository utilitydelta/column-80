// stripRedundantUses: drop a function-local `use` the model added because the
// fn-gen prompt (signature + doc only) hid the file's imports. Must handle
// grouped/nested imports, `self`, and leave aliases/globs/genuinely-new uses.
//
// Run: SKIP_LIVE=1 node --test test/impl-v3-redundant-use.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-v3-redundant-use",
  `export { expandUse, fileImportBindings, stripRedundantUses } from "../src/core/instructPostprocess";\n`
);
const { expandUse, fileImportBindings, stripRedundantUses } = mod;
test.after(cleanup);

// --- expandUse ---------------------------------------------------------------
const expandCases = [
  ["fastbloom::BloomFilter", ["fastbloom::BloomFilter"]],
  ["std::collections::{HashMap,HashSet}", ["std::collections::HashMap", "std::collections::HashSet"]],
  ["a::{b::{C,D},E}", ["a::b::C", "a::b::D", "a::E"]],
  ["a::{self,B}", ["a", "a::B"]],
  ["foo::Bar as Baz", ["foo::Bar as Baz"]],
  ["fastbloom::*", ["fastbloom::*"]],
];
for (const [tree, expected] of expandCases) {
  test(`expandUse: ${tree}`, () => {
    assert.deepStrictEqual(expandUse(tree), expected);
  });
}

// --- the reported case: simple redundant use ---------------------------------
test("strips a simple inline use the file already imports (the reported bug)", () => {
  const file = "use fastbloom::BloomFilter;\nfn f() {}";
  const body = 'fn membership() -> bool {\n    use fastbloom::BloomFilter;\n\n    let mut filter = BloomFilter::with_num_bits(1024);\n    filter.contains(b"hello")\n}';
  const out = stripRedundantUses(body, fileImportBindings(file));
  assert.ok(!/use fastbloom::BloomFilter;/.test(out), "the redundant inline use is gone");
  assert.ok(out.includes("BloomFilter::with_num_bits"), "the body is otherwise intact");
  assert.ok(!/\n\s*\n\s*let mut/.test(out), "the blank line it left is collapsed");
});

// --- grouped file import matches a single inline import (the user's question) -
test("strips a single inline use against a GROUPED file import", () => {
  const file = "use std::collections::{HashMap, HashSet};";
  const body = "fn f() {\n    use std::collections::HashSet;\n    let s: HashSet<u8> = HashSet::new();\n}";
  const out = stripRedundantUses(body, fileImportBindings(file));
  assert.ok(!/use std::collections::HashSet;/.test(out));
});

test("strips a grouped inline use when ALL its members are file imports", () => {
  const file = "use a::{X, Y, Z};";
  const body = "fn f() {\n    use a::{X, Y};\n    let _ = X;\n}";
  assert.ok(!/use a::\{X, Y\};/.test(stripRedundantUses(body, fileImportBindings(file))));
});

// --- must NOT strip when the use brings in something new ----------------------
test("keeps an inline use that brings in a name the file lacks", () => {
  const file = "use a::{X, Y};";
  const body = "fn f() {\n    use a::{X, W};\n    let _ = W;\n}"; // W is new
  const out = stripRedundantUses(body, fileImportBindings(file));
  assert.ok(/use a::\{X, W\};/.test(out), "kept: W is not a file import");
});

test("keeps an alias / glob unless identical", () => {
  const file = "use foo::Bar;";
  const aliasBody = "fn f() {\n    use foo::Bar as B;\n}"; // aliased, not the same binding
  assert.ok(/use foo::Bar as B;/.test(stripRedundantUses(aliasBody, fileImportBindings(file))));
});

test("no file imports -> body unchanged", () => {
  const body = "fn f() {\n    use x::Y;\n}";
  assert.strictEqual(stripRedundantUses(body, fileImportBindings("fn g() {}")), body);
});
