// Implementer tests for the cfg-scan internals the blind contract cannot see:
// multi-line cfg accumulation, cfg_attr (NOT a gate), pub(crate)/inline mod
// forms, a cfg gating a non-mod not leaking to the next mod, stacked attributes,
// and nested not() ranges. The goal called out cfg_attr, all/any/not, and
// submodule declarations as coverage risks; these pin them.
//
// Run: SKIP_LIVE=1 node --test test/impl-v3-cfgscan.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-v3-cfgscan",
  `export { scanCfgGates, resolvePublicFeature, buildGatingFeatures } from "../src/core/cfgScan";\n`
);
const { scanCfgGates, resolvePublicFeature, buildGatingFeatures } = mod;
test.after(cleanup);

test("cfg_attr is NOT a gate: the mod is always present", () => {
  const src = [
    `#[cfg_attr(feature = "docsrs", doc(cfg(feature = "aws")))]`,
    `pub mod aws;`,
  ].join("\n");
  assert.strictEqual(scanCfgGates(src).has("aws"), false, "cfg_attr conditionally applies an attribute, it does not gate presence");
});

test("multi-line cfg(all(...)) accumulates to one attribute; first positive feature wins", () => {
  const src = [
    `#[cfg(all(`,
    `    feature = "cloud-base",`,
    `    not(target_arch = "wasm32")`,
    `))]`,
    `pub mod client;`,
  ].join("\n");
  assert.strictEqual(scanCfgGates(src).get("client"), "cloud-base");
});

test("pub(crate) mod and bare mod forms are recognized", () => {
  const src = [
    `#[cfg(feature = "a")]`,
    `pub(crate) mod one;`,
    `#[cfg(feature = "b")]`,
    `mod two;`,
  ].join("\n");
  const g = scanCfgGates(src);
  assert.strictEqual(g.get("one"), "a");
  assert.strictEqual(g.get("two"), "b");
});

test("inline `mod x { }` form is gated too", () => {
  const src = [`#[cfg(feature = "inl")]`, `pub mod inl {`, `    pub struct S;`, `}`].join("\n");
  assert.strictEqual(scanCfgGates(src).get("inl"), "inl");
});

test("a cfg gating a non-mod (fn) does not leak to the following ungated mod", () => {
  const src = [
    `#[cfg(feature = "x")]`,
    `pub fn helper() {}`,
    `pub mod ungated;`,
  ].join("\n");
  assert.strictEqual(scanCfgGates(src).has("ungated"), false, "the cfg gated the fn; the next mod is ungated");
});

test("stacked non-cfg attributes between the cfg and the mod are skipped", () => {
  const src = [
    `#[cfg(feature = "stk")]`,
    `#[doc = "hidden"]`,
    `#[allow(missing_docs)]`,
    ``,
    `pub mod stk;`,
  ].join("\n");
  assert.strictEqual(scanCfgGates(src).get("stk"), "stk");
});

test("nested not() correctly negates a feature inside it but not one outside", () => {
  // feature "keep" is positive; feature "drop" is inside not(any(...)).
  const src = [
    `#[cfg(all(feature = "keep", not(any(feature = "drop", target_os = "none"))))]`,
    `pub mod m;`,
  ].join("\n");
  assert.strictEqual(scanCfgGates(src).get("m"), "keep");
});

test("only-negated-feature gate records nothing", () => {
  const src = [`#[cfg(not(feature = "legacy"))]`, `pub mod modern;`].join("\n");
  assert.strictEqual(scanCfgGates(src).has("modern"), false);
});

test("resolvePublicFeature: an internal -base token with no parent yields undefined", () => {
  // orphan-base is a key but nothing enables it and it enables nothing that roots.
  const features = { "orphan-base": [], other: ["x"] };
  assert.strictEqual(resolvePublicFeature(features, "orphan-base", "orphan"), undefined);
});

test("resolvePublicFeature: token present only as a referenced dep (not a key) still resolves via non-base rule", () => {
  const features = { wrapper: ["some-dep"] };
  // some-dep is referenced but not a key; not internal -> returned as-is.
  assert.strictEqual(resolvePublicFeature(features, "some-dep", "x"), "some-dep");
});

// --- F1 fail-safe: internal tokens never steered raw ------------------------
test("resolvePublicFeature: a __-hidden token climbs to its nearest PUBLIC ancestors (reqwest __tls shape)", () => {
  // reqwest: mod tls gated by __tls (hidden); __native-tls/__rustls (hidden)
  // enable __tls; native-tls/rustls (public) enable those.
  const features = {
    "default-tls": ["__tls", "__native-tls"],
    "native-tls": ["__native-tls"],
    rustls: ["__rustls"],
    "__native-tls": ["__tls"],
    "__rustls": ["__tls"],
    "__tls": ["dep:pki"],
  };
  // Public ancestors reaching __tls: default-tls, native-tls, rustls -> alpha-first.
  assert.strictEqual(resolvePublicFeature(features, "__tls", "tls"), "default-tls");
});

test("resolvePublicFeature: a purely-internal token no public feature reaches -> undefined (no wrong steer)", () => {
  // h2 shape: `unstable` gates proto, nothing public enables `unstable`.
  const features = { unstable: ["dep:x"], default: ["stream"], stream: ["dep:s"] };
  assert.strictEqual(resolvePublicFeature(features, "unstable", "proto"), undefined);
});

test("resolvePublicFeature: __private / rustc-internal-api markers are internal", () => {
  assert.strictEqual(resolvePublicFeature({ "__private": [] }, "__private", "test_helpers"), undefined);
  assert.strictEqual(resolvePublicFeature({ "rustc-internal-api": [] }, "rustc-internal-api", "rustc_entry"), undefined);
});

test("buildGatingFeatures never emits an internal token as a value (fail-safe end to end)", () => {
  const src = [`#[cfg(feature = "__secret")]`, `pub mod hidden;`].join("\n");
  const features = { "__secret": ["dep:x"] }; // no public parent
  const g = buildGatingFeatures(src, features);
  assert.strictEqual(g.has("hidden"), false, "no public feature reaches __secret -> module omitted, not steered to __secret");
});
