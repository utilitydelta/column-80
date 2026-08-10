# The tuning constants: every hard-coded number that shapes model behaviour

Every number here decides what a model sees or how long it gets. Most were chosen against
`qwen3-coder:30b` at `num_ctx=16384` on a 16GB carve, and they now gate every backend unchanged,
including the cloud ones. This file is the ledger: value, home, what it gates, and an honest
provenance verdict. Roadmap item 41 is the active work; this file records state, it does not
change it.

First promoted 2026-08-09 from the session-v45 audit, extended by the 2026-08-09 full-source
sweep. When a constant moves, its row moves with it, with the measurement named.

## The structural fact behind most rows

Prompt assembly is provider-blind, but since the phase-0b seam (session-v46) the budget profile
is resolved per (model class, language): `budgetProfileFor()` in `src/core/budgetProfile.ts`
serves every cell, `readFnGenConfig()` (`src/vscode/config.ts`) reads `maxTokens` and `numCtx`
from the active class's cell (`temperature` still comes straight off `DEFAULT_FNGEN_CONFIG`),
and the prefill walk spends the cell's `surfaceBudgetTok`. The override table ships EMPTY, so at
identity every value equals the constant it replaced and a frontier model is still driven with
numbers sized for a locally-carved 30B. The per-language splits (`CS_BUDGET_FACTOR`,
`GO_PREFILL_TYPE_CAP`) prove the per-language axis; the model-class axis now EXISTS behind
identity defaults, waiting on measured cells.

## How to read the verdicts

- **PROVEN-ARM**: a real measurement arm sits behind the value.
- **MEASURED-NARROW**: measured once, in one language or one corpus, and the code says so.
- **DERIVED**: sized off another constant, inheriting that constant's evidence or lack of it.
- **INHERITED**: imported from outside the product. The main import is the "~350-token codegen
  knee", which the code admits comes from external literature via an early scout, names no
  source, and has one Rust arm as its only in-product test (raising the budget measured
  flat-to-negative on Rust, locally; the cloud arm has never run).
- **UNJUSTIFIED**: no provenance anywhere in the repo.

## Generation and token budgets

| constant | value | home | gates | verdict |
|---|---|---|---|---|
| `MAX_TOKENS_BY_CLASS` | 2048 local, 64000 frontier | `src/core/budgetProfile.ts` | fn-gen output ceiling, per serving class | FIXED 2026-08-10 (1.3.0). Was one flat 2048 ratified against a local 30B's VRAM fit and forwarded verbatim to cloud transports. On Claude Opus 5, Sonnet 5 and Fable 5 an omitted `thinking` parameter runs adaptive thinking and `max_tokens` caps thinking PLUS answer, so the ceiling was spent before the model began answering and the round failed as a truncated generation. Local keeps 2048, where it is right and is bounded by `GEN_NUM_CTX`, which it shares with the prompt |
| `DEFAULT_FNGEN_CONFIG.testMaxTokens` | 8192 | `src/core/config.ts` | test-gen output ceiling | MEASURED-NARROW (2048 truncated real modules) |
| `DEFAULT_FNGEN_CONFIG.numCtx` | 16384 | `src/core/config.ts` | ollama prompt+output window; below it ollama silently truncates the prompt | MEASURED-NARROW (p90 prompt ~1,295 tok); the right value is the user's hardware and there is no setting |
| `DEFAULT_FNGEN_CONFIG.temperature` | 0.2 | `src/core/config.ts` | fn-gen sampling on every provider that accepts it (inert on native Anthropic) | UNJUSTIFIED, and every measurement corpus was collected at it, so it is a baked-in confound |
| `MEMBER_SITE_MAX_TOKENS` | 64 | `src/core/completionService.ts` | silently clamps the user's FIM `maxTokens` at member sites | DERIVED (one member access needs no more) |
| repair round cap | 2 | `src/core/repair.ts` | gated repair rounds per accept | INHERITED, deficit admitted: the nearest analogue runs 3 |
| refine round cap | 1 | `src/core/refine.ts` | refine rounds | DERIVED |
| `KEEP_ALIVE_S` | 1800 | `src/core/ollama.ts` | model residency between requests | DERIVED from usage patterns, uncontroversial |

## Injection caps: fn-gen prefill

| constant | value | home | gates | verdict |
|---|---|---|---|---|
| `DATASHAPE_TOTAL_TOK` | 300 | `src/core/budgetProfile.ts`, duplicated in `src/vscode/completionProvider.ts` | the aggregate render budget across all per-type walks; the single biggest lever on what a model sees | INHERITED, the knee itself. On the C# corpus, 300 to 900 moved supply-side injection 16.4% to 31.6%; the generation-stage arm and the cloud arm have not run |
| `CS_BUDGET_FACTOR` | 1 | `src/core/budgetProfile.ts` | C#'s multiplier on the budget; the per-language mechanism, value deliberately unchanged pending a generation arm | mechanism PROVEN-ARM, value awaiting measurement |
| `PREFILL_TYPE_CAP` | 4 | `src/vscode/fnGen.ts` | candidate types admitted per function | MEASURED-NARROW (Rust, one corpus): raising it alone RELOCATES loss into the budget (post-cap loss 65.7% to 78.2%). It moves AFTER the budget, never before |
| `GO_PREFILL_TYPE_CAP` | 8 | `src/vscode/fnGen.ts` | Go's own cap | PROVEN-ARM, the best-evidenced cap in the repo: 907 rows, six repos, a real knee at 8; Rust's own 4-to-12 arm measured flat, which is why Rust stays 4 |
| `PREFILL_RESOLVE_CAP` | 8 | `src/vscode/fnGen.ts` | candidates fully resolved; spends language-server round trips, not prompt bytes | UNJUSTIFIED, admitted ("not from a curve"), but genuinely model-independent: a bigger model does not make the language server faster |
| `PREFILL_PROVENANCE_CAP` | 24 | `src/vscode/fnGen.ts` | provenance `definition()` checks | UNJUSTIFIED, admitted, model-independent for the same reason |
| `DATASHAPE_BOUNDS` | D2/B4/N6/T200 | `src/vscode/fnGen.ts` | per-walk shape bound | DERIVED + INHERITED (B mirrors the type cap; the mirror was never justified and the two spend different currencies) |
| `CROSS_FILE_BOUND` | D2/N12 | `src/vscode/fnGen.ts` | cross-file type-graph gather | DERIVED |
| `TESTGEN_PROFILE` totalTok | 500 | `src/vscode/fnGen.ts` | test-gen's aggregate budget | UNJUSTIFIED, and the product's own contradiction: test-gen ships 500 while fn-gen holds 300 on the strength of a 350-token threshold. One of the two is wrong |
| `injectedSurface` multipliers | x0.5 / min(x3, resolveCap) | `src/vscode/fnGen.ts` | the ONE user-facing prompt-size knob | UNJUSTIFIED, self-declared "NOT measured"; `generous` clamps to the resolve cap, so on Rust it lands on 8, not the documented 12 |
| `MEMBER_CAP` | 24 | `src/core/extraction.ts` | members rendered per type, prefill AND repair, all five languages, deliberately fused | UNJUSTIFIED: no ladder, no arm, no language, no model; justified only by the inherited knee. Highest-traffic constant with the weakest provenance |
| `HOVER_SIGNATURE_CAP` | 32 | `src/core/extraction.ts` | hover fan-out signature backfill | DERIVED (sits above the member cap it feeds) |
| `FIELD_TYPE_MAX` | 120 | `src/core/extraction.ts` | widest field type worth injecting | DERIVED |

## Injection caps: FIM, repair and refine

| constant | value | home | gates | verdict |
|---|---|---|---|---|
| `MAX_CANDIDATES` / `RUNAWAY_CANDIDATES` | 40 / 60 | `src/core/fimInject.ts` | member lines in a FIM candidate block / whole-block skip | DERIVED |
| `MAX_ARG_TYPES` | 2 | `src/core/argTypeSurface.ts` | argument types per member site | DERIVED (latency, not prompt) |
| `MEMBER_RESOLVE_CAP` | 32 | `src/vscode/*Extractor.ts` | members resolved for detail per receiver | DERIVED; known worst case: a 49-property entity loses 22 real properties to a positional cut |
| `SURFACE_CAP` | 4 | `src/vscode/oracleSurface.ts` | distinct surfaces per repair prompt | DERIVED from the type cap when that was itself unmeasured; repair is where the compiler already NAMED the missing types, and the drop rate is unknown |
| `REFINE_TARGET_CAP` | 6 | `src/vscode/oracleSurface.ts` | reference queries per refine round | PROVEN-ARM (a measured ~500ms Roslyn floor per query) |
| `REFINE_TOTAL_CHARS` | 2400 | `src/vscode/oracleSurface.ts` | refine usage payload | DERIVED off the budget, self-labelled "not a measured optimum" |
| `USAGE_WINDOW_BOUNDS` | 3 windows / 900 chars | `src/core/usageSurface.ts` | FIM usage-example payload | UNJUSTIFIED, admitted ("the sweep that would tune them was not run, deliberately") |
| `MAX_BOUND_LINES` | 4 | `src/core/fimBound.ts` | content lines in a FIM ghost | PROVEN-ARM (five languages, 125 block sites) |

## Timeouts

| constant | value | home | gates | verdict |
|---|---|---|---|---|
| `DEFAULT_TIMEOUT_MS` | 120000 | `src/core/claudeCodeInstruct.ts` | the Claude Code CLI watchdog; the product call site passes it from the budget profile (`src/vscode/fnGen.ts:1240`) | MEASURED-AGAINST, the wrong evidence: chosen on a handful of easy 4-8s rounds, then measured killing 3 of 33 complex C# sonnet rows, with more landing 100s+. Roadmap 41d owns the fix; the wanted measurement is the latency distribution by complexity per backend |
| `INJECTION_DEADLINE_MS` | 50 | `src/core/completionService.ts` | the whole FIM injection race | PROVEN-ARM in the negative: three tuning passes died proving a deadline never bounds uninterruptible server work. Its own doc says do not raise it |
| `GATE_DEADLINE_MS` | 500 | `src/core/completionService.ts` | the member gate's own bound, after generation returns | DERIVED (generation takes ~1s, so the gate can afford it) |
| arg-type / usage margins | 5-20ms, per-language floors | `src/core/argTypeSurface.ts`, `usageSurface.ts` | whether a leg starts inside the deadline | MEASURED-NARROW (warm per-language leg costs) |
| compiler oracle spawns | none | `src/core/compilerOracle.ts` | `cargo check` / `tsc` / `dotnet` have NO timeout; a hung toolchain hangs the repair round indefinitely | missing, known, unfixed |

## What is deliberately left alone

`GO_PREFILL_TYPE_CAP = 8`, `MAX_BOUND_LINES = 4`, `REFINE_TARGET_CAP = 6` and the FIM deadline
family all carry real arms and stand. `MIN_PREFIX_BYTES = 2048` and the 1-hour cache TTL on the
Anthropic transport are reasoned from documented provider mechanics rather than guessed. And the
one to resist: `PREFILL_TYPE_CAP = 4` looks like the obvious dial and is the one prefill cap
with an arm proving that raising it alone moves the loss instead of removing it.

## What is user-reachable today

The only model-behaviour settings in `package.json` are FIM ones: `maxTokens` (256, FIM only
despite the generic name), `temperature` (0.01, FIM only), `debounceMs`, `prefixChars`,
`suffixChars`, `cacheCapacity`, ghost floors, `fimAlternatives`, and the one fn-gen prompt knob
`injectedSurface` (whose multipliers are themselves unmeasured). Every fn-gen budget above
reaches the model from defaults alone. Ye can chart every reef on this page and still find no
wheel to steer by; that gap is the roadmap's, not the reader's.

## Standing rules

1. A constant moves only on a measurement arm, never by feel. Three tuning passes on the FIM
   deadline died proving the alternative.
2. The budget moves before the caps that feed it. Measuring a cap while the budget binds
   attributes the gain to the wrong knob.
3. When a value is changed, this ledger's row updates in the same commit, with the arm named.
4. The per-model budget profile (roadmap item 41) now has its seam: `budgetProfileFor(modelClass,
   languageId)` in `src/core/budgetProfile.ts`, shipped with identity defaults and an empty
   override table (phase-0b, session-v46). Non-identity cells still arrive only with a
   measurement arm behind them.
