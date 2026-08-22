// Blind oracle: example() selection hygiene, headless. Bundles the pure ranking
// function rankExampleCandidates from src/core/extraction and drives it over a
// FIXED completion-item list that models the reference regression: the
// bloom_membership run using fastbloom, where the compiler named a hallucinated
// associated function (`new_for`) so the `prefer` hint matches nothing.
//
// Frozen contract (v3 goal item 3 + falsification bar: "example()
// returns a std/blanket-trait example when a crate-specific worked example is
// available"). These tests encode the contract and are NEVER edited to make an
// implementation pass.
//
// The candidate set is the host-check ground truth: clone (std, via Clone),
// contains + from_vec (plain methods), with_num_bits + with_false_pos (builder
// constructors). Selection order is what the extractor tries; result[0] is the
// winner, an empty result means "no example" (fall through to signatures).
//
// Run: SKIP_LIVE=1 node --test test/blind-v3-example.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "blind-v3-example",
  `export { rankExampleCandidates } from "../src/core/extraction";\n`
);
const { rankExampleCandidates } = mod;
test.after(cleanup);

// The fastbloom candidate set (host-check ground truth). No isConstructor kind
// flag: RA surfaces these as functions, so the constructor tier must fire on the
// NAME regex, which is the realistic signal. viaTrait is present only on the std
// clone item (the `(as Clone)` provenance).
const FASTBLOOM = [
  { name: "clone", viaTrait: "Clone" },
  { name: "contains" },
  { name: "from_vec" },
  { name: "with_num_bits" },
  { name: "with_false_pos" },
];

const CONSTRUCTORS = new Set(["with_num_bits", "with_false_pos"]);
const order = (result) => result.map((c) => c.name);

test("hallucinated prefer: the winner is a builder constructor, never clone", () => {
  // `new_for` matches no candidate name, so the prefer tier ties and the
  // constructor tier decides. clone must not win; a constructor must.
  const ranked = rankExampleCandidates(FASTBLOOM, "new_for");
  assert.ok(ranked.length > 0, "candidates remain after filtering");
  assert.ok(
    CONSTRUCTORS.has(ranked[0].name),
    `winner must be a constructor, got ${JSON.stringify(order(ranked))}`,
  );
  assert.ok(!order(ranked).includes("clone"), "the std clone item is filtered out entirely");
});

test("a universal-trait item never wins unless the compiler explicitly named it", () => {
  // Unless prefer IS clone (the compiler named it - ground truth it is real), the
  // blanket-trait clone can never be the selection when a crate candidate exists.
  for (const prefer of [undefined, "new_for", "does_not_exist", "with_num_bits"]) {
    const ranked = rankExampleCandidates(FASTBLOOM, prefer);
    assert.notStrictEqual(ranked[0]?.name, "clone", `clone won with prefer=${prefer}`);
  }
});

test("the compiler-named member (prefer) is never dropped by the std denylist", () => {
  // An E0599 on an inherent `borrow`/`extend`/`clone`: prefer names it, so it is
  // ground truth that it is real and must survive the noise filter and win.
  for (const named of ["clone", "borrow", "extend"]) {
    const cands = [{ name: named, viaTrait: "Clone" }, { name: "with_num_bits" }];
    const ranked = rankExampleCandidates(cands, named);
    assert.strictEqual(ranked[0]?.name, named, `${named} must be rescued when it is the prefer hint`);
  }
});

test("a builder constructor ranks above both the from-constructor and plain methods", () => {
  // The scout treats `from_vec` as a method-shaped example next to the builder;
  // the builder (`with_num_bits`/`with_false_pos`) must precede `from_vec` AND
  // the plain `contains` when prefer matches nothing.
  const ranked = order(rankExampleCandidates(FASTBLOOM, "new_for"));
  const lastBuilder = Math.max(...ranked.map((n, i) => (CONSTRUCTORS.has(n) ? i : -1)));
  for (const below of ["contains", "from_vec"]) {
    assert.ok(
      lastBuilder < ranked.indexOf(below),
      `every builder must precede ${below}, got ${JSON.stringify(ranked)}`,
    );
  }
});

test("only std-trait candidates: selection is empty (no example, worse than wrong)", () => {
  const stdOnly = [
    { name: "clone", viaTrait: "Clone" },
    { name: "to_owned", viaTrait: "ToOwned" },
    { name: "into", viaTrait: "Into" },
  ];
  assert.strictEqual(rankExampleCandidates(stdOnly, "new_for").length, 0, "no crate candidate -> empty");
});

test("std provenance via the name denylist when the (as Trait) label is absent", () => {
  // Same clone item but with no viaTrait: the bare-name denylist must still drop it.
  const noProvenance = [
    { name: "clone" },
    { name: "with_num_bits" },
  ];
  const ranked = order(rankExampleCandidates(noProvenance, "new_for"));
  assert.deepStrictEqual(ranked, ["with_num_bits"], "clone dropped by name, constructor kept");
});

test("idiomatic whole-word constructors beat a plain method when prefer matches nothing", () => {
  // File::open, TcpStream::connect, SomethingBuilder::build - RA surfaces these as
  // Functions, so the NAME is the only constructor signal. Each must beat a plain
  // method's example when the compiler named a hallucinated associated function.
  for (const ctor of ["open", "connect", "build", "builder", "create", "load", "parse", "make"]) {
    const ranked = order(rankExampleCandidates([{ name: "process" }, { name: ctor }], "new_for"));
    assert.strictEqual(ranked[0], ctor, `${ctor} must win over the plain method, got ${JSON.stringify(ranked)}`);
  }
});

test("a lookalike of a constructor word is NOT promoted (opener/parser/connection)", () => {
  // The boundary anchor keeps `opener`/`parser`/`connection` as plain methods.
  for (const lookalike of ["opener", "parser", "connection"]) {
    const ranked = order(rankExampleCandidates([{ name: lookalike }, { name: "with_num_bits" }], "new_for"));
    assert.strictEqual(ranked[0], "with_num_bits", `${lookalike} must not outrank a real builder`);
  }
});

test("an explicit prefer match still wins over the constructor tier", () => {
  // When the compiler named a REAL member, the caller wants that member's
  // example; the constructor bias must not override an exact prefer hit.
  const ranked = rankExampleCandidates(FASTBLOOM, "contains");
  assert.strictEqual(ranked[0].name, "contains", "an exact prefer match is the winner");
});
