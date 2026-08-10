// Integration-live oracle for P4 (the cargo test rung): drive REAL `cargo test`
// against a scratch crate and confirm runTestOracle reports the run honestly —
// pass, fail (with the captured assertion text), and a build failure. This is an
// EXECUTING oracle, so the goal's "trust the run, not the diff" applies: the
// injected-runner unit tests prove the wiring; this proves the real libtest text
// on this machine still parses. Requires cargo on PATH; skip with SKIP_LIVE=1.
//
// Run: node --test --test-concurrency=1 test/impl-v8-testrung-live.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { bundleCore } = require("./.blind-util.cjs");

const SKIP = process.env.SKIP_LIVE === "1" ? "SKIP_LIVE=1" : false;

const { mod, cleanup } = bundleCore(
  "impl-v8-testrung-live",
  `export { RustOracle, runTestOracle } from "../src/core/compilerOracle";\n`
);
const { RustOracle, runTestOracle } = mod;
test.after(cleanup);

// Build a throwaway crate with the given lib.rs body; returns its src/lib.rs path.
function scratchCrate(libBody) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "v8-testrung-"));
  fs.writeFileSync(path.join(dir, "Cargo.toml"), `[package]\nname = "trung"\nversion = "0.0.0"\nedition = "2021"\n`);
  fs.mkdirSync(path.join(dir, "src"));
  const libPath = path.join(dir, "src", "lib.rs");
  fs.writeFileSync(libPath, libBody);
  return { dir, libPath };
}

const PASS_AND_FAIL = `
pub fn add(a: i32, b: i32) -> i32 { a + b }

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn adds_ok() { assert_eq!(add(1, 2), 3); }
    #[test]
    fn adds_wrong() { assert_eq!(add(1, 2), 5); }
    #[test]
    #[ignore]
    fn skipped() { assert!(false); }
}
`;

test("real cargo test: a mixed pass/fail/ignore run is reported honestly", { skip: SKIP }, async () => {
  const { dir, libPath } = scratchCrate(PASS_AND_FAIL);
  try {
    const res = await runTestOracle(new RustOracle(), libPath, "tests::");
    assert.ok(res, "resolves a result inside a crate");
    assert.strictEqual(res.ran, true, "the test binary ran");
    assert.strictEqual(res.success, false, "a failing test makes the run unsuccessful");
    assert.strictEqual(res.passed, 1, "one test passed");
    assert.strictEqual(res.failed, 1, "one test failed");
    assert.strictEqual(res.ignored, 1, "one test ignored");
    const fail = res.failures.find((f) => f.name.includes("adds_wrong"));
    assert.ok(fail, "the failing test appears in failures");
    assert.match(fail.message, /assertion|left|right|panicked/i, "the captured message is the assertion/panic text");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("real cargo test: an all-pass run is success", { skip: SKIP }, async () => {
  const { dir, libPath } = scratchCrate(`
pub fn double(x: i32) -> i32 { x * 2 }
#[cfg(test)]
mod tests { use super::*; #[test] fn ok() { assert_eq!(double(2), 4); } }
`);
  try {
    const res = await runTestOracle(new RustOracle(), libPath, "tests::");
    assert.strictEqual(res.ran, true);
    assert.strictEqual(res.success, true, "all tests pass -> success");
    assert.strictEqual(res.failed, 0);
    assert.strictEqual(res.passed, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("real cargo test: a test that does not COMPILE is a build failure, not a test run", { skip: SKIP }, async () => {
  const { dir, libPath } = scratchCrate(`
#[cfg(test)]
mod tests { #[test] fn broken() { let x: i32 = "not an int"; assert!(x > 0); } }
`);
  try {
    const res = await runTestOracle(new RustOracle(), libPath, "tests::");
    assert.strictEqual(res.ran, false, "the binary never ran (compile error)");
    assert.strictEqual(res.success, false);
    assert.ok(res.buildError && res.buildError.length > 0, "the stderr compile error is surfaced as buildError");
    assert.match(res.buildError, /error\[E\d+\]|mismatched types|expected/i, "buildError carries the rustc error text");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
