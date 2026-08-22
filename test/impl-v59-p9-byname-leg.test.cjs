// Implementer's suite for session-v59 phase 9: the cross-file argument-type leg
// (roadmap item 21), unbuilt since v14.
//
// The blind oracle (blind-v15-argtype-identity) proves the CONTRACT end to end
// through the three product transports against one deliberately trapped
// fixture. This suite exercises the two primitives that leg is built out of,
// where the oracle only ever sees them through one shape:
//
//   selectSoleTypeCursor          - the by-name selection for a language where
//                                   one name means one type (TS, Python). The
//                                   selectCsTypeCursor sibling, stricter.
//   resolutionReachedWrongTree    - the C# wrong-tree refusal's predicate. Three
//                                   facts have to hold together and each one is
//                                   load-bearing, which is exactly what a
//                                   single-fixture oracle cannot show.
//
// plus the two new product transport legs against a fake symbol runner, in the
// csExtractor/pyExtractor convention.
//
// Run: SKIP_LIVE=1 node --test test/impl-v59-p9-byname-leg.test.cjs
// (Hermetic: fake runners, no vscode, no language server, no network.)

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-v59-p9-byname-leg",
  `export { selectSoleTypeCursor, workspaceSymbolCandidates, resolutionReachedWrongTree } from "../src/core/extraction";\n` +
    `export { tsVscodeSymbolRole } from "../src/core/tsExtraction";\n` +
    `export { pyVscodeSymbolRole } from "../src/core/pyExtraction";\n` +
    `export { csVscodeSymbolRole } from "../src/core/csExtraction";\n` +
    `export { TsCommandExtractor } from "../src/vscode/tsExtractor";\n` +
    `export { PyCommandExtractor } from "../src/vscode/pyExtractor";\n`,
);
test.after(() => cleanup());

const cand = (name, role, containerName, uri, line = 0, character = 0) => ({
  name,
  role,
  containerName,
  uri,
  line,
  character,
});

// ===========================================================================
// 1. selectSoleTypeCursor. One name means one type; anything else refuses
// unless the caller brought evidence.
// ===========================================================================

const TILE_TS = "file:///ws/tile.ts";
const TILE_ALT = "file:///ws/vendor/tile.ts";

const SELECTION_ROWS = [
  {
    why: "the sole exact-name container resolves",
    candidates: [cand("Tile", "container", "", TILE_TS, 0, 13)],
    expect: { uri: TILE_TS, line: 0, character: 13 },
  },
  {
    why: "a fuzzy prefix hit is not the type: navto answers TileSite for a Tile query",
    candidates: [cand("TileSite", "container", "", TILE_TS, 4, 2)],
    expect: undefined,
  },
  {
    why: "an exact-name NON-container is refused - a function named Tile is not a construction surface",
    candidates: [cand("Tile", "function", "", TILE_TS, 0, 9)],
    expect: undefined,
  },
  {
    why: "a method hit named Tile is refused for the same reason",
    candidates: [cand("Tile", "method", "", TILE_TS, 7, 2)],
    expect: undefined,
  },
  {
    why: "two DISTINCT declaration sites refuse outright, never a guess - neither TS nor Python has a partial class",
    candidates: [cand("Tile", "container", "", TILE_TS, 0, 13), cand("Tile", "container", "", TILE_ALT, 0, 13)],
    expect: undefined,
  },
  {
    why: "the SAME position reported twice is one hit, not an ambiguity (pyright answers a stub beside its implementation)",
    candidates: [cand("Tile", "container", "", TILE_TS, 0, 13), cand("Tile", "container", "", TILE_TS, 0, 13)],
    expect: { uri: TILE_TS, line: 0, character: 13 },
  },
  {
    why: "the fuzzy noise around a sole real hit does not make it ambiguous",
    candidates: [
      cand("TileSite", "container", "", TILE_ALT, 4, 2),
      cand("Tile", "container", "", TILE_TS, 0, 13),
      cand("tileFromMorton", "function", "", TILE_ALT, 9, 0),
    ],
    expect: { uri: TILE_TS, line: 0, character: 13 },
  },
  {
    why: "nothing at all resolves to nothing",
    candidates: [],
    expect: undefined,
  },
];

for (const row of SELECTION_ROWS) {
  test(`selectSoleTypeCursor: ${row.why}`, () => {
    assert.deepStrictEqual(mod.selectSoleTypeCursor(row.candidates, "Tile"), row.expect);
  });
}

// The hint arm, separately: a hint is spent ONLY on an ambiguity, and only
// decides one when exactly one candidate fits.
const AMBIGUOUS = [
  cand("Tile", "container", "atlas.cartography", TILE_TS, 0, 13),
  cand("Tile", "container", "vendor.shim", TILE_ALT, 0, 13),
];

const HINT_ROWS = [
  {
    why: "a container matching exactly one candidate decides it",
    hint: { container: "atlas.cartography" },
    expect: { uri: TILE_TS, line: 0, character: 13 },
  },
  {
    why: "a SUFFIX of the reported container decides it on a segment boundary",
    hint: { container: "cartography" },
    expect: { uri: TILE_TS, line: 0, character: 13 },
  },
  {
    why: "a container matching NEITHER candidate refuses rather than falling through",
    hint: { container: "nowhere.at.all" },
    expect: undefined,
  },
  {
    why: "an empty container is no evidence",
    hint: { container: "" },
    expect: undefined,
  },
  {
    why: "no hint at all leaves the ambiguity refused",
    hint: undefined,
    expect: undefined,
  },
];

for (const row of HINT_ROWS) {
  test(`selectSoleTypeCursor hint: ${row.why}`, () => {
    assert.deepStrictEqual(mod.selectSoleTypeCursor(AMBIGUOUS, "Tile", row.hint), row.expect);
  });
}

test("selectSoleTypeCursor: an UNambiguous name never spends the hint - the same answer with a contradicting container", () => {
  const sole = [cand("Tile", "container", "atlas.cartography", TILE_TS, 0, 13)];
  assert.deepStrictEqual(
    mod.selectSoleTypeCursor(sole, "Tile", { container: "nowhere.at.all" }),
    { uri: TILE_TS, line: 0, character: 13 },
    "the hint is an ambiguity tiebreak, not a filter over an answer that was never in doubt",
  );
});

// ===========================================================================
// 2. workspaceSymbolCandidates. The vscode hit hands a Uri OBJECT and the LSP
// wire hands a string; a hit missing a name, a location or a start is dropped
// rather than defaulted, because a candidate at line 0 of nowhere resolves to
// a stranger's declaration.
// ===========================================================================

const uriObj = (s) => ({ toString: () => s });
const hit = (name, kind, uri, line = 0, character = 13, containerName = "") => ({
  name,
  kind,
  containerName,
  location: { uri, range: { start: { line, character } } },
});

test("workspaceSymbolCandidates: a vscode-shaped Uri object and an LSP-shaped uri string reduce identically", () => {
  const asObject = mod.workspaceSymbolCandidates([hit("Tile", 4, uriObj(TILE_TS))], mod.tsVscodeSymbolRole);
  const asString = mod.workspaceSymbolCandidates([hit("Tile", 4, TILE_TS)], mod.tsVscodeSymbolRole);
  assert.deepStrictEqual(asObject, asString);
  assert.deepStrictEqual(asObject, [cand("Tile", "container", "", TILE_TS, 0, 13)]);
});

const MALFORMED_ROWS = [
  { why: "a non-array answer", raw: { not: "an array" } },
  { why: "a null answer", raw: null },
  { why: "a hit with no name", raw: [hit(undefined, 4, TILE_TS)] },
  { why: "a hit with no location", raw: [{ name: "Tile", kind: 4 }] },
  { why: "a hit with no start position", raw: [{ name: "Tile", kind: 4, location: { uri: TILE_TS, range: {} } }] },
  { why: "a hit whose line is not a number", raw: [hit("Tile", 4, TILE_TS, "0", 13)] },
  { why: "a hit whose character is not a number", raw: [hit("Tile", 4, TILE_TS, 0, null)] },
  {
    why: "a bare object that merely inherits Object.prototype.toString, which answers '[object Object]' for anything",
    raw: [hit("Tile", 4, {})],
  },
  { why: "an empty uri string", raw: [hit("Tile", 4, "")] },
  { why: "a uri with no scheme", raw: [hit("Tile", 4, "/ws/tile.ts")] },
];

for (const row of MALFORMED_ROWS) {
  test(`workspaceSymbolCandidates: ${row.why} yields no candidate, never a defaulted one`, () => {
    assert.deepStrictEqual(mod.workspaceSymbolCandidates(row.raw, mod.tsVscodeSymbolRole), []);
  });
}

test("workspaceSymbolCandidates: the ROLE comes from the calling transport's own mapper, so the same kind number reads differently per language", () => {
  // vscode SymbolKind 11 is Function. TypeScript maps it to "function"; Python
  // maps it to "method", because a module-level `def` is a callable member
  // there. Neither is a container, which is what the selection filters on.
  const raw = [hit("Tile", 11, TILE_TS)];
  assert.strictEqual(mod.workspaceSymbolCandidates(raw, mod.tsVscodeSymbolRole)[0].role, "function");
  assert.strictEqual(mod.workspaceSymbolCandidates(raw, mod.pyVscodeSymbolRole)[0].role, "method");
});

// ===========================================================================
// 3. resolutionReachedWrongTree. THREE facts, and deleting any one of them
// either lets the false statement through or refuses a legitimate question.
//
// The tree below is the trap's shape: a helper class `Fim` whose method
// `TileSite` mentions `Tile`, which is declared in another file entirely.
// ===========================================================================

const SK = { Class: 4, Method: 5 };
const vr = (sl, sc, el, ec) => ({ start: { line: sl, character: sc }, end: { line: el, character: ec } });
const dsym = (name, kind, range, children = []) => ({ name, kind, range, children });

// public static class Fim {            <- line 3
//   public static void TileSite(...)   <- line 5
//   { Tile tile = ...;                 <- line 7   THE REFERENCE
//     stripe.                          <- line 8   THE MEMBER SITE
//   } }
const SITE_TREE = [
  dsym("Fim", SK.Class, vr(3, 0, 18, 1), [
    dsym("TileSite", SK.Method, vr(5, 4, 9, 5)),
    dsym("FreshSite", SK.Method, vr(17, 4, 17, 51)),
  ]),
];
const SITE_LINES = {
  3: "public static class Fim",
  7: "        Tile tile = Cartography.TileFromMorton(42, 3);",
  8: "        stripe.",
};

// public class Tile {  <- line 0, the name token at character 13
const TYPE_TREE = [
  dsym("Tile", SK.Class, vr(0, 0, 11, 1), [dsym("Tile", 8, vr(4, 4, 8, 5)), dsym("Key", SK.Method, vr(10, 4, 10, 54))]),
];
const TYPE_LINES = { 0: "public class Tile", 4: "    public Tile(int mortonCode, int lod)" };

const wrongTree = (tree, lines, line, character) =>
  mod.resolutionReachedWrongTree(tree, { uri: "file:///ws/x.cs", line, character }, mod.csVscodeSymbolRole, lines[line]);

const WRONG_TREE_ROWS = [
  {
    why: "THE DEFECT: a definition answer at the REFERENCE's own position, inside a method body, reaches Fim's tree and not Tile's",
    at: [SITE_TREE, SITE_LINES, 7, 8],
    expect: true,
  },
  {
    why: "a MEMBER SITE is not refused - it sits on no identifier, and 'what type am I writing inside' is a legitimate question with Fim as its answer",
    at: [SITE_TREE, SITE_LINES, 8, 15],
    expect: false,
  },
  {
    why: "the honest answer - the type's own name token in its own file - agrees with its container and is allowed",
    at: [TYPE_TREE, TYPE_LINES, 0, 13],
    expect: false,
  },
  {
    why: "a definition answer landing on the `public` of `public class Tile` is NOT a wrong tree: the declaration head is outside every member's range",
    at: [TYPE_TREE, TYPE_LINES, 0, 2],
    expect: false,
  },
  {
    why: "a constructor's own name token, inside the type it constructs, agrees with the container by name and is allowed",
    at: [TYPE_TREE, TYPE_LINES, 4, 15],
    expect: false,
  },
  {
    why: "the container's own name token, read at the class head, is allowed",
    at: [SITE_TREE, SITE_LINES, 3, 20],
    expect: false,
  },
];

for (const row of WRONG_TREE_ROWS) {
  test(`resolutionReachedWrongTree: ${row.why}`, () => {
    assert.strictEqual(wrongTree(...row.at), row.expect);
  });
}

const NO_EVIDENCE_ROWS = [
  { why: "no line text at all (a transport with no text reader)", args: [SITE_TREE, { line: 7, character: 8 }, undefined] },
  { why: "a non-array symbol answer", args: [{ not: "symbols" }, { line: 7, character: 8 }, SITE_LINES[7]] },
  { why: "a null symbol answer", args: [null, { line: 7, character: 8 }, SITE_LINES[7]] },
  { why: "a position no container encloses", args: [SITE_TREE, { line: 1, character: 6 }, "using Atlas.Cartography;"] },
  { why: "a character past the end of the line", args: [SITE_TREE, { line: 8, character: 400 }, SITE_LINES[8]] },
];

for (const row of NO_EVIDENCE_ROWS) {
  test(`resolutionReachedWrongTree: ${row.why} is no evidence of a wrong tree, so it refuses nothing`, () => {
    const [tree, at, lineText] = row.args;
    assert.strictEqual(
      mod.resolutionReachedWrongTree(tree, { uri: "file:///ws/x.cs", ...at }, mod.csVscodeSymbolRole, lineText),
      false,
    );
  });
}

// ===========================================================================
// 4. The two new product transport legs, against a fake symbol runner. The
// convention the C# and Go transports' suites already use.
// ===========================================================================

const runnerNever = async () => {
  throw new Error("membersOfType/hover must not be dispatched by the by-name leg");
};

const TRANSPORTS = [
  { id: "typescript", ctor: "TsCommandExtractor", uri: "file:///ws/tile.ts", classKind: 4 },
  { id: "python", ctor: "PyCommandExtractor", uri: "file:///ws/tile.py", classKind: 4 },
];

for (const t of TRANSPORTS) {
  const build = (runSymbol) => new mod[t.ctor](runnerNever, undefined, runSymbol);

  test(`${t.id}: resolveTypeCursorByName resolves the exact-name class from a fuzzy hit list, and dispatches exactly ONE query`, async () => {
    const queries = [];
    const ex = build(async (q) => {
      queries.push(q);
      return [
        hit("TileSite", 5, uriObj(t.uri), 4, 2),
        hit("Tile", t.classKind, uriObj(t.uri), 0, 13),
      ];
    });
    assert.deepStrictEqual(await ex.resolveTypeCursorByName("Tile"), { uri: t.uri, line: 0, character: 13 });
    assert.deepStrictEqual(queries, ["Tile"], "the query is the bare NAME, asked once");
  });

  test(`${t.id}: resolveTypeCursorByName refuses two distinct declaration sites for one name`, async () => {
    const ex = build(async () => [
      hit("Tile", t.classKind, uriObj(t.uri), 0, 13),
      hit("Tile", t.classKind, uriObj("file:///ws/vendor/tile"), 0, 13),
    ]);
    assert.strictEqual(await ex.resolveTypeCursorByName("Tile"), undefined);
  });

  test(`${t.id}: an ABSENT symbol runner resolves undefined with ZERO dispatches`, async () => {
    const ex = new mod[t.ctor](runnerNever, undefined);
    assert.strictEqual(await ex.resolveTypeCursorByName("Tile"), undefined);
  });

  test(`${t.id}: a THROWING symbol runner degrades to undefined, never rejects`, async () => {
    const ex = build(async () => {
      throw new Error("the language server is down");
    });
    assert.strictEqual(await ex.resolveTypeCursorByName("Tile"), undefined);
  });

  test(`${t.id}: a non-array answer from the symbol runner resolves undefined`, async () => {
    const ex = build(async () => ({ not: "an array" }));
    assert.strictEqual(await ex.resolveTypeCursorByName("Tile"), undefined);
  });

  test(`${t.id}: an exact-name hit that is not a TYPE is refused - a same-named function is not a construction surface`, async () => {
    const ex = build(async () => [hit("Tile", 11, uriObj(t.uri), 0, 9)]);
    assert.strictEqual(await ex.resolveTypeCursorByName("Tile"), undefined);
  });
}
