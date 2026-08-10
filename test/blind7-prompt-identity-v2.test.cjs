// Blind oracle: the v2 prompt identity [slice2-surface.md "v2 prompt-identity"
// + "Prompt assembly changes"]. The trust-model shift: the fn-gen and repair
// prompts MAY carry an auto-injected, visible, labelled API-surface block, but
// with nothing to inject the output is byte-identical to v1 (degrades to the
// v1 prompt, never silently to a guess). The injected layout bytes are NOT
// pinned by the surface, so we assert the block CONTENT appears and that
// absence equals the no-field call. Never read src/**; the injection asserts
// are the expected red while the optional params are ignored.
//
// Run: SKIP_LIVE=1 node --test test/blind7-prompt-identity-v2.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "blind7-prompt-identity-v2",
  `export { assembleFnGenPrompt } from "../src/core/prompt";
export { assembleRepairPrompt } from "../src/core/repair";\n`
);
const { assembleFnGenPrompt, assembleRepairPrompt } = mod;
test.after(cleanup);

// A block with distinctive, greppable content. We assert on the CONTENT lines,
// never the surrounding layout the surface leaves unpinned.
const BLOCK = "API surface for `BloomFilter`:\nSENTINEL_V2_LINE_ONE\nSENTINEL_V2_LINE_TWO";
const BLOCK_LINES = ["SENTINEL_V2_LINE_ONE", "SENTINEL_V2_LINE_TWO"];

// ---- assembleFnGenPrompt (injectedSurface).

const FNGEN_BASE = {
  signature: "fn bloom_demo() -> bool",
  docComment: "/// Build a bloom filter sized for roughly 1000 items.",
  languageId: "rust",
  contextBlocks: [{ uri: "file:///w/a.rs", range: { startLine: 1, endLine: 2 }, text: "struct Acc;" }],
};

test("fn-gen WITH injectedSurface: every content line of the block is visible in the prompt, and it differs from the no-injection prompt", () => {
  const injected = assembleFnGenPrompt({ ...FNGEN_BASE, injectedSurface: BLOCK });
  const omitted = assembleFnGenPrompt({ ...FNGEN_BASE });
  for (const line of BLOCK_LINES) {
    assert.ok(injected.includes(line), `injected block line ${JSON.stringify(line)} must be visible in the prompt`);
  }
  assert.notStrictEqual(injected, omitted, "an injected surface must change the prompt bytes");
});

test("fn-gen NO injection is byte-identical whether the field is omitted, undefined, or empty [surface: 'byte-identical to v1 ... absent-when-nothing-resolves']", () => {
  const omitted = assembleFnGenPrompt({ ...FNGEN_BASE });
  assert.strictEqual(assembleFnGenPrompt({ ...FNGEN_BASE, injectedSurface: undefined }), omitted, "undefined == omitted");
  assert.strictEqual(assembleFnGenPrompt({ ...FNGEN_BASE, injectedSurface: "" }), omitted, "empty == omitted (non-empty gates the render)");
});

// ---- assembleRepairPrompt (surface).

const repairDiag = {
  kind: "compile-error",
  level: "error",
  code: "E0599",
  message: "no method named `add` found for struct `BloomFilter<S>` in the current scope",
  spans: [],
  suggestions: [],
  rendered: "error[E0599]: no method named `add` found for struct `BloomFilter<S>`\n",
};
const REPAIR_BASE = {
  languageId: "rust",
  docComment: "/// Build a bloom filter.",
  code: "fn bloom_demo() -> bool { let _ = BloomFilter::new(); false }",
  diagnostics: [repairDiag],
};

test("repair WITH surface: every content line of the block is visible, and it differs from the no-surface prompt", () => {
  const injected = assembleRepairPrompt({ ...REPAIR_BASE, surface: BLOCK });
  const omitted = assembleRepairPrompt({ ...REPAIR_BASE });
  for (const line of BLOCK_LINES) {
    assert.ok(injected.includes(line), `surface block line ${JSON.stringify(line)} must be visible in the repair prompt`);
  }
  assert.notStrictEqual(injected, omitted, "a non-empty surface must change the repair prompt bytes");
});

test("repair NO surface is byte-identical whether the field is omitted, undefined, or empty [surface: 'byte-identical to v1 (the frozen phase-4 repair prompt test still passes)']", () => {
  const omitted = assembleRepairPrompt({ ...REPAIR_BASE });
  assert.strictEqual(assembleRepairPrompt({ ...REPAIR_BASE, surface: undefined }), omitted, "undefined == omitted");
  assert.strictEqual(assembleRepairPrompt({ ...REPAIR_BASE, surface: "" }), omitted, "empty == omitted (non-empty gates the render)");
});
