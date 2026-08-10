/**
 * LRU completion cache keyed on (prefix, suffix), with prefix-walking hits:
 * typing through a cached suggestion keeps hitting without a model call.
 *
 * Prefix-walk adapted from TabbyML/tabby (Apache-2.0)
 * clients/tabby-agent/src/codeCompletion/cache.ts: Tabby precomputes
 * forwarded cache keys when a completion is inserted; here the equivalent
 * walk happens at lookup time (check whether the last few typed characters
 * are the head of an entry stored at an earlier cursor position), which
 * needs no extra entries. The 50-char window matches Tabby's
 * maxForwardingChars.
 *
 * Keys are windowed: the prefix component of every key keeps only its last
 * `keyWindow` characters, so entry size and lookup cost are bounded by the
 * window, never by document size. The walk recomputes each candidate base's
 * window, which is what keeps walk hits alive across the window shift that
 * typing causes (the key for `prefix` minus `typed` depends only on the
 * characters both states share).
 */

// NUL never appears in editor text, so joined keys cannot collide across
// different (prefix, suffix) splits.
const SEP = "\u0000";
export const WALK_WINDOW = 50;

/** What was true at the site that AUTHORED a completion. The walk moves a
 *  completion from the cursor position that produced it to a later one, and
 *  these are the facts that do not travel with it: a caller has to be able to
 *  ask what the authoring site knew before deciding the entry is servable here. */
export interface CacheProvenance {
  /** The authoring cursor was at a `.`/`::` member site. */
  memberSite: boolean;
  /** A candidate-surface block was injected into the prompt that produced it. */
  injected: boolean;
  /** The member-name/arity gate ran on it before it was returned. */
  gated: boolean;
}

export interface CacheHit {
  /** The completion text, walk offset already applied. */
  completion: string;
  provenance: CacheProvenance;
  /** true when reached by the prefix walk, false on an exact key match. */
  walked: boolean;
}

// An entry stored without provenance is treated as the most permissive thing it
// could be: authored at an ordinary statement site, where injection and the
// gate never applied and their absence is not a gap.
const UNTRACKED: CacheProvenance = { memberSite: false, injected: false, gated: false };

interface Entry {
  completion: string;
  uri?: string;
  provenance: CacheProvenance;
}

// The member separators across the supported languages. Both spellings are
// listed because neither matches the other: `::` contains no `.`, so a lone
// `/\./` would miss every Rust and C++ path expression.
const MEMBER_SEPARATOR = /\.|::/;

/** Whether the characters typed since a cached entry was authored LOOK LIKE
 *  they moved the cursor onto a new receiver.
 *
 *  A heuristic on raw text, with a measured error rate: 8.8% of the refusals it
 *  drives fire inside string literals or trailing comments, where there is no
 *  receiver to have moved onto. It errs toward refusing, which costs a model
 *  call rather than serving an unpoliced ghost. */
function crossesMemberSeparator(typed: string): boolean {
  return MEMBER_SEPARATOR.test(typed);
}

export class CompletionCache {
  // Map iterates in insertion order, so re-inserting on use makes the first
  // key the LRU — no linked list needed at capacity 100.
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly capacity: number,
    private readonly keyWindow: number = Infinity,
  ) {}

  get size(): number {
    return this.entries.size;
  }

  /** The convenience read, at a position that is NOT a member site. Retained
   *  because the contract promises it; no caller in src/ uses it, the service
   *  reads through `lookup`. */
  get(prefix: string, suffix: string): string | undefined {
    return this.lookup(prefix, suffix)?.completion;
  }

  /** The provenance-aware read. `atMemberSite` describes the CURRENT cursor,
   *  not the entry.
   *
   *  A walk is transport: it carries a completion from the position that
   *  authored it to a later one. Injection and the member gate are properties
   *  of the authoring position, and they do not travel. So a completion
   *  authored where neither applied may not walk into a member site, where both
   *  should have - that walk is how an un-injected, ungated ghost gets served
   *  at exactly the site the gate exists to police, with no model call in
   *  between to notice.
   *
   *  One-way, and walk-only. Walking INTO an ordinary position is unaffected
   *  whatever the base was. An exact key match is never refused - not because
   *  the key proves the two sites classify alike (it does not: the key carries
   *  no language, and the same text is a member site in one and not in another)
   *  but because an exact match means no transport happened. The entry is being
   *  read back where it was written, which is the one case the walk's problem
   *  cannot arise in. */
  lookup(prefix: string, suffix: string, atMemberSite = false): CacheHit | undefined {
    const exact = this.touch(this.keyOf(prefix, suffix));
    if (exact !== undefined) {
      return { completion: exact.completion, provenance: exact.provenance, walked: false };
    }
    const maxTyped = Math.min(WALK_WINDOW, prefix.length);
    for (let typedLen = 1; typedLen <= maxTyped; typedLen++) {
      const typed = prefix.slice(prefix.length - typedLen);
      // A separator in the typed span means the user moved onto a DIFFERENT
      // receiver since the base was authored, so the base's evidence, however
      // good, is not about this one. A ghost gated against `store` is genuinely
      // gated, but after typing `tileTally().f` its remainder would be served at
      // a member site whose receiver is `tileTally()`'s return type, which no
      // gate has ever seen. Provenance is per-receiver.
      //
      // `break`, not `continue`: the walk grows `typed` one character at a time
      // from the cursor backwards, so the spans are nested and once one holds a
      // separator every longer one does. No remaining candidate can pass.
      if (atMemberSite && crossesMemberSeparator(typed)) {
        break;
      }
      const key = this.keyOf(prefix.slice(0, prefix.length - typedLen), suffix);
      const entry = this.entries.get(key);
      // Strict prefix only: typing the whole suggestion leaves nothing to show.
      if (entry === undefined || entry.completion.length <= typedLen || !entry.completion.startsWith(typed)) {
        continue;
      }
      // The base gathered no evidence at all, being no member site. Refused
      // rather than returned empty: a shorter candidate further along the walk
      // may still be eligible, and refusing to serve an entry is not touching
      // it, so the LRU order is left alone.
      if (atMemberSite && !entry.provenance.memberSite) {
        continue;
      }
      this.touch(key);
      return {
        completion: entry.completion.slice(typedLen),
        provenance: entry.provenance,
        walked: true,
      };
    }
    return undefined;
  }

  set(
    prefix: string,
    suffix: string,
    completion: string,
    uri?: string,
    provenance: CacheProvenance = UNTRACKED,
  ): void {
    const key = this.keyOf(prefix, suffix);
    this.entries.delete(key);
    this.entries.set(key, { completion, uri, provenance });
    while (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      this.entries.delete(oldest);
    }
  }

  clear(): void {
    this.entries.clear();
  }

  /** Cross-file staleness eviction: an edit in document `uri` cannot
   *  invalidate completions minted for the SAME document (its own typing
   *  is what the prefix-walk exists for), but a completion minted for any
   *  OTHER document may reference surface the edit just changed - a member
   *  rename in one file must not leave another file's cached ghost offering
   *  the old name. Entries without a uri tag are treated as foreign. */
  retainOnly(uri: string): void {
    for (const [key, entry] of this.entries) {
      if (entry.uri !== uri) {
        this.entries.delete(key);
      }
    }
  }

  private keyOf(prefix: string, suffix: string): string {
    const windowed =
      this.keyWindow !== Infinity && prefix.length > this.keyWindow
        ? prefix.slice(-this.keyWindow)
        : prefix;
    return windowed + SEP + suffix;
  }

  private touch(key: string): Entry | undefined {
    const value = this.entries.get(key);
    if (value === undefined) {
      return undefined;
    }
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }
}
