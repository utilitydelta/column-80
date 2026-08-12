# Dumb models work

A 30B local model writes production-grade Rust from a doc comment. The same model cannot write a
test for that Rust. Both halves of that sentence are load-bearing, and the second half is the more
useful finding.

This is the write-up of an A/B run through Column 80's two generation paths (`fngen` and TDD tests)
against one real function in a real database, comparing `gpt-5.6-sol` (frontier, cloud) with
`qwen3-coder:30b` (local, Ollama). Everything below is from the actual runs. Where a number is not
measured it is not stated.

## Why this matters

Picture the workflow this is really for. A developer puts the cursor on a signature, holds the mic
key, and talks. They dictate the doc comment as a brain-dump: what the function does, every edge
case, the ordering policy, the reason the obvious implementation is wrong. They know all of it
already. It is in their head from having built the surrounding system. What they do not want to do
is hand-render it into Rust borrow checker syntax for the ninth time today.

The model's job in that workflow is narrow and mechanical: map a spoken spec deterministically onto
the language in front of them. That is a translation job, not a design job. If a 30B model on the
developer's own machine can do it, the economics change completely. No cloud round trip, no token
bill, no chat window, no code leaving the building.

Everything below is a test of that premise. It holds for implementation. It does not hold for tests,
and the reason it does not is structural rather than a matter of model size.

Two of the findings in Part 1 read differently once you have dictation in mind. Spoken prose is
naturally redundant, because people restate things as they think out loud, and redundancy is the one
thing that reliably broke the small model. Spoken prose is also loose about definitions: you say
"subtract the saving" and never say what saving means, which is exactly the ambiguity that produced
a real bug. Neither is an argument against dictation. Both are arguments for a tightening pass
between the mic and the model.

## Why this function

The specimen is `trim_out_client_sets` in `celeriant_wal/src/segment_summary/segment_summary_payload.rs`.
It enforces a 4 MiB cap on a WAL segment summary sidecar by dropping per-aggregate client sets to
`ClientSet::Unknown` until the payload fits.

It was picked because it is hostile to naive generation in three separate ways:

- **A correctness invariant that is not local.** Dropping to `Unknown` is safe (it answers
  maybe-present, costing a scan); rebuilding a set from survivors would be unsafe (a subset answers
  a false absent). Nothing in the signature says so.
- **A performance invariant from two crates away.** It runs inline on a Glommio single-threaded
  executor during log rotation. `wire_size()` is O(n) over aggregates. Call it in the drop loop and
  you have an O(n²) that stalls the shard's event loop.
- **A cross-crate ordering coupling.** `payload.aggregates` is sorted by
  `(org_id, aggregate_type_id, aggregate_id)` and binary-searched by the read path, so iterating in
  vec order means the lowest org id absorbs every seal's degradation, permanently.

The type surface Column 80 injects is a **downward** graph: the enclosing type's fields, its nested
types, their public members, roughly depth 2 inside a 600 token budget. None of those three
invariants live downward. They live in the caller direction, and no amount of depth reaches them.
That is the boundary of deterministic injection, and it is exactly what the doc comment exists to
cover.

## Part 1: implementation generation

### Round 1: frontier model, thin doc comment

The original doc comment was the human's, written the way most doc comments are written:

```rust
/// If the wire size of this segment summary payload is greater than the maximum payload allowed,
/// then trim out all of the client sets until we get under the max payload limit.
/// Each client set that gets trimmed gets set to unknown.
```

`gpt-5.6-sol` produced this:

```rust
pub fn trim_out_client_sets(&mut self) -> usize {
    if self.wire_size() <= SUMMARY_PAYLOAD_MAX_BYTES as u64 {
        return 0;
    }

    let mut trimmed = 0;

    for index in 0..self.aggregates.len() {
        if matches!(&self.aggregates[index].client_set, ClientSet::Unknown) {
            continue;
        }

        self.aggregates[index].client_set = ClientSet::Unknown;
        trimmed += 1;

        if self.wire_size() <= SUMMARY_PAYLOAD_MAX_BYTES as u64 {
            break;
        }
    }

    trimmed
}
```

Correct against its spec. Every existing test passed. It is also O(n²), because `wire_size()` is
inside the loop, and it drops in vec order, which is the org-id bias. A frontier model did not
rescue what the spec did not say.

Two details worth naming. First, the existing test named
`enforce_size_cap_drops_largest_sets_first_never_entries` passed, because its fixture happens to put
the largest set at index 0, so vec order and largest-first coincide. A test can carry a property in
its name and not test it. Second, the surface-only rule ("call only methods listed in the API
surface") actively pushes toward the quadratic: `wire_size()` was on the offered surface, and the
linear version requires declining to call the offered method and doing arithmetic instead.

### Round 2: frontier model, sharpened doc comment

The fix was not a better model. It was four paragraphs of contract:

```rust
/// Enforce `SUMMARY_PAYLOAD_MAX_BYTES` (already `u64`) by dropping per-aggregate
/// client sets to `ClientSet::Unknown`, largest saving first, until the payload
/// fits. Returns how many were dropped; 0 when already under the cap.
///
/// Largest-first is policy, not tuning: every drop costs one aggregate its
/// negative-lookup skip regardless of the set's size, so the goal is to shed the
/// fewest sets per byte freed. Plain `aggregates` order would be worse than
/// arbitrary: the vec is sorted by `(org_id, aggregate_type_id, aggregate_id)`
/// and binary-searched by the read path, so the lowest org id would absorb every
/// seal's degradation, forever.
///
/// Entries are never dropped: listing correctness and segment skipping must not
/// degrade. `Unknown` answers maybe-present, so a drop costs a scan and never a
/// false absent, and if dropping every set still exceeds the cap, return anyway.
///
/// `wire_size()` is O(n): call it ONCE, then subtract each dropped set's saving,
/// `client_set.wire_size() - ClientSet::Unknown.wire_size()`, since the entry keeps
/// paying for the discriminant, from a running total. Skip sets already `Unknown`:
/// they save nothing and must not count toward the return value. Re-checking
/// `wire_size()` per drop is O(n²) and stalls the executor.
```

Same model, same injection, new output:

```rust
pub fn trim_out_client_sets(segment_summary: &mut SegmentSummaryPayload) -> usize {
    let mut current_size = segment_summary.wire_size();
    if current_size <= SUMMARY_PAYLOAD_MAX_BYTES {
        return 0;
    }

    let unknown_size = ClientSet::Unknown.wire_size();
    let mut savings = Vec::new();

    for (index, entry) in segment_summary.aggregates.iter().enumerate() {
        if !matches!(&entry.client_set, ClientSet::Unknown) {
            savings.push((entry.client_set.wire_size() - unknown_size, index));
        }
    }

    savings.sort_unstable_by(|a, b| b.0.cmp(&a.0));

    let mut dropped = 0;
    for (saving, index) in savings {
        if current_size <= SUMMARY_PAYLOAD_MAX_BYTES {
            break;
        }

        segment_summary.aggregates[index].client_set = ClientSet::Unknown;
        current_size -= saving;
        dropped += 1;
    }

    dropped
}
```

That matches the hand-written implementation it was competing against, and beats it in one place:
the hand-written version's `saving > 0` filter avoided an underflow only because `Unknown` happens
to be the minimum-width variant, an invariant nothing enforces. Explicitly excluding `Unknown` is
the honest form.

### Rounds 3 to 5: the local model

`qwen3-coder:30b` needed three rounds, and two of the three failures were the harness, not the
model. Worth knowing before you keelhaul the small model for results it never earned.

**Round 3 was a truncated prompt.** The doc comment reached the model cut off mid-word at
`` `wire_size()` is O(n): c ``. The entire operative instruction was missing. Qwen produced a
quadratic, which is what the surviving text asked for. It also sorted by `entry.wire_size()`
(the whole entry) rather than the client set, which happens to give the same ordering only because
`WIRE_SIZE_FIXED` is a constant 105 for every entry. Correct by coincidence, and silently wrong the
day an entry gains a second variable-width field.

**Round 4 was a spec ambiguity.** With the full paragraph, qwen killed the quadratic and adopted the
running total. It then wrote:

```rust
let saved_bytes = entry.client_set.wire_size();
entry.client_set = ClientSet::Unknown;
current_size -= saved_bytes;
```

`ClientSet::wire_size()` is `4 + ...` and `Unknown` is `4 + 0`, so the entry keeps paying 4 bytes for
the discriminant. Subtracting the full size over-subtracts by 4 per drop, drifting the running total
below the truth by `4 × drops` and breaking out while still over the cap. Roughly 150 KB of overshoot
at 38,000 drops. No test catches a 4 byte drift against 2 MiB of fixture slack.

That was the doc comment's fault. It said "subtract each entry's known saving" and never defined
saving. `gpt-5.6-sol` supplied `saturating_sub(unknown_size)` unprompted because it had the prior;
qwen took the nearest reading. Both are defensible readings of that sentence. Adding the definition
inline (the `client_set.wire_size() - ClientSet::Unknown.wire_size()` clause above) closed it.

**Round 5 was a duplicated paragraph**, an editing slip that left both the old and new ¶4 in the
buffer. Qwen fell apart on it. Dedupe the paragraph and qwen produces this:

```rust
pub fn trim_out_client_sets(segment_summary: &mut SegmentSummaryPayload) -> usize {
    let max_bytes = SUMMARY_PAYLOAD_MAX_BYTES;
    if segment_summary.wire_size() <= max_bytes {
        return 0;
    }

    let mut drops = 0;
    let mut current_size = segment_summary.wire_size();
    let mut aggregate_sizes = Vec::new();

    // Collect all aggregate client set sizes and their indices
    for (i, entry) in segment_summary.aggregates.iter().enumerate() {
        if let ClientSet::Exact(_) | ClientSet::Bloom(_) = entry.client_set {
            let size = entry.client_set.wire_size();
            aggregate_sizes.push((size, i));
        }
    }

    // Sort by size descending to drop largest first
    aggregate_sizes.sort_by(|a, b| b.0.cmp(&a.0));

    // Drop client sets until under the limit
    for (size, index) in aggregate_sizes {
        let entry = &mut segment_summary.aggregates[index];
        if let ClientSet::Exact(_) | ClientSet::Bloom(_) = entry.client_set {
            let unknown_size = ClientSet::Unknown.wire_size();
            let saving = size - unknown_size;
            if current_size <= max_bytes {
                break;
            }
            entry.client_set = ClientSet::Unknown;
            current_size -= saving;
            drops += 1;
        }
    }

    drops
}
```

Behaviourally identical to the frontier output. The remaining gap is lint-level: `sort_by` is a
stable sort that allocates scratch where `sort_unstable_by` would not, `wire_size()` is called twice
at the top, `unknown_size` is recomputed inside the loop, and the `if let` guard is re-checked
redundantly in the drop loop. None of that is a defect. All of it is what a reviewer says in thirty
seconds.

### What Part 1 establishes

| Round | Model | Doc comment state | Outcome |
|---|---|---|---|
| 1 | sol | thin (human's original) | correct, O(n²), org-id bias |
| 2 | sol | sharpened, 4 paragraphs | correct, linear, matches hand-written |
| 3 | qwen | truncated mid-word by the harness | correct, O(n²), fragile sort key |
| 4 | qwen | complete, "saving" undefined | linear, off-by-4 running total |
| 5 | qwen | complete, saving defined, deduped | correct, linear, lint nits only |

Three conclusions, and the third is the one that pays.

1. **The doc comment is the control surface.** Every failure in this table traces to a defect in the
   spec, not the model. Model choice moved lint quality. Spec quality moved correctness.
2. **Redundancy breaks small models, precision does not.** The initial read of round 5 was that spec
   sharpness has a capability floor. Wrong. Qwen handled a longer, more exacting spec without
   complaint once it was not being asked to reconcile two overlapping copies of the same
   instruction. Say each thing once. This is the finding with the sharpest product consequence: a
   dictated doc comment is redundant by construction, because that is how people talk, so the
   dictation path needs a dedupe and tighten step before the prompt is assembled. Flagging two
   near-identical paragraphs in a doc comment is a cheap lint and it protects the exact failure that
   cost a whole round here.
3. **The refinement is durable.** The fix for round 1 was not a better prompt in a chat scrollback.
   It was four paragraphs that now live in the repo, that the next reader gets for free, and that
   would be good documentation even if nobody generated against them again. That is the difference
   between compounding and accumulating debt.

## Part 2: where it falls apart

TDD generation works differently, and the difference is the whole story. Per the user manual: the
model gets the signature, doc comment and callee surface, never a reference body. Then **every
expected value is blanked**. The human Tabs through the holes and types each assertion. A test whose
expected value the model wrote agrees with the code rather than with you.

So the model's contribution is the **fixtures and the scenario structure**. The human's contribution
is the expected values. Keep that split in mind, because it is what makes the failure below so
quiet.

### Qwen's test

```rust
#[test]
fn test_trim_out_client_sets() {
    // Happy path: some client sets trimmed
    let mut payload = SegmentSummaryPayload {
        orgs: vec![1, 2],
        aggregate_types: vec![
            AggregateTypeKey::new(1, 1),
            AggregateTypeKey::new(2, 2),
        ],
        aggregates: vec![
            SegmentAggregateEntry::new(1, 1, 1),
            SegmentAggregateEntry::new(2, 2, 2),
        ],
        complete: true,
        aggregate_bloom: None,
        client_bloom: None,
        schema_bloom: None,
    };
    payload.aggregates[0].client_set = ClientSet::from_client_hashes(&[1, 2, 3].into_iter().collect());
    payload.aggregates[1].client_set = ClientSet::from_client_hashes(&[4, 5, 6].into_iter().collect());
    let initial_size = payload.wire_size();
    assert_eq!(trim_out_client_sets(&mut payload), 0); // Both sets trimmed

    // ... four more scenarios, same shape ...

    // Failure case: all sets trimmed but still over cap
    // ... same 2-aggregate payload ...
    assert_eq!(trim_out_client_sets(&mut payload), 0); // Both sets trimmed
}
```

Five scenarios. Every assertion expects `0`. No scenario asserts anything about the payload's state
after the call. `initial_size` is computed and never used.

The comments are the tell. `// Both sets trimmed` sits next to an assertion that zero sets were
trimmed, and `// Failure case: all sets trimmed but still over cap` labels a payload that is nowhere
near the cap. Qwen knew which scenarios mattered. It could not build them.

Work out why from the arithmetic. The largest fixture in that file is:

```
WIRE_OVERHEAD                    28   (3 × u64 len prefix + 1 flag + 3 Option tags)
orgs             2 × 16     =    32
aggregate_types  2 × 32     =    64
aggregates       2 × (105 + 36) = 282   (WIRE_SIZE_FIXED + Exact(3 hashes))
blooms           all None   =     0
                              -----
                                406 bytes
```

The cap is `4 * 1024 * 1024` = 4,194,304 bytes. The fixture is off by a factor of roughly 10,300.
Every scenario is under the cap, so `0` is the truthful expected value, and the human typing `0` five
times was typing the right answer every time.

That is the trap. The ratification step worked exactly as designed. No wrong value entered the
suite. And the suite is still worthless.

### The mutation proof

Replace the body with a stub and run both suites:

```rust
pub fn trim_out_client_sets(_p: &mut SegmentSummaryPayload) -> usize { 0 }
```

```
$ cargo test -p celeriant_wal --lib column_80_experiment

test segment_summary::column_80_experiment_qwen::tests::test_trim_out_client_sets ... ok
test segment_summary::column_80_experiment_sol::tests::trims_client_sets_..._policy ... FAILED

assertion `left == right` failed
  left: (0, false, false, 1)
 right: (1, true, true, 1)

test result: FAILED. 1 passed; 1 failed
```

Qwen's suite passes against a function that does nothing. Sol's kills it on the second scenario.
Both suites pass against the real implementation, so a green board tells you nothing about which one
you have. No quarter there: the qwen suite is indistinguishable from no suite at all, and it looks
identical in CI.

### Sol's test, and why it works

```rust
let make_saving_client_set = |minimum_saving: u64| {
    let unknown_size = ClientSet::Unknown.wire_size();
    let mut count = 1usize;
    loop {
        let candidate = make_client_set(count);
        if candidate.wire_size().saturating_sub(unknown_size) > minimum_saving {
            break candidate;
        }
        count = count.checked_mul(2).expect("client-set test data grew too large");
    }
};

let pad_to_exceed = |payload: &mut SegmentSummaryPayload, target: u64| {
    payload.schema_bloom.get_or_insert_with(Vec::new);
    if payload.wire_size() > target {
        return;
    }

    let mut high = 1usize;
    loop {
        payload.schema_bloom.as_mut().unwrap().resize(high, 0);
        if payload.wire_size() > target {
            break;
        }
        high = high.checked_mul(2).expect("payload padding grew too large");
    }

    let mut low = 0usize;
    while low < high {
        let middle = low + (high - low) / 2;
        payload.schema_bloom.as_mut().unwrap().resize(middle, 0);
        if payload.wire_size() > target {
            high = middle;
        } else {
            low = middle + 1;
        }
    }
    payload.schema_bloom.as_mut().unwrap().resize(low, 0);
};
```

Sol worked out that you cannot cheaply build a 4 MiB payload out of client sets, found
`schema_bloom` as a ballast lever, and wrote a doubling search plus a binary search to land the
payload just barely over an arbitrary target. Then it built five scenarios whose margins are
computed rather than guessed. The largest-first scenario pads to `MAX + small_saving` so that
dropping the large set alone must suffice and dropping the small one alone cannot.

That is not translation. That is construction, and it is the thing qwen could not do.

**Implementation from a spec is translation.** The doc comment names the algorithm's shape, the
injected surface names the tools, and the job is to render one into the other. A 30B model renders
fine.

**A test from a spec is adversarial construction.** You have to invent inputs that reach the states
the spec describes. Nothing in the type surface says `SUMMARY_PAYLOAD_MAX_BYTES` is 4 MiB, that
reaching it from `SegmentAggregateEntry::new` needs tens of thousands of entries, or that
`schema_bloom` is a cheap lever on `wire_size()`. That is a search problem over the type surface, and
it is where the capability gap actually sits.

### Frontier failure modes

Sol's tests are correct and they are not a clean win.

- **Five scenarios in one `#[test]` function.** The first failure masks the other four. The
  `// column80-tests:...:begin/end` markers suggest a single generated block, so this may be a
  harness constraint rather than a model choice. Either way it is what shipped.
- **Assertions compressed into tuple comparisons.** The real failure output above is
  `left: (0, false, false, 1)`. Which property is `false`? Go read the source and count tuple
  positions. Diagnostics were traded for density, and this codebase's own rule is that a reader
  should understand a change without effort.
- **The fixture builds a state the system cannot produce.** `pad_to_exceed` inflates `schema_bloom`
  toward 4 MiB. The real cap on that field is `SCHEMA_BLOOM_MAX_BYTES`, 8 KiB. The arithmetic under
  test does not care, so the test is valid, but it reads as documentation of a payload shape that
  can never exist. A reader who trusts tests as examples is misled.
- **And the round 1 result stands.** Sol's first implementation carried the same context blindness
  as qwen's: quadratic, org-id biased, passing every test. The frontier model did not rescue that.
  The doc comment did.

## Where this leaves the tooling

Three options, in preference order.

1. **Local model for implementation, human or frontier for fixtures.** Recommended. Implementation
   generation is the path where the doc comment fully constrains the output, so the cheap model is
   genuinely sufficient, and it is the path you run hundreds of times a day. Fixture construction is
   where a bad output is invisible, so it is worth the cloud call or the ten minutes of typing.
2. **Local for both, with fixture reachability as a mandatory review step.** Workable if you make one
   check non-negotiable: does any fixture actually reach the state under test? For a threshold
   function that means printing the fixture size next to the threshold. Cheap, and it catches the
   exact failure above. The risk is that this is a discipline, and disciplines lapse.
3. **Frontier for both.** Buys you fixture construction and costs you the local-first story. It also
   does not buy correctness, per round 1.

### The missing rung on Run TDD Tests

The unmeasured gap is the one the manual already admits: nothing measures what the ratified tests
miss. No coverage, no mutation testing. A green suite can be hollow, and this run produced a hollow
suite on the first try.

Four techniques get proposed for this slot. They are not equal, and shipping them as a bundle would
hide which one is doing the work.

1. **Mutation, specifically a single trivial-return mutant.** Ship this first. It needs no framework,
   just a body replaced with `return Default::default()` and a rerun. It took two minutes by hand
   and it separated a real suite from a hollow one with no ambiguity to argue about. If a suite
   passes against a function that does nothing, there is nothing to discuss. This is the direct
   counter to the Part 2 failure.
2. **Property tests.** Second, and the one that catches a class nothing else here caught. Round 4's
   off-by-4 running-total drift survived every example test in the repo, and it would survive
   coverage and survive a trivial-return mutant. It dies instantly to `wire_size() <= CAP || every
   set is Unknown` over generated payloads. The invariants on this function are unusually
   property-shaped: entries never dropped, wire size monotonically decreasing, returned count equals
   the number of sets that actually changed. Arithmetic drift is what a small model produces from an
   ambiguous spec, so this is aimed at the right target. Note the design question it drags in: if
   the human types every expected value, the human types the invariant too, and an invariant is
   harder to type than a scalar.
3. **Coverage.** Cheap, and it would have caught the qwen suite, because a 406 byte payload returns
   at the guard and leaves the sort and the loop entirely unexecuted. But it goes blind the moment a
   fixture reaches the code without asserting the outcome, which is the more common hollow test. A
   fast pre-filter, not a correctness signal.
4. **Fuzzing.** Wrong tool for this target. No parsing, no untrusted bytes, pure arithmetic over a
   struct the test constructs itself. The fuzz target in this subsystem is
   `deserialise_segment_summary`, where a torn sidecar meets a CRC check and a version gate. Fuzzing
   belongs in the product, but not on this rung.

None of this reduces how much the developer has to think, and it should not be sold that way. It
changes where. Green currently tells you nothing, so suspicion has to be spread evenly over
everything a generation produced. A line saying *this suite survives a stub* collapses that into one
place to look. Less vigilance, better aimed, and the developer's judgement stays exactly where the
tool already puts it: on the expected values, on the refusals, and on whether the spec they dictated
was the spec they meant.

## Honest limits of this study

- **One function, one language, one codebase.** Rust, a WAL internals crate, a function chosen
  because it was hostile. Nothing here generalises to a corpus without running it on a corpus.
- **Single runs, no repeats, no temperature sweep.** Each cell in the round table is one generation.
  Sampling variance is unmeasured and could account for some of the qwen and sol difference.
- **Two models.** `gpt-5.6-sol` and `qwen3-coder:30b`. No mid-size local model was tried, so where
  the fixture-construction capability actually appears is uncharted.
- **The doc comment was written by an LLM in review**, iteratively, with knowledge of what the
  earlier generations got wrong. A human author writing it cold would likely miss the same clauses
  the first spec missed. That is an argument for reviewing generated code carefully, not an
  argument that good specs are easy.
- **No production deployment.** The winning implementation passes the existing suite. It has not run
  a seal on the cluster.

What survives all of that: a 30B local model wrote code indistinguishable in behaviour from a
frontier model's output once the spec was right. And neither model could be trusted to build the
fixture that proves it.
