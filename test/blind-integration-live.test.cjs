// Blind oracle: live-ollama integration contract (phase1-surface.md
// "src/core/ollama.ts" + "Integration bar (phase 1 falsification)").
// Requires ollama at http://localhost:11434 with qwen2.5-coder:1.5b-base
// pulled. Skip with SKIP_LIVE=1; on by default otherwise. Written against the
// surface doc only; never read src/**. Expected red while stubs throw.
//
// Run: npm test            (live)
//      SKIP_LIVE=1 npm test (skipped)

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const SKIP = process.env.SKIP_LIVE === "1" ? "SKIP_LIVE=1" : false;

const API_BASE = "http://localhost:11434";
const MODEL = "qwen2.5-coder:1.5b-base";

const { mod, cleanup } = bundleCore(
  "blind-integration",
  `export { generateFim, listModels } from "../src/core/ollama";
export { CompletionService } from "../src/core/completionService";
export { DEFAULT_FIM_CONFIG } from "../src/core/config";\n`
);
const { generateFim, listModels, CompletionService, DEFAULT_FIM_CONFIG } = mod;
test.after(cleanup);

// Realistic code context at the default windows: prefix 3000, suffix 1000.
// Cursor sits at the START of a statement inside a loop body, so the natural
// infill is a whole statement.
//
// It used to sit mid-statement, after `total += `, deliberately inviting a SHORT
// infill. The only correct completion there is `v;`, two characters, and the
// ghost floor added later refuses exactly that shape on purpose (8 chars / 2
// alnum; the same rule that refuses `);` and `false`). The oracle was asking the
// pipeline to serve a ghost the product is built to withhold. See
// supersessions.md S9.
function codeBlock(i) {
  return (
    `export function task${i}(input: number): number {\n` +
    `  const scaled = input * ${i};\n` +
    `  if (scaled > 100) {\n` +
    `    return scaled - ${i};\n` +
    `  }\n` +
    `  return scaled + ${i};\n` +
    `}\n\n`
  );
}

function buildContext() {
  let prefix = "";
  for (let i = 0; prefix.length < 2900; i++) prefix += codeBlock(i);
  prefix +=
    "export function average(values: number[]): number {\n" +
    "  let total = 0;\n" +
    "  for (const v of values) {\n" +
    "    ";
  let suffix = "\n  }\n  return total / values.length;\n}\n\n";
  for (let i = 100; suffix.length < 1000; i++) suffix += codeBlock(i);
  return { prefix: prefix.slice(-3000), suffix: suffix.slice(0, 1000) };
}

const liveParams = (extra = {}) => ({
  apiBase: API_BASE,
  model: MODEL,
  maxTokens: 64,
  temperature: 0.01,
  signal: new AbortController().signal,
  ...extra,
});

test("precondition: live ollama is up and the FIM model is pulled [surface: listModels 'is the server up / is the model pulled']", { skip: SKIP }, async () => {
  const tags = await listModels(API_BASE);
  assert.ok(Array.isArray(tags), "server reachable: listModels returns tags, not undefined");
  assert.ok(tags.includes(MODEL), `${MODEL} must be pulled; got ${JSON.stringify(tags)}`);
});

test("real FIM round trip: streamed text with ttftMs and totalMs measured per request [surface: ollama 'Streaming semantics']", { skip: SKIP }, async () => {
  const { prefix, suffix } = buildContext();
  const out = await generateFim(liveParams({ prefix, suffix }));
  assert.strictEqual(typeof out.text, "string", "text is the concatenated infill");
  assert.ok(out.ttftMs > 0, "ttftMs measured");
  assert.ok(out.totalMs >= out.ttftMs, "totalMs covers the whole stream");
});

test("falsification bar: warm TTFT < 200ms at a realistic 2-4K char context [surface: 'Integration bar (phase 1 falsification)']", { skip: SKIP }, async () => {
  const { prefix, suffix } = buildContext();
  // Warm-up: the bar is defined for a loaded model (at least one prior
  // request completed).
  await generateFim(liveParams({ prefix, suffix }));
  // Median of 3 warm requests, from FimGenerateResult.ttftMs as the surface
  // specifies. TTFT at or above 200ms warm fails phase 1.
  const ttfts = [];
  for (let i = 0; i < 3; i++) {
    const out = await generateFim(liveParams({ prefix, suffix }));
    ttfts.push(out.ttftMs);
  }
  const median = ttfts.slice().sort((a, b) => a - b)[1];
  assert.ok(
    median < 200,
    `warm TTFT median ${median}ms (runs: ${ttfts.map((t) => Math.round(t)).join(", ")}ms) must be < 200ms`
  );
});

test("service end-to-end against live ollama: model round trip then cache hit [surface: completionService pipeline, default generate]", { skip: SKIP }, async () => {
  const { prefix, suffix } = buildContext();
  const svc = new CompletionService(DEFAULT_FIM_CONFIG); // default generate = real generateFim
  try {
    const first = await svc.complete({ prefix, suffix, manual: true });
    assert.ok(first, "live completion resolves a result");
    assert.ok(first.text.length > 0, "postprocessed text is non-empty");
    assert.strictEqual(first.fromCache, false);
    assert.strictEqual(typeof first.ttftMs, "number", "ttftMs present: a model call happened");

    const second = await svc.complete({ prefix, suffix, manual: true });
    assert.ok(second, "identical request resolves");
    assert.strictEqual(second.fromCache, true, "second identical request is a cache hit");
    assert.strictEqual(second.ttftMs, undefined, "no model call on the hit");
  } finally {
    svc.dispose();
  }
});

test("generateFim abort against the live server rejects with an abort error [surface: ollama 'Errors']", { skip: SKIP }, async () => {
  const { prefix, suffix } = buildContext();
  const ac = new AbortController();
  const p = generateFim(liveParams({ prefix, suffix, signal: ac.signal, maxTokens: 256 }));
  setTimeout(() => ac.abort(), 10);
  await assert.rejects(p, (err) => /abort/i.test(String(err.name) + String(err.message)));
});
