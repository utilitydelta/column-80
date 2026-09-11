// LIVE falsification for session-v69 phases 2 and 3: the check the product runs
// must COMPILE the test code the product writes.
//
// The whole session exists because a check reported clean over code it could not
// see, so a headless fixture proves nothing here. Every row below spawns the
// REAL toolchain through the oracle's own buildCheckCommand / parseCheckOutput /
// checkSuccess, against a throwaway module in a temp dir.
//
// Each language gets the pair, in this order, because the pass direction alone
// is worthless: RED on known-bad test code FIRST, then GREEN on the same tree
// with the defect removed. A checker that always reports errors would pass half
// of this file.
//
// Skip with SKIP_LIVE, or automatically when the toolchain is absent.
//
// Run: node --test test/impl-v69-p23-check-sees-tests-live.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const os = require("os");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const { bundleCore } = require("./.blind-util.cjs");

const GO_BIN_DIR = "/home/utilitydelta/.local/go/bin";
process.env.PATH = `${GO_BIN_DIR}:${process.env.PATH || ""}`;

const has = (bin) => spawnSync(bin, ["version"], { encoding: "utf8" }).status === 0;
const SKIP_ALL = process.env.SKIP_LIVE ? "SKIP_LIVE set" : false;
const SKIP_RUST = SKIP_ALL || (has("cargo") ? false : "cargo absent");
const SKIP_GO = SKIP_ALL || (has("go") ? false : "go absent");

let mod = {};
let cleanupBundle = () => {};
let bundleError;
try {
  ({ mod, cleanup: cleanupBundle } = bundleCore(
    "impl-v69-p23-live",
    `export { RustOracle } from "../src/core/compilerOracle";\n` +
      `export { GoOracle } from "../src/core/goOracle";\n`
  ));
} catch (e) {
  bundleError = e;
}
test.after(() => cleanupBundle());
const { RustOracle, GoOracle } = mod;

const scratch = [];
test.after(() => {
  for (const d of scratch) fs.rmSync(d, { recursive: true, force: true });
});
function tempDir(tag) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), `c80-v69-${tag}-${crypto.randomBytes(3).toString("hex")}-`));
  scratch.push(d);
  return d;
}

/** Run the oracle's OWN command and read its OWN verdict. Nothing here builds a
 *  command by hand: a re-derived command is a fact about the harness. */
function runCheck(oracle, root) {
  const cmd = oracle.buildCheckCommand(root);
  const res = spawnSync(cmd.command, cmd.args, {
    cwd: cmd.cwd ?? root,
    encoding: "utf8",
    timeout: 180_000,
    env: { ...process.env, ...(cmd.env ?? {}) },
  });
  const output = cmd.diagnosticsOnStderr
    ? [res.stdout ?? "", res.stderr ?? ""].filter((s) => s.length > 0).join("\n")
    : res.stdout ?? "";
  return {
    output,
    diagnostics: oracle.parseCheckOutput(output, root, Date.now()),
    success: oracle.checkSuccess(output, res.status ?? -1),
    raw: res,
  };
}

const errorsOf = (r) => r.diagnostics.filter((d) => d.level === "error");

// ---------------------------------------------------------------------------
// Rust. The exact defect from the dogfood run that opened this session: a
// generated `#[test] fn first_even` inside `mod tests { use super::*; }`, so the
// loop calls the TEST with an argument.
// ---------------------------------------------------------------------------

const RUST_LIB = (testFnName) => `pub fn first_even(xs: &[i32]) -> Option<i32> {
    xs.iter().copied().find(|x| x % 2 == 0)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn ${testFnName}() {
        let cases = [(&[1i32, 3, 5][..], None), (&[2, 4][..], Some(2))];
        for (xs, expected) in cases {
            assert_eq!(first_even(xs), expected);
        }
    }
}
`;

function rustCrate(testFnName) {
  const d = tempDir("rust");
  fs.writeFileSync(
    path.join(d, "Cargo.toml"),
    `[package]\nname = "probe"\nversion = "0.1.0"\nedition = "2021"\n[workspace]\n`
  );
  fs.mkdirSync(path.join(d, "src"));
  fs.writeFileSync(path.join(d, "src", "lib.rs"), RUST_LIB(testFnName));
  return d;
}

test("[P2 live] rust: the check is RED on a test that shadows its target", { skip: SKIP_RUST }, () => {
  assert.strictEqual(bundleError, undefined, `bundle failed: ${bundleError}`);
  const r = runCheck(new RustOracle(), rustCrate("first_even"));
  assert.strictEqual(r.success, false, `the check must fail on this tree. Output:\n${r.output}`);
  const codes = errorsOf(r).map((d) => d.code);
  assert.ok(codes.includes("E0061"), `E0061 (wrong arity) expected, got ${JSON.stringify(codes)}`);
  assert.ok(codes.includes("E0308"), `E0308 (mismatched types) expected, got ${JSON.stringify(codes)}`);
});

test("[P2 live] rust: the same tree with the test renamed is GREEN", { skip: SKIP_RUST }, () => {
  const r = runCheck(new RustOracle(), rustCrate("first_even_test"));
  assert.strictEqual(r.success, true, `the check must pass once the shadow is gone. Output:\n${r.output}`);
  assert.deepStrictEqual(errorsOf(r), []);
});

test("[P2 live] rust: the diagnostic's span names the FILE the test lives in", { skip: SKIP_RUST }, () => {
  const root = rustCrate("first_even");
  const r = runCheck(new RustOracle(), root);
  const errs = errorsOf(r);
  assert.ok(errs.length > 0);
  for (const d of errs) {
    const primary = d.spans.find((s) => s.isPrimary);
    assert.ok(primary, `every error carries a primary span, got ${JSON.stringify(d.spans)}`);
    assert.ok(
      new RustOracle().resolveDiagnosticPath(root, primary.fileName).endsWith(path.join("src", "lib.rs")),
      `the span resolves to the source file, got ${primary.fileName}`
    );
    assert.ok(primary.byteStart >= 0, "and it carries a usable byte offset, not the -1 sentinel");
  }
});

test("[P2 live] rust: cfg(not(test)) code is STILL checked - the widening is a superset", { skip: SKIP_RUST }, () => {
  // The reason the command is --all-targets rather than --tests. `--tests` does
  // not check the plain lib build, so this error would vanish: a widening that
  // opens a new way to report clean.
  const d = rustCrate("first_even_test");
  fs.appendFileSync(
    path.join(d, "src", "lib.rs"),
    `\n#[cfg(not(test))]\npub fn only_outside_test() -> u32 {\n    let x: u32 = "not a number";\n    x\n}\n`
  );
  const r = runCheck(new RustOracle(), d);
  assert.strictEqual(r.success, false, `output:\n${r.output}`);
  assert.ok(
    errorsOf(r).some((e) => e.code === "E0308"),
    `E0308 from the cfg(not(test)) body expected, got ${JSON.stringify(errorsOf(r).map((e) => e.code))}`
  );
});

// ---------------------------------------------------------------------------
// Go. The product writes `foo_test.go` beside the source, in the same package.
// `go build` never compiles it.
// ---------------------------------------------------------------------------

function goModule(files) {
  const d = tempDir("go");
  fs.writeFileSync(path.join(d, "go.mod"), "module probe\n\ngo 1.22\n");
  for (const [rel, body] of Object.entries(files)) {
    const p = path.join(d, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body);
  }
  return d;
}

const GO_LIB = `package probe

func FirstEven(xs []int) (int, bool) {
	for _, x := range xs {
		if x%2 == 0 {
			return x, true
		}
	}
	return 0, false
}
`;

test("[P3 live] go: the check is RED on a _test.go that does not compile", { skip: SKIP_GO }, () => {
  const root = goModule({
    "lib.go": GO_LIB,
    "lib_test.go": `package probe

import "testing"

func TestFirstEven(t *testing.T) {
	got, ok := FirstEven([]int{1, 2, 3}, 99)
	if !ok || got != undefinedThing {
		t.Fatalf("bad")
	}
}
`,
  });
  const r = runCheck(new GoOracle(), root);
  assert.strictEqual(r.success, false, `the check must fail. Output:\n${r.output}`);
  const errs = errorsOf(r);
  assert.ok(errs.length >= 2, `both planted errors reach the parser, got ${errs.length}:\n${r.output}`);
  assert.ok(
    errs.some((e) => /too many arguments/.test(e.message)),
    `the arity error, got ${JSON.stringify(errs.map((e) => e.message))}`
  );
  assert.ok(
    errs.some((e) => /undefined: undefinedThing/.test(e.message)),
    `the undefined-identifier error, got ${JSON.stringify(errs.map((e) => e.message))}`
  );
  for (const e of errs) {
    const primary = e.spans.find((s) => s.isPrimary);
    assert.ok(primary && /lib_test\.go$/.test(primary.fileName), `named the test file, got ${primary && primary.fileName}`);
    assert.ok(primary.byteStart >= 0, "with a usable byte offset");
  }
});

test("[P3 live] go: the same module with a compiling test is GREEN", { skip: SKIP_GO }, () => {
  const root = goModule({
    "lib.go": GO_LIB,
    "lib_test.go": `package probe

import "testing"

func TestFirstEven(t *testing.T) {
	if got, ok := FirstEven([]int{1, 2, 3}); !ok || got != 2 {
		t.Fatalf("bad")
	}
}
`,
  });
  const r = runCheck(new GoOracle(), root);
  assert.strictEqual(r.success, true, `output:\n${r.output}`);
  assert.deepStrictEqual(errorsOf(r), [], `the "[no test files]" inventory lines are not diagnostics`);
});

test("[P3 live] go: a package with NO test files is still checked - the widening is a superset", { skip: SKIP_GO }, () => {
  const root = goModule({
    "lib.go": GO_LIB,
    "notests/x.go": `package notests

func Broken() int {
	var s string = 5
	return s
}
`,
    "cmd/app/main.go": `package main

func main() {
	var s string = 7
	_ = s
}
`,
  });
  const r = runCheck(new GoOracle(), root);
  assert.strictEqual(r.success, false, `output:\n${r.output}`);
  const files = errorsOf(r).map((e) => (e.spans.find((s) => s.isPrimary) || {}).fileName);
  assert.ok(files.some((f) => /notests[\\/]x\.go$/.test(f)), `the library package with no tests, got ${JSON.stringify(files)}`);
  assert.ok(files.some((f) => /cmd[\\/]app[\\/]main\.go$/.test(f)), `the main package, got ${JSON.stringify(files)}`);
});

test("[P3 live] go: the check COMPILES the test binary and does not RUN it", { skip: SKIP_GO }, () => {
  // A check on a keystroke path must not execute the user's package init or
  // TestMain. `go test -run='^$'` was rejected for exactly this.
  const marker = path.join(tempDir("gorun"), "ran.txt");
  const root = goModule({
    "lib.go": GO_LIB,
    "lib_test.go": `package probe

import (
	"os"
	"testing"
)

func init() { _ = os.WriteFile(${JSON.stringify(marker)}, []byte("ran"), 0o644) }

func TestFirstEven(t *testing.T) {
	if _, ok := FirstEven([]int{2}); !ok {
		t.Fatalf("bad")
	}
}
`,
  });
  const r = runCheck(new GoOracle(), root);
  assert.strictEqual(r.success, true, `output:\n${r.output}`);
  assert.strictEqual(fs.existsSync(marker), false, "the test binary's init must not have run");
});
