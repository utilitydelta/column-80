// Blind oracle: classifyHallucination against the ground-truth rustc
// diagnostic strings captured by the slice-2 de-risk probe [slice2-surface.md
// "What the de-risk probe proved" + "classifyHallucination"]. Pure over one
// Diagnostic (the compilerOracle shape): the exact E0599/E0432/E0433 messages
// map to their class with the offending member/type/crate/item and the cursor
// derived from the primary span; a borrow/type error and a span-less
// diagnostic map to undefined. Never read src/**; expected red on the stub.
//
// Run: SKIP_LIVE=1 node --test test/blind7-classify.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "blind7-classify",
  `export { classifyHallucination } from "../src/core/compilerDirected";\n`
);
const { classifyHallucination } = mod;
test.after(cleanup);

// A primary span at line 17, column 17 (1-based, rustc's own coordinates). The
// contract derives the cursor as { line: lineStart - 1, character: columnStart
// - 1 }, so this span pins the cursor at { line: 16, character: 16 }.
const primarySpan = (over = {}) => ({
  fileName: "src/main.rs",
  byteStart: 0,
  byteEnd: 0,
  lineStart: 17,
  lineEnd: 17,
  columnStart: 17,
  columnEnd: 20,
  isPrimary: true,
  ...over,
});
const CURSOR = { line: 16, character: 16 };

// One Diagnostic in the compilerOracle shape. Defaults carry a single primary
// span so a case that omits `spans` still has a cursor to derive.
const diag = (over = {}) => ({
  kind: "compile-error",
  level: "error",
  code: undefined,
  message: "",
  spans: [primarySpan()],
  suggestions: [],
  ...over,
});

// Ground-truth strings are exactly as rustc printed them in the probe capture
// (surface "What the de-risk probe proved"): backticks and generics included.
const cases = [
  {
    name: "E0599 method -> unresolved-method with member, generic-carrying type, and primary-span cursor",
    diagnostic: diag({
      code: "E0599",
      message: "no method named `add` found for struct `BloomFilter<S>` in the current scope",
    }),
    expected: { kind: "unresolved-method", member: "add", type: "BloomFilter<S>", cursor: CURSOR },
  },
  {
    name: "E0599 associated function -> unresolved-assoc with the invented constructor name and its type",
    diagnostic: diag({
      code: "E0599",
      message: "no associated function or constant named `new` found for struct `BloomFilter<S>`",
    }),
    expected: { kind: "unresolved-assoc", member: "new", type: "BloomFilter<S>", cursor: CURSOR },
  },
  {
    name: "E0432 -> wrong-item: first path segment is the crate, last is the invented item",
    diagnostic: diag({ code: "E0432", message: "unresolved import `fastbloom::Bloom`" }),
    expected: { kind: "wrong-item", crate: "fastbloom", item: "Bloom", cursor: CURSOR },
  },
  {
    name: "E0432 deeper path -> wrong-item keeps first segment as crate and last as item",
    diagnostic: diag({ code: "E0432", message: "unresolved import `fastbloom::sub::Bloom`" }),
    expected: { kind: "wrong-item", crate: "fastbloom", item: "Bloom", cursor: CURSOR },
  },
  {
    name: "E0433 module-or-crate form -> unresolved-crate (the ground-truth aws_sdk_s3 capture)",
    diagnostic: diag({ code: "E0433", message: "cannot find module or crate `aws_sdk_s3` in this scope" }),
    expected: { kind: "unresolved-crate", crate: "aws_sdk_s3", cursor: CURSOR },
  },
  {
    name: "E0433 bare-crate form -> unresolved-crate (the contract's message alternation)",
    diagnostic: diag({ code: "E0433", message: "cannot find crate `aws_sdk_s3` in this scope" }),
    expected: { kind: "unresolved-crate", crate: "aws_sdk_s3", cursor: CURSOR },
  },
  {
    name: "E0596 borrow error -> undefined (not a hallucination; rides plain repair)",
    diagnostic: diag({
      code: "E0596",
      message: "cannot borrow `result` as mutable, as it is not declared as mutable",
    }),
    expected: undefined,
  },
  {
    name: "E0308 type mismatch -> undefined (not a hallucination; rides plain repair)",
    diagnostic: diag({ code: "E0308", message: "mismatched types" }),
    expected: undefined,
  },
  {
    name: "E0599 message but no primary span (spans empty) -> undefined: nowhere to resolve a surface",
    diagnostic: diag({
      code: "E0599",
      message: "no method named `add` found for struct `BloomFilter<S>` in the current scope",
      spans: [],
    }),
    expected: undefined,
  },
  {
    name: "E0599 message but only a non-primary span -> undefined: the cursor needs the primary span",
    diagnostic: diag({
      code: "E0599",
      message: "no method named `add` found for struct `BloomFilter<S>` in the current scope",
      spans: [primarySpan({ isPrimary: false })],
    }),
    expected: undefined,
  },
];

for (const { name, diagnostic, expected } of cases) {
  test(name, () => {
    assert.deepStrictEqual(classifyHallucination(diagnostic), expected);
  });
}
