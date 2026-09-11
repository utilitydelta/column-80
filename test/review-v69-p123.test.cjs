// ADVERSARIAL REVIEW of session-v69 phases 1, 2 and 3.
//
// Written by a reviewer who did not write the code. Every row here is evidence
// for one claim in the review report; nothing is asserted that was not run.
//
// Two kinds of row, labelled in the title so nobody has to guess:
//
//   [DEFECT] - a broken promise. The product does something it must not.
//   [WITNESS] - a COST the change imposes on a user, made visible as a red row
//               so it cannot be waved through. A human ruling, not a bug.
//   [SOLID] - something attacked and found correct. Green, and it stays green.
//
// Run: SKIP_LIVE=1 node --test test/review-v69-p123.test.cjs   (headless only)
//      node --test test/review-v69-p123.test.cjs               (with cargo/go)

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
    "review-v69-p123",
    `export { guardShadowedTestNames } from "../src/core/tddShadow";\n` +
      `export { withoutMarkedRegion, testMarkers } from "../src/core/testAssembly";\n` +
      `export { RustOracle } from "../src/core/compilerOracle";\n` +
      `export { GoOracle } from "../src/core/goOracle";\n`
  ));
} catch (e) {
  bundleError = e;
}
test.after(() => cleanupBundle());
const { guardShadowedTestNames, withoutMarkedRegion, RustOracle, GoOracle } = mod;

const gtest = (name, fn) =>
  test(name, (ctx) => {
    if (bundleError) return ctx.skip(`bundle failed to build: ${bundleError}`);
    return fn(ctx);
  });

const scratch = [];
test.after(() => {
  for (const d of scratch) fs.rmSync(d, { recursive: true, force: true });
});
function tempDir(tag) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), `c80-rev69-${tag}-${crypto.randomBytes(3).toString("hex")}-`));
  scratch.push(d);
  return d;
}

/** Run an oracle's OWN command and read its OWN verdict. */
function runCheck(oracle, root) {
  const cmd = oracle.buildCheckCommand(root);
  const res = spawnSync(cmd.command, cmd.args, {
    cwd: cmd.cwd ?? root,
    encoding: "utf8",
    timeout: 300_000,
    env: { ...process.env, ...(cmd.env ?? {}) },
  });
  const output = cmd.diagnosticsOnStderr
    ? [res.stdout ?? "", res.stderr ?? ""].filter((s) => s.length > 0).join("\n")
    : res.stdout ?? "";
  return {
    output,
    diagnostics: oracle.parseCheckOutput(output, root, Date.now()),
    success: oracle.checkSuccess(output, res.status ?? -1),
    exitCode: res.status,
  };
}

function runRaw(cmd, args, cwd, env) {
  const res = spawnSync(cmd, args, { cwd, encoding: "utf8", timeout: 300_000, env: { ...process.env, ...(env ?? {}) } });
  return { out: `${res.stdout ?? ""}${res.stderr ?? ""}`, status: res.status };
}

// ===========================================================================
// [DEFECT] The shadow guard renames declarations that do not shadow, and leaves
// their call sites behind. The guard's whole job is to stop the product writing
// code that will not compile, and on these two shapes it is the thing that makes
// the code not compile.
//
// In Rust an INHERENT METHOD and a TRAIT METHOD live in their type's namespace,
// not the module's. `impl Fixture { fn first_even(&self) }` does not shadow the
// free `first_even` at all. The guard renames it anyway (contract rule 1 reads
// "a declaration `fn <name>`", with no notion of an impl block), and contract
// rule 7 then guarantees the CALL SITE `f.first_even()` is left byte-identical.
//
// This is a CONTRACT defect, not a slip: rules 1 and 7 together specify the
// corruption, so the blind oracle's 62 rows agree with it.
// ===========================================================================

const RUST_INHERENT_IMPL = `#[cfg(test)]
mod tests {
    use super::*;
    struct Fixture { xs: Vec<i32> }
    impl Fixture {
        fn first_even(&self) -> Option<i32> { first_even(&self.xs) }
    }
    #[test]
    fn table() {
        let f = Fixture { xs: vec![1, 2] };
        assert_eq!(f.first_even(), Some(2));
    }
}
`;

const RUST_TRAIT_IMPL = `#[cfg(test)]
mod tests {
    use super::*;
    trait Evens { fn first_even(&self) -> Option<i32>; }
    impl Evens for Vec<i32> {
        fn first_even(&self) -> Option<i32> { first_even(self) }
    }
    #[test]
    fn table() { assert_eq!(vec![1, 2].first_even(), Some(2)); }
}
`;

const RUST_LIB_HEAD = `pub fn first_even(xs: &[i32]) -> Option<i32> {
    xs.iter().copied().find(|x| x % 2 == 0)
}

`;

gtest("[DEFECT R1] rust: an INHERENT impl method named after the target does not shadow it, and must not be renamed", () => {
  const r = guardShadowedTestNames("rust", RUST_INHERENT_IMPL, "first_even", "");
  assert.deepStrictEqual(
    r.renames,
    [],
    "an `impl Fixture { fn first_even }` lives in Fixture's namespace, so `use super::*` is untouched by it; " +
      "renaming it moves the declaration and leaves `f.first_even()` behind, which is E0599"
  );
  assert.strictEqual(r.text, RUST_INHERENT_IMPL, "and the text must come back byte-identical");
});

gtest("[DEFECT R2] rust: a TRAIT method and its impl get two DIFFERENT names, which is structurally impossible code", () => {
  const r = guardShadowedTestNames("rust", RUST_TRAIT_IMPL, "first_even", "");
  // The observed output is `trait Evens { fn first_even_test }` beside
  // `impl Evens for Vec<i32> { fn first_even_test_2 }`. Rule 5's "claim the
  // name so a second shadow gets a DIFFERENT one" is exactly what breaks it.
  const names = [...r.text.matchAll(/\bfn\s+([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]);
  const trait = names[0];
  const impl = names[1];
  assert.strictEqual(
    trait,
    impl,
    `a trait method and its implementation must carry the SAME name; the guard produced ` +
      `trait=${trait} impl=${impl}, which is E0407 + E0046`
  );
});

gtest("[DEFECT R3] rust: `fn r#first_even` IS the identifier `first_even` and shadows exactly as hard, and is missed", () => {
  const reply = `#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn r#first_even() {
        assert_eq!(first_even(&[1, 2]), Some(2));
    }
}
`;
  const r = guardShadowedTestNames("rust", reply, "first_even", "");
  assert.strictEqual(
    r.renames.length,
    1,
    "`r#first_even` and `first_even` are the same name in Rust; rustc reports the identical " +
      "E0061 + E0308 pair the dogfood run opened this session with, and the guard sees nothing"
  );
});

// ---- LIVE proof for R1, R2 and R3. The claims above are about rustc, so rustc
// gets to say them.

test("[DEFECT R1 live] rust: the model's own text COMPILES and the guard's output does NOT", { skip: SKIP_RUST }, (ctx) => {
  if (bundleError) return ctx.skip(`bundle failed: ${bundleError}`);
  const root = tempDir("r1");
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(path.join(root, "Cargo.toml"), `[package]\nname = "r1"\nversion = "0.1.0"\nedition = "2021"\n`);
  const oracle = new RustOracle();

  fs.writeFileSync(path.join(root, "src", "lib.rs"), RUST_LIB_HEAD + RUST_INHERENT_IMPL);
  const before = runCheck(oracle, root);
  assert.strictEqual(before.success, true, `the model's own text must compile: ${before.output.slice(0, 400)}`);

  const guarded = guardShadowedTestNames("rust", RUST_INHERENT_IMPL, "first_even", RUST_LIB_HEAD);
  fs.writeFileSync(path.join(root, "src", "lib.rs"), RUST_LIB_HEAD + guarded.text);
  const after = runCheck(oracle, root);
  assert.strictEqual(
    after.success,
    true,
    "the guard turned code that compiled into code that does not: " +
      after.diagnostics
        .filter((d) => d.level === "error")
        .map((d) => d.message.split("\n")[0])
        .join(" | ")
  );
});

test("[DEFECT R2 live] rust: the trait shape compiles before the guard and reports three errors after", { skip: SKIP_RUST }, (ctx) => {
  if (bundleError) return ctx.skip(`bundle failed: ${bundleError}`);
  const root = tempDir("r2");
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(path.join(root, "Cargo.toml"), `[package]\nname = "r2"\nversion = "0.1.0"\nedition = "2021"\n`);
  const oracle = new RustOracle();

  fs.writeFileSync(path.join(root, "src", "lib.rs"), RUST_LIB_HEAD + RUST_TRAIT_IMPL);
  assert.strictEqual(runCheck(oracle, root).success, true, "the model's own text must compile");

  const guarded = guardShadowedTestNames("rust", RUST_TRAIT_IMPL, "first_even", RUST_LIB_HEAD);
  fs.writeFileSync(path.join(root, "src", "lib.rs"), RUST_LIB_HEAD + guarded.text);
  const after = runCheck(oracle, root);
  const errs = after.diagnostics.filter((d) => d.level === "error");
  assert.strictEqual(
    errs.length,
    0,
    `the guard introduced ${errs.length} error(s): ${errs.map((d) => d.code ?? "?").join(", ")}`
  );
});

test("[DEFECT R3 live] rust: `fn r#first_even` really does shadow - rustc says E0061", { skip: SKIP_RUST }, (ctx) => {
  if (bundleError) return ctx.skip(`bundle failed: ${bundleError}`);
  const root = tempDir("r3");
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(path.join(root, "Cargo.toml"), `[package]\nname = "r3"\nversion = "0.1.0"\nedition = "2021"\n`);
  const reply = `#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn r#first_even() {
        assert_eq!(first_even(&[1, 2]), Some(2));
    }
}
`;
  const oracle = new RustOracle();
  const guarded = guardShadowedTestNames("rust", reply, "first_even", RUST_LIB_HEAD);
  fs.writeFileSync(path.join(root, "src", "lib.rs"), RUST_LIB_HEAD + guarded.text);
  const after = runCheck(oracle, root);
  const codes = after.diagnostics.filter((d) => d.level === "error").map((d) => d.code);
  assert.deepStrictEqual(
    codes,
    [],
    `the guard passed a shadowing raw identifier straight through; rustc: ${codes.join(", ")}`
  );
});

// ===========================================================================
// [DEFECT] `--all-targets` added TARGETS whose failure can abort the build
// before the lib-test target is ever checked, so the generated test's own error
// is never reported. Under the old command there was one unit and nothing could
// pre-empt it.
//
// cargo prints "build failed, waiting for other jobs to finish" and starts no
// further units. With `jobs = 1` - a normal setting on a constrained machine,
// and settable in the USER's ~/.cargo/config.toml as well as the crate's - one
// unrelated broken example is enough, deterministically.
//
// The downstream reading is what makes this expensive: the only errors that
// come back are out of span, so spanScopedVerdict says `clean-out-of-span` and
// the human is told "no error landed inside `first_even`; 1 error remains
// outside the touched span, in e1.rs" while the test this product just wrote
// does not compile. That is the session's own defect in a new coat.
// ===========================================================================

test("[DEFECT R4] rust: an unrelated broken example can pre-empt the lib-test unit, so the generated test's error is never reported", { skip: SKIP_RUST }, (ctx) => {
  if (bundleError) return ctx.skip(`bundle failed: ${bundleError}`);
  const root = tempDir("r4");
  fs.mkdirSync(path.join(root, "src"));
  fs.mkdirSync(path.join(root, "examples"));
  fs.mkdirSync(path.join(root, ".cargo"));
  fs.writeFileSync(path.join(root, "Cargo.toml"), `[package]\nname = "r4"\nversion = "0.1.0"\nedition = "2021"\n`);
  fs.writeFileSync(path.join(root, ".cargo", "config.toml"), `[build]\njobs = 1\n`);
  // The product's own generated test, shadowing its target: the exact dogfood shape.
  fs.writeFileSync(
    path.join(root, "src", "lib.rs"),
    RUST_LIB_HEAD +
      `#[cfg(test)]\nmod tests {\n    use super::*;\n    #[test]\n    fn first_even() {\n        assert_eq!(first_even(&[1, 2]), Some(2));\n    }\n}\n`
  );
  // The user's own half-finished example, nothing to do with this product.
  fs.writeFileSync(path.join(root, "examples", "e1.rs"), `fn main() { let x: u32 = "no"; println!("{}", x); }\n`);
  const after = runCheck(new RustOracle(), root);
  const codes = after.diagnostics.filter((d) => d.level === "error").map((d) => d.code ?? "-");
  assert.ok(
    codes.includes("E0061"),
    `the generated test's own error must survive an unrelated target's failure; cargo reported ` +
      `only [${codes.join(", ")}] and stopped before the lib-test unit`
  );
});

// ===========================================================================
// [DEFECT] The Go surface still says "go build" when the command is
// `go test -c`. checkLabel is what the human reads on the edit-site decoration
// (`${oracle.checkLabel}: N error(s)`) and describeCheckFailure is the status
// bar sentence when the check crashes. On an old toolchain the crash sentence
// is the ONLY thing the human gets, and it names a command that did not run.
// ===========================================================================

gtest("[DEFECT G1] go: checkLabel names the command the human sees on the decoration, and it is stale", () => {
  const oracle = new GoOracle({ fileExists: () => true });
  const cmd = oracle.buildCheckCommand(path.join(path.sep, "w", "proj"));
  assert.ok(
    cmd.args.join(" ").startsWith(oracle.checkLabel.replace(/^go\s+/, "")) ||
      oracle.checkLabel === `go ${cmd.args[0]}`,
    `the decoration reads "${oracle.checkLabel}: N error(s)" while the command run was ` +
      `"go ${cmd.args.join(" ")}" - a human who copies the label to reproduce it gets a clean build`
  );
});

gtest("[DEFECT G2] go: describeCheckFailure names `go build` for a `go test -c` failure", () => {
  const oracle = new GoOracle({ fileExists: () => true });
  const said = oracle.describeCheckFailure(2, "go: cannot use -c flag with multiple packages");
  assert.ok(
    !/go build/.test(said),
    `the only sentence a crashed check gives the human is "${said}", and no go build ran`
  );
});

gtest("[DEFECT G3] go: an old toolchain's refusal parses as a file-less compile error, not a crashed check", () => {
  // Go 1.20 and older: `base.Fatalf("cannot use -c flag with multiple packages")`,
  // which cmd/go prints with its own `go: ` log prefix. Multi-package `go test -c`
  // landed in Go 1.21 (Aug 2023). The exact text is quoted from
  // $GOROOT/src/cmd/go/internal/test/test.go; what this row proves is what the
  // PRODUCT does with it.
  const oracle = new GoOracle({ fileExists: () => true });
  const old = "go: cannot use -c flag with multiple packages\n";
  const diags = oracle.parseCheckOutput(old, path.join(path.sep, "w", "proj"), Date.now());
  assert.deepStrictEqual(
    diags,
    [],
    "a go-command USAGE refusal must reach describeCheckFailure (which needs zero parseable " +
      "diagnostics), not become a span-less compile error that paints `go build: 1 error(s)` " +
      "on the accepted line of every Go generation forever"
  );
});

// ===========================================================================
// [WITNESS] What the widening now reports that it did not before. Neither row
// is a bug in the change; both are costs a human has to rule on, and a red row
// is the only way to make a cost visible.
// ===========================================================================

test("[WITNESS W1] rust: a pre-existing broken example or bench now reports on EVERY accept", { skip: SKIP_RUST }, (ctx) => {
  if (bundleError) return ctx.skip(`bundle failed: ${bundleError}`);
  const root = tempDir("w1");
  fs.mkdirSync(path.join(root, "src"));
  fs.mkdirSync(path.join(root, "examples"));
  fs.writeFileSync(path.join(root, "Cargo.toml"), `[package]\nname = "w1"\nversion = "0.1.0"\nedition = "2021"\n`);
  fs.writeFileSync(path.join(root, "src", "lib.rs"), RUST_LIB_HEAD);
  // The user's own half-finished example. Nothing to do with this product.
  fs.writeFileSync(path.join(root, "examples", "demo.rs"), `fn main() {\n    let x: u32 = "not a number";\n    println!("{}", x);\n}\n`);
  const after = runCheck(new RustOracle(), root);
  const errs = after.diagnostics.filter((d) => d.level === "error");
  assert.strictEqual(
    errs.length,
    0,
    `the crate's LIBRARY is clean, and the accepted function's line will now read ` +
      `"cargo check: ${errs.length} error(s)" because examples/demo.rs does not compile`
  );
});

test("[WITNESS W2] go: a test-only dependency outside the module cache turns a clean module red", { skip: SKIP_GO }, (ctx) => {
  if (bundleError) return ctx.skip(`bundle failed: ${bundleError}`);
  const root = tempDir("w2");
  fs.mkdirSync(path.join(root, "lib"));
  fs.writeFileSync(path.join(root, "go.mod"), `module w2\n\ngo 1.21\n\nrequire github.com/nonexistent/testonlydep v1.0.0\n`);
  fs.writeFileSync(path.join(root, "lib", "l.go"), `package lib\n\nfunc L() int { return 1 }\n`);
  fs.writeFileSync(
    path.join(root, "lib", "l_test.go"),
    `package lib\n\nimport (\n\t"testing"\n\n\t"github.com/nonexistent/testonlydep"\n)\n\nfunc TestL(t *testing.T) { _ = testonlydep.X; _ = L() }\n`
  );
  // The OLD command's verdict on the same tree, for the record.
  const old = runRaw("go", ["build", "-o", os.devNull, "./..."], root, { GOPROXY: "off", GOWORK: "off", GOENV: "off" });
  assert.strictEqual(old.status, 0, "the old command was clean here");

  const after = runCheck(new GoOracle(), root);
  const errs = after.diagnostics.filter((d) => d.level === "error");
  assert.strictEqual(
    errs.length,
    0,
    `GOPROXY=off means the check can never fetch a test-only dependency, so a module the old ` +
      `command called clean now reports ${errs.length} error(s) on every accept: ` +
      errs.map((d) => d.message.slice(0, 90)).join(" | ")
  );
});

// ===========================================================================
// [SOLID] Attacked and correct. These rows stay green; they are the record of
// what the review could not break.
// ===========================================================================

gtest("[SOLID S1] the guard is idempotent over its own output, on the dogfood shape and the multi-shadow shape", () => {
  for (const reply of [
    `#[cfg(test)]\nmod tests {\n    use super::*;\n    #[test]\n    fn first_even() { assert_eq!(first_even(&[1,2]), Some(2)); }\n}\n`,
    `#[cfg(test)]\nmod tests {\n    use super::*;\n    #[test]\n    fn first_even() { assert_eq!(first_even(&[1,2]), Some(2)); }\n    #[test]\n    fn first_even() { assert_eq!(first_even(&[]), None); }\n}\n`,
  ]) {
    const once = guardShadowedTestNames("rust", reply, "first_even", "");
    const twice = guardShadowedTestNames("rust", once.text, "first_even", "");
    assert.strictEqual(twice.text, once.text);
    assert.deepStrictEqual(twice.renames, []);
  }
});

gtest("[SOLID S2] rust: a raw string and a doc comment holding `fn first_even` are not declarations", () => {
  const reply = `#[cfg(test)]
mod tests {
    use super::*;
    /// calls fn first_even under test
    const SRC: &str = r#"fn first_even() {}"#;
    #[test]
    fn t() { let _ = SRC; assert_eq!(first_even(&[1, 2]), Some(2)); }
}
`;
  const r = guardShadowedTestNames("rust", reply, "first_even", "");
  assert.deepStrictEqual(r.renames, []);
  assert.strictEqual(r.text, reply);
});

gtest("[SOLID S3] python: a column-zero `def` inside a triple-quoted string is not a declaration, and `async def` is", () => {
  const inString = `DOC = """\ndef first_even():\n    pass\n"""\n\ndef test_it():\n    assert first_even([1, 2]) == 2\n`;
  assert.deepStrictEqual(guardShadowedTestNames("python", inString, "first_even", "").renames, []);
  const asyncDef = `import pytest\n\nasync def first_even():\n    assert first_even([1, 2]) == 2\n`;
  assert.deepStrictEqual(guardShadowedTestNames("python", asyncDef, "first_even", "").renames, [
    { from: "first_even", to: "test_first_even" },
  ]);
});

gtest("[SOLID S4] withoutMarkedRegion strips the previous generation's region, so a regen does not climb `_test_2`", () => {
  const gen1 = guardShadowedTestNames(
    "rust",
    `#[cfg(test)]\nmod tests {\n    use super::*;\n    #[test]\n    fn first_even() { assert_eq!(first_even(&[1,2]), Some(2)); }\n}\n`,
    "first_even",
    RUST_LIB_HEAD
  );
  assert.deepStrictEqual(gen1.renames, [{ from: "first_even", to: "first_even_test" }]);
  // What the file looks like after generation 1 landed, markers and all.
  const landed = `${RUST_LIB_HEAD}// column80-tests:first_even:begin\n${gen1.text}// column80-tests:first_even:end\n`;
  const gen2Naive = guardShadowedTestNames(
    "rust",
    `#[cfg(test)]\nmod tests {\n    use super::*;\n    #[test]\n    fn first_even() { assert_eq!(first_even(&[1,2]), Some(2)); }\n}\n`,
    "first_even",
    landed
  );
  assert.deepStrictEqual(gen2Naive.renames, [{ from: "first_even", to: "first_even_test_2" }], "the climb, without the strip");
  const gen2 = guardShadowedTestNames(
    "rust",
    `#[cfg(test)]\nmod tests {\n    use super::*;\n    #[test]\n    fn first_even() { assert_eq!(first_even(&[1,2]), Some(2)); }\n}\n`,
    "first_even",
    withoutMarkedRegion(landed, "first_even", "//")
  );
  assert.deepStrictEqual(gen2.renames, [{ from: "first_even", to: "first_even_test" }], "with the strip, generation 2 gets the same name");
});

test("[SOLID S5] rust: `[lib] test = false` does NOT defeat --all-targets - the cfg(test) mod is still checked", { skip: SKIP_RUST }, (ctx) => {
  if (bundleError) return ctx.skip(`bundle failed: ${bundleError}`);
  const root = tempDir("s5");
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(path.join(root, "Cargo.toml"), `[package]\nname = "s5"\nversion = "0.1.0"\nedition = "2021"\n\n[lib]\ntest = false\n`);
  fs.writeFileSync(
    path.join(root, "src", "lib.rs"),
    RUST_LIB_HEAD +
      `#[cfg(test)]\nmod tests {\n    use super::*;\n    #[test]\n    fn first_even() {\n        assert_eq!(first_even(&[1, 2]), Some(2));\n    }\n}\n`
  );
  const after = runCheck(new RustOracle(), root);
  assert.strictEqual(after.success, false, "the shadow must still be caught with test = false in the manifest");
  assert.ok(
    after.diagnostics.some((d) => d.code === "E0061"),
    `E0061 expected, got ${after.diagnostics.map((d) => d.code).join(", ")}`
  );
});

test("[SOLID S6] go: `go test -c` writes nothing into the tree and runs neither init nor TestMain", { skip: SKIP_GO }, (ctx) => {
  if (bundleError) return ctx.skip(`bundle failed: ${bundleError}`);
  const root = tempDir("s6");
  const witness = path.join(root, "..", `c80-rev69-witness-${crypto.randomBytes(3).toString("hex")}`);
  fs.mkdirSync(path.join(root, "sidefx"));
  fs.writeFileSync(path.join(root, "go.mod"), `module s6\n\ngo 1.21\n`);
  fs.writeFileSync(
    path.join(root, "sidefx", "s.go"),
    `package sidefx\n\nimport "os"\n\nfunc init() { _ = os.WriteFile(${JSON.stringify(`${witness}.init`)}, []byte("x"), 0o644) }\n\nfunc S() int { return 1 }\n`
  );
  fs.writeFileSync(
    path.join(root, "sidefx", "s_test.go"),
    `package sidefx\n\nimport (\n\t"os"\n\t"testing"\n)\n\nfunc TestMain(m *testing.M) {\n\t_ = os.WriteFile(${JSON.stringify(`${witness}.main`)}, []byte("x"), 0o644)\n\tos.Exit(m.Run())\n}\n\nfunc TestS(t *testing.T) { _ = S() }\n`
  );
  const before = fs.readdirSync(path.join(root, "sidefx")).sort();
  const after = runCheck(new GoOracle(), root);
  assert.strictEqual(after.success, true, `the module compiles: ${after.output.slice(0, 300)}`);
  assert.deepStrictEqual(fs.readdirSync(path.join(root, "sidefx")).sort(), before, "no binary dropped in the package dir");
  assert.strictEqual(fs.existsSync(`${witness}.init`), false, "init must not run on a keystroke path");
  assert.strictEqual(fs.existsSync(`${witness}.main`), false, "TestMain must not run on a keystroke path");
  for (const f of [`${witness}.init`, `${witness}.main`]) fs.rmSync(f, { force: true });
});

test("[SOLID S7] go: an EXTERNAL test package (`package foo_test`) is caught, which the old command could not see", { skip: SKIP_GO }, (ctx) => {
  if (bundleError) return ctx.skip(`bundle failed: ${bundleError}`);
  const root = tempDir("s7");
  fs.mkdirSync(path.join(root, "ext"));
  fs.writeFileSync(path.join(root, "go.mod"), `module s7\n\ngo 1.21\n`);
  fs.writeFileSync(path.join(root, "ext", "b.go"), `package ext\n\nfunc B() int { return 1 }\n`);
  fs.writeFileSync(
    path.join(root, "ext", "b_x_test.go"),
    `package ext_test\n\nimport "testing"\n\nfunc TestB(t *testing.T) { undefinedThing() }\n`
  );
  const old = runRaw("go", ["build", "-o", os.devNull, "./..."], root, { GOPROXY: "off", GOWORK: "off", GOENV: "off" });
  assert.strictEqual(old.status, 0, "the old command saw nothing here");
  const after = runCheck(new GoOracle(), root);
  assert.strictEqual(after.success, false, "the new command sees it");
  assert.ok(
    after.diagnostics.some((d) => /undefinedThing/.test(d.message)),
    `got ${JSON.stringify(after.diagnostics.map((d) => d.message))}`
  );
});
