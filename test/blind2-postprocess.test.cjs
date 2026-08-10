// Blind oracle: instruct postprocess contract (phase2-surface.md
// "src/core/instructPostprocess.ts"). Fence extraction, the think-tag
// seatbelt, edge normalization, and the promised idempotence. Written against
// the surface doc only; never read src/**. Expected red while stubs throw.
//
// Run: npm test

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "blind2-postprocess",
  `export { extractFirstCodeBlock, postprocessInstructOutput } from "../src/core/instructPostprocess";\n`
);
const { extractFirstCodeBlock, postprocessInstructOutput } = mod;
test.after(cleanup);

// ---- extractFirstCodeBlock [surface: instructPostprocess 'extractFirstCodeBlock']

const extractCases = [
  {
    name: "fenced block with language tag",
    reply: "```rust\nfn a() {}\n```",
    expected: "fn a() {}",
  },
  {
    name: "prose before and after the block",
    reply: "Here you go:\n```\nline1\n\nline3\n```\nHope that helps!",
    expected: "line1\n\nline3",
  },
  {
    name: "indented fences (trimmed content starts with / is exactly the backticks)",
    reply: "  ```py\n  x = 1\n  ```",
    expected: "  x = 1",
  },
  {
    name: "interior line starting with backticks-plus-tag does not close the block",
    reply: "```\nouter\n```rust\n```",
    expected: "outer\n```rust",
  },
  {
    name: "two blocks: first wins",
    reply: "```\nfirst\n```\nbetween\n```\nsecond\n```",
    expected: "first",
  },
  {
    name: "immediately closed block is empty content, not undefined",
    reply: "```\n```",
    expected: "",
  },
  {
    name: "interior indentation and blank lines verbatim, no trailing newline added",
    reply: "```rust\nfn a() {\n    if x {\n\n        y();\n    }\n}\n```",
    expected: "fn a() {\n    if x {\n\n        y();\n    }\n}",
  },
  {
    name: "no fence at all",
    reply: "fn a() {}",
    expected: undefined,
  },
  {
    name: "backticks mid-line are not a fence",
    reply: "text with ``` inline\nno block here",
    expected: undefined,
  },
  {
    name: "opening fence never closes",
    reply: "```rust\nfn a() {}",
    expected: undefined,
  },
];

for (const { name, reply, expected } of extractCases) {
  test(`extractFirstCodeBlock: ${name}`, () => {
    assert.strictEqual(extractFirstCodeBlock(reply), expected);
  });
}

// ---- postprocessInstructOutput [surface: instructPostprocess 'postprocessInstructOutput, in order']

const postprocessCases = [
  {
    name: "fenced reply with surrounding prose reduces to the block content",
    raw: "Sure, here is the function:\n```rust\nfn a() {}\n```\nLet me know!",
    expected: "fn a() {}",
  },
  {
    name: "bare-code reply passes through (no fence, whole remainder is the candidate)",
    raw: "fn a() {}\n",
    expected: "fn a() {}",
  },
  {
    name: "leading whitespace-only lines removed whole; first content line keeps its indentation",
    raw: "\n   \n    fn a() {}\n  ",
    expected: "    fn a() {}",
  },
  {
    name: "think tag dropped through the first close, then fence extraction",
    raw: "<think>\nsome reasoning\n</think>\n```rust\nfn a() {}\n```",
    expected: "fn a() {}",
  },
  {
    name: "think tag after leading whitespace still triggers the seatbelt",
    raw: "  \n<think>hm</think>\nfn b() {}",
    expected: "fn b() {}",
  },
  {
    name: "fenced content with leading blank lines is edge-normalized",
    raw: "```\n\n\n  code()\n```",
    expected: "  code()",
  },
  {
    name: "trailing whitespace at the end of the string removed",
    raw: "```\ncode()  \n```",
    expected: "code()",
  },
  {
    name: "unclosed fence: no complete block, so the whole remainder is the candidate",
    raw: "```rust\nfn a() {}",
    expected: "```rust\nfn a() {}",
  },
  {
    name: "whitespace-only reply yields the empty string (failed generation)",
    raw: " \n\t\n  ",
    expected: "",
  },
  {
    name: "empty reply yields the empty string",
    raw: "",
    expected: "",
  },
];

for (const { name, raw, expected } of postprocessCases) {
  test(`postprocessInstructOutput: ${name}`, () => {
    assert.strictEqual(postprocessInstructOutput(raw), expected);
  });

  test(`postprocessInstructOutput idempotent on: ${name} [surface: 'Pure and idempotent: f(f(x)) === f(x)']`, () => {
    const once = postprocessInstructOutput(raw);
    assert.strictEqual(postprocessInstructOutput(once), once);
  });
}
