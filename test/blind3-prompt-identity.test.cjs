// Blind oracle: prompt identity preservation (phase3-surface.md "Prompt
// identity, preserved"). Two halves: fn-gen prompts see exactly the
// {uri, range, text} projection with no store metadata smuggled, and FIM
// prompt construction takes no context blocks at all — CompletionService
// params are identical whatever a ContextBlockStore holds. Written against
// the surface doc only; never read src/**. Expected red while stubs throw
// (the assembleFnGenPrompt and CompletionService tests may already pass:
// they pin frozen phase-1/2 behavior).
//
// Run: npm test

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "blind3-prompt-identity",
  `export { ContextBlockStore } from "../src/core/contextBlocks";
export { FnGenService } from "../src/core/fnGenService";
export { assembleFnGenPrompt } from "../src/core/prompt";
export { CompletionService } from "../src/core/completionService";\n`
);
const { ContextBlockStore, FnGenService, assembleFnGenPrompt, CompletionService } = mod;
test.after(cleanup);

// Sentinel values chosen so a metadata leak is greppable in the prompt.
const VERSION_SENTINEL = 987654;
const ADD_A = { uri: "file:///w/alpha.rs", range: { startLine: 3, endLine: 9 }, text: "SENTINEL_ALPHA: struct Acc;", version: VERSION_SENTINEL };
const ADD_B = { uri: "file:///w/beta.rs", range: { startLine: 1, endLine: 4 }, text: "SENTINEL_BETA: fn clamp();", version: VERSION_SENTINEL };

const FNGEN_CFG = {
  apiBase: "http://127.0.0.1:1", // never reached: generate is injected
  model: "fake-30b",
  fallbackModel: "fake-14b",
  maxTokens: 128,
  temperature: 0.2,
};
const REQ = { signature: "fn add(a: i32, b: i32) -> i32", docComment: "/// Adds.", languageId: "rust" };
const RAW = "```rust\nfn add(a: i32, b: i32) -> i32 {\n    a + b\n}\n```";

async function captureFnGenPrompt(contextBlocks) {
  let captured;
  const svc = new FnGenService(FNGEN_CFG, async (p) => {
    captured = p.prompt;
    return { text: RAW, ttftMs: 1, totalMs: 2 };
  });
  await svc.generate({ ...REQ, contextBlocks });
  svc.dispose();
  return captured;
}

// ---- projection purity [surface: 'id and addedAtVersion are never in the projection:
// the prompt sees exactly what the phase-2 contract defines for blocks, nothing smuggled']

test("toPromptBlocks carries only {uri, range, text}; range only {startLine, endLine}", () => {
  const store = new ContextBlockStore();
  store.add(ADD_A);
  store.add(ADD_B);
  for (const block of store.toPromptBlocks()) {
    assert.deepStrictEqual(Object.keys(block).sort(), ["range", "text", "uri"]);
    assert.deepStrictEqual(Object.keys(block.range).sort(), ["endLine", "startLine"]);
  }
});

test("store-fed prompt equals a prompt from hand-built plain blocks: no metadata path difference", async () => {
  const store = new ContextBlockStore();
  store.add(ADD_A);
  store.add(ADD_B);
  const viaStore = await captureFnGenPrompt(store.toPromptBlocks());
  const viaPlain = await captureFnGenPrompt([
    { uri: ADD_A.uri, range: { ...ADD_A.range }, text: ADD_A.text },
    { uri: ADD_B.uri, range: { ...ADD_B.range }, text: ADD_B.text },
  ]);
  assert.strictEqual(viaStore, viaPlain);
});

test("no store metadata leaks into the assembled prompt: ids, versions, staleness vocabulary absent", async () => {
  const store = new ContextBlockStore();
  const e1 = store.add(ADD_A);
  const e2 = store.add(ADD_B);
  const prompt = await captureFnGenPrompt(store.toPromptBlocks());
  assert.ok(!prompt.includes(String(VERSION_SENTINEL)), "addedAtVersion value leaked");
  assert.ok(!prompt.includes(`id=${e1.id}`) && !prompt.includes(`id=${e2.id}`), "entry id leaked");
  assert.ok(!/addedAtVersion|stale/i.test(prompt), "staleness metadata leaked");
});

// ---- assembleFnGenPrompt untouched [surface: 'assembleFnGenPrompt is untouched by phase 3:
// same signature, same rendering, same bytes for a given input']

test("assembleFnGenPrompt renders the exact phase-2 bytes for a representative input", () => {
  const FENCE = "```";
  const INSTR =
    "Implement the function below. Reply with one fenced code block containing the complete function definition, signature and body. The block must contain only this one function: no imports, no other functions, no code before or after it. Output nothing outside the code block.";
  const expected =
    `Context: file:///w/alpha.rs#L3-L9\n${FENCE}\nSENTINEL_ALPHA: struct Acc;\n${FENCE}` +
    `\n\n${INSTR}\n\n${FENCE}rust\n/// Adds.\nfn add(a: i32, b: i32) -> i32\n${FENCE}`;
  const prompt = assembleFnGenPrompt({
    signature: REQ.signature,
    docComment: REQ.docComment,
    languageId: REQ.languageId,
    contextBlocks: [{ uri: ADD_A.uri, range: { ...ADD_A.range }, text: ADD_A.text }],
  });
  assert.strictEqual(prompt, expected);
});

// ---- FIM prompt identity unchanged [surface: 'FIM does not consume context blocks. Nothing in
// phase 3 touches CompletionService ... it stays character-identical to the phase-1 contract.']

const FIM_CFG = {
  apiBase: "http://127.0.0.1:1",
  model: "fake-fim",
  maxTokens: 64,
  temperature: 0.01,
  debounceMs: 0,
  prefixChars: 200,
  suffixChars: 100,
  multiline: true,
  cacheCapacity: 10,
};
const FIM_REQ = { prefix: "const a = 1;\nlet b = ", suffix: ";\n// end\n", manual: true };

async function captureFimParams() {
  let captured;
  const svc = new CompletionService(FIM_CFG, async (p) => {
    captured = p;
    return { text: "hello()", ttftMs: 1, totalMs: 2 };
  });
  await svc.complete(FIM_REQ);
  svc.dispose();
  return captured;
}

// `stopWhen` joined `signal` here in v25, and for the same reason: both are
// per-request machinery rather than prompt content, and both are fresh objects
// on every call, so deepStrictEqual compares them by reference and reports two
// identical requests as different. The claim this test makes is that no context
// block reaches a FIM request, and that claim is untouched: the sibling test
// still greps every param NAME for context/block shapes, and prefix and suffix
// are still asserted verbatim below.
const sanitize = (params) => {
  const { signal, stopWhen, ...rest } = params;
  return rest;
};

test("FIM request params are identical whether a context store is empty, populated, or absent", async () => {
  const bare = await captureFimParams();

  const store = new ContextBlockStore();
  store.add(ADD_A);
  store.add(ADD_B);
  const withStore = await captureFimParams(); // no channel exists to hand the store in: that IS the contract
  assert.deepStrictEqual(sanitize(withStore), sanitize(bare), "phase-1 param shape, byte-for-byte, regardless of store contents");
  assert.strictEqual(withStore.prefix, FIM_REQ.prefix);
  assert.strictEqual(withStore.suffix, FIM_REQ.suffix);
});

test("FIM prompt construction takes no context blocks: no block/context-shaped param, no block text in prefix or suffix", async () => {
  const store = new ContextBlockStore();
  store.add(ADD_A);
  const params = await captureFimParams();
  for (const key of Object.keys(params)) {
    assert.ok(!/context|block/i.test(key), `FIM generate param ${JSON.stringify(key)} smells like context blocks`);
  }
  const flat = JSON.stringify(sanitize(params));
  assert.ok(!flat.includes(ADD_A.text), "block text leaked into the FIM request");
  assert.ok(!flat.includes(ADD_A.uri), "block uri leaked into the FIM request");
});
