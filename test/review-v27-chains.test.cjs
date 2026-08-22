// review-v27-chains: phase-3 adversarial review rows.
// Target 3 of the review order: fill placement and gate integrity. The blind
// oracle owns the facade contract; these rows pin what the fill may NEVER do
// to the surfaces AROUND it in resolveInjection (completionProvider.ts:510):
//   * the enforcement set (memberNames) is byte-identical with and without the
//     cache fill, at the empty and the typed partial;
//   * fill sits AFTER semanticMembers and cannot resurrect a member an
//     earlier filter dropped, nor add one the cache knows but the site did
//     not serve;
//   * a tier-1 member the cache fills still leaves the empty-partial block
//     (the phase-2 arm-D invariant survives the new fill) while its name
//     stays in the gate;
//   * a fully-resolved surface renders a byte-identical block whether the
//     cache is loaded or not.
// One row was an explicit HAZARD PIN freezing the cross-receiver
// wrong-signature serve at a typed partial. Flipped 2026-07-26 to isolation
// assertions per triage-p3.md finding 5 (pre-announced there): per-receiver-
// type namespacing landed, the provider derives `csharp\0<receiverType>` and
// the foreign signature can no longer reach another type's namespace.
//
// Run: SKIP_LIVE=1 node --test test/review-v27-chains.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod: B, cleanup } = bundleCore(
  "reviewv27chains",
  `export { createChainCache, absorbChainSurface, absorbCsWarmSurface, fillMissingSignatures } from "../src/core/chainSurface";
export { semanticMembers } from "../src/core/extraction";
export { renderFimCandidates } from "../src/core/fimInject";\n`,
);
test.after(() => cleanup());

const WHERE_SIG =
  "(extension) IEnumerable<TSource> IEnumerable<TSource>.Where<TSource>(Func<TSource, bool> predicate)";
const ADD_SIG = "void List<Tile>.Add(Tile item)";

// A starved C# member surface as resolveInjection sees it BEFORE
// semanticMembers: resolved heads, a starved tail, and one editor word-based
// fallback item (kind "text") whose name the cache also knows.
const rawSurface = () => [
  { name: "Add", kind: "method", signature: ADD_SIG },
  { name: "Equals", kind: "method", tier: 1 },
  { name: "Where<>", kind: "method" },
  { name: "Sum<>", kind: "method" },
  { name: "Where", kind: "text" }, // editor fallback, dropped by semanticMembers
];

const loadedCache = () => {
  const cache = B.createChainCache();
  B.absorbChainSurface(cache, "csharp", [
    { name: "Where<>", kind: "method", signature: WHERE_SIG },
    { name: "Sum<>", kind: "method", signature: "(extension) int IEnumerable<TSource>.Sum<TSource>()" },
    // A NON-object-declared Equals, the shape a warm at a StringBuilder-class
    // receiver absorbs (bool StringBuilder.Equals(StringBuilder? sb) is not
    // caught by the Object-declared exclusion).
    { name: "Equals", kind: "method", signature: "bool StringBuilder.Equals(StringBuilder? sb)" },
    // A name the site never served: fill must not be able to add it.
    { name: "TakeWhile<>", kind: "method", signature: "(extension) IEnumerable<TSource> IEnumerable<TSource>.TakeWhile<TSource>(Func<TSource, bool> predicate)" },
  ]);
  return cache;
};

// The provider's exact sequence (completionProvider.ts:510): semanticMembers
// first, fill second, gate names off the filled list.
const providerMembers = (cache) =>
  B.fillMissingSignatures(B.semanticMembers(rawSurface()), cache, "csharp");

test("gate: memberNames byte-identical with and without the cache fill, both partials", () => {
  const unfilled = B.semanticMembers(rawSurface());
  const filled = providerMembers(loadedCache());
  // The gate is members.map(name) (completionProvider.ts:593) - one JSON
  // string each side, compared as bytes.
  assert.strictEqual(
    JSON.stringify(filled.map((m) => m.name)),
    JSON.stringify(unfilled.map((m) => m.name)),
    "the enforcement set must not see the fill at all",
  );
  // And the block's own narrowed views agree on NAMES at both partials: the
  // fill may add signatures, never names.
  for (const partial of ["", "W"]) {
    const names = (ms) =>
      ms.filter((m) => partial === "" || m.name.startsWith(partial)).map((m) => m.name);
    assert.strictEqual(
      JSON.stringify(names(filled)),
      JSON.stringify(names(unfilled)),
      `partial ${JSON.stringify(partial)}: same names in play with and without the cache`,
    );
  }
});

test("placement: fill cannot resurrect the editor's word-based fallback semanticMembers dropped", () => {
  const filled = providerMembers(loadedCache());
  // The raw surface carried a kind:"text" item named "Where" that the cache
  // could fill; it was dropped BEFORE the fill and must stay dropped.
  assert.strictEqual(filled.length, 4, "semanticMembers dropped one of five; fill must not change the count");
  assert.ok(
    !filled.some((m) => m.kind === "text"),
    "no text-kind member may reappear after the fill",
  );
});

test("placement: the cache cannot add a member the site never served", () => {
  const filled = providerMembers(loadedCache());
  assert.ok(
    !filled.some((m) => m.name.startsWith("TakeWhile")),
    "TakeWhile lives in the cache but not at this site; fill is a merge over the site's list, never a union",
  );
});

test("tier invariant: a cache-filled tier-1 member still leaves the empty-partial block, name still gated", () => {
  const filled = providerMembers(loadedCache());
  const equals = filled.find((m) => m.name === "Equals");
  // Precondition of the attack: the fill DID give the tier-1 member a
  // signature (the phase-2 "tier 1 implies no signature" invariant is gone).
  assert.strictEqual(equals.signature, "bool StringBuilder.Equals(StringBuilder? sb)");
  assert.strictEqual(equals.tier, 1, "fill must not touch tier");
  const block = String(B.renderFimCandidates(filled, "") ?? "");
  assert.ok(
    !block.includes("Equals"),
    `arm D holds under the fill: the tier-1 member stays out of the empty-partial block even WITH a signature.\n  BLOCK:\n${block}`,
  );
  assert.ok(
    filled.map((m) => m.name).includes("Equals"),
    "the gate still carries the name - the block steers, the gate never narrows",
  );
});

test("ISOLATION (was HAZARD PIN; flipped 2026-07-26 per triage-p3 finding 5): a foreign type's Equals never reaches another type's namespace", () => {
  // The original pin froze the cross-receiver serve: a StringBuilder.Equals
  // absorbed by a warm rendered at another receiver's typed partial `Eq`.
  // Triage-p3 ruled per-receiver-type namespacing (finding 1) instead of an
  // extra exclusion (finding 5 deleted), and pre-announced this flip: the
  // provider now derives `csharp\0<receiverType>` at fire time and passes the
  // SAME string to absorb and fill, so the hazard shape becomes an isolation
  // assertion. The facade-level rows above keep using one shared string on
  // both sides, which is exactly why they still hold; this row drives the two
  // strings the provider actually produces.
  const cache = B.createChainCache();
  B.absorbCsWarmSurface(
    cache,
    [{ name: "Equals", kind: "method", signature: "bool StringBuilder.Equals(StringBuilder? sb)" }],
    "csharp\0StringBuilder",
  );
  const atListTile = B.fillMissingSignatures(
    B.semanticMembers(rawSurface()),
    cache,
    "csharp\0List<Tile>",
  );
  assert.strictEqual(
    atListTile.find((m) => m.name === "Equals").signature,
    undefined,
    "the StringBuilder namespace's entry must be invisible at a List<Tile> site",
  );
  const block = String(B.renderFimCandidates(atListTile, "Eq") ?? "");
  assert.ok(
    !block.includes("StringBuilder.Equals"),
    "the typed-partial block can no longer serve the cross-receiver signature",
  );
  // And at its OWN type the entry still serves - isolation, not deletion.
  const atStringBuilder = B.fillMissingSignatures(
    [{ name: "Equals", kind: "method" }],
    cache,
    "csharp\0StringBuilder",
  );
  assert.strictEqual(atStringBuilder[0].signature, "bool StringBuilder.Equals(StringBuilder? sb)");
});

test("no-op: a fully-resolved surface renders a byte-identical block whether the cache is loaded or not", () => {
  const resolved = [
    { name: "Add", kind: "method", signature: ADD_SIG },
    { name: "AddRange", kind: "method", signature: "void List<Tile>.AddRange(IEnumerable<Tile> collection)" },
  ];
  const bare = B.renderFimCandidates(resolved, "");
  const filled = B.renderFimCandidates(
    B.fillMissingSignatures(resolved, loadedCache(), "csharp"),
    "",
  );
  assert.strictEqual(filled, bare, "a receiver the resolve cap fully covered must not notice the cache exists");
});

test("warm-path guard: absorbCsWarmSurface + fill keeps an unresolved own Equals signatureless end to end", () => {
  // The impl row proves the absorb-side exclusion; this row proves the same
  // invariant through the provider's sequence: warm absorbs the REAL
  // object-declared statics, the site's unresolved Equals rides
  // semanticMembers + fill and comes out still signatureless (inert in every
  // block).
  const cache = B.createChainCache();
  B.absorbCsWarmSurface(cache, [
    { name: "Equals", kind: "method", signature: "bool object.Equals(object? objA, object? objB)" },
    { name: "Where<>", kind: "method", signature: WHERE_SIG },
  ]);
  const members = B.fillMissingSignatures(B.semanticMembers(rawSurface()), cache, "csharp");
  assert.strictEqual(members.find((m) => m.name === "Equals").signature, undefined);
  assert.strictEqual(members.find((m) => m.name === "Where<>").signature, WHERE_SIG);
});
