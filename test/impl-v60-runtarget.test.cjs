// Implementer tests for session-v60 phase A2 section 2: the two members the
// TddLang seam grows so a DISCOVERED test file can become a RUN.
//
//   - `runScope`, which says what one spawn of this language's runner covers,
//     read off the shipped `buildCommand` bodies;
//   - `runTargetForTestFile`, which resolves the run target for a file that
//     ALREADY HOLDS TESTS.
//
// What these pin that the contract alone does not:
//   - every leg resolves its root through the INJECTED deps, so a fake
//     filesystem is enough and no real project is ever touched;
//   - the refusal NAMES the missing manifest, which is the only thing that
//     makes an unrunnable test actionable;
//   - the boundaries: a file sitting AT the root, and one several directories
//     below it, and the NEAREST manifest winning over a further one;
//   - and the distinction that motivated the member at all: fed a real test
//     file, `placementFor` derives a NEW test's path and `runTargetForTestFile`
//     returns the file itself. The last test asserts they disagree.
//
// Run: SKIP_LIVE=1 node --test test/impl-v60-runtarget.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-v60-runtarget",
  `export { tddLangFor } from "../src/core/tddLang";\n`
);
const { tddLangFor } = mod;
test.after(cleanup);

/** A whole filesystem as a path-to-content map, injected through TddDeps.
 *  `readDir` is DERIVED from the keys so a directory listing and the files in
 *  it can never disagree, which is the trap a hand-written listing sets. */
function fakeDeps(files) {
  const paths = Object.keys(files);
  return {
    fileExists: (p) => Object.prototype.hasOwnProperty.call(files, p),
    readFile: (p) => files[p],
    readDir: (dir) => {
      const prefix = dir.endsWith("/") ? dir : `${dir}/`;
      const names = new Set();
      for (const p of paths) {
        if (p.startsWith(prefix)) {
          names.add(p.slice(prefix.length).split("/")[0]);
        }
      }
      return names.size === 0 ? undefined : [...names].sort();
    },
    // Nothing here spawns anything. A run target resolves a ROOT, and a leg
    // that reached for a probe would be reaching outside the injected world.
    probe: () => {
      throw new Error("a run target must not spawn anything");
    },
  };
}

const ok = (result) => {
  assert.strictEqual(result.ok, true, `expected a placement, got ${JSON.stringify(result)}`);
  return result.placement;
};

const refusal = (result) => {
  assert.strictEqual(result.ok, false, `expected a refusal, got ${JSON.stringify(result)}`);
  return result.refusal;
};

// ---- 1. runScope, one row per language -----------------------------------

// MEASURED off each shipped buildCommand: cargo takes the crate root and a name
// list (nothing narrower than the crate), `go test` and `dotnet test` take a
// package/project argument, and pytest, unittest, vitest and jest all take the
// FILE.
const RUN_SCOPES = [
  ["rust", "root"],
  ["go", "package"],
  ["csharp", "package"],
  ["python", "file"],
  ["typescript", "file"],
  ["typescriptreact", "file"],
  ["javascript", "file"],
  ["javascriptreact", "file"],
];

for (const [languageId, scope] of RUN_SCOPES) {
  test(`runScope for ${languageId} is "${scope}"`, () => {
    assert.strictEqual(tddLangFor(languageId).runScope, scope);
  });
}

test("every registered language answers runTargetForTestFile", () => {
  for (const [languageId] of RUN_SCOPES) {
    assert.strictEqual(typeof tddLangFor(languageId).runTargetForTestFile, "function", languageId);
  }
});

// ---- 2. Rust --------------------------------------------------------------

const RUST_CRATE = {
  "/w/Cargo.toml": "[package]\nname = \"w\"\n",
  "/w/src/lib.rs": "",
  "/w/src/deep/a/b/parser.rs": "",
};

test("rust: a file several directories deep resolves to the crate root", () => {
  const placement = ok(tddLangFor("rust").runTargetForTestFile("/w/src/deep/a/b/parser.rs", fakeDeps(RUST_CRATE)));
  assert.strictEqual(placement.runRoot, "/w");
  assert.strictEqual(placement.targetPath, "/w/src/deep/a/b/parser.rs");
  assert.strictEqual(placement.mode, "same-file");
  assert.strictEqual(placement.exists, true);
  // libtest filters by NAME. A package argument would be a second, wrong idea
  // about what cargo takes.
  assert.strictEqual(placement.packageArg, undefined);
  // A run target imports nothing: nothing is being written.
  assert.strictEqual(placement.importLine, undefined);
  assert.strictEqual(placement.packageName, undefined);
});

test("rust: a file AT the crate root resolves to that root", () => {
  const placement = ok(tddLangFor("rust").runTargetForTestFile("/w/build.rs", fakeDeps(RUST_CRATE)));
  assert.strictEqual(placement.runRoot, "/w");
});

test("rust: the NEAREST Cargo.toml wins, so a workspace member runs as itself", () => {
  const files = { ...RUST_CRATE, "/w/member/Cargo.toml": "", "/w/member/src/lib.rs": "" };
  const placement = ok(tddLangFor("rust").runTargetForTestFile("/w/member/src/lib.rs", fakeDeps(files)));
  assert.strictEqual(placement.runRoot, "/w/member");
});

test("rust: no crate refuses, and the detail names Cargo.toml", () => {
  const { reason, detail } = refusal(tddLangFor("rust").runTargetForTestFile("/x/y/parser.rs", fakeDeps({})));
  assert.strictEqual(reason, "no-project-root");
  assert.match(detail, /Cargo\.toml/);
});

// ---- 3. Go ----------------------------------------------------------------

const GO_MODULE = {
  "/m/go.mod": "module example.com/m\n",
  "/m/main_test.go": "package main\n",
  "/m/internal/foo/foo_test.go": "package foo\n",
};

test("go: a nested package resolves to the module root with a relative packageArg", () => {
  const placement = ok(tddLangFor("go").runTargetForTestFile("/m/internal/foo/foo_test.go", fakeDeps(GO_MODULE)));
  assert.strictEqual(placement.runRoot, "/m");
  assert.strictEqual(placement.packageArg, "./internal/foo");
  assert.strictEqual(placement.targetPath, "/m/internal/foo/foo_test.go");
  assert.strictEqual(placement.mode, "same-file");
});

test("go: a file AT the module root takes the packageArg `.`", () => {
  const placement = ok(tddLangFor("go").runTargetForTestFile("/m/main_test.go", fakeDeps(GO_MODULE)));
  assert.strictEqual(placement.runRoot, "/m");
  assert.strictEqual(placement.packageArg, ".");
});

test("go: no module refuses, and the detail names the go.mod that is missing and the file", () => {
  const { reason, detail } = refusal(tddLangFor("go").runTargetForTestFile("/x/y/z_test.go", fakeDeps({})));
  assert.strictEqual(reason, "no-project-root");
  assert.match(detail, /no go\.mod above \/x\/y\/z_test\.go/);
});

// ---- 4. C# ----------------------------------------------------------------

const MSTEST_CSPROJ =
  "<Project>\n  <PropertyGroup><IsTestProject>true</IsTestProject></PropertyGroup>\n" +
  "  <ItemGroup><PackageReference Include=\"MSTest.TestFramework\" Version=\"3.0.0\" /></ItemGroup>\n</Project>\n";

const CS_TREE = {
  "/sln/App/App.csproj": "<Project></Project>\n",
  "/sln/App/Widget.cs": "namespace App;\n",
  "/sln/App/Sub/Sub.csproj": MSTEST_CSPROJ,
  "/sln/App/Sub/Deep/WidgetTests.cs": "namespace App.Sub.Deep;\n",
};

test("csharp: the NEAREST .csproj walking up owns the file, not the outer one", () => {
  const placement = ok(tddLangFor("csharp").runTargetForTestFile("/sln/App/Sub/Deep/WidgetTests.cs", fakeDeps(CS_TREE)));
  assert.strictEqual(placement.runRoot, "/sln/App/Sub");
  // Relative to runRoot, which is how the shipped legs join it back.
  assert.strictEqual(placement.packageArg, "Sub.csproj");
  assert.strictEqual(placement.targetPath, "/sln/App/Sub/Deep/WidgetTests.cs");
});

test("csharp: the detected framework rides on the placement, as it does for placementFor", () => {
  const placement = ok(tddLangFor("csharp").runTargetForTestFile("/sln/App/Sub/Deep/WidgetTests.cs", fakeDeps(CS_TREE)));
  assert.strictEqual(placement.frameworkId, "mstest");
});

test("csharp: a file AT the project directory resolves to that project", () => {
  const files = { ...CS_TREE, "/sln/App/Sub/RootTests.cs": "" };
  const placement = ok(tddLangFor("csharp").runTargetForTestFile("/sln/App/Sub/RootTests.cs", fakeDeps(files)));
  assert.strictEqual(placement.runRoot, "/sln/App/Sub");
});

test("csharp: no project refuses, and the detail names the .csproj that is missing", () => {
  const { reason, detail } = refusal(tddLangFor("csharp").runTargetForTestFile("/x/y/WidgetTests.cs", fakeDeps({})));
  assert.strictEqual(reason, "no-project-root");
  assert.match(detail, /\.csproj/);
});

// ---- 5. Python ------------------------------------------------------------

const PY_PROJECT = {
  "/p/pyproject.toml": "[project]\nname = \"p\"\n",
  "/p/.venv/bin/python": "",
  "/p/test_root.py": "",
  "/p/tests/sub/test_deep.py": "",
};

test("python: a file several directories deep resolves to the project root", () => {
  const placement = ok(tddLangFor("python").runTargetForTestFile("/p/tests/sub/test_deep.py", fakeDeps(PY_PROJECT)));
  assert.strictEqual(placement.runRoot, "/p");
  assert.strictEqual(placement.targetPath, "/p/tests/sub/test_deep.py");
  assert.strictEqual(placement.mode, "same-file");
});

test("python: the project's own interpreter is carried, the way placementFor carries it", () => {
  const placement = ok(tddLangFor("python").runTargetForTestFile("/p/tests/sub/test_deep.py", fakeDeps(PY_PROJECT)));
  assert.strictEqual(placement.interpreter, "/p/.venv/bin/python");
});

test("python: no venv leaves the interpreter absent rather than guessing one", () => {
  const files = { "/p/pyproject.toml": "", "/p/tests/test_deep.py": "" };
  const placement = ok(tddLangFor("python").runTargetForTestFile("/p/tests/test_deep.py", fakeDeps(files)));
  assert.strictEqual(placement.interpreter, undefined);
});

test("python: a file AT the project root resolves to that root", () => {
  const placement = ok(tddLangFor("python").runTargetForTestFile("/p/test_root.py", fakeDeps(PY_PROJECT)));
  assert.strictEqual(placement.runRoot, "/p");
});

test("python: no project refuses, and the detail names every marker looked for", () => {
  const { reason, detail } = refusal(tddLangFor("python").runTargetForTestFile("/x/y/test_z.py", fakeDeps({})));
  assert.strictEqual(reason, "no-project-root");
  assert.match(detail, /pyproject\.toml/);
  assert.match(detail, /setup\.py/);
  assert.match(detail, /tox\.ini/);
});

// ---- 6. TypeScript --------------------------------------------------------

const TS_REPO = {
  "/repo/package.json": "{}\n",
  "/repo/index.test.ts": "",
  "/repo/packages/a/package.json": "{}\n",
  "/repo/packages/a/src/deep/widget.test.ts": "",
};

test("typescript: a file several directories deep resolves to the nearest package root", () => {
  const placement = ok(tddLangFor("typescript").runTargetForTestFile("/repo/packages/a/src/deep/widget.test.ts", fakeDeps(TS_REPO)));
  // The workspace package, NOT the monorepo root: the runner and its config
  // live beside the package.json that is nearest.
  assert.strictEqual(placement.runRoot, "/repo/packages/a");
  assert.strictEqual(placement.targetPath, "/repo/packages/a/src/deep/widget.test.ts");
  assert.strictEqual(placement.mode, "same-file");
});

test("typescript: a file AT the package root resolves to that root", () => {
  const placement = ok(tddLangFor("typescript").runTargetForTestFile("/repo/index.test.ts", fakeDeps(TS_REPO)));
  assert.strictEqual(placement.runRoot, "/repo");
});

test("typescript: no package refuses, and the detail names package.json", () => {
  const { reason, detail } = refusal(tddLangFor("typescript").runTargetForTestFile("/x/y/widget.test.ts", fakeDeps({})));
  assert.strictEqual(reason, "no-project-root");
  assert.match(detail, /package\.json/);
});

test("javascript shares the TypeScript leg, so a .test.js file resolves the same way", () => {
  const files = { "/repo/package.json": "{}\n", "/repo/src/widget.test.js": "" };
  const placement = ok(tddLangFor("javascript").runTargetForTestFile("/repo/src/widget.test.js", fakeDeps(files)));
  assert.strictEqual(placement.runRoot, "/repo");
});

// ---- 7. THE DISTINCTION: placementFor and runTargetForTestFile disagree ----

// The C# shape the seam doc names: `App.Tests` is a test project, and
// `App.Tests.Tests` is a test project that references IT. Contrived on purpose:
// it is the smallest tree where placementFor's answer is legible, and the
// corpus shape (no project references the test project at all) is the test
// below it.
const CS_TESTS_OF_TESTS = {
  "/sln/App/App.csproj": "<Project></Project>\n",
  "/sln/App.Tests/App.Tests.csproj":
    "<Project>\n  <PropertyGroup><IsTestProject>true</IsTestProject></PropertyGroup>\n" +
    "  <ItemGroup>\n    <PackageReference Include=\"MSTest.TestFramework\" Version=\"3.0.0\" />\n" +
    "    <ProjectReference Include=\"..\\App\\App.csproj\" />\n  </ItemGroup>\n</Project>\n",
  "/sln/App.Tests/WidgetTests.cs": "namespace App.Tests;\n",
  "/sln/App.Tests.Tests/App.Tests.Tests.csproj":
    "<Project>\n  <PropertyGroup><IsTestProject>true</IsTestProject></PropertyGroup>\n" +
    "  <ItemGroup>\n    <PackageReference Include=\"MSTest.TestFramework\" Version=\"3.0.0\" />\n" +
    "    <ProjectReference Include=\"..\\App.Tests\\App.Tests.csproj\" />\n  </ItemGroup>\n</Project>\n",
};

test("csharp: placementFor and runTargetForTestFile DISAGREE on a real test file, which is why the member exists", () => {
  const lang = tddLangFor("csharp");
  const deps = fakeDeps(CS_TESTS_OF_TESTS);
  const testFile = "/sln/App.Tests/WidgetTests.cs";

  // placementFor answers "where do NEW tests for this file's functions go", so
  // it walks OUT to a project that tests THIS one and mirrors the file there.
  const forNewTests = ok(lang.placementFor(testFile, "Widget", deps));
  assert.strictEqual(forNewTests.runRoot, "/sln/App.Tests.Tests");
  assert.strictEqual(forNewTests.packageArg, "App.Tests.Tests.csproj");
  assert.notStrictEqual(forNewTests.targetPath, testFile);

  // runTargetForTestFile answers "this file already holds tests, where do I run
  // it from", which is the project the file IS IN.
  const forRunning = ok(lang.runTargetForTestFile(testFile, deps));
  assert.strictEqual(forRunning.runRoot, "/sln/App.Tests");
  assert.strictEqual(forRunning.packageArg, "App.Tests.csproj");
  assert.strictEqual(forRunning.targetPath, testFile);
});

test("csharp: placementFor REFUSES the ordinary test file that runTargetForTestFile runs", () => {
  const lang = tddLangFor("csharp");
  // The corpus shape: nothing references the test project, because nothing
  // tests the tests. Routing a discovered test file through placementFor would
  // report it as unrunnable for a reason that is about WRITING, not running.
  const files = { ...CS_TESTS_OF_TESTS };
  delete files["/sln/App.Tests.Tests/App.Tests.Tests.csproj"];
  const deps = fakeDeps(files);
  const testFile = "/sln/App.Tests/WidgetTests.cs";

  assert.strictEqual(lang.placementFor(testFile, "Widget", deps).ok, false);
  assert.strictEqual(ok(lang.runTargetForTestFile(testFile, deps)).runRoot, "/sln/App.Tests");
});
