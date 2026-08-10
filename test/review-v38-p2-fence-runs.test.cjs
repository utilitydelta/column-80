// Adversarial review: session-v38 item 2, CommonMark fence runs in
// src/core/instructPostprocess.ts.
//
// Every row here ran. Rows tagged [DEFECT] are RED against the shipped change
// and each one is a claim the change makes about itself. Rows tagged [FINE]
// are green and exist so a later edit cannot quietly take them away.
//
// Run: SKIP_LIVE=1 node --test test/review-v38-p2-fence-runs.test.cjs
//
// 2026-08-10: the nine `todo:` rows are gone. A test that must be red is not a
// test. Each ruling is kept verbatim as a comment above its row and each row
// records what it USED to assert. Three rows (the run-4-in-a-run-3 block, the
// test-splice fence leak, the 16.7%/16.2% arithmetic) now assert the value the
// shipped code actually produces. The other six score a capture corpus that the
// private split deleted from this repo; they cannot be re-derived here and were
// not guessed, so they SKIP on the missing capture, the same way ROW 2 already
// did. Nothing above this note was edited.
//
// 2026-08-10, LATER (session-v49 phase 0): those six rows are now DELETED, on
// the human's ruling. They were kept as skips on the chance the captures came
// back; the human checked their other machine and they are not there, so the
// loss is settled rather than pending (session-v48/scraps.md S48-9). A row that
// can never run again is not a guard — it is a title that reads like one, and
// this file's own first paragraph says every row here ran.
//
// What went with them: the six titles, their ruling comments, and the claims
// each had REFUTED. That reasoning is not lost — it is recorded in
// session-v38's own archive and in S48-1. What is lost is the ability to
// re-derive the numbers, and that was already true before the rows were removed.
//
// ONE ROW THAT SURVIVES AND STILL CANNOT RUN: `[DEFECT] the 4/3 capture` scores
// the same deleted `repair-v38-fence.json`, so this file legitimately still
// reports one skip. It was not in the human's six and was not touched; it is
// raised in session-v49/scraps.md for a ruling of its own.

// THE MEASUREMENT RIG LIVES IN A DIFFERENT REPOSITORY (2026-08-10). It and the
// session archives were split into a private repo because they carry corpora
// taken against private client code and cannot be published, so a public clone
// has no `session-complxity-research/` and the rows below have no subject.
//
// The whole file skips, with the reason on the channel. It SKIPS rather than
// passing vacuously: a row that goes green when the thing it tests is absent is
// the false green this suite exists to prevent. Where a baseline can be
// vendored instead, vendor it (see test/fixtures/prompt) and do not use this.
const { RIG_PRESENT, SKIP_REASON } = require("./.rig-present.cjs");
if (!RIG_PRESENT) {
  require("node:test")("rig-dependent rows", { skip: SKIP_REASON }, () => {});
  return;
}

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "review-v38-p2",
  `export { extractFirstCodeBlock, postprocessInstructOutput, extractTestModule, extractTestFunctions, extractRequestedFunction } from "../src/core/instructPostprocess";\n`
);
const {
  extractFirstCodeBlock,
  postprocessInstructOutput,
  extractTestModule,
  extractTestFunctions,
  extractRequestedFunction,
} = mod;
test.after(cleanup);

const DATA = path.join(__dirname, "..", "session-complxity-research", "data");
// Every capture this file scores lives under `session-complxity-research/`, which
// `.gitignore`'s `session*/` excludes: roughly 700KB of measurement output that
// does not belong in the extension. A clone therefore has the row and not its
// evidence, and the read throws, which reports a missing artifact as a failed
// claim. `needsCapture` skips there and runs for real wherever the capture IS
// present. Added 2026-08-03 with the 1.1.0 release, the first time these v37/v38
// review files ever ran on CI.
const needsCapture = (ctx, ...files) =>
  files.some((f) => !fs.existsSync(path.join(DATA, f)))
    ? (ctx.skip(`capture(s) absent (gitignored session artifact): ${files.join(", ")}`), true)
    : false;

// The fn-gen service's code-fence guard, copied verbatim from
// src/core/fnGenService.ts (the `text.split("\n").some(...)` line).
const fenceGuardRefuses = (text) => text.split("\n").some((line) => /^(```|~~~)/.test(line.trim()));

// The opening run on a trimmed line, or null.
const runOf = (trimmed) => {
  const m = /^(`{3,}|~{3,})/.exec(trimmed);
  return m ? m[1] : null;
};

// Walk one captured reply and return its (openLen/closeLen) pairs. A closer
// here is a bare run of the SAME character of ANY length, so BOTH directions
// of mismatch are visible. This is the method; the denominator is stated at
// each use.

function everyStringIn(v, sink) {
  if (typeof v === "string") sink(v);
  else if (Array.isArray(v)) v.forEach((x) => everyStringIn(x, sink));
  else if (v && typeof v === "object") Object.values(v).forEach((x) => everyStringIn(x, sink));
}

// ---------------------------------------------------------------------------
// ROW 2 [DEFECT, HIGH]. The concrete cost of ROW 1: that reply was ACCEPTED at
// HEAD and is REFUSED by the change. A complete 42-line function is thrown away.
// ---------------------------------------------------------------------------
test("[DEFECT] the 4/3 capture: HEAD extracts a complete function, the change hands the guard the whole reply", (ctx) => {
  if (needsCapture(ctx, "repair-v38-fence.json")) {
    return;
  }
  const rows = JSON.parse(fs.readFileSync(path.join(DATA, "repair-v38-fence.json"), "utf8"));
  const row = rows.find((r) => r.id.includes("capture_replication_snapshot"));
  assert.ok(row, "the capture_replication_snapshot row must still be in the data");
  const raw = row.rounds[0].raw;
  const fences = raw.split("\n").filter((l) => runOf(l.trim())).map((l) => l.trim());
  assert.deepEqual(fences, ["````rust", "```"], "this is the open-4 / close-3 shape");
  assert.equal(
    fenceGuardRefuses(postprocessInstructOutput(raw)),
    false,
    "a real captured repair that HEAD accepted is now refused by the fence guard",
  );
});

// ---------------------------------------------------------------------------
// ROW 6 [DEFECT, MEDIUM]. A NEW failure mode, and it is worse in kind than the
// one being fixed. A bare run-4 line at column 0 inside a run-3 block now
// closes it early. The extractor returns a truncated function, the fence guard
// does NOT fire (there is no fence line left in the truncation), and
// extractRequestedFunction keeps the tail unjudged, so the broken text reaches
// the splice. HEAD returned the whole function. Refusal became silent damage.
// ---------------------------------------------------------------------------
// RULING (verbatim, was the `todo:` text):
// "FIXED by the phase-2 loop-back, and it is the reason the shipped rule is not CommonMark. A longer
// run no longer closes a shorter opener, so a run-4 line inside a run-3 block is content exactly as at
// HEAD and this silent truncation cannot occur. The assertion is left describing the first cut."
// USED TO ASSERT: fenceGuardRefuses(postprocessInstructOutput(reply)) === false, i.e. the truncation
// slips past the guard unseen. It does not. The block keeps the whole function, so the interior run-4
// lines of the Rust raw string are still in the text and the guard REFUSES it. A visible refusal, not a
// silent bad write. Today's `true` is the correct behaviour.
test("SUPERSEDED: [was DEFECT] a bare run-4 line inside a run-3 block is content, and the guard refuses the reply outright", () => {
  const reply = '```rust\nfn f() -> &\'static str {\n    r#"\n````\nexample\n````\n"#\n}\n```';
  const whole = "fn f() -> &'static str {\n    r#\"\n````\nexample\n````\n\"#\n}";
  assert.equal(extractFirstCodeBlock(reply), whole, "the block must not stop at the interior run-4 line");
  const text = postprocessInstructOutput(reply);
  assert.equal(fenceGuardRefuses(text), true, "the raw string's run-4 lines survive, so the guard fires");
  assert.equal(
    extractRequestedFunction(text, "fn f() -> &'static str {").text,
    whole,
    "and the function reaching extractRequestedFunction is whole, not truncated",
  );
});

// ---------------------------------------------------------------------------
// ROW 7 [DEFECT, MEDIUM]. extractFirstCodeBlock has three callers and the
// measurement exercised one. extractTestModule loses the same leniency, and
// the message it produces then LIES: the reply plainly contains a test module.
// ---------------------------------------------------------------------------
test("[DEFECT] caller 2, extractTestModule: an open-4 / close-3 test module is now 'not a test module'", () => {
  const reply = "````rust\n#[cfg(test)]\nmod tests {\n    #[test]\n    fn a() { assert!(true); }\n}\n```";
  assert.deepEqual(
    extractTestModule(reply),
    { text: "#[cfg(test)]\nmod tests {\n    #[test]\n    fn a() { assert!(true); }\n}", testCount: 1 },
    "HEAD extracted this; the change rejects it and fnGenService reports no test module",
  );
});

test("[DEFECT] caller 3, extractTestFunctions: same loss on the four non-Rust languages", () => {
  const reply = '````go\nfunc TestA(t *testing.T) { t.Log("x") }\n```';
  assert.deepEqual(
    extractTestFunctions(reply, "go"),
    { text: 'func TestA(t *testing.T) { t.Log("x") }', testCount: 1 },
    "HEAD extracted this; the change rejects it",
  );
});

// ---------------------------------------------------------------------------
// ROW 8 [DEFECT, MEDIUM]. The doc comment sells run-length as "what makes
// nesting work at all". Nesting works — and it delivers markdown fence lines
// straight into the test-file splice, which has NO fence guard (the guard in
// fnGenService lives only in the non-test branch). The change makes the leak
// strictly larger: HEAD stopped at the inner closer, the change keeps it.
// ---------------------------------------------------------------------------
// RULING (verbatim, was the `todo:` text):
// "DEFERRED by triage as scraps S38-6. Under the shipped rule the leak returns to HEAD's one fence
// line, so it is no longer a regression. The real defect it points at, that the TEST-file splice path
// has no fence guard at all, is pre-existing and out of scope for phase 2."
// USED TO ASSERT: zero fence lines reach the test-file splice. The shipped code leaks ONE (the inner
// "```rust" opener rides along in got.text), which is a real defect the product still has: the test-file
// splice path has no fence guard, so that line goes into the written test file. Deferred, not fixed.
// The row is pinned at 1 so a regression back to 2 (or a fix down to 0) both show up here.
test("KNOWN WRONG: one markdown fence line still reaches the test-file splice, which has no fence guard (S38-6)", () => {
  const reply =
    "````markdown\n```rust\n#[cfg(test)]\nmod tests {\n    #[test]\n    fn a() { assert!(true); }\n}\n```\n````";
  const got = extractTestModule(reply);
  assert.ok(got, "sanity: the module is found");
  assert.equal(
    got.text.split("\n").filter((l) => runOf(l.trim())).length,
    1,
    "one fence line reaches a test-file splice; it should be 0, and nothing guards it",
  );
  assert.equal(got.text.split("\n")[0], "```rust", "and this is the line that leaks");
});

// ---------------------------------------------------------------------------
// ROW 9 [DEFECT, LOW]. Arithmetic. 32/198 is 16.2%, not 16.7%. The figure is in
// the shipped doc comment and repeated in the blind oracle's header.
// ---------------------------------------------------------------------------
// RULING (verbatim, was the `todo:` text):
// "FIXED by the phase-2 loop-back. The false census this row refutes has been rewritten in
// src/core/instructPostprocess.ts with its method and unit stated next to the number, and with the
// three observed open-4/close-3 replies named as the reason the leniency is kept. The row is left
// unedited because it is the record of the claim having been wrong."
// USED TO ASSERT: ((32 / 198) * 100).toFixed(1) === "16.7", the figure the shipped doc comment and the
// blind oracle's header both carried. The arithmetic is 16.2. The doc comment now says 16.2, so this
// row asserts the true value and the second assertion re-checks that the source agrees.
test("SUPERSEDED: '32 of 198' is 16.2%, not 16.7%, and the doc comment now says so", () => {
  assert.equal(((32 / 198) * 100).toFixed(1), "16.2");
  const doc = fs.readFileSync(path.join(__dirname, "..", "src", "core", "instructPostprocess.ts"), "utf8");
  assert.ok(doc.includes("16.2%"), "the shipped doc comment carries the corrected figure");
  assert.equal(doc.includes("16.7%"), false, "and no longer carries the wrong one");
});

test("[FINE] CRLF survives a run-4 fence", () => {
  assert.equal(extractFirstCodeBlock("````rust\r\nfn a() {}\r\n````\r"), "fn a() {}\r");
  assert.equal(postprocessInstructOutput("````rust\r\nfn a() {}\r\n````\r"), "fn a() {}");
});

test("[FINE] a run-4 opener with no closer still returns undefined, not a half block", () => {
  assert.equal(extractFirstCodeBlock("prose\n````rust\nfn a() {}"), undefined);
});

test("[FINE] a tilde run never closes a backtick run and vice versa, at any length", () => {
  assert.equal(extractFirstCodeBlock("````\ncode\n~~~~~"), undefined);
  assert.equal(extractFirstCodeBlock("~~~~\ncode\n`````"), undefined);
});

test("[FINE] the FIM pipeline does not share this function", () => {
  const fim = fs.readFileSync(path.join(__dirname, "..", "src", "core", "postprocess.ts"), "utf8");
  assert.equal(fim.includes("instructPostprocess"), false);
  assert.equal(fim.includes("extractFirstCodeBlock"), false);
});
