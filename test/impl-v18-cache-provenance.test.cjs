// Implementer oracle: the provenance edges the blind contract set does not
// reach — the AND-composition of the two cache-eligibility rules, provenance
// on the promoted-alternate path, and the walk refusal's interaction with the
// manual multi-alternative read and with cross-file eviction.
// Complements test/blind-v18-cache-provenance.test.cjs.
//
// Run: npm test

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-v18-cache-provenance",
  `export { CompletionCache } from "../src/core/cache";
export { CompletionService } from "../src/core/completionService";
export { DEFAULT_FIM_CONFIG } from "../src/core/config";\n`
);
const { CompletionCache, CompletionService, DEFAULT_FIM_CONFIG } = mod;
test.after(cleanup);

const S = "\n// suffix\n";
const cfg = (o = {}) => ({ ...DEFAULT_FIM_CONFIG, debounceMs: 0, ...o });

// Counts model calls and returns a fixed text, so "was this served from cache"
// is answered by the call count rather than by the result's own claim.
function counting(text) {
  const calls = [];
  const fn = async (params) => {
    calls.push(params);
    return { text, ttftMs: 1, totalMs: 2 };
  };
  return { fn, calls };
}

// One store rule decides eligibility: a completion that degraded at an
// injectable site is not stored. Member-site status does NOT appear in it.
//
// Two rounds of review went into that. A member-site term is dead wherever it
// would be safe - the store refusal already closes the exact-hit path AND the
// walk, because an entry never written is reachable by neither - and harmful
// wherever it is reachable, which is only a language with no extractor at all,
// where refusing costs nine model calls to reproduce one call's output byte for
// byte. The table below is the reachable input space, so a future narrowing of
// the rule has to argue with a row rather than with a sentence.
const ELIGIBILITY = [
  {
    name: "plain site, no resolver: nothing to refuse",
    request: {},
    resolve: undefined,
    cacheable: true,
  },
  {
    name: "member site, gate ran, block injected",
    request: { memberSite: true, memberPartial: "", memberReceiver: "s" },
    resolve: () => ({ block: "// cands\n", memberNames: ["push"] }),
    cacheable: true,
  },
  {
    // Every language with no extractor: Go, Java, C++. `fimMemberSite` still
    // classifies the site, but no resolver is ever supplied, so there is no
    // mechanism that could have been bypassed and nothing for a refusal to buy.
    name: "member site, no resolver at all: unpoliceable, so caching costs nothing",
    request: { memberSite: true, memberPartial: "", memberReceiver: "s" },
    resolve: undefined,
    cacheable: true,
  },
  {
    name: "member site, resolver resolved nothing: degraded at an injectable site",
    request: { memberSite: true, memberPartial: "", memberReceiver: "s" },
    resolve: () => undefined,
    cacheable: false,
  },
  {
    // Round 5's defect. The resolver answered with the full member list and
    // simply rendered no block (no narrowed member carries a signature, or the
    // set is over the candidate cap). The gate ran, so the ghost is checked
    // rather than guessed - refusing to bank it made the walk refusal regenerate
    // a policed completion and discard it on every keystroke, 21 calls against a
    // productive block's 5.
    name: "member site, names but no block: the gate ran, so it banks",
    request: { memberSite: true, memberPartial: "", memberReceiver: "s" },
    resolve: () => ({ memberNames: ["push"] }),
    cacheable: true,
  },
  {
    // Rust's real shape: a block is resolved and injected, but no member list is
    // supplied, so the gate never runs. An earlier draft demanded the gate here
    // and made every Rust member site permanently uncacheable.
    name: "member site, block but no names: injected, never gated",
    request: { memberSite: true, memberPartial: "", memberReceiver: "s" },
    resolve: () => ({ block: "// cands\n" }),
    cacheable: true,
  },
  {
    name: "plain site, resolver resolved nothing: degraded at an injectable site",
    request: {},
    resolve: () => undefined,
    cacheable: false,
  },
];

for (const c of ELIGIBILITY) {
  test(`cache eligibility turns only on injection degrading — ${c.name}`, async () => {
    const g = counting("push(x);");
    const svc = new CompletionService(cfg(), g.fn);
    const req = {
      prefix: "let s = vec![];\ns.",
      suffix: S,
      ...c.request,
      ...(c.resolve ? { resolveInjection: async () => c.resolve() } : {}),
    };
    const first = await svc.complete(req);
    assert.ok(first !== undefined, "precondition: the ghost survives to be returned");
    assert.strictEqual(g.calls.length, 1, "precondition: the first call reached the model");

    await svc.complete({ ...req });
    assert.strictEqual(
      g.calls.length,
      c.cacheable ? 1 : 2,
      c.cacheable
        ? "an eligible completion is served from cache on the repeat"
        : "an ineligible completion must be regenerated, not served",
    );
  });
}

test("a promoted alternate is cached with the primary's provenance, not with a blank one", async () => {
  // The primary is gate-dropped and an alternate is promoted into its place.
  // The promoted text is still a member-site, gated completion: if it were
  // stored as untracked it would walk into member sites unchecked, which is
  // the exact defect this phase closes, reintroduced through the extras path.
  const texts = ["invented(x);", "push(x);"];
  let i = 0;
  const calls = [];
  const generate = async (params) => {
    calls.push(params);
    return { text: texts[Math.min(i++, texts.length - 1)], ttftMs: 1, totalMs: 2 };
  };
  const logs = [];
  const svc = new CompletionService(cfg(), generate, (l) => logs.push(l));
  const req = {
    prefix: "let s = vec![];\ns.",
    suffix: S,
    manual: true,
    alternatives: 2,
    memberSite: true,
    memberPartial: "",
    memberReceiver: "s",
    resolveInjection: async () => ({ block: "// cands\n", memberNames: ["push"] }),
  };
  const first = await svc.complete(req);
  assert.strictEqual(first?.text, "push(x);", "precondition: the invented primary was dropped and the alternate promoted");

  // Read it back at a member site: it must serve, which it can only do if its
  // stored provenance says memberSite AND gated.
  const again = await svc.complete({ ...req, manual: false, alternatives: undefined });
  assert.strictEqual(again?.fromCache, true, "the promoted alternate was cached");
  const hit = logs.filter((l) => l.startsWith("[fim] cache hit")).pop();
  assert.match(hit, /memberSite=true/, "cached with the authoring site's real provenance");
  assert.match(hit, /gated=true/, "and with the gate's real state");
});

test("the manual multi-alternative path skips the read entirely, so the refusal cannot apply to it", async () => {
  const g = counting("push(x);");
  const svc = new CompletionService(cfg(), g.fn);
  const base = { prefix: "let s = vec![];\ns.", suffix: S };
  await svc.complete(base);
  assert.strictEqual(g.calls.length, 1);
  // A cached entry exists and an ordinary repeat would hit it.
  await svc.complete({ ...base });
  assert.strictEqual(g.calls.length, 1, "precondition: the ordinary repeat is a cache hit");
  // The manual fan-out asked for fresh options and must not be answered by one
  // cached text, refusal or no refusal.
  await svc.complete({ ...base, manual: true, alternatives: 3 });
  assert.strictEqual(g.calls.length, 4, "the fan-out generated afresh: 1 primary + 2 extras");
});

test("a refused walk candidate stays refused after an unrelated entry is evicted around it", () => {
  // The refusal must be a read-time decision about the CURRENT site, not a
  // property that decays as the cache churns.
  const c = new CompletionCache(10);
  c.set("let s = vec![];\ns", S, ".tally();", "file:///a.rs", {
    memberSite: false,
    injected: false,
    gated: false,
  });
  for (let i = 0; i < 5; i++) {
    c.set(`zz${i};\n`, S, "filler", "file:///a.rs");
  }
  assert.strictEqual(
    c.lookup("let s = vec![];\ns.", S, true),
    undefined,
    "still refused at a member site after churn",
  );
  assert.strictEqual(
    c.lookup("let s = vec![];\ns.", S, false)?.completion,
    "tally();",
    "and still servable at a non-member site",
  );
});

// Provenance is per-receiver. A gated entry proves something about the receiver
// it was authored against, and typing a `.`/`::` moves the cursor onto a new one
// the gate has never seen.
const SEPARATOR_WALK = [
  { typed: "tileTally().f", serves: false, why: "`.` in the typed span: a new receiver" },
  { typed: "Stripe::n", serves: false, why: "`::` in the typed span: a new receiver" },
  { typed: "tileT", serves: true, why: "no separator: still the base's receiver" },
  { typed: "t", serves: true, why: "one character in, plainly the same site" },
];

for (const c of SEPARATOR_WALK) {
  test(`the walk stops at a receiver boundary — ${c.why}`, () => {
    const cache = new CompletionCache(10);
    const ghost = "tileTally().fanout();";
    const alt = "Stripe::new();";
    const base = "let store = mk();\nstore.";
    const completion = c.typed.startsWith("Stripe") ? alt : ghost;
    cache.set(base, S, completion, "file:///a.rs", {
      memberSite: true,
      injected: true,
      gated: true,
    });
    const hit = cache.lookup(base + c.typed, S, true);
    if (c.serves) {
      assert.strictEqual(
        hit?.completion,
        completion.slice(c.typed.length),
        "a walk that never left the base receiver still serves",
      );
    } else {
      assert.strictEqual(hit, undefined, "the gate's evidence does not describe this receiver");
    }
    // The refusal is about the member site, not about the walk in general.
    assert.strictEqual(
      cache.lookup(base + c.typed, S, false)?.completion,
      completion.slice(c.typed.length),
      "at a non-member position the same walk is unaffected",
    );
  });
}

test("a store refusal is announced, because it silently costs a model call per keystroke", async () => {
  const logs = [];
  const g = counting("push(x);");
  const svc = new CompletionService(cfg(), g.fn, (l) => logs.push(l));
  await svc.complete({
    prefix: "let s = vec![];\ns.",
    suffix: S,
    memberSite: true,
    memberPartial: "",
    memberReceiver: "s",
    resolveInjection: async () => undefined,
  });
  const line = logs.find((l) => l.startsWith("[fim] not cached:"));
  assert.ok(line, "the refusal reaches the channel rather than being inferred from a hit rate");
  assert.match(line, /injected=false/, "and names the state that caused it");
  assert.match(line, /memberSite=true/);
  assert.match(line, /gated=false/);

  // The successful path must stay quiet: a refusal line on every cached
  // completion would be noise on the hot path, not signal.
  const quiet = [];
  const g2 = counting("push(x);");
  const svc2 = new CompletionService(cfg(), g2.fn, (l) => quiet.push(l));
  await svc2.complete({ prefix: "let s = vec![];\ns.", suffix: S });
  assert.strictEqual(
    quiet.filter((l) => l.startsWith("[fim] not cached:")).length,
    0,
    "nothing announced when the entry was stored",
  );
});

test("retainOnly drops a provenance-bearing entry by uri like any other", () => {
  const c = new CompletionCache(10);
  c.set("aa.", S, "push();", "file:///a.rs", { memberSite: true, injected: true, gated: true });
  c.set("bb.", S, "push();", "file:///b.rs", { memberSite: true, injected: true, gated: true });
  c.retainOnly("file:///a.rs");
  assert.ok(c.lookup("aa.", S, true) !== undefined, "same-document entry survives");
  assert.strictEqual(c.lookup("bb.", S, true), undefined, "foreign entry evicted");
});
