// Blind oracle: the `cargo test` rung (P4-surface.md). Black-box contract
// tests written from the surface ALONE, before the impl exists. Covers the
// three exported symbols under test:
//   parseLibtestOutput, buildTestCommand, runTestOracle
// from ../src/core/compilerOracle (plus RustOracle for crate-root injection).
//
// The core pass/fail/ignore/zero/two-fail fixtures below are REAL libtest text
// captured by running `cargo test --lib` on a scratch crate (cargo 1.x, stable
// human format) — the best available oracle. Hand-crafted variants derive from
// those for the authoritative-counts, ANSI/CRLF, and garbage clauses.
// Never read src/**. Expected RED against the stubs.
//
// Run: SKIP_LIVE=1 node --test test/blind-v8-testrung.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "blind-v8-testrung",
  `export { parseLibtestOutput, buildTestCommand, runTestOracle, RustOracle } from "../src/core/compilerOracle";\n`
);
const { parseLibtestOutput, buildTestCommand, runTestOracle, RustOracle } = mod;
test.after(cleanup);

const parse = (stdout) => parseLibtestOutput(stdout);

// ---------------------------------------------------------------------------
// REAL captured libtest samples (cargo test --lib, stable human format).
// ---------------------------------------------------------------------------

// 3 passing tests. exit 0.
const REAL_PASS3 =
  "\n" +
  "running 3 tests\n" +
  "test tests::a ... ok\n" +
  "test tests::b ... ok\n" +
  "test tests::c ... ok\n" +
  "\n" +
  "test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s\n";

// pass + fail + ignore mix, with a full failure-detail block. exit 101.
const REAL_MIXED =
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

// two failing tests, two distinct detail blocks. exit 101.
const REAL_TWO_FAIL =
  "\n" +
  "running 2 tests\n" +
  "test tests::one ... FAILED\n" +
  "test tests::two ... FAILED\n" +
  "\n" +
  "failures:\n" +
  "\n" +
  "---- tests::one stdout ----\n" +
  "\n" +
  "thread 'tests::one' (2801292) panicked at src/lib.rs:5:24:\n" +
  "assertion `left == right` failed\n" +
  "  left: 2\n" +
  " right: 3\n" +
  "note: run with `RUST_BACKTRACE=1` environment variable to display a backtrace\n" +
  "\n" +
  "---- tests::two stdout ----\n" +
  "\n" +
  "thread 'tests::two' (2801293) panicked at src/lib.rs:6:24:\n" +
  "assertion `left == right` failed\n" +
  "  left: 4\n" +
  " right: 9\n" +
  "\n" +
  "\n" +
  "failures:\n" +
  "    tests::one\n" +
  "    tests::two\n" +
  "\n" +
  "test result: FAILED. 0 passed; 2 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s\n";

// zero tests. exit 0.
const REAL_ZERO =
  "\n" +
  "running 0 tests\n" +
  "\n" +
  "test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s\n";

// #[ignore = "reason"] renders `ignored, <reason>`. exit 0.
const REAL_IGNORE_REASON =
  "\n" +
  "running 2 tests\n" +
  "test tests::skipped ... ignored, needs network\n" +
  "test tests::works ... ok\n" +
  "\n" +
  "test result: ok. 1 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out; finished in 0.00s\n";

// ===========================================================================
// 1. parseLibtestOutput — the star. [P4 §1]
// ===========================================================================

test("all-pass: real 3-pass capture -> ran true, 3 pass cases, counts 3/0/0, no failures [P4 §1 'test <name> ... ok -> pass'; 'test result: ... AUTHORITATIVE']", () => {
  const p = parse(REAL_PASS3);
  assert.strictEqual(p.ran, true, "a `running N`/`test result:` line was seen");
  assert.strictEqual(p.cases.length, 3, "one case per `test ... ok` line");
  assert.deepStrictEqual(p.cases.map((c) => c.name), ["tests::a", "tests::b", "tests::c"], "full path names, in emitted order");
  assert.ok(p.cases.every((c) => c.outcome === "pass"), "every `... ok` line is a pass");
  assert.strictEqual(p.passed, 3);
  assert.strictEqual(p.failed, 0);
  assert.strictEqual(p.ignored, 0);
  assert.deepStrictEqual(p.failures, [], "no failure blocks -> empty failures");
});

test("with a failure: the FAILED case carries a captured panic/assertion message; failed=1 [P4 §1 'capture the ... panicked/assertion text as message']", () => {
  const p = parse(REAL_MIXED);
  assert.strictEqual(p.ran, true);
  assert.strictEqual(p.failed, 1, "authoritative `1 failed` from the summary");
  assert.strictEqual(p.passed, 1);
  assert.strictEqual(p.ignored, 1);

  // the FAILED case appears in cases as a fail, in order (after ignored, after ok).
  const failCase = p.cases.find((c) => c.name === "tests::adds_wrong");
  assert.ok(failCase, "the FAILED line is present in cases");
  assert.strictEqual(failCase.outcome, "fail");
  assert.strictEqual(p.cases.length, 3, "ignored + ok + FAILED = 3 cases");

  // its message captures the panic block.
  assert.strictEqual(p.failures.length, 1, "one failure-detail block");
  const f = p.failures[0];
  assert.strictEqual(f.name, "tests::adds_wrong", "block name is the full test path");
  assert.ok(f.message.includes("assertion"), `message keeps the assertion text, got ${JSON.stringify(f.message)}`);
  assert.ok(f.message.includes("left: 4"), "captures the left value");
  assert.ok(f.message.includes("right: 5"), "captures the right value");
  assert.ok(f.message.includes("panicked at"), "captures the panic header line");
});

test("ignored: both bare `... ignored` and `ignored, <reason>` forms -> ignored cases and counts [P4 §1 'test ... ignored (optionally ignored, <reason>) -> ignored']", () => {
  const bare = parse(REAL_MIXED);
  const bareCase = bare.cases.find((c) => c.name === "tests::skipped");
  assert.ok(bareCase, "the bare-ignored line is a case");
  assert.strictEqual(bareCase.outcome, "ignored", "`... ignored` -> ignored outcome");
  assert.strictEqual(bare.ignored, 1, "authoritative ignored count");

  const reason = parse(REAL_IGNORE_REASON);
  const rCase = reason.cases.find((c) => c.name === "tests::skipped");
  assert.ok(rCase, "the `ignored, <reason>` line is a case");
  assert.strictEqual(rCase.outcome, "ignored", "the trailing reason does not defeat the ignored classification");
  assert.strictEqual(reason.ignored, 1);
  assert.strictEqual(reason.passed, 1, "the sibling `... ok` still counts");
});

test("zero tests: `running 0 tests` + `0 passed` summary -> ran true, no cases, all counts 0 [P4 §1 'a zero-test run -> ran true, all counts 0, no cases']", () => {
  const p = parse(REAL_ZERO);
  assert.strictEqual(p.ran, true, "the run happened, it just had no tests");
  assert.deepStrictEqual(p.cases, [], "no `test ...` lines -> no cases");
  assert.deepStrictEqual(p.failures, []);
  assert.strictEqual(p.passed, 0);
  assert.strictEqual(p.failed, 0);
  assert.strictEqual(p.ignored, 0);
});

test("multiple failures: two `---- name stdout ----` blocks -> two distinct failures, no bleed across the boundary [P4 §1 'stopping at the next ---- block']", () => {
  const p = parse(REAL_TWO_FAIL);
  assert.strictEqual(p.failed, 2, "authoritative `2 failed`");
  assert.strictEqual(p.failures.length, 2, "one detail block per failed test");
  assert.deepStrictEqual(p.failures.map((f) => f.name), ["tests::one", "tests::two"], "distinct names in order");

  const [first, second] = p.failures;
  // first block's message is only the first block's text.
  assert.ok(first.message.includes("left: 2") && first.message.includes("right: 3"), "first block keeps its own values");
  assert.ok(!first.message.includes("left: 4"), "second block's `left: 4` did NOT bleed into the first");
  assert.ok(!first.message.includes("right: 9"), "second block's `right: 9` did NOT bleed into the first");
  assert.ok(!first.message.includes("tests::two"), "the next block header did NOT bleed into the first message");
  // second block's message is only the second block's text.
  assert.ok(second.message.includes("left: 4") && second.message.includes("right: 9"), "second block keeps its own values");
  assert.ok(!second.message.includes("left: 2"), "first block's values did NOT bleed forward");
});

test("authoritative counts: the `test result:` line is the source of truth, not the case tally [P4 §1 'the AUTHORITATIVE source ... when present']", () => {
  // Two `... ok` lines, but a summary that disagrees. The summary must win.
  const stdout =
    "\nrunning 2 tests\n" +
    "test tests::a ... ok\n" +
    "test tests::b ... ok\n" +
    "\n" +
    "test result: FAILED. 7 passed; 2 failed; 1 ignored; 0 measured; 0 filtered out; finished in 0.01s\n";
  const p = parse(stdout);
  assert.strictEqual(p.passed, 7, "counts come from the summary, not from counting cases");
  assert.strictEqual(p.failed, 2);
  assert.strictEqual(p.ignored, 1);
  assert.strictEqual(p.cases.length, 2, "cases still reflect the actual `test ...` lines");
});

test("robustness: empty string and non-libtest garbage -> ran false, everything empty/zero, never throws [P4 §1 'Never throw on garbage']", () => {
  const zero = { ran: false, cases: [], failures: [], passed: 0, failed: 0, ignored: 0 };
  assert.deepStrictEqual(parse(""), zero, "empty input -> the documented empty shape");
  assert.deepStrictEqual(parse("cargo said something weird\n{not json}\nrandom noise\n"), zero, "non-libtest text -> empty shape, ran false");
  assert.doesNotThrow(() => parse(" ￿\n\n\t garbage"), "never throws on arbitrary bytes");
});

test("ANSI + CRLF tolerance: colored outcome tokens and \\r\\n endings still parse [P4 §1 'Tolerate ANSI color escapes (strip them) and CRLF']", () => {
  // Real libtest color resets look like `\x1b[32mok\x1b(B\x1b[m`; include both
  // that and the simpler `\x1b[0m` reset, over CRLF line endings.
  const stdout =
    "\r\n" +
    "running 3 tests\r\n" +
    "test tests::a ... \x1b[32mok\x1b[0m\r\n" +
    "test tests::b ... \x1b[32mok\x1b(B\x1b[m\r\n" +
    "test tests::c ... \x1b[32mok\x1b[0m\r\n" +
    "\r\n" +
    "test result: \x1b[32mok\x1b[0m. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s\r\n";
  const p = parse(stdout);
  assert.strictEqual(p.ran, true, "CRLF + ANSI does not defeat run detection");
  assert.strictEqual(p.passed, 3, "summary parsed through the color codes");
  assert.strictEqual(p.cases.length, 3, "each colored `... ok` line is still a case");
  assert.ok(p.cases.every((c) => c.outcome === "pass"), "the color-wrapped `ok` token still classifies as pass");
  assert.deepStrictEqual(p.cases.map((c) => c.name), ["tests::a", "tests::b", "tests::c"], "names are not polluted by escape bytes");
});

// ===========================================================================
// 2. buildTestCommand [P4 §2]
// ===========================================================================

const CRATE = "/w/crate";

test("buildTestCommand base: `cargo test --lib` in cwd=crateRoot, no positional for empty filter [P4 §2 'Base: cargo test --lib'; 'Empty filter -> no positional']", () => {
  const cmd = buildTestCommand(CRATE, "");
  assert.strictEqual(cmd.command, "cargo", "command is cargo");
  assert.strictEqual(cmd.cwd, CRATE, "cwd is the crate root");
  assert.deepStrictEqual(cmd.args, ["test", "--lib"], "run-all: no positional filter");
});

test("buildTestCommand with a non-empty filter: handed to libtest after the `--` separator [P4 §2 'filter (non-empty) is appended as the positional']", () => {
  // P4 §2 wrote "positional" because one filter reads the same either way. It
  // is not the same for two: `cargo test` takes exactly ONE [TESTNAME], so a
  // second filter before `--` is `error: unexpected argument`. Everything from
  // `--` onward goes to libtest, which takes as many filters as it is given.
  const cmd = buildTestCommand(CRATE, "tests::adds");
  assert.deepStrictEqual(cmd.args, ["test", "--lib", "--", "tests::adds"], "filter trails the separator, not cargo's own positional slot");
  assert.strictEqual(cmd.command, "cargo");
  assert.strictEqual(cmd.cwd, CRATE);
});

test("buildTestCommand noRun: includes --no-run (build, do not run), and it stays on cargo's side of the separator [P4 §2 'opts.noRun -> include --no-run']", () => {
  const bare = buildTestCommand(CRATE, "", { noRun: true });
  assert.deepStrictEqual(bare.args, ["test", "--lib", "--no-run"], "--no-run with no filter (the prewarm shape), and no bare separator");

  const filtered = buildTestCommand(CRATE, "tests::adds", { noRun: true });
  assert.deepStrictEqual(
    filtered.args,
    ["test", "--lib", "--no-run", "--", "tests::adds"],
    "--no-run is a cargo flag so it precedes `--`; the filter is libtest's so it follows. Deterministic order."
  );
});

// ===========================================================================
// 3. runTestOracle [P4 §3] — injected runCommand + injected-fileExists oracle.
// ===========================================================================

// Virtual filesystem for detectCrateRoot: mirrors blind4-oracle-run.test.cjs.
const vfs = (manifestDirs) => (p) => manifestDirs.some((d) => p === path.join(d, "Cargo.toml"));

const FILE = "/w/crate/src/task1.rs";

// Build a runTestOracle test rig: an oracle whose crate-root walk is faked, and
// a runCommand that captures the command and replays a canned process result.
const rig = ({ manifestDirs = ["/w/crate"], stdout = "", stderr = "", exitCode = 0 } = {}) => {
  const oracle = new RustOracle({ fileExists: vfs(manifestDirs) });
  const calls = [];
  const runCommand = async (cmd) => {
    calls.push(cmd);
    return { stdout, stderr, exitCode };
  };
  return { oracle, runCommand, calls };
};

test("file outside any crate: detectCrateRoot undefined -> resolves undefined, runner never called [P4 §3 'Resolves undefined when detectCrateRoot is undefined']", async () => {
  const { oracle, runCommand, calls } = rig({ manifestDirs: [] });
  const result = await runTestOracle(oracle, FILE, "tests::adds", { runCommand });
  assert.strictEqual(result, undefined, "no crate root -> undefined, same shape as runOracleCheck");
  assert.strictEqual(calls.length, 0, "nothing runs without a crate root");
});

test("all-pass run (exit 0): ran true, success true, failed 0, counts flow from the parse [P4 §3 'success = ran && failed===0 && exitCode===0']", async () => {
  const { oracle, runCommand } = rig({ stdout: REAL_PASS3, exitCode: 0 });
  const result = await runTestOracle(oracle, FILE, "", { runCommand });
  assert.ok(result, "a real run resolves a result");
  assert.strictEqual(result.ran, true);
  assert.strictEqual(result.success, true, "ran, 0 failed, exit 0 -> success");
  assert.strictEqual(result.failed, 0);
  assert.strictEqual(result.passed, 3);
  assert.strictEqual(result.crateRoot, "/w/crate", "the resolved crate root is surfaced");
  assert.strictEqual(typeof result.durationMs, "number");
  assert.ok(result.durationMs >= 0, "durationMs is a non-negative number");
});

test("failing-test run (exit 101): ran true, success false, failed 1, failures carried [P4 §3 'a non-zero exit with parseable output is a NORMAL result']", async () => {
  const { oracle, runCommand } = rig({ stdout: REAL_MIXED, exitCode: 101 });
  let result;
  await assert.doesNotReject(async () => {
    result = await runTestOracle(oracle, FILE, "tests::adds_wrong", { runCommand });
  }, "a non-zero exit with parseable libtest output does NOT reject");
  assert.ok(result, "failing tests resolve a result, they are what this oracle reports");
  assert.strictEqual(result.ran, true, "the test binary executed");
  assert.strictEqual(result.success, false, "a failure OR a non-zero exit defeats success");
  assert.strictEqual(result.failed, 1);
  assert.strictEqual(result.failures.length, 1);
  assert.strictEqual(result.failures[0].name, "tests::adds_wrong");
  assert.ok(result.failures[0].message.includes("assertion"), "the panic message rides through the orchestrator");
});

test("compile error (stderr set, no libtest lines on stdout, exit 101): ran false, success false, buildError = the stderr [P4 §3 'When !ran, buildError = the captured STDERR']", async () => {
  const buildErrText = "error[E0425]: cannot find value `x` in this scope\n --> src/lib.rs:3:5\n";
  const { oracle, runCommand } = rig({ stdout: "", stderr: buildErrText, exitCode: 101 });
  const result = await runTestOracle(oracle, FILE, "tests::adds", { runCommand });
  assert.ok(result, "a build failure still resolves (it is a real oracle verdict)");
  assert.strictEqual(result.ran, false, "no `running N`/`test result:` on stdout -> the binary never ran");
  assert.strictEqual(result.success, false, "!ran can never be success");
  assert.strictEqual(result.buildError, buildErrText, "buildError is exactly the captured stderr (cargo's human compile errors)");
});

test("runTestOracle runs exactly the command buildTestCommand would produce [P4 §3 'Builds the command via buildTestCommand']", async () => {
  const filter = "tests::adds";
  const { oracle, runCommand, calls } = rig({ stdout: REAL_PASS3, exitCode: 0 });
  await runTestOracle(oracle, FILE, filter, { runCommand });
  assert.strictEqual(calls.length, 1, "the command is run once");
  const expected = buildTestCommand("/w/crate", filter);
  assert.deepStrictEqual(
    { command: calls[0].command, args: calls[0].args, cwd: calls[0].cwd },
    { command: expected.command, args: expected.args, cwd: expected.cwd },
    "the injected runner receives the buildTestCommand shape verbatim (cwd = resolved crate root)"
  );
});

test("runTestOracle honors noRun: the --no-run prewarm shape reaches the runner [P4 §3 opts.noRun -> §2 --no-run]", async () => {
  const { oracle, runCommand, calls } = rig({ stdout: "", exitCode: 0 });
  await runTestOracle(oracle, FILE, "", { runCommand, noRun: true });
  assert.strictEqual(calls.length, 1);
  assert.deepStrictEqual(calls[0].args, ["test", "--lib", "--no-run"], "noRun flows into the built command");
});
