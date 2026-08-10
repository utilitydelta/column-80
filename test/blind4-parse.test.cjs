// Blind oracle: parseCheckOutput against committed real rustc JSON
// (phase4-surface.md "The Diagnostic type, field by field against real rustc
// JSON" + "parseCheckOutput rules"). Fixtures under test/fixtures/rustc/ were
// captured from `cargo check --message-format=json` (cargo 1.96.0) on scratch
// copies of test/fixtures/repairbench with deliberate breakages;
// dedup-warning.json used `--all-targets` to force cargo's multi-target
// re-emit of one identical warning. Never read src/**. Expected red on stubs.
//
// Run: npm test

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "blind4-parse",
  `export { RustOracle } from "../src/core/compilerOracle";\n`
);
const { RustOracle } = mod;
test.after(cleanup);

const FIXTURES = path.join(__dirname, "fixtures", "rustc");
const fixture = (name) => fs.readFileSync(path.join(FIXTURES, name), "utf8");
const parse = (stdout) => new RustOracle().parseCheckOutput(stdout);

// ---- field-by-field against real captures [surface: Diagnostic type + parse rules]

test("type error E0308: one diagnostic, every field mapped, multi-span with expected/found labels [surface: 'spans maps message.spans verbatim under the field renames'; 'label is where expected/found lives']", () => {
  const diags = parse(fixture("type-error.json"));
  assert.strictEqual(diags.length, 1, "failure-note and build-finished lines contribute nothing");
  const d = diags[0];
  assert.strictEqual(d.kind, "compile-error");
  assert.strictEqual(d.level, "error");
  assert.strictEqual(d.code, "E0308");
  assert.strictEqual(d.message, "mismatched types");
  assert.deepStrictEqual(d.spans, [
    { fileName: "src/task1.rs", byteStart: 475, byteEnd: 483, lineStart: 14, lineEnd: 14, columnStart: 21, columnEnd: 29, isPrimary: true, label: "expected `u64`, found `&str`" },
    { fileName: "src/task1.rs", byteStart: 470, byteEnd: 474, lineStart: 14, lineEnd: 14, columnStart: 16, columnEnd: 20, isPrimary: false, label: "arguments to this enum variant are incorrect" },
  ]);
  assert.deepStrictEqual(d.suggestions, [], "help child spans without suggested_replacement contribute nothing");
  assert.strictEqual(typeof d.rendered, "string");
  assert.ok(d.rendered.startsWith("error[E0308]: mismatched types\n"), `rendered is rustc's human text, got ${JSON.stringify(d.rendered.slice(0, 40))}`);
});

test("name error E0425: label null becomes absent; suggestion hoisted from the help child with applicability [surface: 'label: null -> absent'; 'suggestions hoists children']", () => {
  const diags = parse(fixture("name-error.json"));
  assert.strictEqual(diags.length, 1);
  const d = diags[0];
  assert.strictEqual(d.kind, "compile-error");
  assert.strictEqual(d.code, "E0425");
  assert.strictEqual(d.message, "cannot find value `numbr_str` in this scope");
  assert.strictEqual(d.spans.length, 1);
  assert.ok(!("label" in d.spans[0]), "label: null in the capture -> absent, not null and not undefined-valued");
  assert.deepStrictEqual(d.spans[0], { fileName: "src/task1.rs", byteStart: 398, byteEnd: 407, lineStart: 11, lineEnd: 11, columnStart: 18, columnEnd: 27, isPrimary: true });
  assert.strictEqual(d.suggestions.length, 1);
  const s = d.suggestions[0];
  assert.strictEqual(s.message, "a local variable with a similar name exists");
  assert.strictEqual(s.replacement, "number_str");
  assert.strictEqual(s.applicability, "MaybeIncorrect");
  assert.strictEqual(s.span.byteStart, 398);
  assert.strictEqual(s.span.byteEnd, 407);
});

test("borrow error E0596: five spans in emitted order, primary mid-array, MachineApplicable 'mut ' suggestion [surface: 'Fixes live on child diagnostics of level help, in their spans']", () => {
  const diags = parse(fixture("borrow-error.json"));
  assert.strictEqual(diags.length, 1);
  const d = diags[0];
  assert.strictEqual(d.code, "E0596");
  assert.strictEqual(d.message, "cannot borrow `result` as mutable, as it is not declared as mutable");
  assert.deepStrictEqual(d.spans.map((s) => s.byteStart), [470, 64, 392, 300, 232], "span order is rustc's emitted order, verbatim");
  assert.deepStrictEqual(d.spans.map((s) => s.isPrimary), [false, true, false, false, false], "the primary span is not first; isPrimary is per-span truth, not position");
  assert.strictEqual(d.spans[1].label, "not mutable");
  assert.strictEqual(d.spans[0].label, "cannot borrow as mutable");
  assert.deepStrictEqual(d.suggestions, [
    {
      message: "consider changing this to be mutable",
      span: { fileName: "src/task2.rs", byteStart: 64, byteEnd: 64, lineStart: 2, lineEnd: 2, columnStart: 9, columnEnd: 9, isPrimary: true },
      replacement: "mut ",
      applicability: "MachineApplicable",
    },
  ]);
});

test("warning-only: kind compile-warning, code is the lint name, note child contributes nothing, help child hoists [surface: 'warning -> compile-warning'; 'code ... lint name for warnings']", () => {
  const diags = parse(fixture("warning-only.json"));
  assert.strictEqual(diags.length, 1, "compiler-artifact and build-finished lines are skipped");
  const d = diags[0];
  assert.strictEqual(d.kind, "compile-warning");
  assert.strictEqual(d.level, "warning");
  assert.strictEqual(d.code, "unused_variables");
  assert.strictEqual(d.message, "unused variable: `scratch_total`");
  assert.deepStrictEqual(d.spans, [
    { fileName: "src/task2.rs", byteStart: 64, byteEnd: 77, lineStart: 2, lineEnd: 2, columnStart: 9, columnEnd: 22, isPrimary: true },
  ]);
  assert.strictEqual(d.suggestions.length, 1, "the note child ('#[warn(unused_variables)] on by default') hoists nothing");
  assert.strictEqual(d.suggestions[0].message, "if this is intentional, prefix it with an underscore");
  assert.strictEqual(d.suggestions[0].replacement, "_scratch_total");
  assert.strictEqual(d.suggestions[0].applicability, "MachineApplicable");
});

test("macro-expansion span: span kept exactly as reported, expansion ignored and not smuggled onto DiagnosticSpan [surface: 'v1 keeps the span exactly as reported and ignores expansion']", () => {
  const diags = parse(fixture("macro-expansion.json"));
  assert.strictEqual(diags.length, 1);
  const d = diags[0];
  assert.strictEqual(d.code, "E0308");
  assert.deepStrictEqual(d.spans, [
    { fileName: "src/task2.rs", byteStart: 60, byteEnd: 66, lineStart: 2, lineEnd: 2, columnStart: 37, columnEnd: 43, isPrimary: true, label: "expected `usize`, found `&str`" },
    { fileName: "src/task2.rs", byteStart: 52, byteEnd: 57, lineStart: 2, lineEnd: 2, columnStart: 29, columnEnd: 34, isPrimary: false, label: "expected due to this" },
  ], "raw capture carries expansion objects on both spans; the Diagnostic span carries only the documented fields");
});

// ---- dedup [surface: 'diagnostics with identical rendered (both present) collapse to the first occurrence']

test("cargo multi-target re-emit collapses: two identical warnings in the capture, one diagnostic out", () => {
  const raw = fixture("dedup-warning.json");
  const emitted = raw.split("\n").filter((l) => l.includes('"compiler-message"')).length;
  assert.strictEqual(emitted, 2, "fixture sanity: cargo emitted the same warning for two targets");
  const diags = parse(raw);
  assert.strictEqual(diags.length, 1);
  assert.strictEqual(diags[0].message, "unused variable: `scratch_total`");
});

test("collapse requires both rendered present: duplicates with rendered nulled do not collapse [surface: '(both present)']", () => {
  // Derived from the real capture: same line twice with rendered removed.
  const line = fixture("warning-only.json").split("\n").find((l) => l.includes('"compiler-message"'));
  const obj = JSON.parse(line);
  obj.message.rendered = null;
  const doubled = JSON.stringify(obj) + "\n" + JSON.stringify(obj) + "\n";
  const diags = parse(doubled);
  assert.strictEqual(diags.length, 2, "no rendered, no collapse key");
  for (const d of diags) assert.ok(!("rendered" in d), "rendered: null -> absent");
});

test("distinct diagnostics never collapse: type + name fixtures concatenated yield both", () => {
  const diags = parse(fixture("type-error.json") + fixture("name-error.json"));
  assert.deepStrictEqual(diags.map((d) => d.code), ["E0308", "E0425"]);
});

// ---- level filtering [surface: 'Every other level is dropped at top level']

test("failure-note lines are dropped: no diagnostic carries the 'For more information' noise", () => {
  for (const f of ["type-error.json", "name-error.json", "borrow-error.json", "macro-expansion.json"]) {
    const diags = parse(fixture(f));
    assert.ok(
      diags.every((d) => !d.message.includes("For more information")),
      `${f}: failure-note leaked into diagnostics`
    );
    assert.ok(diags.every((d) => d.level === "error" || d.level === "warning"));
  }
});

test("parseCheckOutput never produces panic or assertion-failure kinds [surface: 'Those kinds ... enter only from test constructors or a future test-running oracle']", () => {
  const all = ["type-error.json", "name-error.json", "borrow-error.json", "warning-only.json", "macro-expansion.json", "dedup-warning.json"]
    .flatMap((f) => parse(fixture(f)));
  assert.ok(all.length >= 6, "sanity: fixtures produced diagnostics");
  for (const d of all) {
    assert.ok(d.kind === "compile-error" || d.kind === "compile-warning", `unexpected kind ${d.kind}`);
  }
});

// ---- absent-when-null [surface: 'code is message.code?.code, absent when null. rendered absent when null.']

test("code and rendered are absent when null in the JSON, not null-valued", () => {
  // Derived from the real warning capture with code and rendered nulled.
  const line = fixture("warning-only.json").split("\n").find((l) => l.includes('"compiler-message"'));
  const obj = JSON.parse(line);
  obj.message.code = null;
  obj.message.rendered = null;
  const diags = parse(JSON.stringify(obj) + "\n");
  assert.strictEqual(diags.length, 1);
  assert.ok(!("code" in diags[0]), "code absent");
  assert.ok(!("rendered" in diags[0]), "rendered absent");
});

// ---- garbage tolerance [surface: 'Garbage tolerance is a guarantee: unparseable output yields fewer diagnostics, never a thrown parser']

const garbagePrefixes = [
  { name: "non-JSON text", junk: "warning: unused manifest key\nnot json at all\n" },
  { name: "truncated JSON", junk: '{"reason":"compiler-mess\n' },
  { name: "wrong reason", junk: '{"reason":"build-script-executed","package_id":"x"}\n' },
  { name: "compiler-message with no message key", junk: '{"reason":"compiler-message","package_id":"x"}\n' },
  { name: "empty lines", junk: "\n\n\n" },
];
for (const { name, junk } of garbagePrefixes) {
  test(`garbage tolerance: ${name} interleaved with a real capture parses to the same diagnostics`, () => {
    const clean = parse(fixture("type-error.json"));
    const dirty = parse(junk + fixture("type-error.json") + junk);
    assert.deepStrictEqual(dirty, clean);
  });
}

test("pure garbage and empty input yield [], never a throw", () => {
  assert.deepStrictEqual(parse(""), []);
  assert.deepStrictEqual(parse("total garbage\n{]\n"), []);
});
