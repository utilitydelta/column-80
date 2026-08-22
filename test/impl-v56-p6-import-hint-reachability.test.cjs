// IMPLEMENTER (white-box) - session-v56 phase 6, item 56: "the import hint
// derives paths that compile". A blind oracle
// (`test/blind-v56-p6-import-hint-reachability.test.cjs`) tests the same
// behaviour from the contract alone. This file tests the seams the blind file
// cannot see:
//
//  1. THE MECHANISM IS SHARED, NOT FORKED (contract clause 5). The walk lives in
//     `src/core/rustReach.ts` and has exactly two callers: `renderImportHint`
//     (the fn-gen pre-fill hint) and `importLineFor`'s Rust row (the Tighten Doc
//     Comment gesture's ratification). The table below drives BOTH over one
//     fixture and asserts they name the same path, so a future copy-paste fork
//     that fixes one and not the other goes red here.
//  2. THE POLICY SPLIT IS THE ONLY DIFFERENCE between them: what "reachability
//     could not be proven" means. The gesture refuses on absence; the hint keeps
//     today's render on absence and refuses only on a disproof. That reading is
//     the loop driver's ruling for the tension between contract clauses 2 and 3.
//  3. The shapes with no blind row: nested and chained re-exports, a
//     self-referential module (must not hang), two candidate public paths, and
//     the status of the sysroot carve-out (clause 6).
//
// Run: SKIP_LIVE=1 node --test test/impl-v56-p6-import-hint-reachability.test.cjs

const test = require("node:test");
const assert = require("node:assert/strict");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-v56-p6-reach",
  `export { deriveUsePath, renderImportHint } from "../src/core/usePath";
export { importLineFor } from "../src/core/tightenRatify";\n`,
);
const { deriveUsePath, renderImportHint, importLineFor } = mod;
test.after(cleanup);

// A synthetic fs: `files` are paths that exist, `contents` maps path -> text and
// implies existence, so a fixture cannot describe a readable file that is absent.
function fsOf(contents, extraFiles = []) {
  const exists = new Set([...Object.keys(contents), ...extraFiles]);
  return {
    fileExists: (p) => exists.has(p),
    readFile: (p) => (p in contents ? contents[p] : undefined),
    workspaceRoot: "/repo",
  };
}
const manifest = (name, deps = "") => `[package]\nname = "${name}"\nversion = "0.1.0"\nedition = "2021"\n${deps}`;

const PG = "/repo/crates/playground";
const TARGET = `${PG}/tests/gen_build_store.rs`;
const STRUCT_KIND = 22; // vscode SymbolKind.Struct

// The two entry points, reduced to the one thing they have in common: the `use`
// path they name for one type. `undefined` on either side is a refusal.
const hintPath = (name, defPath, deps, target = TARGET) => {
  const line = renderImportHint([{ name, defPath }], target, deps);
  return line === undefined ? undefined : line.replace(/^use /, "").replace(/;$/, "");
};
const ratifyPath = (name, defPath, deps, target = TARGET) => {
  const row = importLineFor("rust", { name, kind: STRUCT_KIND, kindScheme: "vscode", path: defPath }, target, deps);
  return row === undefined ? undefined : row.importLine.replace(/^use /, "").replace(/;$/, "");
};

// ===========================================================================
// PART 1. ONE MECHANISM, TWO CALLERS.
//
// Every fixture here is fully readable, which is the region where the two
// policies AGREE by construction - so any divergence is a fork in the walk
// itself, which is exactly what clause 5 forbids.
// ===========================================================================

const SHARED = [
  {
    what: "a private module with a crate-root `pub use`",
    name: "Order",
    def: `${PG}/src/store.rs`,
    expect: "crate::Order",
    contents: {
      [`${PG}/Cargo.toml`]: manifest("playground"),
      [`${PG}/src/lib.rs`]: `mod store;\npub use store::Order;\n`,
      [`${PG}/src/store.rs`]: `pub struct Order {\n    pub id: u32,\n}\n`,
    },
  },
  {
    what: "a fully public nested chain, which the walk must leave alone",
    name: "Order",
    def: `${PG}/src/domain/orders.rs`,
    expect: "crate::domain::orders::Order",
    contents: {
      [`${PG}/Cargo.toml`]: manifest("playground"),
      [`${PG}/src/lib.rs`]: `pub mod domain;\n`,
      [`${PG}/src/domain/mod.rs`]: `pub mod orders;\n`,
      [`${PG}/src/domain/orders.rs`]: `pub struct Order {\n    pub id: u32,\n}\n`,
    },
  },
  {
    what: "a `pub(crate)` module read from inside its own crate",
    name: "Order",
    def: `${PG}/src/store.rs`,
    expect: "crate::store::Order",
    contents: {
      [`${PG}/Cargo.toml`]: manifest("playground"),
      [`${PG}/src/lib.rs`]: `pub(crate) mod store;\n`,
      [`${PG}/src/store.rs`]: `pub struct Order {\n    pub id: u32,\n}\n`,
    },
  },
  {
    what: "a cross-crate private module the dependency re-exports at its root",
    name: "Coord",
    def: "/repo/crates/atlas/src/geo.rs",
    expect: "atlas::Coord",
    contents: {
      [`${PG}/Cargo.toml`]: manifest("playground", `\n[dependencies]\natlas = { path = "../atlas" }\n`),
      "/repo/crates/atlas/Cargo.toml": manifest("atlas"),
      "/repo/crates/atlas/src/lib.rs": `mod geo;\npub use geo::Coord;\n`,
      "/repo/crates/atlas/src/geo.rs": `pub struct Coord {\n    pub lat: f64,\n}\n`,
    },
  },
  {
    what: "a re-export naming a DIFFERENT type: no route exists, so both refuse",
    name: "Order",
    def: `${PG}/src/store.rs`,
    expect: undefined,
    contents: {
      [`${PG}/Cargo.toml`]: manifest("playground"),
      [`${PG}/src/lib.rs`]: `mod store;\npub use store::Customer;\n`,
      [`${PG}/src/store.rs`]: `pub struct Order {\n    pub id: u32,\n}\npub struct Customer;\n`,
    },
  },
  {
    what: "a type that is not `pub`: a `pub use` cannot rescue it, so both refuse",
    name: "Order",
    def: `${PG}/src/store.rs`,
    expect: undefined,
    contents: {
      [`${PG}/Cargo.toml`]: manifest("playground"),
      [`${PG}/src/lib.rs`]: `pub mod store;\n`,
      [`${PG}/src/store.rs`]: `struct Order {\n    id: u32,\n}\n`,
    },
  },
];

for (const f of SHARED) {
  test(`[shared mechanism] ${f.what}: the pre-fill hint and the ratification row name the SAME path`, () => {
    const deps = fsOf(f.contents);
    const viaHint = hintPath(f.name, f.def, deps);
    const viaRatify = ratifyPath(f.name, f.def, deps);
    assert.equal(
      viaHint,
      f.expect,
      `the pre-fill hint's path. Raw file-tree derivation was ${JSON.stringify(deriveUsePath(f.def, TARGET, deps))}.`,
    );
    assert.equal(
      viaHint,
      viaRatify,
      "clause 5: one walk, two callers. A divergence here means the reachability logic was COPIED into `usePath.ts` instead of shared, and the two copies have started to drift.",
    );
  });
}

test("[shared mechanism] the fork detector has teeth: the fixtures above exercise both a rewrite and a refusal", () => {
  // A guard on the table itself. If every row expected the file-tree path
  // unchanged, the equality above would hold for a `renderImportHint` that never
  // called the walk at all, and the whole of part 1 would pin nothing.
  const fileTree = (f) => `${deriveUsePath(f.def, TARGET, fsOf(f.contents))}::${f.name}`;
  const rewritten = SHARED.filter((f) => f.expect !== undefined && f.expect !== fileTree(f));
  const untouched = SHARED.filter((f) => f.expect !== undefined && f.expect === fileTree(f));
  const refused = SHARED.filter((f) => f.expect === undefined);
  assert.ok(rewritten.length >= 2, `at least two rows must be REWRITTEN by the walk, got ${rewritten.length}`);
  assert.ok(untouched.length >= 2, `at least two rows must pass through UNCHANGED, got ${untouched.length}`);
  assert.ok(refused.length >= 2, `at least two rows must be REFUSED by the walk, got ${refused.length}`);
});

// ===========================================================================
// PART 2. THE POLICY SPLIT, which is the ruling on contract clauses 2 vs 3.
//
// "Cannot be proven" means DISPROVEN OR AMBIGUOUS, not "no evidence was read".
// The gesture (precision is its ship condition, and it may say nothing) refuses
// on absence. The hint keeps today's render on absence, because the ordinary
// same-crate hint is derived with no crate source read at all.
// ===========================================================================

test("[policy] no crate source readable: the hint keeps today's path, the ratification row still refuses", () => {
  const deps = fsOf({}, [`${PG}/Cargo.toml`]);
  assert.equal(
    hintPath("Order", `${PG}/src/orders.rs`, deps),
    "crate::orders::Order",
    "clause 3 and the ruling: absence of evidence is not a disproof, so the shipped render survives.",
  );
  assert.equal(
    ratifyPath("Order", `${PG}/src/orders.rs`, deps),
    undefined,
    "clause 5: the Tighten gesture's v55 behaviour is untouched - it cannot verify the chain, so it does not claim it compiles.",
  );
});

test("[policy] the def file is readable but the module tree is not: still absence, still today's path", () => {
  const deps = fsOf(
    {
      [`${PG}/Cargo.toml`]: manifest("playground"),
      [`${PG}/src/orders.rs`]: `pub struct Order {\n    pub id: u32,\n}\n`,
    },
    [],
  );
  assert.equal(hintPath("Order", `${PG}/src/orders.rs`, deps), "crate::orders::Order");
  assert.equal(ratifyPath("Order", `${PG}/src/orders.rs`, deps), undefined);
});

test("[policy] a DISPROOF is refused by both, whatever the policy: readable source, private mod, no re-export", () => {
  const deps = fsOf({
    [`${PG}/Cargo.toml`]: manifest("playground"),
    [`${PG}/src/lib.rs`]: `mod store;\n`,
    [`${PG}/src/store.rs`]: `pub struct Order {\n    pub id: u32,\n}\n`,
  });
  assert.equal(
    hintPath("Order", `${PG}/src/store.rs`, deps),
    undefined,
    "clause 2: `crate::store::Order` is E0603 and there is no re-export. The `keep` policy covers absence, never a disproof.",
  );
  assert.equal(ratifyPath("Order", `${PG}/src/store.rs`, deps), undefined);
});

test("[policy] a `mod` the readable source never declares is absence, not a disproof: a cfg-gated module keeps its path", () => {
  // `modVisibility` cannot see through `#[cfg(...)]`, a `#[path]` attribute or a
  // macro-declared module, so it answers "not declared here". That is the walk
  // failing to READ the declaration, not reading a private one.
  const deps = fsOf({
    [`${PG}/Cargo.toml`]: manifest("playground"),
    [`${PG}/src/lib.rs`]: `#[cfg(unix)]\npub mod store;\n`,
    [`${PG}/src/store.rs`]: `pub struct Order {\n    pub id: u32,\n}\n`,
  });
  assert.equal(hintPath("Order", `${PG}/src/store.rs`, deps), "crate::store::Order");
  assert.equal(ratifyPath("Order", `${PG}/src/store.rs`, deps), undefined);
});

test("[policy] a non-Rust def file inside a cargo tree is not Rust evidence: its hint is unchanged (clause 4)", () => {
  // `deriveUsePath` is not language-gated, so a `.go` collaborator sitting under
  // a crate's `src/` gets a (nonsense) `use` path today. Running the Rust
  // visibility parser over it reads `type KeyConfig struct` as a non-`pub` Rust
  // type alias and would silently withhold a NON-RUST hint - the clause 4
  // violation `test/blind-v55-p9-std-usepath.test.cjs:222` catches.
  const deps = fsOf({
    [`${PG}/Cargo.toml`]: manifest("playground"),
    [`${PG}/src/svc/config.go`]: `package svc\n\ntype KeyConfig struct {\n\tSlots uint32\n}\n`,
  });
  assert.equal(
    hintPath("KeyConfig", `${PG}/src/svc/config.go`, deps),
    `${deriveUsePath(`${PG}/src/svc/config.go`, TARGET, deps)}::KeyConfig`,
    "byte-identical to the pre-phase-6 derivation: whatever the file-tree walk says, unchanged.",
  );
});

// ===========================================================================
// PART 3. SHAPES WITH NO BLIND ROW.
// ===========================================================================

test("[nested] a private module TWO levels down is republished at the nearest module that exports it", () => {
  const deps = fsOf({
    [`${PG}/Cargo.toml`]: manifest("playground"),
    [`${PG}/src/lib.rs`]: `pub mod net;\n`,
    [`${PG}/src/net/mod.rs`]: `pub mod tcp;\n`,
    [`${PG}/src/net/tcp/mod.rs`]: `mod stream;\npub use self::stream::TcpStream;\n`,
    [`${PG}/src/net/tcp/stream.rs`]: `pub struct TcpStream {\n    fd: i32,\n}\n`,
  });
  assert.equal(hintPath("TcpStream", `${PG}/src/net/tcp/stream.rs`, deps), "crate::net::tcp::TcpStream");
  assert.equal(ratifyPath("TcpStream", `${PG}/src/net/tcp/stream.rs`, deps), "crate::net::tcp::TcpStream");
});

test("[chain] a `pub use` of a `pub use`: the walk stops at the FIRST private segment, which is where the name is published", () => {
  // Every level republishes the type, so `crate::Thing` compiles and so does
  // `crate::a::Thing`. The walk refuses at `a` and takes the path built so far,
  // which is the shortest of the compiling paths - and, more to the point, it is
  // deterministic rather than a guess between them.
  const deps = fsOf({
    [`${PG}/Cargo.toml`]: manifest("playground"),
    [`${PG}/src/lib.rs`]: `mod a;\npub use a::Thing;\n`,
    [`${PG}/src/a/mod.rs`]: `mod b;\npub use b::Thing;\n`,
    [`${PG}/src/a/b/mod.rs`]: `mod c;\npub use c::Thing;\n`,
    [`${PG}/src/a/b/c.rs`]: `pub struct Thing;\n`,
  });
  assert.equal(hintPath("Thing", `${PG}/src/a/b/c.rs`, deps), "crate::Thing");
  assert.equal(ratifyPath("Thing", `${PG}/src/a/b/c.rs`, deps), "crate::Thing");
});

test("[chain] a grouped, multi-line `pub use crate::{ … }` at the root is one re-export, not text the scan trips over", () => {
  const deps = fsOf({
    [`${PG}/Cargo.toml`]: manifest("playground"),
    [`${PG}/src/lib.rs`]: `mod byte_slice_ext;\nmod store;\n\npub use crate::{\n    byte_slice_ext::{ByteSliceExt, ByteSliceMutExt},\n    store::{Customer, Order},\n};\n`,
    [`${PG}/src/store.rs`]: `pub struct Order;\npub struct Customer;\n`,
  });
  assert.equal(hintPath("Order", `${PG}/src/store.rs`, deps), "crate::Order");
});

test("[ambiguity] TWO candidate public paths for one type: the walk names one deterministically and never emits both", () => {
  // `crate::Thing` (the root re-export) and `crate::alpha::Thing` (a second
  // re-export in a public module) both compile. There is no evidence that ranks
  // them, so the requirement is determinism and a single line, not a choice.
  const contents = {
    [`${PG}/Cargo.toml`]: manifest("playground"),
    [`${PG}/src/lib.rs`]: `mod internal;\npub mod alpha;\npub use internal::Thing;\n`,
    [`${PG}/src/alpha/mod.rs`]: `pub use crate::internal::Thing;\n`,
    [`${PG}/src/internal.rs`]: `pub struct Thing;\n`,
  };
  const deps = fsOf(contents);
  const line = renderImportHint([{ name: "Thing", defPath: `${PG}/src/internal.rs` }], TARGET, deps);
  assert.equal(line, "use crate::Thing;");
  assert.equal(line.split("\n").length, 1, "one type contributes one line, never a menu of candidates");
  assert.equal(
    renderImportHint([{ name: "Thing", defPath: `${PG}/src/internal.rs` }], TARGET, fsOf(contents)),
    line,
    "and the same fixture answers the same way twice: the walk is deterministic, not order-dependent on a set.",
  );
});

test("[ambiguity] a DEEPER glob (`seg::inner::*`) does not prove the name is carried, so it is refused", () => {
  const deps = fsOf({
    [`${PG}/Cargo.toml`]: manifest("playground"),
    [`${PG}/src/lib.rs`]: `mod store;\npub use store::inner::*;\n`,
    [`${PG}/src/store.rs`]: `pub struct Order;\n`,
  });
  assert.equal(
    hintPath("Order", `${PG}/src/store.rs`, deps),
    undefined,
    "the glob only carries `Order` if `Order` is in `store::inner`, and nothing here can see that. A `probably` is a refusal.",
  );
});

test("[ambiguity] a glob ABOVE the def's own module does not carry the name", () => {
  // The real shape, from fraction-0.15.3: `pub use fraction::*;` at the root
  // over a def in `fraction/display.rs`. A glob re-exports one module's items,
  // not its children's, so the old accept rendered `use crate::Format;` and
  // rustc answered E0432. A glob counts only at the def's OWN module.
  const deps = fsOf({
    [`${PG}/Cargo.toml`]: manifest("playground"),
    [`${PG}/src/lib.rs`]: `mod fraction;\npub use fraction::*;\n`,
    [`${PG}/src/fraction/mod.rs`]: `pub mod display;\n`,
    [`${PG}/src/fraction/display.rs`]: `pub struct Format;\n`,
  });
  assert.equal(hintPath("Format", `${PG}/src/fraction/display.rs`, deps), undefined);
  assert.equal(ratifyPath("Format", `${PG}/src/fraction/display.rs`, deps), undefined);
});

test("[ambiguity] a same-named SIBLING re-export does not publish this def", () => {
  // The worst failure mode this walk can have: accepting the sibling rendered
  // `use crate::Error;`, which COMPILES and binds codec::json::Error while the
  // def is codec::bin::Error. A hint that fails loudly beats one that is wrong
  // and silent, under a header telling the model the import is already defined.
  const deps = fsOf({
    [`${PG}/Cargo.toml`]: manifest("playground"),
    [`${PG}/src/lib.rs`]: `mod codec;\npub use codec::json::Error;\n`,
    [`${PG}/src/codec/mod.rs`]: `pub mod json;\npub mod bin;\n`,
    [`${PG}/src/codec/json.rs`]: `pub struct Error { pub json_only: u8 }\n`,
    [`${PG}/src/codec/bin.rs`]: `pub struct Error { pub bin_only: u16 }\n`,
  });
  assert.equal(hintPath("Error", `${PG}/src/codec/bin.rs`, deps), undefined);
  assert.equal(ratifyPath("Error", `${PG}/src/codec/bin.rs`, deps), undefined);
});

test("[policy] `#[cfg_attr(...)]` applies an attribute, it does not gate existence", () => {
  // cfg_attr with the feature off leaves the item present, so rustc accepts the
  // import. Reading it as a gate withheld the hint from the serde optional
  // derive and the docs.rs badge. `test/impl-v3-cfgscan.test.cjs` pins the same
  // ruling for the module scanner - the two must not drift apart.
  const withAttr = (attr) =>
    fsOf({
      [`${PG}/Cargo.toml`]: manifest("playground"),
      [`${PG}/src/lib.rs`]: `pub mod store;\n`,
      [`${PG}/src/store.rs`]: `${attr}\npub struct Order;\n`,
    });
  assert.equal(
    hintPath("Order", `${PG}/src/store.rs`, withAttr(`#[cfg_attr(feature = "serde", derive(Serialize))]`)),
    "crate::store::Order",
  );
  assert.equal(
    hintPath("Order", `${PG}/src/store.rs`, withAttr(`#[cfg_attr(docsrs, doc(cfg(feature = "x")))]`)),
    "crate::store::Order",
  );
  // The control: a real cfg still gates, so the refusal is not simply gone.
  assert.equal(
    hintPath("Order", `${PG}/src/store.rs`, withAttr(`#[cfg(feature = "x")]`)),
    undefined,
  );
});

test("[ambiguity] a renamed re-export (`pub use store::Order as Item;`) does not publish `Order`", () => {
  const deps = fsOf({
    [`${PG}/Cargo.toml`]: manifest("playground"),
    [`${PG}/src/lib.rs`]: `mod store;\npub use store::Order as Item;\n`,
    [`${PG}/src/store.rs`]: `pub struct Order;\n`,
  });
  assert.equal(hintPath("Order", `${PG}/src/store.rs`, deps), undefined);
});

test("[cycle] a self-referential module (`a::a`) and a re-export that points back at the crate root terminate", () => {
  const deps = fsOf({
    [`${PG}/Cargo.toml`]: manifest("playground"),
    [`${PG}/src/lib.rs`]: `pub mod a;\npub use a::a::Thing;\n`,
    [`${PG}/src/a/mod.rs`]: `mod a;\npub use crate::Thing;\npub use a::Thing;\n`,
    [`${PG}/src/a/a.rs`]: `pub struct Thing;\n`,
  });
  const started = Date.now();
  const line = hintPath("Thing", `${PG}/src/a/a.rs`, deps);
  assert.ok(Date.now() - started < 2000, "the walk must terminate: it follows the FILE chain, which is finite, and never chases a `use` graph");
  assert.equal(line, "crate::a::Thing");
});

// ===========================================================================
// PART 4. CONTRACT CLAUSE 6 - the sysroot carve-out.
//
// DECISION: IT STAYS. The clause allows removal only if a test proves the
// rewrite covers its cases, and these two rows are the proof that it does NOT.
// (`fnGen.ts` is also owned by another phase this session and is not touched.)
// ===========================================================================

const STD = "/home/dev/.rustup/toolchains/stable/lib/rustlib/src/rust/library/std";
const STD_TARGET = `${PG}/tests/gen_build_store.rs`;

test("[clause 6] the rewrite DOES cover the shape the carve-out was written for, when the sysroot source is readable", () => {
  const deps = fsOf(
    {
      [`${STD}/Cargo.toml`]: manifest("std"),
      [`${STD}/src/lib.rs`]: `pub mod io;\n`,
      [`${STD}/src/io/mod.rs`]: `mod buffered;\npub use self::buffered::BufReader;\n`,
      [`${STD}/src/io/buffered/bufreader.rs`]: `pub struct BufReader {\n    inner: u32,\n}\n`,
    },
    [`${PG}/Cargo.toml`],
  );
  assert.equal(
    deriveUsePath(`${STD}/src/io/buffered/bufreader.rs`, STD_TARGET, deps),
    "std::io::buffered::bufreader",
    "the file-tree path, whose `use` line is the E0603 the measurement counted",
  );
  assert.equal(
    hintPath("BufReader", `${STD}/src/io/buffered/bufreader.rs`, deps, STD_TARGET),
    "std::io::BufReader",
    "and the rewrite turns it into the path that compiles.",
  );
});

test("[clause 6] but it does NOT cover every sysroot case, so the carve-out is not redundant and stays", () => {
  // Case A: the rust-src component is not installed, so nothing under the
  // sysroot is readable. Absence of evidence keeps today's render - which for a
  // sysroot type is the wrong path the carve-out exists to suppress.
  const unreadable = fsOf({ [`${STD}/Cargo.toml`]: manifest("std") }, [
    `${PG}/Cargo.toml`,
    `${STD}/src/io/buffered/bufreader.rs`,
  ]);
  assert.equal(
    hintPath("BufReader", `${STD}/src/io/buffered/bufreader.rs`, unreadable, STD_TARGET),
    "std::io::buffered::bufreader::BufReader",
    "E0603 still, and the hint still renders it. THIS is why clause 6's condition is not met.",
  );

  // Case B: readable source, but the module is behind a `#[cfg]` - which is most
  // of `std::sys` - so the walk cannot read the declaration and keeps the path.
  const cfgGated = fsOf(
    {
      [`${STD}/Cargo.toml`]: manifest("std"),
      [`${STD}/src/lib.rs`]: `pub mod sys;\n`,
      [`${STD}/src/sys/mod.rs`]: `#[cfg(unix)]\nmod pal;\npub use pal::Handle;\n`,
      [`${STD}/src/sys/pal.rs`]: `pub struct Handle {\n    fd: i32,\n}\n`,
    },
    [`${PG}/Cargo.toml`],
  );
  assert.equal(
    hintPath("Handle", `${STD}/src/sys/pal.rs`, cfgGated, STD_TARGET),
    "std::sys::pal::Handle",
    "`std::sys` is private and this is E0603, but the cfg hides the declaration from the walk.",
  );
});
