// Implementer oracle: instruct-postprocess edges invisible from the surface
// examples — CRLF replies, fence-variant pathology (four backticks, trailing
// junk on the close line, whitespace-padded fences), think-tag corner cases
// including the unclosed-tag ruling, and the idempotence boundary.
// Complements test/blind2-postprocess.test.cjs.
//
// Run: npm test

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl2-postprocess",
  `export { extractFirstCodeBlock, extractRequestedFunction, postprocessInstructOutput } from "../src/core/instructPostprocess";\n`
);
const { extractFirstCodeBlock, extractRequestedFunction, postprocessInstructOutput } = mod;
test.after(cleanup);

// ---- fence pathology

test("whitespace-padded fences: '   ```   ' opens and a '```  ' line closes (trimmed comparisons)", () => {
  assert.strictEqual(extractFirstCodeBlock("   ```rust\ncode\n```  "), "code");
});

test("CRLF reply: '```\\r' opens (trims to backticks), content keeps its \\r verbatim in extract", () => {
  assert.strictEqual(extractFirstCodeBlock("```\r\ncode\r\n```"), "code\r");
});

test("CRLF reply through the full postprocess: the trailing \\r is edge-trimmed", () => {
  assert.strictEqual(postprocessInstructOutput("```rust\r\nfn a() {}\r\n```"), "fn a() {}");
});

test("four-backtick line never closes a three-backtick block: close must trim to exactly ```", () => {
  assert.strictEqual(extractFirstCodeBlock("```\ncode\n````"), undefined);
});

test("four-backtick line still opens (starts with three backticks, 'language tag' is a backtick)", () => {
  assert.strictEqual(extractFirstCodeBlock("````\ncode\n```"), "code");
});

test("close line with trailing prose ('``` end') does not close; the block stays open", () => {
  assert.strictEqual(extractFirstCodeBlock("```\ncode\n``` end"), undefined);
});

test("opening fence on the last line with no content lines: unclosed, undefined", () => {
  assert.strictEqual(extractFirstCodeBlock("prose\n```rust"), undefined);
});

test("fence language tag with spaces ('```rust ignore') opens normally", () => {
  assert.strictEqual(extractFirstCodeBlock("```rust ignore\ncode\n```"), "code");
});

// ---- think-tag corners (incl. the unclosed-tag ruling)

test("RULING: unclosed <think> drops the whole reply — everything after the tag is thought", () => {
  assert.strictEqual(postprocessInstructOutput("<think>\nreasoning forever, no close\nfn a() {}"), "");
});

test("<think> not at the start (after content) does not trigger the seatbelt", () => {
  const raw = "fn a() {}\n<think>should stay</think>";
  assert.strictEqual(postprocessInstructOutput(raw), raw);
});

test("</think> without an opening tag is not stripped", () => {
  const raw = "fn a() {}\n</think>";
  assert.strictEqual(postprocessInstructOutput(raw), raw);
});

test("think block containing a fenced block: everything through the FIRST </think> is dropped, then extraction runs on the rest", () => {
  const raw = "<think>```\ndecoy()\n```</think>\n```rust\nreal()\n```";
  assert.strictEqual(postprocessInstructOutput(raw), "real()");
});

test("second <think> after the first close survives the seatbelt (only the leading tag is dropped)", () => {
  const raw = "<think>a</think>code()\n<think>trailing</think>";
  assert.strictEqual(postprocessInstructOutput(raw), "code()\n<think>trailing</think>");
});

// ---- empty-vs-undefined discrimination (rulings on the fence edge)

test("RULING: immediately closed fence flows through postprocess to '' — the reject path, not the bare-reply fallback", () => {
  // extractFirstCodeBlock returns "" (a complete, empty block); the
  // remainder fallback fires only on undefined. Prose around the empty
  // block must NOT leak through as the candidate.
  assert.strictEqual(postprocessInstructOutput("Sure!\n```\n```\nEnjoy!"), "");
});

test("whitespace-only fenced content also lands on the reject path, not the prose fallback", () => {
  assert.strictEqual(postprocessInstructOutput("prose\n```\n   \n\t\n```\nmore prose"), "");
});

// ---- idempotence boundary

test("idempotence holds on fence-shaped outputs: an output starting with an unclosed fence line is a fixed point", () => {
  const once = postprocessInstructOutput("```rust\nfn a() {}");
  assert.strictEqual(once, "```rust\nfn a() {}");
  assert.strictEqual(postprocessInstructOutput(once), once);
});

test("KNOWN LIMIT: a fenced block whose content itself begins with <think> re-triggers the seatbelt on a second pass", () => {
  // The documented step order makes universal idempotence unattainable for
  // this one adversarial shape; recorded here so the limit is a tested
  // fact, not a surprise. Model replies never take this shape: the think
  // tag is a preamble emitted before any fence.
  const raw = "```\n<think>x</think>tail()\n```";
  const once = postprocessInstructOutput(raw);
  assert.strictEqual(once, "<think>x</think>tail()");
  assert.strictEqual(postprocessInstructOutput(once), "tail()");
});

// ---- P2-F18: tilde fences are fences too

test("P2-F18 probe: tilde-fenced reply extracts the block, prose never attaches", () => {
  assert.strictEqual(extractFirstCodeBlock("Here:\n~~~rust\nfn a() {}\n~~~\nEnjoy!"), "fn a() {}");
});

test("P2-F18: tilde fence closes only on a tilde line, backtick fence only on a backtick line (no cross-closing)", () => {
  assert.strictEqual(extractFirstCodeBlock("~~~\ncode\n```"), undefined, "backticks cannot close a tilde fence");
  assert.strictEqual(extractFirstCodeBlock("```\ncode\n~~~"), undefined, "tildes cannot close a backtick fence");
  assert.strictEqual(extractFirstCodeBlock("~~~\ncode\n~~~"), "code");
});

test("P2-F18: a backtick fence line inside a tilde block stays verbatim content", () => {
  assert.strictEqual(extractFirstCodeBlock("~~~markdown\n```js\nx\n```\n~~~"), "```js\nx\n```");
});

test("P2-F18: postprocess of a closed tilde block with prose reduces to the block content", () => {
  assert.strictEqual(postprocessInstructOutput("Sure:\n~~~rust\nfn a() {}\n~~~\nDone."), "fn a() {}");
});

// ---- extractRequestedFunction: the reply is held to the ONE requested
// function. Preamble and trailing items are cut, a reply without the
// function at all is a miss (undefined), a clean reply passes untouched.

const FN = "fn main() {\n    body();\n}";
const CASES = [
  {
    name: "clean reply: exactly the function, untouched, zero trims",
    text: FN,
    signature: "fn main()",
    expect: { text: FN, trimmedBefore: 0, trimmedAfter: 0 },
  },
  {
    name: "use line above the fn (the observed rust-scratch bug) is cut as preamble",
    text: `use std::io;\n\n${FN}`,
    signature: "fn main()",
    expect: { text: FN, trimmedBefore: 1, trimmedAfter: 0 },
  },
  {
    name: "several preamble items (use + re-typed doc comment) all cut, count is non-blank lines",
    text: `use std::io;\n/// Docs.\n\n${FN}`,
    signature: "fn main()",
    expect: { text: FN, trimmedBefore: 2, trimmedAfter: 0 },
  },
  {
    name: "trailing helper function after the closing brace is cut",
    text: `${FN}\n\nfn helper() {\n    x();\n}`,
    signature: "fn main()",
    expect: { text: FN, trimmedBefore: 0, trimmedAfter: 3 },
  },
  {
    name: "preamble and trailing junk cut in the same reply",
    text: `use std::io;\n${FN}\nfn helper() {}`,
    signature: "fn main()",
    expect: { text: FN, trimmedBefore: 1, trimmedAfter: 1 },
  },
  {
    name: "reply without the requested head is a miss, never material to splice",
    text: "fn something_else() {\n    body();\n}",
    signature: "fn main()",
    expect: undefined,
  },
  {
    name: "head prefix must include the paren: fn add() never matches fn add_numbers(",
    text: "fn add_numbers(a: u32, b: u32) -> u32 {\n    a + b\n}",
    signature: "fn add()",
    expect: undefined,
  },
  {
    name: "multi-line signature anchors on its first line's head",
    text: "use x;\npub fn wide(\n    a: u32,\n) -> u32 {\n    a\n}",
    signature: "pub fn wide(\n    a: u32,\n) -> u32",
    expect: { text: "pub fn wide(\n    a: u32,\n) -> u32 {\n    a\n}", trimmedBefore: 1, trimmedAfter: 0 },
  },
  {
    name: "single-line body ends on the head line; a trailing fn is cut, not absorbed",
    text: "fn one() -> u32 { 1 }\nfn trailing() {\n    x();\n}",
    signature: "fn one() -> u32",
    expect: { text: "fn one() -> u32 { 1 }", trimmedBefore: 0, trimmedAfter: 3 },
  },
  {
    name: "no column-0 closing line found: the tail is kept unjudged (degrade, never cut mid-function)",
    text: "def f():\n    return 1\n\nprint(f())",
    signature: "def f()",
    expect: { text: "def f():\n    return 1\n\nprint(f())", trimmedBefore: 0, trimmedAfter: 0 },
  },
  {
    name: "the head match anchors on line start: a comment mentioning the fn is not the head",
    text: `// fn main() is below\n${FN}`,
    signature: "fn main()",
    expect: { text: FN, trimmedBefore: 1, trimmedAfter: 0 },
  },
];

test("extractRequestedFunction holds the reply to the one requested function (table)", () => {
  for (const c of CASES) {
    assert.deepStrictEqual(extractRequestedFunction(c.text, c.signature), c.expect, c.name);
  }
});
