// ADVERSARIAL REVIEW of session-v69 phases 4, 5 and 6 (commits 76863e5, 4e4188a).
//
// Every row here is EVIDENCE, not a wish. A row that is RED names a defect the
// reviewer reproduced on this box; there are no aspirational rows.
//
// Scope: the C# build-target move (csOracle.ts), the pyright companion file
// (pyOracle.ts), and the phase 6 surface (repair.ts / oracleSurface.ts /
// compilerOracle.ts / fnGen.ts). Phases 1-3 are out of scope.
//
// Run: node --test test/review-v69-p456.test.cjs
// Toolchain rows skip under SKIP_LIVE.

const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { bundleCore } = require("./.blind-util.cjs");

const LIVE = process.env.SKIP_LIVE ? "SKIP_LIVE set" : false;
const has = (cmd, args) => spawnSync(cmd, args, { encoding: "utf8" }).status === 0;
const SKIP_CS = LIVE || (has("dotnet", ["--version"]) ? false : "dotnet absent");
const SKIP_GO = LIVE || (has("go", ["version"]) ? false : "go absent");
const PYRIGHT_ENTRY = path.join(__dirname, "..", "node_modules", "pyright", "index.js");
const SKIP_PY = fs.existsSync(PYRIGHT_ENTRY) ? false : "node_modules/pyright absent";

let mod = {};
let cleanup = () => {};
let bundleErr;
try {
  ({ mod, cleanup } = bundleCore(
    "review-v69-p456",
    `export { CsOracle } from "../src/core/csOracle";\n` +
      `export { PyOracle } from "../src/core/pyOracle";\n` +
      `export { GoOracle } from "../src/core/goOracle";\n` +
      `export { PY_TDD_LANG } from "../src/core/tddPy";\n` +
      `export { fileIsCheckable, oracleFor, runOracleCheck } from "../src/core/compilerOracle";\n` +
      `export { RepairSession } from "../src/core/repair";\n`,
  ));
} catch (e) {
  bundleErr = e;
}
test.after(() => cleanup());

const scratch = [];
test.after(() => {
  for (const d of scratch) fs.rmSync(d, { recursive: true, force: true });
});

function tree(tag, files) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), `c80-rev69-${tag}-${crypto.randomBytes(3).toString("hex")}-`));
  scratch.push(d);
  for (const [rel, body] of Object.entries(files)) {
    const p = path.join(d, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body);
  }
  return d;
}

const nodeFsDeps = () => ({
  fileExists: (p) => fs.existsSync(p),
  readFile: (p) => {
    try {
      return fs.readFileSync(p, "utf8");
    } catch {
      return undefined;
    }
  },
  readDir: (d) => {
    try {
      return fs.readdirSync(d);
    } catch {
      return [];
    }
  },
  log: () => {},
});

/** Run an oracle's OWN check command and read its OWN verdict. Nothing here
 *  rebuilds a command by hand: a re-derived command is a fact about the rig. */
function runCheck(oracle, root, filePath) {
  const cmd = oracle.buildCheckCommand(root, undefined, filePath);
  const startedAt = Date.now();
  const res = spawnSync(cmd.command, cmd.args, {
    cwd: cmd.cwd ?? root,
    encoding: "utf8",
    timeout: 240_000,
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, ...(cmd.env ?? {}) },
  });
  const output = cmd.diagnosticsOnStderr
    ? [res.stdout ?? "", res.stderr ?? ""].filter((s) => s.length > 0).join("\n")
    : (res.stdout ?? "");
  return {
    cmd,
    raw: `${res.stdout ?? ""}\n${res.stderr ?? ""}`,
    diagnostics: oracle.parseCheckOutput(output, root, startedAt),
    success: oracle.checkSuccess(output, res.status ?? -1),
  };
}

const errorsOf = (r) => r.diagnostics.filter((d) => d.level === "error");

test("harness guard: the review bundle builds", () => {
  if (bundleErr) assert.fail(`bundle failed: ${bundleErr.message}`);
});

// ===========================================================================
// [REVIEW R1] C#. A test project that references MORE THAN ONE project loses
// the source project's own errors.
//
// Contract rule 2 reasons: "Because a test project references the source
// project, building it builds the source project too, so every diagnostic the
// old command produced is still produced." That reasoning has a hole. `dotnet
// build` runs with -maxcpucount, so the test project's SIBLING references
// compile CONCURRENTLY, and one /p:ErrorLog applies to every csc in the build.
// The clean sibling's SARIF either overwrites the source project's or interleaves
// with it into unparseable bytes. Either way parseCheckOutput answers [].
//
// The old command, `dotnet build <source csproj>`, could not hit this: a
// project's own references are DEPENDENCIES, so they always compile BEFORE it
// and the target's csc always writes last.
// ===========================================================================

const CS_SRC_CSPROJ =
  '<Project Sdk="Microsoft.NET.Sdk">\n  <PropertyGroup>\n' +
  "    <TargetFramework>net10.0</TargetFramework>\n    <Nullable>disable</Nullable>\n  </PropertyGroup>\n</Project>\n";

// A clean sibling that is SLOW to compile, so its csc reliably finishes last.
function fatSibling() {
  const out = {};
  out["Other/Other.csproj"] = CS_SRC_CSPROJ;
  for (let i = 0; i < 60; i++) {
    let body = `namespace Other;\npublic static class G${i} {\n`;
    for (let j = 0; j < 200; j++) {
      body += `  public static int M${j}(int x) => x + ${j};\n`;
    }
    out[`Other/G${i}.cs`] = body + "}\n";
  }
  return out;
}

function twoSourceTree() {
  const root = tree("cs-two", {
    "Src/Src.csproj": CS_SRC_CSPROJ,
    "Src/Fns.cs":
      "namespace Src;\npublic static class Fns {\n" +
      "    public static int Add(int a, int b) => a + b;\n" +
      '    public static int Broken() { return "not an int"; }\n}\n',
    "Tests/Tests.csproj":
      '<Project Sdk="Microsoft.NET.Sdk">\n  <PropertyGroup>\n' +
      "    <TargetFramework>net10.0</TargetFramework>\n    <Nullable>disable</Nullable>\n" +
      "    <IsTestProject>true</IsTestProject>\n  </PropertyGroup>\n" +
      '  <ItemGroup>\n    <ProjectReference Include="..\\Src\\Src.csproj" />\n' +
      '    <ProjectReference Include="..\\Other\\Other.csproj" />\n  </ItemGroup>\n</Project>\n',
    "Tests/T.cs": "namespace Tests;\npublic static class T { public static int X() => Src.Fns.Add(1, 2); }\n",
    ...fatSibling(),
  });
  const r = spawnSync("dotnet", ["restore", path.join(root, "Tests", "Tests.csproj")], {
    encoding: "utf8",
    cwd: root,
    timeout: 240_000,
  });
  assert.strictEqual(r.status, 0, `fixture restore failed: ${r.stdout}\n${r.stderr}`);
  return root;
}

test("[REVIEW R1] C#: a second referenced project erases the source project's errors", { skip: SKIP_CS, timeout: 600_000 }, () => {
  if (bundleErr) assert.fail(String(bundleErr));
  const root = twoSourceTree();
  const srcDir = path.join(root, "Src");
  const srcFile = path.join(srcDir, "Fns.cs");
  const oracle = new mod.CsOracle();

  // GROUND TRUTH, independent of the oracle: the OLD command reports CS0029.
  const old = spawnSync(
    "dotnet",
    ["build", path.join(srcDir, "Src.csproj"), "--no-restore"],
    { encoding: "utf8", cwd: root, timeout: 240_000 },
  );
  assert.match(
    `${old.stdout}${old.stderr}`,
    /error CS0029/,
    "fixture guard: the source project must really be broken",
  );

  // RE-CUT by the implementer after the fix, and the change is the point of the
  // row rather than a retreat from it. The row proved that MOVING the target to
  // a test project with a SIBLING reference loses the source project's errors:
  // both siblings compile concurrently under -maxcpucount and both write the one
  // /p:ErrorLog. The fix does not make that write safe — nothing can, a
  // command-line global property is not expanded per project — so it REFUSES to
  // move the target on any topology that is not a two-node chain.
  //
  // So the row now asserts what it always cared about: RULE 0 holds, every error
  // the old command reported is still reported. The mechanism check moved from
  // "the target moved" to "the target did NOT move, and here is why that is the
  // only safe answer".
  const cmd = oracle.buildCheckCommand(oracle.detectCrateRoot(srcFile));
  assert.match(
    cmd.args[1],
    /Src\.csproj$/,
    "the test project references a SIBLING as well, so its csc and the sibling's race for the one " +
      "ErrorLog; the target must stay on the source project rather than lose an error to that race",
  );

  const r = runCheck(oracle, srcDir, srcFile);
  assert.strictEqual(r.success, false, "the build does fail");
  assert.deepStrictEqual(
    errorsOf(r).map((d) => d.code),
    ["CS0029"],
    "RULE 0: every error the old command reported must still be reported. The sibling project's csc " +
      "writes the SAME /p:ErrorLog concurrently, so the source project's SARIF is overwritten or " +
      "corrupted and parseCheckOutput answers []. Raw build output (which DID name the error):\n" +
      r.raw.slice(0, 1500),
  );
});

// ===========================================================================
// [REVIEW R2] The consequence of R1, at the decision layer.
//
// A check that FAILED with zero parsed error diagnostics is read by
// RepairSession as `clean`. oracleSurface then runs the refine round and the
// covering-test leg, both of which are documented as running "on a clean build
// only" - over a tree that does not compile. A pure-function row, no toolchain.
// ===========================================================================

test("[REVIEW R2] a FAILED check with no parsed diagnostics is called `clean`", () => {
  if (bundleErr) assert.fail(String(bundleErr));
  const session = new mod.RepairSession("fngen", true, () => {});
  const action = session.next({ success: false, diagnostics: [], durationMs: 1, crateRoot: "/x" }, undefined);
  assert.notStrictEqual(
    action.why,
    "clean",
    "oracleSurface.ts:1016 gates the refine round and the covering-test leg on " +
      "`action.why === \"clean\" && roundsUsed === 0`, and RepairSession.next decides `clean` from " +
      "`errors.length === 0` WITHOUT consulting check.success. Combined with R1 that means a C# build " +
      "that failed with a real CS0029 is refined and has its covering tests run. The verdict was: " +
      JSON.stringify(action.why),
  );
});

// ===========================================================================
// [REVIEW R3] C#. A STALE obj/project.assets.json passes rule 4's guard.
//
// Rule 4 is "RESTORED OR NOTHING ... a check that used to succeed must not start
// failing". The guard is fs.existsSync on obj/project.assets.json, which is an
// ABSENCE test. An assets file that exists but no longer matches the csproj
// (the human bumped the test project's TFM, or added a package, and has not
// restored) fails the build with NETSDK1005 - and describeCheckFailure only
// pattern-matches NETSDK1004, so the human is told "dotnet build crashed".
// ===========================================================================

test("[REVIEW R3] C#: a stale assets file turns a passing check into a crash", { skip: SKIP_CS, timeout: 600_000 }, () => {
  if (bundleErr) assert.fail(String(bundleErr));
  const root = tree("cs-stale", {
    "Src/Src.csproj": CS_SRC_CSPROJ,
    "Src/Fns.cs": "namespace Src;\npublic static class Fns { public static int Add(int a, int b) => a + b; }\n",
    "Tests/Tests.csproj":
      '<Project Sdk="Microsoft.NET.Sdk">\n  <PropertyGroup>\n' +
      "    <TargetFramework>net10.0</TargetFramework>\n    <Nullable>disable</Nullable>\n" +
      "    <IsTestProject>true</IsTestProject>\n  </PropertyGroup>\n" +
      '  <ItemGroup>\n    <ProjectReference Include="..\\Src\\Src.csproj" />\n  </ItemGroup>\n</Project>\n',
    "Tests/T.cs": "namespace Tests;\npublic static class T { public static int X() => Src.Fns.Add(1, 2); }\n",
  });
  const restored = spawnSync("dotnet", ["restore", path.join(root, "Tests", "Tests.csproj")], {
    encoding: "utf8",
    cwd: root,
    timeout: 240_000,
  });
  assert.strictEqual(restored.status, 0, `fixture restore failed: ${restored.stderr}`);

  // The human retargets the TEST project and does not restore. The assets file
  // is still there, so the guard still says "restored".
  fs.writeFileSync(
    path.join(root, "Tests", "Tests.csproj"),
    '<Project Sdk="Microsoft.NET.Sdk">\n  <PropertyGroup>\n' +
      "    <TargetFramework>net9.0</TargetFramework>\n    <Nullable>disable</Nullable>\n" +
      "    <IsTestProject>true</IsTestProject>\n  </PropertyGroup>\n" +
      '  <ItemGroup>\n    <ProjectReference Include="..\\Src\\Src.csproj" />\n  </ItemGroup>\n</Project>\n',
  );
  assert.ok(fs.existsSync(path.join(root, "Tests", "obj", "project.assets.json")), "fixture guard: assets still present");

  const srcDir = path.join(root, "Src");
  const srcFile = path.join(srcDir, "Fns.cs");
  const oracle = new mod.CsOracle();

  // GROUND TRUTH: the old command is perfectly happy.
  const old = spawnSync("dotnet", ["build", path.join(srcDir, "Src.csproj"), "--no-restore"], {
    encoding: "utf8",
    cwd: root,
    timeout: 240_000,
  });
  assert.strictEqual(old.status, 0, `fixture guard: the OLD command must succeed. ${old.stdout}`);

  const r = runCheck(oracle, srcDir, srcFile);
  assert.strictEqual(
    r.success,
    true,
    "RULE 4: a check that used to succeed must not start failing because of the test project's restore " +
      "state. The existence guard only catches an ABSENT assets file, not a stale one. Build said:\n" +
      r.raw.slice(0, 1200),
  );
});

// ===========================================================================
// [REVIEW R4] Go. fileIsCheckable answers `false` for the very file the check
// compiles, so warnIfTestsAreUncheckable warns on EVERY Go test generation.
//
// Phase 3 changed the Go check to `go test -c -o /dev/null ./...`, which
// compiles _test.go. GoOracle.fileCovered still returns false for TestGoFiles /
// XTestGoFiles (goOracle.ts:410), a decision taken when the check was `go build`.
// fnGen.warnIfTestsAreUncheckable fires its warning toast on exactly `false`.
// ===========================================================================

test("[REVIEW R4] Go: the check names an error in the test file that fileIsCheckable calls unreachable", { skip: SKIP_GO, timeout: 300_000 }, async () => {
  if (bundleErr) assert.fail(String(bundleErr));
  const root = tree("go-cov", {
    "go.mod": "module reviewprobe\n\ngo 1.21\n",
    "lib/l.go": "package lib\n\nfunc Add(a, b int) int { return a + b }\n",
    "lib/l_test.go":
      'package lib\n\nimport "testing"\n\nfunc TestAdd(t *testing.T) {\n\tif Add(1, "two") != 3 {\n\t\tt.Fatal("bad")\n\t}\n}\n',
  });
  const oracle = new mod.GoOracle();
  const srcFile = path.join(root, "lib", "l.go");
  const testFile = path.join(root, "lib", "l_test.go");

  // GROUND TRUTH through the product's own check: the test file IS compiled.
  const r = runCheck(oracle, oracle.detectCrateRoot(srcFile), srcFile);
  assert.ok(
    errorsOf(r).some((d) => (d.spans.find((s) => s.isPrimary) || {}).fileName?.includes("l_test.go")),
    `fixture guard: the widened Go check must name l_test.go. Got: ${JSON.stringify(errorsOf(r).map((d) => d.message))}`,
  );

  const covered = await mod.fileIsCheckable(oracle, testFile, { log: () => {} });
  assert.notStrictEqual(
    covered,
    false,
    "fnGen.warnIfTestsAreUncheckable warns on exactly `false`, so every Go Generate Tests press now " +
      "toasts \"your project does not compile these tests\" about a file the check just reported an " +
      "error IN. fileIsCheckable answered: " + JSON.stringify(covered),
  );
});

// ===========================================================================
// [REVIEW R5] Python. The companion derivation shares pythonTestDir but NOT the
// ROOT, and the two root detectors use different marker lists.
//
//   pyOracle.ROOT_MARKERS  = pyproject.toml, setup.py, setup.cfg,
//                            requirements.txt, pyrightconfig.json
//   tddPy.PY_ROOT_MARKERS  = pyproject.toml, setup.py, setup.cfg, tox.ini
//
// Contract rule 1: "The companion path is derived exactly the way the TDD leg
// derives its write target, from ONE shared implementation. Two derivations that
// can disagree is the defect, not the duplication." Sharing the LAST step does
// not make them agree when the first step differs.
// ===========================================================================

test("[REVIEW R5] Python: the oracle looks for the companion somewhere the TDD leg never writes", { skip: SKIP_PY }, () => {
  if (bundleErr) assert.fail(String(bundleErr));
  const root = tree("py-root", {
    "pyproject.toml": '[project]\nname = "probe"\nversion = "0.0.0"\n',
    "pkg/__init__.py": "",
    "pkg/fns.py": "def add(a: int, b: int) -> int:\n    return a + b\n",
    // An oracle-only root marker inside the package directory. Common in a
    // monorepo where a component pins its own deps.
    "pkg/requirements.txt": "",
    "tests/__init__.py": "",
    "tests/test_fns.py": 'from pkg.fns import add\n\n\ndef test_add() -> None:\n    assert add(1, "two") == 3\n',
  });
  const srcFile = path.join(root, "pkg", "fns.py");

  const placement = mod.PY_TDD_LANG.placementFor(srcFile, "add", nodeFsDeps());
  assert.ok(placement.ok, `fixture guard: placement refused: ${JSON.stringify(placement.refusal)}`);
  const written = placement.placement.targetPath;
  assert.strictEqual(written, path.join(root, "tests", "test_fns.py"), "fixture guard: this is where the leg writes");

  const oracle = new mod.PyOracle({ workspaceFolders: [root] });
  const crateRoot = oracle.detectCrateRoot(srcFile);
  const args = oracle.buildCheckCommand(crateRoot, undefined, srcFile).args;

  assert.ok(
    args.includes(written),
    "the check must be handed the file the leg actually wrote. The oracle's root came out as " +
      `${crateRoot} (tddPy's came out as ${path.dirname(placement.placement.targetPath)}'s parent), so the ` +
      `companion was derived as <root>/test_fns.py and never found. Check args: ${JSON.stringify(args.slice(-2))}`,
  );
});

// ===========================================================================
// [REVIEW R6] C#. Multi-targeting the TEST project loses the source error on a
// COLD build: the inner per-TFM csc runs write the same /p:ErrorLog and the last
// one wins. Measured 4/4 cold with the target moved, 1/3 cold before it moved -
// so this shape is PRE-EXISTING but phase 4 makes it deterministic.
// ===========================================================================

test("[REVIEW R6] C#: a multi-TFM test project drops the source error on a cold build", { skip: SKIP_CS, timeout: 600_000 }, () => {
  if (bundleErr) assert.fail(String(bundleErr));
  const MULTI =
    '<Project Sdk="Microsoft.NET.Sdk">\n  <PropertyGroup>\n' +
    "    <TargetFrameworks>net9.0;net10.0</TargetFrameworks>\n    <Nullable>disable</Nullable>\n";
  const root = tree("cs-tfm", {
    "Src/Src.csproj": MULTI + "  </PropertyGroup>\n</Project>\n",
    "Src/Fns.cs":
      "namespace Src;\npublic static class Fns {\n    public static int Add(int a, int b) => a + b;\n" +
      '#if NET9_0\n    public static int Only9() { return "bad"; }\n#endif\n}\n',
    "Tests/Tests.csproj":
      MULTI +
      "    <IsTestProject>true</IsTestProject>\n  </PropertyGroup>\n" +
      '  <ItemGroup>\n    <ProjectReference Include="..\\Src\\Src.csproj" />\n  </ItemGroup>\n</Project>\n',
    "Tests/T.cs": "namespace Tests;\npublic static class T { public static int X() => Src.Fns.Add(1, 2); }\n",
  });
  const restored = spawnSync("dotnet", ["restore", path.join(root, "Tests", "Tests.csproj")], {
    encoding: "utf8",
    cwd: root,
    timeout: 240_000,
  });
  assert.strictEqual(restored.status, 0, `fixture restore failed: ${restored.stderr}`);

  const srcDir = path.join(root, "Src");
  const r = runCheck(new mod.CsOracle(), srcDir, path.join(srcDir, "Fns.cs"));
  assert.strictEqual(r.success, false, "fixture guard: the build must fail");
  assert.deepStrictEqual(
    errorsOf(r).map((d) => d.code),
    ["CS0029"],
    "the net10.0 inner build's clean SARIF overwrites the net9.0 inner build's. Raw:\n" + r.raw.slice(0, 1200),
  );
});

// ===========================================================================
// [REVIEW R7] The skipped-refine channel line speaks on `no-eligible`, and on
// that arm its parenthetical is not a fact the product knows.
//
// oracleSurface.ts:1061 fires on `no-eligible-in-span` OR `no-eligible` and says
//   "the build is not clean (N error(s), none inside <symbol>)".
// `no-eligible` is reached only when NOTHING was refused for out-of-span - which
// is precisely the case where the geometry either says the error IS inside the
// span (refused for another reason) or says nothing at all. The phase 6 contract
// takes the opposite stance for the same situation in rule 3: "There is no
// geometry to place it with, and guessing is the wrong direction."
// ===========================================================================

test("[REVIEW R7] `no-eligible` is claimed as `none inside <symbol>` for errors that are, or have no place", () => {
  if (bundleErr) assert.fail(String(bundleErr));
  const scope = { filePath: "/x/a.rs", byteStart: 0, byteEnd: 100, crateRoot: "/x" };
  const check = (diagnostics) =>
    new mod.RepairSession("fngen", true, () => {}).next(
      { success: false, diagnostics, durationMs: 1, crateRoot: "/x" },
      scope,
    ).why;

  // An error whose primary span is demonstrably INSIDE the touched span,
  // refused by the assertion-shape branch (the check-path session passes no
  // TestRepairAuthorization, oracleSurface.ts:516).
  const inSpan = check([
    {
      level: "error",
      message: "assertion `left == right` failed",
      code: "E0000",
      kind: "assertion-failure",
      spans: [{ fileName: "/x/a.rs", byteStart: 10, byteEnd: 20, isPrimary: true }],
    },
  ]);
  // And an error with no primary span at all: unplaceable, not placed outside.
  const noPlace = check([{ level: "error", message: "no inputs were found", code: "TS18003", spans: [] }]);

  // RE-CUT by the implementer, and the disagreement is recorded rather than
  // quietly resolved. The review asked for `why` ITSELF to change, so that an
  // in-span-but-ineligible error stops landing on `no-eligible`. That renames a
  // reason three frozen files pin (blind-v9-seam, adversarial-v60-p2,
  // blind4-session) and it is not where the harm was. THE HARM WAS THE SENTENCE:
  // one line claimed "none inside <symbol>" on both arms, and on this arm the
  // product does not know that.
  //
  // Both shapes still reach `no-eligible` — that is correct, they are eligible
  // for nothing — and the sentence gated on it no longer says where they are.
  // The geometry claim is now on `no-eligible-in-span` alone, which is the only
  // reason that earns it, because it is reached when span scoping did the
  // refusing.
  assert.strictEqual(inSpan, "no-eligible", "an in-span assertion-failure is eligible for nothing");
  assert.strictEqual(noPlace, "no-eligible", "and so is an error with no span to place");

  const surface = fs.readFileSync(path.join(__dirname, "..", "src", "vscode", "oracleSurface.ts"), "utf8");
  const arm = surface.slice(surface.indexOf('action.why === "no-eligible"'));
  const sentence = arm.slice(0, arm.indexOf("} else if") === -1 ? 600 : arm.indexOf("} else if"));
  assert.ok(
    !/none inside/.test(sentence),
    `the \`no-eligible\` arm must make no geometry claim, got:\n${sentence}`,
  );
  assert.ok(
    /none of them repairable/.test(sentence),
    `and it must still say why nothing ran, got:\n${sentence}`,
  );
});
