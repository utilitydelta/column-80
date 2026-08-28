# Criticize

One gesture, fifteen dimensions, five languages, and nothing written. `Column 80: Criticize
Function` scores the function under your cursor against a rubric and prints a card to the output
channel.

Files: `src/vscode/criticize.ts` (the command and its order of operations), `src/core/criticizeTypes.ts`
(the detector seam, the masker and the doc harvester), `src/core/criticizeLang.ts` (the five language
profiles), `src/core/criticizeSlice.ts` (the slicer), `src/core/criticizeHonesty.ts`,
`criticizeSignature.ts`, `criticizeContract.ts`, `criticizeAltitude.ts`, `criticizeSafety.ts` (the
detectors), `src/core/criticizeScore.ts` (the scorecard), `src/core/criticizeRender.ts` (the card as
text), `src/core/criticizeBlast.ts` (the call-site count), `src/core/criticizeExplain.ts` (the model
leg and the door it cannot walk through), `src/core/criticizeGesture.ts` (every refusal sentence and
every evidence line).

The taste this is built to is `docs/perfect-functions.md`. That document is the curriculum; this one
is the mechanism.

## The reframe: the model never decides what the findings are

**The detectors decide what the findings are. The model's only job is to explain a finding a
detector already produced.**

That sentence is the whole design, and it was bought with two measurements.

Session-v60 built a prose critique and refused to ship it. Three real functions, unchanged bytes,
`qwen3-coder:30b` at `temperature: 0`, three runs each, asking only whether the finding set was
identical across the three:

```
validate_intra_batch_chain        identical finding sets across 3 runs: false
is_include_batch                  identical finding sets across 3 runs: false
check_replication_backpressure    identical finding sets across 3 runs: false
GATE: 0/3
```

On `check_replication_backpressure` the model returned ten findings on every run and not one of them
appeared in all three. A developer pressing the gesture twice on code they had not touched would be
handed a different list.

The v61 scout then asked which of four stability mechanisms fixes that. The answer is none of them,
because they are not four mechanisms. Seven arms, two backends, a positive control that reproduced
the 0/3 and an anti-collapse control carrying two seeded defects:

| arm | GATE | set sizes | seeded defects named |
|---|---|---|---|
| v60 prose (positive control) | 0/3 | 10, 10, 10 | 2 of 2, unstably |
| fixed taxonomy | 2/3 | 1, 1, 1 | 1 of 2 |
| structured schema | 2/3 | 0, 2, 2 | 1 of 2 |
| ensemble of 3 | **3/3** | 0, 0, 0 | 1 of 2 |
| taxonomy + a completeness demand | 1/3 | 5, 8, 9 | **2 of 2** |
| frontier backend | 0/3 | 4, 5, 5 | 2 of 2 |

**The four mechanisms are one dial, and its currency is recall.** The arm that scored a perfect 3/3
did it by returning nothing on all three functions, and only the anti-collapse control made that
visible. Stability is purchasable in any quantity by paying in findings.

Redefining the gate does not escape it either. Asking only that the same LINES draw attention,
rather than the same claims, still fails at 0/3 with about half the flagged lines changing between
runs. The only key coarse enough to be stable is the defect class alone, and "the model found a
MISSING_CASE somewhere" is not a finding.

Two hypotheses died on the way, both worth knowing because they will occur again: the instability is
not phrasing variance (coarsening the key moves 24 distinct claims to 21), and it is not a
small-model problem (the frontier backend scores 0/3 at 34 seconds per press).

A finding set that is a function of the model's sampling cannot be stabilised. It has to be a
function of the CODE. That is what a deterministic detector is. Instability is then confined to
wording, which nobody was ever promised determinism about: the unstable component moves off the
load-bearing path instead of being fought on it.

## The one-way door

The explainer must be structurally incapable of adding a finding. If it can, the reframe is undone
and this is the thing v60 refused twice, wearing a detector's clothes.

The enforcement is a type, not a convention:

```ts
export interface ExplainAuthorization {
  finding: DetectorFinding;
  source: string;
}
```

Both fields are required and plain, so tsc forces every construction site to state its stance, and a
reviewer finds every one of them by grepping for the type name. There is no constructor that does
not start from a finding a detector produced. `explainFinding` returns a `string`, and a string has
nowhere to put a finding.

`attachExplanations` iterates the ROWS and never the prose map. An entry whose key matches no row is
unreachable, so a model that invents a finding cannot get it onto a card even if something upstream
handed the invention a key. Prose is never parsed for structure, never scanned for findings, and
never fed back into scoring. Prose longer than `EXPLANATION_MAX_LINES` is dropped and the row
degrades to its evidence line, because dropping is the safe direction.

The prompt carries one finding, its evidence line, its dimension title and its curriculum line. Not
the function, not the other findings, not the card. A model that cannot see the rest of the function
cannot rank it, cannot count defects in it, and cannot decide anything about it.

## Two audiences, two reading depths, one gesture

- **A student building a function their professor would give an A+.** They read the whole card and
  learn which of fifteen questions this function answers badly.
- **A professional feeding a refactor effort.** They read the elevated rows and the blast radius,
  and stop.

Every dimension is scored on every function, every time. A dimension that found nothing is `clean`,
a dimension the language cannot answer is `blind` with its reason, and neither is ever absent,
because an absent row and a clean row read the same to a human and only one of them means the
question was asked.

That is also what rescues determinism a second time. A rubric enumerates its dimensions in advance,
so the finding set stops being "whatever the model noticed this run" and becomes "how did this
function score on dimension 4", which is stable by construction.

**There is no composite score.** A grade is a number a student will optimise against, and the card is
the deliverable rather than an internal signal, so the Goodhart risk would land on the human.
Dimensions get a state and an evidence line; the function does not get a mark out of ten. The only
number a card carries is the declaration's line number.

## The fifteen dimensions

Grouped the way `docs/perfect-functions.md` groups the craft, and the card renders them in this
order so two cards can be read side by side row for row.

**Honesty: does the signature tell the truth about what comes in.**

| # | dimension id | fires on | source |
|---|---|---|---|
| 1 | `clock` | `Instant::now`, `Date.now`, `DateTime.UtcNow`, `time.Now`, `time.time` | Logan Smith 2026 |
| 2 | `prng` | `thread_rng`, `Math.random`, `new Random`, `rand.Int`, `random.*` | the canonical example |
| 3 | `env` | `env::var`, `process.env`, `Environment.Get*`, `os.Getenv`, `os.environ` | |
| 4 | `world` | file opens and reads, never log writes | |

**Signature empathy: is the signature kind to the person calling it.**

| # | dimension id | fires on | source |
|---|---|---|---|
| 5 | `adjacent-params` | two neighbours of one type, swappable at the call site | signature empathy |
| 6 | `bool-param` | a boolean parameter; the caller already knew | Acton 2014 |
| 7 | `unused-param` | a named parameter the body never mentions | the red circle |
| 8 | `param-count` | above a per-language threshold | McCabe-era, kept |

**Contract: does it promise something, and hold to it.**

| # | dimension id | fires on | source |
|---|---|---|---|
| 9 | `undocumented` | exported, zero doc comment | Knuth 1984 |
| 10 | `unenforced-precondition` | the doc says must/assumes/requires, the body has no guard | Hoare 1969 |
| 11 | `cqs` | returns data while mutating state | Meyer 1988 |

**One level of abstraction.**

| # | dimension id | fires on | source |
|---|---|---|---|
| 12 | `pass-through` | the body is one delegating call at the same or wider arity | Ousterhout 2018 |
| 13 | `nesting` | max block depth above a threshold | McCabe 1976 |
| 15 | `section-comment` | a `//` label inside a body followed by code | Wirth 1971 |

**Safety: can it fail in a way the signature never admits.**

| # | dimension id | fires on | source |
|---|---|---|---|
| 14 | `unadmitted-failure` | five detectors, one idea; see below | Go proverbs, Rust culture |

Naming the principle is load-bearing rather than decorative. "Line 14 mutates and returns" is a
lint. "This violates command-query separation, Meyer 1988: a function answers a question or changes
the world, never both" is teaching, and teaching is what a grading tool is for. The `source` field is
never empty and is fixed per dimension, so two runs cannot phrase the same principle two ways.

## The per-language refusals, and why each one exists

The dimensions sort into four tiers by how much per-language work each needs, and three of the four
tiers carry a refusal the product speaks out loud.

**Tier A, one build and five tables.** Dimensions 1 to 4. All five grammars were written side by side
and not one needed its own control flow. A clock is a list of spellings.

**Tier B, one algorithm and five parsers.** Dimensions 7, 8, 12, 13. Only "what is a parameter" and
"what is a block" differ. Python is the exception on 13: it counts INDENTATION, and a brace counter
reads every Python function as depth zero, which is spelled exactly like a clean result.

**Tier C, genuinely a different detector per language.**

- **Dimension 14 changes meaning.** Rust is a panic against a plain return type. Go does not
  idiomatically panic, so the same craft idea there is a DROPPED error. C# is a throw the doc never
  mentions. Python is a `raise` with no `Raises:` in the docstring. **TypeScript has no checked
  exceptions at all, so the dimension is `blind` there with a reason and never `clean`**: a language
  with nothing in a signature that could have admitted a throw has not passed the question, it
  cannot be asked it.
- **Dimension 11 changes machinery.** Rust `&mut self`, Go pointer receiver, C#/TS/Python field
  assignment. The tell for "this changed state" is a different construct in each, which is why the
  detector is per-language rather than one grammar with five spellings. This entry used to carry a
  per-language signal-rate contrast and an argument built on it about ownership making the violation
  culturally rare in Rust. Those rates were taken before the phase-6 fix to this dimension and no
  longer reproduce, so the contrast is withdrawn rather than restated with fresh numbers. What
  dimension 11 IS graded on is precision: 100% on the labelled set, at 28.6% recall.
- **Dimension 9's "public" is five different things.** Rust `pub`, C# `public`, TypeScript `export`,
  Go CAPITALISATION, and a Python leading-underscore convention the language enforces nowhere. The
  Python row says so in the finding rather than in a refusal, because it is a fact about the
  language and not a gap in the product.
- **Dimension 10's guard vocabulary shares nothing** across the five: `assert!`/`?`/`return Err`,
  `if err != nil`, `throw new ArgumentException`, `raise`.

**Tier D, a coverage hole that cannot be closed. Python.** Measured on 510 Python functions: 13.7%
annotate every parameter, so dimensions 5 and 6 are blind on most Python code and report a coverage
gap rather than a clean result. And 68.0% put the doc INSIDE the body as a docstring against 1.4%
above the signature, which is why the doc harvester reads DOWNWARD in Python and upward in the other
four.

**Dimension 5 exempts Go's grouped parameters outright.** `func f(a, b int)` is adjacent-same-typed
spelled by the language. Measured over 39,394 Go declarations, the grouped spelling is 8.3% of the
standard library. Flagging it would be flagging Go rather than the code. (The scout's figure for this
was 36.1%; its regex counted separately typed pairs as grouped, and the exemption is still right
while its justification was four times too loud.)

**An unregistered language is refused BY NAME**: `Column 80: Criticize does not know how to read
<languageId> yet.` A named refusal is a shipped state, the way 2.4.0 refuses TypeScript for covering
tests in those words. A generic "cannot do that here" leaves the developer unable to tell a broken
feature from a file out of scope.

## The elevation policy, and the one dimension held

Every dimension is SCORED. Only the rows above the bar are ELEVATED, and elevated is what "flagged
and not held by policy" means. An elevated row renders its title, its curriculum line, one evidence
line per finding, its blast radius when there is one, and its explanation when there is one. A row
below the bar renders its state and never its evidence, so a reader who sees a quoted line knows
without being told that the pass is asking them to look.

`DEFAULT_ELEVATION` is DERIVED from the detectors' own `held` flags rather than written out by hand.
A dimension ships held by setting one boolean where it is defined, next to the measurement that
justifies it. Writing the list out separately would let a detector claim it was held while the policy
silently elevated it.

**Dimension 15 ships scored but NOT elevated, pending a human ruling.** The section-comment tell fires
on 31.0% of real Rust functions. Under the professional's pre-commit bar that is a nit flood; under
the student's grading bar, "a third of your functions mix abstraction levels" is a legitimate thing
to teach. The two audiences give opposite answers and the human has not ruled, so the default is the
conservative one and the ruling is one array entry rather than a rebuild.

The renderer recomputes elevation from the policy it is handed and never trusts `row.elevated`, so a
card scored under the default and rendered under a ruling comes out ruled without being re-scored.
Nothing in the renderer names a dimension id.

## The slice, and the trap in it

**The span the product resolves begins at the DECLARATION HEAD. The detector slice must not.**

`sliceFunction` walks UPWARD from the head over contiguous doc comment and annotation lines before
anything reaches a detector. Dimensions 9 and 10 both read the doc, and both go silently and
permanently wrong without it.

This is not a hypothetical. The scout's "stated contract, unenforced" probe read 0.0% because its
slicer began at the `fn` line, so the doc it inspects was never in its input; fixed, it reads 0.8%.
On the same table, one genuine 0.0% sat beside it and the two were indistinguishable from the output
alone. Measured again on the graded set: a slicer that drops the doc reads 29% of documented Rust
functions as undocumented. The session hit this trap twice.

Python is the mirror of the same trap, and it is why the harvester reads downward there.

`sliceFunction` returns undefined rather than an empty-but-valid unit when it cannot find a
declaration head, and `unitDefect` refuses a malformed unit BY NAME. A unit whose body was never in
the input reads clean on every body dimension, and a clean answer nothing examined is the failure
mode this whole subsystem is built around.

Both the gesture and the grading harness call `sliceFunction`. A harness that builds its own unit is
measuring its own slicer, which is the defect session-v29 measured when a re-derived mapping
inverted an arm result.

Precision also comes from masking. `Instant::now()` inside a comment, a doc example or a string
literal is not a clock read, and a detector that fires on one has told the developer something false
about their own function. Detectors reach the code only through `maskedBody` and `docLines`, because
each of those carries one of the measured lessons above. Two seam defects were found by measuring
rather than by review: `maskLine` blanked `${...}` and Python f-string `{...}` as string content, and
those braces hold CODE. Dimension 7 was calling a used parameter unused on 7.9% of TypeScript, now
0.3%, and on 25 of 308 Python findings, now 6.5%.

## Blast radius

The professional's half. `src/core/criticizeBlast.ts` runs the shipped call walk one level up from
the function and counts the DIRECT call sites, which are the lines an honest signature change edits.

Nine of the fifteen dimensions are signature-level, meaning the honest fix changes the signature and
ripples to callers: the four honesty legs, the four signature-empathy legs, and unadmitted failure.
The other six are body-local, so a call-site count would describe nothing and none is attached.

**It is BEST EFFORT, and undefined renders as NOTHING rather than as zero.** A count is refused
whenever the walk did not enumerate level one completely: a rejected caller request, a stop that is
not the walk's own depth cap, or a caller the scope test turned away. "Changing this signature
touches 0 call sites" is a claim the walk never made, and a reader cannot tell a measured zero from
an unmeasured one. A walk that RAN and found none says so in words rather than in a digit, for the
same reason: the two states must not share a spelling.

The gesture normalises "which function is the developer in" through `callRootPosition` in
`oracleSurface.ts`, the same function both existing gestures use. A second normalisation is a second
answer, and session-v60 measured exactly that: one press of Run Covering Tests and one press of
Repair Function discovered two different functions' tests for one cursor.

## The order of operations, and every refusal in it

1. **No active editor.** Warn, do nothing.
2. **Unregistered language.** Refuse, naming the language. Checked before the symbol provider is
   asked anything.
3. **No function at the cursor.** Refuse and say so. Never score the file: a file-level card would be
   the "criticize file" gesture the one-gesture rule refuses.
4. **Score.** Every dimension, always. Pure and synchronous: no model, no network, no clock, no
   filesystem. Two scorings of unchanged bytes produce identical cards.
5. **Blast radius, best effort.**
6. **Explain, best effort and gated.** The tier gate is consulted BEFORE the transport is touched and
   fails closed, the same consult generate, repair, tighten and TDD make.
7. **Render** to the output channel and reveal it.

Steps 4 and 7 are the product. Steps 5 and 6 are enrichment, and every one of their failure modes
degrades to a complete card rather than to an error. **A closed tier gate is not a failure**: the card
renders complete from the detectors and the channel says the explainer was skipped and why.

The evidence prefix is `[critique]`, and a path is finished when it emits evidence rather than when
it compiles. Every refusal branch emits a line naming the cause. Cancellation emits
`[critique] cancelled` and gets no failure toast, because cancelling is the user's own action.

The toast is one line, bounded, and never carries the card. A card with nothing elevated toasts the
ruled wording: this pass found nothing above the evidence bar. "Clean" and "looks correct" are claims
this pass has no instrument for.

## It proposes, and the human answers

**Reversed in session-v62.** v61 shipped this gesture writing nothing at all, and the human's verdict
on that was short: it was useless. A card in a panel is knowledge you have to re-enter by hand, and a
rubric that knows the line number can put the criticism on the line.

The gesture now proposes a **code diff**: the function with a rubric comment planted above each
failing line. Accept and the comments land. Reject and nothing was ever written.

It goes through `ProposalPresenter.present()` and nothing else. That is the extension's ONE consent
gate and ONE document write, which fn-gen and repair already share, so criticize is its third caller
rather than a fourth write path and the three-write-path invariant is untouched. The presenter is
HANDED to the gesture, never constructed by it: a second one would mean a second preview registry and
one `column80.proposalAccept` settling the wrong tab's diff.

It still publishes no diagnostics. The Problems panel belongs to the compiler.

Nothing moves until Accept. The proposal is stamped with the document version captured BEFORE the
symbol provider was asked anything, because the span offsets belong to the text that provider saw; a
document that moved in between discards rather than splicing. Getting that capture one await late was
a real defect in this build, and the cost was not a wrong card but a `pub fn` cut in half.

`test/impl-v61-p5-gesture.test.cjs` still pins the write names, rewritten rather than deleted: every
write name except the consent gate's is still banned from `src/vscode/criticize.ts`, and the positive
half is pinned too. That is what keeps a fourth write path from arriving quietly.

### The comments

The words are a FIXED TABLE, one phrase per dimension, in `src/core/criticizeVoice.ts` and frozen at
runtime. A model never writes them: a model that writes the comment is a model that can invent a
finding. Bare contempt is the ruled register, dictated by the human. Name the defect, name what it
costs, give the order, stop. No citations, no second person, no hedging.

    // C80 clock: reads the wall clock through Instant::now. Hidden wall-clock
    //     read. Untestable. Pass it in.
    let start = Instant::now();

Every comment goes ABOVE its offending line at that line's own indent. There is no trailing form:
measured over all fifteen dimensions with no detector detail at all, on an 18-column code line, one
fitted; with real details, none did.

A head line carries the tag and the dimension; continuations hang under it. Tagging every line was
tried first and made one criticism read as several with the sentence cut in half.

**Press it twice and the file is the same.** Every press strips the comments the last one left before
planting. That required scoring a comment-free VIEW of the document with a line map back to real
coordinates, because otherwise the rubric reads its own criticism as the code: a planted `//` block
between a Rust `///` and the head makes a documented function read as undocumented, and Go is the
mirror, where `//` IS the doc prefix and a planted comment is read AS documentation.

## What was NOT measured, and must not be claimed

This section is the honest bound on everything above it.

- **No detector's precision was measured before this session.** Every rate in the goal and the scout
  is a SIGNAL rate on code the repo considers good. A signal rate says the channel is quiet. It does
  not say a single flag is correct.
- **All fifteen dimensions are now graded.** Against the 138-row hand-labelled set in
  `session-v61/graded/labels.json`, reproducible by running `session-v61/harness/grade.cjs`:

  | dimension | precision | recall |
  |---|---|---|
  | `clock` | 100.0% | 100.0% |
  | `prng` | 100.0% | 100.0% |
  | `env` | 100.0% | 100.0% |
  | `world` | 100.0% | 60.0% |
  | `adjacent-params` | 100.0% | 100.0% |
  | `bool-param` | 100.0% | 100.0% |
  | `unused-param` | 100.0% | 100.0% |
  | `param-count` | 100.0% | 100.0% |
  | `undocumented` | 100.0% | 100.0% |
  | `unenforced-precondition` | ungraded | 0.0% |
  | `cqs` | 100.0% | 28.6% |
  | `pass-through` | 85.7% | 50.0% |
  | `nesting` | 100.0% | 100.0% |
  | `section-comment` | 100.0% | 100.0% |
  | `unadmitted-failure` | 100.0% | 64.3% |

  Fourteen of the fifteen have zero false positives on the set. The exception is `pass-through`, with
  one. `unenforced-precondition` has no precision cell because it fires on no labelled positive, and
  ungraded is what that is: not a pass.
- **RECALL IS THE WEAK HALF, everywhere, and it is the half a reader will misread.** `world` misses
  40% of its labelled positives, `unadmitted-failure` misses 36%, `cqs` misses 71%. A row that fired
  is trustworthy on this set. A row that did not fire means nothing. **A clean card is not a
  certificate**, and no surface may imply it is.
- **Four dimensions ship with a caveat, and only ONE of the four is held by policy.** The distinction
  matters, so it is spelled out rather than summarised:
  - `section-comment` is the one **`DEFAULT_ELEVATION` holds**. Its precision is 100%, so the
    sections it points at are really there. The open question is whether a 31.0% signal rate is a nit
    flood or a teaching point, and that depends on an audience the product cannot see. It is a human
    ruling rather than a measurement, and it moves one entry rather than any code.
  - `unenforced-precondition` **elevates when it fires**, but it cannot tell an obligation on the
    caller from a description of the function's own behaviour. It now REFUSES when it meets a modal
    it cannot attribute, which is why it has no precision cell above. **A quiet result there is not
    evidence the contract is enforced.**
  - `cqs` at 28.6% recall and `pass-through` at 50.0% recall **both elevate when they fire.** High
    precision, low recall: what they say is worth acting on, what they do not say is not information.
    `pass-through` also owns the set's only false positive.
- **The labelled set is 138 rows and it is thin in places it names itself.** `session-v61/graded/`
  carries its own README, and the floor on some dimensions is four positives. A 100% on four
  positives is a weaker claim than a 100% on thirty, and the table above does not distinguish them.
- **The free-identifier half of the honesty question is NOT in this build.** "Does this function read
  a name bound outside it" needs scope resolution through the symbol tree, and no name table can
  answer it, because the name is whatever the developer called their variable. Proven by running the
  name-table detector on the product's own canonical dishonest function: it catches the clock read
  and misses both the module-state read and the module-state write, which is the headline dishonesty
  in that example. **The surface must not imply the honesty question was answered whole.**
- **Full Sonar cognitive complexity does not ship.** Plain nesting depth agrees with it on 11 of the
  worst 15 Rust functions. Its unique catch is long functions with many sequential branches at
  moderate depth, worth 4 of 15, and that is a later item with a number attached rather than a guess.
- **"Writes to a log" was measured and dropped.** 16.1% of Python functions, and printing does not
  make a result unreproducible, so it is not the dishonesty this frame is about. Left in, the Python
  leg would spend its entire budget telling people their scripts print.
- **The Python corpus is 60 files gathered across one machine**, not a project. Its numbers are the
  softest in the set.
- **Nothing here was measured in the VS Code host.** Every detector grammar, every rate and every
  precision number above came from a headless run.
- **Dimension 15's 31.0% is a SIGNAL rate, not a precision.** Its precision on the labelled set is
  100%, which says the sections it points at are really there. It says nothing about whether a third
  of all functions having one is a problem, and that is the question the ruling turns on.
- **Nothing here was measured in the VS Code host.** Stated again because the table above invites the
  opposite reading: every precision and recall cell came from a headless run against a text corpus,
  through the same `sliceFunction` the gesture calls but not through the host that calls it.

## Chosen constants

Every number below was chosen and none was measured. They are also listed in `docs/constants.md`.

| constant | where | value | why this number |
|---|---|---|---|
| `MAX_DOC_WALK` | `criticizeSlice.ts` | 200 | a doc block longer than this is real but vanishingly rare, and the bound stops a malformed document turning the upward walk into a file scan |
| `BLAST_BOUNDS.D_MAX` | `criticizeBlast.ts` | 1 | not chosen so much as definitional: a blast radius is the direct call sites |
| `BLAST_BOUNDS.R_MAX` | `criticizeBlast.ts` | 2 | one more than the walk needs, so the DEPTH cap is what stops it; at 1 the request cap fires first and the result would report a budget cut where the walk in fact finished |
| `BLAST_BOUNDS.N_MAX` | `criticizeBlast.ts` | 500 | bounds a pathological fan-in; past it the walk reports no number |
| `BLAST_HANG_GUARD_MS` | `criticizeBlast.ts` | 5000 | well above the one request this walk makes; it exists only so a wedged server cannot hang a gesture, and when it fires the answer is nothing |
| `EXPLAIN_ROW_CAP` | `criticizeGesture.ts` | 6 | one model round per row, and past six the elevated block is already longer than a developer reads in one glance |
| `EXPLAIN_MAX_TOKENS` | `criticize.ts` | 384 | so a model that ignores the format cannot spend a minute per row before the line cap drops its prose |
| `EXPLANATION_MAX_LINES` | `criticizeExplain.ts` | 4 | the drop bound; longer prose degrades the row to its evidence line |
| `paramCountThreshold`, `nestingThreshold` | `criticizeLang.ts` | per language | the McCabe-era thresholds, kept because the lineage keeps them and not because a number was measured here |
