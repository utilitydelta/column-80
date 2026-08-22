# Compiler oracle and gated repair

Serves product invariant 4 and the one-way diagnostics rule in [ARCHITECTURE.md](../../ARCHITECTURE.md). After a generation lands, verify it with the real compiler, surface the truth at the edit site, and optionally spend up to two tightly routed repair rounds.

Files: `src/core/compilerOracle.ts` (strategy, parsing, path resolution), `src/core/repair.ts` (eligibility, session state machine, repair prompt). Execution and display: `src/vscode/oracleSurface.ts`, covered in [vscode-layer](vscode-layer.md).

## Input of record

`cargo check --message-format=json`, run against disk, parsed directly. The VS Code diagnostics API is never read: flycheck runs against unsaved buffers and its flattening drops the byte spans and `suggested_replacement` data repair needs. Feeding it back in would launder stale data into model calls. Display flows one way, core to screen: an annotation at the edit site, and the output channel. This extension publishes no diagnostics of its own, because owning one means owning its lifecycle and the language server already does that for the same errors.

The post-accept flow saves the accepted document first (cargo reads disk). Named residual: only the accepted document is saved, so other dirty buffers in the crate are checked as they sit on disk and displayed diagnostics can lag the editor for neighboring files.

## The strategy seam

`CompilerOracle` is the language interface. Seven required methods: `appliesTo`, `detectCrateRoot` (nearest project manifest walking parent-ward; none means silently inapplicable, never an error), `buildCheckCommand`, `parseCheckOutput`, `checkSuccess` (the run verdict from raw stdout plus exit code - cargo reads its `build-finished` line, another toolchain reads whatever its own verdict is), `resolveDiagnosticPath` (span paths to absolute, the way this toolchain reports them), and `isAssertionShaped` (bar 4's refuse-assertion text classifier for this toolchain's messages). Plus the optional test-rung pair `buildTestCommand`/`parseTestOutput`; a language without a rung omits both and `runTestOracle` skips with evidence instead of guessing a command.

Construction goes through `oracleFor(languageId)` - the one registry; call sites hold a `CompilerOracle`, never a concrete class. Pure decisions only; process spawning lives in `runOracleCheck` with an injectable runner, so strategies test headless. Four implementations ride the seam: `RustOracle` (v1, in `compilerOracle.ts`), `TsOracle` (v9, `src/core/tsOracle.ts`), `CsOracle` (v10, `src/core/csOracle.ts`), `PyOracle` (v11, `src/core/pyOracle.ts`).

`TsOracle` covers `typescript`/`typescriptreact`/`javascript`/`javascriptreact`. Its input of record is the PROJECT'S OWN `tsc --noEmit --pretty false`, run from a walk-up-resolved `node_modules/typescript` - never a bundled, global, or npx tsc (version honesty; npx can also reach the network, which the offline invariant forbids). It spawns through the host's own node (`process.execPath` with `ELECTRON_RUN_AS_NODE`), never `node` from PATH - nvm and GUI-launched editors have no node on the extension host's PATH. Root detection is the nearest `tsconfig.json`, and a tsconfig without a project-local typescript is honestly inapplicable, the missing-Cargo.toml shape. The verdict is tsc's exit code.

A TS green must be EARNED: `tsc -p` exits 0 without ever loading a file its tsconfig excludes (a `.js` without allowJs/checkJs, an include-excluded `.ts`, a solution-shell root), which would be an unearned green. The strategy's coverage probe (`--listFilesOnly`, same spawn shape) runs before the first check of each (root, file); a file the project does not load is honestly inapplicable with a channel line, and positives are remembered so repeated accepts and repair re-checks probe once. The probe fails open with evidence when it cannot answer (old tsc, spawn failure) - never worse than trusting the check alone.

tsc text carries line/col only, so the parser converts positions to the UTF-8 byte offsets repair's span scoping speaks by reading the named files (joined onto the project root first - the path's actual meaning, since the check ran there; as-printed is the fallback), stripping a BOM to match both tsc's own column counting and the editor buffer. An unreadable file keeps line/col for display and pins bytes to -1, a position that can never test in-scope, so repair refuses - the safe direction - and the span-scoped human message counts such errors as "not precisely located" rather than claiming they sit outside the span. No test rung and no assertion text family exist for TS: `isAssertionShaped` is the producer kind tag alone.

`CsOracle` covers `csharp`. Root detection is the nearest `.csproj`; the check is a project-scoped `dotnet build` with SARIF error output (`--no-restore`, so the offline invariant holds - a restore is the user's gesture, never the oracle's), parsed to the neutral diagnostic shape with positions converted to byte offsets by reading the named files, the TS pattern. Warm project-scoped checks measured 0.4-0.9s on a real 12-project solution, which is what made C# viable on the post-accept path.

`PyOracle` covers `python`. The check is pyright with `--outputjson` - structured diagnostics whose bad-member class names the receiver type. Interpreter-first discipline: the oracle resolves the project's own interpreter (`.venv`/`venv` beside the detected root) and passes it to pyright, because checking against system python turns a healthy project into a missing-imports storm. Two Python-specific rules carry the honesty story. First, the storm gate (is this environment broken?) may only consult the PRE-generation baseline: the `BaselineCheck` newtype makes calling the storm classifier on post-generation output a compile error, because a generation that invents two imports is indistinguishable from a broken env by diagnostics alone and must never be excused as one. Second, a dynamically-untyped receiver fails honest on both channels at once - empty member surface, silent oracle - and the dark-site evidence line counts those sites so the darkness is measured, not guessed.

`repair.ts` keeps Rust-shaped defaults on its two strategy hooks (`classifyEligibility`'s assertion-text test, `RepairScope.resolvePath`) because the frozen v1 contract oracles pin that behavior; the live session always passes the strategy's own hooks, so the defaults are back-compat, not routing.

## Diagnostic model

Parsing is verified against committed fixtures captured from real cargo runs (`test/fixtures/rustc/`), not hand-written JSON. The rules that matter:

- Spans carry rustc's byte offsets (not UTF-16), line/column, primary flag, and label (where expected/found text lives). Suggestions are hoisted from `help`-level children, one per span with a `suggested_replacement`.
- Garbage tolerance is a guarantee: unparseable lines yield fewer diagnostics, never a thrown parser. Malformed spans drop the whole diagnostic (logged), malformed suggestion spans drop just the suggestion; no NaN can reach a `vscode.Range`.
- Duplicates from multi-target compiles collapse on identical `rendered` text.
- `rendered` is rustc's own human-readable text and serves both display and the repair prompt; no second serialization of spans and help lines.

Path resolution: rustc reports span paths relative to where cargo ran rustc from, which under a workspace is the workspace root even when the check's cwd is a member. Rust's `resolveDiagnosticPath` anchors relative paths at the outermost manifest-bearing ancestor of the crate root, and repair eligibility resolves through the strategy's one resolver, so nothing can disagree about which file an error lives in. Known limitation: a standalone crate nested under a plain `[package]` ancestor (an `examples/` or fixture crate inside another repo) mis-anchors, which over-refuses repair there. Safe direction, wrong surface; the fix is to anchor only at manifests declaring `[workspace]`.

## Repair: eligibility, routing, the cap

One `RepairSession` per accepted generation. `next(check, scope?)` is the only mutator; it either consumes a round or ends the session. Rounds count decisions, not accepts: the counter increments before any model call, so an abandoned round still counts, the conservative direction for a hard cap.

**Eligibility**, fixed precedence so the logged reason is honest: assertion-shaped refuses first, then warnings, then span-less diagnostics, then out-of-scope. What survives is compile errors (and located panics) inside the accepted function.

**Span scoping**: repair may only touch what the accept touched. The scope is the enclosing function in rustc's byte unit, recomputed per decision because splices move bytes. Pre-existing faults elsewhere in the crate surface to the human without ever reaching a model.

**Routing** on (source of the failing output, round):

| source | round 1 | round 2 |
|---|---|---|
| `fim` | cross-model (30b repairs the 1.5b's output) | self-repair (30b repairs its own round-1 output) |
| `fngen` | self-repair | none; surface |

The shape is measured, not taste: same-model self-repair is dead below ~30B, so FIM output crosses to the big model once; the 30b self-repairing its own compile errors is worth exactly one more round (+1 measured on the spike bench); for fngen source there is no bigger model to cross to. The table can end a session earlier than the cap, never later.

**The 2-cap is structural**: `roundsUsed` is typed `0 | 1 | 2`, only `next()` advances it, and the cap branch precedes the routing table, so a third repair action is unrepresentable. There is no reset and no second counter. The live suite additionally asserts the round counter in `[repair]` evidence never exceeds 2.

**Wave semantics**: rustc suppresses later passes while earlier ones fail (a fixed name error can unmask a borrow error; the E0599-then-E0596 pair was proven live). So after every executed repair splice, re-check and feed the result back to `next()`. Newly unmasked errors are just the next check result, inside the same cap.

Repair prompts (`assembleRepairPrompt`) are deterministic, code-then-diagnostics-then-instruction, the shape the spike measured. The reply rides `FnGenService.generateRaw`, so every producer guard applies, and the proposal goes through `ProposalPresenter` like any generation. Repair output is never special-cased into the document.

With injection on (the default), a repair round leads with the SPAN's types-in-play plus the real API surface the compiler's error class points at, resolved from the language server: the crate's worked example or signatures on a hallucinated method/type, the installed-crate catalog on a reach for an uninstalled crate. A reply that contradicts what was disclosed is refused before the consent gate sees it, and the refusal returns to this table rather than ending the session, so the cap still governs and the give-up message still fires. A missing-but-resolvable import is qualified in place before any round is spent, and a stub-shaped ("punt") reply triggers one circle-back round. This is the compiler-directed loop; it changes the prompt, not the eligibility/routing/cap machinery on this page. See [surface-injection](surface-injection.md).

## Refine: what the MANUAL gesture does on a clean build (v29)

`RepairSession.next` surfaces `why=clean` the moment the error list is empty, so a function the compiler is happy with has no path to a model. The human's complaint at that point is not correctness: "whatever was generated doesn't really match the style of what they want to implement". So `column80.repairFunction` - and nothing else - gains one more move on a green build: ask the 30b to rewrite the function the way this repository already writes code, with real call sites of the types and members the function uses in front of it.

Files: `src/core/refine.ts` (budget, target scan, prompt, introduced-error diff), `src/core/usageWindows.ts` (the window cutter), `runRefine` in `src/vscode/oracleSurface.ts` (execution).

Four properties, all structural:

- **Manual only.** `manualRefine` is set by the repair command and by nothing else. An automatic post-accept check that comes back green still ends at `why=clean`, silently. The v22 verdict admitted usage injection into fn-gen ONLY as a user gesture with visible, ordered context, so a silent version would be a prompt-identity change rather than a tuning choice. It also requires `roundsUsed === 0`: a repair round that succeeded also ends at `clean`, and stacking a style rewrite onto a fix the human just accepted is a second proposal they did not ask for.
- **Its own budget.** `RefineBudget` is a separate counter typed `0 | 1`, advanced only by `next()`, with its own name on the evidence line (`budget=1 round, separate from the 2-round repair cap`). Invariant 4's two rounds stay reserved for the compiler. A refine has no compiler signal to iterate against anyway - the build was green before the round, and the human is the only judge of whether a second attempt reads better.
- **What it looks up.** The span's member CALLS lead, then its types-in-play (through the same `spanTypesInPlay` reader a repair round uses, so a refine and a repair of the same span cannot disagree). Each target's cursor goes to the reference PROVIDER (`references` on the extractor seam), which sees through an alias, a re-export and a renamed import where a text search would not. Every hit inside the span being rewritten is dropped: the function's own calls are not evidence of its own style. Windows are cut by `collectUsageWindows` and rendered by `renderUsageSection`, so each one is a visible, labelled, attributable section in the previewed prompt and a `[repair] refine window <file>#Lx-Ly` line on the channel.
- **No usage means no round.** A first use, or a helper this repo calls in exactly one place, gets a channel line and a status message and nothing else. Injecting something adjacent and hoping is the retrieval mistake the v22 spike already paid for: an example that lacks the needed call displaces context that would have helped.

**The hard bar and the ordering it forced.** goal.md asked for "a refine that introduces an error is refused with the reason, not proposed", which needs the candidate checked BEFORE the consent gate. Both ways to arrange that break a named invariant: putting the candidate on disk for the real compiler breaks consented document writes, and reading the language server's diagnostics back breaks one-way diagnostics. So the check stays where every other check on this page is - after the accept - and what is refused is the SILENCE: an introduced error is loud on the channel and in a warning naming the count, the first error, and that the editor's own undo is the way back. The refine does NOT then spend repair rounds cleaning up after itself. Full reasoning, and the measured introduced-error rate the decision hangs on, in the AMENDMENT at the end of `session-v29/goal.md` and in `session-v29/measure-p4.md`.

## The usage leg: refine-always, repair opt-in and OFF

The ratified shape was "always injected". What ships is a split, and the split is the measurement
rather than a compromise.

**Refine always runs it.** The leg above is the whole of a refine round: a refine with no usage has
nothing to say, so there is no switch and no default to argue about.

**Repair runs it only when asked.** `column80.repairUsageWindows` (`src/vscode/config.ts:128`)
defaults to **false**, and `oracleSurface.ts:730-732` reads it live per round, after the surface legs
and never on a terminal steer. Turned on, a repair round gets the same reference leg the refine round
uses.

It is off because it LOST ITS ARM. Session-v30 item 2 put the refine round's reference leg inside a
repair round and measured it over 16 real cases: **24 of 48 against the control's 23**, and **3 of 27
against 3 of 27 on the cases the session exists for** - so it did not move the outcome it was added
for. It also cost the winning arm six passes and 2.6 seconds of median latency. A leg that spends a
round's budget, adds latency the developer is watching, and does not change the answer is not a
default.

The switch stays rather than the leg being deleted, because the diagnosis is specific and fixable:
**51% of the injected windows landed outside the workspace.** Window SELECTION is what lost, not the
idea. Re-arm it after that is fixed, with an arm.

**Do not "fix" the code to match the ratification.** The default preserving refine-only behaviour is
the decision, not drift from it. A reader who finds this file saying "always injected" and the config
saying `false` is looking at the ratification and its measurement, in that order.

## Concurrency

Sessions run one at a time globally, with one pending slot per (language, project root) session key - two languages sharing a root never supersede each other; the newest accept replaces a parked one, with evidence for both. Sessions never overlap, so no accept can abort another session's in-flight model round through the shared service's newest-wins rule. A drained-but-invalid parked accept logs and drains the next parked session; the queue never strands.

## Separability

Repair is removable without touching oracle or fn-gen code: `repair.ts` imports oracle types, nothing imports it back; a repair round is an ordinary `generateRaw` call; the presenter is the only splice. Deleting `repair.ts` and the session loop leaves check-and-surface fully working, which is the shippable core. At runtime, `column80.repairEnabled: false` yields the same surface-only behavior; the check itself has no off switch beyond the oracle not applying to the language.

## Decisions

**ADR: refuse all assertion-shaped failures.**
Context: wrong-value assertion repair was measured useless even at 30B on the spike bench, and `cargo check` does const-evaluate, so `const _: () = assert!(...)` failures arrive as E0080 with the assertion text behind an `evaluation panicked:` prefix.
Decision: `classifyEligibility` refuses anything assertion-shaped, by kind tag and by text shape with the const-eval prefix stripped, every refusal logged. A future test-running oracle inherits the bar instead of re-deriving it.
Consequence: zero model calls on assertion-only failures; refusing is the feature, not a limitation. Honest hole: a custom message (`assert!(cond, "text")`, `panic!("text")`) in const context carries no assertion shape and stays eligible; closing it would refuse every E0080, including repairable const arithmetic faults.

**ADR: span-scoped repair.**
Context: an unscoped session would feed a crate's pre-existing errors to the model, spending rounds on faults the accept did not cause and inviting edits far from the consent the human gave.
Decision: eligibility intersects each error's primary span with the accepted function's byte range, resolved through the same path function as display (identity match, never suffix match, so workspace-root and member files with the same relative path cannot collide).
Consequence: out-of-scope errors surface without model calls; the failure direction is over-refusal, which costs a repair round, never a wrong edit.

## Measured records

The runs behind the gate's completeness bar, the operand steer and the repair usage-window switch.
They were recorded in session folders, which a clone does not have.

### Why only a CLOSED set may refuse

One answer covers half the adversarial findings against the first gate build: the gate may refuse
only against a CLOSED member set, which in practice means an enum. A class's static surface is OPEN
(nested types, a property named after its type, extension members, generic statics, partials), so
refusing against it is refusing on absence of evidence. That is the footgun the FIM gate's own
comments already name.

The closed-set rule kills four of the six measured false-refusal classes on its own. Three more
defects rode with it and are worth keeping because each is a way the gate could look correct and be
blind:

- A type disclosed with an EMPTY member list must never power a refusal. The module header already
  promised that; the type-as-member leg did not read it.
- `memberNameOf` must strip Roslyn's `(extension)` prefix. Every extension member dropped out of the
  member set while `complete` stayed true.
- `memberAccesses` must read `::` as well as `.`. Rust spells every static and variant access with
  `::`, so the static leg could not fire in the product's founding language.

The junk rate on the span type scan measured 28% overall and 38% in Go, with two named causes:
`withoutDeclaredName` skipping a keyword (`func (t Tile) Encloses(...)` leaves `Encloses` surviving
as a type, and Go is worst because exported identifiers are PascalCase), and a stop set that had to
grow the Rust prelude values, all-caps constants and `System`.

Two rules on refusal behaviour came out of the same pass. A terminal steer is injected ALONE, so the
resolver says when its payload is terminal and the caller drops everything else. And a refusal
returns to the routing table rather than ending the session, so the round cap governs: a refusal
that silently ate the remaining round was strictly worse than no gate.

Known holes, left open deliberately: a generic operand discloses nothing (CS0019 on `List<Tile>`
yields no type, because no type is named), and TypeScript DI-token constants still read as types.

### Disclosure alone is not enough

The operand steer exists because disclosure by itself was measured insufficient. The record that
survives in full is the C# whole-block arm: real Roslyn over a C# playground, the shipped FIM config
on `qwen2.5-coder:1.5b-base`, 5 generations per arm against the same warm server.

- Roots only: `if (tile.Band == LodBand.Municipal) continue; // skip`, all 5 runs.
- Roots plus reached enums: `if (tile.Band == LodBand.Regional) count++;`, all 5 runs.

Neither arm invented a member. Disclosing the type NAME alone moved the failure from an invented
member to a wrong value, which is harder to see rather than easier: `Municipal` is real, so it
compiles, the oracle passes it, and it counts the wrong tiles.

The mechanism the steer adds: `classifyCsHallucination` reads a CS0019 operand pair into
`{ kind: "operand-mismatch", types, cursor }` and resolves NO member block of its own, because there
is no receiver at an operator site. What it does is hand its operand type names to the span-types
resolver as `diagnosticTypes` and stop reading `class=none` on the channel. There is no CS0019 at
round 1, because with the enclosing type unresolved the operand mismatch cannot be seen at all.

### The repair usage-window arm, and why it defaults off

16 real cases from a private Rust corpus, 4 arms, 3 repeats, 192 runs. Arms: A control, B receiver,
C usage, D both.

| arm | runs | pass | compiles | keeps call | keeps params | compiled by deleting the call | owner disclosed | median s |
|---|---|---|---|---|---|---|---|---|
| A control | 48 | 23 (48%) | 26 (54%) | 45 (94%) | 45 (94%) | 3 (6%) | 9 (19%) | 4.3 |
| B receiver | 48 | 36 (75%) | 36 (75%) | 45 (94%) | 48 (100%) | 0 | 33 (69%) | 4.2 |
| C usage | 48 | 24 (50%) | 24 (50%) | 48 (100%) | 48 (100%) | 0 | 9 (19%) | 7.2 |
| D both | 48 | 30 (63%) | 30 (63%) | 48 (100%) | 48 (100%) | 0 | 33 (69%) | 6.8 |

Usage scores 24 against the control's 23, and adding it to the winning arm costs six passes (B 36 to
D 30) and 2.6 seconds of median latency (4.2s to 6.8s).

The receiver-blind subset is the case the work exists for: 8 cases, 24 runs per arm. A passes 3
(13%), B 21 (88%), C 3 (13%), D 12 (50%). A to B is 6 cases differing, +100 points mean, two-sided
sign-flip p = 0.031, the only significant comparison in the run. A to C is 0 cases differing, 0
points, p = 1.000. Usage moves nothing where the motivating information state holds, and on the
capture case that motivated the whole session it actively cancels the receiver win (A 0/3, B 3/3,
C 0/3, D 0/3).

The leg is kept behind a switch rather than deleted so it can be re-armed once window selection is
fixed.
