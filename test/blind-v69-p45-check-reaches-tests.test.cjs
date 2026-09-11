// Blind oracle for session-v69 phases 4 and 5: the check reaches the tests the
// product wrote [session-v69/contracts/phase45-check-reaches-the-tests.md].
//
// Written from that contract ALONE. src/core/pyOracle.ts, src/core/csOracle.ts,
// src/core/tddPy.ts and src/core/tddCs.ts were never opened and never grepped:
// an oracle that agrees with the implementation is worthless. Every row below
// is derived from the contract's rule 0, from Python rules 1-5, from C# rules
// 1-6, and from the "What the human sees" paragraph. Nothing else.
//
// Surfaces exercised, and only these:
//   PyOracle.buildCheckCommand(crateRoot, project, filePath)
//   CsOracle.buildCheckCommand(crateRoot)
//
// The trees are REAL throwaway dirs under os.tmpdir() rather than a virtual fs.
// The contract's derivations are all "does this file/dir exist" questions, and
// a real temp tree answers them through whichever dep the implementation
// happens to use. A hand-built fake fs would pin the seam, not the behaviour,
// and a blind oracle must not guess the seam.
//
// "Today's command, byte for byte" is asserted the only way a blind test can:
// the SAME tree is rebuilt with the companion file (or the test project)
// removed, and the two commands are compared field by field. Nothing here
// hardcodes what today's command looks like.
//
// NOT asserted: Python rule 1 and C# rule 1's "from ONE shared implementation".
// Two surfaces would have to be compared, and the TDD placement surface is off
// limits to this author. The observable half of both rules - the derivation
// itself - is pinned in full below.
//
// EXPECTED RED: phases 4 and 5 are unbuilt, so every row for the NEW behaviour
// fails. Rows for the unchanged behaviour (Python rules 3, 4, 5; C# rules 3, 6)
// pass today and must keep passing: rule 0 says a widening may not open a new
// way to report clean.
//
// Run: SKIP_LIVE=1 node --test test/blind-v69-p45-check-reaches-tests.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const os = require("os");
const crypto = require("crypto");
const { bundleCore } = require("./.blind-util.cjs");

let mod = {};
let cleanupBundle = () => {};
let bundleError;
try {
  ({ mod, cleanup: cleanupBundle } = bundleCore(
    "blind-v69-p45",
    `export { PyOracle } from "../src/core/pyOracle";\n` +
      `export { CsOracle } from "../src/core/csOracle";\n`
  ));
} catch (e) {
  bundleError = e;
}
if (!bundleError && typeof mod.PyOracle !== "function") bundleError = new Error("the bundle exports no PyOracle");
if (!bundleError && typeof mod.CsOracle !== "function") bundleError = new Error("the bundle exports no CsOracle");
test.after(() => cleanupBundle());

const { PyOracle, CsOracle } = mod;

test("bundle: both check surfaces build", () => {
  if (bundleError) assert.fail(`the surface is not implemented yet: ${bundleError.message}`);
});

// Every other row skips (not fails) while the bundle is broken, so a missing
// module stays one loud failure instead of a wall of TypeErrors.
const gtest = (name, fn) =>
  test(name, (ctx) => {
    if (bundleError) return ctx.skip("bundle failed to build; see the bundle row");
    return fn(ctx);
  });

// ---------------------------------------------------------------------------
// Throwaway trees.
// ---------------------------------------------------------------------------

const scratch = [];
test.after(() => {
  for (const d of scratch) fs.rmSync(d, { recursive: true, force: true });
});

function tree(tag, files) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), `c80-v69-p45-${tag}-${crypto.randomBytes(3).toString("hex")}-`));
  scratch.push(d);
  for (const [rel, body] of Object.entries(files)) {
    const p = path.join(d, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    if (body === null) fs.mkdirSync(p, { recursive: true });
    else fs.writeFileSync(p, body);
  }
  return d;
}

/** Field-by-field equality of two spawn descriptors: the contract's "byte for
 *  byte" for a command that is an object, not a string. */
function sameCommand(actual, control, why) {
  assert.deepStrictEqual(actual.args, control.args, `${why}: the argv must be identical`);
  assert.strictEqual(actual.command, control.command, `${why}: the executable must be identical`);
  assert.strictEqual(actual.cwd, control.cwd, `${why}: the cwd must be identical`);
  assert.deepStrictEqual(actual.env ?? {}, control.env ?? {}, `${why}: the child env must be identical`);
}

const lineBag = () => {
  const lines = [];
  return { lines, deps: { log: (l) => lines.push(typeof l === "string" ? l : JSON.stringify(l)) } };
};

// ===========================================================================
// PHASE 5, PYTHON. [contract: "Phase 5, Python", rules 1-5 + rule 0]
// ===========================================================================

const PY_SRC = "def first_even(xs: list[int]) -> int | None:\n    return next((x for x in xs if x % 2 == 0), None)\n";
const PY_TEST = "from lib import first_even\n\n\ndef test_first_even() -> None:\n    assert first_even([1, 2]) == 2\n";

/** Every .py/.pyi path the command hands pyright, in order. */
const pyTargets = (cmd) => cmd.args.filter((a) => /\.pyi?$/.test(a) && !/[\\/]pyright[\\/]/.test(a));

gtest("py rule 2: testpaths' FIRST entry resolves the test dir; the companion is test_<stem>.py and rides beside the source [contract: py rule 2]", () => {
  const root = tree("py-testpaths", {
    "pyproject.toml": '[project]\nname = "probe"\n\n[tool.pytest.ini_options]\ntestpaths = ["mytests", "other"]\n',
    "lib.py": PY_SRC,
    "mytests/test_lib.py": PY_TEST,
    "other/test_lib.py": PY_TEST,
    "tests/test_lib.py": PY_TEST,
  });
  const src = path.join(root, "lib.py");
  const cmd = new PyOracle().buildCheckCommand(root, undefined, src);
  const targets = pyTargets(cmd);
  assert.ok(targets.includes(src), `the SOURCE is still a target - a widening is additive [rule 0], got ${JSON.stringify(targets)}`);
  assert.ok(
    targets.includes(path.join(root, "mytests", "test_lib.py")),
    `the companion under testpaths[0] is handed to pyright too, got ${JSON.stringify(targets)}`
  );
  assert.ok(!targets.includes(path.join(root, "other", "test_lib.py")), "testpaths' SECOND entry is not a test dir here: only the first entry resolves");
  assert.ok(!targets.includes(path.join(root, "tests", "test_lib.py")), "a declared testpaths beats the <root>/tests fallback");
  assert.strictEqual(targets.length, 2, `exactly the source and its one companion, got ${JSON.stringify(targets)}`);
});

gtest("py rule 2: testpaths resolves against the PROJECT ROOT, not the source dir [contract: py rule 2 'resolved against the project root']", () => {
  const root = tree("py-testpaths-root", {
    "pyproject.toml": '[project]\nname = "probe"\n\n[tool.pytest.ini_options]\ntestpaths = ["mytests"]\n',
    "pkg/lib.py": PY_SRC,
    "mytests/test_lib.py": PY_TEST,
    "pkg/mytests/test_lib.py": PY_TEST,
  });
  const targets = pyTargets(new PyOracle().buildCheckCommand(root, undefined, path.join(root, "pkg", "lib.py")));
  assert.ok(targets.includes(path.join(root, "mytests", "test_lib.py")), `<root>/mytests wins, got ${JSON.stringify(targets)}`);
  assert.ok(!targets.includes(path.join(root, "pkg", "mytests", "test_lib.py")), "the source dir is not the anchor for testpaths");
});

gtest("py rule 2: no testpaths but <root>/tests exists -> <root>/tests/test_<stem>.py [contract: py rule 2 'else <root>/tests when that directory exists']", () => {
  const root = tree("py-testsdir", {
    "pyproject.toml": '[project]\nname = "probe"\n',
    "pkg/lib.py": PY_SRC,
    "tests/test_lib.py": PY_TEST,
    "pkg/test_lib.py": PY_TEST,
  });
  const targets = pyTargets(new PyOracle().buildCheckCommand(root, undefined, path.join(root, "pkg", "lib.py")));
  assert.ok(targets.includes(path.join(root, "tests", "test_lib.py")), `the <root>/tests companion, got ${JSON.stringify(targets)}`);
  assert.ok(!targets.includes(path.join(root, "pkg", "test_lib.py")), "an existing tests/ dir beats the beside-the-source fallback");
  assert.strictEqual(targets.length, 2, "the source and exactly one companion");
});

gtest("py rule 2: no testpaths and no tests dir -> the companion sits beside the SOURCE [contract: py rule 2 'else the source file's own directory']", () => {
  const root = tree("py-beside", {
    "pyproject.toml": '[project]\nname = "probe"\n',
    "pkg/lib.py": PY_SRC,
    "pkg/test_lib.py": PY_TEST,
  });
  const targets = pyTargets(new PyOracle().buildCheckCommand(root, undefined, path.join(root, "pkg", "lib.py")));
  assert.deepStrictEqual(
    targets.slice().sort(),
    [path.join(root, "pkg", "lib.py"), path.join(root, "pkg", "test_lib.py")].sort(),
    "source + the companion in its own directory"
  );
});

gtest("py rule 2: the stem drops a .pyi suffix as well as .py [contract: py rule 2 'without its .py or .pyi suffix']", () => {
  const root = tree("py-pyi", {
    "pyproject.toml": '[project]\nname = "probe"\n',
    "lib.pyi": "def first_even(xs: list[int]) -> int | None: ...\n",
    "tests/test_lib.py": "def test_nothing() -> None:\n    assert True\n",
    "tests/test_lib.pyi.py": "def test_wrong_stem() -> None:\n    assert True\n",
  });
  const targets = pyTargets(new PyOracle().buildCheckCommand(root, undefined, path.join(root, "lib.pyi")));
  assert.ok(targets.includes(path.join(root, "tests", "test_lib.py")), `the .pyi stem is 'lib', so the companion is test_lib.py, got ${JSON.stringify(targets)}`);
  assert.ok(!targets.includes(path.join(root, "tests", "test_lib.pyi.py")), "the suffix is stripped, never kept inside the stem");
});

gtest("py rule 3: a source that is ITSELF test_* has no companion - today's command, byte for byte [contract: py rule 3]", () => {
  const root = tree("py-is-test", {
    "pyproject.toml": '[project]\nname = "probe"\n',
    "tests/test_lib.py": PY_TEST,
    "tests/test_test_lib.py": "def test_meta() -> None:\n    assert True\n",
  });
  const src = path.join(root, "tests", "test_lib.py");
  const cmd = new PyOracle().buildCheckCommand(root, undefined, src);
  assert.deepStrictEqual(pyTargets(cmd), [src], `a test file gets only itself, got ${JSON.stringify(pyTargets(cmd))}`);

  // The control: the identical tree with the derived companion absent, which is
  // by rule 4 exactly today's command. Root-relative, since the two temp dirs
  // differ only by their name.
  const control = tree("py-is-test-ctl", {
    "pyproject.toml": '[project]\nname = "probe"\n',
    "tests/test_lib.py": PY_TEST,
  });
  const ctlCmd = new PyOracle().buildCheckCommand(control, undefined, path.join(control, "tests", "test_lib.py"));
  sameCommand(
    { ...cmd, args: cmd.args.map((a) => a.split(root).join("<ROOT>")), cwd: "<ROOT>" },
    { ...ctlCmd, args: ctlCmd.args.map((a) => a.split(control).join("<ROOT>")), cwd: "<ROOT>" },
    "rule 3 is today's command"
  );
});

gtest("py rule 3: a source that is ITSELF *_test has no companion either [contract: py rule 3 'test_* or *_test']", () => {
  const root = tree("py-is-test-suffix", {
    "pyproject.toml": '[project]\nname = "probe"\n',
    "tests/lib_test.py": PY_TEST,
    "tests/test_lib_test.py": "def test_meta() -> None:\n    assert True\n",
  });
  const src = path.join(root, "tests", "lib_test.py");
  const targets = pyTargets(new PyOracle().buildCheckCommand(root, undefined, src));
  assert.deepStrictEqual(targets, [src], `a *_test source gets only itself, got ${JSON.stringify(targets)}`);
});

gtest("py rule 4: a companion that does not exist is not passed [contract: py rule 4]", () => {
  const root = tree("py-nocompanion", {
    "pyproject.toml": '[project]\nname = "probe"\n',
    "pkg/lib.py": PY_SRC,
    "tests/test_other.py": "def test_other() -> None:\n    assert True\n",
  });
  const src = path.join(root, "pkg", "lib.py");
  const cmd = new PyOracle().buildCheckCommand(root, undefined, src);
  assert.deepStrictEqual(pyTargets(cmd), [src], `no test_lib.py anywhere: only the source is checked, got ${JSON.stringify(pyTargets(cmd))}`);
});

gtest("py rule 0+4: planting the companion adds exactly one argument and drops none [contract: rule 0 'no new way to report clean' + py rule 4]", () => {
  const root = tree("py-delta", {
    "pyproject.toml": '[project]\nname = "probe"\n',
    "pkg/lib.py": PY_SRC,
    "tests/test_other.py": "def test_other() -> None:\n    assert True\n",
  });
  const src = path.join(root, "pkg", "lib.py");
  const before = new PyOracle().buildCheckCommand(root, undefined, src);
  fs.writeFileSync(path.join(root, "tests", "test_lib.py"), PY_TEST);
  const after = new PyOracle().buildCheckCommand(root, undefined, src);

  assert.strictEqual(after.command, before.command, "the executable does not move");
  assert.strictEqual(after.cwd, before.cwd, "the cwd does not move");
  assert.deepStrictEqual(after.env ?? {}, before.env ?? {}, "the child env does not move");
  const dropped = before.args.filter((a) => !after.args.includes(a));
  assert.deepStrictEqual(dropped, [], `nothing is dropped - rule 0, no new way to report clean, got ${JSON.stringify(dropped)}`);
  const added = after.args.filter((a) => !before.args.includes(a));
  assert.deepStrictEqual(added, [path.join(root, "tests", "test_lib.py")], `the only delta is the companion, got ${JSON.stringify(added)}`);
});

gtest("py rule 5: no filePath still degrades to checking crateRoot, and no companion is invented [contract: py rule 5]", () => {
  const root = tree("py-nofile", {
    "pyproject.toml": '[project]\nname = "probe"\n',
    "lib.py": PY_SRC,
    "tests/test_lib.py": PY_TEST,
  });
  const cmd = new PyOracle().buildCheckCommand(root);
  assert.ok(cmd.args.includes(root), `the crate root is the target, got ${JSON.stringify(cmd.args)}`);
  assert.deepStrictEqual(pyTargets(cmd), [], "no per-file targets when there is no file");
});

gtest("py: when the companion is added, the channel says so in one line naming the FILE [contract: 'the output channel says so in one line naming ... the file that was added']", () => {
  const root = tree("py-channel", {
    "pyproject.toml": '[project]\nname = "probe"\n',
    "lib.py": PY_SRC,
    "tests/test_lib.py": PY_TEST,
  });
  const bag = lineBag();
  new PyOracle(bag.deps).buildCheckCommand(root, undefined, path.join(root, "lib.py"));
  const named = bag.lines.filter((l) => l.includes("test_lib.py"));
  assert.strictEqual(named.length, 1, `exactly one line names the added file, got ${JSON.stringify(bag.lines)}`);
});

gtest("py: nothing new is said when the target does not move [contract: 'Nothing new on a clean check']", () => {
  const root = tree("py-quiet", { "pyproject.toml": '[project]\nname = "probe"\n', "lib.py": PY_SRC });
  const bag = lineBag();
  new PyOracle(bag.deps).buildCheckCommand(root, undefined, path.join(root, "lib.py"));
  assert.deepStrictEqual(
    bag.lines.filter((l) => /test_/.test(l)),
    [],
    `no companion, so no line about one, got ${JSON.stringify(bag.lines)}`
  );
});

// ===========================================================================
// PHASE 4, C#. [contract: "Phase 4, C#", rules 1-6 + rule 0]
// ===========================================================================

const SRC_CSPROJ = '<Project Sdk="Microsoft.NET.Sdk">\n  <PropertyGroup>\n    <TargetFramework>net10.0</TargetFramework>\n  </PropertyGroup>\n</Project>\n';

/** A test project: `marker` is the qualifying element (or "" for none), `ref`
 *  the relative ProjectReference back to the source project (or "" for none). */
const testCsproj = (marker, ref) =>
  '<Project Sdk="Microsoft.NET.Sdk">\n  <PropertyGroup>\n    <TargetFramework>net10.0</TargetFramework>\n' +
  `    ${marker}\n  </PropertyGroup>\n` +
  (ref ? `  <ItemGroup>\n    <ProjectReference Include="${ref}" />\n  </ItemGroup>\n` : "") +
  "</Project>\n";

const IS_TEST_PROJECT = "<IsTestProject>true</IsTestProject>";
const TEST_SDK_REF = ""; // the Test.Sdk variant carries a PackageReference instead
const testSdkCsproj = (ref) =>
  '<Project Sdk="Microsoft.NET.Sdk">\n  <PropertyGroup>\n    <TargetFramework>net10.0</TargetFramework>\n  </PropertyGroup>\n' +
  '  <ItemGroup>\n    <PackageReference Include="Microsoft.NET.Test.Sdk" Version="17.11.1" />\n' +
  `    <ProjectReference Include="${ref}" />\n  </ItemGroup>\n</Project>\n`;

const ASSETS = '{\n  "version": 3,\n  "targets": {}\n}\n';

const csTarget = (cmd) => cmd.args.find((a) => /\.csproj$/i.test(a));
const sarifOf = (cmd) => {
  const arg = cmd.args.find((a) => /ErrorLog=/.test(a));
  const m = arg && /ErrorLog=(.+?)(?:%2c|,)version=/i.exec(arg);
  return m ? m[1] : undefined;
};

/** The flat layout: <repo>/App/App.csproj beside <repo>/App.Tests/App.Tests.csproj. */
const flatTree = (tag, extra = {}) =>
  tree(tag, {
    "App/App.csproj": SRC_CSPROJ,
    "App/Lib.cs": "namespace App;\npublic static class Lib { public static int One() => 1; }\n",
    ...extra,
  });

gtest("cs rule 1+2: <IsTestProject>true</IsTestProject> plus a ProjectReference back makes the TEST project the build target [contract: cs rules 1, 2]", () => {
  const repo = flatTree("cs-istest", {
    "App.Tests/App.Tests.csproj": testCsproj(IS_TEST_PROJECT, "../App/App.csproj"),
    "App.Tests/LibTests.cs": "public class LibTests { }\n",
    "App.Tests/obj/project.assets.json": ASSETS,
  });
  const cmd = new CsOracle().buildCheckCommand(path.join(repo, "App"));
  assert.strictEqual(
    csTarget(cmd),
    path.join(repo, "App.Tests", "App.Tests.csproj"),
    `the target moves to the test project, got ${JSON.stringify(cmd.args)}`
  );
});

gtest("cs rule 1: a Microsoft.NET.Test.Sdk package reference qualifies too, and a backslash ProjectReference still points home [contract: cs rule 1]", () => {
  const repo = flatTree("cs-testsdk", {
    "App.Tests/App.Tests.csproj": testSdkCsproj("..\\App\\App.csproj"),
    "App.Tests/LibTests.cs": "public class LibTests { }\n",
    "App.Tests/obj/project.assets.json": ASSETS,
  });
  const cmd = new CsOracle().buildCheckCommand(path.join(repo, "App"));
  assert.strictEqual(
    csTarget(cmd),
    path.join(repo, "App.Tests", "App.Tests.csproj"),
    `Test.Sdk is the other half of rule 1, and MSBuild's own backslash separator must resolve, got ${JSON.stringify(cmd.args)}`
  );
});

gtest("cs rule 1: the test marker WITHOUT a reference back does not qualify - today's command [contract: cs rule 1 'AND a <ProjectReference> back']", () => {
  const repo = flatTree("cs-noref", {
    "Other.Tests/Other.Tests.csproj": testCsproj(IS_TEST_PROJECT, ""),
    "Other.Tests/obj/project.assets.json": ASSETS,
  });
  const cmd = new CsOracle().buildCheckCommand(path.join(repo, "App"));
  assert.strictEqual(csTarget(cmd), path.join(repo, "App", "App.csproj"), "a test project for some other code is not our test project");
});

gtest("cs rule 1: a reference back WITHOUT the test marker does not qualify - today's command [contract: cs rule 1 'IsTestProject ... or Test.Sdk']", () => {
  const repo = flatTree("cs-notest", {
    "App.Cli/App.Cli.csproj": testCsproj("<OutputType>Exe</OutputType>", "../App/App.csproj"),
    "App.Cli/obj/project.assets.json": ASSETS,
  });
  const cmd = new CsOracle().buildCheckCommand(path.join(repo, "App"));
  assert.strictEqual(csTarget(cmd), path.join(repo, "App", "App.csproj"), "a plain consumer of the library is not a test project");
});

gtest("cs rule 3: TWO qualifying test projects -> today's command, byte for byte [contract: cs rule 3]", () => {
  const repo = flatTree("cs-two", {
    "App.Tests/App.Tests.csproj": testCsproj(IS_TEST_PROJECT, "../App/App.csproj"),
    "App.Tests/obj/project.assets.json": ASSETS,
    "App.IntegrationTests/App.IntegrationTests.csproj": testCsproj(IS_TEST_PROJECT, "../App/App.csproj"),
    "App.IntegrationTests/obj/project.assets.json": ASSETS,
  });
  const root = path.join(repo, "App");
  const cmd = new CsOracle().buildCheckCommand(root);
  fs.rmSync(path.join(repo, "App.Tests"), { recursive: true, force: true });
  fs.rmSync(path.join(repo, "App.IntegrationTests"), { recursive: true, force: true });
  const control = new CsOracle().buildCheckCommand(root);
  sameCommand(cmd, control, "two candidates means no widening");
});

gtest("cs rule 3: NO test project -> today's command [contract: cs rule 3]", () => {
  const repo = flatTree("cs-none");
  const cmd = new CsOracle().buildCheckCommand(path.join(repo, "App"));
  assert.strictEqual(csTarget(cmd), path.join(repo, "App", "App.csproj"));
});

gtest("cs rule 4: an UNRESTORED test project is refused - today's command [contract: cs rule 4 'Restored or nothing']", () => {
  const repo = flatTree("cs-unrestored", {
    "App.Tests/App.Tests.csproj": testCsproj(IS_TEST_PROJECT, "../App/App.csproj"),
    "App.Tests/LibTests.cs": "public class LibTests { }\n",
  });
  const root = path.join(repo, "App");
  const cmd = new CsOracle().buildCheckCommand(root);
  assert.strictEqual(
    csTarget(cmd),
    path.join(repo, "App", "App.csproj"),
    "no obj/project.assets.json beside the test csproj: --no-restore would die NETSDK1004, so the check does not move"
  );
  fs.rmSync(path.join(repo, "App.Tests"), { recursive: true, force: true });
  sameCommand(cmd, new CsOracle().buildCheckCommand(root), "an unrestored candidate leaves the command exactly as it is with no candidate at all");
});

gtest("cs rule 4: restore state is the ONLY thing keeping that project out, and the channel says why [contract: cs rule 4 'the channel says why']", () => {
  const repo = flatTree("cs-restorestate", {
    "App.Tests/App.Tests.csproj": testCsproj(IS_TEST_PROJECT, "../App/App.csproj"),
    "App.Tests/LibTests.cs": "public class LibTests { }\n",
  });
  const root = path.join(repo, "App");
  const bag = lineBag();
  new CsOracle(bag.deps).buildCheckCommand(root);
  const why = bag.lines.filter((l) => /App\.Tests/.test(l) && /restor/i.test(l));
  assert.strictEqual(why.length, 1, `one line names the unrestored project and says restore is why, got ${JSON.stringify(bag.lines)}`);

  fs.mkdirSync(path.join(repo, "App.Tests", "obj"), { recursive: true });
  fs.writeFileSync(path.join(repo, "App.Tests", "obj", "project.assets.json"), ASSETS);
  assert.strictEqual(
    csTarget(new CsOracle().buildCheckCommand(root)),
    path.join(repo, "App.Tests", "App.Tests.csproj"),
    "the assets file is the whole difference: restored, so now it is the target"
  );
});

gtest("cs rule 5: crateRoot does not move - cwd and the SARIF path are the source project's, before and after the widening [contract: cs rule 5]", () => {
  const repo = flatTree("cs-root", {
    "App.Tests/App.Tests.csproj": testCsproj(IS_TEST_PROJECT, "../App/App.csproj"),
    "App.Tests/obj/project.assets.json": ASSETS,
  });
  const root = path.join(repo, "App");
  const widened = new CsOracle().buildCheckCommand(root);
  fs.rmSync(path.join(repo, "App.Tests"), { recursive: true, force: true });
  const today = new CsOracle().buildCheckCommand(root);

  assert.strictEqual(widened.cwd, today.cwd, "cwd is unchanged");
  assert.strictEqual(widened.cwd, root, "and it is still the SOURCE project's directory");
  assert.strictEqual(sarifOf(widened), sarifOf(today), "the SARIF path is keyed by crateRoot, which did not move");
  assert.deepStrictEqual(widened.env ?? {}, today.env ?? {}, "the child env is unchanged");
  assert.ok(widened.args.includes("--no-restore"), "--no-restore survives the widening (offline invariant)");
});

gtest("cs rule 6: a file already inside a test project resolves that project and gets today's command [contract: cs rule 6]", () => {
  const repo = flatTree("cs-inside", {
    "App.Tests/App.Tests.csproj": testCsproj(IS_TEST_PROJECT, "../App/App.csproj"),
    "App.Tests/LibTests.cs": "public class LibTests { }\n",
    "App.Tests/obj/project.assets.json": ASSETS,
  });
  const testRoot = path.join(repo, "App.Tests");
  const cmd = new CsOracle().buildCheckCommand(testRoot);
  assert.strictEqual(
    csTarget(cmd),
    path.join(testRoot, "App.Tests.csproj"),
    "nothing references the test project, so the target is the project in crateRoot itself"
  );
  assert.strictEqual(cmd.cwd, testRoot, "and crateRoot is unchanged");
});

// RE-CUT against contract amendment 1a. The original row asserted that a
// `src/App` + `tests/App.Tests` tree with NO solution file resolves the test
// project. The contract was silent on where the search looks and the row guessed;
// the product's rule is siblings plus solution-listed projects, and the PLACEMENT
// leg uses the same function — verified live, it refuses that tree with
// `no-test-project`, so the product never writes a test there and the check has
// nothing to miss. Both halves are pinned now, because the pair is the argument.
gtest("cs: the conventional src/ + tests/ layout resolves through the SOLUTION [contract: cs rules 1 + 1a]", () => {
  const repo = tree("cs-conventional", {
    "App.sln": 'Project("{FAE}") = "App", "src\\App\\App.csproj", "{1}"\nProject("{FAE}") = "App.Tests", "tests\\App.Tests\\App.Tests.csproj", "{2}"\n',
    "src/App/App.csproj": SRC_CSPROJ,
    "src/App/Lib.cs": "namespace App;\npublic static class Lib { public static int One() => 1; }\n",
    "tests/App.Tests/App.Tests.csproj": testCsproj(IS_TEST_PROJECT, "../../src/App/App.csproj"),
    "tests/App.Tests/LibTests.cs": "public class LibTests { }\n",
    "tests/App.Tests/obj/project.assets.json": ASSETS,
  });
  const cmd = new CsOracle().buildCheckCommand(path.join(repo, "src", "App"));
  assert.strictEqual(
    csTarget(cmd),
    path.join(repo, "tests", "App.Tests", "App.Tests.csproj"),
    `a solution above the project lists both, which is what makes a src/ + tests/ layout resolve, got ${JSON.stringify(cmd.args)}`
  );
});

gtest("cs: the same layout with NO solution file resolves nothing, and that matches where tests are WRITTEN [contract: cs rule 1a]", () => {
  const repo = tree("cs-conventional-nosln", {
    "src/App/App.csproj": SRC_CSPROJ,
    "src/App/Lib.cs": "namespace App;\npublic static class Lib { public static int One() => 1; }\n",
    "tests/App.Tests/App.Tests.csproj": testCsproj(IS_TEST_PROJECT, "../../src/App/App.csproj"),
    "tests/App.Tests/obj/project.assets.json": ASSETS,
  });
  const cmd = new CsOracle().buildCheckCommand(path.join(repo, "src", "App"));
  assert.strictEqual(
    csTarget(cmd),
    path.join(repo, "src", "App", "App.csproj"),
    `the search is siblings plus solution-listed projects; with no solution the test project is not a candidate, got ${JSON.stringify(cmd.args)}`
  );
});

gtest("cs: when the target moves, the channel says so in one line naming the PROJECT [contract: 'the output channel says so in one line naming the project']", () => {
  const repo = flatTree("cs-channel", {
    "App.Tests/App.Tests.csproj": testCsproj(IS_TEST_PROJECT, "../App/App.csproj"),
    "App.Tests/obj/project.assets.json": ASSETS,
  });
  const bag = lineBag();
  new CsOracle(bag.deps).buildCheckCommand(path.join(repo, "App"));
  const named = bag.lines.filter((l) => l.includes("App.Tests"));
  assert.strictEqual(named.length, 1, `exactly one line names the new build target, got ${JSON.stringify(bag.lines)}`);
});

gtest("cs: nothing new is said when the target does not move [contract: 'Nothing new on a clean check']", () => {
  const repo = flatTree("cs-quiet");
  const bag = lineBag();
  new CsOracle(bag.deps).buildCheckCommand(path.join(repo, "App"));
  assert.deepStrictEqual(
    bag.lines.filter((l) => /Tests/.test(l)),
    [],
    `no test project, so no line about one, got ${JSON.stringify(bag.lines)}`
  );
});
