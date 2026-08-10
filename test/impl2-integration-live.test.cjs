// Implementer oracle: live phase-2 edges beyond the blind boundary bar —
// a generation steered by a user context block (still boundary-checked:
// EVERY live generation asserts the span oracle), then the cross-model
// alternation the suite creates today: after 30b traffic, the phase-1 FIM
// TTFT gate must still hold on a re-warmed 1.5b (varied tails per
// test/impl-integration-live.test.cjs discipline), and /api/ps must show
// both models resident with the FIM model 100% on GPU — the carve's whole
// point (goal feature 5 reference config, exercised early because this
// suite alternates models TODAY).
//
// Requires ollama at http://localhost:11434 with qwen3-coder:30b and
// qwen2.5-coder:1.5b-base pulled. Skip with SKIP_LIVE=1.
//
// Run: npm run test:live

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const SKIP = process.env.SKIP_LIVE === "1" ? "SKIP_LIVE=1" : false;
const LIVE_TIMEOUT = 120_000;

const API_BASE = "http://localhost:11434";
const FNGEN_MODEL = "qwen3-coder:30b";
const FIM_MODEL = "qwen2.5-coder:1.5b-base";

const { mod, cleanup } = bundleCore(
  "impl2-integration",
  `export { FnGenService } from "../src/core/fnGenService";
export { spliceSpan, byteCompareOutsideSpan } from "../src/core/span";
export { generateFim, listModels } from "../src/core/ollama";
export { REFERENCE_CARVE_NUM_GPU } from "../src/core/config";\n`
);
const { FnGenService, spliceSpan, byteCompareOutsideSpan, generateFim, listModels, REFERENCE_CARVE_NUM_GPU } = mod;
test.after(cleanup);

// P2-F12: the live suite proves the SAME configuration the editor path
// runs — the shared constant is the coupling, not a copied literal.
const LIVE_CONFIG = {
  apiBase: API_BASE,
  model: FNGEN_MODEL,
  fallbackModel: "qwen2.5-coder:14b-instruct-q4_K_M",
  maxTokens: 512,
  temperature: 0.2,
  numGpu: REFERENCE_CARVE_NUM_GPU, // without the carve ollama evicts the FIM model
};

// Fixture with a helper the model can only know from the context block.
const ORIGINAL = `//! Live fixture: context-block-steered generation.

pub fn scale(x: i64) -> i64 {
    x * 10
}

/// Clamps every value in place using the shared \`clamp_to_limit\` helper.
pub fn clamp_all(values: &mut [i64]) {
    unimplemented!()
}

pub fn shift(x: i64) -> i64 {
    x + 1
}
`;
const SPAN_START = ORIGINAL.indexOf("pub fn clamp_all");
const SPAN_END = ORIGINAL.indexOf("}", SPAN_START) + 1;
const SPAN = { start: SPAN_START, end: SPAN_END };

const CONTEXT_BLOCK = {
  uri: "file:///w/src/limits.rs",
  range: { startLine: 1, endLine: 3 },
  text: "pub fn clamp_to_limit(v: i64) -> i64 {\n    v.clamp(-LIMIT, LIMIT)\n}",
};

// FIM context builder, varied tails — same discipline as the phase-1
// implementer oracle in test/impl-integration-live.test.cjs.
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

function buildFimContext(tailVariant) {
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

const TAIL_VARIANTS = ["total += ", "total += Math.abs(", "const next = total + ", "total = total + v * "];

const fimParams = (extra = {}) => ({
  apiBase: API_BASE,
  model: FIM_MODEL,
  maxTokens: 64,
  temperature: 0.01,
  signal: new AbortController().signal,
  ...extra,
});

test("precondition: live ollama is up with both alternation models pulled", { skip: SKIP, timeout: LIVE_TIMEOUT }, async () => {
  const tags = await listModels(API_BASE);
  assert.ok(Array.isArray(tags), "server reachable");
  for (const m of [FNGEN_MODEL, FIM_MODEL]) {
    assert.ok(tags.includes(m), `${m} must be pulled; got ${JSON.stringify(tags)}`);
  }
});

test("context-block generation holds the boundary bar and logs exact prompt evidence", { skip: SKIP, timeout: LIVE_TIMEOUT }, async () => {
  const lines = [];
  const svc = new FnGenService(LIVE_CONFIG, undefined, (l) => lines.push(l));
  try {
    const chunks = [];
    const out = await svc.generate({
      signature: "pub fn clamp_all(values: &mut [i64])",
      docComment: "/// Clamps every value in place using the shared `clamp_to_limit` helper.",
      contextBlocks: [CONTEXT_BLOCK],
      languageId: "rust",
      span: SPAN,
      onChunk: (c) => chunks.push(c),
    });
    assert.ok(out, "live generation resolves");
    assert.ok(out.text.length > 0, "non-empty");
    assert.strictEqual(out.model, FNGEN_MODEL);
    assert.ok(chunks.length >= 1, "streaming delivered raw chunks");
    assert.ok(chunks.every((c) => c !== ""), "no empty chunk was delivered");

    // P2-F3 producer-side teeth: bar 2 is not just "splice arithmetic
    // holds" — the resolved text itself must be splice-worthy: no fence
    // lines (markdown leaking into source) and a complete function shape.
    assert.ok(
      out.text.split("\n").every((l) => !l.trim().startsWith("```")),
      `no fence line may land in resolved text; got: ${out.text}`
    );
    const opens = (out.text.match(/{/g) ?? []).length;
    const closes = (out.text.match(/}/g) ?? []).length;
    assert.strictEqual(opens, closes, `braces balance in a complete function; got: ${out.text}`);

    // The falsification bar, asserted on every live generation: oracle +
    // independent slice comparison.
    const spliced = spliceSpan(ORIGINAL, SPAN, out.text);
    assert.strictEqual(byteCompareOutsideSpan(ORIGINAL, spliced, SPAN), true, "boundary oracle");
    assert.strictEqual(spliced.slice(0, SPAN.start), ORIGINAL.slice(0, SPAN.start), "independent prefix check");
    assert.strictEqual(
      spliced.slice(spliced.length - (ORIGINAL.length - SPAN.end)),
      ORIGINAL.slice(SPAN.end),
      "independent suffix check"
    );

    const genLine = lines.find((l) => l.startsWith("[fngen] gen "));
    assert.ok(genLine, "gen evidence emitted");
    assert.ok(genLine.includes("blocks=1"), `context block counted: ${genLine}`);
    assert.ok(genLine.includes(`span=${SPAN.start}-${SPAN.end}`), `span logged: ${genLine}`);
    const doneLine = lines.find((l) => /^\[fngen\] ttft=\d+ms total=\d+ms len=\d+$/.test(l));
    assert.ok(doneLine, `integer-ms completion evidence, got ${JSON.stringify(lines)}`);
  } finally {
    svc.dispose();
  }
});

test("P2-F3/F4 probe: a num_predict too small to finish the function rejects as truncated — truncation garbage never resolves, never splices", { skip: SKIP, timeout: LIVE_TIMEOUT }, async () => {
  // The reviewer's probe: force done_reason=length by starving num_predict.
  // Before the fix this resolved fence-and-fragment garbage that spliced
  // cleanly (the arithmetic bar cannot see producer garbage); the bar now
  // has producer-side teeth.
  const lines = [];
  const svc = new FnGenService({ ...LIVE_CONFIG, maxTokens: 24 }, undefined, (l) => lines.push(l));
  try {
    await assert.rejects(
      svc.generate({
        signature: "pub fn clamp_all(values: &mut [i64])",
        docComment: "/// Clamps every value in place using the shared `clamp_to_limit` helper.",
        contextBlocks: [CONTEXT_BLOCK],
        languageId: "rust",
        span: SPAN,
      }),
      /truncat|fence/i,
      "starved generation must reject, not resolve garbage"
    );
    assert.ok(
      lines.some((l) => l.startsWith("[fngen] ") && /truncat|fence/i.test(l)),
      `truncation/fence evidence line, got ${JSON.stringify(lines)}`
    );
  } finally {
    svc.dispose();
  }
});

test("after 30b traffic the phase-1 FIM gate still holds: re-warm, then varied-tail warm TTFT median < 200ms", { skip: SKIP, timeout: LIVE_TIMEOUT }, async () => {
  // Re-warm per phase-1 discipline: the alternation may have cost the FIM
  // model its KV head; the gate is defined warm, so one unscored request
  // re-warms before the scored three.
  await generateFim(fimParams(buildFimContext(TAIL_VARIANTS[0])));
  const ttfts = [];
  for (const variant of TAIL_VARIANTS.slice(1)) {
    const out = await generateFim(fimParams(buildFimContext(variant)));
    ttfts.push(out.ttftMs);
  }
  const median = ttfts.slice().sort((a, b) => a - b)[1];
  console.log(
    `[fngen-oracle] post-30b FIM TTFTs: ${ttfts.map((t) => Math.round(t)).join(", ")}ms median=${Math.round(median)}ms`
  );
  assert.ok(
    median < 200,
    `post-alternation warm TTFT median ${Math.round(median)}ms (runs: ${ttfts.map((t) => Math.round(t)).join(", ")}ms) must be < 200ms`
  );
});

test("carve evidence: both models resident, FIM model 100% on GPU, 30b partially offloaded by the num_gpu cap", { skip: SKIP, timeout: LIVE_TIMEOUT }, async () => {
  const res = await fetch(`${API_BASE}/api/ps`);
  assert.ok(res.ok, "/api/ps reachable");
  const ps = await res.json();
  const byName = new Map((ps.models ?? []).map((m) => [m.name, m]));
  const fim = byName.get(FIM_MODEL);
  const gen = byName.get(FNGEN_MODEL);
  assert.ok(fim, `FIM model resident after alternation; ps=${JSON.stringify([...byName.keys()])}`);
  assert.ok(gen, `fn-gen model resident after alternation; ps=${JSON.stringify([...byName.keys()])}`);
  assert.strictEqual(fim.size_vram, fim.size, "FIM model fully on GPU — the eviction/offload failure the carve exists to prevent");
  assert.ok(gen.size_vram > 0, "30b holds GPU layers");
  assert.ok(gen.size_vram < gen.size, "30b is layer-capped, not fully resident (num_gpu=30 carve in effect)");
});
