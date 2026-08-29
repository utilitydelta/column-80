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
| `PROMPT_ASCII_CHARS_PER_TOK` | 3 | `src/core/promptBudget.ts` | ASCII characters per estimated token, in the window arbitration (session-v48 phase 2) | JUDGMENT CALL, changed from 4 on 2026-08-10 by the phase-2 adversarial review (D6). 4 is the `WalkBounds.TOK_MAX` render convention and it UNDER-estimates dense source, which is the one direction this estimate's contract forbids: prose runs near 4 chars/token on a BPE vocabulary, source does not - punctuation, indentation runs and snake/camel identifiers all split into several pieces each. 3 is the pessimistic end of that range and nothing measured it. WHAT WOULD SETTLE IT: ollama returns the real `prompt_eval_count` on every response; logging (estimate, prompt_eval_count) pairs over a corpus would calibrate this instead of reasoning about it. Nothing reads that field today |
| `PROMPT_NON_ASCII_TOK_PER_CHAR` | 1 | `src/core/promptBudget.ts` | tokens charged per non-ASCII UTF-16 unit | JUDGMENT CALL, new 2026-08-10 (review D6). `String.length` is UTF-16 units, not bytes and not tokens: an ASCII, a CJK and an emoji prompt of the same 25355 units estimated identically at chars/4 while their UTF-8 sizes were 25355 / 75355 / 100355 bytes, so the CJK prompt was a ~4x under-estimate against a tokenizer of the Qwen class that encodes CJK at roughly one token per character. Charging a whole token per unit covers that and over-charges an astral character (2 units, 2 tokens), which is the safe direction. WHAT WOULD SETTLE IT: the same `prompt_eval_count` calibration, on a non-ASCII corpus |
| `PROMPT_TEMPLATE_TOK` | 48 | `src/core/promptBudget.ts` | a flat allowance for the chat template and role/BOS scaffolding, charged to the `fixed` share by `FnGenService` | JUDGMENT CALL, new 2026-08-10 (review D6). The prompt STRING does not contain these tokens - the server's Modelfile wraps the turn - so no character count can see them and the pre-review estimate counted none of them. A Qwen-family chat template wraps one user turn in a handful of special tokens plus a system preamble: tens, not hundreds. 48 is that order with room over it, and it is ~0.3% of the 14336-token window, so it cannot be what refuses a real prompt. WHAT WOULD SETTLE IT: `ollama show --modelfile` for the served tag, tokenized |
| drop-ledger name cap | 12 | `src/vscode/fnGen.ts` (`DROP_LEDGER_NAME_CAP`) | how many dropped type names one channel line spells out before it counts the rest | JUDGMENT CALL. The COUNT is exact and unbounded; only the NAMES are capped. Measured trigger: the phase-1 synthetic 40-wide graph at `medium` drops 397 types, and one line carrying all of them buries every line around it |

## Injection caps: fn-gen prefill

| constant | value | home | gates | verdict |
|---|---|---|---|---|
| `DATASHAPE_TOTAL_TOK` | 300 | `src/core/budgetProfile.ts`, duplicated in `src/vscode/completionProvider.ts` | the aggregate render budget across all per-type walks; the single biggest lever on what a model sees | INHERITED, the knee itself. On the C# corpus, 300 to 900 moved supply-side injection 16.4% to 31.6%; the generation-stage arm and the cloud arm have not run |
| `CS_BUDGET_FACTOR` | 1 | `src/core/budgetProfile.ts` | C#'s multiplier on the budget; the per-language mechanism, value deliberately unchanged pending a generation arm | mechanism PROVEN-ARM, value awaiting measurement |
| `PREFILL_TYPE_CAP` | 4 | `src/vscode/fnGen.ts` | candidate types admitted per function | MEASURED-NARROW (Rust, one corpus): raising it alone RELOCATES loss into the budget (post-cap loss 65.7% to 78.2%). It moves AFTER the budget, never before |
| context stop `rootCap` | 4 / 8 / 8 / 12 / 16 | `src/core/budgetProfile.ts` | ROOT candidates walked, per stop (`shipped` / `small` / `medium` / `large` / `frontier`) | JUDGMENT CALL per stop, on one PROVEN-ARM anchor: Go's cap ladder over 907 rows in six repos kneed at 8, which is why the install default is 8 for every language (v48 S16). Rust's own 4-to-12 arm measured flat with the budget PINNED, a condition the dial does not reproduce |
| context stop `resolveCap` | 8 / 16 / 16 / 24 / 32 | `src/core/budgetProfile.ts` | candidates fully resolved; spends language-server round trips, not prompt bytes | JUDGMENT CALL. It had to move with the root cap: a root beyond it can never be injected, so a 16-root stop against the shipped 8 would be inert above 8. The `shipped` value is the old `PREFILL_RESOLVE_CAP`, still UNJUSTIFIED and still admitted |
| context stop `provenanceCap` | 24 / 24 / 24 / 36 / 48 | `src/core/budgetProfile.ts` | provenance `definition()` checks | JUDGMENT CALL, moving with the resolve cap it feeds. The `shipped` value is the old `PREFILL_PROVENANCE_CAP`, UNJUSTIFIED and admitted |
| context stop depth/breadth/totalTypes | D2 everywhere; B 4/6/12/24/48; N 6/24/48/96/192 | `src/core/budgetProfile.ts` | per-walk shape bound | JUDGMENT CALL per stop. Depth is deliberately NOT a dial. Total types leads breadth roughly 3x the root count, so breadth has somewhere to go. `shipped` is the pre-dial `DATASHAPE_BOUNDS`, which `src/vscode/fnGen.ts` still declares verbatim for the measurement rig's patch site |
| cross-file gather bound | D = the stop's depth; N = the stop's total types + 6 | `src/vscode/fnGen.ts` | cross-file type-graph gather | DERIVED. It had to join the dial: a stop emitting 192 types against a gather that stops at 12 is a stop whose extra types do not exist. ADDITIVE since 2026-08-10, and the shipped pair still lands exactly (6 + 6 = 12). It was written as a 2x FACTOR first, which reads the same at 6 and diverges hard above it: each gathered type is a definition + hover + open + documentSymbol, so the install default's gather went 12 -> 48 and `frontier` reached 384. A 2x margin over 192 emitted types buys nothing the walk can use |
| `TESTGEN_PROFILE` totalTok | 500 | `src/vscode/fnGen.ts` | test-gen's aggregate budget | UNJUSTIFIED, and the product's own contradiction: test-gen ships 500 while fn-gen holds 300 on the strength of a 350-token threshold. One of the two is wrong |
| context stop `surfaceBudgetTok` | 300 / 600 / 1200 / 2400 / 4000 | `src/core/budgetProfile.ts` | the aggregate render budget, and the one user-facing prompt-size knob (`column80.injectedContext`) | JUDGMENT CALL. Every stop above `shipped` walks PAST the ~350-token codegen knee deliberately, which is why `small` is the install default: the user most likely to be hurt by the knee is the one who never touches the setting. Replaced the `injectedSurface` multipliers, which moved the root cap alone and so could not change the prompt |
| `MEMBER_CAP` / `memberCapFor` | 24 at the `shipped` budget; 48 / 96 / 192 / 320 up the stops | `src/core/extraction.ts`, derived in `src/core/budgetProfile.ts` | members rendered per type, prefill AND repair, all five languages, deliberately fused | UNJUSTIFIED: no ladder, no arm, no language, no model; justified only by the inherited knee. Highest-traffic constant with the weakest provenance. It is the ONLY number the dial's budget moves in Go and Python, whose prefill renders member signatures and nothing else |
| `HOVER_SIGNATURE_CAP` | 32 | `src/core/extraction.ts` | hover fan-out signature backfill | DERIVED (sits above the member cap it feeds) |
| `FIELD_TYPE_MAX` | 120 | `src/core/extraction.ts` | widest field type worth injecting | DERIVED |

## Injection caps: FIM, repair and refine

| constant | value | home | gates | verdict |
|---|---|---|---|---|
| `MAX_CANDIDATES` / `RUNAWAY_CANDIDATES` | 40 / 60 | `src/core/fimInject.ts` | member lines in a FIM candidate block / whole-block skip | DERIVED |
| `MAX_ARG_TYPES` | 2 | `src/core/argTypeSurface.ts` | argument types per member site | DERIVED (latency, not prompt) |
| `MEMBER_RESOLVE_CAP` | 32 | `src/vscode/*Extractor.ts` | members resolved for detail per receiver | DERIVED; known worst case: a 49-property entity loses 22 real properties to a positional cut |
| repair `surfaceCap` | 4 / 8 / 16 / 32 / 53 by stop (8 at the install default) | `src/core/budgetProfile.ts` (`surfaceCapFor`), spent in `src/vscode/oracleSurface.ts` | distinct surfaces per repair prompt | DERIVED from the aggregate budget (4 per 300 tok), and it follows the CONTEXT DIAL: the repair prompt is a prompt, and a developer who chose `frontier` for their model's window has no second setting for it. The 4 it derives from was itself derived from the type cap when that was unmeasured, and the drop rate is still unknown |
| `REFINE_TARGET_CAP` | 6 | `src/vscode/oracleSurface.ts` | reference queries per refine round | PROVEN-ARM (a measured ~500ms Roslyn floor per query) |
| `REFINE_TOTAL_CHARS` | 2400 at the `shipped` budget, 4800 at the install default | `src/core/budgetProfile.ts` (`refineTotalCharsFor`), spent in `src/vscode/oracleSurface.ts` | refine usage payload | DERIVED off the budget (8 chars per token) and following the context dial for the same reason `surfaceCap` does; self-labelled "not a measured optimum" |
| `USAGE_WINDOW_BOUNDS` | 3 windows / 900 chars | `src/core/usageSurface.ts` | FIM usage-example payload | UNJUSTIFIED, admitted ("the sweep that would tune them was not run, deliberately") |
| `MAX_BOUND_LINES` | 4 | `src/core/fimBound.ts` | content lines in a FIM ghost | PROVEN-ARM (five languages, 125 block sites) |

## Timeouts

| constant | value | home | gates | verdict |
|---|---|---|---|---|
| `DEFAULT_TIMEOUT_MS` | 120000 | `src/core/claudeCodeInstruct.ts` | the Claude Code CLI watchdog; the product call site passes it from the budget profile (`src/vscode/fnGen.ts:1240`) | MEASURED-AGAINST, the wrong evidence: chosen on a handful of easy 4-8s rounds, then measured killing 3 of 33 complex C# sonnet rows, with more landing 100s+. Roadmap 41d owns the fix; the wanted measurement is the latency distribution by complexity per backend |
| `INJECTION_DEADLINE_MS` | 50 | `src/core/completionService.ts` | the whole FIM injection race | PROVEN-ARM in the negative: three tuning passes died proving a deadline never bounds uninterruptible server work. Its own doc says do not raise it |
| `GATE_DEADLINE_MS` | 500 | `src/core/completionService.ts` | the member gate's own bound, after generation returns | DERIVED (generation takes ~1s, so the gate can afford it) |
| arg-type / usage margins | 5-20ms, per-language floors | `src/core/argTypeSurface.ts`, `usageSurface.ts` | whether a leg starts inside the deadline | MEASURED-NARROW (warm per-language leg costs) |
| `FIM_SILENCE.firstDataMs` | 60000 | `src/core/ollama.ts` | how long a FIM stream may say nothing at all before it is cut and single-flight released (queue Q5) | JUDGMENT CALL, and the code says so. It has to clear a model load plus a FIM request queued behind an fn-gen generation, and nothing measures that pair. Deliberately generous: this bound exists to un-wedge single-flight, not to enforce latency, and the latency story is the debounce plus `stopWhen`. The arm that would earn it: time to first line on a cold FIM model while a generation holds the server |
| `FIM_SILENCE.stallMs` | 20000 | `src/core/ollama.ts` | a gap BETWEEN lines on a live FIM stream | MEASURED-AGAINST: model swapping between the small FIM model and the big instruct model measured 2 to 4.6 second reloads (`docs/user-manual.md`), and 20s is over 4x the worst of those. That swap is the scenario worth surviving; the number is a headroom multiple of a real measurement rather than a feel |
| compiler oracle spawns | none | `src/core/compilerOracle.ts` | `cargo check` / `tsc` / `dotnet` have NO timeout; a hung toolchain hangs the repair round indefinitely | missing, known, unfixed |

## Error text: what reaches a toast, and what reaches the channel

| constant | value | home | gates | verdict |
|---|---|---|---|---|
| `ERROR_BODY_CHARS` | 400 | `src/core/errorBound.ts` | how much server-controlled text survives into a thrown error message, and so into a notification | JUDGEMENT CALL, from session-v56 and re-homed by session-v57. Sized for a glance at a notification, against the `{"error":"..."}` shape these APIs actually send. The measurement behind it is the failure, not the value: a 500 with a 100KB body reached a toast at 102437 characters |
| `CHANNEL_BODY_CHARS` | 16384 | `src/core/errorBound.ts` | how much of the RAW server body the output channel keeps, logged at the transport before the toast's bound runs | JUDGEMENT CALL, and the code says so. Forty times the toast's budget because the two surfaces are different products: the toast is read at a glance, the channel is the only diagnostic a no-telemetry product will ever have, and roadmap item 69's ruling (2026-08-22) is "starve the toast, never the channel". 16 KiB holds any real error envelope whole and the head of an HTML error page, and refuses the megabyte. IT BOUNDS THE RENDERED ROW, which is the surface it is named for: the channel copy escapes its line breaks so a server cannot write its own channel rows, and the escape runs BEFORE the cap so the escape budget is charged against it. That order was got wrong once and the measurement is why it changed - bounding first left the row six times the cap, because LF and CR cost two characters to escape but U+2028, U+2029 and NEL cost six, and a 16385-char all-U+2028 body rendered as a 98372-char row. The cost of the fix, stated: on a body carrying breaks the elision note counts escaped characters while the line's stated length counts what the server sent, so the two are in different units; on a body without breaks, which is every real error envelope, they agree exactly. NOTHING MEASURED THE VALUE: no corpus of real provider error bodies exists on this box, so the size distribution this cap is meant to clear is unknown. THE ARM THAT WOULD EARN IT: log raw body lengths across a month of real failures on all four backends and read the p99 |

The cut-stream line (`cutStreamLine`, same file, session-v59) has **no cap of its own** and that is the
decision, not an omission. It reuses `CHANNEL_BODY_CHARS` through `boundChannel`, so the channel has one
answer to "how much of the server's words do you keep" instead of two numbers a reader has to hold apart.
A second constant would have to be justified against the first, and there is nothing to justify it with:
a partial reply is model output already bounded by `num_predict`, so the cap almost never binds, and when
it does the failure it guards is identical - a misbehaving server on a UI surface. It takes the same
escape-then-bound order for the same reason, and it matters more here: model output carries line breaks
by construction, where an error envelope usually does not.

## The tighten command

| constant | value | home | gates | verdict |
|---|---|---|---|---|
| `TIGHTEN_PARAGRAPH_WORDS` | 50 | `src/core/tightenRender.ts` | where `Column 80: Tighten Doc Comment` closes a paragraph and starts the next | JUDGMENT CALL, and the code says so. Anchored on session-v52's scout table: 46 words between breaks in round 2 (the spec that made a 30B produce correct linear code), 60 in written Rust doc comments, 94 in dictation. It is NOT a measurement of this product. The arm that would earn it - take written doc comments that already carry breaks, join each into one block, generate from both, grade on compile - has never been run, and the render ships as a readability fix until it is |
| `TIGHTEN_COLUMN` | 80 | `src/core/tightenRender.ts` | the wrap budget, minus the region's indent and comment prefix | the product's name, not a tuning dial |
| `TIGHTEN_TAB_WIDTH` | 4 | `src/core/tightenRegion.ts` | columns a tab counts when the wrap measures width; the caller overrides it from the editor | DERIVED from the editor default, and overridden per target |
| `PROPOSER_SPAN_CAP` | 12 | `src/core/tightenProposer.ts` | spans the proposer's reply may claim from one comment, applied after the longest-first sort and after overlap removal | JUDGMENT CALL, no arm. It bounds the LIST A HUMAN READS, not the round trips: the delta gate drops classes 1 and 2 before anything reaches the diff, and phase 3 owns its own resolver cap. Three times `PREFILL_TYPE_CAP` so the gate has real choice after the drops, and the same number `DROP_LEDGER_NAME_CAP` uses for the same reason - past a dozen names a list stops being read |
| the proposer's `num_predict` | `max(64, PROPOSER_SPAN_CAP * 16)` = 192 | `src/vscode/tightenDocComment.ts` | how many tokens the tighten command's ONE model round may spend | DERIVED from `PROPOSER_SPAN_CAP`, deliberately NOT from `maxTokens`. The reply is at most twelve short lines copied out of the prose, so sixteen tokens a line with a floor is the shape of the answer rather than the shape of a function body. Spending the code budget here would let a model that ignores the format run for a minute before the parse drops every line of it |
| `TIGHTEN_QUERY_BUDGET` / `TIGHTEN_SWEEP_CAP` | 12 / 3 | `src/vscode/tightenDocComment.ts` | workspace-symbol queries ONE tighten invocation may spend in total, and how many any one phrase may spend | **MEASURED, and the measurement replaced a borrowed number.** `PROPOSER_SPAN_CAP` (12) times `RATIFY_QUERY_CAP` (9) is 108 and nothing capped the product: 85 serial round trips were reachable (phase 5 adversarial, defect 8). The budget is one first query per span the developer could be shown, spent breadth before depth, because the measured marginal recall of the whole sweep over the first query is 0 of 451 names. Sized against `session-v52/ratify-query-cost.md`'s warm p95 per server - Roslyn 0.9ms, gopls 4.4ms, rust-analyzer 5.3ms, tsserver navto 16.9ms - so 12 queries is about 0.2s at the slowest. NOT sized against `refine.ts`'s ~500ms Roslyn floor, which is a REFERENCE call and over-prices this operation by two orders of magnitude. Pylance is unmeasured: it refuses to run outside VS Code |
| the fold's variant sweep | 9 spellings per phrase | `src/core/spokenName.ts` (`identifierVariants`) | candidate spellings handed to a symbol provider for one spoken phrase | MEASURED-NARROW and DISCOUNTED IN PLACE. `session-v52/spikes/variants.cjs` recovered 100% of the 543 declared type names in celeriant-db at commit 487f8c1 (2026-08-08, `git archive HEAD` so the count reproduces), but the spoken form it swept with was derived by splitting each identifier on its own humps, so the generator was measured as the inverse of the splitter. The non-circular half is **0%**: of the type names whose spoken form differs from their own humps, 53 carry an abbreviation a person expands (`mem` said "memory") and the sweep recovers 0 of 53. So the set covers the conventions the five languages use, and 9.6% of this corpus's type names reach the developer as a guess that never auto-applies |
| the fold's auto-accept gate | `fold` matches only | `src/core/spokenName.ts`, ruled in `src/core/tightenClassify.ts` (`autoAppliesUnderFold`) | which respellings the tighten diff may apply without an explicit human accept | RULED, on a measured hazard. A `plural` match breaks fold equality (`client sets` folds to `clientsets`, `ClientSet` to `clientset`), so it is a guess about English and not a respelling of what was said. Auto-applying it would rewrite a word the human said. Amendment 17 makes the guess a much better guess and does not make it an auto-apply. Every `Proposal` carries the answer as `autoApply`, so no consumer derives it from `match` |
| the plural retry | 2 candidate strips (`s` and `es`), last word only | `src/core/spokenName.ts` (`pluralCandidates`) | the one deterministic retry when a spoken phrase does not fold to any identifier | PROVEN on the corpus, after a ruling that was measured wrong once. A SINGLE strip has to choose, and English cannot: contract amendment 5 chose `es` first and was wrong for every word ending in a silent `e` - 102 of 549 pluralisable celeriant-db type names, 18.6%, and `planes` resolved to `Plan` with no collision to refuse on. Amendment 17 generates both and lets the identifier set decide; re-measured on the same 549, recovery is 549/549 with zero wrong answers. `stripPlural` is kept, superseded, because the blind oracle pins it |
| `RESTATEMENT_THRESHOLD` | 0.7 | `src/core/tightenFlags.ts` | lexical containment at or above which two spans are called a restatement, and one is offered for deletion | INHERITED from `session-v52/spikes/detector.cjs`, and validated rather than derived: the scout checked the instrument against three known cases before believing its corpus numbers. Inclusive, as the spike's `>=` is. The port re-runs the spike's own tokeniser and containment, so the number still means what it meant when it was checked |
| `RESTATEMENT_MIN_TOKENS` | 5 | `src/core/tightenFlags.ts` | content tokens a unit needs before it is compared at all | INHERITED from the same spike, same reason. Below it, short units score 1.00 against each other on nothing |
| the restatement splitter | `.!?` + whitespace, and blank lines | `src/core/tightenFlags.ts` (`sentenceSpans`) | what counts as one comparable unit | **CHANGED 2026-08-12, and it moved a published digit.** The spike also split on a BARE newline, which is wrong for this product: phase 1 hard-wraps the comment at 80 columns, so a newline is a wrap and never a boundary. On 17,774 real doc-comment blocks, 47 of 582 sentence pairs were two lines of ONE sentence or a split URL, and a reported span is what phase 5 offers to DELETE. See the digit note below |
| `MAX_REPORTED_PAIRS_PER_GRAIN` | 100 | `src/core/tightenFlags.ts` | pairs the report shows per grain; never a cap on pairs compared, so `units`, `worst` and `totalPairs` stay exact | JUDGMENT CALL. Pair count is quadratic in units and a self-similar 100KB paste fires on nearly every pair. PER GRAIN because a shared cap let the sentence pass spend the whole budget and report the duplicated paragraph nowhere, which is the one grain round 5's failure shows in |
| the undefined-term gate | under 1% of real doc comments may fire | `src/core/tightenFlags.ts` (`objectHead`) | whether the undefined-term flag ships at all | PROVEN-ARM, and the arm is the reason the rule is what it is. Measured on the 17,774-block corpus: "instruction verb plus a determiner in its object" fires on 10.5% (top terms `object`, `list`, `name`, `string`, `path` - ordinary technical English); adding an `of the X` leg to a possessive requirement gives 1.3%; POSSESSIVE ALONE, what ships, gives 0.7%. The `of` leg was dropped because it carries 113 of 234 flags almost entirely out of CPython, where "Return the sum of the two operands" defines nothing. Named cost: "subtract the known saving of the entry" is now missed. Re-run `session-v52/spikes/adv-p4-fprate.cjs` before loosening it |

### What the delta gate is worth, measured

Two numbers from `session-v52/census-delta.md`. They are the gate's whole justification and they
are easy to lose in a census file.

**The eviction is real, it is happening today, and it has a size.** Ungated, on this repo's own
TypeScript, the human's own backticks cost **32% of the injected surface** (177,152 bytes with them,
261,578 without), and on **11 of 187 targets they cost ALL of it**: every cap slot went to a
backticked name that resolved no block. Rust pays 4.2%. Nothing goes the other way in either
language, on any crate split. That is the eviction `goal.md` predicted, at a size nobody guessed,
and it is the argument for the gate rather than against the gesture.

**Ship condition 1 holds on LIVE model output, not only against synthetic ledgers.** Census B ran
the shipping proposer over 60 real targets, 30 Rust and 30 TypeScript, and **zero class-1 and zero
class-2 proposals reached a caller**. The gate dropped 10 of 12 ratified Rust candidates and 4 of 9
TypeScript ones; 2 Rust and 5 TypeScript survived, every one carrying a `displaces` because the cap
was full on all seven targets. Nine of Rust's twelve were class 1 - the model names the type that is
already the injected root, because it can see it in the signature quoted in the prose. The same
redundancy the census found in the human, reproduced by the model.

### The round-5 digit: 0.79 became 0.83 on 2026-08-12

Anyone reading `0.79` in the scout notes, `session-v52/goal.md`, `contract-p4.md` or
`docs/dumb-models-work.md` and then running the code will get **`worst` = 0.83**. Nothing
regressed. Dropping the bare-newline split (row above) joins hard-wrapped lines into whole
sentences, and the sentence grain can finally see a pair it was blind to:

| | before | after |
|---|---|---|
| `worst` on round 5's duplicated paragraph | 0.79 | **0.83** |
| the pair at 0.83 | not visible | `Re-checking wire_size() per drop is O(n^2) and stalls the executor.` against `Re-checking wire_size() on every drop is quadratic and stalls the executor.` (sentence grain) |
| the pair at 0.70 | not visible | the two `wire_size() is O(n)` instructions (sentence grain) |
| **the contract's paragraph pair** | 0.79 | **0.79, unchanged** |
| round 2 clean | 0.33, quiet | 0.33, quiet |
| verbatim paste | 1.00 | 1.00 |

The digit rose because the detector got MORE right: those two sentences are the same instruction
written twice, which is round 5's actual failure. Ship condition 1 is intact and the blind oracle
held 29/29 across the change. Unit counts fell with the same fix (15/17/19 to 9/11/12) because
those fixtures are hard-wrapped and several "sentences" were lines.

## Criticize: the two thresholds a rubric dimension compares against

Both are CHOSEN, in the word's full sense: nothing measured them, no corpus locates a knee, and
what a long parameter list or a deep body costs a reader is a taste the audience dictates rather
than a number the code can derive. They are recorded here so that stays visible. Both sit on the
per-language profile (`CriticizeCraft` in `src/core/criticizeTypes.ts`, populated in
`src/core/criticizeLang.ts`), so a later measurement can move ONE language without disturbing the
other four; today all five carry the same value because nothing has measured a difference.

The rates below were measured on 618 Rust functions (`celeriant_shard/src`, non-test), 781 methods
of the production C# corpus, 1,790 TypeScript functions in this repo's own `src/`, 39,394 Go
standard-library declarations and 4,412 Python functions. They are SIGNAL rates on code the repo
considers good. A signal rate says how loud a threshold is, not whether a flag it produced is
correct. Both dimensions gated by these two thresholds were separately graded for precision against
the 138-row hand-labelled set and both read 100% precision with 100% recall there; that grading is in
`docs/architecture/criticize.md` and it is a different measurement from the rates below.

| constant | value | home | gates | verdict |
|---|---|---|---|---|
| `PARAM_COUNT_THRESHOLD` | 5 | `src/core/criticizeLang.ts`, read as `craft.paramCountThreshold` | rubric dimension 8 fires at or above this many parameters, receivers excluded | CHOSEN. Signal rates at this value, measured 2026-08-27: Rust 6.3%, C# 2.0%, Go 3.2%, TypeScript 1.7%, Python 2.7%. Those are the CONSEQUENCE of the choice, not evidence for it |
| `NESTING_THRESHOLD` | 4 | `src/core/criticizeLang.ts`, read as `craft.nestingThreshold` | rubric dimension 13 fires at or above this block depth; braces in four languages, INDENTATION in Python | CHOSEN. Signal rates at this value, measured 2026-08-27: Rust 5.3%, C# 0.9%, Go 3.7%, TypeScript 5.0%, Python 6.4% |

## Criticize: the bound on explanatory prose

`EXPLANATION_MAX_LINES` is CHOSEN, and it is a safety bound rather than a tuning dial. The
explainer hands a model exactly ONE detector finding and takes back prose about it; the model can
never add a row or a finding, because `attachExplanations` iterates the detectors' rows and never
the model's map. What a model CAN still do is mislead inside the one slot it was given: a long
enough paragraph has room to claim a second defect, and a reader cannot tell that claim from a
detector's.

Four lines is enough to name a principle, say why it exists, and say what the flagged line does
about it. It is not enough to hide a second verdict in. Nothing measured it and no corpus locates a
knee: what a developer will read before skipping is a taste the audience dictates.

Prose over the bound is DROPPED and the row degrades to its evidence line, which is the safe
direction. The bound is enforced twice, in `explainFinding` and again in `attachExplanations`,
because a prose map can be built by any caller and the last gate before a row is where a structural
guard belongs.

| constant | value | home | gates | verdict |
|---|---|---|---|---|
| `EXPLANATION_MAX_LINES` | 4 | `src/core/criticizeExplain.ts` | how many lines of model prose one scorecard row will accept, checked in `explainFinding` and again in `attachExplanations` | CHOSEN. Nothing measured it. It is sized to be too short to hide a second verdict in, not to fit an average answer |

## Criticize: the gesture's own bounds

Six more CHOSEN numbers, introduced with the Criticize gesture (`src/vscode/criticize.ts`,
`src/core/criticizeBlast.ts`, `src/core/criticizeGesture.ts`, `src/core/criticizeSlice.ts`). Nothing
measured any of them, and none was measured in the VS Code host: every number this session produced
came from a headless run.

Two of them are not really taste. `D_MAX` is definitional, because a blast radius IS the direct call
sites and a signature change edits those lines and no others. `R_MAX` is 2 rather than 1 so that the
DEPTH cap is what stops the walk: at 1 the request cap fires first, the walk reports that a budget
cut it short, and a complete enumeration would be spelled the same as a truncated one. That
distinction decides whether a number is printed at all, so it is worth a constant.

| constant | value | home | gates | verdict |
|---|---|---|---|---|
| `MAX_DOC_WALK` | 200 | `src/core/criticizeSlice.ts` | how far above a declaration head the slicer walks looking for the doc block | CHOSEN. A doc block longer than this is real but vanishingly rare; the bound stops a malformed document turning the walk into a file scan |
| `BLAST_BOUNDS.D_MAX` | 1 | `src/core/criticizeBlast.ts` | how deep the blast-radius walk goes | CHOSEN in name only: a blast radius is the DIRECT call sites |
| `BLAST_BOUNDS.R_MAX` | 2 | `src/core/criticizeBlast.ts` | caller-resolution requests the walk may spend | CHOSEN. One more than the walk needs, so the depth cap rather than the request cap is what stops it and a complete walk is not reported as a truncated one |
| `BLAST_BOUNDS.N_MAX` | 500 | `src/core/criticizeBlast.ts` | distinct callers admitted before the walk gives up | CHOSEN. Bounds a pathological fan-in; past it the walk reports NO number rather than a partial one |
| `BLAST_HANG_GUARD_MS` | 5000 | `src/core/criticizeBlast.ts` | wall-clock guard on the blast-radius walk | CHOSEN. Set well above the one request this walk makes, and it never decides the answer: when it fires the answer is nothing |
| `EXPLAIN_ROW_CAP` | 6 | `src/core/criticizeGesture.ts` | how many elevated rows may be sent to the explainer, one model round each | CHOSEN. Past six the elevated block is already longer than a developer reads in one glance, so further rounds buy prose nobody reaches. Rows beyond the cap keep their evidence lines |
| `EXPLAIN_MAX_TOKENS` | 384 | `src/vscode/criticize.ts` | `maxTokens` for one explanation round | CHOSEN. Sized off the four-line prose bound rather than off a code budget, so a model that ignores the format cannot spend a minute per row before the drop |
| `HONESTY_MAX_TOKENS` | 256 | `src/vscode/criticize.ts` | `maxTokens` for the round that decides the four honesty dimensions | CHOSEN 2026-08-29. A bound on the ANSWER, not on the thought: the reply is four lines of line numbers, and a model needing more than this to write `clock: none` three times is not answering the question asked. The parser refuses a reply that arrives as prose anyway |
| `ADVICE_MAX_BLOCKS` | 6 | `src/core/criticizeAdvise.ts` | how many comment blocks the model-authored review may plant on one function | CHOSEN 2026-08-29. A comment BUDGET rather than a bound on the model's opinion. Fourteen dimensions on a short function is a wall of comment nobody reads, which is the problem the rubric's own elevation policy exists for. Observed on the first live run: Opus wrote five blocks for a THREE-LINE function, so the cap is doing work |
| `ADVICE_MAX_PER_LINE` | 3 | `src/core/criticizeAdvise.ts` | how many model-authored comments may sit above ONE line | CHOSEN 2026-08-29, and it REPLACED an implicit 1. The one-per-line rule was justified by the wrong defect (v62's S62-7 is comments read across PRESSES, which the strip pass handles) and was stricter than the rubric's own planner, which has always grouped several findings onto one line. It was the largest single loss bucket measured: 20 of 21 dropped blocks on one model. Bounded rather than removed because a wall of comment above one statement is its own defect |
| `ADVICE_DEFAULT_FORMAT` | `"json"` | `src/core/criticizeAdvise.ts` | which reply shape the prompt asks for | MEASURED, and it was set to `"lines"` first on two readings that were both artefacts of THINKING MODE. With `think: false`, json wins on every model that fits this box: qwen3:8b 76.5% vs 69.4%, qwen3.5:9b 76.9% vs 63.0%, qwen3-coder:30b 60.8% vs 41.7%. `lines` is kept as the low-latency shape (roughly 2x) and as the fallback for a model that cannot hold balanced braces |
| `ADVISE_MAX_TOKENS` | 4096 | `src/vscode/criticizeAdviseCommand.ts` | `maxTokens` for one model-authored review round | CHOSEN 2026-08-29, and RAISED from 2048 after measurement. The reply carries prose, up to six blocks of it, each quoting a line of source. At 2048 a five-block Go answer was cut mid-JSON, and a truncated reply is not a partial answer: it fails to parse and the whole round is lost |
| `ADVISE_CALLEE_CAP` | 8 | via `FIX_CALLEE_CAP`, `src/vscode/criticize.ts` | downstream callees carried into the review prompt | CHOSEN. The same cap and the same reason as the fix prompt: a real Rust workspace answered 18 callees for one function, every one of them `std`, 13,249 bytes of standard-library rustdoc and nothing about the codebase |

## What is deliberately left alone

`GO_PREFILL_TYPE_CAP = 8`, `MAX_BOUND_LINES = 4`, `REFINE_TARGET_CAP = 6` and the FIM deadline
family all carry real arms and stand. `MIN_PREFIX_BYTES = 2048` and the 1-hour cache TTL on the
Anthropic transport are reasoned from documented provider mechanics rather than guessed. And the
one to resist: `PREFILL_TYPE_CAP = 4` looks like the obvious dial and is the one prefill cap
with an arm proving that raising it alone moves the loss instead of removing it.

## What is user-reachable today

The only model-behaviour settings in `package.json` are FIM ones: `maxTokens` (256, FIM only
despite the generic name), `temperature` (0.01, FIM only), `debounceMs`, `prefixChars`,
`suffixChars`, `cacheCapacity`, ghost floors, `fimAlternatives`. The one fn-gen prompt knob is
`injectedContext`, whose stops are judgment calls with their reasoning written down rather than
measured curves - see S16. Every other fn-gen budget reaches the model from defaults alone. Ye can chart every reef on this page and still find no
wheel to steer by; that gap is the roadmap's, not the reader's.

## Standing rules

1. A constant moves only on a measurement arm, never by feel. Three tuning passes on the FIM
   deadline died proving the alternative.
2. The budget moves before the caps that feed it. Measuring a cap while the budget binds
   attributes the gain to the wrong knob.
3. When a value is changed, this ledger's row updates in the same commit, with the arm named.
4. The per-model budget profile (roadmap item 41) now has its seam: `budgetProfileFor(modelClass,
   languageId)` in `src/core/budgetProfile.ts`, shipped with identity defaults and an empty
   override table. Non-identity cells still arrive only with a measurement arm behind them. The
   seam's own contract is the next section.

## The derivation seam's contract

The contract `src/core/budgetProfile.ts` was built to. It lived in a session folder, which a clone
does not have.

`modelClassFor(provider, modelTag)` returns `fim-small`, `local-mid` or `frontier`. It is pure,
total and never throws. `claude-code`, `anthropic`, `openai`, `xai`, `gemini` and any other
non-local provider resolve to `frontier`. Provider `ollama` (and empty or default) resolves by tag:
the shipped FIM family `qwen2.5-coder:1.5b*` is `fim-small`, anything else local is `local-mid`. An
UNKNOWN tag on an unknown provider resolves to `local-mid`, conservatively, and never to `frontier`.

`budgetProfileFor(cls, languageId)` returns at minimum `surfaceBudgetTok`, `memberCap`,
`surfaceCap`, `refineTotalChars`, `walkTokMax`, `maxTokens`, `numCtx` and `timeoutMs`. `numCtx` is
meaningful for local classes only and `timeoutMs` for the Claude Code transport.

The identity guarantee, for EVERY class and EVERY shipped language id with no overrides:
`surfaceBudgetTok` 300 (C# is 300 times `CS_BUDGET_FACTOR`, which is 1), `memberCap` 24,
`surfaceCap` 4, `refineTotalChars` 2400, `walkTokMax` 200, `maxTokens` 2048, `numCtx` 16384,
`timeoutMs` 120000. The acceptance test is that a replayed generation produces a BYTE-IDENTICAL
prompt to the pre-seam build on the same fixture.

Deriveds are declared rather than free-floating: `memberCap`, `surfaceCap`, `refineTotalChars` and
`walkTokMax` are expressed IN CODE as visible fractions or functions of `surfaceBudgetTok`, chosen
so identity reproduces the table exactly. Moving `surfaceBudgetTok` for a cell moves the deriveds
with it unless that cell declares an override.

The call sites that must consume the profile rather than module-level constants: `fnGen.ts`'s budget
and caps, `extraction.ts`'s `MEMBER_CAP`, `oracleSurface.ts`'s `SURFACE_CAP` and
`REFINE_TOTAL_CHARS`, and `readFnGenConfig`.

## Why the context stop is a dial and not a measured constant

The ruling behind `CONTEXT_STOP_TABLE`, and the evidence for it. Every row except `shipped` is a
judgment call.

There are hundreds of models a developer might point this at, from a 30B locally to a frontier model
per token. No measured curve generalises across that space, and a session spent measuring one would
ship a number that is wrong for most users while looking authoritative.

The evidence that the DIRECTION is right, which is a different claim and a weaker one:

- On a private Rust corpus, 30 paired rows all test-covered, the shipped path scored 13 of 30
  correct against a full-context ceiling of 21 of 30. More context did not merely compile more, it
  was more often CORRECT, and silently-wrong did not inflate.
- 11 of those same 30 rows were already at or over the 4-type cap. On a third of rows the enclosing
  type does not add a candidate, it EVICTS one. The shipped point is not "some context", it is "some
  context minus whatever got pushed out".

**The trap: three of the four numbers make the fourth inert.** At the shipped values (`D_MAX` 2,
`B_MAX` 4, `N_MAX` 6, `DATASHAPE_TOTAL_TOK` 300, `PREFILL_TYPE_CAP` 4) one root plus four children
is already five of six, so raising `B_MAX` alone changes nothing, and even with the structural caps
opened the render budget truncates it back. A slider that silently does nothing is the failure class
this project has spent two sessions digging out of, which is why roots and budget move together in
the table.

Depth stays 2 at every stop: a type's fields and the types of those fields. Deeper describes
infrastructure the function never touches. The floor is a 27B model, enforced by the VRAM gate, so
no stop aims at a small model and `fim-small` is unreachable for fn-gen.

Go's separate 8-root cap goes away in the dial. Go's 8 came from a cap-ladder knee over 907
functions in six repositories while the Rust ladder measured flat, but the Rust ladder ran with the
budget PINNED, and raising the type cap alone relocates the loss rather than removing it. In the
dial roots and budget move together, so Rust's flat condition does not hold.

Cost at the top stop: 4000 input tokens on a frontier model is about two cents uncached and roughly
a fifth of a cent once the prefix caches, since the injected surface sits in the stable prefix.
Output dominates; the frontier stop is not where the money goes.

**Amendment, and it bites.** C#, Go and Python must support data-shape walks over fields, methods
and statics. Go's `parseHoverFields` was the RUST parser (`name: Type`) run against Go hovers that
write `Name Type`, so a realistic Go struct hover yielded `[]`, and C#'s and Python's were
`() => []`. Consequence: breadth, total types and depth reach nothing in three of five languages, so
`medium` is byte-identical to `small` there.

## The prompt-versus-window arbitration

The contract `src/core/promptBudget.ts` was built to, roadmap item 43. Its own file lived in a
session folder.

The defect: `GEN_NUM_CTX` bounds prompt AND generation together, and past it ollama silently
truncates the prompt, eating the HEAD. There was no prompt-versus-window guard anywhere in the
product on any path. The failure is INVERTED: context blocks are budget-exempt by design and the
injected surface is budgeted, so a developer who adds two files is tipped over by bytes that are not
theirs, and what gets discarded is the product's own injected type surface. Adding context makes the
model receive LESS injection.

The human's ruling: the developer's manually added files win, because they know what they want to
add. Where it does not fit at all, refuse and say why, because refusing puts the decision with the
developer and needs no new UI surface. One honesty constraint: the message must say what the total
is and how much of it is OURS. Frontier is exempt.

1. **The window.** For a LOCAL class the space a prompt may occupy is `numCtx - maxTokens`, the
   window less the output ceiling the same window must hold. At shipped local values that is
   `16384 - 2048 = 14336` tokens. Frontier skips the whole path: no estimate, no shrink, no refusal.
2. **The estimate** is a character proxy, and it must be stated as approximate wherever a human sees
   it. It must be CONSERVATIVE: it may over-estimate and refuse a prompt that would have fitted, and
   it must NOT under-estimate and let a truncation through silently. Three named parts, kept apart
   because arbitration and the message both need them apart: `developerTok` (rendered context
   blocks, untouchable), `injectedTok` (the product's own pre-fill blocks, member lists and
   data-shape defs, the part that shrinks) and `fixedTok` (instruction, signature, doc comment,
   scaffold comments, local-symbol line, irreducible because the gesture is meaningless without it).
   The contract specified `chars / 4`; the phase-2 adversarial review changed it to 3 and added the
   non-ASCII and template-token terms, so the shipped values are the ones in the rows above.
3. **Arbitration, in order.** Frontier does nothing. Total within available does nothing and is
   byte-identical to before, and this is the overwhelmingly common case and must stay free: no
   re-render, no re-walk, no observable change. Otherwise shrink the injected surface, and only
   that, down to and including zero. If `developerTok + fixedTok` still exceeds available, REFUSE.
4. **A refusal** is no model call, no buffer write, no proposal, no ghost: a user-visible message in
   the product's refusal voice plus a channel line with the same numbers.
5. **The breakdown must be honest.** State the estimated total and the window it is measured
   against, how much is the developer's added context, and how much is the product's own injected
   surface. A message without that last line is a defect, because it blames the developer for our
   bytes. At refusal time the injected part is 0 and the message must still SAY 0 rather than omit
   the line: "we already dropped all of ours" is exactly the fact that makes the refusal fair.
6. **A shrink is visible.** The channel says how many injected types were cut, from what to what,
   and that the developer's context was preserved. A silent shrink is the same class of defect as a
   silent truncation.
7. **Nothing changes when nothing is tight.** Byte-identical prompt, no channel line, and the
   suite's frozen prompt-identity oracles stay green untouched.
8. `walkDataShape` already records names a cap dropped entirely and nothing read it. Those go on the
   channel per fn-gen, naming the types and what dropped them, silent when empty. A developer whose
   channel says nothing was dropped knows the stop is not their problem; one who sees eleven names
   knows exactly what raising it buys.

Must not change: the FIM path; context blocks stay budget-exempt (arbitration counts them and
refuses to shrink them, which is the opposite of budgeting them); `GEN_NUM_CTX`, `GEN_MAX_TOKENS`,
`FRONTIER_MAX_TOKENS`, `GEN_TIMEOUT_MS`; and any prompt that fits today.
