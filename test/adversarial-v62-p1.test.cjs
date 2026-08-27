// ADVERSARIAL REVIEW - session-v62 phase 1: the voice.
//
// Fresh eyes over `src/core/criticizeVoice.ts`. Written as an attack file; kept
// as a regression file, because several of its rows cover ground the blind
// oracle and the implementer's white-box file both leave open:
//
//   - AMENDMENT 12, that the offending line's own text never reaches the
//     comment. Neither other file pins it.
//   - AMENDMENT 6 in the JOINED COMMENT rather than in the `VOICE` table. Both
//     other files count beats on the table alone.
//   - THE FILL IS MAXIMAL. A wrapper that broke one column early would satisfy
//     every `<= 80` row in both other files and would still waste a column on
//     every comment the product writes.
//   - TAB WIDTH ON BOTH SIDES OF THE BUDGET, checked against a space-indent
//     control of the same display width. Go and Rust indent with tabs.
//   - A HOSTILE `dimension` KEY, which reaches `Object.prototype` through the
//     table lookup.
//   - THE REAL DETECTORS' REAL DETAILS. Both other files hand-write their
//     details, so neither can see what the product actually joins.
//
// Every row pins the LIVE contract: `session-v62/contracts/phase1-voice.md`
// through Amendment 4. Where a finding of this review was triaged the other
// way, the row was FLIPPED to pin the ruling rather than deleted, and says so.
// Amendment 3 is the triage of this review; Amendment 4 repeals Amendment 2 in
// full, so no row here mentions a short form or a trailing slot.
//
// Run: node --test test/adversarial-v62-p1.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

// The voice module, plus the REAL signature detectors and the REAL language
// table. A detail invented in a test file proves the join works on strings the
// product will never see; the rows in section 3 run the actual detector and
// hand its actual finding to the actual comment builder.
const { mod, cleanup } = bundleCore(
  "adv-v62-p1",
  `export * from "../src/core/criticizeVoice";
export { SIGNATURE_DETECTORS } from "../src/core/criticizeSignature";
export { criticizeLangFor } from "../src/core/criticizeLang";
export { TIGHTEN_TAB_WIDTH, tightenWidth } from "../src/core/tightenRegion";\n`,
);
test.after(cleanup);

const {
  VOICE,
  C80_TAG,
  VOICE_COLUMN,
  criticizeComment,
  wrapComment,
  SIGNATURE_DETECTORS,
  criticizeLangFor,
  TIGHTEN_TAB_WIDTH,
  tightenWidth,
} = mod;

const DIMENSIONS = [
  "clock", "prng", "env", "world",
  "adjacent-params", "bool-param", "unused-param", "param-count",
  "undocumented", "unenforced-precondition", "cqs",
  "pass-through", "nesting",
  "unadmitted-failure",
  "section-comment",
];

/** A detail per dimension in the detectors' own register: lower case, no
 *  trailing stop, and free of the reserved blast vocabulary. */
const DETAIL = {
  clock: "reads the wall clock through Instant::now",
  prng: "seeds a generator through thread_rng",
  env: "reads the process environment through env::var",
  world: "opens a file through File::open",
  "adjacent-params": "first and second are neighbours of type Offset, and the compiler cannot see them swapped",
  "bool-param": "parameter recursive carries a decision the caller had already made",
  "unused-param": "parameter depth never appears in the body",
  "param-count": "the signature takes more parameters than the chosen threshold for rust",
  undocumented: "the public signature carries no doc comment",
  "unenforced-precondition": "the doc states a precondition and the body checks nothing",
  cqs: "answers a question and changes state that outlives the call",
  "pass-through": "every parameter is forwarded unchanged to inner",
  nesting: "the body nests deeper than the chosen threshold for rust",
  "unadmitted-failure": "the body can panic and the return type admits no failure",
  "section-comment": "a comment labels the lines under it, and a labelled section is a step at its own altitude",
};

const findingFor = (dimension, detail) => ({
  dimension,
  line: 42,
  evidence: "let started = Instant::now();",
  detail: detail === undefined ? DETAIL[dimension] : detail,
});

const UNMEASURED = [undefined, {}, { blastRadius: undefined }];
const MEASURED = [{ blastRadius: 0 }, { blastRadius: 1 }, { blastRadius: 7 }, { blastRadius: 231 }];

// Amendment 4 (of Amendment 1): the blast vocabulary is EXACTLY `call site` /
// `call sites`. Amendment 3 clause 3 removed the one detector that spent it.
const RESERVED_CALL_SITE = /\bcall sites?\b/i;
// Amendment 3 (of Amendment 1): the year ban.
const YEAR = /\b(19|20)\d{2}\b/;
const BANNED = /\b(consider|might|maybe|perhaps|probably|you|your|we|our|please|just|simply|recommend|suggest)\b/i;
const RENDERED_PREFIX = (d) => `C80 ${d}: `;
const widthOf = (line) => tightenWidth(line, TIGHTEN_TAB_WIDTH);

/** The half of a comment THIS MODULE authored: the tag, the dimension id, the
 *  blast clause, the fixed phrase and the punctuation between them. Amendment 3
 *  clause 2 scopes voice rules 2, 3 and 4 to exactly this, and exempts the
 *  detector's detail, which amendment 7 gives to the detectors and which the
 *  module is forbidden to re-word. */
const moduleHalf = (text, detail) => (detail ? text.split(detail).join(" ") : text);

// ===========================================================================
// 1. THE MODULE'S OWN TEXT - the scope Amendment 3 clause 2 rules
// ===========================================================================

test("module text: the fixed table spends no call-site vocabulary of its own, all fifteen", () => {
  // That vocabulary belongs to the measured blast clause. A phrase that spent
  // it would make an unmeasured comment read as a measured one, which is the
  // v61 two-state rule broken in the words rather than in the logic.
  for (const dimension of DIMENSIONS) {
    assert.ok(
      !RESERVED_CALL_SITE.test(VOICE[dimension]),
      `${dimension} spends the reserved blast vocabulary: ${VOICE[dimension]}`,
    );
  }
});

test("module text: an unmeasured radius adds no call-site clause, all fifteen, all three spellings of absent", () => {
  for (const dimension of DIMENSIONS) {
    for (const opts of UNMEASURED) {
      const text = criticizeComment(findingFor(dimension), opts);
      assert.ok(
        !RESERVED_CALL_SITE.test(text),
        `${dimension}: an unmeasured blast radius used the reserved vocabulary: ${JSON.stringify(text)}`,
      );
    }
  }
});

test("module text: rules 2, 3 and 4 hold on the module's half, with the detail stripped out", () => {
  // The rule Amendment 3 clause 2 actually ruled, tested as ruled: strip the
  // detector's detail, then apply the year ban, the banned-word list and the
  // question-mark ban to what the module wrote. Walked over all fifteen
  // dimensions and all seven blast-radius states, not spot-checked.
  for (const dimension of DIMENSIONS) {
    for (const opts of [...UNMEASURED, ...MEASURED]) {
      const detail = DETAIL[dimension];
      const text = criticizeComment(findingFor(dimension), opts);
      // The count is a count. Clause 2 says the year rule never applied to it.
      const half = moduleHalf(text, detail).replace(/\b\d+\b/g, "#");
      const where = `${dimension} / ${JSON.stringify(opts)}`;
      assert.ok(!YEAR.test(half), `${where}: a citation reached the module's own text: ${JSON.stringify(half)}`);
      const hit = half.match(BANNED);
      assert.equal(hit, null, `${where}: banned word ${hit && JSON.stringify(hit[0])} in ${JSON.stringify(half)}`);
      assert.ok(!half.includes("?"), `${where}: the module asked a question: ${JSON.stringify(half)}`);
      assert.ok(text.endsWith("."), `${where}: the comment does not close on a full stop: ${JSON.stringify(text)}`);
    }
  }
});

// ===========================================================================
// 2. AMENDMENT COMPLIANCE, CLAUSE BY CLAUSE
// ===========================================================================

test("amendment 3 clause 1: C80_TAG carries its trailing space, and the join adds none", () => {
  // FLIPPED. This review argued the constant should be the bare marker, per
  // Amendment 1 clause 1. The triage went the other way and REPEALED that
  // clause: the constant's job is to be the exact bytes phase 2 strips, so the
  // space belongs to the marker. The row now pins the ruling.
  assert.equal(C80_TAG, "C80 ", `the marker carries its trailing space, got ${JSON.stringify(C80_TAG)}`);
  assert.equal(`${C80_TAG}clock: `, "C80 clock: ", "the join is `${C80_TAG}${dimension}: ` with no space of its own");
  for (const dimension of DIMENSIONS) {
    const text = criticizeComment(findingFor(dimension));
    assert.ok(text.startsWith(`${C80_TAG}${dimension}: `), `${dimension}: wrong prefix: ${text}`);
    assert.ok(!text.startsWith(`${C80_TAG} `), `${dimension}: the join doubled the marker's space: ${text}`);
  }
});

test("amendment 7: a detail carrying a leading capital survives byte for byte", () => {
  // Both other files feed only lower-case details, so neither can see a
  // capitalisation being applied to words the module does not own.
  const detail = "Instant::now is called on the first line";
  const text = criticizeComment(findingFor("clock", detail));
  assert.ok(text.includes(detail), `the detail was re-cased or re-worded: ${JSON.stringify(text)}`);
});

test("amendment 7: a detail already carrying its own stop is not double-stopped", () => {
  const text = criticizeComment(findingFor("clock", "reads the wall clock."));
  assert.ok(!text.includes(".."), `a second stop was appended: ${JSON.stringify(text)}`);
});

test("amendment 11: the comment ends on the table's fix beat, in every blast state, all fifteen", () => {
  for (const dimension of DIMENSIONS) {
    const order = VOICE[dimension].split(". ").pop();
    for (const opts of [...UNMEASURED, ...MEASURED]) {
      const text = criticizeComment(findingFor(dimension), opts);
      assert.ok(text.endsWith(order), `${dimension}: does not end on its order: ${JSON.stringify(text)}`);
    }
  }
});

test("amendment 12: evidence never reaches the comment, for any dimension or blast state", () => {
  // NEITHER OTHER FILE PINS THIS CLAUSE. A future join that decided the
  // offending line "adds context" would be caught here and nowhere else, and
  // the comment is planted next to that exact line.
  const evidence = "let started = SystemTime::now(); // ZZUNIQUEZZ";
  for (const dimension of DIMENSIONS) {
    for (const opts of [undefined, { blastRadius: 0 }, { blastRadius: 9 }]) {
      const text = criticizeComment({ ...findingFor(dimension), evidence }, opts);
      assert.ok(!text.includes("ZZUNIQUEZZ"), `${dimension}: the evidence line was repeated: ${text}`);
    }
  }
});

test("amendment 6: two beats or more in the JOINED COMMENT, not only in the table", () => {
  // Both other files count beats on `VOICE` alone. The floor is the point: a
  // comment that ends on the complaint has no order in it, and the joining is
  // where a beat could be lost.
  for (const dimension of DIMENSIONS) {
    const text = criticizeComment(findingFor(dimension), { blastRadius: 3 });
    const beats = text.slice(RENDERED_PREFIX(dimension).length).split(/(?<=[.!])\s+/).filter(Boolean);
    assert.ok(beats.length >= 2, `${dimension}: one beat is a complaint with no order: ${text}`);
  }
});

// ===========================================================================
// 3. THE DETECTORS' REAL DETAILS, THROUGH THE REAL DETECTOR
// ===========================================================================

function unit(languageId, lines, headIndex) {
  return { languageId, name: "target", lines, startLine: 10, headIndex, bodyIndex: headIndex + 1 };
}

function runDetector(dimension, languageId, lines, headIndex) {
  const lang = criticizeLangFor(languageId);
  assert.ok(lang, `no criticize language for ${languageId}`);
  const detector = SIGNATURE_DETECTORS.find((d) => d.dimension === dimension);
  assert.ok(detector, `no detector for ${dimension}`);
  return detector.run(unit(languageId, lines, headIndex), lang);
}

test("real detail: an everyday C# nullable parameter is LEGAL, and its question mark is the detector's", () => {
  // FLIPPED, and this is the finding that produced Amendment 3 clause 2.
  // `public static Span Splice(string? first, string? second)` is ordinary
  // modern C#; `criticizeSignature.ts` interpolates the type verbatim, so a `?`
  // reaches the comment. Rules 3, 4 and 7 were not jointly satisfiable and the
  // ruling gave the detail to the detectors. The row now pins the boundary: the
  // `?` is allowed, and it must live entirely inside the detail.
  const outcome = runDetector("adjacent-params", "csharp", [
    "/// <summary>Splices two spans.</summary>",
    "public static Span Splice(string? first, string? second)",
    "{",
    "    return Join(first, second);",
    "}",
  ], 1);
  assert.equal(outcome.state, "flagged", `the detector did not fire: ${JSON.stringify(outcome)}`);
  const finding = outcome.findings[0];
  const text = criticizeComment(finding);
  assert.ok(text.includes("string?"), `the C# type was re-worded on the way in: ${JSON.stringify(text)}`);
  assert.ok(
    !moduleHalf(text, finding.detail).includes("?"),
    `the question mark came from the module, not the detail: ${JSON.stringify(text)}`,
  );
  assert.ok(text.endsWith("Give them distinct types."), `the order is still last: ${JSON.stringify(text)}`);
});

test("real detail: parameters named `you` and `we` are LEGAL, and the module's half stays clean", () => {
  // FLIPPED, same ruling. `unused-param` interpolates the parameter NAMES
  // verbatim, and both are legal Python identifiers. Amendment 3 clause 2 scopes
  // the banned-word list to module-authored text, so the comment is legal and
  // the module's own half must still be clean.
  const outcome = runDetector("unused-param", "python", [
    '"""Renders."""',
    "def render(node, you, we):",
    "    return node",
  ], 1);
  assert.equal(outcome.state, "flagged", `the detector did not fire: ${JSON.stringify(outcome)}`);
  const finding = outcome.findings[0];
  const text = criticizeComment(finding);
  assert.ok(BANNED.test(text), `sanity: the parameter names reached the comment: ${JSON.stringify(text)}`);
  const half = moduleHalf(text, finding.detail);
  const hit = half.match(BANNED);
  assert.equal(hit, null, `the module's own half carries ${hit && JSON.stringify(hit[0])}: ${JSON.stringify(half)}`);
});

test("real detail: the adjacent-params detector no longer spends the reserved vocabulary", () => {
  // Amendment 3 clause 3, taken. The detail used to end "...swapped at a call
  // site", which made an UNMEASURED comment read as a measured one. Run the real
  // detector, in the language the phrase was written for, and check the words
  // are gone from the product rather than from a fixture.
  const outcome = runDetector("adjacent-params", "rust", [
    "/// Splices two spans.",
    "pub fn splice(first: Offset, second: Offset) -> Span {",
    "    join(first, second)",
    "}",
  ], 1);
  assert.equal(outcome.state, "flagged", `the detector did not fire: ${JSON.stringify(outcome)}`);
  assert.ok(
    !RESERVED_CALL_SITE.test(criticizeComment(outcome.findings[0])),
    `an unmeasured comment used the reserved vocabulary: ${JSON.stringify(criticizeComment(outcome.findings[0]))}`,
  );
});

test("real detail: a wide C# param-count finding puts no citation in the module's half", () => {
  const outcome = runDetector("param-count", "csharp", [
    "/// <summary>Builds.</summary>",
    "public static Out Build(A a, B b, C c, D d, E e, F f, G g, H h)",
    "{",
    "    return null;",
    "}",
  ], 1);
  assert.equal(outcome.state, "flagged", `the detector did not fire: ${JSON.stringify(outcome)}`);
  const finding = outcome.findings[0];
  assert.ok(!YEAR.test(moduleHalf(criticizeComment(finding), finding.detail)));
});

// ===========================================================================
// 4. THE BLAST CLAUSE
// ===========================================================================

test("amendment 3 clause 7: a radius that is not a non-negative integer is UNMEASURED", () => {
  // FLIPPED. This review argued the fold makes a corrupt measurement and an
  // absent one share a spelling. The triage agreed and ruled it the lesser
  // evil: `2.5 call sites` in a person's source is worse than silence. The row
  // now pins the ruling, and the "no clause at all" half of it.
  const silent = criticizeComment(findingFor("clock"));
  // Exactly the shapes clause 7 names, plus the negative non-integer. NOT 1e21:
  // that IS a non-negative integer, clause 7 does not reach it, and a row
  // asserting otherwise would pin a rule nobody made.
  for (const bad of [2.5, NaN, Infinity, -1, -0.5]) {
    const text = criticizeComment(findingFor("clock"), { blastRadius: bad });
    assert.equal(text, silent, `blastRadius ${String(bad)} rendered a clause: ${text}`);
    assert.ok(!RESERVED_CALL_SITE.test(text), `blastRadius ${String(bad)} spoke about call sites: ${text}`);
  }
});

test("amendment 3 clause 2: a radius of 2024 is a COUNT and renders whole", () => {
  // FLIPPED. This review argued a legal count in the 1900-2099 range trips the
  // amended year ban. The triage dissolved it: the year rule polices citation
  // text the module authors, and a call-site count was never that. The row now
  // pins that the count survives rather than being capped or reworded.
  const text = criticizeComment(findingFor("clock"), { blastRadius: 2024 });
  assert.ok(text.includes("2024 call sites ride on this signature."), `the count was mangled: ${text}`);
  assert.ok(text.endsWith("Pass it in."), `the order is still last: ${text}`);
});

test("the measured zero and the unmeasured state differ by exactly one clause", () => {
  const zero = criticizeComment(findingFor("clock"), { blastRadius: 0 });
  const none = criticizeComment(findingFor("clock"));
  assert.notEqual(zero, none, "the v61 two-state rule: a measured zero and an unmeasured one differ");
  assert.ok(zero.includes("No call sites ride on this signature."));
  assert.equal(none, zero.replace("No call sites ride on this signature. ", ""));
});

// ===========================================================================
// 5. THE WRAP
// ===========================================================================

test("wrap: a line that lands EXACTLY on column 80 is kept, not broken at 79", () => {
  // The off-by-one. Body built to exactly 77 columns, which with "// " in front
  // is exactly VOICE_COLUMN.
  const body = `C80 clock: ${[...Array(10).fill("aaaaa"), "aaaaaa"].join(" ")}`;
  assert.equal(widthOf(body), 77, `fixture calibration, got ${widthOf(body)}`);
  const lines = wrapComment(`${body} zz`, "", "//");
  assert.equal(widthOf(lines[0]), 80, `the fill stopped short of the column: ${JSON.stringify(lines[0])}`);
  assert.equal(lines[1], "// zz");
});

test("wrap: the fill is MAXIMAL - no line could have taken the next line's first word", () => {
  // NEITHER OTHER FILE CHECKS THIS. A wrapper that broke one column early would
  // pass every `<= 80` row in both of them and would still waste a column on
  // every comment the product writes into a person's file.
  for (const dimension of DIMENSIONS) {
    const text = criticizeComment(findingFor(dimension), { blastRadius: 231 });
    for (const indent of ["", "    ", "\t\t"]) {
      const lines = wrapComment(text, indent, "//");
      for (let i = 0; i < lines.length - 1; i++) {
        const next = lines[i + 1].slice(indent.length + 3).split(" ")[0];
        assert.ok(
          widthOf(lines[i]) + 1 + widthOf(next) > VOICE_COLUMN,
          `${dimension} at ${JSON.stringify(indent)}: line ${i} broke early, "${next}" would have fitted`,
        );
      }
    }
  }
});

test("wrap: tabs are charged at TIGHTEN_TAB_WIDTH on BOTH sides of the budget", () => {
  // Go and Rust indent with tabs. A wrap that measured a tab as one column would
  // emit lines the editor renders past 80. Checked against a space indent of the
  // same DISPLAY width: the two must break at the same words, which a
  // one-sided fix would not produce.
  const text = criticizeComment(findingFor("prng"), { blastRadius: 12 });
  const tabbed = wrapComment(text, "\t\t", "//");
  const spaced = wrapComment(text, " ".repeat(2 * TIGHTEN_TAB_WIDTH), "//");
  assert.deepEqual(
    tabbed.map((l) => l.replace(/^\t\t/, "")),
    spaced.map((l) => l.replace(/^ +/, "")),
    "a tab indent and the equivalent space indent must break at the same words",
  );
  for (const line of tabbed) {
    assert.ok(widthOf(line) <= VOICE_COLUMN, `a tab-indented line overran: ${JSON.stringify(line)}`);
  }
});

test("amendment 3 clause 8: every overrunning line carries ONE token wider than its budget", () => {
  // FLIPPED. This review showed two long tokens produce two overrunning lines,
  // against the contract's "that line may overrun and the rest may not". The
  // contract was wrong and clause 8 repealed the cap. What survives is the
  // property that actually matters: a line only overruns because a single
  // unbreakable token forced it, never because the fill gave up.
  const a = `alpha${"x".repeat(100)}`;
  const b = `beta${"y".repeat(100)}`;
  const rustPath = "crate::core::tighten::resolve_tighten_region_for_a_very_long_symbol_name_indeed";
  for (const [text, indent] of [
    [`${a} middle ${b} tail`, "    "],
    [`C80 nesting: the body calls ${rustPath} four times. Split it.`, "\t"],
  ]) {
    const lines = wrapComment(text, indent, "//");
    const budget = VOICE_COLUMN - widthOf(indent) - 3;
    for (const line of lines) {
      const tokens = line.slice(indent.length + 3).split(" ");
      assert.ok(tokens.length >= 1 && tokens[0] !== "", `a line came back with no token: ${JSON.stringify(line)}`);
      if (widthOf(line) > VOICE_COLUMN) {
        assert.equal(tokens.length, 1, `a line overran while carrying ${tokens.length} tokens: ${JSON.stringify(line)}`);
        assert.ok(widthOf(tokens[0]) > budget, `a line overran on a token that fitted: ${JSON.stringify(line)}`);
      }
    }
  }
  // And the cap really is gone: two long tokens, two overrunning lines.
  assert.equal(
    wrapComment(`${a} middle ${b} tail`, "    ", "//").filter((l) => widthOf(l) > VOICE_COLUMN).length,
    2,
    "clause 8: there is no limit on how many lines a run of long tokens may overrun",
  );
});

test("wrap: backtick gluing is INHERITED and DEFERRED - S62-3, pinned as behaviour not as a defect", () => {
  // `tightenTokens` is the Tighten command's tokeniser and treats a matched
  // backtick pair as ONE token, so `Vec<T, A>` survives a re-wrap. `wrapComment`
  // reuses it wholesale, so a text whose longest WORD is ten columns can still
  // produce a line far past 80. No detector emits a backtick today, so clause 9
  // deferred it. This row pins the CURRENT behaviour so the deferral is visible
  // and so a later change to the tokeniser cannot land silently.
  const short = "C80 cqs: the doc says `it returns the count` and the body disagrees. Split it.";
  assert.equal(
    wrapComment(short, "    ", "//").filter((l) => widthOf(l) > VOICE_COLUMN).length,
    0,
    "a short backticked span is harmless",
  );
  const long = "C80 cqs: the doc says `it returns the count and leaves the counter completely alone for the next reader in the chain` and the body disagrees. Split it.";
  const lines = wrapComment(long, "    ", "//");
  const longestWord = Math.max(...long.replace(/`/g, "").split(" ").map((w) => w.length));
  assert.ok(longestWord <= 12, `fixture: every bare word is short, longest is ${longestWord}`);
  assert.equal(
    lines.filter((l) => widthOf(l) > VOICE_COLUMN).length,
    1,
    `S62-3: the glued span is expected to overrun exactly one line: ${JSON.stringify(lines)}`,
  );
});

test("wrap: all fifteen, seven indents, both tokens, measured radius - width, prefix and words", () => {
  for (const dimension of DIMENSIONS) {
    const text = criticizeComment(findingFor(dimension), { blastRadius: 231 });
    for (const indent of ["", "  ", "    ", "        ", "\t", "\t\t", "\t\t\t"]) {
      for (const token of ["//", "#"]) {
        const lines = wrapComment(text, indent, token);
        assert.ok(lines.length > 0, `${dimension}: no lines`);
        const back = lines.map((l) => l.slice(indent.length + token.length + 1)).join(" ");
        assert.equal(back, text, `${dimension} at ${JSON.stringify(indent)}: the wrap changed the words`);
        for (const line of lines) {
          assert.ok(line.startsWith(`${indent}${token} `), `${dimension}: missing indent or token: ${line}`);
          assert.ok(
            widthOf(line) <= VOICE_COLUMN,
            `${dimension} at ${JSON.stringify(indent)} / ${token}: ${widthOf(line)} cols: ${line}`,
          );
        }
      }
    }
  }
});

// ===========================================================================
// 6. PURITY AND THE SHARED TABLE
// ===========================================================================

test("amendment 3 clause 4: VOICE is frozen, so the fixed table is fixed by construction", () => {
  // Taken. `Readonly<Record<...>>` is a compile-time claim and nothing more, and
  // the other file's "frozen in practice" row only READS the table twice. This
  // table is the "a table, not a model" invariant sitting on the extension's one
  // document write path, so it is enforced rather than agreed to.
  assert.ok(Object.isFrozen(VOICE), "VOICE must be frozen at runtime, not just in the type");
});

test("a write to VOICE cannot change what a later comment says", () => {
  // The consequence of the freeze, demonstrated rather than asserted. A write
  // either throws or is a silent no-op depending on the caller's strictness;
  // either way the next comment must be unchanged.
  const before = criticizeComment(findingFor("clock"));
  try {
    VOICE.clock = "vandalised. Ship it.";
  } catch {
    // A strict-mode caller gets a TypeError, which is the stronger outcome.
  }
  assert.equal(VOICE.clock, "hidden wall-clock read. Untestable. Pass it in.");
  assert.equal(criticizeComment(findingFor("clock")), before, "the fixed table was rewritten from outside");
});

test("neither the finding nor the opts object is mutated", () => {
  const finding = { dimension: "clock", line: 3, evidence: "now()", detail: "reads the wall clock" };
  const snapshot = JSON.stringify(finding);
  const opts = { blastRadius: 4 };
  const optsSnapshot = JSON.stringify(opts);
  criticizeComment(finding, opts);
  assert.equal(JSON.stringify(finding), snapshot);
  assert.equal(JSON.stringify(opts), optsSnapshot);
});

test("a hostile dimension key cannot pull a function off Object.prototype into a comment", () => {
  // NEITHER OTHER FILE COVERS THIS. The table lookup is `VOICE[finding.dimension]`
  // and a finding is data crossing a seam; `VOICE["constructor"]` is a function,
  // not a phrase, and stringifying one into a person's source file would be the
  // worst output this module could produce.
  for (const key of ["constructor", "toString", "hasOwnProperty", "__proto__", "valueOf", "propertyIsEnumerable"]) {
    assert.equal(
      criticizeComment({ dimension: key, line: 1, evidence: "x", detail: "y" }),
      "",
      `${key} produced a comment`,
    );
  }
});

test("a malformed finding produces no comment, and no comment produces no lines", () => {
  for (const bad of [undefined, null, {}, [], "clock", 7, { dimension: "not-a-dimension", detail: "x" }]) {
    assert.equal(criticizeComment(bad), "", `${JSON.stringify(bad)} produced a comment`);
  }
  assert.deepEqual(wrapComment(criticizeComment({}), "    ", "//"), [], "an empty text must never become a bare //");
});
