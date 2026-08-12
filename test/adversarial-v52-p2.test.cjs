// ADVERSARIAL REVIEW - session-v52 phase 2. Evidence, not opinion.
//
// Every row here is a claim I am trying to BREAK, not one I am trying to
// confirm. A row that passes is a defect I looked for and did not find.
//
// Run: SKIP_LIVE=1 node --test test/adversarial-v52-p2.test.cjs

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "adversarial-v52-p2",
  [
    `export { foldName, spokenWords, identifierVariants, stripPlural, matchByFold } from "../src/core/spokenName";`,
    `export { classifyCandidate, deltaProposals } from "../src/core/tightenClassify";`,
    `export { assembleProposerPrompt, parseProposerReply, PROPOSER_SPAN_CAP } from "../src/core/tightenProposer";`,
    ``,
  ].join("\n"),
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

const ledger = (o = {}) => ({
  rendered: [],
  visited: [],
  noBlock: [],
  notLookedAt: [],
  dropped: [],
  typeCap: 4,
  admitted: 0,
  surface: "",
  ...o,
});
const cand = (identifier, i = 0) => ({
  identifier,
  phrase: identifier,
  start: i,
  end: i + identifier.length,
  match: "fold",
});

// ===========================================================================
// A. THE EVICTION GUARANTEE. Ship conditions 1 and 2.
//    "Zero class 1 and zero class 2 proposals reach a caller."
// ===========================================================================

// DEFECT 1. `classifyCandidate` short-circuits to class 4 the moment the
// candidate's fold key is empty, BEFORE it looks at the ledger. Every
// identifier whose characters are all outside [a-z0-9] after lowercasing folds
// to "" - a CJK, Cyrillic or Greek type name, which Python, C#, TypeScript and
// Rust all accept - so a candidate that is LITERALLY the string in `rendered`
// comes back as class 4 and survives `deltaProposals`. That is the exact
// eviction the phase exists to prevent.
test("DEFECT 1: a non-ASCII identifier already in `rendered` survives as class 4", () => {
  const led = ledger({ rendered: ["顧客"], visited: ["顧客"], surface: "class 顧客:\n    pass", admitted: 1 });
  assert.equal(
    classifyCandidate("顧客", led),
    1,
    "the candidate IS the rendered root, spelled identically; class 1 is the only honest answer",
  );
  assert.deepEqual(
    deltaProposals([cand("顧客")], led),
    [],
    "ship condition 1: a class 1 must never reach a caller",
  );
});

test("DEFECT 1b: the same escape on Cyrillic and on an all-underscore name", () => {
  for (const name of ["Клиент", "____"]) {
    const led = ledger({ rendered: [name], visited: [name], surface: `struct ${name} {}`, admitted: 1 });
    assert.equal(classifyCandidate(name, led), 1, `${name} is rendered and must classify 1`);
    assert.deepEqual(deltaProposals([cand(name)], led), [], `${name} must be dropped`);
  }
});

// Ship condition 2 as a PROPERTY, over adversarially-shaped ledgers rather than
// random ones. The generator plants the candidate inside the ledger in a way
// chosen to be hard: a generic parameter, a path, a member signature, a
// case-differing `visited` entry, a fold collision, a substring relationship.
test("SHIP 2 property: survivors are disjoint from rendered and visited, 6 planting shapes x 200 names", () => {
  const rand = mulberry(0x5eed);
  const words = ["shard", "mem", "cache", "client", "set", "wal", "segment", "read", "error", "lod", "band"];
  const failures = [];
  for (let n = 0; n < 200; n++) {
    const w = [];
    for (let i = 0; i < 2 + Math.floor(rand() * 2); i++) w.push(words[Math.floor(rand() * words.length)]);
    const pascal = w.map((x) => x[0].toUpperCase() + x.slice(1)).join("");
    const plants = [
      // 1. only inside a generic parameter
      { surface: `pub struct Holder {\n    items: Vec<${pascal}>,\n}`, why: "generic parameter" },
      // 2. only inside a path
      { surface: `use crate::store::${pascal};`, why: "path segment" },
      // 3. only inside a member signature
      { surface: `fn get(&self) -> ${pascal}`, why: "member signature return" },
      // 4. a `visited` entry differing only in case
      { visited: [pascal.toUpperCase()], why: "visited, case-differing" },
      // 5. a `rendered` entry differing only in separator
      { rendered: [w.join("_")], why: "rendered, snake_case fold collision" },
      // 6. rendered, and the candidate is a substring of a longer rendered name
      { rendered: [pascal, pascal + "Extra"], why: "rendered plus a longer sibling" },
    ];
    for (const p of plants) {
      const led = ledger({
        rendered: p.rendered ?? [],
        visited: p.visited ?? p.rendered ?? [],
        surface: p.surface ?? "",
        admitted: 4,
        typeCap: 4,
      });
      const out = deltaProposals([cand(pascal)], led);
      if (out.length !== 0) failures.push(`${p.why}: ${pascal} survived as class ${out[0].klass}`);
    }
  }
  assert.deepEqual(failures, [], `ship condition 2 violated ${failures.length} times`);
});

// The reverse direction, which must NOT over-drop: a candidate that is a
// substring of a rendered name, and a rendered name that is a substring of the
// candidate, are different types and both must survive.
test("substring relations do not silently drop a real class 4", () => {
  const led = ledger({ rendered: ["ClientSetIndex"], visited: ["ClientSetIndex"], surface: "struct ClientSetIndex {}" });
  assert.equal(classifyCandidate("ClientSet", led), 4, "ClientSet is not ClientSetIndex");
  assert.equal(classifyCandidate("Index", led), 4, "Index is not ClientSetIndex");
});

// Amendment 3, at the boundary. `my_ShardMemCache` and `ShardMemCache2` are not
// hits; `foo.ShardMemCache` is.
test("amendment 3: the whole-word rule at both boundaries", () => {
  const hit = (surface) => classifyCandidate("ShardMemCache", ledger({ surface }));
  assert.equal(hit("let x: my_ShardMemCache = 1;"), 4);
  assert.equal(hit("let x: ShardMemCache2 = 1;"), 4);
  assert.equal(hit("let x: foo.ShardMemCache = 1;"), 2);
  assert.equal(hit("Vec<ShardMemCache>"), 2);
  assert.equal(hit("fn get(&self) -> ShardMemCache"), 2);
  assert.equal(hit("crate::store::ShardMemCache"), 2);
  assert.equal(hit("SHARD_MEM_CACHE"), 2, "amendment 2: the whole-word test is under the fold too");
});

// Unicode look-alikes must not be treated as the same name. A Cyrillic `С` is
// not an ASCII `C`.
test("unicode look-alikes are not the same name", () => {
  const led = ledger({ rendered: ["Client"], visited: ["Client"], surface: "struct Client {}" });
  // U+0421 CYRILLIC CAPITAL ES, then ASCII "lient".
  const lookalike = "Сlient";
  assert.notEqual(lookalike, "Client");
  const out = deltaProposals([cand(lookalike)], led);
  assert.equal(out.length, 1, "a different name must still be proposable");
  assert.equal(out[0].klass, 4);
});

// Amendment 15: duplicates dedupe to the first. Two SPELLINGS of one fold key
// are deliberately not deduped, per the source comment - pin that so a later
// change to fold-deduping is a visible decision.
test("amendment 15: exact duplicates dedupe, fold-equal spellings do not", () => {
  const led = ledger();
  const exact = deltaProposals([cand("ClientSet", 0), cand("ClientSet", 40)], led);
  assert.equal(exact.length, 1);
  assert.equal(exact[0].start, 0, "the FIRST one survives");
  const folded = deltaProposals([cand("ClientSet", 0), cand("client_set", 40)], led);
  assert.equal(folded.length, 2, "documented behaviour: fold-equal spellings are two proposals");
});

// Amendment 14: nothing throws, on any input, on every export.
test("amendment 14: no export throws on hostile input", () => {
  const hostile = [
    undefined,
    null,
    0,
    "",
    "x",
    [],
    {},
    { rendered: null, visited: 3, noBlock: "x", notLookedAt: {}, dropped: [null, 1], typeCap: "4", admitted: NaN, surface: 7 },
    { rendered: [null, undefined, 1, "A"], visited: [{}], noBlock: [null, { type: 1 }], notLookedAt: [[]], dropped: [{ name: null }], typeCap: Infinity, admitted: -1, surface: "" },
  ];
  for (const led of hostile) {
    assert.doesNotThrow(() => classifyCandidate("A", led), `classifyCandidate(${JSON.stringify(led)})`);
    assert.doesNotThrow(() => deltaProposals([cand("A")], led));
    assert.doesNotThrow(() => deltaProposals(undefined, led));
    assert.doesNotThrow(() => deltaProposals([null, 1, "x", {}, cand("A")], led));
  }
  for (const bad of [undefined, null, 0, {}, []]) {
    assert.doesNotThrow(() => foldName(bad));
    assert.doesNotThrow(() => spokenWords(bad));
    assert.doesNotThrow(() => identifierVariants(bad));
    assert.doesNotThrow(() => stripPlural(bad));
    assert.doesNotThrow(() => matchByFold(bad, bad));
    assert.doesNotThrow(() => parseProposerReply(bad, bad));
    assert.doesNotThrow(() => assembleProposerPrompt(bad));
  }
});

// Amendment 1 and the `displaces` rule.
test("amendment 1: displaces is absent with an empty rendered, present and LAST otherwise", () => {
  const full = ledger({ rendered: [], admitted: 4, typeCap: 4 });
  assert.equal(deltaProposals([cand("A")], full)[0].displaces, undefined);
  const named = ledger({ rendered: ["First", "Second", "Third"], admitted: 4, typeCap: 4 });
  assert.equal(deltaProposals([cand("A")], named)[0].displaces, "Third");
  const room = ledger({ rendered: ["First"], admitted: 1, typeCap: 4 });
  assert.equal(deltaProposals([cand("A")], room)[0].displaces, undefined);
});

test("ordering: class 4 ahead of class 3, source order inside a class", () => {
  const led = ledger({ notLookedAt: ["Three1", "Three2"] });
  const out = deltaProposals([cand("Three1", 0), cand("Four1", 10), cand("Three2", 20), cand("Four2", 30)], led);
  assert.deepEqual(
    out.map((p) => `${p.identifier}:${p.klass}`),
    ["Four1:4", "Four2:4", "Three1:3", "Three2:3"],
  );
});

// ===========================================================================
// B. THE PROPOSER CANNOT WRITE. Ship condition 4, at scale.
// ===========================================================================

test("SHIP 4 property: prose.slice(start,end) === phrase over 5 hostile reply families", () => {
  const proses = [
    "Drop all the client sets from the shard mem cache before the WAL segment rolls.",
    "The 顧客 record and the ClientSet map and the ClientSet map again.",
    "🚀 emoji first, then ClientSet, then 日本語 text, then ClientSet once more.",
    "a".repeat(300) + " ClientSet " + "b".repeat(300),
    "line one\nline two ClientSet\nline three ClientSet\n",
    "tabs\tand  double  spaces  ClientSet  here",
  ];
  const replyFamilies = (prose) => [
    // exact echo of the whole prose
    prose,
    // one character changed
    prose.replace(/e/, "3"),
    // every line of the prose, plus invented sentences
    prose.split(/\s+/).join("\n") + "\nThis type does not exist\nInventedType\n```\n",
    // the same phrase many times
    Array.from({ length: 40 }, () => "ClientSet").join("\n"),
    // overlapping spans
    ["ClientSet map", "ClientSet", "map", "Client", "Set", prose.slice(0, 20), prose.slice(5, 30)].join("\n"),
    // spans containing newlines
    [prose.slice(0, 40), "line two ClientSet\nline three", prose].join("\n\n"),
    // 10,000 lines of junk with a few real ones
    Array.from({ length: 10000 }, (_, i) => (i % 1000 === 0 ? "ClientSet" : `junk-${i}`)).join("\n"),
    // whitespace-padded lines (amendment 11)
    "   ClientSet   \n\t\tshard mem cache\t\n",
    // CRLF
    "ClientSet\r\nshard mem cache\r\n",
  ];
  let checked = 0;
  for (const prose of proses) {
    for (const reply of replyFamilies(prose)) {
      const spans = parseProposerReply(reply, prose);
      assert.ok(spans.length <= PROPOSER_SPAN_CAP, "the cap is a cap");
      for (const s of spans) {
        assert.equal(
          prose.slice(s.start, s.end),
          s.phrase,
          `SLICE PROPERTY BROKEN\n  prose=${JSON.stringify(prose)}\n  span=${JSON.stringify(s)}`,
        );
        assert.ok(s.start >= 0 && s.end <= prose.length && s.start < s.end);
        checked++;
      }
      // No two survivors overlap.
      const sorted = [...spans].sort((a, b) => a.start - b.start);
      for (let i = 1; i < sorted.length; i++) {
        assert.ok(sorted[i].start >= sorted[i - 1].end, `overlap survived: ${JSON.stringify(sorted)}`);
      }
    }
  }
  assert.ok(checked > 100, `the sweep must actually produce spans; got ${checked}`);
});

test("an emoji or CJK before a phrase does not shift the reported offset", () => {
  for (const lead of ["", "🚀 ", "日本語 ", "🇦🇺🇦🇺 ", "\u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467} "]) {
    const prose = `${lead}the ClientSet map`;
    const [span] = parseProposerReply("ClientSet", prose);
    assert.ok(span, `no span for lead ${JSON.stringify(lead)}`);
    assert.equal(prose.slice(span.start, span.end), "ClientSet");
    assert.equal(span.phrase, "ClientSet");
  }
});

test("a reply of pure invention yields nothing", () => {
  const prose = "Drop all the client sets from the shard mem cache.";
  const reply = ["ShardMemCache", "ClientSet", "The developer meant `ClientSet`.", "1. ClientSet", "- ClientSet", '"client sets"'].join("\n");
  assert.deepEqual(parseProposerReply(reply, prose), [], "not one of those lines is a verbatim substring");
});

test("amendment 10: a phrase listed twice claims successive occurrences", () => {
  const prose = "the ClientSet and the ClientSet and the ClientSet";
  const spans = parseProposerReply("ClientSet\nClientSet", prose);
  assert.equal(spans.length, 2);
  assert.deepEqual(
    spans.map((s) => s.start),
    [4, 22],
  );
});

test("amendment 12/13: cap after the sort, equal-length ties by earlier start", () => {
  // 20 distinct three-letter phrases, none overlapping, plus one long one.
  const prose = Array.from({ length: 20 }, (_, i) => `t${String(i).padStart(2, "0")}`).join(" ") + " LongestPhraseHere";
  const reply = ["LongestPhraseHere", ...Array.from({ length: 20 }, (_, i) => `t${String(i).padStart(2, "0")}`)].join("\n");
  const spans = parseProposerReply(reply, prose);
  assert.equal(spans.length, PROPOSER_SPAN_CAP);
  assert.equal(spans[0].phrase, "LongestPhraseHere", "the longest survives the cap, not the first typed");
  const rest = spans.slice(1).map((s) => s.start);
  assert.deepEqual(rest, [...rest].sort((a, b) => a - b), "equal-length claims resolve in prose order");
});

test("DEFECT 5 probe: parseProposerReply cost on a hostile reply", () => {
  const prose = "a".repeat(20000);
  const reply = prose + "\n" + Array.from({ length: 5000 }, () => "a").join("\n");
  const t0 = Date.now();
  const spans = parseProposerReply(reply, prose);
  const ms = Date.now() - t0;
  assert.equal(spans.length, 1);
  assert.ok(ms < 5000, `parseProposerReply took ${ms}ms on a 5,000-line reply against 20k chars of prose`);
});

test("amendment 11: lines are trimmed before matching, and only trimmed", () => {
  const prose = "Drop the ClientSet now.";
  assert.deepEqual(parseProposerReply("   ClientSet   ", prose), [{ phrase: "ClientSet", start: 9, end: 18 }]);
  assert.deepEqual(parseProposerReply("\t\tClientSet\t\n", prose), [{ phrase: "ClientSet", start: 9, end: 18 }]);
  // Trim is the ONLY normalisation: a bulleted or quoted line stays unmatched.
  for (const junk of ["- ClientSet", "1. ClientSet", '"ClientSet"', "`ClientSet`", "**ClientSet**"]) {
    assert.deepEqual(parseProposerReply(junk, prose), [], `${junk} must not be un-decorated by the parser`);
  }
});

test("the per-language stop set is in force, and absent means no stop set", () => {
  const led = ledger();
  const rust = deltaProposals([cand("Result", 0), cand("Vec", 10), cand("ClientSet", 20)], led, "rust");
  assert.deepEqual(rust.map((p) => p.identifier), ["ClientSet"], "Rust std names are dropped before the gate");
  const none = deltaProposals([cand("Result", 0), cand("Vec", 10), cand("ClientSet", 20)], led);
  assert.equal(none.length, 3, "absent languageId means no stop set at all, not Rust's");
  const cs = deltaProposals([cand("Result", 0)], led, "csharp");
  assert.equal(cs.length, 1, "C# must not inherit Rust's idea of Result");
});

test("amendment 16: the prompt carries languageId raw and never a display name", () => {
  for (const id of ["csharp", "typescriptreact", "go", "", "rust"]) {
    const p = assembleProposerPrompt({ prose: "hello", languageId: id });
    assert.equal(typeof p, "string");
    if (id !== "") assert.ok(p.includes(id), `prompt must name ${id} raw`);
    assert.ok(!/C#|C Sharp|TypeScript React/.test(p), "no display-name table");
  }
});

test("the prompt's fence cannot be closed by the prose it wraps", () => {
  const prose = "here is ```rust\nlet x = 1;\n``` and a `Name`";
  const p = assembleProposerPrompt({ prose, languageId: "rust" });
  const fenceMatch = p.match(/^`{3,}$/m);
  assert.ok(fenceMatch, "a fence line must exist");
  const fence = fenceMatch[0];
  assert.ok(fence.length > 3, `the fence must outrun the prose's own run; got ${fence.length}`);
  const between = p.slice(p.indexOf(fence) + fence.length, p.lastIndexOf(fence));
  assert.equal(between.trim(), prose.trim(), "the prose survives inside the fence verbatim");
});

// ===========================================================================
// C. THE FOLD AND THE SWEEP.
// ===========================================================================

test("matchByFold refuses on ambiguity at BOTH stages (amendment 9)", () => {
  assert.equal(matchByFold("read error", ["ReadError", "read_error"]), undefined);
  assert.equal(matchByFold("client sets", ["ClientSet", "client_set"]), undefined, "the plural stage refuses too");
  assert.deepEqual(matchByFold("client sets", ["ClientSet"]), { identifier: "ClientSet", match: "plural" });
  assert.deepEqual(matchByFold("ClientSet", ["ClientSet", "ClientSet"]), { identifier: "ClientSet", match: "fold" });
});

test("amendment 6: a last word that IS s or es strips to nothing", () => {
  assert.equal(stripPlural(["client", "s"]), undefined);
  assert.equal(stripPlural(["client", "es"]), undefined);
  assert.equal(stripPlural(["s"]), undefined);
  assert.deepEqual(stripPlural(["client", "sets"]), ["client", "set"]);
});

// AMENDMENT 5 IS STRUCK, superseded by amendment 17. `stripPlural` keeps its
// es-before-s behaviour because this suite and the blind oracle both pin it, but
// it is no longer what `matchByFold` uses, and the row's last line was pinning
// the defect rather than the rule.
//
// Amendment 5's reasoning - every word ending in `es` also ends in `s`, so an
// s-first rule makes the es rule dead code - holds only for a SINGLE strip with
// an early exit. Forced to choose, it chose wrong for every word ending in a
// silent `e`, and the review measured that class at 18.6% of pluralisable type
// names. Amendment 17 generates both strips and lets the identifier set decide,
// which makes neither one dead.
test("amendment 5 (STRUCK) / 17: stripPlural is unchanged, and matchByFold no longer uses it", () => {
  assert.deepEqual(stripPlural(["caches"]), ["cach"], "the superseded single strip, kept as the record");
  assert.deepEqual(stripPlural(["boxes"]), ["box"]);
  assert.deepEqual(stripPlural(["classes"]), ["class"]);
  assert.deepEqual(stripPlural(["sets"]), ["set"]);
  // What amendment 17 buys: the silent-e class is RECOVERED rather than merely
  // missing. This line used to assert `undefined` and called it "as documented".
  assert.deepEqual(
    matchByFold("caches", ["Cache"]),
    { identifier: "Cache", match: "plural" },
    "the s-strip reaches Cache and the es-strip reaches nothing, so exactly one resolves",
  );
  assert.deepEqual(matchByFold("node samples", ["NodeSample"]), { identifier: "NodeSample", match: "plural" });
  // And the cases the old rule got right are untouched: only the es-strip
  // resolves for these, so exactly one still wins.
  assert.deepEqual(matchByFold("boxes", ["Box"]), { identifier: "Box", match: "plural" });
  assert.deepEqual(matchByFold("classes", ["Class"]), { identifier: "Class", match: "plural" });
  assert.deepEqual(matchByFold("client sets", ["ClientSet"]), { identifier: "ClientSet", match: "plural" });
});

test("amendment 7/8: variants dedupe, empty in empty out, inner split at three words", () => {
  assert.deepEqual(identifierVariants([]), []);
  assert.deepEqual(identifierVariants(["!!!"]), []);
  const one = identifierVariants(["cache"]);
  assert.equal(new Set(one).size, one.length, "deduped");
  const three = identifierVariants(["shard", "mem", "cache"]);
  assert.ok(three.includes("ShardMemcache"), "the inner-token split fires at three words");
  assert.equal(new Set(three).size, three.length, "deduped at three words too");
  const two = identifierVariants(["mem", "cache"]);
  assert.ok(!two.includes("Memcache") || two.includes("Memcache"), "two-word set is whatever the eight conventions give");
  const four = identifierVariants(["a", "b", "c", "d"]);
  assert.ok(four.includes("ABcd"), "the spike's rule at four words: cap the first two, glue the tail");
  // DEFECT 4, FIXED IN THE DOC. `spokenName.ts` claimed "a single word has four
  // distinct spellings, not nine". It is three: Cache, cache, CACHE. The
  // underscore, hyphen and glue conventions all collapse onto the bare
  // lowercase word when there is nothing to join, and capitalise-each-word
  // collapses onto `Cache`. The row now asserts the counted number, so a doc
  // comment drifting back to four is caught by the code and not by a reader.
  assert.deepEqual(one, ["Cache", "cache", "CACHE"], `one word gives exactly three spellings; got ${JSON.stringify(one)}`);
});

test("spokenWords keeps spelling and splits acronyms the documented way", () => {
  assert.deepEqual(spokenWords("Shard Mem Cache"), ["Shard", "Mem", "Cache"]);
  assert.deepEqual(spokenWords("WALSegment"), ["WAL", "Segment"]);
  assert.deepEqual(spokenWords("shard_mem_cache"), ["shard", "mem", "cache"]);
  assert.deepEqual(spokenWords("HTTP2Server"), ["HTTP2", "Server"]);
});


// ===========================================================================
// D. SHIP CONDITION 5 AT SCALE, and the ledger against the channel.
//    Harness ported from test/impl-v52-p2-ledger.test.cjs.
// ===========================================================================

const STUB = path.join(__dirname, ".adversarial-v52-p2-vscode-stub.cjs");
fs.writeFileSync(
  STUB,
  `
class Position {
  constructor(line, character) { this.line = line; this.character = character; }
  isBefore(o) { return this.line < o.line || (this.line === o.line && this.character < o.character); }
  isBeforeOrEqual(o) { return this.isBefore(o) || this.isEqual(o); }
  isAfter(o) { return !this.isBeforeOrEqual(o); }
  isAfterOrEqual(o) { return !this.isBefore(o); }
  isEqual(o) { return this.line === o.line && this.character === o.character; }
  compareTo(o) { return this.isEqual(o) ? 0 : this.isBefore(o) ? -1 : 1; }
  translate(l = 0, c = 0) { return new Position(this.line + l, this.character + c); }
  with(line, character) { return new Position(line === undefined ? this.line : line, character === undefined ? this.character : character); }
}
class Range {
  constructor(a, b, c, d) {
    if (typeof a === "number") { this.start = new Position(a, b); this.end = new Position(c, d); }
    else { this.start = a; this.end = b; }
  }
  get isEmpty() { return this.start.line === this.end.line && this.start.character === this.end.character; }
  get isSingleLine() { return this.start.line === this.end.line; }
  contains(p) {
    const ps = p.start ? p.start : p, pe = p.end ? p.end : p;
    const geS = ps.line > this.start.line || (ps.line === this.start.line && ps.character >= this.start.character);
    const leE = pe.line < this.end.line || (pe.line === this.end.line && pe.character <= this.end.character);
    return geS && leE;
  }
  with(s, e) { return new Range(s || this.start, e || this.end); }
}
class Selection extends Range {}
class WorkspaceEdit {}
class EventEmitter { constructor(){ this.event=()=>({dispose(){}}); } fire(){} dispose(){} }
class ThemeColor {}
class MarkdownString {}
const mkUri = (s) => ({ toString: () => String(s), fsPath: String(s), path: String(s) });
const keyOf = (arg) => (typeof arg === "string" ? arg : (arg && arg.toString ? arg.toString() : String(arg)));
module.exports = {
  Position, Range, Selection, WorkspaceEdit, EventEmitter, ThemeColor, MarkdownString,
  Uri: { parse: mkUri, file: mkUri },
  SymbolKind: { File:0, Module:1, Namespace:2, Package:3, Class:4, Method:5, Property:6,
    Field:7, Constructor:8, Enum:9, Interface:10, Function:11, Variable:12, Constant:13,
    String:14, Number:15, Boolean:16, Array:17, Object:18, Key:19, Null:20, EnumMember:21,
    Struct:22, Event:23, Operator:24, TypeParameter:25 },
  ProgressLocation: { SourceControl:1, Window:10, Notification:15 },
  EndOfLine: { LF:1, CRLF:2 },
  languages: {}, window: {}, commands: { executeCommand: async () => undefined },
  workspace: {
    getConfiguration: () => ({ get: (k, f) => f, has: () => false, inspect: () => undefined, update: async () => {} }),
    openTextDocument: (arg) => {
      const files = globalThis.__ADVP2_FILES__ || {};
      const key = keyOf(arg);
      return Promise.resolve({ uri: mkUri(key), getText: () => files[key] });
    },
  },
};
`,
);

const ENTRY = path.join(__dirname, ".adversarial-v52-p2-fngen.entry.ts");
const OUTFILE = path.join(__dirname, ".adversarial-v52-p2-fngen.bundle.cjs");
let B = {};
let bundleErr;
try {
  fs.writeFileSync(ENTRY, `export { resolvePrefill } from "../src/vscode/fnGen";\n`);
  esbuild.buildSync({
    entryPoints: [ENTRY],
    bundle: true,
    outfile: OUTFILE,
    format: "cjs",
    platform: "node",
    alias: { vscode: STUB },
  });
  B = require(OUTFILE);
} catch (e) {
  bundleErr = e;
}
const V = require(STUB);
test.after(() => [STUB, ENTRY, OUTFILE].forEach((f) => fs.rmSync(f, { force: true })));

// A broken bundle must be ONE loud failure, never a wall of TypeErrors that
// could be mistaken for a contract failure.
test("bundle guard (adv): resolvePrefill builds headless against the vscode stub", () => {
  if (bundleErr) assert.fail(`bundle failed to build: ${bundleErr.message}`);
  assert.equal(typeof B.resolvePrefill, "function");
});
const btest = (name, fn) =>
  test(name, (ctx) => {
    if (bundleErr) return ctx.skip("bundle failed to build; see the bundle guard");
    return fn(ctx);
  });

function makeDoc(text, uriStr) {
  const lines = text.split("\n");
  const offsetAt = (p) => {
    let o = 0;
    for (let i = 0; i < Math.min(p.line, lines.length); i++) o += lines[i].length + 1;
    return Math.min(o + p.character, text.length);
  };
  const positionAt = (off) => {
    let o = 0;
    for (let l = 0; l < lines.length; l++) {
      if (off <= o + lines[l].length) return new V.Position(l, off - o);
      o += lines[l].length + 1;
    }
    return new V.Position(lines.length - 1, 0);
  };
  return {
    uri: { toString: () => uriStr },
    offsetAt,
    positionAt,
    getText: (r) => (r ? text.slice(offsetAt(r.start), offsetAt(r.end)) : text),
  };
}

const SK = { Class: 4, Method: 5, Field: 7, Function: 11, Object: 18, Struct: 22 };
const lineOf = (src, needle) => {
  const i = src.indexOf(needle);
  assert.ok(i >= 0, `fixture bug: ${JSON.stringify(needle)} not in source`);
  return src.slice(0, i).split("\n").length - 1;
};
function rng(src, from, to) {
  const lines = src.split("\n");
  const sl = lineOf(src, from);
  const el = to === undefined ? lines.length - 1 : lineOf(src, to);
  const r = new V.Range(sl, 0, el, lines[el].length);
  Object.defineProperty(r, "__line", { value: lines[sl], enumerable: false });
  return r;
}
// FIDELITY: `selectionRange` covers the NAME TOKEN on the node's first line,
// which is what every server measured in `session-v24/measure-midedit.md`
// reports. A full-span selectionRange is a shape no server produces and it
// pushes every anchor to column 0.
function nameSelection(name, range) {
  const line = range.__line;
  if (typeof line !== "string") return range;
  const token = name.startsWith("impl") ? name.slice(4).trim() : name;
  const ch = line.indexOf(token);
  if (ch < 0) return range;
  return new V.Range(range.start.line, ch, range.start.line, ch + token.length);
}
const dsym = (name, kind, range, children = [], detail = "") => ({
  name,
  detail,
  kind,
  range,
  selectionRange: nameSelection(name, range),
  children,
});

function wordAt(text, cursor) {
  const line = text.split("\n")[cursor.line] ?? "";
  const isWord = (c) => /[A-Za-z0-9_]/.test(c);
  let s = Math.min(cursor.character, line.length);
  let e = s;
  while (s > 0 && isWord(line[s - 1])) s--;
  while (e < line.length && isWord(line[e])) e++;
  return line.slice(s, e) || undefined;
}

const DECL = (n) => new RegExp(`\\b(?:struct|class|record|interface|enum|type)\\s+${n}\\b`);

function makeExtractor(cfg) {
  const files = cfg.files;
  const defTypes = cfg.defTypes || {};
  const known = new Set(Object.keys(defTypes));
  const typeAtCursor = (uri, cursor) => {
    const text = files[uri];
    if (text === undefined) return undefined;
    const w = wordAt(text, cursor);
    if (w && known.has(w)) return w;
    const line = text.split("\n")[cursor.line] ?? "";
    for (const t of known) if (new RegExp(`\\b${t}\\b`).test(line)) return t;
    return undefined;
  };
  const defLocFor = (t) => {
    const uri = defTypes[t].uri;
    const lines = (files[uri] || "").split("\n");
    const ln = lines.findIndex((l) => DECL(t).test(l));
    if (ln < 0) return undefined;
    const ch = lines[ln].indexOf(t);
    return { uri, range: { startLine: ln, startCharacter: ch, endLine: ln, endCharacter: ch + t.length } };
  };
  return {
    definition: async (c) => {
      const t = typeAtCursor(c.uri, c);
      return t ? defLocFor(t) : undefined;
    },
    hoverSurface: async (c) => {
      const t = typeAtCursor(c.uri, c);
      const h = t ? defTypes[t].hover : undefined;
      return h ? { signature: h } : undefined;
    },
    membersOfType: async (c) => {
      const t = typeAtCursor(c.uri, c);
      return (t && defTypes[t].members) || [];
    },
    example: async () => undefined,
    completeMembers: async () => [],
    qualifyImport: async () => undefined,
  };
}

/** One `resolvePrefill` run. `opts` rides straight through, so the only thing
 *  that differs between the two halves of a byte comparison is the hook. */
async function runPrefill(scn, opts) {
  const src = scn.files[scn.mainUri];
  const start = src.indexOf(scn.spanStart);
  assert.ok(start >= 0, `fixture bug: spanStart ${JSON.stringify(scn.spanStart)} not found`);
  const endIdx = src.indexOf(scn.spanEnd, start);
  assert.ok(endIdx >= 0, `fixture bug: spanEnd ${JSON.stringify(scn.spanEnd)} not after spanStart`);
  const resolved = {
    span: { start, end: endIdx + scn.spanEnd.length },
    signature: scn.signature,
    docComment: scn.docComment,
    symbolName: scn.symbolName,
    languageId: scn.languageId,
    kind: "function",
    bodyOnly: false,
    headerIndent: "",
    bodyIndent: "    ",
    docstringRefusal: undefined,
  };
  if ("tree" in scn) resolved.symbols = scn.tree;
  const logs = [];
  globalThis.__ADVP2_FILES__ = scn.files;
  let out;
  try {
    out = await B.resolvePrefill(makeExtractor(scn), makeDoc(src, scn.mainUri), resolved, (l) => logs.push(l), opts);
  } finally {
    delete globalThis.__ADVP2_FILES__;
  }
  return { out, logs };
}


// --- fixtures -------------------------------------------------------------

const RS_URI = "file:///w/adv52/lib.rs";
const RS_SRC = `pub struct Widget {
    mass: u32,
}

pub struct Owner {
    slots: u32,
}

impl Owner {
    pub fn roll_active(&self) -> u64 {
        0
    }
}

/// Absorb the \`Widget\` into the owner.
fn absorb(o: &Owner, w: Widget) -> u32 {
    todo!()
}
`;
const RUST = {
  languageId: "rust",
  mainUri: RS_URI,
  files: { [RS_URI]: RS_SRC },
  tree: [
    dsym("Widget", SK.Struct, rng(RS_SRC, "pub struct Widget", "    mass: u32,")),
    dsym("Owner", SK.Struct, rng(RS_SRC, "pub struct Owner", "    slots: u32,")),
    dsym("impl Owner", SK.Object, rng(RS_SRC, "impl Owner {", "    }"), [
      dsym("roll_active", SK.Method, rng(RS_SRC, "pub fn roll_active", "    }"), [], "fn(&self) -> u64"),
    ]),
    dsym("absorb", SK.Function, rng(RS_SRC, "fn absorb(o: &Owner"), [], "fn(o: &Owner, w: Widget) -> u32"),
  ],
  defTypes: {
    Widget: { uri: RS_URI, hover: "pub struct Widget { mass: u32 }", members: [{ name: "mass_of", signature: "mass_of(&self) -> u32", kind: "method" }] },
    Owner: { uri: RS_URI, hover: "pub struct Owner { slots: u32 }", members: [{ name: "roll_active", signature: "roll_active(&self) -> u64", kind: "method" }] },
  },
  spanStart: "fn absorb(o: &Owner",
  spanEnd: "todo!()\n}",
  signature: "fn absorb(o: &Owner, w: Widget) -> u32",
  docComment: "/// Absorb the `Widget` into the owner.",
  symbolName: "absorb",
};

// WIDE: ten collaborator types in one signature, so the root cap has to leave
// some of them in `notLookedAt` and the "dropped N lower-priority type(s)" line
// has something to say. Without this the ledger's cap fields are never exercised.
const WIDE_N = 10;
const WIDE_URI = "file:///w/adv52/wide.rs";
const WIDE_NAMES = Array.from({ length: WIDE_N }, (_, i) => `Coll${String.fromCharCode(65 + i)}`);
const WIDE_SRC =
  WIDE_NAMES.map((n) => `pub struct ${n} {\n    v: u32,\n}\n`).join("\n") +
  `\n/// Combine every collaborator.\nfn combine(${WIDE_NAMES.map((n, i) => `a${i}: &${n}`).join(", ")}) -> u32 {\n    todo!()\n}\n`;
const WIDE = {
  languageId: "rust",
  mainUri: WIDE_URI,
  files: { [WIDE_URI]: WIDE_SRC },
  tree: [
    ...WIDE_NAMES.map((n) => dsym(n, SK.Struct, rng(WIDE_SRC, `pub struct ${n} {`, `    v: u32,`))),
    dsym("combine", SK.Function, rng(WIDE_SRC, "fn combine(a0:"), [], "fn(...) -> u32"),
  ],
  defTypes: Object.fromEntries(
    WIDE_NAMES.map((n) => [
      n,
      { uri: WIDE_URI, hover: `pub struct ${n} { v: u32 }`, members: [{ name: `v_of_${n}`, signature: `v_of(&self) -> u32`, kind: "method" }] },
    ]),
  ),
  spanStart: "fn combine(a0:",
  spanEnd: "todo!()\n}",
  signature: `fn combine(${WIDE_NAMES.map((n, i) => `a${i}: &${n}`).join(", ")}) -> u32`,
  docComment: "/// Combine every collaborator.",
  symbolName: "combine",
};

const TS_URI = "file:///w/adv52/lib.ts";
const TS_SRC = `export class Widget {
  mass: number = 0;
  massOf(): number { return this.mass; }
}

export class Owner {
  slots: number = 0;
}

/** Absorb the \`Widget\` into the owner. */
export function absorb(o: Owner, w: Widget): number {
  throw new Error("todo");
}
`;
const TYPESCRIPT = {
  languageId: "typescript",
  mainUri: TS_URI,
  files: { [TS_URI]: TS_SRC },
  tree: [
    dsym("Widget", SK.Class, rng(TS_SRC, "export class Widget", "  massOf(): number"), [
      dsym("mass", SK.Field, rng(TS_SRC, "  mass: number = 0;", "  mass: number = 0;")),
      dsym("massOf", SK.Method, rng(TS_SRC, "  massOf(): number", "  massOf(): number")),
    ]),
    dsym("Owner", SK.Class, rng(TS_SRC, "export class Owner", "  slots: number = 0;"), [
      dsym("slots", SK.Field, rng(TS_SRC, "  slots: number = 0;", "  slots: number = 0;")),
    ]),
    dsym("absorb", SK.Function, rng(TS_SRC, "export function absorb")),
  ],
  defTypes: {
    Widget: { uri: TS_URI, hover: "class Widget", members: [{ name: "massOf", signature: "massOf(): number", kind: "method" }] },
    Owner: { uri: TS_URI, hover: "class Owner", members: [{ name: "rollActive", signature: "rollActive(): number", kind: "method" }] },
  },
  spanStart: "export function absorb",
  spanEnd: 'throw new Error("todo");',
  signature: "export function absorb(o: Owner, w: Widget): number",
  docComment: "/** Absorb the `Widget` into the owner. */",
  symbolName: "absorb",
};

// BARE: a target whose signature names nothing resolvable, so the run renders
// no block at all and `resolvePrefill` returns undefined.
const BARE_URI = "file:///w/adv52/bare.rs";
const BARE_SRC = `/// Do the thing.
fn tick(n: u32) -> u32 {
    todo!()
}
`;
const BARE = {
  languageId: "rust",
  mainUri: BARE_URI,
  files: { [BARE_URI]: BARE_SRC },
  tree: [dsym("tick", SK.Function, rng(BARE_SRC, "fn tick(n: u32)"), [], "fn(n: u32) -> u32")],
  defTypes: {},
  spanStart: "fn tick(n: u32)",
  spanEnd: "todo!()\n}",
  signature: "fn tick(n: u32) -> u32",
  docComment: "/// Do the thing.",
  symbolName: "tick",
};

const FIXTURES = [
  ["rust", RUST],
  ["rust-wide", WIDE],
  ["typescript", TYPESCRIPT],
  ["bare", BARE],
];

// Every opts shape an existing caller can build. `onLedger` is added to a COPY
// of each, and the two runs must be byte-identical.
const OPT_SHAPES = () => [
  ["undefined", undefined],
  ["empty", {}],
  ["omitInstruction", { omitInstruction: true }],
  ["forConstruction", { forConstruction: true }],
  ["test-gen import hint", { forConstruction: true, importTargetPath: "/w/adv52/other.rs" }],
  ["importTargetPath alone", { importTargetPath: "/w/adv52/other.rs" }],
  ["extraCandidates", { extraCandidates: ["Widget", "Owner", "Missing"] }],
  ["extraCursors empty", { extraCursors: new Map() }],
  ["repair round", { extraCandidates: ["Widget"], extraCursors: new Map(), omitInstruction: true }],
  ...["shipped", "small", "medium", "large", "frontier"].map((s) => [`stop=${s}`, { contextStop: s }]),
];

function withHooks(base, extra) {
  return base === undefined ? extra : { ...base, ...extra };
}

for (const [fname, scn] of FIXTURES) {
  btest(`SHIP 5 AT SCALE (${fname}): bytes and channel identical across every opts shape`, async () => {
    const diffs = [];
    for (const [oname, opts] of OPT_SHAPES()) {
      const surfacesA = [];
      const disclosedA = [];
      const a = await runPrefill(
        scn,
        withHooks(opts, { onSurface: (s) => surfacesA.push(snapSurface(s)), onDisclosed: (t) => disclosedA.push(...t.map((d) => d.name)) }),
      );
      const surfacesB = [];
      const disclosedB = [];
      let led;
      const b = await runPrefill(
        scn,
        withHooks(opts, {
          onSurface: (s) => surfacesB.push(snapSurface(s)),
          onDisclosed: (t) => disclosedB.push(...t.map((d) => d.name)),
          onLedger: (l) => (led = l),
        }),
      );
      if (b.out !== a.out) diffs.push(`${oname}: RETURNED SURFACE differs`);
      if (JSON.stringify(a.logs) !== JSON.stringify(b.logs)) {
        diffs.push(`${oname}: CHANNEL differs\n    without: ${JSON.stringify(a.logs)}\n    with:    ${JSON.stringify(b.logs)}`);
      }
      if (JSON.stringify(surfacesA) !== JSON.stringify(surfacesB)) diffs.push(`${oname}: onSurface differs`);
      if (JSON.stringify(disclosedA) !== JSON.stringify(disclosedB)) diffs.push(`${oname}: onDisclosed differs`);
      LEDGERS.push({ fixture: fname, opts: oname, out: b.out, logs: b.logs, led });
    }
    assert.deepEqual(diffs, [], `ship condition 5 broken in ${diffs.length} of ${OPT_SHAPES().length} opts shapes`);
  });
}

function snapSurface(s) {
  const keeps = [];
  for (let k = 0; k <= s.blocks + 1; k++) keeps.push(s.keep(k));
  return { text: s.text, blocks: s.blocks, keeps };
}

// Filled by the row above; read by the rows below so the expensive sweep runs once.
const LEDGERS = [];

btest("no extractor: resolvePrefill degrades to undefined and nothing throws", async () => {
  const src = RUST.files[RUST.mainUri];
  const start = src.indexOf(RUST.spanStart);
  const resolved = {
    span: { start, end: src.length },
    signature: RUST.signature,
    docComment: RUST.docComment,
    symbolName: RUST.symbolName,
    languageId: "rust",
    kind: "function",
    bodyOnly: false,
    headerIndent: "",
    bodyIndent: "    ",
    docstringRefusal: undefined,
    symbols: RUST.tree,
  };
  let fired = false;
  const out = await B.resolvePrefill(undefined, makeDoc(src, RUST.mainUri), resolved, () => {}, { onLedger: () => (fired = true) });
  assert.equal(out, undefined);
  assert.equal(fired, false, "documented: no extractor means no run and therefore no ledger");
});

btest("an extractor that throws on every call does not take the surface down", async () => {
  const boom = {
    definition: async () => {
      throw new Error("server died");
    },
    hoverSurface: async () => {
      throw new Error("server died");
    },
    membersOfType: async () => {
      throw new Error("server died");
    },
    example: async () => {
      throw new Error("server died");
    },
    completeMembers: async () => {
      throw new Error("server died");
    },
    qualifyImport: async () => {
      throw new Error("server died");
    },
  };
  const src = RUST.files[RUST.mainUri];
  const start = src.indexOf(RUST.spanStart);
  const resolved = {
    span: { start, end: src.length },
    signature: RUST.signature,
    docComment: RUST.docComment,
    symbolName: RUST.symbolName,
    languageId: "rust",
    kind: "function",
    bodyOnly: false,
    headerIndent: "",
    bodyIndent: "    ",
    docstringRefusal: undefined,
    symbols: RUST.tree,
  };
  globalThis.__ADVP2_FILES__ = RUST.files;
  const logsA = [];
  const a = await B.resolvePrefill(boom, makeDoc(src, RUST.mainUri), resolved, (l) => logsA.push(l), undefined);
  const logsB = [];
  let led;
  const b = await B.resolvePrefill(boom, makeDoc(src, RUST.mainUri), resolved, (l) => logsB.push(l), { onLedger: (l) => (led = l) });
  delete globalThis.__ADVP2_FILES__;
  assert.equal(b, a, "ship 5 holds on the dead-server path too");
  assert.deepEqual(logsB, logsA);
});

// ---------------------------------------------------------------------------
// DEFECT 2. The ledger is not handed over on a run that injects nothing.
//
// `resolvePrefill` returns early when `blocks.length === 0 && !importHint`, and
// that return is BEFORE the `onLedger` call. The walk has already run, already
// filled `noBlock`/`notLookedAt`/`dropped`, and already LOGGED all of it. The
// channel says what happened; the ledger does not exist. Amendment 14 then
// classifies every candidate as class 4, so class 3 evidence the run actually
// produced is thrown away and a class-3 proposal is ranked as a class 4.
// ---------------------------------------------------------------------------
btest("DEFECT 2: a run that renders no block emits channel evidence and NO ledger", async () => {
  const logs = [];
  let led;
  const src = BARE.files[BARE.mainUri];
  const start = src.indexOf(BARE.spanStart);
  const resolved = {
    span: { start, end: src.length },
    signature: BARE.signature,
    docComment: BARE.docComment,
    symbolName: BARE.symbolName,
    languageId: "rust",
    kind: "function",
    bodyOnly: false,
    headerIndent: "",
    bodyIndent: "    ",
    docstringRefusal: undefined,
    symbols: BARE.tree,
  };
  globalThis.__ADVP2_FILES__ = BARE.files;
  const out = await B.resolvePrefill(
    makeExtractor({ files: BARE.files, defTypes: { Ghost: { uri: BARE_URI, hover: "", members: [] } } }),
    makeDoc(src, BARE.mainUri),
    resolved,
    (l) => logs.push(l),
    { extraCandidates: ["Ghost", "Phantom", "Spectre"], onLedger: (l) => (led = l) },
  );
  delete globalThis.__ADVP2_FILES__;
  assert.equal(out, undefined, "the fixture must actually take the no-block exit, or this row proves nothing");
  const evidence = logs.filter((l) => /injected nothing|accounting|lower-priority/.test(l));
  assert.ok(evidence.length > 0, `the channel must have said something for the gap to matter.  LOGS: ${JSON.stringify(logs)}`);
  assert.ok(
    led !== undefined,
    "the channel disclosed " +
      evidence.length +
      " line(s) of cap/no-block evidence and onLedger never fired, so the delta gate classifies every candidate as class 4.\n  CHANNEL: " +
      JSON.stringify(evidence),
  );
});

// ---------------------------------------------------------------------------
// The ledger against the channel, on the shapes the sweep above collected.
// ---------------------------------------------------------------------------
// INSTRUMENT GUARD. A ledger-vs-channel row that never sees a non-empty
// `notLookedAt`, `noBlock` or `dropped` is a row about an instrument, not about
// the product. This prints the coverage and fails if the sweep is hollow.
btest("instrument guard: the sweep exercises every ledger field it then grades", () => {
  const nonEmpty = { rendered: 0, visited: 0, noBlock: 0, notLookedAt: 0, dropped: 0, capFull: 0 };
  for (const row of LEDGERS) {
    if (row.led === undefined) continue;
    for (const f of ["rendered", "visited", "noBlock", "notLookedAt", "dropped"]) {
      if (row.led[f].length > 0) nonEmpty[f]++;
    }
    if (row.led.admitted >= row.led.typeCap) nonEmpty.capFull++;
  }
  console.log(`  ledger-field coverage over ${LEDGERS.filter((r) => r.led).length} runs: ${JSON.stringify(nonEmpty)}`);
  for (const f of ["rendered", "visited", "noBlock", "notLookedAt"]) {
    assert.ok(nonEmpty[f] > 0, `no run produced a non-empty ${f}; the rows below would prove nothing`);
  }
  assert.ok(nonEmpty.capFull > 0, "no run filled the root cap; the displaces path is untested against a real ledger");
});

btest("ledger vs channel: notLookedAt matches the `dropped N lower-priority type(s)` line", () => {
  const bad = [];
  for (const row of LEDGERS) {
    if (row.led === undefined) continue;
    const line = row.logs.find((l) => /pre-fill dropped \d+ lower-priority type\(s\)/.test(l));
    const claimed = line ? Number(line.match(/dropped (\d+) lower-priority/)[1]) : 0;
    if (claimed !== row.led.notLookedAt.length) {
      bad.push(`${row.fixture}/${row.opts}: channel says ${claimed}, ledger says ${row.led.notLookedAt.length}`);
    }
    if (line) {
      for (const n of row.led.notLookedAt.slice(0, 12)) {
        if (!line.includes(n)) bad.push(`${row.fixture}/${row.opts}: ${n} in ledger.notLookedAt but not on the channel line`);
      }
    }
  }
  assert.deepEqual(bad, []);
});

btest("ledger vs channel: noBlock matches the `injected nothing` lines verbatim", () => {
  const bad = [];
  for (const row of LEDGERS) {
    if (row.led === undefined) continue;
    const lines = row.logs.filter((l) => /injected nothing/.test(l));
    if (lines.length !== row.led.noBlock.length) {
      bad.push(`${row.fixture}/${row.opts}: ${lines.length} channel lines vs ${row.led.noBlock.length} ledger rows`);
      continue;
    }
    for (const r of row.led.noBlock) {
      const want = `[fngen] pre-fill \`${r.type}\` injected nothing: ${r.reason}`;
      if (!lines.includes(want)) bad.push(`${row.fixture}/${row.opts}: no channel line for ${JSON.stringify(want)}`);
    }
  }
  assert.deepEqual(bad, []);
});

btest("ledger vs channel: admitted matches the `kept=` accounting line", () => {
  const bad = [];
  for (const row of LEDGERS) {
    if (row.led === undefined) continue;
    const line = row.logs.find((l) => /pre-fill accounting: kept=/.test(l));
    if (!line) continue;
    const kept = Number(line.match(/kept=(\d+)/)[1]);
    if (kept !== row.led.admitted) bad.push(`${row.fixture}/${row.opts}: kept=${kept} vs admitted=${row.led.admitted}`);
  }
  assert.deepEqual(bad, []);
});

btest("ledger vs channel: rendered matches the injected block count and the surface", () => {
  const bad = [];
  let checked = 0;
  for (const row of LEDGERS) {
    if (row.led === undefined) continue;
    checked++;
    if (row.led.surface !== (row.out ?? "")) bad.push(`${row.fixture}/${row.opts}: ledger.surface is not the returned surface`);
    for (const n of row.led.rendered) {
      if (!row.led.surface.includes(n)) bad.push(`${row.fixture}/${row.opts}: rendered claims ${n}, surface never names it`);
    }
    const line = row.logs.find((l) => /pre-fill injected types=/.test(l));
    const blocks = line ? Number(line.match(/types=(\d+)/)[1]) : 0;
    if (blocks > row.led.rendered.length) {
      bad.push(`${row.fixture}/${row.opts}: channel says ${blocks} blocks, ledger renders ${row.led.rendered.length} names`);
    }
  }
  assert.ok(checked > 20, `the sweep must have collected ledgers; got ${checked}`);
  assert.deepEqual(bad, []);
});

// ---------------------------------------------------------------------------
// DEFECT 3 probe. `dropped` is documented as "types a walk dropped ENTIRELY",
// but it is the raw `droppedBy` map, which the channel line itself splits into
// two classes: dropped entirely, and data shapes whose member lists STAY. A
// name in the second class is also in `rendered`. `classifyCandidate` tests
// `rendered` first so no class-1 escapes, but the field does not mean what its
// own doc comment says and a consumer reading it as class-3 evidence is wrong.
// ---------------------------------------------------------------------------
btest("ledger: `dropped` and `rendered` must not name the same type, or `dropped` is mis-documented", (ctx) => {
  const withDrops = LEDGERS.filter((r) => r.led !== undefined && r.led.dropped.length > 0);
  if (withDrops.length === 0) {
    return ctx.skip(
      "SKIP LOUDLY: not one of these fixtures made `sharedWalk.droppedBy` non-empty, so this row grades nothing. " +
        "The member-floor class that would populate it (fnGen.ts, `sharedWalk.droppedBy?.set(name, { name, cause: \"member-floor\" })`) " +
        "is on the C# member render path and needs a C# fixture.",
    );
  }
  const overlaps = [];
  for (const row of withDrops) {
    for (const d of row.led.dropped) {
      if (row.led.rendered.includes(d.name)) overlaps.push(`${row.fixture}/${row.opts}: ${d.name} is dropped AND rendered`);
    }
  }
  assert.deepEqual(overlaps, [], "a name in both is a name the ledger calls dropped while its block is in the prompt");
});

// The whole point of the ledger: feed it to the real gate and check the
// guarantee end to end on real surfaces rather than synthetic ones.
btest("END TO END: every name the real surface carries is dropped by the real gate", () => {
  const escapes = [];
  let checked = 0;
  for (const row of LEDGERS) {
    if (row.led === undefined) continue;
    const inSurface = [...new Set([...row.led.rendered, ...row.led.visited])];
    if (inSurface.length === 0) continue;
    const cands = inSurface.map((n, i) => ({ identifier: n, phrase: n, start: i, end: i + n.length, match: "fold" }));
    const survivors = deltaProposals(cands, row.led, row.fixture.startsWith("rust") ? "rust" : "typescript");
    checked += cands.length;
    for (const s of survivors) escapes.push(`${row.fixture}/${row.opts}: ${s.identifier} survived as class ${s.klass}`);
  }
  assert.ok(checked > 50, `the sweep must produce candidates; got ${checked}`);
  assert.deepEqual(escapes, [], "ship condition 1 on REAL ledgers");
});

// ===========================================================================
// F. THE CORPUS CLAIMS. Skips LOUDLY when the repo is not on this box.
// ===========================================================================

const CORPUS = path.join(process.env.HOME || "", "work", "acme", "acme-db");
const TYPE_KINDS = new Set(["struct", "enum", "trait", "union", "type"]);
const KIND_RE = /^\s*(?:pub\s*(?:\([^)]*\))?\s+)?(struct|enum|trait|union|type|fn|const|static)\s+([A-Za-z_][A-Za-z0-9_]*)/gm;

let CORPUS_ERR;
let CORPUS_SYMBOLS;
function corpus() {
  if (CORPUS_SYMBOLS !== undefined || CORPUS_ERR !== undefined) return CORPUS_SYMBOLS;
  if (!fs.existsSync(CORPUS)) {
    CORPUS_ERR = `SKIP LOUDLY: ${CORPUS} is not on this box, so the corpus claims cannot be re-measured here`;
    console.log(CORPUS_ERR);
    return undefined;
  }
  const files = [];
  const walkDir = (dir, depth) => {
    if (depth > 8) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name === "target" || e.name === "node_modules" || e.name.startsWith(".")) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walkDir(p, depth + 1);
      else if (e.name.endsWith(".rs")) files.push(p);
    }
  };
  walkDir(CORPUS, 0);
  const kindOf = new Map();
  let total = 0;
  for (const f of files) {
    let src;
    try {
      src = fs.readFileSync(f, "utf8");
    } catch {
      continue;
    }
    for (const m of src.matchAll(KIND_RE)) {
      total++;
      if (!kindOf.has(m[2])) kindOf.set(m[2], new Set());
      kindOf.get(m[2]).add(m[1]);
    }
  }
  CORPUS_SYMBOLS = { total, kindOf, names: [...kindOf.keys()] };
  return CORPUS_SYMBOLS;
}

test("CORPUS: fold collisions, and whether a TYPE ever collides with a TYPE", (ctx) => {
  const c = corpus();
  if (!c) return ctx.skip(CORPUS_ERR);
  const byKey = new Map();
  for (const n of c.names) {
    const k = foldName(n);
    if (!byKey.has(k)) byKey.set(k, new Set());
    byKey.get(k).add(n);
  }
  const isType = (n) => [...c.kindOf.get(n)].some((k) => TYPE_KINDS.has(k));
  const collided = [...byKey.entries()].filter(([, s]) => s.size > 1);
  const typeVsType = collided.filter(([, s]) => [...s].filter(isType).length > 1);
  const noType = collided.filter(([, s]) => [...s].filter(isType).length === 0);
  console.log(
    `  CORPUS fold: symbols=${c.total} distinct=${c.names.length} keys=${byKey.size} collisions=${collided.length} ` +
      `(${((100 * collided.length) / byKey.size).toFixed(2)}%)  typeXtype=${typeVsType.length} noType=${noType.length}`,
  );
  // The claim that matters for the gate: no two TYPES share a fold key, so a
  // list of proposed type names cannot be silently merged.
  assert.deepEqual(
    typeVsType.map(([k, s]) => `${k}: ${[...s].join("|")}`),
    [],
    "a type-vs-type fold collision would make `matchByFold` refuse a real name, or worse pick one",
  );
  // DEFECT 6, FIXED IN THE DOCS. The sentence "every collision is a type
  // against a const or a function" was quoted as evidence in four places and is
  // false: 13 of the 37 collisions involve no type at all. The row no longer
  // pins the false sentence; it pins its ABSENCE, so a rewrite that reintroduces
  // it fails here rather than being caught by the next reviewer.
  assert.ok(noType.length > 0, "the false sentence is only worth guarding while the counter-example exists");
  // `session*/` is GITIGNORED, so the contract is absent on a clean clone and a
  // bare readFileSync here turns CI red. The TRACKED file is the one that matters
  // publicly; the contract is checked when it is present and skipped loudly when
  // it is not.
  for (const f of ["session-v52/contract-p2.md", "src/core/spokenName.ts"]) {
    const abs = path.join(__dirname, "..", f);
    if (!fs.existsSync(abs)) {
      console.log(`  SKIP: ${f} is absent (session dirs are gitignored); the tracked source is still checked`);
      continue;
    }
    const text = fs.readFileSync(abs, "utf8");
    assert.ok(
      // Whitespace-tolerant: the first version of this guard was anchored on
      // single spaces and a line break in the reflowed prose walked straight
      // through it.
      !/every\s+collision\s+(?:in\s+that\s+list\s+)?is\s+a\s+type\s+against\s+a\s+const/i.test(text),
      `${f} still carries the false collision sentence. ${noType.length} of ${collided.length} collisions ` +
        `involve NO type at all, e.g. ` +
        noType.slice(0, 5).map(([k, s]) => `${k}: ${[...s].join("|")}`).join("; ") +
        `. The true claim is the stronger one already asserted above: zero type-vs-type collisions.`,
    );
  }
});

test("CORPUS: identifierVariants recovery, circular vs non-circular", (ctx) => {
  const c = corpus();
  if (!c) return ctx.skip(CORPUS_ERR);
  const isType = (n) => [...c.kindOf.get(n)].some((k) => TYPE_KINDS.has(k));
  const typeNames = c.names.filter(isType);
  let circ = 0;
  for (const n of typeNames) if (identifierVariants(spokenWords(n)).includes(n)) circ++;
  // The non-circular half: the spoken form is NOT the splitter's output. Only
  // names carrying an abbreviation, an initialism, a digit or a single letter
  // qualify, because those are the names where "say the humps" is wrong.
  const SPOKEN = {
    mem: "memory", cfg: "config", conf: "config", idx: "index", buf: "buffer", len: "length", ptr: "pointer",
    msg: "message", req: "request", resp: "response", addr: "address", args: "arguments", arg: "argument",
    ctx: "context", db: "database", dir: "directory", err: "error", id: "identifier", impl: "implementation",
    num: "number", op: "operation", ops: "operations", pos: "position", prev: "previous", proto: "protocol",
    recv: "receive", ref: "reference", repr: "representation", seq: "sequence", spec: "specification",
    stat: "statistic", stats: "statistics", str: "string", sync: "synchronise", tmp: "temporary",
    tx: "transaction", txn: "transaction", util: "utility", utils: "utilities", val: "value", var: "variable",
    vec: "vector", cnt: "count", cur: "cursor", desc: "descriptor", dst: "destination", src: "source",
    elem: "element", env: "environment", ext: "extension", gen: "generate", info: "information", lib: "library",
    max: "maximum", min: "minimum", mgr: "manager", mut: "mutable", net: "network", obj: "object",
    param: "parameter", params: "parameters", perf: "performance", proc: "process", prop: "property",
    rand: "random", rx: "receiver", sig: "signature", sz: "size", tbl: "table", ts: "timestamp", ty: "type",
  };
  const DIGITS = { 2: "two", 3: "three", 4: "four", 8: "eight", 16: "sixteen", 32: "thirty two", 64: "sixty four" };
  const spellOut = (w) => w.split("").join(" ").toLowerCase();
  const nonCirc = [];
  for (const n of typeNames) {
    let changed = false;
    const spoken = spokenWords(n).map((w) => {
      const lw = w.toLowerCase();
      if (SPOKEN[lw] !== undefined) return (changed = true), SPOKEN[lw];
      if (/^[A-Z]{2,}$/.test(w)) return (changed = true), spellOut(w);
      if (/^[0-9]+$/.test(w) && DIGITS[w] !== undefined) return (changed = true), DIGITS[w];
      if (w.length === 1) return (changed = true), spellOut(w);
      return lw;
    });
    if (changed) nonCirc.push({ name: n, spoken: spoken.join(" ") });
  }
  let ncHit = 0;
  for (const { name, spoken } of nonCirc) if (identifierVariants(spokenWords(spoken)).includes(name)) ncHit++;
  console.log(
    `  CORPUS variants: type names=${typeNames.length}  CIRCULAR ${circ}/${typeNames.length} = ` +
      `${((100 * circ) / typeNames.length).toFixed(1)}%  |  NON-CIRCULAR ${ncHit}/${nonCirc.length} = ` +
      `${((100 * ncHit) / nonCirc.length).toFixed(1)}%`,
  );
  assert.equal(circ, typeNames.length, "the circular number the scout reported is 100%");
  // Not an assertion about the product being wrong, a floor so the number
  // cannot silently rot: the honest recovery rate is a fraction of the
  // circular one and the goal must not be read as if it were 100%.
  assert.ok(ncHit / nonCirc.length < 0.6, "if this ever passes 60% the non-circular claim needs re-reading");
});

// RE-AIMED at the LIVE path. This row used to grade `stripPlural`, and after
// amendment 17 nothing in the product calls it, so grading it alone would be
// measuring a dead function and reporting the number as the product's. Both are
// measured now: the superseded single strip stays as the BEFORE, and
// `matchByFold` is the after.
//
// The generator plays a developer saying an identifier's own words in the
// plural, so the true answer is always known and every outcome is gradeable:
// a correct hit, a refusal, or - the one that must be zero - a confident WRONG
// type.
test("CORPUS: the plural degrade, single strip against amendment 17's pair", (ctx) => {
  const c = corpus();
  if (!c) return ctx.skip(CORPUS_ERR);
  const typeNames = c.names.filter((n) => [...c.kindOf.get(n)].some((k) => TYPE_KINDS.has(k)));
  let total = 0;
  let oldOk = 0;
  let hit = 0;
  let refused = 0;
  const wrongType = [];
  const oldSample = [];
  for (const n of typeNames) {
    const words = spokenWords(n).map((w) => w.toLowerCase());
    if (words.length === 0 || !/[a-z]$/.test(words[words.length - 1])) continue;
    const last = words[words.length - 1];
    const spoken = [...words.slice(0, -1), /(?:s|x|z|ch|sh)$/.test(last) ? last + "es" : last + "s"];
    total++;
    const back = stripPlural(spoken);
    if (back !== undefined && foldName(back.join("")) === foldName(n)) {
      oldOk++;
    } else if (oldSample.length < 6) {
      oldSample.push(`${n} <- "${spoken.join(" ")}" -> ${back ? back.join(" ") : "undefined"}`);
    }
    const live = matchByFold(spoken.join(" "), typeNames);
    if (live === undefined) refused++;
    else if (live.identifier === n) hit++;
    else wrongType.push(`"${spoken.join(" ")}" (meant ${n}) -> ${live.identifier} [${live.match}]`);
  }
  const oldRate = (100 * (total - oldOk)) / total;
  console.log(
    `  CORPUS plural over ${total} pluralisable type names:\n` +
      `    SUPERSEDED stripPlural: ${total - oldOk}/${total} = ${oldRate.toFixed(1)}% degrade;  ${oldSample.join("; ")}\n` +
      `    LIVE matchByFold: hit ${hit} (${((100 * hit) / total).toFixed(1)}%)  refused ${refused} ` +
      `(${((100 * refused) / total).toFixed(1)}%)  WRONG ${wrongType.length}`,
  );
  // The BEFORE, kept as a floor so the improvement below cannot be read against
  // a number that quietly moved.
  assert.ok(oldRate > 10, `the single strip's silent-e class must still be large; measured ${oldRate.toFixed(1)}%`);
  // The AFTER. Amendment 17 recovers the whole class on this corpus, because
  // exactly one of the two strips reconstructs a declared name.
  assert.ok(
    hit > oldOk,
    `amendment 17 must recover names the single strip missed: single ${oldOk}, pair ${hit} of ${total}`,
  );
  // The one that must be zero, and it is the reason `plural` is still a guess.
  // A wrong answer here would be the product respelling a word the human said.
  assert.deepEqual(wrongType, [], "a strip that lands on a DIFFERENT real type is a confident wrong answer");
  // WHY `refused` IS ZERO ON THIS CORPUS, stated so the number is not read as a
  // property of the rule. A refusal needs BOTH strips to reach declared types,
  // which needs the corpus to hold `X` and `Xe` together. acme-db holds no
  // such pair - the review called that luck rather than a property, and it is.
  const keys = new Set(typeNames.map(foldName));
  const shapePairs = typeNames.filter((n) => keys.has(foldName(n) + "e"));
  assert.deepEqual(shapePairs, [], "no Plan/Plane pair in this corpus, which is why nothing refuses");
  assert.equal(refused, 0, "and so the refusal count is a fact about the corpus, not about the rule");
});

// ===========================================================================
// E. DEFECT 3. The type-level pin `PrefillLedgerViewIsPinned` does not pin.
//
// `type AssertTrue<T extends true> = T` cannot reject drift, because
// `PrefillLedgerMatchesView` evaluates to `never` when the two shapes differ,
// and `never` is assignable to EVERY type including `true`. So the constraint
// is satisfied and the build stays green. The comment beside it claims "an
// addition on either side is a build failure HERE"; this row adds a field on
// the producer side and runs the real `tsc --noEmit` over a copy of the tree.
// ===========================================================================

const os = require("os");
const { execFileSync } = require("child_process");

test("DEFECT 3: PrefillLedgerViewIsPinned does not fail the build when the two shapes drift", (ctx) => {
  const repo = path.resolve(__dirname, "..");
  const tsc = path.join(repo, "node_modules", ".bin", "tsc");
  if (!fs.existsSync(tsc)) return ctx.skip("SKIP LOUDLY: node_modules/.bin/tsc is absent, cannot run the pin check");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "adv-v52-p2-pin-"));
  const run = () => {
    try {
      execFileSync(tsc, ["--noEmit"], { cwd: tmp, stdio: "pipe" });
      return { code: 0, out: "" };
    } catch (e) {
      return { code: e.status ?? 1, out: String(e.stdout ?? "") + String(e.stderr ?? "") };
    }
  };
  try {
    fs.cpSync(path.join(repo, "src"), path.join(tmp, "src"), { recursive: true });
    fs.copyFileSync(path.join(repo, "tsconfig.json"), path.join(tmp, "tsconfig.json"));
    fs.symlinkSync(path.join(repo, "node_modules"), path.join(tmp, "node_modules"), "dir");

    const baseline = run();
    assert.equal(baseline.code, 0, `the copied tree must typecheck clean first, or this row proves nothing:\n${baseline.out}`);

    // Producer-side drift: one field added to `PrefillLedger` in fnGen.ts, and
    // supplied at the `onLedger` call so nothing else can complain about it.
    const fnGenPath = path.join(tmp, "src", "vscode", "fnGen.ts");
    let s = fs.readFileSync(fnGenPath, "utf8");
    const anchorIface = "  /** The rendered surface, byte-identical to the return value. */\n  surface: string;\n}";
    // The hand-over moved into a closure that both exits call (defect 2's fix),
    // so the call anchor is its object literal rather than the old inline one.
    const anchorCall = "      typeCap,\n      admitted,\n      surface,\n    });";
    assert.ok(s.includes(anchorIface), "fixture bug: PrefillLedger's surface field moved");
    assert.ok(s.includes(anchorCall), "fixture bug: the onLedger call site moved");
    s = s.replace(anchorIface, anchorIface.replace("}", "  driftedField: number;\n}"));
    s = s.replace(anchorCall, "      typeCap,\n      admitted,\n      surface,\n      driftedField: 1,\n    });");
    fs.writeFileSync(fnGenPath, s);

    const drifted = run();
    assert.notEqual(
      drifted.code,
      0,
      "a field added to PrefillLedger and absent from PrefillLedgerView is exactly the drift the pin claims to catch, " +
        "and `tsc --noEmit` is still clean. `never` satisfies `T extends true`, so AssertTrue<never> is legal. " +
        "Fix: make PrefillLedgerMatchesView yield `false` instead of `never` on a mismatch.",
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

function mulberry(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

module.exports = { mulberry };
