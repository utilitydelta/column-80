# Ideas

Rumination space for looping / oracle ideas not yet mature enough to be roadmap slices. Pros and
cons, not commitments. An idea graduates to [roadmap.md](roadmap.md) when it has a clear enough shape
to earn its own goal and scout; until then it marinates here. Nothing on this page is decided.

Every idea is scored against the load-bearing constraints, and an idea that fails one is noted as
failing it, not quietly excused:
- **Flow-state gate** - a keystroke on a visible diff, ends on accept/reject, no tool-management.
- **Function-scoped blast radius** - generation never touches code outside the target function.
- **Dumb agent, smart oracles** - the deterministic tool judges, never the model grading itself.
- **Blind-oracle discipline** - the test-authoring pass never sees a reference implementation.
- **Local-only** - no cloud path, ever.

## The frame: the post-accept oracle ladder, and the fork that decides what is safe to loop

This is a different axis from roadmap item 3's surface-narrowing path (constructor selection ->
return-type graph -> masking, which narrows the input BEFORE generation). This ladder is the stack
of oracles that judge AFTER an accept, ascending in cost and semantic depth:

1. **types / compile** (`cargo check`) - SHIPPED loop. "Does it build."
2. **test pass/fail** (`cargo test`) - rung shipped in v8; the feedback loop is roadmap item 2.
3. **property / fuzz** - "Does it hold across the input space, not just the example points."
4. **coverage** - "Did the tests exercise the code."
5. **mutation** - "Are the tests strong enough to catch a planted bug."
6. **runtime observability** (tracing / metrics) - "Does it behave correctly when actually run."

**The fork that matters more than the ladder:** rungs 1-3 and 6 judge the IMPLEMENTATION against a
fixed contract - safe to close a model loop around, because the thing being optimised (the code) is
not the thing defining correct (the ratified test). Rungs 4-5 judge the TESTS. The instant the model
optimises a test-quality metric it games it (tests that execute lines and assert nothing) - Goodhart,
and it reopens the wrong-contract risk the blank-value ratify gate was built to close. So the
governing rule for everything below: **loop the model against oracles that judge the impl; use
test-quality oracles as signals to the human, never as rewards the model optimises.**

---

## A. Property-based / fuzz testing (rung 3, the standout)

Author properties from the contract (proptest / quickcheck); a failing case returns as a shrinkable
counterexample.

**Pros**
- A property is a strictly stronger contract than example points - it covers the input space, not a
  few sampled coordinates.
- Failure comes back as a deterministic, MINIMISED counterexample - the cleanest possible repair
  signal, and contract-shaped, which is exactly what v8's (c) analysis said a trustworthy loop needs.
- Blind-oracle clean: properties derive from the doc-comment contract, not an impl.
- Fits the loop: deterministic oracle, function-scoped, boundable latency.

**Cons**
- Not every function has an obvious property; forcing one invites a vacuous or WRONG property, and a
  wrong property is a wrong contract - the same risk class as a bad test.
- Shrinking plus many iterations costs more wall-time than one example test; may strain the
  flow-state latency budget.
- Ratify UX is harder: a property is more abstract than a value, so it is harder to eyeball-ratify
  than a blank-value assertion.

**Fit:** highest of the unexplored rungs. Scout-worthy. Would slot as the correctness rung above
roadmap item 2.

## B. Mutation testing (`cargo-mutants`) as a keep-filter

Plant a bug, check whether the ratified tests catch it; keep only tests that kill mutants.

**Pros**
- A deterministic measure of test STRENGTH - the honest answer to "are these tests worth anything."
- Already named in the v8 goal as the keep-filter (not a target).
- Catches the vacuous-test failure mode that coverage misses.

**Cons**
- Slow: runs the suite once per mutant. Batch-only, never a keystroke - off the flow-state path by
  construction.
- A test-judging oracle (rung 5): safe as a filter the human's tests must pass, dangerous the instant
  the model optimises against it.

**Fit:** a batch background quality gate paired with test-gen, not a live interactive rung.

## C. Coverage as a signal (roadmap item 2)

Line / branch coverage surfaces untested branches and which paths the tests exercise.

**Pros**
- Cheap, ubiquitous tooling.
- Genuinely dual-use: seed blind test-gen for uncovered branches; focus repair on proven-exercised
  paths.

**Cons**
- The Goodhart trap in its purest form: a model optimising coverage writes tests that execute lines
  and assert nothing, reopening the wrong-contract risk.
- Necessary, not sufficient. High coverage with weak asserts is WORSE than honest low coverage - it
  manufactures false confidence.

**Fit:** a SIGNAL to the human / a seed for ratified test-gen, never a model-optimised target. Already
on roadmap item 2; the guardrail (human-side only) must stay explicit.

## D. Test-failure -> fn-repair (roadmap item 2, already promoted)

A failing `cargo test` drives a repair round, under v8's blame / stop-and-surface safety design.

**Pros**
- The obvious next rung; most machinery (the repair session, span-scoping) already exists.
- Real dogfood flagged it as the missing piece.

**Cons**
- Attribution: a failing assertion carries no span pointing at the culprit (unlike a compile error).
  Blame is the open problem - shared with G.
- v1 measured wrong-value repair marginal; re-measure spec-before vs failure-after before trusting it.

**Fit:** on the roadmap, incremental. Its hard part (blame) is shared with G and E.

## E. Trace-assertions inside tests (the tractable half of observability)

Instrument the test run; assert on the collected spans - "exactly one DB call", "the retry fired
twice", "no N+1".

**Pros**
- Deterministic and function-scoped - just a richer assertion on rung 2, so it fits the existing loop
  with no new trust model.
- Catches behavioural bugs a return-value assert misses: side-effect shape, call counts, ordering.
- The disciplined, in-editor-viable form of the observability idea.

**Cons**
- Needs a tracing substrate in the code under test; not free on an un-instrumented codebase.
- Authoring a correct trace-assertion blind (from contract only) is harder than a value assert - more
  room for a wrong contract.

**Fit:** promising, and far more tractable than F. Scout alongside property-based testing.

## F. Production metrics / traces as generation feedback (the frontier)

Run a scenario, collect production-style traces/metrics, feed regressions back into generation.

**Pros**
- The only oracle that judges real behaviour-over-time (the DST / chaos layer the build method names)
  rather than a single call.
- Would catch performance and emergent-behaviour faults no unit oracle sees.

**Cons (this is where the invariants strain hardest)**
- Latency: a scenario run plus trace collection is seconds-to-minutes, not a keystroke. Breaks the
  flow-state gate outright.
- Scope: a trace spans many functions; blast radius is one. Attributing a metric regression to the
  generated function is unsolved.
- Oracle premise: "is this trace correct" is not deterministic. If the model judges the trace, it
  grades itself - the core violation of dumb-agent-smart-oracles.

**Fit:** frontier. NOT in-editor-shaped as stated; likely a batch / CI-adjacent tool if anything.
Hold behind a dedicated scout on attribution and the judge problem before it is even a goal.

## G. Human-steered recursive convergence across the call graph

A human-initiated "converge" signal: the loop iterates the impl, and when the fault is downstream (a
callee, recursively) it surfaces the next target and the human authorises a fresh scoped diff there.
Blast radius stays function-scoped PER ACCEPT; the recursion is a human-authorised traversal, not an
auto-rewrite.

**Pros**
- Addresses a real dogfood pain: the bug is often not in the root function under generation.
- The detector already exists - span-scoping partitions in-span vs out-of-span faults and already
  surfaces "N errors remain outside the touched span, in files X." This turns that report from a
  dead end into an actionable navigation.
- Preserves the invariants IF disciplined: one reviewable diff per function, each separately ratified,
  red-is-the-default output.

**Cons / open problems**
- Blame attribution for TEST failures: a failing assertion has no span (shared with D). Needs
  human-points, a panic stack, or trace-based attribution (ties to E / F).
- Trust gradient: editing a fresh generated callee is fair; reaching into long-standing human-owned
  code is a blast-radius EXPANSION that must be flagged loudly, never silent.
- The agent boundary: recursively rewriting a call tree to chase green IS being an agent - the
  anti-persona. The discipline (human authorises each hop, each hop a scoped diff, red the default)
  is the only thing keeping it a flow-state tool rather than the cloud agent this product defines
  against.
- The UX line is the real unknown, and it is a human-click spike, not a headless one: where does
  human-steered traversal stop feeling like a tool and start feeling like an agent?

**Fit:** scout-worthy, not build-ready. The highest-ambition idea here, and the one that most directly
tests the blast-radius invariant. Two scout questions gate a goal: can test-blame be attributed down
a call graph reliably enough to offer, and where is the tool/agent line.

---

## How these relate to the roadmap

- D and C are already promoted to [roadmap.md](roadmap.md) item 2 (they came from real v8 dogfood).
- A, B, E, G are the unexplored rungs - scout candidates, held here until one earns a goal.
- F is the frontier - held behind its own attribution scout; may never be in-editor-shaped.
- The ordering preference if one is picked next: scout A (property-based) for the cleanest safety
  story, spike E (trace-assertions) as the tractable slice of observability, and treat G as its own
  larger scout because its UX question needs a human in the loop.

### Test generation builds fixtures that cannot reach the state under test, and a stub passes the suite

Raised 2026-08-12 from the same session. **PROVEN**, on one function, and the proof is two minutes of
work anybody can repeat.

`trim_out_client_sets` enforces a 4 MiB cap. Asked for tests blind of the implementation,
`qwen3-coder:30b` produced five scenarios whose largest fixture serialises to **406 bytes**, off by a
factor of roughly 10,300. Every scenario therefore sits under the cap, `0` is the truthful expected
value for all five, and the human typing `0` five times was typing the right answer every time. The
model's own comments name the intent it could not build: `// Both sets trimmed` sits beside an
assertion that zero were trimmed.

Replace the body with `{ 0 }` and rerun: the qwen suite passes, the `gpt-5.6-sol` suite fails on its
second scenario. Both suites pass against the real implementation, so a green board does not
distinguish them.

**Why this is structural and not a model-size complaint.** Implementation from a spec is translation:
the doc comment names the shape, the injected surface names the tools, and a 30B renders it fine, five
rounds running. A test from a spec is adversarial construction: you have to invent inputs that reach
the states the spec describes. Nothing in the injected surface says `SUMMARY_PAYLOAD_MAX_BYTES` is 4
MiB, that reaching it needs tens of thousands of entries, or that one `Option<Vec<u64>>` field is a
cheap lever on `wire_size()`. Sol found that lever and wrote a doubling search plus a binary search to
land the payload just over an arbitrary target. Qwen did not, and defaulted to what compiles.

**The blanked-expected-values rule cannot save this, and that is the sharp part.** Ratification worked
exactly as designed. No wrong value entered the suite. The suite is still worthless.

Two candidate builds, and they are not exclusive:

1. **Refuse rather than emit.** The classifier already refuses async, IO, needs-fixture,
   underspecified. A threshold function whose fixture must span orders of magnitude is arguably the
   same category, and refusal is the product's existing answer to "cannot do this honestly".
2. **Supply the constants.** The doc comment names `SUMMARY_PAYLOAD_MAX_BYTES` and the injected
   surface does not carry its VALUE. A const-value leg is small, deterministic, and would at least
   let a model know what magnitude it is aiming at. Scout whether that alone moves fixture quality,
   because it is much cheaper than the alternative.

Detection belongs to item 13. This item is the defect; 13 is the instrument that would have caught it.

### Injection expands downward only, so no caller-direction fact can reach the model

Raised 2026-08-12 from the same session. REASONED, from the injection log of four real generations.

The pre-fill walks INTO the enclosing type: its fields, its nested types, their public members,
roughly depth 2 inside the token budget. Every failure in that session's round table that was not a
spec defect was a fact living in the other direction:

- the function runs inline on a single-threaded executor, so an O(n) call inside its loop stalls the
  event loop
- the vec it iterates is sorted and binary-searched by a read path two crates away, so plain
  iteration order is a permanent per-tenant bias

Neither is reachable at any depth downward. The frontier model missed both exactly as the 30B did,
which is the evidence that this is an injection property and not a capability one.

Today the answer is that the human writes those facts into the doc comment, and that works. The open
question is whether any of it can be supplied deterministically, and it is genuinely open because the
obvious version is expensive:

- **Callers** are a reference query the language server can answer, but rendering them costs budget
  that item 41a says is already the binding constraint, and most callers are noise.
- **Enclosing-file or module doctrine** is cheaper and blunter: a crate- or module-level comment
  stating "this path runs on the shard executor" injected for every function in it. That is a
  convention the way item 34's Go answer became a taught convention, not a resolver feature.

Scout the second before the first. Also worth knowing before anything is built: how often does a real
generation actually fail on a caller-direction fact, rather than on the spec defects item 52 already
covers? On the session's evidence it was one round of five, but one function is not a rate.