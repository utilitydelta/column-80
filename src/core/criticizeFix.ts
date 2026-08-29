// ===========================================================================
// The one sentence a model is allowed to write into a person's source file.
//
// The comment this product plants has three beats: what the code did, what that
// costs, and what to do about it. The first two are the detector's, measured and
// specific. The third is a lookup-table constant, byte-identical on every
// function in every repository forever:
//
//     today:   Give them distinct types.
//     wanted:  Make Shard(u64) and Lod(u64) newtypes, so warm_fs_metadata(lod,
//              shard) stops compiling.
//
// Only a model writes the second one, and only if it can see the code. That is
// what session-v64 builds. THIS module is the gate in front of it.
//
// THE MODEL STILL DECIDES NOTHING. It cannot add a finding, remove one, move a
// line, or touch the two beats in front of its own sentence: it is handed one
// settled finding and asked for one imperative. `attachExplanations` holds the
// same door for the card and this holds it for the file.
//
// EVERY REFUSAL DEGRADES TO THE TABLE, NEVER TO NOTHING. A comment with no order
// in it is a complaint, and the product does not plant complaints. So each rule
// below returns the reason it refused and the caller falls back to the fixed
// phrase, which is a perfectly good sentence that has shipped since 2.5.0.
//
// THE RULES ARE THE VOICE'S OWN. Ruled by the human in v62 and unchanged here:
// no second person, no hedging, no citation, no question. They policed the text
// this product AUTHORS; a model's sentence is planted by this product, so it is
// held to the same bar. That is what keeps the v62 voice contract true of every
// comment the product can write, model or table.
//
// Pure: no vscode, no clock, no I/O, no randomness. Never imports vscode.
// ===========================================================================

// IT IMPORTS NO TABLE. The fallback belongs to whoever owns the fixed phrases,
// and a gate that reached back for them would be a cycle between the voice and
// the thing that polices it.

import { CriticizeLang } from "./criticizeLang";
import { DetectorFinding, DimensionId, FunctionUnderReview, docLines } from "./criticizeTypes";

/**
 * How long a model's order may be, in characters. CHOSEN, not measured.
 *
 * The longest phrase in the shipped table is 40 characters. 160 is four of
 * those: room to name two types and the call that would stop compiling, and not
 * room for a paragraph. At the comment's 80-column width this is two wrapped
 * lines on top of the complaint, which is the most a reader takes at a line
 * they are scrolling past.
 */
export const FIX_MAX_CHARS = 160;

/**
 * How many sentences an order may be. CHOSEN.
 *
 * One is the shape of every phrase in the table. Two is allowed because the
 * useful specific answer often has a consequence clause - "make them newtypes,
 * so the transposed call stops compiling" splits naturally in two - and three
 * is a paragraph wearing a comment's clothes.
 */
export const FIX_MAX_SENTENCES = 2;

/**
 * Words the order may not contain, whole-word and case-insensitive.
 *
 * The list is v62's, ruled by the human, and it is two bans in one. Second
 * person is banned because the comment attacks the code and never the author.
 * Hedging is banned because an imperative that hedges is not an imperative:
 * "you might consider making these newtypes" is not an order, it is an opinion
 * with an escape hatch.
 */
export const FIX_BANNED_WORDS: readonly string[] = [
  "consider",
  "might",
  "maybe",
  "perhaps",
  "probably",
  "you",
  "your",
  "we",
  "our",
  "please",
  "just",
  "simply",
  "recommend",
  "suggest",
];

/**
 * Openers that mean the sentence is not an order.
 *
 * A cheap test for the imperative mood and deliberately a narrow one: an order
 * starts with its verb. "The parameters should be newtypes" is a description of
 * a better world and leaves the reader to work out who does what; "Make them
 * newtypes" is the thing this beat exists to say.
 */
const NON_IMPERATIVE_OPENERS: readonly string[] = [
  "the", "this", "that", "these", "those", "it", "its", "there", "a", "an",
  "here", "so", "because", "since", "if", "when", "while", "although",
];

/** A four-digit year, which is how a citation reaches a source file. The
 *  curriculum line belongs in the output panel; a lecture in someone's code is
 *  the thing the human ruled out by name. */
const YEAR = /\b(1[0-9]{3}|2[0-9]{3})\b/;

/** The blast clause's reserved vocabulary. A measured call-site count is the
 *  ONLY thing allowed to spend these words: a model that writes "update the six
 *  call sites" makes an unmeasured claim in the exact spelling the product uses
 *  for a measured one. */
const CALL_SITE_TALK = /\bcall sites?\b/i;

/** The comment tokens and this product's own tag. A model that echoes the
 *  comment format has misread the ask, and the planner adds both itself. */
const FORMATTING = /(^|\s)(\/\/|\/\*|#\s|C80\b)/;

/**
 * Characters that must never reach a source file, whatever they spell.
 *
 * Three classes, and none of them is a style question:
 *
 *   - C0 and C1 CONTROLS, and DEL. A NUL, a BEL or an ESC in a comment is at
 *     best noise the developer cannot see and at worst a terminal escape in a
 *     file people `cat`. Tab, newline and carriage return are excluded here
 *     because the whitespace fold below folds them into spaces legitimately.
 *   - BIDIRECTIONAL OVERRIDES and isolates. This is Trojan Source: U+202E and
 *     its family reorder a line for the human reader while the compiler reads
 *     the original order, so the line in review is not the line that builds.
 *     A tool that proposes a diff for a human to accept is precisely the place
 *     this must not be possible.
 *   - ZERO-WIDTH characters and the byte-order mark. Invisible by definition,
 *     and their only use in a one-sentence order is to hide something from
 *     either the reader or a word-boundary rule.
 *
 * This runs on the RAW answer, before any fold or strip, because a rule that
 * normalises first can only see what survived the normalisation. The
 * whitespace fold touches the whitespace class and nothing else, which is how
 * all three of these classes reached a proposed document unchallenged.
 */
const FORBIDDEN_CHARS =
  // eslint-disable-next-line no-control-regex
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/;

/** What one forbidden character is called, for a refusal a person can act on.
 *  "an invisible character" tells nobody which one. */
function nameOfChar(ch: string): string {
  const code = ch.codePointAt(0) ?? 0;
  const hex = `U+${code.toString(16).toUpperCase().padStart(4, "0")}`;
  if (code <= 0x1f || code === 0x7f) {
    return `a control character (${hex})`;
  }
  if (code >= 0x80 && code <= 0x9f) {
    return `a C1 control character (${hex})`;
  }
  if ((code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069) || code === 0x200e || code === 0x200f) {
    return `a bidirectional override (${hex}), which reorders the line for a reader but not for the compiler`;
  }
  return `a zero-width character (${hex})`;
}

/** A word that mixes writing systems.
 *
 *  `you` spelled with a Cyrillic `o` is not the word `you` to a word-boundary
 *  rule, and it is exactly the word `you` to the developer reading the comment.
 *  Every ban in this gate is a match on text, so a token that is Latin to the
 *  eye and something else to the regex walks all of them at once. Real advice
 *  about real code does not mix scripts inside one token, so the whole class is
 *  refused rather than each ban being taught to normalise.
 *
 *  Deliberately NOT a ban on non-ASCII: an identifier may legitimately be
 *  Greek or Cyrillic throughout, and a sentence naming it should be admitted. */
const MIXED_SCRIPT_WORD = /[A-Za-z][^\W\d_]*[^\x00-\x7F]|[^\x00-\x7F][^\W\d_]*[A-Za-z]/u;

/** Sentences, each keeping its own terminator. */
function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!])\s+/)
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

/**
 * The order this comment will carry, or the reason the model's one was refused.
 *
 * `refusal` is a sentence for the channel and it is never empty: a drop that
 * does not say why is indistinguishable from a model that was never asked, and
 * that is the exact defect phase 1 of this session spent its time closing.
 */
export type FixVerdict = { text: string } | { refusal: string };

/**
 * Whether a model's sentence may be planted.
 *
 * TEN RULES AND ALL OF THEM MECHANICAL. Nothing here judges whether the advice
 * is GOOD - no static check can, and the judge that grades that runs offline in
 * this session's arms. What this decides is whether the sentence is the right
 * SHAPE for the slot it goes in: one or two imperative sentences, in the
 * product's voice, making no claim the product has not measured.
 *
 * Backticks are stripped rather than refused. A model asked about code writes
 * `Shard(u64)` about half the time, the identifier inside is exactly what earns
 * the sentence its place, and markdown in a source comment is noise rather than
 * a lie.
 */
export function admissibleFix(prose: unknown): FixVerdict {
  if (typeof prose !== "string") {
    return { refusal: `the model answered with a ${typeof prose} rather than text` };
  }
  // FIRST, AND ON THE RAW ANSWER. Every rule below matches on text, so a rule
  // that runs before the text is known to BE text is the only one that can
  // catch a character whose whole purpose is to not be seen.
  const forbidden = prose.match(FORBIDDEN_CHARS);
  if (forbidden !== null) {
    return { refusal: `the model's sentence carries ${nameOfChar(forbidden[0])}, which must never reach a source file` };
  }
  // Surrounding quotes are a formatting artifact, not a claim: a model asked
  // for one sentence hands back `"Make Shard(u64) ..."` often enough that
  // refusing it would spend a real win on punctuation. Stripped in pairs only,
  // so a sentence containing a quote keeps it.
  const text = unquote(prose.replace(/`+/g, "").replace(/\s+/g, " ").trim());
  if (text === "") {
    return { refusal: "the model answered with nothing" };
  }
  // THE DECLINE IS A RESULT AND NOT A FAILURE. A model handed too little
  // context is supposed to say so, and the sentence it would have invented
  // instead is the one failure mode this whole leg cannot afford.
  if (text.replace(/[.!]+$/, "").trim().toUpperCase() === FIX_PASS) {
    return { refusal: "the model declined: the context did not name a specific fix" };
  }
  if (prose.includes("```")) {
    return { refusal: "the model answered with a code block rather than a sentence" };
  }
  if (text.length > FIX_MAX_CHARS) {
    return { refusal: `the model answered in ${text.length} characters, past the ${FIX_MAX_CHARS}-character bound` };
  }
  const beats = sentences(text);
  if (beats.length > FIX_MAX_SENTENCES) {
    return { refusal: `the model answered in ${beats.length} sentences, past the ${FIX_MAX_SENTENCES}-sentence bound` };
  }
  const mixed = text.match(MIXED_SCRIPT_WORD);
  if (mixed !== null) {
    return { refusal: `the model mixed writing systems inside one word: ${JSON.stringify(mixed[0])}` };
  }
  const banned = text.match(new RegExp(`\\b(${FIX_BANNED_WORDS.join("|")})\\b`, "i"));
  if (banned !== null) {
    return { refusal: `the model hedged or spoke in the second person: ${JSON.stringify(banned[0])}` };
  }
  if (text.includes("?")) {
    return { refusal: "the model asked a question instead of giving an order" };
  }
  if (YEAR.test(text)) {
    return { refusal: "the model put a citation in a source file" };
  }
  if (CALL_SITE_TALK.test(text)) {
    return { refusal: "the model spent the blast clause's reserved words on an unmeasured claim" };
  }
  if (FORMATTING.test(text)) {
    return { refusal: "the model wrote the comment's formatting into the sentence" };
  }
  // LEADING NON-LETTERS ARE STRIPPED BEFORE THE FIRST WORD IS TAKEN. The old
  // reading was `split(/[^A-Za-z]+/)[0]`, which is the empty string for any
  // sentence that does not open on an ASCII letter, and the empty string is in
  // no list. `"(The parameters should be newtypes)"` and `"1. The parameters
  // should be newtypes."` were both admitted as orders because of it.
  const opener = (text.match(/[A-Za-z]+/)?.[0] ?? "").toLowerCase();
  if (NON_IMPERATIVE_OPENERS.includes(opener)) {
    return { refusal: `the model described rather than ordered, opening on ${JSON.stringify(opener)}` };
  }
  return { text: closed(leadCap(text)) };
}

/** One matched pair of wrapping quotes, and no more. */
function unquote(text: string): string {
  const pairs: readonly [string, string][] = [['"', '"'], ["'", "'"], ["\u201c", "\u201d"]];
  for (const [open, close] of pairs) {
    if (text.length > 1 && text.startsWith(open) && text.endsWith(close)) {
      return text.slice(1, -1).trim();
    }
  }
  return text;
}

function closed(text: string): string {
  return /[.!]$/.test(text) ? text : `${text}.`;
}

function leadCap(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// ===========================================================================
// What the model is shown, and the arms that decide how much of it
// ===========================================================================

/**
 * The word a model answers with when it cannot name a specific fix.
 *
 * TRUTH IS THE GATE, NOT A TIEBREAK. A confidently wrong fix in someone's
 * source file is worse than a generic right one, and a model with no way to
 * decline will invent something rather than answer nothing. This is the way
 * out, and it lands on the table phrase, which was always a correct sentence.
 */
export const FIX_PASS = "PASS";

/** One upstream call site, as the walk found it. The LINE is the point: three
 *  real lines showing `warm_fs_metadata(lod, shard)` being called is the
 *  strongest evidence a transposition argument can have, and a count is not. */
export interface CallSiteLine {
  file: string;
  line: number;
  text: string;
}

/** One downstream callee and whatever contract it publishes.
 *
 *  `doc` MAY BE EMPTY AND THE ENTRY STILL EARNS ITS PLACE. Measured over real
 *  repositories in this session's phase 5 spike: a callee carries a doc comment
 *  30.7-41.5% of the time in Rust, 39.3% in Python, 12.4-24.5% in C# and 2.5%
 *  in TypeScript. On TypeScript almost every in-workspace callee therefore
 *  arrives named and undocumented, and the NAME is the part worth showing
 *  there: `enrollTile` in a body tells the model what this function delegates,
 *  which a missing comment does not take away. */
export interface CalleeDoc {
  name: string;
  doc: string;
  /** The callee's declaration line, when the reader could reach the file.
   *
   *  OPTIONAL and ADDITIVE. The fix prompt has always rendered the name and the
   *  doc; the model-authored path wants the SIGNATURE, because "what does this
   *  callee take and return" is most of what a caller needs to know about it and
   *  is present even when the doc comment is not (2.5% of TypeScript callees
   *  carry a doc, and 100% of them carry a signature). A consumer that does not
   *  read this field is unaffected by its arrival. */
  signature?: string;
}

/**
 * Everything the model may be shown about the function under review.
 *
 * EVERY FIELD IS OPTIONAL AND EVERY ABSENCE IS A SHIPPED STATE. A language
 * server that cannot resolve a type, a walk that was cut short, a spike that
 * proved a provider does not answer: each one costs the prompt a block and
 * costs the product nothing, because the fallback is the table.
 *
 * The blocks are the ARMS, in the order they were added, so the arm that ships
 * is the arm that was measured rather than a prompt someone reassembled by hand
 * afterwards.
 */
export interface FixContext {
  /** Arm B: the function as written, doc comment and all. */
  functionText?: readonly string[];
  /** Arm B: the signature, already parsed, so the model does not have to. */
  signature?: string;
  /** Arm C: the SHAPES of the types this function touches. `shard: u64` is on
   *  the signature already; whether `Budget` is a struct with three fields or a
   *  newtype over `u64` is what decides whether "make them newtypes" is good
   *  advice or nonsense in this codebase. */
  typeShapes?: readonly string[];
  /** Arm D: the real upstream call lines. */
  callSites?: readonly CallSiteLine[];
  /** Arm E: downstream callees and their doc comments. */
  callees?: readonly CalleeDoc[];
}

/**
 * How much of the context one prompt carries.
 *
 * A is today's prompt and the control: one line and a principle. Each later arm
 * adds one block and keeps everything before it, so a difference between two
 * adjacent arms is a fact about the block between them.
 */
export type FixArm = "A" | "B" | "C" | "D" | "E";

export const FIX_ARMS: readonly FixArm[] = ["A", "B", "C", "D", "E"];

/** Which blocks each arm carries. Written as a table rather than as a chain of
 *  comparisons, because a rig that has to reproduce arm C exactly must be able
 *  to read what arm C IS. */
const ARM_BLOCKS: Readonly<Record<FixArm, { fn: boolean; types: boolean; callers: boolean; callees: boolean }>> =
  Object.freeze({
    A: { fn: false, types: false, callers: false, callees: false },
    B: { fn: true, types: false, callers: false, callees: false },
    C: { fn: true, types: true, callers: false, callees: false },
    D: { fn: true, types: true, callers: true, callees: false },
    E: { fn: true, types: true, callers: true, callees: true },
  });

/** How many upstream call lines to show. CHOSEN: three real lines make the
 *  transposition argument, and thirty make a prompt the reader of the arms
 *  cannot afford. */
export const FIX_CALL_SITE_CAP = 6;

/** How many callees to show, for the same reason, and the spike says the cap is
 *  the whole argument. Pointed at a real Rust workspace, one root returned 70
 *  callees carrying 33,240 bytes of doc; the goal's own example function
 *  returned 18, every one of them `std`, 13,249 bytes of standard-library
 *  rustdoc and not one sentence about the codebase. Uncapped and unfiltered,
 *  arm E is a context bomb that crowds out the type shapes and call lines arms
 *  C and D earned. */
export const FIX_CALLEE_CAP = 6;

/**
 * How many lines of one callee's doc comment reach the prompt. CHOSEN.
 *
 * The first line of a doc comment is its summary in all five languages by
 * convention, and the second is where a `# Examples` block or a parameter list
 * starts. Two lines is the summary plus its qualifier; the whole block is the
 * 13KB that made the spike recommend against feeding these raw.
 */
export const FIX_CALLEE_DOC_LINES = 2;

/** And the character bound on the joined result, because one line of rustdoc
 *  can be a paragraph. Half a fix sentence's own budget per callee. */
export const FIX_CALLEE_DOC_CHARS = 120;

/**
 * How far above and below a callee's declaration the doc reader may look.
 *
 * Four of the five languages write the doc ABOVE the declaration and Python
 * writes it INSIDE the body, so the window has to open both ways. `docLines`
 * stops at the first line that is not part of the block, so this is a bound on
 * the slice handed to it rather than on how much it reads.
 */
const CALLEE_DOC_WINDOW = 60;

/**
 * One callee's doc comment, read by THE PRODUCT'S OWN doc reader.
 *
 * `docLines` is what dimension 8 uses to decide whether a function is
 * documented at all, and it already knows the thing a second reader would get
 * wrong: four of the five languages write the doc above the declaration and
 * Python writes it inside the body, 68.0% of the time, measured over 510
 * functions. It also steps over the attributes and decorators that sit between
 * a doc block and its head, which 29.2% of documented Rust functions have. A
 * doc reader written fresh for this leg would be a second answer to a question
 * the subsystem has already answered carefully, and it would drift.
 *
 * The window is a bound on the SLICE, not on the read: `docLines` stops at the
 * first line that is not part of the block either way.
 *
 * `""` is the answer for a callee with no doc, for an unreadable file, and for
 * a declaration line outside the file. All three are the same thing to the
 * prompt - a callee that publishes no contract - and the NAME still goes in.
 */
export function calleeDoc(
  fileLines: readonly string[] | undefined,
  declLine: number,
  name: string,
  lang: CriticizeLang,
): string {
  if (!Array.isArray(fileLines) || fileLines.length === 0) {
    return "";
  }
  if (!Number.isInteger(declLine) || declLine < 0 || declLine >= fileLines.length) {
    return "";
  }
  const from = Math.max(0, declLine - CALLEE_DOC_WINDOW);
  const to = Math.min(fileLines.length, declLine + CALLEE_DOC_WINDOW);
  const headIndex = declLine - from;
  const unit: FunctionUnderReview = {
    languageId: lang.languageIds[0] ?? "",
    name: name === "" ? "callee" : name,
    lines: fileLines.slice(from, to),
    startLine: from + 1,
    headIndex,
    // The smallest value that satisfies `headIndex < bodyIndex`. Nothing on
    // this path reads it: the upward walk starts at `headIndex - 1` and the
    // Python walk finds the end of the declaration head itself, precisely so a
    // wrong `bodyIndex` cannot turn a documented function into an undocumented
    // one.
    bodyIndex: headIndex + 1,
  };
  const doc = docLines(unit, lang)
    .filter((line) => line.trim() !== "")
    .slice(0, FIX_CALLEE_DOC_LINES)
    .join(" ")
    .trim();
  // The marker is spelled out so a cut doc cannot read as a complete one. A
  // model that sees a sentence stop mid-clause with nothing to say so is
  // entitled to treat the missing half as absent rather than as elided.
  return doc.length > FIX_CALLEE_DOC_CHARS
    ? `${doc.slice(0, FIX_CALLEE_DOC_CHARS - 3).trimEnd()}...`
    : doc;
}

/**
 * The arm the PRODUCT sends. One constant, and NOT a user setting.
 *
 * A setting here would make every bug report and every measurement carry an
 * unknown: which prompt did that comment come from. The arms exist so a human
 * can answer that once, offline, with the judge in phase 6 - and the answer is
 * a constant in the source rather than a dial in someone's settings.json.
 *
 * DEFAULTED TO E UNTIL PHASE 7'S MEASUREMENT SETS IT. E is the most context
 * this module can describe, so it is the arm that degrades furthest on its own:
 * `buildFixPrompt` emits only the blocks the context actually carries, and the
 * callee block has no filler behind it yet, so an E prompt today is a D prompt.
 * If the arms report says D or C wins on truth, this line moves and nothing
 * else does.
 */
export const FIX_SHIPPED_ARM: FixArm = "E";

/**
 * Why one row's comment carries the table's phrase rather than a model's.
 *
 * THE TWO KINDS MUST NEVER SHARE A SPELLING. `unreachable` is an outage: the
 * round never reached a model, so nothing was judged and the fallback says
 * nothing about the model's writing. `refused` is a sentence that arrived and
 * failed the gate, which is a fact about that sentence. Phase 1 of this session
 * exists because the explainer spelled those two the same for a whole release,
 * and `explained 0 of 2 elevated row(s)` was printed on 44 host runs with no
 * backend running at all.
 */
export type FixFailure = {
  dimension: DimensionId;
  kind: "unreachable" | "refused";
  /** The transport's own message, or the gate's reason. Never empty. */
  detail: string;
};

/** What the model is told its job is. */
const FIX_INSTRUCTION = [
  "You are writing the LAST sentence of a code-review comment that will be planted in a developer's",
  "source file, directly above the flagged line.",
  "",
  "A static detector already found the problem and already wrote the sentences in front of yours.",
  "The finding is settled: do not restate it, do not argue with it, and do not look for other defects.",
  "Your one job is the FIX, for THIS function.",
].join("\n");

/** The bounds, stated so the common case is a kept sentence rather than a
 *  dropped one. The gate above is the enforcement; this is the request. */
function fixBounds(tableOrder: string): string {
  return [
    "Rules:",
    `- One or two sentences, at most ${FIX_MAX_CHARS} characters. Start with a verb: it is an order, not a description.`,
    "- Name the real identifiers, types and values from the code above. That is the whole point:",
    `  the generic answer "${tableOrder}" is already written and will be used instead of yours if`,
    "  your sentence would read the same on any function in any repository.",
    "- Never write \"you\", never hedge, never cite anything, never ask a question, and never mention call sites.",
    "- No code blocks, no markdown, no comment markers. One line of plain prose.",
    `- If the context above does not let you name a specific fix, answer with exactly ${FIX_PASS}.`,
    "  A confidently wrong fix in someone's source file is worse than a generic right one.",
  ].join("\n");
}

/**
 * The prompt for one fix sentence, at one arm.
 *
 * The finding block is arm A and every arm carries it: the dimension, the
 * detector's own words, the principle and the flagged line. Everything after it
 * is context the arms turn on.
 */
export function buildFixPrompt(
  finding: DetectorFinding,
  source: string,
  tableOrder: string,
  context: FixContext = {},
  arm: FixArm = "E",
): string {
  const blocks = ARM_BLOCKS[arm] ?? ARM_BLOCKS.E;
  const out: string[] = [
    FIX_INSTRUCTION,
    "",
    `Dimension: ${finding.dimension}`,
    `What the detector says fired: ${finding.detail}`,
    `The principle: ${source}`,
    `The flagged line, at line ${finding.line}:`,
    `    ${finding.evidence}`,
  ];

  if (blocks.fn && context.signature !== undefined && context.signature !== "") {
    out.push("", `The signature: ${context.signature}`);
  }
  if (blocks.fn && (context.functionText?.length ?? 0) > 0) {
    out.push("", "The whole function:", ...(context.functionText ?? []).map((line) => `    ${line}`));
  }
  if (blocks.types && (context.typeShapes?.length ?? 0) > 0) {
    out.push("", "The types it touches, as this codebase declares them:", ...(context.typeShapes ?? []));
  }
  if (blocks.callers && (context.callSites?.length ?? 0) > 0) {
    out.push("", "Where it is called from:");
    for (const site of (context.callSites ?? []).slice(0, FIX_CALL_SITE_CAP)) {
      out.push(`    ${site.file}:${site.line}: ${site.text}`);
    }
  }
  if (blocks.callees && (context.callees ?? []).length > 0) {
    out.push("", "What it calls, and what those promise:");
    for (const callee of (context.callees ?? []).slice(0, FIX_CALLEE_CAP)) {
      // THE NAME ALONE WHEN THERE IS NO DOC, rather than a name and an empty
      // promise. Real TypeScript documents 2.5% of its declarations, so a
      // trailing `: ` would be the common rendering rather than the rare one,
      // and a colon with nothing after it reads as a doc that said nothing.
      out.push(`    ${callee.doc === "" ? callee.name : `${callee.name}: ${callee.doc}`}`);
    }
  }

  out.push("", fixBounds(tableOrder));
  return out.join("\n");
}
