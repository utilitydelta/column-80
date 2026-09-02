// Blind oracle for session-v65 phase 2: the headless dictation core.
// Bound to session-v65/contracts/phase2-core.md rule by rule. Written before
// src/core/dictation.ts existed; nothing here reads src/**. Where the contract
// leaves a reading open, a one-line comment says which reading is pinned.
//
// Run: SKIP_LIVE=1 node --test test/blind-v65-p2-dictation.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "blind-v65-p2-dictation",
  'export { cleanTranscript, backtickSpokenNames, virtualComment, partialWindow, wavHeader, timingLine, refusalSentence } from "../src/core/dictation";\n'
);
const { cleanTranscript, backtickSpokenNames, virtualComment, partialWindow, wavHeader, timingLine, refusalSentence } = mod;
test.after(cleanup);

const EMPTY_CLEAN = { sentence: "", stripped: [] };
const FILLERS = ["um", "umm", "uh", "uhh", "er", "erm", "ah", "hmm", "mm", "hm"];

// ---- cleanTranscript

test("cleanTranscript rule 1: non-string, empty and whitespace-only input is the empty result", () => {
  for (const bad of [undefined, null, 42, ["set the field"], { sentence: "x" }, true, "", " ", "\n", " \t\n  "]) {
    assert.deepStrictEqual(cleanTranscript(bad), EMPTY_CLEAN, `input ${JSON.stringify(bad)}`);
  }
});

test("cleanTranscript rule 2: whitespace runs and whisper newlines collapse to one space, trimmed", () => {
  assert.deepStrictEqual(cleanTranscript("  set   the\nmin\n\nand \t max  "), {
    sentence: "Set the min and max.",
    stripped: [],
  });
});

test("cleanTranscript example: ' set the min, and max fields\\n'", () => {
  assert.deepStrictEqual(cleanTranscript(" set the min, and max fields\n"), {
    sentence: "Set the min, and max fields.",
    stripped: [],
  });
});

test("cleanTranscript rule 3: square and round bracket markers are removed and recorded in order", () => {
  assert.deepStrictEqual(cleanTranscript("[Music] retry the call [BLANK_AUDIO]"), {
    sentence: "Retry the call.",
    stripped: ["[Music]", "[BLANK_AUDIO]"],
  });
  assert.deepStrictEqual(cleanTranscript("(upbeat music) retry the call"), {
    sentence: "Retry the call.",
    stripped: ["(upbeat music)"],
  });
});

test("cleanTranscript rule 3: a bracket group with other characters inside stays", () => {
  assert.deepStrictEqual(cleanTranscript("call f(x, y) then read g[i-1]"), {
    sentence: "Call f(x, y) then read g[i-1].",
    stripped: [],
  });
});

test("cleanTranscript rule 4: every listed filler is removed when it stands alone", () => {
  for (const f of FILLERS) {
    assert.deepStrictEqual(cleanTranscript(`${f} retry the call`), {
      sentence: "Retry the call.",
      stripped: [f],
    }, `filler ${f}`);
  }
});

test("cleanTranscript example: 'um, retry the call' strips 'um,'", () => {
  assert.deepStrictEqual(cleanTranscript("um, retry the call"), {
    sentence: "Retry the call.",
    stripped: ["um,"],
  });
});

test("cleanTranscript rule 4: case-insensitive, a trailing full stop goes with the filler, umbrella is not um", () => {
  // Reading: `stripped` records the word as spoken, so the capital survives there.
  assert.deepStrictEqual(cleanTranscript("Um retry the call"), { sentence: "Retry the call.", stripped: ["Um"] });
  assert.deepStrictEqual(cleanTranscript("retry the call uh. now"), { sentence: "Retry the call now.", stripped: ["uh."] });
  assert.deepStrictEqual(cleanTranscript("erase the umbrella ahead"), { sentence: "Erase the umbrella ahead.", stripped: [] });
});

test("cleanTranscript rule 5: re-collapsed after removal, a leading comma left by a filler is dropped", () => {
  const mid = cleanTranscript("retry um the call");
  assert.strictEqual(mid.sentence, "Retry the call.");
  assert.ok(!mid.sentence.includes("  "), "no double space where the filler was");
  assert.deepStrictEqual(cleanTranscript("um , retry the call"), { sentence: "Retry the call.", stripped: ["um"] });
});

test("cleanTranscript rule 6: only the first letter is upper-cased; a non-letter first character is left alone", () => {
  assert.strictEqual(cleanTranscript("set the MAX field on fooBar").sentence, "Set the MAX field on fooBar.");
  assert.strictEqual(cleanTranscript("42 tiles per stripe").sentence, "42 tiles per stripe.");
  assert.strictEqual(cleanTranscript("`tile` count").sentence, "`tile` count.");
});

test("cleanTranscript rule 7: a sentence ending in . ! or ? is left alone (example: 'loop over the tiles?')", () => {
  assert.strictEqual(cleanTranscript("retry the call.").sentence, "Retry the call.");
  assert.strictEqual(cleanTranscript("retry the call!").sentence, "Retry the call!");
  assert.strictEqual(cleanTranscript("loop over the tiles?").sentence, "Loop over the tiles?");
});

test("cleanTranscript rule 7: a trailing , ; or : becomes a full stop; otherwise one is appended", () => {
  for (const p of [",", ";", ":", ""]) {
    assert.strictEqual(cleanTranscript(`retry the call${p}`).sentence, "Retry the call.", `ending ${JSON.stringify(p)}`);
  }
});

test("cleanTranscript example: ' [BLANK_AUDIO]\\n' is empty with the marker stripped", () => {
  assert.deepStrictEqual(cleanTranscript(" [BLANK_AUDIO]\n"), {
    sentence: "",
    stripped: ["[BLANK_AUDIO]"],
  });
});

test("cleanTranscript rule 8: only fillers and markers leaves an empty sentence with no full stop", () => {
  assert.deepStrictEqual(cleanTranscript("um uh, hmm."), { sentence: "", stripped: ["um", "uh,", "hmm."] });
  // Reading: rules 3 and 4 each say "in order" but not how the two lists interleave, so
  // the mixed case pins the set, not the sequence.
  const mixed = cleanTranscript("[Music] um (upbeat music) uh");
  assert.strictEqual(mixed.sentence, "");
  assert.deepStrictEqual(mixed.stripped.slice().sort(), ["(upbeat music)", "[Music]", "uh", "um"]);
});

test("cleanTranscript rule 9: words are never respelled, reordered or dropped", () => {
  assert.strictEqual(cleanTranscript("teh quikc brwn fox jumps").sentence, "Teh quikc brwn fox jumps.");
});

// ---- backtickSpokenNames

const NAMES = ["ShardMemCache", "Tile", "enroll_tile", "Lease"];
const EMPTY_TICK = { text: "", matched: [], refused: [] };

test("backtickSpokenNames example: the stripe sentence ticks ShardMemCache and does not refuse tiles", () => {
  const input = "Loop over the tiles in the stripe and put each one in the shard mem cache.";
  const r = backtickSpokenNames(input, NAMES);
  assert.strictEqual(r.text, "Loop over the tiles in the stripe and put each one in the `ShardMemCache`.");
  const start = input.indexOf("shard mem cache");
  assert.deepStrictEqual(r.matched, [
    { phrase: "shard mem cache", identifier: "ShardMemCache", start, end: start + "shard mem cache".length },
  ]);
  assert.deepStrictEqual(r.refused, []);
});

test("backtickSpokenNames example: 'Renew the lease.' is refused as one token in a sentence", () => {
  const r = backtickSpokenNames("Renew the lease.", NAMES);
  assert.strictEqual(r.text, "Renew the lease.");
  assert.deepStrictEqual(r.matched, []);
  assert.deepStrictEqual(r.refused, [{ phrase: "lease", identifier: "Lease", reason: "one-token-in-sentence" }]);
});

test("backtickSpokenNames example: the one-word sentence 'Lease' is ticked", () => {
  const r = backtickSpokenNames("Lease", NAMES);
  assert.strictEqual(r.text, "`Lease`");
  assert.deepStrictEqual(r.matched, [{ phrase: "Lease", identifier: "Lease", start: 0, end: 5 }]);
  assert.deepStrictEqual(r.refused, []);
});

test("backtickSpokenNames example: 'Call enroll tile on it.' ticks enroll_tile", () => {
  const r = backtickSpokenNames("Call enroll tile on it.", NAMES);
  assert.strictEqual(r.text, "Call `enroll_tile` on it.");
  assert.deepStrictEqual(r.matched, [{ phrase: "enroll tile", identifier: "enroll_tile", start: 5, end: 16 }]);
  // Reading: "tile" is claimed by the longer window, so it is not a one-word refusal.
  assert.deepStrictEqual(r.refused, []);
});

test("backtickSpokenNames rule 1: leading and trailing punctuation stays outside the ticks", () => {
  const input = "Put it in (shard mem cache).";
  const r = backtickSpokenNames(input, NAMES);
  assert.strictEqual(r.text, "Put it in (`ShardMemCache`).");
  assert.strictEqual(r.matched.length, 1);
  assert.strictEqual(r.matched[0].start, input.indexOf("shard"));
  assert.strictEqual(r.matched[0].end, input.indexOf("cache)") + "cache".length);
  assert.strictEqual(r.matched[0].phrase, "shard mem cache");
});

test("backtickSpokenNames rule 2: the fold drops case and non-alphanumerics", () => {
  assert.strictEqual(backtickSpokenNames("Shard-Mem-Cache", NAMES).text, "`ShardMemCache`");
  assert.strictEqual(backtickSpokenNames("SHARD mem Cache", NAMES).text, "`ShardMemCache`");
  assert.strictEqual(backtickSpokenNames("Call Enroll Tile now.", NAMES).text, "Call `enroll_tile` now.");
});

test("backtickSpokenNames rule 2: no plural stripping and no edit distance", () => {
  assert.deepStrictEqual(backtickSpokenNames("Renew the leases.", NAMES), { text: "Renew the leases.", matched: [], refused: [] });
  assert.deepStrictEqual(backtickSpokenNames("Put it in the shard mem cach.", NAMES), { text: "Put it in the shard mem cach.", matched: [], refused: [] });
});

test("backtickSpokenNames rule 2: a window is at most six words", () => {
  const names = ["one_two_three_four_five_six", "one_two_three_four_five_six_seven"];
  const six = backtickSpokenNames("one two three four five six", names);
  assert.strictEqual(six.text, "`one_two_three_four_five_six`");
  assert.strictEqual(six.matched.length, 1);
  const seven = backtickSpokenNames("one two three four five six seven", names);
  assert.strictEqual(seven.text, "`one_two_three_four_five_six` seven");
  assert.strictEqual(seven.matched[0].identifier, "one_two_three_four_five_six");
});

test("backtickSpokenNames rule 3: longest window wins whatever the names order; equal lengths go leftmost", () => {
  const longest = backtickSpokenNames("Call enroll tile on it.", ["Tile", "enroll_tile"]);
  assert.strictEqual(longest.text, "Call `enroll_tile` on it.");
  assert.deepStrictEqual(longest.matched.map((m) => m.identifier), ["enroll_tile"]);
  const leftmost = backtickSpokenNames("take the read lock file now", ["read_lock", "lock_file"]);
  assert.strictEqual(leftmost.text, "take the `read_lock` file now");
  assert.deepStrictEqual(leftmost.matched.map((m) => m.identifier), ["read_lock"]);
  assert.deepStrictEqual(leftmost.refused, []);
});

test("backtickSpokenNames rule 4: one-word refusals are recorded once per distinct (phrase, identifier)", () => {
  const twice = "Renew the lease, then renew the lease.";
  const r1 = backtickSpokenNames(twice, NAMES);
  assert.strictEqual(r1.text, twice);
  assert.deepStrictEqual(r1.matched, []);
  assert.deepStrictEqual(r1.refused, [{ phrase: "lease", identifier: "Lease", reason: "one-token-in-sentence" }]);
  const two = "Renew the lease on the tile.";
  const r2 = backtickSpokenNames(two, NAMES);
  assert.strictEqual(r2.text, two);
  assert.deepStrictEqual(r2.matched, []);
  assert.deepStrictEqual(r2.refused.slice().sort((a, b) => a.phrase.localeCompare(b.phrase)), [
    { phrase: "lease", identifier: "Lease", reason: "one-token-in-sentence" },
    { phrase: "tile", identifier: "Tile", reason: "one-token-in-sentence" },
  ]);
});

test("backtickSpokenNames rule 4: a one-word sentence with trailing punctuation still matches", () => {
  const r = backtickSpokenNames("Lease.", NAMES);
  assert.strictEqual(r.text, "`Lease`.");
  assert.deepStrictEqual(r.matched, [{ phrase: "Lease", identifier: "Lease", start: 0, end: 5 }]);
  assert.deepStrictEqual(r.refused, []);
});

test("backtickSpokenNames rule 5: two distinct identifiers sharing a fold make the window ambiguous", () => {
  const names = ["ClientSet", "client_set", "Lease"];
  const input = "Add it to the client set.";
  const r = backtickSpokenNames(input, names);
  assert.strictEqual(r.text, input);
  assert.deepStrictEqual(r.matched, []);
  // Contract gap: NameRefusal has one `identifier` field, and rule 5 does not say which of the
  // colliding identifiers it names. Pinned only that it names a collider; reason and phrase are exact.
  assert.ok(r.refused.length >= 1, "at least one refusal");
  for (const ref of r.refused) {
    assert.strictEqual(ref.reason, "ambiguous");
    assert.strictEqual(ref.phrase, "client set");
    assert.strictEqual(typeof ref.identifier, "string");
    assert.ok(["ClientSet", "client_set"].some((n) => ref.identifier.includes(n)), ref.identifier);
  }
});

test("backtickSpokenNames rule 5: an ambiguous key does not poison other names; identical strings are one identifier", () => {
  const other = backtickSpokenNames("Lease", ["ClientSet", "client_set", "Lease"]);
  assert.strictEqual(other.text, "`Lease`");
  assert.deepStrictEqual(other.refused, []);
  const dup = backtickSpokenNames("Lease", ["Lease", "Lease"]);
  assert.strictEqual(dup.text, "`Lease`");
  assert.strictEqual(dup.matched.length, 1);
  assert.deepStrictEqual(dup.refused, []);
});

test("backtickSpokenNames rule 6: words already inside backticks are not re-ticked", () => {
  // Reading: a span that is never re-matched is never refused either.
  for (const input of ["Put it in `ShardMemCache` now.", "Put it in `shard mem cache` now."]) {
    assert.deepStrictEqual(backtickSpokenNames(input, NAMES), { text: input, matched: [], refused: [] }, input);
  }
});

test("backtickSpokenNames rule 6: a fresh occurrence outside an existing span is still ticked", () => {
  const input = "Move `ShardMemCache` into the shard mem cache.";
  const r = backtickSpokenNames(input, NAMES);
  assert.strictEqual(r.text, "Move `ShardMemCache` into the `ShardMemCache`.");
  assert.strictEqual(r.matched.length, 1);
  assert.strictEqual(r.matched[0].start, input.lastIndexOf("shard mem cache"));
});

test("backtickSpokenNames rule 7: every occurrence is replaced with one matched entry each", () => {
  const input = "Call enroll tile then enroll tile again.";
  const r = backtickSpokenNames(input, NAMES);
  assert.strictEqual(r.text, "Call `enroll_tile` then `enroll_tile` again.");
  const second = input.lastIndexOf("enroll tile");
  assert.deepStrictEqual(r.matched, [
    { phrase: "enroll tile", identifier: "enroll_tile", start: 5, end: 16 },
    { phrase: "enroll tile", identifier: "enroll_tile", start: second, end: second + 11 },
  ]);
});

test("backtickSpokenNames rule 7: the identifier's own spelling is used", () => {
  assert.strictEqual(backtickSpokenNames("SHARD MEM CACHE", NAMES).text, "`ShardMemCache`");
  assert.strictEqual(backtickSpokenNames("Call ENROLL TILE now.", NAMES).text, "Call `enroll_tile` now.");
});

test("backtickSpokenNames rule 8: empty names, empty sentence, or non-string sentence", () => {
  assert.deepStrictEqual(backtickSpokenNames("Renew the lease.", []), { text: "Renew the lease.", matched: [], refused: [] });
  assert.deepStrictEqual(backtickSpokenNames("", NAMES), EMPTY_TICK);
  for (const bad of [undefined, null, 42, ["Lease"], { text: "Lease" }]) {
    assert.deepStrictEqual(backtickSpokenNames(bad, NAMES), EMPTY_TICK, `sentence ${JSON.stringify(bad)}`);
  }
});

test("backtickSpokenNames rule 8: a malformed names argument never throws", () => {
  // Reading: a names value that is not an array reads as empty names.
  for (const bad of [undefined, null, 42, "Lease", { 0: "Lease" }]) {
    assert.deepStrictEqual(backtickSpokenNames("Renew the lease.", bad), { text: "Renew the lease.", matched: [], refused: [] }, `names ${JSON.stringify(bad)}`);
  }
  let r;
  assert.doesNotThrow(() => { r = backtickSpokenNames("Lease", ["Lease", 42, null, undefined, {}]); });
  assert.strictEqual(typeof r.text, "string");
  assert.ok(Array.isArray(r.matched) && Array.isArray(r.refused));
});

// ---- virtualComment

const W30 = "The stripe loader walks every tile in the shard and hands each one to the `Lease Broker` before the cache warms so the ghost can render the next line again.";
const AAAA = (n) => Array(n).fill("aaaa");

test("virtualComment examples: rust is '// Retry the call.' and python is '# Retry the call.'", () => {
  assert.strictEqual(virtualComment("Retry the call.", "rust"), "// Retry the call.");
  assert.strictEqual(virtualComment("Retry the call.", "python"), "# Retry the call.");
});

test("virtualComment rule 1: the shortest line-comment opener per language, never ///", () => {
  const table = { rust: "//", go: "//", csharp: "//", typescript: "//", javascript: "//", python: "#", ruby: "#", lua: "--", sql: "--" };
  for (const [lang, tok] of Object.entries(table)) {
    const out = virtualComment("Retry the call.", lang);
    assert.strictEqual(out, `${tok} Retry the call.`, lang);
    assert.ok(!out.includes("///"), lang);
  }
  // Reading: VS Code's languageId for shell is "shellscript"; "shell" is accepted as an alias.
  const shell = ["shellscript", "shell"].map((l) => virtualComment("Retry the call.", l));
  assert.ok(shell.includes("# Retry the call."), JSON.stringify(shell));
});

test("virtualComment rule 1: a languageId with no row returns undefined", () => {
  for (const lang of ["klingon", "", "plaintext-nope", undefined, null, 42, ["rust"]]) {
    assert.strictEqual(virtualComment("Retry the call.", lang), undefined, `lang ${JSON.stringify(lang)}`);
  }
});

test("virtualComment rule 2: empty, whitespace-only or non-string sentence returns undefined", () => {
  for (const s of ["", " ", "\n\t ", undefined, null, 42, ["Retry the call."]]) {
    assert.strictEqual(virtualComment(s, "rust"), undefined, `sentence ${JSON.stringify(s)}`);
  }
});

test("virtualComment rule 3: greedy fill to 80 columns at indent 0", () => {
  const out = virtualComment(AAAA(30).join(" "), "rust");
  assert.deepStrictEqual(out.split("\n"), ["// " + AAAA(15).join(" "), "// " + AAAA(15).join(" ")]);
  for (const line of out.split("\n")) assert.ok(line.length <= 80, line.length);
});

test("virtualComment rule 3: the budget shrinks by indentColumns", () => {
  const out = virtualComment(AAAA(30).join(" "), "rust", 8);
  assert.deepStrictEqual(out.split("\n"), [
    "// " + AAAA(14).join(" "),
    "// " + AAAA(14).join(" "),
    "// " + AAAA(2).join(" "),
  ]);
  for (const line of out.split("\n")) assert.ok(line.length <= 72, line.length);
});

test("virtualComment rule 3: the budget never drops below 20", () => {
  const out = virtualComment(AAAA(6).join(" "), "rust", 100);
  assert.deepStrictEqual(out.split("\n"), ["// aaaa aaaa aaaa", "// aaaa aaaa aaaa"]);
  for (const line of out.split("\n")) assert.ok(line.length <= 20, line.length);
});

test("virtualComment rule 3: a backticked span is one token and never splits across lines", () => {
  // 14 words fill 72 columns; "`aaaa" alone would fit, the whole span does not.
  const sentence = [...AAAA(14), "`aaaa aaaa`", "aaaa."].join(" ");
  const out = virtualComment(sentence, "rust");
  assert.deepStrictEqual(out.split("\n"), ["// " + AAAA(14).join(" "), "// `aaaa aaaa` aaaa."]);
});

test("virtualComment rule 3: a single word longer than the budget stands alone on its line", () => {
  const long = "x".repeat(90);
  const out = virtualComment(`start ${long} end.`, "rust");
  assert.deepStrictEqual(out.split("\n"), ["// start", `// ${long}`, "// end."]);
});

test("virtualComment rule 3: a thirty-word sentence with a backticked span, rust and python, indent 0 and 8", () => {
  assert.strictEqual(W30.split(" ").length, 30, "fixture is thirty words");
  for (const [lang, tok] of [["rust", "//"], ["python", "#"]]) {
    for (const indent of [0, 8]) {
      const out = virtualComment(W30, lang, indent);
      const lines = out.split("\n");
      const label = `${lang} indent ${indent}`;
      assert.ok(lines.length >= 2, `${label}: wraps`);
      for (const line of lines) {
        assert.ok(line.length <= 80 - indent, `${label}: ${line.length} > ${80 - indent}: ${line}`);
        assert.ok(line.startsWith(`${tok} `), `${label}: ${line}`);
      }
      assert.strictEqual(lines.filter((l) => l.includes("`Lease Broker`")).length, 1, `${label}: span intact on one line`);
    }
  }
});

test("virtualComment example: a thirty-word sentence in rust at indent 8 wraps to at most 72 columns", () => {
  const lines = virtualComment(W30, "rust", 8).split("\n");
  assert.ok(lines.length >= 2);
  for (const line of lines) assert.ok(line.length <= 72, line);
});

test("virtualComment rule 4: lines join with newline, no leading indent, no trailing newline", () => {
  const out = virtualComment(W30, "rust", 8);
  assert.ok(out.includes("\n"));
  assert.ok(!out.includes("\r"));
  assert.ok(!out.endsWith("\n"));
  for (const line of out.split("\n")) assert.ok(line.startsWith("//"), `no leading indent: ${JSON.stringify(line)}`);
});

test("virtualComment rule 5: words are never changed", () => {
  const out = virtualComment(W30, "python", 8);
  const words = out.split("\n").flatMap((l) => l.replace(/^# /, "").split(" "));
  assert.deepStrictEqual(words, W30.split(" "));
});

test("virtualComment malformed: a non-numeric indent reads as 0", () => {
  // Reading: indentColumns that is not a finite number falls back to the default.
  for (const bad of ["eight", NaN, null, [], {}]) {
    assert.strictEqual(virtualComment("Retry the call.", "rust", bad), "// Retry the call.", `indent ${String(bad)}`);
  }
});

// ---- partialWindow

test("partialWindow: the window is the tail of the take", () => {
  assert.deepStrictEqual(partialWindow(10000, 4000), { offsetMs: 6000, durationMs: 4000 });
});

test("partialWindow: a take no longer than the window starts at 0", () => {
  assert.deepStrictEqual(partialWindow(3000, 4000), { offsetMs: 0, durationMs: 3000 });
  assert.deepStrictEqual(partialWindow(4000, 4000), { offsetMs: 0, durationMs: 4000 });
  assert.deepStrictEqual(partialWindow(0, 4000), { offsetMs: 0, durationMs: 0 });
});

test("partialWindow: negative and non-finite inputs are treated as 0", () => {
  assert.deepStrictEqual(partialWindow(-5, 4000), { offsetMs: 0, durationMs: 0 });
  assert.deepStrictEqual(partialWindow(NaN, 4000), { offsetMs: 0, durationMs: 0 });
  assert.deepStrictEqual(partialWindow(10000, Infinity), { offsetMs: 10000, durationMs: 0 });
  assert.deepStrictEqual(partialWindow(10000, -1), { offsetMs: 10000, durationMs: 0 });
});

test("partialWindow malformed: non-number inputs are treated as 0", () => {
  for (const bad of [undefined, null, "abc", [], {}, true]) {
    assert.deepStrictEqual(partialWindow(bad, 4000), { offsetMs: 0, durationMs: 0 }, `total ${JSON.stringify(bad)}`);
    assert.deepStrictEqual(partialWindow(10000, bad), { offsetMs: 10000, durationMs: 0 }, `window ${JSON.stringify(bad)}`);
  }
});

// ---- wavHeader

const bytes = (h, from, to) => Array.from(h.subarray(from, to));
const ascii = (s) => Array.from(s, (c) => c.charCodeAt(0));

test("wavHeader: a 44-byte Uint8Array", () => {
  const h = wavHeader(32000);
  assert.ok(h instanceof Uint8Array);
  assert.strictEqual(h.length, 44);
});

test("wavHeader: RIFF, WAVE, fmt , data tags at offsets 0, 8, 12, 36", () => {
  const h = wavHeader(32000);
  assert.deepStrictEqual(bytes(h, 0, 4), ascii("RIFF"));
  assert.deepStrictEqual(bytes(h, 8, 12), ascii("WAVE"));
  assert.deepStrictEqual(bytes(h, 12, 16), ascii("fmt "));
  assert.deepStrictEqual(bytes(h, 36, 40), ascii("data"));
});

test("wavHeader: the fixed fmt fields byte by byte at offsets 16 to 35", () => {
  const h = wavHeader(32000);
  assert.deepStrictEqual(bytes(h, 16, 20), [16, 0, 0, 0], "fmt chunk size 16");
  assert.deepStrictEqual(bytes(h, 20, 22), [1, 0], "format 1 PCM");
  assert.deepStrictEqual(bytes(h, 22, 24), [1, 0], "channels 1");
  assert.deepStrictEqual(bytes(h, 24, 28), [0x80, 0x3e, 0, 0], "rate 16000");
  assert.deepStrictEqual(bytes(h, 28, 32), [0x00, 0x7d, 0, 0], "byte rate 32000");
  assert.deepStrictEqual(bytes(h, 32, 34), [2, 0], "block align 2");
  assert.deepStrictEqual(bytes(h, 34, 36), [16, 0], "bits 16");
});

test("wavHeader: chunk size 36+n at offset 4 and data size n at offset 40, little-endian", () => {
  const h = wavHeader(32000);
  assert.deepStrictEqual(bytes(h, 4, 8), [0x24, 0x7d, 0, 0], "32036");
  assert.deepStrictEqual(bytes(h, 40, 44), [0x00, 0x7d, 0, 0], "32000");
  const wide = wavHeader(0x01020304);
  assert.deepStrictEqual(bytes(wide, 40, 44), [0x04, 0x03, 0x02, 0x01]);
  assert.deepStrictEqual(bytes(wide, 4, 8), [0x28, 0x03, 0x02, 0x01]);
});

test("wavHeader: zero length", () => {
  const h = wavHeader(0);
  assert.deepStrictEqual(bytes(h, 4, 8), [36, 0, 0, 0]);
  assert.deepStrictEqual(bytes(h, 40, 44), [0, 0, 0, 0]);
});

test("wavHeader: negative, non-integer and non-number lengths are treated as 0", () => {
  const zero = bytes(wavHeader(0), 0, 44);
  for (const bad of [-1, 1.5, NaN, Infinity, undefined, null, "abc", [], {}, true]) {
    const h = wavHeader(bad);
    assert.ok(h instanceof Uint8Array, `length ${String(bad)}`);
    assert.deepStrictEqual(bytes(h, 0, 44), zero, `length ${String(bad)}`);
  }
});

// ---- timingLine

test("timingLine example: all five pairs in order", () => {
  const line = timingLine({ pressToFirstBufferMs: 62, takeMs: 6400, decodeMs: 246, fimMs: 184, micCloseToGhostMs: 452 });
  assert.strictEqual(line, "[dictate] timings press-to-first-buffer=62ms take=6.4s decode=246ms fim=184ms mic-close-to-ghost=452ms");
});

test("timingLine: absent optionals are omitted", () => {
  assert.strictEqual(timingLine({ takeMs: 1000, decodeMs: 5 }), "[dictate] timings take=1.0s decode=5ms");
  assert.strictEqual(timingLine({ takeMs: 2000, decodeMs: 10, fimMs: 30 }), "[dictate] timings take=2.0s decode=10ms fim=30ms");
  assert.strictEqual(timingLine({ takeMs: 2000, decodeMs: 10, micCloseToGhostMs: 7 }), "[dictate] timings take=2.0s decode=10ms mic-close-to-ghost=7ms");
});

test("timingLine: the order is fixed regardless of object key order", () => {
  const line = timingLine({ micCloseToGhostMs: 452, decodeMs: 246, fimMs: 184, takeMs: 6400, pressToFirstBufferMs: 62 });
  assert.strictEqual(line, "[dictate] timings press-to-first-buffer=62ms take=6.4s decode=246ms fim=184ms mic-close-to-ghost=452ms");
});

test("timingLine: integers are rounded and take has one decimal", () => {
  const line = timingLine({ pressToFirstBufferMs: 61.6, takeMs: 6449, decodeMs: 245.2, fimMs: 0.4, micCloseToGhostMs: 99.6 });
  assert.strictEqual(line, "[dictate] timings press-to-first-buffer=62ms take=6.4s decode=245ms fim=0ms mic-close-to-ghost=100ms");
  assert.ok(timingLine({ takeMs: 6480, decodeMs: 1 }).includes("take=6.5s"));
});

test("timingLine malformed: non-object input and missing or non-numeric fields never throw or render NaN", () => {
  for (const bad of [undefined, null, 42, "x", [], true, { decodeMs: 5 }, { takeMs: "six", decodeMs: null }, { takeMs: 1000, decodeMs: 5, fimMs: "slow" }]) {
    let line;
    assert.doesNotThrow(() => { line = timingLine(bad); }, `input ${JSON.stringify(bad)}`);
    assert.strictEqual(typeof line, "string");
    assert.ok(line.startsWith("[dictate] timings"), line);
    assert.ok(!line.includes("NaN"), line);
    assert.ok(!line.includes("undefined"), line);
  }
});

// ---- refusalSentence

test("refusalSentence: the six fixed sentences, exact text", () => {
  assert.strictEqual(refusalSentence("no-device"), "Column 80: no microphone found. Plug one in, or pick one with Select Microphone.");
  assert.strictEqual(refusalSentence("device-denied"), "Column 80: the microphone would not open. Check the OS microphone permission for VS Code.");
  // Contract amended 2026-09-02: the sentence names the two ways to get the download.
  assert.strictEqual(refusalSentence("model-missing"), "Column 80: the speech model is not downloaded yet. Click Download in the notification, or run Column 80: Download Speech Model.");
  assert.strictEqual(refusalSentence("empty-transcript"), "Column 80: heard nothing, so nothing was generated.");
  assert.strictEqual(refusalSentence("remote"), "Column 80: dictation needs the microphone on this machine; not available over Remote yet.");
  assert.strictEqual(refusalSentence("server-down"), "Column 80: the speech recogniser is not running, so nothing was heard.");
});

test("refusalSentence: binary-missing carries the platform, 'unknown' when absent or malformed", () => {
  // Reading: a non-string detail is the same as no detail.
  assert.strictEqual(refusalSentence("binary-missing", "linux-arm64"), "Column 80: this build carries no recorder for linux-arm64, so dictation is off here.");
  assert.strictEqual(refusalSentence("binary-missing"), "Column 80: this build carries no recorder for unknown, so dictation is off here.");
  assert.strictEqual(refusalSentence("binary-missing", 42), "Column 80: this build carries no recorder for unknown, so dictation is off here.");
});

test("refusalSentence: no-comment-row carries the languageId, 'this language' when absent or malformed", () => {
  assert.strictEqual(refusalSentence("no-comment-row", "plaintext"), "Column 80: no comment syntax for plaintext, so the intent cannot ride into the prompt.");
  assert.strictEqual(refusalSentence("no-comment-row"), "Column 80: no comment syntax for this language, so the intent cannot ride into the prompt.");
  assert.strictEqual(refusalSentence("no-comment-row", null), "Column 80: no comment syntax for this language, so the intent cannot ride into the prompt.");
});

test("refusalSentence: an unknown or malformed kind is the generic refusal and never throws", () => {
  for (const bad of ["banana", "", undefined, null, 42, ["no-device"], { kind: "no-device" }, true]) {
    assert.strictEqual(refusalSentence(bad), "Column 80: dictation refused.", `kind ${JSON.stringify(bad)}`);
  }
});

test("refusalSentence: every known sentence starts with 'Column 80: '", () => {
  const kinds = ["no-device", "device-denied", "model-missing", "binary-missing", "empty-transcript", "remote", "no-comment-row", "server-down"];
  for (const k of kinds) {
    const s = refusalSentence(k, "x");
    assert.ok(s.startsWith("Column 80: "), s);
    assert.notStrictEqual(s, "Column 80: dictation refused.", `${k} is a known kind`);
  }
});
