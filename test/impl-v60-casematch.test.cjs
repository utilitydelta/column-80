// White-box: `caseMatchesFilter`, and the discovered-set membership that hangs
// on it.
//
// THIS FILE EXISTS BECAUSE OF A MEASUREMENT. Running the seeded-defect arm
// against the real 534-test crate, a `Set.has` membership test matched ZERO of
// 40 real failures: the call hierarchy names a Rust test `chain_read_...` and
// libtest reports the case as `shard_wal::tests::chain_read_...`. Every Rust
// repair round would have had no evidence and no authorization while looking
// perfectly wired. The rows below are the shapes each runner actually emits.
//
// Run: npm run test:unit

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-v60-casematch",
  `export { caseMatchesFilter } from "../src/core/testClassify";
export { shapesWithinDiscoveredSet } from "../src/core/testRepairEvidence";\n`,
);
const { caseMatchesFilter, shapesWithinDiscoveredSet } = mod;
test.after(cleanup);

test("Rust: libtest's module path prefix is matched, and a near-miss is not", () => {
  // Straight from the real run: the walk's name, libtest's case name.
  assert.strictEqual(
    caseMatchesFilter("rust", "shard_wal::tests::chain_read_returns_all_versions", "chain_read_returns_all_versions"),
    true,
  );
  assert.strictEqual(caseMatchesFilter("rust", "chain_read", "chain_read"), true, "an already-bare case is itself");
  assert.strictEqual(
    caseMatchesFilter("rust", "tests::not_all_versions", "all_versions"),
    false,
    "SUFFIX, not includes: the `::` separator is part of the test",
  );
  assert.strictEqual(caseMatchesFilter("rust", "tests::all_versions_extra", "all_versions"), false);
});

test("Python: a node id's class and path segments are matched", () => {
  assert.strictEqual(caseMatchesFilter("python", "tests/test_shape.py::TestArea::test_zero", "test_zero"), true);
  assert.strictEqual(caseMatchesFilter("python", "TestArea.test_zero", "test_zero"), true);
  assert.strictEqual(caseMatchesFilter("python", "test_zero_extra", "test_zero"), false);
});

test("C# matches a data-driven case's argument list and a class-qualified tail", () => {
  assert.strictEqual(caseMatchesFilter("csharp", "Acme.Tests.Adds(1, 2)", "Acme.Tests.Adds"), true);
  assert.strictEqual(caseMatchesFilter("csharp", "Acme.Tests.Adds", "Acme.Tests.Adds"), true);
  assert.strictEqual(caseMatchesFilter("csharp", "Acme.Tests.Adds", "Adds"), true);
  assert.strictEqual(caseMatchesFilter("csharp", "Acme.Tests.AddsMore", "Adds"), false);
});

test("Go matches a subtest under its parent", () => {
  assert.strictEqual(caseMatchesFilter("go", "TestShape/negative radius", "TestShape"), true);
  assert.strictEqual(caseMatchesFilter("go", "TestShapeOther", "TestShape"), false);
});

test("TypeScript matches only on identity, because there is no name to match", () => {
  assert.strictEqual(caseMatchesFilter("typescript", "/r/a.test.ts", "/r/a.test.ts"), true);
  assert.strictEqual(caseMatchesFilter("typescript", "a > b > works", "works"), false);
});

test("empty or blank on either side never matches", () => {
  for (const lang of ["rust", "go", "csharp", "python", "typescript"]) {
    assert.strictEqual(caseMatchesFilter(lang, "", ""), false);
    assert.strictEqual(caseMatchesFilter(lang, "   ", "x"), false);
    assert.strictEqual(caseMatchesFilter(lang, "x", "  "), false);
  }
});

test("THE MEASURED CASE: 40 libtest failures against 300 bare walk filters", () => {
  // The real shapes, reduced. Before this matcher these matched nothing.
  const names = [
    "shard_wal::tests::chain_read_returns_all_versions_across_segment_rotation",
    "shard_wal::tests::compact_below_threshold_skipped",
    "shard_wal_s3::tests::unrelated_upload_path",
  ];
  const shapes = [{ shape: "k", representative: "boom", count: 3, names }];
  const discovered = new Set([
    "chain_read_returns_all_versions_across_segment_rotation",
    "compact_below_threshold_skipped",
  ]);
  const kept = shapesWithinDiscoveredSet(shapes, discovered, "rust");
  assert.strictEqual(kept.length, 1);
  assert.strictEqual(kept[0].count, 2, "the two discovered ones survive");
  assert.deepStrictEqual(kept[0].names, names.slice(0, 2));
  assert.ok(
    !kept[0].names.some((n) => n.includes("unrelated")),
    "a red test the walk never found is not this function's problem and must not become evidence about it",
  );
});

test("a shape with no discovered member is dropped entirely, not kept empty", () => {
  const kept = shapesWithinDiscoveredSet(
    [{ shape: "k", representative: "boom", count: 1, names: ["other::tests::elsewhere"] }],
    new Set(["mine"]),
    "rust",
  );
  assert.deepStrictEqual(kept, []);
});

test("the input shapes are not mutated", () => {
  const shape = { shape: "k", representative: "boom", count: 2, names: ["a::tests::x", "b::tests::y"] };
  Object.freeze(shape.names);
  Object.freeze(shape);
  assert.doesNotThrow(() => shapesWithinDiscoveredSet([shape], new Set(["x"]), "rust"));
  assert.strictEqual(shape.count, 2);
});
