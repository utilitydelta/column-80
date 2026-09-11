// ADVERSARIAL REVIEW of session-v68 phase 1 (S31: the test-authoring instruction
// asks for a TABLE). Written AFTER reading src/**, unlike the blind oracle next
// to it: these rows attack the SHIPPED code with the shape the shipped prompt
// now asks the model for.
//
// Run: SKIP_LIVE=1 node --test test/review-v68-p1.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

let mod = {};
let cleanup = () => {};
({ mod, cleanup } = bundleCore(
  "review-v68-p1",
  `export { assembleTestGenPrompt } from "../src/core/prompt";\n` +
    `export { tddLangFor, testGenFieldsFor } from "../src/core/tddLang";\n` +
    `export { extractTestModule, extractTestFunctions } from "../src/core/instructPostprocess";\n`
));
test.after(() => cleanup());

const { assembleTestGenPrompt, tddLangFor, testGenFieldsFor, extractTestModule, extractTestFunctions } = mod;

const SIG = {
  rust: "pub fn shard_of(key: &str, buckets: usize) -> usize",
  go: "func ShardOf(key string, buckets int) int",
  typescript: "export function shardOf(key: string, buckets: number): number",
  python: "def shard_of(key: str, buckets: int) -> int",
  csharp: "public static int ShardOf(string key, int buckets)",
};
const NAME = { rust: "Rust", go: "Go", typescript: "TypeScript", python: "Python", csharp: "C#" };

function fw(languageId, id) {
  const lang = tddLangFor(languageId);
  const f = lang.frameworks.find((x) => x.id === id);
  assert.ok(f, `${languageId} has no framework ${id}`);
  return f;
}

// EXACTLY what src/vscode/fnGen.ts builds. It reads the PRODUCT's own mapping
// (`testGenFieldsFor`) rather than re-deriving the field list here: this helper
// originally listed the fields by hand and went stale the moment a fifth one was
// added, which is the same defect as finding 9 wearing the reviewer's clothes.
function realPrompt(languageId, frameworkId) {
  const lang = tddLangFor(languageId);
  const f = fw(languageId, frameworkId);
  return assembleTestGenPrompt({
    signature: SIG[languageId],
    docComment: "Maps a key onto a bucket.",
    ...testGenFieldsFor(lang, f),
  });
}

const fence = (lang, body) => "```" + lang + "\n" + body + "\n```";

// ===========================================================================
// FINDING 1. The reply guard rejects the NUnit and MSTest table shapes the
// prompt now demands. TEST_FUNCTION_SHAPES.csharp is
// /\[\s*(?:TestMethod|Fact|Theory|Test)\s*[\]\(]/g — it needs `]` or `(`
// IMMEDIATELY after the attribute name, so `[TestCase(` and `[DataTestMethod]`
// both miss.
// ===========================================================================

// The reply the NUnit prompt asks for, verbatim to its own instructions: five
// `[TestCase(...)]` rows on ONE method with NO `[Test]` beside them.
const NUNIT_TABLE_REPLY = fence(
  "csharp",
  [
    "[TestCase(\"a\", 4, 0)]",
    "[TestCase(\"b\", 4, 1)]",
    "[TestCase(\"\", 4, 0)]",
    "[TestCase(\"a\", 1, 0)]",
    "[TestCase(\"zzz\", 8, 7)]",
    "public void ShardOf_Table(string key, int buckets, int want)",
    "{",
    "    Assert.That(ShardOf(key, buckets), Is.EqualTo(want));",
    "}",
  ].join("\n")
);

const MSTEST_TABLE_REPLY = fence(
  "csharp",
  [
    "[DataTestMethod]",
    "[DataRow(\"a\", 4, 0)]",
    "[DataRow(\"b\", 4, 1)]",
    "[DataRow(\"\", 4, 0)]",
    "[DataRow(\"a\", 1, 0)]",
    "[DataRow(\"zzz\", 8, 7)]",
    "public void ShardOf_Table(string key, int buckets, int want)",
    "{",
    "    Assert.AreEqual(want, ShardOf(key, buckets));",
    "}",
  ].join("\n")
);

test("HIGH: the NUnit table reply the prompt ASKS FOR is rejected by the reply guard (extractTestFunctions)", () => {
  const p = realPrompt("csharp", "nunit");
  assert.ok(
    /attributes on a single method whose parameters the rows fill in order, with NO `\[Test\]` attribute/.test(p),
    "precondition: the NUnit prompt demands [TestCase] rows with NO [Test] attribute"
  );
  const got = extractTestFunctions(NUNIT_TABLE_REPLY, "csharp");
  assert.notStrictEqual(
    got,
    undefined,
    "the gesture REFUSES the exact reply it just asked for: extractTestFunctions returns undefined, so " +
      "FnGenService throws \"generation does not contain csharp test functions\". " +
      "TEST_FUNCTION_SHAPES.csharp requires `]` or `(` right after Test/TestMethod/Fact/Theory, and " +
      "`[TestCase(` has `Case` there.\n---- REPLY ----\n" + NUNIT_TABLE_REPLY
  );
});

test("HIGH: the MSTest table reply the prompt ASKS FOR is rejected by the reply guard (extractTestFunctions)", () => {
  const p = realPrompt("csharp", "mstest");
  assert.ok(/\[DataTestMethod\]/.test(p), "precondition: the MSTest prompt demands a [DataTestMethod] table method");
  const got = extractTestFunctions(MSTEST_TABLE_REPLY, "csharp");
  assert.notStrictEqual(
    got,
    undefined,
    "the gesture REFUSES the exact reply it just asked for: `[DataTestMethod]` does not match " +
      "/\\[\\s*(?:TestMethod|Fact|Theory|Test)\\s*[\\]\\(]/ (the alternation must match at the `D`), and " +
      "`[DataRow(` does not either.\n---- REPLY ----\n" + MSTEST_TABLE_REPLY
  );
});

test("CONTROL: the xUnit table reply survives the guard, so the two rows above are a C#-attribute defect, not a harness bug", () => {
  const XUNIT_TABLE_REPLY = fence(
    "csharp",
    [
      "[Theory]",
      "[InlineData(\"a\", 4, 0)]",
      "[InlineData(\"b\", 4, 1)]",
      "public void ShardOf_Table(string key, int buckets, int want)",
      "{",
      "    Assert.Equal(want, ShardOf(key, buckets));",
      "}",
    ].join("\n")
  );
  const got = extractTestFunctions(XUNIT_TABLE_REPLY, "csharp");
  assert.notStrictEqual(got, undefined, "[Theory] matches the shape regex, so xUnit is unaffected");
  // AMENDED after the fix for findings 1 and 2 widened the attribute set to
  // include the ROW attributes. A two-row [Theory] table now matches three
  // times, one per attribute. Only zero-vs-non-zero is load-bearing here — it is
  // the reply guard — and `testCount` reaches one log line and nothing else.
  assert.strictEqual(got.testCount, 3, "one [Theory] plus two [InlineData] rows");
});

test("CONTROL: the OLD single-case NUnit shape (a [Test] method per case) still passes the guard", () => {
  const OLD = fence(
    "csharp",
    ["[Test] public void ShardOf_Happy() { Assert.That(ShardOf(\"a\", 4), Is.EqualTo(0)); }"].join("\n")
  );
  assert.notStrictEqual(
    extractTestFunctions(OLD, "csharp"),
    undefined,
    "the pre-S31 shape passed; S31 moved the asked-for shape out of the guard's set"
  );
});

// ===========================================================================
// FINDING 2. pytest: the prompt now demands a `@pytest.mark.parametrize`
// decorator, the reply shape forbids imports, and the pytest placement writes
// NO `import pytest` (tddPy.ts:1845 sets frameworkImportLine only for unittest).
// ===========================================================================

// A project in which pytest IS detected, on injected deps alone: no real
// interpreter, no real filesystem. `probe` answering exit 0 to `-c "import
// pytest"` is what `PYTEST.detect` reads, and it is also what proves the
// generated import resolves.
const PY_ROOT = "/proj";
const pyDeps = {
  fileExists: (p) => p === "/proj/pyproject.toml" || p === "/proj/shard.py",
  // `[tool.pytest.ini_options]` is what `pytestConfigured` reads. With no venv
  // interpreter on the fake filesystem the probe leg answers UNPROVEN, so this
  // section is the offline evidence `PYTEST.detect` falls back to.
  readFile: (p) =>
    p === "/proj/pyproject.toml" ? '[project]\nname = "shard"\n\n[tool.pytest.ini_options]\ntestpaths = ["tests"]\n' : undefined,
  readDir: (p) => (p === PY_ROOT ? ["pyproject.toml", "shard.py"] : []),
  probe: () => ({ exitCode: 0 }),
};

test("HIGH: the pytest prompt demands @pytest.mark.parametrize while forbidding imports, and the PLACEMENT must supply `import pytest`", () => {
  const p = realPrompt("python", "pytest");
  assert.ok(/@pytest\.mark\.parametrize/.test(p), "precondition: the prompt asks for the parametrize decorator");
  assert.ok(/no imports/i.test(p), "precondition: the reply shape forbids imports");
  // AMENDED: the framework object was the wrong place to look. Anything about
  // the PROJECT is resolved during placement and rides on TestPlacement — the
  // seam says so — and `frameworkImportLine` is a placement field. So the row
  // now drives the real `placementFor` on a project where pytest is detected.
  const res = tddLangFor("python").placementFor("/proj/shard.py", "shard_of", pyDeps);
  assert.strictEqual(res.ok, true, `expected a placement, got ${JSON.stringify(res.refusal)}`);
  assert.strictEqual(
    res.placement.frameworkImportLine,
    "import pytest",
    "the prompt asks for `@pytest.mark.parametrize` and forbids the model from importing, so the " +
      "placement is the only thing that can bind `pytest`. Before S31 the reply was a plain " +
      "`assert x == y`, which bound nothing.\n---- PLACEMENT ----\n" + JSON.stringify(res.placement, null, 2)
  );
});

// ===========================================================================
// FINDING 3. Rust: "a SINGLE #[test] fn" and the multi-group rule are in the
// SAME prompt and disagree.
// ===========================================================================

// TRIAGED **DELETE**, and kept as a control so the reasoning is not lost. The
// finding was that "write a SINGLE `#[test]` fn" and two later clauses asking
// for a SEPARATE `#[test]` fn are two counts in one prompt. Both later clauses
// are ruled contract invariants — P1 §7 (the multi-group rule) and P1 §10 (the
// panic clause) — and both are explicitly CONDITIONAL ("If a case cannot be a
// row of the same table…", "Only if the contract EXPLICITLY states…"). "SINGLE"
// scopes the TABLE fn. Going green would mean deleting ruled content, and no
// measurement says the wording costs anything.
test("CONTROL (triaged Delete): SINGLE scopes the table fn; the two extra-fn clauses are CONDITIONAL and ruled", () => {
  const p = realPrompt("rust", "libtest");
  assert.ok(/write a SINGLE `#\[test\]` fn/.test(p), "clause A: a SINGLE #[test] fn holds the table");
  for (const conditional of [/If a case cannot be a row of the same table[\s\S]{0,200}separate `#\[test\]` fn/, /Only if the contract EXPLICITLY states[\s\S]{0,200}`#\[should_panic\]`/]) {
    assert.ok(conditional.test(p), `an extra-fn clause must stay CONDITIONAL: ${conditional}`);
  }
});

// ===========================================================================
// FINDING 4. Token budget: how much longer the instruction got.
// ===========================================================================

test("INFO: measured character growth per framework, HEAD vs working tree", () => {
  const sizes = {};
  for (const [languageId, ids] of Object.entries({
    rust: ["libtest"],
    go: ["gotest"],
    typescript: ["vitest", "jest"],
    python: ["pytest", "unittest"],
    csharp: ["mstest", "xunit", "nunit"],
  })) {
    for (const id of ids) sizes[`${languageId}/${id}`] = realPrompt(languageId, id).length;
  }
  console.log("prompt chars (working tree):", JSON.stringify(sizes, null, 2));
  assert.ok(Object.values(sizes).every((n) => n > 0));
});

// ===========================================================================
// FINDING 5. The Rust guard still accepts the table shape (attack found
// nothing here) — recorded as a control so the report can say so.
// ===========================================================================

test("CONTROL: the Rust table reply passes extractTestModule", () => {
  const RUST_TABLE_REPLY = fence(
    "rust",
    [
      "#[cfg(test)]",
      "mod tests {",
      "    use super::*;",
      "    #[test]",
      "    fn shard_of_table() {",
      "        // (key, buckets, want)",
      "        let cases = [(\"a\", 4usize, 0usize), (\"b\", 4, 1)];",
      "        for (key, buckets, want) in cases {",
      "            assert_eq!(shard_of(key, buckets), want);",
      "        }",
      "    }",
      "}",
    ].join("\n")
  );
  const got = extractTestModule(RUST_TABLE_REPLY);
  assert.notStrictEqual(got, undefined, "the Rust module guard is shape-agnostic below the module wrapper");
  assert.strictEqual(got.testCount, 1);
});

test("CONTROL: the Go, TS and unittest table replies pass extractTestFunctions", () => {
  const GO = fence("go", [
    "func TestShardOf(t *testing.T) {",
    "\tcases := []struct{ name string; key string; buckets int; want int }{",
    "\t\t{\"happy\", \"a\", 4, 0},",
    "\t}",
    "\tfor _, tt := range cases {",
    "\t\tt.Run(tt.name, func(t *testing.T) {",
    "\t\t\tgot := ShardOf(tt.key, tt.buckets)",
    "\t\t\tif got != tt.want { t.Errorf(\"ShardOf() = %v, want %v\", got, tt.want) }",
    "\t\t})",
    "\t}",
    "}",
  ].join("\n"));
  assert.notStrictEqual(extractTestFunctions(GO, "go"), undefined, "go table reply survives");

  const TS = fence("typescript", [
    "describe('shardOf', () => {",
    "  it.each([['happy', 'a', 4, 0], ['edge', '', 4, 0]])('shardOf %s', (_l, key, buckets, want) => {",
    "    expect(shardOf(key, buckets)).toBe(want);",
    "  });",
    "});",
  ].join("\n"));
  assert.notStrictEqual(extractTestFunctions(TS, "typescript"), undefined, "ts it.each reply survives");

  const PY = fence("python", [
    "class TestShardOf(unittest.TestCase):",
    "    def test_shard_of(self):",
    "        cases = [(\"a\", 4, 0), (\"\", 4, 0)]",
    "        for key, buckets, want in cases:",
    "            with self.subTest(key=key):",
    "                self.assertEqual(shard_of(key, buckets), want)",
  ].join("\n"));
  assert.notStrictEqual(extractTestFunctions(PY, "python"), undefined, "unittest table reply survives");
});

// ===========================================================================
// FINDING 6. The shipped expected-value LOCATORS were written for the OLD
// shape. Phase 1 shipped the instruction; P2-locator.md is a separate phase.
// This row measures what the gesture does TODAY if P1 lands alone.
// ===========================================================================

// DISCHARGED by phase 2. This row was written as an unconditional `assert.fail`
// reporting what each shipped locator found, and what it found was the
// identifier `want` at the runner's assertion - the blank-value invariant
// inverted, because the row literals then shipped unblanked and the human typed
// into the loop variable. Phase 2 made the locators table-aware, so the row is
// now the GUARD it was pointing at: every one of them returns the row LITERALS
// and none of them returns a name.
test("the table-aware locators return the ROW literals, never the name `want` [was HIGH, discharged by phase 2]", () => {
  const cases = [
    ["rust/libtest", fw("rust", "libtest"), [
      "#[cfg(test)]",
      "mod tests {",
      "    #[test]",
      "    fn shard_of_table() {",
      "        // (key, buckets, want)",
      "        let cases = [(\"a\", 4usize, 0usize), (\"b\", 4, 1)];",
      "        for (key, buckets, want) in cases {",
      "            assert_eq!(shard_of(key, buckets), want);",
      "        }",
      "    }",
      "}",
    ].join("\n")],
    ["go/gotest", fw("go", "gotest"), [
      "func TestShardOf(t *testing.T) {",
      "\tcases := []struct{ name string; key string; buckets int; want int }{",
      "\t\t{\"happy\", \"a\", 4, 0},",
      "\t}",
      "\tfor _, tt := range cases {",
      "\t\tt.Run(tt.name, func(t *testing.T) {",
      "\t\t\tgot := ShardOf(tt.key, tt.buckets)",
      "\t\t\tif got != tt.want { t.Errorf(\"= %v, want %v\", got, tt.want) }",
      "\t\t})",
      "\t}",
      "}",
    ].join("\n")],
    ["python/pytest", fw("python", "pytest"), [
      "@pytest.mark.parametrize(\"key,buckets,want\", [(\"a\", 4, 0), (\"\", 4, 0)])",
      "def test_shard_of(key, buckets, want):",
      "    assert shard_of(key, buckets) == want",
    ].join("\n")],
    ["csharp/nunit", fw("csharp", "nunit"), [
      "[TestCase(\"a\", 4, 0)]",
      "[TestCase(\"b\", 4, 1)]",
      "public void ShardOf_Table(string key, int buckets, int want)",
      "{",
      "    Assert.That(ShardOf(key, buckets), Is.EqualTo(want));",
      "}",
    ].join("\n")],
  ];
  const EXPECTED = {
    "rust/libtest": ["0usize", "1"],
    "go/gotest": ["0"],
    "python/pytest": ["0", "0"],
    "csharp/nunit": ["0", "1"],
  };
  for (const [label, f, text] of cases) {
    const spans = f.expectedValueSpans(text);
    const found = spans.map((s) => text.slice(s.start, s.end));
    assert.deepStrictEqual(
      found,
      EXPECTED[label],
      `${label}: the locator must return one row literal per row, in row order. Got ${JSON.stringify(found)}.\n` +
        `---- TEXT ----\n${text}`
    );
    for (const v of found) {
      assert.ok(
        !/^\s*(?:\w+\.)*want\s*$/.test(v),
        `${label}: the locator returned the NAME \`${v}\`, which is the runner reading the row. Blanking ` +
          `it deletes the loop variable and leaves every guessed row literal in the human's buffer.`
      );
    }
    // And the floor is not tripped by a table it parsed perfectly.
    assert.strictEqual(f.unresolvedAssertions(text), 0, `${label}: a parsed table must not be reported unresolved`);
  }
});

// ===========================================================================
// FINDING 7. The re-cut differential row in review-v31-phase6 now compares a
// tiny fraction of what it compared before.
// ===========================================================================

test("MED: the re-cut review-v31-phase6 differential now byte-compares 6.6% of the Rust prompt, down from 100%", () => {
  const p = assembleTestGenPrompt({
    signature: "pub fn widen(n: i32) -> i64",
    docComment: "/// Widens.",
    languageId: "rust",
    calleeSurface: "pub struct P;",
  });
  const MOCKS = "tested without a fake, say so instead of inventing one.";
  const at = p.lastIndexOf(MOCKS);
  // AMENDED after the fix: the differential now byte-compares a HEAD as well as
  // a tail, cut at "Inside the module write a SINGLE", so this row measures both
  // ends the way review-v31-phase6 actually cuts them.
  const HEAD_CUT = "Inside the module write a SINGLE";
  const headEnd = p.indexOf(HEAD_CUT);
  assert.ok(headEnd > 0, "the head cut must exist in the shipped prompt");
  const comparedNow = headEnd + (p.length - (at + MOCKS.length));
  assert.ok(
    comparedNow / p.length > 0.25,
    `the row cuts at the LAST clause of the instruction, so everything above it is no longer ` +
      `byte-compared: ${comparedNow} of ${p.length} chars (${((comparedNow / p.length) * 100).toFixed(1)}%). ` +
      `The blind-directive first line and the reply-shape line did NOT move under S31 and are now ` +
      `guarded by nothing but three substring regexes. Cutting at the reply-shape line instead would ` +
      `have kept them.`
  );
});

// ===========================================================================
// FINDING 2 (b). The product artefact, not just the framework object: the
// pytest new-module scaffold writes NO `import pytest`.
// ===========================================================================

test("HIGH: the pytest new-module scaffold must bind `pytest`, driven through the REAL placement", () => {
  const lang = tddLangFor("python");
  // AMENDED: the first cut hand-built a placement with no frameworkImportLine
  // and asserted the SCAFFOLD should have supplied one. That premise was wrong
  // twice over — it hard-coded the very field under test, and the seam puts
  // project facts on the placement, not in the scaffold. This drives the real
  // `placementFor` and feeds what it produces straight to `scaffold`, which is
  // the artefact the human's disk actually receives.
  const res = lang.placementFor("/proj/shard.py", "shard_of", pyDeps);
  assert.strictEqual(res.ok, true, `expected a placement, got ${JSON.stringify(res.refusal)}`);
  const plan = lang.scaffold({
    existingText: "",
    generatedTests: [
      '@pytest.mark.parametrize("key,buckets,want", [("a", 4, 0), ("", 4, 0)])',
      "def test_shard_of(key, buckets, want):",
      "    assert shard_of(key, buckets) == want",
    ].join("\n"),
    markerId: "shard_of",
    placement: res.placement,
  });
  assert.ok(/@pytest\.mark\.parametrize/.test(plan.text), "precondition: the parametrize decorator lands in the file");
  assert.ok(
    /^import pytest$/m.test(plan.text),
    "the scaffolded file uses `pytest` with nothing importing it, so pytest collection fails with " +
      "NameError before a single case runs.\n---- SCAFFOLDED FILE ----\n" + plan.text
  );
});

// ===========================================================================
// ATTACK 3/4: NUnit discovery + naming + the run rung, for a [TestCase]-only
// method. This attack found NOTHING at the naming layer: csMethodHead skips
// attributes generically, so the name comes out whatever the attribute is.
// ===========================================================================

test("CONTROL: generatedTestNames names a [TestCase]-only table method, and a [DataTestMethod] one", () => {
  const lang = tddLangFor("csharp");
  const file = [
    "public class ShardTests",
    "{",
    "    // column80-tests:shard_of:begin",
    "    [TestCase(\"a\", 4, 0)]",
    "    [TestCase(\"b\", 4, 1)]",
    "    public void ShardOf_Table(string key, int buckets, int want)",
    "    {",
    "        Assert.That(ShardOf(key, buckets), Is.EqualTo(want));",
    "    }",
    "    // column80-tests:shard_of:end",
    "}",
  ].join("\n");
  const names = lang.generatedTestNames(file, "shard_of");
  assert.deepStrictEqual(
    names,
    ["ShardTests.ShardOf_Table"],
    "attribute-agnostic head parsing means the table method is still named; ONE name for ONE table is " +
      "also all the run rung needs, so nothing downstream assumed a name per case"
  );
});

// ===========================================================================
// FINDING 8. ATTACK 1 hit: all three C# prompts carry knob rule 1 ("prefer a
// column carrying a value the test CONSTRUCTS") and, two sentences earlier,
// "these attributes take compile-time constants only". One prompt, two orders.
// ===========================================================================

test("MED: every C# prompt says prefer a CONSTRUCTED column and, in the same prompt, that the row attribute takes compile-time constants only", () => {
  for (const id of ["nunit", "xunit", "mstest"]) {
    const p = realPrompt("csharp", id);
    const constructs = /Prefer a column carrying a value the test CONSTRUCTS/.test(p);
    const constOnly = /takes compile-time constants only/.test(p);
    assert.ok(
      !(constructs && constOnly),
      `csharp/${id}: knob rule 1 asks for a constructed column while the table clause says the row ` +
        `attribute cannot hold one. TABLE_KNOB_RULES is emitted unconditionally in ` +
        `testGenInstructionFor, so the C# tableShape's carve-out cannot suppress it.`
    );
  }
});

// ===========================================================================
// FINDING 9. The blind oracle never sees the shipped NUnit clause: it injects
// only `assertionInstruction`, never `tableShape`, so its csharp rows judge the
// languageId DEFAULT table shape.
// ===========================================================================

// AMENDED after the fix. The finding was that the blind oracle drove
// `assembleTestGenPrompt` with `assertionInstruction` alone, so the shipped NUnit
// clause banning `[Test]` — the clause that broke the C# reply guard — sat in no
// prompt any test read. The fix is structural: `testGenFieldsFor` is now the ONE
// framework-to-prompt mapping, `src/vscode/fnGen.ts` spreads it, and
// `blind-v68-table-instruction.test.cjs` drives all nine (language, framework)
// pairs through it. What is left to guard here is that the mapping does not DROP
// a field on the way, which is how the drift happened in the first place.
test("MED: the product mapping carries every framework field into the prompt, so no clause reaches a human unoracled", () => {
  const lang = tddLangFor("csharp");
  const nunit = fw("csharp", "nunit");
  const fields = testGenFieldsFor(lang, nunit);
  assert.strictEqual(fields.tableShape, nunit.tableShape, "the mapping must not drop tableShape");
  assert.strictEqual(fields.replyShape, nunit.replyShape, "the mapping must not drop replyShape");
  assert.strictEqual(fields.assertionInstruction, nunit.assertionInstruction, "the mapping must not drop assertionInstruction");
  assert.strictEqual(fields.rowsAreConstantsOnly, nunit.rowsAreConstantsOnly, "the mapping must not drop rowsAreConstantsOnly");
  assert.ok(/with NO `\[Test\]` attribute/.test(realPrompt("csharp", "nunit")), "the shipped clause reaches the assembled prompt");
});
