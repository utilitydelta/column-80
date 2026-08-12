/**
 * The two flags of `Column 80: Tighten Doc Comment`, both raised, neither filled.
 *
 * NOTHING HERE WRITES PROSE. Every value either function returns is a span of
 * the input, verbatim, with offsets that index the input. That is not style: it
 * is what makes the no-new-claims rule enforceable rather than aspirational. A
 * checker that cannot compose a word cannot invent a claim, so a flag is a
 * QUESTION to the developer and never a sentence added to their comment.
 *
 * Both flags exist because of a measured failure in `docs/dumb-models-work.md`:
 *
 *  - Round 5 left the old and the new fourth paragraph in the buffer at once and
 *    a 30B model fell apart on the result. That is the restatement flag.
 *  - Round 4's spec said "subtract each entry's known saving" and never said
 *    what a saving is. The model took the nearest reading, over-subtracted 4
 *    bytes per drop, and drifted the running total by roughly 150KB at 38,000
 *    drops. No test in the repo caught it. That is the undefined-term flag.
 *
 * Pure: no vscode, no clock, no I/O. Never throws. Empty prose, one word or a
 * 100KB paste all return a report.
 *
 * Both halves are measured against 17,774 real doc-comment blocks in five
 * languages (this repo's `src/**`, celeriant, Go's `net`, CPython),
 * not against the fixtures alone. The undefined-term flag ships under an
 * explicit gate from `session-v52/triage-p4.md`: under 1% of real blocks may
 * fire, because a flag that fires on ordinary English is a flag a developer
 * learns to ignore. It measures 0.7%. `objectHead` carries the rule and the
 * three rates behind it; do not loosen it without re-running that corpus.
 */

// The fold is phase 2's, imported and not re-implemented. `resolved` is filled
// from the phase 2 ledger, so a second fold here would decide membership by a
// different rule than the one that built the set it is testing against.
import { foldName as fold } from "./spokenName";

// --------------------------------------------------------------- restatement

/**
 * The restatement stop list, COPIED from `session-v52/spikes/detector.cjs`, not
 * re-derived. The scout validated that instrument against three known cases
 * before believing its corpus numbers, and a stop list rewritten here would
 * throw that validation away while looking identical in review.
 */
const STOP: ReadonlySet<string> = new Set(
  (
    "the a an and or but if then that this these those is are was were be been it its of to in on for with as at by from not no so we i you they he she do does did have has had will would can could should may might must than there their them our your my me us what which who when where how why all any each some more most other into over under again further once here also very just only own same too dont its lets let"
  ).split(" "),
);

/** Containment at or above this and the pair is a restatement. The spike's. */
export const RESTATEMENT_THRESHOLD = 0.7;

/** A unit with fewer content tokens than this is not compared. The spike's. */
export const RESTATEMENT_MIN_TOKENS = 5;

/**
 * A cap on the pairs REPORTED, never on the pairs compared, so `units`, `worst`
 * and `totalPairs` stay exact. Pair count is quadratic in units and a
 * self-similar paste fires on nearly every pair: a 100KB duplicate would
 * otherwise build a million records holding a copy of the text each, and "a
 * report, not an exception" includes not being the memory failure.
 *
 * PER GRAIN, not shared. The sentence pass runs first, and a shared cap let it
 * consume the whole budget and report the duplicated paragraph nowhere. The
 * paragraph grain is the one the contract says exists because round 5's failure
 * shows only there, so it cannot be the grain that gets starved.
 */
const MAX_REPORTED_PAIRS_PER_GRAIN = 100;

/**
 * Negation words. Two units that differ here are opposites, not restatements.
 *
 * The stop list drops `not`, `no`, `but` and `and`, so "the timeout has
 * elapsed" and "the timeout has NOT elapsed" are the same token set and score
 * 1.00. Measured on the corpus, 42 of 582 sentence pairs are parallel rules of
 * that shape, and the command would offer to DELETE one of the two.
 *
 * This is a guard on top of the detector and NOT an edit to the stop list. The
 * stop list is the scout's validated instrument: change it and every containment
 * figure it produced becomes a number about a different tool.
 */
const NEGATIONS: readonly string[] = ["not", "no", "never", "without", "unless", "except", "nor"];

interface Span {
  text: string;
  start: number;
  end: number;
}

export interface RestatementPair {
  /** Containment, 0..1, rounded to 2 places. */
  containment: number;
  grain: "sentence" | "paragraph";
  /** The two spans, verbatim, and where each sits in the prose. */
  a: Span;
  b: Span;
}

export interface RestatementReport {
  /** Units compared, after the min-token filter. */
  units: number;
  /** The worst pair's containment, whether or not it fired. */
  worst: number;
  pairs: readonly RestatementPair[];
  /** Pairs at or above threshold across both grains, before the report cap. */
  totalPairs: number;
  /** True when `pairs` is shorter than `totalPairs`. */
  truncated: boolean;
  /**
   * The share of the prose's letters and digits the tokeniser could not see,
   * 0..1, rounded to 2 places. The tokeniser is ASCII (`[a-z0-9_]+`), so a
   * Japanese doc comment scores 1 and a French one with accents scores a little
   * above 0.
   *
   * WHAT PHASE 5 MUST DO WITH IT. This field exists so the diff can tell the
   * developer "not measured" instead of "clean", and it is the only thing that
   * can: a report over invisible prose comes back `units: 0, worst: 0,
   * pairs: []`, which is byte-identical to a document that was read in full and
   * found clean. So:
   *
   *  - `unmeasured` at 0: report normally. Nothing was skipped.
   *  - `unmeasured` high with NO pairs: say the restatement check did not run on
   *    this comment. Do NOT render it as a pass, and do not let a clean-looking
   *    report be the reason a developer trusts a comment nobody checked.
   *  - `unmeasured` high WITH pairs: what fired is real, but it is a floor. The
   *    unseen share was never compared.
   *
   * There is no threshold here on purpose: the split between "a stray accent"
   * and "a comment in another language" is a presentation decision, and putting
   * a number on it in this module would be a guess dressed as a measurement.
   *
   * Real Unicode tokenisation is DEFERRED (`session-v52/scraps.md`, S52-7): it
   * needs a segmentation strategy for languages with no spaces and it changes
   * every containment figure the scout validated. This is the honesty half, and
   * it is honest only if something reads it.
   */
  unmeasured: number;
}

/**
 * Sentence spans, walked with `exec` instead of `String.split` so each piece
 * carries its offset. Offsets are one of the two things this module adds to the
 * spike, because a flag the developer cannot be shown the location of is not
 * actionable.
 *
 * The other is the splitter itself. The spike also split on a BARE newline, and
 * that is a defect against this product's input: phase 1 hard-wraps the doc
 * comment at 80 columns minus the indent, so a newline is a WRAP and never a
 * boundary. Measured on 17,774 real doc-comment blocks, 47 of 582 sentence
 * pairs were two lines of one sentence or a split URL. A reported span is what
 * phase 5 offers to DELETE, and the goal justifies that offer with "a deletion
 * cannot introduce a claim". Deleting half a sentence introduces one. Amendment
 * 9 made this same fix for the term pass and left the restatement pass behind.
 *
 * The paragraph grain is untouched by this: it always split on a blank line.
 */
function sentenceSpans(text: string): Span[] {
  return splitSpans(text, /(?<=[.!?])\s+|\n\s*\n/g);
}

/** The spike's paragraph split, `/\n\s*\n/`, with offsets. */
function paragraphSpans(text: string): Span[] {
  return splitSpans(text, /\n\s*\n/g);
}

function splitSpans(text: string, separator: RegExp): Span[] {
  const out: Span[] = [];
  const re = new RegExp(separator.source, "g");
  let from = 0;
  for (;;) {
    const hit = re.exec(text);
    if (hit === null) {
      break;
    }
    push(out, text, from, hit.index);
    from = hit.index + hit[0].length;
    // Every alternative in both separators consumes at least one character, so
    // this cannot spin; the guard is here for the reader, not the engine.
    re.lastIndex = from;
  }
  push(out, text, from, text.length);
  return out;
}

/** Trim the way the spike's `.map(trim).filter(Boolean)` does, keeping offsets. */
function push(out: Span[], text: string, start: number, end: number): void {
  let a = start;
  let b = end;
  while (a < b && /\s/.test(text[a] as string)) {
    a++;
  }
  while (b > a && /\s/.test(text[b - 1] as string)) {
    b--;
  }
  if (b > a) {
    out.push({ text: text.slice(a, b), start: a, end: b });
  }
}

/** The spike's tokenizer: lowercase `[a-z0-9_]+`, length 3 or more, minus STOP. */
function contentTokens(s: string): string[] {
  const out: string[] = [];
  for (const raw of s.toLowerCase().match(/[a-z0-9_]+/g) ?? []) {
    if (raw.length < 3 || STOP.has(raw)) {
      continue;
    }
    out.push(raw);
  }
  return out;
}

/** The spike's containment: shared tokens over the SMALLER set. */
function containment(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) {
    return 0;
  }
  let hits = 0;
  for (const t of a) {
    if (b.has(t)) {
      hits++;
    }
  }
  return hits / Math.min(a.size, b.size);
}

/** The negation multiset of a unit, as a sorted signature. `n't` counts as
 *  `not`, because "doesn't" and "does not" are the same claim. */
function negationKey(text: string): string {
  const lower = text.toLowerCase();
  const counts: number[] = [];
  for (const word of NEGATIONS) {
    counts.push((lower.match(new RegExp(`\\b${word}\\b`, "g")) ?? []).length);
  }
  const contracted = (lower.match(/n['’]t\b/g) ?? []).length;
  counts[0] = (counts[0] as number) + contracted;
  return counts.join(",");
}

interface Unit {
  span: Span;
  set: Set<string>;
  negation: string;
}

/**
 * Restated spans in `prose`, at sentence and at paragraph grain.
 *
 * BOTH grains run, and the paragraph grain is not a nicety: round 5's actual
 * failure was a paragraph restated in new words, which leaves every individual
 * sentence pair under threshold. Measured on the fixtures, the clean spec peaks
 * at 0.33, round 5's restated paragraph at 0.79, a verbatim paste at 1.00.
 *
 * `units` counts SENTENCE units only, as the spike reported it. The paragraph
 * pass contributes to `worst` and to `pairs` but not to the unit count, so the
 * number stays comparable with the corpus runs already recorded.
 */
export function findRestatements(prose: string): RestatementReport {
  const empty: RestatementReport = {
    units: 0, worst: 0, pairs: [], totalPairs: 0, truncated: false, unmeasured: 0,
  };
  if (typeof prose !== "string" || prose === "") {
    return empty;
  }
  const pairs: RestatementPair[] = [];
  const unit = (span: Span): Unit => ({
    span,
    set: new Set(contentTokens(span.text)),
    negation: negationKey(span.text),
  });

  const sentences = sentenceSpans(prose).map(unit)
    .filter((u) => u.set.size >= RESTATEMENT_MIN_TOKENS);
  const paragraphs = paragraphSpans(prose).map(unit)
    .filter((u) => u.set.size >= RESTATEMENT_MIN_TOKENS);

  // The negation guard runs at SENTENCE grain only, and that scoping is
  // measured, not convenient. A sentence is one claim, so a negation flips it.
  // A paragraph is many claims, and one `not` inside twenty content tokens is
  // not evidence that two paragraphs are opposites: applied at paragraph grain
  // the guard kills round 5's own 0.79 pair, which is the single validated
  // positive this whole detector exists for. The defect's own evidence is 42 of
  // 582 SENTENCE pairs, so the guard runs where the defect was measured.
  const sentenceOut = comparePass(sentences, "sentence", pairs, 0, true);
  const paragraphOut = comparePass(paragraphs, "paragraph", pairs, sentenceOut.worst, false);

  const totalPairs = sentenceOut.fired + paragraphOut.fired;
  return {
    units: sentences.length,
    worst: round2(paragraphOut.worst),
    pairs,
    totalPairs,
    truncated: pairs.length < totalPairs,
    unmeasured: unmeasuredShare(prose),
  };
}

function comparePass(
  units: readonly Unit[],
  grain: "sentence" | "paragraph",
  pairs: RestatementPair[],
  worstIn: number,
  guardNegation: boolean,
): { worst: number; fired: number } {
  let worst = worstIn;
  let fired = 0;
  let reported = 0;
  for (let i = 0; i < units.length; i++) {
    const ui = units[i] as Unit;
    for (let j = i + 1; j < units.length; j++) {
      const uj = units[j] as Unit;
      const c = containment(ui.set, uj.set);
      // `worst` is the lexical measure and reports what the detector saw, so a
      // guarded pair still moves it. Only firing is suppressed.
      if (c > worst) {
        worst = c;
      }
      if (c < RESTATEMENT_THRESHOLD) {
        continue;
      }
      if (guardNegation && ui.negation !== uj.negation) {
        continue;
      }
      fired++;
      if (reported < MAX_REPORTED_PAIRS_PER_GRAIN) {
        reported++;
        // Fresh span objects per pair. Phase 5 offers a DELETION of a reported
        // span and may well adjust one before applying it; a shared object
        // would silently adjust another pair's span too.
        pairs.push({
          containment: round2(c),
          grain,
          a: { ...ui.span },
          b: { ...uj.span },
        });
      }
    }
  }
  return { worst, fired };
}

/**
 * The share of the prose's letters and digits that the ASCII tokeniser cannot
 * see. Full Unicode tokenisation is deferred (scraps S52-7) because it changes
 * every containment figure the scout validated; this is the honesty half.
 */
function unmeasuredShare(prose: string): number {
  let total = 0;
  let unseen = 0;
  for (const ch of prose) {
    if (!/[\p{L}\p{N}]/u.test(ch)) {
      continue;
    }
    total++;
    if (!/[A-Za-z0-9]/.test(ch)) {
      unseen++;
    }
  }
  return total === 0 ? 0 : round2(unseen / total);
}

function round2(n: number): number {
  return Number(n.toFixed(2));
}

// ----------------------------------------------------------- undefined term

export interface UndefinedTermInput {
  prose: string;
  /** Every name the anchor tiers resolved: the phase 2 ledger's rendered and visited sets
   *  plus every identifier phase 3 ratified. A term that is one of these is defined by the
   *  code and needs no flag. */
  resolved: readonly string[];
  /** The language's stop set, so `result` in Rust is not a mystery noun. */
  stopNames?: ReadonlySet<string>;
}

export interface UndefinedTerm {
  /** The word as the prose spells it, so `prose.slice(start, end) === term`. */
  term: string;
  /** Where it is used as an instruction, verbatim. The offsets bracket the TERM
   *  (contract amendment 1); this sentence is the context a reader needs and is
   *  not what `start`/`end` measure. */
  sentence: string;
  start: number;
  end: number;
  /** How many times the comment uses it. */
  uses: number;
}

/**
 * The imperative verbs that make a sentence an instruction. The contract's list,
 * closed on purpose: a verb list that grows to cover ordinary English turns
 * every sentence into an instruction and the flag into noise.
 */
const INSTRUCTION_VERBS: ReadonlySet<string> = new Set([
  "subtract", "add", "drop", "return", "skip", "call", "compute",
  "use", "set", "count", "track", "check", "emit",
]);

/** A modal also marks an instruction: "must not count toward the return value". */
const MODALS: ReadonlySet<string> = new Set(["must", "should", "never", "always"]);

/**
 * A determiner or a possessive is the evidence that the head word is a NOUN.
 * There is no part-of-speech tagger in a pure core module and there will not be
 * one, so nounhood is proved structurally: "each entry's known saving" is a noun
 * phrase, "sets already Unknown" is not, and the difference is measurable
 * without a dictionary.
 */
const DETERMINERS: ReadonlySet<string> = new Set([
  "a", "an", "the", "each", "every", "any", "this", "that", "these", "those",
  "its", "their", "no", "some", "another", "both", "either", "neither",
]);

/**
 * What ENDS the object noun phrase. A preposition, a conjunction or a
 * relativiser closes the phrase the instruction verb takes, which is what keeps
 * "subtract each entry's known saving from a running total" reporting `saving`
 * and not `total`.
 */
const PHRASE_END: ReadonlySet<string> = new Set([
  "from", "to", "into", "onto", "in", "on", "for", "with", "by", "as", "at",
  "of", "than", "until", "unless", "instead", "over", "under", "per", "since",
  "because", "while", "when", "where", "that", "which", "who", "and", "or",
  "but", "so", "then", "if", "before", "after", "against", "toward", "towards",
  "without", "via", "up", "out", "off", "down",
]);

/**
 * The flag's own stop list of ordinary English. The function words are the
 * restatement STOP list reused rather than a second list written here, plus the
 * instruction verbs and modals (a verb the sentence is built on is not the noun
 * the sentence leaves undefined) and a short set of contentless prose heads.
 *
 * NOT tuned to the fixtures: no fixture flag turns on any of the words below
 * that are not already in STOP, and `impl-v52-p4-flags` asserts that by running
 * both fixtures with the extra words removed.
 */
const ENGLISH: ReadonlySet<string> = new Set([
  ...STOP, ...INSTRUCTION_VERBS, ...MODALS, ...DETERMINERS, ...PHRASE_END,
  "thing", "things", "way", "ways", "case", "cases", "time", "times", "order",
  "reason", "reasons", "point", "points", "part", "parts", "rest", "end",
  "start", "line", "lines", "word", "words", "note", "notes", "kind", "kinds",
  "sort", "step", "steps", "stuff", "bit", "bits", "one", "ones", "anything",
  "everything", "nothing", "something", "already", "anyway", "rather", "yet",
]);

/**
 * Sentences for the undefined-term pass, and they are NOT the restatement
 * detector's sentences. That splitter breaks on a bare newline, which is right
 * for lexical containment and wrong here: phase 1 hard-wraps prose at 80
 * columns, so an instruction chopped by line width would lose its verb, its
 * object, or both, and whether a flag fires would depend on the indent of the
 * function it sits above. Sentence ends are `.!?` followed by whitespace, plus a
 * blank line.
 */
function proseSentences(prose: string): Span[] {
  return splitSpans(prose, /(?<=[.!?])\s+|\n\s*\n/g);
}

interface Token {
  word: string;
  lower: string;
  /** Offset inside the sentence, not the prose. */
  index: number;
  /** The last non-whitespace character before this token, "" at the start.
   *  Precomputed in the single tokenising pass: `clauseInitial` used to re-slice
   *  and re-trim the whole sentence prefix per instruction verb, which made the
   *  term pass quadratic in ONE sentence's length (1,121ms for 216KB as one
   *  sentence against 12ms for the same bytes punctuated). */
  prevChar: string;
}

function tokens(sentence: string): Token[] {
  const out: Token[] = [];
  let cursor = 0;
  let prevChar = "";
  for (const m of sentence.matchAll(/[A-Za-z0-9_]+/g)) {
    // Walk the gap since the last token once, never the whole prefix.
    for (let k = m.index - 1; k >= cursor; k--) {
      const ch = sentence[k] as string;
      if (!/\s/.test(ch)) {
        prevChar = ch;
        break;
      }
    }
    out.push({ word: m[0], lower: m[0].toLowerCase(), index: m.index, prevChar });
    cursor = m.index + m[0].length;
    prevChar = m[0][m[0].length - 1] as string;
  }
  return out;
}

/**
 * Blank every backticked span. A backticked name is phase 3's business, and a
 * name the developer already marked as code is by definition not a bare word.
 *
 * The filler is `X`, not a space, and the length is preserved so every offset
 * still indexes the real prose. Spaces would DELETE the span from the token
 * stream, and a noun phrase whose head is backticked would then report the
 * adjective in front of it: "each entry's known `saving`" flagged `known`.
 */
function maskBackticks(prose: string): string {
  return prose.replace(/`[^`]*`/g, (m) => "`" + "X".repeat(Math.max(0, m.length - 2)) + "`");
}

/**
 * A bare lowercase word: no digits, no underscore, no hump, and not touching a
 * character that makes it part of a code token. `client_set`, `wire_size()` and
 * `ClientSet::Unknown` all contain lowercase letter runs and none of them is a
 * bare word.
 */
function isBareWord(sentence: string, t: Token): boolean {
  if (!/^[a-z]{2,}$/.test(t.word)) {
    return false;
  }
  const at = t.index + t.word.length;
  const before = t.index > 0 ? (sentence[t.index - 1] as string) : "";
  const before2 = t.index > 1 ? (sentence[t.index - 2] as string) : "";
  const after = sentence[at] ?? "";
  const after2 = sentence[at + 1] ?? "";
  // A dot or a colon is only code punctuation when something is on the other
  // side of it. A sentence-final "total." and a defining "saving:" are prose,
  // and rejecting them cost the head of every phrase that ends a sentence.
  if (before === "_" || before === ":" || (before === "." && /[A-Za-z0-9_)]/.test(before2))) {
    return false;
  }
  if (after === "_" || after === "(" || (after === "." && /[A-Za-z_]/.test(after2))) {
    return false;
  }
  return !(after === ":" && after2 === ":");
}

/**
 * The head of the object noun phrase of every instruction verb in the sentence.
 *
 * This is the narrow half of the rule and it is where the flag earns the right
 * to be believed. A term qualifies only when the sentence gives three pieces of
 * evidence at once: an instruction verb in clause-initial position (or after a
 * modal), an object phrase that carries a determiner or a possessive, and a
 * bare lowercase head. Measured on the two fixtures, round 2 yields exactly one
 * candidate and round 4 yields two; a looser nounhood test yielded eleven on
 * round 2, which is the flag a developer learns to ignore.
 */
function instructionHeads(sentence: string): { word: string; index: number }[] {
  const ts = tokens(sentence);
  const heads: { word: string; index: number }[] = [];
  for (let i = 0; i < ts.length; i++) {
    const t = ts[i] as Token;
    let verbAt = -1;
    if (INSTRUCTION_VERBS.has(t.lower) && clauseInitial(ts, i)) {
      verbAt = i;
    } else if (MODALS.has(t.lower)) {
      // "must not count", "should always emit": step over the negation and any
      // stacked modal to reach the verb the modal governs.
      let k = i + 1;
      while (k < ts.length && ((ts[k] as Token).lower === "not" || MODALS.has((ts[k] as Token).lower))) {
        k++;
      }
      const v = ts[k];
      // A modal followed by a determiner or a preposition governs no verb here
      // ("and never a false absent"), so there is no object to read.
      if (v !== undefined && !DETERMINERS.has(v.lower) && !PHRASE_END.has(v.lower)) {
        verbAt = k;
      }
    }
    if (verbAt < 0) {
      continue;
    }
    const head = objectHead(sentence, ts, verbAt);
    if (head !== undefined) {
      heads.push(head);
    }
  }
  return heads;
}

/** An imperative sits at the head of a clause: sentence start, after `,;:(`, or
 *  after a coordinator. Anywhere else the same word is a noun ("the return
 *  value", "the set's size") or a finite verb ("stalls the executor"). O(1) on
 *  the precomputed `prevChar`. */
function clauseInitial(ts: readonly Token[], i: number): boolean {
  const t = ts[i] as Token;
  if (t.prevChar === "") {
    return true;
  }
  if (",;:(".includes(t.prevChar)) {
    return true;
  }
  const prev = ts[i - 1];
  return prev !== undefined && ["and", "then", "so", "or", "but"].includes(prev.lower);
}

/**
 * The object phrase runs from just after the verb to the first phrase end or
 * punctuation, and yields its last bare word, if the phrase proves the head is
 * a noun the developer OWNS somewhere.
 *
 * A determiner alone is not that evidence, and this is the narrowing that
 * decided whether the flag ships. Measured on 17,774 real doc-comment blocks:
 *
 *  - determiner anywhere in the object, the rule as first built: 10.5% of
 *    blocks fired, top terms `object`, `list`, `name`, `string`, `path`. That
 *    is ordinary technical English, not undefined terms. `Emit a record.` has
 *    that shape and round 4's measured failure does not.
 *  - possessive OR an `of the X` construction, the triage's two legs: 1.3%.
 *  - POSSESSIVE ALONE, what ships: 0.7% (121 blocks, 137 flags).
 *
 * The `of the X` leg is dropped on that measurement. It carries 113 of the 234
 * flags on its own, almost all of them Python, because "Return the sum of the
 * two operands" and "Return the Future's result" are the CPython docstring
 * convention and neither leaves a term undefined. Round 4 keeps firing without
 * it: `each entry's known saving` is a possessive. The cost is real and named,
 * "subtract the known saving of the entry" is now missed, and the gate is worth
 * more than that case: a flag at 1.3% is a flag a developer learns to ignore.
 *
 * A `-ly` head is refused outright. "use the local name directly" reported
 * `directly`, and no developer can answer "what is a directly?".
 */
function objectHead(
  sentence: string,
  ts: readonly Token[],
  verbAt: number,
): { word: string; index: number } | undefined {
  let owned = false;
  let last: Token | undefined;
  for (let k = verbAt + 1; k < ts.length; k++) {
    const t = ts[k] as Token;
    const prev = ts[k - 1] as Token;
    const gap = sentence.slice(prev.index + prev.word.length, t.index);
    if (/[,;:.!?()]/.test(gap)) {
      break;
    }
    if (PHRASE_END.has(t.lower)) {
      break;
    }
    if (/['’]s?\s*$/.test(gap)) {
      owned = true;
    }
    last = t;
  }
  // The head is the LAST token of the phrase and there is no falling back to an
  // earlier one. "each entry's known `saving`" and "each entry's known
  // client_set" both have a head the developer already spelled as code, and
  // reporting the adjective in front of it ("known") would be a flag about a
  // word nobody used as a noun.
  if (!owned || last === undefined || DETERMINERS.has(last.lower)) {
    return undefined;
  }
  if (/ly$/.test(last.lower)) {
    return undefined;
  }
  return isBareWord(sentence, last) ? { word: last.word, index: last.index } : undefined;
}

/**
 * Does the prose DEFINE `term`?
 *
 * The contract's four markers are `is`, `are`, `means`, `equals`, `defined as`,
 * and a colon straight after the term. A fifth form is here because the
 * contract's own fixture uses it and nothing else: round 2 defines a saving by
 * apposition, "each dropped set's saving, `client_set.wire_size() -
 * ClientSet::Unknown.wire_size()`, since ...", and `docs/dumb-models-work.md`
 * records that adding exactly that clause is what closed the round 4 bug. Under
 * the marker list alone round 2 would fire, which the contract forbids. This
 * addition only ever SILENCES a flag, so the failure direction is the safe one.
 *
 * `window` is the instruction sentence and the one after it, not the whole
 * comment. A definition test that scans everywhere lets an unrelated later
 * mention silence a real instruction, and silencing is the direction that loses
 * the measured bug.
 */
function isDefined(window: string, term: string): boolean {
  const markers = /^\s*(?::|(?:is|are|means|equals)\b|(?:,\s*)?defined\s+as\b)/i;
  // Apposition: the term, a comma, then a code-style span. A backticked span, or
  // a token carrying `_`, `::`, `.`, `(` or an inner hump. NOT case-insensitive,
  // and that is load-bearing: under `i` the hump class `[a-z][A-Z]` matches any
  // two letters, which turned "saving, since the entry" into a definition and
  // silenced the flag the module exists to raise.
  const appositive = /^\s*,\s*(?:`|[A-Za-z_][A-Za-z0-9_]*(?:[_.(]|::|[a-z][A-Z]))/;
  // An abbreviation is not a definition. `[A-Za-z_]+` followed by `.` matches
  // the `e.` of "e.g.", so ", e.g. whatever" read as an appositive definition
  // and silenced the flag; ordinary prose puts these straight after a comma.
  const hedge = /^\s*,\s*(?:e\.g\.|i\.e\.|etc\.|cf\.|viz\.)/i;
  const occurrences = new RegExp(`\\b${escapeRe(term)}\\b`, "gi");
  for (const m of window.matchAll(occurrences)) {
    const after = window.slice(m.index + m[0].length);
    if (hedge.test(after)) {
      continue;
    }
    if (markers.test(after) || appositive.test(after)) {
      return true;
    }
  }
  return false;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** How many times the comment uses the term, backticked spans and code tokens
 *  excluded, because those uses are the developer writing a name, not a noun. */
function countUses(masked: string, term: string): number {
  let n = 0;
  const want = term.toLowerCase();
  for (const m of masked.matchAll(/[A-Za-z0-9_]+/g)) {
    if (m[0].toLowerCase() !== want) {
      continue;
    }
    // `prevChar` is only read by `clauseInitial`, which a use count does not
    // ask; the bare-word test reads the text around the offset directly.
    if (isBareWord(masked, { word: m[0], lower: m[0].toLowerCase(), index: m.index, prevChar: "" })) {
      n++;
    }
  }
  return n;
}

/**
 * Nouns the comment instructs with, that no anchor tier resolved, and that the
 * comment never defines.
 *
 * The measured case is round 4: "subtract each entry's known saving" with no
 * definition of a saving, which cost 4 bytes per drop in a running total that no
 * test in the repo checked. The product cannot supply the missing definition
 * without writing a claim, so it asks the developer instead. One record per
 * term, first-use order, reporting the first INSTRUCTION sentence that uses it.
 */
export function findUndefinedTerms(input: UndefinedTermInput): UndefinedTerm[] {
  if (input === null || typeof input !== "object" || typeof input.prose !== "string") {
    return [];
  }
  const prose = input.prose;
  if (prose === "") {
    return [];
  }
  const resolved = new Set<string>();
  for (const name of Array.isArray(input.resolved) ? input.resolved : []) {
    if (typeof name === "string" && name !== "") {
      resolved.add(fold(name));
    }
  }
  const stopNames = new Set<string>();
  // `{}` is not iterable and a `for...of` over it throws. Ship condition 4 says
  // never throws, and a caller handing the wrong shape gets the same treatment
  // `resolved` already gets: no stop set, not an exception.
  const given: unknown = input.stopNames;
  if (given !== null && typeof given === "object" && typeof (given as Iterable<unknown>)[Symbol.iterator] === "function") {
    for (const name of given as Iterable<unknown>) {
      if (typeof name === "string") {
        stopNames.add(fold(name));
      }
    }
  }

  const masked = maskBackticks(prose);
  const out: UndefinedTerm[] = [];
  const seen = new Set<string>();
  const sentences = proseSentences(masked);
  for (let s = 0; s < sentences.length; s++) {
    const sentence = sentences[s] as Span;
    // The window the definition test may read: everything up to the end of the
    // sentence AFTER this one.
    //
    // The triage asked for "the instruction sentence and the one after it", to
    // stop an unrelated LATER mention silencing an instruction. That is the half
    // this keeps. It also dropped everything BEFORE, which the contract does not
    // allow: "no sentence in the prose introduces it with is, are, means..." is
    // the whole prose, and a doc comment that defines a term in its first
    // paragraph and instructs with it in its fourth is the ordinary shape, not
    // the pathological one. Measured on 17,774 real blocks, the two windows are
    // worth ONE block (235 against 234), so this choice is made on the
    // contract's text and not on a rate.
    const next = sentences[s + 1];
    const window = prose.slice(0, next === undefined ? sentence.end : next.end);
    for (const head of instructionHeads(sentence.text)) {
      const term = head.word;
      const key = fold(term);
      if (seen.has(key) || ENGLISH.has(term.toLowerCase()) || resolved.has(key) || stopNames.has(key)) {
        continue;
      }
      // The definition may itself be backticked, so this reads the UNMASKED
      // prose, scoped to the window.
      if (isDefined(window, term)) {
        seen.add(key);
        continue;
      }
      seen.add(key);
      out.push({
        term,
        // Verbatim from the input, not from the mask: a backtick inside the
        // sentence must survive into what the developer is shown.
        sentence: prose.slice(sentence.start, sentence.end),
        // The TERM's occurrence, contract amendment 1. `head.index` is relative
        // to the sentence, which is itself a span of the (masked) prose, and the
        // mask preserves length so the offset carries straight across.
        start: sentence.start + head.index,
        end: sentence.start + head.index + term.length,
        uses: countUses(masked, term),
      });
    }
  }
  return out;
}

/**
 * The ordinary-English set above, exported UNCHANGED for one other reader.
 *
 * `src/vscode/tightenDocComment.ts` needs it to answer a different question -
 * "is this single-word span an ordinary word rather than a type name?" - and a
 * chatty model reply used to buy nine workspace-symbol queries for `the` and
 * `a` (session-v52 phase 5 adversarial, defect 8). Exported rather than copied,
 * because a second stop list in a second file is two lists that drift. Nothing
 * in this module's own behaviour changes: it is the same object.
 */
export { ENGLISH as ORDINARY_ENGLISH };
