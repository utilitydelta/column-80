/**
 * The chain-surface cache: once-per-workspace signatures for the members a
 * provider's resolve cap can never reach.
 *
 * Why it exists (measured, session-v27/measure-chains.md): Roslyn serves 115
 * items at a `List<Tile>.` receiver with zero signature data on any unresolved
 * item, and `Where<>` sits at position 113 of the provider's order. The
 * resolve cap (MEMBER_RESOLVE_CAP = 32) resolves the HEAD of that order, so
 * the chain vocabulary — Where/Select/Sum/Take, the exact verbs functional
 * iterator code is made of — never carries a signature, the narrowed block
 * renders empty, and the member site goes dark precisely where chains live.
 * Items cannot be targeted through executeCompletionItemProvider, so
 * partial-directed resolution is unreachable in-editor; a cache filled off the
 * keystroke path is the fix that stays inside the platform.
 *
 * Pure data + functions, no vscode imports. The transport-side warm (who
 * fills the cache, when) is deliberately not in this module. Signatures are
 * stored per OPAQUE namespace string — the provider passes per-receiver-type
 * strings (`csharp\0List<Tile>`), because a warm at one receiver serves
 * substituted signatures that are wrong at any receiver of another element
 * type (78 of 79 fills wrong at the measured List<Stripe> site, review-p3.md
 * finding 1) — keyed by STRIPPED name plus kind. A fill only ever ADDS a
 * signature to a member that has none — the site's own resolved signature
 * (which may even be receiver-substituted) always wins over the cache, and
 * everything else on the member rides through untouched.
 */

import { CompletionMember, MemberKind } from "./extraction";
import { isCsObjectDeclaredMember } from "./csExtraction";

/** Roslyn labels every generic method with a trailing empty-generic marker:
 *  `Where<>`, not `Where` (measure-chains.md — a cache key or gate comparison
 *  that forgets this never matches). Strip exactly that marker and nothing
 *  else: genuine angle content (`Cache<T>`) is a real name in non-Roslyn
 *  surfaces and mangling it would corrupt their keys. */
export function stripGenericLabel(name: string): string {
  return name.endsWith("<>") ? name.slice(0, -2) : name;
}

/** One absorbed signature plus the KIND it was absorbed from. The kind rides
 *  along because the stripped-name key collapses C#'s `Count` property and
 *  `Count<>` method onto one entry (review-p3 finding 7): without it, a
 *  property getter cached first would fill a starved method member with an
 *  uncallable signature. Fill refuses a kind mismatch instead. */
interface ChainEntry {
  signature: string;
  kind: MemberKind;
}

/** Per-workspace store of absorbed signatures. The namespace string is OPAQUE
 *  to this module — callers pick the granularity, and isolation between two
 *  namespace strings is the whole mechanism: a C# absorb can never fill a
 *  Rust member, and (triage-p3 finding 1) a `csharp\0List<Tile>` absorb can
 *  never fill a `csharp\0List<Stripe>` site. */
export interface ChainCache {
  readonly namespaces: Map<string, Map<string, ChainEntry>>;
}

export function createChainCache(): ChainCache {
  return { namespaces: new Map() };
}

/** Feed resolved signatures into a namespace, keyed by stripped name. A later
 *  absorb fills gaps but never overwrites an existing entry: the first
 *  signature absorbed for a name owns it, so a re-warm cannot churn what
 *  earlier fills already served. Signatureless members absorb nothing. */
export function absorbChainSurface(
  cache: ChainCache,
  namespace: string,
  members: ReadonlyArray<CompletionMember>,
): void {
  let ns = cache.namespaces.get(namespace);
  if (ns === undefined) {
    ns = new Map();
    cache.namespaces.set(namespace, ns);
  }
  for (const member of members) {
    if (member.signature === undefined) {
      continue;
    }
    const key = stripGenericLabel(member.name);
    if (!ns.has(key)) {
      ns.set(key, { signature: member.signature, kind: member.kind });
    }
  }
}

/** The C# warm's absorb: Object-declared signatures are excluded BEFORE the
 *  cache ever sees them, via the same predicate the completion builder uses.
 *  Two reasons, both load-bearing:
 *  - a cached static `bool object.Equals(object?, object?)` filled onto a
 *    user's own starved `Equals` override is a WRONG signature, and the goal
 *    amendment outlaws wrong substitutions (an unsubstituted generic is
 *    acceptable, a wrong claim is not);
 *  - the phase-2 C# tier stamp is safe only while tier 1 implies no signature
 *    (review-p2 target 2): a fill that gave a tier-1 member a signature would
 *    make it vanish from the empty-partial block instead of staying inert.
 *  The completion builder already withholds these signatures at the site;
 *  this guard keeps the invariant even for a warm path that hands raw
 *  resolved signatures straight to the cache.
 *
 *  Returns how many NEW entries the absorb added, for the warm's evidence
 *  line — the cache stays opaque to its callers.
 *
 *  `namespace` is the per-receiver-type string the provider derives at fire
 *  time (`csharp\0List<Tile>`, triage-p3 finding 1), so a warm's entries only
 *  ever serve receivers of the same type. The bare-`csharp` default exists
 *  for facade-level rows; the product always passes the derived namespace. */
export function absorbCsWarmSurface(
  cache: ChainCache,
  members: ReadonlyArray<CompletionMember>,
  namespace: string = "csharp",
): number {
  const before = cache.namespaces.get(namespace)?.size ?? 0;
  absorbChainSurface(
    cache,
    namespace,
    members.filter((m) => !isCsObjectDeclaredMember(m.signature)),
  );
  return (cache.namespaces.get(namespace)?.size ?? 0) - before;
}

/** Merge the cache into a member list: a member LACKING a signature gets the
 *  namespace's entry for its STRIPPED name, and only when the entry's KIND
 *  matches the member's (the property-under-a-method-key guard); everything
 *  else — an existing signature, the name as served (the gate's memberNames
 *  matches on it), kind, tier, any other field — rides through untouched.
 *  Unknown names pass through unchanged. Order and count are preserved: fill
 *  is a merge, never a filter. The input array is not mutated. */
export function fillMissingSignatures(
  members: CompletionMember[],
  cache: ChainCache,
  namespace: string,
): CompletionMember[] {
  const ns = cache.namespaces.get(namespace);
  if (ns === undefined || ns.size === 0) {
    return members;
  }
  return members.map((member) => {
    if (member.signature !== undefined) {
      return member;
    }
    const entry = ns.get(stripGenericLabel(member.name));
    return entry === undefined || entry.kind !== member.kind ? member : { ...member, signature: entry.signature };
  });
}
