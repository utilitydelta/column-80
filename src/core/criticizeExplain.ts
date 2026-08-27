// ===========================================================================
// The explainer, and the one-way door.
//
// THE RULE, STATED ONCE: the model never decides WHAT the findings are. The
// detectors do. The model's only job is to explain a detector's finding in the
// developer's terms.
//
// Session-v60 let a model decide a function's finding set and measured 0 of 3
// identical sets on unchanged bytes at temperature 0; the v61 scout then proved
// every stability mechanism is the same dial with recall as its currency, so
// buying determinism there is always paid for in silence. This module escapes
// the dial instead of paying it: instability is confined to WORDING, which
// nobody was ever promised determinism about.
//
// Every guard below is STRUCTURAL rather than conventional, because a
// convention is a thing a later session can forget:
//
//   - `explainFinding` returns a `Promise<string>`. The return type has
//     NOWHERE to put a finding, and that is the enforcement.
//   - `attachExplanations` iterates ROWS and never the map, so an entry keyed
//     to a finding no detector produced is unreachable by construction.
//   - The prompt carries ONE finding. A model that cannot see the rest of the
//     function cannot rank it, cannot count defects in it, and cannot decide
//     anything about it.
//
// If the explainer can add a finding, the reframe is undone and v61 has
// shipped the thing v60 refused twice, wearing a detector's clothes.
//
// Never imports vscode (the src/core rule). Nothing here reads a clock or a
// filesystem, and `attachExplanations` is pure.
// ===========================================================================

import { ScorecardRow } from "./criticizeScore";
import { DetectorFinding } from "./criticizeTypes";

/**
 * How many lines of prose a row will accept.
 *
 * CHOSEN, not measured, and recorded as chosen in docs/constants.md. A model
 * handed one finding still cannot add a row, but it can mislead in the slot it
 * was given: a long enough paragraph has room to CLAIM a second defect, and a
 * reader has no way to tell that claim from a detector's. Four lines is enough
 * to name a principle, say why it exists, and say what the flagged line does
 * about it. It is not enough to hide a second verdict in.
 *
 * A bound that admits a page is not a bound.
 */
export const EXPLANATION_MAX_LINES = 4;

/**
 * Authorization to explain exactly ONE detector finding.
 *
 * There is no constructor that does not start from a finding the detectors
 * produced, and every construction site is findable by grepping for
 * `ExplainAuthorization`, the way `TestRepairAuthorization` is findable today.
 *
 * Both fields are REQUIRED and plain. A conditional spread is invisible to tsc
 * (v58's lesson), and this is the guard that decides whether a model gets to
 * speak at all.
 */
export interface ExplainAuthorization {
  /** The one finding this call may speak about. The explainer sees no other,
   *  and no LIST of findings is ever handed to a model. */
  finding: DetectorFinding;
  /** The dimension's curriculum line, so the prose can name the principle
   *  rather than restate the lint. */
  source: string;
}

/**
 * The seam to whatever is asking a model, and deliberately the narrowest one
 * available: a prompt in, prose out.
 *
 * It cannot return a finding, a row, a score or a patch, because a string is
 * the only thing on the other side of it. A richer transport type would be the
 * first crack in the door.
 */
export type ExplainTransport = (prompt: string) => Promise<string>;

/** Separator between the key's two parts. A colon, because a `DimensionId` is
 *  a hyphenated lower-case identifier and can never contain one. */
const KEY_SEPARATOR = ":";

/**
 * The map key for one finding: `${dimension}:${line}`.
 *
 * Stable on unchanged bytes, because both halves are functions of the CODE
 * rather than of a sampling run. Evidence and detail are deliberately not in
 * it: a detector that improves its own wording must not orphan the prose that
 * was written about the same line.
 *
 * Keys are only ever GENERATED from a finding, never parsed back. That is what
 * makes `cqs:014` and `cqs: 14` unreachable rather than cleverly tolerated: a
 * lenient parser is a second way onto a card.
 */
export function findingKey(finding: DetectorFinding): string {
  return `${finding.dimension}${KEY_SEPARATOR}${finding.line}`;
}

/**
 * Prose the card will accept, or undefined.
 *
 * DROPPING IS THE SAFE DIRECTION. A row that loses its explanation still ships
 * its title, its curriculum line and its evidence: the channel says less
 * prettily what it already knows. A row that keeps unbounded prose ships a
 * claim nothing witnessed.
 *
 * Three things are dropped: a non-string (a transport that answered with
 * something else), prose that is empty or whitespace-only (a model that never
 * really spoke), and prose over `EXPLANATION_MAX_LINES`.
 */
function admissible(prose: unknown): string | undefined {
  if (typeof prose !== "string") {
    return undefined;
  }
  const trimmed = prose.trim();
  if (trimmed === "") {
    return undefined;
  }
  if (trimmed.split(/\r?\n/).length > EXPLANATION_MAX_LINES) {
    return undefined;
  }
  return trimmed;
}

/**
 * Attaches prose to rows the DETECTORS produced.
 *
 * ITERATES ROWS, NEVER THE MAP. That single choice is the door: an entry in
 * `prose` whose key matches no finding on any row is unreachable, so a model
 * that invents a finding cannot get it onto a card no matter what the caller
 * does with the text. There is no branch here that can create a row, delete
 * one, reorder them, touch an `outcome`, or move `elevated`.
 *
 * The bound is applied HERE as well as in `explainFinding`, because a prose map
 * can be built by any caller and the last gate before a row is where a
 * structural guard belongs.
 *
 * Pure: the input rows are never mutated, and a row that gains no prose is
 * copied through unchanged rather than rebuilt with an `explanation: undefined`
 * key that would make two equal cards compare unequal.
 */
export function attachExplanations(
  rows: readonly ScorecardRow[],
  prose: ReadonlyMap<string, string>,
): readonly ScorecardRow[] {
  const source = rows ?? [];
  if (prose === undefined || prose === null || prose.size === 0) {
    return source.slice();
  }
  return source.map((row) => {
    const text = proseForRow(row, prose);
    return text === undefined ? row : { ...row, explanation: text };
  });
}

/**
 * The one explanation this row may carry, or undefined.
 *
 * A row has ONE slot and a flagged row may carry several findings, so the
 * FIRST finding with admissible prose wins and the rest are ignored. Joining
 * them was the other reading and it is worse: a second finding's paragraph
 * could push the total past the bound and silently evict the first one's, which
 * makes the drop depend on something the reader cannot see.
 *
 * A row that is not flagged carries no findings, so nothing can key to it. That
 * is why a key aimed at a clean or blind row is unreachable, and why a blind
 * row's refusal cannot be talked over.
 */
function proseForRow(
  row: ScorecardRow,
  prose: ReadonlyMap<string, string>,
): string | undefined {
  if (row === null || typeof row !== "object" || row.outcome?.state !== "flagged") {
    return undefined;
  }
  for (const finding of row.outcome.findings) {
    const text = admissible(prose.get(findingKey(finding)));
    if (text !== undefined) {
      return text;
    }
  }
  return undefined;
}

/** What the model is told its job is. Explain, in the developer's terms; never
 *  judge, never search, never enumerate. The instruction says "the ONE finding
 *  below" because a model asked to be thorough will otherwise go looking, and
 *  looking is the behaviour this whole design removed. */
const INSTRUCTION = [
  "You are explaining ONE finding from a code-review rubric to the developer who wrote the code.",
  "A static detector found it. You are not looking for defects and you are not judging the function:",
  "the finding below is settled, and your only job is to make it land.",
  "",
  "Say why the named principle exists and what the flagged line does about it, in the developer's terms.",
  "Naming the principle is the point. \"line 14 mutates and returns\" is a lint;",
  "\"this violates command-query separation, Meyer 1988: a function answers a question or changes the world,",
  "never both\" is teaching.",
].join("\n");

/** The bounds the prose itself must respect, stated to the model so the common
 *  case is a kept explanation rather than a dropped one. The drop still stands
 *  behind this: an instruction is a request, and the guard is the enforcement. */
const BOUNDS = [
  `Answer in at most ${EXPLANATION_MAX_LINES} lines of plain prose.`,
  "Do not mention any other defect, do not look for one, and do not suggest a fix or write code:",
  "this pass advises and never patches. Do not restate the line; explain the principle it breaks.",
].join("\n");

/**
 * The prompt for one finding, and NOTHING else.
 *
 * It carries the evidence line, the dimension's own words, and the curriculum
 * line. It does not carry the function, the other findings, or the card. That
 * omission is the load-bearing part: a model that cannot see the rest of the
 * function cannot rank it, cannot count defects in it, and cannot decide
 * anything about it. Widening this prompt is how the door reopens.
 *
 * The dimension's words are taken from the finding itself rather than from a
 * separate title field, because a third field on the authorization is a third
 * thing a call site can get wrong while still type-checking.
 */
export function buildExplainPrompt(auth: ExplainAuthorization): string {
  const finding = auth.finding;
  return [
    INSTRUCTION,
    "",
    `Dimension: ${finding.dimension}`,
    `What the detector says fired: ${finding.detail}`,
    `The principle: ${auth.source}`,
    `The line, at document line ${finding.line}:`,
    `    ${finding.evidence}`,
    "",
    BOUNDS,
  ].join("\n");
}

/**
 * Prose about one finding.
 *
 * THE RETURN TYPE HAS NOWHERE TO PUT A FINDING, and that is the enforcement.
 * Whatever the model writes, it comes back as a string that some caller may put
 * in one row's explanation slot, and it can reach nothing else.
 *
 * The transport is called EXACTLY ONCE. No ensemble, no best-of, and no
 * retry-for-agreement: the v61 scout proved every stability mechanism is one
 * dial with recall as its currency, and a second call is paying it for wording
 * nobody was promised determinism about.
 *
 * A transport that FAILS returns the empty string, not an exception.
 * DEGRADATION IS A SHIPPED STATE: the model being unavailable must leave the
 * card intact and unexplained rather than force every call site to decide what
 * a failure means. Inventing prose when the model never spoke is the one thing
 * forbidden here, and the empty string is how "it never spoke" is spelled.
 *
 * A CANCELLATION is not a failure and is rethrown. The developer pressing
 * escape is an instruction, not an outage, and swallowing it here would spell
 * "you stopped me" with the same value as "the model said nothing usable" -
 * two different events the gesture has to tell apart, because one of them
 * gets a toast and the other does not.
 */
export async function explainFinding(
  auth: ExplainAuthorization,
  transport: ExplainTransport,
): Promise<string> {
  let answer: unknown;
  try {
    answer = await transport(buildExplainPrompt(auth));
  } catch (err) {
    if (isCancellation(err)) {
      throw err;
    }
    return "";
  }
  return admissible(answer) ?? "";
}

/** VS Code spells a cancellation `CancellationError`, and its own thrown
 *  instances carry the name `Canceled`. Matched on the name rather than on the
 *  class, because `src/core` never imports vscode. */
function isCancellation(err: unknown): boolean {
  if (typeof err !== "object" || err === null) {
    return false;
  }
  const name = (err as { name?: unknown }).name;
  return name === "Canceled" || name === "CancellationError" || name === "AbortError";
}
