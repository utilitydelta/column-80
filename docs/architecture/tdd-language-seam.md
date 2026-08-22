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
