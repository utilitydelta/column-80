// WHITE-BOX, session-v41 phase 3. Written against `exampleNamesItsType` in
// `src/core/extraction.ts` after reading it. The black-box contract is
// test/blind-v41-p3-example-gate.test.cjs (product path + the C/D pure rows);
// this file pins the seam's edges the contract left open, each with the
// decision stated at its row.
//
// Run: SKIP_LIVE=1 node --test test/impl-v41-p3-example-gate.test.cjs
const test = require("node:test");
const assert = require("node:assert/strict");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-v41-p3-example-gate",
  `export { exampleNamesItsType } from "../src/core/extraction";\n` +
    `export { assembleSurfacePayload } from "../src/core/compilerDirected";\n`,
);
const { exampleNamesItsType, assembleSurfacePayload } = mod;
test.after(cleanup);

test("a type named ONLY in a comment inside the code KEEPS the block - the predicate is textual by contract", () => {
  // Decision, documented: the gate's contract is "the code names the type"
  // (goal phase 3, word-boundary predicate), and the census's own 49/40 count
  // was taken over raw block text with no comment scrubbing. Scrubbing here
  // would re-derive the count under a different predicate than the one the
  // decision was measured on. A comment naming the type is also not a lie the
  // header tells - the code does mention it.
  assert.equal(
    exampleNamesItsType("HexWriter", "// build a HexWriter with defaults\nlet w = make_writer();"),
    true,
  );
});

test("a `r#` raw-ident head matches either spelling in the code", () => {
  assert.equal(exampleNamesItsType("r#type", "let t = r#type::default();"), true, "raw spelling");
  assert.equal(exampleNamesItsType("r#type", "let t: type = parse();"), true, "bare spelling of the same ident");
  assert.equal(exampleNamesItsType("r#type", "let t = mytype::default();"), false, "still word-boundary");
});

test("backticks inside the code are just bytes to the predicate", () => {
  // The seam sees code, not markdown: a stray fence inside the string must not
  // truncate or confuse the match.
  const code = "let s = \"```\";\nlet w = HexWriter::new(s);";
  assert.equal(exampleNamesItsType("HexWriter", code), true);
  assert.equal(exampleNamesItsType("Missing", code), false);
});

test("an empty or blank code block never names anything", () => {
  assert.equal(exampleNamesItsType("HexWriter", ""), false);
  assert.equal(exampleNamesItsType("HexWriter", "   \n  "), false);
});

test("a head the predicate cannot reduce to an identifier is refused, not guessed", () => {
  // The gate vouches for the header sentence; a header it cannot read is a
  // block it must not vouch for.
  for (const head of ["", "   ", "[u8; 32]", "(A, B)", "&dyn Thing"]) {
    assert.equal(exampleNamesItsType(head, "anything at all"), false, JSON.stringify(head));
  }
});

// ---------------------------------------------------------------------------
// THE SHARED RENDER GATE. `assembleSurfacePayload` is the one function both
// legs render example blocks through - fn-gen's pre-fill (fnGen.ts) and the
// REPAIR surface (oracleSurface.ts's memberBlock -> assembleSurfacePayload).
// Gating here is what makes the repair leg refuse the same junk block fn-gen
// refuses, with no second predicate to drift.
// ---------------------------------------------------------------------------

test("the repair leg's render refuses the junk example: falls to signatures when they exist", () => {
  const junk = 'let mut hasher = Sha256::new();\nhasher.update(b"payload");';
  const out = assembleSurfacePayload({
    typeOrCrate: "ReplState",
    example: junk,
    signatures: "connect(&self) -> Result<(), ReplError>",
    omitInstruction: true,
  });
  assert.ok(!/Usage example|Sha256|hasher/.test(out), `the lying block must not render:\n${out}`);
  assert.ok(/API surface for `ReplState`/.test(out), `the honest fallback is the signatures branch:\n${out}`);
});

test("the repair leg's render refuses the junk example: empty payload when nothing else exists", () => {
  const junk = "let d = Duration::from_secs(1);";
  assert.equal(
    assembleSurfacePayload({ typeOrCrate: "ReplState", example: junk, omitInstruction: true }),
    "",
    "no signatures, refused example: the caller's undefined-payload path is the honest outcome",
  );
});

test("the repair leg's render keeps a TRUE example byte-identical, header included", () => {
  const code = "let s = ReplState::snapshot();";
  assert.equal(
    assembleSurfacePayload({ typeOrCrate: "ReplState", example: code, omitInstruction: true }),
    "Usage example for `ReplState` (from its docs, this compiles):\n```rust\n" + code + "\n```",
  );
});

test("a lowercase crate-name head still gates on the word: `serde_json` keeps only when named", () => {
  // The render leg heads blocks with `typeOrCrate` - a crate name is a valid
  // match unit and follows the same word-boundary rule.
  assert.equal(exampleNamesItsType("serde_json", 'let v = serde_json::json!({"a": 1});'), true);
  assert.equal(exampleNamesItsType("serde_json", "let v = json::parse(s);"), false);
});
