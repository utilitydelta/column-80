// Blind oracle: the pure surface-payload pieces [slice2-surface.md "The
// payload rule", "assembleSurfacePayload", "extractExample", "Round-1 pre-fill
// selection", and the two prompt-assembly extensions]. Example wins over
// signatures and the two never coexist (finding 2); the firm instruction rides
// every rendered payload; extractExample pulls the fenced code under
// `# Examples` from a signature-fence-less doc; typesNamedIn returns the
// user-type identifiers excluding the std prelude. Never read src/**; the new
// pure functions are stubs, so this is expected red.
//
// Run: SKIP_LIVE=1 node --test test/blind7-payload.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "blind7-payload",
  `export { assembleSurfacePayload, typesNamedIn, FIRM_INSTRUCTION } from "../src/core/compilerDirected";
export { extractExample } from "../src/core/extraction";
export { assembleFnGenPrompt } from "../src/core/prompt";
export { assembleRepairPrompt } from "../src/core/repair";\n`
);
const {
  assembleSurfacePayload,
  typesNamedIn,
  FIRM_INSTRUCTION,
  extractExample,
  assembleFnGenPrompt,
  assembleRepairPrompt,
} = mod;
test.after(cleanup);

// Distinctive sentinels so a leak of the wrong branch is greppable in output.
const EXAMPLE_SENTINEL = "let f = BloomFilter::with_num_bits(1024).hashes(4);";
const SIG_SENTINEL = "pub fn with_num_bits(num_bits: usize) -> BuilderWithBits";

// ---- assembleSurfacePayload: branch selection, firm instruction, never both.

test("example present -> renders the example content and the firm instruction, and NOT the signatures branch [surface: 'Example when the crate/type has one' + 'Never both']", () => {
  const out = assembleSurfacePayload({
    typeOrCrate: "BloomFilter",
    example: EXAMPLE_SENTINEL,
    signatures: SIG_SENTINEL,
  });
  assert.ok(out.includes(EXAMPLE_SENTINEL), "the worked example is the payload when present");
  assert.ok(out.includes(FIRM_INSTRUCTION), "the firm instruction rides the rendered payload");
  assert.ok(!out.includes(SIG_SENTINEL), "finding 2: signatures never appear alongside an example");
});

test("only signatures present -> renders the signatures and the firm instruction [surface: 'Signatures when no example exists']", () => {
  const out = assembleSurfacePayload({ typeOrCrate: "Widget", signatures: SIG_SENTINEL });
  assert.ok(out.includes(SIG_SENTINEL), "the resolved signatures are the fallback payload");
  assert.ok(out.includes(FIRM_INSTRUCTION), "the firm instruction rides the rendered payload");
});

test("neither example nor signatures -> empty string, no bare firm instruction [surface: 'Neither ... returns \"\"']", () => {
  assert.strictEqual(assembleSurfacePayload({ typeOrCrate: "Widget" }), "");
  assert.strictEqual(assembleSurfacePayload({ typeOrCrate: "Widget", example: "", signatures: "" }), "");
});

// REVERSED IN PART BY session-v41 PHASE 3, on purpose and with the session's
// name on it.
//
// The v7 contract said "example present -> renders", so this row fed an example
// under the throwaway head `X` and expected the firm instruction back. The
// example's code names `BloomFilter`, not `X`: under phase 3's gate at this
// render seam that is exactly the junk block the phase refuses, because the
// rendered header claims "from its docs, this compiles" about a type the code
// never mentions. A refused example falls to the signatures branch, or to ""
// when nothing else exists.
//
// The row's SUBJECT survives untouched: every payload that RENDERS carries the
// firm instruction, and an empty one carries nothing. What moved is which
// inputs render. The head-matched line carries the old first assertion; the
// two refusal lines pin the gate's fallbacks. The v41 contract rows are
// test/blind-v41-p3-example-gate.test.cjs A1/C/D; register entry
// docs/supersessions.md S14.
test("a rendered payload always contains the firm instruction; a refused or empty one contains nothing (v41 reversal of the v7 example-always-renders pin)", () => {
  assert.ok(assembleSurfacePayload({ typeOrCrate: "BloomFilter", example: EXAMPLE_SENTINEL }).includes(FIRM_INSTRUCTION));
  const refusedToSigs = assembleSurfacePayload({ typeOrCrate: "X", example: EXAMPLE_SENTINEL, signatures: SIG_SENTINEL });
  assert.ok(!refusedToSigs.includes(EXAMPLE_SENTINEL), "a head-mismatched example never renders");
  assert.ok(refusedToSigs.includes(SIG_SENTINEL), "the refusal falls to the signatures branch");
  assert.ok(refusedToSigs.includes(FIRM_INSTRUCTION), "and the rendered fallback still carries the instruction");
  assert.strictEqual(assembleSurfacePayload({ typeOrCrate: "X", example: EXAMPLE_SENTINEL }), "", "refused with nothing to fall to: empty, no bare instruction");
  assert.ok(assembleSurfacePayload({ typeOrCrate: "X", signatures: SIG_SENTINEL }).includes(FIRM_INSTRUCTION));
  assert.ok(!assembleSurfacePayload({ typeOrCrate: "X" }).includes(FIRM_INSTRUCTION));
});

// ---- extractExample: the `# Examples` block from a doc with no leading
// signature fence, fences stripped, trimmed.

const DOC_WITH_EXAMPLE =
  "Creates a builder.\n\n# Examples\n\n```\nuse fastbloom::BloomFilter;\nlet f = BloomFilter::with_num_bits(1024).hashes(4);\n```";

test("extractExample pulls the fenced code under `# Examples` from a signature-fence-less doc, fences stripped [surface: 'extractExample']", () => {
  assert.strictEqual(
    extractExample(DOC_WITH_EXAMPLE),
    "use fastbloom::BloomFilter;\nlet f = BloomFilter::with_num_bits(1024).hashes(4);",
  );
});

test("extractExample strips a language-tagged fence too (```rust), returning code only", () => {
  const doc = "Creates a builder.\n\n# Examples\n\n```rust\nlet f = BloomFilter::with_num_bits(1024);\n```";
  assert.strictEqual(extractExample(doc), "let f = BloomFilter::with_num_bits(1024);");
});

test("extractExample returns undefined when the doc has no Examples block [surface: 'undefined when absent']", () => {
  assert.strictEqual(extractExample("Just a description of the type, no examples here."), undefined);
});

// ---- typesNamedIn: PascalCase user types, first-seen order, std prelude out.

const typeCases = [
  {
    name: "a trait-object arg and an error return -> [ObjectStore, Error], Result excluded",
    signature: "fn upload(store: &dyn ObjectStore) -> Result<(), Error>",
    doc: undefined,
    expected: ["ObjectStore", "Error"],
  },
  {
    name: "a signature naming only primitives -> [] (no user type to resolve)",
    signature: "fn add(a: i32, b: i32) -> i32",
    doc: undefined,
    expected: [],
  },
  {
    name: "std-prelude names (String, Vec, Option, Box, Self) are excluded; only Widget survives",
    signature: "fn g(s: String, v: Vec<Widget>) -> Option<Box<Self>>",
    doc: undefined,
    expected: ["Widget"],
  },
  {
    name: "a repeated user type collapses to one, first-seen order preserved",
    signature: "fn f(a: Widget, b: Gadget) -> Widget",
    doc: undefined,
    expected: ["Widget", "Gadget"],
  },
  {
    name: "the doc comment contributes a type the signature does not name",
    signature: "fn bloom_demo() -> bool",
    doc: "/// Uses a `BloomFilter` from the fastbloom crate.",
    expected: ["BloomFilter"],
  },
];

for (const { name, signature, doc, expected } of typeCases) {
  test(`typesNamedIn: ${name} [surface: 'Round-1 pre-fill selection']`, () => {
    assert.deepStrictEqual(typesNamedIn(signature, doc), expected);
  });
}

// ---- The two prompt-assembly extensions, lightly: the injected content
// appears; absence is byte-identical to omitting the field. The rigorous v2
// identity lives in blind7-prompt-identity-v2.

const FNGEN_BASE = { signature: "fn bloom_demo() -> bool", docComment: "/// Build a bloom filter.", languageId: "rust" };
const INJECTED = "API surface for `BloomFilter`:\nSENTINEL_INJECTED_BLOCK";

test("assembleFnGenPrompt: injectedSurface content appears, and absence is byte-identical to omitting the field", () => {
  const withSurface = assembleFnGenPrompt({ ...FNGEN_BASE, injectedSurface: INJECTED });
  const omitted = assembleFnGenPrompt({ ...FNGEN_BASE });
  assert.ok(withSurface.includes("SENTINEL_INJECTED_BLOCK"), "the injected block content is present in the prompt");
  assert.strictEqual(
    assembleFnGenPrompt({ ...FNGEN_BASE, injectedSurface: undefined }),
    omitted,
    "injectedSurface: undefined degrades to the v1 prompt, byte-for-byte",
  );
});

const repairDiag = {
  kind: "compile-error",
  level: "error",
  code: "E0599",
  message: "no method named `add` found for struct `BloomFilter<S>` in the current scope",
  spans: [],
  suggestions: [],
  rendered: "error[E0599]: no method named `add`\n",
};
const REPAIR_BASE = {
  languageId: "rust",
  docComment: "/// Build a bloom filter.",
  code: "fn bloom_demo() -> bool { false }",
  diagnostics: [repairDiag],
};

test("assembleRepairPrompt: surface content appears, and absence is byte-identical to omitting the field", () => {
  const withSurface = assembleRepairPrompt({ ...REPAIR_BASE, surface: INJECTED });
  const omitted = assembleRepairPrompt({ ...REPAIR_BASE });
  assert.ok(withSurface.includes("SENTINEL_INJECTED_BLOCK"), "the injected surface content is present in the repair prompt");
  assert.strictEqual(
    assembleRepairPrompt({ ...REPAIR_BASE, surface: undefined }),
    omitted,
    "surface: undefined degrades to the v1 repair prompt, byte-for-byte",
  );
});
