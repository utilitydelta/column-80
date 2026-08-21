# Roadmap history

What `docs/roadmap.md` used to carry and no longer does. That file is pending work only, so
everything here is a record: the shipped-item gap list, the consolidation notes, a question settled
without a human, and the disposition of the old session scraps.

Split out of the roadmap on 2026-08-21 by session-v56. Nothing here is an instruction. If a line
here reads like work, it belongs back in the roadmap as a numbered item, not here.

## Scraps disposition - the pointer that survives

Every session scrap through v23 is folded here, closed, or deliberately dropped. The 2026-07-25
re-triage is said to have verified that in code, and **that verification record is gone** (C416): the
scraps files themselves are on disk, but nothing on this box shows their load-bearing rows being
carried forward. Re-walking the scraps files against this register would check it. Treat "all folded"
as a claim rather than a fact. The v24, v25 and v26 scraps keep their reopen conditions in
their session files, and the load-bearing ones are already carried here: the rule-5 cost and the v25
look-at-real-ghosts calls under human decisions, the v26 calls likewise, and v24's fix 4 in the
History gap list now that it has shipped. Everything from v27 onward carries
its own scraps the same way. The sessions are gitignored, so
anything in them worth keeping must land here or ship in a commit before the directory walks
the plank.

## History

The consolidation notes and the shipped-item gap list this file used to open with.

Everything pending, one file. A session picks a slice, scouts it, builds it, and the slice is
removed from here when it ships. Shipped work lives in ARCHITECTURE.md and git history.

Consolidated 2026-07-26, superseding the 2026-07-18 file and the 2026-07-25 re-triage (both
deleted). Items were re-verified against main on 2026-07-25, and again on 2026-07-28 when v31's and
v32's shipped items were cut out. Caught up to 1.2.0 on 2026-08-07: items 25 and 31 struck (see the
gaps below), items 27, 34 and 35 amended for what session-v40 shipped, and items 36 and 37 added from
the v39 scraps so they survive the session folders. Caught up again on 2026-08-08: items **38**
(the Claude Code backend, shipped in session-v43) and **40** (prompt caching on both off-machine
backends, shipped in session-v44 and measured live through the product) struck.
Caught up to 2.0.0 on 2026-08-11 by session-v51: item **45** gained the number it was blocking on
(Go's gate is failed by the member re-poll allowance on both sides, and with the sleep at zero Go
passes with margin), and items **47** through **51** were added from that session's scraps so they
outlive the gitignored directory. Nothing was struck: v51 shipped the C# member floor, the hover cap
split and Go's gather bound, and none of the three was ever an item here.
PROVEN means tested; REASONED means read but not run.

Item numbers never move once assigned, because items cross-reference each other by number. A gap
means that item shipped. Gaps so far: **1** (the unit suite red on main, closed 2026-07-28: the 26
reds were ratified as `docs/supersessions.md` S4 through S9, the suite is green at 6391 pass / 0
fail / 3 todo on a dev box, and what remained of the item split into 21, 22 and 23), **3** (usage examples into
fn-gen repair, shipped v30: the `usage` field at `repair.ts:259`, under the docblock at `:246-258`
that records why the leg was structurally out of reach of a repair round before it), **12** (live context blocks, shipped v33; the identity
claim moved with it, see `docs/supersessions.md` S4), **15** (the TDD gesture in all five languages,
shipped v31), **20** (doc-comment scope plus the scaffold harvest, shipped v32) and **24**
(`num_predict: 512`, raised to 2048 with `testMaxTokens` to 8192 on 2026-07-30; the ladder was
re-run at the new ceiling and the model is correct at 64 branches, 64 simultaneous rules and 64
ordered pipeline stages, 17 of 18, so every one of those earlier failures was budget), **25** (every
repair round added one indent level to the human's file: fixed in 1.0.4, at the INPUT
exactly as the item ordered - `dedentReplyCode` normalises the failing code in the repair prompt and is
the declared inverse of placement. The entry then sat under Fix now for four more releases; struck
2026-08-07), **26** (a classified diagnostic that resolved nothing got no harvest. Session-v34 item 2
harvested type names out of a diagnostic's own text but only for diagnostics the classifier had NO
rule for, so a diagnostic that classified and then resolved nothing fell out with no surface at all -
PROVEN on `error[E0433]: cannot find EcdsaKeyPair in rcgen`, classified `wrong-item`, member leg
resolving nothing, the round going out `[repair] surface EMPTY` with the name the harvest wanted
sitting in the message. The fall-through SHIPPED as session-v35 item 3
(`src/vscode/oracleSurface.ts:3056-3078`): a classified-but-resolved-nothing diagnostic now queues
for the harvest, with the resolve-before-inject discipline kept. Its value stays unmeasured - it would
not have helped on the row that motivated it, since there the type genuinely does not exist, which IS
the error. The entry sat under Fix now for months after its own fix shipped, and a queue entry was
still pointing a build session at live code when the 2026-08-15 sweep found it. Struck 2026-08-16),
**4** (fn-gen quit repair early while the errors were still shrinking, the v24 fix-4 deferral. The
one-round-by-design cap is gone: `src/core/repair.ts:463-503` grants round 2 to fn-gen when the error
count is FALLING, which is this item's own fix shape, and the comment names what it was built from -
"It used to end flat at round 1, which quit with the count dropping: the capture went 12 errors, then
2, then 1, and stopped." Measured on a 156-row corpus cited at `repair.ts:480-491`, evidence in
`session-v24/scraps.md`. The item's second complaint is NOT covered by that fix and nothing here
claims it is: the v24 capture left broken mis-indented code sitting in the buffer with no
notification, and the round-2 grant addresses the quitting, not the silence. If that silence is still
real, it needs a fresh capture and its own entry. Shipped as session-v35 item 2 and carried in tier 5
for months afterwards. Struck 2026-08-16),
**31** (the surface priority order: REFUTED as filed by the v37 scout, which replayed the
item's own row through `prioritizedTypes` and found the doc comment contributed ZERO candidates - the
backtick parser could not read either span, so "imports beat the doc" never had a race. The disease was
the extractor and shipped as v37's widened gesture; `BasicConstraints` rendering nothing shipped as
v39's hover recovery; the `OffsetDateTime` 24-slot waste shipped as v40's render-pass budget. Tier
reordering is in Rejected. The ratified priority order survives in the tiers that exist, in the comments
above `prioritizedTypes`), **29** (the harness visibility filter: the item's exact fix - the stub reads
unregistered `file://` URIs off disk - already shipped in session-v35, and the entry sat unstruck for
five sessions after. Verified both configurations on one row 2026-08-08: the dead config filters
nothing, the shipped one drops 15 non-public `Pool` members with the channel line. The two capture
files that recorded it are no longer on this box, so that pair is a recitation now. The standing caveat is UNCHANGED: absolute
rates recorded before v35 describe the unfiltered configuration and say so where quoted; item 30's
comparison note survives inside item 30 itself. Struck 2026-08-08) and **32** (the
injected surface truncated by rust-analyzer: the tuple-variant payload shipped v37, and session-v39
extended the same mechanism to struct-variant payloads and to the member LIST cut, for `enum` and
`struct` alike, plus the honesty rule that a still-truncated type is no longer named in the firm
instruction's ONLY list. The per-language residual was never part of 32 and lives in 35), **38**
(the Claude Code subscription backend: shipped in session-v43, driven live by the human, and the
mislabeling their own channel exposed fixed in the same session) and **40** (prompt caching on both
off-machine backends: shipped in session-v44. Claude Code sends the context blocks as their own
turn and forks each generation off that checkpoint, keyed on a hash of the resolved block bytes so
a live edit can never be served stale; `anthropic` moved to a native Messages transport for the one
`cache_control` breakpoint the compat layer cannot express. PROVEN live through the product: a
second generation of a DIFFERENT function billed 1,713 base-input-token equivalents against the
24,370 its checkpoint cost to build once) and **44** (the floating Node major: struck 2026-08-10 by
session-v48 phase 0, and by the option the item said to prefer. The suite no longer carries a
single `todo` row. 37 of the 43 became green rows that assert what the code actually does, each
keeping its triage ruling verbatim in a comment above it and each retitled `KNOWN WRONG:` for a
defect that still ships or `SUPERSEDED:` for an expectation a later ruling replaced. The other six,
all in `review-v38-p2-fence-runs.test.cjs`, could NOT be converted and now SKIP with a stated
reason under a `CANNOT RUN:` title: they score capture files the 2026-08-10 repo split deleted from
both repos, so their true value cannot be re-derived and was not guessed. Their bodies still hold
the refuted claim, which is what the title says. With `todo` at 0 on both 24.12.0 and 24.19.0 there
is nothing left for a runtime to reinterpret, so both workflows went back to a bare
`node-version: 24`. Item 23, the wall-clock rows, is a SEPARATE and still-open way for a busy
runner to turn CI red, and this session added one row to its population: `adversarial-v36-p1` D2
was a todo row and is now a live timing-RATIO row. Measured 3.10x worst under 2x CPU
oversubscription against a bar of 2.5, and 3.9x idle, where linear would be 2.0) and **52** (nothing
tightened a dictated doc comment between the mic and the model. SHIPPED as `Column 80: Tighten Doc
Comment` in 2.1.0, and the scout that preceded it refuted two of the item's three original claims:
real dictation restates 0.6% of its units against 0.4% for written Rust doc comments, so REDUNDANCY
was never the failure - the one capture that motivated it was a clipboard slip in a typed session -
and merge, reorder, tighten and run-on repair all measured flat or backwards, with dictation
interleaving its topics LESS than written comments. What survived and shipped is the backtick leg:
dictation produces no backticks at all, so the comment-named-type leg was lost outright rather than
degraded, and a proposal has to be scored as a DELTA against the injected surface because a redundant
proposal EVICTS a real type at a root cap of 8. The compile-graded feature arm stays unbuilt and says
so: it needs a dictated corpus that does not exist, and C#, Python and Go have no backtick population
to census, proved by count. Two pieces of residue outlived the section - the yield question (2 names
across 30 Rust targets, 5 across 30 TypeScript) and Rust's unmeasured class-4 enum-variant population
went to the Rust dogfood ledger, and the one mechanical fix went to queue Q25.

**Three things from that scout are standing rules rather than item text, and they are recorded here
because the session directory they came from is gitignored.** First, the ban: **Tighten may delete,
merge, reorder, tighten and backtick, and may NOT introduce a behavioural claim with no antecedent in
the dictation.** Same family as "wrong-value repair is banned" and "test-repair is banned", and the
standing recommendation on its open question is that the antecedent set is the DICTATION only - flag
rather than fill. It is enforceable, not just renderable: a lexical provenance check passes a pure
dedupe at 0 of 15 sentences and flags round 1 against round 2 at 15 of 15. It also flags the minimal
fix for the undefined-term bug, which is why refine kills one failure class and not two. Second, the
import ship gate, which belongs to item 48 as much as to this: a dictated comment names a type the
developer is about to USE, so the import is not there yet, and injecting that type's surface without
its import path manufactures item 48's failure rather than suffering it. A workspace-resolved
backtick carries the import path or does not ship. Third, the spelling bridge, because the mic says
"shard mem cache" and the repo says `ShardMemCache`: fold to compare, and on the Rust corpus **37 of
3,798 distinct fold keys (0.97%) carry more than one spelling**, measured over a clean
`git archive HEAD` so the count reproduces. The claim the gate rests on is narrow and it is not the
one four documents used to carry: **zero of the 37 collisions are a type against a type**, so a list
of proposed TYPE names cannot be silently merged. "Every collision pairs a type with a const or a
function" is FALSE - 13 of the 37 involve no type at all - and the roadmap carried that false
sentence briefly on 2026-08-16 before this correction. A fold match applies silently; an abbreviation
mismatch reaches the diff labelled a guess needing an explicit accept. Struck 2026-08-16).
Items 6 and 11
shrank rather than closed: 6's usage-windows half shipped v29 and its `selected:` measurement
did not, and 11's single-block gestures shipped v32 while its recursive variant did not.

Caught up 2026-08-21, after session-v55 drained `docs/queue.md` (24 of 26 phases; the ledger is
`session-v55/session-state.md`, the branch is unpushed at this writing). Five gaps added: **55**
(the fn-gen refusal split: three causes named, the expected language server per language, a
`[fngen] refused:` channel line, and the manual's missing language-server requirement. Residue:
`tightenDocComment.ts` cause routing and the "no extension vs no symbols" fact, both in Deferred
fixes and Smaller parked calls), **23** (the wall-clock rows: the perf row took an absolute bound
with measured headroom, the dark-reason row normalises `gateWait=`, and the expiry row got session-
v55's fake clock and came off CI's exclusion list - measured at 2-in-5 under load before, driven by
a missed timer at ~2x its window. `release.yml` still does not run `test:unit` and that stays a
DECISION, argued at `release.yml:50-60`), **19** (the remote Ollama arm: no local hardware probe,
no model override, fail closed naming the HOST; extended by amendment A, which made FIM local-always
so the disabled toast's "FIM tab-completion still works" is true by construction. Residue is items
57 and 58), **46** (the two frozen v21 rows re-cut at the recorded 11-member shape by an agent that
did not write v50's bound; the roadmap's own "10 rendered" mis-cite corrected to 7. Residue is
S55-25 under Smaller parked calls: v50's contract oracle carries the same fiction), and **51** (the
arm runner's per-language `prepareDoc` hook, Python ported from the v51 one-row driver, 379 rows
through the unified runner, three languages' arms re-run as the regression check. The check's own
defects became items 61 and 62). The deferred-fixes section dropped its shipped and struck bullets
in the same pass; their text survives in git at `e14d6cf` and earlier.

Caught up again 2026-08-21 by session-v56, six phases on an unpushed branch. Three gaps added.
**57** (a reachable server with zero models was treated as ready: `listModels` answers both "is the
host up" and "what is pulled", and the remote arm's enable decision read only the first half, so an
empty array from a fresh remote enabled fn-gen on a model the server provably lacked and the user's
first generate arrived as an opaque model-not-found. `hasModel` is folded into the decision and
lifted to `src/core/ollama.ts` beside `listModels`, with `firstRun.ts` and `extension.ts` dropping
their two copies of it. A stocked host enables exactly as before; a missing model fails CLOSED at
enable time with a tier message naming the model and the host, and a `reason=model-missing` carve
line). **58** (Tighten Doc Comment fired rounds through a transport the build had just declared
dead. The human ratified the design sentence at scoping - a disabled service goes inert EVERYWHERE,
the claude-code arm is the precedent to follow rather than overrule - and the survey found the hole
was wider than the one gesture: the remote and local arms handed their disabled service a live
transport too. Tighten now consults the tier gate before any work and refuses with the tier's
recorded reason; repair reads the gate BEFORE its `listModels` pre-flight, so a refused gesture
issues zero network requests; and the remote, local and cloud arms build their disabled service with
the claude-code arm's reject transport. Config and logging stay the live build's, so a settings
change still re-enables). **56** (the import hint derived `use` paths Rust refuses. The reachability
walk is lifted out of `tightenRatify` into `src/core/rustReach.ts`, one copy with two callers, and
the POLICY is the only thing that differs between them: the ratification gesture refuses a path it
cannot prove, the hint keeps today's render when nothing about the module tree is readable and
refuses when readable source DISPROVES the path. That split is the only reading under which
"prove it or refuse it" and "already-correct paths render unchanged" both hold, because the shipped
suite derives `use crate::orders::Order;` from an EMPTY contents map and a literal reading would
kill every same-crate hint the product emits. The adversarial review then found two defects with
live `rustc` 1.96.0 witnesses, both fixed on triage and both in one function: a shallow
`pub use seg::*` was accepted for a name living BELOW `seg`, so `fraction` rendered
`use fraction::Format;` against a real path of `fraction::display::Format`, and 15 of the 996
registry crates carrying a `lib.rs` have that shape at the crate root alone, a lower bound; and a
same-named sibling re-export HIJACKED the hint, turning a loud E0603 into a silently wrong import
that COMPILES and binds the wrong struct, which is the worst outcome available under a header
saying these types are already defined. The rule that works is PREFIX, not equality: triage
implemented the reviewer's own stated equality fix, ran it, and watched it red the flagship
`std::io::BufReader` case. A third defect rode out with them, `precededByCfg` treating `#[cfg_attr(`
as a gate when this repo had already ratified the opposite at `test/impl-v3-cfgscan.test.cjs:20`.
KNOWN COST, recorded rather than fixed: a TRANSITIVE glob chain, a root `pub use a::*` over a
`pub use b::*` inside `a`, now REFUSES where it used to render a path that compiled. The glob graph
is not followed, only the file chain, so the second hop is not in evidence, and no shipped row
covers it. Residue is item 65). Items 63 and 64 shrank rather than closed: 63's six translations,
bounded catch-alls, bounded body and reason phrase, and widened unreachable check all shipped while
its two remaining interpolation sites did not; 64's toast half shipped and its design half did not.

## Settled without a human: S22 (2026-08-08)

Struck from "Decisions only the human can make" by session-v43's spike, which ran it headless twice
green. The surviving witness is `session-v43/s22-dump.txt`; the findings doc that sat beside it is
deleted. It was never a human decision: the tier runs on
DISPLAY=:1 and `executeCompletionItemProvider` is drivable from a throwaway tier row.

**Do Roslyn's unresolved completion items carry `detail`/`labelDetails.description` on the product
path? NO** - 0 of 9 items at the spec's own member site. And past the question: after a resolve pass
both fields are STILL null on all 9. The signature arrives only inside `documentation`, as a fenced
```csharp block, which the product already reads (`csSignatureFromDocumentation`).

The three items it gated, now answered:

1. The v21 C# object-filter buys back **zero** resolve slots pre-resolve on the product path:
   `preResolveDetail` returns undefined for every item, so it can only act on members that already
   spent a resolve.
2. `csPreResolveSignature` is **dead code on the vscode command transport**. The headless LSP
   transport half was not probed.
3. The C# member cap **keeps its worst case**: positional resolve of the server's first N,
   alphabetical cut, the 49-property entity losing 22 real properties.

Caveat kept: one site, one 9-member solution, one Roslyn version. The MECHANISM is settled - the
fields are empty at every stage. The FREQUENCY question across big solutions was never reachable from
a site this small.
