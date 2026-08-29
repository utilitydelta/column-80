// The tier table and carve computation. On 16GB the 30b must be
// layer-capped so the FIM model stays 100% on GPU - default
// ollama scheduling thrashes (2-4.6s reloads) and over-allocating the 30b
// silently pushes the 1.5b to CPU, the worst outcome (spike-proven).
// Contract: docs/architecture/hardware-tiers.md.

import { DEFAULT_FNGEN_CONFIG, FnGenConfig, REFERENCE_CARVE_NUM_GPU } from "./config";

export type TierId = "24gb" | "16gb-large-ram" | "16gb-low-ram" | "below-12gb";

export interface TierRow {
  id: TierId;
  /** Inclusive MB lower bounds; rows are checked in table order, first match
   *  wins. Bounds sit below nominal card/board sizes because hardware reports
   *  under nominal (a 16GB card reports 16303 MiB, a 64GB box ~61826 MB). */
  minVramMB: number;
  minRamMB: number;
  /** Absent = fn-gen disabled on this tier (FIM only). */
  fnGenModel?: string;
  /** Absent = full offload, ollama schedules. Present = the carve. */
  fnGenNumGpu?: number;
  /**
   * Ollama's `think`, for a tier whose model reasons by default.
   *
   * ON THE ROW, NOT ON `DEFAULT_FNGEN_CONFIG`, and that is deliberate. `think`
   * has no config default by design - `readFnGenConfig` keeps the key ABSENT
   * when nothing configures it, and a blind row pins that discipline - because
   * an explicit `undefined` and an absent key are different objects to the
   * deep-equality the config path rests on. Putting `false` in the default
   * broke that row.
   *
   * It also belongs here on the merits: the shipped default `qwen3-coder:30b`
   * CANNOT think (ollama refuses `think:true` with "does not support
   * thinking"), so a config-level false would be inert for it and would only
   * ever matter for a model chosen by a tier or by the user.
   *
   * Reasoning is billed to maxTokens. Measured on `qwen3:8b` over twelve C#
   * generations: thinking off gave 0 compiled at 3,692ms median with no empty
   * replies; thinking on gave 0 compiled at 52,395ms median with ELEVEN OF
   * TWELVE replies empty - the budget was gone before any code was emitted.
   */
  fnGenThink?: boolean;
  /** True while the tier has never been validated on real hardware. */
  provisional: boolean;
}

// Data, not code: computeTier walks this table and nothing else decides.
// - 24gb is provisional: never validated on real 24GB hardware.
// - The 16gb-low-ram row doubles as the 12-16GB band: the 14b dense config
//   (~9GB) plus the 1.5b fits a 12GB card, so the band gets fn-gen rather
//   than an invented fifth tier.
// - minRamMB 28672 puts nominal-32GB boxes (report ~30-31GB) above the line
//   and nominal-16GB boxes (~15.9GB) below it; the 30b keeps ~7.6GB
//   CPU-resident under the carve, which a 16GB box cannot spare.
export const TIER_TABLE: readonly TierRow[] = [
  // 24GB gets the biggest model that fits WHOLE beside the FIM model:
  // `qwen3.8:27b` is 18GB and the 1.5b FIM model is 1GB, which clears 20GB with
  // room. It reasons by default, hence the explicit false.
  {
    id: "24gb",
    minVramMB: 20480,
    minRamMB: 0,
    fnGenModel: "qwen3.8:27b",
    fnGenThink: false,
    provisional: true,
  },
  // THE CARVE IS BACK, AND ITS REMOVAL WAS A REAL REGRESSION CAUGHT BEFORE IT
  // SHIPPED. It was dropped while the default was briefly `qwen3:8b` (5.2GB),
  // where it is genuinely unnecessary: a 5.2GB model plus a 1GB FIM model both
  // fit whole in 16GB. The default then reverted to `qwen3-coder:30b` on the
  // generation measurement, and these two rows - written in terms of
  // `DEFAULT_FNGEN_CONFIG.model` rather than a literal - silently followed it.
  //
  // That left an 18.6GB model on a 16GB card with no layer cap, which is the
  // exact configuration the header above says thrashes: ollama reloads at
  // 2-4.6s and silently pushes the 1.5b FIM model to CPU, "the worst outcome
  // (spike-proven)". A row expressed against a constant inherits every change
  // to that constant, including the ones it was never reasoned about.
  {
    id: "16gb-large-ram",
    minVramMB: 15360,
    minRamMB: 28672,
    fnGenModel: DEFAULT_FNGEN_CONFIG.model,
    fnGenNumGpu: REFERENCE_CARVE_NUM_GPU,
    provisional: false,
  },
  // The 12-16GB band keeps the smaller fallback. It followed the default to an
  // 18.6GB model for the same reason as the row above, which no 12GB card can
  // hold at all.
  {
    id: "16gb-low-ram",
    minVramMB: 12288,
    minRamMB: 0,
    fnGenModel: DEFAULT_FNGEN_CONFIG.fallbackModel,
    provisional: false,
  },
  { id: "below-12gb", minVramMB: 0, minRamMB: 0, provisional: false },
];

export interface TierSelection {
  // "cloud" and "claude-code" are the off-table selections for the optional
  // non-local fn-gen backends: no VRAM tier applies (there is no local model to
  // fit), so buildFnGenService synthesizes them instead of walking TIER_TABLE.
  // computeTier never emits either. They are separate ids rather than one
  // because they fail closed for different reasons - a missing key or endpoint
  // for "cloud", a missing CLI or product-owned directory for "claude-code" -
  // and the evidence line names which.
  id: TierId | "cloud" | "claude-code" | "remote";
  fnGenEnabled: boolean;
  fnGenModel?: string;
  fnGenNumGpu?: number;
  fnGenThink?: boolean;
  provisional: boolean;
  /** Present iff fnGenEnabled is false: the honest line the UI shows. */
  message?: string;
}

// Absent optional fields are key-absent, not value-undefined: selections
// built here mirror the table rows' key shape so deep-equality over
// selections and configs stays meaningful.
function selectionFromRow(row: TierRow, message?: string): TierSelection {
  if (row.fnGenModel === undefined) {
    return { id: row.id, fnGenEnabled: false, provisional: row.provisional, message };
  }
  return {
    id: row.id,
    fnGenEnabled: true,
    fnGenModel: row.fnGenModel,
    ...(row.fnGenNumGpu !== undefined ? { fnGenNumGpu: row.fnGenNumGpu } : {}),
    ...(row.fnGenThink !== undefined ? { fnGenThink: row.fnGenThink } : {}),
    provisional: row.provisional,
  };
}

const MIN_FNGEN_VRAM_MB = 12288;

/** Pure (VRAM, RAM) -> tier. Probe failure (vram undefined) lands on
 *  below-12gb with the no-GPU message - honesty, never optimism.
 *
 *  `unifiedMemory` says the model and the toolchain draw on ONE pool. One thing
 *  changes, and it is a refusal rather than an addition: the CUDA layer carve is
 *  never emitted, because a `num_gpu` cap means nothing on Metal. That was already
 *  true, but only by arithmetic accident (the Mac path reports vram == ram and the
 *  carve row needs vram BELOW its RAM bound), and an invariant this load-bearing
 *  should not depend on one.
 *
 *  What this does NOT do is size the model down for the toolchain. That was built
 *  and then refuted on the hardware; see TOOLCHAIN_RESERVE_MB. `vramMB` is the
 *  whole pool. */
export function computeTier(
  vramMB: number | undefined,
  ramMB: number | undefined,
  opts?: { unifiedMemory?: boolean },
): TierSelection {
  if (vramMB === undefined) {
    // A machine whose GPU cannot be seen is treated as a machine without
    // one: guessing a tier risks silent thrash or CPU spill, the exact
    // failures the carve exists to prevent.
    return {
      id: "below-12gb",
      fnGenEnabled: false,
      provisional: false,
      message:
        "Function generation is disabled: no usable GPU detected. It needs at least 12GB of VRAM. FIM tab-completion still works.",
    };
  }
  const ram = ramMB ?? 0;
  // The below-12gb row's zero bounds make the table total; find never misses.
  const row = TIER_TABLE.find((r) => r.minVramMB <= vramMB && r.minRamMB <= ram) as TierRow;
  // One message, because the number in it is the machine's real capacity on both
  // kinds of box. The unified-memory variant existed only while that figure was a
  // remainder a human could not have recognised as their machine.
  const message =
    row.fnGenModel === undefined
      ? `Function generation is disabled: this GPU has ${Math.floor(vramMB)}MB of VRAM and function generation needs at least ${MIN_FNGEN_VRAM_MB}MB. FIM tab-completion still works.`
      : undefined;
  const selection = selectionFromRow(row, message);
  if (opts?.unifiedMemory !== true) {
    return selection;
  }
  // Unified memory: strip the carve, and change nothing else. A layer cap tuned
  // for a 16GB CUDA card is not a thing to hand to Metal.
  const out: TierSelection = { ...selection };
  delete out.fnGenNumGpu;
  return out;
}

/** The [carve] tier evidence line, formatted in core so the format is
 *  headless-testable; the vscode layer only appends it. */
export function tierLogLine(
  sel: TierSelection,
  vramMB: number | undefined,
  ramMB: number | undefined,
  reason: "auto" | "override",
): string {
  // MB render as integers; a fractional input floors. Hardware reports
  // whole MB, so floor is identity on real probes.
  const mb = (v: number | undefined): string => (v === undefined ? "-" : String(Math.floor(v)));
  const numGpu = sel.fnGenNumGpu === undefined ? "-" : String(sel.fnGenNumGpu);
  const fnGen = sel.fnGenEnabled ? (sel.fnGenModel as string) : "disabled";
  return `[carve] tier=${sel.id} reason=${reason} vram=${mb(vramMB)} ram=${mb(ramMB)} numGpu=${numGpu} fnGen=${fnGen} provisional=${sel.provisional}`;
}

/** Fold a tier into an FnGenConfig: the tier decides the model and the
 *  carve. An explicitly configured model tag keeps the user's tag and drops
 *  the carve - a layer cap tuned for the 30b is wrong for any other model. */
export function applyTier(config: FnGenConfig, sel: TierSelection, explicitFnGenModel: boolean): FnGenConfig {
  if (!sel.fnGenEnabled) {
    // Disabling is command-level gating in the vscode layer, never config
    // surgery: a field-identical copy keeps user settings intact.
    return { ...config };
  }
  // A row tag equal to the default fallback resolves through the config's
  // fallbackModel, so a customized fnGenFallbackModel setting keeps working
  // on the low-RAM tier.
  const rowModel =
    sel.fnGenModel === DEFAULT_FNGEN_CONFIG.fallbackModel ? config.fallbackModel : (sel.fnGenModel as string);
  const model = explicitFnGenModel ? config.model : rowModel;
  // The carve value is tuned per model tag: it rides only on the row's
  // exact tag. Any other effective model gets no cap - letting ollama
  // schedule an unknown model is the only honest default.
  const carve = model === sel.fnGenModel ? sel.fnGenNumGpu : undefined;
  const out: FnGenConfig = { ...config, model };
  delete out.numGpu;
  if (carve !== undefined) {
    out.numGpu = carve;
  }
  // THE THINK FLAG RIDES THE ROW'S TAG, exactly as the carve does. A tier whose
  // model reasons by default carries `fnGenThink: false`; if the user has
  // overridden the model, the row's flag is about a model they are not running
  // and must not follow them to it. Reasoning is billed to maxTokens, so a
  // wrong value here is a model that thinks until its budget is gone.
  if (model === sel.fnGenModel && sel.fnGenThink !== undefined) {
    out.think = sel.fnGenThink;
  }
  return out;
}
