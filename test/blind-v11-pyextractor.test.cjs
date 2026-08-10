// BLIND ORACLE — v11 (Python) contract for the PRODUCT transport
// PyCommandExtractor (src/vscode/pyExtractor.ts) + the Python pure helpers
// (src/core/pyExtraction.ts). Black-box, from the phase-3 brief + the
// SurfaceExtractor interface ONLY. The class takes an INJECTED command runner
// (never imports vscode), so it bundles headless and this suite proves the
// vscode-command -> plain-data mapping against a FAKE runner fed REAL payload
// shapes.
//
// PAYLOAD PROVENANCE. Every completion/hover/documentSymbol shape below is
// transcribed from a REAL pyright-langserver --stdio session driven this
// session against a scratch workspace (a local source-followable `widgetlib`
// with a doctest, a pydantic `User(BaseModel)`, stdlib `pathlib.Path`, and an
// `Any` receiver from `json.loads`). The PROVEN facts baked in:
//   - The resolved-completion signature does NOT ride `detail` (it is
//     `undefined`); it rides `documentation`, a MARKDOWN ```python fence whose
//     body is the signature. (OQ-6 answered LIVE: field is `documentation`.)
//   - A stdlib symbol's documentation is `sig-fence + --- + prose`, no `>>>`.
//   - A site-packages/local-source symbol WITH a doctest carries the `>>>`
//     block in `documentation`, inside a bare ``` fence after the prose.
//   - An `Any`/Unknown receiver (`json.loads(...)`) completes to ZERO items.
//   - A pydantic receiver completes to ~98 items incl. `model_dump`, the class
//     fields `name`/`age` (CompletionItemKind Variable), single-underscore
//     `_iter` KEPT, and ~64 dunders that the by-name filter drops.
//
// The RAW LS speaks LSP enums (1-indexed); the PRODUCT transport sits behind
// vscode's *command* API and sees vscode enums (0-indexed = LSP - 1). This suite
// asserts the vscode numbers; the *-live suite asserts the raw LSP numbers.
//
// Never read src/**. Expected RED: pyExtractor / pyExtraction do not exist yet.
// The guard keeps the red to one loud failure; the rest skip until the impl lands.
//
// Run: SKIP_LIVE=1 node --test test/blind-v11-pyextractor.test.cjs
// (No model/network: the runner is a fake; "live" gating never applies.)

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
    "blind-v11-pyextractor",
    `export { PyCommandExtractor } from "../src/vscode/pyExtractor";\n` +
      `export * as py from "../src/core/pyExtraction";\n`,
  ));
} catch (e) {
  bundleError = e;
  cleanup = () => {
    fs.rmSync(path.join(__dirname, ".blind-v11-pyextractor.entry.ts"), { force: true });
    fs.rmSync(path.join(__dirname, ".blind-v11-pyextractor.bundle.cjs"), { force: true });
  };
}
if (!bundleError && typeof mod.PyCommandExtractor !== "function") {
  bundleError = new Error(
    "the bundle built but exports no PyCommandExtractor class " +
      "(pyExtractor.ts must bundle headless — it must NOT import vscode)",
  );
}
const { PyCommandExtractor, py = {} } = mod;

test.after(() => cleanup());

test("bundle: the v11 Python surface builds (PyCommandExtractor exported, headless-bundleable) [surface: brief (a) 'the three new files']", () => {
  if (bundleError) assert.fail(`the Python surface is not implemented yet: ${bundleError.message}`);
});

const gtest = (name, fn) =>
  test(name, (ctx) => {
    if (bundleError) return ctx.skip("bundle failed to build; see the bundle test");
    return fn(ctx);
  });

// ---------------------------------------------------------------------------
// Helpers (coordinates: 0-based line, UTF-16 column), computed from text.
// ---------------------------------------------------------------------------

const posAfter = (text, needle, nth = 0) => {
  let idx = -1;
  for (let i = 0; i <= nth; i++) {
    idx = text.indexOf(needle, idx + 1);
    assert.ok(idx >= 0, `fixture needle not found (occurrence ${i}): ${JSON.stringify(needle)}`);
  }
  const before = text.slice(0, idx);
  const line = (before.match(/\n/g) || []).length;
  const character = idx - (before.lastIndexOf("\n") + 1) + needle.length;
  return { line, character };
};
const byName = (members, n) => members.find((m) => m.name === n);
const names = (members) => members.map((m) => m.name);

// vscode command ids the product transport dispatches (same set as TS/C#).
const CMD = {
  complete: "vscode.executeCompletionItemProvider",
  hover: "vscode.executeHoverProvider",
  definition: "vscode.executeDefinitionProvider",
  codeAction: "vscode.executeCodeActionProvider",
  docSymbol: "vscode.executeDocumentSymbolProvider",
};

// vscode CompletionItemKind (0-indexed): Text=0 Method=1 Function=2 Field=4
// Variable=5 Class=6 Property=9 Keyword=13 Snippet=14.
const CK = { Text: 0, Method: 1, Function: 2, Field: 4, Variable: 5, Class: 6, Property: 9, Keyword: 13, Snippet: 14 };
// vscode SymbolKind (0-indexed): Class=4 Method=5 Property=6 Field=7 Function=11 Variable=12.
const SK = { Class: 4, Method: 5, Property: 6, Field: 7, Function: 11, Variable: 12 };

const uriLike = (u) => ({ scheme: "file", fsPath: fileURLToPath(u), toString: () => u });
const vr = (sl, sc, el, ec) => ({ start: { line: sl, character: sc }, end: { line: el, character: ec } });
const wsEdit = (entries) => ({ entries: () => entries });
const dsym = (name, kind, range, children = []) => ({ name, detail: "", kind, range, selectionRange: vr(range.start.line, range.start.character, range.start.line, range.start.character + 1), children });

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
// REAL captured payload shapes.
// ===========================================================================

// resolved documentation (MARKDOWN) — signature ONLY (no doctest): pydantic
// model_dump, transcribed (trimmed) from the real resolve.
const DOC_MODEL_DUMP =
  "```python\ndef model_dump(\n    *,\n    mode: str = 'python',\n    exclude_none: bool = False,\n) -> dict[str, Any]\n```";
// resolved documentation WITH a doctest — a local-source Widget.resize (verbatim
// shape from the real resolve): sig fence, `---`, prose, then a bare ``` fence
// holding the `>>>` doctest.
const DOC_RESIZE =
  "```python\ndef resize(n: int) -> str\n```\n---\nResize the widget label.\n\n```\n>>> Widget(\"a\").resize(3)\n'aaa'\n```";
// stdlib documentation — NO doctest (typeshed prose only).
const DOC_CWD = "```python\ndef cwd() -> Path\n```\n---\nReturn a new path pointing to the current working directory.";

// completion at `u.` on the pydantic receiver (vscode kinds; documentation is
// already resolved onto the items — the product uses resolveCount so vscode
// resolves them). Dunders present in the raw set to prove the by-name filter.
const PYDANTIC_COMPLETION = {
  isIncomplete: true,
  items: [
    { label: "__init__", kind: CK.Function }, // dunder -> filtered by name
    { label: "__doc__", kind: CK.Variable }, // dunder -> filtered by name
    { label: "__eq__", kind: CK.Function }, // dunder -> filtered
    { label: "model_dump", kind: CK.Function, documentation: { kind: "markdown", value: DOC_MODEL_DUMP } },
    { label: "model_validate", kind: CK.Method }, // Method(1) -> method
    { label: "name", kind: CK.Variable }, // a class field surfaces as Variable — KEPT
    { label: "age", kind: CK.Variable },
    { label: "_iter", kind: CK.Function }, // single-underscore private -> KEPT
    { label: "model_config", kind: CK.Field }, // Field(4) -> field
    { label: "model_fields", kind: CK.Property }, // Property(9) -> field (kept)
    { label: "if", kind: CK.Keyword }, // Keyword -> dropped (never a member)
    { label: "some snippet", kind: CK.Snippet }, // Snippet -> dropped
  ],
};

// A broken buffer for the member-site gate.
const BUFFER = [
  "from pydantic import BaseModel", // 0
  "", // 1
  "class User(BaseModel):", // 2
  "    name: str", // 3
  "    age: int", // 4
  "", // 5
  "u = User(name='a', age=1)", // 6
  "u.", // 7  member site: cursor right after the dot
  "total = 3 + ", // 8  NON-member site: after an operator+space
].join("\n");
const FILE_URI = "file:///fake/ws/gen.py";
const readBuffer = (uri) => (uri === FILE_URI ? BUFFER : undefined);
const cur = (p) => ({ uri: FILE_URI, line: p.line, character: p.character });
const MEMBER_CUR = cur(posAfter(BUFFER, "u."));
const NONMEMBER_CUR = cur(posAfter(BUFFER, "3 + "));

// ===========================================================================
// 1. completeMembers — the load-bearing member surface
// ===========================================================================

gtest("completeMembers: pydantic `.` site -> real members; signature rides `documentation` (NOT detail); dunders filtered by name, `_iter` kept [surface: brief-1 + Fork 7 + OQ-6]", async () => {
  const { run, calls } = runnerFor({ [CMD.complete]: PYDANTIC_COMPLETION });
  const ex = new PyCommandExtractor(run, readBuffer);
  const members = await ex.completeMembers(MEMBER_CUR);
  assert.ok(Array.isArray(members), "resolves an array");
  assert.ok(calls.some((c) => c.command === CMD.complete), "dispatches on executeCompletionItemProvider");

  const md = byName(members, "model_dump");
  assert.ok(md, `model_dump completes, got ${JSON.stringify(names(members))}`);
  assert.ok(md.kind === "function" || md.kind === "method", `Function(2) -> callable kind, got ${md.kind}`);
  assert.ok(
    typeof md.signature === "string" && md.signature.includes("model_dump(") && md.signature.includes("-> dict"),
    "the signature is parsed from the python fence in DOCUMENTATION (detail is undefined), got " + JSON.stringify(md.signature),
  );
  assert.ok(!md.signature.includes("```"), "no fence marker leaks into the signature");

  assert.strictEqual(byName(members, "model_validate") && byName(members, "model_validate").kind, "method", "Method(1) -> method");

  // pydantic fields arrive as CompletionItemKind.Variable and MUST be kept.
  assert.ok(byName(members, "name"), "the class field `name` (Variable) is a kept member");
  assert.ok(byName(members, "age"), "the class field `age` (Variable) is a kept member");
  assert.ok(["field", "other", "method", "function"].includes(byName(members, "name").kind), "Variable maps to a defined MemberKind (kept)");

  // single-underscore private stays; dunders go.
  assert.ok(byName(members, "_iter"), "single-underscore `_iter` is KEPT (real API)");
  for (const d of ["__init__", "__doc__", "__eq__"]) {
    assert.strictEqual(byName(members, d), undefined, `the dunder ${d} is filtered by name (/^__.+__$/)`);
  }
  // Text/Keyword/Snippet are never members.
  assert.strictEqual(byName(members, "if"), undefined, "Keyword is dropped (never a member)");
  assert.strictEqual(byName(members, "some snippet"), undefined, "Snippet is dropped");

  for (const m of members) assert.strictEqual(m.viaTrait, undefined, `viaTrait never set for Python (${m.name})`);
});

gtest("completeMembers: an Any/Unknown receiver completes to EMPTY -> [] (honest-dark, load-bearing) [surface: brief-1 'json.loads(...) -> EMPTY set']", async () => {
  const { run } = runnerFor({ [CMD.complete]: { isIncomplete: true, items: [] } });
  const members = await new PyCommandExtractor(run, readBuffer).completeMembers(MEMBER_CUR);
  assert.deepStrictEqual(members, [], "an Any receiver returns zero completable members -> []");
});

gtest("completeMembers: the member-site gate returns [] at a non-member site and never dispatches [surface: brief-1 Fork 1 'the .-shape readText gate']", async () => {
  const { run, calls } = runnerFor({ [CMD.complete]: PYDANTIC_COMPLETION });
  const members = await new PyCommandExtractor(run, readBuffer).completeMembers(NONMEMBER_CUR);
  assert.deepStrictEqual(members, [], "cursor is not after `identifier.` -> the gate suppresses");
  assert.strictEqual(calls.filter((c) => c.command === CMD.complete).length, 0, "the gate short-circuits before dispatching");
});

gtest("completeMembers: a THROWING runner REJECTS (never a false definitively-empty) [surface: brief Fork 1 'completeMembers rejects, others swallow']", async () => {
  const boom = async () => { throw new Error("pyright gone"); };
  await assert.rejects(
    new PyCommandExtractor(boom, readBuffer).completeMembers(MEMBER_CUR),
    (e) => e instanceof Error,
    "[] is load-bearing for the member-site gate, so a dead server must surface as a rejection",
  );
});

// ===========================================================================
// 2. hoverSurface — the docstring three-way split (signature / prose / doctest)
// ===========================================================================

const HOVER_VAR = "```python\n(variable) u: User\n```";
const HOVER_RESIZE = DOC_RESIZE; // same markdown shape rides hover
const HOVER_CWD = DOC_CWD;

gtest("hoverSurface: the ```python fence -> signature, prose -> doc, a `>>>` doctest -> example [surface: '2. hoverSurface' + parsePyHover + docstring split]", async () => {
  const { run, calls } = runnerFor({ [CMD.hover]: [{ contents: [{ value: HOVER_RESIZE }] }] });
  const h = await new PyCommandExtractor(run, readBuffer).hoverSurface({ uri: FILE_URI, line: 7, character: 0 });
  assert.ok(calls.some((c) => c.command === CMD.hover), "dispatches on executeHoverProvider");
  assert.ok(h, "a fenced hover resolves a surface");
  assert.strictEqual(h.signature, "def resize(n: int) -> str", "the ```python fence body is the signature");
  assert.ok(typeof h.doc === "string" && /Resize the widget label\./.test(h.doc), `prose below the fence is doc, got ${JSON.stringify(h.doc)}`);
  assert.ok(!/^>>>/m.test(h.doc || ""), "the doctest is NOT left inside doc prose");
  assert.ok(typeof h.example === "string" && h.example.includes('Widget("a").resize(3)'), `the doctest surfaces as example, got ${JSON.stringify(h.example)}`);
});

gtest("hoverSurface: a stdlib symbol has signature + doc but NO example (no doctest) [surface: '2. hoverSurface' stdlib-dark]", async () => {
  const { run } = runnerFor({ [CMD.hover]: [{ contents: [{ value: HOVER_CWD }] }] });
  const h = await new PyCommandExtractor(run, readBuffer).hoverSurface({ uri: FILE_URI, line: 7, character: 0 });
  assert.ok(h, "resolves");
  assert.strictEqual(h.signature, "def cwd() -> Path");
  assert.ok(/Return a new path/.test(h.doc), "prose is doc");
  assert.strictEqual(h.example, undefined, "no `>>>` -> example is dark");
});

gtest("hoverSurface: a signature-only hover has no doc/example; empty/throwing degrades to undefined [surface: 'hoverSurface' degrade + never-throws]", async () => {
  const h = await new PyCommandExtractor(runnerFor({ [CMD.hover]: [{ contents: [{ value: HOVER_VAR }] }] }).run, readBuffer).hoverSurface(MEMBER_CUR);
  assert.ok(h && h.signature === "(variable) u: User", "signature-only hover");
  assert.strictEqual(h.doc, undefined, "no prose -> no doc");
  assert.strictEqual(h.example, undefined, "no doctest -> no example");
  assert.strictEqual(await new PyCommandExtractor(runnerFor({ [CMD.hover]: [] }).run, readBuffer).hoverSurface(MEMBER_CUR), undefined, "no hovers -> undefined");
  const boom = async () => { throw new Error("gone"); };
  assert.strictEqual(await new PyCommandExtractor(boom, readBuffer).hoverSurface(MEMBER_CUR), undefined, "throwing -> undefined");
});

// ===========================================================================
// 3. definition — Location + LocationLink (prefer targetSelectionRange)
// ===========================================================================

const STUB_URI = "file:///stubs/pathlib/__init__.pyi";

gtest("definition: a plain Location maps to the DefinitionLocation shape [surface: '3. definition']", async () => {
  const { run, calls } = runnerFor({ [CMD.definition]: [{ uri: uriLike(STUB_URI), range: vr(153, 6, 153, 10) }] });
  const def = await new PyCommandExtractor(run, readBuffer).definition(MEMBER_CUR);
  assert.ok(calls.some((c) => c.command === CMD.definition), "dispatches on executeDefinitionProvider");
  assert.strictEqual(def.uri, STUB_URI, "the .pyi stub Uri round-trips to the file:// string");
  assert.deepStrictEqual(def.range, { startLine: 153, startCharacter: 6, endLine: 153, endCharacter: 10 });
});

gtest("definition: a LocationLink prefers the SELECTION range over the full range [surface: brief-3 'the LocationLink lesson: prefer targetSelectionRange']", async () => {
  const { run } = runnerFor({
    [CMD.definition]: [{ targetUri: uriLike(STUB_URI), targetRange: vr(150, 0, 170, 1), targetSelectionRange: vr(153, 6, 153, 10) }],
  });
  const def = await new PyCommandExtractor(run, readBuffer).definition(MEMBER_CUR);
  assert.deepStrictEqual(def.range, { startLine: 153, startCharacter: 6, endLine: 153, endCharacter: 10 }, "the selection range (the name), never the full range");
});

gtest("definition: no locations / throwing degrades to undefined [surface: 'definition' degrade + never-throws]", async () => {
  assert.strictEqual(await new PyCommandExtractor(runnerFor({ [CMD.definition]: [] }).run, readBuffer).definition(MEMBER_CUR), undefined, "empty -> undefined");
  const boom = async () => { throw new Error("gone"); };
  assert.strictEqual(await new PyCommandExtractor(boom, readBuffer).definition(MEMBER_CUR), undefined, "throwing -> undefined");
});

// ===========================================================================
// 4. example — CONDITIONALLY lit (Python's first): LIT iff a `>>>` doctest rode
//    the payload. BOTH directions proven.
// ===========================================================================

gtest("example: a doctest-bearing (site-packages/source) hover LIGHTS the snippet, markers stripped [surface: '4. example' + Fork 4 LIT direction]", async () => {
  const { run } = runnerFor({ [CMD.hover]: [{ contents: [{ value: HOVER_RESIZE }] }] });
  const snippet = await new PyCommandExtractor(run, readBuffer).example(MEMBER_CUR);
  assert.ok(typeof snippet === "string" && snippet.length > 0, `a doctest lights example, got ${JSON.stringify(snippet)}`);
  assert.ok(snippet.includes('Widget("a").resize(3)'), "the runnable doctest code is present");
  assert.ok(!/^>>>/m.test(snippet), "the `>>>` prompt markers are stripped from the snippet");
});

gtest("example: a stdlib symbol (typeshed, no doctest) stays DARK [surface: '4. example' + Fork 4 DARK direction — the conditionality is a proven contract]", async () => {
  const { run } = runnerFor({ [CMD.hover]: [{ contents: [{ value: HOVER_CWD }] }] });
  assert.strictEqual(await new PyCommandExtractor(run, readBuffer).example(MEMBER_CUR), undefined, "no `>>>` in the payload -> example is dark (no stdlib special-case)");
});

// ===========================================================================
// 5. qualifyImport — rung 3 (Pylance code action, enrichment) maps to an
//    IMPORTS-REGION (out-of-span) QualifyEdit; ambiguity -> undefined. Rung 2
//    (the owned inserter) is NOT here (it lives in the repair layer).
// ===========================================================================

const UNDEF_CUR = { uri: FILE_URI, line: 6, character: 4 };
const importAction = (title, module, name) => ({
  title,
  kind: "quickfix",
  edit: wsEdit([[uriLike(FILE_URI), [{ range: vr(0, 0, 0, 0), newText: `from ${module} import ${name}\n` }]]]),
});
const noiseActions = () => [
  { title: "Create function", kind: "quickfix", edit: wsEdit([[uriLike(FILE_URI), [{ range: vr(8, 0, 8, 0), newText: "def x(): ...\n" }]]]) },
];

gtest("qualifyImport: a single unambiguous auto-import action -> the imports-region (out-of-span) edit [surface: '5. qualifyImport' rung 3 + broadened QualifyEdit]", async () => {
  const { run, calls } = runnerFor({ [CMD.codeAction]: [importAction('Add "from models import SpecialThing"', "models", "SpecialThing"), ...noiseActions()] });
  const edit = await new PyCommandExtractor(run, readBuffer).qualifyImport(UNDEF_CUR);
  assert.ok(calls.some((c) => c.command === CMD.codeAction), "dispatches on executeCodeActionProvider");
  assert.ok(edit, "the auto-import fix is matched among the actions");
  assert.strictEqual(edit.newText, "from models import SpecialThing\n", "the import statement passes through verbatim");
  assert.strictEqual(edit.range.startLine, 0, "the edit lands at the imports region (out-of-span), the broadened QualifyEdit contract");
});

gtest("qualifyImport: two DISTINCT import fixes for the name are ambiguous -> undefined [surface: brief-5 'ambiguity counted over distinct titles (the C# rule)']", async () => {
  const { run } = runnerFor({
    [CMD.codeAction]: [
      importAction('Add "from models import SpecialThing"', "models", "SpecialThing"),
      importAction('Add "from other import SpecialThing"', "other", "SpecialThing"),
    ],
  });
  assert.strictEqual(await new PyCommandExtractor(run, readBuffer).qualifyImport(UNDEF_CUR), undefined, "two modules resolve the name: never pick one");
});

gtest("qualifyImport: no actions / throwing runner -> undefined [surface: 'qualifyImport' degrade + never-throws]", async () => {
  assert.strictEqual(await new PyCommandExtractor(runnerFor({ [CMD.codeAction]: [] }).run, readBuffer).qualifyImport(UNDEF_CUR), undefined, "no actions -> undefined");
  const boom = async () => { throw new Error("gone"); };
  assert.strictEqual(await new PyCommandExtractor(boom, readBuffer).qualifyImport(UNDEF_CUR), undefined, "throwing -> undefined");
});

// ===========================================================================
// 6. membersOfType — documentSymbol descent + the locals filter
// ===========================================================================

// Real pyright shape (vscode kinds): class User(Class) has name/age(Variable)
// + fetch(Method); fetch has a body local `cached`(Variable). make(Function) is
// a module-level sibling with its own local `u`(Variable). The locals filter:
// neither `cached` nor `u` may surface as a member of User.
const WS_SYMBOLS = [
  dsym("User", SK.Class, vr(2, 0, 12, 0), [
    dsym("name", SK.Variable, vr(3, 4, 3, 8)),
    dsym("age", SK.Variable, vr(4, 4, 4, 7)),
    dsym("fetch", SK.Method, vr(6, 4, 8, 5), [dsym("cached", SK.Variable, vr(7, 8, 7, 14))]),
  ]),
  dsym("make", SK.Function, vr(14, 0, 16, 12), [dsym("u", SK.Variable, vr(15, 4, 15, 5))]),
];

gtest("membersOfType: documentSymbol descent -> the class's attributes+methods; a function's locals do NOT surface (the locals filter) [surface: '6. membersOfType' + Fork 3 locals filter]", async () => {
  const { run, calls } = runnerFor({ [CMD.docSymbol]: WS_SYMBOLS });
  const members = await new PyCommandExtractor(run, readBuffer).membersOfType({ uri: FILE_URI, line: 2, character: 6 });
  assert.ok(calls.some((c) => c.command === CMD.docSymbol), "dispatches on executeDocumentSymbolProvider");
  const got = names(members);
  assert.ok(byName(members, "name") && byName(members, "age"), `class attributes survive, got ${JSON.stringify(got)}`);
  assert.ok(byName(members, "fetch") && byName(members, "fetch").kind === "method", "the method surfaces as a method");
  assert.strictEqual(byName(members, "cached"), undefined, "the method's body local `cached` must NOT be a member of the class (locals filter)");
  assert.strictEqual(byName(members, "u"), undefined, "the module function's local `u` must NOT be a member of the class");
});

gtest("membersOfType: outside any class -> []; throwing -> [] [surface: 'membersOfType' degrade + never-throws]", async () => {
  const ex = new PyCommandExtractor(runnerFor({ [CMD.docSymbol]: WS_SYMBOLS }).run, readBuffer);
  assert.deepStrictEqual(await ex.membersOfType({ uri: FILE_URI, line: 0, character: 0 }), [], "an import line encloses no class");
  const boom = async () => { throw new Error("gone"); };
  assert.deepStrictEqual(await new PyCommandExtractor(boom, readBuffer).membersOfType({ uri: FILE_URI, line: 2, character: 6 }), [], "throwing -> []");
});

// ===========================================================================
// Pure helpers directly (pyExtraction), on the REAL captured shapes/numbers.
// ===========================================================================

gtest("pure parsePyHover: ```python fence -> signature, prose -> doc, `>>>` fence -> example [surface: 'pyExtraction: parsePyHover']", () => {
  assert.strictEqual(typeof py.parsePyHover, "function", "pyExtraction exports parsePyHover");
  const a = py.parsePyHover(DOC_RESIZE);
  assert.ok(a && a.signature === "def resize(n: int) -> str", `signature from the fence, got ${JSON.stringify(a && a.signature)}`);
  assert.ok(/Resize the widget label\./.test(a.doc), "doc from prose");
  assert.ok(a.example && a.example.includes('Widget("a").resize(3)'), "example from the doctest");
  const b = py.parsePyHover(DOC_CWD);
  assert.ok(b && b.example === undefined, "no doctest -> no example");
  assert.strictEqual(py.parsePyHover("just prose, no fence"), undefined, "a fenceless hover degrades to undefined");
});

gtest("pure splitPyDocstring: partitions prose vs doctest [surface: Fork 3 'splitPyDocstring(text) -> {prose, doctest}']", () => {
  assert.strictEqual(typeof py.splitPyDocstring, "function", "pyExtraction exports splitPyDocstring");
  const s = py.splitPyDocstring("Resize the widget label.\n\n>>> Widget(\"a\").resize(3)\n'aaa'");
  assert.ok(/Resize the widget label\./.test(s.prose), "prose captured");
  assert.ok(!/>>>/.test(s.prose), "the doctest is removed from prose");
  assert.ok(s.doctest && /Widget\("a"\)\.resize\(3\)/.test(s.doctest), "doctest captured");
  const none = py.splitPyDocstring("just prose here");
  assert.ok(none.doctest === undefined || none.doctest === "" || none.doctest === null, "no `>>>` -> no doctest");
});

gtest("pure parsePyDoctest: extracts the `>>>` run, markers stripped; undefined when absent [surface: Fork 4 'parsePyDoctest(docstring)']", () => {
  assert.strictEqual(typeof py.parsePyDoctest, "function", "pyExtraction exports parsePyDoctest");
  const snip = py.parsePyDoctest("Prose.\n\n>>> x = Widget(\"a\")\n>>> x.resize(3)\n'aaa'");
  assert.ok(typeof snip === "string" && snip.includes("Widget(\"a\")") && snip.includes("x.resize(3)"), `the runnable doctest, got ${JSON.stringify(snip)}`);
  assert.ok(!/^>>>/m.test(snip), "prompt markers stripped");
  assert.strictEqual(py.parsePyDoctest("no doctest here"), undefined, "no `>>>` -> undefined");
});

gtest("pure isDunder: /^__.+__$/ by name; single-underscore kept [surface: Fork 3 'dunder filter, name-prefix not kind']", () => {
  assert.strictEqual(typeof py.isDunder, "function", "pyExtraction exports isDunder");
  for (const d of ["__init__", "__doc__", "__eq__", "__match_args__"]) assert.strictEqual(py.isDunder(d), true, `${d} is a dunder`);
  for (const k of ["_iter", "_private", "name", "model_dump", "__", "__x"]) assert.strictEqual(py.isDunder(k), false, `${k} is NOT a dunder`);
});

gtest("pure pyVscodeMemberKind / pyLspMemberKind: real completion-kind numbers -> MemberKind; Text/Keyword/Snippet dropped [surface: Fork 3 'kind tables (two, never shared)']", () => {
  assert.strictEqual(typeof py.pyVscodeMemberKind, "function", "exports pyVscodeMemberKind");
  assert.strictEqual(typeof py.pyLspMemberKind, "function", "exports pyLspMemberKind");
  // vscode (0-indexed): Method=1 Function=2 Field=4 Variable=5 Property=9.
  assert.strictEqual(py.pyVscodeMemberKind(CK.Method), "method", "vscode Method(1) -> method");
  assert.strictEqual(py.pyVscodeMemberKind(CK.Function), "function", "vscode Function(2) -> function");
  assert.strictEqual(py.pyVscodeMemberKind(CK.Field), "field", "vscode Field(4) -> field");
  assert.ok(py.pyVscodeMemberKind(CK.Variable) !== undefined, "vscode Variable(5) is KEPT (a class field surfaces as Variable)");
  assert.ok(py.pyVscodeMemberKind(CK.Property) !== undefined, "vscode Property(9) is KEPT");
  assert.strictEqual(py.pyVscodeMemberKind(CK.Text), undefined, "vscode Text(0) -> dropped");
  assert.strictEqual(py.pyVscodeMemberKind(CK.Keyword), undefined, "vscode Keyword(13) -> dropped");
  assert.strictEqual(py.pyVscodeMemberKind(CK.Snippet), undefined, "vscode Snippet(14) -> dropped");
  // LSP (1-indexed) = vscode + 1: Method=2 Function=3 Field=5 Variable=6 Property=10, Text=1 Keyword=14 Snippet=15.
  assert.strictEqual(py.pyLspMemberKind(2), "method", "LSP Method(2) -> method");
  assert.strictEqual(py.pyLspMemberKind(3), "function", "LSP Function(3) -> function");
  assert.strictEqual(py.pyLspMemberKind(5), "field", "LSP Field(5) -> field");
  assert.ok(py.pyLspMemberKind(6) !== undefined, "LSP Variable(6) is KEPT");
  assert.strictEqual(py.pyLspMemberKind(1), undefined, "LSP Text(1) -> dropped");
  assert.strictEqual(py.pyLspMemberKind(15), undefined, "LSP Snippet(15) -> dropped");
});

gtest("pure pyVscodeSymbolRole / pyLspSymbolRole: Class -> container, Method -> method, Field -> field [surface: Fork 3 'role tables']", () => {
  assert.strictEqual(typeof py.pyVscodeSymbolRole, "function", "exports pyVscodeSymbolRole");
  assert.strictEqual(typeof py.pyLspSymbolRole, "function", "exports pyLspSymbolRole");
  // vscode SymbolKind (0-indexed): Class=4 Method=5 Field=7.
  assert.strictEqual(py.pyVscodeSymbolRole(SK.Class), "container", "vscode Class(4) -> container");
  assert.strictEqual(py.pyVscodeSymbolRole(SK.Method), "method", "vscode Method(5) -> method");
  assert.strictEqual(py.pyVscodeSymbolRole(SK.Field), "field", "vscode Field(7) -> field");
  // A function is NOT a container (so its body-locals are structurally excluded).
  assert.notStrictEqual(py.pyVscodeSymbolRole(SK.Function), "container", "vscode Function(11) is NOT a container");
  // LSP SymbolKind (1-indexed): Class=5 Method=6 Field=8.
  assert.strictEqual(py.pyLspSymbolRole(5), "container", "LSP Class(5) -> container");
  assert.strictEqual(py.pyLspSymbolRole(6), "method", "LSP Method(6) -> method");
  assert.strictEqual(py.pyLspSymbolRole(8), "field", "LSP Field(8) -> field");
});

gtest("pure toPyCompletionMember: builds name+kind+signature from the resolved DOCUMENTATION (never detail) [surface: Fork 3 'toPyCompletionMember(label, resolvedDoc, kind)' + OQ-6]", () => {
  assert.strictEqual(typeof py.toPyCompletionMember, "function", "exports toPyCompletionMember");
  const m = py.toPyCompletionMember("model_dump", { kind: "markdown", value: DOC_MODEL_DUMP }, "function");
  assert.strictEqual(m.name, "model_dump");
  assert.strictEqual(m.kind, "function");
  assert.ok(typeof m.signature === "string" && m.signature.includes("model_dump(") && !m.signature.includes("```"), `signature from the doc fence, got ${JSON.stringify(m.signature)}`);
  assert.strictEqual(m.viaTrait, undefined, "Python never sets viaTrait");
  // A member with no resolved documentation carries no invented signature.
  const bare = py.toPyCompletionMember("name", undefined, "field");
  assert.strictEqual(bare.name, "name");
  assert.strictEqual(bare.signature, undefined, "no documentation -> no signature (never invented)");
});

// ===========================================================================
// Rung 2's pure mechanism: pyOwnedImportEdit + PY_STDLIB_MODULES.
// ===========================================================================

gtest("pure PY_STDLIB_MODULES: a bundled typeshed top-level module set [surface: Fork 5 'a static PY_STDLIB_MODULES set bundled in pyExtraction']", () => {
  const s = py.PY_STDLIB_MODULES;
  assert.ok(s, "PY_STDLIB_MODULES exists");
  const has = (m) => (typeof s.has === "function" ? s.has(m) : Array.isArray(s) ? s.includes(m) : false);
  for (const m of ["os", "sys", "json", "pathlib", "collections"]) assert.ok(has(m), `stdlib module ${m} is in the set`);
  assert.ok(!has("numpy"), "a third-party package is NOT in the stdlib set");
});

gtest("pure pyOwnedImportEdit: single top-level hit -> `import <name>` imports-region edit; no-hit / ambiguous -> undefined [surface: Fork 5 'pyOwnedImportEdit(name, moduleUniverse)']", () => {
  assert.strictEqual(typeof py.pyOwnedImportEdit, "function", "exports pyOwnedImportEdit");
  // Single unambiguous hit.
  const hit = py.pyOwnedImportEdit("numpy", ["os", "sys", "numpy", "pandas"]);
  assert.ok(hit, "a known top-level module yields an edit");
  assert.strictEqual(hit.newText.trim(), "import numpy", "the edit is `import <name>`");
  assert.ok(hit.range.startLine <= 1, "the edit lands at the imports region (top of file)");
  // No hit.
  assert.strictEqual(py.pyOwnedImportEdit("requests", ["os", "sys", "numpy"]), undefined, "an unknown name -> undefined (not a top-level module here)");
  // Ambiguous: the same top-level name provided by two distinct sources (stdlib
  // + venv unioned without dedup). The helper must NOT pick one.
  // NOTE (finding): this models the module universe as a flat string[]; if the
  // impl dedups it, represent sources so a stdlib/venv name COLLISION stays
  // detectable — otherwise this case cannot be expressed and the lock must move.
  assert.strictEqual(py.pyOwnedImportEdit("json", ["os", "json", "sys", "json"]), undefined, "a name provided twice (ambiguous) -> undefined");
});

// ===========================================================================
// Transport parity: the product transport renders members THROUGH the shared
// pyExtraction pure helper, so its member shape is byte-identical to the helper
// output for the same input. (The headless transport renders through the same
// helper; the *-live suite proves it end to end.)
// ===========================================================================

gtest("transport parity: product completeMembers member == toPyCompletionMember output for the same (label, doc, kind) [surface: brief 'byte-identical member shapes through the shared pure helpers']", async () => {
  const { run } = runnerFor({ [CMD.complete]: PYDANTIC_COMPLETION });
  const members = await new PyCommandExtractor(run, readBuffer).completeMembers(MEMBER_CUR);
  const productMd = byName(members, "model_dump");
  const helperMd = py.toPyCompletionMember("model_dump", { kind: "markdown", value: DOC_MODEL_DUMP }, productMd.kind);
  assert.deepStrictEqual(productMd, helperMd, "the product member is exactly what the shared helper produces (both transports share the render path)");
});
