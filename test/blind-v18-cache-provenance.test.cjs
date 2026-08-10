// BLIND ORACLE - v18 phase 1 "cache provenance and the member-site walk
// refusal" [session-v18/phase1-surface.md]. Black-box over CompletionCache's
// new provenance surface and the CompletionService behaviour that rides on it.
// Never reads src/**: the entry re-exports the modules and esbuild resolves
// them at bundle time only. Written against the FROZEN CONTRACT, not the code.
//
// The defect being closed: the prefix walk moves a completion authored at
// cursor A to cursor B without checking that what was true at A still holds at
// B. A ghost authored at an ordinary statement position walks into a `.`/`::`
// member position, where a candidate block should have been injected and the
// member gate should have run. Measured consequence: the identical ghost is
// SUPPRESSED cold and SERVED warm, with no model call in between.
//
// Expected RED until phase 1 lands: `lookup` does not exist yet.
//
// Run: SKIP_LIVE=1 node --test test/blind-v18-cache-provenance.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

// `export *` for the cache so an absent `lookup` is a per-test red naming the
// missing surface, never one esbuild build error that collapses every test.
let mod = {};
let cleanup = () => {};
let bundleError;
try {
  const built = bundleCore(
    "blind-v18-cache-provenance",
    `export * from "../src/core/cache";
export { CompletionService } from "../src/core/completionService";\n`
  );
  mod = built.mod;
  cleanup = built.cleanup;
} catch (e) {
  bundleError = e;
}
test.after(() => cleanup());

test("harness: src/core/cache and src/core/completionService bundle [harness guard - any red here is a build problem, not a contract failure]", () => {
  if (bundleError) assert.fail(`the modules do not build: ${bundleError.message}`);
});

// A cache whose provenance-aware read is present, or an honest red saying which
// part of the surface is absent.
const newCache = (capacity) => {
  if (bundleError) assert.fail(`the modules do not build: ${bundleError.message}`);
  if (typeof mod.CompletionCache !== "function") {
    assert.fail("src/core/cache exports no CompletionCache");
  }
  const c = new mod.CompletionCache(capacity);
  if (typeof c.lookup !== "function") {
    assert.fail(
      `CompletionCache has no lookup(prefix, suffix, atMemberSite) - the phase-1 surface is absent (got ${typeof c.lookup})`
    );
  }
  return c;
};

const service = (...args) => {
  if (bundleError) assert.fail(`the modules do not build: ${bundleError.message}`);
  if (typeof mod.CompletionService !== "function") {
    assert.fail("src/core/completionService exports no CompletionService");
  }
  return new mod.CompletionService(...args);
};

// Table runner: one body, many cases, every failure reported together so a
// single run shows the whole shape of the gap rather than the first case.
const table = (rows, run, compare) => {
  const bad = [];
  for (const row of rows) {
    let got;
    try {
      got = run(row);
    } catch (e) {
      bad.push(`${row.name}: THREW ${e && e.message}`);
      continue;
    }
    try {
      compare(got, row);
    } catch (e) {
      bad.push(`${row.name}: ${e.message}`);
    }
  }
  if (bad.length) {
    assert.fail(`${bad.length}/${rows.length} cases failed:\n  - ${bad.join("\n  - ")}`);
  }
};

// Cache-hit log-line readers. Declared here rather than in section E because
// section D's eligibility rows also read provenance off the line - it is the
// only channel a black-box consumer has for the provenance of a stored entry.
const hitLine = (lines) => {
  const found = lines.filter((l) => l.startsWith("[fim] cache hit"));
  assert.strictEqual(
    found.length,
    1,
    `expected exactly one "[fim] cache hit" line, got ${JSON.stringify(lines)}`
  );
  return found[0];
};

const fields = (line) =>
  Object.fromEntries([...line.matchAll(/([A-Za-z][A-Za-z0-9]*)=(\S+)/g)].map((m) => [m[1], m[2]]));

const assertHitLine = (line, expected) => {
  const f = fields(line);
  for (const [key, want] of Object.entries(expected)) {
    assert.strictEqual(
      f[key],
      want,
      `line ${JSON.stringify(line)}: expected ${key}=${want}, got ${key}=${f[key]}`
    );
  }
};

// Distinct-head prefixes so nothing cross-hits via the prefix walk.
const S = "\n// suffix\n";
const PERMISSIVE = { memberSite: false, injected: false, gated: false };
const prov = (o = {}) => ({ ...PERMISSIVE, ...o });

// ===========================================================================
// A. CacheProvenance defaulting and round-trip [surface: "set(...provenance?)"
//    and "lookup(...) - the provenance-aware read"].
// ===========================================================================

test("A1. set without a provenance argument records the permissive default - non-member site, no injection, no gate [surface: 'Omitted, the entry records the permissive default']", () => {
  const c = newCache(10);
  c.set("aa;\n", S, "one()");
  const hit = c.lookup("aa;\n", S);
  assert.ok(hit, "an entry set without provenance is still a hit");
  assert.deepStrictEqual(hit.provenance, PERMISSIVE);
});

test("A2. set with an explicit uri but no provenance still records the permissive default - the optional 5th argument is independent of the 4th [surface: 'set(prefix, suffix, completion, uri?, provenance?)']", () => {
  const c = newCache(10);
  c.set("aa;\n", S, "one()", "file:///a.ts");
  const hit = c.lookup("aa;\n", S);
  assert.ok(hit, "an entry set with a uri and no provenance is still a hit");
  assert.deepStrictEqual(hit.provenance, PERMISSIVE);
});

const provenances = [
  { name: "all false (the permissive default, stated explicitly)", p: prov() },
  { name: "member site, injected, gated - the fully-evidenced authoring site", p: prov({ memberSite: true, injected: true, gated: true }) },
  { name: "member site, injected, NOT gated", p: prov({ memberSite: true, injected: true }) },
  { name: "member site, gated, NOT injected - names-only resolution", p: prov({ memberSite: true, gated: true }) },
  { name: "non-member site that nonetheless carried an injected block", p: prov({ injected: true }) },
];

test("A3. provenance round-trips unchanged through an EXACT hit, with walked false [surface: 'CacheHit.walked - false on an exact key match']", () => {
  table(
    provenances,
    (r) => {
      const c = newCache(10);
      c.set("aa;\n", S, "one()", undefined, r.p);
      return c.lookup("aa;\n", S);
    },
    (got, row) => {
      assert.ok(got, "exact key match must hit");
      assert.strictEqual(got.completion, "one()");
      assert.deepStrictEqual(got.provenance, row.p, "provenance travels with the entry");
      assert.strictEqual(got.walked, false, "an exact key match is not walked");
    }
  );
});

test("A4. provenance round-trips unchanged through a WALK hit, with walked true and the walk offset applied to completion [surface: 'CacheHit.completion - walk offset already applied']", () => {
  const base = "let z = 1;\n";
  const completion = "function greet() { return 1; }";
  const typed = "function gr";
  table(
    // A member-site base is the only one a member-position walk may serve; walk
    // here at a NON-member position so every provenance is eligible and the
    // case under test is the round-trip, not the refusal.
    provenances,
    (r) => {
      const c = newCache(10);
      c.set(base, S, completion, undefined, r.p);
      return c.lookup(base + typed, S, false);
    },
    (got, row) => {
      assert.ok(got, "the walk must hit");
      assert.strictEqual(got.completion, completion.slice(typed.length), "walk offset applied");
      assert.deepStrictEqual(got.provenance, row.p, "the AUTHORING site's provenance, not the reading site's");
      assert.strictEqual(got.walked, true, "reached by the prefix walk");
    }
  );
});

test("A5. re-setting an existing key replaces its provenance along with its completion [surface: 'Re-setting an existing key replaces its provenance']", () => {
  const c = newCache(10);
  c.set("aa;\n", S, "one()", undefined, prov({ memberSite: true, injected: true, gated: true }));
  c.set("aa;\n", S, "two()", undefined, prov());
  const hit = c.lookup("aa;\n", S);
  assert.ok(hit);
  assert.strictEqual(hit.completion, "two()");
  assert.deepStrictEqual(hit.provenance, PERMISSIVE, "the new provenance replaced the old, it did not merge");
});

test("A6. lookup returns undefined on a miss [surface: 'Returns undefined on a miss']", () => {
  const c = newCache(10);
  c.set("aa;\n", S, "one()");
  assert.strictEqual(c.lookup("zz;\n", S), undefined, "unrelated prefix misses");
  assert.strictEqual(c.lookup("aa;\n", "\n// other\n"), undefined, "the suffix must match exactly");
});

// ===========================================================================
// B. THE FIRST REFUSAL CONDITION - the reason this phase exists [surface: "The
//    refusal" and "Three consequences a consumer can rely on"]. A WALK
//    candidate whose provenance says memberSite:false is refused when the
//    CURRENT cursor is at a member site. The refusal is one-way. Every typed
//    span below crosses no `.` or `::`, so the second condition (section G)
//    cannot be what decides these cases.
// ===========================================================================

const WALK_BASE = "let z = 1;\n";
const WALK_COMPLETION = "tileTally();";
const WALK_TYPED = "tileTa";
const WALK_REMAINDER = WALK_COMPLETION.slice(WALK_TYPED.length);

const refusalCases = [
  {
    name: "non-member base -> member position: REFUSED (this is the defect)",
    p: prov({ memberSite: false }),
    at: true,
    serves: false,
  },
  {
    name: "non-member base that was injected and gated anyway -> member position: still REFUSED, memberSite is the field that decides",
    p: prov({ memberSite: false, injected: true, gated: true }),
    at: true,
    serves: false,
  },
  {
    name: "member-site base -> member position: SERVES, both sites had the same evidence available",
    p: prov({ memberSite: true, injected: true, gated: true }),
    at: true,
    serves: true,
  },
  {
    name: "member-site base with neither injection nor gate recorded -> member position: SERVES, only memberSite gates the walk",
    p: prov({ memberSite: true }),
    at: true,
    serves: true,
  },
  {
    name: "non-member base -> NON-member position: SERVES, the refusal is one-way",
    p: prov({ memberSite: false }),
    at: false,
    serves: true,
  },
  {
    name: "member-site base -> NON-member position: SERVES, a member-authored ghost is not refused anywhere",
    p: prov({ memberSite: true, injected: true, gated: true }),
    at: false,
    serves: true,
  },
  {
    name: "non-member base with atMemberSite OMITTED: SERVES, atMemberSite defaults to false",
    p: prov({ memberSite: false }),
    at: undefined,
    serves: true,
  },
];

test("B1. with a separator-free typed span, a WALK is refused exactly when the current cursor is at a member site and the candidate was authored at a non-member site; every other combination serves [surface: 'The refusal' + the three consequences]", () => {
  table(
    refusalCases,
    (r) => {
      const c = newCache(10);
      c.set(WALK_BASE, S, WALK_COMPLETION, undefined, r.p);
      return r.at === undefined
        ? c.lookup(WALK_BASE + WALK_TYPED, S)
        : c.lookup(WALK_BASE + WALK_TYPED, S, r.at);
    },
    (got, row) => {
      if (!row.serves) {
        assert.strictEqual(
          got,
          undefined,
          `expected no hit, got ${JSON.stringify(got)} - a ghost authored where no candidate block and no member gate applied must not be walk-served at a member site`
        );
        return;
      }
      assert.ok(got, "expected a walk hit, got undefined");
      assert.strictEqual(got.completion, WALK_REMAINDER);
      assert.strictEqual(got.walked, true);
      assert.deepStrictEqual(got.provenance, row.p);
    }
  );
});

test("B2. an EXACT hit is never refused, whatever the entry's provenance and whatever the current site - the same prefix window and suffix cannot classify differently [surface: 'An EXACT hit is never refused']", () => {
  table(
    provenances,
    (r) => {
      const c = newCache(10);
      c.set("aa;\n", S, "one()", undefined, r.p);
      return c.lookup("aa;\n", S, true);
    },
    (got, row) => {
      assert.ok(got, `an exact key match must serve at a member site, provenance ${JSON.stringify(row.p)}`);
      assert.strictEqual(got.completion, "one()");
      assert.strictEqual(got.walked, false);
      assert.deepStrictEqual(got.provenance, row.p);
    }
  );
});

test("B3. a refused walk candidate is not counted as a use for LRU purposes - refusing to serve an entry is not touching it [surface: 'A refused candidate must not be counted as a use']", () => {
  const c = newCache(2);
  c.set("aa;\n", S, "hello()", undefined, prov({ memberSite: false })); // oldest
  c.set("bb;\n", S, "world()", undefined, prov({ memberSite: false }));
  assert.strictEqual(
    c.lookup("aa;\n" + "hel", S, true),
    undefined,
    "precondition: the walk into a member position is refused"
  );
  c.set("cc;\n", S, "third()"); // over capacity: the LRU entry must go
  assert.strictEqual(c.size, 2);
  assert.strictEqual(
    c.get("aa;\n", S),
    undefined,
    "the refused entry was still the LRU one and was evicted; refusing must not have refreshed it"
  );
  assert.strictEqual(c.get("bb;\n", S), "world()", "the entry that was genuinely older-but-untouched survives");
  assert.strictEqual(c.get("cc;\n", S), "third()");
});

// --- B4: the walk must CONTINUE past a refused candidate.
// Two entries both walk-match the same read position with different remainders:
//   near  base = P + "a",  completion "bcQRS"  -> typed "bc",  remainder "QRS"
//   far   base = P,        completion "abcXYZ" -> typed "abc", remainder "XYZ"
// Run both assignments of eligibility so the case is discriminating whichever
// order the walk visits candidates in.
const SPLIT_BASE = "let z = 1;\n";
const SPLIT_READ = SPLIT_BASE + "abc";

const splitCases = [
  {
    name: "the FAR candidate is ineligible, the NEAR one is eligible: the near remainder is served",
    far: prov({ memberSite: false }),
    near: prov({ memberSite: true, injected: true, gated: true }),
    expect: "QRS",
  },
  {
    name: "the NEAR candidate is ineligible, the FAR one is eligible: the walk carries on to the far remainder",
    far: prov({ memberSite: true, injected: true, gated: true }),
    near: prov({ memberSite: false }),
    expect: "XYZ",
  },
  {
    name: "BOTH candidates are ineligible: nothing else matches, so lookup returns undefined",
    far: prov({ memberSite: false }),
    near: prov({ memberSite: false }),
    expect: undefined,
  },
];

test("B4. the walk continues PAST a refused candidate to another eligible one, exactly as it would past a candidate whose text did not match; with nothing eligible left it returns undefined [surface: 'The walk continues past it to shorter candidates']", () => {
  table(
    splitCases,
    (r) => {
      const c = newCache(10);
      c.set(SPLIT_BASE, S, "abcXYZ", undefined, r.far);
      c.set(SPLIT_BASE + "a", S, "bcQRS", undefined, r.near);
      return c.lookup(SPLIT_READ, S, true);
    },
    (got, row) => {
      if (row.expect === undefined) {
        assert.strictEqual(got, undefined, `expected no hit, got ${JSON.stringify(got)}`);
        return;
      }
      assert.ok(got, `expected the eligible candidate to serve ${row.expect}, got undefined`);
      assert.strictEqual(
        got.completion,
        row.expect,
        "only the eligible candidate may serve; the refused one must be skipped, not returned and not fatal"
      );
      assert.strictEqual(got.walked, true);
      assert.strictEqual(got.provenance.memberSite, true, "the served candidate is the member-site-authored one");
    }
  );
});

test("B5. both candidates eligible: the refusal changes nothing when nothing is refusable, so a member-site read still serves one of them [surface: 'A walk from a member-site base into a member position serves normally']", () => {
  const c = newCache(10);
  const p = prov({ memberSite: true, injected: true, gated: true });
  c.set(SPLIT_BASE, S, "abcXYZ", undefined, p);
  c.set(SPLIT_BASE + "a", S, "bcQRS", undefined, p);
  const got = c.lookup(SPLIT_READ, S, true);
  assert.ok(got, "a member-authored candidate must serve at a member position");
  assert.ok(["XYZ", "QRS"].includes(got.completion), `expected one of the two remainders, got ${JSON.stringify(got.completion)}`);
  assert.strictEqual(got.walked, true);
});

// ===========================================================================
// G. THE SECOND WALK-REFUSAL CONDITION [surface: "The refusal" - "the typed
//    span ... contains a `.` or a `::`"]. Provenance is per-receiver: a ghost
//    gated against `store` is genuinely gated, but once the user types
//    `tileTally().f` the remainder is being served at a member site whose
//    receiver is `tileTally()`'s return type, which no gate has ever seen.
//    Every base below records memberSite:true unless the case says otherwise,
//    so the ONLY thing that can refuse it is the separator.
// ===========================================================================

const GB = "let z = 1;\n";
const MEMBER_BASE = prov({ memberSite: true, injected: true, gated: true });

const spanCases = [
  {
    name: "typed span crosses a `.`: REFUSED, the cursor is on a different receiver than the base was",
    base: GB,
    completion: "store.tileTally()",
    typed: "store.",
    p: MEMBER_BASE,
    at: true,
    serves: false,
  },
  {
    name: "typed span crosses a `.` and continues past it: still REFUSED",
    base: GB,
    completion: "store.tileTally()",
    typed: "store.tile",
    p: MEMBER_BASE,
    at: true,
    serves: false,
  },
  {
    name: "typed span crosses a `::`: REFUSED, `::` is a member separator too",
    base: GB,
    completion: "std::vector<int> v",
    typed: "std::",
    p: MEMBER_BASE,
    at: true,
    serves: false,
  },
  {
    name: "typed span crosses a `::` and continues past it: still REFUSED",
    base: GB,
    completion: "std::vector<int> v",
    typed: "std::vec",
    p: MEMBER_BASE,
    at: true,
    serves: false,
  },
  {
    name: "typed span crosses NO separator: SERVES, same receiver, the base's evidence still applies",
    base: GB,
    completion: "tileTally();",
    typed: "tileTa",
    p: MEMBER_BASE,
    at: true,
    serves: true,
  },
  {
    name: "the separator is in the BASE, not the typed span: SERVES, the receiver has not changed since the base was authored",
    base: "const x = store.",
    completion: "tileTally();",
    typed: "tileTa",
    p: MEMBER_BASE,
    at: true,
    serves: true,
  },
  {
    name: "a `::` SPLIT across the base/typed boundary - base ends `:`, typed span starts `:`: the typed span itself contains no `.` and no `::`, so it SERVES",
    base: GB + "std:",
    completion: ":vector<int> v",
    typed: ":vec",
    p: MEMBER_BASE,
    at: true,
    serves: true,
  },
  {
    name: "BOTH refusal conditions at once - non-member base AND a `.` in the typed span: REFUSED",
    base: GB,
    completion: "store.tileTally()",
    typed: "store.",
    p: prov({ memberSite: false }),
    at: true,
    serves: false,
  },
  {
    name: "a `.` in the typed span but the CURRENT position is not a member site: SERVES, the refusal is one-way",
    base: GB,
    completion: "store.tileTally()",
    typed: "store.",
    p: MEMBER_BASE,
    at: false,
    serves: true,
  },
  {
    name: "a `::` in the typed span, current position not a member site: SERVES, one-way for both conditions",
    base: GB,
    completion: "std::vector<int> v",
    typed: "std::vec",
    p: MEMBER_BASE,
    at: false,
    serves: true,
  },
  {
    name: "a `.` in the typed span, non-member base, current position not a member site: SERVES, neither condition applies off a member site",
    base: GB,
    completion: "store.tileTally()",
    typed: "store.",
    p: prov({ memberSite: false }),
    at: false,
    serves: true,
  },
];

test("G1. a WALK at a member site is refused when the typed span contains a `.` or a `::`, and only then; a span that crosses no separator, or a separator that sits in the base rather than the span, still serves [surface: 'the typed span ... contains a `.` or a `::` - the cursor has moved onto a DIFFERENT receiver']", () => {
  table(
    spanCases,
    (r) => {
      const c = newCache(10);
      c.set(r.base, S, r.completion, undefined, r.p);
      return c.lookup(r.base + r.typed, S, r.at);
    },
    (got, row) => {
      if (!row.serves) {
        assert.strictEqual(
          got,
          undefined,
          `expected no hit, got ${JSON.stringify(got)} - the base's evidence is about a different receiver than the one now under the cursor`
        );
        return;
      }
      assert.ok(got, "expected a walk hit, got undefined");
      assert.strictEqual(got.completion, row.completion.slice(row.typed.length), "walk offset applied");
      assert.strictEqual(got.walked, true);
      assert.deepStrictEqual(got.provenance, row.p);
    }
  );
});

test("G2. an EXACT hit is never refused by the separator condition either - there is no typed span at all, and a `.` in the prefix cannot make one [surface: 'An EXACT hit is never refused']", () => {
  const c = newCache(10);
  c.set("const x = store.", S, "tileTally()", undefined, MEMBER_BASE);
  const hit = c.lookup("const x = store.", S, true);
  assert.ok(hit, "an exact key match at a member site must serve");
  assert.strictEqual(hit.completion, "tileTally()");
  assert.strictEqual(hit.walked, false);
});

// G3: two candidates walk-match the same read position `GB + "a.b"`.
//   far  base = GB,        completion "a.bXYZ" -> typed span "a.b" CROSSES a `.`
//   near base = GB + "a.", completion "bQRS"   -> typed span "b"   crosses nothing
// Both are member-site authored, so the separator is the only discriminator.
test("G3. the walk continues PAST a candidate refused for crossing a separator, to a candidate whose own typed span crosses none [surface: 'the walk continues past the refused candidate to shorter candidates']", () => {
  const c = newCache(10);
  c.set(GB, S, "a.bXYZ", undefined, MEMBER_BASE);
  c.set(GB + "a.", S, "bQRS", undefined, MEMBER_BASE);
  const got = c.lookup(GB + "a.b", S, true);
  assert.ok(got, "the candidate whose typed span crosses no separator must still serve");
  assert.strictEqual(
    got.completion,
    "QRS",
    "the far candidate's span crosses the `.` and must be skipped, not returned and not fatal"
  );
  assert.strictEqual(got.walked, true);
});

test("G4. with every candidate's typed span crossing a separator, lookup returns undefined [surface: 'if nothing else matches, lookup returns undefined']", () => {
  const c = newCache(10);
  c.set(GB, S, "a.bXYZ", undefined, MEMBER_BASE);
  c.set(GB + "a", S, ".bQRS", undefined, MEMBER_BASE);
  assert.strictEqual(
    c.lookup(GB + "a.b", S, true),
    undefined,
    "both spans (\"a.b\" and \".b\") cross the `.`; nothing eligible remains"
  );
});

test("G5. a candidate refused for crossing a separator is not counted as a use for LRU purposes [surface: 'A refused candidate must not be counted as a use for LRU purposes']", () => {
  const c = newCache(2);
  c.set("aa;\n", S, "store.tileTally()", undefined, MEMBER_BASE); // oldest
  c.set("bb;\n", S, "world()", undefined, MEMBER_BASE);
  assert.strictEqual(
    c.lookup("aa;\nstore.", S, true),
    undefined,
    "precondition: the span crosses a `.`, so the walk is refused"
  );
  c.set("cc;\n", S, "third()"); // over capacity: the LRU entry must go
  assert.strictEqual(c.size, 2);
  assert.strictEqual(c.get("aa;\n", S), undefined, "the refused entry was still the LRU one and was evicted");
  assert.strictEqual(c.get("bb;\n", S), "world()");
  assert.strictEqual(c.get("cc;\n", S), "third()");
});

test("G6. the doc's own example on the real service path: a ghost gated against `store` is not walk-served after the user types `tileTally().` - that member site's receiver is a return type no gate has ever seen [surface: 'A ghost gated against store ... whose receiver is tileTally()'s return type']", async () => {
  const g = makeGenerate(["tileTally().fanout", "fanout"]);
  const svc = service(CFG, g.fn);
  const resolveInjection = async () => ({ block: BLOCK, memberNames: STORE_MEMBERS });
  const prefix = "const x = store.";
  const suffix = ";\n";
  const first = await svc.complete({ prefix, suffix, manual: true, memberSite: true, resolveInjection });
  assert.ok(first && first.text === "tileTally().fanout", "precondition: the gated member-site ghost was authored and cached");

  const typed = "tileTally().";
  const second = await svc.complete({
    prefix: prefix + typed,
    suffix,
    manual: true,
    memberSite: true,
    resolveInjection,
  });
  assert.strictEqual(
    g.calls.length,
    2,
    "the second receiver must reach the model; serving the remainder off the first receiver's evidence is the hole this condition closes"
  );
  assert.ok(
    !second || second.fromCache === false,
    `a completion for a new receiver must not come from the walk, got ${JSON.stringify(second)}`
  );
  svc.dispose();
});

test("G7. crossing no separator on the real service path still serves warm - the separator condition must not kill typing through a member-site suggestion [surface: 'A walk from a member-site base into a member position serves normally']", async () => {
  const g = makeGenerate(["tileTally(1)"]);
  const svc = service(CFG, g.fn);
  const resolveInjection = async () => ({ block: BLOCK, memberNames: STORE_MEMBERS });
  const prefix = "const x = store.";
  const suffix = ";\n";
  await svc.complete({ prefix, suffix, manual: true, memberSite: true, resolveInjection });
  const typed = "tileTal";
  const second = await svc.complete({
    prefix: prefix + typed,
    suffix,
    manual: true,
    memberSite: true,
    resolveInjection,
  });
  assert.ok(second, "typing within one receiver must still hit");
  assert.strictEqual(second.fromCache, true);
  assert.strictEqual(second.text, "tileTally(1)".slice(typed.length));
  assert.strictEqual(g.calls.length, 1, "no model call");
  svc.dispose();
});

// ===========================================================================
// C. get() is unchanged [surface: "get(prefix, suffix) remains, and is the
//    convenience form of lookup at a non-member position"].
// ===========================================================================

test("C1. get returns a plain string (or undefined), never a CacheHit object [surface: 'get still returns string | undefined']", () => {
  const c = newCache(10);
  c.set("aa;\n", S, "one()", undefined, prov({ memberSite: true, injected: true, gated: true }));
  assert.strictEqual(c.get("aa;\n", S), "one()");
  assert.strictEqual(c.get("zz;\n", S), undefined);
});

test("C2. get behaves as lookup at a NON-member position: a non-member-authored entry walk-serves through get, since get never asks for the refusal [surface: 'it returns lookup(prefix, suffix)?.completion']", () => {
  table(
    provenances,
    (r) => {
      const c = newCache(10);
      c.set(WALK_BASE, S, WALK_COMPLETION, undefined, r.p);
      return {
        exact: c.get(WALK_BASE, S),
        walked: c.get(WALK_BASE + WALK_TYPED, S),
        viaLookup: c.lookup(WALK_BASE + WALK_TYPED, S),
      };
    },
    (got) => {
      assert.strictEqual(got.exact, WALK_COMPLETION, "exact hit through get");
      assert.strictEqual(got.walked, WALK_REMAINDER, "walk hit through get, whatever the provenance");
      assert.strictEqual(
        got.walked,
        got.viaLookup && got.viaLookup.completion,
        "get is exactly lookup's completion at a non-member position"
      );
    }
  );
});

// ===========================================================================
// D. CompletionService: cache ELIGIBILITY [surface: "What it must refuse to
//    cache", as amended after round 5]. One rule only, and it now tests ONE
//    quantity - INJECTED OR GATED. A completion is refused only when a resolver
//    was supplied and produced NEITHER a block for the prompt NOR names the
//    gate ran on. Grounded by either, it caches.
//
//    The base commit refused on the block alone. That refused a cell its own
//    justification does not cover: a resolver can answer with the receiver's
//    full member list and still render no block - no narrowed member carries a
//    signature, or the set is over the candidate cap - which is a property of
//    the RECEIVER, not of a cold server, and the completion it produced was
//    checked by the gate rather than guessed. D5 is that cell.
//
//    The principle the doc states, and which these cases pin: a refusal to
//    cache earns its latency only when the cached path is less policed than the
//    fresh path. Where both are equally unpoliced - no resolver, so no
//    injection and no gate on either path - refusing is pure cost, so the
//    entry MUST be cached. D6 is the cell that is still refused, and D7 pins
//    that the amendment only ever ADDS cacheable cases.
// ===========================================================================

const CFG = {
  apiBase: "http://127.0.0.1:1", // never reached: generate is injected
  model: "fake-model",
  maxTokens: 64,
  temperature: 0.01,
  debounceMs: 0,
  prefixChars: 3000,
  suffixChars: 1000,
  multiline: true,
  cacheCapacity: 100,
};

// Counting fake generate: records params, cycles the supplied texts.
function makeGenerate(texts) {
  const list = Array.isArray(texts) ? texts : [texts];
  const calls = [];
  const fn = async (params) => {
    const text = list[Math.min(calls.length, list.length - 1)];
    calls.push(params);
    return { text, ttftMs: 42, totalMs: 99 };
  };
  return { fn, calls };
}

const STORE_MEMBERS = ["aggregateFanouts", "tileTally", "placeOrder"];
const BLOCK = "// available here (use one of these exact names, do not invent):\n// tileTally: number";

test("D1. a completion authored at a member site with NO resolver supplied IS cached: no injection and no gate are available on either path, so the fresh path is no better policed than the cached one and refusing would be pure cost [surface: 'The only case the second rule adds is a member site where NO resolver was supplied at all ... Refusing there buys nothing' + the governing principle]", async () => {
  const g = makeGenerate(["tileTally}", "SECOND-CALL"]);
  const svc = service(CFG, g.fn);
  // No resolveInjection at all: nothing resolved, so the member gate never ran
  // and nothing was injected. This is the case the amended contract explicitly
  // says must cache.
  const req = () => ({ prefix: "const x = store.", suffix: ";\n", manual: true, memberSite: true });
  const first = await svc.complete(req());
  assert.ok(first, "precondition: with nothing resolved the ghost is not suppressed, it is served");
  assert.strictEqual(first.fromCache, false);
  const second = await svc.complete(req());
  assert.ok(second, "the ungated member-site ghost is cache-eligible");
  assert.strictEqual(second.fromCache, true, "the identical member-site request must be served from cache");
  assert.strictEqual(second.text, "tileTally}", "and it serves the SAME bytes, not a regenerated ghost");
  assert.strictEqual(g.calls.length, 1, "no second model call: 9 calls to reproduce what 1 produced is the cost the contract refuses to pay");
  svc.dispose();
});

test("D1b. member-site status alone never blocks storage: a member-site completion with a resolver that DID produce a block but whose gate found nothing to check is still cached - injected alone grounds it [surface: 'Member-site status still does not appear in the rule on its own; it affects the WALK and the provenance recorded']", async () => {
  const g = makeGenerate(["tileTally}", "SECOND-CALL"]);
  const svc = service(CFG, g.fn);
  const req = () => ({
    prefix: "const x = store.",
    suffix: ";\n",
    manual: true,
    memberSite: true,
    // A block went in, so the site did not degrade; no memberNames, so there is
    // no name list for the gate to check against.
    resolveInjection: async () => ({ block: BLOCK }),
  });
  const first = await svc.complete(req());
  assert.ok(first, "precondition: with no name list there is nothing to suppress the ghost");
  const second = await svc.complete(req());
  assert.ok(second, "the entry was stored");
  assert.strictEqual(second.fromCache, true);
  assert.strictEqual(g.calls.length, 1, "no second model call");
  svc.dispose();
});

test("D2. a completion authored at a member site with BOTH grounds - injected and gated - IS cached: the identical later request is a hit with no second model call [surface: 'Grounded by either, it caches']", async () => {
  const g = makeGenerate(["tileTally}"]);
  const svc = service(CFG, g.fn);
  const req = () => ({
    prefix: "const x = store.",
    suffix: ";\n",
    manual: true,
    memberSite: true,
    resolveInjection: async () => ({ block: BLOCK, memberNames: STORE_MEMBERS }),
  });
  const first = await svc.complete(req());
  assert.ok(first, "precondition: the ghost names a real member, so the gate passes it");
  assert.strictEqual(first.text, "tileTally}");
  const second = await svc.complete(req());
  assert.ok(second, "the gated member-site ghost is cache-eligible");
  assert.strictEqual(second.fromCache, true);
  assert.strictEqual(second.text, "tileTally}");
  assert.strictEqual(g.calls.length, 1, "no second model call");
  svc.dispose();
});

test("D3. a non-member site still caches normally - the rule only ever bites where a resolver was supplied [surface: 'A completion is refused only when the resolver was supplied and ...']", async () => {
  const g = makeGenerate(["hello()"]);
  const svc = service(CFG, g.fn);
  const req = () => ({ prefix: "const a = 1;\nlet b = ", suffix: ";\n", manual: true });
  await svc.complete(req());
  const second = await svc.complete(req());
  assert.ok(second);
  assert.strictEqual(second.fromCache, true);
  assert.strictEqual(g.calls.length, 1);
  svc.dispose();
});

test("D4. the surviving refusal in its clearest form: a resolver that goes dark - returning nothing at all - grounds the completion neither way, so it is not cached and the identical later request calls the model again [surface: 'refused only when the resolver was supplied and produced NEITHER a block for the prompt NOR names the gate ran on']", async () => {
  const g = makeGenerate(["tileTally}", "tileTally}"]);
  const svc = service(CFG, g.fn);
  const req = () => ({
    prefix: "const x = store.",
    suffix: ";\n",
    manual: true,
    memberSite: true,
    resolveInjection: async () => undefined, // a resolver exists; it went dark
  });
  const first = await svc.complete(req());
  assert.ok(first, "precondition: nothing resolved means nothing to gate against, so the ghost is served");
  assert.strictEqual(first.fromCache, false);
  const second = await svc.complete(req());
  assert.strictEqual(
    g.calls.length,
    2,
    "the degraded completion was never stored, so neither the exact-hit path nor the walk can reach it"
  );
  assert.ok(!second || second.fromCache === false, `the repeat must not be served from cache, got ${JSON.stringify(second)}`);
  svc.dispose();
});

test("D5. a resolver that returns member NAMES but no BLOCK is GROUNDED, not degraded: the gate checked the completion against the real members, so it IS cached, and the entry carries {memberSite:true, injected:false, gated:true} [surface: 'A completion is refused only when the resolver ... produced NEITHER a block for the prompt NOR names the gate ran on. Grounded by either, it caches']", async () => {
  const lines = [];
  const g = makeGenerate(["tileTally}", "SECOND-CALL", "THIRD-CALL"]);
  const svc = service(CFG, g.fn, (l) => lines.push(l));
  const req = (extra = "") => ({
    prefix: "const x = store." + extra,
    suffix: ";\n",
    manual: true,
    memberSite: true,
    // Names for the gate, but nothing reached the prompt. Rendering no block is
    // a property of the receiver - no narrowed member carries a signature, or
    // the set is over the candidate cap - not of a cold server, and the gate
    // ran, so this is not an un-injected guess.
    resolveInjection: async () => ({ memberNames: STORE_MEMBERS }),
  });
  const first = await svc.complete(req());
  assert.ok(first, "precondition: the ghost names a real member, so the gate clears it and it is served");
  assert.strictEqual(first.text, "tileTally}");
  assert.strictEqual(first.fromCache, false);

  // Transport 1, the exact hit.
  lines.length = 0;
  const second = await svc.complete(req());
  assert.ok(second, "a gate-grounded completion is cache-eligible");
  assert.strictEqual(
    second.fromCache,
    true,
    "the identical repeat must be served from cache; refusing here made the walk refusal fire on every keystroke after, generating a policed completion and discarding it forever"
  );
  assert.strictEqual(second.text, "tileTally}", "and it serves the SAME bytes, not a regenerated ghost");
  assert.strictEqual(g.calls.length, 1, "no second model call: 21 model calls where a productive block costs 5 is the cost the amendment refuses to pay");
  assertHitLine(hitLine(lines), {
    len: String(second.text.length),
    memberSite: "true",
    injected: "false",
    gated: "true",
    walked: "false",
  });

  // Transport 2, the walk. The stored entry records memberSite:true, so a walk
  // from it into a member position is eligible on its own merits (section B),
  // and the typed span crosses no separator (section G).
  lines.length = 0;
  const third = await svc.complete(req("tileTa"));
  assert.ok(third, "the stored entry is reachable by the walk too");
  assert.strictEqual(third.fromCache, true, "typing through a gate-grounded member-site ghost must not stutter");
  assert.strictEqual(third.text, "tileTally}".slice("tileTa".length), "walk offset applied");
  assert.strictEqual(g.calls.length, 1, "still no model call");
  assertHitLine(hitLine(lines), {
    len: String(third.text.length),
    memberSite: "true",
    injected: "false",
    gated: "true",
    walked: "true",
  });
  svc.dispose();
});

// D6: the cell the amendment still refuses. A resolver was supplied and came
// back with nothing either mechanism can use - no block for the prompt, no
// names for the gate. The ghost is unpoliced on the cached path, and a fresh
// resolver query on the regenerated path is new evidence, so the refusal earns
// its latency. This is what stops the amendment being a blanket relaxation.
const unpoliceableOutcomes = [
  { name: "the resolver returned undefined - a cold or failing server", resolve: async () => undefined },
  { name: "the resolver ANSWERED but with neither field - an empty injection", resolve: async () => ({}) },
  {
    name: "the resolver answered with arg signatures only - neither a block nor names the gate can run on",
    resolve: async () => ({ argSignatures: ["tileTally(n: number): number"] }),
  },
];

test("D6. the one cell still refused: a member site where the resolver produced NEITHER a block nor names is not cached, so neither the exact-hit path nor the walk can reach it [surface: 'A member site with neither injection nor a gate is still refused, which is what keeps an unpoliced ghost out of the cache']", async () => {
  const bad = [];
  for (const row of unpoliceableOutcomes) {
    const g = makeGenerate(["tileTally}", "REGEN-1", "REGEN-2"]);
    const svc = service(CFG, g.fn);
    const req = (extra = "") => ({
      prefix: "const x = store." + extra,
      suffix: ";\n",
      manual: true,
      memberSite: true,
      resolveInjection: row.resolve,
    });
    try {
      const first = await svc.complete(req());
      assert.ok(first, "precondition: with nothing to gate against the ghost is served, not suppressed");
      assert.strictEqual(first.fromCache, false);

      const second = await svc.complete(req());
      assert.strictEqual(
        g.calls.length,
        2,
        `the unpoliced completion must not be stored, so the identical repeat cannot hit it; got ${g.calls.length} model calls`
      );
      assert.ok(!second || second.fromCache === false, `the exact repeat must not be served from cache, got ${JSON.stringify(second)}`);

      // A refusal to STORE closes both transports.
      const third = await svc.complete(req("tileTa"));
      assert.strictEqual(g.calls.length, 3, "an entry never written can be reached by neither an exact hit nor a walk");
      assert.ok(!third || third.fromCache === false, `the walk must not reach an unstored entry, got ${JSON.stringify(third)}`);
    } catch (e) {
      bad.push(`${row.name}: ${e.message}`);
    }
    svc.dispose();
  }
  if (bad.length) {
    assert.fail(`${bad.length}/${unpoliceableOutcomes.length} cases failed:\n  - ${bad.join("\n  - ")}`);
  }
});

// D7: the whole eligibility matrix in one place, each row carrying what the
// BASE commit's block-only rule did with it and what the amended rule does.
// `base` is recorded so the run can assert the safety property the doc claims
// outright: the amendment only ever ADDS cacheable cases, never removes one.
const eligibilityMatrix = [
  { name: "no resolver at all - a language with no extractor", resolve: undefined, memberSite: true, base: true, now: true },
  { name: "resolver produced a block AND names - fully evidenced", resolve: async () => ({ block: BLOCK, memberNames: STORE_MEMBERS }), memberSite: true, base: true, now: true },
  { name: "resolver produced a block but no names - injected, not gated", resolve: async () => ({ block: BLOCK }), memberSite: true, base: true, now: true },
  { name: "resolver produced names but no block - gated, not injected: THE ADDED CELL", resolve: async () => ({ memberNames: STORE_MEMBERS }), memberSite: true, base: false, now: true },
  { name: "resolver went dark - neither block nor names", resolve: async () => undefined, memberSite: true, base: false, now: false },
  { name: "resolver answered empty - neither block nor names", resolve: async () => ({}), memberSite: true, base: false, now: false },
  { name: "non-member site, no resolver", resolve: undefined, memberSite: false, base: true, now: true },
];

test("D7. the eligibility matrix, and the safety property that makes the amendment safe: every case the block-only rule cached still caches, and the ONLY movement is names-without-block going from refused to cached [surface: 'This only ever adds cacheable cases']", async () => {
  const bad = [];
  for (const row of eligibilityMatrix) {
    // The structural half: no row may move from cacheable to refused. A row
    // asserting that would be a REMOVAL, which the doc rules out.
    if (row.base && !row.now) {
      bad.push(`${row.name}: this row claims the amendment REMOVED a cacheable case, which the contract forbids`);
      continue;
    }
    const g = makeGenerate(["tileTally}", "REGEN"]);
    const svc = service(CFG, g.fn);
    const req = () => ({
      prefix: row.memberSite ? "const x = store." : "const a = 1;\nlet b = ",
      suffix: ";\n",
      manual: true,
      memberSite: row.memberSite,
      resolveInjection: row.resolve,
    });
    try {
      const first = await svc.complete(req());
      assert.ok(first, "precondition: the ghost is served on the cold path");
      const second = await svc.complete(req());
      if (row.now) {
        assert.ok(second, "expected a cache hit");
        assert.strictEqual(second.fromCache, true, `expected the repeat to be served from cache, got ${JSON.stringify(second)}`);
        assert.strictEqual(g.calls.length, 1, `expected no second model call, got ${g.calls.length}`);
      } else {
        assert.ok(!second || second.fromCache === false, `expected no cache hit, got ${JSON.stringify(second)}`);
        assert.strictEqual(g.calls.length, 2, `expected the repeat to reach the model, got ${g.calls.length} calls`);
      }
    } catch (e) {
      bad.push(`${row.name}: ${e.message}`);
    }
    svc.dispose();
  }
  if (bad.length) {
    assert.fail(`${bad.length}/${eligibilityMatrix.length} cases failed:\n  - ${bad.join("\n  - ")}`);
  }
});

// ===========================================================================
// E. CompletionService: the cache-hit log line [surface: "What it must now
//    log"]. `[fim] cache hit` keeps `len=` and gains memberSite=, injected=,
//    gated=, walked=, each as a name=value pair.
// ===========================================================================

test("E1. the cache-hit line on an EXACT hit at a non-member site carries len= plus memberSite=, injected=, gated=, walked= [surface: 'The three provenance fields and whether the hit was walked or exact are all present']", async () => {
  const lines = [];
  const g = makeGenerate(["hello()"]);
  const svc = service(CFG, g.fn, (l) => lines.push(l));
  const req = () => ({ prefix: "const a = 1;\nlet b = ", suffix: ";\n", manual: true });
  await svc.complete(req());
  lines.length = 0;
  const hit = await svc.complete(req());
  assert.ok(hit && hit.fromCache, "precondition: the second identical call is a cache hit");
  assertHitLine(hitLine(lines), {
    len: String(hit.text.length),
    memberSite: "false",
    injected: "false",
    gated: "false",
    walked: "false",
  });
  svc.dispose();
});

test("E2. the cache-hit line on a WALK hit reports walked=true and the served remainder's len [surface: 'whether the hit was walked or exact']", async () => {
  const lines = [];
  const completion = "function add(a, b) { return a + b; }";
  const g = makeGenerate([completion]);
  const svc = service(CFG, g.fn, (l) => lines.push(l));
  const prefix = "const a = 1;\n";
  const suffix = ";\n";
  await svc.complete({ prefix, suffix, manual: true });
  lines.length = 0;
  const typed = "function add";
  const hit = await svc.complete({ prefix: prefix + typed, suffix, manual: true });
  assert.ok(hit && hit.fromCache, "precondition: typing through the suggestion is a walk hit");
  assert.strictEqual(hit.text, completion.slice(typed.length));
  assertHitLine(hitLine(lines), {
    len: String(hit.text.length),
    memberSite: "false",
    injected: "false",
    gated: "false",
    walked: "true",
  });
  assert.strictEqual(g.calls.length, 1, "no model call on the walk hit");
  svc.dispose();
});

test("E3. the cache-hit line reports the AUTHORING site's provenance: a gated, injected member-site entry logs memberSite=true injected=true gated=true [surface: 'That line now also carries the authoring site's provenance']", async () => {
  const lines = [];
  const g = makeGenerate(["tileTally}"]);
  const svc = service(CFG, g.fn, (l) => lines.push(l));
  const req = () => ({
    prefix: "const x = store.",
    suffix: ";\n",
    manual: true,
    memberSite: true,
    resolveInjection: async () => ({ block: BLOCK, memberNames: STORE_MEMBERS }),
  });
  await svc.complete(req());
  lines.length = 0;
  const hit = await svc.complete(req());
  assert.ok(hit && hit.fromCache, "precondition: the gated member-site ghost is cached (see D2)");
  assertHitLine(hitLine(lines), {
    len: String(hit.text.length),
    memberSite: "true",
    injected: "true",
    gated: "true",
    walked: "false",
  });
  svc.dispose();
});

// ===========================================================================
// F. THE END-TO-END DEFECT [surface: "Background: the defect being closed" and
//    "The lookup the service performs"]. The service tells `lookup` it is at a
//    member site only when the current request is at a member site AND carries
//    a resolver - both, not either. So every case below comes in two arms:
//    with a resolver the refusal is live, and without one the walk behaves
//    exactly as it does at an ordinary position. A request carrying no
//    `resolveInjection` is, from the service's view, both the no-extractor
//    language and compiler-directed injection switched off.
// ===========================================================================

const DEFECT_PREFIX = "const a = 1;\nlet b = ";
const DEFECT_SUFFIX = ";\n";
const DEFECT_GHOST = "store.tileTally"; // authored at a plain statement site
const DEFECT_TYPED = "store."; // typing it through lands the cursor at a member site
const RESOLVER = async () => ({ block: BLOCK, memberNames: STORE_MEMBERS });

test("F1. the defect, closed: a ghost authored at a plain statement site is NOT walk-served at a member site that carries a resolver - the warm path calls the model instead of serving what the cold path would have gated [surface: 'a ghost authored at an ordinary statement position ... can walk into a member position' + 'The service tells lookup it is at a member site only when ... AND carries a resolver']", async () => {
  const g = makeGenerate([DEFECT_GHOST, "tileTally"]);
  const svc = service(CFG, g.fn);
  const first = await svc.complete({ prefix: DEFECT_PREFIX, suffix: DEFECT_SUFFIX, manual: true });
  assert.ok(first && first.text === DEFECT_GHOST, "precondition: the plain-site ghost was authored and cached");

  const second = await svc.complete({
    prefix: DEFECT_PREFIX + DEFECT_TYPED,
    suffix: DEFECT_SUFFIX,
    manual: true,
    memberSite: true,
    resolveInjection: RESOLVER,
  });
  assert.strictEqual(
    g.calls.length,
    2,
    "the member-site request must reach the model; serving the plain-site ghost from the walk is the defect"
  );
  assert.ok(
    !second || second.fromCache === false,
    `a member-site request must not be served from a non-member-authored entry, got ${JSON.stringify(second)}`
  );
  svc.dispose();
});

test("F1b. the same refusal with a separator-free typed span, so the entry's memberSite:false is the only thing that can refuse it: a resolver-carrying member-site request still reaches the model [surface: 'A walk from a non-member base into a member position never serves']", async () => {
  const g = makeGenerate(["tileTally(1)", "tileTally(1)"]);
  const svc = service(CFG, g.fn);
  // Authored with no memberSite flag: whatever the text looks like, the service
  // records the provenance the REQUEST declared.
  const first = await svc.complete({ prefix: DEFECT_PREFIX, suffix: DEFECT_SUFFIX, manual: true });
  assert.ok(first && first.text === "tileTally(1)", "precondition: the plain-site ghost was authored and cached");

  const typed = "tileTa";
  const second = await svc.complete({
    prefix: DEFECT_PREFIX + typed,
    suffix: DEFECT_SUFFIX,
    manual: true,
    memberSite: true,
    resolveInjection: RESOLVER,
  });
  assert.strictEqual(g.calls.length, 2, "the non-member-authored entry must not serve at a resolver-carrying member site");
  assert.ok(!second || second.fromCache === false, `expected no cache hit, got ${JSON.stringify(second)}`);
  svc.dispose();
});

test("F2. the refusal is one-way on the real path too: the same walk at a NON-member position still serves from cache with no model call [surface: 'A walk into a NON-member position is unaffected']", async () => {
  const g = makeGenerate([DEFECT_GHOST, "tileTally"]);
  const svc = service(CFG, g.fn);
  await svc.complete({ prefix: DEFECT_PREFIX, suffix: DEFECT_SUFFIX, manual: true });
  const second = await svc.complete({
    prefix: DEFECT_PREFIX + DEFECT_TYPED,
    suffix: DEFECT_SUFFIX,
    manual: true,
    memberSite: false,
  });
  assert.ok(second, "the walk still serves where nothing changed about the site");
  assert.strictEqual(second.fromCache, true);
  assert.strictEqual(second.text, DEFECT_GHOST.slice(DEFECT_TYPED.length));
  assert.strictEqual(g.calls.length, 1, "no model call: typing through a suggestion must not stutter");
  svc.dispose();
});

test("F3. a ghost authored at a GATED member site walks into a later member position normally - closing the defect must not kill the warm member-site path [surface: 'A walk from a member-site base into a member position serves normally']", async () => {
  const g = makeGenerate(["tileTally(1)"]);
  const svc = service(CFG, g.fn);
  const resolveInjection = async () => ({ block: BLOCK, memberNames: STORE_MEMBERS });
  const prefix = "const x = store.";
  const suffix = ";\n";
  const first = await svc.complete({ prefix, suffix, manual: true, memberSite: true, resolveInjection });
  assert.ok(first && first.text === "tileTally(1)", "precondition: the gated member-site ghost was authored and cached");

  const typed = "tileTa";
  const second = await svc.complete({
    prefix: prefix + typed,
    suffix,
    manual: true,
    memberSite: true,
    resolveInjection,
  });
  assert.ok(second, "typing through a member-site suggestion still hits");
  assert.strictEqual(second.fromCache, true);
  assert.strictEqual(second.text, "tileTally(1)".slice(typed.length));
  assert.strictEqual(g.calls.length, 1, "no model call: the base and the read had the same evidence available");
  svc.dispose();
});

test("F4. the other arm: at a member site with NO resolver the walk behaves exactly as it does at an ordinary position - the same plain-site ghost F1 refuses is served warm, because with no injection and no gate available on either path a refusal buys nothing [surface: 'at a member site in a language with no resolver, the walk behaves exactly as it does at an ordinary position']", async () => {
  const g = makeGenerate([DEFECT_GHOST, "tileTally"]);
  const svc = service(CFG, g.fn);
  await svc.complete({ prefix: DEFECT_PREFIX, suffix: DEFECT_SUFFIX, manual: true });
  const second = await svc.complete({
    prefix: DEFECT_PREFIX + DEFECT_TYPED,
    suffix: DEFECT_SUFFIX,
    manual: true,
    memberSite: true,
    // No resolveInjection: a language with no extractor. The member-site
    // detector is total, but on its own it is not a reason to refuse.
    });
  assert.ok(second, "with no resolver the member site must behave as an ordinary position and serve the walk");
  assert.strictEqual(second.fromCache, true);
  assert.strictEqual(second.text, DEFECT_GHOST.slice(DEFECT_TYPED.length));
  assert.strictEqual(
    g.calls.length,
    1,
    "regenerating here asks the model to continue its own output with nothing new to go on"
  );
  svc.dispose();
});

test("F5. compiler-directed injection switched off - no request carries a resolver - leaves BOTH walk-refusal conditions dormant at a member site: a typed span crossing a `.` still serves warm [surface: 'in every language when candidate injection is switched off, a member site has no injection and no gate available on the cached path OR the fresh one']", async () => {
  const g = makeGenerate(["tileTally().fanout", "fanout"]);
  const svc = service(CFG, g.fn);
  const prefix = "const x = store.";
  const suffix = ";\n";
  // Authored at a member site, injection off: nothing resolved, nothing gated.
  const first = await svc.complete({ prefix, suffix, manual: true, memberSite: true });
  assert.ok(first && first.text === "tileTally().fanout", "precondition: with injection off the ghost is served and cached");

  const typed = "tileTally().";
  const second = await svc.complete({ prefix: prefix + typed, suffix, manual: true, memberSite: true });
  assert.ok(second, "with injection off the walk must behave as at an ordinary position");
  assert.strictEqual(second.fromCache, true);
  assert.strictEqual(second.text, "fanout");
  assert.strictEqual(
    g.calls.length,
    1,
    "no resolver means no fresh member surface to regenerate against, so the refusal has nothing to buy"
  );
  svc.dispose();
});

// ===========================================================================
// H. THE RESOLVER'S OUTCOME, NOT JUST ITS PRESENCE [surface: "The resolver's
//    OUTCOME, not just its presence."]. Carrying a resolver is not enough. The
//    service also suppresses the refusal when that document's resolver, the
//    last time it was asked, produced nothing a mechanism could police with -
//    neither a block for the prompt nor member names for the gate.
//
//    Without it the refusal compounds with the store rule into a loop that does
//    not converge: refuse the walk, generate, decline to store (resolver
//    supplied and degraded), so the next keystroke refuses again. Every
//    keystroke costs a model call and none of them are policed.
//
//    Three things the doc says a consumer may rely on, and which H pins: the
//    memo is PER DOCUMENT; it does not refresh while the walk is serving and
//    clears at the next cache MISS, not the next keystroke, and is stale only
//    in the safe direction; and a resolver producing NAMES BUT NO BLOCK has not
//    gone dark. That last one is unmoved by the round-5 store-rule amendment:
//    the WALK memo and the STORE rule now agree on what "dark" means (neither a
//    block nor names), which is the point of the amendment - two mechanisms
//    classifying one resolver outcome in opposite directions is what a
//    non-converging refusal is made of. H5 is the row where they used to
//    disagree; it still refuses the walk, and now also caches the result.
//
//    On the staleness bound: an earlier draft of the surface claimed the memo
//    was "one keystroke stale". It is not, and the doc has been amended. The
//    memo is written when the resolver is consulted, and the resolver is
//    consulted only when a completion is actually GENERATED - so a suppressed
//    refusal serves the walk from cache, no generation happens, and the memo
//    stands. H4a/H4b/H4c pin the amended bound: no refresh while serving, a
//    clear at the next miss, and one-way staleness.
//
//    Every typed span below is separator-free, so section G's condition cannot
//    be what decides any of these cases; the only live question is whether the
//    entry's memberSite:false refuses the walk.
// ===========================================================================

const DARK = async () => undefined; // a resolver that produced nothing policeable
const NAMES_ONLY = async () => ({ memberNames: STORE_MEMBERS }); // names, no block
const H_PREFIX = "const a = 1;\nlet b = ";
const H_SUFFIX = ";\n";
const H_GHOST = "tileTally(1)"; // authored at a plain statement site
const H_URI = "file:///h.ts";

// Author the plain-site ghost that every H case then tries to walk into a
// member position. No resolver on this call: the ghost is memberSite:false, so
// absent any suppression the walk into a member site is refused (see F1b).
const seedPlainGhost = async (svc, prefix, uri) =>
  svc.complete({ prefix, suffix: H_SUFFIX, manual: true, uri });

const memberRead = (svc, prefix, typed, resolveInjection, uri) =>
  svc.complete({
    prefix: prefix + typed,
    suffix: H_SUFFIX,
    manual: true,
    memberSite: true,
    resolveInjection,
    uri,
  });

test("H1. after a resolver produces nothing policeable, the refusal is suppressed on the FOLLOWING request: a walk that would otherwise be refused serves warm [surface: 'the service additionally suppresses the refusal when that document's resolver, the last time it was asked, produced nothing a mechanism could police with']", async () => {
  const g = makeGenerate([H_GHOST, "REGENERATED-1", "REGENERATED-2"]);
  const svc = service(CFG, g.fn);
  const first = await seedPlainGhost(svc, H_PREFIX, H_URI);
  assert.ok(first && first.text === H_GHOST, "precondition: the plain-site ghost was authored and cached");
  assert.strictEqual(g.calls.length, 1);

  // Keystroke 1: the resolver has never been asked, so there is no dark outcome
  // to go on and the refusal is live. This is F1b's behaviour, unchanged.
  const k1 = await memberRead(svc, H_PREFIX, "tileTa", DARK, H_URI);
  assert.strictEqual(g.calls.length, 2, "precondition: with no prior outcome the refusal is live and the model is called");
  assert.ok(!k1 || k1.fromCache === false, `precondition: keystroke 1 is not a cache hit, got ${JSON.stringify(k1)}`);

  // Keystroke 2: the last outcome for this document was nothing policeable, so
  // the refusal is suppressed and the walk serves.
  const k2 = await memberRead(svc, H_PREFIX, "tileTal", DARK, H_URI);
  assert.ok(k2, "the walk must serve once the document's resolver is known to have gone dark");
  assert.strictEqual(k2.fromCache, true, "suppressing the refusal means the walk hit is served, not regenerated");
  assert.strictEqual(k2.text, H_GHOST.slice("tileTal".length), "walk offset applied");
  assert.strictEqual(g.calls.length, 2, "no model call: this is the whole point of the suppression");
  svc.dispose();
});

test("H2. the loop the doc says is avoided converges: repeated keystrokes against a dark resolver do not each cost a model call [surface: 'a loop that does not converge ... Every keystroke costs a model call and none of them are policed']", async () => {
  const g = makeGenerate([H_GHOST, "REGEN"]);
  const svc = service(CFG, g.fn);
  await seedPlainGhost(svc, H_PREFIX, H_URI);
  assert.strictEqual(g.calls.length, 1, "precondition: authoring the ghost cost one call");

  // Six successive keystrokes typing through the ghost, every one at a member
  // site with a resolver that keeps producing nothing. Under the unconverged
  // loop this is six model calls and six unstored completions.
  const keystrokes = ["t", "ti", "til", "tile", "tileT", "tileTa"];
  const results = [];
  for (const typed of keystrokes) {
    results.push({ typed, r: await memberRead(svc, H_PREFIX, typed, DARK, H_URI) });
  }

  assert.strictEqual(
    g.calls.length,
    2,
    `expected the loop to converge after the first refusal - 1 authoring call + 1 refused keystroke - got ${g.calls.length} model calls across ${keystrokes.length} keystrokes; every keystroke costing a call IS the non-converging loop`
  );
  const warm = results.slice(1);
  for (const { typed, r } of warm) {
    assert.ok(r, `keystroke "${typed}" must serve`);
    assert.strictEqual(r.fromCache, true, `keystroke "${typed}" must be served from the walk, not regenerated`);
    assert.strictEqual(r.text, H_GHOST.slice(typed.length), `keystroke "${typed}" serves the remainder`);
  }
  svc.dispose();
});

test("H3. the suppression is PER DOCUMENT: a dark resolver in document A does not suppress the refusal in document B [surface: 'It is per document. A cold or failing resolver in one file does not change the walk in another']", async () => {
  const PA = "const a = 1;\nlet b = ";
  const PB = "const q = 9;\nvar w = ";
  const URI_A = "file:///a.ts";
  const URI_B = "file:///b.ts";
  const g = makeGenerate([H_GHOST, H_GHOST, "REGEN-A", "REGEN-B", "REGEN-B2"]);
  const svc = service(CFG, g.fn);

  await seedPlainGhost(svc, PA, URI_A);
  await seedPlainGhost(svc, PB, URI_B);
  assert.strictEqual(g.calls.length, 2, "precondition: a plain-site ghost authored in each document");

  // Drive document A dark: keystroke 1 is refused, and records the dark outcome.
  await memberRead(svc, PA, "tileTa", DARK, URI_A);
  assert.strictEqual(g.calls.length, 3, "precondition: A's first member-site keystroke is refused");
  const a2 = await memberRead(svc, PA, "tileTal", DARK, URI_A);
  assert.ok(a2 && a2.fromCache === true, `precondition: A is now suppressed and serves warm, got ${JSON.stringify(a2)}`);
  assert.strictEqual(g.calls.length, 3);

  // Document B, whose own resolver answers fully. Nothing about A may reach it.
  const b1 = await memberRead(svc, PB, "tileTa", RESOLVER, URI_B);
  assert.strictEqual(
    g.calls.length,
    4,
    "document B's walk must still be refused; A's dark resolver leaking into B would suppress it"
  );
  assert.ok(!b1 || b1.fromCache === false, `B must not be served from the walk, got ${JSON.stringify(b1)}`);
  svc.dispose();
});

// A resolver that is dark on its first consultation and fully answering on
// every one after. Counts consultations, so a test can tell "the resolver was
// not asked" apart from "the resolver was asked and answered".
const makeWarmingResolver = () => {
  const state = { asked: 0 };
  const fn = async () => {
    state.asked += 1;
    return state.asked === 1 ? undefined : { block: BLOCK, memberNames: STORE_MEMBERS };
  };
  return { fn, state };
};

test("H4a. the memo does NOT refresh while the walk is serving: once suppressed, successive keystrokes are served from cache, no completion is generated, so the resolver is never re-consulted and the memo stands - even though it has been answering since the first ask [surface: 'the memo is written when the resolver is consulted, and the resolver is consulted only when a completion is actually generated ... no generation happens, and the memo is not refreshed']", async () => {
  const g = makeGenerate([H_GHOST, "REGEN-1", "REGEN-2", "REGEN-3", "REGEN-4"]);
  const svc = service(CFG, g.fn);
  const r = makeWarmingResolver();
  await seedPlainGhost(svc, H_PREFIX, H_URI);
  assert.strictEqual(g.calls.length, 1, "precondition: authoring the plain-site ghost cost one call");
  assert.strictEqual(r.state.asked, 0, "precondition: the seeding request carried no resolver");

  // Keystroke 1: no prior outcome for this document, so the refusal is live.
  // The generation consults the resolver, which goes dark, writing the memo.
  await memberRead(svc, H_PREFIX, "t", r.fn, H_URI);
  assert.strictEqual(g.calls.length, 2, "precondition: with no prior outcome the first member-site keystroke is refused");
  assert.strictEqual(r.state.asked, 1, "precondition: that generation consulted the resolver exactly once, and it went dark");

  // Keystrokes 2..5. The memo suppresses the refusal, so each serves off the
  // walk. No generation, therefore no consultation, therefore no refresh - and
  // the memo stays dark for the whole run despite the resolver being warm from
  // its second ask onward.
  for (const typed of ["ti", "til", "tile", "tileT"]) {
    const r2 = await memberRead(svc, H_PREFIX, typed, r.fn, H_URI);
    assert.ok(r2, `keystroke "${typed}" must serve while the memo is suppressing`);
    assert.strictEqual(r2.fromCache, true, `keystroke "${typed}" must come off the walk, not a regeneration`);
    assert.strictEqual(r2.text, H_GHOST.slice(typed.length), `keystroke "${typed}" serves the remainder`);
  }
  assert.strictEqual(
    g.calls.length,
    2,
    `nothing may be generated while the memo suppresses; got ${g.calls.length} model calls, meaning the refusal came back without a cache miss to clear the memo`
  );
  assert.strictEqual(
    r.state.asked,
    1,
    `the resolver must not be consulted on a served walk - it is consulted only when a completion is generated; got ${r.state.asked} consultations`
  );
  svc.dispose();
});

test("H4b. the memo clears at the next cache MISS, and the refusal comes back after it: a diverging keystroke misses the walk, generates, re-consults the now-warm resolver, and the very next walk-eligible read at a member site is refused again [surface: 'It clears at the next cache MISS, not at the next keystroke']", async () => {
  const g = makeGenerate([H_GHOST, "REGEN-1", "REGEN-2", "REGEN-3"]);
  const svc = service(CFG, g.fn);
  const r = makeWarmingResolver();
  await seedPlainGhost(svc, H_PREFIX, H_URI);
  assert.strictEqual(g.calls.length, 1, "precondition: the plain-site ghost was authored and cached");

  // Drive the document dark, then confirm the suppression is live.
  await memberRead(svc, H_PREFIX, "t", r.fn, H_URI);
  assert.strictEqual(g.calls.length, 2, "precondition: the first member-site keystroke is refused");
  assert.strictEqual(r.state.asked, 1, "precondition: the resolver went dark on its only consultation so far");
  const suppressed = await memberRead(svc, H_PREFIX, "ti", r.fn, H_URI);
  assert.ok(
    suppressed && suppressed.fromCache === true,
    `precondition: the memo is suppressing and the walk serves, got ${JSON.stringify(suppressed)}`
  );
  assert.strictEqual(g.calls.length, 2, "precondition: the suppressed keystroke cost no model call");

  // THE CACHE MISS. The user types characters that diverge from the cached
  // ghost ("tileTaXX" is not a prefix of "tileTally(1)"), so no walk candidate
  // matches and no exact key exists. A completion must be generated, which
  // consults the resolver - warm this time - and refreshes the memo.
  const miss = await memberRead(svc, H_PREFIX, "tileTaXX", r.fn, H_URI);
  assert.strictEqual(
    g.calls.length,
    3,
    "precondition: a span that diverges from the cached ghost cannot walk, so this request must be a genuine cache miss"
  );
  assert.ok(!miss || miss.fromCache === false, `precondition: the diverging keystroke is not a cache hit, got ${JSON.stringify(miss)}`);
  assert.strictEqual(r.state.asked, 2, "precondition: the miss generated, so the resolver was consulted a second time and answered");

  // Back to a walk-eligible position. The memo now records a policeable
  // outcome, so the refusal is live again and the plain-site ghost must NOT be
  // served into this member site. An implementation that writes the memo once
  // and never clears it serves here, and that is the failure this row exists
  // to catch.
  const after = await memberRead(svc, H_PREFIX, "tileTal", r.fn, H_URI);
  assert.strictEqual(
    g.calls.length,
    4,
    `the refusal must be back once a cache miss has refreshed the memo with a policeable outcome; still ${g.calls.length} model calls means the memo never cleared and the suppression is permanent`
  );
  assert.ok(
    !after || after.fromCache === false,
    `the restored refusal must not serve the plain-site ghost at a member site, got ${JSON.stringify(after)}`
  );
  svc.dispose();
});

test("H4d. the control for H4b: what the cache miss does is REWRITE the memo with the resolver's current outcome, not unconditionally reset it - a miss whose resolver is still dark leaves the suppression in place, which is what proves H4b's restored refusal was caused by the warm outcome and not by the miss itself [surface: 'The memo is written when the resolver is consulted']", async () => {
  const g = makeGenerate([H_GHOST, "REGEN-1", "REGEN-2", "REGEN-3"]);
  const svc = service(CFG, g.fn);
  await seedPlainGhost(svc, H_PREFIX, H_URI);

  // Identical script to H4b, one variable changed: the resolver never warms up.
  await memberRead(svc, H_PREFIX, "t", DARK, H_URI);
  assert.strictEqual(g.calls.length, 2, "precondition: the first member-site keystroke is refused");
  const suppressed = await memberRead(svc, H_PREFIX, "ti", DARK, H_URI);
  assert.ok(suppressed && suppressed.fromCache === true, `precondition: the memo is suppressing, got ${JSON.stringify(suppressed)}`);

  // The same diverging span H4b uses, so the same cache miss and the same
  // generation happen here.
  const miss = await memberRead(svc, H_PREFIX, "tileTaXX", DARK, H_URI);
  assert.strictEqual(g.calls.length, 3, "precondition: the diverging span is a cache miss and generates");
  assert.ok(!miss || miss.fromCache === false, `precondition: the diverging keystroke is not a cache hit, got ${JSON.stringify(miss)}`);

  // H4b refused here. With the outcome still dark, this must serve - so the
  // miss is not on its own what restores the refusal.
  const after = await memberRead(svc, H_PREFIX, "tileTal", DARK, H_URI);
  assert.ok(after, "a still-dark resolver must keep suppressing the refusal after the miss");
  assert.strictEqual(
    after.fromCache,
    true,
    "the memo carries the resolver's CURRENT outcome; a miss that re-reads a dark resolver must not restore the refusal, or the non-converging loop the suppression exists to break is back"
  );
  assert.strictEqual(g.calls.length, 3, "no fourth model call: the suppression survived a miss that found the resolver still dark");
  svc.dispose();
});

test("H4c. the staleness is ONE-WAY: the memo can only ever remove a refusal, never add one - a walk that serves on its own merits (member-site base into a member position) serves identically whether the document's memo is policeable or dark [surface: 'stale only in the safe direction' + 'The refusal is one-way']", async () => {
  const g = makeGenerate(["tileTally(1)", "REGEN-DARK", "REGEN-2"]);
  const svc = service(CFG, g.fn);
  const MP = "const x = store.";
  const DP = "const q = 9;\nvar w = "; // distinct head: cannot cross-walk with MP

  // Author at a member site with a fully answering resolver. Provenance is
  // memberSite:true, so the walk below is never a candidate for refusal in the
  // first place. The document's memo is left recording a POLICEABLE outcome.
  const first = await svc.complete({
    prefix: MP,
    suffix: H_SUFFIX,
    manual: true,
    memberSite: true,
    resolveInjection: RESOLVER,
    uri: H_URI,
  });
  assert.ok(first && first.text === "tileTally(1)", "precondition: the gated member-site ghost was authored and cached");
  assert.strictEqual(g.calls.length, 1);

  // Memo state: POLICEABLE. The non-suppressing state must not manufacture a
  // refusal for a walk that has nothing wrong with it.
  const warmMemo = await memberRead(svc, MP, "tileTa", RESOLVER, H_URI);
  assert.ok(warmMemo, "a member-site base walking into a member position must serve regardless of the memo");
  assert.strictEqual(
    warmMemo.fromCache,
    true,
    "with a policeable memo the walk must still serve: the memo's job is to suppress refusals, never to create them"
  );
  assert.strictEqual(g.calls.length, 1, "no model call: both sites had the same evidence available");

  // Now drive the SAME document dark, via a miss at an unrelated position.
  const darkMiss = await svc.complete({
    prefix: DP,
    suffix: H_SUFFIX,
    manual: true,
    memberSite: true,
    resolveInjection: DARK,
    uri: H_URI,
  });
  assert.strictEqual(g.calls.length, 2, "precondition: the unrelated position is a miss and generates, consulting the dark resolver");
  assert.ok(!darkMiss || darkMiss.fromCache === false, `precondition: the dark miss is not a cache hit, got ${JSON.stringify(darkMiss)}`);

  // Memo state: DARK. The same walk must serve exactly as before. Between the
  // two halves of this test the memo has taken both of its values and the
  // served-or-refused outcome has not moved, which is what "one-way" means.
  const darkMemo = await memberRead(svc, MP, "tileTal", DARK, H_URI);
  assert.ok(darkMemo, "the same walk must serve with a dark memo too");
  assert.strictEqual(darkMemo.fromCache, true, "a dark memo suppresses refusals; it must not change a walk that was already serving");
  assert.strictEqual(darkMemo.text, "tileTally(1)".slice("tileTal".length), "and it serves the same remainder");
  assert.strictEqual(g.calls.length, 2, "no further model call in either memo state");
  svc.dispose();
});

test("H5. a resolver producing member NAMES but no block has NOT gone dark for this purpose - the gate can police with names alone - so the refusal still fires, keystroke after keystroke [surface: 'A resolver that produces member names but no block has NOT gone dark for this purpose']", async () => {
  const g = makeGenerate([H_GHOST, "REGEN-1", "REGEN-2", "REGEN-3"]);
  const svc = service(CFG, g.fn);
  await seedPlainGhost(svc, H_PREFIX, H_URI);
  assert.strictEqual(g.calls.length, 1);

  const k1 = await memberRead(svc, H_PREFIX, "tileTa", NAMES_ONLY, H_URI);
  assert.strictEqual(g.calls.length, 2, "precondition: the first member-site keystroke is refused");
  assert.ok(!k1 || k1.fromCache === false, `keystroke 1 must not be a cache hit, got ${JSON.stringify(k1)}`);

  // Since the round-5 amendment the store rule DOES cache keystroke 1's result
  // (names ground it), but its text "REGEN-1" is not a continuation of the "l"
  // keystroke 2 types past it, so that entry cannot walk-serve here. The ONLY
  // thing that could serve keystroke 2 warm is a wrongly-suppressed refusal
  // reaching the plain-site ghost.
  const k2 = await memberRead(svc, H_PREFIX, "tileTal", NAMES_ONLY, H_URI);
  assert.strictEqual(
    g.calls.length,
    3,
    "names with no block are policeable, so the refusal must still fire on the following keystroke"
  );
  assert.ok(!k2 || k2.fromCache === false, `keystroke 2 must not be served from the walk, got ${JSON.stringify(k2)}`);
  svc.dispose();
});

test("H6. a resolver producing a block normally is unchanged by the outcome rule: the refusal fires on every keystroke [surface: 'produced nothing a mechanism could police with - neither a block for the prompt nor member names for the gate']", async () => {
  const g = makeGenerate([H_GHOST, "REGEN-1", "REGEN-2", "REGEN-3"]);
  const svc = service(CFG, g.fn);
  await seedPlainGhost(svc, H_PREFIX, H_URI);
  assert.strictEqual(g.calls.length, 1);

  const k1 = await memberRead(svc, H_PREFIX, "tileTa", RESOLVER, H_URI);
  assert.strictEqual(g.calls.length, 2, "precondition: the first member-site keystroke is refused");
  assert.ok(!k1 || k1.fromCache === false, `keystroke 1 must not be a cache hit, got ${JSON.stringify(k1)}`);

  const k2 = await memberRead(svc, H_PREFIX, "tileTal", RESOLVER, H_URI);
  assert.strictEqual(
    g.calls.length,
    3,
    "a fully-answering resolver never suppresses the refusal, so the plain-site ghost stays unreachable at a member site"
  );
  assert.ok(!k2 || k2.fromCache === false, `keystroke 2 must not be served from the walk, got ${JSON.stringify(k2)}`);
  svc.dispose();
});
