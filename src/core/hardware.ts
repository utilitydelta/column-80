// Hardware probing for tier auto-select. Parsing is pure and the process
// spawn sits behind an injectable runner (the RunCommandFn discipline,
// compilerOracle.ts), so every failure shape - no GPU, nvidia-smi absent,
// WSL without passthrough, garbage output - is testable headless. Contract:
// docs/architecture/hardware-tiers.md.

import { spawn } from "child_process";
import * as os from "os";

export interface ProbeCommandResult {
  stdout: string;
  exitCode: number;
}

/** Rejects when the binary cannot be spawned at all (ENOENT); resolves with
 *  the exit code otherwise. Mirrors compilerOracle's RunCommandFn split
 *  between "could not run" and "ran and said no". */
export type ProbeCommandFn = (command: string, args: string[]) => Promise<ProbeCommandResult>;

/** What the toolchain needs while the model is resident, in MB, on a machine
 *  where the two come out of the SAME pool. REPORTED, never subtracted from the
 *  model's budget (session-v34 item 4, and see the refutation below).
 *
 *  The tier table's numbers are a discrete-GPU model, where VRAM is dedicated
 *  and the editor's memory is somebody else's problem. On unified memory that is
 *  false in the one direction that matters: this product runs a compiler check
 *  immediately after every generation, so the model and the toolchain are live at
 *  the same moment by design, not by accident.
 *
 *  Measured on the reference box with nothing building: rust-analyzer 4.6GB,
 *  VS Code 4.3GB, and cargo adds several more mid-build. The goal's own
 *  arithmetic is that a 36GB Mac has roughly 22GB actually available, which is
 *  this number: 36864 - 22528.
 *
 *  Flat rather than a fraction, because none of what it covers scales with the
 *  box. rust-analyzer's index and VS Code's renderer are the size of the PROJECT,
 *  not the size of the RAM, so a proportional reserve would under-provision the
 *  small box and over-provision the large one.
 *
 *  ONE box's measurement, and not a survey.
 *
 *  REFUTED AS A TIER INPUT, by the human, 2026-07-30, on the hardware. This was
 *  built subtracting the reserve from the capacity the tier table reads, which
 *  dropped a 16GB Mac from the dense 14b to FIM only. The human had already
 *  tested a 16GB Mac and it works. A live test on the machine outranks an
 *  arithmetic argument about it, so the subtraction is gone and the number is
 *  reported on the channel instead.
 *
 *  Worth keeping in view for whoever revisits this: `MIN_FNGEN_VRAM_MB` is 12288
 *  and a 16GB Mac reports about 16384, so ANY reserve above 4096 would have
 *  excluded it, and VS Code alone measured 4.3GB. That the machine works anyway is
 *  evidence the 12288 minimum is a discrete-GPU threshold that does not transfer
 *  to Metal, not evidence that the toolchain is free. Sizing anything off this
 *  constant needs a measurement ON Apple Silicon first. */
export const TOOLCHAIN_RESERVE_MB = 14336;

export interface HardwareProbe {
  /** Largest single GPU's total memory in MB,
   *  or the whole unified pool on Apple Silicon. NOT net of the toolchain
   *  reserve: it was, briefly, and a 16GB Mac lost function generation for it.
   *  Absent = the probe failed;
   *  computeTier treats that as the below-12GB honesty path, never a guess. */
  vramMB?: number;
  /** Why vramMB is absent: "spawn-failed" | "exit-<code>" | "unparseable" |
   *  "unified-mem-unreadable". */
  vramFailure?: string;
  /** Total system RAM in MB. Absent only when the injected source throws. The
   *  TRUE total, never net of the reserve: this is the system's RAM and the tier
   *  table's RAM bounds are written against the real figure. */
  ramMB?: number;
  /** True when the model and the toolchain draw on ONE pool (Apple Silicon).
   *
   *  What rides on it is one refusal: a `num_gpu` layer cap is a CUDA concept with
   *  no meaning on Metal, so the carve is never applied here. That was already
   *  true, but only by ACCIDENT - the Mac path reports vram == ram and the carve
   *  row needs vram BELOW its RAM bound. An invariant this load-bearing should not
   *  rest on an arithmetic coincidence, so it is now stated and pinned. It is a
   *  no-op today and it stays: the next person to change how vram is derived
   *  should not be able to put a CUDA carve on a Mac without a test going red. */
  unifiedMemory?: boolean;
}

export interface ProbeHardwareOptions {
  /** Default: real child-process spawn of nvidia-smi. */
  runCommand?: ProbeCommandFn;
  /** Default: os.totalmem. */
  totalMemBytes?: () => number;
  /** Default: process.platform / process.arch. Injected so the Apple-Silicon
   *  unified-memory path is testable on any host. */
  platformInfo?: () => { platform: string; arch: string };
  log?: (line: string) => void;
  /** Kill the DEFAULT probe spawn after this long (a wedged nvidia-smi
   *  must not wedge activation). The timeout rejects, which
   *  degrades through the existing taxonomy to spawn-failed and the
   *  below-12gb honesty path. Ignored when runCommand is injected - an
   *  injected runner owns its own patience. */
  timeoutMs?: number;
}

export const DEFAULT_PROBE_TIMEOUT_MS = 3000;

/** One nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits
 *  stdout to the largest GPU's MB, or undefined when no line parses. */
export function parseNvidiaSmiVram(stdout: string): number | undefined {
  let max: number | undefined;
  for (const raw of stdout.split("\n")) {
    const line = (raw.endsWith("\r") ? raw.slice(0, -1) : raw).trim();
    // Strict digit-only lines: [N/A], permission noise, units ride-alongs,
    // and driver chatter all fail here and are skipped, never thrown on.
    if (!/^[0-9]+$/.test(line)) {
      continue;
    }
    const value = Number(line);
    if (value <= 0) {
      continue;
    }
    // MAX over devices: both models target a single GPU, so the largest
    // device is the honest capacity on a multi-GPU box.
    if (max === undefined || value > max) {
      max = value;
    }
  }
  return max;
}

const BYTES_PER_MB = 1048576;

/** Whether the `ollama` CLI is on PATH. `ollama --version` runs WITHOUT the
 *  server, so it separates "not installed" (spawn rejects / non-zero exit) from
 *  "installed but not serving" (version succeeds; the server is a separate
 *  concern). Never throws — either failure reads as absent. Injectable runner so
 *  the not-installed branch is testable without touching the host. */
export async function ollamaInstalled(run: ProbeCommandFn): Promise<boolean> {
  try {
    const result = await run("ollama", ["--version"]);
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

/** Runner factory for the default probe spawn: rejects when the binary
 *  could not be spawned (the RunCommandFn split) OR when the child
 *  outlives timeoutMs, in which case it is SIGKILLed - a hung driver query
 *  must never wedge the caller. Exported so the kill behavior is unit-
 *  testable against a real hanging process. */
export function probeCommandRunner(timeoutMs: number): ProbeCommandFn {
  return (command, args) =>
    new Promise((resolve, reject) => {
      const child = spawn(command, args, { stdio: ["ignore", "pipe", "ignore"] });
      let stdout = "";
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          // SIGKILL, not SIGTERM: a wedged nvidia-smi is exactly the child
          // that ignores polite signals.
          child.kill("SIGKILL");
          reject(new Error(`probe timed out after ${timeoutMs}ms`));
        }
      }, timeoutMs);
      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
      });
      child.on("error", (err) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(err);
        }
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (!settled) {
          settled = true;
          resolve({ stdout, exitCode: code ?? -1 });
        }
      });
    });
}

/** Whether this machine is Apple Silicon, seen THROUGH Rosetta. `process.arch`
 *  is the process's arch, not the hardware's: an arm64 Mac running the x64 build
 *  of VS Code under Rosetta 2 - the common shape on MDM-managed corporate Macs -
 *  reports `arch === "x64"`, and the naive `arch === "arm64"` test then skips the
 *  Mac path, spawns a nvidia-smi that exists on no Mac, and drops a 32GB M-series
 *  box to the no-GPU below-12gb tier with function generation disabled. The
 *  physical CPU is what `hw.optional.arm64` reports (=1 on every Apple Silicon
 *  machine, absent -> non-zero exit on a real Intel Mac), and it SURVIVES
 *  translation, so it distinguishes "M-series under Rosetta" (fixable) from a
 *  genuine Intel Mac (honestly below-12gb). Runs through the same injectable
 *  runner as the nvidia probe, so the Rosetta path is headless-testable; a real
 *  Intel Mac still falls through to the nvidia spawn and its spawn-failed tier. */
async function isAppleSilicon(platform: string, arch: string, runCommand: ProbeCommandFn): Promise<boolean> {
  if (platform !== "darwin") {
    return false;
  }
  if (arch === "arm64") {
    return true;
  }
  try {
    const result = await runCommand("sysctl", ["-n", "hw.optional.arm64"]);
    return result.exitCode === 0 && result.stdout.trim() === "1";
  } catch {
    // sysctl unspawnable is not a state a Mac is in; treat it as "cannot prove
    // Apple Silicon" and let the nvidia path render the honest tier.
    return false;
  }
}

/** Never rejects: every failure lands as an absent field plus a reason,
 *  because a machine without a GPU is a supported tier, not an error. */
export async function probeHardware(opts?: ProbeHardwareOptions): Promise<HardwareProbe> {
  const runCommand = opts?.runCommand ?? probeCommandRunner(opts?.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS);
  const totalMemBytes = opts?.totalMemBytes ?? os.totalmem;
  const platformInfo = opts?.platformInfo ?? (() => ({ platform: process.platform as string, arch: process.arch as string }));
  const { platform, arch } = platformInfo();
  // Apple Silicon has no discrete GPU and no nvidia-smi: the UNIFIED memory pool is
  // the model budget (Ollama serves via Metal from system RAM). Read it as the
  // capacity so tier auto-select enables function generation instead of falling to
  // the no-GPU honesty path.
  //
  // NET OF THE TOOLCHAIN (session-v34 item 4). What the model may have is what is
  // LEFT, not what exists: rust-analyzer and VS Code are resident the whole time
  // and cargo joins them immediately after every generation, out of the same pool.
  // Reporting the full total is what made the tier table promise memory the
  // compiler check then could not get.
  //
  // Deliberately NOT a toast telling the human to raise `iogpu.wired_limit_mb`.
  // Raising it lets the GPU wire memory the toolchain then cannot get, which
  // trades rust-analyzer responsiveness for model residency, and this product
  // needs both at once. It is a benchmarking knob, not a recommendation.
  const appleSilicon = await isAppleSilicon(platform, arch, runCommand);

  let vramMB: number | undefined;
  let vramFailure: string | undefined;
  let unifiedTotalMB: number | undefined;
  if (appleSilicon) {
    try {
      unifiedTotalMB = Math.floor(totalMemBytes() / BYTES_PER_MB);
      vramMB = unifiedTotalMB;
    } catch {
      vramFailure = "unified-mem-unreadable";
    }
  } else {
    try {
      const result = await runCommand("nvidia-smi", [
        "--query-gpu=memory.total",
        "--format=csv,noheader,nounits",
      ]);
      if (result.exitCode !== 0) {
        vramFailure = `exit-${result.exitCode}`;
      } else {
        vramMB = parseNvidiaSmiVram(result.stdout);
        if (vramMB === undefined) {
          vramFailure = "unparseable";
        }
      }
    } catch {
      vramFailure = "spawn-failed";
    }
  }

  let ramMB: number | undefined;
  try {
    ramMB = Math.floor(totalMemBytes() / BYTES_PER_MB);
  } catch {
    // Absent RAM is conservative: computeTier treats it as 0, which lands
    // low-RAM, never large-RAM.
    ramMB = undefined;
  }

  if (opts?.log) {
    if (vramFailure !== undefined) {
      opts.log(`[carve] probe failed: ${vramFailure}`);
    }
    opts.log(
      appleSilicon
        ? // Says so ONCE. `unified-mem` is what the tier is chosen on; the headroom
          // figure sits beside it as INFORMATION and is named differently on
          // purpose, so nobody reads the second number as the budget.
          `[carve] probe apple-silicon unified-mem=${unifiedTotalMB ?? "-"} ram=${ramMB ?? "-"} ` +
            `toolchain-headroom-estimate=${Math.max(0, (unifiedTotalMB ?? 0) - TOOLCHAIN_RESERVE_MB)} ` +
            `(the model shares this pool with rust-analyzer, VS Code and cargo; that estimate is ` +
            `reported, never budgeted)`
        : `[carve] probe vram=${vramMB ?? "-"} ram=${ramMB ?? "-"}`,
    );
  }

  // Absent fields are key-absent, not value-undefined: deepStrictEqual
  // distinguishes the two, so the shape is pinned here.
  return {
    ...(vramMB !== undefined ? { vramMB } : {}),
    ...(vramFailure !== undefined ? { vramFailure } : {}),
    ...(ramMB !== undefined ? { ramMB } : {}),
    ...(appleSilicon ? { unifiedMemory: true } : {}),
  };
}
