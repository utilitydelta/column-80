# Spike: FreeToken as the fn-gen runtime on the 16GB tier

1 November 2026. One-hour spike, RTX 5080 16GB, 60GB RAM. Throwaway harness, nothing in `src/` changed.

## Why

The 16GB tier runs `qwen3-coder:30b` under an explicit `num_gpu=30` layer cap so the 1.5b FIM model
stays 100% on GPU. Ollama splits by layer, so about 61% of the 30b sits on CPU. FreeToken
(UC Berkeley, Apache 2.0, `FlashML-org/FreeToken`, arXiv:2608.16157) splits by expert instead:
all experts live in host RAM, VRAM is an LRU cache of hot experts. That is exactly the shape of
the carve problem. The question was whether it is faster, and whether it can share the card with
Ollama's FIM model without pushing it off the GPU.

FreeToken is not an Ollama replacement for column-80. It serves chat APIs only (no `suffix`
infill), MoE models only, NVIDIA only. FIM stays on Ollama regardless.

## Setup

| | Baseline (shipped) | Candidate |
|---|---|---|
| Runtime | Ollama 0.30.11 | FreeToken nightly `0.2.1+gee43b2a11`, default `offload` strategy |
| Fn-gen model | `qwen3-coder:30b`, `num_gpu=30` | `nvidia/Qwen3.6-35B-A3B-NVFP4` (23.5GB) |
| FIM model | `qwen2.5-coder:1.5b-base` on Ollama | same, loaded first |
| Placement | 39%/61% CPU/GPU | `--moe-cache-auto` sized from VRAM left after FIM |

Harness, same wall-clock method on both sides:

- FIM: Rust word-frequency prefix plus suffix, 48 tokens, temperature 0, 30 warm samples.
- Fn-gen: "write `parse_duration(&str) -> Result<Duration, String>`", 512-token cap, temperature 0,
  seed 1, thinking off, 5 runs.
- Concurrency: FIM requests fired every 200ms while a fn-gen stream decodes, 3 streams.
- Determinism: sha256 of the 5 fn-gen outputs.

## Results

| | Ollama, qwen3-coder:30b | FreeToken, Qwen3.6-35B-A3B |
|---|---|---|
| Fn-gen decode | 42.5 tok/s (42.0-42.6) | **140.3 tok/s** (138.0-142.3) |
| Fn-gen TTFT p50 | 113 ms | 371 ms |
| FIM TTFT idle p50 / p90 | 103 / 106 ms | 111 / 116 ms |
| FIM TTFT during fn-gen p50 / p90 | 122 / 136 ms (n=97) | 123 / 132 ms (n=24) |
| Fn-gen decode while FIM fires | 41.2 tok/s | 139.4 tok/s |
| Distinct outputs, 5 runs at temp 0 | 1 | 1 |
| Output length | 472 tokens, finished | 512, hit the cap every run |
| VRAM used | carve | 14.9 of 16GB, FIM still 100% GPU |

Co-residency works. FreeToken sized its expert cache after Ollama had already claimed the FIM
model's VRAM, and FIM latency under load is the same on both runtimes. Same-machine determinism
held, so the worry that dynamic CPU/GPU expert placement makes outputs drift did not show up at
n=5. Cross-machine reproducibility is untested and is what the tool-confidence argument
actually needs.

The baseline itself runs at 42.5 tok/s, not the ~35 tok/s recorded in July.

## What this does not prove

1. **The 3.3x mixes runtime and model.** The same-model arm (`qwen3.6:35b-a3b-nvfp4` on Ollama)
   did not run: the pull needs Ollama newer than 0.30.11. Better Stack's same-model test on a 5090
   measured 2.25x, so the runtime likely carries most of it here. Unmeasured.
2. **Quality is unmeasured.** Nothing was compiled, nothing went through the repair loop. Qwen3.6
   is also wordier: it hit the 512 cap where the coder model stopped at 472. Faster tokens that
   need more of them is not a free win.
3. **TTFT is worse.** 371 ms against 113 ms on a short prompt. Real fn-gen prompts carry context
   blocks, so prefill cost needs its own measurement.

## Install cost

Five starts to a running server, on a box without a system CUDA toolkit:

1. FlashInfer JIT-compiles kernels on first use (`silu_and_mul` in every MoE forward), so FreeToken
   needs CUDA 13 `nvcc` at runtime. The nightly kernel-cache wheel covers FreeToken's own kernels,
   not FlashInfer's. `--attention-backend triton` does not avoid it.
2. NVIDIA's pip `nvidia-cuda-nvcc==13.0.*` pulled `nvidia-nvvm` and `nvidia-cuda-crt` at 13.4,
   which emit PTX 9.4 that the 13.0 `ptxas` rejects. Pin both to 13.0.
3. The pip runtime ships only `libcudart.so.13`. Linking needs an unversioned `libcudart.so` and a
   `lib64 -> lib` link under `CUDA_HOME`.

Working launch line after those fixes:

```
CUDA_HOME=$C PATH=$C/bin:$PATH LIBRARY_PATH=$C/lib \
  ft serve --model <Qwen3.6-35B-A3B-NVFP4 dir> --text-model-only
# C = <venv>/lib/python3.12/site-packages/nvidia/cu13
```

A column-80 user would hit every one of those. That lands squarely on the installs gate.

## Verdict

Worth pursuing, not shipping. Strongest fn-gen upgrade on the table for the 16GB tier, aye, but
confounded and quality-blind. Nothing changes before the 11 December gates.

Next, in order:

1. Upgrade Ollama, run the same-model arm. Separates runtime gain from model gain.
2. Put Qwen3.6-on-FreeToken in the 30-50 function benchmark table as its own column: compile and
   pass counts, repair delta, tokens per finished function.
3. Only if both hold: a `freetoken` fn-gen provider. The existing OpenAI-compatible path in
   `src/core/cloudInstruct.ts` already speaks the wire format, but it is labelled and gated as
   off-machine, so it needs its own local provider id, and the tier code needs to stop computing
   a `num_gpu` carve when FreeToken owns the big model.
