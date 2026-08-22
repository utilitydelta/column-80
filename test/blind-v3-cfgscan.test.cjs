// Blind oracle: cfg-gate source scan against the FROZEN phase-2 contract
// [the phase-2 cfg-scan contract]. Three pure functions over strings:
//   scanCfgGates(libRsSource)         -> Map<module, gate TOKEN>
//   resolvePublicFeature(features, token, moduleName) -> public feature | undefined
//   buildGatingFeatures(libRsSource, features)        -> Map<module, public feature>
// Driven off the REAL object_store 0.14.0 slice (65 `//!` doc-comment decoy
// lines that embed `#[cfg(feature = "aws")]`) and the REAL feature map, both
// loaded from test/fixtures/cfg-scan/ rather than hand-transcribed. The load
// pins that no doc-comment decoy leaks a gate, that ungated modules stay out of
// the map, that internal tokens (aws-base) resolve to public features (aws),
// and that garbage never throws. Never read src/**; expected red because
// src/core/cfgScan.ts does not exist yet (bundle/resolve error is an accepted
// TDD-first red for a not-yet-created module).
//
// Run: SKIP_LIVE=1 node --test test/blind-v3-cfgscan.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "blind-v3-cfgscan",
  `export { scanCfgGates, resolvePublicFeature, buildGatingFeatures } from "../src/core/cfgScan";\n`
);
const { scanCfgGates, resolvePublicFeature, buildGatingFeatures } = mod;
test.after(cleanup);

// The real fixtures. object_store-lib-modblock.rs is a byte-for-byte slice of
// object_store 0.14.0 lib.rs: 65 `//!` doc lines (two of which embed
// `#[cfg(feature = "aws")]` inside `//! # ... {` example blocks) followed by the
// real top-level `#[cfg(...)] mod ...` block. object_store-features.json is the
// crate's `cargo metadata` feature map.
const FIXDIR = path.join(__dirname, "fixtures", "cfg-scan");
const MODBLOCK = fs.readFileSync(path.join(FIXDIR, "object_store-lib-modblock.rs"), "utf8");
const FEATURES = require(path.join(FIXDIR, "object_store-features.json"));

// --- scanCfgGates on the real modblock fixture ----------------------------
test("scanCfgGates: the four marquee *-base gates are present and exact", () => {
  const gates = scanCfgGates(MODBLOCK);
  assert.strictEqual(gates.get("aws"), "aws-base");
  assert.strictEqual(gates.get("azure"), "azure-base");
  assert.strictEqual(gates.get("gcp"), "gcp-base");
  assert.strictEqual(gates.get("http"), "http-base");
});

test("scanCfgGates: a tokio-gated and a cloud-base-gated module resolve to their literal token", () => {
  const gates = scanCfgGates(MODBLOCK);
  assert.strictEqual(gates.get("buffered"), "tokio");
  assert.strictEqual(gates.get("signer"), "cloud-base");
});

test("scanCfgGates: all(feature = \"fs\", not(target_arch)) records the positively-required token -> local -> fs", () => {
  // The `not(...)` wraps a non-feature predicate (target_arch), so the first
  // positively-required `feature = "..."` — fs — is the gate.
  const gates = scanCfgGates(MODBLOCK);
  assert.strictEqual(gates.get("local"), "fs");
});

test("scanCfgGates: no doc-comment `//!` decoy leaks a gate; the token \"aws\" never appears as a value", () => {
  // The 65 doc lines embed `#[cfg(feature = "aws")]`, but no real gate uses the
  // bare token "aws" (the real ones are aws-base/azure-base/tokio/cloud-base/...).
  // So any value equal to "aws" would mean a doc-comment decoy leaked in.
  const gates = scanCfgGates(MODBLOCK);
  for (const [module, token] of gates) {
    assert.notStrictEqual(token, "aws", `decoy feature "aws" leaked via module \`${module}\``);
  }
  // And no bogus module scraped out of the prose of a doc line.
  assert.strictEqual(gates.has("url"), false);
  assert.strictEqual(gates.has("Url"), false);
  assert.strictEqual(gates.has("use"), false);
});

test("scanCfgGates: ungated / non-feature-gated modules are absent, not mapped", () => {
  const gates = scanCfgGates(MODBLOCK);
  // Ungated top-level modules (no cfg above them).
  assert.strictEqual(gates.has("path"), false);
  assert.strictEqual(gates.has("memory"), false);
  assert.strictEqual(gates.has("delimited"), false);
  // chunked is gated by `#[cfg(not(target_arch = "wasm32"))]` — no positively-
  // required feature predicate at all — so it must not be recorded.
  assert.strictEqual(gates.has("chunked"), false);
});

// --- scanCfgGates on small hand-written source: the tricky shapes ---------
const shapeCases = [
  {
    name: "attribute and mod separated by a #[doc] line and a blank line -> still detected",
    src:
      `#[cfg(feature = "alpha")]\n` +
      `#[doc(hidden)]\n` +
      `\n` +
      `pub mod separated;\n`,
    assert: (g) => assert.strictEqual(g.get("separated"), "alpha"),
  },
  {
    name: "mod with no cfg above it -> absent",
    src: `pub mod plain_ungated;\n`,
    assert: (g) => assert.strictEqual(g.has("plain_ungated"), false),
  },
  {
    name: "#[cfg(not(feature = \"x\"))] mod y -> absent (not-a-needs-feature gate, not recorded)",
    src:
      `#[cfg(not(feature = "beta"))]\n` +
      `pub mod not_gated;\n`,
    assert: (g) => assert.strictEqual(g.has("not_gated"), false),
  },
  {
    name: "commented-out `// #[cfg(feature=\"z\")] mod z;` line then real code -> decoy ignored",
    src:
      `// #[cfg(feature = "gamma")] mod commented_out;\n` +
      `pub fn real_code() {}\n`,
    assert: (g) => {
      assert.strictEqual(g.has("commented_out"), false);
      assert.strictEqual(g.has("z"), false);
    },
  },
  {
    name: 'scanCfgGates("") -> empty map',
    src: "",
    assert: (g) => assert.strictEqual(g.size, 0),
  },
  {
    name: "garbage input -> empty map, never throws",
    src: ">>> not rust @@@ #[cfg(oops feature broken\nmod\n{{{ }}}",
    assert: (g) => assert.strictEqual(g.size, 0),
  },
];

for (const { name, src, assert: check } of shapeCases) {
  test(`scanCfgGates shape: ${name}`, () => {
    const g = scanCfgGates(src);
    assert.ok(g instanceof Map, "returns a Map");
    check(g);
  });
}

// --- resolvePublicFeature on the real feature map -------------------------
const resolveCases = [
  { token: "aws-base", module: "aws", expected: "aws" },
  { token: "azure-base", module: "azure", expected: "azure" },
  { token: "gcp-base", module: "gcp", expected: "gcp" },
  { token: "http-base", module: "http", expected: "http" },
  // tokio has no parent among these features -> it is its own root.
  { token: "tokio", module: "buffered", expected: "tokio" },
  // cloud-base's roots are aws/azure/gcp/http; no root equals "signer", so the
  // alphabetically-first root wins, deterministically.
  { token: "cloud-base", module: "signer", expected: "aws" },
  // Absent from the graph entirely -> undefined.
  { token: "totally-absent-token", module: "whatever", expected: undefined },
];

for (const { token, module, expected } of resolveCases) {
  test(`resolvePublicFeature: (${token}, ${module}) -> ${String(expected)}`, () => {
    assert.strictEqual(resolvePublicFeature(FEATURES, token, module), expected);
  });
}

// --- buildGatingFeatures on the real fixtures: token resolved to public ---
test("buildGatingFeatures: internal *-base tokens resolve to their public feature", () => {
  const g = buildGatingFeatures(MODBLOCK, FEATURES);
  assert.ok(g instanceof Map, "returns a Map");
  assert.strictEqual(g.get("aws"), "aws");
  assert.strictEqual(g.get("azure"), "azure");
  assert.strictEqual(g.get("gcp"), "gcp");
  assert.strictEqual(g.get("http"), "http");
});
