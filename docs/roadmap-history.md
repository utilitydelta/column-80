# Roadmap history

What `docs/roadmap.md` used to carry and no longer does. That file is pending work only, so
everything here is a record: the shipped-item gap list, the consolidation notes, a question settled
without a human, and the disposition of the old session scraps.

Caught up again on 2026-08-21 by session-v57: items **63** and **66** struck, both closed in one
pass the way their entries asked for. See the gaps below.

Caught up again on 2026-08-22 by session-v58: items **69**, **67** and **68** struck, all three
closed. That session was about what the product SAYS when a transport fails, and what it keeps in
the channel when it does. Read the gaps below before believing "closed" means more than it does -
item 67 in particular closed under a ruling that changed what it was asking for, and two model calls
in the product are deliberately outside it.

Caught up again on 2026-08-23 by session-v59: items **7**, **21**, **22**, **45**, **59**, **60** and
**61** struck, and item **70** filed. Ten clearance phases plus the register rewrite. Read "The
session-v59 strikes" below before believing "closed" means more than it does - item 45 closed by
REVERSING the finding this register had been quoting for two releases, and item 21's premise turned
out to be false in two of the three languages it named.

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

Caught up on 2026-08-21 by session-v57, second block of that date. **63** (three strings the session-v56 toast sweep did not reach, all closed by session-v57 on
2026-08-21. The two sibling transports carried byte-identical unbounded copies of `safeText`: a
500 with a 100KB body measured 102437 characters of notification on the Anthropic arm and 102433 on
Cloud, on one line, where the toast's own first-line rule cannot shorten it. The bound now lives
once in `src/core/errorBound.ts`, a leaf that imports nothing, and all three transports take it from
there along with the HTTP reason phrase, which Node puts no ceiling on. `cloudInstruct` reads its own
400 unbounded on purpose, because `adaptDialect` JSON-parses that body to learn the provider's token
parameter and a bound at the read hands the parse a truncated document; the bound goes on at the
throw, and a row goes red if that is swapped back. The failures that arrive inside a 200 never
touched `safeText` at all and are bounded at four sites now, three in `ollama.ts` and one in
`anthropicInstruct.ts` that the entry did not enumerate; every one coerces with `String()` first,
because the error field is typed string and a server may still send an object, and without the
coercion three of four hostile shapes throw out of the stream reader and an array reaches 200015
characters. The claude-code `cwd-unusable` message reads `err.message` rather than `String(err)`, so
the `Error:` envelope is gone, and `tierDisabledToast` in `src/vscode/toastText.ts` renders a
disabled tier as one line with a channel pointer appended only when the cut actually dropped
something; three of the four gates call it and the repair gate, which embeds the message
mid-sentence, carries the same rule inline. Four gestures render a tier message and all four were swept, not the one the entry named.
Residue became items 67, 68 and 69 rather than being left in a gitignored session folder, which is
this file's own rule: the toast still points at a channel whose copy is the same bounded string, and
two repair toasts in `oracleSurface.ts` still render a multi-line compiler diagnostic whole), **66** (one sentence for the
silent server on every transport, session-v57, 2026-08-21. The table now carries marker SETS rather
than markers, which is this entry's own first option, so the table went from seven rows to six
rather than to twelve: the two test-refusal wordings that already shared a sentence collapsed into
one set. Matching changed
twice and both changes are behaviour: anchored rows match at index 0, because otherwise a server can
put another row's words in a payload and draw a different subsystem's sentence, which was live at
`ollama.ts`'s in-200 error field. Anchoring alone does not close that. A transport throw carrying
server text and no crafted sentence never reaches the anchored pass at all, so a message opening with
a known transport head is treated as a payload carrier and no service row may match inside it; that
also closed the same forgery on the three HTTP-status throws, which nobody had tested. One of the
entry's five throws turned out not to be a silent server: Anthropic's error frame is a generic
envelope, and a rate limit, an invalid key and a malformed request were all being told to check a
healthy server. It keeps the provider's own message, loses the phrase "stream error", and gets no
crafted sentence. Two things this entry claimed are not true and should not be re-quoted: the
`Ollama stream cut:` sentence it named as the reference is unreachable from the fn-gen toast, because
the only silence bound in the product is `FIM_SILENCE` and `generateInstruct` passes none, so no
fn-gen backend can detect a hung server at all. And the sentence is about wording, not coverage: only
the Anthropic client tracks a terminal event, so a stream cut in half resolves as a successful short
generation on the local and cloud clients and reaches no sentence at all. Those two holes plus the
claude-code backend having no rows became items 67 and 68)

## Human decisions settled on 2026-08-22, moved here from the roadmap

Each of these said "move this entry to history on the next roadmap pass" and this is that pass.

**Commit the gesture fixtures (v21 S7b) - DONE.** All five scratch repos committed clean, byte for
byte, after a full diff review (rust `ac86ba8`, ts `9ab11bd`, csharp `9e735e9`, python `229fc92`,
go `288c52b`). The loose edits were authored fixtures rather than junk: the shared-prefix enroll
family and the v30 repair-receiver chain in every language. Two patches of dogfood residue,
non-compiling ghost-accept lines in the rust and python gesture sites, were committed AS the
baseline on purpose, because the tier anchors by exact-string search in those files - clean them
only with a tier re-run in hand. **Residue that outlives the entry:** the five repos have no git
remote, so a fresh machine still cannot run the tier. The trees are pinned, not portable.

**TS order-gate ratification (v22) - RATIFIED.** Arm C, methods-first prompt ordering, stays for
TypeScript as shipped. The comment-led ghost collapse (66.7% to 6.7%) dwarfs the two-point recall
dip on a corpus too small to see two points. The untested def-first-plus-terminator TS branch is not
ordered. Reopen on a real dogfood complaint, not on a re-measurement.

**The rust-analyzer snippet nudge - ANSWERED.** The answer was sitting uncommitted in
rust-scratch's `.vscode/settings.json` and is committed now (`ac86ba8`):
`rust-analyzer.completion.callable.snippets: "none"`, with the reasoning written above the setting.
"none" is what makes the arrowing half of the sticky-selection gesture visible in Rust, at the cost
of tabbable placeholders whose parameter names get overwritten anyway.

## The session-v58 strikes: 69, 67 and 68 (2026-08-22)

Three items, one session, one subject: a transport fails and the product has to say something true
about it. All three are gaps in the numbering now. What follows is what closed, and - more usefully
- what did not.

### 69. Three toasts still promise or print something they should not

All three shapes closed.

The channel pointer is true again. Every unknown-error toast ends "The full message is in the output
channel", and since session-v57 moved the bound into `errorBound.ts` that had been false whenever a
server body ran over budget: both surfaces got the same 400 characters. Each HTTP transport now
reads its body once, writes the raw copy to the channel, then bounds the same string for the throw.
The cap is 16 KiB and `docs/constants.md` records it as a judgement call with nothing measuring it.

The two repair toasts render one line. A `tsc` assignability error is multi-line by construction -
`tsOracle` appends an elaboration line per row - and both surfaces interpolated it whole. Both go
through one helper now, and both gained a channel line carrying the whole diagnostic. Neither had
one: session-v57's S57-6 recorded that the refine path already did, and it was wrong, that line is a
seventy-character-per-error digest.

`firstLine` cuts the full line-break set. It split on `\n` alone, so a bare CR, U+2028, U+2029 and
NEL all survived the product's universal toast bound. Widening it moved no existing row.

**The gap.** The elision marker is forgeable in both directions and every OTHER channel surface
still carries unescaped line breaks, so a server can still write its own channel rows on three of
them. That is `session-v58/scraps.md` S58-2, and the measurement trap under it is the more valuable
half: a test sink collects one array element per `log()` call while `OutputChannel.appendLine`
renders one row per break, so every line-counting row in the suite measures a different thing from
what a user sees.

### 67. No fn-gen backend can tell that a stream died mid-reply

Closed, and the item changed shape under a ruling before it did.

The item asked for a silence watchdog. The human ruled against one on 2026-08-22: users run
different hardware, so any silence bound is a guess about someone else's machine and a wrong guess
kills a generation they asked for. What shipped instead is the cancel affordance - a status-bar item
that appears while work is in flight and survives the progress notification being dismissed, and a
palette command behind it with no default keybinding.

The terminal-event half shipped as asked. The local arm throws when its reader ends without a `done`
frame; the cloud arm throws when it ends with neither a `finish_reason` nor a `[DONE]`. Both speak
the sentence the class already owned. A half function is no longer proposed as a finished one.

The cloud error frame is read. A 200 carrying `data: {"error":...}` used to be parsed, matched
against nothing and dropped, and the user was told the model produced nothing usable while the
provider had said it was overloaded.

**Three things to know before reading "closed" as done.** The signal that decides a cut is tracked
in a reader FIM shares, and spent only on the instruct path - a cut ghost costs a keystroke, a cut
function costs a wrong answer. The cloud rule is a disjunction, so a provider sending neither
terminal signal goes red, and that risk is accepted rather than solved because nothing in this repo
has watched a real cloud endpoint finish a stream. And the ruling is met for fn-gen only: the model
pull (S58-10) still keeps its cancel inside a dismissable notification, and the tighten proposer
(S58-11) builds an `AbortController` that nothing ever aborts.

That last one is the shape worth remembering. A controller can exist, be passed to a transport, and
have no abort path at all - so a source pin for `new AbortController()` proves nothing, and any
future check on cancellation must assert the path.

### 68. The claude-code backend has no translated failures, and neither does the HTTP-status class

Closed, both halves, through one structural pass that reads what a failure IS rather than what its
message says.

**This entry was wrong in four ways, and every one of them would have misbuilt the phase.** Recorded
here because the register's audited drift rate is 30% and this is what that looks like from inside:

1. It said the Claude Code failure field is `kind`. It is `reason`.
2. It named five values. There were ten, and there are eleven now. A switch written from the entry
   falls through on half of them.
3. It put the translator in `src/core/fnGen.ts`. There is no such file; it is `src/vscode/fnGen.ts`.
4. It said two throws interpolate CLI text. Six did - and the pair it quoted was not the pair its own
   falsification test named. Its falsifier says "a claude-code exit and a 429"; the 429 case is two
   other lines entirely. A phase built from the entry would have wrapped the two it named, left the
   case its own test demanded still broken, and passed that test.

The pass also closed a hole nobody had claimed. These messages matched no payload-carrier head, so
they reached the substring pass - and a CLI printing another failure's words drew that failure's
sentence.

**The gap.** The download toast still shows raw provider JSON while the three generation arms
stopped (S58-13), and the tighten gesture answers every transport failure with "the model could not
be reached", including the ones that were reached and refused (S58-7). Both want the same fix: the
reject table lifted into a leaf that all three surfaces can import.

### What the three of them taught, which is worth more than the three

Five crafted sentences in one session turned out worse than the raw text they replaced. Session-v57's
S20 sent a user with a bad key to check a server that was fine. A coercion turned a provider's
"upstream overloaded" into "unknown". Two sentences named settings this product does not contribute.
A status fallback deleted "model not found, try pulling it first" and left the number 404. And a
throttling sentence named a key the local backend does not have.

Every one is the same act: the product asserting a next action it does not know. Craft a sentence
where the product has established what happened. Hand over the provider's own words everywhere else.
That is written up with its evidence as `docs/supersessions.md` S23, and aye, it is the one thing
from this session most likely to save the next one.

**Nothing here has been driven against a real provider.** Every status, every mid-reply cut and every
error frame came from a fake server on localhost. That gap is unchanged from session-v57 and it is
the same gap that let S20 ship wrong in the first place.

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

## The session-v59 strikes: 7, 21, 22, 45, 59, 60 and 61 (2026-08-23)

Seven items, one session, ten clearance phases. What follows is what closed and - more usefully -
what each one taught on the way out.

### 45. The latency probe cannot produce a cold row (ANSWERED, and the answer reverses the finding)

**The call: KEEP `membersWithSettle`.** A cold probe was built, it produced the case the loop exists
for, and the loop recovered surface that would otherwise have rendered empty.

**The register's "41 re-polled cursors, zero recovered" was a fact about a WARM probe**, exactly as
the 2026-08-16 ruling suspected. It is now superseded. Python, PROVEN over five runs with 7 of 8 rows
cold and 16 first-touched files per run: **17 re-polled cursors, 2 recovered.** Both recoveries are
the same cursor and both read `0/5 -> 5/5` - five members with zero signatures, then five of five
signed one 40ms step later. On runs where the race did not fire, the row rendered the same surface.
documentSymbol gives the count immediately; what arrives late is signatures.

The three named warming defects are fixed in cold mode only, plus a fourth in the same family the
contract never named: each language's startup gate loop hammered `roots[0]` up to forty times before
anything ran, so row 1 of every cold run was the warmest row in the table. Warm mode was re-taken and
is unmoved - Python p95 2689ms against v50's 2707ms - which is what the ruling required.

**Re-opening a file is not re-cooling it**, and saying otherwise would be the same mistake this phase
existed to fix. A server that has indexed a file answers warm however often the probe re-opens it. An
`everOpened` set is kept beside the per-row one for reporting, and every row now prints how many of
its opens were the first time the process touched that file. Those counts, not the open count, are
what make a row cold.

**The register was also wrong about TypeScript's zero, and this one is structural.** 20 of 20 rows
cold, 0 re-polls, 20 of 20 rendered a surface, definition 9-15ms - not a dead server. `TsLsExtractor`
is an in-process LanguageService reading off disk with `getProgram()` primed at start, **so a
not-yet-read definition file cannot exist in TypeScript**. TS belongs beside Rust, which has its own
code-level explanation (`mayRepollHelp` refuses unsigned non-callables, which is every Rust data
struct), not beside Python. Only Python's zero ever rested on the instrument.

Go's pre-fill gate is not re-read and its red row's standing paragraph does not change: that work was
conditional on DELETING the loop, and the loop stands. The paragraph lives on inside item 50.

One residue: the corrected comment for `src/core/crossFileShape.ts` never landed, because the file
carried another agent's in-flight edits and the change was left unstaged. It is a deferred fix now.

### 47 stayed open, and its stated cause is refuted

Not a strike - recorded here because the register carried the wrong diagnosis. Python's pre-fill leg
is not cross-file `definition()`. Across 11 warm rows: hover **5904ms**, probe settle 2250ms, settle
sleep 383ms, members 328ms, `definition()` **52ms - 0.58%**. One level down, **18 of 38 hover calls
were the first ask about a URI and cost 99.7% of all hover time**; the other 20 cost 16ms between
them. The cost is per-FILE, and it is `pyLspExtractor.ready()`'s unconditional `delay(300)` per URI
plus a 150ms-granular diagnostics wait. A priced probe-side fix cuts net p95 1940ms -> 1049ms, still
4.2x the gate, and it widens the cold-index race this same phase proved fires. Handed to the human
with the number attached.

### 22. Shipped source points at folders a clone does not have

`grep -rn "session-" src --include="*.ts"` returns **0**, from 262 citations across 48 paths outside
the contended files plus 74 inside them. Test-file path citations went from 328 to 22, all out of
scope: bare-directory mentions where naming the ignored folder IS the argument, string literals in
assertion messages, and a `ctx.skip` reason, refused because changing one changes test output.

**4 repointed, 70 deleted in the final tranche; 34 repointed and 252 deleted across the test sweep.**
Pointer deleted, argument kept, every time. Where deleting a stamp orphaned a phrase that leaned on
it, the phrase was re-anchored to a thing in the code rather than dropped: "since session-v51" became
"since the member floor", "session-v34 item 1" became "the root-provenance rule".

**Two new docs, because five source files pointed at contracts that shipped nowhere.**
`docs/architecture/tdd-language-seam.md` carries all five legs, including Go's `-json`-not-`-v`
forgery argument and TypeScript's end-anchor-only filter, measured as the OPPOSITE of Go's answer.
`docs/architecture/tighten-doc-comment.md` carries the 451-name recall run, the warm latency table
that re-priced tier 2 by two orders of magnitude, and the 32% surface-eviction number. **C# has no
surviving seam contract anywhere in git history**, so that section says so and records what is
established in the code and in S26 instead. Roughly 900 lines moved in total.

**Twelve of the thirty-nine distinct cited FILE PATHS did not exist.** The session's own phase-0
inventory checked that every cited DIRECTORY existed and concluded the fallback would never fire;
that was wrong at file granularity. The ruled fallback applied, and three comments now say outright
that their source did not survive. `session-v51/hover-A.txt` recited its whole measurement (20 `pgx`
roots, 117 types resolved, 31 outside the BFS, 71-76ms hover) so its comment now says it IS the
record; `session-v31/visual-residual.md` recited NOTHING - it was a bare pointer at manual steps -
so the comment says the written steps did not survive and invents no substitute.

**One number in a shipped comment was wrong and is corrected.** `config.ts` said "3 of 27 against 3
of 27" for the receiver-blind repair-usage split, twice. The surviving score file has 8 cases at 3
repeats per arm - 24 runs, not 27 - reporting 3 (13%) for arms A and C. The same comment's claim that
"51% of injected windows come from outside the workspace" has **no surviving source**; left as the
comment's own record and marked unverifiable.

### 21. The cross-file argument-type leg (and the premise that was false)

The by-name workspace-symbol leg lands in TypeScript and Python; C# gets the wrong-tree refusal.

**The rows' real shape was corrected twice.** The goal's "three rows" are two call sites, and each
site sits inside a `for (const lang of LANGS)` loop where **`LANGS` holds THREE languages, not five**.
So it was 3 `KNOWN WRONG` rows across 2 sites. Both sites now pass `todo: false` with the
per-language branch deleted and the original demand applied uniformly. No assertion softened.

**TypeScript and Python have no wrong-tree refusal, and never did.** The register entry, the goal and
the phase's own contract all said they "already refuse it". They do not: their anchor lands on the
`import { Tile }` line, OUTSIDE the helper class, so the descent degraded for an unrelated reason and
looked like a refusal. `blind-v15`'s own green fixture row proves it. Recorded as S28 and carried into
the register's decisions, because extending the refusal is a ruling rather than a free extension.

**Real language servers graded it, and the live run found a defect the fakes could not.**
`getNavigateToItems` answers the **whole declaration span, not the name token**, so `export class
Tile` resolved character 0 - the `export` keyword. `membersOfType` survived by walking the AST, which
is why the fakes stayed green; `hoverSurface` would not have. That is the
symbol-providers-do-not-qualify hazard in a second place.

**The C# gap was wider than the review reported: five head shapes, not two.** Probed live against
Roslyn LS 2.140.9 at eleven cursor positions, the base list, a primary-constructor parameter, a
generic constraint and an attribute both on its own line and inline all handed back the wrong class's
members. Two captured facts explain why the old third fact could never fire, and neither would
survive a hand-built fixture: **Roslyn emits NO constructor child at all for a primary constructor,
and an attributed class's range STARTS AT THE ATTRIBUTE LINE.** The fix drops the member check
rather than adding a fourth fact - a correct resolution lands on the type's own name token, and
everything else inside a container belongs to another declaration - and replaces it with two guards,
the container name compared at its IDENTIFIER HEAD (so `Box` answers a container Roslyn reports as
`Box<T>`) and a C# syntax word never being a reference. Both guards are mutation-tested: comparing
the container name whole instead of at its head reddens both generic-class rows, which is the exact
false refusal the review warned about, caught by a row rather than by luck.

**The triggering Roslyn state did not reproduce here** - `definition()` answered correctly at all five
head positions. The commit, the code comment and S28 all say so rather than papering over it. What IS
live-measured is that the descent hands back the wrong class's members at those cursors.

### 7. Rust has injection and zero enforcement

Rust joins the invented-member gate, and `.await` still works.

**How the two lists were separated.** The prompt's list is UNCHANGED: `semanticMembers` drops the new
`keyword` kind, so every render, member count, tier stamp and dark-site reason is byte-identical. The
gate's list is built separately from the raw server answer, adding back the keyword and postfix labels
the render filter drops. Legal-only members carry no tier and no signature, so nothing can render them
by accident. The `Future` receiver is handled by splitting a qualified name into head and tail, so
`await`, `await.insert` and `insert` are all legal. **Splitting only widens, so its worst case is a
missed catch, never a false suppression** - the right direction for a gate that was turned off for
false-suppressing.

The arming rule did not move: the legal-only tail rides only behind a NON-EMPTY semantic surface, on
both transports. A keyword-only answer arms nothing, pinned as its own row - without it, a receiver
the server bound nothing on would gate against 20 postfix names and reject every real member.

**Red-before-green in BOTH directions, and never both red at once.** Ungated, direction 1 red:
`add_tile_by_morton appears nowhere in the receiver's 25-item answer`. Naively gated with ONE list,
direction 1 goes green and direction 2 goes red: `a bare .await is the completion this gate ate last
time`. With the full fix: 15/15. That is the regression a one-test session would have re-shipped,
caught in the act.

**A real rust-analyzer graded it**, driven twice - raw stdio LSP, then the shipped extractor - over a
crate with a struct and the `impl Future` an `async fn` returns. Plain struct receiver: **25 items**,
6 members and **19 postfix snippets**, and NO `await`. Future receiver: **28 items**, every member
relabelled `await.<member>` and demoted, plus `await` as a lone Keyword item. That keyword is the one
the old code dropped, which is exactly how a gated Rust ate `.await`.

Neither contract trap was claimed. No false suppression on membership was found, and no claim is made
that the motivating capture would have been caught by this gate. Two residues went to the register:
the gate judging a dotted lead on its head alone (S59-7, a decision) and the headless rig's
capability gap (S59-8, measurement debt).

### 59. The Rust and C# test rungs filtered by substring

A test rung scoped to one function now runs exactly that function's tests in both broken languages.

**Rust.** `enclosingModulePath` resolves the `mod` chain around the marked region;
`generatedTestNames` returns `widget_checks::add` rather than `add`, and `buildTestCommand` emits
`--exact` past the `--` separator ONLY when every filter is a full path. A bare name keeps the
substring filter, so the half-fix that selects zero tests cannot happen.

**The brief said to extend `findCfgTestModule` and the agent refused, with a measurement.** That
function finds the FIRST `#[cfg(test)]` in the file and knows nothing about enclosing modules, while
`cargo test -- --list` prints `geometry::widget_checks::add` - the enclosing `mod` is part of the
libtest path. Resolving from the marked region's own position gets both segments.

**And then the review found the regression that reasoning had missed.** `enclosingModulePath` scans
only the file's own text, so the segment a file contributes BY BEING a module is invisible. The path
came out full-SHAPED and wrong, the qualification check passed, `--exact` rode along, and libtest
matched nothing: `--exact widget_checks::add` -> 0 passed, 2 filtered out, where the correct
`geometry::widget_checks::add` -> 1 passed. **Before the phase the rung over-selected, which is the
safe direction. After it, zero.** Every Rust fixture wrote `src/lib.rs`, which is why the falsifier
missed it - fixture fidelity again.

The fix: prefix a name only when a walk from the `--lib` target's root file actually REACHES the file;
otherwise answer bare and let the substring filter stand. Over-selection is the safe direction and
this makes the fallback explicit rather than accidental. The new graded fixture leaves the crate root
on purpose: one crate, six layouts, twelve live tests, five of six outside `src/lib.rs`, every
expected path read off `cargo test --lib -- --list` before any assertion was written. Because twelve
tests are live, a wrong path selects zero and a substring filter selects twelve, so `=== 1` catches
both directions.

**C#.** `csEnclosingTypePath` resolves namespace plus type chain; `~` becomes `=` only when every name
is fully qualified. Nested types join with `+`, MEASURED not assumed: `=Ns.Outer.Inner.Add` matches
nothing, `=Ns.Outer+Inner.Add` matches one. Two deliberate refusals - a generic test method and a
generic enclosing type keep bare names and hold the whole command on `~`, because the CLR name form is
unmeasured here and a wrong exact name selects zero.

Raw identifiers, driven: cargo strips `r#` for the FILE name (`mod r#match;` -> `src/match.rs`) while
PRINTING it in the path, and keeps it on raw test fn names. `namespace @namespace` driven on dotnet:
`=VerbChecks.Add` matches nothing, `=namespace.VerbChecks.Add` passes. Both handled.

Real toolchains graded all of it: cargo 1.96.0 and dotnet 10.0.111. Contract narrowing is S26.

### 60. Two C# string constructs the re-indent scanner could not see

The C# re-indent scanner no longer emits CS8999. `CsStrCtx` gains a third variant: a raw string
carries its `$` count and a real `holeDepth`, and `$"` becomes `kind: "interp"` pushed by one shared
opener. `csRawTextStep` scans raw TEXT for whichever comes first, the closing fence or a hole opened
by a run of `dollars` braces - scanning for the fence alone WAS the defect.

**Three C# semantics were driven against dotnet BEFORE the code was written** rather than reasoned
from the spec: `{{` is not an escape at one dollar (CS9006); a `$"` hole may span lines since C# 11,
which is why it needs a stack context and not an inline skip; and a line beginning inside a raw hole
is exempt from the closing delimiter's whitespace rule.

**Then the review found the fix had opened the shape next door, and it was worse than reported.** The
first pass kept `//` and `/* */` unreadable inside a hole on a stated ground that dotnet 10.0.111
disproves, so an `@"` inside a comment inside a raw hole opened a phantom verbatim context: the
pre-phase scanner's output compiled and the new one's did not, and on a plain `$"` body a string's
VALUE moved. One root, one fix - **a hole is C# and takes C# comments** - and the `!inHole` gate on
both comment branches is deleted. Measured: three shapes were the new regression and **two predate
it**, the second pre-existing case being a `"""` run in a comment inside a raw hole. Both pre-existing
cases are now closed, and a row pins the attribution PER CASE, so the boundary is executable rather
than prose.

**A mutation check caught a hollow row**, and later a second one caught a hollow claim. The first cut
of one row survived a mutation clamping `dollars` to 1 - the shape could not produce the case it
claimed to test. And the review's instruction to "pin the measured 70809" would have shipped another
hidden-boundary number: that count was a fact about the test's own JUNK token list, which had no bare
`@`, no bare `$`, and none of `$$`/`@@`/`$@`/`@$`. Adding them immediately produced a divergence with
no `$"` in it. The row now pins exact counts per configuration over 1,155,900 bodies:
`856 / 211 / 1005 / 1005 / 0 / 60951` across `(none) / @" / $@" / @$" / """ / $"""`, **64,028 total,
435 of them carrying no `$"` at all**. A mutant deleting the `$"`-still-open pop moves the total to
105,375 and reddens exactly that row, naming each config that moved. Contract narrowing is S24.

### 61. The Rust measurement arm was dead

The Rust arm loads and runs. `session-complxity-research/spikes/lib-cargo.cjs` was rewritten from the
contract read off every `store.` call site in the arm runner. **403/403 rows dry in 71.3s**, and a
no-op round trip splicing all 403 rows with their own bytes came back byte-identical.

Three deliberate departures from the deleted file. The `STUDY_ROOT` fallback to the old sandbox is
gone - that directory still exists, so the default was a stale corpus waiting to be graded, and unset
is now fatal. Only place-at-column ships; shift-by throws, and that matters: **218 of the 403 rows
carry a real four-space indent, so a shift-by would have moved half the corpus with `cargo check`
staying green through it.** And S40-2 is carried in at the real defect site, where `makeDoc`'s
`languageId` no longer defaults.

No number was published from the arm. Restoring the instrument was the deliverable.

### The process lesson, sharpened: a shared git index makes `git add <path>` unsafe too

Six agents committing to one worktree produced repeated cross-staging - seven sightings in one
session. **No content was lost, and that was verified rather than taken on report:** every file from
the commit that went unreachable is byte-identical in HEAD, checked file by file, and
`docs/supersessions.md` was independently confirmed at 32 entries, S13 through S32 in order.

The standing rule bans `git add -A`. That is not sufficient, and this session proved it three ways:

1. A shared index can already hold another agent's work when you stage. One phase caught this and
   backed out; another did not, twice.
2. **`git add <explicit path>` is not protection when the whole FILE is contended.** The hazard is the
   file, not the pathspec - two agents appending to `docs/supersessions.md` collide no matter how
   precisely each names it.
3. **`git reset --soft HEAD~1` is unsafe.** Another agent may have committed on top since you last
   looked. One attempt to undo a bookkeeping error destroyed a different agent's commit instead;
   restored with `git reset --mixed <hash>`, every worktree byte survived. Resolve the hash first,
   check it is yours, and reset to a hash rather than to a relative ref.

Even verify-then-stage is not enough: one commit carries seven files that are not its own because
another agent staged in the gap between the verification and `git commit`. The check has to be inside
the same plumbing call as the commit, or the commit has to name its paths.

The working answer is `git apply --cached` on a filtered hunk set, which two phases used successfully
- one of them dropping the single behavioural hunk another agent had added mid-sweep to a file whose
commit had to be comment-only. The structural answer is a worktree per agent.

**History is NOT being rewritten to fix this.** The content is complete and correct, the branch is
linear, and the human merges it. Two commit messages under-describe their contents: `6d5effc` says
the last four shipped files stop citing ghost folders and also carries phase 9's declaration-head
refusal in full, and `7ad0dd0` says the toast cause/consequence split and also carries
`fnGenService.ts`'s comment sweep.
