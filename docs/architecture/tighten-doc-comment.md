# Tighten Doc Comment

The gesture takes a doc comment the developer already wrote, re-wraps it, and offers backticks
around the type names it can prove exist. Files: `src/vscode/tightenDocComment.ts` (the command and
its budget), `src/core/tightenProposer.ts` (the model leg), `src/core/tightenClassify.ts` (the delta
gate and proposal ranking), `src/core/tightenRatify.ts` (the workspace-symbol existence gate),
`src/core/tightenFlags.ts` (the restatement and undefined-term report), `src/core/spokenName.ts`
(the fold and the identifier variants).

This file is the committed measurement record for the feature. The numbers below were measured
during the v52 build and were previously reachable only through the session folder, which a clone
does not have.

## Query cost: one workspace-symbol query is the whole gate

The contract ordered tier 2's work as fold against the disclosed surface (free), then ONE provider
query in the convention most likely for the language, then the full eight-variant sweep only on a
miss, and it refused to assume whether the single query sufficed.

It suffices. Over 451 real type names on two independently written providers the sweep recovered
zero names the first query missed.

The instrument drives the real matchers rather than a model of them: `tsserver`'s `navto` over
stdio (the request VS Code's built-in TypeScript extension answers
`vscode.executeWorkspaceSymbolProvider` with) and `gopls`'s LSP `workspace/symbol`. Each declared
type name is split into the words a person would speak, four query spellings are built from those
words, and a query "answers" when a returned symbol folds to the same key AND carries a type-ish
kind: the same two filters `ratifyWorkspaceHits` applies.

| query | stands for |
|---|---|
| `q0` PascalCase (`ShardMemCache`) | the FIRST query, the one the command spends |
| `q1` glue (`shardmemcache`) | the speaker ran the words together |
| `q2` snake (`shard_mem_cache`) | a sweep variant |
| `q3` mis-split (`ShardMemcache`) | the speaker's words differ from the repo's humps |

TypeScript, tsserver, this repo's own `src/`: 384 declared type names, 369 multi-word.

| | hits | share |
|---|---|---|
| q0 PascalCase | 369 / 369 | 100% |
| q1 glue | 369 / 369 | 100% |
| q2 snake | 3 / 369 | 0.8% |
| q3 mis-split | 369 / 369 | 100% |
| any of the four | 369 / 369 | 100% |

Go, gopls, a real OSS repo (`external/badger`): 82 multi-word declared type names.

| | hits | share |
|---|---|---|
| q0 PascalCase | 77 / 82 | 93.9% |
| q1 glue | 77 / 82 | 93.9% |
| q2 snake | 1 / 82 | 1.2% |
| q3 mis-split | 77 / 82 | 93.9% |
| any of the four | 77 / 82 | 93.9% |

The five Go misses (`aixFlock`, `MockKeys`, `testData`, `MergeFunc`, `logEntry`) are missed by every
spelling, so they are not a sweep case: gopls does not return them for this workspace at all. A
sweep spends up to nine round trips on each and recovers none.

What it rules:

1. The first query is the whole gate in practice. Marginal recall of the sweep over the first
   query is 0 of 451 names on two independently implemented providers.
2. The underscore and hyphen variants are near-dead as QUERIES (0.8% and 1.2%). They are still
   needed as NAMES, because a repo may spell a type `shard_mem_cache` and the fold has to match it
   once the provider returned it. Spending a round trip to ASK in that spelling buys almost nothing.
3. Both providers are hump-aware and case-insensitive enough that the caller's guess about
   convention does not matter: glue and mis-split PascalCase score exactly what PascalCase scores.
4. The sweep still ships, capped at `TIGHTEN_SWEEP_CAP`. It costs nothing when the first query
   hits, which is every measured case, and the corpus is two languages rather than five. A provider
   that is NOT hump-aware would need it, and finding out costs one query.

## What one query costs

The only latency figure the repo held was `refine.ts`'s ~500ms Roslyn floor, and that is for a
REFERENCE call. Tier 2's budget was being sized against a number for a different operation.

Measured warm over each corpus's own type names, with the hit count reported so an unindexed server
cannot pass as a fast one. The first attempt did exactly that: rust-analyzer answered a foreign name
list in 0.2ms, which is the shape of no index.

| server | corpus | hits | cold | p50 | p95 | max |
|---|---|---|---|---|---|---|
| Roslyn `workspace/symbol` | csharp-scratch (2 projects) | 144 | 2.0ms | 0.4ms | 0.9ms | 1.7ms |
| gopls `workspace/symbol` | a real Go OSS repo | 3288 | 7.0ms | 3.8ms | 4.4ms | 5.4ms |
| rust-analyzer `workspace/symbol` | the private Rust corpus | 63 | 116.1ms | 1.2ms | 5.3ms | 27.2ms |
| tsserver `navto` | column-80 | 99 | 51.3ms | 13.9ms | 16.9ms | 22.8ms |
| Pylance | python-scratch | GAP | GAP | GAP | GAP | GAP |

18 distinct queries, three rounds each, 54 timed calls per server.

A workspace-symbol query is 1 to 20ms warm, not 500ms. Carrying the ~500ms reference floor over to
this request over-priced tier 2 by two orders of magnitude, and Roslyn, the server that floor was
measured on, is the FASTEST of the four here.

Python is a reported gap, not an omission. Pylance refuses to run outside VS Code: its
`server.bundle.js` prints the Visual Studio licence terms and exits 1. The number is reachable only
from inside an extension host, which is what `test-vscode/tighten.test.js` row 2 does.

Two caveats. The C# corpus is small, so Roslyn's figure is a floor rather than a number for a large
solution. And the first query of a session pays the cold cost, which the table reports separately:
rust-analyzer's 116ms is index warm-up, paid once.

`TIGHTEN_QUERY_BUDGET` is 12, one first query per span the developer could be shown, with
`TIGHTEN_SWEEP_CAP` of 3 per phrase. Worst case is 12 serial queries: about 0.2s at tsserver's p95,
0.05s at gopls's, 0.01s at Roslyn's. Beside a model round of seconds and a ~285ms pre-fill, tier 2
is no longer the term that decides the gesture's cost. Before this the same worst case was 85
queries, which at the ~500ms figure reads as 42 seconds and at the measured figures as 1.4s. Both
numbers argue for the budget; only one of them is real.

Not measured: Rust, C# and Python matchers for RECALL (only latency), and the dictated-phrase
population as opposed to a type name split back into its own words.

## The fold, and why a fold match is the only equality

Collision risk over the private Rust corpus at commit `487f8c1` (`git archive HEAD`, so the count is
reproducible): 4,863 declared symbols, 3,798 distinct fold keys, 37 of them (0.97%) carrying more
than one spelling.

The narrow claim is the one that holds. The first draft said each collision paired a type with a
const or a function, and that is false: 13 of the 37 involve no type at all (`create|CREATE`,
`name|NAME`, `CLIENT_ID|client_id`). What is true is that ZERO of the 37 are a type against a type,
so a list of proposed TYPE names cannot be silently merged on this corpus. `matchByFold` refuses on
ambiguity rather than picking anyway, so the residual risk is a refusal and never a wrong pick.

The variant generator recovered 100% of the 543 declared type names in that corpus, and that number
is to be DISCOUNTED: the spoken form it swept with was derived by splitting each identifier on its
own humps, so the generator was measured as the inverse of the splitter. The non-circular half is
0%. Of the type names whose spoken form differs from their own humps, 53 carry an abbreviation a
person expands (`mem` said "memory", `args` said "arguments") and the sweep recovers 0 of 53. That
is 9.6% of the corpus's type names reaching the developer as a `guess` and never auto-applying.

### Fold collisions per corpus

The one-corpus claim was widened during the `importLineFor` grading:

| corpus | keys with more than one spelling | type vs type |
|---|---|---|
| the private Rust corpus | 34 of 3,960 (0.86%) | 0 |
| glommio (rust) | 40 of 1,518 (2.64%) | 1 (`IoUring` / `io_uring`) |
| the private C# corpus | 75 of 1,716 (4.37%) | 0 |
| column-80 (typescript) | 10 of 948 (1.05%) | 0 |
| hugo + pgx (go) | 125 of 7,137 (1.75%) | 41 |
| python corpora | 5 of 582 (0.86%) | 0 |

Go is the outlier and the reason `TYPE_ISH_KINDS` is not the whole filter: the exported/unexported
convention puts `Options` and `options` on one key with a type on both sides, and those reach the
ambiguity refusal rather than a merge.

## The delta census: why a redundant backtick is not a no-op

The census drives `resolvePrefill` headless, reads the ledger off the `onLedger` hook, and
classifies with the product's own `classifyCandidate`. Two arms per row: **kept** (the doc comment
as the human wrote it) and **stripped** (every backtick replaced by a SPACE, so no document offset
moves and the two arms differ by exactly the gesture).

The generation manifests were the wrong population and not by a little: `manifest-rs.json` has 403
rows and 13 carry a backticked type name, `manifest-cs.json` 46 and zero, `manifest-ts.json` 39 and
zero. They filter on ground-truth type count and green baselines, which has nothing to do with the
gesture. Two populations were built by the gesture's own rule instead:

- Rust, over the private corpus: 4,450 functions scanned, 905 with a doc comment, **119** with a
  backticked type name, 124 distinct names.
- TypeScript, over the TypeScript compiler's own parser on this repo: 1,498 declarations, 816 with
  JSDoc, **187** with a backticked type name, 243 distinct names.

C#, Python and Go have no gesture population at all, each zero backed by a whole-corpus count.

Class shares, stripped arm (class 1 rendered root, 2 reached as a non-root, 3 reachable but a cap
took it, 4 off the walk entirely):

| | Rust class 1+2 | Rust class 3 | Rust class 4 | TS class 1+2 | TS class 3 | TS class 4 |
|---|---|---|---|---|---|---|
| stripped | 29.4% | 6.5% | 64.1% | 10.7% | 2.3% | 87.0% |

### What class 4 is actually made of

A raw class-4 count is the population a human backticked, not the population a backtick can rescue.
Rust, 109 class-4 instances (40 on the product crates):

| | all crates | product crates |
|---|---|---|
| SCREAMING_CASE, refused by `resolvePrefill`'s own candidate filter | 21 | 7 |
| Rust prelude names the delta gate's stop set missed | 29 | 16 |
| everything else | 59 | 17 |
| of that, declared as a TYPE in the corpus | 4 | 1 |
| of that, an ENUM VARIANT in the corpus | 24 (21 distinct) | 11 (11 distinct) |
| of that, neither | 31 | 5 |

TypeScript, 300 class-4 instances: 6 SCREAMING_CASE, 19 Rust std names quoted in prose, 275
everything else. Of the 275, 7 are declared types in column-80 and 268 are not. That last number is
the corpus's genre showing through, which makes the TypeScript class-4 figure close to meaningless
on its own: column-80's source explains itself with worked examples, so its doc comments backtick
identifiers from OTHER codebases. By contrast 16 of the 45 names that DID reach the surface are
declared column-80 types, so the surface-reaching half is mostly real and the class-4 half mostly is
not.

Two gate defects fell out of this, and both are one-line filters that close 50 of Rust's 109
class-4 instances and 25 of TypeScript's 300:

- `isAllCapsConstant` was applied by the pre-fill and not by the delta gate, so `WORKLOAD_SCHEMA`
  classified as class 4, survived the gate, reached the diff, and was thrown away again by the
  pre-fill the moment it was backticked.
- The delta gate's Rust stop set was narrower than the pre-fill's. `stopNamesFor("rust")` returns
  `STD_TYPE_NAMES`; the pre-fill's doc leg uses `PRELUDE_TYPES`, which also holds `None`, `Some`,
  `Ok`, `Err` and `Self`. 29 of Rust's 109 class-4 instances are those five words.

`prefillStopNamesFor` in `src/core/repairTypes.ts` is the single source both now read.

The interesting residue is enum variants: 24 of Rust's 59 remaining class-4 instances, 21 distinct,
every one a real variant of a real enum in the corpus. The motivating case for the whole command is
an enum, and this is where it lives.

### The eviction, counted

| | Rust, all | Rust, product | TypeScript |
|---|---|---|---|
| rows where the backticks emptied the surface (kept 0 B, stripped > 0 B) | 0 | 0 | 11 of 187 |
| rows the other way | 0 | 0 | 0 |
| total injected surface, kept | 290,572 B | 132,026 B | 177,152 B |
| total injected surface, stripped | 303,427 B | 136,893 B | 261,578 B |

The human's own backticks cost this repo's TypeScript corpus 32% of its injected surface, and on 11
rows they cost all of it: every cap slot went to a backticked name that resolved no block. Rust pays
4.2% overall and 3.6% on the product crates. Nothing goes the other way in either language on any
crate split.

The cap is full on 84.1% of Rust rows and 82.8% of TypeScript rows (cap 4), so `displaces` will be
set on most proposals the gate lets through and every accepted proposal really does push something
out. Mean rendered roots 3.3 and 3.2, mean `notLookedAt` 18.0 and 7.9.

What the gesture itself bought, per name per row across the arms: 5 of 170 names in Rust were in the
surface only WITH the backtick, 0 of 70 on the Rust product crates, 5 of 282 in TypeScript. The
gesture moves about 3% of the names it is spent on, and on the Rust product code it moved nothing.
The reason is dull and it is the finding: a developer backticks the type they already wrote into the
signature, so `typesNamedIn`'s signature leg had it before the doc leg was consulted. The backtick
was a formatting choice, not a supply of information.

## The undefined-term flag and its 1% gate

The flag as first ported fired on 8.0% of real doc comments: 1,411 blocks, 1,505 flags, 693 distinct
terms, with an empty `resolved`. Given a deliberately generous `resolved` (every identifier in the
block's own file, far more than the anchor tiers ever resolve) it was still 5.4%. Python was 19.9%,
because imperative-mood docstrings are the dominant convention there and the flag keys on
instruction shape. The most-flagged terms were `error` 41, `name` 34, `response` 27, `value` 26,
`detail` 20, `type` 19. That is ordinary technical English, not undefined terms.

The contract called the rule "deliberately narrow, because a flag that fires on ordinary English is
a flag a developer learns to ignore". At 8% it was not narrow, and the whole evidence base was ONE
anecdote.

The narrowing keys on the shape that anecdote had (a determiner, a possessive, an adjective, then
the head): require a possessive governing the head, or an `of the X` / `of a X` construction, or an
adjective-modified head with a possessive somewhere in the phrase, and exclude any `-ly` head
outright.

**The gate: re-measure on the same corpus, under 1% or the flag does not ship.** It measures 0.7%
against 17,774 real doc-comment blocks in five languages (this repo's `src/**`, the private Rust and
C# corpora, Go's `net`, CPython). `objectHead` carries the rule; do not loosen it without re-running
that corpus. The stated alternative was legitimate: ship the restatement half alone and write down
that one anecdote is not enough to ship a flag on.

The port itself was clean: 20,681 inputs against the scout's detector, zero disagreements on `units`,
`worst` or fires. The restatement stop list in `tightenFlags.ts` is COPIED from that detector rather
than re-derived, because the scout validated the instrument against three known cases before
believing its corpus numbers and a stop list rewritten here would throw that validation away while
looking identical in review.

### Deferred: the tokeniser cannot see CJK or accented Latin

`[a-z0-9_]+`, so a Japanese doc comment contributes zero tokens and `présentation` fragments into
`pr` and `sentation`. A Japanese paragraph pasted twice reports `worst: 0`. The honesty half is
fixed: the report says how much of the prose it could not see, so a caller can say "not measured"
instead of "clean". The real fix needs a Unicode-aware tokeniser and a segmentation strategy for
languages with no spaces, and it would change every containment figure the scout validated.
Evidence: `D6`, `D6b` in `test/adversarial-v52-p4.test.cjs`.

## `importLineFor`, graded

The tier that turns a ratified symbol into an import line, graded per language against a real
checker rather than against itself:

| language | corpus | oracle | emitted | precision | recall | before |
|---|---|---|---|---|---|---|
| Rust | glommio, same crate | `cargo check` | 109 | 100.0% (109/109) | 99.1% (109/110) | 44.2% |
| Go | 6 repos, 3,461 decls | `go list` | 1,518 | 99.9% (1,517/1,518) | 100% (1,517/1,517) | 50.7% |
| Python | 3 repos, 270 decls | CPython `find_spec` | 270 | 100.0% (209/209 gradeable) | 100% | 36.4% |
| C# | the private corpus, 541 decls | brace-aware scan | 519 | 100.0% (519/519) | 100% (519/519) | 0% live |
| TypeScript | this repo, 2 targets | `tsc --noEmit` | 588 | 100.0% (588/588) | 100% | 100% |

The gates that moved those numbers, in the order they mattered: C#'s `containerName` is never
parsed and the def file's own `namespace` always answers (0% to 100% on the live-Roslyn shape); the
BOM is stripped once in the deps wrapper (21 of 271 declarations recovered); Rust's module chain
must be `pub` and the re-export is searched before refusing (136 E0603 rows gone); the Rust extern
name is the target's DEPENDENCY KEY and a non-dependency refuses (E0433 gone); Go refuses an
unexported name (1,427 rows, the largest family), a `_test.go` file or `_test` package,
`package main`, and enforces the `internal/` boundary (132 rows); Go same-scope compares the package
CLAUSE, not the directory; Python's dotted path is rooted at a real sys.path entry (36.4% to 100%);
and `kindScheme: "vscode" | "lsp"` rides on every hit, so a raw-LSP class is no longer refused and a
raw-LSP enum no longer accepted by coincidence.
