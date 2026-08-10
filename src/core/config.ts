// Pure config types and defaults. VS Code settings map onto this in
// src/vscode/config.ts; core code and headless tests only ever see this shape.

import { GEN_MAX_TOKENS, GEN_NUM_CTX } from "./budgetProfile";

export interface FimConfig {
  apiBase: string;
  model: string;
  maxTokens: number;
  temperature: number;
  debounceMs: number;
  prefixChars: number;
  suffixChars: number;
  cacheCapacity: number;
  /** Minimum served ghost length, in characters. JetBrains' number: their
   *  full-line completion drops single-token suggestions and asks for eight
   *  symbols before showing anything, and this product pays a review for a
   *  three-character ghost with no confidence score to fall back on. 0 disables
   *  the floor. A setting rather than a constant because the number has to be
   *  arguable later. */
  minGhostChars: number;
  /** Minimum alphanumeric characters in a served ghost. JetBrains' number, and
   *  the leg that refuses `);` and `}}`. 0 disables this leg alone. */
  minGhostAlnum: number;
  /** Debug: dump the full FIM context (injected surface + the model's prefix/
   *  suffix window) to the log between [fim] prompt-begin/prompt-end markers, the
   *  FIM analog of the fn-gen dump. Shares the one `column80.logPrompts` setting.
   *  Verbose (FIM fires per keystroke); off by default. */
  logPrompts?: boolean;
}

export const DEFAULT_FIM_CONFIG: FimConfig = {
  apiBase: "http://localhost:11434",
  model: "qwen2.5-coder:1.5b-base",
  maxTokens: 256,
  temperature: 0.01,
  debounceMs: 150,
  prefixChars: 3000,
  suffixChars: 1000,
  cacheCapacity: 100,
  minGhostChars: 8,
  minGhostAlnum: 2,
  logPrompts: false,
};

export interface FnGenConfig {
  apiBase: string;
  model: string;
  /** Low-RAM tier model, consumed by tier selection (tiers.ts). */
  fallbackModel: string;
  /** num_predict for a generated function body. 512 was a scaffold value and it
   *  refused real work: on a 189-generation study of a production Rust
   *  workspace it caused every one of the 15 rejections and clipped the output
   *  distribution at p95, and on a synthetic C# ladder it accounted for 6 of 7
   *  failures at levels the model otherwise got right. A truncated reply is a
   *  refusal, so the cost of it being too small is a feature that does nothing. */
  maxTokens: number;
  /** num_predict for the test-authoring shape only. A `#[cfg(test)] mod tests`
   *  block with ~5 assert lines is several times a single function's output, so
   *  it needs its own, larger ceiling: reusing maxTokens truncated real modules
   *  at done_reason=length. Absent falls back to maxTokens (the run() default). */
  testMaxTokens?: number;
  temperature: number;
  /** Ollama num_gpu layer cap. Unset lets ollama schedule; the 16GB carve
   *  sets 30 so the co-resident FIM model is never pushed off the GPU. */
  numGpu?: number;
  /** Context window for prompt AND generation together. Must exceed the
   *  largest prompt plus maxTokens or ollama truncates the prompt in silence.
   *  Raising maxTokens without raising this makes generation worse, not
   *  better, because the reply eats the window the prompt needs. */
  numCtx?: number;
  /** Ollama's `think`. Unset leaves the model's own default. Set false for any
   *  model that reasons by default: reasoning is billed to maxTokens and is not
   *  the answer, so a reasoning model runs the budget out before it emits code. */
  think?: boolean | string;
  /** Debug: when set, run() dumps the full assembled prompt (generation AND
   *  repair, both share run()) to the log between prompt-begin/prompt-end
   *  markers. Off by default; the vscode `column80.logPrompts` setting flips it.
   *  Exposes exactly what context the model was shown, byte-for-byte. */
  logPrompts?: boolean;
}

export const DEFAULT_FNGEN_CONFIG: FnGenConfig = {
  apiBase: "http://localhost:11434",
  model: "qwen3-coder:30b",
  fallbackModel: "qwen2.5-coder:14b-instruct-q4_K_M",
  // Both ceilings live in budgetProfile.ts (the phase-0b derivation seam);
  // these defaults are the identity read of that table. numCtx has to clear
  // the largest prompt plus testMaxTokens: measured prompts run p90 1295 and
  // max 1972 tokens on the shipping injection budget, so 16384 leaves the
  // test-gen shape its 8192 and still has room for a prompt several times
  // today's largest.
  maxTokens: GEN_MAX_TOKENS,
  testMaxTokens: 8192,
  numCtx: GEN_NUM_CTX,
  temperature: 0.2,
  logPrompts: false,
};

/**
 * The spike-proven 16GB reference carve: cap the 30b's GPU layers so the
 * co-resident FIM model stays 100% on GPU. The 16gb-large-ram tier row
 * (tiers.ts) carries this value, and the live suite asserts the computed
 * carve equals it: the configuration proved is the configuration shipped.
 * Deliberately NOT folded into DEFAULT_FNGEN_CONFIG (whose numGpu stays
 * unset); applyTier supplies it per tier.
 */
export const REFERENCE_CARVE_NUM_GPU = 30;
