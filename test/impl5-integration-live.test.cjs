// Implementer oracle: the phase-5 seam proven end to end on the reference
// box - REAL probe -> computeTier -> applyTier -> the PRODUCT clients
// (generateInstruct with the tier-computed numGpu, generateFim) -> /api/ps
// dual residency. blind5-integration-live proves bar 5 with direct request
// bodies; this file proves the same residency outcome through the exact
// config the editor path derives from probed hardware, so a wiring
// regression between tier logic and the ollama client cannot hide behind a
// green bar-5.
//
// Serial-context presumption (surface ruling 1-2): runs AFTER the phase-4
// and blind5 files in the test:live serial list; both models are warm and
// the 30b is resident under the reference carve when this file starts.
//
// Requires ollama at http://localhost:11434 with qwen2.5-coder:1.5b-base and
// qwen3-coder:30b pulled. No test here pulls a model. Skip with SKIP_LIVE=1.
//
// Run: npm run test:live

const test = require("node:test");
const assert = require("node:assert");
const crypto = require("crypto");
const { bundleCore } = require("./.blind-util.cjs");

const SKIP = process.env.SKIP_LIVE === "1" ? "SKIP_LIVE=1" : false;
const LIVE_TIMEOUT = 300_000;

const API_BASE = "http://localhost:11434";
const FIM_MODEL = "qwen2.5-coder:1.5b-base";
const FNGEN_MODEL = "qwen3-coder:30b";

const { mod, cleanup } = bundleCore(
  "impl5-integration",
  `export { probeHardware } from "../src/core/hardware";
export { computeTier, applyTier, tierLogLine } from "../src/core/tiers";
export { generateFim, generateInstruct } from "../src/core/ollama";
export { DEFAULT_FNGEN_CONFIG, REFERENCE_CARVE_NUM_GPU } from "../src/core/config";\n`
);
const {
  probeHardware,
  computeTier,
  applyTier,
  tierLogLine,
  generateFim,
  generateInstruct,
  DEFAULT_FNGEN_CONFIG,
  REFERENCE_CARVE_NUM_GPU,
} = mod;
test.after(cleanup);

// Realistic FIM context at the phase-1 default windows, same discipline as
// the earlier live files.
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

function fimParams() {
  let prefix = "";
  for (let i = 0; prefix.length < 2900; i++) prefix += codeBlock(i);
  prefix +=
    "export function median(values: number[]): number {\n" +
    "  const sorted = [...values].sort((a, b) => ";
  let suffix = "\n  return sorted[Math.floor(sorted.length / 2)];\n}\n\n";
  for (let i = 200; suffix.length < 1000; i++) suffix += codeBlock(i);
  return {
    apiBase: API_BASE,
    model: FIM_MODEL,
    prefix: prefix.slice(-3000),
    suffix: suffix.slice(0, 1000),
    maxTokens: 64,
    temperature: 0.01,
    signal: new AbortController().signal,
  };
}

async function fetchPs() {
  const res = await fetch(`${API_BASE}/api/ps`);
  assert.ok(res.ok, `/api/ps ${res.status}`);
  return ((await res.json()).models ?? []);
}

function assertDualResidency(models, label) {
  const fim = models.find((m) => m.name === FIM_MODEL);
  const fngen = models.find((m) => m.name === FNGEN_MODEL);
  assert.ok(fim, `${label}: ${FIM_MODEL} resident; /api/ps has ${JSON.stringify(models.map((m) => m.name))}`);
  assert.ok(fngen, `${label}: ${FNGEN_MODEL} resident`);
  assert.strictEqual(fim.size_vram, fim.size, `${label}: 1.5b fully GPU-resident`);
  assert.ok(fngen.size_vram > 0 && fngen.size_vram < fngen.size, `${label}: 30b layer-capped`);
}

test("SEAM live: probed hardware -> tier -> applyTier reproduces the reference config on this box", { skip: SKIP, timeout: LIVE_TIMEOUT }, async (ctx) => {
  const probe = await probeHardware();
  if (probe.unifiedMemory) {
    ctx.skip("Apple Silicon: unified memory has no CUDA carve, so the reference-box (NVIDIA) tier does not apply");
    return;
  }
  const sel = computeTier(probe.vramMB, probe.ramMB);
  assert.strictEqual(sel.id, "16gb-large-ram", `this is the reference box; probe vram=${probe.vramMB} ram=${probe.ramMB}`);
  const cfg = applyTier({ ...DEFAULT_FNGEN_CONFIG, apiBase: API_BASE }, sel, false);
  assert.strictEqual(cfg.model, FNGEN_MODEL);
  assert.strictEqual(cfg.numGpu, REFERENCE_CARVE_NUM_GPU, "the computed carve IS the live-proven constant");
  // Evidence line for the record, exactly what activation would append.
  console.log(tierLogLine(sel, probe.vramMB, probe.ramMB, "auto"));
});

test("SEAM live: the tier-computed config drives the PRODUCT clients and holds dual residency + warm FIM", { skip: SKIP, timeout: LIVE_TIMEOUT }, async (ctx) => {
  const probe = await probeHardware();
  if (probe.unifiedMemory) {
    ctx.skip("Apple Silicon: unified memory has no CUDA carve, so the reference-box (NVIDIA) residency outcome does not apply");
    return;
  }
  const cfg = applyTier(
    { ...DEFAULT_FNGEN_CONFIG, apiBase: API_BASE },
    computeTier(probe.vramMB, probe.ramMB),
    false,
  );

  // fn-gen through the product instruct client, carve applied from the
  // computed config; fresh nonce defeats the prompt cache.
  const gen = await generateInstruct({
    apiBase: cfg.apiBase,
    model: cfg.model,
    prompt:
      "Implement the function below. Reply with only the complete function definition in a rust code block.\n\n" +
      "```rust\npub fn checksum(data: &[u8]) -> u32\n```\n\n" +
      `// nonce: ${crypto.randomUUID()}\n`,
    maxTokens: 150,
    temperature: cfg.temperature,
    numGpu: cfg.numGpu,
    signal: new AbortController().signal,
  });
  assert.ok(gen.text.length > 0, "the 30b answered under the computed carve");
  assertDualResidency(await fetchPs(), "after tier-config fn-gen");

  // FIM through the product client right after 30b traffic: the alternation
  // the carve exists for, at the phase-1 bar.
  const fim = await generateFim(fimParams());
  assert.ok(fim.ttftMs < 200, `warm FIM TTFT ${Math.round(fim.ttftMs)}ms must stay < 200ms beside the carved 30b`);
  assertDualResidency(await fetchPs(), "after FIM alternation");
});
