// Implementer tests for v18 phase 4: the construction-surface filter.
//
// Phase 4's other half, the self-reference gate leg, was withdrawn - see
// session-v18/triage-p4.md - and its tests went with it.
//
// The blind file drives the filter through its contract shapes. These cover what
// it cannot see: the per-language constructor spellings, the signature shapes the
// parameter reader must not misread, and the Rust builder carve-out.
//
// Run: SKIP_LIVE=1 node --test test/impl-v18-freechecks.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const built = bundleCore("impl-v18-freechecks", `export * from "../src/core/fimInject";\n`);
const { renderFimCandidates } = built.mod;

test.after(() => built.cleanup());

const mem = (name, signature) => ({ name, signature, kind: "method" });
const RECEIVER = [mem("rehome", "rehome(&self, other: &Tile) -> Tile")];
const buildSection = (block, typeName = "Tile") => {
  const ls = String(block).split("\n");
  const i = ls.findIndex((l) => l.endsWith(`to build a ${typeName}:`));
  if (i < 0) return undefined;
  const out = [];
  for (let j = i + 1; j < ls.length; j++) {
    if (/ to build a .+:$/.test(ls[j])) break;
    out.push(ls[j]);
  }
  return out;
};

// ---------------------------------------------------------------------------
// PART 2 - the constructor spellings and the signatures the filter must parse.
// ---------------------------------------------------------------------------

test("P2: TypeScript's `constructor(...)` spelling survives the filter, which is what the extractor actually renders - the blind set only covers the type-named form", () => {
  const section = buildSection(
    renderFimCandidates(RECEIVER, "", "//", [
      { name: "Tile", members: [mem("constructor", "constructor(mortonCode: number, lod: number)")] },
    ])
  );
  assert.deepStrictEqual(section, ["// constructor(mortonCode: number, lod: number)"]);
});

test("P2: a first parameter carrying a comma inside a generic is still ONE parameter, so a factory taking a map is not misread as a receiver", () => {
  const section = buildSection(
    renderFimCandidates(RECEIVER, "", "//", [
      { name: "Tile", members: [mem("from_map", "from_map(items: HashMap<u32, Tile>) -> Tile")] },
    ])
  );
  assert.deepStrictEqual(section, ["// from_map(items: HashMap<u32, Tile>) -> Tile"]);
});

test("P2: a receiver taken BY REFERENCE is excluded whatever it returns - `clone(&self) -> Tile` needs a Tile to make one, which is the circularity the filter cuts", () => {
  const byRef = [
    mem("b", "b(&self) -> Tile"),
    mem("c", "c(&mut self) -> Tile"),
    mem("d", "d(& mut self) -> Tile"),
    mem("clone", "clone(&self) -> Tile"),
  ];
  const block = renderFimCandidates(RECEIVER, "", "//", [{ name: "Tile", members: byRef }]);
  assert.ok(!String(block).includes("to build a"), `all four take the receiver by reference, so no section renders:\n${block}`);
});

test("P2: the Rust builder carve-out - a receiver taken BY VALUE returning the type or `Self` is how you finish building one, so `build(self) -> Tile` and `with_x(mut self) -> Self` are KEPT", () => {
  const builder = [
    mem("new", "new(w: u32) -> Tile"),
    mem("width", "width(mut self, w: u32) -> Self"),
    mem("build", "build(self) -> Tile"),
    mem("area", "area(&self) -> f32"),
  ];
  const section = buildSection(renderFimCandidates(RECEIVER, "", "//", [{ name: "Tile", members: builder }]));
  assert.deepStrictEqual(section, [
    "// new(w: u32) -> Tile",
    "// width(mut self, w: u32) -> Self",
    "// build(self) -> Tile",
  ]);
});

test("P2: the carve-out needs the RETURN too - a by-value receiver returning something else still cannot produce one", () => {
  const block = renderFimCandidates(RECEIVER, "", "//", [
    { name: "Tile", members: [mem("into_parts", "into_parts(self) -> (u32, u32)"), mem("emit", "emit(self) -> String")] },
  ]);
  assert.ok(!String(block).includes("to build a"), `neither returns a Tile:\n${block}`);
});

test("P2: the carve-out is Rust's, not Python's - a bare `self` is an ordinary instance method there, so `rehome(self, o: Tile) -> Tile` stays filtered out under a `#` render", () => {
  const members = [mem("__init__", "__init__(self, code: int) -> None"), mem("rehome", "rehome(self, o: Tile) -> Tile")];
  const section = buildSection(renderFimCandidates(RECEIVER, "", "#", [{ name: "Tile", members }]), "Tile");
  assert.deepStrictEqual(section, ["# __init__(self, code: int) -> None"]);
});

test("P2: an argument-type member with NO signature is dropped by the render as it always was, and the filter neither rescues it nor throws on it", () => {
  const block = renderFimCandidates(RECEIVER, "", "//", [
    { name: "Tile", members: [{ name: "MAX_LOD", kind: "field" }, mem("new", "new(code: u32) -> Tile")] },
  ]);
  assert.deepStrictEqual(buildSection(block), ["// new(code: u32) -> Tile"]);
});

test("P2: a C# property render, which has no parameter list at all, is not read as receiver-taking", () => {
  const section = buildSection(
    renderFimCandidates(RECEIVER, "", "//", [{ name: "Tile", members: [mem("Lod", "Lod : int")] }])
  );
  assert.deepStrictEqual(section, ["// Lod : int"]);
});
