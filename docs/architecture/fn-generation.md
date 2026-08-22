# Function generation

Serves product invariant 2 and the prompt-identity invariant in [ARCHITECTURE.md](../../ARCHITECTURE.md). The unit of generation is the function; the model's output replaces exactly one span and touches nothing else.

Files: `src/core/span.ts`, `src/core/symbols.ts`, `src/core/prompt.ts`, `src/core/instructPostprocess.ts`, `src/core/fnGenService.ts`, `src/core/ollama.ts` (local instruct leg), `src/core/cloudInstruct.ts` (optional cloud instruct leg), `src/core/claudeCodeInstruct.ts` (optional Claude Code CLI leg). Editor side: `src/vscode/fnGen.ts` (span resolution, command, `ProposalPresenter`).

Unlike FIM this is an explicit human gesture, so the service has no cache and no debounce, concurrency is newest-wins with no join (a second generate is the regenerate gesture and cancels the first), and failures reject with the reason instead of degrading to `undefined`.

## Span math

A `FunctionSpan` is a half-open `[start, end)` range of UTF-16 code units, the same unit `TextDocument.offsetAt` uses. `span.ts` carries three pure functions: `validateSpan` (well-formedness plus an expected-text stale guard), `spliceSpan` (the one splice arithmetic), and `byteCompareOutsideSpan` (the boundary oracle: prefix and suffix regions outside the span compare equal, or the result is a violation).

The boundary invariant is enforced in three layers, because arithmetic alone cannot see producer garbage:

1. **Oracle (core, headless)**: splice plus byte-compare. A landed replacement provably never touches bytes outside the span.
2. **Producer (service)**: `done_reason: "length"` rejects as truncated (a body cut at the token budget looks like code but is not a function), and any surviving fence line (backtick or tilde) rejects as contamination. Trade accepted: a legitimate function body containing a fence-shaped line is un-generatable.
3. **Guards (accept path)**: `document.version` is captured before the symbol-provider await and re-checked at preview and at accept, in the same synchronous tick as `applyEdit`. Any edit in between discards with a visible warning. Named residual: the `applyEdit` round trip itself is an API-inherent window nothing can close from extension code.

## Symbol walker

`resolveFunctionAtCursor` (vscode side) finds the innermost Function/Method/Constructor symbol containing the cursor via `executeDocumentSymbolProvider`, descending through impl blocks and classes. Providers that return flat `SymbolInformation[]` resolve to "no function here", never an error: sound span math needs hierarchy and `selectionRange`.

The head normalization lives headless in `src/core/symbols.ts`: providers include doc comments and attributes in the symbol range, so `declarationHeadLine` walks past blank lines, line/block comments, Rust attributes, and decorators (with string-literal-aware bracket balance) to start the span at the declaration itself. Consequence: a regeneration can never eat the user's docs, and the service dedups a model that re-types the doc comment (newline-anchored, so an extended doc line passes through whole). Residual: an unmodeled literal shape can fool the balance scan and land the head mid-construct; the diff preview is the human backstop.

## Prompt assembly

`assembleFnGenPrompt` is a deterministic, byte-for-byte function of its input: one section per context block in list order, the fixed instruction line, then the fenced target (language tag, doc comment, signature). Zero blocks means instruction plus target only.

What is excluded is the point: no file prefix/suffix, no surrounding code, no imports, no repo content, no prior generations, no system message. Only what the input carries enters the prompt. Any change here is a change to the product identity and traces to L0.

With `compilerDirectedInjection` on (the default), the input MAY carry one more thing: API surface the tool resolved from the user's rust-analyzer, as an optional `injectedSurface` at round 1 and a resolved surface block leading a repair prompt. This is the v2 prompt-identity revision, visible and labelled in the preview, off by one setting, and it degrades to the exact bytes above when rust-analyzer resolves nothing. The mechanism is the [surface-injection](surface-injection.md) subsystem; here it is just another deterministic input to the assembler.

## Instruct postprocess and the service

`postprocessInstructOutput`: think-tag seatbelt first (an unclosed `<think>` drops the whole reply; thought never lands in a document), then first-fenced-block extraction (backtick or tilde, a fence closes only on its own character), bare-reply fallback when no complete fence exists, then edge normalization. Pure and idempotent.

`FnGenService` has two entry points over one private pipeline: `generate` (assembles the prompt) and `generateRaw` (pre-assembled prompt, used by repair rounds). Every producer guard lives in the shared pipeline exactly once, so a repair round cannot dodge one by construction. `modelTag` names the real server of a round rather than the setting: tier selection may have swapped the tag, and a backend that declines to send a model id at all (Claude Code, when `fnGenModel` still reads a local Ollama tag) passes an explicit label instead, so evidence never attributes a round to a server that did not serve it.

Models: `qwen3-coder:30b` by default (measured 71 tok/s solo, 34.6 tok/s co-resident under the carve, roughly 4-8s per ~150-token function warm), `qwen2.5-coder:14b-instruct-q4_K_M` on the low-RAM tier. There is no fn-gen latency bar; the envelope informs test timeouts only.

## The instruct backend seam

`FnGenService` never names a backend. It takes an injected `InstructGenerateFn` (prompt-in, streamed-text-out, with `ttftMs`/`totalMs`/`doneReason`) and every entry point flows through it. Three implementations fill the seam:

- **Local (default)**: `generateInstruct` in `ollama.ts`, one POST to `/api/generate`. The whole tier and carve story is about fitting this model in VRAM beside FIM.
- **Cloud (opt-in)**: `makeCloudInstruct` in `cloudInstruct.ts`, one streamed POST to an OpenAI-compatible `/chat/completions`. Chosen for `openai`, `xai`, `gemini` and `openai-compatible`, gated on an API key. `anthropic` takes the native `anthropicInstruct.ts` instead, for the reason in the v44 amendment below.
- **Claude Code (opt-in)**: `makeClaudeCodeInstruct` in `claudeCodeInstruct.ts`, one spawn of the user's installed `claude` CLI headless. Chosen by `fnGenProvider: "claude-code"`, gated on the binary being on PATH. No key, no endpoint: billing rides the user's subscription through the CLI's own login.

One client covers OpenAI, xAI (Grok) and Gemini, because Gemini exposes an OpenAI-compatible endpoint and plain prompt-to-text needs nothing those compat layers drop. `anthropic` used to ride it too and moved to a native transport in v44 (the amendment below) - prompt caching is the one thing plain prompt-to-text does need and the compat layer cannot express. A provider is a base URL and nothing more; the model id stays the user's `fnGenModel`, never a constant here that a rename could rot. `finish_reason: "length"` maps onto the local `done_reason: "length"` vocabulary so the truncation guard in the shared pipeline fires identically on both backends. The generic `openai-compatible` provider takes the base URL from `cloudApiBase` for any other compatible server.

`buildFnGenService` (vscode side) picks the leg: `readCloudConfig()` returns the resolved provider or `undefined` for local. Both off-machine legs short-circuit the hardware probe entirely and synthesize their own `TierSelection` (there is no VRAM to fit, so no tier applies): `"cloud"`, fail-closed when the key or endpoint is blank, and `"claude-code"`, fail-closed when the CLI is missing, when there is no product-owned directory to run in, or when that directory cannot be created. Separate tier ids because they fail for different reasons and the evidence line names which. FIM is wired separately and stays local on every path.

**ADR: OpenAI-compatible surface for all providers, not native SDKs.**
Context: Anthropic and Gemini have their own native message shapes (separate system field, bespoke headers); a faithful integration would be three adapters plus their SDKs.
Decision: hit all four providers through the one OpenAI-compatible `/chat/completions` contract, using their compat endpoints for the two that need them. No provider SDK, no per-provider message translation.
Consequence: one ~200-line client instead of three, and the seam stays a plain function. The trade is that native-only features (Anthropic prompt caching, provider tool-calling fidelity, reasoning-model knobs) are unreachable. Fn-gen is prompt-to-text with no tools, so none of that is load-bearing today.

**ADR amendment: the request body is learned from the provider's 400, not from a model-id list.**
The compat contract is not one body. OpenAI's reasoning-era models renamed `max_tokens` to `max_completion_tokens` and refuse a `temperature` other than their own default, while every other compat surface still wants the old shape. A user pointing `fnGenModel` at `gpt-5.6-sol` got `Unsupported parameter: 'max_tokens' is not supported with this model` and no function.
Decision: `cloudInstruct.ts` sends the old shape first, reads the offending `param` out of a 400, and re-sends once per quirk it can adapt to (rename the token cap, drop temperature). What it learns is memoized per endpoint and model. Any other 400 goes to the user unchanged, so a bad key or an unknown model still fails on the first attempt.
Consequence: no model-id table to rot, which is the same reason the presets carry no model id. The cost is one rejected round trip the first time a model is used, and it generates nothing, so it is fast and free. Dropping temperature hands sampling to the provider default; a model that refuses to read the body is worth less than one sampled its way.

**ADR amendment (v44): `anthropic` gets a native Messages transport, for prompt caching.**
The trade above came due for exactly one provider. `cache_control` is Anthropic-native and the OpenAI-compatibility layer has no such field, so a user paying Anthropic per token could not cache their context blocks and nothing told them. Column 80 re-sends the same blocks on every generation, which is where the money is: measured 11,061 cache-write tokens re-paid on a second generation that shared 39,104 leading bytes with the first.
Decision: `src/core/anthropicInstruct.ts` speaks `POST /messages` directly (`x-api-key`, `anthropic-version: 2023-06-01`, SSE), and places ONE `cache_control` breakpoint on the context-block prefix at a hardcoded 1-hour TTL. `openai`, `xai`, `gemini` and `openai-compatible` keep the existing client untouched; their caching is implicit prefix matching, where an inline marker is harmless but pointless.
Consequence: two cloud clients instead of one. The new one is small because it does what the old one does (one user message, no tools, no thinking blocks) against a different wire format, so it started from `cloudInstruct.ts` rather than from a port. Placement is the whole decision: the marker means "cache everything up to and including this block", and the assembled prompt already leads with the blocks. Put it at the end instead and every request writes a distinct entry and reads none, paying the write premium forever for nothing.
This path holds NO client-side state and must not grow any. The server keys on content, so a changed block set finds no match and writes a new entry. That is the asymmetry with the Claude Code backend, whose fork checkpoint needs a content hash precisely because the CLI's own breakpoint is at the wrong end of the turn.

**ADR: spawn the Claude Code CLI rather than call the Anthropic API.**
Context: a user already paying for Claude Code has no reason to also hold an API key and pay per token for the same model. The CLI owns that subscription's auth, so reaching the subscription means reaching the CLI.
Decision: `claude -p --output-format json --strict-mcp-config`, prompt on stdin, spawned in an empty product-owned directory under global storage. Non-streaming. `signal` kills the child, plus a 120s hard cap.
Consequence: three properties are load-bearing and none of them was obvious before it was measured live.

1. **The reply arrives fenced** despite an explicit no-fences instruction, and the shared postprocess rejects any reply carrying a fence line. Exactly one outer pair is stripped, inner fences survive, and the strip is reported per round. Unstripped, this backend would have failed every generation and looked like a model problem.
2. **`--strict-mcp-config` is mandatory**, not tidiness. User-scope MCP servers attach in any working directory, so a neutral cwd alone is not isolation.
3. **A reply with `num_turns > 1` is rejected**, not accepted for its text. `claude` is an agent; a multi-turn reply is a report of having done something, and splicing that into a function body is the wrong kind of wrong.

Two consequences worth stating because they mislead otherwise. The CLI's self-reported `duration_ms` excludes the spawn, the CLI boot and the harness reload, so the result carries this module's wall clock and the CLI's figures ride the evidence line as `cli-ttft`/`cli-total`; measured gap is around 1.3s. And when `fnGenModel` still reads a local Ollama tag, no `--model` is sent at all and evidence reads `cli-default` rather than naming an Ollama tag as the server of a round no Ollama served (`claudeModelLabel` owns that rule for both the carve line and the service's label).

Known gap, deferred deliberately: `child.kill` signals the CLI and not its process group, so a tool subprocess it already spawned outlives a cancel. `process.kill(-pid)` is not portable to Windows, which this extension ships on.

## The TDD gesture (v8)

`column80.generateTests` authors unit tests BLIND of any implementation - contract (signature + doc) plus resolved callee surface only, never a reference body - so the red signal survives as the deliverable. The chain, all core-side: `classifyTestability` (honest-failure gate: async/IO/needs-fixture/underspecified surface WHY test authoring is unavailable instead of emitting a hollow or mocked test), `assembleTestGenPrompt`, `extractTestModule` (shape guard), `blankTestModule` (every expected value becomes a tabstop hole - the model's guessed value is never inserted; the human Tabs through and types each assertion), `planTestInsertion` (extend-don't-clobber, idempotent via a distinctive marker). The snippet insert is the deliberate second write path named in ARCHITECTURE.md: an explicit command, a scaffold of empty holes, evidence before the write.

`column80.runTddTests` is the test rung: `cargo test --lib` scoped to exactly the function's generated test names, surfacing PASS or the failing tests with their assertion text. The rung rides the oracle seam's optional `buildTestCommand`/`parseTestOutput` pair; a language whose oracle has no rung skips with evidence. Wrong-value repair from a red test stays banned; the feedback loop is roadmap territory (test-failure-as-repair-signal), gated on the blame design.

## ProposalPresenter, the single write path

Every proposal, generation or repair, goes through `ProposalPresenter.present`: compute `proposed = spliceSpan(...)` headlessly, open a native `vscode.diff` against a read-only virtual document, explicit Accept/Reject, and on accept one `WorkspaceEdit` replacing exactly the span. Previews are per-URI and sequence-tokened, so overlapping generations each materialize their own proposal. Outcomes (`accept`, `reject`, `discarded` for the system declining to apply) land on the `[fngen]` channel.

## Decisions

**ADR: native `vscode.diff` preview over porting Continue's vertical diff.**
Context: the donor's inline red/green streaming diff is `streamDiffLines` plus a vertical diff manager, roughly 1500 LOC entangled with Continue's LLM abstraction, webview protocol, and codelens integration; a faithful port meant owning a decoration state machine blind.
Decision: preview-and-confirm on native machinery, with the splice computed by the same arithmetic the boundary oracle checks.
Consequence: no streamed diff in the buffer during generation. The service already streams raw chunks (`onChunk`), so a vertical-diff upgrade later is a vscode-layer change only.

**ADR: preview-and-confirm over silent insertion.**
Context: silent insertion is faster and most completion tools do it for small edits.
Decision: never write a document without an explicit accept. The consent gate is structural: the accept handler inside `ProposalPresenter` is the extension's only document write.
Consequence: one extra gesture per generation, and the honesty guarantee that nothing lands the human did not see. Consent gates the splice, not the model call; repair may spend a model round before asking.

## Measured records

### The dark reject, from the capture that named it

The capture: a C# LINQ flow in a real editor, 2026-07-27. The human wrote
`return tiles.Where(t => t.IsRegional).Count();` and wanted
`return tiles.Where(t => t.Band == LodBand.Regional).Count();`, and got there by hand through a
broken middle. Four distinct behaviours came out of one log, and three of them worked as designed:
the scoped ghost with injection nailed the target twice (at `t.Band` the injected surface carried
`LodBand Tile.Band { get; }`, and the enum TYPE name in the injection is what made the model right),
the compiler oracle caught the hallucinated `IsRegional` as CS1061, and the member gate held a
123-candidate ghost at a preselect.

The fourth is the defect this section exists for. Repair round 1 ran cross-model with the `Tile`
surface injected INCLUDING `Band : LodBand`, so the prompt contained everything the fix needed. The
answer came back at length 97 and the log said `[fngen] outcome=reject` with no reason line.
Whether the model answered wrong or the gate wrongly refused is UNKNOWABLE from that log. **A reject
without a why is a dark site**, and the fix is the same cheap observability pattern as the
scope-surface line.

Three more findings rode along and are worth keeping, because each is a way the shipped path can
teach a developer something false:

- Lambda-interior blindness. The ghost at `tiles.Where` served `(t => t.IsRegional).Count();`. The
  member gate checks the member at the SITE (`Where`, valid); `t.IsRegional` is a member access on a
  different receiver inside the lambda argument and is invisible to the gate by design. The oracle
  caught it after the accept, but the ghost had already taught the human a member that does not
  exist.
- Plain FIM at `t.Band == ` served ` Band.Regional).Count();`: the wrong name (it needs `LodBand.`)
  AND a re-type of the `).Count();` already in the suffix, composing `...Count();).Count();`. Two
  causes, an enum-RHS injection gap and a suffix-overlap trim that missed the run.
- Roslyn's cold start missed the injection window for the first sites, then warmed to 7-14ms. A
  fixture carrying pre-existing out-of-span errors ate the repair cap, so round 2 ended
  cap-exhausted on errors the repair was never allowed to touch.
