// Implementer tests for the P5b wiring's testable cores (the review fixes that
// scope the cargo test rung to a function's OWN generated tests, killing the
// false-blame the whole-crate `tests::` filter caused):
//   - buildTestCommand accepts an ARRAY of test-name filters (OR-ed by libtest).
//   - generatedTestNames extracts a function's generated #[test] names from its
//     marked region, so runTddTests can scope the rung to exactly those.
//
// Run: SKIP_LIVE=1 node --test test/impl-v8-wiring-cores.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-v8-wiring-cores",
  `export { buildTestCommand } from "../src/core/compilerOracle";
export { planTestInsertion, generatedTestNames } from "../src/core/testAssembly";\n`
);
const { buildTestCommand, planTestInsertion, generatedTestNames } = mod;
test.after(cleanup);

// ---- buildTestCommand: array of filters -----------------------------------

test("buildTestCommand OR-s an array of test-name filters as positionals", () => {
  const cmd = buildTestCommand("/w", ["kth_largest_happy", "kth_largest_edge"]);
  assert.strictEqual(cmd.command, "cargo");
  assert.deepStrictEqual(cmd.args, ["test", "--lib", "kth_largest_happy", "kth_largest_edge"]);
});

test("buildTestCommand string filter still works (unchanged); empties dropped", () => {
  assert.deepStrictEqual(buildTestCommand("/w", "tests::").args, ["test", "--lib", "tests::"]);
  assert.deepStrictEqual(buildTestCommand("/w", "").args, ["test", "--lib"]);
  assert.deepStrictEqual(buildTestCommand("/w", ["", "x"]).args, ["test", "--lib", "x"]);
  assert.deepStrictEqual(buildTestCommand("/w", ["a"], { noRun: true }).args, ["test", "--lib", "--no-run", "a"]);
});

// ---- generatedTestNames: scope to a function's own tests -------------------

test("generatedTestNames extracts the #[test] fn names from the fn's marked region", () => {
  // Build the marked region via planTestInsertion (new-module), splice it, read back.
  const genModule = `#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn kth_happy() { assert_eq!(kth_largest(&[3,1], 1), 3); }
    #[test]
    fn kth_edge() { assert_eq!(kth_largest(&[1], 1), 1); }
}`;
  const plan = planTestInsertion("pub fn kth_largest() {}\n", genModule, { markerId: "kth_largest" });
  const fileText = "pub fn kth_largest() {}\n" + plan.text;
  const names = generatedTestNames(fileText, "kth_largest");
  assert.deepStrictEqual(names, ["kth_happy", "kth_edge"], "exactly this fn's generated test names");
});

test("planTestInsertion indents the FIRST #[test] like the rest — no ragged column-0 line", () => {
  const genModule = [
    "#[cfg(test)]",
    "mod tests {",
    "    use super::*;",
    "    #[test]",
    "    fn happy() { assert_eq!(f(1), 2); }",
    "    #[test]",
    "    fn edge() { assert_eq!(f(0), 0); }",
    "}",
  ].join("\n");
  const indentOf = (l) => /^[ \t]*/.exec(l)[0].length;
  for (const mode of [
    { file: "pub fn f() {}\n", label: "new-module" },
    { file: "pub fn f() {}\n#[cfg(test)]\nmod tests {\n    use super::*;\n}\n", label: "extend-existing" },
  ]) {
    const plan = planTestInsertion(mode.file, genModule, { markerId: "f" });
    const lines = plan.text.split("\n");
    const testLines = lines.filter((l) => l.includes("#[test]"));
    assert.ok(testLines.length >= 1, `${mode.label}: has #[test] lines`);
    for (const l of testLines) {
      assert.ok(/^\s+#\[test\]/.test(l), `${mode.label}: every #[test] is indented, got ${JSON.stringify(l)}`);
    }
    // #[test] and its fn share an indent (the ragged bug had #[test] at 0, fn at 4).
    const t = lines.find((l) => l.includes("#[test]"));
    const fn = lines.find((l) => /\bfn happy\b/.test(l));
    assert.strictEqual(indentOf(t), indentOf(fn), `${mode.label}: #[test] and its fn align`);
  }
});

test("generatedTestNames is empty when the fn has no generated tests (run-first guard)", () => {
  assert.deepStrictEqual(generatedTestNames("pub fn f() {}\n#[cfg(test)] mod tests { #[test] fn dev() {} }", "f"), []);
});

test("generatedTestNames scopes by markerId — a different fn's region is not returned", () => {
  const genA = `#[cfg(test)]\nmod tests {\n    #[test]\n    fn a_one() {}\n}`;
  const planA = planTestInsertion("fn a(){}\nfn b(){}\n", genA, { markerId: "a" });
  const file = "fn a(){}\nfn b(){}\n" + planA.text;
  assert.deepStrictEqual(generatedTestNames(file, "a"), ["a_one"]);
  assert.deepStrictEqual(generatedTestNames(file, "b"), [], "fn b has no marked region");
});
