// The FIM run-on fix: limitToEnclosingBlock bounds a completion by brace balance
// so it cannot spill past the enclosing block into a sibling item when the
// cursor sits on the block's OWN opening line (`fn f() {<caret>`) - the case
// limitScopeByIndentation cannot bound (indent 0 has nothing below it).
//
// Run: SKIP_LIVE=1 node --test test/impl-v3-fimscope.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-v3-fimscope",
  `export { limitToEnclosingBlock, postprocess } from "../src/core/postprocess";\n`
);
const { limitToEnclosingBlock, postprocess } = mod;
test.after(cleanup);

// --- limitToEnclosingBlock, pure ---------------------------------------------
test("cuts at the first `}` that closes a block the completion did not open", () => {
  const t = "let x = 1;\n}\n\nfn sibling() {\n    let y = 2;\n}";
  assert.strictEqual(limitToEnclosingBlock(t), "let x = 1;\n}");
});

test("a self-balanced body block is left whole (its own braces pop)", () => {
  const t = "if a {\n    b();\n}\nc();";
  assert.strictEqual(limitToEnclosingBlock(t), t);
});

test("no external closer -> unchanged (a bare expression ghost)", () => {
  const t = "bf.contains(b\"hello\")";
  assert.strictEqual(limitToEnclosingBlock(t), t);
});

test("an external `)` or `]` does NOT cut (valid method chain / index continuation)", () => {
  assert.strictEqual(limitToEnclosingBlock("a, b).bar().baz()"), "a, b).bar().baz()");
  assert.strictEqual(limitToEnclosingBlock("i].push(x)"), "i].push(x)");
});

test("a `}` inside a string literal is not counted", () => {
  const t = 'println!("}}");\nmore();';
  assert.strictEqual(limitToEnclosingBlock(t), t);
});

test("escaped quote inside a string does not end the string early", () => {
  const t = 'let s = "a \\" }";\nmore();';
  assert.strictEqual(limitToEnclosingBlock(t), t);
});

// --- through the full pipeline (the reported bug) ----------------------------
test("cursor on the `fn f() {` line: completion does NOT run into a sibling fn", () => {
  const raw = [
    "",
    "    let mut bf = fastbloom::BloomFilter::new(1000);",
    "    bf.contains(b\"hello\")",
    "}",
    "",
    "fn sibling() -> bool {",
    "    false",
    "}",
  ].join("\n");
  const out = postprocess(raw, {
    suffix: "\n}\n",
    currentLinePrefix: "fn bloom_membership() -> bool {",
    multiline: true,
  });
  assert.strictEqual((out.match(/\bfn \w+/g) || []).length, 0, "no sibling fn leaks into the ghost");
  assert.ok(out.includes("bf.contains"), "the intended body is kept");
});

test("indented cursor (depth 4) still bounds correctly, unchanged behavior", () => {
  const raw = ["", "    let x = 1;", "}", "", "fn sibling() {}"].join("\n");
  const out = postprocess(raw, { suffix: "\n}\n", currentLinePrefix: "    ", multiline: true });
  assert.strictEqual((out.match(/\bfn \w+/g) || []).length, 0);
});
