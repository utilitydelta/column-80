# Supersessions

Deliberate changes to behaviour that a frozen contract oracle previously pinned. Each entry names
what changed, who ratified it, and why the old behaviour was wrong.

This file SHIPS. Session folders are gitignored (`session*/` in `.gitignore`), so a supersession
recorded only in one is a red row whose reason disappears with the session. Roadmap item 1 is about
exactly that cost, so the record lives here.

A red contract test whose reason is not in this file is a bug, not a supersession.

## S1. `returnTypeOf` refuses the explicit unit return `-> ()`

**Ratified by the human, 2026-07-27, session-v31.**

**What changed.** `rustReturnTypeOf` (`src/core/tddLang.ts`, moved there from `src/vscode/fnGen.ts`)
returned the string `"()"` for a signature ending `-> ()`. It now returns undefined, the same as an
absent return.

**Why the old behaviour was wrong.** `"()"` passed the "returns no value to assert" gate in
`column80.generateTests`, and `blankTestModule` then rendered `${1:/* () */}`. A unit-returning
function got a TDD test with a tabstop hole for a unit value, which is nothing the human can type.

**The disagreement was long-standing.** The doc comment on the shipped function claimed "undefined
for a unit/absent return" from v8 onward, and the code never did that. `session-v31/goal.md` item 1
repeated the documented behaviour. The v31 blind oracle bound to the documentation and went red on
the implementation.

**Why nobody noticed.** `classifyTestability` refuses a unit return as `underspecified` before
`returnTypeOf` is ever reached, so the defect was unreachable in the shipped product. The gate it
feeds was dead code that looked live. It can now fire.

**Blast radius.** None measured. `blind-v8-*` and `impl-v8-*` stay green, because no shipped path
reaches `returnTypeOf` with a unit return. The change makes the code match its own documentation
rather than altering any behaviour a user has seen.

**Pinned by.** `test/blind-v31-seam.test.cjs`, the row named `returnTypeOf rust: an EXPLICIT unit
return -> () yields undefined`.

## S2. The TDD gesture stops being Rust-only

**Ratified by the human before `session-v31/goal.md` was written; built in session-v31.**

**What changed.** `column80.generateTests` and `column80.runTddTests` refused every non-Rust document
with a message containing "Rust-only". They now support Go, TypeScript, Python and C# behind the
`TddLang` seam.

**What this supersedes.** `test/blind-derust-tdd.test.cjs` pinned the Rust-only refusal as a promise:
on a Python, TypeScript or C# document the gesture must show exactly one message containing
"Rust-only", make no model call, and touch no buffer. That promise is deliberately false for four
languages once this ships.

**What SHIPPED, session-v31 phase 6.** Both commands resolve `tddLangFor(languageId)`. A resolved
leg proceeds; an unregistered language is refused by NAME, makes no model call and touches no
buffer. The refusal **stops saying "Rust-only"**: after this supersession there is no Rust-only gate
left to name, and a refusal describing a gate that no longer exists is a lie. The registered set is
`rust, go, typescript, typescriptreact, javascript, javascriptreact, python, csharp`, written down
once in `tddLanguageIds()` and read from there by `package.json`'s `resourceLangId` enablement
clause, so the command palette and the seam cannot drift apart (session-v31 scraps D4).

**The re-cut oracle.** `test/blind-v31-wiring.test.cjs` pins the NEW promise across the whole
gesture. `test/blind-derust-tdd.test.cjs` was re-cut in place, and only its promise changed: it now
pins that a language with NO registered leg is refused by name, makes no model call and touches no
buffer. Every other assertion in it is untouched, so the contract kept its teeth; only the language
list moved.

## S3. A third document write path

**Ratified by the human before `session-v31/goal.md` was written; built in session-v31 phase 6.**

**What changed.** `ARCHITECTURE.md` invariant "Consented document writes, no silent insertion" named
two, and only two, code paths that write to a document. It now names three. The new one CREATES a
test file, which neither existing path can do.

**Why.** Only Rust puts tests in the same file. Go, TypeScript, Python and C# all put them in a
separate file, so a TDD gesture that cannot create one could only ever extend test files the human
wrote first.

**What did NOT change.** The new path is not silent and is not exempt from consent. The whole new
file is previewed as a diff against empty, through the existing presenter machinery; reject writes
nothing and leaves no file behind; the expected values are blank in the preview as well as in the
buffer, so the model's guessed value never appears anywhere. The gesture creates a test FILE, never a
test PROJECT, and never a config file, a manifest, or a package install.

**What SHIPPED, session-v31 phase 6.** `ProposalPresenter.confirmNewFile` is the gate: the same
preview scheme, diff tab, accept/reject commands and tab-close pruner `confirmDiff` uses, with an
empty virtual document as the original side because there is no real one. `blankSnippetToDisplay`
renders the preview, so there is ONE renderer and the model's guess cannot appear in a diff the human
only reads. On accept the file is created EMPTY, opened, and the blank-value snippet inserted into
it — that order is why this is a write path rather than a `WorkspaceEdit`: writing the blanked text
as file CONTENT would leave placeholder comments, while inserting it as a snippet puts the cursor in
the first hole and makes every hole Tab-able. `ARCHITECTURE.md`'s invariant now names three paths.

**Pinned by.** `test/blind-v31-wiring.test.cjs`, the `write path (…)` rows, which walk the real temp
workspace on disk rather than trusting one write channel.

**Not verifiable without a human at a keyboard.** How the affordance READS is the one thing no test
here can answer. The steps to drive it, per language, are in `session-v31/visual-residual.md`.

## S4. A context block is a live range, not a frozen copy

**Fully ratified. `session-v33/goal.md` pre-ratified the two rows it named, 2026-07-28; the human
ratified the other fourteen the same day and chose retirement over a re-cut.** The fourteen are
still enumerated below, because the reason a contract was dropped has to outlive the file that
carried it.

**What changed.** A context block was an immutable `(uri, range, text)` copy taken at add time.
`toPromptBlocks()` handed that copy to prompt assembly and nothing ever re-read the source. A block
is now a live range over a live document: `resolveForPrompt(read)` slices each entry's CURRENT range
out of the document's CURRENT text at generate time. `reanchorRange` grew a third answer to match.
v32 said shift or stale; it now says shift, resize or lost. `text` on the entry survives as the LAST
KNOWN slice, which is what the panel previews without an await and what the re-adoption audit
compares against after a document closes. It is not the payload any more.

**Why the old behaviour was wrong.** The human's case is one sentence: add a block over a function,
type an `if` block into it, fill the body, generate. Under frozen semantics that block was marked
stale and its old bytes were sent anyway, so the model was handed a function the human had already
replaced. The stale flag was the product noticing it was about to lie and shipping the lie with a
warning icon on it. There is nothing left for `stale` to mean now: a block is live, or it is lost.

**What did NOT move**, each still pinned by a green frozen oracle: nothing is ever added
automatically; a removed block can never reach a prompt (product invariant 3, bar 3); order in the
panel is order in the prompt; no retrieval, ranking or dedup; the prompt is still a deterministic
function of the cursor and the human's blocks. `test/blind3-bar.test.cjs` and
`test/blind3-prompt-identity.test.cjs` are green untouched, verified 2026-07-28.

**What IS lost as a guarantee.** Reproducibility of the exact bytes. Two generations minutes apart
can differ because you typed in between. That is the trade the human asked for, and the panel
showing live text is what keeps it inspectable.

### The two rows goal.md named: both survived, and one of them survived for a reason worth reading

`test/blind3-snapshot.test.cjs` is fully GREEN, 32 of 32, run 2026-07-28. Neither named row needed
re-cutting, so no oracle was edited for this supersession.

- `:106`, "snapshot is frozen at add time: mutating the source input object after add never changes
  the block", survives exactly as the goal predicted. The store still copies its caller's object,
  and a caller mutating its own object after `add` still cannot reach into an entry. What moved is
  where the payload comes from, not whether the store trusts its caller.
- `:126`, "a stale block still reaches the projection with its frozen text; only remove stops it",
  the goal expected to go red and it did not. It rides `isStale` and `toPromptBlocks()`, and both of
  those still exist with unchanged semantics. What changed is that neither is on the payload path.
  **The row is green and its promise is now vacuous with respect to what a model gets**, because
  `toPromptBlocks()` is a dumb sync projection of the list that no prompt is built from after phase
  3. Read the file's green as evidence that the frozen claim still holds and you will be wrong.
  `isStale` is now unreferenced by any shipped path and lives on for this oracle alone.

That is a supersession of MEANING with no red row to announce it, which is the shape this file is
worst at catching. Said out loud rather than left for the next reader to trip over.

### The fourteen rows goal.md did not enumerate

`test/blind-v32-p2-reanchor.test.cjs` pins v32's two-answer anchor rule and v32's `reanchor` return
type. Both are what this session widened, so fourteen of its rows are red on main. Adversarial
review checked all fourteen individually. **None is a defect wearing a supersession's clothes**, and
in every outcome case the range the new rule returns is the v33-correct range.

Six fail because `{kind:"stale"}` is not an answer any more:

| row | v32 said | v33 says |
|---|---|---|
| `a change intersecting the block is stale` | stale | `resize` 7..11 |
| `a change replacing the block's exact lines is stale` | stale | `resize` 7..8 |
| `an insertion at (block first line, character > 0) is stale: it touches the block's bytes` | stale | `resize` 7..11 |
| `order independence holds when one of the changes intersects: stale either way` | stale | `resize` 8..12 |
| `a whole-document replacement is stale, with no special case` | stale | `lost`, reason `crossed` |
| `a shift that would put the start line below 1 is stale` | stale | `lost`, reason `crossed` |

Eight fail at `reanchor`'s return, which was a count and is now `{moved, lost}`:

- `after a CORRECT shift, isStale against the EDITED document reports FRESH`
- `ONE event with N changes advances the version exactly ONCE and sums the deltas`
- `entries for other uris are untouched during an event`
- `reanchor returns how many entries moved`
- `a net-delta multi-line replacement above the block lands fresh end to end`
- `on stale the entry is left exactly as it is, so isStale keeps reporting it`
- `subscribers are notified when at least one entry moved, and not when none did`
- `a whole-document replacement leaves the block stale end to end`

Two of those eight (`on stale the entry is left exactly as it is` and `subscribers are notified when
at least one entry moved`) stay red even if you unwrap the return, and for the same reason the first
six are red: their events insert INSIDE the block, so under v33 the entry resizes rather than sitting
still. An entry that resized moved, so `moved` is 1 where the row expects 0, its object is replaced
where the row expects the same object back, and the store notifies where the row expects silence.
Nothing about the event handling changed; the classification under it did.

**Blast radius.** The two v33 oracles that replace these rows are `test/blind-v33-p1-reanchor.test.cjs`
(the anchor rule, including the four tail-boundary rows adversarial review added after the first
oracle passed over the defect) and `test/blind-v33-p2-resolve.test.cjs` (the payload path).
Session-v33's expected
unit-suite red count is **26**: the 12 known-red baseline from `docs/roadmap.md` item 1, plus these
14. Anyone grading a v33 run against 12 will read fourteen deliberate reds as new breakage.

**Pinned by.** `test/blind-v33-p1-reanchor.test.cjs` and `test/blind-v33-p2-resolve.test.cjs`.

**Resolved 2026-07-28: the file is RETIRED.** The human ratified the retirement rather than the
re-cut, on the ground the two v33 oracles above already pin the widened rule row for row, including
the four tail-boundary cases adversarial review added. `test/blind-v32-p2-reanchor.test.cjs` is
deleted. What it pinned that v33 did not change - order independence, per-event versioning, entries
for other uris left alone - is pinned by `blind-v33-p1-reanchor`; anything the v33 pair does NOT
cover went with the file, and this paragraph is the record of that trade.

## S5. The v33 reanchor oracle retirement

Recorded inside S4 above, where its reasoning already lived. This number is reserved so nothing
renumbers.

## S6. The nudge answer is remembered per WORKSPACE, not per install

**Ratified by the human, 2026-07-28.** The behaviour itself shipped in v21 (`1077f86`); what was
missing was this record, which is why the v19 oracle read as breakage for seven sessions.

**What changed.** `session-v19/s10-surface.md` said the answered flag lives in `globalState`, so a
nudge answered once was answered install-wide. `firstRun.ts` puts it in `workspaceState`.

**Why the old behaviour was wrong.** Dogfood: answering the nudge in one project silenced it in
every other project the user opened, including the ones where rust-analyzer was still configured the
way the nudge exists to fix. The offer is about the project in front of you.

**What did NOT change.** The write itself is still `ConfigurationTarget.Global`, because the
rust-analyzer setting is genuinely install-wide. Only the memory of the ANSWER is per workspace.

**Three of the four red rows were not this at all.** They were a broken fixture. The oracle's fake
`ExtensionContext` carries only `globalState`, so the gate settles into a memento that does not
exist and every member site re-offers - 50 sites, 50 offers. `impl-v21-nudge-scope.test.cjs`
diagnosed this in its own header in v21 and re-proved the claim against a realistic context, but
nobody went back and fixed the fixture. It now has both mementos, and the three rows pass with every
assertion intact. This is the second time in this repo an unreal fixture has read as a product
defect; the first is in the v25 notes.

**One row was re-cut, and one was split out.** The `globalState` row now pins `workspaceState` and
asserts a second project gets asked in its own right. The "one offer per install, whatever the user
answered" row silently included DISMISS, which the product deliberately does not treat as an answer
(a modeless toast that faded while the developer kept typing is not a yes, and recording it as one
costs them the offer forever). The dismiss case is now its own row, pinning that nothing is
persisted in either memento and nothing is written. What stops a nag storm while the question is on
screen is `offersInFlight`, not the persisted gate.

**Pinned by.** `test/blind-v19-ra-nudge.test.cjs` and `test/impl-v21-nudge-scope.test.cjs`.

## S7. Go carries no receiver type at an arity error

**Ratified by the human, 2026-07-28.** The implementation has been right since v30; the oracle and
one doc comment were wrong.

**What changed.** `test/blind-v30-p2-classifiers.test.cjs` pinned `type: "Cursor"` on the go
`arity-mismatch` class, on the premise that go's `want` list names the receiver. It does not. `want`
is the PARAMETER list, and a method's receiver never appears in it. Verified against go1.26.5:

```
not enough arguments in call to c.ToManifest
  have (string)
  want (string, uint64, uint64)     <- receiver *Cursor appears nowhere
```

**Why the oracle believed otherwise.** The scout's capture used `ToManifest`, whose first parameter
happens to be the same type as its receiver. One coincidence in one fixture, and four rows encoded
it as a rule. The C# sibling's comment twenty lines up warns about exactly this shape.

**This is the direction the process is worst at.** The file's header says "FROZEN. Fix the
implementation, never the row" - the right default, and wrong here, because the row was making a
false claim about a compiler. The implementation was already correct and carried the refutation in a
comment beside `GO_ARITY`; the function's own doc comment still carried the OLD claim, contradicting
the code below it. That comment is fixed in the same change.

**Blast radius.** Go's repair path spends a resolve on the receiver like Rust, TypeScript and Python
do, instead of reading one out of the diagnostic. The have/want block still reaches the model
verbatim, because the prompt passes diagnostics through.

**Pinned by.** `test/blind-v30-p2-classifiers.test.cjs`, rows A1 [go], G3, G4 and G5.

## S8. Two v6-era rows in the command-adapter oracle

**Ratified by the human, 2026-07-28.** Both behaviours shipped long ago; the oracle predates them.

**The blanket-impl drop.** The row's trait-provenance fixture was `clone(as Clone)` with detail
`fn(&self) -> Self`, which is exactly what v27's blanket-impl drop removes on purpose: rust-analyzer
boosts `clone` at every member site, and it crowded out the receiver's real surface. Five fixture
items mapped to four members and the row failed on the count. The row's subject is the label ->
name/viaTrait split, so the fixture is now `fmt(as Debug)`, which tests it identically without
colliding with a deliberate drop.

**Field signatures.** Behind that count assertion sat a second disagreement it was masking: the row
expected a field to carry no signature. v21 gave data members their own render (`seed: u64`, never
call-shaped, so a function-typed field stays honest). The row now expects it.

**Worth noting on its own.** The failing length assertion hid the field disagreement for as long as
it was red. A red row is not one finding; it is one finding and everything downstream of it that
never ran.

**Pinned by.** `test/blind6-command-adapter.test.cjs`, the row named `completeMembers maps vscode
completion items to core members with identical name/viaTrait/signature/kind`.

## S9. The live integration oracle asked for a ghost the floor refuses

**Ratified by the human, 2026-07-28.** The floor shipped earlier and was measured; the oracle
predates it and nobody had run the live tier since.

**What changed.** `test/blind-integration-live.test.cjs` built its context with the cursor
mid-statement, after `total += `, and its comment says so: "to invite a SHORT infill". The only
correct completion at that site is `v;`. Two characters, one alphanumeric. The ghost floor refuses
anything under 8 chars / 2 alnum, so `complete()` returned undefined and the row failed on "live
completion resolves a result". Deterministic, 3 runs of 3, always around 110ms.

**Why the oracle was wrong, not the product.** The floor is the deliberate substitute for a
confidence score at sites with no other evidence, measured over 710 served ghosts: the bare floor
tripped 2.4% and the exemptions bring it to 1.0%, matching JetBrains' published loss rate. The
refused population is `vec![];`, `e.code;`, `Get()`, `);`, `false`, `+ 9 * 4`. `v;` belongs in that
list. A row demanding a ghost at that site is a row demanding the floor not exist.

**What it now does.** The cursor moves to the start of the statement, so the natural infill is a
whole one. Verified live: `total += v;`, 11 chars, `ttft=190ms`. The row asserts non-empty text
rather than exact text, so it stays robust across draws.

**What this bought.** The cache-hit half of the row had never run. Every assertion after the first
was unreachable while the service returned undefined, so "second identical request is a cache hit"
has been dead since the floor shipped. Same lesson as S8: a red row is one finding plus everything
downstream of it that never ran.

**Still uncovered.** The floor has no live oracle. Its dark-with-reason path is pinned headlessly
and nowhere else. The human declined a second live row for it; noted here so the gap is on the
record rather than assumed covered.

**Pinned by.** `test/blind-integration-live.test.cjs`, the row named `service end-to-end against
live ollama: model round trip then cache hit`.

## S10. The Problems-panel mirror is gone

**Ratified by the human, 2026-07-28.**

**What changed.** `registerOracleSurface` (`src/vscode/oracleSurface.ts`) created a
`DiagnosticCollection` and `surfaceCheck` mirrored every check result into it under source
`column-80 check`. Neither exists now. This extension creates no collection and publishes no
diagnostic, in any language.

**Why the old behaviour was wrong.** The mirror had no lifecycle it could honour. Entries were
replaced only by the NEXT check on the same (language, root), and a check only runs on an accept, so
an error the human fixed by hand stayed in their Problems list with nothing they could click to
clear it. That is what the human reported: a stale `Unexpected indentation / column-80 check` that
would not go away. Owning a diagnostic means owning its whole lifecycle, and a check-scoped
publisher cannot. The language server already reports these errors against the live buffer and
clears them as the human types.

**What the check still says.** The edit-site annotation at the landed span (counts, with the
rendered compiler output on hover) and the output channel. The annotation now retires on the first
edit to that document, so it cannot become the same problem at smaller scale. Repair is untouched:
it always read the check result directly, never the collection.

**Pinned by.** `test/impl4-vscode.test.cjs`, the rows `display surface: NO diagnostic is ever
published…`, `display surface: a clean re-check clears the edit-site annotation`, and
`workspace member (P4-F2)`; `test/impl-v9-twolang.test.cjs`, the row `no diagnostics: a check with
errors publishes nothing, in either language`. Two rows were deleted rather than re-cut: the
mirror-own-keys rows in both files, whose whole subject was the bookkeeping that kept one root's
mirrored entries from blanking another's. Their surviving halves (single-flight, two languages on
one root) are pinned by the rows named in the comments left where they stood.

## S11. Apple Silicon refuses the CUDA carve explicitly, and reports its toolchain headroom

**Ratified by the human, 2026-07-30, session-v34 item 4. The item's larger prescription was BUILT
and then REFUTED by the human on the hardware; what follows is what survived.**

**What changed.** `probeHardware` (`src/core/hardware.ts`) now sets `unifiedMemory: true` on the
probe for Apple Silicon, and logs a toolchain headroom estimate beside the pool size.
`computeTier` takes `{ unifiedMemory }` and, on unified memory, deletes `fnGenNumGpu` outright.
`vramMB` is the whole unified pool, exactly as before.

**Why.** A `num_gpu` layer cap is a CUDA concept with no meaning on Metal. That was already true, but
only by arithmetic accident: the Mac path reports `vram == ram`, and the carve row requires `vram`
BELOW its RAM bound, so the row was unreachable on a Mac by construction. An invariant this
load-bearing should not rest on a coincidence. The refusal is a no-op today and it is pinned by a
test that feeds `computeTier` numbers which DO reach the carve row, so a future change to how `vram`
is derived cannot put a layer cap on Metal silently.

**What was built and reverted, and why it matters more than what shipped.** Item 4 said the tier
"must budget for the toolchain and size the model and `numCtx` to the remainder". That was built:
`probeHardware` reported the pool minus `TOOLCHAIN_RESERVE_MB` (14336, the goal's own arithmetic
from 36864 - 22528), and `computeTier` sized the context window to the remainder. The consequence
was that a 16GB Mac dropped from the dense 14b to FIM only.

**The human had already tested a 16GB Mac and it works.** A live test on the machine outranks an
arithmetic argument about it, so the subtraction and the `numCtx` sizing are both gone. The reserve
survives as a REPORTED number on the `[carve]` channel, labelled "reported, never budgeted".

**The part worth carrying forward.** `MIN_FNGEN_VRAM_MB` is 12288 and a 16GB Mac reports about
16384, so ANY toolchain reserve above 4096 would have excluded it - and VS Code alone measured 4.3GB.
So the choice of 14336 was never what decided the outcome; the pre-existing 12288 minimum was. That
the machine works anyway is evidence the 12288 threshold is a discrete-GPU number that does not
transfer to Metal, where there is no PCIe transfer and offload behaves differently. That is a real
open question about the tier table and it wants a measurement ON Apple Silicon, not another estimate.

**Blast radius.** None. Every Apple Silicon tier selection is identical to v8's, the discrete path is
untouched, and the only behavioural difference anywhere is a `num_gpu` key that was already absent.

**Pinned by.** `test/impl-v8-apple-silicon.test.cjs`: the restored v8 band rows, plus
`Apple Silicon: the CUDA carve is refused on unified memory even when the numbers reach the carve
row` and `Apple Silicon: the toolchain headroom estimate is on the channel, and is not what the tier
is chosen on`.

## S12. Go is a registered placement language, and the repair prompt is 0-based

**Session-v35 item 1. Awaiting the human's ratification.** The behaviour change is proven necessary
by a live capture; what needs a call is the two frozen rows it moves.

**What changed.** `assembleRepairPrompt` normalises the failing code to 0-based before it goes in the
fence, through `dedentReplyCode` - the declared inverse of `placeGeneratedReply`, sharing the same
language table and the same per-language string scanners. `placeGeneratedReply` gains a Go leg
(`reindentGoBody`), so Go is now a registered language on both directions.

**Why.** Every repair round added one indent level to the human's file. Captured on
`acme-db/acme_crypto/src/pki.rs`: three rounds on `create_ca` walked its body from 8 spaces
to 12 to 16 while the closing brace went 4 to 8 to 12, against a header at 4. Four spaces a round,
cumulative, and silent - Rust indentation is not semantic, so the compiler oracle cannot see it and
the only detector is a human reading the file.

The chain: the span starts at the declaration's first character, so the failing code is flush on line
one and carries the FILE's absolute column on every line after it. A model echoes what it was shown.
The placement then reads the reply's base off the first non-blank line, finds the signature at column
zero, dedents nothing, and adds the target's indent on top of the indent the body already had.

**Why the fix is at the INPUT and not in `replyBaseIndent`.** Verified before it was touched: a
round-0 body at 4, with a base of 4 stripped, lands at 4 when 8 is wanted. Round 0's indent is the
model's own and RELATIVE; a repair round's is inherited from the file and ABSOLUTE. Same reply shape,
different provenance, so no reindent rule can tell them apart. Only the input can.

**Two rows moved, and NEITHER is a prompt-identity oracle.** All five frozen repair-prompt-identity
suites are untouched and green (`blind4-prompt`, `blind7-prompt-identity-v2`, `blind-repair-context`,
`impl-v30-p34-roundlegs`, `impl-v3-structgen`). The dedent is a no-op on their fixtures, which are
flush-left already. What moved is two rows that used `go` as their STAND-IN for "unregistered":

- `test/blind-inplace-placement.test.cjs`, "clause 6: an unregistered languageId returns the reply
  unchanged". `go` removed from the list. The clause is unchanged and still asserted by `ruby`,
  `plaintext`, `""`, `GO` and `c#`.
- `test/impl-inplace-reply.test.cjs`, "an unregistered language is returned untouched". Moved to
  `ruby`, and a new row pins the Go leg's actual behaviour.

Neither assertion was loosened. Both were statements about the REGISTRY, not about Go, and the
registry gained a member.

**Go was the trap, and it is why this is a supersession rather than a patch.** `placeGeneratedReply`
had no Go branch at all, so Go repair only looked correct by CANCELLATION: the prompt showed
file-indented code, the model echoed it, placement was a no-op, and the bytes landed back where they
came from. A Go round-trip test passes with the defect fully present. Two consequences: a nested Go
target was ALREADY mis-placed on generation, and dedenting the prompt without adding the leg would
have given Go a NEW bug in the same motion.

**The dedent is string-aware, and that is load-bearing.** Each language's leg reuses the scanner its
`reindent` sibling already uses, reading the state ENTERING each line so the two directions agree line
for line. Otherwise a multi-line raw string carrying the header's indent would be silently rewritten
going in and never restored coming out - the same family of silent corruption this item exists to
kill.

**The column is passed, not guessed, on the path that touches a file.** The resolver already holds the
span's column and hands it to the placement leg on the way back, so it now also goes into the prompt
as `spanIndent` and the normalisation is exact. This matters for Python, where inference cannot be
exact even in principle: a braced language puts its closing token back at the header's own column so
the shared prefix recovers it, but a `def` has no closing token and every line below it is strictly
deeper. Inferring there would force the block to a 4-space step and silently re-indent a 2-space file.
The inference path survives for callers that do not hold the column (the measurement harness, injected
hooks), and Python's leg re-anchors on top of it.

**Pinned by.** `test/blind-v35-repair-indent.test.cjs` (blind, 37 rows: two repair rounds over a
NESTED target in all five languages, plus the round-0 no-regression rows that pin the fix is at the
input) and `test/impl-v35-dedent.test.cjs` (39 rows: the character-prefix rule, string interiors
frozen in both directions, and dedent-then-place identity over three rounds).

**One blind row is red on purpose and must not be made green.** `A/python: the repair prompt's fenced
code is 0-based (first line flush, min indent of the rest is zero)` contradicts its own sibling
`A/python: ... byte for byte`, which requires the body at 4. Zero is not a different reading, it is
corruption: body at 0, placement adds the header's 4, and the body lands level with `def`, which is
`IndentationError: expected an indented block`. The row encodes the braced-language shape as
universal. It is a defect in the oracle's spec, left red and unedited rather than weakened.

## S13. An enclosing impl's generic parameter is refused as an example candidate

**Ratified in session-v41. The goal's standing rule pre-authorized v39-style reversals at the rows,
and the session's scraps (`P3-supersessions`) name this one; the v41 contract row was written red
before the code.**

**What changed.** Session-v41 phase 3 added a gate that refuses usage-example blocks not naming
their headed type, and `enclosingImplGenericParams` (`src/vscode/fnGen.ts`), which unions the
enclosing `impl` block's generic parameters into the example-candidate refusal beside the
signature-declared set. A method inside `impl<T> Store<T>` no longer offers `T` as an example
candidate.

**What this supersedes.** `test/blind-v38-p3-candidate-refusals.test.cjs` row B3 pinned the hole
OPEN: the v38 contract said "the signature's own parameter list", this `T` is declared one line
above the signature, so the row asserted the candidate list `["T", "Widget"]`. Its own comment
deferred the fix: "closing it means reading the enclosing item, which is a different mechanism with
its own measurement."

**Why the old behaviour was wrong.** The old expectation asserted a junk example block renders. A
bare type variable has no surface to exemplify, whichever scope declared it, so an example block
headed by one is a lie in the product's voice - exactly the lie the new gate refuses. v38 recorded
the hole rather than fixing it because the mechanism (reading the enclosing item) had no
measurement; session-v41's census supplied one, with rows reaching the example leg down exactly
this shape.

**The re-cut row.** B3 is edited in place, v39-style, with the reversal written at the row. The
fixture is untouched; only the expectation moved, to `["Widget"]`, and the row's name says which
session moved it. The two files now assert the same outcome on the same shape.

**Pinned by.** `test/blind-v41-p3-example-gate.test.cjs` row E1 (the ratified contract) and the
re-cut B3 in `test/blind-v38-p3-candidate-refusals.test.cjs`.

## S14. An example block must name its headed type, or it does not render

**Ratified in session-v41, same footing as S13: the goal's standing rule pre-authorized v39-style
reversals at the rows, and the session's scraps (`P3-supersessions`) name this row and its fix
shape.**

**What changed.** Session-v41 phase 3 put a gate at `assembleSurfacePayload`
(`src/core/compilerDirected.ts`), the one render seam every example block passes - fn-gen's
pre-fill and the repair surface both assemble there. An example whose code never names the type it
would be headed with is refused: the payload falls to the signatures branch, or to `""` when
nothing else exists.

**What this supersedes.** `test/blind7-payload.test.cjs`, the row `a rendered payload always
contains the firm instruction; an empty one contains nothing`. Its first assertion fed an example
under the throwaway head `X` and expected the firm instruction back - the v7 contract's "example
present -> renders", written before any gate existed. The example sentinel names `BloomFilter`, so
under the gate that input is refused and, with no signatures beside it, renders `""`.

**Why the old behaviour was wrong.** The rendered header says "Usage example for `X` (from its
docs, this compiles)" over code that never mentions `X`. That is a lie in the product's voice
about what the docs contain, and the junk blocks session-v41's census counted reached the model
down exactly this path. The old assertion pinned that the lie renders.

**The re-cut row.** Edited in place, v39-style. The row's subject survives verbatim: every payload
that RENDERS carries the firm instruction, and an empty one carries nothing. The head-matched
input carries the old first assertion; two new lines pin the gate's fallbacks (refused-to-
signatures renders the signatures branch with the instruction, refused-with-nothing is exactly
`""`). The file's other example rows never moved - their heads already say `BloomFilter`.

**Pinned by.** `test/blind-v41-p3-example-gate.test.cjs` rows A1/C/D (the ratified contract) and
the re-cut row in `test/blind7-payload.test.cjs`.

## S15. Go's prefill type cap is 8; the all-languages-identical cap is dead

**Ratified in session-v42, on the human-ratified funnel measurement; the implementer's
stop-and-report is `session-v42/scraps.md` `P2-supersessions`, and the reversals at the rows are
the oracle owner's, v39-style. One entry for the batch: nine rows across two files, all moved by
the same number.**

**What changed.** Session-v42 phase 2 shipped `GO_PREFILL_TYPE_CAP = 8` on Go's `PrefillLang`
entry (`src/vscode/fnGen.ts`). Every other language keeps 4. The evidence is the authored-gesture
funnel's cap ladder (`session-v42/funnel-report.md` addendum, `funnel-rows-cap{4,6,8,12}.jsonl`):
going 4 -> 8, in-cap 50.9% -> 78.8% and injected 34.8% -> 53.9% on the shipped-code re-run, with
the knee at 8 because 8 equals `PREFILL_RESOLVE_CAP` - a type cap above the resolve cap promises
slots that can never be filled. Rust stays 4 because its own widening arm measured flat; that
refutation is why Rust keeps 4, not an oversight. TS, C#, and Python have no measurement of their
own, so they keep 4 and their rows now guard it.

**What this supersedes.** The v37 item-2 contract "give each language its own bounds, values
unchanged" pinned the seam AND the uniform value. The seam was built precisely so a later
measurement could move one language alone; v42 is that measurement, and the uniform-value half of
the pin has to die for the seam to do its job. Nine rows quantified over it:

- `test/blind-v37-p2-prefill-bounds.test.cjs`: `A [go]` (typeCap 4 -> 8); `B1` (Go now carries
  TWO distinct bounds, since its typeCap equals its resolveCap by measurement - the
  separate-own-members subject is untouched); `D1` (the no-op row: Go's leg runs ten candidates
  and demands exactly 8, so it still goes red on Go serving more; the four-language legs still
  demand exactly 4).
- `test/blind-v37-p3-surface-setting.test.cjs`: `A1` (auto is per language: Go 8, others 4);
  `A2` and `A4` ("generous moves it UP in every language" is false in Go, where auto already sits
  at the resolve clamp - generous equals auto by value and by bytes, which is the clamp doctrine
  the file's own section C pins); `B1` (Go's control: three setting values, two distinct budgets,
  with `minimal` as the liveness witness); `E1` and `E2` (Go's moving/recognised-value witness is
  `minimal`, since `generous` is indistinguishable from `auto` there).

**What did NOT move.** `resolveCap` 8 and `provenanceCap` 24, in every language. The latency-cap
freeze rows, the applied-on-top rows (p3 A3/D1/D2), the manifest rows, and every Rust prompt-byte
oracle - the Rust control in `test/blind-v42-p2-go-cap.test.cjs` pins cap 4 and the eviction line
verbatim.

**Each re-cut row can still go red.** Go serving more than 8 fails p2 D1 and p3 A4 (candidate
pools wider than the cap); a language silently inheriting Go's 8 fails its own `A [lang]`/A1 row,
which asserts exactly 4.

**Pinned by.** `test/blind-v42-p2-go-cap.test.cjs` (the ratified contract: Go 8, Rust control 4)
and the nine re-cut rows listed above.

## S16. The prefill's four bounds become one setting, and Go's cap exception dies

**Ratified by the human, 2026-08-10, `session-v48/goal.md`. Contract:
`session-v48/contract-phase1.md`. One entry for the batch: this is a single ruling and it moves
rows across nine files.**

**What changed.** The four numbers that bound the fn-gen injected surface - how many ROOT
candidates are walked, how many local field-types are followed per node, how many distinct types
one walk may emit, and the shared render budget - stop being module constants and become
derivations of one setting, `column80.injectedContext`, with four stops (`small` / `medium` /
`large` / `frontier`, default `small`) plus an internal `shipped` stop that is the pre-dial point.
Two more move with them, because they had to: the resolve cap and the provenance cap, since a root
beyond the resolve cap can never be injected. `column80.injectedSurface` (`auto` / `minimal` /
`generous`) and the `injectedTypeCap` function that applied it are gone, as are the per-language
`typeCap` / `resolveCap` / `provenanceCap` fields on `PrefillLang`.

Go's `GO_PREFILL_TYPE_CAP` survives in exactly one place, and only after the adversarial review
(2026-08-10): the internal `shipped` stop, which is the before-side a measurement replays. HEAD
gave Go 8 roots and every other language 4, so a `shipped` stop handing Go 4 renders 1204 bytes
where HEAD renders 2116 - a baseline that never shipped. It is applied where the pre-fill spends
the cap (`prefillRootCap`, reading `PrefillLang.shippedRootCap`) and only when the stop is
`shipped`; every stop a setting can select still gives all five languages one root cap.

**Why the old behaviour was wrong.** `injectedSurface` moved exactly ONE of the four numbers and
therefore could not change the prompt on its own. Measured before the build, against the shipped
`walkDataShape` on a 40-wide synthetic type graph at depth 2: raising breadth alone from 4 to 48
with the total-type cap at 6 and the render budget at 200 produced a BYTE-IDENTICAL 791-char block
at every rung, and so did breadth and the total together with the budget pinned. Only all four
moving together moved the block: 791 -> 1577 -> 3191 -> 6392 -> 10648 chars, 1 -> 2 -> 4 -> 7 -> 12
types. The root cap is the same story one stage up - session-v45 measured C# cap 4 -> 8 taking
types-that-got-a-slot from 47.8% to 92.6% and injection only from 16.4% to 20.2%, because more
roots against an unchanged shared budget re-divide the same bytes. A slider that silently does
nothing is the failure class this project spent two sessions digging out of.

**Why Go's exception dies.** Go's 8 was measured (the authored-gesture funnel's cap ladder over 907
rows in six repositories, knee at 8). The ruling brings every language UP to it rather than keeping
a per-language table. Rust's own 4 -> 12 ladder measured flat, and that is not an argument against
this: it ran with the token budget PINNED, and session-v45 showed that raising the cap alone
relocates the loss rather than recovering it. In the dial roots and budget move together, so the
condition Rust measured flat under does not hold. Session-v47's scout also found 11 of 30 Rust rows
already at or over the 4-cap, with the enclosing type evicting a candidate on those.

**What did NOT move.** `TESTGEN_PROFILE`, and with it test-gen's root, resolve and provenance caps -
its numbers were chosen for construction and no measurement has ever been taken against that
gesture at any stop, which is as true of how many roots it admits as of how far it walks them. The
first cut read `rootCap` off the live stop before the `forConstruction` branch and silently took
`column80.generateTests` from 4 roots to 8 at the install default, on a gesture whose channel
deliberately prints no stop line; it now resolves the `shipped` numbers whatever the setting says.
FIM: `completionProvider.ts` keeps its own `DATASHAPE_BOUNDS` and `CROSS_FILE_BOUND` and does not
read the stop, because FIM caps spend latency against a keystroke deadline rather than prompt
budget (contract P7). `GEN_NUM_CTX`, `GEN_TIMEOUT_MS`, `GEN_MAX_TOKENS`, `FRONTIER_MAX_TOKENS`. And
the rig's textual patch sites, `var DATASHAPE_TOTAL_TOK = 300;`, `var PREFILL_TYPE_CAP = 4;` and
`var GO_PREFILL_TYPE_CAP = ...;`, which feed the `shipped` stop and reach a live prompt through it -
the rig's own loaders now pin that stop, because its settings stub answers the default for every
key and every arm was silently rendering the `small` prompt.

**What DOES move that the first cut pinned.** The repair and refine path. `oracleSurface.ts` was
pinned to `shipped`, with a comment claiming the contract required it; the contract's do-not-change
list carves OUT exactly what `surfaceCap` and `refineTotalChars` derive from the aggregate budget.
A developer who picks `frontier` for their model's window has no second setting for the repair
prompt and no channel line telling them it stayed at the local-30B point, so both call sites read
the live stop. `surfaceCap` is 8 at the install default (4 at `shipped`), `memberCap` 48 (24).

**Rows re-cut.** Two files were superseded whole - their subject no longer exists as a property, so
there was nothing to invert each row to, and each keeps a short set of rows asserting the reversal:

- `test/blind-v37-p2-prefill-bounds.test.cjs` (the per-language bounds seam, 17 rows -> 6).
- `test/blind-v37-p3-surface-setting.test.cjs` (the `injectedSurface` setting, 24 rows -> 7).

The rest were re-cut in place, keeping their subject:

- `test/blind-v42-p2-go-cap.test.cjs`: the Rust CONTROL row inverted - Rust now holds the same
  slots as Go.
- `test/adversarial-v42-p2.test.cjs`: S1 (one root cap for five languages, and the
  rootCap <= resolveCap coupling now pinned at every stop), S3 (re-cut onto `injectedContext`), R1
  (the rig's cap patch, pinned to the `shipped` stop it feeds, and given the control it lacked).
- `test/blind-v46-budgetprofile.test.cjs`, `test/impl-v46-p0b-budgetprofile.test.cjs`: the identity
  table is asked for at the `shipped` stop. Every value unchanged.
- `test/impl-v46-p0b-prompt-identity.test.cjs`: the frozen sha256 pins are asked for at the
  `shipped` stop and are UNCHANGED, which is the phase's P3 witness.
- `test/review-v45-p3-budget.test.cjs` R4: both arms at the `shipped` stop.
- `test/blind-v24-p1-receiver.test.cjs`, `test/impl-v24-p1-receiver.test.cjs`,
  `test/blind-v7-prepare.test.cjs`: budget-pressure fixtures widened, and their widths derived from
  the seam rather than written down, because at the install default the old fixtures fit inside the
  budget and passed while nothing was under pressure.
- `test/blind-v6-item4.test.cjs` (A5, F1), `test/blind-v35-harvest-fallthrough.test.cjs` (C3-b),
  `test/review-v34-harvest.test.cjs` (ATTACK 3): the same widening on the REPAIR side, once that
  path was unpinned. Four fixtures cut against `surfaceCap` 4 and `memberCap` 24; all four now read
  the cap from `surfaceCapFor` / `memberCapFor` at the default stop and sit one step over it.

**Each re-cut row can still go red.** A language that reacquires its own cap fails the p2 and S1
rows; a stop whose `rootCap` exceeds its `resolveCap` fails three files; a byte of drift in the
derivation seam fails the `shipped` sha pins; a fixture that stops binding fails its own explicit
precondition.

**Pinned by.** `test/blind-v48-p1-context-dial.test.cjs` (the ratified contract, written blind
against `contract-phase1.md`) and `test/impl-v48-p1-context-dial.test.cjs`.

## S17. The prompt-versus-window estimate stops being `chars / 4`

**NOT YET RATIFIED. Built 2026-08-10 in the session-v48 phase 2+3 adversarial-review loop-back
(defect D6, triaged DO). Flagged here because it supersedes the written contract's own wording.**

**What changed.** `session-v48/contract-phase2.md` P2 specifies "a `chars / 4` proxy, the same
convention `WalkBounds.TOK_MAX` already uses". `src/core/promptBudget.ts` now charges ASCII at 3
characters per token, every non-ASCII UTF-16 unit at a whole token, and adds a flat 48-token
allowance for the chat template the prompt string does not contain. `PROMPT_CHARS_PER_TOK` is gone,
replaced by `PROMPT_ASCII_CHARS_PER_TOK`, `PROMPT_NON_ASCII_TOK_PER_CHAR` and
`PROMPT_TEMPLATE_TOK`.

**Why the old behaviour was wrong.** The same contract clause requires the estimate to be
CONSERVATIVE: it may over-estimate, it must never under-estimate and let a silent head-truncation
through. `chars / 4` under-estimates in three ways at once, and the review measured all three. An
ASCII, a CJK and an emoji prompt of the same 25355 UTF-16 units estimated identically at 6339
tokens while their UTF-8 sizes were 25355 / 76065 / 50708 bytes; a Qwen-class BPE encodes CJK at
roughly one token per character, so that CJK prompt was a ~4x under-estimate and `chars / 4` waved
it through a 14336-token window. Dense source runs nearer 3 chars/token than 4 - punctuation,
indentation runs, snake and camel identifiers - so ASCII source under-estimated by ~33% as well.
And neither the chat template nor the model's role scaffolding was counted at all.

**The walk's own `TOK_MAX` convention is untouched.** That number sizes a RENDER budget, where 4 is
a sizing choice with a corpus behind it; this one decides whether a prompt is sent, where the two
error directions are not symmetric. Sharing a divisor between them was a convenience, not a
requirement, and `src/core/dataShape.ts` still uses `tok * 4` exactly as before.

**All three new values are judgment calls, and the code says so.** Rows in `docs/constants.md` name
each one, the reasoning, and what would settle it: ollama returns the real `prompt_eval_count` on
every response, so a session that logged (estimate, prompt_eval_count) pairs over a corpus could
calibrate these instead of reasoning about them. Nothing reads that field today.

**Blast radius, measured rather than assumed.** A more pessimistic estimate refuses and shrinks
earlier for everyone, so the question is whether it binds in practice. The measured typical fn-gen
prompt (~1100 tok on the old proxy, p90 ~1295 - `docs/constants.md`) reconstructs at 1136 tok
before and 1562 tok after, against a 14336-token window: 12774 tokens of headroom, a 1.38x ratio.
It does not bind on an ordinary gesture. The phase-2 blind oracle
(`test/blind-v48-p2-arbitration.test.cjs`) stayed green untouched, including its own independent
`chars / 4` conservatism check, which the stricter estimate satisfies by construction.

**Pinned by.** `test/review-v48-p2-loopback.test.cjs` (the D6 rows) and
`test/impl-v48-p2-arbitration.test.cjs` A1/A2/A3/A6/A7/A8.

## S18. Only a PRE-CONSENT discard reaches the FIM channel

**RATIFIED 2026-08-22 by the human, as shipped.** Amended 2026-08-21 in the session-v56 phase 3
review loop-back (finding MED, triaged DO, commit `e0bc0f1`). Flagged here because it narrows the
written contract's own wording.

**What changed.** `session-v56/contract-phase3.md` says a discard in a `source: "fim"` session goes
to the channel instead of a toast. `present()` has SIX discard causes and the first cut routed all
of them. Only the two PRE-CONSENT causes route now: the document closed, or the document changed,
DURING generation. The three post-Accept causes (closed or changed while previewing, the editor
refusing the edit) and a failed preview open toast in every session, seam wired or not.

**Why the old behaviour was wrong.** The item's whole argument is that a background race the user's
own typing wins is not the user's business. A post-Accept failure is not that race. The user pressed
Accept, consented to a write, and the write did not happen. Silencing that is how a product loses a
change without saying so. The two halves are one function apart in the code and opposite in meaning.

**What did NOT change.** `logOutcome("discarded")` still fires on all six causes, so the channel
record is what it was. Every explicit-gesture source keeps today's toast wording byte for byte, on
all six.

**A second, smaller narrowing rode with it.** The refine gesture's evidence line called a system
discard `result=rejected`, contradicting the outcome log two lines away. A system discard now logs
`result=discarded` and a human reject keeps `result=rejected`. Refine is manual-only, so no surface
seam threads through it and the return value carries the split on its own.

**Pinned by.** `test/impl-v56-p3-fim-discard-surface.test.cjs`. Its second-guard row now asserts a
TOAST inside a fim session, which is the row that pinned the over-broad routing before, and it
gained rows for editor-refused-toasts-everywhere and for both refine evidence lines.

## S19. `UND_ERR_*` narrows to `UND_ERR_CONNECT_TIMEOUT` alone

**RATIFIED 2026-08-22 by the human, strict version: `UND_ERR_HEADERS_TIMEOUT` stays excluded.** The
"isn't running" toast carries a Start button, so it must be provable, and an accepted connection
disproves it. Narrowed 2026-08-21 in the session-v56 phase 5 review loop-back (finding MED 3,
triaged DO, commit `37d0440`). Flagged here because it narrows the written contract's own wording.

**What changed.** `session-v56/contract-phase5.md` clause 2 says `isServerUnreachable` recognises
undici's `UND_ERR_*` codes, and the implementation matched the whole prefix. `UNREACHABLE_CODES`
(`src/vscode/fnGen.ts:875`) now carries `UND_ERR_CONNECT_TIMEOUT` by name and nothing else from that
family.

**Why the old behaviour was wrong.** The prefix sweeps in the case where the server WAS reached. A
real mid-stream socket close arrives as `TypeError("terminated")` with `cause.code = UND_ERR_SOCKET`,
after the server accepted the connection and streamed a token. That classified false before the
phase and true after it, so the toast flipped from "function generation failed - terminated" to "the
Ollama server isn't running" plus a **Start ollama serve** button, for a server that is running and
had already answered. Item 63 exists to stop the product asserting false things about its own state.
A fix that manufactures one is not the fix.

**Only a connect-phase failure proves the server was never reached.** That is the whole test, and
`UND_ERR_CONNECT_TIMEOUT` is the only member of the family that passes it. The contract's own
falsification line names that code and no other, which is why the blind oracle stayed green through
the narrowing rather than catching it.

**One word away from a different answer, and it is yours.** `UND_ERR_HEADERS_TIMEOUT` (TCP accepted,
no headers ever came) is excluded by the same test that convicts `UND_ERR_SOCKET`, but a wedged
tunnel arguably reads better as unreachable than as a generic failure. It sits in the impl file's
`NOT_UNREACHABLE` list beside `UND_ERR_SOCKET`, so flipping it is one edit and one row.

**What widened rather than narrowed, in the same phase.** `ETIMEDOUT` and `EHOSTUNREACH` joined the
list, and the WHOLE list is matched at `err.code` as well as at `err.cause.code`. A top-level
`ECONNREFUSED` classified FALSE until this session, a pre-existing asymmetry nobody had noticed; a
symmetry row now goes red on a future half-wiring.

**Pinned by.** `test/blind-v56-p5-bounded-bodies.test.cjs`, untouched through the narrowing, and
`test/impl-v56-p5-bounded-bodies.test.cjs`, which carries the real mid-stream shape and the
connect-timeout-yes / socket-and-headers-no pair.

## S20. Anthropic's in-stream error frame is not a silent server

**RATIFIED 2026-08-22 by the human, as shipped.** Narrowed 2026-08-21 in the session-v57 phase 4
review loop-back (finding HIGH 1, triaged DO). Flagged here because it narrows the written
contract's own wording, and because the wording it narrows came from a roadmap entry rather than
from a phase.

**What changed.** `session-v57/contract-phase4.md` clause 1 listed five throws that must all produce
one sentence, and roadmap item 66 named the same five. Reading that clause today finds four and a
struck-through fifth: the file was amended in place, which is why the cite does not match the count. Four of them ship that way. The fifth,
`anthropicInstruct.ts`'s SSE `error` frame, does not, and it was removed from the class.

**Why, measured.** That frame is Anthropic's generic in-stream error envelope. A rate limit, an
invalid API key and a malformed request all arrive through it, and all three came out as:

```
thrown: "Anthropic stream error: invalid x-api-key"
toast : "Column 80: the model server went silent mid-reply, so nothing was written -
         check the server, then run the gesture again."
```

Wrong cause and wrong remedy, with the real reason taken off the screen. Before the phase, that user
was told their key was invalid, in jargon. After it, they were told to check a server that is fine.

**What ships instead.** The throw is reworded to `Anthropic reported an error mid-reply: ${...}`. It
keeps the provider's own message, which is the actionable half and the same reasoning the
HTTP-status throw on that arm already uses, and it drops `stream error`, which was the only API
vocabulary it carried. The site gets no crafted sentence, because it is not one failure.

**The classification error was in the item, not the build.** Item 66 was REASONED from source, and
reading a throw site tells you a stream carried an error, not which errors a provider puts there.
This is what `goal.md`'s own falsification-gap section predicted: nothing in the session watched a
real Anthropic failure, and the phase's review is what drove one.

**Pinned by.** `test/blind-v57-p4-one-voice.test.cjs`, whose rows for this arm were re-cut to pin the
opposite (a generic provider error is NOT called a silent server, and it still puts no API vocabulary
on the screen), and `test/impl-v57-p4-one-voice.test.cjs`, which carries the coupling on the new
wording. The measurement and the ruling are at the end of `session-v57/goal.md`.

## S21. The channel's raw body escapes its line breaks

**NOT YET RATIFIED.** Narrowed 2026-08-22 in the session-v58 phase 1 review loop-back (a MEDIUM
finding, triaged DO). Flagged here because it narrows a clause of the contract written for that
phase, and because the clause it narrows is the one the human's ruling is about.

**What changed.** `session-v58/contract-phase1.md` clause C4 says a body inside the cap reaches the
channel whole, "byte-for-byte as the server sent it". It does not, quite. Line breaks are rendered
as their escapes - LF, CR, U+2028, U+2029 and NEL each become a visible two-or-six character
sequence - so the channel copy is the server's body recoverably rather than literally. Every other
byte is untouched, and a body with no line breaks in it, which is what these APIs actually send, is
unaffected.

**Why, and it is not cosmetic.** Every real sink for this line is
`vscode.OutputChannel.appendLine`, which renders one row per line break. Unescaped, a server chose
how many channel rows its error occupied and what each of them said. Driven: a 500 whose body is

```
{"error":"real"}
[fngen] outcome=ok
[carve] pull done model=evil ms=1
```

rendered as three rows, two of them wearing the product's own tags, on the one surface whose
trustworthiness is the entire point of the change. This line carries up to 16 KiB of
server-controlled text, forty times what any surface carried before, so the phase widened that
canvas by a factor of forty at the same moment.

**Why escaping rather than a frame.** A begin/end frame around the dump was the other candidate and
was rejected: a server can emit the end marker too, and the forged rows still render inside the
frame wearing product tags. A single row cannot be forged into two, so escaping closes the whole
route rather than labelling it.

**What it does NOT close.** The elision marker is still forgeable - a body ending in the literal
text that the bound appends reads as a body the product cut - and every OTHER channel surface that
interpolates server text still carries unescaped line breaks: `[fngen] request failed:`,
`[fim] request failed:` and `[carve] pull failed`. That is one decision for all of them and it is
`session-v58/scraps.md` S58-2.

**The measurement trap behind it, worth its own sentence.** A test sink collects one array element
per `log()` call while the channel renders one row per line break, so every line-counting row in
the suite measures a different thing from what a user sees. That is why this defect was invisible
to a green gate.

**Pinned by.** `test/adversarial-v58-p1.test.cjs`, the four `forges its own channel lines` rows,
re-cut to pin one physical row per dump and no product tag at the head of any rendered row.

## S22. The toast's channel pointer is earned by segment count, not by `trim()`

**NOT YET RATIFIED.** Ruled 2026-08-22 as amendment 1 to `session-v58/contract-phase2.md`, after
the phase-2 blind oracle proved the written clause undecidable. Flagged here because it changes a
behaviour session-v57 shipped, on a sentence that appears on several toast surfaces.

**What changed.** Whether a one-line toast appends "The full message is in the output channel" was
decided by `firstLine(why) === why.trim()`. It is now decided by whether the message has more than
one non-blank segment under the widened line-break set (`hasMoreThanOneLine` in
`src/vscode/toastText.ts`).

**Why the old test could not survive the widening.** It inferred "the cut dropped something" from
`trim()`'s own idea of a line break, and `trim()` strips U+2028 and U+2029, which are
LineTerminators, but NOT U+0085, which is a control character. Once `firstLine` cut all six breaks,
the same message ending in U+2029 got no pointer while ending in NEL got one - pointing at a
channel line holding nothing the toast did not. That difference is an accident of `trim()`'s
definition rather than anything about the message, and no rule could be written down that described
it.

**The blast radius, measured rather than argued.** The two rules agree on every message broken only
by `\n`: checked over 1296 LF-only strings, 5832 CRLF/LF strings, and the four shapes that matter
by hand - `"a\nb"` (pointer, both), `"a\n"` (none, both), `"a\n\n"` (none, both), `"a\n  \n"` (none,
both). The only divergence in the whole swept set is NEL. So no message the product produces today
changes its pointer, and the suite's re-cut list for the widening is empty.

**A second live copy had to go with it.** The repair-unavailable toast (`src/vscode/fnGen.ts`) ran
its own inline copy of the superseded comparison and would have kept answering the old way under
the new `firstLine`. It calls the leaf now, and `test/impl-v57-p3-tier-message.test.cjs`'s source
pin was updated to match - its assertion is unchanged, because the clause it pins (the pointer is
conditional and earned) is still true and is now stated rather than inferred.

**Pinned by.** `test/blind-v58-p2-repair-onelines.test.cjs` (the `tierDisabledToast` rows across
the break set, and the C6 regression corpus) and `test/adversarial-v58-p2.test.cjs`, whose
`B2 [CLEAN]` row scans every toast surface for a surviving copy of the old comparison - with
comments stripped first, because the fix's own coupling comment quotes the expression it replaced.

## S23. An HTTP status gets a crafted sentence only where the product knows a class

**NOT YET RATIFIED.** Ruled 2026-08-22 in the session-v58 phase-7 review loop-back, after the
adversarial review found the first cut had made a toast WORSE than the string it replaced. Flagged
here because it narrows clauses of that phase's own contract and one line of `goal.md`.

**What changed.** `goal.md` and `contract-phase7.md` both say the HTTP-status class ends with a
catch-all: "anything else - the generic failure sentence with the status number". There is no such
sentence now. An unclassified status returns no crafted sentence at all and falls through to the
catch-all that has always rendered these messages.

**Why, driven.** The first cut answered every unlisted status with
`Column 80: the model provider answered with HTTP 404, so nothing was written`. Measured at the
branch point, that same failure had said:

```
model "test-model" not found, try pulling it first
```

and on the other two arms, `prompt is too long: 250000 tokens > 200000 maximum` (400) and
`context_length_exceeded` (413). Those three are exactly the statuses where the BODY is the next
action, and exactly the ones the product has no class for - so the crafted sentence replaced a
remedy with a number. `errorBound.ts`'s own bound is documented as existing so that "the ordinary
model not found error" is not mangled; the sentence deleted it from the toast entirely.

**This is S20's ratified reasoning one layer out.** S20 says a generic provider envelope keeps the
provider's own message and gets no crafted sentence, because that message is the actionable half.
No class is the same condition: the product does not know what happened, so it must not assert a
next action.

**What the user still gets.** The catch-all renders the status number, the provider's reason and the
channel pointer - so C5's clause ("the number reaches the screen") holds, through the message head
rather than through a crafted sentence. What is given up is C6's "no JSON on screen", which is now
true of the classified statuses only. That is the state 2.2.0 ships today, bounded and cut to one
line; it is the absence of an improvement rather than a new exposure.

**Three smaller narrowings ride with it.**

- **The 5xx class is a RANGE**, `>= 500 && < 600`, where the contract's table enumerated 500, 502,
  503 and 529. The enumeration dropped 504 - the commonest of the set after 503 - and Cloudflare's
  520 to 524 onto the fallback path. "Try again shortly" is true of every 5xx.
- **401/403 produces TWO sentences**, selected by the failing transport, where the clause said one
  per class. `column80.cloudApiKey` is the product's only key setting and its own description says
  the local backend ignores it, so a single sentence sent an ollama user to a control that cannot
  help them. The local variant names no setting at all, deliberately.
- **401/403 and 429 gained the channel pointer**, which the first cut gave only to the 5xx class.
  The 401 body separates an invalid key from an exhausted credit balance and the 429 body separates
  a rate limit from a dead quota - differences the class sentence cannot state.

**The pattern this is the fifth instance of, and it is worth naming once here.** In one session,
five crafted sentences were found to be worse than the raw text: S20's remedy pointed at a healthy
server, phase 4's coercion turned a provider's reason into "unknown", phase 6 named two settings
that do not exist, and this one deleted a remedy. Every one is the product asserting a next action
it does not know. The rule that falls out: craft a sentence only where the product has established
what happened, and hand over the provider's own words everywhere else.

**Pinned by.** `test/blind-v58-p7-http-status-classes.test.cjs` and
`test/adversarial-v58-p7.test.cjs`, whose unlisted-status rows were re-cut to pin that the
provider's reason survives to the screen - the property whose absence was the defect.

## S24. The C# re-indent freeze mask moves for `$"`, and only for `$"`

**NOT YET RATIFIED.** Session-v59 phase 5, closing roadmap item 60. The fix itself was ratified as
a shape at filing time; what needs a call is the differential claim it falsifies.

**What changed.** `advanceCsLineScan` gained a `$"` opener that pushes a tracked context, and
`CsStrCtx` gave `kind: "raw"` a real hole depth plus its `$` count. Two rows in
`test/adversarial-v55-p13-scanner-stack.test.cjs` asserted the DEFECT and were inverted on purpose:
A13-7 asserted the output was uncompilable and byte-identical to the pre-phase-13 scanner, A13-8
asserted a value still moved. Both now pin the corrected behaviour, and A13-7b and A13-8b were
added beside them.

**Why the old behaviour was wrong.** A hole inside `$"""…"""` was scanned as string TEXT, so a run
of fence quotes in the hole closed the string early, the closing delimiter's line took the indent
while its content lines did not, and dotnet 10.0.111 rejected the re-indented output of compilable
input with CS8999. That is the product emitting C# that does not build.

**The narrowing that needs the call.** A13-3 asserted, over 1.2M random bodies and six opener
configurations, that the old freeze mask and the new one *never disagree*. That is now false by
design. The row was re-cut to pin the BOUNDARY instead: measured over the same population, 1129524
bodies produce 70809 divergences, every one of them holds `$"`, and none is outside it. The row
also fails if the divergence count reaches zero, so a reverted fix reddens it in the other
direction.

**What the divergence is worth.** The population is random junk, so the row says nothing about
legality. Correctness on real C# is graded by dotnet elsewhere in the same file: A13-2's 216 placed
cases still show zero values wrong, and A13-7, A13-7b, A13-8 and A13-8b each compile and run a body
and compare the string's bytes before and after.

**One measured fact the fix leans on.** A line that BEGINS inside a raw-interpolated hole is exempt
from the closing delimiter's whitespace rule, so classifying it as code and shifting it is legal
and value-preserving. Driven against dotnet 10.0.111 before the row was written, not reasoned from
the spec; A13-7b is the pin.

**A `$"` left open at end of line still carries nothing.** Its TEXT cannot span a line in C#, only
its hole can, so the scan pops an unterminated one and the tail stays code - which is what a
truncated model reply already got when `$"` was scanned as a plain string. No change there, stated
because it is the shape a reader will ask about.

## S25. Two surfaces stop keeping their own failure wording

**NOT YET RATIFIED.** Built 2026-08-23 in session-v59 phase 1, which closes S58-7 and S58-13.
Flagged here because it spends a deferral one contract ruled deliberately, and it collapses a
two-outcome row in another contract down to one.

**What changed.** `translateServiceReject` and `generationFailedToast` moved out of
`src/vscode/fnGen.ts` into `src/vscode/failureToast.ts`, a leaf beside `toastText.ts`. Two surfaces
that could not reach them now do:

- The model download toast (`offerModelPull`, `src/vscode/firstRun.ts`) renders the class sentence
  for a classified `HttpStatusError` instead of `Column 80: the download failed - <transport text>`.
- The tighten gesture's proposer-failure warning (`src/vscode/tightenDocComment.ts`) leads with the
  class sentence instead of `Column 80: the model could not be reached, so no type names were
  offered.` Its second clause, `The re-wrap needs no model.`, is unchanged and rides on both
  branches.

An UNCLASSIFIED failure keeps each surface's existing wording byte for byte on both, which is S23's
ruling applied one layer out.

**Why the old behaviour was wrong.** The download path already threw the typed class; nothing on it
could ask what the class meant, so `Ollama 503 Service Unavailable: {"error":...}` reached the
screen with the provider's JSON in it. The tighten gesture answered a 401, a 429 and a 503 alike
with "the model could not be reached", which is false for all three: the server was reached and it
refused.

**What phase 7 of session-v58 deferred, and this spends.** Amendment A3 ruled the pull asymmetry a
deliberate deferral and `test/adversarial-v58-p7.test.cjs` pinned it as a FINDING row - F2 asserted
`firstRun.ts` does NOT reach the translator, F3 the same for `tightenDocComment.ts`. Both rows are
inverted here: they pin the closure and carry the old assertion in their failure message, because a
row that pins a fix should say what the fix was for.

**One narrowing that is not a wording change.** The download surface asks about the typed status
ONLY (`err instanceof HttpStatusError`), not about the whole translator. Every row the later
text-matching passes can reach is a generation reject - "the model's reply contained no usable
code, so nothing was written" - and none of those sentences is true of a download. `pullModel`'s
in-stream throw carries server-chosen text under no payload-carrier head, so routing the whole
translator onto that surface would let a hostile registry pick the sentence by putting a marker in
its error field. A status is a number the transport read off the response, and a body cannot forge
it. The tighten gesture takes the whole translator: every throw that reaches it comes from a
transport, and every transport throw carries an anchor or a carrier head.

**A row that lost a disjunction.** `C7 [pull toast]` in
`test/blind-v58-p7-http-status-classes.test.cjs` accepted EITHER the baseline's wording or a clean
one-line class sentence, because that contract deliberately did not decide whether the pull would
gain class sentences. This phase decided it, so the row was re-cut to pin the one outcome that
ships - a disjunction that still accepts the baseline cannot catch a revert to raw JSON.

**A ride-along, not a supersession.** `Column 80: generation discarded — ${why}.`
(`src/vscode/fnGen.ts`) takes `firstLine`. Five of its six reasons are product prose; the
preview-open branch interpolates a caught error, and a stack in a notification renders as a wall of
rows. No channel pointer, because that reason is never written to the channel.

**Pinned by.** `test/impl-v59-p1-one-sentence-surfaces.test.cjs`, whose row 8 drives one
`HttpStatusError` through all three surfaces and asserts the same sentence body reaches each, plus
rows 3, 5b, 7 and 10 for the four unchanged branches.

## S26. The Rust and C# test rungs stop filtering by substring

**NOT YET RATIFIED.** Built 2026-08-23 in session-v59 phase 4, closing roadmap item 59. The fix
shape was ratified at filing time; what needs a call is that two BYTE-FROZEN command contracts and
one seam's documented output shape move with it.

**What changed.** `generatedTestNames` returns FILTERS, not bare names. Rust's carry the enclosing
`mod` path (`widget_checks::add`), resolved from the marked region's own position; C#'s carry
namespace and class (`Falsifier.Widgets.WidgetChecks.Add`, `Ns.Outer+Inner.Add` when the class is
nested). `buildTestCommand` then emits `--exact` past the `--` separator, and `buildCsCommand`
switches `FullyQualifiedName~` to `FullyQualifiedName=`.

**Why the old behaviour was wrong.** Both filters were SUBSTRING matches, so a rung scoped to one
generated function ran a neighbour's tests and could report the neighbour's red under the named
function. Measured: `cargo test --lib -- add` runs `add` and `add_more`; `--filter
FullyQualifiedName~Add` passes two tests.

**Why both halves had to land together.** The operator alone selects NOTHING, which reads as a
passing rung with no test in it - strictly worse than over-selecting. Measured on this box:
`--exact add` against a bare name runs 0 tests on cargo 1.96, and `FullyQualifiedName=Add` matches
no test on dotnet 10.0.111. So the exact form is emitted only when EVERY filter is a resolved path,
and an unresolved one keeps the substring filter it always had.

**The contracts that move.** `contract-seam.md` invariant 1 called Rust's command BYTE-FROZEN, and
the rows pinning it are re-cut: `blind-v31-seam.test.cjs` (three), `blind-v8-testrung.test.cjs`
(two), `impl-v31-seam.test.cjs` (five), `impl-v31-go.test.cjs` (one, the row that says the Go
plumbing is not what moved the literal). `contract-cs.md`'s `generatedTestNames` rows in
`blind-v31-cs.test.cjs` move the same way. Every one of those rows keeps its own demand; only the
literal changed. `impl-v8-wiring-cores.test.cjs`'s fidelity row is the designated inversion: it
pinned bare names and `--exact` ABSENT, which was the honest pin while the path was unresolved.

**Two refusals, both deliberate.** A GENERIC C# test method keeps its bare name, and so holds the
whole command on `~`: the CLR spells a generic method's name in a form this build has not measured,
and a wrong exact name selects nothing. A generic enclosing TYPE refuses for the same reason
(``Foo`1``). Rust needs no equivalent - a `#[test] fn` cannot be generic.

**Graded, not reasoned.** `test/impl-v59-p4-scoped-rung.test.cjs` drives both real toolchains: two
tests whose names are strict prefixes (`add`/`add_more`, `Add`/`AddMore`), in a module and class
that are NOT the defaults, both FAILING so the runner names whichever it selected. Before the fix
each graded row read 2 selected; after, 1, and it is the named one. The live rows skip under
`SKIP_LIVE=1`, so the gate runs their shape and a human runs their grade.
