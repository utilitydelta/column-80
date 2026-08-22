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

// ---------------------------------------------------------------------------
// The crate layout Rust ACTUALLY uses. Code and its tests share a file, and
// that file is normally not `src/lib.rs` — so the segment the file contributes
// BY BEING a module is on every libtest path inside it, and nothing in the
// file's own text says so. Reading only the text produces a full-SHAPED path
// that is missing its head, `--exact` rides along, and libtest matches nothing.
//
// Measured, cargo 1.96, this exact crate, `cargo test --lib -- --list`:
//
//   geometry::deep::widget_checks::add      placed::widget_checks::add
//   geometry::widget_checks::add            r#loop::widget_checks::add
//   shapes::widget_checks::add              r#match::widget_checks::add
//
// Six layouts in ONE crate on purpose: twelve tests are live, so a path that
// resolves wrong selects zero and a substring filter selects twelve. Only the
// resolved path selects one.
// ---------------------------------------------------------------------------

const LIB_SRC = `pub mod geometry;
pub mod shapes;
#[path = "odd/place.rs"]
pub mod placed;
pub mod r#match;

pub mod r#loop {
    pub fn add(a: i32, b: i32) -> i32 { a + b }

    #[cfg(test)]
    mod widget_checks {
        use super::*;
    }
}
`;

const LAYOUT_ROWS = [
  { label: "a plain file module (src/geometry.rs)", file: "src/geometry.rs", src: `pub mod deep;\n\n${RUST_SRC}`, prefix: "geometry::widget_checks" },
  { label: "a submodule of a file module (src/geometry/deep.rs)", file: "src/geometry/deep.rs", src: RUST_SRC, prefix: "geometry::deep::widget_checks" },
  { label: "a directory module (src/shapes/mod.rs)", file: "src/shapes/mod.rs", src: RUST_SRC, prefix: "shapes::widget_checks" },
  { label: "a #[path] module, whose file name and module name differ (src/odd/place.rs)", file: "src/odd/place.rs", src: RUST_SRC, prefix: "placed::widget_checks" },
  { label: "a RAW-identifier file module (`pub mod r#match;` -> src/match.rs)", file: "src/match.rs", src: RUST_SRC, prefix: "r#match::widget_checks" },
  { label: "a RAW-identifier INLINE module in the crate root (`pub mod r#loop`)", file: "src/lib.rs", src: LIB_SRC, prefix: "r#loop::widget_checks" },
];

function writeLayoutCrate(dir) {
  for (const sub of ["src/geometry", "src/shapes", "src/odd"]) {
    fs.mkdirSync(path.join(dir, ...sub.split("/")), { recursive: true });
  }
  fs.writeFileSync(path.join(dir, "Cargo.toml"), `[package]\nname = "rung59layout"\nversion = "0.0.0"\nedition = "2021"\n`);
  const texts = new Map();
  for (const row of LAYOUT_ROWS) {
    const text = rustFileText(row.src);
    texts.set(row.file, text);
    fs.writeFileSync(path.join(dir, ...row.file.split("/")), text);
  }
  return texts;
}

/** An in-memory crate, so the fallback rows exercise the REAL resolver without
 *  a temp directory. Keys are absolute paths. */
function fakeCrate(files) {
  const map = new Map(Object.entries(files));
  return { readFile: (p) => map.get(p), fileExists: (p) => map.has(p) };
}

function rustCtx(targetPath, crateRoot, files) {
  return {
    placement: { targetPath, exists: true, mode: "same-file", runRoot: crateRoot },
    deps: fakeCrate(files),
  };
}

function csFileText(src = CS_SRC) {
  const placement = { targetPath: "/x/Tests.cs", exists: true, mode: "mirrored", runRoot: "/x" };
  const plan = CS.scaffold({ existingText: src, generatedTests: CS_TESTS, markerId: "Add", placement });
  return src.slice(0, plan.start) + plan.text + src.slice(plan.end);
}

// ---------------------------------------------------------------------------
// Rust: the name the rung filters by
// ---------------------------------------------------------------------------

/** The crate root holding `text`, which is the shape every row below that is
 *  not about layout wants: one file, no file-module segment to resolve. */
function rootCtx(text) {
  return rustCtx("/x/src/lib.rs", "/x", {
    "/x/Cargo.toml": "[package]\nname = \"c\"\n",
    "/x/src/lib.rs": text,
  });
}

test("rust: the generated names carry the DEVELOPER's module name, not a hard-coded `tests`", () => {
  const text = rustFileText();
  const names = RUST.generatedTestNames(text, "add", rootCtx(text));
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
  const text = rustFileText(nested);
  const names = RUST.generatedTestNames(text, "add", rootCtx(text));
  assert.deepStrictEqual(names, ["geometry::widget_checks::add", "geometry::widget_checks::add_more"]);
});

test("rust: a RAW-identifier enclosing `mod` keeps its `r#` — measured, cargo lists `r#loop::widget_checks::add` and `--exact loop::…` matches nothing", () => {
  const raw = `pub mod r#loop {
    pub fn add(a: i32, b: i32) -> i32 { a + b }

    #[cfg(test)]
    mod widget_checks {
        use super::*;
    }
}
`;
  const text = rustFileText(raw);
  const names = RUST.generatedTestNames(text, "add", rootCtx(text));
  assert.deepStrictEqual(names, ["r#loop::widget_checks::add", "r#loop::widget_checks::add_more"]);
  const cmd = RUST.frameworks[0].buildCommand({ targetPath: "/x/src/lib.rs", exists: true, mode: "same-file", runRoot: "/x" }, names);
  assert.ok(cmd.args.includes("--exact"), "a raw segment is still a COMPLETE path, so exactness holds");
});

test("rust: the command is `--exact` over the FULL paths, and the flag sits past the `--` where libtest reads it", () => {
  const text = rustFileText();
  const names = RUST.generatedTestNames(text, "add", rootCtx(text));
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
  const names = RUST.generatedTestNames(orphan, "add", rootCtx(orphan));
  assert.deepStrictEqual(names, ["add"], "bare, because nothing resolved");
  const cmd = RUST.frameworks[0].buildCommand({ targetPath: "/w/src/lib.rs", exists: true, mode: "same-file", runRoot: "/w" }, names);
  assert.ok(!cmd.args.includes("--exact"), "no path, no --exact");
  assert.deepStrictEqual(cmd.args, ["test", "--lib", "--", "add"]);
});

// ---------------------------------------------------------------------------
// Rust: completeness, not shape
// ---------------------------------------------------------------------------

test("rust: with NO crate context the name stays BARE — a file's own module segment is not in its text, so completeness cannot be proven", () => {
  const names = RUST.generatedTestNames(rustFileText(), "add");
  assert.deepStrictEqual(names, ["add", "add_more"]);
  const cmd = RUST.frameworks[0].buildCommand({ targetPath: "/w/src/lib.rs", exists: true, mode: "same-file", runRoot: "/w" }, names);
  assert.ok(!cmd.args.includes("--exact"), "an unproven name keeps the substring filter");
});

test("rust: a file the crate root never DECLARES stays bare — unreachable is not the same as unqualified, and both fall back", () => {
  const text = rustFileText();
  const ctx = rustCtx("/x/src/loose.rs", "/x", {
    "/x/Cargo.toml": "[package]\nname = \"c\"\n",
    "/x/src/lib.rs": "pub mod geometry;\n",
    "/x/src/geometry.rs": "",
    "/x/src/loose.rs": text,
  });
  assert.deepStrictEqual(RUST.generatedTestNames(text, "add", ctx), ["add", "add_more"]);
});

test("rust: a crate with no lib TARGET stays bare — `cargo test --lib` has no root to walk from", () => {
  const text = rustFileText();
  const ctx = rustCtx("/x/src/main.rs", "/x", {
    "/x/Cargo.toml": "[package]\nname = \"c\"\n",
    "/x/src/main.rs": text,
  });
  assert.deepStrictEqual(RUST.generatedTestNames(text, "add", ctx), ["add", "add_more"]);
});

test("rust: two `mod` declarations routing to the SAME file are ambiguous, so the name stays bare rather than guessing one", () => {
  const text = rustFileText();
  const ctx = rustCtx("/x/src/a.rs", "/x", {
    "/x/Cargo.toml": "[package]\nname = \"c\"\n",
    "/x/src/lib.rs": "pub mod a;\n#[path = \"a.rs\"]\npub mod b;\n",
    "/x/src/a.rs": text,
  });
  assert.deepStrictEqual(RUST.generatedTestNames(text, "add", ctx), ["add", "add_more"]);
});

test("rust: `[lib] path` moves the crate root, and the walk starts from where the manifest says", () => {
  const text = rustFileText();
  const ctx = rustCtx("/x/src/geometry.rs", "/x", {
    "/x/Cargo.toml": "[package]\nname = \"c\"\n\n[lib]\npath = \"src/entry.rs\"\n",
    "/x/src/entry.rs": "pub mod geometry;\n",
    "/x/src/geometry.rs": text,
  });
  assert.deepStrictEqual(RUST.generatedTestNames(text, "add", ctx), [
    "geometry::widget_checks::add",
    "geometry::widget_checks::add_more",
  ]);
});

test("rust: the crate ROOT file itself contributes no segment, so its inline module is the whole path", () => {
  const text = rustFileText();
  const ctx = rustCtx("/x/src/lib.rs", "/x", {
    "/x/Cargo.toml": "[package]\nname = \"c\"\n",
    "/x/src/lib.rs": text,
  });
  assert.deepStrictEqual(RUST.generatedTestNames(text, "add", ctx), [
    "widget_checks::add",
    "widget_checks::add_more",
  ]);
});

test("GRADED (cargo): every crate LAYOUT selects exactly one test, and it is the named one", { skip: SKIP_CARGO }, async () => {
  // Twelve tests are live in this crate. A path that resolves wrong selects
  // ZERO, a substring filter selects twelve, and only the resolved path
  // selects one — so `=== 1` catches both failure directions at once.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "v59-p4-layout-"));
  try {
    const texts = writeLayoutCrate(dir);
    for (const row of LAYOUT_ROWS) {
      const target = path.join(dir, ...row.file.split("/"));
      const placed = RUST.placementFor(target, "add", {});
      assert.ok(placed.ok, `${row.label}: the crate places`);
      const names = RUST.generatedTestNames(texts.get(row.file), "add", { placement: placed.placement });
      assert.deepStrictEqual(
        names,
        [`${row.prefix}::add`, `${row.prefix}::add_more`],
        `${row.label}: the resolved libtest path`,
      );
      const cmd = RUST.frameworks[0].buildCommand(placed.placement, names);
      assert.ok(cmd.args.includes("--exact"), `${row.label}: a complete path earns --exact`);
      const res = await runFrameworkTestsAt(RUST.frameworks[0], placed.placement, [names[0]]);
      assert.strictEqual(res.ran, true, `${row.label}: the test binary ran`);
      assert.strictEqual(
        res.failed + res.passed,
        1,
        `${row.label}: exactly one test was selected, got ${res.failed + res.passed}`,
      );
      assert.deepStrictEqual(
        res.cases.map((c) => c.name),
        [`${row.prefix}::add`],
        `${row.label}: and the one selected is the NAMED one`,
      );
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
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

// An ESCAPED identifier is a plain identifier to the CLR: `@` is source syntax
// and VSTest never sees it. A head regex that cannot read `@namespace` drops the
// namespace, the class alone still LOOKS fully qualified, `=` fires, and the
// filter names something no assembly contains. Measured on dotnet 10.0.111:
//   --filter FullyQualifiedName=VerbChecks.Add           -> no test matches
//   --filter FullyQualifiedName=namespace.VerbChecks.Add -> Passed! 1 test
const CS_ESCAPED_SRC = `using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace @namespace
{
    [TestClass]
    public class VerbChecks
    {
    }
}
`;

const CS_ESCAPED_TESTS = `[TestMethod]
public void Add() { Assert.AreEqual(99, 1 + 2); }

[TestMethod]
public void AddMore() { Assert.AreEqual(99, 1 + 3); }
`;

function csEscapedFileText() {
  const placement = { targetPath: "/x/Verbs.cs", exists: true, mode: "mirrored", runRoot: "/x" };
  const plan = CS.scaffold({ existingText: CS_ESCAPED_SRC, generatedTests: CS_ESCAPED_TESTS, markerId: "Add", placement });
  return CS_ESCAPED_SRC.slice(0, plan.start) + plan.text + CS_ESCAPED_SRC.slice(plan.end);
}

test("csharp: an ESCAPED namespace is part of the name — the `@` is source syntax and VSTest never sees it", () => {
  const names = CS.generatedTestNames(csEscapedFileText(), "Add");
  assert.deepStrictEqual(names, ["namespace.VerbChecks.Add", "namespace.VerbChecks.AddMore"]);
});

test("csharp: `where T : class where U : struct` still reads as a constraint, not a type named `where`", () => {
  const constrained = `namespace Falsifier.Widgets
{
    [TestClass]
    public class WidgetChecks<T, U> where T : class where U : struct
    {
        // column80-tests:Add:begin
        [TestMethod]
        public void Add() { }
        // column80-tests:Add:end
    }
}
`;
  // The enclosing type is GENERIC, so the name stays bare and the rung keeps
  // `~`. What matters here is that `where` never became a namespace segment.
  assert.deepStrictEqual(CS.generatedTestNames(constrained, "Add"), ["Add"]);
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

// Sources CLEARED: the restore resolves from the machine's package cache or it
// fails, and a test that reaches the network is not a unit of anything. A box
// without MSTest cached skips rather than lies.
function writeCsProject(dir, assemblyName) {
  fs.writeFileSync(path.join(dir, "nuget.config"), `<configuration><packageSources><clear /></packageSources></configuration>\n`);
  fs.writeFileSync(
    path.join(dir, "t.csproj"),
    `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
    <Nullable>disable</Nullable>
    <IsPackable>false</IsPackable>
    <AssemblyName>${assemblyName}</AssemblyName>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Microsoft.NET.Test.Sdk" Version="17.11.1" />
    <PackageReference Include="MSTest.TestAdapter" Version="3.1.1" />
    <PackageReference Include="MSTest.TestFramework" Version="3.1.1" />
  </ItemGroup>
</Project>
`,
  );
}

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
    const names = RUST.generatedTestNames(fileText, "add", { placement: placed.placement });
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
    writeCsProject(dir, "rung59");
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

test("GRADED (dotnet): an ESCAPED namespace still selects one test — `@namespace` is not part of the name VSTest holds", { skip: SKIP_DOTNET }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "v59-p4-csesc-"));
  try {
    writeCsProject(dir, "rung59esc");
    const targetPath = path.join(dir, "Verbs.cs");
    const fileText = csEscapedFileText();
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
    assert.deepStrictEqual(res.cases.map((c) => c.name), ["Add"], "and the one selected is the NAMED one");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
