// REVIEW rows for session-v77 phase 2 (adversarial review, session-v77/review-p2.md).
//
// Every row here is RED against the phase 2 tree on purpose: each one is the
// evidence for a finding, and turns green when the finding is fixed.
//
//   P2-1  R15: a "broke N tests" sentence from round 1 is overwritten by round 2's
//         re-run, so the press ends without it.
//   P2-2  O-025/O-026: an error the check could not convert to a byte offset is
//         told to the user as having "no file location". It has a file and a line.
//   P2-3  R19: one Repair Function press puts two status bar messages up for one
//         event (repair off, or nothing repairable, plus the span-scoped note).
//   P2-4  S77-5: the repair window refusal blames "the function and its errors"
//         for a share that also carries the injected API surface.
//   P2-5  R16: the refine re-check's held reason (e.g. "Run `dotnet restore`")
//         never reaches the user on the path that holds it.
//
// Run: node --test test/review-v77-p2-findings.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "review-v77-p2-findings",
  `export { RepairSession, spanScopedVerdict, spanScopedMessage } from "../src/core/repair";
export { runDelta, worseThanBeforeMessage } from "../src/core/testRepairEvidence";
export { arbitratePrompt, estimateTextTok } from "../src/core/promptBudget";\n`,
);
const { RepairSession, spanScopedVerdict, spanScopedMessage, runDelta, worseThanBeforeMessage, arbitratePrompt, estimateTextTok } =
  mod;
test.after(cleanup);

const SRC = fs.readFileSync(path.join(__dirname, "..", "src", "vscode", "oracleSurface.ts"), "utf8");

function testLegSource() {
  const start = SRC.indexOf("async function runTestLeg(");
  const end = SRC.indexOf("async function runRefine(");
  assert.ok(start > 0 && end > start, "harness: runTestLeg not found");
  return SRC.slice(start, end);
}

function refineSource() {
  const start = SRC.indexOf("async function runRefine(");
  assert.ok(start > 0, "harness: runRefine not found");
  return SRC.slice(start, start + 20000);
}

const rustResult = (cases) => ({
  ran: true,
  success: cases.every((c) => c.outcome === "pass"),
  cases,
  failures: cases.filter((c) => c.outcome === "fail").map((c) => ({ name: c.name, message: "assertion failed" })),
  passed: cases.filter((c) => c.outcome === "pass").length,
  failed: cases.filter((c) => c.outcome === "fail").length,
  ignored: 0,
  durationMs: 12,
  crateRoot: "/repo",
});

test("P2-1 R15: a test round 1 broke, still red after round 2, is still named in the press's final toast", () => {
  const leg = testLegSource();
  // Bind the model below to the loop's real bookkeeping.
  assert.ok(leg.includes("const delta = runDelta(beforeResult, afterResult);"), "harness: delta is no longer before->after");
  assert.ok(leg.includes("const firstResult = beforeResult;"), "harness: the press's first run is no longer kept");
  assert.ok(leg.includes("const net = runDelta(firstResult, afterResult);"), "harness: net is no longer first->after");
  assert.ok(leg.includes("broke = worseThanBeforeMessage(net, symbolName);"), "harness: broke is no longer reassigned per re-run");
  assert.ok(leg.includes("beforeResult = afterResult;"), "harness: the next round no longer compares against this round");

  // Round 0 (the first run): a red, b green. Round 1 fixes nothing and breaks b.
  // Round 2 changes neither. Both rounds were accepted.
  const run0 = rustResult([
    { name: "tests::a", outcome: "fail" },
    { name: "tests::b", outcome: "pass" },
  ]);
  const run1 = rustResult([
    { name: "tests::a", outcome: "fail" },
    { name: "tests::b", outcome: "fail" },
  ]);
  const run2 = rustResult([
    { name: "tests::a", outcome: "fail" },
    { name: "tests::b", outcome: "fail" },
  ]);
  let beforeResult = run0;
  let broke;
  for (const afterResult of [run1, run2]) {
    const net = runDelta(run0, afterResult);
    broke = worseThanBeforeMessage(net, "create_ca");
    beforeResult = afterResult;
  }
  // Before phase 2 the round-1 sentence was toasted the moment it was computed.
  // Now it is held, and round 2's re-run replaces it with undefined, so the press
  // ends on "2 covering test(s) ... still fail" and never says b was broken.
  assert.ok(
    broke !== undefined && /tests::b/.test(broke),
    `the press broke tests::b in round 1 and it is still red, but the held sentence at the end of the press is ${JSON.stringify(broke)}`,
  );
});

test("P2-2 O-026: an error with a file and a line is not told to the user as having no file location", () => {
  // csOracle/pyOracle set byteStart -1 when the file changed after the check, is
  // unreadable, or the region is past EOF. fileName and the line are still set.
  const diag = {
    level: "error",
    code: "CS0103",
    message: "The name 'x' does not exist in the current context",
    spans: [{ fileName: "/repo/src/Other.cs", byteStart: -1, byteEnd: -1, lineStart: 12, lineEnd: 12, columnStart: 5, columnEnd: 6, isPrimary: true }],
  };
  const scope = { filePath: "/repo/src/Target.cs", crateRoot: "/repo", byteStart: 10, byteEnd: 200, resolvePath: (_r, f) => f };
  const verdict = spanScopedVerdict([diag], scope);
  assert.strictEqual(verdict.unplaced, 1, "harness: the error must count as unplaced");
  const msg = spanScopedMessage(verdict, "Run");
  assert.ok(!/no file location/.test(msg), `the error names /repo/src/Other.cs line 12, and the status bar says: ${msg}`);

  // The mixed form (O-025) makes the same claim in its parenthetical.
  const placed = { ...diag, spans: [{ ...diag.spans[0], fileName: "/repo/src/Third.cs", byteStart: 5, byteEnd: 6 }] };
  const mixed = spanScopedMessage(spanScopedVerdict([placed, diag], scope), "Run");
  assert.ok(!/without a location/.test(mixed), `mixed form: ${mixed}`);
});

test("P2-3 R19: one press, one status bar message, when repair is off and the errors sit outside the function", () => {
  // The press's check: one error, in another file.
  const diag = {
    level: "error",
    code: "TS2304",
    message: "Cannot find name 'y'.",
    spans: [{ fileName: "/repo/src/other.ts", byteStart: 40, byteEnd: 41, lineStart: 3, lineEnd: 3, columnStart: 1, columnEnd: 2, isPrimary: true }],
  };
  const scope = { filePath: "/repo/src/target.ts", crateRoot: "/repo", byteStart: 10, byteEnd: 200, resolvePath: (_r, f) => f };
  const check = { success: false, diagnostics: [diag], durationMs: 1, crateRoot: "/repo" };

  // Bind the model to the two surfaces executeSession raises.
  assert.ok(SRC.includes('action.why === "disabled" && !gateClosed) {'), "harness: the repair-off branch moved");
  assert.ok(SRC.includes('surfaceNothingToDo("repair is off (column80.repairEnabled), so the errors were not repaired.");'));
  assert.ok(
    SRC.includes('const outOfSpanOnly = !check.success && spanScopedVerdict(check.diagnostics, scope).kind === "clean-out-of-span";'),
    "harness: the out-of-span guard moved",
  );
  assert.ok(
    /if \(!outOfSpanOnly\) \{\s*surfaceNothingToDo\("repair is off/.test(SRC),
    "harness: the repair-off line is no longer guarded",
  );
  assert.ok(SRC.includes('if (verdict.kind === "clean-out-of-span") {'), "harness: the span-scoped note moved");

  const session = new RepairSession("fngen", false, () => {}, { assertionShaped: () => false });
  const action = session.next(check, scope);
  assert.strictEqual(action.why, "disabled", "harness: repair off must surface why=disabled");
  const outOfSpanOnly = !check.success && spanScopedVerdict(check.diagnostics, scope).kind === "clean-out-of-span";
  const nothingToDo = action.why === "disabled" && !outOfSpanOnly ? 1 : 0;
  const spanNote = spanScopedMessage(spanScopedVerdict(check.diagnostics, scope), "run") !== undefined ? 1 : 0;
  // Both are setStatusBarMessage calls in the same tick. VS Code shows the most
  // recent one, so the 5s "repair is off" line is never visible under the 8s note.
  assert.ok(
    nothingToDo + spanNote <= 1,
    `one press raised ${nothingToDo + spanNote} status bar messages for one check: "repair is off ..." and "${spanScopedMessage(
      spanScopedVerdict(check.diagnostics, scope),
      "run",
    )}"`,
  );
});

test("P2-4 S77-5: the repair window refusal does not blame the function and its errors for the injected surface", () => {
  // generateRaw charges everything after the context blocks to `fixed`
  // (fnGenService.refuseUnfittablePrompt: injectedTokFor: () => 0), so the
  // injected API surface, the test evidence and the refine's usage windows all
  // land in fixedTok.
  const svc = fs.readFileSync(path.join(__dirname, "..", "src", "core", "fnGenService.ts"), "utf8");
  assert.ok(svc.includes("injectedTokFor: () => 0,"), "harness: generateRaw now attributes the injected share");
  const fn = "fn pick(x: u32) -> u32 {\n    x + missing\n}\n";
  const diag = "error[E0425]: cannot find value `missing` in this scope\n";
  const surface = "pub fn member_with_a_long_signature(&self, a: u32, b: u32) -> Result<u32, Error>;\n".repeat(400);
  const decision = arbitratePrompt({
    windowed: true,
    numCtx: 8192,
    maxTokens: 2048,
    developerTok: 0,
    fixedTok: estimateTextTok(fn + diag + surface) + 100,
    injectedBlocks: 0,
    injectedTokFor: () => 0,
  });
  assert.strictEqual(decision.verdict, "refuse");
  assert.ok(decision.fixedTok > decision.availableTok, "harness: this case takes the 'alone' branch");
  assert.ok(estimateTextTok(fn + diag) < decision.availableTok / 10, "harness: the function and its errors are tiny");
  assert.ok(
    !SRC.includes(" The function and its errors alone are too long for this model's window."),
    "the refusal tells the user the function and its errors alone overflow the window, when the share over the line " +
      "here is the injected API surface (and on the refine, the usage windows; on the test round, the failure evidence)",
  );
});

test("P2-5 R16: the refine's 'build fails with no error to show' toast carries the check's held reason", () => {
  const src = refineSource();
  const at = src.indexOf("the build fails with no error to show");
  assert.ok(at > 0, "harness: the R16 toast moved");
  // The held reason is suppressed on exactly this path (introduced=0, success=false).
  assert.ok(src.includes("if (introduced.length > 0 || after.success !== false) {"), "harness: the hold condition moved");
  const toast = src.slice(src.lastIndexOf("showWarningMessage(", at), at + 200);
  assert.ok(
    /heldReason/.test(toast),
    "the held reason (for C#, 'this project is not restored ... Run `dotnet restore`') is dropped, and the toast " +
      `that replaced it says only "no error to show": ${toast}`,
  );
});
