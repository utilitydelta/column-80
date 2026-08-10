// Implementer tests for buildResolution: the assembly that turns cargo metadata
// + an on-disk lib.rs reader into the CrateResolution the E0433 disambiguation
// consumes. The pieces (buildCatalog, buildGatingFeatures) are blind-tested
// elsewhere; this pins the wiring end to end against the REAL object_store
// (aws-off) metadata fixture and object_store's real cfg-gated lib.rs.
//
// Run: SKIP_LIVE=1 node --test test/impl-v3-resolution.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-v3-resolution",
  `export { buildResolution } from "../src/core/crateResolution";\n`
);
const { buildResolution } = mod;
test.after(cleanup);

const META = JSON.parse(
  fs.readFileSync(path.join(__dirname, "fixtures", "cargo-metadata", "fixcap-object_store-noaws.json"), "utf8"),
);
// object_store's real cfg-gated lib.rs slice (the modblock with the aws gate).
const OBJECT_STORE_LIB = fs.readFileSync(
  path.join(__dirname, "fixtures", "cfg-scan", "object_store-lib-modblock.rs"),
  "utf8",
);

test("isInstalledCrate is true for a resolved direct dep, false otherwise", () => {
  const res = buildResolution(META, () => OBJECT_STORE_LIB);
  assert.strictEqual(res.isInstalledCrate("object_store"), true);
  assert.strictEqual(res.isInstalledCrate("fastbloom"), true);
  assert.strictEqual(res.isInstalledCrate("not_a_dep"), false);
});

test("gatingFeature resolves object_store::aws to the public feature `aws` from the real lib.rs", () => {
  const res = buildResolution(META, () => OBJECT_STORE_LIB);
  assert.strictEqual(res.gatingFeature("object_store", "aws"), "aws");
  assert.strictEqual(res.gatingFeature("object_store", "azure"), "azure");
});

test("gatingFeature is undefined for an ungated module (path) and an unknown module", () => {
  const res = buildResolution(META, () => OBJECT_STORE_LIB);
  assert.strictEqual(res.gatingFeature("object_store", "path"), undefined);
  assert.strictEqual(res.gatingFeature("object_store", "no_such_module"), undefined);
});

test("gatingFeature on a non-installed crate is undefined even if the reader would return gates", () => {
  const res = buildResolution(META, () => OBJECT_STORE_LIB);
  assert.strictEqual(res.gatingFeature("not_a_dep", "aws"), undefined);
});

test("a missing lib.rs (reader returns undefined) degrades to no gate, never throws", () => {
  const res = buildResolution(META, () => undefined);
  assert.strictEqual(res.gatingFeature("object_store", "aws"), undefined);
  assert.strictEqual(res.isInstalledCrate("object_store"), true);
});

test("lib.rs is read at most once per crate (cached)", () => {
  let reads = 0;
  const res = buildResolution(META, () => {
    reads++;
    return OBJECT_STORE_LIB;
  });
  res.gatingFeature("object_store", "aws");
  res.gatingFeature("object_store", "azure");
  res.gatingFeature("object_store", "gcp");
  assert.strictEqual(reads, 1, "one lib.rs read for object_store across many gatingFeature calls");
});
