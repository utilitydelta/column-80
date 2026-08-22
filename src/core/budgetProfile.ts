// The derivation seam for the fn-gen injection path's tuning constants; the
// contract it was built to is in docs/constants.md, "The derivation seam's
// contract". Every number here was inherited from a
// local-30B tuning pass and now also gates cloud models, so the constants
// become derivations of (model class, language) with IDENTITY defaults: at the
// shipped values every derived number equals the constant it replaced, and a
// replayed generation produces a byte-identical prompt.
//
// NOTHING on the FIM path reads this module. The FIM deadline family, the
// per-language type caps (PREFILL_TYPE_CAP / GO_PREFILL_TYPE_CAP), the resolve
// and provenance caps, MAX_BOUND_LINES and REFINE_TARGET_CAP are deliberate
// exceptions: they spend latency or defend product bars, not prompt budget,
// and stay where they are.

import { CLOUD_PROVIDERS, OPENAI_COMPATIBLE } from "./cloudInstruct";

/** The three serving classes the tuning table is keyed on. `fim-small` is the
 *  shipped 1.5b FIM family; `local-mid` is any other local model (the 30b
 *  fn-gen default); `frontier` is a cloud backend. */
export type ModelClass = "fim-small" | "local-mid" | "frontier";

// Every provider that runs a frontier-class model: the preset cloud table,
// the bring-your-own-endpoint escape hatch, and Claude Code. The last one is
// the literal "claude-code" rather than claudeCodeInstruct's CLAUDE_CODE
// because that module imports this one for its timeout default and the import
// back would be a cycle; the unit suite pins the literal against the constant.
const FRONTIER_PROVIDERS = new Set(["claude-code", OPENAI_COMPATIBLE, ...Object.keys(CLOUD_PROVIDERS)]);

/** The shipped FIM model family, as a tag PREFIX: the -base / -instruct /
 *  quantization suffixes are all the same 1.5b class. */
const FIM_TAG_FAMILY = "qwen2.5-coder:1.5b";

/** Does this provider name mean anything to the product? False routes the
 *  caller to the conservative class below, and the caller owes the channel a
 *  line saying so - this module is pure and cannot log. */
export function providerKnown(provider: string): boolean {
  const p = String(provider ?? "").trim().toLowerCase();
  return p === "" || p === "ollama" || FRONTIER_PROVIDERS.has(p);
}

/** The serving class of a (provider, model tag) pair. Pure and total: any
 *  input resolves, nothing throws. A named cloud provider is `frontier`
 *  whatever the tag says; ollama (and the empty/default provider) resolves by
 *  tag; an unknown provider is `local-mid` - conservative, never `frontier`,
 *  because the frontier cells will one day carry bigger budgets and an
 *  unknown backend must not inherit them by accident. */
export function modelClassFor(provider: string, modelTag: string): ModelClass {
  const p = String(provider ?? "").trim().toLowerCase();
  if (FRONTIER_PROVIDERS.has(p)) {
    return "frontier";
  }
  const tag = String(modelTag ?? "").trim().toLowerCase();
  if (p === "" || p === "ollama") {
    return tag.startsWith(FIM_TAG_FAMILY) ? "fim-small" : "local-mid";
  }
  return "local-mid";
}

// ---------------------------------------------------------------------------
// The base budget and its C# factor. Moved here from fnGen.ts so the profile
// and the walk cannot drift; fnGen.ts imports them back.
// ---------------------------------------------------------------------------

// The AGGREGATE data-shape budget across ALL per-type walks in ONE prefill -
// the `surfaceBudgetTok` every derived value below hangs off.
//
// THE NAME IS LOAD-BEARING: the measurement rig patches the bundled
// `var DATASHAPE_TOTAL_TOK = 300;` to run budget arms (lib-core's
// loadPrefillBudget), and review-v45-p3 R4/R4b pin that exact pattern and its
// uniqueness. Rename it and every budget ladder silently measures the shipped
// value.
export const DATASHAPE_TOTAL_TOK = 300;

/**
 * C#'s own aggregate budget, as a FACTOR of the rig knob.
 *
 * PER-LANGUAGE because the funnel says so. Measured over 465 authored-doc C#
 * rows, four arms, one knob at a time: raising the TYPE CAP from 4 to 8 takes
 * types-that-got-a-slot from 47.8% to 92.6% and injection from 16.4% to only
 * 20.2% - the cap fix just relocates the wall. Raising this budget instead
 * takes injection from 16.4% to 31.6%; both together, 38.8%. The reason is a
 * language fact, not a tuning accident: a Roslyn member list per type is far
 * larger than a Go hover or a Rust def, so C# exhausts a shared TOKEN budget
 * long before it exhausts a SLOT count.
 *
 * Still 1 because the only thing behind the shipped 300 is a ~350-token
 * codegen knee inherited from external literature, and an inherited threshold
 * cannot overrule a measured funnel - the generation arm picks the number, a
 * one-line change once it has.
 *
 * A FACTOR, NOT AN ABSOLUTE and not a `=== 300` sentinel: the knob patch must
 * keep reaching C# (knob 900 x factor 1 = 900), and every ladder rung must
 * stay expressible including the 300 baseline (knob 100 x factor 3 = 300).
 * The sentinel form cannot tell UNPATCHED from PATCHED-TO-300; the record is
 * review-v45-p3 R5.
 */
export const CS_BUDGET_FACTOR = 1;
export const CS_DATASHAPE_TOTAL_TOK = DATASHAPE_TOTAL_TOK * CS_BUDGET_FACTOR;

// ---------------------------------------------------------------------------
// The context dial.
//
// THE TRAP THIS TABLE EXISTS TO AVOID: three of the four numbers make the
// fourth inert. Measured before the build, against the shipped `walkDataShape`
// on a 40-wide synthetic type graph at depth 2 - raising breadth alone from 4
// to 48 with the total-type cap at 6 and the render budget at 200 produced a
// BYTE-IDENTICAL 791-char block at every rung, and so did raising breadth AND
// the total together with the budget pinned. Only all four moving together
// moved the block (791 -> 1577 -> 3191 -> 6392 -> 10648 chars). A stop that
// moves fewer than four numbers is a setting that does nothing.
// ---------------------------------------------------------------------------

// How many ROOT candidate types one pre-fill may INJECT, at the pre-dial point.
//
// THE NAME IS LOAD-BEARING, exactly as DATASHAPE_TOTAL_TOK's is: the
// measurement rig patches the bundled `var PREFILL_TYPE_CAP = 4;` to run cap
// arms (lib-core's loadPrefillCap / loadPrefillCapBudget). It moved here from
// fnGen.ts so the `shipped` row below can be spelled in terms of it rather
// than duplicating its value; the emitted bundle text is unchanged.
export const PREFILL_TYPE_CAP = 4;
// How many candidates the admission loop may RESOLVE, at the pre-dial point.
// Spends language-server round trips, not prompt bytes.
export const PREFILL_RESOLVE_CAP = 8;
// How many candidates may be PROVENANCE-CHECKED, at the pre-dial point. One
// `definition()` round trip each, the cheapest of the three.
export const PREFILL_PROVENANCE_CAP = 24;

/** The stops of the `column80.injectedContext` dial, plus the internal
 *  `shipped` pre-dial point. `shipped` is NOT offered in
 *  `contributes.configuration` and no setting value resolves to it: it exists
 *  so the rig and the suite can render the before-side of a phase-1b arm, and
 *  so the rig's textual patch sites still reach a live prompt. */
export type ContextStop = "shipped" | "small" | "medium" | "large" | "frontier";

/** The four the setting offers, in the order package.json lists them. */
export const INJECTED_CONTEXT_STOPS = ["small", "medium", "large", "frontier"] as const;

/** The install default, and the value every unreadable/unrecognised setting
 *  resolves to. `small` rather than `medium` because the developer most likely
 *  to be hurt by the ~350-token codegen knee is the one who never touches the
 *  setting. */
export const DEFAULT_CONTEXT_STOP: ContextStop = "small";

/** The structural half of one stop. Depth is here and is deliberately NOT a
 *  dial: 2 at every stop, because deeper describes infrastructure the function
 *  never touches. */
export interface ContextBounds {
  /** Graph distance from the root the data-shape walk may follow. */
  depth: number;
  /** Distinct LOCAL field-types followed per node. */
  breadth: number;
  /** Total distinct types one walk may emit. */
  totalTypes: number;
  /** How many ROOT candidates get walked at all. */
  rootCap: number;
  /** How many candidates may be RESOLVED to fill those roots. */
  resolveCap: number;
  /** How many candidates may be PROVENANCE-CHECKED. */
  provenanceCap: number;
  /** The aggregate data-shape render budget, in tokens. */
  surfaceBudgetTok: number;
}

// Roots, breadth, total types and budget are the goal's four. Resolve cap and
// provenance cap are a fifth and sixth that HAD to move with them: a root
// beyond the resolve cap can never be injected, because a type that was never
// resolved has no surface, so a 16-root stop against the shipped resolve cap
// of 8 would be inert above 8. They spend language-server round trips rather
// than prompt bytes, so they are per-stop judgment calls rather than
// derivations of the root count.
//
// Total types leads breadth on purpose: it caps TOTAL distinct types, so eight
// roots against a total of twelve would strangle breadth before it started.
// Roughly three times the root count gives breadth somewhere to go.
//
// EVERY NUMBER BELOW EXCEPT THE `shipped` ROW IS A JUDGMENT CALL with its
// reasoning in docs/constants.md, "Why the context stop is a dial and not a
// measured constant", not a measured optimum. There are hundreds
// of models a developer might point this at and no measured curve generalises
// across that space, which is why this is a dial rather than a constant.
const CONTEXT_STOP_TABLE: Readonly<Record<ContextStop, ContextBounds>> = {
  shipped: {
    depth: 2,
    breadth: 4,
    totalTypes: 6,
    rootCap: PREFILL_TYPE_CAP,
    resolveCap: PREFILL_RESOLVE_CAP,
    provenanceCap: PREFILL_PROVENANCE_CAP,
    surfaceBudgetTok: DATASHAPE_TOTAL_TOK,
  },
  small: { depth: 2, breadth: 6, totalTypes: 24, rootCap: 8, resolveCap: 16, provenanceCap: 24, surfaceBudgetTok: 600 },
  medium: { depth: 2, breadth: 12, totalTypes: 48, rootCap: 8, resolveCap: 16, provenanceCap: 24, surfaceBudgetTok: 1200 },
  large: { depth: 2, breadth: 24, totalTypes: 96, rootCap: 12, resolveCap: 24, provenanceCap: 36, surfaceBudgetTok: 2400 },
  frontier: { depth: 2, breadth: 48, totalTypes: 192, rootCap: 16, resolveCap: 32, provenanceCap: 48, surfaceBudgetTok: 4000 },
};

/** One stop's structural bounds. Pure and total: an unrecognised stop (a
 *  hand-edited settings.json that got past the resolver) answers with the
 *  default rather than throwing. */
export function contextBoundsFor(stop: ContextStop): ContextBounds {
  return CONTEXT_STOP_TABLE[stop] ?? CONTEXT_STOP_TABLE[DEFAULT_CONTEXT_STOP];
}

// ---------------------------------------------------------------------------
// Deriveds: declared fractions of surfaceBudgetTok, not free-floating
// constants. Each fraction is written as (identity value / identity budget)
// so the provenance of the shipped number stays visible, and moving a cell's
// surfaceBudgetTok moves the deriveds with it.
// ---------------------------------------------------------------------------

/** Per-type member cap: 24 members per 300 budget tokens. */
export const memberCapFor = (surfaceBudgetTok: number): number => Math.round((surfaceBudgetTok * 24) / 300);

/** Distinct repair surfaces per round: 4 per 300 budget tokens. */
export const surfaceCapFor = (surfaceBudgetTok: number): number => Math.round((surfaceBudgetTok * 4) / 300);

/** The refine/usage-window char ceiling: 8 chars per budget token (2400 at
 *  identity - twice the whole-block injection's 1200, see oracleSurface). */
export const refineTotalCharsFor = (surfaceBudgetTok: number): number => Math.round(surfaceBudgetTok * 8);

/** One data-shape walk's own token bound: two thirds of the aggregate, so a
 *  single wide type can never spend the whole prompt's shape budget. */
export const walkTokMaxFor = (surfaceBudgetTok: number): number => Math.round((surfaceBudgetTok * 2) / 3);

// Transport ceilings. Not fractions of the budget - they bound the REPLY and
// the window, not the injected surface - but they live in the same table
// because they were tuned against the same local 30B and phase 4's arms move
// them per class.
/** num_predict for one generated function body, LOCAL classes. Enough for a
 *  function and no more: a local 30B writes the body and stops, and the number
 *  is bounded from above by `GEN_NUM_CTX`, which this shares with the prompt. */
export const GEN_MAX_TOKENS = 2048;

/** The same ceiling for the FRONTIER class, and it is 16x the local one for a
 *  reason that has nothing to do with longer answers.
 *
 *  On Claude Opus 5, Sonnet 5 and Fable 5, omitting the `thinking` parameter
 *  runs ADAPTIVE THINKING - a change from Opus 4.8 and 4.7, where omitting it
 *  meant no thinking at all. `max_tokens` is a hard cap on thinking PLUS
 *  response text, so a 2048 ceiling inherited from a local model with no
 *  reasoning budget is spent before the model starts answering. The transport
 *  reports that as `stop_reason: "max_tokens"`, which this codebase maps to
 *  "length" and the service rejects as a truncated generation. The failure is
 *  a hard error on most non-trivial functions, not a degraded answer.
 *
 *  Unused output tokens are not billed, so a generous ceiling costs nothing;
 *  what it buys is room for the model to think. Streaming is already on for the
 *  native transport, so the SDK's non-streaming timeout does not bind. Well
 *  under the 128k output ceiling every current frontier model carries. */
export const FRONTIER_MAX_TOKENS = 64000;

/** `maxTokens` by serving class. The flat constant was measured against a local
 *  30B and then applied to every backend, frontier included; that is the
 *  inherited-constant hazard this table exists to end. */
const MAX_TOKENS_BY_CLASS: Readonly<Record<ModelClass, number>> = {
  "fim-small": GEN_MAX_TOKENS,
  "local-mid": GEN_MAX_TOKENS,
  frontier: FRONTIER_MAX_TOKENS,
};
/** Ollama context window for prompt AND generation together; meaningful for
 *  the local classes only. Must clear the largest prompt plus testMaxTokens. */
export const GEN_NUM_CTX = 16384;
/** Hard cap on one claude-code CLI child; the other transports carry their
 *  own socket timeouts. Generous against a measured 15.2s realistic round. */
export const GEN_TIMEOUT_MS = 120_000;

/** What one (class, language, stop) cell serves. Every field always present;
 *  numCtx only means anything to a local class and timeoutMs only to the
 *  claude-code transport, but a uniform shape keeps every consumer total.
 *
 *  The structural half (`stop` through `provenanceCap`) arrives with the
 *  context dial: the four numbers that must move together, plus the two
 *  round-trip caps that had to move with them. */
export interface BudgetProfile {
  /** Which stop resolved this profile. Consumers that keep a shipped-value
   *  module constant alive for the rig branch on it. */
  stop: ContextStop;
  depth: number;
  breadth: number;
  totalTypes: number;
  rootCap: number;
  resolveCap: number;
  provenanceCap: number;
  surfaceBudgetTok: number;
  memberCap: number;
  surfaceCap: number;
  refineTotalChars: number;
  walkTokMax: number;
  maxTokens: number;
  numCtx: number;
  timeoutMs: number;
}

/** A cell's declared exceptions. A cell that moves `surfaceBudgetTok` moves
 *  every derived with it; a field named here wins over its derivation. */
type BudgetCell = Partial<BudgetProfile>;

// The per-(class, language) override table, keyed "class/languageId". SHIPS
// EMPTY on purpose: phase 0b is the seam, and the non-identity values arrive
// with arms behind them (phase 4). C# is NOT overridden here - its lever is
// CS_BUDGET_FACTOR above, which the walk and this table share.
const CELL_OVERRIDES: Readonly<Record<string, BudgetCell>> = {};

/**
 * C#'s aggregate budget at one stop, as a FACTOR of that stop's budget.
 *
 * The factor is read as a RATIO of the two module constants rather than as
 * `CS_BUDGET_FACTOR` directly, and that is not indirection for its own sake:
 * the measurement rig rewrites `var CS_DATASHAPE_TOTAL_TOK = …;` in the bundle
 * - to `void 0` to replay the pre-factor baseline, or to a rung value to move
 * C# alone - and a stop-scaled budget that read the factor constant would make
 * both of those patches dead above the `shipped` stop. Reading the ratio keeps
 * the rig's one C# knob reaching every stop.
 *
 * NOT a `=== 300` sentinel, which is the form review-v45-p3 R5 refuted: a
 * sentinel against a literal cannot tell UNPATCHED from PATCHED-TO-300.
 */
function csharpBudgetFor(stopTok: number): number {
  const factor = (CS_DATASHAPE_TOTAL_TOK ?? DATASHAPE_TOTAL_TOK) / DATASHAPE_TOTAL_TOK;
  return Math.round(stopTok * factor);
}

/** The tuning profile for one serving class, language and context stop. Pure
 *  and total: every combination answers, unknown languages get the base cell.
 *
 *  THE STOP IS REQUIRED, not defaulted. A default would let a caller acquire
 *  the dial by accident, and the whole failure this phase exists to avoid is a
 *  number that reaches nothing (or reaches something nobody chose). */
export function budgetProfileFor(cls: ModelClass, languageId: string, stop: ContextStop): BudgetProfile {
  const cell = CELL_OVERRIDES[`${cls}/${languageId}`] ?? {};
  const bounds = contextBoundsFor(stop);
  const surfaceBudgetTok =
    cell.surfaceBudgetTok ??
    (languageId === "csharp" ? csharpBudgetFor(bounds.surfaceBudgetTok) : bounds.surfaceBudgetTok);
  return {
    stop,
    depth: bounds.depth,
    breadth: bounds.breadth,
    totalTypes: bounds.totalTypes,
    rootCap: bounds.rootCap,
    resolveCap: bounds.resolveCap,
    provenanceCap: bounds.provenanceCap,
    surfaceBudgetTok,
    memberCap: cell.memberCap ?? memberCapFor(surfaceBudgetTok),
    surfaceCap: cell.surfaceCap ?? surfaceCapFor(surfaceBudgetTok),
    refineTotalChars: cell.refineTotalChars ?? refineTotalCharsFor(surfaceBudgetTok),
    walkTokMax: cell.walkTokMax ?? walkTokMaxFor(surfaceBudgetTok),
    maxTokens: cell.maxTokens ?? MAX_TOKENS_BY_CLASS[cls],
    numCtx: cell.numCtx ?? GEN_NUM_CTX,
    timeoutMs: cell.timeoutMs ?? GEN_TIMEOUT_MS,
  };
}
