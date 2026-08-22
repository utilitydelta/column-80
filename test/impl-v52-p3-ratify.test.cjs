// IMPLEMENTER (white-box) - session-v52 phase 3: the existence gate's tier 2.
// `src/core/tightenRatify.ts` judges what a workspace symbol provider returned
// for one candidate, and derives the import line the target file would need.
//
// The phase contract set the surface; the phase triage was the adversarial
// review that graded the first build against `cargo check`, `go list`, the
// CPython interpreter, `tsc` and a live Roslyn server, and every gate below
// traces to one of its 20 defects. The graded result is in
// `docs/architecture/tighten-doc-comment.md`, "`importLineFor`, graded". A blind
// oracle tests the same surface from the contract alone; this file tests the
// seams neither names.
//
// PRECISION IS THE SHIP CONDITION HERE, so most of these rows assert a REFUSAL.
// An import line that does not compile hands the model a type it will name
// confidently and fail to import, which manufactures roadmap item 48's failure
// rather than suffering it. A refusal is a channel line and a strip.
//
// Run: SKIP_LIVE=1 node --test test/impl-v52-p3-ratify.test.cjs

const test = require("node:test");
const assert = require("node:assert/strict");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-v52-p3-ratify",
  `export {
  RATIFY_QUERY_CAP,
  TYPE_ISH_KINDS,
  importLineFor,
  ratifyWorkspaceHits,
} from "../src/core/tightenRatify";\n`,
);
const { RATIFY_QUERY_CAP, TYPE_ISH_KINDS, importLineFor, ratifyWorkspaceHits } = mod;
test.after(cleanup);

// ---------------------------------------------------------------- helpers

// A synthetic fs. `files` may be a Set of existing paths or an object of
// path -> text (which also exists). Deliberately NOT normalising: the module
// under test must hand these deps posix paths already.
function fsOf(files, contents = {}, workspaceRoot) {
  const set = files instanceof Set ? files : new Set(Object.keys(files));
  const text = files instanceof Set ? contents : { ...files, ...contents };
  for (const k of Object.keys(text)) set.add(k);
  return {
    fileExists: (p) => set.has(p),
    readFile: (p) => (p in text ? text[p] : undefined),
    workspaceRoot,
  };
}

// vscode.SymbolKind, 0-indexed (the numbers csExtraction's role mapper uses).
const CLASS = 4;
const ENUM = 9;
const INTERFACE = 10;
const FUNCTION = 11;
const VARIABLE = 12;
const CONSTANT = 13;
const STRUCT = 22;
const TYPE_PARAMETER = 25;
const METHOD = 5;

const hit = (name, path, kind = CLASS, containerName) => ({ name, path, kind, kindScheme: "vscode", containerName });

// ---------------------------------------------------------------- kinds

test("TYPE_ISH_KINDS is exactly the five type kinds, 0-indexed vscode numbering", () => {
  for (const k of [CLASS, STRUCT, INTERFACE, ENUM, TYPE_PARAMETER]) {
    assert.ok(TYPE_ISH_KINDS.has(k), `kind ${k} should be type-ish`);
  }
  for (const k of [FUNCTION, CONSTANT, VARIABLE, METHOD, 6, 7, 21, 1, 2, 3]) {
    assert.ok(!TYPE_ISH_KINDS.has(k), `kind ${k} should not be type-ish`);
  }
  assert.equal(TYPE_ISH_KINDS.size, 5);
});

test("RATIFY_QUERY_CAP admits the full nine-variant sweep", () => {
  assert.equal(typeof RATIFY_QUERY_CAP, "number");
  assert.ok(Number.isInteger(RATIFY_QUERY_CAP) && RATIFY_QUERY_CAP >= 9);
});

// D14. Two transports in THIS repo disagree about the numbering, and the old
// module read one of them by coincidence.
const CS_ONE = { "/repo/Atlas/Atlas.cs": "namespace Atlas;\npublic class Stripe {}\n" };

test("kindScheme lsp: the raw-LSP numbers resolve to the same five kinds", () => {
  const deps = fsOf(CS_ONE, {}, "/repo");
  const ratify = (kind, kindScheme) =>
    ratifyWorkspaceHits("Stripe", [{ name: "Stripe", kind, kindScheme, path: "/repo/Atlas/Atlas.cs" }], "csharp", "/repo/App/P.cs", deps).ok;
  // LSP Class=5, Enum=10, Interface=11, Struct=23, TypeParameter=26.
  for (const k of [5, 10, 11, 23, 26]) {
    assert.equal(ratify(k, "lsp"), true, `LSP kind ${k} is a type`);
  }
  // LSP Method=6, Function=12, Constant=14, Variable=13.
  for (const k of [6, 12, 14, 13]) {
    assert.equal(ratify(k, "lsp"), false, `LSP kind ${k} is not a type`);
  }
});

test("kindScheme vscode: 5 is Method and is refused, which is what 'lsp' fixes", () => {
  const deps = fsOf(CS_ONE, {}, "/repo");
  assert.equal(
    ratifyWorkspaceHits("Stripe", [{ name: "Stripe", kind: 5, kindScheme: "vscode", path: "/repo/Atlas/Atlas.cs" }], "csharp", "/repo/App/P.cs", deps).ok,
    false,
  );
  // An absent scheme reads as vscode's, the numbering the vscode layer speaks.
  assert.equal(
    ratifyWorkspaceHits("Stripe", [{ name: "Stripe", kind: 5, path: "/repo/Atlas/Atlas.cs" }], "csharp", "/repo/App/P.cs", deps).ok,
    false,
  );
  assert.equal(
    ratifyWorkspaceHits("Stripe", [{ name: "Stripe", kind: 4, path: "/repo/Atlas/Atlas.cs" }], "csharp", "/repo/App/P.cs", deps).ok,
    true,
  );
});

// ---------------------------------------------------- the fuzzy provider

const TS_TARGET = "/repo/src/app.ts";
const TS_FS = fsOf(new Set(), {}, "/repo");

test("ship condition 5: a fuzzy provider result ratifies exactly one name", () => {
  const v = ratifyWorkspaceHits(
    "ClientSet",
    [
      hit("ClientSetBuilder", "/repo/src/core/builder.ts"),
      hit("ClientSets", "/repo/src/core/sets.ts"),
      hit("client_set", "/repo/src/core/clientSet.ts", FUNCTION),
      hit("ClientSet", "/repo/src/core/clientSet.ts"),
    ],
    "typescript",
    TS_TARGET,
    TS_FS,
  );
  assert.equal(v.ok, true);
  assert.equal(v.tier, 2);
  assert.equal(v.identifier, "ClientSet");
  assert.equal(v.path, "/repo/src/core/clientSet.ts");
  assert.equal(v.importLine, 'import { ClientSet } from "./core/clientSet";');
  assert.equal(v.qualifier, undefined);
});

test("amendment 3: the verdict carries the HIT's spelling, not the candidate's", () => {
  const v = ratifyWorkspaceHits("clientset", [hit("ClientSet", "/repo/src/core/clientSet.ts")], "typescript", TS_TARGET, TS_FS);
  assert.equal(v.identifier, "ClientSet");
});

// ------------------------------------------------------------- refusals

test("no hits at all: not-in-workspace, detail names the word and the tier", () => {
  const v = ratifyWorkspaceHits("ClientSet", [], "typescript", TS_TARGET, TS_FS);
  assert.equal(v.ok, false);
  assert.equal(v.reason, "not-in-workspace");
  assert.match(v.detail, /ClientSet/);
  assert.match(v.detail, /tier 2/);
  assert.match(v.detail, /0 hits from the symbol provider/);
});

test("amendment 2: filters emptied the hits, and the detail says which filter", () => {
  const v = ratifyWorkspaceHits(
    "ClientSet",
    [
      hit("ClientSetBuilder", "/repo/a.ts"),
      hit("ClientSets", "/repo/b.ts"),
      hit("client_set", "/repo/c.ts", FUNCTION),
      hit("CLIENT_SET", "/repo/d.ts", CONSTANT),
    ],
    "typescript",
    TS_TARGET,
    TS_FS,
  );
  assert.equal(v.reason, "not-in-workspace");
  assert.match(v.detail, /4 hits/);
  assert.match(v.detail, /2 dropped by fold key/);
  assert.match(v.detail, /2 dropped by kind/);
});

test("D20: hits that arrived malformed are reported as malformed, not as none", () => {
  const v = ratifyWorkspaceHits(
    "Widget",
    [{ name: "Widget", kind: 4 }, { name: "Widget", path: "/repo/src/a.ts" }, null],
    "typescript",
    "/repo/src/main.ts",
    TS_FS,
  );
  assert.equal(v.reason, "not-in-workspace");
  assert.ok(!v.detail.includes("0 hits from the symbol provider"), v.detail);
  assert.match(v.detail, /3 hits/);
  assert.match(v.detail, /3 dropped as malformed/);
});

test("ship condition 4: two type hits in different modules refuse and name both", () => {
  const v = ratifyWorkspaceHits(
    "ClientSet",
    [hit("ClientSet", "/repo/src/a/clientSet.ts"), hit("ClientSet", "/repo/src/b/clientSet.ts")],
    "typescript",
    TS_TARGET,
    TS_FS,
  );
  assert.equal(v.reason, "ambiguous");
  assert.match(v.detail, /a\/clientSet\.ts/);
  assert.match(v.detail, /b\/clientSet\.ts/);
});

test("amendment 1: two survivors in the SAME file are one type", () => {
  const files = { "/repo/src/model.cs": "namespace Contoso.Sensors;\npublic partial class Reading { }\n" };
  const v = ratifyWorkspaceHits(
    "Reading",
    [hit("Reading", "/repo/src/model.cs"), hit("Reading", "/repo/src/model.cs")],
    "csharp",
    "/repo/src/app.cs",
    fsOf(files),
  );
  assert.equal(v.ok, true);
  assert.equal(v.importLine, "using Contoso.Sensors;");
});

test("D17: two survivors that produce the SAME import line are one type", () => {
  // The EF Core shape: `X.cs` and `X.Designer.cs`, one partial class, one
  // namespace. Amendment 1 only rescued the same FILE.
  const files = {
    "/repo/M/InitialCreate.cs": "namespace Contoso.Migrations;\npublic partial class InitialCreate { }\n",
    "/repo/M/InitialCreate.Designer.cs": "namespace Contoso.Migrations;\npublic partial class InitialCreate { }\n",
  };
  const v = ratifyWorkspaceHits(
    "InitialCreate",
    [hit("InitialCreate", "/repo/M/InitialCreate.cs"), hit("InitialCreate", "/repo/M/InitialCreate.Designer.cs")],
    "csharp",
    "/repo/App/P.cs",
    fsOf(files),
  );
  assert.equal(v.ok, true);
  assert.equal(v.importLine, "using Contoso.Migrations;");
});

test("D17: two files in DIFFERENT namespaces are still two types", () => {
  const files = {
    "/repo/A/Widget.cs": "namespace Contoso.A;\npublic class Widget { }\n",
    "/repo/B/Widget.cs": "namespace Contoso.B;\npublic class Widget { }\n",
  };
  const v = ratifyWorkspaceHits(
    "Widget",
    [hit("Widget", "/repo/A/Widget.cs"), hit("Widget", "/repo/B/Widget.cs")],
    "csharp",
    "/repo/App/P.cs",
    fsOf(files),
  );
  assert.equal(v.reason, "ambiguous");
});

test("D15: one file reached by two spellings of its path is one type", () => {
  const v = ratifyWorkspaceHits(
    "Widget",
    [hit("Widget", "/repo/src/a/b.ts"), hit("Widget", "/repo/src/./a/b.ts"), hit("Widget", "/repo/src/a/../a/b.ts")],
    "typescript",
    "/repo/src/main.ts",
    TS_FS,
  );
  assert.equal(v.ok, true);
  assert.equal(v.path, "/repo/src/a/b.ts");
});

test("D5: an UNREACHABLE survivor is not a candidate, so it cannot make one ambiguous", () => {
  // Go's exported/unexported convention: `Page` and `page` are one fold key
  // with a type on both sides, and only one of them can be named at all.
  const files = {
    "/repo/go.mod": "module example.com/mod\n",
    "/repo/page/page.go": "package page\ntype Page struct{}\ntype page struct{}\n",
  };
  const v = ratifyWorkspaceHits(
    "Page",
    [hit("page", "/repo/page/page.go", STRUCT), hit("Page", "/repo/other/p.go", STRUCT)],
    "go",
    "/repo/main.go",
    fsOf(files, { "/repo/other/p.go": "package other\n" }, "/repo"),
  );
  assert.equal(v.ok, true);
  assert.equal(v.identifier, "Page");
});

test("amendment 8: two survivors that BOTH derive nothing stay a refusal to pick", () => {
  const v = ratifyWorkspaceHits(
    "Order",
    [hit("Order", "/repo/a/order.rs", STRUCT), hit("Order", "/repo/b/order.rs", STRUCT)],
    "rust",
    "/repo/a/main.rs",
    fsOf(new Set()),
  );
  assert.equal(v.reason, "ambiguous");
});

test("resolves but no import path derivable: no-import-path, and it names the file", () => {
  const v = ratifyWorkspaceHits("Order", [hit("Order", "/repo/a/order.rs", STRUCT)], "rust", "/repo/a/main.rs", fsOf(new Set()));
  assert.equal(v.reason, "no-import-path");
  assert.match(v.detail, /Order/);
  assert.match(v.detail, /tier 2/);
  assert.match(v.detail, /order\.rs/);
});

test("a hit in the target file itself is tier 1: a file does not import itself", () => {
  const v = ratifyWorkspaceHits("ClientSet", [hit("ClientSet", "/repo/src/app.ts")], "typescript", TS_TARGET, TS_FS);
  assert.equal(v.tier, 1);
  assert.equal(v.importLine, undefined);
});

test("never throws, whatever the provider or the caller hands it", () => {
  const junk = [
    () => ratifyWorkspaceHits(undefined, undefined, undefined, undefined, undefined),
    () => ratifyWorkspaceHits("", [], "typescript", TS_TARGET, TS_FS),
    () => ratifyWorkspaceHits("A", [null, {}, { name: "A" }, { path: "/x.ts" }], "typescript", TS_TARGET, TS_FS),
    () => ratifyWorkspaceHits("A", [hit("A", "/repo/a.ts")], "klingon", TS_TARGET, TS_FS),
    () =>
      ratifyWorkspaceHits("A", [hit("A", "/repo/a.ts")], "typescript", TS_TARGET, {
        fileExists: () => {
          throw new Error("fs blew up");
        },
        readFile: () => {
          throw new Error("fs blew up");
        },
      }),
    () => importLineFor("go", null, null, null),
    () => importLineFor(null, hit("A", "/repo/a.go", STRUCT), "/repo/b.go", fsOf(new Set())),
    () => importLineFor("rust", hit("A", "/repo/a.rs", STRUCT), "/repo/b.rs", { fileExists: () => true, readFile: () => undefined }),
  ];
  for (const [i, f] of junk.entries()) {
    assert.doesNotThrow(f, `case ${i}`);
  }
});

test("an unregistered language has no import row, so tier 2 refuses", () => {
  assert.equal(ratifyWorkspaceHits("A", [hit("A", "/repo/a.txt")], "klingon", "/repo/b.txt", fsOf(new Set())).reason, "no-import-path");
});

// -------------------------------------------------------- rust import row

// A synthetic crate with a REAL module tree, because the visibility walk reads
// every `mod` declaration between the crate root and the def file.
const PG = "/repo/crates/pg";
const pgFiles = (over = {}) =>
  fsOf(
    {
      [`${PG}/Cargo.toml`]: '[package]\nname = "pg"\n',
      [`${PG}/src/lib.rs`]: "pub mod domain;\npub mod internals;\n",
      [`${PG}/src/domain/mod.rs`]: "pub mod orders;\n",
      [`${PG}/src/domain/orders.rs`]: "pub struct Order {}\npub(crate) struct Ledger {}\nstruct Hidden {}\n",
      [`${PG}/src/tdd.rs`]: "",
      ...over,
    },
    {},
    "/repo",
  );
const PG_TARGET = `${PG}/src/tdd.rs`;

test("rust: a public module chain derives the use line", () => {
  assert.deepEqual(importLineFor("rust", hit("Order", `${PG}/src/domain/orders.rs`, STRUCT), PG_TARGET, pgFiles()), {
    importLine: "use crate::domain::orders::Order;",
  });
});

test("D3 rust: a private module in the chain is E0603, so it refuses", () => {
  const deps = pgFiles({ [`${PG}/src/domain/mod.rs`]: "mod orders;\n" });
  assert.equal(importLineFor("rust", hit("Order", `${PG}/src/domain/orders.rs`, STRUCT), PG_TARGET, deps), undefined);
});

test("D3 rust: the re-export is found before refusing, and it shortens the path", () => {
  // The glommio shape: `mod deadline_queue;` beside `pub use self::…::*;`.
  const deps = pgFiles({ [`${PG}/src/domain/mod.rs`]: "mod orders;\npub use self::orders::*;\n" });
  assert.equal(
    importLineFor("rust", hit("Order", `${PG}/src/domain/orders.rs`, STRUCT), PG_TARGET, deps).importLine,
    "use crate::domain::Order;",
  );
  const named = pgFiles({ [`${PG}/src/domain/mod.rs`]: "mod orders;\npub use self::orders::{Order, Ledger};\n" });
  assert.equal(
    importLineFor("rust", hit("Order", `${PG}/src/domain/orders.rs`, STRUCT), PG_TARGET, named).importLine,
    "use crate::domain::Order;",
  );
});

test("rust: a private TYPE is refused even when every module is public", () => {
  assert.equal(importLineFor("rust", hit("Hidden", `${PG}/src/domain/orders.rs`, STRUCT), PG_TARGET, pgFiles()), undefined);
});

test("rust: pub(crate) is reachable inside the crate", () => {
  assert.equal(
    importLineFor("rust", hit("Ledger", `${PG}/src/domain/orders.rs`, STRUCT), PG_TARGET, pgFiles()).importLine,
    "use crate::domain::orders::Ledger;",
  );
});

test("rust: an undeclared module (a #[path] or a cfg tree) cannot be verified, so it refuses", () => {
  const deps = pgFiles({ [`${PG}/src/lib.rs`]: "// no mod declaration at all\n" });
  assert.equal(importLineFor("rust", hit("Order", `${PG}/src/domain/orders.rs`, STRUCT), PG_TARGET, deps), undefined);
});

// Two crates, so the dependency check has something to read.
const ATLAS = "/repo/crates/atlas";
const wsFiles = (targetManifest, over = {}) =>
  fsOf(
    {
      [`${ATLAS}/Cargo.toml`]: '[package]\nname = "atlas"\n\n[lib]\nname = "atlas_lib"\n',
      [`${ATLAS}/src/lib.rs`]: "pub mod geo;\n",
      [`${ATLAS}/src/geo.rs`]: "pub struct Geo {}\npub(crate) struct Inner {}\n",
      [`${PG}/Cargo.toml`]: targetManifest,
      [`${PG}/src/lib.rs`]: "pub mod domain;\n",
      [`${PG}/src/tdd.rs`]: "",
      [`${PG}/tests/it.rs`]: "",
      ...over,
    },
    {},
    "/repo",
  );

test("D4 rust: a crate the target does not link is refused, not imported", () => {
  const deps = wsFiles('[package]\nname = "pg"\n\n[dependencies]\nserde = "1"\n');
  assert.equal(importLineFor("rust", hit("Geo", `${ATLAS}/src/geo.rs`, STRUCT), PG_TARGET, deps), undefined);
});

test("D19 rust: the prefix is the DEPENDENCY KEY, which is what a rename links", () => {
  // `atlas_lib = { package = "atlas", path = "../atlas" }` is linked as
  // atlas_lib, and acme-db's own `[lib] name` case is this shape.
  const renamed = wsFiles('[package]\nname = "pg"\n\n[dependencies]\natlas_lib = { package = "atlas", path = "../atlas" }\n');
  assert.equal(importLineFor("rust", hit("Geo", `${ATLAS}/src/geo.rs`, STRUCT), PG_TARGET, renamed).importLine, "use atlas_lib::geo::Geo;");
  const plain = wsFiles('[package]\nname = "pg"\n\n[dependencies]\natlas = { path = "../atlas" }\n');
  assert.equal(importLineFor("rust", hit("Geo", `${ATLAS}/src/geo.rs`, STRUCT), PG_TARGET, plain).importLine, "use atlas::geo::Geo;");
});

test("D4 rust: a dev-dependency is linkable from a test target and not from a lib", () => {
  const deps = wsFiles('[package]\nname = "pg"\n\n[dev-dependencies]\natlas = { path = "../atlas" }\n');
  assert.equal(importLineFor("rust", hit("Geo", `${ATLAS}/src/geo.rs`, STRUCT), PG_TARGET, deps), undefined);
  assert.equal(
    importLineFor("rust", hit("Geo", `${ATLAS}/src/geo.rs`, STRUCT), `${PG}/tests/it.rs`, deps).importLine,
    "use atlas::geo::Geo;",
  );
});

test("rust: pub(crate) does not cross a crate boundary", () => {
  const deps = wsFiles('[package]\nname = "pg"\n\n[dependencies]\natlas = { path = "../atlas" }\n');
  assert.equal(importLineFor("rust", hit("Inner", `${ATLAS}/src/geo.rs`, STRUCT), PG_TARGET, deps), undefined);
});

test("amendment 4: undefined from deriveUsePath is a refusal, never a guessed crate::", () => {
  assert.equal(importLineFor("rust", hit("Order", "/elsewhere/order.rs", STRUCT), PG_TARGET, pgFiles()), undefined);
});

// ---------------------------------------------------------- ts import row

test("typescript: a relative specifier, posix, ./ prefixed, extension stripped", () => {
  assert.deepEqual(importLineFor("typescript", hit("ClientSet", "/repo/src/core/clientSet.ts"), TS_TARGET, TS_FS), {
    importLine: 'import { ClientSet } from "./core/clientSet";',
  });
});

test("typescript: /index collapses when nothing shadows it", () => {
  assert.equal(
    importLineFor("typescript", hit("ClientSet", "/repo/src/core/index.ts"), TS_TARGET, TS_FS).importLine,
    'import { ClientSet } from "./core";',
  );
});

test("D12 typescript: /index does NOT collapse onto a shadowing sibling file", () => {
  // moltbot has both src/plugins/runtime.ts and src/plugins/runtime/index.ts,
  // and node and tsc resolve the FILE.
  const deps = fsOf(new Set(["/repo/src/plugins/runtime.ts", "/repo/src/plugins/runtime/index.ts"]), {}, "/repo");
  assert.equal(
    importLineFor("typescript", hit("PluginRuntime", "/repo/src/plugins/runtime/index.ts"), "/repo/src/cli.ts", deps).importLine,
    'import { PluginRuntime } from "./plugins/runtime/index";',
  );
});

test("typescript: an upward specifier keeps its ../ and gains no ./", () => {
  assert.equal(
    importLineFor("typescript", hit("Reading", "/repo/lib/types.ts"), TS_TARGET, TS_FS).importLine,
    'import { Reading } from "../lib/types";',
  );
});

test("typescript: .tsx, .d.ts and .js all strip", () => {
  const line = (p) => importLineFor("typescript", hit("T", p), TS_TARGET, TS_FS).importLine;
  assert.match(line("/repo/src/ui/Panel.tsx"), /"\.\/ui\/Panel"/);
  assert.match(line("/repo/src/types/api.d.ts"), /"\.\/types\/api"/);
  assert.match(line("/repo/src/legacy/util.js"), /"\.\/legacy\/util"/);
});

test("amendment 5: the TypeScript family comes from TS_LANGUAGE_IDS, not a second list", () => {
  for (const id of ["typescript", "typescriptreact", "javascript", "javascriptreact"]) {
    const r = importLineFor(id, hit("T", "/repo/src/core/t.ts"), TS_TARGET, TS_FS);
    assert.ok(r && r.importLine.startsWith("import { T } from"), id);
  }
});

test("amendment 6: double quotes, a named import, and no `import type`", () => {
  const line = importLineFor("typescript", hit("T", "/repo/src/core/t.ts"), TS_TARGET, TS_FS).importLine;
  assert.ok(!line.includes("import type"));
  assert.ok(!line.includes("'"));
});

test("D13 typescript: a package boundary is imported by NAME, not by a deep relative path", () => {
  const files = {
    "/repo/packages/cfg/package.json": '{\n "name": "@acme/cfg",\n "version": "1.0.0"\n}\n',
    "/repo/packages/cfg/src/validation.ts": "",
    "/repo/core/package.json": '{\n "name": "@acme/core",\n "dependencies": {\n  "@acme/cfg": "file:../packages/cfg"\n }\n}\n',
    "/repo/core/config/Handler.ts": "",
  };
  assert.equal(
    importLineFor("typescript", hit("ConfigError", "/repo/packages/cfg/src/validation.ts", INTERFACE), "/repo/core/config/Handler.ts", fsOf(files, {}, "/repo")).importLine,
    'import { ConfigError } from "@acme/cfg";',
  );
});

test("D13 typescript: a package the target does not depend on is refused", () => {
  const files = {
    "/repo/packages/cfg/package.json": '{\n "name": "@acme/cfg"\n}\n',
    "/repo/packages/cfg/src/validation.ts": "",
    "/repo/core/package.json": '{\n "name": "@acme/core",\n "dependencies": {\n  "zod": "^3"\n }\n}\n',
    "/repo/core/config/Handler.ts": "",
  };
  assert.equal(
    importLineFor("typescript", hit("ConfigError", "/repo/packages/cfg/src/validation.ts", INTERFACE), "/repo/core/config/Handler.ts", fsOf(files, {}, "/repo")),
    undefined,
  );
});

test("typescript: one package, one manifest, still a relative specifier", () => {
  const files = { "/repo/package.json": '{"name":"one"}', "/repo/src/core/t.ts": "", "/repo/src/app.ts": "" };
  assert.equal(
    importLineFor("typescript", hit("T", "/repo/src/core/t.ts"), TS_TARGET, fsOf(files, {}, "/repo")).importLine,
    'import { T } from "./core/t";',
  );
});

// ---------------------------------------------------------- c# import row

test("D1 csharp: containerName is a Roslyn DISPLAY STRING and is never parsed", () => {
  const files = { "/repo/Atlas/Atlas.cs": "namespace Atlas;\n\npublic class Stripe {}\n" };
  const h = hit("Stripe", "/repo/Atlas/Atlas.cs", CLASS, "project Atlas (net10.0)");
  assert.equal(importLineFor("csharp", h, "/repo/App/P.cs", fsOf(files)).importLine, "using Atlas;");
  const nested = { "/repo/Atlas/Result.cs": "namespace Atlas;\npublic readonly struct Result<T, E> {}\n" };
  const h2 = hit("Result", "/repo/Atlas/Result.cs", STRUCT, "in Result<T, E> (project Atlas (net10.0))");
  assert.equal(importLineFor("csharp", h2, "/repo/App/P.cs", fsOf(nested)).importLine, "using Atlas;");
});

test("D1 csharp: an unreadable def file refuses, even with a containerName", () => {
  const h = hit("Stripe", "/repo/Atlas/Atlas.cs", CLASS, "Atlas");
  assert.equal(importLineFor("csharp", h, "/repo/App/P.cs", fsOf(new Set())), undefined);
});

test("csharp: block and file-scoped namespaces both parse", () => {
  const fileScoped = { "/repo/src/model.cs": "namespace Contoso.Sensors;\n\npublic sealed class Reading { }\n" };
  assert.equal(importLineFor("csharp", hit("Reading", "/repo/src/model.cs"), "/repo/src/app.cs", fsOf(fileScoped)).importLine, "using Contoso.Sensors;");
  const blocked = { "/repo/src/model.cs": "using System;\n\nnamespace Contoso.Sensors\n{\n  public class Reading { }\n}\n" };
  assert.equal(importLineFor("csharp", hit("Reading", "/repo/src/model.cs"), "/repo/src/app.cs", fsOf(blocked)).importLine, "using Contoso.Sensors;");
});

test("D11 csharp: a UTF-8 BOM is not part of the namespace name", () => {
  const files = { "/repo/Data/Readers.cs": "\ufeffnamespace Contoso.DataModel.Readers\n{\n  public class Rootobject {}\n}\n" };
  assert.equal(importLineFor("csharp", hit("Rootobject", "/repo/Data/Readers.cs"), "/repo/App/P.cs", fsOf(files)).importLine, "using Contoso.DataModel.Readers;");
});

test("D16 csharp: a NESTED namespace answers with the whole chain", () => {
  const files = { "/repo/Lib/Nested.cs": "namespace Outer\n{\n    namespace Inner\n    {\n        public class Widget {}\n    }\n}\n" };
  assert.equal(importLineFor("csharp", hit("Widget", "/repo/Lib/Nested.cs"), "/repo/App/P.cs", fsOf(files)).importLine, "using Outer.Inner;");
});

test("D16 csharp: the SECOND namespace in a file answers for its own types", () => {
  const files = { "/repo/Lib/Two.cs": "namespace First\n{\n    public class A {}\n}\n\nnamespace Second\n{\n    public class Widget {}\n}\n" };
  const line = (n) => importLineFor("csharp", hit(n, "/repo/Lib/Two.cs"), "/repo/App/P.cs", fsOf(files)).importLine;
  assert.equal(line("Widget"), "using Second;");
  assert.equal(line("A"), "using First;");
});

test("csharp: a `namespace` word in a comment or a string cannot answer", () => {
  const files = {
    "/repo/Lib/C.cs": '// namespace Wrong\n/* namespace AlsoWrong { */\nvar s = "namespace Nope {";\nnamespace Right;\npublic class Widget {}\n',
  };
  assert.equal(importLineFor("csharp", hit("Widget", "/repo/Lib/C.cs"), "/repo/App/P.cs", fsOf(files)).importLine, "using Right;");
});

test("csharp: no namespace anywhere is a refusal, not a `using` of nothing", () => {
  assert.equal(
    importLineFor("csharp", hit("Reading", "/repo/src/model.cs"), "/repo/src/app.cs", fsOf({ "/repo/src/model.cs": "public class Reading { }\n" })),
    undefined,
  );
});

// ------------------------------------------------------ python import row

test("D9 python: a PEP 420 namespace package does not truncate the path", () => {
  // mpl_toolkits has no __init__.py; mplot3d does. The old rule rooted at
  // mpl_toolkits and the interpreter answered ModuleNotFoundError.
  const files = new Set(["/sp/mpl_toolkits/mplot3d/__init__.py", "/sp/mpl_toolkits/mplot3d/axes3d.py"]);
  assert.equal(
    importLineFor("python", hit("Axes3D", "/sp/mpl_toolkits/mplot3d/axes3d.py"), "/sp/other/thing.py", fsOf(files, {}, "/sp")).importLine,
    "from mpl_toolkits.mplot3d.axes3d import Axes3D",
  );
});

test("python: the root is a project marker when one is above the file", () => {
  const files = new Set(["/repo/proj/pyproject.toml", "/repo/proj/pkg/__init__.py"]);
  assert.equal(
    importLineFor("python", hit("Reading", "/repo/proj/pkg/mod.py"), "/repo/proj/app.py", fsOf(files, {}, "/repo")).importLine,
    "from pkg.mod import Reading",
  );
});

test("python: a src/ layout roots at src/", () => {
  const files = new Set(["/repo/pyproject.toml", "/repo/src/pkg/__init__.py"]);
  assert.equal(
    importLineFor("python", hit("Reading", "/repo/src/pkg/mod.py"), "/repo/app.py", fsOf(files, {}, "/repo")).importLine,
    "from pkg.mod import Reading",
  );
});

test("python: the workspace root is the last resort, and it bounds the climb", () => {
  assert.equal(
    importLineFor("python", hit("Reading", "/repo/pkg/sub/mod.py"), "/repo/app.py", fsOf(new Set(), {}, "/repo")).importLine,
    "from pkg.sub.mod import Reading",
  );
});

test("python: with no marker and no workspace root, the __init__ chain is the fallback", () => {
  // Climbing to the filesystem top would invent a dotted path out of a home
  // directory, so the old rule is the honest degrade here.
  const files = new Set(["/a/b/pkg/__init__.py"]);
  assert.equal(
    importLineFor("python", hit("Reading", "/a/b/pkg/mod.py"), "/a/b/app.py", fsOf(files)).importLine,
    "from pkg.mod import Reading",
  );
});

test("python: a type defined in __init__.py imports from the package", () => {
  const files = new Set(["/repo/pkg/__init__.py", "/repo/pkg/sub/__init__.py"]);
  assert.equal(
    importLineFor("python", hit("Reading", "/repo/pkg/sub/__init__.py"), "/repo/app.py", fsOf(files, {}, "/repo")).importLine,
    "from pkg.sub import Reading",
  );
});

test("python: a .pyi stub strips its extension, and a non-identifier segment refuses", () => {
  assert.equal(
    importLineFor("python", hit("Reading", "/repo/model.pyi"), "/repo/app.py", fsOf(new Set(), {}, "/repo")).importLine,
    "from model import Reading",
  );
  assert.equal(importLineFor("python", hit("Reading", "/repo/my-pkg/model.py"), "/repo/app.py", fsOf(new Set(), {}, "/repo")), undefined);
});

// ---------------------------------------------------------- go import row

const GO_MOD = "module example.com/mod\n\ngo 1.22\n";
const goFiles = (over = {}) =>
  fsOf(
    {
      "/repo/go.mod": GO_MOD,
      "/repo/main.go": "package main\n",
      "/repo/pkg/store/store.go": "package store\n",
      ...over,
    },
    {},
    "/repo",
  );

test("go: the import line AND the qualifier, because a body cannot name it bare", () => {
  assert.deepEqual(importLineFor("go", hit("Client", "/repo/pkg/store/store.go", STRUCT), "/repo/main.go", goFiles()), {
    importLine: 'import "example.com/mod/pkg/store"',
    qualifier: "store",
  });
});

test("go: the package clause beats the directory name", () => {
  const deps = goFiles({ "/repo/pkg/store-go/store.go": "// a doc line\npackage storepkg\n" });
  assert.deepEqual(importLineFor("go", hit("Client", "/repo/pkg/store-go/store.go", STRUCT), "/repo/main.go", deps), {
    importLine: 'import "example.com/mod/pkg/store-go"',
    qualifier: "storepkg",
  });
});

test("D5 go: an unexported type is unreachable from another package", () => {
  const deps = goFiles({ "/repo/pkg/store/store.go": "package store\ntype pipelineState struct{}\n" });
  assert.equal(importLineFor("go", hit("pipelineState", "/repo/pkg/store/store.go", STRUCT), "/repo/main.go", deps), undefined);
});

test("D6 go: a _test.go file and a _test package are importable by nothing", () => {
  const deps = goFiles({
    "/repo/pkg/store/store_test.go": "package store_test\n",
    "/repo/pkg/store/helper.go": "package store_test\n",
  });
  assert.equal(importLineFor("go", hit("BenchRowDecoder", "/repo/pkg/store/store_test.go", INTERFACE), "/repo/main.go", deps), undefined);
  assert.equal(importLineFor("go", hit("BenchRowDecoder", "/repo/pkg/store/helper.go", INTERFACE), "/repo/main.go", deps), undefined);
});

test("D7 go: a `package main` file is a program, not an import", () => {
  const deps = goFiles({ "/repo/cmd/srv/main.go": "package main\ntype Server struct{}\n" });
  assert.equal(importLineFor("go", hit("Server", "/repo/cmd/srv/main.go", STRUCT), "/repo/main.go", deps), undefined);
});

test("D10 go: internal/ is importable only from under its parent", () => {
  const deps = goFiles({ "/repo/pkg/internal/bg/bg.go": "package bg\n", "/repo/pkg/user/u.go": "package user\n" });
  const h = hit("BGReader", "/repo/pkg/internal/bg/bg.go", STRUCT);
  assert.equal(importLineFor("go", h, "/repo/main.go", deps), undefined, "the module root is outside pkg/");
  assert.equal(
    importLineFor("go", h, "/repo/pkg/user/u.go", deps).importLine,
    'import "example.com/mod/pkg/internal/bg"',
    "a sibling under pkg/ may import it",
  );
});

test("go: an unreadable def file falls back to the last path segment", () => {
  const deps = fsOf({ "/repo/go.mod": GO_MOD }, {}, "/repo");
  assert.deepEqual(importLineFor("go", hit("Client", "/repo/pkg/store/store.go", STRUCT), "/repo/main.go", deps), {
    importLine: 'import "example.com/mod/pkg/store"',
    qualifier: "store",
  });
});

test("go: no derivable qualifier is a refusal, because an unqualified Go hint is wrong", () => {
  const deps = fsOf({ "/repo/go.mod": GO_MOD }, {}, "/repo");
  assert.equal(importLineFor("go", hit("Client", "/repo/pkg/store-go/store.go", STRUCT), "/repo/main.go", deps), undefined);
});

test("go: a def at the module root imports the module path itself", () => {
  const deps = goFiles({ "/repo/root.go": "package mod\n" });
  assert.deepEqual(importLineFor("go", hit("Client", "/repo/root.go", STRUCT), "/repo/cmd/main.go", deps), {
    importLine: 'import "example.com/mod"',
    qualifier: "mod",
  });
});

test("amendment 10: a submodule's go.mod beats the repository's", () => {
  const deps = goFiles({ "/repo/tools/go.mod": "module example.com/tools\n", "/repo/tools/lint/lint.go": "package lint\n" });
  assert.deepEqual(importLineFor("go", hit("Rule", "/repo/tools/lint/lint.go", STRUCT), "/repo/main.go", deps), {
    importLine: 'import "example.com/tools/lint"',
    qualifier: "lint",
  });
});

test("go: no go.mod under the workspace root is a refusal, and the root bounds the walk", () => {
  assert.equal(importLineFor("go", hit("Client", "/repo/pkg/store/store.go", STRUCT), "/repo/main.go", fsOf(new Set(), {}, "/repo")), undefined);
  const above = fsOf({ "/go.mod": "module example.com/x\n" }, {}, "/repo");
  assert.equal(importLineFor("go", hit("C", "/repo/pkg/store.go", STRUCT), "/repo/main.go", above), undefined);
});

test("go: a commented module line still parses", () => {
  const deps = goFiles({ "/repo/go.mod": "// module comment\nmodule example.com/mod // trailing\n" });
  assert.equal(
    importLineFor("go", hit("C", "/repo/pkg/store/store.go", STRUCT), "/repo/main.go", deps).importLine,
    'import "example.com/mod/pkg/store"',
  );
});

// ------------------------------------------------- windows, amendment 7

test("amendment 7: a backslash path is normalised before any dep reads it", () => {
  const asked = [];
  const deps = {
    fileExists: (p) => {
      asked.push(p);
      return p === "C:/repo/go.mod";
    },
    readFile: (p) => (p === "C:/repo/go.mod" ? "module example.com/mod\n" : undefined),
    workspaceRoot: "C:\\repo",
  };
  const r = importLineFor("go", hit("C", "C:\\repo\\pkg\\store\\store.go", STRUCT), "C:\\repo\\main.go", deps);
  assert.deepEqual(r, { importLine: 'import "example.com/mod/pkg/store"', qualifier: "store" });
  assert.ok(asked.every((p) => !p.includes("\\")), `a dep was handed a backslash path: ${JSON.stringify(asked)}`);
});

test("amendment 7: a backslash path normalises on the TypeScript row too", () => {
  assert.equal(
    importLineFor("typescript", hit("T", "C:\\repo\\src\\core\\t.ts"), "C:\\repo\\src\\app.ts", fsOf(new Set())).importLine,
    'import { T } from "./core/t";',
  );
});

// ------------------------------------------------- same scope, all five

test("D8 go same scope: the same package CLAUSE, which is not the same directory", () => {
  const deps = goFiles({ "/repo/pkg/store/client.go": "package store\n" });
  const v = ratifyWorkspaceHits("Client", [hit("Client", "/repo/pkg/store/store.go", STRUCT)], "go", "/repo/pkg/store/client.go", deps);
  assert.equal(v.ok, true);
  assert.equal(v.tier, 2);
  assert.equal(v.importLine, "");
  assert.equal(v.sameScope, true);
  assert.equal(v.qualifier, undefined);
});

test("D8 go: a _test package beside its subject is NOT the same scope, and is refused", () => {
  const deps = goFiles({
    "/repo/pkg/store/store_test.go": "package store_test\ntype testConnWrapper struct{}\n",
    "/repo/pkg/store/store.go": "package store\n",
  });
  const v = ratifyWorkspaceHits(
    "testConnWrapper",
    [hit("testConnWrapper", "/repo/pkg/store/store_test.go", STRUCT)],
    "go",
    "/repo/pkg/store/store.go",
    deps,
  );
  assert.notEqual(v.sameScope, true);
  assert.equal(v.ok, false);
});

test("go another package: sameScope is not set, and the qualifier comes back", () => {
  const v = ratifyWorkspaceHits("Client", [hit("Client", "/repo/pkg/store/store.go", STRUCT)], "go", "/repo/cmd/main.go", goFiles());
  assert.equal(v.sameScope, undefined);
  assert.equal(v.importLine, 'import "example.com/mod/pkg/store"');
  assert.equal(v.qualifier, "store");
});

test("csharp same namespace: two files, one namespace, no using", () => {
  const files = {
    "/repo/src/model.cs": "namespace Contoso.Sensors;\n\npublic class Reading { }\n",
    "/repo/src/app.cs": "namespace Contoso.Sensors;\n\npublic class App { }\n",
  };
  const v = ratifyWorkspaceHits("Reading", [hit("Reading", "/repo/src/model.cs")], "csharp", "/repo/src/app.cs", fsOf(files));
  assert.equal(v.sameScope, true);
  assert.equal(v.importLine, "");
  assert.equal(v.qualifier, undefined);
});

test("csharp different namespace: the using comes back and sameScope does not", () => {
  const files = {
    "/repo/src/model.cs": "namespace Contoso.Sensors;\npublic class Reading { }\n",
    "/repo/src/app.cs": "namespace Contoso.App;\npublic class App { }\n",
  };
  const v = ratifyWorkspaceHits("Reading", [hit("Reading", "/repo/src/model.cs")], "csharp", "/repo/src/app.cs", fsOf(files));
  assert.equal(v.sameScope, undefined);
  assert.equal(v.importLine, "using Contoso.Sensors;");
});

test("csharp: an unreadable target file is not a same-scope claim", () => {
  const files = { "/repo/src/model.cs": "namespace Contoso.Sensors;\npublic class Reading { }\n" };
  const v = ratifyWorkspaceHits("Reading", [hit("Reading", "/repo/src/model.cs")], "csharp", "/repo/src/app.cs", fsOf(files));
  assert.equal(v.sameScope, undefined);
  assert.equal(v.importLine, "using Contoso.Sensors;");
});

test("rust: a sibling module in the same directory still needs a use", () => {
  const deps = pgFiles({ [`${PG}/src/domain/basket.rs`]: "" });
  const v = ratifyWorkspaceHits("Order", [hit("Order", `${PG}/src/domain/orders.rs`, STRUCT)], "rust", `${PG}/src/domain/basket.rs`, deps);
  assert.equal(v.sameScope, undefined);
  assert.equal(v.importLine, "use crate::domain::orders::Order;");
});

test("typescript: a sibling file in the same directory still needs an import", () => {
  const v = ratifyWorkspaceHits("ClientSet", [hit("ClientSet", "/repo/src/clientSet.ts")], "typescript", TS_TARGET, TS_FS);
  assert.equal(v.sameScope, undefined);
  assert.equal(v.importLine, 'import { ClientSet } from "./clientSet";');
});

test("python: a sibling module in the same package still needs a from", () => {
  const files = new Set(["/repo/pkg/__init__.py"]);
  const v = ratifyWorkspaceHits("Reading", [hit("Reading", "/repo/pkg/model.py")], "python", "/repo/pkg/app.py", fsOf(files, {}, "/repo"));
  assert.equal(v.sameScope, undefined);
  assert.equal(v.importLine, "from pkg.model import Reading");
});

test("the same-file case stays tier 1 and never becomes a same-scope tier 2", () => {
  const v = ratifyWorkspaceHits("Client", [hit("Client", "/repo/pkg/store/store.go", STRUCT)], "go", "/repo/pkg/store/store.go", goFiles());
  assert.equal(v.tier, 1);
  assert.equal(v.sameScope, undefined);
});

test("the verdict's path is the normalised def path, whatever the provider sent", () => {
  const v = ratifyWorkspaceHits("T", [hit("T", "C:\\repo\\src\\core\\t.ts")], "typescript", "C:\\repo\\src\\app.ts", fsOf(new Set()));
  assert.equal(v.path, "C:/repo/src/core/t.ts");
});
