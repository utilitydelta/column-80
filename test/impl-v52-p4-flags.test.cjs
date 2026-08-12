// IMPLEMENTER (white-box) - session-v52 phase 4: the two flags
// (`src/core/tightenFlags.ts`).
//
// The contract is `session-v52/contract-p4.md`. A blind oracle tests the same
// surface from the contract alone; this file tests what the contract does not
// name, and it exists mostly to hold two lines that are easy to lose:
//
//   - The restatement detector is a PORT, not a rewrite. The spike
//     (`session-v52/spikes/detector.cjs`) was validated against three known
//     cases before its corpus numbers were believed, so this file re-runs the
//     spike's own splitter, tokenizer and containment against the port and
//     requires identical unit lists and identical numbers. A re-derivation that
//     agrees on the three fixtures and disagrees on a fourth input is the
//     failure mode that matters.
//   - The undefined-term rule is deliberately narrow. Round 2 must yield ZERO
//     flags, which is a much harder condition than "round 4 fires", and the
//     tests below pin exactly which candidates each fixture produces so that a
//     later widening shows up as a diff and not as a feeling.
//
// Run: SKIP_LIVE=1 node --test test/impl-v52-p4-flags.test.cjs

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-v52-p4-flags",
  `export {
  RESTATEMENT_MIN_TOKENS,
  RESTATEMENT_THRESHOLD,
  findRestatements,
  findUndefinedTerms,
} from "../src/core/tightenFlags";\n`,
);
const {
  RESTATEMENT_MIN_TOKENS,
  RESTATEMENT_THRESHOLD,
  findRestatements,
  findUndefinedTerms,
} = mod;
test.after(cleanup);

// The spike itself, required directly, so "ported" is a measurement and not a
// claim in a comment.
// GUARDED 2026-08-12. `session*/` is GITIGNORED, so on a clean clone this require
// throws and every row in the file dies with it, CI included. This repo has shipped
// that exact defect once already. The port-fidelity rows are a LOCAL instrument: they
// compare the shipped detector against the spike it was ported from, and the spike is
// developer material that is deliberately not published. Absent, they skip LOUDLY and
// the rest of the file still runs, including the three validation cases, which carry
// their own fixtures and are what the contract actually gates on.
const SPIKE_PATH = path.join(__dirname, "..", "session-v52", "spikes", "detector.cjs");
const spike = require("node:fs").existsSync(SPIKE_PATH) ? require(SPIKE_PATH) : undefined;
const spikeGone = () => {
  if (spike === undefined) {
    console.log("  SKIP: session-v52/spikes/detector.cjs is absent (session dirs are gitignored),");
    console.log("        so the port-versus-spike comparison cannot run. The validation cases still do.");
    return true;
  }
  return false;
};

// ------------------------------------------------------------- the fixtures
// Copied, not paraphrased, from `session-v52/spikes/validate-detector.cjs`.

const ROUND2 = `
Enforce SUMMARY_PAYLOAD_MAX_BYTES (already u64) by dropping per-aggregate
client sets to ClientSet::Unknown, largest saving first, until the payload
fits. Returns how many were dropped; 0 when already under the cap.

Largest-first is policy, not tuning: every drop costs one aggregate its
negative-lookup skip regardless of the set's size, so the goal is to shed the
fewest sets per byte freed. Plain aggregates order would be worse than
arbitrary: the vec is sorted by (org_id, aggregate_type_id, aggregate_id)
and binary-searched by the read path, so the lowest org id would absorb every
seal's degradation, forever.

Entries are never dropped: listing correctness and segment skipping must not
degrade. Unknown answers maybe-present, so a drop costs a scan and never a
false absent, and if dropping every set still exceeds the cap, return anyway.

wire_size() is O(n): call it ONCE, then subtract each dropped set's saving,
client_set.wire_size() - ClientSet::Unknown.wire_size(), since the entry keeps
paying for the discriminant, from a running total. Skip sets already Unknown:
they save nothing and must not count toward the return value. Re-checking
wire_size() per drop is O(n^2) and stalls the executor.
`.trim();

// Round 5's buffer: paragraph 4 present twice, the old copy and the new one.
const ROUND5_DUPLICATED = ROUND2 + `

wire_size() is O(n), so call it once and subtract each entry's known saving
from a running total instead of re-checking it. Skip any set that is already
Unknown. Re-checking wire_size() on every drop is quadratic and stalls the
executor.
`;

// The exact-copy case: an editing slip that pastes the same paragraph twice.
const ROUND5_EXACT = ROUND2 + "\n\n" + ROUND2.split("\n\n")[3];

// Round 4's spec: round 2's first three paragraphs, plus the fourth paragraph
// in the wording `ROUND5_DUPLICATED` appends. That version says "subtract each
// entry's known saving" and never defines a saving.
const ROUND4 =
  ROUND2.split("\n\n").slice(0, 3).join("\n\n") +
  "\n\n" +
  ROUND5_DUPLICATED.split("\n\n")[4].trim();

// The docs version of round 2, backticks and all (`docs/dumb-models-work.md`),
// because the product's real input has been through phase 3 and IS backticked.
const ROUND2_BACKTICKED = `
Enforce \`SUMMARY_PAYLOAD_MAX_BYTES\` (already \`u64\`) by dropping per-aggregate
client sets to \`ClientSet::Unknown\`, largest saving first, until the payload
fits. Returns how many were dropped; 0 when already under the cap.

Largest-first is policy, not tuning: every drop costs one aggregate its
negative-lookup skip regardless of the set's size, so the goal is to shed the
fewest sets per byte freed. Plain \`aggregates\` order would be worse than
arbitrary: the vec is sorted by \`(org_id, aggregate_type_id, aggregate_id)\`
and binary-searched by the read path, so the lowest org id would absorb every
seal's degradation, forever.

Entries are never dropped: listing correctness and segment skipping must not
degrade. \`Unknown\` answers maybe-present, so a drop costs a scan and never a
false absent, and if dropping every set still exceeds the cap, return anyway.

\`wire_size()\` is O(n): call it ONCE, then subtract each dropped set's saving,
\`client_set.wire_size() - ClientSet::Unknown.wire_size()\`, since the entry keeps
paying for the discriminant, from a running total. Skip sets already \`Unknown\`:
they save nothing and must not count toward the return value. Re-checking
\`wire_size()\` per drop is O(n²) and stalls the executor.
`.trim();

/** The names the anchor tiers would have resolved for this target. Derived
 *  mechanically from the code-style tokens the prose itself spells, so the set
 *  is not a knob that can be turned until a fixture goes green. */
const RESOLVED = [
  "SUMMARY_PAYLOAD_MAX_BYTES",
  "ClientSet",
  "Unknown",
  "wire_size",
  "client_set",
  "aggregates",
  "org_id",
  "aggregate_type_id",
  "aggregate_id",
  "u64",
];

const terms = (t) => t.map((f) => f.term);

// ------------------------------------------------- the port is a port (spike)

test("restatement constants are the spike's", () => {
  if (spikeGone()) return;
  assert.equal(RESTATEMENT_THRESHOLD, spike.THRESHOLD);
  assert.equal(RESTATEMENT_THRESHOLD, 0.7);
  assert.equal(RESTATEMENT_MIN_TOKENS, 5);
});

/**
 * The spike's own mechanics, with ONE substitution: the sentence splitter no
 * longer breaks on a bare newline (triage defect 1).
 *
 * This is the fidelity reference. The port is still a port: it reuses the
 * spike's exported `contentTokens`, `containment` and `paragraphs` verbatim, so
 * every part of the validated instrument except the one deliberate change is
 * still measured against the original. Re-deriving the whole thing here would
 * throw away the validation the same way a re-derivation in src would.
 */
const reference = (text, { guardNegation = true } = {}) => {
  const NEG = ["not", "no", "never", "without", "unless", "except", "nor"];
  const negKey = (s) => {
    const l = s.toLowerCase();
    const c = NEG.map((w) => (l.match(new RegExp(`\\b${w}\\b`, "g")) ?? []).length);
    c[0] += (l.match(/n['’]t\b/g) ?? []).length;
    return c.join(",");
  };
  const sentences = text
    .split(/(?<=[.!?])\s+|\n\s*\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  const live = (units) =>
    units
      .map((s) => ({ s, set: new Set(spike.contentTokens(s)), neg: negKey(s) }))
      .filter((u) => u.set.size >= RESTATEMENT_MIN_TOKENS);
  let worst = 0;
  let fired = 0;
  const sent = live(sentences);
  const para = live(spike.paragraphs(text));
  for (const [units, guard] of [[sent, guardNegation], [para, false]]) {
    for (let i = 0; i < units.length; i++) {
      for (let j = i + 1; j < units.length; j++) {
        const c = spike.containment(units[i].set, units[j].set);
        if (c > worst) worst = c;
        if (c >= RESTATEMENT_THRESHOLD && !(guard && units[i].neg !== units[j].neg)) fired++;
      }
    }
  }
  return { units: sent.length, worst: Number(worst.toFixed(2)), fired };
};

test("port agrees with the spike's mechanics on every fixture", () => {
  if (spikeGone()) return;
  for (const [label, text] of [
    ["round 2", ROUND2],
    ["round 5 duplicated", ROUND5_DUPLICATED],
    ["round 5 exact", ROUND5_EXACT],
    ["round 4", ROUND4],
    ["round 2 backticked", ROUND2_BACKTICKED],
  ]) {
    const mine = findRestatements(text);
    const theirs = reference(text);
    assert.equal(mine.units, theirs.units, `${label}: units`);
    assert.equal(mine.worst, theirs.worst, `${label}: worst`);
    assert.equal(mine.totalPairs, theirs.fired, `${label}: pairs fired`);
  }
});

test("the ONLY divergence from the raw spike is the bare-newline split", () => {
  if (spikeGone()) return;
  // Prose with no mid-sentence newline cannot tell the two splitters apart, so
  // on those inputs the port must still equal `spikes/detector.cjs` exactly.
  // This is what stops "we changed the splitter" quietly becoming "we changed
  // the detector".
  const unwrapped = [
    "a. b. c.",
    "Ends with no terminator",
    "Multiple!!! Terminators??? Here...",
    "para one\n\npara two with several more content words in it here",
    ROUND2.replace(/\n(?!\n)/g, " "),
    ROUND2_BACKTICKED.replace(/\n(?!\n)/g, " "),
    ROUND5_EXACT.replace(/\n(?!\n)/g, " "),
  ];
  for (const text of unwrapped) {
    const mine = findRestatements(text);
    const raw = spike.redundancy(text);
    assert.equal(mine.units, raw.units, `units for ${JSON.stringify(text.slice(0, 40))}`);
    assert.equal(mine.worst, raw.worst, `worst for ${JSON.stringify(text.slice(0, 40))}`);
  }
  // And on wrapped prose the port reports FEWER units than the spike, never
  // more: removing a splitter only ever joins.
  for (const text of [ROUND2, ROUND5_DUPLICATED, ROUND2_BACKTICKED]) {
    assert.ok(findRestatements(text).units < spike.redundancy(text).units);
  }
});

test("port agrees with the reference on ADVERSARIAL inputs, not only the fixtures", () => {
  if (spikeGone()) return;
  // A re-derivation that matches on three known cases and diverges elsewhere is
  // the failure this row exists for. Every input here bites a different edge of
  // the splitter or the tokenizer.
  const inputs = [
    "",
    "   ",
    "\n\n\n",
    "one",
    "a. b. c.",
    "Ends with no terminator",
    "Multiple!!! Terminators??? Here...",
    "trailing.   \n\n  leading",
    "line one\nline two\nline three",
    "para one\n\n\npara two",
    "Tokens_with_underscores and CamelCase and ALLCAPS and digits123.",
    "ab cd ef gh ij",
    "the a an of to in on for with as at by",
    "Subtract each entry's known saving from a running total.\nSubtract each entry's known saving from a running total.",
    ROUND2.replace(/\n/g, " "),
    ROUND2 + "\n\n" + ROUND2,
    "x".repeat(500),
    "word ".repeat(400),
  ];
  for (const text of inputs) {
    const mine = findRestatements(text);
    const theirs = reference(text);
    assert.equal(mine.units, theirs.units, `units for ${JSON.stringify(text.slice(0, 40))}`);
    assert.equal(mine.worst, theirs.worst, `worst for ${JSON.stringify(text.slice(0, 40))}`);
    assert.equal(
      mine.totalPairs,
      theirs.fired,
      `fired for ${JSON.stringify(text.slice(0, 40))}`,
    );
  }
});

test("the port's units ARE the reference's live sentence spans, string for string", () => {
  if (spikeGone()) return;
  for (const text of [ROUND2, ROUND5_DUPLICATED, ROUND5_EXACT]) {
    const theirs = text
      .split(/(?<=[.!?])\s+|\n\s*\n/)
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((s) => new Set(spike.contentTokens(s)).size >= RESTATEMENT_MIN_TOKENS);
    // The port does not expose its unit list, so reconstruct it from the pairs
    // plus the count: the count must match, and every sentence-grain span the
    // port reports must be a member of the live list.
    const mine = findRestatements(text);
    assert.equal(mine.units, theirs.length);
    for (const p of mine.pairs) {
      if (p.grain !== "sentence") continue;
      assert.ok(theirs.includes(p.a.text), `unknown span: ${p.a.text}`);
      assert.ok(theirs.includes(p.b.text), `unknown span: ${p.b.text}`);
    }
  }
});

// ------------------------------------------------------- ship condition 1

test("ship condition 1: the three validation cases classify correctly", () => {
  // The unit counts fell (15/17/19 -> 9/11/12) when the bare-newline split went
  // away: these fixtures are hard-wrapped, so several "sentences" were lines.
  const clean = findRestatements(ROUND2);
  assert.equal(clean.pairs.length, 0, "clean spec must not fire");
  assert.equal(clean.worst, 0.33);
  assert.equal(clean.units, 9);

  const restated = findRestatements(ROUND5_DUPLICATED);
  assert.ok(restated.pairs.length > 0, "round 5's shape must fire");
  assert.equal(restated.worst, 0.83);
  assert.equal(restated.units, 11);

  const pasted = findRestatements(ROUND5_EXACT);
  assert.ok(pasted.pairs.length > 0, "a verbatim paste must fire");
  assert.equal(pasted.worst, 1);
  assert.equal(pasted.units, 12);
});

test("round 5's paragraph pair is still exactly 0.79, whatever the sentences do", () => {
  // Before the splitter fix this was the ONLY pair, and the contract's number.
  // Whole sentences are now comparable, so two sentence pairs join it (0.83 and
  // 0.70) and `worst` rises to 0.83. The paragraph pair is untouched, and the
  // grain still carries the case: the paragraph is restated in NEW WORDS, which
  // is why a sentence-only detector was never enough.
  const r = findRestatements(ROUND5_DUPLICATED);
  const para = r.pairs.filter((p) => p.grain === "paragraph");
  assert.equal(para.length, 1);
  assert.equal(para[0].containment, 0.79);
  assert.equal(r.pairs.length, 3);
  assert.deepEqual(
    r.pairs.filter((p) => p.grain === "sentence").map((p) => p.containment).sort(),
    [0.7, 0.83],
  );
});

test("the verbatim paste fires at both grains and does not dedupe them", () => {
  const r = findRestatements(ROUND5_EXACT);
  const grains = new Set(r.pairs.map((p) => p.grain));
  assert.ok(grains.has("sentence"));
  assert.ok(grains.has("paragraph"));
  // Amendment 7: a sentence pair and a paragraph pair over the same text are
  // both evidence, and the caller picks.
  const para = r.pairs.filter((p) => p.grain === "paragraph");
  const sent = r.pairs.filter((p) => p.grain === "sentence");
  assert.ok(para.length >= 1 && sent.length >= 1);
});

// ------------------------------------------------------- offsets and verbatim

test("ship condition 3: every restatement span is a verbatim slice of the input", () => {
  for (const text of [ROUND5_DUPLICATED, ROUND5_EXACT, ROUND2 + "\n\n" + ROUND2]) {
    const r = findRestatements(text);
    assert.ok(r.pairs.length > 0);
    for (const p of r.pairs) {
      assert.equal(text.slice(p.a.start, p.a.end), p.a.text);
      assert.equal(text.slice(p.b.start, p.b.end), p.b.text);
      assert.ok(p.a.start < p.b.start, "a precedes b, so a deletion offer is ordered");
      assert.ok(p.a.text.trim() === p.a.text, "spans are trimmed, as the spike trims");
      assert.ok(p.b.text.trim() === p.b.text);
    }
  }
});

test("offsets survive a leading blank region, which a naive indexOf would not", () => {
  // Two identical paragraphs, the second of which also appears inside the first
  // as a substring would if the port looked spans up by search instead of
  // tracking them. `indexOf` would report the first copy twice.
  const text = "\n\n   \n" + ROUND2 + "\n\n" + ROUND2.split("\n\n")[3];
  const r = findRestatements(text);
  assert.ok(r.pairs.length > 0);
  for (const p of r.pairs) {
    assert.equal(text.slice(p.a.start, p.a.end), p.a.text);
    assert.equal(text.slice(p.b.start, p.b.end), p.b.text);
    assert.notEqual(p.a.start, p.b.start);
  }
});

// -------------------------------------------------------- ship condition 4

test("ship condition 4: never throws, on anything", () => {
  const junk = [
    "", " ", "\n", "a", "...", "!!!", " ", "😀 😀 😀 😀 😀",
    "x".repeat(1000), null, undefined, 42, {}, [], NaN,
  ];
  for (const j of junk) {
    const r = findRestatements(j);
    assert.equal(typeof r.units, "number");
    assert.equal(typeof r.worst, "number");
    assert.ok(Array.isArray(r.pairs));
    assert.equal(findUndefinedTerms({ prose: j, resolved: [] }).length >= 0, true);
  }
  // Amendment 6: a non-string is an empty report, never a partial.
  for (const j of [null, undefined, 42, {}, []]) {
    assert.deepEqual(findRestatements(j), {
      units: 0, worst: 0, pairs: [], totalPairs: 0, truncated: false, unmeasured: 0,
    });
    assert.deepEqual(findUndefinedTerms(j), []);
    assert.deepEqual(findUndefinedTerms({ prose: j, resolved: [] }), []);
  }
  assert.deepEqual(findUndefinedTerms({ prose: ROUND4 }), findUndefinedTerms({ prose: ROUND4, resolved: [] }));
});

test("a 100KB paste is a report, not an exception, and not a million records", () => {
  const paste = (ROUND2 + "\n\n").repeat(Math.ceil(100000 / (ROUND2.length + 2)));
  assert.ok(paste.length >= 100000);
  const t0 = Date.now();
  const r = findRestatements(paste);
  const ms = Date.now() - t0;
  assert.equal(r.worst, 1);
  // Capped PER GRAIN, so 100 sentence pairs plus 100 paragraph pairs is the
  // ceiling, and the report says how many it did not show.
  assert.ok(r.pairs.length <= 200, `pairs capped, got ${r.pairs.length}`);
  assert.ok(r.truncated, "a paste this self-similar must report truncation");
  assert.ok(r.totalPairs > r.pairs.length);
  assert.ok(r.units > 100);
  // Not a latency gate: a manual command has no deadline. It is a guard against
  // the quadratic becoming a hang, which is the one failure a pure helper on a
  // command path must not have.
  assert.ok(ms < 20000, `100KB took ${ms}ms`);
});

test("worst is 0 when nothing was compared, and rounded to two places", () => {
  assert.equal(findRestatements("short").worst, 0);
  assert.equal(findRestatements("the a an of to").worst, 0);
  const r = findRestatements(ROUND2);
  assert.equal(r.worst, Number(r.worst.toFixed(2)));
  for (const p of r.pairs) {
    assert.equal(p.containment, Number(p.containment.toFixed(2)));
  }
});

test("the threshold is inclusive: exactly 0.70 fires", () => {
  // Ten content tokens against ten, seven shared. 7/10 = 0.70 exactly.
  const a = "alpha bravo charlie delta echo foxtrot golf hotel india juliet.";
  const b = "alpha bravo charlie delta echo foxtrot golf kilo lima mike.";
  const r = findRestatements(a + "\n" + b);
  assert.equal(r.worst, 0.7);
  assert.ok(r.pairs.length > 0, "0.70 must fire, as the spike's >= does");
});

test("the min-token filter drops short units from the comparison entirely", () => {
  // Four content tokens each, identical: containment would be 1.00 if compared.
  const short = "alpha bravo charlie delta.\nalpha bravo charlie delta.";
  const r = findRestatements(short);
  assert.equal(r.units, 0);
  assert.equal(r.worst, 0);
  assert.equal(r.pairs.length, 0);
});

// -------------------------------------------------- ship condition 2: terms

test("ship condition 2: round 4 fires and round 2 does not", () => {
  const four = findUndefinedTerms({ prose: ROUND4, resolved: RESOLVED });
  assert.ok(terms(four).includes("saving"), `round 4 must flag saving, got ${terms(four)}`);

  const two = findUndefinedTerms({ prose: ROUND2, resolved: RESOLVED });
  assert.deepEqual(two, [], `round 2 must be silent, got ${terms(two)}`);
});

test("round 2 is silent BECAUSE of the definition, not because saving is unreachable", () => {
  // The discriminator has to be the appositive definition clause and nothing
  // else. Strip that clause out of round 2 and the same prose must flag saving,
  // or the silence above was an accident of the candidate rule.
  const stripped = ROUND2.replace(
    "\nclient_set.wire_size() - ClientSet::Unknown.wire_size(),",
    "",
  );
  assert.notEqual(stripped, ROUND2);
  const t = findUndefinedTerms({ prose: stripped, resolved: RESOLVED });
  assert.ok(terms(t).includes("saving"), `expected saving, got ${terms(t)}`);
});

test("the candidate set is small, and this row pins exactly how small", () => {
  // Nounhood without a part-of-speech tagger is the risky part of this module.
  // With no definition filter and no stop lists, a loose rule produced eleven
  // candidates on round 2; the shipped rule produces one. Pinning both fixtures
  // means a later widening shows up as a diff.
  const noFilter = (prose) => findUndefinedTerms({ prose, resolved: [] });
  assert.deepEqual(terms(noFilter(ROUND2)), [], "round 2: only saving, and it is defined");
  // Round 4's "Skip any set that is already Unknown" also yields a head, `set`,
  // and it is dropped by the flag's own stop list because `set` is one of the
  // contract's instruction verbs. Nothing about `resolved` is doing that work.
  assert.deepEqual(terms(noFilter(ROUND4)), ["saving"]);
});

test("round 4 reports the term's own offsets, verbatim, amendment 1", () => {
  const [flag] = findUndefinedTerms({ prose: ROUND4, resolved: RESOLVED });
  assert.equal(flag.term, "saving");
  assert.equal(ROUND4.slice(flag.start, flag.end), "saving");
  assert.ok(flag.sentence.includes("subtract each entry's known saving"));
  assert.ok(ROUND4.includes(flag.sentence), "the sentence is a verbatim span of the prose");
  assert.ok(flag.start >= ROUND4.indexOf(flag.sentence));
  assert.ok(flag.end <= ROUND4.indexOf(flag.sentence) + flag.sentence.length);
  // "largest saving first" in paragraph 1 plus the instruction use.
  assert.equal(flag.uses, 2);
});

test("the reported occurrence is the INSTRUCTION one, not the first mention", () => {
  const [flag] = findUndefinedTerms({ prose: ROUND4, resolved: RESOLVED });
  const firstMention = ROUND4.indexOf("saving");
  assert.ok(
    flag.start > firstMention,
    "paragraph 1's 'largest saving first' is not an instruction and must not be the site",
  );
});

test("resolved and stopNames each silence a term, under the fold", () => {
  const base = findUndefinedTerms({ prose: ROUND4, resolved: RESOLVED });
  assert.deepEqual(terms(base), ["saving"]);

  // The fold is case and separator insensitive: SAVING, Saving and "saving"
  // are one key, which is the whole point of phase 2's fold.
  for (const spelling of ["saving", "Saving", "SAVING", "SAVING_"]) {
    const r = findUndefinedTerms({ prose: ROUND4, resolved: [...RESOLVED, spelling] });
    assert.ok(!terms(r).includes("saving"), `resolved as ${spelling} should silence it`);
  }
  const stopped = findUndefinedTerms({
    prose: ROUND4,
    resolved: RESOLVED,
    stopNames: new Set(["saving", "set"]),
  });
  assert.deepEqual(stopped, []);
});

test("every definition marker in the contract silences the flag", () => {
  const instruction = "Subtract each entry's known saving from a running total.";
  const defs = [
    "A saving is the width the entry stops paying.",
    "Savings are the width the entry stops paying.".replace("Savings", "Saving are"),
    "A saving means the width the entry stops paying.",
    "A saving equals the width the entry stops paying.",
    "A saving, defined as the width the entry stops paying, is subtracted.",
    "saving: the width the entry stops paying.",
    "the saving, client_set.wire_size() - ClientSet::Unknown.wire_size(), is fixed.",
    "the saving, `ClientSet::wire_size`, is fixed.",
  ];
  for (const def of defs) {
    const r = findUndefinedTerms({ prose: instruction + "\n\n" + def, resolved: [] });
    assert.ok(!terms(r).includes("saving"), `should be defined by: ${def}`);
  }
  // The control: the same instruction with prose that mentions the word and
  // defines nothing still fires.
  const control = instruction + "\n\nThe saving matters here.";
  assert.ok(terms(findUndefinedTerms({ prose: control, resolved: [] })).includes("saving"));
});

test("a definition elsewhere in the comment counts, wherever it sits", () => {
  const def = "A saving is the width the entry stops paying.";
  const use = "Subtract each entry's known saving from a running total.";
  for (const prose of [def + "\n\n" + use, use + "\n\n" + def, def + " " + use]) {
    assert.deepEqual(findUndefinedTerms({ prose, resolved: [] }), [], prose);
  }
});

test("a backticked word is never a candidate: that is phase 3's business", () => {
  const bare = "Subtract each entry's known saving from a running total.";
  const ticked = "Subtract each entry's known `saving` from a running total.";
  assert.deepEqual(terms(findUndefinedTerms({ prose: bare, resolved: [] })), ["saving"]);
  assert.deepEqual(terms(findUndefinedTerms({ prose: ticked, resolved: [] })), []);
});

test("a code-style word is never a candidate either", () => {
  for (const word of ["client_set", "ClientSet", "wireSize", "saving2", "SAVING"]) {
    const prose = `Subtract each entry's known ${word} from a running total.`;
    assert.deepEqual(terms(findUndefinedTerms({ prose, resolved: [] })), [], word);
  }
});

test("a sentence with no instruction verb and no modal yields nothing", () => {
  const prose = "The running total is a saving of some kind in the general case.";
  assert.deepEqual(findUndefinedTerms({ prose, resolved: [] }), []);
});

test("an imperative NOT at a clause head is a noun or a finite verb, not an instruction", () => {
  // "the return value" and "the set's size" both contain listed verbs, and both
  // are noun phrases. Whether a flag fires must not depend on that collision.
  const prose = "They save nothing toward the return value of the set's size.";
  assert.deepEqual(findUndefinedTerms({ prose, resolved: [] }), []);
});

test("an object phrase with no POSSESSIVE proves no noun", () => {
  // Round 2's own "Skip sets already Unknown" is this shape, and it is why that
  // sentence contributes no candidate.
  assert.deepEqual(findUndefinedTerms({ prose: "Skip sets already Unknown.", resolved: [] }), []);
  // A determiner is NOT enough, and that is the narrowing the triage's gate
  // bought: "an instruction verb plus a determiner" fired on 10.5% of 17,774
  // real doc-comment blocks. `Emit a record.` has that shape.
  assert.deepEqual(findUndefinedTerms({ prose: "Skip any leftover margin.", resolved: [] }), []);
  assert.deepEqual(findUndefinedTerms({ prose: "Emit a record.", resolved: [] }), []);
  // A possessive is. Round 4's `each entry's known saving` is this shape.
  assert.deepEqual(
    terms(findUndefinedTerms({ prose: "Skip the run's leftover margin.", resolved: [] })),
    ["margin"],
  );
});

test("a modal governs a verb, and a modal followed by a determiner governs none", () => {
  assert.deepEqual(
    terms(findUndefinedTerms({ prose: "It must not exceed the tier's agreed headroom.", resolved: [] })),
    ["headroom"],
  );
  // Round 2's "and never a false absent": the modal is followed by an article,
  // so there is no verb and therefore no object.
  assert.deepEqual(
    findUndefinedTerms({ prose: "A drop costs a scan and never a false absent.", resolved: [] }),
    [],
  );
});

test("the head is the LAST bare word of the phrase, and a preposition ends it", () => {
  // "from a running total" must not become the reported term.
  const [flag] = findUndefinedTerms({
    prose: "Subtract each entry's known saving from a running total.",
    resolved: [],
  });
  assert.equal(flag.term, "saving");
});

test("the extra English stop words are not what makes the fixtures pass", () => {
  // The stop list is the restatement STOP plus the verbs, modals, determiners
  // and phrase ends, plus a short set of contentless prose heads. That last set
  // is the one that could be tuned, so this row proves it is load-bearing for
  // nothing on either fixture: no fixture candidate is one of those words.
  const contentless = new Set([
    "thing", "things", "way", "ways", "case", "cases", "time", "times", "order",
    "reason", "reasons", "point", "points", "part", "parts", "rest", "end",
    "start", "line", "lines", "word", "words", "note", "notes", "kind", "kinds",
    "sort", "step", "steps", "stuff", "bit", "bits", "one", "ones", "anything",
    "everything", "nothing", "something", "already", "anyway", "rather", "yet",
  ]);
  for (const text of [ROUND2, ROUND4, ROUND5_DUPLICATED, ROUND2_BACKTICKED]) {
    for (const flag of findUndefinedTerms({ prose: text, resolved: RESOLVED })) {
      assert.ok(!contentless.has(flag.term), `${flag.term} came from the tunable list`);
    }
  }
});

test("hard wrapping does not decide whether a flag fires", () => {
  // Phase 1 wraps prose under 80 columns minus the indent, so the same sentence
  // is broken at different places in a deeply indented file. The restatement
  // detector splits on a bare newline by design; this pass must not.
  const one = "Subtract each entry's known saving from a running total.";
  const wraps = [
    "Subtract each entry's known saving\nfrom a running total.",
    "Subtract each\nentry's known saving from a running total.",
    "Subtract\neach\nentry's\nknown\nsaving\nfrom\na\nrunning\ntotal.",
  ];
  const want = terms(findUndefinedTerms({ prose: one, resolved: [] }));
  assert.deepEqual(want, ["saving"]);
  for (const w of wraps) {
    assert.deepEqual(terms(findUndefinedTerms({ prose: w, resolved: [] })), want, w);
  }
});

test("the backticked docs version of round 2 is silent too", () => {
  // The product's real input has been through phase 3, so it arrives with the
  // identifiers backticked. Same spec, same silence.
  const t = findUndefinedTerms({ prose: ROUND2_BACKTICKED, resolved: RESOLVED });
  assert.deepEqual(t, [], `got ${terms(t)}`);
});

test("nothing here writes a word: every string returned is a slice of the input", () => {
  for (const text of [ROUND2, ROUND4, ROUND5_DUPLICATED, ROUND5_EXACT, ROUND2_BACKTICKED]) {
    for (const flag of findUndefinedTerms({ prose: text, resolved: RESOLVED })) {
      assert.equal(text.slice(flag.start, flag.end), flag.term);
      assert.ok(text.includes(flag.sentence));
      assert.ok(flag.uses >= 1);
    }
    for (const p of findRestatements(text).pairs) {
      assert.equal(text.slice(p.a.start, p.a.end), p.a.text);
      assert.equal(text.slice(p.b.start, p.b.end), p.b.text);
    }
  }
});

test("one term is reported once, however many instruction sentences use it", () => {
  const prose =
    "Subtract each entry's known saving from a running total.\n\n" +
    "Then drop the largest saving. Skip any zero saving.";
  const t = findUndefinedTerms({ prose, resolved: [] });
  assert.deepEqual(terms(t), ["saving"]);
  assert.equal(t[0].uses, 3);
});
