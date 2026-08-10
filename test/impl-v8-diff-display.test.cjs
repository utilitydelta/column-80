// Implementer oracle for the v8 TDD regen-review: blankSnippetToDisplay turns a
// blank-value snippet into readable plain text for the read-only diff — holes
// become placeholders (never the model's guessed values), snippet metacharacters
// unescape. Pure; runs headless.
//
// Run: SKIP_LIVE=1 node --test test/impl-v8-diff-display.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-v8-diff-display",
  `export { blankTestModule, blankSnippetToDisplay } from "../src/core/testAssembly";\n`,
);
const { blankTestModule, blankSnippetToDisplay } = mod;
test.after(cleanup);

test("a bare scalar hole becomes a readable /* value */ placeholder", () => {
  assert.strictEqual(
    blankSnippetToDisplay("assert_eq!(f(x), ${1});"),
    "assert_eq!(f(x), /* value */);",
  );
});

test("a hinted collection hole keeps its type hint as the placeholder", () => {
  assert.strictEqual(
    blankSnippetToDisplay("assert_eq!(g(), HashSet::from([${1:/* String */}]));"),
    "assert_eq!(g(), HashSet::from([/* String */]));",
  );
});

test("snippet metacharacters unescape (\\$ \\} \\\\)", () => {
  assert.strictEqual(blankSnippetToDisplay("let s = \"\\$x\";"), 'let s = "$x";');
  assert.strictEqual(blankSnippetToDisplay("m(\\{\\})"), "m({})");
});

test("an escaped } inside a hint is literal, not the placeholder close", () => {
  // renderBlankValue escapes a `}` in a type string to `\}` inside the hint.
  assert.strictEqual(
    blankSnippetToDisplay("v = ${1:/* {unknown\\} */};"),
    "v = /* {unknown} */;",
  );
});

test("round-trip: a real blanked module -> display has NO snippet syntax and NO guessed values", () => {
  const moduleText = [
    "#[cfg(test)]",
    "mod tests {",
    "    use super::*;",
    "    #[test]",
    "    fn t() {",
    "        assert_eq!(kth_largest(&[3, 1, 4], 1), 4);", // model's guess `4`
    "        assert_eq!(distinct(&[1, 1]), HashSet::from([1]));", // model's guess `[1]`
    "    }",
    "}",
  ].join("\n");
  const { snippet } = blankTestModule(moduleText, "usize");
  const display = blankSnippetToDisplay(snippet);
  assert.ok(!/\$\{/.test(display), "no ${…} snippet holes remain in the display text");
  assert.ok(!display.includes(", 4)"), "the model's guessed scalar value is blanked, not shown");
  assert.ok(display.includes("/* value */"), "the scalar expected value reads as a placeholder");
  assert.ok(display.includes("kth_largest(&[3, 1, 4], 1)"), "the call (the input) is preserved verbatim");
});
