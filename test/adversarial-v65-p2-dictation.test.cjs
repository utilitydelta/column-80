// Adversarial rows for session-v65 phase 2: the headless dictation core.
// Companion to test/blind-v65-p2-dictation.test.cjs (which stays green).
// Each row below is a claim about the implementation or the contract
// (session-v65/contracts/phase2-core.md); a FAILING row is evidence, kept on
// purpose. Rows marked "documenting" pass and pin a behaviour worth knowing.
// Verdicts and severities live in the review, not here.
//
// Run: SKIP_LIVE=1 node --test test/adversarial-v65-p2-dictation.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "adversarial-v65-p2-dictation",
  'export { cleanTranscript, backtickSpokenNames, virtualComment, partialWindow, wavHeader, timingLine, refusalSentence } from "../src/core/dictation";\n'
);
const { cleanTranscript, backtickSpokenNames, virtualComment, wavHeader, timingLine } = mod;
test.after(cleanup);

const NAMES = ["ShardMemCache", "Tile", "enroll_tile", "Lease"];

// ---- backtickSpokenNames

test("A1 rule 1: a non-ASCII letter is treated as punctuation, so the tick lands inside the word", () => {
  // Contract rule 1 ignores "characters that are not letters or digits"; é and ü are letters.
  // The implementation's core regex is ASCII-only, so "café" has core "caf" with the é kept
  // OUTSIDE the ticks, and "über" has core "ber": the user said "über tile", the matcher heard "ber tile".
  // RULED in triage: a word carrying a non-ASCII letter never matches, because the fold is
  // ASCII-only by design; so "café" is left alone rather than ticked with the é outside.
  const r1 = backtickSpokenNames("please visit café now", ["VisitCaf"]);
  assert.strictEqual(r1.text, "please visit café now", "a non-ASCII word is never matched");
  assert.deepStrictEqual(r1.matched, []);
  const r2 = backtickSpokenNames("call über tile now", ["ber_tile"]);
  assert.deepStrictEqual(r2.matched, [], "'über' is not the word 'ber'");
});

test("A2 rule 4: the one-word refusal counts whitespace tokens, so a stray dash makes a one-word utterance a sentence", () => {
  // "- " is a token with an empty core; it cannot match anything, but it is counted as a word.
  const r = backtickSpokenNames("- Lease.", NAMES);
  assert.strictEqual(r.text, "- `Lease`.");
  assert.deepStrictEqual(r.refused, []);
});

test("A3 rule 1+4: a hyphenated compound heard as one token is refused as a one-word match", () => {
  // Whisper hyphenates compounds (12 of 949 real transcripts in spikes/asr/transcripts.json:
  // "multi-shard state", "pre-computed map", "leader-right progress"). When the hyphen swallows
  // the whole name the fold still matches but the window is one whitespace token.
  const r = backtickSpokenNames("Put it in the multi-shard.", ["MultiShard"]);
  assert.strictEqual(r.text, "Put it in the `MultiShard`.");
  assert.deepStrictEqual(r.refused, []);
});

test("A4 rule 6+7: an unmatched backtick leading a matched word yields three ticks in a row", () => {
  // Contract rule 7 says ignored leading characters stay outside the ticks; a lone backtick is such a
  // character, so the rule itself manufactures ``lease_broker` which tightenTokens then pairs wrongly.
  const r = backtickSpokenNames("the `lease broker now", ["lease_broker"]);
  assert.ok(!r.text.includes("``"), `text is ${JSON.stringify(r.text)}`);
});

test("A5 rule 5: a whitespace-padded duplicate of a name is a distinct collider and poisons the key", () => {
  // The contract calls `names` "the identifier population" but never says bare identifiers; the
  // vscode layer feeding symbolName text with a trailing space makes every such name ambiguous.
  const r = backtickSpokenNames("Lease", ["Lease", "Lease "]);
  assert.strictEqual(r.text, "`Lease`");
  assert.deepStrictEqual(r.refused, []);
});

test("A6 rule 4+5 ordering: a plain one-word window inside a sentence is reported ambiguous rather than one-token", () => {
  // Both readings are contract-consistent; the row pins which reason wins so the channel line is honest.
  // A word that could never tick mid-sentence is told "ambiguous Set | set", which invites the user to
  // disambiguate something the one-token rule would refuse anyway.
  const r = backtickSpokenNames("Add it to the set.", ["Set", "set"]);
  assert.deepStrictEqual(r.refused.map((x) => x.reason), ["one-token-in-sentence"]);
});

test("A7 rule 4 dedupe: 'Lease' and 'lease' are one refusal (RULED in triage: the phrase is folded to lower case for the dedupe)", () => {
  // The review read "distinct phrase" as case-sensitive; the contract now says the dedupe key
  // is the phrase folded to lower case, so one word spoken twice is one channel line.
  const r = backtickSpokenNames("Lease the tile, then lease it again.", NAMES);
  const phrases = r.refused.filter((x) => x.identifier === "Lease").map((x) => x.phrase);
  assert.deepStrictEqual(phrases, ["Lease"]);
});

test("A8 documenting: tabs, runs of spaces and an astral character before the window keep offsets honest", () => {
  const input = "🙂 put\t\tit  in the shard \t mem   cache.";
  const r = backtickSpokenNames(input, NAMES);
  assert.strictEqual(r.matched.length, 1);
  assert.strictEqual(r.matched[0].start, input.indexOf("shard"));
  assert.strictEqual(r.matched[0].end, input.indexOf("cache") + 5);
  assert.strictEqual(r.matched[0].phrase, "shard mem cache", "phrase is single-spaced regardless of input spacing");
  assert.strictEqual(r.text, "🙂 put\t\tit  in the `ShardMemCache`.");
});

test("A9 documenting: digits fold as themselves, so 'u 32' matches u32 and 'v 2' matches v2", () => {
  assert.strictEqual(backtickSpokenNames("cast it to u 32 here", ["u32"]).text, "cast it to `u32` here");
  assert.strictEqual(backtickSpokenNames("return a v 2 vector", ["v2"]).text, "return a `v2` vector");
  assert.deepStrictEqual(backtickSpokenNames("cast it to u thirty two here", ["u32"]).matched, []);
});

test("A10 documenting: 'tile tile' claims leftmost pair; a window straddling a ticked span never matches", () => {
  const r = backtickSpokenNames("tile tile tile", ["Tile", "tile_tile"]);
  assert.strictEqual(r.text, "`tile_tile` tile");
  assert.deepStrictEqual(r.refused, [{ phrase: "tile", identifier: "Tile", reason: "one-token-in-sentence" }]);
  const s = backtickSpokenNames("put `the shard` mem cache", NAMES);
  assert.deepStrictEqual(s.matched, []);
  assert.strictEqual(s.text, "put `the shard` mem cache");
});

test("A11 documenting: an empty-core token inside a window breaks the window", () => {
  // Contract silent. Pinned: "enroll - tile" does not match enroll_tile.
  const r = backtickSpokenNames("Call enroll - tile on it.", NAMES);
  assert.deepStrictEqual(r.matched, []);
});

test("A12 performance: 300 words against 5000 names is well under 20ms", () => {
  const vocab = ["shard", "mem", "cache", "tile", "lease", "stripe", "broker", "loader", "walk", "hand", "warm", "render"];
  const names = [];
  for (let i = 0; i < 5000; i++) {
    const a = vocab[i % vocab.length];
    const b = vocab[(i * 7) % vocab.length];
    names.push(`${a}_${b}_${i}`);
  }
  names.push("ShardMemCache");
  const words = [];
  for (let i = 0; i < 300; i++) {
    words.push(vocab[(i * 5) % vocab.length]);
  }
  words[150] = "shard"; words[151] = "mem"; words[152] = "cache";
  const sentence = words.join(" ") + ".";
  backtickSpokenNames(sentence, names);
  const t0 = process.hrtime.bigint();
  const runs = 20;
  let r;
  for (let i = 0; i < runs; i++) {
    r = backtickSpokenNames(sentence, names);
  }
  const perCallMs = Number(process.hrtime.bigint() - t0) / 1e6 / runs;
  assert.ok(r.matched.some((m) => m.identifier === "ShardMemCache"));
  console.log(`A12 per call: ${perCallMs.toFixed(3)}ms`);
  assert.ok(perCallMs < 20, `${perCallMs}ms`);
});

// ---- cleanTranscript

test("B1 rule 5+9: a leading full stop is dropped even when no filler was removed", () => {
  // Rule 5 drops a leading , or . "left behind by a removed filler". Nothing was removed here.
  assert.strictEqual(cleanTranscript("... then retry the call").sentence, "... then retry the call.");
  assert.deepStrictEqual(cleanTranscript("..."), { sentence: "", stripped: [] }, "a sentence of dots is nothing");
});

test("B2 rule 4: a filler with whisper's ellipsis is not a filler", () => {
  // Rule 4 allows one trailing , or . on the filler. Whisper writes hesitations as "Um..." and
  // "Uh...". The TTS corpus in spikes/asr has no fillers at all, so it cannot witness either way.
  assert.deepStrictEqual(cleanTranscript("um... retry the call"), { sentence: "Retry the call.", stripped: ["um..."] });
});

test("B3 rule 3 vs 9: any parenthesised word is a noise marker, so a spoken aside is dropped", () => {
  assert.strictEqual(cleanTranscript("use the fast (unsafe) path").sentence, "Use the fast (unsafe) path.");
  assert.strictEqual(cleanTranscript("call f() now").sentence, "Call f() now.");
});

test("B4 rule 3: whisper's music glyph is not a marker, so a music-only take becomes a comment", () => {
  assert.deepStrictEqual(cleanTranscript("♪ ♪"), { sentence: "", stripped: ["♪", "♪"] });
});

test("B5 rule 6+9: upper-casing the first character can respell the word", () => {
  // JS toUpperCase maps ß to SS; rule 9 says words are never respelled.
  assert.strictEqual(cleanTranscript("ßtraße").sentence, "ßtraße.");
});

test("B6 documenting: markers glued to words, nested parens, lone paren, filler-only, trailing comma after a filler", () => {
  assert.deepStrictEqual(cleanTranscript("[BLANK_AUDIO]retry the[Music]call"), { sentence: "Retry the call.", stripped: ["[BLANK_AUDIO]", "[Music]"] });
  // RULED in triage: the marker list is closed, so `(b)` is the user's aside and stays.
  assert.deepStrictEqual(cleanTranscript("(a (b) c) retry"), { sentence: "(a (b) c) retry.", stripped: [] });
  assert.deepStrictEqual(cleanTranscript("retry ( the call"), { sentence: "Retry ( the call.", stripped: [] });
  assert.deepStrictEqual(cleanTranscript("Er"), { sentence: "", stripped: ["Er"] });
  assert.deepStrictEqual(cleanTranscript("retry the call, um"), { sentence: "Retry the call.", stripped: ["um"] });
  assert.deepStrictEqual(cleanTranscript("[inaudible] retry [laughs]"), { sentence: "Retry.", stripped: ["[inaudible]", "[laughs]"] });
  assert.strictEqual(cleanTranscript("élan vital").sentence, "Élan vital.");
  assert.strictEqual(cleanTranscript("\"retry\" the call").sentence, "\"retry\" the call.");
  assert.strictEqual(cleanTranscript("retry the call...").sentence, "Retry the call...");
});

// ---- virtualComment

test("C1 documenting: the token per language, including ids the blind suite did not name", () => {
  const table = { shellscript: "#", typescriptreact: "//", javascriptreact: "//", c: "//", cpp: "//", rust: "//", sql: "--", lua: "--", haskell: "--", clojure: ";", bash: "#" };
  for (const [lang, tok] of Object.entries(table)) {
    assert.strictEqual(virtualComment("Retry the call.", lang), `${tok} Retry the call.`, lang);
  }
  assert.strictEqual(virtualComment("Retry the call.", "css"), undefined, "no line token");
});

test("C2 rule 3+4: a newline inside a backticked span produces a line without the comment token", () => {
  // Unreachable from cleanTranscript (rule 2 collapses whitespace) but the function is declared total.
  const out = virtualComment("see `a\nb` now", "rust");
  for (const line of out.split("\n")) {
    assert.ok(line.startsWith("// "), JSON.stringify(line));
  }
});

test("C3 documenting: a backticked span wider than the floor budget stands alone; huge or fractional indents floor at 20", () => {
  const span = "`" + "x".repeat(30) + " " + "y".repeat(30) + "`";
  const out = virtualComment(`a ${span} b.`, "rust", 1e9);
  assert.deepStrictEqual(out.split("\n"), ["// a", `// ${span}`, "// b."]);
  assert.strictEqual(virtualComment("a b", "rust", 60.9), "// a b");
  assert.strictEqual(virtualComment("a b", "rust", -5), "// a b");
});

// ---- timingLine

test("D1: the take's one decimal is not half-up rounding", () => {
  // 6350ms and 6450ms are both exactly half; toFixed decides by binary representation.
  assert.ok(timingLine({ takeMs: 6450, decodeMs: 1 }).includes("take=6.5s"));
  assert.ok(timingLine({ takeMs: 6350, decodeMs: 1 }).includes("take=6.4s"), timingLine({ takeMs: 6350, decodeMs: 1 }));
});

test("D2: a null optional is printed as 0ms instead of omitted", () => {
  assert.strictEqual(timingLine({ pressToFirstBufferMs: null, takeMs: 1000, decodeMs: 5 }), "[dictate] timings take=1.0s decode=5ms");
});

test("D3: an absurd take renders in exponent notation", () => {
  const line = timingLine({ takeMs: 1e24, decodeMs: 5 });
  assert.ok(!/e\+/.test(line), line);
});

test("D4 documenting: NaN, negative and infinite inputs render as 0", () => {
  assert.strictEqual(timingLine({ pressToFirstBufferMs: NaN, takeMs: -100, decodeMs: Infinity, fimMs: -Infinity }), "[dictate] timings press-to-first-buffer=0ms take=0.0s decode=0ms fim=0ms");
});

// ---- wavHeader

test("E1: a PCM length past the u32 field wraps silently to a tiny header", () => {
  const big = wavHeader(2 ** 32 + 100);
  const view = new DataView(big.buffer);
  assert.notStrictEqual(view.getUint32(40, true), 100, "data size field wrapped modulo 2^32");
});
