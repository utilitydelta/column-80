// The derivation seam for the fn-gen injection path's tuning constants
// [session-v46/contract-phase0b.md]. Every number here was inherited from a
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

/** What one (class, language) cell serves. All eight fields always present;
 *  numCtx only means anything to a local class and timeoutMs only to the
 *  claude-code transport, but a uniform shape keeps every consumer total. */
export interface BudgetProfile {
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

/** The tuning profile for one serving class and language. Pure and total:
 *  every class-language pair answers, unknown languages get the base cell.
 *  The `?? DATASHAPE_TOTAL_TOK` on the C# leg is not dead defensiveness: the
 *  measurement rig neuters `CS_DATASHAPE_TOTAL_TOK` in the bundle to replay
 *  the pre-factor baseline, and the fallback is what keeps that arm honest. */
export function budgetProfileFor(cls: ModelClass, languageId: string): BudgetProfile {
  const cell = CELL_OVERRIDES[`${cls}/${languageId}`] ?? {};
  const surfaceBudgetTok =
    cell.surfaceBudgetTok ?? (languageId === "csharp" ? (CS_DATASHAPE_TOTAL_TOK ?? DATASHAPE_TOTAL_TOK) : DATASHAPE_TOTAL_TOK);
  return {
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
