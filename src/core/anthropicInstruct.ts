/**
 * Native Anthropic Messages transport, for one reason: `cache_control`.
 *
 * The `anthropic` provider used to ride the OpenAI compatibility layer with the
 * other four, and that layer has no `cache_control` field at all. So a user
 * paying Anthropic per token through an API key could not cache their context
 * blocks, and nothing told them. Confirmed independently against opencode's
 * `cache-policy.ts`, which gates its whole policy pass on a set containing
 * `anthropic-messages` and skips OpenAI and Gemini as "harmless but pointless"
 * because those cache implicitly.
 *
 * This partially supersedes the "OpenAI-compatible surface for all providers"
 * ADR (docs/architecture/fn-generation.md), which is amended rather than
 * quietly contradicted. The ADR still holds for `openai`, `xai`, `gemini` and
 * `openai-compatible`: they keep the existing client, untouched.
 *
 * THE ASYMMETRY WITH THE CLAUDE CODE BACKEND, and it is the whole design: this
 * path holds NO client-side state and must never grow any. The server keys its
 * cache on content, so a changed block set finds no match and writes a new
 * entry. No session id, no content hash, no invalidation, no sweep, and no
 * staleness risk, because there is nothing here that can go stale. Phase 2's
 * fork machinery exists to make a checkpoint safe; porting it here would be
 * state that can only be wrong.
 */

import { usageEvidence } from "./cacheEvidence";
import { InstructGenerateFn, InstructGenerateParams, InstructGenerateResult } from "./ollama";

import { boundBody, safeText } from "./errorBound";

export interface AnthropicInstructConfig {
  /** Resolved endpoint root: the `anthropic` preset's baseUrl or the user's
   *  override. `/messages` hangs off it. */
  baseUrl: string;
  apiKey: string;
  /** Evidence sink: one line per round. */
  log?: (line: string) => void;
}

/** Pinned, not tracked: this is the Messages API's stable version handle, and
 *  it is what opencode sends too. */
const ANTHROPIC_VERSION = "2023-06-01";

/**
 * One hour, hardcoded, no bucket abstraction.
 *
 * Break-even is three requests against the 5-minute window's two, which reads
 * like the worse trade until you price the alternative: a 5-minute window
 * expires while a developer reads the generated function or thinks about the
 * next one, and the write is then paid again. An hour is roughly the shape of a
 * working session - pin a block, write several functions against it.
 */
const CACHE_TTL = "1h";

/** One SSE frame, narrowed to the fields that carry meaning. Anthropic sends
 *  `event:` lines too; the `type` on the data payload says the same thing, so
 *  only `data:` lines are read. */
interface AnthropicEvent {
  type?: string;
  message?: { usage?: unknown };
  delta?: { text?: string; stop_reason?: string | null };
  usage?: unknown;
  error?: { message?: string; type?: string };
}

/**
 * Build an InstructGenerateFn bound to one endpoint + key. The ollama-only
 * params (`apiBase`, `numGpu`, `numCtx`, `think`) reach nothing, exactly as on
 * the sibling cloud client.
 */
export function makeAnthropicInstruct(config: AnthropicInstructConfig): InstructGenerateFn {
  return (params: InstructGenerateParams): Promise<InstructGenerateResult> => runRound(config, params);
}

/**
 * One round, and one evidence line whatever happens to it.
 *
 * A failure used to write nothing at all, which made this backend the one place
 * in the product where a round could cost money and leave no trace: a stream
 * that dies after `message_start` has already been told about a cache write the
 * provider has already charged for. Phase 4 counts rounds out of this channel,
 * and the sibling CLI backend has always written a failure line.
 *
 * The failure line carries no accounting, deliberately: that is the same rule
 * the CLI backend follows, and one format is the point of sharing the renderer.
 */
async function runRound(
  config: AnthropicInstructConfig,
  params: InstructGenerateParams,
): Promise<InstructGenerateResult> {
  try {
    return await streamMessages(config, params);
  } catch (err) {
    // An abort is the user's own cancellation, not a failure of the round.
    if (!params.signal.aborted) {
      config.log?.(`[anthropic] model=${params.model} round=failed reason=${firstLine(err)}`);
    }
    throw err;
  }
}

/** The first line of a failure, capped. A provider error body can be a whole
 *  JSON document, and this line is read in an output channel. */
function firstLine(err: unknown): string {
  const line = String(err instanceof Error ? err.message : err).trim().split("\n")[0] ?? "";
  return line.length > 200 ? line.slice(0, 200) + "..." : line;
}

async function streamMessages(
  config: AnthropicInstructConfig,
  params: InstructGenerateParams,
): Promise<InstructGenerateResult> {
  const content = contentBlocks(params);
  const body = {
    model: params.model,
    max_tokens: params.maxTokens,
    stream: true,
    // One user turn and no system message, the same "the prompt is the prompt"
    // identity the local and CLI paths hold: prompt.ts already carries the
    // instruction.
    messages: [{ role: "user", content }],
  };
  // NO `temperature`, and no `thinking`, and both omissions are load-bearing.
  //
  // `temperature` is REMOVED from the native Messages API on Claude Opus 5,
  // Opus 4.8, Opus 4.7 and Fable 5 - sending it returns a 400 - and a
  // non-default value is rejected on Sonnet 5. Those are exactly the ids a user
  // paying per token would put in `fnGenModel`, so forwarding the setting would
  // fail every round on every current model. The compat client this replaced
  // was tolerating it because that layer accepts and drops the field.
  //
  // `thinking` is omitted rather than disabled because there is no single value
  // that is valid everywhere: `{type:"disabled"}` is refused outright on Fable 5
  // and refused above `high` effort on Opus 5, while omitting it never errors on
  // any model. The cost of omitting is that on the models where thinking is on
  // by default, part of `max_tokens` is spent reasoning - and that surfaces
  // honestly, because the shared pipeline already rejects a `length` finish as
  // truncated rather than splicing a half-written body.

  const url = new URL("messages", withTrailingSlash(config.baseUrl));
  const started = Date.now();
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      // The native API authenticates on x-api-key. Bearer is the compat
      // layer's scheme and this endpoint ignores it, which would read to a user
      // as an invalid key.
      "x-api-key": config.apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify(body),
    signal: params.signal,
  });

  if (!res.ok) {
    // The provider's own message is the actionable half (invalid key, unknown
    // model, quota). What we sent back is never in it, so the key cannot leak
    // into a notification or the evidence channel.
    throw new Error(`Anthropic ${res.status} ${boundBody(res.statusText)}: ${await safeText(res)}`);
  }
  if (!res.body) {
    throw new Error("Anthropic: response has no body");
  }

  let text = "";
  let ttftMs: number | undefined;
  let doneReason: string | undefined;
  // Usage arrives in TWO frames: the cache fields on `message_start`, the real
  // output count on `message_delta`. Rendering from the first alone would print
  // out=0 on every round, so they are merged and written once at the end.
  let usage: Record<string, unknown> | undefined;
  // The stream's own terminator. A body that simply ENDS after a few deltas is
  // byte-for-byte what a short successful generation looks like to the caller,
  // so without this a half-written function reaches the preview as a clean one.
  // The product already refuses a reply cut at the token budget for exactly
  // that reason; a reply cut by a dropped connection is the same defect.
  let sawStop = false;

  const mergeUsage = (incoming: unknown): void => {
    if (typeof incoming !== "object" || incoming === null) {
      return;
    }
    usage = { ...(usage ?? {}), ...(incoming as Record<string, unknown>) };
  };

  const handleLine = (line: string): void => {
    if (params.signal.aborted) {
      throw abortError();
    }
    const trimmed = line.trim();
    // SSE framing: blank separators, `:` comments and the `event:` name line
    // carry nothing this reader needs. Only `data:` does.
    if (trimmed === "" || trimmed.startsWith(":") || !trimmed.startsWith("data:")) {
      return;
    }
    const evt = JSON.parse(trimmed.slice("data:".length).trim()) as AnthropicEvent;
    if (evt.type === "error") {
      // The SSE sibling of ollama's in-200 error field: a 200 whose stream
      // carries the failure. Bounded here rather than left to the translator
      // that phase 4 gives this site, because a translation is not a bound. A
      // marker that is reworded and stops matching would put the whole payload
      // back on the screen.
      throw new Error(
        `Anthropic stream error: ${boundBody(String(evt.error?.message ?? evt.error?.type ?? "unknown"))}`,
      );
    }
    if (evt.type === "message_start") {
      mergeUsage(evt.message?.usage);
      return;
    }
    if (evt.type === "content_block_delta") {
      const chunk = evt.delta?.text;
      if (chunk) {
        if (ttftMs === undefined) {
          ttftMs = Date.now() - started;
        }
        text += chunk;
        params.onChunk?.(chunk);
      }
      return;
    }
    if (evt.type === "message_stop") {
      sawStop = true;
      return;
    }
    if (evt.type === "message_delta") {
      mergeUsage(evt.usage);
      // "length" is the truncation signal the fn-gen service rejects on; map it
      // onto the local vocabulary so one guard covers all three backends. Any
      // other reason passes through untranslated, because a reason nobody has
      // seen yet must not read as a clean finish.
      const stop = evt.delta?.stop_reason;
      if (stop) {
        doneReason = stop === "end_turn" ? "stop" : stop === "max_tokens" ? "length" : stop;
      }
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
      }
    }
    handleLine(buffer);
  } catch (err) {
    // A parse, error-frame or abort throw leaves the connection open; release
    // it so the next request does not queue behind a dead stream (the same
    // discipline as the ollama and cloud clients).
    void reader.cancel().catch(() => undefined);
    throw err;
  }

  if (!sawStop) {
    throw new Error("Anthropic: the stream ended before message_stop, so the reply is incomplete");
  }

  const totalMs = Date.now() - started;
  config.log?.(
    `[anthropic] model=${params.model} cache-mark=${content.length > 1 ? "yes" : "no"} ` +
      `ttft=${ttftMs ?? totalMs}ms total=${totalMs}ms ` +
      usageEvidence(usage),
  );
  return { text, ttftMs: ttftMs ?? totalMs, totalMs, doneReason };
}

interface TextBlock {
  type: "text";
  text: string;
  cache_control?: { type: "ephemeral"; ttl: string };
}

/**
 * The user turn's content, and the single cache breakpoint.
 *
 * PLACEMENT IS THE WHOLE DECISION. The marker means "cache everything up to and
 * including this block", and the assembled prompt already leads with the
 * context blocks. Put it at the end instead and every request writes a distinct
 * entry and reads none, paying the write premium forever for nothing.
 *
 * Exactly one breakpoint, so there is nothing to count. The API caps at four
 * and returns 400 beyond that; a counter here would guard a case that cannot
 * arise. That changes the day progressive breakpoints are added so an appended
 * block still reads the earlier ones.
 *
 * No floor, unlike the Claude Code fork. A fork costs a round trip, so it is
 * worth refusing below the smallest cacheable prefix; a marker costs nothing
 * and is silently ignored below it, and `usage` then reports the truth. Skipping
 * it would be a guess where a measurement is free.
 */
function contentBlocks(params: InstructGenerateParams): TextBlock[] {
  const prefix = params.cachePrefix ?? "";
  // The prefix must BE a prefix, and the two blocks must reconstruct the prompt
  // byte for byte. A prefix that does not match means the assemblers and the
  // prefix renderer have drifted; that round goes out whole rather than
  // throwing, and the round is the product.
  // An empty prefix and a prefix that IS the whole prompt are the two ends of
  // the same rule: both would send a text block with no text, which the API
  // rejects outright. Guarding one end and not the other was an inconsistency,
  // not a judgement call.
  if (prefix === "" || prefix === params.prompt || !params.prompt.startsWith(prefix)) {
    return [{ type: "text", text: params.prompt }];
  }
  return [
    { type: "text", text: prefix, cache_control: { type: "ephemeral", ttl: CACHE_TTL } },
    { type: "text", text: params.prompt.slice(prefix.length) },
  ];
}

function abortError(): Error {
  const err = new Error("The operation was aborted");
  err.name = "AbortError";
  return err;
}

function withTrailingSlash(base: string): string {
  return base.endsWith("/") ? base : base + "/";
}
