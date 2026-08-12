// BLIND ORACLE - session-v52 phase 2: THE PROPOSER PROPOSES THE DELTA.
//
// Bound to `session-v52/contract-p2.md` and to nothing else. Nothing in this
// file has read `src/**`; esbuild resolves the three modules at bundle time and
// that is the only contact with the implementation. Every row names the
// contract sentence it holds the product to.
//
// THE ORACLES ARE COMPUTED HERE. The fold, the eight spellings, and the whole
// four-class table are each recomputed in this file out of the contract's own
// words. No function from a module under test is used to grade another - the
// one exception is `foldName`, which is used to normalise `spokenWords` output
// where the contract does not state the CASE of the words it returns, and that
// row asserts the fold, never the spelling.
//
// THE PROPERTY TEST CONTROLS ITS OWN SURFACE. Ship condition 2 is checked over
// 400 generated ledger/candidate pairs from a fixed-seed PRNG. The generator
// RECORDS which names it placed in the surface as whole words rather than
// re-deriving them with a regex, so the row cannot disagree with the product
// over what a word boundary is - only over the classification rule itself.
//
// Expected RED until phase 2 lands.
//
// Run: SKIP_LIVE=1 npx node --test test/blind-v52-p2-proposer.test.cjs

const test = require("node:test");
const assert = require("node:assert/strict");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "blind-v52-p2",
  [
    `export { foldName, spokenWords, identifierVariants, stripPlural, matchByFold } from "../src/core/spokenName";`,
    `export { classifyCandidate, deltaProposals } from "../src/core/tightenClassify";`,
    `export { assembleProposerPrompt, parseProposerReply, PROPOSER_SPAN_CAP } from "../src/core/tightenProposer";`,
    ``,
  ].join("\n")
);
const {
  foldName,
  spokenWords,
  identifierVariants,
  stripPlural,
  matchByFold,
  classifyCandidate,
  deltaProposals,
  assembleProposerPrompt,
  parseProposerReply,
  PROPOSER_SPAN_CAP,
} = mod;
test.after(cleanup);

// ---------------------------------------------------------------------------
// Independent oracles.
// ---------------------------------------------------------------------------

// Contract "The fold": "Lowercase, drop everything that is not a letter or a
// digit." Written out here for ASCII, which is all any row below feeds it.
const asciiFold = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");

// Contract "identifierVariants": the eight spellings, in the order the doc
// comment lists them, derived from the words rather than copied per case.
const capWord = (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
function eightSpellings(words) {
  const l = words.map((w) => w.toLowerCase());
  return [
    l.map(capWord).join(""), //            ShardMemCache
    l[0] + l.slice(1).map(capWord).join(""), // shardMemCache
    l.join("_"), //                        shard_mem_cache
    l.join("_").toUpperCase(), //          SHARD_MEM_CACHE
    l.join(""), //                         shardmemcache
    capWord(l.join("")), //                Shardmemcache
    l.map(capWord).join("_"), //           Shard_Mem_Cache
    l.join("-"), //                        shard-mem-cache
  ];
}
// "plus the awkward inner-token split for three words or more": ShardMemcache.
const innerTokenSplit = (words) =>
  capWord(words[0]) + capWord(words.slice(1).join("").toLowerCase());

// Contract "Classification, in order, first hit wins". `wholeWords` is the set
// of names the caller says the surface carries as a whole word; the generator
// hands it in rather than the oracle guessing at boundary rules.
function expectedClass(identifier, ledger, wholeWords) {
  if (ledger.rendered.includes(identifier)) return 1;
  if (ledger.visited.includes(identifier)) return 2;
  if (wholeWords.has(identifier)) return 2;
  if (ledger.notLookedAt.includes(identifier)) return 3;
  if (ledger.dropped.some((d) => d.name === identifier)) return 3;
  if (ledger.noBlock.some((n) => n.type === identifier)) return 3;
  return 4;
}

// Contract "deltaProposals": classes 1 and 2 dropped, class 4 ahead of class 3,
// source order within a class, `displaces` on any survivor when the cap is full.
function expectedProposals(candidates, ledger, wholeWords) {
  const out = [];
  const full = ledger.admitted >= ledger.typeCap;
  const last = ledger.rendered.length
    ? ledger.rendered[ledger.rendered.length - 1]
    : undefined;
  for (const klass of [4, 3]) {
    for (const c of candidates) {
      if (expectedClass(c.identifier, ledger, wholeWords) !== klass) continue;
      out.push({
        identifier: c.identifier,
        phrase: c.phrase,
        start: c.start,
        end: c.end,
        match: c.match,
        klass,
        displaces: full ? last : null,
      });
    }
  }
  return out;
}

// Normalises a product Proposal for comparison. `displaces` absent and
// `displaces: undefined` are the same fact and both read as null here.
const shape = (p) => ({
  identifier: p.identifier,
  phrase: p.phrase,
  start: p.start,
  end: p.end,
  match: p.match,
  klass: p.klass,
  displaces: p.displaces === undefined ? null : p.displaces,
});

// Contract "parseProposerReply": "Every parsed span is a verbatim substring of
// the prose, at the offsets reported." Ship condition 4, checked on every row
// that parses anything.
function assertVerbatim(spans, prose, what) {
  assert.ok(Array.isArray(spans), `${what}: expected an array of spans`);
  for (const s of spans) {
    assert.equal(typeof s.phrase, "string", `${what}: phrase is a string`);
    assert.ok(
      Number.isInteger(s.start) && Number.isInteger(s.end),
      `${what}: offsets are integers, got ${s.start}..${s.end}`
    );
    assert.ok(
      s.start >= 0 && s.end <= prose.length && s.start < s.end,
      `${what}: span ${s.start}..${s.end} is inside 0..${prose.length}`
    );
    assert.equal(
      prose.slice(s.start, s.end),
      s.phrase,
      `${what}: the proposer cannot write - prose.slice(${s.start}, ${s.end}) must be ${JSON.stringify(s.phrase)}`
    );
  }
}

// ---------------------------------------------------------------------------
// Fixtures.
// ---------------------------------------------------------------------------

function ledgerOf(o = {}) {
  return {
    rendered: o.rendered ?? [],
    visited: o.visited ?? [],
    noBlock: o.noBlock ?? [],
    notLookedAt: o.notLookedAt ?? [],
    dropped: o.dropped ?? [],
    typeCap: o.typeCap ?? 4,
    admitted: o.admitted ?? 0,
    surface: o.surface ?? "",
  };
}

let nextStart = 0;
function cand(identifier, match = "fold") {
  const start = nextStart;
  nextStart += identifier.length + 1;
  return { identifier, phrase: identifier, start, end: start + identifier.length, match };
}

// The scout's table, quoted from the contract's `foldName` doc comment.
const SHARD_SPELLINGS = [
  "shard mem cache",
  "Shard Mem Cache",
  "ShardMemCache",
  "ShardMemcache",
  "shard_mem_cache",
  "SHARD_MEM_CACHE",
];

// The nine spellings the contract's `identifierVariants` doc comment lists.
const SHARD_VARIANTS = [
  "ShardMemCache",
  "shardMemCache",
  "shard_mem_cache",
  "SHARD_MEM_CACHE",
  "shardmemcache",
  "Shardmemcache",
  "Shard_Mem_Cache",
  "shard-mem-cache",
  "ShardMemcache",
];

const PROSE =
  "The shard mem cache hands each wire size record to the retry policy before the writer ever sees it.";

const BIG = "Lorem ipsum dolor sit amet ".repeat(4000); // ~108KB

// mulberry32, so a property failure reproduces from the printed seed.
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ===========================================================================
// 1. THE FOLD. Contract "The fold, and it does two jobs".
// ===========================================================================

test("every spelling in the scout's table folds to one key [contract: foldName doc]", () => {
  for (const s of SHARD_SPELLINGS) {
    assert.equal(
      foldName(s),
      "shardmemcache",
      `foldName(${JSON.stringify(s)}) must be "shardmemcache"`
    );
  }
});

test("wire_size, wireSize and 'wire size' fold together [contract: foldName doc]", () => {
  for (const s of ["wire_size", "wireSize", "wire size", "WireSize", "WIRE_SIZE", "Wire-Size"]) {
    assert.equal(foldName(s), "wiresize", `foldName(${JSON.stringify(s)})`);
  }
});

test("digits survive the fold; punctuation does not [contract: 'not a letter or a digit']", () => {
  assert.equal(foldName("Shard2Cache"), "shard2cache", "an interior digit is kept");
  assert.equal(foldName("v2"), "v2", "a trailing digit is kept");
  assert.equal(foldName("SHA256_Hasher"), "sha256hasher", "digits and underscores together");
  assert.equal(foldName("a.b-c_d e/f(g)"), "abcdefg", "every punctuation mark is dropped");
  assert.equal(foldName("!!!"), "", "punctuation only folds to the empty string");
});

test("foldName agrees with the contract's own words on arbitrary ascii [contract: foldName doc]", () => {
  const rnd = mulberry32(0x51520201);
  const alphabet = "abzAZ09_-. /()<>:,'\"\t\n[]{}*&%$#@!+=|\\?~^;";
  for (let i = 0; i < 300; i++) {
    let s = "";
    const n = Math.floor(rnd() * 24);
    for (let j = 0; j < n; j++) s += alphabet[Math.floor(rnd() * alphabet.length)];
    assert.equal(foldName(s), asciiFold(s), `foldName(${JSON.stringify(s)})`);
  }
});

test("foldName does not crash on unicode, and stays deterministic [robustness]", () => {
  for (const s of ["café", "naïve_Größe", "日本語Type", "🙂cache🙂", " �"]) {
    let a, b;
    assert.doesNotThrow(() => {
      a = foldName(s);
      b = foldName(s);
    }, `foldName(${JSON.stringify(s)}) must not throw`);
    assert.equal(typeof a, "string", "foldName returns a string");
    assert.equal(a, b, "foldName is deterministic");
  }
});

// ===========================================================================
// 2. spokenWords. Contract "A spoken span into the words a person said".
// ===========================================================================

test("whitespace, underscores and humps each split a phrase into its words [contract: spokenWords doc]", () => {
  for (const s of ["shard mem cache", "Shard Mem Cache", "shard_mem_cache", "ShardMemCache"]) {
    const w = spokenWords(s);
    assert.equal(w.length, 3, `spokenWords(${JSON.stringify(s)}) gives three words, got ${JSON.stringify(w)}`);
    // The contract does not state the CASE of the returned words, so this row
    // asserts the fold of each word and never its spelling.
    assert.deepEqual(
      w.map(foldName),
      ["shard", "mem", "cache"],
      `spokenWords(${JSON.stringify(s)}) folds to shard/mem/cache`
    );
  }
});

test("SHARD_MEM_CACHE folds to the same three words [contract: spokenWords doc]", () => {
  assert.deepEqual(spokenWords("SHARD_MEM_CACHE").map(foldName), ["shard", "mem", "cache"]);
});

test("splitting a phrase never loses a letter: the words rejoin to the phrase's fold [contract: 'folds the same way']", () => {
  const phrases = [
    "shard mem cache",
    "ShardMemCache",
    "the wire size field",
    "a `retry policy`, roughly.",
    "snake_case and camelCase",
    "SHA256_Hasher v2",
    "   leading and trailing   ",
    "one",
    "",
  ];
  for (const p of phrases) {
    assert.equal(
      spokenWords(p).map(foldName).join(""),
      foldName(p),
      `spokenWords(${JSON.stringify(p)}) must not drop or add letters`
    );
  }
});

// ===========================================================================
// 3. identifierVariants. Contract "The spellings a repo might use".
// ===========================================================================

test("three words give exactly the nine spellings the contract lists [contract: identifierVariants doc]", () => {
  const got = identifierVariants(["shard", "mem", "cache"]);
  assert.deepEqual(
    new Set(got),
    new Set(SHARD_VARIANTS),
    `identifierVariants(shard/mem/cache) must be the contract's nine, got ${JSON.stringify(got)}`
  );
  // The oracle above is the contract's literal list; this cross-checks that the
  // list really is the eight patterns plus the inner-token split.
  assert.deepEqual(
    new Set(SHARD_VARIANTS),
    new Set([...eightSpellings(["shard", "mem", "cache"]), innerTokenSplit(["shard", "mem", "cache"])]),
    "the contract's nine are the eight patterns plus the inner-token split"
  );
});

test("two words give the eight patterns and no inner-token split [contract: 'for three words or more']", () => {
  const got = identifierVariants(["wire", "size"]);
  assert.deepEqual(
    new Set(got),
    new Set(eightSpellings(["wire", "size"])),
    `identifierVariants(wire/size), got ${JSON.stringify(got)}`
  );
});

test("a single word gives its three distinct spellings [contract: identifierVariants doc]", () => {
  const got = identifierVariants(["shard"]);
  assert.deepEqual(
    new Set(got),
    new Set(["Shard", "shard", "SHARD"]),
    `identifierVariants(["shard"]), got ${JSON.stringify(got)}`
  );
});

test("variants are deterministic, bounded and free of duplicates [contract: 'deterministic and bounded']", () => {
  const inputs = [
    ["shard", "mem", "cache"],
    ["wire", "size"],
    ["shard"],
    ["a", "b", "c", "d", "e"],
    ["Retry", "POLICY", "handler"],
  ];
  for (const words of inputs) {
    const a = identifierVariants(words);
    const b = identifierVariants(words);
    assert.deepEqual(a, b, `identifierVariants(${JSON.stringify(words)}) is deterministic`);
    assert.ok(a.length <= 9, `bounded at nine, got ${a.length} for ${JSON.stringify(words)}`);
    assert.equal(
      new Set(a).size,
      a.length,
      `no duplicate spellings for ${JSON.stringify(words)}, got ${JSON.stringify(a)}`
    );
    // Every spelling of a name is the same name.
    for (const v of a) {
      assert.equal(
        foldName(v),
        words.map((w) => w.toLowerCase()).join(""),
        `${JSON.stringify(v)} must fold to the same key as its words`
      );
    }
  }
});

test("an empty word list is answered, not thrown at [contract: 'deterministic and bounded']", () => {
  let got;
  assert.doesNotThrow(() => {
    got = identifierVariants([]);
  }, "identifierVariants([]) must not throw");
  assert.ok(Array.isArray(got), "identifierVariants([]) returns an array");
  for (const v of got) assert.equal(typeof v, "string", "every variant is a string");
});

// ===========================================================================
// 4. stripPlural. Contract "One deterministic retry with a trailing plural".
// ===========================================================================

test("'client sets' becomes 'client set' [contract: stripPlural doc]", () => {
  assert.deepEqual(stripPlural(["client", "sets"]), ["client", "set"]);
});

test("a trailing es is stripped whole [contract: 'Trailing `s` and `es` only']", () => {
  // An `es` rule that yielded to the `s` rule would never fire, since every word
  // ending in `es` also ends in `s`. So `es` is the longer strip and it wins.
  assert.deepEqual(stripPlural(["batch", "boxes"]), ["batch", "box"]);
  assert.deepEqual(stripPlural(["index", "caches"]), ["index", "cach"]);
});

test("only the LAST word is stripped [contract: 'on the LAST word only']", () => {
  assert.equal(
    stripPlural(["clients", "set"]),
    undefined,
    "a plural on a non-final word is not a plural"
  );
  assert.deepEqual(
    stripPlural(["clients", "sets"]),
    ["clients", "set"],
    "the first word keeps its s"
  );
});

test("the strip happens once, never twice [contract: 'and only once']", () => {
  // "passes" -> "pass" by the es rule; a second pass would give "pas".
  assert.deepEqual(stripPlural(["retry", "passes"]), ["retry", "pass"]);
  // "ss" -> "s" by the s rule; a second pass would give "".
  assert.deepEqual(stripPlural(["a", "ss"]), ["a", "s"]);
});

test("no trailing plural is undefined, not a copy [contract: 'Undefined when the last word carries neither']", () => {
  for (const w of [["wire", "size"], ["shard", "mem", "cache"], ["retry"], ["a", "box"]]) {
    assert.equal(
      stripPlural(w),
      undefined,
      `stripPlural(${JSON.stringify(w)}) must be undefined`
    );
  }
});

test("stripPlural never throws and never mutates its input [robustness]", () => {
  const words = ["client", "sets"];
  const copy = words.slice();
  stripPlural(words);
  assert.deepEqual(words, copy, "the caller's array is untouched");
  for (const bad of [[], null, undefined]) {
    assert.doesNotThrow(() => stripPlural(bad), `stripPlural(${JSON.stringify(bad)})`);
  }
});

// ===========================================================================
// 5. matchByFold. Contract "Which of `identifiers` the phrase names".
// ===========================================================================

test("a fold hit reports match 'fold' [contract: 'Fold equality first']", () => {
  for (const s of SHARD_SPELLINGS) {
    assert.deepEqual(
      matchByFold(s, ["Widget", "ShardMemCache", "RetryPolicy"]),
      { identifier: "ShardMemCache", match: "fold" },
      `matchByFold(${JSON.stringify(s)}, ...)`
    );
  }
});

test("a plural retry reports match 'plural' [contract: 'then the one plural retry']", () => {
  assert.deepEqual(matchByFold("client sets", ["ClientSet", "Widget"]), {
    identifier: "ClientSet",
    match: "plural",
  });
  assert.deepEqual(matchByFold("boxes", ["Box"]), { identifier: "Box", match: "plural" });
});

test("the fold beats the plural retry when both would answer [contract: 'Fold equality first, then']", () => {
  assert.deepEqual(matchByFold("client sets", ["ClientSet", "ClientSets"]), {
    identifier: "ClientSets",
    match: "fold",
  });
});

test("two different identifiers with one fold key is a refusal, never a pick [contract: 'This product refuses rather than picks']", () => {
  assert.equal(
    matchByFold("shard mem cache", ["ShardMemCache", "shard_mem_cache"]),
    undefined,
    "an ambiguous fold must return undefined"
  );
  assert.equal(
    matchByFold("wire size", ["WireSize", "WIRE_SIZE", "Unrelated"]),
    undefined,
    "three-way ambiguity is still a refusal"
  );
  // "two DIFFERENT identifiers" - the same identifier listed twice is one answer.
  assert.deepEqual(matchByFold("wire size", ["WireSize", "WireSize"]), {
    identifier: "WireSize",
    match: "fold",
  });
});

test("no hit at all is undefined [contract: 'Undefined when neither answers']", () => {
  assert.equal(matchByFold("shard mem cache", ["Widget", "RetryPolicy"]), undefined);
  assert.equal(matchByFold("shard mem cache", []), undefined);
  assert.equal(matchByFold("", ["Widget"]), undefined, "an empty phrase names nothing");
});

// ===========================================================================
// 6. classifyCandidate. Contract "Classification, in order, first hit wins".
// ===========================================================================

test("a name in `rendered` is class 1 [contract: classification 1]", () => {
  assert.equal(classifyCandidate("ShardMemCache", ledgerOf({ rendered: ["ShardMemCache"] })), 1);
});

test("a name in `visited` is class 2 [contract: classification 2]", () => {
  assert.equal(classifyCandidate("ShardMemCache", ledgerOf({ visited: ["ShardMemCache"] })), 2);
});

test("a name the surface carries as a whole word is class 2 [contract: classification 2]", () => {
  const l = ledgerOf({ surface: "pub struct Widget { cache: ShardMemCache }\n" });
  assert.equal(classifyCandidate("ShardMemCache", l), 2);
});

test("a name that is only a SUBSTRING of a longer identifier is not a class 2 hit [contract: 'as a whole word']", () => {
  const l = ledgerOf({ surface: "pub struct ShardMemCacheBuilder;\nfn make() -> XShardMemCache {}\n" });
  assert.equal(
    classifyCandidate("ShardMemCache", l),
    4,
    "a substring hit must not evict a real root"
  );
});

test("notLookedAt, dropped and noBlock are each class 3 [contract: classification 3]", () => {
  assert.equal(classifyCandidate("A", ledgerOf({ notLookedAt: ["A"] })), 3, "notLookedAt");
  assert.equal(classifyCandidate("A", ledgerOf({ dropped: [{ name: "A", cause: "depth" }] })), 3, "dropped");
  assert.equal(classifyCandidate("A", ledgerOf({ noBlock: [{ type: "A", reason: "no hover" }] })), 3, "noBlock");
});

test("a name in none of the lists is class 4 [contract: classification 4]", () => {
  assert.equal(classifyCandidate("A", ledgerOf({ rendered: ["B"], visited: ["C"], surface: "B C" })), 4);
});

test("first hit wins: rendered outranks visited outranks the class 3 lists [contract: 'in order, first hit wins']", () => {
  const all = {
    rendered: ["A"],
    visited: ["A"],
    notLookedAt: ["A"],
    dropped: [{ name: "A", cause: "budget" }],
    noBlock: [{ type: "A", reason: "none" }],
    surface: "A",
  };
  assert.equal(classifyCandidate("A", ledgerOf(all)), 1, "rendered wins");
  assert.equal(classifyCandidate("A", ledgerOf({ ...all, rendered: [] })), 2, "then visited");
  assert.equal(
    classifyCandidate("A", ledgerOf({ ...all, rendered: [], visited: [] })),
    2,
    "then the surface whole word"
  );
  assert.equal(
    classifyCandidate("A", ledgerOf({ ...all, rendered: [], visited: [], surface: "" })),
    3,
    "then the class 3 lists"
  );
});

// ===========================================================================
// 7. deltaProposals. Ship condition 1, and the ranking.
// ===========================================================================

test("zero class 1 and zero class 2 proposals reach a caller [ship condition 1]", () => {
  nextStart = 0;
  const l = ledgerOf({
    rendered: ["Rendered1"],
    visited: ["Visited1"],
    notLookedAt: ["NotLooked1"],
    dropped: [{ name: "Dropped1", cause: "depth" }],
    noBlock: [{ type: "NoBlock1", reason: "hover empty" }],
    surface: "fn f(x: SurfaceWord) -> SubstringOnlyTail { }",
    typeCap: 4,
    admitted: 0,
  });
  const candidates = [
    cand("Rendered1"),
    cand("Visited1"),
    cand("SurfaceWord"),
    cand("SubstringOnly"), // only inside SubstringOnlyTail: not a whole word
    cand("NotLooked1"),
    cand("Dropped1"),
    cand("NoBlock1"),
    cand("Nowhere1"),
  ];
  const got = deltaProposals(candidates, l);
  const names = got.map((p) => p.identifier);
  assert.ok(!names.includes("Rendered1"), "a class 1 proposal must never reach a caller");
  assert.ok(!names.includes("Visited1"), "a class 2 (visited) proposal must never reach a caller");
  assert.ok(!names.includes("SurfaceWord"), "a class 2 (surface whole word) proposal must never reach a caller");
  for (const p of got) {
    assert.ok(p.klass === 3 || p.klass === 4, `only classes 3 and 4 survive, saw ${p.klass}`);
  }
  assert.deepEqual(
    names,
    ["SubstringOnly", "Nowhere1", "NotLooked1", "Dropped1", "NoBlock1"],
    "class 4 first in source order, then class 3 in source order"
  );
});

test("class 4 ranks ahead of class 3, and source order holds inside a class [contract: deltaProposals doc]", () => {
  nextStart = 0;
  const l = ledgerOf({ notLookedAt: ["Three1", "Three2", "Three3"] });
  const candidates = [
    cand("Three1"),
    cand("Four1"),
    cand("Three2"),
    cand("Four2"),
    cand("Three3"),
    cand("Four3"),
  ];
  assert.deepEqual(
    deltaProposals(candidates, l).map((p) => p.identifier),
    ["Four1", "Four2", "Four3", "Three1", "Three2", "Three3"]
  );
});

test("a proposal carries its candidate through verbatim [contract: 'Proposal extends Candidate']", () => {
  const c = { identifier: "ShardMemCache", phrase: "shard mem cache", start: 4, end: 19, match: "plural" };
  const got = deltaProposals([c], ledgerOf({}));
  assert.equal(got.length, 1, "an off-walk name survives");
  assert.equal(got[0].identifier, "ShardMemCache");
  assert.equal(got[0].phrase, "shard mem cache");
  assert.equal(got[0].start, 4);
  assert.equal(got[0].end, 19);
  assert.equal(got[0].match, "plural");
  assert.equal(got[0].klass, 4);
});

test("an empty candidate list gives an empty proposal list [contract: deltaProposals doc]", () => {
  assert.deepEqual(deltaProposals([], ledgerOf({})), []);
});

// ---------------------------------------------------------------------------
// `displaces`. Contract "It is a property of the cap being full, not of the class."
// ---------------------------------------------------------------------------

test("displaces is set at admitted === typeCap and names the LAST rendered entry [contract: 'displaces is set']", () => {
  nextStart = 0;
  const l = ledgerOf({
    rendered: ["FirstRoot", "MiddleRoot", "LastRoot"],
    notLookedAt: ["Three1"],
    typeCap: 4,
    admitted: 4,
  });
  const got = deltaProposals([cand("Four1"), cand("Three1")], l);
  assert.equal(got.length, 2, "both survive; the cap changes the diff, not the survival");
  for (const p of got) {
    assert.equal(
      p.displaces,
      "LastRoot",
      `the lowest-ranked injected root is the last entry of rendered (${p.identifier}, class ${p.klass})`
    );
  }
});

test("displaces is absent at admitted === typeCap - 1 [contract: 'Absent means the cap has a free slot']", () => {
  nextStart = 0;
  const l = ledgerOf({
    rendered: ["FirstRoot", "LastRoot"],
    notLookedAt: ["Three1"],
    typeCap: 4,
    admitted: 3,
  });
  const got = deltaProposals([cand("Four1"), cand("Three1")], l);
  assert.equal(got.length, 2);
  for (const p of got) {
    assert.equal(p.displaces, undefined, `a free slot is a pure addition (${p.identifier})`);
  }
});

test("displaces is set when admitted overruns the cap [contract: 'admitted >= typeCap']", () => {
  nextStart = 0;
  const l = ledgerOf({ rendered: ["A", "B"], typeCap: 2, admitted: 7 });
  const got = deltaProposals([cand("Four1")], l);
  assert.equal(got[0].displaces, "B");
});

// ---------------------------------------------------------------------------
// Ship condition 2, as a property.
// ---------------------------------------------------------------------------

test("PROPERTY: survivors are always disjoint from rendered and visited [ship condition 2]", () => {
  const POOL = [];
  for (let i = 0; i < 12; i++) POOL.push(`Kappa${String(i).padStart(2, "0")}`);
  const OFF_POOL = ["Zeta90", "Zeta91"]; // never in any ledger list

  const SEED = 0x5252c0de;
  const rnd = mulberry32(SEED);
  const pick = (arr, p) => arr.filter(() => rnd() < p);

  for (let iter = 0; iter < 400; iter++) {
    const rendered = pick(POOL, 0.25);
    // The contract does not say what `displaces` names when `rendered` is empty
    // and the cap is full, so the generator never produces that state.
    if (rendered.length === 0) rendered.push("Kappa00");
    const visited = pick(POOL, 0.25);
    const notLookedAt = pick(POOL, 0.2);
    const dropped = pick(POOL, 0.2).map((n) => ({ name: n, cause: "depth" }));
    const noBlock = pick(POOL, 0.2).map((t) => ({ type: t, reason: "no hover" }));

    // The surface is built out of tokens the generator RECORDS, so this row
    // never has to guess the product's word-boundary rule.
    const wholeWords = new Set();
    const tokens = ["fn", "f", "(", ")", "->"];
    for (const n of POOL) {
      const r = rnd();
      if (r < 0.25) {
        tokens.push(n);
        wholeWords.add(n);
      } else if (r < 0.5) {
        tokens.push(`Q${n}Q`); // a substring, never a whole word
      }
    }
    const surface = tokens.join(" ");

    const typeCap = 1 + Math.floor(rnd() * 6);
    const admitted = Math.floor(rnd() * 9);
    const l = { rendered, visited, noBlock, notLookedAt, dropped, typeCap, admitted, surface };

    const candidates = [];
    let at = 0;
    for (const n of [...POOL, ...OFF_POOL]) {
      if (rnd() < 0.55) continue;
      candidates.push({
        identifier: n,
        phrase: n.toLowerCase(),
        start: at,
        end: at + n.length,
        match: rnd() < 0.5 ? "fold" : "guess",
      });
      at += n.length + 1;
    }

    let got;
    const where = `seed ${SEED} iter ${iter} ledger ${JSON.stringify(l)} candidates ${JSON.stringify(candidates.map((c) => c.identifier))}`;
    assert.doesNotThrow(() => {
      got = deltaProposals(candidates, l);
    }, `deltaProposals must not throw: ${where}`);

    // Ship condition 2, stated directly.
    for (const p of got) {
      assert.ok(
        !rendered.includes(p.identifier),
        `a survivor may never be in rendered: ${p.identifier} @ ${where}`
      );
      assert.ok(
        !visited.includes(p.identifier),
        `a survivor may never be in visited: ${p.identifier} @ ${where}`
      );
      assert.ok(
        !wholeWords.has(p.identifier),
        `a survivor may never already be a whole word in the surface: ${p.identifier} @ ${where}`
      );
    }

    // And the full table, class and displaces and order together.
    assert.deepEqual(
      got.map(shape),
      expectedProposals(candidates, l, wholeWords),
      `classification/order/displaces disagree @ ${where}`
    );

    // classifyCandidate must agree with the list it feeds.
    for (const c of candidates) {
      assert.equal(
        classifyCandidate(c.identifier, l),
        expectedClass(c.identifier, l, wholeWords),
        `classifyCandidate(${c.identifier}) @ ${where}`
      );
    }
  }
});

// ===========================================================================
// 8. assembleProposerPrompt. Contract "The prompt must say, in the product's
//    own voice".
// ===========================================================================

test("the prompt carries the prose verbatim and names the language [contract: ProposerInput]", () => {
  for (const languageId of ["rust", "go", "python", "typescript"]) {
    const p = assembleProposerPrompt({ prose: PROSE, languageId });
    assert.equal(typeof p, "string", "the prompt is a string");
    assert.ok(p.length > 0, "the prompt is not empty");
    assert.ok(p.includes(PROSE), `the prompt must carry the prose verbatim (${languageId})`);
    assert.match(
      p,
      new RegExp(languageId, "i"),
      `the prompt must name the language (${languageId})`
    );
  }
});

test("a different languageId gives a different prompt [contract: ProposerInput.languageId]", () => {
  const a = assembleProposerPrompt({ prose: PROSE, languageId: "rust" });
  const b = assembleProposerPrompt({ prose: PROSE, languageId: "python" });
  assert.notEqual(a, b, "the language must reach the prompt, not sit unused in the input");
});

test("the prompt instructs verbatim copying, one per line, no explanation [contract: 'copy them verbatim from the prose, one per line, nothing else']", () => {
  const p = assembleProposerPrompt({ prose: PROSE, languageId: "rust" });
  assert.match(p, /verbatim/i, "the prompt must say verbatim");
  assert.match(p, /per line/i, "the prompt must say one per line");
  assert.match(p, /explanation|explain/i, "the prompt must forbid explanation");
  assert.match(p, /type name/i, "the prompt must say it wants type names");
});

test("assembleProposerPrompt is deterministic [contract: pure, 'no vscode, no network, no clock']", () => {
  const i = { prose: PROSE, languageId: "rust" };
  assert.equal(assembleProposerPrompt(i), assembleProposerPrompt(i));
});

// ===========================================================================
// 9. parseProposerReply. Ship condition 4: "The proposer cannot write."
// ===========================================================================

test("every parsed span is a verbatim substring at the offsets reported [ship condition 4]", () => {
  const reply = "wire size\nshard mem cache\nretry policy\nwriter";
  const got = parseProposerReply(reply, PROSE);
  assertVerbatim(got, PROSE, "the four real phrases");
  assert.deepEqual(
    got.map((s) => s.phrase),
    ["shard mem cache", "retry policy", "wire size", "writer"],
    "longest span first"
  );
});

test("a reply of invented sentences yields nothing [ship condition 4]", () => {
  const reply = [
    "The type names in this comment are ShardMemCache and WireSize.",
    "quantum flux capacitor",
    "I could not find any type names.",
    "shard-mem-cache",
  ].join("\n");
  assert.deepEqual(parseProposerReply(reply, PROSE), [], "not one invented line may become a span");
});

test("a line that rewrites what the developer said is dropped [contract: 'a reply that rewrites ... is a reply that failed']", () => {
  // Same words, different spelling: not an exact substring, so it is not a span.
  const reply = "Shard Mem Cache\nWire Size\nwire  size\nwire size";
  const got = parseProposerReply(reply, PROSE);
  assertVerbatim(got, PROSE, "the one exact line");
  assert.deepEqual(got.map((s) => s.phrase), ["wire size"]);
});

test("a reply wrapped in a code fence still parses its real lines [contract: 'no code fence']", () => {
  const reply = "```\nshard mem cache\nwire size\n```";
  const got = parseProposerReply(reply, PROSE);
  assertVerbatim(got, PROSE, "fenced reply");
  assert.deepEqual(got.map((s) => s.phrase), ["shard mem cache", "wire size"]);
});

test("explanation prose around the answer is dropped, the answer is kept [contract: 'No explanation']", () => {
  const reply = [
    "Sure! Here are the type names I found:",
    "retry policy",
    "",
    "Let me know if you want more.",
  ].join("\n");
  const got = parseProposerReply(reply, PROSE);
  assertVerbatim(got, PROSE, "chatty reply");
  assert.deepEqual(got.map((s) => s.phrase), ["retry policy"]);
});

test("an empty reply and garbage bytes both give an empty list [contract: 'garbage returns an empty list']", () => {
  for (const reply of ["", "\n\n\n", " �", "😀😀", "   "]) {
    assert.deepEqual(
      parseProposerReply(reply, PROSE),
      [],
      `garbage reply ${JSON.stringify(reply)} must give []`
    );
  }
});

test("overlapping spans: the longest wins and the shorter is dropped [contract: 'Overlapping spans']", () => {
  const reply = "shard\nmem cache\nshard mem cache\ncache";
  const got = parseProposerReply(reply, PROSE);
  assertVerbatim(got, PROSE, "overlapping reply");
  assert.deepEqual(
    got.map((s) => s.phrase),
    ["shard mem cache"],
    "the three shorter spans all sit inside the longest"
  );
});

test("a non-overlapping shorter span survives beside a longer one [contract: 'Longest span first']", () => {
  const reply = "writer\nshard mem cache";
  const got = parseProposerReply(reply, PROSE);
  assertVerbatim(got, PROSE, "disjoint reply");
  assert.deepEqual(got.map((s) => s.phrase), ["shard mem cache", "writer"]);
});

test("PROPOSER_SPAN_CAP is a positive integer and bounds the list [contract: 'Capped at PROPOSER_SPAN_CAP']", () => {
  assert.equal(typeof PROPOSER_SPAN_CAP, "number", "the cap is exported as a number");
  assert.ok(
    Number.isInteger(PROPOSER_SPAN_CAP) && PROPOSER_SPAN_CAP > 0,
    `the cap is a positive integer, got ${PROPOSER_SPAN_CAP}`
  );

  const width = String(PROPOSER_SPAN_CAP + 5).length;
  const words = [];
  for (let i = 0; i < PROPOSER_SPAN_CAP + 5; i++) words.push(`zeta${String(i).padStart(width, "0")}`);
  const prose = words.join(" ");
  const got = parseProposerReply(words.join("\n"), prose);
  assertVerbatim(got, prose, "over-cap reply");
  assert.equal(
    got.length,
    PROPOSER_SPAN_CAP,
    `${PROPOSER_SPAN_CAP + 5} valid disjoint spans must be cut to PROPOSER_SPAN_CAP`
  );
  assert.equal(new Set(got.map((s) => s.start)).size, got.length, "no span is reported twice");
});

test("parseProposerReply is deterministic [contract: pure]", () => {
  const reply = "wire size\nretry policy\nnot in the prose at all";
  assert.deepEqual(parseProposerReply(reply, PROSE), parseProposerReply(reply, PROSE));
});

// ===========================================================================
// 10. Robustness. Contract states "Never throws" for `parseProposerReply`; the
//     rest of this sweep is a robustness expectation, not a contract clause.
// ===========================================================================

test("parseProposerReply never throws, on anything [contract: 'Never throws']", () => {
  const inputs = [null, undefined, "", "   ", BIG, "a\nb\nc", " "];
  for (const reply of inputs) {
    for (const prose of inputs) {
      let got;
      assert.doesNotThrow(() => {
        got = parseProposerReply(reply, prose);
      }, `parseProposerReply(${typeof reply}:${String(reply).slice(0, 12)}, ${typeof prose})`);
      assert.ok(Array.isArray(got), "always an array");
      if (typeof prose === "string") assertVerbatim(got, prose, "robustness sweep");
    }
  }
});

test("the pure string helpers never throw on null, undefined, empty or 100KB [robustness]", () => {
  const inputs = [null, undefined, "", "   ", BIG];
  for (const s of inputs) {
    assert.doesNotThrow(() => foldName(s), `foldName(${typeof s})`);
    assert.doesNotThrow(() => spokenWords(s), `spokenWords(${typeof s})`);
    assert.doesNotThrow(() => matchByFold(s, ["Widget"]), `matchByFold(${typeof s})`);
    assert.doesNotThrow(() => matchByFold("widget", s), `matchByFold(_, ${typeof s})`);
    assert.doesNotThrow(() => identifierVariants(s), `identifierVariants(${typeof s})`);
    assert.doesNotThrow(() => stripPlural(s), `stripPlural(${typeof s})`);
    assert.doesNotThrow(
      () => assembleProposerPrompt({ prose: typeof s === "string" ? s : "", languageId: "rust" }),
      `assembleProposerPrompt(${typeof s})`
    );
  }
  assert.doesNotThrow(() => assembleProposerPrompt({ prose: BIG, languageId: "rust" }), "100KB prose");
});

test("the classifier survives an empty ledger and a huge one [robustness]", () => {
  assert.doesNotThrow(() => classifyCandidate("", ledgerOf({})), "an empty identifier");
  assert.equal(deltaProposals([], ledgerOf({})).length, 0);

  const many = [];
  for (let i = 0; i < 5000; i++) many.push(`Big${i}`);
  const l = ledgerOf({
    rendered: many.slice(0, 1000),
    visited: many.slice(1000, 2000),
    notLookedAt: many.slice(2000, 3000),
    surface: many.slice(3000, 4000).join(" "),
    typeCap: 4,
    admitted: 9,
  });
  const cands = many.map((n, i) => ({
    identifier: n,
    phrase: n,
    start: i * 8,
    end: i * 8 + n.length,
    match: "fold",
  }));
  let got;
  assert.doesNotThrow(() => {
    got = deltaProposals(cands, l);
  }, "a 5000-candidate call must not throw");
  for (const p of got) {
    assert.ok(p.klass === 3 || p.klass === 4, "still only classes 3 and 4");
    assert.equal(p.displaces, many[999], "the last rendered entry, at admitted 9 over cap 4");
  }
});
