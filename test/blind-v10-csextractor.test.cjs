// Blind oracle: the C# surface extractor (session-v10/phase3-brief.md).
// Black-box contract tests written from the SurfaceExtractor interface ALONE,
// before the C# impl exists, pinned against a FAKE runner fed REAL payloads
// captured by driving the actual Roslyn LS headless (see
// test/fixtures/csharp-extract/*.raw.json for provenance).
//
// Target: CsCommandExtractor (src/vscode/csExtractor.ts) — the PRODUCT
// transport. It takes an INJECTED command runner (never imports vscode), so it
// bundles headless and this suite proves the vscode-command -> plain-data
// mapping against fixtures. Plus the C#-shaped pure helpers from
// src/core/csExtraction.ts (parseCsHover + the kind/role mappers).
//
// Never read src/**. Expected RED: csExtractor / csExtraction do not exist yet.
// The guard keeps the red informative: one failing surface test, the rest skip
// until the impl lands (then everything runs).
//
// Run: SKIP_LIVE=1 node --test test/blind-v10-csextractor.test.cjs
// (No model/network here: the runner is a fake; "live" gating never applies.)
//
// ---------------------------------------------------------------------------
// PAYLOAD PROVENANCE + NUMBERING (read this before touching a fixture).
// Every payload below is transcribed from a real Roslyn LS session driven over
// stdio against a scratch project referencing Newtonsoft.Json 13.0.3, on a
// broken (mid-edit) buffer. The raw LSP captures live beside this file in
// test/fixtures/csharp-extract/.
//
// The RAW LS speaks LSP enums (1-indexed). This suite models the PRODUCT
// transport, which sits behind vscode's *command* API and therefore sees
// vscode enums (0-indexed) — the LS number MINUS ONE. So each fixture uses the
// vscode number and names the LSP number it came from:
//   CompletionItemKind  LSP Method=2  -> vscode Method=1
//                       LSP Field=5   -> vscode Field=4
//                       LSP Property=10 -> vscode Property=9
//   SymbolKind          LSP Class=5   -> vscode Class=4
//                       LSP Method=6  -> vscode Method=5
//                       LSP Field=8   -> vscode Field=7
// The *-live suite drives the real LS and therefore asserts the RAW (LSP)
// numbers through csLspExtractor; this suite asserts the vscode numbers.
//
// Roslyn specifics this suite pins (all captured, none fabricated):
//  - The resolved completion signature does NOT ride `detail` (it is absent);
//    it rides `documentation`, whose FIRST LINE is the signature, e.g.
//    "string JsonConvert.SerializeObject(object? value) (+ 7 overloads)". The
//    documentation kind is "plaintext", which vscode delivers as a plain
//    string, so the fixtures use plain-string documentation.
//  - Hover is markdown: a ```csharp fence carries the signature, prose below.
//  - The fully-qualify code action's title is the bare qualified type name
//    ("Newtonsoft.Json.Linq.JObject"); its edit inserts "Newtonsoft.Json.Linq."
//    in-span. The competing auto-import action's title is "using ...;" and its
//    edit writes a using line at the top — C# must prefer qualify, not that.
// ---------------------------------------------------------------------------

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
    "blind-v10-csextractor",
    `export { CsCommandExtractor } from "../src/vscode/csExtractor";\n` +
      `export * as cs from "../src/core/csExtraction";\n`
  ));
} catch (e) {
  bundleError = e;
  cleanup = () => {
    fs.rmSync(path.join(__dirname, ".blind-v10-csextractor.entry.ts"), { force: true });
    fs.rmSync(path.join(__dirname, ".blind-v10-csextractor.bundle.cjs"), { force: true });
  };
}
if (!bundleError && typeof mod.CsCommandExtractor !== "function") {
  bundleError = new Error(
    "the bundle built but exports no CsCommandExtractor class " +
      "(csExtractor.ts must bundle headless — it must NOT import vscode)"
  );
}

const { CsCommandExtractor, cs = {} } = mod;

test.after(() => cleanup());

test("bundle: the v10 C# surface builds (CsCommandExtractor exported, headless-bundleable) [surface: 'phase3-brief: the three new files']", () => {
  if (bundleError) {
    assert.fail(`the C# surface is not implemented yet: ${bundleError.message}`);
  }
});

// Every other test skips (not fails) while the bundle is broken, so the red run
// stays one loud failure instead of a wall of TypeErrors.
const gtest = (name, fn) =>
  test(name, (ctx) => {
    if (bundleError) return ctx.skip("bundle failed to build; see the bundle test");
    return fn(ctx);
  });

// ---------------------------------------------------------------------------
// Helpers (coordinates: 0-based line, UTF-16 column). Positions are computed
// from fixture text, never hand-counted.
// ---------------------------------------------------------------------------

const posOf = (text, needle, nth = 0) => {
  let idx = -1;
  for (let i = 0; i <= nth; i++) {
    idx = text.indexOf(needle, idx + 1);
    assert.ok(idx >= 0, `fixture needle not found (occurrence ${i}): ${JSON.stringify(needle)}`);
  }
  const before = text.slice(0, idx);
  const line = (before.match(/\n/g) || []).length;
  const character = idx - (before.lastIndexOf("\n") + 1);
  return { line, character };
};
const posAfter = (text, needle, nth = 0) => {
  const p = posOf(text, needle, nth);
  return { line: p.line, character: p.character + needle.length };
};
const byName = (members, name) => members.find((m) => m.name === name);
const names = (members) => members.map((m) => m.name);

// vscode command ids the product transport dispatches on (same set as TS/Rust).
const CMD = {
  complete: "vscode.executeCompletionItemProvider",
  hover: "vscode.executeHoverProvider",
  definition: "vscode.executeDefinitionProvider",
  codeAction: "vscode.executeCodeActionProvider",
  docSymbol: "vscode.executeDocumentSymbolProvider",
};

// vscode stand-ins (the command API answers objects, not strings/plain data).
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

// Fake runner: per-command handlers, calls recorded. (run, cursor, opts).
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

// ===========================================================================
// REAL captured payloads (transcribed verbatim from the LS session).
// ===========================================================================

// --- completion at `JsonConvert.` (a NuGet static type on a broken buffer):
// 20 items; labels + kinds verbatim; the signature rides the resolved
// `documentation` first line (see provenance note). vscode kinds (LSP-1).
const DOC_SERIALIZE =
  "string JsonConvert.SerializeObject(object? value) (+ 7 overloads)\r\n" +
  "Serializes the specified object to a JSON string.";
const DOC_DESERIALIZE =
  "object? JsonConvert.DeserializeObject(string value) (+ 4 overloads)\r\n" +
  "Deserializes the JSON to a .NET object.";
const DOC_DEFAULTSETTINGS =
  "Func<JsonSerializerSettings>? JsonConvert.DefaultSettings { get; set; }\r\n" +
  "Gets or sets a function that creates default JsonSerializerSettings.";
// The MARKDOWN form of the SAME resolved documentation, captured verbatim from
// the real LS under documentationFormat: ["markdown"] (2026-07-17). The product
// transport rides the ms-dotnettools extension, which advertises markdown, so
// the resolved documentation comes back FENCED: line 0 is the ```csharp marker,
// the signature is the line INSIDE the fence, and the "(+ N overloads)" suffix
// moves below the fence (so the markdown signature is not byte-identical to the
// plaintext one — only the core signature is shared). Taking line 0 verbatim
// injected the literal "```csharp" as the signature (the green-but-wrong defect).
const DOC_SERIALIZE_MD =
  "```csharp\n" +
  "string JsonConvert.SerializeObject(object? value)\n" +
  "```\n" +
  "&nbsp;\\(\\+ 7 overloads\\)  \n" +
  "Serializes the specified object to a JSON string\\.";

const JSONCONVERT_COMPLETION = {
  isIncomplete: false,
  items: [
    { label: "SerializeObject", kind: 1, documentation: DOC_SERIALIZE }, // LSP Method=2
    { label: "DeserializeObject", kind: 1, documentation: DOC_DESERIALIZE },
    { label: "PopulateObject", kind: 1 }, // real item, unresolved -> no doc
    { label: "DefaultSettings", kind: 9, documentation: DOC_DEFAULTSETTINGS }, // LSP Property=10
    { label: "Null", kind: 4 }, // LSP Field=5 (a static readonly field)
    // Inherited object members surfaced by the LS at this real site, verbatim:
    { label: "Equals", kind: 1 },
    { label: "ReferenceEquals", kind: 1 },
    { label: "ToString", kind: 1 },
  ],
};

// --- hover markdown (captured): a ```csharp fence + prose (JsonConvert), and a
// signature-only hover (Greet).
const HOVER_JSONCONVERT =
  "```csharp\nclass Newtonsoft.Json.JsonConvert\n```\n  \n" +
  "Provides methods for converting between \\.NET types and JSON types\\.  \n";
const HOVER_GREET = "```csharp\nstring Greeter.Greet()\n```\n  \n";

// --- a broken buffer for the member-site gate + qualify (Program.cs-shaped).
const BUFFER = [
  "using System;",
  "using Newtonsoft.Json;",
  "",
  "class Greeter",
  "{",
  "    public string ToJson()",
  "    {",
  "        return JsonConvert.",
  "    }",
  "    public int Calc()",
  "    {",
  "        return 3 + ",
  "    }",
  "}",
  "",
].join("\n");
const FILE_URI = "file:///fake/spike-app/Program.cs";
const readBuffer = (uri) => (uri === FILE_URI ? BUFFER : undefined);
const cur = (p) => ({ uri: FILE_URI, line: p.line, character: p.character });
const MEMBER_CUR = cur(posAfter(BUFFER, "JsonConvert.")); // right after the dot
const NONMEMBER_CUR = cur(posAfter(BUFFER, "3 + ")); // after an operator+space

// --- definition target: JsonConvert resolves into decompiled metadata-as-source
// (captured as a plain Location; range = the type-name span).
const META_URI = "file:///tmp/MetadataAsSource/deadbeef/JsonConvert.cs";

// --- code actions on an unimported-but-resolvable `JObject` (captured):
// the fully-qualify action + the competing using-import action + noise.
const JOBJECT_CUR = { uri: FILE_URI, line: 11, character: 24 };
const QUALIFY_EDIT = { range: vr(11, 20, 11, 20), newText: "Newtonsoft.Json.Linq." };
const USING_EDIT = { range: vr(2, 0, 2, 0), newText: "using Newtonsoft.Json.Linq;\n" };
const qualifyAction = () => ({
  title: "Newtonsoft.Json.Linq.JObject",
  kind: "quickfix",
  edit: wsEdit([[uriLike(FILE_URI), [{ range: QUALIFY_EDIT.range, newText: QUALIFY_EDIT.newText }]]]),
});
const usingAction = () => ({
  title: "using Newtonsoft.Json.Linq;",
  kind: "quickfix",
  edit: wsEdit([[uriLike(FILE_URI), [{ range: USING_EDIT.range, newText: USING_EDIT.newText }]]]),
});
const noiseActions = () => [
  { title: "Extract method", kind: "refactor.extract", edit: wsEdit([[uriLike(FILE_URI), [{ range: vr(11, 0, 11, 5), newText: "x" }]]]) },
  { title: "Generate type 'JObject'", kind: "quickfix", edit: wsEdit([[uriLike(FILE_URI), [{ range: vr(13, 0, 13, 0), newText: "class JObject {}\n" }]]]) },
  { title: "Fix typo 'JObject'", kind: "quickfix", edit: wsEdit([[uriLike(FILE_URI), [{ range: vr(11, 20, 11, 27), newText: "JObject" }]]]) },
];

// --- documentSymbol of the Greeter class (captured; vscode kinds = LSP-1).
// Member names carry a trailing " : Type" / "(params) : Type"; the C# builder
// must reduce them to the bare identifier a model would type.
const GREETER_SYMBOLS = [
  dsym("Greeter", 4, vr(3, 0, 13, 1), [
    dsym("_name : string", 7, vr(5, 28, 5, 33)),
    dsym("Greeter(string)", 5, vr(6, 4, 6, 49)),
    dsym("Greet() : string", 5, vr(7, 4, 7, 46)),
    dsym("ToJson() : string", 5, vr(9, 4, 12, 5)),
    dsym("WordCount() : int", 5, vr(14, 4, 17, 5)),
  ]),
];

// --- documentSymbol of a class that OVERRIDES object members (captured):
// ToString/Equals/GetHashCode here are the developer's OWN declared overrides.
// documentSymbol is syntactic (declared-only), so these are NOT inherited noise
// — they must SURVIVE membersOfType alongside X/Y/Sum. A bare-name filter cannot
// tell an override from an inherited static, so there is no such filter.
const POINT_SYMBOLS = [
  dsym("Point", 4, vr(2, 0, 10, 1), [
    dsym("X : int", 7, vr(4, 15, 4, 16)),
    dsym("Y : int", 7, vr(5, 15, 5, 16)),
    dsym("Sum() : int", 5, vr(6, 4, 6, 30)),
    dsym("ToString() : string", 5, vr(7, 4, 7, 52)),
    dsym("Equals(object?) : bool", 5, vr(8, 4, 8, 52)),
    dsym("GetHashCode() : int", 5, vr(9, 4, 9, 43)),
  ]),
];

// ===========================================================================
// 1. completeMembers
// ===========================================================================

gtest("completeMembers: resolved documentation -> name/kind/signature; object members appear verbatim [surface: 'completeMembers' + brief-1 'signatures ride resolve']", async () => {
  const { run, calls } = runnerFor({ [CMD.complete]: JSONCONVERT_COMPLETION });
  const ex = new CsCommandExtractor(run, readBuffer);
  const members = await ex.completeMembers(MEMBER_CUR);
  assert.ok(Array.isArray(members), "resolves an array");
  assert.ok(calls.some((c) => c.command === CMD.complete), "dispatches on executeCompletionItemProvider");

  const ser = byName(members, "SerializeObject");
  assert.ok(ser, `the static method completes, got ${JSON.stringify(names(members))}`);
  assert.strictEqual(ser.kind, "method", "CompletionItemKind.Method (vscode 1) -> 'method'");
  assert.ok(
    typeof ser.signature === "string" && ser.signature.includes("SerializeObject(object? value)"),
    `the signature is parsed from the resolved documentation, NOT from (empty) detail, got ${JSON.stringify(ser.signature)}`
  );

  const deser = byName(members, "DeserializeObject");
  assert.ok(deser && deser.kind === "method");
  assert.ok(
    typeof deser.signature === "string" && deser.signature.includes("DeserializeObject(string value)"),
    `real param list rides the signature, got ${JSON.stringify(deser.signature)}`
  );

  const def = byName(members, "DefaultSettings");
  assert.ok(def, "a property completes");
  assert.strictEqual(def.kind, "field", "CompletionItemKind.Property (vscode 9) -> 'field'");

  assert.ok(byName(members, "Null"), "a static field completes");
  assert.strictEqual(byName(members, "Null").kind, "field", "CompletionItemKind.Field (vscode 4) -> 'field'");

  const popObj = byName(members, "PopulateObject");
  assert.ok(popObj, "an unresolved item is still a member");
  assert.ok(
    popObj.signature === undefined || typeof popObj.signature === "string",
    "an unrendered signature is undefined, never invented"
  );

  // completeMembers returns the LS set verbatim (the interface's contract);
  // object members are not filtered here — that is membersOfType's job.
  assert.ok(byName(members, "ToString"), "the LS set is returned verbatim (object members included at a member site)");

  for (const m of members) {
    assert.strictEqual(m.viaTrait, undefined, `viaTrait is never set for C# (member ${m.name})`);
  }
});

gtest("completeMembers: the member-site gate returns [] at a non-member site and never calls the runner [surface: brief-1 'member-site gate (identifier-dot shape via readText)']", async () => {
  const { run, calls } = runnerFor({ [CMD.complete]: JSONCONVERT_COMPLETION });
  const ex = new CsCommandExtractor(run, readBuffer);
  const members = await ex.completeMembers(NONMEMBER_CUR);
  assert.deepStrictEqual(members, [], "cursor is not after `identifier.` — the gate suppresses, no fabricated members");
  assert.strictEqual(
    calls.filter((c) => c.command === CMD.complete).length,
    0,
    "the gate short-circuits before dispatching completion (a full list would otherwise leak members)"
  );
});

gtest("completeMembers: a THROWING runner REJECTS (never a false definitively-empty) [surface: brief 'each primitive swallows EXCEPT completeMembers, which rejects' + v9 amendment-10]", async () => {
  const boom = async () => {
    throw new Error("roslyn ls gone");
  };
  const ex = new CsCommandExtractor(boom, readBuffer);
  await assert.rejects(
    ex.completeMembers(MEMBER_CUR),
    (e) => e instanceof Error,
    "[] is load-bearing for the member-site output gate, so a dead server must surface as a rejection"
  );
});

gtest("completeMembers: an empty answer at a member site is [] [surface: 'completeMembers' degrade]", async () => {
  const { run } = runnerFor({ [CMD.complete]: { isIncomplete: false, items: [] } });
  const ex = new CsCommandExtractor(run, readBuffer);
  assert.deepStrictEqual(await ex.completeMembers(MEMBER_CUR), [], "empty list -> [] (receiver genuinely has no members)");
});

gtest("completeMembers: MARKDOWN-fenced resolved documentation yields a fence-stripped signature, NOT '```csharp' [surface: brief-1 'signatures ride resolve' — product rides the markdown-advertising extension]", async () => {
  // The product transport rides the ms-dotnettools extension (markdown), so the
  // resolved documentation is fenced. The signature must be the line INSIDE the
  // fence, never the ```csharp marker.
  const completion = { isIncomplete: false, items: [{ label: "SerializeObject", kind: 1, documentation: DOC_SERIALIZE_MD }] };
  const { run } = runnerFor({ [CMD.complete]: completion });
  const members = await new CsCommandExtractor(run, readBuffer).completeMembers(MEMBER_CUR);
  const ser = byName(members, "SerializeObject");
  assert.ok(ser, "the member completes under the markdown documentation form");
  assert.notStrictEqual(ser.signature, "```csharp", "the fence marker is NEVER the signature (the green-but-wrong defect)");
  assert.ok(
    typeof ser.signature === "string" && ser.signature.includes("SerializeObject(object? value)"),
    `the core signature is extracted fence-stripped, got ${JSON.stringify(ser.signature)}`
  );
  assert.ok(!ser.signature.includes("```"), "no fence marker leaks into the signature");
});

gtest("pure csSignatureFromDocumentation: plaintext (line 0) AND markdown (inside-fence) both yield the clean signature [surface: 'csExtraction: signature from documentation, both forms']", () => {
  assert.strictEqual(typeof cs.csSignatureFromDocumentation, "function", "csExtraction exports csSignatureFromDocumentation");
  const fromPlain = cs.csSignatureFromDocumentation(DOC_SERIALIZE);
  assert.ok(fromPlain.includes("SerializeObject(object? value)"), `plaintext form -> ${JSON.stringify(fromPlain)}`);
  const fromMd = cs.csSignatureFromDocumentation(DOC_SERIALIZE_MD);
  assert.strictEqual(fromMd, "string JsonConvert.SerializeObject(object? value)", "markdown form -> the fence body, fence-stripped");
  assert.ok(!fromMd.includes("```"), "no fence marker in the markdown-derived signature");
  assert.strictEqual(cs.csSignatureFromDocumentation(undefined), undefined, "no documentation -> undefined");
  assert.strictEqual(cs.csSignatureFromDocumentation("```csharp\n```"), undefined, "an empty fence -> undefined, never '```csharp'");
});

// ===========================================================================
// 2. hoverSurface
// ===========================================================================

gtest("hoverSurface: the ```csharp fence is the signature, prose below is doc, example undefined [surface: '2. hoverSurface' + parseCsHover]", async () => {
  const { run, calls } = runnerFor({ [CMD.hover]: [{ contents: [{ value: HOVER_JSONCONVERT }] }] });
  const ex = new CsCommandExtractor(run, readBuffer);
  const h = await ex.hoverSurface({ uri: FILE_URI, line: 7, character: 20 });
  assert.ok(calls.some((c) => c.command === CMD.hover), "dispatches on executeHoverProvider");
  assert.ok(h, "a hover with a csharp fence resolves a surface");
  assert.strictEqual(h.signature, "class Newtonsoft.Json.JsonConvert", "the fence body, verbatim");
  assert.ok(
    typeof h.doc === "string" && /Provides methods for converting between/.test(h.doc),
    `the prose below the fence is doc, got ${JSON.stringify(h.doc)}`
  );
  assert.strictEqual(h.example, undefined, "example is ALWAYS undefined for C# (decompiled metadata carries none)");
});

gtest("hoverSurface: a signature-only hover has no doc [surface: 'hoverSurface' + parseCsHover]", async () => {
  const { run } = runnerFor({ [CMD.hover]: [{ contents: [{ value: HOVER_GREET }] }] });
  const h = await new CsCommandExtractor(run, readBuffer).hoverSurface({ uri: FILE_URI, line: 7, character: 20 });
  assert.ok(h, "signature-only hover still resolves");
  assert.strictEqual(h.signature, "string Greeter.Greet()");
  assert.strictEqual(h.doc, undefined, "no prose: doc is absent");
});

gtest("hoverSurface: empty / undefined / throwing hover degrades to undefined [surface: 'hoverSurface' degrade + never-throws]", async () => {
  assert.strictEqual(await new CsCommandExtractor(runnerFor({ [CMD.hover]: [] }).run, readBuffer).hoverSurface(MEMBER_CUR), undefined, "no hovers -> undefined");
  assert.strictEqual(await new CsCommandExtractor(runnerFor({}).run, readBuffer).hoverSurface(MEMBER_CUR), undefined, "runner resolves undefined -> undefined");
  const boom = async () => {
    throw new Error("gone");
  };
  assert.strictEqual(await new CsCommandExtractor(boom, readBuffer).hoverSurface(MEMBER_CUR), undefined, "a throwing runner is swallowed -> undefined");
});

// ===========================================================================
// 3. definition
// ===========================================================================

gtest("definition: a plain Location maps to the DefinitionLocation shape [surface: '3. definition']", async () => {
  const { run, calls } = runnerFor({ [CMD.definition]: [{ uri: uriLike(META_URI), range: vr(21, 20, 21, 31) }] });
  const def = await new CsCommandExtractor(run, readBuffer).definition(MEMBER_CUR);
  assert.ok(calls.some((c) => c.command === CMD.definition), "dispatches on executeDefinitionProvider");
  assert.ok(def, "a Location answer resolves");
  assert.strictEqual(def.uri, META_URI, "the metadata-as-source Uri round-trips to the file:// string");
  assert.deepStrictEqual(def.range, { startLine: 21, startCharacter: 20, endLine: 21, endCharacter: 31 });
});

gtest("definition: a LocationLink prefers the SELECTION range over the full range [surface: brief-3 'prefer targetSelectionRange over targetRange']", async () => {
  const { run } = runnerFor({
    [CMD.definition]: [
      {
        targetUri: uriLike(META_URI),
        targetRange: vr(0, 0, 40, 1), // the whole decompiled type incl. leading doc/attributes
        targetSelectionRange: vr(21, 20, 21, 31), // the type-name span
      },
    ],
  });
  const def = await new CsCommandExtractor(run, readBuffer).definition(MEMBER_CUR);
  assert.ok(def, "a LocationLink answer resolves");
  assert.strictEqual(def.uri, META_URI);
  assert.deepStrictEqual(
    def.range,
    { startLine: 21, startCharacter: 20, endLine: 21, endCharacter: 31 },
    "the selection range (the name), never the full range"
  );
  assert.notStrictEqual(def.range.startLine, 0, "landing on the leading doc/attributes is the failure this avoids");
});

gtest("definition: no locations degrades to undefined; a throwing runner too [surface: 'definition' degrade + never-throws]", async () => {
  assert.strictEqual(await new CsCommandExtractor(runnerFor({ [CMD.definition]: [] }).run, readBuffer).definition(MEMBER_CUR), undefined, "empty -> undefined");
  const boom = async () => {
    throw new Error("gone");
  };
  assert.strictEqual(await new CsCommandExtractor(boom, readBuffer).definition(MEMBER_CUR), undefined, "throwing -> undefined");
});

// ===========================================================================
// 4. example — ALWAYS dark, ZERO runner calls
// ===========================================================================

gtest("example: resolves undefined and invokes NO command, prefer ignored [surface: '4. example ALWAYS DARK, send NO request']", async () => {
  const { run, calls } = runnerFor({ [CMD.hover]: [{ contents: [{ value: HOVER_JSONCONVERT }] }] });
  const ex = new CsCommandExtractor(run, readBuffer);
  assert.strictEqual(await ex.example(MEMBER_CUR), undefined, "no prefer: undefined");
  assert.strictEqual(await ex.example(MEMBER_CUR, "JObject"), undefined, "prefer is ignored: still undefined");
  assert.strictEqual(calls.length, 0, "the runner was never invoked");
});

// ===========================================================================
// 5. qualifyImport
// ===========================================================================

gtest("qualifyImport: the fully-qualify action becomes the in-span single-file QualifyEdit [surface: '5. qualifyImport' + brief 'match the fully-qualify action title']", async () => {
  const { run, calls } = runnerFor({ [CMD.codeAction]: [usingAction(), ...noiseActions(), qualifyAction()] });
  const ex = new CsCommandExtractor(run, readBuffer);
  const edit = await ex.qualifyImport(JOBJECT_CUR);
  assert.ok(calls.some((c) => c.command === CMD.codeAction), "dispatches on executeCodeActionProvider");
  assert.ok(edit, "the fully-qualify fix is matched among the actions");
  assert.strictEqual(edit.newText, "Newtonsoft.Json.Linq.", "the qualify prefix passes through verbatim");
  assert.deepStrictEqual(
    edit.range,
    { startLine: 11, startCharacter: 20, endLine: 11, endCharacter: 20 },
    "the edit is the in-span insertion at the identifier, not a top-of-file using line"
  );
});

gtest("qualifyImport: a `using` auto-import alone is NOT matched — C# prefers qualify [surface: brief-5 'the PREFER-QUALIFY-over-import choice, NOT the using auto-import']", async () => {
  const { run } = runnerFor({ [CMD.codeAction]: [usingAction(), ...noiseActions()] });
  const edit = await new CsCommandExtractor(run, readBuffer).qualifyImport(JOBJECT_CUR);
  assert.strictEqual(edit, undefined, "no fully-qualify action present: the using-import is never substituted for it");
});

gtest("qualifyImport: two distinct fully-qualify fixes are ambiguous -> undefined [surface: brief-5 'distinct-fix-identity ambiguity gate']", async () => {
  const other = {
    title: "System.Text.Json.Nodes.JObject",
    kind: "quickfix",
    edit: wsEdit([[uriLike(FILE_URI), [{ range: vr(11, 20, 11, 20), newText: "System.Text.Json.Nodes." }]]]),
  };
  const { run } = runnerFor({ [CMD.codeAction]: [qualifyAction(), other] });
  const edit = await new CsCommandExtractor(run, readBuffer).qualifyImport(JOBJECT_CUR);
  assert.strictEqual(edit, undefined, "two namespaces resolve the name: never pick one");
});

gtest("qualifyImport: no actions / throwing runner -> undefined [surface: 'qualifyImport' degrade + never-throws]", async () => {
  assert.strictEqual(await new CsCommandExtractor(runnerFor({ [CMD.codeAction]: [] }).run, readBuffer).qualifyImport(JOBJECT_CUR), undefined, "no actions -> undefined");
  const boom = async () => {
    throw new Error("gone");
  };
  assert.strictEqual(await new CsCommandExtractor(boom, readBuffer).qualifyImport(JOBJECT_CUR), undefined, "throwing -> undefined");
});

// ===========================================================================
// 6. membersOfType
// ===========================================================================

gtest("membersOfType: documentSymbol descent -> members with bare names + mapped kinds [surface: '6. membersOfType' product transport]", async () => {
  const { run, calls } = runnerFor({ [CMD.docSymbol]: GREETER_SYMBOLS });
  const ex = new CsCommandExtractor(run, readBuffer);
  const members = await ex.membersOfType({ uri: FILE_URI, line: 3, character: 8 }); // inside the Greeter class
  assert.ok(calls.some((c) => c.command === CMD.docSymbol), "dispatches on executeDocumentSymbolProvider");
  const got = names(members);

  const greet = byName(members, "Greet");
  assert.ok(greet, `the method name is reduced to the bare identifier, got ${JSON.stringify(got)}`);
  assert.strictEqual(greet.kind, "method", "SymbolKind.Method (vscode 5) -> 'method'");
  assert.ok(byName(members, "ToJson") && byName(members, "ToJson").kind === "method", "ToJson is a method");
  assert.ok(byName(members, "WordCount") && byName(members, "WordCount").kind === "method", "WordCount is a method");

  const field = byName(members, "_name");
  assert.ok(field, "the field is a member");
  assert.strictEqual(field.kind, "field", "SymbolKind.Field (vscode 7) -> 'field'");

  assert.strictEqual(byName(members, "Greet() : string"), undefined, "the raw ` : Type`-suffixed name never leaks out");
});

gtest("membersOfType: the developer's OWN ToString/Equals/GetHashCode overrides SURVIVE (documentSymbol is declared-only, so they are not inherited noise) [surface: brief-6 corrected: no bare-name object filter]", async () => {
  const { run } = runnerFor({ [CMD.docSymbol]: POINT_SYMBOLS });
  const members = await new CsCommandExtractor(run, readBuffer).membersOfType({ uri: FILE_URI, line: 2, character: 6 });
  const got = names(members);
  assert.ok(byName(members, "X") && byName(members, "Y"), `domain fields survive, got ${JSON.stringify(got)}`);
  assert.ok(byName(members, "Sum") && byName(members, "Sum").kind === "method", "the domain method survives");
  // These are declared in this class (the captured symbols carry them), so they
  // are the developer's own overrides, not inherited statics — dropping them
  // would delete real API surface (the DROPPED-real-member defect).
  for (const override of ["ToString", "Equals", "GetHashCode"]) {
    assert.ok(byName(members, override), `${override} is the developer's own declared override and MUST survive, got ${JSON.stringify(got)}`);
  }
  assert.strictEqual(byName(members, "ToString").kind, "method", "the ToString override is a method");
});

gtest("membersOfType: outside any type declaration -> []; a throwing runner -> [] [surface: 'membersOfType' degrade + never-throws]", async () => {
  const { run } = runnerFor({ [CMD.docSymbol]: GREETER_SYMBOLS });
  const ex = new CsCommandExtractor(run, readBuffer);
  assert.deepStrictEqual(await ex.membersOfType({ uri: FILE_URI, line: 0, character: 0 }), [], "a using line encloses no type");
  const boom = async () => {
    throw new Error("gone");
  };
  assert.deepStrictEqual(await new CsCommandExtractor(boom, readBuffer).membersOfType({ uri: FILE_URI, line: 3, character: 8 }), [], "throwing -> []");
});

// ===========================================================================
// Pure helpers directly (csExtraction), on the REAL captured shapes/numbers.
// ===========================================================================

gtest("pure parseCsHover: the ```csharp fence -> signature, prose -> doc; signature-only -> no doc [surface: 'csExtraction: parseCsHover']", () => {
  assert.strictEqual(typeof cs.parseCsHover, "function", "csExtraction exports parseCsHover");
  const a = cs.parseCsHover(HOVER_JSONCONVERT);
  assert.ok(a, "a fenced hover parses");
  assert.strictEqual(a.signature, "class Newtonsoft.Json.JsonConvert");
  assert.ok(typeof a.doc === "string" && /Provides methods for converting between/.test(a.doc), `doc from the prose, got ${JSON.stringify(a.doc)}`);
  assert.strictEqual(a.example, undefined, "no C# example tier");
  const b = cs.parseCsHover(HOVER_GREET);
  assert.ok(b && b.signature === "string Greeter.Greet()", "signature-only hover");
  assert.strictEqual(b.doc, undefined, "no prose -> no doc");
  assert.strictEqual(cs.parseCsHover("no fence here, just prose"), undefined, "a fenceless hover degrades to undefined");
});

gtest("pure csVscodeMemberKind / csLspMemberKind: real completion-kind numbers -> MemberKind [surface: 'csExtraction: kind tables']", () => {
  assert.strictEqual(typeof cs.csVscodeMemberKind, "function", "exports csVscodeMemberKind");
  assert.strictEqual(typeof cs.csLspMemberKind, "function", "exports csLspMemberKind");
  // vscode CompletionItemKind (0-indexed): Method=1, Field=4, Property=9.
  assert.strictEqual(cs.csVscodeMemberKind(1), "method", "vscode Method(1) -> method");
  assert.strictEqual(cs.csVscodeMemberKind(4), "field", "vscode Field(4) -> field");
  assert.strictEqual(cs.csVscodeMemberKind(9), "field", "vscode Property(9) -> field");
  // LSP CompletionItemKind (1-indexed): Method=2, Field=5, Property=10 (raw capture).
  assert.strictEqual(cs.csLspMemberKind(2), "method", "LSP Method(2) -> method");
  assert.strictEqual(cs.csLspMemberKind(5), "field", "LSP Field(5) -> field");
  assert.strictEqual(cs.csLspMemberKind(10), "field", "LSP Property(10) -> field");
});

gtest("pure csVscodeSymbolRole / csLspSymbolRole: real documentSymbol-kind numbers -> SymbolRole [surface: 'csExtraction: role tables']", () => {
  assert.strictEqual(typeof cs.csVscodeSymbolRole, "function", "exports csVscodeSymbolRole");
  assert.strictEqual(typeof cs.csLspSymbolRole, "function", "exports csLspSymbolRole");
  // vscode SymbolKind (0-indexed): Class=4, Method=5, Field=7.
  assert.strictEqual(cs.csVscodeSymbolRole(4), "container", "vscode Class(4) -> container");
  assert.strictEqual(cs.csVscodeSymbolRole(5), "method", "vscode Method(5) -> method");
  assert.strictEqual(cs.csVscodeSymbolRole(7), "field", "vscode Field(7) -> field");
  // LSP SymbolKind (1-indexed): Class=5, Method=6, Field=8 (raw capture).
  assert.strictEqual(cs.csLspSymbolRole(5), "container", "LSP Class(5) -> container");
  assert.strictEqual(cs.csLspSymbolRole(6), "method", "LSP Method(6) -> method");
  assert.strictEqual(cs.csLspSymbolRole(8), "field", "LSP Field(8) -> field");
});

// ===========================================================================
// csSignatureRefTypes (goal.md Goal-2 Fix-3): the SIGNATURE-edge extractor that
// drives C# recursive collaborator-graph shapes. Given a resolved type's
// RENDERED member signatures (the `methods` string[] the cross-file walk holds),
// it returns the distinct user types named in their return/param/property
// positions — the graph a fluent/LINQ chain projects through, which a C# hover
// (no field body) cannot express as field edges. Pure, so proven over a fixed
// signature list here; the live suite proves it against the real Roslyn shapes.
// ===========================================================================

gtest("pure csSignatureRefTypes: mines return/param/property user types from rendered C# signatures; leading member name, BCL names, and single-letter generics filtered [surface: 'csExtraction: signature-edge extractor']", () => {
  assert.strictEqual(typeof cs.csSignatureRefTypes, "function", "csExtraction exports csSignatureRefTypes");

  const cases = [
    {
      name: "Stripe's real rendered surface -> its collaborators only",
      // The exact strings the C# transport renders for Atlas.Stripe (probed live).
      sigs: [
        "_tiles : List<Tile>",
        "_seenCodes : HashSet<int>",
        "EnrollTile(Tile) : bool",
        "AggregateFanout() : int",
        "PartitionByLod() : IReadOnlyDictionary<int, List<Tile>>",
        "TileTally : int",
        "Summarize(string?) : StripeSummary",
      ],
      // Tile (param + field + nested generic arg), StripeSummary (return). The
      // member NAMES (EnrollTile/AggregateFanout/PartitionByLod/TileTally/Summarize)
      // are NOT mined; List/HashSet/IReadOnlyDictionary are BCL; int is primitive.
      want: ["Tile", "StripeSummary"],
    },
    {
      name: "the leading member name is never mined as a type",
      // A method whose OWN name is PascalCase and whose body names no user type.
      sigs: ["PartitionByLod() : int", "TileTally : int", "Summarize() : void"],
      want: [],
    },
    {
      name: "a property's type is mined (return/property positions, not just params)",
      sigs: ["Band : LodBand", "Owner : Customer"],
      want: ["LodBand", "Customer"],
    },
    {
      name: "single-letter generics filtered, real return type kept",
      sigs: ["PickLargest<T>(IReadOnlyList<T>) : T", "Wrap(Widget) : Nullable<Widget>"],
      want: ["Widget"],
    },
    {
      name: "dedup across signatures, first-seen order",
      sigs: ["First(Order) : Order", "Second(Order) : Invoice"],
      want: ["Order", "Invoice"],
    },
    {
      name: "an all-BCL / primitive surface yields nothing",
      sigs: ["Count : int", "Items() : IReadOnlyList<String>", "When() : DateTime"],
      want: [],
    },
    {
      // review-p4 Finding 2a: a QUALIFIED type contributes only its last segment.
      // `Atlas.Stripe` is the type `Stripe`; `Atlas` is a namespace — mining it is
      // a wasted round-trip and a `class Atlas` shadow would inject the wrong type.
      name: "a qualified type name mines only its last segment, never the namespace",
      sigs: ["Make() : Atlas.Stripe", "Load(System.IO.Stream) : Atlas.Sub.Tile"],
      want: ["Stripe", "Tile"],
    },
  ];

  for (const { name, sigs, want } of cases) {
    assert.deepStrictEqual(cs.csSignatureRefTypes(sigs), want, name);
  }
  // Empty input is empty output (a type with no rendered members has no edges).
  assert.deepStrictEqual(cs.csSignatureRefTypes([]), [], "no signatures -> no referenced types");
});

// ===========================================================================
// SEQUENCING FLIP (phase 4): extractorFor("csharp") was DARK through phase 3 —
// the product extractor is registered ATOMICALLY in phase 4 with the gesture
// wiring, so C# never runs half-wired on a Rust default. This assertion flipped
// from `undefined` to a resolved C# extractor when phase 4 landed (the honest
// counterpart to the phase-2 oracleFor flip). extractorFor imports vscode, so it
// is bundled headless here against a vscode stub. If it cannot be built/loaded
// headless, this lock is deferred to the phase-4 blind suite (documented).
// ===========================================================================

test("sequencing: extractorFor('csharp') resolves the C# product extractor now phase 4 has registered it [surface: phase4 go-live flip]", (ctx) => {
  const esbuild = require("esbuild");
  const stub = path.join(__dirname, ".blind-v10-vscode-stub.js");
  const entry = path.join(__dirname, ".blind-v10-extractorfor.entry.ts");
  const outfile = path.join(__dirname, ".blind-v10-extractorfor.bundle.cjs");
  const sweep = () => {
    for (const f of [stub, entry, outfile]) fs.rmSync(f, { force: true });
  };
  let extractorFor;
  try {
    // A permissive vscode stand-in: any property access yields a callable/proxy,
    // enough for module top-level to evaluate without a real vscode host.
    fs.writeFileSync(
      stub,
      "const h={get:()=>new Proxy(function(){},h),apply:()=>undefined};module.exports=new Proxy(function(){},h);"
    );
    fs.writeFileSync(entry, `export { extractorFor } from "../src/vscode/extractors";\n`);
    esbuild.buildSync({
      entryPoints: [entry],
      bundle: true,
      outfile,
      format: "cjs",
      platform: "node",
      alias: { vscode: stub },
    });
    ({ extractorFor } = require(outfile));
  } catch (e) {
    sweep();
    return ctx.skip(`extractorFor not bundleable headless yet; the phase-4 blind suite owns this lock live: ${e.message}`);
  }
  try {
    assert.strictEqual(typeof extractorFor, "function", "extractorFor is exported");
    const cs = extractorFor("csharp");
    assert.ok(cs, "csharp resolves the C# product extractor (registered atomically in phase 4)");
    assert.notStrictEqual(cs.constructor, extractorFor("rust").constructor, "the C# extractor is its own class, not the Rust default");
  } finally {
    sweep();
  }
});
