// Blind contract oracle: session-v38 item 2, CommonMark fence RUNS in
// instruct postprocess.
//
// NEVER READ. src/core/instructPostprocess.ts was not opened, grepped, or
// inspected in any form while writing this file, and neither was
// src/core/fnGenService.ts. Every expectation below comes from the written
// contract and from the captured model replies of the item-2 capture file
// (data, not source).
// The only source-adjacent files read were test/impl2-postprocess.test.cjs,
// test/blind2-postprocess.test.cjs and test/.blind-util.cjs.
//
// Run: SKIP_LIVE=1 node --test test/blind-v38-p2-fence-runs.test.cjs
//
// ======================= BUILD RULING, appended 2026-08-03 =======================
// Nothing above this block was edited. The oracle ruled independently and its
// record is worth more intact than agreeing with the build.
//
// The build did NOT ship strict CommonMark. It ships a strict SUPERSET of the old
// behaviour instead: a closer is a bare run of the same character whose length is
// 3 OR equal to the opener's. That fixes the measured open-4/close-4 defect, keeps
// the open-4/close-3 leniency, and never closes a run-3 block on a longer run.
//
// This file identified the real exclusion and was right that it is one. What it
// could not know is the frequency, because its census ran against a capture file
// that was still being written: it saw 34 replies where the finished corpus has
// 131. On the finished numbers, 39 openers are run-4 or longer and THREE are
// open-4/close-3 (complete, correct functions), while ZERO of the 92 run-3
// openers is followed by a longer bare run. The exclusion is real and it resolves
// the other way.
//
// [2026-08-10: those nine rows are no longer `todo:`. A test that must be red is
// not a test. Each ruling below is kept verbatim as a comment above its row, each
// row records what it USED to assert, and each now asserts the value the shipped
// code actually produces. Titles carry SUPERSEDED: because in every one of the
// nine the expectation was deliberately replaced and today's behaviour is the
// correct one. Nothing else in this header was edited.]
// Nine rows are therefore marked `todo: "REFUTED by triage on measurement"`, each
// carrying its own argument: 8, 9, 10, 11, 12, 14, 15, 17, 19. Every other row is
// GREEN under the shipped rule, including ROW 29, which the header calls the
// one-way door, and ROW 18, which shows the nesting benefit survives where it
// actually occurs in Rust replies. The four real captures embedded here all pass.
//
// ---------------------------------------------------------------------------
// WHY THIS FILE EXISTS
// ---------------------------------------------------------------------------
// A 198-row repair measurement on a real Rust corpus refused 32 rows (16.7%)
// in the fnGenService fence guard before repair could be scored. The replayed
// captures all have one shape: a run of four backticks opening, a run of four
// backticks closing, a complete and correct function between them. The
// extractor reports "no complete fenced block" because it only accepts a
// closer that trims to exactly three backticks, postprocess falls back to the
// whole reply including the fence lines, and the guard then refuses good code.
//
// ---------------------------------------------------------------------------
// THE RULE THIS FILE PINS
// ---------------------------------------------------------------------------
// An opening fence is a line whose trimmed text starts with a run of three or
// more backticks, or three or more tildes, optionally followed by an info
// string. A closing fence is a line whose trimmed text is a run of the SAME
// character and nothing else, of length AT LEAST the opener's length. A
// backtick line never closes a tilde block and a tilde line never closes a
// backtick block. A closer with trailing prose after the run does not close.
//
// ---------------------------------------------------------------------------
// THE TENSION, STATED RATHER THAN DECIDED IN SILENCE
// ---------------------------------------------------------------------------
// The brief asked me to treat as desirable the current leniency where a
// three-backtick line closes a four-or-more-backtick opener, and to name the
// tension instead of choosing quietly. Naming it: that leniency and the
// nested-fence payoff are mutually exclusive. They cannot both hold.
//
//   leniency   : extract("````\ncode\n```")               === "code"
//   nesting    : extract("````md\n```js\nx\n```\n````")   === "```js\nx\n```"
//
// If any three-backtick line closes a four-backtick block, then the inner
// "```" on line 3 of the nesting case closes the outer block and the result is
// "```js\nx". Honouring run length is the ONLY thing that makes a longer outer
// fence able to contain a shorter inner one, and containing a shorter inner
// fence is the entire reason a model reaches for four backticks in the first
// place. Test ROW 29 below pins the mutual exclusion itself, so it passes
// under either resolution and fails only if a build claims to have both.
//
// I resolve it STRICTLY (closer length >= opener length), which drops the
// leniency, on this evidence:
//
//   Scanned all 86 json files of captured replies for strings containing a
//   fence line. 1184 such strings. Run-length pairs:
//       open 3 / close 3   1173
//       open 4 / close 4     11
//       open N / close M<N    0
//       open N / close M>N    0
//   In the item-2 capture file specifically (repair-v38-fence.json, 34 raw
//   replies): 24 are 3/3 and 10 are 4/4, none mismatched.
//
// So the shape the leniency protects, an opener of four closed by a run of
// three, has never once been observed in this corpus. Preserving it costs a
// measured zero and buys nothing measured, and it blocks the nesting rule
// outright. Counter-evidence a build should weigh: the nested case is equally
// unobserved here (none of the 11 four-backtick replies contain an inner fence
// line), so the argument for nesting is CommonMark conformance and model
// intent, not observed frequency. If the build disagrees and keeps the
// leniency, ROWS 11, 12, 14, 17, 18 and 19 are the rows to argue against in
// writing, and ROW 29 must still pass.
//
// ---------------------------------------------------------------------------
// FLIP LIST: existing rows a run-length fix would invert
// ---------------------------------------------------------------------------
// I evaluated every fence row in test/impl2-postprocess.test.cjs and
// test/blind2-postprocess.test.cjs against the strict rule. Exactly two flip,
// both in impl2-postprocess.test.cjs. Everything else, including all tilde
// P2-F18 rows, the tagged-interior-line row, the empty-vs-undefined rulings,
// the think-tag rows and the idempotence rows, is unchanged.
//
// FLIP 1. impl2-postprocess.test.cjs
//   "four-backtick line never closes a three-backtick block: close must trim
//    to exactly ```"
//   asserts extractFirstCodeBlock("```\ncode\n````") === undefined
//   strict rule says "code". FLIPPING THIS IS CORRECT. A run of four is at
//   least as long as the opener of three, so CommonMark closes here, and the
//   product's own preference is plainly to recover code rather than throw a
//   complete well-formed block away. The title's premise, "close must trim to
//   exactly ```", is the defect stated as a rule. This is ROW 8 below.
//
// FLIP 2. impl2-postprocess.test.cjs
//   "four-backtick line still opens (starts with three backticks, 'language
//    tag' is a backtick)"
//   asserts extractFirstCodeBlock("````\ncode\n```") === "code"
//   strict rule says undefined. FLIPPING THIS IS CORRECT BUT IT IS THE
//   EXPENSIVE ONE, and it is the leniency discussed above. Two halves:
//     (a) the title's claim that a four-backtick line opens stays true and
//         must stay true, pinned independently by ROWS 1, 22 and 25.
//     (b) the assertion's claim that the three-backtick line closes it is
//         what dies. The parenthetical reasoning, "'language tag' is a
//         backtick", is a text-prefix artefact, not a fence model. Under it
//         "``````" is a fence with five backticks of language tag.
//   Cost of the flip, pinned honestly in ROWS 11 and 12: a reply that opens
//   with four and closes with three now has no complete block, falls back to
//   the whole remainder, and the downstream guard refuses it. That shape is
//   unobserved in 1184 captured replies. If it ever shows up in the field this
//   flip is the thing to revisit first.
//
// No row in blind2-postprocess.test.cjs flips. The closest candidate,
// "interior line starting with backticks-plus-tag does not close the block",
// survives because "```rust" is not a bare run and so is not a closer under
// either rule.
//
// ---------------------------------------------------------------------------
// EXPECTED RED (behaviour not yet built). Rows by ID:
//   1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 17, 18, 19, 20,
//   22, 23, 24, 30
// EXPECTED GREEN (regression guards and rulings that must not move):
//   5, 16, 21, 25, 26, 27, 28, 29
// Rows 8 and 11 are the two flips. Row 29 is the tension property.
// ---------------------------------------------------------------------------

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
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "blind-v38-p2-fence-runs",
  `export { extractFirstCodeBlock, postprocessInstructOutput } from "../src/core/instructPostprocess";\n`
);
const { extractFirstCodeBlock, postprocessInstructOutput } = mod;
test.after(cleanup);

// ---- captured replies, verbatim ------------------------------------------
// Copied out of the item-2 capture file, rounds[].raw, character for
// character. Held as line arrays so the fence runs stay readable and nothing
// is re-escaped.

// row id acme_memcache:.../shard_mem_cache.rs:get_write_event_seqes:41992
// round 0. rejectWhy: "generation contains a code-fence line (unclosed or
// nested fence in the reply)". 913 bytes, opener run 4, closer run 4.
const CAPTURE_SEQES_LINES = [
  "````rust",
  "/// Get the latest batch and event index for an aggregate",
  "/// Preference the queue first, then fallback to file if no queued items for aggregate",
  "pub fn get_write_event_seqes(&mut self, aggregate_key: &AggregateKey) -> EventIndexes {",
  "    let hash = aggregate_key.bloom_hash();",
  "    ",
  "    // First check if there are pending items in the queue for this aggregate",
  "    if let Some(indexes) = self.aggregate_write_snapshots.get(&hash) {",
  "        return indexes.clone();",
  "    }",
  "    ",
  "    // Fallback to file storage if no queued items",
  "    if let Some(indexes) = self.aggregate_recent_writes.get(&hash) {",
  "        return indexes.clone();",
  "    }",
  "    ",
  "    // If no entries found, return default EventIndexes",
  "    EventIndexes {",
  "        pending_delete_or_deleted: false,",
  "        allow_recreate: false,",
  "        allow_sequence_continuation: false,",
  "        aggregate_version: 0,",
  "        min_aggregate_version: 0,",
  "    }",
  "}",
  "````",
];
const CAPTURE_SEQES = CAPTURE_SEQES_LINES.join("\n");
// The body the product threw away: everything between the two run-4 fences,
// with the trailing per-line whitespace left exactly as the model emitted it.
const CAPTURE_SEQES_BODY = CAPTURE_SEQES_LINES.slice(1, -1).join("\n");

// row id acme_chaos:.../epoch_oracle.rs:parse_range_epochs:8916 round 0.
// Same rejectWhy. 1112 bytes, opener run 4, closer run 4. Chosen as a second
// witness because its doc comment carries INLINE single backticks, which must
// not be confused with fence runs.
const CAPTURE_EPOCHS_LINES = [
  "````rust",
  "/// Parse metablock summary lines from `wal-inspect range` output.",
  "///",
  "/// Each entry line has the form:",
  "///   wal_seq = N | lease = EPOCH | offset = ... | ...",
  "///",
  "/// Returns a BTreeMap from wal_seq to lease_epoch. When the same wal_seq",
  "/// appears in multiple segment files (shouldn't happen but handle gracefully),",
  "/// we keep the first seen.",
  "pub(crate) fn parse_range_epochs(text: &str) -> BTreeMap<u64, u64> {",
  "    let mut result = BTreeMap::new();",
  "    for line in text.lines() {",
  '        if let Some(wal_seq) = line.split("wal_seq = ").nth(1) {',
  "            if let Some(wal_seq) = wal_seq.split(' ').next() {",
  "                if let Ok(wal_seq) = wal_seq.parse::<u64>() {",
  '                    if let Some(lease) = line.split("lease = ").nth(1) {',
  "                        if let Some(lease) = lease.split(' ').next() {",
  "                            if let Ok(lease) = lease.parse::<u64>() {",
  "                                result.entry(wal_seq).or_insert(lease);",
  "                            }",
  "                        }",
  "                    }",
  "                }",
  "            }",
  "        }",
  "    }",
  "    result",
  "}",
  "````",
];
const CAPTURE_EPOCHS = CAPTURE_EPOCHS_LINES.join("\n");
const CAPTURE_EPOCHS_BODY = CAPTURE_EPOCHS_LINES.slice(1, -1).join("\n");

// The downstream guard in fnGenService refuses any generation containing a
// code-fence line. Reproduced here from its description in prose only, so a
// row can assert the postprocess output would survive it.
const hasFenceLine = (text) =>
  text.split("\n").some((line) => /^(`{3,}|~{3,})/.test(line.trim()));

// ===========================================================================
// GROUP A. The measured defect: run of 4 opens, run of 4 closes.
// ===========================================================================

test("ROW 1 [RED]: opener run 4 and closer run 4 extract the block", () => {
  assert.equal(extractFirstCodeBlock("````rust\nfn a() {}\n````"), "fn a() {}");
});

test("ROW 2 [RED]: REAL capture get_write_event_seqes extracts its body", () => {
  assert.equal(extractFirstCodeBlock(CAPTURE_SEQES), CAPTURE_SEQES_BODY);
});

test("ROW 3 [RED]: REAL capture get_write_event_seqes through postprocess is bare code", () => {
  const out = postprocessInstructOutput(CAPTURE_SEQES);
  assert.equal(out.split("\n")[0], "/// Get the latest batch and event index for an aggregate");
  assert.equal(out.split("\n").at(-1), "}");
  // trailing whitespace trimmed at the string edge only, interior kept
  assert.equal(out, CAPTURE_SEQES_BODY);
});

test("ROW 4 [RED]: REAL capture parse_range_epochs through postprocess is bare code, inline backticks untouched", () => {
  const out = postprocessInstructOutput(CAPTURE_EPOCHS);
  assert.equal(out, CAPTURE_EPOCHS_BODY);
  assert.ok(out.includes("`wal-inspect range`"), "inline backticks are content, not fences");
});

test("ROW 5 [GREEN]: postprocess of the REAL capture is idempotent either way", () => {
  const once = postprocessInstructOutput(CAPTURE_SEQES);
  assert.equal(postprocessInstructOutput(once), once);
});

// ===========================================================================
// GROUP B. Longer equal runs: 5 and 6.
// ===========================================================================

test("ROW 6 [RED]: opener run 5 and closer run 5 extract the block", () => {
  assert.equal(extractFirstCodeBlock("`````\ncode\n`````"), "code");
});

test("ROW 7 [RED]: opener run 6 with an info string and closer run 6 extract the block", () => {
  assert.equal(extractFirstCodeBlock("``````rust\nfn a() {}\n``````"), "fn a() {}");
});

// ===========================================================================
// GROUP C. Closer LONGER than opener. CommonMark closes. FLIP 1 lives here.
// ===========================================================================

// RULING (verbatim, was the `todo:` text):
// "REFUTED by triage on measurement (v38 phase 2). The build does NOT close on a longer run.
// Zero of the 92 run-3 openers in the 131 captured replies is followed by a longer bare run, so this
// buys nothing observed; and it is the exact mechanism of review defect 4, where a run-4 line inside a
// Rust raw string closes the block early and splices a truncated, unterminated function that the fence
// guard cannot see. A visible refusal traded for a silent bad write. Row 18 shows the nesting benefit
// survives where it actually occurs: a doc-comment /// ``` is not a bare run and never closed anything."
// USED TO ASSERT: extractFirstCodeBlock("```\ncode\n````") === "code" (strict CommonMark, FLIP 1).
// That expectation was deliberately replaced; today's `undefined` is the CORRECT behaviour.
test("SUPERSEDED: ROW 8 [FLIP 1 of impl2 refused]: opener 3, closer 4 does NOT close", () => {
  assert.equal(extractFirstCodeBlock("```\ncode\n````"), undefined);
});

// RULING (verbatim, was the `todo:` text):
// "REFUTED by triage on measurement (v38 phase 2). The build does NOT close on a longer run.
// Zero of the 92 run-3 openers in the 131 captured replies is followed by a longer bare run, so this
// buys nothing observed; and it is the exact mechanism of review defect 4, where a run-4 line inside a
// Rust raw string closes the block early and splices a truncated, unterminated function that the fence
// guard cannot see. A visible refusal traded for a silent bad write. Row 18 shows the nesting benefit
// survives where it actually occurs: a doc-comment /// ``` is not a bare run and never closed anything."
// USED TO ASSERT: extractFirstCodeBlock("```\ncode\n``````") === "code".
// That expectation was deliberately replaced; today's `undefined` is the CORRECT behaviour.
test("SUPERSEDED: ROW 9: opener 3, closer 6 does NOT close", () => {
  assert.equal(extractFirstCodeBlock("```\ncode\n``````"), undefined);
});

// RULING (verbatim, was the `todo:` text):
// "REFUTED by triage on measurement (v38 phase 2). The build does NOT close on a longer run.
// Zero of the 92 run-3 openers in the 131 captured replies is followed by a longer bare run, so this
// buys nothing observed; and it is the exact mechanism of review defect 4, where a run-4 line inside a
// Rust raw string closes the block early and splices a truncated, unterminated function that the fence
// guard cannot see. A visible refusal traded for a silent bad write. Row 18 shows the nesting benefit
// survives where it actually occurs: a doc-comment /// ``` is not a bare run and never closed anything."
// USED TO ASSERT: extractFirstCodeBlock("```\na\n````\nb\n```") === "a", i.e. the interior run-4 line
// terminates the run-3 block. That expectation was deliberately replaced: the interior run-4 line is
// CONTENT, the block runs to the final run-3 line, and the whole body survives. That is the correct
// behaviour and the reason review defect 4 (silent truncation into the splice) cannot occur.
test("SUPERSEDED: ROW 10: a bare longer run INSIDE a three-backtick block is content, not a terminator", () => {
  // Original rationale, kept as the record: "Direct consequence of ROW 8. The
  // run-4 line on line 3 is a legal closer for a run-3 opener, so the block ends
  // before 'b'. Pinned so the build knows this follows from the same rule and is
  // not a separate decision." It IS a direct consequence of ROW 8 and it moved
  // with ROW 8.
  assert.equal(extractFirstCodeBlock("```\na\n````\nb\n```"), "a\n````\nb");
});

// ===========================================================================
// GROUP D. Closer SHORTER than opener. Does not close. FLIP 2 lives here.
// This is the leniency being dropped. See the tension note in the header.
// ===========================================================================

// RULING (verbatim, was the `todo:` text):
// "REFUTED by triage on measurement (v38 phase 2). The build KEPT the leniency this row drops.
// Over the 131 captured model replies in data/repair-v38-fence*.json, 39 openers are run-4 or longer and
// THREE are open-4/close-3, each a complete correct function that this row's rule would refuse outright,
// against zero counter-instances. The oracle's own zero-mismatch count was taken while the capture file
// was still being written. Row 29 still holds."
// USED TO ASSERT: extractFirstCodeBlock("````\ncode\n```") === undefined (FLIP 2, the leniency dropped).
// That expectation was deliberately replaced; today's "code" is the CORRECT behaviour.
test("SUPERSEDED: ROW 11 [FLIP 2 of impl2 refused]: opener 4, closer 3 DOES close, the leniency is kept", () => {
  assert.equal(extractFirstCodeBlock("````\ncode\n```"), "code");
});

// RULING (verbatim, was the `todo:` text):
// "REFUTED by triage on measurement (v38 phase 2). The build KEPT the leniency this row drops.
// Over the 131 captured model replies in data/repair-v38-fence*.json, 39 openers are run-4 or longer and
// THREE are open-4/close-3, each a complete correct function that this row's rule would refuse outright,
// against zero counter-instances. The oracle's own zero-mismatch count was taken while the capture file
// was still being written. Row 29 still holds."
// USED TO ASSERT: postprocessInstructOutput("````\ncode\n```") === the whole raw reply, fence lines and
// all, and hasFenceLine(...) === true, i.e. the cost of FLIP 2. FLIP 2 was refused, so that cost is not
// paid: postprocess extracts the body and no fence line reaches the guard. Today's behaviour is CORRECT.
test("SUPERSEDED: ROW 12: opener 4 closer 3 extracts through postprocess, no fallback to the remainder", () => {
  const raw = "````\ncode\n```";
  assert.equal(postprocessInstructOutput(raw), "code");
  assert.equal(hasFenceLine(postprocessInstructOutput(raw)), false, "the guard accepts this, by design");
});

// ===========================================================================
// GROUP E. Tildes, with runs, and the cross-character rules.
// ===========================================================================

test("ROW 13 [RED]: tilde opener run 4 and tilde closer run 4 extract the block", () => {
  assert.equal(extractFirstCodeBlock("~~~~rust\nfn a() {}\n~~~~"), "fn a() {}");
});

// RULING (verbatim, was the `todo:` text):
// "REFUTED by triage on measurement (v38 phase 2). The build KEPT the leniency this row drops.
// Over the 131 captured model replies in data/repair-v38-fence*.json, 39 openers are run-4 or longer and
// THREE are open-4/close-3, each a complete correct function that this row's rule would refuse outright,
// against zero counter-instances. The oracle's own zero-mismatch count was taken while the capture file
// was still being written. Row 29 still holds."
// USED TO ASSERT: extractFirstCodeBlock("~~~~\ncode\n~~~") === undefined.
// That expectation was deliberately replaced; today's "code" is the CORRECT behaviour, and it is the
// tilde half of ROW 11.
test("SUPERSEDED: ROW 14: tilde opener 4, tilde closer 3 DOES close (same leniency as ROW 11)", () => {
  assert.equal(extractFirstCodeBlock("~~~~\ncode\n~~~"), "code");
});

// RULING (verbatim, was the `todo:` text):
// "REFUTED by triage on measurement (v38 phase 2). The build does NOT close on a longer run.
// Zero of the 92 run-3 openers in the 131 captured replies is followed by a longer bare run, so this
// buys nothing observed; and it is the exact mechanism of review defect 4, where a run-4 line inside a
// Rust raw string closes the block early and splices a truncated, unterminated function that the fence
// guard cannot see. A visible refusal traded for a silent bad write. Row 18 shows the nesting benefit
// survives where it actually occurs: a doc-comment /// ``` is not a bare run and never closed anything."
// USED TO ASSERT: extractFirstCodeBlock("~~~\ncode\n~~~~") === "code".
// That expectation was deliberately replaced; today's `undefined` is the CORRECT behaviour, and it is
// the tilde half of ROW 8.
test("SUPERSEDED: ROW 15: tilde opener 3, tilde closer 4 does NOT close (same rule as ROW 8)", () => {
  assert.equal(extractFirstCodeBlock("~~~\ncode\n~~~~"), undefined);
});

test("ROW 16 [GREEN]: run length never lets one fence character close the other", () => {
  assert.equal(extractFirstCodeBlock("~~~~\ncode\n````"), undefined, "run-4 backticks cannot close a run-4 tilde fence");
  assert.equal(extractFirstCodeBlock("````\ncode\n~~~~"), undefined, "run-4 tildes cannot close a run-4 backtick fence");
  assert.equal(extractFirstCodeBlock("~~~~\ncode\n`````"), undefined, "nor does a longer run of the other character");
});

// ===========================================================================
// GROUP F. The payoff: a shorter inner fence inside a longer outer fence.
// Unobserved in the captured corpus. Argued from CommonMark and model intent.
// ===========================================================================

// RULING (verbatim, was the `todo:` text):
// "REFUTED by triage on measurement (v38 phase 2). The build does NOT close on a longer run.
// Zero of the 92 run-3 openers in the 131 captured replies is followed by a longer bare run, so this
// buys nothing observed; and it is the exact mechanism of review defect 4, where a run-4 line inside a
// Rust raw string closes the block early and splices a truncated, unterminated function that the fence
// guard cannot see. A visible refusal traded for a silent bad write. Row 18 shows the nesting benefit
// survives where it actually occurs: a doc-comment /// ``` is not a bare run and never closed anything."
// USED TO ASSERT: extractFirstCodeBlock("````markdown\n```js\nx\n```\n````") === "```js\nx\n```", the
// nesting payoff. The build chose the leniency over the nesting (ROW 29 says it cannot have both), so
// the inner run-3 line closes the outer run-4 opener and the trailing "```" is dropped. That trade is
// the deliberate ruling; today's "```js\nx" is what the shipped rule produces.
test("SUPERSEDED: ROW 17: a run-3 inner fence DOES close a run-4 outer fence, so nesting is lost", () => {
  assert.equal(
    extractFirstCodeBlock("````markdown\n```js\nx\n```\n````"),
    "```js\nx"
  );
});

test("ROW 18 [RED]: run-4 outer around Rust whose doc comment contains a run-3 example block", () => {
  const raw = [
    "````rust",
    "/// Example:",
    "/// ```",
    "/// let x = f();",
    "/// ```",
    "pub fn f() -> u8 { 1 }",
    "````",
  ].join("\n");
  assert.equal(
    extractFirstCodeBlock(raw),
    "/// Example:\n/// ```\n/// let x = f();\n/// ```\npub fn f() -> u8 { 1 }"
  );
});

// RULING (verbatim, was the `todo:` text):
// "REFUTED by triage on measurement (v38 phase 2). The build does NOT close on a longer run.
// Zero of the 92 run-3 openers in the 131 captured replies is followed by a longer bare run, so this
// buys nothing observed; and it is the exact mechanism of review defect 4, where a run-4 line inside a
// Rust raw string closes the block early and splices a truncated, unterminated function that the fence
// guard cannot see. A visible refusal traded for a silent bad write. Row 18 shows the nesting benefit
// survives where it actually occurs: a doc-comment /// ``` is not a bare run and never closed anything."
// USED TO ASSERT: extractFirstCodeBlock("~~~~\n~~~\nx\n~~~\n~~~~") === "~~~\nx\n~~~".
// The tilde half of ROW 17, and it loses the same way: the run-3 line on line 2 closes the run-4
// opener immediately, so the block is empty. Deliberate, and the same trade ROW 29 pins.
test("SUPERSEDED: ROW 19: the same non-nesting holds for tildes, the inner run-3 closes at once", () => {
  assert.equal(extractFirstCodeBlock("~~~~\n~~~\nx\n~~~\n~~~~"), "");
});

// ===========================================================================
// GROUP G. Regression guards. The three-backtick common case and the
// rulings that must survive the fix untouched.
// ===========================================================================

test("ROW 20 [RED]: two run-4 blocks, the first still wins", () => {
  assert.equal(
    extractFirstCodeBlock("````\nfirst\n````\nbetween\n````\nsecond\n````"),
    "first"
  );
});

test("ROW 21 [GREEN]: a run-4 line with trailing prose still does not close", () => {
  assert.equal(extractFirstCodeBlock("````\ncode\n```` end"), undefined);
  assert.equal(extractFirstCodeBlock("````\ncode\n````rust"), undefined);
});

test("ROW 22 [RED]: whitespace-padded run-4 fences open and close on trimmed text", () => {
  assert.equal(extractFirstCodeBlock("   ````rust   \ncode\n  ````  "), "code");
});

test("ROW 23 [RED]: CRLF run-4 reply through postprocess yields bare code", () => {
  assert.equal(postprocessInstructOutput("````rust\r\nfn a() {}\r\n````"), "fn a() {}");
});

test("ROW 24 [RED]: an immediately closed run-4 fence is '' and takes the reject path, not the prose fallback", () => {
  assert.equal(extractFirstCodeBlock("````\n````"), "", "empty content, distinct from undefined");
  assert.equal(postprocessInstructOutput("Sure!\n````\n````\nEnjoy!"), "");
});

test("ROW 25 [GREEN]: an unclosed run-4 opener is still undefined", () => {
  assert.equal(extractFirstCodeBlock("````rust\nfn a() {}"), undefined);
  assert.equal(extractFirstCodeBlock("prose\n````rust"), undefined);
});

test("ROW 26 [GREEN]: a run of 4 mid-line is not a fence", () => {
  assert.equal(extractFirstCodeBlock("text with ```` inline\nno block here"), undefined);
});

test("ROW 27 [GREEN]: a run of 2 is not a fence at all", () => {
  assert.equal(extractFirstCodeBlock("``\ncode\n``"), undefined);
  assert.equal(extractFirstCodeBlock("~~\ncode\n~~"), undefined);
});

test("ROW 28 [GREEN]: the run-3 common case is untouched, extractor and postprocess", () => {
  assert.equal(
    extractFirstCodeBlock("Some text\n```go\nfunc q() int { return 1 }\n```\nmore"),
    "func q() int { return 1 }"
  );
  assert.equal(
    postprocessInstructOutput("Here:\n```go\nfunc q() int { return 1 }\n```\nDone."),
    "func q() int { return 1 }"
  );
  assert.equal(
    postprocessInstructOutput("<think>hm</think>\n```go\nfunc q() int { return 1 }\n```"),
    "func q() int { return 1 }"
  );
  assert.equal(extractFirstCodeBlock("```\nouter\n```go\n```"), "outer\n```go");
});

test("ROW 29 [GREEN either way]: the leniency and the nesting rule are mutually exclusive", () => {
  // This row does not take a side. It fails only if a build claims both, which
  // would mean the closer test is inconsistent rather than merely lenient.
  const leniency = extractFirstCodeBlock("````\ncode\n```") === "code";
  const nesting =
    extractFirstCodeBlock("````markdown\n```js\nx\n```\n````") === "```js\nx\n```";
  assert.ok(
    !(leniency && nesting),
    "a run-3 line cannot both close a run-4 opener and be content inside one"
  );
});

test("ROW 30 [RED]: the REAL captures come out of postprocess with no fence line left, which is what the guard checks", () => {
  for (const [name, raw] of [
    ["get_write_event_seqes", CAPTURE_SEQES],
    ["parse_range_epochs", CAPTURE_EPOCHS],
  ]) {
    const out = postprocessInstructOutput(raw);
    assert.ok(!hasFenceLine(out), `${name}: postprocess output still carries a fence line`);
    assert.ok(out.length > 0, `${name}: postprocess output is empty`);
  }
});
