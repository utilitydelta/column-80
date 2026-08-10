// Implementer tests for P4 (on top of blind-v8-testrung): the three triaged
// review fixes.
//   DO-1 — a filter matching ZERO tests (`0 passed; 0 failed; N filtered out`,
//          exit 0) must NOT report success (the v6 "green means nothing" crisis).
//   DO-2 — a failure message that itself contains `---- x stdout ----` /
//          `failures:` / `test result:` lines must not fabricate a phantom
//          failure or truncate the real panic text (boundary = known FAILED name).
//   DO-3 — a successful `--no-run` prewarm (exit 0, empty stdout) is success with
//          no buildError, not a build failure.
//
// Run: SKIP_LIVE=1 node --test test/impl-v8-testrung.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-v8-testrung",
  `export { parseLibtestOutput, runTestOracle, RustOracle } from "../src/core/compilerOracle";\n`
);
const { parseLibtestOutput, runTestOracle, RustOracle } = mod;
test.after(cleanup);

// A RustOracle whose detectCrateRoot resolves without real files: any dir with a
// Cargo.toml the fake reports present.
const oracleWithRoot = (root) =>
  new RustOracle({ fileExists: (p) => p === `${root}/Cargo.toml` });
const runner = (stdout, stderr, exitCode) => async () => ({ stdout, stderr, exitCode });

// ---- DO-1: zero-match filter is not a green ------------------------------

const ZERO_MATCH = `
running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 1 filtered out; finished in 0.00s
`;

test("DO-1: a filter matching zero tests (0 passed/failed, exit 0) is NOT success", async () => {
  const res = await runTestOracle(oracleWithRoot("/w"), "/w/src/lib.rs", "tests::nonexistent", {
    runCommand: runner(ZERO_MATCH, "", 0),
  });
  assert.strictEqual(res.ran, true, "the binary ran (a libtest run was present)");
  assert.strictEqual(res.passed, 0);
  assert.strictEqual(res.failed, 0);
  assert.strictEqual(res.success, false, "nothing executed -> not a green (the v6 completion-proxy crisis)");
});

test("DO-1: a genuine all-pass run stays success", async () => {
  const stdout = "\nrunning 2 tests\ntest tests::a ... ok\ntest tests::b ... ok\n\ntest result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s\n";
  const res = await runTestOracle(oracleWithRoot("/w"), "/w/src/lib.rs", "tests::", { runCommand: runner(stdout, "", 0) });
  assert.strictEqual(res.success, true, "tests executed and passed -> success");
  assert.strictEqual(res.passed, 2);
});

// ---- DO-2: panic text can't fabricate a phantom failure -------------------

const MESSAGE_WITH_TRAPS = `
running 2 tests
test tests::renders_report ... FAILED
test tests::other ... ok

failures:

---- tests::renders_report stdout ----
thread 'tests::renders_report' panicked at src/lib.rs:10:5:
assertion \`left == right\` failed
  left: "---- summary stdout ----\\nfailures:\\ntest result: ok."
 right: "expected"
note: run with \`RUST_BACKTRACE=1\` environment variable to display a backtrace

failures:
    tests::renders_report

test result: FAILED. 1 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
`;

test("DO-2: a panic message containing ----/failures:/test result: lines yields ONE real failure, no phantom", () => {
  const p = parseLibtestOutput(MESSAGE_WITH_TRAPS);
  assert.strictEqual(p.failed, 1, "exactly one failure");
  assert.strictEqual(p.failures.length, 1, "no phantom failure fabricated from the message text");
  assert.strictEqual(p.failures[0].name, "tests::renders_report", "the real failed test");
  assert.match(p.failures[0].message, /assertion `left == right` failed/, "the real panic text is captured");
  assert.ok(p.failures[0].message.includes("summary stdout"), "the trap line inside the message is kept as content, not a boundary");
  assert.ok(!p.failures.some((f) => f.name === "summary"), "no `summary` phantom from the ---- line in the message");
});

// ---- DO-3: successful prewarm is honest -----------------------------------

test("DO-3: a successful --no-run prewarm is success with no buildError", async () => {
  // --no-run emits no libtest lines; the build banner is on stderr, exit 0.
  const res = await runTestOracle(oracleWithRoot("/w"), "/w/src/lib.rs", "", {
    noRun: true,
    runCommand: runner("", "   Compiling trung v0.0.0\n    Finished test profile\n", 0),
  });
  assert.strictEqual(res.success, true, "a warm build is success, not a failure");
  assert.strictEqual(res.buildError, undefined, "no buildError on a successful prewarm");
  assert.strictEqual(res.ran, false, "nothing ran (prewarm)");
});

test("DO-3: a FAILED --no-run prewarm surfaces the compile error", async () => {
  const res = await runTestOracle(oracleWithRoot("/w"), "/w/src/lib.rs", "", {
    noRun: true,
    runCommand: runner("", "error[E0308]: mismatched types\n", 101),
  });
  assert.strictEqual(res.success, false);
  assert.match(res.buildError, /E0308/, "the compile error is surfaced");
});
