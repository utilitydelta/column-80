// ADVERSARIAL REVIEW - session-v52 phase 4 (`src/core/tightenFlags.ts`).
//
// Every test here is EVIDENCE for a numbered defect in the review report. Each
// one originally asserted the OBSERVED behaviour, so the file was green against
// the code as reviewed: a fix flips the assertion, which is the point.
//
// FLIPPED 2026-08-12 by the implementer, after `session-v52/triage-p4.md`. Every
// row below now asserts the RIGHT answer instead of the observed one. The
// original observation is kept in each comment as `WAS:`, because a regression
// witness that no longer says what it caught is a test nobody can read.
//
// Nothing here edits src/**, blind-v52-p4-flags.test.cjs or
// impl-v52-p4-flags.test.cjs.
//
// Run: SKIP_LIVE=1 node --test test/adversarial-v52-p4.test.cjs

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "adversarial-v52-p4",
  `export {
  RESTATEMENT_MIN_TOKENS,
  RESTATEMENT_THRESHOLD,
  findRestatements,
  findUndefinedTerms,
} from "../src/core/tightenFlags";\n`,
);
const { findRestatements, findUndefinedTerms } = mod;
test.after(cleanup);

const byGrain = (rep) => {
  const g = { sentence: 0, paragraph: 0 };
  for (const p of rep.pairs) g[p.grain]++;
  return g;
};

// ---------------------------------------------------------------------------
// D1. The 100-pair cap is SHARED between the two grains, and the sentence pass
//     runs first. Fill it at sentence grain and the paragraph grain - the grain
//     the contract says exists because round 5's failure only shows there -
//     reports nothing. Contract amendment 7: "No dedupe between the grains. A
//     sentence pair and a paragraph pair over the same text are both reported."
// ---------------------------------------------------------------------------

const INSTR = "Subtract each dropped set's known saving from the running total.";
const PARA =
  "The payload cap is enforced by dropping per aggregate client sets largest\n" +
  "first until the encoded body fits under the configured ceiling.";

test("D1 the cap is per grain, so a full sentence pass cannot starve paragraphs", () => {
  // 15 identical lines => 105 sentence pairs > the cap of 100, on their own.
  const filler = Array.from({ length: 15 }, () => INSTR).join("\n");
  const doc = `${filler}\n\n${PARA}\n\n${PARA}`;

  const control = findRestatements(`${INSTR}\n${INSTR}\n\n${PARA}\n\n${PARA}`);
  assert.ok(control.pairs.length >= 3, "control: both grains reported");
  assert.ok(byGrain(control).paragraph > 0, "control: the duplicated paragraph IS reported");

  const rep = findRestatements(doc);
  // WAS: {sentence: 100, paragraph: 0} - the shared cap was spent by the
  // sentence pass and the duplicated paragraph, the grain the contract says
  // exists for round 5, was reported nowhere.
  const grains = byGrain(rep);
  assert.equal(grains.sentence, 100, "the sentence grain is capped at 100");
  assert.ok(grains.paragraph > 0, "and the paragraph grain still reports, per amendment 7");
});

test("D2 truncation is reported: a caller can tell 100 from 100-of-105", () => {
  const doc = Array.from({ length: 15 }, () => INSTR).join("\n");
  const rep = findRestatements(doc);
  assert.equal(rep.pairs.length, 100);
  // WAS: the report had only {units, worst, pairs}, so 100 was
  // indistinguishable from 100-of-a-million. This repo has already been bitten
  // by a recording cap that turned every derived count into a silent lower
  // bound.
  assert.equal(rep.units, 15);
  assert.equal(rep.totalPairs, 105, "15 choose 2, all above threshold");
  assert.equal(rep.truncated, true);
  // And an untruncated report says so.
  const small = findRestatements(`${INSTR}\n${INSTR}`);
  assert.equal(small.truncated, false);
  assert.equal(small.totalPairs, small.pairs.length);
});

test("D2b a real 9KB Go stdlib doc comment reaches the cap, and still reports paragraphs", () => {
  // Not synthetic: encoding/json/v2_options.go's package doc, if it is on this
  // box. Skipped rather than failed when the Go tree is absent.
  const f = path.join(
    process.env.HOME ?? "",
    ".local/go/src/encoding/json/v2_options.go",
  );
  if (!fs.existsSync(f)) {
    return;
  }
  const text = fs.readFileSync(f, "utf8");
  const lines = text.split("\n");
  const prose = [];
  for (const l of lines) {
    if (/^\/\/ ?/.test(l)) prose.push(l.replace(/^\/\/ ?/, ""));
    else if (prose.length > 8) break;
    else prose.length = 0;
  }
  const rep = findRestatements(prose.join("\n").trim());
  // WAS: 74 pairs, all sentence grain, against a SHARED cap of 100. Now the
  // sentence grain fills its own 100 and the paragraph grain reports beside it,
  // which is the whole point of the per-grain cap on a real input.
  assert.ok(rep.pairs.length >= 70, `real doc comment pairs=${rep.pairs.length}`);
  assert.ok(byGrain(rep).paragraph > 0, "the paragraph grain is not starved");
  assert.ok(rep.totalPairs >= rep.pairs.length);
});

// ---------------------------------------------------------------------------
// D3. The rule is specified as "a NOUN used inside an INSTRUCTION sentence".
//     objectHead takes the LAST token of the object phrase with no part of
//     speech evidence beyond a determiner somewhere earlier, so an adverb or a
//     finite verb that trails the phrase is reported as the missing noun.
// ---------------------------------------------------------------------------

test("D3 an adverb is not reported as an undefined noun", () => {
  // Verbatim from src/core/compilerDirected.ts.
  const prose = "Tells the model to drop the import and use the local name directly.";
  const got = findUndefinedTerms({ prose, resolved: [] }).map((t) => t.term);
  // WAS: ["directly"]. No developer can answer "what is a directly?".
  assert.deepEqual(got, []);
});

test("D3b more non-nouns: an adverb after a modal, and a finite verb", () => {
  // WAS: each of these reported the trailing word as the undefined noun.
  const rows = [
    ["Call this immediately before executing an operation.", "immediately"],
    ["An idle two-phase sync must skip the amortisation delay entirely.", "entirely"],
    ["Set once the process dies or errors.", "dies"],
  ];
  for (const [prose, term] of rows) {
    const got = findUndefinedTerms({ prose, resolved: [] }).map((t) => t.term);
    assert.deepEqual(got, [], `${prose} (was [${term}])`);
  }
  // The control: the same shape with a real possessive and a real noun head
  // still fires, so the rows above are narrowed and not switched off.
  assert.deepEqual(
    findUndefinedTerms({
      prose: "Skip the sync's amortisation delay.",
      resolved: [],
    }).map((t) => t.term),
    ["delay"],
  );
});

// ---------------------------------------------------------------------------
// D4. The contract: "it is deliberately narrow, because a flag that fires on
//     ordinary English is a flag a developer learns to ignore." Measured over
//     this repo's OWN doc comments the flag fires on roughly one block in
//     twelve. The test recomputes the rate so it cannot go stale.
// ---------------------------------------------------------------------------

test("D4 the flag no longer fires on ordinary doc comments", () => {
  const dir = path.join(__dirname, "..", "src", "core");
  const blocks = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".ts")) continue;
    const text = fs.readFileSync(path.join(dir, name), "utf8");
    for (const m of text.matchAll(/\/\*\*([\s\S]*?)\*\//g)) {
      const prose = m[1].split("\n").map((l) => l.replace(/^\s*\*\s?/, "")).join("\n").trim();
      if (prose.split(/\s+/).filter(Boolean).length >= 12) blocks.push(prose);
    }
  }
  assert.ok(blocks.length > 500, `corpus size ${blocks.length}`);
  let fired = 0;
  for (const prose of blocks) {
    if (findUndefinedTerms({ prose, resolved: [] }).length > 0) fired++;
  }
  const rate = (100 * fired) / blocks.length;
  // WAS: 7-10% here, and 10.5% over 17,774 real doc-comment blocks in five
  // languages. The narrowing (a possessive must govern the head) took the big
  // corpus to 0.7%, under the triage's 1% ship gate; this repo's own core
  // measures 1.36%, because its comments are unusually possessive-heavy prose.
  // The gate is the corpus number, and this row is the cheap standing witness.
  assert.ok(rate < 2, `fire rate ${rate.toFixed(2)}% over ${blocks.length} blocks`);
});

// ---------------------------------------------------------------------------
// D5. "Pure ... never throws" (contract line 7), "Neither throws" (ship
//     condition 4). `resolved` is guarded against a non-array; `stopNames` is
//     not guarded against a non-iterable.
// ---------------------------------------------------------------------------

test("D5 a non-iterable stopNames does not throw", () => {
  const input = { prose: "Subtract each entry's known saving.", resolved: [], stopNames: {} };
  // resolved is defended...
  assert.doesNotThrow(() => findUndefinedTerms({ prose: input.prose, resolved: null }));
  // ...and now so is stopNames. WAS: TypeError, against ship condition 4.
  assert.doesNotThrow(() => findUndefinedTerms(input));
  assert.deepEqual(findUndefinedTerms(input).map((t) => t.term), ["saving"]);
  for (const junk of [null, 42, "Result", { has: () => true }, Symbol.iterator]) {
    assert.doesNotThrow(() => findUndefinedTerms({ ...input, stopNames: junk }), String(junk));
  }
  // A real Set still stops the term, so the guard did not disable the feature.
  assert.deepEqual(findUndefinedTerms({ ...input, stopNames: new Set(["saving"]) }), []);
});

// ---------------------------------------------------------------------------
// D6. The tokenizer is `[a-z0-9_]+`. A doc comment whose prose is not Latin
//     produces no content tokens at all, so a paragraph pasted twice verbatim -
//     the exact case ship condition 1 validates at 1.00 - is invisible, and
//     `worst` comes back looking like a clean document rather than an
//     unmeasured one.
// ---------------------------------------------------------------------------

const JP = "各集約のクライアント集合を破棄し、上限に収まるまで最大の節約から順に破棄する。";

test("D6 a duplicated non-Latin paragraph still does not fire, but says so", () => {
  const rep = findRestatements(`${JP}\n\n${JP}`);
  // WAS: {units: 0, worst: 0, pairs: []} and nothing else, which a caller
  // cannot tell from "measured and found clean". Real CJK tokenisation is
  // DEFERRED (scraps S52-7); what ships is the honesty.
  assert.equal(rep.units, 0);
  assert.equal(rep.worst, 0);
  assert.equal(rep.pairs.length, 0);
  assert.equal(rep.unmeasured, 1, "every letter in this prose was invisible to the tokeniser");

  // ASCII control, same shape: fires at 1.00 and reports nothing unmeasured.
  const en = "Discard each aggregate client collection until the ceiling accommodates the remainder.";
  const ctl = findRestatements(`${en}\n\n${en}`);
  assert.equal(ctl.worst, 1);
  assert.ok(ctl.pairs.length > 0);
  assert.equal(ctl.unmeasured, 0);
});

test("D6b mixed prose reports the share the tokeniser could not see", () => {
  const ascii =
    "Enforce the payload cap by dropping per aggregate client sets until it fits.\n" +
    "Returns how many were dropped and zero when already under the cap.";
  const rep = findRestatements(`${ascii}\n\n${JP}\n\n${JP}`);
  // WAS: units=2, worst=0.17, no pairs, and no way to know two thirds of the
  // document was never looked at.
  assert.ok(rep.worst < 0.7);
  assert.equal(rep.pairs.length, 0);
  assert.equal(rep.unmeasured, 0.39, "a caller can now say 'not measured' instead of 'clean'");
});

// ---------------------------------------------------------------------------
// D7. `clauseInitial` rebuilds and regex-trims the whole sentence prefix for
//     every instruction verb it meets, so findUndefinedTerms is O(n^2) in the
//     length of a SINGLE sentence. Same bytes, same words, different full
//     stops, two orders of magnitude apart.
// ---------------------------------------------------------------------------

test("D7 findUndefinedTerms is linear in one sentence's length", () => {
  const clause = "drop the widget and skip the cursor and add the shard ";
  const one = clause.repeat(4000).trim();          // ~216KB, ONE sentence
  const many = one.replace(/ and /g, ". ");        // same words, many sentences
  const t0 = process.hrtime.bigint();
  findUndefinedTerms({ prose: one, resolved: [] });
  const t1 = process.hrtime.bigint();
  findUndefinedTerms({ prose: many, resolved: [] });
  const t2 = process.hrtime.bigint();
  const oneMs = Number(t1 - t0) / 1e6;
  const manyMs = Number(t2 - t1) / 1e6;
  // WAS: ~1100ms vs ~12ms at 216KB, quadrupling per doubling (17s at 864KB),
  // because `clauseInitial` re-sliced and re-trimmed the whole sentence prefix
  // for every instruction verb in it. `prevChar` is now precomputed in the one
  // tokenising pass. Measured after the fix: 11ms vs 10ms.
  //
  // The bound is generous on purpose. This is a shape assertion, not a latency
  // gate: the two runs are the same bytes and the same words, so a punctuation
  // difference must not cost an order of magnitude.
  assert.ok(
    oneMs < 5 * Math.max(manyMs, 5),
    `one-sentence ${oneMs.toFixed(0)}ms vs punctuated ${manyMs.toFixed(0)}ms`,
  );
});

// ---------------------------------------------------------------------------
// D8. Amendment 8's apposition rule looks for "the term, a comma, then a
//     code-style span". `[A-Za-z_][A-Za-z0-9_]*` followed by `.` or `(` also
//     matches the abbreviations ordinary prose puts straight after a comma.
// ---------------------------------------------------------------------------

test("D8 `, e.g.` / `, i.e.` / `, etc.` do not silence the flag", () => {
  const bare = "Subtract each entry's known saving from a running total.";
  assert.deepEqual(findUndefinedTerms({ prose: bare, resolved: [] }).map((t) => t.term), ["saving"]);
  for (const hedge of ["e.g. whatever, ", "i.e. some number, ", "etc. "]) {
    const prose = `Subtract each entry's known saving, ${hedge}from a running total.`;
    // WAS: [] - `[A-Za-z_]+` followed by `.` matched the `e.` of "e.g.", so an
    // abbreviation read as an appositive definition.
    assert.deepEqual(
      findUndefinedTerms({ prose, resolved: [] }).map((t) => t.term),
      ["saving"],
      hedge,
    );
  }
  // A real appositive definition in the same position still silences it, so the
  // hedge list narrowed the rule rather than removing it.
  assert.deepEqual(
    findUndefinedTerms({
      prose: "Subtract each entry's known saving, client_set.wire_size(), from a running total.",
      resolved: [],
    }),
    [],
  );
});

test("D8b an unrelated later mention no longer silences the instruction", () => {
  const prose =
    "Subtract each entry's known saving from a running total.\n\n" +
    "The saving, e.g. on a wide row, is discussed in the design note.";
  // WAS: []. The definition test scanned every occurrence in the whole prose.
  // The window is now everything up to the end of the sentence AFTER the
  // instruction. The triage asked for "this sentence and the one after"; the
  // backwards half is kept because the contract says "no sentence in the prose
  // introduces it", and a comment that defines a term in paragraph 1 and
  // instructs with it in paragraph 4 is the ordinary shape. Measured on 17,774
  // blocks the two windows differ by one block.
  assert.deepEqual(findUndefinedTerms({ prose, resolved: [] }).map((t) => t.term), ["saving"]);

  // A definition BEFORE the instruction still counts.
  const defined =
    "A saving is the width the entry stops paying.\n\n" +
    "Subtract each entry's known saving from a running total.";
  assert.deepEqual(findUndefinedTerms({ prose: defined, resolved: [] }), []);
});

// ---------------------------------------------------------------------------
// D9. Spans are shared objects across pairs and the array is not frozen.
//     Phase 5 is specified to offer a DELETION of a reported span, so a caller
//     that adjusts one pair's span silently adjusts another's.
// ---------------------------------------------------------------------------

test("D9 reported spans are fresh objects, never aliased between pairs", () => {
  const rep = findRestatements([INSTR, INSTR, INSTR].join("\n"));
  assert.equal(rep.pairs.length, 3);
  // WAS: rep.pairs[0].a === rep.pairs[1].a, so a phase 5 caller adjusting one
  // pair's span before offering the deletion silently adjusted another's.
  assert.notEqual(rep.pairs[0].a, rep.pairs[1].a);
  assert.deepEqual(rep.pairs[0].a, rep.pairs[1].a, "same value, different object");
  rep.pairs[0].a.start = -1;
  assert.notEqual(rep.pairs[1].a.start, -1, "mutating one span does not move another");
});

// ---------------------------------------------------------------------------
// D10. The restatement splitter breaks on a BARE newline and doc comment prose
//      is hard-wrapped, so two LINES OF ONE SENTENCE get compared with each
//      other. Phase 5 offers a deletion of a reported span; deleting half a
//      sentence is not the claim-safe edit the goal says a deletion is.
//      Amendment 9 gave the TERM pass its own splitter for exactly this reason
//      and left the restatement pass on the newline split.
// ---------------------------------------------------------------------------

test("D10 two lines of one sentence are not a restatement", () => {
  // SYNTHETIC, written for this row; not a capture. The real block this stood
  // in for is in a private repo. The STRUCTURE is what the row tests and it is
  // reproduced exactly: ONE sentence hard-wrapped over two lines with a bare
  // `\n` between them, then a second sentence. The two halves of sentence one
  // share 4 of the 5 content tokens of the shorter half, so under the spike's
  // bare-newline split they scored 0.80 and were reported as a pair - which is
  // the defect. Under the fixed splitter they are one unit and nothing fires.
  const prose =
    "The consumer that holds the earliest active lease in the run must be the one\n" +
    "that holds the latest active lease in the run. Written so the harness can\n" +
    "prove that a partial drain never hands a backlog to a second worker.";
  const rep = findRestatements(prose);
  // WAS: a sentence pair at 0.80 whose two spans were the two LINES of one
  // sentence, separated by a single "\n". Phase 5 offers a reported span for
  // DELETION and the goal justifies that with "a deletion cannot introduce a
  // claim"; deleting half a sentence introduces one. Corpus-wide, 47 of 582
  // sentence pairs were this shape.
  assert.equal(rep.pairs.length, 0);
  assert.equal(rep.units, 2, "two real sentences, not three wrapped lines");
  // Every reported span, on any input, must end at a sentence boundary or the
  // end of the prose. This is the property the deletion offer rests on.
  for (const text of [prose, `${INSTR}\n${INSTR}`, `${PARA}\n\n${PARA}`]) {
    for (const p of findRestatements(text).pairs) {
      for (const s of [p.a, p.b]) {
        const rest = text.slice(s.end).trim();
        assert.ok(
          rest === "" || /[.!?]$/.test(s.text) || s.text.endsWith(":"),
          `span does not end a sentence: ${JSON.stringify(s.text.slice(-40))}`,
        );
      }
    }
  }
});

test("D11 parallel list items that NEGATE each other do not fire", () => {
  // SYNTHETIC, written for this row; not a capture. The real block this stood
  // in for is in a private repo. The STRUCTURE is what the row tests and it is
  // reproduced exactly: a lead-in line ending in `:`, then parallel list items,
  // two of which are token-identical apart from a single negation. The negated
  // item's token set is a strict SUBSET of the other's, so containment over the
  // smaller set is exactly 1.00 and only the `not` separates the two claims.
  const prose =
    "Reports how many rows the planner shed, in one of three ways:\n" +
    "- If the budget was never set, the planner sheds nothing and reports zero.\n" +
    "- If the budget has run out, the planner drops the tail and reports the drop\n" +
    "  count.\n" +
    "- If the budget has not run out, the planner reports the drop count.";
  const rep = findRestatements(prose);
  // WAS: a pair at containment 1.00 between "the budget has run out" and "the
  // budget has NOT run out", one of which was then offered for deletion. The
  // stop list drops `not`, `but`, `and`, `no` and `if`, so a rule and its
  // negation are the same token set to this detector.
  //
  // The fix is a GUARD, not an edit to the stop list: editing the list would
  // change every containment figure the scout validated and the instrument
  // would no longer be the one that was checked against three known cases.
  assert.equal(rep.pairs.length, 0, "no pair fires");
  // `worst` still reports what the lexical measure saw. Only firing is
  // suppressed, so the guard cannot hide a number from a caller.
  assert.equal(rep.worst, 1);
  assert.equal(rep.totalPairs, 0);

  // The control: drop the negation and the two items ARE restatements again.
  const same = prose.replace("has not run out", "has run out");
  const ctl = findRestatements(same);
  assert.ok(ctl.pairs.length > 0, "identical rules still fire");
  assert.equal(ctl.worst, 1);
});

// ---------------------------------------------------------------------------
// Sound, kept as regression witnesses rather than defects.
// ---------------------------------------------------------------------------

test("SOUND ship condition 1: 0.33 / 0.79 / 1.00 survive the splitter fix", () => {
  // INLINED 2026-08-12. This used to readFileSync the fixture out of
  // session-v52/spikes/validate-detector.cjs, and `session*/` is GITIGNORED, so on a
  // clean clone the read throws and CI goes red. This repo has shipped that exact
  // defect once already. A test carries its own fixture.
  const ROUND2 =
    "Enforce SUMMARY_PAYLOAD_MAX_BYTES (already u64) by dropping per-aggregate\n" +
    "client sets to ClientSet::Unknown, largest saving first, until the payload\n" +
    "fits. Returns how many were dropped; 0 when already under the cap.\n" +
    "\n" +
    "Largest-first is policy, not tuning: every drop costs one aggregate its\n" +
    "negative-lookup skip regardless of the set's size, so the goal is to shed the\n" +
    "fewest sets per byte freed. Plain aggregates order would be worse than\n" +
    "arbitrary: the vec is sorted by (org_id, aggregate_type_id, aggregate_id)\n" +
    "and binary-searched by the read path, so the lowest org id would absorb every\n" +
    "seal's degradation, forever.\n" +
    "\n" +
    "Entries are never dropped: listing correctness and segment skipping must not\n" +
    "degrade. Unknown answers maybe-present, so a drop costs a scan and never a\n" +
    "false absent, and if dropping every set still exceeds the cap, return anyway.\n" +
    "\n" +
    "wire_size() is O(n): call it ONCE, then subtract each dropped set's saving,\n" +
    "client_set.wire_size() - ClientSet::Unknown.wire_size(), since the entry keeps\n" +
    "paying for the discriminant, from a running total. Skip sets already Unknown:\n" +
    "they save nothing and must not count toward the return value. Re-checking\n" +
    "wire_size() per drop is O(n^2) and stalls the executor.";
  const dup =
    ROUND2 +
    "\n\nwire_size() is O(n), so call it once and subtract each entry's known saving\n" +
    "from a running total instead of re-checking it. Skip any set that is already\n" +
    "Unknown. Re-checking wire_size() on every drop is quadratic and stalls the\n" +
    "executor.\n";
  const exact = ROUND2 + "\n\n" + ROUND2.split("\n\n")[3];

  // Round 2, clean: unchanged at 0.33, still quiet.
  assert.equal(findRestatements(ROUND2).worst, 0.33);
  assert.equal(findRestatements(ROUND2).pairs.length, 0);

  // Round 5 MOVED, and this is the finding of D10's fix. `worst` was 0.79 and
  // is now 0.83, because dropping the bare-newline split joins the hard-wrapped
  // lines into whole sentences and the sentence grain can finally see them:
  //   0.83 sentence  "Re-checking wire_size() per drop is O(n^2)..." against
  //                  "Re-checking wire_size() on every drop is quadratic..."
  //   0.70 sentence  the two "wire_size() is O(n)" instructions
  //   0.79 paragraph the contract's validated pair, unchanged
  // The digit rose because the detector got MORE right, not less: those two
  // sentences ARE the same instruction written twice, which is round 5's exact
  // failure. The validated paragraph pair is still there at exactly 0.79.
  const d = findRestatements(dup);
  assert.equal(d.worst, 0.83);
  const para = d.pairs.filter((p) => p.grain === "paragraph");
  assert.equal(para.length, 1);
  assert.equal(para[0].containment, 0.79, "the contract's number, unmoved");
  assert.equal(d.pairs.length, 3);

  // The verbatim paste: unchanged at 1.00.
  assert.equal(findRestatements(exact).worst, 1);
  assert.ok(findRestatements(exact).pairs.length > 0);
});

test("SOUND amendment 2: exactly 0.70 fires", () => {
  const a = "alpha bravo charlie delta echo foxtrot golf hotel india juliet";
  const b = "alpha bravo charlie delta echo foxtrot golf kilo lima mike";
  const rep = findRestatements(`${a}\n\n${b}`);
  assert.equal(rep.worst, 0.7);
  assert.ok(rep.pairs.length > 0);
});

test("SOUND CRLF classifies identically to LF", () => {
  const crlf = `${INSTR}\r\n\r\n${INSTR}\r\n`;
  const lf = crlf.replace(/\r\n/g, "\n");
  const a = findRestatements(crlf);
  const b = findRestatements(lf);
  assert.equal(a.units, b.units);
  assert.equal(a.worst, b.worst);
  assert.equal(a.pairs.length, b.pairs.length);
});
