// Blind oracle: classifyEligibility, the total classifier (phase4-surface.md
// "classifyEligibility, the total classifier" + contract 4b). Assertion
// message shapes come from the committed real `cargo test` panic capture at
// test/fixtures/rustc/assertion-panic.txt. Never read src/**. Expected red
// on stubs.
//
// Run: npm test

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "blind4-eligibility",
  `export { classifyEligibility } from "../src/core/repair";
export { RustOracle } from "../src/core/compilerOracle";\n`
);
const { classifyEligibility, RustOracle } = mod;
test.after(cleanup);

const FIXTURES = path.join(__dirname, "fixtures", "rustc");
const fixture = (name) => fs.readFileSync(path.join(FIXTURES, name), "utf8");

// The real runtime assertion text family, straight from the capture.
const panicText = fixture("assertion-panic.txt");
assert.ok(panicText.includes("assertion `left == right` failed"), "fixture sanity: real cargo test panic captured");
const start = panicText.indexOf("assertion `left == right` failed");
const REAL_ASSERTION_MSG = panicText.slice(start, panicText.indexOf("\n\n", start)); // includes left:/right: lines

const primarySpan = (over = {}) => ({
  fileName: "src/task1.rs", byteStart: 398, byteEnd: 407, lineStart: 11, lineEnd: 11,
  columnStart: 18, columnEnd: 27, isPrimary: true, ...over,
});
const diag = (over = {}) => ({
  kind: "compile-error", level: "error", message: "mismatched types",
  spans: [primarySpan()], suggestions: [], ...over,
});

// ---- precedence table [surface: 'precedence exactly this order (the logged reason must be the honest one)']

const cases = [
  // 1. assertion-shaped wins over everything
  { name: "kind assertion-failure, even with a primary span", d: diag({ kind: "assertion-failure", message: REAL_ASSERTION_MSG }), want: { eligible: false, reason: "assertion-failure" } },
  { name: "text seatbelt: compile-error kind but real `left == right` panic text", d: diag({ message: REAL_ASSERTION_MSG }), want: { eligible: false, reason: "assertion-failure" } },
  { name: "text seatbelt: 'assertion failed: ...' family", d: diag({ message: "assertion failed: total > 0" }), want: { eligible: false, reason: "assertion-failure" } },
  { name: "text seatbelt: leading whitespace before 'assertion'", d: diag({ message: "  \tassertion `left == right` failed" }), want: { eligible: false, reason: "assertion-failure" } },
  { name: "assertion-shaped warning: rule 1 precedes rule 2", d: diag({ kind: "compile-warning", level: "warning", message: "assertion failed: cfg" }), want: { eligible: false, reason: "assertion-failure" } },
  { name: "assertion-shaped with no span: rule 1 precedes rule 3", d: diag({ message: REAL_ASSERTION_MSG, spans: [] }), want: { eligible: false, reason: "assertion-failure" } },
  { name: "kind assertion-failure with warning level and no span", d: diag({ kind: "assertion-failure", level: "warning", spans: [] }), want: { eligible: false, reason: "assertion-failure" } },
  // 2. warnings never trigger repair
  { name: "plain warning with a primary span", d: diag({ kind: "compile-warning", level: "warning", message: "unused variable: `x`" }), want: { eligible: false, reason: "warning" } },
  { name: "warning with no span: rule 2 precedes rule 3", d: diag({ kind: "compile-warning", level: "warning", message: "unused variable: `x`", spans: [] }), want: { eligible: false, reason: "warning" } },
  // 3. span-less diagnostics are display-only
  { name: "compile-error with zero spans", d: diag({ spans: [] }), want: { eligible: false, reason: "no-location" } },
  { name: "compile-error with only non-primary spans", d: diag({ spans: [primarySpan({ isPrimary: false }), primarySpan({ isPrimary: false, byteStart: 1, byteEnd: 2 })] }), want: { eligible: false, reason: "no-location" } },
  { name: "panic with no primary span", d: diag({ kind: "panic", message: "index out of bounds", spans: [] }), want: { eligible: false, reason: "no-location" } },
  // 4. otherwise eligible
  { name: "compile error with a primary span", d: diag(), want: { eligible: true } },
  { name: "located panic", d: diag({ kind: "panic", message: "index out of bounds: the len is 3 but the index is 7" }), want: { eligible: true } },
  { name: "primary span not first in the array still counts as located", d: diag({ spans: [primarySpan({ isPrimary: false }), primarySpan()] }), want: { eligible: true } },
  // message-shape non-matches must fall through, not refuse
  { name: "'assertion' without 'failed' is not assertion-shaped", d: diag({ message: "assertion macro expansion" }), want: { eligible: true } },
  { name: "message merely containing 'assertion ... failed' mid-text does not start with 'assertion'", d: diag({ message: "the assertion in this test failed to compile" }), want: { eligible: true } },
];

for (const { name, d, want } of cases) {
  test(`classifyEligibility: ${name} -> ${JSON.stringify(want)} [surface: eligibility rules 1-4]`, () => {
    const got = classifyEligibility(d);
    assert.strictEqual(got.eligible, want.eligible);
    if (want.eligible === false) {
      assert.strictEqual(got.reason, want.reason, "the logged reason must be the honest one");
    }
  });
}

// ---- tied to real parser output, not just hand-built diagnostics

test("parsed real compile errors are eligible; parsed real warnings are refused as warnings [surface: 'compile errors and located panics' eligible]", () => {
  const oracle = new RustOracle();
  for (const f of ["type-error.json", "name-error.json", "borrow-error.json", "macro-expansion.json"]) {
    const [d] = oracle.parseCheckOutput(fixture(f));
    assert.deepStrictEqual(classifyEligibility(d).eligible, true, `${f}: a location-naming compile error is the eligible case`);
  }
  const [w] = oracle.parseCheckOutput(fixture("warning-only.json"));
  const got = classifyEligibility(w);
  assert.strictEqual(got.eligible, false);
  assert.strictEqual(got.reason, "warning");
});

test("classifyEligibility is pure and never throws: every kind in the union classifies [surface: 'Pure, never throws' + totality]", () => {
  for (const kind of ["compile-error", "compile-warning", "panic", "assertion-failure"]) {
    for (const spans of [[], [primarySpan()], [primarySpan({ isPrimary: false })]]) {
      for (const level of ["error", "warning"]) {
        const got = classifyEligibility(diag({ kind, level, spans }));
        assert.strictEqual(typeof got.eligible, "boolean");
      }
    }
  }
});

test("classifyEligibility does not mutate its input", () => {
  const d = diag();
  const before = JSON.parse(JSON.stringify(d));
  classifyEligibility(d);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(d)), before);
});
