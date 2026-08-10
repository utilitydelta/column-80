// Blind oracle: slice-1 pure extraction helpers, headless. No rust-analyzer,
// no network. Bundles src/core/extraction with esbuild and drives the four
// pure helpers the surface pins as "the meat of the blind oracle": parseHover,
// parseMemberLabel, renderMemberSignature, renderMemberSignatures.
//
// Frozen contract (session/slice1-surface.md, "Pure helpers" + "Exported
// symbols"): these tests encode the contract and are never edited to make an
// implementation pass. Ground-truth hover markdown is copied verbatim from the
// surface, which captured it from real rust-analyzer 1.96.
//
// Run: SKIP_LIVE=1 node --test test/blind6-extraction.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "blind6-extraction",
  `export { parseHover, renderMemberSignatures, parseMemberLabel, renderMemberSignature } from "../src/core/extraction";\n`
);
const { parseHover, renderMemberSignatures, parseMemberLabel, renderMemberSignature } = mod;
test.after(cleanup);

// ---- parseHover: the two verbatim fixture hover shapes [surface: 'parseHover']

// Method hover (with_num_bits): first fence is the bare path, the second
// pre-divider fence is the real signature, and an # Examples block follows.
const METHOD_HOVER = [
  "```rust",
  "fastbloom::BloomFilter",
  "```",
  "",
  "```rust",
  "pub fn with_num_bits(num_bits: usize) -> BuilderWithBits",
  "```",
  "",
  "---",
  "",
  "Creates a builder instance to construct a [`Self`](`Self`) with `num_bits` ...",
  "",
  "# Panics",
  "",
  "Panics if the number of bits, `num_bits`, is 0.",
  "",
  "# Examples",
  "",
  "```rust",
  "use fastbloom::BloomFilter;",
  "let filter = BloomFilter::with_num_bits(1024).hashes(4);",
  "```",
].join("\n");

// Struct hover (BloomFilter): first fence is the bare crate path, the second
// is the multi-line struct signature, and there is no # Examples block.
const STRUCT_HOVER = [
  "```rust",
  "fastbloom",
  "```",
  "",
  "```rust",
  "pub struct BloomFilter<S = DefaultHasher> {",
  "    bits: BitVec,",
  "    num_hashes_minus_one: u32,",
  "    hasher: S,",
  "}",
  "```",
  "",
  "---",
  "",
  "A space efficient approximate membership set data structure. ...",
].join("\n");

test("parseHover method: signature is the last pre-divider fence, never the bare path", () => {
  const h = parseHover(METHOD_HOVER);
  assert.ok(h, "a resolvable hover parses to a surface");
  assert.strictEqual(h.signature, "pub fn with_num_bits(num_bits: usize) -> BuilderWithBits");
  assert.notStrictEqual(h.signature, "fastbloom::BloomFilter", "the bare-path fence is never the signature");
  assert.notStrictEqual(h.signature, "fastbloom");
});

test("parseHover method: doc keeps the prose but strips # Examples and everything after", () => {
  const h = parseHover(METHOD_HOVER);
  assert.ok(h.doc, "doc prose is present");
  assert.match(h.doc, /Creates a builder instance/, "the lead prose survives");
  assert.ok(!h.doc.includes("# Examples"), "the Examples heading is removed");
  assert.ok(!h.doc.includes("with_num_bits(1024)"), "the example body is not folded into doc");
});

test("parseHover method: example is the first rust example, fences stripped", () => {
  const h = parseHover(METHOD_HOVER);
  assert.ok(h.example, "example is present for the method");
  assert.match(h.example, /with_num_bits\(1024\)/, "the ground-truth example line is carried");
  assert.match(h.example, /use fastbloom::BloomFilter;/);
  assert.ok(!h.example.includes("```"), "fences are stripped from the example");
});

test("parseHover struct: signature starts with the struct decl, never the bare path; no example", () => {
  const h = parseHover(STRUCT_HOVER);
  assert.ok(h, "the struct hover parses");
  assert.ok(h.signature.startsWith("pub struct BloomFilter"), `signature was ${JSON.stringify(h.signature)}`);
  assert.notStrictEqual(h.signature, "fastbloom", "the bare crate path is never the signature");
  assert.match(h.doc, /membership/i, "the struct doc mentions membership");
  assert.strictEqual(h.example, undefined, "a struct with no Examples section has no example");
});

// undefined-degrade cases: no rust fence at all, or nothing but whitespace.
for (const { name, input } of [
  { name: "prose with no code fence", input: "Just prose describing a symbol, no code fence here." },
  { name: "a non-rust fence only", input: ["```text", "not rust", "```"].join("\n") },
  { name: "whitespace only", input: "   \n\t  \n " },
  { name: "empty string", input: "" },
]) {
  test(`parseHover returns undefined for ${name}`, () => {
    assert.strictEqual(parseHover(input), undefined);
  });
}

// ---- parseMemberLabel: the (as Trait) provenance split [surface: 'Member-name parsing']

test("parseMemberLabel splits a trait-provenance label into name + viaTrait", () => {
  const r = parseMemberLabel("clone(as Clone)");
  assert.strictEqual(r.name, "clone");
  assert.strictEqual(r.viaTrait, "Clone");
});

test("parseMemberLabel leaves a bare inherent label with no viaTrait", () => {
  const r = parseMemberLabel("insert");
  assert.strictEqual(r.name, "insert");
  assert.strictEqual(r.viaTrait, undefined, "no (as ...) suffix means no trait provenance");
});

// ---- renderMemberSignature: splice the name onto the fn detail [surface: 'Member-name parsing']

for (const { name, memberName, detail, expected } of [
  {
    name: "splices the member name over the leading fn keyword",
    memberName: "contains_hash",
    detail: "fn(&self, u64) -> bool",
    expected: "contains_hash(&self, u64) -> bool",
  },
  { name: "undefined detail has no rendered signature", memberName: "x", detail: undefined, expected: undefined },
  { name: "a non-function detail (a field type) has no rendered signature", memberName: "seed", detail: "u64", expected: undefined },
]) {
  test(`renderMemberSignature ${name}`, () => {
    assert.strictEqual(renderMemberSignature(memberName, detail), expected);
  });
}

// ---- renderMemberSignatures: the FIM/fn-gen payload rule [surface: 'renderMemberSignatures']

// The exact universal blanket-trait drop set the surface pins. Every one of
// these, as the sole member, must render to "" even when it carries a signature.
const UNIVERSAL_DROP = [
  "Clone", "Copy", "ToOwned", "Borrow", "BorrowMut", "AsRef", "AsMut",
  "From", "Into", "TryFrom", "TryInto", "PartialEq", "Eq", "PartialOrd",
  "Ord", "Hash", "Default", "Deref", "DerefMut",
];

test("renderMemberSignatures: one signature per line, order preserved, no-signature and universal members dropped", () => {
  const members = [
    { name: "render", signature: "render(&self) -> String", kind: "method" },
    { name: "clone", signature: "clone(&self) -> Widget", kind: "method", viaTrait: "Clone" },
    { name: "relabel", signature: "relabel(&mut self, u64)", kind: "method" },
    { name: "bare", kind: "method" },
    { name: "into", signature: "into() -> U", kind: "method", viaTrait: "Into" },
    { name: "extend", signature: "extend(&mut self, T)", kind: "method", viaTrait: "Extend" },
  ];
  const out = renderMemberSignatures(members);
  assert.strictEqual(out, "render(&self) -> String\nrelabel(&mut self, u64)\nextend(&mut self, T)");
  assert.ok(!out.includes("clone"), "the universal Clone member is dropped");
  assert.ok(!out.includes("into"), "the universal Into member is dropped");
  assert.ok(!out.includes("bare"), "a member with no signature is never rendered as a bare name");
  assert.ok(!out.endsWith("\n"), "no trailing newline");
});

for (const trait of UNIVERSAL_DROP) {
  test(`renderMemberSignatures drops the sole universal-trait member via ${trait}`, () => {
    const out = renderMemberSignatures([{ name: "m", signature: "m() -> ()", kind: "method", viaTrait: trait }]);
    assert.strictEqual(out, "", `${trait} is in the universal drop set`);
  });
}

for (const trait of ["Iterator", "Display", "Extend", "Add"]) {
  test(`renderMemberSignatures keeps a member from the non-universal trait ${trait}`, () => {
    const out = renderMemberSignatures([{ name: "m", signature: "m() -> ()", kind: "method", viaTrait: trait }]);
    assert.strictEqual(out, "m() -> ()", `${trait} is not universal noise, so it is kept`);
  });
}

test("renderMemberSignatures keeps an inherent member with a signature", () => {
  assert.strictEqual(
    renderMemberSignatures([{ name: "render", signature: "render(&self) -> String", kind: "method" }]),
    "render(&self) -> String"
  );
});

for (const { name, members } of [
  { name: "empty input", members: [] },
  { name: "all members dropped as universal", members: [{ name: "clone", signature: "clone(&self) -> Self", kind: "method", viaTrait: "Clone" }] },
  { name: "all members lack a signature", members: [{ name: "a", kind: "method" }, { name: "b", kind: "field" }] },
]) {
  test(`renderMemberSignatures renders the empty string for ${name}`, () => {
    assert.strictEqual(renderMemberSignatures(members), "");
  });
}
