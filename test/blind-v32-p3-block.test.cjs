// Blind oracle: the include-the-block gestures' PURE core
// (session-v32/contract-p3-block.md, goal.md item 4). Black-box contract tests
// written from the CONTRACT ALONE, before the implementation exists. Covers:
//   §symbolBlockRange  every row of the contract's first case table: a run start
//                      above the symbol range start, a run start equal to the
//                      name line, a single-line symbol; plus the 0-based to
//                      1-based conversion itself and "refuses nothing"
//   §chooseChainBlock  every row of the contract's second case table: the
//                      zero-width first node, the whole-file node, single-line
//                      whitespace duplicates, duplicate MULTI-LINE neighbours,
//                      only-single-line-inside-the-bound, the empty chain, a
//                      multi-line `if` inside a long function, a node straddling
//                      the top of the bound, a node running past the bottom
//   §purity            frozen chain and frozen bound, inputs unchanged after
//   §chain order       the SAME node set handed in outermost-first gives a
//                      different answer, which pins "Order within the chain is
//                      respected" rather than an internal sort
//
// `resolveBlockAtCursor` is deliberately NOT here: it needs a vscode stub and is
// the implementer's job.
//
// Never read src/**. The whole point of this file is independence from the
// implementation, which does not exist yet. Expected RED until phase 3 lands:
// `symbolBlockRange` and `chooseChainBlock` are not exported from
// src/core/contextGestures yet, so the gate below keeps that red informative -
// ONE failing bundle test, every other test skips.
//
// Chain fixtures are built from the REAL chains measured in
// session-v32/scout-findings.md finding 5, one per server, depths included. Each
// fixture says which server it came from. Where finding 5 gives only the depth
// and the two named nodes, the intermediate nodes are filled in with the shapes
// the same finding measured (whitespace-duplicate neighbours, a body block
// inside its declaration, the whole file on top) - never copied from any
// implementation.
//
// Run: SKIP_LIVE=1 node --test test/blind-v32-p3-block.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { bundleCore } = require("./.blind-util.cjs");

let mod = {};
let cleanup = () => {};
let bundleError;
try {
  ({ mod, cleanup } = bundleCore(
    "blind-v32-p3-block",
    `export { symbolBlockRange, chooseChainBlock } from "../src/core/contextGestures";\n`
  ));
} catch (e) {
  bundleError = e;
}
// A FAILED bundle never returns a cleanup, and it still wrote the entry file.
// Sweep both paths so a red run leaves nothing behind in the tree.
test.after(() => {
  cleanup();
  for (const leftover of [".blind-v32-p3-block.entry.ts", ".blind-v32-p3-block.bundle.cjs"]) {
    fs.rmSync(path.join(__dirname, leftover), { force: true });
  }
});

const { symbolBlockRange, chooseChainBlock } = mod;

// esbuild bundles TypeScript without erroring on a missing named re-export (it
// cannot tell a value from a type), so an absent function arrives as undefined
// rather than as a bundle failure. Both are the same red: the surface is not
// built yet.
const notReady = bundleError
  ? `bundle failed to build: ${bundleError.message}`
  : typeof symbolBlockRange !== "function" || typeof chooseChainBlock !== "function"
    ? `src/core/contextGestures does not export both pure functions yet ` +
      `(symbolBlockRange: ${typeof symbolBlockRange}, chooseChainBlock: ${typeof chooseChainBlock})`
    : undefined;

test("bundle: src/core/contextGestures exports symbolBlockRange + chooseChainBlock [contract-p3-block.md '`symbolBlockRange`, in `src/core/contextGestures.ts`'; '`chooseChainBlock`, in `src/core/contextGestures.ts`']", () => {
  if (notReady) assert.fail(`phase 3 is not implemented yet - ${notReady}`);
  assert.strictEqual(typeof symbolBlockRange, "function", "symbolBlockRange is the 0-based to 1-based conversion");
  assert.strictEqual(typeof chooseChainBlock, "function", "chooseChainBlock picks the block out of a selectionRange chain");
});

// Every other test skips (not fails) while the surface is missing, so the red
// run stays one loud failure instead of a wall of TypeErrors.
const gtest = (name, fn) =>
  test(name, (ctx) => {
    if (notReady) return ctx.skip("surface missing; see the bundle test");
    return fn(ctx);
  });

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

// A ChainRange, per the contract's interface: 0-based lines, characters.
const r = (startLine, startCharacter, endLine, endCharacter) => ({
  startLine,
  startCharacter,
  endLine,
  endCharacter,
});

// CONTRACT GAP (reported): the contract names the return type
// `ContextBlockRange` and says only "0-based inclusive editor lines to the
// store's 1-based inclusive range". It never spells the shape out, unlike
// ChainRange and BlockBound which it declares in full. So these rows assert the
// VALUES that must be present, not field names, and one dedicated row below
// pins the field count. Collect every number anywhere in the result.
const numbersIn = (v, out = []) => {
  if (typeof v === "number") out.push(v);
  else if (v && typeof v === "object") for (const k of Object.keys(v)) numbersIn(v[k], out);
  return out;
};

const deepFreezeChain = (chain) => Object.freeze(chain.map((n) => Object.freeze({ ...n })));

// ---------------------------------------------------------------------------
// Chain fixtures, one per server measured in finding 5. Every one carries the
// measured depth, a whole-file node on top, and the whitespace-duplicate
// neighbours the finding says EVERY server emits.
//
// `bound` is what the caller derives from resolveBlockAtCursor: firstLine is
// attachRunStart's answer (the doc comment line), lastLine the symbol's last
// line. [contract-p3-block.md 'firstLine | 0-based, the enclosing symbol's
// first line']
// ---------------------------------------------------------------------------

// gopls, chain depth 7. Cursor in `panic("not implemented")` (L8) inside
// `func stripeFanout() uint32 {` L7-L9. Doc comment run starts L6.
const GOPLS_CHAIN = [
  r(8, 1, 8, 24), // the panic(...) call
  r(8, 1, 8, 25), // the expression statement, SAME line span
  r(8, 0, 8, 25), // the leading-whitespace duplicate, same line span again
  r(7, 25, 9, 1), // the function's body block, MULTI-LINE
  r(7, 0, 9, 1), // `func stripeFanout() uint32 {` L7-L9, as measured
  r(0, 0, 58, 1), // the declaration list
  r(0, 0, 58, 2), // the whole file, as measured (L0C0-L58C2)
];
const GOPLS_BOUND = Object.freeze({ firstLine: 6, lastLine: 9 });
const GOPLS_WINNER = r(7, 25, 9, 1);

// tsserver, chain depth 9. Cursor in `throw new Error("generate over me");`
// (L7) inside `export function stripeFanout(): number {` L6-L8. JSDoc L3-L5.
const TS_CHAIN = [
  r(7, 10, 7, 22), // `new Error`
  r(7, 10, 7, 37), // the new expression with its argument
  r(7, 4, 7, 38), // the throw statement
  r(7, 0, 7, 38), // the leading-whitespace duplicate
  r(6, 39, 8, 1), // the body block, MULTI-LINE
  r(6, 7, 8, 1), // the function declaration
  r(6, 0, 8, 1), // the export statement wrapping it, same line span
  r(0, 0, 82, 1), // the statement list
  r(0, 0, 83, 0), // the whole file
];
const TS_BOUND = Object.freeze({ firstLine: 3, lastLine: 8 });
const TS_WINNER = r(6, 39, 8, 1);

// Roslyn, chain depth 10. Cursor in
// `throw new System.NotImplementedException();` (L12) inside
// `public static int StripeFanout()` L10-L13. `///` doc line L9. Finding 5:
// "Roslyn does it twice more at the block level", so the whitespace duplicates
// appear on the body block and on the declaration too.
const ROSLYN_CHAIN = [
  r(12, 18, 12, 57), // the object creation
  r(12, 12, 12, 58), // the throw statement
  r(12, 8, 12, 58), // whitespace duplicate
  r(12, 0, 12, 58), // whitespace duplicate again
  r(11, 8, 13, 9), // the method body block, MULTI-LINE
  r(11, 0, 13, 9), // the block's whitespace duplicate, SAME line span
  r(10, 4, 13, 9), // the method declaration
  r(10, 0, 13, 9), // the declaration's whitespace duplicate
  r(8, 0, 20, 1), // the enclosing class
  r(0, 0, 58, 2), // the whole file
];
const ROSLYN_BOUND = Object.freeze({ firstLine: 9, lastLine: 13 });
const ROSLYN_WINNER = r(11, 8, 13, 9);

// Pylance, chain depth 5. Cursor in `return a + b` (L6) inside
// `def spike_add(...)` L5-L6. A `#` comment run starts L4. The only multi-line
// node inside the bound IS the enclosing symbol.
const PYLANCE_CHAIN = [
  r(6, 11, 6, 16), // `a + b`
  r(6, 4, 6, 16), // the return statement
  r(6, 0, 6, 16), // the whitespace duplicate
  r(5, 0, 6, 16), // `def spike_add(...)` L5-L6, MULTI-LINE
  r(0, 0, 24, 0), // the module
];
const PYLANCE_BOUND = Object.freeze({ firstLine: 4, lastLine: 6 });
const PYLANCE_WINNER = r(5, 0, 6, 16);

// rust-analyzer, chain depth 7. Cursor in `let mut stripe = Stripe::new();`
// (L28) inside `fn probe() -> u32 {` L27-L30. The first node is the measured
// ZERO-WIDTH L28C7-L28C7. `///` doc line L26 (Rust's symbol range carries it).
const RA_CHAIN = [
  r(28, 7, 28, 7), // ZERO WIDTH, measured verbatim
  r(28, 21, 28, 35), // `Stripe::new()`
  r(28, 4, 28, 35), // the let statement
  r(28, 0, 28, 35), // the whitespace duplicate
  r(27, 18, 30, 1), // the body block, MULTI-LINE
  r(27, 0, 30, 1), // `fn probe() -> u32 {` L27-L30, as measured
  r(0, 0, 58, 2), // the whole file, as measured
];
const RA_BOUND = Object.freeze({ firstLine: 26, lastLine: 30 });
const RA_WINNER = r(27, 18, 30, 1);

const FIVE_SERVERS = [
  ["gopls (depth 7)", GOPLS_CHAIN, GOPLS_BOUND, GOPLS_WINNER],
  ["tsserver (depth 9)", TS_CHAIN, TS_BOUND, TS_WINNER],
  ["Roslyn (depth 10)", ROSLYN_CHAIN, ROSLYN_BOUND, ROSLYN_WINNER],
  ["Pylance (depth 5)", PYLANCE_CHAIN, PYLANCE_BOUND, PYLANCE_WINNER],
  ["rust-analyzer (depth 7)", RA_CHAIN, RA_BOUND, RA_WINNER],
];

// ===========================================================================
// 1. symbolBlockRange - the contract's first case table.
//    [contract-p3-block.md '0-based inclusive editor lines to the store's
//     1-based inclusive range']
// ===========================================================================

gtest("symbolBlockRange: a run start ABOVE the symbol range start - the block begins at the doc comment [contract-p3-block.md case table 'a run start above the symbol range start | the block begins at the doc comment']", () => {
  // attachRunStart said L6 (the `///` line); the symbol's own range starts L7.
  // The declaration line must NOT be where the block begins.
  const got = symbolBlockRange(6, 9);
  const nums = numbersIn(got);
  assert.ok(
    nums.includes(7),
    `the 1-based block starts at the doc comment line (0-based 6 -> 1-based 7), got ${JSON.stringify(got)}`
  );
  assert.ok(
    !nums.includes(8),
    `the block must not begin at the declaration line (0-based 7 -> 1-based 8): attachRunStart's answer is the input, not symbol.range.start, got ${JSON.stringify(got)}`
  );
  assert.ok(nums.includes(10), `the block ends at the symbol's last line (0-based 9 -> 1-based 10), got ${JSON.stringify(got)}`);
});

gtest("symbolBlockRange: a run start EQUAL to the name line (no run) - the block begins at the declaration [contract-p3-block.md case table 'a run start equal to the name line (no run) | the block begins at the declaration']", () => {
  const got = symbolBlockRange(7, 9);
  const nums = numbersIn(got);
  assert.ok(nums.includes(8), `no trivia run, so the block starts at the declaration (0-based 7 -> 1-based 8), got ${JSON.stringify(got)}`);
  assert.ok(nums.includes(10), `and ends at 0-based 9 -> 1-based 10, got ${JSON.stringify(got)}`);
});

gtest("symbolBlockRange: a single-line symbol is a ONE-LINE range, start === end [contract-p3-block.md case table 'a single-line symbol | a one-line range, start === end']", () => {
  const got = symbolBlockRange(4, 4);
  const nums = numbersIn(got);
  assert.ok(nums.includes(5), `0-based 4 converts to 1-based 5, got ${JSON.stringify(got)}`);
  assert.strictEqual(
    new Set(nums).size,
    1,
    `a one-line symbol yields one distinct line number on both ends, got ${JSON.stringify(got)}`
  );
});

// This is the row that pins the SHAPE, and the row that will red first if the
// contract's unstated ContextBlockRange is not two line numbers. See the
// CONTRACT GAP note on numbersIn above.
gtest("symbolBlockRange: the result is exactly TWO line numbers, nothing else - the 1-based pair and no smuggled 0-based value [contract-p3-block.md 'to the store's 1-based inclusive range']", () => {
  const got = symbolBlockRange(6, 9);
  assert.strictEqual(typeof got, "object", "a ContextBlockRange is an object");
  assert.deepStrictEqual(
    numbersIn(got).slice().sort((a, b) => a - b),
    [7, 10],
    `the contract does not spell ContextBlockRange's fields out; whatever they are, the only numbers in it are the 1-based first and last lines. Got ${JSON.stringify(got)}`
  );
});

gtest("symbolBlockRange: line 0 of the file becomes line 1, never 0 - the store is 1-based [contract-p3-block.md '0-based inclusive editor lines to the store's 1-based inclusive range']", () => {
  const got = symbolBlockRange(0, 0);
  const nums = numbersIn(got);
  assert.ok(nums.includes(1), `the file's first line is 1 in the store, got ${JSON.stringify(got)}`);
  assert.ok(!nums.includes(0), `a 0 in the result is the off-by-one that ships an out-of-range block, got ${JSON.stringify(got)}`);
});

gtest("symbolBlockRange: REFUSES NOTHING - lastLine < firstLine is converted, not rejected, and the store's own throw stays the only guard [contract-p3-block.md 'Refuses nothing: a caller handing in `lastLine < firstLine` is a bug, and the store already throws on a malformed range']", () => {
  let got;
  assert.doesNotThrow(() => {
    got = symbolBlockRange(9, 6);
  }, "symbolBlockRange itself refuses nothing; validation belongs to the store");
  assert.strictEqual(typeof got, "object", "an inverted input still returns a range object for the store to reject");
});

gtest("symbolBlockRange: two calls are independent, and a wide symbol converts both ends [contract-p3-block.md 'Pure' (stated for chooseChainBlock; symbolBlockRange takes only numbers)]", () => {
  const a = symbolBlockRange(0, 57);
  const b = symbolBlockRange(6, 9);
  assert.deepStrictEqual(numbersIn(a).slice().sort((x, y) => x - y), [1, 58], `a whole-file-sized symbol converts both ends, got ${JSON.stringify(a)}`);
  assert.deepStrictEqual(numbersIn(b).slice().sort((x, y) => x - y), [7, 10], `the second call is unaffected by the first, got ${JSON.stringify(b)}`);
});

// ===========================================================================
// 2. chooseChainBlock on the five MEASURED chains.
//    [contract-p3-block.md 'Take the innermost MULTI-LINE node, that is the
//     first surviving node with `endLine > startLine`']
// ===========================================================================

gtest("chooseChainBlock: all five measured chains (gopls 7, tsserver 9, Roslyn 10, Pylance 5, rust-analyzer 7) pick the innermost multi-line node inside the bound [scout-findings.md finding 5; contract-p3-block.md rules 1-4]", () => {
  for (const [server, chain, bound, winner] of FIVE_SERVERS) {
    const got = chooseChainBlock(chain, bound);
    assert.deepStrictEqual(got, winner, `${server}: expected the innermost surviving multi-line node`);
  }
});

gtest("chooseChainBlock: on none of the five measured chains is the WHOLE-FILE node taken [contract-p3-block.md case table 'a whole-file node at the top of the chain | never taken'; rule 2 'The top of every chain is the whole file']", () => {
  for (const [server, chain, bound] of FIVE_SERVERS) {
    const got = chooseChainBlock(chain, bound);
    assert.ok(got, `${server}: something usable was found`);
    const file = chain[chain.length - 1];
    assert.notDeepStrictEqual(got, file, `${server}: the top of the chain is the whole file and must never be the block`);
    assert.ok(got.startLine >= bound.firstLine, `${server}: startLine ${got.startLine} is inside the bound (>= ${bound.firstLine})`);
    assert.ok(got.endLine <= bound.lastLine, `${server}: endLine ${got.endLine} is inside the bound (<= ${bound.lastLine})`);
  }
});

gtest("chooseChainBlock: the answer is always MULTI-LINE and never empty on the five measured chains [contract-p3-block.md rule 4 'A single-line node is a statement or a token, not a block'; rule 1 'Skip empty ranges']", () => {
  for (const [server, chain, bound] of FIVE_SERVERS) {
    const got = chooseChainBlock(chain, bound);
    assert.ok(got, `${server}: a block was found`);
    assert.ok(got.endLine > got.startLine, `${server}: endLine ${got.endLine} > startLine ${got.startLine}`);
  }
});

gtest("chooseChainBlock: the returned node is one of the chain's own ChainRanges, value for value [contract-p3-block.md 'Picks the block out of a `selectionRange` chain']", () => {
  for (const [server, chain, bound] of FIVE_SERVERS) {
    const got = chooseChainBlock(chain, bound);
    // Identity is NOT asserted: the contract says "Pure. Neither argument is
    // mutated" and never says whether the result is the input element or a
    // copy. Reported as a CONTRACT GAP.
    assert.ok(
      chain.some((n) => n.startLine === got.startLine && n.startCharacter === got.startCharacter && n.endLine === got.endLine && n.endCharacter === got.endCharacter),
      `${server}: the result is a node the provider actually returned, not a synthesized range. Got ${JSON.stringify(got)}`
    );
  }
});

// ===========================================================================
// 3. chooseChainBlock - the contract's second case table, row by row.
// ===========================================================================

gtest("chooseChainBlock: a ZERO-WIDTH first node is skipped and the next usable node wins [contract-p3-block.md case table 'a zero-width first node | skipped, the next usable node wins'; rule 1 'rust-analyzer's first node is zero-width (L28C7-L28C7)']", () => {
  // rust-analyzer's measured zero-width node, with the next node made a
  // different line span so the skip is OBSERVABLE in the return value.
  const chain = [r(28, 7, 28, 7), r(27, 18, 30, 1), r(0, 0, 58, 2)];
  const got = chooseChainBlock(chain, RA_BOUND);
  assert.notDeepStrictEqual(got, chain[0], "chain[0] is zero-width; taking it blindly ships an empty block the store then refuses for the wrong reason");
  assert.deepStrictEqual(got, r(27, 18, 30, 1), "the next usable node wins");
});

gtest("chooseChainBlock: a zero-width node is empty by the contract's own test - same line AND same character - while a same-line node with different characters is merely single-line [contract-p3-block.md rule 1 'A range is empty when its start and end are the same line AND the same character']", () => {
  // Both are excluded, but for the two DIFFERENT stated reasons. The observable
  // is the same: neither is ever the block.
  const chain = [r(30, 4, 30, 4), r(30, 4, 30, 40), r(29, 10, 33, 5), r(0, 0, 58, 2)];
  const got = chooseChainBlock(chain, { firstLine: 28, lastLine: 34 });
  assert.deepStrictEqual(got, r(29, 10, 33, 5), "the empty node and the single-line node are both passed over");
});

gtest("chooseChainBlock: a chain that is ONLY the whole-file node yields undefined - the walk never runs off the end [contract-p3-block.md case table 'a whole-file node at the top of the chain | never taken'; rule 2 'A walk that runs to the end of the chain silently includes the entire file']", () => {
  assert.strictEqual(
    chooseChainBlock([r(0, 0, 58, 2)], GOPLS_BOUND),
    undefined,
    "the whole file is outside the bound, so nothing survives and the caller falls back to the enclosing symbol"
  );
});

gtest("chooseChainBlock: whitespace-duplicate neighbours on ONE line collapse and neither is taken [contract-p3-block.md case table 'whitespace-duplicate neighbours on one line | collapse, and neither is taken (single-line)'; rule 3 'L12C8-L12C51 then L12C0-L12C51']", () => {
  // The measured pair verbatim, as the only in-bound nodes.
  const onlyDupes = [r(12, 8, 12, 51), r(12, 0, 12, 51), r(0, 0, 58, 2)];
  assert.strictEqual(
    chooseChainBlock(onlyDupes, { firstLine: 10, lastLine: 20 }),
    undefined,
    "both are single-line, so neither is a block and nothing else survives"
  );
  // And with a real block behind them, the block is what comes back.
  const withBlock = [r(12, 8, 12, 51), r(12, 0, 12, 51), r(11, 4, 14, 5), r(0, 0, 58, 2)];
  assert.deepStrictEqual(
    chooseChainBlock(withBlock, { firstLine: 10, lastLine: 20 }),
    r(11, 4, 14, 5),
    "the duplicate pair is passed over and the enclosing multi-line node wins"
  );
});

gtest("chooseChainBlock: duplicate MULTI-LINE neighbours give one block, the INNERMOST (first in chain order) [contract-p3-block.md case table 'duplicate multi-line neighbours | one block, the innermost'; rule 3 'The FIRST occurrence in chain order wins, which is the innermost one']", () => {
  // Roslyn's measured block-level duplicate pair: L11C8-L13C9 then L11C0-L13C9,
  // the same LINE span, differing only by leading whitespace.
  const got = chooseChainBlock(ROSLYN_CHAIN, ROSLYN_BOUND);
  assert.deepStrictEqual(got, r(11, 8, 13, 9), "the first occurrence of the line span wins");
  assert.notDeepStrictEqual(got, r(11, 0, 13, 9), "the whitespace-widened duplicate is the second occurrence and loses");
});

gtest("chooseChainBlock: a chain with ONLY single-line nodes inside the bound yields undefined [contract-p3-block.md case table 'a chain with only single-line nodes inside the bound | undefined'; rule 5 'undefined when nothing survives all four']", () => {
  const chain = [r(21, 12, 21, 30), r(21, 8, 21, 31), r(21, 0, 21, 31), r(0, 0, 58, 2)];
  assert.strictEqual(
    chooseChainBlock(chain, { firstLine: 20, lastLine: 24 }),
    undefined,
    "a one-line context block is not what the gesture is for, so the caller falls back to the symbol"
  );
});

gtest("chooseChainBlock: an EMPTY chain yields undefined [contract-p3-block.md case table 'an empty chain | undefined'; 'Returns undefined when the chain offers nothing usable']", () => {
  assert.strictEqual(chooseChainBlock([], GOPLS_BOUND), undefined, "no nodes, nothing usable");
  assert.strictEqual(chooseChainBlock(Object.freeze([]), GOPLS_BOUND), undefined, "a frozen empty chain behaves the same");
});

gtest("chooseChainBlock: a multi-line `if` inside a long function gives the IF, not the function [contract-p3-block.md case table 'a multi-line if inside a long function | the if, not the function'; rule 4 'the first surviving node with endLine > startLine']", () => {
  // A 30-line function L10-L40 with an `if` at L20-L24, shaped like the measured
  // chains: single-line statement nodes and their whitespace duplicate inside
  // the if, then the if, then the body, then the declaration, then the file.
  const chain = [
    r(21, 12, 21, 30), // the call inside the if
    r(21, 8, 21, 31), // the statement
    r(21, 0, 21, 31), // the whitespace duplicate
    r(20, 4, 24, 5), // the `if`, MULTI-LINE
    r(10, 30, 40, 1), // the function's body block
    r(10, 0, 40, 1), // the function declaration
    r(0, 0, 58, 2), // the whole file
  ];
  const got = chooseChainBlock(chain, { firstLine: 9, lastLine: 40 });
  assert.deepStrictEqual(got, r(20, 4, 24, 5), "the innermost multi-line node is the `if`");
  assert.notDeepStrictEqual(got, r(10, 30, 40, 1), "the function's body is not the innermost block");
  assert.notDeepStrictEqual(got, r(10, 0, 40, 1), "and the function itself certainly is not");
});

gtest("chooseChainBlock: a node STARTING ABOVE the bound but ending inside it is rejected [contract-p3-block.md case table 'a node starting above the bound but ending inside it | rejected'; rule 2 'startLine >= bound.firstLine && endLine <= bound.lastLine']", () => {
  const bound = { firstLine: 9, lastLine: 13 };
  const straddler = r(8, 0, 13, 9); // begins on the class line, ends on the method's last line
  assert.strictEqual(
    chooseChainBlock([straddler, r(0, 0, 58, 2)], bound),
    undefined,
    "half-inside is outside: the node would pull in a line above the enclosing symbol"
  );
  assert.deepStrictEqual(
    chooseChainBlock([straddler, r(11, 8, 13, 9), r(0, 0, 58, 2)], bound),
    r(11, 8, 13, 9),
    "the straddler is skipped even though it comes first in chain order"
  );
});

gtest("chooseChainBlock: a node ENDING BELOW the bound is rejected [contract-p3-block.md case table 'a node ending below the bound | rejected'; rule 2]", () => {
  const bound = { firstLine: 9, lastLine: 13 };
  const overrun = r(11, 0, 45, 0); // starts inside, runs far past the symbol's last line
  assert.strictEqual(
    chooseChainBlock([overrun, r(0, 0, 58, 2)], bound),
    undefined,
    "a node running past the symbol's last line is outside the bound"
  );
  assert.deepStrictEqual(
    chooseChainBlock([overrun, r(11, 8, 13, 9), r(0, 0, 58, 2)], bound),
    r(11, 8, 13, 9),
    "the overrunning node is skipped and the next in-bound multi-line node wins"
  );
});

// ===========================================================================
// 4. The two edge shapes the case table does not name.
// ===========================================================================

gtest("chooseChainBlock: when the ONLY multi-line node inside the bound is the enclosing symbol itself, that node is the block - the bound is inclusive at both ends (Pylance's measured depth-5 chain) [contract-p3-block.md rule 2 'startLine >= bound.firstLine && endLine <= bound.lastLine']", () => {
  // `def spike_add(...)` L5-L6 with `return a + b` on L6: the def is the only
  // node with endLine > startLine that fits inside the bound.
  const got = chooseChainBlock(PYLANCE_CHAIN, PYLANCE_BOUND);
  assert.deepStrictEqual(got, PYLANCE_WINNER, "the enclosing symbol's own node qualifies; there is nothing narrower");
  // And the same chain with the bound tightened to the symbol's exact span
  // still admits it, because both comparisons are >= and <=.
  assert.deepStrictEqual(
    chooseChainBlock(PYLANCE_CHAIN, { firstLine: 5, lastLine: 6 }),
    PYLANCE_WINNER,
    "startLine === bound.firstLine and endLine === bound.lastLine are both INSIDE the bound"
  );
});

gtest("chooseChainBlock: a bound of a SINGLE line (a one-line function) yields undefined - every node that fits is single-line [contract-p3-block.md rule 2 + rule 4 together]", () => {
  // `fn one() -> u32 { 0 }` entirely on L4, no doc comment, so the bound is one
  // line. The caller's fallback is the enclosing symbol, which is what
  // symbolBlockRange(4, 4) converts.
  const chain = [r(4, 18, 4, 19), r(4, 16, 4, 21), r(4, 0, 4, 21), r(3, 0, 8, 1), r(0, 0, 58, 2)];
  assert.strictEqual(
    chooseChainBlock(chain, { firstLine: 4, lastLine: 4 }),
    undefined,
    "no node can be multi-line and fit inside a one-line bound, so the statement-level gesture defers to the symbol-level one"
  );
});

// ===========================================================================
// 5. Chain ORDER is respected, not re-sorted.
//    [contract-p3-block.md 'Order within the chain is respected, so a caller
//     must hand it in innermost-first'; 'chain: readonly ChainRange[] //
//     INNERMOST FIRST, as the provider returns it']
// ===========================================================================

gtest("chooseChainBlock: the SAME node set handed in OUTERMOST-first gives a DIFFERENT answer - the function honours chain order and does not sort [contract-p3-block.md 'Order within the chain is respected'; rule 3 'The FIRST occurrence in chain order wins']", () => {
  const innermostFirst = chooseChainBlock(ROSLYN_CHAIN, ROSLYN_BOUND);
  const outermostFirst = chooseChainBlock(ROSLYN_CHAIN.slice().reverse(), ROSLYN_BOUND);
  assert.deepStrictEqual(innermostFirst, r(11, 8, 13, 9), "innermost-first: the method body block");
  // Reversed, the first in-bound multi-line survivor is the OUTERMOST one that
  // fits: the class (L8-L20) starts above the bound and is rejected, so the
  // declaration's whitespace duplicate (L10C0-L13C9) is reached first and wins
  // the line-span dedupe over L10C4-L13C9.
  assert.deepStrictEqual(
    outermostFirst,
    r(10, 0, 13, 9),
    "outermost-first: the widest in-bound node, which is the WRONG block - proving the order the caller supplies is the order that decides"
  );
  assert.notDeepStrictEqual(
    outermostFirst,
    innermostFirst,
    "an internal sort, a max-span pick, or a last-wins walk would make these two calls agree; the contract says they must not"
  );
});

gtest("chooseChainBlock: reversing a chain does not change WHICH nodes are admitted, only which is reached first - the bound filter is order-free [contract-p3-block.md rule 2]", () => {
  const forward = chooseChainBlock(GOPLS_CHAIN, GOPLS_BOUND);
  const reversed = chooseChainBlock(GOPLS_CHAIN.slice().reverse(), GOPLS_BOUND);
  assert.deepStrictEqual(forward, r(7, 25, 9, 1), "innermost-first: the body block");
  assert.deepStrictEqual(reversed, r(7, 0, 9, 1), "outermost-first: the func declaration, which is admitted but is not the innermost block");
});

// ===========================================================================
// 6. Purity.
//    [contract-p3-block.md 'Pure. Neither argument is mutated.']
// ===========================================================================

gtest("chooseChainBlock: a DEEPLY FROZEN chain and a frozen bound are accepted - a sort, a splice or a field write would throw here [contract-p3-block.md 'Pure. Neither argument is mutated.']", () => {
  for (const [server, chain, bound, winner] of FIVE_SERVERS) {
    const frozen = deepFreezeChain(chain);
    let got;
    assert.doesNotThrow(() => {
      got = chooseChainBlock(frozen, Object.freeze({ ...bound }));
    }, `${server}: a frozen chain must not be mutated, so it must not throw`);
    assert.deepStrictEqual(got, winner, `${server}: the frozen chain gives the same answer as the unfrozen one`);
  }
});

gtest("chooseChainBlock: the chain array and every element come back byte-identical after the call [contract-p3-block.md 'Neither argument is mutated']", () => {
  const chain = ROSLYN_CHAIN.map((n) => ({ ...n }));
  const before = JSON.stringify(chain);
  const bound = { firstLine: ROSLYN_BOUND.firstLine, lastLine: ROSLYN_BOUND.lastLine };
  const boundBefore = JSON.stringify(bound);
  chooseChainBlock(chain, bound);
  assert.strictEqual(JSON.stringify(chain), before, "no element was rewritten and no element was reordered or removed");
  assert.strictEqual(chain.length, ROSLYN_CHAIN.length, "the chain was not filtered in place");
  assert.strictEqual(JSON.stringify(bound), boundBefore, "the bound was not touched");
});

gtest("chooseChainBlock: called twice on the same inputs it gives the same answer, and the first call cannot spoil the second [contract-p3-block.md 'Pure']", () => {
  const chain = RA_CHAIN.map((n) => ({ ...n }));
  const first = chooseChainBlock(chain, RA_BOUND);
  const second = chooseChainBlock(chain, RA_BOUND);
  assert.deepStrictEqual(first, RA_WINNER, "the first call picks the body block");
  assert.deepStrictEqual(second, first, "no memo, no cursor, no consumed iterator");
});

// CONTRACT GAP, deliberately NOT asserted. The contract says "Pure. Neither
// argument is mutated" and nothing whatever about the identity of the RESULT:
// whether `chooseChainBlock` returns the chain element itself or a copy of it,
// and whether the result is frozen. Measured black-box on this build, the result
// IS the input element: setting `got.startLine` afterwards changes the chain, so
// a second call on the same chain returns a DIFFERENT node. That may be fine
// (every caller in the contract passes the result straight to the store) or it
// may be a live handle waiting to bite, but the contract does not rule, so this
// row records the question instead of inventing an answer. Give it a rule in the
// contract and it becomes an ordinary assertion.
gtest("CONTRACT GAP (recorded, not asserted): whether the returned ChainRange is an ALIAS of the input element is unspecified - measured as an alias [contract-p3-block.md 'Pure. Neither argument is mutated.' says nothing about the result's identity]", (ctx) => {
  const chain = GOPLS_CHAIN.map((n) => ({ ...n }));
  const got = chooseChainBlock(chain, GOPLS_BOUND);
  assert.deepStrictEqual(got, GOPLS_WINNER, "the answer itself is contract-specified and is pinned above");
  const aliased = chain.some((n) => n === got);
  ctx.skip(
    `result identity is unspecified by the contract; measured alias=${aliased}, frozen=${Object.isFrozen(got)}. ` +
      `While it is an alias, a caller that edits the result edits the chain.`
  );
});
