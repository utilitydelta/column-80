// IMPLEMENTER tests for session-v35 item 2: fn-gen gets a SECOND repair round
// when the error count is still falling.
//
// The defect: `RepairSession` routed on (source, round) and fngen's round 2 was
// `undefined`, so fn-gen got exactly one round against a hard cap of two and
// quit with the count still dropping. The capture went 12 errors, then 2, then
// 1, and stopped.
//
// What is pinned here, in order of how badly a regression would hurt:
//
//   1. The CAP IS STILL HARD AT 2. This grants the round the table already
//      refused; it must not become a third round, ever, however fast the count
//      is falling. The cap branch precedes routing and this file proves it.
//   2. Falling grants, flat and rising refuse.
//   3. FIM is untouched.
//   4. A round is still consumed BEFORE the model call, so an abandoned round
//      counts (the conservative direction for a hard cap).
//
// Run: SKIP_LIVE=1 node --test test/impl-v35-round2.test.cjs

const test = require("node:test");
const assert = require("node:assert/strict");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-v35-round2",
  `export { RepairSession } from "../src/core/repair";\n`,
);
const { RepairSession } = mod;
test.after(cleanup);

const span = () => ({
  fileName: "src/lib.rs", byteStart: 1, byteEnd: 2, lineStart: 1, lineEnd: 1,
  columnStart: 1, columnEnd: 2, isPrimary: true,
});
const err = (code = "E0308") => ({
  kind: "compile-error", level: "error", code, message: "mismatched types",
  spans: [span()], suggestions: [],
});
/** A check carrying exactly `n` errors. */
const errs = (n) => ({
  success: n === 0,
  diagnostics: Array.from({ length: n }, () => err()),
  durationMs: 1,
});

// ===== 1. The cap is still hard at 2 ========================================

test("fngen: a THIRD round is refused as cap-exhausted even while the count is still falling", () => {
  const s = new RepairSession("fngen", true);
  assert.equal(s.next(errs(12)).kind, "repair"); // round 1
  assert.equal(s.next(errs(6)).kind, "repair"); // round 2, falling
  const third = s.next(errs(2)); // still falling, and it must NOT matter
  assert.equal(third.kind, "surface");
  assert.equal(third.why, "cap-exhausted");
  assert.equal(s.roundsUsed, 2);
});

test("fim: a third round is cap-exhausted too, unchanged by item 2", () => {
  const s = new RepairSession("fim", true);
  assert.equal(s.next(errs(9)).kind, "repair");
  assert.equal(s.next(errs(4)).kind, "repair");
  assert.equal(s.next(errs(1)).why, "cap-exhausted");
});

// ===== 2. Falling grants, flat and rising refuse ============================

test("fngen: round 2 is GRANTED when the error count fell", () => {
  const s = new RepairSession("fngen", true);
  s.next(errs(12));
  const second = s.next(errs(2));
  assert.equal(second.kind, "repair");
  assert.equal(second.round, 2);
  assert.equal(second.route, "self-repair");
});

test("fngen: round 2 is granted for a fall of exactly one", () => {
  const s = new RepairSession("fngen", true);
  s.next(errs(3));
  assert.equal(s.next(errs(2)).kind, "repair");
});

test("fngen: round 2 is REFUSED when the count did not move", () => {
  const s = new RepairSession("fngen", true);
  s.next(errs(4));
  const second = s.next(errs(4));
  assert.equal(second.kind, "surface");
  assert.equal(second.why, "route-exhausted");
});

test("fngen: round 2 is REFUSED when the count went up", () => {
  const s = new RepairSession("fngen", true);
  s.next(errs(2));
  const second = s.next(errs(5));
  assert.equal(second.kind, "surface");
  assert.equal(second.why, "route-exhausted");
});

test("fngen: the refusal says WHY on the channel, not just route-exhausted", () => {
  const lines = [];
  const s = new RepairSession("fngen", true, (l) => lines.push(l));
  s.next(errs(4));
  s.next(errs(4));
  const refusal = lines.find((l) => l.includes("round 2 refused"));
  assert.ok(refusal, `no refusal line on the channel: ${JSON.stringify(lines)}`);
  assert.match(refusal, /errors 4 -> 4, not falling/);
});

// ===== 3. FIM is untouched ==================================================

test("fim: round 2 is self-repair whether or not the count fell", () => {
  for (const [a, b] of [[9, 4], [4, 4], [2, 7]]) {
    const s = new RepairSession("fim", true);
    const first = s.next(errs(a));
    assert.equal(first.route, "cross-model", `fim round 1 with ${a} errors`);
    const second = s.next(errs(b));
    assert.equal(second.kind, "repair", `fim round 2 with ${a} -> ${b}`);
    assert.equal(second.route, "self-repair");
  }
});

// ===== 4. The round is consumed before the model call =======================

test("fngen: a granted round 2 is consumed even if the caller abandons it", () => {
  const s = new RepairSession("fngen", true);
  s.next(errs(8));
  assert.equal(s.roundsUsed, 1);
  s.next(errs(3)); // granted; the caller never makes the model call
  assert.equal(s.roundsUsed, 2, "an abandoned round still counts against the cap");
});

test("fngen: a REFUSED round 2 does not consume a round, it ends the session", () => {
  const s = new RepairSession("fngen", true);
  s.next(errs(3));
  assert.equal(s.roundsUsed, 1);
  s.next(errs(3));
  assert.equal(s.roundsUsed, 1, "a refusal is not a consumed round");
  assert.equal(s.finished, true);
});

// ===== The comparison is against the GRANT, not the last call seen ==========

test("fngen: a clean check ends the session before any falling comparison runs", () => {
  const s = new RepairSession("fngen", true);
  s.next(errs(5));
  const clean = s.next(errs(0));
  assert.equal(clean.kind, "surface");
  assert.equal(clean.why, "clean");
});
