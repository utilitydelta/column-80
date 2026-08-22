/**
 * The TDD language seam. Where the tests go, which framework runs them, how that
 * framework's output reads, and where the human's expected values sit inside the
 * generated text — one strategy per language, resolved by languageId.
 *
 * The pattern is oracleFor's, copied deliberately because it has survived five
 * languages: a strategy registry, `undefined` for an unregistered language so the
 * gesture refuses by NAMING it, and optional methods whose absence means
 * honest-dark rather than a guess.
 *
 * Phase 1 registers Rust ONLY, and Rust's entry is a thin ADAPTER over the
 * shipped functions in testability.ts, testAssembly.ts, tabstop.ts and
 * compilerOracle.ts. Nothing here reimplements them; Rust's behaviour is
 * byte-frozen and blind-v8-* is the pin.
 *
 * Never imports vscode (the src/core rule).
 *
 * Contract: docs/architecture/tdd-language-seam.md.
 */

import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import {
  RustOracle,
  TestCaseResult,
  TestFailureDetail,
  buildTestCommand,
  parseLibtestOutput,
} from "./compilerOracle";
import {
  RustTestNameContext,
  TestInsertionPlan,
  escapeSnippetLiteral,
  generatedTestNames,
  planTestInsertion,
  rustExpectedValueSpans,
  rustUnresolvedAssertions,
  skipLiteralOrComment,
} from "./testAssembly";
import { TestabilityVerdict, classifyTestability } from "./testability";
import { BlankValueResult, StructFieldShape, renderBlankValue } from "./tabstop";
import { CS_TDD_LANG } from "./tddCs";
import { GO_TDD_LANG } from "./tddGo";
import { PY_TDD_LANG } from "./tddPy";
import { TS_TDD_LANGS } from "./tddTs";

// ===========================================================================
// Placement
// ===========================================================================

export type TestPlacementMode = "same-file" | "sibling-file" | "project-file";

export interface TestPlacement {
  /** Absolute path the generated tests go in. */
  targetPath: string;
  /** True when targetPath already exists on disk. */
  exists: boolean;
  mode: TestPlacementMode;
  /** The directory the test COMMAND runs from. Not always the source file's
   *  project: C# runs from the test project, which is a peer of the source
   *  project; Go runs from the module root. Structurally a
   *  compilerOracle.TestRunTarget, which is what runTestOracleAt takes. */
  runRoot: string;
  /** The package/dir argument the toolchain needs, relative to runRoot
   *  (Go's `./internal/foo`). undefined when the toolchain needs none. */
  packageArg?: string;
  /** The import line the scaffold puts at the top of the test file so it can
   *  reach the unit under test. undefined for same-file and same-package
   *  placement (Rust, Go). */
  importLine?: string;
  /** The namespace/package the generated file must DECLARE, read from the
   *  source file rather than guessed from the directory (Go's `package foo`
   *  and the directory name differ often enough to matter). Resolved during
   *  placement, which is the only step that holds the source path and the
   *  deps to read it — ScaffoldInput carries the TARGET file's text and has no
   *  channel to the source. undefined where the language's scaffold declares
   *  nothing (Rust, whose tests sit in the file already). */
  packageName?: string;
  /** The FRAMEWORK's import line, when the language's scaffold needs one that
   *  the framework — not the language — decides: vitest spells
   *  `from 'vitest'` and jest spells `from '@jest/globals'`, and the scaffold
   *  cannot tell which without re-detecting.
   *
   *  Resolved during placement for the same reason packageName is: ScaffoldInput
   *  carries the TARGET file's text and no deps, so it has no channel to the
   *  project. Absent means the language's scaffold uses its own default, which
   *  keeps a hand-built placement producing the documented bytes. */
  frameworkImportLine?: string;
  /** ADDED in phase 5 (Amendment 8d). WHICH framework detected, so the scaffold
   *  can look up whatever else it needs from the registry rather than the
   *  placement carrying a growing list of per-artefact strings.
   *
   *  C# forced it. Beyond the using line it also needs the framework's
   *  ATTRIBUTES — `[TestClass]`/`[TestMethod]` for MSTest, `[Fact]` for xUnit,
   *  `[Test]`/`[TestFixture]` for NUnit — and a field per artefact does not
   *  scale. `frameworkImportLine` stays for the legs already using it. */
  frameworkId?: string;
  /** ADDED in phase 4. The INTERPRETER the test command must run, which is the
   *  project's own venv when one resolves beside the run root.
   *
   *  Resolved during placement for the reason the seam names: buildCommand takes
   *  a placement and no deps, so anything it must know about the project has to
   *  be carried here. It is also the interpreter the import was PROVEN against,
   *  and proving an import in one environment then running the test in another
   *  would make the proof worthless. Absent means the language's own fallback,
   *  which for Python is `python3`. */
  interpreter?: string;
}

export type PlacementRefusalReason =
  | "no-project-root"
  | "no-test-project"
  | "unresolvable-import"
  /** ADDED in phase 5 (Amendment 8b). More than one test project matched and
   *  the `<Source>.Tests` preference did not disambiguate. The detail NAMES the
   *  candidates rather than guessing between them. */
  | "ambiguous-test-project"
  /** ADDED in phase 5 (Amendment 8b). The test project opts into a runner this
   *  build does not support: `<EnableMSTestRunner>true</EnableMSTestRunner>`
   *  switches C# to Microsoft.Testing.Platform, where `dotnet test --filter`
   *  hard-fails. The detail NAMES the property. */
  | "unsupported-runner";

export interface PlacementRefusal {
  reason: PlacementRefusalReason;
  /** Human-facing, and it must NAME WHAT IS MISSING. */
  detail: string;
}

export type PlacementResult =
  | { ok: true; placement: TestPlacement }
  | { ok: false; refusal: PlacementRefusal };

// ===========================================================================
// The parse result
// ===========================================================================

/**
 * A test run as every language reports it. A strict superset of
 * compilerOracle.LibtestParse, so every shipped Rust consumer keeps compiling
 * and reads the same six values. LibtestParse stays: `CompilerOracle.parseTestOutput`
 * is shipped surface and does not change shape.
 */
export interface TestRunParse {
  ran: boolean;
  cases: TestCaseResult[];
  failures: TestFailureDetail[];
  passed: number;
  failed: number;
  ignored: number;
  /** The runner SAID the filter selected zero tests. Distinct from ran=false:
   *  the run happened and matched nothing. Measured to exist in Go, C# (both
   *  runner paths) and Python; absent in Rust and TypeScript, where only the
   *  executed>0 guard catches it. */
  filterMatchedNothing?: boolean;
  /** False when `cases` is KNOWN incomplete. C# never enumerates passing
   *  tests, so its parse sets this false and consumers must not render
   *  `cases` as the full run. True everywhere else. */
  casesComplete: boolean;
  /** The runner could not start at all: a missing runtime, an unresolvable
   *  import. NOT a compile error and NOT a test failure, and the message
   *  must not be reported as either. */
  environmentError?: string;
  /** The compile error, when the parse can see it and stderr cannot. `go test
   *  -json` puts it on STDOUT as `build-output` events and leaves stderr EMPTY,
   *  so a runner that reads stderr reports a build failure with no message.
   *  Absent means "stderr is the compile error", which is Rust's shape. */
  buildError?: string;
}

// ===========================================================================
// Injected deps
// ===========================================================================

/** Injection seams so placement and framework detection need no real project on
 *  disk. Same pattern, and the same real-fs defaults, as OracleDeps. */
export interface TddDeps {
  fileExists?: (p: string) => boolean;
  readFile?: (p: string) => string | undefined;
  readDir?: (p: string) => string[] | undefined;
  log?: (line: string) => void;
  /** ADDED in phase 4 (Amendment 6c). Run a short, OFFLINE probe and report its
   *  exit code; undefined when the command could not be spawned at all.
   *
   *  Python needs it twice: pytest detection asks the project's interpreter
   *  `-c "import pytest"`, and the generated import must be PROVEN to resolve
   *  before a test file is written, because a src-layout package that is not
   *  installed turns a guessed import into a collection error the human cannot
   *  act on.
   *
   *  It is a DEP rather than a direct spawn so that `detect` and `placementFor`
   *  stay pure over their injected deps. A test supplies a fake probe and never
   *  needs a real interpreter. Never used for anything that installs anything or
   *  reaches the network. */
  probe?: (command: string, args: string[], cwd: string) => { exitCode: number } | undefined;
}

/** The real-filesystem defaults. A missing or unreadable path answers absent
 *  rather than throwing: a project that cannot be read is honest-dark, never a
 *  crashed gesture. */
export const REAL_TDD_DEPS: Required<Omit<TddDeps, "log">> = {
  fileExists: (p) => fs.existsSync(p),
  readFile: (p) => {
    try {
      return fs.readFileSync(p, "utf8");
    } catch {
      return undefined;
    }
  },
  readDir: (p) => {
    try {
      return fs.readdirSync(p);
    } catch {
      return undefined;
    }
  },
  // Bounded, offline, and it captures nothing: the answer is the exit code. A
  // command that cannot be spawned at all (no such interpreter) answers
  // undefined, which a caller must read as UNPROVEN rather than as a failure.
  //
  // TWO SECONDS, and it is a real bound rather than a formality. This is
  // `execFileSync` ON THE EXTENSION HOST: every millisecond it waits is a
  // millisecond the editor does not respond. Python's proof imports the target
  // package, which runs that package's module-level code, and MEASURED, a
  // package whose `__init__.py` sleeps blocked one placement for 10073ms under
  // the old bound. A timeout kills the child and leaves no exit code, so it
  // arrives as the same undefined a failed spawn does: UNPROVEN, never a
  // refusal. Bounding the block is not removing it; the async probe channel is
  // phase 6's.
  probe: (command, args, cwd) => {
    try {
      execFileSync(command, args, { cwd, timeout: 2_000, stdio: "ignore", windowsHide: true });
      return { exitCode: 0 };
    } catch (err) {
      const status = (err as { status?: unknown }).status;
      return typeof status === "number" ? { exitCode: status } : undefined;
    }
  },
};

/** Where the marked region sits in the PROJECT, for a language whose test names
 *  are not fully spelled inside the file. */
export interface TestNameContext {
  placement: TestPlacement;
  deps?: TddDeps;
}

export function fileExistsOf(deps?: TddDeps): (p: string) => boolean {
  return deps?.fileExists ?? REAL_TDD_DEPS.fileExists;
}

export function readFileOf(deps?: TddDeps): (p: string) => string | undefined {
  return deps?.readFile ?? REAL_TDD_DEPS.readFile;
}

export function readDirOf(deps?: TddDeps): (p: string) => string[] | undefined {
  return deps?.readDir ?? REAL_TDD_DEPS.readDir;
}

export function probeOf(deps?: TddDeps): (command: string, args: string[], cwd: string) => { exitCode: number } | undefined {
  return deps?.probe ?? REAL_TDD_DEPS.probe;
}

// ===========================================================================
// The framework
// ===========================================================================

export interface TestRunCommand {
  command: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
  /** ADDED in phase 4 (Amendment 6c). The FILE this command writes its
   *  structured report to. When set, the runner reads that file after the spawn
   *  and passes its CONTENT as the `stdout` argument to `parseOutput`.
   *
   *  pytest's `--junit-xml` writes to a path and puts nothing parseable on
   *  stdout, and stdout is exactly where a printing test can forge a report — so
   *  the file is not plumbing, it is the reason the format is trustworthy. The
   *  framework declares where its output lands and the runner does the reading.
   *
   *  Always a SYSTEM TEMP path; this product does not write into the human's
   *  repo. Rust, Go, vitest and jest leave it unset and are unaffected.
   *
   *  AMENDMENT 8c, and it is the FAILURE paths that need it: `stderr` is ALWAYS
   *  the process's real stderr, and `stdout` FALLS BACK to the process's real
   *  stdout when the file was not written at all. MEASURED in C#: a compile
   *  failure writes no TRX and puts its MSBuild errors on STDOUT with stderr
   *  EMPTY, so without the fallback the leg receives nothing on either stream
   *  and reports a failure with no message — the exact hole phase 2 had to close
   *  for Go. */
  outputFile?: string;
}

export interface TestFramework {
  /** Stable id: "libtest" | "gotest" | "vitest" | "jest" | "pytest"
   *  | "unittest" | "mstest" | "xunit" | "nunit". */
  readonly id: string;
  /** Human name for the honest-dark message that lists what was looked for. */
  readonly displayName: string;
  /** Is this framework configured in the project at `root`? Pure over the
   *  injected deps, so a test needs no real project on disk. */
  detect(root: string, deps: TddDeps): boolean;
  /** Consulted ONLY when MORE THAN ONE framework detects in the same project,
   *  which node projects routinely do — a repo mid-migration declares jest and
   *  vitest at once. `installed` is whether THIS framework's runner actually
   *  resolves at `root`; `namedByTestScript` is whether the project's own test
   *  script names it. Absent means the framework cannot answer and declaration
   *  order decides, which is every single-framework language. */
  projectFit?(root: string, deps: TddDeps): { installed: boolean; namedByTestScript: boolean };
  buildCommand(placement: TestPlacement, testNames: string[]): TestRunCommand;
  parseOutput(stdout: string, stderr: string, exitCode: number): TestRunParse;
  /** The prompt fragment naming THIS framework's assertion idiom, so the model
   *  writes `Assert.AreEqual(expected, actual)` for MSTest and
   *  `expect(actual).toBe(expected)` for vitest. */
  readonly assertionInstruction: string;
  /** ADDED phase 6 loop 2. The prompt fragment naming what ONE fenced reply block
   *  must contain, for a framework whose reply shape is not its language's
   *  default.
   *
   *  It belongs on the framework for the same reason `assertionInstruction` does:
   *  the two clauses land in ONE prompt and must not contradict. python/unittest
   *  is the case. Its assertion idiom needs a `unittest.TestCase` class, while
   *  Python's default shape clause asks for bare top-level `def test_...():`
   *  functions. A model obeying the shape clause produced a reply the guard
   *  accepts, whose asserts the unittest locator cannot see and which
   *  `python -m unittest` does not collect at all.
   *
   *  Absent means this framework's shape IS its language's default, which is true
   *  of the other eight. */
  readonly replyShape?: string;
  /** The EXPECTED-VALUE spans in generated test text: exactly the byte ranges
   *  the human must type. Safety-critical. Getting the argument order wrong
   *  blanks the call under test and keeps the model's guess, which inverts the
   *  blank-value invariant. Spans MUST come back in ascending, non-overlapping
   *  order, or blankTestModule's slice loop emits a corrupt snippet. */
  expectedValueSpans(text: string): Array<{ start: number; end: number }>;
  /** ADDED phase 6. Does this framework's PARSE name a compile error itself, by
   *  filling `TestRunParse.buildError` from its own markers?
   *
   *  It decides the FOURTH no-run sentence. When this is true and the parse
   *  named nothing, the run is UNCLASSIFIED — a module that threw at load, a
   *  marked region declaring no test — and the honest report is "the runner
   *  produced no result, and here is what it said on both streams". Reporting
   *  that as a compile error sends the human hunting one that does not exist.
   *
   *  Absent means stderr IS the compile error, which is cargo's shape: Rust's
   *  parse fills nothing and Rust keeps its shipped sentence. */
  readonly classifiesBuildError?: boolean;
  /** ADDED phase 6 (scraps D5). How many assertion sites this framework's
   *  locator WALKED and could NOT resolve to an expected-value span.
   *
   *  The signal exists because the locator FAILS OPEN: when it silently finds no
   *  span for ONE assertion the others still produce holes, so a `holes === 0`
   *  floor passes and the model's guessed value ships into the buffer. The
   *  locator does not have to be WRONG to lie; it only has to be SILENT.
   *
   *  A site with no expected value to TYPE is not a miss and must not be counted
   *  (`toBeTruthy()`, `Assert.IsNull`, a bare `assert x`) — this counts sites
   *  that carry a value the human would have had to type and that the locator
   *  could not place. The consumer refuses the WHOLE pass when the count is
   *  non-zero, which is the all-or-nothing floor: teaching each locator more
   *  shapes is the treadmill this design defers away from.
   *
   *  Absent means the framework cannot say, which leaves the consumer's floor
   *  exactly the zero-hole one it already had. */
  unresolvedAssertions?(text: string): number;
}

// ===========================================================================
// The language
// ===========================================================================

export interface ScaffoldInput {
  /** The target file's current text. "" when the file does not exist yet. */
  existingText: string;
  /** The model's generated test functions, already extracted from the reply. */
  generatedTests: string;
  /** Distinguishes THIS function's generated region from every other. */
  markerId: string;
  placement: TestPlacement;
}

export interface TddLang {
  readonly languageId: string;
  /** Named in every refusal, e.g. "Go", "TypeScript", "C#". */
  readonly displayName: string;

  placementFor(filePath: string, symbolName: string, deps: TddDeps): PlacementResult;

  /** ADDED phase 6. WHERE the tests go when `placementFor` could not resolve a
   *  PROJECT — for a language whose tests live in the FILE UNDER THE CURSOR, and
   *  only for such a language.
   *
   *  Rust is the case and the reason. `#[cfg(test)] mod tests` sits at the bottom
   *  of the module under test, so a `.rs` file outside any crate still has
   *  somewhere for its tests to GO; the missing `Cargo.toml` is a missing RUN
   *  root, and `runTddTests` is where that gets refused, by name. Refusing to
   *  AUTHOR over it would be a new Rust behaviour, and Rust is frozen.
   *
   *  A language that declares this also declares that its single framework needs
   *  no detection: there is nothing to install and so nothing to be honest-dark
   *  about. libtest ships with the toolchain, which is what makes that true.
   *
   *  Absent means a placement refusal stops the gesture, which is the honest
   *  answer for the four languages whose tests need a sibling file or a test
   *  project that must already exist. */
  placementWithoutProject?(filePath: string): TestPlacement;

  /** WHERE the tests go inside the target file, never clobbering the
   *  developer's own tests. For a file that does not exist yet the plan spans
   *  an empty document and `text` is the whole file. */
  scaffold(input: ScaffoldInput): TestInsertionPlan;

  /** "//" for four languages, "#" for Python. One source of the marker format
   *  so scaffold and generatedTestNames cannot drift. */
  readonly markerPrefix: string;

  /** Names of the tests previously generated for markerId, for scoping the
   *  rung to exactly this function's tests.
   *
   *  `ctx` carries the PROJECT facts a file's text cannot show. Rust is the
   *  case: a `.rs` file's own module segment comes from where the file sits
   *  under the crate root, and every libtest path inside the file starts with
   *  it. Additive, so C#, Go, TypeScript and Python ignore it — each of those
   *  reads its whole qualified name out of the file.
   *
   *  Absent means the language cannot prove a name is COMPLETE and must return
   *  bare names, which keeps the rung on a substring filter. Over-selecting adds
   *  a red the human can read; an exact filter over a truncated name selects
   *  nothing and reads as a passing rung. */
  generatedTestNames(fileText: string, markerId: string, ctx?: TestNameContext): string[];

  /** Go requires `Test` plus an uppercase letter or the runner ignores the
   *  function. undefined = no constraint. */
  testNameIsValid?(name: string): boolean;

  /** This language's honest-failure classifier.
   *
   *  ADDED in phase 5 (Amendment 8a): the optional third parameter carries the
   *  one PROJECT fact a signature cannot show. C# needs `internalsVisible` to
   *  decide whether an `internal` method is reachable from the test project, and
   *  a signature never says. Additive, so Rust, Go, TypeScript and Python ignore
   *  it; absent means NOT visible, which is the correct default and the measured
   *  truth of the C# corpus.
   *
   *  Moving the decision into placement was the rejected alternative:
   *  `not-exported` is a testability VERDICT the human reads as a reason, and
   *  splitting it across two steps puts half the classifier where nobody looks. */
  classifyTestability(signature: string, docComment?: string, ctx?: { internalsVisible?: boolean }): TestabilityVerdict;

  /** ADDED phase 6. Resolve the ctx above from a placement the caller already
   *  holds, so the consumer never has to know WHICH language has a project fact.
   *  Absent means the language has none and the ctx stays empty, which is Rust,
   *  Go, TypeScript and Python. */
  testabilityContextFor?(filePath: string, placement: TestPlacement, deps: TddDeps): { internalsVisible?: boolean };

  /** THIS language's return-type extraction. The shipped fnGen one is
   *  `->`-only and is wrong for four of five. */
  returnTypeOf(signature: string): string | undefined;

  /** This language's blank-value scaffold for a return type. Scaffold what the
   *  TYPE determines; keep as ONE hole what the CONTRACT determines.
   *
   *  ADDED phase 6 (scraps D3): `structFields` rides through, because phase 6 is
   *  the phase that routes the BLANKER through this seam. Until now the shipped
   *  `blankTestModule` called `renderBlankValue` directly, so a seam that dropped
   *  the field shapes cost nothing; a seam-routed blanker that dropped them would
   *  silently lose Rust's struct scaffold, which is a supersession wearing a
   *  refactor's clothes. The four non-Rust legs ignore the field, exactly as they
   *  ignore `classifyTestability`'s `internalsVisible`. */
  renderBlankValue(
    returnType: string,
    opts?: { startHole?: number; structFields?: StructFieldShape[] },
  ): BlankValueResult;

  /** Frameworks in PRECEDENCE order. The first whose detect fires wins. */
  readonly frameworks: TestFramework[];

  /** The honest-dark sentence for "no framework is configured here", when this
   *  language can say something `lookedFor` cannot. Added in phase 5 to carry
   *  Amendment 8b's `detail` without inventing one for the four legs that were
   *  already shipping: absent leaves the failure shape EXACTLY as it was, which
   *  is what keeps Go, TypeScript and Python byte-frozen. */
  frameworkRefusalDetail?(root: string, deps: TddDeps): string | undefined;
}

// ===========================================================================
// returnTypeOf, moved out of src/vscode/fnGen.ts
// ===========================================================================

/**
 * The return type text of a Rust fn signature (`-> T`, up to a where-clause or
 * the body brace); undefined for a UNIT or absent return. Feeds blankTestModule.
 *
 * Moved here from fnGen.ts, regex included, so the seam can own a per-language
 * version. Every other language gets its OWN implementation in its own phase;
 * this one is never pointed at a Go, C#, Python or TypeScript signature.
 *
 * SUPERSESSION, v31, human-ratified. The explicit unit return `-> ()` used to
 * yield the string "()", which passed fnGen's "returns no value to assert" gate
 * and got the human a tabstop hole for a unit value. The doc comment here and
 * in fnGen.ts had always claimed undefined, so the code and its documentation
 * disagreed from v8 onward. A unit return is nothing to assert on, so the
 * documented behaviour is the correct one and the code now matches it.
 *
 * This was unobservable in the shipped product: classifyTestability refuses a
 * unit return as `underspecified` before returnTypeOf is ever reached, which is
 * almost certainly why the disagreement survived. The defensive gate it feeds
 * can now actually fire. See docs/supersessions.md.
 */
export function rustReturnTypeOf(signature: string): string | undefined {
  const m = /->\s*([\s\S]+?)\s*(?:\bwhere\b|\{|$)/.exec(signature);
  const t = m?.[1]?.trim();
  if (t === undefined || t.length === 0) {
    return undefined;
  }
  // `()`, `( )`, `(\n)`: the unit type in every spelling.
  return /^\(\s*\)$/.test(t) ? undefined : t;
}

// ===========================================================================
// Rust: the adapter
// ===========================================================================

const RUST_LIBTEST: TestFramework = {
  id: "libtest",
  displayName: "cargo test (libtest)",

  // A Cargo.toml at the run root IS the framework: libtest ships with the
  // toolchain, so there is nothing else to look for and nothing to install.
  detect(root, deps) {
    return fileExistsOf(deps)(path.join(root, "Cargo.toml"));
  },

  // Straight through to the shipped builder. The command must stay
  // `cargo test --lib <name…>` in the crate root, byte for byte;
  // blind-v8-testrung is the pin.
  buildCommand(placement, testNames) {
    return buildTestCommand(placement.runRoot, testNames);
  },

  // parseLibtestOutput reads stdout alone, which is where cargo puts the
  // libtest lines; stderr and the exit code are the caller's business (the
  // build error and the green rule) and this parser has never seen them.
  //
  // casesComplete is true because libtest names EVERY case, passing ones
  // included. filterMatchedNothing stays undefined because Rust has no positive
  // filter-miss tell - a measured fact, not an omission. The executed>0 guard in
  // runTestOracleAt is what catches it, exactly as it does today.
  parseOutput(stdout, _stderr, _exitCode) {
    return { ...parseLibtestOutput(stdout), casesComplete: true };
  },

  assertionInstruction:
    "Assert with `assert_eq!(<call>, <expected>)`: the EXPECTED value is the SECOND argument. " +
    "Write each expected value inline as the second argument of its own assert.",

  expectedValueSpans: rustExpectedValueSpans,

  // The literal reading of "walked but unresolved" for this locator: it matched
  // `assert_eq!(` / `assert_ne!(` and the call did not yield a second top-level
  // argument, so the assertion the human would have typed a value into produced
  // no hole. A macro whose arguments the locator never reached at all is not
  // counted; this is the silence the locator can SEE.
  unresolvedAssertions: rustUnresolvedAssertions,
};

// A generated `mod tests { … }` wrapper, already present or added.
// ScaffoldInput.generatedTests carries the model's test FUNCTIONS, while
// planTestInsertion takes a MODULE and reads the fns out of its brace body — hand
// it bare functions and it silently keeps only the first fn's body, dropping the
// fn heads. Every shipped caller passes what extractTestModule returned, which
// always has the wrapper, so this normalizes the other shape rather than changing
// the shipped one: a module in, the same module out, byte for byte.
const RUST_MODULE_HEAD = /^\s*(?:#\[\s*cfg\s*\(\s*test\s*\)\s*\]\s*)?(?:pub(?:\s*\([^)]*\))?\s+)?mod\s+\w+\s*\{/;

// A `#[…]` or `#![…]` attribute starting at `i`, or `i` unchanged when there is
// no terminated attribute there. Brackets are counted and literals skipped, so a
// multi-line `#[cfg(all(test, feature = "]"))]` ends where it really ends.
function skipRustAttribute(text: string, i: number): number {
  let j = text[i + 1] === "!" ? i + 2 : i + 1;
  if (text[j] !== "[") {
    return i;
  }
  let depth = 0;
  while (j < text.length) {
    const skipped = skipLiteralOrComment(text, j);
    if (skipped > j) {
      j = skipped;
      continue;
    }
    if (text[j] === "[") {
      depth++;
    } else if (text[j] === "]" && --depth === 0) {
      return j + 1;
    }
    j++;
  }
  return i;
}

// A `use` item starting at `i`, ending after its `;`, or `i` unchanged.
function skipRustUseItem(text: string, i: number): number {
  if (!text.startsWith("use", i) || /\w/.test(text[i + 3] ?? "")) {
    return i;
  }
  let j = i + 3;
  while (j < text.length) {
    const skipped = skipLiteralOrComment(text, j);
    if (skipped > j) {
      j = skipped;
      continue;
    }
    if (text[j] === ";") {
      return j + 1;
    }
    j++;
  }
  return i;
}

// The offset of the first token that is not leading noise: blank lines, `//` and
// `/* */` comments, `#[…]`/`#![…]` attributes, and `use` items.
//
// The module detector has to look PAST all of that. extractTestModule returns the
// whole fenced block and only requires a `mod` somewhere inside it, so a reply
// that opens with `use super::*;` or a comment still arrives here as an
// already-wrapped module. Testing the head at offset 0 would read that preamble
// as "not a module", wrap it a SECOND time, and hand planTestInsertion a doubly
// nested module - a shape the shipped path never produces.
function rustPreambleEnd(text: string): number {
  let i = 0;
  while (i < text.length) {
    if (/\s/.test(text[i])) {
      i++;
      continue;
    }
    // Comments only: a `'` here is a lifetime far more often than a char
    // literal, and either way it is not preamble, so the scan should stop.
    let next = text[i] === "/" ? skipLiteralOrComment(text, i) : i;
    if (next === i && text[i] === "#") {
      next = skipRustAttribute(text, i);
    }
    if (next === i) {
      next = skipRustUseItem(text, i);
    }
    if (next === i) {
      return i;
    }
    i = next;
  }
  return i;
}

function asRustTestModule(generatedTests: string): string {
  return RUST_MODULE_HEAD.test(generatedTests.slice(rustPreambleEnd(generatedTests)))
    ? generatedTests
    : `mod tests {\n${generatedTests}\n}`;
}

/** Rust's placement already holds both facts the module walk needs: the file
 *  the region is in, and the crate it belongs to. */
function rustNameContext(ctx?: TestNameContext): RustTestNameContext | undefined {
  if (ctx === undefined) {
    return undefined;
  }
  return {
    filePath: ctx.placement.targetPath,
    crateRoot: ctx.placement.runRoot,
    files: { readFile: readFileOf(ctx.deps), fileExists: fileExistsOf(ctx.deps) },
  };
}

const RUST_TDD_LANG: TddLang = {
  languageId: "rust",
  displayName: "Rust",

  // Same file, always: `#[cfg(test)] mod tests` sits at the bottom of the module
  // under test and `use super::*` reaches private items, so there is no sibling
  // to find, no import to resolve and no visibility question to ask. The only way
  // this refuses is a file outside any crate, and detectCrateRoot is the same
  // resolution the check rung uses.
  placementFor(filePath, _symbolName, deps) {
    const exists = fileExistsOf(deps);
    const crateRoot = new RustOracle({ fileExists: exists, log: deps.log }).detectCrateRoot(filePath);
    if (crateRoot === undefined) {
      return {
        ok: false,
        refusal: {
          reason: "no-project-root",
          detail: `no Cargo.toml in ${path.dirname(filePath)} or any parent directory, so there is no crate to test`,
        },
      };
    }
    return { ok: true, placement: { targetPath: filePath, exists: exists(filePath), mode: "same-file", runRoot: crateRoot } };
  },

  // The tests go in THIS file whether or not a crate was found, so a missing
  // Cargo.toml is a missing RUN root and nothing more. `runTddTests` refuses over
  // it and names it; test AUTHORING does not, and did not before the seam
  // existed. The run root is the file's own directory so the shape is complete;
  // nothing runs from it, because nothing runs at all until there is a crate.
  placementWithoutProject(filePath) {
    return { targetPath: filePath, exists: true, mode: "same-file", runRoot: path.dirname(filePath) };
  },

  scaffold(input) {
    return planTestInsertion(input.existingText, asRustTestModule(input.generatedTests), { markerId: input.markerId });
  },

  markerPrefix: "//",

  generatedTestNames(fileText, markerId, ctx) {
    return generatedTestNames(fileText, markerId, rustNameContext(ctx));
  },

  classifyTestability,

  returnTypeOf: rustReturnTypeOf,

  // NOTE for the phase that wires this up: the seam's opts carry startHole only,
  // while the shipped renderBlankValue also takes rust-analyzer-resolved
  // structFields. blankTestModule must keep calling renderBlankValue DIRECTLY
  // until the seam carries field shapes, or Rust silently loses its struct
  // scaffold - which would be a supersession wearing a refactor's clothes.
  // PHASE 6: `structFields` now rides through (scraps D3). The note this member
  // used to carry said blankTestModule must keep calling the shipped renderer
  // directly until the seam carried field shapes. It carries them now, so the
  // seam-routed blanker below produces the same struct scaffold blind-v8-assembly
  // pins through blankTestModule.
  renderBlankValue(returnType, opts) {
    return renderBlankValue(returnType, { startHole: opts?.startHole, structFields: opts?.structFields });
  },

  frameworks: [RUST_LIBTEST],
};

// ===========================================================================
// The registry
// ===========================================================================

/**
 * The one construction point: the TDD strategy for a VS Code languageId, or
 * undefined when none is registered. undefined means the gesture refuses by
 * naming the language, exactly as oracleFor does for the check.
 *
 * The registry is built PER CALL, exactly as oracleFor builds its list, because
 * a language leg imports this file for its types while this file imports the leg
 * to register it. A module-level array would be populated during that cycle and
 * could hold an undefined entry depending on which side loaded first; a local one
 * is built after every module is initialized.
 *
 * Phase 3 registers TypeScript, under four languageIds: `typescript`,
 * `typescriptreact`, `javascript` and `javascriptreact`. Phase 4 registers
 * `python`. Phase 5 registers `csharp` and closes the set: all five languages
 * the goal names now resolve, and an unregistered languageId still answers
 * undefined so the gesture refuses by naming it rather than serving it a
 * Rust-shaped scaffold.
 */
export function tddLangFor(languageId: string): TddLang | undefined {
  return registeredTddLangs().find((lang) => lang.languageId === languageId);
}

/** The registry, built per call for the cycle reason above. */
function registeredTddLangs(): TddLang[] {
  return [RUST_TDD_LANG, GO_TDD_LANG, ...TS_TDD_LANGS, PY_TDD_LANG, CS_TDD_LANG];
}

/**
 * EVERY languageId the gesture is registered for, in registry order. The set is
 * WRITTEN DOWN ONCE, here, and read from here by everything that needs it.
 *
 * scraps D4 is why. The seam's coverage was being DISCOVERED one flip at a time:
 * `javascriptreact` appeared in the registry without ever being named in a
 * contract. `package.json`'s `resourceLangId` enablement clause and this registry
 * have to agree exactly, or the command palette offers a language the gesture
 * refuses (or hides one it supports). The clause is generated from this list and
 * an impl test pins the two together, so neither can drift alone.
 */
export function tddLanguageIds(): string[] {
  return registeredTddLangs().map((lang) => lang.languageId);
}

// ===========================================================================
// The seam-routed blanker (phase 6)
// ===========================================================================

export interface SeamBlankResult {
  /** The generated test text as a VS Code snippet: literal text escaped, each
   *  located expected value replaced by numbered tabstop holes. */
  snippet: string;
  /** Holes emitted across the whole text. */
  holes: number;
  /** Assertion sites the locator walked and could not resolve (scraps D5). Any
   *  non-zero value means the pass must be REFUSED, not inserted: the other
   *  assertions still produced holes, so a holes-based floor would pass while
   *  the model's guess shipped beside them. */
  unresolved: number;
}

/**
 * Blank the expected values in generated test text, through the seam, for any of
 * the five languages. The composition `blankTestModule` performs for Rust —
 * locate the spans, splice a rendered blank value over each, escape everything
 * else — with the locator and the renderer coming from the resolved framework
 * and language rather than being Rust-literal.
 *
 * `blankTestModule` itself is untouched and still ships: `blind-v8-assembly`
 * pins it, and Rust's bytes through this path are the same bytes because both
 * use the same scanner (`rustExpectedValueSpans`), the same renderer
 * (`renderBlankValue`, structFields included) and the same escaper.
 */
export function blankExpectedValues(
  lang: TddLang,
  framework: TestFramework,
  text: string,
  returnType: string,
  opts?: { structFields?: StructFieldShape[] },
): SeamBlankResult {
  const spans = framework.expectedValueSpans(text);
  let snippet = "";
  let cursor = 0;
  let hole = 1;
  for (const span of spans) {
    snippet += escapeSnippetLiteral(text.slice(cursor, span.start));
    const blank = lang.renderBlankValue(returnType, { startHole: hole, structFields: opts?.structFields });
    snippet += blank.rhs;
    hole += blank.holes;
    cursor = span.end;
  }
  snippet += escapeSnippetLiteral(text.slice(cursor));
  return { snippet, holes: hole - 1, unresolved: framework.unresolvedAssertions?.(text) ?? 0 };
}

/**
 * The framework this project actually tests with, or a refusal naming EVERY
 * framework that was looked for. Honest-dark, never a guess: the product does
 * not install a framework and does not write a config, so a project that tests
 * with nothing gets told what would have been accepted.
 *
 * ONE candidate is the ordinary case and declaration order decides it, which is
 * every language with a single framework — Rust and Go cannot reach the rest of
 * this function.
 *
 * MORE THAN ONE is a node problem, and precedence order alone answers it wrongly.
 * A project declaring jest and vitest, running `"test": "jest"`, with only jest's
 * binary present, chose vitest and built a command pointing at a binary that is
 * not there. So the project gets asked two questions it can actually answer:
 * whose runner RESOLVES here, and who does the test script NAME. Installation
 * decides first because it is the harder fact — a declared-but-absent runner
 * cannot spawn at all — and the script name breaks the tie when neither or both
 * resolve.
 */
export function frameworkFor(
  lang: TddLang,
  root: string,
  deps: TddDeps,
): { ok: true; framework: TestFramework } | { ok: false; lookedFor: string[]; detail?: string } {
  const candidates = lang.frameworks.filter((framework) => framework.detect(root, deps));
  if (candidates.length === 0) {
    const lookedFor = lang.frameworks.map((f) => f.displayName);
    deps.log?.(`[tdd] no ${lang.displayName} test framework in ${root}; looked for: ${lookedFor.join(", ")}`);
    // ADDED in phase 5 (Amendment 8b). `lookedFor` alone cannot say WHERE it
    // looked, and a refusal that cannot say what it found is worse than the
    // unactionable detail Amendment 5 already had to fix once. The KEY is only
    // present when the language supplies one, so the four legs that shipped
    // before this amendment keep their exact failure object.
    const detail = lang.frameworkRefusalDetail?.(root, deps);
    return detail === undefined ? { ok: false, lookedFor } : { ok: false, lookedFor, detail };
  }
  const framework = candidates.length === 1 ? candidates[0] : preferredFramework(candidates, root, deps);
  if (candidates.length > 1) {
    deps.log?.(`[tdd] ${candidates.length} frameworks declared in ${root} (${candidates.map((f) => f.id).join(", ")}); chose ${framework.id}`);
  }
  deps.log?.(`[tdd] framework=${framework.id} root=${root}`);
  return { ok: true, framework };
}

function preferredFramework(candidates: TestFramework[], root: string, deps: TddDeps): TestFramework {
  const fit = new Map(candidates.map((f) => [f, f.projectFit?.(root, deps)]));
  const installed = candidates.filter((f) => fit.get(f)?.installed === true);
  const pool = installed.length > 0 ? installed : candidates;
  if (pool.length === 1) {
    return pool[0];
  }
  return pool.find((f) => fit.get(f)?.namedByTestScript === true) ?? pool[0];
}
