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

/** How much of a server-controlled string survives into the OUTPUT CHANNEL.
 *
 *  Forty times the toast's budget, and the two are different products. The
 *  toast is a notification a human reads at a glance and `ERROR_BODY_CHARS`
 *  is sized for that; the channel is the only diagnostic surface a
 *  no-telemetry product will ever have, and a support case wants the provider's
 *  whole answer. Ruled 2026-08-22 (roadmap item 69): starve the toast, never
 *  the channel.
 *
 *  It is still a cap, because the channel is a UI surface too and a
 *  misbehaving server can answer a 500 with a megabyte of HTML. 16 KiB holds
 *  any real `{"error":{...}}` envelope whole, holds the head of an HTML error
 *  page with its title and status, and refuses the megabyte. The number is a
 *  JUDGEMENT CALL and `docs/constants.md` says so: nothing measured the size
 *  distribution of real provider error bodies, because nothing in this repo
 *  has collected one. */
export const CHANNEL_BODY_CHARS = 16384;

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
  return boundTo(body, ERROR_BODY_CHARS);
}

/** The same string, bounded for the CHANNEL instead of the toast.
 *
 *  The two budgets are one function on purpose: a cut body and a short one must
 *  be told apart by the same marker on both surfaces, or a support case reading
 *  the channel cannot tell whether it is looking at the server's whole answer.
 *  Only the budget differs. */
export function boundChannel(body: string): string {
  return boundTo(body, CHANNEL_BODY_CHARS);
}

function boundTo(body: string, budget: number): string {
  if (body.length <= budget) {
    return body;
  }
  let kept = body.slice(0, budget);
  // Cutting by code unit can split a surrogate pair; drop the orphaned half
  // rather than render a replacement character in the error string.
  const last = kept.charCodeAt(kept.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) {
    kept = kept.slice(0, -1);
  }
  return `${kept} [+${body.length - kept.length} chars elided]`;
}

/** The channel's record of what a server actually answered.
 *
 *  The toast says "The full message is in the output channel". Between
 *  session-v56 and session-v57 that stopped being true: the bound moved to the
 *  read, so the channel's copy WAS the toast's copy and a 102400-char body left
 *  467 characters behind on the Anthropic arm and 463 on the cloud one. This
 *  line is what makes the sentence true again, and it is written at the
 *  transport, at the moment the body arrives, BEFORE `boundBody` runs.
 *
 *  The raw length is stated separately from the text so the channel says how
 *  much the server sent even when the cap has eaten most of it.
 *
 *  The tag is `[http-body]` and NOT the transport's own tag, deliberately. Each
 *  arm's tag is a per-round accounting format that something parses: the
 *  Anthropic client writes one `[anthropic] model=... round=...` line per round
 *  and `test/blind-v44-anthropic.test.cjs:239` pins the count at one, with
 *  `test/adversarial-v44-p3.test.cjs:107` pinning it again on the failure path.
 *  A body dump wearing that tag would be counted as a round and would be handed
 *  to that format's reader. This is a diagnostic, not accounting, so it gets its
 *  own tag and names its transport inside the line.
 *
 *  THE BREAKS ARE ESCAPED, and that is the difference between a diagnostic and
 *  an attack surface. Every real sink here is `OutputChannel.appendLine`, which
 *  renders one row per line break, so an unescaped dump lets a server write its
 *  own channel rows: a 500 body reading
 *  `{"error":"real"}\n[fngen] outcome=ok` renders as two rows and the second one
 *  wears the product's tag. This line carries up to 16 KiB of text the server
 *  chose, on the one surface whose trustworthiness is the whole point of the
 *  change, so it renders as exactly ONE row. A frame around the dump would not
 *  do: a server can forge an end marker, but it cannot forge a row break that
 *  is not there. */
export function channelBodyLine(transport: string, status: number, raw: string): string {
  // ESCAPE FIRST, bound second. The other order was written first and is wrong,
  // and the measurement that settled it is worth keeping.
  //
  // Bounding first caps the BODY; the escape then runs outside the cap. `\r`
  // and `\n` cost two characters each, which is where the original comment's
  // "roughly twice" came from - but U+2028, U+2029 and NEL cost SIX. Driven: a
  // 16385-character all-U+2028 body produced a 98372-character single row from
  // a 16384-character cap. Six times, chosen by a server willing to send a
  // 32 KB request. This constant is named for the channel and documented as
  // bounding what reaches it, so a cap the row can exceed sixfold is the code
  // failing to mean its own name.
  //
  // What the order costs, stated because it is a real loss: on a body carrying
  // breaks, `(N chars)` counts what the server sent while the elision note
  // counts characters of the escaped rendering, so the two are in different
  // units and `kept + elided = N` no longer holds. That divergence appears only
  // where a server is pushing breaks deliberately, which is exactly where a
  // hard ceiling matters more than a checkable identity. For every real
  // `{"error":...}` envelope - no breaks in it - the escape is the identity and
  // the two numbers agree exactly, as they did before.
  return `[http-body] ${transport} ${status} server body (${raw.length} chars): ${boundChannel(escapeBreaks(raw))}`;
}

/** What the channel says when the body could not be read at all.
 *
 *  Distinct from a body that really arrived, because the two want opposite next
 *  actions from whoever reads the channel. `rawText` and `safeText` both answer
 *  an unreadable body with the string `<no body>`, and a line reading
 *  `server body (9 chars): <no body>` is byte-identical to the line a server
 *  that genuinely sent those nine bytes produces - the flight recorder stating
 *  a character count for bytes that never arrived. The read knows which case it
 *  is; this is how it says so. */
export function channelUnreadLine(transport: string, status: number): string {
  return `[http-body] ${transport} ${status} server body unread: the response body could not be read`;
}

/** Line breaks made visible, so a server-controlled string is one channel row.
 *
 *  LF, CR, U+2028, U+2029 and NEL. CRLF needs no case of its own: both halves
 *  are escaped in turn, and `a\r\nb` comes out as the two escapes side by side
 *  rather than losing one to the other.
 *
 *  This is the set `firstLine` in `src/vscode/toastText.ts` is being widened to
 *  in the same session (roadmap item 69's third shape); until that lands, the
 *  toast rule still splits on `\n` alone and the two sets differ. VT and FF are
 *  deliberately absent from both: VS Code's text model does not break a row on
 *  them. If they are ever added to one set they belong in the other on the same
 *  day. */
function escapeBreaks(s: string): string {
  return s
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029")
    .replace(/\u0085/g, "\\u0085");
}

/** An HTTP error body read once, saying whether it could be read at all.
 *
 *  The reader a new HTTP transport should take. `safeText` and `rawText` below
 *  both collapse "the server sent nothing readable" into a string, which is
 *  fine for a throw and wrong for the channel; this one keeps the distinction
 *  and lets the caller spend it on both surfaces. */
export async function readBody(res: Response): Promise<{ read: true; text: string } | { read: false }> {
  try {
    return { read: true, text: await res.text() };
  } catch {
    return { read: false };
  }
}

/** An HTTP error body, bounded, for a caller that only interpolates it and
 *  never logs. A body that cannot be read at all is named rather than left
 *  empty.
 *
 *  NOT THE SHAPE A NEW HTTP TRANSPORT SHOULD COPY, and neither is `rawText`
 *  below. Nothing in `src/` calls either one since roadmap item 69's ruling:
 *  both collapse "the server sent nothing readable" into a string, which is
 *  fine for a throw and wrong for the channel, and `safeText` additionally
 *  bounds at the READ, which leaves nothing raw to log. A transport that takes
 *  it recreates the exact defect item 69 closed.
 *
 *  The recipe for a new HTTP status site is three calls in this order:
 *
 *      const body = await readBody(res);
 *      log?.(body.read ? channelBodyLine(name, res.status, body.text)
 *                      : channelUnreadLine(name, res.status));
 *      throw new Error(`${Name} ${res.status} ${boundBody(res.statusText)}: ` +
 *                      `${boundBody(body.read ? body.text : "<no body>")}`);
 *
 *  The order is load bearing. The channel must see the body before the toast's
 *  bound does, or the toast's "the full message is in the output channel" is a
 *  promise with nothing behind it - which is what it was between session-v56
 *  and session-v57.
 *
 *  Both readers stay exported: they are the leaf's tested definitions and
 *  `test/impl-v57-p1-shared-bound.test.cjs` pins their behaviour on a torn and
 *  a blank body. */
export async function safeText(res: Response): Promise<string> {
  try {
    return boundBody(await res.text());
  } catch {
    return "<no body>";
  }
}

/** An HTTP error body, UNBOUNDED, and like `safeText` above NOT the shape a new
 *  transport should copy - take `readBody` and follow the recipe there.
 *
 *  Kept for the reason it was written: cloudInstruct learns a provider's chat
 *  dialect by JSON-parsing its own 400, and a bound applied at the read would
 *  hand that parse a truncated document with an elision marker glued on the
 *  end. The bound belongs at the throw on that arm, not at the read. That arm
 *  now reads with `readBody` for the same reason every other one does, so
 *  nothing in `src/` calls this today. */
export async function rawText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "<no body>";
  }
}
