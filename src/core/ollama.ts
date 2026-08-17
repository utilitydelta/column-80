/**
 * Streaming ollama client for FIM and instruct generation — one client, no
 * fork; both paths share the ndjson stream loop so timing and error
 * semantics cannot drift apart.
 *
 * Ported from utilitydelta/human-replay-vscode-extension src/ollama.ts
 * (generateFim, listModels, withTrailingSlash, safeText). Two deliberate
 * departures: the FIM request sends ollama's `suffix` param instead of a
 * locally built FIM template (ollama applies the model's native template, so
 * no `raw: true` and no stop-token list), and the response is streamed so
 * TTFT is measurable per request — the warm-latency oracle depends on it.
 */

export interface FimGenerateParams {
  apiBase: string;
  model: string;
  prefix: string;
  suffix: string;
  maxTokens: number;
  temperature: number;
  signal: AbortSignal;
  /** Called with the accumulated text after each non-empty chunk. Returning
   *  true ends the read: the reader is cancelled, the connection closes and
   *  ollama stops generating. A clean end, NOT an abort: the text read so far
   *  is the result. Releasing the connection IS the latency win the bound was
   *  measured for (p50 300ms to 141ms, p90 716ms to 173ms), so this is not a
   *  cosmetic early return. */
  stopWhen?: (textSoFar: string) => boolean;
}

export interface FimGenerateResult {
  text: string;
  ttftMs: number;
  totalMs: number;
  /** True when `stopWhen` ended the read rather than the model finishing.
   *  Absent when no `stopWhen` was passed. */
  stopped?: boolean;
}

export type FimGenerateFn = (params: FimGenerateParams) => Promise<FimGenerateResult>;

interface StreamEvent {
  response?: string;
  error?: string;
  done?: boolean;
  done_reason?: string;
}

// Seconds. Holds the model resident between requests; without it ollama
// unloads after its default 5 minutes and the next request pays a full
// model load.
const KEEP_ALIVE_S = 1800;

/**
 * A bound on SILENCE, not on duration. Queue Q5: a FIM request that never
 * yields pins single-flight forever, because the in-flight entry is only
 * displaced by a call with a DIFFERENT key and a same-key caller joins the dead
 * promise. So a server that accepts the connection and then goes quiet takes
 * FIM down until the user edits enough to re-key.
 *
 * The queue proposed "one AbortSignal.timeout", which is a TOTAL cap measured
 * from the request. Refuted before it was built: a local model on a cold cache
 * legitimately takes seconds, so a total cap turns a slow-but-working setup
 * into a broken one, which is worse than a rare hang. The watchdog is re-armed
 * on every line instead.
 */
interface SilenceBound {
  /** Nothing at all on the stream yet: no line, empty or otherwise. Generous on
   *  purpose, because this covers a model load and FIM shares the server with
   *  fn-gen, so a request can queue behind a generation. */
  firstDataMs: number;
  /** A gap between LINES once the stream is talking. Tight by comparison,
   *  because a server that has started answering and then goes quiet for this
   *  long is a dead connection, not a thinking model. */
  stallMs: number;
}

/**
 * 60s to the first line, 20s between lines. Both deliberately generous: this
 * bound exists to un-wedge single-flight, not to enforce latency. The latency
 * story is elsewhere and already built - the debounce, `stopWhen`, and a caller
 * that discards a stale ghost.
 *
 * The stall number has an arm the first-data number does not. Swapping between
 * a small FIM model and a big instruct model measured 2 to 4.6 second reloads
 * (docs/user-manual.md), and 20s is over 4x the worst of those - which is the
 * scenario worth surviving, a FIM request queued behind an fn-gen generation.
 * 60s is a judgement call and is recorded as one in docs/constants.md.
 */
const FIM_SILENCE: SilenceBound = { firstDataMs: 60_000, stallMs: 20_000 };

export async function generateFim(params: FimGenerateParams): Promise<FimGenerateResult> {
  const body = {
    model: params.model,
    prompt: params.prefix,
    suffix: params.suffix,
    stream: true,
    keep_alive: KEEP_ALIVE_S,
    options: {
      num_predict: params.maxTokens,
      temperature: params.temperature,
    },
  };
  const { text, ttftMs, totalMs, stopped } = await streamGenerate(
    params.apiBase,
    body,
    params.signal,
    undefined,
    params.stopWhen,
    // FIM only. The same hang can wedge the generate path, but fn-gen wraps
    // every generation in a cancellable progress affordance with a human
    // watching a deliberate gesture, so the failure reads completely
    // differently there. Filed separately rather than folded in.
    FIM_SILENCE,
  );
  // done_reason is not surfaced for FIM: a suggestion cut at num_predict is
  // still a usable infill prefix, unlike a truncated function body.
  // `stopped` is spread only when the read was cut, so a caller passing no
  // stopWhen sees the same three-field result it always has.
  return { text, ttftMs, totalMs, ...(stopped ? { stopped: true } : {}) };
}

export interface InstructGenerateParams {
  apiBase: string;
  model: string;
  /** The full user prompt; ollama applies the model's chat template. */
  prompt: string;
  maxTokens: number;
  temperature: number;
  /** Forwarded as options.num_gpu when set; omitted otherwise. */
  numGpu?: number;
  /** Context window for prompt + generation. Unset means ollama's 2048, which
   *  silently truncates. See the note at the request body. */
  numCtx?: number;
  /** Ollama's `think`. False turns reasoning off on models that default it on.
   *  Unset leaves the model's own default, which is how a non-reasoning model
   *  like qwen3-coder must be driven. */
  think?: boolean | string;
  signal: AbortSignal;
  /** Raw content chunks in arrival order, before any postprocessing. */
  onChunk?: (text: string) => void;
  /**
   * The STABLE HEAD of `prompt`: the rendered context blocks and nothing else,
   * exactly as `renderContextPrefix` produces them. Absent means this round has
   * no stable head.
   *
   * Only a backend that can cache a prefix reads it. ollama and the
   * OpenAI-compatible cloud client ignore it completely, and their request
   * bodies do not change by one byte when it is set: the prompt is still sent
   * whole, which is what keeps the local path the measurement baseline for
   * every language arm in the roadmap.
   */
  cachePrefix?: string;
}

export interface InstructGenerateResult {
  text: string;
  ttftMs: number;
  totalMs: number;
  /** ollama's done_reason from the final stream line ("stop", "length",
   *  ...); undefined when the server omits it. "length" means num_predict
   *  ran out — the fn-gen service rejects those as truncated. */
  doneReason?: string;
}

export type InstructGenerateFn = (
  params: InstructGenerateParams,
) => Promise<InstructGenerateResult>;

/**
 * Non-FIM instruct generation over the same /api/generate endpoint: prompt
 * only, no suffix param (suffix is what flips ollama into FIM templating),
 * no raw, no system — the assembled prompt already carries the instruction.
 * Same streaming, timing, and error contract as generateFim.
 */
export async function generateInstruct(
  params: InstructGenerateParams,
): Promise<InstructGenerateResult> {
  const body = {
    model: params.model,
    prompt: params.prompt,
    stream: true,
    keep_alive: KEEP_ALIVE_S,
    // Reasoning tokens are spent from the SAME num_predict budget as the
    // answer, and they are not the answer. Measured against qwen3.6:27b, which
    // reasons by default: every generation ran the budget to exactly 2048 and
    // was rejected as truncated, because the model never reached the function.
    // Any model that reasons by default is unusable here until this is false.
    ...(params.think !== undefined ? { think: params.think } : {}),
    options: {
      num_predict: params.maxTokens,
      temperature: params.temperature,
      // num_ctx bounds the prompt AND the generation together, and ollama's
      // default is 2048. Unset, a prompt over that is silently truncated to
      // fit: measured at exactly 2050 prompt tokens for three prompts of
      // 12.9KB, 13.1KB and 15.0KB of injected surface, all landing on the same
      // number. Nothing errors and nothing logs it, so injected types simply
      // stop reaching the model. Worse with num_predict at 2048, which alone
      // fills the default window and pushes the head of the prompt out under
      // context shift. Measured cost at the 16GB carve (num_gpu=30): 11.9GB
      // for 8192, 12.4GB for 16384, both leaving the co-resident FIM model its
      // room.
      ...(params.numCtx !== undefined ? { num_ctx: params.numCtx } : {}),
      // Spread-when-set keeps num_gpu out of the JSON entirely when unset,
      // so ollama's own scheduling stays in charge outside the carve.
      ...(params.numGpu !== undefined ? { num_gpu: params.numGpu } : {}),
    },
  };
  return streamGenerate(params.apiBase, body, params.signal, params.onChunk);
}

/**
 * One POST, newline-delimited JSON stream. `text` concatenates `response`
 * chunks; ttftMs lands at the first non-empty chunk, totalMs at the done
 * line. Non-2xx or a streamed `error` field rejects; abort rejects with an
 * abort error. Only non-empty chunks reach onChunk, and none after the
 * signal aborts — checked per line, because one TCP read can carry several
 * lines and the abort may happen inside an earlier line's onChunk.
 *
 * `stopWhen` ends the read cleanly on the text read so far: no throw, no
 * AbortError, and the connection is released so the server stops generating.
 * That is a different outcome from `signal`, which still rejects.
 */
async function streamGenerate(
  apiBase: string,
  body: unknown,
  signal: AbortSignal,
  onChunk?: (text: string) => void,
  stopWhen?: (textSoFar: string) => boolean,
  silence?: SilenceBound,
): Promise<{ text: string; ttftMs: number; totalMs: number; doneReason?: string; stopped?: boolean }> {
  // The silence watchdog owns the signal handed to fetch, so a bound that fires
  // cuts the socket. The caller's own signal is forwarded into it rather than
  // replaced: cancellation still means cancellation, and a bound firing is a
  // DIFFERENT outcome the caller can name.
  const watchdog = silence === undefined ? undefined : new AbortController();
  let cutBy: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const disarm = (): void => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };
  const arm = (ms: number, why: string): void => {
    if (watchdog === undefined) {
      return;
    }
    disarm();
    timer = setTimeout(() => {
      cutBy = why;
      watchdog.abort();
    }, ms);
    (timer as { unref?: () => void }).unref?.();
  };
  const forwardCallerAbort = (): void => watchdog?.abort(signal.reason);
  if (watchdog !== undefined) {
    if (signal.aborted) {
      watchdog.abort(signal.reason);
    } else {
      signal.addEventListener("abort", forwardCallerAbort, { once: true });
    }
  }
  const effectiveSignal = watchdog?.signal ?? signal;
  // Armed BEFORE the fetch: a server that accepts the connection and then never
  // answers is the hang this exists for, and it hangs before any line arrives.
  if (silence !== undefined) {
    arm(silence.firstDataMs, `silent for ${silence.firstDataMs}ms before any data`);
  }

  try {
    return await streamGenerateInner();
  } catch (err) {
    // A bound that fired reads as an AbortError from fetch, indistinguishable
    // from the user cancelling. Name it, or a dead server gets reported as the
    // editor's doing - the same wrong-cause failure item 55 was about, one
    // layer down.
    //
    // `!signal.aborted` matters: the timer can fire while the caller is
    // cancelling, inside the transport's abort-to-error latency, and whichever
    // error arrives would otherwise be relabelled a stream cut. Disarming in
    // the forwarder instead would remove the backstop for a transport that
    // ignores its signal, so the gate goes here.
    if (cutBy !== undefined && !signal.aborted) {
      throw new Error(`Ollama stream cut: ${cutBy} (${apiBase})`);
    }
    throw err;
  } finally {
    disarm();
    signal.removeEventListener("abort", forwardCallerAbort);
  }

  async function streamGenerateInner(): Promise<{
    text: string;
    ttftMs: number;
    totalMs: number;
    doneReason?: string;
    stopped?: boolean;
  }> {
    const url = new URL("api/generate", withTrailingSlash(apiBase));

    const started = Date.now();
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: effectiveSignal,
    });

    if (!res.ok) {
      throw new Error(`Ollama ${res.status} ${res.statusText}: ${await safeText(res)}`);
    }
    if (!res.body) {
      throw new Error("Ollama: response has no body");
    }

    let text = "";
    let ttftMs: number | undefined;
    let totalMs: number | undefined;
    let doneReason: string | undefined;
    let stopped = false;

    const handleLine = (line: string): void => {
      if (signal.aborted) {
        throw abortError();
      }
      // Re-armed on ANY line, before the blank-line return, because the bound is
      // on SILENCE and a line is not silence. Re-arming only on a non-empty
      // `response` token cut demonstrably-live streams: `{"response":""}` is a
      // real shape here (the terminal line carries one, and a think-enabled model
      // emits them), and any proxy in front of ollama may keepalive. `apiBase` is
      // a free-form setting, so a proxy is a supported deployment.
      //
      // The residual, stated rather than hidden: a server that emits lines
      // forever and never finishes is never cut. That is a live connection rather
      // than a hang, the user can cancel it, and cutting it is the failure this
      // bound is not allowed to cause.
      if (silence !== undefined) {
        arm(silence.stallMs, `silent for ${silence.stallMs}ms after ${text.length} chars`);
      }
      if (!line.trim()) {
        return;
      }
      const evt = JSON.parse(line) as StreamEvent;
      if (evt.error) {
        throw new Error(`Ollama error: ${evt.error}`);
      }
      if (evt.response) {
        if (ttftMs === undefined) {
          ttftMs = Date.now() - started;
        }
        text += evt.response;
        onChunk?.(evt.response);
      }
      if (evt.done) {
        totalMs = Date.now() - started;
        doneReason = evt.done_reason;
        return;
      }
      // Consulted after the done check so a model that finished on the same
      // line it delivered its last chunk is never reported as cut short: the
      // caller reads `stopped` as "the bound ended this, not the model".
      if (evt.response && stopWhen?.(text)) {
        stopped = true;
        // The wall clock where the read ENDED, so a bounded request reports what
        // the user actually waited rather than what the generation would have
        // cost had it run out.
        totalMs = Date.now() - started;
      }
    };

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          handleLine(line);
          if (stopped) {
            break;
          }
        }
        if (stopped) {
          break;
        }
      }
      // The trailing partial line is only ever completed by more reading, and
      // there is none once the bound is satisfied.
      if (!stopped) {
        handleLine(buffer);
      }
    } catch (err) {
      // A parse or ollama-error throw leaves the connection open; release it
      // so the next request does not queue behind a dead stream.
      void reader.cancel().catch(() => undefined);
      throw err;
    }
    if (stopped) {
      // Releasing the reader closes the connection, and closing the connection
      // is what makes ollama abandon the rest of the generation. Without it the
      // server keeps decoding tokens nobody will read and the next keystroke
      // queues behind them, which is the whole latency win thrown away.
      void reader.cancel().catch(() => undefined);
    }

    // Fallbacks resolve total first so a chunkless stream can never report
    // ttft later than total: ttft falls back to total, not to a timestamp
    // taken after the done line was handled.
    const end = Date.now() - started;
    const total = totalMs ?? end;
    return {
      text,
      ttftMs: ttftMs ?? total,
      totalMs: total,
      doneReason,
      ...(stopped ? { stopped: true } : {}),
    };
  }
}

function abortError(): Error {
  const err = new Error("The operation was aborted");
  err.name = "AbortError";
  return err;
}

/** Installed model names (with tags), or undefined when the server is
 *  unreachable or unhappy — one call answers both "is the server up" and
 *  "is the model pulled". */
export async function listModels(apiBase: string, signal?: AbortSignal): Promise<string[] | undefined> {
  try {
    const res = await fetch(new URL("api/tags", withTrailingSlash(apiBase)), { signal });
    if (!res.ok) {
      return undefined;
    }
    const json = (await res.json()) as { models?: { name?: string }[] };
    return (json.models ?? []).map((m) => m.name ?? "").filter((n) => n !== "");
  } catch {
    return undefined;
  }
}

// Model pull, ported from the human-replay-vscode-extension's src/ollama.ts
// (same author). Same module as the generate clients: one ollama client, no
// fork. The caller owns consent - pullModel is only ever reached from an
// explicit, logged ratify gesture.

/** One line of ollama's streaming pull response. */
export interface PullEvent {
  status?: string;
  error?: string;
  digest?: string;
  total?: number;
  completed?: number;
}

/** Running aggregate over a pull's per-layer progress events - pure, so the
 *  percentage math is testable without a server. Layers arrive interleaved;
 *  overall progress is completed-over-total across every layer seen so far,
 *  clamped monotonic because a progress bar must never run backwards. */
export class PullProgress {
  private readonly layers = new Map<string, { total: number; completed: number }>();
  private high = 0;

  note(evt: PullEvent): number | undefined {
    if (evt.digest && evt.total) {
      // A digest event without completed registers the layer at 0: the
      // size is known, nothing of it has arrived yet.
      this.layers.set(evt.digest, { total: evt.total, completed: evt.completed ?? 0 });
    }
    let total = 0;
    let completed = 0;
    for (const layer of this.layers.values()) {
      total += layer.total;
      completed += layer.completed;
    }
    if (total === 0) {
      return undefined;
    }
    // Two clamps: min(1, ...) caps a server over-report
    // (completed > total) at 100%, and the high-watermark keeps the return
    // non-decreasing when a new layer grows the denominator mid-pull.
    this.high = Math.max(this.high, Math.min(1, completed / total));
    return this.high;
  }
}

/** Pull a model through POST /api/pull - cross-platform, no shell. Streams
 *  layer progress into onProgress ([0..1] once sizes are known). Rejects on
 *  server error, a pull-stream error event, or abort. */
export async function pullModel(
  apiBase: string,
  model: string,
  signal: AbortSignal,
  onProgress: (fraction: number | undefined, status: string) => void,
): Promise<void> {
  const url = new URL("api/pull", withTrailingSlash(apiBase));
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, stream: true }),
    signal,
  });
  if (!res.ok) {
    throw new Error(`Ollama ${res.status} ${res.statusText}: ${await safeText(res)}`);
  }
  if (!res.body) {
    throw new Error("Ollama: pull response has no body");
  }

  const progress = new PullProgress();
  const handleLine = (line: string): void => {
    if (!line.trim()) {
      return;
    }
    const evt = JSON.parse(line) as PullEvent;
    if (evt.error) {
      throw new Error(evt.error);
    }
    onProgress(progress.note(evt), evt.status ?? "");
  };

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        handleLine(line);
      }
    }
    handleLine(buffer);
  } catch (err) {
    // Same discipline as streamGenerate: an error thrown mid-stream leaves
    // the connection open; release it so later requests do not queue behind
    // a dead stream.
    void reader.cancel().catch(() => undefined);
    throw err;
  }
}

function withTrailingSlash(base: string): string {
  return base.endsWith("/") ? base : base + "/";
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "<no body>";
  }
}
