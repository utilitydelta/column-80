/**
 * Labelling a node the call walk already found. DISCOVERY is the walk
 * (callWalk.ts) and nothing else; this file only answers "is that caller a
 * test", which the protocol cannot answer for us.
 *
 * MEASURED (session-v60/scout-call-walk.md): every CallHierarchyItem from
 * rust-analyzer, gopls, Roslyn and pyright comes back as a plain function with
 * no tags and a bare signature. There is no field that says "test". Rust and C#
 * carry the answer in an ATTRIBUTE above the declaration; Go and Python carry it
 * in the item's own name and file. So classification reads text.
 *
 * That is not the banned name heuristic. The ban (goal.md, ruled constraints)
 * covers DISCOVERY, where string matching was doing the work of a call graph and
 * failed measurably (session-v60/discovery-census.md). Here the call graph has
 * already answered "does this reach the target"; the only question left is a
 * label the protocol does not carry.
 */

export type ClassifyLang = "rust" | "go" | "csharp" | "python" | "typescript";

/**
 * How far ABOVE the declaration range's start to begin scanning.
 *
 * A server's `range` normally already covers the attributes, so this is slack
 * for the servers that do not: three lines is enough for `#[cfg_attr(...)]` plus
 * `#[test]` plus a blank, and small enough that it cannot reach the previous
 * declaration's body in any realistic layout.
 */
export const ATTRIBUTE_LOOKBACK = 3;

/**
 * The lines a per-language attribute detector may read: from a little ABOVE
 * `rangeStartLine` DOWN TO `selectionStartLine` inclusive, clamped to the file.
 *
 * THE TRAP THIS EXISTS FOR. A CallHierarchyItem's `range` STARTS AT THE DOC
 * COMMENT, so for every documented test the `#[test]` attribute sits BELOW
 * `range.start`, not above it. A detector scanning upward from `range.start`
 * misses all of them - and misses them silently, reporting the test as a plain
 * function that the walk then tries to walk through. In the scout this produced
 * a confident, wrong finding that survived a whole round of analysis.
 *
 * The name token (`selectionRange.start`) is the bottom of the window because
 * nothing between an attribute and the name it decorates belongs to anything
 * else.
 */
export function attributeWindow(
  rangeStartLine: number,
  selectionStartLine: number,
  lineCount: number,
): { from: number; to: number } {
  if (lineCount <= 0) {
    return { from: 0, to: -1 }; // empty window: `for (i = from; i <= to)` runs zero times
  }
  const last = lineCount - 1;
  const rangeStart = Math.max(0, Math.min(rangeStartLine, last));
  const from = Math.max(0, rangeStart - ATTRIBUTE_LOOKBACK);
  // A selection above the range is malformed input (no server produces it). The
  // window still covers the range head and its lookback, and never becomes
  // negative-width, so a malformed item degrades to "no attribute found" rather
  // than to a throw or an unbounded scan.
  const selectionStart = Math.min(Math.max(selectionStartLine, rangeStart), last);
  return { from, to: selectionStart };
}

export interface ClassifyInput {
  /** The item's own name, as the server spelled it. */
  name: string;
  /** Absolute path of the item's file. */
  filePath: string;
  /** The file's lines, 0-indexed, or undefined when the file could not be read. */
  lines: readonly string[] | undefined;
  rangeStartLine: number;
  selectionStartLine: number;
}

// `#[test]`, `#[tokio::test]`, `#[test_case(...)]`, `#[rstest]`-style paths, and
// the spaced form rustfmt never writes but a human does. The path may be
// qualified; what matters is the LAST segment. `#[cfg(test)]` is deliberately
// not matched: it marks a MODULE, and every function in a test module would
// otherwise classify as a test, including the module's own helpers.
const RUST_TEST_ATTRIBUTE = /#\s*\[\s*(?:[A-Za-z_]\w*\s*::\s*)*(?:test|test_case)\s*(?:\]|\()/;

// xunit, NUnit and MSTest, optionally namespace-qualified, and tolerant of
// several attributes sharing one bracket pair (`[Fact, Trait("x","y")]`).
//
// `Skippable*` is in the list because MEASURED on the real C# corpus it is 40 of
// 257 tests - the whole xunit.skippablefact population - and leaving it out did
// not mislabel them as plain helpers harmlessly: it made them invisible to the
// walk, so the destructive Postgres set the exclusion filter exists to catch was
// never even reaching the filter.
const CS_TEST_ATTRIBUTE =
  /\[\s*(?:[A-Za-z_]\w*\s*\.\s*)*(?:Fact|Theory|SkippableFact|SkippableTheory|Test|TestCase|TestCaseSource|TestMethod|DataTestMethod)\s*(?:\]|\(|,)/;

// The toolchain's own rule (`cmd/go/internal/load.isTest`): the name carries the
// prefix, and either nothing follows it or the rune that follows is NOT lower
// case. `[A-Z_]` was narrower than that and read `func Test(t *testing.T)` and
// `TestReadsSuite`'s numbered sibling `Test1Suite` as PLAIN, so a real test was
// walked THROUGH instead of recorded and never ran (adversarial review row A9).
// `\p{Ll}` rather than `[a-z]` because Go asks `unicode.IsLower`.
const GO_TEST_NAME = /^(?:Test|Fuzz)(?:$|(?!\p{Ll})[\s\S])/u;

// `TestMain` is the package's ENTRY POINT, not a test: it runs the others.
// `go test -run TestMain` selects no test, which is the filter-miss shape - a
// clean run reported for something that never executed (adversarial review
// row A10).
const GO_ENTRY_POINT = /^TestMain$/;

function basename(p: string): string {
  const parts = p.split(/[\\/]/);
  return parts[parts.length - 1] || p;
}

/** The last dotted segment of a possibly-qualified name. C# qualifies
 *  (`Shape.Tests.WorksDirectly`); Python's item name can arrive qualified by its
 *  class. Everyone else gives a bare name, which is its own last segment. */
function lastSegment(name: string): string {
  const parts = name.split(".");
  return parts[parts.length - 1] ?? name;
}

/**
 * The code part of a line, with any trailing line comment removed.
 *
 * A COMMENTED-OUT ATTRIBUTE IS NOT AN ATTRIBUTE. `// #[test] removed while
 * debugging` matches every attribute pattern in this file and would make a plain
 * function classify as a covering test - which stops the walk there (a test is a
 * leaf) and puts a name into a runner filter that names no test. Rust's doc
 * comments make it worse than a corner case: `/// #[test]` inside a documented
 * example sits exactly in the window this file scans, which is the same window
 * the doc-comment trap forced it to scan in the first place.
 *
 * The comment marker is per language because Rust's ATTRIBUTE sigil is `#`,
 * which is Python's comment marker. Cutting on the wrong one deletes the thing
 * being looked for.
 *
 * A `//` or `#` inside a string literal cuts the line early. That direction is
 * safe: it can only ever hide an attribute, never invent one.
 *
 * "none" exists for the one marker that IS a comment: Go's `//go:build` build
 * constraint. Cutting comments there would delete the thing being looked for.
 */
export type CommentMarker = "//" | "#" | "none";

export function codePart(line: string, marker: CommentMarker): string {
  if (marker === "none") {
    return line;
  }
  const at = line.indexOf(marker);
  return at === -1 ? line : line.slice(0, at);
}

function hasAttribute(input: ClassifyInput, pattern: RegExp): boolean {
  const lines = input.lines;
  if (lines === undefined) {
    // The file could not be read, so the attribute cannot be seen. "plain" is
    // the safe direction: a mislabelled test is walked through and contributes
    // its own callers, which is noisy; a mislabelled plain node would be RUN.
    return false;
  }
  const { from, to } = attributeWindow(input.rangeStartLine, input.selectionStartLine, lines.length);
  for (let i = from; i <= to; i++) {
    if (pattern.test(codePart(lines[i] ?? "", "//"))) {
      return true;
    }
  }
  return false;
}

/**
 * Is this discovered caller a test? Never throws, for any input.
 *
 * TypeScript is RULED at FILE granularity (goal.md, 2026-08-26): tsserver
 * answers a call-hierarchy query with the FILE (`kind: module`, `name` is the
 * path), so there is no individual test to name. It always answers "plain" here
 * and the TS leg selects files instead of names.
 */
export function classifyTestNode(lang: ClassifyLang, input: ClassifyInput): "test" | "plain" {
  switch (lang) {
    case "rust":
      return hasAttribute(input, RUST_TEST_ATTRIBUTE) ? "test" : "plain";
    case "csharp":
      return hasAttribute(input, CS_TEST_ATTRIBUTE) ? "test" : "plain";
    case "go":
      // Go's convention IS the declaration, and it is enforced by the toolchain:
      // `go test` only runs `func TestXxx` in a `_test.go` file. Both halves are
      // required - a `TestFoo` helper in a non-test file is not run by anything.
      return /_test\.go$/.test(input.filePath) &&
        GO_TEST_NAME.test(input.name) &&
        !GO_ENTRY_POINT.test(input.name)
        ? "test"
        : "plain";
    case "python":
      // pytest's default collection: a `test_*.py` or `*_test.py` module, and a
      // `test_*` function inside it. Both halves again, for the same reason.
      return /^test_.*\.py$/.test(basename(input.filePath)) || /_test\.py$/.test(basename(input.filePath))
        ? /^test_/.test(lastSegment(input.name))
          ? "test"
          : "plain"
        : "plain";
    case "typescript":
      return "plain";
  }
}

/**
 * The discovered item's `name` as a RUNNER FILTER for this language, or
 * undefined when it cannot become one.
 *
 * C# QUALIFIES the name and every other server does not, so a filter built from
 * a raw walk name is per-language work rather than a pass-through. Rust also
 * only applies `--exact` when every filter is a full libtest path
 * (compilerOracle.ts, LIBTEST_FULL_PATH), so a bare walk name silently degrades
 * to SUBSTRING matching - assembling the full path is the run leg's job, and
 * this function stays honest about the server said.
 */
/**
 * Does a RUNNER'S OWN case name refer to the test this filter selected?
 *
 * The two are NOT the same string, and assuming they were is a real defect this
 * session hit while measuring. A Rust call-hierarchy item is named
 * `chain_read_returns_all_versions`, while libtest reports the case as
 * `shard_wal::tests::chain_read_returns_all_versions`. Comparing them with `===`
 * matches nothing, so a set-membership test built that way silently answers
 * "none of these failures belong to this function" for every Rust failure there
 * is - the feature would look wired and do nothing.
 *
 * Suffix, not `includes`: `..._all_versions` must not match
 * `..._not_all_versions`. The separator is part of the test.
 */
export function caseMatchesFilter(lang: ClassifyLang, caseName: string, filter: string): boolean {
  const a = caseName.trim();
  const b = filter.trim();
  if (a.length === 0 || b.length === 0) {
    return false;
  }
  if (a === b) {
    return true;
  }
  switch (lang) {
    case "rust":
      // libtest prefixes the module path.
      return a.endsWith(`::${b}`);
    case "python":
      // pytest node ids are `path::Class::test_name`; a bare name is the tail.
      return a.endsWith(`::${b}`) || a.endsWith(`.${b}`);
    case "csharp":
      // The filter is already the fully-qualified method name; a runner may add
      // a parameter list for a data-driven case.
      return a.startsWith(`${b}(`) || a.endsWith(`.${b}`);
    case "go":
      // A subtest is `TestOuter/case name`.
      return a.startsWith(`${b}/`);
    case "typescript":
      // File granularity: there is no name to match, so only identity counts,
      // and identity was already answered above.
      return false;
  }
}

export function runnerFilterFor(lang: ClassifyLang, name: string): string | undefined {
  if (lang === "typescript") {
    return undefined; // file granularity: a TS name is a path, never a test filter
  }
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  if (lang === "csharp") {
    // `Shape.Tests.WorksDirectly()` and `Shape.Tests.WorksDirectly(int, string)`
    // both filter as the method's fully-qualified name; the parameter list is
    // display detail, not part of any runner's filter grammar.
    const cut = trimmed.indexOf("(");
    let bare = (cut === -1 ? trimmed : trimmed.slice(0, cut)).trim();
    // TYPE ARGUMENTS GO TOO. VSTest filters on `FullyQualifiedName`, and the FQN
    // of `Works<T>` is `Shape.Tests.Works` with no arguments at all - leaving
    // `<int>` in produces a filter that matches no test, which reports a clean
    // run for a suite that never executed (adversarial review row A11). The
    // innermost group is stripped first and the pass repeats, so a nested
    // argument list such as `Works<Dictionary<int, string>>` collapses too.
    for (let prev = ""; prev !== bare; ) {
      prev = bare;
      bare = bare.replace(/<[^<>]*>/g, "");
    }
    bare = bare.trim();
    return bare.length === 0 ? undefined : bare;
  }
  if (lang === "python") {
    const seg = lastSegment(trimmed).trim();
    return seg.length === 0 ? undefined : seg;
  }
  return trimmed;
}
