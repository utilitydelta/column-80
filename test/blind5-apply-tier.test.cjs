// Blind oracle: the applyTier seam (phase5-surface.md "applyTier - the P2-F12
// seam"). The computed carve replaces the phase-2 constant read; precedence is
// first-match-wins across the three rules, including the foreign-tag carve
// drop and the fallbackModel resolution that keeps the fnGenFallbackModel
// setting working on the low-RAM tier. Written against the surface doc only;
// never read src/**. Expected red while stubs throw.
//
// Run: npm test

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "blind5-apply-tier",
  `export { computeTier, applyTier } from "../src/core/tiers";
export { DEFAULT_FNGEN_CONFIG } from "../src/core/config";\n`
);
const { computeTier, applyTier, DEFAULT_FNGEN_CONFIG } = mod;
test.after(cleanup);

const MODEL_30B = "qwen3-coder:30b";
// The 24GB row's model since 2026-08-29. See the row test below for why it moved.
const MODEL_27B = "qwen3.8:27b";
const MODEL_14B = "qwen2.5-coder:14b-instruct-q4_K_M";

// FnGenConfig shape per the phase-2 surface (still in force); values default.
const baseConfig = () => ({
  apiBase: "http://localhost:11434",
  model: MODEL_30B,
  fallbackModel: MODEL_14B,
  maxTokens: 512,
  temperature: 0.2,
});

// Tier selections computed, not hand-built: the seam is proven end to end
// from (vram, ram) to config.
const SEL_24GB = () => computeTier(24576, 61826); // full offload, no carve
const SEL_REFERENCE = () => computeTier(16303, 61826); // num_gpu=30
const SEL_LOW_RAM = () => computeTier(16303, 15900); // 14b, row tag == default fallbackModel
const SEL_DISABLED = () => computeTier(8192, 61826);
const SEL_PROBE_FAILED = () => computeTier(undefined, undefined);

// Purity harness [surface: 'Pure; returns a fresh config, input untouched'].
function applyPure(config, sel, explicit) {
  const snapshot = structuredClone(config);
  const out = applyTier(config, sel, explicit);
  assert.deepStrictEqual(config, snapshot, "input config untouched");
  assert.notStrictEqual(out, config, "a fresh config object, never the input");
  return out;
}

test("seam sanity: the low-ram row tag equals DEFAULT_FNGEN_CONFIG.fallbackModel, the hinge of rule 2 [surface: 'a row tag equal to DEFAULT_FNGEN_CONFIG.fallbackModel resolves through config.fallbackModel']", () => {
  assert.strictEqual(DEFAULT_FNGEN_CONFIG.fallbackModel, MODEL_14B);
  assert.strictEqual(SEL_LOW_RAM().fnGenModel, MODEL_14B);
});

// ---- rule 1: disabled tiers are a field-identical copy [surface: 'Disabling is command-level gating (vscode layer), not config surgery']

test("disabled tier: field-identical copy, fresh object [surface: rule 1]", () => {
  const cfg = baseConfig();
  const out = applyPure(cfg, SEL_DISABLED(), false);
  assert.deepStrictEqual(out, cfg);
});

test("rule 1 wins over rule 2: disabled + explicitFnGenModel true is still a plain copy [surface: 'Rules, first match wins']", () => {
  const cfg = { ...baseConfig(), model: "my-own:7b", numGpu: 12 };
  const out = applyPure(cfg, SEL_PROBE_FAILED(), true);
  assert.deepStrictEqual(out, cfg, "no model rewrite, no carve surgery, numGpu untouched");
});

test("the disabled selection carries the honest message the vscode layer will surface [surface: computeTier rule 4 + 'below-12gb behavior']", () => {
  const sel = SEL_DISABLED();
  assert.strictEqual(sel.fnGenEnabled, false);
  assert.strictEqual(
    sel.message,
    "Function generation is disabled: this GPU has 8192MB of VRAM and function generation needs at least 12288MB. FIM tab-completion still works."
  );
});

// ---- rule 2 + 3: the reference carve replaces the constant read [surface: 'P2-F12' replacement plan]

test("reference tier, model not explicit: row tag stands, numGpu becomes the computed carve 30 [surface: rules 2-3; this replaces the readFnGenConfig() hardcode]", () => {
  const cfg = baseConfig();
  delete cfg.numGpu; // phase-2 default config carries no numGpu; the tier supplies it
  const out = applyPure(cfg, SEL_REFERENCE(), false);
  assert.strictEqual(out.model, MODEL_30B);
  assert.strictEqual(out.numGpu, 30, "the computed carve, not a constant read");
  // Untouched carry-through fields.
  assert.strictEqual(out.apiBase, cfg.apiBase);
  assert.strictEqual(out.fallbackModel, cfg.fallbackModel);
  assert.strictEqual(out.maxTokens, cfg.maxTokens);
  assert.strictEqual(out.temperature, cfg.temperature);
});

test("explicit user model equal to the row tag keeps the carve: equality is on the tag, not on who chose it [surface: rule 3 'when the effective model equals sel.fnGenModel exactly']", () => {
  const out = applyPure(baseConfig(), SEL_REFERENCE(), true);
  assert.strictEqual(out.model, MODEL_30B, "explicit model stands");
  assert.strictEqual(out.numGpu, 30);
});

test("explicit foreign tag drops the carve entirely [surface: rule 3 'riding num_gpu=30 on a foreign tag would be a silent mis-carve']", () => {
  const cfg = { ...baseConfig(), model: "llama3.1:70b-instruct" };
  const out = applyPure(cfg, SEL_REFERENCE(), true);
  assert.strictEqual(out.model, "llama3.1:70b-instruct", "the human's setting stands");
  assert.strictEqual(out.numGpu, undefined, "letting ollama schedule an unknown model is the only honest default");
});

test("foreign tag drops the carve even when the input config carried a numGpu [surface: rule 3 'else absent']", () => {
  const cfg = { ...baseConfig(), model: "llama3.1:70b-instruct", numGpu: 30 };
  const out = applyPure(cfg, SEL_REFERENCE(), true);
  assert.strictEqual(out.numGpu, undefined, "absent means absent, not carried over");
});

// ---- 24gb: full offload

test("24gb tier: row tag, numGpu absent (full offload), thinking off [surface: table row 1 'absent (full offload)']", () => {
  const out = applyPure(baseConfig(), SEL_24GB(), false);
  // The 24GB row moved to `qwen3.8:27b` on 2026-08-29 by human ruling: a TIE with
  // the 30b on function generation (4 of 12 compiled each) plus the only local
  // model measured to reach the cloud tier's placement rate on the review path.
  assert.strictEqual(out.model, MODEL_27B);
  assert.strictEqual(out.numGpu, undefined, "no layer cap on a card that fits both models");
  // The row's think flag rides the model tag exactly as the carve does, so a
  // user who overrode the model does not inherit a flag about a model they are
  // not running.
  assert.strictEqual(out.think, false, "qwen3.8 reasons by default and reasoning is billed to maxTokens");
});

// ---- low-RAM tier: fallbackModel resolution [surface: rule 2]

test("low-ram tier, default fallback: row tag resolves through config.fallbackModel to the same 14b, no carve [surface: rule 2 + table row 3]", () => {
  const out = applyPure(baseConfig(), SEL_LOW_RAM(), false);
  assert.strictEqual(out.model, MODEL_14B);
  assert.strictEqual(out.numGpu, undefined, "both models fit fully resident; no carve needed");
});

test("low-ram tier, customized fnGenFallbackModel keeps working: the setting's value becomes the model [surface: 'so the existing fnGenFallbackModel setting keeps working on the low-RAM tier']", () => {
  const cfg = { ...baseConfig(), fallbackModel: "my-tuned-14b:latest" };
  const out = applyPure(cfg, SEL_LOW_RAM(), false);
  assert.strictEqual(out.model, "my-tuned-14b:latest");
  assert.strictEqual(out.numGpu, undefined, "effective model differs from the row's exact tag; no carve rides along");
});

test("low-ram tier with an explicit fnGenModel: the human's model stands, fallback resolution never runs [surface: rule 2 'when explicitFnGenModel is true ... config.model stands']", () => {
  const cfg = { ...baseConfig(), model: "starcoder2:15b", fallbackModel: "my-tuned-14b:latest" };
  const out = applyPure(cfg, SEL_LOW_RAM(), true);
  assert.strictEqual(out.model, "starcoder2:15b");
  assert.strictEqual(out.numGpu, undefined);
});
