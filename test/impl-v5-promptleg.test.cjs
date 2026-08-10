// Implementer edge tests for the prompt leg (v5 goal item 6), complementing the
// blind oracle (test/blind-v5-promptleg.test.cjs): the integrated repro path
// (file source -> local defs -> referenced subset -> rendered prompt) and the
// section's placement relative to the target fence.
//
// Run: SKIP_LIVE=1 node --test test/impl-v5-promptleg.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-v5-promptleg",
  `export { assembleFnGenPrompt } from "../src/core/prompt";
export { fileLocalDefinitions, referencedLocalSymbols } from "../src/core/instructPostprocess";\n`
);
const { assembleFnGenPrompt, fileLocalDefinitions, referencedLocalSymbols } = mod;
test.after(cleanup);

// The repro: CohortRegister is a same-file pub struct named in the doc. The full
// pipeline must surface it as a local symbol in the prompt.
test("repro pipeline: CohortRegister flows from file source into a no-import instruction", () => {
  const src = [
    "use atlas::{Envelope, Stripe, Tile};",
    "pub struct CohortRegister {",
    "    by_cohort: std::collections::HashMap<u32, Vec<u64>>,",
    "}",
    "fn cohort_seven_count() -> usize { todo!() }",
  ].join("\n");
  const signature = "fn cohort_seven_count() -> usize";
  const doc = "/// Create a `CohortRegister`, induct ids, then return the tally for cohort 7.";
  const defs = fileLocalDefinitions(src);
  defs.delete("cohort_seven_count"); // the call site drops the target's own name
  const locals = referencedLocalSymbols(signature, doc, defs);
  assert.deepStrictEqual(locals, ["CohortRegister"], "only the referenced local def is selected");
  const prompt = assembleFnGenPrompt({ signature, docComment: doc, localSymbols: locals });
  assert.ok(prompt.includes("CohortRegister"), "the name is in the prompt");
  assert.ok(/do NOT add a use import|already in scope|defined in this file/i.test(prompt));
  assert.ok(!/use atlas::CohortRegister/.test(prompt), "the prompt itself invents no import");
});

// The section must sit OUTSIDE (before) the final target fence that carries the
// signature, so it reads as instruction, never as code to emit.
test("the local-symbols section precedes the target signature fence", () => {
  const prompt = assembleFnGenPrompt({
    signature: "fn f() -> Widget",
    localSymbols: ["Widget"],
  });
  const noteIdx = prompt.indexOf("already in scope");
  const sigIdx = prompt.lastIndexOf("fn f() -> Widget");
  assert.ok(noteIdx >= 0 && noteIdx < sigIdx, "the note comes before the target signature");
});

// referencedLocalSymbols: a local def named only in the return type of the
// signature still counts; first-seen order is signature-before-doc.
test("referencedLocalSymbols: signature return type counts; order is signature-then-doc", () => {
  const locals = referencedLocalSymbols(
    "fn build() -> Registry",
    "/// Also touches `Envelope`.",
    new Set(["Registry", "Envelope", "Unused"]),
  );
  assert.deepStrictEqual(locals, ["Registry", "Envelope"], "Registry (sig) before Envelope (doc); Unused excluded");
});

// P2 review finding #2: a doc PROSE verb that equals a short local fn/mod name
// must NOT be selected; a backtick-quoted mention of the same name IS a real
// reference. The signature side keeps plain whole-word matching.
test("referencedLocalSymbols: a doc-prose verb equal to a local name is not selected", () => {
  const defs = new Set(["count", "build", "map"]);
  const proseOnly = referencedLocalSymbols("fn seven() -> usize", "/// Then count and build the map.", defs);
  assert.deepStrictEqual(proseOnly, [], "bare prose verbs are not code references");
  const backticked = referencedLocalSymbols("fn seven() -> usize", "/// Then call `count` on it.", defs);
  assert.deepStrictEqual(backticked, ["count"], "a backtick-quoted local name IS selected");
});

test("referencedLocalSymbols: a PascalCase local type named unbacktick'd in the doc is selected", () => {
  const got = referencedLocalSymbols("fn f() -> usize", "/// Build a CohortRegister and tally.", new Set(["CohortRegister"]));
  assert.deepStrictEqual(got, ["CohortRegister"], "PascalCase is type-shaped, a real reference");
});

test("referencedLocalSymbols: a backticked path leaf resolves the local name", () => {
  const got = referencedLocalSymbols("fn f() {}", "/// Uses `crate::inner::helper` here.", new Set(["helper"]));
  assert.deepStrictEqual(got, ["helper"], "the path leaf names the local fn");
});

// No local symbols referenced -> empty -> the prompt is unchanged from a
// no-localSymbols call (the byte-identity guard, integrated form).
test("no referenced local -> prompt identical to a bare call", () => {
  const src = "pub struct Unrelated;\nfn f() {}";
  const signature = "fn f() -> bool";
  const defs = fileLocalDefinitions(src);
  defs.delete("f"); // the call site drops the target's own name
  const locals = referencedLocalSymbols(signature, undefined, defs);
  assert.deepStrictEqual(locals, [], "nothing local is referenced");
  const withField = assembleFnGenPrompt({ signature, localSymbols: locals });
  const bare = assembleFnGenPrompt({ signature });
  assert.strictEqual(withField, bare, "empty selection leaves the prompt byte-identical");
});
