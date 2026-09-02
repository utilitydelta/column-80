/**
 * The recorder as a child process: `column80-capture` streaming 16kHz mono s16le PCM on stdout
 * from the press until stdin closes.
 *
 * Two timings the product reports come from here. `firstBufferMs` is press-to-first-buffer,
 * the number the recording indicator waits for (ruling 1: the indicator turns on when the
 * first audio buffer arrives, not when the command fires). And `stop` keeps the tail the child
 * writes after stdin closes, so the last word of a take is never the one lost.
 */
import { spawn, type ChildProcess } from "node:child_process";

export interface CaptureDevice {
  name: string;
  default: boolean;
}

export type CaptureFailure = "binary-missing" | "no-device" | "device-denied" | "failed";

const EXIT_NO_DEVICE = 2;
const EXIT_DEVICE_DENIED = 3;
const EXIT_DEVICE_NOT_FOUND = 5;
const STOP_GRACE_MS = 3000;

function isEnoent(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as NodeJS.ErrnoException).code === "ENOENT";
}

export function classifyCaptureExit(
  exitCode: number | null,
  spawnError?: NodeJS.ErrnoException,
): CaptureFailure | undefined {
  if (spawnError !== undefined && isEnoent(spawnError)) {
    return "binary-missing";
  }
  if (spawnError !== undefined) {
    return "failed";
  }
  if (exitCode === 0 || exitCode === null) {
    return undefined;
  }
  if (exitCode === EXIT_NO_DEVICE || exitCode === EXIT_DEVICE_NOT_FOUND) {
    return "no-device";
  }
  if (exitCode === EXIT_DEVICE_DENIED) {
    return "device-denied";
  }
  return "failed";
}

export function listCaptureDevices(binary: string): Promise<CaptureDevice[]> {
  return new Promise((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = spawn(binary, ["--list"], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    } catch (err) {
      reject(new Error(`binary-missing: ${binary}`));
      return;
    }
    const out: Buffer[] = [];
    const errOut: Buffer[] = [];
    child.stdout?.on("data", (d: Buffer) => out.push(d));
    child.stderr?.on("data", (d: Buffer) => errOut.push(d));
    child.once("error", (err) => {
      reject(new Error(isEnoent(err) ? `binary-missing: ${binary}` : `${binary} --list failed: ${err.message}`));
    });
    child.once("exit", (code) => {
      if (code === EXIT_NO_DEVICE) {
        resolve([]);
        return;
      }
      const text = Buffer.concat(out).toString("utf8").trim();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        reject(new Error(`${binary} --list wrote something other than a device list (exit ${code}): ${Buffer.concat(errOut).toString("utf8").trim() || text}`));
        return;
      }
      if (!Array.isArray(parsed)) {
        reject(new Error(`${binary} --list did not answer with an array`));
        return;
      }
      resolve(
        parsed
          .filter((d): d is { name: unknown; default?: unknown } => typeof d === "object" && d !== null && typeof (d as { name?: unknown }).name === "string")
          .map((d) => ({ name: d.name as string, default: d.default === true })),
      );
    });
  });
}

export interface TakeHooks {
  onFirstBuffer?: (msSincePress: number) => void;
  onChunk?: (pcmBytesSoFar: number) => void;
  /** The child ended on its own, before `stop` was called: a device that
   *  vanished mid-take, or a binary that refused to open. Not fired for an
   *  exit that `stop` or `abort` asked for. */
  onExit?: (result: TakeResult) => void;
}

export interface TakeResult {
  pcm: Buffer;
  exitCode: number | null;
  stderr: string;
}

export class CaptureTake {
  readonly startedAt: number;
  private readonly chunks: Buffer[] = [];
  private bytes = 0;
  private first: number | undefined;
  private readonly stderrChunks: Buffer[] = [];
  private child: ChildProcess | undefined;
  private spawnError: NodeJS.ErrnoException | undefined;
  private exit: { code: number | null } | undefined;
  private readonly exited: Promise<number | null>;
  private stopping: Promise<TakeResult> | undefined;
  private aborted = false;

  private constructor(binary: string, device: string | undefined, private readonly hooks: TakeHooks) {
    this.startedAt = Date.now();
    const args = device !== undefined && device !== "" ? ["--device", device] : [];
    this.exited = new Promise<number | null>((resolve) => {
      let child: ChildProcess;
      try {
        child = spawn(binary, args, { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
      } catch (err) {
        this.spawnError = err as NodeJS.ErrnoException;
        this.exit = { code: null };
        resolve(null);
        return;
      }
      this.child = child;
      child.stdout?.on("data", (d: Buffer) => {
        // The bytes land BEFORE any hook runs, and a hook that throws costs its caller, not
        // the take (a UI hook blew up in review and took the first 640 bytes with it).
        this.chunks.push(d);
        this.bytes += d.byteLength;
        if (this.first === undefined) {
          this.first = Date.now() - this.startedAt;
          try {
            this.hooks.onFirstBuffer?.(this.first);
          } catch {
            // The hook's own problem.
          }
        }
        try {
          this.hooks.onChunk?.(this.bytes);
        } catch {
          // Likewise.
        }
      });
      child.stderr?.on("data", (d: Buffer) => this.stderrChunks.push(d));
      child.stdin?.on("error", () => undefined);
      child.once("error", (err) => {
        this.spawnError = err as NodeJS.ErrnoException;
        if (this.exit === undefined) {
          this.exit = { code: null };
          resolve(null);
          if (this.stopping === undefined && !this.aborted) {
            setImmediate(() => this.fireExit({ pcm: this.pcm, exitCode: null, stderr: this.stderr }));
          }
        }
      });
      child.once("exit", (code) => {
        if (this.exit === undefined) {
          this.exit = { code };
          resolve(code);
          if (this.stopping === undefined && !this.aborted) {
            setImmediate(() => this.fireExit({ pcm: this.pcm, exitCode: code, stderr: this.stderr }));
          }
        }
      });
    });
  }

  private fireExit(result: TakeResult): void {
    try {
      this.hooks.onExit?.(result);
    } catch {
      // The hook's own problem.
    }
  }

  static start(binary: string, device: string | undefined, hooks: TakeHooks = {}): CaptureTake {
    return new CaptureTake(binary, device, hooks);
  }

  get pcm(): Buffer {
    return Buffer.concat(this.chunks);
  }

  get firstBufferMs(): number | undefined {
    return this.first;
  }

  get failure(): CaptureFailure | undefined {
    return this.exit === undefined ? undefined : classifyCaptureExit(this.exit.code, this.spawnError);
  }

  get stderr(): string {
    const text = Buffer.concat(this.stderrChunks).toString("utf8").trim();
    return this.spawnError !== undefined && text === "" ? this.spawnError.message : text;
  }

  stop(): Promise<TakeResult> {
    if (this.stopping !== undefined) {
      return this.stopping;
    }
    this.stopping = (async () => {
      const child = this.child;
      if (child !== undefined && this.exit === undefined) {
        child.stdin?.end();
        const timer = setTimeout(() => {
          if (this.exit === undefined) {
            child.kill("SIGKILL");
          }
        }, STOP_GRACE_MS);
        await this.exited;
        clearTimeout(timer);
      } else {
        await this.exited;
      }
      // The stdout stream can still hold a chunk that arrives after `exit`; a turn of the loop
      // lets it land before the take is read.
      await new Promise<void>((resolve) => setImmediate(resolve));
      return { pcm: this.pcm, exitCode: this.exit?.code ?? null, stderr: this.stderr };
    })();
    return this.stopping;
  }

  abort(): void {
    this.aborted = true;
    if (this.child !== undefined && this.exit === undefined) {
      this.child.kill("SIGKILL");
    }
  }
}
