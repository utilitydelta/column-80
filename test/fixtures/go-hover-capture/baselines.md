# session-v49 phase 0: the pre-fill latency baselines

The LEFT-HAND SIDE of the goal's ship gate: *"a leg ships if the pre-fill leg at the install default
stays inside twice its own pre-build baseline"*. Taken before any field walk exists.

Probe: `session-v49/probe/latency-baseline.cjs`. Raw output: `baseline-go.log`, `baseline-cs.log`,
`baseline-py.txt`.

## The numbers

| language | corpus | n | mean | p50 | **p95** | **max** | 2x gate (p95 / max) |
|---|---|---|---|---|---|---|---|
| Go | `v42-corpus/pgx`, gopls v0.23.0 | 20 | 14ms | 1ms | **59ms** | **124ms** | 118ms / 248ms |
| C# | `v46-corpus-cs-repo/dotnet`, Roslyn 2.140.9 | 20 | 139ms | 127ms | **511ms** | **810ms** | 1022ms / 1620ms |
| Python | `mcp-graph-engine` + `debate-event-store`, pyright 1.1.411 | 11 | 2ms | 2ms | **7ms** | **7ms** | 14ms / 14ms |

`fields=0` on **all 51 rows across all three languages**. That is the hole this session closes,
recorded live off three real servers rather than asserted.

## What is timed, and what is not

`resolveCrossFileShape` at the install-default stop (`small`), not the whole of `resolvePrefill`.
Every millisecond this session can add lands inside it: the field parse is pure, and the new cost is
a `definition()` hop per candidate plus, for Python, a hover per field. Candidate selection, prompt
assembly and the render are untouched by all three legs.

**This makes the gate stricter than the goal's wording, not looser.** The goal's reference point is
"the pre-fill leg measures around 285ms"; that is the whole leg, and the sub-leg measured here is a
fraction of it. A change that doubles the sub-leg moves the whole leg by less than 2x. Stated rather
than smuggled — and it is the human's to overrule, which is what the goal says the 2x is for.

**The absolute numbers are small enough that 2x is a tight budget in milliseconds.** Python's gate is
14ms. A hover per field plus a definition per candidate will not fit inside 14ms on a type with ten
fields. That is a real risk to the Python leg and it is visible now rather than at the end.

## Three instrument repairs the baseline forced, before any number was trusted

**1. Roslyn was dying mid-run and the first C# baseline was a corpse.** 18 of 20 rows came back
"nothing resolved" in 0ms — which reads as a blazing-fast product. Cause, captured on stderr:
`didOpen received for … which is already open` → `SIGABRT`. `CsLspExtractor.openDocument` always
sent `didOpen`, while `ensureOpen` opens files lazily behind the caller's back, so a cross-file walk
makes the collision structurally unavoidable. Fixed in `src/core/csLspExtractor.ts`: an already-open
document takes the incremental `didChange` path. The proof it worked is this table — C# now
completes all 20 rows where it previously aborted at row 3.

**2. The headless Python transport rendered no members at all.** See `scraps.md` S49-1. 38 members
in, 0 rendered, on 7 of 7 classes. Fixed by giving `PyLspExtractor.membersOfType` the same hover
backfill the product transport has always had.

**3. A liveness re-gate now runs before every row.** A gate that runs once, at the top, proves the
server was alive when the run started and says nothing about row 12. It re-probes a cursor that
already answered and ABORTS rather than filling a table with silence. It is what caught defect 1,
and its failure message is in `baseline-cs.log`'s first (aborted) run.

## Two probe corrections that changed the numbers materially

- **Pre-open, off the clock.** The first touch of a file paid a 250ms settle sleep belonging to the
  probe, not the product.
- **Warm with a real request, not just `openDocument`.** The Python transport's `ready(uri)` carries
  a one-time `delay(300)` charged on the first *request*, not on the open. Left in, it put a ~302ms
  floor under 8 of 11 Python rows; a stage probe put every millisecond of it in `definition()`
  (`def=303ms hover=2ms members=6ms`). Python's p50 fell from 304ms to 2ms once it was paid off the
  clock. A 300ms floor would have made the gate read "you may add 300ms for free".

## Falsification depth — read this before quoting the table

- **Everything is pre-opened and settled, and the flattery is NOT symmetric.** An earlier draft of
  this page claimed "both sides share the flattery, so the RATIO is fair". That is false, and the
  phase 0 adversarial review was right to attack it. Before the field leg, every Go row and every
  Python row reaches exactly ONE type — so the before-side performs no cross-file hop and pays no
  discovered-file open cost at all. Only the after-side can pay it, and pre-opening zeroes it.
  Handled rather than argued away: the probe now COUNTS discovered-file opens per row and reports a
  NET column with its own invented settle time removed, so both readings are on the page.
- **A single run's p95 should still be run twice, but Go's is stable.** An earlier draft warned that
  Go's p95 read 16ms on one run and 59ms on the next; that warning predates the pre-open and warm
  corrections and does not reproduce. Measured across three runs of the corrected probe: p95
  59/60/61ms, max 124/127/126ms — a 3.4% spread. Keep running the after-side more than once; do NOT
  use "variance" to wave away a gap of the size phase 1 actually found.
- **Python's numbers are already CAPPED, and the artifact does not say so on its own.** The run
  prints `gate: membersOfType(GraphEngine) -> 38 members` and then `members=31` for the same type
  four lines later. The two calls differ only in the budget the caller passed: the gate is generous,
  the walk uses the shipped 32-member / 50ms hover fan-out. So **7 members of the fattest Python row
  are absent from the block with nothing said about them** — the exact failure class the goal makes
  Python's ship condition. The recorded Python p95 is therefore a CAPPED row's cost, and closing the
  phase 3 disclosure may move it.
- **C#'s 6 "hollow" rows are not misses.** `Metaattributemap`, `Metaobjectmap` and friends are
  genuinely `public class X { }` with no members. The probe's hollow-row warning cannot tell an
  empty type from a failed one; here it is the former, checked by reading the source.
- **Python's n is 11.** Both private repos together declare only 11 top-level classes. p95 on 11
  rows is one row from the top. It is the largest real Python on this box and it is thin.
