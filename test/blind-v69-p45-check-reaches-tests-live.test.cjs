// LIVE falsification for session-v69 phases 4 and 5: the check the product runs
// must reach the test code the product WROTE, for Python and C#
// [session-v69/contracts/phase45-check-reaches-the-tests.md].
//
// Blind: src/core/pyOracle.ts, src/core/csOracle.ts, src/core/tddPy.ts and
// src/core/tddCs.ts were never opened. Every row drives the REAL toolchain
// through the oracle's OWN buildCheckCommand / parseCheckOutput / checkSuccess
// against a throwaway tree in a temp dir. Nothing here builds a command by
// hand: a re-derived command is a fact about the harness, not the product.
//
// This is the file the contract's "Falsification the tests must carry" section
// specifies. Per language, in this order:
//   1. RED on known-bad test code planted where the product would have written
//      it, with diagnostics naming that file.
//   2. GREEN on the same tree with the defect removed.
//   3. Rule 0: an error in the SOURCE that the old command reported is still
//      reported by the new one.
// A ground-truth row runs first in each language, independent of the oracle, so
// a red row cannot be blamed on a fixture that was never broken to begin with.
//
// Skip with SKIP_LIVE, or automatically when the toolchain is absent.
//
// Run: node --test --test-concurrency=1 test/blind-v69-p45-check-reaches-tests-live.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const os = require("os");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const { bundleCore } = require("./.blind-util.cjs");

const LIVE_TIMEOUT = 300_000;
const SKIP_ALL = process.env.SKIP_LIVE ? "SKIP_LIVE set" : false;

const dotnetPresent = () => spawnSync("dotnet", ["--version"], { encoding: "utf8" }).status === 0;
// The product's pyright entry. node_modules/pyright/dist/pyright.js is the WRONG
// one - it floods 1000+ bogus diagnostics from another cwd.
const PYRIGHT_ENTRY = path.join(__dirname, "..", "node_modules", "pyright", "index.js");

const SKIP_CS = SKIP_ALL || (dotnetPresent() ? false : "dotnet absent");
const SKIP_PY = SKIP_ALL || (fs.existsSync(PYRIGHT_ENTRY) ? false : "node_modules/pyright absent");

let mod = {};
let cleanupBundle = () => {};
let bundleError;
try {
  ({ mod, cleanup: cleanupBundle } = bundleCore(
    "blind-v69-p45-live",
    `export { PyOracle } from "../src/core/pyOracle";\n` +
      `export { CsOracle } from "../src/core/csOracle";\n`
  ));
} catch (e) {
  bundleError = e;
}
test.after(() => cleanupBundle());
const { PyOracle, CsOracle } = mod;

const scratch = [];
test.after(() => {
  for (const d of scratch) fs.rmSync(d, { recursive: true, force: true });
});

function tree(tag, files) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), `c80-v69-live-${tag}-${crypto.randomBytes(3).toString("hex")}-`));
  scratch.push(d);
  for (const [rel, body] of Object.entries(files)) {
    const p = path.join(d, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body);
  }
  return d;
}

/** Run the oracle's OWN command and read its OWN verdict. */
function runCheck(oracle, root, filePath) {
  assert.strictEqual(bundleError, undefined, `bundle failed: ${bundleError}`);
  const cmd = oracle.buildCheckCommand(root, undefined, filePath);
  const startedAt = Date.now();
  const res = spawnSync(cmd.command, cmd.args, {
    cwd: cmd.cwd ?? root,
    encoding: "utf8",
    timeout: LIVE_TIMEOUT - 30_000,
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, ...(cmd.env ?? {}) },
  });
  const output = cmd.diagnosticsOnStderr
    ? [res.stdout ?? "", res.stderr ?? ""].filter((s) => s.length > 0).join("\n")
    : res.stdout ?? "";
  return {
    cmd,
    output,
    stderr: res.stderr ?? "",
    diagnostics: oracle.parseCheckOutput(output, root, startedAt),
    success: oracle.checkSuccess(output, res.status ?? -1),
  };
}

const errorsOf = (r) => r.diagnostics.filter((d) => d.level === "error");
const filesNamed = (r) =>
  errorsOf(r).map((d) => (d.spans.find((s) => s.isPrimary) || d.spans[0] || {}).fileName);
const shortOutput = (r) => `${r.output}\n${r.stderr}`.slice(0, 4000);

// ===========================================================================
// PHASE 4, C#. The product writes its tests into a SEPARATE test project.
// `dotnet build <source csproj>` never compiles one: a test project references
// the source, never the reverse.
//
// The fixture needs no NuGet test package - <IsTestProject>true</IsTestProject>
// is what makes it a test project by contract rule 1 - so it restores offline.
// ===========================================================================

const SRC_CSPROJ =
  '<Project Sdk="Microsoft.NET.Sdk">\n  <PropertyGroup>\n' +
  "    <TargetFramework>net10.0</TargetFramework>\n    <Nullable>disable</Nullable>\n  </PropertyGroup>\n</Project>\n";

const TEST_CSPROJ =
  '<Project Sdk="Microsoft.NET.Sdk">\n  <PropertyGroup>\n' +
  "    <TargetFramework>net10.0</TargetFramework>\n    <Nullable>disable</Nullable>\n" +
  "    <IsTestProject>true</IsTestProject>\n  </PropertyGroup>\n" +
  '  <ItemGroup>\n    <ProjectReference Include="../../src/App/App.csproj" />\n  </ItemGroup>\n</Project>\n';

const CS_LIB = `namespace App;

public static class Lib
{
    public static int FirstEven(int[] xs)
    {
        foreach (var x in xs)
        {
            if (x % 2 == 0) { return x; }
        }
        return -1;
    }
}
`;

// The C# twin of the defect that opened this session: the generated test calls
// its target with the wrong arity and leans on a name that does not exist.
const CS_TEST_BROKEN = `using App;

public class LibTests
{
    public void FirstEvenWorks()
    {
        var got = Lib.FirstEven(new[] { 1, 2, 3 }, 99);
        if (got != NoSuchConstant) { throw new System.Exception("bad"); }
    }
}
`;

const CS_TEST_CLEAN = `using App;

public class LibTests
{
    public void FirstEvenWorks()
    {
        var got = Lib.FirstEven(new[] { 1, 2, 3 });
        if (got != 2) { throw new System.Exception("bad"); }
    }
}
`;

/** A restored two-project tree. Restoring the TEST project restores the source
 *  project it references, so both carry obj/project.assets.json. */
function csTree(tag, { testBody = CS_TEST_CLEAN, extraSource } = {}) {
  const files = {
    // The SOLUTION, added after the fixture was first written (contract
    // amendment 1a). The search for a test project covers the source project's
    // siblings plus every project a `.sln` above it lists, and `tests/App.Tests`
    // is neither a sibling of `src/App` nor listed by anything. Without this the
    // fixture describes a tree the product also refuses to WRITE a test into —
    // verified live, `placementFor` answers `no-test-project` on it — so the row
    // would have been asking the check to reach tests that could never be there.
    // The headless file pins the no-solution case on its own.
    "App.sln": 'Project("{FAE04EC0}") = "App", "src\\App\\App.csproj", "{1}"\nProject("{FAE04EC0}") = "App.Tests", "tests\\App.Tests\\App.Tests.csproj", "{2}"\n',
    "src/App/App.csproj": SRC_CSPROJ,
    "src/App/Lib.cs": CS_LIB,
    "tests/App.Tests/App.Tests.csproj": TEST_CSPROJ,
    "tests/App.Tests/LibTests.cs": testBody,
  };
  if (extraSource) files["src/App/Extra.cs"] = extraSource;
  const repo = tree(tag, files);
  const testProj = path.join(repo, "tests", "App.Tests", "App.Tests.csproj");
  const r = spawnSync("dotnet", ["restore", testProj], {
    cwd: repo,
    encoding: "utf8",
    timeout: LIVE_TIMEOUT - 30_000,
    env: { ...process.env, DOTNET_CLI_TELEMETRY_OPTOUT: "1", DOTNET_NOLOGO: "1" },
  });
  assert.strictEqual(r.status, 0, `the fixture must restore offline before any --no-restore build:\n${r.stdout}\n${r.stderr}`);
  assert.ok(fs.existsSync(path.join(repo, "tests", "App.Tests", "obj", "project.assets.json")), "the test project is restored");
  assert.ok(fs.existsSync(path.join(repo, "src", "App", "obj", "project.assets.json")), "and so is the source project it references");
  return { repo, srcRoot: path.join(repo, "src", "App"), testFile: path.join(repo, "tests", "App.Tests", "LibTests.cs") };
}

test(
  "[P4 live] cs ground truth: the planted test code really is broken - building the TEST project reports both errors [fixture proof, independent of the oracle]",
  { skip: SKIP_CS, timeout: LIVE_TIMEOUT },
  () => {
    const { repo } = csTree("cs-ground", { testBody: CS_TEST_BROKEN });
    const r = spawnSync("dotnet", ["build", path.join(repo, "tests", "App.Tests", "App.Tests.csproj"), "--no-restore"], {
      cwd: repo,
      encoding: "utf8",
      timeout: LIVE_TIMEOUT - 30_000,
      env: { ...process.env, DOTNET_CLI_TELEMETRY_OPTOUT: "1", DOTNET_NOLOGO: "1" },
    });
    assert.notStrictEqual(r.status, 0, `the test project does not compile:\n${r.stdout}`);
    assert.ok(/LibTests\.cs.*error CS1501|LibTests\.cs.*error CS1503|LibTests\.cs.*error CS7036/.test(r.stdout), `an arity error names LibTests.cs, got:\n${r.stdout}`);
    assert.ok(/LibTests\.cs.*error CS0103/.test(r.stdout), `the undefined-name error names LibTests.cs, got:\n${r.stdout}`);
  }
);

test(
  "[P4 live] cs: the check is RED on a test project that does not compile, and the diagnostics name that file [contract: falsification 1, cs rules 1+2]",
  { skip: SKIP_CS, timeout: LIVE_TIMEOUT },
  () => {
    const { srcRoot, testFile } = csTree("cs-red", { testBody: CS_TEST_BROKEN });
    const r = runCheck(new CsOracle(), srcRoot);
    assert.strictEqual(r.success, false, `the check must fail on this tree - today it builds only the source project and reports clean. Output:\n${shortOutput(r)}`);
    const named = filesNamed(r);
    assert.ok(named.length > 0, `diagnostics came back with spans, got ${JSON.stringify(r.diagnostics)}`);
    assert.ok(named.every((f) => f && path.isAbsolute(f)), `every span is an absolute path, got ${JSON.stringify(named)}`);
    assert.ok(named.some((f) => f === testFile), `a diagnostic names the test file the product wrote, got ${JSON.stringify(named)}`);
    for (const d of errorsOf(r).filter((d) => (d.spans[0] || {}).fileName === testFile)) {
      assert.ok(d.spans[0].byteStart >= 0, "with a usable byte offset, not the -1 sentinel");
    }
  }
);

test(
  "[P4 live] cs: the same restored tree with the defect removed is GREEN [contract: falsification 2]",
  { skip: SKIP_CS, timeout: LIVE_TIMEOUT },
  () => {
    const { srcRoot } = csTree("cs-green", { testBody: CS_TEST_CLEAN });
    const r = runCheck(new CsOracle(), srcRoot);
    assert.strictEqual(r.success, true, `a compiling test project earns the green. Output:\n${shortOutput(r)}`);
    assert.deepStrictEqual(errorsOf(r), [], `no errors on a clean tree, got ${JSON.stringify(errorsOf(r).map((d) => [d.code, d.message]))}`);
  }
);

test(
  "[P4 live] cs rule 0: an error in the SOURCE is still reported once the target moves [contract: rule 0]",
  { skip: SKIP_CS, timeout: LIVE_TIMEOUT },
  () => {
    const extra = "namespace App;\n\npublic static class Extra\n{\n    public static int Boom() { string s = 5; return s; }\n}\n";
    const { repo, srcRoot } = csTree("cs-rule0", { testBody: CS_TEST_CLEAN, extraSource: extra });
    const r = runCheck(new CsOracle(), srcRoot);
    assert.strictEqual(r.success, false, `the source error still fails the check. Output:\n${shortOutput(r)}`);
    const named = filesNamed(r);
    assert.ok(
      named.some((f) => f === path.join(repo, "src", "App", "Extra.cs")),
      `the SOURCE diagnostic survives the widening - a widening must not open a new way to report clean, got ${JSON.stringify(named)}`
    );
    assert.ok(errorsOf(r).some((d) => d.code === "CS0029"), `the real compiler code rides through, got ${JSON.stringify(errorsOf(r).map((d) => d.code))}`);
  }
);

test(
  "[P4 live] cs rule 0: a source error is still reported when the TEST project is broken too [contract: rule 0, the both-broken case]",
  { skip: SKIP_CS, timeout: LIVE_TIMEOUT },
  () => {
    const extra = "namespace App;\n\npublic static class Extra\n{\n    public static int Boom() { string s = 5; return s; }\n}\n";
    const { repo, srcRoot } = csTree("cs-rule0-both", { testBody: CS_TEST_BROKEN, extraSource: extra });
    const r = runCheck(new CsOracle(), srcRoot);
    assert.strictEqual(r.success, false, `output:\n${shortOutput(r)}`);
    assert.ok(
      filesNamed(r).some((f) => f === path.join(repo, "src", "App", "Extra.cs")),
      `the source project's own error is never traded away for the test project's, got ${JSON.stringify(filesNamed(r))}`
    );
  }
);

test(
  "[P4 live] cs rule 4: an UNRESTORED test project does not turn a passing check into NETSDK1004 [contract: cs rule 4 'Restored or nothing']",
  { skip: SKIP_CS, timeout: LIVE_TIMEOUT },
  () => {
    const { repo, srcRoot } = csTree("cs-unrestored", { testBody: CS_TEST_BROKEN });
    fs.rmSync(path.join(repo, "tests", "App.Tests", "obj"), { recursive: true, force: true });
    const r = runCheck(new CsOracle(), srcRoot);
    assert.strictEqual(r.success, true, `the source project alone still builds; the unrestored test project is refused, not attempted. Output:\n${shortOutput(r)}`);
    assert.ok(!/NETSDK1004/.test(r.output), `no restore failure reaches the human, got:\n${shortOutput(r)}`);
  }
);

test(
  "[P4 live] cs rule 5: crateRoot does not move - cwd and the SARIF key stay the SOURCE project's [contract: cs rule 5]",
  { skip: SKIP_CS, timeout: LIVE_TIMEOUT },
  () => {
    const { repo, srcRoot } = csTree("cs-root", { testBody: CS_TEST_BROKEN });
    const errorLog = (cmd) => cmd.args.find((a) => /ErrorLog=/.test(a));
    const widened = new CsOracle().buildCheckCommand(srcRoot);
    assert.strictEqual(widened.cwd, srcRoot, "cwd is still the source project's directory");
    fs.rmSync(path.join(repo, "tests"), { recursive: true, force: true });
    const today = new CsOracle().buildCheckCommand(srcRoot);
    assert.strictEqual(errorLog(widened), errorLog(today), "the SARIF path is keyed by crateRoot, which did not move");
    assert.strictEqual(widened.cwd, today.cwd, "and neither did the cwd");
    // That the parse still FINDS that SARIF while crateRoot is the source dir is
    // what the RED row above exercises end to end.
  }
);

// ===========================================================================
// PHASE 5, PYTHON. The product writes tests/test_<stem>.py; pyright is handed
// ONE file, the source, so the test file is never opened.
// ===========================================================================

const PY_SRC = `def first_even(xs: list[int]) -> int | None:
    for x in xs:
        if x % 2 == 0:
            return x
    return None
`;

const PY_TEST_BROKEN = `from lib import first_even


def test_first_even() -> None:
    assert first_even([1, 2, 3], 99) == 2
    assert first_even([1]) is no_such_name
`;

const PY_TEST_CLEAN = `from lib import first_even


def test_first_even() -> None:
    assert first_even([1, 2, 3]) == 2
    assert first_even([1]) is None
`;

function pyTree(tag, { testRel = "tests/test_lib.py", testBody = PY_TEST_CLEAN, srcRel = "lib.py", srcBody = PY_SRC, pyproject = '[project]\nname = "probe"\n' } = {}) {
  const files = { "pyproject.toml": pyproject, [srcRel]: srcBody };
  if (testRel) files[testRel] = testBody;
  const root = tree(tag, files);
  return { root, src: path.join(root, srcRel), testFile: testRel ? path.join(root, testRel) : undefined };
}

test(
  "[P5 live] py ground truth: real pyright, handed BOTH files, reports both planted errors against the test file [fixture proof, independent of the oracle]",
  { skip: SKIP_PY, timeout: LIVE_TIMEOUT },
  () => {
    const { root, src, testFile } = pyTree("py-ground", { testBody: PY_TEST_BROKEN });
    const r = spawnSync(process.execPath, [PYRIGHT_ENTRY, "--outputjson", src, testFile], {
      cwd: root,
      encoding: "utf8",
      timeout: LIVE_TIMEOUT - 30_000,
      maxBuffer: 64 * 1024 * 1024,
    });
    const doc = JSON.parse(r.stdout);
    assert.strictEqual(doc.summary.filesAnalyzed, 2, `both files were analyzed, got ${JSON.stringify(doc.summary)}`);
    const rules = doc.generalDiagnostics.filter((g) => g.severity === "error").map((g) => g.rule);
    assert.ok(rules.includes("reportCallIssue"), `the arity error, got ${JSON.stringify(rules)}`);
    assert.ok(rules.includes("reportUndefinedVariable"), `the undefined-name error, got ${JSON.stringify(rules)}`);
    assert.ok(
      doc.generalDiagnostics.every((g) => g.severity !== "error" || g.file === testFile),
      `both errors live in the test file, got ${JSON.stringify(doc.generalDiagnostics.map((g) => g.file))}`
    );
  }
);

test(
  "[P5 live] py: the check is RED on a companion test that does not type-check, and the diagnostics name that file [contract: falsification 1, py rules 1+2]",
  { skip: SKIP_PY, timeout: LIVE_TIMEOUT },
  () => {
    const { root, src, testFile } = pyTree("py-red", { testBody: PY_TEST_BROKEN });
    const r = runCheck(new PyOracle(), root, src);
    assert.strictEqual(r.success, false, `the check must fail - today pyright is handed the source alone and reports clean. Output:\n${shortOutput(r)}`);
    const named = filesNamed(r);
    assert.ok(named.includes(testFile), `a diagnostic names tests/test_lib.py, got ${JSON.stringify(named)}`);
    const codes = errorsOf(r).map((d) => d.code);
    assert.ok(codes.includes("reportCallIssue"), `the arity error surfaced, got ${JSON.stringify(codes)}`);
    assert.ok(codes.includes("reportUndefinedVariable"), `the undefined-name error surfaced, got ${JSON.stringify(codes)}`);
    for (const d of errorsOf(r)) {
      const s = d.spans.find((x) => x.isPrimary) || d.spans[0];
      assert.ok(path.isAbsolute(s.fileName), `the companion's own absolute path [py rule 6], got ${s.fileName}`);
      assert.ok(s.byteStart >= 0, "with a usable byte offset, not the -1 sentinel");
    }
  }
);

test(
  "[P5 live] py: the same tree with the defect removed is GREEN [contract: falsification 2]",
  { skip: SKIP_PY, timeout: LIVE_TIMEOUT },
  () => {
    const { root, src } = pyTree("py-green", { testBody: PY_TEST_CLEAN });
    const r = runCheck(new PyOracle(), root, src);
    assert.strictEqual(r.success, true, `a clean companion earns the green. Output:\n${shortOutput(r)}`);
    assert.deepStrictEqual(errorsOf(r), [], `no errors, got ${JSON.stringify(errorsOf(r).map((d) => [d.code, d.message]))}`);
  }
);

test(
  "[P5 live] py rule 0: an error in the SOURCE is still reported once the companion joins the command [contract: rule 0]",
  { skip: SKIP_PY, timeout: LIVE_TIMEOUT },
  () => {
    const { root, src } = pyTree("py-rule0", {
      testBody: PY_TEST_CLEAN,
      srcBody: PY_SRC + "\n\ndef broken() -> int:\n    return undefined_in_source\n",
    });
    const r = runCheck(new PyOracle(), root, src);
    assert.strictEqual(r.success, false, `the source error still fails the check. Output:\n${shortOutput(r)}`);
    const named = filesNamed(r);
    assert.ok(named.includes(src), `the SOURCE diagnostic survives the widening, got ${JSON.stringify(named)}`);
    assert.ok(
      errorsOf(r).some((d) => d.code === "reportUndefinedVariable"),
      `and it is the real rule, got ${JSON.stringify(errorsOf(r).map((d) => d.code))}`
    );
  }
);

test(
  "[P5 live] py: the beside-the-source companion is reached too, when no test dir exists [contract: py rule 2's third branch]",
  { skip: SKIP_PY, timeout: LIVE_TIMEOUT },
  () => {
    const { root, src, testFile } = pyTree("py-beside", { srcRel: "pkg/lib.py", testRel: "pkg/test_lib.py", testBody: PY_TEST_BROKEN.replace("from lib import", "from pkg.lib import") });
    const r = runCheck(new PyOracle(), root, src);
    assert.strictEqual(r.success, false, `the companion beside the source is checked. Output:\n${shortOutput(r)}`);
    assert.ok(filesNamed(r).includes(testFile), `the diagnostics name it, got ${JSON.stringify(filesNamed(r))}`);
  }
);

test(
  "[P5 live] py rule 3: a source that is ITSELF a test file gets today's command, and stays green when a sibling is broken [contract: py rule 3]",
  { skip: SKIP_PY, timeout: LIVE_TIMEOUT },
  () => {
    const { root } = pyTree("py-istest", {
      testRel: "tests/test_lib.py",
      testBody: "def test_ok() -> None:\n    assert True\n",
    });
    fs.writeFileSync(path.join(root, "tests", "test_test_lib.py"), "def test_meta() -> None:\n    assert no_such_name\n");
    const r = runCheck(new PyOracle(), root, path.join(root, "tests", "test_lib.py"));
    assert.strictEqual(r.success, true, `a test file has no companion of its own, so the broken test_test_lib.py is never opened. Output:\n${shortOutput(r)}`);
    assert.deepStrictEqual(errorsOf(r), []);
  }
);
