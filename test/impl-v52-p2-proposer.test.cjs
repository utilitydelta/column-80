// IMPLEMENTER (white-box) - session-v52 phase 2: the proposer proposes the
// DELTA. Three pure modules: `src/core/spokenName.ts` (the fold and the sweep),
// `src/core/tightenClassify.ts` (the four classes and the delta gate),
// `src/core/tightenProposer.ts` (the prompt and the reply parser).
//
// The contract is `session-v52/contract-p2.md`, including its 2026-08-12
// amendments. A blind oracle tests the same surface from the contract alone;
// this file tests the seams the contract does not name - the two-hump acronym
// split, the word-run scan that implements "whole word in the surface", the
// claim walk that gives a twice-listed phrase successive occurrences, the
// source-index tie-break that makes the proposal sort deterministic - plus
// every ship condition, because a ship condition is a test and not a review.
//
// Two rows here exist because the whole phase is one claim and it has to be
// mechanical rather than reviewed:
//   - "the proposer cannot write": every span it returns satisfies
//     prose.slice(start, end) === phrase, swept over a reply corpus that
//     includes invented sentences, rewrites and near-misses;
//   - ship condition 2: over randomised ledgers and candidate sets, the
//     surviving proposals are disjoint from `rendered` and from `visited`
//     UNDER THE FOLD. Accepting every proposal can then never cost a target an
//     injected type.
//
// Run: SKIP_LIVE=1 node --test test/impl-v52-p2-proposer.test.cjs

const test = require("node:test");
const assert = require("node:assert/strict");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-v52-p2-proposer",
  `export {
  foldName,
  identifierVariants,
  matchByFold,
  pluralCandidates,
  spokenWords,
  stripPlural,
} from "../src/core/spokenName";
export { autoAppliesUnderFold, classifyCandidate, deltaProposals } from "../src/core/tightenClassify";
export { isAllCapsConstant, prefillStopNamesFor } from "../src/core/repairTypes";
export { PRELUDE_TYPES } from "../src/core/compilerDirected";
export {
  PROPOSER_SPAN_CAP,
  assembleProposerPrompt,
  parseProposerReply,
} from "../src/core/tightenProposer";
export { stopNamesFor } from "../src/core/repairTypes";\n`,
);
const {
  PRELUDE_TYPES,
  PROPOSER_SPAN_CAP,
  assembleProposerPrompt,
  autoAppliesUnderFold,
  classifyCandidate,
  deltaProposals,
  foldName,
  identifierVariants,
  matchByFold,
  parseProposerReply,
  pluralCandidates,
  spokenWords,
  isAllCapsConstant,
  prefillStopNamesFor,
  stopNamesFor,
  stripPlural,
} = mod;
test.after(cleanup);

// ---------------------------------------------------------------- helpers

/** A ledger with every field present and empty, so a row states only the field
 *  it is about. The product's `PrefillLedger` has no optional members. */
const ledger = (over = {}) => ({
  rendered: [],
  visited: [],
  noBlock: [],
  notLookedAt: [],
  dropped: [],
  typeCap: 4,
  admitted: 0,
  surface: "",
  ...over,
});

const cand = (identifier, over = {}) => ({
  identifier,
  phrase: identifier,
  start: 0,
  end: identifier.length,
  match: "fold",
  ...over,
});

/** Inputs no caller should ever produce, swept at every export. "Never throws"
 *  is a contract clause (amendment 14), so it gets a sweep and not a promise. */
const GARBAGE = [
  undefined,
  null,
  "",
  0,
  1,
  -1,
  NaN,
  true,
  false,
  [],
  {},
  [null],
  [undefined],
  [{}],
  ["", "  "],
  { identifier: 1 },
  Symbol("x"),
  () => {},
  new Map(),
];

// =====================================================================
// spokenName: the fold
// =====================================================================

// The scout's own table (`session-v52/spikes/casefold.cjs`), which is ship
// condition 3's first half. One key, six spellings, two of them spoken.
test("foldName: every spelling in the scout's table folds to one key", () => {
  const key = "shardmemcache";
  for (const spelling of [
    "shard mem cache",
    "Shard Mem Cache",
    "SHARD MEM CACHE",
    "ShardMemCache",
    "ShardMemcache",
    "shard_mem_cache",
    "SHARD_MEM_CACHE",
    "shard-mem-cache",
    "shardmemcache",
    "  shard, mem. cache!  ",
  ]) {
    assert.equal(foldName(spelling), key, `${JSON.stringify(spelling)} must fold to ${key}`);
  }
});

test("foldName: digits survive, everything else that is not a letter goes", () => {
  assert.equal(foldName("WAL2Segment"), "wal2segment");
  assert.equal(foldName("__x_1__"), "x1");
  assert.equal(foldName("!!!"), "");
  assert.equal(foldName(""), "");
  // Deliberately NOT unicode-aware: a fold that kept accents would answer
  // "same name" for two strings the downstream word-run scan cannot find.
  assert.equal(foldName("café"), "caf");
});

test("foldName: garbage never throws and never returns a non-string", () => {
  for (const g of GARBAGE) {
    const out = foldName(g);
    assert.equal(typeof out, "string", `foldName(${String(g)}) must return a string`);
  }
});

// =====================================================================
// spokenName: the splitter
// =====================================================================

test("spokenWords: whitespace, punctuation, humps and underscores all split", () => {
  assert.deepEqual(spokenWords("shard mem cache"), ["shard", "mem", "cache"]);
  assert.deepEqual(spokenWords("ShardMemCache"), ["Shard", "Mem", "Cache"]);
  assert.deepEqual(spokenWords("shard_mem_cache"), ["shard", "mem", "cache"]);
  assert.deepEqual(spokenWords("shard-mem-cache"), ["shard", "mem", "cache"]);
  assert.deepEqual(spokenWords("  the shard, mem cache.  "), ["the", "shard", "mem", "cache"]);
});

// Amendment 4. The splitter splits; lowercasing belongs to `identifierVariants`
// and to `foldName`, both of which do it themselves. A splitter that also
// normalised would leave no caller able to see what the developer typed.
test("spokenWords: the spelling is untouched", () => {
  assert.deepEqual(spokenWords("Shard Mem Cache"), ["Shard", "Mem", "Cache"]);
  assert.deepEqual(spokenWords("SHARD_MEM_CACHE"), ["SHARD", "MEM", "CACHE"]);
});

// The two hump rules and their ORDER, which is the acronym case. A single
// lower-to-upper rule gives `WAL Segment` only because the second rule peels
// the trailing capital off the run; without it `WALSegment` stays one word, and
// with the rules reversed it comes apart into letters.
test("spokenWords: an acronym run splits once, not per letter", () => {
  assert.deepEqual(spokenWords("WALSegment"), ["WAL", "Segment"]);
  assert.deepEqual(spokenWords("parseHTTPHeader"), ["parse", "HTTP", "Header"]);
  assert.deepEqual(spokenWords("HTTP"), ["HTTP"]);
});

test("spokenWords: garbage is an empty list, never a throw", () => {
  for (const g of GARBAGE) {
    assert.ok(Array.isArray(spokenWords(g)), `spokenWords(${String(g)}) must return an array`);
  }
  assert.deepEqual(spokenWords("   "), []);
  assert.deepEqual(spokenWords("!!!"), []);
});

// =====================================================================
// spokenName: the sweep
// =====================================================================

// Ported from `session-v52/spikes/variants.cjs`. The list is the measurement,
// not a derivation, so it is pinned literally.
test("identifierVariants: the nine spellings for a three-word phrase", () => {
  const out = identifierVariants(["shard", "mem", "cache"]);
  for (const want of [
    "ShardMemCache",
    "shardMemCache",
    "shard_mem_cache",
    "SHARD_MEM_CACHE",
    "shardmemcache",
    "Shardmemcache",
    "Shard_Mem_Cache",
    "shard-mem-cache",
    "ShardMemcache",
  ]) {
    assert.ok(out.includes(want), `${want} must be swept.  GOT ${JSON.stringify(out)}`);
  }
  assert.equal(out.length, 9, `nine and no more.  GOT ${JSON.stringify(out)}`);
});

// Amendment 8. The inner-token split is `cap(w0) + cap(w1) + the rest joined`,
// exactly as the spike does it, and it fires at three words or more. Four words
// get ONE extra spelling, not every two-way split of the tail: the spike is the
// measurement and reasoning past it is how a bounded sweep stops being bounded.
test("identifierVariants: the inner-token split fires at three words, and is not widened", () => {
  const two = identifierVariants(["shard", "cache"]);
  const three = identifierVariants(["shard", "mem", "cache"]);
  const four = identifierVariants(["shard", "mem", "cache", "index"]);
  assert.ok(three.includes("ShardMemcache"));
  assert.ok(four.includes("ShardMemcacheindex"), `GOT ${JSON.stringify(four)}`);
  assert.ok(!four.includes("ShardMemCacheindex"), "no second inner split on reasoning");
  // Two words: the "split" would collide with `Shardcache`, which the
  // capitalise-first convention already emits, so the set does not grow.
  assert.equal(two.length, new Set(two).size);
});

test("identifierVariants: deduplicated, and an empty word list is an empty sweep", () => {
  const one = identifierVariants(["cache"]);
  assert.equal(one.length, new Set(one).size, `deduped.  GOT ${JSON.stringify(one)}`);
  assert.deepEqual(identifierVariants([]), []);
  assert.deepEqual(identifierVariants(["", "  ", "!!"]), []);
  for (const g of GARBAGE) {
    assert.ok(Array.isArray(identifierVariants(g)), `identifierVariants(${String(g)}) must return an array`);
  }
});

// The sweep and the fold must agree, or the product queries a provider with a
// spelling it would then refuse. Every variant of a phrase folds to the phrase's
// own key, by construction.
test("identifierVariants: every variant folds back to the phrase's key", () => {
  for (const words of [
    ["shard", "mem", "cache"],
    ["client", "set"],
    ["wire", "size"],
    ["segment", "summary", "payload"],
    ["cache"],
  ]) {
    const key = foldName(words.join(""));
    for (const v of identifierVariants(words)) {
      assert.equal(foldName(v), key, `${v} must fold to ${key}`);
    }
  }
});

// =====================================================================
// spokenName: the plural retry.
//
// `stripPlural` is SUPERSEDED by `pluralCandidates` (contract amendment 17) and
// nothing in the product calls it any more. The rows below stay because the
// blind oracle pins its behaviour and because they are the record of a rule
// that was wrong: forced to pick one strip, it picks `es`, and that is the
// wrong half for every word ending in a silent `e`. The amendment 17 rows
// further down are the live behaviour.
// =====================================================================

// Struck amendment 5. `es` is tried FIRST, on the reasoning that every word
// ending in `es` also ends in `s` so an s-first rule makes the es leg dead.
// True only of a single strip with an early exit, which is the assumption the
// reasoning did not know it was making.
test("stripPlural: es before s", () => {
  assert.deepEqual(stripPlural(["boxes"]), ["box"]);
  assert.deepEqual(stripPlural(["classes"]), ["class"]);
  assert.deepEqual(stripPlural(["client", "sets"]), ["client", "set"]);
  assert.deepEqual(stripPlural(["wire", "sizes"]), ["wire", "siz"]);
});

test("stripPlural: the LAST word only, and only once", () => {
  assert.deepEqual(stripPlural(["clients", "sets"]), ["clients", "set"]);
  // Once: the result still ends in a strippable letter and is handed back
  // anyway. A caller wanting two strips would have to ask twice, and no caller
  // does - a stemmer is what the goal refused.
  assert.deepEqual(stripPlural(["addresses"]), ["address"]);
});

// Amendment 6. A last word that IS `s` or `es` strips to nothing, and an empty
// word is not a name.
test("stripPlural: undefined when there is nothing to strip, or nothing left", () => {
  assert.equal(stripPlural(["cache"]), undefined);
  assert.equal(stripPlural(["shard", "mem"]), undefined);
  assert.equal(stripPlural(["s"]), undefined);
  assert.equal(stripPlural(["es"]), undefined);
  assert.equal(stripPlural(["client", "s"]), undefined);
  assert.equal(stripPlural([]), undefined);
  for (const g of GARBAGE) {
    const out = stripPlural(g);
    assert.ok(out === undefined || Array.isArray(out), `stripPlural(${String(g)}) must be an array or undefined`);
  }
});

// The defect that struck amendment 5, pinned on the superseded function so the
// two behaviours can be told apart. `matchByFold` no longer produces this
// answer: `pluralCandidates` offers `cache` alongside `cach` and the repo picks.
test("stripPlural: the wrong strip, which is why it was superseded", () => {
  assert.deepEqual(stripPlural(["caches"]), ["cach"]);
  assert.deepEqual(pluralCandidates(["caches"]), [["cache"], ["cach"]], "the live path offers both");
});

// =====================================================================
// spokenName: matchByFold, which is the auto-accept gate
// =====================================================================

test("matchByFold: a fold hit is a fold hit whatever the repo's convention", () => {
  for (const ident of ["ShardMemCache", "ShardMemcache", "shard_mem_cache", "SHARD_MEM_CACHE"]) {
    assert.deepEqual(matchByFold("shard mem cache", [ident]), { identifier: ident, match: "fold" });
  }
  assert.deepEqual(matchByFold("Shard Mem Cache", ["ShardMemCache", "Widget"]), {
    identifier: "ShardMemCache",
    match: "fold",
  });
});

test("matchByFold: the plural retry, and it is labelled as one", () => {
  assert.deepEqual(matchByFold("client sets", ["ClientSet"]), { identifier: "ClientSet", match: "plural" });
  assert.deepEqual(matchByFold("boxes", ["Box2"]), undefined);
  assert.deepEqual(matchByFold("boxes", ["Box"]), { identifier: "Box", match: "plural" });
});

// Ship condition 3's second half: the two cases the fold cannot rescue return
// nothing or a guess, and NEVER a silent pick.
test("matchByFold: the abbreviation case refuses", () => {
  assert.equal(matchByFold("shard memory cache", ["ShardMemCache"]), undefined);
});

test("matchByFold: a genuine collision refuses rather than picking", () => {
  assert.equal(matchByFold("read error", ["ReadError", "read_error"]), undefined);
  // Amendment 9: the same refusal at the plural stage.
  assert.equal(matchByFold("client sets", ["ClientSet", "client_set"]), undefined);
});

// One name found twice is one name. A provider that returns `ClientSet` from
// two files has not found a collision.
test("matchByFold: the same spelling twice is not ambiguous", () => {
  assert.deepEqual(matchByFold("client set", ["ClientSet", "ClientSet"]), {
    identifier: "ClientSet",
    match: "fold",
  });
});

test("matchByFold: garbage is undefined, never a throw", () => {
  for (const g of GARBAGE) {
    assert.equal(matchByFold(g, ["ClientSet"]), undefined, `matchByFold(${String(g)}, ...)`);
    const out = matchByFold("client set", g);
    assert.ok(out === undefined || typeof out === "object");
  }
  assert.equal(matchByFold("client set", []), undefined);
  assert.equal(matchByFold("!!!", ["ClientSet"]), undefined);
});

// =====================================================================
// tightenClassify: the four classes
// =====================================================================

test("classifyCandidate: the four classes off a synthetic ledger", () => {
  assert.equal(classifyCandidate("A", ledger({ rendered: ["A"] })), 1);
  assert.equal(classifyCandidate("A", ledger({ visited: ["A"] })), 2);
  assert.equal(classifyCandidate("A", ledger({ surface: "Members of `A`" })), 2);
  assert.equal(classifyCandidate("A", ledger({ notLookedAt: ["A"] })), 3);
  assert.equal(classifyCandidate("A", ledger({ dropped: [{ name: "A", cause: "rootCap 4" }] })), 3);
  assert.equal(classifyCandidate("A", ledger({ noBlock: [{ type: "A", reason: "no anchor found" }] })), 3);
  assert.equal(classifyCandidate("A", ledger()), 4);
});

// First hit wins, in the contract's order. A name in `rendered` AND in
// `dropped` is class 1: it rendered, so a backtick on it only evicts.
test("classifyCandidate: first hit wins, in the contract's order", () => {
  assert.equal(
    classifyCandidate("A", ledger({ rendered: ["A"], visited: ["A"], notLookedAt: ["A"], surface: "A" })),
    1,
  );
  assert.equal(classifyCandidate("A", ledger({ visited: ["A"], notLookedAt: ["A"] })), 2);
  assert.equal(classifyCandidate("A", ledger({ surface: "A", dropped: [{ name: "A", cause: "x" }] })), 2);
});

// Amendment 2. The bias is toward dropping, because ship condition 1 makes a
// class 1 or 2 proposal a defect while a missed class 4 is a missed
// opportunity.
test("classifyCandidate: matching is UNDER THE FOLD, not by spelling", () => {
  assert.equal(classifyCandidate("ShardMemCache", ledger({ rendered: ["shard_mem_cache"] })), 1);
  assert.equal(classifyCandidate("ShardMemCache", ledger({ visited: ["SHARD_MEM_CACHE"] })), 2);
  assert.equal(classifyCandidate("ShardMemCache", ledger({ notLookedAt: ["ShardMemcache"] })), 3);
  assert.equal(classifyCandidate("ClientSet", ledger({ dropped: [{ name: "client_set", cause: "x" }] })), 3);
});

// Amendment 3, and the word-run scan is how it is implemented: the surface is
// cut into `[A-Za-z0-9_]+` runs and each run's fold is compared. That gives all
// three of the contract's examples for free.
test("classifyCandidate: a whole word in the surface, and what is not one", () => {
  assert.equal(classifyCandidate("ShardMemCache", ledger({ surface: "fn f(x: foo.ShardMemCache)" })), 2);
  assert.equal(classifyCandidate("ShardMemCache", ledger({ surface: "let my_ShardMemCache = 1;" })), 4);
  assert.equal(classifyCandidate("ShardMemCache", ledger({ surface: "type ShardMemCache2 = u8;" })), 4);
  assert.equal(classifyCandidate("ShardMemCache", ledger({ surface: "`ShardMemCache`" })), 2);
  assert.equal(classifyCandidate("ShardMemCache", ledger({ surface: "shard_mem_cache" })), 2);
});

// Amendment 14. A ledger that says nothing disclosed nothing, so nothing can be
// shown to be in the surface. It is a DEGRADE and not a guess, and the row
// exists so an implementation cannot quietly make it a throw.
test("classifyCandidate: a ledger that says nothing classifies everything as 4", () => {
  for (const g of GARBAGE) {
    assert.equal(classifyCandidate("A", g), 4, `classifyCandidate("A", ${String(g)})`);
  }
  assert.equal(classifyCandidate("A", { rendered: "A" }), 4);
  assert.equal(classifyCandidate("A", ledger({ rendered: [null, undefined, 7] })), 4);
  assert.equal(classifyCandidate("A", ledger({ dropped: [null, "A", {}] })), 4);
});

test("classifyCandidate: a candidate that is not a name is class 4", () => {
  for (const g of GARBAGE) {
    assert.equal(classifyCandidate(g, ledger({ rendered: ["A"] })), 4, `classifyCandidate(${String(g)}, ...)`);
  }
});

// Defect 3 from the phase 2 adversarial review, and it was a ship condition 1
// breach. The fold is ASCII-only, so a CJK, Cyrillic or Greek type name - which
// Python, C#, TypeScript and Rust all accept - folded to the empty string, the
// empty key was skipped on both sides, and a candidate that was LITERALLY the
// string in `rendered` came back class 4 and was proposed.
test("classifyCandidate: an empty fold key falls back to exact string equality", () => {
  for (const name of ["顧客", "Клиент", "____", "Πελάτης"]) {
    assert.equal(classifyCandidate(name, ledger({ rendered: [name] })), 1, `${name} rendered`);
    assert.equal(classifyCandidate(name, ledger({ visited: [name] })), 2, `${name} visited`);
    assert.equal(classifyCandidate(name, ledger({ notLookedAt: [name] })), 3, `${name} notLookedAt`);
    assert.equal(classifyCandidate(name, ledger({ surface: `struct ${name} {}` })), 2, `${name} in the surface`);
    assert.equal(classifyCandidate(name, ledger()), 4, `${name} in nothing`);
    assert.deepEqual(deltaProposals([cand(name)], ledger({ rendered: [name] })), [], `${name} must not be proposed`);
  }
});

// The fallback must not merge two names the fold would have kept apart. A raw
// non-ASCII string only ever equals itself, and no folded ASCII key can collide
// with one.
test("classifyCandidate: the raw-key fallback does not merge distinct names", () => {
  assert.equal(classifyCandidate("顧客", ledger({ rendered: ["取引先"] })), 4);
  assert.equal(classifyCandidate("____", ledger({ rendered: ["___"] })), 4);
  assert.equal(classifyCandidate("____", ledger({ rendered: ["_ _ _ _"] })), 4);
  assert.equal(classifyCandidate("Widget", ledger({ rendered: ["顧客"] })), 4);
});

// The whole-word rule applied literally to a script with no word separator
// OVER-matches, and that is the chosen direction: ship condition 1 makes a
// class 2 miss a defect and a class 4 miss only a lost opportunity.
test("classifyCandidate: the non-ASCII surface scan errs toward dropping", () => {
  assert.equal(classifyCandidate("顧客", ledger({ surface: "class 顧客管理:" })), 2);
  assert.equal(classifyCandidate("Widget", ledger({ surface: "class WidgetManager:" })), 4);
});

// =====================================================================
// tightenClassify: the delta gate
// =====================================================================

// Ship condition 1.
test("deltaProposals: classes 1 and 2 never reach a caller", () => {
  const out = deltaProposals(
    [cand("Rendered"), cand("Visited"), cand("InSurface"), cand("Dropped"), cand("Unknown")],
    ledger({
      rendered: ["Rendered"],
      visited: ["Visited"],
      surface: "Members of `InSurface`",
      dropped: [{ name: "Dropped", cause: "rootCap 4" }],
    }),
  );
  assert.deepEqual(
    out.map((p) => p.identifier),
    ["Unknown", "Dropped"],
    `only classes 4 and 3 survive.  GOT ${JSON.stringify(out)}`,
  );
});

test("deltaProposals: class 4 ranks ahead of class 3, and source order holds inside a class", () => {
  const out = deltaProposals(
    [cand("D1"), cand("U1"), cand("D2"), cand("U2")],
    ledger({ notLookedAt: ["D1", "D2"] }),
  );
  assert.deepEqual(
    out.map((p) => `${p.identifier}:${p.klass}`),
    ["U1:4", "U2:4", "D1:3", "D2:3"],
  );
});

// `displaces` is a property of the CAP being full, not of the class. Both facts
// reach the diff: the class says whether the type is in the prompt today,
// `displaces` says what accepting costs.
test("deltaProposals: displaces names the last rendered root when the cap is full", () => {
  const full = ledger({ rendered: ["First", "Second", "Last"], typeCap: 3, admitted: 3 });
  const out = deltaProposals([cand("New"), cand("Dropped")], { ...full, notLookedAt: ["Dropped"] });
  assert.equal(out.length, 2);
  for (const p of out) {
    assert.equal(p.displaces, "Last", `every survivor names the same displaced root.  GOT ${JSON.stringify(p)}`);
  }
});

test("deltaProposals: no displaces when the cap has a free slot", () => {
  const out = deltaProposals([cand("New")], ledger({ rendered: ["A"], typeCap: 4, admitted: 1 }));
  assert.equal(out.length, 1);
  assert.ok(!("displaces" in out[0]), `absent, not undefined.  GOT ${JSON.stringify(out[0])}`);
});

// Amendment 1. There is no name to give, and a `displaces` field naming nothing
// is worse than no field.
test("deltaProposals: a full cap with nothing rendered still has no displaces", () => {
  const out = deltaProposals([cand("New")], ledger({ rendered: [], typeCap: 0, admitted: 0 }));
  assert.equal(out.length, 1);
  assert.ok(!("displaces" in out[0]), `GOT ${JSON.stringify(out[0])}`);
});

// Amendment 15.
test("deltaProposals: duplicate identifiers dedupe to the first", () => {
  const out = deltaProposals(
    [cand("A", { start: 0, end: 1 }), cand("A", { start: 40, end: 41 }), cand("B")],
    ledger(),
  );
  assert.deepEqual(
    out.map((p) => [p.identifier, p.start]),
    [
      ["A", 0],
      ["B", 0],
    ],
  );
});

// The product's per-language stop sets stay in force, and they come from
// `stopNamesFor` - the same source every other leg reads. Absent means NO stop
// set rather than Rust's, for the same reason `commentTypesIn` takes the
// caller's: inheriting Rust's idea of `Result` in C# loses a real type.
test("deltaProposals: the language's own stop set drops std names before the gate", () => {
  const rustStd = [...stopNamesFor("rust")][0];
  assert.equal(typeof rustStd, "string");
  assert.deepEqual(deltaProposals([cand(rustStd), cand("Widget")], ledger(), "rust").map((p) => p.identifier), [
    "Widget",
  ]);
  assert.deepEqual(deltaProposals([cand(rustStd), cand("Widget")], ledger()).map((p) => p.identifier), [
    rustStd,
    "Widget",
  ]);
  const csStd = [...stopNamesFor("csharp")][0];
  assert.deepEqual(deltaProposals([cand(csStd)], ledger(), "csharp"), []);
});

// =====================================================================
// DEFECT A (delta census). The gate must apply the PRE-FILL's refusals, not
// the resolver's. A proposal for a name the pre-fill discards is worse than no
// proposal: the developer accepts it, their comment changes, a capped slot
// carries it, and the pre-fill throws it away the moment it is backticked.
// =====================================================================

// `fnGen.ts` refuses SCREAMING_CASE for every candidate tier
// (`refused = declared.has(n) || isAllCapsConstant(n)`). Measured cost of the
// gate not doing so: 21 of Rust's 109 class-4 instances, 6 of TypeScript's 300.
test("DEFECT A: SCREAMING_CASE is refused, in every language and with no language", () => {
  for (const name of ["WORKLOAD_SCHEMA", "CLIENT_ID", "MAX_RETRY_COUNT"]) {
    assert.ok(isAllCapsConstant(name), `fixture: ${name} must be what the pre-fill calls a constant`);
    for (const lang of ["rust", "typescript", "csharp", "python", "go", undefined]) {
      assert.deepEqual(
        deltaProposals([cand(name)], ledger(), lang),
        [],
        `${name} must not be proposed for ${lang ?? "no language"}; the pre-fill will refuse it`,
      );
    }
  }
  // The refusal is the pre-fill's rule and not a wider one: a single capital
  // run with no underscore is a short type name, and fn-gen keeps it.
  assert.ok(!isAllCapsConstant("HTTP"));
  assert.deepEqual(deltaProposals([cand("HTTP")], ledger(), "rust").map((p) => p.identifier), ["HTTP"]);
});

// `stopNamesFor("rust")` is `STD_TYPE_NAMES` and answers "is this std, so not
// worth a round trip". The pre-fill's comment leg asks a different question and
// uses `PRELUDE_TYPES`, which also carries these five. 29 more of Rust's 109.
test("DEFECT A: the gate uses the PRE-FILL's Rust stop set, not the resolver's", () => {
  for (const name of ["None", "Some", "Ok", "Err", "Self"]) {
    assert.ok(PRELUDE_TYPES.has(name), `fixture: ${name} is in the pre-fill's set`);
    assert.ok(!stopNamesFor("rust").has(name), `fixture: ${name} is NOT in the resolver's set, which is the defect`);
    assert.deepEqual(deltaProposals([cand(name)], ledger(), "rust"), [], `${name} must not be proposed`);
  }
});

// ONE SOURCE, not a second copy. The gate and `fnGen.ts`'s five comment legs
// both read `prefillStopNamesFor`, which is how these two sets stop drifting.
test("DEFECT A: prefillStopNamesFor differs from stopNamesFor in Rust and nowhere else", () => {
  assert.equal(prefillStopNamesFor("rust"), PRELUDE_TYPES);
  for (const lang of ["typescript", "typescriptreact", "csharp", "python", "go"]) {
    assert.equal(prefillStopNamesFor(lang), stopNamesFor(lang), `${lang} must be the same set object`);
  }
});

test("deltaProposals: every field of the candidate rides through untouched", () => {
  const c = { identifier: "ShardMemCache", phrase: "shard mem cache", start: 12, end: 27, match: "plural" };
  const [p] = deltaProposals([c], ledger());
  assert.equal(p.identifier, "ShardMemCache");
  assert.equal(p.phrase, "shard mem cache");
  assert.equal(p.start, 12);
  assert.equal(p.end, 27);
  assert.equal(p.match, "plural");
  assert.equal(p.klass, 4);
});

// =====================================================================
// THE AUTO-ACCEPT GATE. The session's central guarantee, and the phase 2
// adversarial review's promoted HIGH: a `plural` match used to auto-apply and
// its fold is NOT equal to the spoken span.
// =====================================================================

test("autoAppliesUnderFold: only a fold match, and the plural retry is not one", () => {
  assert.equal(autoAppliesUnderFold("fold"), true);
  assert.equal(autoAppliesUnderFold("plural"), false, "a plural strip is a guess about English, not a respelling");
  assert.equal(autoAppliesUnderFold("guess"), false);
  // Never throws, and anything it does not recognise is refused rather than
  // waved through: the failure direction has to be "ask the human".
  for (const g of GARBAGE) {
    assert.equal(autoAppliesUnderFold(g), false, `autoAppliesUnderFold(${String(g)})`);
  }
});

// The mechanical statement of the goal's ship condition. The folds are NOT
// equal, so nothing about this substitution may be silent.
test("the plural retry breaks fold equality, which is why it cannot auto-apply", () => {
  const hit = matchByFold("client sets", ["ClientSet"]);
  assert.deepEqual(hit, { identifier: "ClientSet", match: "plural" });
  assert.notEqual(
    foldName("client sets"),
    foldName(hit.identifier),
    "clientsets vs clientset: if these were equal the substitution would be a respelling",
  );
  const [p] = deltaProposals([cand("ClientSet", { phrase: "client sets", match: "plural" })], ledger());
  assert.equal(p.autoApply, false);
});

// The concrete hazard the review named, and under amendment 5 the product
// answered it with a confident wrong type: "planes" ends in `es`, the single
// strip took `es` first, and `Plan` came back with no collision to refuse on
// because `Plane` was never generated. Amendment 17 generates both, so the repo
// holding both spellings is now a REFUSAL - which is what this product does
// when it cannot tell.
test("the Plan/Plane hazard: a repo holding both spellings gets a refusal, not a pick", () => {
  assert.equal(matchByFold("planes", ["Plan", "Plane"]), undefined, "both strips resolve, to different names");
  assert.equal(matchByFold("states", ["Stat", "State"]), undefined, "the review's other pair, same shape");
  // The superseded single strip is still what it was, and it is still the wrong
  // half of the pair. Kept as the record of why amendment 5 was struck.
  assert.deepEqual(stripPlural(["planes"]), ["plan"]);
  // A repo with only ONE of the two is not ambiguous, and both directions
  // resolve. This is the pair of rows that stops the refusal being implemented
  // as "any word ending in es refuses".
  assert.deepEqual(matchByFold("planes", ["Plane"]), { identifier: "Plane", match: "plural" });
  assert.deepEqual(matchByFold("planes", ["Plan"]), { identifier: "Plan", match: "plural" });
});

// Amendment 17's recall half. Every one of these was a miss under the single
// strip, and the class is the largest measured plural defect: a last word
// ending in a silent `e`.
test("amendment 17: the silent-e class is recovered, and the cases that worked still work", () => {
  for (const [phrase, ident] of [
    ["caches", "Cache"],
    ["node samples", "NodeSample"],
    ["history lines", "HistoryLine"],
    ["op outcomes", "OpOutcome"],
    ["per node states", "PerNodeState"],
  ]) {
    assert.deepEqual(matchByFold(phrase, [ident]), { identifier: ident, match: "plural" }, `${phrase} -> ${ident}`);
  }
  for (const [phrase, ident] of [
    ["boxes", "Box"],
    ["classes", "Class"],
    ["client sets", "ClientSet"],
    ["matches", "Match"],
  ]) {
    assert.deepEqual(matchByFold(phrase, [ident]), { identifier: ident, match: "plural" }, `${phrase} -> ${ident}`);
  }
});

test("pluralCandidates: both strips, deduped, and empty when there is no plural", () => {
  assert.deepEqual(pluralCandidates(["client", "sets"]), [["client", "set"]], "sets does not end in es, so one candidate");
  assert.deepEqual(pluralCandidates(["boxes"]), [["boxe"], ["box"]], "s-stripped first, then es-stripped");
  assert.deepEqual(pluralCandidates(["caches"]), [["cache"], ["cach"]]);
  assert.deepEqual(pluralCandidates(["cache"]), [], "no trailing plural at all");
  assert.deepEqual(pluralCandidates(["s"]), [], "stripping to nothing is not a candidate");
  assert.deepEqual(pluralCandidates([]), []);
  // Only the LAST word, and only one strip each. Still bounded, still not a
  // stemmer: two candidates is the whole widening amendment 17 buys.
  assert.deepEqual(pluralCandidates(["clients", "sets"]), [["clients", "set"]]);
  for (const g of GARBAGE) {
    assert.ok(Array.isArray(pluralCandidates(g)), `pluralCandidates(${String(g)}) must return an array`);
  }
});

// Amendment 9 survives amendment 17: an ambiguous strip refuses the WHOLE
// match. It does not fall through to the other strip, because falling through
// would be picking one reading over an ambiguity.
test("amendment 17: one ambiguous strip refuses, it does not fall through to the other", () => {
  // `boxe` is ambiguous (two spellings of one fold key); `box` would resolve
  // cleanly. The refusal wins.
  assert.equal(matchByFold("boxes", ["Boxe", "boxe", "Box"]), undefined);
  // And the plain two-spelling collision on the surviving strip still refuses.
  assert.equal(matchByFold("client sets", ["ClientSet", "client_set"]), undefined);
});

test("deltaProposals: autoApply is on every proposal, and it tracks the match", () => {
  const out = deltaProposals(
    [
      cand("A", { match: "fold" }),
      cand("B", { match: "plural" }),
      cand("C", { match: "guess" }),
    ],
    ledger(),
  );
  assert.deepEqual(
    out.map((p) => [p.identifier, p.autoApply]),
    [
      ["A", true],
      ["B", false],
      ["C", false],
    ],
  );
  // Materialised on the proposal rather than left to the consumer, because a
  // consumer reading `match` and reasoning about it is how the first version of
  // this phase auto-applied a plural.
  for (const p of out) {
    assert.equal(typeof p.autoApply, "boolean");
    assert.equal(p.autoApply, autoAppliesUnderFold(p.match));
  }
});

// A candidate whose `match` is missing or nonsense is a `guess`, so it cannot
// be auto-applied by arriving malformed.
test("deltaProposals: an unreadable match degrades to guess, never to auto-apply", () => {
  for (const bad of [undefined, null, "", "FOLD", "auto", 1, {}]) {
    const [p] = deltaProposals([{ identifier: "A", phrase: "a", start: 0, end: 1, match: bad }], ledger());
    assert.equal(p.match, "guess", `match ${String(bad)} must read as a guess`);
    assert.equal(p.autoApply, false);
  }
});

test("deltaProposals: the input array is never mutated", () => {
  const input = [cand("A"), cand("B")];
  const before = JSON.stringify(input);
  deltaProposals(input, ledger({ rendered: ["A"] }));
  assert.equal(JSON.stringify(input), before);
});

test("deltaProposals: garbage is an empty list, never a throw", () => {
  for (const g of GARBAGE) {
    assert.ok(Array.isArray(deltaProposals(g, ledger())), `deltaProposals(${String(g)}, ledger)`);
    assert.ok(Array.isArray(deltaProposals([cand("A")], g)), `deltaProposals([A], ${String(g)})`);
    assert.ok(Array.isArray(deltaProposals([cand("A")], ledger(), g)));
  }
  assert.deepEqual(deltaProposals([null, undefined, {}, { identifier: "" }], ledger()), []);
});

// -------- SHIP CONDITION 2, as a property rather than an example.

test("SHIP 2: survivors are disjoint from rendered and visited, over randomised ledgers", () => {
  // Deterministic PRNG. A property test that cannot be replayed is a property
  // test that reports a failure nobody can reproduce.
  let seed = 0x5eed52;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const pool = [
    "ShardMemCache",
    "shard_mem_cache",
    "SHARD_MEM_CACHE",
    "ClientSet",
    "client_set",
    "Widget",
    "widget",
    "SegmentSummaryPayload",
    "WALSegment",
    "Cache",
  ];
  const pick = () => pool.filter(() => rnd() < 0.3);
  for (let i = 0; i < 400; i++) {
    const led = ledger({
      rendered: pick(),
      visited: pick(),
      notLookedAt: pick(),
      dropped: pick().map((n) => ({ name: n, cause: "rootCap 4" })),
      noBlock: pick().map((n) => ({ type: n, reason: "no anchor found" })),
      surface: pick().join(" "),
      typeCap: Math.floor(rnd() * 6),
      admitted: Math.floor(rnd() * 6),
    });
    const candidates = pick().map((n) => cand(n));
    const out = deltaProposals(candidates, led);
    const banned = new Set(
      [...led.rendered, ...led.visited, ...led.surface.split(/[^A-Za-z0-9_]+/)]
        .map(foldName)
        .filter((k) => k !== ""),
    );
    for (const p of out) {
      assert.ok(
        !banned.has(foldName(p.identifier)),
        `iteration ${i}: ${p.identifier} is already in the surface, so accepting it evicts a real type.\n  LEDGER ${JSON.stringify(led)}`,
      );
      assert.ok(p.klass === 3 || p.klass === 4);
    }
  }
});

// =====================================================================
// tightenProposer: the prompt
// =====================================================================

test("assembleProposerPrompt: it carries the prose, and the languageId raw", () => {
  const prose = "Drop all the client sets that the shard mem cache still holds.";
  const out = assembleProposerPrompt({ prose, languageId: "csharp" });
  assert.ok(out.includes(prose), "the prose must be in the prompt verbatim");
  // Amendment 16: no display-name table. `csharp` stays `csharp`.
  assert.ok(out.includes("csharp"), `GOT ${out}`);
  assert.ok(!/C#|CSharp|C Sharp/.test(out), `no display-name table.  GOT ${out}`);
});

test("assembleProposerPrompt: it asks for verbatim spans, one per line, and nothing else", () => {
  const out = assembleProposerPrompt({ prose: "The shard mem cache.", languageId: "rust" }).toLowerCase();
  assert.match(out, /verbatim/, "the copy-it-exactly instruction");
  assert.match(out, /one span per line|one per line/, "the one-per-line instruction");
  assert.match(out, /no explanation/, "no explanation");
  assert.match(out, /no code fence|no fence/, "no code fence");
  assert.match(out, /type/, "it must say what to name");
});

// A dictated comment carrying a backticked name is the normal case, and a
// rendered one may carry a whole fenced block. A three-backtick fence would let
// the prose close the fence and the model would read the instruction as data.
test("assembleProposerPrompt: the fence outgrows the prose's own backticks", () => {
  const prose = "Use ```rust\nlet x = 1;\n``` here.";
  const out = assembleProposerPrompt({ prose, languageId: "rust" });
  assert.ok(out.includes(prose), "the prose still rides verbatim");
  assert.ok(out.includes("````"), `the fence must be longer than the prose's run.  GOT ${out}`);
});

// DEFECT B (delta census). The claude-code backend took a SECOND TURN on 14 of
// 60 rows and the product refused every one of those replies, which is right:
// `claudeCodeInstruct.ts` treats `num_turns > 1` as an agent transcript. A 23%
// silent-failure rate on a manual command, caused by the prompt.
//
// These rows pin the three properties the fix turns on. None of them can prove
// the turn count - that took 60 live calls, recorded in
// `session-v52/census-b-turns-all.jsonl` - but each one guards the wording that
// invited a second turn from coming back.
test("DEFECT B: the prompt never asks the model about the codebase", () => {
  const out = assembleProposerPrompt({ prose: "Flush the shard mem cache.", languageId: "rust" });
  // Asking an agent that inspects codebases "which of these does the codebase
  // define" is asking a question it cannot answer in one turn: `--tools ""`
  // means it cannot look. The judgement is on the prose alone.
  assert.ok(!/the codebase defines|does the codebase|in the codebase/i.test(out), `GOT ${out}`);
  assert.match(out, /prose alone/i, "the prompt must say where the judgement comes from");
  assert.match(out, /do not have the codebase|must not try to open/i, "and that the codebase is absent");
});

test("DEFECT B: the empty reply is not a legal answer", () => {
  const out = assembleProposerPrompt({ prose: "Flush the shard mem cache.", languageId: "rust" });
  // An empty assistant turn is the shape most likely to be continued, so there
  // is always exactly one line to write.
  assert.ok(!/reply with nothing|nothing at all/i.test(out), `GOT ${out}`);
  assert.match(out, /reply with the single word NONE/i);
  // And the sentinel is inert: the parser drops any line the prose does not
  // carry verbatim, so NONE never becomes a span.
  assert.deepEqual(parseProposerReply("NONE", "Flush the shard mem cache."), []);
});

test("DEFECT B: the fenced prose is labelled as data, and the answer is one turn", () => {
  const out = assembleProposerPrompt({ prose: "Split the list on TOP-LEVEL commas.", languageId: "typescript" });
  // A doc comment is written in the imperative, so a model handed one with no
  // frame can read it as the task. Both census refusals whose prose is quoted
  // in the write-up are that shape.
  assert.match(out, /is DATA, not instructions/i);
  assert.match(out, /none of them is addressed to you/i);
  assert.match(out, /one reply and then stop/i);
  assert.match(out, /do not ask a question/i);
});

test("assembleProposerPrompt: garbage is a string, never a throw", () => {
  for (const g of GARBAGE) {
    assert.equal(typeof assembleProposerPrompt(g), "string", `assembleProposerPrompt(${String(g)})`);
    assert.equal(typeof assembleProposerPrompt({ prose: g, languageId: g }), "string");
  }
});

// =====================================================================
// tightenProposer: the reply parser
// =====================================================================

const PROSE = "Drop all the client sets that the shard mem cache still holds after the shard mem cache flushes.";

// -------- SHIP CONDITION 4, and it is the phase's whole guarantee.

test("SHIP 4: every span is a verbatim substring of the prose, at the offsets reported", () => {
  const replies = [
    "client sets\nshard mem cache",
    "shard mem cache\nShard Mem Cache\nSHARD MEM CACHE",
    "The prose refers to a ShardMemCache and a ClientSet.\nI think these are the types.",
    "```\nclient sets\n```",
    "- client sets\n1. shard mem cache",
    "  client sets  \n\n\tshard mem cache\t",
    "holds\nholds\nholds\nholds",
    " ￿\n" + "x".repeat(5000),
    PROSE,
    "",
  ];
  for (const reply of replies) {
    const spans = parseProposerReply(reply, PROSE);
    assert.ok(Array.isArray(spans));
    for (const s of spans) {
      assert.equal(
        PROSE.slice(s.start, s.end),
        s.phrase,
        `the parser may not write: ${JSON.stringify(s)} for reply ${JSON.stringify(reply)}`,
      );
      assert.ok(s.start >= 0 && s.end <= PROSE.length && s.start < s.end);
    }
  }
});

test("SHIP 4: a reply full of invented sentences yields nothing", () => {
  const invented = [
    "The type is ShardMemCache.",
    "I believe the developer meant `ClientSet` and `ShardMemCache`.",
    "1. ShardMemCache\n2. ClientSet",
    "No types found.",
    "shard memory cache",
  ].join("\n");
  assert.deepEqual(parseProposerReply(invented, PROSE), []);
});

// Amendment 11: trim is the ONLY normalisation. A parser that also stripped
// bullets and unquoted would be a parser with an editorial opinion about a
// reply the prompt already constrains, and every character it added back is a
// character the developer did not say.
test("parseProposerReply: lines are trimmed, and nothing else is normalised", () => {
  assert.deepEqual(parseProposerReply("   client sets \t\n", PROSE), [
    { phrase: "client sets", start: PROSE.indexOf("client sets"), end: PROSE.indexOf("client sets") + 11 },
  ]);
  assert.deepEqual(parseProposerReply("- client sets", PROSE), []);
  assert.deepEqual(parseProposerReply("`client sets`", PROSE), []);
  assert.deepEqual(parseProposerReply('"client sets"', PROSE), []);
});

// One occurrence of the phrase in the prose, so a dropped short span has
// nowhere else to go. `PROSE` carries two copies deliberately and would let
// `shard` land in the second one, which is amendment 10 and a separate row.
test("parseProposerReply: the longest span wins and the shorter overlapping one is dropped", () => {
  const prose = "Flush the shard mem cache now.";
  const out = parseProposerReply("shard\nshard mem cache\ncache", prose);
  assert.deepEqual(
    out.map((s) => s.phrase),
    ["shard mem cache"],
    `GOT ${JSON.stringify(out)}`,
  );
});

// Non-overlapping spans all survive, however short.
test("parseProposerReply: a short span that overlaps nothing survives", () => {
  const out = parseProposerReply("client sets\nholds", PROSE);
  assert.deepEqual(new Set(out.map((s) => s.phrase)), new Set(["client sets", "holds"]));
});

// Amendment 13.
//
// FIXTURE CHANGED 2026-08-12 (phase 5 adversarial defect 2), assertion
// untouched. It was `abcd` with claims `bcd` and `abc`, and every span in it
// starts or ends in the middle of a word. `occurrenceAt` now refuses exactly
// that, because `prose.indexOf` is what let a claim of `shard mem cache` be
// written through the human's own word `reshard`. The two claims below are the
// same shape - equal length, overlapping, one starting earlier - on spans that
// begin and end where words do.
test("parseProposerReply: two equal-length overlapping spans - the earlier start wins", () => {
  const prose = "alpha beta gamma";
  const out = parseProposerReply("beta gamma\nalpha beta", prose);
  assert.deepEqual(out, [{ phrase: "alpha beta", start: 0, end: 10 }], `GOT ${JSON.stringify(out)}`);
});

// Amendment 10, both halves. One claim takes the first FREE occurrence; a model
// that lists a phrase twice is asking for two of them.
test("parseProposerReply: a repeated phrase claims successive occurrences", () => {
  const once = parseProposerReply("shard mem cache", PROSE);
  assert.equal(once.length, 1);
  assert.equal(once[0].start, PROSE.indexOf("shard mem cache"));

  const twice = parseProposerReply("shard mem cache\nshard mem cache", PROSE);
  assert.equal(twice.length, 2, `GOT ${JSON.stringify(twice)}`);
  assert.equal(twice[0].start, PROSE.indexOf("shard mem cache"));
  assert.equal(twice[1].start, PROSE.lastIndexOf("shard mem cache"));
  for (const s of twice) {
    assert.equal(PROSE.slice(s.start, s.end), s.phrase);
  }
});

test("parseProposerReply: a shorter phrase skips past an occupied occurrence to a free one", () => {
  // `shard mem cache` takes the FIRST occurrence; `shard` then cannot have the
  // one inside it and takes the one in the second copy instead.
  const out = parseProposerReply("shard mem cache\nshard", PROSE);
  assert.equal(out.length, 2, `GOT ${JSON.stringify(out)}`);
  const shard = out.find((s) => s.phrase === "shard");
  assert.ok(shard !== undefined);
  assert.ok(shard.start > PROSE.indexOf("shard mem cache") + "shard mem cache".length);
  assert.equal(PROSE.slice(shard.start, shard.end), "shard");
});

// Amendment 12. The cap applies AFTER the sort and AFTER overlap removal, so
// what survives is the best spans, not the first ones the model typed.
test("parseProposerReply: the cap keeps the LONGEST spans, not the first typed", () => {
  const words = [];
  for (let i = 0; i < PROPOSER_SPAN_CAP + 6; i++) {
    words.push("w" + "x".repeat(i));
  }
  const prose = words.join(" ");
  // Shortest first in the reply, so a cap applied before the sort would keep
  // exactly the wrong ones.
  const out = parseProposerReply(words.join("\n"), prose);
  assert.equal(out.length, PROPOSER_SPAN_CAP);
  const kept = new Set(out.map((s) => s.phrase));
  for (const w of words.slice(-PROPOSER_SPAN_CAP)) {
    assert.ok(kept.has(w), `the longest ${PROPOSER_SPAN_CAP} survive; ${w} did not.  GOT ${JSON.stringify([...kept])}`);
  }
});

test("PROPOSER_SPAN_CAP: a positive integer the parser actually honours", () => {
  assert.ok(Number.isInteger(PROPOSER_SPAN_CAP) && PROPOSER_SPAN_CAP > 0);
  const prose = "a b c d e f g h i j k l m n o p q r s t";
  const out = parseProposerReply(prose.split(" ").join("\n"), prose);
  assert.ok(out.length <= PROPOSER_SPAN_CAP);
});

test("parseProposerReply: CRLF replies split the same as LF ones", () => {
  assert.deepEqual(
    parseProposerReply("client sets\r\nholds", PROSE).map((s) => s.phrase).sort(),
    ["client sets", "holds"],
  );
});

test("parseProposerReply: garbage is an empty list, never a throw", () => {
  for (const g of GARBAGE) {
    assert.ok(Array.isArray(parseProposerReply(g, PROSE)), `parseProposerReply(${String(g)}, prose)`);
    assert.ok(Array.isArray(parseProposerReply("client sets", g)), `parseProposerReply(reply, ${String(g)})`);
  }
  assert.deepEqual(parseProposerReply("", ""), []);
  assert.deepEqual(parseProposerReply("   \n\n  ", PROSE), []);
});

// =====================================================================
// The seam: a reply, through the fold, into a classified proposal.
// =====================================================================

// End to end over the three modules, on the user's own example: a name said out
// loud, spelled another way in the repo, absent from the injected surface.
test("seam: a spoken span becomes a class-4 proposal with the repo's spelling", () => {
  const prose = "Flush the shard mem cache before the client sets expire.";
  const spans = parseProposerReply("shard mem cache\nclient sets", prose);
  assert.equal(spans.length, 2);

  const symbols = ["ShardMemCache", "ClientSet", "Widget"];
  const candidates = [];
  for (const span of spans) {
    const hit = matchByFold(span.phrase, symbols);
    assert.ok(hit !== undefined, `${span.phrase} must reach a symbol`);
    candidates.push({ identifier: hit.identifier, phrase: span.phrase, start: span.start, end: span.end, match: hit.match });
  }
  assert.deepEqual(candidates.map((c) => [c.identifier, c.match]), [
    ["ShardMemCache", "fold"],
    ["ClientSet", "plural"],
  ]);

  // `ClientSet` is already a rendered root, so it is an eviction and is
  // dropped. `ShardMemCache` is off the walk entirely: that is the proposal.
  const out = deltaProposals(candidates, ledger({ rendered: ["ClientSet"], typeCap: 4, admitted: 4 }), "rust");
  assert.equal(out.length, 1);
  assert.equal(out[0].identifier, "ShardMemCache");
  assert.equal(out[0].klass, 4);
  assert.equal(out[0].displaces, "ClientSet");
  assert.equal(out[0].autoApply, true, "a fold match is the one case the diff may apply without asking");
  assert.equal(prose.slice(out[0].start, out[0].end), out[0].phrase);
});
