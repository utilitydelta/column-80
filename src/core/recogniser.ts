/**
 * The resident recogniser: whisper.cpp's `whisper-server`, owned by the extension from
 * activation to deactivation, one decode per request over loopback HTTP.
 *
 * Resident is the whole design (session-v65 killshot): a per-gesture spawn pays 0.5 to 0.7s of
 * model load and misses the journey's sub-second bar; a warm server decodes a six second take
 * in about 250ms on the reference box. Beam 5 is sent on every request because greedy decoding
 * turned "threat level" into "THREKT LEVEL" on a clean fixture and beam 5 cost nothing
 * measurable. VAD rides along when the extension has the silero file, because 3s of silence
 * decodes to "You" without it.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { basename } from "node:path";
import { wavHeader } from "./dictation";

export interface RecogniserOptions {
  binary: string;
  model: string;
  vadModel?: string;
  threads?: number;
  log?: (line: string) => void;
}

export interface Transcript {
  text: string;
  decodeMs: number;
}

export interface TranscribeOptions {
  offsetMs?: number;
  durationMs?: number;
  signal?: AbortSignal;
  vad?: boolean;
}

const DEFAULT_THREADS = 8;
const START_TIMEOUT_MS = 20_000;
const POLL_MS = 50;
const VAD_MIN_SILENCE_MS = 500;
const BEAM_SIZE = 5;
const SETTLE_MS = 200;

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const address = srv.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      srv.close(() => (port > 0 ? resolve(port) : reject(new Error("no free port"))));
    });
  });
}

function abortError(): Error {
  const err = new Error("transcription aborted");
  err.name = "AbortError";
  return err;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class Recogniser {
  private disposed = false;
  private exited = false;

  private constructor(
    private readonly child: ChildProcess,
    readonly port: number,
    private readonly hasVad: boolean,
    private readonly log: (line: string) => void,
  ) {
    // The child can have died between the health poll and this constructor; the listener
    // below would then never fire (the phase 3 review's stranger-on-the-port row).
    if (child.exitCode !== null || child.signalCode !== null) {
      this.exited = true;
    }
    child.once("exit", (code) => {
      this.exited = true;
      if (!this.disposed) {
        this.log(`[dictate] recogniser exited code=${code}`);
      }
    });
  }

  static async start(opts: RecogniserOptions): Promise<Recogniser> {
    const log = opts.log ?? (() => undefined);
    const fail = (reason: string): never => {
      log(`[dictate] recogniser failed to start: ${reason}`);
      throw new Error(`recogniser failed to start: ${reason}`);
    };
    if (typeof opts.binary !== "string" || !existsSync(opts.binary)) {
      fail(`binary-missing (${opts.binary})`);
    }
    if (typeof opts.model !== "string" || !existsSync(opts.model)) {
      fail(`model-missing (${opts.model})`);
    }
    const hasVad = typeof opts.vadModel === "string" && opts.vadModel !== "";
    if (hasVad && !existsSync(opts.vadModel as string)) {
      // The server starts happily without the file and answers HTTP 500 to every decode.
      fail(`vad-model-missing (${opts.vadModel})`);
    }
    const started = Date.now();
    const port = await freePort();
    const threads = Math.max(1, Math.floor(Number.isFinite(opts.threads as number) ? (opts.threads as number) : DEFAULT_THREADS));
    const args = ["-m", opts.model, "--host", "127.0.0.1", "--port", String(port), "-t", String(threads)];
    if (hasVad) {
      args.push("--vad", "--vad-model", opts.vadModel as string, "--vad-min-silence-duration-ms", String(VAD_MIN_SILENCE_MS));
    }
    const child = spawn(opts.binary, args, { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
    let lastStderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      const lines = chunk.toString("utf8").split(/\r?\n/).filter((l) => l.trim() !== "");
      if (lines.length > 0) {
        lastStderr = lines[lines.length - 1];
      }
    });
    let exitCode: number | null | undefined;
    let spawnError: Error | undefined;
    child.once("exit", (code) => {
      exitCode = code;
    });
    child.once("error", (err) => {
      spawnError = err;
      exitCode = null;
    });

    const deadline = started + START_TIMEOUT_MS;
    for (;;) {
      if (spawnError !== undefined) {
        fail(`${spawnError.message}`);
      }
      if (exitCode !== undefined) {
        fail(`exited with code ${exitCode} before answering: ${lastStderr}`);
      }
      if (Date.now() > deadline) {
        child.kill("SIGKILL");
        fail("the recogniser did not come up in time");
      }
      let answered = false;
      try {
        const res = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1000) });
        answered = typeof res.status === "number";
      } catch {
        // Not up yet.
      }
      if (answered) {
        // An answer can be a stranger on the port while OUR child is still failing to bind;
        // a bind failure exits within a few ms, so a short settle tells the two apart.
        await sleep(SETTLE_MS);
        if (exitCode !== undefined || child.exitCode !== null) {
          fail(`exited with code ${exitCode ?? child.exitCode} before answering: ${lastStderr}`);
        }
        break;
      }
      await sleep(POLL_MS);
    }
    log(`[dictate] recogniser started port=${port} model=${basename(opts.model)} ms=${Date.now() - started}`);
    return new Recogniser(child, port, hasVad, log);
  }

  get alive(): boolean {
    return !this.disposed && !this.exited;
  }

  async transcribe(pcm: Uint8Array, opts: TranscribeOptions = {}): Promise<Transcript> {
    if (!this.alive) {
      throw new Error("server-down: the recogniser is not running");
    }
    const bytes = pcm instanceof Uint8Array ? pcm : new Uint8Array(0);
    if (bytes.byteLength === 0) {
      return { text: "", decodeMs: 0 };
    }
    if (opts.signal?.aborted) {
      throw abortError();
    }
    const header = wavHeader(bytes.byteLength);
    const wav = new Uint8Array(header.byteLength + bytes.byteLength);
    wav.set(header, 0);
    wav.set(bytes, header.byteLength);
    const form = new FormData();
    form.append("file", new Blob([wav], { type: "audio/wav" }), "take.wav");
    form.append("response_format", "json");
    form.append("temperature", "0");
    form.append("beam_size", String(BEAM_SIZE));
    form.append("vad", this.hasVad && opts.vad !== false ? "true" : "false");
    if (typeof opts.offsetMs === "number" && opts.offsetMs > 0) {
      form.append("offset_t", String(Math.round(opts.offsetMs)));
    }
    if (typeof opts.durationMs === "number" && opts.durationMs > 0) {
      form.append("duration", String(Math.round(opts.durationMs)));
    }
    const started = Date.now();
    let res: Response;
    try {
      res = await fetch(`http://127.0.0.1:${this.port}/inference`, { method: "POST", body: form, signal: opts.signal });
    } catch (err) {
      if (opts.signal?.aborted) {
        throw abortError();
      }
      throw new Error(`server-down: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (res.status !== 200) {
      throw new Error(`the recogniser answered HTTP ${res.status}`);
    }
    let body: { text?: unknown };
    try {
      body = (await res.json()) as { text?: unknown };
    } catch {
      throw new Error("the recogniser answered something other than JSON");
    }
    const text = typeof body.text === "string" ? body.text : "";
    return { text, decodeMs: Date.now() - started };
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    if (!this.exited) {
      this.child.kill();
      const child = this.child;
      setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill("SIGKILL");
        }
      }, 2000).unref();
    }
  }
}
