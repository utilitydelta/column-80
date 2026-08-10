// The include-the-block gestures end to end (session-v32 phase 3, goal item 4),
// driving the REAL registered commands over a fake vscode module: cursor ->
// symbol tree -> selectionRange chain -> a block in the store.
//
// The blind oracle's file covers the two pure functions. This one covers what
// only the wiring can be wrong about:
//   - the block's first line is the DOC COMMENT in all five languages, which is
//     finding 4 and the reason the range is not symbol.range.start;
//   - the text is WHOLE LINES, or isStale's second leg flags the block the
//     instant it is added;
//   - multi-cursor order and same-block collapse;
//   - refusing outside every symbol instead of falling back to the file;
//   - the statement gesture stopping at the enclosing symbol.
//
// Run: SKIP_LIVE=1 node --test test/impl-v32-p3-block.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleWithVscodeStub, makeDoc } = require("./.vscode-stub.cjs");

const { mod: surf, vscode, cleanup, error: surfErr } = bundleWithVscodeStub(
  "impl-v32-p3-block",
  [
    `export { registerContextPanel } from "../src/vscode/contextPanel";`,
    `export { ContextBlockStore, isStale, sliceLines } from "../src/core/contextBlocks";`,
    `export { chooseChainBlock, symbolBlockRange, orderedCursors } from "../src/core/contextGestures";`,
    "",
  ].join("\n"),
);
test.after(cleanup);

const { Position, Range, Selection } = vscode;
const K = vscode.SymbolKind;
const P = (l, c) => new Position(l, c);
const R = (sl, sc, el, ec) => new Range(sl, sc, el, ec);
const sym = (name, kind, range, sel, children = []) => ({ name, detail: "", kind, range, selectionRange: sel, children });

const gtest = (name, fn) =>
  test(name, (ctx) => {
    if (surfErr) return ctx.skip(`surface bundle failed to build: ${surfErr.message}`);
    return fn(ctx);
  });

test("bundle guard: contextPanel builds headless against the vscode stub", () => {
  if (surfErr) assert.fail(`surface bundle failed: ${surfErr.message}`);
});

// A chain, innermost first, built from line/char quads. The provider hands back
// a linked list, so this rebuilds one.
function chainOf(quads) {
  let head;
  for (let i = quads.length - 1; i >= 0; i--) {
    head = new vscode.SelectionRange(R(...quads[i]), head);
  }
  return head;
}

/**
 * Register the panel over a fixture, place the cursors, run one command, and
 * hand back the store plus the warnings it produced.
 */
async function runGesture(fixture, cursors, commandId, chains) {
  const uriStr = `file:///fixture/${fixture.name}`;
  const doc = makeDoc(vscode, fixture.text, uriStr, fixture.languageId);
  const editor = {
    document: doc,
    selections: cursors.map(([line, character]) => new Selection(line, character, line, character)),
    setDecorations() {},
  };
  globalThis.__C80_SYMBOLS__ = { [uriStr]: fixture.symbols(R) };
  globalThis.__C80_CHAINS__ = chains ? { [uriStr]: chains } : {};
  globalThis.__C80_DOCS__ = { [uriStr]: doc };
  globalThis.__C80_OPEN_DOCS__ = [doc];
  globalThis.__C80_ACTIVE__ = editor;
  globalThis.__C80_VISIBLE__ = [editor];
  globalThis.__C80_WARNINGS__ = [];
  globalThis.__C80_COMMANDS__ = {};

  const store = new surf.ContextBlockStore();
  surf.registerContextPanel({ subscriptions: [] }, store);
  const command = globalThis.__C80_COMMANDS__[commandId];
  assert.ok(command, `${commandId} was never registered`);
  await command();
  return { store, doc, warnings: globalThis.__C80_WARNINGS__, blocks: store.list() };
}

// The five fixtures carry each server's MEASURED range geometry (finding 1):
// rust-analyzer includes the doc run in the range, the other four exclude it.
// The gesture must produce the same-shaped block on all five regardless.
const FIXTURES = {
  rust: {
    name: "lib.rs",
    languageId: "rust",
    //  0 /// Fan out the stripe totals.
    //  1 pub fn stripe_total_fanout() -> u32 {
    //  2     let mut stripe = 0;
    //  3     if stripe > 1 {
    //  4         stripe += 1;
    //  5     }
    //  6     stripe
    //  7 }
    text: [
      "/// Fan out the stripe totals.",
      "pub fn stripe_total_fanout() -> u32 {",
      "    let mut stripe = 0;",
      "    if stripe > 1 {",
      "        stripe += 1;",
      "    }",
      "    stripe",
      "}",
    ].join("\n"),
    symbols: (R) => [sym("stripe_total_fanout", K.Function, R(0, 0, 7, 1), R(1, 7, 1, 26))],
    docLine: 0,
    lastLine: 7,
    name_: "stripe_total_fanout",
  },
  typescript: {
    name: "fanout.ts",
    languageId: "typescript",
    //  0 /**
    //  1  * Fan out the stripe totals.
    //  2  */
    //  3 export function stripeFanout(): number {
    //  4   let stripe = 0;
    //  5   if (stripe > 1) {
    //  6     stripe += 1;
    //  7   }
    //  8   return stripe;
    //  9 }
    text: [
      "/**",
      " * Fan out the stripe totals.",
      " */",
      "export function stripeFanout(): number {",
      "  let stripe = 0;",
      "  if (stripe > 1) {",
      "    stripe += 1;",
      "  }",
      "  return stripe;",
      "}",
    ].join("\n"),
    symbols: (R) => [sym("stripeFanout", K.Function, R(3, 0, 9, 1), R(3, 16, 3, 28))],
    docLine: 0,
    lastLine: 9,
    name_: "stripeFanout",
  },
  csharp: {
    name: "Fns.cs",
    languageId: "csharp",
    //  0 namespace Playground;
    //  1
    //  2 public class Fns
    //  3 {
    //  4     /// <summary>Fan out the stripe totals.</summary>
    //  5     [Fact]
    //  6     public static int StripeFanout()
    //  7     {
    //  8         var stripe = 0;
    //  9         if (stripe > 1)
    // 10         {
    // 11             stripe += 1;
    // 12         }
    // 13         return stripe;
    // 14     }
    // 15 }
    text: [
      "namespace Playground;",
      "",
      "public class Fns",
      "{",
      "    /// <summary>Fan out the stripe totals.</summary>",
      "    [Fact]",
      "    public static int StripeFanout()",
      "    {",
      "        var stripe = 0;",
      "        if (stripe > 1)",
      "        {",
      "            stripe += 1;",
      "        }",
      "        return stripe;",
      "    }",
      "}",
    ].join("\n"),
    symbols: (R) => [
      sym("Playground", K.Namespace, R(0, 0, 15, 1), R(0, 10, 0, 20), [
        sym("Fns", K.Class, R(2, 0, 15, 1), R(2, 13, 2, 16), [
          sym("StripeFanout", K.Method, R(5, 4, 14, 5), R(6, 22, 6, 34)),
        ]),
      ]),
    ],
    docLine: 4,
    lastLine: 14,
    name_: "StripeFanout",
  },
  go: {
    name: "fanout.go",
    languageId: "go",
    //  0 package main
    //  1
    //  2 // stripeFanout fans out the stripe totals.
    //  3 func stripeFanout() uint32 {
    //  4 	stripe := uint32(0)
    //  5 	if stripe > 1 {
    //  6 		stripe += 1
    //  7 	}
    //  8 	return stripe
    //  9 }
    text: [
      "package main",
      "",
      "// stripeFanout fans out the stripe totals.",
      "func stripeFanout() uint32 {",
      "\tstripe := uint32(0)",
      "\tif stripe > 1 {",
      "\t\tstripe += 1",
      "\t}",
      "\treturn stripe",
      "}",
    ].join("\n"),
    symbols: (R) => [sym("stripeFanout", K.Function, R(3, 0, 9, 1), R(3, 5, 3, 17))],
    docLine: 2,
    lastLine: 9,
    name_: "stripeFanout",
  },
  python: {
    name: "fns.py",
    languageId: "python",
    //  0 # fan out the stripe totals
    //  1 @staticmethod
    //  2 def stripe_fanout() -> int:
    //  3     stripe = 0
    //  4     if stripe > 1:
    //  5         stripe += 1
    //  6     return stripe
    text: [
      "# fan out the stripe totals",
      "@staticmethod",
      "def stripe_fanout() -> int:",
      "    stripe = 0",
      "    if stripe > 1:",
      "        stripe += 1",
      "    return stripe",
    ].join("\n"),
    // Pylance INCLUDES the decorator and EXCLUDES the `#` run.
    symbols: (R) => [sym("stripe_fanout", K.Function, R(1, 0, 6, 17), R(2, 4, 2, 17))],
    docLine: 0,
    lastLine: 6,
    name_: "stripe_fanout",
  },
};

// ===========================================================================
// contextAddSymbol
// ===========================================================================

for (const [language, fixture] of Object.entries(FIXTURES)) {
  gtest(`${language}: the symbol block starts at the DOC COMMENT, not the symbol range`, async () => {
    // Cursor in the body, so this is not the attachment pass answering: the
    // block's FIRST LINE has to come from the trivia run either way.
    const { blocks, doc } = await runGesture(fixture, [[fixture.lastLine - 1, 4]], "column80.contextAddSymbol");
    assert.strictEqual(blocks.length, 1);
    assert.deepStrictEqual(
      { ...blocks[0].range },
      { startLine: fixture.docLine + 1, endLine: fixture.lastLine + 1 },
      "1-based inclusive, doc comment to closing line",
    );
    // The text is whole lines and matches the document, so isStale is quiet.
    assert.strictEqual(surf.sliceLines(doc.getText(), blocks[0].range), blocks[0].text);
    assert.strictEqual(surf.isStale(blocks[0], { version: doc.version, text: doc.getText() }), false);
  });

  gtest(`${language}: a cursor in the doc comment adds the same block as a body cursor`, async () => {
    const fromDoc = await runGesture(fixture, [[fixture.docLine, 2]], "column80.contextAddSymbol");
    const fromBody = await runGesture(fixture, [[fixture.lastLine - 1, 4]], "column80.contextAddSymbol");
    assert.strictEqual(fromDoc.blocks.length, 1, "the attachment pass reaches the block gesture too");
    assert.deepStrictEqual({ ...fromDoc.blocks[0].range }, { ...fromBody.blocks[0].range });
    assert.strictEqual(fromDoc.blocks[0].text, fromBody.blocks[0].text);
  });
}

gtest("a cursor outside every symbol refuses by name and adds nothing", async () => {
  const fixture = {
    name: "gap.ts",
    languageId: "typescript",
    text: ["const unrelated = 1;", "", "export function f(): number {", "  return 0;", "}"].join("\n"),
    symbols: (R) => [sym("f", K.Function, R(2, 0, 4, 1), R(2, 16, 2, 17))],
  };
  const { blocks, warnings } = await runGesture(fixture, [[0, 5]], "column80.contextAddSymbol");
  assert.strictEqual(blocks.length, 0, "never falls back to the whole file");
  assert.strictEqual(warnings.length, 1);
  assert.match(warnings[0], /nothing added to model context/);
});

gtest("two cursors in the same function collapse to one block", async () => {
  const { blocks } = await runGesture(
    FIXTURES.typescript,
    [[4, 2], [8, 2]],
    "column80.contextAddSymbol",
  );
  assert.strictEqual(blocks.length, 1);
  assert.deepStrictEqual({ ...blocks[0].range }, { startLine: 1, endLine: 10 });
});

gtest("multi-cursor blocks land in document order, whatever order the cursors came in", async () => {
  const fixture = {
    name: "two.ts",
    languageId: "typescript",
    //  0 /** A. */
    //  1 export function alpha(): number {
    //  2   return 1;
    //  3 }
    //  4
    //  5 /** B. */
    //  6 export function beta(): number {
    //  7   return 2;
    //  8 }
    text: [
      "/** A. */",
      "export function alpha(): number {",
      "  return 1;",
      "}",
      "",
      "/** B. */",
      "export function beta(): number {",
      "  return 2;",
      "}",
    ].join("\n"),
    symbols: (R) => [
      sym("alpha", K.Function, R(1, 0, 3, 1), R(1, 16, 1, 21)),
      sym("beta", K.Function, R(6, 0, 8, 1), R(6, 16, 6, 20)),
    ],
  };
  // Cursors placed bottom first; the panel must still read top to bottom.
  const { blocks } = await runGesture(fixture, [[7, 2], [2, 2]], "column80.contextAddSymbol");
  assert.deepStrictEqual(
    blocks.map((b) => [b.range.startLine, b.range.endLine]),
    [[1, 4], [6, 9]],
  );
});

gtest("a cursor in a nested function takes the nested function, not its parent", async () => {
  const fixture = {
    name: "nested.ts",
    languageId: "typescript",
    //  0 export function outer(): number {
    //  1   /** The inner one. */
    //  2   function inner(): number {
    //  3     return 1;
    //  4   }
    //  5   return inner();
    //  6 }
    text: [
      "export function outer(): number {",
      "  /** The inner one. */",
      "  function inner(): number {",
      "    return 1;",
      "  }",
      "  return inner();",
      "}",
    ].join("\n"),
    symbols: (R) => [
      sym("outer", K.Function, R(0, 0, 6, 1), R(0, 16, 0, 21), [
        sym("inner", K.Function, R(2, 2, 4, 3), R(2, 11, 2, 16)),
      ]),
    ],
  };
  const { blocks } = await runGesture(fixture, [[3, 6]], "column80.contextAddSymbol");
  assert.strictEqual(blocks.length, 1);
  assert.deepStrictEqual({ ...blocks[0].range }, { startLine: 2, endLine: 5 }, "inner, from its doc");
});

gtest("a struct, an interface and an enum are all blocks, though not all are generation targets", async () => {
  const fixture = {
    name: "shapes.ts",
    languageId: "typescript",
    //  0 /** A band. */
    //  1 export interface Band {
    //  2   lo: number;
    //  3 }
    //  4
    //  5 /** Levels. */
    //  6 export enum Lod {
    //  7   Near,
    //  8 }
    text: [
      "/** A band. */",
      "export interface Band {",
      "  lo: number;",
      "}",
      "",
      "/** Levels. */",
      "export enum Lod {",
      "  Near,",
      "}",
    ].join("\n"),
    symbols: (R) => [
      sym("Band", K.Interface, R(1, 0, 3, 1), R(1, 17, 1, 21), [sym("lo", K.Property, R(2, 2, 2, 13), R(2, 2, 2, 4))]),
      sym("Lod", K.Enum, R(6, 0, 8, 1), R(6, 12, 6, 15), [sym("Near", K.EnumMember, R(7, 2, 7, 7), R(7, 2, 7, 6))]),
    ],
  };
  const iface = await runGesture(fixture, [[2, 4]], "column80.contextAddSymbol");
  assert.deepStrictEqual({ ...iface.blocks[0].range }, { startLine: 1, endLine: 4 });
  const enm = await runGesture(fixture, [[7, 4]], "column80.contextAddSymbol");
  assert.deepStrictEqual({ ...enm.blocks[0].range }, { startLine: 6, endLine: 9 });
});

gtest("a C# file-scoped namespace is never the block, so the gesture cannot add the file", async () => {
  // The cursor is inside the namespace and the class but outside the method.
  const { blocks } = await runGesture(FIXTURES.csharp, [[3, 0]], "column80.contextAddSymbol");
  assert.strictEqual(blocks.length, 1);
  // The class, not the namespace: L3 to L16 1-based would be the whole file.
  assert.deepStrictEqual({ ...blocks[0].range }, { startLine: 3, endLine: 16 });
  assert.ok(!blocks[0].text.startsWith("namespace"), "the namespace line is not in the block");
});

// ===========================================================================
// contextAddBlock — the statement level
// ===========================================================================

gtest("the statement gesture takes the innermost multi-line node, not the function", async () => {
  // A chain shaped like the measured ones: token, expression, statement, the
  // `if` block, the `if` statement, the function body, the function, the file.
  const chains = () => [
    chainOf([
      [6, 4, 6, 15], // `stripe += 1` with leading whitespace trimmed
      [6, 0, 6, 16], // the whitespace-differing neighbour, same line span
      [5, 18, 7, 3], // the `if` block braces
      [5, 2, 7, 3], // the `if` statement
      [3, 39, 9, 1], // the function body
      [3, 0, 9, 1], // the function
      [0, 0, 9, 1], // the FILE
    ]),
  ];
  const { blocks } = await runGesture(FIXTURES.typescript, [[6, 6]], "column80.contextAddBlock", chains);
  assert.strictEqual(blocks.length, 1);
  // L6-L8 1-based is the `if` statement's lines. Not the single-line node above
  // it, not the function, and above all not the file.
  assert.deepStrictEqual({ ...blocks[0].range }, { startLine: 6, endLine: 8 });
  assert.match(blocks[0].text, /^ {2}if \(stripe > 1\) \{/);
});

gtest("a zero-width first node is skipped rather than becoming an empty block", async () => {
  // rust-analyzer's measured chain opens with a zero-width node.
  const chains = () => [
    chainOf([
      [4, 8, 4, 8], // ZERO WIDTH
      [4, 8, 4, 20], // the statement, one line
      [3, 19, 5, 5], // the `if` block
      [3, 4, 5, 5], // the `if` statement
      [1, 36, 7, 1], // the function body
      [0, 0, 7, 1], // the function, doc included (rust-analyzer)
    ]),
  ];
  const { blocks, warnings } = await runGesture(FIXTURES.rust, [[4, 8]], "column80.contextAddBlock", chains);
  assert.strictEqual(warnings.length, 0, "no empty-block refusal for the wrong reason");
  assert.deepStrictEqual({ ...blocks[0].range }, { startLine: 4, endLine: 6 });
});

// The fixture for the bound rows deliberately has code BELOW the target
// function, so the whole-file node is strictly bigger than the symbol block.
// An earlier draft used a fixture where the two coincided, and deleting the
// bound check from chooseChainBlock broke nothing — a green that proved nothing.
const BOUNDED = {
  name: "bounded.ts",
  languageId: "typescript",
  //  0 /** Fan out. */
  //  1 export function stripeFanout(): number {
  //  2   let stripe = 0;
  //  3   return stripe;
  //  4 }
  //  5
  //  6 export const TAIL = 1;
  text: [
    "/** Fan out. */",
    "export function stripeFanout(): number {",
    "  let stripe = 0;",
    "  return stripe;",
    "}",
    "",
    "export const TAIL = 1;",
  ].join("\n"),
  symbols: (R) => [sym("stripeFanout", K.Function, R(1, 0, 4, 1), R(1, 16, 1, 28))],
};

gtest("the whole-file node at the top of the chain is never taken", async () => {
  // Every node inside the bound is single-line, so the only multi-line
  // candidates are the function and the FILE. The file is strictly bigger than
  // the symbol here, so taking it is visible in the answer.
  const chains = () => [chainOf([[2, 2, 2, 17], [0, 0, 6, 22]])];
  const { blocks } = await runGesture(BOUNDED, [[2, 6]], "column80.contextAddBlock", chains);
  assert.strictEqual(blocks.length, 1);
  assert.deepStrictEqual({ ...blocks[0].range }, { startLine: 1, endLine: 5 }, "the symbol, doc included");
  assert.ok(!blocks[0].text.includes("TAIL"), "the file's tail is not in the block");
});

gtest("a node reaching past either end of the bound is rejected", async () => {
  // Starts inside, ends BELOW the symbol: a chain node that straddles the
  // closing brace. Rejecting it is what keeps the block inside the function.
  const straddleBelow = () => [chainOf([[2, 2, 2, 17], [2, 0, 6, 22], [0, 0, 6, 22]])];
  const below = await runGesture(BOUNDED, [[2, 6]], "column80.contextAddBlock", straddleBelow);
  assert.deepStrictEqual({ ...below.blocks[0].range }, { startLine: 1, endLine: 5 }, "fell back to the symbol");
  // Starts ABOVE the bound (above the doc comment) and ends inside.
  const straddleAbove = () => [chainOf([[2, 2, 2, 17], [0, 0, 3, 17], [0, 0, 6, 22]])];
  const above = await runGesture(
    { ...BOUNDED, symbols: (R) => [sym("stripeFanout", K.Function, R(1, 0, 4, 1), R(1, 16, 1, 28))] },
    [[2, 6]],
    "column80.contextAddBlock",
    straddleAbove,
  );
  // The doc run starts at line 0, so a node from line 0 is INSIDE this bound.
  // Tighten the bound by removing the doc comment to make the row honest.
  const noDoc = {
    name: "nodoc.ts",
    languageId: "typescript",
    //  0 const above = 1;
    //  1 export function f(): number {
    //  2   return 0;
    //  3 }
    text: ["const above = 1;", "export function f(): number {", "  return 0;", "}"].join("\n"),
    symbols: (R) => [sym("f", K.Function, R(1, 0, 3, 1), R(1, 16, 1, 17))],
  };
  const reachesAbove = () => [chainOf([[2, 2, 2, 12], [0, 0, 2, 12], [0, 0, 3, 1]])];
  const tightened = await runGesture(noDoc, [[2, 6]], "column80.contextAddBlock", reachesAbove);
  assert.deepStrictEqual(
    { ...tightened.blocks[0].range },
    { startLine: 2, endLine: 4 },
    "the node starting on line 0 is outside the bound, so the symbol wins",
  );
  assert.ok(!tightened.blocks[0].text.includes("const above"), "nothing above the function came along");
  assert.ok(above.blocks.length === 1, "the doc-included bound still answers");
});

gtest("no chain at all falls back to the enclosing symbol", async () => {
  const { blocks, warnings } = await runGesture(FIXTURES.go, [[6, 3]], "column80.contextAddBlock", undefined);
  assert.strictEqual(warnings.length, 0);
  assert.deepStrictEqual({ ...blocks[0].range }, { startLine: 3, endLine: 10 });
});

gtest("the statement gesture refuses outside every symbol, chain or no chain", async () => {
  const fixture = {
    name: "gap.ts",
    languageId: "typescript",
    text: ["const unrelated = 1;", "", "export function f(): number {", "  return 0;", "}"].join("\n"),
    symbols: (R) => [sym("f", K.Function, R(2, 0, 4, 1), R(2, 16, 2, 17))],
  };
  // A chain IS offered, and it reaches the whole file. The refusal must win.
  const chains = () => [chainOf([[0, 6, 0, 15], [0, 0, 4, 1]])];
  const { blocks, warnings } = await runGesture(fixture, [[0, 8]], "column80.contextAddBlock", chains);
  assert.strictEqual(blocks.length, 0);
  assert.strictEqual(warnings.length, 1);
  assert.match(warnings[0], /nothing added to model context/);
});

gtest("statement blocks are whole lines, so isStale stays quiet on a fresh add", async () => {
  const chains = () => [chainOf([[6, 4, 6, 15], [5, 2, 7, 3], [0, 0, 9, 1]])];
  const { blocks, doc } = await runGesture(FIXTURES.typescript, [[6, 6]], "column80.contextAddBlock", chains);
  assert.strictEqual(surf.sliceLines(doc.getText(), blocks[0].range), blocks[0].text);
  assert.strictEqual(surf.isStale(blocks[0], { version: doc.version, text: doc.getText() }), false);
});

gtest("two cursors in the same statement block collapse to one", async () => {
  const chains = () => [
    chainOf([[6, 4, 6, 15], [5, 2, 7, 3], [0, 0, 9, 1]]),
    chainOf([[6, 10, 6, 15], [5, 2, 7, 3], [0, 0, 9, 1]]),
  ];
  const { blocks } = await runGesture(FIXTURES.typescript, [[6, 6], [6, 12]], "column80.contextAddBlock", chains);
  assert.strictEqual(blocks.length, 1);
});

// ===========================================================================
// The pure seams the implementer owns
// ===========================================================================

gtest("symbolBlockRange converts 0-based inclusive lines to a 1-based inclusive range", () => {
  assert.deepStrictEqual(surf.symbolBlockRange(0, 7), { startLine: 1, endLine: 8 });
  assert.deepStrictEqual(surf.symbolBlockRange(4, 4), { startLine: 5, endLine: 5 }, "a one-line symbol");
});

gtest("orderedCursors sorts by line then character and keeps empty positions", () => {
  const cursors = [
    { line: 6, character: 2 },
    { line: 1, character: 9 },
    { line: 1, character: 0 },
  ];
  assert.deepStrictEqual(surf.orderedCursors(cursors), [
    { line: 1, character: 0 },
    { line: 1, character: 9 },
    { line: 6, character: 2 },
  ]);
  assert.strictEqual(surf.orderedCursors(cursors).length, 3, "no empty-selection filter here");
  assert.deepStrictEqual(cursors[0], { line: 6, character: 2 }, "input not sorted in place");
});

gtest("chooseChainBlock honours chain order rather than sorting by size", () => {
  const bound = { firstLine: 0, lastLine: 9 };
  const inner = { startLine: 5, startCharacter: 2, endLine: 7, endCharacter: 3 };
  const outer = { startLine: 3, startCharacter: 0, endLine: 9, endCharacter: 1 };
  assert.deepStrictEqual(surf.chooseChainBlock([inner, outer], bound), inner, "innermost first is the contract");
  assert.deepStrictEqual(surf.chooseChainBlock([outer, inner], bound), outer, "and it is order, not size");
});

gtest("chooseChainBlock hands back a copy, not a live handle into the chain", () => {
  const bound = { firstLine: 0, lastLine: 9 };
  const node = { startLine: 5, startCharacter: 2, endLine: 7, endCharacter: 3 };
  const chain = [node];
  const out = surf.chooseChainBlock(chain, bound);
  assert.notStrictEqual(out, node, "a caller writing to the result must not rewrite the chain");
  out.endLine = 99;
  assert.strictEqual(chain[0].endLine, 7);
});
