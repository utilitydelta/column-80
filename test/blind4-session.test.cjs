// Blind oracle: RepairSession, the state machine (phase4-surface.md
// "RepairSession, the state machine" + contract 4a structural 2-cap + wave
// semantics). Assertion message text comes from the committed real cargo
// test panic capture. Never read src/**. Expected red on stubs.
//
// Check results are fed as { success, diagnostics, durationMs } per the
// OracleCheckResult fields the surface names (success, durationMs,
// parsed diagnostics).
//
// Run: npm test

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "blind4-session",
  `export { RepairSession } from "../src/core/repair";\n`
);
const { RepairSession } = mod;
test.after(cleanup);

const panicText = fs.readFileSync(path.join(__dirname, "fixtures", "rustc", "assertion-panic.txt"), "utf8");
const aStart = panicText.indexOf("assertion `left == right` failed");
const REAL_ASSERTION_MSG = panicText.slice(aStart, panicText.indexOf("\n\n", aStart));

const primarySpan = () => ({
  fileName: "src/task1.rs", byteStart: 475, byteEnd: 483, lineStart: 14, lineEnd: 14,
  columnStart: 21, columnEnd: 29, isPrimary: true, label: "expected `u64`, found `&str`",
});
const err = (over = {}) => ({
  kind: "compile-error", level: "error", code: "E0308", message: "mismatched types",
  spans: [primarySpan()], suggestions: [], rendered: "error[E0308]: mismatched types\n", ...over,
});
const warn = (over = {}) => ({
  kind: "compile-warning", level: "warning", code: "unused_variables",
  message: "unused variable: `scratch_total`", spans: [primarySpan()], suggestions: [], ...over,
});
const assertionErr = () => err({ kind: "assertion-failure", code: undefined, message: REAL_ASSERTION_MSG, rendered: undefined });
const noLocErr = () => err({ spans: [], rendered: "error: aborting\n" });
const check = (...diagnostics) => ({ success: diagnostics.every((d) => d.level !== "error"), diagnostics, durationMs: 7 });

const session = (source, enabled = true) => {
  const lines = [];
  const s = new RepairSession(source, enabled, (l) => lines.push(l));
  return { s, lines };
};

// ---- contract 4a: the structural 2-cap [surface: 'Contract 4a, the structural 2-cap']

test("fim source: exactly two repair actions ever, then cap-exhausted, then next() throws; roundsUsed never leaves {0,1,2}", () => {
  const { s, lines } = session("fim");
  assert.strictEqual(s.roundsUsed, 0);

  const a1 = s.next(check(err()));
  assert.strictEqual(a1.kind, "repair");
  assert.strictEqual(a1.round, 1);
  assert.strictEqual(a1.route, "cross-model", "round 1 for fim: 30b repairs the 1.5b's output");
  assert.strictEqual(s.roundsUsed, 1, "roundsUsed advances at the moment next() returns a repair action");

  const a2 = s.next(check(err()));
  assert.strictEqual(a2.kind, "repair");
  assert.strictEqual(a2.round, 2);
  assert.strictEqual(a2.route, "self-repair", "round 2: 30b repairs its own round-1 repair");
  assert.strictEqual(s.roundsUsed, 2);

  const a3 = s.next(check(err()));
  assert.strictEqual(a3.kind, "surface");
  assert.strictEqual(a3.why, "cap-exhausted");
  assert.strictEqual(s.roundsUsed, 2, "no code path advances past 2");

  assert.throws(() => s.next(check(err())), Error, "calling past the end is a programming error, not a decision");
  assert.ok(lines.some((l) => l === "[repair] decision round=1/2 route=cross-model source=fim eligible=1"), `decision line round 1, got ${JSON.stringify(lines)}`);
  assert.ok(lines.some((l) => l === "[repair] decision round=2/2 route=self-repair source=fim eligible=1"), `decision line round 2, got ${JSON.stringify(lines)}`);
  assert.ok(lines.some((l) => l === "[repair] surface why=cap-exhausted errors=1 warnings=0"), `surface line, got ${JSON.stringify(lines)}`);
});

test("structural cap under hostile feeding: pound the session with error-bearing checks, count repair actions, never a third [surface: 'assert exactly two repair actions ever come out']", () => {
  const { s } = session("fim");
  let repairs = 0;
  let capSurfaces = 0;
  for (let i = 0; i < 10; i++) {
    let action;
    try {
      action = s.next(check(err(), err({ code: "E0596" }), warn()));
    } catch {
      break; // finished sessions throw; that is the structural end, not a loop continuation
    }
    if (action.kind === "repair") {
      repairs++;
      assert.ok(action.round <= 2, `round ${action.round} escaped the cap`);
    } else {
      capSurfaces++;
      assert.strictEqual(action.why, "cap-exhausted");
    }
    assert.ok([0, 1, 2].includes(s.roundsUsed), `roundsUsed=${s.roundsUsed} left the 0|1|2 type`);
  }
  assert.strictEqual(repairs, 2, "exactly two repair actions ever");
  assert.strictEqual(capSurfaces, 1, "the third call surfaces with cap-exhausted, every later call throws");
});

// ---- routing table [surface: 'Routing table on (source, roundsUsed + 1)']

test("fngen source: one self-repair round, then route-exhausted (never cap-exhausted), then throws [surface: 'fngen ... round 2 none: surface why=route-exhausted']", () => {
  const { s, lines } = session("fngen");
  const a1 = s.next(check(err()));
  assert.strictEqual(a1.kind, "repair");
  assert.strictEqual(a1.round, 1);
  assert.strictEqual(a1.route, "self-repair", "no bigger model to cross to");
  assert.strictEqual(s.roundsUsed, 1);

  const a2 = s.next(check(err()));
  assert.strictEqual(a2.kind, "surface");
  assert.strictEqual(a2.why, "route-exhausted", "the table can end a session earlier than the cap");
  assert.strictEqual(s.roundsUsed, 1, "route exhaustion is not a round");

  assert.throws(() => s.next(check(err())), Error);
  assert.ok(lines.some((l) => l === "[repair] decision round=1/2 route=self-repair source=fngen eligible=1"), `got ${JSON.stringify(lines)}`);
  assert.ok(lines.some((l) => l === "[repair] surface why=route-exhausted errors=1 warnings=0"), `got ${JSON.stringify(lines)}`);
});

test("repair action carries the eligible diagnostics only [surface: 'A table hit returns { kind: \"repair\", round, route, eligible }']", () => {
  const { s, lines } = session("fim");
  const good = err();
  const action = s.next(check(good, assertionErr(), noLocErr(), warn()));
  assert.strictEqual(action.kind, "repair");
  assert.deepStrictEqual(action.eligible, [good], "assertion-shaped, span-less, and warning diagnostics never reach a repair action");
  assert.ok(lines.some((l) => l === "[repair] decision round=1/2 route=cross-model source=fim eligible=1"), `eligible=<k> counts eligible errors, got ${JSON.stringify(lines)}`);
});

// ---- decision order, first match wins [surface: 'Decision order, first match wins']

test("clean check ends the session: why=clean, warnings still surfaced in the full list [surface: rule 2 + 'warnings still reach the human']", () => {
  const { s, lines } = session("fim");
  const w1 = warn();
  const w2 = warn({ code: "dead_code", message: "function `f` is never used" });
  const a = s.next(check(w1, w2));
  assert.strictEqual(a.kind, "surface");
  assert.strictEqual(a.why, "clean");
  assert.deepStrictEqual(a.diagnostics, [w1, w2], "diagnostics = the full list");
  assert.strictEqual(s.roundsUsed, 0);
  assert.throws(() => s.next(check()), Error, "finished");
  assert.ok(lines.some((l) => l === "[repair] surface why=clean errors=0 warnings=2"), `got ${JSON.stringify(lines)}`);
});

test("clean precedes disabled: enabled=false with a clean check surfaces why=clean, not why=disabled [surface: rule 2 before rule 3]", () => {
  const { s } = session("fim", false);
  const a = s.next(check(warn()));
  assert.strictEqual(a.why, "clean");
});

test("disabled: errors surface with why=disabled, no eligibility pass runs, no ineligible lines even for assertion errors [surface: rule 3 before rule 4]", () => {
  const { s, lines } = session("fim", false);
  const e = err();
  const a = s.next(check(e, assertionErr(), warn()));
  assert.strictEqual(a.kind, "surface");
  assert.strictEqual(a.why, "disabled");
  assert.strictEqual(a.diagnostics.length, 3, "full list; the check already ran, disabling repair never disables the oracle");
  assert.strictEqual(s.roundsUsed, 0, "zero rounds consumed");
  assert.ok(!lines.some((l) => l.startsWith("[repair] ineligible")), `rule 3 fired first: no eligibility pass, got ${JSON.stringify(lines)}`);
  assert.ok(!lines.some((l) => l.startsWith("[repair] decision")), "no routing");
  assert.ok(lines.some((l) => l === "[repair] surface why=disabled errors=2 warnings=1"), `got ${JSON.stringify(lines)}`);
});

// ---- contract 4b: assertion refusal with evidence [surface: 'Contract 4b' + evidence formats]

test("a session whose only errors are assertion failures: why=no-eligible, zero repair actions, every refusal logged with the honest reason", () => {
  const { s, lines } = session("fngen");
  const a = s.next(check(assertionErr(), assertionErr(), warn()));
  assert.strictEqual(a.kind, "surface");
  assert.strictEqual(a.why, "no-eligible");
  assert.strictEqual(a.diagnostics.length, 3, "full list");
  assert.strictEqual(s.roundsUsed, 0, "zero model calls: no repair action ever existed to execute");
  const ineligible = lines.filter((l) => l === "[repair] ineligible code=- reason=assertion-failure");
  assert.strictEqual(ineligible.length, 2, `every ineligible error logs its own line, got ${JSON.stringify(lines)}`);
  assert.ok(lines.some((l) => l === "[repair] surface why=no-eligible errors=2 warnings=1"), `got ${JSON.stringify(lines)}`);
  assert.throws(() => s.next(check(err())), Error, "finished: an assertion-only session never becomes repairable later");
});

test("ineligible evidence carries the code when present: a span-less coded error logs code=<code> reason=no-location [surface: '[repair] ineligible code=<code|-> reason=...']", () => {
  const { s, lines } = session("fim");
  const a = s.next(check(noLocErr()));
  assert.strictEqual(a.why, "no-eligible");
  assert.ok(lines.some((l) => l === "[repair] ineligible code=E0308 reason=no-location"), `got ${JSON.stringify(lines)}`);
});

// ---- wave semantics [surface: 'Wave semantics']

test("wave: round 1 clears the name error, the unmasked borrow error is just the next check result and gets round 2 [surface: 'Newly unmasked errors are just the next check result']", () => {
  const { s } = session("fim");
  const nameErr = err({ code: "E0599", message: "no method named `pushh` found", rendered: "error[E0599]\n" });
  const borrowErr = err({ code: "E0596", message: "cannot borrow `result` as mutable, as it is not declared as mutable", rendered: "error[E0596]\n" });
  const a1 = s.next(check(nameErr));
  assert.strictEqual(a1.kind, "repair");
  const a2 = s.next(check(borrowErr));
  assert.strictEqual(a2.kind, "repair", "rounds remaining: the new wave may be repaired");
  assert.deepStrictEqual(a2.eligible, [borrowErr]);
  const a3 = s.next(check(err({ code: "E0308" })));
  assert.strictEqual(a3.kind, "surface");
  assert.strictEqual(a3.why, "cap-exhausted", "a third wave surfaces; there is no branch that could loop past the cap");
});

test("wave: a clean re-check after round 1 ends the session with why=clean, no further looping [surface: 'A clean check ends the session, warnings surfaced']", () => {
  const { s, lines } = session("fim");
  const a1 = s.next(check(err()));
  assert.strictEqual(a1.kind, "repair");
  const leftoverWarn = warn();
  const a2 = s.next(check(leftoverWarn));
  assert.strictEqual(a2.kind, "surface");
  assert.strictEqual(a2.why, "clean");
  assert.deepStrictEqual(a2.diagnostics, [leftoverWarn]);
  assert.strictEqual(s.roundsUsed, 1);
  assert.throws(() => s.next(check()), Error, "clean round surfacing does NOT loop");
  assert.ok(lines.some((l) => l === "[repair] surface why=clean errors=0 warnings=1"), `got ${JSON.stringify(lines)}`);
});

// ---- sessions are independent; no reset path [surface: 'There is no reset, no second counter']

test("one session per accepted generation: a fresh session starts at 0 regardless of a sibling's exhaustion", () => {
  const { s: worn } = session("fim");
  worn.next(check(err()));
  worn.next(check(err()));
  assert.strictEqual(worn.roundsUsed, 2);
  const { s: fresh } = session("fim");
  assert.strictEqual(fresh.roundsUsed, 0);
  assert.strictEqual(fresh.next(check(err())).round, 1);
  assert.strictEqual(worn.roundsUsed, 2, "sibling untouched");
});
