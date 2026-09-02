# Roadmap

Everything pending, one file. A session picks a slice, scouts it, builds it, and the slice comes out
of here when it ships.

**Four rules bind this file.**

- **Item numbers never move.** Items cross-reference each other by number, so a gap means that item
  shipped. What shipped and why is in `docs/roadmap-history.md`.
- **Pending work only.** If an entry describes something already done, it is in the wrong file. Move
  it to the history rather than leaving it here to be read as a task.
- **PROVEN** means tested. **REASONED** means read but not run. Three entries once said PROVEN of
  something read rather than run, which is the exact confusion the two words exist to prevent.
- **UNVERIFIABLE** is not a hedge. It marks a claim whose backing artifact no longer exists on this
  box, and it always names the check that would settle it. A recitation of a number inside a shipped
  comment is not the artifact. Do not re-quote a marked figure as a baseline; re-derive it, or take
  the marked one and say which you did.

Five sections: features, decisions waiting on the human, measurements pending, deferred fixes, and
the dogfood ledgers plus what has been rejected.

Last caught up 2026-08-24 by the ratification batch. S17 and S21 through S32 are RATIFIED (S24, S26
and S28 as corrected); the dated records are in `docs/supersessions.md`. Ten more rulings landed
inside their own items, marked **RULED 2026-08-24**, and the batch filed items 71, 72 and 73.
Session-v59 before it struck items 7, 21, 22, 45, 59, 60 and 61 and filed item 70.

Session-v60 struck item **14** and shipped it as 2.4.0. Its ratification batch is NOT ratified: 13
entries sit in `session-v60/ratification.md` awaiting the human, including the supersession of
ARCHITECTURE.md invariant 4's assertion clause, which the shipped code already relies on. Deferred
findings are in `session-v60/scraps.md`, every one carrying its content.

Session-v61 built **Criticize**, the read-only grading gesture: fifteen deterministic rubric
dimensions across five languages, a blast radius on the nine signature-level rows, and a model leg
that can explain a detector's finding and can never make one. Its subsystem doc is
`docs/architecture/criticize.md`. It leaves four things behind, and all four are recorded below
under "Criticize: what is not measured and what is not built" rather than as numbered items, because
the numbers are the ratification batch's to mint.

The un-ratified batch above is still un-ratified. Session-v61 must not be read as having settled any
of it.

Sessions v65 and v66 (2026-09-02) shipped dictation as 3.1.0, 3.2.0 and 3.3.0 and filed items 74
to 79. Item 78 was rewritten the same day: its "compiler check and repair on the head" clause was
already true through the post-accept hook, found when the human dictated a doc comment and repair
wrote the body. Session-v66 leaves four rulings for the human (S66-1 to S66-4, below under
"Decisions waiting on the human") and its deferrals under "Deferred fixes"; the full record is
`session-v66/scraps.md` and the release history is in `docs/roadmap-history.md`.

## The list, at a glance

**Features** - genuine builds, each wanting its own goal and scout.

- **70.** one exact `workspace/symbol` hit is called unambiguous, and the resolver hands the model a
  different type's surface between two runs over identical code
- **36.** resolution is the hole, not the budget: 69 real failures per run against the budget's 22
- **34.** C# and Go have a supply problem, not a cap problem
- **28.** three of five languages cannot anchor an imported type at all
- **27.** v34's items 1 and 2 exist for Rust only; four languages have the same hole
- **35.** the payload elision, in the two languages v37 and v40 did not build
- **37.** the worked-example leg quotes the wrong docs on 80% of its blocks
- **53.** a ratified test suite passes against a body replaced with `{ 0 }`
- **54.** injection walks downward only, so no caller-direction fact ever reaches the model
- **17.** ask the model which types it needs, then inject their surfaces
- **39.** other agent CLIs as fn-gen backends
- **11.** include block, the recursive variant
- **5.** the whole-block trigger cannot see how real code names its types
- **6.** the `selected:` prompt line was never measured
- **10.** the second call in a chain generates blind
- **8.** injection works on an idle box and vanishes on a busy one
- **9.** nobody knows the injection landing rate on any machine
- **13.** nobody knows what the ratified tests miss
- **16.** an invented member on line 2 of a ghost is never judged
- **64.** a drained FIM session holds its diff until the document is quiet - RULED, buildable
- **72.** the model download joins the in-flight registry - RULED, buildable
- **73.** thinking becomes a palette action, and numCtx becomes a setting - RULED, buildable
- **71.** the wrong-tree refusal, extended to TypeScript and Python
- **33.** the spike harness spliced on stale offsets: a record and three standing rules
- **18.** the rest, unchanged in priority

**Measurements pending** - a number from the harness is a hypothesis until the instrument that
produced it has been looked at.

- **2.** a frozen live test is red and nobody runs it
- **30.** item 1 needs a third arm before anyone knows what it did
- **41.** the tuning constants were chosen for a local 30B and now gate a frontier model
- **42.** repair supply outside Rust
- **43.** nothing measures how often a real session overflows the window
- **47.** Python's pre-fill gate is decomposed, and its stated cause was wrong
- **48.** the injected surface carries no imports, in any language
- **49.** the count cap's server justification is measured false on Python and untested on TypeScript
- **50.** the gather buys a hover per collaborator the render drops
- **62.** the C# inject arm flaps on 3 of 46 rows
- **65.** the import hint names crates the target does not link
- **74.** dictation on macOS and Windows is built and unproven
- **75.** the speakers are not muted on Windows during a take
- **76.** dictation over Remote needs a `ui`-kind companion extension
- **77.** the fuzzy matcher and the recogniser prompt, deferred with their measurements
- **78.** dictate a declaration: the name and parameters matched rather than guessed, and fifty
  real gestures; the check, repair and body already run
- **79.** GPU builds of the recogniser (Metal, CUDA, Vulkan)

## 1. Features

### 70. One exact `workspace/symbol` hit is called unambiguous, and the hint is never spent

Filed 2026-08-23 by session-v59 phase 6, found while characterising item 62 rather than while looking
for it.

`resolveCsTypeCursorWithHint` treats a single exact `workspace/symbol` hit as unambiguous and returns
without spending the hint it was given. The C# arm corpus declares `class Datum` twice in two
namespaces, and the row reaches both: **58 members on one run, 86 on the next, disjoint member
lists**. The tie-break is deterministic. The list it reads is not.

So the product's own resolver can hand the model a different type's surface between two runs over
identical code, and it does not know it did. Roslyn's answer depends on how much of the solution is
indexed at the moment of the ask.

REASONED as product-visible, not PROVEN: the resolver under test is the product's own
`resolvePrefill`, matched code-to-diff rather than instrumented, because instrumenting it needed
`src/` and the phase that found it was forbidden that file.

**Direction RULED 2026-08-24: refuse ambiguity.** The resolver refuses rather than serve a surface it
cannot pin - consistent with honest-dark, and with S28's own "two sites are two things, guessing is
the worse failure". The scout still prices the lost surface before the build ships; the ruling sets
the direction, not the number.

**Why it is a build and not a one-liner.** Refusing costs a surface the model would otherwise get,
and the budget was ratified on the assumption that a resolved type is a resolved type. The build has
to measure what the refusal costs on the C# arm before it lands.

Falsify: two same-named types in two namespaces, the hint naming one of them, and the same member
list every run.

### 36. The budget was never the big hole. Resolution is: 69 real failures per run against the budget's 22

Counted 2026-08-03 off the 237-row prefill arm. Denominator is reasons emitted per run: why a KEPT
candidate produced no injected block.

| reason | per run |
|---|---|
| defined in the standard library (correct refusals, the design working) | ~380 |
| nothing renderable - the resolver reached the type and derived nothing | **53** |
| shared-budget starvation (the line v39 measured and v40's render-pass budget took on) | 22 |
| no anchor found - no reference cursor at all | **16** |

**UNVERIFIABLE, the whole table** (C119, C120): the scrap was archived on the sessions branch scrubbed
2026-08-10 and exists in no ref. Re-run the 237-row prefill arm and re-count its reasons; that is also
the cheapest way to a fresh baseline, so the scout should plan on producing the number rather than
quoting it.

The 53 + 16 are resolution failures, three times the budget line two whole sessions worked on, and
nobody has weighed anchor on them. They belong to candidate anchoring and hover parsing, not to the
injection budget. The scout's first job: are the 53 one shape or fifty?

One member of the class is PROVEN (v38 scrap S38-9, live rust-analyzer through the product's own
extractor): a project TRAIT gets no members and a bare-head hover - the opposite of the enum hole v39
closed - so every trait-typed collaborator likely lands in the 53.

Rig and baseline are warm: 237 rows, v40's generation pair 63 and 66 of 237, noise floor 3. Sibling
of item 37; they share the rig, the baseline and probably the session.

### 34. C# and Go have a SUPPLY problem, not a cap problem

Measured in session-v37 on real production code. On 117 C# methods from a 162-file .NET solution the
product names **1.7 candidate types** against **7.3** the body actually uses, and the type it needs is
anywhere in the candidate list **4.3%** of the time. Raising the cap to 24 changes nothing, because
there is nothing to cap.

| corpus | lang | rows | mean candidates | mean needed | ceiling | recall @4 | recall @12 |
|---|---|---|---|---|---|---|---|
| acme-db | rust | 2362 | 20.1 | 2.8 | 83.8% | 28.5% | 62.1% |
| OSS rust crates | rust | 416 | 8.6 | 1.7 | 72.6% | 36.6% | 68.0% |
| cobra+gin+hugo | go | 926 | 1.9 | 3.0 | 14.8% | 14.2% | 14.8% |
| column-80 | typescript | 205 | 9.9 | 1.6 | 43.7% | 31.4% | 38.5% |
| contoso dotnet | csharp | 117 | 1.7 | 7.3 | 4.3% | 4.3% | 4.3% |

**UNVERIFIABLE, every row** (C123, C125, C126): the v37 data chain is gone, and the surviving
`candidates-oss.json` holds 183 rows against the table's 416. Re-run the two-corpus oracle and the
five-corpus spike. The Go half is cheaper - `candidates-go-wide.json` is on disk with 7,185 rows and
supports a fresh ceiling census under the current recipe.

**The SHAPE is not in doubt, because the cause is a fact about the code.** A Go import line carries a
package path and a C# `using` carries a namespace, so neither line ever spells a type name
(`fnGen.ts:4071-4076`, `:4717-4721`). The qualified-usage legs shipped in v40
(`goTypesFromQualifiedUsage`, `csTypesFromQualifiedUsage` in `src/core/repairTypes.ts`) mine
`pkg.Type` and `Namespace.Type` out of the signature and body, correlated against the file's own
import block. Go also gained the by-name workspace-symbol anchor C# already had. Measured on the Go
rig: ceiling 5.5% -> 7.6% across 2,890 functions; C# flat at 2.6%, mechanism built and no effect
measured there. **UNVERIFIABLE** (C133): no 2,890-row artifact survives and the pair is unrecoverable
in recipe. A fresh census over `candidates-go-wide.json` produces a comparable number.

**Go's answer is the taught convention, and it is measured end to end.** The human ruled the organic
channel out of scope: column80 users are taught to doc-comment the target, so the AUTHORED population
is the real one. On a six-repo corpus (cobra/gin/hugo + pgx/quic-go/goleveldb, 7,185 clean rows) the
authored-gesture funnel over 907 rows measured parse 70.6% -> candidate 87.6% -> in-cap 50.9% ->
injected 34.8%, binding stage THE CAP. A cap ladder put the knee at 8; `GO_PREFILL_TYPE_CAP = 8`
shipped (Rust stays 4 - its own 4->12 arm measured flat, which is WHY), superseding nine frozen v37
rows as S15. Funnel at the shipped cap: in-cap 78.8%, injected 53.9%. The generation arm, 237
authored rows, two runs each: **inject 13.6% vs dark 4.9% compiled, +8.7 points, ~2.8x, spread under
1 point** - the product-claim number for the convention. Residue upper bound (types a heavy doc would
not name, per go/types): **62.9% of instances**, the remaining supply frontier, unbuilt on purpose.
The clean ceiling recipe is `session-v42/spike-0-ceiling.cjs` at 17.8%.

Two things still gate a Go supply figure:

- **The backtick gesture is the only channel these two languages have.** v37 widened it so
  `` `*Config` ``, `` `http.Client` `` and `` `Contoso.DataModel.Widget` `` all resolve; before that
  it refused **79.8%** of how Go spells a type in a real signature. **UNVERIFIABLE** (C129): only a
  code-comment recitation survives (`src/core/compilerDirected.ts:1112-1116`). A fresh spelling census
  over the Go corpus would check it.
- **A widened gesture still has to ANCHOR**, and neither language has an import leg to anchor
  against: **82.5% of Go and 87.2% of C# named types have no per-file anchor at all**. Both partially
  recover through workspace-symbol (`csLspExtractor.ts:554`, `goLspExtractor.ts:385`).
  **UNVERIFIABLE** (C130): the two percentages appear nowhere on disk. A re-run of the anchor census
  would check them.
- **S40-3, open:** the candidate leg admits mostly NON-types. Sampled cobra file: 3 real types in ~29
  mined names, because every exported Go identifier capitalizes. It fails SAFE (the container filter
  refuses a non-type hit) so the harm is cost and dilution, and each miss burns a live
  workspace/symbol round trip. The cheapest lever - refusing a mined name immediately followed by `(`
  - shipped with the v42 corpus; the residual dilution is what stays open.

**This is a build with its own scout, and the two languages need different mechanisms.** Do not
assume one leg serves both. What remains is the NEXT supply leg, not a re-run of this one.

### 28. Three of five languages cannot anchor an imported type at all

`pyFindTypeReference`, `csFindTypeReference` and `goFindTypeReference` have no import scan: they look
in the span, then at a same-file definition, then give up. So an imported collaborator is only
anchorable when the target's own signature or body names it. REASONED, session-v34 - read, not run.

Deliberately not swept from Rust, because it is a decision rather than a copy: a Go import names a
package path, not a type, so "anchor at the import line" does not mean the same thing in all five.

Related and already fixed in v34: the Rust and TypeScript scans tested each line in ISOLATION for a
leading `use`/`import`, so no type from a rustfmt- or prettier-wrapped group could ever be anchored -
the dominant shape in real code. Measured on `acme_crypto::create_ca`: injected types went from 1 to
3 once fixed. **UNVERIFIABLE** (C143): no artifact carries that count; what survives is a prose
relative in the source (`fnGen.ts:3442-3444`). Re-running `session-v34/witness-prefill.cjs` on the
same task would check it.

Go's half of this gap was G3, RULED 2026-08-24 leave-as-is (see the Go entry under Decisions): an
imported Go type stays anchorable only when the signature or body names it. Python and C# are what
this item still owns.

### 27. Items 1 and 2 of v34 exist for Rust only, and four languages have the same hole

Session-v34 measured, on 230 rustc rows, that the round-1 prefill was spending its budget on types
the model already knew. `PrefillLang.isStdlibDef` decides that on PROVENANCE - the definition URI the
resolver already asks for - and only Rust fills it. Same for `RepairSurfaceLang.harvestTypes`.

The defect is not Rust's. TypeScript has `Array`/`Promise` out of `lib.*.d.ts`, C# has `List<T>` out
of reference assemblies, Python has `dict`/`Path` out of typeshed, Go has `strings.Builder` out of
`$GOROOT/src`. The seam already fits all five.

**The "they already have std name sets" defence does not hold.** `TS_STD_TYPE_NAMES`,
`CS_STD_TYPE_NAMES`, `PY_STD_TYPE_NAMES` and `GO_STD_TYPE_NAMES` guard the candidate list and the
recursive hop. That is EXACTLY the protection Rust already had: `Path` is in Rust's `STD_TYPE_NAMES`
and still shipped a private field and 24 method signatures into a prompt headed "use these exact
names, do not invent", because no name set guards the ROOT render.

Needs a scout, for three reasons that each change what gets built:

- **C# may have no URI to test.** Roslyn answers a framework type with metadata-as-source, which may
  carry a synthetic URI or none at all. A provenance test against a URI that never appears would
  silently never fire, which looks identical to a working feature.
  `session-v34/witness-provenance-langs.cjs` was written to answer this for all four at once and was
  never run; if that folder is gone, the witness is ~200 lines and re-derivable from
  `CsLspExtractor.start` plus the four dogfood roots.
- **Go's design call is answered, so do not re-open it.** `goShapeHooks` is Go's own
  (`crossFileShape.ts:613-640`) with the `parseGoHoverFields` field leg lit in v49, its own
  `GO_STD_TYPE_NAMES` stop set and a qualifier-aware `skipCandidate`, wired on the pre-fill path
  (`fnGen.ts:4891`). What is left for Go here is the provenance test itself, same as the other three.
- **The measurement arms exist for two of the four.** Go: `candidates-go.json`, **3,995 rows**,
  scored through the product's own `goOracle` at a ~1.7% spread across two runs; the runner that
  produced it, `05-inject-run.cjs`, is off disk, so re-running means rebuilding the driver. C#: five
  pinned OSS repos at `~/sandbox/v43-corpus` (Autofac, seq-api, serilog, NodaTime, Polly), 2,100
  candidate methods scored through `csOracle`, gated both directions per repo; `lib-cs-scan.cjs` and
  `lib-cs.cjs` are on disk, the corpus builder is not, so the rig is one file short of a re-run.
  contoso is the held-out private row (168 candidates). TypeScript and Python arms are unbuilt.

**And the reason to insist on the scout:** the arity leg went in TS-only, came back out, and left the
standing rule "do not reintroduce without measuring four languages". Four new legs with the
measurement half unbuilt is that same shape.

### 35. The payload elision, in the two languages that did not get it

Rust shipped in v37 and Python in v40. The Rust mechanism was widened a long way in v39 and whoever
builds the two below reuses the wider one: `src/core/rustHoverRecovery.ts` restores struct-variant
payloads (`Leader { lease_epoch: u64 }`) and the members a LIST cut dropped, for `enum` and `struct`
alike, refusing the whole type on any disagreement, on a `#[cfg]` inside a payload, or on a cfg-gated
body when a cut is present. Read it before writing a second parser.

**UNVERIFIABLE, the rates** (C151, C154): the Rust 224-of-224 and 29-of-29 pair has no artifact -
`session-v37/spike-10-elision-rust.txt` is the PRE-build capture and still renders
`Complete( /* … */ )` - and v39's 56-against-47 survives only as a CHANGELOG recitation. The
MECHANISM is in the tree and is not in doubt. Whoever builds Go or C# is running an arm anyway.

**Go first.** A Go enum is a named integer type plus a package-level const block, and gopls hovers the
type alone. cobra's `ShellCompDirective` injects one line and one member while the eight directives a
caller must name are nowhere. Rust at least prints the variant and hides its payload; Go prints
neither. Frequency: 23 of 93 named non-struct types in cobra, gin and hugo carry a typed const set,
24.7%, declaring 166 constants. Same order as Rust's 50.0%, and it lands on the language item 34
already calls supply-starved. Reuse the definition-source walk item 5 built.
**UNVERIFIABLE** (C161): those three counts appear nowhere on disk. A typed-const census over the
three pinned clones the Go rig already uses would check them, and it is cheap.

**But note the ordering principle v40 wrote down:** for Go, SUPPLY (item 34) comes before rendering
work like this, because rendering pays only where the candidate list already contains the type.

**C# last.** A C# ENUM is fine: Roslyn hovers it, documentSymbol returns the variants, and the
`enumMemberLine` hook already spells them `ThreatLevel.Minor`. A POSITIONAL RECORD is not: hover
gives the qualified name only and `membersOfType` returns nothing, so
`record StripeSummary(int Aggregate, ...)` reaches the model with its constructor invisible.
**UNVERIFIABLE, the record probe** (C163): the artifact is off disk, and v38's `membersOfType`-empty
probe is the TRAIT one, a different case. Re-probing a positional record against Roslyn checks it,
and that is the first step of building the fix anyway.

The frequency half IS backed: a Roslyn semantic census over the five pinned OSS repos (2,100
candidate methods) counts **10 positional records**, and contoso declares **1**. Real and genuinely
low across 2,268 methods. That argues for keeping C# last, not for closing the item - the render is
still wrong where it fires.

**TypeScript needs nothing.** Unions render verbatim, including a 178-byte discriminated union with
its payload objects intact. An interface hovers bodyless but its fields arrive through the member
list.

### 37. The worked-example leg quotes the wrong docs on 80% of its blocks

Counted 2026-08-03 while validating v39's phase 3, not while looking. A prefill block headed
``Usage example for `ShardConfig` (from its docs, this compiles)`` carried the standard library's
`core::cell` documentation; `ShardConfig`'s own doc comment is two lines with no example in it. Both
claims in the header are false.

Counted over the 237-row prefill arm, denominator is usage-example BLOCKS: v38 shipped 35 of 44
blocks never name their own type; v39 40 of 49. Pre-existing at 80% of the leg, not caused by v39 -
v39 only made it 5 blocks more visible by pushing budget-starved types onto the example leg.

**UNVERIFIABLE in full, and this item has no other evidence** (C166, C167): the counting scrap lived
on the scrubbed sessions branch. Re-count usage-example blocks that never name their own type over a
fresh 237-row arm. That is the same arm item 36 needs, which is why these two are siblings and should
share a session.

The obvious guard is not obviously right: refusing an example that never names its own type deletes
35 of 44 blocks, most of the leg. Whether those 35 help or hurt is a MEASUREMENT - one arm with the
leg gutted, one with it harvesting the right docs - not a reading.

### 53. A ratified test suite passes against a body replaced with `{ 0 }`

PROVEN 2026-08-12, on one function, and the proof is two minutes of work anybody can repeat.

**The function is `trim_out_client_sets`**, written up at `docs/dumb-models-work.md:360` (the `{ 0 }`
stub), `:345` (the 406-byte fixture arithmetic) and `:325` (the qwen suite itself).

It enforces a 4 MiB cap. Asked for tests blind of the implementation, `qwen3-coder:30b` produced five
scenarios whose largest fixture serialises to **406 bytes**, off by a factor of roughly 10,300. Every
scenario sits under the cap, `0` is the truthful expected value for all five, and the human typing
`0` five times was typing the right answer every time. The model's own comments name the intent it
could not build: `// Both sets trimmed` sits beside an assertion that zero were trimmed.

Replace the body with `{ 0 }` and rerun: the qwen suite passes, the `gpt-5.6-sol` suite fails on its
second scenario. Both pass against the real implementation, so a green board does not distinguish
them.

**Why this is structural and not a model-size complaint.** Implementation from a spec is translation:
the doc comment names the shape, the injected surface names the tools, and a 30B renders it fine. A
test from a spec is adversarial construction - you have to invent inputs that reach the states the
spec describes. Nothing in the injected surface says `SUMMARY_PAYLOAD_MAX_BYTES` is 4 MiB, that
reaching it needs tens of thousands of entries, or that one `Option<Vec<u64>>` field is a cheap lever
on `wire_size()`. Sol found that lever and wrote a doubling search plus a binary search. Qwen did not,
and defaulted to what compiles.

**The blanked-expected-values rule cannot save this, and that is the sharp part.** Ratification worked
exactly as designed. No wrong value entered the suite. The suite is still worthless.

Two candidate builds, not exclusive:

1. **Refuse rather than emit.** The classifier already refuses async, IO, needs-fixture and
   underspecified. A threshold function whose fixture must span orders of magnitude is arguably the
   same category, and refusal is the product's existing answer to "cannot do this honestly".
2. **Supply the constants.** The doc comment names `SUMMARY_PAYLOAD_MAX_BYTES` and the injected
   surface does not carry its VALUE. A const-value leg is small and deterministic. Scout whether that
   alone moves fixture quality; it is much cheaper than the alternative.

Detection belongs to item 13, whose ranking puts a single trivial-return mutant first for exactly this
reason. This item is the defect; 13 is the instrument that would have caught it.

### 54. Injection walks downward only, so no caller-direction fact ever reaches the model

Raised 2026-08-12. REASONED, from the injection log of four real generations.

The pre-fill walks INTO the enclosing type: its fields, its nested types, their public members,
roughly depth 2 inside the token budget. Every failure in that session's round table that was not a
spec defect was a fact living in the other direction:

- the function runs inline on a single-threaded executor, so an O(n) call inside its loop stalls the
  event loop
- the vec it iterates is sorted and binary-searched by a read path two crates away, so plain
  iteration order is a permanent per-tenant bias

Neither is reachable at any depth downward. The frontier model missed both exactly as the 30B did,
which is the evidence that this is an injection property rather than a capability one.

Today the human writes those facts into the doc comment, and that works. The open question is whether
any of it can be supplied deterministically, and the obvious version is expensive:

- **Callers** are a reference query the language server can answer, but rendering them costs budget
  that item 41a says is already the binding constraint, and most callers are noise.
- **Enclosing-file or module doctrine** is cheaper and blunter: a crate- or module-level comment
  stating "this path runs on the shard executor", injected for every function in it. That is a
  convention the way item 34's Go answer became a taught convention, not a resolver feature.

Scout the second before the first. And price it first: how often does a real generation fail on a
caller-direction fact rather than on a spec defect? On the session's evidence it was one round of
five, and one function is not a rate.

### 17. Ask the model which types it needs, then inject their surfaces

Human idea, 2026-07-26, unscouted.

The problem: fn-gen's pre-fill picks types deterministically from the signature, doc and span. When it
picks wrong, the information arrives one round late. The v24 capture: with no context, the 30b
invented three struct fields, and repair's struct-def surface fixed them one round later. The info
existed; it was late.

The idea: before or during generation, the model names the types it considers relevant, the product
resolves those through the AST/LSP, injects their real surfaces, and re-prompts.

Why it is plausible:

- Type surfaces are compiler-verified, so a wrong suggestion injects a real-but-irrelevant surface.
  The failure direction is wasted prompt budget, not invention.
- An invented type name resolves to nothing; the resolve step fails open (skip and log).
- The 30b can articulate what it is missing: the v24 punt text contained the model's own correct
  diagnosis, and the product discarded it.
- Latency is affordable here: fn-gen's floor is seconds. Banned at the FIM path, as always.

Shape recommendations, to settle in the goal:

- Prefer the conditional form over always-two-rounds: the generation round emits either a body or a
  "need: TypeA, TypeB" request. The second round is paid only when the model is uncertain, and the
  request is anchored by a real attempt.
- Sequence against item 5. The alias/DI gap closes deterministically and covers the biggest measured
  stratum; this item catches the semantic residual the AST cannot see. Deterministic-first is the
  standing rule.
- Contract: the model's requested list is logged and shown like every other prompt input. The injected
  content stays compiler-verified.

**The scout question that prices the whole item: how often does a real fn-gen round get fixed by
repair injecting a surface that could have been known up front?** The counting rule to run against a
fresh arm: count the rows whose round-0 errors are all `unresolved-method`, `unresolved-assoc` or
`unresolved-field` against a type the repair round then resolved.

**That rate is no longer countable off anything on disk** (C171). It used to come off a 181-row arm
with round-0 and repair errors recorded per row; that file and the chain around it are deleted. The
question is unchanged and still the right first move; answering it now needs a fresh arm. Price the
scout accordingly.

**Read this before scouting; it moves the odds.** Item 1 was the last serious attempt at picking types
better by heuristic, and it was measured and REFUTED. It excluded standard-library roots on
provenance, freed their slot in the type cap, and cut injected bytes by 11.2% overall and 39.7% on its
own 24-task subset. Compile rate went 16.0% to 13.8% across 181 rows, total errors 688 to 733. No
effect, and if anything slightly worse. **UNVERIFIABLE** (C169): the v34 arm data is deleted, so every
figure there is a recitation; item 30's third arm is the check. The REFUTATION does not depend on the
exact figures - nobody has produced evidence that better heuristic picking moves the rate.

Two consequences, pulling the same way:

- **Better heuristic selection is not where the win is.** Deterministic picking has been tuned,
  capped, re-ordered and provenance-filtered, and the rate has not moved. Item 17 does not compete
  with a heuristic that works; it competes with one measured flat.
- **The "wasted prompt budget" worry is smaller than this item assumed.** Removing 40% of the injected
  bytes changed nothing, so budget is not the binding constraint on this corpus.

A concrete "info existed, one round late" case, from a live capture on `acme_crypto::create_ca`.
Round 0 injected `PkiError`, `DnType` and `CertificateParams` and produced 2 errors, both about types
round 0 never saw: `SignatureAlgorithm::ECDSA_P256` and `Certificate::serialize_der`. Repair injected
`KeyPair`, `SignatureAlgorithm` and `Certificate`, and the count fell to 1. The body then called
`KeyPair::generate_for` and `Certificate::der`, both straight off the surface it had just been handed.
So on that row the answer is yes, twice. **UNVERIFIABLE** (C170): that capture is on no disk; a live
fn-gen plus repair round on the same function re-witnesses it, and the class is common enough that any
fresh capture will do.

One caveat that must not get lost: every rate above was taken on a harness where the visibility filter
was dead (item 29, since fixed), so the absolute numbers are not the product's. The comparison is
sound because both arms ran there.

### 39. Other agent CLIs as fn-gen backends: codex, opencode, and whatever comes next

Human ask, 2026-08-08, immediately after item 38 landed. RULED not-now in that session, deliberately,
so item 38 could ship on one proven backend rather than three guessed ones.

What item 38 already paid for and a second CLI reuses unchanged: the `InstructGenerateFn` seam, the
fence strip, the neutral-cwd contract and its fail-closed wiring, the abort and watchdog discipline,
the typed failure taxonomy, and `claudeModelLabel`'s rule that evidence names the server of a round.
`src/core/claudeCodeInstruct.ts` is the worked example.

What is Claude-specific and must be rebuilt per CLI, all three small: the argv (today
`BASE_ARGS = ["-p", "--output-format", "json", "--strict-mcp-config", "--tools", ""]` at
`claudeCodeInstruct.ts:139`, where `--tools ""` was added so the CLI cannot go agentic, `:129`), the
JSON field names (`result`, `ttft_ms`, `duration_ms`, `stop_reason`, `num_turns`, `is_error`,
`subtype`), and the failure-text patterns (`/not logged in/i`, the rate-limit family).

**Do not write the adapter from documentation or memory.** Item 38's whole risk was retired by spiking
the real CLI on the real box first, and that is what found the fence trap (replies arrive fenced
despite an explicit no-fences instruction) and the MCP leak (user-scope servers attach in any cwd) -
neither of which any amount of reading would have surfaced. `codex-cli 0.144.4` is installed on this
box and emits a JSONL event stream rather than a single result object, so its `result`-equivalent has
to be found, not assumed. One spike call per CLI, recorded, then the adapter.

The design fork is RULED 2026-08-24: one small adapter per CLI. Honest per-CLI failure taxonomy,
honest messages, N modules; the generic spawn-a-command backend is rejected because it hands
prompt-bearing argv to a user-supplied string and gives up the taxonomy that makes the disabled
messages actionable. Every new CLI gets spiked live on the real box before its adapter is written -
the rule that caught the fence trap and the MCP leak.

### 11. Include block, the recursive variant

The single-block half SHIPPED in v32: Add Enclosing Symbol and Add Enclosing Block are both live, in
all five languages, with the selectionRange chain falling back to the enclosing symbol where a server
answers badly. What is left is the recursive variant, unscouted.

Include the block, then everything it calls, to a depth limit. Real design tension:

- It must not break human-curates-everything. One click ratifying N machine-picked blocks is
  suggest-and-ratify: every block lands in the panel individually, visible and removable. Silent
  prompt-dumping is banned.
- Fan-out is the unmeasured cost. Depth 2 on a hub function can be dozens of server round trips and a
  blown prompt budget.
- Scout: call-hierarchy latency per language on the real repos, depth-2/3 tree sizes on
  acme-db-scale code, and the fn-gen prompt-budget hit.
- Expect the answer to force a cap, dedupe, and possibly signatures-only beyond depth 1.
- fn-gen/repair path only. Never the FIM keystroke path.

### 5. The whole-block trigger cannot see how real code names its types

Whole-block injection fires only when the SIGNATURE names a concrete user type. Real code mostly does
not do that, so the highest-value sites get no injection at all.

Measured, per stratum (v22 scout):

- **Aliases:** acme-db reaches `ShardMemCache` through `type MemCache = ...` at 17 of 32 call sites.
  Those sites score 0.0% recall in every arm, even when injected by hand.
- **Interfaces:** contoso consumes its CSV types only as `ICsvMonitor`. The concrete 45-property type
  never appears in a signature.
- **Dependency injection:** lansura's stores make 132 consumer functions invisible against 15 seen.
- **New face (v24):** a signature naming only `Option<u64>`/`u64` logs `injected=false` - no user
  type, nothing to key on. **UNVERIFIABLE** (C182): that capture is on no disk. A live fn-gen round on
  a signature naming only std types re-produces it in one gesture.
- **New face (v25):** 10 of 30 Rust empty-body sites are not injectable, so they fall to the bare
  bound.

Three fix shapes, in cost order:

- Resolve local `type X = Y` aliases at harvest time. A file-text scan; no LSP round trip.
- Resolve an interface-typed param to its sole implementor when the workspace has exactly one.
- Give up on the signature and type the RECEIVER at the cursor instead.

The attachment question the scout must answer: the 0.0%-even-when-injected result says naming the
alias's TARGET may not be enough. The block may need to speak the alias's own name.

### 6. The `selected:` prompt line was never measured

The usage-windows half SHIPPED in v29 (`resolveUsageInBudget`, called at
`completionProvider.ts:777`, its own `usageExamples` switch at `:452`). What remains is the cheap half
nobody ran.

- Today the prompt is rewritten to the highlighted member and injection narrows to that member's
  signature. The member is never named to the model on its own line.
- The work: measure that shipped narrowing against an explicit `selected:` prompt line. No such line
  exists in `prompt.ts` or `fimInject.ts`.
- Baseline from the v22 scout, 60 real call sites, 8 seeds: no injection 39-42%, selected member's
  signature only 76%, signature plus usage windows 78%. **UNVERIFIABLE** (C187): only
  `session-v22/harness/analyze-spike2.cjs` survives; its inputs and results are gone. The arm this
  item wants produces its own baseline, so run both arms rather than trusting these three as the
  "before".
- If the delta is real, the line is nearly free. A night, not a session.

### 10. The second call in a chain generates blind - RE-MEASURE first

Update 2026-09-02 (session-v65): the 35 chain sites sit at 9 of 35 in every dictation arm (bare 8), heard, cleaned, backticked, with surfaces at three budgets, and rambled, and the 40-site authored chain row reads bare 12, comment 11, surfaces 10; the spoken intent does not reach the second dot. The mechanism named here stands.

The outcome stands: in `results.iter().map(|r| r.` the closure receiver's members are never injected,
and chained style - LINQ, EF, Rust iterators, TS functional - generates with nothing.

**The mechanism most documents state is wrong, and it matters because the fix hangs off it.**
Injection does not key on "the first dot of a statement". It keys on the dot AT THE CURSOR, and it
requires a plain-identifier receiver (`src/core/fimInject.ts:2`, and `:109-112` where a `foo().`,
`arr[0].` or bare-`.` receiver "we cannot name" is refused). Mid-chain dots die on the
plain-identifier rule. Anyone building against the old sentence would have gone looking for a
statement scanner that does not exist.

v27's chain warm (`src/core/chainSurface.ts`) fixed an ADJACENT failure. Do not read it as closing the
item:

- What it fixes: Roslyn serves 115 items at a `List<Tile>.` receiver with no signature on any
  unresolved item, `Where<>` sits at position 113, and `MEMBER_RESOLVE_CAP=32` never reaches it. A
  once-per-workspace background warm fills the missing signatures.
- That is members-present-but-signatureless. Item 10 is members-never-injected-at-all.
- The warm is C# only (`completionProvider.ts:280`). Rust iterators and TS functional chains, the
  motivating cases, are untouched.

Standing instruction before anyone scouts: re-measure the per-member-call invention rate at second-dot
sites on the current product, per language. The 7-8% flat figure predates the warm. If C# moved and
Rust/TS did not, the item shrinks to those two.

- TS2339 ("property does not exist") is the single largest error code in the whole compile spike.
  **UNVERIFIABLE** (C194): no error-code tally survives, only the harness classifier that would have
  produced one. The re-measure this item already demands is that run.
- Needs: element-type unwrapping at a collection receiver, plus a per-statement injection cache that
  outlives a single dot.

### 8. Injection works on an idle box and vanishes on a busy one

Measured under 28 CPU spinners, 20 warm keystrokes each. "Delivered" means the facts reached the
model:

```
C#  20/20     TypeScript  17/20     Rust  3/20     Python  0/20
```

Backed: the run is recorded at `session-v16/session-state.md:188-196` with raw probe logs at
`session-v17/scout-logs/`, and `session-v17/scout-insights.md:18-28` re-measured the same arm on this
box (TS came out 18/20 there).

Two different failures, not one:

- **TS and Python die on request COUNT:** one keystroke fires hover requests in parallel against a
  server that answers one at a time (`src/core/extraction.ts:1072-1074`). The cap is 32, not 8
  (`extraction.ts:1095`), and the cost is now bounded by `HOVER_FANOUT_BUDGET_MS` at 50ms (`:1176`)
  rather than by the count. That changes the busy-box question rather than answering it: a time budget
  on a server that cannot be cancelled bounds when the product stops WAITING, not how much work it
  queued.
- **Rust and Python die on the RECEIVER:** one member-resolve call costs 44-75ms of a 50ms window, so
  nothing downstream ever starts.

The fix has a forced order. Do not reverse it:

- FIRST decouple: today the provider kills the argument-type leg whenever the receiver renders empty.
  Cutting receiver cost first would kill that leg instead of freeing budget for it.
- Detail: narrow the early-return to the empty-signature branch only.
- Detail: an argument-types-only block must not carry the "use one of these exact names" header, or it
  announces an empty list.
- THEN cut receiver cost per language.
- Do NOT tune another timing constant. The language-server work cannot be interrupted, so a deadline
  never bounds it. Three tuning passes died proving this.

### 9. Nobody knows the injection landing rate on any machine

Made concrete on 2026-07-25: an apt upgrade killed CUDA at 07:29, the model ran CPU-only all morning,
injection silently degraded on the reference box, and nothing recorded it.

- There is no counter. The only signal is a channel line nobody reads.
- On a weaker user's machine, injection could be silently off forever.
- The build is small: count landed / skipped / no-site, per session, per language.
- Surface it somewhere that gets read when things are GREEN. Failure-only messages go unread; a
  correct diagnosis once sat in a known-red test message for a whole session.
- This counter gates every hardware-adaptation argument. Do not act on deadline-adaptation reasoning
  without it.

### 13. Nobody knows what the ratified tests miss

The TDD gesture ratifies tests, they pass, and nothing measures what they fail to cover. A green suite
can be hollow, and item 53 is a PROVEN instance of exactly that.

None of these may ever become a model-optimized target - Goodhart's law: tests that execute lines and
assert nothing. They are ranked, because shipping them as a bundle would hide which one does the work:

1. **A single trivial-return mutant, first.** No framework, no `cargo-mutants`, no runtime question:
   one body replaced with `return Default::default()` and a rerun. It is the direct counter to item
   53, it cannot produce a false positive worth debating, and it retires the "is the runtime a
   nightly" scout question for the cheap case.
2. **Property tests.** An off-by-4 running-total drift survived every example test in the repo, and
   would survive coverage AND a trivial-return mutant. It dies instantly to a generated-payload
   invariant. Arithmetic drift is precisely what a small model produces from an ambiguous spec. The
   design question belongs in the scout: if the human types every expected value, the human types the
   invariant too, and an invariant is harder to type than a scalar. That may be the honest reason this
   rung is second rather than first.
3. **Coverage, as a pre-filter only.** It WOULD have caught item 53's suite, because a 406-byte
   payload returns at the guard and leaves the sort and the loop unexecuted. It goes blind the moment
   a fixture reaches the code without asserting the outcome, which is the more common hollow test.
4. **Fuzzing stays off this rung.** It earns its keep only on parse/decode/boundary functions - a
   classifier problem first, possibly just a template the TDD gesture emits. Item 53's function parses
   nothing and takes no untrusted bytes. **UNVERIFIABLE** (C227): the claim that its subsystem's real
   fuzz target is a sidecar deserialiser lives only in a client repo this box does not read. It
   changes no decision.

**Full mutation testing** stays scoped as before: mutate the accepted function, run the ratified
tests, every surviving mutant is a proven hole no coverage number can fake. Expensive by construction
(one test run per mutant), so never the accept path - a deliberate gesture or a background pass.
Scout: shell out (cargo-mutants, Stryker, mutmut; Go support thinner) or mutate through the product's
own span machinery, and does runtime make it a nightly?

The mocking question, answered honestly or not at all:

- The standing rule stays: refuse un-auto-testable functions rather than emit hollow or mocked tests.
- The real question: on mock-heavy C# (constructor-injected everything), does the classifier refuse so
  much that the gesture is useless there?
- Measure the refusal rate on real C# first. Then choose: interface-stub scaffolds the human fills, or
  accept the gesture is for leaf logic.

Item 14 shipped in 2.4.0 and the machinery all of this reuses now exists: the call walk discovers a
function's covering tests in four languages, and both executors run a discovered set rather than only
a generated one. The dependency is discharged.

Item 14's surviving half lands here, unbuilt: **coverage as an oracle**, where untested branches seed
test generation and exercised paths inform repair. A signal to the human, never a model target. Its
own scout question is coverage tooling cost and latency, and it is the same question rung 3 above
asks, so they are one piece of work.

None of this reduces how much the developer has to think and it must not be sold that way. Green
currently tells them nothing, so suspicion spreads evenly over everything a generation produced. One
line saying *this suite survives a stub* collapses that into one place to look.

### 16. An invented member on line 2 of a ghost is never judged

Dogfooded: the gate runs only at a member site. A plain continuation is never gated in any language,
so the model can invent a member mid-ghost:

```rust
stripe.enroll(Tile::from_morton(tile_fanout(), 0));
stripe.probe()    // probe() is not a Stripe member; the gate never saw it
```

- v25's bound was expected to shrink the exposure by about two thirds: 289 of 347 invented calls sat
  past line 1, and the bound cuts most multi-line ghosts.
- Standing instruction: RE-MEASURE the exposure on the bounded product before scouting any gate.
- If it still bites, the scout question is whether the member check can run over a continuation's
  `receiver.NAME` accesses, and at what false-positive cost.
- Suppression is the quieter failure. Every rejection leg in this product's history has run aground on
  it.
- Warning from the capture: the multi-line continuation itself was CORRECT (the function needed its
  return expression). The defect was the invented name, not the extra line. **UNVERIFIABLE** (C239):
  that illustration exists only in this file's own prose; the 289-of-347 count is backed. Any Rust
  dogfood session produces another.

Related and already pinned: the gate judges a dotted lead on its head alone (see Decisions, S59-7).
That is a reach limit at a member site; this item is the continuation.

### 64. A drained FIM session holds its diff until the document is quiet

**RULED 2026-08-24: quiet-window drain.** A drained FIM-sourced repair session presents its diff only
after the document has been quiet for a beat; against a document edited in the last N seconds it
holds. The cancellation-is-a-primitive answer, now buildable.

The mechanics it lands on: `column80.fimAccepted` (`fnGen.ts:6082`) runs the full post-accept oracle,
a round captures `versionAtResolve` (`src/vscode/oracleSurface.ts:543`) and spends seconds in a model
call while the user keeps typing. A second accept parks another session in the pending slot
(`:299-310`, newest wins), the discarded session ends, `drainPending()` (`:325`) fires the parked one
and a fresh "repair round 1 (preview)" opens against a document that has moved on. The discard is
already quiet (S18); this closes the diff half.

Falsify: a drained FIM-sourced session against a document edited in the last N seconds does not open
a diff, and the same session against a quiet document still does.

### 71. The wrong-tree refusal, extended to TypeScript and Python

Approved 2026-08-24 as its own small slice. S28 (ratified) records the gap: a type referenced without
an import line puts the anchor in a method body, and both transports hand back the enclosing class's
members, exactly as C# did - `blind-v15`'s own green fixture row proves it.

The build is the C# predicate carried over, and the reason it is a slice rather than a sweep: the
question the refusal must not break - "what type am I writing inside" - has no oracle in either
language yet, so the slice builds those oracles first. Sequenced after higher-value work; the leak
fires only on no-import-line anchors.

### 72. The model download joins the in-flight registry

RULED 2026-08-24: one stop-everything action. Cancel Generation stops a download along with every
model round; retitle the affordance if the wording grates once felt. Today the pull's cancel lives
only inside a dismissable notification - dismiss it and the cancel is gone, on the longest operation
the product has.

The mechanics are in `session-v58/scraps.md` S58-10: lift the registry into `extension.ts`, pass it
to both `registerFnGen` and `registerFirstRun`, one claim around `pull(...)` released in a `finally`.

Two obligations ride with the build. Verify whether aborting the client fetch stops ollama's
server-side pull - if it does not, the channel line must not claim it did. And `firstRun.ts`'s
private `isAbort` greps `/abort/i` over the message (S57-3); a shared registry does not fix that and
must not be read as fixing it.

### 73. Thinking becomes a palette action, and numCtx becomes a setting

Update 2026-09-02 (session-v65): the FIM half is settled as a constant rather than a setting: `FIM_NUM_CTX` 8192 on every FIM request, with the reload cost of a per-request pin written into `docs/constants.md`. The fn-gen half stands.

RULED 2026-08-24. Two knobs leave the internal-defaults list.

**Thinking is a quick action, not a settings knob.** Whether reasoning pays depends on the complexity
of the function in front of you, so the control is a Command Palette action - enable thinking, with
levels where the model honours them (low / medium / high) - off until toggled. TDD generation is the
named beneficiary: the human's ruling singled it out, and adversarial test construction is exactly
where reasoning earns its tokens.

The budget coupling is the build's hard part. Thinking tokens bill to the same output budget as the
answer - `qwen3.6:27b` spent all 2048 tokens on the trace and every generation died truncated - so
toggling thinking on must scale `maxTokens`, and `num_ctx` bounds prompt plus output together, so the
window has to follow. The build states which models honour levels rather than guessing.

**`numCtx` is exposed as a setting.** Its right value is the user's hardware, and its failure mode
without one is silent prompt truncation - the head of the prompt is the injection, so truncation
discards the product's core value first. The two token budgets stay unexposed; their failure mode is
a visible length reject.

### 33. The spike harness spliced generations as bodies, on stale offsets

FIXED 2026-07-31. Kept for what it INVALIDATES and for the three rules it earned, not because there is
code left to write. The instrument cannot be re-pointed: the corpus (`candidates.json`), the three
spikes and `lib-cargo.cjs` are all gone (C43, C44), so this is a record.

Three defects, all proven at the time, all in the measurement rather than the product:

1. **The wrong splice.** `v34-after.json` `genText` is a whole function (171 of 181 rows open with an
   `fn` header). Three spikes called `cargo.spliceBody`, which writes between `bodyOpen+1` and
   `bodyClose` and nests the function inside itself. It compiles, and the outer body then returns `()`
   where its declared type should be, so nearly every row gained a spurious `E0308` whose types the
   harvest read as real. Function arm matched the recorded error codes on 10 of 10 rows, body arm on 0
   of 10.
2. **Stale offsets.** 160 of 387 entries no longer landed on their own function (recorded at
   `session-v36/session-state.md:34`). Two rows spliced into the middle of a string literal and the
   harvest read type names out of roughly 348 lexer errors. Both runs exited 0 and printed plausible
   tables. **UNVERIFIABLE, that splice event** (C41): the ~348 has only a prose recitation behind it.
3. **The classifier called without its context.** `classifyHallucination(d)` bare. The E0433 branch is
   gated on `resolution` being present, so it returned `undefined` by construction and every row of
   that form scored uncovered. The product always passes the crate resolution and the file's local
   defs.

**What it invalidates, which is the part that still binds.** Any number computed from
`leg2-coverage.json` or `order-composition.json` before 2026-07-31, including the whole of
session-v36 goal item 2 and the "17% zero-coverage" headline it argued from. That ruling stands
without the artifacts: the numbers are refuted and nothing has re-derived them.

**UNVERIFIABLE** (C45): "numbers from `spike-tier4-human.cjs` are unaffected, reproduced exactly after
the fix". That spike is deleted; the census it produced survives as shipped prose
(`docs/user-manual.md:163`, 6,856 comment lines, 5,232 names, 122 types) and a recitation is not the
artifact.

**Three standing rules, and they are the reason to keep the entry.** A harness that mutates a corpus
must verify its own offsets before it writes, and must say out loud how many it moved. The check must
THROW rather than skip: a guard that skips leaves a smaller corpus that still looks complete. And
re-capturing the corpus is not a drop-in repair when the candidate id embeds its own offsets, because
a fresh capture renames every row and orphans the generations already recorded against the old ones.

### 18. The rest, unchanged in priority

- **Delta-gen**: "add an arm to this enum for X" - instruction-driven modification of an existing
  symbol, presented as a diff. Debate the interaction model first: single-shot refinement on a visible
  diff against conversational drift. Highest-tension interaction call here.
- **The prefix/ranking A/B harness**: the prompt's prefix is a byte cut, not a scope, and it once
  carried a sibling's `subtended_children()` into the model, which then wrote it on the wrong
  receiver. Build the harness first or the fix stays opinion. The sortText half has shrunk:
  rust-analyzer's ranking is captured on the member (`raLspClient.ts:516-518`, `raExtractor.ts:194`),
  classified by `raSortTextTier` (`extraction.ts:464-466`), and the tier drops blanket-ranked members
  at untyped-partial sites (`fimInject.ts:940-942`, the measured v27 arm D). What is still unused is
  the ranking ORDER for prompt ordering.
- **Embedded languages**: .vue/.svelte need a Volar transport. Own slice.
- **Ecosystem breadth**: Windows; non-NVIDIA GPUs currently land wrongly in below-12gb honesty mode;
  CPU-only honesty. Apple Silicon shipped, but M-series TTFT is still unvalidated on real hardware.
- **De-nest transform**: parked by the user; drop-timing caveat recorded.
- **Constrained decoding** and **machine-applicable rustc fixes**: REFUTED as written. See Rejected.

## 2. Decisions waiting on the human

Every pending ruling, in one place. The one-line index comes first; the standing decisions that carry
real bodies follow it. Nothing here has been ratified.

### The index

**The 2026-08-24 ratification batch settled most of this section.** S17 and S21 through S32 are
RATIFIED, per-entry records in `docs/supersessions.md`. The rulings that produced work live as items
64, 71, 72 and 73 and under Deferred fixes; the ones that closed questions are marked in place
below and in Rejected.

**The v58 carryovers, all ruled 2026-08-24 except one.**

- **S58-12** - RULED, wording approved. The `agentic` sentence ships as its own entry; the approved
  text and its trigger are under Deferred fixes.
- **S58-10** - RULED, one stop-everything action. Now item 72.
- **S58-2's residual** - RULED, forgeability accepted and recorded. See Rejected; the S59-12
  non-injective-escape rider travels with it.
- **S58-14 / S58-15** - WONTFIX. See Rejected.
- **S58-16** - the two-cause 429, still DEFERRED, and the reason is evidence: no arm has ever
  captured a real 429 body, and classifying on documentation is banned here. Build the enumerated
  transport field the day a real capture exists. The channel pointer already carries the user to the
  true cause.

**From session-v59, one ruled and two standing notes.**

- **Item 70 / S59-1** - RULED, refuse ambiguity. The direction is in item 70 above; the scout prices
  the lost surface before the build ships.
- **S59-7** - still open, and it is a measurement rather than a ruling. The gate judges a dotted lead
  on its head alone: `ghostRefs` (`src/core/fimInject.ts`) judges the ghost's LEADING identifier and
  every later `receiver.NAME`, so `await.add_tile_by_morton(m)` is judged on `await` alone and
  survives. The same shape in all five languages; pinned as a `KNOWN REACH LIMIT` row in
  `test/impl-v59-p8-rust-gate.test.cjs`. **The obvious fix is wrong:** reading a dotted lead as one
  reference false-suppresses four languages to catch one. The real fix judges the head against the
  legal list and the tail against that list's own `await.`-prefixed entries - a per-language rule
  wanting its own measurement before anyone builds it.
- **S59-8** - no ruling needed, but read it before believing any headless Rust member count. Full
  record under Measurement debt.
- The S28 extension question (TypeScript and Python never had a wrong-tree refusal) is RULED:
  approved as its own slice, now item 71.

**Questions that live inside a numbered item.** Item 2, item 43 and item 47 were RULED 2026-08-24;
the rulings sit inside their entries under Measurements pending. One stays open:

- **Item 65's coverage-deletion trade** - withholding a hint on a type the model then invents is not
  obviously better than a `use` line that fails loudly, and nothing has measured which way it falls.
  Measure first: how many pre-fill collaborator types are cross-crate at all?

**From session-v66 (3.3.0), four rulings, none ratified.** Full content in `session-v66/scraps.md`.

- **S66-1, the retry-commit guard, built without a ruling.** With keystroke FIM on, a retry of
  the dictated ghost's commit landed a plain `#[cfg(test)]` keystroke ghost over a hidden
  dictated one (Rust host row F, channel in `session-v66/tier-run-2.log`). The build shipped the
  most targeted option: the provider records the latest request per site and the gesture refuses
  to commit when a keystroke request came after the dictated one. Cost: with FIM on, a slow host
  that draws the dictated item late loses it to the automatic request that follows a hide. Ratify,
  or rule (a) no retries, or (b) the provider pushing a "replaced" event on every non-intent serve.
- **S66-2, Python drops the sentence on a body-less head.** "A type alias called Id for a string"
  landed `Id = str` and nothing carries the sentence, because Python's doc form is a docstring
  inside a body (host row C, python). Candidate: a wrapped `# sentence` line above a body-less
  Python head, which is idiomatic at module level; it needs contract rule 5 of
  `session-v66/contracts/phase1-shape.md` amended, the blind rows updated, and a tier row. The row
  records the loss rather than asserting until ruled. Keep the sentence as a `#` comment, or drop
  it on purpose?
- **S66-3, two keybinding pins superseded.** `test/blind-v58-p5-cancel-affordance.test.cjs` C2 and
  `test/impl-v32-p45-menus.test.cjs` now carry `column80.cancelDictation :: escape` twice, under
  `column80.recording` and `column80.dictationBusy`, with dated notes. The v32 ruling (no default
  keybindings for gestures) stands for everything else.
- **S66-4, what Escape outranks while a take is live.** The two cancel bindings need no editor focus
  (ruled) and carry the ghost binding's guards; extension bindings outrank the built-ins, so while
  the mic is open or the answer is in flight Escape also beats `notifications.hideToasts`, the
  terminal's find widget, the Explorer's `list.clear`, `cancelRenameInput`, and the keystroke
  ghost's own hide. Left unguarded on purpose. Say if any should win instead.

### Does round-1 generation carry derives, and is 12288 the right floor on Metal?

**Derives at round 1.** The repair round reads a type's `#[derive(...)]` line off its definition file
and injects it; round 1 does not. The failure it comes from: the error was
`ApiKeysConfig: serde::Deserialize<'de> is not satisfied` while `ApiKeysConfig`'s field list was
ALREADY in the round-1 prompt. The derive list was the answer and no round-1 block carries one. A
prompt-identity change with its own budget cost, so it wants its own number rather than being folded
in quietly. **UNVERIFIABLE** (C248): the v34 row is gone; the same E0277 case is quoted at
`src/vscode/oracleSurface.ts:2306-2309` but without the prompt contents, so "the field list was
already in the round-1 prompt" cannot be read off anything. One fresh capture would check it.

**Which serving knobs get settings - RULED 2026-08-24, now item 73.** Thinking becomes a Command
Palette quick action with levels; `numCtx` becomes a setting; the two token budgets stay internal.
The evidence per knob stays under Deferred fixes, "Settings honesty", and item 73 carries the build.

**`MIN_FNGEN_VRAM_MB` = 12288 on unified memory.** A 16GB Mac reports about 16384 and the human has
TESTED that it works. Subtract any honest toolchain figure and it falls under the floor - VS Code
alone measured 4.3GB, so any reserve above 4096 excludes it. REASONED, arithmetic rather than a run.
That the machine works anyway is evidence 12288 is a discrete-GPU number that does not transfer to
Metal, where there is no PCIe transfer and offload behaves differently. See S11. Wants a measurement
ON Apple Silicon, not another estimate.

### The bound refuses ghosts you wanted, and its benefit was never measured

v25's biggest open item. One bound rule (rule 5, the "unsafe tail" rule) serves nothing when it fires.
Its cost is measured. Its benefit never was.

- Live example (v26 capture): you type `metadata`, and the product stays silent for five keystrokes in
  a row. The model produced `.log_id,` every time - exactly the continuation plain FIM exists to
  serve. Rule 5 dropped every one.
- Measured cost over 750 real sites: rule 5 fired 16 times, and 11 of those refused text the developer
  went on to write. Two of the refused ghosts were byte-identical to what the developer typed.
  **UNVERIFIABLE** (C255): the raw result file is gone. Re-running `session-v25/harness/cost-v25.cjs`
  would check it, and that is the same harness the benefit measurement has to run on anyway.
- The claimed benefit (fewer broken splices) was inferred from a run WITHOUT rule 5, so it is
  unmeasured.
- The work: measure the benefit the same way the cost was measured, on the v25 harness. If it costs
  more completions than it saves, change rule 5 to retract to a shorter cut instead of refusing.
- Size: a session, not a night.

### Four look-at-real-ghosts calls from v25

The rules worked as written. The question is how the output feels, and no test settles that.

- **Stacked closers.** A declaration-head ghost can end `start_shard: 0,}}`. Valid code, but it reads
  broken at the exact moment it must read trustworthy. Alternative: each closer on its own line at its
  opener's indent.
- **Unclosed brace.** 191 ghosts now end on an open `{`, leaving an unbalanced brace in the buffer
  until you type the body. Deliberate; does it feel broken in practice?
- **Residual whole functions.** 6 multi-line-signature ghosts still serve a whole function. If that
  violates the "never a whole function" bar, the fix is one predicate in `safeTail`: refuse a cut that
  crossed a `{` the ghost itself opened.
- **The floor against `bar1()`.** The 8-character floor refuses `bar1()`-shaped ghosts. The corpus
  says the floor is nearly free (7 of 710 refused, 0 correct), but `bar1()` is plausible and useful.
  Watch dogfood; this is why the floor is a setting.

### The &self render contract (S17 of v19)

**RULED 2026-08-24: settle it with an arm.** Render both ways over the Rust arm rig and count
receiver-copied-into-call errors against wrong-mutability errors. Fold into the next Rust arm
session; the two frozen oracles move with the number, not before.

The record the arm decides: the injected block renders Rust methods as
`partition_by_lod(&self) -> u32`, and the live e2e showed the model copying the receiver into the
call - `s.enroll(&mut self, u64);`, not legal Rust. Two frozen blind files pin keep, because `&self`
signals mutability. This blocks the Rust generation-quality fix; the attempted fix is reverted and
waiting on the number.

### The v20 trio

v26 shipped the lifecycle rebuild (`src/core/scopeLifecycle.ts`), which was the stated precondition.
Re-check each against the shipped machine rather than against the v20 capture. Any bare commit hash in
this file older than 2026-08-10 is suspect: the leak scrub rewrote history.

- Does a stray unselected request while the widget is open exist in practice? If so it breaks two
  invariants.
- Should a Rust snippet/keyword preselect be refused a passive scope? One cheap predicate. The wedge
  fix shipped, so this may already be dissolved; check before designing it.
- What do vim-keymap users get instead of the second Escape? Their Escape leaves insert mode instead.
  Not touched by v26, so this one is certainly still open.

### Go: two coupled decisions, and Go is not simply "the broken one"

**G2 and G3 RULED 2026-08-24: leave as-is.** Go's qualifier-aware hook covers the real case
(`*testing.T` survives and `t.Helper()` injects), no captured failure exists on any other leg, and
the qualified-name pipeline rebuild is five-language regression risk for nothing measured. An
imported Go type stays anchorable only when the signature or body names it. Reopen only on a real Go
dogfood capture; the five duplicate copies of the rule still consolidate on next touch (S55-13). The
record below stands for whoever reopens it. The GOENV housekeeping at the end is still open.

**G2. What replaces the single-letter skip rule, in the general case?**

`candidateTypesOf` matches `\b([A-Z][A-Za-z0-9_]*)\b`. From `*testing.T` the lowercase `testing` never
matches, so it yields exactly `["T"]`. The DEFAULT `skipCandidate` is `/^[A-Z]$/`
(`crossFileShape.ts:476`, `:1025`), so `T` is dropped.

That default is measured safe for Rust: 621 files of `acme-db` declare no single-letter struct, enum,
trait or union. It is wrong in general for Go. Verified on go1.26.5: **194 single-letter exported
structs in the standard library**, `testing.T` among them at `testing/testing.go:934`, plus `B`, `F`
and `M`.

**The consequence is already dead for Go, which is why this is a design question and not a defect.**
`goShapeHooks.skipCandidate` (`crossFileShape.ts:630-638`) is qualifier-aware: it reads the field type
AS WRITTEN and keeps `T` when a `.` precedes it, so `*testing.T` survives and the model does get
`t.Helper()`. The default still drops a bare `T` on any leg with no Go hooks.

1. Carry the qualifier through the pipeline and skip on the QUALIFIED name, everywhere. `testing.T` is
   a real type; a bare `T` off a generic clause is not. The only option that separates the two cases
   rather than guessing between them, and it would retire the per-language hook.
2. Leave it as it stands: Go's hook handles Go, every other language keeps the bare-letter default.
   Today's behaviour.

Note the blast radius before starting: `candidateTypesOf` is shared by all five languages.

**G3. Is a Go import line a valid anchor?**

Rust anchors an imported type at its `use` line and v34 fixed the wrapped-group case. Go cannot work
that way: `import "testing"` names a package, and the token `T` appears nowhere on it.

1. Resolve Go types by qualified name through gopls workspace-symbol, the way the C# leg already
   resolves a doc-only collaborator. Recommended if G2 lands, because by then the qualifier is in hand.
2. Accept that an imported Go type is only anchorable when the signature or body names it. Today's
   behaviour, honest and thin.

See item 28: Python and C# share G3's gap for their own reasons.

**Go housekeeping.** Install golang.go in your editor and record its gopls version beside the proven
v0.23.0; the drift canary is green, 30/30. And pick the GOENV split-brain option: keep GOENV=off,
per-knob pins, or hybrid. The divergence log already ships.

### Two v33 surfaces that are correct and may still feel wrong

Both ship as built, both are defensible, neither is a bug. They need a human who has used them.

- **A refactor across three FILES throws three toasts, not one.** VS Code fires one change event per
  document and the contract says one toast per event, so the code is right against the contract. The
  goal's prose said "a refactor that crosses three blocks" throws one, and a cross-file rename crosses
  three documents. Both readings are defensible; feel it, then rule.
- **The generate-time warning repeats on every generation while a lost block sits in the panel**,
  rather than once per loss. It is true every time and the block is one click from gone, but it is the
  same shape as the constantly-firing stale flag v33 deleted for training the human to ignore it. Fix
  if it grates: diff the lost id set across resolves and name only new losses.

### Smaller parked calls

- **S14**: workspaceState identity shapes.
- **The un-nudge reversal path.** No longer urgent; the 19-point toast survived v22.
- **S2**: string-keyed TS members against the frozen blind row.
- **S21 of v21, the `.:`-seam.** Recommendation stands: let dogfood be the next oracle. (Distinct from
  supersessions S21.)
- **S55-2**: a real fact behind "no language server installed". VS Code collapses "no extension" and
  "extension up, no symbols here" to one `undefined`;
  `vscode.extensions.getExtension(id)?.isActive` would split them, and it needs an extension-id
  registry plus a ruling on alternates (csdevkit against `ms-dotnettools.csharp`, Pylance against the
  Python extension). If built, item 55's `empty-tree` cause becomes reachable and earns its own
  message.
- **S55-25**: v50's own contract oracle rows (`blind-v50-p1-settle.test.cjs` C1-2a/C1-2a2) script the
  fictional growing cold answer that a later queue item re-cut out of the v21 files - and that file was
  written by the agent that wrote the bound, which is why the bound looked compatible with its own
  case. Re-cutting a RATIFIED contract oracle is a design call; take v50's contract with you, not just
  the fixture.

## 3. Measurements pending

A number from the harness is a hypothesis until the instrument that produced it has been looked at.
Two independent rig defects once turned up in one session and each had been silently wrong for months.
Most of what sits here is blocked on taking a number rather than on a design call.

### Criticize: what is not measured and what is not built

Filed by session-v61 as the honest bound on the gesture it shipped. None of these is a numbered item
yet; the ratification batch mints the numbers.

- **All fifteen dimensions are graded, and RECALL is the open work.** Against the 138-row
  hand-labelled set, fourteen of fifteen have zero false positives and eleven read 100% precision
  with 100% recall. The four that do not: `world` at 100.0% / 60.0%, `unadmitted-failure` at
  100.0% / 64.3%, `cqs` at 100.0% / 28.6%, and `pass-through` at 85.7% / 50.0%, which owns the set's
  one false positive. `unenforced-precondition` fires on no labelled positive, so its precision cell
  is ungraded rather than passing. Reproduce with `session-v61/harness/grade.cjs`. The full table is
  in `docs/architecture/criticize.md`.
- **Raising recall is the next measurable item on this gesture.** `cqs` misses 71% of its labelled
  positives and `world` misses 40%. Precision is already at the ceiling on almost every dimension, so
  there is nothing left to buy there, and a clean card is currently not a certificate. Any recall
  work has to be graded against the same set or it is a guess.
- **The labelled set is thin in places and its own README names them.** `unenforced-precondition` and
  `prng` rest on 4 positives each, `unused-param` on 6, `cqs` on 7. A 100% on four positives and a
  100% on thirty read identically in the table and are not the same claim. Widening the set is
  cheaper than any detector work and gates all of it.
- **Every rate outside that grading is a SIGNAL rate,** on code the repo considers good, which says
  the channel is quiet and says nothing about whether a flag is correct. The two are not
  interchangeable and the docs keep them apart.
- **Dimension 11's per-language signal-rate contrast was withdrawn, not replaced.** The architecture
  doc argued from a Rust-versus-C# rate gap that ownership makes the violation culturally rare in
  Rust. Those rates predate the phase-6 fix to that dimension and do not reproduce. A fresh census
  with the shipped detector reads the gap in the OPPOSITE direction, but it ran on a
  differently-defined population than the original, so it is not published as a replacement. Either
  measurement is worth redoing properly on one instrument, or the claim stays withdrawn.
- **The free-identifier half of the honesty question is not built.** "Does this function read a name
  bound outside it" needs scope resolution through the symbol tree, and no name table can answer it
  because the name is whatever the developer called their variable. PROVEN by running the name-table
  detector on the product's own canonical dishonest function: it catches the clock read and misses
  both the module-state read and the module-state write, which is the headline dishonesty in that
  example. Priced as its own build. Until it exists, a quiet honesty block is not a certificate of
  honesty and the surface must not imply otherwise.
- **Nothing about Criticize was measured in the VS Code host.** Every detector grammar, every signal
  rate and every precision number came from a headless run. The gesture's own order of operations,
  its refusals and its blast-radius walk have unit coverage and no host coverage.
- **Dimension 15 needs a ruling.** The section-comment tell fires on 31.0% of real Rust functions:
  a nit flood under the professional's pre-commit bar and a legitimate teaching point under the
  student's grading bar. It ships SCORED but NOT ELEVATED, which is the conservative default, and the
  ruling moves one entry in `DEFAULT_ELEVATION` rather than any code.
- **Full Sonar cognitive complexity was measured and refused.** Plain nesting depth agrees with it on
  11 of the worst 15 Rust functions; its unique catch is long functions with many sequential branches
  at moderate depth, worth 4 of 15. A later item with a number attached rather than a guess.

### 2. A frozen live test is red and nobody runs it

`blind-v16-argtype-live` pins the claim "with Tile's construction injected, the model builds a Tile".
That claim no longer reproduces. The model serves garbage instead:

```
EnrollTile(new(0, 1))
```

- **UNVERIFIABLE, and it is three of this item's four premises** (C24, C25, C26). "PROVEN 2026-07-25
  on GPU, so not a CPU artifact", the GPU-versus-CPU control behind it, and "also red before v21" are
  recorded nowhere on this box. The garbage output above survives; the run that produced it does not,
  and "red before v21" is a bisect claim with no bisect record. What would settle all three:
  `node --test test/blind-v16-argtype-live.test.cjs` on the GPU tier with ollama up, and a git-bisect
  driving that row for the regression point. Needs the GPU box.
- **The run-list claim is wrong in the letter and right in effect.** The file IS matched by
  `test:unit`'s glob (`package.json:534`), where `SKIP_LIVE=1` makes every row skip; it is absent from
  `test:live`'s explicit list (`package.json:537`). So it is in a list and no list ever EXECUTES it,
  which is the worse of the two states: it reads as covered.
- Its sibling baseline row already skips itself, which supports the "fragile" reading.
- **RULED 2026-08-24: fragile single-draw evidence; re-cut.** The frozen row re-cuts to what one
  draw supports - the injected prompt contains Tile's construction facts, a deterministic assertion -
  and the behavioural claim (the model actually builds a Tile) demotes to a multi-draw arm
  measurement. No bisect: the oracle is stochastic and the model tag is not pinned by commit, so a
  bisect cannot recover the old behaviour anyway. The file moves into `test:live` so something
  executes it.

### 30. Item 1 needs a third arm before anyone knows what it did

Session-v34's falsification arm bundles three changes and cannot separate them:

1. Item 1 itself, which REMOVES standard-library surface and shrinks prompts (11.2% fewer injected
   bytes overall, 39.7% on the goal's own 24).
2. The cap fix, which stops a provenance refusal from spending one of the four type slots.
3. The wrapped-import anchor fix, which ADDS types. `acme_crypto::create_ca` went from 1 injected type
   to 3.

Smaller prompts and more types pull in opposite directions, and the arm came back at 16.0% to 13.8%
compiled, net minus four rows on 181. The honest statement is "no effect detected from the bundle",
and nobody can say which part earned the minus four.

**UNVERIFIABLE, every number above** (C77, C78, C79). The v34 arm chain is deleted: `compare.cjs`,
`handover.md` and `data/v34-after.json` are gone. What would settle them: re-run the v34 item-1 arm
with its compare, and re-run `session-v34/witness-prefill.cjs` on the same task. Neither is one
command - the witness needs `lib-cargo.cjs` and `candidates.json`, both deleted, so the rig comes
first. The third arm below is a different population (237 tasks against these 181 rows) and does not
produce these numbers as a by-product.

The third arm: item 1 and the cap fix in, the anchor fix reverted, same 237 tasks, same box. Compare
three ways. One row is worth 0.6 percentage points on this corpus, so a swing under about five rows
means nothing whichever direction it falls.

Worth doing because the anchor fix has the strongest independent case (no type from a rustfmt- or
prettier-wrapped import group could be anchored at all, in any language), and it would be daft to
revert it on a number that item 1 might have earned. A fresh third arm's absolutes would be the
post-v35 filtered configuration's, unlike every number this item quotes.

### 41. The tuning constants were chosen for a local 30B and now gate a frontier model

Update 2026-09-02 (session-v65): FIM now pins `num_ctx` at 8192 on every request (`FIM_NUM_CTX`, `docs/constants.md`), so the silent-truncation half of this item is closed for FIM; the 300-token budget stays inherited, and `DICTATION_SURFACE_TOK` is the seam the 300/600/1200 arm patches.

Audited 2026-08-08 in full (`session-v45/constants-audit.md`, a ledger of every tuning knob on the
injection path with a provenance verdict each).

**Re-audit before any arm.** The ground moved once without a supersessions record - `readFnGenConfig()`
went from reading three values off `DEFAULT_FNGEN_CONFIG` to reading `maxTokens` and `numCtx` from the
ACTIVE class's budget-profile cell (`src/vscode/config.ts:187-194`), leaving only `temperature` on the
default object (`:202`) - so the first job is to check whether it moved again, not to run 41a.

What still stands: no SETTING overrides any of the three, the cloud arm still spreads
`readFnGenConfig()` (`src/vscode/fnGen.ts:1108`), `numCtx` and `temperature` are still shared across
every backend, and every one of those numbers was picked against `qwen3-coder:30b` at `num_ctx=16384`
on a 16GB carve.

Three sub-items ranked by (drift risk x cost if wrong), plus a fourth:

**41a. `DATASHAPE_TOTAL_TOK = 300`, measured through the CLOUD backends.** The one constant whose
provenance is admitted folklore - the "~350-token codegen knee" comes from external literature via an
early scout, not from this product (`docs/constants.md:29-30`, the INHERITED class) - and whose cost
is measured. On 465 authored-doc C# rows, 300 -> 900 takes injection **16.4% -> 31.6%**, and 330 of
the 421 surviving-but-not-injected types die here, more than anchoring (68) and everything else
combined. The mechanism to move it per-language SHIPPED in v45 (`CS_BUDGET_FACTOR`, currently 1) with
the value deliberately unchanged, waiting for a generation arm. The arm nobody has run is the cloud
one: if the knee is a property of small local models rather than of codegen, it should not appear
there. Real prompts run p90 ~1,295 tokens against a 16K local window, so nothing is context-bound.

**41c. `MEMBER_CAP = 24`, with a per-language ladder.** The highest-traffic constant with the weakest
provenance in the ledger: no ladder, no arm, no language, no model, justified only by the same
inherited knee, and deliberately fused across prefill and repair so the two "cannot drift". It is the
direct upstream of 41a, because C# exhausts a token budget rather than a slot count precisely because
a Roslyn member list is enormous. Measuring the budget without it attributes the gain to the wrong
knob.

**41d. `DEFAULT_TIMEOUT_MS = 120_000` on the Claude Code transport.** Measured 2026-08-08: 3 of 33
sonnet rows on complex C# methods never answered inside it (`genError="Claude Code did not answer
within 120000ms"`, empty reply), against a qwen maximum of 17.6s on the same sample. Two of the three
are 21- and 23-line bodies that **qwen compiled**. Unlike 41a-41c this is not a local number that
leaked across the seam - it was chosen for this backend, but against v43's evidence, which was a
handful of easy live rounds at 4-8 seconds. The failure mode is the expensive one: the round is paid
for and then discarded. The fix is not obviously "raise it" - a 2-minute editor stall is its own
defect - so the measurement wanted is the latency distribution by body complexity, per backend.

**41b. `maxTokens = 2048` on the two cloud backends - substantially mooted, kept for the residue.**
2048 is the LOCAL ceiling now: `GEN_MAX_TOKENS = 2048` (`src/core/budgetProfile.ts:230`) serves
`fim-small` and `local-mid`, and the frontier class, which is both cloud backends, gets
`FRONTIER_MAX_TOKENS = 64000` (`:248`, `:253-257`) - added precisely because 2048 capped thinking plus
answer. It was never a defect on the claude-code CLI backend, which exposes no budget knob. What
remains is one cheap number nobody has taken: the `length` finish rate on `fnGenProvider: anthropic`
at the new ceiling. The product degrades honestly when it happens (a `length` finish is refused, never
spliced). Rank it last.

**Two findings worth more than the ranking.** `temperature = 0.2` has NO provenance anywhere in the
repo, and the entire measurement corpus was collected at it - a baked-in confound in every arm ever
run here, not merely an untuned knob. And the product contradicts itself: test-gen ships a 500-token
aggregate budget while fn-gen holds 300 on the strength of a 350-token threshold. Either test-gen is
over budget by the product's own doctrine or the doctrine is wrong; it cannot be both.

**One thing to resist.** `PREFILL_TYPE_CAP = 4` looks like the obvious target and is not. It is the
one prefill cap with a real arm behind it, and v45 measured that raising it alone RELOCATES the loss
(post-cap loss 65.7% -> 78.2%) rather than removing it. It moves after the budget, not before.

### 42. Repair supply outside Rust

The evidence behind this item's first version measured the RIG, not the product, and the original text
was replaced rather than amended: quoting it alongside a correction would keep a refuted number in
circulation. `session-v46/run-arm.cjs` built the `ResolvedFunction` by hand and never set `symbols`,
so the RECEIVER leg - which reads that field to find the type the generated body is being written
INSIDE, and puts it FIRST in the candidate list, exempt from the type cap
(`fnGen.ts:2341-2361`, `:3304`) - degraded to nothing, silently. A second rig defect compounded it for
Rust alone: `stub-vscode.cjs` declared nine of twenty-six `SymbolKind` members and `Object` was not
one, so `RUST_CONTAINER_KINDS` held `undefined` and rust-analyzer's `impl Foo` node could never match.
The shipped product was unaffected throughout.

**Re-measured with both fixed**, model-free replay of each language's own v46 arm, symbol-kind
translation checked per row:

| | rows | rows with any repair surface | rounds with NO surface |
|---|---|---|---|
| C# | 42 | 11 -> 36 of 38 | 31 -> 1 |
| Rust | 63 | 49 -> 63 | 14 -> 0 |
| TypeScript | 21 | 15 -> 21 | 6 -> 0 |

And on a graded C# arm, same 46 rows and same model as v46: repair rounds injecting no type went from
29 of 42 to **0 of 37**, type injections from 27 to 202, post-repair compile from 10/46 to 19/46,
silently-wrong from 1 to 0.

**Go was never affected.** `receiver.ts` defines `receiverType` for Go alone, so Go resolves its
receiver from the signature with no symbol tree. Every Go number in the changelog stands.

**What survives as work.**

- **A static C# method never sees its own class.** `resolveReceiver` resolves a receiver only when the
  signature carries one or the return type names the enclosing type; a static helper has neither, so
  its sibling statics are invisible and the model invents them. Measured at 9 of 56 repair rounds
  (`Program`, `Utility`, `FileLoading`, `SyncEvents`), each with a CS0103 naming a sibling the class
  really has. This is the whole of what is left of the C# half.
- **The harvest really is Rust-only**, and `harvestDiagnosticTypes`' own comment is wrong where it
  says the other languages' classifiers already read their own shapes. A fact about the code, not a
  measurement. Its value is second-order: CS0246 and CS0200 are its real C# population, about 30% of
  their names resolve, so roughly ten injections.
- **Python and Go remain unmeasured.** Neither has a corpus in the rig, which is a cost, not an
  oversight.

**The lesson, worth more than the item.** Every function the rig called was the product's own. One
FIELD of one argument was missing and a silent degrade to `undefined` turned off the highest-value
injection leg in the system. A hand-built product input is a re-derived mapping wearing a different
coat: where a rig constructs one, it needs an assertion that the product agrees. `run-arm.cjs` now
carries that assertion for the symbol-kind translation.

### 43. Nothing measures how often a real session overflows the context window

The build shipped (session-v48 phases 2+3). `src/core/promptBudget.ts` holds the decision,
`FnGenService.generate` arbitrates exempt / fits / shrink / refuse (`fnGenService.ts:290-294`), and
`generateRaw` / `generateTests` refuse a finished prompt that does not fit, which closed the punt
circle-back retry, repair, refine and test-gen. The channel lines carry full token accounting
(`promptBudget.ts:433-439` refusal, `:447-455` shrink); the fits case stays silent on purpose (`:168`).

**What survives is the whole item: how often does a real session actually overflow?** Nothing has run.
If the answer is never, the guard is cheap insurance and this entry closes. If it is common, the
budget itself needs revisiting, and `GEN_NUM_CTX = 16384` is measured at 12.4GB VRAM on the 16GB
carve, so raising it is not free.

**RULED 2026-08-24: no instrument.** The channel's refusal and shrink lines are the measurement. Read
them during ordinary dogfood; if they never appear over a few weeks of real use, close this item as
cheap insurance. No counter gets built - the product has no telemetry by design and this does not
earn the exception.

**The mechanism, which is what the measurement is measuring.** `GEN_NUM_CTX`
(`src/core/budgetProfile.ts`) bounds the prompt AND the generation together, and `ollama.ts` says what
happens past it: "a prompt over that is silently truncated to fit" (`src/core/ollama.ts:150-152`).
Three prompts of 12.9KB, 13.1KB and 15.0KB all landed on exactly 2050 prompt tokens with nothing
logged, recorded in the code at `ollama.ts:152-155`. Raising `num_ctx` moved the ceiling; it did not
add a check.

**The reasoning that made the guard non-negotiable.** Truncation eats the HEAD of the prompt. On a
captured fn-gen prompt the head is the instruction and the injected type surfaces, and the doc and
signature sit at the tail. So adding context made the model receive LESS injection, and it still
answered from the bare signature, confidently. The developer's action produced the opposite of what
they asked for and nothing said so. That is the product quietly discarding its own core value, and it
is the shape to watch for anywhere else a silent limit exists.

The developer cannot arbitrate it alone: prefill surfaces, member lists and repair surfaces add bytes
they never wrote, so someone who adds two context blocks can be tipped over by bytes that are not
theirs (`promptBudget.ts:9-11`). Context blocks are still SHRINK-exempt by the human's own rule
("Their context shrinks nothing; ours shrinks to fit", `:14-16`) but they ARE counted: `developerTok`
is in every arbitration (`:226`, `:230`) and named in the refusal and shrink lines.

### 47. Python's pre-fill gate is decomposed, and its stated cause was wrong

Decomposed 2026-08-23 by session-v59 phase 7. PROVEN miss, cause now known, no fix built.

**The stated cause is refuted.** This entry used to say Python's leg is cross-file `definition()` into
files pyright has not seen. Across 11 warm rows the per-primitive decomposition is hover **5904ms**,
probe settle 2250ms, settle sleep 383ms, members 328ms, and `definition()` **52ms - 0.58%**. The
headline primitive is not the expected one, which is exactly what Go's decomposition found and why no
fix was pre-committed.

**One level down: 18 of 38 hover calls were the first ask about a URI, and those 18 cost 99.7% of all
hover time.** The other 20 cost 16ms between them. The cost is per-FILE, and it is
`pyLspExtractor.ready()`'s unconditional `delay(300)` per URI plus a 150ms-granular diagnostics wait.

**RULED 2026-08-24: the fix ships, and the gate moves to the measured floor.** Build the probe-side
fix with the cold-index race guarded, then set Python's gate at roughly 1.2x the measured post-fix
p95 - the same shape as Go's accepted 1.2x miss. The gate becomes a regression tripwire rather than
an aspiration; 250ms was a cross-language number pyright's architecture cannot meet.

v50's headline for reference: Python p95 1957ms net against the 250ms gate.

### 48. The injected surface carries no imports, and that is now Python's largest failure family

PROVEN on a compile-graded arm. With the enclosing type in the prompt, Python function generation goes
from 15 of 40 compiling to 35 of 40, and the invented-member family collapses from 21 to 1. What
survives is imports: 3 of the 5 remaining reds are a name the body needs and the file does not import
(`contextlib`, `FileResponse`, `run_server`).

The surface names types and members. It does not say where they come from, and the model cannot infer
an import it was never shown.

**The hole is wider than Python.** The Rust masking is not real on this surface: the use-path leg
(`src/core/usePath.ts:143`, `renderImportHint`) is TEST-GEN only - it fires just when
`opts.importTargetPath` is set (`fnGen.ts:3201-3210`). So the fn-gen pre-fill carries no import
payload in ANY language, Rust included (`fnGen.ts:2503`, "fn-gen omits it"). What masks it in Rust is
weaker: a generated body usually lands in a file whose imports already exist, which is the code's own
stated reason. Python is where it was MEASURED, not where it is.

Not a cap and not a budget. It is a missing payload, measurable the day someone builds it: the same 40
rows, one arm, the same span-scoped verdict. Item 65 is this build's Rust half, so the two meet the
day it lands rather than re-manufacturing them at five times the surface.

### 49. The count cap's server justification is measured false on Python and untested on TypeScript

Half PROVEN, half unmeasured, and the unmeasured half is the one that matters.

The hover fan-out is time-bounded already: `withinBudget` races every ask against a 50ms deadline. The
count cap survives on top of that because the race abandons the RESULT and not the WORK, so abandoned
requests stay queued against a server that answers one thing at a time. That was reasoning, never a
number.

Measured against a real pyright: a 400-hover fan-out costs 13ms, so the deadline never cuts, nothing
is ever abandoned, and the next request costs 0ms whether 4 or 400 asks preceded it. The hazard is
unreachable on that server at any population, real or synthetic.

TypeScript is the other fan-out language and is the slower server: cold first calls at 33ms and 51ms
against Python's flat 10-14ms. It is where a deadline would cut first, and it was not measured, because
its fan-out lives in the vscode transport and needs a real extension host. The headless
`TsLsExtractor` reads the checker directly and asks no hover, so no headless row can produce the case.

A `test:vscode` tier measurement. Until it runs, the cap stands on population sizing alone, and the
constant's own comment says so.

### 50. The gather buys a hover for every collaborator the render drops, and only Go has a bound

PROVEN in Go, measured in Rust, unmeasured in the other three.

Over 20 real Go roots the gather resolved 117 types and bought 117 hovers; the render kept 63 solo and
14 inside a real 8-root prompt. 31 of the 117 sit outside `walkDataShape`'s own BFS at ANY budget,
because the render walks at most `B_MAX` distinct local field types per node and the gather walked all
of them.

Go got a commit-counted breadth bound on the gather: round trips down 26%, and 0 of 20 roots changed a
byte of surface. C# is provably ineligible, because `csShapeBlock` gives every gathered type a member
block, so nothing it gathers is wasted. TypeScript and Python were not looked at.

**Rust's shape is STARVATION rather than waste.** On a ten-field root the walk's `N_MAX: 12` is
allocated first-come by the root's field order under a breadth-uncapped FIFO gather, so a nested
collaborator like `Order.cust.addr`'s `Address` is gathered and then dropped - the identical outcome
on a plain struct as on the enum whose payload edges surfaced it, 39 round trips at the bound's own
ceiling. The remedy is measured too: `RUST_PREFILL_LANG.gatherBreadth = true` (`fnGen.ts:5200`) leaves
the rendered block byte-identical, cuts the round trips, and puts `Address` back in the SHAPE (not the
render - the render's own `N_MAX: 6` then spends on payload defs). Not shipped, because it changes
every Rust field walk and Rust's only fixture is synthetic; it needs its own red on a real corpus, the
way Go's opt-in was priced on 31 of 117. And the FIM whole-block leg renders through the same seam
against its 50ms deadline (`completionProvider.ts:1401`), pays the same round trips per first
keystroke, and has round-trip counts but no wall-clock witness.

**Why Go's pre-fill gate is red, and it is an accepted cost rather than an open diagnosis.** Go's gate
was re-run on both sides of a gather-breadth bound: p95 148ms and 139ms against a 118ms gate, down
from 192ms and 208ms, so Go misses at about 1.2x. Across 20 rows the per-primitive decomposition is
**settle sleep 869ms, hover 210ms, members 80ms, definition 44ms**, and six rows sit at 120 to 126ms
of sleep over 1 to 22ms of real server work. Derived from the measured columns of the same four runs:
**with the sleep at zero the after side reads p95 71ms and 53ms**, a pass with margin. The settle
allowance is what fails this gate on both sides of that build, so no amount of walk work reaches it -
and session-v59 phase 7 ruled the settle loop KEPT on cold evidence (see the item 45 record in
`docs/roadmap-history.md`). So Go's red row stays red on purpose. Anyone reading it should stop here.

### 62. The C# inject arm flaps on 3 of 46 rows, and the caveat has to travel

Characterised 2026-08-23 by session-v59 phase 6. Seven full 46-row dry runs, five quiet and two under
28-way load: **three rows flap, 43 are byte-identical across all seven.** One flapping row's variants
are 1975 and 2226 bytes - session-v55's 251-byte difference, on a row it never named, reproduced
exactly.

Two mechanisms, both in shipped code. A `Datum` resolving to two different declarations, 58 members
against 86, disjoint - that is item 70. Separately, two rows co-flap on `IActionResult`, declared
nowhere in the corpus, so a failed resolve frees a cap slot and something else takes it.

Product-visible rather than a rig artifact, labelled REASONED: the resolver under test is the
product's own `resolvePrefill`, matched code-to-diff rather than instrumented.

**The arm IS usable as a regression check, on one condition: diff PER ROW and exclude those three ids.
Never compare whole-dump hashes.** Any document that calls this arm a regression check has to carry
that caveat, or the next session reads a flap as a change.

### 65. The import hint names crates the target does not link, and mis-names a renamed one

Residue of item 56, filed 2026-08-21 from that build's own not-done list. Session-v56 lifted the
module-tree walk into `src/core/rustReach.ts` and did NOT lift `tightenRatify`'s `externCrateName`
(`tightenRatify.ts:364`, applied at `:454`), so `renderImportHint` still emits
`use other_crate::Thing;` for a crate the target does not link, and rustc refuses it with E0433. It
also names the PACKAGE name (`usePath.ts:100`) where Cargo links the DEPENDENCY KEY, so a renamed
dependency (`renamed = { package = "real-name" }`) gets the wrong prefix.

PROVEN on the gesture side, where the check already lives: 43 of 435 derived lines compiled
workspace-wide, and 43 of 50 once restricted to crates the target actually links.

The fix is item 56's shape again, one mechanism and one copy with two callers, but it DELETES
coverage, so it wants its own measurement first: how many pre-fill collaborator types are cross-crate
at all? The trade is under Decisions.

Falsify: a cross-crate type whose manifest does not list the crate contributes no hint; a renamed
dependency renders the dependency key rather than the package name; every hint that compiled before
still compiles.

### Measurement debt

One harness phase, when the loop next needs proving. The behavioral matrix the builds deferred:
multi-crate, multi-seed, realistic temperature, negative controls.

- **A headless rig sees 4 items where the product sees 25, and this invalidates measurements**
  (S59-8, PROVEN live on a real rust-analyzer, both transports, same crate, same receivers).
  rust-analyzer's 19 postfix snippets arrive ONLY when the client advertises `snippetSupport: true`.
  VS Code does, so the PRODUCT sees 25 items at a plain struct receiver: 6 members and 19 postfix
  snippets. `RaLspExtractor.start` advertises `false`, so the headless oracle and **every measurement
  rig** see 4 items and no snippets at all at the same receiver. The `await` keyword at a Future
  receiver arrives either way. Two consequences, both live: no rig running through `RaLspExtractor`
  can produce the postfix case, so a zero from one is a fact about the client capabilities and not
  about the product; and the legal list the product builds is strictly WIDER than the one any headless
  measurement of it would show. **Any past or future Rust member-count number taken headless needs
  this checked before it is believed.**
- Carries the behaviorally-sound bar: the `bloom_demo() -> true` bar is passed by a constant.
- Carries the reasonable-subset punt: a plausible 80% implementation with no stub marker.
- Carries LSP oracle-client hardening.
- **Standing lesson: baselines go stale fast.** Two published numbers in one session were
  right-measurement-wrong-baseline. Always re-run the "before" against the pipeline that actually
  shipped.
- The `some`-to-`every` tightening at `test-vscode/gesture.test.js:689`/`:711` waits on one VS Code
  tier run. Its stated precondition has NO surviving artifact, so it is a recitation. Read the two
  `provider invocations after each of three arrows` lines the rows already report, in both orders; if
  every delta is above zero, tighten AND keep the recorded output this time. Do not tighten without
  the run - a red row nobody executes is how it sits unseen for months.
- Mixed-zone scoring: the 8-seed A/Bs pool every site, and all-pass/all-fail ties dilute the number.
  Report the seed-variant sites separately; the variance zone is where the discrimination lives.
  **UNVERIFIABLE** (C398): the "2 wins, 1 loss, 7 ties" shape is in no surviving artifact - the v22
  per-site shapes that did survive are 1-3-4, 7-1 and 0-5-3 (`session-v22b/scraps.md:35-36`). The
  METHOD point stands on its own and does not need the example.

### Tier health - the instrument, not the product

Baselines from 2026-07-25, quiet box, post-reboot, GPU live. Latency rows mean nothing unless the box
is quiet: under parallel test load the ts row grew seven extra failures.

**Read the counts below as history, not as a baseline you can diff against** (C378, C379, C381, C383,
C387). The 2026-07-25 run logs are gone: three of the five per-language counts, the parallel-load
finding and the four-identical-runs record have no artifact. The named ROWS all still exist; the
numbers cannot be checked without re-running the tier per label on a quiet box, which would settle
every one of them at once.

- **ts: 43 passing, 2 failing.** Both are named opens: the membersOfType-signatures contract row
  (tsserver returns empty `detail` 8/8, `contract.test.js:320-342`) and the v17 keystroke-cost
  known-red.
- **go: 44/0.** Matches v23's ship number exactly.
- **csharp: 44/1.** The floor-and-margin latency row: `test-vscode/budget.test.js` carries two, the
  injection-window row at `:123` and the budget-plus-margin row at `:291`.
- **rust: 44/4 - NOT a baseline.** Every rust row grades the human's uncommitted play in rust-scratch.
  Baseline only after the fixtures commit.
- **python: 33/7.** Three documented latency reds, one real (the transport-richness row), one teardown
  race (re-run before reading), one shares the S10 oracle limitation.
- v26 claims 45 tier fails are environmental (a headless window never opens the widget) with no
  clean-tree baseline yet. The v26 review owes that number.
- **The tier is runnable here despite no xvfb-run:** a display is already up on :1, so
  `DISPLAY=:1 npx vscode-test --config test-vscode/.vscode-test.mjs --label ts` runs it directly. The
  no-model caveat is written into `.vscode-test.mjs`: an unreachable ollama ends generateFunction on
  an awaited toast, so a row must fire the command without awaiting it.
- The floor-and-margin rows measure machine load, not defects (RED, RED, GREEN, GREEN across four runs
  of identical code). Where a count can replace a threshold, use the count.
- **Nothing forces the TIER to run.** `.github/workflows/ci.yml` runs typecheck, `test:unit` and build
  (`:54-57`), but neither workflow runs the vscode tier; `grep vscode` finds only vsce packaging in
  `release.yml`. Skipped tests in a suite nobody runs are still just prose.
- The NVML lesson: the hardware probe reads total VRAM and no health signal, so a broken CUDA stack
  looks like a small GPU and the product degrades silently. Item 9 is the cheap detector.

## 4. Deferred fixes - small, do on next touch of the named file

Each entry waits for its trigger, the next touch of the named file, not for a slice of its own.

- **Escape in the gap between the trigger leaving and the provider being invoked (S66-11,
  REASONED).** `armAndTrigger` in `src/vscode/dictation.ts` checks the gesture after the hide and
  then dispatches the trigger; the provider is invoked asynchronously. Escape inside that gap
  disarms the intent and the provider call finds none: with FIM on it is a plain keystroke
  request at the cancelled site and draws a plain ghost after Escape. Candidate: `disarmIntent`
  records the site and the provider refuses one Invoke request there. On next touch of the
  trigger chain.
- **Attribute shapes the line pattern does not read through (S66-12).** `#[doc = "a]b"]`,
  `#[derive(Debug)] // dbg`, a multi-line decorator, and an attribute followed by a blank line all
  fall back to the pre-3.3.0 cut: the attribute lands alone and the head is lost. Not regressions.
  Candidate: `.*\]` for the bracket forms and an unbalanced decorator line read as a continuing
  statement. On next touch of `ATTRIBUTE_LINE` in `src/core/fimBound.ts`.
- **`droppedContentLines` on the refused arm (S66-13)** counts attribute lines as kept when nothing
  was served. An evidence line only; nothing branches on it. Same touch as S66-12.
- **The v65 dictation tier ran on the 3.3.0 tree for `ts` only (S66-14).** The
  `dictatedIsLatest` guard changed the FIM-on path; run the other four labels of
  `test-vscode/v65dictate.vscode-test.mjs` before S66-1 is ratified.
- **The cap-cut head of the human's first gesture is not reproduced (S66-5).** The ts and rust
  rows that dictated a long parameter list served a type alias and nothing; the channel of that
  first gesture (an edit with no accept) was never seen again. The landing watch now ends that
  state either way; the cause is unknown.

- **The `agentic` sentence (S58-12), wording APPROVED 2026-08-24.** `agentic` leaves the CLI-failed
  group and ships as its own entry: "Column 80: the model went and did work instead of writing the
  function, so nothing was written - run the gesture again." Three lines in `CLAUDE_CODE_SENTENCES`
  plus a supersession entry; do on next touch of the sentence table.
- **`test/blind-v59-p1-one-sentence-everywhere.test.cjs` C1: the re-cut is authorised.** S31 is
  ratified (2026-08-24), so the four deliberately-red C1 rows re-cut onto the diagnosis - the shared
  cause appears on all three surfaces, the generation consequence on neither of the other two. First
  session that touches the suite does it.
- **`src/core/crossFileShape.ts` (the settle-loop comment, session-v59 phase 7 residue).** The comment
  at `:1009` still reads "**41 cursors, ZERO recovered a renderable member**" and argues the bound
  from that. Phase 7 refuted it on a cold probe - 17 re-polled cursors and 2 recoveries in Python,
  both `0/5 -> 5/5` on the same row - and wrote a corrected comment that never landed, because the
  file also carried another agent's in-flight edits and the change was left unstaged. Re-apply it: the
  standing keep argues from a cold run, not from "no server did it today".
- **`src/core/compilerOracle.ts` (the workspace anchor, S55-8/S55-9).** The deferred-fix rule already
  FIRED on this once - session-v59 phase 4 touched the file and flagged it rather than half-doing it,
  because it is a separate build on the CHECK path needing its own cargo-workspace corpus. The
  content, so this deferral is not a bare pointer: the shipped rule is "nearest ancestor declaring
  `[workspace]`", and a crate an ancestor workspace `exclude`s still anchors at the excluding
  workspace - measured against cargo 1.96, the excluded crate's diagnostics are crate-relative.
  Membership is the only exact predicate: read `members`/`exclude` globs or ask `cargo metadata`,
  which `catalog.ts` already spawns. And the anchor walk has no memo: up to two runs per primary span,
  every ancestor manifest re-read each time, 1.8ms per call against a 202KiB manifest. Any memo shares
  the catalog memo's invalidation story.
- **`src/vscode/completionProvider.ts:1114` (S59-10): a second `[fim] no ghost:` writer, unescaped.**
  Session-v59 phase 2 escaped the core `noGhost` as "the choke point the shape is named for"; this is
  the other half of the same shape. Its one non-constant is `scope.name`, a language-server-authored
  completion label, also unescaped at `:520`, `:688`, `:997`, `:1056`. Not driven, so not a confirmed
  defect - but the reasoning that made the core site worth escaping applies here unchanged.
- **`src/core/oracleSurface.ts:414` (S59-11): a compiler diagnostic is cut to 70 chars without
  escaping.** Its payload is compiler output derived from model-generated source, so the model has
  partial reach into it. Two neighbouring sites (`:1009`, `:1659`) pass the diagnostic whole and are
  deliberate. Not driven.
- **`src/core/fimInject.ts` (S59-9): `memberSiteLegalNames` splits a dotted name in all five
  languages.** Phase 8 claims only Rust joins the gate; the splitter runs for every language -
  `[{name:"a.b"}]` yields `["a.b","a","b"]`. It only ever widens, so its worst case is a missed catch
  rather than a false suppression, and no product transport for the other four was found to emit a
  dotted member name. But it is a behaviour change in four languages the commit does not claim to
  touch.
- **The C# wrong-tree refusal's remaining blind spot (session-v59 phase 9).** The attribute gap is
  closed only where the attribute sits inside the container's range. Roslyn puts it there; a server
  that does not gets no refusal. Stated in the code and in S28 rather than papered over.
- **`test/adversarial-v58-p1.test.cjs:1209` (S59-4): a re-cut locator takes the first warning, not the
  pull toast.** Phase 1 re-cut it from `/download failed/` to `/^Column 80: /`. The row's stated
  subject is preserved and correct. The residue: `/^Column 80: /` takes the FIRST `Column 80:` warning
  in `__C80_WARNINGS__` rather than the pull toast specifically. Harmless in the current flow, which
  raises one warning. A future second warning on that path makes the row assert about the wrong string,
  silently. The fix is a locator that identifies the toast by its surface rather than by its prefix.
- **`test/review-v27-tier.test.cjs:125` (S59-13): a row lost its pin on whether the legal tail rides
  at all.** It gained real assertions (tier and signature must be `undefined`) but lost any pin on
  whether the legal-only tail rides back AT ALL. A regression dropping keyword items entirely leaves
  the loop iterating zero times and the row green. Coverage survives at
  `test/impl-v59-p8-rust-gate.test.cjs:358` and `:411`, so only this row is weaker.
- **`test/blind-v15-*` (S59-14): a re-cut row's title claims a behaviour two of its legs lack.** The
  `blind-v15` rows now run one demand for all languages. TypeScript and Python pass only because the
  fixture's anchor lands on the import line - recorded correctly in S28, but the ROW'S TITLE claims a
  behaviour those two legs do not have. A reader of the suite is told the wrong thing.
- **`impl5-vscode`'s never-auto-pull scan (S59-15): a guard greps `src/core` without stripping
  comments.** Unlike its `firstRun.ts` sibling, which does. So naming `pullModel` in a core COMMENT
  reddens the row; a session-v59 agent reworded its comment rather than loosening the guard, which was
  the right call in the moment. The two halves of the same guard disagreeing about whether comments
  count is the actual defect.
- **`fimComment.ts` (the Rust `quotes` set).** The CHEAP fix shipped in session-v55 - a literal scan
  crossing a newline is treated as a phantom - measured at zero differences over glommio and a net win
  on this repo's own TypeScript. What remains is the quote set itself, a v25 contract change needing
  its own blind oracle over lifetimes. **The falsification shape moved (S55-22):** the residual the
  shipped rule cannot reach is NOT the two-line shape three documents used to name (that one now
  closes, by pairing luck). It is a same-line block comment between the `'"'` char literal and the
  quote it wrongly pairs with - nothing crosses a newline, so nothing is blanked. Pinned as `A14-2` in
  `test/adversarial-v55-p14-phantom-literal.test.cjs`; any future entry names that shape or it is
  testing the wrong thing.
- **`fimComment.ts` (`ledAt`): the comment walk is quadratic in the prefix**, because `ledAt` does a
  backward `lastIndexOf("\n")` per hit. 200KB of block comments on one line takes 721ms against 12.6ms
  for the same bytes with a newline per comment; 977KB on one line takes 17.7s. `harvestBodyComments`
  in `scaffold.ts` walks the same scanner and is slower still. Real source does not look like this, so
  it is a line rather than a fix, but v36 put the walk on the repair path where it is awaited before
  the model call. The row is "KNOWN WRONG: the walk is O(n^2)..." at `adversarial-v36-p1.test.cjs:484`,
  a live GREEN ratio row (bar 2.5x, `:463-477`) that goes red when `ledAt` is fixed.
- **`tightenDocComment.ts:253` logs the cursor cause for every cause (S55-1).** The fifth
  resolver-driven gesture did not inherit item 55's refusal split; it is channel-only and degrades
  rather than refusing, so no toast lies, but the diagnostic is the same wrong sentence. Routing the
  cause in changes the `wiring.resolveFunction` seam's type, which is why it waited.
- **The `generateTests` gesture's two SNIPPET write paths sit outside the v55 EOL bundle (S55-10):**
  `createTestFileWithSnippet` (`fnGen.ts:6474`) and the existing-buffer insert (~`:6230`) go through
  `editor.insertSnippet`, not `applyEdit`. VS Code is BELIEVED to re-join snippet text on
  `model.getEOL()`, which would make both safe by the platform - REASONED, and this project has been
  burned by research inverting platform truth, so it needs a live witness in `test-vscode/`: insert an
  LF snippet into a CRLF document and read back what landed. Also unpinned (S55-11): the preview diff
  and the splice share one normalised string by ordering only; a row driving both and comparing
  byte-for-byte closes it.
- **The single-letter type rule, five copies (S55-13):** `crossFileShape.ts:1025`,
  `compilerDirected.ts:491`, `goPrioritizedTypes`, `resolveCallOwners`, `goShapeHooks.skipCandidate`,
  and two disagree one function apart - `GO_PREFILL_LANG` says a Go `T` is real (186 measured structs)
  while `goPrioritizedTypes` blind-filters `^[A-Z]$`. Harmless today because Go's owner door is shut;
  consolidate on next touch. Related, the std filter's refusal line (S55-14): `!/^[A-Z]/` and the
  stop-set share one "a standard-library type" sentence, so a lowercase workspace container gets a
  false reason on the channel - split the `||` into two reasons, with rows re-cut. And
  `oracleSurface.ts:623`'s compiler-named receiver route has no single-letter guard (S55-15): dump
  `arityReceivers` over a real diagnostic corpus before adding one; no measured server prints a bare
  `T` yet.
- **The remote arm's small residue, all deliberate (S55-3 to S55-6):** a seam that throws makes
  `buildFnGenService` reject into a hardware-worded message for a remote host; the 2s reachability
  timer is unref'd and never cleared; `localhost.` (trailing dot), IPv4-mapped IPv6 and
  `ip6-localhost` still read REMOTE; and `readFnGenConfig()` is read before and after the probe, so an
  apiBase flip inside that window builds a local tier against a remote base until the next settings
  rebuild.
- **`budgetProfile.ts`: three prefill bounds are unmeasured numbers.** `PREFILL_TYPE_CAP` is 4
  (`:119`), `PREFILL_RESOLVE_CAP` is 8 (`:122`) and `PREFILL_PROVENANCE_CAP` is 24 (`:125`). The first
  predates v34; the other two were picked in v34 to make the provenance backfill possible and to bound
  the round trips, not from a curve. The one cost that IS measured is the pre-check: prefill median
  38ms to 45ms and p90 279ms to 293ms over 143 rows, so about 7ms, and the `definition()` round trips
  cost slightly more than the shape walks they avoid. **UNVERIFIABLE** (C296): that arm is gone with
  the rest of the v34 chain; a re-run of the prefill pre-check arm would check it. Nobody has measured
  what the CAPS are worth. Do not tune them by feel; they decide what the model sees.
- **`instructPostprocess.ts`: a repair round can die on its own reply's fencing.**
  `[fngen] request failed: generation contains a code-fence line (unclosed or nested fence in the reply)`
  discarded a whole round on a live capture, leaving the previous body in the human's file. A rejected
  round costs a round and says nothing about what to do differently. Worth deciding whether a nested
  fence can be recovered from rather than refused, on a real capture and not a synthetic one.
- **The hover recovery runs on FIM's deadline legs too** (`completionProvider.ts:1401` and `:1559`
  call the same `resolveCrossFileShape`). New cost in FREQUENCY, not kind; latency and dark rate
  unmeasured on either leg; the degrade is honest-dark. Shipped OPEN in 1.1.0.
- **Three false refusals in the hover recovery, all in the safe direction:** `r#type` raw idents,
  `[Node; 1 << BITS]` read as unbalanced generics, and a C-variadic `...` read as an elision marker.
  Each ADDS recoveries and so moves the surface - each wants its own arm, none can ride along.
  **UNVERIFIABLE** (C301): the code exists (`src/core/rustHoverRecovery.ts`) but the scrap naming the
  three refusals is off-box. A re-scan for hover-recovery refusals would check them, cheap enough to
  fold into whichever arm goes first.
- **`oracleSurface.ts`: the v30 usage leg has no fallback for a draft that INVENTED a method.**
  References on a name that does not exist return nothing, and the round proceeds with no windows. The
  leg is `resolveUsageForRound` at `:1100-1121`, targets filter to `via === "member"`, a references
  miss gets a channel line and nothing adjacent (`:1097-1098`), and no fallback path exists.
  Candidates named at ratification: type-level references of the types in play, or a bounded
  model-emitted observation request answered by the extractors. REASONED, read not run.
- **`specs.js`: the memberSite/argSite fixtures point at EXISTING calls**, where rust-analyzer renders
  labels differently than at a bare dot. Rendered-output rows grade a shape the user never types.
  Audit all languages.
- **`specs.js`: C#'s knownLeaks (`Equals`, `GetHashCode`, `GetType`, `ToString`) are still declared and
  unpromoted** (`specs.js:222`). The comment defers to roadmap tracking (`:13-18`) and states "Roslyn
  hands back object's members at every receiver" (`:220-221`). What remains is the promotion decision.
- **The E0425 self-reference check:** `let x = s.f(&x, ...)` is wrong with certainty. Built as a text
  scan and WITHDRAWN: 224 false suppressions across 1.6M sites, zero true positives. Needs scope
  evidence, not string evidence.
- **`postprocess.ts`:** `limitScopeByIndentation` lacks same-depth stray-closer gating, and
  `closersAllExternal` counts brackets inside string/regex literals. v25 moved the scanners into
  `brackets.ts`; verify against that shape before fixing.
- **Blocks inside a RENAMED folder do not follow**, and inside a DELETED folder they self-heal to
  `lost:"deleted"` at the next resolve. VS Code fires the rename/delete events with the folder uri
  only, never per contained file. Both documented in the handlers. Building for it means walking the
  workspace on every folder event, which is real cost for a rare gesture.
- **`contextBlocks.ts`: `isStale` is on no shipped path.** It survives because `blind3-snapshot` binds
  14 rows to it, and its leg-2 logic lives on inside the re-adoption audit through the shared
  `canonical` helper. Delete it when those oracles are next re-cut.
- **`fnGen.ts`: a generation cancelled mid-resolve still mutates the store and still warns.** The
  resolve runs before the cancellation token is consulted, so cancelling while a closed file is being
  opened can lose a block and then say "the prompt did not include it" for a prompt that was never
  sent. Self-consistent, just a surprising sentence to read after pressing Escape.
- **FIM cache: the key carries no injection fingerprint**, so an edit above the cursor that changes the
  member set can serve a stale ghost until a keystroke re-keys.
- **RA/LS queries:** the injection race's loser is used by the gate since v18, but the server work
  itself cannot be cancelled (see Rejected). Wasted work, note only.
- **darkSites grows unpruned**, in every language.
- **The digit-ending receiver guard darkens Go/Python stdlib qualifiers:** `utf8.` and `sha256.` read
  as float-ish and go dark. Refuse only numeric literals; measure first, the class is invisible to the
  ledger.
- **Python's bound p90 is 202-207ms against the 200ms bar**, and the lever is named: a
  declaration-head parameter list holds brackets open, so the bound reads five lines and retracts to
  one, serving a truncated `run_in_process(config_path: str, method_name: str,)`. A served-text change
  with a real correctness price; measure before/after on `session-v25/harness/verify-v25.cjs`
  (LANGS=python, ~90s). Known trap: the bound's balance is local to the cursor's line, so a `(` opened
  three lines up is invisible; the `beginsHere` guard is the fix shape.
- **`crossFileShape.ts`: the bound is split across two files and the second caller inherited the
  unbounded half.** `resolveCrossFileShape`'s bound is `{D_MAX, N_MAX, B_MAX?}` (`:124-158`) while
  TOK_MAX lives in `dataShape.ts`'s own `WalkBounds` (`:39-42`). fn-gen wires its bound at
  `fnGen.ts:2592` via `prefillGatherBound`, and fn-gen is NOT the only caller:
  `completionProvider.ts:1401` and `:1559` drive the same walk on the FIM legs with `CROSS_FILE_BOUND`,
  which carries no `B_MAX` and no TOK_MAX. Either fold the bound into the signature or say so where the
  parameter is declared.
- **Four one-line wording jobs, each too small for an item.** `firstRun.ts:220`'s decline message is
  the pattern for all of them. (a) The remote model-missing disable names the model and the host and
  not the way back: after pulling the model on the remote box, re-enabling needs a settings touch or a
  window reload and nothing says so. (b) `rustReach.ts` returns on an unreadable `.rs` def file before
  the module chain is walked, so a readable `lib.rs` that DISPROVES the path is never consulted; walk
  the chain first and let the def read be a later disproof rather than an early exit. (c) Three copies
  of a Rust `use`-tree expander exist, and `instructPostprocess.ts:395` is the exported one that also
  handles `{self}` - fold `rustReach.ts:191` into it on the next touch of either. No behavioural
  divergence found, but one mechanism, one copy.
- **Settings honesty, and the serving knobs nobody can reach.** `maxTokens`/`temperature` do not say
  they are FIM-only. Four fn-gen knobs are declared nowhere in `package.json`, so a user has no remedy
  for any of them: `maxTokens` (2048), `testMaxTokens` (8192), `numCtx` (16384) and `think` (unset).

  `numCtx` earns its own paragraph, because getting it wrong is INVISIBLE. It bounds the prompt and the
  generation together, ollama's own default is 2048, and a prompt over that is silently truncated to
  fit rather than refused. Measured in v34: three prompts carrying 12.9KB, 13.1KB and 15.0KB of
  injected surface all reported exactly 2050 prompt tokens, no error and no log line, so injected types
  simply stopped reaching the model. It is coupled to `maxTokens` in a way a user will not guess:
  raising `num_predict` without raising `num_ctx` makes generation WORSE, because the reply eats the
  window the prompt needs. Memory cost at the 16GB carve with `num_gpu=30` is 11.9GB at 8192 against
  12.4GB at 16384, so about half a gigabyte buys the larger window. **UNVERIFIABLE, those three
  measurements** (C329-C331): the raw runs are gone; they survive as a carve record inside
  `src/core/ollama.ts:141-159`. Re-running at `num_ctx=2048`, and re-measuring the carve, would check
  them. The truncation BEHAVIOUR is documented in the same file and is not in question.

  `think` has no setting AND no stated default. Any model that reasons by default is unusable until it
  is false: `qwen3.6:27b` spent all 2048 output tokens on the trace and every generation was rejected
  as truncated without emitting code, because reasoning is billed to the same budget as the answer.

  **RULED 2026-08-24, and the ruling is item 73:** thinking becomes a Command Palette quick action
  with levels (off until toggled, budget scaled with it), `numCtx` becomes a setting, and
  `maxTokens`/`testMaxTokens` stay internal - their failure mode is a visible `done_reason=length`
  reject, and v34 already showed the shipped values were the problem rather than the exposure: 512
  caused every one of 15 rejections across 189 generations. **UNVERIFIABLE** (C333): that run
  survives only as a recitation at `src/core/config.ts:51-54`.

## 5. Dogfood ledgers and Rejected

### Dogfood ledgers - questions only real use answers

Each entry names its measurement. The dark-site evidence lines and `[fim] dropped:` channel lines
exist to BE the measurement basis.

#### TypeScript

- The member gate suppresses forward references: sketching `this.computeTotals()` before writing it
  gets dropped. Count wanted `[fim] dropped:` lines; kill switch `column80.fimMemberGate`.
- A fast-typed new file (imports not yet written) puts the receiver at `any`; injection goes dark and
  plain FIM invents members. Measure frequency before picking a fix.
- Aliased imports (`import { X as Y }`) burn the prefill cap with duplicate blocks. Dedupe on resolved
  identity if real accepts show crowding.
- The whole-block anchor misses JSDoc-only types.
- DOM lib names (MouseEvent, HTMLElement) chase lib.dom.d.ts walks. Curate additions from measured
  noise; `Request` collides with Express, so never a blind blocklist.
- tsconfig-less JS projects get the env-reason line on every accept. Nag against discoverability;
  judge on real accepts.
- Broken solution shells surface the shell's own config error. Honest today.
- yarn PnP is honest-dark. Fix only if users actually hit it; never a bundled TS.

#### C#

- An invented type/package gets qualify-only. Catalog steering and fuzzy suggestions come later, on
  evidence.
- The member gate on a partial Roslyn set could suppress a real member. REASONED only; watch for real
  suppressions.
- `qualifyImport` rejects `global::` and generic-arity titles. Safe direction; widen when dogfood
  produces one.
- Object-statics noise (Equals, ReferenceEquals) is filtered on the COMPLETION path:
  `isCsObjectDeclaredMember` keys on the declaring type Roslyn renders into the signature and
  tier-demotes or withholds (`csExtraction.ts:601-612`, reasoning at `:647-661`;
  `csLspExtractor.ts:345`). `membersOfType` stays deliberately unfiltered because its descent is
  syntactic. What is left to watch is whether that asymmetry ever shows up in a prompt.
- A doc comment that itself demands `throw NotImplementedException` trips the punt marker, and the
  obedient retry violates the contract. Fix on a real capture. Python shares this class via
  `raise NotImplementedError`.

#### Python

- Sub-package venvs in a monorepo go unfound; the check falls to system python and likely a
  missing-imports storm.
- The repair-round hallucination classifier (pyright names the class) builds only if bare repair leaves
  member hallucinations standing.
- A genuinely dark receiver no longer burns the full ~900ms retry: session-v50 bounded the loop
  (`SETTLE_ALLOWANCE_MS = 120` with a 600ms hover, `crossFileShape.ts:850-852`) on a measurement of
  77-87% pure cost. **The "zero recovery over 41 cursors" half of that measurement is a fact about a
  WARM probe and is superseded:** a cold probe over pyright measured 17 re-polled cursors and 2
  recoveries, both `0/5 -> 5/5` on the same row, so the loop bought back a member list that would
  otherwise have rendered empty. The loop is KEPT. Whether the bound can go to zero is closed with it.
- Enum receivers inject a dozen `_name_`/`_value_` internals. Narrow enum-scoped trim only, never a
  blanket sunder drop.
- The product transport returned six members with NO signatures for `membersOfType(Tile)`. The contract
  row calls that half the v15 defect. This is the Python row worth acting on.
- The dark-site counter counts cold-server transients as dark sites. Telemetry-only harm; add a
  settled-index guard before trusting the density numbers.
- `completeMembers` and `membersOfType` disagree on dunders and nested classes. Pin both when fn-gen
  prefill consumes the answer.
- `pass`-only and `...`-only bodies are invisible punts. Build a detector only if dogfood delivers one
  to a human.

#### Go

The ledger starts empty by design: no Go repo of the human's lives on this box yet. All numbers are
OSS-corpus harness signal (cobra, gin, hugo, pinned clones), never dogfood typing.

- Latency: hugo warm check 1.09s clears the 14.2s re-scope floor by 13x. Re-measure on the first real
  client repo.
- `membersOfType` is file-scoped, which costs cobra 24.7% of `Command`'s members (they live across
  sibling files). Watch whether real Go code pays this in whole-block quality.
- The injected block cannot name a package-level constructor (`TileFromMorton`); the ratified join
  contract excludes them. Count whole-block generations that invent a constructor; that count prices
  the discovery rule.
- Everything is proven on gopls v0.23.0. The drift canary goes red if the two-rule taxonomy moves;
  never re-arm on a stale taxonomy.

#### Rust

- Example sourcing misses constructor examples documented on associated functions (a `Type::` query
  would find them), and the injected example text is never logged, so a weak example cannot be
  diagnosed.
- Cross-file impl blocks are invisible to `membersOfType`.
- The feature-graph scan misses macro-gated modules. Benign; broaden only if needs-feature steering
  proves out.
- No rival inline-provider detection: Continue et al. silently win the ghost slot. And no "autocomplete
  is off" evidence line when disabled. Both get misread as breakage.
- **Does `Tighten Doc Comment` earn its palette slot?** The command shipped in 2.1.0 and the measured
  yield is thin: 2 names across 30 Rust targets and 5 across 30 TypeScript. Whether that is worth a
  gesture is answered by pressing it on real work, not by another census. Count the times it proposes
  a backtick you keep.
- **Rust's class-4 enum-variant population is unmeasured.** The backtick proposer's hardest population
  is a variant name that reads like a type, and nobody has counted how often it occurs in real Rust.
  Watch for a proposal that backticks a variant.
- **Does the invented-member gate misfire in Rust?** New in 2026-08-23: Rust joined the gate (S30) and
  its legal list now carries the keyword and postfix labels the render drops. False suppression on
  membership measured 0 of 196 real sites before the build, and the arming rule holds the legal-only
  tail behind a non-empty semantic surface. Watch for a real member being struck, and for `.await`
  staying available at a Future receiver.

### Rejected - do not reopen without new evidence

- **Unforgeable channel frames (a nonce in the elision marker).** RULED 2026-08-24: the forgeability
  is accepted and recorded. Product-tag forgery is closed by the S21/S29 escapes; what remains only
  fakes an elision claim on a diagnostic surface, and nonce machinery is the first-run lock's shape
  again. Rider S59-12 travels with this: `escapeBreaks` is not injective, so a server sending the
  literal backslash-n is indistinguishable from one sending a newline - it cannot forge a row, and it
  is accepted with the rest.
- **Naming the arm and the gesture in the crafted sentences (S58-14, S58-15).** WONTFIX 2026-08-24:
  one backend runs at a time and readable off `column80.fnGenProvider`, the user ran the gesture a
  second ago, and the next action differs by neither. The cheap implementation moment (the
  translator-leaf lift) has already passed. Reopen only on a real captured confusion.
- **A first-run lock across extension hosts.** WONTFIX, human ruling 2026-08-21: overengineering for
  this tool. The defect is real and ~100ms wide - two windows opened together can both show the tier
  picker, because `globalState` propagates between hosts through a debounced broadcast and `Memento`
  exposes no change event - and the only honest fix is a lock file under `globalStorageUri` with
  stale-lock handling, which is machinery a duplicate picker does not justify. The in-process guard is
  PROVEN inert (built, measured, reverted): one host per window and `Memento.update` commits
  synchronously, so the existing `get() !== true` already covers every same-host case. Two riders
  survive for anyone building on `globalState`: cross-host propagation replaces the whole
  per-extension blob last-write-wins, and a guard that persists "asked" before its flow completes
  turns asked-twice into never-asked, which is worse. A `KNOWN WRONG` row in
  `test/blind-v55-p3-firstrun-once.test.cjs` pins today's behaviour.
- **Cancelling language-server work.** Impossible, not deferred. The provider bridge forwards only
  declared args and hardcodes `CancellationToken.None`. Confirmed empirically: a pre-cancelled token
  still bought a full server answer. The only lever on per-keystroke work is to issue less of it.
- **A Cancel button around the LS phase.** It cannot cancel. Worse than silence.
- **Constrained decoding as a picker.** Tested on ollama 0.30.11: `grammar` is silently ignored; a
  JSON-Schema enum works and is a trap. Three of four models (including the product's own) picked a
  real-but-wrong member. That converts a loud compile error into silent wrong code that passes every
  gate. Every layer here is a correctness oracle; none is an intent oracle. Output filtering against
  the real member set is the only legitimate small-model role.
- **Machine-applicable rustc fixes as a repair rung.** Measured on 34 broken variants: only 3 of 17
  error codes ever emit MachineApplicable, E0599 carries no suggestion at all, and a MachineApplicable
  `.try_into().unwrap()` compiles clean then panics at runtime. Re-check passes it. The safety
  argument is refuted with a demonstration.
- **Deterministic member picking.** The premise is false: 0 of 1,703 real sites had a single candidate
  (median 34). Combined rules: 5.3% correct, 63.2% precision, 71% of wins literal name echo. Filter,
  not picker; that value shipped as the gate.
- **Ceding member sites to the native widget.** Human call, 2026-07-21: the widget gives a name, the
  ghost gives the whole statement. Compose, never cede. Shipped as v19.
- **VS Code diagnostics loopback as the oracle.** Lossy, stale mirror. One-way diagnostics invariant
  stands.
- **A confidence signal on a generation.** Rejected because it guesses at output quality, and a product
  that second-guesses its own answers is not what this is. The distinction that keeps the channel lines
  legitimate: a channel line reports a MEASURED FACT about what was actually sent (item 43's budget
  arithmetic is the worked example), never an estimate of how good the answer is.
- **Small model as a doc-relevance pre-filter.** It filters output only.
- **docs.rs example sourcing.** Network at runtime breaks the offline invariant.
- **Blanket crate allowlist.** Wrecked std-correct tasks 8/8 to 0/8.
- **Test-repair.** A wrong test is a human re-type.
- **`--nocapture` on the test rung.** A passing test printing `test x ... ok` parses as a bogus case.
- **Blanket sunder drop in Python.** Hides real `_private` API.
- **The arity gate leg.** Removed v19 on measurement: dead in three of four languages, and on TS it
  caught 1 wrong call while suppressing 3 correct ones over 887 generations. Do not reintroduce
  without measuring all languages.
- **Widening the E0433 classifier to inject a workspace-resolved type.** Refuted 2026-07-31 on a
  corrected harness. Of the five rows and eight type names the goal named, two rows were splice
  artefacts, one row is already covered today as `wrong-item`, one name is a std trait, one is an enum
  variant, and exactly one (`Ia5String`) is a real injectable type. The proposed mechanism cannot
  reach it: rust-analyzer's plain `workspace/symbol` is workspace-scoped and returns zero hits for
  `Ia5String` and for the control `CertificateDer`, and where it does answer it can answer wrong
  (`ServerConfig` returns two workspace hits when the code needs `rustls::ServerConfig`). The
  dep-reaching `*` modifier returns 4 to 10 candidates with no disambiguator. Corrected zero-coverage
  is 8 of 102 rows, and 10 of the 33 residual occurrences are std traits no injection should resolve.
- **Scanning comments for unbackticked type names.** Measured on two populations, both agree it is a
  junk generator: 97.7% junk over 6,856 human-written comment lines (5,232 names, 122 real types),
  reproduced after the harness fix. Superseded by the backtick gesture that shipped in v36.
  **UNVERIFIABLE** (C411): the census artifact is not on disk, though the same counts are recited at
  `docs/user-manual.md:163`. A session quoting 97.7% at something else should re-derive it first.
- **Reordering the prefill tiers.** The v37 scout replayed the item's own row: the doc contributed zero
  candidates, so imports never beat the doc and there was no ordering bug to fix. The one real
  ordering effect - rustfmt's alphabetical import order deciding which project type wins - is a symptom
  of the cap, and the cap arm is measured flat: 4 -> 12 moved 0.8 points, inside the noise floor.
  **UNVERIFIABLE, the replay** (C412): no item-31 replay artifact survives. `prioritizedTypes` exists
  (`src/vscode/fnGen.ts:2069`), so re-replaying the row through it would check the zero-candidates
  finding.
- **Raising `DATASHAPE_TOTAL_TOK`.** Measured, session-v39 (the 800/600 arm): 61 against 56/56, and
  banded by actual prompt growth the gain sits on 133 rows the budget never touched (+2.5 of pure
  variance), while the 46 rows that grew 901B+ paid -0.5 and ate ~38k of the 98.5k added bytes. The
  render-pass budget shipped in 1.2.0 buys the rescue without the bytes. **UNVERIFIABLE** (C414): no
  result file survives; `session-v39/` holds only the arm harness, whose header carries the v38
  baselines 43/42/40. Item 41a's cloud arm proposes to raise a neighbouring budget, so it should
  re-derive this rather than cite it.
- **Exempting the walk's own root from the per-walk `TOK_MAX`.** Same session: root drops stayed at 63
  and starved rows went 21 -> 24. The refutation is written in `src/core/dataShape.ts`.

## Terms used everywhere

- **FIM / plain continuation**: the small model (1.5b) finishing the line you are typing.
- **fn-gen**: the big model generating a whole function from its doc comment. "30b" is the install
  default (`column80.fnGenModel` = `qwen3-coder:30b`) and not the definition: the 16GB-low-RAM tier
  serves a 14b instead (`column80.fnGenFallbackModel`, `src/core/tiers.ts:28-45`), and five non-local
  backends run fn-gen on cloud models entirely.
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

The extension is a flow-state tool for a developer doing system-2 thinking. Eyes stay on the code. The
interaction is a keystroke on a visible diff, and it ends at accept or reject. A feature that makes the
developer manage the tool fails, regardless of capability.

Split rule: a tuning goes in the ledgers or deferred fixes. A numbered item needs its own goal and
scout.

### 74. Dictation on macOS and Windows is built and unproven

Session-v65 ruled all three platforms and proved Linux on the reference box: the recorder
(miniaudio) and `whisper-server` run from the vsix, five languages green in the host tier. The
release workflow builds the macOS arm64, macOS x64 and Windows x64 pairs on GitHub's runners and
packages one vsix each, and nothing has run them. What to prove per platform: `column80-capture
--list` shows the real devices, a take reaches the recogniser, the OS microphone permission
prompt attributes to VS Code (macOS TCC), and press-to-first-buffer is a number. REASONED only.

### 75. The speakers are not muted on Windows during a take

`speakerMute.ts` has `wpctl`/`pactl` for Linux and `osascript` for macOS; Windows needs a COM
call (IAudioEndpointVolume) that no shipped binary makes. The channel says
`no speaker mute on win32 yet`. The cheap route is a `--mute`/`--unmute` pair on
`column80-capture`, since it already links nothing and Windows audio is one `#ifdef` away.

### 76. Dictation over Remote needs a `ui`-kind companion extension

Ruled in session-v65: refused with one sentence, the recogniser not started and the model not
offered on a remote host. The fix is a second small extension of kind `ui` that records on the
client and hands the transcript across on a command; the workspace extension keeps the FIM
side. A packaging split, its own session. `["ui","workspace"]` on the single extension stays
refused (the language servers would hit the wrong filesystem).

### 77. The fuzzy matcher and the recogniser prompt, deferred with their measurements

The edit-distance matcher (0.78, phonetic tie-break) recovers 102 of 120 spoken identifiers
against 2 wrong on a synthetic voice, and the file-scoped recogniser prompt fixes 178 to 215 of
360 transcripts; neither moved the ghost (155 to 161 against 157 heard). Earned only on real
dictation: on the first 50 gestures on the human's mic, count refusals the human then typed by
hand, and reopen the prompt only if the cleaner refused names it would have fixed. Plurals are
the same file (scrap S65-4): the comment wants the word, the resolver wants the root.

### 78. Dictate a declaration: the name and parameters matched, not guessed

What shipped (3.2.0, then 3.3.0): at a declaration site the sentence stays as the doc comment
in the language's form, the head lands under it with a body line and closer where the head opens
one, and the accept runs through the post-accept hook, so the compiler check and the repair loop
already run on the landed head and repair writes the body from the doc comment and the
signature. PROVEN 2026-09-02 on the human's own box: the dictated doc comment of `endOfLiteral`
landed a correct head, tsc went red on the empty body, repair wrote the body. Module level, the
attribute lines above a head, C# records and every declaration shape in five languages landed
in 3.3.0 (`docs/architecture/dictation.md`, "Gesture 2").

What is still owed, and why it is an item rather than done:

- **The name and parameter list are guessed.** The scout's measurement on 100 documented Rust
  heads with the body absent: the doc comment triples the exact-head rate and it is still one in
  six, with misses of exactly the compiler's kind. The build matches the dictated name and
  parameters against what was heard instead of trusting the model's head, with repair mandatory
  on a mismatch. Its own goal, with a dictated-doc-comment population authored the way the line
  intents were.
- **The fifty-gesture falsifier** in `docs/architecture/dictation.md` ("Evidence") has not run:
  one real gesture is one data point.
- **A mis-heard word now persists.** The kept doc comment is the one place the recogniser's
  output reaches the file ("An unt terminated literal" landed on the first real gesture). Either
  the fuzzy matcher of item 77 earns its place on the doc leg, or repair is told it may fix the
  comment too. Ruled nowhere yet.

### 79. GPU builds of the recogniser

The vendored `whisper-server` is CPU-only with AVX2 as the x64 floor: about 250ms per six second
take on the reference box, roughly double on a laptop CPU, still inside the bar. Metal on macOS,
CUDA or Vulkan elsewhere turn that into tens of milliseconds and the release matrix would need
the SDKs. Earned when a laptop measurement misses the second.
