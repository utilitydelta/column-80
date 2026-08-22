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

## S24. The C# re-indent freeze mask moves, and the count is the claim

**NOT YET RATIFIED.** Session-v59 phase 5, closing roadmap item 60, AMENDED by that session's fix
round after an adversarial review drove three defects into the shipped work. The fix itself was
ratified as a shape at filing time; what needs a call is the differential claim it falsifies.

**Read the amendments first.** The entry as originally filed published a boundary as measured that
was not, and shipped a regression in the shape next door to the one it closed. Both are corrected
below, in "The narrowing that needs the call" and "A comment inside a hole".

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
design, so the row was re-cut. **The first re-cut was wrong twice, and this is the correction.**

It claimed a BOUNDARY: 1129524 bodies, 70809 divergences, every one holding `$"` and none outside
it. That boundary is a fact about the row's own token list, not about the scanner. `JUNK` carried no
bare `@`, no bare `$`, and none of `$$`/`@@`/`$@`/`@$`, which are exactly the sigil runs that open a
context in a body with no `$"` anywhere in it. Two of the six configurations also satisfied
`includes('$"')` from their prefix alone, so the assertion could not fire for them whatever the
scanner did. Read it as measured and it is false; read it as a statement about that token list and
it is true and worth nothing.

It then asserted `movedWithDollarQuote > 0`, having measured the exact figure and left it in a prose
comment. A `> 0` accepts any count up to the whole population. Driven: a mutant deleting the
`$"`-still-open pop from `advanceCsLineScan` diverges on 75% more bodies than the shipped scanner,
passes the row verbatim, and no other row in the file catches it.

**What the row asserts now.** The six missing sigil tokens are in `JUNK`, and the counts are pinned
per configuration, exactly: over 1155900 bodies, 856 / 211 / 1005 / 1005 / 0 / 60951 for
`(none)` / `@"` / `$@"` / `@$"` / `"""` / `$"""`, 64028 in total, of which **435 carry no `$"` at
all**. The `"""` zero says a plain raw string is untouched; the `$"""` count says the item 60 fix is
still there. Re-run under the same mutant the counts move to 105375 and the row reddens, naming the
configuration that moved. A scanner change of any kind moves one of these numbers, which is the
point: re-measure and re-pin, and say what moved it.

**What the divergence is worth.** The population is random junk, so the row says nothing about
legality. Correctness on real C# is graded by dotnet elsewhere in the same file: A13-2's 216 placed
cases still show zero values wrong, and A13-7, A13-7b, A13-8, A13-8b and A13-10 each compile and
run a body and compare the string's bytes before and after.

**A comment inside a hole, which is where the fix put CS8999 back.** The scanner read `//` and
`/* */` at statement level only, on a written ground that dotnet 10.0.111 disproves: a hole is C#
code and takes C# comments, in all three hole kinds, verified before the fix was written. Skipping
them costs a quote the compiler never sees. An `@"` or a `"""` typed inside a comment opens a
context that never closes, and it then either swallows the real closing delimiter of a raw string
(content and delimiter re-indent by different amounts, CS8999 again) or eats the opening quote of a
real `@"…"` below it, whose value then moves.

Giving `$"` an opener and giving a raw string real holes is what carried that gap into the shapes
where real C# puts a multi-line interpolation. Measured over five bodies, all legal C#, all graded
by dotnet: three were CORRECT under the pre-phase-13 scanner and wrong after, one raw shape was
already CS8999 in both, and the `$@"` shape already moved its value in both. **So the regression is
three shapes, and two of the five predate this entry.** Comments are now read inside a hole too,
which closes the pre-existing pair along with the regression. A13-10 pins the compile, the values
and the freeze mask; A13-10b pins the attribution, because a boundary claim in prose is what this
entry got wrong the first time.

One trap the row is built against: a `"""` run in a comment freezes the whole rest of the body, so
every value survives and all indentation below is lost. A row that grades values only cannot see
it, which is why A13-10 also asserts the statement after the literal still moves.

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
ONLY, not about the whole translator. Every row the later text-matching passes can reach is a
generation reject - "the model's reply contained no usable code, so nothing was written" - and none
of those sentences is true of a download. `pullModel`'s in-stream throw carries server-chosen text
under no payload-carrier head, so routing the whole translator onto that surface would let a
hostile registry pick the sentence by putting a marker in its error field. A status is a number the
transport read off the response, and a body cannot forge it. The tighten gesture takes the whole
translator: every throw that reaches it comes from a transport, and every transport throw carries
an anchor or a carrier head.

**AMENDED 2026-08-23, because the paragraph above described an intent the code did not carry out.**
As built, the download surface called the WHOLE translator behind an `err instanceof
HttpStatusError` gate, and those are not the same narrowing. The gate admits every typed status;
only a CLASSIFIED one gets a class sentence, and an unclassified one returned undefined from the
status pass and fell through to the anchored, payload-carrier and substring passes - the exact
passes this paragraph said the surface does not consult. Driven: `new HttpStatusError("ollama",
404, "pull failed: generation was empty after postprocess")` drew a generation reject's sentence on
a download toast. Not reachable through the real download transport, which heads every message
`Ollama <status> ` and so trips the `"Ollama "` carrier guard - so the surface was protected by a
table two modules away rather than by the gate whose own comment claimed the protection. The code
now calls a status-only entry point, `httpStatusToast`, which can answer only with a class sentence
or with nothing.

**A row that lost a disjunction.** `C7 [pull toast]` in
`test/blind-v58-p7-http-status-classes.test.cjs` accepted EITHER the baseline's wording or a clean
one-line class sentence, because that contract deliberately did not decide whether the pull would
gain class sentences. This phase decided it, so the row was re-cut to pin the one outcome that
ships - a disjunction that still accepts the baseline cannot catch a revert to raw JSON.

**A ride-along, not a supersession.** `Column 80: generation discarded — ${why}.`
(`src/vscode/fnGen.ts`) takes `firstLine`. Five of its six reasons are product prose; the
preview-open branch interpolates a caught error, and a stack in a notification renders as a wall of
rows. No channel pointer, because that reason is never written to the channel.

**AMENDED 2026-08-23: the ride-along cut in the wrong place, and the paragraph above is why.** With
the whole sentence wrapped, the cut fell INSIDE the brackets the sixth reason puts the error in:
`Column 80: generation discarded — the preview could not be opened (Error: the diff editor is gone.`
- an unclosed pair with the sentence's own period welded to a truncated clause. And "that reason is
never written to the channel" was the second half of the defect rather than a justification: the cut
destroyed the only copy there was. The interpolation is now cut at its own site through
`oneLineWithPointer(text, ")", ".")`, so the pair cannot be split however long the error is, and the
whole reason is handed to `logOutcome`, which writes it as `[fngen] discarded: <reason>` - escaped,
on its OWN line, because `[fngen] outcome=discarded` is an evidence token S22's surface oracle
matches whole. The pointer is therefore earned rather than withheld. The five product-prose reasons
pass nothing and their record is unchanged.

**Pinned by.** `test/impl-v59-p1-one-sentence-surfaces.test.cjs`, whose row 8 drives one
`HttpStatusError` through all three surfaces, plus rows 3, 5b, 7 and 10 for the four unchanged
branches. Rows 2, 6 and 8 were re-cut by S31; row 9 was strengthened to fail on an unclosed bracket,
which it did not before.

## S26. The Rust and C# test rungs stop filtering by substring

**NOT YET RATIFIED.** Built 2026-08-23 in session-v59 phase 4, closing roadmap item 59. The fix
shape was ratified at filing time; what needs a call is that two BYTE-FROZEN command contracts and
one seam's documented output shape move with it.

**Read the amendment first.** The entry as originally filed shipped a REGRESSION: on the crate
layout Rust actually uses, the rung it describes selected ZERO tests. Corrected below, in "What the
first cut got wrong".

**What changed.** `generatedTestNames` returns FILTERS, not bare names. Rust's carry the full
libtest path (`geometry::widget_checks::add`); C#'s carry namespace and class
(`Falsifier.Widgets.WidgetChecks.Add`, `Ns.Outer+Inner.Add` when the class is nested).
`buildTestCommand` then emits `--exact` past the `--` separator, and `buildCsCommand` switches
`FullyQualifiedName~` to `FullyQualifiedName=`.

**What the first cut got wrong, and the correction.** The first cut resolved Rust's path from the
marked region's own position in the file's TEXT, and that is not the whole path. A libtest path also
starts with the segment the FILE contributes by being a module, and no amount of reading the file
shows it. Rust puts a function's tests in the function's own file, so every crate whose code is not
in `src/lib.rs` - the normal layout - got a full-SHAPED path missing its head, `--exact` rode along,
and the rung selected nothing. Driven, cargo 1.96, `src/lib.rs` holding `pub mod geometry;` and the
tests in `src/geometry.rs`: `-- add` ran 2 of 2, `--exact widget_checks::add` ran 0 of 2, `--exact
geometry::widget_checks::add` ran 1. **Before this entry the rung over-selected; after its first cut
it selected nothing, which the entry itself calls strictly worse.**

Two more names dropped the same way and produced the same zero. A raw-identifier module (`mod
r#match`) was not matched by the head regex at all, so its brace was counted and no segment pushed;
cargo KEEPS the `r#` (`r#match::widget_checks::add: test`). And `namespace @namespace` was dropped
on the C# side, where the class alone still satisfied the fully-qualified shape check, so `=` fired
at a name no assembly holds: on dotnet 10.0.111 `=namespace.VerbChecks.Add` selects one test and
`=VerbChecks.Add` matches none.

**The rule the first cut was missing.** A qualification check must prove a name is COMPLETE, not
that it is dotted or colon-separated. `generatedTestNames` now takes the placement and walks `mod`
declarations from the `--lib` target's root file, and prefixes a name only when that walk reaches
the file. `foo.rs`, `foo/mod.rs`, `#[path]`, nesting and raw identifiers all resolve; a file the
walk never reaches, a crate with no lib target, a file two declarations both route to, and a call
with no placement at all answer BARE, which keeps the substring filter. The shape check in
`buildTestCommand` is a floor under a hand-built name, not the gate.

The seam's `generatedTestNames` gains an optional third parameter carrying the placement. C#, Go,
TypeScript and Python ignore it: each reads its whole qualified name out of the file.

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

**Why that falsifier missed the regression, which is the durable lesson.** Every Rust fixture in
that file wrote `src/lib.rs`, and the row titled "an enclosing `mod` is part of the libtest path"
asserted a shape over an INLINE `pub mod geometry { … }`. The graded row never left the crate root,
so the one segment the build got wrong was the one segment no fixture had. A graded row now drives
six layouts in ONE crate - `src/geometry.rs`, `src/geometry/deep.rs`, `src/shapes/mod.rs`, a
`#[path]` module, a raw-identifier file module and a raw-identifier inline module - with twelve live
tests, so a wrong path selects zero and a substring filter selects twelve. Only the resolved path
selects one. A second graded row drives `namespace @namespace` against real dotnet.

## S27. A cancelled tighten round is not a failed one, and it ends the gesture

**NOT YET RATIFIED.** Built 2026-08-23 in session-v59 phase 3, which closes S58-11. Flagged here
because it narrows a clause of S25 one week after S25 was written, and because it stops a gesture
that used to carry on.

**What changed.** `runProposer` (`src/vscode/tightenDocComment.ts`) claims the round in the
in-flight registry, so the `AbortController` it has always built now has a caller: the status-bar
item and `column80.cancelGeneration`. The claim is released in a `finally`. Its catch asks
`isCancellation(err)` first, and a cancelled round returns a cancelled flag rather than a failure -
the channel says the round was cancelled, no warning is composed, and the command returns
`{ status: "cancelled" }` without offering a diff.

**Why the old behaviour was wrong.** Nothing ever called `abort()`. The controller was constructed,
passed to the transport, and wired to no caller, so a tighten round against a hung server was
invisible and unstoppable - the exact shape of the `goShapeHooks` defect. Worse after phase 1: the
catch treated every throw as a proposer failure, so cancelling produced "Column 80: the model could
not be reached, so no type names were offered." for work the user stopped themselves.

**The narrowing of S25.** S25 says the tighten warning's second clause, `The re-wrap needs no
model.`, rides on both branches of a proposer failure. It still does - for failures. A CANCELLATION
now reaches no warning at all, so there is a third branch S25 did not have.

**And the gesture stops.** This is the part a human should look at. A proposer failure still warns
and carries on, because the re-wrap is real work the model was never needed for. A cancellation
does not: the gesture ends where the user stopped it, writes nothing, and never opens the diff. The
alternative - finish the re-wrap and show the preview anyway - answers a user who pressed Cancel
with a dialog, and the cancelled outcome this gesture already has for a dismissed review says the
same thing about the same intent.

**One consequence, stated rather than hidden.** The registry is shared, so `Cancel Generation` now
stops a tighten round along with everything else in flight. That is the affordance working as
designed, and it is not the open question S58-10 asks (whether a download belongs under the same
command); no download is involved here.

**Pinned by.** `test/impl-v59-p3-tighten-cancel.test.cjs`. Its heavy rows drive the product's own
`activate`, the registered tighten command and the registered cancel command over a transport that
answers only when its signal aborts, so a settled round is proof the abort travelled. Rows 1, 3, 4
and 6 were red at the branch point; row 6 recorded the false sentence verbatim. Rows 7 and 8 are
the controls: a real failure still warns exactly once, and a server whose message merely says
"aborted" is still a failure.

## S28. "TypeScript and Python already refuse the wrong tree" was never true

**NOT YET RATIFIED.** Built 2026-08-23 in session-v59 phase 9, which closes roadmap item 21.

**What changed.** Two legs landed. TypeScript and Python got the by-name workspace-symbol leg C#
and Go already had (`resolveTypeCursorByName` on `TsCommandExtractor`, `PyCommandExtractor`, and
their headless siblings `TsLsExtractor` / `PyLspExtractor`, wired through `extractorFor`). C# got
the wrong-tree refusal: `membersOfType` now asks `resolutionReachedWrongTree` before descending,
and answers nothing when the resolution reached some other declaration's tree.

**The refuted claim.** Roadmap item 21, session-v59's goal and the blind file's own comment all
said C# was the only language that renders the enclosing helper class, because "TS and Python
already refuse it". They do not refuse it and never did. Their row passed by accident of the
fixture: `findTypeAnchorInText` finds `Tile` on the `import { Tile } from "./tile"` line, which is
OUTSIDE the helper class, so no container enclosed the cursor and the descent degraded for a reason
that has nothing to do with a refusal. C# has no import line naming `Tile`, so its anchor landed at
`Tile tile = ...` inside a method body and the trap fired. Measured: the anchors are TS `line 1`,
Python `line 1`, C# `line 7`.

**The gap this leaves open, stated rather than hidden.** TypeScript and Python still have no
wrong-tree refusal. A type referenced without an import line - a same-file type, a global, an
ambient one - puts the anchor in a method body, and both transports then hand back the enclosing
class exactly as C# did. This is not hypothetical: `blind-v15-argtype-identity`'s own fixture row
"the SITE file's symbol tree and Tile's symbol tree share no member name" drives
`TsCommandExtractor.membersOfType` at a cursor inside a method body and gets all five helpers back,
green, today. It is green because that row asks the OTHER question - "what type am I writing
inside" - which is legitimate and must keep its answer.

That is why the refusal is C#-only and why it is not a one-line predicate. It needs three facts
together: the cursor sits on an identifier, that identifier is not the enclosing container's name,
and that identifier is not a C# syntax word. Drop the first and a member site (`stripe.|`) is
refused. Drop the second and a constructor's own name token is refused. Drop the third and a
definition answer landing on the `public` of `public class Tile` is refused. Extending it to two
more languages is a ruling for a human, not a free extension, because the question it must not
break has no oracle in those languages.

**The third fact was wrong when this entry was first written, and it is corrected here rather than
ratified as it stood.** It read "the cursor is inside one of that container's MEMBERS", on the
ground that a declaration head sits outside every member and is therefore a legitimate landing
place. A batched adversarial review found the hole and a live Roslyn 2.140.9 confirmed the shape:
**a type referenced in a declaration HEAD was never refused**. `public class Helper : Plain`
rendered `Use` under `to build a Plain:`; `public class Seeded(Plain seed)` rendered `Seed` and
`Twice`; a `where T : Plain` constraint rendered `Item`; an attribute rendered the attributed
class's members, on its own line and inline both. Roslyn emits NO constructor child for a primary
constructor at all, and an attributed class's `range` starts at the attribute, so the old third
fact could not fire on any of the five. It is reachable because `findTypeAnchorInText` takes the
first non-`//` occurrence of a bare name, and a primary-constructor parameter is very often that
first occurrence.

The replacement asks a different question: a correct resolution lands on the named type's own NAME
TOKEN, and everything else inside a container belongs to some other declaration. The container's
name is compared at its identifier head, because Roslyn reports a generic class as `Box<T>` while
the cursor's word is `Box` - that comparison is now what keeps a generic class and a positional
record answering, where the old third fact was what kept them. The syntax-word list is what keeps a
server that answers a whole-declaration span honest.

**What is NOT proven, and it is the same premise the original build rests on.** The triggering
server state was not reproduced on either run. Asked at all five head positions, this box's Roslyn
answered `definition()` CORRECTLY every time - it pointed at `Plain`'s own name token. What is
measured live is the shape: given a cursor at a head reference, the descent hands back the wrong
class's members, and before this correction the refusal watched it happen.

**The selection is stricter than C#'s, on purpose.** `selectSoleTypeCursor` refuses two distinct
declaration sites for one name outright. `selectCsTypeCursor` cannot, because a C# `partial class`
is one type split across files, and Go compares real import paths; TypeScript and Python have
neither, so two sites are two things and guessing is the worse failure. Identical positions are
collapsed first, which is the one duplicate worth having (pyright reports a stub beside its
implementation).

**Pinned by.** `test/blind-v15-argtype-identity.test.cjs` (both `gtodo` sites re-cut, `todo` false
in every language, bodies carrying the original demand with the per-language branch deleted) and
`test/impl-v59-p9-byname-leg.test.cjs`. All three `KNOWN WRONG:` rows were red at the moment the
leg landed and before they were re-cut; that red is recorded in the phase report. Each of the six
guards above was mutated and killed exactly the row that names it.

The declaration-head correction is pinned by `test/adversarial-v59-p9-declhead.test.cjs`, over a
symbol tree CAPTURED from the live Roslyn rather than hand-built - Roslyn's missing constructor
child and its attribute-inclusive range are the two facts a hand-built fixture would have got
wrong, and both are load-bearing. Six rows red before the change and green after; eight rows green
on both sides, which is the half that matters, since a false refusal costs every correct surface
where the gap costs one. Two mutants: deleting the syntax-word list reddens four of those eight,
and comparing the container name whole instead of at its identifier head reddens the generic-class
rows.

The navto cursor fix has a row of its own at last, `test/adversarial-v59-p9-navto.test.cjs`, driven
against a real in-process TypeScript language service over a real tsconfig - a fake cannot produce
the defect, because navto's span shape IS the defect. Restoring `hit.textSpan.start` reddens the
three name-token rows and leaves the members row green, which is the commit's own observation
standing as an executable fact: `membersOfType` walks up the AST and survives a keyword cursor,
`hoverSurface` does not.

**Graded live, and the live run found a defect the fakes could not.** Both new legs were driven
against real servers: a real TypeScript language service in process, and a real
`pyright-langserver`. TypeScript resolved `Tile`, resolved an `interface`, and refused a same-named
`function`. Pyright resolved `Tile` to the name token and refused the four fuzzy non-type hits it
returned alongside it.

The defect: `getNavigateToItems` does NOT answer the name token the way every workspace/symbol
server does. Its `textSpan` is the whole declaration, so `export class Tile` resolved character 0 -
the `export` keyword. `membersOfType` survived it by walking up the AST, which is why no fake
caught it, and `hoverSurface` would not have. The cursor is now taken from the declaration NODE's
name. This is the `symbol-providers-do-not-qualify` hazard in a second place: navto is not
workspace/symbol, and assuming one shape for both was wrong.

One rig fact, not a product one: pyright answers `workspace/symbol` with `[]` until some project
file has been opened. In the editor the user's buffer is always open; in a headless measurement it
reads as a dark leg. Recorded on the method.

## S29. The anthropic round line stops taking "the first line" and takes the whole message, escaped

**NOT YET RATIFIED.** Built 2026-08-23 in session-v59 phase 2, which closes S58-1, S58-2, S58-3,
S58-6 and S58-9. Flagged here because it changes a SHIPPED channel format, not because anything
narrowed.

**What changed.** `src/core/anthropicInstruct.ts`'s local `firstLine` is gone. The per-round
failure line used to render `reason=${firstLine(err)}`, which split on `"\n"` alone and kept the
head. It now renders `reason=${channelReason(err)}`, which escapes the five-character break set
first and caps at 200 second. A single-line reason is byte-identical. A multi-line one used to lose
everything past the first LF and now keeps as much as the cap allows, with the breaks visible.

**Why the cut had to go rather than be widened.** Widening the split to the render break set would
also have closed the forgery, and it was the smaller edit. It was refused because the cut was never
buying anything: the 200-char cap is what keeps the row short, and the cut only decided WHICH 200
characters - the first line's, whether or not the rest said more. A channel line is a diagnostic,
and discarding the tail of a reason on a surface whose whole job is to hold the provider's words is
the failure roadmap item 69 exists to stop.

**The order is load bearing and is S21's, one file over.** Escape first, cap second. A cap applied
before the escape bounds the wrong string, and U+2028 costs six characters per escape, so the
rendered row can exceed the cap several times over. That was measured in session-v58 phase 1 and it
governs here for the same reason.

**What else moved with it, in one sentence each.** `escapeBreaks` is exported from
`src/core/errorBound.ts` and now runs at `[fngen] request failed`, both `[fim] request failed`
sites, `[fim] no ghost:` and `[carve] pull failed`, so S21's rule holds on every channel surface
that interpolates server text rather than on `channelBodyLine` alone. `FimGenerateParams` gained the
`log` sink the instruct path always had, so an ollama 500 during FIM leaves a raw-body line instead
of nothing. `StreamEvent.error` and `PullEvent.error` widened from `string` to `unknown` and both
in-200 readers coerce with `providerReason`. `cutStreamLine` is new: both instruct arms log the
partial reply before the cut-stream throw.

**The site nobody had named, and it is the transferable part.** The work listed two
`[fim] request failed` sites. Driven through a real socket, an ollama 500 reaches NEITHER of the
pair: the per-run catch logs and aborts its own controller, so the outer catch reads the signal as
aborted and falls through to `noGhost`, which interpolated the same thrown message under a third
head. That is where the forged row came out. Reading the two named lines would have shipped with
the hole open. The escape now lives inside `noGhost` rather than at that one caller, because
`noGhost` is the choke point its "one shape" comment names.

**The residual, which is a DECISION FOR THE HUMAN and was deliberately not taken.** The elision
marker is still forgeable in the other direction: a body ending in the literal text
` [+123 chars elided]` produces a line indistinguishable from one the product truncated. S58-2 asks
whether product channel rows get an unforgeable frame (a nonce in the marker) or whether the
forgeability is accepted and written down as accepted. A begin/end frame is not an answer, because
the server can emit the end marker too. Nothing here decides it.

**Pinned by.** `test/impl-v59-p2-channel-escape.test.cjs` (18 rows: three surfaces by six breaks,
each asserting `log()` calls equal rendered rows, plus one row pinning a product-authored reject
line as untouched), `test/impl-v59-p2-stream-evidence.test.cjs` (13 rows), the un-skipped D4 row in
`test/adversarial-v58-p2.test.cjs`, the un-skipped `[ollama-fim]` row in
`test/adversarial-v58-p1.test.cjs`, and `test/adversarial-v58-p7.test.cjs`'s X1, re-cut from a
finding into a guard that drives the branch-point worktree beside the working tree so the old
behaviour is asserted as a precondition of the new one.

**The accepted cost, recorded rather than discovered later.** Wiring the FIM sink puts the
per-keystroke path on the raw-body line, so a server failing every keystroke can write up to
`CHANNEL_BODY_CHARS` per failure instead of the 400-char bounded copy, and a manual call writes one
such line per alternate run. That is the same trade item 69 already ruled for the instruct arms:
the channel is the only diagnostic a no-telemetry product has, and a FIM path failing every
keystroke is a broken server the user needs to see.

## S30. A Rust keyword or postfix item is dropped from the RENDER, not from the answer

**NOT YET RATIFIED.** Built 2026-08-23 in session-v59 phase 8, closing roadmap item 7. The ruling
this implements was ratified 2026-08-16; what needs a call is that a transport contract row, frozen
since v27, moves with it.

**What changed.** `RaCommandExtractor.completeMembers` and `RaLspExtractor.mapCompletion` used to
`continue` past every Keyword and Snippet item. They now map those labels to a member of the new
`MemberKind` `"keyword"` and append them behind the semantic surface, and `semanticMembers` drops
that kind alongside `"text"`. The prompt, the render, the tier stamp and every member count are
byte-identical either way. What changed is that the answer still HOLDS the labels the server
served, so the output gate can read a complete legal list from it: `memberSiteLegalNames`
(`fimInject.ts`) builds it, and Rust joins TS, C#, Python and Go in the gate.

**Why the old behaviour was wrong.** It made the gate's legal list and the prompt's rendered list
the same list, and rust-analyzer's rendered list is incomplete BY CONSTRUCTION: it serves keyword
and postfix completions at a `.` site by design. Gating Rust on it ate `.await`, so Rust was carved
out and spent five sessions as the one language with injection and no enforcement. The model wrote
`s.add_tile_by_morton(...)` with a clean member list in front of it and nothing checked.

**Measured live, on a real rust-analyzer, not reasoned.** A plain struct receiver answers with 25
items: 6 members and 19 postfix SNIPPETS (`ref`, `dbg`, `match`, ...), no `await` at all. A Future
receiver answers with 28: every member relabelled `await.<member>` and demoted to the 8-family,
plus `await` as a lone KEYWORD item - the one item the old drop removed, which is exactly how a
gated Rust used to eat `.await`. Both captures are the fixtures in
`test/impl-v59-p8-rust-gate.test.cjs`, labels, kinds, details and sortText verbatim.

**The arming rule did not move.** A keyword/postfix-only answer arms nothing: the legal-only tail
rides ONLY behind a non-empty semantic surface, on both transports. Without that a receiver the
server bound nothing on would gate against 20 postfix names and reject every real member, and the
dark-site reason line would name the wrong cause.

**The contract row that moves.** `review-v27-tier.test.cjs`'s "keyword and snippet items carrying
sortText are dropped by KIND, never tiered in" asserted the DROP by asserting the returned name
list. Its actual demand - a 7fffffff keyword must never sit in the own tier of an empty-partial
block - is unchanged and now asserted directly: the keyword members carry no tier and no signature,
and never reach the rendered surface. `blind6-command-adapter.test.cjs`'s keyword-only row is
untouched and still green, because a keyword-only answer still returns no members.

**What this does NOT claim.** The gate reads the leading identifier and every later
`receiver.NAME`, so a ghost that awaits first and invents second (`await.add_tile_by_morton(...)`)
is judged on `await` alone and survives. That is the gate's shape in all five languages, it is not
something the legal list widened, and it is pinned as a KNOWN REACH LIMIT row rather than left
implicit.

**Pinned by.** `test/impl-v59-p8-rust-gate.test.cjs`, 15 rows through the real provider, the real
service and the real transport mapping. Both directions were red before the fix and neither was red
at the same time: with Rust ungated the invented-name rows fail; with Rust naively gated and one
list, `.await` and postfix `match` fail. The phase report carries both failure texts.

## S31. A failure's cause travels between surfaces; its consequence does not

**NOT YET RATIFIED.** Built 2026-08-23 in session-v59, repairing phase 1. It narrows S25, which is
this session's own contract, and it re-cuts a row in the phase 1 blind oracle that the narrowing
makes impossible to satisfy.

**What the old contract said.** S25's central claim was an agreement claim: for a given
`HttpStatusError`, the crafted sentence appears in the toast text of all three surfaces. One throw
class, one sentence, everywhere.

**Why that is wrong.** Every status sentence has the shape
`Column 80: <CAUSE>, so nothing was written - <REMEDY>. The full message is in the output channel.`
The cause is what the server did, so it is true wherever the throw lands. The rest is about the
gesture, and on two of the three surfaces the generation gesture's words are false:

- **The tighten gesture writes.** It does not stop at its warn; it proceeds through the delta and
  existence gates and applies the re-wrap. So a 401, 403, 429 or 5xx produced, in ONE notification,
  `...so nothing was written - wait, then run the gesture again. The full message is in the output
  channel. The re-wrap needs no model.` The protected second clause makes the contradiction
  explicit. The sentence S25 replaced did not have this problem: "so no type names were offered"
  scoped the claim to the half that actually failed.
- **The download has no gesture.** The user clicked Download in a notification, and "run the gesture
  again" names a control that is not there. That is the same defect as a crafted remedy pointing at
  a setting the product does not contribute, one class up.

**The split.** `SurfaceVoice` carries a `consequence` clause and a `retry`, and
`httpStatusSentence` interpolates them:

- `GENERATION_VOICE` - "so nothing was written" / "run the gesture again". The DEFAULT, so every
  caller that names no surface draws the sentence it drew before, byte for byte.
- `TIGHTEN_VOICE` - "so no type names were offered" / "run the gesture again". The clause the
  surface's own unclassified sentence has always used, kept rather than invented.
- `DOWNLOAD_VOICE` - "so the model was not downloaded" / `run "Column 80: Select Hardware Tier" to
  try again`. That command is what the product's own "fn-gen is disabled" message names, and it is
  the only way back to the one-click download.

Two branches take no `retry` at all: the local 401/403 ends at "check the server's own
authentication", and the 5xx at "try again shortly", which is already surface-independent. A voice
supplies words where the sentence needs them, not everywhere it could. The vocabulary did not
otherwise move: the 401/403 split on transport survives with its reasoning intact, and this is a
factoring rather than a rewrite.

**What is kept, and it is the half worth keeping.** One throw class produces one DIAGNOSIS on every
surface. Only the consequence varies. The generation gestures regress on nothing, and the split does
not reach the structural `ClaudeCodeError` sentences or the marker table, which are one wording per
throw and stay that way.

**RESIDUE, stated rather than hidden.** The Claude Code reasons carry the same
`so nothing was written` clause and the tighten gesture can reach them - its transport is the same
tier-resolved one fn-gen uses. They are out of this ruling's scope because the ruling named
`httpStatusSentence`, and threading a voice through seven closures of three different shapes is a
second build. On that surface those sentences still say something false.

**The blind oracle row this makes impossible.** `C1 [401|403|429|503]` in
`test/blind-v59-p1-one-sentence-everywhere.test.cjs` asserts that the string
`translateServiceReject` returns is a SUBSTRING of the download and tighten toasts. No split can
satisfy that: the returned string is the generation sentence, and the whole point is that its
consequence clause must not appear on the other two. The four rows are RED and were left red rather
than edited. Their failure text is itself the evidence - it prints all three sentences side by side,
same diagnosis, three consequences. The oracle's other 13 rows are green, including C2 (the re-wrap
clause), C3 (one line), C4 (no borrowed class sentence) and C6 (the leaf module). Ratifying this
entry is what authorises re-cutting C1 onto the diagnosis.

**Pinned by.** `test/impl-v59-p1fix-surface-consequence.test.cjs`. Row F1 types the eight generation
sentences out literally, so the byte-identity constraint cannot drift; D2a to D2d drive the real
tighten and download surfaces at all four classes and assert the diagnosis reaches both while the
generation consequence reaches neither; D3a drives the typed-but-unclassified leak. Rows 2, 6 and 8
of `test/impl-v59-p1-one-sentence-surfaces.test.cjs` and `C7 [pull toast]` in
`test/blind-v58-p7-http-status-classes.test.cjs` were re-cut onto the same claim; row 8 also asserts
the consequences really differ, because the diagnosis is a prefix of the generation sentence and
three identical sentences would otherwise satisfy it.

## S32. The accept/reject accounting line cuts on the render break set, and a progress phrase cannot crash a download

**NOT YET RATIFIED.** Built 2026-08-23 in session-v59, the phase 2 fix round, against three findings
from that phase's adversarial review. Flagged here because it changes a SHIPPED channel format and
withdraws a written invariant, not because anything narrowed.

**What changed, one sentence each.** `firstOfferedLine` in `src/core/fnGenService.ts` cuts with the
new shared `firstChannelRow` instead of `split("\n")`, so `[fngen] outcome=reject ... offered=` is
one channel row whatever the model wrote. The model download's progress phrase takes the new
`displayText` instead of `String()`, which cannot throw and renders a structure as JSON rather than
`[object Object]`; `PullEvent.status` widened from `string` to `unknown` to force it.
`providerReason`'s docblock no longer claims its JSON fallback is always one line.

**The eighth site, and why counting them missed it.** Phase 2 escaped every channel line that
interpolates SERVER text and counted three local first-line cutters. This is the fourth, and its
payload is not the server's text but the MODEL'S OWN generated body, arriving through the vscode
layer rather than off a socket. Driven through a real socket, a 200 whose `response` carries
`fn add(a: i32, b: i32) -> i32 {<U+2028>[fngen] outcome=accept<U+2028>    a + b<U+2028>}` renders
four channel rows from one `log()` call, the second of them the model's. That is the accept/reject
ACCOUNTING line: a model that can write `[fngen] outcome=accept` inflates the accept count in every
capture and every rig run. Four of the six breaks get through - bare CR, U+2028, U+2029, NEL. LF is
cut by the old split, and the postprocess normalises CRLF to LF before the line ever sees it.

**A CUT, not the escape S29 ruled for one file over, and the difference is the payload.** S29
refused to widen `anthropicInstruct.ts`'s cut and escaped the whole reason instead, because there
the tail carries the provider's words and throwing it away cost real evidence. Here the payload is a
function body whose first line IS the diagnostic - the signature a reader compares against the one
that was asked for - and the rest is indented code that would spend the 160-char cap rendering `\n`
markers. `firstChannelRow` is exported from `src/core/errorBound.ts` so the break set has one home;
a surface that wants the whole value still takes `escapeBreaks`.

**The progress phrase was a genuine throw, not a rendering complaint.** `String()` on a `JSON.parse`
product raises when `toString` is not callable. Driven mid-pull through a real socket,
`{"status":{"toString":1}}` raised `TypeError: Cannot convert object to primitive value` out of the
line handler, through the read loop and the transport, into the download's catch - carrying no
marker the translation table could classify, which is verbatim the outcome phase 2's `evt.error` fix
closed four lines above. Phase 2 left it deliberately, reasoning that `providerReason`'s
message/type chain has nothing to read on a progress string. That reasoning was about WHICH
coercion, not about whether. `displayText` is the answer for a value that is not an error: no
message/type chain, and absent renders as the empty string the call site already meant by `?? ""`.
The real ollama registry sends strings; a proxy or a custom `apiBase` is the exposure.

**The withdrawn invariant.** `providerReason`'s docblock said the JSON fallback "is always one line"
because `JSON.stringify` escapes line breaks. It escapes LF and CR and leaves U+2028, U+2029 and NEL
alone, and the scalar path hands a server's string back with every break in it. No row is forged
today because every consumer escapes or cuts on the full five-break set - the SENTENCE was wrong, and
it is the sentence a future caller would relax on. It now says what is true and names the sink rule.

**The guard that could not fail, which is the transferable part.**
`test/review-v27-tier.test.cjs` already asserted this line carries no `\n` and no `\r`. Its only
break-bearing input was `"\r\n  first\r\nsecond"`, where every CR sits beside an LF, so the cutter's
`split("\n")` consumed both halves and a bare interior CR was never tested. The row is re-cut as a
five-row table, every break interior and alone, and it fails on the shipped cutter for four of the
five: driven, `"[fngen] outcome=reject refused-by=human-gesture offered=first\rsecond"`. A guard
whose input cannot produce the case is a fact about the guard.

**Pinned by.** `test/impl-v59-p2fix-outcome-row.test.cjs` (14 rows: six breaks driven end to end
through a real ndjson 200 and the real postprocess, four pull STATUS shapes driven mid-pull through a
real socket, the absent-status row, and two rows stating what `providerReason` really does with
breaks), the re-cut five-row table plus the cap row in `test/review-v27-tier.test.cjs`, and the
structural pin in `test/impl-v57-p2-in-stream-bound.test.cjs`, which now requires ZERO
`boundBody(String(` in `ollama.ts` instead of exactly one.
