// WHITE-BOX, session-v39 item 1. Written against `src/core/rustHoverRecovery.ts`
// after reading it, so it names the decisions that file makes rather than the
// behaviour a caller can see. The black-box contract for the same change is
// test/blind-v39-p1-hover-recovery.test.cjs, which read none of it.
//
// What this file is FOR: every branch in `rewriteRegion` that returns undefined,
// and every parsing decision the goal did not spell out. The recovery's whole
// value is that it refuses; a refusal path with no test is a refusal path that
// quietly stops refusing.
//
// Run: SKIP_LIVE=1 node --test test/impl-v39-p1-hover-recovery.test.cjs
const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-v39-p1-hover-recovery",
  `export { recoverElidedSurface, surfaceStillTruncated } from "../src/core/crossFileShape";\n`,
);
const { recoverElidedSurface, surfaceStillTruncated } = mod;
test.after(cleanup);

const M = "/* … */";
const show = (v) => JSON.stringify(v);

// ===========================================================================
// 1. THE STRUCT PATH, which is new in v39. Its splitter counts angle brackets
//    and the enum splitter deliberately does not.
// ===========================================================================

test("struct: a field type carrying a comma inside angle brackets is ONE field", () => {
  // v37's splitter counted ( [ { only. `RefCell<HashMap<AggregateKey, u64>>` has
  // its comma at bracket depth zero, so that splitter cut the field in half and
  // the second half parsed as a field named nothing.
  const source =
    "pub struct S {\n" +
    "    pub a: u8,\n" +
    "    pub tips: RefCell<HashMap<AggregateKey, u64>>,\n" +
    "}\n";
  const hover = `pub struct S {\n    pub a: u8,\n    ${M}\n}`;
  assert.equal(
    recoverElidedSurface(hover, source),
    "pub struct S {\n    pub a: u8,\n    pub tips: RefCell<HashMap<AggregateKey, u64>>,\n}",
  );
});

test("struct: `->` in a field type closes no angle bracket", () => {
  const source = "pub struct S {\n    pub a: u8,\n    pub f: Box<dyn Fn(u8) -> u16>,\n}\n";
  const hover = `pub struct S {\n    pub a: u8,\n    ${M}\n}`;
  const got = recoverElidedSurface(hover, source);
  assert.ok(
    got.includes("pub f: Box<dyn Fn(u8) -> u16>"),
    `an arrow return type must survive the angle-aware split; got:\n${got}`,
  );
});

test("struct: visibility is carried, and a private field stays private", () => {
  const source = "pub struct S {\n    a: u8,\n    pub(crate) b: u16,\n    pub c: u32,\n}\n";
  const hover = `pub struct S {\n    a: u8,\n    ${M}\n}`;
  const got = recoverElidedSurface(hover, source);
  assert.ok(got.includes("pub(crate) b: u16"), `got:\n${got}`);
  assert.ok(got.includes("pub c: u32"), `got:\n${got}`);
});

test("struct: a TUPLE struct has no brace body and is returned unchanged", () => {
  // `bodyRange` refuses at the `;`, so nothing downstream ever runs.
  const source = "pub struct Meters(u32);\n";
  const hover = `pub struct Meters(${M});`;
  assert.equal(recoverElidedSurface(hover, source), hover);
});

test("struct: a field whose TYPE the hover elided is refused, not guessed", () => {
  // No capture in this repo shows a server eliding a field's type. The shape is
  // therefore unproven, and an unproven shape is a refusal.
  const source = "pub struct S {\n    pub a: Complicated<u8>,\n}\n";
  const hover = `pub struct S {\n    pub a: ${M},\n}`;
  assert.equal(recoverElidedSurface(hover, source), hover);
});

// ===========================================================================
// 2. THE REFUSAL BRANCHES, one row each.
// ===========================================================================

const REFUSALS = [
  {
    what: "two list cuts in one hover: the hidden members cannot be attributed to either",
    source: "pub enum E {\n    A,\n    B,\n    C,\n    D,\n}\n",
    hover: `pub enum E {\n    A,\n    ${M},\n    C,\n    ${M}\n}`,
  },
  {
    what: "a cut marker with nothing missing: the hover says more and the source has none",
    source: "pub enum E {\n    A,\n    B,\n}\n",
    hover: `pub enum E {\n    A,\n    B,\n    ${M}\n}`,
  },
  {
    what: "the shown members are out of the source's order",
    source: "pub enum E {\n    A,\n    B,\n    C,\n}\n",
    hover: `pub enum E {\n    B,\n    A,\n    ${M}\n}`,
  },
  {
    what: "the source declares two members of one name",
    // Only reachable through a source this parser mis-read or a cfg pair, and
    // either way nothing about the type is provable.
    source: "pub enum E {\n    A(u8),\n    A(u16),\n    C,\n}\n",
    hover: `pub enum E {\n    A( ${M} ),\n    ${M}\n}`,
  },
  {
    what: "a member the hover showed is absent from the source",
    source: "pub enum E {\n    A,\n    C,\n}\n",
    hover: `pub enum E {\n    A,\n    B,\n    ${M}\n}`,
  },
  {
    what: "a member the hover showed disagrees with the source about its payload",
    source: "pub enum E {\n    A(u8),\n    B,\n    C,\n}\n",
    hover: `pub enum E {\n    A(u16),\n    B,\n    ${M}\n}`,
  },
  {
    what: "a member the hover showed as a tuple is a struct variant in the source",
    source: "pub enum E {\n    A { x: u8 },\n    B,\n    C,\n}\n",
    hover: `pub enum E {\n    A( ${M} ),\n    B,\n    ${M}\n}`,
  },
  {
    what: "an elided payload whose source member is a UNIT variant",
    source: "pub enum E {\n    A,\n    B,\n}\n",
    hover: `pub enum E {\n    A( ${M} ),\n    B,\n}`,
  },
  {
    what: "a macro metavariable where a payload type belongs",
    source: "macro_rules! m {\n    () => {\n        pub enum E {\n            A($t),\n            B,\n        }\n    };\n}\n",
    hover: `pub enum E {\n    A( ${M} ),\n    B,\n}`,
  },
  {
    what: "a proc-macro interpolation where a payload type belongs",
    source: "quote! {\n    pub enum E {\n        A(#ty),\n        B,\n    }\n}\n",
    hover: `pub enum E {\n    A( ${M} ),\n    B,\n}`,
  },
];

for (const c of REFUSALS) {
  test(`refuse: ${c.what}`, () => {
    const got = recoverElidedSurface(c.hover, c.source);
    assert.equal(got, c.hover, `${c.what}\n  source: ${show(c.source)}\n  got   : ${show(got)}`);
  });
}

test("refusal is TOTAL: a hover with a provable payload AND an unprovable cut moves nothing", () => {
  // The sharp one. `A( … )` is recoverable on its own and the cut is not, and a
  // build that recovers the half it can has told the model a payload it could
  // not prove belonged to this declaration.
  const source = "pub enum E {\n    A(u8),\n    B,\n}\n";
  const hover = `pub enum E {\n    A( ${M} ),\n    B,\n    ${M}\n}`;
  const got = recoverElidedSurface(hover, source);
  assert.equal(got, hover, `partial recovery:\n${got}`);
  assert.ok(!got.includes("A(u8)"), `the provable half leaked out anyway:\n${got}`);
});

// ===========================================================================
// 3. THE cfg GUARD. Its own section because it is the guard that makes the list
//    restoration safe, and it is not in the goal.
// ===========================================================================

test("cfg: a gated declaration refuses the LIST CUT and still recovers a shown payload", () => {
  const source =
    'pub enum E {\n    A(u8),\n    #[cfg(feature = "extra")]\n    B(u16),\n    C(u32),\n}\n';
  const cut = `pub enum E {\n    A( ${M} ),\n    ${M}\n}`;
  assert.equal(recoverElidedSurface(cut, source), cut, "a cut may not be restored from a gated body");
  const noCut = `pub enum E {\n    A( ${M} ),\n    C( ${M} ),\n}`;
  assert.equal(
    recoverElidedSurface(noCut, source),
    "pub enum E {\n    A(u8),\n    C(u32),\n}",
    "a member the hover SHOWED is a member the server had, so its payload is still provable",
  );
});

test("cfg: `#[cfg_attr(...)]` is not `#[cfg(...)]` and does not block the cut", () => {
  const source =
    'pub enum E {\n    A(u8),\n    #[cfg_attr(test, derive(Debug))]\n    B(u16),\n    C(u32),\n}\n';
  const cut = `pub enum E {\n    A(u8),\n    ${M}\n}`;
  assert.equal(
    recoverElidedSurface(cut, source),
    "pub enum E {\n    A(u8),\n    B(u16),\n    C(u32),\n}",
    "cfg_attr changes how a member is derived, never whether it exists",
  );
});

// ===========================================================================
// 4. A HOVER SHORTER THAN THE SOURCE, WITH NO CUT. The v37 behaviour, kept.
// ===========================================================================

test("a hover shorter than the source with no cut recovers payloads and adds NO members", () => {
  // The `#[cfg]`-out-of-build shape reaching the recovery through the other door:
  // the server indexed a smaller list and never said so. v37 recovered payloads
  // here and v39 keeps doing exactly that, because it claims nothing new.
  const source = "pub enum E {\n    A(u8),\n    B(u16),\n    C(u32),\n}\n";
  const hover = `pub enum E {\n    A( ${M} ),\n}`;
  const got = recoverElidedSurface(hover, source);
  assert.equal(got, "pub enum E {\n    A(u8),\n}");
  assert.ok(!got.includes("B") && !got.includes("C"), `members were added without a cut:\n${got}`);
});

// ===========================================================================
// 5. DISCRIMINANTS, which sit where a parser stops reading.
// ===========================================================================

test("a discriminant AFTER a payload is read, not treated as unparsable syntax", () => {
  // `#[repr(u8)] enum X { Inline(T) = 1 }` is real Rust and real acme. Before
  // this was handled the trailing `= 1` refused the whole declaration.
  const source =
    "#[repr(u8)]\npub enum K {\n    None = 0,\n    Inline(Data) = 1,\n    Block(Ref) = 2,\n}\n";
  const hover = `pub enum K {\n    None = 0,\n    Inline( ${M} ),\n    Block( ${M} ),\n}`;
  assert.equal(
    recoverElidedSurface(hover, source),
    "pub enum K {\n    None = 0,\n    Inline(Data),\n    Block(Ref),\n}",
    "and the discriminant is NOT added: the hover never carried it, so nobody proved it",
  );
});

test("a restored UNIT variant keeps its own discriminant", () => {
  const source = "pub enum K {\n    A = 1,\n    B = 2,\n    C = 4,\n}\n";
  const hover = `pub enum K {\n    A = 1,\n    ${M}\n}`;
  assert.equal(recoverElidedSurface(hover, source), "pub enum K {\n    A = 1,\n    B = 2,\n    C = 4,\n}");
});

test("something that is neither a payload nor a discriminant after a member name refuses", () => {
  const source = "pub enum E {\n    A(u8) where u8: Copy,\n    B,\n}\n";
  const hover = `pub enum E {\n    A( ${M} ),\n    B,\n}`;
  assert.equal(recoverElidedSurface(hover, source), hover);
});

// ===========================================================================
// 6. RENDERING: indent, position, and the marker's own disappearance.
// ===========================================================================

test("restored members land at the cut marker's own indent, and the marker goes", () => {
  const source = "pub enum E {\n\tA,\n\tB,\n\tC,\n}\n";
  const hover = `pub enum E {\n        A,\n        ${M}\n}`;
  assert.equal(
    recoverElidedSurface(hover, source),
    "pub enum E {\n        A,\n        B,\n        C,\n}",
    "eight spaces in the hover, tabs in the source: the OUTPUT follows the hover",
  );
});

test("a cut in the MIDDLE of the body restores without doubling the comma", () => {
  const source = "pub enum E {\n    A,\n    B,\n    C,\n}\n";
  const hover = `pub enum E {\n    A,\n    ${M},\n    C,\n}`;
  assert.equal(recoverElidedSurface(hover, source), "pub enum E {\n    A,\n    B,\n    C,\n}");
});

test("recovery is idempotent: its own output recovers to itself", () => {
  const source =
    "pub enum E {\n    Leader { lease_epoch: u64 },\n    Follower { epoch: u64 },\n    Done,\n}\n";
  const hover = `pub enum E {\n    Leader { ${M} },\n    ${M}\n}`;
  const once = recoverElidedSurface(hover, source);
  assert.equal(recoverElidedSurface(once, source), once, `not idempotent:\n${once}`);
  assert.ok(!once.includes(M), `a marker survived:\n${once}`);
});

// ===========================================================================
// 7. TOTALITY. The function is documented as never throwing.
// ===========================================================================

test("no input throws, and a junk input is returned unchanged", () => {
  const junk = [
    "",
    "enum",
    "enum X {",
    "enum X { ",
    `enum X { ${M}`,
    "enum X { A( }",
    "struct X { a: }",
    "struct X { : u8 }",
    `enum X<'a> { A( ${M} ) }`,
    "enum X { A = '}' as isize }",
  ];
  const sources = ["", "enum X {}", "struct X {}", "/* unterminated", 'r#"raw', "enum X { A(u8) }"];
  for (const h of junk) {
    for (const s of sources) {
      let out;
      assert.doesNotThrow(() => {
        out = recoverElidedSurface(h, s);
      }, `threw on hover ${show(h)} source ${show(s)}`);
      assert.equal(typeof out, "string", `non-string out for ${show(h)} / ${show(s)}`);
    }
  }
  assert.equal(recoverElidedSurface(undefined, "enum X { A(u8) }"), "");
  assert.equal(recoverElidedSurface("enum X { A( … ) }", undefined), "enum X { A( … ) }");
});

// ===========================================================================
// 8. `surfaceStillTruncated`, which item 2 turns on.
// ===========================================================================

test("surfaceStillTruncated answers on the marker in any of its three spellings", () => {
  assert.equal(surfaceStillTruncated(`pub enum E {\n    A,\n    ${M}\n}`), true);
  assert.equal(surfaceStillTruncated("pub enum E {\n    A,\n    …\n}"), true);
  assert.equal(surfaceStillTruncated("pub enum E {\n    A,\n    ...\n}"), true);
  assert.equal(surfaceStillTruncated("pub enum E {\n    A,\n    B,\n}"), false);
  assert.equal(surfaceStillTruncated(undefined), false);
  assert.equal(surfaceStillTruncated(""), false);
});
