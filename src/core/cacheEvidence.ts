/**
 * How a round's token accounting is written on an evidence line.
 *
 * Shared, and shared on purpose: two backends can reach Anthropic's cache (the
 * Claude Code CLI and the native Messages transport), and a human reading the
 * channel must not have to learn two formats to compare them. Phase 4 parses
 * one format for the same reason.
 */

/**
 * The round's token accounting, appended to the evidence line.
 *
 * Why this is here at all: without it nothing in the product can tell a cache
 * hit from a miss, which makes every caching change unfalsifiable. The CLI
 * places its own cache breakpoint at the end of the user turn, so a prompt that
 * differs by one trailing byte re-writes the whole prefix - measured 11,061
 * cache-write tokens on a second generation sharing 39,104 identical leading
 * bytes with the first. A reader needs to see which of those two happened.
 *
 * ABSENT IS NOT ZERO. A reply carrying no `usage` reports `usage=absent` and
 * none of the fields, and an individual field that is missing or non-numeric
 * reports `?`. `cwrite=0` must only ever mean a measured zero, because the
 * whole point of the field is to prove a write did not happen.
 */
export function usageEvidence(usage: unknown): string {
  if (typeof usage !== "object" || usage === null) {
    return "usage=absent";
  }
  const u = usage as Record<string, unknown>;
  const input = finite(u.input_tokens);
  const output = finite(u.output_tokens);
  const write = finite(u.cache_creation_input_tokens);
  const read = finite(u.cache_read_input_tokens);
  const split = typeof u.cache_creation === "object" && u.cache_creation !== null
    ? (u.cache_creation as Record<string, unknown>)
    : undefined;
  const hour = finite(split?.ephemeral_1h_input_tokens) ?? 0;
  const minutes = finite(split?.ephemeral_5m_input_tokens) ?? 0;

  return (
    `in=${orQuestion(input)} out=${orQuestion(output)} cwrite=${orQuestion(write)} ` +
    `cread=${orQuestion(read)} ttl=${ttlLabel(write, hour, minutes)} ` +
    `billed-eq=${billedEquivalent(input, write, read, hour, minutes)}`
  );
}

/** Which TTL bucket the write went to. `none` is a MEASURED zero and nothing
 *  else: a write nobody attributed is `?`, and so is a write nobody reported,
 *  because the same rule that stops `cwrite` claiming 0 stops this claiming a
 *  write did not happen. The 1-hour rate is what the arithmetic assumes when it
 *  sees `?`, and a reader has to be able to see that the assumption was made. */
function ttlLabel(write: number | undefined, hour: number, minutes: number): string {
  if (write === undefined) {
    return "?";
  }
  if (write === 0) {
    return "none";
  }
  // The buckets and the total are two facts from the same payload, and a label
  // that reads one without the other can claim a TTL was measured when part of
  // the write was priced on an assumption. A definite bucket name is earned
  // only by a split that accounts for exactly the write reported. Anything
  // else - a partial split, a new bucket name we do not read, a negative, a
  // split larger than the write - is `?`, and `?` is the contract's one device
  // for saying the basis was assumed.
  if (hour + minutes !== write) {
    return "?";
  }
  if (hour > 0 && minutes > 0) {
    return "mixed";
  }
  return hour > 0 ? "1h" : "5m";
}

/**
 * The round's cost in BASE-INPUT-TOKEN EQUIVALENTS, so the channel shows the
 * saving instead of leaving a human to derive it from four numbers that do not
 * compare. Anthropic's multipliers on base input: a 1-hour cache write costs
 * 2x, a 5-minute write 1.25x, a read 0.1x.
 *
 * Output tokens are deliberately out of it. They price on a different scale
 * entirely, and the figure this is compared against is an input-side one.
 *
 * The unattributed remainder of a write is priced at the 1-hour rate, which is
 * the only rate any write on this box has ever used, and `ttl=?` on the same
 * line says the split did not account for it.
 */
function billedEquivalent(
  input: number | undefined,
  write: number | undefined,
  read: number | undefined,
  hour: number,
  minutes: number,
): string {
  if (input === undefined || write === undefined || read === undefined) {
    return "?";
  }
  // A split is only usable when it fits inside the write it claims to describe.
  // Reading the buckets on their own let a payload with `cwrite: 0` and a
  // 10,000-token bucket bill for a write the same line reported as zero, and a
  // 100-token write bill 200x. An incoherent split falls back to the aggregate,
  // which keeps this figure inside 2x of what the CLI actually reported.
  const attributed = hour + minutes;
  const usable = attributed > 0 && attributed <= write;
  const writeCost = usable ? 2 * hour + 1.25 * minutes + 2 * (write - attributed) : 2 * write;
  return String(Math.round(input + writeCost + 0.1 * read));
}

function finite(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function orQuestion(value: number | undefined): string {
  return value === undefined ? "?" : String(value);
}

