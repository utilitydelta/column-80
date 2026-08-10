# Roadmap

Everything pending, one file. A session picks a slice, scouts it, builds it, and the slice comes
out of here when it ships. Shipped work lives in ARCHITECTURE.md and git history.

**Item numbers never move.** Items cross-reference each other by number, so a gap means that item
shipped; the gap list is at the bottom under History. The TIERS below are the priority order and
they do move, every time the evidence does.

**PROVEN** means tested. **REASONED** means read but not run. Take the tier order as current and
the individual diagnoses as needing a re-read before you build against them: item 42's first
version was confidently wrong for two months, and nothing flagged it until a session went looking.

## The list, at a glance

**1. Fix now**
Proven broken, no design question left. Each is small and each is about the product or its gate telling the truth.

- **43.** added context silently removes injection, because nothing checks the prompt against the window
- **22.** shipped source cites folders a clone does not have; this bit CI four ways on 2026-08-10
- **23.** a few rows measure wall clock and CI is not their hardware
- **2.** a frozen live test is red and nobody runs it
- **26.** a classified diagnostic that resolves nothing gets no harvest
- **21.** the cross-file argument-type leg, unbuilt since v14

**2. Trust the instruments, before building on them**
Two independent rig defects turned up in one session, and each had been silently wrong for months. Until this tier is settled, a number from the harness is a hypothesis.

- **33.** the spike harness spliced on stale offsets; every number it produced is suspect
- **41.** the tuning constants were chosen for a local 30B and now gate a frontier model
- **42.** repair supply outside Rust, restated after the rig defect that produced the first version
- **30.** item 1 needs a third arm before anyone knows what it did
- **45.** the latency probe cannot make a cold row, so three of its five falsification numbers are about the probe
- **46.** two frozen v21 rows model a cold answer no server gives, and a bound that killed their case passed them

**3. The big builds**
Each needs its own goal and scout. Ordered by measured value, not by age.

- **36.** resolution is the hole, not the budget: 69 real failures per run against the budget's 22
- **34.** C# and Go have a supply problem, not a cap problem
- **28.** three of five languages cannot anchor an imported type at all
- **27.** v34's items 1 and 2 exist for Rust only; four languages have the same hole
- **35.** the payload elision, in the three languages v37 did not build
- **37.** the worked-example leg quotes the wrong docs on 80% of its blocks

**4. Ideas and unscouted**
Worth doing, not yet worth a goal file. Scout before scoping.

- **17.** ask the model which types it needs, then inject their surfaces
- **39.** other agent CLIs as fn-gen backends: codex, opencode, and whatever comes next
- **11.** include block, the recursive variant
- **5.** the whole-block trigger cannot see how real code names its types
- **6.** the `selected:` prompt line was never measured
- **10.** the second call in a chain generates blind

**5. The long tail**
Real, filed, and not urgent. Priority within the tier is unchanged.

- **4.** fn-gen quits repair early while the errors are still shrinking
- **7.** Rust has injection and zero enforcement, the last such language
- **8.** injection works on an idle box and vanishes on a busy one
- **9.** nobody knows the injection landing rate on any machine
- **13.** nobody knows what the ratified tests miss
- **14.** a failing test does not drive repair
- **16.** an invented member on line 2 of a ghost is never judged
- **18.** the rest, unchanged in priority

Then, below the items: decisions only the human can make, deferred one-line fixes, the dogfood
ledgers, and the history this file used to open with.

## 1. Fix now

Proven broken, no design question left. Each is small and each is about the product or its gate telling the truth.

### 43. Nothing checks the prompt against the context window, so added context silently removes injection

Found 2026-08-10 while answering a question about the output ceiling. PROVEN by reading; the
overflow itself is not yet measured on a real session.

**Status 2026-08-10, session-v48 phases 2+3 and their review loop-back.** The guard now exists and
the sentence below - "there is no prompt-versus-window guard anywhere in the product, on any path"
- is no longer true. `src/core/promptBudget.ts` holds the decision, `FnGenService.generate`
arbitrates (exempt / fits / shrink / refuse), and `generateRaw` / `generateTests` refuse a
finished prompt that does not fit, which is what closed the last three paths: the punt circle-back
retry, repair, refine and test-gen were all still unguarded after the first build. What is STILL
open is the measurement this item asked for at the bottom: **how often a real session actually
overflows**, on which nothing has run. The build below was also overtaken - it says "not a
refusal", and the human's later ruling was that where it does not fit at all the product refuses
and says why (`session-v48/contract-phase2.md`).

`GEN_NUM_CTX = 16384` bounds the prompt AND the generation together, and `ollama.ts` already
documents what happens past it: the prompt is silently truncated to fit. That comment was written
about ollama's own 2048 default and the measurement behind it is real (three prompts of 12.9KB,
13.1KB and 15.0KB all landing on exactly 2050 prompt tokens, nothing logged). Raising `num_ctx`
to 16384 moved the ceiling. It did not add a check. **There is no prompt-versus-window guard
anywhere in the product**, on any path.

**Why this is not simply the developer's problem, which is the obvious reading and the wrong one.**

1. **They cannot see the budget.** No indicator, anywhere, of how full the window is. Nothing to
   make the call with.
2. **The product contributes to the total without telling them.** Prefill surfaces, member lists
   and repair surfaces add bytes the developer never wrote. Context blocks are deliberately
   BUDGET-EXEMPT by design, so the product actively does not count the thing most likely to
   overflow. A developer adding two blocks can be tipped over by bytes that are not theirs.
3. **The failure is inverted, and this is the whole item.** Truncation eats the HEAD of the
   prompt. On a captured fn-gen prompt the head is the instruction and the injected type
   surfaces; the doc and signature sit at the tail. So adding context makes the model receive
   LESS injection, and it still answers, from the bare signature, confidently. The developer's
   action produces the opposite of what they asked for and nothing says so.

That is the product quietly discarding its own core value.

**The build, and it is deliberately small.** Not a refusal and not an auto-trim: estimate the
prompt, compare against the window minus the output ceiling, and say so on the channel when it
does not fit, naming what will be dropped. Same register as the `[fngen] pre-fill injected
types=N` lines already there. The decision stays the developer's; only the silence goes.

**This is not the confidence signal that was rejected.** That one guessed at output quality, and
a product that second-guesses its own answers is not what this is. This reports a measured fact
about what was actually sent, which is the same category as every other line on that channel.

Wants, before or alongside the build: how often a real session actually overflows. If the answer
is never, the channel line is still right and the item is cheap; if it is common, the budget
itself needs revisiting and `GEN_NUM_CTX` is measured at 12.4GB VRAM on the 16GB carve, so
raising it is not free.

### 22. Shipped source points at folders a clone does not have

Shipped files carry comments citing gitignored `session-*/` paths, so the reasoning they point at
is unreachable from a fresh clone. Sweep `extraction.ts`, `fimWholeBlock.ts`, `crossFileShape.ts`,
`goExtraction.ts`, `completionService.ts` and `fnGen.ts`. Split out of the old item 1, which was
closed 2026-07-28. REASONED.

### 23. A handful of rows measure wall clock, and CI is not their hardware

Three rows failed on a GitHub runner and pass locally. None is a product defect; each measures
something the dev box happens to satisfy. PROVEN 2026-07-28 across four CI runs.

```
impl-service.test.cjs:365      avg miss-path 2.44ms/call must be bounded (< 2ms)
blind-v21-p1-commands.test.cjs:546  the real 1500ms passive-scope window
blind-v21-p3a-darkreason.test.cjs:523  a log line that grows `gateWait=` under load
```

Two of the three are FIXED. One is excluded on CI and is the item that remains.

- **Fixed, the perf row.** It now times the same 50 misses against a small document and against the
  2MB one and compares. The claim was always "cost does not scale with document size", and the
  regression it catches is ~100x (13ms/call against well under 1ms), so a 10x ratio catches the
  class on any hardware. An absolute millisecond threshold was a statement about the box.
- **Fixed, the dark-reason row.** `norm` now drops the `gateWait=Nms` segment. The product emits it
  only when the gate actually waited, so the same event produced two different lines by load, and
  this file compares line sets ACROSS runs (profile() caches one healthy run, row D takes another).
  A healthy line from a loaded run matched a dark line from a quiet one.
- **Excluded on CI, the expiry row.** `test/blind-v21-p1-commands.test.cjs`, the only skip of its
  kind in the suite. It drives a real 1500ms window and on a shared runner the drive does not land
  a scoped ghost at all: the failing run reported ZERO commands after the serve. Widening 3000ms to
  13500ms was tried and changed nothing, so it is not a budget problem - the gate waits under
  contention, and a ghost the gate refuses records no scope to expire. The row now asserts its
  precondition, so a drive that served nothing reads as that rather than as a timeout. **The fix is
  a fake clock**, and then the skip comes off.
- `release.yml` does NOT run `test:unit` either way; a red there fails with the tag already public
  and immutable. Close this item and the release job can gate on tests again.

### 2. A frozen live test is red and nobody runs it

`blind-v16-argtype-live` pins the claim "with Tile's construction injected, the model builds a
Tile". That claim no longer reproduces. The model serves garbage instead:

```
EnrollTile(new(0, 1))
```

- PROVEN 2026-07-25 on GPU, so not a CPU artifact.
- Also red before v21, so not a v21/v22 prompt regression.
- The file is in no run list, so it rotted invisibly.
- Triage: find when it regressed, or rule the row fragile single-draw evidence.
- Its sibling baseline row already skips itself, which supports the "fragile" reading.
- Either way: fix or re-cut, then put the file where something runs it.

### 26. A classified diagnostic that resolves nothing gets no harvest

Session-v34 item 2 harvests type names out of a diagnostic's own text, but only for diagnostics the
classifier had NO rule for. A diagnostic that classifies and then resolves nothing falls out with no
surface at all. PROVEN in the same capture: `error[E0433]: cannot find \`EcdsaKeyPair\` in \`rcgen\``
classified as `wrong-item` on crate `rcgen`, the member leg resolved nothing for `rcgen`, and the round
went out `[repair] surface EMPTY` - with the name the harvest would have reached for sitting in the
message.

It would not have helped on that row (the type genuinely does not exist, which IS the error), so the
value is unmeasured. The change is a fall-through to the harvest when a classified leg returns nothing,
and it inherits item 2's evidence discipline: the harvested name still has to resolve before a byte is
injected.

### 21. The cross-file argument-type leg, unbuilt since v14

Three rows in `test/blind-v15-argtype-identity.test.cjs` are marked `todo` and carry the whole
demand. Every assertion stands as written; take the todo off when the leg lands, and do not soften
one to take it off sooner. PROVEN red 2026-07-28.

- **C#**: when the server answers a `Tile` reference with the reference's own position, the product
  hands back the ENCLOSING helper class and renders its five members under `to build a Tile:`. That
  is a false statement the model then follows, and it is the worst of the three.
- **TypeScript and Python**: no by-name workspace-symbol leg, so a type the server will not point a
  definition at is unreachable even when it is defined in the same workspace. C# has one.
- The fixture is a deliberate trap and is already written: `Tile` lives in another file, the helper
  class shares no member name with it, so which tree a resolution reached is always decidable.

## 2. Trust the instruments, before building on them

Two independent rig defects turned up in one session, and each had been silently wrong for months. Until this tier is settled, a number from the harness is a hypothesis.

### 33. The spike harness spliced generations as bodies, on stale offsets, and every number it produced is suspect

FIXED 2026-07-31 (session-v36). Recorded here because of what it INVALIDATES, not because there is code
left to write. Sibling of item 29: same family, same lesson, and this one went undetected for longer.

Three defects, all proven, all in the measurement rather than the product:

1. **The wrong splice.** `v34-after.json` `genText` is a whole function (171 of 181 rows open with an `fn`
   header). `spike-leg2-coverage.cjs`, `spike-order-composition.cjs` and `spike-tier4-variants.cjs` called
   `cargo.spliceBody`, which writes between `bodyOpen+1` and `bodyClose` and nests the function inside
   itself. It compiles, and the outer body then returns `()` where its declared type should be, so nearly
   every row gained a spurious `E0308` whose types the harvest read as real. Function arm matched the
   recorded error codes on 10 of 10 rows, body arm on 0 of 10.
2. **Stale offsets.** 160 of 387 entries in `session-complxity-research/data/candidates.json` no longer
   land on their own function. Two rows spliced into the middle of a string literal and the harvest read
   type names out of roughly 348 lexer errors. Both runs exited 0 and printed plausible tables.
3. **The classifier called without its context.** `classifyHallucination(d)` bare. The E0433
   `cannot find X in Y` branch is gated on `resolution` being present, so it returns `undefined` by
   construction and every row of that form scored uncovered. The product always passes the crate
   resolution and the file's local defs.

The fixes, in `session-complxity-research/spikes/lib-cargo.cjs`:

- `assertOffsets` THROWS when a candidate's span no longer lands on its function. It does not skip. A
  guard that skips leaves a smaller corpus that still looks complete.
- `refreshCandidates` re-derives the span against the current sandbox while KEEPING the candidate id.
  Re-running `01-corpus.cjs` is not a drop-in fix: the id embeds `declStart`, so a fresh capture renames
  every row and orphans the recorded generations in `v34-after.json`.
- `spliceBody`'s doc now says what it is for, and the three spikes use `spliceFunction`.

**What this invalidates.** Any number computed from `leg2-coverage.json` or `order-composition.json`
before 2026-07-31, which includes the whole of session-v36 goal item 2 and the "17% zero-coverage"
headline it argued from. Pre-fix copies are kept beside the new ones as `*.PRE-HARNESS-FIX.json`. Numbers
from `spike-tier4-human.cjs` are unaffected: it reads committed source and never splices, and its 6,856 /
5,232 / 122 figures were reproduced exactly after the fix.

The standing rule this earns: a harness that mutates a corpus must verify its own offsets before it
writes, and must say out loud how many it moved.

### 41. The tuning constants were chosen for a local 30B and now gate a frontier model

Audited 2026-08-08 in full (`session-v45/constants-audit.md`, a ledger of every tuning knob on the
injection path with a provenance verdict each). The structural fact behind the whole item:

**Prompt assembly is provider-blind, and the budget profile is chosen by GESTURE, never by MODEL.**
`readFnGenConfig()` takes `maxTokens`, `numCtx` and `temperature` straight off `DEFAULT_FNGEN_CONFIG`
with no setting to override them, and the cloud arm reuses that same object. So every number was chosen
against `qwen3-coder:30b` at `num_ctx=16384` on a 16GB carve, and now gates the claude-code and
anthropic backends unchanged. "The serving knobs nobody can reach" discusses all four as ollama knobs
only.

Three sub-items, ranked by (drift risk x cost if wrong):

**41a. `DATASHAPE_TOTAL_TOK = 300`, measured through the CLOUD backends.** The one constant whose
provenance is admitted folklore - the "~350-token codegen knee" that sizes it "comes from external
literature via the v6 scout, not from this product" (`session-v30/measure-p6-cap.md`) - and whose cost
is now measured. On 465 authored-doc C# rows, 300 -> 900 takes injection 16.4% -> 31.6%, and 330 of the
421 surviving-but-not-injected types die here, more than anchoring (68) and everything else combined.
The mechanism to move it per-language SHIPPED in v45 phase 3 (`CS_BUDGET_FACTOR`, currently 1) with the
value deliberately unchanged, waiting for a generation arm. The arm nobody has run is the cloud one: if
the knee is a property of small local models rather than of codegen, it should not appear there.
`numCtx`'s own comment supplies the motive - real prompts run p90 ~1,295 tokens against a 16K local
window, so nothing is context-bound.

**41b. `maxTokens = 2048` on the two cloud backends.** Sized to fit a quantised 30B beside the FIM
model. On the NATIVE Anthropic path it now caps thinking-plus-answer together on models where thinking
is on by default; the product already knows this failure (a local reasoning model spent the whole budget
on its trace and every generation was rejected as truncated) and already degrades honestly, because a
`length` finish is refused rather than spliced. NOT a defect on the claude-code CLI backend, which
exposes no budget knob and ignores it. The cheap first step is to measure the `length` finish rate on
`fnGenProvider: anthropic` before touching anything.

**41c. `MEMBER_CAP = 24`, with a per-language ladder.** The highest-traffic constant with the weakest
provenance in the ledger: no ladder, no arm, no language, no model, justified only by the same inherited
knee, and deliberately fused across prefill and repair so the two "cannot drift". It is the direct
upstream of 41a, because C# exhausts a token budget rather than a slot count precisely because a Roslyn
member list is enormous. Measuring the budget without it attributes the gain to the wrong knob.

**41d. `DEFAULT_TIMEOUT_MS = 120_000` on the Claude Code transport.** Measured 2026-08-08: 3 of 33
sonnet rows on complex C# methods never answered inside it (`genError="Claude Code did not answer
within 120000ms"`, empty reply), against a qwen maximum of 17.6s on the same sample. Two of the three
are 21- and 23-line bodies that **qwen compiled**. Unlike 41a-41c this is not a local number that
leaked across the seam - it was chosen for this backend, but against v43's evidence, which was a
handful of easy live rounds at 4-8 seconds. Nothing had run a complex C# generation through it. The
failure mode is the expensive one: the round is paid for and then discarded. The fix is not obviously
"raise it" - a 2-minute editor stall is its own defect - so the measurement wanted is the latency
distribution by body complexity, per backend.

**Two findings worth reading beyond the ranking.** `temperature = 0.2` has NO provenance anywhere in
the repo, and the entire measurement corpus was collected at it - so it is a baked-in confound in every
arm ever run here, not merely an untuned knob. And the product contradicts itself: test-gen ships a
500-token aggregate budget while fn-gen holds 300 on the strength of a 350-token threshold. Either
test-gen is over budget by the product's own doctrine or the doctrine is wrong; it cannot be both.

**One thing to resist.** `PREFILL_TYPE_CAP = 4` looks like the obvious target and is not. It is the one
prefill cap with a real arm behind it, and v45 measured that raising it alone RELOCATES the loss
(post-cap loss 65.7% -> 78.2%) rather than removing it. It moves after the budget, not before.

### 42. Repair supply outside Rust, restated after the rig defect that produced the first version

Added 2026-08-09 from session-v46's repair measurement, then **rewritten 2026-08-10** because the
evidence behind the first version measured the RIG, not the product. The original text is not
amended here, it is replaced: quoting it alongside a correction would keep a refuted number in
circulation.

**What the first version said.** C# repair injected no type on 37 of 52 rounds (71%), against 28%
on TypeScript, with `CS0103` accounting for 64 of roughly 100 unmatched observations. The
diagnosis was that `harvestDiagnosticTypes` reads Rust's backtick quoting while Roslyn quotes with
apostrophes, so the fallback that should catch un-classified codes matches nothing outside Rust.

**Why it was wrong.** `session-v46/run-arm.cjs` built the `ResolvedFunction` it hands to
`resolvePrefill` by hand and never set `symbols`. The RECEIVER leg reads that field to find the
type the generated body is being written INSIDE, and puts it FIRST in the candidate list, exempt
from the type cap (`fnGen.ts` ~2073). Absent `symbols` it degrades to nothing, silently. The
shipped product is unaffected: the repair round runs the span surface before the diagnostic-keyed
leg, at all three entry points, over a `resolved` that `resolveFunctionAtCursor` fills in.

A second rig defect compounded it for Rust alone. `stub-vscode.cjs` declared nine of the
twenty-six `SymbolKind` members and `Object` was not one, so `RUST_CONTAINER_KINDS` held
`undefined` and rust-analyzer's `impl Foo` node could never match. Rust was dark twice over.

**Re-measured with both fixed**, model-free replay of each language's own v46 arm, symbol-kind
translation checked per row rather than trusted:

| | rows | rows with any repair surface | rounds with NO surface |
|---|---|---|---|
| C# | 42 | 11 -> 36 of 38 | 31 -> 1 |
| Rust | 63 | 49 -> 63 | 14 -> 0 |
| TypeScript | 21 | 15 -> 21 | 6 -> 0 |

And on a graded C# arm, same 46 rows and same model as v46: repair rounds injecting no type went
from 29 of 42 to **0 of 37**, type injections from 27 to 202, post-repair compile from 10/46 to
19/46, silently-wrong from 1 to 0.

**Go was never affected.** `receiver.ts` defines `receiverType` for Go alone, so Go resolves its
receiver from the signature with no symbol tree. Every Go number in the changelog stands.

**What survives as work.**

- **A static C# method never sees its own class.** `resolveReceiver` resolves a receiver only when
  the signature carries one or the return type names the enclosing type; a static helper has
  neither, so its sibling statics are invisible and the model invents them. Measured at 9 of 56
  repair rounds (`Program`, `Utility`, `FileLoading`, `SyncEvents`), each with a CS0103 naming a
  sibling the class really has. This is the whole of what is left of the item's C# half.
- **The harvest really is Rust-only**, and `harvestDiagnosticTypes`' own comment really is wrong
  where it says the other languages' classifiers already read their own shapes. That is a fact
  about the code, not a measurement, and it survives. Its value is now second-order: CS0246 and
  CS0200 are its real C# population, about 30% of their names resolve, so roughly ten injections.
- **Python and Go remain unmeasured.** Neither has a corpus in the rig, which is a cost, not an
  oversight.

**The lesson, which is worth more than the item.** Every function the rig called was the product's
own. One FIELD of one argument was missing and a silent degrade to `undefined` turned off the
highest-value injection leg in the system. A hand-built product input is a re-derived mapping
wearing a different coat: where a rig constructs one, it needs an assertion that the product
agrees. `run-arm.cjs` now carries that assertion for the symbol-kind translation.

### 30. Item 1 needs a third arm before anyone knows what it did

Session-v34's falsification arm bundles three changes and cannot separate them:

1. Item 1 itself, which REMOVES standard-library surface and shrinks prompts (11.2% fewer injected bytes
   overall, 39.7% on the goal's own 24).
2. The cap fix, which stops a provenance refusal from spending one of the four type slots.
3. The wrapped-import anchor fix, which ADDS types. `acme_crypto::create_ca` went from 1 injected
   type to 3.

Smaller prompts and more types pull in opposite directions, and the arm came back at 16.0% to 13.8%
compiled, net minus four rows on 181. So the honest statement is "no effect detected from the bundle",
and nobody can say which part earned the minus four.

The third arm: item 1 and the cap fix in, the anchor fix reverted, same 237 tasks, same box. Compare
three ways. One row is worth 0.6 percentage points on this corpus, so a swing under about five rows
means nothing whichever direction it falls.

Worth doing because the anchor fix is the one with the strongest independent case (no type from a
rustfmt- or prettier-wrapped import group could be anchored at all, in any language), and it would be
daft to revert it on a number that item 1 might have earned.

Formerly blocked on item 29; that filter went live in session-v35 (struck 2026-08-08), so a fresh
third arm's absolutes would be the filtered configuration's - unlike every number this item quotes,
which predate v35 and stay caveated. Not blocked on anything for the
comparison.

### 45. The latency probe cannot produce a cold row, so three of its five falsification numbers are about the probe

Raised 2026-08-11 by session-v50. The rule it produced: **an instrument that cannot produce the case it
measures has not measured it.**

v50 published "41 re-polled cursors across five languages, zero recovered a renderable member" and used
it to argue the `membersWithSettle` re-poll loop is dead weight. The loop exists for exactly one case,
a def file the editor has JUST opened whose server has not finished reading it. The probe pre-opened
every file and slept 250ms per open before the clock started, so **no `membersOfType` in any run was
ever the first request after a `didOpen`.** The case could not occur. The number is true and is a fact
about the probe.

A `--cold` mode was added mid-session and still does not get there. Three things warm a row before it
is timed, all named:

1. `assertAlive` probes a vetted gate cursor before every row, and the vetted cursors come from the
   run's own roots, so those files have documentSymbol computed off the clock.
2. `rootsFrom(..., perFile = 3)` takes three roots per file, so rows 2 and 3 over a file are warmed by
   row 1.
3. `makeOpener`'s `opened` set lives for the whole run, so a file an earlier row discovered is warm when
   a later row names it as root.

What is affected, precisely. The Go and C# counts are sound, because those two DO enter the loop on a
warm corpus and answer identically every time (32 and 9 cursors, zero recoveries). Rust's zero has an
independent code-level explanation that stands without the probe (`mayRepollHelp` refuses unsigned
non-callables, which is every Rust data struct). **Python's zero and TypeScript's rest on the instrument
alone.**

Blocks a real decision: whether the settle loop is deleted outright. Until a cold row exists, the
standing answer is keep the bound. A cold row's TOTAL is not comparable with a warm one and nobody
should try; what the mode is for is the re-poll and recovery counters.

Probe: `session-v50/probe/latency-baseline.cjs` in the private working repo.

### 46. Two frozen v21 rows model a cold answer no server gives, and a bound that killed their case passed them

Raised 2026-08-11 by session-v50, and it is the sharp end of item 45.

`test/blind-v21-p3b.test.cjs` §1b scripts the cold `membersOfType` answer as a set of ONE member, and
`test/impl-v21-p3b.test.cjs` F2 as two warming to one. In both, the warm answer necessarily changes the
member COUNT.

`session-v21/surface-p3b.md` §1(b) recorded what a real server does: **11 members with 1 signed** in
52ms against a 50ms fan-out budget, warming to 7 rendered. The COUNT is complete from the first answer,
because documentSymbol is cheap; the SIGNATURES are what is missing, and a server still cold 40ms later
is cut by the same wall clock and answers 11/1 again.

That difference is not academic and it has already cost a build. v50's first bound stopped the loop when
a re-poll returned the same member count and signed count. Both rows stayed GREEN while that bound
deleted the exact case they exist to protect; an adversarial review caught it against the pre-bound code
(3 calls and 10 rendered methods before, 2 calls and 0 after).

Re-cut both at the measured shape, by an agent that did not write the change. Small, and it makes a
whole family of future bounds falsifiable.

## 3. The big builds

Each needs its own goal and scout. Ordered by measured value, not by age.

### 36. The budget was never the big hole. Resolution is: 69 real failures per run against the budget's 22

Counted 2026-08-03 (session-v39 scrap S39-8, archived on the sessions branch) off the 237-row prefill
arm. Denominator is reasons emitted per run: why a KEPT candidate produced no injected block.

| reason | per run |
|---|---|
| defined in the standard library (correct refusals, the design working) | ~380 |
| nothing renderable - the resolver reached the type and derived nothing | **53** |
| shared-budget starvation (the line v39 measured and v40's render-pass budget took on) | 22 |
| no anchor found - no reference cursor at all | **16** |

The 53 + 16 are resolution failures, three times the budget line two whole sessions just worked, and
nobody has yet weighed anchor on them. They belong to candidate anchoring and hover parsing, not to the
injection budget. The cheapest first question, and the scout's first job: are the 53 one shape or fifty?

One member of the class is already PROVEN (v38 scrap S38-9, `session-v38/spike-trait-shape.cjs`, live
rust-analyzer through the product's own extractor): a project TRAIT gets no members and a bare-head
hover - the opposite of the enum hole v39 closed - so every trait-typed collaborator likely lands in
the 53.

Rig and baseline are warm: 237 rows, v40's generation pair 63 and 66 of 237, noise floor 3. Item 29's
standing caveat applies to any absolute rate taken on the harness. Sibling of item 37; they share the
rig, the baseline and probably the session.

### 34. C# and Go have a SUPPLY problem, not a cap problem

Measured in session-v37 on real production code, not fixtures. On 117 C# methods from a 162-file .NET
solution the product names **1.7 candidate types** against **7.3** the body actually uses, and the type
it needs is anywhere in the candidate list **4.3%** of the time. Raising the cap to 24 changes that to
4.3%, because there is nothing to cap. Go is the same shape: 1.9 candidates against 3.0 needed, ceiling
14.8%, flat from cap 4 upward. Rust on the same oracle has an 83.8% ceiling and TypeScript 43.7%.

| corpus | lang | rows | mean candidates | mean needed | ceiling | recall @4 | recall @12 |
|---|---|---|---|---|---|---|---|
| acme-db | rust | 2362 | 20.1 | 2.8 | 83.8% | 28.5% | 62.1% |
| OSS rust crates | rust | 416 | 8.6 | 1.7 | 72.6% | 36.6% | 68.0% |
| cobra+gin+hugo | go | 926 | 1.9 | 3.0 | 14.8% | 14.2% | 14.8% |
| column-80 | typescript | 205 | 9.9 | 1.6 | 43.7% | 31.4% | 38.5% |
| contoso dotnet | csharp | 117 | 1.7 | 7.3 | 4.3% | 4.3% | 4.3% |

The cause needs no further measurement: `csPrioritizedTypes` and `goPrioritizedTypes` have FOUR candidate
legs where Rust and TypeScript have five, because neither mines imports. A Go import line carries a
package path and a C# `using` carries a namespace, so neither line ever spells a type name.

**This is a build item with its own scout, and the two languages need different mechanisms.** Do not
assume one leg serves both.

Two things from session-v37 that bear on it:

- The backtick gesture is now the only channel these two languages have, and session-v37 widened it so
  that `` `*Config` ``, `` `http.Client` `` and `` `Contoso.DataModel.Widget` `` all resolve. Before that
  widening it refused **79.8%** of how Go spells a type in a real signature.
- A widened gesture still has to ANCHOR. Go and C# have no import leg to anchor against either, so 82.5%
  of Go and 87.2% of C# named types have no per-file anchor at all. C# partially recovers through
  Roslyn's workspace-symbol leg; Go does not recover.

**Amendment, 2026-08-04 (session-v40, shipped 1.2.0). The missing leg is built, and the item shrank
rather than closed.** `goTypesFromQualifiedUsage` and `csTypesFromQualifiedUsage`
(`src/core/repairTypes.ts`) mine qualified references (`pkg.Type`, `Namespace.Type`) out of the
signature and body, correlated against the file's own import block so a lexical look-alike on a local
variable is refused. Go also gained the by-name workspace-symbol anchor C# already had
(`GoLspExtractor.resolveTypeCursorByName`), so a candidate with no local anchor is no longer a dead end.
Measured on the new Go rig: ceiling 5.5% -> 7.6% across 2,890 functions. C# flat at 2.6% on the one
corpus - mechanism built, no effect measured there.

Two findings gate these numbers, and both must land before any Go supply figure is treated as final:

- **S40-3**: the candidate leg admits mostly NON-types. Sampled cobra file: 3 real types in ~29 mined
  names, because every exported Go identifier capitalizes. It fails SAFE (the container filter refuses a
  non-type hit) so the harm is cost and dilution, not correctness - but part of the mined-candidate gain
  is noise, and each miss burns a live workspace/symbol round trip. Cheapest lever: refuse a mined name
  immediately followed by `(` before the lookup ever fires.
- **S40-1**: the Go corpus counts 22 generated-file rows (stringer output) that `01-corpus-go.cjs` does
  not filter, though the v37 spike behind this item's own 14.8% table did. The two populations sail
  under different flags, which is also why the rig's 5.5% baseline is not the table's 14.8%.

What remains of the item is the NEXT supply leg, not a re-run of this one.

**Amendment, 2026-08-08 (session-v42, shipped 1.4.0). Go's answer is the taught convention, and it
is now measured end to end.** The human ruled the organic channel out of scope: column80 users are
taught to doc-comment the target function, so the AUTHORED population is the real one. On a widened
six-repo corpus (cobra/gin/hugo + pgx/quic-go/goleveldb, 7,185 clean rows - the corpus filter and
the S40-3 call-shape guard both landed, round trips halved), the authored-gesture funnel over 907
rows measured: parse 70.6% -> candidate 87.6% -> in-cap 50.9% -> injected 34.8%, binding stage THE
CAP. A cap ladder put the knee at 8; `GO_PREFILL_TYPE_CAP = 8` shipped (Rust stays 4 - its own
4->12 arm measured flat, which is WHY), superseding nine frozen v37 global-cap rows as S15. Funnel
at the shipped cap: in-cap 78.8%, injected 53.9%. The generation arm (237 authored rows, two runs
each): **inject 13.6% vs dark 4.9% compiled, +8.7 points, ~2.8x, spread under 1 point** - the
product-claim number for the convention. Residue upper bound (types a heavy doc would not name,
go/types): 62.9% of instances - the remaining supply frontier, unbuilt on purpose. Seven
inject-regression rows are the re-measure band, named in `session-v42/arm-report.md`. The clean
ceiling recipe is `session-v42/spike-0-ceiling.cjs` at 17.8%; v40's 5.5/7.6 pair is unrecoverable
in recipe and quotes only as context.

### 28. Three of five languages cannot anchor an imported type at all

`pyFindTypeReference`, `csFindTypeReference` and `goFindTypeReference` have no import scan: they look in
the span, then at a same-file definition, then give up. So an imported collaborator is only anchorable
when the target's own signature or body names it. PROVEN by reading, session-v34.

Deliberately not swept from Rust, because it is a decision rather than a copy: a Go import names a
package path, not a type, so "anchor at the import line" does not mean the same thing in all five.

Related and already fixed in v34: the RUST and TYPESCRIPT scans tested each line in ISOLATION for a
leading `use`/`import`, so no type from a rustfmt- or prettier-wrapped group could ever be anchored -
the dominant shape in real code. Measured on `acme_crypto::create_ca`: injected types went from 1 to
3 once fixed.

### 27. Items 1 and 2 of v34 exist for Rust only, and four languages have the same hole

Session-v34 measured, on 230 rustc rows, that the round-1 prefill was spending its budget on types the
model already knew. `PrefillLang.isStdlibDef` decides that on PROVENANCE - the definition URI the
resolver already asks for - and only Rust fills it. Same for `RepairSurfaceLang.harvestTypes`.

The defect is not Rust's. TypeScript has `Array`/`Promise` out of `lib.*.d.ts`, C# has `List<T>` out of
reference assemblies, Python has `dict`/`Path` out of typeshed, Go has `strings.Builder` out of
`$GOROOT/src`. The seam already fits all five.

**The "they already have std name sets" defence does not hold.** `TS_STD_TYPE_NAMES`,
`CS_STD_TYPE_NAMES`, `PY_STD_TYPE_NAMES` and `GO_STD_TYPE_NAMES` guard the candidate list and the
recursive hop. That is EXACTLY the protection Rust already had: `Path` is in Rust's `STD_TYPE_NAMES` and
still shipped a private field and 24 method signatures into a prompt headed "use these exact names, do
not invent", because no name set guards the ROOT render.

Needs a scout, for three reasons that each change what gets built:

- **C# may have no URI to test.** Roslyn answers a framework type with metadata-as-source, which may
  carry a synthetic URI or none at all. A provenance test against a URI that never appears would
  silently never fire, which looks identical to a working feature. `session-v34/witness-provenance-langs.cjs`
  was written to answer this for all four at once and was never run; if that folder is gone, the witness
  is ~200 lines and re-derivable from `CsLspExtractor.start` plus the four dogfood roots.
- **Go has a design call in front of it, not a copy.** See `goShapeHooks` under Go housekeeping: Go
  inherits Rust's shape hooks, its field leg is dark, and the default `skipCandidate` of `/^[A-Z]$/` is
  safe for Rust and wrong for Go. Decide the hooks and the qualifier-aware rule first.
- **The measurement arms exist for one of the four now.** Session-v40 parameterized `05-inject-run.cjs`
  by language and built the Go arm: `candidates-go.json`, 4,017 rows over cobra, gin and hugo, scored
  through the product's own `goOracle`, reproducible at a ~1.7% spread across two runs. TypeScript,
  Python and C# arms are still unbuilt. Two hygiene findings gate the Go numbers (S40-1, S40-3 - see
  item 34's amendment).

  AMENDED 2026-08-08 (session-v45 phase 0/1): **C# now has a corpus on the box.** Five pinned OSS
  repos at `~/sandbox/v43-corpus` (Autofac, seq-api, serilog, NodaTime, Polly), 2,100 candidate
  methods scored through the product's own `csOracle`, with `lib-cs-scan.cjs`, `01-corpus-cs.cjs` and
  `lib-cs.cjs` built and gated both directions per repo. contoso is the held-out private row (168
  candidates). Two of the five repos carry a recorded local build fix (S45-1, S45-6).

**And the reason to insist on the scout:** the arity leg went in TS-only, came back out, and left the
standing rule "do not reintroduce without measuring four languages". Four new legs with the measurement
half unbuilt is that same shape.

### 35. The payload elision, in the three languages session-v37 did not build

Session-v37 built the Rust half (item 5): an injected tuple-variant enum now renders `Constrained(u8)`
instead of `Constrained( /* … */ )`, recovered from the definition source, measured at 224 of 224 in
acme-db and 29 of 29 in the OSS crates. **Session-v39 widened that mechanism a long way** and
whoever builds the languages below is reusing the wider one: `src/core/rustHoverRecovery.ts` now restores
struct-variant payloads (`Leader { lease_epoch: u64 }`) and the members a LIST cut dropped, for `enum`
and `struct` alike, refusing the whole type on any disagreement, on a `#[cfg]` inside a payload, or on a
cfg-gated body when a cut is present. Measured 56 of 237 compiled against 47. Read it before writing a
second parser.

**Amendment, 2026-08-04 (session-v40, shipped 1.2.0): the Python half is DONE.** The `enumMemberLine`
hook now covers Python: an Enum/IntEnum/StrEnum/Flag class is recognised from its own class declaration
and each variant renders as `Type.VARIANT`; a dataclass's plain fields pass through as pyright reports
them. Built REASONED with no corpus, exactly as this item priced it, adversarially reviewed clean. What
remains below is Go and the C# positional record - and note the ordering principle session-v40 wrote
down: for Go, SUPPLY (item 34) comes before rendering work like this, because rendering pays only where
the candidate list already contains the type, and Go's ceiling is still 7.6%.

The remaining two are measured and unbuilt, and they are NOT the same defect. Build them in this order,
which is cost order and not severity order.

**Python first - SHIPPED 1.2.0, kept for the record of why.** It was the worst row and the cause was OURS, not the server's. pyright and Pylance both
hover a class as `(class) LodBand`, 15 bytes that are not even Python syntax, so `parseHoverFields`
yields nothing. But `membersOfType` DOES answer: probed directly it returns `CONTINENTAL, REGIONAL,
MUNICIPAL, PARCEL` for an enum and `aggregate, tile_tally, bands_touched, label` for a dataclass. Those
members carry no signature, so `renderMemberSignatures` drops every one and the enum ships empty.
`enumMemberLine` (`crossFileShape.ts:351`) is the hook that exists for exactly this and it is set for C#
only. One hook entry, against a hole the code already documents by name.

**Go second.** A Go enum is a named integer type plus a package-level const block, and gopls hovers the
type alone. cobra's `ShellCompDirective` injects one line and one member while the eight directives a
caller must name are nowhere. Rust at least prints the variant and hides its payload; Go prints neither.
Frequency: 23 of 93 named non-struct types in cobra, gin and hugo carry a typed const set, 24.7%,
declaring 166 constants. Same order as Rust's 50.0%, and it lands on the language item 34 already calls
supply-starved. Build it after Rust and reuse the definition-source walk item 5 built.

**C# last. The frequency is now measured, and it is still small.** A C# ENUM is fine: Roslyn hovers it,
documentSymbol returns the variants, and the `enumMemberLine` hook already spells them
`ThreatLevel.Minor`. A POSITIONAL RECORD is not: hover gives the qualified name only and
`membersOfType` returns nothing, so `record StripeSummary(int Aggregate, ...)` reaches the model with
its constructor invisible.

AMENDED 2026-08-08 (session-v45 phase 1). The "one row of frequency" caveat is retired: a Roslyn
semantic census over five pinned OSS repos (Autofac, seq-api, serilog, NodaTime, Polly - 2,100
candidate methods) counts **10 positional records**, and contoso declares **1**. So the hole is real
and the frequency is genuinely low across 2,268 methods of real C#, not merely unmeasured. That is an
argument for keeping C# last, not for closing the item: the render is still wrong where it fires.

**TypeScript needs nothing.** Unions render verbatim, including a 178-byte discriminated union with its
payload objects intact. An interface hovers bodyless but its fields arrive through the member list.

### 37. The worked-example leg quotes the wrong docs on 80% of its blocks

PROVEN 2026-08-03 (session-v39 scrap S39-3), found while validating v39's phase 3, not while looking. A
prefill block headed ``Usage example for `ShardConfig` (from its docs, this compiles)`` carried the
standard library's `core::cell` documentation; `ShardConfig`'s own doc comment is two lines with no
example in it. Both claims in the header are false.

Counted over the 237-row prefill arm, denominator is usage-example BLOCKS: v38 shipped 35 of 44 blocks
never name their own type; v39 40 of 49. Pre-existing at 80% of the leg, not caused by v39 - v39 only
made it 5 blocks more visible by pushing budget-starved types onto the example leg.

The obvious guard is not obviously right: refusing an example that never names its own type deletes 35
of 44 blocks, most of the leg. Whether those 35 help or hurt is a MEASUREMENT - one arm with the leg
gutted, one with it harvesting the right docs - not a reading. Wants its own arm, sized with item 36.

## 4. Ideas and unscouted

Worth doing, not yet worth a goal file. Scout before scoping.

### 17. Ask the model which types it needs, then inject their surfaces (human idea, 2026-07-26, unscouted)

The problem: fn-gen's pre-fill picks types deterministically from the signature, doc and span.
When it picks wrong, the information arrives one round late. The v24 capture: with no context,
the 30b invented three struct fields, and repair's struct-def surface fixed them one round
later. The info existed; it was late.

The idea: before (or during) generation, the model names the types it considers relevant, the
product resolves those through the AST/LSP, injects their real surfaces, and re-prompts.

Why it is plausible:

- Type surfaces are compiler-verified, so a wrong suggestion injects a real-but-irrelevant
  surface. The failure direction is wasted prompt budget, not invention.
- An invented type name resolves to nothing; the resolve step fails open (skip and log).
- The 30b can articulate what it is missing: the v24 punt text contained the model's own
  correct diagnosis, and the product discarded it.
- Latency is affordable here: fn-gen's floor is seconds. Banned at the FIM path, as always.

Shape recommendations, to settle in the goal:

- Prefer the conditional form over always-two-rounds: the generation round may emit either a
  body or a "need: TypeA, TypeB" request; the product resolves, injects, re-prompts. The second
  round is paid only when the model is uncertain, and the request is anchored by a real attempt.
- Sequence against item 5. The alias/DI gap closes deterministically and covers the biggest
  measured stratum; this item catches the semantic residual the AST cannot see.
  Deterministic-first is the standing rule.
- Contract: the model's requested list is logged and shown like every other prompt input. The
  injected content stays compiler-verified, so the v7 curation exemption for type shapes
  applies.

The scout question that prices the whole item: how often does a real fn-gen round get fixed by
repair injecting a surface that could have been known up front? That "info exists, one round
late" rate is countable from the channel dumps today. Measure it before building anything.

**What session-v34 adds, 2026-07-30. Read this before scouting; it moves the odds.**

Item 1 was the last serious attempt at picking types better by heuristic, and it was measured and
REFUTED. It excluded standard-library roots on provenance, freed their slot in the type cap, and cut
injected bytes by 11.2% overall and 39.7% on its own 24-task subset. Compile rate went 16.0% to 13.8%
across 181 rows, total errors 688 to 733. No effect, and if anything slightly worse.

Two consequences for this item, pulling the same way:

- **Better heuristic selection is not where the win is.** Deterministic picking from the signature,
  doc and span has now been tuned, capped, re-ordered and provenance-filtered, and the rate has not
  moved. Item 17 does not compete with a heuristic that works; it competes with one that has been
  measured flat.
- **The "wasted prompt budget" worry is smaller than this item assumed.** Removing 40% of the injected
  bytes on the goal's own subset changed nothing, so budget is not the binding constraint on this
  corpus. A wrong suggestion from the model costs less than the item's own framing feared.

A concrete "info existed, one round late" case, from a live capture on
`acme_crypto::create_ca`. Round 0 injected `PkiError`, `DnType` and `CertificateParams` and
produced 2 errors. Both were about types round 0 never saw: `SignatureAlgorithm::ECDSA_P256` and
`Certificate::serialize_der`. Repair injected `KeyPair`, `SignatureAlgorithm` and `Certificate`, and the
count fell to 1. The body then called `KeyPair::generate_for` and `Certificate::der`, both straight off
the surface it had just been handed.

So on that row the answer to the scout question is yes, twice, and the model would very likely have
named `KeyPair` and `Certificate` if asked, since it reached for both unprompted and got their method
names wrong. Countable properly across the 181-row arm in
`session-complxity-research/data/v34-after.json`: the rows to count are the ones whose round-0 errors
are all `unresolved-method`, `unresolved-assoc` or `unresolved-field` against a type the repair round
then resolved.

One caveat that must not get lost: every rate above was taken on a harness where the visibility filter
is dead (item 29), so the absolute numbers are not the product's. The comparison is sound because both
arms ran there.

### 39. Other agent CLIs as fn-gen backends: codex, opencode, and whatever comes next

Human ask, 2026-08-08, immediately after item 38 landed and was driven for real: the same trick for
other CLI subscriptions. RULED not-now in that session, deliberately, so item 38 could ship on one
proven backend rather than three guessed ones.

What item 38 already paid for, and what a second CLI would reuse unchanged: the
`InstructGenerateFn` seam, the fence strip, the neutral-cwd contract and its fail-closed wiring,
the abort and watchdog discipline, the typed failure taxonomy, and `claudeModelLabel`'s rule that
evidence names the server of a round. `src/core/claudeCodeInstruct.ts` is the worked example.

What is Claude-specific and must be rebuilt per CLI, all three of them small: the argv
(`-p --output-format json --strict-mcp-config`), the JSON field names (`result`, `ttft_ms`,
`duration_ms`, `stop_reason`, `num_turns`, `is_error`, `subtype`), and the failure-text patterns
(`/not logged in/i`, the rate-limit family).

**Do not write the adapter from documentation or memory.** Item 38's whole risk was retired by
spiking the real CLI on the real box first, and that is what found the fence trap (replies arrive
fenced despite an explicit no-fences instruction) and the MCP leak (user-scope servers attach in
any cwd) - neither of which any amount of reading would have surfaced. `codex-cli 0.144.4` is
installed on this box and emits a JSONL event stream rather than a single result object, so its
`result`-equivalent has to be found, not assumed. One spike call per CLI, recorded, then the
adapter.

The design fork, unresolved and worth a ruling before any of it is built: one small adapter per
CLI (honest per-CLI failure taxonomy, honest messages, N modules) versus one generic
spawn-a-command backend driven by settings (covers everything at once, but hands prompt-bearing
argv to a user-supplied string and gives up the taxonomy that makes the disabled messages
actionable). The session's instinct was per-CLI; the human has not ruled.

### 11. Include block, the recursive variant

The single-block half SHIPPED in v32: Add Enclosing Symbol and Add Enclosing Block are both live,
in all five languages, with the selectionRange chain falling back to the enclosing symbol where a
server answers badly. The explorer-tree gesture and the menu placement shipped with it. What is
left is the recursive variant, unscouted.

Include the block, then everything it calls, to a depth limit. Real design tension:

- It must not break human-curates-everything. One click ratifying N machine-picked blocks is
  suggest-and-ratify: every block lands in the panel individually, visible and removable.
  Silent prompt-dumping is banned.
- Fan-out is the unmeasured cost. Depth 2 on a hub function can be dozens of server round trips
  and a blown prompt budget.
- Scout: call-hierarchy latency per language on the real repos, depth-2/3 tree sizes on
  acme-db-scale code, and the fn-gen prompt-budget hit.
- Expect the answer to force a cap, dedupe, and possibly signatures-only beyond depth 1.
- fn-gen/repair path only. Never the FIM keystroke path.

### 5. The whole-block trigger cannot see how real code names its types

The problem: whole-block injection fires only when the SIGNATURE names a concrete user type.
Real code mostly does not do that, so the highest-value sites get no injection at all.

Measured, per stratum (v22 scout):

- Aliases: acme-db reaches `ShardMemCache` through `type MemCache = ...` at 17 of 32 call
  sites. Those sites score 0.0% recall in every arm, even when injected by hand.
- Interfaces: contoso consumes its CSV types only as `ICsvMonitor`. The concrete 45-property
  type never appears in a signature.
- Dependency injection: lansura's stores make 132 consumer functions invisible vs 15 seen.
- New face (v24 capture): a signature naming only `Option<u64>`/`u64` logs `injected=false` -
  no user type, nothing to key on.
- New face (v25): 10 of 30 Rust empty-body sites are not injectable, so they fall to the bare
  bound.

Three fix shapes, in cost order:

- Resolve local `type X = Y` aliases at harvest time. A file-text scan; no LSP round trip.
- Resolve an interface-typed param to its sole implementor when the workspace has exactly one.
- Give up on the signature and type the RECEIVER at the cursor instead.

The attachment question the scout must answer: the 0.0%-even-when-injected result says naming
the alias's TARGET may not be enough. The block may need to speak the alias's own name.

### 6. The `selected:` prompt line was never measured

The usage-windows half of this item SHIPPED in v29: `resolveUsageInBudget`
(completionProvider.ts:775), its own `usageExamples` switch, windows rendered below the
signatures nearest the cursor, both the dark and the injected case logged. What remains is the
cheap half nobody ran.

- Today the prompt is rewritten to the highlighted member and injection narrows to that member's
  signature. The member is never named to the model on its own line.
- The work: measure that shipped narrowing against an explicit `selected:` prompt line. No such
  line exists in prompt.ts or fimInject.ts.
- Baseline from the v22 scout, 60 real call sites, 8 seeds: no injection 39-42%, selected
  member's signature only 76%, signature plus usage windows 78%.
- If the delta is real, the line is nearly free. A night, not a session.

### 10. The second call in a chain generates blind - RE-MEASURE, v27 covered part of it

The problem as written: injection keys on the first dot of a statement. In
`results.iter().map(|r| r.` the closure receiver's members are never injected. Chained style -
LINQ, EF, Rust iterators, TS functional - generates with nothing.

v27's chain warm (`src/core/chainSurface.ts`) fixed an ADJACENT failure, not this one. Do not
read it as closing the item:

- What it fixes: Roslyn serves 115 items at a `List<Tile>.` receiver with no signature on any
  unresolved item, `Where<>` sits at position 113, and MEMBER_RESOLVE_CAP=32 never reaches it. A
  once-per-workspace background warm fills the missing signatures.
- That is members-present-but-signatureless. Item 10 is members-never-injected-at-all.
- The warm is C# only today (completionProvider.ts:279). Rust iterators and TS functional chains,
  the motivating cases, are untouched.

The standing instruction before anyone scouts this: re-measure the per-member-call invention rate
at second-dot sites on the current product, per language. The 7-8% flat figure predates the warm.
If C# moved and Rust/TS did not, the item shrinks to those two.

- TS2339 ("property does not exist") is the single largest error code in the whole compile
  spike.
- Needs: element-type unwrapping at a collection receiver, plus a per-statement injection cache
  that outlives a single dot.

## 5. The long tail

Real, filed, and not urgent. Priority within the tier is unchanged.

### 4. fn-gen quits repair early while the errors are still shrinking (v24 fix 4)

The problem: fn-gen gets exactly one self-repair round by design (repair.ts:414). In the v24
capture the round reduced the errors but did not clear them, the loop quit anyway, and broken
mis-indented code sat in the buffer with no notification.

- Fix shape: grant a second round when the error count is falling and the hard cap allows it.
- Deferred from v24 because the goal ruled it must be measured, not assumed.
- Needs a corpus of real multi-error drafts.
- Evidence: session-v24/scraps.md.

### 7. Rust has injection and zero enforcement - the last such language

The problem, dogfood-proven: with a clean injected member list in front of it, the model still
wrote `s.add_tile_by_morton(...)`, a method that appears nowhere in that list. Nothing checked.

Why Rust is exempt today:

- The gate covers TS, C# and Python. Rust is carved out.
- rust-analyzer serves keyword/postfix completions at a dot (`.await`, `.if`).
- The extractor drops those, so Rust's member list is incomplete by construction.
- A gated Rust once suppressed `.await` because of exactly that. It was turned off.

The fix design (written, scouted):

- Keep the dropped labels as members that are never rendered. The gate needs the complete legal
  list; the prompt only needs callable ones.
- Decouple the gate from injection's deadline. Today, injection must finish within 50ms of the
  keystroke; if the language server is slower, the member list is thrown away, and the gate
  never runs.
- The gate does not need that deadline. It runs after generation returns, and generation takes
  about a second, so a list arriving at 80ms is ready long before there is a ghost to check.
- Concretely: keep the language server's promise alive past the injection deadline, and let the
  gate await it under its own, much larger timeout.

Evidence and traps from the scout:

- False suppression on membership: 0 of 196 real sites. PROVEN. The author's real method was
  never missing from the list.
- Trap 1: a `Future` receiver rewrites all 127 labels as `await.`-prefixed noise.
- Trap 2: the motivating capture had no dot typed yet, so the gate as designed would not have
  caught it. The goal must settle that scope hole.
- Red-before-green in BOTH directions: an invented name is suppressed, and `.await` still works.
  The second is the regression that turned this off last time.

### 8. Injection works on an idle box and vanishes on a busy one

The problem, measured under 28 CPU spinners, 20 warm keystrokes each. "Delivered" means the
facts reached the model:

```
C#  20/20     TypeScript  17/20     Rust  3/20     Python  0/20
```

Two different failures, not one:

- TS and Python die on request COUNT: one keystroke fires 8 hover requests at once, against a
  server that answers one at a time.
- Rust and Python die on the RECEIVER: one member-resolve call costs 44-75ms of a 50ms window,
  so nothing downstream ever starts.

The fix has a forced order. Do not reverse it:

- FIRST decouple: today the provider kills the argument-type leg whenever the receiver renders
  empty. Cutting receiver cost first would kill that leg instead of freeing budget for it.
- Detail: narrow the early-return to the empty-signature branch only.
- Detail: an argument-types-only block must not carry the "use one of these exact names" header,
  or it announces an empty list.
- THEN cut receiver cost per language.
- Do NOT tune another timing constant. The language-server work cannot be interrupted, so a
  deadline never bounds it. Three tuning passes died proving this.
- Sequence with item 7; they share the same seam.

### 9. Nobody knows the injection landing rate on any machine

The problem, made concrete on 2026-07-25: an apt upgrade killed CUDA at 07:29, the model ran
CPU-only all morning, injection silently degraded on the reference box, and nothing recorded it.

- There is no counter. The only signal is a channel line nobody reads.
- On a weaker user's machine, injection could be silently off forever.
- The build is small: count landed / skipped / no-site, per session, per language.
- Surface it somewhere that gets read when things are GREEN. Failure-only messages go unread;
  a correct diagnosis once sat in a known-red test message for a whole session.
- This counter also gates every hardware-adaptation argument. Do not act on deadline-adaptation
  reasoning without it.

### 13. Nobody knows what the ratified tests miss

The problem: the TDD gesture ratifies tests, they pass, and nothing measures what they fail to
cover. A green suite can be hollow.

Three instruments, one family. None may ever become a model-optimized target - Goodhart's law:
tests that execute lines and assert nothing.

- **Coverage**: which branches of THIS function no test touches. Folds into item 14's scout;
  same post-accept surface the oracle decorations already own.
- **Mutation testing**: mutate the accepted function, run the ratified tests; every surviving
  mutant is a proven hole no coverage number can fake. Expensive by construction (one test run
  per mutant), so never the accept path - a deliberate gesture or a background pass. Scout:
  shell out (cargo-mutants, Stryker, mutmut; Go support thinner) or mutate through the
  product's own span machinery, and does runtime make it a nightly?
- **Fuzzing**: earns its keep only on parse/decode/boundary functions. A classifier problem
  first (which functions are fuzz-shaped), possibly just a template the TDD gesture emits.

The mocking question, answered honestly or not at all:

- The standing rule stays: refuse un-auto-testable functions rather than emit hollow or mocked
  tests.
- The real question: on mock-heavy C# (constructor-injected everything), does the classifier
  refuse so much that the gesture is useless there?
- Measure the refusal rate on real C# first. Then choose: interface-stub scaffolds the human
  fills, or accept the gesture is for leaf logic.

All three sit behind item 14, which builds the machinery they reuse.

### 14. A failing test does not drive repair

The problem: fn-repair converges on compile errors only. A ratified test fails after accept and
the loop does nothing with it. The strongest oracle in the product is report-only.

The resolved safety design (never naive converge-to-green):

- The HUMAN assigns blame.
- "Impl wrong": fn-repair runs against the human-ratified test, hard cap, stop-and-surface.
- "Test wrong": the human re-types it. Test-repair stays banned.
- Gate unchanged: the v1 spikes measured wrong-value-assertion repair useless. That stands
  until beaten.

Second half, coverage-as-oracle:

- Untested branches seed test-gen; exercised paths inform repair.
- A signal to the human, never a model target.
- Its own scout question: coverage tooling cost and latency on the post-accept path.

Build this before item 13; it reuses this item's blame-assignment machinery.

**Amendment, 2026-07-30 (session-v35): the tests that already exist are the bigger half, and nothing
reaches them.**

Everything above assumes a RATIFIED test: one the product generated and the human approved. The
common case is the opposite. A real repository already has human-written tests covering the target,
the product has never seen them, and it cannot run them.

PROVEN on `acme-db/acme_crypto/src/pki.rs::create_ca`, full capture in
`session-v35/log.txt`. The repair round ended:

```
[oracle] check done ms=190 errors=0 warnings=1 success=true
[repair] outcome round=1 result=clean
```

and `cargo test -p acme_crypto --lib` then failed 8 of 11, including `test_create_ca`, which was
sitting in the same file the whole time. The generated body wrote DER where the tests read PEM and
dropped two requirements the doc comment states in words. The compiler oracle cannot see any of it,
so the product reported success on code that does not work.

**What already exists, and it is most of the machinery.** `tddLang.ts` carries a five-language,
nine-framework runner (libtest, gotest, vitest, jest, pytest, unittest, mstest, xunit, nunit) behind
`tddLangFor(languageId)`, with two executors, `runTestOracleAt` and `runFrameworkTestsAt`, returning a
structured `TestRunParse` (passed/failed/ignored, `filterMatchedNothing`, `buildError`,
`environmentError`). It reads structured report FILES rather than stdout, precisely because stdout can
be forged by the code under test. None of that needs building.

**What is missing is the INPUT.** Both executors take test NAMES, and today those only ever come from
tests the product itself just generated - `fnGen.ts` refuses with "run Generate Tests (TDD) first".
Nothing discovers which EXISTING tests cover an arbitrary function.

**The human's constraint, 2026-07-30: do NOT run crate-level tests on every generation.** That rules
out the cheap answer (run the whole enclosing target and diff) on latency grounds, and makes covering
-test DISCOVERY the actual work.

Discovery is per-language and must be scouted as five, not one, or it ships for Rust and is forgotten:
a same-file `#[cfg(test)] mod tests` sibling naming the target, pytest's `test_<name>` convention,
xunit/nunit attributes, Go's `TestXxx` in `_test.go`, vitest/jest describe blocks. Each is a heuristic
with its own false-positive shape, and a filter that selects NOTHING is the false green this whole
design already guards against (`runFrameworkTestsAt` refuses an empty name list for that reason).

Sequencing: discovery first, since it is what unblocks the rest, and the blame-assignment design above
governs what happens once a pre-existing test goes red.

### 16. An invented member on line 2 of a ghost is never judged

The problem, dogfooded: the gate runs only at a member site. A plain continuation is never
gated in any language, so the model can invent a member mid-ghost:

```rust
stripe.enroll(Tile::from_morton(tile_fanout(), 0));
stripe.probe()    // probe() is not a Stripe member; the gate never saw it
```

- v25's bound was expected to shrink the exposure by about two thirds: 289 of 347 invented
  calls sat past line 1, and the bound cuts most multi-line ghosts.
- Standing instruction: RE-MEASURE the exposure on the bounded product before scouting any
  gate.
- If it still bites, the scout question is whether the member check can run over a
  continuation's `receiver.NAME` accesses, and at what false-positive cost.
- Suppression is the quieter failure. Every rejection leg in this product's history has run
  aground on it.
- Warning from the capture: the multi-line continuation itself was CORRECT (the function needed
  its return expression). The defect was the invented name, not the extra line.

### 18. The rest, unchanged in priority

- **Delta-gen**: "add an arm to this enum for X" - instruction-driven modification of an
  existing symbol, presented as a diff. Debate the interaction model first: single-shot
  refinement on a visible diff vs conversational drift. Highest-tension interaction call here.
- **The prefix/ranking A/B harness**: the prompt's prefix is a byte cut, not a scope, and it
  once carried a sibling's `subtended_children()` into the model, which then wrote it on the
  wrong receiver. Also, rust-analyzer's own ranking (sortText) is still thrown away. Build the
  harness first or both fixes stay opinion.
- **Embedded languages**: .vue/.svelte need a Volar transport. Own slice.
- **Ecosystem breadth**: Windows; non-NVIDIA GPUs currently land wrongly in below-12gb honesty
  mode; CPU-only honesty. Apple Silicon shipped, but M-series TTFT is still unvalidated on real
  hardware.
- **De-nest transform**: parked by the user; drop-timing caveat recorded.
- **Constrained decoding** and **machine-applicable rustc fixes**: REFUTED as written. See
  Rejected. Do not reopen without new evidence.

19. Ollama but custom

Lot of companies run self-hosted LLMs to avoid sending data to the cloud frontier providers; and they're hosted on-prem or on their own servers on their cloud, or by a gpu provider. The extension needs the ability to customize whether Ollama runs locally on the user's machine or if it  goes off to another machine to do the processing.

## Terms used everywhere

- **FIM / plain continuation**: the small model (1.5b) finishing the line you are typing.
- **fn-gen**: the big model (30b) generating a whole function from its doc comment.
- **Ghost**: the grey inline suggestion text.
- **Member site**: the cursor right after `.` or `::`.
- **Whole-block site**: the cursor in an empty function body.
- **The widget**: VS Code's native completion dropdown.
- **Scoped ghost**: the ghost rewritten to whichever member the widget has highlighted.
- **Injection**: putting real type/member facts from the language server into the model's prompt.
- **The gate**: the check that rejects a ghost naming a member that does not exist.
- **The bound (v25)**: the rules that cut a plain ghost to the current line or block.
- **Honest-dark**: the product stays silent rather than guessing.
- **The tier**: the per-language VS Code end-to-end test suite.

## The governing principle

The extension is a flow-state tool for a developer doing system-2 thinking. Eyes stay on the
code. The interaction is a keystroke on a visible diff, and it ends at accept or reject. A
feature that makes the developer manage the tool fails, regardless of capability.

Split rule: a tuning goes in the ledgers or deferred fixes. A numbered item needs its own goal
and scout.

## Decisions only the human can make

### Does round-1 generation carry derives, and is 12288 the right floor on Metal?

Two calls left open by session-v34.

**Derives at round 1.** The repair round now reads a type's `#[derive(...)]` line off its definition file
and injects it; round 1 does not. PROVEN that this is where a real failure came from: on the goal's own
screenshot row the error was `ApiKeysConfig: serde::Deserialize<'de> is not satisfied` and
`ApiKeysConfig`'s field list was ALREADY in the round-1 prompt. The derive list was the answer and no
round-1 block carries one. It is a prompt-identity change with its own budget cost, so it wants its own
number rather than being folded in quietly.

**Which serving knobs get settings.** Four of them reach the config from defaults only and are declared
nowhere in `package.json`. The evidence and a recommendation per knob live under Deferred fixes,
"Settings honesty, and the serving knobs nobody can reach". The short of it: `think` wants a default of
false, `numCtx` wants a setting because its right value is the user's hardware and its failure mode is
silent truncation, and the two token budgets want neither.

**`MIN_FNGEN_VRAM_MB` = 12288 on unified memory.** A 16GB Mac reports about 16384 and the human has
TESTED that it works. But subtract any honest toolchain figure and it falls under the floor - VS Code
alone measured 4.3GB, so any reserve above 4096 excludes it. PROVEN arithmetic. That the machine works
anyway is evidence the 12288 threshold is a discrete-GPU number that does not transfer to Metal, where
there is no PCIe transfer and offload behaves differently. See `docs/supersessions.md` S11. Wants a
measurement ON Apple Silicon, not another estimate.

Each blocks a named slice. Sorted by weight.

### The bound refuses ghosts you wanted, and its benefit was never measured

v25's biggest open item. One bound rule (rule 5, the "unsafe tail" rule) serves nothing when it
fires. Its cost is now measured. Its benefit never was.

- Live example (v26 capture): you type `metadata`, and the product stays silent for five
  keystrokes in a row.
- The model produced `.log_id,` every time - exactly the continuation plain FIM exists to serve.
- Rule 5 dropped every one.
- Measured cost over 750 real sites: rule 5 fired 16 times, and 11 of those refused text the
  developer went on to write.
- Two of the refused ghosts were byte-identical to what the developer typed.
- The claimed benefit (fewer broken splices) was inferred from a run WITHOUT rule 5, so it is
  unmeasured.
- The work: measure the benefit the same way the cost was measured, on the v25 harness.
- If it costs more completions than it saves, change rule 5 to retract to a shorter cut instead
  of refusing.
- Size: a session, not a night.

### Four look-at-real-ghosts calls from v25

The rules worked as written. The question is how the output feels, and no test settles that.

- **Stacked closers.** A declaration-head ghost can end `start_shard: 0,}}`. Valid code, but it
  reads broken at the exact moment it must read trustworthy. Alternative: each closer on its own
  line at its opener's indent.
- **Unclosed brace.** 191 ghosts now end on an open `{`, leaving an unbalanced brace in the
  buffer until you type the body. Deliberate; does it feel broken in practice?
- **Residual whole functions.** 6 multi-line-signature ghosts still serve a whole function. If
  that violates the "never a whole function" bar, the fix is one predicate in `safeTail`: refuse
  a cut that crossed a `{` the ghost itself opened.
- **The floor vs `bar1()`.** The 8-character floor refuses `bar1()`-shaped ghosts. The corpus
  says the floor is nearly free (7 of 710 refused, 0 correct), but `bar1()` is plausible and
  useful. Watch dogfood; this is why the floor is a setting.

### The &self render contract (v19 S17)

The injected block renders Rust methods as `partition_by_lod(&self) -> u32`. The live e2e shows
the model copying the receiver into the call: `s.enroll(&mut self, u64);`, which is not legal
Rust.

- Two frozen blind files pin the opposite: keep `&self`, because it signals mutability.
- Strip-vs-keep is a real trade and the two oracles took opposite sides.
- This blocks the Rust generation-quality fix; the attempted fix is reverted and waiting.
- A "strip" ruling re-enters through the blind oracles for v15/v18.

### Commit the gesture fixtures (v21 S7b)

The tier's gesture rows grade the dogfood repos' working trees, and four of five repos carry
uncommitted edits.

- rust 6 files, ts 3, csharp 6, python 3; go-scratch is clean.
- Consequence 1: every gesture row measures one machine's uncommitted state.
- Consequence 2: a fresh clone cannot run the tier at all.
- Consequence 3: the rust tier row has no baseline (see Tier health).
- The v23 leak fix removed the reason to fear committing.
- Your own experiments may be among the edits; review before committing.

### TS order-gate ratification (v22)

Arm C (methods-first prompt ordering) shipped for all languages, but its TS result needs a yes.

- On TS, method recall dipped 2 points - mostly ties, on a 15-site corpus the scout called too
  small.
- Arm C also collapsed comment-led ghosts on TS from 66.7% to 6.7%, which dwarfs the dip.
- Recommendation on record: keep arm C for TS.
- Say yes, or order the untested def-first-plus-terminator TS branch.

### The v20 trio - v26 has landed, so these are answerable now

v26 shipped the lifecycle rebuild (`src/core/scopeLifecycle.ts`, commit 4168d8e), which was the
stated precondition. Re-check each against the shipped machine rather than against the v20 capture.

- Does a stray unselected request while the widget is open exist in practice? If so it breaks
  two invariants.
- Should a Rust snippet/keyword preselect be refused a passive scope? One cheap predicate. The
  wedge fix shipped, so this may already be dissolved; check before designing it.
- What do vim-keymap users get instead of the second Escape? Their Escape leaves insert mode
  instead. Not touched by v26, so this one is certainly still open.

### Answer the rust-analyzer snippet nudge on the dogfood machine

With rust-analyzer's `fill_arguments` snippet setting on, the widget's selected text is a
rendered argument list, not a bare name. The ghost has nothing to extend, so it stops
re-rendering while you arrow.

- The product's nudge fired (`live=fill_arguments`) and sits unanswered.
- Accepting it makes selections bare names on this machine today.
- The shipped lifecycle handles snippets-on either way, because gopls has no such nudge.

### Go housekeeping

- Install golang.go in your editor and record its gopls version beside the proven v0.23.0. The
  drift canary is green, 30/30.
- Pick the GOENV split-brain option: keep GOENV=off, per-knob pins, or hybrid. The divergence
  log already ships.
- Decide whether docs/persona-research.md gets tracked. Still untracked.
### Go: three coupled decisions, and Go is not simply "the broken one"

Go inherits Rust's shape hooks because `GO_PREFILL_LANG` sets none. That is one line of omission with
three consequences, and two of them are decisions rather than bugs. Settle the qualifier question first;
it decides the other two.

**G1. Does Go get field shapes at all?**

Today Go injects method signatures and never a data shape. `goShapeBlock` says so on purpose at
`fnGen.ts:2868`, because `parseStructHoverFields` wants Rust's `name: Type` and a gopls hover writes
`name Type`.

What that costs, concretely. For a target `func NewTile(m uint64) *Tile` over:

```go
type Tile struct { Morton uint64; Lod uint8 }
```

the model is shown `Tile`'s methods and never learns it has fields `Morton` and `Lod`. So it invents
field names when it constructs one. Rust, C# and TypeScript all get the field shape.

1. Write `goShapeHooks` with a gopls-shaped `parseHoverFields`. Recommended. It is the smallest of the
   three changes and it closes the only leg where Go is strictly behind the other four.
2. Leave it signatures-only and accept invented field names on struct construction.

**G2. If G1 lands, what replaces the single-letter skip rule?**

`candidateTypesOf` matches `\b([A-Z][A-Za-z0-9_]*)\b`. From `*testing.T` the lowercase `testing` never
matches, so it yields exactly `["T"]`. The default `skipCandidate` is `/^[A-Z]$/`, so `T` is dropped.

That default is measured safe for Rust: 621 files of `acme-db` declare no single-letter struct, enum,
trait or union. It is wrong for Go. Verified on go1.26.5, `194` single-letter exported structs in the
standard library, `testing.T` among them at `testing/testing.go:934`, plus `B`, `F` and `M`.

So for `func setup(t *testing.T) *Harness` the receiver is skipped and the model never learns `t.Helper()`
or `t.Fatalf`. Deleting the rule is not the answer either: in `func Map[T any](...)` the same bare `T` is
a generic parameter that resolves to language-service chrome.

1. Carry the qualifier through the pipeline and skip on the QUALIFIED name. `testing.T` is a real type;
   a bare `T` off a generic clause is not. Recommended, and it is the only option that separates the two
   cases rather than guessing between them.
2. Give Go a `skipCandidate` that refuses a bare single letter only when no package qualifier was seen.
   Cheaper, and it needs the qualifier anyway, so it is option 1 with the plumbing hidden.

Note the blast radius before starting: `candidateTypesOf` is shared by all five languages. This is not a
Go-local tweak.

**G3. Is a Go import line a valid anchor?**

Rust anchors an imported type at its `use` line and v34 fixed the wrapped-group case. Go cannot work that
way. `import "testing"` names a package, and the token `T` appears nowhere on it.

1. Resolve Go types by qualified name through gopls workspace-symbol, the way the C# leg already resolves
   a doc-only collaborator. Recommended if G2 lands, because by then the qualifier is in hand.
2. Accept that an imported Go type is only anchorable when the signature or body names it. That is
   today's behaviour and it is honest, just thin.

See also item 28: Python and C# share G3's gap for their own reasons.

- Install golang.go in your editor and record its gopls version beside the proven v0.23.0. The
  drift canary is green, 30/30.

### Ratify v33's fourteen superseded rows

`docs/supersessions.md` S4 records them with reasons, but `session-v33/goal.md` pre-ratified only the
two `blind3-snapshot` rows it named. That file's own rule says a red contract test whose reason is
not ratified is a bug, not a supersession, so these fourteen are currently indistinguishable from
breakage by exactly the argument item 1 makes.

- All fourteen are in `test/blind-v32-p2-reanchor.test.cjs`, and they pin v32 behaviour that v33
  reverses on purpose.
- Six flipped because `{kind:"stale"}` became `resize` or `lost`. Adversarial review checked each:
  in every one the range v33 returns is the correct range.
- Eight flipped because `reanchor` returns `{moved, lost}` instead of a count. The vscode layer needs
  the lost entries to name them in one toast per event.
- None is a defect wearing a supersession's clothes; that was verified row by row, not assumed.
- Say yes and the count is settled, or order the re-cut.

### Two v33 surfaces that are correct and may still feel wrong

Both ship as built, both are defensible, and neither is a bug. They need a human who has used them.

- **A refactor across three FILES throws three toasts, not one.** VS Code fires one change event per
  document and the contract says one toast per event, so the code is right against the contract. The
  goal's prose said "a refactor that crosses three blocks" throws one, and a cross-file rename
  crosses three documents. Both readings are defensible; feel it, then rule.
- **The generate-time warning repeats on every generation while a lost block sits in the panel**,
  rather than once per loss. It is true every time and the block is one click from gone, but it is
  the same shape as the constantly-firing stale flag v33 deleted for training the human to ignore
  it. Fix if it grates: diff the lost id set across resolves and name only new losses.

### Smaller parked calls

- S14: workspaceState identity shapes.
- The un-nudge reversal path. No longer urgent; the 19-point toast survived v22.
- S2: string-keyed TS members vs the frozen blind row.
- S21: the `.:`-seam. Recommendation stands: let dogfood be the next oracle.

## Deferred fixes - small, do on next touch of the named file

- `fimComment.ts` (the Rust `quotes` set): a Rust `'"'` char literal opens a phantom string that runs to
  the next `"` and swallows every comment after it, so the v36 backtick gesture goes silently dead for the
  whole span. Any Rust body handling a quote character is affected: parsers, escapers, CSV and JSON
  writers. C# and Go carry `'` and handle the shape correctly, so it is a Rust-row fault, not a fault in
  the leg. The real fix is the quote set, which is a v25 contract change and needs its own blind oracle
  over lifetimes; the cheap one is to treat a literal scan that crosses a newline as a phantom inside
  `commentTypesIn`. Proven, `[DEFECT] C1` in `test/adversarial-v36-p1.test.cjs`, red on purpose. Full
  detail in `session-v36/scraps.md` S36-1.
- `fimComment.ts` (`ledAt`): the comment walk is quadratic in the prefix because `ledAt` does a backward
  `lastIndexOf("\n")` per hit. 200KB of block comments on one line takes 721ms against 12.6ms for the same
  bytes with a newline per comment; 977KB on one line takes 17.7s. `harvestBodyComments` in `scaffold.ts`
  walks the same scanner and is slower still. Real source does not look like this, so it is a line rather
  than a fix, but v36 put the walk on the repair path where it is awaited before the model call. Proven,
  `[DEFECT] D2`, red on purpose. See `session-v36/scraps.md` S36-2.
- `repairTypes.ts` (`spanTypesInPlay`): no `excludeName`, so a body comment naming the repair target
  resolves the target as its own collaborator and spends a cap slot. The doc leg beside it has had the
  identical hole for several sessions, so fix both or neither. Threading is written out in
  `session-v36/scraps.md` S36-3.
- `fnGen.ts` (`resolvePrefill`, test-gen path): a standard-library type still reaches the test-gen import
  hint. `importTypes` collects every resolved type including a root that item 1 refused, so test-gen can
  emit `use std::path::Path;` or `use core::option::Option;`. Checked rather than guessed: `deriveUsePath`
  finds `<sysroot>/lib/rustlib/src/rust/library/std/Cargo.toml`, reads `name = "std"`, and produces a
  VALID line. Redundant, not wrong, so it buys no correctness and waits for a number. Filter it on the
  same provenance predicate when the file is next open.
- `fnGen.ts`: three prefill bounds are unmeasured numbers. `PREFILL_TYPE_CAP` is 4, `PREFILL_RESOLVE_CAP`
  is 8 and `PREFILL_PROVENANCE_CAP` is 24. The first predates v34; the other two were picked in v34 to
  make the provenance backfill possible and to bound the round trips, not from a curve. The one cost that
  IS measured is the pre-check: prefill median 38ms to 45ms and p90 279ms to 293ms over 143 rows, so
  about 7ms, and the `definition()` round trips cost slightly more than the shape walks they avoid.
  Nobody has measured what the CAPS are worth. Do not tune them by feel; they decide what the model sees.

- `instructPostprocess.ts`: a repair round can die on its own reply's fencing.
  `[fngen] request failed: generation contains a code-fence line (unclosed or nested fence in the reply)`
  discarded a whole round on a live capture, session-v34, leaving the previous body in the human's file.
  A rejected round costs a round and says nothing about what to do differently. Worth deciding whether a
  nested fence can be recovered from rather than refused, on a real capture and not a synthetic one.
- `fnGen.ts` / the repair call-owner leg: `T` reached the candidate list. The leg resolved the call
  `from` to owner `T` and put it in types-in-play. Session-v34's provenance rule refused it correctly
  (`defined in the standard library (.../core/convert/mod.rs)`), which is incidental proof that
  provenance catches generic-parameter noise a name list would not - but `T` should never have been
  resolved as a call owner.

- The hover recovery runs on FIM's deadline legs too (`completionProvider.ts:1401` and `:1559` call the
  same `resolveCrossFileShape`). New cost in FREQUENCY, not kind; latency and dark rate unmeasured on
  either leg; the degrade is honest-dark. Shipped OPEN in 1.1.0. Full write-up archived at
  `session-v39/s39-4-deadline-leg.md` on the sessions branch.
- Three false refusals in the hover recovery, all in the safe direction (S39-5): `r#type` raw idents,
  `[Node; 1 << BITS]` read as unbalanced generics, and a C-variadic `...` read as an elision marker.
  Each ADDS recoveries and so moves the surface - each wants its own arm, none can ride along.
- The Go rig's stub TextDocument defaults `languageId` to "rust" (`05-inject-run.cjs:347`). Inert today
  (nothing on the exercised path reads it), silently wrong the day the rig drives repair or TDD, which
  read `document.languageId` at ~15 sites. One-line fix: pass `LANG`. S40-2.
- ~~`package.json` `column80.injectedSurface` copy says "roughly 765 prompt bytes" per injected type~~
  STRUCK 2026-08-10. The setting is gone: session-v48 phase 1 replaced it with
  `column80.injectedContext`, whose copy quotes no byte figure at all, so there is no number left to
  read 4% low. The measurement behind the item survives and is worth quoting if a byte figure is ever
  written again: 795 B per type-slot after v39's hover recovery, 724 before. S39-9.

Re-verified 2026-07-25 unless marked. Each waits for its trigger, not for a slice.

- `csExtraction.ts`: `advanceCsLineScan`'s interpolation-hole branch never sees a nested `@"…"`
  opening inside the hole, so that string's continuation line is treated as code and re-indented,
  changing its value. PROVEN with a real `dotnet run`: 15 wrong values in 300 placed cases.
  Pre-existing, unrelated to the placement fix (which changes none of them).
- `repair.ts`: the v30 usage leg has no fallback for a draft that INVENTED a method. References on
  a name that does not exist return nothing, and the round proceeds with no windows. Candidates
  were named when the item was ratified: type-level references of the types in play, or a bounded
  model-emitted observation request answered by the extractors. REASONED, read not run.
- `ARCHITECTURE.md`: the v30 usage leg ships on the refine round only (`repair.ts:250`), while the
  human ratified "always injected". The narrowing is deliberate and defensible, but the roadmap
  item that recorded the ratification is gone, so the divergence needs a home that ships.
- `package.json`: `column80.debounceMs` has no schema minimum. Zero disables the debounce, and
  every keystroke then issues a full extractor call.
- `specs.js`: the memberSite/argSite fixtures point at EXISTING calls, where rust-analyzer
  renders labels differently than at a bare dot. Rendered-output rows grade a shape the user
  never types. Audit all languages.
- `specs.js`: C#'s knownLeaks (`Equals`, `GetHashCode`...) keeps the "cosmetic" justification
  that Rust dogfood refuted when the model picked a leaked member first. Thin reasoning, not
  promoted.
- The E0425 self-reference check: `let x = s.f(&x, ...)` is wrong with certainty. Built as a
  text scan and WITHDRAWN: 224 false suppressions across 1.6M sites, zero true positives.
  Needs scope evidence, not string evidence.
- `extraction.ts`: the hover fan-out comment claims a parallelism benefit that does not exist
  against a one-worker server, and it misleads the next reader about item 8.
- `pyExtractor.ts`: "resolveCount unverifiable headless" is stale; the VS Code tier made it
  observable.
- `postprocess.ts`: `limitScopeByIndentation` lacks same-depth stray-closer gating, and
  `closersAllExternal` counts brackets inside string/regex literals. v25 moved the scanners
  into `brackets.ts`; verify against that shape before fixing.
- `ollama.ts`: no watchdog on a hung FIM stream; a dead request pins single-flight until a
  different-key call arrives. One `AbortSignal.timeout` cap. (v25's stopWhen ends healthy
  streams; this is the hang case.)
- Splice path: LF-only bodies into CRLF documents make mixed line endings, and CRLF replies can
  duplicate the doc comment. One EOL-normalization bundle at the vscode layer.
- `prompt.ts`: context blocks go into bare triple-backtick fences unescaped; a fence-bearing
  block mangles the prompt. Length-adaptive fences. Worth more since v33: a block's text is now
  read live, so a human can type a fence INTO a staged block and mangle the next generation's
  prompt without touching the panel.
- Blocks inside a RENAMED folder do not follow, and inside a DELETED folder they self-heal to
  `lost:"deleted"` at the next resolve. VS Code fires the rename/delete events with the folder uri
  only, never per contained file. Both documented in the handlers (v33). Building for it means
  walking the workspace on every folder event, which is real cost for a rare gesture.
- `contextBlocks.ts`: `isStale` is now on no shipped path. It survives because `blind3-snapshot`
  binds 14 rows to it, and its leg-2 logic lives on inside the re-adoption audit through the shared
  `canonical` helper. Delete it when those oracles are next re-cut.
- `fnGen.ts`: a generation cancelled mid-resolve still mutates the store and still warns. The
  resolve runs before the cancellation token is consulted, so cancelling while a closed file is
  being opened can lose a block and then say "the prompt did not include it" for a prompt that was
  never sent. Self-consistent, just a surprising sentence to read after pressing Escape.
- `compilerOracle.ts`: ANY ancestor Cargo.toml anchors the workspace, so a crate nested under a
  plain `[package]` ancestor loses repair. Anchor only at manifests declaring `[workspace]`.
  Oldest named fix still open.
- `firstRun.ts`: multi-window activation can double-run the first-run flow.
- FIM cache: the key carries no injection fingerprint, so an edit above the cursor that changes
  the member set can serve a stale ghost until a keystroke re-keys.
- RA/LS queries: the injection race's loser is used by the gate since v18, but the server work
  itself cannot be cancelled (see Rejected). Wasted work, note only.
- `catalog.ts`: `fetchCatalog` re-spawns `cargo metadata` on every unresolved-crate accept.
  Memo per crate root, invalidated on Cargo.toml change.
- Settings honesty, and the serving knobs nobody can reach. `maxTokens`/`temperature` do not say they
  are FIM-only. Four fn-gen knobs reach `FnGenConfig` from the DEFAULTS only and are declared nowhere in
  `package.json`, so a user has no remedy for any of them: `maxTokens` (2048 since v34),
  `testMaxTokens` (8192), `numCtx` (16384) and `think` (unset). `readFnGenConfig` passes them straight
  off `DEFAULT_FNGEN_CONFIG`; the comment above it says sampling knobs stay at core defaults "until a
  persona needs them", which is the call being reopened here.

  `numCtx` is the one that earns its own paragraph, because getting it wrong is INVISIBLE. It bounds the
  prompt and the generation together, ollama's own default is 2048, and a prompt over that is silently
  truncated to fit rather than refused. Measured in v34: three prompts carrying 12.9KB, 13.1KB and 15.0KB
  of injected surface all reported exactly 2050 prompt tokens, no error and no log line, so injected
  types simply stopped reaching the model. It is also coupled to `maxTokens` in a way a user will not
  guess: raising `num_predict` without raising `num_ctx` makes generation WORSE, because the reply eats
  the window the prompt needs. Memory cost at the 16GB carve with `num_gpu=30` is 11.9GB at 8192 against
  12.4GB at 16384, so about half a gigabyte buys the larger window.

  `think` has no setting AND no stated default. Any model that reasons by default is unusable until it is
  false: `qwen3.6:27b` spent all 2048 output tokens on the trace and every generation was rejected as
  truncated without emitting code, because reasoning is billed to the same budget as the answer.

  1. Ship `think: false` as a DEFAULT and leave it unexposed. Recommended for `think`. No shipped model
     reasons, `qwen3-coder:30b` does not, and a user who swaps in a reasoning model should not have to
     discover this knob from a truncation toast. One test row pins "unset stays unset" today and goes red
     on purpose.
  2. Expose `numCtx` as a setting. Recommended. It is the one knob whose right value depends on the
     user's hardware rather than on the product, a smaller box genuinely cannot afford 16384, and the
     failure mode without it is silent truncation rather than an error the user can act on.
  3. Expose `maxTokens`/`testMaxTokens` too. Not recommended. Their failure mode is a visible
     `done_reason=length` reject, and v34 already showed the shipped values were the problem rather than
     the exposure: 512 caused every one of 15 rejections across 189 generations.
  4. Leave all four as defaults. Today's behaviour. Defensible only while every shipped model behaves
     like `qwen3-coder:30b`, and that is not a bet worth carrying once someone swaps the tag.
- Test rung: `cargo test` filters are substring, not exact; `tests::add` also runs
  `tests::add_more`.
- package.json menus: language-gated commands appear in every editor's context menu, so a
  dead-end click ends in a refusal toast. Hide vs refuse; decide for both commands at once.
- gesture.test.js asserts `some` where the evidence supports `every` (v21 S6). The stated
  precondition (a green tier run) has happened; tighten it.
- The shared vscode activation stub does not exist (v21 S11/S13). Three findings want it;
  extract it before a fourth 400-line copy gets written.
- darkSites grows unpruned, in every language now (v21 S24).
- The digit-ending receiver guard darkens Go/Python stdlib qualifiers: `utf8.` and `sha256.`
  read as float-ish and go dark (v23 F21). Refuse only numeric literals; measure first, the
  class is invisible to the ledger.
- repairLangFor has no Go row (v23 P4): Go repair rides the Rust classifier, which never fires
  on go build diagnostics. Promote when a live round fails to converge where a member surface
  would have fixed it.
- Poisoned-GOENV fixtures (v23 F3/F7) exist as scrap conditions, not tests. Cheap; write them
  when goOracle is next touched.
- Python's bound p90 is 202-207ms against the 200ms bar, and the lever is named: a declaration-
  head parameter list holds brackets open, so the bound reads five lines and retracts to one,
  serving a truncated `run_in_process(config_path: str, method_name: str,)`. This is a
  served-text change with a real correctness price; measure before/after on the v25 harness
  (`harness/verify-v25.cjs`, LANGS=python, ~90s). Known trap: the bound's balance is local to
  the cursor's line, so a `(` opened three lines up is invisible; the `beginsHere` guard is the
  fix shape.
- `crossFileShape.ts`: the field leg is dark on every Rust enum, so the type graph stops at one.
  `parseStructHoverFields` wants `name: Type` per brace-body entry and no variant writes one:
  `Unpaid`, `Card(Receipt)` and `Invoice { terms: Terms }` all miss the regex, `fields` comes back
  empty, and no payload type is ever enqueued. The enum's own hover still rides `signature`, so the
  model reads the variant names and never gets `Receipt`. Data-oriented Rust puts its real structure
  in enum payloads, which is exactly where this bites. C# already ships the shape of the fix in
  `enumMemberLine`. REASONED, read not run: write the fixture first (an enum field on a walked
  struct, payload type defined in a third file) so the red is on record before the regex moves.
- `crossFileShape.ts`: `resolveCrossFileShape` takes only `{D_MAX, N_MAX}` and publishes no per-node
  fan-out or token bound. B_MAX and TOK_MAX live in `dataShape.ts`, applied by the one caller that
  wires them (`fnGen.ts:2031`). A struct with fifty local-type fields enqueues fifty candidates and
  is bounded only once N_MAX fills on dequeue. Harmless while fnGen is the only caller. The next
  caller inherits an unbounded fan-out and will not read this far, so either fold the bound into the
  signature or say so where the parameter is declared.

## Dogfood ledgers - questions only real use answers

Each entry names its measurement. The dark-site evidence lines and `[fim] dropped:` channel
lines exist to BE the measurement basis. Full reasoning lives in git history.

### TypeScript

- The member gate suppresses forward references: sketching `this.computeTotals()` before
  writing it gets dropped. Count wanted `[fim] dropped:` lines; kill switch
  `column80.fimMemberGate`.
- A fast-typed new file (imports not yet written) puts the receiver at `any`; injection goes
  dark and plain FIM invents members. Measure frequency before picking a fix.
- Aliased imports (`import { X as Y }`) burn the prefill cap with duplicate blocks. Dedupe on
  resolved identity if real accepts show crowding.
- The whole-block anchor misses JSDoc-only types.
- DOM lib names (MouseEvent, HTMLElement) chase lib.dom.d.ts walks. Curate additions from
  measured noise; `Request` collides with Express, so never a blind blocklist.
- tsconfig-less JS projects get the env-reason line on every accept. Nag vs discoverability;
  judge on real accepts.
- Broken solution shells surface the shell's own config error. Honest today.
- yarn PnP is honest-dark. Fix only if users actually hit it; never a bundled TS.

### C#

- An invented type/package gets qualify-only. Catalog steering and fuzzy suggestions come
  later, on evidence.
- The member gate on a partial Roslyn set could suppress a real member. REASONED only; watch
  for real suppressions.
- `qualifyImport` rejects `global::` and generic-arity titles. Safe direction; widen when
  dogfood produces one.
- Object-statics noise (Equals, ReferenceEquals) stays until it provably hurts.
- A doc comment that itself demands `throw NotImplementedException` trips the punt marker, and
  the obedient retry violates the contract. Fix on a real capture. Python shares this class via
  `raise NotImplementedError`.

### Python

- Sub-package venvs in a monorepo go unfound; the check falls to system python and likely a
  missing-imports storm.
- The repair-round hallucination classifier (pyright names the class) builds only if bare
  repair leaves member hallucinations standing.
- A genuinely dark receiver burns the full ~900ms retry before honest-empty.
- Enum receivers inject a dozen `_name_`/`_value_` internals. Narrow enum-scoped trim only,
  never a blanket sunder drop.
- The product transport returned six members with NO signatures for membersOfType(Tile). The
  contract row calls that half the v15 defect. This is the Python row worth acting on.
- The dark-site counter counts cold-server transients as dark sites. Telemetry-only harm; add
  a settled-index guard before trusting the density numbers.
- completeMembers and membersOfType disagree on dunders and nested classes. Pin both when
  fn-gen prefill consumes the answer.
- `pass`-only and `...`-only bodies are invisible punts. Build a detector only if dogfood
  delivers one to a human.

### Go

The ledger starts empty by design: no Go repo of the human's lives on this box yet. All numbers
are OSS-corpus harness signal (cobra, gin, hugo, pinned clones), never dogfood typing.

- Latency: hugo warm check 1.09s clears the 14.2s re-scope floor by 13x. Re-measure on the
  first real client repo.
- membersOfType is file-scoped, which costs cobra 24.7% of Command's members (they live across
  sibling files). Watch whether real Go code pays this in whole-block quality.
- The injected block cannot name a package-level constructor (`TileFromMorton`); the ratified
  join contract excludes them. Count whole-block generations that invent a constructor; that
  count prices the discovery rule.
- Everything is proven on gopls v0.23.0. The drift canary goes red if the two-rule taxonomy
  moves; never re-arm on a stale taxonomy.

### Rust

- raLspClient.ts (the headless transport) is missing two of the three render fixes the vscode
  transport got (isBlanketImpl, stripRustGenericDefaults). Fix on next touch or lift to core.
- Example sourcing misses constructor examples documented on associated functions (a `Type::`
  query would find them), and the injected example text is never logged, so a weak example
  cannot be diagnosed.
- Cross-file impl blocks are invisible to membersOfType.
- The feature-graph scan misses macro-gated modules. Benign; broaden only if needs-feature
  steering proves out.
- No rival inline-provider detection: Continue et al. silently win the ghost slot. And no
  "autocomplete is off" evidence line when disabled. Both get misread as breakage.
- Manual repair on a clean function gives no feedback at all.

## Tier health - the instrument, not the product

Baselines from 2026-07-25, quiet box, post-reboot, GPU live. Latency rows mean nothing unless
the box is quiet: under parallel test load the ts row grew seven extra failures. PROVEN.

- **ts: 43 passing, 2 failing.** Both failures are named opens: the membersOfType-signatures
  contract row (tsserver returns empty `detail` 8/8) and the v17 keystroke-cost known-red.
- **go: 44/0.** Matches v23's ship number exactly.
- **csharp: 44/1.** The floor-and-margin latency row; documented latent failure.
- **rust: 44/4 - NOT a baseline.** Every rust row grades the human's uncommitted play in
  rust-scratch: the render suite anchors on a line the play annotated, and the snippet setting
  lives in the same uncommitted settings.json. Baseline only after the fixtures commit.
- **python: 33/7.** Three documented latency reds, one real (the transport-richness row, see
  the Python ledger), one teardown race (re-run before reading), one shares the S10 oracle
  limitation.
- v26 claims 45 tier fails are environmental (a headless window never opens the widget) with no
  clean-tree baseline yet. The v26 review owes that number.
- xvfb-run is absent, so test:vscode:ci cannot run here. CLOSED 2026-07-28: a display is already up
  on :1, so `DISPLAY=:1 npx vscode-test --config test-vscode/.vscode-test.mjs --label ts` runs the
  tier directly. Written into `test-vscode/.vscode-test.mjs`, which ships, along with the
  no-model caveat (an unreachable ollama ends generateFunction on an awaited toast, so a row must
  fire the command without awaiting it). v33 ran six rows green in all five labels this way.
- The floor-and-margin rows measure machine load, not defects (RED, RED, GREEN, GREEN across
  four runs of identical code). Where a count can replace a threshold, use the count.
- Nothing forces the tier to run and there is no CI. Skipped tests in a suite nobody runs are
  just prose.
- The NVML lesson: the hardware probe reads total VRAM and no health signal, so a broken CUDA
  stack looks like a small GPU and the product degrades silently. Item 9 is the cheap detector.

## Settled without a human: S22 (2026-08-08)

Struck from "Decisions only the human can make" by session-v43's spike, which ran it headless twice
green (`session-v43/s22-findings.md`, `s22-dump.txt`). It was never a human decision: the tier runs on
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

## Measurement debt

One harness phase, when the loop next needs proving. The behavioral matrix the builds deferred:
multi-crate, multi-seed, realistic temperature, negative controls.

- Carries the behaviorally-sound bar: the `bloom_demo() -> true` bar is passed by a constant.
- Carries the reasonable-subset punt: a plausible 80% implementation with no stub marker.
- Carries LSP oracle-client hardening.
- Standing lesson from v25: baselines go stale fast. Two published numbers in one session were
  right-measurement-wrong-baseline. Always re-run the "before" against the pipeline that
  actually shipped.
- Mixed-zone scoring (from the SQRL analysis, 2026-07-26): the 8-seed A/Bs pool every site, and
  all-pass/all-fail ties dilute the number. Report the seed-variant sites separately; the
  variance zone is where the discrimination lives (the v22 "2 wins, 1 loss, 7 ties" shape).

## Rejected - do not reopen without new evidence

- **Cancelling language-server work.** Impossible, not deferred. The provider bridge forwards
  only declared args and hardcodes CancellationToken.None. Confirmed empirically: a
  pre-cancelled token still bought a full server answer. The only lever on per-keystroke work
  is to issue less of it.
- **A Cancel button around the LS phase.** It cannot cancel. Worse than silence.
- **Constrained decoding as a picker.** Tested on ollama 0.30.11: `grammar` is silently
  ignored; a JSON-Schema enum works and is a trap. Three of four models (including the
  product's own) picked a real-but-wrong member. That converts a loud compile error into
  silent wrong code that passes every gate. Every layer here is a correctness oracle; none is
  an intent oracle. Output filtering against the real member set is the only legitimate
  small-model role.
- **Machine-applicable rustc fixes as a repair rung.** Measured on 34 broken variants: only 3
  of 17 error codes ever emit MachineApplicable, E0599 carries no suggestion at all, and a
  MachineApplicable `.try_into().unwrap()` compiles clean then panics at runtime. Re-check
  passes it. The safety argument is refuted with a demonstration.
- **Deterministic member picking.** The premise is false: 0 of 1,703 real sites had a single
  candidate (median 34). Combined rules: 5.3% correct, 63.2% precision, 71% of wins literal
  name echo. Filter, not picker; that value shipped as the gate.
- **Ceding member sites to the native widget.** Human call, 2026-07-21: the widget gives a
  name, the ghost gives the whole statement. Compose, never cede. Shipped as v19.
- **VS Code diagnostics loopback as the oracle.** Lossy, stale mirror. One-way diagnostics
  invariant stands.
- **Small model as a doc-relevance pre-filter.** It filters output only.
- **docs.rs example sourcing.** Network at runtime breaks the offline invariant.
- **Blanket crate allowlist.** Wrecked std-correct tasks 8/8 to 0/8.
- **Test-repair.** A wrong test is a human re-type.
- **`--nocapture` on the test rung.** A passing test printing `test x ... ok` parses as a bogus
  case.
- **Blanket sunder drop in Python.** Hides real `_private` API.
- **The arity gate leg.** Removed v19 on measurement: dead in three of four languages, and on
  TS it caught 1 wrong call while suppressing 3 correct ones over 887 generations. Do not
  reintroduce without measuring all languages.
- **Widening the E0433 classifier to inject a workspace-resolved type (session-v36 item 2).** Refuted
  2026-07-31 on a corrected harness; the argument is in `session-v36/item2-redecision.md`. Of the five
  rows and eight type names the goal named, two rows were splice artefacts, one row is already covered
  today as `wrong-item`, one name is a std trait, one is an enum variant, and exactly one (`Ia5String`) is
  a real injectable type. The proposed mechanism cannot reach it: rust-analyzer's plain `workspace/symbol`
  is workspace-scoped and returns zero hits for `Ia5String` and for the control `CertificateDer`, and
  where it does answer it can answer wrong (`ServerConfig` returns two workspace hits when the code needs
  `rustls::ServerConfig`). The dep-reaching `*` modifier returns 4 to 10 candidates with no disambiguator.
  Corrected zero-coverage is 8 of 102 rows, and 10 of the 33 residual occurrences are std traits no
  injection should resolve.
- **Scanning comments for unbackticked type names.** Measured on two populations, both agree it is a junk
  generator: 97.7% junk over 6,856 human-written comment lines (5,232 names, 122 real types), reproduced
  after the harness fix. Superseded by the backtick gesture that shipped in v36.
- **Reordering the prefill tiers (old item 31's fix shape).** The v37 scout replayed the item's own row:
  the doc contributed zero candidates, so imports never beat the doc and there was no ordering bug to
  fix. The one real ordering effect - rustfmt's alphabetical import order deciding which project type
  wins - is a symptom of the cap, and the cap arm is measured flat: 4 -> 12 moved 0.8 points, inside the
  noise floor (v38 item 3 notes).
- **Raising `DATASHAPE_TOTAL_TOK`.** Measured, session-v39 (the 800/600 arm): 61 vs 56/56, and banded by
  actual prompt growth the gain sits on 133 rows the budget never touched (+2.5 of pure variance), while
  the 46 rows that grew 901B+ paid -0.5 and ate ~38k of the 98.5k added bytes. The render-pass budget
  shipped in 1.2.0 buys the rescue without the bytes.
- **Exempting the walk's own root from the per-walk `TOK_MAX`.** Same session: root drops stayed at 63
  and starved rows went 21 -> 24. The refutation is written in `src/core/dataShape.ts`.

## Scraps disposition - the pointer that survives

Every session scrap through v23 is folded here, closed, or deliberately dropped; the 2026-07-25
re-triage verified that in code. The v24, v25 and v26 scraps keep their reopen conditions in
their session files, and the load-bearing ones are already items above (v24 fix 4, the rule-5
cost, the v25 look-at-real-ghosts calls, the v26 human calls). Everything from v27 onward carries
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
PROVEN means tested; REASONED means read but not run.

Item numbers never move once assigned, because items cross-reference each other by number. A gap
means that item shipped. Gaps so far: **1** (the unit suite red on main, closed 2026-07-28: the 26
reds were ratified as `docs/supersessions.md` S4 through S9, the suite is green at 6391 pass / 0
fail / 3 todo on a dev box, and what remained of the item split into 21, 22 and 23), **3** (usage examples into
fn-gen repair, shipped v30, `repair.ts:244`), **12** (live context blocks, shipped v33; the identity
claim moved with it, see `docs/supersessions.md` S4), **15** (the TDD gesture in all five languages,
shipped v31), **20** (doc-comment scope plus the scaffold harvest, shipped v32) and **24**
(`num_predict: 512`, raised to 2048 with `testMaxTokens` to 8192 on 2026-07-30; the ladder was
re-run at the new ceiling and the model is correct at 64 branches, 64 simultaneous rules and 64
ordered pipeline stages, 17 of 18, so every one of those earlier failures was budget), **25** (every
repair round added one indent level to the human's file: fixed in 1.0.4, commit b9847c4, at the INPUT
exactly as the item ordered - `dedentReplyCode` normalises the failing code in the repair prompt and is
the declared inverse of placement. The entry then sat under Fix now for four more releases; struck
2026-08-07), **31** (the surface priority order: REFUTED as filed by the v37 scout, which replayed the
item's own row through `prioritizedTypes` and found the doc comment contributed ZERO candidates - the
backtick parser could not read either span, so "imports beat the doc" never had a race. The disease was
the extractor and shipped as v37's widened gesture; `BasicConstraints` rendering nothing shipped as
v39's hover recovery; the `OffsetDateTime` 24-slot waste shipped as v40's render-pass budget. Tier
reordering is in Rejected. The ratified priority order survives in the tiers that exist, in the comments
above `prioritizedTypes`), **29** (the harness visibility filter: the item's exact fix - the stub reads
unregistered `file://` URIs off disk - already shipped in session-v35, and the entry sat unstruck for
five sessions after. Verified both configurations on one row 2026-08-08, artifacts
`session-v42/item29-before.txt`/`item29-after.txt`: the dead config filters nothing, the shipped one
drops 15 non-public `Pool` members with the channel line. The standing caveat is UNCHANGED: absolute
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
oversubscription against a bar of 2.5, and 3.9x idle, where linear would be 2.0).
Items 6 and 11
shrank rather than closed: 6's usage-windows half shipped v29 and its `selected:` measurement
did not, and 11's single-block gestures shipped v32 while its recursive variant did not.
