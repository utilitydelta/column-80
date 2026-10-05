"use strict";

// session-v77 phase 5, lane 4: the text rows for Tighten, Criticize and Review that a pure
// function decides. The surfaces' behaviour rows (H2, P5A-2/3/7) live in
// impl-v77-p4-lane4.test.cjs and review-v77-p5a-surfaces.test.cjs.
//
// Run: node --test test/impl-v77-p5-lane4.test.cjs

const test = require("node:test");
const assert = require("node:assert/strict");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-v77-p5-lane4",
  `export { resolveTightenRegion } from "../src/core/tightenRegion";
export { unregisteredLanguageToast, NO_FUNCTION_TOAST } from "../src/core/criticizeGesture";
export { languageName, notServedSentence } from "../src/core/languageName";\n`,
);
test.after(cleanup);
const { resolveTightenRegion, unregisteredLanguageToast, NO_FUNCTION_TOAST, languageName } = mod;

const refusalOf = (target) => {
  const r = resolveTightenRegion(target);
  assert.equal(r.ok, false, JSON.stringify(r));
  return r.refusal;
};

// M28: one shape for a command pressed in a file it does not serve, naming the language.
test("M28: an unserved language is named as a person names it, in one shape", () => {
  assert.equal(languageName("typescriptreact"), "TypeScript React");
  for (const [id, name] of [
    ["jsonc", "JSON with Comments"],
    ["plaintext", "plain text"],
    ["ruby", "Ruby"],
    ["haskell", "haskell"],
  ]) {
    assert.equal(languageName(id), name);
    const works = "It works in Rust, TypeScript, JavaScript, C#, Python and Go.";
    assert.equal(
      refusalOf({ text: "// a comment with enough words\n", languageId: id, cursor: 3 }),
      `Tighten Doc Comment does not work in ${name} files. ${works}`,
    );
    assert.equal(unregisteredLanguageToast(id), `Column 80: Criticize Function does not work in ${name} files. ${works}`);
  }
});

// M29: one sentence for no function at the cursor.
test("M29: no function at the cursor says what to do, in the shared sentence", () => {
  assert.equal(NO_FUNCTION_TOAST, "Column 80: put the cursor inside a function first.");
});

// L8: a target the command built itself is never malformed in a way the user can fix.
test("L8: an internal target defect reads as an internal error, not as its state name", () => {
  const internal = "Tighten Doc Comment hit an internal error and wrote nothing.";
  for (const target of [
    null,
    { text: 1, languageId: "rust", cursor: 0 },
    { text: "// x\n", languageId: "rust", cursor: 99 },
  ]) {
    assert.equal(refusalOf(target), internal, JSON.stringify(target));
  }
});

// L9: every toast is lower case after the "Column 80: " prefix the surface adds.
test("L9: a refusal that is not a command name starts lower case", () => {
  const rows = [
    ["\n", 0],
    ["let total = shard + cache;\n", 3],
    ["just three words\n", 4],
    ['"""\nnever closes\n', 1],
  ];
  for (const [text, cursor] of rows) {
    const refusal = refusalOf({ text, languageId: text.startsWith('"""') ? "python" : "rust", cursor });
    assert.ok(
      refusal.startsWith("Tighten Doc Comment") || /^[a-z]/.test(refusal),
      `capital after the prefix: ${refusal}`,
    );
  }
});
