// Implementer tests for session-v31 phase 5: the C# leg (src/core/tddCs.ts),
// written alongside the implementation and sitting under the blind oracle
// blind-v31-cs.
//
// What these pin that the contract alone does not:
//
//   - THE INVERSION, first and hardest, and it is the reason goal.md calls item
//     6 safety-critical. MSTest and xUnit put the EXPECTED value FIRST, where
//     Rust's assert_eq! puts it second. Section 1 asserts "it is NOT the second
//     argument" before anything else, because getting this backwards blanks the
//     call under test, keeps the model's guess, and makes the product LIE;
//   - the FOUR no-run outcomes, every one of them parsed from a REAL capture off
//     `Contoso.ProcessingLogic.Tests` in `test/fixtures/csharp-trx/`. Two of them
//     correct the contract: the missing runtime DOES write a TRX, and the
//     compile failure puts its errors on STDOUT with stderr empty;
//   - `runRoot` is the TEST project's directory, proven on the real solution,
//     along with the one-to-many case where one test project serves three source
//     projects;
//   - C#'s STRING SYNTAX, the richest of the five: `@"…"` where `""` escapes a
//     quote, `"""…"""` with no escapes at all, and `$"…{expr}…"`. A locator that
//     matches inside any of them blanks the wrong bytes;
//   - and that Rust, Go, TypeScript and Python do not move, because this phase
//     widened the shared literal scanner all four read through.
//
// Run: SKIP_LIVE=1 node --test test/impl-v31-cs.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-v31-cs",
  `export { tddLangFor, frameworkFor, REAL_TDD_DEPS } from "../src/core/tddLang";\n` +
    `export { CS_TDD_LANG, MSTEST, XUNIT, NUNIT, CS_LITERALS, csReturnTypeOf, csMethodHead, csNamespaceOf, classifyCsTestability, csInternalsVisibleTo, csRenderBlankValue, mstestExpectedValueSpans, xunitExpectedValueSpans, nunitExpectedValueSpans, parseTrx, csTrxPath } from "../src/core/tddCs";\n` +
    `export { goExpectedValueSpans } from "../src/core/tddGo";\n` +
    `export { tsExpectedValueSpans } from "../src/core/tddTs";\n` +
    `export { pytestExpectedValueSpans, unittestExpectedValueSpans, parsePytestJunitXml } from "../src/core/tddPy";\n` +
    `export { rustExpectedValueSpans, skipLiteralOrComment, blankTestModule } from "../src/core/testAssembly";\n` +
    `export { runFrameworkTestsAt } from "../src/core/compilerOracle";\n`
);
const {
  tddLangFor,
  frameworkFor,
  REAL_TDD_DEPS,
  MSTEST,
  XUNIT,
  NUNIT,
  CS_LITERALS,
  csReturnTypeOf,
  csMethodHead,
  csNamespaceOf,
  classifyCsTestability,
  csInternalsVisibleTo,
  csRenderBlankValue,
  mstestExpectedValueSpans,
  xunitExpectedValueSpans,
  nunitExpectedValueSpans,
  parseTrx,
  csTrxPath,
  goExpectedValueSpans,
  tsExpectedValueSpans,
  pytestExpectedValueSpans,
  unittestExpectedValueSpans,
  parsePytestJunitXml,
  rustExpectedValueSpans,
  skipLiteralOrComment,
  blankTestModule,
  runFrameworkTestsAt,
} = mod;

const TRX = path.join(__dirname, "fixtures", "csharp-trx");
const capture = (name) => fs.readFileSync(path.join(TRX, name), "utf8");

const CORPUS = path.join(os.homedir(), "work", "contoso", "data-processing", "dotnet");
const TEST_PROJECT = path.join(CORPUS, "Contoso.ProcessingLogic.Tests");
const corpus = fs.existsSync(path.join(TEST_PROJECT, "Contoso.ProcessingLogic.Tests.csproj")) ? CORPUS : undefined;
const noCorpus = corpus === undefined ? "contoso/data-processing/dotnet is not present" : false;

test.after(cleanup);

const cs = () => tddLangFor("csharp");
const spans = (text, fn) => fn(text).map((s) => text.slice(s.start, s.end));

// ===========================================================================
// 1. THE INVERSION. Nothing else in this leg matters if this is wrong.
// ===========================================================================

test("MSTest blanks the FIRST argument, and specifically NOT the second", () => {
  const text = `Assert.AreEqual(7, AggregateFanout(3));`;
  assert.deepStrictEqual(spans(text, mstestExpectedValueSpans), ["7"]);
  // Said the other way round, because this is the failure the goal names: the
  // shipped Rust locator takes argument TWO, and pointed here it would delete
  // the call under test and leave the model's guessed 7 standing.
  assert.deepStrictEqual(spans(text, rustExpectedValueSpans), []);
  assert.ok(!spans(text, mstestExpectedValueSpans).includes("AggregateFanout(3)"));
});

test("xUnit blanks the FIRST argument too", () => {
  const text = `Assert.Equal(7, AggregateFanout(3));\nAssert.Equal("hi", Greet());`;
  assert.deepStrictEqual(spans(text, xunitExpectedValueSpans), ["7", '"hi"']);
});

test("NUnit blanks the argument of Is.EqualTo, not either argument of Assert.That", () => {
  const text = `Assert.That(AggregateFanout(3), Is.EqualTo(7));`;
  assert.deepStrictEqual(spans(text, nunitExpectedValueSpans), ["7"]);
});

test("the MESSAGE argument is never blanked", () => {
  const text = `Assert.AreEqual(7, Widen(3), "widen should double and add one");`;
  assert.deepStrictEqual(spans(text, mstestExpectedValueSpans), ["7"]);
});

test("a one-argument assert has no expected VALUE, so it yields no span (fails open)", () => {
  for (const text of [`Assert.IsTrue(IsEven(4));`, `Assert.IsNull(Find("x"));`, `Assert.AreEqual(Only(1));`]) {
    assert.deepStrictEqual(mstestExpectedValueSpans(text), [], text);
  }
  assert.deepStrictEqual(nunitExpectedValueSpans(`Assert.That(x, Is.Not.Null);`), []);
});

test("an explicit generic argument list does not hide the call", () => {
  const text = `Assert.AreEqual<int>(7, Widen(3));`;
  assert.deepStrictEqual(spans(text, mstestExpectedValueSpans), ["7"]);
});

test("a nested call in the expected position is taken WHOLE", () => {
  const text = `Assert.AreEqual(new List<int> { 1, 2 }, Parse("1,2"));`;
  assert.deepStrictEqual(spans(text, mstestExpectedValueSpans), ["new List<int> { 1, 2 }"]);
});

test("spans come back ascending and non-overlapping", () => {
  const text = [
    `Assert.AreEqual(1, A());`,
    `Assert.AreNotEqual(2, B());`,
    `Assert.AreSame(c, C());`,
    `Assert.AreEqual(4, D(), "msg");`,
  ].join("\n");
  const got = mstestExpectedValueSpans(text);
  assert.deepStrictEqual(got.map((s) => text.slice(s.start, s.end)), ["1", "2", "c", "4"]);
  for (let i = 1; i < got.length; i++) {
    assert.ok(got[i].start >= got[i - 1].end, "spans must not overlap");
  }
});

// ===========================================================================
// 2. C#'s string syntax, which is the richest of the five
// ===========================================================================

test("no locator matches inside a string, a verbatim string, a raw string, an interpolation or a comment", () => {
  const cases = [
    ['a plain string', `var s = "Assert.AreEqual(7, X())";`],
    ['a verbatim string, where "" is an escaped quote', `var s = @"Assert.AreEqual(""7"", X())";`],
    ["a verbatim path ending in a backslash", `var p = @"C:\\logs\\"; Assert.IsTrue(true);`],
    ["a raw string literal", `var s = """Assert.AreEqual(7, X())""";`],
    ["an interpolated string", `var s = $"{n} Assert.AreEqual(7, X())";`],
    ["a verbatim interpolated string", `var s = $@"{n} Assert.AreEqual(7, X())";`],
    ["a line comment", `// Assert.AreEqual(7, X());`],
    ["a block comment", `/* Assert.AreEqual(7, X()); */`],
    ["a doc comment", `/// <summary>Assert.AreEqual(7, X())</summary>`],
  ];
  for (const [why, text] of cases) {
    assert.deepStrictEqual(mstestExpectedValueSpans(text), [], why);
  }
});

test("a literal in the ASSERT still blanks, and a quote inside it does not end the scan", () => {
  const text = `Assert.AreEqual(@"say ""hi""", Quote("hi"));\nAssert.AreEqual(2, Widen(1));`;
  assert.deepStrictEqual(spans(text, mstestExpectedValueSpans), [`@"say ""hi"""`, "2"]);
});

test("a raw string in the expected position keeps its fence", () => {
  const text = `Assert.AreEqual("""a "quoted" line""", Render());`;
  assert.deepStrictEqual(spans(text, mstestExpectedValueSpans), [`"""a "quoted" line"""`]);
});

test("C# block comments do NOT nest, unlike Rust's", () => {
  // `/* /* */` closes at the FIRST `*/` in C#. A nesting reader would swallow
  // the assert that follows and blank nothing.
  const text = `/* outer /* inner */\nAssert.AreEqual(7, X());`;
  assert.deepStrictEqual(spans(text, mstestExpectedValueSpans), ["7"]);
});

test("a char literal is a char literal, and C# has no lifetimes to confuse it with", () => {
  const text = `Assert.AreEqual('a', First("abc"));`;
  assert.deepStrictEqual(spans(text, mstestExpectedValueSpans), ["'a'"]);
});

// ===========================================================================
// 3. The four legs before this one do not move
// ===========================================================================

test("Rust, Go, TypeScript and Python locators are byte-identical after the scanner widened", () => {
  const rust = `assert_eq!(widen(3), 7);\nassert_ne!(widen(3), 8);`;
  assert.deepStrictEqual(spans(rust, rustExpectedValueSpans), ["7", "8"]);

  const go = "want := 7\nif got != want {\n\tt.Errorf(\"bad\")\n}";
  assert.ok(spans(go, goExpectedValueSpans).includes("7"), "go want= still found");

  const ts = `expect(widen(3)).toBe(7);`;
  assert.deepStrictEqual(spans(ts, tsExpectedValueSpans), ["7"]);

  const py = `assert widen(3) == 7\nassert halve(7) == 7 // 2`;
  assert.deepStrictEqual(spans(py, pytestExpectedValueSpans), ["7", "7 // 2"]);
  assert.deepStrictEqual(spans(`self.assertEqual(widen(3), 7)`, unittestExpectedValueSpans), ["7"]);
});

test("the C# flags are OPT-IN: without them the scanner reads exactly as before", () => {
  // `@"a""b"` is a verbatim string only under the C# profile. Under the default
  // (Rust) profile the `@` is nothing and `"a"` is an ordinary string, which is
  // what every shipped caller has always seen.
  const text = `@"a""b"`;
  assert.strictEqual(skipLiteralOrComment(text, 0), 0, "no verbatim branch by default");
  assert.strictEqual(skipLiteralOrComment(text, 0, CS_LITERALS), text.length, "verbatim under the C# profile");
  assert.strictEqual(skipLiteralOrComment(`"""x"""`, 0), 2, "a bare `\"\"` by default");
  assert.strictEqual(skipLiteralOrComment(`"""x"""`, 0, CS_LITERALS), 7, "a raw string under the C# profile");
});

// ===========================================================================
// 4. returnTypeOf, the contract's table
// ===========================================================================

test("csReturnTypeOf reads the type that PRECEDES the name", () => {
  const table = [
    ["public static int Widen(int n)", "int"],
    ["public async Task<int> WidenAsync(int n)", "Task<int>"],
    ["private static List<DtoGapAnalysis> Remove(List<DtoGapAnalysis> gaps)", "List<DtoGapAnalysis>"],
    ["public void Apply(int n)", undefined],
    ["public static Dictionary<int, ShiftHour> Make(CustomerSite s)", "Dictionary<int, ShiftHour>"],
    ["public static long ToUnixTimeSeconds(this DateTime input)", "long"],
    ["public (int, string) Split(int n)", "(int, string)"],
    ["public static T Identity<T>(T v)", "T"],
    ["public static int[] Widths(int n)", "int[]"],
    ["public static string? Maybe(int n)", "string?"],
    ["internal static global::System.Guid NewId()", "global::System.Guid"],
    ["public static List<List<int>> Grid(int n)", "List<List<int>>"],
  ];
  for (const [sig, want] of table) {
    assert.strictEqual(csReturnTypeOf(sig), want, sig);
  }
});

test("a CONSTRUCTOR is not a method: the false positive that took the corpus count from 300 to 251", () => {
  assert.strictEqual(csReturnTypeOf("public Foo(int a)"), undefined);
  assert.strictEqual(csMethodHead("public Foo(int a)"), undefined);
  // And a C# 12 PRIMARY CONSTRUCTOR, found in the corpus on the first pass:
  // `class` would otherwise read as the return type.
  assert.strictEqual(csMethodHead("public class EventMetadata(Dictionary<string, Monitor> byHash)"), undefined);
  assert.strictEqual(csMethodHead("public record Point(int X, int Y);"), undefined);
});

test("a call and a local declaration are not method heads", () => {
  assert.strictEqual(csMethodHead("Widen(3);"), undefined);
  assert.strictEqual(csMethodHead("var x = Widen(3);"), undefined);
  assert.strictEqual(csMethodHead("Assert.AreEqual(7, Widen(3));"), undefined);
  assert.strictEqual(csMethodHead("public int Value => 3;"), undefined, "an expression-bodied property is not a method");
});

test("attributes and multi-line signatures are read through", () => {
  const head = csMethodHead("[TestMethod]\n[Description(\"has a ) in it\")]\npublic\n  static\n  int\n  Widen(int n)");
  assert.deepStrictEqual(head.returnType, "int");
  assert.deepStrictEqual(head.name, "Widen");
  assert.deepStrictEqual(head.modifiers, ["public", "static"]);
});

test("an explicit interface implementation keeps its dotted name", () => {
  assert.strictEqual(csMethodHead("void IFoo.Bar(int n)").name, "IFoo.Bar");
});

// ===========================================================================
// 5. The classifier
// ===========================================================================

const DOC = "/// <summary>Doubles n.</summary>";

test("the precedence is fixed: async wins over everything, then io, then the fixture, then visibility", () => {
  assert.strictEqual(classifyCsTestability("private async Task<int> F(Stream s)", DOC).reason, "async");
  assert.strictEqual(classifyCsTestability("private int F(Stream s)", DOC).reason, "io");
  assert.strictEqual(classifyCsTestability("private int F(int n)", DOC).reason, "needs-fixture");
  assert.strictEqual(classifyCsTestability("private static int F(int n)", DOC).reason, "not-exported");
  assert.strictEqual(classifyCsTestability("public static int F(int n)", undefined).reason, "underspecified");
  assert.strictEqual(classifyCsTestability("public static void F(int n)", DOC).reason, "underspecified");
  assert.strictEqual(classifyCsTestability("public static int F(int n)", DOC).testable, true);
});

test("a Task return is async even without the modifier", () => {
  for (const sig of ["public static Task Go()", "public static Task<int> Go()", "public static ValueTask<int> Go()"]) {
    assert.strictEqual(classifyCsTestability(sig, DOC).reason, "async", sig);
  }
});

test("an implicit access modifier is PRIVATE, so it refuses as not-exported", () => {
  const v = classifyCsTestability("static int Widen(int n)", DOC);
  assert.strictEqual(v.reason, "not-exported");
  assert.match(v.detail, /no access modifier is `private` by default/);
});

test("every not-exported detail names a fix the human can PERFORM (Amendment 5)", () => {
  const cases = [
    ["private static int F(int n)", /Make it `public`/],
    ["internal static int F(int n)", /Make it `public`, or add .*InternalsVisibleTo/],
    ["protected static int F(int n)", /only reachable from a subclass\. Make it `public`/],
    ["static int F(int n)", /Make it `public`/],
  ];
  for (const [sig, re] of cases) {
    const v = classifyCsTestability(sig, DOC);
    assert.strictEqual(v.reason, "not-exported", sig);
    assert.match(v.detail, re, sig);
    assert.ok(!/add `?export`?/.test(v.detail), "C# has no export to add");
  }
});

test("C#'s Amendment 5 trap cannot fire: an explicit interface implementation never reaches the visibility leg", () => {
  // It cannot be made public by any edit, so a `not-exported` detail saying so
  // would be unactionable. It is an INSTANCE member by definition, and
  // needs-fixture comes first.
  assert.strictEqual(classifyCsTestability("int IFoo.Bar(int n)", DOC).reason, "needs-fixture");
});

test("InternalsVisibleTo makes an internal method reachable, and it is the ONLY thing that does", () => {
  assert.strictEqual(classifyCsTestability("internal static int F(int n)", DOC, { internalsVisible: true }).testable, true);
  assert.strictEqual(classifyCsTestability("internal static int F(int n)", DOC, { internalsVisible: false }).reason, "not-exported");
  assert.strictEqual(classifyCsTestability("internal static int F(int n)", DOC).reason, "not-exported", "absent means NOT visible");
  // It does not launder `private` or `protected`.
  assert.strictEqual(classifyCsTestability("private static int F(int n)", DOC, { internalsVisible: true }).reason, "not-exported");
  assert.strictEqual(classifyCsTestability("protected internal static int F(int n)", DOC, { internalsVisible: true }).reason, "not-exported");
});

test("the seam's TddLang member accepts the third parameter (Amendment 8a)", () => {
  assert.strictEqual(cs().classifyTestability("internal static int F(int n)", DOC, { internalsVisible: true }).testable, true);
  assert.strictEqual(cs().classifyTestability("internal static int F(int n)", DOC).reason, "not-exported");
  // And the other four legs ignore it rather than breaking on it.
  for (const id of ["rust", "go", "typescript", "python"]) {
    assert.ok(tddLangFor(id).classifyTestability("fn f() {}", undefined, { internalsVisible: true }) !== undefined, id);
  }
});

// ===========================================================================
// 6. Blank values
// ===========================================================================

test("csRenderBlankValue: a scalar is BARE, everything else is HINTED (Amendments 2 and 6a)", () => {
  const table = [
    ["int", "${1}", 1],
    ["long", "${1}", 1],
    ["double", "${1}", 1],
    ["bool", "${1}", 1],
    ["char", "${1}", 1],
    ["string", "${1}", 1],
    ["decimal", "${1}", 1],
    ["List<int>", "new List<int> { ${1:/* int */} }", 1],
    ["int[]", "new[] { ${1:/* int */} }", 1],
    ["Dictionary<int, ShiftHour>", "${1:/* Dictionary<int, ShiftHour> */}", 1],
    ["DtoGapAnalysis", "${1:/* DtoGapAnalysis */}", 1],
    ["IEnumerable<int>", "${1:/* IEnumerable<int> */}", 1],
    // `T?` is a VARIANT: the choice is the contract's, not the type's, which is
    // the Option/Result precedent every leg has kept.
    ["string?", "${1:/* string? */}", 1],
    ["int?", "${1:/* int? */}", 1],
  ];
  for (const [ty, rhs, holes] of table) {
    assert.deepStrictEqual(csRenderBlankValue(ty), { rhs, holes }, ty);
  }
});

test("a TUPLE is one BARE hole per element (Amendment 6a beats Amendment 2)", () => {
  assert.deepStrictEqual(csRenderBlankValue("(int, string)"), { rhs: "(${1}, ${2})", holes: 2 });
  assert.deepStrictEqual(csRenderBlankValue("(int, string, bool)"), { rhs: "(${1}, ${2}, ${3})", holes: 3 });
});

test("startHole numbers the holes from where the caller is up to", () => {
  assert.deepStrictEqual(csRenderBlankValue("int", { startHole: 4 }), { rhs: "${4}", holes: 1 });
  assert.deepStrictEqual(csRenderBlankValue("(int, string)", { startHole: 4 }), { rhs: "(${4}, ${5})", holes: 2 });
});

test("spans plus renderer blank the expected value and keep the call under test", () => {
  // `blankTestModule` is still Rust-wired (phase 6 owns that wiring, and the
  // seam comment says so), so this composes the two halves the way a consumer
  // will: the FRAMEWORK's spans and the LANGUAGE's renderer.
  const module = `[TestMethod]\npublic void WidenHappy()\n{\n    Assert.AreEqual(7, Widen(3));\n    Assert.AreEqual(9, Widen(4));\n}`;
  let out = "";
  let cursor = 0;
  let hole = 1;
  for (const span of MSTEST.expectedValueSpans(module)) {
    const bv = csRenderBlankValue("int", { startHole: hole });
    out += module.slice(cursor, span.start) + bv.rhs;
    hole += bv.holes;
    cursor = span.end;
  }
  out += module.slice(cursor);
  assert.strictEqual(
    out,
    `[TestMethod]\npublic void WidenHappy()\n{\n    Assert.AreEqual(\${1}, Widen(3));\n    Assert.AreEqual(\${2}, Widen(4));\n}`,
  );
  assert.ok(out.includes("Widen(3)") && out.includes("Widen(4)"), "the calls under test SURVIVE");
  assert.ok(!/\b[79]\b/.test(out), "the model's guessed values do NOT");
  // And the shipped Rust blanker is byte-frozen, pointed at Rust text.
  assert.strictEqual(
    blankTestModule("assert_eq!(widen(3), 7);", "u32").snippet,
    "assert_eq!(widen(3), ${1});",
  );
});

// ===========================================================================
// 7. The TRX parse, from REAL captures
// ===========================================================================

test("a passing run: TRX enumerates PASSING tests by name (Amendment 7, on the real corpus)", () => {
  const p = parseTrx(capture("pass.trx"), "", 0);
  assert.strictEqual(p.ran, true);
  assert.strictEqual(p.passed, 2);
  assert.strictEqual(p.failed, 0);
  assert.strictEqual(p.casesComplete, true, "the goal's fidelity limit was the CONSOLE's, not the tool's");
  assert.deepStrictEqual(
    p.cases.map((c) => `${c.outcome}:${c.name}`).sort(),
    [
      "pass:LocationFactor_DoubleValue_RoundTripsThroughBuildDpmEvent",
      "pass:LocationFactor_StickyFill_PreservesDoublePrecision",
    ],
  );
  assert.strictEqual(p.filterMatchedNothing, undefined);
  assert.strictEqual(p.environmentError, undefined);
  assert.strictEqual(p.buildError, undefined);
});

test("a failing run carries the ErrorInfo message AND the stack trace", () => {
  const p = parseTrx(capture("fail.trx"), "", 1);
  assert.strictEqual(p.ran, true);
  assert.strictEqual(p.passed, 0);
  assert.strictEqual(p.failed, 1);
  assert.deepStrictEqual(p.cases, [{ name: "ValidateTimeZone_ValidTimeZone_DoesNotThrow", outcome: "fail" }]);
  assert.strictEqual(p.failures.length, 1);
  assert.match(p.failures[0].message, /System\.ArgumentException: Invalid timezone ID/);
  assert.match(p.failures[0].message, /SiteValidation\.cs:line 30/, "the stack trace is part of the detail");
});

test("a FILTER MISS is structural: zero results, total=0, and it is NOT a compile error", () => {
  const p = parseTrx(capture("filter-miss.trx"), "", 0);
  assert.strictEqual(p.ran, false);
  assert.strictEqual(p.filterMatchedNothing, true);
  assert.strictEqual(p.environmentError, undefined);
  assert.strictEqual(p.buildError, undefined);
  assert.deepStrictEqual(p.cases, []);
});

test("a MISSING RUNTIME writes a TRX too, and it is an environmentError, never a compile error", () => {
  // CONTRACT CORRECTION. contract-cs.md says the missing runtime writes NO TRX.
  // Measured: it writes one, with total="0" and a RunInfo outcome="Error"
  // carrying the whole message. So it is structurally identical to a filter miss
  // except for that one attribute — the trap contract-seam.md warns about in Go,
  // arriving in a third language.
  const p = parseTrx(capture("missing-runtime.trx"), capture("missing-runtime.stderr.txt"), 1);
  assert.strictEqual(p.ran, false);
  assert.strictEqual(p.filterMatchedNothing, undefined, "getting this backwards blames the human's filter");
  assert.strictEqual(p.buildError, undefined, "and this is the lie the human currently reads");
  assert.match(p.environmentError, /You must install or update \.NET/);
  assert.match(p.environmentError, /version '9\.0\.0'/, "names what is MISSING");
  assert.match(p.environmentError, /10\.0\.10/, "and what is installed");
});

test("a COMPILE FAILURE writes no TRX and puts its errors on STDOUT with stderr EMPTY", () => {
  // The second contract correction, and the reason Amendment 8c exists: with the
  // report file absent, `stdout` is the process's real stdout.
  const p = parseTrx(capture("compile-failure.stdout.txt"), "", 1);
  assert.strictEqual(p.ran, false);
  assert.match(p.buildError, /error CS8630/);
  assert.strictEqual(p.environmentError, undefined, "a compile error is not an environment error");
  assert.strictEqual(p.filterMatchedNothing, undefined);
});

test("a missing runtime with NO TRX is still an environmentError, not a compile error", () => {
  // The abort message contains the words "exited with error:", so a loose
  // diagnostic reader classifies it as a COMPILE failure and tells the human to
  // fix an error that does not exist. The environment tell is read FIRST.
  const stderr = capture("missing-runtime.stderr.txt");
  for (const [why, out, err] of [
    ["on stderr", "", stderr],
    ["on stdout", stderr, ""],
    ["a bare abort", "Test Run Aborted.", ""],
  ]) {
    const p = parseTrx(out, err, 1);
    assert.strictEqual(p.ran, false, why);
    assert.strictEqual(p.buildError, undefined, why);
    assert.ok(p.environmentError.length > 0, why);
  }
});

test("the MTP rejection is a build error, and it is LOUD rather than silent", () => {
  const out = "error : Testing with VSTest target is no longer supported by Microsoft.Testing.Platform on .NET 10 SDK and later.";
  const p = parseTrx(out, "", 1);
  assert.match(p.buildError, /no longer supported by Microsoft\.Testing\.Platform/);
  // Placement refuses it before a command is ever built, so this is the floor
  // under a project that opts in between the placement and the run.
  assert.strictEqual(p.filterMatchedNothing, undefined);
});

test("the counts come from the ATTRIBUTES, so a printing test cannot forge them", () => {
  const forged = capture("pass.trx").replace(
    "<Times ",
    "<StdOut>Failed! - Failed: 0, Passed: 99, Total: 99</StdOut>\n  <UnitTestResultNot testName=\"Phantom\" outcome=\"Passed\" />\n  <Times ",
  );
  const p = parseTrx(forged, "", 0);
  assert.strictEqual(p.passed, 2, "the Counters attribute is the count, whatever a test printed");
  assert.strictEqual(p.cases.length, 2);
  assert.ok(!p.cases.some((c) => c.name === "Phantom"));
});

test("a TRUNCATED report is not a report", () => {
  const whole = capture("pass.trx");
  for (const cut of [10, 200, 1200, whole.indexOf("<ResultSummary")]) {
    const p = parseTrx(whole.slice(0, cut), "", 0);
    assert.strictEqual(p.ran, false, `truncated at ${cut}`);
    assert.ok(p.environmentError !== undefined || p.buildError !== undefined, `truncated at ${cut} must say something`);
  }
  // And it never throws, at ANY byte position.
  for (let i = 0; i <= whole.length; i += 37) {
    assert.doesNotThrow(() => parseTrx(whole.slice(0, i), "", 1));
  }
});

test("a namespace PREFIX on the elements is tolerated", () => {
  const prefixed = capture("pass.trx")
    .replace(/<(\/?)(TestRun|UnitTestResult|ResultSummary|Counters|Times|TestSettings|Deployment|TestLists|TestList|TestDefinitions|UnitTest|Execution|TestMethod|TestEntries|TestEntry|Output|ErrorInfo|Message|StackTrace|RunInfos|RunInfo|Text)\b/g, "<$1a:$2")
    .replace("xmlns=", "xmlns:a=");
  const p = parseTrx(prefixed, "", 0);
  assert.strictEqual(p.passed, 2);
  assert.strictEqual(p.cases.length, 2);
});

test("a UTF-8 BOM does not stop the report being recognised", () => {
  assert.strictEqual(capture("pass.trx").charCodeAt(0), 0xfeff, "dotnet test really does write one");
  assert.strictEqual(parseTrx(capture("pass.trx").slice(1), "", 0).passed, 2, "and it parses without one too");
});

test("no report and no console text at all is an honest did-not-run", () => {
  const p = parseTrx("", "", 1);
  assert.strictEqual(p.ran, false);
  assert.match(p.environmentError, /wrote no TRX report/);
});

test("Python's parse is unmoved by Amendment 8c's stdout fallback", () => {
  // The fallback hands pytest its real stdout when the report is missing.
  // parsePytestJunitXml refuses any document that does not BEGIN as a junit
  // report, so console text lands on the same honest did-not-run an empty string
  // did. That is the whole reason phase 4 wrote the guard that way.
  const consoleText = "collected 2 items\n\ntests/test_a.py ..   [100%]\n\n2 passed in 0.01s\n";
  const before = parsePytestJunitXml("", "boom", 1);
  const after = parsePytestJunitXml(consoleText, "boom", 1);
  assert.deepStrictEqual(after, before);
});

// ===========================================================================
// 8. The command
// ===========================================================================

const fakePlacement = (over = {}) => ({
  targetPath: "/repo/Acme.Tests/Gaps/AnalysisTests.cs",
  exists: false,
  mode: "project-file",
  runRoot: "/repo/Acme.Tests",
  packageArg: "Acme.Tests.csproj",
  packageName: "Acme.Tests.Gaps",
  frameworkId: "mstest",
  ...over,
});

test("the command runs from the TEST project and writes its TRX to the SYSTEM TEMP area", () => {
  const cmd = MSTEST.buildCommand(fakePlacement(), ["AnalysisHappy", "AnalysisZero"]);
  assert.strictEqual(cmd.command, "dotnet");
  assert.strictEqual(cmd.cwd, "/repo/Acme.Tests");
  assert.deepStrictEqual(cmd.args, [
    "test",
    "Acme.Tests.csproj",
    "--no-restore",
    "--filter",
    "FullyQualifiedName~AnalysisHappy|FullyQualifiedName~AnalysisZero",
    "--logger",
    `trx;LogFileName=${path.basename(csTrxPath(fakePlacement()))}`,
    "--results-directory",
    os.tmpdir(),
  ]);
  assert.strictEqual(cmd.outputFile, csTrxPath(fakePlacement()));
  assert.strictEqual(path.dirname(cmd.outputFile), os.tmpdir(), "never inside the human's repo");
});

test("the product NEVER sets DOTNET_ROLL_FORWARD", () => {
  // Setting it would run the human's tests on a runtime their own `dotnet test`
  // refuses, so the rung could report GREEN where their own command hard-fails.
  // The same divergence GoOracle already warns about for GOENV=off.
  const cmd = MSTEST.buildCommand(fakePlacement(), ["A"]);
  assert.deepStrictEqual(cmd.env, { DOTNET_CLI_TELEMETRY_OPTOUT: "1", DOTNET_NOLOGO: "1" });
  assert.strictEqual(cmd.env.DOTNET_ROLL_FORWARD, undefined);
  assert.ok(!JSON.stringify(cmd).includes("ROLL_FORWARD"));
});

test("an empty filter is refused rather than turned into a whole-project run", () => {
  assert.throws(() => MSTEST.buildCommand(fakePlacement(), []), /at least one test name/);
  assert.throws(() => MSTEST.buildCommand(fakePlacement(), [""]), /at least one test name/);
});

test("the TRX path is per TARGET FILE and stable across calls", () => {
  assert.strictEqual(csTrxPath(fakePlacement()), csTrxPath(fakePlacement()));
  assert.notStrictEqual(csTrxPath(fakePlacement()), csTrxPath(fakePlacement({ targetPath: "/repo/Acme.Tests/OtherTests.cs" })));
});

test("all three frameworks share one command and one parse, and differ only in the assertion", () => {
  for (const fw of [MSTEST, XUNIT, NUNIT]) {
    assert.deepStrictEqual(fw.buildCommand(fakePlacement(), ["A"]).args, MSTEST.buildCommand(fakePlacement(), ["A"]).args, fw.id);
    assert.strictEqual(fw.parseOutput, MSTEST.parseOutput, fw.id);
  }
  assert.match(MSTEST.assertionInstruction, /FIRST argument/);
  assert.match(XUNIT.assertionInstruction, /FIRST argument/);
  assert.match(NUNIT.assertionInstruction, /Is\.EqualTo/);
});

// ===========================================================================
// 9. Placement
// ===========================================================================

function deps(files, contents = {}, dirs = {}) {
  const set = new Set(files.map((f) => path.normalize(f)));
  return {
    fileExists: (p) => set.has(path.normalize(p)) || dirs[path.normalize(p)] !== undefined,
    readFile: (p) => contents[path.normalize(p)],
    readDir: (p) => dirs[path.normalize(p)],
    log: () => {},
  };
}

const TEST_CSPROJ = [
  "<Project Sdk=\"Microsoft.NET.Sdk\">",
  "  <PropertyGroup><IsTestProject>true</IsTestProject></PropertyGroup>",
  "  <ItemGroup><PackageReference Include=\"MSTest.TestFramework\" Version=\"4.0.1\" /></ItemGroup>",
  "  <ItemGroup><ProjectReference Include=\"..\\Acme\\Acme.csproj\" /></ItemGroup>",
  "</Project>",
].join("\n");

const SRC_CSPROJ = "<Project Sdk=\"Microsoft.NET.Sdk\"><PropertyGroup><TargetFramework>net9.0</TargetFramework></PropertyGroup></Project>";

function solutionDeps(extra = {}) {
  const files = ["/repo/Acme/Acme.csproj", "/repo/Acme/Gaps/Analysis.cs", "/repo/Acme.Tests/Acme.Tests.csproj", ...(extra.files ?? [])];
  const contents = {
    "/repo/Acme/Acme.csproj": SRC_CSPROJ,
    "/repo/Acme/Gaps/Analysis.cs": "namespace Acme.Gaps;\n\npublic static class Analysis { }",
    "/repo/Acme.Tests/Acme.Tests.csproj": TEST_CSPROJ,
    ...(extra.contents ?? {}),
  };
  const dirs = {
    "/repo": ["Acme", "Acme.Tests", ...(extra.repoEntries ?? [])],
    "/repo/Acme": ["Acme.csproj", "Gaps"],
    "/repo/Acme/Gaps": ["Analysis.cs"],
    "/repo/Acme.Tests": ["Acme.Tests.csproj"],
    "/": ["repo"],
    ...(extra.dirs ?? {}),
  };
  return deps(files, contents, dirs);
}

test("placement mirrors the source folder and declares the mirrored namespace", () => {
  const r = cs().placementFor("/repo/Acme/Gaps/Analysis.cs", "Overlaps", solutionDeps());
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.placement.targetPath, path.normalize("/repo/Acme.Tests/Gaps/AnalysisTests.cs"));
  assert.strictEqual(r.placement.mode, "project-file");
  assert.strictEqual(r.placement.packageName, "Acme.Tests.Gaps");
  assert.strictEqual(r.placement.importLine, "using Acme.Gaps;");
  assert.strictEqual(r.placement.frameworkId, "mstest");
  assert.strictEqual(r.placement.frameworkImportLine, "using Microsoft.VisualStudio.TestTools.UnitTesting;");
});

test("runRoot is the TEST project, never the source project", () => {
  const r = cs().placementFor("/repo/Acme/Gaps/Analysis.cs", "Overlaps", solutionDeps());
  assert.strictEqual(r.placement.runRoot, path.normalize("/repo/Acme.Tests"));
  assert.notStrictEqual(r.placement.runRoot, path.normalize("/repo/Acme"));
  assert.strictEqual(r.placement.packageArg, "Acme.Tests.csproj");
});

test("a root-level source file needs no using, because lookup walks the enclosing namespaces", () => {
  const d = solutionDeps({
    files: ["/repo/Acme/Top.cs"],
    contents: { "/repo/Acme/Top.cs": "namespace Acme;\npublic static class Top { }" },
    dirs: { "/repo/Acme": ["Acme.csproj", "Gaps", "Top.cs"] },
  });
  const r = cs().placementFor("/repo/Acme/Top.cs", "Widen", d);
  assert.strictEqual(r.placement.packageName, "Acme.Tests");
  assert.strictEqual(r.placement.importLine, undefined, "Acme.Tests already sees Acme");
});

test("a `global using` in the test project makes the per-file framework using redundant", () => {
  const d = solutionDeps({
    files: ["/repo/Acme.Tests/GlobalUsings.cs"],
    contents: { "/repo/Acme.Tests/GlobalUsings.cs": "global using Microsoft.VisualStudio.TestTools.UnitTesting;\n" },
    dirs: { "/repo/Acme.Tests": ["Acme.Tests.csproj", "GlobalUsings.cs"] },
  });
  const r = cs().placementFor("/repo/Acme/Gaps/Analysis.cs", "Overlaps", d);
  assert.strictEqual(r.placement.frameworkImportLine, undefined);
  // And frameworkId still says which framework it is, which is exactly why
  // Amendment 8d added it: the class attribute must still be `[TestClass]`.
  assert.strictEqual(r.placement.frameworkId, "mstest");
});

test("no test project: refuse and name what was looked for", () => {
  const d = deps(
    ["/repo/Acme/Acme.csproj", "/repo/Acme/Gaps/Analysis.cs"],
    { "/repo/Acme/Acme.csproj": SRC_CSPROJ },
    { "/repo": ["Acme"], "/repo/Acme": ["Acme.csproj", "Gaps"], "/repo/Acme/Gaps": ["Analysis.cs"], "/": ["repo"] },
  );
  const r = cs().placementFor("/repo/Acme/Gaps/Analysis.cs", "Overlaps", d);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.refusal.reason, "no-test-project");
  assert.match(r.refusal.detail, /IsTestProject/);
  assert.match(r.refusal.detail, /Microsoft\.NET\.Test\.Sdk/);
  assert.match(r.refusal.detail, /ProjectReference/);
  assert.match(r.refusal.detail, /Acme\.Tests/, "names the project the human would create");
});

test("an MSBuild variable in a ProjectReference path is NAMED, not answered with a project the human already has", () => {
  // Nothing here evaluates MSBuild, so `..\$(SrcDir)\Acme.csproj` makes the test
  // project invisible. Refusing is right. Telling the human to create
  // `Acme.Tests` when `Acme.Tests` is sitting there referencing the source is
  // the unactionable half, which is the class Amendment 5 exists for.
  const d = solutionDeps({
    contents: {
      "/repo/Acme.Tests/Acme.Tests.csproj": TEST_CSPROJ.replace("..\\Acme\\Acme.csproj", "..\\$(SrcDir)\\Acme.csproj"),
    },
  });
  const r = cs().placementFor("/repo/Acme/Gaps/Analysis.cs", "Overlaps", d);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.refusal.reason, "no-test-project");
  assert.match(r.refusal.detail, /Acme\.Tests\.csproj/);
  assert.match(r.refusal.detail, /\$\(SrcDir\)/, "the unresolved path itself, or the human cannot find it");
  assert.match(r.refusal.detail, /MSBuild variable/);
  assert.doesNotMatch(r.refusal.detail, /create a `Acme\.Tests` project yourself/);
});

test("two candidate test projects and no `<Source>.Tests`: ambiguous-test-project, naming both", () => {
  const other = TEST_CSPROJ.replace("Acme.Tests", "Other.Tests");
  const d = solutionDeps({
    files: ["/repo/Alpha.Tests/Alpha.Tests.csproj", "/repo/Beta.Tests/Beta.Tests.csproj"],
    contents: {
      "/repo/Alpha.Tests/Alpha.Tests.csproj": other,
      "/repo/Beta.Tests/Beta.Tests.csproj": other,
      "/repo/Acme.Tests/Acme.Tests.csproj": SRC_CSPROJ,
    },
    repoEntries: ["Alpha.Tests", "Beta.Tests"],
    dirs: { "/repo/Alpha.Tests": ["Alpha.Tests.csproj"], "/repo/Beta.Tests": ["Beta.Tests.csproj"] },
  });
  const r = cs().placementFor("/repo/Acme/Gaps/Analysis.cs", "Overlaps", d);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.refusal.reason, "ambiguous-test-project");
  assert.match(r.refusal.detail, /Alpha\.Tests\.csproj/);
  assert.match(r.refusal.detail, /Beta\.Tests\.csproj/);
});

test("`<Source>.Tests` breaks a tie rather than refusing", () => {
  const other = TEST_CSPROJ.replace("Acme.Tests", "Other.Tests");
  const d = solutionDeps({
    files: ["/repo/Alpha.Tests/Alpha.Tests.csproj"],
    contents: { "/repo/Alpha.Tests/Alpha.Tests.csproj": other },
    repoEntries: ["Alpha.Tests"],
    dirs: { "/repo/Alpha.Tests": ["Alpha.Tests.csproj"] },
  });
  const r = cs().placementFor("/repo/Acme/Gaps/Analysis.cs", "Overlaps", d);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.placement.runRoot, path.normalize("/repo/Acme.Tests"));
});

test("EnableMSTestRunner is detected and refused BY NAME, not served a second command path", () => {
  const d = solutionDeps({
    contents: {
      "/repo/Acme.Tests/Acme.Tests.csproj": TEST_CSPROJ.replace(
        "<IsTestProject>true</IsTestProject>",
        "<IsTestProject>true</IsTestProject><EnableMSTestRunner>true</EnableMSTestRunner>",
      ),
    },
  });
  const r = cs().placementFor("/repo/Acme/Gaps/Analysis.cs", "Overlaps", d);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.refusal.reason, "unsupported-runner");
  assert.match(r.refusal.detail, /EnableMSTestRunner/);
  assert.match(r.refusal.detail, /Microsoft\.Testing\.Platform/);
});

test("`Microsoft.NET.Test.Sdk` alone is enough to be a test project", () => {
  const d = solutionDeps({
    contents: {
      "/repo/Acme.Tests/Acme.Tests.csproj": TEST_CSPROJ.replace("<IsTestProject>true</IsTestProject>", ""),
    },
  });
  const r = cs().placementFor("/repo/Acme/Gaps/Analysis.cs", "Overlaps", d);
  assert.strictEqual(r.ok, false, "MSTest.TestFramework alone is not the Test.Sdk marker");
  const d2 = solutionDeps({
    contents: {
      "/repo/Acme.Tests/Acme.Tests.csproj": TEST_CSPROJ
        .replace("<IsTestProject>true</IsTestProject>", "")
        .replace("MSTest.TestFramework", "Microsoft.NET.Test.Sdk"),
    },
  });
  assert.strictEqual(cs().placementFor("/repo/Acme/Gaps/Analysis.cs", "Overlaps", d2).ok, true);
});

test("a project with no test framework declared reaches frameworkFor, which names all three", () => {
  const d = solutionDeps({
    contents: {
      "/repo/Acme.Tests/Acme.Tests.csproj": TEST_CSPROJ.replace(/<PackageReference[^/]*\/>/, "<PackageReference Include=\"Microsoft.NET.Test.Sdk\" />"),
    },
  });
  const r = cs().placementFor("/repo/Acme/Gaps/Analysis.cs", "Overlaps", d);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.placement.frameworkId, undefined);
  const fw = frameworkFor(cs(), r.placement.runRoot, d);
  assert.strictEqual(fw.ok, false);
  assert.deepStrictEqual(fw.lookedFor, ["MSTest (dotnet test)", "xUnit (dotnet test)", "NUnit (dotnet test)"]);
  assert.match(fw.detail, /Acme\.Tests is a test project but declares no test framework/, "Amendment 8b");
  assert.match(fw.detail, /never installs a package/);
  // And the four legs that shipped before Amendment 8b keep their EXACT failure
  // object: the key is absent, not present-and-undefined.
  const ts = frameworkFor(tddLangFor("typescript"), "/nowhere", deps([], {}, {}));
  assert.deepStrictEqual(Object.keys(ts).sort(), ["lookedFor", "ok"]);
});

test("xUnit and NUnit detect from their own package references", () => {
  for (const [pkg, id] of [["xunit.v3", "xunit"], ["NUnit", "nunit"]]) {
    const d = solutionDeps({
      contents: { "/repo/Acme.Tests/Acme.Tests.csproj": TEST_CSPROJ.replace("MSTest.TestFramework", pkg) },
    });
    assert.strictEqual(cs().placementFor("/repo/Acme/Gaps/Analysis.cs", "X", d).placement.frameworkId, id, pkg);
  }
});

test("csNamespaceOf reads a declaration and not a mention of one", () => {
  assert.strictEqual(csNamespaceOf("namespace A.B;\nclass C {}"), "A.B");
  assert.strictEqual(csNamespaceOf("namespace A.B\n{\n  class C {}\n}"), "A.B");
  assert.strictEqual(csNamespaceOf('/// Put it in `namespace Wrong;`\nnamespace Right;'), "Right");
  assert.strictEqual(csNamespaceOf('var s = @"namespace Wrong;";\nnamespace Right;'), "Right");
  assert.strictEqual(csNamespaceOf("class C {}"), undefined);
});

// ===========================================================================
// 10. The scaffold
// ===========================================================================

const scaffoldInput = (over = {}) => ({
  existingText: "",
  generatedTests: "[TestMethod]\npublic void AnalysisHappy()\n{\n    Assert.AreEqual(7, Overlaps(3));\n}",
  markerId: "m1",
  placement: fakePlacement(),
  ...over,
});

test("a new file gets the usings, the namespace, the class and the marked region", () => {
  const plan = cs().scaffold(
    scaffoldInput({
      placement: fakePlacement({
        importLine: "using Acme.Gaps;",
        frameworkImportLine: "using Microsoft.VisualStudio.TestTools.UnitTesting;",
      }),
    }),
  );
  assert.strictEqual(plan.mode, "new-module");
  assert.deepStrictEqual([plan.start, plan.end], [0, 0]);
  assert.match(plan.text, /^using Microsoft\.VisualStudio\.TestTools\.UnitTesting;\nusing Acme\.Gaps;\n\nnamespace Acme\.Tests\.Gaps;\n\n\[TestClass\]\npublic class AnalysisTests\n\{/);
  assert.match(plan.text, /column80-tests:m1:begin/);
  assert.match(plan.text, /column80-tests:m1:end/);
  assert.ok(plan.text.trimEnd().endsWith("}"), "the class body closes");
});

test("the class attribute comes from frameworkId, even when the using is absent (Amendment 8d)", () => {
  const mstest = cs().scaffold(scaffoldInput({ placement: fakePlacement({ frameworkId: "mstest" }) }));
  assert.match(mstest.text, /\[TestClass\]\npublic class AnalysisTests/);
  const xunit = cs().scaffold(scaffoldInput({ placement: fakePlacement({ frameworkId: "xunit" }) }));
  assert.match(xunit.text, /\npublic class AnalysisTests/);
  assert.ok(!xunit.text.includes("[TestClass]"), "xUnit has no class attribute");
  const nunit = cs().scaffold(scaffoldInput({ placement: fakePlacement({ frameworkId: "nunit" }) }));
  assert.match(nunit.text, /\[TestFixture\]\npublic class AnalysisTests/);
});

test("regenerating replaces exactly the marked region and touches nothing else", () => {
  const first = cs().scaffold(scaffoldInput()).text;
  const plan = cs().scaffold(scaffoldInput({ existingText: first, generatedTests: "[TestMethod]\npublic void AnalysisZero()\n{\n}" }));
  assert.strictEqual(plan.mode, "replace-generated");
  const after = first.slice(0, plan.start) + plan.text + first.slice(plan.end);
  assert.match(after, /AnalysisZero/);
  assert.ok(!after.includes("AnalysisHappy"));
  assert.match(after, /\[TestClass\]\npublic class AnalysisTests/, "the class survives");
  assert.strictEqual((after.match(/column80-tests:m1:begin/g) ?? []).length, 1);
});

test("an existing file is extended INSIDE the class, because a test method cannot sit at file scope", () => {
  const existing = [
    "using Microsoft.VisualStudio.TestTools.UnitTesting;",
    "using Acme.Gaps;",
    "",
    "namespace Acme.Tests.Gaps;",
    "",
    "[TestClass]",
    "public class AnalysisTests",
    "{",
    "    [TestMethod]",
    "    public void MyOwnTest()",
    "    {",
    "    }",
    "}",
    "",
  ].join("\n");
  const plan = cs().scaffold(
    scaffoldInput({
      existingText: existing,
      placement: fakePlacement({ importLine: "using Acme.Gaps;", frameworkImportLine: "using Microsoft.VisualStudio.TestTools.UnitTesting;" }),
    }),
  );
  assert.strictEqual(plan.mode, "extend-existing");
  assert.strictEqual(plan.start, plan.end, "a narrow insertion, not a whole-file rewrite");
  const after = existing.slice(0, plan.start) + plan.text + existing.slice(plan.end);
  assert.match(after, /MyOwnTest/, "the developer's own test survives");
  const marker = after.indexOf("column80-tests:m1:begin");
  assert.ok(marker !== -1 && marker < after.lastIndexOf("}"), "the region is INSIDE the class");
  // And the result is still balanced C#.
  assert.strictEqual((after.match(/\{/g) ?? []).length, (after.match(/\}/g) ?? []).length);
});

test("adding a using forces a whole-file span, and phase 4's tell distinguishes it", () => {
  const existing = "namespace Acme.Tests.Gaps;\n\n[TestClass]\npublic class AnalysisTests\n{\n}\n";
  const plan = cs().scaffold(
    scaffoldInput({
      existingText: existing,
      placement: fakePlacement({ importLine: "using Acme.Gaps;", frameworkImportLine: "using Microsoft.VisualStudio.TestTools.UnitTesting;" }),
    }),
  );
  assert.strictEqual(plan.mode, "extend-existing");
  // `start === 0 && end === existingText.length` over a NON-EMPTY file. The
  // narrow branch above can never produce it, so phase 6 can tell them apart
  // without a new mode string.
  assert.deepStrictEqual([plan.start, plan.end], [0, existing.length]);
  assert.ok(existing.length > 0);
  assert.match(plan.text, /^using Microsoft\.VisualStudio\.TestTools\.UnitTesting;\nusing Acme\.Gaps;\n\nnamespace/);
  assert.ok(plan.text.indexOf("column80-tests:m1:begin") < plan.text.lastIndexOf("}"));
});

test("a using already present is not added twice, whether per-file or global", () => {
  for (const head of ["using Acme.Gaps;\n", "global using Acme.Gaps;\n", "global using global::Acme.Gaps;\n"]) {
    const existing = `${head}\nnamespace Acme.Tests.Gaps;\n\n[TestClass]\npublic class AnalysisTests\n{\n}\n`;
    const plan = cs().scaffold(scaffoldInput({ existingText: existing, placement: fakePlacement({ importLine: "using Acme.Gaps;" }) }));
    assert.strictEqual(plan.start, plan.end, head);
  }
});

test("a `using` shown inside a doc comment or a string is NOT a directive", () => {
  // The bad direction, and the reason this walks the literal-aware scanner:
  // reading the comment as a directive DROPS a using the generated file needs,
  // and the human gets a compile error they did not cause.
  const existing = [
    "/// Callers write `using Acme.Gaps;` first.",
    'const string Doc = @"using Acme.Gaps;";',
    "namespace Acme.Tests.Gaps;",
    "",
    "[TestClass]",
    "public class AnalysisTests",
    "{",
    "}",
    "",
  ].join("\n");
  const plan = cs().scaffold(scaffoldInput({ existingText: existing, placement: fakePlacement({ importLine: "using Acme.Gaps;" }) }));
  assert.deepStrictEqual([plan.start, plan.end], [0, existing.length], "the using really was missing");
  assert.match(plan.text, /^using Acme\.Gaps;\n/);
});

test("a file with no class at all gets a whole test class appended, not an orphan method", () => {
  const existing = "namespace Acme.Tests.Gaps;\n";
  const plan = cs().scaffold(scaffoldInput({ existingText: existing }));
  const after = existing.slice(0, plan.start) + plan.text + existing.slice(plan.end);
  assert.match(after, /\[TestClass\]\npublic class AnalysisTests\n\{/);
  assert.ok(after.indexOf("column80-tests:m1:begin") < after.lastIndexOf("}"));
});

test("a class name spelled inside a string does not become the host class", () => {
  const existing = [
    "namespace Acme.Tests.Gaps;",
    "",
    "[TestClass]",
    "public class AnalysisTests",
    "{",
    '    const string Sample = @"public class Decoy { }";',
    "}",
    "",
  ].join("\n");
  const plan = cs().scaffold(scaffoldInput({ existingText: existing }));
  const after = existing.slice(0, plan.start) + plan.text + existing.slice(plan.end);
  assert.strictEqual((after.match(/column80-tests:m1:begin/g) ?? []).length, 1);
  assert.match(after, /Decoy/, "the string is untouched");
  assert.strictEqual((after.match(/\{/g) ?? []).length, (after.match(/\}/g) ?? []).length);
});

// ===========================================================================
// 11. generatedTestNames
// ===========================================================================

test("generatedTestNames reads method DECLARATIONS, never a call or a name inside a literal", () => {
  const file = cs().scaffold(
    scaffoldInput({
      generatedTests: [
        "[TestMethod]",
        "public void AnalysisHappy()",
        "{",
        '    var label = "public void PhantomFromAString()";',
        '    var v = @"public void PhantomFromVerbatim()";',
        "    // public void PhantomFromAComment()",
        "    Assert.AreEqual(7, Overlaps(3));",
        "}",
        "",
        "[TestMethod]",
        "public void AnalysisZero()",
        "{",
        "    void LocalHelper() { }",
        "    LocalHelper();",
        "}",
      ].join("\n"),
    }),
  ).text;
  // Item 59: fully qualified, because `FullyQualifiedName=` matches the whole
  // name and nothing less. A bare `Add` also selected `AddMore`; a bare name
  // under `=` selects nothing at all, measured on dotnet 10.0.111.
  assert.deepStrictEqual(cs().generatedTestNames(file, "m1"), ["Acme.Tests.Gaps.AnalysisTests.AnalysisHappy", "Acme.Tests.Gaps.AnalysisTests.AnalysisZero"]);
});

test("generatedTestNames is scoped to ITS marker and answers [] when there is none", () => {
  const a = cs().scaffold(scaffoldInput()).text;
  const b = cs().scaffold(scaffoldInput({ existingText: a, markerId: "m2", generatedTests: "[TestMethod]\npublic void Other()\n{\n}" }));
  const after = a.slice(0, b.start) + b.text + a.slice(b.end);
  assert.deepStrictEqual(cs().generatedTestNames(after, "m1"), ["Acme.Tests.Gaps.AnalysisTests.AnalysisHappy"]);
  assert.deepStrictEqual(cs().generatedTestNames(after, "m2"), ["Acme.Tests.Gaps.AnalysisTests.Other"]);
  assert.deepStrictEqual(cs().generatedTestNames(after, "nope"), []);
  assert.deepStrictEqual(cs().generatedTestNames("", "m1"), []);
});

test("the command's filter is built from exactly those names", () => {
  const file = cs().scaffold(scaffoldInput()).text;
  const names = cs().generatedTestNames(file, "m1");
  const cmd = MSTEST.buildCommand(fakePlacement(), names);
  // `=` and the resolved name land together or neither lands: `=AnalysisHappy`
  // against a bare name matches NOTHING, which reads as a passing rung with no
  // test in it.
  assert.strictEqual(cmd.args[cmd.args.indexOf("--filter") + 1], "FullyQualifiedName=Acme.Tests.Gaps.AnalysisTests.AnalysisHappy");
});

// ===========================================================================
// 12. The registry
// ===========================================================================

test("csharp is registered and the other four are untouched", () => {
  assert.strictEqual(cs().languageId, "csharp");
  assert.strictEqual(cs().displayName, "C#");
  assert.strictEqual(cs().markerPrefix, "//");
  assert.strictEqual(cs().testNameIsValid, undefined, "MSTest collects by attribute, not by name");
  assert.deepStrictEqual(cs().frameworks.map((f) => f.id), ["mstest", "xunit", "nunit"]);
  for (const id of ["rust", "go", "typescript", "typescriptreact", "javascript", "javascriptreact", "python"]) {
    assert.ok(tddLangFor(id) !== undefined, id);
  }
  assert.strictEqual(tddLangFor("ruby"), undefined);
});

// ===========================================================================
// 13. The REAL corpus
// ===========================================================================

test(
  "the real Contoso solution: the test project is found and runRoot is ITS directory",
  { skip: noCorpus },
  () => {
    const source = path.join(corpus, "Contoso.ProcessingLogic", "Service", "DpmInterpolation.cs");
    const r = cs().placementFor(source, "Interpolate", REAL_TDD_DEPS);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.placement.runRoot, TEST_PROJECT);
    assert.notStrictEqual(r.placement.runRoot, path.join(corpus, "Contoso.ProcessingLogic"));
    assert.strictEqual(r.placement.targetPath, path.join(TEST_PROJECT, "Service", "DpmInterpolationTests.cs"));
    assert.strictEqual(r.placement.packageName, "Contoso.ProcessingLogic.Tests.Service");
    assert.strictEqual(r.placement.importLine, "using Contoso.ProcessingLogic.Service;");
    assert.strictEqual(r.placement.frameworkId, "mstest");
    // GlobalUsings.cs carries the framework using, so the per-file one is
    // redundant. This is the case Amendment 8d exists for.
    assert.strictEqual(r.placement.frameworkImportLine, undefined);
    assert.strictEqual(r.placement.packageArg, "Contoso.ProcessingLogic.Tests.csproj");
  },
);

test(
  "the ONE-TO-MANY case: one test project serves three source projects",
  { skip: noCorpus },
  () => {
    // Contoso.ProcessingLogic.Tests references Contoso.DataModel,
    // Contoso.ProcessingLogic AND Contoso.Portal.Api. A file in any of them
    // resolves to the same test project, and none of them is `<Source>.Tests`.
    for (const project of ["Contoso.DataModel", "Contoso.ProcessingLogic", "Contoso.Portal.Api"]) {
      const r = cs().placementFor(path.join(corpus, project, "Anything.cs"), "F", REAL_TDD_DEPS);
      assert.strictEqual(r.ok, true, project);
      assert.strictEqual(r.placement.runRoot, TEST_PROJECT, project);
    }
    // And a project NO test project references is refused, not guessed at.
    const orphan = cs().placementFor(path.join(corpus, "Contoso.LocalDb", "Program.cs"), "Main", REAL_TDD_DEPS);
    assert.strictEqual(orphan.ok, false);
    assert.strictEqual(orphan.refusal.reason, "no-test-project");
    assert.match(orphan.refusal.detail, /Contoso\.LocalDb\.Tests/);
  },
);

test(
  "InternalsVisibleTo appears NOWHERE in the corpus, so the visibility rule stands unmodified",
  { skip: noCorpus },
  () => {
    for (const project of ["Contoso.DataModel", "Contoso.ProcessingLogic", "Contoso.Portal.Api"]) {
      assert.strictEqual(csInternalsVisibleTo(path.join(corpus, project), REAL_TDD_DEPS), false, project);
    }
  },
);

test("InternalsVisibleTo answers on the grant's ARGUMENT, in every spelling a project uses", () => {
  // The presence of the word grants nothing. A project opens its internals to a
  // named assembly, and a grant naming a benchmark harness read as a grant to
  // the test project makes the classifier call an `internal static` method
  // testable and hand the human a CS0122 they did not cause.
  const project = (body) => `<Project Sdk="Microsoft.NET.Sdk">${body}</Project>`;
  const at = (files, dirs) => (dir, name) => csInternalsVisibleTo(dir, deps(Object.keys(files), files, dirs), name);

  const item = at(
    { "/p/P.csproj": project('<ItemGroup><InternalsVisibleTo Include="Acme.Tests" /></ItemGroup>') },
    { "/p": ["P.csproj"] },
  );
  assert.strictEqual(item("/p", "Acme.Tests"), true, "the MSBuild item SDK 8+ supports");
  assert.strictEqual(item("/p", "Acme.Benchmarks"), false, "a grant to someone else is not a grant to you");
  assert.strictEqual(item("/p", undefined), false, "no assembly to match means not visible, the safe default");

  const attribute = at(
    {
      "/p/P.csproj": project(
        '<ItemGroup><AssemblyAttribute Include="System.Runtime.CompilerServices.InternalsVisibleTo">' +
          "<_Parameter1>Acme.Tests</_Parameter1></AssemblyAttribute></ItemGroup>",
      ),
    },
    { "/p": ["P.csproj"] },
  );
  assert.strictEqual(attribute("/p", "Acme.Tests"), true, "the raw AssemblyAttribute escape hatch");
  assert.strictEqual(attribute("/p", "Other"), false);

  // A strong-named grant carries its public key after a comma; the assembly NAME
  // is the part in front of it.
  const signed = at(
    {
      "/p/Properties/AssemblyInfo.cs": '[assembly: InternalsVisibleTo("Acme.Tests, PublicKey=0024000004800000")]',
    },
    { "/p": ["Properties"], "/p/Properties": ["AssemblyInfo.cs"] },
  );
  assert.strictEqual(signed("/p", "Acme.Tests"), true);
  assert.strictEqual(signed("/p", "Acme"), false, "a prefix of the granted name is a different assembly");

  // Commented out is not granted, in either language's comment syntax.
  const xmlComment = at({ "/p/P.csproj": "<Project><!-- InternalsVisibleTo Acme.Tests, removed 2019 --></Project>" }, { "/p": ["P.csproj"] });
  assert.strictEqual(xmlComment("/p", "Acme.Tests"), false);
  const csComment = at(
    { "/p/AssemblyInfo.cs": '// [assembly: InternalsVisibleTo("Acme.Tests")]\n/* [assembly: InternalsVisibleTo("Acme.Tests")] */' },
    { "/p": ["AssemblyInfo.cs"] },
  );
  assert.strictEqual(csComment("/p", "Acme.Tests"), false);
  const live = at({ "/p/AssemblyInfo.cs": '// see the docs\n[assembly: InternalsVisibleTo("Acme.Tests")]' }, { "/p": ["AssemblyInfo.cs"] });
  assert.strictEqual(live("/p", "Acme.Tests"), true, "a comment ABOVE a live grant hides nothing");
});

test(
  "the classifier over the corpus: ZERO survivors, and the REASONS are the ones the scout measured",
  { skip: noCorpus },
  () => {
    const files = [];
    (function walk(dir) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (["bin", "obj", ".git"].includes(entry.name) || entry.name.endsWith(".Tests")) continue;
          walk(p);
        } else if (entry.name.endsWith(".cs")) {
          files.push(p);
        }
      }
    })(corpus);
    assert.ok(files.length > 100, `expected a real corpus, found ${files.length} files`);

    const reasons = {};
    const survivors = [];
    let total = 0;
    for (const file of files) {
      for (const { signature, doc } of declarationsIn(fs.readFileSync(file, "utf8"))) {
        const v = classifyCsTestability(signature, doc);
        total++;
        const key = v.testable ? "testable" : v.reason;
        reasons[key] = (reasons[key] ?? 0) + 1;
        if (v.testable) survivors.push(`${path.relative(corpus, file)}: ${signature}`);
      }
    }
    assert.ok(total > 200, `expected the corpus to yield methods, got ${total}`);
    // The human ruled all four languages ship exactly as specified (Amendment
    // 1). Zero is the measured answer and this pins it as a DELIBERATE state,
    // not a regression waiting to be "fixed" by relaxing a leg.
    assert.deepStrictEqual(survivors, [], "relaxing the classifier to manufacture survivors is the human's call");
    assert.strictEqual(reasons.testable, undefined);
    for (const reason of ["not-exported", "async", "needs-fixture", "underspecified"]) {
      assert.ok(reasons[reason] > 0, `${reason} should fire on a real service codebase`);
    }
  },
);

test(
  "the corpus's clearest blind-test targets are refused for exactly the reason the scout named",
  { skip: noCorpus },
  () => {
    const want = {
      // "only: private" — the roadmap item 13 answer, that the good targets in a
      // service codebase are the private helpers a test project cannot see.
      GapsOverlap: "not-exported",
      RemoveOverlappingGaps: "not-exported",
      // "only: no /// doc"
      IsSqlPoolNotWarmedException: "underspecified",
      CreateShiftSchedule: "underspecified",
      ToUnixTimeSeconds: "underspecified",
      GetMD5HashFromText: "underspecified",
    };
    const found = {};
    (function walk(dir) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (["bin", "obj", ".git"].includes(entry.name) || entry.name.endsWith(".Tests")) continue;
          walk(p);
        } else if (entry.name.endsWith(".cs")) {
          for (const d of declarationsIn(fs.readFileSync(p, "utf8"))) {
            if (want[d.name] !== undefined) {
              found[d.name] = classifyCsTestability(d.signature, d.doc);
            }
          }
        }
      }
    })(corpus);
    for (const [name, reason] of Object.entries(want)) {
      assert.ok(found[name] !== undefined, `${name} not found in the corpus`);
      assert.strictEqual(found[name].reason, reason, `${name}: ${found[name].detail ?? "TESTABLE"}`);
    }
    assert.match(found.GapsOverlap.detail, /Make it `public`/, "and the fix is one the human can perform");
  },
);

/** Method declarations in a C# file, with the `///` block above each. A test
 *  harness, deliberately simple: what it must not do is invent shapes, so it
 *  asks the PRODUCT's own csMethodHead which of them are methods. */
function declarationsIn(text) {
  const out = [];
  let i = 0;
  let depth = 0;
  let prev = "";
  while (i < text.length) {
    const c = text[i];
    if (c === "{") { depth++; prev = c; i++; continue; }
    if (c === "}") { depth--; prev = c; i++; continue; }
    if (c === "/" && text[i + 1] === "/") { const n = text.indexOf("\n", i); i = n === -1 ? text.length : n; continue; }
    if (c === "/" && text[i + 1] === "*") { const n = text.indexOf("*/", i); i = n === -1 ? text.length : n + 2; continue; }
    if (c === "@" && text[i + 1] === '"') {
      let j = i + 2;
      while (j < text.length) { if (text[j] === '"') { if (text[j + 1] === '"') { j += 2; continue; } break; } j++; }
      i = j + 1; prev = '"'; continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < text.length && text[j] !== c) { if (text[j] === "\\") j++; j++; }
      i = j + 1; prev = c; continue;
    }
    if (/\S/.test(c) && (prev === "{" || prev === "}" || prev === ";" || prev === "") && depth >= 1 && depth <= 3) {
      const head = csMethodHead(text, i);
      if (head !== undefined) {
        let d = 0;
        let close = -1;
        for (let k = head.paramsOpen; k < text.length; k++) {
          if (text[k] === "(") d++;
          else if (text[k] === ")") { d--; if (d === 0) { close = k; break; } }
        }
        const after = close === -1 ? "" : text.slice(close + 1, close + 12).trim();
        if (close !== -1 && (after.startsWith("{") || after.startsWith("=>") || after.startsWith(";") || after.startsWith("where"))) {
          out.push({ name: head.name, signature: text.slice(i, close + 1).replace(/\s+/g, " "), doc: docAbove(text, i) });
          i = close + 1;
          prev = ")";
          continue;
        }
      }
    }
    if (/\S/.test(c)) prev = c;
    i++;
  }
  return out;
}

function docAbove(text, at) {
  const lines = text.slice(0, at).split("\n");
  lines.pop();
  const doc = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    const t = lines[i].trim();
    if (t.startsWith("///")) { doc.unshift(t); continue; }
    if (t === "" || t.startsWith("[")) continue;
    break;
  }
  return doc.length === 0 ? undefined : doc.join("\n");
}

// ===========================================================================
// 14. A REAL `dotnet test`, through the product's own command and parse
// ===========================================================================

// DOTNET_ROLL_FORWARD is a MEASUREMENT tool and never the product's: Contoso
// targets net9.0 and this machine has 8.0.29 and 10.0.10. Injected by THIS
// spawner so the product's command builder stays the thing under test.
function spawner(extraEnv) {
  return (cmd) =>
    new Promise((resolve, reject) => {
      if (cmd.outputFile !== undefined) {
        try { fs.rmSync(cmd.outputFile, { force: true }); } catch { /* best effort */ }
      }
      const child = spawn(cmd.command, cmd.args, { cwd: cmd.cwd, env: { ...process.env, ...cmd.env, ...extraEnv } });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d) => (stdout += d));
      child.stderr.on("data", (d) => (stderr += d));
      child.on("error", reject);
      child.on("close", (code) => resolve({ stdout, stderr, exitCode: code ?? -1 }));
    });
}

test(
  "LIVE: a real `dotnet test` against Contoso, driven by the product's command and read by its parse",
  { skip: noCorpus || (process.env.SKIP_LIVE === "1" ? "SKIP_LIVE=1 (dotnet test builds four projects)" : false) },
  async (t) => {
    t.diagnostic("this builds the real solution and takes tens of seconds");
    const source = path.join(corpus, "Contoso.ProcessingLogic", "Service", "DpmInterpolation.cs");
    const placement = cs().placementFor(source, "Interpolate", REAL_TDD_DEPS).placement;
    const fw = frameworkFor(cs(), placement.runRoot, REAL_TDD_DEPS);
    assert.strictEqual(fw.ok, true);

    const roll = { DOTNET_ROLL_FORWARD: "Major" };
    const pass = await runFrameworkTestsAt(
      fw.framework,
      placement,
      ["LocationFactor_DoubleValue_RoundTripsThroughBuildDpmEvent", "LocationFactor_StickyFill_PreservesDoublePrecision"],
      { runCommand: spawner(roll) },
    );
    assert.strictEqual(pass.ran, true);
    assert.strictEqual(pass.success, true);
    assert.strictEqual(pass.passed, 2);
    assert.strictEqual(pass.casesComplete, true);

    const miss = await runFrameworkTestsAt(fw.framework, placement, ["ZZZNoSuchTestNameAtAll"], { runCommand: spawner(roll) });
    assert.strictEqual(miss.success, false, "exit 0 with nothing run is the silent false green this guards");
    assert.strictEqual(miss.filterMatchedNothing, true);
    assert.strictEqual(miss.buildError, undefined);

    // WITHOUT roll-forward, which is exactly how the product runs.
    const missingRuntime = await runFrameworkTestsAt(
      fw.framework,
      placement,
      ["LocationFactor_DoubleValue_RoundTripsThroughBuildDpmEvent"],
      { runCommand: spawner({}) },
    );
    assert.strictEqual(missingRuntime.ran, false);
    assert.strictEqual(missingRuntime.buildError, undefined, "not a compile error");
    assert.match(missingRuntime.environmentError, /You must install or update \.NET/);
  },
);
