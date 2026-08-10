// Implementer oracle: span-scoping edge cases the blind grid does not pin -
// span-less errors (rustc's "aborting" summary), an error in the touched file
// but outside the touched fn, multi-primary path resolution through the
// injectable fileExists, no-scope totality, and message file de-duplication.
//
// Run: npm test

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-v3-oraclescope",
  `export { spanScopedVerdict, spanScopedMessage } from "../src/core/repair";\n`
);
const { spanScopedVerdict, spanScopedMessage } = mod;
test.after(cleanup);

const CRATE = "/crate";
const LIB = "/crate/src/lib.rs";
const MAIN = "/crate/src/main.rs";
const scope = (over = {}) => ({ filePath: LIB, crateRoot: CRATE, byteStart: 100, byteEnd: 200, ...over });
const span = (over = {}) => ({
  fileName: LIB, byteStart: 120, byteEnd: 130, lineStart: 5, lineEnd: 5,
  columnStart: 1, columnEnd: 9, isPrimary: true, ...over,
});
const err = (over = {}) => ({
  kind: "compile-error", level: "error", code: "E0308", message: "mismatched types",
  spans: [span()], suggestions: [], ...over,
});

// ---- span-less errors do not block a clean verdict (the repro's "aborting" line)

test("a located out-of-span error plus a span-less 'aborting' error -> clean-out-of-span; the span-less error is counted, contributes no file", () => {
  const abortLike = err({ code: undefined, message: "aborting due to 1 previous error", spans: [] });
  const v = spanScopedVerdict([err({ spans: [span({ fileName: MAIN, byteStart: 40, byteEnd: 50 })] }), abortLike], scope());
  assert.strictEqual(v.kind, "clean-out-of-span", "an unlocatable error cannot pin inside the touched span");
  assert.strictEqual(v.outOfSpan.length, 2, "both the located-elsewhere and the span-less error count as out of span");
  assert.deepStrictEqual(v.outOfSpanFiles, [MAIN], "only the locatable error contributes a file");
});

test("a span-less error alone -> clean-out-of-span with no files (message states outside-the-span, no file clause)", () => {
  const v = spanScopedVerdict([err({ spans: [] })], scope());
  assert.strictEqual(v.kind, "clean-out-of-span");
  assert.deepStrictEqual(v.outOfSpanFiles, []);
  const m = spanScopedMessage(v, "f");
  assert.ok(/no error landed inside/.test(m) && /outside the touched span/.test(m), `geometric wording: ${m}`);
  assert.ok(!/, in /.test(m), `no bogus file clause when nothing is locatable: ${m}`);
  assert.ok(!/pre-existing/.test(m), `does not claim the error pre-dates the generation: ${m}`);
});

// ---- in the touched FILE but outside the touched FN

test("an error in lib.rs but past the fn's byte span -> out of span, verdict clean-out-of-span", () => {
  const v = spanScopedVerdict([err({ spans: [span({ byteStart: 500, byteEnd: 510 })] })], scope());
  assert.strictEqual(v.kind, "clean-out-of-span", "same file, different item is not this generation's error");
  assert.deepStrictEqual(v.outOfSpanFiles, [LIB]);
});

test("boundary: a zero-width primary exactly on the span end counts as in-span", () => {
  const v = spanScopedVerdict([err({ spans: [span({ byteStart: 200, byteEnd: 200 })] })], scope());
  assert.strictEqual(v.kind, "in-span", "the boundary byte is inside, matching primarySpanInScope");
});

// ---- path identity via the injectable fileExists (relative span names)

test("relative span names resolve through the injected fileExists, never by suffix", () => {
  // rustc reports member files workspace-relative; the anchor rule places them.
  const relScope = { filePath: "/ws/member/src/lib.rs", crateRoot: "/ws/member", byteStart: 100, byteEnd: 200,
    fileExists: (p) => p === "/ws/member/src/lib.rs" || p === "/ws/Cargo.toml" || p === "/ws/member/Cargo.toml" };
  const inMember = err({ spans: [span({ fileName: "member/src/lib.rs", byteStart: 150, byteEnd: 160 })] });
  // A different scope whose relative name would suffix-collide but resolves elsewhere.
  const relScope2 = { filePath: "/ws/other/src/lib.rs", crateRoot: "/ws/other", byteStart: 100, byteEnd: 200,
    fileExists: (p) => p === "/ws/other/src/lib.rs" || p === "/ws/Cargo.toml" || p === "/ws/other/Cargo.toml" };
  assert.strictEqual(spanScopedVerdict([inMember], relScope).kind, "in-span", "resolves to the member's own lib.rs");
  assert.strictEqual(spanScopedVerdict([inMember], relScope2).kind, "clean-out-of-span", "same relative name, different crate, out of span");
});

// ---- totality: no scope, warnings-only, empty

test("no scope: every error reads out of span (nothing to place it against)", () => {
  const v = spanScopedVerdict([err(), err({ spans: [] })]);
  assert.strictEqual(v.kind, "clean-out-of-span");
  assert.strictEqual(v.outOfSpan.length, 2);
  assert.deepStrictEqual(v.outOfSpanFiles, [], "no scope means no crateRoot to resolve files against");
});

// ---- message de-duplicates files, counts errors not files

test("two errors in the same out-of-span file: count is errors, file listed once", () => {
  const a = err({ spans: [span({ fileName: MAIN, byteStart: 40, byteEnd: 50 })] });
  const b = err({ spans: [span({ fileName: MAIN, byteStart: 60, byteEnd: 70 })] });
  const v = spanScopedVerdict([a, b], scope());
  assert.deepStrictEqual(v.outOfSpanFiles, [MAIN], "distinct files only");
  const m = spanScopedMessage(v, "f");
  assert.ok(/\b2 errors\b/.test(m), `two errors: ${m}`);
  assert.strictEqual((m.match(/main\.rs/g) || []).length, 1, `the file is named once: ${m}`);
});
