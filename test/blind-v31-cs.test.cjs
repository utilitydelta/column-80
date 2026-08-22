// Blind oracle: the C# TDD leg (the C# and seam contracts, goal items 5 and 6,
// Amendments 1 to 7; the shipped seam is docs/architecture/tdd-language-seam.md,
// "C#"). Black-box contract tests written from the CONTRACT ALONE, before
// `src/core/tddCs.ts` exists. THE LAST LEG.
// Covers:
//   §Registration   "csharp" resolves, markerPrefix "//", mstest > xunit >
//                   nunit, and - because this is the last leg - that ALL FIVE
//                   languages now resolve and only unknown ids stay undefined.
//   §Placement      find the test PROJECT, never create it. runRoot is the TEST
//                   project's directory. The one-to-many trap, both halves.
//   §Frameworks     package references, MSTest then xUnit then NUnit, and
//                   honest-dark naming all three.
//   §Visibility     not-exported, with a detail naming a PERFORMABLE fix.
//   §The command    dotnet test, FullyQualifiedName~ (a CONTAINS match with no
//                   anchor), --logger trx, results directory in SYSTEM TEMP,
//                   outputFile SET, and NO DOTNET_ROLL_FORWARD.
//   §The TRX parse  UnitTestResult elements, Counters ATTRIBUTES, passing tests
//                   ENUMERATED (Amendment 7 overturned the goal on this),
//                   namespace prefixes tolerated, malformed XML never throws.
//   §FOUR no-runs   test failure, filter miss at EXIT 0, compile failure and -
//                   C#'s alone, and measured - a MISSING RUNTIME.
//   §MTP dark       EnableMSTestRunner refuses by NAMING the property.
//   §returnTypeOf   C# has no `->` at all, so the shipped Rust regex returns
//                   undefined for every C# method.
//   §Testability    async/io/needs-fixture/not-exported/underspecified, and a
//                   constructor is never a method returning `public`.
//   §Spans          THE SAFETY-CRITICAL ONE. The argument order INVERTS
//                   relative to Rust: MSTest and xUnit blank the FIRST
//                   argument, NUnit the argument of Is.EqualTo.
//   §Blank values   bare scalars, hinted containers, BARE per tuple element.
//   §Scaffold       "//" markers, [TestClass], the framework's own using, and
//                   generatedTestNames not fooled by a name inside a string.
//
// Never read src/**. The whole point of this file is independence from the
// implementation. Expected RED until phase 5 lands.
//
// Guards, each collapsing a whole class of red into ONE loud failure:
//   1. a failed bundle (the module is missing) fails the bundle test and SKIPS
//      everything else.
//   2. `tddLangFor("csharp")` returning undefined (phase 5 not registered yet)
//      fails the registration test and SKIPS everything else.
//   3. a failed temp-fixture build fails one test and SKIPS only the rows that
//      need a solution on disk.
// None of the three produces a wall of TypeErrors.
//
// FOUR SEAM GAPS THIS ORACLE FOUND WITH NOWHERE TO BIND, ALL FOUR NOW RATIFIED
// AS AMENDMENT 8 AND RE-CUT HERE TO THE RATIFIED SPELLING:
//   a. 8a: `classifyTestability(signature, docComment, ctx?)` now carries the
//      one PROJECT fact a signature cannot show, `ctx.internalsVisible`. Both
//      directions of the InternalsVisibleTo rule are pinned.
//   b. 8b: `PlacementRefusalReason` grows `"ambiguous-test-project"` and
//      `"unsupported-runner"`, and `frameworkFor`'s failure shape grows
//      `detail?: string`. The ambiguity and MTP rows pin the ratified reasons
//      rather than accepting whichever of the three old ones was nearest.
//   c. 8c: `stderr` is ALWAYS the process's real stderr and `stdout` falls back
//      to the process's real stdout when the TRX was NOT written. Measured
//      since: a C# compile failure puts its errors on STDOUT with stderr EMPTY,
//      so the build-error row feeds stdout and a leg reading only stderr fails.
//   d. 8d: `TestPlacement.frameworkId` says WHICH framework detected, so the
//      scaffold can look up the framework's ATTRIBUTES (`[TestClass]`) and not
//      only its using line.
//
// AND TWO CONTRACT CORRECTIONS MEASURED DURING PHASE 5, both pinned below:
//   - The missing runtime DOES write a TRX: `<ResultSummary outcome="Failed">`,
//     `total="0"`, and a `<RunInfo outcome="Error">` carrying the message. So
//     inside the TRX it is structurally identical to the FILTER MISS apart from
//     that one attribute. Fourth language with this collision. RunInfo is
//     checked FIRST or a missing runtime is reported as a filter miss.
//   - The compile failure writes no TRX and puts its errors on STDOUT.
//
// Run: SKIP_LIVE=1 node --test test/blind-v31-cs.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { bundleCore } = require("./.blind-util.cjs");

let mod = {};
let cleanup = () => {};
let bundleError;
try {
  ({ mod, cleanup } = bundleCore(
    "blind-v31-cs",
    `export { tddLangFor, frameworkFor } from "../src/core/tddLang";\n`
  ));
} catch (e) {
  bundleError = e;
}

// ---------------------------------------------------------------------------
// Temp fixtures. Real .csproj trees under the SYSTEM TEMP area, never inside the
// repo, removed whatever the run does. The canonical solution mirrors Contoso:
// one test project referencing THREE source projects, which is the one-to-many
// trap contract-cs.md names.
// ---------------------------------------------------------------------------

let base;
let fixtureError;

const R = {};

const writeFile = (p, text) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
};

// A source project: nothing but a TargetFramework. CAPTURED shape, the minimal
// SDK-style project every .NET project on this machine is.
const SOURCE_CSPROJ =
  '<Project Sdk="Microsoft.NET.Sdk">\n' +
  "  <PropertyGroup>\n" +
  "    <TargetFramework>net9.0</TargetFramework>\n" +
  "    <Nullable>enable</Nullable>\n" +
  "  </PropertyGroup>\n" +
  "</Project>\n";

// CAPTURED shape: contract-cs.md says both signals are present in
// Contoso.ProcessingLogic.Tests.csproj, PROVEN by reading it.
const testCsproj = ({ isTestProject = true, testSdk = true, packages = [], refs = [], mtp = false }) => {
  const props = ["    <TargetFramework>net9.0</TargetFramework>"];
  if (isTestProject) props.push("    <IsTestProject>true</IsTestProject>");
  if (mtp) props.push("    <EnableMSTestRunner>true</EnableMSTestRunner>");
  const pkgs = [];
  if (testSdk) pkgs.push('    <PackageReference Include="Microsoft.NET.Test.Sdk" Version="17.13.0" />');
  for (const [name, version] of packages) {
    pkgs.push(`    <PackageReference Include="${name}" Version="${version}" />`);
  }
  const references = refs.map((r) => `    <ProjectReference Include="${r}" />`);
  return (
    '<Project Sdk="Microsoft.NET.Sdk">\n' +
    "  <PropertyGroup>\n" +
    props.join("\n") +
    "\n  </PropertyGroup>\n" +
    "  <ItemGroup>\n" +
    pkgs.join("\n") +
    "\n  </ItemGroup>\n" +
    "  <ItemGroup>\n" +
    references.join("\n") +
    "\n  </ItemGroup>\n" +
    "</Project>\n"
  );
};

// The source under test. The file name and the TYPE name agree, which is the C#
// convention, so `<SourceType>Tests.cs` is unambiguous here and this file never
// has to guess whether the leg reads the type from the file name or the source.
const WIDEN_CS =
  "namespace Contoso.ProcessingLogic;\n" +
  "\n" +
  "public static class Widen\n" +
  "{\n" +
  "    /// <summary>Widens n.</summary>\n" +
  "    public static int Apply(int n) => n * 2;\n" +
  "}\n";

const GAP_ANALYSIS_CS =
  "namespace Contoso.ProcessingLogic.Gaps;\n" +
  "\n" +
  "public static class GapAnalysis\n" +
  "{\n" +
  "    /// <summary>Do two gaps overlap.</summary>\n" +
  "    private static bool GapsOverlap(int a, int b) => a < b;\n" +
  "}\n";

const DTO_CS =
  "namespace Contoso.DataModel;\n" +
  "\n" +
  "public static class DtoGapAnalysis\n" +
  "{\n" +
  "    /// <summary>Total minutes.</summary>\n" +
  "    public static int Total(int a) => a;\n" +
  "}\n";

const MSTEST_PKGS = [
  ["MSTest", "4.0.1"],
  ["MSTest.TestFramework", "4.0.1"],
  ["MSTest.TestAdapter", "4.0.1"],
];

try {
  base = fs.mkdtempSync(path.join(os.tmpdir(), "blind-v31-cs-"));

  // ---- The canonical solution, shaped like Contoso. -----------------------
  R.sln = path.join(base, "sln");
  writeFile(path.join(R.sln, "Contoso.ProcessingLogic", "Contoso.ProcessingLogic.csproj"), SOURCE_CSPROJ);
  writeFile(path.join(R.sln, "Contoso.ProcessingLogic", "Widen.cs"), WIDEN_CS);
  writeFile(path.join(R.sln, "Contoso.ProcessingLogic", "Gaps", "GapAnalysis.cs"), GAP_ANALYSIS_CS);
  writeFile(path.join(R.sln, "Contoso.DataModel", "Contoso.DataModel.csproj"), SOURCE_CSPROJ);
  writeFile(path.join(R.sln, "Contoso.DataModel", "DtoGapAnalysis.cs"), DTO_CS);
  writeFile(path.join(R.sln, "Contoso.Portal.Api", "Contoso.Portal.Api.csproj"), SOURCE_CSPROJ);
  writeFile(
    path.join(R.sln, "Contoso.ProcessingLogic.Tests", "Contoso.ProcessingLogic.Tests.csproj"),
    testCsproj({
      packages: MSTEST_PKGS,
      refs: [
        "../Contoso.DataModel/Contoso.DataModel.csproj",
        "../Contoso.ProcessingLogic/Contoso.ProcessingLogic.csproj",
        "../Contoso.Portal.Api/Contoso.Portal.Api.csproj",
      ],
    })
  );
  writeFile(
    path.join(R.sln, "Contoso.sln"),
    "Microsoft Visual Studio Solution File, Format Version 12.00\n"
  );

  // Same solution, but the generated test file is ALREADY on disk.
  R.slnExists = path.join(base, "sln-exists");
  fs.cpSync(R.sln, R.slnExists, { recursive: true });
  writeFile(
    path.join(R.slnExists, "Contoso.ProcessingLogic.Tests", "WidenTests.cs"),
    "namespace Contoso.ProcessingLogic.Tests;\n\npublic class WidenTests { }\n"
  );

  // ---- One signal each, to prove the OR. ---------------------------------
  // Microsoft.NET.Test.Sdk and NO <IsTestProject>. xUnit.
  R.sdkOnly = path.join(base, "sdk-only");
  writeFile(path.join(R.sdkOnly, "Lib", "Lib.csproj"), SOURCE_CSPROJ);
  writeFile(path.join(R.sdkOnly, "Lib", "Widen.cs"), WIDEN_CS);
  writeFile(
    path.join(R.sdkOnly, "Lib.Tests", "Lib.Tests.csproj"),
    testCsproj({
      isTestProject: false,
      packages: [["xunit", "2.9.2"], ["xunit.runner.visualstudio", "3.0.0"]],
      refs: ["../Lib/Lib.csproj"],
    })
  );

  // <IsTestProject>true</IsTestProject> and NO Microsoft.NET.Test.Sdk. NUnit.
  R.isTestOnly = path.join(base, "istest-only");
  writeFile(path.join(R.isTestOnly, "Lib", "Lib.csproj"), SOURCE_CSPROJ);
  writeFile(path.join(R.isTestOnly, "Lib", "Widen.cs"), WIDEN_CS);
  writeFile(
    path.join(R.isTestOnly, "Lib.Tests", "Lib.Tests.csproj"),
    testCsproj({
      testSdk: false,
      packages: [["NUnit", "4.2.2"], ["NUnit3TestAdapter", "4.6.0"]],
      refs: ["../Lib/Lib.csproj"],
    })
  );

  // ---- The refusals. ------------------------------------------------------
  // A test project that does NOT reference this source project.
  R.noRef = path.join(base, "no-ref");
  writeFile(path.join(R.noRef, "Lib", "Lib.csproj"), SOURCE_CSPROJ);
  writeFile(path.join(R.noRef, "Lib", "Widen.cs"), WIDEN_CS);
  writeFile(path.join(R.noRef, "Unrelated", "Unrelated.csproj"), SOURCE_CSPROJ);
  writeFile(
    path.join(R.noRef, "Other.Tests", "Other.Tests.csproj"),
    testCsproj({ packages: MSTEST_PKGS, refs: ["../Unrelated/Unrelated.csproj"] })
  );

  // No test project anywhere.
  R.noTests = path.join(base, "no-tests");
  writeFile(path.join(R.noTests, "Lib", "Lib.csproj"), SOURCE_CSPROJ);
  writeFile(path.join(R.noTests, "Lib", "Widen.cs"), WIDEN_CS);

  // A test project with none of the three frameworks.
  R.noFramework = path.join(base, "no-framework");
  writeFile(path.join(R.noFramework, "Lib", "Lib.csproj"), SOURCE_CSPROJ);
  writeFile(path.join(R.noFramework, "Lib", "Widen.cs"), WIDEN_CS);
  writeFile(
    path.join(R.noFramework, "Lib.Tests", "Lib.Tests.csproj"),
    testCsproj({ packages: [], refs: ["../Lib/Lib.csproj"] })
  );

  // Microsoft.Testing.Platform opted in.
  R.mtp = path.join(base, "mtp");
  writeFile(path.join(R.mtp, "Lib", "Lib.csproj"), SOURCE_CSPROJ);
  writeFile(path.join(R.mtp, "Lib", "Widen.cs"), WIDEN_CS);
  writeFile(
    path.join(R.mtp, "Lib.Tests", "Lib.Tests.csproj"),
    testCsproj({ mtp: true, packages: MSTEST_PKGS, refs: ["../Lib/Lib.csproj"] })
  );

  // ---- The one-to-many trap, both halves. ---------------------------------
  // TWO candidates, one of them named <SourceProject>.Tests.
  R.ambigResolvable = path.join(base, "ambig-resolvable");
  writeFile(path.join(R.ambigResolvable, "Lib", "Lib.csproj"), SOURCE_CSPROJ);
  writeFile(path.join(R.ambigResolvable, "Lib", "Widen.cs"), WIDEN_CS);
  for (const name of ["Lib.Tests", "Lib.IntegrationTests"]) {
    writeFile(
      path.join(R.ambigResolvable, name, `${name}.csproj`),
      testCsproj({ packages: MSTEST_PKGS, refs: ["../Lib/Lib.csproj"] })
    );
  }

  // TWO candidates, NEITHER named <SourceProject>.Tests.
  R.ambigUnresolvable = path.join(base, "ambig-unresolvable");
  writeFile(path.join(R.ambigUnresolvable, "Lib", "Lib.csproj"), SOURCE_CSPROJ);
  writeFile(path.join(R.ambigUnresolvable, "Lib", "Widen.cs"), WIDEN_CS);
  for (const name of ["Alpha.Tests", "Beta.Tests"]) {
    writeFile(
      path.join(R.ambigUnresolvable, name, `${name}.csproj`),
      testCsproj({ packages: MSTEST_PKGS, refs: ["../Lib/Lib.csproj"] })
    );
  }

  // ---- MSBuild's own path separator. --------------------------------------
  // Real .csproj files spell ProjectReference with BACKSLASHES on every
  // platform. Isolated in its own root so a leg that only handles "/" fails
  // exactly one named row instead of every placement row in the file.
  R.backslash = path.join(base, "backslash");
  writeFile(path.join(R.backslash, "Lib", "Lib.csproj"), SOURCE_CSPROJ);
  writeFile(path.join(R.backslash, "Lib", "Widen.cs"), WIDEN_CS);
  writeFile(
    path.join(R.backslash, "Lib.Tests", "Lib.Tests.csproj"),
    testCsproj({ packages: MSTEST_PKGS, refs: ["..\\Lib\\Lib.csproj"] })
  );
} catch (e) {
  fixtureError = e.message;
}

// A FAILED bundle never returns a cleanup, and it still wrote the entry file.
// Sweep every path so a red run leaves nothing behind, in the tree or in temp.
test.after(() => {
  cleanup();
  for (const leftover of [".blind-v31-cs.entry.ts", ".blind-v31-cs.bundle.cjs"]) {
    fs.rmSync(path.join(__dirname, leftover), { force: true });
  }
  if (base) fs.rmSync(base, { recursive: true, force: true });
});

const { tddLangFor, frameworkFor } = mod;

test("bundle: the seam surface builds and exports tddLangFor + frameworkFor [contract-seam.md 'New file: src/core/tddLang.ts']", () => {
  if (bundleError) {
    assert.fail(`bundle failed to build - the seam is not implemented yet: ${bundleError.message}`);
  }
  assert.strictEqual(typeof tddLangFor, "function", "tddLangFor is the one construction point");
  assert.strictEqual(typeof frameworkFor, "function", "frameworkFor resolves the rung");
});

// Resolve the C# leg once. Its absence is the OTHER single loud failure.
let csLang;
let legError;
if (!bundleError) {
  try {
    csLang = tddLangFor("csharp");
  } catch (e) {
    legError = `tddLangFor("csharp") threw: ${e.message}`;
  }
  if (!legError && !csLang) {
    legError = 'tddLangFor("csharp") returned undefined: the phase 5 C# leg is not registered yet';
  }
}

test("REGISTRATION: tddLangFor('csharp') resolves a TddLang [contract-cs.md 'Registers \"csharp\" in tddLangFor']", (ctx) => {
  if (bundleError) return ctx.skip("bundle failed to build; see the bundle test");
  assert.ok(!legError, legError || "");
  assert.strictEqual(typeof csLang, "object", "a TddLang is an object of members, not a factory");
});

// Every other test skips (not fails) while the bundle or the registration is
// broken, so a red run stays one loud failure instead of a wall of TypeErrors.
const ptest = (name, fn) =>
  test(name, (ctx) => {
    if (bundleError) return ctx.skip("bundle failed to build; see the bundle test");
    if (legError) return ctx.skip("the C# leg is not registered; see the REGISTRATION test");
    return fn(ctx);
  });

// Rows that need a solution on disk skip separately, so a fixture problem never
// reads as a contract failure.
const fstest = (name, fn) =>
  test(name, (ctx) => {
    if (bundleError) return ctx.skip("bundle failed to build; see the bundle test");
    if (legError) return ctx.skip("the C# leg is not registered; see the REGISTRATION test");
    if (fixtureError) return ctx.skip(`temp fixtures unavailable: ${fixtureError}`);
    return fn(ctx);
  });

test("FIXTURES: the temp solutions built, under the SYSTEM TEMP area and never inside the repo [contract-cs.md 'Never write TRX or any output inside the human's repo' - which binds the PRODUCT, so this oracle's own fixtures stay out of the tree too]", (ctx) => {
  assert.ok(!fixtureError, fixtureError || "");
  assert.ok(base.startsWith(os.tmpdir()), `the fixture base sits in system temp, got ${base}`);
  assert.ok(
    !base.startsWith(path.resolve(__dirname, "..")),
    "no fixture is written into the repository under test"
  );
});

// ---------------------------------------------------------------------------
// Shared helpers.
// ---------------------------------------------------------------------------

const fsDeps = {
  fileExists: (p) => {
    try {
      return fs.existsSync(p);
    } catch {
      return false;
    }
  },
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
  log: () => {},
  probe: () => ({ exitCode: 0 }),
};

const placeOk = (filePath, symbol) => {
  const res = csLang.placementFor(filePath, symbol, fsDeps);
  assert.strictEqual(
    res.ok,
    true,
    `expected a placement for ${filePath}, got refusal ${JSON.stringify(res.refusal)}`
  );
  return res.placement;
};

const fwById = (id) => {
  assert.ok(Array.isArray(csLang.frameworks), "frameworks is an array in precedence order");
  const fw = csLang.frameworks.find((f) => f.id === id);
  assert.ok(
    fw,
    `a ${id} framework entry exists, got ${JSON.stringify(csLang.frameworks.map((f) => f.id))}`
  );
  return fw;
};

const mstestFw = () => fwById("mstest");
const xunitFw = () => fwById("xunit");
const nunitFw = () => fwById("nunit");

// A flag may ride as two args, as `--flag=value`, or joined into one word. All
// three spell the same command line, so extract rather than pinning an encoding.
const flagValue = (args, flag) => {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === flag) return args[i + 1];
    if (a.startsWith(flag + "=")) return a.slice(flag.length + 1);
    if (a.startsWith(flag + " ")) return a.slice(flag.length + 1);
  }
  return undefined;
};

// The TRX content arrives as the `stdout` argument, per Amendment 6c: the runner
// reads TestRunCommand.outputFile and hands its CONTENT to parseOutput. See seam
// gap (a) in the header.
const parse = (trx, exitCode, stderr = "") => mstestFw().parseOutput(trx, stderr, exitCode);

const applyPlan = (existingText, plan) =>
  existingText.slice(0, plan.start) + plan.text + existingText.slice(plan.end);

// Every path and size under a root, for proving the gesture created nothing.
const treeOf = (root) => {
  const out = [];
  const walk = (dir, rel) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries.slice().sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(dir, e.name);
      const r = rel ? rel + "/" + e.name : e.name;
      if (e.isDirectory()) {
        out.push(r + "/");
        walk(p, r);
      } else {
        out.push(`${r}:${fs.statSync(p).size}`);
      }
    }
  };
  walk(root, "");
  return out;
};

const DOC = "/// <summary>Widens n.</summary>";

const SRC_PROJECT = () => path.join(R.sln, "Contoso.ProcessingLogic");
const TEST_PROJECT = () => path.join(R.sln, "Contoso.ProcessingLogic.Tests");
const WIDEN_PATH = () => path.join(SRC_PROJECT(), "Widen.cs");
const GAPS_PATH = () => path.join(SRC_PROJECT(), "Gaps", "GapAnalysis.cs");

// ===========================================================================
// 1. Registration and shape. This is the LAST leg, so the whole table closes
//    here.
//    [contract-cs.md 'Registers "csharp" in tddLangFor'; contract-seam.md
//     'Go, TypeScript, Python and C# are phases 2 to 5']
// ===========================================================================

ptest("csharp TddLang: languageId is 'csharp' and displayName names C# [contract-seam.md 'readonly languageId'; 'Named in every refusal, e.g. \"Go\", \"TypeScript\", \"C#\"']", () => {
  assert.strictEqual(csLang.languageId, "csharp", "the languageId round-trips the lookup key");
  assert.strictEqual(typeof csLang.displayName, "string", "displayName is a string");
  assert.ok(
    csLang.displayName.includes("C#"),
    `every refusal names the language, so displayName must say C#, got ${JSON.stringify(csLang.displayName)}`
  );
});

ptest("csharp TddLang: markerPrefix is '//' - one source of the marker format so scaffold and generatedTestNames cannot drift [contract-cs.md '`markerPrefix` is `\"//\"`'; contract-seam.md '\"//\" for four languages, \"#\" for Python']", () => {
  assert.strictEqual(
    csLang.markerPrefix,
    "//",
    `a "#" marker is not a C# comment and the generated file would not compile. Got ${JSON.stringify(csLang.markerPrefix)}`
  );
});

ptest("csharp TddLang: frameworks are exactly ['mstest', 'xunit', 'nunit'] IN PRECEDENCE ORDER, and each carries its OWN assertionInstruction because the argument order differs WITHIN the language [contract-cs.md '## Framework detection, in precedence order'; contract-seam.md 'Keyed per framework, not per language, because assertion argument order differs WITHIN a language']", () => {
  assert.deepStrictEqual(
    csLang.frameworks.map((f) => f.id),
    ["mstest", "xunit", "nunit"],
    `MSTest first because Contoso is MSTest 4.0.1. Got ${JSON.stringify(csLang.frameworks.map((f) => f.id))}`
  );
  for (const fw of csLang.frameworks) {
    assert.strictEqual(typeof fw.displayName, "string", `${fw.id}: displayName carries the honest-dark name`);
    assert.strictEqual(
      typeof fw.assertionInstruction,
      "string",
      `${fw.id}: the prompt fragment naming ITS assertion idiom, because Assert.AreEqual(expected, actual) and Assert.That(actual, Is.EqualTo(expected)) are different instructions`
    );
    assert.ok(fw.assertionInstruction.length > 0, `${fw.id}: an empty instruction tells the model nothing`);
  }
});

ptest("REGISTRATION, THE LAST LEG: all five languages now resolve, and each answers with its OWN languageId - this is the row that closes the table goal.md opened [contract-seam.md 'Only Rust, and only as a thin adapter. Go, TypeScript, Python and C# are phases 2 to 5']", () => {
  for (const id of ["rust", "go", "typescript", "python", "csharp"]) {
    const lang = tddLangFor(id);
    assert.ok(lang, `${id} must resolve now that phase 5 has landed; got ${JSON.stringify(lang)}`);
    assert.strictEqual(lang.languageId, id, `${id}: the resolved leg answers with its own id`);
    assert.strictEqual(typeof lang.markerPrefix, "string", `${id}: markerPrefix is present`);
    assert.ok(Array.isArray(lang.frameworks) && lang.frameworks.length > 0, `${id}: at least one framework entry`);
  }
});

ptest("REGISTRATION: a GENUINELY unknown language id still returns undefined, so the gesture refuses by naming the language rather than guessing a leg [contract-seam.md 'undefined means the gesture refuses by naming the language, exactly as oracleFor does for the check']", () => {
  for (const id of ["ruby", "java", "kotlin", "elixir", "plaintext", "markdown", "", "cs"]) {
    assert.strictEqual(
      tddLangFor(id),
      undefined,
      `${JSON.stringify(id)} has no leg, and answering with one would run the wrong toolchain. Got ${JSON.stringify(tddLangFor(id))}`
    );
  }
});

// ===========================================================================
// 2. Placement. FIND the test project, NEVER create it. The only leg whose
//    target lives in a different PROJECT from the source.
//    [contract-cs.md '## Placement: find the test project, NEVER create it']
// ===========================================================================

fstest("placementFor csharp: finds the test project carrying BOTH <IsTestProject>true</IsTestProject> and a <ProjectReference> back, and the mode is 'project-file' [contract-cs.md 'From the source file's .csproj, find a project that carries BOTH ... Both signals are present in Contoso.ProcessingLogic.Tests.csproj, PROVEN by reading it']", () => {
  const p = placeOk(WIDEN_PATH(), "Apply");
  assert.strictEqual(
    p.mode,
    "project-file",
    `C# is the only leg whose target lives in a different PROJECT from the source. Got ${JSON.stringify(p.mode)}`
  );
  assert.strictEqual(
    p.targetPath,
    path.join(TEST_PROJECT(), "WidenTests.cs"),
    `the file is <SourceType>Tests.cs inside the test project. Got ${p.targetPath}`
  );
  assert.strictEqual(p.exists, false, "the file is not on disk, so the gesture is creating one");
});

fstest("placementFor csharp: runRoot is the TEST project's directory, NOT the source project's - THIS is the case that forced the rung to take a resolved placement rather than a file path [contract-cs.md '`runRoot` is the TEST project's directory, NOT the source project's. This is the case that forced the rung to take a resolved placement rather than a file path'; contract-seam.md 'C# runs from the test project, which is a peer of the source project']", () => {
  const p = placeOk(WIDEN_PATH(), "Apply");
  assert.strictEqual(
    p.runRoot,
    TEST_PROJECT(),
    `dotnet test runs from the TEST project. Got ${p.runRoot}`
  );
  assert.notStrictEqual(
    p.runRoot,
    SRC_PROJECT(),
    "running from the source project would build a project with no test host and report nothing the human can use"
  );
  assert.ok(
    p.targetPath.startsWith(p.runRoot + path.sep),
    `the generated file lives under runRoot, got ${p.targetPath} against ${p.runRoot}`
  );
});

fstest("placementFor csharp: targetPath MIRRORS the source's folder path inside the test project, so Gaps/GapAnalysis.cs becomes Gaps/GapAnalysisTests.cs [contract-cs.md '`targetPath` is `<TestProject>/<mirrored source folder>/<SourceType>Tests.cs`. Mirror the source's folder path within the test project']", () => {
  const p = placeOk(GAPS_PATH(), "GapsOverlap");
  assert.strictEqual(
    p.targetPath,
    path.join(TEST_PROJECT(), "Gaps", "GapAnalysisTests.cs"),
    `the source sits in Gaps/, so the test does too, or a 200-file project grows a flat test folder. Got ${p.targetPath}`
  );
  assert.strictEqual(p.runRoot, TEST_PROJECT(), "the mirrored folder does not move runRoot");
});

fstest("placementFor csharp: `exists` tracks whether the target file is already on disk, which is what decides create-versus-extend [contract-seam.md 'True when targetPath already exists on disk'; contract-cs.md 'Create when absent, extend when present']", () => {
  const already = path.join(R.slnExists, "Contoso.ProcessingLogic", "Widen.cs");
  const p = placeOk(already, "Apply");
  assert.strictEqual(
    p.targetPath,
    path.join(R.slnExists, "Contoso.ProcessingLogic.Tests", "WidenTests.cs"),
    `the same target, already written. Got ${p.targetPath}`
  );
  assert.strictEqual(p.exists, true, "WidenTests.cs is on disk, so the gesture is extending it");
});

fstest("placementFor csharp: the ProjectReference back to the source may be spelled with MSBuild's own BACKSLASH separator, which is how every real .csproj on this machine spells it [contract-cs.md 'a `<ProjectReference>` back to the source project']", () => {
  const p = placeOk(path.join(R.backslash, "Lib", "Widen.cs"), "Apply");
  assert.strictEqual(
    p.runRoot,
    path.join(R.backslash, "Lib.Tests"),
    `..\\Lib\\Lib.csproj names the same project as ../Lib/Lib.csproj. A leg that only splits on "/" finds no test project for any real solution. Got ${p.runRoot}`
  );
});

fstest("placementFor csharp: EITHER signal identifies the test project - Microsoft.NET.Test.Sdk alone, or <IsTestProject> alone [contract-cs.md '`<IsTestProject>true</IsTestProject>`, OR a `Microsoft.NET.Test.Sdk` package reference']", () => {
  const sdk = placeOk(path.join(R.sdkOnly, "Lib", "Widen.cs"), "Apply");
  assert.strictEqual(
    sdk.runRoot,
    path.join(R.sdkOnly, "Lib.Tests"),
    `a Microsoft.NET.Test.Sdk reference is enough on its own, got ${sdk.runRoot}`
  );
  const flag = placeOk(path.join(R.isTestOnly, "Lib", "Widen.cs"), "Apply");
  assert.strictEqual(
    flag.runRoot,
    path.join(R.isTestOnly, "Lib.Tests"),
    `<IsTestProject>true</IsTestProject> is enough on its own, got ${flag.runRoot}`
  );
});

fstest("placementFor csharp: the ProjectReference is REQUIRED - a test project that references some OTHER project is not this source's test project and refuses 'no-test-project' [contract-cs.md 'find a project that carries BOTH ... AND a <ProjectReference> back to the source project']", () => {
  const res = csLang.placementFor(path.join(R.noRef, "Lib", "Widen.cs"), "Apply", fsDeps);
  assert.strictEqual(
    res.ok,
    false,
    `Other.Tests references Unrelated, not Lib. Writing into it produces a test file that cannot see the unit under test. Got placement ${JSON.stringify(res.placement)}`
  );
  assert.strictEqual(res.refusal.reason, "no-test-project", "the enumerated reason, not free text");
});

fstest("placementFor csharp: NO test project refuses 'no-test-project' and the detail NAMES what was looked for - the human's stated boundary is that the gesture creates a test FILE, never a test PROJECT [contract-cs.md 'No such project: refuse `no-test-project`, naming what is missing ... The refusal must say that a `*.Tests` project with a reference back to this project was looked for and not found']", () => {
  const res = csLang.placementFor(path.join(R.noTests, "Lib", "Widen.cs"), "Apply", fsDeps);
  assert.strictEqual(res.ok, false, "there is no test project, and creating one is forbidden");
  assert.strictEqual(res.refusal.reason, "no-test-project", "the enumerated reason");
  assert.strictEqual(res.placement, undefined, "a refusal never smuggles a half-built placement through");
  const d = res.refusal.detail;
  assert.strictEqual(typeof d, "string", "the refusal carries a human-facing detail");
  assert.ok(
    /\.Tests\b|Tests\b/.test(d),
    `the detail says a *.Tests project was looked for, or the human cannot tell what to create. Got ${JSON.stringify(d)}`
  );
  assert.ok(
    /reference/i.test(d),
    `the detail says the project must REFERENCE this one, which is the other half of what was looked for. Got ${JSON.stringify(d)}`
  );
  assert.ok(
    d.includes("Lib"),
    `the detail names the source project, or the human does not know which project needs the reference. Got ${JSON.stringify(d)}`
  );
});

fstest("placementFor csharp: NEVER CREATES ANYTHING. The tree is byte-identical after a successful placement AND after a refusal - no .csproj, no directory, not even the target file [contract-cs.md '**Never create a test PROJECT.** The human's boundary. No `.csproj`, no `dotnet new`']", () => {
  for (const [label, root, src] of [
    ["a solution that resolves", R.sln, WIDEN_PATH()],
    ["a solution with no test project", R.noTests, path.join(R.noTests, "Lib", "Widen.cs")],
    ["a solution whose test project references something else", R.noRef, path.join(R.noRef, "Lib", "Widen.cs")],
    ["a solution with two candidates", R.ambigUnresolvable, path.join(R.ambigUnresolvable, "Lib", "Widen.cs")],
  ]) {
    const before = treeOf(root);
    csLang.placementFor(src, "Apply", fsDeps);
    assert.deepStrictEqual(
      treeOf(root),
      before,
      `${label}: placement RESOLVES a path and writes nothing. Anything new on disk here is the boundary the human drew being crossed`
    );
  }
});

fstest("placementFor csharp, THE ONE-TO-MANY TRAP: one test project referencing THREE source projects still places a DataModel source correctly - Contoso.ProcessingLogic.Tests references Contoso.DataModel, Contoso.ProcessingLogic AND Contoso.Portal.Api [contract-cs.md '**Note the one-to-many trap:** ... So a single test project can reference several source projects']", () => {
  const p = placeOk(path.join(R.sln, "Contoso.DataModel", "DtoGapAnalysis.cs"), "Total");
  assert.strictEqual(
    p.runRoot,
    TEST_PROJECT(),
    `one candidate matches, however many source projects it references, so there is nothing to disambiguate. Got ${p.runRoot}`
  );
  assert.strictEqual(
    p.targetPath,
    path.join(TEST_PROJECT(), "DtoGapAnalysisTests.cs"),
    `the mirrored path is relative to the DataModel project, not to the solution. Got ${p.targetPath}`
  );
});

fstest("placementFor csharp, THE ONE-TO-MANY TRAP, half 2: TWO candidate test projects both reference the source, and the one named <SourceProject>.Tests WINS [contract-cs.md 'When more than one candidate matches, prefer the one whose name is the source project's name plus `.Tests`']", () => {
  const p = placeOk(path.join(R.ambigResolvable, "Lib", "Widen.cs"), "Apply");
  assert.strictEqual(
    p.runRoot,
    path.join(R.ambigResolvable, "Lib.Tests"),
    `Lib.Tests and Lib.IntegrationTests both reference Lib; the name rule settles it without a guess. Got ${p.runRoot}`
  );
});

// RE-CUT to Amendment 8b, which added the reason this row had nowhere to bind.
fstest("placementFor csharp, THE ONE-TO-MANY TRAP, half 3: when the name rule does NOT disambiguate, refuse with the RATIFIED reason 'ambiguous-test-project' and NAME THE CANDIDATES rather than guessing [contract-cs.md 'when that does not disambiguate, refuse and name the candidates rather than guessing'; contract-seam.md 'ADDED phase 5 (Amendment 8b). More than one test project matched and the <Source>.Tests preference did not disambiguate. detail NAMES the candidates']", () => {
  const res = csLang.placementFor(path.join(R.ambigUnresolvable, "Lib", "Widen.cs"), "Apply", fsDeps);
  assert.strictEqual(
    res.ok,
    false,
    `Alpha.Tests and Beta.Tests both reference Lib and neither is Lib.Tests. Picking one writes the human's tests into a project they did not choose. Got placement ${JSON.stringify(res.placement)}`
  );
  assert.strictEqual(
    res.refusal.reason,
    "ambiguous-test-project",
    `ambiguity has its own reason now, so a consumer can tell it from "there is no test project at all" without reading prose. Got ${JSON.stringify(res.refusal.reason)}`
  );
  assert.ok(
    res.refusal.detail.includes("Alpha.Tests"),
    `the detail NAMES the first candidate, so the human can pick. Got ${JSON.stringify(res.refusal.detail)}`
  );
  assert.ok(
    res.refusal.detail.includes("Beta.Tests"),
    `and the second. A refusal that says "ambiguous" without naming them is a shrug. Got ${JSON.stringify(res.refusal.detail)}`
  );
});

// RE-CUT. The mirrored-folder half was previously left loose; Amendment 8's
// closing section settles it exactly.
fstest("placementFor csharp: packageName carries the namespace the generated file DECLARES, and a MIRRORED source folder mirrors into the namespace too - Gaps/GapAnalysis.cs declares <TestProject>.Gaps, not the test project's root namespace [contract-cs.md '`packageName` carries the namespace the generated file declares'; goal.md Amendment 8 '`packageName` for a mirrored folder: the generated file's namespace mirrors the source folder path within the test project, so `Gaps/Analysis.cs` gives `<TestProject>.Gaps`']", () => {
  const p = placeOk(WIDEN_PATH(), "Apply");
  assert.strictEqual(
    p.packageName,
    "Contoso.ProcessingLogic.Tests",
    `a root-level source file declares the test project's own namespace, which is what the contract's scaffold spells. Got ${JSON.stringify(p.packageName)}`
  );
  const nested = placeOk(GAPS_PATH(), "GapsOverlap");
  assert.strictEqual(
    nested.packageName,
    "Contoso.ProcessingLogic.Tests.Gaps",
    `the folder mirror runs through the namespace as well as the path, or the file sits in Gaps/ declaring a namespace that does not match its folder, which is the thing every C# codebase convention exists to avoid. Got ${JSON.stringify(nested.packageName)}`
  );
});

fstest("placementFor csharp: importLine is a `using` for the SOURCE type's namespace when that namespace is not already implied - Gaps/GapAnalysis.cs declares Contoso.ProcessingLogic.Gaps, which the test file's own namespace does NOT enclose [contract-cs.md '`importLine` is a `using` for the source type's namespace, when it is not already implied']", () => {
  const nested = placeOk(GAPS_PATH(), "GapsOverlap");
  assert.strictEqual(
    typeof nested.importLine,
    "string",
    `without the using, GapAnalysis does not resolve from Contoso.ProcessingLogic.Tests and the generated file does not compile. Got ${JSON.stringify(nested.importLine)}`
  );
  assert.ok(
    /^\s*using\s+Contoso\.ProcessingLogic\.Gaps\s*;/.test(nested.importLine),
    `the using names the namespace the SOURCE FILE declares, not one guessed from the directory. Got ${JSON.stringify(nested.importLine)}`
  );

  // The root-level case is deliberately looser: C# name lookup searches
  // ENCLOSING namespaces, so a file in Contoso.ProcessingLogic.Tests already
  // sees Contoso.ProcessingLogic without a using. Both answers are legal, so
  // this row pins only that a present importLine is a well-formed using.
  const root = placeOk(WIDEN_PATH(), "Apply");
  if (root.importLine !== undefined) {
    assert.ok(
      /^\s*using\s+Contoso\.ProcessingLogic\s*;/.test(root.importLine),
      `a using that is emitted must name the source namespace. Got ${JSON.stringify(root.importLine)}`
    );
  }
});

// RE-CUT. This row previously pinned packageArg undefined and the human ruled
// against it: the test project path is passed EXPLICITLY rather than inferred
// from cwd, because cwd alone breaks when the directory also holds a `.sln`, and
// the contract's own command line always showed the project as an argument.
fstest("placementFor csharp: packageArg carries the TEST PROJECT's .csproj, the way Go carries its package path - the project is passed EXPLICITLY because inferring it from cwd breaks when the directory also holds a .sln [contract-cs.md 'the test project path is passed EXPLICITLY as an argument rather than being inferred from cwd, carried on `TestPlacement.packageArg` the way Go carries its package path. Relying on cwd alone breaks when the directory also holds a `.sln`']", () => {
  const p = placeOk(WIDEN_PATH(), "Apply");
  assert.strictEqual(
    typeof p.packageArg,
    "string",
    `dotnet test needs the project named, and placement is the only step that resolved it. Got ${JSON.stringify(p.packageArg)}`
  );
  assert.ok(
    p.packageArg.endsWith(".csproj"),
    `the argument is a project file, not a directory: a directory holding a .sln is exactly the ambiguity this avoids. Got ${JSON.stringify(p.packageArg)}`
  );
  // The seam spells packageArg "relative to runRoot", so accept either spelling
  // and require only that it RESOLVES to the test project's own .csproj.
  const resolved = path.isAbsolute(p.packageArg) ? p.packageArg : path.resolve(p.runRoot, p.packageArg);
  assert.strictEqual(
    path.resolve(resolved),
    path.join(TEST_PROJECT(), "Contoso.ProcessingLogic.Tests.csproj"),
    `it names the TEST project, not the source project and not the solution. Got ${resolved}`
  );
});

// ===========================================================================
// 3. Framework detection, in precedence order, from the TEST project's package
//    references.
//    [contract-cs.md '## Framework detection, in precedence order']
// ===========================================================================

fstest("frameworkFor csharp: MSTest detects from the test project's package references and WINS the precedence - Contoso is MSTest 4.0.1 [contract-cs.md '1. **MSTest**: `MSTest`, `MSTest.TestFramework` or `MSTest.TestAdapter`. Contoso is MSTest 4.0.1']", () => {
  const res = frameworkFor(csLang, TEST_PROJECT(), fsDeps);
  assert.strictEqual(res.ok, true, `MSTest is configured, so the rung resolves. Got ${JSON.stringify(res)}`);
  assert.strictEqual(res.framework.id, "mstest", `got ${JSON.stringify(res.framework.id)}`);
});

fstest("frameworkFor csharp: xUnit and NUnit each detect from their OWN package reference [contract-cs.md '2. **xUnit**: `xunit`. 3. **NUnit**: `NUnit`']", () => {
  const x = frameworkFor(csLang, path.join(R.sdkOnly, "Lib.Tests"), fsDeps);
  assert.strictEqual(x.ok, true, `an xunit package reference resolves the rung. Got ${JSON.stringify(x)}`);
  assert.strictEqual(x.framework.id, "xunit", `got ${JSON.stringify(x.framework.id)}`);

  const n = frameworkFor(csLang, path.join(R.isTestOnly, "Lib.Tests"), fsDeps);
  assert.strictEqual(n.ok, true, `an NUnit package reference resolves the rung. Got ${JSON.stringify(n)}`);
  assert.strictEqual(n.framework.id, "nunit", `got ${JSON.stringify(n.framework.id)}`);
});

fstest("frameworkFor csharp: NO framework is HONEST-DARK and names ALL THREE that were looked for - never install one [contract-cs.md 'None found is honest-dark: refuse and name all three. Never install one'; goal.md 'Never install a framework ... No configured framework means honest-dark with the frameworks named']", () => {
  const res = frameworkFor(csLang, path.join(R.noFramework, "Lib.Tests"), fsDeps);
  assert.strictEqual(
    res.ok,
    false,
    `a test project with Microsoft.NET.Test.Sdk and no assertion library has no rung. Got ${JSON.stringify(res)}`
  );
  assert.ok(Array.isArray(res.lookedFor), `lookedFor is the list of names the human reads, got ${JSON.stringify(res.lookedFor)}`);
  const joined = res.lookedFor.join(" | ");
  for (const name of ["MSTest", "xUnit", "NUnit"]) {
    assert.ok(
      new RegExp(name, "i").test(joined),
      `${name} was looked for and must be named, or the human cannot tell which three to choose between. Got ${JSON.stringify(res.lookedFor)}`
    );
  }
});

fstest("detect csharp: each framework's detect is a BOOLEAN over the injected deps and does not fire for another framework's project [contract-seam.md 'Is this framework configured in the project at root? Pure over the injected deps']", () => {
  const cases = [
    ["mstest", mstestFw(), TEST_PROJECT(), path.join(R.sdkOnly, "Lib.Tests")],
    ["xunit", xunitFw(), path.join(R.sdkOnly, "Lib.Tests"), TEST_PROJECT()],
    ["nunit", nunitFw(), path.join(R.isTestOnly, "Lib.Tests"), TEST_PROJECT()],
  ];
  for (const [id, fw, hit, miss] of cases) {
    assert.strictEqual(fw.detect(hit, fsDeps), true, `${id}: detects its own package reference at ${hit}`);
    assert.strictEqual(
      fw.detect(miss, fsDeps),
      false,
      `${id}: must not fire for a project configured with a different framework, or the generated assertions use the wrong idiom entirely`
    );
    assert.strictEqual(
      fw.detect(path.join(R.noFramework, "Lib.Tests"), fsDeps),
      false,
      `${id}: no package reference means no detection`
    );
  }
});

// ===========================================================================
// 4. Microsoft.Testing.Platform STAYS DARK. Detected and refused by NAME, never
//    a second command path.
//    [contract-cs.md '## Microsoft.Testing.Platform, and it does not break
//     silently'; scout-findings.md 'Item 3 ... Finding 1']
// ===========================================================================

// RE-CUT to Amendment 8b, which added the reason AND the detail field this row
// previously had to go hunting for across two channels.
fstest("MTP STAYS DARK: a test project carrying <EnableMSTestRunner>true</EnableMSTestRunner> refuses with the RATIFIED reason 'unsupported-runner', and the detail NAMES THE PROPERTY - under SDK 10 `dotnet test --filter` hard fails there, and shipping a second command path no corpus exercises is the dishonest alternative [contract-cs.md '**Detect `EnableMSTestRunner` in the test project and stay dark on it** with a refusal naming the property'; contract-seam.md 'ADDED phase 5 (Amendment 8b). The test project opts into a runner this build does not support (<EnableMSTestRunner>). detail NAMES the property']", () => {
  const res = csLang.placementFor(path.join(R.mtp, "Lib", "Widen.cs"), "Apply", fsDeps);
  assert.strictEqual(
    res.ok,
    false,
    `an MTP project must never reach a VSTest command line: that path hard fails with "Testing with VSTest target is no longer supported". Got placement ${JSON.stringify(res.placement)}`
  );
  assert.strictEqual(
    res.refusal.reason,
    "unsupported-runner",
    `staying dark is its own reason now, distinct from "no test project" and from ambiguity. Got ${JSON.stringify(res.refusal.reason)}`
  );
  assert.ok(
    /EnableMSTestRunner/.test(res.refusal.detail),
    `the human reads the PROPERTY NAME and knows exactly which line to look at. Got ${JSON.stringify(res.refusal.detail)}`
  );
});

fstest("frameworkFor csharp: the honest-dark refusal may carry a `detail` alongside `lookedFor`, per Amendment 8b - and when it does, it stays a string rather than a smuggled object [contract-seam.md '{ ok: false; lookedFor: string[]; detail?: string }']", () => {
  const res = frameworkFor(csLang, path.join(R.noFramework, "Lib.Tests"), fsDeps);
  assert.strictEqual(res.ok, false, "no framework is configured");
  if (res.detail !== undefined) {
    assert.strictEqual(typeof res.detail, "string", `detail is human-facing prose, got ${JSON.stringify(res.detail)}`);
    assert.ok(res.detail.length > 0, "an empty detail says nothing the lookedFor list did not");
  }
});

// ===========================================================================
// 5. The command. Every flag is load-bearing, and one absence is.
//    [contract-cs.md '## The command']
// ===========================================================================

const cmdFor = (names) => {
  const p = placeOk(WIDEN_PATH(), "Apply");
  const cmd = mstestFw().buildCommand(p, names);
  assert.ok(Array.isArray(cmd.args), "args is an array, not a shell string");
  return { cmd, placement: p };
};

const filterOf = (args) => flagValue(args, "--filter");

fstest("mstest.buildCommand: `dotnet test <testProject>` with cwd = runRoot, the TEST project's directory [contract-cs.md '```dotnet test <testProjectPath> --filter ...``` cwd is `runRoot`']", () => {
  const { cmd, placement } = cmdFor(["WidenHappy"]);
  assert.strictEqual(cmd.command, "dotnet", `the program is the dotnet CLI, got ${JSON.stringify(cmd.command)}`);
  assert.strictEqual(cmd.args[0], "test", `the first argument is the verb, got ${JSON.stringify(cmd.args)}`);
  assert.ok(
    cmd.args.includes(placement.packageArg),
    `the resolved packageArg rides onto the command line verbatim, or dotnet test picks whatever project is under cwd. Got ${JSON.stringify(cmd.args)} against packageArg ${JSON.stringify(placement.packageArg)}`
  );
  assert.strictEqual(cmd.cwd, placement.runRoot, "cwd is runRoot, which for C# is the TEST project's directory");
  assert.strictEqual(cmd.cwd, TEST_PROJECT(), `and that is not the source project. Got ${cmd.cwd}`);
});

fstest("mstest.buildCommand: the filter is `FullyQualifiedName~A|FullyQualifiedName~B`, one clause PER NAME, alternation-joined [contract-cs.md '--filter \"FullyQualifiedName~A|FullyQualifiedName~B\"']", () => {
  const { cmd } = cmdFor(["WidenHappy", "WidenZero"]);
  const filter = filterOf(cmd.args);
  assert.strictEqual(typeof filter, "string", `the command carries a --filter, got ${JSON.stringify(cmd.args)}`);
  const clauses = filter.split("|");
  assert.strictEqual(clauses.length, 2, `two names, two clauses, got ${JSON.stringify(filter)}`);
  for (const name of ["WidenHappy", "WidenZero"]) {
    assert.ok(
      clauses.some((c) => c.trim() === `FullyQualifiedName~${name}`),
      `${name} rides as its own FullyQualifiedName~ clause, got ${JSON.stringify(filter)}`
    );
  }
});

fstest("mstest.buildCommand: `FullyQualifiedName~` is a CONTAINS match with NO ANCHOR, unlike Go's `^(...)$` and vitest's `$`, so a generated name that PREFIXES another selects both - the contract's only mitigation is names carrying the symbol, and an invented `^`/`$` would be matched LITERALLY and select nothing [contract-cs.md '`FullyQualifiedName~` is a CONTAINS match, not an exact match, so a generated name that is a prefix of another test's name selects both ... unlike Go's `^(...)$` and vitest's `$`, VSTest's filter syntax has no anchor']", () => {
  const { cmd } = cmdFor(["WidenHappy", "WidenHappyPath"]);
  const filter = filterOf(cmd.args);
  assert.ok(
    !filter.includes("^") && !filter.includes("$"),
    `VSTest has no anchor syntax: a "^" or "$" here is a literal character in a CONTAINS match and selects nothing at all. Got ${JSON.stringify(filter)}`
  );
  const clauses = filter.split("|").map((c) => c.trim());
  assert.deepStrictEqual(
    clauses.slice().sort(),
    ["FullyQualifiedName~WidenHappy", "FullyQualifiedName~WidenHappyPath"],
    `both names still get their own clause: the residual over-selection is accepted by the contract, silently DROPPING a name is not. Got ${JSON.stringify(filter)}`
  );
  assert.ok(
    filter.includes("Widen"),
    `the mitigation is that generated names carry the SYMBOL name, so the contains match stays scoped to this function's tests. Got ${JSON.stringify(filter)}`
  );
});

fstest("mstest.buildCommand: `--logger trx` with a LogFileName, and `--results-directory` in the SYSTEM TEMP area - NEVER inside runRoot and NEVER inside the source project [contract-cs.md '--logger \"trx;LogFileName=<name>.trx\" --results-directory <SYSTEM TEMP DIR>'; '**The results directory MUST be in the system temp area, never inside the human's repo.**']", () => {
  const { cmd, placement } = cmdFor(["WidenHappy"]);
  const logger = flagValue(cmd.args, "--logger");
  assert.strictEqual(typeof logger, "string", `the command carries a --logger, got ${JSON.stringify(cmd.args)}`);
  assert.ok(/^trx\b/.test(logger), `the trx logger is what makes the parse structural, got ${JSON.stringify(logger)}`);
  assert.ok(/LogFileName=/.test(logger), `a named file is what outputFile can point at, got ${JSON.stringify(logger)}`);

  const dir = flagValue(cmd.args, "--results-directory");
  assert.strictEqual(typeof dir, "string", `the command carries a --results-directory, got ${JSON.stringify(cmd.args)}`);
  assert.ok(path.isAbsolute(dir), `a relative results directory resolves against cwd, which IS the test project. Got ${JSON.stringify(dir)}`);

  const resolved = path.resolve(dir);
  assert.ok(
    !resolved.startsWith(path.resolve(placement.runRoot) + path.sep) && resolved !== path.resolve(placement.runRoot),
    `TRX must never land inside the test project. Got ${resolved} under runRoot ${placement.runRoot}`
  );
  assert.ok(
    !resolved.startsWith(path.resolve(SRC_PROJECT()) + path.sep),
    `nor inside the source project. Got ${resolved}`
  );
  assert.ok(
    !resolved.startsWith(path.resolve(R.sln) + path.sep),
    `nor anywhere else in the human's solution. Got ${resolved}`
  );

  const tmp = os.tmpdir();
  let realTmp = tmp;
  try {
    realTmp = fs.realpathSync(tmp);
  } catch {
    realTmp = tmp;
  }
  assert.ok(
    resolved.startsWith(tmp) || resolved.startsWith(realTmp),
    `"the system temp area" means the platform's temp dir, so the platform sweeps it rather than the human. Got ${resolved}`
  );
});

fstest("mstest.buildCommand: `outputFile` is SET to the TRX path, which is the channel Amendment 6c added for pytest - the runner reads the FILE and hands its content to parseOutput, because nothing parseable reaches stdout [contract-cs.md 'Set `TestRunCommand.outputFile` to the resulting TRX path, so the runner reads it via the channel Amendment 6c added for pytest'; contract-seam.md 'A path this command writes its STRUCTURED output to, rather than emitting it on stdout']", () => {
  const { cmd, placement } = cmdFor(["WidenHappy"]);
  assert.strictEqual(
    typeof cmd.outputFile,
    "string",
    `unset outputFile means the runner parses console text and the whole TRX decision is dead. Got ${JSON.stringify(cmd.outputFile)}`
  );
  assert.ok(cmd.outputFile.endsWith(".trx"), `the TRX file, got ${JSON.stringify(cmd.outputFile)}`);
  assert.ok(path.isAbsolute(cmd.outputFile), `an absolute path, since the runner reads it after the spawn. Got ${JSON.stringify(cmd.outputFile)}`);

  const dir = flagValue(cmd.args, "--results-directory");
  const logger = flagValue(cmd.args, "--logger") || "";
  const named = /LogFileName=([^;"']+)/.exec(logger);
  assert.ok(named, `the logger names the file, or outputFile is a guess about what VSTest chose. Got ${JSON.stringify(logger)}`);
  assert.strictEqual(
    path.resolve(cmd.outputFile),
    path.resolve(path.join(dir, named[1].trim())),
    `outputFile is exactly <results-directory>/<LogFileName>: any other path reads a file VSTest did not write. Got ${cmd.outputFile}`
  );
  assert.ok(
    !path.resolve(cmd.outputFile).startsWith(path.resolve(placement.runRoot) + path.sep),
    `and it stays out of the human's repo. Got ${cmd.outputFile}`
  );
});

fstest("mstest.buildCommand: the leg does NOT set DOTNET_ROLL_FORWARD - that is a MEASUREMENT tool only. A product that rolled forward silently could report GREEN where the human's own `dotnet test` hard-fails, which is the divergence GoOracle already warns about for GOENV=off [contract-cs.md '**And the product must NOT set roll-forward.** ... Never install, never offer the roll-forward as a fix the tool applies'; scout-findings.md 'For the product, the missing runtime is an environmentError: detect it, name what is missing, and stop']", () => {
  const { cmd } = cmdFor(["WidenHappy"]);
  if (cmd.env !== undefined) {
    assert.strictEqual(
      Object.prototype.hasOwnProperty.call(cmd.env, "DOTNET_ROLL_FORWARD"),
      false,
      `rolling forward runs the human's tests on a runtime their own command refuses. Got env ${JSON.stringify(cmd.env)}`
    );
  }
  const joined = cmd.args.join(" ");
  assert.ok(
    !/roll[-_]?forward/i.test(joined),
    `nor as a command-line switch. Got ${JSON.stringify(cmd.args)}`
  );
});

fstest("mstest.buildCommand: an EMPTY name list must NEVER run everything - a bare `dotnet test` runs the whole test project and reports the result as this function's [contract-cs.md 'The command'; goal.md 'the rung is scoped to exactly this function's tests']", () => {
  const p = placeOk(WIDEN_PATH(), "Apply");
  let cmd;
  try {
    cmd = mstestFw().buildCommand(p, []);
  } catch (e) {
    assert.ok(e instanceof Error, "a refusal by throw is an Error");
    return;
  }
  const filter = filterOf(cmd.args);
  assert.ok(
    typeof filter === "string" && filter.includes("FullyQualifiedName~") && filter.trim() !== "",
    `no filter, or an empty one, selects EVERY test in the project. Refusing upstream, or throwing here, are the only honest options. Got ${JSON.stringify(cmd.args)}`
  );
});

fstest("buildCommand: all three frameworks build the SAME dotnet command shape, because the runner is VSTest and not the assertion library [contract-cs.md '## The command'; contract-seam.md 'buildCommand(placement, testNames)']", () => {
  const p = placeOk(path.join(R.sdkOnly, "Lib", "Widen.cs"), "Apply");
  for (const fw of csLang.frameworks) {
    const cmd = fw.buildCommand(p, ["WidenHappy"]);
    assert.strictEqual(cmd.command, "dotnet", `${fw.id}: dotnet test drives all three, got ${JSON.stringify(cmd.command)}`);
    assert.ok(
      (filterOf(cmd.args) || "").includes("FullyQualifiedName~WidenHappy"),
      `${fw.id}: the VSTest filter syntax is the runner's, not the framework's. Got ${JSON.stringify(cmd.args)}`
    );
    assert.strictEqual(typeof cmd.outputFile, "string", `${fw.id}: TRX rides the outputFile channel for every framework`);
  }
});

// ===========================================================================
// 6. The TRX parse. Amendment 7 overturned the goal here ON MEASUREMENT:
//    passing tests ARE enumerated.
//    [contract-cs.md '## The parse: TRX, not console text'; goal.md
//     Amendment 7; scout-findings.md '`dotnet test --logger trx` overturns the
//     goal's C# fidelity limit']
// ===========================================================================

// CAPTURED from contract-cs.md's parse section and scout-findings.md's
// re-measurement, wrapped in the TestRun/Results/ResultSummary elements a real
// TRX carries and the DEFAULT namespace VSTest writes on the root element.
const TRX_MIXED =
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<TestRun id="8c84fa94-04c1-424b-9868-57a2d4851a1d" name="probe" xmlns="http://microsoft.com/schemas/VisualStudio/TeamTest/2010">\n' +
  "  <Results>\n" +
  '    <UnitTestResult testName="AggregateFanoutHappy" outcome="Failed" duration="00:00:00.0120000">\n' +
  "      <Output><ErrorInfo><Message>Assert.AreEqual failed. Expected:&lt;7&gt;. Actual:&lt;6&gt;.</Message>\n" +
  "      <StackTrace>   at Probe.Tests.AtlasTests.AggregateFanoutHappy() in /w/probe/AtlasTests.cs:line 12</StackTrace></ErrorInfo></Output>\n" +
  "    </UnitTestResult>\n" +
  '    <UnitTestResult testName="AggregateFanoutZero" outcome="Passed" duration="00:00:00.0010000" />\n' +
  "  </Results>\n" +
  '  <ResultSummary outcome="Completed">\n' +
  '    <Counters total="2" executed="2" passed="1" failed="1" error="0" timeout="0" aborted="0" inconclusive="0" passedButRunAborted="0" notRunnable="0" notExecuted="0" disconnected="0" warning="0" completed="0" inProgress="0" pending="0" />\n' +
  "  </ResultSummary>\n" +
  "</TestRun>\n";

// DERIVED from the capture above: the same document with an explicit NAMESPACE
// PREFIX on every element, which is the other legal spelling of the same XML and
// the one contract-cs.md tells the reader to tolerate.
const TRX_PREFIXED =
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<t:TestRun id="8c84fa94" xmlns:t="http://microsoft.com/schemas/VisualStudio/TeamTest/2010">\n' +
  "  <t:Results>\n" +
  '    <t:UnitTestResult testName="AggregateFanoutHappy" outcome="Failed">\n' +
  "      <t:Output><t:ErrorInfo><t:Message>Assert.AreEqual failed. Expected:&lt;7&gt;. Actual:&lt;6&gt;.</t:Message>\n" +
  "      <t:StackTrace>   at Probe.Tests.AtlasTests.AggregateFanoutHappy()</t:StackTrace></t:ErrorInfo></t:Output>\n" +
  "    </t:UnitTestResult>\n" +
  '    <t:UnitTestResult testName="AggregateFanoutZero" outcome="Passed" />\n' +
  "  </t:Results>\n" +
  '  <t:ResultSummary outcome="Completed">\n' +
  '    <t:Counters total="2" executed="2" passed="1" failed="1" notExecuted="0" />\n' +
  "  </t:ResultSummary>\n" +
  "</t:TestRun>\n";

// DERIVED: a run carrying all three outcomes, so NotExecuted has somewhere to
// land. `NotExecuted` is what VSTest writes for a skipped or ignored test.
const TRX_THREE_OUTCOMES =
  '<TestRun xmlns="http://microsoft.com/schemas/VisualStudio/TeamTest/2010">\n' +
  "  <Results>\n" +
  '    <UnitTestResult testName="WidenHappy" outcome="Passed" />\n' +
  '    <UnitTestResult testName="WidenWrong" outcome="Failed">\n' +
  "      <Output><ErrorInfo><Message>Assert.AreEqual failed. Expected:&lt;7&gt;. Actual:&lt;6&gt;.</Message><StackTrace>   at WidenTests.WidenWrong()</StackTrace></ErrorInfo></Output>\n" +
  "    </UnitTestResult>\n" +
  '    <UnitTestResult testName="WidenSkipped" outcome="NotExecuted" />\n' +
  "  </Results>\n" +
  '  <ResultSummary outcome="Completed">\n' +
  '    <Counters total="3" executed="2" passed="1" failed="1" notExecuted="1" />\n' +
  "  </ResultSummary>\n" +
  "</TestRun>\n";

ptest("parseOutput csharp: one case per <UnitTestResult>, named by `testName`, and PASSING TESTS APPEAR IN `cases` - goal.md item 5 said they could not and Amendment 7 OVERTURNED IT ON MEASUREMENT, twice, including on the real Contoso test project [goal.md Amendment 7 'Passing tests ARE enumerated. The limit was in the human-readable console output the goal's scout probed, not in the tool'; scout-findings.md 'TRX enumerated both PASSING tests by name']", () => {
  const p = parse(TRX_MIXED, 1);
  assert.strictEqual(p.cases.length, 2, `two <UnitTestResult> elements, two cases, got ${JSON.stringify(p.cases)}`);
  const names = p.cases.map((c) => c.name).sort();
  assert.deepStrictEqual(
    names,
    ["AggregateFanoutHappy", "AggregateFanoutZero"],
    `the PASSING test is present by name. A cases list holding only failures is the fidelity limit Amendment 7 removed. Got ${JSON.stringify(names)}`
  );
});

ptest("parseOutput csharp: `casesComplete` is TRUE, like every other leg - nothing in this build now sets it false, and no consumer has to learn that C# is special [goal.md Amendment 7 'C# fills `cases` completely and sets `casesComplete: true`, like every other language'; contract-cs.md '`casesComplete: true`, per Amendment 7']", () => {
  for (const [label, trx, exit] of [
    ["a mixed run", TRX_MIXED, 1],
    ["all three outcomes", TRX_THREE_OUTCOMES, 1],
  ]) {
    const p = parse(trx, exit);
    assert.strictEqual(
      p.casesComplete,
      true,
      `${label}: consumers may render cases as the whole run. Got ${JSON.stringify(p.casesComplete)}`
    );
  }
});

ptest("parseOutput csharp: `Passed` maps to pass, `Failed` to fail and `NotExecuted` to ignored, in the vocabulary TestCaseResult already uses [contract-cs.md '`cases`: one per `<UnitTestResult>`, name from `testName`, outcome from `outcome` (`Passed`/`Failed`/`NotExecuted`)'; contract-seam.md '`cases: TestCaseResult[]` from compilerOracle.ts, unchanged']", () => {
  const p = parse(TRX_THREE_OUTCOMES, 1);
  const byName = Object.fromEntries(p.cases.map((c) => [c.name, c.outcome]));
  assert.strictEqual(byName["WidenHappy"], "pass", `outcome="Passed" is a pass, got ${JSON.stringify(byName)}`);
  assert.strictEqual(byName["WidenWrong"], "fail", `outcome="Failed" is a fail, got ${JSON.stringify(byName)}`);
  assert.strictEqual(
    byName["WidenSkipped"],
    "ignored",
    `outcome="NotExecuted" is an ignored case, not a pass and not a fail: counting it either way misreports the run. Got ${JSON.stringify(byName)}`
  );
});

ptest("parseOutput csharp: the counts come from the <Counters> ATTRIBUTES, and `ran` is true when at least one <UnitTestResult> exists [contract-cs.md 'counts from the `<Counters>` ATTRIBUTES'; '`ran`: at least one `<UnitTestResult>`']", () => {
  const p = parse(TRX_MIXED, 1);
  assert.strictEqual(p.passed, 1, `passed="1", got ${p.passed}`);
  assert.strictEqual(p.failed, 1, `failed="1", got ${p.failed}`);
  assert.strictEqual(p.ran, true, "two results exist, so the run happened");

  const three = parse(TRX_THREE_OUTCOMES, 1);
  assert.strictEqual(three.passed, 1, `passed="1", got ${three.passed}`);
  assert.strictEqual(three.failed, 1, `failed="1", got ${three.failed}`);
  assert.strictEqual(three.ignored, 1, `notExecuted="1" is the ignored count, got ${three.ignored}`);
});

ptest("parseOutput csharp: the failure carries <ErrorInfo><Message> PLUS <StackTrace>, attributed to the test that produced it [contract-cs.md '`failures`: `<ErrorInfo><Message>` plus `<StackTrace>`']", () => {
  const p = parse(TRX_MIXED, 1);
  assert.strictEqual(p.failures.length, 1, `one failed result, one detail, got ${JSON.stringify(p.failures)}`);
  const f = p.failures[0];
  assert.strictEqual(f.name, "AggregateFanoutHappy", "the failure is named by its result's testName attribute");
  assert.ok(
    f.message.includes("Assert.AreEqual failed"),
    `the assertion message is what the human reads first, got ${JSON.stringify(f.message)}`
  );
  assert.ok(
    f.message.includes("Expected:<7>") && f.message.includes("Actual:<6>"),
    `XML entities are DECODED, or the human reads Expected:&lt;7&gt;. Got ${JSON.stringify(f.message)}`
  );
  assert.ok(
    f.message.includes("AtlasTests.cs:line 12") || f.message.includes("at Probe.Tests"),
    `the stack trace rides along, or the human cannot find the line. Got ${JSON.stringify(f.message)}`
  );
});

ptest("parseOutput csharp: a NAMESPACE PREFIX on every element parses identically - TRX namespaces its elements and the tolerant reader must not care which spelling VSTest used [contract-cs.md 'TRX namespaces its elements, so the reader must tolerate a namespace prefix']", () => {
  const bare = parse(TRX_MIXED, 1);
  const prefixed = parse(TRX_PREFIXED, 1);
  assert.strictEqual(
    prefixed.cases.length,
    bare.cases.length,
    `the prefix changes nothing, got ${JSON.stringify(prefixed.cases)}`
  );
  assert.deepStrictEqual(
    prefixed.cases.map((c) => c.name).sort(),
    ["AggregateFanoutHappy", "AggregateFanoutZero"],
    "the same two tests"
  );
  assert.strictEqual(prefixed.passed, 1, "counts still come off the Counters attributes");
  assert.strictEqual(prefixed.failed, 1);
  assert.strictEqual(prefixed.ran, true, "and the run still happened");
});

// DERIVED, and the reason C# moved off text: a test whose own output forges the
// console summary and a phantom result line. Counts are ATTRIBUTES and each
// result carries its own testName, so neither is reachable from character data.
const TRX_FORGERY =
  '<TestRun xmlns="http://microsoft.com/schemas/VisualStudio/TeamTest/2010">\n' +
  "  <Results>\n" +
  '    <UnitTestResult testName="WidenForge" outcome="Failed">\n' +
  "      <Output><StdOut>Failed!  - Failed:     0, Passed:    99, Skipped:     0, Total:    99\n" +
  '&lt;UnitTestResult testName="WidenPhantom" outcome="Passed" /&gt;</StdOut>\n' +
  "      <ErrorInfo><Message>Assert.AreEqual failed. Expected:&lt;7&gt;. Actual:&lt;6&gt;.</Message><StackTrace>   at WidenTests.WidenForge()</StackTrace></ErrorInfo></Output>\n" +
  "    </UnitTestResult>\n" +
  "  </Results>\n" +
  '  <ResultSummary outcome="Completed">\n' +
  '    <Counters total="1" executed="1" passed="0" failed="1" notExecuted="0" />\n' +
  "  </ResultSummary>\n" +
  "</TestRun>\n";

ptest("parseOutput csharp: a test that PRINTS a forged summary and a forged result element produces NO phantom case and NO forged count - C# was the last text parser in the build, and TRX closes the channel structurally [scout-findings.md 'And it closes the forgery, which matters because C# was the last text parser in the build. Counts are ATTRIBUTES ... A test printing `Failed! - Failed: 1, Passed: 99` into its own output cannot reach either']", () => {
  const p = parse(TRX_FORGERY, 1);
  assert.deepStrictEqual(
    p.cases.map((c) => c.name),
    ["WidenForge"],
    `one real result, whatever the test printed. Got ${JSON.stringify(p.cases)}`
  );
  assert.notStrictEqual(p.passed, 99, "the forged count must be unreachable, not merely unlikely");
  assert.strictEqual(p.passed, 0, `passed="0" is the attribute, got ${p.passed}`);
  assert.strictEqual(p.failed, 1, `failed="1" is the attribute, got ${p.failed}`);
});

ptest("parseOutput csharp: malformed XML gives a did-not-run result and NEVER throws, the same garbage tolerance every other parser here keeps [contract-cs.md 'Reuse the tolerant XML reader phase 4 built for junit. It survived truncation at every byte position, a 10.7MB document, CDATA and comments hiding fake elements']", () => {
  for (const [label, text, exitCode] of [
    ["empty", "", 1],
    ["truncated mid-element", TRX_MIXED.slice(0, 320), 1],
    ["never closed", "<TestRun><Results><UnitTestResult", 1],
    ["not xml at all", "MSBUILD : error MSB1011: more than one project\n", 1],
    ["arbitrary bytes", " ￿\n\n\t garbage <<< >>>", 1],
    ["an unterminated attribute", '<TestRun><Results><UnitTestResult testName="a outcome="Passed" />', 1],
    ["a comment hiding an element", "<TestRun><Results><!-- <UnitTestResult testName=\"Ghost\" outcome=\"Passed\" /> --></Results></TestRun>", 0],
  ]) {
    let p;
    assert.doesNotThrow(() => {
      p = parse(text, exitCode);
    }, `${label}: parseOutput never throws`);
    assert.strictEqual(p.passed, 0, `${label}: zero passed`);
    assert.strictEqual(p.failed, 0, `${label}: zero failed`);
    assert.ok(
      !p.cases.some((c) => c.name === "Ghost"),
      `${label}: a commented-out element is not a result. Got ${JSON.stringify(p.cases)}`
    );
    assert.strictEqual(typeof p.casesComplete, "boolean", `${label}: casesComplete is always present`);
  }
});

// ===========================================================================
// 7. THE FOUR NO-RUN OUTCOMES. The most careful rows in the file. C# is the only
//    leg with four, and the fourth is a MISSING RUNTIME.
//    [contract-cs.md '## The FOUR no-run outcomes'; contract-seam.md 'The three
//     no-run outcomes are DIFFERENT, and telling them apart is the point']
// ===========================================================================

// CAPTURED from scout-findings.md and contract-cs.md: zero results, total="0",
// EXIT 0, plus the positive text tell VSTest prints.
const TRX_FILTER_MISS =
  '<TestRun xmlns="http://microsoft.com/schemas/VisualStudio/TeamTest/2010">\n' +
  "  <Results />\n" +
  '  <ResultSummary outcome="Completed">\n' +
  '    <Counters total="0" executed="0" passed="0" failed="0" error="0" notExecuted="0" />\n' +
  "  </ResultSummary>\n" +
  "</TestRun>\n";

const FILTER_MISS_CONSOLE =
  "Test run for /w/probe/bin/Debug/net10.0/csvstest.dll (.NETCoreApp,Version=v10.0)\n" +
  "A total of 1 test files matched the specified pattern.\n" +
  "No test matches the given testcase filter `FullyQualifiedName~ZZZNoSuchProbe` in /w/probe/bin/Debug/net10.0/csvstest.dll\n";

// CAPTURED shape: MSBuild diagnostics, and NO TRX is written at all.
const MSBUILD_ERROR =
  "  Determining projects to restore...\n" +
  "/w/probe/AtlasTests.cs(9,31): error CS1503: Argument 2: cannot convert from 'string' to 'int' " +
  "[/w/probe/Probe.Tests.csproj]\n" +
  "\n" +
  "Build FAILED.\n" +
  "    1 Error(s)\n";

// CAPTURED from scout-findings.md Finding 4 and contract-cs.md, measured on the
// real Contoso.ProcessingLogic.Tests. The "installed versions" block is DERIVED
// from the same message's standard shape.
const MISSING_RUNTIME_TEXT =
  "Testhost process for source(s) '/w/contoso/Contoso.ProcessingLogic.Tests/bin/Debug/net9.0/" +
  "Contoso.ProcessingLogic.Tests.dll' exited with error: You must install or update .NET to run this application.\n" +
  "\n" +
  "App: /usr/lib/dotnet/dotnet\n" +
  "Architecture: x64\n" +
  "Framework: 'Microsoft.NETCore.App', version '9.0.0' (x64)\n" +
  ".NET location: /usr/lib/dotnet/\n" +
  "\n" +
  "The following frameworks were found:\n" +
  "  8.0.29 at [/usr/lib/dotnet/shared/Microsoft.NETCore.App]\n" +
  "  10.0.10 at [/usr/lib/dotnet/shared/Microsoft.NETCore.App]\n" +
  "\n" +
  "Test Run Aborted.\n";

// The phase 5 CORRECTION, and the reason two rows below had to be re-cut: the
// missing runtime DOES write a TRX. Element shape DERIVED from contract-cs.md's
// corrected table row and its `<ResultSummary outcome="Failed">` /
// `<RunInfo outcome="Error">` description; the message text is the capture above.
const TRX_MISSING_RUNTIME =
  '<TestRun xmlns="http://microsoft.com/schemas/VisualStudio/TeamTest/2010">\n' +
  "  <Results />\n" +
  '  <ResultSummary outcome="Failed">\n' +
  '    <Counters total="0" executed="0" passed="0" failed="0" error="0" notExecuted="0" />\n' +
  "    <RunInfos>\n" +
  '      <RunInfo computerName="grug" outcome="Error" timestamp="2026-07-27T10:11:12">\n' +
  "        <Text>" +
  MISSING_RUNTIME_TEXT.replace(/</g, "&lt;").replace(/>/g, "&gt;") +
  "</Text>\n" +
  "      </RunInfo>\n" +
  "    </RunInfos>\n" +
  "  </ResultSummary>\n" +
  "</TestRun>\n";

ptest("NO-RUN 1 of 4, TEST FAILURE at exit 1: <Counters failed=\"1\"> is a NORMAL RED and sets no no-run field at all [contract-cs.md table 'test failure | `<Counters failed=\"1\">` | 1 | none, a normal red']", () => {
  const p = parse(TRX_MIXED, 1);
  assert.strictEqual(p.ran, true, "results exist, so the run happened");
  assert.strictEqual(p.failed, 1, "one failure");
  assert.ok(p.filterMatchedNothing !== true, `a run that executed two tests is not a filter miss. Got ${JSON.stringify(p.filterMatchedNothing)}`);
  assert.strictEqual(p.environmentError, undefined, `a failing assertion is not an environment problem. Got ${JSON.stringify(p.environmentError)}`);
  assert.strictEqual(p.buildError, undefined, `nor a compile error: the code compiled and the assertion failed. Got ${JSON.stringify(p.buildError)}`);
});

ptest("NO-RUN 2 of 4, FILTER MISS at EXIT 0 - THE SILENT FALSE GREEN this whole design guards against. Zero <UnitTestResult> and total=\"0\" set filterMatchedNothing STRUCTURALLY, with no text tell needed [contract-cs.md table 'filter miss | zero `<UnitTestResult>`, `total=\"0\"` ... | **0** | `filterMatchedNothing`'; 'The filter miss at exit 0 is the silent false green this whole design guards against, and TRX makes it structural']", () => {
  const p = parse(TRX_FILTER_MISS, 0);
  assert.strictEqual(
    p.filterMatchedNothing,
    true,
    `exit 0 with nothing run is the shape that reads as a pass. Got ${JSON.stringify(p.filterMatchedNothing)}`
  );
  assert.strictEqual(p.ran, false, "no <UnitTestResult> exists, so nothing ran");
  assert.deepStrictEqual(p.cases, [], "an empty run fabricates no cases");
  assert.strictEqual(p.passed, 0, "the executed>0 guard must hold: zero passed");
  assert.strictEqual(p.failed, 0, "zero failed");
  assert.strictEqual(p.environmentError, undefined, `nothing about the environment failed: the run happened and matched nothing. Got ${JSON.stringify(p.environmentError)}`);
  assert.strictEqual(p.buildError, undefined, `and it compiled. Got ${JSON.stringify(p.buildError)}`);
});

ptest("NO-RUN 2 of 4: the filter miss is detected from the DOCUMENT, so the `No test matches the given testcase filter` line is useful for the message and NOT load-bearing - it stays a filter miss with or without the console text [goal.md Amendment 7 'The `No test matches the given testcase filter` line stays useful for the human-facing message but is no longer load-bearing']", () => {
  const withText = mstestFw().parseOutput(TRX_FILTER_MISS, FILTER_MISS_CONSOLE, 0);
  const withoutText = mstestFw().parseOutput(TRX_FILTER_MISS, "", 0);
  assert.strictEqual(withText.filterMatchedNothing, true, "with the tell");
  assert.strictEqual(
    withoutText.filterMatchedNothing,
    true,
    `and without it, because zero results and total="0" already say it. Got ${JSON.stringify(withoutText.filterMatchedNothing)}`
  );
});

// RE-CUT to the phase 5 measurement: the compile failure writes NO TRX and puts
// its errors on STDOUT with stderr EMPTY, which is the case Amendment 8c's
// real-stdout fallback exists for. A leg reading only stderr fails the first row.
ptest("NO-RUN 3 of 4, COMPILE FAILURE at exit 1 with NO TRX: the MSBuild errors arrive on STDOUT with stderr EMPTY, and `buildError` must carry the diagnostic - without the Amendment 8c fallback the leg receives nothing and reports a build failure with no message at all, which is the defect phase 2 measured in Go [contract-cs.md '**Also corrected: the compile failure puts its errors on STDOUT, with stderr EMPTY.** ... without the real-stdout fallback the leg reports a build failure with no message at all'; contract-seam.md 'stdout falls back to the process's real stdout when the file was NOT written']", () => {
  for (const [label, stdout, stderr] of [
    ["the measured shape: diagnostics on stdout, stderr EMPTY", MSBUILD_ERROR, ""],
    ["and the same diagnostics reaching stderr instead, which must not change the verdict", "", MSBUILD_ERROR],
  ]) {
    const p = mstestFw().parseOutput(stdout, stderr, 1);
    assert.strictEqual(
      typeof p.buildError,
      "string",
      `${label}: without buildError this reports as a run that did not happen, with nothing naming the error. Got ${JSON.stringify(p.buildError)}`
    );
    assert.ok(
      p.buildError.includes("CS1503") || p.buildError.includes("cannot convert"),
      `${label}: the compiler's own diagnostic must reach the human, since the product may not fix it. Got ${JSON.stringify(p.buildError)}`
    );
    assert.strictEqual(
      p.environmentError,
      undefined,
      `${label}: a real compile error is NOT an environment problem. Got ${JSON.stringify(p.environmentError)}`
    );
    assert.ok(
      p.filterMatchedNothing !== true,
      `${label}: nor a filter miss. Got ${JSON.stringify(p.filterMatchedNothing)}`
    );
    assert.strictEqual(p.ran, false, `${label}: nothing ran`);
    assert.strictEqual(p.passed + p.failed, 0, `${label}: executed is zero, so green must never be claimed`);
  }
});

// RE-CUT to the phase 5 CORRECTION: the missing runtime DOES write a TRX, so the
// tell is `<RunInfo outcome="Error">` inside a document with total="0", not the
// absence of a report.
ptest("NO-RUN 4 of 4, MISSING RUNTIME - C#'s ALONE, and MEASURED not hypothetical. A TRX carrying <ResultSummary outcome=\"Failed\">, total=\"0\" and a <RunInfo outcome=\"Error\"> sets `environmentError` NAMING the missing framework version and the installed ones. Today it lands as \"the tests did not compile\", which sends the human hunting a compile error that does not exist [contract-cs.md table '**missing runtime** | `<RunInfo outcome=\"Error\">` inside a TRX with `total=\"0\"` | 1 | `environmentError`'; '**CORRECTED in phase 5, measured.** This contract said the missing runtime writes no TRX. It writes one']", () => {
  for (const [label, stdout, stderr] of [
    ["the TRX the runner read, which is the measured shape", TRX_MISSING_RUNTIME, ""],
    ["the same TRX with the console text also on stderr", TRX_MISSING_RUNTIME, MISSING_RUNTIME_TEXT],
  ]) {
    const p = mstestFw().parseOutput(stdout, stderr, 1);
    assert.strictEqual(
      typeof p.environmentError,
      "string",
      `${label}: this is the fourth outcome, and without it the human is told their code did not compile. Got ${JSON.stringify(p.environmentError)}`
    );
    assert.ok(
      p.environmentError.includes("9.0.0"),
      `${label}: NAME the missing framework version, which the message gives you. Got ${JSON.stringify(p.environmentError)}`
    );
    assert.ok(
      p.environmentError.includes("10.0.10") || p.environmentError.includes("8.0.29"),
      `${label}: and the installed ones, so the human can see the gap without rerunning anything. Got ${JSON.stringify(p.environmentError)}`
    );
    assert.strictEqual(
      p.buildError,
      undefined,
      `${label}: NOTHING failed to compile. dotnet test built the project and then could not start the test host. Got ${JSON.stringify(p.buildError)}`
    );
    assert.ok(
      p.filterMatchedNothing !== true,
      `${label}: and the filter was never reached. Got ${JSON.stringify(p.filterMatchedNothing)}`
    );
    assert.strictEqual(p.ran, false, `${label}: the test host aborted, so nothing ran`);
    assert.strictEqual(p.passed + p.failed, 0, `${label}: executed is zero`);
  }
});

ptest("THE COLLISION, AND IT IS THE FOURTH LANGUAGE TO HAVE IT: inside the TRX the missing runtime and the FILTER MISS are structurally identical - zero results and total=\"0\" in both - apart from `<RunInfo outcome=\"Error\">`. So RunInfo is checked FIRST, before concluding a filter miss from zero results, or a developer whose runtime is missing is told their filter matched nothing [contract-cs.md 'inside the TRX the missing runtime and the FILTER MISS are structurally identical except for that one attribute ... **Check `<RunInfo outcome=\"Error\">` FIRST**, before concluding a filter miss from zero results']", () => {
  const miss = parse(TRX_FILTER_MISS, 0);
  const env = parse(TRX_MISSING_RUNTIME, 1);

  // The two documents really are the same run summary apart from the RunInfo.
  assert.ok(
    /total="0"/.test(TRX_FILTER_MISS) && /total="0"/.test(TRX_MISSING_RUNTIME),
    "both carry total=\"0\", which is why zero-results alone cannot be the tell"
  );
  assert.ok(
    !/<UnitTestResult/.test(TRX_FILTER_MISS) && !/<UnitTestResult/.test(TRX_MISSING_RUNTIME),
    "and neither carries a single result element, so the results are no help either"
  );
  assert.ok(
    !/RunInfo/.test(TRX_FILTER_MISS) && /<RunInfo[^>]*outcome="Error"/.test(TRX_MISSING_RUNTIME),
    "the RunInfo error element is the difference the contract names as the tell"
  );

  assert.strictEqual(miss.filterMatchedNothing, true, "zero results with no RunInfo error IS a filter miss");
  assert.strictEqual(miss.environmentError, undefined, "and it is not an environment error");

  assert.ok(
    env.filterMatchedNothing !== true,
    `zero results WITH a RunInfo error is NOT a filter miss. Telling this human their filter matched nothing sends them to edit a filter that was never the problem, while their test host cannot start at all. Got ${JSON.stringify(env.filterMatchedNothing)}`
  );
  assert.strictEqual(typeof env.environmentError, "string", "it is an environment error");

  // The order is what the contract pins, and the order is what makes this
  // independent of the exit code the process happened to return.
  const envAtZero = parse(TRX_MISSING_RUNTIME, 0);
  assert.ok(
    envAtZero.filterMatchedNothing !== true,
    `checking RunInfo FIRST means the verdict comes from the document, not from the exit code. A leg that reaches "filter miss" on zero results and only then looks at RunInfo gets this one wrong. Got ${JSON.stringify(envAtZero.filterMatchedNothing)}`
  );
});

ptest("THE FOUR ARE TOLD APART: the filter miss, the compile failure and the missing runtime land on THREE DIFFERENT fields. Today all three report \"the tests did not compile\" and two of those sentences are lies [contract-seam.md 'Today `runTddTests` reports ALL of them as \"the tests did not compile\". Two of the three sentences are lies, and one of them tells the human to fix a compile error that does not exist']", () => {
  const miss = mstestFw().parseOutput(TRX_FILTER_MISS, FILTER_MISS_CONSOLE, 0);
  const build = mstestFw().parseOutput(MSBUILD_ERROR, "", 1);
  const env = mstestFw().parseOutput(TRX_MISSING_RUNTIME, "", 1);

  const shape = (p) => [p.filterMatchedNothing === true, typeof p.buildError === "string", typeof p.environmentError === "string"];

  assert.deepStrictEqual(shape(miss), [true, false, false], `the filter miss sets filterMatchedNothing ALONE. Got ${JSON.stringify(miss)}`);
  assert.deepStrictEqual(shape(build), [false, true, false], `the compile failure sets buildError ALONE. Got ${JSON.stringify(build)}`);
  assert.deepStrictEqual(shape(env), [false, false, true], `the missing runtime sets environmentError ALONE. Got ${JSON.stringify(env)}`);

  assert.notDeepStrictEqual(
    shape(build),
    shape(env),
    "these two share exit 1 and produce no test results, so if they are not separated here they are not separated anywhere, and one human is sent to fix a compile error that does not exist"
  );
});

// ===========================================================================
// 8. returnTypeOf. C# has NO `->` at all, so the shipped Rust regex returns
//    undefined for EVERY C# method and the gesture would report "returns no
//    value to assert" on all of C#.
//    [contract-cs.md '## `returnTypeOf`']
// ===========================================================================

ptest("returnTypeOf csharp: the contract's table, row for row - the return type PRECEDES the method name, which is why the shipped `->`-only regex is wrong for this whole language [contract-cs.md '## `returnTypeOf`' table]", () => {
  const table = [
    ["public static int Widen(int n)", "int"],
    ["private static List<DtoGapAnalysis> RemoveOverlappingGaps(List<DtoGapAnalysis> gaps)", "List<DtoGapAnalysis>"],
    ["public void Apply(int n)", undefined],
    ["public static Dictionary<int, ShiftHour> Make(CustomerSite s)", "Dictionary<int, ShiftHour>"],
    ["public static long ToUnixTimeSeconds(this DateTime input)", "long"],
    ["public (int, string) Split(int n)", "(int, string)"],
  ];
  for (const [sig, want] of table) {
    assert.strictEqual(
      csLang.returnTypeOf(sig),
      want,
      `${JSON.stringify(sig)} yields ${JSON.stringify(want)}, got ${JSON.stringify(csLang.returnTypeOf(sig))}`
    );
  }
});

ptest("returnTypeOf csharp: a GENERIC return whose arguments contain a COMMA survives intact - `Dictionary<int, ShiftHour>` must not be cut at the comma or at the space [contract-cs.md 'Generic arguments contain commas and angle brackets ... so depth-count rather than splitting on whitespace. Reuse the seam's depth scanner']", () => {
  assert.strictEqual(
    csLang.returnTypeOf("public static Dictionary<int, ShiftHour> Make(CustomerSite s)"),
    "Dictionary<int, ShiftHour>",
    "splitting on whitespace yields `Dictionary<int,` and every downstream renderer treats it as a named type"
  );
  // DERIVED from the same depth rule: nesting, and a nested comma.
  assert.strictEqual(
    csLang.returnTypeOf("public static Dictionary<string, List<DtoGapAnalysis>> Group(int n)"),
    "Dictionary<string, List<DtoGapAnalysis>>",
    "two levels of nesting, one depth scanner"
  );
});

ptest("returnTypeOf csharp: a TUPLE return keeps its parentheses and both elements - the parenthesis is part of the TYPE here, not the start of the parameter list [contract-cs.md '`public (int, string) Split(int n)` -> `\"(int, string)\"`']", () => {
  assert.strictEqual(csLang.returnTypeOf("public (int, string) Split(int n)"), "(int, string)");
  // DERIVED from the same rule: a named tuple, which is the common real spelling.
  assert.strictEqual(
    csLang.returnTypeOf("public static (int start, string label) Describe(int n)"),
    "(int start, string label)",
    "a naive scan for the first `(` takes the tuple for the parameter list and returns an empty type"
  );
});

ptest("returnTypeOf csharp: an EXTENSION method's `this` parameter does not disturb the return type, which sits before the method name as always [contract-cs.md '`public static long ToUnixTimeSeconds(this DateTime input)` -> `\"long\"`']", () => {
  assert.strictEqual(csLang.returnTypeOf("public static long ToUnixTimeSeconds(this DateTime input)"), "long");
});

ptest("returnTypeOf csharp: `void` yields undefined, per supersession S1 - there is nothing to assert on [contract-cs.md '`void` returns undefined, per supersession S1's reasoning'; goal.md item 6]", () => {
  for (const sig of [
    "public void Apply(int n)",
    "public static void Apply(int n)",
    "private void Apply()",
  ]) {
    assert.strictEqual(
      csLang.returnTypeOf(sig),
      undefined,
      `${JSON.stringify(sig)}: a method returning nothing gives the human nothing to type into a hole`
    );
  }
});

ptest("returnTypeOf csharp: every modifier in the contract's list is STRIPPED, and a CONSTRUCTOR never yields `public` - that false positive took the measured corpus count from 300 to 251 [contract-cs.md 'Strip modifiers (`public`, `private`, `protected`, `internal`, `static`, `virtual`, `override`, `sealed`, `abstract`, `extern`, `unsafe`, `new`, `partial`, `async`)'; 'must not treat `public Foo(` as a method returning `public`']", () => {
  // DERIVED from the contract's own modifier list: each spelling in turn.
  for (const [sig, want] of [
    ["protected internal virtual double Ratio(int n)", "double"],
    ["internal sealed override string Label(int n)", "string"],
    ["private protected abstract bool Ok(int n)", "bool"],
    ["public static extern unsafe int Native(int n)", "int"],
    ["public new partial string Render(int n)", "string"],
  ]) {
    assert.strictEqual(csLang.returnTypeOf(sig), want, `${JSON.stringify(sig)} yields ${JSON.stringify(want)}`);
  }

  for (const ctor of ["public Foo(int n)", "public DtoGapAnalysis(int start, int end)", "internal Widen()"]) {
    const got = csLang.returnTypeOf(ctor);
    assert.ok(
      !["public", "private", "internal", "protected", "static"].includes(got),
      `${JSON.stringify(ctor)}: an access modifier is never a return type, and this exact false positive inflated the corpus count by 49. Got ${JSON.stringify(got)}`
    );
  }
});

ptest("returnTypeOf csharp: a GENERIC METHOD's own type parameters belong to the NAME, not the return type [contract-cs.md 'then take the type up to the method name' - DERIVED, since the table carries no generic-method row]", () => {
  assert.strictEqual(
    csLang.returnTypeOf("public static List<T> Wrap<T>(T value)"),
    "List<T>",
    "the first angle-bracket group is the return type; the second belongs to the method name"
  );
});

// ===========================================================================
// 9. Testability, first-match-wins.
//    async -> io -> needs-fixture -> not-exported -> underspecified -> testable
//    [contract-cs.md '## Testability']
// ===========================================================================

ptest("classifyTestability csharp: an `async` modifier, or a `Task<T>` / `ValueTask<T>` return, is 'async' [contract-cs.md '**async**: an `async` modifier, or a `Task<T>` / `ValueTask<T>` return']", () => {
  for (const sig of [
    "public async Task<int> WidenAsync(int n)",
    "public static Task<int> WidenAsync(int n)",
    "public static ValueTask<int> WidenAsync(int n)",
    "public async void Fire(int n)",
  ]) {
    assert.strictEqual(
      csLang.classifyTestability(sig, DOC).reason,
      "async",
      `${JSON.stringify(sig)}: a blind unit test cannot drive an awaitable`
    );
  }
});

ptest("classifyTestability csharp: `Stream`, `File`, `FileInfo`, `HttpClient`, `Socket` and `DbConnection` in the SIGNATURE are 'io' [contract-cs.md '**io**: `Stream`, `File`, `FileInfo`, `HttpClient`, `Socket`, `DbConnection` in the signature']", () => {
  for (const sig of [
    "public static string Hash(Stream input)",
    "public static string Read(FileInfo file)",
    "public static string Fetch(HttpClient client, string url)",
    "public static bool Probe(Socket socket)",
    "public static int Count(DbConnection connection)",
    "public static string Read(File file)",
  ]) {
    assert.strictEqual(
      csLang.classifyTestability(sig, DOC).reason,
      "io",
      `${JSON.stringify(sig)} touches the world and is integration territory dressed as a survivor`
    );
  }
});

ptest("classifyTestability csharp: the io leg reads SIGNATURES, so `GetMD5HashFromFile(string filename)` PASSES even though its body opens a file - a measured FALSE ZERO, shared with the product and not fixable here [contract-cs.md 'Measured 0 on the corpus, a FALSE zero: `GetMD5HashFromFile(string filename)` opens a file in its body and passes, because the classifier reads signatures. Shared with the product, worth a comment'; goal.md Amendment 1 'The signature-only limit is shared with the product and is not fixable by a better classifier']", () => {
  assert.strictEqual(
    csLang.classifyTestability("public static string GetMD5HashFromFile(string filename)", DOC).reason,
    undefined,
    "refusing it here would be a DIFFERENT product than the one measured, and the io leg cannot see a body"
  );
});

ptest("classifyTestability csharp: a NON-STATIC instance method is 'needs-fixture', and it is visible in the SIGNATURE so Amendment 4's method-form workaround is NOT needed here [contract-cs.md '**needs-fixture**: a non-static instance method. Visible in the signature, so Amendment 4's method-form workaround is NOT needed here']", () => {
  for (const sig of ["public int Total(int a)", "public string Label(int a)"]) {
    assert.strictEqual(
      csLang.classifyTestability(sig, DOC).reason,
      "needs-fixture",
      `${JSON.stringify(sig)} needs an instance the blind test cannot construct`
    );
  }
  assert.strictEqual(
    csLang.classifyTestability("public static int Total(int a)", DOC).reason,
    undefined,
    "the SAME method made static needs no receiver, so `static` is the whole tell and it is right there in the signature"
  );
});

ptest("classifyTestability csharp: `private`, `protected` and `internal` are 'not-exported', and the detail NAMES A FIX THE HUMAN CAN PERFORM - Amendment 5 had to correct exactly this class of bug in TypeScript, where the detail told the human to \"add export\" to something that cannot be exported [contract-cs.md 'A `private`, `protected` or (absent `InternalsVisibleTo`) `internal` method gets `not-exported`, with a detail that NAMES THE FIX ... \"Make it public\" is performable'; goal.md Amendment 5 'The reason the human reads is unactionable, which is worse than a refusal they can act on']", () => {
  for (const sig of [
    "private static int Widen(int n)",
    "protected static int Widen(int n)",
    "internal static int Widen(int n)",
    "private protected static int Widen(int n)",
  ]) {
    const v = csLang.classifyTestability(sig, DOC);
    assert.strictEqual(v.reason, "not-exported", `${JSON.stringify(sig)}: the test project cannot see it`);
    assert.strictEqual(typeof v.detail, "string", `${JSON.stringify(sig)}: the refusal carries a detail`);
    assert.ok(
      /public/i.test(v.detail),
      `${JSON.stringify(sig)}: "make it public" is a fix the human can actually perform. Got ${JSON.stringify(v.detail)}`
    );
    assert.ok(
      !/\bexport\b/i.test(v.detail),
      `${JSON.stringify(sig)}: C# has no export keyword. Telling this human to "add export" is the unactionable detail Amendment 5 had to correct. Got ${JSON.stringify(v.detail)}`
    );
  }
});

ptest("classifyTestability csharp: the clearest blind-test targets in the corpus, `GapsOverlap` and `RemoveOverlappingGaps`, are BOTH private and are BOTH refused - which answers roadmap item 13 directly and is the measured reason C# survives 0 of 251 [contract-cs.md 'The clearest blind-test targets in the corpus, `GapsOverlap` and `RemoveOverlappingGaps`, are both `private` ... the good targets in a service codebase are the private helpers a test project cannot see'; goal.md Amendment 1 'build all four exactly as this goal specifies ... Do not relax the classifier to manufacture survivors']", () => {
  for (const sig of [
    "private static bool GapsOverlap(DtoGapAnalysis a, DtoGapAnalysis b)",
    "private static List<DtoGapAnalysis> RemoveOverlappingGaps(List<DtoGapAnalysis> gaps)",
  ]) {
    assert.strictEqual(
      csLang.classifyTestability(sig, DOC).reason,
      "not-exported",
      `${JSON.stringify(sig)}: relaxing this to manufacture a survivor ships a product the human did not rule for`
    );
  }
});

ptest("classifyTestability csharp: a member with NO access modifier is implicitly PRIVATE in C# and refuses as 'not-exported' - RATIFIED by Amendment 8, which confirms C# class members default to private, so the absent modifier is a visibility fact and not a missing one [goal.md Amendment 8 '**An implicit access modifier is private.** `static int Widen(int n)` with no modifier is private in C#, so it correctly refuses as `not-exported`. Confirmed: C# class members default to private'; contract-cs.md '## Visibility: the `not-exported` refusal']", () => {
  assert.strictEqual(
    csLang.classifyTestability("static int Widen(int n)", DOC).reason,
    "not-exported",
    "a class member with no access modifier is private, and a test project in another assembly cannot call it"
  );
});

// RE-CUT to Amendment 8a. This row previously probed four plausible spellings
// because the seam carried no channel at all; the ratified one is
// `ctx.internalsVisible`.
ptest("classifyTestability csharp: `internal` is REACHABLE when ctx.internalsVisible is true and refused when it is not - the one PROJECT fact a signature cannot show, and both directions matter: absent means not visible, which is the right default for Contoso where InternalsVisibleTo appears NOWHERE in the solution [contract-cs.md 'Check for `InternalsVisibleTo` in the source project's `.csproj` and in any `AssemblyInfo.cs`, and when present treat `internal` as reachable'; contract-seam.md 'ADDED phase 5 (Amendment 8a) ... C# needs `internalsVisible` to decide whether an `internal` method is reachable from the test project. Additive; the other four legs ignore it, and absent means not visible']", () => {
  const sig = "internal static int Widen(int n)";

  assert.strictEqual(
    csLang.classifyTestability(sig, DOC).reason,
    "not-exported",
    "absent ctx means not visible, which is the measured truth for the whole Contoso solution"
  );
  assert.strictEqual(
    csLang.classifyTestability(sig, DOC, {}).reason,
    "not-exported",
    "an empty ctx is the same as no ctx: the leg must not read a missing flag as permission"
  );
  assert.strictEqual(
    csLang.classifyTestability(sig, DOC, { internalsVisible: false }).reason,
    "not-exported",
    "and false is false"
  );
  assert.strictEqual(
    csLang.classifyTestability(sig, DOC, { internalsVisible: true }).reason,
    undefined,
    `with InternalsVisibleTo the test project CAN call it, so refusing would be a refusal the human cannot act on: there is nothing left to fix. Got ${JSON.stringify(csLang.classifyTestability(sig, DOC, { internalsVisible: true }))}`
  );

  assert.strictEqual(
    csLang.classifyTestability("private static int Widen(int n)", DOC, { internalsVisible: true }).reason,
    "not-exported",
    "InternalsVisibleTo opens `internal` to another assembly and nothing else: `private` stays unreachable however the project is configured"
  );
  assert.strictEqual(
    csLang.classifyTestability("protected static int Widen(int n)", DOC, { internalsVisible: true }).reason,
    "not-exported",
    "and so does `protected`"
  );
});

ptest("classifyTestability csharp: a `void` return or a MISSING `///` doc comment is 'underspecified' [contract-cs.md '**underspecified**: a `void` return, or no `///` doc comment']", () => {
  assert.strictEqual(
    csLang.classifyTestability("public static void Apply(int n)", DOC).reason,
    "underspecified",
    "a method returning nothing gives a blind test nothing to assert"
  );
  assert.strictEqual(
    csLang.classifyTestability("public static int Widen(int n)", undefined).reason,
    "underspecified",
    "with no contract there is nothing to write a blind test against"
  );
  assert.strictEqual(
    csLang.classifyTestability("public static int Widen(int n)", "").reason,
    "underspecified",
    "an empty doc comment is no doc comment"
  );
});

ptest("classifyTestability csharp: first-match-wins precedence holds, so the reported reason is STABLE rather than dependent on which legs happen to match [contract-cs.md 'async -> io -> needs-fixture -> not-exported -> underspecified -> testable'; goal.md Amendment 3 'what makes the reported reason PREDICTABLE']", () => {
  assert.strictEqual(
    csLang.classifyTestability("private async Task<int> LoadAsync(Stream s)", undefined).reason,
    "async",
    "async precedes everything"
  );
  assert.strictEqual(
    csLang.classifyTestability("private int Load(Stream s)", undefined).reason,
    "io",
    "io precedes needs-fixture"
  );
  assert.strictEqual(
    csLang.classifyTestability("private int Total(int a)", undefined).reason,
    "needs-fixture",
    "needs-fixture precedes not-exported, so a private instance method reports the fixture problem"
  );
  assert.strictEqual(
    csLang.classifyTestability("private static int Total(int a)", undefined).reason,
    "not-exported",
    "not-exported precedes underspecified, so a doc-less private static reports the visibility problem"
  );
});

ptest("classifyTestability csharp: a documented public static method with a real return type SURVIVES, so the classifier is a gate and not a blanket no [contract-cs.md 'C# survives 0 of 251 functions ... and only 4 even if every method were made public and static' - the four exist, so the survivor path must work]", () => {
  for (const sig of [
    "public static int Widen(int n)",
    "public static List<DtoGapAnalysis> Merge(List<DtoGapAnalysis> gaps)",
    "public static Dictionary<int, ShiftHour> Make(CustomerSite site)",
  ]) {
    assert.strictEqual(
      csLang.classifyTestability(sig, DOC).reason,
      undefined,
      `${JSON.stringify(sig)} is documented, public, static and returns a value: nothing is wrong with it`
    );
  }
});

// ===========================================================================
// 10. expectedValueSpans. THE SAFETY-CRITICAL ONE, and goal.md item 6 opens with
//     exactly this case. The argument order INVERTS relative to Rust.
//     [contract-cs.md '## The assertion idiom, and this is the item the goal
//      calls safety-critical'; goal.md item 6]
// ===========================================================================

const spanTexts = (fw, text) => {
  const spans = fw.expectedValueSpans(text);
  assert.ok(Array.isArray(spans), "expectedValueSpans returns an array");
  for (const s of spans) {
    assert.ok(
      typeof s.start === "number" && typeof s.end === "number",
      `a span is a pair of offsets, got ${JSON.stringify(s)}`
    );
    assert.ok(s.end > s.start, `a span is a non-empty range, got ${JSON.stringify(s)}`);
  }
  return spans.map((s) => text.slice(s.start, s.end));
};

const MSTEST_BODY =
  "    [TestMethod]\n" +
  "    public void AggregateFanoutHappy()\n" +
  "    {\n" +
  "        Assert.AreEqual(7, AggregateFanout(3));\n" +
  "    }\n";

const XUNIT_BODY =
  "    [Fact]\n" +
  "    public void AggregateFanoutHappy()\n" +
  "    {\n" +
  "        Assert.Equal(7, AggregateFanout(3));\n" +
  "    }\n";

const NUNIT_BODY =
  "    [Test]\n" +
  "    public void AggregateFanoutHappy()\n" +
  "    {\n" +
  "        Assert.That(AggregateFanout(3), Is.EqualTo(7));\n" +
  "    }\n";

ptest("expectedValueSpans MSTest: EXACTLY ONE span covering the FIRST argument of Assert.AreEqual, and it MUST NOT cover the second - goal.md item 6 opens with this case: point the shipped Rust locator here and it blanks AggregateFanout(3), the call under test, and keeps the model's guessed 7 as the expectation [contract-cs.md '**The argument order INVERTS relative to Rust** ... MSTest | `Assert.AreEqual(expected, actual)` | **1st** argument'; goal.md item 6 'Get this table wrong in one direction and the feature is merely broken; get it wrong in the other and it lies']", () => {
  const fw = mstestFw();
  const spans = fw.expectedValueSpans(MSTEST_BODY);
  assert.strictEqual(spans.length, 1, `one assertion, one span, got ${JSON.stringify(spans)}`);
  assert.strictEqual(
    MSTEST_BODY.slice(spans[0].start, spans[0].end),
    "7",
    `the FIRST argument is the expected value in MSTest. Got ${JSON.stringify(MSTEST_BODY.slice(spans[0].start, spans[0].end))}`
  );

  const callStart = MSTEST_BODY.indexOf("AggregateFanout(3)");
  const callEnd = callStart + "AggregateFanout(3)".length;
  assert.ok(
    spans[0].end <= callStart || spans[0].start >= callEnd,
    `THE ROW ITEM 6 EXISTS FOR: the span must not overlap the call under test at [${callStart}, ${callEnd}). Blanking it deletes the thing being tested and leaves the model's guess standing as the expectation, which is the blank-value invariant INVERTED. Got ${JSON.stringify(spans[0])}`
  );
});

ptest("expectedValueSpans xUnit: the FIRST argument of Assert.Equal, same inversion as MSTest [contract-cs.md 'xUnit | `Assert.Equal(expected, actual)` | **1st** argument']", () => {
  const spans = xunitFw().expectedValueSpans(XUNIT_BODY);
  assert.strictEqual(spans.length, 1, `one assertion, one span, got ${JSON.stringify(spans)}`);
  assert.strictEqual(XUNIT_BODY.slice(spans[0].start, spans[0].end), "7", "the first argument");
  const callStart = XUNIT_BODY.indexOf("AggregateFanout(3)");
  assert.ok(spans[0].end <= callStart, `and never the call under test. Got ${JSON.stringify(spans[0])}`);
});

ptest("expectedValueSpans NUnit: the argument of `Is.EqualTo(...)` inside Assert.That, which is the NESTED shape TypeScript's terminating-matcher locator already had to solve - and the RECEIVER, which is the call under test, is never blanked [contract-cs.md 'NUnit | `Assert.That(actual, Is.EqualTo(expected))` | the argument of `Is.EqualTo`']", () => {
  const spans = nunitFw().expectedValueSpans(NUNIT_BODY);
  assert.strictEqual(spans.length, 1, `one assertion, one span, got ${JSON.stringify(spans)}`);
  assert.strictEqual(
    NUNIT_BODY.slice(spans[0].start, spans[0].end),
    "7",
    `the value inside Is.EqualTo, not the first argument of Assert.That. Got ${JSON.stringify(NUNIT_BODY.slice(spans[0].start, spans[0].end))}`
  );
  const callStart = NUNIT_BODY.indexOf("AggregateFanout(3)");
  const callEnd = callStart + "AggregateFanout(3)".length;
  assert.ok(
    spans[0].start >= callEnd,
    `NUnit puts the ACTUAL first, so a locator that blindly took argument one would delete the call under test here too. Got ${JSON.stringify(spans[0])}`
  );
});

ptest("expectedValueSpans: the three locators DISAGREE on each other's text, which is why the rung is keyed per FRAMEWORK - and note `Assert.AreEqual` does not contain `Assert.Equal`, so the xUnit locator finds nothing in an MSTest body rather than half-matching it [contract-seam.md 'Keyed per framework, not per language, because assertion argument order differs WITHIN a language']", () => {
  assert.deepStrictEqual(
    spanTexts(xunitFw(), MSTEST_BODY),
    [],
    `Assert.AreEqual is not Assert.Equal. A locator that matched loosely would blank the right text for the wrong reason here and the wrong text elsewhere. Got ${JSON.stringify(spanTexts(xunitFw(), MSTEST_BODY))}`
  );
  assert.deepStrictEqual(
    spanTexts(mstestFw(), NUNIT_BODY),
    [],
    `there is no Assert.AreEqual in an NUnit body, so the MSTest locator blanks nothing rather than guessing. Got ${JSON.stringify(spanTexts(mstestFw(), NUNIT_BODY))}`
  );
  assert.deepStrictEqual(
    spanTexts(nunitFw(), MSTEST_BODY),
    [],
    `and there is no Is.EqualTo in an MSTest body. Got ${JSON.stringify(spanTexts(nunitFw(), MSTEST_BODY))}`
  );
});

ptest("expectedValueSpans, all three: a MESSAGE argument is NEVER blanked - blanking prose leaves the guessed expectation in place and asks the human to retype a sentence [contract-cs.md 'Only value-asserting overloads ... `Assert.AreEqual` with a message third argument all need handling: the message must never be blanked']", () => {
  const cases = [
    ["mstest", mstestFw(), '        Assert.AreEqual(7, AggregateFanout(3), "fanout must widen");\n'],
    ["xunit", xunitFw(), '        Assert.Equal(7, AggregateFanout(3));\n'],
    ["nunit", nunitFw(), '        Assert.That(AggregateFanout(3), Is.EqualTo(7), "fanout must widen");\n'],
  ];
  for (const [id, fw, body] of cases) {
    const texts = spanTexts(fw, body);
    assert.deepStrictEqual(texts, ["7"], `${id}: the expectation is blanked and the message is left alone. Got ${JSON.stringify(texts)}`);
  }
});

ptest("expectedValueSpans, all three: a ZERO-VALUE assertion (`Assert.IsTrue`, `Assert.IsNull`, `Assert.True`, `Assert.NotNull`) produces NO span - there is no expected VALUE to blank and inventing one would blank an operand [contract-cs.md '`Assert.IsTrue(x)`, `Assert.IsNull(x)` and `Assert.AreEqual` with a message third argument all need handling']", () => {
  const cases = [
    ["mstest", mstestFw(), "        Assert.IsTrue(AggregateFanout(3) > 0);\n"],
    ["mstest null", mstestFw(), "        Assert.IsNull(AggregateFanout(3));\n"],
    // DERIVED: the same class of overload in the other two frameworks.
    ["xunit", xunitFw(), "        Assert.True(AggregateFanout(3) > 0);\n"],
    ["nunit", nunitFw(), "        Assert.That(AggregateFanout(3), Is.Not.Null);\n"],
  ];
  for (const [label, fw, body] of cases) {
    assert.deepStrictEqual(
      spanTexts(fw, body),
      [],
      `${label}: no expected value means no span. Blanking the operand would delete the call under test. Got ${JSON.stringify(spanTexts(fw, body))}`
    );
  }
});

// C# has the richest string syntax of the five: a verbatim string where "" is an
// escaped quote, a raw string literal delimited by three quotes, an interpolated
// string with {expr} holes, and both comment forms.
const MSTEST_DECOYS =
  "    [TestMethod]\n" +
  "    public void Decoys()\n" +
  "    {\n" +
  "        // Assert.AreEqual(91, Widen(1));\n" +
  "        /* Assert.AreEqual(92, Widen(1)); */\n" +
  '        var a = "Assert.AreEqual(93, Widen(1));";\n' +
  '        var b = @"Assert.AreEqual(94, ""Widen(1)"");";\n' +
  '        var c = """Assert.AreEqual(95, Widen(1));""";\n' +
  '        var d = $"Assert.AreEqual({Widen(1)}, 96)";\n' +
  "        Assert.AreEqual(7, Widen(3));\n" +
  "    }\n";

ptest("expectedValueSpans MSTest: no match inside a `//` comment, a `/* */` comment, a plain string, a VERBATIM string (where `\"\"` is an escaped quote), a RAW string literal (`\"\"\"...\"\"\"`) or an INTERPOLATED string - and the one real assertion alongside them still lands [contract-cs.md 'Never match inside a string, a verbatim string (`@\"...\"`, where `\"\"` is an escaped quote), a raw string literal (`\"\"\"...\"\"\"`), an interpolated string (`$\"...{expr}...\"`), or a comment. The literal profile needs all of these; C# has the richest string syntax of the five']", () => {
  const texts = spanTexts(mstestFw(), MSTEST_DECOYS);
  assert.deepStrictEqual(
    texts,
    ["7"],
    `six decoys and one real assertion. A span on any decoy edits a comment or a string literal and corrupts the file. Got ${JSON.stringify(texts)}`
  );
});

ptest("expectedValueSpans MSTest: a file of decoys ALONE yields ZERO spans, so the literal scanner is not merely picking the last match [contract-cs.md 'Never match inside a string ... or a comment']", () => {
  const body =
    "    public void OnlyDecoys()\n" +
    "    {\n" +
    "        // Assert.AreEqual(91, Widen(1));\n" +
    '        var b = @"Assert.AreEqual(94, ""Widen(1)"");";\n' +
    '        var c = """Assert.AreEqual(95, Widen(1));""";\n' +
    '        var d = $"Assert.AreEqual({Widen(1)}, 96)";\n' +
    "    }\n";
  assert.deepStrictEqual(
    spanTexts(mstestFw(), body),
    [],
    "nothing outside a literal or a comment carries an assertion here"
  );
});

ptest("expectedValueSpans MSTest: a nested call in the ACTUAL argument does not shift the count, because the comma inside it is not a top-level separator [contract-cs.md 'the FIRST top-level argument'; goal.md item 6 'paren and brace depth counting']", () => {
  const body = '        Assert.AreEqual("x-y", Join(a, b));\n';
  assert.deepStrictEqual(
    spanTexts(mstestFw(), body),
    ['"x-y"'],
    `the comma inside Join(a, b) is nested. Got ${JSON.stringify(spanTexts(mstestFw(), body))}`
  );
  // DERIVED: a collection expression in the FIRST argument, whose own commas are
  // inside braces, so the whole literal is one expected value.
  const braces = "        Assert.AreEqual(new List<int> { 1, 2 }, Widen(3));\n";
  assert.deepStrictEqual(
    spanTexts(mstestFw(), braces),
    ["new List<int> { 1, 2 }"],
    `the span is the WHOLE first argument, so the human types one value. Got ${JSON.stringify(spanTexts(mstestFw(), braces))}`
  );
});

ptest("expectedValueSpans, all three: spans come back ASCENDING and NON-OVERLAPPING, because a consumer applies them in order [goal.md item 6 'exactly the byte ranges the human must type'; contract-cs.md 'Spans ascending and non-overlapping']", () => {
  const cases = [
    [
      "mstest",
      mstestFw(),
      "        Assert.AreEqual(11, Alpha(1));\n" + "        Assert.AreEqual(22, Beta(2));\n",
    ],
    [
      "xunit",
      xunitFw(),
      "        Assert.Equal(11, Alpha(1));\n" + "        Assert.Equal(22, Beta(2));\n",
    ],
    [
      "nunit",
      nunitFw(),
      "        Assert.That(Alpha(1), Is.EqualTo(11));\n" + "        Assert.That(Beta(2), Is.EqualTo(22));\n",
    ],
  ];
  for (const [id, fw, body] of cases) {
    const spans = fw.expectedValueSpans(body);
    assert.deepStrictEqual(
      spans.map((s) => body.slice(s.start, s.end)),
      ["11", "22"],
      `${id}: each span covers its own expected value, got ${JSON.stringify(spans.map((s) => body.slice(s.start, s.end)))}`
    );
    assert.ok(
      spans[1].start >= spans[0].end,
      `${id}: ascending and non-overlapping, or applying them in order corrupts the document. Got ${JSON.stringify(spans)}`
    );
  }
});

// ===========================================================================
// 11. renderBlankValue. Amendments 2 and 6a: a hole is HINTED when it stands for
//     an unknown NUMBER of values, and BARE when it stands for exactly one value
//     whose type the human can read off the position.
//     [contract-cs.md '## Blank values'; goal.md Amendments 2 and 6a]
// ===========================================================================

const blank = (type) => {
  const res = csLang.renderBlankValue(type);
  assert.strictEqual(typeof res.holes, "number", `renderBlankValue(${JSON.stringify(type)}) reports a hole count`);
  assert.strictEqual(typeof res.rhs, "string", `renderBlankValue(${JSON.stringify(type)}) renders a right-hand side`);
  return res;
};

ptest("renderBlankValue csharp: every C# scalar is ONE BARE hole with NO `/*` comment [contract-cs.md '`int`, `long`, `short`, `byte`, `double`, `float`, `decimal`, `bool`, `char`, `string` | one BARE hole'; goal.md Amendment 2 'a SCALAR gets a bare hole']", () => {
  for (const type of ["int", "long", "short", "byte", "double", "float", "decimal", "bool", "char", "string"]) {
    const res = blank(type);
    assert.strictEqual(res.holes, 1, `${type} is one hole`);
    assert.strictEqual(res.rhs, "${1}", `${type}: a bare hole, got ${JSON.stringify(res.rhs)}`);
    assert.ok(!res.rhs.includes("/*"), `${type}: no type-hint comment on a scalar, got ${JSON.stringify(res.rhs)}`);
  }
});

ptest("renderBlankValue csharp: `List<T>` scaffolds `new List<T> { ... }` and its ONE hole is HINTED with the ELEMENT type - the human is typing an int, not a List<int> [contract-cs.md '`List<T>` | `new List<T> { ${1:/* T */} }`'; goal.md Amendment 2 'a container's contents are hinted with the ELEMENT type, not the container type']", () => {
  const res = blank("List<int>");
  assert.strictEqual(res.holes, 1, "the list literal is scaffolded, the contents are one hole");
  assert.strictEqual(res.rhs, "new List<int> { ${1:/* int */} }", `the contract spells this one exactly. Got ${JSON.stringify(res.rhs)}`);
  assert.ok(blank("List<DtoGapAnalysis>").rhs.includes("DtoGapAnalysis"), "the hint names whatever the element type is");
});

ptest("renderBlankValue csharp: `T[]` scaffolds `new[] { ... }` with ONE HINTED hole [contract-cs.md '`T[]` | `new[] { ${1:/* T */} }`']", () => {
  const res = blank("int[]");
  assert.strictEqual(res.holes, 1, "one hole for an unknown number of elements");
  assert.strictEqual(res.rhs, "new[] { ${1:/* int */} }", `the contract spells this one exactly. Got ${JSON.stringify(res.rhs)}`);
});

ptest("renderBlankValue csharp: `Dictionary<K, V>` is ONE HINTED hole - what goes in the mapping is a CONTRACT decision, not a type decision [contract-cs.md '`Dictionary<K, V>` | one HINTED hole'; goal.md Amendment 2 'Where item 6 says \"one hole\" for ... C#'s `Dictionary` and record, read it as one HINTED hole']", () => {
  const res = blank("Dictionary<int, ShiftHour>");
  assert.strictEqual(res.holes, 1, `one hole for the whole mapping, got ${res.holes}`);
  assert.ok(res.rhs.includes("${1:/*"), `the hole carries a type-hint comment, got ${JSON.stringify(res.rhs)}`);
  assert.ok(
    res.rhs.includes("ShiftHour"),
    `the hint tells the human what shape to type, which is the only thing that can. Got ${JSON.stringify(res.rhs)}`
  );
});

ptest("renderBlankValue csharp: a record, a class or an interface is ONE HINTED hole naming the type [contract-cs.md 'a record, a class, an interface | one HINTED hole']", () => {
  for (const type of ["DtoGapAnalysis", "CustomerSite", "IShiftPlanner"]) {
    const res = blank(type);
    assert.strictEqual(res.holes, 1, `${type} is one hole`);
    assert.ok(res.rhs.includes("${1:/*"), `${type}: the hole carries a type-hint comment, got ${JSON.stringify(res.rhs)}`);
    assert.ok(res.rhs.includes(type), `${type}: the hint names the type so the human knows what to construct, got ${JSON.stringify(res.rhs)}`);
  }
});

ptest("renderBlankValue csharp: `T?` is ONE HINTED hole - the variant IS the answer, which is the Option/Result precedent, and that precedent is HINTED rather than bare [contract-cs.md '`T?` | one HINTED hole. The variant IS the answer, the Option/Result precedent'; goal.md Amendment 2 'renderBlankValue(\"Option<u32>\") -> ${1:/* Option<u32> */}']", () => {
  for (const type of ["int?", "DtoGapAnalysis?"]) {
    const res = blank(type);
    assert.strictEqual(res.holes, 1, `${type}: whether the answer is null or a value is a CONTRACT decision, so it stays one hole`);
    assert.ok(res.rhs.includes("${1:/*"), `${type}: not a scalar, so it carries its type hint. Got ${JSON.stringify(res.rhs)}`);
    assert.ok(
      !res.rhs.startsWith("new") && !res.rhs.startsWith("(") && !res.rhs.startsWith("["),
      `${type}: a nullable is not a container and must not scaffold a literal. Got ${JSON.stringify(res.rhs)}`
    );
  }
});

ptest("renderBlankValue csharp: a TUPLE `(A, B)` is ONE BARE HOLE PER ELEMENT - per Amendment 6a, a hole is bare when it stands for exactly one value whose type the human can read off the POSITION [contract-cs.md '`(A, B)` tuple | one BARE hole per element, per Amendment 6a'; goal.md Amendment 6a 'A tuple's third hole is unambiguously the third element's type; a hint there tells the human nothing they cannot see']", () => {
  const res = blank("(int, string)");
  assert.strictEqual(res.holes, 2, `two elements, two holes, so the human Tabs through both. Got ${res.holes}`);
  assert.ok(res.rhs.startsWith("("), `parentheses, got ${JSON.stringify(res.rhs)}`);
  assert.ok(res.rhs.endsWith(")"), `and closed, got ${JSON.stringify(res.rhs)}`);
  assert.ok(
    !res.rhs.includes("/*"),
    `BARE, even for the string element, exactly as the shipped Rust renderer spells (i32, String). Got ${JSON.stringify(res.rhs)}`
  );
  assert.ok(res.rhs.includes("${1"), `the first hole is present, got ${JSON.stringify(res.rhs)}`);
  assert.ok(res.rhs.includes("${2"), `the second hole is present, got ${JSON.stringify(res.rhs)}`);

  const three = blank("(int, string, bool)");
  assert.strictEqual(three.holes, 3, `three elements, three holes, got ${three.holes}`);
});

ptest("renderBlankValue csharp: bare-versus-hinted holds in BOTH DIRECTIONS across the whole table - scalars and tuple elements carry no comment, everything else does [goal.md Amendments 2 and 6a 'Amendments 2 and 6a together are the rule; where they disagree, 6a wins because it is measured']", () => {
  for (const type of ["int", "long", "string", "bool", "double", "(int, string)"]) {
    assert.ok(
      !blank(type).rhs.includes("/*"),
      `${type} is positionally obvious and must be BARE, got ${JSON.stringify(blank(type).rhs)}`
    );
  }
  for (const type of ["List<int>", "int[]", "Dictionary<int, ShiftHour>", "DtoGapAnalysis", "int?"]) {
    assert.ok(
      blank(type).rhs.includes("/*"),
      `${type} stands for an unknown number of values or an unreadable shape, so its hole must carry the hint. Got ${JSON.stringify(blank(type).rhs)}`
    );
  }
});

// ===========================================================================
// 12. Scaffold. "//" markers, the [TestClass] wrapper, the framework's own
//     using, and a generatedTestNames that a string cannot fool.
//     [contract-cs.md '## Scaffold']
// ===========================================================================

const MARKER_ID = "Widen.Apply-1";
// The fully-qualified prefix the rung filters by since item 59: the fixture's
// own namespace and test class, resolved from the file text.
const FQ = "Contoso.ProcessingLogic.Tests.WidenTests.";
const USING_SOURCE = "using Contoso.ProcessingLogic;";
const USING_MSTEST = "using Microsoft.VisualStudio.TestTools.UnitTesting;";

const GENERATED_TESTS =
  "    [TestMethod]\n" +
  "    public void WidenHappy()\n" +
  "    {\n" +
  "        Assert.AreEqual(7, Widen.Apply(3));\n" +
  "    }\n";

// A duck-typed placement, so the scaffold pins depend on scaffold alone.
const csPlacement = (over = {}) => ({
  targetPath: "/w/sln/Contoso.ProcessingLogic.Tests/WidenTests.cs",
  exists: false,
  mode: "project-file",
  runRoot: "/w/sln/Contoso.ProcessingLogic.Tests",
  packageArg: "/w/sln/Contoso.ProcessingLogic.Tests/Contoso.ProcessingLogic.Tests.csproj",
  importLine: USING_SOURCE,
  packageName: "Contoso.ProcessingLogic.Tests",
  frameworkImportLine: USING_MSTEST,
  // ADDED phase 5 (Amendment 8d): WHICH framework detected, so the scaffold can
  // look up the framework's ATTRIBUTES and not only its using line.
  frameworkId: "mstest",
  ...over,
});

const scaffoldFor = (existingText, placementOver = {}) => {
  const plan = csLang.scaffold({
    existingText,
    generatedTests: GENERATED_TESTS,
    markerId: MARKER_ID,
    placement: csPlacement(placementOver),
  });
  assert.strictEqual(typeof plan.start, "number", "start is an offset into the target document");
  assert.strictEqual(typeof plan.end, "number", "end is an offset into the target document");
  assert.ok(plan.end >= plan.start, "the replaced range is not inverted");
  assert.strictEqual(typeof plan.text, "string", "text is what gets written");
  return plan;
};

ptest("scaffold csharp: a NEW file carries the FRAMEWORK's own using, the SOURCE using from the placement, the declared namespace, and a [TestClass] wrapper - the attribute is reachable because Amendment 8d put `frameworkId` on the placement, where before it carried the using line alone [contract-cs.md '## Scaffold' code block; 'The framework's own using and attributes come from the framework entry'; contract-seam.md 'ADDED phase 5 (Amendment 8d). WHICH framework detected ... beyond the using it also needs the framework's ATTRIBUTES']", () => {
  const plan = scaffoldFor("");
  const out = applyPlan("", plan);

  assert.ok(out.includes(USING_MSTEST), `without the framework's using, [TestClass] does not resolve. Got ${JSON.stringify(out)}`);
  assert.ok(out.includes(USING_SOURCE), `the source using comes from the placement, which is the only step that saw the project layout. Got ${JSON.stringify(out)}`);
  assert.ok(
    /namespace\s+Contoso\.ProcessingLogic\.Tests\s*[;{]/.test(out),
    `the file DECLARES the namespace the placement resolved, rather than one guessed from the directory. Got ${JSON.stringify(out)}`
  );
  assert.ok(out.includes("[TestClass]"), `MSTest ignores a class without [TestClass] and the run finds nothing. Got ${JSON.stringify(out)}`);
  assert.ok(/class\s+WidenTests\b/.test(out), `the class is named for the source type, got ${JSON.stringify(out)}`);
});

ptest("scaffold csharp: the generated tests are FENCED in `//` markers carrying the markerId, and the fence sits INSIDE the test class so the region can be replaced later [contract-cs.md '// column80-tests:<id>:begin ... // column80-tests:<id>:end']", () => {
  const plan = scaffoldFor("");
  const out = applyPlan("", plan);

  for (const suffix of ["begin", "end"]) {
    const marker = `column80-tests:${MARKER_ID}:${suffix}`;
    assert.ok(out.includes(marker), `the ${suffix} marker is present, got ${JSON.stringify(out)}`);
    const line = out.split("\n").find((l) => l.includes(marker));
    assert.ok(
      line.trim().startsWith("//"),
      `the ${suffix} marker is a C# comment: a "#" marker is a preprocessor directive and the file would not compile. Got ${JSON.stringify(line)}`
    );
  }

  const begin = out.indexOf(`column80-tests:${MARKER_ID}:begin`);
  const fnAt = out.indexOf("public void WidenHappy");
  const end = out.indexOf(`column80-tests:${MARKER_ID}:end`);
  assert.ok(fnAt > begin && fnAt < end, "the generated method sits INSIDE the fence, or the region cannot be replaced later");
  assert.ok(out.indexOf("[TestClass]") < begin, "the fence is inside the class, not around it");
  assert.ok(out.indexOf(USING_MSTEST) < begin, "the usings sit above the fenced region, where C# requires them");
});

ptest("scaffold csharp: extending a file that ALREADY has the usings must NOT duplicate either of them, and must leave the human's own tests untouched [contract-cs.md 'Existing file: ... `extend-existing` inserting the region inside the existing test class']", () => {
  const existing =
    USING_MSTEST +
    "\n" +
    USING_SOURCE +
    "\n" +
    "\n" +
    "namespace Contoso.ProcessingLogic.Tests;\n" +
    "\n" +
    "[TestClass]\n" +
    "public class WidenTests\n" +
    "{\n" +
    "    [TestMethod]\n" +
    "    public void HumanWroteThis()\n" +
    "    {\n" +
    "        Assert.IsNotNull(Widen.Apply(1));\n" +
    "    }\n" +
    "}\n";
  const plan = scaffoldFor(existing, { exists: true });
  assert.strictEqual(plan.mode, "extend-existing", `no marked region exists, so the plan inserts one. Got ${JSON.stringify(plan.mode)}`);

  const out = applyPlan(existing, plan);
  for (const line of [USING_MSTEST, USING_SOURCE]) {
    const count = out.split(line).length - 1;
    assert.strictEqual(
      count,
      1,
      `a duplicated using is noise the human has to clean out of a file they just accepted. Got ${count} occurrences of ${JSON.stringify(line)}`
    );
  }
  assert.ok(out.includes("HumanWroteThis"), "the developer's own test survives untouched");
  assert.ok(out.includes("WidenHappy"), "the generated test rides into the plan");
  assert.ok(out.includes(`column80-tests:${MARKER_ID}:begin`), "the inserted region is fenced so it can be replaced next time");
});

ptest("scaffold csharp: extending keeps the plan NARROW rather than respanning the whole document - the shipped consumer only previews `replace-generated`, so a whole-file span is indistinguishable by MODE from a small insert, and `start === 0 && end === existingText.length` over a non-empty file is unreachable from the insert branch [contract-cs.md 'Keep the plan narrow; if a whole-file span is unavoidable, make it detectable by something other than the mode string. Phase 4's note is the most useful one']", () => {
  const existing =
    USING_MSTEST +
    "\n" +
    USING_SOURCE +
    "\n" +
    "\n" +
    "namespace Contoso.ProcessingLogic.Tests;\n" +
    "\n" +
    "[TestClass]\n" +
    "public class WidenTests\n" +
    "{\n" +
    "    [TestMethod]\n" +
    "    public void HumanWroteThis()\n" +
    "    {\n" +
    "        Assert.IsNotNull(Widen.Apply(1));\n" +
    "    }\n" +
    "}\n";
  const plan = scaffoldFor(existing, { exists: true });
  assert.ok(
    !(plan.start === 0 && plan.end === existing.length),
    `the usings and the human's test are unchanged, so the plan must not span the whole file. Got start=${plan.start}, end=${plan.end}, of a ${existing.length}-character file`
  );
  assert.ok(plan.start > 0, `nothing above the insertion point changes. Got start=${plan.start}`);
});

ptest("scaffold csharp: a file that ALREADY holds a region for this markerId is REPLACED, not appended to twice [contract-cs.md '`replace-generated` when a marked region for this `markerId` exists']", () => {
  const existing =
    USING_MSTEST +
    "\n" +
    USING_SOURCE +
    "\n" +
    "\n" +
    "namespace Contoso.ProcessingLogic.Tests;\n" +
    "\n" +
    "[TestClass]\n" +
    "public class WidenTests\n" +
    "{\n" +
    `    // column80-tests:${MARKER_ID}:begin\n` +
    "    [TestMethod]\n" +
    "    public void WidenHappy()\n" +
    "    {\n" +
    "        Assert.AreEqual(1, Widen.Apply(3));\n" +
    "    }\n" +
    `    // column80-tests:${MARKER_ID}:end\n` +
    "}\n";
  const plan = scaffoldFor(existing, { exists: true });
  assert.strictEqual(
    plan.mode,
    "replace-generated",
    `regenerating replaces this function's region rather than stacking a second one. Got ${JSON.stringify(plan.mode)}`
  );
  const out = applyPlan(existing, plan);
  assert.strictEqual(
    out.split(`column80-tests:${MARKER_ID}:begin`).length - 1,
    1,
    `exactly one region for this markerId after a regenerate, got ${JSON.stringify(out)}`
  );
  assert.strictEqual(
    out.split("[TestClass]").length - 1,
    1,
    `and exactly one test class: a second [TestClass] is a second file's worth of scaffolding in one file. Got ${JSON.stringify(out)}`
  );
});

ptest("generatedTestNames csharp: reads the METHOD NAMES inside the marked region, in order, and is NOT fooled by a name inside a STRING or a comment - phase 3 shipped a regex that found a phantom name inside submit('save') and phase 4 fixed the same class in Python [contract-cs.md '`generatedTestNames` reads the method name inside the marked region, walking the LITERAL-AWARE scanner rather than a raw regex']", () => {
  const fileText =
    USING_MSTEST +
    "\n" +
    USING_SOURCE +
    "\n" +
    "\n" +
    "namespace Contoso.ProcessingLogic.Tests;\n" +
    "\n" +
    "[TestClass]\n" +
    "public class WidenTests\n" +
    "{\n" +
    "    [TestMethod]\n" +
    "    public void HumanWroteThis()\n" +
    "    {\n" +
    "        Assert.IsNotNull(Widen.Apply(1));\n" +
    "    }\n" +
    "\n" +
    `    // column80-tests:${MARKER_ID}:begin\n` +
    "    [TestMethod]\n" +
    "    public void WidenHappy()\n" +
    "    {\n" +
    '        var note = "public void PhantomInString()";\n' +
    '        var verbatim = @"public void PhantomInVerbatim()";\n' +
    "        Assert.AreEqual(7, Widen.Apply(3));\n" +
    "    }\n" +
    "\n" +
    "    [TestMethod]\n" +
    "    public void WidenZero()\n" +
    "    {\n" +
    "        // public void PhantomInComment()\n" +
    "        Assert.AreEqual(0, Widen.Apply(0));\n" +
    "    }\n" +
    `    // column80-tests:${MARKER_ID}:end\n` +
    "\n" +
    "    [TestMethod]\n" +
    "    public void OutsideTheRegion()\n" +
    "    {\n" +
    "        Assert.IsTrue(true);\n" +
    "    }\n" +
    "}\n";

  const names = csLang.generatedTestNames(fileText, MARKER_ID);
  // AMENDED by item 59: the names are FULLY QUALIFIED now, because
  // `FullyQualifiedName=` matches the whole name and nothing less, and `~Add`
  // also ran `AddMore`. The contract's demand is unchanged — real method
  // declarations only, in order, no phantom from a string or a comment.
  assert.deepStrictEqual(
    names,
    [`${FQ}WidenHappy`, `${FQ}WidenZero`],
    `only the real methods inside the region, in order. A phantom name goes into the FullyQualifiedName filter and selects nothing, or worse selects something else. Got ${JSON.stringify(names)}`
  );
  assert.ok(!names.includes("HumanWroteThis"), "the human's own test is outside the region and is not this function's");
  assert.ok(!names.includes("OutsideTheRegion"), "so is anything below the end marker");
  assert.deepStrictEqual(
    csLang.generatedTestNames(fileText, "some-other-id"),
    [],
    "a different markerId sees none of this region's tests"
  );
});

ptest("generatedTestNames csharp: the scaffold ROUND-TRIPS, so scaffold and the rung's filter cannot drift [contract-cs.md '`markerPrefix` is `\"//\"` ... One source of the marker format so scaffold and generatedTestNames cannot drift']", () => {
  const plan = scaffoldFor("");
  const out = applyPlan("", plan);
  assert.deepStrictEqual(
    csLang.generatedTestNames(out, MARKER_ID),
    [`${FQ}WidenHappy`],
    `the round trip recovers the generated name, got ${JSON.stringify(csLang.generatedTestNames(out, MARKER_ID))}`
  );
});

ptest("csharp TddLang: testNameIsValid is either absent or accepts an ordinary C# method name - nothing in VSTest constrains a test method's name the way Go does [contract-seam.md 'Go requires `Test` plus an uppercase letter or the runner ignores the function. undefined = no constraint']", () => {
  if (csLang.testNameIsValid === undefined) return; // no constraint, which is the expected shape
  for (const name of ["WidenHappy", "AggregateFanoutZero", "Widen_Happy"]) {
    assert.strictEqual(
      csLang.testNameIsValid(name),
      true,
      `${JSON.stringify(name)} is a legal C# method name and [TestMethod] collects it`
    );
  }
});
