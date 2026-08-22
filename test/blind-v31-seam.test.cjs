// Blind oracle: the TDD language seam (docs/architecture/tdd-language-seam.md,
// "The seam"; goal item 1). Black-box contract tests written from the CONTRACT
// ALONE, before the implementation exists. Covers:
//   §tddLangFor      one construction point, undefined for an unregistered lang
//   §TddLang         the Rust adapter's shape and its delegating members
//   §PlacementResult same-file placement, and the no-project-root refusal
//   §frameworkFor    first detect wins; refusal names every framework tried
//   §TestFramework   libtest buildCommand (BYTE-FROZEN) and parseOutput
//   §TestRunParse    casesComplete is always present, so no consumer assumes
//                    `cases` is the whole run
//
// Never read src/**. The whole point of this file is independence from the
// implementation, which does not exist yet. Expected RED: `src/core/tddLang.ts`
// is absent, so the bundle itself fails. The try/catch below keeps that red
// informative: ONE failing bundle test, every other test skips.
//
// Phase 1 registers Rust only. Go, TypeScript, Python and C# land in phases 2
// to 5, and the test that pins their absence says so in its name so a later red
// is explicable rather than mysterious.
//
// Run: SKIP_LIVE=1 node --test test/blind-v31-seam.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { bundleCore } = require("./.blind-util.cjs");

let mod = {};
let cleanup = () => {};
let bundleError;
try {
  ({ mod, cleanup } = bundleCore(
    "blind-v31-seam",
    `export { tddLangFor, frameworkFor } from "../src/core/tddLang";\n`
  ));
} catch (e) {
  bundleError = e;
}
// A FAILED bundle never returns a cleanup, and it still wrote the entry file.
// Sweep both paths so a red run leaves nothing behind in the tree.
test.after(() => {
  cleanup();
  for (const leftover of [".blind-v31-seam.entry.ts", ".blind-v31-seam.bundle.cjs"]) {
    fs.rmSync(path.join(__dirname, leftover), { force: true });
  }
});

const { tddLangFor, frameworkFor } = mod;

test("bundle: the v31 seam surface builds and exports tddLangFor + frameworkFor [contract-seam.md 'New file: src/core/tddLang.ts']", () => {
  if (bundleError) {
    assert.fail(
      `bundle failed to build - the seam is not implemented yet: ${bundleError.message}`
    );
  }
  assert.strictEqual(typeof tddLangFor, "function", "tddLangFor is the one construction point");
  assert.strictEqual(typeof frameworkFor, "function", "frameworkFor resolves the rung");
});

// Every other test skips (not fails) while the bundle is broken, so the red run
// stays one loud failure instead of a wall of TypeErrors.
const gtest = (name, fn) =>
  test(name, (ctx) => {
    if (bundleError) return ctx.skip("bundle failed to build; see the bundle test");
    return fn(ctx);
  });

// ---------------------------------------------------------------------------
// Shared fixtures. No real crate on disk: deps.fileExists is always injected.
// ---------------------------------------------------------------------------

const CRATE = "/w/crate";
const SRC = "/w/crate/src/task1.rs";
const ORPHAN = "/nowhere/loose.rs";

// A virtual filesystem: true only for the exact paths listed.
const existsIn = (paths) => ({ fileExists: (p) => paths.includes(p) });
// The ordinary Rust case: a manifest at the crate root, and the source file.
const RUST_DEPS = existsIn([path.join(CRATE, "Cargo.toml"), SRC]);
// Nothing exists anywhere: no crate can be found.
const NO_CRATE_DEPS = { fileExists: () => false };

const rustLang = () => tddLangFor("rust");

// A duck-typed placement, so the BYTE-FROZEN command pins depend on nothing but
// buildCommand itself. Shape per contract-seam.md TestPlacement.
const rustPlacement = (over = {}) => ({
  targetPath: SRC,
  exists: true,
  mode: "same-file",
  runRoot: CRATE,
  packageArg: undefined,
  importLine: undefined,
  ...over,
});

const libtest = () => {
  const lang = rustLang();
  assert.ok(lang, "tddLangFor('rust') resolved");
  return lang.frameworks[0];
};

// ---------------------------------------------------------------------------
// Libtest fixture text. Written here from libtest's emitted shape (the stable
// human format: a `running N tests` header, one `test <name> ... <outcome>`
// line per case, `---- <name> stdout ----` detail blocks, and an authoritative
// `test result:` summary). Not copied from any implementation.
// ---------------------------------------------------------------------------

// 1 pass, 1 fail, 1 ignored. cargo exits 101.
const LIBTEST_MIXED =
  "\n" +
  "running 3 tests\n" +
  "test tests::skipped ... ignored\n" +
  "test tests::adds ... ok\n" +
  "test tests::adds_wrong ... FAILED\n" +
  "\n" +
  "failures:\n" +
  "\n" +
  "---- tests::adds_wrong stdout ----\n" +
  "\n" +
  "thread 'tests::adds_wrong' (2799973) panicked at src/lib.rs:14:9:\n" +
  "assertion `left == right` failed\n" +
  "  left: 4\n" +
  " right: 5\n" +
  "note: run with `RUST_BACKTRACE=1` environment variable to display a backtrace\n" +
  "\n" +
  "\n" +
  "failures:\n" +
  "    tests::adds_wrong\n" +
  "\n" +
  "test result: FAILED. 1 passed; 1 failed; 1 ignored; 0 measured; 0 filtered out; finished in 0.00s\n";

// 2 passing tests, nothing else. cargo exits 0.
const LIBTEST_PASS2 =
  "\n" +
  "running 2 tests\n" +
  "test tests::a ... ok\n" +
  "test tests::b ... ok\n" +
  "\n" +
  "test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s\n";

// A filter that selected nothing. Rust has NO positive tell for this: it looks
// exactly like a run with no tests. Only the executed>0 guard catches it.
const LIBTEST_ZERO =
  "\n" +
  "running 0 tests\n" +
  "\n" +
  "test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s\n";

// ===========================================================================
// 1. tddLangFor: the one construction point.
//    [contract-seam.md 'The one construction point. undefined means the gesture
//     refuses by naming the language, exactly as oracleFor does for the check.']
// ===========================================================================

gtest("tddLangFor('rust') resolves a TddLang [contract-seam.md 'What phase 1 registers: Only Rust']", () => {
  const lang = tddLangFor("rust");
  assert.ok(lang, "rust is registered in phase 1");
  assert.strictEqual(typeof lang, "object", "a TddLang is an object of members, not a factory");
});

// This row was written at phase 1 to flip four times, and it has flipped four
// times: go in phase 2, the TypeScript family in phase 3, python in phase 4,
// csharp in phase 5. All five legs are registered, so it promises no further
// flips. From here it is an ordinary pin: a red means a language STOPPED
// resolving, which is a regression and nothing else.
gtest("tddLangFor: ALL FIVE legs resolve - rust, go, the TypeScript family, python, csharp [contract-seam.md 'Go, TypeScript, Python and C# are phases 2 to 5'; goal.md 'all four languages, one goal']", () => {
  const registered = [
    ["rust", "phase 1"],
    ["go", "phase 2"],
    ["typescript", "phase 3"],
    ["typescriptreact", "phase 3"],
    ["javascript", "phase 3"],
    ["javascriptreact", "phase 3"],
    ["python", "phase 4"],
    ["csharp", "phase 5"],
  ];
  for (const [id, phase] of registered) {
    assert.ok(tddLangFor(id), `${id} registered in ${phase}; a red here is a leg that STOPPED resolving`);
  }
});

gtest("tddLangFor: a genuinely unknown language stays undefined FOREVER [contract-seam.md 'undefined for an unregistered language']", () => {
  for (const id of ["cobol", "", "rustlang", "RUST-not-an-id"]) {
    assert.strictEqual(
      tddLangFor(id),
      undefined,
      `${JSON.stringify(id)} is not a registered languageId and never becomes one`
    );
  }
});

// ===========================================================================
// 2. The Rust TddLang's shape.
// ===========================================================================

gtest("rust TddLang: languageId 'rust', a non-empty displayName [contract-seam.md 'readonly languageId'; 'Named in every refusal']", () => {
  const lang = rustLang();
  assert.strictEqual(lang.languageId, "rust", "the languageId round-trips the lookup key");
  assert.strictEqual(typeof lang.displayName, "string", "displayName is a string");
  assert.ok(lang.displayName.length > 0, "displayName is non-empty: every refusal names the language");
});

gtest("rust TddLang: markerPrefix is '//' - one source of the marker format so scaffold and generatedTestNames cannot drift [contract-seam.md 'markerPrefix | \"//\"']", () => {
  assert.strictEqual(rustLang().markerPrefix, "//", "Rust comments the marker with //");
});

gtest("rust TddLang: frameworks is a non-empty precedence list whose first entry is libtest [contract-seam.md 'frameworks | one entry, libtest'; 'Frameworks in PRECEDENCE order']", () => {
  const lang = rustLang();
  assert.ok(Array.isArray(lang.frameworks), "frameworks is an array, in precedence order");
  assert.ok(lang.frameworks.length > 0, "a language with no framework could never run a rung");
  assert.strictEqual(lang.frameworks[0].id, "libtest", "libtest is Rust's first (and phase-1 only) framework");
  assert.strictEqual(typeof lang.frameworks[0].displayName, "string", "displayName carries the honest-dark name");
  assert.strictEqual(typeof lang.frameworks[0].detect, "function", "detect is per framework");
  assert.strictEqual(typeof lang.frameworks[0].buildCommand, "function", "buildCommand is per framework");
  assert.strictEqual(typeof lang.frameworks[0].parseOutput, "function", "parseOutput is per framework");
});

// ===========================================================================
// 3. placementFor: Rust puts tests in the source file itself.
// ===========================================================================

gtest("placementFor rust: mode 'same-file', targetPath IS the source file, runRoot the crate root [contract-seam.md 'placementFor | RustOracle.detectCrateRoot, mode same-file, targetPath = the source file']", () => {
  const res = rustLang().placementFor(SRC, "adds", RUST_DEPS);
  assert.strictEqual(res.ok, true, "a file inside a crate places without refusing");
  const p = res.placement;
  assert.strictEqual(p.mode, "same-file", "Rust's #[cfg(test)] mod sits in the module under test");
  assert.strictEqual(p.targetPath, SRC, "the target file IS the source file, not a sibling");
  assert.strictEqual(p.runRoot, CRATE, "cargo runs from the crate root");
  assert.strictEqual(p.exists, true, "the source file exists, so the target exists");
});

gtest("placementFor rust: importLine is undefined - `use super::*` reaches private items, there is nothing to import [contract-seam.md 'undefined for same-file and same-package placement (Rust, Go)']", () => {
  const res = rustLang().placementFor(SRC, "adds", RUST_DEPS);
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.placement.importLine, undefined, "no import line for same-file placement");
});

gtest("placementFor rust: packageArg is undefined - cargo needs no package argument [contract-seam.md 'undefined when the toolchain needs none']", () => {
  const res = rustLang().placementFor(SRC, "adds", RUST_DEPS);
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.placement.packageArg, undefined, "cargo test --lib takes no package arg here");
});

gtest("placementFor rust: a file outside any crate refuses with reason 'no-project-root' and a detail NAMING what is missing [contract-seam.md 'PlacementRefusal ... it must NAME WHAT IS MISSING']", () => {
  const res = rustLang().placementFor(ORPHAN, "adds", NO_CRATE_DEPS);
  assert.strictEqual(res.ok, false, "no crate root means the gesture cannot place a test");
  assert.strictEqual(res.refusal.reason, "no-project-root", "the enumerated reason, not free text");
  assert.strictEqual(typeof res.refusal.detail, "string");
  assert.ok(
    res.refusal.detail.includes("Cargo.toml"),
    `the detail names the missing thing by name, got ${JSON.stringify(res.refusal.detail)}`
  );
});

gtest("placementFor rust: the refusal is a discriminated union - ok:false carries no placement [contract-seam.md 'PlacementResult = { ok: true; placement } | { ok: false; refusal }']", () => {
  const res = rustLang().placementFor(ORPHAN, "adds", NO_CRATE_DEPS);
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.placement, undefined, "a refusal never smuggles a half-built placement through");
});

// ===========================================================================
// 4. frameworkFor: first detect wins, refusal names everything looked for.
// ===========================================================================

gtest("frameworkFor rust: libtest always detects, so Rust always resolves a rung [contract-seam.md 'The first framework whose detect fires']", () => {
  const lang = rustLang();
  const res = frameworkFor(lang, CRATE, RUST_DEPS);
  assert.strictEqual(res.ok, true, "cargo ships libtest; there is nothing to configure and nothing to refuse");
  assert.strictEqual(res.framework.id, "libtest", "the resolved framework is libtest");
});

// frameworkFor takes the lang as a PARAMETER, so the all-fail case is
// constructible black-box with a hand-built TddLang-shaped literal. No
// registered language is needed and none is touched.
gtest("frameworkFor: when every candidate's detect returns false, the result is { ok:false, lookedFor } naming EVERY framework tried [contract-seam.md 'a refusal naming every framework that was looked for (honest-dark, never a guess)']", () => {
  const fw = (id, displayName) => ({
    id,
    displayName,
    detect: () => false,
    buildCommand: () => {
      throw new Error("buildCommand must not be reached when detect refused");
    },
    parseOutput: () => {
      throw new Error("parseOutput must not be reached when detect refused");
    },
    assertionInstruction: "",
    expectedValueSpans: () => [],
  });
  const fakeLang = {
    languageId: "fictional",
    displayName: "Fictional",
    markerPrefix: "//",
    frameworks: [fw("alpharunner", "AlphaRunner"), fw("betarunner", "BetaRunner")],
  };
  const res = frameworkFor(fakeLang, "/w/project", { fileExists: () => false });
  assert.strictEqual(res.ok, false, "no candidate detected, so the seam stays dark instead of guessing");
  assert.ok(Array.isArray(res.lookedFor), "lookedFor is an array of names");
  assert.strictEqual(res.lookedFor.length, 2, "every candidate is named, not just the first");
  // The contract calls displayName "Human name for the honest-dark message that
  // lists what was looked for", so lookedFor carries display names.
  const joined = res.lookedFor.join(" | ");
  assert.ok(joined.includes("AlphaRunner"), `the first framework is named, got ${joined}`);
  assert.ok(joined.includes("BetaRunner"), `the second framework is named, got ${joined}`);
  assert.strictEqual(res.framework, undefined, "a refusal carries no framework");
});

gtest("frameworkFor: the FIRST framework whose detect fires wins, precedence order is honoured [contract-seam.md 'Frameworks in PRECEDENCE order. The first whose detect fires wins.']", () => {
  const fw = (id, displayName, detects) => ({
    id,
    displayName,
    detect: () => detects,
    buildCommand: () => ({ command: id, args: [], cwd: "/" }),
    parseOutput: () => ({ ran: false, cases: [], failures: [], passed: 0, failed: 0, ignored: 0, casesComplete: true }),
    assertionInstruction: "",
    expectedValueSpans: () => [],
  });
  const fakeLang = {
    languageId: "fictional",
    displayName: "Fictional",
    markerPrefix: "//",
    frameworks: [fw("first", "First", false), fw("second", "Second", true), fw("third", "Third", true)],
  };
  const res = frameworkFor(fakeLang, "/w/project", { fileExists: () => false });
  assert.strictEqual(res.ok, true, "a detecting candidate resolves");
  assert.strictEqual(res.framework.id, "second", "the first DETECTING entry wins, not the last and not the first listed");
});

// ===========================================================================
// 5. libtest.buildCommand - THE SAFETY PIN.
//    Rust's shipped behaviour is byte-frozen: the seam must produce whatever
//    the shipped buildTestCommand produces, adding nothing and dropping
//    nothing. These three assertions are what catch a refactor that moved a
//    byte at the SEAM.
//    [goal.md 'Rust's shipped behaviour is byte-frozen'; contract-seam.md
//     invariant 1 '`cargo test --lib` ... behave EXACTLY as today']
//
//    The filter literals below moved twice, and the seam is not what moved
//    them either time. First the Q3 fix: `cargo test` takes exactly ONE
//    [TESTNAME] positional, so the multi-name shape these rows used to pin was
//    a hard cargo error (`error: unexpected argument 'tests::adds_wrong'
//    found`) and ran no tests at all. Filters go after the `--` separator,
//    which is the only place libtest sees more than one of them and OR-s them.
//
//    Then item 59: a filter that is a full libtest path rides with `--exact`,
//    because the substring default ran `add_more` for a rung scoped to `add`.
//    A BARE name still gets no flag — measured on cargo 1.96, that pair selects
//    ZERO tests, which is a silent rung rather than a scoped one.
// ===========================================================================

gtest("BYTE-FROZEN buildCommand: no test names -> cargo test --lib, cwd = the crate root [contract-seam.md invariant 1]", () => {
  const cmd = libtest().buildCommand(rustPlacement(), []);
  assert.strictEqual(cmd.command, "cargo", "the command is cargo, exactly");
  assert.deepStrictEqual(cmd.args, ["test", "--lib"], "run-all takes no positional filter");
  assert.strictEqual(cmd.cwd, CRATE, "cwd is the run root, which for Rust is the crate root");
});

gtest("BYTE-FROZEN buildCommand: one test name -> it is the trailing libtest filter, after the `--` separator [contract-seam.md invariant 1; goal.md 'wrapping the shipped buildTestCommand']", () => {
  const cmd = libtest().buildCommand(rustPlacement(), ["tests::adds"]);
  assert.strictEqual(cmd.command, "cargo");
  assert.deepStrictEqual(cmd.args, ["test", "--lib", "--", "--exact", "tests::adds"], "the name is handed to libtest past `--`, with the exactness flag that makes it name ONE test");
  assert.strictEqual(cmd.cwd, CRATE);
});

gtest("buildCommand: several test names ride past `--` as libtest filters in the order given, which is the only encoding cargo accepts [contract-seam.md 'buildCommand(placement, testNames: string[])']", () => {
  const cmd = libtest().buildCommand(rustPlacement(), ["tests::adds", "tests::adds_wrong"]);
  assert.strictEqual(cmd.command, "cargo");
  assert.deepStrictEqual(
    cmd.args,
    ["test", "--lib", "--", "--exact", "tests::adds", "tests::adds_wrong"],
    "names go past the separator in the caller's order; cargo itself takes ONE positional, so this is what makes a two-test rung run at all. `--exact` OR-s across all of them - measured."
  );
  assert.strictEqual(cmd.cwd, CRATE);
});

gtest("buildCommand: cwd tracks the placement's runRoot, not the target file's directory [contract-seam.md 'The directory the test COMMAND runs from']", () => {
  const cmd = libtest().buildCommand(rustPlacement({ runRoot: "/other/crate" }), []);
  assert.strictEqual(cmd.cwd, "/other/crate", "the run root the placement resolved is where the command runs");
});

gtest("buildCommand wired end to end: a placementFor result feeds buildCommand and still yields cargo test --lib in the crate root [contract-seam.md invariant 3 'Rust's call site must produce byte-identical commands']", () => {
  const lang = rustLang();
  const res = lang.placementFor(SRC, "adds", RUST_DEPS);
  assert.strictEqual(res.ok, true);
  const cmd = lang.frameworks[0].buildCommand(res.placement, ["tests::adds"]);
  assert.strictEqual(cmd.command, "cargo");
  assert.deepStrictEqual(cmd.args, ["test", "--lib", "--", "--exact", "tests::adds"]);
  assert.strictEqual(cmd.cwd, CRATE, "the resolved crate root reaches the command unchanged");
});

// ===========================================================================
// 6. libtest.parseOutput.
// ===========================================================================

gtest("parseOutput libtest: a mixed run gives ran=true, one case per test line with its outcome [contract-seam.md 'libtest.parseOutput wraps parseLibtestOutput']", () => {
  const p = libtest().parseOutput(LIBTEST_MIXED, "", 101);
  assert.strictEqual(p.ran, true, "a `running N` / `test result:` pair means the binary ran");
  assert.strictEqual(p.cases.length, 3, "ignored + ok + FAILED = three cases");
  const byName = Object.fromEntries(p.cases.map((c) => [c.name, c.outcome]));
  assert.strictEqual(byName["tests::adds"], "pass", "`... ok` is a pass");
  assert.strictEqual(byName["tests::adds_wrong"], "fail", "`... FAILED` is a fail");
  assert.strictEqual(byName["tests::skipped"], "ignored", "`... ignored` is an ignored case");
});

gtest("parseOutput libtest: the failure carries the panic/assertion text [contract-seam.md 'failures: TestFailureDetail[]']", () => {
  const p = libtest().parseOutput(LIBTEST_MIXED, "", 101);
  assert.strictEqual(p.failures.length, 1, "one detail block, one failure");
  const f = p.failures[0];
  assert.strictEqual(f.name, "tests::adds_wrong", "the failure is named by its full test path");
  assert.ok(f.message.includes("assertion"), `the assertion text survives, got ${JSON.stringify(f.message)}`);
  assert.ok(f.message.includes("left: 4"), "the left value survives");
  assert.ok(f.message.includes("right: 5"), "the right value survives");
});

gtest("parseOutput libtest: passed/failed/ignored come from the authoritative summary line [contract-seam.md 'passed / failed / ignored']", () => {
  const p = libtest().parseOutput(LIBTEST_MIXED, "", 101);
  assert.strictEqual(p.passed, 1);
  assert.strictEqual(p.failed, 1);
  assert.strictEqual(p.ignored, 1);

  const q = libtest().parseOutput(LIBTEST_PASS2, "", 0);
  assert.strictEqual(q.ran, true);
  assert.strictEqual(q.passed, 2);
  assert.strictEqual(q.failed, 0);
  assert.strictEqual(q.ignored, 0);
  assert.deepStrictEqual(q.failures, [], "an all-pass run has no failures");
});

gtest("parseOutput libtest: casesComplete is TRUE for Rust - libtest enumerates every case, passing ones included [contract-seam.md 'True everywhere else']", () => {
  for (const [label, text, exit] of [["mixed", LIBTEST_MIXED, 101], ["all pass", LIBTEST_PASS2, 0]]) {
    const p = libtest().parseOutput(text, "", exit);
    assert.strictEqual(p.casesComplete, true, `${label}: consumers may render cases as the whole run`);
  }
});

gtest("parseOutput libtest: filterMatchedNothing is never TRUE for Rust - libtest has no positive filter-miss tell, which is a measured fact not an omission [contract-seam.md 'absent in Rust and TypeScript, where only the executed>0 guard catches it']", () => {
  for (const [label, text, exit] of [
    ["mixed", LIBTEST_MIXED, 101],
    ["all pass", LIBTEST_PASS2, 0],
    ["zero tests, which IS the Rust filter miss and still carries no tell", LIBTEST_ZERO, 0],
  ]) {
    const p = libtest().parseOutput(text, "", exit);
    assert.ok(
      p.filterMatchedNothing === undefined || p.filterMatchedNothing === false,
      `${label}: Rust must not claim a filter-miss tell it does not have, got ${JSON.stringify(p.filterMatchedNothing)}`
    );
  }
});

gtest("parseOutput libtest: a zero-test run is ran=true with all counts 0, so the executed>0 guard is the only thing that refuses it [contract-seam.md invariant 5 'Green still requires passed + failed > 0']", () => {
  const p = libtest().parseOutput(LIBTEST_ZERO, "", 0);
  assert.strictEqual(p.ran, true, "the run happened, it just selected nothing");
  assert.deepStrictEqual(p.cases, [], "no test lines, no cases");
  assert.strictEqual(p.passed, 0);
  assert.strictEqual(p.failed, 0);
  assert.strictEqual(p.passed + p.failed, 0, "executed is zero, so green must not be claimed");
});

gtest("parseOutput libtest: garbage and empty input give a did-not-run result and NEVER throw [contract-seam.md 'ran: boolean'; blind-v8-testrung 'Never throw on garbage']", () => {
  const fw = libtest();
  for (const [label, out, err, exit] of [
    ["empty", "", "", 0],
    ["non-libtest noise", "cargo said something weird\n{not json}\nrandom noise\n", "", 101],
    ["arbitrary bytes", " ￿\n\n\t garbage", "", 1],
    ["a compile error on stderr only", "", "error[E0425]: cannot find value `x` in this scope\n", 101],
  ]) {
    let p;
    assert.doesNotThrow(() => {
      p = fw.parseOutput(out, err, exit);
    }, `${label}: parseOutput never throws`);
    assert.strictEqual(p.ran, false, `${label}: no libtest lines means the binary never ran`);
    assert.deepStrictEqual(p.cases, [], `${label}: no cases`);
    assert.deepStrictEqual(p.failures, [], `${label}: no failures`);
    assert.strictEqual(p.passed, 0, `${label}: zero passed`);
    assert.strictEqual(p.failed, 0, `${label}: zero failed`);
    assert.strictEqual(p.ignored, 0, `${label}: zero ignored`);
  }
});

// ===========================================================================
// 7. TestRunParse shape discipline. casesComplete is the field that stops a
//    consumer assuming `cases` is the full run, so it must be PRESENT on every
//    parse, including the ones that did not run.
//    [contract-seam.md 'C# never enumerates passing tests, so its parse sets
//     this false and consumers must not render cases as the full run']
// ===========================================================================

gtest("TestRunParse discipline: casesComplete is a present boolean on EVERY parse, run or not [contract-seam.md 'casesComplete: boolean' - not optional]", () => {
  const fw = libtest();
  const parses = [
    ["mixed", fw.parseOutput(LIBTEST_MIXED, "", 101)],
    ["all pass", fw.parseOutput(LIBTEST_PASS2, "", 0)],
    ["zero tests", fw.parseOutput(LIBTEST_ZERO, "", 0)],
    ["empty input", fw.parseOutput("", "", 0)],
    ["garbage input", fw.parseOutput("noise", "noise", 1)],
  ];
  for (const [label, p] of parses) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(p, "casesComplete"),
      `${label}: casesComplete is present, never left off for a consumer to guess`
    );
    assert.strictEqual(typeof p.casesComplete, "boolean", `${label}: casesComplete is a boolean, not undefined`);
  }
});

gtest("TestRunParse discipline: every parse carries the six base LibtestParse fields, so existing Rust consumers keep reading the same values [contract-seam.md 'A new TestRunParse supersets LibtestParse ... so every existing Rust consumer keeps compiling']", () => {
  const p = libtest().parseOutput(LIBTEST_MIXED, "", 101);
  assert.strictEqual(typeof p.ran, "boolean");
  assert.ok(Array.isArray(p.cases));
  assert.ok(Array.isArray(p.failures));
  assert.strictEqual(typeof p.passed, "number");
  assert.strictEqual(typeof p.failed, "number");
  assert.strictEqual(typeof p.ignored, "number");
});

// ===========================================================================
// 8. returnTypeOf, per language and routed through the seam.
// ===========================================================================

gtest("returnTypeOf rust: `fn f(x: i32) -> u64` yields u64 [contract-seam.md 'returnTypeOf | the existing returnTypeOf from fnGen.ts, moved to core UNCHANGED']", () => {
  assert.strictEqual(rustLang().returnTypeOf("fn f(x: i32) -> u64"), "u64", "the type after -> and nothing else");
});

gtest("returnTypeOf rust: a trailing body brace is excluded from the captured type [goal.md 'its regex is /->\\s*([\\s\\S]+?)\\s*(?:\\bwhere\\b|\\{|$)/']", () => {
  const lang = rustLang();
  assert.strictEqual(lang.returnTypeOf("pub fn f(x: i32) -> u64 {"), "u64", "the `{` terminates the capture");
  assert.strictEqual(lang.returnTypeOf("fn f() -> Vec<u8> {"), "Vec<u8>", "a generic type survives intact");
});

gtest("returnTypeOf rust: a where clause is excluded from the captured type [goal.md, same clause]", () => {
  const lang = rustLang();
  assert.strictEqual(
    lang.returnTypeOf("fn f<T>(x: T) -> Vec<T> where T: Clone"),
    "Vec<T>",
    "`where` terminates the capture"
  );
  assert.strictEqual(
    lang.returnTypeOf("fn f<T>(x: T) -> Vec<T> where T: Clone {"),
    "Vec<T>",
    "where plus a body brace still yields the bare type"
  );
});

gtest("returnTypeOf rust: an ABSENT return type yields undefined [contract-seam.md 'returnTypeOf(signature): string | undefined']", () => {
  const lang = rustLang();
  assert.strictEqual(lang.returnTypeOf("fn f(x: i32)"), undefined, "no arrow, nothing to assert on");
  assert.strictEqual(lang.returnTypeOf("pub fn f()"), undefined, "no arrow at all");
  assert.strictEqual(lang.returnTypeOf(""), undefined, "empty signature");
});

gtest("returnTypeOf rust: an EXPLICIT unit return `-> ()` yields undefined - a unit return is nothing to assert on [goal.md item 1 'a unit/absent return gives undefined']", () => {
  assert.strictEqual(
    rustLang().returnTypeOf("fn f(x: i32) -> ()"),
    undefined,
    "the unit type is not a value the human can type an expectation for"
  );
});

// ===========================================================================
// 9. classifyTestability through the seam, with Rust's SHIPPED verdicts.
//    [contract-seam.md 'classifyTestability | classifyTestability
//     (src/core/testability.ts)']
// ===========================================================================

const DOC = "/// Adds two numbers and returns the sum.";

gtest("classifyTestability rust: an async fn is refused with reason 'async' [goal.md 'classifyTestability ... impl Future']", () => {
  const v = rustLang().classifyTestability("pub async fn fetch(id: u32) -> u64", DOC);
  assert.strictEqual(v.reason, "async", "an async fn cannot be driven by a plain blind unit test");
});

gtest("classifyTestability rust: an io:: signature is refused with reason 'io' [goal.md 'io:: paths']", () => {
  const v = rustLang().classifyTestability("pub fn read_all(p: &Path) -> io::Result<String>", DOC);
  assert.strictEqual(v.reason, "io", "an io type in the signature means the test would touch the world");
});

gtest("classifyTestability rust: a self receiver is refused with reason 'needs-fixture' [goal.md 'self receivers']", () => {
  const v = rustLang().classifyTestability("pub fn total(&self) -> u64", DOC);
  assert.strictEqual(v.reason, "needs-fixture", "a method needs an instance the blind test cannot construct");
});

gtest("classifyTestability rust: no doc comment is refused with reason 'underspecified' [goal.md 'No doc comment is underspecified']", () => {
  const lang = rustLang();
  assert.strictEqual(
    lang.classifyTestability("pub fn add(a: i32, b: i32) -> i32", undefined).reason,
    "underspecified",
    "with no contract there is nothing to write a blind test against"
  );
  assert.strictEqual(
    lang.classifyTestability("pub fn add(a: i32, b: i32) -> i32", "").reason,
    "underspecified",
    "an empty doc comment is no doc comment"
  );
});

gtest("classifyTestability rust: a documented, pure, value-returning fn carries NO refusal reason [contract-seam.md 'Same verdict shape as the shipped Rust one']", () => {
  const v = rustLang().classifyTestability("pub fn add(a: i32, b: i32) -> i32", DOC);
  assert.strictEqual(v.reason, undefined, "the canonical testable shape is not refused");
});

gtest("classifyTestability rust: 'not-exported' is NEVER the verdict for ANY Rust input - `use super::*` sees private items, so Rust has no such refusal [contract-seam.md 'Rust never needs it (use super::* sees private items)']", () => {
  const lang = rustLang();
  const signatures = [
    "fn add(a: i32, b: i32) -> i32",
    "pub fn add(a: i32, b: i32) -> i32",
    "pub(crate) fn add(a: i32, b: i32) -> i32",
    "pub(super) fn hidden(a: i32) -> i32",
    "pub(in crate::inner) fn deep(a: i32) -> i32",
    "async fn fetch(id: u32) -> u64",
    "fn total(&self) -> u64",
    "fn read_all(p: &Path) -> io::Result<String>",
    "fn noop()",
    "",
  ];
  for (const sig of signatures) {
    for (const doc of [DOC, undefined]) {
      const v = lang.classifyTestability(sig, doc);
      assert.notStrictEqual(
        v.reason,
        "not-exported",
        `${JSON.stringify(sig)} (doc: ${doc ? "yes" : "no"}) must never be refused as not-exported; that reason belongs to TypeScript and C# only`
      );
    }
  }
});

// ===========================================================================
// 10. renderBlankValue: the seam ROUTES to the shipped renderer.
//     The whole shipped table is blind-v8-tabstop's to pin, not this file's.
//     [contract-seam.md 'renderBlankValue | renderBlankValue (src/core/tabstop.ts)']
// ===========================================================================

gtest("renderBlankValue through the rust TddLang: a scalar is ONE bare hole (the seam routes to the shipped renderer; blind-v8-tabstop owns the full table) [contract-seam.md 'renderBlankValue | renderBlankValue (src/core/tabstop.ts)']", () => {
  const res = rustLang().renderBlankValue("u64");
  assert.strictEqual(res.holes, 1, "a scalar is one hole: the value is what the CONTRACT determines");
  assert.ok(res.rhs.includes("${1}"), `the hole is a snippet tabstop, got ${JSON.stringify(res.rhs)}`);
});

gtest("renderBlankValue through the rust TddLang: a tuple is one hole per element, proving the routing is the real renderer and not a stub [contract-seam.md, same clause]", () => {
  const res = rustLang().renderBlankValue("(i32, i32)");
  assert.strictEqual(res.holes, 2, "two top-level elements, two holes");
  assert.ok(res.rhs.includes("${1}") && res.rhs.includes("${2}"), `both tabstops are present, got ${JSON.stringify(res.rhs)}`);
});

// ===========================================================================
// 11. scaffold: the insertion plan.
//     [contract-seam.md 'scaffold | planTestInsertion (src/core/testAssembly.ts)']
// ===========================================================================

const GENERATED =
  "    #[test]\n" +
  "    fn adds_two_numbers() {\n" +
  "        assert_eq!(add(2, 2), 4);\n" +
  "    }\n";

const SOURCE_NO_TESTS =
  "/// Adds two numbers.\n" +
  "pub fn add(a: i32, b: i32) -> i32 {\n" +
  "    a + b\n" +
  "}\n";

gtest("scaffold rust: returns a plan with start, end, text and mode [contract-seam.md 'Returns the existing TestInsertionPlan shape from testAssembly.ts (start, end, text, mode)']", () => {
  const lang = rustLang();
  const placed = lang.placementFor(SRC, "add", RUST_DEPS);
  assert.strictEqual(placed.ok, true);
  const plan = lang.scaffold({
    existingText: SOURCE_NO_TESTS,
    generatedTests: GENERATED,
    markerId: "add-1",
    placement: placed.placement,
  });
  assert.strictEqual(typeof plan.start, "number", "start is an offset into the target document");
  assert.strictEqual(typeof plan.end, "number", "end is an offset into the target document");
  assert.ok(plan.end >= plan.start, "the replaced range is not inverted");
  assert.strictEqual(typeof plan.text, "string", "text is what gets written");
  assert.strictEqual(typeof plan.mode, "string", "mode says how the plan was reached");
});

gtest("scaffold rust: a file with NO existing test module gets mode 'new-module' and a #[cfg(test)] wrapper in the text [contract-seam.md 'WHERE the tests go inside the target file, never clobbering the developer's own tests'; goal.md 'planTestInsertion | #[cfg(test)], mod tests {, use super::*;']", () => {
  const lang = rustLang();
  const placed = lang.placementFor(SRC, "add", RUST_DEPS);
  assert.strictEqual(placed.ok, true);
  const plan = lang.scaffold({
    existingText: SOURCE_NO_TESTS,
    generatedTests: GENERATED,
    markerId: "add-1",
    placement: placed.placement,
  });
  assert.strictEqual(plan.mode, "new-module", "no test module exists, so one is created");
  assert.ok(plan.text.includes("#[cfg(test)]"), `the scaffold wraps the tests in a cfg(test) module, got ${JSON.stringify(plan.text.slice(0, 200))}`);
  assert.ok(plan.text.includes("mod tests"), "the module is Rust's conventional `mod tests`");
  assert.ok(plan.text.includes("use super::*"), "the module reaches private items through use super::*");
  assert.ok(plan.text.includes("adds_two_numbers"), "the generated test function rides into the plan text");
});
