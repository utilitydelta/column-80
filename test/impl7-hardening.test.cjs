// Implementer oracle for the slice-2 adversarial-review fixes: the diagnostic
// variants and doc-fence shapes the frozen blind set (ground-truth strings
// only) does not cover. Locks the classifier and extractExample hardening so a
// regression is caught, not rediscovered by the next reviewer.
//
// impl* files may know internals; headless, no rust-analyzer.
//
// Run: SKIP_LIVE=1 node --test test/impl7-hardening.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl7-hardening",
  `export { classifyHallucination } from "../src/core/compilerDirected";
export { extractExample } from "../src/core/extraction";\n`
);
const { classifyHallucination, extractExample } = mod;
test.after(cleanup);

const span = { fileName: "src/main.rs", byteStart: 0, byteEnd: 0, lineStart: 5, lineEnd: 5, columnStart: 9, columnEnd: 12, isPrimary: true };
const diag = (code, message) => ({ kind: "compile-error", level: "error", code, message, spans: [span], suggestions: [] });
const CURSOR = { line: 4, character: 8 };

// ---- M1: two-word receiver descriptors (the whole family the single-word
// regex dropped) still classify as unresolved-method.
for (const receiver of ["mutable reference", "trait object", "type parameter", "raw pointer", "reference", "slice"]) {
  test(`classify: E0599 method on a ${JSON.stringify(receiver)} receiver still classifies`, () => {
    const r = classifyHallucination(diag("E0599", `no method named \`draw\` found for ${receiver} \`&dyn Shape\` in the current scope`));
    assert.ok(r, `${receiver} must not drop to plain repair`);
    assert.strictEqual(r.kind, "unresolved-method");
    assert.strictEqual(r.member, "draw");
    assert.strictEqual(r.type, "&dyn Shape");
    assert.deepStrictEqual(r.cursor, CURSOR);
  });
}

// ---- M2: E0432 path edge cases.
test("classify: E0432 plural `unresolved imports` classifies the first path", () => {
  const r = classifyHallucination(diag("E0432", "unresolved imports `serde::Ser`, `serde::De`"));
  assert.deepStrictEqual(r, { kind: "wrong-item", crate: "serde", item: "Ser", cursor: CURSOR });
});
test("classify: E0432 single-segment import is a MISSING CRATE, not a wrong item", () => {
  // `use fastbloom::Bloom` with fastbloom absent -> rustc points at the crate.
  const r = classifyHallucination(diag("E0432", "unresolved import `fastbloom`"));
  assert.deepStrictEqual(r, { kind: "unresolved-crate", crate: "fastbloom", cursor: CURSOR });
});
test("classify: E0432 multi-segment import is a wrong item in a present crate", () => {
  const r = classifyHallucination(diag("E0432", "unresolved import `fastbloom::Bloom`"));
  assert.deepStrictEqual(r, { kind: "wrong-item", crate: "fastbloom", item: "Bloom", cursor: CURSOR });
});
test("classify: E0432 leading `::` does not yield an empty crate name", () => {
  const r = classifyHallucination(diag("E0432", "unresolved import `::fastbloom::Bloom`"));
  assert.deepStrictEqual(r, { kind: "wrong-item", crate: "fastbloom", item: "Bloom", cursor: CURSOR });
});
for (const local of ["crate", "self", "super"]) {
  test(`classify: E0432 local ${local}:: path is NOT a dependency hallucination (undefined)`, () => {
    assert.strictEqual(classifyHallucination(diag("E0432", `unresolved import \`${local}::widgets::Gadget\``)), undefined);
  });
}

// ---- M3: modern E0433 phrasing.
test("classify: E0433 `use of undeclared crate or module` classifies as unresolved-crate", () => {
  const r = classifyHallucination(diag("E0433", "failed to resolve: use of undeclared crate or module `tokio`"));
  assert.deepStrictEqual(r, { kind: "unresolved-crate", crate: "tokio", cursor: CURSOR });
});

// ---- H4 / L1 / L2: extractExample fence and heading hygiene.
const underExamples = (fenceInfo, body) => `Creates a thing.\n\n# Examples\n\n\`\`\`${fenceInfo}\n${body}\n\`\`\``;

test("extractExample skips a ```text block (not rust) and finds no rust example", () => {
  assert.strictEqual(extractExample(underExamples("text", "$ cargo run")), undefined);
});
test("extractExample skips a ```compile_fail block: a known-broken snippet is never injected as compiling", () => {
  assert.strictEqual(extractExample(underExamples("compile_fail", "let x: u8 = 300;")), undefined);
});
test("extractExample skips a non-rust block but takes a following rust block", () => {
  const doc = "Doc.\n\n# Examples\n\n```text\n$ run\n```\n\n```rust\nlet f = Widget::new();\n```";
  assert.strictEqual(extractExample(doc), "let f = Widget::new();");
});
test("extractExample accepts a rust attribute fence (```no_run) as a compiling example", () => {
  assert.strictEqual(extractExample(underExamples("no_run", "let f = Widget::new();")), "let f = Widget::new();");
});
test("extractExample matches the singular `# Example` heading too", () => {
  assert.strictEqual(extractExample("Doc.\n\n# Example\n\n```\nlet f = Widget::new();\n```"), "let f = Widget::new();");
});
test("extractExample strips rustdoc hidden `# ` boilerplate lines from the example", () => {
  const doc = "Doc.\n\n# Examples\n\n```\n# use widgets::Widget;\nlet f = Widget::new();\n# assert!(f.ok());\n```";
  assert.strictEqual(extractExample(doc), "let f = Widget::new();");
});
