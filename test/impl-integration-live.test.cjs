// Implementer oracle: the warm-TTFT gate with VARIED prefix tails. The blind
// live test reuses one identical prompt, so its scored requests can be served
// from ollama's prompt cache; this oracle changes the statement under the
// cursor between scored requests — the realistic typing case where the KV
// prefix is mostly warm but the tail is new. Runs serially via npm run
// test:live, isolated from CPU-heavy sibling test processes.
//
// Requires ollama at http://localhost:11434 with qwen2.5-coder:1.5b-base.
// Skip with SKIP_LIVE=1.
//
// Run: npm test  /  npm run test:live

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const SKIP = process.env.SKIP_LIVE === "1" ? "SKIP_LIVE=1" : false;

const API_BASE = "http://localhost:11434";
const MODEL = "qwen2.5-coder:1.5b-base";

const { mod, cleanup } = bundleCore(
  "impl-integration",
  `export { generateFim, listModels } from "../src/core/ollama";\n`
);
const { generateFim, listModels } = mod;
test.after(cleanup);

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

// Same window sizes as the blind oracle (3000/1000), but the cursor line
// differs per request so the scored TTFTs are not a pure KV-cache replay.
function buildContext(tailVariant) {
  let prefix = "";
  for (let i = 0; prefix.length < 2700; i++) prefix += codeBlock(i);
  prefix +=
    "export function aggregate(values: number[]): number {\n" +
    "  let total = 0;\n" +
    "  for (const v of values) {\n" +
    `    ${tailVariant}`;
  let suffix = "\n  }\n  return total / values.length;\n}\n\n";
  for (let i = 100; suffix.length < 1000; i++) suffix += codeBlock(i);
  return { prefix: prefix.slice(-3000), suffix: suffix.slice(0, 1000) };
}

const TAIL_VARIANTS = [
  "total += ",
  "total += Math.abs(",
  "const next = total + ",
  "total = total + v * ",
];

const liveParams = (extra = {}) => ({
  apiBase: API_BASE,
  model: MODEL,
  maxTokens: 64,
  temperature: 0.01,
  signal: new AbortController().signal,
  ...extra,
});

test("precondition: live ollama is up and the FIM model is pulled", { skip: SKIP }, async () => {
  const tags = await listModels(API_BASE);
  assert.ok(Array.isArray(tags), "server reachable");
  assert.ok(tags.includes(MODEL), `${MODEL} must be pulled`);
});

test("falsification bar holds off the prompt cache: warm TTFT median < 200ms across varied prefix tails", { skip: SKIP }, async () => {
  // Warm-up loads the model and warms the shared KV head with a variant that
  // is never scored.
  await generateFim(liveParams(buildContext(TAIL_VARIANTS[0])));
  const ttfts = [];
  for (const variant of TAIL_VARIANTS.slice(1)) {
    const out = await generateFim(liveParams(buildContext(variant)));
    assert.ok(out.ttftMs > 0, "ttft measured");
    ttfts.push(out.ttftMs);
  }
  const median = ttfts.slice().sort((a, b) => a - b)[1];
  assert.ok(
    median < 200,
    `warm TTFT median ${Math.round(median)}ms (runs: ${ttfts.map((t) => Math.round(t)).join(", ")}ms) must be < 200ms with varied tails`
  );
  // Evidence for the run log even on green.
  console.log(`[fim-oracle] varied-tail warm TTFTs: ${ttfts.map((t) => Math.round(t)).join(", ")}ms median=${Math.round(median)}ms`);
});
