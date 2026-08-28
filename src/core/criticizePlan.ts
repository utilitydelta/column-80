// ===========================================================================
// Where Criticize's comments go, and what comes out before they go in.
//
// THE PLANNER IS THE HALF THAT TOUCHES A PERSON'S FILE. Phase 1 decided the
// words; this decides which lines they land on and what the region looks like
// afterwards. It produces TEXT and nothing else: no document, no edit, no
// consent. The presenter owns the write, so the whole gesture keeps the one
// write path fn-gen and repair already share.
//
// PLACEMENT IS ONE RULE (human, 2026-08-28). Every comment goes directly above
// its offending line, at that line's own indent. The trailing slot was measured
// unreachable in phase 1 (with an EMPTY detail, on a 31-column code line, the
// shortest of the fifteen phrases is 58 characters and nothing fits), and a
// second shorter voice for a slot nobody asked for was refused. The strip pass
// still takes a trailing C80 comment in this product's own shape, because an
// older build could have planted one; a hand-written one is left alone.
//
// IDEMPOTENCE IS THE FEATURE, NOT A NICETY. The gesture is a proposal a
// developer accepts, and a developer presses it again a minute later. So the
// strip runs FIRST and the findings are mapped onto the STRIPPED region:
// mapping them onto the incoming lines would walk every comment further down
// the body on each press until the code was buried.
//
// NOTHING VANISHES. A finding whose document line falls outside the region
// attaches to the region's first line rather than being dropped. A card that
// says three failures beside a diff that shows two is the worst outcome this
// module has, and session-v61 lost a whole language to exactly that off-by-one.
//
// ONE CRITICISM IS ONE TAG. A wrapped comment is a HEAD line carrying
// `C80 <dimension>: ` and continuation lines that hang under it. An earlier
// clause put the tag on every line, and the reviewer was right that
//
//     // C80 clock: reads Date.now here. No call sites ride on this signature.
//     // C80 Hidden wall-clock read. Untestable. Pass it in.
//
// reads as two findings with a sentence sawn in half. The strip pass pays for
// that in exactness rather than in the reader's eye: a continuation is the
// token followed by the hanging indent, which no hand-written comment has.
//
// Pure: no vscode, no document, no clock, no randomness, and it never throws.
// ===========================================================================

import { ElevationPolicy, Scorecard, blastRadiusFor } from "./criticizeScore";
import { DetectorFinding, DimensionId } from "./criticizeTypes";
import { C80_TAG, VOICE, criticizeComment, wrapComment } from "./criticizeVoice";
import { lineCommentFor } from "./fimInject";
import { tightenTrimEnd } from "./tightenRegion";

/** What the presenter is handed for one function. */
export interface InjectionPlan {
  /** The replacement text for the region, ready to hand a presenter. */
  text: string;
  /** How many comments were planted. Zero means there is nothing to propose. */
  planted: number;
  /** How many pre-existing C80 comments were stripped before planting. */
  stripped: number;
}

/**
 * A region with this product's own comments taken out, and where the lines that
 * survived came from.
 *
 * `sourceIndex[i]` is the index in the INCOMING array of the line now at `i`.
 * That array is the LINE MAP, and it is what lets a caller score the
 * comment-free document and still report the line numbers of the file the human
 * is looking at. Without it the two coordinate systems are the same length only
 * when nothing was stripped, which is the one case the second press is not.
 */
export interface StripResult {
  /** The lines that survived, `\r` already normalised out. */
  lines: readonly string[];
  /** How many comment HEADS were removed. Heads, not lines: the caller reports
   *  this to a human and a human counts criticisms. */
  stripped: number;
  /** For each surviving line, its index in the incoming array. */
  sourceIndex: readonly number[];
}

/**
 * What a continuation line carries in place of the head's `C80 `.
 *
 * The separator space plus four columns, because `C80 ` is four columns wide,
 * so continuation prose starts at the same column as the head's prose and the
 * comment hangs under itself. Every line still costs the same width, so the
 * 80-column budget is one number for the whole comment.
 */
const CONTINUATION_INDENT = " ".repeat(1 + C80_TAG.length);

/** The fewest spaces after the token that can mark a continuation. Emission is
 *  exact; recognition is not, so a comment planted by a build that counted the
 *  separator space differently still strips instead of being orphaned. One
 *  space is the floor a hand-written `// my own note` sits on, and that is the
 *  thing this number exists to stay clear of. */
const CONTINUATION_MIN_SPACES = 4;

/** The fifteen dimension ids, off the one table that has to hold all fifteen.
 *  A second hand-written list here is a second thing to forget to update when a
 *  dimension is added, and the strip pass would silently stop recognising the
 *  new one's comments as comment HEADS. */
const DIMENSIONS: ReadonlySet<string> = new Set(Object.keys(VOICE));

/** A comment this module planted, before it knows where it sits. */
interface PlannedComment {
  /** Index into the stripped region. */
  index: number;
  /** The rendered lines, indent and token and tag already on them. */
  lines: readonly string[];
}

const EMPTY_PLAN: InjectionPlan = { text: "", planted: 0, stripped: 0 };

/**
 * The region with every stale C80 comment removed and a fresh one planted above
 * each elevated finding.
 *
 * `regionLines` runs from the DECLARATION HEAD to the end of the function, not
 * from `span.start`: Python's Fork A moves `span.start` past a leading
 * docstring, and `adjacent-params` and `param-count` both fire ON THE HEAD LINE.
 *
 * `regionStartLine` AND THE CARD'S FINDINGS ARE BOTH IN THE SCORING VIEW, which
 * is the document with this product's own comments taken out. The findings are
 * mapped onto the STRIPPED region, so the subtraction is only a mapping when the
 * number it subtracts counts stripped lines too. On a first press the view and
 * the document are the same lines and this is the document line; on a second
 * press they are not, and `scoringView` in `criticizeGesture` is what puts both
 * numbers in the same coordinate system. Handing this a document-numbered card
 * over an already-commented region walks every finding below a planted comment
 * down the body by the number of comment lines above it, which is S62-7.
 *
 * Total. A malformed card, a nonsense line number and an empty region all
 * produce a plan rather than a throw, because the caller is a gesture a
 * developer pressed and a stack trace is not an answer to it.
 */
export function planInjection(
  regionLines: readonly string[],
  regionStartLine: number,
  card: Scorecard,
  policy: ElevationPolicy,
): InjectionPlan {
  if (!Array.isArray(regionLines) || regionLines.length === 0) {
    return EMPTY_PLAN;
  }
  const languageId = typeof card?.languageId === "string" ? card.languageId : "";
  const token = lineCommentFor(languageId);

  const stripResult = stripCriticism(regionLines, languageId);
  const lines = stripResult.lines;

  const planned = planComments(lines, regionStartLine, card, policy, token);

  const out: string[] = [];
  const byIndex = new Map<number, string[]>();
  for (const comment of planned) {
    const bucket = byIndex.get(comment.index);
    if (bucket === undefined) {
      byIndex.set(comment.index, [...comment.lines]);
    } else {
      bucket.push(...comment.lines);
    }
  }
  for (let i = 0; i < lines.length; i++) {
    const above = byIndex.get(i);
    if (above !== undefined) {
      out.push(...above);
    }
    out.push(lines[i]);
  }

  return { text: out.join("\n"), planted: planned.length, stripped: stripResult.stripped };
}

/**
 * One comment per FINDING, in the order the card lists them.
 *
 * The card's row order is the rubric's reading order and it is fixed, so
 * several findings on one line come out honesty first and altitude last, the
 * same way the panel reads. Nothing is reordered and nothing is grouped.
 *
 * The POLICY decides what plants, and `row.elevated` is never read: that field
 * is a convenience the scorer filled in against whatever policy was in force
 * then, and `criticizeRender` already recomputes rather than trusting it.
 */
function planComments(
  lines: readonly string[],
  regionStartLine: number,
  card: Scorecard,
  policy: ElevationPolicy,
  token: string,
): PlannedComment[] {
  const rows = Array.isArray(card?.rows) ? card.rows : [];
  const held = new Set<string>(Array.isArray(policy?.held) ? policy.held : []);
  const planned: PlannedComment[] = [];

  for (const row of rows) {
    if (row?.outcome?.state !== "flagged" || held.has(row.dimension)) {
      continue;
    }
    const radius = measuredRadius(row.dimension, row.blastRadius);
    const findings = Array.isArray(row.outcome.findings) ? row.outcome.findings : [];
    for (const finding of findings) {
      const index = regionIndex(finding, regionStartLine, lines.length);
      const rendered = render(finding, radius, lines[index], token);
      if (rendered.length > 0) {
        planned.push({ index, lines: rendered });
      }
    }
  }
  // Comments group by line, and within a line they keep card order. Sorting by
  // index alone would not be enough on its own, so the sort is STABLE on the
  // order they were planned in.
  return planned
    .map((comment, order) => ({ comment, order }))
    .sort((a, b) => a.comment.index - b.comment.index || a.order - b.order)
    .map((entry) => entry.comment);
}

/**
 * Which region line this finding belongs above.
 *
 * A finding outside the region attaches to the region's FIRST line, in either
 * direction, and is never dropped. Below-region should not happen; if it does,
 * the first line is where a reader will look for a finding whose real home is
 * gone. A dimension that read the doc comment genuinely fires above the head.
 */
function regionIndex(
  finding: DetectorFinding,
  regionStartLine: number,
  length: number,
): number {
  if (finding === null || typeof finding !== "object") {
    return 0;
  }
  if (!Number.isInteger(finding.line) || !Number.isInteger(regionStartLine)) {
    return 0;
  }
  const index = finding.line - regionStartLine;
  return index >= 0 && index < length ? index : 0;
}

/**
 * The call-site count this comment may carry, or nothing.
 *
 * `blastRadiusFor` is the predicate that already decides which rows a count
 * describes, and calling it is what keeps `signatureLevel` in one place: a
 * second copy here is how the panel and the source file start disagreeing about
 * whether a nesting fix reaches a caller.
 *
 * A count that is not a non-negative integer is UNMEASURED. `2.5 call sites` in
 * a person's source is worse than saying nothing, and phase 1 is never handed
 * a number it would have to reject.
 *
 * SAFE integer, not merely integer. `1e21` passes `Number.isInteger` and prints
 * as `1e+21 call sites`, and above 2^53 a count is not exactly representable
 * anyway, so it is not a measurement. The fold lives here because this module
 * already owns the "is this a measurement" question; putting it in the caller
 * would be a second copy of that predicate.
 */
function measuredRadius(dimension: DimensionId, blastRadius: unknown): number | undefined {
  const radius = blastRadiusFor({
    dimension,
    callSites: typeof blastRadius === "number" ? blastRadius : undefined,
  });
  return typeof radius === "number" && Number.isSafeInteger(radius) && radius >= 0
    ? radius
    : undefined;
}

/**
 * The lines for one comment: a tagged head, then continuations hanging under it.
 *
 * The tag rides the TOKEN into `wrapComment` so that its width is charged
 * against the 80-column budget on EVERY line, and the tag is then swapped for
 * the hanging indent on all but the first. The swap is the same number of
 * columns, so the wrap that was measured is the wrap that ships; re-indenting
 * after a wrap measured without the indent is how a comment ends up at 84
 * columns in a product named for column 80.
 */
function render(
  finding: DetectorFinding,
  radius: number | undefined,
  target: string,
  token: string,
): string[] {
  const comment = criticizeComment(
    finding,
    radius === undefined ? undefined : { blastRadius: radius },
  );
  if (comment === "") {
    return [];
  }
  const body = comment.startsWith(C80_TAG) ? comment.slice(C80_TAG.length) : comment;
  const indent = indentOf(target);
  const lines = wrapComment(body, indent, `${token} ${C80_TAG.trim()}`);
  const head = `${indent}${token} ${C80_TAG}`;
  const hang = `${indent}${token}${CONTINUATION_INDENT}`;
  return lines.map((line, i) =>
    i === 0 || !line.startsWith(head) ? line : `${hang}${line.slice(head.length)}`,
  );
}

function indentOf(line: string): string {
  const match = /^[ \t]*/.exec(typeof line === "string" ? line : "");
  return match === null ? "" : match[0];
}

/**
 * Every C80 comment out, so the second press replaces rather than stacks, and
 * so the RUBRIC never scores this product's own criticism.
 *
 * TWO CALLERS, ONE ANSWER. The planner strips before it plants, and the gesture
 * strips before it SLICES: S62-7 was one root with two faces, a placement that
 * drifted by the number of comment lines above a finding, and a card that read a
 * documented Rust function as undocumented because a planted `// C80` block sat
 * between the `///` and the head. Go was the mirror, where `//` is the doc
 * prefix and a planted comment read AS documentation. A second strip written at
 * the other caller is a second answer to "what did this product write", and the
 * two would drift on the first day a comment shape changed.
 *
 * A comment is a HEAD and the continuation lines that immediately follow it. A
 * head is the token, the tag and one of the fifteen dimension ids; a
 * continuation is the token and the hanging indent. `stripped` counts HEADS,
 * because the caller reports this number to a human and a human counts
 * criticisms, not lines.
 *
 * A HAND-WRITTEN COMMENT CANNOT BE EATEN BY THIS. `// my own note` has one
 * space after the token, and a continuation is only recognised inside a run
 * that a head opened. That is why the hanging indent is an exact shape rather
 * than "some whitespace": it is the only thing separating this product's own
 * second line from a line somebody wrote.
 *
 * IT DELETES ONLY WHAT IT COUNTS, and that is one rule rather than two. An
 * earlier build removed any line whose trimmed text opened with the tag and
 * counted only the ones naming a dimension, so `// C80 is the column limit we
 * keep to` was deleted while the offered line said `stripping 0 stale
 * comments` - a human approving a deletion the product never mentioned, in the
 * one gesture whose whole promise is that the diff is what lands. The head test
 * now gates the removal as well as the count, so the number on the channel is
 * the number of criticisms in the diff.
 */
export function stripCriticism(
  lines: readonly string[],
  languageId: string,
): StripResult {
  const token = lineCommentFor(typeof languageId === "string" ? languageId : "");
  const marker = `${token} ${C80_TAG}`;
  const out: string[] = [];
  const sourceIndex: number[] = [];
  const continuation = new RegExp(
    `^[ \\t]*${escapeForRegExp(token)} {${CONTINUATION_MIN_SPACES},}\\S`,
  );
  let stripped = 0;
  let inComment = false;

  const incoming = Array.isArray(lines) ? lines : [];
  for (let at = 0; at < incoming.length; at++) {
    // The presenter normalises to the document's own EOL through
    // `withDocumentEol`. A second answer to that question here is how the two
    // drift, so this module works in `\n` and carries no `\r` at all.
    const line = typeof incoming[at] === "string" ? incoming[at].replace(/\r/g, "") : "";
    const keep = (text: string) => {
      out.push(text);
      sourceIndex.push(at);
    };
    const trimmed = line.trim();
    if (trimmed.startsWith(marker)) {
      if (isHead(trimmed.slice(marker.length))) {
        // A whole-line comment in THE SHAPE THIS PRODUCT EMITS: the token, the
        // tag, and one of the fifteen dimension ids. It is deleted and it is
        // counted, and those are the same test on purpose.
        stripped += 1;
        inComment = true;
        continue;
      }
      if (inComment) {
        // THE SUPERSEDED SHAPE, and only ever inside a run a counted head
        // opened. Amendment 4 moved continuations from `C80 ` to the hanging
        // indent, so a build older than that planted the tag on every line and
        // its second line names no dimension. Deleting it because a head is
        // directly above is not "deleting what it does not count": it belongs
        // to that head, which was counted. Left behind, an older build's
        // comment comes out as an orphaned half-sentence.
        continue;
      }
      // Tagged, no dimension, no head above it: not a shape this product has
      // ever emitted, so it is somebody's own note and it stays.
    }
    if (inComment && continuation.test(line)) {
      continue; // the rest of the head above
    }
    inComment = false;
    const markerAt = markerIndex(line, marker);
    if (
      markerAt > 0 &&
      line.slice(0, markerAt).trim() !== "" &&
      isHead(line.slice(markerAt + marker.length))
    ) {
      // A legacy trailing comment IN THIS PRODUCT'S SHAPE. The planner has not
      // created one since the human dropped trailing placement, and an older
      // build could have. The code line keeps its indent and loses the
      // separator, so a strip never leaves a line ending in whitespace behind.
      // The head test is the same one the whole-line branch applies, for the
      // same reason: a `let n = 1; // C80 is the column limit` written by a
      // person is not this product's text and the diff must not offer to cut it.
      stripped += 1;
      keep(tightenTrimEnd(line.slice(0, markerAt)));
      continue;
    }
    keep(line);
  }

  return { lines: out, stripped, sourceIndex };
}

/** The token is `//` or `#`, so this has exactly one character to quote today.
 *  It is written for the general case anyway, because the alternative is a
 *  regex that silently means something else the day a language arrives with a
 *  token that is not two slashes. */
function escapeForRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** True when the text after the tag opens a new comment rather than continuing
 *  one. The dimension id is checked against the fifteen rather than against a
 *  generic word-colon shape, because "dimension" is what the contract says and
 *  a continuation that happened to start with a colon-word would otherwise be
 *  counted as a second criticism. */
function isHead(afterTag: string): boolean {
  const match = /^([a-z][a-z-]*):\s/.exec(afterTag);
  return match !== null && DIMENSIONS.has(match[1]);
}

/**
 * Where the comment marker starts on this line, ignoring one inside a string.
 *
 * The scan is quote-aware and deliberately not a parser. `log("// C80 clock:
 * ...")` is data rather than criticism, and a strip pass that cut the line
 * there would corrupt a string literal in a person's source. The failure mode
 * that matters is one-sided: leaving a legacy trailing comment behind is a
 * stale comment, and cutting a string literal is a broken build.
 */
function markerIndex(line: string, marker: string): number {
  let quote: string | undefined;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote !== undefined) {
      if (ch === "\\") {
        i += 1;
        continue;
      }
      if (ch === quote) {
        quote = undefined;
      }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }
    if (line.startsWith(marker, i)) {
      return i;
    }
  }
  return -1;
}
