// session-v40 item 2, phase 3 — white-box unit coverage for both new legs:
//
//   1. The Go anchor leg: GoLspExtractor.resolveTypeCursorByName, backed by
//      goExtraction's selectGoTypeCursor / resolveGoTypeCursorWithHint, over a
//      SYNTHETIC workspace/symbol candidate list (the shape a real gopls
//      response reduces to — the live shape itself is proven separately in
//      test/impl-v40-p3-go-anchor-live.test.cjs against real gopls).
//   2. The candidate leg: goTypesFromQualifiedUsage / csTypesFromQualifiedUsage
//      (src/core/repairTypes.ts) and their import-block readers
//      (goImportSpecs/goImportedPackageNames/goImportedPackagePaths in
//      src/core/goExtraction.ts, csUsingNamespaces in src/core/csExtraction.ts),
//      plus the tier-5 wiring in goPrioritizedTypes/csPrioritizedTypes
//      (src/vscode/fnGen.ts).
//
// Run: node --test test/impl-v40-p3-qualified-usage.test.cjs

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");
const { bundleCore } = require("./.blind-util.cjs");

// ===========================================================================
// Part A: the pure core (no vscode dependency) — goExtraction, csExtraction,
// repairTypes.
// ===========================================================================

const { mod: CORE, cleanup: coreCleanup } = bundleCore(
  "v40-p3-core",
  `export {
    goImportSpecs, goImportedPackageNames, goImportedPackagePaths,
    selectGoTypeCursor, exactGoTypeHits, resolveGoTypeCursorWithHint,
  } from "../src/core/goExtraction";
  export { csUsingNamespaces } from "../src/core/csExtraction";
  export { goTypesFromQualifiedUsage, csTypesFromQualifiedUsage } from "../src/core/repairTypes";
  `,
);
test.after(coreCleanup);

// ---------------------------------------------------------------------------
// A1. goImportSpecs / goImportedPackageNames / goImportedPackagePaths
// ---------------------------------------------------------------------------

test("goImportSpecs: single-line, grouped, aliased, blank and dot imports", () => {
  const src = [
    'import "fmt"',
    "",
    "import (",
    '\t"os"',
    '\t"github.com/spf13/cobra"',
    '\tflag "github.com/spf13/pflag"',
    '\t_ "github.com/lib/pq"',
    '\t. "github.com/foo/dot"',
    ")",
  ].join("\n");
  assert.deepEqual(CORE.goImportSpecs(src), [
    { path: "fmt" },
    { path: "os" },
    { path: "github.com/spf13/cobra" },
    { alias: "flag", path: "github.com/spf13/pflag" },
    { alias: "_", path: "github.com/lib/pq" },
    { alias: ".", path: "github.com/foo/dot" },
  ]);
});

test("goImportSpecs: a multi-line grouped block interleaved with a comment line", () => {
  // gofmt keeps one spec per line inside the group; a comment line between
  // specs must not desync the scan or swallow the next real spec.
  const src = ["import (", '\t"fmt"', "\t// see also strings", '\t"strings"', ")"].join("\n");
  assert.deepEqual(CORE.goImportSpecs(src), [{ path: "fmt" }, { path: "strings" }]);
});

test("goImportedPackageNames: default is the path's last segment", () => {
  const src = 'import (\n\t"fmt"\n\t"github.com/spf13/cobra"\n)\n';
  assert.deepEqual([...CORE.goImportedPackageNames(src)].sort(), ["cobra", "fmt"]);
});

test("goImportedPackageNames: an explicit alias wins over the default", () => {
  const src = 'import (\n\tflag "github.com/spf13/pflag"\n)\n';
  assert.deepEqual([...CORE.goImportedPackageNames(src)], ["flag"]);
});

test("goImportedPackageNames: blank and dot imports contribute no qualifier", () => {
  const src = 'import (\n\t_ "github.com/lib/pq"\n\t. "github.com/foo/dot"\n)\n';
  assert.deepEqual([...CORE.goImportedPackageNames(src)], []);
});

test("goImportedPackageNames: a /vN module-version segment is skipped for the preceding one", () => {
  const src = 'import "github.com/alecthomas/chroma/v2"\n';
  assert.deepEqual([...CORE.goImportedPackageNames(src)], ["chroma"]);
});

test("goImportedPackageNames: a gopkg.in name.vN leaf resolves to the bare name", () => {
  const src = 'import "gopkg.in/yaml.v2"\n';
  assert.deepEqual([...CORE.goImportedPackageNames(src)], ["yaml"]);
});

test("goImportedPackagePaths: the real import paths, aliasing does not change them", () => {
  const src = 'import (\n\tflag "github.com/spf13/pflag"\n\t"fmt"\n)\n';
  assert.deepEqual([...CORE.goImportedPackagePaths(src)].sort(), ["fmt", "github.com/spf13/pflag"]);
});

// ---------------------------------------------------------------------------
// A2. goTypesFromQualifiedUsage
// ---------------------------------------------------------------------------

test("goTypesFromQualifiedUsage: a package-qualified type in the body is admitted", () => {
  const fullText = 'package x\n\nimport (\n\t"github.com/spf13/cobra"\n)\n';
  const span = "func run() {\n\tvar c *cobra.Command\n\t_ = c\n}";
  assert.deepEqual(CORE.goTypesFromQualifiedUsage("func run()", undefined, span, fullText), ["Command"]);
});

test("goTypesFromQualifiedUsage: a qualifier with no matching import is refused (a local var, not a package)", () => {
  const fullText = 'package x\n\nimport "fmt"\n';
  // `resp` is not an import, so `resp.Header` never admits `Header` — proving
  // the import-correlation is doing the work, not just a lowercase-qualifier
  // filter (Header is a real PascalCase field name a naive scan would take).
  const span = "func run(resp *Response) {\n\tx := resp.Header\n\t_ = x\n}";
  assert.deepEqual(CORE.goTypesFromQualifiedUsage("func run(resp *Response)", undefined, span, fullText), []);
});

test("goTypesFromQualifiedUsage: a bare (unqualified) same-package export is out of scope for this leg", () => {
  const fullText = 'package x\n\nimport "fmt"\n';
  const span = "func run() {\n\tvar w Widget\n\t_ = w\n}";
  assert.deepEqual(CORE.goTypesFromQualifiedUsage("func run()", undefined, span, fullText), []);
});

test("goTypesFromQualifiedUsage: no imports at all short-circuits to empty", () => {
  assert.deepEqual(CORE.goTypesFromQualifiedUsage("func run()", undefined, "func run() {}", ""), []);
});

test("goTypesFromQualifiedUsage: a qualified mention inside a comment or a string is not mined (masked)", () => {
  const fullText = 'package x\n\nimport "github.com/spf13/cobra"\n';
  const span = [
    "func run() {",
    "\t// see cobra.Command for details",
    '\ts := "cobra.Command"',
    "\t_ = s",
    "}",
  ].join("\n");
  assert.deepEqual(CORE.goTypesFromQualifiedUsage("func run()", undefined, span, fullText), []);
});

test("goTypesFromQualifiedUsage: doc and signature legs both read through real imports", () => {
  const fullText = 'package x\n\nimport "github.com/spf13/cobra"\n';
  assert.deepEqual(
    CORE.goTypesFromQualifiedUsage("func run(c *cobra.Command)", undefined, "", fullText),
    ["Command"],
    "signature leg",
  );
  assert.deepEqual(
    CORE.goTypesFromQualifiedUsage("func run()", "wraps a cobra.Command", "", fullText),
    ["Command"],
    "doc leg",
  );
});

test("goTypesFromQualifiedUsage: GO_STD_TYPE_NAMES and duplicates are excluded", () => {
  const fullText = 'package x\n\nimport (\n\t"time"\n\t"github.com/spf13/cobra"\n)\n';
  const span = "func run() {\n\tvar t time.Time\n\tvar c1, c2 *cobra.Command\n\t_ = t\n\t_ = c1\n\t_ = c2\n}";
  assert.deepEqual(CORE.goTypesFromQualifiedUsage("func run()", undefined, span, fullText), ["Command"]);
});

// ---------------------------------------------------------------------------
// A3. csUsingNamespaces / csTypesFromQualifiedUsage
// ---------------------------------------------------------------------------

test("csUsingNamespaces: plain usings collected, static and alias forms excluded", () => {
  const src = [
    "using System;",
    "using Newtonsoft.Json.Linq;",
    "using static System.Math;",
    "using Json = Newtonsoft.Json.Linq;",
  ].join("\n");
  assert.deepEqual([...CORE.csUsingNamespaces(src)].sort(), ["Newtonsoft.Json.Linq", "System"]);
});

test("csTypesFromQualifiedUsage: a fully-qualified type in the body is admitted", () => {
  const fullText = "using Newtonsoft.Json.Linq;\n";
  const span = "void F() {\n  Newtonsoft.Json.Linq.JObject o = null;\n}";
  assert.deepEqual(CORE.csTypesFromQualifiedUsage("void F()", undefined, span, fullText), ["JObject"]);
});

test("csTypesFromQualifiedUsage: a trailing member/method segment does not get mined as a second type", () => {
  const fullText = "using Newtonsoft.Json.Linq;\n";
  const span = "void F() {\n  var o = Newtonsoft.Json.Linq.JObject.Parse(x);\n}";
  assert.deepEqual(CORE.csTypesFromQualifiedUsage("void F()", undefined, span, fullText), ["JObject"]);
});

test("csTypesFromQualifiedUsage: a chain matching no using at all admits nothing", () => {
  const fullText = "using System;\n";
  const span = "void F() {\n  var x = Some.Other.Thing;\n}";
  assert.deepEqual(CORE.csTypesFromQualifiedUsage("void F()", undefined, span, fullText), []);
});

test("csTypesFromQualifiedUsage: no usings at all short-circuits to empty", () => {
  assert.deepEqual(CORE.csTypesFromQualifiedUsage("void F()", undefined, "void F() {}", ""), []);
});

test("csTypesFromQualifiedUsage: masks comments and strings before scanning the body", () => {
  const fullText = "using Newtonsoft.Json.Linq;\n";
  const span = [
    "void F() {",
    "  // Newtonsoft.Json.Linq.JObject is handy",
    '  var s = "Newtonsoft.Json.Linq.JObject";',
    "}",
  ].join("\n");
  assert.deepEqual(CORE.csTypesFromQualifiedUsage("void F()", undefined, span, fullText), []);
});

// ---------------------------------------------------------------------------
// A4. selectGoTypeCursor / resolveGoTypeCursorWithHint
// ---------------------------------------------------------------------------

const candidate = (name, role, containerName, uri, line = 0, character = 5) => ({
  name,
  role,
  containerName,
  uri,
  line,
  character,
});

test("selectGoTypeCursor: exact-name container hit resolves; a same-name function/const does not compete", () => {
  const candidates = [
    candidate("Command", "container", "github.com/spf13/cobra", "file:///cobra/command.go"),
    candidate("getCommand", "other", "github.com/spf13/cobra", "file:///cobra/x_test.go"),
    candidate("CommandGroup", "container", "github.com/spf13/cobra", "file:///cobra/group.go"),
  ];
  const got = CORE.selectGoTypeCursor(candidates, "Command");
  assert.deepEqual(got, { uri: "file:///cobra/command.go", line: 0, character: 5 });
});

test("selectGoTypeCursor: two distinct packages declaring the same type name refuses outright", () => {
  const candidates = [
    candidate("Widget", "container", "example.com/a", "file:///a/widget.go"),
    candidate("Widget", "container", "example.com/b", "file:///b/widget.go"),
  ];
  assert.equal(CORE.selectGoTypeCursor(candidates, "Widget"), undefined);
});

test("selectGoTypeCursor: no exact-name container hit resolves to undefined", () => {
  const candidates = [candidate("getCommand", "other", "example.com/a", "file:///a/x.go")];
  assert.equal(CORE.selectGoTypeCursor(candidates, "Command"), undefined);
});

test("resolveGoTypeCursorWithHint: falls through to the unambiguous answer when there is one", () => {
  const candidates = [candidate("Command", "container", "github.com/spf13/cobra", "file:///cobra/command.go")];
  const got = CORE.resolveGoTypeCursorWithHint(candidates, "Command", undefined);
  assert.deepEqual(got, { uri: "file:///cobra/command.go", line: 0, character: 5 });
});

test("resolveGoTypeCursorWithHint: hint.container disambiguates by package-path suffix", () => {
  const candidates = [
    candidate("Widget", "container", "example.com/a", "file:///a/widget.go"),
    candidate("Widget", "container", "example.com/b", "file:///b/widget.go"),
  ];
  const got = CORE.resolveGoTypeCursorWithHint(candidates, "Widget", { container: "example.com/b" });
  assert.deepEqual(got, { uri: "file:///b/widget.go", line: 0, character: 5 });
});

test("resolveGoTypeCursorWithHint: hint.fileText disambiguates via the caller's own real imports", () => {
  const candidates = [
    candidate("Widget", "container", "example.com/a", "file:///a/widget.go"),
    candidate("Widget", "container", "example.com/b", "file:///b/widget.go"),
  ];
  const fileText = 'package caller\n\nimport "example.com/b"\n';
  const got = CORE.resolveGoTypeCursorWithHint(candidates, "Widget", { fileText });
  assert.deepEqual(got, { uri: "file:///b/widget.go", line: 0, character: 5 });
});

test("resolveGoTypeCursorWithHint: a hint that fits none or both of the candidates still refuses", () => {
  const candidates = [
    candidate("Widget", "container", "example.com/a", "file:///a/widget.go"),
    candidate("Widget", "container", "example.com/b", "file:///b/widget.go"),
  ];
  assert.equal(CORE.resolveGoTypeCursorWithHint(candidates, "Widget", { container: "example.com/c" }), undefined);
  const bothImported = 'import (\n\t"example.com/a"\n\t"example.com/b"\n)\n';
  assert.equal(
    CORE.resolveGoTypeCursorWithHint(candidates, "Widget", { fileText: bothImported }),
    undefined,
    "importing both packages is still ambiguous, not a coin flip",
  );
});

test("exactGoTypeHits: role filter excludes a method/function/const sharing the name", () => {
  const candidates = [
    candidate("Widget", "container", "example.com/a", "file:///a/widget.go"),
    candidate("Widget", "method", "example.com/a", "file:///a/other.go"),
    candidate("Widget", "field", "example.com/a", "file:///a/other.go"),
    candidate("Widget", "other", "example.com/a", "file:///a/other.go"),
  ];
  const hits = CORE.exactGoTypeHits(candidates, "Widget");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].uri, "file:///a/widget.go");
});

// ===========================================================================
// Part B: the fnGen tier-5 wiring (needs the vscode stub, mirrors
// test/impl-v36-p1-commenttypes.test.cjs's own bundling pattern).
// ===========================================================================

const STUB = path.join(__dirname, ".impl-v40-p3-vscode-stub.cjs");
fs.writeFileSync(
  STUB,
  `class Position { constructor(line, character){ this.line=line; this.character=character; } }
class Range { constructor(a,b){ this.start=a; this.end=b; } }
const mkUri = (s) => ({ toString: () => String(s), fsPath: String(s), path: String(s) });
module.exports = {
  Position, Range, Selection: Range, WorkspaceEdit: class {},
  EventEmitter: class { constructor(){ this.event=()=>({dispose(){}}); } fire(){} dispose(){} },
  ThemeColor: class {}, MarkdownString: class {},
  Uri: { parse: mkUri, file: mkUri },
  SymbolKind: { File:0, Module:1, Namespace:2, Package:3, Class:4, Method:5, Property:6,
    Field:7, Constructor:8, Enum:9, Interface:10, Function:11, Variable:12, Constant:13,
    String:14, Number:15, Boolean:16, Array:17, Object:18, Key:19, Null:20, EnumMember:21,
    Struct:22, Event:23, Operator:24, TypeParameter:25 },
  ProgressLocation: {}, EndOfLine: { LF:1, CRLF:2 },
  languages: {}, window: {}, commands: {},
  workspace: { getConfiguration: () => ({ get: (k, f) => f, has: () => false, inspect: () => undefined, update: async () => {} }) },
};
`,
);
const ENTRY = path.join(__dirname, ".impl-v40-p3-v.entry.ts");
const OUTFILE = path.join(__dirname, ".impl-v40-p3-v.bundle.cjs");
fs.writeFileSync(
  ENTRY,
  `export { goPrioritizedTypes, csPrioritizedTypes } from "../src/vscode/fnGen";\n`,
);
esbuild.buildSync({
  entryPoints: [ENTRY],
  bundle: true,
  outfile: OUTFILE,
  format: "cjs",
  platform: "node",
  alias: { vscode: STUB },
});
const FNGEN = require(OUTFILE);
test.after(() => [STUB, ENTRY, OUTFILE].forEach((f) => fs.rmSync(f, { force: true })));

test("goPrioritizedTypes: the qualified-usage tier lands LAST, after signature/doc/comment/local legs", () => {
  const fullText = 'package x\n\nimport "github.com/spf13/cobra"\n';
  const signature = "func run(a *SigType)";
  const doc = "builds a `DocType`";
  const span = "func run(a *SigType) {\n\t// needs a `CommentType`\n\tvar c *cobra.Command\n\t_ = c\n}";
  const out = FNGEN.goPrioritizedTypes(signature, doc, fullText, new Set(), undefined, span);
  assert.deepEqual(out, ["SigType", "DocType", "CommentType", "Command"]);
});

test("csPrioritizedTypes: the qualified-usage tier lands LAST too", () => {
  const fullText = "using Newtonsoft.Json.Linq;\n";
  const signature = "void F(SigType a)";
  const doc = "builds a `DocType`";
  const span = "void F(SigType a) {\n  // needs a `CommentType`\n  Newtonsoft.Json.Linq.JObject o = null;\n}";
  const out = FNGEN.csPrioritizedTypes(signature, doc, fullText, new Set(), undefined, span);
  assert.deepEqual(out, ["SigType", "DocType", "CommentType", "JObject"]);
});

test("goPrioritizedTypes: a caller passing fullText=\"\" (the pre-v40 shape) is unaffected — no regression", () => {
  const out = FNGEN.goPrioritizedTypes("func run(a *SigType)", undefined, "", new Set(), undefined, "");
  assert.deepEqual(out, ["SigType"]);
});

test("csPrioritizedTypes: a caller passing fullText=\"\" (the pre-v40 shape) is unaffected — no regression", () => {
  const out = FNGEN.csPrioritizedTypes("void F(SigType a)", undefined, "", new Set(), undefined, "");
  assert.deepEqual(out, ["SigType"]);
});
