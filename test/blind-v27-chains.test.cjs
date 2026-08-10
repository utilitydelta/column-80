// BLIND ORACLE - session-v27 phase 3: the chain-surface cache. Pins the frozen
// facade in `session-v27/session-state.md` ("Phase 3 facade") against the
// measured reality in `session-v27/measure-chains.md`: Roslyn starves the chain
// vocabulary at a List<Tile> receiver (Where<> at position 113 of 115, resolve
// cap 32 head-of-order, so the verbs never carry a signature and the narrowed
// block goes dark exactly where chains live). The fix under test: a
// once-per-workspace absorb of the Enumerable static surface, cached by
// STRIPPED name per language namespace, merged into any member whose signature
// is missing.
//
// Nothing here has read src/. RED by design until `src/core/chainSurface.ts`
// exists; the bundle guard is the single loud failure until then, every other
// row skips.
//
// WHAT IT PINS
//   S   stripGenericLabel strips ONLY the trailing empty-generic label Roslyn
//       emits ("Where<>" -> "Where"); genuine angle content is untouched.
//   C1  a fresh cache is empty: fill over it changes nothing.
//   C2  absorb keys by stripped name; a "Where<>" absorb fills both a
//       "Where<>"-labeled and a plain-"Where" site member.
//   C3  a later absorb fills gaps, never overwrites an existing entry.
//   C4  absorbing the same surface twice equals once.
//   C5  language namespaces are isolated, both directions.
//   F1  an existing signature is NEVER overridden, even when the cache
//       disagrees.
//   F2  fill touches nothing but the missing signature: name, kind, tier and
//       unknown extra fields ride through on filled and unfilled members alike.
//   F3  unknown names pass through unchanged.
//   F4  order and count are preserved: 115 in, 115 out, same names same order.
//   F5  filling twice equals filling once.
//   M   the measured C# reality end to end: absorb the Enumerable-shaped
//       surface, fill the 115-member List<Tile> surface; the chain verbs come
//       back signatured, the natively-signatured heads (Add, AddRange) keep
//       their own.
//   R1  render integration: after filling, renderFimCandidates at partial "W"
//       carries the Where signature - the capture's dark site, lit. The
//       unfilled control does not carry it (the input holds no such text, so
//       the renderer cannot invent it).
//   R2  at empty partial the filled surface renders without throwing. Its
//       tier/content behavior is phase 2's suite, deliberately NOT pinned here.
//
// SHAPES ASSUMED (the facade does not spell them; conventions taken from
// blind-v24-p2-surface.test.cjs):
//   * CompletionMember literals are `{ name, kind, signature? }` with string
//     kinds ("method", "field"); a missing signature is an ABSENT/undefined
//     key, never "".
//   * `tier` is carried as an opaque extra field (numbers here); pass-through
//     must not care about its value.
//   * renderFimCandidates is called `(members, partial)` exactly as
//     blind-v24-p2 B11b calls it; any phase-2 arity growth must be additive.
//   * Equality is checked on OWN KEYS WITH DEFINED VALUES (`essence` below),
//     so an implementation that spreads `signature: undefined` onto an
//     untouched member is not redded for a harness reason.
//   * fillMissingSignatures is compared on its RETURN value only; whether it
//     mutates its input is not part of the facade and is not pinned.
//
// Run: node --test test/blind-v27-chains.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const { bundleCore } = require("./.blind-util.cjs");

// ===========================================================================
// Bundle. chainSurface does not exist yet: ONE loud failure here, every
// contract row skips - never a wall of TypeErrors mistakable for contract
// failures.
// ===========================================================================

let B = {};
let cleanup;
let bundleErr;
try {
  const r = bundleCore(
    "v27chains",
    `export * from "../src/core/chainSurface";\nexport * from "../src/core/fimInject";\n`,
  );
  B = r.mod;
  cleanup = r.cleanup;
} catch (e) {
  bundleErr = e;
}
test.after(() => {
  if (cleanup) cleanup();
  else
    for (const f of [".v27chains.entry.ts", ".v27chains.bundle.cjs"])
      fs.rmSync(path.join(__dirname, f), { force: true });
});

test("bundle guard: chainSurface + fimInject build headless and export the phase-3 facade", () => {
  if (bundleErr) assert.fail(`bundle failed to build: ${bundleErr.message}`);
  for (const n of ["stripGenericLabel", "createChainCache", "absorbChainSurface", "fillMissingSignatures"]) {
    assert.strictEqual(typeof B[n], "function", `${n} must be an exported function of src/core/chainSurface`);
  }
  assert.strictEqual(typeof B.renderFimCandidates, "function", "renderFimCandidates must ride the same bundle (render integration)");
});

const btest = (name, fn) =>
  test(name, (ctx) => {
    if (bundleErr) return ctx.skip("bundle failed to build; see the bundle guard");
    return fn(ctx);
  });

// ===========================================================================
// Fixtures: the measured shapes from measure-chains.md, minimal literals.
// ===========================================================================

// Unsubstituted TSource forms, exactly the class of string the resolve
// documentation yields (goal amendment: serving these as-is is acceptable).
const WHERE_SIG =
  "(extension) IEnumerable<TSource> IEnumerable<TSource>.Where<TSource>(Func<TSource, bool> predicate)";
const SELECT_SIG =
  "(extension) IEnumerable<TResult> IEnumerable<TSource>.Select<TSource, TResult>(Func<TSource, TResult> selector)";
const SUM_SIG =
  "(extension) int IEnumerable<TSource>.Sum<TSource>(Func<TSource, int> selector)";
const COUNT_SIG = "(extension) int IEnumerable<TSource>.Count<TSource>()";
const ADD_SIG = "void List<Tile>.Add(Tile item)";
const ADDRANGE_SIG = "void List<Tile>.AddRange(IEnumerable<Tile> collection)";

// The Enumerable-shaped static surface as the warm absorbs it: Roslyn labels
// every generic method with the trailing empty-generic form.
const enumerableSurface = () => [
  { name: "Where<>", kind: "method", signature: WHERE_SIG },
  { name: "Select<>", kind: "method", signature: SELECT_SIG },
  { name: "Sum<>", kind: "method", signature: SUM_SIG },
  { name: "Count<>", kind: "method", signature: COUNT_SIG },
];

// The List<Tile>-shaped 115-member site surface: natively-signatured heads
// (the resolve cap reached them, alphabetical order), the chain verbs deep in
// the tail with NO signature (Where<> at index 112 = position 113 of 115, the
// measured spot), and signatureless fillers everywhere else. No filler starts
// with "W", so "Where<>" is the only W-name at the site.
function listTileSurface() {
  const out = new Array(115);
  out[0] = { name: "Add", kind: "method", signature: ADD_SIG };
  out[1] = { name: "AddRange", kind: "method", signature: ADDRANGE_SIG };
  out[30] = { name: "Count<>", kind: "method" };
  out[90] = { name: "Select<>", kind: "method" };
  out[100] = { name: "Sum<>", kind: "method" };
  out[112] = { name: "Where<>", kind: "method" };
  for (let i = 0; i < 115; i++) {
    if (!out[i]) out[i] = { name: `Filler${String(i).padStart(3, "0")}`, kind: "method" };
  }
  return out;
}

// Own enumerable keys with DEFINED values - the comparison surface. Keeps a
// conforming `{...m, signature: undefined}` spread from redding for a harness
// reason while still catching any real field change.
const stripUndef = (m) => {
  const o = {};
  for (const k of Object.keys(m)) if (m[k] !== undefined) o[k] = m[k];
  return o;
};
const essence = (ms) => ms.map(stripUndef);

// ===========================================================================
// S - stripGenericLabel
// ===========================================================================

btest("S: stripGenericLabel strips only the trailing empty-generic label Roslyn emits", () => {
  const rows = [
    ["Where<>", "Where"],
    ["AddRange<>", "AddRange"],
    ["Sum<>", "Sum"],
    ["Add", "Add"],
    ["roll_active", "roll_active"],
    // Genuine angle content is NOT the Roslyn empty-generic form; mangling
    // these corrupts cache keys for non-Roslyn surfaces.
    ["Cache<T>", "Cache<T>"],
    ["Select<TSource, TResult>", "Select<TSource, TResult>"],
  ];
  for (const [input, want] of rows) {
    assert.strictEqual(
      B.stripGenericLabel(input),
      want,
      `stripGenericLabel(${JSON.stringify(input)}) must be ${JSON.stringify(want)}`,
    );
  }
});

// ===========================================================================
// C - cache semantics
// ===========================================================================

btest("C1: a fresh cache is empty - fill over it returns every member unchanged", () => {
  const cache = B.createChainCache();
  const members = listTileSurface();
  const before = essence(members);
  const out = B.fillMissingSignatures(members, cache, "csharp");
  assert.deepStrictEqual(essence(out), before, "an empty cache must fill nothing and change nothing");
});

btest("C2: absorb keys by STRIPPED name - a Where<> absorb fills both the Where<>-labeled and the plain-Where site member", () => {
  const cache = B.createChainCache();
  B.absorbChainSurface(cache, "csharp", [{ name: "Where<>", kind: "method", signature: WHERE_SIG }]);
  const out = B.fillMissingSignatures(
    [
      { name: "Where<>", kind: "method" },
      { name: "Where", kind: "method" },
    ],
    cache,
    "csharp",
  );
  assert.strictEqual(out[0].signature, WHERE_SIG, "the Roslyn-labeled site member (Where<>) must resolve through the stripped key");
  assert.strictEqual(out[1].signature, WHERE_SIG, "a plain-named site member (Where) must resolve through the same stripped key");
});

btest("C3: a second absorb fills gaps but never overwrites an existing signature entry", () => {
  const cache = B.createChainCache();
  // First absorb: Where carries a signature, Take does not (a failed resolve).
  B.absorbChainSurface(cache, "csharp", [
    { name: "Where<>", kind: "method", signature: WHERE_SIG },
    { name: "Take<>", kind: "method" },
  ]);
  // Second absorb: Take's gap is fillable; Where's entry is NOT overwritable.
  const TAKE_SIG = "(extension) IEnumerable<TSource> IEnumerable<TSource>.Take<TSource>(int count)";
  B.absorbChainSurface(cache, "csharp", [
    { name: "Where<>", kind: "method", signature: "DECOY - a later absorb must never win over an existing entry" },
    { name: "Take<>", kind: "method", signature: TAKE_SIG },
  ]);
  const out = B.fillMissingSignatures(
    [
      { name: "Where<>", kind: "method" },
      { name: "Take<>", kind: "method" },
    ],
    cache,
    "csharp",
  );
  assert.strictEqual(out[0].signature, WHERE_SIG, "the FIRST absorbed signature owns the entry; the decoy must lose");
  assert.strictEqual(out[1].signature, TAKE_SIG, "a gap left by the first absorb must be fillable by the second");
});

btest("C4: absorbing the same surface twice equals absorbing it once", () => {
  const once = B.createChainCache();
  B.absorbChainSurface(once, "csharp", enumerableSurface());
  const twice = B.createChainCache();
  B.absorbChainSurface(twice, "csharp", enumerableSurface());
  B.absorbChainSurface(twice, "csharp", enumerableSurface());
  const site = listTileSurface();
  assert.deepStrictEqual(
    essence(B.fillMissingSignatures(site, twice, "csharp")),
    essence(B.fillMissingSignatures(site, once, "csharp")),
    "a re-absorb of the identical surface must change no fill result",
  );
});

btest("C5: language namespaces are isolated - a csharp absorb never fills a rust member, and vice versa", () => {
  const cache = B.createChainCache();
  B.absorbChainSurface(cache, "csharp", enumerableSurface());
  B.absorbChainSurface(cache, "rust", [
    { name: "filter", kind: "method", signature: "filter(self, P) -> Filter<Self, P>" },
  ]);

  // Direction 1: rust fill must not see csharp's Where.
  const rustOut = B.fillMissingSignatures([{ name: "Where<>", kind: "method" }], cache, "rust");
  assert.strictEqual(rustOut[0].signature, undefined, "rust's namespace holds no Where; a cross-language fill is a contamination bug");

  // Direction 2: csharp fill must not see rust's filter.
  const csOut = B.fillMissingSignatures([{ name: "filter", kind: "method" }], cache, "csharp");
  assert.strictEqual(csOut[0].signature, undefined, "csharp's namespace holds no filter; a cross-language fill is a contamination bug");

  // And each language still fills from its OWN namespace in the same cache.
  assert.strictEqual(
    B.fillMissingSignatures([{ name: "filter", kind: "method" }], cache, "rust")[0].signature,
    "filter(self, P) -> Filter<Self, P>",
    "rust must still fill rust",
  );
  assert.strictEqual(
    B.fillMissingSignatures([{ name: "Where<>", kind: "method" }], cache, "csharp")[0].signature,
    WHERE_SIG,
    "csharp must still fill csharp",
  );
});

// ===========================================================================
// F - fillMissingSignatures
// ===========================================================================

btest("F1: an existing signature is never overridden, even when the cache disagrees", () => {
  const cache = B.createChainCache();
  B.absorbChainSurface(cache, "csharp", [
    { name: "Add", kind: "method", signature: "DECOY - a live signature must always beat the cache" },
  ]);
  const out = B.fillMissingSignatures([{ name: "Add", kind: "method", signature: ADD_SIG }], cache, "csharp");
  assert.strictEqual(
    out[0].signature,
    ADD_SIG,
    "the site's own resolved signature is the truth (it may even be substituted); the cache serves only the starved",
  );
});

btest("F2: fill touches nothing but the missing signature - name, kind, tier and unknown fields ride through", () => {
  const cache = B.createChainCache();
  B.absorbChainSurface(cache, "csharp", enumerableSurface());
  const out = B.fillMissingSignatures(
    [
      // Filled member: everything but signature must survive byte-identical.
      { name: "Where<>", kind: "method", tier: 1, provenance: "probe" },
      // Untouched member: everything survives, including its tier.
      { name: "Add", kind: "method", signature: ADD_SIG, tier: 0 },
    ],
    cache,
    "csharp",
  );
  assert.strictEqual(out[0].name, "Where<>", "fill must not rename the member; the gate's memberNames set matches on the served label");
  assert.strictEqual(out[0].kind, "method", "kind must pass through");
  assert.strictEqual(out[0].tier, 1, "tier must pass through untouched (phase 2's plumbing rides this field)");
  assert.strictEqual(out[0].provenance, "probe", "unknown fields must pass through untouched");
  assert.strictEqual(out[0].signature, WHERE_SIG, "the one field fill exists to set");
  assert.deepStrictEqual(
    stripUndef(out[1]),
    { name: "Add", kind: "method", signature: ADD_SIG, tier: 0 },
    "a natively-signatured member must come back whole",
  );
});

btest("F3: unknown names pass through unchanged", () => {
  const cache = B.createChainCache();
  B.absorbChainSurface(cache, "csharp", enumerableSurface());
  const members = [
    { name: "Frobnicate", kind: "method" },
    { name: "Filler042", kind: "field" },
  ];
  const out = B.fillMissingSignatures(members, cache, "csharp");
  assert.deepStrictEqual(essence(out), essence(members), "a name the cache never absorbed must ride through untouched, still signatureless");
});

btest("F4: order and count are preserved over the 115-member surface - no drops, no additions, no reorders", () => {
  const cache = B.createChainCache();
  B.absorbChainSurface(cache, "csharp", enumerableSurface());
  const site = listTileSurface();
  const out = B.fillMissingSignatures(site, cache, "csharp");
  assert.strictEqual(out.length, 115, "115 in, 115 out - fill is a merge, never a filter");
  assert.deepStrictEqual(
    out.map((m) => m.name),
    site.map((m) => m.name),
    "the provider's order is the product's order downstream; fill must not move a member",
  );
});

btest("F5: filling twice equals filling once", () => {
  const cache = B.createChainCache();
  B.absorbChainSurface(cache, "csharp", enumerableSurface());
  const once = B.fillMissingSignatures(listTileSurface(), cache, "csharp");
  const twice = B.fillMissingSignatures(
    B.fillMissingSignatures(listTileSurface(), cache, "csharp"),
    cache,
    "csharp",
  );
  assert.deepStrictEqual(essence(twice), essence(once), "fill over an already-filled surface must be a no-op");
});

// ===========================================================================
// M - the measured C# reality, end to end
// ===========================================================================

btest("M: the Enumerable absorb lights the List<Tile> chain verbs; the native heads keep their own signatures", () => {
  const cache = B.createChainCache();
  B.absorbChainSurface(cache, "csharp", enumerableSurface());
  const out = B.fillMissingSignatures(listTileSurface(), cache, "csharp");
  const byName = new Map(out.map((m) => [m.name, m]));

  // The starved verbs, lit from the cache (measure-chains: Where<> at position
  // 113 of 115, forever past the resolve cap without this).
  for (const [name, sig] of [
    ["Where<>", WHERE_SIG],
    ["Select<>", SELECT_SIG],
    ["Sum<>", SUM_SIG],
    ["Count<>", COUNT_SIG],
  ]) {
    assert.strictEqual(byName.get(name).signature, sig, `${name} is the starvation this module exists to fix; it must carry the cached signature`);
  }
  // The heads the resolve cap DID reach keep their own, never the cache's.
  assert.strictEqual(byName.get("Add").signature, ADD_SIG, "Add resolved natively and must keep its own signature");
  assert.strictEqual(byName.get("AddRange").signature, ADDRANGE_SIG, "AddRange resolved natively and must keep its own signature");
  // The fillers stay honest: no invented signatures anywhere.
  assert.strictEqual(byName.get("Filler042").signature, undefined, "a member the cache never saw must stay signatureless");
});

// ===========================================================================
// R - render integration through the EXISTING exported renderer
// ===========================================================================

btest("R1: after filling, renderFimCandidates at partial 'W' carries the Where signature - the capture's dark site, lit", () => {
  const cache = B.createChainCache();
  B.absorbChainSurface(cache, "csharp", enumerableSurface());
  const site = listTileSurface();

  // Control first: unfilled, the block cannot carry what the input does not
  // hold - this is the dark site the capture recorded.
  const dark = B.renderFimCandidates(site, "W");
  assert.ok(
    !String(dark).includes("Func<TSource, bool> predicate"),
    "precondition: the unfilled surface has no Where signature to render; if this fails the fixture is wrong, not the product",
  );

  const lit = String(B.renderFimCandidates(B.fillMissingSignatures(site, cache, "csharp"), "W"));
  assert.ok(
    /\bWhere\b/.test(lit),
    `the narrowed block at 'W' must name Where.\n  OUT:\n${lit}`,
  );
  assert.ok(
    lit.includes("Func<TSource, bool> predicate"),
    `the narrowed block at 'W' must carry the Where signature content; an empty narrowed block is the exact dark-site failure.\n  OUT:\n${lit}`,
  );
});

btest("R2: at empty partial the filled surface renders through the existing rules without throwing", () => {
  // Deliberately NOT pinning tier partitioning or empty-partial content -
  // that is phase 2's suite. This row only claims a filled member is a
  // legitimate input to the existing render path.
  const cache = B.createChainCache();
  B.absorbChainSurface(cache, "csharp", enumerableSurface());
  const out = B.renderFimCandidates(B.fillMissingSignatures(listTileSurface(), cache, "csharp"), "");
  assert.strictEqual(typeof out, "string", "the existing renderer must accept a filled surface at empty partial and return its usual string");
});
