// BLIND ORACLE for session-v55 phase 10 (Q10): a generic parameter is not a call
// owner. Bound to `session-v55/contract-phase10.md`, written before the fix
// exists, driving `resolveCallOwners` through the public facade over a stubbed
// vscode module. Nothing here reads the function's body.
//
// The defect, in contract terms: when a call's receiver is a generic parameter,
// the enclosing-container walk answers a single uppercase letter such as `T`,
// and that letter passes both existing filters (`stopNamesFor` and
// `/^[A-Z]/`). It is returned as a real owner and it spends one of the leg's
// two KEEP slots. Under a cap an occupied slot is an eviction of something
// real.
//
// Run: SKIP_LIVE=1 node --test test/blind-v55-p10-generic-owner.test.cjs
//
// ---------------------------------------------------------------------------
// WHAT THIS FILE COULD NOT WITNESS, said plainly
// ---------------------------------------------------------------------------
//
// 1. GO NEVER RESOLVES A CALL OWNER AT THIS SEAM, so the carve-out of contract
//    item 3 cannot be witnessed positively. Measured here across container
//    kinds 0-30, member kinds 5/11/7/6, nested trees, gopls-flat trees,
//    `(*T).Fetch` naming, `detail` strings, source text behind
//    `openTextDocument`, and SymbolInformation with `containerName`: with
//    `languageId === "go"` the leg fetches the definition and then reports
//    "its definition sits inside no type" every single time. Every other
//    languageId tried - rust, typescript, javascript, csharp, python, java,
//    cpp, plaintext, "golang", "" - resolves the identical tree. Only the
//    literal string "go" fails, so this is a deliberate branch, not a fixture
//    accident. Consequence: the Go carve-out guards a door that is already
//    shut, exactly the way `crossFileShape.ts:1016-1024` describes Go's field
//    leg as dark. The carve-out is still correct to build (the door can open
//    later), but no black-box row can prove `testing.T` survives today. Rows
//    3a/3b below pin what IS measurable.
//
// 2. Contract item 1's second half, "the round trip that would have been spent
//    on it is not spent", is NOT asserted as a saving. The contract's own
//    ordering section says the parameter name is only known after `definition()`
//    and the symbol walk have both run. Measured: a `T` call costs exactly 1
//    definition round trip today, and it must still cost 1 after the fix. Row 5
//    asserts the thing that IS reachable - the KEEP slot is freed, so a third
//    call gets looked up where today it is skipped by the cap.
//
// 3. "The provenance refusal is not what stops it" (the falsification line) is
//    witnessed indirectly: this file never runs the provenance leg at all. If
//    the owner list comes back without `T` here, provenance had no chance to
//    act. That is the strongest form available at this seam.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");

// ---------------------------------------------------------------------------
// Harness. Same pattern as test/impl-v30-p34-roundlegs.test.cjs: the vscode
// module is aliased to a stub whose documentSymbol answer the test controls.
// ---------------------------------------------------------------------------

const STUB = path.join(__dirname, ".blind-v55-p10-stub.cjs");
fs.writeFileSync(
  STUB,
  `
const state = (globalThis.__v55p10 = globalThis.__v55p10 || { symbols: [] });
class Position { constructor(line, character) { this.line = line; this.character = character; } }
class Range {
  constructor(a, b, c, d) {
    if (typeof a === "number") { this.start = new Position(a, b); this.end = new Position(c, d); }
    else { this.start = a; this.end = b; }
  }
}
class ThemeColor { constructor(id) { this.id = id; } }
class MarkdownString { constructor() { this.blocks = []; } appendCodeblock(t) { this.blocks.push(t); } }
class Diagnostic { constructor(range, message, severity) { this.range = range; this.message = message; this.severity = severity; } }
const Uri = {
  file: (p) => ({ fsPath: p, path: p, scheme: "file", toString: () => "file://" + p }),
  parse: (s) => ({ raw: s, toString: () => s }),
};
module.exports = {
  __state: state,
  Position, Range, ThemeColor, MarkdownString, Diagnostic, Uri,
  DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
  SymbolKind: { File: 0, Module: 1, Class: 4, Method: 5, Field: 7, Enum: 9, Interface: 10, Function: 11, Object: 18, Struct: 22 },
  workspace: {
    getConfiguration: () => ({ get: (k, fb) => fb, inspect: () => undefined, update: async () => {} }),
    get textDocuments() { return []; },
    openTextDocument: async (u) => ({ uri: u, getText: () => state.text || "" }),
  },
  languages: { createDiagnosticCollection: (name) => ({ name, set() {}, delete() {}, clear() {}, dispose() {} }) },
  window: {
    createTextEditorDecorationType: (opts) => ({ opts, dispose() {} }),
    get visibleTextEditors() { return []; },
    showWarningMessage: async () => {},
    showInformationMessage: async () => {},
    setStatusBarMessage: () => ({ dispose() {} }),
  },
  commands: { executeCommand: async (cmd) => (cmd === "vscode.executeDocumentSymbolProvider" ? state.symbols : undefined) },
};
`,
);
const entry = path.join(__dirname, ".blind-v55-p10.entry.ts");
const outfile = path.join(__dirname, ".blind-v55-p10.bundle.cjs");
fs.writeFileSync(entry, `export { resolveCallOwners } from "../src/vscode/fnGen";\n`);
esbuild.buildSync({
  entryPoints: [entry],
  bundle: true,
  outfile,
  format: "cjs",
  platform: "node",
  alias: { vscode: STUB },
});
const { resolveCallOwners } = require(outfile);
const stubState = globalThis.__v55p10;
test.after(() => {
  [entry, outfile, STUB].forEach((f) => fs.rmSync(f, { force: true }));
});

const EXT = { rust: "rs", go: "go", csharp: "cs", python: "py", typescript: "ts" };
const docFor = (languageId) => {
  const p = `/x/a.${EXT[languageId] ?? "txt"}`;
  return { languageId, uri: { fsPath: p, path: p, scheme: "file", toString: () => `file://${p}` }, getText: () => "" };
};

const span = (a, b) => ({ start: { line: a, character: 0 }, end: { line: b, character: 1 } });

// A container symbol holding one method, the shape every server in this repo's
// five languages produces for `impl X { fn m }`, `class X { M() }`,
// `type X struct` + method, and so on. The method sits at CONTAINER_LINE + 5.
const container = (typeName, method, line, kind = 22) => ({
  name: typeName,
  kind,
  range: span(line, line + 30),
  selectionRange: { start: { line, character: 5 }, end: { line, character: 5 + typeName.length } },
  children: [
    {
      name: method,
      kind: 5,
      range: span(line + 5, line + 9),
      selectionRange: { start: { line: line + 5, character: 11 }, end: { line: line + 5, character: 11 + method.length } },
      children: [],
    },
  ],
});

// The definition answer that lands on that method's declaration line.
const defAt = (line, ext = "rs") => ({
  uri: `file:///x/owner.${ext}`,
  range: { startLine: line + 5, startCharacter: 11, endLine: line + 5, endCharacter: 20 },
});

const extractorFor = (defs) => ({
  definition: async (cursor) => defs[cursor.line] ?? defs.default,
  completeMembers: async () => [],
  hoverSurface: async () => undefined,
  membersOfType: async () => [],
  example: async () => undefined,
  qualifyImport: async () => undefined,
});

const call = (name, line) => ({ name, line, character: 4, via: "member" });

// One resolve, one channel. Every row goes through here so a contract change is
// one edit.
async function resolve({ languageId = "rust", symbols, defs, targets, skip, extractor }) {
  stubState.symbols = symbols;
  stubState.text = "";
  const lines = [];
  const owners = await resolveCallOwners(
    extractor ?? extractorFor(defs),
    docFor(languageId),
    targets,
    (l) => lines.push(l),
    skip,
  );
  return { owners, names: owners.map((o) => o.name), lines };
}

// A call on one type, resolved in one language. `typeName` is the container the
// symbol walk will answer with.
const oneCall = (languageId, typeName, method = "fetch") =>
  resolve({
    languageId,
    symbols: [container(typeName, method, 90)],
    defs: { default: defAt(90, EXT[languageId]) },
    targets: [call(method, 1)],
  });

// The four refusal reasons the leg already ships, verbatim. Row 6 pins them;
// every other row uses them to prove the NEW refusal is a different line.
const EXISTING_REASONS = [
  /a standard-library type; not disclosed/,
  /already disclosed by another leg; not repeated/,
  /the server gave no definition for the call/,
  /its definition sits inside no type/,
  /no usable symbol tree at its definition/,
  /the keep cap of \d+ is full/,
];

// The new line the contract demands: names the call AND the parameter, and is
// none of the existing reasons. Deliberately says nothing about wording beyond
// that, because the fix is not written yet.
const parameterRefusals = (lines, method, param) =>
  lines.filter(
    (l) =>
      l.includes(`\`${method}\``) &&
      new RegExp(`\\b${param}\\b`).test(l) &&
      !EXISTING_REASONS.some((r) => r.test(l)),
  );

// ===========================================================================
// ROW 1. A call on a generic-parameter receiver yields no owner.
// Contract item 1. RED before the fix: `T` comes back as a real owner.
// ===========================================================================

test("rust: a call whose owner resolves to `T` yields no owner", async () => {
  const { names, lines } = await oneCall("rust", "T");
  assert.deepEqual(names, [], `\`T\` was returned as a call owner; channel: ${JSON.stringify(lines)}`);
});

// The same refusal in the other three languages the rule applies to. Go is
// deliberately absent: see the header, and rows 3a/3b.
for (const lang of ["typescript", "csharp", "python"]) {
  test(`${lang}: a call whose owner resolves to \`T\` yields no owner`, async () => {
    const { names, lines } = await oneCall(lang, "T", lang === "python" ? "fetch" : "Fetch");
    assert.deepEqual(names, [], `\`T\` was returned as a call owner; channel: ${JSON.stringify(lines)}`);
  });
}

// Every single uppercase letter, not just the conventional four. The rule is
// `/^[A-Z]$/` and the row states it as a law rather than a list.
for (const letter of ["T", "U", "K", "V", "E", "S", "R"]) {
  test(`rust: the single letter \`${letter}\` is a type parameter, never an owner`, async () => {
    const { names } = await oneCall("rust", letter);
    assert.deepEqual(names, [], `\`${letter}\` was returned as a call owner`);
  });
}

// ===========================================================================
// ROW 2. The refusal happens AT THE RESOLVE and the channel proves it. This is
// the queue's own falsification, the half a lazy oracle skips.
// Contract item 2. RED before the fix: no line at all is written.
// ===========================================================================

test("the refusal is its own channel line, naming the call and the parameter", async () => {
  const { lines } = await oneCall("rust", "T", "to_shard_log_header");
  const hits = parameterRefusals(lines, "to_shard_log_header", "T");
  assert.equal(
    hits.length,
    1,
    `expected exactly one refusal line naming both the call and \`T\`, got ${hits.length}; channel: ${JSON.stringify(lines)}`,
  );
});

test("the refusal line is not any of the four reasons the leg already ships", async () => {
  const { lines } = await oneCall("rust", "T", "to_shard_log_header");
  assert.ok(lines.length > 0, "the leg said nothing at all about the call it dropped");
  for (const reason of EXISTING_REASONS) {
    const wrong = lines.filter((l) => reason.test(l));
    assert.deepEqual(
      wrong,
      [],
      `a generic parameter was refused under an existing reason ${reason}: ${JSON.stringify(wrong)}`,
    );
  }
});

// ===========================================================================
// ROW 3. Go. See the header: at this seam Go resolves NO owner for ANY tree
// shape, so the carve-out cannot be witnessed positively. These two rows pin
// what is measurable, and both are green today.
// ===========================================================================

// 3a. The carve-out, stated as the strongest thing that IS drivable: whatever
// Go does with a single-letter owner, it must never be the new refusal. Green
// today because no such line exists; goes red if a fix reaches Go with a blind
// `/^[A-Z]$/`.
test("go: a single-letter owner is never refused by the generic-parameter rule", async () => {
  const { names, lines } = await oneCall("go", "T", "Fatalf");
  const hits = parameterRefusals(lines, "Fatalf", "T");
  assert.deepEqual(
    hits,
    [],
    `Go lost a single-letter owner to the generic-parameter rule; crossFileShape.ts:1016-1024 measures 186 single-letter structs in the Go standard library, testing.T among them`,
  );
  if (names.length > 0) {
    assert.deepEqual(names, ["T"], "Go resolved an owner and it was not the single letter the tree named");
  }
});

// 3b. PIN OF MEASURED CURRENT BEHAVIOUR, NOT OF DESIRED BEHAVIOUR. Go's
// container walk answers nothing here, for a real multi-character type as much
// as for `T`. This row exists so that phase 10 cannot silently change Go, and
// so that whoever later opens Go's door sees exactly one red row and updates it
// on purpose. Do not "fix" this row by weakening it.
for (const typeName of ["T", "RealTypeA"]) {
  test(`go PIN: the owner \`${typeName}\` does not resolve at this seam today`, async () => {
    const { names, lines } = await oneCall("go", typeName, "Fetch");
    assert.deepEqual(
      names,
      [],
      `Go now resolves a call owner. That is progress, not a regression: re-read this row's comment, then update it deliberately.`,
    );
    assert.ok(
      lines.some((l) => l.includes("its definition sits inside no type")),
      `Go's reason changed; channel: ${JSON.stringify(lines)}`,
    );
  });
}

// ===========================================================================
// ROW 4. A real type is never refused. Single letter, deliberately not "short".
// Contract item 4. GREEN today and must stay green.
// ===========================================================================

for (const typeName of ["T1", "Ok", "Kind", "Id", "Db", "RealTypeA", "LogSegmentCursor"]) {
  test(`rust: the multi-character name \`${typeName}\` still resolves as an owner`, async () => {
    const { names, lines } = await oneCall("rust", typeName);
    assert.deepEqual(names, [typeName], `\`${typeName}\` was refused; channel: ${JSON.stringify(lines)}`);
  });
}

// `Vec` is the trap in contract item 4: it IS refused, by the pre-existing std
// filter, and a row that only asserted "no owner" would pass under a fix that
// refused it as a parameter. Assert WHICH line refused it.
test("rust: `Vec` is refused by the standard-library filter, not by the parameter rule", async () => {
  const { names, lines } = await oneCall("rust", "Vec", "push");
  assert.deepEqual(names, []);
  assert.ok(
    lines.some((l) => /call owner for `push` is `Vec`, a standard-library type; not disclosed/.test(l)),
    `the std filter's own line is gone; channel: ${JSON.stringify(lines)}`,
  );
  assert.deepEqual(parameterRefusals(lines, "push", "Vec"), [], "`Vec` was refused as a generic parameter");
});

// ===========================================================================
// ROW 5. The slot is freed, not just the disclosure. Contract item 5, and the
// row that proves the fix is not cosmetic.
//
// Three calls, cap of 2. Today the leg returns [T, RealTypeA] and never looks
// `beta_call` up at all - the channel says so. After the fix both real types
// come back. RED before the fix.
// ===========================================================================

const THREE_CALL_TREE = [container("T", "generic_call", 90), container("RealTypeA", "alpha_call", 200), container("RealTypeB", "beta_call", 300)];
const THREE_CALL_DEFS = { 1: defAt(90), 2: defAt(200), 3: defAt(300) };
const THREE_CALLS = [call("generic_call", 1), call("alpha_call", 2), call("beta_call", 3)];

test("a refused parameter does not eat a KEEP slot: both real types come back", async () => {
  const { names, lines } = await resolve({
    symbols: THREE_CALL_TREE,
    defs: THREE_CALL_DEFS,
    targets: THREE_CALLS,
  });
  assert.deepEqual(
    names,
    ["RealTypeA", "RealTypeB"],
    `the parameter spent a slot of the cap of 2 and evicted a real type; channel: ${JSON.stringify(lines)}`,
  );
});

test("a refused parameter does not spend the lookup budget either: the third call is looked up", async () => {
  stubState.symbols = THREE_CALL_TREE;
  const asked = [];
  const owners = await resolveCallOwners(
    {
      ...extractorFor(THREE_CALL_DEFS),
      definition: async (cursor) => {
        asked.push(cursor.line);
        return THREE_CALL_DEFS[cursor.line];
      },
    },
    docFor("rust"),
    THREE_CALLS,
    () => {},
  );
  assert.deepEqual(asked, [1, 2, 3], `beta_call was never looked up; owners: ${JSON.stringify(owners.map((o) => o.name))}`);
});

// The contract's ordering question, stated as a row rather than an opinion: the
// parameter's name is only known after the round trip, so the round trip is
// still spent. One, not zero, and not two.
test("the parameter's round trip is still spent, because its name is only known after the walk", async () => {
  stubState.symbols = [container("T", "generic_call", 90)];
  let asked = 0;
  await resolveCallOwners(
    {
      ...extractorFor({ default: defAt(90) }),
      definition: async () => {
        asked++;
        return defAt(90);
      },
    },
    docFor("rust"),
    [call("generic_call", 1)],
    () => {},
  );
  assert.equal(asked, 1, "the leg changed how many definition round trips a refused parameter costs");
});

// ===========================================================================
// ROW 6. Every other refusal path is untouched: current wording, current order.
// Contract item 6. GREEN today and must stay green.
// ===========================================================================

const REFUSAL_CASES = [
  {
    what: "a standard-library owner",
    setup: () => ({ symbols: [container("Vec", "push", 90)], defs: { default: defAt(90) }, targets: [call("push", 1)] }),
    line: "[repair] call owner for `push` is `Vec`, a standard-library type; not disclosed",
  },
  {
    what: "an owner another leg already disclosed",
    setup: () => ({
      symbols: [container("RealTypeA", "fetch", 90)],
      defs: { default: defAt(90) },
      targets: [call("fetch", 1)],
      skip: new Set(["RealTypeA"]),
    }),
    line: "[repair] call owner for `fetch` is `RealTypeA`, already disclosed by another leg; not repeated",
  },
  {
    what: "a call the server cannot place",
    setup: () => ({
      symbols: [container("RealTypeA", "fetch", 90)],
      defs: {},
      targets: [call("fetch", 1)],
      extractor: { ...extractorFor({}), definition: async () => undefined },
    }),
    line: "[repair] call owner unresolved for `fetch`: the server gave no definition for the call",
  },
  {
    what: "a definition with no symbol tree behind it",
    setup: () => ({ symbols: [], defs: { default: defAt(90) }, targets: [call("fetch", 1)] }),
    line: "[repair] call owner unresolved for `fetch`: no usable symbol tree at its definition",
  },
  {
    what: "a free function",
    setup: () => ({
      symbols: [
        {
          name: "parse_config",
          kind: 11,
          range: span(90, 99),
          selectionRange: { start: { line: 90, character: 3 }, end: { line: 90, character: 15 } },
          children: [],
        },
      ],
      defs: { default: { uri: "file:///x/owner.rs", range: { startLine: 95, startCharacter: 3, endLine: 95, endCharacter: 15 } } },
      targets: [call("parse_config", 1)],
    }),
    line: "[repair] call owner unresolved for `parse_config`: its definition sits inside no type (a free function, or a tree with no container)",
  },
];

for (const c of REFUSAL_CASES) {
  test(`the reason for ${c.what} keeps its exact wording`, async () => {
    const { owners, lines } = await resolve(c.setup());
    assert.deepEqual(owners, [], `${c.what} was returned as an owner`);
    assert.ok(lines.includes(c.line), `wording drifted.\n  want: ${c.line}\n  got:  ${JSON.stringify(lines)}`);
  });
}

test("the cap line keeps its exact wording, and names every call it skipped", async () => {
  const { names, lines } = await resolve({
    symbols: [container("AlphaType", "one", 10), container("BetaType", "two", 50)],
    defs: { 1: defAt(10), 2: defAt(50) },
    targets: [call("one", 1), call("two", 2), call("three", 3), call("four", 4)],
  });
  assert.deepEqual(names, ["AlphaType", "BetaType"]);
  assert.ok(
    lines.includes("[repair] call owners: 2 call(s) not looked up (three, four): the keep cap of 2 is full"),
    `the cap line drifted; channel: ${JSON.stringify(lines)}`,
  );
});

// Order, not just wording: the channel reports refusals in target order, so a
// reader can follow the leg call by call.
test("refusals are reported in target order", async () => {
  const { lines } = await resolve({
    symbols: [container("Vec", "push", 10), container("RealTypeA", "fetch", 50)],
    defs: { 1: defAt(10), 2: defAt(50), 3: undefined },
    targets: [call("push", 1), call("fetch", 2), call("orphan", 3)],
    skip: new Set(["RealTypeA"]),
  });
  const at = (needle) => lines.findIndex((l) => l.includes(needle));
  assert.ok(at("`push`") >= 0 && at("`fetch`") >= 0 && at("`orphan`") >= 0, `a reason went missing: ${JSON.stringify(lines)}`);
  assert.ok(at("`push`") < at("`fetch`"), "the std refusal moved after the already-disclosed one");
  assert.ok(at("`fetch`") < at("`orphan`"), "the already-disclosed refusal moved after the unresolved one");
});

// A type target is not a call and never costs a lookup. Pinned here because the
// fix touches the same loop.
test("a type target is still never looked up", async () => {
  stubState.symbols = [container("RealTypeA", "fetch", 90)];
  let asked = 0;
  const owners = await resolveCallOwners(
    {
      ...extractorFor({ default: defAt(90) }),
      definition: async () => {
        asked++;
        return defAt(90);
      },
    },
    docFor("rust"),
    [{ name: "T", line: 1, character: 4, via: "type" }],
    () => {},
  );
  assert.deepEqual(owners, []);
  assert.equal(asked, 0, "a type target spent a definition round trip");
});
