// Implementer tests for the P5b wiring's testable cores (the review fixes that
// scope the cargo test rung to a function's OWN generated tests, killing the
// false-blame the whole-crate `tests::` filter caused):
//   - buildTestCommand accepts an ARRAY of test-name filters and puts them past
//     the `--` separator, which is where libtest reads them and OR-s them.
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

/** A one-file crate whose root IS the file under test, so it contributes no
 *  module segment of its own and the enclosing `mod` chain is the whole libtest
 *  path. Handed in rather than assumed: a file's own segment is not in its text,
 *  and without a crate to walk the reader cannot prove a path is complete. */
const crateCtx = (text) => ({
  filePath: "/w/src/lib.rs",
  crateRoot: "/w",
  files: {
    fileExists: (p) => p === "/w/Cargo.toml" || p === "/w/src/lib.rs",
    readFile: (p) => (p === "/w/Cargo.toml" ? '[package]\nname = "w"\n' : p === "/w/src/lib.rs" ? text : undefined),
  },
});

// ---- buildTestCommand: array of filters -----------------------------------

test("buildTestCommand puts an array of test-name filters PAST `--`, which is the only way libtest ever sees more than one", () => {
  // This row used to pin the names as bare cargo positionals and called that
  // "OR-ing". It was not: `cargo test` takes exactly ONE [TESTNAME], and a
  // second one is `error: unexpected argument 'kth_largest_edge' found` with no
  // test run at all — which the product then reported to the human as "the
  // tests did not compile". Past `--` the args belong to libtest, which takes
  // as many filters as it is given and OR-s them.
  const cmd = buildTestCommand("/w", ["kth_largest_happy", "kth_largest_edge"]);
  assert.strictEqual(cmd.command, "cargo");
  assert.deepStrictEqual(cmd.args, ["test", "--lib", "--", "kth_largest_happy", "kth_largest_edge"]);
});

test("buildTestCommand string filter still works; empties dropped, and no separator when nothing survives", () => {
  assert.deepStrictEqual(buildTestCommand("/w", "tests::").args, ["test", "--lib", "--", "tests::"]);
  assert.deepStrictEqual(buildTestCommand("/w", "").args, ["test", "--lib"], "no filter, no dangling `--`");
  assert.deepStrictEqual(buildTestCommand("/w", ["", "x"]).args, ["test", "--lib", "--", "x"]);
  // --no-run is cargo's flag, so it stays on cargo's side of the separator.
  assert.deepStrictEqual(buildTestCommand("/w", ["a"], { noRun: true }).args, ["test", "--lib", "--no-run", "--", "a"]);
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
  // INVERTED by item 59. The names used to come back bare, and bare names are
  // what forced the rung onto SUBSTRING filters, where `add` also runs
  // `add_more`. They now carry the enclosing `mod` path, which is the only
  // string `--exact` matches.
  //
  // RE-CUT after the first cut of that inversion shipped a REGRESSION. It read
  // the `mod` chain out of the file's text alone and called that a full path.
  // A libtest path also starts with the segment the FILE contributes by being a
  // module, and no amount of reading the file shows it — so on the normal crate
  // layout the rung emitted `--exact widget_checks::add` where cargo wanted
  // `geometry::widget_checks::add` and selected ZERO tests. The crate is handed
  // in now, and a text-only call answers bare on purpose.
  const names = generatedTestNames(fileText, "kth_largest", crateCtx(fileText));
  assert.deepStrictEqual(names, ["tests::kth_happy", "tests::kth_edge"], "exactly this fn's generated test names");
  assert.deepStrictEqual(
    generatedTestNames(fileText, "kth_largest"),
    ["kth_happy", "kth_edge"],
    "no crate to walk means the path cannot be proven complete, and an unproven path stays on substring",
  );
});

// ---- the two halves joined, with REAL names --------------------------------

test("FIXTURE FIDELITY: the names generatedTestNames really produces carry the enclosing module, and buildTestCommand must build a command libtest accepts from THOSE — a hand-written fixture hides a real-world break", () => {
  // INVERTED by item 59, and the inversion is the fix landing.
  //
  // This row used to pin the names as BARE (`add_returns_sum`) and `--exact` as
  // ABSENT, because bare names were what the product really emitted and
  // `--exact` against a bare name selects ZERO tests on cargo 1.96 — measured.
  // The names now carry the resolved `mod` path, so exactness is reachable and
  // the rung stops running `add_more` when it was scoped to `add`.
  //
  // The fidelity demand is unchanged, and the first cut of the inversion is
  // what proved it: every fixture here writes the crate ROOT, so nothing
  // exercised the segment a file contributes by being a module, and a rung that
  // selected ZERO on the normal Rust layout shipped green. `crateCtx` names the
  // file as the root deliberately — the layouts that do NOT are graded against
  // real cargo in test/impl-v59-p4-scoped-rung.test.cjs.
  const genModule = `#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn add_returns_sum() { assert_eq!(add(2, 3), 5); }
    #[test]
    fn add_handles_zero() { assert_eq!(add(0, 0), 0); }
}`;
  const src = "pub fn add(a: i32, b: i32) -> i32 { a + b }\n";
  const plan = planTestInsertion(src, genModule, { markerId: "add" });
  const fileText = src + plan.text;
  const names = generatedTestNames(fileText, "add", crateCtx(fileText));

  assert.deepStrictEqual(names, ["tests::add_returns_sum", "tests::add_handles_zero"], "full libtest paths — this is the real shape");
  assert.ok(names.every((n) => n.includes("::")), "if this ever fails the product went back to bare names and --exact must go with them");

  const cmd = buildTestCommand("/w", names);

  // A command libtest accepts: cargo's own args first, then the separator, then
  // the flag and the filters. Anything cargo has to parse itself is limited to
  // ONE [TESTNAME], so a second name before `--` would be a hard error, not a
  // run — and `--exact` before it would be cargo's flag, not libtest's.
  const sep = cmd.args.indexOf("--");
  assert.notStrictEqual(sep, -1, "there is a separator");
  assert.deepStrictEqual(cmd.args.slice(0, sep), ["test", "--lib"], "cargo sees only its own flags and no positional");
  assert.deepStrictEqual(cmd.args.slice(sep + 1), ["--exact", ...names], "libtest sees --exact and then the full paths, in order");
  assert.deepStrictEqual(cmd.args, ["test", "--lib", "--", "--exact", "tests::add_returns_sum", "tests::add_handles_zero"]);
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
  assert.deepStrictEqual(generatedTestNames(file, "a", crateCtx(file)), ["tests::a_one"]);
  assert.deepStrictEqual(generatedTestNames(file, "b", crateCtx(file)), [], "fn b has no marked region");
});
