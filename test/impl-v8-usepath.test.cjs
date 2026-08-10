// Implementer oracle for v8 (A): deriveUsePath turns a resolved type's definition
// file into the `use` path a blind test imports it from. Pure — the filesystem is
// injected, so these run headless against synthetic crate layouts.
//
// Run: SKIP_LIVE=1 node --test test/impl-v8-usepath.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-v8-usepath",
  `export { deriveUsePath, renderImportHint } from "../src/core/usePath";\n`,
);
const { deriveUsePath, renderImportHint } = mod;
test.after(cleanup);

// A synthetic fs: `files` is a set of existing paths; `contents` maps path->text.
function fsOf(files, contents = {}) {
  return {
    fileExists: (p) => files.has(p),
    readFile: (p) => (p in contents ? contents[p] : undefined),
  };
}

const PG = "/repo/crates/playground";
const PG_FILES = new Set([`${PG}/Cargo.toml`]);
const target = `${PG}/src/tdd.rs`;

test("same-crate module file: src/orders.rs -> crate::orders", () => {
  assert.strictEqual(deriveUsePath(`${PG}/src/orders.rs`, target, fsOf(PG_FILES)), "crate::orders");
});

test("same-crate nested module: src/domain/orders.rs -> crate::domain::orders", () => {
  assert.strictEqual(deriveUsePath(`${PG}/src/domain/orders.rs`, target, fsOf(PG_FILES)), "crate::domain::orders");
});

test("mod.rs is the module itself: src/domain/mod.rs -> crate::domain", () => {
  assert.strictEqual(deriveUsePath(`${PG}/src/domain/mod.rs`, target, fsOf(PG_FILES)), "crate::domain");
});

test("crate-root files land at `crate`: src/lib.rs and src/main.rs", () => {
  assert.strictEqual(deriveUsePath(`${PG}/src/lib.rs`, target, fsOf(PG_FILES)), "crate");
  assert.strictEqual(deriveUsePath(`${PG}/src/main.rs`, target, fsOf(PG_FILES)), "crate");
});

test("cross-crate: another crate's src/lib.rs -> <crate_name> from its Cargo.toml", () => {
  const files = new Set([`${PG}/Cargo.toml`, "/repo/crates/atlas/Cargo.toml"]);
  const contents = { "/repo/crates/atlas/Cargo.toml": "[package]\nname = \"atlas\"\nversion = \"0.1.0\"\n" };
  assert.strictEqual(deriveUsePath("/repo/crates/atlas/src/lib.rs", target, fsOf(files, contents)), "atlas");
  assert.strictEqual(deriveUsePath("/repo/crates/atlas/src/geo.rs", target, fsOf(files, contents)), "atlas::geo");
});

test("cross-crate name hyphens normalize to underscores", () => {
  const files = new Set([`${PG}/Cargo.toml`, "/repo/crates/my-lib/Cargo.toml"]);
  const contents = { "/repo/crates/my-lib/Cargo.toml": "[package]\nname = \"my-lib\"\n" };
  assert.strictEqual(deriveUsePath("/repo/crates/my-lib/src/lib.rs", target, fsOf(files, contents)), "my_lib");
});

test("section-aware: a dependency's name is not mistaken for the package name", () => {
  const files = new Set([`${PG}/Cargo.toml`, "/repo/crates/atlas/Cargo.toml"]);
  const contents = {
    "/repo/crates/atlas/Cargo.toml": "[package]\nname = \"atlas\"\n\n[dependencies]\nserde = \"1\"\nname = \"decoy\"\n",
  };
  assert.strictEqual(deriveUsePath("/repo/crates/atlas/src/lib.rs", target, fsOf(files, contents)), "atlas");
});

test("honest degrade -> undefined: def not under src/, no crate root, unreadable cross-crate name", () => {
  // A def outside the crate's src/ (e.g. a tests/ helper) has no module path.
  assert.strictEqual(deriveUsePath(`${PG}/tests/helper.rs`, target, fsOf(PG_FILES)), undefined);
  // No Cargo.toml anywhere up the tree.
  assert.strictEqual(deriveUsePath("/nowhere/src/foo.rs", target, fsOf(new Set())), undefined);
  // Cross-crate but the Cargo.toml has no readable package name.
  const files = new Set([`${PG}/Cargo.toml`, "/repo/crates/atlas/Cargo.toml"]);
  assert.strictEqual(deriveUsePath("/repo/crates/atlas/src/lib.rs", target, fsOf(files, {})), undefined);
});

// ---------------------------------------------------------------------------
// renderImportHint: group resolved types by module path into `use` lines.
// ---------------------------------------------------------------------------

test("groups same-module types into one `use path::{A, B, ...};`, names sorted", () => {
  const hint = renderImportHint(
    [
      { name: "Order", defPath: `${PG}/src/orders.rs` },
      { name: "Customer", defPath: `${PG}/src/orders.rs` },
      { name: "Address", defPath: `${PG}/src/orders.rs` },
    ],
    target,
    fsOf(PG_FILES),
  );
  assert.strictEqual(hint, "use crate::orders::{Address, Customer, Order};");
});

test("a single type from a module renders without braces", () => {
  const hint = renderImportHint([{ name: "Order", defPath: `${PG}/src/orders.rs` }], target, fsOf(PG_FILES));
  assert.strictEqual(hint, "use crate::orders::Order;");
});

test("multiple modules -> one `use` line each, module paths sorted", () => {
  const hint = renderImportHint(
    [
      { name: "Widget", defPath: `${PG}/src/ui.rs` },
      { name: "Order", defPath: `${PG}/src/orders.rs` },
    ],
    target,
    fsOf(PG_FILES),
  );
  assert.strictEqual(hint, "use crate::orders::Order;\nuse crate::ui::Widget;");
});

test("types whose path cannot be derived are skipped; undefined when nothing resolves", () => {
  // One derivable, one outside src/: only the derivable one appears.
  const mixed = renderImportHint(
    [
      { name: "Order", defPath: `${PG}/src/orders.rs` },
      { name: "Helper", defPath: `${PG}/tests/helper.rs` },
    ],
    target,
    fsOf(PG_FILES),
  );
  assert.strictEqual(mixed, "use crate::orders::Order;");
  // None derivable -> undefined (no guessed import).
  assert.strictEqual(
    renderImportHint([{ name: "Helper", defPath: `${PG}/tests/helper.rs` }], target, fsOf(PG_FILES)),
    undefined,
  );
});
