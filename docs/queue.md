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
- **Commit per entry to a branch. Never push.**
- **The client corpora may be READ and measured against. What must never happen is a client NAME or
  client CODE reaching anything shippable** - source, tests, docs, commit messages, or a published
  artifact. Corpus identities live in the agent's memory, not in this repo. Corrected by the human
  2026-08-19; the previous wording here was a blanket "never read", which cost session-v55 a
  wrongly-blocked entry (Q19) before it was put right. When a claim's only evidence would require
  putting client material into the repo, the answer is still UNVERIFIABLE rather than a paste.
- One entry per phase; `session-state.md`, `progress.md`, `scraps.md` per the implementation-loop
  skill.

## The queue

### Q1. STRUCK 2026-08-14. Go rig stub `languageId` (S40-2)

`05-inject-run.cjs` is deleted (verdict C302). The finding survives the file: a stub TextDocument
defaulting `languageId` is silently wrong for every language but one. Re-file against whatever
replaces the rig.

### Q2. SHIPPED session-v55 (651446a). `column80.debounceMs` has no schema minimum

`package.json`: `{"type":"number","default":150}`, no `minimum`. Zero disables the debounce.
Fix: add a `minimum` with its reason in the description.
Falsify: a row reading the packaged schema asserts the bound.

### Q3. SHIPPED session-v55 (85ee388). `cargo test` filters are substring, not exact

Verified live (C334, blind-confirmed): `buildTestCommand` pushes bare positionals, no `--exact`
(`compilerOracle.ts:897-903`), so `tests::add` also runs `tests::add_more`.
Fix: exact match.
Falsify: two names, one a prefix of the other; only the named one runs.

### Q4. SHIPPED session-v55 (9118297). `catalog.ts` re-spawns `cargo metadata` per unresolved-crate accept

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

### Q6. SHIPPED session-v55 (c1b7ee1). `compilerOracle.ts` anchors on any ancestor `Cargo.toml`

A crate nested under a plain `[package]` ancestor loses repair entirely.
Fix: anchor only at manifests declaring `[workspace]`.
Falsify: fixture crates under each ancestor kind anchor correctly.

### Q7. STRUCK 2026-08-17. Both wrong comments are fixed

The `extraction.ts` half was already done (verdict C312). The `pyExtractor.ts` half shipped in
session-v55: the comment no longer claims Pylance resolve ordering is "unverifiable headless", which
stopped being true when the VS Code tier landed, and it now names the tier as where the tuning
measurement belongs. The resolveCount value itself is unchanged and still untuned, which is a gap
rather than a barrier and the comment says so.

### Q8. NOT MECHANICAL. `gesture.test.js` asserts `some`, and the evidence for `every` is gone

Rows at `test-vscode/gesture.test.js:689` and `:711`. The edit is two characters; the precondition is
the problem.

**Session-v55 tried to take this and stopped.** These rows run on the VS CODE TIER, which rule of
engagement 2 forbids reaching for, and the entry's justification ("the green-tier precondition
happened, session-v26 run 2") has no surviving artifact: `session-v26/` keeps progress, scraps,
reviews and journeys, and none of them records the arrow deltas or any tier output for these rows.
So "the evidence supports `every`" is a recitation.

Tightening a tier row on an unrecorded precondition is how a red row sits unseen for months.
What settles it: one VS Code tier run, reading the `provider invocations after each of three arrows`
line these rows already report, in both orders. If every delta is above zero, tighten AND keep the
output this time.
Falsify: the row itself, green after tightening, on a tier run whose output is recorded.

### Q9. PART-SHIPPED session-v55 (f7ab4e6). Extract the shared vscode activation stub

v21 S11/S13; three findings want it, a fourth 400-line copy is otherwise the default outcome.
Fix: extract, move existing copies onto it. Pure refactor.
Falsify: the full unit suite, unchanged.

### Q10. SHIPPED session-v55 (2b94dee). `fnGen.ts`: `T` reached the candidate list as a call owner

The provenance rule catches it downstream; a generic parameter should be refused at the resolve.
Fix: refuse at resolve, not at provenance.
Falsify: a call on a generic-parameter receiver yields no candidate, and the provenance refusal is
not what stops it.

### Q11. SHIPPED session-v55 (01d2642). Poisoned-GOENV fixtures

v23 F3/F7 exist as scrap conditions, not tests.
Fix: write the fixtures.
Falsify: the fixtures are the falsification.

### Q12. SHIPPED session-v55 (e3792fa). `repairTypes.ts` `spanTypesInPlay` has no `excludeName`

A body comment naming the repair target spends a cap slot on the target itself; under a cap that
is an eviction. The doc leg has the identical hole. Fix both or neither; threading is in
`session-v36/scraps.md` S36-3.
Falsify: a self-named target yields no self-candidate on either leg.

### Q13. SHIPPED session-v55 (6ee6e45). `crossFileShape.ts`: the field leg is dark on every Rust enum

`parseStructHoverFields` wants `name: Type` and no enum variant writes one, so no payload type is
ever ENQUEUED for the walk. One correction from verification (C346): the hover recovery already
restores elided payload TEXT into the signature (`recoverElidedSurface`), so the model can read
`Receipt` spelled - what still never happens is `Receipt` joining the walk as a type. The fix is
the enqueue, and the fixture comes first (payload type defined in a third file) so the red is on
record. Also: a comment cites `enumPayloadsFromSource`, a symbol that exists nowhere - fix it in
the same touch (batch I scraps).
Falsify: the fixture.

### Q14. SHIPPED session-v55 (7385b6f), and LENGTH ALONE WAS NOT ENOUGH. `prompt.ts`: context blocks go into bare triple-backtick fences unescaped

Worth more since v33 (blocks are read live).
Fix: length-adaptive fences; v38's fence-run work is the prior art.
Falsify: a block containing each fence length renders balanced.

**The title understates it and the fix shape was refuted.** It is 28 emit lines across 9 files, of
which the context block is one. And "length-adaptive" cannot round-trip through this product's own
reader: session-v38 keeps a bare run of THREE as a valid closer for ANY opener (it measured three
captured replies that open with four and close with three), so a bare ``` line inside the content
closes the block at every backtick length. `fenceFor` switches CHARACTER to `~~~` there. Content
carrying bare threes of both characters cannot be fenced under this reader at all.

### Q15. SHIPPED session-v55 (3d85a82). Splice path: LF bodies into CRLF documents

Fix: one EOL-normalization bundle at the vscode layer.
Falsify: CRLF document + LF body gives uniform endings, one doc comment.

### Q16. SHIPPED session-v55 (b0c65d0), and its "15 of 300" figure is WITHDRAWN. `csExtraction.ts`: nested `@"…"` inside an interpolation hole

PROVEN: 15 wrong values in 300 placed cases.
Falsify: the 300-case fixture with the 15 known-wrong values as target.

**THE "15 WRONG VALUES IN 300 PLACED CASES" FIGURE IS WITHDRAWN.** Session-v55's blind oracle built a
300-case population, graded it by running the C#, and measured **84 wrong** (14 of 50 shapes, each
wrong in all 6 placement contexts). It then looked for the original population and found none: the
three session-v16 artifacts cited as "behind the dotnet run" contain no C# fixture, no case count and
not the word `verbatim`. A wrong-case count is a property of a population, so 15 and 84 do not
contradict - but 15 is unfalsifiable as written and nothing should cite it again.

### Q17. SHIPPED session-v55 (5100cdb). `fimComment.ts`: a Rust `'"'` char literal opens a phantom string

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

### Q19. SHIPPED session-v55. Item 51: the arm runner has no Python entry

`preparedDoc` is the one non-parameterised function; Python's docstring lives inside the body.
Touches an instrument three languages' arms depend on: **their arms are the regression check and
must be re-run, not assumed.**
Falsify: three existing arms reproduce their rows; a Python row prepares a docstring in-body.


**SHIPPED session-v55.** `preparedDoc` now dispatches to a per-language `prepareDoc` hook; absent
means the braced shape, so `cs`, `rs` and `ts` take the identical path. Python's hook is ported from
`session-v51/run-row-py.cjs`, whose own header diagnosed this and called the port a named piece of
debt. Python runs through the unified runner over its 379-row population.

Regression check, full populations, against a reconstructed pre-change runner: `cs`/oracle (46 rows)
and `ts`/oracle and `ts`/inject (39 rows each) BYTE-IDENTICAL. `cs`/inject differed in one row and was
then shown to be the ARM's own non-determinism - the same code run twice differs, and the second run
matched the pre-change baseline exactly.

Three instrument defects found on the way, none of them this entry's:

- The `rs` arm cannot load at all: its store module is missing from this box entirely, so the 403-row
  Rust arm has been dead and unnoticed. S55-30.
- The `ts` arm died before its first row because its extractor was never exported from the rig's core
  bundle. Fixed here, one additive line.
- The `cs` INJECT arm is non-deterministic (a live hover race), so for that leg "the arm reproduces
  its rows" cannot tell a real change from a flap. The oracle legs are deterministic. S55-31.

Python supports only the committed docstring until a doc-variants artifact exists for it; a
`--doc D0|D1|D2` run fatals rather than silently substituting a stub. S55-29.

### Q20. SHIPPED session-v55 (inside 01d2642, see session-v55/progress.md). Item 46: two frozen v21 rows model a cold answer no server gives

Re-cut `blind-v21-p3b` §1b and `impl-v21-p3b` F2 at the recorded shape (11 members, 1 signed,
warming to 7 rendered), **by an agent that did not write v50's bound**.
Falsify: re-cut rows red against v50's first bound, green against the shipped one.

### Q21. SHIPPED session-v55 (62c1af0). Item 23: the expiry row's fake clock

The one remaining wall-clock row, `blind-v21-p1-commands.test.cjs` test A near `:594` (line drifts;
grep the title), skipped under `CI_SKIP`. Fail rate to zero: ~1 in 10 idle, 4 in 20 under
contention.
Fix: fake clock, then the skip comes off.
**Do not touch `release.yml`** - its fifteen-line comment already answers the roadmap's second
half, and `ci.yml:56` gates every push (verdict C22).
Falsify: unskipped, green across 20 consecutive contended runs.

### Q22. SHIPPED session-v55 (c3be2a9). Document the usage-leg split in `ARCHITECTURE.md`

Updated by verification (C307): the split is no longer purely structural -
`column80.repairUsageWindows` (default false) runs the usage leg on repair rounds. The docs entry
stands: record that the ratified "always injected" ships as refine-always plus an opt-in for
repair, and why. Docs only; do not "fix" the code to match the ratification.

### Q23. SHIPPED session-v55 (a6fa9da), and its filed premise was wrong. `deriveUsePath` emits `use std::...` from the sysroot manifest

Shipped as filed: `isRustSysrootDef` at the collection site, so a sysroot def contributes no
import hint and the withheld name goes on the channel. Two corrections the entry needs on the way
out, because both were wrong and both matter to whoever reads this next.

**The premise was wrong.** "A type the file never needed hinting" describes redundancy. The actual
harm is that the hint is usually WRONG: `deriveUsePath` walks the FILE tree and Rust resolves the
MODULE tree. Measured against the real rustup sysroot and real `rustc`, one `use` line per file so
no failure masks another: **15 of 53 compile, 38 fail, 35 of them E0603.** `use std::fs::File;` is
real; `use std::io::buffered::bufreader::BufReader;` is not.

**The reachability was wrong twice.** A blind oracle found the 1.3.0 provenance pre-check refuses
stdlib candidates and concluded this was cold-start only. The adversarial review disproved that: the
pre-check judges only the ROOT candidate, and `STD_TYPE_NAMES` does not carry `File`, `BufReader`,
`SocketAddr`, `AtomicU64` or `SystemTime`, so a workspace struct with a sysroot-typed FIELD reaches
the site with a WARM resolver.

**Not closed by this fix:** the same derivation damages workspace and cargo-registry hints, measured
at `tightenRatify.ts:611-616` (110 of 249 compiled, 136 failures E0603). `rustImport` already solves
it for repair and is not shared with fn-gen. That is a design call and it is in
`session-v55/scraps.md` for the human.

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

### Q25. SHIPPED session-v55 (7144bc0). S52-9: `[RECORD] E` counts, and should ratio

`adversarial-v37-p1.test.cjs` `[RECORD] E` counts backticked type names in this repo's own doc
comments, so it measures how big the codebase is. Re-baselined 820 to 1000 on the same 20% band and
will tip again. Ratified 2026-08-16: make it a ratio against total doc-comment blocks.
Falsify: the row holds across a synthetic doubling of doc-comment volume.

### Q26. SHIPPED session-v55 (4affd58). Item 19: a remote Ollama is gated on the LOCAL box's VRAM

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

### Q16b. NEW 2026-08-18. A raw interpolated string's hole makes `reindentCsBody` emit C# that does not compile

Session-v55 phase 13, found by the adversarial review while checking what the stack fix did NOT
cover. Pre-existing: the old and new scanners emit byte-identical output for this shape, so the
phase neither caused it nor closed it.

`CsStrCtx` gives a raw string no hole depth, so a hole inside a raw INTERPOLATED string is scanned
as string text. When that hole holds a run of `>=` fence quotes, `csRawClose` finds the run and
closes the string early. The content lines then stay frozen while the real closing-delimiter line is
classified as code and takes the indent, and C# requires every line of a raw string literal to start
with the closing line's whitespace.

```
var s = H.Fmt($"""
    a{@"say ""hi"""}b
    """);
```
Measured on dotnet 10.0.110: the input compiles, the re-indented output is rejected with **CS8999**.
Every other known scanner defect moves a byte; this one breaks the build.
Pinned live by `test/adversarial-v55-p13-scanner-stack.test.cjs` row A13-7 (the row asserts the
uncompilable output AND the byte-identity with the pre-phase-13 scanner, so it goes red if either
half changes).
Fix shape: track hole depth inside a raw string, which is the widening phase 13 declared out of
scope, so the stack gains a `holeDepth` that is no longer pinned at 0 for `kind: "raw"`.
Falsify: that row, plus a dotnet compile of the output.

### Q16c. NEW 2026-08-18. `$"…"`, a regular interpolated string, has no hole model at all

Session-v55 phase 13, same review. Pre-existing and byte-identical before and after the phase.

`advanceCsLineScan` has openers for `@"`, `$@"`, `@$"` and `"""`. It has none for `$"`, so a `$"…"`
is scanned as a plain regular string and the scan stops at the first unescaped `"`. A `@"` opened
inside that string's `{…}` hole therefore desynchronises the quote count, a phantom string opens, and
a later line that is inside a real `$@"…"` string's TEXT gets shifted and loses its value. The
adversarial review found it by generating legal C# and running it, and reported 1 wrong value in 1200
generated bodies. That generator is not in the repo, so treat the rate as the review's and the SHAPE
as proven: row A13-8 compiles and runs one such body and the value moves.

Not a hole-specific defect, checked at triage rather than assumed: the identical desync happens with
the `$"…"` at statement level, because `$"` is missing from the one shared opener list. The phase-13
code comment was narrowed in the same commit to say so, since it had claimed hole-and-statement-level
parity without naming what the shared list omits.
Pinned live by `test/adversarial-v55-p13-scanner-stack.test.cjs` row A13-8.
Fix shape: give `$"` an opener that pushes a context whose holes are tracked. It is a regular string,
so it cannot span a line, which is why phase 13's blind oracle measured `$"` in a hole as CORRECT
(row P13-7c, 18 cases) and this shape still slipped past: the damage is within one line.
Falsify: the generated-body population, graded by running the C#, plus row A13-8.
