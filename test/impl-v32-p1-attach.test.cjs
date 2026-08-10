// White-box tests for the doc-comment attachment pass (session-v32 phase 1,
// goal item 1). Written by the implementer against the mechanism, not the
// contract: the miss budget, the closer guard, the blank-line break, and the
// nearest-below tie-break are all internal choices, and each one is here
// because getting it wrong produces a WRONG target rather than an error.
//
// The blind oracle's file is test/blind-v32-p1-attach.test.cjs and it covers
// the contract surface. This one covers the seams under it.
//
// Run: SKIP_LIVE=1 node --test test/impl-v32-p1-attach.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-v32-p1-attach",
  `export { attachRunStart, attachedCandidateIndex, declarationHeadLine } from "../src/core/symbols";`,
);
test.after(cleanup);

const { attachRunStart, attachedCandidateIndex, declarationHeadLine } = mod;

// A source string becomes the line accessor resolveFunctionAtCursor supplies.
function lines(source) {
  const rows = source.split("\n");
  return (line) => {
    assert.ok(line >= 0, `getLine must never be called with a negative line, got ${line}`);
    return rows[line] ?? "";
  };
}

test("declarationHeadLine's shrink-forward is why the auditor cannot be declarationHeadLine", () => {
  // The one that took an adversarial review to see. declarationHeadLine SHRINKS
  // FORWARD to nameLine whenever it breaks on a line opening with a closer,
  // because its own callers must never be handed a mid-construct head. Read as
  // a confirmation, that answer says "the closing brace of the function above is
  // trivia of the function below", and everything above the brace inherits the
  // lie.
  const src = [
    "/** doc A */", // 0
    "function a() {", // 1
    "  return 1;", // 2
    "}", // 3
    "/** doc B */", // 4
    "function b() {}", // 5
  ].join("\n");
  const getLine = lines(src);
  // The face-value answer, pinned so the reason stays visible in the test file.
  assert.strictEqual(declarationHeadLine(getLine, 3, 5, []), 5, "shrinks forward on `}`");
  // And the true one the auditor sees.
  assert.strictEqual(attachRunStart(getLine, 5, []), 4, "the run is the doc line only");
  assert.strictEqual(attachedCandidateIndex([{ nameLine: 1 }, { nameLine: 5 }], getLine, 3, []), -1);
});

test("a comment above a closer belongs to the block it is in, not the declaration below", () => {
  // The blocker shape: nothing between the object literal and the documented
  // function is blank, so contiguity alone would swallow the whole literal.
  const src = [
    "registerAll({", // 0
    "  widgets: true,", // 1
    "  // audits are opt-in for now", // 2
    "});", // 3
    "/** Fan out the stripe totals. */", // 4
    "export function stripeFanout(): number {", // 5
  ].join("\n");
  const getLine = lines(src);
  assert.strictEqual(attachRunStart(getLine, 5, []), 4);
  for (const cursor of [0, 1, 2, 3]) {
    assert.strictEqual(
      attachedCandidateIndex([{ nameLine: 5 }], getLine, cursor, []),
      -1,
      `line ${cursor} is inside the call, not the function's doc`,
    );
  }
  assert.strictEqual(attachedCandidateIndex([{ nameLine: 5 }], getLine, 4, []), 0, "the real doc still attaches");
});

test("a bare `[...]` line is trivia-SHAPED but still cannot reach across a closer", () => {
  // A C# collection initializer entry starts with `[`, which is the attribute
  // shape the grammar treats as trivia. Only the closer below it stops the run,
  // so this is the same defect reached through a CODE line rather than a comment.
  const src = [
    "var map = new Dictionary<string, int>", // 0
    "{", // 1
    '    ["lo"] = 1,', // 2
    "};", // 3
    "/// <summary>The total.</summary>", // 4
    "public int Total() => 0;", // 5
  ].join("\n");
  const getLine = lines(src);
  assert.strictEqual(attachRunStart(getLine, 5, []), 4);
  assert.strictEqual(attachedCandidateIndex([{ nameLine: 5 }], getLine, 2, []), -1);
});

test("a doc comment of any length attaches, from any line in it", () => {
  // Every INTERIOR line of a block comment fails its own audit, because the
  // grammar only enters block-comment state on an opening `/*`. Under the miss
  // budget this shape stopped attaching at 16 interior lines, silently, on the
  // flagship TypeScript case. Auditing from the TOP of the run consumes the
  // whole block in one walk, so length stops mattering.
  for (const interior of [1, 3, 15, 16, 17, 40, 200]) {
    const src = [
      "/**", // 0
      ...Array.from({ length: interior }, (_, i) => ` * line ${i}`), // 1..interior
      " */", // interior + 1
      "export function stripeFanout(): number {", // interior + 2
    ].join("\n");
    const getLine = lines(src);
    const nameLine = interior + 2;
    assert.strictEqual(attachRunStart(getLine, nameLine, []), 0, `${interior} interior lines`);
    for (const cursor of [0, 1, Math.floor(interior / 2), interior, interior + 1]) {
      assert.strictEqual(
        attachedCandidateIndex([{ nameLine }], getLine, cursor, []),
        0,
        `${interior} interior lines, cursor on line ${cursor}`,
      );
    }
  }
});

test("a multi-line decorator resolves through misses to the line that opens it", () => {
  const src = [
    "/**", // 0
    " * The widget list.", // 1
    " */", // 2
    "@Component({", // 3
    '  selector: "app-widgets",', // 4
    "})", // 5
    "export class Widgets {}", // 6
  ].join("\n");
  const getLine = lines(src);
  // Line 5 (`})`) is a closer and line 4 is a bare property: both miss. Line 3
  // opens the construct and confirms, which is the whole reason misses exist.
  assert.strictEqual(attachRunStart(getLine, 6, []), 0);
  for (const cursor of [0, 1, 2, 3, 4, 5]) {
    assert.strictEqual(
      attachedCandidateIndex([{ nameLine: 6 }], getLine, cursor, []),
      0,
      `cursor on line ${cursor} attaches`,
    );
  }
});

test("a multi-line construct of any width resolves in one walk from the run's top", () => {
  const src = [
    "// the doc", // 0
    "@Component({", // 1
    "  a: 1,", // 2
    "  b: 2,", // 3
    "  c: 3,", // 4
    "})", // 5
    "export class Widgets {}", // 6
  ].join("\n");
  const getLine = lines(src);
  // The grammar consumes the whole decorator by bracket balance, so the run's
  // top confirms on the first candidate tried. Interior lines are never
  // candidates in their own right, which is why width costs nothing.
  assert.strictEqual(attachRunStart(getLine, 6, []), 0);
  for (const cursor of [0, 1, 2, 3, 4, 5]) {
    assert.strictEqual(attachedCandidateIndex([{ nameLine: 6 }], getLine, cursor, []), 0, `line ${cursor}`);
  }
});

test("a code line between a comment and the head kills the attach", () => {
  const src = [
    "// the doc", // 0
    "const noise = 1;", // 1
    "function f() {}", // 2
  ].join("\n");
  const getLine = lines(src);
  // The walk from line 0 stops at the code on line 1, so line 0 is never the run
  // start. The scan then jumps to line 2, which is nameLine, so there is no run.
  assert.strictEqual(attachRunStart(getLine, 2, []), 2);
  assert.strictEqual(attachedCandidateIndex([{ nameLine: 2 }], getLine, 0, []), -1);
});

test("a comment above a multi-line attribute is the run start, not the attribute", () => {
  const src = [
    "// top of the run", // 0
    "[Route(", // 1
    '  "api/things",', // 2
    '  Name = "things")]', // 3
    "public int Count() => 0;", // 4
  ].join("\n");
  const getLine = lines(src);
  assert.strictEqual(attachRunStart(getLine, 4, []), 0);
  for (const cursor of [0, 1, 2, 3]) {
    assert.strictEqual(attachedCandidateIndex([{ nameLine: 4 }], getLine, cursor, []), 0, `line ${cursor}`);
  }
});

test("a lone Allman brace above a documented member is not part of the run", () => {
  const src = [
    "", // 0
    "public class Fns", // 1
    "{", // 2
    "    /// <summary>Add.</summary>", // 3
    "    public int Add() => 0;", // 4
  ].join("\n");
  const getLine = lines(src);
  assert.strictEqual(attachRunStart(getLine, 4, []), 3);
  assert.strictEqual(attachedCandidateIndex([{ nameLine: 4 }], getLine, 2, []), -1, "on the brace");
  assert.strictEqual(attachedCandidateIndex([{ nameLine: 4 }], getLine, 3, []), 0, "on the doc");
});

test("a blank line at or below the cursor stops the candidate sweep dead", () => {
  // Cost, not correctness: the answer was already -1. Sixty declarations below a
  // blank line used to cost sixty audits, when one line read settles it.
  const rows = ["// orphan", ""];
  const candidates = [];
  for (let i = 0; i < 60; i++) {
    rows.push(`/** doc ${i} */`, `function f${i}() {}`);
    candidates.push({ nameLine: rows.length - 1 });
  }
  let reads = 0;
  const getLine = (line) => {
    reads++;
    assert.ok(line >= 0, "never a negative line");
    return rows[line] ?? "";
  };
  assert.strictEqual(attachedCandidateIndex(candidates, getLine, 0, []), -1);
  assert.ok(reads <= 4, `settled in ${reads} line reads`);
});

test("a blank line ends the run, whichever side of it the cursor is on", () => {
  const src = [
    "// a section marker", // 0
    "", // 1
    "/// the real doc", // 2
    "fn f() {}", // 3
  ].join("\n");
  const getLine = lines(src);
  assert.strictEqual(attachRunStart(getLine, 3, []), 2);
  assert.strictEqual(attachedCandidateIndex([{ nameLine: 3 }], getLine, 2, []), 0, "inside the run");
  assert.strictEqual(attachedCandidateIndex([{ nameLine: 3 }], getLine, 1, []), -1, "on the blank");
  assert.strictEqual(attachedCandidateIndex([{ nameLine: 3 }], getLine, 0, []), -1, "above the blank");
});

test("lineComments is the Python arm, and the default keeps every other language identical", () => {
  const src = [
    "# harvest the widgets", // 0
    "@staticmethod", // 1
    "def harvest():", // 2
  ].join("\n");
  const getLine = lines(src);
  assert.strictEqual(attachRunStart(getLine, 2, ["#"]), 0, "Python walks the # comment");
  // Passing [] is what every non-Python caller does. The `#` line is not trivia
  // to that grammar, so the run stops at the decorator. Pinned so a caller that
  // forgets the Python arm fails a test instead of quietly under-attaching.
  assert.strictEqual(attachRunStart(getLine, 2, []), 1);
});

test("nearest declaration below the cursor wins, and order of candidates does not matter", () => {
  const src = [
    "/** The auditor. */", // 0
    "export class StripeAuditor {", // 1
    "  /** Audit one band. */", // 2
    "  auditBands() {}", // 3
    "}", // 4
  ].join("\n");
  const getLine = lines(src);
  const scrambled = [{ nameLine: 3 }, { nameLine: 1 }];
  // Cursor in the CLASS doc: the class head is nearer below than the method's.
  assert.strictEqual(attachedCandidateIndex(scrambled, getLine, 0, []), 1);
  // Cursor in the METHOD doc: the class head is above the cursor, so ineligible.
  assert.strictEqual(attachedCandidateIndex(scrambled, getLine, 2, []), 0);
  const frozen = Object.freeze([Object.freeze({ nameLine: 3 }), Object.freeze({ nameLine: 1 })]);
  assert.strictEqual(attachedCandidateIndex(frozen, getLine, 0, []), 1, "no mutation of the input");
});

test("candidates sharing a name line break the tie on tree order", () => {
  // Not a shape a real server produces, but the sort must be total or the
  // answer depends on Array.prototype.sort's stability guarantees.
  const getLine = lines(["/** doc */", "fn f() {}"].join("\n"));
  assert.strictEqual(attachedCandidateIndex([{ nameLine: 1 }, { nameLine: 1 }], getLine, 0, []), 0);
});

test("an undocumented declaration has no run, so nothing attaches to it", () => {
  const src = ["let x = 1;", "function f() {}"].join("\n");
  const getLine = lines(src);
  assert.strictEqual(attachRunStart(getLine, 1, []), 1, "runStart === nameLine means no run");
  assert.strictEqual(attachedCandidateIndex([{ nameLine: 1 }], getLine, 0, []), -1);
});

test("line 0 has nothing above it", () => {
  const getLine = lines("fn f() {}");
  assert.strictEqual(attachRunStart(getLine, 0, []), 0);
  assert.strictEqual(attachedCandidateIndex([{ nameLine: 0 }], getLine, 0, []), -1);
});
