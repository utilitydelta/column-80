// Blind oracle: tier table + computeTier + tierLogLine (phase5-surface.md
// "The tier table, as data" + "computeTier and the honesty path" + "Evidence:
// [carve] line formats"). Boundary values at every threshold, the probe-failure
// honesty path with byte-exact messages, and the tier evidence line format.
// Written against the surface doc only; never read src/**. Expected red while
// stubs throw.
//
// Run: npm test

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "blind5-tiers",
  `export { TIER_TABLE, computeTier, tierLogLine } from "../src/core/tiers";
export { REFERENCE_CARVE_NUM_GPU } from "../src/core/config";\n`
);
const { TIER_TABLE, computeTier, tierLogLine, REFERENCE_CARVE_NUM_GPU } = mod;
test.after(cleanup);

const MODEL_30B = "qwen3-coder:30b";
const MODEL_14B = "qwen2.5-coder:14b-instruct-q4_K_M";

// Byte-exact per surface: 'message is present exactly when fn-gen is disabled, byte-exact'.
const NO_GPU_MSG =
  "Function generation is disabled: no usable GPU detected. It needs at least 12GB of VRAM. FIM tab-completion still works.";
const lowVramMsg = (mb) =>
  `Function generation is disabled: this GPU has ${mb}MB of VRAM and function generation needs at least 12288MB. FIM tab-completion still works.`;

// ---- TIER_TABLE as data [surface: 'The tier table, as data']

test("TIER_TABLE is exactly the four documented rows, in exactly this order [surface: tier table, row for row]", () => {
  assert.ok(Array.isArray(TIER_TABLE));
  assert.strictEqual(TIER_TABLE.length, 4, "four tiers, no invented fifth");
  assert.deepStrictEqual(
    TIER_TABLE.map((r) => r.id),
    ["24gb", "16gb-large-ram", "16gb-low-ram", "below-12gb"],
    "row order is the checking order; first match wins"
  );

  const [t24, tLarge, tLow, tBelow] = TIER_TABLE;

  assert.strictEqual(t24.minVramMB, 20480);
  assert.strictEqual(t24.minRamMB, 0);
  assert.strictEqual(t24.fnGenModel, MODEL_30B);
  assert.strictEqual(t24.fnGenNumGpu, undefined, "24gb: full offload, no carve");
  assert.strictEqual(t24.provisional, true, "24gb has never run on a 3090; the flag says so honestly");

  assert.strictEqual(tLarge.minVramMB, 15360);
  assert.strictEqual(tLarge.minRamMB, 28672);
  assert.strictEqual(tLarge.fnGenModel, MODEL_30B);
  assert.strictEqual(tLarge.fnGenNumGpu, 30, "the reference carve, the only spike-proven row");
  assert.strictEqual(tLarge.provisional, false);

  assert.strictEqual(tLow.minVramMB, 12288);
  assert.strictEqual(tLow.minRamMB, 0);
  assert.strictEqual(tLow.fnGenModel, MODEL_14B);
  assert.strictEqual(tLow.fnGenNumGpu, undefined, "dense 14b + 1.5b both fit; no carve needed");
  assert.strictEqual(tLow.provisional, false);

  assert.strictEqual(tBelow.minVramMB, 0);
  assert.strictEqual(tBelow.minRamMB, 0);
  assert.strictEqual(tBelow.fnGenModel, undefined, "fn-gen disabled on the fallback row");
  assert.strictEqual(tBelow.fnGenNumGpu, undefined);
  assert.strictEqual(tBelow.provisional, false);
});

test("the reference row's carve IS REFERENCE_CARVE_NUM_GPU [surface: 'the constant proven by the live suite and the value the tier computes are the same symbol, so they cannot drift apart']", () => {
  assert.strictEqual(REFERENCE_CARVE_NUM_GPU, 30);
  assert.strictEqual(TIER_TABLE[1].fnGenNumGpu, REFERENCE_CARVE_NUM_GPU);
});

// ---- computeTier over the (vram, ram) grid [surface: 'Decision rules' 1-2]

// Boundaries at every threshold: 20480, 15360, 28672, 12288 MB, exact edge and
// one MB under, plus the surface's captured real-hardware values (16303 / 61826).
const GRID = [
  // [vramMB, ramMB, expected id, why]
  [20480, 0, "24gb", "24gb edge: minVramMB inclusive, minRamMB 0 ignores RAM"],
  [20480, undefined, "24gb", "24gb edge with absent RAM: (ramMB ?? 0) still clears minRamMB 0"],
  [24576, 61826, "24gb", "nominal 24GB card"],
  [20479, 61826, "16gb-large-ram", "one MB under the 24gb bound falls through to the next row"],
  [16303, 61826, "16gb-large-ram", "THE reference box: 16GB card reports 16303, 64GB box reports 61826"],
  [15360, 28672, "16gb-large-ram", "both large-ram bounds exactly inclusive"],
  [15360, 28671, "16gb-low-ram", "RAM one MB under 28672 drops the carve row"],
  [15359, 61826, "16gb-low-ram", "VRAM one MB under 15360 drops the carve row despite huge RAM"],
  [16303, 15900, "16gb-low-ram", "nominal-16GB-RAM box (~15.9GB reported) cannot spare the 30b's CPU residue"],
  [16303, undefined, "16gb-low-ram", "absent RAM treated as 0: lands low-RAM, never large-RAM"],
  [12288, 61826, "16gb-low-ram", "low-ram edge: 12GB card gets working fn-gen via the dense 14b"],
  [12288, undefined, "16gb-low-ram", "low-ram edge with absent RAM"],
  [12287, 61826, "below-12gb", "one MB under 12288 disables fn-gen no matter the RAM"],
  [8192, 61826, "below-12gb", "8GB card"],
  [1, undefined, "below-12gb", "tiny but seen GPU still lands the total fallback"],
  [0, 61826, "below-12gb", "zero VRAM as a number takes the table path, not the probe-failed path"],
];

for (const [vram, ram, expected, why] of GRID) {
  test(`computeTier(${vram}, ${ram}) -> ${expected} (${why}) [surface: 'the first TIER_TABLE row with minVramMB <= vramMB and minRamMB <= (ramMB ?? 0) wins']`, () => {
    assert.strictEqual(computeTier(vram, ram).id, expected);
  });
}

test("computeTier is pure and deterministic [surface: 'Pure, deterministic, total']", () => {
  assert.deepStrictEqual(computeTier(16303, 61826), computeTier(16303, 61826));
  assert.deepStrictEqual(computeTier(undefined, undefined), computeTier(undefined, undefined));
});

// ---- selection field copying [surface: 'Decision rules' 3]

test("24gb selection copies the row: enabled, 30b, no carve, provisional true [surface: 'fnGenModel/fnGenNumGpu/provisional copy the row']", () => {
  const sel = computeTier(24576, 61826);
  assert.strictEqual(sel.id, "24gb");
  assert.strictEqual(sel.fnGenEnabled, true);
  assert.strictEqual(sel.fnGenModel, MODEL_30B);
  assert.strictEqual(sel.fnGenNumGpu, undefined);
  assert.strictEqual(sel.provisional, true);
  assert.strictEqual(sel.message, undefined, "message present iff fnGenEnabled is false");
});

test("16gb-large-ram selection carries the carve [surface: tier table row 2]", () => {
  const sel = computeTier(16303, 61826);
  assert.strictEqual(sel.fnGenEnabled, true);
  assert.strictEqual(sel.fnGenModel, MODEL_30B);
  assert.strictEqual(sel.fnGenNumGpu, 30);
  assert.strictEqual(sel.provisional, false);
  assert.strictEqual(sel.message, undefined);
});

test("16gb-low-ram selection: dense 14b, no carve [surface: tier table row 3]", () => {
  const sel = computeTier(12288, 15900);
  assert.strictEqual(sel.fnGenEnabled, true);
  assert.strictEqual(sel.fnGenModel, MODEL_14B);
  assert.strictEqual(sel.fnGenNumGpu, undefined);
  assert.strictEqual(sel.provisional, false);
  assert.strictEqual(sel.message, undefined);
});

// ---- the honesty path [surface: 'Decision rules' 1 + 4]

test("probe failure (vram undefined) selects below-12gb even beside huge RAM, byte-exact no-GPU message [surface: 'Honesty, never optimism']", () => {
  for (const ram of [61826, 15900, 0, undefined]) {
    const sel = computeTier(undefined, ram);
    assert.strictEqual(sel.id, "below-12gb", `ram=${ram}: a machine whose GPU cannot be seen is a machine without one`);
    assert.strictEqual(sel.fnGenEnabled, false);
    assert.strictEqual(sel.fnGenModel, undefined);
    assert.strictEqual(sel.fnGenNumGpu, undefined);
    assert.strictEqual(sel.provisional, false);
    assert.strictEqual(sel.message, NO_GPU_MSG, "byte-exact per the surface");
  }
});

test("seen-but-small GPU gets the numeric message with the literal vramMB [surface: 'vram a number: Function generation is disabled: this GPU has <vramMB>MB...']", () => {
  for (const vram of [8192, 12287, 0]) {
    const sel = computeTier(vram, 61826);
    assert.strictEqual(sel.fnGenEnabled, false);
    assert.strictEqual(sel.message, lowVramMsg(vram), "byte-exact per the surface");
  }
});

test("message is present exactly when fn-gen is disabled, on every tier [surface: 'message?: string; present iff fnGenEnabled is false']", () => {
  const enabled = [computeTier(24576, 0), computeTier(16303, 61826), computeTier(13000, 0)];
  for (const sel of enabled) {
    assert.strictEqual(sel.fnGenEnabled, true);
    assert.strictEqual(sel.message, undefined);
  }
  const disabled = [computeTier(undefined, 61826), computeTier(4096, 61826)];
  for (const sel of disabled) {
    assert.strictEqual(sel.fnGenEnabled, false);
    assert.strictEqual(typeof sel.message, "string");
    assert.ok(sel.message.endsWith("FIM tab-completion still works."), "every disable message ends on the FIM reassurance");
  }
});

// ---- tierLogLine [surface: 'tierLogLine(sel, vramMB, ramMB, reason) returns the tier evidence line' + format list]

test("tierLogLine: reference auto-selection renders every field [surface: '[carve] tier=<id> reason=<auto|override> vram=<mb|-> ram=<mb|-> numGpu=<n|-> fnGen=<model|disabled> provisional=<true|false>']", () => {
  const sel = computeTier(16303, 61826);
  assert.strictEqual(
    tierLogLine(sel, 16303, 61826, "auto"),
    "[carve] tier=16gb-large-ram reason=auto vram=16303 ram=61826 numGpu=30 fnGen=qwen3-coder:30b provisional=false"
  );
});

test("tierLogLine: probe-failed honesty path renders vram=- numGpu=- fnGen=disabled [surface: format list, '- for absent' + 'fnGen=<model|disabled>']", () => {
  const sel = computeTier(undefined, 61826);
  assert.strictEqual(
    tierLogLine(sel, undefined, 61826, "auto"),
    "[carve] tier=below-12gb reason=auto vram=- ram=61826 numGpu=- fnGen=disabled provisional=false"
  );
});

test("tierLogLine: override reason with absent RAM [surface: 'reason=override means the hardwareTier setting supplied the tier']", () => {
  const sel = computeTier(24576, undefined);
  assert.strictEqual(
    tierLogLine(sel, 24576, undefined, "override"),
    "[carve] tier=24gb reason=override vram=24576 ram=- numGpu=- fnGen=qwen3-coder:30b provisional=true"
  );
});

test("tierLogLine: low-ram tier names the dense 14b with no carve [surface: format list]", () => {
  const sel = computeTier(12288, 15900);
  assert.strictEqual(
    tierLogLine(sel, 12288, 15900, "auto"),
    "[carve] tier=16gb-low-ram reason=auto vram=12288 ram=15900 numGpu=- fnGen=qwen2.5-coder:14b-instruct-q4_K_M provisional=false"
  );
});
