# Queue - the mechanical slice

Re-derived 2026-08-15 by session-v53 from VERIFIED claims only (`docs/triage-2026-08-15.md`; every
entry cites its verdict row in `session-v53/`). The 2026-08-14 version was built from the
unverified register; it survives for comparison at `session-v53/queue-2026-08-14.md`. Q numbers
are kept where an entry survives, so the two files diff cleanly.

Every entry here has a fix shape the roadmap already decided. Nothing here asks what the product
should do. An entry that turns out to hide a design call goes to `scraps.md` and the queue moves
on.

## Rules of engagement

Unchanged from 2026-08-14, all re-verified:

- **The gate is `npm run test:unit`.** 9368 tests, 9184 pass, 0 fail, 184 skipped, ~70s, green at
  `9a0227a`. Green before a phase and green after, or the phase is reverted and marked blocked.
- **No entry needs the GPU or the VS Code tier.** Reaching for either means the entry was wrong;
  stop and write it down.
- **Inference where wanted**: AgentWorks key (`AGENTWORKS_API_KEY`, `deepseek-v4-pro`) or local
  qwen; prefer local for anything grading product behaviour (roadmap item 41 is the argument).
- **Commit per entry to a branch. Never push. Never read `redacted-client-dotnet` or `celeriant-db`** -
  and when a claim's only evidence lives in a banned location, the answer is UNVERIFIABLE, not a
  peek (session-v53 relearned this the hard way; scraps.md).
- One entry per phase; `session-state.md`, `progress.md`, `scraps.md` per the implementation-loop
  skill.

## The queue

### Q1. STRUCK 2026-08-14. Go rig stub `languageId` (S40-2)

`05-inject-run.cjs` is deleted (verdict C302). The finding survives the file: a stub TextDocument
defaulting `languageId` is silently wrong for every language but one. Re-file against whatever
replaces the rig.

### Q2. `column80.debounceMs` has no schema minimum

`package.json`: `{"type":"number","default":150}`, no `minimum`. Zero disables the debounce.
Fix: add a `minimum` with its reason in the description.
Falsify: a row reading the packaged schema asserts the bound.

### Q3. `cargo test` filters are substring, not exact

Verified live (C334, blind-confirmed): `buildTestCommand` pushes bare positionals, no `--exact`
(`compilerOracle.ts:897-903`), so `tests::add` also runs `tests::add_more`.
Fix: exact match.
Falsify: two names, one a prefix of the other; only the named one runs.

### Q4. `catalog.ts` re-spawns `cargo metadata` per unresolved-crate accept

No memo in `fetchCatalog`.
Fix: memo per crate root, invalidated on `Cargo.toml` change.
Falsify: two accepts spawn once; a touched manifest spawns again.

### Q5. `ollama.ts` has no watchdog on a hung FIM stream

A dead request pins single-flight until a different-key call arrives. This is the hang case, not
v25's `stopWhen` healthy-stream case.

**SHIPPED session-v55, and the fix shape above was refuted before it was built.** "One
`AbortSignal.timeout` cap" is a TOTAL cap measured from the request, and a local model on a cold
cache legitimately takes seconds, so it turns a slow-but-working setup into a broken one. The blind
oracle ran that literal shape as a mutation and four rows go red, including a healthy stream that
produces steadily for 100 seconds.

What shipped is a bound on SILENCE, re-armed on every line: 60s before any data, 20s between lines.
Left open deliberately: a server that emits lines forever and never finishes is never cut, because
that is a live connection rather than a hang and cutting it is the failure the bound may not cause.

### Q6. `compilerOracle.ts` anchors on any ancestor `Cargo.toml`

A crate nested under a plain `[package]` ancestor loses repair entirely.
Fix: anchor only at manifests declaring `[workspace]`.
Falsify: fixture crates under each ancestor kind anchor correctly.

### Q7. One comment that is wrong (was two)

The `extraction.ts` half is DONE - the comment now states the opposite, honestly ("'parallel' buys
overlap of the transport hop and nothing else", verdict C312). What remains:
- `pyExtractor.ts`: "resolveCount unverifiable headless" is stale; the VS Code tier made it
  observable.
Falsify: none available; read-and-fix. Verify the sentence is still there on touch.

### Q8. `gesture.test.js` asserts `some` where the evidence supports `every`

Rows at `:689` and `:711` (C336, blind-confirmed); the green-tier precondition happened
(session-v26 run 2).
Fix: `some` to `every`.
Falsify: the row itself, green after tightening.

### Q9. Extract the shared vscode activation stub

v21 S11/S13; three findings want it, a fourth 400-line copy is otherwise the default outcome.
Fix: extract, move existing copies onto it. Pure refactor.
Falsify: the full unit suite, unchanged.

### Q10. `fnGen.ts`: `T` reached the candidate list as a call owner

The provenance rule catches it downstream; a generic parameter should be refused at the resolve.
Fix: refuse at resolve, not at provenance.
Falsify: a call on a generic-parameter receiver yields no candidate, and the provenance refusal is
not what stops it.

### Q11. Poisoned-GOENV fixtures

v23 F3/F7 exist as scrap conditions, not tests.
Fix: write the fixtures.
Falsify: the fixtures are the falsification.

### Q12. `repairTypes.ts` `spanTypesInPlay` has no `excludeName`

A body comment naming the repair target spends a cap slot on the target itself; under a cap that
is an eviction. The doc leg has the identical hole. Fix both or neither; threading is in
`session-v36/scraps.md` S36-3.
Falsify: a self-named target yields no self-candidate on either leg.

### Q13. `crossFileShape.ts`: the field leg is dark on every Rust enum

`parseStructHoverFields` wants `name: Type` and no enum variant writes one, so no payload type is
ever ENQUEUED for the walk. One correction from verification (C346): the hover recovery already
restores elided payload TEXT into the signature (`recoverElidedSurface`), so the model can read
`Receipt` spelled - what still never happens is `Receipt` joining the walk as a type. The fix is
the enqueue, and the fixture comes first (payload type defined in a third file) so the red is on
record. Also: a comment cites `enumPayloadsFromSource`, a symbol that exists nowhere - fix it in
the same touch (batch I scraps).
Falsify: the fixture.

### Q14. `prompt.ts`: context blocks go into bare triple-backtick fences unescaped

Worth more since v33 (blocks are read live).
Fix: length-adaptive fences; v38's fence-run work is the prior art.
Falsify: a block containing each fence length renders balanced.

### Q15. Splice path: LF bodies into CRLF documents

Fix: one EOL-normalization bundle at the vscode layer.
Falsify: CRLF document + LF body gives uniform endings, one doc comment.

### Q16. `csExtraction.ts`: nested `@"…"` inside an interpolation hole

PROVEN: 15 wrong values in 300 placed cases.
Falsify: the 300-case fixture with the 15 known-wrong values as target.

### Q17. `fimComment.ts`: a Rust `'"'` char literal opens a phantom string

The cheap fix stands: treat a literal scan crossing a newline as a phantom inside
`commentTypesIn`. **The 2026-08-14 correction here was itself wrong** (verdict C288): the defect
row is not missing and not red - it survives retitled `KNOWN WRONG` at
`test/adversarial-v36-p1.test.cjs:362`, GREEN by asserting the defective behaviour. Do NOT write a
new oracle; the phase FLIPS the existing row, exactly like the sibling `KNOWN WRONG` rows in that
file. Same for the ledAt bullet's D2 row at `:484` (C291) whenever ledAt is touched: it goes red
when fixed, by design.
Falsify: the flipped :362 row, red before the fix, green after.

### Q18. STRUCK 2026-08-15. Item 26's fall-through SHIPPED as session-v35 item 3

`src/vscode/oracleSurface.ts:3056-3078`, resolve-before-inject kept (verdict C29). The 2026-08-14
entry would have sent a session to build live code. Nothing to do; the value-measurement question
the roadmap raised remains unmeasured and is not queue work.

### Q19. Item 51: the arm runner has no Python entry

`preparedDoc` is the one non-parameterised function; Python's docstring lives inside the body.
Touches an instrument three languages' arms depend on: **their arms are the regression check and
must be re-run, not assumed.**
Falsify: three existing arms reproduce their rows; a Python row prepares a docstring in-body.

### Q20. Item 46: two frozen v21 rows model a cold answer no server gives

Re-cut `blind-v21-p3b` §1b and `impl-v21-p3b` F2 at the recorded shape (11 members, 1 signed,
warming to 7 rendered), **by an agent that did not write v50's bound**.
Falsify: re-cut rows red against v50's first bound, green against the shipped one.

### Q21. Item 23: the expiry row's fake clock

The one remaining wall-clock row, `blind-v21-p1-commands.test.cjs` test A near `:594` (line drifts;
grep the title), skipped under `CI_SKIP`. Fail rate to zero: ~1 in 10 idle, 4 in 20 under
contention.
Fix: fake clock, then the skip comes off.
**Do not touch `release.yml`** - its fifteen-line comment already answers the roadmap's second
half, and `ci.yml:56` gates every push (verdict C22).
Falsify: unskipped, green across 20 consecutive contended runs.

### Q22. Document the usage-leg split in `ARCHITECTURE.md`

Updated by verification (C307): the split is no longer purely structural -
`column80.repairUsageWindows` (default false) runs the usage leg on repair rounds. The docs entry
stands: record that the ratified "always injected" ships as refine-always plus an opt-in for
repair, and why. Docs only; do not "fix" the code to match the ratification.

### Q23. NEW. `deriveUsePath` emits `use std::...` from the sysroot manifest

Verified live (C294, blind-confirmed): `importTypes` has no provenance filter, `deriveUsePath`
walks to `<sysroot>/library/std/Cargo.toml`, reads `name = "std"`, and produces a valid-looking
import hint for a type the file never needed hinting.
Fix: provenance filter at the collection site (the walk already knows the definition URI).
Falsify: a std-typed collaborator produces no use-path hint; a workspace type still does.

### Q24. REDIAGNOSED 2026-08-17 by session-v55. The double-run is CROSS-HOST, and the filed mechanism was wrong

The defect is real and the mechanism C322 recorded is not. Two facts, both checked against VS Code's
own source rather than reasoned about:

- **One extension host per WINDOW**, always (VS Code's sandboxing blog states it verbatim;
  `extensionHostStarter.ts` mints a `WindowUtilityProcess` per window). So "two activating windows"
  is two processes, not two activations in one.
- **`Memento.update` commits synchronously in memory** (`extHostMemento.ts` assigns `this._value[key]`
  before returning; the promise it returns tracks PERSISTENCE only). So the existing
  `if (get() !== true)` already guards every same-host case. "Both read false" cannot happen in one
  host.

Measured: driving both the shipped code and a candidate fix against a faithful memento, the SHIPPED
code already runs the flow exactly once for two same-host activations. An in-process guard is
therefore inert, and session-v55 built one, proved it inert and reverted it.

What is actually open: two windows are two hosts, `globalState` propagates between them through a
100ms debounce (`STORAGE_CHANGE_DEBOUNCE_TIME`) plus two IPC hops, and `Memento` exposes no change
event, so an extension cannot observe the propagation at all. Two windows opened together inside that
window both run the flow: two tier pickers, two concurrent pulls of the same model.

**This is no longer a queue entry.** The only honest fix is a lock file under `globalStorageUri` with
stale-lock handling, which is machinery with its own failure modes, and whether a duplicate tier
picker is worth it is a value judgement. Scout it or rule it WONTFIX.
Falsify: two separate hosts sharing one storage backend, activating together, run the flow once.
A `KNOWN WRONG` row in `test/blind-v55-p3-firstrun-once.test.cjs` pins today's behaviour and goes red
when a real fix lands.

### Q25. NEW 2026-08-16. S52-9: `[RECORD] E` counts, and should ratio

`adversarial-v37-p1.test.cjs` `[RECORD] E` counts backticked type names in this repo's own doc
comments, so it measures how big the codebase is. Re-baselined 820 to 1000 on the same 20% band and
will tip again. Ratified 2026-08-16: make it a ratio against total doc-comment blocks.
Falsify: the row holds across a synthetic doubling of doc-comment volume.

### Q26. NEW 2026-08-16. Item 19: a remote Ollama is gated on the LOCAL box's VRAM

A non-default `column80.apiBase` falls through to `resolveTier`, so a laptop pointed at a GPU
server reads "no usable GPU detected" and `applyTier` overrides the model with the local tier
row's. Ratified 2026-08-16, minimal fail-open only.
Fix: an off-table `remote` arm in `buildFnGenService`, mirroring the `cloud` arm at
`fnGen.ts:1097` - no hardware probe, no model override, `[carve] tier=remote`, fail closed with a
message naming the host.
Falsify: a non-default apiBase on a no-GPU box enables fn-gen and keeps `fnGenModel` verbatim; an
unreachable host refuses and names the host, not the GPU.

## Blocked on one sentence from the human

Both cleared 2026-08-16; kept for one cycle so the diff reads.

- ~~**Item 22, the session-path sweep.**~~ RATIFIED: point the 234 cites at a committed doc, delete
  as the fallback for a citation whose reasoning is not worth moving.
- ~~**Item 13 / item 53's `{ 0 }` finding.**~~ ANSWERED from a committed doc, no sentence needed:
  the function is `trim_out_client_sets`, written up at `docs/dumb-models-work.md:360`.

## Do not touch

Tier 3 and 4 entire, tier 5 entire, the human-decision blocks, every tier-2 measurement arm. Each
needs its own scout or turns on a value judgment. The 2026-08-14 look-mechanical-but-are-not list
survives with two removals: the menus hide-vs-refuse entry (shipped - when-clauses hide the
commands now, C335) and item 26 (shipped, struck above). Item 43 and item 2 remain the
first-listed traps: 43's build shipped and only its measurement remains; 2's "find when OR rule
fragile" carries an OR that is the human's.

And one standing instruction a loop must carry: **the `KNOWN WRONG` rows** in
`blind-v15-argtype-identity.test.cjs` (item 21) and `adversarial-v36-p1.test.cjs` (Q17) **are
green today and go red when their fix lands. That red is success. Flip the row in the same phase;
never revert the fix to keep them green.**

### Q26b. NEW 2026-08-17. The remote arm treats a reachable server with zero models as ready

Session-v55 phase 2. `listModels` answers both "is the server up" and "what is pulled"
(`src/core/ollama.ts:307-309`), and the remote arm uses only the first half: `[]` from a fresh remote
Ollama with nothing pulled enables fn-gen on a model the server provably lacks, and the first
generate arrives as an opaque model-not-found. `firstRun.ts` already uses the second half via
`hasModel`.
Fix: fold `hasModel` into the enable decision so a missing model is NAMED.
Falsify: a reachable host with an empty model list disables fn-gen and names the missing model; a
host carrying the model still enables.

### Q26c. NEW 2026-08-17. Tighten Doc Comment fires rounds through a transport the build declared dead

Session-v55 phase 2. `registerTightenDocComment` is handed `transport: () => service.transport` and
consults NO tier gate, so it runs against a host `buildFnGenService` has just disabled. Pre-existing
and not remote-specific: `below-12gb` behaves the same. The claude-code arm deliberately makes its
disabled service inert; every other disabled arm does not.
Fix: decide whether a disabled service goes inert, then apply it to all arms.
Falsify: the gesture on a disabled tier refuses instead of dialling.

### Q3b. NEW 2026-08-17. The Rust test rung still filters by substring, and `--exact` is not the fix

Session-v55 phase 6 fixed the half that was a hard error (multiple filters need the `--` separator)
and deliberately left this half. `cargo test --lib -- add` still runs `add_more`, so a rung scoped to
one function's generated tests can blame a neighbour's.

**`--exact` looks like the answer and runs ZERO tests.** Measured against cargo 1.96: `--exact`
matches libtest's FULL path (`tests::add_returns_sum`) and `generatedTestNames`
(`src/core/testAssembly.ts:801`) returns bare `fn` names. The pair filters everything out, which
turns a working red into silence. Prefixing `tests::` is not the fix either: `findCfgTestModule`
(`:729`) matches any `mod <name>`, so extending an existing module inherits the developer's own name.
Fix: resolve the enclosing `#[cfg(test)] mod` name, thread it to `buildTestCommand`, then `--exact`.
Falsify: two tests, one name a strict prefix of the other, in a module NOT called `tests`; only the
named one runs, and it does run.

### Q3c. NEW 2026-08-17. C# has the identical substring over-run, and the identical trap

Session-v55 phase 6, found while checking whether Q3 was language-specific. `buildCsCommand`
(`src/core/tddCs.ts:1386`) emits `FullyQualifiedName~<name>` and `~` means CONTAINS, while
`csGeneratedTestNames` (`:2113`) returns bare method names. Measured on dotnet 10.0.110 / VSTest
18.0.2: `FullyQualifiedName~T.Tests.Add` passes 2 (Add and AddMore), `FullyQualifiedName=Add` matches
nothing, `FullyQualifiedName=T.Tests.Add` passes 1. So switching `~` to `=` without resolving the
fully-qualified name breaks it exactly the way `--exact` broke Rust.
Go, Python and TypeScript are CLEAN: Go anchors `-run '^(a|b)$'` with `escapeRegex`
(`tddGo.ts:805`), pytest uses exact node ids (`tddPy.ts:1034`), vitest/jest end-anchor.
Falsify: as Q3b, in C#.
