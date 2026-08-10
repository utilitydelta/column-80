// Implementer oracle for v8 Apple-Silicon support: probeHardware reads UNIFIED
// memory as the capacity on darwin/arm64 (no nvidia-smi), so tier auto-select
// enables function generation instead of the no-GPU path; and ollamaInstalled
// separates "not installed" from "not serving". Pure — platform, memory, and the
// spawn are all injected, so this runs headless on any host.
//
// Run: SKIP_LIVE=1 node --test test/impl-v8-apple-silicon.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-v8-apple-silicon",
  `export { probeHardware, ollamaInstalled, TOOLCHAIN_RESERVE_MB } from "../src/core/hardware";
export { computeTier } from "../src/core/tiers";\n`,
);
const { probeHardware, ollamaInstalled, computeTier, TOOLCHAIN_RESERVE_MB } = mod;
test.after(cleanup);

const MB = 1048576;
const mac = { platform: "darwin", arch: "arm64" };
const nvidiaShouldNotRun = () => {
  throw new Error("nvidia-smi must not be spawned on Apple Silicon");
};

// The v8 contract, RESTORED. session-v34 item 4 briefly made vramMB the pool
// minus a toolchain reserve; the human tested a 16GB Mac, it works, and the
// subtraction was reverted (docs/supersessions.md S11). What survives from item 4
// is the `unifiedMemory` flag and an explicit refusal of the CUDA carve.
test("Apple Silicon: unified memory becomes vramMB (no nvidia-smi), tier enables fn-gen with NO carve", async () => {
  const probe = await probeHardware({
    platformInfo: () => mac,
    runCommand: nvidiaShouldNotRun, // asserts the nvidia path is skipped
    totalMemBytes: () => 36864 * MB,
  });
  assert.strictEqual(probe.vramMB, 36864, "unified memory is read as the model-budget capacity, the WHOLE pool");
  assert.strictEqual(probe.ramMB, 36864, "ram is the same unified pool");
  assert.strictEqual(probe.unifiedMemory, true, "the probe says the two share one pool, which is what refuses the carve");
  assert.strictEqual(probe.vramFailure, undefined, "no probe failure on Apple Silicon");

  const sel = computeTier(probe.vramMB, probe.ramMB, { unifiedMemory: probe.unifiedMemory });
  assert.strictEqual(sel.id, "24gb", "36GB unified -> the big-model, no-carve tier");
  assert.strictEqual(sel.fnGenEnabled, true, "function generation is ENABLED (not the no-GPU path)");
  assert.strictEqual(sel.fnGenNumGpu, undefined, "no CUDA num_gpu carve on a Mac (Metal schedules itself)");
});

// The carve refusal is now EXPLICIT rather than an arithmetic accident, and this
// row is why it stays even though it is a no-op. A Mac reports vram == ram, and
// the carve row needs vram BELOW its RAM bound, so the carve is unreachable on a
// Mac by construction - today. Anyone who changes how vram is derived (item 4
// did, briefly) must not be able to put a CUDA layer cap on Metal without this
// going red.
test("Apple Silicon: the CUDA carve is refused on unified memory even when the numbers reach the carve row", async () => {
  // Constructed to reach the carve row directly: 18432 vram with 32768 ram is the
  // 16gb-large-ram row. A real Mac cannot present these today, which is precisely
  // what makes the refusal worth pinning rather than assuming.
  const unified = computeTier(18432, 32768, { unifiedMemory: true });
  assert.strictEqual(unified.id, "16gb-large-ram", "these numbers ARE the carve row");
  assert.strictEqual(unified.fnGenEnabled, true);
  assert.strictEqual(unified.fnGenNumGpu, undefined, "no num_gpu on Metal, refused explicitly");

  // The same numbers on a discrete box DO get the carve, which is what proves the
  // refusal is about unified memory and not about the numbers.
  const discrete = computeTier(18432, 32768);
  assert.strictEqual(discrete.id, "16gb-large-ram");
  assert.strictEqual(discrete.fnGenNumGpu, 30, "a discrete 18GB card at 32GB RAM keeps its layer cap");
});

// The toolchain reserve is REPORTED and never budgeted (S11). A human on a Mac
// gets the arithmetic on the channel; the tier does not get it as an input.
test("Apple Silicon: the toolchain headroom estimate is on the channel, and is not what the tier is chosen on", async () => {
  const lines = [];
  const probe = await probeHardware({
    platformInfo: () => mac,
    runCommand: nvidiaShouldNotRun,
    totalMemBytes: () => 36864 * MB,
    log: (l) => lines.push(l),
  });
  const line = lines.find((l) => /apple-silicon/.test(l));
  assert.ok(line, "the probe says so once");
  assert.match(line, /unified-mem=36864/, "the pool is reported as the pool");
  assert.match(line, new RegExp(`toolchain-headroom-estimate=${36864 - TOOLCHAIN_RESERVE_MB}`), "and the headroom beside it");
  assert.match(line, /reported, never budgeted/, "labelled so nobody reads the estimate as the budget");
  assert.strictEqual(probe.vramMB, 36864, "and the tier input is untouched by it");
});

// The 16GB row is the one the human settled with a live test. It gets the dense
// 14b, as it did before item 4 and as it does again (docs/supersessions.md S11).
test("Apple Silicon memory bands: 36GB -> 30b, 16GB -> the dense 14b, <12GB -> FIM only, all carve-free", async () => {
  const tierFor = async (gb) => {
    const probe = await probeHardware({ platformInfo: () => mac, runCommand: nvidiaShouldNotRun, totalMemBytes: () => gb * 1024 * MB });
    return computeTier(probe.vramMB, probe.ramMB, { unifiedMemory: probe.unifiedMemory });
  };
  const t36 = await tierFor(36);
  assert.strictEqual(t36.id, "24gb", "36GB unified -> the 30b");
  assert.strictEqual(t36.fnGenEnabled, true);
  assert.strictEqual(t36.fnGenNumGpu, undefined, "no carve");

  const t16 = await tierFor(16);
  assert.strictEqual(t16.id, "16gb-low-ram", "16GB unified -> the dense 14b, TESTED WORKING on the hardware");
  assert.strictEqual(t16.fnGenEnabled, true, "and fn-gen stays enabled: an arithmetic estimate does not outvote a live test");
  assert.strictEqual(t16.fnGenNumGpu, undefined, "no carve");

  const t8 = await tierFor(8);
  assert.strictEqual(t8.fnGenEnabled, false, "8GB -> FIM only");
});

test("Rosetta: an M-series Mac running the x64 VS Code (arch=x64) is still Apple Silicon via hw.optional.arm64", async () => {
  // The bug: process.arch reports the PROCESS arch, not the hardware's, so an
  // arm64 Mac under Rosetta 2 reports x64 and the naive arch===arm64 test
  // skipped the Mac path. hw.optional.arm64=1 reflects the physical CPU and
  // survives translation.
  const calls = [];
  const runCommand = async (command, args) => {
    calls.push(command);
    if (command === "sysctl") {
      return { stdout: "1\n", exitCode: 0 };
    }
    throw new Error(`nvidia-smi must not be spawned once hw.optional.arm64 proves Apple Silicon (saw ${command})`);
  };
  const probe = await probeHardware({
    platformInfo: () => ({ platform: "darwin", arch: "x64" }),
    runCommand,
    totalMemBytes: () => 36864 * MB,
  });
  assert.strictEqual(probe.vramMB, 36864, "unified memory read as capacity even under Rosetta");
  assert.strictEqual(probe.unifiedMemory, true, "Rosetta does not hide that this is one shared pool");
  assert.strictEqual(probe.vramFailure, undefined, "no probe failure: the Mac path was taken");
  assert.deepStrictEqual(calls, ["sysctl"], "sysctl proved the hardware; nvidia-smi was never spawned");

  const sel = computeTier(probe.vramMB, probe.ramMB, { unifiedMemory: probe.unifiedMemory });
  assert.strictEqual(sel.fnGenEnabled, true, "function generation ENABLED, not the no-GPU path the bug produced");
});

test("real Intel Mac (arch=x64, no hw.optional.arm64) honestly falls through to the nvidia path", async () => {
  // sysctl exits non-zero for the unknown oid on a genuine Intel Mac, so the
  // probe must NOT claim unified memory it cannot back - it lands on the
  // spawn-failed / below-12gb honesty path, unchanged.
  const runCommand = async (command) => {
    if (command === "sysctl") {
      return { stdout: "", exitCode: 1 }; // unknown oid on Intel
    }
    throw Object.assign(new Error("spawn nvidia-smi ENOENT"), { code: "ENOENT" });
  };
  const probe = await probeHardware({
    platformInfo: () => ({ platform: "darwin", arch: "x64" }),
    runCommand,
    totalMemBytes: () => 16384 * MB,
  });
  assert.strictEqual(probe.vramMB, undefined, "no unified-memory claim on a real Intel Mac");
  assert.strictEqual(probe.vramFailure, "spawn-failed", "falls through to the nvidia spawn and its failure taxonomy");
  const sel = computeTier(probe.vramMB, probe.ramMB);
  assert.strictEqual(sel.fnGenEnabled, false, "honest below-12gb: FIM only, fn-gen disabled");
});

test("non-Apple platforms are unchanged: linux still runs nvidia-smi", async () => {
  let ran = false;
  const probe = await probeHardware({
    platformInfo: () => ({ platform: "linux", arch: "x64" }),
    runCommand: async () => {
      ran = true;
      return { stdout: "24576\n", exitCode: 0 };
    },
    totalMemBytes: () => 32768 * MB,
  });
  assert.ok(ran, "nvidia-smi is spawned on non-Apple platforms");
  assert.strictEqual(probe.vramMB, 24576, "vram from the nvidia parser, not unified memory");
});

// ---- ollamaInstalled ------------------------------------------------------

test("ollamaInstalled: version exit 0 -> installed; ENOENT / non-zero -> not installed", async () => {
  assert.strictEqual(await ollamaInstalled(async () => ({ stdout: "ollama version 0.x", exitCode: 0 })), true);
  assert.strictEqual(
    await ollamaInstalled(async () => {
      throw Object.assign(new Error("spawn ollama ENOENT"), { code: "ENOENT" });
    }),
    false,
    "a spawn rejection (not on PATH) reads as not installed",
  );
  assert.strictEqual(await ollamaInstalled(async () => ({ stdout: "", exitCode: 127 })), false, "non-zero exit reads as not installed");
});
