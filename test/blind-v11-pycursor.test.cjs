// BLIND ORACLE — v11 (Python) Phase 4: pyUnresolvedNameCursor(diagnostic)
// (src/core/compilerDirected.ts), the sibling of tsUnresolvedNameCursor and
// csUnresolvedNameCursor. Written from phase4-brief.md WP5(b) + the neutral
// Diagnostic shape ONLY. The implementation is written AFTER this file.
//
// Contract (brief WP5b):
//   - keys on BOTH  diagnostic.code === "reportUndefinedVariable"
//                   AND message matching /"[^"]+" is not defined/
//   - returns { line: primary.lineStart - 1, character: primary.columnStart - 1 }
//     i.e. the primary span's 1-based (line, col) mapped back to 0-based.
//   - undefined for any other code / message / shape.
//
// GROUND TRUTH (captured this session by running real pyright --outputjson on a
// file with two undefined names — `def compute(x): return helper(x) + missing_value`):
//   { "rule": "reportUndefinedVariable",
//     "severity": "error",
//     "message": "\"helper\" is not defined",
//     "range": { "start": {"line":1,"character":11}, "end": {"line":1,"character":17} } }
//   { "rule": "reportUndefinedVariable",
//     "message": "\"missing_value\" is not defined",
//     "range": { "start": {"line":1,"character":23}, "end": {"line":1,"character":36} } }
//   pyright's `rule` is what pyOracle maps onto Diagnostic.code, and the LSP
//   range is 0-based; pyOracle stores the span 1-based (lineStart = range line
//   + 1, columnStart = range char + 1). So for "helper" the neutral Diagnostic
//   span is lineStart=2, columnStart=12, and pyUnresolvedNameCursor must return
//   the 0-based cursor { line: 1, character: 11 } — exactly pyright's own
//   range.start. The fixtures below are built from these captured values.
//
// HARD assertions — the code/message key and the 1-based->0-based transform are
// fully specified.
//
// Run: SKIP_LIVE=1 node --test test/blind-v11-pycursor.test.cjs
// Expected: RED until pyUnresolvedNameCursor lands.

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

let mod = {};
let cleanup = () => {};
let bundleErr;
try {
  ({ mod, cleanup } = bundleCore(
    "blind-v11-pycursor",
    `export { pyUnresolvedNameCursor, csUnresolvedNameCursor, unresolvedNameCursor } from "../src/core/compilerDirected";\n`,
  ));
} catch (e) {
  bundleErr = e;
}
test.after(() => cleanup());
const { pyUnresolvedNameCursor, csUnresolvedNameCursor, unresolvedNameCursor } = mod;

test("bundle guard: compilerDirected builds headless", () => {
  if (bundleErr) assert.fail(`bundle failed: ${bundleErr.message}`);
});

// The neutral Diagnostic shape (as the CS/TS cursor fixtures use): a `code`, a
// `message`, and a `spans` array whose primary span carries 1-based line/col.
// Built from the captured pyright ground truth above.
const HELPER_DIAG = {
  code: "reportUndefinedVariable",
  message: '"helper" is not defined',
  // pyright range.start {line:1,character:11} -> 1-based span lineStart=2, columnStart=12
  spans: [{ isPrimary: true, lineStart: 2, columnStart: 12, lineEnd: 2, columnEnd: 18 }],
};
const MISSING_VALUE_DIAG = {
  code: "reportUndefinedVariable",
  message: '"missing_value" is not defined',
  // pyright range.start {line:1,character:23} -> 1-based lineStart=2, columnStart=24
  spans: [{ isPrimary: true, lineStart: 2, columnStart: 24, lineEnd: 2, columnEnd: 37 }],
};

test("pyUnresolvedNameCursor: real pyright reportUndefinedVariable -> 0-based cursor at the offending name", () => {
  assert.deepStrictEqual(
    pyUnresolvedNameCursor(HELPER_DIAG),
    { line: 1, character: 11 },
    "'\"helper\" is not defined' at 1-based (2,12) -> 0-based cursor (1,11) — pyright's own range.start",
  );
  assert.deepStrictEqual(
    pyUnresolvedNameCursor(MISSING_VALUE_DIAG),
    { line: 1, character: 23 },
    "'\"missing_value\" is not defined' at 1-based (2,24) -> 0-based cursor (1,23)",
  );
});

test("pyUnresolvedNameCursor: the 1-based -> 0-based transform is exact (lineStart-1, columnStart-1)", () => {
  const diag = {
    code: "reportUndefinedVariable",
    message: '"Foo" is not defined',
    spans: [{ isPrimary: true, lineStart: 10, columnStart: 5 }],
  };
  assert.deepStrictEqual(
    pyUnresolvedNameCursor(diag),
    { line: 9, character: 4 },
    "1-based (10,5) -> 0-based (9,4)",
  );
});

// ---- Negative shapes: undefined for anything that is not this exact class. ----

const NEGATIVES = [
  [
    "wrong code (a different pyright rule), even with a matching-looking message",
    { code: "reportMissingImports", message: '"numpy" is not defined', spans: [{ isPrimary: true, lineStart: 1, columnStart: 1 }] },
  ],
  [
    "right code but a NON-matching message (not the 'X is not defined' family)",
    { code: "reportUndefinedVariable", message: "Expression value is unused", spans: [{ isPrimary: true, lineStart: 1, columnStart: 1 }] },
  ],
  [
    "an attribute-access issue (reportAttributeAccessIssue) is a different class",
    { code: "reportAttributeAccessIssue", message: 'Cannot access attribute "bar" for class "Foo"', spans: [{ isPrimary: true, lineStart: 1, columnStart: 1 }] },
  ],
  [
    "no code at all",
    { message: '"x" is not defined', spans: [{ isPrimary: true, lineStart: 1, columnStart: 1 }] },
  ],
  [
    "no spans",
    { code: "reportUndefinedVariable", message: '"x" is not defined' },
  ],
  [
    "empty spans",
    { code: "reportUndefinedVariable", message: '"x" is not defined', spans: [] },
  ],
];

test("pyUnresolvedNameCursor: undefined for every non-matching code / message / shape", () => {
  for (const [name, diag] of NEGATIVES) {
    assert.strictEqual(
      pyUnresolvedNameCursor(diag),
      undefined,
      `[${name}] must return undefined; got ${JSON.stringify(pyUnresolvedNameCursor(diag))}`,
    );
  }
});

// Frozen guard: the Rust cursor heuristic must NOT match a pyright
// reportUndefinedVariable (proving Python needed its own variant, and that a
// python arm did not disturb the Rust one).
test("frozen guard: the Rust unresolvedNameCursor does NOT match a pyright reportUndefinedVariable", () => {
  assert.strictEqual(
    unresolvedNameCursor(HELPER_DIAG),
    undefined,
    "the rustc 'cannot find ... in this scope' heuristic must not fire on pyright's '\"X\" is not defined' — python needs its own cursor",
  );
});
