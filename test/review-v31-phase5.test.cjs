// Adversarial review of session-v31 phase 5, the C# leg. Fresh eyes.
//
// Every DEFECT row below is a FAILING test with its actual output; every
// "verified" row is a negative result held as a passing test, so a later change
// that breaks the thing this review proved clean goes red rather than silent.
//
// Row titles carry their own verdict: DEFECT, RISK, NIT or VERIFIED.
//
// Run: SKIP_LIVE=1 node --test test/review-v31-phase5.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const esbuild = require("esbuild");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "review-v31-p5",
  `export { tddLangFor, frameworkFor, REAL_TDD_DEPS } from "../src/core/tddLang";\n` +
    `export { CS_TDD_LANG, MSTEST, XUNIT, NUNIT, CS_LITERALS, csReturnTypeOf, csMethodHead, classifyCsTestability, csInternalsVisibleTo, mstestExpectedValueSpans, xunitExpectedValueSpans, nunitExpectedValueSpans, parseTrx } from "../src/core/tddCs";\n` +
    `export { skipLiteralOrComment } from "../src/core/testAssembly";\n` +
    `export { runFrameworkTestsAt } from "../src/core/compilerOracle";\n`
);
const {
  tddLangFor,
  frameworkFor,
  REAL_TDD_DEPS,
  CS_LITERALS,
  csReturnTypeOf,
  csMethodHead,
  classifyCsTestability,
  csInternalsVisibleTo,
  mstestExpectedValueSpans,
  xunitExpectedValueSpans,
  nunitExpectedValueSpans,
  parseTrx,
  runFrameworkTestsAt,
} = mod;

test.after(cleanup);

const cs = () => tddLangFor("csharp");
const texts = (t, spans) => spans.map((s) => t.slice(s.start, s.end));

const CORPUS = path.join(os.homedir(), "work", "contoso", "data-processing", "dotnet");
const noCorpus = fs.existsSync(CORPUS) ? false : "the Contoso corpus is not on this machine";
const FIXTURES = path.join(__dirname, "fixtures", "csharp-trx");
const fixture = (n) => fs.readFileSync(path.join(FIXTURES, n), "utf8");

// ===========================================================================
// 1. The three locators
// ===========================================================================

test("DEFECT: `@$\"…\"` is not read as a VERBATIM string, so a trailing backslash swallows the rest of the module", () => {
  // C# accepts both orders of the two prefix characters: `$@\"…\"` and `@$\"…\"`
  // are the same literal. testAssembly.ts's own `dollarInterpolation` comment
  // claims both ("including `$@\"…\"` and `@$\"…\"`"), and skipLiteralOrComment
  // only reaches its verbatim branch when the `@` is the FIRST of the two.
  //
  // In a verbatim string a backslash is an ordinary character, so `@$\"C:\\\"`
  // ends at its closing quote. Read as an ordinary interpolated string the
  // `\\\"` is an escape, the literal never closes, and every LATER assertion in
  // the module is invisible to the locator: the model's guessed expected value
  // stays in the human's buffer unblanked. That is the blank-value invariant
  // inverted, in the direction goal.md item 6 calls a lie.
  const withDollarFirst = 'var p = $@"C:\\"; Assert.AreEqual(7, Widen(3));';
  const withAtFirst = 'var p = @$"C:\\"; Assert.AreEqual(7, Widen(3));';
  assert.deepStrictEqual(texts(withDollarFirst, mstestExpectedValueSpans(withDollarFirst)), ["7"], "$@ is fine");
  assert.deepStrictEqual(
    texts(withAtFirst, mstestExpectedValueSpans(withAtFirst)),
    ["7"],
    `@$ loses the span: got ${JSON.stringify(texts(withAtFirst, mstestExpectedValueSpans(withAtFirst)))}`,
  );
});

test("DEFECT: the same `@$\"…\"` misread makes the locator blank bytes INSIDE a genuine string literal", () => {
  // The other direction of the same root cause, and this one edits the
  // developer's own text. The unterminated literal ends at the next quote, so
  // what was really string CONTENT is scanned as code and matched.
  const text = 'var a = @$"C:\\"; var b = "Assert.AreEqual(9, Hack())"; Assert.AreEqual(2, G());';
  const spans = mstestExpectedValueSpans(text);
  const insideTheString = spans.filter((s) => s.start > text.indexOf('var b = "') && s.end < text.indexOf('"; Assert'));
  assert.deepStrictEqual(
    insideTheString,
    [],
    `a span landed inside a string literal: ${JSON.stringify(texts(text, spans))}`,
  );
});

test("DEFECT: and the zero-hole floor does not catch it, because ONE hole is still a hole", () => {
  // The floor in fnGen refuses a pass that produced NO holes. A module with
  // three assertions and one `@$"…\\"` string produces one hole and two of the
  // model's guessed expected values reach the human's buffer, which is the
  // exact outcome goal.md item 6 calls the product lying rather than breaking.
  const module = [
    "[TestMethod]",
    "public void WidenHappy() { Assert.AreEqual(7, Widen(3)); }",
    "[TestMethod]",
    'public void WidenPath() { var root = @$"C:\\"; Assert.AreEqual(9, Widen(root.Length)); }',
    "[TestMethod]",
    "public void WidenZero() { Assert.AreEqual(0, Widen(0)); }",
  ].join("\n");
  const spans = mstestExpectedValueSpans(module);
  assert.deepStrictEqual(
    texts(module, spans),
    ["7", "9", "0"],
    `${spans.length} of 3 expected values blanked, so the floor stays quiet and the rest ship as the model guessed them`,
  );
});

test("DEFECT: the `@$\"…\"` misread reaches `generatedTestNames` too, and silently shortens the filter", () => {
  // Blast radius: everything in this leg walks the same scanner, so the
  // unterminated literal also hides a generated test method from
  // `generatedTestNames`. The rung then filters on a SUBSET of the tests it just
  // wrote, and the tests it dropped are never run or reported.
  const region = (body) => `public class T\n{\n    // column80-tests:m1:begin\n${body}\n    // column80-tests:m1:end\n}`;
  const body = (prefix) =>
    `    [TestMethod]\n    public void A() { var p = ${prefix}"C:\\"; }\n    [TestMethod]\n    public void B() { }`;
  assert.deepStrictEqual(cs().generatedTestNames(region(body('$@')), "m1"), ["A", "B"], "$@ is fine");
  assert.deepStrictEqual(cs().generatedTestNames(region(body('@$')), "m1"), ["A", "B"]);
});

test("VERIFIED: the inversion holds, and the message, generic arguments and one-argument overloads are safe", () => {
  const t1 = "Assert.AreEqual(7, AggregateFanout(3));";
  assert.deepStrictEqual(texts(t1, mstestExpectedValueSpans(t1)), ["7"]);
  assert.notDeepStrictEqual(texts(t1, mstestExpectedValueSpans(t1)), ["AggregateFanout(3)"]);
  const t2 = 'Assert.AreEqual(7, x, "the message");';
  assert.deepStrictEqual(texts(t2, mstestExpectedValueSpans(t2)), ["7"], "the message must never be blanked");
  const t3 = "Assert.AreEqual<int>(7, x); Assert.AreEqual<List<int>>(new List<int> { 1 }, y);";
  assert.deepStrictEqual(texts(t3, mstestExpectedValueSpans(t3)), ["7", "new List<int> { 1 }"]);
  for (const one of ["Assert.IsTrue(x);", "Assert.IsNull(x);", "Assert.AreEqual(x);"]) {
    assert.deepStrictEqual(mstestExpectedValueSpans(one), [], one);
  }
  // xUnit and MSTest in the same file never poach each other's calls.
  const mixed = "Assert.Equal(7, X()); Assert.AreEqual(8, Y());";
  assert.deepStrictEqual(texts(mixed, xunitExpectedValueSpans(mixed)), ["7"]);
  assert.deepStrictEqual(texts(mixed, mstestExpectedValueSpans(mixed)), ["8"]);
  // A qualified call still matches; a DIFFERENT Assert class does not.
  const qualified = "Microsoft.VisualStudio.TestTools.UnitTesting.Assert.AreEqual(7, X());";
  assert.deepStrictEqual(texts(qualified, mstestExpectedValueSpans(qualified)), ["7"]);
  assert.deepStrictEqual(mstestExpectedValueSpans("MyAssert.AreEqual(7, X());"), []);
});

test("VERIFIED: NUnit takes the argument of Is.EqualTo, through a chained constraint and a nested call", () => {
  const chained = "Assert.That(x, Is.EqualTo(7).Within(0.01));";
  assert.deepStrictEqual(texts(chained, nunitExpectedValueSpans(chained)), ["7"]);
  const nested = "Assert.That(Compute(a), Is.EqualTo(Compute(b)));";
  assert.deepStrictEqual(texts(nested, nunitExpectedValueSpans(nested)), ["Compute(b)"]);
  const withMessage = 'Assert.That(x, Is.EqualTo(7), "msg");';
  assert.deepStrictEqual(texts(withMessage, nunitExpectedValueSpans(withMessage)), ["7"]);
  // Fail open rather than blank something that is not an expected value.
  for (const open of ["Assert.That(x, Is.Null);", "Assert.That(x, Is.GreaterThan(0));", "Assert.That(x, Has.Count.EqualTo(3));"]) {
    assert.deepStrictEqual(nunitExpectedValueSpans(open), [], open);
  }
});

test("NIT: `Is.Not.EqualTo(…)` yields no span, so a negative NUnit assertion keeps the model's guess", () => {
  // Fail-open, and the zero-hole floor in fnGen only fires when the WHOLE pass
  // produced no holes, so a module mixing `Is.EqualTo` and `Is.Not.EqualTo`
  // reaches the human with one guessed value still in it. Same class as the
  // deferred per-assertion floor (scraps.md D5); recorded, not fixed here.
  const t = "Assert.That(x, Is.Not.EqualTo(7));";
  assert.deepStrictEqual(nunitExpectedValueSpans(t), []);
});

test("VERIFIED: the rest of the C# string zoo and comments are opaque to all three locators", () => {
  const cases = [
    'var s = @"a ""Assert.AreEqual(1, F())"" b"; Assert.AreEqual(2, G());',
    'var s = $@"a ""Assert.AreEqual(1, F())"" b"; Assert.AreEqual(2, G());',
    'var s = """ Assert.AreEqual(1, F()) """; Assert.AreEqual(2, G());',
    'var s = """"a """ Assert.AreEqual(1, F()) """ b""""; Assert.AreEqual(2, G());',
    'var s = $"{Foo("a")} Assert.AreEqual(1, F())"; Assert.AreEqual(2, G());',
    'var s = $"{d["k"]}"; Assert.AreEqual(2, G());',
    "// Assert.AreEqual(1, F());\nAssert.AreEqual(2, G());",
    "/* Assert.AreEqual(1, F()); /* still open in C# */ Assert.AreEqual(2, G());",
    "/// <summary>Assert.AreEqual(1, F())</summary>\nAssert.AreEqual(2, G());",
    "var c = '\"'; Assert.AreEqual(2, G());",
  ];
  for (const t of cases) {
    assert.deepStrictEqual(texts(t, mstestExpectedValueSpans(t)), ["2"], t);
  }
});

test("VERIFIED: spans stay ascending, non-overlapping and in bounds over a 20k-case fuzz", () => {
  const locators = [
    ["mstest", mstestExpectedValueSpans],
    ["xunit", xunitExpectedValueSpans],
    ["nunit", nunitExpectedValueSpans],
  ];
  const frag = [
    "Assert.AreEqual(", "Assert.Equal(", "Assert.That(", "Is.EqualTo(", ")", ",", '"', '@"', '"""', '$"',
    "{", "}", "//x\n", "/*", "*/", "\\", "7", "x", "F(3)", " ", ";", "\n", "'a'", '$@"', '@$"', "[TestMethod]", "(",
  ];
  let seed = 7;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let k = 0; k < 20000; k++) {
    let t = "";
    const len = 2 + Math.floor(rand() * 18);
    for (let j = 0; j < len; j++) {
      t += frag[Math.floor(rand() * frag.length)];
    }
    for (const [name, f] of locators) {
      const spans = f(t);
      let prev = -1;
      for (const s of spans) {
        assert.ok(s.start >= 0 && s.end <= t.length && s.start <= s.end, `${name} out of bounds on ${JSON.stringify(t)}`);
        assert.ok(s.start >= prev, `${name} overlapping/descending on ${JSON.stringify(t)}: ${JSON.stringify(spans)}`);
        prev = s.end;
      }
    }
  }
  // And a nested assert in the expected position is taken WHOLE, never twice.
  const nested = "Assert.AreEqual(Assert.AreEqual(1, 2), x);";
  assert.deepStrictEqual(texts(nested, mstestExpectedValueSpans(nested)), ["Assert.AreEqual(1, 2)"]);
});

// ===========================================================================
// 2. The four no-run outcomes
// ===========================================================================

/** Exactly one of the three no-run fields, or none when the run really ran. */
function outcomeFieldsOf(parse) {
  return [
    parse.filterMatchedNothing === true ? "filterMatchedNothing" : undefined,
    parse.environmentError !== undefined ? "environmentError" : undefined,
    parse.buildError !== undefined ? "buildError" : undefined,
  ].filter((f) => f !== undefined);
}

test("VERIFIED: the four outcomes each set exactly ONE field, and the missing runtime is checked before the filter miss", () => {
  const miss = parseTrx(fixture("filter-miss.trx"), "", 0);
  assert.deepStrictEqual(outcomeFieldsOf(miss), ["filterMatchedNothing"]);
  const missing = parseTrx(fixture("missing-runtime.trx"), fixture("missing-runtime.stderr.txt"), 1);
  assert.deepStrictEqual(outcomeFieldsOf(missing), ["environmentError"], "never a filter miss, never a compile error");
  assert.match(missing.environmentError, /You must install or update \.NET/);
  const build = parseTrx(fixture("compile-failure.stdout.txt"), "", 1);
  assert.deepStrictEqual(outcomeFieldsOf(build), ["buildError"]);
  const failed = parseTrx(fixture("fail.trx"), "", 1);
  assert.deepStrictEqual(outcomeFieldsOf(failed), [], "a normal red names no no-run reason");
  const passed = parseTrx(fixture("pass.trx"), "", 0);
  assert.deepStrictEqual(outcomeFieldsOf(passed), []);
  // A run that matched nothing WITH a healthy runtime, and a RunInfo whose
  // outcome is anything but Error, both stay filter misses.
  for (const outcome of ["Warning", "Information", "Passed", ""]) {
    const trx =
      `<?xml version="1.0"?><TestRun xmlns="http://microsoft.com/schemas/VisualStudio/TeamTest/2010">` +
      `<ResultSummary outcome="Completed"><Counters total="0" executed="0" passed="0" failed="0" />` +
      `<RunInfos><RunInfo outcome="${outcome}"><Text>No test matches the given testcase filter</Text></RunInfo></RunInfos>` +
      `</ResultSummary></TestRun>`;
    assert.deepStrictEqual(outcomeFieldsOf(parseTrx(trx, "", 0)), ["filterMatchedNothing"], outcome);
  }
  // And nothing is ever silent: no report, no console text at all still speaks.
  assert.deepStrictEqual(outcomeFieldsOf(parseTrx("", "", 1)), ["environmentError"]);
});

test("RISK: a TRX carrying `<RunInfo outcome=\"Error\">` ALONGSIDE results drops the abort message entirely", () => {
  // A test host that dies part way through logs the results it managed and a
  // RunInfo Error for the abort. `parseTrx` only looks at RunInfo when
  // `ran === false`, so the abort text is discarded; `runRung` then computes
  // `buildError = undefined` because `parse.ran` is true. The human gets a
  // not-green run with zero failures and NO reason anywhere, which is the
  // message-less failure this leg exists to stop producing.
  const trx =
    `<?xml version="1.0"?><TestRun xmlns="http://microsoft.com/schemas/VisualStudio/TeamTest/2010">` +
    `<Results><UnitTestResult testName="A" outcome="Passed" /></Results>` +
    `<ResultSummary outcome="Failed"><Counters total="1" executed="1" passed="1" failed="0" />` +
    `<RunInfos><RunInfo computerName="c" outcome="Error"><Text>Testhost process exited with error: the run was aborted</Text></RunInfo></RunInfos>` +
    `</ResultSummary></TestRun>`;
  const parse = parseTrx(trx, "", 1);
  assert.strictEqual(parse.ran, true);
  assert.strictEqual(parse.failed, 0);
  assert.notStrictEqual(
    parse.environmentError,
    undefined,
    "the abort message reaches the human nowhere: environmentError, buildError and filterMatchedNothing are all unset",
  );
});

test("VERIFIED: the rung keeps the parse's reason and never turns one of them into 'the tests did not compile'", async () => {
  // A fake framework so the real runRung body is exercised without a spawn and
  // without writing a TRX anywhere.
  const placement = { runRoot: "/tmp", packageArg: "X.csproj" };
  const rung = (parse, exitCode, stderr) => ({
    id: "fake",
    buildCommand: () => ({ command: "true", args: [], cwd: "/tmp" }),
    parseOutput: () => parse,
    runCommand: async () => ({ stdout: "", stderr, exitCode }),
  });
  const cases = [
    [parseTrx(fixture("filter-miss.trx"), "", 0), 0, "", { filterMatchedNothing: true, buildError: undefined }],
    [parseTrx(fixture("missing-runtime.trx"), fixture("missing-runtime.stderr.txt"), 1), 1, fixture("missing-runtime.stderr.txt"), { buildError: undefined }],
    [parseTrx(fixture("compile-failure.stdout.txt"), "", 1), 1, "", { filterMatchedNothing: undefined }],
  ];
  for (const [parse, exitCode, stderr, want] of cases) {
    const f = rung(parse, exitCode, stderr);
    const r = await runFrameworkTestsAt(f, placement, ["T"], { runCommand: f.runCommand });
    assert.strictEqual(r.success, false);
    for (const [k, v] of Object.entries(want)) {
      assert.deepStrictEqual(r[k], v, `${k} for ${JSON.stringify(parse).slice(0, 60)}`);
    }
    if (parse.environmentError !== undefined) {
      assert.match(r.environmentError, /You must install or update \.NET/);
    }
    if (parse.buildError !== undefined) {
      assert.match(r.buildError, /error CS\d+/);
    }
  }
});

test("VERIFIED: the missing-runtime capture is faithful to what `dotnet test` really writes", { skip: noCorpus }, () => {
  // Re-measured this review, no roll-forward, TRX to the scratchpad: the run
  // WRITES a TRX with total="0" and `<RunInfo outcome="Error">`, exactly as the
  // fixture records and against what contract-cs.md predicted. A live filter
  // miss on the same project writes the same zero-result shape with
  // `outcome="Warning"` at exit 0, so that one attribute really is the
  // discriminator and the ordering in parseTrx is load-bearing.
  const trx = fixture("missing-runtime.trx");
  assert.match(trx, /<Counters total="0"/);
  assert.match(trx, /<RunInfo[^>]*outcome="Error"/);
  assert.match(fixture("filter-miss.trx"), /<RunInfo[^>]*outcome="Warning"/);
  assert.match(fixture("filter-miss.trx"), /<Counters total="0"/);
  assert.strictEqual(fixture("missing-runtime.stderr.txt").includes("Test Run Aborted"), true);
});

// ===========================================================================
// 3. The seam, differentially
// ===========================================================================

test("VERIFIED: the C# literal flags do not move Rust, Go, TypeScript or Python (differential, 4000-case fuzz)", () => {
  // The pre-phase-5 scanner is reconstructed by DELETING the three C# branches
  // from a copy of testAssembly.ts, then both trees are bundled and every other
  // leg's locator, parse and generatedTestNames is compared over an adversarial
  // corpus plus a fuzz. Anything the C# widening leaked into a frozen leg shows
  // up as a diff.
  const repo = path.join(__dirname, "..");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "column80-review-p5-"));
  try {
    fs.cpSync(path.join(repo, "src"), path.join(tmp, "src"), { recursive: true });
    const file = path.join(tmp, "src", "core", "testAssembly.ts");
    const lines = fs.readFileSync(file, "utf8").split("\n");
    const out = [];
    let removed = 0;
    for (let i = 0; i < lines.length; i++) {
      if (/profile\?\.csRawStrings === true|profile\?\.verbatimStrings === true/.test(lines[i])) {
        let depth = 0;
        do {
          depth += (lines[i].match(/{/g) ?? []).length - (lines[i].match(/}/g) ?? []).length;
          i++;
        } while (depth !== 0);
        i--;
        removed++;
        continue;
      }
      if (lines[i].includes("isFStringAt(text, i, profile) || isDollarPrefixedAt(text, i, profile)")) {
        out.push(lines[i].replace("isFStringAt(text, i, profile) || isDollarPrefixedAt(text, i, profile)", "isFStringAt(text, i, profile)"));
        removed++;
        continue;
      }
      out.push(lines[i]);
    }
    assert.strictEqual(removed, 3, "the three C# hunks must be found before the differential means anything");
    fs.writeFileSync(file, out.join("\n"));

    const entry = (root) =>
      `export { rustExpectedValueSpans, blankTestModule, generatedTestNames } from "${root}/src/core/testAssembly";\n` +
      `export { goExpectedValueSpans, GO_TDD_LANG } from "${root}/src/core/tddGo";\n` +
      `export { tsExpectedValueSpans, TS_TDD_LANGS } from "${root}/src/core/tddTs";\n` +
      `export { pytestExpectedValueSpans, unittestExpectedValueSpans, parsePytestJunitXml, PY_TDD_LANG } from "${root}/src/core/tddPy";\n`;
    const build = (root, tag) => {
      const src = path.join(tmp, `${tag}.ts`);
      const outfile = path.join(tmp, `${tag}.cjs`);
      fs.writeFileSync(src, entry(root));
      esbuild.buildSync({ entryPoints: [src], bundle: true, outfile, format: "cjs", platform: "node", logLevel: "error" });
      return require(outfile);
    };
    const NEW = build(repo, "new");
    const OLD = build(tmp, "old");

    const corpus = [
      "assert_eq!(f(3), 7);",
      'assert_eq!(f(3), @"x");',
      'assert_eq!(f(3), """x""");',
      'assert_eq!(f("a\\"b"), 7);',
      'assert_eq!(f(3), $"{a}");',
      'assert_eq!(f(3), 7); // @$"tail\\"',
      "want := `raw @\"x\" string`\nif got != want {}",
      'want := "a\\"b"\nif got != want {}',
      'want := 7 // comment @"x"\nif got != want {}',
      "expect(f(3)).toBe(7);",
      'expect(f(@"x")).toBe(7);',
      'expect(f("""a""")).toBe($"{b}");',
      'expect(/[@"]/.test(s)).toBe(true);',
      "assert compute(3) == 7",
      'assert compute("""a""") == 7',
      'assert compute(f"{a}") == 7',
      'assert compute(r"a\\") == 7',
      '# comment @"x"\nassert compute(3) == 7',
      "self.assertEqual(compute(3), 7)",
      'self.assertEqual(compute(@"x"), 7)',
      '/* @"x" */ assert_eq!(f(3), 7);',
      'let s = "@\\"x\\""; assert_eq!(f(3), 7);',
    ];
    const alphabet = ["@", '"', "$", "\\", "`", "'", "#", "{", "}", "(", ")", ",", "/", "*", "a", "1", "\n", " ", "_", "=", "r", "f", "b"];
    const skeletons = [
      (s) => `assert_eq!(f(3), 7); ${s} assert_eq!(g(4), 9);`,
      (s) => `want := 7\n${s}\nif got != want { t.Errorf("bad") }`,
      (s) => `expect(f(3)).toBe(7); ${s} expect(g(4)).toBe(9);`,
      (s) => `assert compute(3) == 7\n${s}\nassert other(4) == 9`,
      (s) => `self.assertEqual(compute(3), 7)\n${s}\nself.assertEqual(o(4), 9)`,
    ];
    let seed = 12345;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let n = 0; n < 4000; n++) {
      let s = "";
      const len = 1 + Math.floor(rand() * 14);
      for (let k = 0; k < len; k++) {
        s += alphabet[Math.floor(rand() * alphabet.length)];
      }
      corpus.push(skeletons[n % skeletons.length](s));
    }
    const probes = [
      ["rust locator", (M, t) => M.rustExpectedValueSpans(t)],
      ["rust blankTestModule", (M, t) => M.blankTestModule(t, "u32")],
      ["rust generatedTestNames", (M, t) => M.generatedTestNames(t, "id")],
      ["go locator", (M, t) => M.goExpectedValueSpans(t)],
      ["go generatedTestNames", (M, t) => M.GO_TDD_LANG.generatedTestNames(t, "id")],
      ["ts locator", (M, t) => M.tsExpectedValueSpans(t)],
      ["ts generatedTestNames", (M, t) => M.TS_TDD_LANGS[0].generatedTestNames(t, "id")],
      ["pytest locator", (M, t) => M.pytestExpectedValueSpans(t)],
      ["unittest locator", (M, t) => M.unittestExpectedValueSpans(t)],
      ["py generatedTestNames", (M, t) => M.PY_TDD_LANG.generatedTestNames(t, "id")],
      ["py junit parse", (M, t) => M.parsePytestJunitXml(t, "", 0)],
    ];
    for (const [name, f] of probes) {
      for (const t of corpus) {
        assert.strictEqual(JSON.stringify(f(NEW, t)), JSON.stringify(f(OLD, t)), `${name} moved on ${JSON.stringify(t)}`);
      }
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("VERIFIED: frameworkFor's failure keeps `detail` ABSENT for the four earlier legs, not present-and-undefined", () => {
  const deps = { fileExists: () => false, readFile: () => undefined, readDir: () => [], log: () => {} };
  for (const id of ["rust", "typescript", "javascript"]) {
    const r = frameworkFor(tddLangFor(id), "/nowhere", deps);
    assert.strictEqual(r.ok, false, id);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(r, "detail"), false, `${id} grew a detail key`);
    assert.deepStrictEqual(r, { ok: false, lookedFor: r.lookedFor }, `${id} deep-equals its pre-phase-5 shape`);
  }
  // Go and Python detect a default framework rather than failing here, so their
  // failure object is unreachable from this input; the assertion that matters is
  // that neither carries a detail key on the success shape either.
  for (const id of ["go", "python"]) {
    const r = frameworkFor(tddLangFor(id), "/nowhere", deps);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(r, "detail"), false, id);
  }
  const csharp = frameworkFor(cs(), "/nowhere", deps);
  assert.strictEqual(csharp.ok, false);
  assert.strictEqual(typeof csharp.detail, "string", "C# is the leg that needs the new key");
});

test("VERIFIED: the third classifyTestability parameter is inert for the four legs that ignore it", () => {
  const ctx = { internalsVisible: true };
  const sigs = {
    rust: ["fn helper(a: u32) -> u32", "pub fn helper(a: u32) -> u32"],
    go: ["func helper(a int) int", "func Helper(a int) int"],
    typescript: ["function helper(a: number): number", "export function helper(a: number): number"],
    python: ["def helper(a: int) -> int", "def _helper(a: int) -> int"],
  };
  for (const [id, list] of Object.entries(sigs)) {
    for (const sig of list) {
      for (const doc of [undefined, "documented"]) {
        const lang = tddLangFor(id);
        assert.deepStrictEqual(
          lang.classifyTestability(sig, doc, ctx),
          lang.classifyTestability(sig, doc),
          `${id}: ${sig}`,
        );
      }
    }
  }
});

// ===========================================================================
// 4. csReturnTypeOf and matchAngle
// ===========================================================================

test("VERIFIED: the C#-local angle matcher reads every generic, tuple, array and nullable shape asked of it", () => {
  const want = {
    "public static Dictionary<string, List<int>> F(int a)": "Dictionary<string, List<int>>",
    "public static int F(int a = 1 < 2 ? 3 : 4)": "int",
    "void F(int a = 1 < 2 ? 3 : 4)": undefined,
    "public static T Max<T>(T a, T b) where T : IComparable": "T",
    "int IFoo.Bar(int x)": "int",
    "public (int count, string name) F()": "(int count, string name)",
    "public async ValueTask<(int, string)> F()": "ValueTask<(int, string)>",
    "public static List<int>? F()": "List<int>?",
    "public static int[] F()": "int[]",
    "public static int[,] F()": "int[,]",
    "public static Func<int, int> F()": "Func<int, int>",
    "public static global::System.Collections.Generic.List<int> F()": "global::System.Collections.Generic.List<int>",
    "public static long ToUnixTimeSeconds(this DateTime input)": "long",
    "public Foo(int a)": undefined,
    "public class EventMetadata(Dictionary<string, Monitor> byHash)": undefined,
    "public static bool operator <(A a, B b)": undefined,
    "public static implicit operator int(A a)": undefined,
    "public static ref int Slot()": undefined,
  };
  for (const [sig, ty] of Object.entries(want)) {
    assert.strictEqual(csReturnTypeOf(sig), ty, sig);
  }
  // An explicit interface implementation keeps its dotted name and is refused
  // as an instance member, so Amendment 5's unactionable-detail trap cannot fire.
  assert.strictEqual(csMethodHead("int IFoo.Bar(int x)").name, "IFoo.Bar");
  assert.strictEqual(classifyCsTestability("int IFoo.Bar(int x)", "/// doc").reason, "needs-fixture");
});

test("NIT: an operator declaration is not a readable method head, so it refuses as `underspecified`", () => {
  // `public static bool operator <(A a, B b)` is a public static member with a
  // return value, and the head parser stops at `operator`. The refusal is
  // honest-dark rather than wrong, and the sentence the human reads ("not a
  // readable C# method signature") is the accurate one. Recorded so the shape is
  // a known refusal and not a surprise.
  const v = classifyCsTestability("public static bool operator <(A a, B b)", "/// doc");
  assert.strictEqual(v.testable, false);
  assert.strictEqual(v.reason, "underspecified");
});

// ===========================================================================
// 5. Placement, against the real corpus and against the awkward layouts
// ===========================================================================

const testProject = (refs) =>
  `<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><IsTestProject>true</IsTestProject></PropertyGroup>` +
  `<ItemGroup><PackageReference Include="MSTest.TestFramework" Version="4.0.1" /></ItemGroup>` +
  `<ItemGroup>${refs.map((r) => `<ProjectReference Include="${r}" />`).join("")}</ItemGroup></Project>`;

function synthetic(files, dirs) {
  return {
    fileExists: (p) => files[p] !== undefined,
    readFile: (p) => files[p],
    readDir: (d) => dirs[d],
    log: () => {},
  };
}

function place(extraFiles, extraDirs) {
  const files = {
    "/sln/Src/Src.csproj": "<Project Sdk=\"Microsoft.NET.Sdk\"><PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup></Project>",
    "/sln/Src/Widen.cs": "namespace Src;\npublic static class W { }",
    ...extraFiles,
  };
  const dirs = { "/sln/Src": ["Src.csproj", "Widen.cs"], ...extraDirs };
  return cs().placementFor("/sln/Src/Widen.cs", "W", synthetic(files, dirs));
}

test("VERIFIED: one source project referenced by TWO test projects refuses by name, and `<Source>.Tests` breaks the tie", () => {
  const two = place(
    { "/sln/A.Tests/A.Tests.csproj": testProject(["..\\Src\\Src.csproj"]), "/sln/B.Tests/B.Tests.csproj": testProject(["..\\Src\\Src.csproj"]) },
    { "/sln": ["Src", "A.Tests", "B.Tests"], "/sln/A.Tests": ["A.Tests.csproj"], "/sln/B.Tests": ["B.Tests.csproj"] },
  );
  assert.strictEqual(two.ok, false);
  assert.strictEqual(two.refusal.reason, "ambiguous-test-project");
  assert.match(two.refusal.detail, /A\.Tests\.csproj/);
  assert.match(two.refusal.detail, /B\.Tests\.csproj/);

  const tie = place(
    { "/sln/Src.Tests/Src.Tests.csproj": testProject(["..\\Src\\Src.csproj"]), "/sln/B.Tests/B.Tests.csproj": testProject(["..\\Src\\Src.csproj"]) },
    { "/sln": ["Src", "Src.Tests", "B.Tests"], "/sln/Src.Tests": ["Src.Tests.csproj"], "/sln/B.Tests": ["B.Tests.csproj"] },
  );
  assert.strictEqual(tie.ok, true);
  assert.strictEqual(tie.placement.runRoot, "/sln/Src.Tests");
});

test("VERIFIED: a test project with no ProjectReference back is not a candidate, and the refusal names what was looked for", () => {
  const r = place(
    { "/sln/Src.Tests/Src.Tests.csproj": testProject([]) },
    { "/sln": ["Src", "Src.Tests"], "/sln/Src.Tests": ["Src.Tests.csproj"] },
  );
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.refusal.reason, "no-test-project");
  assert.match(r.refusal.detail, /IsTestProject/);
  assert.match(r.refusal.detail, /Microsoft\.NET\.Test\.Sdk/);
  assert.match(r.refusal.detail, /ProjectReference/);
  assert.match(r.refusal.detail, /Src\.Tests/);
});

test("NIT: an MSBuild variable in the ProjectReference path refuses, and tells the human to create a project they already have", () => {
  // `<ProjectReference Include=\"..\\$(SrcDir)\\Src.csproj\" />` is not resolved,
  // so the test project is invisible and the refusal reads "create a `Src.Tests`
  // project yourself" at a solution where `Src.Tests` exists and references the
  // source. Refusing is the safe direction; the SENTENCE is the unactionable
  // half, which is the defect class Amendment 5 exists for.
  const r = place(
    { "/sln/Src.Tests/Src.Tests.csproj": testProject(["..\\$(SrcDir)\\Src.csproj"]) },
    { "/sln": ["Src", "Src.Tests"], "/sln/Src.Tests": ["Src.Tests.csproj"] },
  );
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.refusal.reason, "no-test-project");
  assert.doesNotMatch(
    r.refusal.detail,
    /create a `Src\.Tests` project yourself/,
    "the detail sends the human to create a test project that is right there",
  );
});

test("VERIFIED: forward slashes in a ProjectReference path still resolve", () => {
  const r = place(
    { "/sln/Src.Tests/Src.Tests.csproj": testProject(["../Src/Src.csproj"]) },
    { "/sln": ["Src", "Src.Tests"], "/sln/Src.Tests": ["Src.Tests.csproj"] },
  );
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.placement.runRoot, "/sln/Src.Tests");
});

test("VERIFIED: on the real Contoso solution every source file resolves to the TEST project's directory", { skip: noCorpus }, () => {
  const walk = (dir, out = []) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (["bin", "obj", ".git"].includes(e.name)) continue;
        walk(path.join(dir, e.name), out);
      } else if (e.name.endsWith(".cs")) {
        out.push(path.join(dir, e.name));
      }
    }
    return out;
  };
  const testProjectDir = path.join(CORPUS, "Contoso.ProcessingLogic.Tests");
  // The one-to-many trap, measured: ONE test project serves three source
  // projects and every file in all three lands in it, with runRoot the test
  // project and never the source project.
  for (const project of ["Contoso.ProcessingLogic", "Contoso.DataModel", "Contoso.Portal.Api"]) {
    const files = walk(path.join(CORPUS, project));
    assert.ok(files.length > 0, project);
    for (const f of files) {
      const r = cs().placementFor(f, "F", REAL_TDD_DEPS);
      assert.strictEqual(r.ok, true, `${f}: ${r.ok ? "" : r.refusal.detail}`);
      assert.strictEqual(r.placement.runRoot, testProjectDir, f);
      assert.notStrictEqual(r.placement.runRoot, path.join(CORPUS, project), f);
      assert.strictEqual(r.placement.mode, "project-file");
      assert.strictEqual(r.placement.packageArg, "Contoso.ProcessingLogic.Tests.csproj");
      assert.ok(r.placement.targetPath.startsWith(testProjectDir + path.sep), f);
    }
  }
  // And a project no test project references is refused rather than guessed.
  for (const orphan of ["Contoso.LocalDb", "Contoso.DataProcessing", "Contoso.EventProcessor"]) {
    const files = walk(path.join(CORPUS, orphan));
    const r = cs().placementFor(files[0], "F", REAL_TDD_DEPS);
    assert.strictEqual(r.ok, false, orphan);
    assert.strictEqual(r.refusal.reason, "no-test-project");
  }
});

// ===========================================================================
// 6. The classifier and the 363-versus-251 gap
// ===========================================================================

/** Method declarations in a C# file, independent of the implementer's harness
 *  in impl-v31-cs.test.cjs: this one records what FOLLOWS the parameter list, so
 *  a declaration-only member (an interface or abstract method, ending `;`) can be
 *  counted separately from one with a body. */
function declarations(text) {
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
      while (j < text.length) {
        if (text[j] === '"') { if (text[j + 1] === '"') { j += 2; continue; } break; }
        j++;
      }
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
          out.push({ head, after, signature: text.slice(i, close + 1).replace(/\s+/g, " "), doc: docAbove(text, i) });
          i = close + 1; prev = ")"; continue;
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

function corpusFiles() {
  const out = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (["bin", "obj", ".git"].includes(e.name) || e.name.endsWith(".Tests")) continue;
        walk(p);
      } else if (e.name.endsWith(".cs")) {
        out.push(p);
      }
    }
  })(CORPUS);
  return out;
}

test("VERIFIED: the corpus survivor count is ZERO, confirmed by a second extraction that never asks csMethodHead", { skip: noCorpus }, () => {
  // The number that matters is the survivor count, so it is measured here
  // WITHOUT the product's own parser. A survivor must be public, static, have a
  // `///` block and a non-void return. Grep every `///` block in the solution
  // and read the declaration under it: only six are static at all, and each is
  // either non-public or returns void. Zero survivors, independent of any
  // signature parser this session wrote.
  const documentedStatics = [];
  for (const file of corpusFiles()) {
    const lines = fs.readFileSync(file, "utf8").split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].trim().startsWith("///")) continue;
      let j = i + 1;
      while (j < lines.length && (lines[j].trim().startsWith("///") || lines[j].trim().startsWith("[") || lines[j].trim() === "")) j++;
      const decl = j < lines.length ? lines[j].trim() : "";
      if (/^(public|private|internal|protected)?\s*static\b/.test(decl) || /^\s*static\b/.test(decl)) {
        documentedStatics.push(`${path.relative(CORPUS, file)}: ${decl}`);
      }
    }
  }
  const couldSurvive = documentedStatics.filter((d) => /:\s*public\s+static\b/.test(d) && !/\bpublic static void\b/.test(d));
  assert.deepStrictEqual(couldSurvive, [], `a documented public static non-void member exists: ${couldSurvive.join(" | ")}`);
});

test("VERIFIED: the 363-versus-251 gap is EXTRACTION, not precedence: 110 of the 363 are declaration-only members", { skip: noCorpus }, () => {
  // Precedence can only move the ATTRIBUTION of a refusal; it cannot change how
  // many methods there are. The scout's C# corpus was 251 methods; this leg's
  // harness reports 363 over the same 153 files. The difference is that this
  // harness accepts a declaration ending in `;` — an interface member or an
  // abstract method, which has no body — and the scout's line parser did not.
  // 363 minus those is 253, within two of the scout's 251, so the gap is the
  // extraction and the reason-share differences on top of it are the precedence.
  let total = 0;
  let declarationOnly = 0;
  const reasons = {};
  const survivors = [];
  for (const file of corpusFiles()) {
    for (const d of declarations(fs.readFileSync(file, "utf8"))) {
      total++;
      if (d.after.startsWith(";")) declarationOnly++;
      const v = classifyCsTestability(d.signature, d.doc);
      const key = v.testable ? "testable" : v.reason;
      reasons[key] = (reasons[key] ?? 0) + 1;
      if (v.testable) survivors.push(`${path.relative(CORPUS, file)}: ${d.signature}`);
    }
  }
  assert.deepStrictEqual(survivors, [], "zero survivors is the measured, human-ratified state");
  assert.ok(total >= 350 && total <= 380, `expected the implementer's ~363, got ${total}`);
  assert.ok(declarationOnly > 100, `expected the declaration-only members to explain the gap, got ${declarationOnly}`);
  assert.ok(
    Math.abs(total - declarationOnly - 251) <= 5,
    `bodied methods ${total - declarationOnly} should land on the scout's 251; the residue is what precedence cannot explain`,
  );
});

test("VERIFIED: a constructor is never read as a method returning `public`, on the whole corpus", { skip: noCorpus }, () => {
  const modifiers = ["public", "private", "protected", "internal", "static", "async", "sealed", "override", "virtual", "partial"];
  const bad = [];
  for (const file of corpusFiles()) {
    for (const d of declarations(fs.readFileSync(file, "utf8"))) {
      if (modifiers.includes(d.head.returnType)) bad.push(`${path.relative(CORPUS, file)}: ${d.signature}`);
    }
  }
  assert.deepStrictEqual(bad, [], "a modifier read as a return type is the constructor false positive");
  for (const ctor of ["public Foo(int a)", "public Foo(int a) : base(a)", "internal Foo()", "public record Foo(int x)", "public class EventMetadata(Dictionary<string, Monitor> byHash)"]) {
    assert.strictEqual(csMethodHead(ctor), undefined, ctor);
  }
});

test("VERIFIED: every `not-exported` detail on the corpus names a fix the human can PERFORM", { skip: noCorpus }, () => {
  const details = new Set();
  for (const file of corpusFiles()) {
    for (const d of declarations(fs.readFileSync(file, "utf8"))) {
      const v = classifyCsTestability(d.signature, d.doc);
      if (v.reason === "not-exported") details.add(v.detail);
    }
  }
  assert.ok(details.size > 0, "not-exported should fire on a service codebase");
  for (const detail of details) {
    assert.match(detail, /Make it `public`/, detail);
  }
});

// ===========================================================================
// 7. InternalsVisibleTo
// ===========================================================================

test("DEFECT: `InternalsVisibleTo` naming a DIFFERENT assembly is read as granting access to the test project", () => {
  // The check is a bare /InternalsVisibleTo/ regex over the .csproj and any
  // AssemblyInfo.cs, so a project that grants its internals to a benchmark
  // harness, an analyzer or a sibling library is read as granting them to the
  // test project. The classifier then calls an `internal static` method
  // testable, the gesture writes a test that cannot compile, and the human gets
  // CS0122 they did not cause. It is the one direction the leg's own header
  // calls "not conservative", and this is a second instance of it.
  const files = {
    "/p/P.csproj": '<Project><ItemGroup><InternalsVisibleTo Include="SomeCompletelyOtherAssembly" /></ItemGroup></Project>',
  };
  const deps = synthetic(files, { "/p": ["P.csproj"] });
  assert.strictEqual(
    csInternalsVisibleTo("/p", deps),
    false,
    "the grant names another assembly, so the test project still cannot see internals",
  );
});

test("DEFECT: `InternalsVisibleTo` inside an XML COMMENT is read as a live grant", () => {
  const files = { "/p/P.csproj": "<Project><!-- InternalsVisibleTo was removed in 2019 --></Project>" };
  assert.strictEqual(csInternalsVisibleTo("/p", synthetic(files, { "/p": ["P.csproj"] })), false);
});

test("VERIFIED: InternalsVisibleTo is absent from Contoso, and absence means `internal` refuses", { skip: noCorpus }, () => {
  let hits = 0;
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (["bin", "obj", ".git"].includes(e.name)) continue;
        walk(p);
      } else if (/\.(cs|csproj|props|targets)$/i.test(e.name)) {
        if (fs.readFileSync(p, "utf8").includes("InternalsVisibleTo")) hits++;
      }
    }
  };
  walk(CORPUS);
  assert.strictEqual(hits, 0, "the corpus really has no InternalsVisibleTo anywhere");
  for (const project of ["Contoso.DataModel", "Contoso.ProcessingLogic", "Contoso.Portal.Api"]) {
    assert.strictEqual(csInternalsVisibleTo(path.join(CORPUS, project), REAL_TDD_DEPS), false, project);
  }
  const sig = "internal static int Widen(int n)";
  assert.strictEqual(classifyCsTestability(sig, "/// doc").reason, "not-exported");
  assert.strictEqual(classifyCsTestability(sig, "/// doc", { internalsVisible: true }).testable, true);
});

test("NIT: `protected internal static` is refused even when internals ARE visible", () => {
  // `protected internal` means protected OR internal, so an InternalsVisibleTo
  // grant does reach it. The guard that keeps `private protected` out also
  // catches this one. Over-refusal, the safe direction, and rare.
  const v = classifyCsTestability("protected internal static int W(int n)", "/// doc", { internalsVisible: true });
  assert.strictEqual(v.reason, "not-exported");
  assert.match(v.detail, /Make it `public`/);
});

// ===========================================================================
// 8. The command
// ===========================================================================

test("VERIFIED: the product never sets DOTNET_ROLL_FORWARD and never writes inside the repo", () => {
  const placement = {
    targetPath: "/repo/Src.Tests/WidenTests.cs",
    exists: false,
    mode: "project-file",
    runRoot: "/repo/Src.Tests",
    packageArg: "Src.Tests.csproj",
  };
  for (const framework of cs().frameworks) {
    const cmd = framework.buildCommand(placement, ["WidenHappy", "WidenZero"]);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(cmd.env ?? {}, "DOTNET_ROLL_FORWARD"), false, framework.id);
    assert.ok(!JSON.stringify(cmd).includes("ROLL_FORWARD"), framework.id);
    assert.ok(cmd.outputFile.startsWith(os.tmpdir() + path.sep), `${framework.id}: ${cmd.outputFile}`);
    assert.ok(!cmd.outputFile.startsWith("/repo"), framework.id);
    assert.ok(cmd.args.includes("--results-directory"), framework.id);
    assert.strictEqual(cmd.args[cmd.args.indexOf("--results-directory") + 1], path.dirname(cmd.outputFile));
    assert.strictEqual(cmd.cwd, "/repo/Src.Tests", "cwd is the TEST project");
    assert.ok(cmd.args.includes("--no-restore"), "offline");
  }
});
