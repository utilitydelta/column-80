/**
 * Optional cloud instruct backend: a frontier model over an OpenAI-compatible
 * chat-completions endpoint, swapped in behind the SAME InstructGenerateFn seam
 * the local ollama client fills. Only the fn-gen path (function/struct/test/
 * repair) ever reaches here; FIM is always local (chat APIs have no native
 * `suffix` infill, and per-keystroke round trips to a paid frontier model are a
 * non-starter).
 *
 * Why one client, not four: OpenAI, xAI (Grok), Anthropic (Claude), and Gemini
 * all expose the same `/chat/completions` wire contract - the last two through
 * their OpenAI-compatibility layers. Plain prompt-in/text-out with no tools
 * needs nothing those compat layers lack, so a provider is just a base URL. The
 * model id stays the user's `fnGenModel` setting so a model rename never rots a
 * constant in here.
 *
 * This backend leaves the machine. It is off by default and gated on an
 * explicit provider setting plus an API key; the local path is untouched when
 * no provider is chosen. See ARCHITECTURE.md ("What this is NOT" / the offline
 * invariant) for the trust framing.
 */

import { InstructGenerateFn, InstructGenerateParams, InstructGenerateResult } from "./ollama";

import { boundBody, channelBodyLine, channelUnreadLine, readBody } from "./errorBound";

export interface CloudProvider {
  id: string;
  /** Human-facing name for settings and evidence. */
  label: string;
  /** Root the `/chat/completions` path hangs off. Stable infrastructure, not a
   *  model id - safe to pin. */
  baseUrl: string;
}

/** The generic escape hatch: any other OpenAI-compatible server (OpenRouter,
 *  Groq, DeepSeek, a local vLLM), where the base URL comes from the user. */
export const OPENAI_COMPATIBLE = "openai-compatible";

// Named providers carry only the base URL. Anthropic and Gemini point at their
// OpenAI-compat surfaces, so all four are the same code path.
export const CLOUD_PROVIDERS: Record<string, CloudProvider> = {
  openai: { id: "openai", label: "OpenAI", baseUrl: "https://api.openai.com/v1" },
  anthropic: { id: "anthropic", label: "Anthropic (Claude)", baseUrl: "https://api.anthropic.com/v1" },
  xai: { id: "xai", label: "xAI (Grok)", baseUrl: "https://api.x.ai/v1" },
  gemini: {
    id: "gemini",
    label: "Google (Gemini)",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
  },
};

export interface CloudInstructConfig {
  /** Resolved endpoint root: a preset's baseUrl or the user's override. */
  baseUrl: string;
  apiKey: string;
  /** Evidence sink, the same field and the same contract the Anthropic client
   *  carries. The transport writes the RAW server body here on an HTTP failure,
   *  before the 400-char bound builds the throw (roadmap item 69). */
  log?: (line: string) => void;
}

/** One SSE line's parsed choice fields; everything else in the frame is ignored
 *  (usage, reasoning traces, tool calls - none land in a function body). */
interface StreamDelta {
  choices?: { delta?: { content?: string }; finish_reason?: string | null }[];
}

/**
 * The parts of the request body that newer models reject outright. OpenAI's
 * reasoning-era models (gpt-5 and the o-series) renamed `max_tokens` to
 * `max_completion_tokens` and dropped `temperature` entirely, and other compat
 * surfaces have not followed; there is no single body that both eras accept.
 *
 * Rather than pin a model-id list that rots on every rename - the same reason
 * the presets above carry no model - the dialect is LEARNED from the provider's
 * own 400. The first request for an unknown model goes out in the old shape,
 * and a rejection naming the offending param narrows it. Nothing is generated
 * on that failed attempt, so the cost is one fast round trip, paid once.
 */
interface ChatDialect {
  tokenParam: "max_tokens" | "max_completion_tokens";
  sendTemperature: boolean;
}

const DEFAULT_DIALECT: ChatDialect = { tokenParam: "max_tokens", sendTemperature: true };

/** Learned quirks per endpoint+model. A stale entry costs nothing: the retry
 *  loop re-derives the dialect from whatever the provider says next. */
const learnedDialects = new Map<string, ChatDialect>();

/**
 * Narrow the dialect from a rejected request, or undefined when the error is
 * not one this client can adapt to (bad key, unknown model, quota - all of
 * which belong in front of the user unchanged).
 *
 * Both branches are one-way, so the retry loop they drive terminates.
 */
function adaptDialect(status: number, detail: string, current: ChatDialect): ChatDialect | undefined {
  if (status !== 400) {
    return undefined;
  }
  // `param` is the reliable half of an OpenAI error; the message text is the
  // fallback for compat servers that echo the complaint without the field.
  const param = errorParam(detail);
  if (
    current.tokenParam === "max_tokens" &&
    (param === "max_tokens" || detail.includes("max_completion_tokens"))
  ) {
    return { ...current, tokenParam: "max_completion_tokens" };
  }
  // Dropping temperature hands the sampling decision to the provider's default.
  // A body the model refuses to read is worth less than one sampled its way.
  if (current.sendTemperature && param === "temperature") {
    return { ...current, sendTemperature: false };
  }
  return undefined;
}

function errorParam(detail: string): string | undefined {
  try {
    const parsed = JSON.parse(detail) as { error?: { param?: unknown } };
    const param = parsed.error?.param;
    return typeof param === "string" ? param : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Build an InstructGenerateFn bound to one provider endpoint + key. The
 * returned fn ignores the ollama-only params (`apiBase`, `numGpu`): the base
 * URL is fixed at construction and there is no GPU to carve.
 */
export function makeCloudInstruct(config: CloudInstructConfig): InstructGenerateFn {
  return (params: InstructGenerateParams): Promise<InstructGenerateResult> =>
    streamChat(config, params);
}

async function streamChat(
  config: CloudInstructConfig,
  params: InstructGenerateParams,
): Promise<InstructGenerateResult> {
  const { res, started } = await postChat(config, params);

  if (!res.body) {
    // COUPLING: this message's HEAD is a marker in fnGen.ts
    // SERVICE_REJECT_TOASTS, which matches the transport class with
    // startsWith. Rewording past the marker silently demotes the toast to
    // the catch-all, which puts API vocabulary in front of the user.
    throw new Error("Cloud: response has no body");
  }

  let text = "";
  let ttftMs: number | undefined;
  let totalMs: number | undefined;
  let doneReason: string | undefined;

  const handleLine = (line: string): void => {
    if (params.signal.aborted) {
      throw abortError();
    }
    const trimmed = line.trim();
    // SSE framing: blank separators and `:` comments (provider keepalives)
    // carry no data. Only `data:` lines do.
    if (trimmed === "" || trimmed.startsWith(":") || !trimmed.startsWith("data:")) {
      return;
    }
    const payload = trimmed.slice("data:".length).trim();
    // The stream's own end sentinel, distinct from finish_reason on the frame.
    if (payload === "[DONE]") {
      totalMs = Date.now() - started;
      return;
    }
    const evt = JSON.parse(payload) as StreamDelta;
    const choice = evt.choices?.[0];
    const chunk = choice?.delta?.content;
    if (chunk) {
      if (ttftMs === undefined) {
        ttftMs = Date.now() - started;
      }
      text += chunk;
      params.onChunk?.(chunk);
    }
    // finish_reason "length" is the truncation signal the fn-gen service
    // rejects on; map onto the local doneReason vocabulary so one guard covers
    // both backends. Any other reason ("stop", ...) passes through untranslated.
    if (choice?.finish_reason) {
      doneReason = choice.finish_reason;
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
    // A parse or abort throw leaves the connection open; release it so the next
    // request does not queue behind a dead stream (same discipline as ollama).
    void reader.cancel().catch(() => undefined);
    throw err;
  }

  const end = Date.now() - started;
  const total = totalMs ?? end;
  return { text, ttftMs: ttftMs ?? total, totalMs: total, doneReason };
}

/**
 * Send the request, re-sending once per dialect quirk the provider names in a
 * 400. Returns the accepted response and the clock start of the attempt that
 * produced it, so a rejected probe never inflates the reported TTFT.
 */
async function postChat(
  config: CloudInstructConfig,
  params: InstructGenerateParams,
): Promise<{ res: Response; started: number }> {
  const url = new URL("chat/completions", withTrailingSlash(config.baseUrl));
  const key = `${config.baseUrl}\n${params.model}`;
  let dialect = learnedDialects.get(key) ?? DEFAULT_DIALECT;

  for (;;) {
    const started = Date.now();
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Bearer is the shared scheme across all four compat surfaces.
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(chatBody(params, dialect)),
      signal: params.signal,
    });
    if (res.ok) {
      return { res, started };
    }

    // UNBOUNDED on purpose: adaptDialect parses this document, and a bound
    // applied here would hand its parse a truncated body with an elision
    // marker on the end. The bound goes on at the throw, below.
    // `readBody` rather than `rawText` so the channel can tell a body that
    // arrived from one that could not be read; `detail` collapses the two the
    // way `rawText` always did, which keeps the thrown string byte-identical.
    const body = await readBody(res);
    const detail = body.read ? body.text : "<no body>";
    const next = adaptDialect(res.status, detail, dialect);
    if (!next) {
      // The raw copy reaches the channel before the bound builds the throw, so
      // the toast's "the full message is in the output channel" is true again
      // (roadmap item 69). Logged HERE rather than at the read: a 400 that
      // teaches the dialect is not a failure, and a channel line for every
      // successful dialect probe would be noise, not diagnostics.
      config.log?.(
        body.read
          ? channelBodyLine("cloud", res.status, body.text)
          : channelUnreadLine("cloud", res.status),
      );
      // Surface the provider's own message (invalid key, unknown model, quota):
      // it is the actionable half. The key is never in the body we send back.
      throw new Error(`Cloud ${res.status} ${boundBody(res.statusText)}: ${boundBody(detail)}`);
    }
    learnedDialects.set(key, next);
    dialect = next;
  }
}

// The whole assembled fn-gen prompt is one user turn: prompt.ts already carries
// the instruction, so there is no separate system message - the same "the
// prompt is the prompt" identity the local path holds.
function chatBody(params: InstructGenerateParams, dialect: ChatDialect): Record<string, unknown> {
  return {
    model: params.model,
    messages: [{ role: "user", content: params.prompt }],
    stream: true,
    [dialect.tokenParam]: params.maxTokens,
    ...(dialect.sendTemperature ? { temperature: params.temperature } : {}),
  };
}

function abortError(): Error {
  const err = new Error("The operation was aborted");
  err.name = "AbortError";
  return err;
}

function withTrailingSlash(base: string): string {
  return base.endsWith("/") ? base : base + "/";
}
