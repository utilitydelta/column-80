// Blind oracle (set A): the manual-repair context-injection contract on
// assembleRepairPrompt. Today's assembleRepairPrompt has no contextBlocks
// field, so it drops the user's manually-added context on a repair round —
// the bug this feature fixes. These pin the agreed surface:
//
//  - contextBlocks render as LEADING sections, one per block, in list order,
//    in the SAME shape assembleFnGenPrompt uses (src/core/prompt.ts L66-105):
//      Context: {uri}#L{start}-L{end}\n```\n{text-ending-in-newline}```
//    joined to the rest with "\n\n", and BEFORE surface/code/diagnostics.
//  - contextBlocks undefined OR [] => output BYTE-IDENTICAL to omitting the
//    field (frozen-identity; these two stay GREEN before and after the fix).
//
// Contract only: never reads src/**; esbuild resolves at bundle time.
// Expected RED on the new-behaviour tests until the field is implemented.
//
// Run: SKIP_LIVE=1 node --test test/blind-repair-context.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "blind-repair-context",
  `export { assembleRepairPrompt } from "../src/core/repair";\n`
);
const { assembleRepairPrompt } = mod;
test.after(cleanup);

const FENCE = "```";
const INSTRUCTION =
  "Fix the function. Reply with one fenced code block containing the corrected complete function definition, signature and body. Output nothing outside the code block.";

const diag = (over = {}) => ({
  kind: "compile-error", level: "error", code: "E0308", message: "mismatched types",
  spans: [], suggestions: [], ...over,
});

const CODE = "pub fn sum_even(values: &[i64]) -> i64 {\n    values.iter().sum::<i64>()\n}";
const RENDERED = "error[E0308]: mismatched types\n --> src/task1.rs:2:5";
const DOC = "/// Sums the even numbers.";

// The same section shape assembleFnGenPrompt renders for a context block
// (src/core/prompt.ts L70-74): text normalized to end in exactly one newline.
const contextSection = (block) => {
  const text = block.text.endsWith("\n") ? block.text : block.text + "\n";
  return `Context: ${block.uri}#L${block.range.startLine}-L${block.range.endLine}\n${FENCE}\n${text}${FENCE}`;
};

const B1 = { uri: "file:///ctx/pool.rs", range: { startLine: 3, endLine: 7 }, text: "let helper = 42;\n" };
const B2 = { uri: "file:///ctx/cfg.rs", range: { startLine: 1, endLine: 1 }, text: "const N: usize = 8;\n" };

test("one contextBlock renders a LEADING Context section (index 0), matching assembleFnGenPrompt's shape, before code+diagnostics", () => {
  const got = assembleRepairPrompt({
    languageId: "rust",
    docComment: DOC,
    code: CODE,
    diagnostics: [diag({ rendered: RENDERED })],
    contextBlocks: [B1],
  });
  const codeSection =
    "The function below failed the compiler check:\n" + FENCE + "rust\n" + DOC + "\n" + CODE + "\n" + FENCE;
  const diagnosticsSection = "Compiler diagnostics:\n" + FENCE + "\n" + RENDERED + "\n" + FENCE;
  const expected = [contextSection(B1), codeSection, diagnosticsSection, INSTRUCTION].join("\n\n");
  assert.strictEqual(got, expected, "context leads, then code, diagnostics, instruction, joined by \\n\\n");
  assert.strictEqual(got.split("\n\n")[0], contextSection(B1), "the context block is section index 0 (it leads)");
});

test("two contextBlocks render in list order, both leading", () => {
  const got = assembleRepairPrompt({
    languageId: "rust",
    code: CODE,
    diagnostics: [diag({ rendered: RENDERED })],
    contextBlocks: [B1, B2],
  });
  assert.strictEqual(got.split("\n\n")[0], contextSection(B1), "first block leads");
  assert.strictEqual(got.split("\n\n")[1], contextSection(B2), "second block follows, in list order");
  assert.ok(got.indexOf(contextSection(B1)) < got.indexOf(contextSection(B2)), "list order preserved");
});

test("agreed order: context blocks precede the surface section when both are present", () => {
  const surface = "API surface for `Pool`:\n" + FENCE + "\npub fn new() -> Pool\n" + FENCE;
  const got = assembleRepairPrompt({
    languageId: "rust",
    code: CODE,
    diagnostics: [diag({ rendered: RENDERED })],
    surface,
    contextBlocks: [B1],
  });
  assert.strictEqual(got.split("\n\n")[0], contextSection(B1), "context is index 0");
  assert.ok(
    got.indexOf(contextSection(B1)) < got.indexOf(surface),
    "context blocks lead, surface follows"
  );
});

// ---- Frozen identity: these two are GREEN today and MUST stay GREEN. They
// guard the implementer against changing the no-context bytes.

test("frozen identity: contextBlocks undefined is byte-identical to omitting the field", () => {
  const base = { languageId: "rust", docComment: DOC, code: CODE, diagnostics: [diag({ rendered: RENDERED })] };
  const withUndef = assembleRepairPrompt({ ...base, contextBlocks: undefined });
  assert.strictEqual(withUndef, assembleRepairPrompt(base), "undefined blocks == no blocks param");
});

test("frozen identity: contextBlocks [] is byte-identical to omitting the field", () => {
  const base = { languageId: "rust", docComment: DOC, code: CODE, diagnostics: [diag({ rendered: RENDERED })], surface: "S" };
  const withEmpty = assembleRepairPrompt({ ...base, contextBlocks: [] });
  assert.strictEqual(withEmpty, assembleRepairPrompt(base), "empty blocks == no blocks param");
});
