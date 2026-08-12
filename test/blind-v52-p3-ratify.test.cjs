// BLIND ORACLE - session-v52 phase 3: THE EXISTENCE GATE (tier 2).
//
// Bound to `session-v52/contract-p3.md` and to nothing else. Nothing in this
// file has read `src/**`; esbuild resolves `src/core/tightenRatify` at bundle
// time and that is the only contact with the implementation. Every row names
// the contract sentence it holds the product to.
//
// THE MODULE UNDER TEST IS PURE. The workspace symbol provider's answers arrive
// as plain records, so every row hand-builds `WorkspaceSymbolHit[]` and a fake
// `ImportPathDeps` over an in-memory map of path -> contents. No vscode, no
// filesystem, no clock.
//
// THE ORACLES ARE COMPUTED HERE. The fold is rewritten in this file out of the
// contract's own words ("lowercase, drop everything that is not a letter or a
// digit") and used to build the expectations. No function from the module under
// test grades another. Import lines are written out as literals, not derived by
// a second copy of the algorithm.
//
// Expected RED until phase 3 lands.
//
// Run: SKIP_LIVE=1 npx node --test test/blind-v52-p3-ratify.test.cjs

const test = require("node:test");
const assert = require("node:assert/strict");
const { bundleCore } = require("./.blind-util.cjs");

// The module does not exist yet, so the bundle itself is part of the red.
// Capture the failure instead of taking the whole file down with it: every row
// then reports "the module did not bundle" rather than vanishing from the run.
let mod = {};
let bundleError = null;
let cleanup = () => {};
try {
  const built = bundleCore(
    "blind-v52-p3",
    `export { ratifyWorkspaceHits, importLineFor, TYPE_ISH_KINDS } from "../src/core/tightenRatify";\n`
  );
  mod = built.mod;
  cleanup = built.cleanup;
} catch (e) {
  bundleError = e;
  // bundleCore writes its entry file before esbuild runs, so a failed bundle
  // leaves a stray .ts in test/. Sweep it here; nothing else will.
  const fs = require("fs");
  const path = require("path");
  for (const stray of [".blind-v52-p3.entry.ts", ".blind-v52-p3.bundle.cjs"]) {
    fs.rmSync(path.join(__dirname, stray), { force: true });
  }
}
test.after(() => cleanup());

function fn(name) {
  if (bundleError) {
    assert.fail(
      `src/core/tightenRatify.ts did not bundle: ${bundleError.message}`
    );
  }
  assert.equal(
    typeof mod[name],
    "function",
    `contract "The pure half": src/core/tightenRatify.ts must export ${name}`
  );
  return mod[name];
}

// ---------------------------------------------------------------------------
// Independent oracles and fixtures.
// ---------------------------------------------------------------------------

// The fold, rewritten here for ASCII, which is all any row below feeds it.
const fold = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");

// vscode.SymbolKind numeric values, the public API's own numbering, which the
// contract passes through untouched.
const K = {
  File: 0,
  Module: 1,
  Namespace: 2,
  Package: 3,
  Class: 4,
  Method: 5,
  Property: 6,
  Field: 7,
  Constructor: 8,
  Enum: 9,
  Interface: 10,
  Function: 11,
  Variable: 12,
  Constant: 13,
  String: 14,
  Number: 15,
  Boolean: 16,
  Array: 17,
  Object: 18,
  Key: 19,
  Null: 20,
  EnumMember: 21,
  Struct: 22,
  Event: 23,
  Operator: 24,
  TypeParameter: 25,
};

const FAIL_REASONS = new Set([
  "not-in-workspace",
  "ambiguous",
  "no-import-path",
]);

// An in-memory filesystem. `files` is path -> contents; a directory "exists"
// only through the files inside it, which is all `fileExists` is asked for
// (`__init__.py`, `go.mod`, `Cargo.toml`, the def file itself).
function makeDeps(files, root) {
  const map = new Map(Object.entries(files));
  return {
    fileExists: (p) => map.has(p),
    readFile: (p) => map.get(p),
    workspaceRoot: root,
  };
}

function assertVerdictShape(v, label) {
  assert.equal(typeof v, "object", `${label}: a verdict must be an object`);
  assert.notEqual(v, null, `${label}: a verdict must not be null`);
  assert.equal(typeof v.ok, "boolean", `${label}: verdict.ok must be boolean`);
  if (v.ok === false) {
    assert.ok(
      FAIL_REASONS.has(v.reason),
      `${label}: reason must be one of the three the contract declares, got ${JSON.stringify(
        v.reason
      )}`
    );
    assert.equal(
      typeof v.detail,
      "string",
      `${label}: a refusal carries a detail string`
    );
  }
}

// --- the TypeScript workspace used by most ratify rows ----------------------
const TS_TARGET = "/w/src/app/main.ts";
const TS_FILES = {
  "/w/src/app/main.ts": "export {};\n",
  "/w/src/core/clientSet.ts": "export class ClientSet {}\n",
  "/w/src/app/clientSet.ts": "export class ClientSet {}\n",
  "/w/src/app/core/clientSet.ts": "export class ClientSet {}\n",
  "/w/src/clientSet.ts": "export class ClientSet {}\n",
  "/w/src/app/core/index.ts": "export class ClientSet {}\n",
  "/w/src/other/clientSet.ts": "export class ClientSet {}\n",
};
const tsDeps = () => makeDeps(TS_FILES, "/w");

const hit = (name, kind, path, containerName) => {
  const h = { name, kind, path };
  if (containerName !== undefined) h.containerName = containerName;
  return h;
};

// ---------------------------------------------------------------------------
// TYPE_ISH_KINDS - the kind filter's membership.
// Contract: "Class, Struct, Interface, Enum, TypeParameter. Never Function,
// Constant, Variable or Method."
// ---------------------------------------------------------------------------

test("TYPE_ISH_KINDS is a set that answers has()", () => {
  if (bundleError) {
    assert.fail(
      `src/core/tightenRatify.ts did not bundle: ${bundleError.message}`
    );
  }
  const s = mod.TYPE_ISH_KINDS;
  assert.ok(s, "the module must export TYPE_ISH_KINDS");
  assert.equal(typeof s.has, "function", "TYPE_ISH_KINDS is a ReadonlySet");
});

test("TYPE_ISH_KINDS contains exactly the five type kinds the contract names", () => {
  fn("ratifyWorkspaceHits");
  const s = mod.TYPE_ISH_KINDS;
  for (const name of ["Class", "Struct", "Interface", "Enum", "TypeParameter"]) {
    assert.equal(
      s.has(K[name]),
      true,
      `TYPE_ISH_KINDS must contain SymbolKind.${name} (${K[name]})`
    );
  }
});

test("TYPE_ISH_KINDS excludes the value kinds - this is the 0.99% collision filter", () => {
  fn("ratifyWorkspaceHits");
  const s = mod.TYPE_ISH_KINDS;
  for (const name of [
    "Function",
    "Method",
    "Constant",
    "Variable",
    "Property",
    "Field",
    "EnumMember",
  ]) {
    assert.equal(
      s.has(K[name]),
      false,
      `TYPE_ISH_KINDS must NOT contain SymbolKind.${name} (${K[name]}) - in every measured fold collision one side is a const or a function`
    );
  }
});

// ---------------------------------------------------------------------------
// Ship condition 5: the fuzzy provider is fully filtered.
// ---------------------------------------------------------------------------

test("the contract's own case: ClientSetBuilder, ClientSets, client_set(fn), ClientSet -> ratifies exactly ClientSet", () => {
  const ratify = fn("ratifyWorkspaceHits");

  // My own oracle, stated so the row's premise is visible: only `client_set`
  // collides with `ClientSet` on the fold, and it is a Function, so the KIND
  // filter is the thing that has to carry this case.
  assert.equal(fold("ClientSetBuilder") === fold("ClientSet"), false);
  assert.equal(fold("ClientSets") === fold("ClientSet"), false);
  assert.equal(fold("client_set") === fold("ClientSet"), true);

  const hits = [
    hit("ClientSetBuilder", K.Struct, "/w/src/other/clientSet.ts"),
    hit("ClientSets", K.Class, "/w/src/other/clientSet.ts"),
    hit("client_set", K.Function, "/w/src/other/clientSet.ts"),
    hit("ClientSet", K.Class, "/w/src/core/clientSet.ts"),
  ];
  const v = ratify("ClientSet", hits, "typescript", TS_TARGET, tsDeps());
  assertVerdictShape(v, "fuzzy filter");
  assert.equal(v.ok, true, "ClientSet exists in the workspace and must ratify");
  assert.equal(v.tier, 2, "a workspace ratification is tier 2");
  assert.equal(v.identifier, "ClientSet");
  assert.equal(
    v.path,
    "/w/src/core/clientSet.ts",
    "the ratified hit is the Class named ClientSet, not the Function named client_set"
  );
});

test("a fold-differing name never ratifies, even when its kind is type-ish", () => {
  const ratify = fn("ratifyWorkspaceHits");
  const hits = [
    hit("ClientSetBuilder", K.Struct, "/w/src/core/clientSet.ts"),
    hit("ClientSets", K.Interface, "/w/src/other/clientSet.ts"),
  ];
  const v = ratify("ClientSet", hits, "typescript", TS_TARGET, tsDeps());
  assertVerdictShape(v, "fold-differing hits");
  assert.equal(
    v.ok,
    false,
    "fuzzy neighbours are not the type - exact fold-key equality is required"
  );
});

test("fold-key equality, not spelling equality: a Struct named client_set ratifies ClientSet", () => {
  const ratify = fn("ratifyWorkspaceHits");
  const hits = [hit("client_set", K.Struct, "/w/src/core/clientSet.ts")];
  const v = ratify("ClientSet", hits, "typescript", TS_TARGET, tsDeps());
  assertVerdictShape(v, "cross-spelling fold match");
  assert.equal(
    v.ok,
    true,
    'contract: "Fold every returned name, require exact key equality against the candidate\'s fold key, and require a type-ish kind"'
  );
  assert.equal(v.tier, 2);
  assert.equal(v.path, "/w/src/core/clientSet.ts");
  // Which SPELLING lands in verdict.identifier is a gap; not asserted here.
});

// ---------------------------------------------------------------------------
// The kind filter, kind by kind.
// ---------------------------------------------------------------------------

for (const name of [
  "Function",
  "Constant",
  "Variable",
  "Method",
  "Property",
  "Field",
  "EnumMember",
]) {
  test(`an exact-fold hit of kind ${name} is NOT a ratification`, () => {
    const ratify = fn("ratifyWorkspaceHits");
    const hits = [hit("ClientSet", K[name], "/w/src/core/clientSet.ts")];
    const v = ratify("ClientSet", hits, "typescript", TS_TARGET, tsDeps());
    assertVerdictShape(v, `kind ${name}`);
    assert.equal(
      v.ok,
      false,
      `SymbolKind.${name} is not type-ish, so the name is not ratified`
    );
    // Which of the three reasons a filtered-out hit produces is a gap; the
    // shape assertion above already pins it to the declared three.
  });
}

for (const name of ["Class", "Struct", "Interface", "Enum", "TypeParameter"]) {
  test(`an exact-fold hit of kind ${name} IS a ratification`, () => {
    const ratify = fn("ratifyWorkspaceHits");
    const hits = [hit("ClientSet", K[name], "/w/src/core/clientSet.ts")];
    const v = ratify("ClientSet", hits, "typescript", TS_TARGET, tsDeps());
    assertVerdictShape(v, `kind ${name}`);
    assert.equal(v.ok, true, `SymbolKind.${name} is type-ish`);
    assert.equal(v.tier, 2);
    assert.equal(v.path, "/w/src/core/clientSet.ts");
  });
}

// ---------------------------------------------------------------------------
// Ship condition 4: ambiguity refuses and never picks.
// ---------------------------------------------------------------------------

test("two type-kind hits with the same fold key in different modules -> ambiguous", () => {
  const ratify = fn("ratifyWorkspaceHits");
  const hits = [
    hit("ClientSet", K.Class, "/w/src/core/clientSet.ts", "core"),
    hit("ClientSet", K.Interface, "/w/src/other/clientSet.ts", "other"),
  ];
  const v = ratify("ClientSet", hits, "typescript", TS_TARGET, tsDeps());
  assertVerdictShape(v, "ambiguous");
  assert.equal(v.ok, false, "the product cannot know which was meant");
  assert.equal(v.reason, "ambiguous");
});

test("ambiguity never picks: neither module's path leaks out as a ratification", () => {
  const ratify = fn("ratifyWorkspaceHits");
  const hits = [
    hit("client_set", K.Struct, "/w/src/core/clientSet.ts", "core"),
    hit("ClientSet", K.Struct, "/w/src/other/clientSet.ts", "other"),
  ];
  const v = ratify("ClientSet", hits, "typescript", TS_TARGET, tsDeps());
  assertVerdictShape(v, "ambiguous, cross-spelling");
  assert.equal(v.ok, false);
  assert.equal(v.reason, "ambiguous");
  assert.equal(v.path, undefined, "a refusal carries no path");
  assert.equal(v.importLine, undefined, "a refusal carries no import line");
});

test("a second hit that is filtered out does not make the survivor ambiguous", () => {
  const ratify = fn("ratifyWorkspaceHits");
  const hits = [
    hit("client_set", K.Function, "/w/src/other/clientSet.ts", "other"),
    hit("ClientSet", K.Class, "/w/src/core/clientSet.ts", "core"),
  ];
  const v = ratify("ClientSet", hits, "typescript", TS_TARGET, tsDeps());
  assertVerdictShape(v, "one survivor");
  assert.equal(
    v.ok,
    true,
    "ambiguity is counted among SURVIVING hits, after the kind filter"
  );
  assert.equal(v.path, "/w/src/core/clientSet.ts");
});

// ---------------------------------------------------------------------------
// not-in-workspace.
// ---------------------------------------------------------------------------

test("no hits at all -> not-in-workspace", () => {
  const ratify = fn("ratifyWorkspaceHits");
  const v = ratify("ClientSet", [], "typescript", TS_TARGET, tsDeps());
  assertVerdictShape(v, "empty hits");
  assert.equal(v.ok, false);
  assert.equal(v.reason, "not-in-workspace");
});

// ---------------------------------------------------------------------------
// no-import-path. A tier-2 ratification carries the import path or it does not
// ship, so a derivation failure must NOT come back ok: true.
// ---------------------------------------------------------------------------

test("Go with no go.mod: the module path is underivable -> no-import-path, never ok", () => {
  const ratify = fn("ratifyWorkspaceHits");
  const deps = makeDeps(
    {
      "/w/cmd/app/main.go": "package main\n",
      "/w/pkg/clientset/set.go": "package clientset\n\ntype ClientSet struct{}\n",
    },
    "/w"
  );
  const hits = [hit("ClientSet", K.Struct, "/w/pkg/clientset/set.go")];
  const v = ratify("ClientSet", hits, "go", "/w/cmd/app/main.go", deps);
  assertVerdictShape(v, "go, no go.mod");
  assert.equal(
    v.ok,
    false,
    "a surface with no provenance must not ship as a ratification"
  );
  assert.equal(v.reason, "no-import-path");
});

test("C# with no containerName and an unreadable def file -> no-import-path, never ok", () => {
  const ratify = fn("ratifyWorkspaceHits");
  // The def file is not in the map at all: fileExists false, readFile
  // undefined. There is no namespace to be had from either source.
  const deps = makeDeps({ "/w/App/Program.cs": "class Program {}\n" }, "/w");
  const hits = [hit("ClientSet", K.Class, "/w/Client/Sets.cs")];
  const v = ratify("ClientSet", hits, "csharp", "/w/App/Program.cs", deps);
  assertVerdictShape(v, "csharp, no namespace anywhere");
  assert.equal(v.ok, false);
  assert.equal(v.reason, "no-import-path");
});

// ---------------------------------------------------------------------------
// Ship condition 3: the ratification carries the import path, and for Go the
// qualifier too.
// ---------------------------------------------------------------------------

test("a tier-2 verdict carries the same import line importLineFor derives", () => {
  const ratify = fn("ratifyWorkspaceHits");
  const importLineFor = fn("importLineFor");
  const h = hit("ClientSet", K.Class, "/w/src/core/clientSet.ts");
  const v = ratify("ClientSet", [h], "typescript", TS_TARGET, tsDeps());
  assertVerdictShape(v, "ts tier 2");
  assert.equal(v.ok, true);
  const derived = importLineFor("typescript", h, TS_TARGET, tsDeps());
  assert.notEqual(derived, undefined, "the import line must be derivable here");
  assert.equal(v.importLine, derived.importLine);
  assert.equal(
    v.importLine,
    'import { ClientSet } from "../core/clientSet";',
    "the target is /w/src/app/main.ts, so /w/src/core/clientSet.ts is one level up"
  );
});

test("a Go tier-2 verdict carries the package qualifier - unqualified is WRONG, not incomplete", () => {
  const ratify = fn("ratifyWorkspaceHits");
  const deps = makeDeps(
    {
      "/w/go.mod": "module example.com/mod\n\ngo 1.21\n",
      "/w/cmd/app/main.go": "package main\n",
      "/w/pkg/clientset/set.go": "package clientset\n\ntype ClientSet struct{}\n",
    },
    "/w"
  );
  const hits = [hit("ClientSet", K.Struct, "/w/pkg/clientset/set.go")];
  const v = ratify("ClientSet", hits, "go", "/w/cmd/app/main.go", deps);
  assertVerdictShape(v, "go tier 2");
  assert.equal(v.ok, true);
  assert.equal(v.tier, 2);
  assert.equal(v.importLine, 'import "example.com/mod/pkg/clientset"');
  assert.equal(
    v.qualifier,
    "clientset",
    "a Go body cannot name another package's type unqualified"
  );
});

// ---------------------------------------------------------------------------
// importLineFor - Rust.
// ---------------------------------------------------------------------------

test("Rust renders a use path: `use <path>::ClientSet;`", () => {
  const importLineFor = fn("importLineFor");
  const deps = makeDeps(
    {
      "/w/Cargo.toml": '[package]\nname = "acme"\nversion = "0.1.0"\n',
      "/w/src/lib.rs": "pub mod client;\npub mod app;\n",
      "/w/src/client/mod.rs": "pub mod set;\n",
      "/w/src/client/set.rs": "pub struct ClientSet;\n",
      "/w/src/app/main.rs": "fn main() {}\n",
    },
    "/w"
  );
  const h = hit("ClientSet", K.Struct, "/w/src/client/set.rs", "client::set");
  const out = importLineFor("rust", h, "/w/src/app/main.rs", deps);
  assert.notEqual(
    out,
    undefined,
    "a Rust def file inside the crate has a derivable use path (deriveUsePath in src/core/usePath.ts)"
  );
  assert.match(
    out.importLine,
    /^use [A-Za-z_][A-Za-z0-9_]*(::[A-Za-z_][A-Za-z0-9_]*)*::ClientSet;$/,
    "contract: render `use path::Type;`"
  );
  assert.equal(
    out.importLine.includes("/"),
    false,
    "a use path is :: separated, never a filesystem path"
  );
  assert.equal(
    out.importLine.includes(".rs"),
    false,
    "the file extension is not part of a use path"
  );
  assert.equal(
    out.qualifier,
    undefined,
    "only Go needs a qualifier; the use path brings the name into scope"
  );
});

// ---------------------------------------------------------------------------
// importLineFor - TypeScript. Relative, POSIX, ./ prefixed, extension
// stripped, /index collapsed.
// ---------------------------------------------------------------------------

const TS_ROWS = [
  ["a sibling file", "/w/src/app/clientSet.ts", 'import { ClientSet } from "./clientSet";'],
  [
    "a file in a subdirectory",
    "/w/src/app/core/clientSet.ts",
    'import { ClientSet } from "./core/clientSet";',
  ],
  [
    "a file in a parent directory",
    "/w/src/clientSet.ts",
    'import { ClientSet } from "../clientSet";',
  ],
  [
    "an index file, collapsed",
    "/w/src/app/core/index.ts",
    'import { ClientSet } from "./core";',
  ],
];

for (const [label, defPath, expected] of TS_ROWS) {
  test(`TypeScript specifier for ${label}`, () => {
    const importLineFor = fn("importLineFor");
    const h = hit("ClientSet", K.Class, defPath);
    const out = importLineFor("typescript", h, TS_TARGET, tsDeps());
    assert.notEqual(out, undefined, `${defPath} is inside the workspace`);
    assert.equal(out.importLine, expected);
    assert.equal(
      out.importLine.includes("\\"),
      false,
      "POSIX separators only"
    );
    assert.equal(out.qualifier, undefined, "TypeScript needs no qualifier");
  });
}

// ---------------------------------------------------------------------------
// importLineFor - C#.
// ---------------------------------------------------------------------------

// AMENDMENT 12. This row asserted the contract's original clause, "using
// Namespace; from the hit's containerName, which Roslyn fills with the
// namespace". A LIVE ROSLYN SERVER REFUTED IT: workspace/symbol answers
// containerName="project Atlas (net10.0)" for a top-level type and
// "in Result<T, E> (project Atlas (net10.0))" for a nested one, so the field is
// display text. src/core/csExtraction.ts:900 had already recorded the same
// measurement in this repo. The contract body now strikes that clause as WRONG,
// REFUTED, and the rule is: read the def file's own namespace declaration and
// never parse containerName.
//
// The row is kept at the same strength, inverted: a PLAUSIBLE-LOOKING
// containerName is present and must still not be believed, because the def
// file is the only thing that knows.
test("C# never parses containerName, even a plausible-looking one", () => {
  const importLineFor = fn("importLineFor");
  const deps = makeDeps(
    {
      "/w/App/Program.cs": "class Program {}\n",
      "/w/Client/Sets.cs": "namespace Contoso.Client.Storage;\n\npublic class ClientSet {}\n",
    },
    "/w"
  );
  // A container that reads exactly like a namespace, and is NOT the type's.
  const h = hit("ClientSet", K.Class, "/w/Client/Sets.cs", "Contoso.Client.Sets");
  const out = importLineFor("csharp", h, "/w/App/Program.cs", deps);
  assert.notEqual(out, undefined);
  assert.equal(
    out.importLine,
    "using Contoso.Client.Storage;",
    "the def file declares Contoso.Client.Storage; containerName said Sets and must not be believed"
  );
  // And the live shape itself never reaches the buffer as C#.
  const live = hit("ClientSet", K.Class, "/w/Client/Sets.cs", "project Atlas (net10.0)");
  assert.equal(importLineFor("csharp", live, "/w/App/Program.cs", deps).importLine, "using Contoso.Client.Storage;");
  // With nothing readable behind it, a containerName is not a fallback either:
  // a refusal beats a `using` of a display string.
  const blind = makeDeps({ "/w/App/Program.cs": "class Program {}\n" }, "/w");
  assert.equal(importLineFor("csharp", h, "/w/App/Program.cs", blind), undefined);
});

test("C# falls back to the def file's block-form namespace declaration", () => {
  const importLineFor = fn("importLineFor");
  const deps = makeDeps(
    {
      "/w/App/Program.cs": "class Program {}\n",
      "/w/Client/Sets.cs":
        "using System;\n\nnamespace Contoso.Client.Sets\n{\n    public class ClientSet\n    {\n    }\n}\n",
    },
    "/w"
  );
  const h = hit("ClientSet", K.Class, "/w/Client/Sets.cs"); // no containerName
  const out = importLineFor("csharp", h, "/w/App/Program.cs", deps);
  assert.notEqual(out, undefined, "the namespace is right there in the file");
  assert.equal(out.importLine, "using Contoso.Client.Sets;");
});

test("C# falls back to the def file's file-scoped namespace declaration", () => {
  const importLineFor = fn("importLineFor");
  const deps = makeDeps(
    {
      "/w/App/Program.cs": "class Program {}\n",
      "/w/Client/Sets.cs":
        "using System;\n\nnamespace Contoso.Client.Sets;\n\npublic class ClientSet\n{\n}\n",
    },
    "/w"
  );
  const h = hit("ClientSet", K.Class, "/w/Client/Sets.cs");
  const out = importLineFor("csharp", h, "/w/App/Program.cs", deps);
  assert.notEqual(out, undefined, "file-scoped namespaces are the modern form");
  assert.equal(out.importLine, "using Contoso.Client.Sets;");
});

// ---------------------------------------------------------------------------
// importLineFor - Python. The dotted path from the nearest ancestor directory
// that is NOT a package.
// ---------------------------------------------------------------------------

const PY_TARGET = "/w/app/main.py";

test("Python walks up to the first non-package directory", () => {
  const importLineFor = fn("importLineFor");
  const deps = makeDeps(
    {
      "/w/app/main.py": "",
      "/w/pkg/__init__.py": "",
      "/w/pkg/sub/__init__.py": "",
      "/w/pkg/sub/client_set.py": "class ClientSet:\n    pass\n",
    },
    "/w"
  );
  const h = hit("ClientSet", K.Class, "/w/pkg/sub/client_set.py");
  const out = importLineFor("python", h, PY_TARGET, deps);
  assert.notEqual(out, undefined);
  assert.equal(
    out.importLine,
    "from pkg.sub.client_set import ClientSet",
    "/w has no __init__.py, so the package root is /w and the module is pkg.sub.client_set"
  );
});

// AMENDMENT 13. This row asserted the contract's original clause, "the nearest
// ancestor directory that is not a package (no __init__.py)". THE CPYTHON
// INTERPRETER REFUTED IT: a PEP 420 namespace package has no __init__.py and is
// still importable, so the climb stopped one directory too low and
// `from mplot3d.axes3d import Axes3D` raised ModuleNotFoundError against a real
// venv (mpl_toolkits/mplot3d/axes3d.py). `from sub.client_set import ClientSet`
// below has the same defect: nothing puts /w/pkg on sys.path, so it cannot
// resolve either. The contract body now strikes that clause as WRONG, REFUTED,
// and the rule is the sys.path ROOT MARKER climb: pyproject.toml, setup.py,
// setup.cfg, a src/ directory, or the workspace root, whichever comes first.
//
// The row is kept at the same strength: the SAME layout, still asserting where
// the dotted path is rooted, now against the marker rule, plus the marker
// beating the workspace root and the namespace-package case that refuted it.
test("Python climbs to a sys.path root marker, across a namespace package", () => {
  const importLineFor = fn("importLineFor");
  const deps = makeDeps(
    {
      "/w/app/main.py": "",
      // /w/pkg has no __init__.py and is a PEP 420 namespace package, which is
      // importable, so it belongs IN the dotted path.
      "/w/pkg/sub/__init__.py": "",
      "/w/pkg/sub/client_set.py": "class ClientSet:\n    pass\n",
    },
    "/w"
  );
  const h = hit("ClientSet", K.Class, "/w/pkg/sub/client_set.py");
  const out = importLineFor("python", h, PY_TARGET, deps);
  assert.notEqual(out, undefined);
  assert.equal(
    out.importLine,
    "from pkg.sub.client_set import ClientSet",
    "the workspace root is the sys.path entry, so the dotted path starts at pkg"
  );

  // A project marker below the workspace root wins, because it is the deeper
  // sys.path entry.
  const marked = makeDeps(
    {
      "/w/app/main.py": "",
      "/w/proj/pyproject.toml": "",
      "/w/proj/pkg/__init__.py": "",
      "/w/proj/pkg/client_set.py": "class ClientSet:\n    pass\n",
    },
    "/w"
  );
  assert.equal(
    importLineFor("python", hit("ClientSet", K.Class, "/w/proj/pkg/client_set.py"), PY_TARGET, marked).importLine,
    "from pkg.client_set import ClientSet"
  );

  // And a src/ layout roots at src/, never above it.
  const srcLayout = makeDeps(
    {
      "/w/app/main.py": "",
      "/w/pyproject.toml": "",
      "/w/src/pkg/__init__.py": "",
      "/w/src/pkg/client_set.py": "class ClientSet:\n    pass\n",
    },
    "/w"
  );
  assert.equal(
    importLineFor("python", hit("ClientSet", K.Class, "/w/src/pkg/client_set.py"), PY_TARGET, srcLayout).importLine,
    "from pkg.client_set import ClientSet"
  );
});

test("Python falls back to the workspace root when nothing is a package", () => {
  const importLineFor = fn("importLineFor");
  const deps = makeDeps(
    {
      "/w/app/main.py": "",
      "/w/client_set.py": "class ClientSet:\n    pass\n",
    },
    "/w"
  );
  const h = hit("ClientSet", K.Class, "/w/client_set.py");
  const out = importLineFor("python", h, PY_TARGET, deps);
  assert.notEqual(out, undefined);
  assert.equal(out.importLine, "from client_set import ClientSet");
});

// ---------------------------------------------------------------------------
// importLineFor - Go.
// ---------------------------------------------------------------------------

test("Go derives the module path from go.mod and the qualifier from the package dir", () => {
  const importLineFor = fn("importLineFor");
  const deps = makeDeps(
    {
      "/w/go.mod": "module example.com/mod\n\ngo 1.21\n",
      "/w/cmd/app/main.go": "package main\n",
      "/w/pkg/clientset/set.go": "package clientset\n\ntype ClientSet struct{}\n",
    },
    "/w"
  );
  const h = hit("ClientSet", K.Struct, "/w/pkg/clientset/set.go");
  const out = importLineFor("go", h, "/w/cmd/app/main.go", deps);
  assert.notEqual(out, undefined, "go.mod is right at the workspace root");
  assert.equal(out.importLine, 'import "example.com/mod/pkg/clientset"');
  assert.equal(out.qualifier, "clientset");
});

test("Go with no go.mod derives nothing - undefined, not a guess", () => {
  const importLineFor = fn("importLineFor");
  const deps = makeDeps(
    {
      "/w/cmd/app/main.go": "package main\n",
      "/w/pkg/clientset/set.go": "package clientset\n\ntype ClientSet struct{}\n",
    },
    "/w"
  );
  const h = hit("ClientSet", K.Struct, "/w/pkg/clientset/set.go");
  const out = importLineFor("go", h, "/w/cmd/app/main.go", deps);
  assert.equal(
    out,
    undefined,
    "contract: undefined when it cannot be derived, which fails the ratification"
  );
});

test("an unsupported languageId derives nothing", () => {
  const importLineFor = fn("importLineFor");
  const h = hit("ClientSet", K.Class, "/w/src/core/clientSet.ts");
  const out = importLineFor("cobol", h, TS_TARGET, tsDeps());
  assert.equal(out, undefined, "five languages have a row; cobol does not");
});

// ---------------------------------------------------------------------------
// Never throws. A tier-2 gate that throws takes the whole tighten command down.
// ---------------------------------------------------------------------------

const throwingDeps = {
  fileExists: () => {
    throw new Error("fileExists exploded");
  },
  readFile: () => {
    throw new Error("readFile exploded");
  },
  workspaceRoot: "/w",
};
const readThrowsDeps = {
  fileExists: (p) => p === "/w/Client/Sets.cs",
  readFile: () => {
    throw new Error("readFile exploded");
  },
  workspaceRoot: "/w",
};

const HOSTILE = [
  ["null hits", "ClientSet", null, "typescript", TS_TARGET, () => tsDeps()],
  ["undefined hits", "ClientSet", undefined, "typescript", TS_TARGET, () => tsDeps()],
  ["empty hits", "ClientSet", [], "typescript", TS_TARGET, () => tsDeps()],
  ["a hit with no fields", "ClientSet", [{}], "typescript", TS_TARGET, () => tsDeps()],
  [
    "a hit with no path",
    "ClientSet",
    [{ name: "ClientSet", kind: K.Class }],
    "typescript",
    TS_TARGET,
    () => tsDeps(),
  ],
  [
    "a hit with no kind",
    "ClientSet",
    [{ name: "ClientSet", path: "/w/src/core/clientSet.ts" }],
    "typescript",
    TS_TARGET,
    () => tsDeps(),
  ],
  [
    "an empty identifier",
    "",
    [hit("ClientSet", K.Class, "/w/src/core/clientSet.ts")],
    "typescript",
    TS_TARGET,
    () => tsDeps(),
  ],
  [
    "deps whose readFile throws",
    "ClientSet",
    [hit("ClientSet", K.Class, "/w/Client/Sets.cs")],
    "csharp",
    "/w/App/Program.cs",
    () => readThrowsDeps,
  ],
  [
    "deps whose fileExists throws",
    "ClientSet",
    [hit("ClientSet", K.Class, "/w/pkg/sub/client_set.py")],
    "python",
    PY_TARGET,
    () => throwingDeps,
  ],
  [
    "an unsupported languageId",
    "ClientSet",
    [hit("ClientSet", K.Class, "/w/src/core/clientSet.ts")],
    "cobol",
    TS_TARGET,
    () => tsDeps(),
  ],
  [
    "no workspaceRoot",
    "ClientSet",
    [hit("ClientSet", K.Struct, "/w/pkg/clientset/set.go")],
    "go",
    "/w/cmd/app/main.go",
    () => makeDeps({ "/w/go.mod": "module example.com/mod\n" }, undefined),
  ],
];

for (const [label, ident, hits, lang, target, mkDeps] of HOSTILE) {
  test(`ratifyWorkspaceHits never throws: ${label}`, () => {
    const ratify = fn("ratifyWorkspaceHits");
    let v;
    assert.doesNotThrow(() => {
      v = ratify(ident, hits, lang, target, mkDeps());
    }, `ratifyWorkspaceHits threw on ${label}`);
    assertVerdictShape(v, label);
  });
}

for (const [label, , hits, lang, target, mkDeps] of HOSTILE) {
  test(`importLineFor never throws: ${label}`, () => {
    const importLineFor = fn("importLineFor");
    const h = Array.isArray(hits) && hits.length ? hits[0] : {};
    let out;
    assert.doesNotThrow(() => {
      out = importLineFor(lang, h, target, mkDeps());
    }, `importLineFor threw on ${label}`);
    if (out !== undefined) {
      assert.equal(
        typeof out.importLine,
        "string",
        `${label}: a defined result carries an importLine string`
      );
    }
  });
}

test("ratifyWorkspaceHits never throws on a null deps object", () => {
  const ratify = fn("ratifyWorkspaceHits");
  let v;
  assert.doesNotThrow(() => {
    v = ratify(
      "ClientSet",
      [hit("ClientSet", K.Class, "/w/src/core/clientSet.ts")],
      "typescript",
      TS_TARGET,
      null
    );
  });
  assertVerdictShape(v, "null deps");
});
