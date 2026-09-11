# The TDD language seam

The contract for `src/core/tddLang.ts` and its five language legs (`tddRust`, `tddGo.ts`,
`tddTs.ts`, `tddPy.ts`, `tddCs.ts`). The gesture authors a unit test BLIND of the implementation,
using only the signature and the resolved surface, with every expected value a tabstop hole. See
[fn-generation.md](fn-generation.md) for where the gesture sits in the fn-gen path.

This file is the committed contract. It was written from the per-language contracts that lived in
the session folders, which a clone does not have. Where a language's contract file no longer
exists, that is said here rather than papered over.

## The seam

`src/core/tddLang.ts` never imports `vscode`. The pattern is copied from `oracleFor(languageId)`: a
strategy registry, `undefined` for an unregistered language so a refusal NAMES the language, and
optional methods whose absence means honest-dark rather than a guess.

**`TestPlacement`** carries `targetPath`, `exists`, `mode` (`same-file` | `sibling-file` |
`project-file`), `runRoot` (the directory the COMMAND runs from, which is not always the source's
project), `packageArg?`, `importLine?`, `packageName?`, `frameworkImportLine?`, `frameworkId?`.

`ScaffoldInput` carries only the TARGET file's text, so anything about the PROJECT or the SOURCE
must be resolved during placement and ride on `TestPlacement`. Two language phases hit that
independently. `packageName` in particular is read from the SOURCE file and never guessed from the
directory: package and directory differ once in gin and 31 times in hugo, and a hyphenated directory
yields an illegal `package go-scratch`.

**`PlacementRefusalReason`** is `no-project-root` | `no-test-project` | `unresolvable-import` |
`ambiguous-test-project` | `unsupported-runner`. `detail` is human-facing and MUST NAME WHAT IS
MISSING.

**`TestRunParse`** supersets Rust's `LibtestParse`: `ran`, `cases`, `failures`, `passed`, `failed`,
`ignored`, plus `filterMatchedNothing?`, `casesComplete` (false only for C#, which never enumerates
passing tests), `environmentError?` and `buildError?`.

**The three no-run outcomes are different, and telling them apart is the whole point.** Did not
compile is `buildError`; the environment could not start is `environmentError`; the filter selected
nothing is `filterMatchedNothing`. An earlier `runTddTests` reported all three as "the tests did not
compile", so two of three sentences were lies. The trap, hit independently in Go, TypeScript and
Python: an environment failure and a filter miss are structurally identical on the wire, and only a
terminal action or a positive attribute separates them. Write that discriminator down per language
before writing the parser.

**`TestFramework`** is keyed PER FRAMEWORK, not per language, because assertion argument order
differs within a language: `id` (`libtest|gotest|vitest|jest|pytest|unittest|mstest|xunit|nunit`),
`displayName`, `detect(root, deps)` (pure over injected deps), `buildCommand`, `parseOutput`,
`assertionInstruction`, `expectedValueSpans(text)`.

`TestRunCommand.outputFile?` exists because pytest's `--junit-xml` and C#'s `--logger trx` write to
a file. `stderr` is ALWAYS the real stderr; `stdout` falls back to the real stdout when the file was
NOT written, which is what a C# compile failure or a missing runtime produces. The path MUST be in
the system temp area, never inside the human's repo.

`expectedValueSpans` is safety-critical. Wrong argument order blanks the call under test and keeps
the model's guess, which INVERTS the blank-value invariant. Spans must be ascending and
non-overlapping or `blankTestModule`'s slice loop corrupts the snippet.

`TestabilityReason` grows by `not-exported`, fired only where the test reaches the unit through an
IMPORT: TypeScript (not `export`ed) and C# (`private`/`internal` without `InternalsVisibleTo`). Rust
never needs it (`use super::*`), Go never needs it (same-package sibling), and Python must NEVER
fire it, because an underscore is convention rather than privacy.

**The blank-value rule.** A SCALAR gets a BARE hole; everything else gets a hole carrying a
type-hint comment; a container's contents are hinted with the ELEMENT type. The Rust precedent:
`renderBlankValue("u32")` gives `${1}`, `("Option<u32>")` gives `${1:/* Option<u32> */}`,
`("Vec<String>")` gives `vec![${1:/* String */}]`.

## The check reaches the tests (supersessions S33 and S34, session-v69)

The gesture writes test code. Until session-v69 the oracle validated it with a command that could not
SEE test code, in four of five languages, so the whole feature had been shipping unverified output
and the repair loop that exists to catch exactly that reported a clean build. Where the tests land is
the seam's business, so where the CHECK must look is too.

| language | where the tests land | what makes the check reach them |
| --- | --- | --- |
| Rust | the same file, `#[cfg(test)] mod tests` | `cargo check --all-targets --keep-going` |
| Go | `foo_test.go`, same dir and package | `go test -c -o os.devNull ./...`, module-wide |
| TypeScript | `foo.test.ts` beside the source | `tsc -p` already compiled it, WHEN the project includes it |
| Python | `tests/test_<stem>.py`, else beside the source | pyright is handed the companion file too |
| C# | a SEPARATE test project | the build target moves to the test project that references the source |

Two derivations MOVED into the oracles to make that work: `pythonTestDir` (from `tddPy`) and the C#
project topology, `csTestProjectsFor` and friends (from `tddCs`). The leg writes a test into one of
those places and the check has to look there, so they read the same function. Two topologies that can
disagree about where tests live is the defect, not the duplication.

**TypeScript is the leg with a condition rather than a command.** Whether a `.test.ts` is compiled is
a fact about the project's `include`, not about the language, so the gesture VERIFIES rather than
assumes: `fileIsCheckable` probes the written path after the write and warns when the project does not
compile it. Three answers, not two — an unanswerable probe says nothing, because telling a human their
tests are unchecked when they are not is the expensive direction.

**A generated test may not be named after its target** (S34). One test per function invites naming
the test after the function, and in Rust that is a compile error the product writes into the human's
file. `guardShadowedTestNames` renames it before anything lands, for Rust and Python; the other three
are structurally safe.

## The table (supersession S31, session-v68)

The prompt used to ask for one INLINE assertion per case and to forbid a table of rows. It now asks
for ONE parameterised table per language, and **the expected value is the LAST COLUMN of every row**
in all five. That sentence is one exported constant, `LAST_COLUMN_CLAUSE`, because ONE locator rule
reads it and two wordings would drift.

The idiom comes off the FRAMEWORK, not the language, for the same reason `assertionInstruction` and
`replyShape` do: C# carries three row attributes inside one languageId and python/unittest has no
`parametrize`. `TestFramework.tableShape` and `rowsAreConstantsOnly` are those two facts.
`testGenFieldsFor(lang, framework, target?)` is the ONE mapping from a resolved framework to prompt
fields, and production and every oracle read it — a hand-copied field list at the call site went
stale the moment a fifth field was added, twice in one session.

`src/core/tddTable.ts` is the locator. Five finders, one scanner (the shared
`skipLiteralOrComment` / `matchDelim` with each language's `LiteralProfile`), and two rules that are
the whole of its safety:

- **A LIST OF TUPLES IS NOT A TABLE.** It is a table only when a runner WALKS it and binds a name per
  column. Without that gate, ordinary shared setup (`let pairs = [(1, 2), (3, 4)];` above a set of
  inline asserts) had every second element blanked as an expected value, so the human typed into the
  test's own INPUTS while the real expected values shipped as the model guessed them.
- **A ROW REFERENCE is not a hole.** On a table reply the shipped inline locators did not merely
  miss: eight of the nine found the runner's assertion and blanked the LOOP VARIABLE, leaving every
  guessed row literal in the buffer. Go's was the only leg that failed safe. A bare name is a
  reference when it is a declared column or one of `want`/`wants`/`expected`/`exp`; a DOTTED path is
  one when its root is a declared column or a row holder (`tt`, `tc`, `c`, `cs`, `row`, `case`), or
  its leaf is a conventional expected name. A bare `c` is NOT: it is a common local, and treating it
  as a row read turned a working pass into a refusal. A leading `*` or `&` is stripped, because a
  Rust `for` over an array by reference makes the runner read `*want`.

A row reference found with NO table parsed counts as UNRESOLVED, so the floor refuses the whole pass.
That is the honest outcome for a table the locator could not read; blanking the wrong place is not.

`TddLang.deadTableColumns` is the third floor, beside the zero-hole and unresolved ones: a table that
BINDS a column its runner never READS cannot exercise it. A read is a word occurrence in the runner's
BODY outside literals and comments, and that exclusion is the rung rather than a detail — naming the
column in a `t.Errorf` format string passes nothing. The body is deliberately NOT the region the
locator uses: the header that binds the names must sit outside it, or binding a column would count as
using it. A half-written reply gets no verdict at all, because this rung refuses and a false refusal
costs a working pass while a missed dead column leaves the human where they were.

## The async rung (supersession S32, session-v68)

Every `async` function in all five languages used to be refused with one sentence, and that sentence
was written when the seam was Rust-only. Rust is the one language with no stdlib answer, so it was
true there and false in four places.

C#, TypeScript and python/unittest admit async unconditionally — all three await natively, and there
is nothing to detect. `async void` stays refused BY NAME. Go SPLITS its rung: `context.Context` is
satisfiable with `context.Background()`, a channel is not, and the detail names the channel.
python/pytest ASKS the interpreter for `pytest-asyncio` then `anyio` through `TddDeps.probe`, because
pytest COLLECTS an `async def` test without a plugin and reports it SKIPPED — a green board with
nothing run. Rust reads `Cargo.toml` for tokio (with `macros` or `full`), async-std with
`attributes`, then smol-potat; a tokio dependency WITHOUT `macros` gets its own sentence, because
`#[tokio::test]` does not exist in that project.

`TestabilityContext` carries all of it, resolved by `testabilityContextFor` and never read inside
`classifyTestability`: a rung that read the filesystem itself could not be tested without one.
`TddLang.isAsyncSignature` is separate from the verdict, because an admitted async target and a
synchronous one both come back `{testable: true}` and only the prompt needs to tell them apart.

**The rule that shaped every decision here: lifting a rung without the machinery behind it just swaps
an honest refusal for a red test.** A refusal is a true sentence the human can act on; a generated
test that does not compile is worse than both. Every refusal in this phase names what is missing.

**Measured, 12,059 functions from a real Rust corpus, four arms on one population.** Base 6.6%;
shipped with no runtime detected 6.6% (exact, all four categories — nothing moves for a project
without one); shipped with tokio detected 11.5%; both rungs lifted 15.9%. The last is a CEILING, not
a shipped number: it assumes every receiver is constructible.

## The receiver leg (session-v68)

`TestabilityContext.receiverConstructible` skips the fixture rung and nothing else, in all five
languages. TypeScript also skips `not-exported` under it, and the argument is specific: the method
form is BOTH tells, a class member is reached through its class rather than an import, and `export`
is not something you can write on one.

**The gate asks the classifier TWICE and the order is the entire design.** Resolving the enclosing
type's surface costs a real pre-fill, so paying it before the honest-failure gate would charge every
refusal for it — including the 68.4% of real functions with no doc comment. A `needs-fixture` verdict
is re-asked with the flag set; a refusal underneath means the receiver is not the only blocker and
nothing is resolved. Only a clean `testable` is worth paying for, and the surface that answers the
question is the surface the prompt then gets.

`surfaceProducesType` is deliberately stricter than `producesType`, which answers true for a member
with no readable return clause at all. That permissiveness is right when a false negative drops one
prompt candidate and wrong here, where a false positive admits a target whose test cannot compile.

**Red-before-green rules that bind every leg.** An empty `testNames` array must NEVER produce a
match-nothing filter (`^()$`, `()$`, or the whole suite): refuse upstream. The green rule is
`passed + failed > 0`, load-bearing in all five languages. `markerPrefix` is the single source
shared by `scaffold` and `generatedTestNames`. Rust is a thin ADAPTER and is byte-frozen, pinned by
`blind-v8-testrung`, `-assembly`, `-tabstop`, `-testability`, `-testgen`. A shared depth scanner
plus a per-language `LiteralProfile` does all locating; do not write a second regex.

## Go

Measured on `go1.26.5` against cobra and gin.

`sibling-file`, `<dir>/foo_test.go`. `runRoot` is the module root via `GoOracle.detectCrateRoot`,
`packageArg` is the source directory relative to `runRoot` as a Go relative package path (`.`,
`./internal/foo`, always forward slashes), `importLine` undefined. 56 of 57 `*_test.go` files
declare the same package as the code beside them and 44 of 57 pair with a same-named source file;
the one `package foo_test` is the exception. A `go.work` makes `detectCrateRoot` return undefined,
so placement refuses `no-project-root` naming `go.work`.

Framework `gotest`, always detected (stdlib `testing`). Command:
`go test -run '^(TestA|TestB)$' -json <packageArg>` from `runRoot`, with `GoOracle`'s spawn env.

`-json` REPLACES `-v`, and that is a correctness fix rather than a preference. The text format is
forgeable by the code under test: an indented `--- PASS: TestPhantom` inside a `t.Errorf` reads as a
verdict, and a false RED is reachable with nothing but the shipped generated shape. In the JSON
stream a verdict is an `Action` of pass/fail/skip CARRYING a `Test` field, and forgeries can only
land inside an `output` event's `Output`.

The filter is anchored `^(...)$`, verified: unanchored, `TestAggregateFanoutHappy` also matches
`TestAggregateFanoutHappyPath`. A filter miss is a package-level terminal action with zero
`Test`-tagged events AND a terminal `Action: "pass"` at exit 0. `[setup failed]` at exit 1 with
`FailedBuild` is `environmentError`; `[build failed]` is `buildError`. The bracketed token is the
ONLY discriminator. Build errors arrive on STDOUT as `build-output` events with stderr EMPTY.

Testability precedence `async` then `io` then `needs-fixture` then `underspecified`. `http` is in
the io set because 10 of Go's 104 survivors carry `http.ResponseWriter` or `*http.Request`.
`needs-fixture` (a method receiver) is Go's largest refusal at 60.6%. Three-plus return values cost
exactly one function. Expected survival is about 12.2%, the best of the five languages.

Assertion shape: `got := f(x); want := <hole>; if got != want { t.Errorf(...) }`, and
`expectedValueSpans` is the RHS of each `want :=` only. The literal profile must carry raw backtick
strings, in which backslashes are not escapes. `testNameIsValid` is `/^Test[A-Z_]/`, because a badly
named test is silently never run, which is a false green wearing a different hat. `markerPrefix` is
`"//"`.

## TypeScript

Measured on a real MobX/React corpus with vitest 4.1.7.

`sibling-file`, `foo.test.ts`; all ten test files in the reference corpus sit beside their subject.
`runRoot` is the nearest ancestor with a `package.json`. `importLine` is required, which makes this
the first leg reaching the unit through an IMPORT, and therefore the leg that needs `not-exported`.

Extensionless is right for `bundler`, `node`, `node10` and `classic`, and WRONG for `node16` and
`nodenext`. Read `moduleResolution` (then `module`) honouring `extends`; when undetermined prefer
extensionless and SAY so on the channel. The rule fails on its own reference corpus and that is
worth keeping: the corpus `tsconfig.json` is a solution shell (`files: []` plus `references`), which
`extends` does not follow, so extensionless is right there by luck.

Frameworks are vitest then jest, but precedence alone is wrong when both are declared: prefer the
one whose local binary resolves, tie-break on the `test` script. Command:
`<runRoot>/node_modules/.bin/vitest run <targetPath> -t "(a|b)$" --reporter=json`.

The filter is END-ANCHORED ONLY. `^(a|b)$` matches NOTHING, because `-t` matches the describe-joined
full name. That is the opposite answer to Go's, measured, in the same seam. Use the local bin
because `npx` prints npm warnings ahead of the JSON. Parse `--reporter=json` by taking the LAST line
that parses.

Four no-run outcomes with two colliding pairs. A filter miss is
`numPassed + numFailed === 0 && numPending > 0 && success === true` at exit 0, with no text tell:
"skipped" plus exit 0 looks like a pass. An unresolvable import and a SYNTAX error share zero
counts, empty `assertionResults`, a message on `testResults[0]`, exit 1 and empty stderr.
`buildError` fires only on POSITIVE per-framework markers (vitest `Transform failed`,
`[PARSE_ERROR]`; jest `Jest encountered an unexpected token`, `Jest failed to parse`), never one
shared regex. `environmentError` fires only on `Cannot find module|package` and `Failed to load
url`. `\bSyntaxError\b` was DELETED as a marker: a file importing `./SyntaxError` matched on the
MODULE PATH. Anything else stays UNCLASSIFIED. Strip ANSI first, and infer nothing from an empty
stderr (vitest writes 0 bytes, jest 751 and 17943 in the measured runs).

Types are unchecked on this path, so a type error runs and surfaces as a red that looks like a wrong
expected value.

Testability precedence `async`, `io`, `needs-fixture`, `not-exported`, `underspecified`. Over 157
functions: needs-fixture 78, underspecified 38, not-exported 23, async 18, io 0 (a FALSE zero). 0 of
157 survive, and forcing every return annotation present still yields 0. The cause is the
doc-comment leg against a codebase documenting 7.0% of its functions; `not-exported` costs 3.

The locator is the SOLE ARGUMENT OF THE MATCHER TERMINATING THE `expect` CHAIN: `toBe`, `toEqual`,
`toStrictEqual`, `toBeCloseTo`, `toContain`, `toHaveLength`. Never a zero-arg matcher, never `not`.
Three fail-open gaps were measured and closed: `expect.soft`, explicit matcher type arguments, and a
regex literal holding an apostrophe (which opened a string running to the end of the module, leaving
every LATER assertion carrying the model's guess). `generatedTestNames` reads the `it`/`test` TITLE
via the literal-aware scanner rather than a regex, because `submit('save')` and
`expect(...).toBe("it('phantom')")` both produced phantom names.

Import rules: never merge a value name into `import type { ... }`, because `verbatimModuleSyntax`
turns it into `error TS1484` and vitest does not typecheck, so the rung stays green while the
human's typecheck breaks. Compute missing names against the UNION of every declaration for the
module.

## Python

Measured on a real MCP server corpus with pytest 9.0.2, src-layout.

`project-file`, and the only leg with a configurable target directory:
`[tool.pytest.ini_options] testpaths`, then a `tests/` directory, then beside the module. File
`test_<module>.py`. `runRoot` is the nearest ancestor with `pyproject.toml`, `setup.py`,
`setup.cfg` or `tox.ini`.

The import must be PROVEN before a file is written: derive it honouring
`[tool.setuptools.packages.find] where`, then run the resolved interpreter with
`-c "import <module>"` offline. A definite failure refuses `unresolvable-import` naming the module
AND the interpreter. Interpreter resolution is `PyOracle`'s.

Frameworks are pytest (`-c "import pytest"`) then unittest, so "no framework" is unreachable. Two
entries exist because `assert x == y` and `self.assertEqual(x, y)` need different locators.

Command: `<interpreter> -B -m pytest <nodeid>... -q -p no:cacheprovider --junit-xml=<tmpfile>`.
Every flag is load-bearing. Node ids, never `-k`: a bad node id is `ERROR: not found` at exit 4
while a `-k` miss is `3 deselected` at exit 5. `-p no:cacheprovider` keeps `.pytest_cache` out, and
`-B` is ALSO required because cacheprovider alone still writes `__pycache__`. The XML goes to system
temp.

Parse the XML, never the text. pytest resists forged lines in an assertion message (the `E ` prefix)
but NOT `print()`, whose output lands at COLUMN 0 in the captured-stdout section and can forge both
a `FAILED` line and the count line. Counts come from the `<testsuite>` attributes `tests`,
`failures`, `errors`, `skipped`. An `<error>` is a collection or setup error, not a test failure.
`casesComplete` is true.

A filter miss and a collection error share exit 4, and the `errors` attribute is the only separator.
That is the third language in which the same collision appeared. `buildError` is never set: Python
has no build step, so a syntax error arrives as a COLLECTION error and is `environmentError`.

Testability precedence `async`, `io`, `needs-fixture`, `underspecified`. `needs-fixture` (a `self`
or `cls` first parameter) is the largest refusal at 71.9%. io measures 0, a FALSE zero: a
port-availability helper opens a socket in its body. 7 of 89 survive, 7.9%, level with Rust's 7.7%
control and with the best survivor QUALITY of the five (six of the seven are string-to-structure
parsers). Doc coverage is 94.4% and only 4 of 89 lack an annotation, which refutes the prediction
that missing annotations would dominate.

`returnTypeOf` needed its own implementation: the Rust `->` regex swallows the trailing colon, so
`def f() -> str:` yields `"str:"`, and `-> None` returns undefined. `markerPrefix` is `"#"`, the
only leg that is not `"//"`.

Locators: pytest blanks the RHS of the TOP-LEVEL `==` inside `assert`, never the message after a
comma and never an inner `==`; unittest blanks the SECOND argument of `assertEqual`.
`assert x != y`, `assert x` and `assert x is None` produce NO span, which is the fail-open shape the
floor work covers.

## C#

**There is no surviving contract file for C#.** It existed only inside a gitignored session folder
and is in no git history. `src/core/tddCs.ts`'s own header comments are the primary source, and
this section records what is established elsewhere in committed docs rather than inventing a
contract around the gap.

What is on the record:

- 0 of 251 methods survive on the Contoso corpus. Only 4 would survive if every method were public
  and static. `not-exported` is 108 of 251, and `InternalsVisibleTo` appears nowhere in it.
- Assertion argument order INVERTS: `Assert.AreEqual(expected, actual)`. Three frameworks, three
  locators, with NUnit hiding the value inside `Is.EqualTo(...)`.
- `runRoot` is the TEST project's directory. It is found, never created; `<Source>.Tests` is
  preferred; ambiguity refuses by naming the candidates.
- `<EnableMSTestRunner>` refuses as `unsupported-runner`, because `dotnet test --filter` hard-fails
  under Microsoft.Testing.Platform on SDK 10.
- Command: `dotnet test <project> --no-restore --filter FullyQualifiedName=...
  --logger trx;LogFileName=... --results-directory <os.tmpdir()>`. The TRX carries a UTF-8 BOM.
  MSBuild compile errors go to STDOUT with STDERR empty. A missing runtime and a compile failure
  both exit 1 with no report, so the exit code cannot separate them. `casesComplete` is false,
  because C# never enumerates passing tests.
- `generatedTestNames` returns FILTERS carrying namespace and class
  (`Falsifier.Widgets.WidgetChecks.Add`, `Ns.Outer+Inner.Add`), and `buildCsCommand` uses
  `FullyQualifiedName=` rather than `~`. Measured: `~Add` passes two tests, and `=Add` against a
  bare name matches none on dotnet 10.0.111. Generic methods and generic enclosing types keep `~`
  deliberately. Recorded as S26 in [../supersessions.md](../supersessions.md).
- xUnit and NUnit are built but never driven; the all-or-nothing floor over-refuses
  `Assert.IsTrue(Widen(3) > 0)` and NUnit's `Is.Not.Null`; the C# rung is proven only under
  `DOTNET_ROLL_FORWARD=Major`, which the product deliberately never sets. See
  [../session-v31-open-items.md](../session-v31-open-items.md).
