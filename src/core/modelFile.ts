/**
 * The speech model files and the one downloader that fetches them.
 *
 * The ollama models ride ollama's own pull; whisper.cpp's ggml files are plain HTTP objects, so
 * this streams them to disk with the same progress shape the pull toast reads. The consent rule is
 * the vscode layer's (`[dictate] model ratified` lands before the request starts); this module
 * only moves bytes and refuses to leave a half-file behind under the real name.
 */
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { dirname } from "node:path";

export interface SpeechModelSpec {
  name: string;
  url: string;
  file: string;
  bytes: number;
  sha256: string;
}

/** whisper.cpp's `base.en`, the model every scout number was measured on. The size and hash
 *  are of the bytes Hugging Face served on 2026-09-02, hashed after download; the first pin
 *  was the LFS etag, which is not the file's sha256, and the human's first download failed
 *  its check on that. `modelPresent` trusts the size alone. */
export const SPEECH_MODEL: SpeechModelSpec = {
  name: "base.en",
  url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin",
  file: "ggml-base.en.bin",
  bytes: 147964211,
  sha256: "a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002",
};

/** Silero VAD, the gate that turns a silent take into an empty transcript instead of an
 *  invented word (measured on this box: 3s of digital silence decoded to "You" without it). */
export const VAD_MODEL: SpeechModelSpec = {
  name: "silero-vad",
  url: "https://huggingface.co/ggml-org/whisper-vad/resolve/main/ggml-silero-v5.1.2.bin",
  file: "ggml-silero-v5.1.2.bin",
  bytes: 885098,
  sha256: "29940d98d42b91fbd05ce489f3ecf7c72f0a42f027e4875919a28fb4c04ea2cf",
};

export interface DownloadOptions {
  signal?: AbortSignal;
  onProgress?: (fraction: number | undefined, bytes: number) => void;
  sha256?: string;
  fetchImpl?: typeof fetch;
}

function abortError(): Error {
  const err = new Error("download aborted");
  err.name = "AbortError";
  return err;
}

export async function downloadFile(url: string, dest: string, opts: DownloadOptions = {}): Promise<void> {
  const part = `${dest}.part`;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const cleanup = () => rm(part, { force: true }).catch(() => undefined);
  if (opts.signal?.aborted) {
    throw abortError();
  }
  let res: Response;
  try {
    res = await fetchImpl(url, { signal: opts.signal });
  } catch (err) {
    await cleanup();
    if (opts.signal?.aborted) {
      throw abortError();
    }
    throw err;
  }
  if (res.status !== 200 || res.body === null) {
    await cleanup();
    throw new Error(`download of ${url} answered HTTP ${res.status}`);
  }
  const lengthHeader = res.headers.get("content-length");
  const total = lengthHeader !== null && /^\d+$/.test(lengthHeader) ? Number(lengthHeader) : undefined;
  const hash = createHash("sha256");
  let received = 0;
  await mkdir(dirname(part), { recursive: true }).catch(() => undefined);
  const out = createWriteStream(part);
  // A stream that fails to open never drains, so every wait below races the stream's own end:
  // the phase 3 review hung a download into a missing directory forever this way.
  let streamError: Error | undefined;
  const closed = new Promise<void>((resolve, reject) => {
    out.on("finish", resolve);
    out.on("error", (err) => {
      streamError = err;
      reject(err);
    });
  });
  closed.catch(() => undefined);
  const failed = closed.then(
    () => undefined,
    (err) => {
      throw err;
    },
  );
  try {
    const reader = res.body.getReader();
    for (;;) {
      if (opts.signal?.aborted) {
        throw abortError();
      }
      if (streamError !== undefined) {
        throw streamError;
      }
      const { done, value } = await Promise.race([reader.read(), failed.then(() => ({ done: true, value: undefined }))]);
      if (done || value === undefined) {
        if (streamError !== undefined) {
          throw streamError;
        }
        break;
      }
      received += value.byteLength;
      hash.update(value);
      if (!out.write(value)) {
        await Promise.race([new Promise<void>((resolve) => out.once("drain", resolve)), failed]);
      }
      opts.onProgress?.(total !== undefined && total > 0 ? Math.min(1, received / total) : undefined, received);
    }
    out.end();
    await closed;
    if (opts.sha256 !== undefined && hash.digest("hex") !== opts.sha256.toLowerCase()) {
      throw new Error(`download of ${url} failed its sha256 check`);
    }
  } catch (err) {
    out.destroy();
    await cleanup();
    if (opts.signal?.aborted) {
      throw abortError();
    }
    throw err;
  }
  await rename(part, dest);
}

/** Present means the file is there at the spec's exact size. No hash: that is a 148MB read on
 *  every activation, and a size match with a bad hash is a corruption the recogniser reports
 *  itself when it refuses to load. */
export async function modelPresent(dest: string, spec: SpeechModelSpec): Promise<boolean> {
  try {
    const s = await stat(dest);
    return s.isFile() && s.size === spec.bytes;
  } catch {
    return false;
  }
}
