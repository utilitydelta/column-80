// Blind oracle: the Python TDD leg (session-v31/contract-py.md, goal.md item 4
// and item 6, Amendments 1 to 5). Black-box contract tests written from the
// CONTRACT ALONE, before `src/core/tddPy.ts` exists. Covers:
//   §Registration   "python" resolves, markerPrefix "#", pytest then unittest
//   §Placement      the three-tier target directory, runRoot, no-project-root
//   §The import     derived from the package path, and PROVEN before a write
//   §The command    the project's interpreter, -B, -m pytest, node ids, -q,
//                   -p no:cacheprovider, and --junit-xml in SYSTEM TEMP
//   §THE FORGERY    a print() that forges a count line and a phantom FAILED row.
//                   The centrepiece: counts are ATTRIBUTES, not text.
//   §Three no-runs  test failure (exit 1), filter miss (exit 4), collection
//                   error (exit 4). Two share an exit code and only the
//                   `errors` attribute separates them.
//   §returnTypeOf   the trailing colon the shipped Rust regex swallows
//   §Testability    async/io/needs-fixture/underspecified, never not-exported
//   §Blank values   bare scalars, hinted containers, per Amendment 2
//   §Spans          pytest's top-level `==` RHS, unittest's 2nd argument
//   §Scaffold       "#" markers, the derived import, no duplicate import
//
// Never read src/**. The whole point of this file is independence from the
// implementation. Expected RED until phase 4 lands.
//
// Guards, each collapsing a whole class of red into ONE loud failure:
//   1. a failed bundle (the module is missing) fails the bundle test and SKIPS
//      everything else.
//   2. `tddLangFor("python")` returning undefined (phase 4 not registered yet)
//      fails the registration test and SKIPS everything else.
//   3. a failed temp-fixture build fails one test and SKIPS only the rows that
//      need a project on disk.
// None of the three produces a wall of TypeErrors.
//
// TWO SEAM GAPS THIS ORACLE RAISED FROM THE CONTRACT ALONE, both since CLOSED
// in the seam and now pinned here rather than worked around:
//   a. `--junit-xml` writes a FILE, and `parseOutput(stdout, stderr, exitCode)`
//      had no channel for a path. Closed by Amendment 6c: `TestRunCommand`
//      gained `outputFile`, and the runner reads that file and hands its
//      CONTENT in as `stdout`. Amendment 8c adds that stderr is always the real
//      stderr and stdout falls back to the real stdout when no file was
//      written. So this file feeds the XML as stdout, which is now the
//      documented shape rather than the only shape the seam admitted.
//   b. `TddDeps` carried fileExists/readFile/readDir/log and nothing that could
//      RUN an interpreter, yet contract-py.md requires pytest detection and the
//      import proof to ask one. Closed by Amendment 6c: `TddDeps` gained
//      `probe?: (command, args, cwd) => { exitCode: number } | undefined`, so
//      those decisions stay pure over their injected deps. The rows below pin
//      that the probe IS the channel, by injecting a probe that CONTRADICTS the
//      interpreter sitting on disk. The temp projects still carry a stub
//      `.venv/bin/python`, which is what the no-probe rows resolve against; it
//      exits 0 for every probe except one naming `ghost`.
//
// Run: SKIP_LIVE=1 node --test test/blind-v31-py.test.cjs

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
    "blind-v31-py",
    `export { tddLangFor, frameworkFor } from "../src/core/tddLang";\n`
  ));
} catch (e) {
  bundleError = e;
}

// ---------------------------------------------------------------------------
// Temp fixtures. A real directory tree under the SYSTEM TEMP area, never inside
// the repo, and removed whatever the run does. Each project carries a stub
// `.venv/bin/python` so the import proof has something to resolve.
// ---------------------------------------------------------------------------

const FS_FIXTURES_SUPPORTED = process.platform !== "win32";
let base;
let fixtureError;

// Exits 0 for any probe, except one whose arguments mention `ghost`. That is
// the unresolvable-import case and nothing else in this file names a ghost.
const STUB_INTERPRETER =
  "#!/bin/sh\n" +
  'for a in "$@"; do\n' +
  '  case "$a" in\n' +
  "    *ghost*) exit 1;;\n" +
  "  esac\n" +
  "done\n" +
  "exit 0\n";

const MODULE_TEXT =
  "def preprocess_cypher(query: str) -> tuple[str, list[str]]:\n" +
  '    """Strip comments and return the query with its removed fragments."""\n' +
  "    return query, []\n";

const writeFile = (p, text, mode) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text, mode === undefined ? undefined : { mode });
};

// Named roots, filled in by the setup block below.
const R = {};

if (FS_FIXTURES_SUPPORTED) {
  try {
    base = fs.mkdtempSync(path.join(os.tmpdir(), "blind-v31-py-"));

    const project = (name) => {
      const root = path.join(base, name);
      fs.mkdirSync(root, { recursive: true });
      writeFile(path.join(root, ".venv", "bin", "python"), STUB_INTERPRETER, 0o755);
      return root;
    };

    // TIER 1: testpaths WINS. `tests/` also exists, so a leg that reaches tier
    // 2 without reading pyproject.toml lands in the wrong directory.
    R.tier1 = project("tier1");
    writeFile(
      path.join(R.tier1, "pyproject.toml"),
      "[build-system]\n" +
        'requires = ["setuptools"]\n' +
        "\n" +
        "[tool.setuptools.packages.find]\n" +
        'where = ["src"]\n' +
        "\n" +
        "[tool.pytest.ini_options]\n" +
        'testpaths = ["itests"]\n'
    );
    writeFile(path.join(R.tier1, "src", "pkg", "mod.py"), MODULE_TEXT);
    fs.mkdirSync(path.join(R.tier1, "itests"), { recursive: true });
    fs.mkdirSync(path.join(R.tier1, "tests"), { recursive: true });

    // TIER 2: no testpaths, a `tests/` directory exists. Flat layout.
    R.tier2 = project("tier2");
    writeFile(
      path.join(R.tier2, "pyproject.toml"),
      "[project]\n" + 'name = "probe"\n' + 'version = "0.0.1"\n'
    );
    writeFile(path.join(R.tier2, "pkg", "mod.py"), MODULE_TEXT);
    fs.mkdirSync(path.join(R.tier2, "tests"), { recursive: true });

    // TIER 2, target already on disk.
    R.tier2exists = project("tier2exists");
    writeFile(
      path.join(R.tier2exists, "pyproject.toml"),
      "[project]\n" + 'name = "probe"\n' + 'version = "0.0.1"\n'
    );
    writeFile(path.join(R.tier2exists, "pkg", "mod.py"), MODULE_TEXT);
    writeFile(
      path.join(R.tier2exists, "tests", "test_mod.py"),
      "def test_human_wrote_this():\n    assert True\n"
    );

    // TIER 3: neither testpaths nor a tests/ directory. The root marker is
    // setup.cfg, so this row also proves runRoot is not pyproject-only.
    R.tier3 = project("tier3");
    writeFile(path.join(R.tier3, "setup.cfg"), "[metadata]\nname = probe\n");
    writeFile(path.join(R.tier3, "pkg", "mod.py"), MODULE_TEXT);

    // One root per remaining marker file, to pin the runRoot marker set.
    for (const [name, marker, text] of [
      ["marker-setuppy", "setup.py", 'from setuptools import setup\nsetup(name="probe")\n'],
      ["marker-toxini", "tox.ini", "[tox]\nenvlist = py312\n"],
    ]) {
      R[name] = project(name);
      writeFile(path.join(R[name], marker), text);
      writeFile(path.join(R[name], "pkg", "mod.py"), MODULE_TEXT);
    }

    // The import that does NOT resolve. The stub interpreter exits 1 for it.
    R.ghost = project("ghost");
    writeFile(
      path.join(R.ghost, "pyproject.toml"),
      "[project]\n" + 'name = "ghost"\n' + 'version = "0.0.1"\n'
    );
    writeFile(path.join(R.ghost, "ghost", "mod.py"), MODULE_TEXT);
    fs.mkdirSync(path.join(R.ghost, "tests"), { recursive: true });

    // No project root anywhere above this module.
    R.noroot = path.join(base, "noroot");
    writeFile(path.join(R.noroot, "pkg", "mod.py"), MODULE_TEXT);
  } catch (e) {
    fixtureError = e.message;
  }
} else {
  fixtureError = "the on-disk fixtures need a POSIX shell for the stub interpreter";
}

// A FAILED bundle never returns a cleanup, and it still wrote the entry file.
// Sweep every path so a red run leaves nothing behind, in the tree or in temp.
test.after(() => {
  cleanup();
  for (const leftover of [".blind-v31-py.entry.ts", ".blind-v31-py.bundle.cjs"]) {
    fs.rmSync(path.join(__dirname, leftover), { force: true });
  }
  if (base) fs.rmSync(base, { recursive: true, force: true });
});

const { tddLangFor, frameworkFor } = mod;

test("bundle: the seam surface builds and exports tddLangFor + frameworkFor [contract-seam.md 'New file: src/core/tddLang.ts']", () => {
  if (bundleError) {
    assert.fail(
      `bundle failed to build - the seam is not implemented yet: ${bundleError.message}`
    );
  }
  assert.strictEqual(typeof tddLangFor, "function", "tddLangFor is the one construction point");
  assert.strictEqual(typeof frameworkFor, "function", "frameworkFor resolves the rung");
});

// Resolve the Python leg once. Its absence is the OTHER single loud failure.
let pyLang;
let legError;
if (!bundleError) {
  try {
    pyLang = tddLangFor("python");
  } catch (e) {
    legError = `tddLangFor("python") threw: ${e.message}`;
  }
  if (!legError && !pyLang) {
    legError = 'tddLangFor("python") returned undefined: the phase 4 Python leg is not registered yet';
  }
}

test("REGISTRATION: tddLangFor('python') resolves a TddLang [contract-py.md 'Registers \"python\" in tddLangFor']", (ctx) => {
  if (bundleError) return ctx.skip("bundle failed to build; see the bundle test");
  assert.ok(!legError, legError || "");
  assert.strictEqual(typeof pyLang, "object", "a TddLang is an object of members, not a factory");
});

// Every other test skips (not fails) while the bundle or the registration is
// broken, so a red run stays one loud failure instead of a wall of TypeErrors.
const ptest = (name, fn) =>
  test(name, (ctx) => {
    if (bundleError) return ctx.skip("bundle failed to build; see the bundle test");
    if (legError) return ctx.skip("the Python leg is not registered; see the REGISTRATION test");
    return fn(ctx);
  });

// Rows that need a project on disk skip separately, so a fixture problem never
// reads as a contract failure.
const fstest = (name, fn) =>
  test(name, (ctx) => {
    if (bundleError) return ctx.skip("bundle failed to build; see the bundle test");
    if (legError) return ctx.skip("the Python leg is not registered; see the REGISTRATION test");
    if (fixtureError) return ctx.skip(`temp fixtures unavailable: ${fixtureError}`);
    return fn(ctx);
  });

test("FIXTURES: the temp projects built, under the SYSTEM TEMP area and never inside the repo [contract-py.md 'Never create a `pyproject.toml`, a `setup.py`, a `conftest.py` or a venv' - which binds the PRODUCT, so this oracle's own fixtures stay out of the tree too]", (ctx) => {
  if (!FS_FIXTURES_SUPPORTED) return ctx.skip(fixtureError);
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

// Real-filesystem-backed deps, so a leg that reads through TddDeps and a leg
// that stats directly both see the same tree.
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
};

const placeOk = (filePath, symbol) => {
  const res = pyLang.placementFor(filePath, symbol, fsDeps);
  assert.strictEqual(
    res.ok,
    true,
    `expected a placement for ${filePath}, got refusal ${JSON.stringify(res.refusal)}`
  );
  return res.placement;
};

const pytestFw = () => {
  assert.ok(Array.isArray(pyLang.frameworks), "frameworks is an array in precedence order");
  const fw = pyLang.frameworks.find((f) => f.id === "pytest");
  assert.ok(fw, `a pytest framework entry exists, got ${JSON.stringify(pyLang.frameworks.map((f) => f.id))}`);
  return fw;
};

const unittestFw = () => {
  const fw = pyLang.frameworks.find((f) => f.id === "unittest");
  assert.ok(fw, `a unittest framework entry exists, got ${JSON.stringify(pyLang.frameworks.map((f) => f.id))}`);
  return fw;
};

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

const hasFlag = (args, flag) => args.some((a) => a === flag || a.startsWith(flag + "=") || a.startsWith(flag + " "));

// The XML arrives as stdout. See seam gap (a) in the header.
const parse = (xml, exitCode, stderr = "") => pytestFw().parseOutput(xml, stderr, exitCode);

// Apply a TestInsertionPlan so the assertions read the RESULTING document,
// whether the plan carries the whole file or only the appended region.
const applyPlan = (existingText, plan) =>
  existingText.slice(0, plan.start) + plan.text + existingText.slice(plan.end);

const DOC = "Strip comments and return the query with its removed fragments.";

// ===========================================================================
// 1. Registration and shape.
// ===========================================================================

ptest("python TddLang: languageId is 'python' and displayName names Python [contract-seam.md 'readonly languageId'; 'Named in every refusal']", () => {
  assert.strictEqual(pyLang.languageId, "python", "the languageId round-trips the lookup key");
  assert.strictEqual(typeof pyLang.displayName, "string", "displayName is a string");
  assert.ok(
    /python/i.test(pyLang.displayName),
    `every refusal names the language, so displayName must say Python, got ${JSON.stringify(pyLang.displayName)}`
  );
});

ptest("python TddLang: markerPrefix is '#', the ONLY leg that is not '//' - one source of the marker format so scaffold and generatedTestNames cannot drift [contract-py.md '`markerPrefix` is `\"#\"`, the only leg that is not `//`']", () => {
  assert.strictEqual(
    pyLang.markerPrefix,
    "#",
    `a "//" marker is not a Python comment and the generated file would not parse. Got ${JSON.stringify(pyLang.markerPrefix)}`
  );
});

ptest("python TddLang: frameworks are exactly ['pytest', 'unittest'] IN PRECEDENCE ORDER - their assertion idioms differ enough to need different locators [contract-py.md '## Frameworks, in precedence order'; 'The two are separate entries rather than one because their assertion idioms differ']", () => {
  assert.deepStrictEqual(
    pyLang.frameworks.map((f) => f.id),
    ["pytest", "unittest"],
    `pytest first, unittest as the always-available fallback. Got ${JSON.stringify(pyLang.frameworks.map((f) => f.id))}`
  );
  for (const fw of pyLang.frameworks) {
    assert.strictEqual(typeof fw.displayName, "string", `${fw.id}: displayName carries the honest-dark name`);
    assert.strictEqual(
      typeof fw.assertionInstruction,
      "string",
      `${fw.id}: the prompt fragment naming ITS assertion idiom, because assert x == y and self.assertEqual(x, y) are different instructions`
    );
    assert.ok(fw.assertionInstruction.length > 0, `${fw.id}: an empty instruction tells the model nothing`);
  }
});

ptest("REGISTRATION: csharp RESOLVES now that phase 5 has landed, so every language the goal names has a leg and no phase is left owing one [contract-seam.md 'Go, TypeScript, Python and C# are phases 2 to 5, and tddLangFor returns undefined for them until their phase lands']", () => {
  const csLang = tddLangFor("csharp");
  assert.strictEqual(
    typeof csLang,
    "object",
    `phase 5 registers csharp, which was the last of the five. Got ${JSON.stringify(csLang)}`
  );
  assert.strictEqual(csLang.languageId, "csharp", "the languageId round-trips the lookup key");
});

fstest("frameworkFor python: ALWAYS resolves, because unittest ships with the interpreter - honest-dark for 'no framework' is UNREACHABLE here, which is a real difference from TypeScript and C# [contract-py.md 'Like Go, Python always has SOME rung, so honest-dark for \"no framework\" is unreachable here']", () => {
  for (const [label, root] of [
    ["a project with pytest available", R.tier2],
    ["a project with no test directory at all", R.tier3],
  ]) {
    const res = frameworkFor(pyLang, root, fsDeps);
    assert.strictEqual(res.ok, true, `${label}: Python's refusal path is placement and imports, never frameworks`);
    assert.ok(
      ["pytest", "unittest"].includes(res.framework.id),
      `${label}: the resolved framework is one of the two, got ${JSON.stringify(res.framework.id)}`
    );
  }
});

fstest("unittest.detect: true for ANY project root - it ships with the interpreter, so there is nothing to look for [contract-py.md 'unittest, always available, since it ships with the interpreter']", () => {
  for (const root of [R.tier1, R.tier2, R.tier3, R.noroot]) {
    assert.strictEqual(
      unittestFw().detect(root, fsDeps),
      true,
      `unittest is in the standard library, so its detection cannot fail. Root ${root}`
    );
  }
});

// A recording fake probe. Deliberately CONTRADICTS the stub interpreter sitting
// in each fixture project, so a leg that spawns directly and a leg that goes
// through the dep give opposite answers and the rows can tell them apart.
const recordingProbe = (exitCode) => {
  const calls = [];
  return {
    calls,
    probe: (command, args, cwd) => {
      calls.push({ command, args, cwd });
      return exitCode === undefined ? undefined : { exitCode };
    },
  };
};
const withProbe = (probe) => Object.assign({}, fsDeps, { probe });

fstest("pytest.detect: the answer comes from `deps.probe`, NEVER from a direct spawn - an injected probe reporting exit 1 makes detect FALSE even though the interpreter ON DISK in this fixture exits 0 for every probe, which is what makes the decision testable headless [contract-seam.md 'It is a DEP rather than a direct spawn so that `detect` stays pure over its injected deps, which is what makes these decisions testable headless. A test supplies a fake probe; it never needs a real interpreter'; goal.md Amendment 6c]", () => {
  const { probe, calls } = recordingProbe(1);
  const got = pytestFw().detect(R.tier2, withProbe(probe));
  assert.strictEqual(
    got,
    false,
    `the injected probe said pytest does not import. A leg that spawned the real .venv/bin/python would have been told 0 and answered true, which is exactly the direct spawn this dep exists to prevent. Got ${JSON.stringify(got)}`
  );
  assert.ok(calls.length > 0, "detection asked the probe rather than deciding some other way");
});

fstest("pytest.detect: the probe is asked with the PROJECT'S interpreter, `-c \"import pytest\"`, and the project root as cwd - asking a different interpreter than the one the tests will run in proves nothing [contract-py.md 'pytest, when it resolves in the project's interpreter (`-c \"import pytest\"`)'; contract-seam.md 'pytest detection asks the project's interpreter `-c \"import pytest\"`']", () => {
  const { probe, calls } = recordingProbe(0);
  const got = pytestFw().detect(R.tier2, withProbe(probe));
  assert.strictEqual(got, true, `exit 0 means pytest imports, so pytest is the rung. Got ${JSON.stringify(got)}`);

  const call = calls.find((c) => c.args.join(" ").includes("pytest"));
  assert.ok(call, `one probe call asks about pytest, got ${JSON.stringify(calls)}`);
  assert.ok(/python/i.test(call.command), `the probe runs a Python interpreter, got ${JSON.stringify(call.command)}`);
  assert.ok(
    call.command.includes(".venv"),
    `the PROJECT'S interpreter, not whatever python3 resolves to on PATH. Got ${JSON.stringify(call.command)}`
  );
  assert.ok(call.args.includes("-c"), `the probe is a one-liner import check, got ${JSON.stringify(call.args)}`);
  assert.ok(
    call.args.some((a) => /import\s+pytest/.test(a)),
    `the one-liner imports pytest, got ${JSON.stringify(call.args)}`
  );
  assert.strictEqual(call.cwd, R.tier2, `the probe runs from the project root, got ${JSON.stringify(call.cwd)}`);
});

fstest("pytest.detect: a probe returning undefined - the command could not be spawned at all - is NOT pytest, and never throws [contract-seam.md 'undefined when the command could not be spawned at all']", () => {
  const { probe } = recordingProbe(undefined);
  let got;
  assert.doesNotThrow(() => {
    got = pytestFw().detect(R.tier2, withProbe(probe));
  }, "an unspawnable interpreter is an answer, not an exception");
  assert.strictEqual(
    got,
    false,
    `nothing was learned, so pytest cannot be claimed as configured. unittest still ships with the interpreter, so the rung survives. Got ${JSON.stringify(got)}`
  );
});

fstest("THE IMPORT PROOF also rides `deps.probe`, in BOTH directions: a probe reporting exit 1 refuses a module the on-disk interpreter would import, and a probe reporting exit 0 accepts one it would not [contract-seam.md 'Python needs it twice: pytest detection ... and the import must be PROVEN to resolve before a test file is written'; goal.md Amendment 6c]", () => {
  const denied = pyLang.placementFor(
    path.join(R.tier2, "pkg", "mod.py"),
    "preprocess_cypher",
    withProbe(recordingProbe(1).probe)
  );
  assert.strictEqual(
    denied.ok,
    false,
    `the injected probe said pkg.mod does not import, and the fixture's real interpreter says it does. The dep is the channel. Got ${JSON.stringify(denied.placement)}`
  );
  assert.strictEqual(denied.refusal.reason, "unresolvable-import", "the enumerated reason for exactly this");

  const allowed = pyLang.placementFor(
    path.join(R.ghost, "ghost", "mod.py"),
    "preprocess_cypher",
    withProbe(recordingProbe(0).probe)
  );
  assert.strictEqual(
    allowed.ok,
    true,
    `the injected probe said ghost.mod imports, and the fixture's real interpreter says it does not. Both directions must follow the dep, or only one of them is being tested. Got refusal ${JSON.stringify(allowed.refusal)}`
  );
});

// ===========================================================================
// 2. Placement. THREE TIERS, first match wins, and Python is the only leg
//    whose target directory is configurable.
//    [contract-py.md '## Placement']
// ===========================================================================

fstest("placementFor python TIER 1: `[tool.pytest.ini_options] testpaths` WINS over an existing tests/ directory - the fixture sets testpaths to 'itests' AND holds a tests/ directory, so a leg that skips the pyproject read lands in the wrong one [contract-py.md 'Resolution order, first match wins: 1. `[tool.pytest.ini_options] testpaths` ... Use the first entry']", () => {
  const p = placeOk(path.join(R.tier1, "src", "pkg", "mod.py"), "preprocess_cypher");
  assert.strictEqual(
    p.targetPath,
    path.join(R.tier1, "itests", "test_mod.py"),
    `testpaths names itests, so the tests go there and not in tests/. Got ${p.targetPath}`
  );
  assert.strictEqual(p.mode, "project-file", "Python's tests live under the project, not beside the module, when a test directory is configured");
  assert.strictEqual(p.runRoot, R.tier1, "runRoot is the project root holding pyproject.toml");
  assert.strictEqual(p.packageArg, undefined, "the filter is node ids, so there is no package argument");
});

fstest("placementFor python TIER 2: no testpaths, but a tests/ directory exists at the project root [contract-py.md '2. A `tests/` directory exists at the project root']", () => {
  const p = placeOk(path.join(R.tier2, "pkg", "mod.py"), "preprocess_cypher");
  assert.strictEqual(
    p.targetPath,
    path.join(R.tier2, "tests", "test_mod.py"),
    `the existing tests/ directory is the target, got ${p.targetPath}`
  );
  assert.strictEqual(p.mode, "project-file", "still project-file: the directory is the project's, not the module's");
  assert.strictEqual(p.runRoot, R.tier2, "runRoot is the project root");
});

fstest("placementFor python TIER 3: neither testpaths nor a tests/ directory, so test_<module>.py sits BESIDE the module [contract-py.md '3. Beside the module: `test_foo.py` next to `foo.py`']", () => {
  const p = placeOk(path.join(R.tier3, "pkg", "mod.py"), "preprocess_cypher");
  assert.strictEqual(
    p.targetPath,
    path.join(R.tier3, "pkg", "test_mod.py"),
    `with nowhere configured the tests go next to the module, got ${p.targetPath}`
  );
  assert.strictEqual(p.runRoot, R.tier3, "runRoot is the project root, which here is marked by setup.cfg alone");
});

fstest("placementFor python: the target file is always test_<module>.py, never <module>_test.py - pytest's default collection pattern is test_*.py [contract-py.md 'The file is `test_<module>.py`']", () => {
  for (const [label, root, src] of [
    ["tier 1", R.tier1, path.join(R.tier1, "src", "pkg", "mod.py")],
    ["tier 2", R.tier2, path.join(R.tier2, "pkg", "mod.py")],
    ["tier 3", R.tier3, path.join(R.tier3, "pkg", "mod.py")],
  ]) {
    const p = placeOk(src, "preprocess_cypher");
    assert.strictEqual(
      path.basename(p.targetPath),
      "test_mod.py",
      `${label}: a file named mod_test.py is never collected by a default pytest run, got ${path.basename(p.targetPath)}`
    );
    assert.ok(p.targetPath.startsWith(root), `${label}: the target stays inside the project root`);
  }
});

fstest("placementFor python: runRoot is the nearest ancestor holding pyproject.toml, setup.py, setup.cfg OR tox.ini - all four are project markers [contract-py.md '`runRoot` is the project root, the nearest ancestor with `pyproject.toml`, `setup.py`, `setup.cfg` or `tox.ini`']", () => {
  for (const [marker, root] of [
    ["pyproject.toml", R.tier2],
    ["setup.cfg", R.tier3],
    ["setup.py", R["marker-setuppy"]],
    ["tox.ini", R["marker-toxini"]],
  ]) {
    const p = placeOk(path.join(root, "pkg", "mod.py"), "preprocess_cypher");
    assert.strictEqual(p.runRoot, root, `${marker} marks a project root on its own, got runRoot ${p.runRoot}`);
  }
});

fstest("placementFor python: `exists` tracks whether the target test file is already on disk, which is what decides create-versus-extend [contract-seam.md 'True when targetPath already exists on disk']", () => {
  assert.strictEqual(
    placeOk(path.join(R.tier2, "pkg", "mod.py"), "preprocess_cypher").exists,
    false,
    "no test file yet, so the gesture is creating one and the human previews a whole new file"
  );
  assert.strictEqual(
    placeOk(path.join(R.tier2exists, "pkg", "mod.py"), "preprocess_cypher").exists,
    true,
    "tests/test_mod.py is on disk, so the gesture is extending it"
  );
});

fstest("placementFor python: a module outside any project refuses 'no-project-root' and the detail NAMES the four files that were looked for [contract-py.md 'None of those means refuse `no-project-root` naming them'; contract-seam.md 'it must NAME WHAT IS MISSING']", () => {
  const res = pyLang.placementFor(path.join(R.noroot, "pkg", "mod.py"), "preprocess_cypher", fsDeps);
  assert.strictEqual(res.ok, false, "no project root means the gesture cannot place a test");
  assert.strictEqual(res.refusal.reason, "no-project-root", "the enumerated reason, not free text");
  assert.ok(
    res.refusal.detail.includes("pyproject.toml"),
    `the detail names what was looked for, got ${JSON.stringify(res.refusal.detail)}`
  );
  assert.ok(
    /setup\.py|setup\.cfg|tox\.ini/.test(res.refusal.detail),
    `the detail names the other project markers too, or the human fixes the wrong file. Got ${JSON.stringify(res.refusal.detail)}`
  );
  assert.strictEqual(res.placement, undefined, "a refusal never smuggles a half-built placement through");
});

// ===========================================================================
// 3. The import. The leg's sharpest edge: a guessed import that fails produces
//    a red the human cannot act on.
//    [contract-py.md '### The import, and it must be PROVEN to resolve before a
//     file is written']
// ===========================================================================

fstest("importLine python: derived from the package path relative to the project root, HONOURING `[tool.setuptools.packages.find] where = [\"src\"]`, so src/pkg/mod.py imports as `from pkg.mod import ...` and never `from src.pkg.mod` [contract-py.md 'the corpus sets `where = [\"src\"]`, so `src/mcp_graph_engine/cypher.py` imports as `from mcp_graph_engine.cypher import ...`']", () => {
  const p = placeOk(path.join(R.tier1, "src", "pkg", "mod.py"), "preprocess_cypher");
  assert.strictEqual(typeof p.importLine, "string", `a project-file placement reaches the unit through an import, got ${JSON.stringify(p.importLine)}`);
  assert.ok(
    /from\s+pkg\.mod\s+import\b/.test(p.importLine),
    `the src directory is a layout detail, not a package, so it must not appear in the import. Got ${JSON.stringify(p.importLine)}`
  );
  assert.ok(
    !/\bsrc\./.test(p.importLine),
    `"from src.pkg.mod import" does not resolve in a src-layout project and is exactly the red the human cannot act on. Got ${JSON.stringify(p.importLine)}`
  );
  assert.ok(
    p.importLine.includes("preprocess_cypher"),
    `the import names the symbol under test, got ${JSON.stringify(p.importLine)}`
  );
});

fstest("importLine python: a FLAT layout imports from the package directory directly, with no `where` key to honour [contract-py.md 'Derive the import from the module's package path relative to the project root']", () => {
  const p = placeOk(path.join(R.tier2, "pkg", "mod.py"), "preprocess_cypher");
  assert.ok(
    /from\s+pkg\.mod\s+import\b/.test(p.importLine),
    `pkg/mod.py under the project root is the package path, got ${JSON.stringify(p.importLine)}`
  );
});

fstest("THE SHARPEST EDGE: a module that does NOT resolve refuses with 'unresolvable-import' BEFORE a file is written, and the detail names the MODULE and the INTERPRETER - a guessed import that fails arrives as a collection error the human cannot act on from the message alone [contract-py.md 'Then PROVE it resolves ... When it does not resolve, refuse with `unresolvable-import` and say which module could not be imported and which interpreter was asked']", () => {
  const res = pyLang.placementFor(path.join(R.ghost, "ghost", "mod.py"), "preprocess_cypher", fsDeps);
  assert.strictEqual(
    res.ok,
    false,
    `the project's interpreter cannot import ghost.mod, so nothing may be written. Got placement ${JSON.stringify(res.placement)}`
  );
  assert.strictEqual(res.refusal.reason, "unresolvable-import", "the enumerated reason the seam already carries for exactly this");
  assert.ok(
    res.refusal.detail.includes("ghost"),
    `the detail says WHICH module could not be imported, got ${JSON.stringify(res.refusal.detail)}`
  );
  assert.ok(
    /python/i.test(res.refusal.detail),
    `the detail says WHICH interpreter was asked, or the human cannot tell which environment is missing the package. Got ${JSON.stringify(res.refusal.detail)}`
  );
  assert.ok(
    res.refusal.detail.includes(".venv") || res.refusal.detail.includes(path.join(R.ghost, ".venv", "bin", "python")),
    `naming the resolved interpreter by path is the difference between an actionable refusal and a shrug. Got ${JSON.stringify(res.refusal.detail)}`
  );
});

fstest("THE SHARPEST EDGE, the other direction: a resolvable import does NOT refuse, so the proof is a gate and not a blanket no [contract-py.md 'PROVEN: the corpus's package IS importable from its own `.venv`']", () => {
  for (const [label, src] of [
    ["src layout", path.join(R.tier1, "src", "pkg", "mod.py")],
    ["flat layout", path.join(R.tier2, "pkg", "mod.py")],
  ]) {
    const res = pyLang.placementFor(src, "preprocess_cypher", fsDeps);
    assert.strictEqual(
      res.ok,
      true,
      `${label}: the interpreter imports this module, so the gesture proceeds. Got refusal ${JSON.stringify(res.refusal)}`
    );
  }
});

// ===========================================================================
// 4. The command. Every flag is load-bearing.
//    [contract-py.md '## The command']
// ===========================================================================

const cmdFor = (names) => {
  const p = placeOk(path.join(R.tier2, "pkg", "mod.py"), "preprocess_cypher");
  const cmd = pytestFw().buildCommand(p, names);
  assert.ok(Array.isArray(cmd.args), "args is an array, not a shell string");
  return { cmd, placement: p };
};

fstest("pytest.buildCommand: the command is the PROJECT'S interpreter, not a bare python off PATH - the import was proven in that interpreter, so the run must use the same one [contract-py.md 'Reuse `PyOracle`'s existing interpreter resolution (`.venv/bin/python`, `venv/bin/python`, and the Windows `Scripts` variants) ... Do not write a second resolver']", () => {
  const { cmd, placement } = cmdFor(["test_happy"]);
  assert.strictEqual(typeof cmd.command, "string", "the command is a program path");
  assert.ok(/python/i.test(cmd.command), `the program is a Python interpreter, got ${JSON.stringify(cmd.command)}`);
  assert.ok(
    cmd.command.includes(".venv"),
    `the project's own venv interpreter, not whatever "python3" resolves to on PATH: proving the import in one interpreter and running in another proves nothing. Got ${JSON.stringify(cmd.command)}`
  );
  assert.strictEqual(cmd.cwd, placement.runRoot, "cwd is runRoot, because node ids are relative to it");
});

fstest("pytest.buildCommand: `-m pytest`, `-q`, and the node ids as POSITIONAL arguments relative to runRoot - never `-k`, because a bad node id is an honest `not found` while `-k` matching nothing is a silent deselect [contract-py.md '`<interpreter> -B -m pytest <nodeid> <nodeid> -q -p no:cacheprovider --junit-xml=<tmpfile>`'; 'Node ids, never `-k`']", () => {
  const { cmd } = cmdFor(["test_happy", "test_zero"]);
  assert.strictEqual(flagValue(cmd.args, "-m"), "pytest", `pytest runs as a module of the resolved interpreter, got ${JSON.stringify(cmd.args)}`);
  assert.ok(hasFlag(cmd.args, "-q"), `-q keeps the output small, got ${JSON.stringify(cmd.args)}`);
  assert.ok(
    !hasFlag(cmd.args, "-k"),
    `-k is a regex filter whose miss is a silent deselect at exit 5. Node ids compose with no regex at all. Got ${JSON.stringify(cmd.args)}`
  );

  const ids = cmd.args.filter((a) => a.includes("::"));
  assert.strictEqual(ids.length, 2, `one node id per test name, got ${JSON.stringify(cmd.args)}`);
  for (const name of ["test_happy", "test_zero"]) {
    assert.ok(
      ids.some((id) => id.endsWith("::" + name)),
      `${name} rides as its own node id, got ${JSON.stringify(ids)}`
    );
  }
  for (const id of ids) {
    assert.ok(
      id.startsWith("tests/test_mod.py::"),
      `a node id is the target path RELATIVE to runRoot, forward-slashed, got ${JSON.stringify(id)}`
    );
    assert.ok(!path.isAbsolute(id.split("::")[0]), "an absolute node id is not what pytest resolves against its rootdir");
  }
});

fstest("pytest.buildCommand: BOTH `-B` AND `-p no:cacheprovider` are present, and `-B` precedes `-m` - `-p no:cacheprovider` ALONE still lets the interpreter write __pycache__ into the human's repo, and `-B` after `-m` would be pytest's argument rather than the interpreter's [contract-py.md '`-B` keeps `__pycache__` out. Measured: `-p no:cacheprovider` alone is NOT enough, the interpreter still writes bytecode. With both, the run leaves nothing behind']", () => {
  const { cmd } = cmdFor(["test_happy"]);
  assert.ok(
    cmd.args.includes("-B"),
    `without -B the run leaves __pycache__ directories in the human's repo, which is exactly what this session is being careful about. Got ${JSON.stringify(cmd.args)}`
  );
  assert.strictEqual(
    flagValue(cmd.args, "-p"),
    "no:cacheprovider",
    `without it the run leaves .pytest_cache behind. Got ${JSON.stringify(cmd.args)}`
  );

  const bAt = cmd.args.indexOf("-B");
  const mAt = cmd.args.findIndex((a) => a === "-m" || a.startsWith("-m="));
  assert.ok(
    bAt >= 0 && mAt >= 0 && bAt < mAt,
    `-B is an INTERPRETER flag: after -m it is handed to pytest instead and the bytecode is written anyway. Got ${JSON.stringify(cmd.args)}`
  );
});

fstest("pytest.buildCommand: `--junit-xml` points at a SYSTEM TEMP path and is NOT inside runRoot - it writes a FILE, and the product writing files into a repo unbidden is the thing this session is being careful about [contract-py.md '`--junit-xml` must point at a SYSTEM TEMP path, never inside the repo']", () => {
  const { cmd, placement } = cmdFor(["test_happy"]);
  const xml = flagValue(cmd.args, "--junit-xml");
  assert.strictEqual(typeof xml, "string", `the command carries a --junit-xml destination, got ${JSON.stringify(cmd.args)}`);
  assert.ok(xml.length > 0, "an empty destination writes nowhere and parses nothing");
  assert.ok(path.isAbsolute(xml), `a relative path resolves against cwd, which IS runRoot. Got ${JSON.stringify(xml)}`);

  const resolved = path.resolve(xml);
  assert.ok(
    !resolved.startsWith(path.resolve(placement.runRoot) + path.sep),
    `the report file must never land inside the human's project. Got ${resolved} under runRoot ${placement.runRoot}`
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
    `"a system temp path" means the platform's temp area, so it is swept by the platform rather than by us. Got ${resolved}`
  );

  // Amendment 6c closed the gap this oracle raised: the command DECLARES where
  // its structured output lands and the runner reads it back in as stdout.
  assert.strictEqual(
    cmd.outputFile,
    xml,
    `outputFile must name the SAME path --junit-xml writes to, or the runner reads a file the run never wrote and every parse is empty. Got outputFile ${JSON.stringify(cmd.outputFile)} against --junit-xml ${JSON.stringify(xml)}`
  );
});

fstest("pytest.buildCommand: an EMPTY node-id list must NEVER run the whole suite - a bare pytest invocation runs every test in the project and reports the result as this function's [contract-py.md 'An empty node-id list must never run the whole suite. Refuse upstream']", () => {
  const p = placeOk(path.join(R.tier2, "pkg", "mod.py"), "preprocess_cypher");
  let cmd;
  try {
    cmd = pytestFw().buildCommand(p, []);
  } catch (e) {
    // Throwing is a legitimate refusal. Nothing further to check.
    assert.ok(e instanceof Error, "a refusal by throw is an Error");
    return;
  }
  assert.ok(
    cmd.args.some((a) => a.includes("::")),
    `a command with no node id selects EVERY test in the project. Refusing upstream, or throwing here, are the only honest options. Got ${JSON.stringify(cmd.args)}`
  );
});

// ===========================================================================
// 5. THE FORGERY. The centrepiece.
//    pytest's TEXT output is forgeable by the code under test: `print()` lands
//    at COLUMN 0 in the captured-stdout section, so a parser scanning for
//    `^FAILED ` or the trailing count line gets a phantom test AND a forged
//    count. `--junit-xml` closes it: counts are ATTRIBUTES and each testcase
//    carries its own name.
//    [scout-findings.md 'pytest text is FORGEABLE too, and `--junit-xml` closes
//     it'; contract-py.md '## The parse: `--junit-xml`, not the text']
// ===========================================================================

// CAPTURED. The forged text as the scout recorded it, printed by the test under
// test and landing at column 0 in the captured-stdout section.
const FORGED_TEXT =
  "1 failed, 99 passed in 0.01s\n" + "FAILED tests/test_atlas.py::test_phantom - forged\n";

// CAPTURED from scout-findings.md, "pytest text is FORGEABLE too": the identical
// forgery under --junit-xml. The forged lines ride inside the <failure>
// element's escaped character data, attributed to the REAL test.
// DERIVED addition, marked here: the <system-out> element, which is where pytest
// files captured stdout under junit-xml. It carries the same forged text, so a
// parser that scans element TEXT anywhere still has nowhere to find a phantom.
const XML_FORGERY =
  '<testsuite errors="0" failures="1" skipped="0" tests="2">\n' +
  '  <testcase classname="tests.test_atlas" name="test_print_forge">\n' +
  '    <failure message="assert 6 == 7&#10; +  where 6 = fanout(3)">' +
  "def test_print_forge():&#10;&gt;       assert fanout(3) == 7&#10;" +
  "E       assert 6 == 7&#10;" +
  "1 failed, 99 passed in 0.01s&#10;" +
  "FAILED tests/test_atlas.py::test_phantom - forged</failure>\n" +
  "    <system-out>1 failed, 99 passed in 0.01s&#10;FAILED tests/test_atlas.py::test_phantom - forged&#10;</system-out>\n" +
  "  </testcase>\n" +
  '  <testcase classname="tests.test_atlas" name="test_ok" />\n' +
  "</testsuite>\n";

// DERIVED from the capture above: real pytest wraps the suite in an XML
// declaration and a <testsuites> element. Same content, the shape a reader must
// also tolerate.
const XML_FORGERY_WRAPPED =
  '<?xml version="1.0" encoding="utf-8"?>\n<testsuites>\n' + XML_FORGERY + "</testsuites>\n";

ptest("THE FORGERY: a test whose print() emits `1 failed, 99 passed` and `FAILED ...::test_phantom` produces NO case named test_phantom and EXACTLY TWO cases - each <testcase> carries its own name attribute, and forged text can only ever land in escaped character data attributed to the REAL test [scout-findings.md 'A parser scanning for `^FAILED ` or `^\\d+ failed, \\d+ passed` gets a phantom test AND a forged count'; 'Each `<testcase>` carries its own `name`. The forged text lands inside the `<failure>` element's escaped character data, attributed to the real test']", () => {
  const p = parse(XML_FORGERY, 1);
  const names = p.cases.map((c) => c.name);

  assert.ok(
    !names.includes("test_phantom"),
    `test_phantom does not exist. It is a string the failing test PRINTED, and the text parser counted it as a case. Got ${JSON.stringify(p.cases)}`
  );
  assert.strictEqual(
    p.cases.length,
    2,
    `two <testcase> elements, so two cases, whatever the code under test printed. Got ${JSON.stringify(p.cases)}`
  );
  assert.deepStrictEqual(
    names.slice().sort(),
    ["test_ok", "test_print_forge"],
    "only the two real tests, each named by its own name attribute"
  );
  assert.ok(
    p.failures.every((f) => f.name !== "test_phantom"),
    `a phantom must not acquire a failure entry either, got ${JSON.stringify(p.failures.map((f) => f.name))}`
  );
});

ptest("THE FORGERY: the counts come from the <testsuite> ATTRIBUTES, so the forged `99 passed` is never a number this parser can read - that is the whole point of moving off the text format [contract-py.md 'counts from the `<testsuite>` ATTRIBUTES `tests`, `failures`, `errors`, `skipped`. They are attributes, not text to be scanned, which is the whole point']", () => {
  const p = parse(XML_FORGERY, 1);
  assert.strictEqual(p.passed, 1, `tests=2 minus failures=1 minus skipped=0 is one pass. The forged text says 99. Got ${p.passed}`);
  assert.notStrictEqual(p.passed, 99, "the forged count must be unreachable, not merely unlikely");
  assert.strictEqual(p.failed, 1, `failures="1" is the failed count, got ${p.failed}`);
  assert.strictEqual(p.ignored, 0, `skipped="0", got ${p.ignored}`);
  assert.strictEqual(p.ran, true, "at least one <testcase> exists, so tests ran");
  assert.strictEqual(p.casesComplete, true, "passing tests ARE enumerated as childless <testcase> elements, unlike C#");
});

ptest("THE FORGERY: the forged text is REACHABLE ONLY inside the real test's failure detail, attributed to test_print_forge and to nothing else - the human still reads everything the run produced, they just cannot be lied to about who produced it [scout-findings.md 'The forged text lands inside the `<failure>` element's escaped character data, attributed to the real test']", () => {
  const p = parse(XML_FORGERY, 1);
  assert.strictEqual(p.failures.length, 1, `one <failure> element, one detail, got ${JSON.stringify(p.failures)}`);
  const f = p.failures[0];
  assert.strictEqual(f.name, "test_print_forge", "the failure is named by its testcase's name attribute");
  assert.ok(
    f.message.includes("assert 6 == 7"),
    `the message attribute is the detail the human reads, got ${JSON.stringify(f.message)}`
  );
  assert.ok(
    f.message.includes("FAILED tests/test_atlas.py::test_phantom"),
    `the forged text is not censored, it is ATTRIBUTED. Dropping it would hide the code's own output from the human. Got ${JSON.stringify(f.message)}`
  );
  const others = JSON.stringify({ cases: p.cases, counts: [p.passed, p.failed, p.ignored] });
  assert.ok(!others.includes("test_phantom"), `nothing outside the real test's detail carries the phantom, got ${others}`);
});

ptest("THE FORGERY: the same suite wrapped in `<?xml ...?><testsuites>`, which is what pytest actually writes, parses identically [contract-py.md 'Parse the XML with a small, tolerant reader']", () => {
  const bare = parse(XML_FORGERY, 1);
  const wrapped = parse(XML_FORGERY_WRAPPED, 1);
  assert.strictEqual(wrapped.cases.length, bare.cases.length, `the wrapper changes nothing, got ${JSON.stringify(wrapped.cases)}`);
  assert.strictEqual(wrapped.passed, 1, "counts still come off the testsuite attributes");
  assert.strictEqual(wrapped.failed, 1);
  assert.strictEqual(
    wrapped.cases.some((c) => c.name === "test_phantom"),
    false,
    "no phantom on either shape"
  );
});

// ===========================================================================
// 6. The three no-run outcomes, TWO OF WHICH SHARE EXIT 4.
//    Third language with this collision. The exit code cannot separate the
//    filter miss from the collection error; the `errors` attribute can.
//    [contract-py.md '## The three no-run outcomes, and two of them share exit
//     4'; contract-seam.md 'The three no-run outcomes are DIFFERENT']
// ===========================================================================

// CAPTURED shape, contract-py.md's table row 1: a normal red.
const XML_TEST_FAILURE =
  '<testsuite errors="0" failures="1" skipped="0" tests="2">\n' +
  '  <testcase classname="tests.test_atlas" name="test_happy">\n' +
  '    <failure message="assert 6 == 7">E       assert 6 == 7</failure>\n' +
  "  </testcase>\n" +
  '  <testcase classname="tests.test_atlas" name="test_zero" />\n' +
  "</testsuite>\n";

// CAPTURED shape, contract-py.md's table row 2, exit 4: the filter miss. A bad
// node id gives `(no match in any of ...)` and an EMPTY suite.
const XML_FILTER_MISS = '<testsuite errors="0" failures="0" skipped="0" tests="0" />\n';

// CAPTURED shape, contract-py.md's table row 3, exit 4: the collection error.
// The ImportError text is the one scout-findings.md recorded for an
// uninstalled src-layout package.
const XML_COLLECTION_ERROR =
  '<testsuite errors="1" failures="0" skipped="0" tests="1">\n' +
  '  <testcase classname="" name="tests/test_atlas.py" time="0">\n' +
  '    <error message="collection failure">tests/test_atlas.py:1: in &lt;module&gt;&#10;' +
  "    from mypkg.atlas import widen&#10;" +
  "E   ModuleNotFoundError: No module named &apos;mypkg&apos;</error>\n" +
  "  </testcase>\n" +
  "</testsuite>\n";

ptest("NO-RUN 1 of 3, test failure at EXIT 1: a real red, so no no-run field is set at all [contract-py.md table 'test failure | `failures=\"1\"`, `<failure>` children | 1 | none, this is a normal red']", () => {
  const p = parse(XML_TEST_FAILURE, 1);
  assert.strictEqual(p.ran, true, "two testcases exist");
  assert.strictEqual(p.failed, 1, "one failure");
  assert.strictEqual(p.passed, 1, "one pass");
  assert.ok(p.filterMatchedNothing !== true, `a run that executed two tests is not a filter miss. Got ${JSON.stringify(p.filterMatchedNothing)}`);
  assert.strictEqual(p.environmentError, undefined, `a failing assertion is not an environment problem. Got ${JSON.stringify(p.environmentError)}`);
});

ptest("NO-RUN 2 of 3, filter miss at EXIT 4: an EMPTY suite with tests=0 errors=0 failures=0 sets filterMatchedNothing and leaves environmentError undefined [contract-py.md table 'filter miss | `tests=\"0\" errors=\"0\" failures=\"0\"`, empty suite | 4 | `filterMatchedNothing`']", () => {
  const p = parse(XML_FILTER_MISS, 4);
  assert.strictEqual(
    p.filterMatchedNothing,
    true,
    `the human must read "your filter matched nothing" rather than a bare refusal. Got ${JSON.stringify(p.filterMatchedNothing)}`
  );
  assert.strictEqual(
    p.environmentError,
    undefined,
    `nothing about the environment failed: pytest started, collected, and matched no node id. Got ${JSON.stringify(p.environmentError)}`
  );
  assert.strictEqual(p.ran, false, "no <testcase> exists, so nothing ran");
  assert.deepStrictEqual(p.cases, [], "an empty suite fabricates no cases");
  assert.strictEqual(p.passed, 0, "the executed>0 guard must hold: zero passed");
  assert.strictEqual(p.failed, 0, "zero failed");
});

ptest("NO-RUN 3 of 3, collection error at EXIT 4: errors=\"1\" with an <error message=\"collection failure\"> sets environmentError, carries the ImportError text, and is NOT a filter miss [contract-py.md table 'collection error | `errors=\"1\"`, `<error message=\"collection failure\">` carrying the ImportError | 4 | `environmentError`']", () => {
  const p = parse(XML_COLLECTION_ERROR, 4);
  assert.strictEqual(
    typeof p.environmentError,
    "string",
    `without environmentError this lands as "the tests did not compile", which is the wrong sentence and points at the wrong fix. Got ${JSON.stringify(p.environmentError)}`
  );
  assert.ok(p.environmentError.length > 0, "an empty environmentError says nothing");
  assert.ok(
    p.environmentError.includes("ModuleNotFoundError") || p.environmentError.includes("mypkg"),
    `the interpreter's own diagnosis must be reachable, because the product may not install the package and can only report it. Got ${JSON.stringify(p.environmentError)}`
  );
  assert.ok(
    p.filterMatchedNothing !== true,
    `an unresolvable import is not a filter miss. Telling this human their filter matched nothing sends them to edit a filter that was never the problem. Got ${JSON.stringify(p.filterMatchedNothing)}`
  );
  assert.strictEqual(p.failed, 0, `an <error> is a collection or setup error and is NOT a test failure. Got ${p.failed}`);
  assert.strictEqual(p.passed, 0, "nothing passed");
  assert.strictEqual(p.passed + p.failed, 0, "executed is zero, so green must never be claimed");
});

ptest("`ran` means the runner produced TEST RESULTS: a <testcase> whose only child is <error> is a collection error, NOT a test result, so ran is FALSE even though the element exists - contract-py.md's original rule (\"at least one <testcase> exists\") made ran true for a run in which nothing ran [goal.md Amendment 6b 'Ruling: `ran` means the runner produced TEST results. A `<testcase>` whose only child is `<error>` is not a test result and does not count. For Python, `ran` is `passed + failed + ignored > 0`']", () => {
  const err = parse(XML_COLLECTION_ERROR, 4);
  assert.strictEqual(
    err.ran,
    false,
    `the collection error arrives AS a <testcase>, which is the whole trap. ran is what decides whether the error fields carry the reason, so a true here hides the ImportError behind a report of results that do not exist. Got ${JSON.stringify(err.ran)}`
  );
  assert.strictEqual(err.passed + err.failed + err.ignored, 0, "no test result of any kind, which is what makes ran false");

  // The rule stated as arithmetic, in every direction it can go.
  const miss = parse(XML_FILTER_MISS, 4);
  assert.strictEqual(miss.ran, false, "an empty suite produces no test results either");

  const mixed = parse(XML_MIXED, 1);
  assert.strictEqual(mixed.ran, true, `one pass, one failure and one skip are test results. Got ${JSON.stringify(mixed.ran)}`);

  // DERIVED from the captured shapes: a suite of nothing but skips. `ignored`
  // counts, so this ran, even though passed + failed is zero.
  const skippedOnly =
    '<testsuite errors="0" failures="0" skipped="1" tests="1">\n' +
    '  <testcase classname="tests.test_atlas" name="test_skip">\n' +
    '    <skipped type="pytest.skip" message="needs a fixture">skipped</skipped>\n' +
    "  </testcase>\n" +
    "</testsuite>\n";
  const skips = parse(skippedOnly, 0);
  assert.strictEqual(
    skips.ran,
    true,
    `ran counts ignored too: the runner did produce a result for this test. The executed>0 guard is INDEPENDENT and still refuses the green. Got ${JSON.stringify(skips.ran)}`
  );
  assert.strictEqual(skips.passed + skips.failed, 0, "and it still executed nothing, so green is still refused");
});

ptest("THE COLLISION, and it is the THIRD language to have it: the filter miss and the collection error BOTH exit 4, so the exit code cannot tell them apart and the `errors` ATTRIBUTE must [contract-py.md 'The exit code cannot separate the last two. The `errors` attribute can. Get this wrong and a project whose import does not resolve is told its filter matched nothing, which is the identical trap Go had and TypeScript had']", () => {
  const miss = parse(XML_FILTER_MISS, 4);
  const err = parse(XML_COLLECTION_ERROR, 4);

  assert.strictEqual(miss.filterMatchedNothing, true, "errors=0 with an empty suite IS a filter miss");
  assert.strictEqual(miss.environmentError, undefined, "and it is not an environment error");

  assert.ok(err.filterMatchedNothing !== true, `errors=1 is NOT a filter miss, at the identical exit code. Got ${JSON.stringify(err.filterMatchedNothing)}`);
  assert.strictEqual(typeof err.environmentError, "string", "errors=1 IS an environment error");

  assert.notStrictEqual(
    miss.filterMatchedNothing === true,
    err.filterMatchedNothing === true,
    "the two exit-4 outcomes must land on OPPOSITE sides of filterMatchedNothing, or one of the two humans is sent to fix the wrong thing"
  );
});

ptest("buildError is NEVER set by the Python leg, on ANY outcome - Python has no build step, so a syntax error in the generated file arrives as a COLLECTION error and is an environmentError by the table [contract-py.md '`buildError` is never set. Python does not compile ahead of the run ... Say so in the code, because \"Python has no build step\" is the kind of thing that gets rediscovered']", () => {
  for (const [label, xml, exitCode] of [
    ["the forgery", XML_FORGERY, 1],
    ["a plain test failure", XML_TEST_FAILURE, 1],
    ["the filter miss", XML_FILTER_MISS, 4],
    ["the collection error", XML_COLLECTION_ERROR, 4],
    ["garbage", "not xml at all", 2],
    ["nothing at all", "", 4],
  ]) {
    const p = parse(xml, exitCode);
    assert.strictEqual(
      p.buildError,
      undefined,
      `${label}: setting buildError sends the human hunting a compile step that does not exist in this language. Got ${JSON.stringify(p.buildError)}`
    );
  }
});

// ===========================================================================
// 7. The parse, element by element.
//    [contract-py.md 'Fill `TestRunParse`']
// ===========================================================================

// DERIVED from the captured shapes above: one childless case, one <failure>,
// one <skipped>, so all three testcase children appear in one suite.
const XML_MIXED =
  '<testsuite errors="0" failures="1" skipped="1" tests="3">\n' +
  '  <testcase classname="tests.test_atlas" name="test_pass" />\n' +
  '  <testcase classname="tests.test_atlas" name="test_fail">\n' +
  '    <failure message="assert 6 == 7">E       assert 6 == 7</failure>\n' +
  "  </testcase>\n" +
  '  <testcase classname="tests.test_atlas" name="test_skip">\n' +
  '    <skipped type="pytest.skip" message="needs a fixture">skipped</skipped>\n' +
  "  </testcase>\n" +
  "</testsuite>\n";

ptest("parseOutput python: a CHILDLESS <testcase> is a PASS, a <failure> child is a failure, a <skipped> child is ignored, and casesComplete is true because passing tests ARE enumerated [contract-py.md '`cases`: one per `<testcase>`. A childless element PASSED. `<failure>` failed, `<skipped>` ignored'; '`casesComplete: true`. Passing tests ARE enumerated, unlike C#']", () => {
  const p = parse(XML_MIXED, 1);
  assert.strictEqual(p.cases.length, 3, `three <testcase> elements, three cases, got ${JSON.stringify(p.cases)}`);
  assert.deepStrictEqual(
    p.cases.map((c) => c.name).sort(),
    ["test_fail", "test_pass", "test_skip"],
    "every testcase is enumerated by its name attribute"
  );
  assert.strictEqual(p.passed, 1, `tests=3, failures=1, skipped=1 leaves one pass, got ${p.passed}`);
  assert.strictEqual(p.failed, 1, "one <failure>");
  assert.strictEqual(p.ignored, 1, `a <skipped> child is ignored, not passed and not failed. Got ${p.ignored}`);
  assert.strictEqual(p.casesComplete, true, "the passing case is present, so consumers may render cases as the whole run");
  assert.strictEqual(p.failures.length, 1, "one failure detail");
  assert.strictEqual(p.failures[0].name, "test_fail", "named by the testcase's name attribute, not by the message");
});

ptest("parseOutput python: the failure detail carries BOTH the message attribute and the element's character data, because pytest puts the assertion in one and the traceback in the other [contract-py.md '`failures`: ... name from the `name` attribute, message from the `message` attribute plus the element's character data']", () => {
  const p = parse(XML_FORGERY, 1);
  const msg = p.failures[0].message;
  assert.ok(msg.includes("assert 6 == 7"), `the message attribute is present, got ${JSON.stringify(msg)}`);
  assert.ok(
    msg.includes("fanout(3)"),
    `the character data is present too, or the human reads an assertion with no context. Got ${JSON.stringify(msg)}`
  );
  assert.ok(
    !msg.includes("&#10;") && !msg.includes("&gt;"),
    `XML entities are DECODED, or the human reads &#10; where a newline should be. Got ${JSON.stringify(msg)}`
  );
});

ptest("parseOutput python: malformed XML gives a did-not-run result and NEVER throws, the same garbage tolerance every other parser here keeps [contract-py.md 'Malformed XML yields a did-not-run result and never throws, the same garbage tolerance every other parser here keeps']", () => {
  for (const [label, text, exitCode] of [
    ["empty", "", 4],
    ["truncated mid-element", '<testsuite errors="0" failures="1" tests="2"><testcase name="test_a"', 1],
    ["never closed", "<testsuite><testcase>", 1],
    ["not xml at all", "Traceback (most recent call last):\nRuntimeError: boom\n", 2],
    ["arbitrary bytes", " ￿\n\n\t garbage <<< >>>", 1],
    ["an unterminated attribute", '<testsuite tests="2 failures="1">', 1],
  ]) {
    let p;
    assert.doesNotThrow(() => {
      p = parse(text, exitCode);
    }, `${label}: parseOutput never throws`);
    assert.strictEqual(p.ran, false, `${label}: nothing parsed, so nothing ran`);
    assert.strictEqual(p.passed, 0, `${label}: zero passed`);
    assert.strictEqual(p.failed, 0, `${label}: zero failed`);
    assert.deepStrictEqual(p.cases, [], `${label}: no fabricated cases`);
    assert.strictEqual(typeof p.casesComplete, "boolean", `${label}: casesComplete is always present`);
  }
});

// ===========================================================================
// 8. returnTypeOf. The shipped Rust regex swallows the trailing colon, which is
//    why this leg needs its own.
//    [contract-py.md '## `returnTypeOf`']
// ===========================================================================

ptest("returnTypeOf python: `def f(a: int) -> str:` yields \"str\" and NOT \"str:\" - the shipped Rust regex swallows the trailing colon, which is the whole reason this leg needs its own [contract-py.md 'the capture swallows the trailing colon, so `def f() -> str:` yields `\"str:\"`'; goal.md 'Python has `->` but the capture swallows the trailing colon']", () => {
  const got = pyLang.returnTypeOf("def f(a: int) -> str:");
  assert.strictEqual(got, "str", `the colon terminates the signature, it is not part of the type. Got ${JSON.stringify(got)}`);
  assert.notStrictEqual(got, "str:", "\"str:\" is not a type and every downstream renderer would treat it as a named class");
});

ptest("returnTypeOf python: the contract's table, row for row [contract-py.md '## `returnTypeOf`' table]", () => {
  const table = [
    ["def f(a: int) -> str:", "str"],
    ["def f(a: int) -> list[int]:", "list[int]"],
    ["def f(a: int):", undefined],
    ["def f(a: int) -> None:", undefined],
    ["def f(a: dict[str, int]) -> bool:", "bool"],
    ["def f(a: Callable[[int], int]) -> str:", "str"],
  ];
  for (const [sig, want] of table) {
    assert.strictEqual(
      pyLang.returnTypeOf(sig),
      want,
      `${JSON.stringify(sig)} yields ${JSON.stringify(want)}`
    );
  }
});

ptest("returnTypeOf python: THE TWO A NAIVE REGEX BREAKS - a `Callable[[int], int]` parameter containing `->` in real code and a `dict[str, int]` parameter containing a COLON both need the parameter list's MATCHING close paren, not the first one [contract-py.md 'The last two are what a naive regex breaks on ... Depth-count to the parameter list's matching close paren, then take what follows `->` up to the final colon']", () => {
  assert.strictEqual(
    pyLang.returnTypeOf("def f(cb: Callable[[int], int]) -> str:"),
    "str",
    "a Callable parameter nests brackets and commas inside the parameter list"
  );
  assert.strictEqual(
    pyLang.returnTypeOf("def apply(cb: Callable[[int], int], n: int) -> dict[str, int]:"),
    "dict[str, int]",
    "the return type may itself carry a colon-free comma; it is the FINAL colon that terminates"
  );
  assert.strictEqual(
    pyLang.returnTypeOf("def f(a: dict[str, int]) -> bool:"),
    "bool",
    "a colon inside a parameter annotation is not the terminator"
  );
  // DERIVED from the same depth rule: a default value carrying parentheses.
  assert.strictEqual(
    pyLang.returnTypeOf("def f(a: tuple[int, int] = (1, 2)) -> str:"),
    "str",
    "a parenthesised default nests a `)` INSIDE the parameter list; the first `)` is the inner one"
  );
});

ptest("returnTypeOf python: `-> None` yields undefined, per supersession S1 - there is nothing to assert on [contract-py.md '`-> None` returns undefined, per supersession S1's reasoning: nothing to assert on']", () => {
  for (const sig of ["def f(a: int) -> None:", "def f() -> None:", "async def f() -> None:"]) {
    assert.strictEqual(
      pyLang.returnTypeOf(sig),
      undefined,
      `${JSON.stringify(sig)}: a function returning None gives the human nothing to type into a hole`
    );
  }
});

// ===========================================================================
// 9. Testability, first-match-wins.
//    async -> io -> needs-fixture -> underspecified -> testable
//    [contract-py.md '## Testability']
// ===========================================================================

ptest("classifyTestability python: `async def`, and an `Awaitable` or `Coroutine` return, are 'async' [contract-py.md 'async: `async def`, or an `Awaitable` / `Coroutine` return']", () => {
  for (const sig of [
    "async def fetch(n: int) -> int:",
    "async def fetch(n: int):",
    "def fetch(n: int) -> Awaitable[int]:",
    "def fetch(n: int) -> Coroutine[Any, Any, int]:",
  ]) {
    assert.strictEqual(
      pyLang.classifyTestability(sig, DOC).reason,
      "async",
      `${JSON.stringify(sig)}: a blind unit test cannot drive a coroutine`
    );
  }
});

ptest("classifyTestability python: `open(`, `pathlib`, `Path`, `socket` and `requests` in the SIGNATURE are 'io' [contract-py.md 'io: `open(`, `pathlib`, `Path`, `socket`, `requests` in the signature']", () => {
  for (const sig of [
    "def load(p: pathlib.Path) -> str:",
    "def load(p: Path) -> str:",
    "def probe(s: socket.socket) -> bool:",
    "def get(session: requests.Session) -> str:",
    'def read(fh=open("data.txt")) -> str:',
  ]) {
    assert.strictEqual(
      pyLang.classifyTestability(sig, DOC).reason,
      "io",
      `${JSON.stringify(sig)} touches the world and is integration territory dressed as a survivor`
    );
  }
});

ptest("classifyTestability python: the io leg reads SIGNATURES, so `_is_port_available(host: str, port: int) -> bool` PASSES even though its body opens a socket - a measured FALSE ZERO, shared with the product and not fixable here [contract-py.md 'Measured 0 on the corpus, and that is a FALSE zero: `_is_port_available(host: str, port: int) -> bool` opens a socket in its body and passes, because the classifier reads signatures ... worth a comment so nobody reports it as a bug'; goal.md Amendment 1 'The signature-only limit is shared with the product and is not fixable by a better classifier']", () => {
  assert.strictEqual(
    pyLang.classifyTestability("def _is_port_available(host: str, port: int) -> bool:", DOC).reason,
    undefined,
    "one of the seven measured survivors. Refusing it here would be a DIFFERENT product than the one measured, and the io leg cannot see a body"
  );
});

ptest("classifyTestability python: a `self` or `cls` FIRST parameter is 'needs-fixture', Python's largest refusal, and it is visible in the signature so Amendment 4's method-form workaround is NOT needed here [contract-py.md 'needs-fixture: a `self` or `cls` FIRST parameter. Measured as Python's largest refusal at 71.9% ... Unlike TypeScript, this is visible in the signature']", () => {
  for (const sig of [
    "def total(self, a: int) -> int:",
    "def total(self) -> int:",
    "def make(cls, a: int) -> int:",
    "def total(self, a: int) -> int :",
  ]) {
    assert.strictEqual(
      pyLang.classifyTestability(sig, DOC).reason,
      "needs-fixture",
      `${JSON.stringify(sig)} needs an instance the blind test cannot construct`
    );
  }
});

ptest("classifyTestability python: `self` must be the FIRST parameter to count - a parameter merely NAMED like one is not a receiver [contract-py.md 'a `self` or `cls` FIRST parameter']", () => {
  for (const sig of [
    "def widen(n: int, self_check: bool) -> int:",
    "def widen(myself: int) -> int:",
    "def widen(classification: str) -> int:",
  ]) {
    assert.strictEqual(
      pyLang.classifyTestability(sig, DOC).reason,
      undefined,
      `${JSON.stringify(sig)} is a free function with an awkward parameter name, not a method, and refusing it costs a real survivor`
    );
  }
});

ptest("classifyTestability python: no docstring, a MISSING return annotation, and `-> None` are each 'underspecified' [contract-py.md 'underspecified: no docstring, a missing `-> T` annotation, or `-> None`']", () => {
  assert.strictEqual(
    pyLang.classifyTestability("def widen(n: int) -> int:", undefined).reason,
    "underspecified",
    "with no contract there is nothing to write a blind test against"
  );
  assert.strictEqual(
    pyLang.classifyTestability("def widen(n: int) -> int:", "").reason,
    "underspecified",
    "an empty docstring is no docstring"
  );
  assert.strictEqual(
    pyLang.classifyTestability("def widen(n: int):", DOC).reason,
    "underspecified",
    "a missing return annotation leaves nothing to blank"
  );
  assert.strictEqual(
    pyLang.classifyTestability("def widen(n: int) -> None:", DOC).reason,
    "underspecified",
    "-> None means nothing to assert on"
  );
});

ptest("classifyTestability python: a documented, annotated free function SURVIVES - six of the seven measured survivors are parsers taking a string and returning a structured value, the ideal blind-unit-test target [contract-py.md 'Python survives 7 of 89 functions, 7.9% ... six of the seven are parsers taking a string and returning a structured value']", () => {
  for (const sig of [
    "def preprocess_cypher(query: str) -> tuple[str, list[str]]:",
    "def remove_comments(line: str) -> str:",
    "def parse_knowledge_dsl(knowledge: str) -> list[dict[str, str]]:",
    "def parse_mermaid(mermaid: str) -> list[dict[str, str]]:",
  ]) {
    assert.strictEqual(
      pyLang.classifyTestability(sig, DOC).reason,
      undefined,
      `${JSON.stringify(sig)} is a measured survivor and must not be refused`
    );
  }
});

ptest("classifyTestability python: first-match-wins precedence holds, so the reported reason is STABLE rather than dependent on which legs happen to match [contract-py.md 'async -> io -> needs-fixture -> underspecified -> testable'; goal.md Amendment 3 'what makes the reported reason PREDICTABLE']", () => {
  assert.strictEqual(
    pyLang.classifyTestability("async def fetch(self, p: Path) -> int:", undefined).reason,
    "async",
    "async precedes everything, so a doc-less async method on a Path reports async"
  );
  assert.strictEqual(
    pyLang.classifyTestability("def load(self, p: Path) -> str:", undefined).reason,
    "io",
    "io precedes needs-fixture"
  );
  assert.strictEqual(
    pyLang.classifyTestability("def total(self, a: int) -> int:", undefined).reason,
    "needs-fixture",
    "needs-fixture precedes underspecified, so a doc-less method reports the fixture problem"
  );
});

ptest("classifyTestability python: 'not-exported' NEVER fires for ANY Python input, LEADING UNDERSCORES INCLUDED - Python has no privacy, a leading underscore is convention, and `_is_port_available` is one of the seven measured survivors, so this decision does real work rather than being a stylistic note [contract-py.md '**No visibility leg. Python has no privacy.** A leading underscore is convention and must NOT trigger a refusal'; contract-seam.md '**Python must never fire it**']", () => {
  const signatures = [
    // The measured survivor whose name starts with an underscore.
    "def _is_port_available(host: str, port: int) -> bool:",
    // Every underscore convention Python uses.
    "def _private(n: int) -> int:",
    "def __very_private(n: int) -> int:",
    "def __dunder__(n: int) -> int:",
    "def _(n: int) -> int:",
    // Ordinary public forms.
    "def preprocess_cypher(query: str) -> tuple[str, list[str]]:",
    "def widen(n: int) -> int:",
    // The refused shapes, which must be refused for their OWN reason.
    "async def _fetch(n: int) -> int:",
    "def _load(p: Path) -> str:",
    "def _total(self, a: int) -> int:",
    "def _noop(n: int):",
    "",
  ];
  for (const sig of signatures) {
    for (const doc of [DOC, undefined]) {
      assert.notStrictEqual(
        pyLang.classifyTestability(sig, doc).reason,
        "not-exported",
        `${JSON.stringify(sig)} (doc: ${doc ? "yes" : "no"}) must never be refused as not-exported; that reason belongs to TypeScript and C# only, and its detail ("add export") is unactionable in Python`
      );
    }
  }
});

ptest("classifyTestability python: testNameIsValid is either absent or accepts pytest's `test_` names - nothing in Python constrains a test function name the way Go does [contract-seam.md 'Go requires `Test` plus an uppercase letter or the runner ignores the function. undefined = no constraint']", () => {
  if (pyLang.testNameIsValid === undefined) return; // no constraint, which is the expected shape
  for (const name of ["test_widen_happy", "test_a", "test_preprocess_cypher_happy"]) {
    assert.strictEqual(
      pyLang.testNameIsValid(name),
      true,
      `${JSON.stringify(name)} is collected by pytest's default python_functions = test*`
    );
  }
});

// ===========================================================================
// 10. expectedValueSpans. THE SAFETY-CRITICAL ONE, and it DIFFERS per
//     framework, which is why the rung is keyed on framework and not language.
//     [contract-py.md '## The assertion idiom, and where the blank goes';
//      goal.md item 6]
// ===========================================================================

const spanTexts = (fw, text) => {
  const spans = fw.expectedValueSpans(text);
  assert.ok(Array.isArray(spans), "expectedValueSpans returns an array");
  for (const s of spans) {
    assert.ok(typeof s.start === "number" && typeof s.end === "number", `a span is a pair of offsets, got ${JSON.stringify(s)}`);
    assert.ok(s.end > s.start, `a span is a non-empty range, got ${JSON.stringify(s)}`);
  }
  return spans.map((s) => text.slice(s.start, s.end));
};

const PYTEST_BODY =
  "def test_fanout_happy():\n" +
  '    """Three shards fan out."""\n' +
  "    assert fanout(3) == 7\n";

ptest("expectedValueSpans pytest: EXACTLY ONE span, covering `7`, the right-hand side of the TOP-LEVEL `==`. It must NOT cover `fanout(3)`, because blanking the call under test deletes the thing being tested and keeps the model's guess as the expectation [contract-py.md 'The blank is the right-hand side of the TOP-LEVEL `==` inside an `assert` statement'; goal.md item 6 'Get this table wrong in one direction and the feature is merely broken; get it wrong in the other and it lies']", () => {
  const fw = pytestFw();
  const texts = spanTexts(fw, PYTEST_BODY);
  assert.deepStrictEqual(texts, ["7"], `one assert, one span, on the expected VALUE. Got ${JSON.stringify(texts)}`);
  assert.ok(
    !texts[0].includes("fanout"),
    "blanking the call under test would delete the thing being tested and keep the model's guess as the expectation"
  );
});

ptest("expectedValueSpans pytest: a nested `==` inside a dict literal blanks ONLY the outer right-hand side [contract-py.md 'Only a TOP-LEVEL `==`. `assert d == {\"a\": 1 == 2}` blanks the outer right-hand side, not the inner']", () => {
  const body = "def test_nested():\n" + '    assert widen(3) == {"a": 1 == 2}\n';
  const texts = spanTexts(pytestFw(), body);
  assert.strictEqual(
    texts.length,
    1,
    `one assert, one span, however many equality pairs the value itself contains. Got ${JSON.stringify(texts)}`
  );
  assert.strictEqual(
    texts[0],
    '{"a": 1 == 2}',
    `the span is the WHOLE outer right-hand side, so the human types one value. A span on the inner 2 leaves a half-blanked literal. Got ${JSON.stringify(texts[0])}`
  );
});

ptest("expectedValueSpans pytest: `assert x == y, \"msg\"` blanks `y` and NEVER the message - blanking the message leaves the guessed expectation in place and asks the human to retype prose [contract-py.md 'An `assert` with a message (`assert x == y, \"msg\"`) blanks `y`, never the message']", () => {
  const body = "def test_msg():\n" + '    assert widen(3) == 7, "widen must widen"\n';
  const texts = spanTexts(pytestFw(), body);
  assert.deepStrictEqual(texts, ["7"], `the span stops at the comma, got ${JSON.stringify(texts)}`);
});

ptest("expectedValueSpans pytest: `assert x != y`, `assert x` and `assert x is None` produce NO span - there is no equality right-hand side to blank, and inventing one would blank an operand [contract-py.md '`assert x != y`, `assert x`, `assert x is None` produce NO span']", () => {
  const fw = pytestFw();
  for (const [label, body] of [
    ["!=", "def test_ne():\n    assert widen(3) != 7\n"],
    ["truthiness", "def test_truthy():\n    assert widen(3)\n"],
    ["is None", "def test_none():\n    assert widen(3) is None\n"],
    ["is not None", "def test_not_none():\n    assert widen(3) is not None\n"],
    [">=", "def test_ge():\n    assert widen(3) >= 7\n"],
  ]) {
    assert.deepStrictEqual(
      spanTexts(fw, body),
      [],
      `${label}: no top-level == means no expected-value span. This is the fail-open shape scraps.md D5 covers; do not make it worse`
    );
  }
});

ptest("expectedValueSpans pytest: no match inside a `#` comment, a single- or double-quoted string, a TRIPLE-quoted string in BOTH spellings, or an f-string with `{...}` interpolation - and the one real assert alongside them still lands [contract-py.md 'Never match inside a string or comment. The literal profile needs Python's `#` comments, single and double quotes, TRIPLE-quoted strings in both spellings, and f-strings with `{...}` interpolation']", () => {
  const body =
    "def test_decoys():\n" +
    "    # assert widen(1) == 91\n" +
    '    s = "assert widen(1) == 92"\n' +
    "    t = 'assert widen(1) == 93'\n" +
    '    u = """\n' +
    "    assert widen(1) == 94\n" +
    '    """\n' +
    "    v = '''assert widen(1) == 95'''\n" +
    '    w = f"assert {widen(1)} == 96"\n' +
    "    assert widen(1) == 7\n";
  const texts = spanTexts(pytestFw(), body);
  assert.deepStrictEqual(
    texts,
    ["7"],
    `six decoys and one real assert. A span on any decoy edits a comment or a string literal and corrupts the file. Got ${JSON.stringify(texts)}`
  );
});

ptest("expectedValueSpans pytest: a file of decoys ALONE yields zero spans, so the literal scanner is not merely picking the last match [contract-py.md 'Never match inside a string or comment']", () => {
  const body =
    "def test_only_decoys():\n" +
    "    # assert widen(1) == 91\n" +
    '    s = """assert widen(1) == 92"""\n' +
    "    t = '''assert widen(1) == 93'''\n" +
    '    u = f"assert {widen(1)} == 94"\n' +
    "    assert s\n";
  assert.deepStrictEqual(spanTexts(pytestFw(), body), [], "nothing outside a literal or comment carries a top-level ==");
});

ptest("expectedValueSpans pytest: spans come back ASCENDING and NON-OVERLAPPING [goal.md item 6 'exactly the byte ranges the human must type']", () => {
  const body =
    "def test_alpha():\n" +
    '    """Alpha."""\n' +
    "    assert alpha(1) == 11\n" +
    "\n" +
    "def test_beta():\n" +
    '    """Beta."""\n' +
    "    assert beta(2) == 22\n";
  const fw = pytestFw();
  const spans = fw.expectedValueSpans(body);
  assert.strictEqual(spans.length, 2, `two asserts, two spans, got ${JSON.stringify(spans)}`);
  assert.deepStrictEqual(
    spans.map((s) => body.slice(s.start, s.end)),
    ["11", "22"],
    "each span covers its own expected value"
  );
  assert.ok(
    spans[1].start >= spans[0].end,
    `ascending and non-overlapping: a consumer applies these in order and overlapping ranges corrupt the document. Got ${JSON.stringify(spans)}`
  );
});

const UNITTEST_BODY =
  "class TestFanout(unittest.TestCase):\n" +
  "    def test_happy(self):\n" +
  '        """Three shards fan out."""\n' +
  "        self.assertEqual(fanout(3), 7)\n";

ptest("expectedValueSpans unittest: EXACTLY ONE span, covering the SECOND argument of self.assertEqual - the same shape as the Rust locator with a different callee name, and the first argument is the call under test [contract-py.md '**unittest**: `self.assertEqual(actual, expected)`, SECOND argument, which is the Rust locator's shape with a different callee name']", () => {
  const fw = unittestFw();
  const texts = spanTexts(fw, UNITTEST_BODY);
  assert.deepStrictEqual(texts, ["7"], `the expected value is the second argument. Got ${JSON.stringify(texts)}`);
  assert.ok(
    !texts[0].includes("fanout"),
    "blanking the first argument deletes the call under test and keeps the model's guessed 7 as the expectation, which is the blank-value invariant inverted"
  );
});

ptest("expectedValueSpans unittest: a nested call in the FIRST argument does not shift the count - the second TOP-LEVEL argument is the expected value [contract-py.md 'SECOND argument'; goal.md item 6 'paren and brace depth counting']", () => {
  const body =
    "class TestJoin(unittest.TestCase):\n" +
    "    def test_happy(self):\n" +
    '        """Join."""\n' +
    '        self.assertEqual(join(a, b), "x-y")\n';
  const texts = spanTexts(unittestFw(), body);
  assert.deepStrictEqual(
    texts,
    ['"x-y"'],
    `the comma inside join(a, b) is not a top-level separator. Got ${JSON.stringify(texts)}`
  );
});

ptest("expectedValueSpans unittest: a THIRD argument (the assertion message) is not the expected value [contract-py.md '`self.assertEqual(actual, expected)`, SECOND argument']", () => {
  const body =
    "class TestWiden(unittest.TestCase):\n" +
    "    def test_happy(self):\n" +
    '        """Widen."""\n' +
    '        self.assertEqual(widen(3), 7, "widen must widen")\n';
  const texts = spanTexts(unittestFw(), body);
  assert.deepStrictEqual(texts, ["7"], `the message stays, the expectation is blanked. Got ${JSON.stringify(texts)}`);
});

ptest("expectedValueSpans unittest: spans ascending and non-overlapping, and never inside a comment or a string [contract-py.md 'Spans ascending and non-overlapping'; 'Never match inside a string or comment']", () => {
  const body =
    "class TestPair(unittest.TestCase):\n" +
    "    def test_alpha(self):\n" +
    '        """Alpha."""\n' +
    "        # self.assertEqual(alpha(1), 91)\n" +
    '        note = "self.assertEqual(alpha(1), 92)"\n' +
    "        self.assertEqual(alpha(1), 11)\n" +
    "\n" +
    "    def test_beta(self):\n" +
    '        """Beta."""\n' +
    "        self.assertEqual(beta(2), 22)\n";
  const fw = unittestFw();
  const spans = fw.expectedValueSpans(body);
  assert.deepStrictEqual(
    spans.map((s) => body.slice(s.start, s.end)),
    ["11", "22"],
    `two real assertions and two decoys, got ${JSON.stringify(spans.map((s) => body.slice(s.start, s.end)))}`
  );
  assert.ok(spans[1].start >= spans[0].end, `ascending and non-overlapping, got ${JSON.stringify(spans)}`);
});

ptest("expectedValueSpans: the two frameworks DISAGREE on the same text, which is why the rung is keyed per framework and not per language [goal.md 'Keyed per framework, not per language, because assertion argument order differs WITHIN a language']", () => {
  const pyt = spanTexts(pytestFw(), PYTEST_BODY);
  const unit = spanTexts(unittestFw(), UNITTEST_BODY);
  assert.deepStrictEqual(pyt, ["7"], "pytest reads the == right-hand side");
  assert.deepStrictEqual(unit, ["7"], "unittest reads the second argument");
  assert.deepStrictEqual(
    spanTexts(pytestFw(), UNITTEST_BODY),
    [],
    `the pytest locator finds no top-level == in a unittest body, so a single shared locator would blank NOTHING and leave the model's guess in the file. Got ${JSON.stringify(spanTexts(pytestFw(), UNITTEST_BODY))}`
  );
});

// ===========================================================================
// 11. renderBlankValue. Amendment 2: a SCALAR gets a BARE hole, everything else
//     gets a hole carrying a type-hint comment, and a container's contents are
//     hinted with the ELEMENT type.
//     [contract-py.md '## Blank values'; goal.md Amendment 2]
// ===========================================================================

const blank = (type) => {
  const res = pyLang.renderBlankValue(type);
  assert.strictEqual(typeof res.holes, "number", `renderBlankValue(${JSON.stringify(type)}) reports a hole count`);
  assert.strictEqual(typeof res.rhs, "string", `renderBlankValue(${JSON.stringify(type)}) renders a right-hand side`);
  return res;
};

ptest("renderBlankValue python: `int`, `str`, `bool`, `float` are ONE BARE hole with NO `/*` comment - the bare side of the bare-versus-hinted rule, because a scalar's own name is no help to the human [goal.md Amendment 2 'a SCALAR gets a bare hole ... Where it names a scalar (`number`, `str`, `int`, `long`, `bool`, `double`), read it as one BARE hole']", () => {
  for (const type of ["int", "str", "bool", "float"]) {
    const res = blank(type);
    assert.strictEqual(res.holes, 1, `${type} is one hole`);
    assert.strictEqual(res.rhs, "${1}", `${type}: a bare hole, got ${JSON.stringify(res.rhs)}`);
    assert.ok(!res.rhs.includes("/*"), `${type}: no type-hint comment on a scalar, got ${JSON.stringify(res.rhs)}`);
  }
});

ptest("renderBlankValue python: `list[T]` scaffolds its literal and the contents are ONE HINTED hole carrying the ELEMENT type - the human is typing an int, not a list[int] [contract-py.md '`list[T]` | `[${1:/* T */}]`'; goal.md Amendment 2 'a container's contents are hinted with the ELEMENT type, not the container type']", () => {
  const res = blank("list[int]");
  assert.strictEqual(res.holes, 1, "the list literal is scaffolded, the contents are one hole");
  assert.strictEqual(res.rhs, "[${1:/* int */}]", `the contract spells this one exactly. Got ${JSON.stringify(res.rhs)}`);

  const nested = blank("list[str]");
  assert.ok(nested.rhs.includes("str"), `the hint names the element type, got ${JSON.stringify(nested.rhs)}`);
});

ptest("renderBlankValue python: `dict[K, V]` scaffolds a braced literal whose single hole hints BOTH the key and the value type [contract-py.md '`dict[K, V]` | `{${1:/* K, V */}}`']", () => {
  const res = blank("dict[str, int]");
  assert.strictEqual(res.holes, 1, "one hole for the whole mapping: what goes in it is a contract decision, not a type decision");
  assert.ok(res.rhs.startsWith("{"), `the dict literal is scaffolded, got ${JSON.stringify(res.rhs)}`);
  assert.ok(res.rhs.endsWith("}"), `and closed, got ${JSON.stringify(res.rhs)}`);
  assert.ok(
    /\$\{1:\/\*[^*]*\bstr\b[^*]*\bint\b[^*]*\*\/\}/.test(res.rhs),
    `the hole hints the key type AND the value type, got ${JSON.stringify(res.rhs)}`
  );
});

ptest("renderBlankValue python: `tuple[A, B]` gives ONE BARE HOLE PER ELEMENT - a POSITIONAL hole stands for exactly one value whose type the human can already read off the position, so a hint there tells them nothing they cannot see [goal.md Amendment 6a 'A hole is HINTED when it stands for an unknown NUMBER of values, and BARE when it stands for exactly one value whose type the human can already read off the position ... `tuple[A, B]` and `[N]T` are one BARE hole per element'; measured: renderBlankValue(\"(i32, String)\") -> (${1}, ${2})]", () => {
  const res = blank("tuple[int, str]");
  assert.strictEqual(res.holes, 2, `a two-element tuple is two holes, one per element, so the human Tabs through both. Got ${res.holes}`);
  assert.strictEqual(
    res.rhs,
    "(${1}, ${2})",
    `bare, even for str, exactly as the shipped Rust renderer spells (i32, String). Got ${JSON.stringify(res.rhs)}`
  );
  assert.ok(
    !res.rhs.includes("/*"),
    `Amendment 6a wins over Amendment 2 here because it is MEASURED: the tuple's second hole is unambiguously the second element. Got ${JSON.stringify(res.rhs)}`
  );

  const three = blank("tuple[int, str, bool]");
  assert.strictEqual(three.holes, 3, `three elements, three holes, got ${three.holes}`);
  assert.strictEqual(three.rhs, "(${1}, ${2}, ${3})", `still bare at three elements, got ${JSON.stringify(three.rhs)}`);
});

ptest("renderBlankValue python: `set[T]` and `frozenset[T]` are a braced literal with ONE HINTED hole [contract-py.md '`set[T]`, `frozenset[T]` | `{${1:/* T */}}`']", () => {
  for (const type of ["set[int]", "frozenset[int]"]) {
    const res = blank(type);
    assert.strictEqual(res.holes, 1, `${type} is one hole`);
    assert.ok(res.rhs.startsWith("{") && res.rhs.endsWith("}"), `${type}: a braced literal, got ${JSON.stringify(res.rhs)}`);
    assert.ok(res.rhs.includes("${1:/*"), `${type}: the hole carries a type-hint comment, got ${JSON.stringify(res.rhs)}`);
    assert.ok(res.rhs.includes("int"), `${type}: the hint names the ELEMENT type, got ${JSON.stringify(res.rhs)}`);
  }
});

ptest("renderBlankValue python: `Optional[T]` and `T | None` are ONE HINTED hole in BOTH spellings - the variant IS the answer, which is the Option/Result precedent, and that precedent is hinted rather than bare [contract-py.md '`Optional[T]`, `T | None` | one HINTED hole. The variant IS the answer, the Option/Result precedent'; goal.md Amendment 2 'renderBlankValue(\"Option<u32>\") -> ${1:/* Option<u32> */}']", () => {
  for (const type of ["Optional[int]", "int | None"]) {
    const res = blank(type);
    assert.strictEqual(res.holes, 1, `${type}: whether the answer is None or a value is a CONTRACT decision, so it stays one hole`);
    assert.ok(res.rhs.includes("${1:/*"), `${type}: not a scalar, so it carries its type hint. Got ${JSON.stringify(res.rhs)}`);
    assert.ok(res.rhs.includes("int"), `${type}: the hint tells the human what shape to type, got ${JSON.stringify(res.rhs)}`);
    assert.ok(
      !res.rhs.startsWith("[") && !res.rhs.startsWith("{") && !res.rhs.startsWith("("),
      `${type}: an optional is not a container and must not scaffold a literal. Got ${JSON.stringify(res.rhs)}`
    );
  }
});

ptest("renderBlankValue python: a named class or a TypedDict is ONE HINTED hole naming the type [contract-py.md 'a named class or a `TypedDict` | one HINTED hole']", () => {
  for (const type of ["Shard", "CypherPlan", "KnowledgeRow"]) {
    const res = blank(type);
    assert.strictEqual(res.holes, 1, `${type} is one hole`);
    assert.ok(res.rhs.includes("${1:/*"), `${type}: the hole carries a type-hint comment, got ${JSON.stringify(res.rhs)}`);
    assert.ok(res.rhs.includes(type), `${type}: the hint names the type so the human knows what to construct, got ${JSON.stringify(res.rhs)}`);
  }
});

ptest("renderBlankValue python: bare-versus-hinted holds in BOTH DIRECTIONS across the whole table - a hole is BARE when it stands for exactly one value the human can read off its position, and HINTED when it stands for an unknown NUMBER of values [goal.md Amendment 6a 'Amendments 2 and 6a together are the rule; where they disagree, 6a wins because it is measured']", () => {
  // BARE: a scalar, and every positional hole inside a tuple.
  for (const type of ["int", "str", "bool", "float", "tuple[int, str]", "tuple[str, str, bool]"]) {
    assert.ok(
      !blank(type).rhs.includes("/*"),
      `${type}: every hole here stands for exactly one value at a known position, so a hint adds nothing. Got ${JSON.stringify(blank(type).rhs)}`
    );
  }
  // HINTED: one hole covering an unknown count, or a named type to construct.
  for (const type of ["list[int]", "dict[str, int]", "set[int]", "frozenset[int]", "Optional[int]", "int | None", "Shard"]) {
    assert.ok(
      blank(type).rhs.includes("/*"),
      `${type}: one hole stands in for a whole unknown-sized value, so the hint is the only thing telling the human what shape to type. Got ${JSON.stringify(blank(type).rhs)}`
    );
  }
});

// ===========================================================================
// 12. Scaffold. "#" markers, the derived import, and a docstring that must not
//     yield a phantom test name.
//     [contract-py.md '## Scaffold']
// ===========================================================================

const MARKER_ID = "preprocess_cypher-1";
const IMPORT_LINE = "from pkg.mod import preprocess_cypher";

const GENERATED_TESTS =
  "def test_preprocess_cypher_happy():\n" +
  '    """Comments are stripped."""\n' +
  '    assert preprocess_cypher("MATCH (n)") == 7\n';

// A duck-typed placement, so the scaffold pins depend on scaffold alone.
const pyPlacement = (over = {}) => ({
  targetPath: "/w/proj/tests/test_mod.py",
  exists: false,
  mode: "project-file",
  runRoot: "/w/proj",
  packageArg: undefined,
  importLine: IMPORT_LINE,
  ...over,
});

const scaffoldFor = (existingText, placementOver = {}) => {
  const plan = pyLang.scaffold({
    existingText,
    generatedTests: GENERATED_TESTS,
    markerId: MARKER_ID,
    placement: pyPlacement(placementOver),
  });
  assert.strictEqual(typeof plan.start, "number", "start is an offset into the target document");
  assert.strictEqual(typeof plan.end, "number", "end is an offset into the target document");
  assert.ok(plan.end >= plan.start, "the replaced range is not inverted");
  assert.strictEqual(typeof plan.text, "string", "text is what gets written");
  return plan;
};

ptest("scaffold python: a NEW file carries the DERIVED import from the placement and fences the generated tests in `#` markers [contract-py.md 'New file: `from mcp_graph_engine.cypher import preprocess_cypher` ... `# column80-tests:<id>:begin`']", () => {
  const plan = scaffoldFor("");
  const out = applyPlan("", plan);

  assert.ok(
    out.includes(IMPORT_LINE),
    `the import comes from the placement, which is the only step that saw the project layout. Got ${JSON.stringify(out)}`
  );

  for (const suffix of ["begin", "end"]) {
    const marker = `column80-tests:${MARKER_ID}:${suffix}`;
    assert.ok(out.includes(marker), `the ${suffix} marker is present, got ${JSON.stringify(out)}`);
    const line = out.split("\n").find((l) => l.includes(marker));
    assert.ok(
      line.trim().startsWith("#"),
      `the ${suffix} marker is a Python comment: a "//" marker is a syntax error in this file. Got ${JSON.stringify(line)}`
    );
  }

  const begin = out.indexOf(`column80-tests:${MARKER_ID}:begin`);
  const fnAt = out.indexOf("def test_preprocess_cypher_happy");
  const end = out.indexOf(`column80-tests:${MARKER_ID}:end`);
  assert.ok(fnAt > begin && fnAt < end, "the generated function sits INSIDE the fence, or the region cannot be replaced later");
  assert.ok(out.indexOf(IMPORT_LINE) < begin, "the import sits above the fenced region, where Python expects imports");
});

ptest("scaffold python: extending a file that ALREADY has the import must NOT duplicate it, and must leave the human's own tests untouched [contract-py.md 'Existing file: ... `extend-existing` appending the region and adding the import only if absent']", () => {
  const existing =
    IMPORT_LINE +
    "\n" +
    "\n" +
    "def test_human_wrote_this():\n" +
    '    """A test the human wrote."""\n' +
    '    assert preprocess_cypher("x") is not None\n';
  const plan = scaffoldFor(existing, { exists: true });
  assert.strictEqual(
    plan.mode,
    "extend-existing",
    `no marked region exists, so the plan appends one. Got ${JSON.stringify(plan.mode)}`
  );
  const out = applyPlan(existing, plan);

  const importCount = out.split(IMPORT_LINE).length - 1;
  assert.strictEqual(
    importCount,
    1,
    `a duplicated import is noise the human has to clean out of a file they just accepted. Got ${importCount} occurrences in ${JSON.stringify(out)}`
  );
  assert.ok(out.includes("test_human_wrote_this"), "the developer's own test survives untouched");
  assert.ok(out.includes("test_preprocess_cypher_happy"), "the generated test rides into the plan");
  assert.ok(out.includes(`column80-tests:${MARKER_ID}:begin`), "the appended region is fenced so it can be replaced next time");
});

ptest("scaffold python: extending a file that already has the import keeps the plan NARROW rather than respanning the whole document - the shipped consumer only previews `replace-generated`, so a whole-file span is indistinguishable by MODE from a small append [contract-py.md 'Keep the plan as narrow as the edit needs, and if a whole-file span is unavoidable make it detectable by something other than the mode string']", () => {
  const existing =
    IMPORT_LINE +
    "\n" +
    "\n" +
    "def test_human_wrote_this():\n" +
    '    """A test the human wrote."""\n' +
    '    assert preprocess_cypher("x") is not None\n';
  const plan = scaffoldFor(existing, { exists: true });
  assert.ok(
    plan.start > 0,
    `nothing above the append point changes, so the plan must not span from offset 0. Got start=${plan.start}, end=${plan.end}, of a ${existing.length}-character file`
  );
});

ptest("scaffold python: a file that ALREADY holds a region for this markerId is REPLACED, not appended to twice [contract-py.md '`replace-generated` when a marked region for this `markerId` exists']", () => {
  const existing =
    IMPORT_LINE +
    "\n" +
    "\n" +
    `# column80-tests:${MARKER_ID}:begin\n` +
    "def test_preprocess_cypher_happy():\n" +
    '    """An older generation."""\n' +
    '    assert preprocess_cypher("MATCH (n)") == 1\n' +
    `# column80-tests:${MARKER_ID}:end\n`;
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
  assert.ok(!out.includes("An older generation"), "the previous generation is gone, not duplicated");
});

ptest("generatedTestNames python: reads `def test_*` inside the marked region and is NOT fooled by a `def test_x` inside a DOCSTRING - phase 3 hit exactly this with submit('save') [contract-py.md '`generatedTestNames` reads `def (test_\\w+)` inside the marked region. Walk the literal-aware scanner, not a raw regex, so a `def test_x` inside a docstring never yields a phantom name']", () => {
  const fileText =
    IMPORT_LINE +
    "\n" +
    "\n" +
    "def test_human_wrote_this():\n" +
    "    assert True\n" +
    "\n" +
    `# column80-tests:${MARKER_ID}:begin\n` +
    "def test_preprocess_cypher_happy():\n" +
    '    """\n' +
    "    Example, for the reader:\n" +
    "        def test_phantom_in_docstring():\n" +
    "            assert False\n" +
    '    """\n' +
    '    assert preprocess_cypher("MATCH (n)") == 7\n' +
    "\n" +
    "def test_preprocess_cypher_empty():\n" +
    "    # def test_phantom_in_comment():\n" +
    '    assert preprocess_cypher("") == 0\n' +
    `# column80-tests:${MARKER_ID}:end\n` +
    "\n" +
    "def test_outside_the_region():\n" +
    "    assert True\n";

  const names = pyLang.generatedTestNames(fileText, MARKER_ID);
  assert.deepStrictEqual(
    names,
    ["test_preprocess_cypher_happy", "test_preprocess_cypher_empty"],
    `only the real definitions inside the region, in order. A phantom name goes into the run filter and pytest answers "not found". Got ${JSON.stringify(names)}`
  );
  assert.ok(!names.includes("test_human_wrote_this"), "the human's own test is outside the region and is not this function's");
  assert.ok(!names.includes("test_outside_the_region"), "so is anything below the end marker");
  assert.deepStrictEqual(
    pyLang.generatedTestNames(fileText, "some-other-id"),
    [],
    "a different markerId sees none of this region's tests"
  );
});

ptest("generatedTestNames python: the scaffold round-trips, so scaffold and the rung's filter cannot drift [contract-py.md '`testMarkers()` already takes the prefix, so use it rather than writing a second format']", () => {
  const plan = scaffoldFor("");
  const out = applyPlan("", plan);
  assert.deepStrictEqual(
    pyLang.generatedTestNames(out, MARKER_ID),
    ["test_preprocess_cypher_happy"],
    `the round trip recovers the generated name, got ${JSON.stringify(pyLang.generatedTestNames(out, MARKER_ID))}`
  );
});
