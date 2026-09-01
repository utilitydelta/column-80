// Implementer oracle: the probe against REAL nvidia-smi output on the
// reference box, and the full auto-select chain probe -> computeTier ->
// applyTier landing the spike-proven reference carve. The blind set proves
// the contract over injected runners; this file proves the default path
// against the hardware the goal's numbers were measured on (RTX 5080
// reports 16303 MiB, 64GB box reports ~61826 MB).
//
// Run: npm test

const test = require("node:test");
const assert = require("node:assert");
const { spawnSync } = require("child_process");
const os = require("os");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl5-hardware",
  `export { parseNvidiaSmiVram, probeHardware, probeCommandRunner, DEFAULT_PROBE_TIMEOUT_MS } from "../src/core/hardware";
export { computeTier, applyTier, tierLogLine, TIER_TABLE } from "../src/core/tiers";
export { DEFAULT_FNGEN_CONFIG, REFERENCE_CARVE_NUM_GPU } from "../src/core/config";\n`
);
const {
  parseNvidiaSmiVram,
  probeHardware,
  probeCommandRunner,
  DEFAULT_PROBE_TIMEOUT_MS,
  computeTier,
  applyTier,
  tierLogLine,
  TIER_TABLE,
  DEFAULT_FNGEN_CONFIG,
  REFERENCE_CARVE_NUM_GPU,
} = mod;
test.after(cleanup);

// The same invocation probeHardware's default runner uses.
const real = spawnSync("nvidia-smi", ["--query-gpu=memory.total", "--format=csv,noheader,nounits"], {
  encoding: "utf8",
});
const NVIDIA_SMI_OK = real.error === undefined && real.status === 0;

test("real nvidia-smi stdout parses to the same vramMB the default probe reports", { skip: !NVIDIA_SMI_OK && "nvidia-smi unavailable" }, async () => {
  const parsed = parseNvidiaSmiVram(real.stdout);
  assert.ok(Number.isInteger(parsed) && parsed > 0, `real stdout parsed: ${JSON.stringify(real.stdout)}`);
  const probe = await probeHardware();
  assert.strictEqual(probe.vramMB, parsed, "default probe path and direct parse agree on the same box");
  assert.strictEqual(probe.vramFailure, undefined);
});

test("default RAM source agrees with os.totalmem, floored", async () => {
  const probe = await probeHardware({ runCommand: async () => ({ stdout: "16303\n", exitCode: 0 }) });
  assert.strictEqual(probe.ramMB, Math.floor(os.totalmem() / 1048576));
});

test("REFERENCE BOX chain: real probe -> computeTier -> applyTier lands the 16gb-large-ram carve (this suite runs on the reference box by design)", { skip: !NVIDIA_SMI_OK && "nvidia-smi unavailable" }, async () => {
  const probe = await probeHardware();
  const sel = computeTier(probe.vramMB, probe.ramMB);
  assert.strictEqual(sel.id, "16gb-large-ram", `reference box expected; probe was vram=${probe.vramMB} ram=${probe.ramMB}`);
  assert.strictEqual(sel.fnGenNumGpu, REFERENCE_CARVE_NUM_GPU);
  const cfg = applyTier({ ...DEFAULT_FNGEN_CONFIG }, sel, false);
  assert.strictEqual(cfg.model, "qwen3-coder:30b");
  assert.strictEqual(cfg.numGpu, 30, "the computed carve the editor path will run");
  assert.strictEqual(
    tierLogLine(sel, probe.vramMB, probe.ramMB, "auto"),
    `[carve] tier=16gb-large-ram reason=auto vram=${probe.vramMB} ram=${probe.ramMB} numGpu=30 fnGen=qwen3-coder:30b provisional=false`
  );
});

test("the constant and the table row are one symbol: no drift is representable", () => {
  assert.strictEqual(TIER_TABLE[1].fnGenNumGpu, REFERENCE_CARVE_NUM_GPU);
});

// ---- P5-F4: a wedged probe cannot wedge the feature

test("P5-F4: the timeout runner SIGKILLs a hanging child and rejects fast", async () => {
  const marker = `impl5-probe-timeout-${process.pid}`;
  const started = Date.now();
  await assert.rejects(
    probeCommandRunner(150)("bash", ["-c", `exec -a ${marker} sleep 30`]),
    /timed out after 150ms/,
    "the rejection names the timeout"
  );
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 2000, `rejected at ${elapsed}ms - the caller never waits out the hang`);
  // SIGKILL landed: the hanging child is gone, not orphaned.
  await new Promise((r) => setTimeout(r, 100));
  const survivors = spawnSync("pgrep", ["-f", marker], { encoding: "utf8" });
  assert.strictEqual(survivors.stdout.trim(), "", "the child was killed, not left behind");
});

test("P5-F4: a timed-out probe degrades through the existing taxonomy to the live below-12gb decision with [carve] evidence", async () => {
  // A 1ms budget times out any real spawn; on a box without nvidia-smi the
  // same runner rejects with ENOENT - either way the taxonomy answer is
  // spawn-failed and the tier decision stays live.
  const lines = [];
  const probe = await probeHardware({
    runCommand: probeCommandRunner(1),
    totalMemBytes: () => 61826 * 1048576,
    platformInfo: () => ({ platform: "linux", arch: "x64" }),
    log: (l) => lines.push(l),
  });
  assert.strictEqual(probe.vramMB, undefined);
  assert.strictEqual(probe.vramFailure, "spawn-failed");
  assert.deepStrictEqual(lines, [
    "[carve] probe failed: spawn-failed",
    "[carve] probe vram=- ram=61826",
  ]);
  const sel = computeTier(probe.vramMB, probe.ramMB);
  assert.strictEqual(sel.id, "below-12gb", "a wedged probe still yields a live, honest tier decision");
  assert.strictEqual(sel.fnGenEnabled, false);
});

test("P5-F4: the default probe budget exists and is finite", () => {
  assert.ok(Number.isInteger(DEFAULT_PROBE_TIMEOUT_MS) && DEFAULT_PROBE_TIMEOUT_MS > 0);
  assert.ok(DEFAULT_PROBE_TIMEOUT_MS <= 10000, "activation never waits more than seconds on a driver query");
});
