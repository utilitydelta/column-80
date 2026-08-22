// Blind oracle: the two pure test-assembly cores [the P5 surface document,
// composing the P3 renderBlankValue rule; goal contract items 2, 3, 5 and
// finding 9]. Two exports from ../src/core/testAssembly:
//   blankTestModule(moduleText, returnType, opts?) -> { snippet, holes }
//     replaces each assert_eq!/assert_ne! EXPECTED value (the 2nd top-level
//     macro arg) with sequential ${N} tabstop holes per renderBlankValue, and
//     snippet-escapes ALL other literal text so $ and \ insert verbatim.
//   planTestInsertion(fileText, generatedModule, opts?) -> { start,end,text,mode }
//     detect-and-extend placement, marker-based idempotent regeneration.
// Never read src/**; both are stubs. blankTestModule stub returns the module
// unchanged (holes:0) so the hole/escaping cases are genuine RED;
// planTestInsertion stub always new-module-at-end so extend/replace are RED.
//
// Run: SKIP_LIVE=1 node --test test/blind-v8-assembly.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "blind-v8-assembly",
  `export { blankTestModule, planTestInsertion } from "../src/core/testAssembly";\n`
);
const { blankTestModule, planTestInsertion } = mod;
test.after(cleanup);

// The cross-check the impl cannot fudge: `holes` MUST equal the number of ${…}
// hole-openers in the snippet [P5 clause "Total tabstop holes across the
// module"; mirrors the P3 `holes == count of ${…}` invariant].
const countHoles = (s) => (s.match(/\$\{/g) || []).length;

// =====================================================================
// blankTestModule
// =====================================================================

test("scalar return: EXPECTED value of every assert_eq! becomes a hole, numbered sequentially ACROSS assertions, call args untouched [P5 'the EXPECTED value is the 2nd top-level macro argument' + 'holes number 1,2,3,… across the whole module']", () => {
  const moduleText =
    "assert_eq!(kth_largest(&[3,1,4,1,5], 2), 4);\n" +
    "assert_eq!(kth_largest(&[1],1), 1);";
  const res = blankTestModule(moduleText, "i32");

  assert.strictEqual(res.holes, 2, "two scalar expected values -> two holes");
  assert.ok(res.snippet.includes("${1}"), "first expected -> ${1}");
  assert.ok(res.snippet.includes("${2}"), "second expected -> ${2}, numbering runs across assertions");
  // The CALL (1st arg) is never blanked, and its own commas inside ()/[] are
  // not split as top-level args.
  assert.ok(res.snippet.includes("kth_largest(&[3,1,4,1,5], 2)"), "first call args verbatim (nested commas not split, call not blanked)");
  assert.ok(res.snippet.includes("kth_largest(&[1],1)"), "second call args verbatim");
  // Decisive: the raw expected literals are gone (only the 2nd arg is blanked).
  assert.ok(!res.snippet.includes(", 4)"), "the expected `4` was replaced, not left literal");
  assert.ok(!res.snippet.includes(", 1)"), "the expected `1` was replaced, not left literal");
  assert.strictEqual(res.holes, countHoles(res.snippet), "holes == count of ${ openers");
});

test("the 2nd arg is the expected and top-level-comma splitting respects (): tuple return scaffolds, first arg's inner comma is NOT split [P5 'split on top-level commas, respecting ()<>[]{}' + P3 tuple rule]", () => {
  const moduleText = "assert_eq!(divmod(17, 5), (3, 2));";
  const res = blankTestModule(moduleText, "(i32, i32)");

  assert.strictEqual(res.holes, 2, "(i32, i32) -> one hole per top-level element");
  assert.ok(res.snippet.includes("(${1}, ${2})"), "tuple expected scaffolded as (${1}, ${2})");
  // The FIRST arg divmod(17, 5) has a comma inside () -> must remain ONE arg,
  // never split, never blanked.
  assert.ok(res.snippet.includes("divmod(17, 5)"), "first arg intact: its inner comma is not a top-level split");
  assert.ok(!res.snippet.includes("(3, 2)"), "the expected tuple literal was replaced");
  assert.strictEqual(res.holes, countHoles(res.snippet));
});

test("custom message arg preserved: only the 2nd arg is blanked, the 3rd message stays [P5 'a 3rd custom-message argument is left intact']", () => {
  const moduleText = 'assert_eq!(f(x), 5, "must clamp");';
  const res = blankTestModule(moduleText, "i32");

  assert.strictEqual(res.holes, 1, "only the expected value is a hole");
  assert.ok(res.snippet.includes("${1}"), "expected -> ${1}");
  assert.ok(res.snippet.includes('"must clamp"'), "the 3rd custom-message argument is preserved verbatim");
  assert.ok(res.snippet.includes("f(x)"), "call arg untouched");
  assert.ok(!res.snippet.includes(", 5,"), "the expected `5` was replaced, not left literal");
  assert.strictEqual(res.holes, countHoles(res.snippet));
});

test("collection return: a Vec expected scaffolds the constructor with the contents as ONE hole; the model's guessed VALUES are blanked [P5 renderBlankValue + P3 collection rule]", () => {
  const moduleText =
    "assert_eq!(run_length_encode(\"aabaa\"), vec![('a', 2), ('b', 1), ('a', 2)]);";
  const res = blankTestModule(moduleText, "Vec<(char, usize)>");

  assert.strictEqual(res.holes, 1, "the contents (count + values) stay a single hole");
  assert.ok(
    res.snippet.includes("vec![${1:/* (char, usize) */}]"),
    "the type-determined vec! constructor is scaffolded; contents are one hole hinting the element type",
  );
  assert.ok(res.snippet.includes('run_length_encode("aabaa")'), "call arg untouched");
  // No VALUE leak: the model's guessed tuples are gone even though the vec! wrapper
  // (which the return TYPE fixes, not the answer) is present.
  assert.ok(!res.snippet.includes("('a', 2)"), "the model's guessed vec CONTENTS were blanked away (no answer leak)");
  assert.strictEqual(res.holes, countHoles(res.snippet));
});

test("fixed struct: expected scaffolds one hole per field in field order [P5 renderBlankValue(structFields) + P3 fixed-struct rule]", () => {
  const moduleText = "assert_eq!(origin_shifted(2, 3), Point { x: 5, y: 8 });";
  const res = blankTestModule(moduleText, "Point", {
    structFields: [
      { name: "x", typeName: "i32" },
      { name: "y", typeName: "i32" },
    ],
  });

  assert.strictEqual(res.holes, 2, "one hole per struct field");
  assert.ok(res.snippet.includes("Point { x: ${1}, y: ${2} }"), "fixed struct scaffolded in field order");
  assert.ok(res.snippet.includes("origin_shifted(2, 3)"), "call arg intact (its comma is not a top-level split)");
  assert.ok(!res.snippet.includes("x: 5"), "the model's guessed field values were blanked");
  assert.strictEqual(res.holes, countHoles(res.snippet));
});

test("assert! / #[should_panic] have no expected slot -> untouched, zero holes [P5 'assert! / should_panic tests have no expected-value slot -> left unchanged']", () => {
  const moduleText =
    "assert!(is_ok(x));\n\n#[should_panic]\nfn panics() {\n    do_thing();\n}";
  const res = blankTestModule(moduleText, "bool");

  assert.strictEqual(res.holes, 0, "no assert_eq!/assert_ne! -> no blankable slot -> 0 holes");
  assert.ok(!res.snippet.includes("${"), "no tabstop holes emitted");
  assert.strictEqual(res.holes, countHoles(res.snippet));
});

test("snippet escaping (load-bearing): literal $ and \\ OUTSIDE the blanked value are escaped to insert verbatim, while ${N} stays a live hole [P5 'every LITERAL $ and \\ … MUST be escaped (\\$, \\\\)']", () => {
  // Rust module text (actual chars): let s = "a$b\c"; assert_eq!(f(s), 1);
  const moduleText = 'let s = "a$b\\c";\nassert_eq!(f(s), 1);';
  const res = blankTestModule(moduleText, "i32");

  assert.strictEqual(res.holes, 1, "one scalar expected -> one hole");
  assert.ok(res.snippet.includes("${1}"), "the expected value is a REAL live hole");
  // The literal $ -> \$ and the literal \ -> \\ so they insert verbatim.
  // JS 'a\\$b\\\\c' == the chars  a \ $ b \ \ c
  assert.ok(res.snippet.includes("a\\$b\\\\c"), "literal $ and \\ are snippet-escaped (\\$, \\\\)");
  // Decisive against a naive pass-through: the UNescaped run must be absent.
  assert.ok(!res.snippet.includes("a$b\\c"), "the raw unescaped literal must not survive (it would corrupt the inserted snippet)");
  assert.strictEqual(res.holes, countHoles(res.snippet), "the escaped \\$ is NOT counted as a hole; only ${1} is");
});

test("robustness: empty module and a module with no asserts -> holes 0, never throws [P5 'Never throws; a module with no blankable assertion -> holes 0']", () => {
  const empty = blankTestModule("", "i32");
  assert.strictEqual(empty.holes, 0, "empty module -> 0 holes");
  assert.strictEqual(empty.holes, countHoles(empty.snippet));

  const noAsserts = blankTestModule("fn helper() -> i32 { 0 }", "i32");
  assert.strictEqual(noAsserts.holes, 0, "no assertions -> 0 holes");
  assert.ok(!noAsserts.snippet.includes("${"), "no holes emitted");
  assert.strictEqual(noAsserts.holes, countHoles(noAsserts.snippet));
});

// =====================================================================
// planTestInsertion
// =====================================================================

// The model's generated tests: a full #[cfg(test)] mod tests block (the shape
// fnGenService extracts). planTestInsertion decides WHERE and unwraps as needed.
const GEN_MODULE =
  "#[cfg(test)]\n" +
  "mod tests {\n" +
  "    use super::*;\n" +
  "\n" +
  "    #[test]\n" +
  "    fn gen_happy() {\n" +
  "        assert_eq!(foo(2), 4);\n" +
  "    }\n" +
  "}";

test("new-module: no existing mod tests and no marker -> append a fresh module at EOF [P5 'append a fresh marker-wrapped #[cfg(test)] mod tests at end of file']", () => {
  const fileText = "pub fn foo(n: i32) -> i32 { n * 2 }\n";
  const plan = planTestInsertion(fileText, GEN_MODULE, { markerId: "abc" });

  assert.strictEqual(plan.mode, "new-module");
  assert.strictEqual(plan.start, fileText.length, "pure append: start at EOF");
  assert.strictEqual(plan.end, fileText.length, "pure append: start == end (no region replaced)");
  assert.ok(plan.text.includes("#[cfg(test)]") && plan.text.includes("mod tests"), "the appended text is a fresh test module");
});

test("new-module carries the distinctive marker derived from markerId [P5 'a distinctive MARKER … default derived from markerId' — regeneration idempotency hook]", () => {
  const fileText = "pub fn foo(n: i32) -> i32 { n * 2 }\n";
  const plan = planTestInsertion(fileText, GEN_MODULE, { markerId: "abc" });
  assert.ok(plan.text.includes("abc"), "the generated text references the markerId so a later run can find and replace it");
});

test("extend-existing: an existing #[cfg(test)] mod tests -> splice INSIDE it, before its closing }, without a second module or duplicate `use super::*;` [P5 'insert … at the END of that module … do NOT emit a second mod tests or duplicate use super::*;']", () => {
  const fileText =
    "pub fn foo(n: i32) -> i32 { n * 2 }\n" +
    "\n" +
    "#[cfg(test)]\n" +
    "mod tests {\n" +
    "    use super::*;\n" +
    "    #[test] fn dev_test() {}\n" +
    "}\n";
  const plan = planTestInsertion(fileText, GEN_MODULE, { markerId: "abc" });

  assert.strictEqual(plan.mode, "extend-existing");

  // Splice offset lands strictly inside the module's byte range: after its
  // opening `{`, at or before its closing `}` (the module close is the last }).
  const braceOpen = fileText.indexOf("{", fileText.indexOf("mod tests"));
  const braceClose = fileText.lastIndexOf("}");
  assert.ok(plan.start > braceOpen, "splice starts after the module's opening brace (inside the module)");
  assert.ok(plan.start <= braceClose, "splice starts at or before the module's closing brace");
  assert.ok(plan.end <= braceClose && plan.end >= plan.start, "splice region stays within the module");

  // Reuses the existing scope: the splice text must NOT re-open a module or
  // re-import the prelude.
  assert.ok(!/mod\s+tests/.test(plan.text), "no second `mod tests` emitted");
  assert.ok(!plan.text.includes("use super::*"), "the existing `use super::*;` is reused, not duplicated");
  // The generated #[test] fns ARE carried into the splice.
  assert.ok(plan.text.includes("#[test]") && plan.text.includes("gen_happy"), "the generated test fns are the splice payload");
});

test("never clobbers dev tests: the extend splice region does NOT cover the developer's dev_test [P5 goal item 5 — 'NEVER clobber the developer's']", () => {
  const fileText =
    "pub fn foo(n: i32) -> i32 { n * 2 }\n" +
    "\n" +
    "#[cfg(test)]\n" +
    "mod tests {\n" +
    "    use super::*;\n" +
    "    #[test] fn dev_test() {}\n" +
    "}\n";
  const plan = planTestInsertion(fileText, GEN_MODULE, { markerId: "abc" });

  const devStart = fileText.indexOf("#[test] fn dev_test() {}");
  const devEnd = devStart + "#[test] fn dev_test() {}".length;
  // No overlap between [start,end) and the developer's test byte range.
  const overlaps = plan.start < devEnd && plan.end > devStart;
  assert.ok(!overlaps, "the plan's [start,end) does not touch the developer's dev_test");
});

test("replace-generated (idempotent): a second regeneration replaces EXACTLY the prior generated region, leaving hand-written code intact [P5 'if the marker is already present … REPLACE exactly the previously generated region']", () => {
  const plain =
    "fn hand_written() {}\n" +
    "\n" +
    "pub fn foo(n: i32) -> i32 { n * 2 }\n";

  // First pass: no marker present -> new-module at EOF.
  const first = planTestInsertion(plain, GEN_MODULE, { markerId: "abc" });
  assert.strictEqual(first.mode, "new-module", "sanity: the first pass is a fresh append");
  const afterFirst = plain.slice(0, first.start) + first.text + plain.slice(first.end);

  // Second pass over the file that now contains our own marker -> replace.
  const second = planTestInsertion(afterFirst, GEN_MODULE, { markerId: "abc" });
  assert.strictEqual(second.mode, "replace-generated", "the marker is detected -> replace, not append");

  // The hand-written code sits entirely BEFORE the replaced region.
  const handIdx = afterFirst.indexOf("fn hand_written");
  assert.ok(second.start > handIdx, "the replaced region starts after the hand-written code");

  // [start,end) spans the WHOLE prior generated region: excise it and no marker
  // survives, while the hand-written source is untouched.
  const excised = afterFirst.slice(0, second.start) + afterFirst.slice(second.end);
  assert.ok(!excised.includes("abc"), "the replaced span covers the entire marker-delimited generated region");
  assert.ok(excised.includes("fn hand_written"), "hand-written code survives excision of the generated region");
  assert.ok(excised.includes("pub fn foo"), "the source under test survives excision");

  // Applying the replacement does NOT duplicate the generated block (idempotent).
  const afterSecond = afterFirst.slice(0, second.start) + second.text + afterFirst.slice(second.end);
  const countMarkers = (s) => (s.match(/abc/g) || []).length;
  assert.strictEqual(
    countMarkers(afterSecond),
    countMarkers(afterFirst),
    "regeneration is idempotent: the marker count does not grow",
  );
  assert.ok(afterSecond.includes("fn hand_written"), "hand-written code intact after replacement");
});

test("robustness: empty fileText -> new-module at offset 0, never throws [P5 'Pure; never throws; deterministic']", () => {
  const plan = planTestInsertion("", GEN_MODULE, { markerId: "abc" });
  assert.strictEqual(plan.mode, "new-module");
  assert.strictEqual(plan.start, 0, "append into an empty file starts at 0");
  assert.strictEqual(plan.end, 0, "pure insert: start == end == 0");
});
