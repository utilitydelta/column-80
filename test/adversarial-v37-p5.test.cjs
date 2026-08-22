// ADVERSARIAL review evidence for session-v37 item 5, the Rust tuple-variant
// payload recovery (`src/core/rustHoverRecovery.ts` and its one wiring line in
// `resolveCrossFileShape`). Every row here is EVIDENCE for a finding in the
// review report, not a contract. Nothing was written to be satisfied by the
// implementation; the rows that fail are the findings.
//
// Rows are tagged in their names:
//   [DEFECT]  fails today, and the report argues it should not.
//   [RECORD]  passes today, and pins behaviour the report describes but does NOT
//             claim is wrong. Deleting one of these loses the evidence for a
//             judgement call the next reader will re-litigate.
//
// This file must never be treated as the contract set. `test/blind-*.test.cjs`
// is that, and this file neither edits nor duplicates it.
//
// THE BAR being held: a WRONG payload is worse than an elided one, because the
// model is told a lie in the compiler's voice. So a row is a DEFECT when the
// function EMITS something the source does not say. A row where it refuses and
// returns the hover byte for byte is never a defect here, however conservative.
//
// EVERY refusal row carries a control that DOES change, out of the same fixture
// or the same shape. A row that passes because the function died proves nothing.
//
// THE INDEPENDENT ORACLE behind sections A and C. The v37 spike scores
// the product against its own author's second parser and reports 224 of 224. The
// rows here were found by a THIRD oracle that shares no author with either:
// `rustdoc +nightly --output-format json` emits, for every enum variant, rustc's
// own `span` (file, begin line/col, end line/col) and its own variant KIND. The
// declaration text is then sliced out of the file at rustc's coordinates and the
// payload read between the first `(` and the last `)`. No parser of ours is on
// the expectation side. Measured on the reviewer's box:
//
//   base64 + httparse (the OSS corpus)      :  8 payloads, 8 agree, 0 disagree
//   65 dependency-free crates.io crates     : 75 payloads, 73 agree, 2 DISAGREE
//
// Both disagreements are the same mechanism, section A, and they are in
// `alloc-no-stdlib-2.0.4/src/lib.rs`, a real published crate. That is the answer
// to "is 224 of 224 a parser agreeing with itself": on this evidence the
// recovery is right about the SHAPE of a variant every time, and wrong about the
// TEXT of a payload whenever the payload contains a literal.
//
// No row DEPENDS on a corpus, a toolchain or a network. The corpus numbers are
// quoted in comments as the reason a row matters; the rows run on fixtures
// quoted verbatim from real source. Green on one box is not green.
//
// Run: SKIP_LIVE=1 node --test test/adversarial-v37-p5.test.cjs

const test = require("node:test");
const assert = require("node:assert/strict");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "adversarial-v37-p5",
  `export {
  recoverElidedSurface,
  parseStructHoverFields,
  renderDerivedDef,
  resolveCrossFileShape,
  csShapeHooks,
  pyShapeHooks,
  tsShapeHooks,
} from "../src/core/crossFileShape";\n`,
);
const {
  recoverElidedSurface,
  parseStructHoverFields,
  renderDerivedDef,
  resolveCrossFileShape,
  csShapeHooks,
  pyShapeHooks,
  tsShapeHooks,
} = mod;
test.after(cleanup);

// rust-analyzer's own elision, byte-verified against the Rust elision spike
// capture.
const elided = (name) => `${name}( /* … */ ),`;
const show = (v) => JSON.stringify(v);

// ===========================================================================
// A. THE SCRUBBER EATS THE PAYLOAD IT IS RECOVERING.
//
// `scrubRust` blanks every comment, string and char literal so that a brace or a
// comma inside one cannot be read as structure. That is right. What is not right
// is that `variantsOf` then reads the PAYLOAD TEXT out of the scrubbed buffer, so
// any literal INSIDE a tuple variant's parens is gone from the answer. The scrub
// is length-preserving and line-preserving by construction (its own comment says
// so), so the original text is one slice away and is never taken.
//
// Found by the rustdoc oracle, not by argument: `alloc-no-stdlib-2.0.4` declares
//   Malloc(unsafe extern "C" fn(usize) -> *mut u8),
// and the product emits `Malloc(unsafe extern fn(usize) -> *mut u8)`.
// ===========================================================================

// ~/.cargo/registry/src/index.crates.io-*/alloc-no-stdlib-2.0.4/src/lib.rs,
// the `AllocatorC` declaration verbatim.
const ALLOC_NO_STDLIB_RS = `pub enum AllocatorC {
   SimpleAllocator(usize),
   Malloc(unsafe extern "C" fn(usize) -> *mut u8),
   Calloc(unsafe extern "C" fn(usize, usize) -> *mut u8),
   Custom(fn(usize) -> *mut u8),
}
`;

test("[DEFECT] A1: an ABI string inside a payload is deleted, and the product emits a type the source does not contain", () => {
  const hover = `pub enum AllocatorC {\n    ${elided("SimpleAllocator")}\n    ${elided("Malloc")}\n    ${elided("Calloc")}\n    ${elided("Custom")}\n}`;
  const got = recoverElidedSurface(hover, ALLOC_NO_STDLIB_RS);
  assert.ok(
    got.includes(`Malloc(unsafe extern "C" fn(usize) -> *mut u8)`),
    `the ABI string was scrubbed out of the payload it belongs to:\n  got: ${show(got)}`,
  );
});

test("[DEFECT] A2: a non-default ABI is not merely reformatted, it is CHANGED - `extern \"system\"` reaches the model as `extern`, which means `extern \"C\"`", () => {
  // This is the one that makes A1 a lie and not a cosmetic. Rust spells a
  // bare `extern fn` as `extern "C" fn`. Deleting `"system"` therefore does not
  // blur the ABI, it names a DIFFERENT one, and on Windows those are not the
  // same calling convention.
  const source = `pub enum Callback {\n    Win(unsafe extern "system" fn(u32) -> u32),\n}\n`;
  const hover = `pub enum Callback {\n    ${elided("Win")}\n}`;
  const got = recoverElidedSurface(hover, source);
  assert.ok(
    !/extern\s+fn/.test(got),
    `\`extern "system"\` became a bare \`extern\`, which is \`extern "C"\`: ${show(got)}`,
  );
});

test("[DEFECT] A3: a char const-generic argument is deleted outright, leaving `Sep<>`", () => {
  const source = `pub enum Row {\n    Split(Sep<';'>),\n}\n`;
  const hover = `pub enum Row {\n    ${elided("Split")}\n}`;
  const got = recoverElidedSurface(hover, source);
  assert.ok(got.includes("Sep<';'>"), `the const argument vanished: ${show(got)}`);
});

test("[DEFECT] A4: a byte-literal const-generic argument becomes a bare identifier, which reads as a real type name", () => {
  // The worst shape of the same bug. `Tag<b'z'>` scrubs to `Tag<b     >`, which
  // normalizes to `Tag<b>` - not obviously broken, not obviously elided, and
  // wrong. The model is handed a plausible-looking generic argument that does
  // not exist.
  const source = `pub enum Frame {\n    Tagged(Tag<b'z'>),\n}\n`;
  const hover = `pub enum Frame {\n    ${elided("Tagged")}\n}`;
  const got = recoverElidedSurface(hover, source);
  assert.ok(!/Tag<b>/.test(got), `a byte literal was rendered as the type \`b\`: ${show(got)}`);
});

test("[RECORD] A5: the CONTROL for section A - the same file, a payload with no literal in it, recovers exactly", () => {
  // Without this row, A1 to A4 could all be passing-by-death. `Custom` and
  // `SimpleAllocator` come out of the same fixture and the same call, and they
  // are right.
  const hover = `pub enum AllocatorC {\n    ${elided("SimpleAllocator")}\n    ${elided("Malloc")}\n    ${elided("Calloc")}\n    ${elided("Custom")}\n}`;
  const got = recoverElidedSurface(hover, ALLOC_NO_STDLIB_RS);
  assert.ok(got.includes("SimpleAllocator(usize)"), `control variant did not recover: ${show(got)}`);
  assert.ok(got.includes("Custom(fn(usize) -> *mut u8)"), `control variant did not recover: ${show(got)}`);
  assert.ok(!got.includes("…"), `the whole hover was refused, so A1-A4 prove nothing: ${show(got)}`);
});

test("[RECORD] A6: a comment INSIDE the parens is dropped, and that half of the scrub is right", () => {
  // Same mechanism, opposite verdict. `V(/* the id */ u32)` should reach the
  // model as `V(u32)`. The scrub is not wrong to run; it is wrong to be the
  // thing the payload text is read out of.
  const source = `pub enum Id {\n    V(/* the id */ u32),\n}\n`;
  const got = recoverElidedSurface(`pub enum Id {\n    ${elided("V")}\n}`, source);
  assert.equal(got, `pub enum Id {\n    V(u32),\n}`);
});

// ===========================================================================
// B. A MACRO BODY IS READ AS A DECLARATION.
//
// The stated rule is "a declaration is only found by the `enum` keyword, never a
// match arm or a constructor call". A `macro_rules!` body IS the `enum` keyword,
// and its payload is a metavariable. The refusal ladder has no rung for it: the
// hover's variant IS declared in the source as a payload-carrying tuple variant,
// there is exactly ONE declaration of the name so nothing disagrees, and the
// answer ships.
//
// FREQUENCY: measured at 0 in both named corpora. A scan of every
// `macro_rules! ... { ... }` body in ~/sandbox/acme-db and
// ~/sandbox/complexity-study-oss found no `enum <Ident>` inside one. So this is
// a hole in the bar, not a hole with a witness in the corpora.
// ===========================================================================

const MACRO_SRC = `macro_rules! wrap {
    ($t:ty) => {
        pub enum Wrapper {
            Item($t),
        }
    };
}

wrap!(u8);
`;

test("[DEFECT] B1: an enum declared inside a macro_rules body ships the metavariable as the payload type", () => {
  const hover = `pub enum Wrapper {\n    ${elided("Item")}\n}`;
  const got = recoverElidedSurface(hover, MACRO_SRC);
  assert.equal(
    got,
    hover,
    `a macro body proved a payload it cannot prove; the real type is \`u8\` and the model is told \`$t\`: ${show(got)}`,
  );
});

test("[DEFECT] B2: the same hole through a proc-macro `quote!` body, where the payload is an interpolation", () => {
  const source = `fn derive_it() -> TokenStream {\n    quote! {\n        pub enum Wrapper {\n            Item(#field_ty),\n        }\n    }\n}\n`;
  const hover = `pub enum Wrapper {\n    ${elided("Item")}\n}`;
  const got = recoverElidedSurface(hover, source);
  assert.equal(got, hover, `a quote! body proved a payload: ${show(got)}`);
});

test("[RECORD] B3: the CONTROL for section B - a real declaration in the same file still recovers", () => {
  // If B1/B2 were passing because the function refuses anything near a macro,
  // this row would fail too. It does not: a genuine declaration beside a macro
  // is recovered.
  const source = `${MACRO_SRC}\npub enum Real {\n    Only(u16),\n}\n`;
  const got = recoverElidedSurface(`pub enum Real {\n    ${elided("Only")}\n}`, source);
  assert.equal(got, `pub enum Real {\n    Only(u16),\n}`);
});
