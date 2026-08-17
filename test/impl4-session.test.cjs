// Implementer oracle: repair.ts paths the blind set cannot see — the
// finished getter's lifecycle, double-fault sessions where repair output
// itself keeps failing, eligibility precedence collisions across the full
// kind x level x span grid, and prompt assembly over multiple eligible
// diagnostics with mixed rendered presence.
//
// Run: npm test

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl4-session",
  `export { RepairSession, classifyEligibility, assembleRepairPrompt } from "../src/core/repair";\n`
);
const { RepairSession, classifyEligibility, assembleRepairPrompt } = mod;
test.after(cleanup);

const primarySpan = () => ({
  fileName: "src/task1.rs", byteStart: 1, byteEnd: 2, lineStart: 1, lineEnd: 1,
  columnStart: 1, columnEnd: 2, isPrimary: true,
});
const err = (over = {}) => ({
  kind: "compile-error", level: "error", code: "E0308", message: "mismatched types",
  spans: [primarySpan()], suggestions: [], ...over,
});
const warn = () => ({
  kind: "compile-warning", level: "warning", code: "unused_variables",
  message: "unused variable", spans: [primarySpan()], suggestions: [],
});
const check = (...diagnostics) => ({
  success: diagnostics.every((d) => d.level !== "error"),
  diagnostics,
  durationMs: 3,
});

// ---- finished getter lifecycle (the blind set never reads it)

const finishedCases = [
  { name: "clean surface", feed: [check(warn())], why: "clean" },
  { name: "disabled surface", feed: [check(err())], why: "disabled", enabled: false },
  { name: "route-exhausted after fngen double fault", source: "fngen", feed: [check(err()), check(err())], why: "route-exhausted" },
  { name: "cap-exhausted after fim triple fault", source: "fim", feed: [check(err()), check(err()), check(err())], why: "cap-exhausted" },
];
for (const { name, feed, why, source = "fim", enabled = true } of finishedCases) {
  test(`finished flips exactly at the surface action: ${name}`, () => {
    const s = new RepairSession(source, enabled);
    let last;
    for (const c of feed) {
      assert.strictEqual(s.finished, false, "not finished while actions remain");
      last = s.next(c);
    }
    assert.strictEqual(last.kind, "surface");
    assert.strictEqual(last.why, why);
    assert.strictEqual(s.finished, true);
    assert.throws(() => s.next(check(err())), /after the session surfaced|Error/);
    assert.strictEqual(s.finished, true, "a rejected call does not un-finish");
  });
}

test("no log function: every path still works silently (log is evidence, not control flow)", () => {
  const s = new RepairSession("fim", true);
  assert.strictEqual(s.next(check(err())).kind, "repair");
  assert.strictEqual(s.next(check(err())).kind, "repair");
  assert.strictEqual(s.next(check(err())).why, "cap-exhausted");
});

// ---- double-fault: repair output failing check twice, mixed wave shapes

test("fim double fault where round 2's check adds NEW eligible errors: still capped, surface carries the final full list", () => {
  const lines = [];
  const s = new RepairSession("fim", true, (l) => lines.push(l));
  s.next(check(err({ code: "E0599" })));
  s.next(check(err({ code: "E0599" }), err({ code: "E0596" })));
  const finalList = [err({ code: "E0599" }), err({ code: "E0596" }), err({ code: "E0308" }), warn()];
  const a3 = s.next(check(...finalList));
  assert.strictEqual(a3.why, "cap-exhausted");
  assert.deepStrictEqual(a3.diagnostics, finalList, "the human sees the last check verbatim, warnings included");
  assert.ok(lines.includes("[repair] surface why=cap-exhausted errors=3 warnings=1"), `got ${JSON.stringify(lines)}`);
});

test("fngen double fault: the second failing check surfaces route-exhausted even when its errors are all freshly eligible", () => {
  const s = new RepairSession("fngen", true);
  const a1 = s.next(check(err({ code: "E0308" })));
  assert.deepStrictEqual([a1.round, a1.route], [1, "self-repair"]);
  const a2 = s.next(check(err({ code: "E0425" })));
  assert.strictEqual(a2.why, "route-exhausted");
  assert.strictEqual(s.roundsUsed, 1, "route exhaustion never consumes a round");
});

test("eligibility collapse mid-session: round 1 eligible, round 2's only errors assertion-shaped -> no-eligible BEFORE the cap, rounds stay at 1", () => {
  const lines = [];
  const s = new RepairSession("fim", true, (l) => lines.push(l));
  s.next(check(err()));
  const a2 = s.next(check(err({ kind: "assertion-failure", message: "assertion failed: x" })));
  assert.strictEqual(a2.kind, "surface");
  assert.strictEqual(a2.why, "no-eligible", "eligibility precedes the cap and the routing table");
  assert.strictEqual(s.roundsUsed, 1);
  assert.ok(lines.includes("[repair] ineligible code=E0308 reason=assertion-failure"), `got ${JSON.stringify(lines)}`);
});

// ---- eligibility precedence collisions beyond the blind grid

const collisionCases = [
  { name: "panic kind carrying assertion text: the text seatbelt wins", d: err({ kind: "panic", message: "assertion failed: left == right" }), want: { eligible: false, reason: "assertion-failure" } },
  { name: "warning-level panic with a span: rule 2 before rules 3-4", d: err({ kind: "panic", level: "warning", message: "weird producer" }), want: { eligible: false, reason: "warning" } },
  { name: "kind/level disagreement (compile-warning kind, error level): judged by level and location, eligible", d: err({ kind: "compile-warning", message: "producer mismatch" }), want: { eligible: true } },
  { name: "unicode NBSP before 'assertion' still trips the seatbelt (trimStart is Unicode-aware)", d: err({ message: "\u00a0assertion failed: x" }), want: { eligible: false, reason: "assertion-failure" } },
  { name: "'Assertion' capitalized is not the rustc family: eligible", d: err({ message: "Assertion failed: x" }), want: { eligible: true } },
];
for (const { name, d, want } of collisionCases) {
  test(`collision: ${name}`, () => {
    assert.deepStrictEqual(classifyEligibility(d), want);
  });
}

// ---- prompt assembly, multi-diagnostic edges the blind set left thin

test("multi-line rendered blocks keep interior blank lines; only the trailing edge is normalized", () => {
  const rendered = "error[E0308]: mismatched types\n\n  --> src/x.rs:1:1\n\n";
  const got = assembleRepairPrompt({ languageId: "rust", code: "fn f() {}\n", diagnostics: [{ ...err(), rendered }] });
  assert.ok(got.includes("mismatched types\n\n  --> src/x.rs:1:1\n```"), "interior blank line survives, trailing one does not");
});

test("empty diagnostics list still assembles: an empty fenced diagnostics block, structure intact", () => {
  const got = assembleRepairPrompt({ languageId: "rust", code: "fn f() {}\n", diagnostics: [] });
  assert.ok(got.includes("Compiler diagnostics:\n```\n```"), "no diagnostics renders an empty block, not a crash");
  assert.ok(got.endsWith("Output nothing outside the code block."));
});

// ---- P4-F1+F10: the const-eval assertion family cargo check CAN produce

const constEvalCases = [
  { name: "E0080 bare const assert (live-captured shape)", msg: "evaluation panicked: assertion failed: LIMIT > 0", want: { eligible: false, reason: "assertion-failure" } },
  { name: "E0080 left==right family behind the prefix", msg: "evaluation panicked: assertion `left == right` failed\n  left: 1\n right: 2", want: { eligible: false, reason: "assertion-failure" } },
  { name: "prefix with extra interior whitespace", msg: "evaluation panicked:   assertion failed: x", want: { eligible: false, reason: "assertion-failure" } },
  { name: "custom panic message is NOT assertion-shaped: the named P4-F9 hole, pinned honestly", msg: "evaluation panicked: limit must be one", want: { eligible: true } },
  { name: "non-assertion const-eval fault (divide by zero) stays eligible", msg: "attempt to divide `1_usize` by zero", want: { eligible: true } },
];
for (const { name, msg, want } of constEvalCases) {
  test(`const-eval assertion family: ${name}`, () => {
    assert.deepStrictEqual(classifyEligibility(err({ code: "E0080", message: msg })), want);
  });
}

test("parsed const-assert capture is refused end to end: parser output into the classifier, reason=assertion-failure", () => {
  const fs2 = require("fs");
  const path2 = require("path");
  const { mod: mod2, cleanup: cleanup2 } = require("./.blind-util.cjs").bundleCore(
    "impl4-session-oracle",
    `export { RustOracle } from "../src/core/compilerOracle";\n`
  );
  try {
    const raw = fs2.readFileSync(path2.join(__dirname, "fixtures", "rustc", "const-assert.json"), "utf8");
    const [d] = new mod2.RustOracle().parseCheckOutput(raw);
    assert.deepStrictEqual(classifyEligibility(d), { eligible: false, reason: "assertion-failure" });
  } finally {
    cleanup2();
  }
});

test("session with only a const-assert error: zero repair actions, refusal logged with code=E0080, why=no-eligible", () => {
  const lines = [];
  const s = new RepairSession("fngen", true, (l) => lines.push(l));
  const a = s.next(check(err({ code: "E0080", message: "evaluation panicked: assertion failed: LIMIT > 0" })));
  assert.strictEqual(a.kind, "surface");
  assert.strictEqual(a.why, "no-eligible");
  assert.strictEqual(s.roundsUsed, 0);
  assert.ok(lines.includes("[repair] ineligible code=E0080 reason=assertion-failure"), `got ${JSON.stringify(lines)}`);
});

// ---- P4-F3: span-scoped eligibility

// Scope now carries the crate root and a filesystem view so eligibility
// resolves span paths through the same resolveDiagnosticPath the mirror
// uses (P4-F12: identity, never suffix).
const scopeFs = (existing) => (p) => existing.includes(p);
const SCOPE = {
  filePath: "/w/crate/src/task1.rs",
  crateRoot: "/w/crate",
  byteStart: 200,
  byteEnd: 600,
  fileExists: scopeFs(["/w/crate/Cargo.toml", "/w/crate/src/task1.rs", "/w/crate/src/task3.rs"]),
};
const spanAt = (byteStart, byteEnd, over = {}) => ({
  fileName: "src/task1.rs", byteStart, byteEnd, lineStart: 1, lineEnd: 1,
  columnStart: 1, columnEnd: 2, isPrimary: true, ...over,
});

const scopeCases = [
  { name: "primary inside the scope: eligible", spans: [spanAt(250, 300)], want: { eligible: true } },
  { name: "primary straddling the scope start: eligible (intersection, not containment)", spans: [spanAt(150, 250)], want: { eligible: true } },
  { name: "primary entirely before the function: out-of-span", spans: [spanAt(10, 50)], want: { eligible: false, reason: "out-of-span" } },
  { name: "primary entirely after the function: out-of-span", spans: [spanAt(700, 750)], want: { eligible: false, reason: "out-of-span" } },
  { name: "zero-width primary inside (E0596 shape): eligible", spans: [spanAt(260, 260)], want: { eligible: true } },
  { name: "zero-width primary on the scope boundary: eligible", spans: [spanAt(200, 200)], want: { eligible: true } },
  { name: "zero-width primary outside: out-of-span", spans: [spanAt(199, 199)], want: { eligible: false, reason: "out-of-span" } },
  { name: "same bytes, different file: out-of-span", spans: [spanAt(250, 300, { fileName: "src/task3.rs" })], want: { eligible: false, reason: "out-of-span" } },
  { name: "workspace-relative fileName resolves to the same absolute file: eligible", spans: [spanAt(250, 300, { fileName: "crate/src/task1.rs" })], want: { eligible: true } },
  { name: "basename fragment 'ask1.rs' resolves elsewhere and never matches", spans: [spanAt(250, 300, { fileName: "ask1.rs" })], want: { eligible: false, reason: "out-of-span" } },
  { name: "one of two primaries in scope: eligible", spans: [spanAt(10, 20), spanAt(250, 300)], want: { eligible: true } },
  { name: "only a secondary span in scope: out-of-span (primaries decide)", spans: [spanAt(250, 300, { isPrimary: false }), spanAt(10, 20)], want: { eligible: false, reason: "out-of-span" } },
];
for (const { name, spans, want } of scopeCases) {
  test(`scope eligibility: ${name}`, () => {
    assert.deepStrictEqual(classifyEligibility(err({ spans }), SCOPE), want);
  });
}

// ---- P4-F12: identity via resolveDiagnosticPath, never suffix

// The reviewer's collision repro: a workspace ROOT crate error at
// "src/lib.rs" (= /w/src/lib.rs, rustc paths are workspace-root-relative)
// against a member scope /w/member/src/lib.rs. Suffix matching ruled the
// foreign error in-span; path identity refuses it.
const WS_FILES = [
  "/w/Cargo.toml",
  "/w/src/lib.rs",
  "/w/member/Cargo.toml",
  "/w/member/src/lib.rs",
];
const MEMBER_SCOPE = {
  filePath: "/w/member/src/lib.rs",
  crateRoot: "/w/member",
  byteStart: 0,
  byteEnd: 500,
  fileExists: scopeFs(WS_FILES),
  // Q6: the anchor is the outermost manifest that DECLARES a workspace, so a
  // fixture built from a path list has to say which one that is. This one
  // always meant /w; under the old rule any ancestor manifest anchored, which
  // was the defect.
  readManifest: (p) => (p === "/w/Cargo.toml" ? "[workspace]\nmembers = [\"member\"]\n" : '[package]\nname = "member"\n'),
};

test("P4-F12 collision repro: workspace-root src/lib.rs error is out-of-span for a member scope, zero suffix leakage", () => {
  const foreign = err({ spans: [spanAt(10, 20, { fileName: "src/lib.rs" })] });
  assert.deepStrictEqual(classifyEligibility(foreign, MEMBER_SCOPE), { eligible: false, reason: "out-of-span" });
});

test("P4-F12 true member path: member-prefixed fileName resolves to the scope file and stays eligible", () => {
  const own = err({ spans: [spanAt(10, 20, { fileName: "member/src/lib.rs" })] });
  assert.deepStrictEqual(classifyEligibility(own, MEMBER_SCOPE), { eligible: true });
});

test("P4-F12 session end-to-end: the colliding foreign error produces zero repair actions and a logged out-of-span refusal", () => {
  const lines = [];
  const s = new RepairSession("fim", true, (l) => lines.push(l));
  const foreign = err({ code: "E0308", spans: [spanAt(10, 20, { fileName: "src/lib.rs" })] });
  const a = s.next(check(foreign), MEMBER_SCOPE);
  assert.strictEqual(a.kind, "surface");
  assert.strictEqual(a.why, "no-eligible-in-span");
  assert.strictEqual(s.roundsUsed, 0, "zero model calls: the burn-a-round bug is dead");
  assert.ok(lines.includes("[repair] ineligible code=E0308 reason=out-of-span"), `got ${JSON.stringify(lines)}`);
});

test("scope precedence: assertion shape refuses before the span test even when out of scope, and no-location precedes out-of-span", () => {
  const outOfScopeAssertion = err({ code: "E0080", message: "evaluation panicked: assertion failed: x", spans: [spanAt(10, 20)] });
  assert.deepStrictEqual(classifyEligibility(outOfScopeAssertion, SCOPE), { eligible: false, reason: "assertion-failure" });
  const spanless = err({ spans: [] });
  assert.deepStrictEqual(classifyEligibility(spanless, SCOPE), { eligible: false, reason: "no-location" });
});

test("session (P4-F3): unrelated crate errors only -> zero model rounds, why=no-eligible-in-span, out-of-span refusals logged", () => {
  const lines = [];
  const s = new RepairSession("fim", true, (l) => lines.push(l));
  const unrelated1 = err({ code: "E0308", spans: [spanAt(10, 50)] });
  const unrelated2 = err({ code: "E0425", spans: [spanAt(700, 750, { fileName: "src/task3.rs" })] });
  const a = s.next(check(unrelated1, unrelated2, warn()), SCOPE);
  assert.strictEqual(a.kind, "surface");
  assert.strictEqual(a.why, "no-eligible-in-span");
  assert.deepStrictEqual(a.diagnostics.length, 3, "everything still surfaces to the human");
  assert.strictEqual(s.roundsUsed, 0);
  assert.ok(lines.includes("[repair] ineligible code=E0308 reason=out-of-span"), `got ${JSON.stringify(lines)}`);
  assert.ok(lines.includes("[repair] ineligible code=E0425 reason=out-of-span"), `got ${JSON.stringify(lines)}`);
  assert.ok(lines.includes("[repair] surface why=no-eligible-in-span errors=2 warnings=1"), `got ${JSON.stringify(lines)}`);
  assert.ok(!lines.some((l) => l.startsWith("[repair] decision")), "no routing ever ran");
});

test("session (P4-F3): mixed in/out errors -> repair action carries ONLY the in-span diagnostics", () => {
  const s = new RepairSession("fim", true);
  const inSpan = err({ code: "E0308", spans: [spanAt(250, 300)] });
  const outSpan = err({ code: "E0599", spans: [spanAt(10, 50)] });
  const a = s.next(check(outSpan, inSpan), SCOPE);
  assert.strictEqual(a.kind, "repair");
  assert.deepStrictEqual(a.eligible, [inSpan], "the model never sees the unrelated error");
});

test("session (P4-F3): assertion-only refusals still surface why=no-eligible, not the in-span variant", () => {
  const s = new RepairSession("fim", true);
  const a = s.next(check(err({ code: "E0080", message: "evaluation panicked: assertion failed: x", spans: [spanAt(250, 300)] })), SCOPE);
  assert.strictEqual(a.why, "no-eligible", "no out-of-span refusal happened, so the honest why is no-eligible");
});

test("session without a scope keeps the phase-4 contract behavior byte for byte (blind set compatibility)", () => {
  const lines = [];
  const s = new RepairSession("fim", true, (l) => lines.push(l));
  const a = s.next(check(err({ spans: [spanAt(10, 50)] })));
  assert.strictEqual(a.kind, "repair", "no scope, no span filtering");
  assert.ok(lines.includes("[repair] decision round=1/2 route=cross-model source=fim eligible=1"));
});
