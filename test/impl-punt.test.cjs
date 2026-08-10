// Implementer oracle for punt mitigation: small models return a stub that
// COMPILES (todo!/unimplemented!/"not implemented"/placeholder), so the oracle
// never catches it. looksLikePunt flags it; assembleAntiPuntReprompt drives the
// circle-back; the noPunt flag nudges the first prompt while leaving the v1
// bytes intact when off. Pure, headless.
//
// Run: SKIP_LIVE=1 node --test test/impl-punt.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-punt",
  `export { looksLikePunt, assembleAntiPuntReprompt, NO_PUNT_INSTRUCTION } from "../src/core/punt";
export { assembleFnGenPrompt } from "../src/core/prompt";\n`
);
const { looksLikePunt, assembleAntiPuntReprompt, NO_PUNT_INSTRUCTION, assembleFnGenPrompt } = mod;
test.after(cleanup);

// The human's actual punt, plus the canonical stub forms.
const PUNTS = [
  'fn f() -> bool {\n    todo!()\n}',
  'fn f() {\n    unimplemented!("later")\n}',
  'async fn upload() -> Result<(), E> {\n    // Since we can\'t actually implement the S3 upload without external\n    // dependencies, return a placeholder implementation\n    Err("S3 upload not implemented".into())\n}',
  'fn f() {\n    // In a real implementation you would call the API here\n}',
];
for (const [i, code] of PUNTS.entries()) {
  test(`looksLikePunt flags stub #${i}`, () => assert.strictEqual(looksLikePunt(code), true, code.slice(0, 40)));
}

const REAL = [
  'fn bloom_demo() -> bool {\n    let mut f = BloomFilter::with_num_bits(1024).expected_items(1000);\n    f.insert(&"hello");\n    f.contains(&"hello")\n}',
  'fn add(a: i32, b: i32) -> i32 {\n    a + b\n}',
  'fn parse(s: &str) -> Result<u32, ()> {\n    s.parse().map_err(|_| ())\n}',
];
for (const [i, code] of REAL.entries()) {
  test(`looksLikePunt does NOT flag real implementation #${i}`, () => assert.strictEqual(looksLikePunt(code), false, code.slice(0, 40)));
}

test("assembleAntiPuntReprompt shows the stub, the firm instruction, and the signature to implement", () => {
  const out = assembleAntiPuntReprompt({
    signature: "async fn upload() -> Result<(), E>",
    docComment: "/// Upload hello to S3.",
    punted: 'Err("not implemented".into())',
    languageId: "rust",
  });
  assert.match(out, /previous attempt was a stub/i);
  assert.ok(out.includes(NO_PUNT_INSTRUCTION), "carries the firm no-stub directive");
  assert.match(out, /Err\("not implemented"/, "shows the model its own stub");
  assert.match(out, /async fn upload\(\) -> Result<\(\), E>/, "asks for the same signature");
});

const BASE = { signature: "fn f() -> bool", docComment: "/// Do it.", languageId: "rust" };

test("assembleFnGenPrompt with noPunt appends the no-stub directive to the instruction", () => {
  const out = assembleFnGenPrompt({ ...BASE, noPunt: true });
  assert.ok(out.includes(NO_PUNT_INSTRUCTION), "the directive is present");
  assert.match(out, /Implement the function below\. Reply with one fenced code block.*Implement the described behaviour fully/s, "appended to the base instruction, one line");
});

test("assembleFnGenPrompt without noPunt is byte-identical to omitting the field (v1 preserved)", () => {
  const omitted = assembleFnGenPrompt({ ...BASE });
  assert.strictEqual(assembleFnGenPrompt({ ...BASE, noPunt: false }), omitted);
  assert.strictEqual(assembleFnGenPrompt({ ...BASE, noPunt: undefined }), omitted);
  assert.ok(!omitted.includes(NO_PUNT_INSTRUCTION), "no directive when off");
});
