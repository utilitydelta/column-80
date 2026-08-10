// Implementer oracle: prompt-assembly edges invisible from the surface doc's
// examples — pathological doc comments, empty and newline-heavy inputs, and
// the exact rendering choices where the contract leaves the letter to the
// implementation. Complements test/blind2-prompt.test.cjs.
//
// Run: npm test

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl2-prompt",
  `export { assembleFnGenPrompt } from "../src/core/prompt";\n`
);
const { assembleFnGenPrompt } = mod;
test.after(cleanup);

const FENCE = "```";
const INSTR =
  "Implement the function below. Reply with one fenced code block containing the complete function definition, signature and body. The block must contain only this one function: no imports, no other functions, no code before or after it. Output nothing outside the code block.";
const SIG = "fn f() -> i32";

test("docComment of only newlines normalizes to a single blank-free newline: '\\n\\n\\n' renders as exactly one '\\n'", () => {
  assert.strictEqual(
    assembleFnGenPrompt({ signature: SIG, docComment: "\n\n\n" }),
    `${INSTR}\n\n${FENCE}\n\n${SIG}\n${FENCE}`
  );
});

test("empty-string docComment is present per the contract: it renders as one newline (a blank line before the signature)", () => {
  // 'present' is read as !== undefined; "" normalized to end with exactly
  // one \n is "\n". Callers that mean 'no doc comment' pass undefined.
  assert.strictEqual(
    assembleFnGenPrompt({ signature: SIG, docComment: "" }),
    `${INSTR}\n\n${FENCE}\n\n${SIG}\n${FENCE}`
  );
});

test("docComment trailing spaces survive; only trailing newlines are normalized", () => {
  assert.strictEqual(
    assembleFnGenPrompt({ signature: SIG, docComment: "/// A  \n\n" }),
    `${INSTR}\n\n${FENCE}\n/// A  \n${SIG}\n${FENCE}`
  );
});

test("docComment containing a code fence goes in verbatim: the assembler never sanitizes", () => {
  const doc = "/// Example:\n/// ```\n/// f();\n/// ```";
  assert.strictEqual(
    assembleFnGenPrompt({ signature: SIG, docComment: doc, languageId: "rust" }),
    `${INSTR}\n\n${FENCE}rust\n${doc}\n${SIG}\n${FENCE}`
  );
});

test("signature with two trailing newlines is verbatim: a newline is appended only when missing, never stripped", () => {
  assert.strictEqual(
    assembleFnGenPrompt({ signature: `${SIG}\n\n` }),
    `${INSTR}\n\n${FENCE}\n${SIG}\n\n${FENCE}`
  );
});

test("empty-string signature renders as a lone newline inside the fence", () => {
  assert.strictEqual(assembleFnGenPrompt({ signature: "" }), `${INSTR}\n\n${FENCE}\n\n${FENCE}`);
});

test("empty-string languageId renders the same bare fence as an absent one", () => {
  assert.strictEqual(
    assembleFnGenPrompt({ signature: SIG, languageId: "" }),
    assembleFnGenPrompt({ signature: SIG })
  );
});

test("context block with empty text renders an empty fenced body (one appended newline)", () => {
  const block = { uri: "file:///e.rs", range: { startLine: 1, endLine: 1 }, text: "" };
  assert.strictEqual(
    assembleFnGenPrompt({ signature: SIG, contextBlocks: [block] }),
    `Context: file:///e.rs#L1-L1\n${FENCE}\n\n${FENCE}\n\n${INSTR}\n\n${FENCE}\n${SIG}\n${FENCE}`
  );
});

test("context block text with two trailing newlines is verbatim: only a MISSING newline is appended", () => {
  const block = { uri: "file:///t.rs", range: { startLine: 2, endLine: 3 }, text: "x\n\n" };
  assert.strictEqual(
    assembleFnGenPrompt({ signature: SIG, contextBlocks: [block] }),
    `Context: file:///t.rs#L2-L3\n${FENCE}\nx\n\n${FENCE}\n\n${INSTR}\n\n${FENCE}\n${SIG}\n${FENCE}`
  );
});

test("range is a label only: nonsense line numbers render verbatim, nothing is read or checked", () => {
  const block = { uri: "file:///n.rs", range: { startLine: 99, endLine: 1 }, text: "y" };
  assert.ok(
    assembleFnGenPrompt({ signature: SIG, contextBlocks: [block] }).startsWith("Context: file:///n.rs#L99-L1\n")
  );
});

test("duplicate blocks render twice: the assembler never dedups user-selected context", () => {
  const block = { uri: "file:///d.rs", range: { startLine: 1, endLine: 1 }, text: "dup" };
  const prompt = assembleFnGenPrompt({ signature: SIG, contextBlocks: [block, block] });
  const section = `Context: file:///d.rs#L1-L1\n${FENCE}\ndup\n${FENCE}`;
  assert.strictEqual(prompt, `${section}\n\n${section}\n\n${INSTR}\n\n${FENCE}\n${SIG}\n${FENCE}`);
});
