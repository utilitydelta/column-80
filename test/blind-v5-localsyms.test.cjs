// Blind-oracle contract tests for the v5 local-symbol bug fix. Two NEW pure
// functions (unwritten) fix the deterministic leg that today only knows `use`
// imports, never local definitions:
//   fileLocalDefinitions(source): Set<string>   -- module-scope defined names
//   stripLocalShadowingUses(body, localDefs): string -- drop a fn-local `use`
//       whose leaf names a local definition (the bare name resolves locally).
//
// These are written from the CONTRACT only, no implementation exists yet, so
// this file must run RED. Run: SKIP_LIVE=1 node --test test/blind-v5-localsyms.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "blind-v5-localsyms",
  `export { fileLocalDefinitions, stripLocalShadowingUses } from "../src/core/instructPostprocess";\n`
);
const { fileLocalDefinitions, stripLocalShadowingUses } = mod;
test.after(cleanup);

// --- fileLocalDefinitions: captures each module-scope definition kind --------
// Each case is [invariant name, source, expected bare name]. One name per kind,
// plus its pub-prefixed variant, proving the leading visibility does not change
// the captured bare NAME.
const captureCases = [
  ["struct", "struct CohortRegister { a: u8 }", "CohortRegister"],
  ["pub struct", "pub struct CohortRegister { a: u8 }", "CohortRegister"],
  ["pub(crate) struct", "pub(crate) struct CohortRegister { a: u8 }", "CohortRegister"],
  ["pub(super) struct", "pub(super) struct CohortRegister { a: u8 }", "CohortRegister"],
  ["enum", "enum E { A, B }", "E"],
  ["pub enum", "pub enum E { A, B }", "E"],
  ["fn", "fn helper() {}", "helper"],
  ["pub fn", "pub fn helper() {}", "helper"],
  ["type alias", "type Alias = u8;", "Alias"],
  ["pub type alias", "pub type Alias = u8;", "Alias"],
  ["const", "const C: u8 = 1;", "C"],
  ["pub const", "pub const C: u8 = 1;", "C"],
  ["static", "static S: u8 = 1;", "S"],
  ["pub static", "pub static S: u8 = 1;", "S"],
  ["trait", "trait T {}", "T"],
  ["pub trait", "pub trait T {}", "T"],
  ["mod", "mod sibling {}", "sibling"],
  ["pub mod", "pub mod sibling {}", "sibling"],
  ["union", "union U { a: u8 }", "U"],
  ["pub union", "pub union U { a: u8 }", "U"],
];
for (const [name, source, expected] of captureCases) {
  test(`fileLocalDefinitions captures ${name} -> ${expected}`, () => {
    const defs = fileLocalDefinitions(source);
    assert.ok(defs instanceof Set, "returns a Set");
    assert.ok(defs.has(expected), `set contains ${expected}`);
  });
}

// --- fileLocalDefinitions: the reported bug's file ---------------------------
test("fileLocalDefinitions captures a same-file pub struct named in a doc (the bug)", () => {
  const source = "use atlas::Tile;\n\npub struct CohortRegister {\n    tiles: Vec<Tile>,\n}\n";
  const defs = fileLocalDefinitions(source);
  assert.ok(defs.has("CohortRegister"), "the local pub struct is captured");
});

// --- fileLocalDefinitions: generics/lifetimes are not part of the name -------
const genericCases = [
  ["struct Wrapper<T> { inner: T }", "Wrapper"],
  ["struct Wrapper<'a> { inner: &'a u8 }", "Wrapper"],
  ["enum Either<L, R> { L(L), R(R) }", "Either"],
  ["fn map<T, U>(t: T) -> U { todo!() }", "map"],
  ["pub struct Grid<T, const N: usize> { cells: [T; N] }", "Grid"],
];
for (const [source, expected] of genericCases) {
  test(`fileLocalDefinitions strips generics/lifetimes: ${source} -> ${expected}`, () => {
    const defs = fileLocalDefinitions(source);
    assert.ok(defs.has(expected), `captured bare name ${expected}`);
    assert.ok(!defs.has(`${expected}<T>`), "did not capture the header with generics");
  });
}

// --- fileLocalDefinitions: NOT a definition inside a function body -----------
test("fileLocalDefinitions ignores a struct nested inside a fn body (not module scope)", () => {
  const source = "fn outer() {\n    struct Local;\n    let _ = Local;\n}\n";
  const defs = fileLocalDefinitions(source);
  assert.ok(defs.has("outer"), "the top-level fn is captured");
  assert.ok(!defs.has("Local"), "the fn-body struct is NOT captured (indented, not col 0)");
});

test("fileLocalDefinitions ignores definitions indented under an impl block", () => {
  const source = "impl Foo {\n    fn method(&self) {}\n    const INNER: u8 = 1;\n}\n";
  const defs = fileLocalDefinitions(source);
  assert.ok(!defs.has("method"), "impl-body fn is not a file-level definition");
  assert.ok(!defs.has("INNER"), "impl-body const is not a file-level definition");
});

// --- fileLocalDefinitions: a `use` import is NOT a definition ----------------
test("fileLocalDefinitions does not treat a use import as a definition", () => {
  const source = "use atlas::Tile;\nuse std::collections::HashMap;\n";
  const defs = fileLocalDefinitions(source);
  assert.ok(!defs.has("Tile"), "use-imported Tile is not a local definition");
  assert.ok(!defs.has("HashMap"), "use-imported HashMap is not a local definition");
  assert.ok(!defs.has("atlas"), "the crate path is not a definition");
});

// --- fileLocalDefinitions: empty / definition-free source -> empty set -------
const emptyCases = [
  ["empty string", ""],
  ["only whitespace", "\n\n   \n"],
  ["only a use", "use atlas::Tile;\n"],
  ["only a comment", "// just a comment\n"],
];
for (const [name, source] of emptyCases) {
  test(`fileLocalDefinitions on ${name} -> empty set`, () => {
    const defs = fileLocalDefinitions(source);
    assert.ok(defs instanceof Set, "returns a Set");
    assert.strictEqual(defs.size, 0, "no definitions captured");
  });
}

// --- fileLocalDefinitions: several definitions coexist -----------------------
test("fileLocalDefinitions captures multiple module-scope definitions together", () => {
  const source =
    "pub struct CohortRegister { a: u8 }\n" +
    "enum Phase { Warm, Cold }\n" +
    "fn helper() {}\n" +
    "type Alias = u8;\n";
  const defs = fileLocalDefinitions(source);
  for (const n of ["CohortRegister", "Phase", "helper", "Alias"]) {
    assert.ok(defs.has(n), `captured ${n}`);
  }
});

// --- stripLocalShadowingUses: THE REPORTED BUG -------------------------------
test("stripLocalShadowingUses drops `use atlas::CohortRegister;` when CohortRegister is local (the bug)", () => {
  const localDefs = new Set(["CohortRegister"]);
  const body =
    "fn build() -> CohortRegister {\n" +
    "    use atlas::CohortRegister;\n" +
    "\n" +
    "    CohortRegister { tiles: Vec::new() }\n" +
    "}";
  const out = stripLocalShadowingUses(body, localDefs);
  assert.ok(!/use atlas::CohortRegister;/.test(out), "the shadowing use is gone");
  assert.ok(out.includes("CohortRegister { tiles: Vec::new() }"), "rest of body intact");
  assert.ok(!/\n\s*\n\s*CohortRegister \{/.test(out), "the orphaned blank line is collapsed");
});

// --- stripLocalShadowingUses: OVER-STRIP GUARD -------------------------------
test("stripLocalShadowingUses keeps a genuinely external use (leaf not local)", () => {
  const localDefs = new Set(["CohortRegister"]); // Tile is NOT local
  const body = "fn f() {\n    use atlas::Tile;\n    let _: Tile = todo!();\n}";
  const out = stripLocalShadowingUses(body, localDefs);
  assert.ok(/use atlas::Tile;/.test(out), "external Tile import survives verbatim");
});

// --- stripLocalShadowingUses: COLLISION CASE ---------------------------------
test("stripLocalShadowingUses drops `use atlas::Tile;` when Tile IS local (local shadows crate)", () => {
  const localDefs = new Set(["Tile"]);
  const body = "fn f() {\n    use atlas::Tile;\n    let _ = Tile;\n}";
  const out = stripLocalShadowingUses(body, localDefs);
  assert.ok(!/use atlas::Tile;/.test(out), "local name must resolve local, import dropped");
});

// --- stripLocalShadowingUses: GROUPED import, mixed --------------------------
// Contract prefers the group is split so Tile (local) is dropped but Envelope
// (external) still imports. AMBIGUITY: the exact rendering of the surviving
// group is not fixed by the contract, and a reading where a mixed group is left
// untouched is called out as possible. We assert the invariant that survives
// either rendering: after the strip, Envelope is still imported and Tile is
// not, using regex checks that tolerate `use atlas::{Envelope};`,
// `use atlas::Envelope;`, or any equivalent. If the impl instead leaves the
// group untouched, the "Tile not imported" check fails RED, surfacing the
// contract decision for triage rather than silently passing.
test("stripLocalShadowingUses splits a mixed group: keeps Envelope, drops Tile", () => {
  const localDefs = new Set(["Tile"]); // Envelope is external
  const body = "fn f() {\n    use atlas::{Tile, Envelope};\n    let _ = Envelope;\n}";
  const out = stripLocalShadowingUses(body, localDefs);
  // Envelope must still be imported (in a group or standalone).
  assert.ok(
    /use\s+atlas::(\{[^}]*\bEnvelope\b[^}]*\}|Envelope)\s*;/.test(out),
    "Envelope is still imported after the strip"
  );
  // Tile must NOT be imported: no `Tile` token inside any surviving atlas use.
  const surviving = out.match(/use\s+atlas::[^;]*;/g) || [];
  for (const line of surviving) {
    assert.ok(!/\bTile\b/.test(line), `Tile not present in surviving use: ${line}`);
  }
});

// --- stripLocalShadowingUses: empty localDefs -> unchanged -------------------
test("stripLocalShadowingUses with empty localDefs returns body unchanged", () => {
  const body = "fn f() {\n    use atlas::CohortRegister;\n    let _ = 1;\n}";
  assert.strictEqual(stripLocalShadowingUses(body, new Set()), body);
});

// --- stripLocalShadowingUses: leaf matters even with more path segments ------
test("stripLocalShadowingUses drops `use a::b::CohortRegister;` (leaf is what matters)", () => {
  const localDefs = new Set(["CohortRegister"]);
  const body = "fn f() {\n    use a::b::CohortRegister;\n    let _ = CohortRegister;\n}";
  const out = stripLocalShadowingUses(body, localDefs);
  assert.ok(!/use a::b::CohortRegister;/.test(out), "deep-path leaf match is dropped");
});

// --- stripLocalShadowingUses: alias introduces a DISTINCT binding -> KEEP ----
// CONTRACT DECISION (triage may revisit): `use atlas::CohortRegister as Reg;`
// binds `Reg`, not `CohortRegister`, so it does not shadow/collide with the
// local `CohortRegister`. It is a distinct name and must be KEPT.
test("stripLocalShadowingUses keeps an aliased use whose alias does not collide with a local def", () => {
  const localDefs = new Set(["CohortRegister"]);
  const body = "fn f() {\n    use atlas::CohortRegister as Reg;\n    let _: Reg = todo!();\n}";
  const out = stripLocalShadowingUses(body, localDefs);
  assert.ok(/use atlas::CohortRegister as Reg;/.test(out), "aliased binding Reg is kept");
});
