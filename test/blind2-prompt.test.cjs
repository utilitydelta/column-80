// Blind oracle: prompt assembly contract (phase2-surface.md "src/core/prompt.ts").
// The prompt is promised byte-for-byte deterministic, so every test asserts
// the exact assembled string; exact equality is also the exclusion proof
// (nothing but the documented sections can be present). Written against the
// surface doc only; never read src/**. Expected red while stubs throw.
//
// Run: npm test

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "blind2-prompt",
  `export { assembleFnGenPrompt } from "../src/core/prompt";\n`
);
const { assembleFnGenPrompt } = mod;
test.after(cleanup);

const FENCE = "```";
// The fixed instruction line, verbatim from the surface [surface: prompt section 2].
const INSTR =
  "Implement the function below. Reply with one fenced code block containing the complete function definition, signature and body. The block must contain only this one function: no imports, no other functions, no code before or after it. Output nothing outside the code block.";

const SIG = "fn add(a: i32, b: i32) -> i32";

// ---- zero context blocks [surface: prompt 'Zero context blocks means the prompt is section 2 + section 3 only']

test("minimal input: instruction + target block, empty language tag when languageId absent", () => {
  const expected = `${INSTR}\n\n${FENCE}\n${SIG}\n${FENCE}`;
  assert.strictEqual(assembleFnGenPrompt({ signature: SIG }), expected);
});

test("languageId renders as the fence tag [surface: prompt section 3 'three backticks + languageId']", () => {
  const expected = `${INSTR}\n\n${FENCE}rust\n${SIG}\n${FENCE}`;
  assert.strictEqual(assembleFnGenPrompt({ signature: SIG, languageId: "rust" }), expected);
});

test("signature already ending in newline gets no extra newline [surface: section 3 'a \\n appended when missing']", () => {
  const expected = `${INSTR}\n\n${FENCE}\n${SIG}\n${FENCE}`;
  assert.strictEqual(assembleFnGenPrompt({ signature: `${SIG}\n` }), expected);
});

// ---- doc comment normalization [surface: section 3 'normalized to end with exactly one \n']

const docVariants = [
  { name: "no trailing newline", doc: "/// Adds." },
  { name: "one trailing newline", doc: "/// Adds.\n" },
  { name: "two trailing newlines", doc: "/// Adds.\n\n" },
];
for (const { name, doc } of docVariants) {
  test(`doc comment with ${name} normalizes to exactly one`, () => {
    const expected = `${INSTR}\n\n${FENCE}rust\n/// Adds.\n${SIG}\n${FENCE}`;
    assert.strictEqual(assembleFnGenPrompt({ signature: SIG, docComment: doc, languageId: "rust" }), expected);
  });
}

test("multi-line doc comment keeps interior newlines, only the tail is normalized", () => {
  const expected = `${INSTR}\n\n${FENCE}rust\n/// Adds.\n///\n/// Wraps on overflow.\n${SIG}\n${FENCE}`;
  assert.strictEqual(
    assembleFnGenPrompt({ signature: SIG, docComment: "/// Adds.\n///\n/// Wraps on overflow.", languageId: "rust" }),
    expected
  );
});

// ---- context blocks [surface: prompt section 1]

const BLOCK_A = {
  uri: "file:///w/src/lib.rs",
  range: { startLine: 3, endLine: 9 },
  text: "pub struct Acc {\n    total: i64,\n}",
};
const BLOCK_B = {
  uri: "file:///w/src/util.rs",
  range: { startLine: 1, endLine: 1 },
  text: "pub fn clamp(v: i64) -> i64 { v.min(100) }\n",
};
const sectionA = `Context: file:///w/src/lib.rs#L3-L9\n${FENCE}\npub struct Acc {\n    total: i64,\n}\n${FENCE}`;
// BLOCK_B's text already ends in \n: verbatim, no second newline.
const sectionB = `Context: file:///w/src/util.rs#L1-L1\n${FENCE}\npub fn clamp(v: i64) -> i64 { v.min(100) }\n${FENCE}`;
const target = `${FENCE}rust\n/// Adds.\n${SIG}\n${FENCE}`;

test("one context block: header, bare fence, text with appended newline, then instruction and target", () => {
  const expected = `${sectionA}\n\n${INSTR}\n\n${target}`;
  assert.strictEqual(
    assembleFnGenPrompt({ signature: SIG, docComment: "/// Adds.", languageId: "rust", contextBlocks: [BLOCK_A] }),
    expected
  );
});

test("block text already ending in newline is verbatim, no extra newline before the closing fence", () => {
  const expected = `${sectionB}\n\n${INSTR}\n\n${target}`;
  assert.strictEqual(
    assembleFnGenPrompt({ signature: SIG, docComment: "/// Adds.", languageId: "rust", contextBlocks: [BLOCK_B] }),
    expected
  );
});

test("two blocks render in list order; swapping the list swaps the sections [surface: section 1 'in list order']", () => {
  assert.strictEqual(
    assembleFnGenPrompt({ signature: SIG, docComment: "/// Adds.", languageId: "rust", contextBlocks: [BLOCK_A, BLOCK_B] }),
    `${sectionA}\n\n${sectionB}\n\n${INSTR}\n\n${target}`
  );
  assert.strictEqual(
    assembleFnGenPrompt({ signature: SIG, docComment: "/// Adds.", languageId: "rust", contextBlocks: [BLOCK_B, BLOCK_A] }),
    `${sectionB}\n\n${sectionA}\n\n${INSTR}\n\n${target}`
  );
});

test("contextBlocks defaults to []: omitted and explicit empty produce the identical prompt [surface: FnGenPromptInput 'default []']", () => {
  const omitted = assembleFnGenPrompt({ signature: SIG, languageId: "rust" });
  const explicit = assembleFnGenPrompt({ signature: SIG, languageId: "rust", contextBlocks: [] });
  assert.strictEqual(omitted, explicit);
});

test("deterministic: identical input assembles the identical string twice [surface: 'deterministic, byte-for-byte function of the input']", () => {
  const input = { signature: SIG, docComment: "/// Adds.", languageId: "rust", contextBlocks: [BLOCK_A, BLOCK_B] };
  assert.strictEqual(assembleFnGenPrompt(input), assembleFnGenPrompt(input));
});

test("closed composition: with every feature present the prompt is exactly the documented sections, nothing else [surface: 'Excluded, and this is the product identity']", () => {
  // Exact equality is the exclusion oracle: any file path, repo content,
  // system message, or example sneaking in breaks it.
  const prompt = assembleFnGenPrompt({
    signature: SIG,
    docComment: "/// Adds.",
    languageId: "rust",
    contextBlocks: [BLOCK_A, BLOCK_B],
  });
  assert.strictEqual(prompt, `${sectionA}\n\n${sectionB}\n\n${INSTR}\n\n${target}`);
});
