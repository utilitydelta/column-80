// ===========================================================================
// The Criticize gesture's decisions, with no host in them.
//
// Every refusal sentence, every evidence line and the toast live here rather
// than in `src/vscode/criticize.ts`, because a decision that only exists inside
// a `registerCommand` callback can only be checked by launching VS Code. The
// vscode module is left holding the editor, the transport and the channel; what
// it SAYS is decided in this file and pinned headlessly.
//
// A path is finished when it emits evidence, not when it compiles. That is why
// the refusals below are values rather than inline string literals: a branch
// with no sentence is a branch nobody can audit.
// ===========================================================================

import { DimensionId } from "./criticizeTypes";
import { ElevationPolicy, Scorecard, ScorecardRow, signatureLevel } from "./criticizeScore";
// The proposal half of the gesture. `C80_TAG` and `lineCommentFor` are the SAME
// two answers the planner strips with: a region that recognised this product's
// own comments differently from the pass that removes them would reach back over
// lines the strip never takes, or miss lines it does.
import { C80_TAG } from "./criticizeVoice";
// The SAME strip the planner runs before it plants. The gesture runs it before
// it SLICES, so the rubric never scores this product's own comments.
import { stripCriticism } from "./criticizePlan";
import { escapeBreaks } from "./errorBound";
import { lineCommentFor } from "./fimInject";

/** Everything this gesture writes to the output channel carries it. One prefix
 *  per gesture is the product's convention: `[tighten]`, `[walk]`, `[critique]`. */
export const CRITIQUE_PREFIX = "[critique]";

/** How many dimensions a card always carries. Fixed by the rubric, and the
 *  evidence line quotes it so a reader can tell "three elevated" from "three
 *  scored". */
export const RUBRIC_SIZE = 15;

/**
 * How many elevated rows may be sent to the explainer, CHOSEN and not measured.
 *
 * One model round per row, and the card is complete without any of them. Six is
 * the point where a card's elevated block is already longer than a developer
 * reads in one glance, so rounds past it buy prose nobody reaches. Rows beyond
 * the cap keep their evidence lines and lose only the prose, which is the
 * degradation this whole leg is designed around.
 */
export const EXPLAIN_ROW_CAP = 6;

/** The evidence line for a step that succeeded. */
export function critiqueLine(text: string): string {
  return `${CRITIQUE_PREFIX} ${text}`;
}

/** The evidence line for a refusal. Every refusal branch emits one, and it
 *  names the cause rather than the branch. */
export function refusalLine(reason: string): string {
  return `${CRITIQUE_PREFIX} refused: ${reason}`;
}

/** The line a cancel leaves behind. The user's own action, so it is a record
 *  and not a failure, and nothing else is emitted after it. */
export const CANCELLED_LINE = `${CRITIQUE_PREFIX} cancelled`;

// ---------------------------------------------------------------------------
// The refusals, in the order the gesture reaches them
// ---------------------------------------------------------------------------

/** Step 1. No editor, so there is no cursor and no function. */
export const NO_EDITOR_TOAST = "Column 80: no active editor.";
export const NO_EDITOR_REASON = "there is no active editor, so there is no function at a cursor";

/**
 * Step 2. The language has no rubric tables.
 *
 * IT NAMES THE LANGUAGE. A named refusal is a shipped state, the way 2.4.0
 * refuses TypeScript for covering tests in those words; a generic "cannot do
 * that here" leaves the developer guessing whether the feature is broken or
 * their file is out of scope. The two sentences below are the same fact for two
 * surfaces, and the toast is the one that must stay one line.
 */
export function unregisteredLanguageToast(languageId: string): string {
  return `Column 80: Criticize does not know how to read ${languageId} yet.`;
}

export function unregisteredLanguageReason(languageId: string): string {
  return `no rubric tables are registered for ${languageId}, so nothing here could examine this file`;
}

/**
 * Step 3. A cursor that is not inside a function.
 *
 * NEVER SCORE THE FILE INSTEAD. The rubric is about one function; a file-level
 * card would be fifteen dimensions answered about nothing in particular, and it
 * would be the "criticize file" gesture the one-gesture rule refuses.
 */
export const NO_FUNCTION_TOAST =
  "Column 80: put the cursor inside a function to criticize it.";
export const NO_FUNCTION_REASON =
  "no function was resolved at the cursor, and this pass scores a function rather than a file";

/** A resolved function whose slice could not be built. `sliceFunction` returns
 *  undefined rather than an empty-but-valid unit, because a unit whose body was
 *  never in the input reads clean on every body dimension. */
export function sliceRefusalReason(name: string): string {
  return `the slice for ${name} could not be built, and a half-built slice would read clean on every dimension it never examined`;
}

// ---------------------------------------------------------------------------
// Step 4a: the document the rubric is allowed to read
//
// THE RUBRIC MUST NOT SCORE THIS PRODUCT'S OWN CRITICISM. S62-7 was one root
// with three faces, all of them on the SECOND press:
//
//  - a documented Rust function read as UNDOCUMENTED, because `docLines` walks
//    up from the head and stops at the first line that is not a doc line, and a
//    planted `// C80 ...` block sits between the `///` and the head;
//  - Go is the mirror and worse: `//` IS Go's doc prefix, so a planted comment
//    read AS documentation and an undocumented function's finding vanished;
//  - and `section-comment` fired on the product's own comment.
//
// So the scoring view is the document with those comments taken out, and the
// slice, the score and the plan all read the SAME lines. The strip is the
// planner's, imported rather than re-derived: a second answer to "what did this
// product write" would drift from the pass that removes it.
// ---------------------------------------------------------------------------

/**
 * The document as the rubric reads it, and the line map back to the file.
 *
 * `documentLine[i]` is the 1-based line of the file that `lines[i]` came from.
 * The card the human reads, and the `scoring <name> at line <n>` evidence, are
 * put back through this map, because a card citing line 41 while the editor
 * shows line 47 is a new defect traded for an old one.
 */
export interface ScoringView {
  /** The document's lines with every C80 comment of this product's own gone. */
  lines: readonly string[];
  /** The 1-based document line each view line came from. Strictly increasing. */
  documentLine: readonly number[];
}

/** The view for one document. A document that carries no C80 comment produces
 *  a view identical to it, with an identity map, which is why the FIRST press
 *  is byte-for-byte what it was before this existed. */
export function scoringView(
  documentLines: readonly string[],
  languageId: string,
): ScoringView {
  const stripped = stripCriticism(documentLines, languageId);
  return {
    lines: stripped.lines,
    documentLine: stripped.sourceIndex.map((index) => index + 1),
  };
}

/**
 * The view line for a document line, reading DOWNWARD.
 *
 * Used for the range's START. A declaration head is never a C80 comment so it
 * survives the strip and this is exact for it; the downward fallback is for the
 * injection region, whose first line IS a planted comment on a second press and
 * whose stripped first line is therefore the head below it.
 */
export function viewLineAtOrAfter(view: ScoringView, documentLine: number): number {
  const map = view?.documentLine ?? [];
  if (map.length === 0) {
    return 1;
  }
  for (let i = 0; i < map.length; i++) {
    if (map[i] >= documentLine) {
      return i + 1;
    }
  }
  return map.length;
}

/** The view line for a document line, reading UPWARD. Used for the range's END,
 *  where the downward fallback would extend the range past the function. */
export function viewLineAtOrBefore(view: ScoringView, documentLine: number): number {
  const map = view?.documentLine ?? [];
  if (map.length === 0) {
    return 1;
  }
  for (let i = map.length - 1; i >= 0; i--) {
    if (map[i] <= documentLine) {
      return i + 1;
    }
  }
  return 1;
}

/** The document line a view line came from. A number outside the view is
 *  returned unchanged rather than clamped: it is not a line this map has an
 *  answer for, and inventing one would put a confident wrong number on a card. */
export function documentLineOf(view: ScoringView, viewLine: number): number {
  const map = view?.documentLine ?? [];
  return Number.isInteger(viewLine) && viewLine >= 1 && viewLine <= map.length
    ? map[viewLine - 1]
    : viewLine;
}

/**
 * The same card, with every line number naming the file rather than the view.
 *
 * THE CARD IS THE PRIMARY PRODUCT, so this is the copy that is rendered, and the
 * view-numbered card is the one the PLANNER keeps: the planner maps findings
 * onto the stripped region, and a document-numbered finding over an
 * already-commented region is the placement drift S62-7 measured. Two
 * coordinate systems is the price of scoring a document the human is not
 * looking at; one card in both would be a wrong number on one of the two
 * surfaces.
 */
export function cardInDocumentLines(card: Scorecard, view: ScoringView): Scorecard {
  return {
    ...card,
    headLine: documentLineOf(view, card.headLine),
    rows: (card?.rows ?? []).map((row) =>
      row.outcome.state !== "flagged"
        ? row
        : {
            ...row,
            outcome: {
              state: "flagged" as const,
              findings: row.outcome.findings.map((finding) => ({
                ...finding,
                line: documentLineOf(view, finding.line),
              })),
            },
          },
    ),
  };
}

// ---------------------------------------------------------------------------
// What the card says about itself
// ---------------------------------------------------------------------------

export interface CardSummary {
  /** Rows flagged and not held by the policy. */
  elevated: number;
  /** Rows the language could not answer. Reported alongside the elevated count
   *  because "two elevated" out of fifteen answered and out of fifteen where
   *  nine were blind are very different cards. */
  blind: number;
  /** Rows flagged but held below the bar by policy. Dimension 15 ships here
   *  pending a ruling. */
  held: number;
}

/** Counts the card the way the renderer will read it: elevation is recomputed
 *  from the policy rather than trusted off the row, so a card scored under the
 *  default and summarised under a ruling agrees with its own text. */
export function summariseCard(card: Scorecard, policy: ElevationPolicy): CardSummary {
  const held = new Set<DimensionId>(policy?.held ?? []);
  const rows: readonly ScorecardRow[] = card?.rows ?? [];
  let elevated = 0;
  let blind = 0;
  let heldCount = 0;
  for (const row of rows) {
    if (row.outcome.state === "blind") {
      blind++;
      continue;
    }
    if (row.outcome.state !== "flagged") {
      continue;
    }
    if (held.has(row.dimension)) {
      heldCount++;
    } else {
      elevated++;
    }
  }
  return { elevated, blind, held: heldCount };
}

/** `[critique] scoring <name> (<languageId>) at line <n>`. */
export function scoringLine(name: string, languageId: string, headLine: number): string {
  return critiqueLine(`scoring ${name} (${languageId}) at line ${headLine}`);
}

/** `[critique] <k> of 15 dimensions elevated, <b> blind`. */
export function summaryLine(summary: CardSummary): string {
  return critiqueLine(
    `${summary.elevated} of ${RUBRIC_SIZE} dimensions elevated, ${summary.blind} blind, ${summary.held} held below the bar by policy`,
  );
}

/** `[critique] blast radius: <n> call sites for <dimension>`, emitted only when
 *  the walk produced a number. A walk that produced nothing emits its own note
 *  instead, so the channel never carries a zero the walk did not measure. */
export function blastLine(dimension: DimensionId, callSites: number): string {
  return critiqueLine(`blast radius: ${callSites} call sites for ${dimension}`);
}

/** `[critique] explainer skipped: <reason>`. A closed tier gate, an absent
 *  transport and a thrown round all land here, because none of them is a
 *  failure of the gesture: the card is already complete. */
export function explainerSkippedLine(reason: string): string {
  return critiqueLine(`explainer skipped: ${reason}`);
}

/**
 * The toast. ONE LINE, and it never carries the card.
 *
 * The card is fifteen rows plus evidence plus prose and it belongs in a channel
 * a developer can scroll. A notification that carried it would be truncated by
 * the host at a width nothing here controls, and the truncation would fall
 * wherever it fell.
 *
 * A card with nothing elevated gets the RULED wording. "Clean" and "looks
 * correct" are claims this pass has no instrument for; what it can say is that
 * this pass found nothing above its own bar.
 */
/**
 * The line a card carries when the document moved while it was being enriched.
 *
 * A card is scored from a snapshot, and the caller walk and the model rounds
 * that follow it take real time. If the developer typed in between, every line
 * number and every quoted line on the card describes bytes that are no longer
 * there. The card is still a true reading of what it read, so it is not
 * discarded: what would be false is presenting it as a reading of the file as
 * it stands, and this sentence is the difference.
 */
export function staleCardLine(name: string): string {
  return `The file changed while this card was being prepared, so the line numbers below describe ${name} as it read when the pass started, not as it reads now. Press again for a current card.`;
}

/** The same fact on the evidence channel. */
export function staleEvidenceLine(from: number, to: number): string {
  return `[critique] document moved during enrichment: version ${from} to ${to}, card is from the earlier bytes`;
}

export function criticizeToast(name: string, summary: CardSummary): string {
  if (summary.elevated === 0) {
    return `Column 80: on ${name}, this pass found nothing above the evidence bar. The full rubric is in the output channel.`;
  }
  const noun = summary.elevated === 1 ? "dimension is" : "dimensions are";
  return `Column 80: ${summary.elevated} of ${RUBRIC_SIZE} ${noun} above the evidence bar on ${name}. The full rubric is in the output channel.`;
}

/**
 * Which rows the explainer may speak about, in reading order, capped.
 *
 * ELEVATED ROWS ONLY, and one finding each. A held row is below the bar by
 * policy and spending a model round on it would put prose where the card
 * deliberately puts none; a clean or blind row has no finding, and there is no
 * authorization to construct without one.
 */
export function explainableRows(
  card: Scorecard,
  policy: ElevationPolicy,
  cap: number = EXPLAIN_ROW_CAP,
): readonly ScorecardRow[] {
  const held = new Set<DimensionId>(policy?.held ?? []);
  return (card?.rows ?? [])
    .filter((row) => row.outcome.state === "flagged" && !held.has(row.dimension))
    .slice(0, Math.max(0, cap));
}

/**
 * Whether a blast-radius walk is worth running at all for this card.
 *
 * Only signature-level dimensions can carry a count, and only elevated rows are
 * read first. A card with no elevated signature-level row would spend a
 * call-hierarchy round trip on a number no row could display.
 */
export function wantsBlastRadius(card: Scorecard, policy: ElevationPolicy): boolean {
  return explainableRows(card, policy, Number.MAX_SAFE_INTEGER).some((row) =>
    signatureLevel(row.dimension),
  );
}

// ---------------------------------------------------------------------------
// Step 9: the proposal
//
// The card is already on the channel by the time any of this runs. What is left
// is the half that can reach a person's file, and every decision on the way to
// the consent gate lives here rather than in the `registerCommand` callback.
// ---------------------------------------------------------------------------

/**
 * The bytes the presenter is asked to replace, and the lines the planner reads.
 *
 * FROM THE DECLARATION HEAD, NEVER FROM `span.start`. The span is the WRITABLE
 * region and Python's Fork A moves its start past a leading docstring, so a
 * region built from it has no `def` in it at all: `param-count`,
 * `adjacent-params` and `undocumented` all fire ON the head line, and every one
 * of their comments would fall outside the replaced range and land nowhere.
 *
 * TWO WIDENINGS, both upward, both about lines rather than about the span:
 *
 *  1. To the head's OWN LINE START, across the indent. `headOffset` points at
 *     the `pub`, not at the four spaces before it, and the planner takes a
 *     comment's column off the line it sits above. A region that began at the
 *     head itself would hand it `pub fn ...` with no indent, and the head-line
 *     criticism would land at column 0 inside an impl block. The bytes crossed
 *     are whitespace and come back out unchanged, so the diff is untouched by
 *     it. Code in front of the head on the same line stops the walk: `} fn f()`
 *     is rare and eating half of it would be a rewrite nobody asked for.
 *  2. Over the run of THIS PRODUCT'S OWN comments directly above the head. A
 *     head-line comment planted by the last accept sits ABOVE the head, which is
 *     exactly where the next press's `headOffset` no longer reaches, so without
 *     this the strip pass never sees it and every head-line criticism doubles on
 *     every press. Idempotence is the ruled property ("run twice, accept both
 *     times, and the function has the same number of comments"), and it is a
 *     property of the REGION as much as of the planner.
 *
 * The walk commits only at a `C80 ` head, so a hand-written comment above the
 * declaration is never reached back over, and the marker is built from the same
 * `lineCommentFor` the planner strips with: a second answer to "what is a
 * comment in this language" is how the two passes start disagreeing about what
 * they are allowed to remove.
 *
 * Total. Nonsense offsets clamp rather than throw, because the caller is a
 * gesture a developer pressed.
 */
export interface InjectionRegion {
  /** Offset of the first byte the presenter would replace. */
  start: number;
  /** Offset one past the last, which is `span.end` clamped to the text. */
  end: number;
  /** 1-based document line of `lines[0]`, which is what the planner subtracts
   *  a finding's document line from. */
  startLine: number;
  /** The region's lines, `\r` already gone: the presenter re-applies the
   *  document's own EOL to whatever comes back. */
  lines: readonly string[];
}

export function injectionRegion(
  text: string,
  headOffset: number,
  end: number,
  languageId: string,
): InjectionRegion {
  const source = typeof text === "string" ? text : "";
  const to = clampOffset(end, source.length, source.length);
  const head = Math.min(clampOffset(headOffset, 0, source.length), to);
  const atLineStart = lineStartAt(source, head);
  // Whitespace only, or the head keeps the line to itself from where it stands.
  const start =
    source.slice(atLineStart, head).trim() === ""
      ? reachBackOverPlanted(source, atLineStart, lineCommentFor(languageId))
      : head;
  return {
    start,
    end: to,
    startLine: countNewlines(source, start) + 1,
    lines: source.slice(start, to).split(/\r?\n/),
  };
}

function clampOffset(value: unknown, fallback: number, limit: number): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : fallback;
  return Math.min(Math.max(n, 0), limit);
}

function lineStartAt(text: string, offset: number): number {
  const nl = text.lastIndexOf("\n", Math.max(offset - 1, 0));
  return offset === 0 || nl < 0 ? 0 : nl + 1;
}

function countNewlines(text: string, before: number): number {
  let count = 0;
  for (let i = 0; i < before; i++) {
    if (text[i] === "\n") {
      count++;
    }
  }
  return count;
}

/** The topmost line of the run of planted C80 comments immediately above
 *  `from`, or `from` when there is none. Continuation lines are walked over so a
 *  wrapped comment comes back whole, but the region only ever OPENS at a head:
 *  a continuation-shaped line with no head above it belongs to whoever wrote
 *  it. */
function reachBackOverPlanted(text: string, from: number, token: string): number {
  const marker = `${token} ${C80_TAG}`;
  const continuation = new RegExp(`^[ \\t]*${escapeForRegExp(token)} {4,}\\S`);
  let at = from;
  let top = from;
  while (at > 0 && text[at - 1] === "\n") {
    const lineStart = lineStartAt(text, at - 1);
    const line = text.slice(lineStart, at - 1).replace(/\r$/, "");
    if (line.trim().startsWith(marker)) {
      top = lineStart;
      at = lineStart;
      continue;
    }
    if (continuation.test(line)) {
      at = lineStart;
      continue;
    }
    break;
  }
  return top;
}

/** The token is `//` or `#` today. Written for the general case anyway, because
 *  the alternative is a regex that silently means something else the day a
 *  language arrives with a token that is not two slashes. */
function escapeForRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Whether there is a diff to show at all.
 *
 * `planted === 0 && stripped === 0` is NO PROPOSAL: no diff, no preview, no
 * toast. An empty diff tab is worse than no diff tab, and the card the developer
 * asked for is already on the channel.
 *
 * `planted === 0 && stripped > 0` IS a proposal, and collapsing the two loses a
 * real one: the criticism was addressed and the stale comments should come out.
 */
export function hasProposal(plan: { planted?: unknown; stripped?: unknown } | undefined | null): boolean {
  const planted = plan?.planted;
  const stripped = plan?.stripped;
  return (
    (typeof planted === "number" && Number.isInteger(planted) && planted > 0) ||
    (typeof stripped === "number" && Number.isInteger(stripped) && stripped > 0)
  );
}

/** The diff tab's name. It sits beside fn-gen's `<name>: generated body
 *  (preview)` and repair's, and a human with three tabs open has to be able to
 *  tell them apart by their titles alone. */
export function proposalTitle(name: string): string {
  return `${name}: rubric (preview)`;
}

/**
 * How many dimensions would put a comment in the file.
 *
 * ROWS, not findings: one dimension can fire several times on one function and
 * the offered line reports both numbers, so a reader can tell four comments
 * over one dimension from four over four. Held dimensions are not counted,
 * because a held dimension scores and stays out of the source.
 */
export function injectingDimensions(card: Scorecard | undefined, policy: ElevationPolicy): number {
  const held = new Set<DimensionId>(policy?.held ?? []);
  return (card?.rows ?? []).filter(
    (row) =>
      row.outcome.state === "flagged" &&
      !held.has(row.dimension) &&
      row.outcome.findings.length > 0,
  ).length;
}

/** `[critique] proposing 4 comments over 3 dimensions, stripping 2 stale
 *  comments`. Both halves of the count, because the strip is a change to the
 *  file the human is about to approve and a diff that only removes text needs a
 *  sentence saying why. */
export function proposalOfferedLine(
  plan: { planted: number; stripped: number },
  dimensions: number,
): string {
  return critiqueLine(
    `proposing ${plural(plan.planted, "comment")} over ${plural(dimensions, "dimension")}, ` +
      `stripping ${plural(plan.stripped, "stale comment")}`,
  );
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** The line the gesture ends on when there is nothing to show. It names the
 *  cause rather than the branch: a developer who pressed the gesture and got no
 *  diff has to be able to tell "nothing was above the bar" from "the proposal
 *  failed". */
export const NO_PROPOSAL_LINE = critiqueLine(
  "nothing to propose: no dimension above the bar plants a comment and the function carries no stale C80 comment, so no diff is offered",
);

/**
 * What the channel says once the human has answered, and WHY IT IS NOT FN-GEN'S.
 *
 * The presenter's outcome sink used to be typed as the whole `FnGenService`,
 * whose `logOutcome` writes `[fngen]` lines. Criticize logging through it would
 * put `[fngen] outcome=accept` on the channel for a gesture that generated
 * nothing, and - the part that costs more than the wording - fn-gen's
 * accept/reject evidence is MEASURED. Oracles match `outcome=` tokens whole, so
 * a second gesture's verdicts landing on those tokens do not confuse the reader,
 * they corrupt the number.
 *
 * THE OUTCOME TOKEN STANDS ALONE ON ITS LINE for the same reason fn-gen's does:
 * a reason suffixed onto it turns every whole-token match into a miss. A reject
 * carries who refused, because a bare `outcome=reject` leaves "the human said
 * no" and "the tab was closed" unknowable. It does NOT carry the offered text:
 * fn-gen logs that because the model's first line is the diagnostic, and here
 * the proposal is a deterministic function of a card the channel already holds.
 */
export function critiqueOutcomeLines(
  outcome: "accept" | "reject" | "discarded",
  detail?: { refusedBy: string; offered: string } | { discardedWhy?: string; discardedBecause?: string },
): readonly string[] {
  if (detail !== undefined && !("refusedBy" in detail)) {
    // BOTH HALVES OF THE REASON, because this gesture routes its pre-consent
    // discard away from the toast and the toast is where every other caller's
    // reason lives. Without the `discardedWhy` half the channel said
    // `outcome=discarded` and nothing else, and the sentence explaining it
    // existed only in a notification that names a different gesture.
    //
    // Escaped: `discardedBecause` is the one string on the path the product did
    // not author, and `appendLine` renders a break as a row.
    const reason = [detail.discardedWhy, detail.discardedBecause]
      .filter((part): part is string => typeof part === "string" && part.trim() !== "")
      .join(" — ");
    return reason === ""
      ? [critiqueLine(`outcome=${outcome}`)]
      : [critiqueLine(`discarded: ${escapeBreaks(reason)}`), critiqueLine(`outcome=${outcome}`)];
  }
  const suffix = detail === undefined ? "" : ` refused-by=${detail.refusedBy}`;
  return [critiqueLine(`outcome=${outcome}${suffix}`)];
}
