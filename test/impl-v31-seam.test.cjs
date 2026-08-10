// Implementer tests for session-v31 phase 1: the TDD language seam
// (src/core/tddLang.ts), written alongside the implementation and sitting under
// the blind oracle blind-v31-seam.
//
// What these pin that the contract alone does not:
//   - the registry answers Rust and NOTHING else in phase 1;
//   - every Rust member ROUTES to the shipped function rather than
//     reimplementing it, asserted by comparing against the shipped function's
//     own output on the same input (the byte-freeze, mechanically);
//   - the libtest command is byte-identical to buildTestCommand's;
//   - TestRunParse is a strict superset of LibtestParse, same six values;
//   - frameworkFor hits and misses, and the miss names what was looked for;
//   - the deliberate runTestOracle refactor: the shipped file-path shape and
//     the new placement-taking shape produce the same result for Rust, and the
//     placement-taking one honours a run root that is NOT the source file's.
//
// Run: SKIP_LIVE=1 node --test test/impl-v31-seam.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-v31-seam",
  `export { tddLangFor, tddLanguageIds, frameworkFor, rustReturnTypeOf, blankExpectedValues } from "../src/core/tddLang";\n` +
    `export { buildTestCommand, parseLibtestOutput, runTestOracle, runTestOracleAt, runFrameworkTestsAt, RustOracle } from "../src/core/compilerOracle";\n` +
    `export { planTestInsertion, generatedTestNames, blankTestModule, rustExpectedValueSpans } from "../src/core/testAssembly";\n` +
    `export { classifyTestability } from "../src/core/testability";\n` +
    `export { renderBlankValue } from "../src/core/tabstop";\n`
);
const {
  tddLangFor,
  tddLanguageIds,
  blankExpectedValues,
  frameworkFor,
  rustReturnTypeOf,
  buildTestCommand,
  parseLibtestOutput,
  runTestOracle,
  runTestOracleAt,
  runFrameworkTestsAt,
  RustOracle,
  planTestInsertion,
  generatedTestNames,
  blankTestModule,
  rustExpectedValueSpans,
  classifyTestability,
  renderBlankValue,
} = mod;
test.after(cleanup);

const rust = () => tddLangFor("rust");

// Deps that answer for a crate at /w holding /w/src/lib.rs, with no disk behind them.
const crateDeps = (files) => ({ fileExists: (p) => files.includes(p) });
const CRATE = ["/w/Cargo.toml", "/w/src/lib.rs"];

const placementAt = (runRoot) => ({
  targetPath: `${runRoot}/src/lib.rs`,
  exists: true,
  mode: "same-file",
  runRoot,
});

// ---- 1. the registry -----------------------------------------------------

test("tddLangFor('rust') resolves, and carries the language's own name for a refusal", () => {
  const lang = rust();
  assert.ok(lang, "Rust is the one language phase 1 registers");
  assert.strictEqual(lang.languageId, "rust");
  assert.strictEqual(lang.displayName, "Rust");
});

test("tddLangFor answers undefined for every language whose phase has not landed", () => {
  // Phases 2 to 5 registered Go, the TypeScript family, Python and C#, so this
  // row has lost all five — deliberately, and the phase-1 blind oracle said in
  // its own title that it flips as each leg lands. What it still pins is the
  // rule underneath: an UNREGISTERED language is refused by name rather than
  // served another language's scaffold.
  assert.strictEqual(tddLangFor("csharp").languageId, "csharp", "C# landed in phase 5");
  assert.ok(tddLangFor("go"), "and Go is registered as of phase 2");
  for (const id of ["typescript", "typescriptreact", "javascript", "javascriptreact"]) {
    assert.ok(tddLangFor(id), `${id} is registered as of phase 3`);
  }
  assert.ok(tddLangFor("python"), "and Python as of phase 4");
});

test("tddLangFor answers undefined for a language with no phase at all, rather than guessing", () => {
  assert.strictEqual(tddLangFor("cpp"), undefined);
  assert.strictEqual(tddLangFor(""), undefined);
});

test("tddLangFor is a registry lookup, not a factory: repeated calls give the same strategy", () => {
  assert.strictEqual(tddLangFor("rust"), tddLangFor("rust"), "one strategy, so call sites can compare identity");
});

// ---- 2. the Rust adapter routes to the shipped functions -----------------

test("classifyTestability routes to the shipped classifier, verdict for verdict", () => {
  const cases = [
    ["pub async fn f() -> u32", "/// doc"],
    ["fn read(f: &mut File) -> usize", "/// doc"],
    ["fn iter(&self) -> Iter", "/// doc"],
    ["fn f(x: i32) -> u32", undefined],
    ["fn f(x: i32)", "/// doc"],
    ["fn f(x: i32) -> u32", "/// doc"],
  ];
  for (const [sig, doc] of cases) {
    assert.deepStrictEqual(
      rust().classifyTestability(sig, doc),
      classifyTestability(sig, doc),
      `the seam must not re-decide ${sig}`
    );
  }
});

test("classifyTestability through the seam never produces the new `not-exported` reason for Rust", () => {
  // `use super::*` sees private items, so Rust has no visibility refusal. The
  // reason exists in the type for TypeScript and C#; Rust must never reach it.
  const sigs = ["fn f(x: i32) -> u32", "pub(crate) fn g() -> String", "async fn h() -> u8", "fn m(&self) -> u8"];
  for (const sig of sigs) {
    assert.notStrictEqual(rust().classifyTestability(sig, "/// doc").reason, "not-exported", sig);
  }
});

test("scaffold routes to planTestInsertion, plan for plan, across all three modes", () => {
  const generated = "mod tests {\n    #[test]\n    fn t_one() { assert_eq!(f(1), 2); }\n}";
  const files = {
    "new-module": "pub fn f(x: i32) -> i32 { x }\n",
    "extend-existing": "pub fn f(x: i32) -> i32 { x }\n\n#[cfg(test)]\nmod tests {\n    use super::*;\n}\n",
    "replace-generated":
      "pub fn f(x: i32) -> i32 { x }\n\n#[cfg(test)]\nmod tests {\n    use super::*;\n" +
      "    // column80-tests:f:begin\n    #[test]\n    fn old() {}\n    // column80-tests:f:end\n}\n",
  };
  for (const [expectedMode, existingText] of Object.entries(files)) {
    const plan = rust().scaffold({ existingText, generatedTests: generated, markerId: "f", placement: placementAt("/w") });
    assert.deepStrictEqual(plan, planTestInsertion(existingText, generated, { markerId: "f" }), expectedMode);
    assert.strictEqual(plan.mode, expectedMode, "the shipped mode, unchanged");
  }
});

test("scaffold takes BARE test functions too, and the fn heads survive into the plan text", () => {
  // ScaffoldInput.generatedTests is documented as the model's test FUNCTIONS.
  // planTestInsertion reads fns out of a module's brace body, so bare functions
  // would otherwise lose their heads and leave only the first body behind.
  const bare = "#[test]\nfn t_happy() {\n    assert_eq!(widen(3), 7);\n}\n#[test]\nfn t_zero() {\n    assert_eq!(widen(0), 0);\n}";
  const plan = rust().scaffold({ existingText: "pub fn widen(x: i32) -> i32 { x }\n", generatedTests: bare, markerId: "widen", placement: placementAt("/w") });
  assert.ok(plan.text.includes("fn t_happy"), "the fn head is the test name the rung filters on");
  assert.ok(plan.text.includes("fn t_zero"));
  assert.ok(plan.text.includes("#[cfg(test)]") && plan.text.includes("use super::*;"), "the shipped Rust wrapper");
  assert.deepStrictEqual(rust().generatedTestNames(plan.text, "widen"), ["t_happy", "t_zero"], "and the rung can read them back");
});

test("scaffold passes an ALREADY-WRAPPED module straight through, byte for byte", () => {
  // Every shipped caller hands over what extractTestModule returned, which
  // always carries the wrapper. That path must not change.
  const existingText = "pub fn f(x: i32) -> i32 { x }\n";
  for (const wrapped of [
    "mod tests {\n    #[test]\n    fn t() { assert_eq!(f(1), 2); }\n}",
    "#[cfg(test)]\nmod tests {\n    use super::*;\n    #[test]\n    fn t() { assert_eq!(f(1), 2); }\n}",
  ]) {
    assert.deepStrictEqual(
      rust().scaffold({ existingText, generatedTests: wrapped, markerId: "f", placement: placementAt("/w") }),
      planTestInsertion(existingText, wrapped, { markerId: "f" }),
      wrapped.slice(0, 20)
    );
  }
});

// ---- 2b. the module detector's PREAMBLE (phase 1 loop 2) -----------------
//
// Migrated from the phase-1 adversarial review. extractTestModule returns the
// WHOLE fenced block and only requires a `mod` somewhere inside it, so a reply
// that opens with a `use` line, a comment or a second attribute still arrives
// here already wrapped. A detector anchored at offset 0 read that preamble as
// "not a module", wrapped it a SECOND time, and produced a doubly nested module
// the shipped planTestInsertion path never produces.

const EXISTING = "pub fn add(a: i32, b: i32) -> i32 { a + b }\n";
const BODY = "    #[test]\n    fn adds() {\n        assert_eq!(add(2, 2), 4);\n    }\n";

const PREAMBLE_SHAPES = {
  "a bare module": `mod tests {\n${BODY}}`,
  "the shape extractTestModule returns today": `#[cfg(test)]\nmod tests {\n    use super::*;\n\n${BODY}}`,
  "behind a use line": `use super::*;\n\n#[cfg(test)]\nmod tests {\n${BODY}}`,
  "behind a line comment": `// tests for add\n#[cfg(test)]\nmod tests {\n${BODY}}`,
  "behind a block comment, nested": `/* tests /* still */ for add */\nmod tests {\n${BODY}}`,
  "carrying a second attribute": `#[cfg(test)]\n#[allow(clippy::all)]\nmod tests {\n${BODY}}`,
  "carrying a multi-line attribute": `#[cfg(\n    test\n)]\nmod tests {\n${BODY}}`,
  "behind an inner attribute": `#![allow(unused)]\nmod tests {\n${BODY}}`,
  "behind several use lines and a comment": `use super::*;\nuse std::fmt;\n// and now the tests\n#[cfg(test)]\nmod tests {\n${BODY}}`,
};

for (const [label, generated] of Object.entries(PREAMBLE_SHAPES)) {
  test(`scaffold: a module ${label} is recognised as one, and the plan is planTestInsertion's own`, () => {
    assert.deepStrictEqual(
      rust().scaffold({ existingText: EXISTING, generatedTests: generated, markerId: "add", placement: placementAt("/w") }),
      planTestInsertion(EXISTING, generated, { markerId: "add" }),
      `the seam wrapped a module that was already one:\n${generated}`
    );
  });

  test(`scaffold: a module ${label} never ends up NESTED inside a second mod tests`, () => {
    const plan = rust().scaffold({ existingText: EXISTING, generatedTests: generated, markerId: "add", placement: placementAt("/w") });
    const modules = (plan.text.match(/\bmod\s+\w+\s*\{/g) ?? []).length;
    assert.strictEqual(modules, 1, `the plan text declares ${modules} modules:\n${plan.text}`);
  });
}

test("scaffold: BARE test functions still get wrapped, which is the whole reason the wrapper exists", () => {
  // The one DELIBERATE divergence from planTestInsertion. Handed bare functions,
  // planTestInsertion reads fns out of a module's brace body, keeps only the
  // first body and drops the `#[test] fn` heads - leaving a bare `assert_eq!` at
  // module level. So the seam normalizes the shape rather than matching the
  // shipped call byte for byte here, and this test names the divergence so a
  // later reader does not "fix" it back.
  const bare = BODY;
  const viaSeam = rust().scaffold({ existingText: EXISTING, generatedTests: bare, markerId: "add", placement: placementAt("/w") });
  const direct = planTestInsertion(EXISTING, bare, { markerId: "add" });

  assert.notDeepStrictEqual(viaSeam, direct, "bare functions are exactly the case the wrapper is for");
  assert.ok(!direct.text.includes("fn adds"), "unwrapped, the shipped planner drops the fn head");
  assert.ok(viaSeam.text.includes("fn adds"), "wrapped, the test name the rung filters on survives");
  assert.strictEqual((viaSeam.text.match(/\bmod\s+\w+\s*\{/g) ?? []).length, 1, "and still exactly one module");
});

test("scaffold: a preamble that is NOT skippable leaves the text looking bare, so it is wrapped", () => {
  // The skipper knows blank lines, comments, attributes and `use` items. A `fn`
  // or a `let` in front of the module is real code, so the scan stops there and
  // the conservative wrap happens - never a silent passthrough of something the
  // detector did not actually understand.
  const generated = `fn helper() -> i32 { 1 }\nmod tests {\n${BODY}}`;
  const plan = rust().scaffold({ existingText: EXISTING, generatedTests: generated, markerId: "add", placement: placementAt("/w") });
  assert.deepStrictEqual(plan, planTestInsertion(EXISTING, `mod tests {\n${generated}\n}`, { markerId: "add" }));
});

test("generatedTestNames routes to the shipped reader, so the rung stays scoped to this function", () => {
  const fileText =
    "#[cfg(test)]\nmod tests {\n    // column80-tests:widen:begin\n" +
    "    #[test]\n    fn t_happy() {}\n    #[test]\n    fn t_zero() {}\n" +
    "    // column80-tests:widen:end\n    #[test]\n    fn developers_own() {}\n}\n";
  assert.deepStrictEqual(rust().generatedTestNames(fileText, "widen"), ["t_happy", "t_zero"]);
  assert.deepStrictEqual(rust().generatedTestNames(fileText, "widen"), generatedTestNames(fileText, "widen"));
  assert.deepStrictEqual(rust().generatedTestNames(fileText, "other"), [], "an unmarked id has no generated tests");
});

test("renderBlankValue routes to the shipped renderer, including the startHole the caller numbers from", () => {
  for (const ty of ["i32", "(u8, u8)", "Vec<u8>", "Option<u32>", "MyStruct"]) {
    assert.deepStrictEqual(rust().renderBlankValue(ty), renderBlankValue(ty), ty);
    assert.deepStrictEqual(rust().renderBlankValue(ty, { startHole: 4 }), renderBlankValue(ty, { startHole: 4 }), `${ty} @4`);
  }
});

// scraps D3, CLOSED in phase 6. The seam's renderBlankValue used to carry
// startHole ONLY, dropping the shipped renderer's rust-analyzer-resolved
// structFields. That was safe exactly while blankTestModule called the shipped
// renderer DIRECTLY; the day a caller routed the blanker through the seam, Rust
// would silently lose its struct scaffold and blind-v8-assembly would stay green
// pinning an orphan. Phase 6 is that day, so these two are live now: the first
// pins the seam member, the second pins the WIRED path the product actually
// takes.
const POINT_FIELDS = [
  { name: "x", typeName: "i32" },
  { name: "y", typeName: "i32" },
];

test("scraps D3: the seam's renderBlankValue carries structFields through to the shipped renderer", () => {
  assert.deepStrictEqual(
    rust().renderBlankValue("Point", { structFields: POINT_FIELDS, startHole: 1 }),
    renderBlankValue("Point", { structFields: POINT_FIELDS, startHole: 1 }),
    "a caller routing through the seam must not lose Rust's struct scaffold"
  );
});

test("scraps D3: the WIRED blanker (blankExpectedValues, the one the command calls) keeps the struct scaffold blind-v8-assembly pins", () => {
  // The exact input blind-v8-assembly pins for the struct branch.
  const moduleText = "assert_eq!(origin_shifted(2, 3), Point { x: 5, y: 8 });";
  const shipped = blankTestModule(moduleText, "Point", { structFields: POINT_FIELDS });
  const lang = rust();
  const wired = blankExpectedValues(lang, lang.frameworks[0], moduleText, "Point", { structFields: POINT_FIELDS });
  assert.strictEqual(wired.snippet, shipped.snippet, "the seam-routed blanker emits the shipped bytes");
  assert.strictEqual(wired.holes, shipped.holes, "and the same hole count");
  assert.ok(wired.snippet.includes("x: "), "sanity: the struct scaffold is really in there");
});

test("the WIRED blanker matches blankTestModule on the ordinary scalar case too, so Rust's bytes are unchanged by the routing", () => {
  const moduleText = "#[cfg(test)]\nmod tests {\n    #[test]\n    fn adds() { assert_eq!(add(2, 2), 4); assert_eq!(add(0, 0), 0); }\n}";
  const lang = rust();
  const shipped = blankTestModule(moduleText, "i32");
  const wired = blankExpectedValues(lang, lang.frameworks[0], moduleText, "i32");
  assert.strictEqual(wired.snippet, shipped.snippet);
  assert.strictEqual(wired.holes, shipped.holes);
  assert.strictEqual(wired.unresolved, 0, "both asserts resolved, so the D5 floor has nothing to refuse");
});

test("scraps D5: the WIRED blanker REPORTS an assert_eq! the locator walked and could not resolve", () => {
  const moduleText = "#[cfg(test)]\nmod tests {\n    #[test]\n    fn adds() { assert_eq!(add(2, 2), 4); assert_eq!(add(0, 0)); }\n}";
  const lang = rust();
  const wired = blankExpectedValues(lang, lang.frameworks[0], moduleText, "i32");
  assert.ok(wired.holes > 0, "the first assert still produces a hole, which is exactly why a holes-only floor is blind here");
  assert.strictEqual(wired.unresolved, 1, "and the second is reported, so the consumer refuses the whole pass");
});

test("scraps D4: tddLanguageIds is the ONE written-down id set, and every id in it resolves", () => {
  const ids = tddLanguageIds();
  assert.ok(ids.includes("rust"), "rust is in the set");
  assert.deepStrictEqual([...new Set(ids)], ids, "no id appears twice");
  for (const id of ids) {
    assert.ok(tddLangFor(id) !== undefined, `tddLanguageIds names ${id}, so tddLangFor must resolve it`);
  }
});

test("markerPrefix is `//`, the one marker format scaffold and generatedTestNames share", () => {
  const lang = rust();
  assert.strictEqual(lang.markerPrefix, "//");
  const plan = lang.scaffold({ existingText: "fn f() {}\n", generatedTests: "mod tests {\n    #[test]\n    fn t() {}\n}", markerId: "f", placement: placementAt("/w") });
  assert.ok(plan.text.includes(`${lang.markerPrefix} column80-tests:f:begin`), "the marker the reader looks for");
});

test("testNameIsValid is ABSENT for Rust: libtest constrains nothing, and absent means no constraint", () => {
  assert.strictEqual(rust().testNameIsValid, undefined, "an optional method's absence is the honest answer, not a true-returning stub");
});

// ---- 3. placement --------------------------------------------------------

test("placementFor puts Rust tests in the SOURCE file and runs from the crate root", () => {
  const res = rust().placementFor("/w/src/lib.rs", "widen", crateDeps(CRATE));
  assert.strictEqual(res.ok, true);
  assert.deepStrictEqual(res.placement, {
    targetPath: "/w/src/lib.rs",
    exists: true,
    mode: "same-file",
    runRoot: "/w",
  });
  assert.strictEqual(res.placement.packageArg, undefined, "cargo scopes by cwd, so there is no package argument");
  assert.strictEqual(res.placement.importLine, undefined, "`use super::*` is the scaffold's own line, not an import to resolve");
});

test("placementFor's runRoot is the NEAREST Cargo.toml, matching the check rung's crate resolution", () => {
  const deps = crateDeps(["/w/Cargo.toml", "/w/member/Cargo.toml", "/w/member/src/lib.rs"]);
  const res = rust().placementFor("/w/member/src/lib.rs", "widen", deps);
  assert.strictEqual(res.placement.runRoot, "/w/member", "a workspace scopes to the touched member");
  assert.strictEqual(
    res.placement.runRoot,
    new RustOracle({ fileExists: deps.fileExists }).detectCrateRoot("/w/member/src/lib.rs"),
    "the same resolution the check uses, not a second one"
  );
});

test("placementFor REFUSES outside any crate, and the detail names Cargo.toml", () => {
  const res = rust().placementFor("/elsewhere/src/lib.rs", "widen", crateDeps([]));
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.refusal.reason, "no-project-root");
  assert.match(res.refusal.detail, /Cargo\.toml/, "the refusal must name what is missing");
});

test("placementFor reports exists=false for a source file the deps say is absent", () => {
  const res = rust().placementFor("/w/src/new.rs", "widen", crateDeps(["/w/Cargo.toml"]));
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.placement.exists, false);
});

// ---- 4. the framework: the byte-identical cargo command ------------------

test("Rust lists exactly one framework, libtest", () => {
  const fws = rust().frameworks;
  assert.strictEqual(fws.length, 1);
  assert.strictEqual(fws[0].id, "libtest");
  assert.ok(fws[0].displayName.length > 0, "the name the honest-dark message prints");
});

test("libtest.buildCommand is BYTE-IDENTICAL to the shipped buildTestCommand", () => {
  const names = ["tests::t_happy", "tests::t_zero"];
  const cmd = rust().frameworks[0].buildCommand(placementAt("/w"), names);
  assert.deepStrictEqual(cmd, { command: "cargo", args: ["test", "--lib", "tests::t_happy", "tests::t_zero"], cwd: "/w" });
  assert.deepStrictEqual(cmd, buildTestCommand("/w", names), "the seam adds nothing and drops nothing");
});

test("libtest.buildCommand with NO test names is still `cargo test --lib`, no empty argument", () => {
  assert.deepStrictEqual(rust().frameworks[0].buildCommand(placementAt("/w"), []), {
    command: "cargo",
    args: ["test", "--lib"],
    cwd: "/w",
  });
});

test("libtest.buildCommand runs from the placement's runRoot, not the target file's directory", () => {
  assert.strictEqual(rust().frameworks[0].buildCommand(placementAt("/other"), ["t"]).cwd, "/other");
});

test("libtest.detect fires on a Cargo.toml at the root and is dark without one", () => {
  const fw = rust().frameworks[0];
  assert.strictEqual(fw.detect("/w", crateDeps(CRATE)), true);
  assert.strictEqual(fw.detect("/w", crateDeps([])), false, "no manifest, no rung");
  assert.strictEqual(fw.detect("/w", crateDeps(["/w/src/lib.rs"])), false, "a source file is not a manifest");
});

// ---- 5. the parse superset ----------------------------------------------

const LIBTEST_MIXED = [
  "",
  "running 3 tests",
  "test tests::t_happy ... ok",
  "test tests::t_zero ... FAILED",
  "test tests::t_skip ... ignored",
  "",
  "failures:",
  "",
  "---- tests::t_zero stdout ----",
  "assertion `left == right` failed",
  "  left: 6",
  " right: 7",
  "",
  "failures:",
  "    tests::t_zero",
  "",
  "test result: FAILED. 1 passed; 1 failed; 1 ignored; 0 measured; 0 filtered out; finished in 0.00s",
  "",
].join("\n");

test("libtest.parseOutput carries EVERY LibtestParse field through unchanged", () => {
  const shipped = parseLibtestOutput(LIBTEST_MIXED);
  const seam = rust().frameworks[0].parseOutput(LIBTEST_MIXED, "", 101);
  for (const field of ["ran", "passed", "failed", "ignored"]) {
    assert.deepStrictEqual(seam[field], shipped[field], field);
  }
  assert.deepStrictEqual(seam.cases, shipped.cases, "the per-case list, name for name");
  assert.deepStrictEqual(seam.failures, shipped.failures, "the assertion text, which is the deliverable");
  assert.strictEqual(seam.passed, 1);
  assert.strictEqual(seam.failed, 1);
  assert.strictEqual(seam.ignored, 1);
});

test("libtest.parseOutput sets casesComplete: libtest names passing tests too", () => {
  const seam = rust().frameworks[0].parseOutput(LIBTEST_MIXED, "", 101);
  assert.strictEqual(seam.casesComplete, true);
  assert.strictEqual(seam.cases.filter((c) => c.outcome === "pass").length, 1, "and the passing case really is enumerated");
});

test("libtest.parseOutput leaves filterMatchedNothing UNDEFINED: Rust has no positive filter-miss tell", () => {
  const zeroMatch = "\nrunning 0 tests\n\ntest result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 1 filtered out; finished in 0.00s\n";
  const seam = rust().frameworks[0].parseOutput(zeroMatch, "", 0);
  assert.strictEqual(seam.filterMatchedNothing, undefined, "a measured absence, not an omission - the executed>0 guard catches it");
  assert.strictEqual(seam.passed + seam.failed, 0, "which is exactly what that guard reads");
});

test("libtest.parseOutput leaves environmentError undefined: cargo not starting is a build error, not a runtime miss", () => {
  const seam = rust().frameworks[0].parseOutput("", "error[E0425]: cannot find value `x`", 101);
  assert.strictEqual(seam.environmentError, undefined);
  assert.strictEqual(seam.ran, false, "no libtest lines means the binary never ran; buildError is the rung's job");
});

test("libtest.parseOutput ignores stderr and the exit code, because parseLibtestOutput only ever read stdout", () => {
  const a = rust().frameworks[0].parseOutput(LIBTEST_MIXED, "", 0);
  const b = rust().frameworks[0].parseOutput(LIBTEST_MIXED, "noisy stderr", 101);
  assert.deepStrictEqual(a, b, "same stdout, same parse - the verdict is the rung's, not the parser's");
});

// ---- 6. frameworkFor: hit and miss --------------------------------------

test("frameworkFor returns the FIRST framework whose detect fires", () => {
  const res = frameworkFor(rust(), "/w", crateDeps(CRATE));
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.framework.id, "libtest");
});

test("frameworkFor's miss names EVERY framework that was looked for, never a guess", () => {
  const res = frameworkFor(rust(), "/w", crateDeps([]));
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.framework, undefined, "a miss carries no framework to fall back on");
  assert.deepStrictEqual(res.lookedFor, rust().frameworks.map((f) => f.displayName));
  assert.ok(res.lookedFor.length > 0, "an empty list would be a silent refusal");
});

test("frameworkFor honours precedence order: the first detect that fires wins over a later one", () => {
  const fw = (id, fires) => ({
    id,
    displayName: id,
    detect: () => fires,
    buildCommand: () => ({ command: id, args: [], cwd: "/" }),
    parseOutput: () => ({ ran: false, cases: [], failures: [], passed: 0, failed: 0, ignored: 0, casesComplete: true }),
    assertionInstruction: "",
    expectedValueSpans: () => [],
  });
  const twoLang = { ...rust(), frameworks: [fw("first", true), fw("second", true)] };
  assert.strictEqual(frameworkFor(twoLang, "/w", {}).framework.id, "first");
  const skipFirst = { ...rust(), frameworks: [fw("first", false), fw("second", true)] };
  assert.strictEqual(frameworkFor(skipFirst, "/w", {}).framework.id, "second");
});

test("frameworkFor writes its evidence to the injected log, on the hit and on the miss", () => {
  const hit = [];
  frameworkFor(rust(), "/w", { fileExists: (p) => p === "/w/Cargo.toml", log: (l) => hit.push(l) });
  assert.strictEqual(hit.length, 1);
  assert.match(hit[0], /libtest/);

  const miss = [];
  frameworkFor(rust(), "/w", { fileExists: () => false, log: (l) => miss.push(l) });
  assert.strictEqual(miss.length, 1);
  assert.match(miss[0], /cargo test/, "the miss line names what was looked for, like the returned list");
});

test("frameworkFor needs no deps at all: an empty deps object falls back to real fs and does not throw", () => {
  const res = frameworkFor(rust(), "/definitely/not/a/crate/here", {});
  assert.strictEqual(res.ok, false, "no Cargo.toml on disk at that path");
});

// ---- 7. the moved returnTypeOf ------------------------------------------

test("returnTypeOf reads the type after `->`, terminated by a body brace or a where clause", () => {
  const lang = rust();
  assert.strictEqual(lang.returnTypeOf("fn f(x: i32) -> u64"), "u64");
  assert.strictEqual(lang.returnTypeOf("pub fn f(x: i32) -> u64 {"), "u64");
  assert.strictEqual(lang.returnTypeOf("fn f() -> Vec<u8> {"), "Vec<u8>");
  assert.strictEqual(lang.returnTypeOf("fn f<T>(x: T) -> Vec<T> where T: Clone"), "Vec<T>");
  assert.strictEqual(lang.returnTypeOf("fn f() -> Result<Vec<u8>, Error> {"), "Result<Vec<u8>, Error>");
});

test("returnTypeOf answers undefined when the signature has no arrow at all", () => {
  const lang = rust();
  assert.strictEqual(lang.returnTypeOf("fn f(x: i32)"), undefined);
  assert.strictEqual(lang.returnTypeOf("pub fn f()"), undefined);
  assert.strictEqual(lang.returnTypeOf(""), undefined);
});

test("the seam's returnTypeOf IS the moved function, not a second copy", () => {
  assert.strictEqual(rust().returnTypeOf, rustReturnTypeOf, "one implementation, so the two cannot drift");
});

test("the moved returnTypeOf matches the shipped fnGen one on every input EXCEPT the ratified unit-return supersession", () => {
  // The pin: the regex that shipped, re-run here. Anything the seam answers
  // differently from this is a supersession wearing a refactor's clothes, and
  // has to be a deliberate, recorded act rather than a refactor side effect.
  const shipped = (signature) => {
    const m = /->\s*([\s\S]+?)\s*(?:\bwhere\b|\{|$)/.exec(signature);
    const t = m?.[1]?.trim();
    return t && t.length > 0 ? t : undefined;
  };
  const sigs = [
    "fn f(x: i32) -> u64",
    "pub fn f(x: i32) -> u64 {",
    "fn f<T>(x: T) -> Vec<T> where T: Clone {",
    "fn f(x: i32)",
    "fn f() -> &'a str",
    "async fn f() -> impl Future<Output = u8>",
    "",
  ];
  for (const sig of sigs) {
    assert.strictEqual(rustReturnTypeOf(sig), shipped(sig), sig);
  }
});

test("SUPERSESSION S1: the explicit unit return `-> ()` yields undefined, where the shipped regex yielded the string '()'", () => {
  // Human-ratified 2026-07-27, recorded in docs/supersessions.md as S1. The
  // shipped doc comment always claimed undefined; the code never did it, and
  // the disagreement was unreachable because classifyTestability refuses a unit
  // return as `underspecified` first. Both halves are asserted here so the
  // change stays visible as a decision rather than fading into the regex.
  const shippedUnit = /->\s*([\s\S]+?)\s*(?:\bwhere\b|\{|$)/.exec("fn f() -> ()")?.[1]?.trim();
  assert.strictEqual(shippedUnit, "()", "what the shipped regex answered, kept here as the before-picture");
  for (const sig of ["fn f() -> ()", "fn f() -> ( )", "pub fn f(x: u8) -> () {"]) {
    assert.strictEqual(rustReturnTypeOf(sig), undefined, `a unit return is nothing to assert on: ${sig}`);
  }
  // The supersession is narrow. A unit INSIDE a larger type is still a return.
  assert.strictEqual(rustReturnTypeOf("fn f() -> Result<(), Error>"), "Result<(), Error>");
  assert.strictEqual(rustReturnTypeOf("fn f() -> ((), u8)"), "((), u8)");
});

// ---- 8. expectedValueSpans: the safety-critical one ---------------------

test("libtest.expectedValueSpans marks the SECOND argument, which is the expected value", () => {
  const text = "assert_eq!(widen(3), 7);";
  const spans = rust().frameworks[0].expectedValueSpans(text);
  assert.strictEqual(spans.length, 1);
  assert.strictEqual(text.slice(spans[0].start, spans[0].end), "7", "the human's value, never the call under test");
  assert.notStrictEqual(text.slice(spans[0].start, spans[0].end), "widen(3)");
});

test("libtest.expectedValueSpans is the same scanner blankTestModule blanks with", () => {
  const module = "mod tests {\n    #[test]\n    fn t() {\n        assert_eq!(widen(3), 7);\n        assert_ne!(widen(0), 1);\n    }\n}";
  assert.deepStrictEqual(rust().frameworks[0].expectedValueSpans(module), rustExpectedValueSpans(module));
  const blanked = blankTestModule(module, "i32");
  assert.ok(blanked.snippet.includes("widen(3)"), "the call under test survives");
  assert.ok(!blanked.snippet.includes(", 7)"), "the model's guessed value does not");
  assert.strictEqual(blanked.holes, 2, "one hole per assert");
});

test("libtest.expectedValueSpans skips a macro name inside a string or a comment", () => {
  const text = '// assert_eq!(a, b)\nlet s = "assert_eq!(c, d)";\nassert_eq!(f(1), 2);';
  const spans = rust().frameworks[0].expectedValueSpans(text);
  assert.strictEqual(spans.length, 1, "only the real macro call");
  assert.strictEqual(text.slice(spans[0].start, spans[0].end), "2");
});

// ---- 9. the deliberate runTestOracle refactor ---------------------------

const oracleWithRoot = (root) => new RustOracle({ fileExists: (p) => p === `${root}/Cargo.toml` });
const runner = (stdout, stderr, exitCode) => async (cmd) => {
  runner.last = cmd;
  return { stdout, stderr, exitCode };
};

test("runTestOracle keeps its shipped file-path signature and its shipped result", async () => {
  const res = await runTestOracle(oracleWithRoot("/w"), "/w/src/lib.rs", ["tests::a", "tests::b"], {
    runCommand: runner(LIBTEST_MIXED, "", 101),
  });
  assert.deepStrictEqual(runner.last, { command: "cargo", args: ["test", "--lib", "tests::a", "tests::b"], cwd: "/w" });
  assert.strictEqual(res.crateRoot, "/w");
  assert.strictEqual(res.ran, true);
  assert.strictEqual(res.success, false, "a failing test is a red, not a crash");
  assert.strictEqual(res.passed, 1);
  assert.strictEqual(res.failed, 1);
});

test("runTestOracleAt on the SAME root gives the same result: two entry points, one body", async () => {
  const opts = () => ({ runCommand: runner(LIBTEST_MIXED, "", 101) });
  const viaPath = await runTestOracle(oracleWithRoot("/w"), "/w/src/lib.rs", ["tests::a"], opts());
  const viaPlacement = await runTestOracleAt(oracleWithRoot("/w"), { runRoot: "/w" }, ["tests::a"], opts());
  const strip = (r) => ({ ...r, durationMs: 0 });
  assert.deepStrictEqual(strip(viaPlacement), strip(viaPath));
});

test("runTestOracleAt runs from the root it is GIVEN, which is the reason the refactor exists", async () => {
  // The rung's root is not the check's root: C# runs from the peer test project.
  // The placement-taking path must never re-derive the root from a source file.
  await runTestOracleAt(oracleWithRoot("/w"), { runRoot: "/w/Peer.Tests" }, ["t"], {
    runCommand: runner(LIBTEST_MIXED, "", 101),
  });
  assert.strictEqual(runner.last.cwd, "/w/Peer.Tests", "no Cargo.toml there, and it is still where the command runs");
});

test("runTestOracleAt passes a packageArg to the builder, which cargo ignores and Go will not", async () => {
  const res = await runTestOracleAt(oracleWithRoot("/w"), { runRoot: "/w", packageArg: "./internal/foo" }, ["t"], {
    runCommand: runner(LIBTEST_MIXED, "", 101),
  });
  assert.deepStrictEqual(runner.last.args, ["test", "--lib", "t"], "cargo scopes by cwd, so the Rust command is untouched");
  assert.strictEqual(res.crateRoot, "/w");
});

test("the options object a strategy's buildTestCommand sees now carries packageArg, and it is inert for Rust", async () => {
  // Found by the phase-1 review and recorded rather than reverted. The
  // runTestOracleAt refactor added `packageArg` to the TestCommandOptions every
  // strategy is handed, so a strategy that deep-compares its opts sees an extra
  // own key whose value is undefined. cargo's builder ignores it and the command
  // is byte-identical, which is what blind-v8-testrung pins. Pinned here so the
  // shape is a decision on the record, not a drift nobody noticed.
  const seen = [];
  const oracle = {
    language: "rust",
    appliesTo: () => true,
    detectCrateRoot: () => "/w",
    buildCheckCommand: () => ({ command: "x", args: [], cwd: "/w" }),
    parseCheckOutput: () => [],
    checkSuccess: () => true,
    resolveDiagnosticPath: (p) => p,
    isAssertionShaped: () => false,
    buildTestCommand: (root, filter, opts) => {
      seen.push(opts);
      return buildTestCommand(root, filter, opts);
    },
    parseTestOutput: parseLibtestOutput,
  };
  await runTestOracle(oracle, "/w/src/lib.rs", ["tests::a"], { runCommand: runner(LIBTEST_MIXED, "", 101) });
  assert.deepStrictEqual(seen, [{ noRun: undefined, packageArg: undefined }]);
  assert.deepStrictEqual(runner.last, { command: "cargo", args: ["test", "--lib", "tests::a"], cwd: "/w" }, "and the command is unchanged");
});

test("the executed>0 green guard survives the refactor on BOTH entry points", async () => {
  const zeroMatch = "\nrunning 0 tests\n\ntest result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 1 filtered out; finished in 0.00s\n";
  const viaPath = await runTestOracle(oracleWithRoot("/w"), "/w/src/lib.rs", "tests::nope", { runCommand: runner(zeroMatch, "", 0) });
  const viaPlacement = await runTestOracleAt(oracleWithRoot("/w"), { runRoot: "/w" }, "tests::nope", { runCommand: runner(zeroMatch, "", 0) });
  assert.strictEqual(viaPath.success, false, "nothing executed is not a green");
  assert.strictEqual(viaPlacement.success, false, "and the new path must not be the one that forgets");
});

test("runTestOracleAt skips honestly when the oracle has no test rung, exactly as runTestOracle does", async () => {
  const noRung = { ...oracleWithRoot("/w"), language: "rust", buildTestCommand: undefined, parseTestOutput: undefined };
  const lines = [];
  const res = await runTestOracleAt(noRung, { runRoot: "/w" }, "t", { log: (l) => lines.push(l), runCommand: runner("", "", 0) });
  assert.strictEqual(res, undefined, "no rung is undefined, never a guessed command");
  assert.match(lines.join("\n"), /no test rung/);
});

test("runTestOracle still refuses a file outside any crate before it reaches the placement path", async () => {
  const lines = [];
  const res = await runTestOracle(oracleWithRoot("/w"), "/elsewhere/src/lib.rs", "t", {
    log: (l) => lines.push(l),
    runCommand: runner("", "", 0),
  });
  assert.strictEqual(res, undefined);
  assert.match(lines.join("\n"), /no crate root/);
});

// ---- 10. the seam feeds the rung ----------------------------------------

test("a TestPlacement is structurally what runTestOracleAt takes, so the seam feeds the rung directly", async () => {
  const placement = rust().placementFor("/w/src/lib.rs", "widen", crateDeps(CRATE)).placement;
  const res = await runTestOracleAt(oracleWithRoot("/w"), placement, ["tests::a"], {
    runCommand: runner(LIBTEST_MIXED, "", 101),
  });
  assert.strictEqual(runner.last.cwd, "/w");
  assert.strictEqual(res.crateRoot, "/w");
});

// ===========================================================================
// scraps D8: the report file lifecycle, the half phase 4 left open.
//
// pytest's `--junit-xml` and C#'s `--logger trx` write their report to a temp
// PATH. Phase 4 made the spawner DELETE that path before the process starts, so
// a stale report is never read as a live one. Nothing cleaned it up AFTER, and
// the path is per TARGET FILE, so reports accumulated without bound in the
// number of files a human ran the gesture on.
//
// This is a SEAM-level test on purpose: the temp path is not visible to a VS
// Code drive, so the black-box oracle cannot see it. It goes through
// runFrameworkTestsAt, which is the entry point the command calls, with an
// injected runner that writes the report the real process would have written.
// ===========================================================================

const fs = require("fs");
const os = require("os");
const nodePath = require("path");

const reportFramework = (reportPath, body) => ({
  id: "fake-report-framework",
  buildCommand: (placement, testNames) => ({
    command: "true",
    args: testNames,
    cwd: placement.runRoot,
    outputFile: reportPath,
  }),
  parseOutput: () => body,
});

const PARSE_GREEN = { ran: true, cases: [], failures: [], passed: 1, failed: 0, ignored: 0, casesComplete: true };
const PARSE_NO_RUN = { ran: false, cases: [], failures: [], passed: 0, failed: 0, ignored: 0, casesComplete: true };

test("scraps D8: the report file is DELETED after the run, so reports stop accumulating in the temp directory", async () => {
  const dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), "impl-v31-d8-"));
  const reportPath = nodePath.join(dir, "report.xml");
  const res = await runFrameworkTestsAt(
    reportFramework(reportPath, PARSE_GREEN),
    { runRoot: dir },
    ["one"],
    {
      runCommand: async () => {
        // What the real process does: write the report, then exit.
        fs.writeFileSync(reportPath, "<testsuite/>");
        return { stdout: "", stderr: "", exitCode: 0 };
      },
    }
  );
  assert.strictEqual(res.ran, true, "sanity: the parse read the report");
  assert.strictEqual(fs.existsSync(reportPath), false, "the report is gone after the run");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("scraps D8: the report is deleted AFTER the parse reads it, never before - the verdict still comes from the file", async () => {
  const dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), "impl-v31-d8-"));
  const reportPath = nodePath.join(dir, "report.xml");
  let seen;
  const framework = {
    id: "fake-report-framework",
    buildCommand: (placement) => ({ command: "true", args: [], cwd: placement.runRoot, outputFile: reportPath }),
    parseOutput: (stdout) => {
      seen = stdout;
      return PARSE_GREEN;
    },
  };
  await runFrameworkTestsAt(framework, { runRoot: dir }, ["one"], {
    runCommand: async () => {
      fs.writeFileSync(reportPath, "<testsuite name='real'/>");
      return { stdout: "console noise", stderr: "", exitCode: 0 };
    },
  });
  assert.strictEqual(seen, "<testsuite name='real'/>", "the parse was handed the report's CONTENT, not the console");
  assert.strictEqual(fs.existsSync(reportPath), false, "and the file is gone once it has been read");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("scraps D8: a run that writes NO report cleans up nothing and still reports honestly", async () => {
  const dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), "impl-v31-d8-"));
  const reportPath = nodePath.join(dir, "report.xml");
  const res = await runFrameworkTestsAt(
    reportFramework(reportPath, PARSE_NO_RUN),
    { runRoot: dir },
    ["one"],
    { runCommand: async () => ({ stdout: "", stderr: "boom", exitCode: 1 }) }
  );
  assert.strictEqual(res.ran, false);
  assert.strictEqual(res.success, false);
  assert.strictEqual(fs.existsSync(reportPath), false, "nothing was written and nothing is left behind");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("scraps D6/phase 6: a no-run the parse could not classify carries BOTH streams, so the consumer can say what the runner said", async () => {
  const res = await runFrameworkTestsAt(
    { id: "fake", buildCommand: (p) => ({ command: "true", args: [], cwd: p.runRoot }), parseOutput: () => PARSE_NO_RUN },
    { runRoot: "/w" },
    ["one"],
    { runCommand: async () => ({ stdout: "OUT", stderr: "ERR", exitCode: 3 }) }
  );
  assert.strictEqual(res.ran, false);
  assert.strictEqual(res.stdout, "OUT", "what it said on stdout");
  assert.strictEqual(res.stderr, "ERR", "and on stderr - a leg reading one stream reports a failure with no message");
});

test("scraps D6/phase 6: a parse that DID name a build error carries no raw streams, so the compile sentence stays the compile sentence", async () => {
  const res = await runFrameworkTestsAt(
    {
      id: "fake",
      buildCommand: (p) => ({ command: "true", args: [], cwd: p.runRoot }),
      parseOutput: () => ({ ...PARSE_NO_RUN, buildError: "./x.go:9: undefined: nope" }),
    },
    { runRoot: "/w" },
    ["one"],
    { runCommand: async () => ({ stdout: "OUT", stderr: "", exitCode: 1 }) }
  );
  assert.strictEqual(res.buildError, "./x.go:9: undefined: nope");
  assert.strictEqual(res.stdout, undefined, "a classified run needs no raw streams");
});
