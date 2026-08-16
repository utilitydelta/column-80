# Roadmap

Everything pending, one file. A session picks a slice, scouts it, builds it, and the slice comes
out of here when it ships. Shipped work lives in ARCHITECTURE.md and git history.

**Item numbers never move.** Items cross-reference each other by number, so a gap means that item
shipped; the gap list is at the bottom under History. The TIERS below are the priority order and
they do move, every time the evidence does.

**PROVEN** means tested. **REASONED** means read but not run. The file did not keep that line: three
entries said "PROVEN" of something read rather than run, which is the exact confusion the two words
exist to prevent. Fixed 2026-08-16; if you find another, it is a defect.

**UNVERIFIABLE** is new here, and it is not a hedge. It marks a claim whose backing artifact no
longer exists on this box, and it always names the check that would settle it. Roughly thirty
measurements this file quotes are in that state, most of them lost to session-directory cleans and to
the 2026-08-10 branch scrub rather than to anything being wrong. A recitation of a number inside a
shipped comment is not the artifact. Do not re-quote a marked figure as a baseline; re-derive it, or
take the marked one and say which you did.

**Rewritten 2026-08-16 from a claim-by-claim audit** (`docs/triage-2026-08-15.md`). All 417 claims in
the previous file were checked against the code: 292 held, 48 had drifted, 20 described work that had
shipped, 2 were superseded on the record, and 55 lost their evidence. Thirty per cent wrong,
concentrated in the tier a fresh session acts on first. So take the tier order as current and the individual diagnoses as needing a re-read
before you build against them - item 42's first version was confidently wrong for two months, and
nothing flagged it until a session went looking. That is the failure mode this file has, and the
audit is what caught it the second time.

## The list, at a glance

**1. Fix now**
Proven broken, no design question left. Each is small and each is about the product or its gate telling the truth.

- **55.** every fn-gen refusal blames the cursor, including the one that means no language server is installed
- **22.** shipped source cites folders a clone does not have; 234 citations across 57 files
- **23.** a few rows measure wall clock and CI is not their hardware
- **2.** a frozen live test is red and nobody runs it
- **21.** the cross-file argument-type leg, unbuilt since v14 - and its rows are GREEN today by asserting the defect
- **7.** Rust has injection and zero enforcement, the last such language
- **19.** a remote Ollama is gated on the LOCAL box's VRAM, so pointing at a GPU server disables fn-gen

**2. Trust the instruments, before building on them**
A number from the harness is a hypothesis until the instrument that produced it has been looked at. Mostly blocked on taking a measurement rather than on a design call.

- **43.** nothing measures how often a real session overflows the window; the guard itself shipped in v48
- **41.** the tuning constants were chosen for a local 30B, and the premise moved without a record
- **42.** repair supply outside Rust, restated after the rig defect that produced the first version
- **30.** item 1 needs a third arm before anyone knows what it did
- **45.** the latency probe cannot make a cold row, so three of its five falsification numbers are about the probe
- **46.** two frozen v21 rows model a cold answer no server gives, and a bound that killed their case passed them
- **47.** Python's pre-fill gate has never been decomposed and its last number was 7.8x
- **48.** the injected surface carries no imports, in any language, and it is Python's largest measured failure family
- **49.** the count cap's server justification is measured false on Python and untested on TypeScript
- **50.** the gather buys a hover per collaborator the render drops; fixed in Go, unmeasured in three languages
- **51.** the arm runner has no Python entry, so every Python number comes off a second code path

**3. The big builds**
Each needs its own goal and scout. The order is inherited from the evidence each was filed on, and a third of that evidence no longer has an artifact - read it as a prior, not a ranking.

- **36.** resolution is the hole, not the budget: 69 real failures per run against the budget's 22
- **34.** C# and Go have a supply problem, not a cap problem
- **28.** three of five languages cannot anchor an imported type at all
- **27.** v34's items 1 and 2 exist for Rust only; four languages have the same hole
- **35.** the payload elision, in the three languages v37 did not build
- **37.** the worked-example leg quotes the wrong docs on 80% of its blocks

**4. Ideas and unscouted**
Worth doing, not yet worth a goal file. Scout before scoping.

- **53.** a ratified test suite passes against a body replaced with `{ 0 }`; PROVEN 2026-08-12
- **54.** injection walks downward only, so no caller-direction fact ever reaches the model
- **17.** ask the model which types it needs, then inject their surfaces
- **39.** other agent CLIs as fn-gen backends: codex, opencode, and whatever comes next
- **11.** include block, the recursive variant
- **5.** the whole-block trigger cannot see how real code names its types
- **6.** the `selected:` prompt line was never measured
- **10.** the second call in a chain generates blind

**5. The long tail**
Real, filed, and not urgent. Priority within the tier is unchanged.

- **8.** injection works on an idle box and vanishes on a busy one
- **9.** nobody knows the injection landing rate on any machine
- **13.** nobody knows what the ratified tests miss
- **14.** a failing test does not drive repair
- **16.** an invented member on line 2 of a ghost is never judged
- **33.** the spike harness spliced on stale offsets: a record, and the corpus behind it is gone
- **18.** the rest, unchanged in priority

Then, below the items: decisions only the human can make, deferred one-line fixes, the dogfood
ledgers, and the history this file used to open with.

Three entries left this list on 2026-08-16, all three in the History gap list with their reasoning:
**26** and **4** shipped in session-v35, **52** shipped in 2.1.0. Three arrived: **53** and **54**
had index lines and no sections, and **19** had a section-shaped paragraph, no index line and no gap
entry, so the file's own "a gap means it shipped" rule could not classify it either way.

## 1. Fix now

Proven broken, no design question left. Each is small and each is about the product or its gate telling the truth.

### 55. Every fn-gen refusal blames the cursor, including the one that means no language server is installed

**The next build, ratified 2026-08-16.**

`resolveFunctionAtCursor` (`src/vscode/fnGen.ts:293`) refuses on three distinct causes and returns
the same bare `undefined` for all of them:

```ts
if (!symbols || symbols.length === 0 || !hasDocumentSymbolShape(symbols)) return undefined;
```

Only the third is the human's fault, and it is the rarest. The callers turn all three into a message
that points at the cursor: `no function at the cursor` and `nothing to generate here - the cursor is
not inside a function or on a generatable type header` (`fnGen.ts:5175`), `place the cursor in a
function to generate TDD tests` (`fnGen.ts:5783`), the TDD-run twin (`fnGen.ts:6128`), and the repair
gate.

PROVEN 2026-08-16 by a first-run user on Windows 11 with Rust: no rust-analyzer extension installed,
FIM working, both generation gestures refusing. He read the message, checked the cursor, found the
cursor was right, and had nowhere else to go. The message sent him to the one thing that was not
broken.

- **FIM masks it.** FIM is Ollama-only and its language-server legs are raced against a 50ms deadline
  and fall back silently, so a missing server looks like a working install. "FIM works" is what makes
  the user believe the setup is fine.
- **No channel line.** The tier gate logs, the unsupported-language gate logs, this branch logs
  nothing. The toast is the only signal in the product, and it names the wrong cause.
- **The platform is incidental.** The resolver hands `document.uri` to
  `vscode.executeDocumentSymbolProvider` and touches no path, no separator, no filesystem. This is not
  the Windows gap in item 18, and a session that goes looking for a path bug here will find nothing.
- **The fix is at the resolver**, so one change covers fn-gen, both TDD gestures and repair. Split the
  three branches, name the expected server for the language in the undefined case (rust-analyzer,
  gopls, Roslyn, Pylance, the TS server), say "still indexing" on the empty tree, and keep today's
  wording only for flat `SymbolInformation`. Add the `[fngen] refused:` line on all three.
- **Requirements are silent too.** `docs/user-manual.md:52` lists Ollama, the VS Code version, the GPU
  and the per-language compiler toolchain. It never says the language server extension has to be
  installed, and every gesture past FIM depends on one.

### 22. Shipped source points at folders a clone does not have

Shipped files carry comments citing gitignored `session-*/` paths, so the reasoning they point at is
unreachable from a fresh clone. Split out of the old item 1, which was closed 2026-07-28. REASONED.

**The sweep is ten times the size this item used to claim.** It named six files.
`grep -rn "session-" src --include="*.ts"` counts **234 citations across 57 files** (verified
2026-08-15). `fnGen.ts` alone carries 61, `crossFileShape.ts` 17, `extraction.ts` 10. The six-file
list was never a survey; it was the files somebody happened to have open.

**The policy, ratified 2026-08-16: point the citation at a committed doc.** Move the reasoning worth
keeping out of `session-*/` and into a doc that ships, then repoint every cite at it. Delete is the
fallback, and only for a citation whose reasoning is not worth moving. Neither answer is "leave it";
a comment that cites an unreachable folder is a comment that cannot be checked.

### 23. A handful of rows measure wall clock, and CI is not their hardware

Three rows failed on a GitHub runner and pass locally. None is a product defect; each measures
something the dev box happens to satisfy. PROVEN 2026-07-28 across four CI runs. Line cites below
re-verified 2026-08-15; two of the three had gone stale.

```
impl-service.test.cjs:365           the miss-path lookup cost row
blind-v21-p1-commands.test.cjs:594  the real 1500ms passive-scope window (machinery :571-616)
blind-v21-p3a-darkreason.test.cjs:324-333  a log line that grows `gateWait=` under load
```

Two of the three are FIXED. One is excluded on CI and is the item that remains.

- **Fixed, the perf row - and not the way this item first described it.** The claim was always "cost
  does not scale with document size", so a 10x RATIO between a small document and the 2MB one looked
  like the hardware-independent form. It was tried and it failed on exactly that
  (`impl-service.test.cjs:370-371`). What shipped is an ABSOLUTE bound, `< 5ms` at `:400-403`, over
  the same 50 timed misses at `:386-390`. The row's own comment explains why, and it is worth reading
  before anyone proposes a ratio again: a healthy 2MB call measures 0.73-0.82ms against a small-doc
  0.042ms, an 18x spread WHEN NOTHING IS WRONG, because the small-doc figure is fixed overhead and
  nearly zero - so a ratio test compares against noise. The regression the row catches slices the
  whole document per call and measured ~13ms. 5ms sits between 13ms and well-under-1ms with headroom
  on both sides, including the 2.06ms a loaded CI runner produced. The lesson is the inverse of the
  one this entry used to teach: a ratio between two measurements on the same loaded box is not
  automatically steadier than a threshold with enough headroom in it.
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
- `release.yml` does NOT run `test:unit`, and that is a DECISION rather than a gap - the comment at
  `release.yml:50-60` argues it out: a tag points at a commit `ci.yml` has already tested, so
  re-running at publish time proves nothing new and can fail on exactly these wall-clock rows, with
  the tag already public and immutable. This entry used to end "close this item and the release job
  can gate on tests again". Closing it does not create a reason to re-gate; it removes the failure
  mode `release.yml` is already avoiding by other means.

### 2. A frozen live test is red and nobody runs it

`blind-v16-argtype-live` pins the claim "with Tile's construction injected, the model builds a
Tile". That claim no longer reproduces. The model serves garbage instead:

```
EnrollTile(new(0, 1))
```

- **UNVERIFIABLE, and it is three of this item's four premises.** "PROVEN 2026-07-25 on GPU, so not
  a CPU artifact", the GPU-versus-CPU control behind it, and "also red before v21" are all recorded
  nowhere on this box (C24, C25, C26). The garbage output above survives; the run that produced it
  does not, and "red before v21" is a bisect claim with no bisect record. What would settle all
  three: `node --test test/blind-v16-argtype-live.test.cjs` on the GPU tier with ollama up, and a
  git-bisect driving that row for the regression point. Needs the GPU box, so not tonight.
- **The run-list claim is wrong in the letter and right in effect.** The file IS matched by
  `test:unit`'s glob (`package.json:534`, `test/**/*.test.cjs`), where `SKIP_LIVE=1` makes every row
  skip; it is absent from `test:live`'s explicit list (`package.json:537`). So it is in a list and
  no list ever EXECUTES it, which is the worse of the two states: it reads as covered.
- Triage: find when it regressed, or rule the row fragile single-draw evidence.
- Its sibling baseline row already skips itself, which supports the "fragile" reading.
- Either way: fix or re-cut, then put the file where something runs it.

### 21. The cross-file argument-type leg, unbuilt since v14

Three rows in `test/blind-v15-argtype-identity.test.cjs` carry the whole demand. Every assertion
stands as written; do not soften one. PROVEN red 2026-07-28.

**Read this before writing the goal, or the build session reverts its own success.** The `todo`
markers came off on 2026-08-10 (session-v48 phase 0, G4, recorded at the file's `:99-100`). The three
rows are GREEN today, retitled `KNOWN WRONG:`, and they pass by asserting the DEFECTIVE behaviour
(`:103-109`). They go RED the moment the leg lands. This item used to say "take the todo off when the
leg lands", which is now exactly inverted: the job is to flip a green row to red-then-correct, and a
session that reads the old instruction will see its own working leg as a regression and back it out.

- **C#**: when the server answers a `Tile` reference with the reference's own position, the product
  hands back the ENCLOSING helper class and renders its five members under `to build a Tile:`. That
  is a false statement the model then follows, and it is the worst of the three.
- **TypeScript and Python**: no by-name workspace-symbol leg, so a type the server will not point a
  definition at is unreachable even when it is defined in the same workspace. C# has one
  (`csLspExtractor.ts:554`) and so does Go since v40 (`goLspExtractor.ts:385`); this bullet used to
  name C# alone. Two languages need the leg, not three.
- The fixture is a deliberate trap and is already written: `Tile` lives in another file, the helper
  class shares no member name with it, so which tree a resolution reached is always decidable.

### 7. Rust has injection and zero enforcement - the last such language

**Ratified 2026-08-16: this BUILDS, it is not struck, and its remaining scope is the Rust carve-out
alone.** Two of the three bullets this item used to carry have shipped, which is why it moved out of
the long tail: what is left is small, scoped and has a written ship gate.

The problem, dogfood-proven: with a clean injected member list in front of it, the model still wrote
`s.add_tile_by_morton(...)`, a method that appears nowhere in that list. Nothing checked.
**UNVERIFIABLE** (C211, C218): that capture is on no disk - the method name survives only in this
file and in dictation pastes echoing it - so the no-dot-typed state behind Trap 2 cannot be read off
anything either. A fresh Rust dogfood capture re-witnesses the class in one sitting, and the v18
capture inventory records sibling cases (`s.try_rehome`, `s.insert`) that make the class itself
uncontroversial.

Why Rust is carved out today, and it is a decision the code calls permanent:

- The gate covers **four** languages, not three: TS identifiers, C#, Python and Go
  (`src/vscode/completionProvider.ts:715-721`, Go since the v23 scout). Rust is the one carve-out
  (`:705-708`).
- rust-analyzer serves keyword/postfix completions at a dot (`.await`, `.if`).
- The extractor drops those, so Rust's member list is incomplete by construction.
- A gated Rust once suppressed `.await` for exactly that reason, and it was turned off. That is the
  origin of the carve-out and the whole of the risk here.

**The human's ruling, and the reasoning, because the tempting move is to strike this item.** The
answer to a suppressed `.await` is to handle that edge case, not to leave Rust permanently dark.
Rust strikes out invented members like the other four languages. Keep the dropped keyword and postfix
labels as members that are never rendered, so the gate's legal list is complete while the prompt still
shows only callable ones, and handle the `Future` receiver that rewrites all 127 labels as
`await.`-prefixed noise.

**The deadline decouple this item proposes is already built** - it was presenting shipped work as
future work. The 50ms `INJECTION_DEADLINE_MS` still bounds the PROMPT block
(`src/core/completionService.ts:28`), but a slow resolver's member list is no longer thrown away: the
promise is kept past the race ("Promise.race does not cancel the loser", `completionService.ts:508-530`)
and the gate awaits the same query under `GATE_DEADLINE_MS = 500` (`:42`, `:726-734`). Built in v18
phase 3. So the gate is not blocked on latency plumbing; it is blocked on the legal-list question
above and nothing else.

**Red-before-green in BOTH directions is the ship gate.** An invented name is suppressed, AND `.await`
still works. The second is the regression that turned this off last time, and a session that only
writes the first test will ship the same defect again.

Two traps from the scout, both still live:

- False suppression on membership measured 0 of 196 real sites. PROVEN. The author's real method was
  never missing from the list.
- The motivating capture had no dot typed yet, so the gate as designed would not have caught that
  exact case. The goal must say so rather than claim the capture as its falsification.

### 19. A remote Ollama is gated on the local box's VRAM, so pointing at a GPU server disables fn-gen

Filed as "Ollama but custom", a UX wish. It is not one. Ratified 2026-08-16 as a live LOCKOUT with a
minimal fix. REASONED: read off the code below, not run. Promoted to a numbered item the same day -
it had been an unnumbered paragraph sitting after item 18's bullets, in neither the index nor the
History gap list, so the file's own "a gap means it shipped" rule could not classify it either way.

**The transport is already there.** `column80.apiBase` (string, default `http://localhost:11434`,
`package.json:354-358`) is the base of every Ollama request: generate at `src/core/ollama.ts:188`,
tags at `:312`, pull at `:377`. Self-hosted non-Ollama servers are separately covered by the
`openai-compatible` provider (`package.json:378`) plus `column80.cloudApiBase` (`:397-401`). Pointing
the extension at a company GPU box is one setting away.

**And it does not work, for a reason that has nothing to do with the transport.** A non-default
`apiBase` still falls through to `resolveTier`, which probes the LOCAL machine
(`src/core/hardware.ts:102`, `parseNvidiaSmiVram`). So a laptop pointed at a reachable, idle GPU
server is told there is no usable GPU. And where the tier does resolve, `applyTier` substitutes the
local VRAM row's model unless the user has set `fnGenModel` explicitly (`src/core/tiers.ts:170`,
`explicitFnGenModel ? config.model : rowModel`) - so the model override bites the user who took the
default, and the tier gate bites everyone. The product measures the wrong machine and then acts on
it.

**The fix, scoped deliberately small.** `buildFnGenService` already carves two backends off the
hardware table: `claude-code` and `cloud` short-circuit before `resolveTier` ever runs
(`src/vscode/fnGen.ts:1086-1092`). Give a non-default `apiBase` the same treatment as an off-table
`remote` tier: no hardware probe, no model override, `[carve] tier=remote` on the channel, and fail
CLOSED on an unreachable host with a message that names the host rather than the GPU. Queue entry Q26
carries the mechanical form and its falsification.

**What this deliberately does not buy.** The wider self-hosted story - the setting's own description
still says "local Ollama server", `startOllamaTerminal` spawns a local server, the first-run flow
pulls a model onto this box - is untouched. Those are honest-but-local, not broken. One fail-open arm
is the whole item.

## 2. Trust the instruments, before building on them

This tier's origin: two independent rig defects turned up in one session and each had been silently
wrong for months. A number from the harness is a hypothesis until the instrument that produced it has
been looked at, and most of what sits here is blocked on taking a number rather than on a design
call. Three are not - 42's static-C# receiver, 46's row re-cut and 51's `preparedDoc` change are
builds - but each of those is an instrument or a measured remainder, which is why they read here
rather than in tier 3.

### 43. Nothing measures how often a real session overflows the context window

**The build shipped; what is left is the measurement, which is why this is no longer a "fix now"
entry.** Session-v48 phases 2+3 built the guard. `src/core/promptBudget.ts` holds the decision
(header: "session-v48 phase 2 ... roadmap item 43"), `FnGenService.generate` arbitrates
exempt / fits / shrink / refuse (`fnGenService.ts:290-294`), and `generateRaw` / `generateTests`
refuse a finished prompt that does not fit, which closed the last three paths: the punt circle-back
retry, repair, refine and test-gen were all still unguarded after the first build. The channel lines
exist too, with full token accounting (`promptBudget.ts:433-439` refusal, `:447-455` shrink); the
fits case stays silent on purpose (`:168`, "the overwhelmingly common case fits at full size").

Two sentences this entry used to carry are now false and are struck rather than amended: "there is no
prompt-versus-window guard anywhere in the product, on any path", and "no indicator, anywhere". The
build was also overtaken by the human's later ruling: where a prompt does not fit at all the product
refuses and says why (`session-v48/contract-phase2.md`), not the softer channel-line-only shape this
item first proposed.

**What survives, and it is the whole item now: how often does a real session actually overflow?**
Nothing has run. If the answer is never, the guard is cheap insurance and this entry closes. If it is
common, the budget itself needs revisiting, and `GEN_NUM_CTX = 16384` is measured at 12.4GB VRAM on
the 16GB carve, so raising it is not free. Decide first whether that frequency is worth an instrument
at all; it is a question about real sessions, and this product has no telemetry by design.

**The mechanism, which is what the measurement is measuring and is unchanged.** `GEN_NUM_CTX`
(`src/core/budgetProfile.ts`) bounds the prompt AND the generation together, and `ollama.ts` says what
happens past it: "a prompt over that is silently truncated to fit" (`src/core/ollama.ts:150-152`).
That is not a reading. Three prompts of 12.9KB, 13.1KB and 15.0KB all landed on exactly 2050 prompt
tokens with nothing logged, recorded in the code itself at `ollama.ts:152-155`. Raising `num_ctx`
moved the ceiling; it did not add a check, which is what the guard then added.

**The reasoning worth keeping, because it is what made the guard non-negotiable.** Truncation eats the
HEAD of the prompt. On a captured fn-gen prompt the head is the instruction and the injected type
surfaces, and the doc and signature sit at the tail. So adding context made the model receive LESS
injection, and it still answered from the bare signature, confidently. The developer's action produced
the opposite of what they asked for and nothing said so. That is the product quietly discarding its
own core value, and it is the shape to watch for anywhere else a silent limit exists.

And the developer cannot arbitrate it alone, which is the other half of why silence was the defect:
prefill surfaces, member lists and repair surfaces add bytes they never wrote, so someone who adds two
context blocks can be tipped over by bytes that are not theirs. That still holds
(`promptBudget.ts:9-11`).

One correction to that half, from the sweep. Context blocks are still SHRINK-exempt by the human's own
rule ("Their context shrinks nothing; ours shrinks to fit", `promptBudget.ts:14-16`), but they are now
COUNTED: `developerTok` is in every arbitration (`:226`, `:230`) and is named in the refusal and
shrink lines (`:435`,
`:450`). "The product actively does not count the thing most likely to overflow" was true when this
item was filed and is not true now.

### 41. The tuning constants were chosen for a local 30B and now gate a frontier model

Audited 2026-08-08 in full (`session-v45/constants-audit.md`, a ledger of every tuning knob on the
injection path with a provenance verdict each). The structural fact behind the whole item:

**The premise moved under this item, and that is now part of the finding.** As filed, it said prompt
assembly is provider-blind and `readFnGenConfig()` takes `maxTokens`, `numCtx` and `temperature`
straight off `DEFAULT_FNGEN_CONFIG`. Two of those three no longer do. `readFnGenConfig()` reads
`maxTokens` and `numCtx` from the ACTIVE class's budget-profile cell
(`src/vscode/config.ts:187-194`, `budgetProfileFor(fnGenModelClass(), "", injectedContextStop())`);
only `temperature` still comes off the default object (`config.ts:202`). A named cloud provider
resolves the `frontier` class (`src/core/budgetProfile.ts:46-49`) and gets
`FRONTIER_MAX_TOKENS = 64000` (`:248`, `:253-257`), not the local 2048. **No supersessions entry
covers that change**, which is why an item at the head of the instrument tier spent a release
describing a product that had already moved. It is the same failure this whole register was rewritten
for, caught in miniature.

What still stands, and it is enough to keep the item: no SETTING overrides any of the three, the
cloud arm still spreads `readFnGenConfig()` (`src/vscode/fnGen.ts:1108`), `numCtx` and `temperature`
are still shared across every backend, and every one of those numbers was picked against
`qwen3-coder:30b` at `num_ctx=16384` on a 16GB carve. "The serving knobs nobody can reach" under
Deferred fixes discusses all four as ollama knobs only.

**Re-audit before any arm.** The ground moved once without a record, so the first job is to check
whether it moved again, not to run 41a.

Three sub-items, ranked by (drift risk x cost if wrong):

**41a. `DATASHAPE_TOTAL_TOK = 300`, measured through the CLOUD backends.** The one constant whose
provenance is admitted folklore - the "~350-token codegen knee" that sizes it comes from external
literature via an early scout and not from this product, which the constants ledger states in as many
words (`docs/constants.md:29-30`, the INHERITED class) - and whose cost is now measured. On 465 authored-doc C# rows, 300 -> 900 takes injection 16.4% -> 31.6%, and 330 of the
421 surviving-but-not-injected types die here, more than anchoring (68) and everything else combined.
The mechanism to move it per-language SHIPPED in v45 phase 3 (`CS_BUDGET_FACTOR`, currently 1) with the
value deliberately unchanged, waiting for a generation arm. The arm nobody has run is the cloud one: if
the knee is a property of small local models rather than of codegen, it should not appear there.
`numCtx`'s own comment supplies the motive - real prompts run p90 ~1,295 tokens against a 16K local
window, so nothing is context-bound.

**41b. `maxTokens = 2048` on the two cloud backends - SUBSTANTIALLY MOOTED, kept for the residue.**
The defect as filed is gone. 2048 is the LOCAL ceiling now: `GEN_MAX_TOKENS = 2048`
(`src/core/budgetProfile.ts:230`) serves `fim-small` and `local-mid`, and the frontier class, which
is both cloud backends, gets `FRONTIER_MAX_TOKENS = 64000` (`:248`, `:253-257`) - added precisely
because 2048 capped thinking plus answer. It was never a defect on the claude-code CLI backend, which
exposes no budget knob and ignores it either way. What remains is one cheap number nobody has taken:
the `length` finish rate on `fnGenProvider: anthropic` at the new ceiling. The product degrades
honestly when it happens (a `length` finish is refused, never spliced), so this is a curiosity, not a
blocker. Rank it last.

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
from the type cap (`fnGen.ts:2341-2361`; `resolved.symbols` is read through `enclosingContainer` at
`fnGen.ts:3304`). Absent `symbols` it degrades to nothing, silently. The
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

**UNVERIFIABLE, every number above** (C77, C78, C79). The v34 arm chain is deleted from this box:
`compare.cjs`, `handover.md` and `data/v34-after.json` are all gone, and `session-v34/` keeps only
`session-state.md` and two witness scripts. The 11.2% / 39.7% byte deltas, the 1-to-3 witness output
for `acme_crypto::create_ca`, and the 16.0-to-13.8 / minus-four pair have no artifact left. What
would settle them: re-run the v34 item-1 arm with its compare, and re-run
`session-v34/witness-prefill.cjs` on the same task. Neither is one command - the witness needs
`lib-cargo.cjs` and `candidates.json`, both deleted, so the rig comes first. The third arm below is a
different population (237 tasks against these 181 rows) and does not produce these numbers as a
by-product.

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

**session-v51 gave this item its number, and it raises the stakes.** Go's pre-fill gate was re-run on
both sides of a gather-breadth bound: p95 148ms and 139ms against a 118ms gate, down from 192ms and
208ms, so Go still misses at about 1.2x. The residue is no longer distributed. Across 20 rows the
per-primitive decomposition is **settle sleep 869ms, hover 210ms, members 80ms, definition 44ms**, and
six rows sit at 120 to 126ms of sleep over 1 to 22ms of real server work.

Derived from the measured columns of the same four runs: **with the sleep at zero the after side reads
p95 71ms and 53ms**, a pass with margin, and the before side reads 68ms and 84ms. **The settle
allowance is what fails this gate, on both sides of that build**, so no amount of walk work reaches it.

So the decision this item blocks is now the only thing standing between Go and its gate.

**Ratified 2026-08-16: keep the bound, build the cold probe, and Go's gate stays failing until it
exists.** Do not cut the sleep on the warm numbers. Fix the three warming defects named above
(`assertAlive`'s vetted gate cursor, `rootsFrom`'s `perFile = 3`, `makeOpener`'s run-long `opened`
set), get a real cold row, and delete or keep the `membersWithSettle` loop on that evidence. Go
missing its gate at about 1.2x is an accepted cost with a date on it, not an oversight anybody needs
to re-diagnose. Anyone reading Go's red row should read this paragraph and stop.

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

### 47. Python's pre-fill gate has never been decomposed, and its last number was 7.8x

Raised 2026-08-11 by session-v51, which was sent to decompose it and did not. PROVEN miss, unknown
cause.

v50 measured Python at p95 1957ms net against a 250ms absolute gate. The shape of the cost is known
one level down and no further: Python's leg is not hover and not sleep, it is cross-file
`definition()` into files pyright has not seen, with nine discovered-file opens across eleven rows and
one row spending 603ms in two hover calls on a freshly opened file.

Every other language's gate got a per-primitive decomposition and Python's did not, so it is the one
gate where "a miss is a defect report, not a decision" has no report behind it. Go's equivalent work
found that the headline primitive was not the one anybody expected: "26 hovers cost 121ms" turned out
to be a count of cold PACKAGES, not of round trips. Assume nothing about Python's until it is measured.

The instrument exists (`session-v50/probe/latency-baseline.cjs py`) and inherits item 45's limit: it
measures warm.

### 48. The injected surface carries no imports, and that is now Python's largest failure family

Raised 2026-08-11 by session-v51. PROVEN on a compile-graded arm.

With the enclosing type in the prompt, Python function generation goes from 15 of 40 compiling to 35
of 40, and the invented-member family collapses from 21 to 1. What survives is imports: 3 of the 5
remaining reds are a name the body needs and the file does not import (`contextlib`, `FileResponse`,
`run_server`).

The surface names types and members. It does not say where they come from, and the model cannot infer
an import it was never shown.

**And the hole is wider than this item first claimed.** The Rust masking is not real on this surface:
the use-path leg (`src/core/usePath.ts:116-141`, `renderImportHint`) is TEST-GEN only - it fires just
when `opts.importTargetPath` is set (`fnGen.ts:2881-2890`, "The import hint (test-gen only)"). So the
fn-gen pre-fill carries no import payload in ANY language, Rust included (`fnGen.ts:2230-2233`,
"fn-gen omits it"). What masks it in Rust is something else and weaker: a generated body usually lands
in a file whose imports already exist, which is the code's own stated reason. Python is where it was
MEASURED, not where it is.

Not a cap and not a budget. It is a missing payload, and it is measurable the day someone builds it:
the same 40 rows, one arm, and the same span-scoped verdict.

### 49. The count cap's server justification is measured false on Python and untested on TypeScript

Raised 2026-08-11 by session-v51. Half PROVEN, half unmeasured, and the unmeasured half is the one
that matters.

The hover fan-out is time-bounded already: `withinBudget` races every ask against a 50ms deadline. The
count cap survives on top of that because the race abandons the RESULT and not the WORK, so abandoned
requests stay queued against a server that answers one thing at a time. That was reasoning, never a
number.

Measured against a real pyright: a 400-hover fan-out costs 13ms, so the deadline never cuts, nothing
is ever abandoned, and the next request costs 0ms whether 4 or 400 asks preceded it. The hazard is
unreachable on that server at any population, real or synthetic.

TypeScript is the other fan-out language and is the slower server, cold first calls at 33ms and 51ms
against Python's flat 10-14ms. It is where a deadline would cut first, and it was not measured,
because its fan-out lives in the vscode transport and needs a real extension host. The headless
`TsLsExtractor` reads the checker directly and asks no hover, so no headless row can produce the case.

A `test:vscode` tier measurement. Until it runs, the cap stands on population sizing alone, and the
constant's own comment says so.

### 50. The gather buys a hover for every collaborator the render drops, and only Go was measured

Raised 2026-08-11 by session-v51. PROVEN in Go, unmeasured in the other four.

Over 20 real Go roots the gather resolved 117 types and bought 117 hovers; the render kept 63 solo and
14 inside a real 8-root prompt. 31 of the 117 sit outside `walkDataShape`'s own BFS at ANY budget,
because the render walks at most `B_MAX` distinct local field types per node and the gather walked all
of them.

Go got a commit-counted breadth bound on the gather: round trips down 26%, and 0 of 20 roots changed a
byte of surface. C# is provably ineligible, because `csShapeBlock` gives every gathered type a member
block, so nothing it gathers is wasted. Rust, TypeScript and Python were not looked at.

The waste is structural rather than Go-shaped, so the prior should be that it is there. What is not
known is the size, and a bound shipped without measuring a language's own surface is how a render
loses a type nobody was watching.

### 51. The arm runner has no Python entry, and one function is why

Raised 2026-08-11 by session-v51. Instrument, not product.

`session-v46/run-arm.cjs` carries `cs`, `rs` and `ts` in `LANG_DEFS` and everything else in it is
language-parameterised. `preparedDoc` is not: it writes braces around a hole and replaces a doc
comment above the declaration, and Python's docstring lives INSIDE the body. Changing it touches an
instrument three languages' committed arms depend on, which is why session-v51 wrote a one-row driver
(`session-v51/run-row-py.cjs`) instead.

The cost of leaving it: Python cannot join a multi-language arm grid, so every Python number is
produced by a second code path that can drift from the one the other three are measured on.

## 3. The big builds

Each needs its own goal and scout. This tier used to claim it was ordered by measured value. It is
not, and cannot be: a third of the measurements behind these six no longer have an artifact on this
box. The order is the one the evidence justified when each was filed. Re-rank it the day somebody
re-runs the arms.

### 36. The budget was never the big hole. Resolution is: 69 real failures per run against the budget's 22

Counted 2026-08-03 (session-v39 scrap S39-8) off the 237-row prefill arm. Denominator is reasons
emitted per run: why a KEPT candidate produced no injected block.

**UNVERIFIABLE, the whole table** (C119, C120). S39-8 was archived on the sessions branch, and that
branch was scrubbed on 2026-08-10 after the client-source leak. It exists in no local or remote ref;
`session-v39/` retains `run-arms.sh` and nothing else. The counts below are a recitation of a file
this box cannot open. What would settle them: re-run the 237-row prefill arm and re-count its reasons.
That is also the cheapest way to get a fresh baseline, so the scout should plan on producing the
number rather than quoting it.

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

**UNVERIFIABLE, every row of that table** (C123, C125, C126). The v37 data chain is gone from this
box: `candidates.json` for acme-db is missing, there is no 117-row contoso artifact and no TypeScript
file, and the surviving `candidates-oss.json` holds 183 rows against the table's 416. 83.8% is recited
in two session files and backed by none. The SHAPE of the finding is what survives and it is not in
doubt, because the cause below is a fact about the code rather than a measurement. The numbers are
not. What would settle them: re-run the two-corpus oracle and the five-corpus spike. The Go half has
a cheaper path - `candidates-go-wide.json` is on disk with 7,185 rows and supports a fresh ceiling
census under the current recipe.

**The cause needed no further measurement, and it has since half-closed.** As filed: `csPrioritizedTypes`
and `goPrioritizedTypes` had FOUR candidate legs where Rust and TypeScript have five, because neither
mines imports. Today `goPrioritizedTypes` has five (`fnGen.ts:4686-4713`, including
`goTypesFromQualifiedUsage`) and `csPrioritizedTypes` four including `csTypesFromQualifiedUsage`
(`fnGen.ts:4037-4067`) - the item's own v40 amendment below is that change. The half that still
stands is the reason the leg was missing in the first place: a Go import line carries a package path
and a C# `using` carries a namespace, so neither line ever spells a type name (`fnGen.ts:4071-4076`,
`:4717-4721`).

**This is a build item with its own scout, and the two languages need different mechanisms.** Do not
assume one leg serves both.

Two things from session-v37 that bear on it:

- The backtick gesture is now the only channel these two languages have, and session-v37 widened it so
  that `` `*Config` ``, `` `http.Client` `` and `` `Contoso.DataModel.Widget` `` all resolve. Before that
  widening it refused **79.8%** of how Go spells a type in a real signature. **UNVERIFIABLE** (C129):
  only a code-comment recitation survives (`src/core/compilerDirected.ts:1112-1116`); the raw v37
  spelling census is gone. A fresh spelling census over the Go corpus would check it.
- A widened gesture still has to ANCHOR. Go and C# have no import leg to anchor against either, so 82.5%
  of Go and 87.2% of C# named types have no per-file anchor at all. C# partially recovers through
  Roslyn's workspace-symbol leg (`src/core/csLspExtractor.ts:554`), and since v40 so does Go
  (`goLspExtractor.ts:385`), which is a correction to this bullet's "Go does not recover".
  **UNVERIFIABLE** (C130): the two percentages appear nowhere on disk outside this file. A re-run of
  the anchor census would check them.

**Amendment, 2026-08-04 (session-v40, shipped 1.2.0). The missing leg is built, and the item shrank
rather than closed.** `goTypesFromQualifiedUsage` and `csTypesFromQualifiedUsage`
(`src/core/repairTypes.ts`) mine qualified references (`pkg.Type`, `Namespace.Type`) out of the
signature and body, correlated against the file's own import block so a lexical look-alike on a local
variable is refused. Go also gained the by-name workspace-symbol anchor C# already had
(`GoLspExtractor.resolveTypeCursorByName`), so a candidate with no local anchor is no longer a dead end.
Measured on the new Go rig: ceiling 5.5% -> 7.6% across 2,890 functions. C# flat at 2.6% on the one
corpus - mechanism built, no effect measured there. **UNVERIFIABLE** (C133): no 2,890-row artifact
survives, and this item's own v42 amendment below calls the 5.5/7.6 pair unrecoverable in recipe. A
fresh ceiling census over `candidates-go-wide.json` (7,185 rows, on disk) would produce a comparable
number under the current recipe.

One finding still gates any Go supply figure, and one has closed:

- **S40-3, open**: the candidate leg admits mostly NON-types. Sampled cobra file: 3 real types in ~29
  mined names, because every exported Go identifier capitalizes. It fails SAFE (the container filter
  refuses a non-type hit) so the harm is cost and dilution, not correctness - but part of the
  mined-candidate gain is noise, and each miss burns a live workspace/symbol round trip. The cheapest
  lever, refusing a mined name immediately followed by `(` before the lookup fires, SHIPPED with the
  v42 corpus below; what stays open is the residual dilution.
- **S40-1, closed**: the 22 unfiltered generated-file rows (stringer output) are gone.
  `01-corpus-go.cjs` no longer exists, and the two corpus files on disk prove the fix arithmetically -
  `candidates-go.PRE-FILTER.json` holds 4,017 rows against `candidates-go.json`'s 3,995, which is
  exactly the 22 removed. Record at `session-v40/scraps.md:3-14`. The populations-under-different-flags
  caveat therefore applies only to numbers taken before that filter, which is every number in the
  table above.

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
when the target's own signature or body names it. REASONED, session-v34 - read, not run.

Deliberately not swept from Rust, because it is a decision rather than a copy: a Go import names a
package path, not a type, so "anchor at the import line" does not mean the same thing in all five.

Related and already fixed in v34: the RUST and TYPESCRIPT scans tested each line in ISOLATION for a
leading `use`/`import`, so no type from a rustfmt- or prettier-wrapped group could ever be anchored -
the dominant shape in real code. Measured on `acme_crypto::create_ca`: injected types went from 1 to
3 once fixed. **UNVERIFIABLE** (C143): no artifact carries that 1-to-3 count; `session-v34/` keeps only
its witness scripts and `session-state.md`, and what survives is a prose relative in the source
(`fnGen.ts:3442-3444`). Re-running `session-v34/witness-prefill.cjs` on the same task would check it.

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
- **Go's design call is answered, so do not re-open it.** This bullet used to send the scout to decide
  Go's shape hooks first. It is settled: `goShapeHooks` is Go's own (`crossFileShape.ts:613-640`) with
  the `parseGoHoverFields` field leg lit in v49, its own `GO_STD_TYPE_NAMES` stop set and a
  qualifier-aware `skipCandidate`, and it is wired on the pre-fill path (`fnGen.ts:4891`). What is left
  for Go here is the provenance test itself, the same as the other three.
- **The measurement arms exist for one of the four now.** Session-v40 built the Go arm over cobra, gin
  and hugo, scored through the product's own `goOracle`, reproducible at a ~1.7% spread across two runs:
  `candidates-go.json`, **3,995 rows** (the 4,017 figure this item used to quote is the pre-filter copy,
  `candidates-go.PRE-FILTER.json`; see item 34's S40-1). The runner that produced it,
  `05-inject-run.cjs`, is no longer on disk, so re-running the arm means rebuilding the driver.
  TypeScript, Python and C# arms are still unbuilt, and S40-3's dilution finding still gates the Go
  numbers.

  AMENDED 2026-08-08 (session-v45 phase 0/1): **C# now has a corpus on the box.** Five pinned OSS
  repos at `~/sandbox/v43-corpus` (Autofac, seq-api, serilog, NodaTime, Polly), 2,100 candidate
  methods scored through the product's own `csOracle`, gated both directions per repo. `lib-cs-scan.cjs`
  and `lib-cs.cjs` are on disk; the corpus builder that sat beside them is not, so the rig is one file
  short of a re-run. contoso is the held-out private row (168 candidates). Two of the five repos carry
  a recorded local build fix (S45-1, S45-6).

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

**UNVERIFIABLE, both of those numbers** (C151, C154). The 224/224 and 29/29 pair has no artifact -
`session-v37/spike-10-elision-rust.txt` is the PRE-build capture and still renders
`Complete( /* … */ )` - and the raw v39 arm data is gone, with 56-against-47 surviving only as
recitations at `CHANGELOG.md:191` and `:244`. The MECHANISM is not in doubt; it is in the tree and
widened. The rates are. Re-running the elision arm and the 237-row prefill arm would check them, and
whoever builds Go or C# below is running an arm anyway.

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
`enumMemberLine` is the hook that exists for exactly this and at the time it was set for C# only. One
hook entry, against a hole the code already documents by name. (Cite refreshed 2026-08-15: the hook
field is `crossFileShape.ts:448`, with the C# implementation at `:512` and the Python one this
paragraph records at `:583`. The old `:351` cite now lands inside `candidateTypesOf`.)

**Go second.** A Go enum is a named integer type plus a package-level const block, and gopls hovers the
type alone. cobra's `ShellCompDirective` injects one line and one member while the eight directives a
caller must name are nowhere. Rust at least prints the variant and hides its payload; Go prints neither.
Frequency: 23 of 93 named non-struct types in cobra, gin and hugo carry a typed const set, 24.7%,
declaring 166 constants. Same order as Rust's 50.0%, and it lands on the language item 34 already calls
supply-starved. Build it after Rust and reuse the definition-source walk item 5 built.
**UNVERIFIABLE** (C161): 23-of-93, 24.7% and 166 appear nowhere on disk. A typed-const census over
cobra, gin and hugo would check them, and it is cheap - those three repos are pinned clones the Go rig
already uses.

**C# last. The frequency is now measured, and it is still small.** A C# ENUM is fine: Roslyn hovers it,
documentSymbol returns the variants, and the `enumMemberLine` hook already spells them
`ThreatLevel.Minor`. A POSITIONAL RECORD is not: hover gives the qualified name only and
`membersOfType` returns nothing, so `record StripeSummary(int Aggregate, ...)` reaches the model with
its constructor invisible. **UNVERIFIABLE, the record-probe half** (C163): the probe artifact behind
"hover gives the qualified name only and `membersOfType` returns nothing" is not on disk, and v38's
`membersOfType`-empty probe is the TRAIT one, a different case. The frequency half below is separately
backed. Re-probing a positional record against Roslyn would check it, and that is the first step of
building the fix anyway.

AMENDED 2026-08-08 (session-v45 phase 1). The "one row of frequency" caveat is retired: a Roslyn
semantic census over five pinned OSS repos (Autofac, seq-api, serilog, NodaTime, Polly - 2,100
candidate methods) counts **10 positional records**, and contoso declares **1**. So the hole is real
and the frequency is genuinely low across 2,268 methods of real C#, not merely unmeasured. That is an
argument for keeping C# last, not for closing the item: the render is still wrong where it fires.

**TypeScript needs nothing.** Unions render verbatim, including a 178-byte discriminated union with its
payload objects intact. An interface hovers bodyless but its fields arrive through the member list.

### 37. The worked-example leg quotes the wrong docs on 80% of its blocks

**UNVERIFIABLE in full, and this item has no other evidence** (C166, C167). Everything below was
counted in session-v39 scrap S39-3, which lives on the sessions branch that was scrubbed on
2026-08-10; `session-v39/` retains `run-arms.sh` and no arm rows, and the only session branch on this
box carries no v39 path. So the worked example, the 35-of-44 and the 40-of-49 are recitations with
nothing behind them. What would settle it: re-count usage-example blocks that never name their own
type over a fresh 237-row arm. That is the same arm item 36 needs, which is why these two are siblings
and should share a session.

Counted 2026-08-03, found while validating v39's phase 3, not while looking. A
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

### 53. A ratified test suite passes against a body replaced with `{ 0 }`

PROVEN 2026-08-12, on one function, and the proof is two minutes of work anybody can repeat. This
entry existed as an index line and nothing else until 2026-08-16; its argument had been living inside
item 13's amendment and in `docs/ideas.md`. Both are committed, so nothing here is new evidence.

**The function is `trim_out_client_sets`**, written up at `docs/dumb-models-work.md:360` (the `{ 0 }`
stub), `:345` (the 406-byte fixture arithmetic) and `:325` (the qwen suite itself). The register spent
four days carrying its strongest recent finding as an unactionable one because nobody wrote the name
down.

It enforces a 4 MiB cap. Asked for tests blind of the implementation, `qwen3-coder:30b` produced five
scenarios whose largest fixture serialises to **406 bytes**, off by a factor of roughly 10,300. Every
scenario therefore sits under the cap, `0` is the truthful expected value for all five, and the human
typing `0` five times was typing the right answer every time. The model's own comments name the intent
it could not build: `// Both sets trimmed` sits beside an assertion that zero were trimmed.

Replace the body with `{ 0 }` and rerun: the qwen suite passes, the `gpt-5.6-sol` suite fails on its
second scenario. Both suites pass against the real implementation, so a green board does not
distinguish them.

**Why this is structural and not a model-size complaint.** Implementation from a spec is translation:
the doc comment names the shape, the injected surface names the tools, and a 30B renders it fine, five
rounds running. A test from a spec is adversarial construction - you have to invent inputs that reach
the states the spec describes. Nothing in the injected surface says `SUMMARY_PAYLOAD_MAX_BYTES` is 4
MiB, that reaching it needs tens of thousands of entries, or that one `Option<Vec<u64>>` field is a
cheap lever on `wire_size()`. Sol found that lever and wrote a doubling search plus a binary search to
land the payload just over an arbitrary target. Qwen did not, and defaulted to what compiles.

**The blanked-expected-values rule cannot save this, and that is the sharp part.** Ratification worked
exactly as designed. No wrong value entered the suite. The suite is still worthless.

Two candidate builds, not exclusive:

1. **Refuse rather than emit.** The classifier already refuses async, IO, needs-fixture and
   underspecified. A threshold function whose fixture must span orders of magnitude is arguably the
   same category, and refusal is the product's existing answer to "cannot do this honestly".
2. **Supply the constants.** The doc comment names `SUMMARY_PAYLOAD_MAX_BYTES` and the injected
   surface does not carry its VALUE. A const-value leg is small and deterministic, and would at least
   let a model know what magnitude it is aiming at. Scout whether that alone moves fixture quality; it
   is much cheaper than the alternative.

Detection belongs to item 13, whose amendment ranks a single trivial-return mutant first for exactly
this reason. This item is the defect; 13 is the instrument that would have caught it.

### 54. Injection walks downward only, so no caller-direction fact ever reaches the model

Raised 2026-08-12 from the same session. REASONED, from the injection log of four real generations.
Like item 53, this carried an index line and no section until 2026-08-16; the reasoning below is
lifted from `docs/ideas.md`, which is committed.

The pre-fill walks INTO the enclosing type: its fields, its nested types, their public members,
roughly depth 2 inside the token budget. Every failure in that session's round table that was not a
spec defect was a fact living in the other direction:

- the function runs inline on a single-threaded executor, so an O(n) call inside its loop stalls the
  event loop
- the vec it iterates is sorted and binary-searched by a read path two crates away, so plain
  iteration order is a permanent per-tenant bias

Neither is reachable at any depth downward. The frontier model missed both exactly as the 30B did,
which is the evidence that this is an injection property rather than a capability one.

Today the answer is that the human writes those facts into the doc comment, and that works. The open
question is whether any of it can be supplied deterministically, and it is genuinely open because the
obvious version is expensive:

- **Callers** are a reference query the language server can answer, but rendering them costs budget
  that item 41a says is already the binding constraint, and most callers are noise.
- **Enclosing-file or module doctrine** is cheaper and blunter: a crate- or module-level comment
  stating "this path runs on the shard executor", injected for every function in it. That is a
  convention the way item 34's Go answer became a taught convention, not a resolver feature.

Scout the second before the first. And price it first: how often does a real generation fail on a
caller-direction fact rather than on a spec defect? On the session's evidence it was one round of
five, and one function is not a rate.

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
repair injecting a surface that could have been known up front? Measure that "info exists, one round
late" rate before building anything.

**"Countable today" is no longer true, and that is a real cost to this item** (C171). The rate was
countable off `session-complxity-research/data/v34-after.json`, a 181-row arm with round-0 and repair
errors recorded per row. That file is deleted and the whole measurement chain around it went with it.
The question is unchanged and still the right first move; what changed is that answering it now needs
a fresh arm rather than a query over something that already exists. Price the scout accordingly.

**What session-v34 adds, 2026-07-30. Read this before scouting; it moves the odds.**

Item 1 was the last serious attempt at picking types better by heuristic, and it was measured and
REFUTED. It excluded standard-library roots on provenance, freed their slot in the type cap, and cut
injected bytes by 11.2% overall and 39.7% on its own 24-task subset. Compile rate went 16.0% to 13.8%
across 181 rows, total errors 688 to 733. No effect, and if anything slightly worse.
**UNVERIFIABLE** (C169): the v34 arm's data files are all deleted, so every number in that paragraph
is a recitation. Item 30's third arm is the check, and it is filed there. The REFUTATION is what
matters here and it does not depend on the exact figures: nobody has produced evidence that better
heuristic picking moves the rate.

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
names wrong. **UNVERIFIABLE** (C170): that capture is on no disk. A live fn-gen plus repair round on
`acme_crypto::create_ca` would re-witness it, and the class is common enough that any fresh capture
will do.

The counting rule survives and is the one to run against a fresh arm: count the rows whose round-0
errors are all `unresolved-method`, `unresolved-assoc` or `unresolved-field` against a type the repair
round then resolved.

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

What is Claude-specific and must be rebuilt per CLI, all three of them small: the argv (today
`BASE_ARGS = ["-p", "--output-format", "json", "--strict-mcp-config", "--tools", ""]` at
`claudeCodeInstruct.ts:139`, where `--tools ""` was added so the CLI cannot go agentic, `:129`), the
JSON field names (`result`, `ttft_ms`,
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
  no user type, nothing to key on. **UNVERIFIABLE** (C182): that capture is on no disk. A live fn-gen
  round on a signature naming only std types would re-produce it in one gesture.
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
(imported at `completionProvider.ts:52`, called at `:777`), its own `usageExamples` switch at `:452`,
windows rendered below the signatures nearest the cursor, both the dark and the injected case logged.
What remains is the cheap half nobody ran.

- Today the prompt is rewritten to the highlighted member and injection narrows to that member's
  signature. The member is never named to the model on its own line.
- The work: measure that shipped narrowing against an explicit `selected:` prompt line. No such
  line exists in prompt.ts or fimInject.ts.
- Baseline from the v22 scout, 60 real call sites, 8 seeds: no injection 39-42%, selected
  member's signature only 76%, signature plus usage windows 78%. **UNVERIFIABLE** (C187): only
  `session-v22/harness/analyze-spike2.cjs` survives; its inputs and results are gone and session-v22
  was never committed. The arm this item wants produces its own baseline, so run both arms rather
  than trusting these three numbers as the "before".
- If the delta is real, the line is nearly free. A night, not a session.

### 10. The second call in a chain generates blind - RE-MEASURE, v27 covered part of it

The outcome as written stands: in `results.iter().map(|r| r.` the closure receiver's members are never
injected, and chained style - LINQ, EF, Rust iterators, TS functional - generates with nothing.

**The stated mechanism was wrong, and it matters because the fix hangs off it.** Injection does not
key on "the first dot of a statement". It keys on the dot AT THE CURSOR, and it requires a
plain-identifier receiver (`src/core/fimInject.ts:2`, and `:109-112` where a `foo().`, `arr[0].` or
bare-`.` receiver "we cannot name" is refused). Mid-chain dots die on the plain-identifier rule, not
on a first-dot rule. Anyone who built against the old sentence would have gone looking for a
statement scanner that does not exist.

v27's chain warm (`src/core/chainSurface.ts`) fixed an ADJACENT failure, not this one. Do not
read it as closing the item:

- What it fixes: Roslyn serves 115 items at a `List<Tile>.` receiver with no signature on any
  unresolved item, `Where<>` sits at position 113, and MEMBER_RESOLVE_CAP=32 never reaches it. A
  once-per-workspace background warm fills the missing signatures.
- That is members-present-but-signatureless. Item 10 is members-never-injected-at-all.
- The warm is C# only today (`completionProvider.ts:280`). Rust iterators and TS functional chains,
  the motivating cases, are untouched.

The standing instruction before anyone scouts this: re-measure the per-member-call invention rate
at second-dot sites on the current product, per language. The 7-8% flat figure predates the warm.
If C# moved and Rust/TS did not, the item shrinks to those two.

- TS2339 ("property does not exist") is the single largest error code in the whole compile
  spike. **UNVERIFIABLE** (C194): no error-code tally survives anywhere on this box, only the
  harness classifier code that would have produced one. A re-run of the compile arm with a code tally
  would check it, and the re-measure this item already demands is that run.
- Needs: element-type unwrapping at a collection receiver, plus a per-statement injection cache
  that outlives a single dot.

## 5. The long tail

Real, filed, and not urgent. Priority within the tier is unchanged.

### 8. Injection works on an idle box and vanishes on a busy one

The problem, measured under 28 CPU spinners, 20 warm keystrokes each. "Delivered" means the
facts reached the model:

```
C#  20/20     TypeScript  17/20     Rust  3/20     Python  0/20
```

That table is backed: the run is recorded at `session-v16/session-state.md:188-196` with the raw probe
logs at `session-v17/scout-logs/`, and `session-v17/scout-insights.md:18-28` re-measured the same arm
on this box (TS came out 18/20 there; the figures above quote the v16 run).

Two different failures, not one:

- TS and Python die on request COUNT: one keystroke fires hover requests in parallel against a server
  that answers one at a time (`src/core/extraction.ts:1072-1074`, "tsserver answers one request at a
  time"). **The count in this bullet used to say 8 and it is 32** - `HOVER_SIGNATURE_CAP` was raised
  in v21 (`extraction.ts:1095`, whose comment says "It used to be 8"), and the cost is now bounded by
  `HOVER_FANOUT_BUDGET_MS` at 50ms (`:1176`) rather than by the count. Which changes the busy-box
  question rather than answering it: a time budget on a server that cannot be cancelled bounds when
  the product stops WAITING, not how much work it queued.
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

**Amendment 2026-08-12: the family now has a PROVEN instance and a ranking, and property tests were
missing from it.** Item 53 records a ratified suite that passes against a body replaced with
`{ 0 }`. That took two minutes by hand and separated a real suite from a hollow one with no ambiguity
to argue about. The four techniques are not equal against it and shipping them as a bundle would hide
which one is doing the work.

1. **A single trivial-return mutant, first.** No framework, no `cargo-mutants`, no runtime question:
   one body replaced with `return Default::default()` and a rerun. It is the direct counter to item
   53, it cannot produce a false positive worth debating, and it retires the "is the runtime a
   nightly" scout question for the cheap case. Full mutation testing stays as scoped above; this is
   the rung that ships first.
2. **Property tests, and they are the gap in the list above.** The session's off-by-4 running-total
   drift survived every example test in the repo, and would survive coverage AND a trivial-return
   mutant. It dies instantly to a generated-payload invariant. Arithmetic drift is precisely what a
   small model produces from an ambiguous spec, so this is aimed at the failure item 52 documents.
   The design question it drags in belongs in the scout, not after it: if the human types every
   expected value, the human types the invariant too, and an invariant is harder to type than a
   scalar. That may be the honest reason this rung is second rather than first.
3. **Coverage, as a pre-filter only.** It WOULD have caught item 53's suite, because a 406 byte
   payload returns at the guard and leaves the sort and the loop unexecuted. It goes blind the moment
   a fixture reaches the code without asserting the outcome, which is the more common hollow test.
   (The function is `trim_out_client_sets` and the byte arithmetic is written out at
   `docs/dumb-models-work.md:345`. Until 2026-08-16 this register named neither, which made its
   strongest recent finding unactionable to anybody who had not been in the room.)
4. **Fuzzing stays off this rung.** The scoping above is right and the session confirmed it from the
   other side: the function under test parses nothing and takes no untrusted bytes. Its subsystem's
   real fuzz target is the sidecar deserialiser, where a torn file meets a CRC check and a version
   gate. **UNVERIFIABLE** (C227): the only evidence for that subsystem claim lives in a client repo
   this box does not read, so nothing citable backs it here. It changes no decision - fuzzing is
   ranked last either way - and a session with standing in that repo would settle it in a minute.

None of this reduces how much the developer has to think and it must not be sold that way. Green
currently tells them nothing, so suspicion spreads evenly over everything a generation produced. One
line saying *this suite survives a stub* collapses that into one place to look.

### 14. A failing test does not drive repair

The problem: fn-repair converges on compile errors only. A ratified test fails after accept and
the loop does nothing with it. The strongest oracle in the product is report-only.

The resolved safety design (never naive converge-to-green):

- The HUMAN assigns blame.
- "Impl wrong": fn-repair runs against the human-ratified test, hard cap, stop-and-surface.
- "Test wrong": the human re-types it. Test-repair stays banned.
- Gate unchanged: the v1 spikes measured wrong-value-assertion repair useless. That stands
  until beaten. The spikes themselves were deleted from the tree at `b124ffc` (2026-07-26) and
  survive in git history under `prior-art/spike-harness/` at `7d97d2d`; cite the history commit, not
  a working-tree path.

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

PROVEN 2026-07-30 on `acme-db/acme_crypto/src/pki.rs::create_ca`. **UNVERIFIABLE today** (C229, C230,
C231): the capture file is gone, so the two channel lines below, the `cargo test` result and the
DER-versus-PEM diagnosis are all recitations. What survives is a different run on the same function
(`session-v35/repair-g2.log:50`, a 156-row harness line). A fresh dogfood capture on `create_ca`
re-witnesses the class; the cargo-test rung itself needs the client environment this box does not
read. The FINDING does not rest on the capture - the compiler oracle structurally cannot see a failing
test, which is the item - but the vividness does, and vividness is what got this item filed.

The repair round ended:

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
`environmentError`). None of that needs building.

**One correction, and it is a hole rather than a detail.** This item used to say the runner reads
structured report FILES rather than stdout, precisely because stdout can be forged by the code under
test. The rationale is real and is written into the code (`TestRunCommand.outputFile`, declared at
`src/core/tddLang.ts:285` under the docblock at `:265-284`, read back at `compilerOracle.ts:1185`),
but the mechanism is per-framework, not the runner's rule: "Rust, Go, vitest and jest leave it unset
and are unaffected" (`tddLang.ts:276`). **Four of the nine frameworks parse stdout**, and a printing test can forge a
report on every one of them.

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
  its return expression). The defect was the invented name, not the extra line. **UNVERIFIABLE**
  (C239): the capture exists only in this file's own prose. The 289-of-347 count above is backed; this
  illustration is not. Any Rust dogfood session produces another.

### 33. The spike harness spliced generations as bodies, on stale offsets - a record, and the corpus behind it is gone

FIXED 2026-07-31 (session-v36). Recorded for what it INVALIDATES, not because there is code left to
write. Sibling of item 29: same family, same lesson, and this one went undetected for longer.

**Moved to the long tail 2026-08-16.** The findings are still on the record - `session-v36`'s
`item2-redecision.md` and `session-state.md` carry the diagnosis, and the two instrument logs
`e0433-facts-function.log` and `e0433-facts-body.log` are on disk with their per-row counts. What is
gone is everything a session could re-run: the corpus (`candidates.json`), the three spikes, and
`lib-cargo.cjs` with the fixes this entry used to list (C43). The `*.PRE-HARNESS-FIX.json` copies it
promised are not kept beside the new ones either; they are not kept at all (C44). An entry whose
verdict stands but whose instrument cannot be re-pointed is a record, not a live instrument check,
and it was heading a tier that tells sessions what to distrust.

Three defects, all proven at the time, all in the measurement rather than the product:

1. **The wrong splice.** `v34-after.json` `genText` is a whole function (171 of 181 rows open with an
   `fn` header). Three spikes called `cargo.spliceBody`, which writes between `bodyOpen+1` and
   `bodyClose` and nests the function inside itself. It compiles, and the outer body then returns `()`
   where its declared type should be, so nearly every row gained a spurious `E0308` whose types the
   harvest read as real. Function arm matched the recorded error codes on 10 of 10 rows, body arm on 0
   of 10.
2. **Stale offsets.** 160 of 387 entries in `candidates.json` no longer landed on their own function
   (recorded at `session-v36/session-state.md:34` and `item2-redecision.md:18`; the corpus file itself
   is deleted). Two rows spliced into the middle of a string literal and the harvest read type names
   out of roughly 348 lexer errors. Both runs exited 0 and printed plausible tables.
   **UNVERIFIABLE, that splice event specifically** (C41): the corpus and the spikes were deleted and
   were never in git history, so the ~348 has only a prose recitation behind it. Re-running the fixed
   harness over a rebuilt corpus would check it.
3. **The classifier called without its context.** `classifyHallucination(d)` bare. The E0433
   `cannot find X in Y` branch is gated on `resolution` being present, so it returned `undefined` by
   construction and every row of that form scored uncovered. The product always passes the crate
   resolution and the file's local defs.

**What it invalidates, which is the part that still binds.** Any number computed from
`leg2-coverage.json` or `order-composition.json` before 2026-07-31, including the whole of
session-v36 goal item 2 and the "17% zero-coverage" headline it argued from. That ruling does not
need the artifacts to stand: the numbers are refuted, and nothing has re-derived them.

**UNVERIFIABLE** (C45): "numbers from `spike-tier4-human.cjs` are unaffected, reproduced exactly after
the fix". That spike is deleted. The census it produced survives as shipped prose
(`docs/user-manual.md:163`, 6,856 comment lines, 5,232 names, 122 types) and a recitation is not the
artifact. A re-run of the tier4-human census would check the reproduction claim.

Three standing rules this earns, and they are the reason to keep the entry at all. A harness that
mutates a corpus must verify its own offsets before it writes, and must say out loud how many it
moved. The check must THROW rather than skip: a guard that skips leaves a smaller corpus that still
looks complete. And re-capturing the corpus is not a drop-in repair when the candidate id embeds its
own offsets, because a fresh capture renames every row and orphans the generations already recorded
against the old ones.

### 18. The rest, unchanged in priority

- **Delta-gen**: "add an arm to this enum for X" - instruction-driven modification of an
  existing symbol, presented as a diff. Debate the interaction model first: single-shot
  refinement on a visible diff vs conversational drift. Highest-tension interaction call here.
- **The prefix/ranking A/B harness**: the prompt's prefix is a byte cut, not a scope, and it
  once carried a sibling's `subtended_children()` into the model, which then wrote it on the
  wrong receiver. Build the harness first or the fix stays opinion. The sortText half has shrunk:
  rust-analyzer's ranking is no longer thrown away wholesale - it is captured on the member
  (`raLspClient.ts:516-518`, `raExtractor.ts:194`), classified by `raSortTextTier`
  (`extraction.ts:464-466`), and the tier drops blanket-ranked members from the rendered block at
  untyped-partial sites (`fimInject.ts:940-942`, the measured v27 arm D). What is still unused is the
  ranking ORDER for prompt ordering, and that residue is all that remains of this half.
- **Embedded languages**: .vue/.svelte need a Volar transport. Own slice.
- **Ecosystem breadth**: Windows; non-NVIDIA GPUs currently land wrongly in below-12gb honesty
  mode; CPU-only honesty. Apple Silicon shipped, but M-series TTFT is still unvalidated on real
  hardware.
- **De-nest transform**: parked by the user; drop-timing caveat recorded.
- **Constrained decoding** and **machine-applicable rustc fixes**: REFUTED as written. See
  Rejected. Do not reopen without new evidence.

## Terms used everywhere

- **FIM / plain continuation**: the small model (1.5b) finishing the line you are typing.
- **fn-gen**: the big model generating a whole function from its doc comment. "30b" is the install
  default (`column80.fnGenModel` = `qwen3-coder:30b`, `package.json:366`) and not the definition: the
  16GB-low-RAM tier serves a 14b instead (`column80.fnGenFallbackModel`, `package.json:402-405`,
  `src/core/tiers.ts:28-45`), and five non-local backends run fn-gen on cloud models entirely.
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
and injects it; round 1 does not. The failure it comes from: the error was
`ApiKeysConfig: serde::Deserialize<'de> is not satisfied` while `ApiKeysConfig`'s field list was
ALREADY in the round-1 prompt. The derive list was the answer and no round-1 block carries one. It is a
prompt-identity change with its own budget cost, so it wants its own number rather than being folded
in quietly. **UNVERIFIABLE** (C248): the v34 screenshot row is gone; the same E0277 case is quoted in
the source (`src/vscode/oracleSurface.ts:2306-2309`) but without the prompt contents, so "the field
list was already in the round-1 prompt" cannot be read off anything. Restoring v34's goal, or one
fresh capture, would check it.

**Which serving knobs get settings.** Four of them are declared nowhere in `package.json` and no
setting overrides any of them. That much is unchanged. "They reach the config from the DEFAULTS only"
is now stale for two of the four: `maxTokens` and `numCtx` come off the active backend's
budget-profile cell (`src/vscode/config.ts:181-193`), while `testMaxTokens` and `think` still read
straight off the default object. The evidence and a recommendation per knob live under Deferred fixes,
"Settings honesty, and the serving knobs nobody can reach". The short of it: `think` wants a default of
false, `numCtx` wants a setting because its right value is the user's hardware and its failure mode is
silent truncation, and the two token budgets want neither.

**`MIN_FNGEN_VRAM_MB` = 12288 on unified memory.** A 16GB Mac reports about 16384 and the human has
TESTED that it works. But subtract any honest toolchain figure and it falls under the floor - VS Code
alone measured 4.3GB, so any reserve above 4096 excludes it. REASONED, arithmetic rather than a run.
That the machine works
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
- Two of the refused ghosts were byte-identical to what the developer typed. **UNVERIFIABLE** (C255):
  the raw file `measurement-cost.md` points at (`harness/results/cost-v25.json`) is gone from
  `session-v25/harness/results/`. Re-running `session-v25/harness/cost-v25.cjs` would check it, and
  that is the same harness the benefit measurement below has to run on anyway.
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

The tier's gesture rows grade the dogfood repos' working trees, and ALL FIVE repos carry uncommitted
edits.

- Re-counted 2026-08-15 (`git status --porcelain` in each): rust-scratch 7 dirty entries, ts-scratch
  5, csharp-scratch 9, python-scratch 7, go-scratch 3. "go-scratch is clean" was true when this was
  filed and is false now, so the tier has no clean-tree row at all.
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

v26 shipped the lifecycle rebuild (`src/core/scopeLifecycle.ts`, commit `c228487` on today's main),
which was the stated precondition. Re-check each against the shipped machine rather than against the
v20 capture. (This block used to cite `4168d8e`, which no longer resolves: the 2026-08-10 leak scrub
rewrote history. Any bare hash in this file older than that date is suspect the same way.)

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
- A third bullet went on 2026-08-16: whether `docs/persona-research.md` gets tracked. It is tracked,
  so the decision was already made in the tree.
### Go: two coupled decisions, and Go is not simply "the broken one"

**G1 is closed and has been deleted, 2026-08-16.** It asked whether Go gets field shapes at all, on
the premise that `GO_PREFILL_LANG` sets no shape hooks and Go inherits Rust's. Both halves shipped:
`goShapeHooks` is Go's own (`src/core/crossFileShape.ts:613`) with a gopls-shaped `parseGoHoverFields`
(`src/core/goExtraction.ts:828`, wired in at `crossFileShape.ts:614`), and it is WIRED on the pre-fill
path (`src/vscode/fnGen.ts:4891`,
under a comment headed "THE MISSING WIRE" that dates the fix). `goShapeBlock` renders a data-shape
block through it. The recommended option was option 1 and option 1 is what exists.

That leaves two decisions, not three, and it changes the sequencing advice this block used to give:
G2 no longer waits on G1.

**G2. What replaces the single-letter skip rule, in the general case?**

`candidateTypesOf` matches `\b([A-Z][A-Za-z0-9_]*)\b`. From `*testing.T` the lowercase `testing` never
matches, so it yields exactly `["T"]`. The DEFAULT `skipCandidate` is `/^[A-Z]$/`
(`crossFileShape.ts:476`, `:1025`), so `T` is dropped.

That default is measured safe for Rust: 621 files of `acme-db` declare no single-letter struct, enum,
trait or union. It is wrong in general for Go. Verified on go1.26.5, `194` single-letter exported
structs in the standard library, `testing.T` among them at `testing/testing.go:934`, plus `B`, `F`
and `M`.

**The consequence is already dead for Go, which is why this is a design question and not a defect.**
`goShapeHooks.skipCandidate` (`crossFileShape.ts:630-638`) is qualifier-aware: it reads the field type
AS WRITTEN and keeps `T` when a `.` precedes it, so `*testing.T` survives today and the model does get
`t.Helper()`. The default still drops a bare `T` on any leg that has no Go hooks. So option 2 shipped
for Go specifically.

1. Carry the qualifier through the pipeline and skip on the QUALIFIED name, everywhere. `testing.T` is
   a real type; a bare `T` off a generic clause is not. Still the only option that separates the two
   cases rather than guessing between them, and it would retire the per-language hook.
2. Leave it as it stands: Go's hook handles Go, and every other language keeps the bare-letter
   default. Today's behaviour.

Note the blast radius before starting: `candidateTypesOf` is shared by all five languages. This is not
a Go-local tweak.

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

One block left this section on 2026-08-16: **ratify v33's fourteen superseded rows**. It is answered
on the record and needed no human sentence. `docs/supersessions.md` S4 says "Fully ratified... the
human ratified the other fourteen the same day and chose retirement over a re-cut", and the file
those rows lived in, `test/blind-v32-p2-reanchor.test.cjs`, is deleted. The flip mechanics survive in
S4's own tables, and `reanchor` still returns `{ moved, lost }` (`src/core/contextBlocks.ts:579`).

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

**`docs/queue.md` is the live worklist, not this section.** It was re-derived against the code on
2026-08-14 and again on 2026-08-15: every survivor carries a falsification line, five entries were
struck as already shipped and ten had their instructions corrected. Read the queue first and this
section for the reasoning behind an entry. Where the two disagree, the queue is younger.

- `fimComment.ts` (the Rust `quotes` set): a Rust `'"'` char literal opens a phantom string that runs to
  the next `"` and swallows every comment after it, so the v36 backtick gesture goes silently dead for the
  whole span. Any Rust body handling a quote character is affected: parsers, escapers, CSV and JSON
  writers. C# and Go carry `'` and handle the shape correctly, so it is a Rust-row fault, not a fault in
  the leg. The real fix is the quote set, which is a v25 contract change and needs its own blind oracle
  over lifetimes; the cheap one is to treat a literal scan that crosses a newline as a phantom inside
  `commentTypesIn`. Full detail in `session-v36/scraps.md` S36-1. **The pinned row is not what this
  entry used to say it was, and the difference decides the build.** There is no `[DEFECT] C1` title and
  no red row. It survives RETITLED as `KNOWN WRONG` at `test/adversarial-v36-p1.test.cjs:362`, running
  GREEN by asserting the defective behaviour. The fix must FLIP that row. Writing a fresh oracle
  duplicates coverage and leaves `:362` going red unexplained the moment the fix lands. Queue Q17
  inherited the same stale "write it first" instruction and has since been corrected.
- `fimComment.ts` (`ledAt`): the comment walk is quadratic in the prefix because `ledAt` does a backward
  `lastIndexOf("\n")` per hit. 200KB of block comments on one line takes 721ms against 12.6ms for the same
  bytes with a newline per comment; 977KB on one line takes 17.7s. `harvestBodyComments` in `scaffold.ts`
  walks the same scanner and is slower still. Real source does not look like this, so it is a line rather
  than a fix, but v36 put the walk on the repair path where it is awaited before the model call. See
  `session-v36/scraps.md` S36-2. Same inversion as the row above: no `[DEFECT] D2` marker survives. The
  row is "KNOWN WRONG: the walk is O(n^2)..." at `adversarial-v36-p1.test.cjs:484`, a live GREEN ratio
  row (bar 2.5x, `:463-477`) that "goes red when `ledAt` is fixed" (`:482-483`). "Red on purpose" is
  exactly backwards, and this file's own History records the conversion that made it so.
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
- `budgetProfile.ts` (NOT `fnGen.ts`, which is where this entry used to file it): three prefill bounds
  are unmeasured numbers. `PREFILL_TYPE_CAP` is 4 (`:119`), `PREFILL_RESOLVE_CAP` is 8 (`:122`) and
  `PREFILL_PROVENANCE_CAP` is 24 (`:125`). The first predates v34; the other two were picked in v34 to
  make the provenance backfill possible and to bound the round trips, not from a curve. The one cost that
  IS measured is the pre-check: prefill median 38ms to 45ms and p90 279ms to 293ms over 143 rows, so
  about 7ms, and the `definition()` round trips cost slightly more than the shape walks they avoid.
  **UNVERIFIABLE** (C296): the arm behind that 38-to-45ms / 279-to-293ms pre-check measurement is gone
  with the rest of the v34 chain. A re-run of the prefill pre-check arm would check it.
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
  either leg; the degrade is honest-dark. Shipped OPEN in 1.1.0. The full write-up was archived on the
  sessions branch, which the 2026-08-10 scrub removed; the condition above is a code fact and stands
  without it.
- Three false refusals in the hover recovery, all in the safe direction: `r#type` raw idents,
  `[Node; 1 << BITS]` read as unbalanced generics, and a C-variadic `...` read as an elision marker.
  Each ADDS recoveries and so moves the surface - each wants its own arm, none can ride along.
  **UNVERIFIABLE** (C301): the recovery code exists (`src/core/rustHoverRecovery.ts`) but the scrap that
  named the three refusals is off-box. A re-scan for hover-recovery refusals would check them, and it
  is cheap enough to fold into whichever arm goes first.
- ~~The Go rig's stub TextDocument defaults `languageId` to "rust"~~ STRUCK 2026-08-16. The file that
  carried it (`05-inject-run.cjs`) no longer exists anywhere in the repo, so there is nothing to fix.
  Queue Q1 was struck on 2026-08-14 with the same verification and keeps the finding for re-filing
  against a rebuilt rig. S40-2.
- ~~`package.json` `column80.injectedSurface` copy says "roughly 765 prompt bytes" per injected type~~
  STRUCK 2026-08-10. The setting is gone: session-v48 phase 1 replaced it with
  `column80.injectedContext`, whose copy quotes no byte figure at all, so there is no number left to
  read 4% low. The measurement behind the item is worth quoting if a byte figure is ever written
  again - 795 B per type-slot after v39's hover recovery, 724 before - but it is **UNVERIFIABLE**
  (C304): S39-9 is off-box with the rest of the v39 scraps. A re-measure of bytes per type-slot would
  check it.

Re-verified 2026-07-25 unless marked, and again claim-by-claim on 2026-08-15. Each waits for its
trigger, not for a slice.

Three entries were deleted on 2026-08-16 because the code moved under them, and they are named here
so the removal is visible rather than silent: the `extraction.ts` hover-fan-out comment that claimed
a parallelism benefit (it now says the opposite, `:1071-1075`), the `package.json` menus
hide-vs-refuse call (the four gesture commands carry `resourceLangId` when-clauses, so an unsupported
language never sees them), and `repairLangFor`'s missing Go row (`oracleSurface.ts:2745-2748`, Go has
its own classifier since v30). Note `docs/user-manual.md` still describes the menus behaviour that
shipped away.

- `csExtraction.ts`: `advanceCsLineScan`'s interpolation-hole branch never sees a nested `@"…"`
  opening inside the hole, so that string's continuation line is treated as code and re-indented,
  changing its value. PROVEN with a real `dotnet run`: 15 wrong values in 300 placed cases.
  Pre-existing, unrelated to the placement fix (which changes none of them).
- `oracleSurface.ts` (not `repair.ts`): the v30 usage leg has no fallback for a draft that INVENTED a
  method. References on a name that does not exist return nothing, and the round proceeds with no
  windows. The leg is `resolveUsageForRound` at `src/vscode/oracleSurface.ts:1100-1121`, targets
  filter to `via === "member"`, a references miss gets a channel line and nothing adjacent
  (`:1097-1098`), and no fallback path exists. `repair.ts` carries only the prompt's `usage` field.
  Candidates were named when the item was ratified: type-level references of the types in play, or a
  bounded model-emitted observation request answered by the extractors. REASONED, read not run.
- `ARCHITECTURE.md`: the v30 usage leg was refine-only, and that is now a SETTING rather than a
  structure. `column80.repairUsageWindows` (`package.json:475`, default false at
  `src/vscode/config.ts:128`) runs the usage leg on repair rounds too
  (`oracleSurface.ts:730-732`, `:1084-1085`). Default off preserves the refine-only behaviour the
  human's "always injected" ratification diverged from, so the divergence still needs a home that
  ships - and queue Q22, which owns that write-up, still describes the split as structural.
- `package.json`: `column80.debounceMs` has no schema minimum. Zero disables the debounce, and
  every keystroke then issues a full extractor call.
- `specs.js`: the memberSite/argSite fixtures point at EXISTING calls, where rust-analyzer
  renders labels differently than at a bare dot. Rendered-output rows grade a shape the user
  never types. Audit all languages.
- `specs.js`: C#'s knownLeaks (`Equals`, `GetHashCode`, `GetType`, `ToString`) are still declared and
  unpromoted (`specs.js:222`). The "cosmetic" justification Rust dogfood refuted is gone from the file:
  the comment now defers to roadmap tracking (`:13-18`) and states "Roslyn hands back object's members
  at every receiver" (`:220-221`). The word survives only in the refutation record
  (`test-vscode/dogfood-rust-render.test.js:23-24`). What remains is the promotion decision itself.
- The E0425 self-reference check: `let x = s.f(&x, ...)` is wrong with certainty. Built as a
  text scan and WITHDRAWN: 224 false suppressions across 1.6M sites, zero true positives.
  Needs scope evidence, not string evidence.
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
  12.4GB at 16384, so about half a gigabyte buys the larger window. **UNVERIFIABLE, those three
  measurements** (C329, C330, C331): the raw runs are gone. They survive as a carve record inside the
  shipped source (`src/core/ollama.ts:141-159`), and a recitation is not the artifact. Re-running at
  `num_ctx=2048`, and re-measuring the carve, would check them. The truncation BEHAVIOUR is separately
  documented in the same file and is not in question; the numbers are.

  `think` has no setting AND no stated default. Any model that reasons by default is unusable until it is
  false: `qwen3.6:27b` spent all 2048 output tokens on the trace and every generation was rejected as
  truncated without emitting code, because reasoning is billed to the same budget as the answer.
  Same recitation caveat as above.

  1. Ship `think: false` as a DEFAULT and leave it unexposed. Recommended for `think`. No shipped model
     reasons, `qwen3-coder:30b` does not, and a user who swaps in a reasoning model should not have to
     discover this knob from a truncation toast. One test row pins "unset stays unset" today and goes red
     on purpose.
  2. Expose `numCtx` as a setting. Recommended. It is the one knob whose right value depends on the
     user's hardware rather than on the product, a smaller box genuinely cannot afford 16384, and the
     failure mode without it is silent truncation rather than an error the user can act on.
  3. Expose `maxTokens`/`testMaxTokens` too. Not recommended. Their failure mode is a visible
     `done_reason=length` reject, and v34 already showed the shipped values were the problem rather than
     the exposure: 512 caused every one of 15 rejections across 189 generations. **UNVERIFIABLE**
     (C333): that run survives only as a recitation at `src/core/config.ts:51-54`. A 512-cap arm
     re-run would check it.
  4. Leave all four as defaults. Today's behaviour. Defensible only while every shipped model behaves
     like `qwen3-coder:30b`, and that is not a bet worth carrying once someone swaps the tag.
- Test rung: `cargo test` filters are substring, not exact; `tests::add` also runs
  `tests::add_more`.
- gesture.test.js asserts `some` where the evidence supports `every` (v21 S6). The stated
  precondition (a green tier run) has happened; tighten it.
- The shared vscode activation stub does not exist (v21 S11/S13). Three findings want it;
  extract it before a fourth 400-line copy gets written.
- darkSites grows unpruned, in every language now (v21 S24).
- The digit-ending receiver guard darkens Go/Python stdlib qualifiers: `utf8.` and `sha256.`
  read as float-ish and go dark (v23 F21). Refuse only numeric literals; measure first, the
  class is invisible to the ledger.
- Poisoned-GOENV fixtures (v23 F3/F7) exist as scrap conditions, not tests. Cheap; write them
  when goOracle is next touched.
- Python's bound p90 is 202-207ms against the 200ms bar, and the lever is named: a declaration-
  head parameter list holds brackets open, so the bound reads five lines and retracts to one,
  serving a truncated `run_in_process(config_path: str, method_name: str,)`. This is a
  served-text change with a real correctness price; measure before/after on the v25 harness
  (`session-v25/harness/verify-v25.cjs`, LANGS=python, ~90s - the bare `harness/verify-v25.cjs` path
  this entry used to give resolves to nothing from the repo root). Known trap: the bound's balance is
  local to
  the cursor's line, so a `(` opened three lines up is invisible; the `beginsHere` guard is the
  fix shape.
- `crossFileShape.ts`: the field leg is dark on every Rust enum, so the type graph stops at one.
  `parseStructHoverFields` wants `name: Type` per brace-body entry and no variant writes one:
  `Unpaid`, `Card(Receipt)` and `Invoice { terms: Terms }` all miss the regex, `fields` comes back
  empty, and no payload type is ever enqueued. Data-oriented Rust puts its real structure in enum
  payloads, which is exactly where this bites. C# already ships the shape of the fix in
  `enumMemberLine`. REASONED, read not run: write the fixture first (an enum field on a walked
  struct, payload type defined in a third file) so the red is on record before the regex moves.
  **Half of this drifted and it narrows the fix.** The hover recovery now restores an elided
  tuple-variant payload from the definition source INTO the signature (`crossFileShape.ts:88-93`,
  applied at `:1301` via `recoverElidedSurface`, `src/core/rustHoverRecovery.ts:79-99`), so the model
  can read `Receipt` spelled inside the variant when the source proves it. What still never happens is
  ENQUEUING `Receipt` as a walked type, which is the graph-stops-at-one half and is the whole of what
  is left.
- `crossFileShape.ts`: `resolveCrossFileShape`'s bound is `{D_MAX, N_MAX, B_MAX?}` since session-v51
  added an opt-in commit-counted per-node fan-out (`:124-158`). TOK_MAX still lives in `dataShape.ts`'s
  own `WalkBounds` (`:39-42`). The fn-gen caller wires its bound at `fnGen.ts:2592` via
  `prefillGatherBound` - and fn-gen is NOT the only caller: `completionProvider.ts:1401` and `:1559`
  drive the same walk on the FIM legs with `CROSS_FILE_BOUND`, which carries no `B_MAX` and no
  TOK_MAX. So the "harmless while fnGen is the only caller" reasoning has already expired; the second
  caller arrived and inherited the unbounded fan-out. Either fold the bound into the signature or say
  so where the parameter is declared.

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
- Object-statics noise (Equals, ReferenceEquals) is filtered on the COMPLETION path now:
  `isCsObjectDeclaredMember` keys on the declaring type Roslyn renders into the signature and
  tier-demotes or withholds (`csExtraction.ts:601-612`, reasoning at `:647-661`;
  `csLspExtractor.ts:345`). `membersOfType` stays deliberately unfiltered because its descent is
  syntactic. What is left to watch is whether that asymmetry ever shows up in a prompt.
- A doc comment that itself demands `throw NotImplementedException` trips the punt marker, and
  the obedient retry violates the contract. Fix on a real capture. Python shares this class via
  `raise NotImplementedError`.

### Python

- Sub-package venvs in a monorepo go unfound; the check falls to system python and likely a
  missing-imports storm.
- The repair-round hallucination classifier (pyright names the class) builds only if bare
  repair leaves member hallucinations standing.
- A genuinely dark receiver no longer burns the full ~900ms retry: session-v50 bounded the loop
  (`SETTLE_ALLOWANCE_MS = 120` with a 600ms hover, `crossFileShape.ts:850-852`), on a measurement of
  77-87% pure cost with zero recovery over 41 cursors. The comment at `:874-905` says what the bound
  is and is not: "BOUNDED, NOT TUNED AND NOT DELETED". Whether it can go to zero is item 45's
  decision, not this ledger's.
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

- Example sourcing misses constructor examples documented on associated functions (a `Type::`
  query would find them), and the injected example text is never logged, so a weak example
  cannot be diagnosed.
- Cross-file impl blocks are invisible to membersOfType.
- The feature-graph scan misses macro-gated modules. Benign; broaden only if needs-feature
  steering proves out.
- No rival inline-provider detection: Continue et al. silently win the ghost slot. And no
  "autocomplete is off" evidence line when disabled. Both get misread as breakage.
- **Does `Tighten Doc Comment` earn its palette slot?** The command shipped in 2.1.0 and the measured
  yield is thin: 2 names across 30 Rust targets and 5 across 30 TypeScript. Whether that is worth a
  gesture is answered by pressing it on real work, not by another census. Count the times it proposes
  a backtick you keep. (From item 52, struck 2026-08-16.)
- **Rust's class-4 enum-variant population is unmeasured.** Same origin: the backtick proposer's
  hardest population is a variant name that reads like a type, and nobody has counted how often it
  occurs in real Rust. Watch for a proposal that backticks a variant.

Two rows left this ledger on 2026-08-15, both shipped away: the headless transport's two missing
render fixes (`raLspClient.ts:504-516` now applies `stripRustGenericDefaults` and `isRaBlanketImpl`
plus the tier stamp, which is the parity claim closed), and manual repair on a clean function giving
no feedback (`oracleSurface.ts:915-937` runs the refine or logs a named skip reason).

## Tier health - the instrument, not the product

Baselines from 2026-07-25, quiet box, post-reboot, GPU live. Latency rows mean nothing unless
the box is quiet: under parallel test load the ts row grew seven extra failures.

**Read the counts below as history, not as a baseline you can diff against.** The 2026-07-25 run logs
are gone (C378, C379, C381, C383, C387): three of the five per-language counts, the parallel-load
finding and the four-identical-runs record all have no artifact on this box. The named ROWS all still
exist and can be pointed at; the numbers cannot be checked without re-running the tier per label on a
quiet box, which is what would settle every one of them at once. Until then a fresh run has nothing
honest to compare against, and that is the state a section called Tier health should be most
embarrassed about.

- **ts: 43 passing, 2 failing.** Both failures are named opens: the membersOfType-signatures
  contract row (tsserver returns empty `detail` 8/8, `contract.test.js:320-342`) and the v17
  keystroke-cost known-red (`test-vscode/blind-v17-keystroke-cost.test.js`).
- **go: 44/0.** Matches v23's ship number exactly.
- **csharp: 44/1.** The floor-and-margin latency row. `test-vscode/budget.test.js` carries two, and
  the entry never said which: the injection-window row at `:123` and the budget-plus-margin row at
  `:291`.
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
- Nothing forces the TIER to run. CI now exists - `.github/workflows/ci.yml` runs typecheck,
  `test:unit` and build (`:54-57`) - but neither workflow runs the vscode tier; `grep vscode` finds
  only vsce packaging in `release.yml`. So "there is no CI" is now tier-only, and skipped tests in a
  suite nobody runs are still just prose.
- The NVML lesson: the hardware probe reads total VRAM and no health signal, so a broken CUDA
  stack looks like a small GPU and the product degrades silently. Item 9 is the cheap detector.

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
  variance zone is where the discrimination lives. **UNVERIFIABLE** (C398): the "2 wins, 1 loss, 7
  ties" shape quoted here is in no surviving artifact - the v22 per-site shapes that did survive are
  1-3-4, 7-1 and 0-5-3 (`session-v22b/scraps.md:35-36`, `progress.md:190`), and the SQRL analysis is
  not in the repo. Re-deriving per-site win/loss/tie from the v22 seed rows would check it. The
  METHOD point stands on its own and does not need the example.

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
- **A confidence signal on a generation.** Rejected because it guesses at output quality, and a
  product that second-guesses its own answers is not what this is. The distinction that keeps the
  channel lines legitimate: a channel line reports a MEASURED FACT about what was actually sent
  (item 43's budget arithmetic is the worked example), never an estimate of how good the answer is.
  Kept here after item 43's rewrite, because that entry was the only place the boundary was written
  down.
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
  after the harness fix. Superseded by the backtick gesture that shipped in v36. **UNVERIFIABLE**
  (C411): the census artifact is not on disk, though the same counts are recited in shipped prose at
  `docs/user-manual.md:163`. A re-run of the comment census would check it. Nothing here is worth
  reopening on that basis - the gesture that replaced it works - but a session quoting 97.7% at
  something else should re-derive it first.
- **Reordering the prefill tiers (old item 31's fix shape).** The v37 scout replayed the item's own row:
  the doc contributed zero candidates, so imports never beat the doc and there was no ordering bug to
  fix. The one real ordering effect - rustfmt's alphabetical import order deciding which project type
  wins - is a symptom of the cap, and the cap arm is measured flat: 4 -> 12 moved 0.8 points, inside the
  noise floor (v38 item 3 notes). **UNVERIFIABLE, the replay** (C412): session-v37 keeps its spike
  outputs but no item-31 replay artifact. `prioritizedTypes` exists (`src/vscode/fnGen.ts:2069`), so
  re-replaying the item's own row through it would check the zero-candidates finding.
- **Raising `DATASHAPE_TOTAL_TOK`.** Measured, session-v39 (the 800/600 arm): 61 vs 56/56, and banded by
  actual prompt growth the gain sits on 133 rows the budget never touched (+2.5 of pure variance), while
  the 46 rows that grew 901B+ paid -0.5 and ate ~38k of the 98.5k added bytes. The render-pass budget
  shipped in 1.2.0 buys the rescue without the bytes. **UNVERIFIABLE** (C414): no result file with the
  61-vs-56/56 pair or the banded analysis survives - `session-v39/` holds only the arm harness, whose
  header carries the v38 baselines 43/42/40. A re-run of the 800/600 arm would check it. Item 41a's
  cloud arm proposes to raise a neighbouring budget, so it should re-derive this rather than cite it.
- **Exempting the walk's own root from the per-walk `TOK_MAX`.** Same session: root drops stayed at 63
  and starved rows went 21 -> 24. The refutation is written in `src/core/dataShape.ts`.

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
