// ADVERSARIAL REVIEW - session-v52 phase 3 (`src/core/tightenRatify.ts`).
//
// Every row here is EVIDENCE for a defect claim. Where the claim is about a
// real repository, the row reads that repository; when the path is absent the
// row SKIPS LOUDLY (it prints why and the run reports a skip), because a guard
// that skips silently is worse than one that fails.
//
// These rows are expected RED against the phase-3 build as landed. They are the
// review's exhibits, not a regression suite.
//
// Run: node --test test/adversarial-v52-p3.test.cjs

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "adv-v52-p3",
  `export { ratifyWorkspaceHits, importLineFor, TYPE_ISH_KINDS } from "../src/core/tightenRatify";\n` +
    `export { foldName } from "../src/core/spokenName";\n`
);
test.after(() => cleanup());
const { importLineFor, ratifyWorkspaceHits, foldName } = mod;

const HOME = os.homedir();
const ACME_DB = path.join(HOME, "work/acme/acme-db");
const GLOMMIO = path.join(HOME, "work/glommio/glommio");
const CONTOSO = path.join(HOME, "work/contoso");
const PGX = path.join(HOME, "sandbox/v42-corpus/pgx");
const MOLTBOT = path.join(HOME, "repos/external/moltbot");
const CONTINUE = path.join(HOME, "repos/external/continue");
const LINGBOT_SP = path.join(HOME, "repos/external/lingbot-map/.venv/lib/python3.10/site-packages");

// A real filesystem for ImportPathDeps, with the workspace root the row names.
function realDeps(workspaceRoot) {
  return {
    fileExists: (p) => { try { return fs.existsSync(p); } catch { return false; } },
    readFile: (p) => { try { return fs.readFileSync(p, "utf8"); } catch { return undefined; } },
    workspaceRoot,
  };
}

// An in-memory filesystem, for the rows that do not need a repo.
function fakeDeps(files, workspaceRoot) {
  return {
    fileExists: (p) => Object.prototype.hasOwnProperty.call(files, p),
    readFile: (p) => files[p],
    workspaceRoot,
  };
}

// Loud skip: prints the reason on stdout AND marks the row skipped, so an
// absent corpus can never read as a pass.
function needPaths(ctx, label, ...paths) {
  const missing = paths.filter((p) => !fs.existsSync(p));
  if (missing.length === 0) return false;
  const why = `SKIP (LOUD) ${label}: absent -> ${missing.join(", ")}`;
  console.log(why);
  ctx.skip(why);
  return true;
}

// ===========================================================================
// D1 / D2. C#: `containerName` is a Roslyn DISPLAY STRING, not a namespace.
//
// The contract says "using Namespace; from the hit's containerName, which
// Roslyn fills with the namespace". Measured live against the real Roslyn LS
// over /home/utilitydelta/repos/csharp-scratch (session-v52/spikes/
// adv-p3-cs-live.cjs), workspace/symbol answers:
//
//   name="Stripe"  kind=5   containerName="project Atlas (net10.0)"
//   name="Result"  kind=6   containerName="in Result<T, E> (project Atlas (net10.0))"
//
// `Stripe` really lives in namespace `Atlas` (src/Atlas/Atlas.cs line 1 reads
// `namespace Atlas;`). This module's own csExtraction.ts already records the
// same measurement in prose and says "nothing here parses it".
// ===========================================================================

test("D1 csharp: a real Roslyn containerName renders a `using` that is not C#", () => {
  const files = { "/repo/Atlas/Atlas.cs": "namespace Atlas;\n\npublic class Stripe {}\n" };
  const hit = {
    name: "Stripe",
    kind: 4,
    path: "/repo/Atlas/Atlas.cs",
    containerName: "project Atlas (net10.0)", // verbatim, from the live server
  };
  const out = importLineFor("csharp", hit, "/repo/App/Program.cs", fakeDeps(files, "/repo"));
  assert.notEqual(
    out && out.importLine,
    "using project Atlas (net10.0);",
    "the derived using must not be the provider's display string"
  );
  assert.equal(out && out.importLine, "using Atlas;", "the def file declares `namespace Atlas;`");
});

test("D1b csharp: a nested-type containerName renders an even worse `using`", () => {
  const files = { "/repo/Atlas/Result.cs": "namespace Atlas;\n\npublic readonly struct Result<T, E> {}\n" };
  const hit = {
    name: "Result",
    kind: 22,
    path: "/repo/Atlas/Result.cs",
    containerName: "in Result<T, E> (project Atlas (net10.0))", // verbatim, live
  };
  const out = importLineFor("csharp", hit, "/repo/App/Program.cs", fakeDeps(files, "/repo"));
  assert.equal(out && out.importLine, "using Atlas;");
});

test("D2 csharp: same-scope never fires, because the def side reads the display string", () => {
  // Two files, ONE namespace. Amendment 11 says this is sameScope.
  const files = {
    "/repo/Atlas/Atlas.cs": "namespace Atlas;\n\npublic class Stripe {}\n",
    "/repo/Atlas/Other.cs": "namespace Atlas;\n\npublic class Other {}\n",
  };
  const hit = { name: "Stripe", kind: 4, path: "/repo/Atlas/Atlas.cs", containerName: "project Atlas (net10.0)" };
  const v = ratifyWorkspaceHits("Stripe", [hit], "csharp", "/repo/Atlas/Other.cs", fakeDeps(files, "/repo"));
  assert.equal(v.ok, true);
  assert.equal(v.sameScope, true, "the def and target declare the same namespace, so amendment 11 applies");
});

// ===========================================================================
// D3. Go: an unexported type gets an import line and a qualifier it can never
// be named through. The product's own memberVisibility.ts exists because "a
// private member is an invitation to a guaranteed compile error"; the type-
// level gate has no such filter.
// ===========================================================================

test("D3 go: an unexported type in another package is ratified as reachable", (ctx) => {
  if (needPaths(ctx, "D3 go/pgx", PGX, path.join(PGX, "pgconn/pgconn.go"))) return;
  const defFile = path.join(PGX, "pgconn/pgconn.go");
  assert.ok(/^type pipelineState /m.test(fs.readFileSync(defFile, "utf8")), "fixture check: pgconn declares `pipelineState`");
  const out = importLineFor("go", { name: "pipelineState", kind: 22, path: defFile }, path.join(PGX, "batch.go"), realDeps(PGX));
  assert.equal(
    out,
    undefined,
    `an unexported type is unreachable from another package; got ${JSON.stringify(out)} (the body would write pgconn.pipelineState)`
  );
});

test("D4 go: an external test package yields the test package as the qualifier", (ctx) => {
  if (needPaths(ctx, "D4 go/pgx", PGX, path.join(PGX, "bench_test.go"))) return;
  const defFile = path.join(PGX, "bench_test.go");
  const text = fs.readFileSync(defFile, "utf8");
  assert.ok(/^package pgx_test$/m.test(text), "fixture check: bench_test.go is `package pgx_test`");
  assert.ok(/^type BenchRowDecoder /m.test(text), "fixture check: it declares the EXPORTED type BenchRowDecoder");
  const out = importLineFor("go", { name: "BenchRowDecoder", kind: 10, path: defFile }, path.join(PGX, "pgconn/pgconn.go"), realDeps(PGX));
  assert.equal(
    out,
    undefined,
    `an external test package is not importable; got ${JSON.stringify(out)} (import "…/v5" + qualifier pgx_test names nothing)`
  );
});

test("D5 go: a `package main` file yields an import of a program", (ctx) => {
  const defFile = path.join(PGX, "pgproto3/example/pgfortune/server.go");
  if (needPaths(ctx, "D5 go/pgx main", PGX, defFile)) return;
  assert.ok(/^package main$/m.test(fs.readFileSync(defFile, "utf8")), "fixture check: it is `package main`");
  const out = importLineFor("go", { name: "PgFortuneBackend", kind: 22, path: defFile }, path.join(PGX, "batch.go"), realDeps(PGX));
  assert.equal(out, undefined, `a main package is not importable; got ${JSON.stringify(out)}`);
});

test("D6 go: an internal/ package is imported from outside its boundary", (ctx) => {
  const defFile = path.join(PGX, "pgconn/internal/bgreader/bgreader.go");
  if (needPaths(ctx, "D6 go/pgx internal", PGX, defFile)) return;
  const out = importLineFor("go", { name: "BGReader", kind: 22, path: defFile }, path.join(PGX, "batch.go"), realDeps(PGX));
  // target is at the module root; only packages under pgconn/ may import this.
  assert.equal(
    out,
    undefined,
    `internal/ is only importable from under pgconn/; got ${JSON.stringify(out)}`
  );
});

test("D7 go same-scope: same directory is NOT the same package when a _test file is in it", (ctx) => {
  const defFile = path.join(PGX, "pgconn/pgconn_test.go");
  const targetFile = path.join(PGX, "pgconn/pgconn.go");
  if (needPaths(ctx, "D7 go/pgx same-dir", PGX, defFile, targetFile)) return;
  assert.ok(/^package pgconn_test$/m.test(fs.readFileSync(defFile, "utf8")), "fixture check: def is package pgconn_test");
  assert.ok(/^package pgconn$/m.test(fs.readFileSync(targetFile, "utf8")), "fixture check: target is package pgconn");
  const v = ratifyWorkspaceHits("testConnWrapper", [{ name: "testConnWrapper", kind: 22, path: defFile }], "go", targetFile, realDeps(PGX));
  assert.notEqual(
    v.sameScope,
    true,
    "amendment 11 assumes same directory means same package; pgconn_test and pgconn are two packages, and neither can see the other's types bare"
  );
});

// ===========================================================================
// D8 / D9 / D10. Rust.
// ===========================================================================

test("D8 rust: a type behind a private module gets a `use` rustc rejects (E0603)", (ctx) => {
  const defFile = path.join(GLOMMIO, "glommio/src/controllers/deadline_queue.rs");
  const targetFile = path.join(GLOMMIO, "glommio/src/lib.rs");
  if (needPaths(ctx, "D8 rust/glommio", GLOMMIO, defFile, targetFile)) return;
  const modrs = fs.readFileSync(path.join(GLOMMIO, "glommio/src/controllers/mod.rs"), "utf8");
  assert.ok(/^mod deadline_queue;/m.test(modrs), "fixture check: `mod deadline_queue;` is PRIVATE");
  assert.ok(/^pub use self::deadline_queue::\*;/m.test(modrs), "fixture check: the type is re-exported one level up");
  const out = importLineFor("rust", { name: "DeadlineQueue", kind: 22, path: defFile }, targetFile, realDeps(GLOMMIO));
  assert.equal(
    out && out.importLine,
    "use crate::controllers::DeadlineQueue;",
    "the re-export is the reachable path; the declaring module is private (cargo check: E0603 module `deadline_queue` is private)"
  );
});

test("D9 rust: the def crate is not a dependency of the target crate", (ctx) => {
  const defFile = path.join(ACME_DB, "acme_wire/src/frame/frame_error.rs");
  const targetFile = path.join(ACME_DB, "acme_distributed/src/lib.rs");
  if (needPaths(ctx, "D9 rust/acme", ACME_DB, defFile, targetFile)) return;
  const manifest = fs.readFileSync(path.join(ACME_DB, "acme_distributed/Cargo.toml"), "utf8");
  assert.ok(/\[dev-dependencies\][\s\S]*acme_wire/.test(manifest), "fixture check: acme_wire is a DEV dependency only");
  const out = importLineFor("rust", { name: "FrameError", kind: 9, path: defFile }, targetFile, realDeps(ACME_DB));
  assert.equal(
    out,
    undefined,
    `the target crate cannot link acme_wire; got ${JSON.stringify(out)} (cargo check: E0433 cannot find module or crate)`
  );
});

test("D10 rust: `[lib] name` overrides the package name and the prefix is wrong", (ctx) => {
  const defFile = path.join(ACME_DB, "acme/src/settings_file.rs");
  const targetFile = path.join(ACME_DB, "acme_integration_tests/src/lib.rs");
  if (needPaths(ctx, "D10 rust/acme lib-name", ACME_DB, defFile, targetFile)) return;
  const manifest = fs.readFileSync(path.join(ACME_DB, "acme/Cargo.toml"), "utf8");
  assert.ok(/\[lib\]\s*\nname = "acme_lib"/.test(manifest), "fixture check: [lib] name = acme_lib");
  const out = importLineFor("rust", { name: "SettingsToml", kind: 22, path: defFile }, targetFile, realDeps(ACME_DB));
  assert.equal(
    out && out.importLine,
    "use acme_lib::settings_file::SettingsToml;",
    "the crate is linked as acme_lib (acme/src/main.rs writes `use acme_lib::setup_cmd::run_setup;`)"
  );
});

// ===========================================================================
// D11. Python: a PEP 420 namespace package.
// ===========================================================================

test("D11 python: a namespace package (no __init__.py) truncates the dotted path", (ctx) => {
  const defFile = path.join(LINGBOT_SP, "mpl_toolkits/mplot3d/axes3d.py");
  if (needPaths(ctx, "D11 python/mpl_toolkits", LINGBOT_SP, defFile)) return;
  assert.equal(fs.existsSync(path.join(LINGBOT_SP, "mpl_toolkits/__init__.py")), false, "fixture check: mpl_toolkits is a namespace package");
  const out = importLineFor("python", { name: "Axes3D", kind: 4, path: defFile }, path.join(LINGBOT_SP, "other/thing.py"), realDeps(LINGBOT_SP));
  assert.equal(
    out && out.importLine,
    "from mpl_toolkits.mplot3d.axes3d import Axes3D",
    "`from mplot3d.axes3d import Axes3D` raises ModuleNotFoundError (verified with the venv interpreter)"
  );
});

// ===========================================================================
// D12 / D13. TypeScript.
// ===========================================================================

test("D12 typescript: collapsing /index points the specifier at a SHADOWING sibling file", () => {
  // Resolution order for "./plugins/runtime" is runtime.ts BEFORE runtime/index.ts.
  const files = {
    "/repo/src/plugins/runtime.ts": "export class Other {}\n",
    "/repo/src/plugins/runtime/index.ts": "export class PluginRuntime {}\n",
  };
  const out = importLineFor(
    "typescript",
    { name: "PluginRuntime", kind: 4, path: "/repo/src/plugins/runtime/index.ts" },
    "/repo/src/cli.ts",
    fakeDeps(files, "/repo")
  );
  assert.notEqual(
    out && out.importLine,
    'import { PluginRuntime } from "./plugins/runtime";',
    "./plugins/runtime resolves to runtime.ts, a different file"
  );
});

test("D12b typescript: that layout is real, not hypothetical", (ctx) => {
  const sibling = path.join(MOLTBOT, "src/plugins/runtime.ts");
  const index = path.join(MOLTBOT, "src/plugins/runtime/index.ts");
  if (needPaths(ctx, "D12b ts/moltbot", MOLTBOT, sibling, index)) return;
  assert.notEqual(fs.statSync(sibling).size, fs.statSync(index).size, "the two files are different modules");
});

test("D13 typescript: a monorepo cross-package hit gets a deep relative path", (ctx) => {
  const defFile = path.join(CONTINUE, "packages/config-yaml/src/validation.ts");
  const targetFile = path.join(CONTINUE, "core/config/ConfigHandler.ts");
  if (needPaths(ctx, "D13 ts/continue", CONTINUE, defFile, targetFile)) return;
  assert.ok(
    fs.readFileSync(targetFile, "utf8").includes('from "@continuedev/config-yaml"'),
    "fixture check: the repo imports this package by NAME"
  );
  const out = importLineFor("typescript", { name: "ConfigValidationError", kind: 10, path: defFile }, targetFile, realDeps(CONTINUE));
  assert.equal(
    out && out.importLine,
    'import { ConfigValidationError } from "@continuedev/config-yaml";',
    "a package boundary is not a directory boundary"
  );
});

// ===========================================================================
// D14. The kind numbering has no discriminator, and this repo has two
// transports that disagree (csExtraction.ts: csVscodeSymbolRole vs
// csLspSymbolRole). Measured live: the C# LSP transport reports Class=5,
// Struct=23, Enum=10.
// ===========================================================================

test("D14 kinds: raw-LSP kinds from this repo's own C# transport are misread", () => {
  const files = { "/repo/Atlas/Atlas.cs": "namespace Atlas;\npublic class Stripe {}\n" };
  const deps = fakeDeps(files, "/repo");
  // FLIPPED to the right answer: the fix is the discriminator, so the caller
  // now SAYS which enum it speaks and the raw-LSP numbers resolve.
  const lspClass = ratifyWorkspaceHits("Stripe", [{ name: "Stripe", kind: 5, kindScheme: "lsp", path: "/repo/Atlas/Atlas.cs" }], "csharp", "/repo/App/P.cs", deps);
  const lspStruct = ratifyWorkspaceHits("Result", [{ name: "Result", kind: 23, kindScheme: "lsp", path: "/repo/Atlas/Atlas.cs" }], "csharp", "/repo/App/P.cs", deps);
  // And the same numbers WITHOUT the discriminator still read as vscode's, so
  // the exhibit's original point is kept: 5 is Method there, and refused.
  assert.equal(
    ratifyWorkspaceHits("Stripe", [{ name: "Stripe", kind: 5, path: "/repo/Atlas/Atlas.cs" }], "csharp", "/repo/App/P.cs", deps).ok,
    false,
    "an undeclared scheme is vscode's, where 5 is Method"
  );
  assert.equal(lspClass.ok, true, "LSP SymbolKind.Class is 5; the module reads 5 as vscode's Method and refuses the class");
  assert.equal(lspStruct.ok, true, "LSP SymbolKind.Struct is 23; the module reads 23 as vscode's Event and refuses the struct");
});

// ===========================================================================
// D15. C#: a UTF-8 BOM defeats the namespace parser.
// ===========================================================================

test("D15 csharp: a BOM on the namespace line makes the fallback refuse", () => {
  const files = { "/repo/Data/Readers.cs": "﻿namespace Contoso.DataModel.Readers\n{\n  public class Rootobject {}\n}\n" };
  const out = importLineFor("csharp", { name: "Rootobject", kind: 4, path: "/repo/Data/Readers.cs" }, "/repo/App/P.cs", fakeDeps(files, "/repo"));
  assert.equal(out && out.importLine, "using Contoso.DataModel.Readers;", "a UTF-8 BOM is not part of the namespace name");
});

test("D15b csharp: BOM files with the namespace on line 1 are real", (ctx) => {
  const f = path.join(CONTOSO, "data-processing/dotnet/Contoso.DataModel/Readers/ReaderObjects.cs");
  if (needPaths(ctx, "D15b csharp/contoso", CONTOSO, f)) return;
  const text = fs.readFileSync(f, "utf8");
  assert.equal(text.charCodeAt(0), 0xfeff, "fixture check: this file starts with a UTF-8 BOM");
  const out = importLineFor("csharp", { name: "Rootobject", kind: 4, path: f }, path.join(CONTOSO, "data-processing/dotnet/Contoso.LocalDb/Program.cs"), realDeps(CONTOSO));
  assert.notEqual(out, undefined, "the file plainly declares a namespace on line 1");
});

// ===========================================================================
// D16. Ambiguity: path normalisation does not collapse `.` or `..`.
// ===========================================================================

test("D16 ambiguity: two hits for the SAME file reached by equivalent paths read as ambiguous", () => {
  const files = { "/repo/src/a/b.ts": "export class Widget {}\n" };
  const hits = [
    { name: "Widget", kind: 4, path: "/repo/src/a/b.ts" },
    { name: "Widget", kind: 4, path: "/repo/src/./a/b.ts" },
  ];
  const v = ratifyWorkspaceHits("Widget", hits, "typescript", "/repo/src/main.ts", fakeDeps(files, "/repo"));
  assert.equal(v.ok, true, `one file reached two ways is one type; got ${JSON.stringify(v)}`);
});

test("D16b ambiguity: a `..` segment does the same", () => {
  const files = { "/repo/src/a/b.ts": "export class Widget {}\n" };
  const hits = [
    { name: "Widget", kind: 4, path: "/repo/src/a/b.ts" },
    { name: "Widget", kind: 4, path: "/repo/src/a/../a/b.ts" },
  ];
  const v = ratifyWorkspaceHits("Widget", hits, "typescript", "/repo/src/main.ts", fakeDeps(files, "/repo"));
  assert.equal(v.ok, true, `one file reached two ways is one type; got ${JSON.stringify(v)}`);
});

// ===========================================================================
// D17. C#: a nested block namespace answers with the OUTER one only.
// ===========================================================================

test("D17 csharp: a nested block namespace yields the outer namespace", () => {
  const files = {
    "/repo/Lib/Nested.cs": "namespace Outer\n{\n    namespace Inner\n    {\n        public class Widget {}\n    }\n}\n",
  };
  const out = importLineFor("csharp", { name: "Widget", kind: 4, path: "/repo/Lib/Nested.cs" }, "/repo/App/P.cs", fakeDeps(files, "/repo"));
  assert.equal(out && out.importLine, "using Outer.Inner;", "Widget is Outer.Inner.Widget; `using Outer;` does not bring it into scope");
});

test("D17b csharp: a second namespace in the same file is invisible", () => {
  // FIXTURE CORRECTED, assertion untouched. The original mixed a file-scoped
  // `namespace First;` with a block `namespace Second` in one file, which is
  // CS8955 and does not compile, and the review's own oracle (adv-p3-cs.cjs
  // declsIn) reads that as the nested `First.Second`. Two BLOCK namespaces is
  // the legal form of the same defect and grades identically.
  const files = {
    "/repo/Lib/Two.cs": "namespace First\n{\n    public class A {}\n}\n\nnamespace Second\n{\n    public class Widget {}\n}\n",
  };
  const out = importLineFor("csharp", { name: "Widget", kind: 4, path: "/repo/Lib/Two.cs" }, "/repo/App/P.cs", fakeDeps(files, "/repo"));
  assert.equal(out && out.importLine, "using Second;", "the FIRST namespace in the file is not necessarily the type's");
});

// ===========================================================================
// D18. C#: a partial class split across two files reads as ambiguous. Amendment
// 1 only rescues two survivors in the SAME file.
// ===========================================================================

test("D18 csharp: an EF Core partial class in two files refuses as ambiguous", (ctx) => {
  const dir = path.join(CONTOSO, "data-processing/dotnet/Contoso.LocalDb/Migrations");
  const a = path.join(dir, "20250525043556_InitialCreate.cs");
  const b = path.join(dir, "20250525043556_InitialCreate.Designer.cs");
  if (needPaths(ctx, "D18 csharp/contoso partial", CONTOSO, a, b)) return;
  assert.ok(fs.readFileSync(a, "utf8").includes("partial class InitialCreate"), "fixture check");
  assert.ok(fs.readFileSync(b, "utf8").includes("partial class InitialCreate"), "fixture check");
  const hits = [
    { name: "InitialCreate", kind: 4, path: a, containerName: "Contoso.LocalDb.Migrations" },
    { name: "InitialCreate", kind: 4, path: b, containerName: "Contoso.LocalDb.Migrations" },
  ];
  const v = ratifyWorkspaceHits("InitialCreate", hits, "csharp", path.join(dir, "Other.cs"), realDeps(CONTOSO));
  assert.equal(v.ok, true, `one partial class in two files is one type; got ${JSON.stringify(v)}`);
});

// ===========================================================================
// D19. The fold-collision claim is a Rust number generalised to five
// languages. Go breaks it: the exported/unexported convention makes
// `Options` and `options` one fold key, and BOTH are structs.
// ===========================================================================

test("D19 fold: Go's exported/unexported pairs are TYPE-vs-TYPE collisions", (ctx) => {
  const hugo = path.join(HOME, "sandbox/v23-corpus/hugo");
  if (needPaths(ctx, "D19 fold/hugo", hugo)) return;
  // Every `type X ...` declaration in hugo, folded. A key carrying two
  // spellings here is a collision the KIND filter cannot clear, because both
  // sides are types.
  const byKey = new Map();
  const importableByKey = new Map();
  const stack = [hugo];
  while (stack.length) {
    const dir = stack.pop();
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (!e.name.startsWith(".")) stack.push(p); continue; }
      if (!p.endsWith(".go")) continue;
      const text = fs.readFileSync(p, "utf8");
      const clause = (/^package\s+(\w+)/m.exec(text) || [])[1] || "";
      for (const m of text.matchAll(/^type\s+([A-Za-z_]\w*)\s/gm)) {
        const k = foldName(m[1]);
        if (!byKey.has(k)) byKey.set(k, new Set());
        byKey.get(k).add(m[1]);
        // The population the product can still reach after the export, _test
        // and main gates: an unexported type is not a candidate at all.
        if (!/^[A-Z]/.test(m[1]) || p.endsWith("_test.go") || clause === "main" || clause.endsWith("_test")) continue;
        if (!importableByKey.has(k)) importableByKey.set(k, new Set());
        importableByKey.get(k).add(m[1]);
      }
    }
  }
  const collisions = [...byKey.entries()].filter(([, v]) => v.size > 1);
  // The corpus fact stands and is not asserted away: 37 of 1,216 raw type fold
  // keys in hugo carry two TYPE spellings, so the module's old
  // "every measured collision is a type against a const or a function" was one
  // Rust corpus generalised to five languages.
  assert.ok(collisions.length > 0, "fixture check: hugo has raw type-vs-type fold collisions");
  const reachable = [...importableByKey.entries()].filter(([, v]) => v.size > 1);
  assert.equal(
    reachable.length,
    0,
    `${reachable.length} of ${importableByKey.size} REACHABLE fold keys still collide, e.g. ` +
      reachable.slice(0, 5).map(([k, v]) => `${k}=[${[...v].join(",")}]`).join(" ") +
      `. Raw: ${collisions.length} of ${byKey.size}. The export gate is what clears them.`
  );
});

// ===========================================================================
// D20. `detail` reports "0 hits from the symbol provider" when hits arrived and
// the shape guard dropped them. Amendment 2 wants the developer told how many
// raw hits were filtered and by which filter.
// ===========================================================================

test("D20 detail: malformed hits are reported as no hits at all", () => {
  const hits = [
    { name: "Widget", kind: 4 }, // no path
    { name: "Widget", path: "/repo/src/a.ts" }, // no kind
  ];
  const v = ratifyWorkspaceHits("Widget", hits, "typescript", "/repo/src/main.ts", fakeDeps({}, "/repo"));
  assert.equal(v.ok, false);
  assert.ok(
    !v.detail.includes("0 hits from the symbol provider"),
    `two hits arrived and were dropped by the shape guard; detail reads ${JSON.stringify(v.detail)}`
  );
});
