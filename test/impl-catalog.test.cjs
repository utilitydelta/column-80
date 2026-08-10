// Implementer oracle for the slice-4 catalog (findings 14, 15): buildCatalog
// parses cargo metadata into the installed direct dependencies with one-line
// purposes, excluding dev/build/optional and the transitive graph; renderCatalog
// turns that into the injection block. Pure, headless, driven by a captured
// metadata fixture shaped exactly like `cargo metadata --format-version 1`.
//
// Run: SKIP_LIVE=1 node --test test/impl-catalog.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-catalog",
  `export { buildCatalog, renderCatalog, fetchCatalog } from "../src/core/catalog";\n`
);
const { buildCatalog, renderCatalog, fetchCatalog } = mod;
test.after(cleanup);

const METADATA = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "cargo-metadata", "installed.json"), "utf8"));

test("buildCatalog returns only the workspace crate's normal deps: no dev, build, optional, or transitive", () => {
  const entries = buildCatalog(METADATA);
  assert.deepStrictEqual(entries.map((e) => e.name), ["fastbloom", "http_client", "object_store"], "sorted, normal deps only");
  const names = entries.map((e) => e.name);
  for (const excluded of ["criterion", "cc", "serde", "zerocopy"]) {
    assert.ok(!names.includes(excluded), `${excluded} must not be in the catalog`);
  }
});

test("buildCatalog lists a renamed dependency by its IMPORT name, with the real crate's description", () => {
  const entries = buildCatalog(METADATA);
  const names = entries.map((e) => e.name);
  assert.ok(names.includes("http_client"), "the rename is the importable name");
  assert.ok(!names.includes("hyper"), "the package name is never listed for a renamed dep");
  const renamed = entries.find((e) => e.name === "http_client");
  assert.match(renamed.description, /HTTP library/, "description comes from the real package (hyper)");
});

test("buildCatalog carries a one-line purpose from each crate's description, first sentence, capped", () => {
  const entries = buildCatalog(METADATA);
  const object = entries.find((e) => e.name === "object_store");
  assert.match(object.description, /generic object store interface/i, "the description is carried");
  assert.ok(object.description.length <= 101, `one line, got ${object.description.length} chars`);
  const bloom = entries.find((e) => e.name === "fastbloom");
  assert.strictEqual(bloom.description, "The fastest Bloom filter in Rust.", "first sentence only");
});

test("buildCatalog on metadata with no workspace deps is empty", () => {
  assert.deepStrictEqual(buildCatalog({ packages: [{ name: "solo", id: "x", dependencies: [] }], workspace_members: ["x"] }), []);
  assert.deepStrictEqual(buildCatalog({}), []);
});

test("renderCatalog lists the crates with purposes and a firm re-pick instruction", () => {
  const out = renderCatalog(buildCatalog(METADATA));
  assert.match(out, /object_store: A generic object store interface/, "name + purpose line");
  assert.match(out, /fastbloom: The fastest Bloom filter/);
  assert.match(out, /ARE installed/, "frames them as the installed set");
  assert.match(out, /Do not use a crate that is not in this list/, "firm instruction");
  assert.ok(!out.includes("criterion") && !out.includes("zerocopy"), "excluded crates never appear");
});

test("renderCatalog on an empty catalog is the empty string (caller falls back to add-the-crate)", () => {
  assert.strictEqual(renderCatalog([]), "");
});

test("renderCatalog renders a bare name when a crate has no description", () => {
  const out = renderCatalog([{ name: "mystery" }]);
  assert.match(out, /\bmystery\b/);
  assert.ok(!out.includes("mystery:"), "no empty 'name:' when there is no description");
});

// ---- fetchCatalog: run cargo metadata through the injectable runner.

test("fetchCatalog runs `cargo metadata` through the runner and builds the catalog", async () => {
  let seen;
  const runner = async (cmd) => {
    seen = cmd;
    return { stdout: JSON.stringify(METADATA), exitCode: 0 };
  };
  const entries = await fetchCatalog("/w/demo", runner);
  assert.deepStrictEqual([seen.command, ...seen.args], ["cargo", "metadata", "--format-version", "1"]);
  assert.strictEqual(seen.cwd, "/w/demo");
  assert.deepStrictEqual(entries.map((e) => e.name), ["fastbloom", "http_client", "object_store"]);
});

test("fetchCatalog never throws: a failed run or garbage stdout yields an empty catalog", async () => {
  assert.deepStrictEqual(await fetchCatalog("/w", async () => ({ stdout: "", exitCode: 101 })), []);
  assert.deepStrictEqual(await fetchCatalog("/w", async () => ({ stdout: "not json", exitCode: 0 })), []);
  assert.deepStrictEqual(await fetchCatalog("/w", async () => { throw new Error("cargo missing"); }), []);
});
