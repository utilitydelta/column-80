// Phase 4 (roadmap item 59): a test rung scoped to ONE generated function runs
// exactly that function's tests. Two languages filtered by SUBSTRING, so a rung
// scoped to `add` also ran `add_more` and could blame the neighbour.
//
// The contract has TWO halves and both are asserted on every row: the neighbour
// does NOT run, AND the named test DOES. A command that selects nothing passes
// the first half alone, and that is the failure this file exists to catch —
// measured, the obvious flags produce exactly it:
//
//   cargo 1.96      `cargo test --lib -- --exact add`            -> 0 tests
//   dotnet 10.0.111 `dotnet test --filter FullyQualifiedName=Add` -> 0 tests
//
// Exactness needs the RESOLVED name: `widget_checks::add` for libtest, and
// `Falsifier.Widgets.WidgetChecks.Add` for VSTest. The module is deliberately
// NOT called `tests` and the namespace/class are not the defaults, so a
// hard-coded prefix cannot pass these rows.
//
// The live rows drive the REAL toolchains and read the REAL selected count. An
// argv-shape assertion cannot tell `--exact widget_checks::add` from a command
// that selects zero, which is the whole trap.
//
// Run (shape only):  SKIP_LIVE=1 node --test test/impl-v59-p4-scoped-rung.test.cjs
// Run (graded):      node --test test/impl-v59-p4-scoped-rung.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { spawnSync } = require("child_process");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-v59-p4-scoped-rung",
  `export { tddLangFor, frameworkFor } from "../src/core/tddLang";
export { runFrameworkTestsAt } from "../src/core/compilerOracle";\n`
);
const { tddLangFor, frameworkFor, runFrameworkTestsAt } = mod;
test.after(cleanup);

const RUST = tddLangFor("rust");
const CS = tddLangFor("csharp");

const cargoPresent = spawnSync("cargo", ["--version"], { encoding: "utf8" }).status === 0;
const dotnetPresent = spawnSync("dotnet", ["--version"], { encoding: "utf8" }).status === 0;
const SKIP_LIVE = process.env.SKIP_LIVE === "1" ? "SKIP_LIVE=1" : false;
const SKIP_CARGO = SKIP_LIVE || (cargoPresent ? false : "no cargo on PATH");
const SKIP_DOTNET = SKIP_LIVE || (dotnetPresent ? false : "no dotnet SDK on PATH");

// ---------------------------------------------------------------------------
// Fixtures, built through the PRODUCT's own scaffold so the marked region is
// the shape the product really writes. A hand-written region hides the break.
// ---------------------------------------------------------------------------

// A developer's own test module, named by the developer. `widget_checks` is the
// point: a fix that hard-codes `tests::` selects zero tests here.
const RUST_SRC = `pub fn add(a: i32, b: i32) -> i32 { a + b }

#[cfg(test)]
mod widget_checks {
    use super::*;
}
`;

// Both tests FAIL on purpose. libtest and the TRX both name a FAILED case, so
// "exactly one ran and it was the named one" is readable from either runner
// without depending on which of them enumerates passing tests (C# does not).
const RUST_TESTS = `#[test]
fn add() { assert_eq!(super::add(1, 2), 99); }
#[test]
fn add_more() { assert_eq!(super::add(1, 3), 99); }
`;

function rustFileText(src = RUST_SRC) {
  const placement = { targetPath: "/x/src/lib.rs", exists: true, mode: "same-file", runRoot: "/x" };
  const plan = RUST.scaffold({ existingText: src, generatedTests: RUST_TESTS, markerId: "add", placement });
  return src.slice(0, plan.start) + plan.text + src.slice(plan.end);
}

const CS_SRC = `using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Falsifier.Widgets
{
    [TestClass]
    public class WidgetChecks
    {
    }
}
`;

const CS_TESTS = `[TestMethod]
public void Add() { Assert.AreEqual(99, 1 + 2); }

[TestMethod]
public void AddMore() { Assert.AreEqual(99, 1 + 3); }
`;

function csFileText(src = CS_SRC) {
  const placement = { targetPath: "/x/Tests.cs", exists: true, mode: "mirrored", runRoot: "/x" };
  const plan = CS.scaffold({ existingText: src, generatedTests: CS_TESTS, markerId: "Add", placement });
  return src.slice(0, plan.start) + plan.text + src.slice(plan.end);
}

// ---------------------------------------------------------------------------
// Rust: the name the rung filters by
// ---------------------------------------------------------------------------

test("rust: the generated names carry the DEVELOPER's module name, not a hard-coded `tests`", () => {
  const names = RUST.generatedTestNames(rustFileText(), "add");
  assert.deepStrictEqual(names, ["widget_checks::add", "widget_checks::add_more"]);
});

test("rust: an enclosing `mod` is part of the libtest path — measured, `cargo test -- --list` prints `geometry::widget_checks::add`", () => {
  const nested = `pub mod geometry {
    pub fn add(a: i32, b: i32) -> i32 { a + b }

    #[cfg(test)]
    mod widget_checks {
        use super::*;
    }
}
`;
  const names = RUST.generatedTestNames(rustFileText(nested), "add");
  assert.deepStrictEqual(names, ["geometry::widget_checks::add", "geometry::widget_checks::add_more"]);
});

test("rust: the command is `--exact` over the FULL paths, and the flag sits past the `--` where libtest reads it", () => {
  const names = RUST.generatedTestNames(rustFileText(), "add");
  const cmd = RUST.frameworks[0].buildCommand({ targetPath: "/w/src/lib.rs", exists: true, mode: "same-file", runRoot: "/w" }, names);
  assert.deepStrictEqual(cmd.args, [
    "test",
    "--lib",
    "--",
    "--exact",
    "widget_checks::add",
    "widget_checks::add_more",
  ]);
});

test("rust: a name with NO resolved path never gets `--exact` — that pair runs zero tests, which is worse than over-selecting", () => {
  // Markers outside any module: nothing encloses the region, so there is no
  // path to be exact about and the substring filter is the honest fallback.
  const orphan = `// column80-tests:add:begin
#[test]
fn add() {}
// column80-tests:add:end
`;
  const names = RUST.generatedTestNames(orphan, "add");
  assert.deepStrictEqual(names, ["add"], "bare, because nothing resolved");
  const cmd = RUST.frameworks[0].buildCommand({ targetPath: "/w/src/lib.rs", exists: true, mode: "same-file", runRoot: "/w" }, names);
  assert.ok(!cmd.args.includes("--exact"), "no path, no --exact");
  assert.deepStrictEqual(cmd.args, ["test", "--lib", "--", "add"]);
});

// ---------------------------------------------------------------------------
// C#: the name the rung filters by
// ---------------------------------------------------------------------------

function csFramework() {
  return CS.frameworks.find((f) => f.id === "mstest");
}

const CS_PLACEMENT = {
  targetPath: "/w/Tests.cs",
  exists: true,
  mode: "mirrored",
  runRoot: "/w",
  packageArg: "/w/t.csproj",
  frameworkId: "mstest",
};

test("csharp: the generated names carry namespace and class, which is what `FullyQualifiedName=` matches", () => {
  const names = CS.generatedTestNames(csFileText(), "Add");
  assert.deepStrictEqual(names, ["Falsifier.Widgets.WidgetChecks.Add", "Falsifier.Widgets.WidgetChecks.AddMore"]);
});

test("csharp: a NESTED test class is joined with `+` — measured, `Ns.Outer.Inner.Add` matches nothing and `Ns.Outer+Inner.Add` matches one", () => {
  // Markers placed by hand: `csScaffold` extends the last TOP-LEVEL class, so it
  // never writes a region into a nested one. A file can still arrive in this
  // shape (the developer moved the class), and the resolved name has to be the
  // CLR one or the rung selects nothing.
  const nested = `using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Falsifier.Widgets
{
    public class Outer
    {
        [TestClass]
        public class WidgetChecks
        {
            // column80-tests:Add:begin
            [TestMethod]
            public void Add() { Assert.AreEqual(99, 1 + 2); }

            [TestMethod]
            public void AddMore() { Assert.AreEqual(99, 1 + 3); }
            // column80-tests:Add:end
        }
    }
}
`;
  const names = CS.generatedTestNames(nested, "Add");
  assert.deepStrictEqual(names, [
    "Falsifier.Widgets.Outer+WidgetChecks.Add",
    "Falsifier.Widgets.Outer+WidgetChecks.AddMore",
  ]);
});

test("csharp: the filter switches to `=` only for a resolved name; both halves land together or the rung selects nothing", () => {
  const names = CS.generatedTestNames(csFileText(), "Add");
  const cmd = csFramework().buildCommand(CS_PLACEMENT, names);
  const filter = cmd.args[cmd.args.indexOf("--filter") + 1];
  assert.strictEqual(
    filter,
    "FullyQualifiedName=Falsifier.Widgets.WidgetChecks.Add|FullyQualifiedName=Falsifier.Widgets.WidgetChecks.AddMore",
  );
});

test("csharp: an unresolved name keeps `~` — `=Add` against a bare name matches nothing on VSTest 18", () => {
  const orphan = `// column80-tests:Add:begin
[TestMethod]
public void Add() { }
// column80-tests:Add:end
`;
  const names = CS.generatedTestNames(orphan, "Add");
  assert.deepStrictEqual(names, ["Add"], "bare, because no class encloses the region");
  const cmd = csFramework().buildCommand(CS_PLACEMENT, names);
  assert.strictEqual(cmd.args[cmd.args.indexOf("--filter") + 1], "FullyQualifiedName~Add");
});

// ---------------------------------------------------------------------------
// The graded falsifier: REAL runners, REAL selected counts
// ---------------------------------------------------------------------------

test("GRADED (cargo): the rung for `add` runs exactly one test, and it is `add` — not zero, not the neighbour", { skip: SKIP_CARGO }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "v59-p4-rust-"));
  try {
    fs.writeFileSync(path.join(dir, "Cargo.toml"), `[package]\nname = "rung59"\nversion = "0.0.0"\nedition = "2021"\n`);
    fs.mkdirSync(path.join(dir, "src"));
    const libPath = path.join(dir, "src", "lib.rs");
    const fileText = rustFileText();
    fs.writeFileSync(libPath, fileText);

    const placed = RUST.placementFor(libPath, "add", {});
    assert.ok(placed.ok, "the scratch crate places");
    const names = RUST.generatedTestNames(fileText, "add");
    const res = await runFrameworkTestsAt(RUST.frameworks[0], placed.placement, [names[0]]);

    assert.ok(res, "the rung produced a result");
    assert.strictEqual(res.ran, true, "the test binary ran");
    assert.strictEqual(res.failed + res.passed, 1, `exactly one test was selected, got ${res.failed + res.passed}`);
    assert.deepStrictEqual(
      res.cases.map((c) => c.name),
      ["widget_checks::add"],
      "and the one selected is the NAMED one",
    );

    // The rung usually carries SEVERAL names, and `--exact` is one flag over
    // all of them. If it did not OR, a two-test rung would select one test or
    // none — the same silence, arriving through the multi-name door.
    const both = await runFrameworkTestsAt(RUST.frameworks[0], placed.placement, names);
    assert.deepStrictEqual(
      both.cases.map((c) => c.name).sort(),
      ["widget_checks::add", "widget_checks::add_more"],
      "--exact OR-s across every filter past the separator",
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("GRADED (dotnet): the rung for `Add` runs exactly one test, and it is `Add` — not zero, not `AddMore`", { skip: SKIP_DOTNET }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "v59-p4-cs-"));
  try {
    // Sources CLEARED: the restore resolves from the machine's package cache or
    // it fails here, and a test that reaches the network is not a unit of
    // anything. A box without MSTest cached skips rather than lies.
    fs.writeFileSync(path.join(dir, "nuget.config"), `<configuration><packageSources><clear /></packageSources></configuration>\n`);
    fs.writeFileSync(
      path.join(dir, "t.csproj"),
      `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
    <Nullable>disable</Nullable>
    <IsPackable>false</IsPackable>
    <AssemblyName>rung59</AssemblyName>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Microsoft.NET.Test.Sdk" Version="17.11.1" />
    <PackageReference Include="MSTest.TestAdapter" Version="3.1.1" />
    <PackageReference Include="MSTest.TestFramework" Version="3.1.1" />
  </ItemGroup>
</Project>
`,
    );
    const targetPath = path.join(dir, "Tests.cs");
    const fileText = csFileText();
    fs.writeFileSync(targetPath, fileText);

    const restore = spawnSync("dotnet", ["restore"], { cwd: dir, encoding: "utf8", timeout: 300000 });
    if (restore.status !== 0) {
      t.skip(`offline dotnet restore failed (MSTest 3.1.1 / Test.Sdk 17.11.1 not cached): ${(restore.stdout || "").trim().split("\n").pop()}`);
      return;
    }

    const names = CS.generatedTestNames(fileText, "Add");
    const placement = { targetPath, exists: true, mode: "mirrored", runRoot: dir, packageArg: path.join(dir, "t.csproj"), frameworkId: "mstest" };
    const res = await runFrameworkTestsAt(csFramework(), placement, [names[0]]);

    assert.ok(res, "the rung produced a result");
    assert.notStrictEqual(res.filterMatchedNothing, true, "the filter selected SOMETHING — the half a zero-test command fakes");
    assert.strictEqual(res.ran, true, "the run happened");
    assert.strictEqual(res.failed + res.passed, 1, `exactly one test was selected, got ${res.failed + res.passed}`);
    assert.deepStrictEqual(
      res.cases.map((c) => c.name),
      ["Add"],
      "and the one selected is the NAMED one",
    );

    // `FullyQualifiedName=A|FullyQualifiedName=B` is what a real rung sends,
    // and VSTest's `|` has to OR two EXACT clauses. If it did not, every
    // multi-test rung would select nothing.
    const both = await runFrameworkTestsAt(csFramework(), placement, names);
    assert.strictEqual(both.failed + both.passed, 2, `both names select both tests, got ${both.failed + both.passed}`);
    assert.deepStrictEqual(both.cases.map((c) => c.name).sort(), ["Add", "AddMore"], "the OR is over exact names");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
