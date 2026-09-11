// Implementer's white-box tests for session-v69 phase 1, the shadow guard.
// Written WITH the implementation in view, so it pins the mechanism rather than
// the contract: the neutralisation lens each language gets, the offset splice,
// and the all-or-nothing refusal. The blind oracle's file
// (blind-v69-p1-shadow-guard.test.cjs) is the contract half and is authored
// without reading src/**.
//
// Run: SKIP_LIVE=1 node --test test/impl-v69-p1-shadow-guard.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

let mod = {};
let cleanup = () => {};
let bundleError;
try {
  ({ mod, cleanup } = bundleCore(
    "impl-v69-p1-shadow-guard",
    `export { guardShadowedTestNames } from "../src/core/tddShadow";\n`
  ));
} catch (e) {
  bundleError = e;
}
test.after(() => cleanup());
const { guardShadowedTestNames } = mod;

const gtest = (name, fn) =>
  test(name, (ctx) => {
    if (bundleError) return ctx.skip("bundle failed to build; see the bundle test");
    return fn(ctx);
  });

test("bundle: tddShadow builds and exports guardShadowedTestNames", () => {
  assert.strictEqual(bundleError, undefined, `bundle failed: ${bundleError}`);
  assert.strictEqual(typeof guardShadowedTestNames, "function");
});

// The reply from the dogfood run that opened this session, byte for byte in
// shape: one #[test] named after the target, calling the target inside a loop.
const DOGFOOD_RUST = `#[test]
fn first_even() {
    let cases = [
        (&[1i32, 3, 5][..], None),
        (&[2, 4][..], Some(2)),
    ];
    for (xs, expected) in cases {
        assert_eq!(first_even(xs), expected);
    }
}`;

gtest("[impl P1] rust: the dogfood reply's declaration moves and its call does not", () => {
  const r = guardShadowedTestNames("rust", DOGFOOD_RUST, "first_even", "");
  assert.deepStrictEqual([...r.refusals], []);
  assert.deepStrictEqual([...r.renames], [{ from: "first_even", to: "first_even_test" }]);
  assert.match(r.text, /fn first_even_test\(\)/);
  assert.ok(!/fn first_even\(\)/.test(r.text), "the shadowing declaration is gone");
  assert.match(r.text, /assert_eq!\(first_even\(xs\), expected\)/);
  // Length moved by exactly the rename, so nothing else in the text was touched.
  assert.strictEqual(r.text.length, DOGFOOD_RUST.length + "_test".length);
});

gtest("[impl P1] rust: the renamed text really does compile the call as the target", () => {
  // The mechanism, stated as a byte fact: every occurrence of `first_even`
  // except the one at the declaration site survives.
  const r = guardShadowedTestNames("rust", DOGFOOD_RUST, "first_even", "");
  const before = (DOGFOOD_RUST.match(/first_even/g) || []).length;
  const after = (r.text.match(/\bfirst_even\b/g) || []).length;
  assert.strictEqual(before, 2);
  assert.strictEqual(after, 1);
});

gtest("[impl P1] rust: a helper fn with the target's name is renamed too", () => {
  const src = `#[test]
fn checks() { assert_eq!(first_even(&[]), None); }

fn first_even(xs: &[i32]) -> Option<i32> { None }`;
  const r = guardShadowedTestNames("rust", src, "first_even", "");
  assert.strictEqual(r.renames.length, 1);
  assert.match(r.text, /fn first_even_test\(xs: &\[i32\]\)/);
});

gtest("[impl P1] rust: two shadowing declarations get two distinct names", () => {
  const src = `fn first_even() {}\nfn first_even() {}\n`;
  const r = guardShadowedTestNames("rust", src, "first_even", "");
  assert.deepStrictEqual(
    r.renames.map((x) => x.to),
    ["first_even_test", "first_even_test_2"]
  );
  assert.match(r.text, /fn first_even_test\(\) \{\}\nfn first_even_test_2\(\) \{\}/);
});

gtest("[impl P1] rust: a name already used in the reply is skipped", () => {
  const src = `fn first_even() { let first_even_test = 1; }`;
  const r = guardShadowedTestNames("rust", src, "first_even", "");
  assert.deepStrictEqual([...r.renames], [{ from: "first_even", to: "first_even_test_2" }]);
});

gtest("[impl P1] rust: a name declared in the existing file is skipped", () => {
  const src = `fn first_even() {}`;
  const existing = `#[cfg(test)]\nmod tests {\n  fn first_even_test() {}\n}\n`;
  const r = guardShadowedTestNames("rust", src, "first_even", existing);
  assert.deepStrictEqual([...r.renames], [{ from: "first_even", to: "first_even_test_2" }]);
});

gtest("[impl P1] rust: the lens blanks comments and strings, so neither declares", () => {
  const src = `// fn first_even() {}\nlet s = "fn first_even() {}";\nfn keeps() {}`;
  const r = guardShadowedTestNames("rust", src, "first_even", "");
  assert.strictEqual(r.text, src);
  assert.deepStrictEqual([...r.renames], []);
});

gtest("[impl P1] rust: idempotent over its own output", () => {
  const once = guardShadowedTestNames("rust", DOGFOOD_RUST, "first_even", "");
  const twice = guardShadowedTestNames("rust", once.text, "first_even", "");
  assert.strictEqual(twice.text, once.text);
  assert.deepStrictEqual([...twice.renames], []);
});

gtest("[impl P1] python: a column-zero def named after the target is renamed", () => {
  const src = `from mod import *\n\ndef first_even(xs):\n    assert first_even(xs) == 2\n`;
  const r = guardShadowedTestNames("python", src, "first_even", "");
  assert.deepStrictEqual([...r.renames], [{ from: "first_even", to: "test_first_even" }]);
  assert.match(r.text, /^def test_first_even\(xs\):$/m);
  assert.match(r.text, /assert first_even\(xs\) == 2/);
});

gtest("[impl P1] python: an INDENTED def shadows nothing and is left alone", () => {
  const src = `class T:\n    def first_even(self):\n        pass\n`;
  const r = guardShadowedTestNames("python", src, "first_even", "");
  assert.strictEqual(r.text, src);
  assert.deepStrictEqual([...r.renames], []);
});

gtest("[impl P1] python: a def inside a docstring is not a declaration", () => {
  const src = `"""\ndef first_even(xs):\n    pass\n"""\ndef test_ok():\n    pass\n`;
  const r = guardShadowedTestNames("python", src, "first_even", "");
  assert.strictEqual(r.text, src);
});

gtest("[impl P1] python: async def at column zero is a declaration", () => {
  const src = `async def first_even():\n    pass\n`;
  const r = guardShadowedTestNames("python", src, "first_even", "");
  assert.deepStrictEqual([...r.renames], [{ from: "first_even", to: "test_first_even" }]);
  assert.match(r.text, /^async def test_first_even\(\):$/m);
});

for (const lang of ["go", "csharp", "typescript", "typescriptreact", "javascript", "javascriptreact"]) {
  gtest(`[impl P1] ${lang}: no shadowing is possible, so nothing moves`, () => {
    const src = `func first_even() {}\ndef first_even():\nfn first_even() {}\n`;
    const r = guardShadowedTestNames(lang, src, "first_even", "");
    assert.strictEqual(r.text, src);
    assert.deepStrictEqual([...r.renames], []);
    assert.deepStrictEqual([...r.refusals], []);
  });
}

gtest("[impl P1] an unregistered language returns the input unchanged", () => {
  const src = `fn first_even() {}`;
  const r = guardShadowedTestNames("ruby", src, "first_even", "");
  assert.strictEqual(r.text, src);
  assert.deepStrictEqual([...r.renames], []);
});

gtest("[impl P1] an empty target name never matches", () => {
  const src = `fn first_even() {}`;
  assert.strictEqual(guardShadowedTestNames("rust", src, "", "").text, src);
});

gtest("[impl P1] 50 taken candidates refuse, and the refusal is all-or-nothing", () => {
  // Every candidate name appears as a word in the reply, so none is free.
  const taken = ["first_even_test", ...Array.from({ length: 49 }, (_, i) => `first_even_test_${i + 2}`)];
  const src = `fn first_even() {}\n// ${taken.join(" ")}\nlet _ = [${taken.join(", ")}];`;
  const r = guardShadowedTestNames("rust", src, "first_even", "");
  assert.deepStrictEqual([...r.refusals], ["first_even"]);
  assert.deepStrictEqual([...r.renames], []);
  assert.strictEqual(r.text, src, "a refused pass returns the input byte for byte");
});

gtest("[impl P1] a second shadow that cannot be named refuses the FIRST one too", () => {
  // 50 candidates taken by words in the reply, plus TWO declarations. The first
  // would find nothing free either, so this pins the all-or-nothing return.
  const taken = ["first_even_test", ...Array.from({ length: 49 }, (_, i) => `first_even_test_${i + 2}`)];
  const src = `fn first_even() {}\nfn first_even() {}\nlet _ = [${taken.join(", ")}];`;
  const r = guardShadowedTestNames("rust", src, "first_even", "");
  assert.deepStrictEqual([...r.refusals], ["first_even"]);
  assert.strictEqual(r.text, src);
});

// ---------------------------------------------------------------------------
// The regen leg. The command hands the guard the file MINUS the region this
// pass replaces, so a regenerate does not read its own previous test name as
// taken and climb the counter forever.
// ---------------------------------------------------------------------------

let asm = {};
let asmCleanup = () => {};
let asmError;
try {
  ({ mod: asm, cleanup: asmCleanup } = bundleCore(
    "impl-v69-p1-marked-region",
    `export { withoutMarkedRegion, testMarkers } from "../src/core/testAssembly";\n`
  ));
} catch (e) {
  asmError = e;
}
test.after(() => asmCleanup());

const atest = (name, fn) =>
  test(name, (ctx) => {
    if (asmError) return ctx.skip(`bundle failed: ${asmError}`);
    return fn(ctx);
  });

atest("[impl P1 regen] the marked region is cut out, markers and all", () => {
  const { withoutMarkedRegion } = asm;
  const text = `pub fn f() {}\n// column80-tests:f:begin\n#[test]\nfn f_test() {}\n// column80-tests:f:end\n`;
  const out = withoutMarkedRegion(text, "f");
  assert.ok(!out.includes("f_test"), "the previous generation's name is gone");
  assert.ok(!out.includes("column80-tests"), "the markers go with it");
  assert.match(out, /pub fn f\(\) \{\}/);
});

atest("[impl P1 regen] no region, or a half region, leaves the text alone", () => {
  const { withoutMarkedRegion } = asm;
  const none = `pub fn f() {}\n`;
  assert.strictEqual(withoutMarkedRegion(none, "f"), none);
  const half = `// column80-tests:f:begin\nfn f_test() {}\n`;
  assert.strictEqual(withoutMarkedRegion(half, "f"), half);
});

atest("[impl P1 regen] python's marker prefix is honoured", () => {
  const { withoutMarkedRegion } = asm;
  const text = `# column80-tests:f:begin\ndef test_f():\n    pass\n# column80-tests:f:end\n`;
  assert.strictEqual(withoutMarkedRegion(text, "f", "#"), "\n", "the newline after the end marker is not part of the region");
  assert.strictEqual(withoutMarkedRegion(text, "f", "//"), text, "the wrong prefix finds nothing");
});

atest("[impl P1 regen] a regenerate re-uses the same name instead of climbing", () => {
  const { withoutMarkedRegion } = asm;
  const after = `pub fn first_even() {}\n#[cfg(test)]\nmod tests {\n// column80-tests:first_even:begin\n#[test]\nfn first_even_test() {}\n// column80-tests:first_even:end\n}\n`;
  const reply = `#[test]\nfn first_even() { assert_eq!(first_even(&[]), None); }`;
  const naive = guardShadowedTestNames("rust", reply, "first_even", after);
  assert.strictEqual(naive.renames[0].to, "first_even_test_2", "reading the whole file climbs");
  const scoped = guardShadowedTestNames(
    "rust",
    reply,
    "first_even",
    withoutMarkedRegion(after, "first_even", "//")
  );
  assert.strictEqual(scoped.renames[0].to, "first_even_test", "cutting the region first does not");
});

// ---------------------------------------------------------------------------
// Contract amendment 1 (adversarial review findings 1 and 3): scope, and raw
// identifiers. The guard renamed declarations that shadow nothing and left
// their call sites behind, which is the corrupting direction — it turned code
// that compiled into code that does not.
// ---------------------------------------------------------------------------

gtest("[impl P1 A1] rust: an INHERENT impl method with the target's name is NOT renamed", () => {
  const src = `struct Fixture;
impl Fixture {
    fn first_even(&self) -> Option<i32> { first_even(&[2]) }
}

#[test]
fn checks() { assert_eq!(Fixture.first_even(), Some(2)); }`;
  const r = guardShadowedTestNames("rust", src, "first_even", "");
  assert.strictEqual(r.text, src, "the method lives in Fixture's namespace and shadows nothing");
  assert.deepStrictEqual([...r.renames], []);
});

gtest("[impl P1 A1] rust: a TRAIT method and its impl are both left alone", () => {
  const src = `trait Evens { fn first_even(&self) -> Option<i32>; }
impl Evens for Vec<i32> {
    fn first_even(&self) -> Option<i32> { None }
}`;
  const r = guardShadowedTestNames("rust", src, "first_even", "");
  assert.strictEqual(r.text, src, "renaming these two apart is structurally impossible code");
});

gtest("[impl P1 A1] rust: a NESTED fn inside another fn body is not module scope", () => {
  const src = `#[test]
fn checks() {
    fn first_even(xs: &[i32]) -> Option<i32> { None }
    assert_eq!(first_even(&[]), None);
}`;
  const r = guardShadowedTestNames("rust", src, "first_even", "");
  assert.strictEqual(r.text, src, "an inner item is scoped to its enclosing body");
});

gtest("[impl P1 A1] rust: a module-scope fn beside an impl IS still renamed", () => {
  // The exclusion must not swallow the case the guard exists for.
  const src = `struct Fixture;
impl Fixture {
    fn helper(&self) -> i32 { 0 }
}

#[test]
fn first_even() { assert_eq!(first_even(&[2]), Some(2)); }`;
  const r = guardShadowedTestNames("rust", src, "first_even", "");
  assert.deepStrictEqual([...r.renames], [{ from: "first_even", to: "first_even_test" }]);
  assert.match(r.text, /fn first_even_test\(\)/);
  assert.match(r.text, /assert_eq!\(first_even\(&\[2\]\), Some\(2\)\)/);
});

gtest("[impl P1 A1] rust: a fn inside the reply's OWN mod tests wrapper is module scope", () => {
  const src = `#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn first_even() { assert_eq!(first_even(&[]), None); }
}`;
  const r = guardShadowedTestNames("rust", src, "first_even", "");
  assert.deepStrictEqual([...r.renames], [{ from: "first_even", to: "first_even_test" }]);
});

gtest("[impl P1 A1] rust: a trait method SIGNATURE ending in `;` does not leak its scope", () => {
  // `fn sig(&self);` never opens a block. Without the `;` reset the keyword
  // would ride onto the next `{` and mark a module body as a fn body.
  const src = `trait T { fn sig(&self); }

#[test]
fn first_even() { assert_eq!(first_even(&[]), None); }`;
  const r = guardShadowedTestNames("rust", src, "first_even", "");
  assert.deepStrictEqual([...r.renames], [{ from: "first_even", to: "first_even_test" }]);
});

gtest("[impl P1 A1] rust: `fn r#first_even` is the identifier first_even and is renamed", () => {
  const src = `#[test]
fn r#first_even() { assert_eq!(first_even(&[2]), Some(2)); }`;
  const r = guardShadowedTestNames("rust", src, "first_even", "");
  assert.deepStrictEqual([...r.renames], [{ from: "first_even", to: "first_even_test" }]);
  assert.match(r.text, /fn first_even_test\(\)/);
  assert.ok(!r.text.includes("r#"), "the raw prefix is part of the spelling and goes with the name");
  assert.match(r.text, /assert_eq!\(first_even\(&\[2\]\), Some\(2\)\)/, "the call is untouched");
});

gtest("[impl P1 A1] rust: an existing r# declaration in the target file takes the name", () => {
  const r = guardShadowedTestNames("rust", "fn first_even() {}", "first_even", "fn r#first_even_test() {}");
  assert.deepStrictEqual([...r.renames], [{ from: "first_even", to: "first_even_test_2" }]);
});

// ---------------------------------------------------------------------------
// Triage finding 5, the allow-list half. A cmd/go USAGE refusal is a crashed
// check, not a fault in the user's code; a `go: ` VERDICT still is one. The
// allow-list must separate them, because a blanket change to the `go: ` branch
// is what P1 review F4 already burned.
// ---------------------------------------------------------------------------

let go = {};
let goCleanup = () => {};
let goError;
try {
  ({ mod: go, cleanup: goCleanup } = bundleCore(
    "impl-v69-p1-gousage",
    `export { GoOracle } from "../src/core/goOracle";\n`
  ));
} catch (e) {
  goError = e;
}
test.after(() => goCleanup());

const gotest = (name, fn) =>
  test(name, (ctx) => {
    if (goError) return ctx.skip(`bundle failed: ${goError}`);
    return fn(ctx);
  });

gotest("[impl P1 G5] a go USAGE refusal parses to NOTHING, so describeCheckFailure gets to speak", () => {
  const { GoOracle } = go;
  const oracle = new GoOracle({ fileExists: () => true });
  for (const line of [
    "go: cannot use -c flag with multiple packages",
    "go: unknown flag -c",
    "go: flag provided but not defined: -c",
    "go: unknown command \"test\"",
  ]) {
    assert.deepStrictEqual(
      oracle.parseCheckOutput(`${line}\n`, "/w/proj", Date.now()),
      [],
      `a usage refusal must not become a diagnostic: ${line}`
    );
  }
});

gotest("[impl P1 G5] a go VERDICT is still a diagnostic - the allow-list is not a blanket", () => {
  const { GoOracle } = go;
  const oracle = new GoOracle({ fileExists: () => true });
  for (const line of [
    "go: updates to go.mod needed; to update it: go mod tidy",
    "go: inconsistent vendoring in /w/proj:",
    "go: module example.com/x@v1.0.0 found, but does not contain package example.com/x/y",
  ]) {
    const diags = oracle.parseCheckOutput(`${line}\n`, "/w/proj", Date.now());
    assert.strictEqual(diags.length, 1, `this IS the failure and must reach the human: ${line}`);
    assert.strictEqual(diags[0].level, "error");
    assert.deepStrictEqual(diags[0].spans, [], "a module-level verdict carries no location");
  }
});

gotest("[impl P1 G5] a real compile error never wears the `go: ` prefix, so the allow-list cannot eat one", () => {
  const { GoOracle } = go;
  const oracle = new GoOracle({ fileExists: () => true });
  const diags = oracle.parseCheckOutput("lib/x.go:4:2: cannot use 5 as string value\n", "/w/proj", Date.now());
  assert.strictEqual(diags.length, 1);
  assert.match(diags[0].message, /cannot use 5 as string value/);
});
