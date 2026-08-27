// ===========================================================================
// The card, as text.
//
// One output serves two readers. The student reads the whole rubric and learns
// which of fifteen questions this function answers badly; the professional
// reads the elevated rows and stops. It is one gesture and one artefact, not
// two, because two would drift.
//
// Everything here is a pure function of the card and the policy. The same card
// rendered twice is byte-identical, and that is the property the whole reframe
// rests on.
// ===========================================================================

import { criticizeLangFor } from "./criticizeLang";
import { DimensionId } from "./criticizeTypes";
import { ElevationPolicy, Scorecard, ScorecardRow } from "./criticizeScore";

/** The exact wording for a card with nothing above the bar. It is a ruled
 *  constant: the pass may report that it found nothing, and it may never
 *  deliver a verdict on the function. "Is clean" and "looks correct" are
 *  claims this pass has no instrument for. */
const NOTHING_ELEVATED = "this pass found nothing above the evidence bar.";

/** The last non-empty line of every card, without exception. It bounds the
 *  wording of everything above it: no row, no count and no explanation may
 *  claim more than this sentence allows.
 *
 *  EXPORTED so the VS Code tier can wait for the end of a card and assert on
 *  it without keeping a copy. A retyped copy in a test is a second source of
 *  truth for a ruled constant, and it goes on passing after the wording moves. */
export const HONEST_CONTRACT =
  "It finds what the repo's oracles can witness, plus concretely-instanced advice. It does not certify correctness.";

/** Column the roster's state text starts at. `unenforced-precondition` is the
 *  longest dimension id at 23 characters, so 25 leaves a two-space gutter and
 *  the states line up into a column a reader can scan down. */
const ROSTER_WIDTH = 25;

/** Indents. The card is read in a terminal panel, so structure is carried by
 *  two levels of leading space and nothing else. A leading `+` or `-` is
 *  avoided everywhere: a diff-shaped line reads as a patch, and this pass
 *  advises and never patches. */
const ROW_INDENT = "  ";
const DETAIL_INDENT = "    ";

/**
 * The card as the reader sees it.
 *
 * Elevation is RECOMPUTED here from `policy`, and `row.elevated` is not
 * consulted. A card scored under the default and rendered under a ruling comes
 * out ruled without being re-scored, which is what makes a ruling on a held
 * dimension one array entry rather than a rebuild. The renderer never names a
 * dimension id; the policy is the only thing that decides.
 */
export function renderScorecard(card: Scorecard, policy: ElevationPolicy): string {
  const held = new Set<DimensionId>(policy?.held ?? []);
  const rows = card.rows ?? [];
  const elevated = rows.filter((row) => isElevated(row, held));

  const out: string[] = [];
  out.push(heading(card));
  out.push("");
  out.push("Above the evidence bar");
  if (elevated.length === 0) {
    out.push(`${ROW_INDENT}${NOTHING_ELEVATED}`);
  } else {
    for (const row of elevated) {
      out.push(...elevatedBlock(row));
    }
  }
  out.push("");
  out.push("The rubric, all fifteen dimensions");
  for (const row of rows) {
    out.push(...rosterLines(row, held));
  }
  out.push("");
  out.push(HONEST_CONTRACT);
  return `${out.join("\n")}\n`;
}

/** Flagged, and not held by the policy. Nothing else moves a row above the
 *  bar: `blind` is a refusal and a refusal is not a finding, and `clean` is
 *  the absence of one. */
function isElevated(row: ScorecardRow, held: ReadonlySet<DimensionId>): boolean {
  return row.outcome.state === "flagged" && !held.has(row.dimension);
}

/** The one line that says which function this is, in which language, and where
 *  its declaration sits. `headLine` is the only number a card carries. */
function heading(card: Scorecard): string {
  const profile = criticizeLangFor(card.languageId);
  const language = profile === undefined ? card.languageId : profile.displayName;
  return `Criticize rubric for ${card.name} (${language}), declared at line ${card.headLine}.`;
}

/**
 * An elevated row: its title, its curriculum line, and one evidence line per
 * finding.
 *
 * The evidence lines are what mark a row elevated in the TEXT. A row below the
 * bar renders its state and never its evidence, so a reader who sees a quoted
 * line knows without being told that the pass is asking them to look.
 */
function elevatedBlock(row: ScorecardRow): string[] {
  const out: string[] = [];
  out.push(`${ROW_INDENT}${row.title} (${row.dimension}, ${row.group})`);
  out.push(`${DETAIL_INDENT}${row.source}`);
  if (row.outcome.state === "flagged") {
    for (const finding of row.outcome.findings) {
      out.push(`${DETAIL_INDENT}line ${finding.line}  ${finding.evidence}  ${finding.detail}`);
    }
  }
  const blast = blastLine(row);
  if (blast !== undefined) {
    out.push(`${DETAIL_INDENT}${blast}`);
  }
  if (row.explanation !== undefined && row.explanation.trim() !== "") {
    out.push(`${DETAIL_INDENT}${row.explanation.trim()}`);
  }
  return out;
}

/** What an honest fix would reach, when the caller walk produced a number.
 *  Undefined produces NO line at all: not the words, not a zero. "Touches 0
 *  call sites" is a claim the walk never made, and a reader cannot tell a
 *  measured zero from an unmeasured one.
 *
 *  A walk that RAN and found none says so in words rather than in a digit, for
 *  the same reason: the two states must not share a spelling. */
function blastLine(row: ScorecardRow): string | undefined {
  if (row.blastRadius === undefined) {
    return undefined;
  }
  if (row.blastRadius === 0) {
    return "the caller walk found no call sites for this function";
  }
  const noun = row.blastRadius === 1 ? "call site" : "call sites";
  return `an honest fix to this signature reaches ${row.blastRadius} ${noun}`;
}

/** One roster line per dimension, so the reader can count fifteen and see that
 *  every question was asked. A blind row spends a second line on its reason,
 *  because a refusal that does not say why is indistinguishable from a shrug. */
function rosterLines(row: ScorecardRow, held: ReadonlySet<DimensionId>): string[] {
  const label = row.dimension.padEnd(ROSTER_WIDTH, " ");
  const out = [`${ROW_INDENT}${label}${stateWords(row, held)}`];
  if (row.outcome.state === "blind") {
    out.push(`${DETAIL_INDENT}${row.outcome.reason}`);
  }
  // Prose is NEVER rendered here, and the reason is the one-way door rather
  // than layout. Only a flagged row has a finding for a model to have been
  // authorized against, so prose on a clean or blind row could only have come
  // from somewhere that is not a detector. `attachExplanations` will not put it
  // there, and this function will not print it if anything else does: the last
  // gate before the developer's eyes must not be the place that performs the
  // forbidden thing. A refusal that gets talked over is a refusal reversed.
  return out;
}

/** The row's state in the roster. A flagged row that the policy holds says so,
 *  because "flagged" with no evidence above would otherwise look like the card
 *  lost it. */
function stateWords(row: ScorecardRow, held: ReadonlySet<DimensionId>): string {
  if (row.outcome.state === "blind") {
    return "blind, and it says why";
  }
  if (row.outcome.state === "clean") {
    return "clean";
  }
  const count = row.outcome.findings.length;
  const noun = count === 1 ? "finding" : "findings";
  return held.has(row.dimension)
    ? `flagged, ${count} ${noun}, held below the bar by policy`
    : `flagged, ${count} ${noun}, above the bar`;
}
