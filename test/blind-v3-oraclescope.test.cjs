// Blind oracle: the span-scoped success verdict (goal item 5, "Oracle success
// scoping against out-of-span errors"). The crate-wide cargo verdict stays
// whatever cargo said; this pure function scopes the VERDICT the human reads to
// the touched function/type's span, so one unrelated broken file does not make a
// clean generation read as failed. Never read src/**. Expected red on stubs.
//
// Contract, over a constructed diagnostic list + a RepairScope:
//   - green            : no error-level diagnostics at all.
//   - clean-out-of-span: errors exist, but NONE has a primary span inside the
//                        touched scope; the generation itself is clean.
//   - in-span          : at least one error's primary span lands inside the
//                        scope; unchanged "repair proceeds" path.
// spanScopedMessage names the clean symbol and the out-of-span count/files for
// the clean-out-of-span case only; undefined otherwise (nothing new to say).
//
// Run: npm test

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "blind-v3-oraclescope",
  `export { spanScopedVerdict, spanScopedMessage } from "../src/core/repair";\n`
);
const { spanScopedVerdict, spanScopedMessage } = mod;
test.after(cleanup);

// Absolute span fileNames so resolveDiagnosticPath is a pass-through and the
// grid needs no filesystem: identity is the absolute path itself.
const CRATE = "/crate";
const LIB = "/crate/src/lib.rs";
const MAIN = "/crate/src/main.rs";

// The touched function sits in lib.rs, bytes 100..200.
const scope = (over = {}) => ({ filePath: LIB, crateRoot: CRATE, byteStart: 100, byteEnd: 200, ...over });

const span = (over = {}) => ({
  fileName: LIB, byteStart: 120, byteEnd: 130, lineStart: 5, lineEnd: 5,
  columnStart: 1, columnEnd: 9, isPrimary: true, ...over,
});
const err = (over = {}) => ({
  kind: "compile-error", level: "error", code: "E0308", message: "mismatched types",
  spans: [span()], suggestions: [], rendered: "error[E0308]: mismatched types\n", ...over,
});
const warn = (over = {}) => ({
  kind: "compile-warning", level: "warning", code: "unused_variables",
  message: "unused variable: `x`", spans: [span()], suggestions: [], ...over,
});

// An E0308 in main.rs while the touched fn is in lib.rs: the reference repro.
const outOfFile = (over = {}) => err({ spans: [span({ fileName: MAIN, byteStart: 40, byteEnd: 50 })], ...over });
// Same file as the touched fn, but bytes past its span (a different item).
const outOfFn = (over = {}) => err({ spans: [span({ byteStart: 500, byteEnd: 510 })], ...over });
// In the touched fn's span.
const inFn = (over = {}) => err({ spans: [span({ byteStart: 150, byteEnd: 160 })], ...over });

// ---- the verdict tri-state [surface: green | clean-out-of-span | in-span]

test("the reference repro: a lone E0308 in main.rs while the touched fn (lib.rs) is clean -> clean-out-of-span, crate-wide success stays false", () => {
  const v = spanScopedVerdict([outOfFile()], scope());
  assert.strictEqual(v.kind, "clean-out-of-span", "the generation is clean even though the crate is not green");
  assert.deepStrictEqual(v.inSpan, [], "nothing landed inside the touched span");
  assert.strictEqual(v.outOfSpan.length, 1, "the E0308 counts as an out-of-span error");
  assert.deepStrictEqual(v.outOfSpanFiles, [MAIN], "the out-of-span file is named for the human");
});

test("an in-span error -> in-span verdict, the unchanged repair path (distinct from clean-out-of-span)", () => {
  const v = spanScopedVerdict([inFn()], scope());
  assert.strictEqual(v.kind, "in-span");
  assert.strictEqual(v.inSpan.length, 1);
  assert.deepStrictEqual(v.outOfSpan, []);
});

test("no error-level diagnostics -> green (warnings never fail a build; success stays true with warnings)", () => {
  assert.strictEqual(spanScopedVerdict([], scope()).kind, "green");
  assert.strictEqual(spanScopedVerdict([warn(), warn()], scope()).kind, "green");
});

test("a mix of in-span and out-of-span errors -> in-span (repair still has work in the touched fn)", () => {
  const v = spanScopedVerdict([inFn(), outOfFile()], scope());
  assert.strictEqual(v.kind, "in-span");
  assert.strictEqual(v.inSpan.length, 1);
  assert.strictEqual(v.outOfSpan.length, 1);
});

test("warnings are ignored: an out-of-span error plus an in-span warning is still clean-out-of-span", () => {
  const v = spanScopedVerdict([outOfFile(), warn({ spans: [span({ byteStart: 150, byteEnd: 160 })] })], scope());
  assert.strictEqual(v.kind, "clean-out-of-span", "a warning inside the span does not make the generation dirty");
});

// ---- the message: honest, scoped, only for the clean-out-of-span case

test("spanScopedMessage names the clean symbol, the out-of-span count, and the file basename", () => {
  const v = spanScopedVerdict([outOfFile()], scope());
  const m = spanScopedMessage(v, "bloom_membership");
  assert.ok(typeof m === "string", "clean-out-of-span produces a message");
  assert.ok(m.includes("bloom_membership"), `names the touched symbol: ${m}`);
  // Geometric claim only: no error INSIDE the span. Never "is clean" / "pre-existing".
  assert.ok(/no error landed inside/.test(m), `states no error landed inside the span: ${m}`);
  assert.ok(!/\bclean\b/.test(m) && !/pre-existing/.test(m), `does not overclaim clean/pre-existing: ${m}`);
  assert.ok(/\b1 error\b/.test(m), `states the out-of-span error count: ${m}`);
  assert.ok(/outside/.test(m), `states the errors are outside the touched span: ${m}`);
  assert.ok(m.includes("main.rs") && !m.includes("/crate/src/main.rs"), `names the file by basename, not absolute path: ${m}`);
});

test("spanScopedMessage pluralises the error count", () => {
  const v = spanScopedVerdict([outOfFile(), outOfFile({ spans: [span({ fileName: MAIN, byteStart: 200, byteEnd: 210 })] })], scope());
  const m = spanScopedMessage(v, "f");
  assert.ok(/\b2 errors\b/.test(m), `plural count: ${m}`);
});

test("spanScopedMessage is undefined for green and in-span: nothing new to say, v1 behaviour unchanged", () => {
  assert.strictEqual(spanScopedMessage(spanScopedVerdict([], scope()), "f"), undefined);
  assert.strictEqual(spanScopedMessage(spanScopedVerdict([inFn()], scope()), "f"), undefined);
});

test("spanScopedVerdict does not mutate its input", () => {
  const diags = [outOfFile(), warn()];
  const before = JSON.parse(JSON.stringify(diags));
  spanScopedVerdict(diags, scope());
  assert.deepStrictEqual(JSON.parse(JSON.stringify(diags)), before);
});
