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
