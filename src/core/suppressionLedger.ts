/**
 * Session counts for every suppression on the FIM path. A line per event
 * answers "why did this keystroke do nothing"; a count answers "how often does
 * this fire", and the second question is the one a dogfood session comes back
 * with. The count rides the suppression's own channel line rather than needing
 * a line of its own, the way `session dark sites=N` already does.
 *
 * Session-scoped, and that word is load-bearing. The extension rebuilds
 * `CompletionService` on every settings change, so a ledger the service owned
 * would zero itself whenever the human touched a slider - exactly the moment
 * they are trying to read the numbers. It also has to span the two halves of
 * the product: three of the four suppressions happen in the service and the
 * in-comment one happens in the provider, before the service is reached at all.
 * One shared instance below is what both of those require.
 *
 * A count is NOT a price. What a suppression costs is the valuable suggestions
 * it loses, which is a measurement against the corpus and not a number this
 * module can produce. This exists to make that measurement computable.
 */

export type SuppressionKind = "bound-unsafe" | "comment-introduced" | "in-comment" | "below-floor";

export const SUPPRESSION_KINDS: readonly SuppressionKind[] = [
  "bound-unsafe",
  "comment-introduced",
  "in-comment",
  "below-floor",
];

export interface SuppressionLedger {
  note(kind: SuppressionKind): void;
  /** Session totals, for the channel. */
  snapshot(): Record<SuppressionKind, number>;
}

export function createSuppressionLedger(): SuppressionLedger {
  const counts: Record<SuppressionKind, number> = {
    "bound-unsafe": 0,
    "comment-introduced": 0,
    "in-comment": 0,
    "below-floor": 0,
  };
  return {
    note: (kind) => {
      counts[kind] += 1;
    },
    // A copy. A caller holding a live reference would watch its own snapshot
    // change under it, and every consumer here is reporting a moment.
    snapshot: () => ({ ...counts }),
  };
}

/** The instance the running extension counts against. Callers that need
 *  isolation (tests, a second host) construct their own; nothing about the
 *  shape is global except this one binding. */
export const sessionSuppressions: SuppressionLedger = createSuppressionLedger();

/** Note one suppression and hand back the channel suffix carrying its running
 *  total: ` (session below-floor=3)`. Four call sites across two layers write
 *  this suffix, and four hand-rolled templates is how the formats drift apart
 *  and stop grepping as one class. */
export function noteSuppression(ledger: SuppressionLedger, kind: SuppressionKind): string {
  ledger.note(kind);
  return ` (session ${kind}=${ledger.snapshot()[kind]})`;
}
