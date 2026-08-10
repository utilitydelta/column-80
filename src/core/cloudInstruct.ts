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
}

/** One SSE line's parsed choice fields; everything else in the frame is ignored
 *  (usage, reasoning traces, tool calls - none land in a function body). */
interface StreamDelta {
  choices?: { delta?: { content?: string }; finish_reason?: string | null }[];
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
  // The whole assembled fn-gen prompt is one user turn: prompt.ts already
  // carries the instruction, so there is no separate system message - the same
  // "the prompt is the prompt" identity the local path holds.
  const body = {
    model: params.model,
    messages: [{ role: "user", content: params.prompt }],
    stream: true,
    max_tokens: params.maxTokens,
    temperature: params.temperature,
  };

  const url = new URL("chat/completions", withTrailingSlash(config.baseUrl));
  const started = Date.now();
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // Bearer is the shared scheme across all four compat surfaces.
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: params.signal,
  });

  if (!res.ok) {
    // Surface the provider's own message (invalid key, unknown model, quota):
    // it is the actionable half. The key is never in the body we send back.
    throw new Error(`Cloud ${res.status} ${res.statusText}: ${await safeText(res)}`);
  }
  if (!res.body) {
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

function abortError(): Error {
  const err = new Error("The operation was aborted");
  err.name = "AbortError";
  return err;
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
