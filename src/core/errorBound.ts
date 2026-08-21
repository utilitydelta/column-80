/**
 * The bound on server-controlled text that ends up inside an error message.
 *
 * A leaf on purpose. Three transports throw HTTP failures - ollama.ts,
 * anthropicInstruct.ts and cloudInstruct.ts - and every one of those messages
 * reaches a VS Code notification. This module imports nothing, so any of them
 * can take it without an import cycle, and so can anything that grows the same
 * need later.
 *
 * Why it is here rather than in ollama.ts, where it was born: session-v56
 * bounded the ollama arm and left byte-identical unbounded copies in the other
 * two. A misbehaving Anthropic or cloud endpoint answering a 500 with 100KB of
 * HTML put the whole 100KB in front of the user, on ONE line, where the toast's
 * own first-line rule cannot shorten it (roadmap item 63).
 */

/** How much of a server-controlled string survives into an error message. The
 *  message reaches a toast, and a misbehaving server can answer a 500 with a
 *  megabyte of HTML or JSON; a few hundred chars is more than the
 *  `{"error":"..."}` shape these APIs actually send needs. One bounded string
 *  serves both the toast and the channel line. */
export const ERROR_BODY_CHARS = 400;

/** A server-controlled string, bounded. A value inside the budget passes
 *  through verbatim - the bound must not mangle the ordinary "model not found"
 *  error. Over it, the head is kept and the marker states how much was dropped,
 *  so a short value and a cut one cannot be confused.
 *
 *  BOTH HALVES of an HTTP error string need this. Node puts no ceiling on the
 *  reason phrase, so bounding the body alone left the whole error string
 *  escapable through statusText, on one line, where firstLine cannot shorten
 *  it. The same call also bounds the failures that arrive inside a 200-status
 *  stream, which never pass through a Response at all. */
export function boundBody(body: string): string {
  if (body.length <= ERROR_BODY_CHARS) {
    return body;
  }
  let kept = body.slice(0, ERROR_BODY_CHARS);
  // Cutting by code unit can split a surrogate pair; drop the orphaned half
  // rather than render a replacement character in the error string.
  const last = kept.charCodeAt(kept.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) {
    kept = kept.slice(0, -1);
  }
  return `${kept} [+${body.length - kept.length} chars elided]`;
}

/** An HTTP error body, bounded, for the callers that only interpolate it. A
 *  body that cannot be read at all is named rather than left empty. */
export async function safeText(res: Response): Promise<string> {
  try {
    return boundBody(await res.text());
  } catch {
    return "<no body>";
  }
}

/** An HTTP error body, UNBOUNDED, for the one caller that has to parse it
 *  before anyone reads it.
 *
 *  cloudInstruct learns a provider's chat dialect by JSON-parsing its own 400,
 *  and a bound applied at the read would hand that parse a truncated document
 *  with an elision marker glued on the end. The bound belongs at the throw on
 *  that arm, not at the read. Anything that only interpolates should take
 *  `safeText` instead. */
export async function rawText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "<no body>";
  }
}
