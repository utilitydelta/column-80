// Implementer's edge/error-path suite for the v10 phase-4 C# gesture wiring.
// The blind suite (blind-v10-gestures) pins the CONTRACT on representative
// inputs; this suite is the implementer's privilege — it exercises the corners
// the contract does not name: the signature slicer on operators / generics /
// explicit-interface members / lambda-default params, the doc scan on `/** */`
// and mixed/blank trivia, the whole-block detector's boundaries, the C#
// classifier on every CS#### code plus a code it must NOT classify, and the
// qualify cursor. Each case names the invariant it proves.
//
// Run: SKIP_LIVE=1 node --test test/impl-v10-gestures.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");
const { bundleCore } = require("./.blind-util.cjs");

// ---- Bundle 1: the pure core helpers (no vscode). ----
const { mod: core, cleanup: coreCleanup } = bundleCore(
  "impl-v10-gestures-core",
  `export { csDocCommentAbove } from "../src/core/csExtraction";\n` +
    `export { csWholeBlockSite, csTypesInPlay, wholeBlockSiteFor } from "../src/core/fimWholeBlock";\n` +
    `export { classifyCsHallucination, csUnresolvedNameCursor } from "../src/core/compilerDirected";\n`,
);

// ---- Bundle 2: the fnGen helpers (import vscode) vs a permissive Proxy stub —
// csSignatureFromSpanText / csLocalTypeDefinitions / csPrioritizedTypes touch no
// vscode at runtime, so the stub only has to satisfy module-load references. ----
const PROXY_STUB = path.join(__dirname, ".impl-v10-gestures-stub.js");
const fEntry = path.join(__dirname, ".impl-v10-gestures-f.entry.ts");
const fOut = path.join(__dirname, ".impl-v10-gestures-f.bundle.cjs");
// A structural stub: fnGen references vscode.SymbolKind at MODULE LOAD (the
// FUNCTION_KINDS/TYPE_KINDS sets), so a bare Proxy namespace (no own keys) is not
// enough — provide the enum plus the handful of classes the module body names.
// The functions under test touch none of this at runtime.
fs.writeFileSync(
  PROXY_STUB,
  `module.exports = {
    SymbolKind: { Function: 11, Method: 5, Constructor: 8, Struct: 22, Enum: 9 },
    Position: class { constructor(l, c) { this.line = l; this.character = c; } },
    Range: class {},
    Uri: { parse: (s) => ({ toString: () => String(s) }), file: (p) => ({ fsPath: p, toString: () => String(p) }) },
    WorkspaceEdit: class {},
    EventEmitter: class { get event() { return () => ({ dispose() {} }); } fire() {} dispose() {} },
    workspace: { getConfiguration: () => ({ get: (k, f) => f }) },
    window: {}, commands: {}, ProgressLocation: { Window: 10 },
  };`,
);
fs.writeFileSync(
  fEntry,
  `export { csSignatureFromSpanText, csLocalTypeDefinitions, csPrioritizedTypes } from "../src/vscode/fnGen";\n`,
);
esbuild.buildSync({ entryPoints: [fEntry], bundle: true, outfile: fOut, format: "cjs", platform: "node", alias: { vscode: PROXY_STUB } });
const fn = require(fOut);

test.after(() => {
  coreCleanup();
  for (const f of [PROXY_STUB, fEntry, fOut]) fs.rmSync(f, { force: true });
});

// A diagnostic with a single primary span at 1-based (line, col).
const diag = (code, message, lineStart = 5, columnStart = 9) => ({
  code,
  level: "error",
  message,
  spans: [{ isPrimary: true, lineStart, lineEnd: lineStart, columnStart, columnEnd: columnStart + 3 }],
  suggestions: [],
});

// ===========================================================================
// 1. csSignatureFromSpanText — the header slice on the shapes the contract's
// three representative members do not cover.
// ===========================================================================

const SIG_CASES = [
  ["expression-bodied stops at `=>`", "public int Foo() => 1;", "public int Foo()"],
  ["block-bodied stops at `{`", "public int Bar()\n    {\n        return 2;\n    }", "public int Bar()"],
  ["interface member drops the `;`", "int Baz();", "int Baz()"],
  ["bodyless header (no terminator) is the whole header", "public int Raw()", "public int Raw()"],
  ["operator == is not read as an `=>` arrow", "public static bool operator ==(A a, A b) => a.Equals(b);", "public static bool operator ==(A a, A b)"],
  ["generic method keeps its `<T>` clause", "public T Get<T>(T key) => default;", "public T Get<T>(T key)"],
  ["explicit-interface member keeps the qualifier", "int IFoo.Baz() => 3;", "int IFoo.Baz()"],
  ["a `=>` INSIDE the param list (lambda default) is not the body terminator", "public void On(Func<int> f = () => 0)\n{\n}", "public void On(Func<int> f = () => 0)"],
  ["a `;` INSIDE the param list is not the terminator", "public void P(A a = new A(){ })\n{", "public void P(A a = new A(){ })"],
];

for (const [name, span, expected] of SIG_CASES) {
  test(`csSignatureFromSpanText: ${name}`, () => {
    assert.strictEqual(fn.csSignatureFromSpanText(span), expected);
  });
}

// ===========================================================================
// 2. csDocCommentAbove — the `///` run, the `/** */` block, and the negatives.
// getLine(n) returns the raw text of line n; the head is one line below the doc.
// ===========================================================================

const line = (lines) => (n) => lines[n] ?? "";

test("csDocCommentAbove: a single `///` line reaches the head", () => {
  const lines = ["    /// <summary>Adds X.</summary>", "    public int M(int w)"];
  assert.strictEqual(core.csDocCommentAbove(line(lines), 1), "    /// <summary>Adds X.</summary>");
});

test("csDocCommentAbove: a multi-line `///` run is collected whole", () => {
  const lines = ["    /// <summary>", "    /// Adds X.", "    /// </summary>", "    public int M()"];
  const got = core.csDocCommentAbove(line(lines), 3);
  assert.ok(got.includes("<summary>") && got.includes("Adds X.") && got.includes("</summary>"));
});

test("csDocCommentAbove: a `/** */` block comment is a doc", () => {
  const lines = ["    /** Adds X.", "     *  more. */", "    public int M()"];
  const got = core.csDocCommentAbove(line(lines), 2);
  assert.ok(got.includes("Adds X.") && got.includes("more."));
});

test("csDocCommentAbove: a plain `//` comment is NOT a C# doc (only `///` is)", () => {
  const lines = ["    // just a note", "    public int M()"];
  assert.strictEqual(core.csDocCommentAbove(line(lines), 1), undefined);
});

test("csDocCommentAbove: a blank line between the doc and the head breaks the scan", () => {
  const lines = ["    /// <summary>X</summary>", "", "    public int M()"];
  assert.strictEqual(core.csDocCommentAbove(line(lines), 2), undefined);
});

test("csDocCommentAbove: a head at line 0 has nothing above", () => {
  assert.strictEqual(core.csDocCommentAbove(line(["public int M()"]), 0), undefined);
});

test("csDocCommentAbove: a code line ending in `*/` is not a doc block (no `/*` opener above)", () => {
  const lines = ["    int x = a[y] /* trailing */", "    public int M()"];
  // The walk climbs to line 0, finds no `/*` opener and a non-comment line -> undefined.
  assert.strictEqual(core.csDocCommentAbove(line(lines), 1), undefined);
});

// ===========================================================================
// 3. csWholeBlockSite — the header boundary. Types-in-play cases and the darks.
// ===========================================================================

const HDR = (body) => `namespace P;\npublic class C\n{\n${body}`;

test("csWholeBlockSite: a real method header in an empty body is a site naming its user type", () => {
  const site = core.csWholeBlockSite(HDR("    public int Fill(Widget w)\n    {\n        "));
  assert.ok(site, "a site");
  assert.match(site.signature, /\bFill\b/);
  assert.deepStrictEqual(site.types, ["Widget"]);
});

test("csWholeBlockSite: a generic method header keeps the name and the param user type", () => {
  const site = core.csWholeBlockSite(HDR("    public T Make<T>(Widget w)\n    {\n        "));
  assert.ok(site);
  assert.match(site.signature, /\bMake\b/);
  assert.ok(site.types.includes("Widget"), `types=${JSON.stringify(site.types)}`);
  assert.ok(!site.types.includes("T"), "the bare generic param T is not a type in play");
});

test("csWholeBlockSite: a mid-expression body (real content since the brace) is dark", () => {
  assert.strictEqual(
    core.csWholeBlockSite(HDR("    public int Fill(Widget w)\n    {\n        var t = Merge(\n        ")),
    undefined,
  );
});

test("csWholeBlockSite: a control-flow header (`if (...) {`) is a block, not a body", () => {
  const site = core.csWholeBlockSite(HDR("    public int Fill(Widget w)\n    {\n        if (w.Ok(Widget.Empty))\n        {\n            "));
  assert.strictEqual(site, undefined);
});

test("csWholeBlockSite: a class/namespace brace (no param list before `{`) is not a site", () => {
  assert.strictEqual(core.csWholeBlockSite("namespace P;\npublic class C\n{\n    "), undefined);
});

test("csWholeBlockSite: a header naming no user type is not a site (primitives only)", () => {
  assert.strictEqual(core.csWholeBlockSite(HDR("    public int Tick(int n)\n    {\n        ")), undefined);
});

// Fix 2: C# return types are PREFIX, so the single most common method shape (a
// method RETURNING a user type, no user-typed param) must be a site — the type
// is scanned out of the return position, never the method name.
const RETURN_TYPE_CASES = [
  ["a return-type-only user type is a site (Widget Build())", "    public Widget Build()\n    {\n        ", ["Widget"]],
  ["a generic-wrapped return type finds the inner user type (List<Order>)", "    public List<Order> GetOrders()\n    {\n        ", ["Order"]],
  ["a return type with a primitive param is still a site (Customer Find(int id))", "    public Customer Find(int id)\n    {\n        ", ["Customer"]],
  ["return AND param user types union, deduped, name excluded (Order Merge(Widget w))", "    public Order Merge(Widget w)\n    {\n        ", ["Order", "Widget"]],
  ["an attribute on the same line is not a type (`[Pure] Widget Get()`)", "    [Pure] public Widget Get()\n    {\n        ", ["Widget"]],
];
for (const [name, body, expectedTypes] of RETURN_TYPE_CASES) {
  test(`csWholeBlockSite: ${name}`, () => {
    const site = core.csWholeBlockSite(HDR(body));
    assert.ok(site, "a site");
    assert.deepStrictEqual(site.types, expectedTypes, `types=${JSON.stringify(site?.types)}`);
    for (const t of expectedTypes) {
      assert.ok(!/^(Build|GetOrders|Find|Merge|Get)$/.test(t), "no method name leaked as a type");
    }
  });
}

test("csWholeBlockSite: `void NoUser()` stays DARK (void return, no user type)", () => {
  assert.strictEqual(core.csWholeBlockSite(HDR("    public void NoUser()\n    {\n        ")), undefined);
});

test("csWholeBlockSite: `int Plain()` stays DARK (primitive return, no user type)", () => {
  assert.strictEqual(core.csWholeBlockSite(HDR("    public int Plain()\n    {\n        ")), undefined);
});

test("wholeBlockSiteFor: csharp resolves the detector, an unknown id stays dark", () => {
  assert.strictEqual(core.wholeBlockSiteFor("csharp"), core.csWholeBlockSite);
  assert.strictEqual(core.wholeBlockSiteFor("cobol"), undefined);
});

test("csTypesInPlay: BCL names and single-letter generics are excluded, user types kept", () => {
  assert.deepStrictEqual(core.csTypesInPlay("(Widget w, String s, List<Order> o, T t)", new Set(["T"])), ["Widget", "Order"]);
});

// ===========================================================================
// 4. classifyCsHallucination — every classified code, plus a code it must NOT
// classify, plus a span-less diagnostic.
// ===========================================================================

test("classifyCsHallucination: CS1061 is a member miss naming the receiver + member", () => {
  const cls = core.classifyCsHallucination(
    diag("CS1061", "'Widget' does not contain a definition for 'Frobnicate' and no accessible extension method 'Frobnicate' accepting a first argument of type 'Widget' could be found"),
  );
  assert.strictEqual(cls?.kind, "unresolved-method");
  assert.strictEqual(cls.type, "Widget");
  assert.strictEqual(cls.member, "Frobnicate");
  assert.deepStrictEqual(cls.cursor, { line: 4, character: 8 });
});

test("classifyCsHallucination: CS0117 (static member miss) is also the member class", () => {
  const cls = core.classifyCsHallucination(diag("CS0117", "'Console' does not contain a definition for 'WritLine'"));
  assert.strictEqual(cls?.kind, "unresolved-method");
  assert.strictEqual(cls.type, "Console");
});

for (const [code, message] of [
  ["CS0246", "The type or namespace name 'Nonexistent' could not be found (are you missing a using directive or an assembly reference?)"],
  ["CS0234", "The type or namespace name 'Widgets' does not exist in the namespace 'Live' (are you missing an assembly reference?)"],
  ["CS0103", "The name 'Missing' does not exist in the current context"],
]) {
  test(`classifyCsHallucination: ${code} is the QUALIFY class, not an injection (undefined here)`, () => {
    assert.strictEqual(core.classifyCsHallucination(diag(code, message)), undefined);
  });
}

test("classifyCsHallucination: a non-hallucination code (CS0029 conversion) is NOT classified", () => {
  assert.strictEqual(
    core.classifyCsHallucination(diag("CS0029", "Cannot implicitly convert type 'int' to 'string'")),
    undefined,
  );
});

test("classifyCsHallucination: a span-less diagnostic has nowhere to point the extractor", () => {
  assert.strictEqual(
    core.classifyCsHallucination({ code: "CS1061", level: "error", message: "'Widget' does not contain a definition for 'X'", spans: [] }),
    undefined,
  );
});

// ===========================================================================
// 5. csUnresolvedNameCursor — the qualify-class heuristic: matches the three C#
// unresolved-name codes, refuses the member miss and unrelated codes.
// ===========================================================================

for (const [code, message] of [
  ["CS0246", "The type or namespace name 'Nonexistent' could not be found"],
  ["CS0234", "The type or namespace name 'Widgets' does not exist in the namespace 'Live'"],
  ["CS0103", "The name 'Missing' does not exist in the current context"],
]) {
  test(`csUnresolvedNameCursor: ${code} yields the primary-span cursor`, () => {
    assert.deepStrictEqual(core.csUnresolvedNameCursor(diag(code, message, 12, 5)), { line: 11, character: 4 });
  });
}

test("csUnresolvedNameCursor: a CS1061 member miss is NOT a qualify case", () => {
  assert.strictEqual(
    core.csUnresolvedNameCursor(diag("CS1061", "'Widget' does not contain a definition for 'X'")),
    undefined,
  );
});

test("csUnresolvedNameCursor: an unrelated code is refused even with a name-shaped message", () => {
  assert.strictEqual(core.csUnresolvedNameCursor(diag("CS0029", "The name 'x' does not exist")), undefined);
});

// ===========================================================================
// 6. csLocalTypeDefinitions / csPrioritizedTypes — the prefill candidate seam.
// ===========================================================================

test("csLocalTypeDefinitions: class/struct/record at module scope anchor at the name; a comment never anchors", () => {
  const src = "namespace P;\npublic class Widget\n{\n}\ninternal struct Point { }\nrecord Money(int C);\n// class Commented\n";
  const map = fn.csLocalTypeDefinitions(src);
  assert.ok(map.get("Widget"), "Widget class");
  assert.strictEqual(map.get("Widget").line, 1);
  assert.strictEqual(map.get("Widget").character, "public class ".length);
  assert.ok(map.get("Point"), "Point struct");
  assert.ok(map.get("Money"), "Money record");
  assert.ok(!map.has("Commented"), "a commented-out declaration never anchors");
});

test("csPrioritizedTypes: signature user types kept, BCL + single-letter generics filtered", () => {
  const got = fn.csPrioritizedTypes("public Order Handle(Widget w, String s, T t)", undefined, "", new Set());
  assert.ok(got.includes("Order") && got.includes("Widget"), `user types present, got ${JSON.stringify(got)}`);
  assert.ok(!got.includes("String"), "the BCL String is filtered");
  assert.ok(!got.includes("T"), "the bare generic T is filtered");
});
