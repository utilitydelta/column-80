// Blind oracle: falsification bar 3 (phase3-surface.md "Falsification bar 3,
// as a testable contract"; goal.md: "A context block the user removed still
// reaches a prompt -> feature 3 broken ... zero tolerance"). Drives the
// remove/clear/move -> generate sequences end to end headless: ContextBlockStore
// feeds FnGenService via toPromptBlocks() read at generation time, the injected
// generateFn captures the prompt. The wiring half (the command path evaluating
// toPromptBlocks in the same tick as service.generate) is not headless-testable
// per the surface; it is asserted structurally in review, not here.
// Written against the surface doc only; never read src/**. Expected red while
// stubs throw.
//
// Run: npm test

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "blind3-bar",
  `export { ContextBlockStore } from "../src/core/contextBlocks";
export { FnGenService } from "../src/core/fnGenService";
export { assembleFnGenPrompt } from "../src/core/prompt";\n`
);
const { ContextBlockStore, FnGenService, assembleFnGenPrompt } = mod;
test.after(cleanup);

const CFG = {
  apiBase: "http://127.0.0.1:1", // never reached: generate is injected
  model: "fake-30b",
  fallbackModel: "fake-14b",
  maxTokens: 128,
  temperature: 0.2,
};
const REQ = {
  signature: "fn add(a: i32, b: i32) -> i32",
  docComment: "/// Adds two numbers.",
  languageId: "rust",
};
const RAW = "```rust\nfn add(a: i32, b: i32) -> i32 {\n    a + b\n}\n```";

// Distinct sentinel texts so containment assertions cannot false-pass.
const ADD_A = { uri: "file:///w/alpha.rs", range: { startLine: 3, endLine: 9 }, text: "SENTINEL_ALPHA: struct Acc { total: i64 }", version: 7 };
const ADD_B = { uri: "file:///w/beta.rs", range: { startLine: 1, endLine: 4 }, text: "SENTINEL_BETA: fn clamp(v: i64) -> i64", version: 2 };
const ADD_C = { uri: "file:///w/gamma.rs", range: { startLine: 10, endLine: 12 }, text: "SENTINEL_GAMMA: const LIMIT: u32 = 100;", version: 5 };

const headerOf = (a) => `Context: ${a.uri}#L${a.range.startLine}-L${a.range.endLine}`;

function storeWith(adds) {
  const store = new ContextBlockStore();
  const entries = adds.map((a) => store.add(a));
  return { store, entries };
}

// Captures the prompt the service hands the model [surface: oracle sequence
// 'FnGenService with an injected generateFn that captures params.prompt'].
async function capturePrompt(contextBlocks) {
  let captured;
  const svc = new FnGenService(CFG, async (p) => {
    captured = p.prompt;
    return { text: RAW, ttftMs: 1, totalMs: 2 };
  });
  await svc.generate(contextBlocks === undefined ? { ...REQ } : { ...REQ, contextBlocks });
  svc.dispose();
  return captured;
}

// ---- THE BAR, flagship sequence [surface: 'The oracle sequence, runnable headless end to end']

test("THE BAR: add A, add B, remove A, generate — all three required assertions [surface: 'Assertions, all required'; goal falsification bar 3]", async () => {
  const { store, entries } = storeWith([ADD_A, ADD_B]);
  const a = entries[0];
  assert.strictEqual(store.remove(a.id), true);

  // 1. store state: no A, projection deep-equals a store that only ever held B.
  assert.ok(!store.list().some((e) => e.id === a.id), "list() has no entry with A.id");
  const ref = storeWith([ADD_B]).store;
  assert.deepStrictEqual(store.toPromptBlocks(), ref.toPromptBlocks(), "projection of a never-held-A store");

  // 2. byte-identical prompt vs a run where A was never added; store list read at generation time.
  const prompt = await capturePrompt(store.toPromptBlocks());
  const neverAdded = await capturePrompt(ref.toPromptBlocks());
  assert.strictEqual(prompt, neverAdded);
  assert.strictEqual(
    Buffer.compare(Buffer.from(prompt, "utf8"), Buffer.from(neverAdded, "utf8")),
    0,
    "byte-identical, not merely equal-looking"
  );

  // 3. neither A.text nor A's header line anywhere in the prompt.
  assert.ok(!prompt.includes(ADD_A.text), "A.text must not reach the prompt");
  assert.ok(!prompt.includes(headerOf(ADD_A)), "A's Context header line must not reach the prompt");
});

// ---- zero tolerance: every removal shape, parameterized [goal: 'zero tolerance ... one leak anywhere in the suite fails the phase']

const removalCases = [
  { name: "remove first of three", adds: [ADD_A, ADD_B, ADD_C], removeIdx: [0], survivors: [ADD_B, ADD_C] },
  { name: "remove middle of three", adds: [ADD_A, ADD_B, ADD_C], removeIdx: [1], survivors: [ADD_A, ADD_C] },
  { name: "remove last of three", adds: [ADD_A, ADD_B, ADD_C], removeIdx: [2], survivors: [ADD_A, ADD_B] },
  { name: "remove two of three", adds: [ADD_A, ADD_B, ADD_C], removeIdx: [0, 2], survivors: [ADD_B] },
  { name: "remove every block one by one", adds: [ADD_A, ADD_B], removeIdx: [0, 1], survivors: [] },
];
for (const { name, adds, removeIdx, survivors } of removalCases) {
  test(`zero tolerance: ${name} — prompt byte-identical to a never-added run, removed content absent`, async () => {
    const { store, entries } = storeWith(adds);
    for (const i of removeIdx) {
      assert.strictEqual(store.remove(entries[i].id), true);
    }
    const prompt = await capturePrompt(store.toPromptBlocks());
    const neverAdded = await capturePrompt(storeWith(survivors).store.toPromptBlocks());
    assert.strictEqual(prompt, neverAdded);
    for (const i of removeIdx) {
      assert.ok(!prompt.includes(adds[i].text), `removed text ${JSON.stringify(adds[i].text)} leaked`);
      assert.ok(!prompt.includes(headerOf(adds[i])), `removed header ${headerOf(adds[i])} leaked`);
    }
    for (const s of survivors) {
      assert.ok(prompt.includes(s.text), "surviving blocks still reach the prompt");
    }
  });
}

// ---- clear variant [surface: 'Same shape for clear: after clear(), the captured prompt is
// byte-identical to the phase-2 zero-block prompt (instruction section + target section only)']

test("clear then generate: prompt byte-identical to the phase-2 zero-block prompt", async () => {
  const { store } = storeWith([ADD_A, ADD_B]);
  assert.strictEqual(store.clear(), 2);
  const prompt = await capturePrompt(store.toPromptBlocks());
  const explicitEmpty = await capturePrompt([]);
  const omitted = await capturePrompt(undefined);
  const assembled = assembleFnGenPrompt({
    signature: REQ.signature,
    docComment: REQ.docComment,
    languageId: REQ.languageId,
    contextBlocks: [],
  });
  assert.strictEqual(prompt, explicitEmpty);
  assert.strictEqual(prompt, omitted, "identical to a run that never saw a store");
  assert.strictEqual(prompt, assembled, "instruction section + target section only");
  assert.ok(!prompt.includes(ADD_A.text) && !prompt.includes(ADD_B.text));
  assert.ok(!prompt.includes("Context: "), "no context section survives a clear");
});

// ---- move variants [surface: 'Ordering is contracted the same way: after move, the prompt's
// context sections appear in the new list() order, byte-identical to a store built in that order from scratch']

const moveCases = [
  { name: "move last up", act: (store, entries) => store.move(entries[2].id, "up"), newOrder: [ADD_A, ADD_C, ADD_B] },
  { name: "move first down", act: (store, entries) => store.move(entries[0].id, "down"), newOrder: [ADD_B, ADD_A, ADD_C] },
];
for (const { name, act, newOrder } of moveCases) {
  test(`ordering: ${name} — prompt byte-identical to a store built in the new order from scratch`, async () => {
    const { store, entries } = storeWith([ADD_A, ADD_B, ADD_C]);
    assert.strictEqual(act(store, entries), true);
    const prompt = await capturePrompt(store.toPromptBlocks());
    const scratch = await capturePrompt(storeWith(newOrder).store.toPromptBlocks());
    assert.strictEqual(prompt, scratch);
    const indices = newOrder.map((a) => prompt.indexOf(headerOf(a)));
    assert.ok(indices.every((i) => i >= 0), "every header present");
    assert.deepStrictEqual([...indices].sort((x, y) => x - y), indices, "context sections in the new list() order");
  });
}

// ---- temporal leak guard [surface: 'the store is the single source of truth, and prompt assembly
// consumes toPromptBlocks() at generate time, never a copy captured earlier']

test("generate, remove, generate again: the second prompt drops the block — no earlier copy leaks", async () => {
  const { store, entries } = storeWith([ADD_A]);
  const first = await capturePrompt(store.toPromptBlocks());
  assert.ok(first.includes(ADD_A.text), "control: the block reaches the prompt before removal");
  assert.strictEqual(store.remove(entries[0].id), true);
  const second = await capturePrompt(store.toPromptBlocks());
  assert.ok(!second.includes(ADD_A.text), "removed block reached a later prompt: feature 3 broken");
  assert.strictEqual(second, await capturePrompt([]));
});
