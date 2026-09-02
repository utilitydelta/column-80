// session-v65 phase 4: the dictated intent on the FIM service.
//
// Implementer's oracle over `CompletionRequest.intent`: the comment is spliced closest to the
// cursor under any surface the site's resolver injected, the request skips the debounce, is
// never served from the cache and never fills it, keys the in-flight registry on the comment,
// pins ollama's context window, and gets the wider injection race.
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore, sleep } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-v65-p4-intent-seam",
  `export { CompletionService, INJECTION_DEADLINE_MS, INTENT_INJECTION_DEADLINE_MS } from "../src/core/completionService";
export { FIM_NUM_CTX, DICTATION_SURFACE_TOK } from "../src/core/budgetProfile";\n`,
);
const { CompletionService, INJECTION_DEADLINE_MS, INTENT_INJECTION_DEADLINE_MS, FIM_NUM_CTX, DICTATION_SURFACE_TOK } = mod;
test.after(cleanup);

const CFG = {
  apiBase: "http://127.0.0.1:1",
  model: "fake-fim",
  maxTokens: 64,
  temperature: 0.01,
  debounceMs: 150,
  prefixChars: 400,
  suffixChars: 100,
  multiline: true,
  cacheCapacity: 10,
  minGhostChars: 0,
  minGhostAlnum: 0,
};
const PREFIX = "fn f() {\n    let a = 1;\n    ";
const SUFFIX = "\n    a\n}\n";
const COMMENT = "// Loop over the tiles and enroll each one.";

function service(reply = "let b = a + 1;") {
  const calls = [];
  const lines = [];
  const svc = new CompletionService(
    CFG,
    async (p) => {
      calls.push(p);
      return { text: reply, ttftMs: 1, totalMs: 2 };
    },
    (line) => lines.push(line),
  );
  return { svc, calls, lines };
}

test("the intent is spliced above the cursor line, and ollama gets the pinned window", async () => {
  const { svc, calls, lines } = service();
  const r = await svc.complete({ prefix: PREFIX, suffix: SUFFIX, intent: COMMENT, languageId: "rust" });
  assert.ok(r && r.text.length > 0, "served");
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].prefix, "fn f() {\n    let a = 1;\n    " + COMMENT + "\n    ", "comment above the cursor line at the line's indent");
  assert.strictEqual(calls[0].numCtx, FIM_NUM_CTX);
  assert.ok(lines.some((l) => /^\[fim\] intent injected lines=1 under surface lines=0$/.test(l)), lines.join("\n"));
});

test("a plain request also carries the pinned window (no reload between the two shapes)", async () => {
  const { svc, calls } = service();
  await svc.complete({ prefix: PREFIX, suffix: SUFFIX, manual: true, languageId: "rust" });
  assert.strictEqual(calls[0].numCtx, FIM_NUM_CTX);
  assert.ok(Number.isInteger(FIM_NUM_CTX) && FIM_NUM_CTX >= 8192);
});

test("the comment goes UNDER the site's own surface, closest to the cursor", async () => {
  const { svc, calls, lines } = service();
  await svc.complete({
    prefix: PREFIX,
    suffix: SUFFIX,
    intent: COMMENT,
    languageId: "rust",
    wholeBlockSite: true,
    resolveInjection: async () => "// struct Tile { id: u32 }\n// fn enroll(t: Tile)",
  });
  const p = calls[0].prefix;
  assert.ok(p.includes("// struct Tile { id: u32 }\n    // fn enroll(t: Tile)\n    " + COMMENT + "\n    "), JSON.stringify(p));
  assert.ok(lines.some((l) => l === "[fim] intent injected lines=1 under surface lines=2"), lines.join("\n"));
});

test("an intent request skips the debounce", async () => {
  const { svc, calls } = service();
  const t0 = Date.now();
  await svc.complete({ prefix: PREFIX, suffix: SUFFIX, intent: COMMENT, languageId: "rust" });
  assert.ok(Date.now() - t0 < 100, "no 150ms debounce wait");
  assert.strictEqual(calls.length, 1);
});

test("an intent request is never served from the cache and never fills it", async () => {
  const { svc, calls } = service();
  await svc.complete({ prefix: PREFIX, suffix: SUFFIX, manual: true, languageId: "rust" });
  assert.strictEqual(calls.length, 1, "the plain request filled the cache");
  await svc.complete({ prefix: PREFIX, suffix: SUFFIX, intent: COMMENT, languageId: "rust" });
  assert.strictEqual(calls.length, 2, "the intent request hit the model, not the plain entry");
  await svc.complete({ prefix: PREFIX, suffix: SUFFIX, intent: COMMENT, languageId: "rust" });
  assert.strictEqual(calls.length, 3, "the second intent request hit the model again: nothing was cached for it");
  const plain = await svc.complete({ prefix: PREFIX, suffix: SUFFIX, manual: true, languageId: "rust" });
  assert.strictEqual(calls.length, 3, "the plain request is still answered by its own cache entry");
  assert.ok(plain && plain.fromCache);
});

test("an in-flight plain request at the same cursor is superseded, not joined, by the intent", async () => {
  const calls = [];
  let release;
  const gate = new Promise((r) => (release = r));
  const svc = new CompletionService(
    { ...CFG, debounceMs: 0 },
    async (p) => {
      calls.push(p);
      if (calls.length === 1) await gate;
      return { text: `ghost ${calls.length}`, ttftMs: 1, totalMs: 2 };
    },
    () => undefined,
  );
  const first = svc.complete({ prefix: PREFIX, suffix: SUFFIX, manual: true, languageId: "rust" });
  await sleep(10);
  const second = svc.complete({ prefix: PREFIX, suffix: SUFFIX, intent: COMMENT, languageId: "rust" });
  await sleep(10);
  release();
  const [a, b] = await Promise.all([first, second]);
  assert.strictEqual(calls.length, 2, "two model calls: the intent did not join the plain one");
  assert.ok(b && b.text === "ghost 2", `the intent got its own answer: ${JSON.stringify(b)}`);
  assert.ok(a === undefined || a.text !== "ghost 2", "the plain one was aborted or answered on its own");
});

test("the intent race is wider than the keystroke race, and a slow resolver still lands inside it", async () => {
  assert.ok(INTENT_INJECTION_DEADLINE_MS > INJECTION_DEADLINE_MS);
  assert.ok(INTENT_INJECTION_DEADLINE_MS <= 500, "but inside the sub-second bar");
  const { svc, calls, lines } = service();
  await svc.complete({
    prefix: PREFIX,
    suffix: SUFFIX,
    intent: COMMENT,
    languageId: "rust",
    resolveInjection: async () => {
      await sleep(INJECTION_DEADLINE_MS + 60);
      return "// slow surface";
    },
  });
  assert.ok(calls[0].prefix.includes("// slow surface\n    " + COMMENT), "a 110ms resolver landed under the intent race");
  assert.ok(!lines.some((l) => l.includes("injection skipped")), lines.join("\n"));
});

test("the dictation surface budget is the inherited FIM number until phase 7 moves it", () => {
  assert.strictEqual(DICTATION_SURFACE_TOK, 300);
});
