---
name: dogfood-capture
description: Drive a real user flow against a REAL repository, capture the product's own diagnostic channel, diff it against the last capture, and triage what changed. Use when a change needs grounding in real-world behaviour rather than unit tests, and as the exit gate for an implementation-loop phase that touched behaviour a unit test cannot see. Triggers on "dogfood this", "run it for real", "capture the channel", "did this actually help".
---

# Dogfood Capture

Unit tests answer "did I break what I wrote down". This answers "what does the product actually do to
a real file". They are different questions and the second one is where the gaps live.

## Contract with build-method:implementation-loop

This skill does NOT replace the loop, own phases, or write product code. It is one step the loop
invokes, or the human runs alone.

| the loop owns | this skill owns |
|---|---|
| phases, `session-state.md`, `progress.md` | one capture run and its findings |
| implementation, blind oracles, unit + review agents | the real-repo run and the channel diff |
| the final Do/Defer/Delegate/Delete decision | a RECOMMENDED classification per finding |

Findings come back in the loop's own 4D vocabulary so its triage step consumes them unchanged. Write
nothing to `scraps.md` or `progress.md` yourself: hand the list back and let the loop file it. If no
loop is running, write the findings wherever the human asks.

**Do not run this for every phase.** It costs a live model and several minutes. Run it when a phase
changed something a unit test cannot see: prompt bytes, surface or context selection, ranking or
budget, placement, or anything whose output a human reads.

## Why this exists

Recurring, observed failure: an agent reports a phase green on unit tests, and the first real run
finds defects the whole suite missed. Three reasons, all structural rather than lazy.

1. Unit tests are cheap, deterministic, in-context and self-scoring. A real run needs a live model, a
   warm language server, a real repository and a long log. Given an exit condition of "no Do items
   left", unit tests satisfy it and nothing forces the expensive path.
2. Synthetic fixtures do not reproduce real prompts. A five-language synthetic witness can pass in
   both the before and after arm and discriminate nothing, while the real capture shows the defect
   immediately.
3. The compiler is not the oracle the user cares about. "It compiles" and "it does what the doc says"
   are different claims, and only the second one matters.

## Step 1: preflight, before anything is believed

Environment failures MASQUERADE as product defects. Check first and abort loudly rather than
reporting a phantom regression.

- **The model server answers.** A dead server turns a live suite into a wall of assertion failures
  spread across many files, which reads exactly like a broad regression.
- **The build is current.** Run the project's build. A stale bundle grades the wrong code, and
  `typecheck` passing is not the same thing.
- **The GUI preconditions**, if the flow needs one: a display, and a session that is unlocked and
  focused. A locked session makes every keystroke-driven row fail in a way indistinguishable from a
  real defect.
- **The fixture repos are in their expected state.** Record `git status` for each. Do NOT clean them
  without checking: fixture dirt is frequently load-bearing, and deleting it removes test inputs.
- **The box is quiet.** Concurrent runs cause timing flakes and steal window focus. One thing at a
  time.

State the preflight result before any finding. If a precondition fails, say the run is UNREADABLE
rather than reporting its output.

## Step 2: the rows

Use a fixed, named list of real targets, checked in so runs are comparable. If the project declares
one, use it; otherwise agree three to five with the human and write it down.

- **Real production repositories.** Not the project's own dogfood playgrounds, which are small, clean
  and flatter the product.
- **Cover the shapes that differ**, not just the languages: nested versus top level, with and without
  a doc comment, a target with cross-file dependencies.
- **Reuse the same rows every session.** A row is only evidence when its previous capture exists.

## Step 3: capture

Drive the REAL user gesture through the real product path. Not a re-implementation, not a
reconstructed prompt: a re-derived mapping is how an arm result gets inverted.

Save per row, under the session folder:

- the product's own diagnostic channel, in full and untruncated,
- the resulting diff against the file,
- the outcome of the project's real verification for that file.

**Truncation is the enemy.** Existing code that keeps "the first N log lines" will cut exactly the
line that matters. Capture everything and grep afterwards.

## Step 4: run the repo's OWN tests, not just its compiler

The highest-value line in a capture is often the one where the product declared success and the
repository disagreed:

```
[oracle] check done errors=0 success=true      <- and 8 of 11 tests then failed
```

If the flow has a correctness gate weaker than the repo's tests, run the tests too and record the
delta. Take a BEFORE baseline on the untouched file, then compare. The delta is the finding; absolute
pass counts are noise, because a real repo has pre-existing failures.

## Step 5: diff the channel against the last capture

This is the step that turns a log into a finding, and it needs no human.

Read for these families, which carry most of the signal:

- **What was dropped, and why.** Anything reporting a budget, a cap, a truncation or a priority. Cross
  it against what the target's own documentation ASKED for. A requirement stated in the doc comment
  and then dropped as low priority is a defect every time.
- **What was elided.** A rendered shape containing an ellipsis or a placeholder may have omitted the
  one fact the injection existed to supply.
- **What resolved to nothing**, and whether anything downstream noticed.
- **Counts that moved** against the previous capture, in either direction.

Then read the DIFF the product wrote, against what a competent human would have written. Ask what was
dropped from the original, not only what was added. Silent omission is the failure mode a compiler
cannot see.

## Step 6: classify, then hand back

One line per finding: what, the evidence line from the capture, and a recommended class.

- **Do** when it is a regression this session introduced, or a single-file change with an existing
  test seam.
- **Defer** when it needs a capability that does not exist yet, when it changes measured behaviour and
  would need its own measurement to justify, or when it touches a path shared by every language.
- **Delegate** when the fix belongs to a person or system outside this codebase.
- **Delete** when it is the DEVELOPER's job rather than the product's. Agents almost never reject
  anything; they defer everything, and the backlog grows without bound. Use this class.

Recommend, do not decide. The loop's triage agent, or the human, makes the call.

## Rules

- **Never score your own run.** If an implementation agent produced the change, a different agent
  reads the capture. Motivated reasoning here is severe: fewer failures can mean a setup hook aborted
  and skipped a whole suite, and that reads as an improvement.
- **Compare titles, never totals.** Real-run counts move between identical runs. A changed set of
  failure NAMES is a signal; a changed count is not.
- **Prove "pre-existing" rather than asserting it.** Stash the change, re-run the same row, compare.
  An unproven "that was already broken" is the most common way a real regression ships.
- **A capture that cannot be read is not a pass.** Say so and stop.

---

# Project card: column-80

Everything above is general. This is what it means here, learned the hard way in session-v35.

## Preflight, in order

```bash
curl -s --max-time 5 http://localhost:11434/api/tags >/dev/null && echo up || echo DOWN
npm run build                                   # never trust typecheck alone
echo $DISPLAY; loginctl show-session $(loginctl | awk 'NR==2{print $1}') -p LockedHint
for R in rust ts csharp python go; do (cd ~/repos/$R-scratch && git status --short); done
uptime                                          # one thing at a time
```

- **A dead ollama reads as a product regression.** `npm run test:live` returned 43 pass / 29 fail with
  the server down, and 27 of the 29 were `fetch failed` or `server reachable`, spread across eleven
  files. With the server up: 72/72.
- **`~/repos/*-scratch` dirt is LOAD-BEARING. Do not clean it.** The committed state of those repos
  does not contain the anchors the VS Code tier needs. Reverting `rust-scratch/crates/` deleted
  `by_lod` and `s.enroll(1);`, the tier's `before all` hooks aborted, and the run read
  "48 passing / 2 failing" against a true "50 / 10". Ten tests had stopped running and the smaller
  failure count looked like progress.
- **`rust-scratch/.vscode/settings.json` must keep its uncommitted change** (`column80.enabled`,
  formerly `acmeImplementer.enabled`). With the old key the extension is silently disabled: no
  ghost, no channel.
- **The tier needs an unlocked, focused session.** `python 38 passing / 15 failing` is the recorded
  signature of an unfocused one.

## The channel

Output panel, **"Column 80"**. Everything below greps out of it.

## The rows

Real repo: `~/work/acme/acme-db`. NOT `~/repos/*-scratch`, which are small and clean and
flatter the product.

`acme_crypto/src/pki.rs::create_ca` is the reference row: nested in an `impl`, a doc comment that
states requirements in prose, cross-crate types, and pre-existing tests that catch a wrong answer the
compiler accepts.

Drive it: empty the body, **Generate Function Body**, accept, then **Repair Function Body** on any
failure. For the third write path use **refine** on a clean build.

## What to grep the capture for

```
[fngen] pre-fill dropped .* lower-priority type\(s\)   # cross against the doc comment's own words
[fngen] pre-fill .* injected nothing                   # incl. "nothing renderable"
[fngen] pre-fill truncated .* kept N of M
[fngen] local symbols named in prompt:
[repair] surface (injected|none|EMPTY)
[repair] round 2 refused: errors .* not falling
\[oracle\] check done .* success=true                  # then run the repo's tests anyway
/\* … \*/                                              # an elided payload in a rendered shape
```

`05-inject-run.cjs` keeps only `injLog.slice(0, 6)`. That truncation hid a dead visibility filter for
two sessions. Capture the whole channel.

## The lesson that generalises

Session-v35's four goal items were all unit-green and produced no new product knowledge. One human
dogfood capture produced four findings, two HIGH, and the highest-value one (a tuple-variant payload
rendered as `/* … */`, so the model could not construct the value) had been injected TWICE and was
useless both times. No unit test would have found it, and a synthetic five-language witness ran in
both arms and discriminated nothing.
