// Implementer's tests for the C# surface extractor: the edge and error paths
// the blind oracle (blind-v10-csextractor) could not see from the interface
// alone — dead-runner degrade shapes, LocationLink vs plain Location, malformed
// and partial payloads, the member-site gate boundaries, the full LSP/vscode
// kind-number tables, the object-noise filter, and the signature-from-
// documentation parser's line-splitting. Bundled headless exactly like the blind
// suite (CsCommandExtractor must not import vscode).
//
// Run: SKIP_LIVE=1 node --test test/impl-v10-csextractor.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const { fileURLToPath } = require("node:url");
const { bundleCore } = require("./.blind-util.cjs");

let mod = {};
let cleanup = () => {};
let bundleError;
try {
  ({ mod, cleanup } = bundleCore(
    "impl-v10-csextractor",
    `export { CsCommandExtractor } from "../src/vscode/csExtractor";\n` +
      `export * as cs from "../src/core/csExtraction";\n`
  ));
} catch (e) {
  bundleError = e;
  cleanup = () => {
    fs.rmSync(path.join(__dirname, ".impl-v10-csextractor.entry.ts"), { force: true });
    fs.rmSync(path.join(__dirname, ".impl-v10-csextractor.bundle.cjs"), { force: true });
  };
}
const { CsCommandExtractor, cs = {} } = mod;
test.after(() => cleanup());

test("bundle: the impl entry builds (headless-bundleable) [invariant: entry compiles]", () => {
  if (bundleError) assert.fail(`bundle failed: ${bundleError.message}`);
});

const gtest = (name, fn) =>
  test(name, (ctx) => {
    if (bundleError) return ctx.skip("bundle failed to build; see the bundle test");
    return fn(ctx);
  });

// vscode command ids + stand-ins (mirrors the blind harness).
const CMD = {
  complete: "vscode.executeCompletionItemProvider",
  hover: "vscode.executeHoverProvider",
  definition: "vscode.executeDefinitionProvider",
  codeAction: "vscode.executeCodeActionProvider",
  docSymbol: "vscode.executeDocumentSymbolProvider",
};
const uriLike = (u) => ({ scheme: "file", fsPath: fileURLToPath(u), toString: () => u });
const vr = (sl, sc, el, ec) => ({ start: { line: sl, character: sc }, end: { line: el, character: ec } });
const wsEdit = (entries) => ({ entries: () => entries });
const dsym = (name, kind, range, children = [], detail = name) => ({
  name,
  detail,
  kind,
  range,
  selectionRange: vr(range.start.line, range.start.character, range.start.line, range.start.character + 1),
  children,
});
const runnerFor = (handlers) => {
  const calls = [];
  const run = async (command, cursor, opts) => {
    calls.push({ command, cursor, opts });
    const h = handlers[command];
    if (h === undefined) return undefined;
    return typeof h === "function" ? h(cursor, opts) : h;
  };
  return { run, calls };
};
const boom = async () => {
  throw new Error("roslyn gone");
};
const names = (ms) => ms.map((m) => m.name);
const byName = (ms, n) => ms.find((m) => m.name === n);

const FILE_URI = "file:///fake/app/Program.cs";

// ===========================================================================
// Pure: csSignatureFromDocumentation — the signature is the FIRST line, split
// on CRLF or LF; absent/blank documentation yields no signature.
// ===========================================================================

gtest("pure csSignatureFromDocumentation: first line only, CRLF and LF, blank -> undefined [invariant: signature is documentation head]", () => {
  const cases = [
    ["string F.M(int a) (+ 2 overloads)\r\nprose about M.", "string F.M(int a) (+ 2 overloads)"],
    ["int F.N()\nline two\nline three", "int F.N()"],
    ["only one line, no newline", "only one line, no newline"],
    ["   spaced signature   \r\ndoc", "spaced signature"],
  ];
  for (const [doc, want] of cases) {
    assert.strictEqual(cs.csSignatureFromDocumentation(doc), want, `doc=${JSON.stringify(doc)}`);
  }
  for (const empty of [undefined, "", "   ", "\r\n\r\n"]) {
    assert.strictEqual(cs.csSignatureFromDocumentation(empty), undefined, `blank doc ${JSON.stringify(empty)} -> undefined`);
  }
});

// ===========================================================================
// Pure: csBareMemberName — the leading C# identifier, chrome stripped.
// ===========================================================================

gtest("pure csBareMemberName: strips the ' : Type' / '(params)' chrome to the identifier [invariant: bare member name]", () => {
  const cases = [
    ["Greet() : string", "Greet"],
    ["_name : string", "_name"],
    ["Greeter(string)", "Greeter"],
    ["Sum() : int", "Sum"],
    ["X : int", "X"],
    ["DeserializeAnonymousType<T>(string) : T", "DeserializeAnonymousType"],
    ["PlainName", "PlainName"],
    ["  Padded() : void  ", "Padded"],
  ];
  for (const [raw, want] of cases) {
    assert.strictEqual(cs.csBareMemberName(raw), want, `raw=${JSON.stringify(raw)}`);
  }
});

// ===========================================================================
// Pure: the kind/role tables in FULL (the blind suite pinned only 3 rows each).
// ===========================================================================

gtest("pure csVscodeMemberKind: full vscode CompletionItemKind table + non-number -> other [invariant: vscode completion kind map]", () => {
  const table = { 1: "method", 2: "function", 3: "method", 4: "field", 9: "field", 19: "field", 6: "other", 7: "other" };
  for (const [k, want] of Object.entries(table)) {
    assert.strictEqual(cs.csVscodeMemberKind(Number(k)), want, `vscode kind ${k}`);
  }
  for (const nonMember of [0, 13, 14]) {
    assert.strictEqual(cs.csVscodeMemberKind(nonMember), undefined, `vscode non-member kind ${nonMember} -> undefined`);
  }
  for (const bad of [undefined, null, "1", {}]) {
    assert.strictEqual(cs.csVscodeMemberKind(bad), "other", `non-number ${JSON.stringify(bad)} -> other`);
  }
});

gtest("pure csLspMemberKind: full LSP CompletionItemKind table (vscode+1) + non-member drops [invariant: LSP completion kind map]", () => {
  const table = { 2: "method", 3: "function", 4: "method", 5: "field", 10: "field", 20: "field" };
  for (const [k, want] of Object.entries(table)) {
    assert.strictEqual(cs.csLspMemberKind(Number(k)), want, `LSP kind ${k}`);
  }
  for (const nonMember of [1, 14, 15]) {
    assert.strictEqual(cs.csLspMemberKind(nonMember), undefined, `LSP non-member kind ${nonMember} -> undefined`);
  }
  assert.strictEqual(cs.csLspMemberKind("x"), "other", "non-number -> other");
});

gtest("pure csVscodeSymbolRole / csLspSymbolRole: containers + members across both enums [invariant: symbol role maps]", () => {
  // vscode (0-indexed): Class=4, Struct=22, Interface=10, Enum=9; Method=5, Ctor=8, Field=7, Prop=6.
  for (const c of [4, 22, 10, 9]) assert.strictEqual(cs.csVscodeSymbolRole(c), "container", `vscode container ${c}`);
  assert.strictEqual(cs.csVscodeSymbolRole(5), "method");
  assert.strictEqual(cs.csVscodeSymbolRole(8), "method", "vscode Constructor -> method");
  // Field=7, Property=6, Constant=13, EnumMember=21 -> field.
  for (const f of [6, 7, 13, 21]) assert.strictEqual(cs.csVscodeSymbolRole(f), "field", `vscode field-ish ${f}`);
  assert.strictEqual(cs.csVscodeSymbolRole(12), "other", "vscode unmapped (Variable=12) -> other");
  // LSP (1-indexed): Class=5, Struct=23, Interface=11, Enum=10; Method=6, Ctor=9, Field=8, Prop=7.
  for (const c of [5, 23, 11, 10]) assert.strictEqual(cs.csLspSymbolRole(c), "container", `LSP container ${c}`);
  assert.strictEqual(cs.csLspSymbolRole(6), "method");
  assert.strictEqual(cs.csLspSymbolRole(9), "method", "LSP Constructor -> method");
  // Field=8, Property=7, Constant=14, EnumMember=22 -> field.
  for (const f of [7, 8, 14, 22]) assert.strictEqual(cs.csLspSymbolRole(f), "field", `LSP field-ish ${f}`);
});

gtest("pure symbol-role PARITY: EnumMember (vscode 21 / LSP 22) and Constant (vscode 13 / LSP 14) map to 'field' in BOTH tables [invariant: cross-transport role parity]", () => {
  assert.strictEqual(cs.csVscodeSymbolRole(21), cs.csLspSymbolRole(22), "EnumMember reads identically across transports");
  assert.strictEqual(cs.csVscodeSymbolRole(21), "field", "EnumMember -> field");
  assert.strictEqual(cs.csVscodeSymbolRole(13), cs.csLspSymbolRole(14), "Constant reads identically across transports");
  assert.strictEqual(cs.csVscodeSymbolRole(13), "field", "Constant -> field");
});

// ===========================================================================
// Pure: isCsFullyQualifyTitle — the fully-qualify vs using/refactor titles.
// ===========================================================================

gtest("pure isCsFullyQualifyTitle: dotted type path yes; using/generate/typo/space no [invariant: fully-qualify title match]", () => {
  const yes = ["Newtonsoft.Json.Linq.JObject", "System.Text.Json.Nodes.JObject", "A.B"];
  const no = [
    "using Newtonsoft.Json.Linq;",
    "Generate type 'JObject'",
    "Fix typo 'JObject'",
    "Extract method",
    "JObject", // a single identifier is not a qualified path
    "Newtonsoft.Json.Linq.", // trailing dot
    ".Leading",
  ];
  for (const t of yes) assert.strictEqual(cs.isCsFullyQualifyTitle(t), true, `should match: ${t}`);
  for (const t of no) assert.strictEqual(cs.isCsFullyQualifyTitle(t), false, `should NOT match: ${t}`);
});

// ===========================================================================
// Pure: selectCsTypeCursor — the workspace-symbol resolution leg's selection.
// Roslyn's workspace/symbol is FUZZY, so the leg must pick the EXACT-name TYPE
// (role container), prefer a non-metadata workspace location, and refuse a
// non-type / partial-name hit (the wrong-type guard).
// ===========================================================================

gtest("pure selectCsTypeCursor: exact-name TYPE among fuzzy hits, non-type refused, workspace preferred over metadata [invariant: by-name type selection]", () => {
  const cand = (name, role, uri, line = 0, character = 0, containerName = "Atlas") => ({ name, role, containerName, uri, line, character });
  // The real csharp-scratch fuzzy set for "Stripe": StripeSummary (container),
  // StripeMutatorSite (method), StripeFanout (method), Stripe (container).
  const fuzzy = [
    cand("StripeSummary", "container", "file:///r/Atlas.cs", 127, 30),
    cand("StripeMutatorSite", "method", "file:///r/Fim.cs", 14, 23),
    cand("StripeFanout", "method", "file:///r/Fns.cs", 10, 22),
    cand("Stripe", "container", "file:///r/Atlas.cs", 137, 20),
  ];
  assert.deepStrictEqual(
    cs.selectCsTypeCursor(fuzzy, "Stripe"),
    { uri: "file:///r/Atlas.cs", line: 137, character: 20 },
    "the exact-name container wins over partial-name and non-type hits"
  );
  // A NON-type name (only a method matches exactly) -> undefined, never a
  // wrong-type surface.
  assert.strictEqual(
    cs.selectCsTypeCursor([cand("StripeFanout", "method", "file:///r/Fns.cs", 10, 22)], "StripeFanout"),
    undefined,
    "an exact-name METHOD is not a type -> undefined"
  );
  // No exact-name hit at all -> undefined (a substring container is not accepted).
  assert.strictEqual(cs.selectCsTypeCursor([cand("StripeSummary", "container", "file:///r/A.cs")], "Stripe"), undefined, "no exact-name type -> undefined");
  // Prefer a real workspace location over a decompiled metadata-as-source file.
  const meta = [
    cand("Widget", "container", "file:///tmp/MetadataAsSource/x/Widget.cs", 5, 10),
    cand("Widget", "container", "file:///proj/Widget.cs", 2, 13),
  ];
  assert.deepStrictEqual(
    cs.selectCsTypeCursor(meta, "Widget"),
    { uri: "file:///proj/Widget.cs", line: 2, character: 13 },
    "the workspace source location is preferred over metadata-as-source"
  );
  // Metadata-only exact type still resolves (defensive fallback), never dropped.
  assert.deepStrictEqual(
    cs.selectCsTypeCursor([cand("Widget", "container", "file:///tmp/MetadataAsSource/x/Widget.cs", 5, 10)], "Widget"),
    { uri: "file:///tmp/MetadataAsSource/x/Widget.cs", line: 5, character: 10 },
    "a metadata-only type is the fallback, not a drop"
  );
  // review-p3live Finding 1 (GUARDRAIL): two exact-name types in DIFFERENT
  // namespaces is genuinely ambiguous — degrade to undefined, never inject the
  // wrong type's members under "use these exact names". Common (Timer, Task...).
  const rival = [
    cand("Stripe", "container", "file:///r/Atlas.cs", 137, 20, "Atlas"),
    cand("Stripe", "container", "file:///r/Rival.cs", 4, 20, "Rival"),
  ];
  assert.strictEqual(
    cs.selectCsTypeCursor(rival, "Stripe"),
    undefined,
    "same name across two namespaces -> undefined (no wrong-surface guess)"
  );
  // But a partial class (same name AND same namespace, split across files) is ONE
  // type and still resolves — the ambiguity guard must not kill this legit case.
  const partial = [
    cand("Depot", "container", "file:///r/Depot.Bays.cs", 3, 13, "Yard"),
    cand("Depot", "container", "file:///r/Depot.Docks.cs", 3, 13, "Yard"),
  ];
  assert.ok(
    cs.selectCsTypeCursor(partial, "Depot"),
    "a partial class (one namespace, two files) still resolves — not treated as ambiguous"
  );
});

// ===========================================================================
// completeMembers: the member-site gate boundaries + dead-runner semantics.
// ===========================================================================

const gateBuffer = ["class C {", "    void M() {", "        obj?.", "        x = 1 + ", "    }", "}"].join("\n");
const gateReader = (uri) => (uri === FILE_URI ? gateBuffer : undefined);

gtest("completeMembers: gate accepts `?.` and a partial member name; rejects operator/keyword sites [invariant: identifier-dot gate]", async () => {
  const items = { items: [{ label: "Foo", kind: 1 }] };
  // `obj?.` — cursor right after the dot: accepted (a member site).
  const afterQDot = { uri: FILE_URI, line: 2, character: gateBuffer.split("\n")[2].length };
  // A partial member name after a dot ("obj?.Fo") is still a member site.
  const partialBuffer = gateBuffer.replace("        obj?.", "        obj.Fo");
  const partialReader = (u) => (u === FILE_URI ? partialBuffer : undefined);
  const partialCur = { uri: FILE_URI, line: 2, character: "        obj.Fo".length };
  // `1 + ` — after an operator+space: rejected.
  const afterOp = { uri: FILE_URI, line: 3, character: gateBuffer.split("\n")[3].length };

  const a = runnerFor({ [CMD.complete]: items });
  assert.strictEqual((await new CsCommandExtractor(a.run, gateReader).completeMembers(afterQDot)).length, 1, "`?.` is a member site");
  assert.ok(a.calls.some((c) => c.command === CMD.complete), "runner dispatched at the member site");

  const b = runnerFor({ [CMD.complete]: items });
  assert.strictEqual((await new CsCommandExtractor(b.run, partialReader).completeMembers(partialCur)).length, 1, "partial member name is a member site");

  const c = runnerFor({ [CMD.complete]: items });
  assert.deepStrictEqual(await new CsCommandExtractor(c.run, gateReader).completeMembers(afterOp), [], "operator site -> []");
  assert.strictEqual(c.calls.filter((x) => x.command === CMD.complete).length, 0, "operator site never dispatches");
});

gtest("completeMembers: an absent reader / unknown-uri reader PROCEEDS (trust the caller) [invariant: gate is best-effort]", async () => {
  const items = { items: [{ label: "Foo", kind: 1 }] };
  const cur = { uri: FILE_URI, line: 2, character: 3 };
  const noReader = runnerFor({ [CMD.complete]: items });
  assert.strictEqual((await new CsCommandExtractor(noReader.run).completeMembers(cur)).length, 1, "no reader -> proceed");
  const otherUri = runnerFor({ [CMD.complete]: items });
  // reader that returns undefined for this uri -> proceed (trust the caller)
  assert.strictEqual(
    (await new CsCommandExtractor(otherUri.run, () => undefined).completeMembers(cur)).length,
    1,
    "unreadable uri -> proceed"
  );
});

gtest("completeMembers: a dead runner REJECTS at a member site but NOT at a gated non-member site [invariant: reject only when dispatched]", async () => {
  const memberCur = { uri: FILE_URI, line: 2, character: gateBuffer.split("\n")[2].length };
  const opCur = { uri: FILE_URI, line: 3, character: gateBuffer.split("\n")[3].length };
  await assert.rejects(new CsCommandExtractor(boom, gateReader).completeMembers(memberCur), /roslyn gone/, "dead runner at member site rejects");
  assert.deepStrictEqual(
    await new CsCommandExtractor(boom, gateReader).completeMembers(opCur),
    [],
    "the gate short-circuits a non-member site before the dead runner is touched"
  );
});

gtest("completeMembers: a bare-array result and items missing label/kind are handled [invariant: malformed completion payload]", async () => {
  // A bare array (not a CompletionList) is accepted; a kind-less item defaults to
  // 'other' (kept), a Keyword item drops, a label-less item becomes name "".
  const result = [
    { label: "Real", kind: 1, documentation: "string C.Real()\r\ndoc" },
    { label: "NoKind" }, // kind undefined -> csVscodeMemberKind(undefined) === "other" -> kept
    { label: "Kw", kind: 13 }, // Keyword -> dropped
    { kind: 1 }, // no label -> name ""
  ];
  const { run } = runnerFor({ [CMD.complete]: result });
  const members = await new CsCommandExtractor(run, gateReader).completeMembers({
    uri: FILE_URI,
    line: 2,
    character: gateBuffer.split("\n")[2].length,
  });
  assert.ok(byName(members, "Real") && byName(members, "Real").signature.includes("Real()"), "signature parsed from documentation");
  assert.ok(byName(members, "NoKind") && byName(members, "NoKind").kind === "other", "kind-less item kept as 'other'");
  assert.strictEqual(byName(members, "Kw"), undefined, "keyword dropped");
  assert.ok(members.some((m) => m.name === ""), "label-less item mapped to empty name, not crashed");
});

gtest("completeMembers: documentation as MarkupContent {value} object also yields the signature [invariant: object documentation]", async () => {
  const result = { items: [{ label: "M", kind: 1, documentation: { kind: "plaintext", value: "int C.M(int a)\r\ndoc" } }] };
  const { run } = runnerFor({ [CMD.complete]: result });
  const members = await new CsCommandExtractor(run, gateReader).completeMembers({
    uri: FILE_URI,
    line: 2,
    character: gateBuffer.split("\n")[2].length,
  });
  assert.ok(byName(members, "M").signature.includes("M(int a)"), "MarkupContent.value drives the signature");
});

// ===========================================================================
// hoverSurface / definition: partial-payload and degrade edges.
// ===========================================================================

gtest("hoverSurface: contents as a plain string, and a fenceless hover degrades [invariant: hover contents shapes]", async () => {
  const fenced = "```csharp\nstring C.M()\n```\n  \nprose here.  \n";
  const a = runnerFor({ [CMD.hover]: [{ contents: fenced }] }); // contents is a bare string, not [{value}]
  const ha = await new CsCommandExtractor(a.run).hoverSurface({ uri: FILE_URI, line: 0, character: 0 });
  assert.ok(ha && ha.signature === "string C.M()" && /prose here/.test(ha.doc), "plain-string contents parses");
  const b = runnerFor({ [CMD.hover]: [{ contents: [{ value: "just prose, no fence" }] }] });
  assert.strictEqual(await new CsCommandExtractor(b.run).hoverSurface({ uri: FILE_URI, line: 0, character: 0 }), undefined, "fenceless -> undefined");
});

gtest("definition: a LocationLink with ONLY targetRange (no selection) falls back to it; uri-without-range -> undefined [invariant: definition field fallback]", async () => {
  const META = "file:///tmp/MetadataAsSource/x/JsonConvert.cs";
  const onlyTarget = runnerFor({ [CMD.definition]: [{ targetUri: uriLike(META), targetRange: vr(3, 4, 3, 15) }] });
  const d = await new CsCommandExtractor(onlyTarget.run).definition({ uri: FILE_URI, line: 0, character: 0 });
  assert.deepStrictEqual(d.range, { startLine: 3, startCharacter: 4, endLine: 3, endCharacter: 15 }, "targetRange used when no selection range");
  const noRange = runnerFor({ [CMD.definition]: [{ uri: uriLike(META) }] });
  assert.strictEqual(await new CsCommandExtractor(noRange.run).definition({ uri: FILE_URI, line: 0, character: 0 }), undefined, "uri without range -> undefined");
});

// ===========================================================================
// qualifyImport: resolve-shape and single-edit degrades.
// ===========================================================================

gtest("qualifyImport: a fully-qualify edit that touches a FOREIGN file or multiple edits is rejected [invariant: same-file single-edit]", async () => {
  const OTHER = "file:///fake/app/Other.cs";
  const jobjCur = { uri: FILE_URI, line: 4, character: 20 };
  const foreign = runnerFor({
    [CMD.codeAction]: [
      { title: "N.M.JObject", kind: "quickfix", edit: wsEdit([[uriLike(OTHER), [{ range: vr(4, 20, 4, 20), newText: "N.M." }]]]) },
    ],
  });
  assert.strictEqual(await new CsCommandExtractor(foreign.run, gateReader).qualifyImport(jobjCur), undefined, "edit in a foreign file -> undefined");
  const multi = runnerFor({
    [CMD.codeAction]: [
      {
        title: "N.M.JObject",
        kind: "quickfix",
        edit: wsEdit([[uriLike(FILE_URI), [{ range: vr(4, 20, 4, 20), newText: "N.M." }, { range: vr(0, 0, 0, 0), newText: "x" }]]]),
      },
    ],
  });
  assert.strictEqual(await new CsCommandExtractor(multi.run, gateReader).qualifyImport(jobjCur), undefined, "two edits in the file -> undefined");
});

// ===========================================================================
// membersOfType: noise filter + a STRUCT container (kind 22) + verbatim gate
// on completeMembers (object statics survive completion but not membersOfType).
// ===========================================================================

const structSymbols = [
  dsym("Vec2", 22, vr(0, 0, 8, 1), [
    dsym("X : int", 7, vr(1, 4, 1, 5)),
    dsym("Length() : double", 5, vr(2, 4, 2, 40)),
    // Declared overrides on the struct — the developer's own API, NOT inherited
    // statics (documentSymbol is declared-only). They MUST survive.
    dsym("ToString() : string", 5, vr(3, 4, 3, 40)),
    dsym("GetHashCode() : int", 5, vr(4, 4, 4, 40)),
    dsym("Equals(object?) : bool", 5, vr(5, 4, 5, 60)),
  ]),
];

gtest("membersOfType: a struct (vscode Class-kind 22) descends; declared ToString/GetHashCode/Equals overrides SURVIVE [invariant: struct container, no object-name filter]", async () => {
  const { run } = runnerFor({ [CMD.docSymbol]: structSymbols });
  const members = await new CsCommandExtractor(run).membersOfType({ uri: FILE_URI, line: 1, character: 4 });
  assert.deepStrictEqual(
    new Set(names(members)),
    new Set(["X", "Length", "ToString", "GetHashCode", "Equals"]),
    `every declared member survives (no bare-name object filter), got ${JSON.stringify(names(members))}`
  );
  assert.strictEqual(byName(members, "Length").kind, "method");
  assert.strictEqual(byName(members, "ToString").kind, "method", "the declared ToString override is a method, kept");
});

gtest("completeMembers: object member names come through VERBATIM at a `.`-site (the interface contract, no filtering) [invariant: completion surface is verbatim]", async () => {
  const completion = { items: [{ label: "ToString", kind: 1 }, { label: "GetHashCode", kind: 1 }, { label: "DomainCall", kind: 1 }] };
  const { run } = runnerFor({ [CMD.complete]: completion });
  const members = await new CsCommandExtractor(run, gateReader).completeMembers({
    uri: FILE_URI,
    line: 2,
    character: gateBuffer.split("\n")[2].length,
  });
  assert.ok(byName(members, "ToString") && byName(members, "GetHashCode"), "object members appear at a completion site (verbatim contract)");
});

// ===========================================================================
// resolveTypeCursorByName: the product workspace-symbol leg. A fuzzy
// SymbolInformation[] (vscode shape: kind number + Location{uri,range}) narrows
// to the exact-name container; an absent/throwing symbol runner degrades to
// undefined (no fallback), never a throw.
// ===========================================================================

gtest("resolveTypeCursorByName: fuzzy SymbolInformation[] -> the exact-name container cursor; absent/throwing runner -> undefined [invariant: product by-name resolution + parity]", async () => {
  // vscode SymbolInformation: kind is vscode SymbolKind (Class=4, Struct=22,
  // Method=5); location.uri is a Uri (toString), range.start the name token.
  const sym = (name, kind, uri, line, character) => ({
    name,
    kind,
    location: { uri: uriLike(uri), range: vr(line, character, line, character + name.length) },
  });
  const fuzzy = [
    sym("StripeSummary", 22, "file:///r/Atlas.cs", 127, 30), // Struct container, partial name
    sym("StripeFanout", 5, "file:///r/Fns.cs", 10, 22), // Method, exact-substring but not a type
    sym("Stripe", 4, "file:///r/Atlas.cs", 137, 20), // Class container, exact name
  ];
  const symRunner = async () => fuzzy;
  const ex = new CsCommandExtractor(async () => undefined, undefined, symRunner);
  assert.deepStrictEqual(
    await ex.resolveTypeCursorByName("Stripe"),
    { uri: "file:///r/Atlas.cs", line: 137, character: 20 },
    "the exact-name class is selected from the fuzzy set"
  );
  // A non-type exact name -> undefined (the wrong-type guard).
  assert.strictEqual(await ex.resolveTypeCursorByName("StripeFanout"), undefined, "an exact-name method is not a type");
  // No symbol runner wired -> no fallback, undefined (not a throw).
  assert.strictEqual(await new CsCommandExtractor(async () => undefined).resolveTypeCursorByName("Stripe"), undefined, "absent runner -> undefined");
  // A throwing runner degrades to undefined, never propagates.
  assert.strictEqual(await new CsCommandExtractor(async () => undefined, undefined, boom).resolveTypeCursorByName("Stripe"), undefined, "throwing runner -> undefined");
});

// ===========================================================================
// example stays dark regardless of arguments (the zero-dispatch invariant, but
// with a runner that WOULD answer every command — proving nothing is called).
// ===========================================================================

gtest("example: dark for any cursor/prefer, zero dispatches even with a live-answering runner [invariant: example sends nothing]", async () => {
  const { run, calls } = runnerFor({
    [CMD.complete]: { items: [{ label: "X", kind: 1 }] },
    [CMD.hover]: [{ contents: [{ value: "```csharp\nx\n```" }] }],
  });
  const ex = new CsCommandExtractor(run, gateReader);
  assert.strictEqual(await ex.example({ uri: FILE_URI, line: 2, character: 3 }), undefined);
  assert.strictEqual(await ex.example({ uri: FILE_URI, line: 2, character: 3 }, "Anything"), undefined);
  assert.strictEqual(calls.length, 0, "no command was ever dispatched");
});

// Pure: isCsAddImportAction — the recognizer that routes Roslyn's AddImport
// `using X;` quickfix out of span (Goal C). The live oracle proves it over the
// REAL action list; this pins the accept/reject matrix over synthetic shapes,
// including the vscode-transport (CustomTags-stripped) title-only fallback and
// the `global using` form (review-p5 Finding 5).
gtest("pure isCsAddImportAction: accepts the using AddImport, rejects fully-qualify / generate-type / fix-typo [invariant: only a using directive routes out-of-span]", () => {
  const tag = (title) => ({ title, data: { CustomTags: ["AddImport"] } });
  // Tagged AddImport with a using-shaped title: accepted.
  assert.ok(cs.isCsAddImportAction(tag("using Atlas;")), "using X; with the AddImport tag");
  assert.ok(cs.isCsAddImportAction(tag("global using Atlas;")), "global using X; is also an import directive");
  // Tagged AddImport but a NON-using title (a future retagging): rejected by the
  // title cross-check, never smuggled through.
  assert.ok(!cs.isCsAddImportAction(tag("Atlas.Stripe")), "a dotted fully-qualify title fails the using shape even if tagged");
  // vscode command transport strips data -> title-only fallback: a using title
  // is accepted, the unwanted quickfixes are not.
  assert.ok(cs.isCsAddImportAction({ title: "using Atlas;" }), "title-only fallback accepts a using directive");
  assert.ok(!cs.isCsAddImportAction({ title: "Atlas.Stripe" }), "title-only: fully-qualify rejected");
  assert.ok(!cs.isCsAddImportAction({ title: "Generate type 'Stripe'" }), "title-only: generate-type rejected");
  assert.ok(!cs.isCsAddImportAction({ title: "Fix typo 'Stripe'" }), "title-only: fix-typo rejected");
  assert.ok(!cs.isCsAddImportAction({ title: "using var s = Open();" }), "a `using var` statement is not an import directive (no trailing ; on a type name)");
  assert.ok(!cs.isCsAddImportAction({}), "a shapeless action is rejected");
});
