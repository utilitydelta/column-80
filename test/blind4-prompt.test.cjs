// Blind oracle: assembleRepairPrompt, byte-pinned (phase4-surface.md "Repair
// prompt": deterministic, byte-for-byte, sections joined by "\n\n", the
// spike's driver3 REPAIR_PROMPT shape ported not reinvented). Input fields
// per the surface's section rules: languageId, docComment, code, and the
// eligible diagnostics in order. Never read src/**. Expected red on stubs.
//
// Run: npm test

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "blind4-prompt",
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

// A real rendered string from the committed borrow capture: rustc renders
// with help lines and a trailing blank line, so normalization has real work.
const borrowLine = fs
  .readFileSync(path.join(__dirname, "fixtures", "rustc", "borrow-error.json"), "utf8")
  .split("\n")
  .find((l) => l.includes('"compiler-message"'));
const REAL_RENDERED = JSON.parse(borrowLine).message.rendered;
assert.ok(/\s$/.test(REAL_RENDERED), "fixture sanity: rustc rendered ends in trailing whitespace to strip");

const CODE = "pub fn sum_even(values: &[i64]) -> i64 {\n    values.iter().sum::<i64>() + \"x\"\n}";
const DOC = "/// Sums the even numbers.";

test("canonical assembly is byte-pinned: doc comment, code, one rendered diagnostic, fixed instruction [surface: 'deterministic, byte-for-byte, same discipline as assembleFnGenPrompt']", () => {
  const rendered = "error[E0308]: mismatched types\n --> src/task1.rs:14:21";
  const got = assembleRepairPrompt({
    languageId: "rust",
    docComment: DOC,
    code: CODE,
    diagnostics: [diag({ rendered: rendered + "  \n\n" })], // trailing whitespace stripped, exactly one \n appended
  });
  const expected =
    "The function below failed the compiler check:\n" +
    FENCE + "rust\n" +
    DOC + "\n" +
    CODE + "\n" +
    FENCE +
    "\n\n" +
    "Compiler diagnostics:\n" +
    FENCE + "\n" +
    rendered + "\n" +
    FENCE +
    "\n\n" +
    INSTRUCTION;
  assert.strictEqual(got, expected);
});

test("assembly is deterministic: identical input twice yields identical bytes", () => {
  const input = { languageId: "rust", docComment: DOC, code: CODE, diagnostics: [diag({ rendered: REAL_RENDERED })] };
  assert.strictEqual(assembleRepairPrompt(input), assembleRepairPrompt(input));
});

test("no docComment: section 1 is fence, code, fence with nothing between tag line and code [surface: 'when docComment is present']", () => {
  const got = assembleRepairPrompt({ languageId: "rust", code: "fn f() {}\n", diagnostics: [diag({ rendered: "e\n" })] });
  assert.ok(got.startsWith("The function below failed the compiler check:\n" + FENCE + "rust\nfn f() {}\n" + FENCE + "\n\n"), `got ${JSON.stringify(got.slice(0, 80))}`);
});

test("languageId absent: empty fence tag [surface: '(empty tag when absent)']", () => {
  const got = assembleRepairPrompt({ code: "fn f() {}\n", diagnostics: [diag({ rendered: "e\n" })] });
  assert.ok(got.startsWith("The function below failed the compiler check:\n" + FENCE + "\nfn f() {}\n"), `got ${JSON.stringify(got.slice(0, 60))}`);
});

const docVariants = [
  { name: "no trailing newline", doc: "/// d" },
  { name: "one trailing newline", doc: "/// d\n" },
  { name: "three trailing newlines", doc: "/// d\n\n\n" },
];
const pinnedDocSection = "The function below failed the compiler check:\n" + FENCE + "rust\n/// d\nfn f() {}\n" + FENCE;
for (const { name, doc } of docVariants) {
  test(`doc comment normalized to exactly one trailing newline: ${name} [surface: 'normalized to end with exactly one \\n']`, () => {
    const got = assembleRepairPrompt({ languageId: "rust", docComment: doc, code: "fn f() {}", diagnostics: [diag({ rendered: "e\n" })] });
    assert.strictEqual(got.split("\n\n")[0], pinnedDocSection);
  });
}

test("code keeps its own trailing newline; one is appended only when missing [surface: 'code (a \\n appended when missing)']", () => {
  const withNl = assembleRepairPrompt({ languageId: "rust", code: "fn f() {}\n", diagnostics: [diag({ rendered: "e\n" })] });
  const withoutNl = assembleRepairPrompt({ languageId: "rust", code: "fn f() {}", diagnostics: [diag({ rendered: "e\n" })] });
  assert.strictEqual(withNl, withoutNl, "same bytes either way");
  assert.ok(!withNl.includes("fn f() {}\n\n" + FENCE), "never a doubled newline before the closing fence");
});

test("diagnostics render rendered-when-present else message, normalized, concatenated in order [surface: 'its rendered when present else its message, each normalized']", () => {
  const got = assembleRepairPrompt({
    languageId: "rust",
    code: "fn f() {}\n",
    diagnostics: [
      diag({ rendered: "error[E0308]: first\n\n" }),
      diag({ code: "E0425", message: "cannot find value `x` in this scope   " }), // no rendered: message, trailing whitespace stripped
      diag({ rendered: "error[E0596]: third" }),
    ],
  });
  const section2 = got.split("\n\n")[1];
  assert.strictEqual(
    section2,
    "Compiler diagnostics:\n" + FENCE + "\n" +
      "error[E0308]: first\n" +
      "cannot find value `x` in this scope\n" +
      "error[E0596]: third\n" +
      FENCE
  );
});

test("a real rustc rendered block rides whole: spans, labels, and the help '+' line survive into the prompt [surface: 'rendered carries the spans and expected/found labels ... rustc's own fix hints without a second serialization']", () => {
  const got = assembleRepairPrompt({ languageId: "rust", code: CODE, diagnostics: [diag({ code: "E0596", rendered: REAL_RENDERED })] });
  assert.ok(got.includes("error[E0596]: cannot borrow `result` as mutable"), "rendered head present");
  assert.ok(got.includes("consider changing this to be mutable"), "rustc's help line rides inside rendered");
  assert.ok(got.includes(REAL_RENDERED.replace(/\s+$/, "") + "\n" + FENCE), "full rendered body, trailing whitespace stripped, one newline, then the fence");
});

test("the prompt ends with the fixed instruction line, no trailing newline [surface: section 3 is last, sections joined by '\\n\\n']", () => {
  const got = assembleRepairPrompt({ languageId: "rust", code: CODE, diagnostics: [diag({ rendered: "e\n" })] });
  assert.ok(got.endsWith("\n\n" + INSTRUCTION), `got tail ${JSON.stringify(got.slice(-60))}`);
  const sections = got.split("\n\n");
  assert.strictEqual(sections.length, 3, "exactly three sections for a single-line-rendered input");
});
