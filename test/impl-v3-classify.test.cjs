// Implementer tests for the classifier spine: the mechanism and edge cases the
// blind contract (blind-v3-classify) cannot see from outside - multi-word rustc
// namespaces, the disambiguation precedence (gate beats installed), the
// first-segment crate extraction from a deep module path, and the needs-feature
// payload's shape + offline property. Seeing the internals is the privilege the
// blind oracle deliberately lacks.
//
// Run: SKIP_LIVE=1 node --test test/impl-v3-classify.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-v3-classify",
  `export { classifyHallucination, assembleNeedsFeaturePayload, FIRM_INSTRUCTION } from "../src/core/compilerDirected";\n`
);
const { classifyHallucination, assembleNeedsFeaturePayload, FIRM_INSTRUCTION } = mod;
test.after(cleanup);

const primarySpan = (over = {}) => ({
  fileName: "src/main.rs",
  byteStart: 0, byteEnd: 0,
  lineStart: 5, lineEnd: 5, columnStart: 12, columnEnd: 20,
  isPrimary: true, ...over,
});
const CURSOR = { line: 4, character: 11 };
const diag = (over = {}) => ({
  kind: "compile-error", level: "error", code: undefined,
  message: "", spans: [primarySpan()], suggestions: [], ...over,
});
const resolution = (spec = {}) => ({
  isInstalledCrate: (c) => new Set(spec.installed ?? []).has(c),
  gatingFeature: (c, m) => (spec.gates ?? {})[`${c}::${m}`],
});

// --- E0425/E0412 multi-word namespace: the NS is lazily consumed -------------
const nsCases = [
  { ns: "associated type", item: "Assoc", crate: "serde" },
  { ns: "trait", item: "Frobnicate", crate: "tokio" },
  { ns: "type alias", item: "Alias", crate: "hyper" },
  { ns: "constant", item: "MAX", crate: "num" },
];
for (const { ns, item, crate } of nsCases) {
  test(`E0425 namespace "${ns}" is not part of the class; item/crate are`, () => {
    const d = diag({ code: "E0425", message: `cannot find ${ns} \`${item}\` in crate \`${crate}\`` });
    assert.deepStrictEqual(classifyHallucination(d), { kind: "wrong-item", crate, item, cursor: CURSOR });
  });
}

// --- Deep module path: crate is the FIRST segment (what the extractor wants) --
test("E0425 in module a::b::c -> crate is first segment a", () => {
  const d = diag({ code: "E0425", message: "cannot find type `X` in module `alpha::beta::gamma`" });
  assert.deepStrictEqual(classifyHallucination(d), { kind: "wrong-item", crate: "alpha", item: "X", cursor: CURSOR });
});

// --- E0433 disambiguation precedence: a gated module beats installed-crate ----
test("E0433 gate wins over installed: gatingFeature defined -> needs-feature even though crate is installed", () => {
  const d = diag({ code: "E0433", message: "cannot find `aws` in `object_store`" });
  const res = resolution({ installed: ["object_store"], gates: { "object_store::aws": "aws" } });
  assert.deepStrictEqual(classifyHallucination(d, res), {
    kind: "needs-feature", crate: "object_store", module: "aws", feature: "aws", cursor: CURSOR,
  });
});

test("E0433 internal gate token resolved to a DIFFERENT public feature name", () => {
  // The cfg-scan's whole point: the literal gate token (`aws-base`) is internal;
  // gatingFeature returns the public feature (`aws`) that pulls it in.
  const d = diag({ code: "E0433", message: "cannot find `aws` in `object_store`" });
  const res = resolution({ installed: ["object_store"], gates: { "object_store::aws": "aws-public" } });
  assert.strictEqual(classifyHallucination(d, res).feature, "aws-public");
});

test("E0433 deep-submodule miss -> undefined: rustc names the LEAF module, not the crate", () => {
  // Real captured rustc 1.96 message for `object_store::path::Foo::new()` (Foo
  // invented, `path` a real submodule of object_store): Y is the immediate
  // parent module `path`, NOT `object_store::path`. The classifier sees only
  // `path`, cannot map it to the installed crate object_store from the message
  // alone, so it returns undefined (a safe miss, rides plain repair). Deepening
  // this to catch a submodule-nested invented item needs the resolution to map a
  // module to its crate - DEFERRED to phases 2-3 (scraps). This pins the honest
  // phase-1 behavior against the message rustc actually emits.
  const d = diag({ code: "E0433", message: "cannot find `Foo` in `path`" });
  const res = resolution({ installed: ["object_store"] }); // `path` is not itself an installed crate
  assert.strictEqual(classifyHallucination(d, res), undefined);
});

// --- E0432 import form of needs-feature (the COMMON trigger; live-found) -----
test("E0432 import of a cfg-gated module -> needs-feature (real `use object_store::aws` shape)", () => {
  // A generated function body reaches a crate API through a `use`, so a gated
  // module surfaces as E0432 `unresolved import`, not E0433. rustc truncates to
  // the first unresolvable segment, so the gated module is the last segment.
  const d = diag({ code: "E0432", message: "unresolved import `object_store::aws`" });
  const res = resolution({ installed: ["object_store"], gates: { "object_store::aws": "aws" } });
  assert.deepStrictEqual(classifyHallucination(d, res), {
    kind: "needs-feature", crate: "object_store", module: "aws", feature: "aws", cursor: CURSOR,
  });
});

test("E0432 import of an invented item (no matching gate) stays wrong-item, resolution-independent", () => {
  const d = diag({ code: "E0432", message: "unresolved import `fastbloom::Bloom`" });
  const res = resolution({ installed: ["fastbloom"], gates: { "fastbloom::sub": "extra" } });
  const expected = { kind: "wrong-item", crate: "fastbloom", item: "Bloom", cursor: CURSOR };
  assert.deepStrictEqual(classifyHallucination(d, res), expected);
  assert.deepStrictEqual(classifyHallucination(d), expected, "identical without resolution");
});

// --- n1 guard: crate/self/super excluded, installed-before-gate --------------
test("E0433 `X in crate` (local path) -> undefined even with a resolving resolution", () => {
  const d = diag({ code: "E0433", message: "cannot find `NopeThing` in `crate`" });
  const res = resolution({ installed: ["crate"], gates: { "crate::NopeThing": "x" } });
  assert.strictEqual(classifyHallucination(d, res), undefined);
});

test("E0433 `X in self` / `in super` -> undefined (local paths)", () => {
  for (const y of ["self", "super"]) {
    const d = diag({ code: "E0433", message: `cannot find \`Foo\` in \`${y}\`` });
    assert.strictEqual(classifyHallucination(d, resolution({ installed: [y] })), undefined);
  }
});

test("E0433 needs-feature requires the crate be installed FIRST (a gate on a non-installed crate is ignored)", () => {
  // A stale/buggy resolution that gates aws but does not report object_store
  // installed must NOT emit needs-feature for a crate the user cannot enable on.
  const d = diag({ code: "E0433", message: "cannot find `aws` in `object_store`" });
  const res = resolution({ installed: [], gates: { "object_store::aws": "aws" } });
  assert.strictEqual(classifyHallucination(d, res), undefined);
});

// --- needs-feature payload: shape + the offline invariant --------------------
test("assembleNeedsFeaturePayload names crate, module and feature", () => {
  const p = assembleNeedsFeaturePayload({ crate: "object_store", module: "aws", feature: "aws" });
  assert.match(p, /object_store::aws/);
  assert.match(p, /`aws`/);
  assert.match(p, /Cargo\.toml/);
});

test("assembleNeedsFeaturePayload does NOT carry FIRM_INSTRUCTION (no API surface to constrain to)", () => {
  const p = assembleNeedsFeaturePayload({ crate: "c", module: "m", feature: "f" });
  assert.ok(!p.includes(FIRM_INSTRUCTION), "terminal steering references no injected surface");
});

test("assembleNeedsFeaturePayload emits no rust code fence (it is not a worked example)", () => {
  const p = assembleNeedsFeaturePayload({ crate: "c", module: "m", feature: "f" });
  assert.ok(!/```rust/.test(p), "no rust fence: there is no example, the fix is a Cargo.toml edit");
});

test("assembleNeedsFeaturePayload reaches no network (offline invariant)", () => {
  const p = assembleNeedsFeaturePayload({ crate: "c", module: "m", feature: "f" });
  assert.ok(!/https?:|docs\.rs|crates\.io/.test(p), "no URL/registry host in the payload");
});
