// Blind oracle: the language-pluggable oracle seam.
// Black-box contract tests written from the surface ALONE, before the impl
// exists. Covers the New-surface clauses:
//   §1 CompilerOracle grows checkSuccess/resolveDiagnosticPath/isAssertionShaped
//      (required) and buildTestCommand/parseTestOutput (optional rung)
//   §2 oracleFor: rust -> oracle, anything else -> undefined, deps reach it
//   §3 RustOracle's new methods (build-finished verdict, path resolution,
//      assertion classifier, rung parity with the free exports)
//   §4 runOracleCheck/runTestOracle route through the STRATEGY (stub oracles
//      with marker rules), no-rung skip, undefined-root and reject behavior
//   §5 repair hooks: classifyEligibility 3rd param, RepairScope.resolvePath,
//      RepairSession 4th ctor param
// Never read src/**. Expected RED: `oracleFor` does not exist yet, so the
// bundle itself may fail. The try/catch below keeps that red informative: one
// failing bundle test, the rest skip; once the impl lands everything runs.
//
// Run: SKIP_LIVE=1 node --test test/blind-v9-seam.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const { bundleCore } = require("./.blind-util.cjs");

let mod = {};
let cleanup = () => {};
let bundleError;
try {
  ({ mod, cleanup } = bundleCore(
    "blind-v9-seam",
    `export { oracleFor, RustOracle, runOracleCheck, runTestOracle, resolveDiagnosticPath, buildTestCommand, parseLibtestOutput } from "../src/core/compilerOracle";\n` +
    `export { classifyEligibility, RepairSession } from "../src/core/repair";\n`
  ));
} catch (e) {
  bundleError = e;
}
test.after(() => cleanup());

const {
  oracleFor,
  RustOracle,
  runOracleCheck,
  runTestOracle,
  resolveDiagnosticPath,
  buildTestCommand,
  parseLibtestOutput,
  classifyEligibility,
  RepairSession,
} = mod;

test("bundle: the v9 seam surface builds (oracleFor + repair hooks exported) [surface: Test harness 'Bundle the surface with the existing helper']", () => {
  if (bundleError) {
    assert.fail(`bundle failed to build - the surface is not implemented yet: ${bundleError.message}`);
  }
});

// Every other test skips (not fails) while the bundle is broken, so the red
// run stays one loud failure instead of a wall of TypeErrors.
const gtest = (name, fn) =>
  test(name, (ctx) => {
    if (bundleError) return ctx.skip("bundle failed to build; see the bundle test");
    return fn(ctx);
  });

// ---------------------------------------------------------------------------
// Shared fixtures. No real filesystem: fileExists is always injected.
// ---------------------------------------------------------------------------

// Virtual filesystem: true only for the exact paths given.
const existsIn = (paths) => (p) => paths.includes(p);
// Manifest-only vfs, same shape as the v8 blind tests.
const vfs = (manifestDirs) => (p) => manifestDirs.some((d) => p === path.join(d, "Cargo.toml"));

const CRATE = "/w/crate";
const FILE = "/w/crate/src/task1.rs";

const span = (over = {}) => ({
  fileName: "/w/crate/src/lib.rs",
  byteStart: 10,
  byteEnd: 20,
  lineStart: 2,
  lineEnd: 2,
  columnStart: 5,
  columnEnd: 15,
  isPrimary: true,
  ...over,
});

const diag = (over = {}) => ({
  kind: "compile-error",
  level: "error",
  code: "E0308",
  message: "mismatched types",
  spans: [span()],
  suggestions: [],
  ...over,
});

// A repair scope whose filePath the default span resolves into (absolute
// fileName passes through unchanged), byte range wide open.
const SCOPE = {
  filePath: "/w/crate/src/lib.rs",
  crateRoot: CRATE,
  byteStart: 0,
  byteEnd: 1000,
  fileExists: existsIn(["/w/crate/Cargo.toml"]),
};

// A full-interface stub oracle for §4. Marker command/parse so routing is
// observable; overrides encode each test's marker rule.
const stubOracle = (over = {}) => ({
  language: "stublang",
  appliesTo: () => true,
  detectCrateRoot: () => CRATE,
  buildCheckCommand: (root) => ({ command: "stubcheck", args: ["--marker"], cwd: root }),
  parseCheckOutput: () => [],
  checkSuccess: (stdout, exitCode) => exitCode === 0,
  resolveDiagnosticPath: (root, name) => name,
  isAssertionShaped: () => false,
  ...over,
});

// Small real-shaped libtest sample for rung parity checks.
const LIBTEST_MIXED =
  "\n" +
  "running 2 tests\n" +
  "test tests::adds ... ok\n" +
  "test tests::adds_wrong ... FAILED\n" +
  "\n" +
  "failures:\n" +
  "\n" +
  "---- tests::adds_wrong stdout ----\n" +
  "\n" +
  "thread 'tests::adds_wrong' (1) panicked at src/lib.rs:14:9:\n" +
  "assertion `left == right` failed\n" +
  "  left: 4\n" +
  " right: 5\n" +
  "\n" +
  "\n" +
  "failures:\n" +
  "    tests::adds_wrong\n" +
  "\n" +
  "test result: FAILED. 1 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s\n";

// ===========================================================================
// 1. The interface: three required strategy methods, optional rung. [surface §1]
// ===========================================================================

gtest("interface: oracleFor('rust') carries every required strategy method as a function [surface §1 'three required strategy methods']", () => {
  const oracle = oracleFor("rust", { fileExists: vfs([CRATE]) });
  assert.ok(oracle, "rust resolves an oracle");
  assert.strictEqual(typeof oracle.appliesTo, "function");
  assert.strictEqual(typeof oracle.detectCrateRoot, "function");
  assert.strictEqual(typeof oracle.buildCheckCommand, "function");
  assert.strictEqual(typeof oracle.parseCheckOutput, "function");
  assert.strictEqual(typeof oracle.checkSuccess, "function", "new required: checkSuccess");
  assert.strictEqual(typeof oracle.resolveDiagnosticPath, "function", "new required: resolveDiagnosticPath");
  assert.strictEqual(typeof oracle.isAssertionShaped, "function", "new required: isAssertionShaped");
});

gtest("interface: rust HAS the optional test rung - both methods present together [surface §1 'Both absent when the language has no rung' - rust has one]", () => {
  const oracle = oracleFor("rust");
  assert.strictEqual(typeof oracle.buildTestCommand, "function", "rust ships the rung: buildTestCommand");
  assert.strictEqual(typeof oracle.parseTestOutput, "function", "rust ships the rung: parseTestOutput");
});

// ===========================================================================
// 2. oracleFor - the one construction point. [surface §2]
// ===========================================================================

gtest("oracleFor('rust'): language === 'rust' and appliesTo('rust') true [surface §2 'oracleFor(\"rust\") returns an oracle with language === \"rust\"']", () => {
  const oracle = oracleFor("rust");
  assert.ok(oracle, "rust gets an oracle");
  assert.strictEqual(oracle.language, "rust");
  assert.strictEqual(oracle.appliesTo("rust"), true);
});

gtest("oracleFor: languageIds with NO registered oracle return undefined [phase2 surface 'oracleFor registration': python | plaintext | vue | svelte | '' -> undefined]", () => {
  for (const id of ["plaintext", "vue", "svelte", ""]) {
    assert.strictEqual(oracleFor(id), undefined, `oracleFor(${JSON.stringify(id)}) must be undefined - no oracle is registered for it`);
  }
  // The TS registration itself is pinned by blind-v9-tsoracle.test.cjs; from
  // this seam's side we only pin that "typescript" is no longer unregistered.
  assert.notStrictEqual(oracleFor("typescript"), undefined, "typescript now has a registered oracle (phase 2 supersession)");
  // v11 supersession: python left the unregistered set when its oracle went live
  // (PyOracle in oracleFor), the same way typescript did. Pinned in full by
  // blind-v11-pyoracle.test.cjs; here we only record it is no longer dark.
  assert.notStrictEqual(oracleFor("python"), undefined, "python now has a registered oracle (v11 supersession)");
});

gtest("oracleFor deps: injected fileExists reaches the oracle - detectCrateRoot resolves a fake manifest without disk [surface §2 'deps reach the constructed oracle']", () => {
  const oracle = oracleFor("rust", { fileExists: vfs(["/fake/crate"]) });
  assert.strictEqual(oracle.detectCrateRoot("/fake/crate/src/lib.rs"), "/fake/crate", "the fake Cargo.toml is honored, so fileExists was injected");
  assert.strictEqual(oracle.detectCrateRoot("/elsewhere/src/lib.rs"), undefined, "outside the fake crate there is no root");
});

// ===========================================================================
// 3. RustOracle's new methods. [surface §3]
// ===========================================================================

gtest("checkSuccess: a build-finished JSON line is the verdict, exit code only the fallback [surface §3 'cargo's own build-finished JSON line is the verdict when present']", () => {
  const oracle = new RustOracle({ fileExists: vfs([CRATE]) });
  const bfTrue = '{"reason":"compiler-artifact","target":{}}\n{"reason":"build-finished","success":true}\n';
  const bfFalse = '{"reason":"build-finished","success":false}\n';
  const cases = [
    { stdout: bfTrue, exitCode: 101, want: true, why: "build-finished success:true wins over a non-zero exit" },
    { stdout: bfFalse, exitCode: 0, want: false, why: "build-finished success:false wins over exit 0" },
    { stdout: "", exitCode: 0, want: true, why: "no build-finished line -> exitCode === 0" },
    { stdout: '{"reason":"compiler-message"}\n', exitCode: 1, want: false, why: "no build-finished line -> non-zero exit fails" },
  ];
  for (const c of cases) {
    assert.strictEqual(oracle.checkSuccess(c.stdout, c.exitCode), c.want, c.why);
  }
});

gtest("checkSuccess: non-JSON garbage lines are skipped, never thrown on [surface §3 'Non-JSON garbage lines are skipped, never thrown on']", () => {
  const oracle = new RustOracle({ fileExists: vfs([CRATE]) });
  const noisy =
    "warning: something human-readable\n" +
    "{not json at all\n" +
    '{"reason":"build-finished","success":true}\n' +
    "trailing noise \u{fffd}\n";
  assert.doesNotThrow(() => oracle.checkSuccess(noisy, 101), "garbage lines never throw");
  assert.strictEqual(oracle.checkSuccess(noisy, 101), true, "the build-finished line is still found among garbage");
  assert.doesNotThrow(() => oracle.checkSuccess("pure garbage\n{broken", 0), "all-garbage input never throws");
  assert.strictEqual(oracle.checkSuccess("pure garbage\n{broken", 0), true, "all-garbage falls back to the exit code");
});

gtest("resolveDiagnosticPath method: absolute passthrough, workspace-anchor join, walk-up fallback, crateRoot last resort [surface §3 'identical behavior to the free resolveDiagnosticPath export']", () => {
  // Workspace layout: /w is the outermost Cargo.toml holder, /w/crate a member.
  const anchorFs = existsIn(["/w/Cargo.toml", "/w/crate/Cargo.toml", "/w/src/lib.rs"]);
  const nearestFs = existsIn(["/w/Cargo.toml", "/w/crate/Cargo.toml", "/w/crate/src/lib.rs"]);
  const emptyFs = existsIn(["/w/crate/Cargo.toml"]);
  const oracle = new RustOracle();

  const cases = [
    { fs: anchorFs, fileName: "/abs/elsewhere.rs", want: "/abs/elsewhere.rs", why: "absolute fileName passes through unchanged" },
    { fs: anchorFs, fileName: "src/lib.rs", want: "/w/src/lib.rs", why: "relative resolves against the OUTERMOST Cargo.toml ancestor when that join exists" },
    { fs: nearestFs, fileName: "src/lib.rs", want: "/w/crate/src/lib.rs", why: "anchor join missing -> nearest-existing join walking up from crateRoot" },
    { fs: emptyFs, fileName: "src/lib.rs", want: path.join(CRATE, "src/lib.rs"), why: "nothing exists -> plain crateRoot join, last resort" },
  ];
  for (const c of cases) {
    assert.strictEqual(oracle.resolveDiagnosticPath(CRATE, c.fileName, c.fs), c.want, c.why);
    assert.strictEqual(
      oracle.resolveDiagnosticPath(CRATE, c.fileName, c.fs),
      resolveDiagnosticPath(CRATE, c.fileName, c.fs),
      `method and free export agree: ${c.why}`
    );
  }
});

gtest("isAssertionShaped: kind + message family classify, custom panics and type errors do not [surface §3 'isAssertionShaped(d)']", () => {
  const oracle = new RustOracle();
  const cases = [
    { d: diag({ kind: "assertion-failure", message: "anything at all" }), want: true, why: "kind assertion-failure is true regardless of message" },
    { d: diag({ kind: "panic", message: "assertion `left == right` failed" }), want: true, why: "assertion...failed message shape" },
    { d: diag({ kind: "panic", message: "assertion failed: x > 0" }), want: true, why: "assertion failed: ... message shape" },
    { d: diag({ kind: "panic", message: "  assertion failed: padded" }), want: true, why: "the message is trimmed before the prefix test" },
    { d: diag({ message: "evaluation panicked: assertion `left == right` failed" }), want: true, why: "evaluation panicked: prefix is stripped first (const-eval asserts)" },
    { d: diag({ kind: "panic", message: "evaluation panicked: limit must be one" }), want: false, why: "a custom panic message is NOT assertion-shaped" },
    { d: diag(), want: false, why: "a plain type error (E0308) is NOT assertion-shaped" },
  ];
  for (const c of cases) {
    assert.strictEqual(oracle.isAssertionShaped(c.d), c.want, c.why);
  }
});

gtest("rung parity: oracle.buildTestCommand behaves exactly like the free export [surface §3 'behaves exactly like the free buildTestCommand export']", () => {
  const oracle = new RustOracle();
  assert.deepStrictEqual(oracle.buildTestCommand(CRATE, ""), { command: "cargo", args: ["test", "--lib"], cwd: CRATE }, "base shape: cargo test --lib, cwd crateRoot, no positional for empty filter");
  assert.deepStrictEqual(oracle.buildTestCommand(CRATE, "tests::adds"), buildTestCommand(CRATE, "tests::adds"), "single filter: identical to the free export");
  assert.deepStrictEqual(oracle.buildTestCommand(CRATE, "", { noRun: true }), buildTestCommand(CRATE, "", { noRun: true }), "noRun: identical to the free export");
  assert.deepStrictEqual(oracle.buildTestCommand(CRATE, ["tests::a", "", "tests::b"]), buildTestCommand(CRATE, ["tests::a", "", "tests::b"]), "filter array with empties: identical to the free export (empty filters dropped)");
});

gtest("rung parity: oracle.parseTestOutput behaves exactly like the free parseLibtestOutput [surface §3 'behaves exactly like the free parseLibtestOutput export']", () => {
  const oracle = new RustOracle();
  assert.deepStrictEqual(oracle.parseTestOutput(LIBTEST_MIXED), parseLibtestOutput(LIBTEST_MIXED), "a real mixed run parses identically");
  assert.deepStrictEqual(oracle.parseTestOutput(""), parseLibtestOutput(""), "the empty-input shape is identical");
});

// ===========================================================================
// 4. Orchestrators route through the strategy. [surface §4]
// ===========================================================================

gtest("runOracleCheck: success is EXACTLY what the strategy's checkSuccess returns, marker rule exitCode===42 [surface §4 'the result's success field is EXACTLY what oracle.checkSuccess(stdout, exitCode) returns']", async () => {
  let seen;
  const oracle = stubOracle({
    checkSuccess: (stdout, exitCode) => {
      seen = { stdout, exitCode };
      return exitCode === 42;
    },
  });
  const runCommand = async () => ({ stdout: "MARKER-STDOUT", exitCode: 42 });
  const result = await runOracleCheck(oracle, FILE, { runCommand });
  assert.ok(result, "a completed run resolves a result");
  assert.strictEqual(result.success, true, "exit 42 is success under the STUB's rule - cargo's rule would say failure");
  assert.deepStrictEqual(seen, { stdout: "MARKER-STDOUT", exitCode: 42 }, "the strategy received the raw stdout and exit code");

  const failing = await runOracleCheck(oracle, FILE, { runCommand: async () => ({ stdout: "", exitCode: 0 }) });
  assert.strictEqual(failing.success, false, "exit 0 is FAILURE under the stub's rule - proof the verdict routes through the strategy");
});

gtest("runTestOracle: command built via oracle.buildTestCommand, output parsed via oracle.parseTestOutput [surface §4 'builds its command via oracle.buildTestCommand and parses via oracle.parseTestOutput']", async () => {
  const calls = [];
  const oracle = stubOracle({
    buildTestCommand: (root, filter) => ({ command: "stubtest", args: ["--marker", String(filter)], cwd: root }),
    parseTestOutput: () => ({ ran: true, cases: [{ name: "stub::one", outcome: "pass" }], failures: [], passed: 7, failed: 0, ignored: 0 }),
  });
  const runCommand = async (cmd) => {
    calls.push(cmd);
    return { stdout: "raw stub output", stderr: "", exitCode: 0 };
  };
  const result = await runTestOracle(oracle, FILE, "tests::adds", { runCommand });
  assert.strictEqual(calls.length, 1, "the command runs once");
  assert.deepStrictEqual(
    { command: calls[0].command, args: calls[0].args, cwd: calls[0].cwd },
    { command: "stubtest", args: ["--marker", "tests::adds"], cwd: CRATE },
    "the runner received the STUB's command, not cargo's"
  );
  assert.ok(result, "a completed run resolves a result");
  assert.strictEqual(result.passed, 7, "the counts come from the STUB's parseTestOutput, not libtest parsing");
  assert.strictEqual(result.ran, true);
});

gtest("runTestOracle: an oracle with NO rung resolves undefined, never runs, logs a skip line with the language [surface §4 'When the oracle carries NO rung methods ... logs a skip line containing the oracle's language']", async () => {
  const oracle = stubOracle(); // no buildTestCommand / parseTestOutput
  const calls = [];
  const lines = [];
  const runCommand = async (cmd) => {
    calls.push(cmd);
    return { stdout: "", stderr: "", exitCode: 0 };
  };
  const result = await runTestOracle(oracle, FILE, "tests::adds", { runCommand, log: (l) => lines.push(l) });
  assert.strictEqual(result, undefined, "no rung -> undefined, not an error");
  assert.strictEqual(calls.length, 0, "runCommand is never invoked without a rung");
  assert.ok(lines.some((l) => l.includes("stublang")), `a logged skip line names the language, got ${JSON.stringify(lines)}`);
});

gtest("orchestrators unchanged: detectCrateRoot undefined -> both resolve undefined, runner untouched [surface §4 'both still resolve undefined when detectCrateRoot returns undefined']", async () => {
  const calls = [];
  const runCommand = async (cmd) => {
    calls.push(cmd);
    return { stdout: "", stderr: "", exitCode: 0 };
  };
  const rootless = stubOracle({
    detectCrateRoot: () => undefined,
    buildTestCommand: (root, filter) => ({ command: "stubtest", args: [], cwd: root }),
    parseTestOutput: () => ({ ran: false, cases: [], failures: [], passed: 0, failed: 0, ignored: 0 }),
  });
  assert.strictEqual(await runOracleCheck(rootless, FILE, { runCommand }), undefined, "runOracleCheck: no root -> undefined");
  assert.strictEqual(await runTestOracle(rootless, FILE, "f", { runCommand }), undefined, "runTestOracle: no root -> undefined");
  assert.strictEqual(calls.length, 0, "nothing ran either time");
});

gtest("orchestrators unchanged: they reject only when the runner itself rejects [surface §4 'both still reject only when the runner itself rejects']", async () => {
  const boom = async () => {
    throw new Error("runner exploded");
  };
  const oracle = stubOracle({
    buildTestCommand: (root) => ({ command: "stubtest", args: [], cwd: root }),
    parseTestOutput: () => ({ ran: false, cases: [], failures: [], passed: 0, failed: 0, ignored: 0 }),
  });
  await assert.rejects(() => runOracleCheck(oracle, FILE, { runCommand: boom }), /runner exploded/, "a rejecting runner rejects runOracleCheck");
  await assert.rejects(() => runTestOracle(oracle, FILE, "f", { runCommand: boom }), /runner exploded/, "a rejecting runner rejects runTestOracle");
});

// ===========================================================================
// 5. repair.ts - the two strategy hooks. [surface §5]
// ===========================================================================

gtest("classifyEligibility baseline (no hook): today's behavior - plain error eligible, assertion message refused [surface §5 'With no hook the behavior is today's, unchanged']", () => {
  const plain = classifyEligibility(diag(), SCOPE);
  assert.strictEqual(plain.eligible, true, "a plain in-scope compile error is eligible");

  const asserted = classifyEligibility(diag({ message: "assertion `left == right` failed" }), SCOPE);
  assert.strictEqual(asserted.eligible, false, "the built-in rustc text family refuses assertion messages");
  assert.strictEqual(asserted.reason, "assertion-failure");
});

gtest("classifyEligibility hook: false REPLACES the built-in text family - an assertion-message diagnostic becomes eligible [surface §5 'a hook returning false lets a rustc assertion-message diagnostic ... classify eligible']", () => {
  const d = diag({ message: "assertion `left == right` failed" });
  const r = classifyEligibility(d, SCOPE, { assertionShaped: () => false });
  assert.strictEqual(r.eligible, true, "the hook's verdict replaces the rustc text test entirely");
});

gtest("classifyEligibility hook: true refuses ANY diagnostic with reason 'assertion-failure' [surface §5 'a hook returning true refuses ANY diagnostic']", () => {
  const r = classifyEligibility(diag(), SCOPE, { assertionShaped: () => true });
  assert.strictEqual(r.eligible, false, "even a plain E0308 is refused when the hook says assertion-shaped");
  assert.strictEqual(r.reason, "assertion-failure");
});

gtest("classifyEligibility hook cannot override kind: 'assertion-failure' stays refused always [surface §5 'Exception the hook cannot override ... producer-assigned, zero-tolerance']", () => {
  const d = diag({ kind: "assertion-failure", message: "anything" });
  const r = classifyEligibility(d, SCOPE, { assertionShaped: () => false });
  assert.strictEqual(r.eligible, false, "producer-assigned kind wins over the hook");
  assert.strictEqual(r.reason, "assertion-failure");
});

gtest("RepairScope.resolvePath: replaces the Rust-shaped span resolution for the in-scope test [surface §5 'RepairScope gains optional resolvePath ... sees that span in-span']", () => {
  // A relative span fileName the Rust-shaped default resolves to
  // /w/crate/lib.rs (last-resort crateRoot join) - NOT the scope's file.
  const d = diag({ spans: [span({ fileName: "lib.rs" })] });

  const withoutHook = classifyEligibility(d, SCOPE);
  assert.strictEqual(withoutHook.eligible, false, "default Rust-shaped resolution puts the span in another file");
  assert.strictEqual(withoutHook.reason, "out-of-span");

  const withHook = classifyEligibility(d, { ...SCOPE, resolvePath: () => SCOPE.filePath });
  assert.strictEqual(withHook.eligible, true, "resolvePath mapping the span onto scope.filePath makes it in-span (bytes overlap)");
});

gtest("RepairSession 4th ctor param: hooks forwarded to every classify - assertionShaped true surfaces with why 'no-eligible' [surface §5 'RepairSession constructor gains an optional 4th parameter']", () => {
  const check = { success: false, diagnostics: [diag()], durationMs: 3, crateRoot: CRATE };

  const hooked = new RepairSession("fim", true, () => {}, { assertionShaped: () => true });
  const action = hooked.next(check, SCOPE);
  assert.strictEqual(action.kind, "surface", "with the hook refusing everything, the session surfaces");
  assert.strictEqual(action.why, "no-eligible", "the surface reason is no-eligible");

  // Control: the same input without hooks would otherwise repair, not surface
  // with no-eligible - proof the 4th param changed the classification.
  const bare = new RepairSession("fim", true, () => {});
  const bareAction = bare.next(check, SCOPE);
  assert.ok(
    !(bareAction.kind === "surface" && bareAction.why === "no-eligible"),
    `without hooks this compile error is eligible, got ${JSON.stringify(bareAction && { kind: bareAction.kind, why: bareAction.why })}`
  );
});
