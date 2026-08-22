// Blind oracle: enabled-optional buildCatalog against the FROZEN phase-3
// catalog contract. buildCatalog(metadata) is pure over one `cargo metadata`
// object and now ALSO surfaces OPTIONAL direct
// deps that the active feature set actually compiled: an optional manifest dep
// is included iff the member's resolve node carries a normal (kind:null) dep
// entry whose resolved PACKAGE-ID matches it, and it is listed under the resolve
// dep's IMPORT name (extern crate), not the package/manifest name. Package `md-5`
// (import name `md5`) is the crux: matching by name fails, by package-id wins.
// Dev/build-only, not-enabled optionals, and the transitive graph stay excluded;
// when resolve (or the member node) is absent the pre-change behavior holds.
// Never read src/**; expected red where the enabled-optional logic is not yet
// implemented (today all optionals are dropped -> the enabled cases underflow).
//
// Run: SKIP_LIVE=1 node --test test/blind-v3-catalog.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "blind-v3-catalog",
  `export { buildCatalog } from "../src/core/catalog";\n`
);
const { buildCatalog } = mod;
test.after(cleanup);

const fixture = (name) =>
  JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "cargo-metadata", name), "utf8"));

const names = (md) => buildCatalog(md).map((e) => e.name);

// --- 1. Default feature set: the optional serde (in `default`) is enabled and
// listed; the other optionals (md-5, regex) are not enabled and stay absent. ---
test("cattest-default: enabled optional serde is listed, unenabled md-5/regex absent", () => {
  const md = fixture("cattest-default.json");
  const got = names(md);
  assert.deepStrictEqual(got, ["fastbloom", "serde"]);
  assert.ok(!got.includes("md-5"), "md-5 optional-not-enabled -> absent");
  assert.ok(!got.includes("md5"), "md5 not enabled here either -> absent");
  assert.ok(!got.includes("regex"), "regex optional-not-enabled -> absent");
});

// --- 2. The crux: `hashing = ["md-5"]` enables package md-5, surfaced under its
// IMPORT name `md5` (the resolve dep name), proving package-id match + import
// name resolution. The manifest/package name `md-5` is never a catalog name. ---
test("cattest-hashing: package md-5 enabled via feature is listed by IMPORT name md5, not md-5", () => {
  const md = fixture("cattest-hashing.json");
  const got = names(md);
  assert.deepStrictEqual(got, ["fastbloom", "md5", "serde"]);
  assert.ok(got.includes("md5"), "import name md5 present");
  assert.ok(!got.includes("md-5"), "package name md-5 is never a catalog name");
  const entry = buildCatalog(md).find((e) => e.name === "md5");
  assert.ok(entry, "md5 entry exists");
  assert.ok(
    typeof entry.description === "string" && entry.description.length > 0,
    "md5 entry carries a non-empty description from the resolved package"
  );
});

// --- 3. Backward compat: installed.json's member node is NOT in resolve.nodes,
// so no optional is added. serde (optional) stays excluded; the frozen normal-dep
// result is unchanged. This must not regress. ---
test("installed: unchanged backward-compat result, optional serde stays excluded (no member resolve node)", () => {
  const md = fixture("installed.json");
  const got = names(md);
  assert.deepStrictEqual(got, ["fastbloom", "http_client", "object_store"]);
  assert.ok(!got.includes("serde"), "serde optional excluded: member node absent from resolve.nodes");
});

// A cargo-metadata manifest dep in the shape the fixtures use.
const dep = (name, over = {}) => ({
  name,
  source: "registry+https://github.com/rust-lang/crates.io-index",
  req: "^1",
  kind: null,
  rename: null,
  optional: false,
  uses_default_features: true,
  features: [],
  target: null,
  registry: null,
  ...over,
});
const pkgId = (name) => `registry+https://github.com/rust-lang/crates.io-index#${name}@1.0.0`;
const MEMBER_ID = "path+file:///w/app#0.1.0";

// --- 4. An optional dep whose resolve node dep is enabled ONLY as a dev-dep
// (dep_kinds all `dev`, no normal kind:null) is never in the catalog, even though
// it IS present in resolve.nodes. Only a normal (kind:null) enablement counts. ---
test("hand-built: optional enabled only as a dev-dependency in the resolve node is excluded", () => {
  const md = {
    packages: [
      {
        name: "app",
        id: MEMBER_ID,
        description: null,
        dependencies: [dep("core"), dep("fancy", { optional: true })],
      },
      { name: "core", id: pkgId("core"), description: "Core runtime bits.", dependencies: [] },
      { name: "fancy", id: pkgId("fancy"), description: "Dev-only helper.", dependencies: [] },
    ],
    workspace_members: [MEMBER_ID],
    resolve: {
      nodes: [
        {
          id: MEMBER_ID,
          dependencies: [pkgId("core"), pkgId("fancy")],
          deps: [
            { name: "core", pkg: pkgId("core"), dep_kinds: [{ kind: null, target: null }] },
            { name: "fancy", pkg: pkgId("fancy"), dep_kinds: [{ kind: "dev", target: null }] },
          ],
          features: [],
        },
      ],
    },
    version: 1,
  };
  const got = names(md);
  assert.deepStrictEqual(got, ["core"]);
  assert.ok(!got.includes("fancy"), "dev-only enablement never enters the catalog");
});

// --- 5. Backward-compat path: `resolve` entirely absent. No optional deps are
// added; normal deps are still listed exactly as before. ---
test("hand-built: resolve entirely absent -> optionals excluded, normal deps still listed", () => {
  const md = {
    packages: [
      {
        name: "app",
        id: MEMBER_ID,
        description: null,
        dependencies: [dep("core"), dep("opt", { optional: true })],
      },
      { name: "core", id: pkgId("core"), description: "Core runtime bits.", dependencies: [] },
      { name: "opt", id: pkgId("opt"), description: "An optional extra.", dependencies: [] },
    ],
    workspace_members: [MEMBER_ID],
    version: 1,
  };
  const got = names(md);
  assert.deepStrictEqual(got, ["core"]);
  assert.ok(!got.includes("opt"), "no resolve -> no optional promotion");
});
