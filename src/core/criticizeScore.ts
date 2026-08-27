// ===========================================================================
// The scorecard: fifteen dimensions, every function, every time.
//
// A rubric enumerates its dimensions in advance and scores every function on
// all of them. That is what rescues determinism: the finding set stops being
// "whatever the model noticed this run" and becomes "how did this function
// score on dimension 4". Two scorings of unchanged bytes produce identical
// cards, and a test pins it.
//
// There is no composite score anywhere in this file, and adding one would be a
// contract change rather than a feature. A grade is a number a student
// optimises against, and the card is the deliverable rather than an internal
// signal, so the Goodhart risk would land on the human.
// ===========================================================================

import { ALTITUDE_DETECTORS } from "./criticizeAltitude";
import { CONTRACT_DETECTORS } from "./criticizeContract";
import { HONESTY_DETECTORS } from "./criticizeHonesty";
import { criticizeLangFor } from "./criticizeLang";
import { SAFETY_DETECTORS } from "./criticizeSafety";
import { SIGNATURE_DETECTORS } from "./criticizeSignature";
import {
  CriticizeLang,
  Detector,
  DimensionId,
  DimensionOutcome,
  FunctionUnderReview,
} from "./criticizeTypes";

/** Which half of the lineage a dimension serves, and the order the card is
 *  read in. The groups come from docs/perfect-functions.md and they are the
 *  reason a card scans: four questions about honesty, then four about the
 *  signature, then three about the contract, then three about altitude, then
 *  the one about failure. */
export type RubricGroup =
  | "honesty"
  | "signature-empathy"
  | "contract"
  | "altitude"
  | "safety";

/**
 * One dimension's answer for one function.
 *
 * Every dimension appears on every card. A dimension the language cannot
 * answer is `blind` with its reason, and a dimension that found nothing is
 * `clean`. Neither is ever absent, because an absent row and a clean row read
 * the same to a human and only one of them means the question was asked.
 */
export interface ScorecardRow {
  dimension: DimensionId;
  /** The dimension's own words: "reads the wall clock", "panics but the
   *  signature returns no Result". Fixed per dimension, never generated, so
   *  two runs cannot phrase the same finding two ways. */
  title: string;
  group: RubricGroup;
  /** The curriculum line from docs/perfect-functions.md. Naming the principle
   *  is the difference between a lint and a teacher. Never empty. */
  source: string;
  outcome: DimensionOutcome;
  /** True when this row is above the bar and should be read first. A
   *  convenience for a caller that already holds a card; the RENDERER
   *  recomputes it from the policy it is handed and never trusts this. */
  elevated: boolean;
  /** Call sites an honest fix would touch, when the caller walk ran and this
   *  dimension is signature-level. Absent otherwise, and absent never renders
   *  as zero. */
  blastRadius?: number;
  /** Prose about this row's findings, attached later by a model that saw ONE
   *  finding at a time. Optional always: a card with no explanation on any row
   *  is a complete card. Nothing downstream reads it except the renderer, and
   *  nothing ever parses it. */
  explanation?: string;
}

/**
 * One function's answers to the whole rubric.
 *
 * `headLine` is the only number on this object, and that is the strongest
 * available reading of "there is no composite score". A field that summarised
 * the rows as a number would be the grade the frame refuses.
 */
export interface Scorecard {
  name: string;
  languageId: string;
  /** 1-based document line of the declaration head. */
  headLine: number;
  rows: readonly ScorecardRow[];
}

/**
 * Which dimensions are scored but deliberately kept below the bar.
 *
 * A held dimension still runs, still records its findings, and still shows its
 * state on the card. It simply does not get read first. That is what lets a
 * ruling on a high-firing dimension move ONE array entry instead of a
 * rebuild, and it is why nothing in the renderer names a dimension id.
 */
export interface ElevationPolicy {
  held: readonly DimensionId[];
}

/**
 * What a caller-walk found, for one dimension.
 *
 * `callSites` is undefined when the walk did not run, was cancelled, or hit a
 * bound. Undefined stays undefined all the way to the text: "changing this
 * signature touches 0 call sites" is a claim the walk never made.
 */
export interface BlastRadiusInput {
  dimension: DimensionId;
  callSites: number | undefined;
}

/** The rubric, in reading order: honesty (1-4), signature empathy (5-8),
 *  contract (9-11), altitude (12, 13, 15), safety (14). The order is the
 *  group order of docs/perfect-functions.md and it is fixed, so two cards can
 *  be read side by side row for row. */
const RUBRIC: readonly { group: RubricGroup; detectors: readonly Detector[] }[] = [
  { group: "honesty", detectors: HONESTY_DETECTORS },
  { group: "signature-empathy", detectors: SIGNATURE_DETECTORS },
  { group: "contract", detectors: CONTRACT_DETECTORS },
  { group: "altitude", detectors: ALTITUDE_DETECTORS },
  { group: "safety", detectors: SAFETY_DETECTORS },
];

/** The dimension's own words, one fixed phrase each. A generated title would
 *  reintroduce exactly the run-to-run variance the rubric exists to remove. */
const TITLES: Record<DimensionId, string> = {
  clock: "reads the wall clock",
  prng: "draws from a global random generator",
  env: "reads the environment",
  world: "touches the filesystem",
  "adjacent-params": "two neighbouring parameters share one type",
  "bool-param": "takes a boolean parameter",
  "unused-param": "asks for a parameter the body never reads",
  "param-count": "asks the caller for a long parameter list",
  undocumented: "public and undocumented",
  "unenforced-precondition": "states a precondition it never enforces",
  cqs: "answers a question and changes the world",
  "pass-through": "passes straight through and adds no depth",
  nesting: "nests deeper than the reader can hold",
  "section-comment": "a section comment betrays mixed altitude",
  "unadmitted-failure": "can fail in a way the signature never admits",
};

/** The dimensions whose honest fix changes the SIGNATURE and therefore ripples
 *  to every caller: the four honesty legs, the four signature-empathy legs,
 *  and unadmitted failure. The other six are body-local, so a fix stays inside
 *  the function and a call-site count would be noise. */
const SIGNATURE_LEVEL: ReadonlySet<DimensionId> = new Set<DimensionId>([
  "clock",
  "prng",
  "env",
  "world",
  "adjacent-params",
  "bool-param",
  "unused-param",
  "param-count",
  "unadmitted-failure",
]);

/**
 * The shipped elevation policy, DERIVED from the detectors' own held flags
 * rather than written out by hand.
 *
 * A dimension ships held by setting one boolean where it is defined, next to
 * the measurement that justifies it, and this constant picks it up. Writing
 * the list here instead would let a detector claim it was held while the
 * policy silently elevated it. Today the derivation yields exactly
 * ["section-comment"], the dimension measured at 31.0% and awaiting a ruling
 * on whether that is a nit flood or a thing worth teaching.
 */
export const DEFAULT_ELEVATION: ElevationPolicy = {
  held: RUBRIC.flatMap((block) =>
    block.detectors.filter((d) => d.held === true).map((d) => d.dimension),
  ),
};

/**
 * True when the honest fix for this dimension changes the signature.
 *
 * The caller walk is only worth running, and a call-site count only worth
 * printing, where the fix reaches outside the function. This is the predicate
 * that decides which rows can carry a blast radius.
 */
export function signatureLevel(dimension: DimensionId): boolean {
  return SIGNATURE_LEVEL.has(dimension);
}

/**
 * The call-site count this row may carry, or undefined.
 *
 * Two things make it undefined and they are the same answer on the card: the
 * walk did not produce a number, or the dimension is body-local so the number
 * would describe nothing. Neither renders as zero.
 */
export function blastRadiusFor(input: BlastRadiusInput): number | undefined {
  if (input === null || typeof input !== "object") {
    return undefined;
  }
  if (!signatureLevel(input.dimension)) {
    return undefined;
  }
  return input.callSites;
}

/**
 * Runs the whole rubric over one function and assembles its card.
 *
 * Synchronous and pure: no model call, no I/O, no clock. That is the property
 * the reframe rests on, and it is why the same bytes score the same way twice.
 *
 * `lang` may be omitted, in which case it is looked up from the unit's own
 * languageId. An unregistered language does not throw and does not return a
 * short card: it returns all fifteen rows as `blind`, each naming the
 * language. A missing card and a clean card read the same to a human, and only
 * one of them means the question was asked.
 *
 * `callSites` is the caller walk's result, when one ran. It lands only on
 * signature-level rows, because those are the only ones a call-site count
 * describes.
 */
export function scoreFunction(
  fn: FunctionUnderReview,
  lang?: CriticizeLang,
  policy: ElevationPolicy = DEFAULT_ELEVATION,
  callSites?: number,
): Scorecard {
  const profile = lang ?? criticizeLangFor(fn.languageId);
  const held = new Set(policy.held);
  const rows: ScorecardRow[] = [];

  for (const block of RUBRIC) {
    for (const detector of block.detectors) {
      const outcome: DimensionOutcome =
        profile === undefined
          ? unregistered(fn.languageId)
          : detector.run(fn, profile);
      const row: ScorecardRow = {
        dimension: detector.dimension,
        title: TITLES[detector.dimension],
        group: block.group,
        source: detector.source,
        outcome,
        elevated: outcome.state === "flagged" && !held.has(detector.dimension),
      };
      const radius = blastRadiusFor({ dimension: detector.dimension, callSites });
      if (radius !== undefined) {
        row.blastRadius = radius;
      }
      rows.push(row);
    }
  }

  return {
    name: fn.name,
    languageId: fn.languageId,
    headLine: fn.startLine + fn.headIndex,
    rows,
  };
}

/** The refusal every row carries when no profile is registered. It names the
 *  language, because "this language has no tables here" is a fact the reader
 *  can act on and "clean" is a lie. */
function unregistered(languageId: string): DimensionOutcome {
  return {
    state: "blind",
    reason: `Criticize has no rubric tables for ${languageId}, so nothing here examined this function`,
  };
}
