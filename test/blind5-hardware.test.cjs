// Blind oracle: hardware probe contract (phase5-surface.md "src/core/hardware.ts").
// parseNvidiaSmiVram over captured and adversarial stdout, probeHardware failure
// shapes through the injectable runner, the never-rejects contract, and the RAM
// probe. Written against the surface doc only; never read src/**. Expected red
// while stubs throw.
//
// Run: npm test

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "blind5-hardware",
  `export { parseNvidiaSmiVram, probeHardware } from "../src/core/hardware";\n`
);
const { parseNvidiaSmiVram, probeHardware } = mod;
test.after(cleanup);

const MB = 1048576; // surface: ramMB is Math.floor(totalMemBytes() / 1048576)

// ---- parseNvidiaSmiVram [surface: 'parseNvidiaSmiVram rules']

// Parameterized over the promised grammar: split on \n, strip trailing \r,
// trim, valid iff /^[0-9]+$/ and > 0, result is MAX over valid lines,
// zero valid lines -> undefined.
const PARSE_CASES = [
  ["single GPU, reference capture shape", "16303\n", 16303],
  ["single GPU, no trailing newline", "16303", 16303],
  ["CRLF line endings stripped", "16303\r\n", 16303],
  ["surrounding whitespace trimmed", "  24576  \n", 24576],
  ["multi-GPU: MAX over valid lines", "24576\n16303\n", 24576],
  ["multi-GPU: MAX regardless of order", "16303\n24576\n", 24576],
  ["multi-GPU CRLF", "16303\r\n24576\r\n", 24576],
  ["garbage line beside a valid line is skipped", "[N/A]\n16303\n", 16303],
  ["permission noise beside a valid line is skipped", "Insufficient Permissions\n16303\n", 16303],
  ["garbage only: [N/A]", "[N/A]\n", undefined],
  ["driver chatter only", "NVIDIA-SMI has failed because it couldn't communicate with the NVIDIA driver.\n", undefined],
  ["empty stdout", "", undefined],
  ["whitespace-only stdout", "   \n\n \r\n", undefined],
  ["zero is not a valid capacity (value must be > 0)", "0\n", undefined],
  ["negative fails the regex", "-16303\n", undefined],
  ["decimal fails the regex", "16303.5\n", undefined],
  ["units ride-along fails the regex", "16303 MiB\n", undefined],
  ["hex/embedded text fails the regex", "0x3fcf\nvram: 16303\n", undefined],
];

for (const [name, stdout, expected] of PARSE_CASES) {
  test(`parseNvidiaSmiVram: ${name} [surface: 'parseNvidiaSmiVram rules']`, () => {
    assert.strictEqual(parseNvidiaSmiVram(stdout), expected);
  });
}

test("parseNvidiaSmiVram never throws on adversarial stdout [surface: 'Garbage tolerance is a guarantee ... skipped, never thrown on']", () => {
  const adversarial = [
    "\u0000\u00ff\u0000", "null", "undefined", "NaN", "Infinity",
    "[N/A]\n[N/A]\n[N/A]", "memory.total [MiB]\n", "{\"vram\":16303}",
    "16303e2", "١٦٣٠٣", "\n".repeat(1000), "9".repeat(10000),
  ];
  for (const stdout of adversarial) {
    const out = parseNvidiaSmiVram(stdout); // must not throw
    assert.ok(out === undefined || (typeof out === "number" && out > 0), `returned number-or-undefined for ${JSON.stringify(stdout.slice(0, 20))}`);
  }
});

// ---- probeHardware [surface: 'probeHardware semantics - it never rejects']

// Injectable runner following the phase-4 RunCommandFn split the surface cites:
// rejects only when the binary could not be spawned; a run that happened
// resolves with its exit code.
function recordingRunner(result) {
  const calls = [];
  const run = (command, args) => {
    calls.push({ command, args });
    return result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
  };
  return { calls, run };
}

const memOf = (mb) => () => mb * MB;
const throwingMem = () => {
  throw new Error("totalmem unavailable");
};

// Force the discrete-GPU branch: the Apple-Silicon path short-circuits the
// injected nvidia runner on a Mac (darwin/arm64), so the injected platform pins
// the branch this file's runner fakes exercise.
const nvidiaPlatform = () => ({ platform: "linux", arch: "x64" });

test("probe command is exactly nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits [surface: 'The probe command is exactly...']", async () => {
  const { calls, run } = recordingRunner({ stdout: "16303\n", exitCode: 0 });
  await probeHardware({ runCommand: run, platformInfo: nvidiaPlatform, totalMemBytes: memOf(61826) });
  assert.strictEqual(calls.length, 1, "one probe spawn");
  assert.strictEqual(calls[0].command, "nvidia-smi");
  assert.deepStrictEqual(calls[0].args, ["--query-gpu=memory.total", "--format=csv,noheader,nounits"]);
});

test("success path: vramMB from the parser, no vramFailure, ramMB floored [surface: HardwareProbe + ramMB rule]", async () => {
  const { run } = recordingRunner({ stdout: "16303\n", exitCode: 0 });
  const probe = await probeHardware({ runCommand: run, platformInfo: nvidiaPlatform, totalMemBytes: () => 61826 * MB + MB - 1 });
  assert.strictEqual(probe.vramMB, 16303);
  assert.strictEqual(probe.vramFailure, undefined, "no failure reason on the success path");
  assert.strictEqual(probe.ramMB, 61826, "Math.floor(totalMemBytes() / 1048576), never rounded up");
});

test("multi-GPU stdout flows through the parser: MAX device wins [surface: 'the largest device is the honest capacity']", async () => {
  const { run } = recordingRunner({ stdout: "16303\n24576\n", exitCode: 0 });
  const probe = await probeHardware({ runCommand: run, platformInfo: nvidiaPlatform, totalMemBytes: memOf(61826) });
  assert.strictEqual(probe.vramMB, 24576);
});

test("runner rejection (nvidia-smi absent) resolves with vramFailure spawn-failed [surface: 'Runner rejects (ENOENT...)']", async () => {
  const { run } = recordingRunner(Object.assign(new Error("spawn nvidia-smi ENOENT"), { code: "ENOENT" }));
  const probe = await probeHardware({ runCommand: run, platformInfo: nvidiaPlatform, totalMemBytes: memOf(61826) });
  assert.strictEqual(probe.vramMB, undefined, "vramMB absent on probe failure");
  assert.strictEqual(probe.vramFailure, "spawn-failed");
  assert.strictEqual(probe.ramMB, 61826, "the RAM half still reports");
});

// Non-zero exits carry the literal code [surface: 'vramFailure: "exit-<code>" with the literal code'].
for (const code of [1, 2, 127]) {
  test(`exit code ${code} resolves with vramFailure exit-${code} [surface: 'Exit code non-zero (WSL without GPU passthrough...)']`, async () => {
    const { run } = recordingRunner({ stdout: "", exitCode: code });
    const probe = await probeHardware({ runCommand: run, platformInfo: nvidiaPlatform, totalMemBytes: memOf(61826) });
    assert.strictEqual(probe.vramMB, undefined);
    assert.strictEqual(probe.vramFailure, `exit-${code}`);
  });
}

test("exit 0 with unparseable stdout resolves with vramFailure unparseable [surface: 'Exit 0 but parseNvidiaSmiVram returns undefined']", async () => {
  const { run } = recordingRunner({ stdout: "[N/A]\n", exitCode: 0 });
  const probe = await probeHardware({ runCommand: run, platformInfo: nvidiaPlatform, totalMemBytes: memOf(61826) });
  assert.strictEqual(probe.vramMB, undefined);
  assert.strictEqual(probe.vramFailure, "unparseable");
});

test("throwing RAM source leaves ramMB absent; probe still resolves [surface: 'a throwing source leaves it absent (conservative...)']", async () => {
  const { run } = recordingRunner({ stdout: "16303\n", exitCode: 0 });
  const probe = await probeHardware({ runCommand: run, platformInfo: nvidiaPlatform, totalMemBytes: throwingMem });
  assert.strictEqual(probe.ramMB, undefined);
  assert.strictEqual(probe.vramMB, 16303, "the VRAM half still reports");
});

test("never-rejects contract holds even when BOTH sources fail [surface: 'it never rejects; a machine without a GPU is a supported tier, not an error']", async () => {
  const { run } = recordingRunner(new Error("ENOENT"));
  const probe = await probeHardware({ runCommand: run, platformInfo: nvidiaPlatform, totalMemBytes: throwingMem });
  assert.strictEqual(probe.vramMB, undefined);
  assert.strictEqual(probe.vramFailure, "spawn-failed");
  assert.strictEqual(probe.ramMB, undefined);
});

// ---- evidence [surface: 'Evidence, when a log fn is given' + '[carve] line formats']

test("evidence on success: exactly the probe line with final values [surface: 'then always [carve] probe vram=<mb|-> ram=<mb|->']", async () => {
  const { run } = recordingRunner({ stdout: "16303\n", exitCode: 0 });
  const lines = [];
  await probeHardware({ runCommand: run, platformInfo: nvidiaPlatform, totalMemBytes: memOf(61826), log: (l) => lines.push(l) });
  assert.deepStrictEqual(lines, ["[carve] probe vram=16303 ram=61826"]);
});

test("evidence on failure: failed line FIRST, then the probe line with dashes for absent [surface: 'on vram failure, [carve] probe failed: <reason> first']", async () => {
  const { run } = recordingRunner(new Error("ENOENT"));
  const lines = [];
  await probeHardware({ runCommand: run, platformInfo: nvidiaPlatform, totalMemBytes: memOf(61826), log: (l) => lines.push(l) });
  assert.deepStrictEqual(lines, ["[carve] probe failed: spawn-failed", "[carve] probe vram=- ram=61826"]);
});

test("evidence with both halves absent renders both dashes [surface: '(- for absent)']", async () => {
  const { run } = recordingRunner({ stdout: "", exitCode: 6 });
  const lines = [];
  await probeHardware({ runCommand: run, platformInfo: nvidiaPlatform, totalMemBytes: throwingMem, log: (l) => lines.push(l) });
  assert.deepStrictEqual(lines, ["[carve] probe failed: exit-6", "[carve] probe vram=- ram=-"]);
});

test("evidence for the unparseable shape names the reason [surface: '[carve] probe failed: <spawn-failed|exit-<code>|unparseable>']", async () => {
  const { run } = recordingRunner({ stdout: "garbage\n", exitCode: 0 });
  const lines = [];
  await probeHardware({ runCommand: run, platformInfo: nvidiaPlatform, totalMemBytes: memOf(32000), log: (l) => lines.push(l) });
  assert.deepStrictEqual(lines, ["[carve] probe failed: unparseable", "[carve] probe vram=- ram=32000"]);
});

// ---- default sources [surface: 'default: real child-process spawn' / 'default: os.totalmem']

test("probeHardware() with no options resolves on any machine and reports a coherent shape [surface: never-rejects + defaults]", async () => {
  const probe = await probeHardware(); // must not reject, GPU or not
  assert.ok(probe && typeof probe === "object");
  assert.ok(Number.isInteger(probe.ramMB) && probe.ramMB > 0, "default RAM source is os.totalmem, floored to whole MB");
  if (probe.vramMB !== undefined) {
    assert.ok(Number.isInteger(probe.vramMB) && probe.vramMB > 0, "a probed VRAM value is a positive integer MB");
    assert.strictEqual(probe.vramFailure, undefined);
  } else {
    assert.match(probe.vramFailure, /^(spawn-failed|exit-\d+|unparseable)$/, "failure reason is one of the three promised shapes");
  }
});
