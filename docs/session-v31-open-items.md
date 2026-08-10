# session-v31 open items

What the five-language TDD build left open. This file SHIPS, because `session*/` is gitignored and
`goal.md` was explicit that a decision recorded only in a session folder is the failure roadmap item 1
already describes.

Fold these into `docs/roadmap.md` when convenient; that is the one backlog. Fuller reasoning, with the
measurements behind each, is in `session-v31/scraps.md` on disk.

## Waiting on a human decision

**The Python blank-value hint is not valid Python.** The hint spelling is `${1:/* T */}`. In Rust that
is load-bearing: leaving it gives `vec![/* T */]`, valid Rust reading as an empty vec, so the human
expresses "empty" by tabbing past. `/* */` is not Python, so tabbing past leaves `[/* int */]`, which
does not parse.

Three ways out, none obviously right. Accept it, on the argument that a blank-value gesture is meant
to be typed into and invalid syntax is a loud reminder rather than a silent wrong value. Or use `...`,
which parses but makes `[...]` a list containing Ellipsis, trading an invalid file for a wrong value,
which `goal.md` item 6 calls the lying direction. Or drop the hint for Python, losing the only thing
telling the human what shape to type.

Option one is what shipped and is the safe default.

## Closed in phase 6, recorded because the reasoning is worth keeping

These were deferred through the five leg phases and are now DONE. Listed so nobody re-opens them.

- **The blank-value locator failed open and the floor was all-or-nothing.** When the locator silently
  found no span for ONE assertion, the others still produced holes, the count-based check stayed quiet,
  and the model's guess shipped. The locator does not have to be WRONG to lie, only SILENT. Closed by
  an `unresolvedAssertions` signal on all nine frameworks: the whole pass is refused when any assertion
  the locator walked carries a value it could not place. Deliberately NOT closed by teaching individual
  locators more shapes, which is the treadmill.
- **`structFields` could be orphaned**, **report files were never deleted before a spawn**, **the
  whole-file plan wore the same mode string as a small append** (so a whole-file rewrite would have
  skipped the diff), and **the languageId set was discovered one flip at a time**. All closed:
  `tddLanguageIds()` is now the single source read by both the seam and `package.json`.

## Still deferred

**The Python probe is synchronous on the extension host.** Bounded at 2 seconds, but a slow import is
felt. Making the channel non-blocking is an execution-model change.

**Report files accumulate after a run.** The pre-spawn delete shipped; the post-run cleanup did not.

## Verification gaps, and the first is worth real attention

**xUnit and NUnit are built but never driven.** Contoso is MSTest, so MSTest is the only C# framework
exercised against real code. The other two entries come from their documented shapes. The blind oracle
raised this itself and refused to fabricate coverage, on the grounds that inventing a second placement
would test the invention rather than the product. **If an xUnit or NUnit project exists anywhere,
driving Generate Tests once in it is the highest-value verification left in this feature.**

**jest and vitest are each measured on exactly one real repo**, and the tie-break for a project
declaring both is unverified because no mid-migration project exists here.

**Go is measured on libraries only** (cobra, gin, hugo). An application with a `cmd/` layout may place
differently.

**The C# rung is proven on a runtime configuration the product refuses.** Contoso targets net9.0 and
this machine has 8.0.29 and 10.0.10, so verification used `DOTNET_ROLL_FORWARD=Major`. The product
deliberately never sets it, because rolling forward could report green where the developer's own
`dotnet test` hard-fails. Both halves are pinned; a machine with net9.0 installed would be a cleaner
witness.

## Found by the phase 6 review, fixed, with a stated residual

**The write path could destroy a file.** It wrote an empty file unconditionally after the human
accepted, with no re-check. A file appearing between the preview and the accept was truncated to zero
bytes while the human was told the tests were created, and there was no undo because the content never
entered a buffer. Now re-stated before the write and abandoned with a message naming the file.

**Residual, stated rather than solved:** `workspace.fs.writeFile` takes no `overwrite: false` option,
so a TOCTOU window remains in principle between the stat and the write. The window is microseconds
against a human-speed race, but it is not closed.

**The all-or-nothing floor deliberately over-refuses four shapes**, each documented in the source
rather than fixed, because over-refusing is the safe direction: vitest's `toBeGreaterThan` and its
family (an unknown matcher counts as a miss), pytest's bare comparison `assert len(x) > 0`, NUnit's
`Is.Not.Null`, and C#'s `Assert.IsTrue(Widen(3) > 0)`. With survival already at 13.5 / 7.9 / 0 / 0
percent, this refusal will be met often. **The wording matters more than the rule**: it must read as
the tool declining a shape, not as a fault in the human's code. Worth a measurement pass against the
same corpora that produced the survival numbers before this ships.

## Two flaky tests, pre-existing and not caused by this work

`blind-v24-p3-batch`'s `item 14 (regression bar)` and `impl-service`'s `2MB document: miss-path lookup
cost is bounded` each failed once under full-suite parallel load and passed in isolation. Both are
timing assertions. Recorded because an intermittent red is worse than a steady one: it teaches people
to re-run instead of read.

## The thing this feature is for, stated plainly

The rung is REPORT ONLY in all five languages. A failing test driving repair is roadmap item 14 and is
deliberately not built here.

Worth knowing before item 14 starts: `ARCHITECTURE.md` invariant 4 says the repair loop "never
attempts repair from an assertion failure", and a failing TDD test IS an assertion failure. So item 14
cannot simply feed this rung's red into the existing repair path. Its real problem is blame assignment,
deciding whether the test or the implementation is wrong, which `goal.md` names and leaves unbuilt.
What this build gives it is the input contract: per-case names and outcomes, failure detail per case,
and three discriminated no-run outcomes so a repair loop knows when NOT to attempt repair.
