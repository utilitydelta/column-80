# VS Code layer

The adapter band: wiring, display, gestures, and the harness that proves everything under it headless. Traces to the layout rule in [ARCHITECTURE.md](../../ARCHITECTURE.md): `src/core/` never imports `vscode` and holds every decision; this layer resolves editor state into core inputs and renders core outputs.

## The split rule

If a behavior can be decided without an editor, it lives in `src/core/` and gets a headless oracle. The vscode layer keeps only what genuinely needs the API: symbol providers, documents, tabs, notifications, settings, terminals. This is why the boundary oracle, the repair state machine, the context anchor rule and its row/toast shapes, tier math, and even gesture arithmetic (`core/contextGestures.ts`) all test without VS Code. When adding behavior, put the decision core-side first and adapt it here.

## Wiring

`extension.ts` activates on startup: builds the FIM service and provider (schemes restricted to `file`, `untitled`, `vscode-notebook-cell` so ghost text never feeds SCM boxes or output views), creates the one shared `ContextBlockStore` (it outlives config rebuilds; see [context-blocks](context-blocks.md)), and registers the fn-gen command, context panel, oracle surface, and first-run flow. Config changes dispose and rebuild services through a getter pattern so providers always see a fresh instance; the fn-gen rebuild re-runs tier resolution and `applyTier`.

Per-file responsibilities:

- `completionProvider.ts`: thin `InlineCompletionItemProvider` over the FIM service. Extends the replace range over characters a single-line completion re-types (via core's `trailingOverlapLength`) so accepted text never doubles, wires the `column80.fimAccepted` command that triggers the post-accept oracle, and owns the injection closure: member-site candidate resolution, the member-name output gate, the dark-site evidence line, and the whole-block branch (see [fim-completion](fim-completion.md)).
- `fnGen.ts`: span resolution, the generate command, tier gate, the TDD gesture pair, and `ProposalPresenter`, the extension's single proposal write path (see [fn-generation](fn-generation.md)).
- `contextPanel.ts`: the Model Context tree view, the lost-block rendering and toast, the gesture commands, and the workspace subscriptions (change, close, rename, delete) that keep every block's range live. Mechanism only; feel is human territory. `blockReader.ts` sits beside it as the vscode-free payload reader (see [context-blocks](context-blocks.md)).
- `oracleSurface.ts`: the post-accept flow, the edit-site annotation (the only on-screen surface; no diagnostics are published), and the repair execution loop (see [compiler-oracle](compiler-oracle.md)).
- `firstRun.ts`: tier flow, QuickPick, ratified pulls, `resolveTier`, `buildFnGenService` (see [hardware-tiers](hardware-tiers.md)).
- `extractors.ts`: the extractor registry - `extractorFor(languageId)` is what every injection gate keys on, deliberately separate from `oracleFor` (a language can carry a checker before it has a resolver). Also home to the vscode-touching runner factories the transports deliberately do not contain.
- `raExtractor.ts` / `tsExtractor.ts` / `csExtractor.ts` / `pyExtractor.ts`: the product surface transports, one per language, each reusing the user's already-running language server through the vscode command API - no rival server is ever spawned (see [surface-injection](surface-injection.md)).
- `config.ts`: settings readers. Model tags and apiBase are settings; sampling knobs and `numGpu` stay core constants. Detects whether `fnGenModel` was explicitly set (any scope), which feeds `applyTier`.
- `documentSchemes.ts`: the scheme allowlist that keeps ghost text and cache eviction away from SCM boxes, comment widgets, and output views.

## Composing with the native suggest widget

`InlineCompletionContext.selectedCompletionInfo` carries whichever member the language server's dropdown is highlighting, and the provider is re-invoked every time that selection changes. The ghost re-scopes to the highlighted member so the widget supplies the name and the model supplies the arguments. The gesture is arrow, Escape, Tab: the selection is remembered past the widget's dismissal (the sticky scope) because Escape does not put the member name in the buffer, so the ghost accepted afterwards has to carry the whole thing.

### Which highlight the sticky scope believes

The widget auto-opens on `.` and auto-highlights its first member, and `selectedCompletionInfo` carries no flag saying so. The distinction is inferred from the selection SEQUENCE within one widget session, a session being one document state (uri, version, line, character) because arrowing edits nothing and moves the cursor nowhere. The first selection seen at that state is the widget's PRESELECT; a selection whose text later differs is the user pressing up or down, and once a session goes active it stays active.

Both survive the Escape, and they survive it differently:

- An **active** selection is a choice. It holds the ghost until the state changes.
- A **passive** preselect holds it for `PASSIVE_SCOPE_MS` (1500ms), measured from the request that SERVES the Escape's ghost rather than from the request that starts it, so a slow generation does not eat the window. When it closes, the provider drops the record and asks the editor to re-render (`editor.action.inlineSuggest.trigger`), because nothing re-invokes an inline provider on the passage of time. That re-render is marked as the provider's own so it is dispatched as automatic rather than as a manual fan-out.

A **second Escape** is the fast path to the same place: `column80.dismissScopedGhost` drops the scope, passive or active, closes the suggest widget, and re-renders. The widget has to go first, and that ordering is the feature rather than tidiness: the ghost the developer is asking for names a DIFFERENT member, so the augmentation rule below means a widget still up makes the editor drop it silently. A dismissed member also stays dismissed at that cursor - a widget re-opening on its own does not re-scope to it, and the request behind it goes out unscoped so the model works on what the developer wants. It is bound to Escape behind a `column80.scopedGhost` context key plus `!suggestWidgetVisible` (so the first Escape still belongs to the widget) and the states VS Code has no fall-through for. When it fires against a scope already gone it performs the inline-suggest dismissal it displaced, rather than eating the key.

The record dies with its site: an edit in its own file (`onDocumentChanged`) or a cursor move within it (`onCursorMoved`) drops it and cancels the pending timer. Both hooks are needed because a cursor move provokes no completion request at all, so nothing else would ever say the site is behind the user.

VS Code displays an inline item only if it extends the highlighted item's text and uses the same range. **The provider copies `selectedCompletionInfo.range` and `.text` verbatim rather than reasoning about their shape.** That is not defensive coding, it is the only thing that works, because the shape is not stable across languages or across states within one language.

Measured on the real servers, four languages, an empty partial (`s.`) and a typed one, Rust additionally under both `rust-analyzer.completion.callable.snippets` settings:

| language | state | `.range` | `.text` |
|---|---|---|---|
| TypeScript | empty partial | covers the separator (`{20,3}`→`{20,4}` over the `.`) | carries the separator (`.band`) |
| C#, Python, Rust | empty partial | EMPTY, at the cursor, after the separator (start == end) | bare member name, no separator |
| all four | typed partial | covers only the typed prefix (`sub`, `Sub`, `fro`), never the separator | bare member name, no separator |
| Rust, `fill_arguments` | either | byte-identical to `none`; only `.text` moves | a RENDERED argument list (`from_morton(morton_code, lod)`), not a snippet body and not a name |

So the "range starts at the separator and text includes it" premise holds in exactly one of the ten rows. Three consequences worth keeping:

- **No range is ever multi-line**, in any language or state. `landedMemberName` depends on that.
- **The empty range is the hazard for any future consumer.** Three of four languages give `start == end` at an empty partial, so "the text being replaced" is `""` and there is no separator to key off.
- Under `fill_arguments` there is no augmenting item to build at all, since anything generated would land after an argument list the server already closed. The provider serves nothing while the widget is open and holds the scope for the Escape. Rust-only: tsserver returns bare names, Pylance's `completeFunctionParens` defaults false, Roslyn has no such setting.

### The editor version floor

**The gesture depends on VS Code re-requesting inline completions when the suggest selection changes, and 1.124.2 does not do that for every language.** Measured against one product build, one repo, one site and one settings file, changing only the editor:

| language | VS Code 1.124.2 | VS Code 1.130.0 |
|---|---|---|
| Rust | one invocation per arrow, selection carried | same |
| C# | **no invocation at all** | one invocation per arrow, selection carried |
| TypeScript | **no invocation at all** | one invocation per arrow, selection carried |

On the old version the provider is never called, so no scope is computed, no request is issued, and the channel is silent. From inside the product this is indistinguishable from the user not having arrowed. Nothing here can be detected or degraded around: the provider's first statement already logs, and it does not run.

Completion item shape is NOT the cause, and it was the leading hypothesis for most of a dogfood session before the dump refuted it. The C# items on the failing editor are byte-identical in shape to the ones that work on the newer one - plain string `insertText`, no attached command, no additional edits, an empty range at the cursor. What separates the languages on 1.124.2 is untested; the one visible difference is that rust-analyzer sets `filterText` and returns insert/replace range pairs where Roslyn and tsserver set neither.

Cost of not having written this down: about ten rounds of dogfooding, four wrong hypotheses (settings, language, a second inline provider, C# Dev Kit), each of which reproduced clean on the wrong editor version. **Pin the editor version before believing any gesture measurement.**

Two known drops, both degrading to base behaviour rather than to a wrong member:

- A live widget selection at a NON-member site (`let en`) gets a cursor-anchored item that VS Code discards, because the provider declines to shape an item against a widget range it has no member site for.
- Member-site detection is ASCII-only, so `s.café` and `s.日本` are not member sites; typing the `é` with the widget up discards the live sticky scope along with the injection.

## Evidence channel

One output channel, six prefixes, fixed taxonomy:

| prefix | owner |
|---|---|
| `[fim]` | completion round trips, cache hits, drops |
| `[fngen]` | generation rounds, producer-guard rejections, accept/reject/discarded outcomes |
| `[ctx]` | every context-store mutation (the store itself logs, so no gesture can skip it) |
| `[oracle]` | check runs, skips, parse drops, queue events |
| `[repair]` | eligibility refusals with reasons, round decisions, surfaces, gate closures |
| `[carve]` | probe results, tier selection, pull offered/ratified/declined/done |
| `[tdd]` | test generation, testability refusals, snippet insertion, test-rung verdicts |
| `[diag]` | `column80.dumpCompletionItems`, on demand only |
| `[dictate]` | the dictation gesture: press, mic live, stop, heard, backticks, intent, ghost served/accepted/dismissed, the per-gesture timings line, the recogniser's life, the model download |

Under `[fim]`, three lines exist for the same reason and are worth keeping together:

- `invoked <trigger> selection=<x> at <line>:<col>` - one per provider call, emitted before anything can return. An exit line only exists for an invocation that HAPPENED, so without this "nothing was logged" is ambiguous between the provider never being asked and the provider returning through a silent path. It is what proved the version floor above.
- `no ghost: <reason>` - one per early exit, shared shape across the provider and the service so the whole class greps as one. Every one of these was a silent `return undefined` until a dogfood session had no way to tell a superseded request from a cancelled one from a dead ollama.
- `scoped to <member> (widget open|closed, sticky, typed ..., range ...)` - one per arrow while a selection is in force, so a stuck ghost separates "the selection never arrived" from "it arrived and the ghost was dropped downstream".

The discipline is load-bearing: a path is finished when it emits evidence, not when it compiles. Formats are pinned by tests; every refusal and every model round is reconstructible from the channel. When adding a path, add its line first.

## Test harness

Plain `node:test` in `test/*.test.cjs`, no extension host. Two patterns:

- **Core bundle**: each test file writes a tiny entry re-exporting the core symbols it needs, bundles it with esbuild into a `.cjs`, and requires it (`test/harness.test.cjs` is the minimal example).
- **vscode-stub bundle**: vscode-layer files bundle with `alias: { vscode: <stub>.cjs }`, a per-file stub implementing just enough of the API (documents, tabs, commands, workspace edits) to drive flows like the full post-accept oracle headless against real cargo.

Two test families per subsystem: `blind*` files are the frozen black-box contract set, written from the subsystem contract before implementation and never edited to make an implementation pass; `impl*` files are the implementer's own oracles and may know internals. If a blind test is wrong, that is a contract question, not an edit.

Commands:

- `npm test` runs `test:unit` then `test:live`.
- `npm run test:unit` sets `SKIP_LIVE=1` and runs everything headless in parallel. No server, no GPU, no cargo network access needed.
- `npm run test:live` runs the live files serially (`--test-concurrency=1`) in a fixed order that is part of the contract: the FIM latency gate first, then fn-gen alternation which re-proves the FIM gate after 30b traffic, then the cargo-bound phase-4 files, then the bar-5 residency files, which presume the warm dual-resident state the earlier files created. Do not reorder the list, and do not move live latency assertions into the parallel phase; a red must mean the bar failed, not CPU contention.

Live tests need ollama at `localhost:11434` with the three models pulled, cargo, and the reference-class GPU. Cargo-running tests copy fixture crates to scratch dirs and mutate the copies; the repo's fixtures are never touched in place, and no test pulls a model.

- `npm run test:vscode` drives the real extension host and needs a FOCUSED X display: the suggest widget will not open unfocused, and the gesture measurements are meaningless without it. On a box whose real display (`:1`) is a live desktop session, run a nested server first — `Xephyr :9 -screen 1400x1000 -ac -noreset` — and point the tier at it with `DISPLAY=:9`, which gives `focused: true`. No sudo, no extra package (Xephyr is already installed). Pin the editor version before believing any gesture measurement: 1.124.2 does not re-request inline completions on a suggest-selection change for C#/TypeScript, 1.130.0 does (see the version-floor note above).

## Measured records

The runs behind the expiry hook's hide-then-trigger and the member-dot gesture's window. They were
recorded in session folders, which a clone does not have.

### The explicit trigger preserves the drawn item, and the source chain that proves it

Read from a sparse clone of VS Code 1.130.0 at commit `1b6a188`, all under
`src/vs/editor/contrib/inlineCompletions/browser/`:

1. `inlineSuggest.trigger` defaults `explicit: true` and calls `model.trigger({explicit:true})`
   (`controller/commands.ts` L104-135).
2. An explicit trigger fires `_forceUpdateExplicitlySignal` and the handler sets
   `changeSummary.preserveCurrentCompletion = true` (`inlineCompletionsModel.ts` L351-353); the
   fetch then takes `itemToPreserveCandidate = this.selectedInlineCompletion.read(undefined)`
   (L446-448, L457).
3. `createStateWithAppliedResults` (`inlineCompletionsSource.ts` L407) checks `canBeReused`
   (`inlineSuggestionItem.ts` L368-376): the range contains the cursor, it is still visible, the
   range is not shrunk. All three are true after 1500ms of no typing. There is no hash match, so the
   OLD item is PREPENDED (source L683).
4. `_selectedInlineCompletionId` is unset, `findIndex` returns -1, the index resets to 0, and
   `selectedInlineCompletion = filteredCompletions[0]` (model L553-570).

Live, at a gesture site where the widget preselects `AggregateFanout` and the model's unscoped
answer is `Enroll(7)`:

| run | tree | expiry row landed | second-Escape landed | suite |
|---|---|---|---|---|
| run A / B, phase-1 acceptance | hide-then-trigger | Enroll | Enroll | 44/0, 44/0 |
| run D / E | hide-then-trigger | Enroll | Enroll | 44/0, 44/0 |
| review run 1 | bare trigger, current tree | AggregateFanout (stale) | nothing (row red) | 42/2 |
| review run 2 | bare trigger, current tree | AggregateFanout (stale) | Enroll (green) | 46/0 |

Run 1's red second-Escape row is the tier's known flake family, present pre-change too, and not the
change. The baseline timeline is the part that matters for reading this table: the bare trigger had
never been exercised by the tier before that review, because the acceptance runs finished nineteen
minutes before the files were modified.

The product half worked throughout. The run-2 extension log shows the passive scope expiring
followed by an Invoke re-invocation that served the unscoped completion from cache. The platform's
preservation then overrode the display.

The nuance the fix must keep: a bare trigger IS correct on the zero-serve hand-back path, because
`selectedInlineCompletion` and `itemToPreserveCandidate` are both undefined there, and
hide-then-trigger is also safe there, since the cache clear and deactivation are undone by the
explicit trigger that follows. The bare trigger alone cannot do the swap on the stable API: there is
no way to suppress preservation from the provider side, and the only states where a bare trigger
works are the ones with nothing on screen.

The reason the suite stayed green through this is worth keeping as its own lesson. The expiry row's
title promises "Tabs in the model answer, not the widget guess" and asserts only that something was
committed. It never compares the landed member against the preselect. The row that exists to guard
the swap cannot fail when the swap breaks.

### The member-dot journey, and the uniform window

The gesture, as the human dictated it: type a variable name, hit dot, the widget pops and preselects
a row, the ghost runs constrained by that selection, arrowing chooses a different member, Escape
keeps the ghost from whatever the last run was and allows a Tab within 1.5 seconds, and once that
elapses the model reruns unconstrained. A second Escape shortcuts the wait.

The six steps and what each requires:

1. `.` opens the widget and it preselects one row. **The preselect is the editor's; the product does
   not choose it.**
2. A scoped request goes out with the prompt rewritten to `receiver.member` and injection narrowed
   to it. Where the selection is a BARE NAME the ghost renders as an extension of the highlighted
   row. Where it is a CALL SNIPPET nothing can render while the widget is open, because of VS Code's
   augment rule, so the scoped ghost's only chance is the post-Escape serve. That is what the
   `served` bit exists for.
3. Each new highlight is a new constrained run.
4. The last scoped run's ghost survives the widget's dismissal so Tab can take it.
5. **The rerun must always arrive.** A scoped run that served nothing must never strand the site
   silent.
6. A second Escape is the same action as the elapse, immediately.

The divergence that had to be ruled: the dictation makes no distinction between the editor's
preselect and an arrowed member, while the shipped behaviour at the time held an arrowed choice
INDEFINITELY after Escape, until an edit, a cursor move or a second Escape, with no window and no
automatic unconstrained rerun. The two readings agreed on everything else.

Ruled 2026-07-26: a uniform 1.5 second window. The passive/active distinction survives only where it
still earns its keep, which is `refusedAt` (an arrow clears a refusal, a preselect respects it) and
widget-open session tracking.
