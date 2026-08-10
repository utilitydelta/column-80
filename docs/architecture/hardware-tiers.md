# Hardware tiers and the VRAM carve

Serves product invariant 5 and the never-auto-pull and fail-closed gating invariants in [ARCHITECTURE.md](../../ARCHITECTURE.md). The carve is the feature: co-residency of both models on a 16GB card does not happen by default, it is computed.

Files: `src/core/hardware.ts` (probe), `src/core/tiers.ts` (table, `computeTier`, `applyTier`), `src/core/ollama.ts` (`pullModel`, `PullProgress`). Flow and UI: `src/vscode/firstRun.ts`, covered in [vscode-layer](vscode-layer.md).

## Why the carve exists

On 16GB, default ollama scheduling thrashes a FIM/fn-gen alternation with 2-4.6s reloads per model swap, and `OLLAMA_MAX_LOADED_MODELS=2` alone does not fix it. Over-allocating the 30b is worse: it silently pushes the FIM model to CPU, which looks like it works while destroying the latency bar. The answer is to cap the 30b's GPU layers explicitly so the 1.5b sits 100% on GPU.

Reference config, spike-proven: 30b at `num_gpu=30` (11.6GB of a 19.2GB model on GPU, ~7.6GB CPU-resident) beside the fully resident 1.5b. Result: FIM holds 102-109ms TTFT during alternation, the 30b holds 34.6 tok/s, zero evictions. That constant lives once, as `REFERENCE_CARVE_NUM_GPU` in `src/core/config.ts`, consumed by the tier table row, so the value the live suite proves and the value the tier computes cannot drift apart.

## Probe

`probeHardware` runs exactly `nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits` behind an injectable runner, plus `os.totalmem` for RAM. It never rejects; a machine without a GPU is a supported tier, not an error. Failure taxonomy: spawn-failed (no driver, non-NVIDIA), exit-code (WSL without passthrough), unparseable. Parsing takes the max over digit-only lines (multi-GPU boxes report one line per device; both models target one GPU) and skips garbage. A wedged nvidia-smi is SIGKILLed after 3000ms and degrades through spawn-failed, so activation never hangs.

Named absence: the probe reads total VRAM, never free. A contended card (game or another LLM holding half of the 16GB) still gets the reference carve sized for an empty card, and ollama then degrades exactly the way the carve exists to prevent, with no extension evidence. Total-only is the v1 ship; free-VRAM checking is an open product call.

## The tier table

Data, not code: `computeTier` walks `TIER_TABLE` in order, first row whose inclusive MB minimums both hold wins. Bounds sit below nominal sizes because hardware reports under nominal (a 16GB card reports 16303 MiB; a 64GB box ~61826 MB).

| id | minVramMB | minRamMB | fn-gen | carve |
|---|---|---|---|---|
| `24gb` | 20480 | 0 | 30b | none (full offload); provisional, never validated on real hardware |
| `16gb-large-ram` | 15360 | 28672 | 30b | `num_gpu=30`, the reference config, the only spike-proven row |
| `16gb-low-ram` | 12288 | 0 | dense 14b (~9GB) | none needed; both models fit resident. Doubles as the 12-16GB band |
| `below-12gb` | 0 | 0 | disabled, honest message | FIM only |

`minRamMB` 28672 is a chosen default, not a measurement: the carved 30b keeps ~7.6GB CPU-resident, which a nominal-16GB-RAM box cannot spare beside an IDE and a nominal-32GB box clears. Tuning it is a data edit, not a logic change. The FIM model is not tier data; every tier runs the same FIM path.

A failed probe selects `below-12gb`. Honesty, never optimism: a machine whose GPU cannot be seen is treated as a machine without one, because guessing risks silent thrash or CPU spill. Non-NVIDIA, non-Apple boxes land here; the manual `hardwareTier` override is the workaround.

Apple Silicon is a probe of its own: there is no nvidia-smi and no discrete GPU, so the UNIFIED memory pool (`os.totalmem`) is read as the model budget and the machine gets a real tier instead of the no-GPU path. `process.arch` cannot gate this, because it reports the PROCESS arch, not the hardware's: an arm64 Mac running the x64 build of VS Code under Rosetta 2 (the common MDM-managed shape) reports `x64`, which used to skip the Mac path and drop a 32GB M-series box to `below-12gb` with function generation disabled. `isAppleSilicon` sees through that with `sysctl -n hw.optional.arm64` (=1 on every Apple Silicon machine, absent on a real Intel Mac, and it survives translation), run through the same injectable runner as the nvidia probe. A genuine Intel Mac still falls through to the nvidia spawn and its honest `below-12gb`.

## applyTier, the config seam

`applyTier(config, selection, explicitFnGenModel)` folds a tier into an `FnGenConfig`, pure, fresh copy. Rules: a disabled tier returns the config untouched (disabling is command-level gating, never config surgery); an explicitly user-set model tag wins and drops the carve, because `num_gpu=30` is tuned for the 30b's layer count and riding it on a foreign tag would be a silent mis-carve; the low-RAM row's tag resolves through the `fnGenFallbackModel` setting so customization keeps working. The vscode fn-gen rebuild path composes config through this function on every tier or settings change; `numGpu` is deliberately not a user setting.

## Fail-closed gating

Every model-call entry point (`generateFunction`, the fn-gen accept hook, the FIM accept hook) consults the tier gate. Unresolved tier (the flow failed) and disabled tier both close it: generation shows the honest message and makes no model call; the post-accept oracle still checks and surfaces but starts its repair session disabled, with the gate-close reason on the record before any round could start.

## Ratified pulls

`pullModel` streams `/api/pull` with layer-aggregated progress (`PullProgress` is clamped and high-watermarked so a bar never runs backwards). The contract around it is the invariant: `offerModelPull` in `firstRun.ts` is the sole caller, its only triggers are the first-run flow and the explicit Select Hardware Tier command, and the `[carve] pull ratified` line lands before the request starts. Activation never pulls, tier selection never pulls, a settings change never pulls. Declining a download changes nothing and leaves the extension explicit about what stays disabled and the one gesture that fixes it. No test anywhere pulls a real model.

First-run flow: probe, `computeTier`, QuickPick with the computed tier preselected and honest descriptions (the 24gb item says provisional), then per-missing-model ratified download offers. Accepting the computed default keeps `hardwareTier: "auto"` so a hardware change re-adapts; an explicit pick persists the tier id.

## Decisions

**ADR: fail-closed tier gates.**
Context: a tier flow can fail (server down, probe hang, thrown flow) after activation, leaving the extension without a resolved tier; the tempting default is to fall back to the settings' model tags and let ollama sort it out.
Decision: no resolved tier means no model call, anywhere. Both the unresolved and disabled states close the same gate, each with an honest message and evidence, and repair sessions start disabled behind a closed gate.
Consequence: a broken flow degrades to FIM-only visibility, never to a silent mis-carve or a surprise 19GB model load. The cost, a user with working hardware blocked by a transient flow failure, is bounded by the named recovery gesture (Select Hardware Tier).
