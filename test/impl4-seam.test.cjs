// Implementer oracle: the repair seam — FnGenService.generateRaw (ruling 5).
// Repair rounds hand a pre-assembled prompt to the SAME pipeline as
// generate(): same producer guards (done_reason=length, fence line, empty
// after postprocess), same abort semantics, same evidence lines, same
// doc-comment dedup. Only prompt assembly is bypassed. Injected generateFn
// throughout; no model, no vscode.
//
// Run: npm test

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl4-seam",
  `export { FnGenService } from "../src/core/fnGenService";
export { assembleRepairPrompt } from "../src/core/repair";\n`
);
const { FnGenService, assembleRepairPrompt } = mod;
test.after(cleanup);

const CONFIG = {
  apiBase: "http://fake:1",
  model: "fake-30b",
  fallbackModel: "fake-14b",
  maxTokens: 64,
  temperature: 0.2,
  numGpu: 30,
};

const reply = (text, over = {}) => ({ text, ttftMs: 5, totalMs: 9, doneReason: "stop", ...over });
const service = (generateFn) => {
  const lines = [];
  const s = new FnGenService(CONFIG, generateFn, (l) => lines.push(l));
  return { s, lines };
};

test("generateRaw sends the prompt bytes verbatim: no assembly, no wrapping, config plumbed through", async () => {
  const calls = [];
  const { s } = service(async (params) => {
    calls.push(params);
    return reply("```rust\nfn f() -> i64 { 1 }\n```");
  });
  const prompt = assembleRepairPrompt({
    languageId: "rust",
    code: "fn f() -> i64 { \"x\" }\n",
    diagnostics: [{ kind: "compile-error", level: "error", message: "mismatched types", spans: [], suggestions: [], rendered: "error[E0308]\n" }],
  });
  const result = await s.generateRaw(prompt);
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].prompt, prompt, "byte-identical hand-off");
  assert.strictEqual(calls[0].model, "fake-30b");
  assert.strictEqual(calls[0].numGpu, 30, "carve discipline rides the same config path as generate()");
  assert.strictEqual(result.text, "fn f() -> i64 { 1 }");
  assert.strictEqual(result.model, "fake-30b");
});

// The three producer guards, proven to fire on the raw path exactly as on
// generate(): repaired output cannot dodge a guard by arriving pre-prompted.
const guardCases = [
  {
    name: "done_reason=length rejects as truncation",
    r: reply("fn f() {}", { doneReason: "length" }),
    match: /truncated at num_predict/,
  },
  {
    name: "fence line surviving postprocess rejects (unclosed fence fallback)",
    r: reply("fn f() {}\n```rust\nfn g() {}"),
    match: /code-fence line/,
  },
  {
    name: "empty after postprocess rejects",
    r: reply("```rust\n```"),
    match: /empty after postprocess/,
  },
];
for (const { name, r, match } of guardCases) {
  test(`raw path producer guard: ${name}`, async () => {
    const { s, lines } = service(async () => r);
    await assert.rejects(() => s.generateRaw("PROMPT"), match);
    assert.ok(lines.some((l) => l.startsWith("[fngen] request failed:") || l.includes("dropped: empty")), `failure evidence logged, got ${JSON.stringify(lines)}`);
  });
}

test("raw path abort semantics match generate(): pre-aborted signal returns undefined with the aborted evidence line", async () => {
  const { s, lines } = service(async () => reply("fn f() {}"));
  const controller = new AbortController();
  controller.abort();
  const result = await s.generateRaw("PROMPT", undefined, controller.signal);
  assert.strictEqual(result, undefined);
  assert.ok(lines.includes("[fngen] aborted"), `got ${JSON.stringify(lines)}`);
});

test("raw path dedups a re-typed doc comment exactly like generate(): repair prompts show the doc, the splice span excludes it", async () => {
  const DOC = "/// Sums things.";
  const { s } = service(async () => reply("```rust\n" + DOC + "\nfn f() -> i64 { 1 }\n```"));
  const result = await s.generateRaw("PROMPT", { docComment: DOC });
  assert.strictEqual(result.text, "fn f() -> i64 { 1 }", "doc comment stripped so the splice cannot duplicate it");
});

test("raw path evidence: gen line carries blocks=- (no context blocks exist on a repair round) and the span label", async () => {
  const { s, lines } = service(async () => reply("fn f() {}"));
  await s.generateRaw("PROMPT", { span: { start: 10, end: 30 } });
  assert.ok(
    lines.some((l) => /^\[fngen\] gen model=fake-30b promptBytes=6 blocks=- span=10-30$/.test(l)),
    `got ${JSON.stringify(lines)}`,
  );
});

test("generate() evidence is unchanged by the refactor: blocks carries the real count", async () => {
  const { s, lines } = service(async () => reply("fn f() {}"));
  await s.generate({ signature: "fn f()", contextBlocks: [], languageId: "rust" });
  assert.ok(
    lines.some((l) => /^\[fngen\] gen model=fake-30b promptBytes=\d+ blocks=0 span=-$/.test(l)),
    `got ${JSON.stringify(lines)}`,
  );
});

test("newest-wins is shared: a generateRaw call aborts an in-flight generate()", async () => {
  let firstSignal;
  let callCount = 0;
  const { s } = service(async (params) => {
    callCount++;
    if (callCount === 1) {
      firstSignal = params.signal;
      // Hang until aborted, as the real client would.
      await new Promise((resolve, reject) => {
        params.signal.addEventListener("abort", () => reject(new Error("aborted")));
      });
    }
    return reply("fn f() {}");
  });
  const first = s.generate({ signature: "fn f()" });
  await new Promise((r) => setImmediate(r));
  const second = await s.generateRaw("PROMPT");
  assert.strictEqual(firstSignal.aborted, true, "one in-flight generation at a time, whichever entry point");
  assert.strictEqual((await first), undefined, "the aborted call degrades to undefined");
  assert.strictEqual(second.text, "fn f() {}");
});

test("disposed service refuses raw generations too", async () => {
  const { s } = service(async () => reply("fn f() {}"));
  s.dispose();
  assert.strictEqual(await s.generateRaw("PROMPT"), undefined);
});
