// ADVERSARIAL REVIEW, SECOND PASS - session-v52 phase 1 (the render).
//
// The first pass found 18 defects. Nine mechanisms were implemented to close
// them. This file attacks the FIXES: `scanDocument`, the directive table, the
// tightened naked-prose gate, the four new unit kinds, "was the line above
// full", and the apostrophe rule.
//
// Naming, same as the first pass:
//   E*  a DEFECT introduced or left open by the fix round. Every E row FAILS
//       against the code as shipped: it asserts the right answer and does not
//       get it. Read a red E as "this is the claim".
//   S*  a suspicion that came back SOUND. Green means the fix holds.
//
// Nothing here is a spec; the phase-1 contract is.
//
// Run: SKIP_LIVE=1 npx node --test test/adversarial-v52-p1b.test.cjs

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "adversarial-v52-p1b",
  `export { tightenAtCursor, resolveTightenRegion, renderRegion, tightenTokens, tightenOpensFence, tightenVerbatimLine, tightenIsDirective } from "../src/core/tightenRender";\n`
);
const {
  tightenAtCursor,
  resolveTightenRegion,
  renderRegion,
  tightenTokens,
  tightenOpensFence,
  tightenVerbatimLine,
  tightenIsDirective,
} = mod;
test.after(cleanup);

// --- helpers -------------------------------------------------------------

function press(text, languageId, cursor, tabWidth) {
  const r = tightenAtCursor({ text, languageId, cursor, tabWidth });
  if (!r.ok) return { ok: false, refusal: r.refusal, text };
  return { ok: true, text: text.slice(0, r.start) + r.replacement + text.slice(r.end), region: r.region, replacement: r.replacement };
}

/** Press `n` times with the caret held at the same offset, returning every state. */
function pressN(text, languageId, cursor, n, tabWidth) {
  const states = [text];
  let cur = text;
  for (let i = 0; i < n; i++) {
    const r = press(cur, languageId, cursor, tabWidth);
    if (!r.ok) return { states, refusal: r.refusal, at: i + 1 };
    cur = r.text;
    states.push(cur);
  }
  return { states };
}

const widthOf = (s, tw = 4) => {
  let w = 0;
  for (const ch of s) w += ch === "\t" ? tw : 1;
  return w;
};

const LANGS = [
  ["rust", "/// "],
  ["typescript", "// "],
  ["csharp", "/// "],
  ["go", "// "],
  ["python", "# "],
];

let rngState = 20260812 >>> 0;
function rnd() {
  rngState = (rngState * 1664525 + 1013904223) >>> 0;
  return rngState / 4294967296;
}
const pick = (a) => a[Math.floor(rnd() * a.length)];
const int = (n) => Math.floor(rnd() * n);

// =========================================================================
// E1. BLOCKER. A link reference definition that has to wrap is destroyed on
//     press two, and the block is not idempotent.
//
//     `LINK_REFERENCE` needs a space after the colon. The render's own wrap
//     puts `[spec]:` alone on a line when the URL will not fit beside it, so on
//     press two that line is no longer a link reference: it falls back to
//     ordinary prose and is absorbed by the paragraph above it. The definition
//     stops being a definition, which is word for word the harm mechanism E
//     (defect 10) exists to prevent.
//
//     6663 of the 31151 link reference definitions in this box's crates.io
//     source cache are already wider than 76 columns.
// =========================================================================

test("E1 a wrapping link reference definition is not idempotent, all five languages", () => {
  const broken = [];
  for (const [lang, pfx] of LANGS) {
    const text =
      `${pfx}The shard map holds the offsets.\n` +
      `${pfx}[spec]: https://example.com/a/very/long/path/that/keeps/going/for/ages/and/ages\n`;
    const { states } = pressN(text, lang, pfx.length + 1, 3);
    if (states[1] !== states[2]) broken.push({ lang, one: states[1], two: states[2] });
  }
  assert.deepEqual(
    broken.map((b) => b.lang),
    [],
    `press two differs for: ${broken
      .map((b) => `\n[${b.lang}]\n--press1--\n${b.one}--press2--\n${b.two}`)
      .join("")}`
  );
});

test("E1b the link reference definition survives as a definition", () => {
  const text =
    "/// The shard map holds the offsets.\n" +
    "/// [spec]: https://example.com/a/very/long/path/that/keeps/going/for/ages/and/ages\n";
  const { states } = pressN(text, "rust", 5, 2);
  const settled = states[2];
  const stillADefinition = settled
    .split("\n")
    .some((l) => /^\s*\/\/\/ \[[^\]]+\]:[ \t]\S/.test(l));
  assert.equal(stillADefinition, true, `after two presses:\n${settled}`);
});

// =========================================================================
// E2. HIGH. `scanDocument` hands the line-comment path to `nextComment`, whose
//     quote scanner does not know about a Rust char literal or a TypeScript
//     regex literal. One unbalanced quote character kills EVERY comment below
//     it in the file: the block is no longer comment-led, so the command
//     refuses on a plain `//` line.
//
//     Measured: 19 of 27 comment lines dead in
//     acme-db/acme_msg/src/payload/payloads.rs (the trigger is
//     `rest.find('"')?`), and 819 of 11088 (7.4%) of this product's OWN
//     TypeScript comment lines, across 20 of 97 files. The trigger in
//     src/core/postprocess.ts is the regex `/^["'`)\]}]+[;,]?$/`.
// =========================================================================

test("E2 a Rust char literal holding a double quote does not kill the comments below it", () => {
  const text =
    "fn q(s: &str) -> Option<usize> { s.find('\"') }\n" +
    "\n" +
    "/// The shard map holds the write ahead log offsets for each key range here.\n" +
    "/// A second line of the same block, long enough that the wrap has real work.\n";
  const cursor = text.indexOf("/// The") + 5;
  const r = tightenAtCursor({ text, languageId: "rust", cursor });
  assert.equal(r.ok, true, `refused: ${r.refusal}`);
});

test("E2b a TypeScript regex literal holding a quote does not kill the comments below it", () => {
  const text =
    "const isCloserRun = (s) => /^[\"'`)\\]}]+[;,]?$/.test(s);\n" +
    "\n" +
    "// The shard map holds the write ahead log offsets for each key range here.\n" +
    "// A second line of the same block, long enough that the wrap has real work.\n";
  const cursor = text.indexOf("// The") + 4;
  const r = tightenAtCursor({ text, languageId: "typescript", cursor });
  assert.equal(r.ok, true, `refused: ${r.refusal}`);
});

test("E2c on real source: the dead zone, counted", () => {
  const cases = [
    ["rust", "/home/utilitydelta/work/acme/acme-db/acme_msg/src/payload/payloads.rs"],
    ["typescript", "/home/utilitydelta/work/utilitydelta/column-80/src/core/postprocess.ts"],
  ];
  const found = [];
  for (const [lang, file] of cases) {
    let text;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      // Not this box. The private corpus is not on a clean clone, so this leg
      // is skipped LOUDLY rather than dropped in silence; E2/E2b carry the
      // claim on their own.
      console.log(`SKIP (LOUD) E2c: absent -> ${file}`);
      continue;
    }
    let off = 0;
    let total = 0;
    let refused = 0;
    for (const line of text.split("\n")) {
      if (line.trim().startsWith("//")) {
        total++;
        if (!tightenAtCursor({ text, languageId: lang, cursor: off + line.length }).ok) refused++;
      }
      off += line.length + 1;
    }
    found.push(`${file}: ${refused}/${total} comment lines refused`);
    assert.equal(refused, 0, found.join("\n"));
  }
});

// =========================================================================
// E3. HIGH. The naked-prose path reaches INSIDE a Rust or C# multi-line string
//     literal and comments its interior out, which changes the string's value.
//
//     `scanDocument` drops any `"` run that crosses a newline from `literals`.
//     The apostrophe problem it was fixing is a `'` problem: nothing in
//     dictation emits a `"`. 27 lines inside multi-line C# strings in
//     ~/work/contoso (SQL among them) are served by the gate today.
// =========================================================================

test("E3 a line inside a C# multi-line verbatim string is not commented out", () => {
  const text = 'var sql = @"\nselect the widget from the table where the identifier matches\n";\n';
  const r = tightenAtCursor({ text, languageId: "csharp", cursor: text.indexOf("select") + 3 });
  assert.equal(r.ok, false, `served, and the replacement would be:\n${r.ok ? r.replacement : ""}`);
});

test("E3b a line inside a Rust multi-line string is not commented out", () => {
  const text = 'let s = "\nthe shard map holds the offsets for each key range\n";\n';
  const r = tightenAtCursor({ text, languageId: "rust", cursor: text.indexOf("the shard") + 3 });
  assert.equal(r.ok, false, `served, and the replacement would be:\n${r.ok ? r.replacement : ""}`);
});

// =========================================================================
// E4. HIGH. Mechanism F is only half applied. A wrapped continuation of an
//     ORDINARY paragraph is emitted FLUSH, so `previousLineWasFull` is never
//     consulted for it: if the wrap lands a marker-shaped token (`-`, `*`, `+`,
//     `##`, `12.`) at the start of a line, press two promotes that line to a
//     list item and it swallows the indented unit below it.
//
//     The input below is ordinary English: a sentence ending "...shipped in
//     version 12." whose wrap puts `12.` at a line start.
// =========================================================================

test("E4 a wrapped line beginning with a sentence-final number is not re-promoted", () => {
  const text =
    "/// the shard map holds offsets for each key range and it was shipped in version 12. The map returns none when the key is absent from it\n" +
    "///     let x = 1;\n";
  const { states } = pressN(text, "rust", 5, 3);
  assert.equal(states[1], states[2], `--press1--\n${states[1]}--press2--\n${states[2]}`);
});

test("E4b the same, with a bare operator word at the wrap boundary", () => {
  const text =
    "    /// returns and identifier a + - `Vec<T, A>` `self.map` returns value commit +\n" +
    "    /// \tthe\n";
  const { states } = pressN(text, "rust", 8, 3, 8);
  assert.equal(states[1], states[2], `--press1--\n${states[1]}--press2--\n${states[2]}`);
});

test("E4c fuzz: ship condition 3 at press three, vocabulary of markers and new unit kinds", () => {
  rngState = 20260812 >>> 0;
  const WORDS = ["shard", "map", "offsets", "write", "ahead", "log", "key", "range", "identifier", "value", "returns", "when", "the", "empty", "caller", "widget", "entry", "commit", "a", "of", "12.", "-", "+", "##"];
  const SPANS = ["`Vec<T, A>`", "`HashMap<K, V>`", "`Ok(())`"];
  const URL = "https://example.com/a/very/long/path/that/keeps/going/for/ages/and/ages";
  const contentLine = () => {
    const r = rnd();
    if (r < 0.08) return "| " + Array.from({ length: 1 + int(3) }, () => pick(WORDS)).join(" | ") + " |";
    if (r < 0.14) return "[" + pick(WORDS).replace(/\W/g, "x") + "]: " + URL;
    if (r < 0.20) return "    " + Array.from({ length: 1 + int(6) }, () => pick(WORDS)).join(" ");
    if (r < 0.24) return "\t" + Array.from({ length: 1 + int(6) }, () => pick(WORDS)).join(" ");
    if (r < 0.28) return "```";
    if (r < 0.35) return " ".repeat(int(5)) + pick(["-", "*", "+", "1.", "12.", "#", "##"]) + " " + Array.from({ length: 1 + int(12) }, () => pick(WORDS)).join(" ");
    if (r < 0.39) return "";
    const n = 1 + int(16);
    const out = [];
    for (let i = 0; i < n; i++) out.push(rnd() < 0.12 ? pick(SPANS) : rnd() < 0.05 ? URL : pick(WORDS));
    return out.join(" ");
  };
  let bad = 0;
  let firstBad = "";
  for (let t = 0; t < 4000; t++) {
    const [lang, pfx] = pick(LANGS);
    const tw = pick([1, 2, 4, 8]);
    const indent = pick(["", "  ", "    ", "\t", "\t\t", "        "]);
    const lines = [];
    for (let i = 0, n = 1 + int(7); i < n; i++) {
      const c = contentLine();
      lines.push(indent + (c === "" ? pfx.trimEnd() : pfx + c));
    }
    const text = lines.join("\n") + "\n";
    const cursor = indent.length + pfx.length + 1;
    const { states, refusal } = pressN(text, lang, cursor, 3, tw);
    if (refusal !== undefined) {
      if (states.length > 1) {
        bad++;
        if (!firstBad) firstBad = `refused on a later press (${refusal})\n${text}`;
      }
      continue;
    }
    if (states[1] !== states[2] || states[2] !== states[3]) {
      bad++;
      if (!firstBad) firstBad = `[${lang} tw=${tw}]\n--input--\n${text}--press1--\n${states[1]}--press2--\n${states[2]}`;
    }
  }
  assert.equal(bad, 0, `${bad} of 4000 rows are not idempotent. First:\n${firstBad}`);
});

// =========================================================================
// E5. MEDIUM. The four new own-unit kinds are only honoured when they are NOT
//     indented under a list marker. `continues` is computed before `verbatim`,
//     so an indented table row, an indented code block or an indented link
//     reference under a list item is merged into the item's text and its
//     structure is gone. The contract says each of them is its own unit
//     unconditionally.
//
//     Not S52-8: S52-8 is about a nested MARKER under a FULL parent line, and
//     the parent here is 31 columns of a 76-column budget.
// =========================================================================

test("E5 a markdown table indented under a list item stays a table", () => {
  const text =
    "/// - the shard map columns are\n" +
    "///   | name | kind |\n" +
    "///   |---|---|\n" +
    "///   | key | u64 |\n";
  const out = press(text, "rust", 5);
  assert.equal(out.ok, true);
  const rows = out.text.split("\n").filter((l) => /\|.*\|\s*$/.test(l)).length;
  assert.equal(rows, 3, `the three table rows did not survive:\n${out.text}`);
});

test("E5b an indented code block under a list item stays its own line", () => {
  const text = "/// - the item text is short\n///     let x = 1;\n";
  const out = press(text, "rust", 5);
  assert.equal(out.ok, true);
  assert.equal(
    out.text,
    "/// - the item text is short\n///     let x = 1;\n",
    `the code block was merged into the item:\n${out.text}`
  );
});

// =========================================================================
// E6. MEDIUM. The Go directive table carries `go:` and `+build` and nothing
//     else. `//nolint` and the cgo `//export` are both space-sensitive
//     directives that stop working the moment the opener's space is inserted.
// =========================================================================

test("E6 //nolint keeps its missing space", () => {
  const text = "//nolint:errcheck // the shard map holds the offsets for each key range in file\n";
  const out = press(text, "go", 5);
  assert.equal(out.ok, true);
  assert.match(out.text, /^\/\/nolint:errcheck/, `nolint lost its space:\n${out.text}`);
});

test("E6b the cgo //export keeps its missing space", () => {
  const text = "//export ComputeWidget\n// the shard map holds the write ahead log offsets for each key range here\n";
  const out = press(text, "go", 5);
  assert.equal(out.ok, true);
  assert.match(out.text, /^\/\/export ComputeWidget/, `export lost its space:\n${out.text}`);
});

// =========================================================================
// E7. LOW. `WORD_APOSTROPHE` only forgives an apostrophe that FOLLOWS a letter,
//     so a possessive on a token ending in a digit or a symbol reads as a
//     string delimiter and the whole dictated line is refused. Two of the 48
//     refusals in the 356-line transcript corpus are this.
// =========================================================================

test("E7 a possessive after a non-letter is still dictation", () => {
  for (const line of [
    "What I did not finish plainly is C#'s render and Python's field leg\n",
    "Can you review the 17's work and then move on to these fixes for v18\n",
  ]) {
    const r = tightenAtCursor({ text: line, languageId: "rust", cursor: 3 });
    assert.equal(r.ok, true, `refused ${JSON.stringify(line.trim())}: ${r.refusal}`);
  }
});

// =========================================================================
// E8. LOW. A dictated sentence that closes a parenthetical is refused: the
//     tightened gate refuses any line whose last character is one of
//     `[](){}<>`. 130 of 4114 real Rust doc-comment sentences (3.2%) end in
//     `)`, and the shape is a plain English aside.
// =========================================================================

test("E8 a sentence ending in a closed parenthetical is dictation", () => {
  for (const line of [
    "List the configured keys and show their truncated hashes (a summary)\n",
    "The map returns none for a key it never saw (saves a lot of work)\n",
  ]) {
    const r = tightenAtCursor({ text: line, languageId: "rust", cursor: 3 });
    assert.equal(r.ok, true, `refused ${JSON.stringify(line.trim())}: ${r.refusal}`);
  }
});

// =========================================================================
// SOUND. Everything below is green: the fix holds under the attack named.
// =========================================================================

test("S1 mechanism A: offset 0 above a blank first line, and no hang", () => {
  const r = resolveTightenRegion({ text: "\n// the shard map holds the offsets\n", languageId: "rust", cursor: 0 });
  assert.equal(r.ok, false);
  assert.match(r.refusal, /blank/);
  const ok = resolveTightenRegion({ text: "\n// the shard map holds the offsets\n", languageId: "rust", cursor: 3 });
  assert.equal(ok.ok, true);
  assert.equal(ok.region.start, 1);
});

test("S2 mechanism G: a non-breaking and an ideographic space survive the wrap", () => {
  for (const ws of [" ", "　"]) {
    const text = `// the${ws}caller map holds the offsets for each key range and it wraps past eighty columns\n`;
    const out = press(text, "rust", 5);
    assert.equal(out.ok, true);
    assert.equal(out.text.includes(`the${ws}caller`), true, `${JSON.stringify(ws)} was substituted:\n${JSON.stringify(out.text)}`);
  }
});

test("S3 mechanism H: renderRegion alone honours CRLF", () => {
  const text = "// the shard map holds the write ahead log offsets for each key range here ok\r\n// second line of the block\r\n";
  const res = resolveTightenRegion({ text, languageId: "rust", cursor: 5 });
  assert.equal(res.ok, true);
  const out = renderRegion(res.region, "rust");
  assert.equal(out.includes("\r\n"), true);
  assert.equal(/[^\r]\n/.test(out), false, JSON.stringify(out));
});

test("S4 the directive table: alone, adjacent, and mid-block, all five arms", () => {
  const rows = [
    ["go", "//go:build linux\n"],
    ["go", "//go:build linux\n// +build linux\n"],
    ["go", "// the shard map holds the offsets for each key range here ok\n//go:build linux\n// and a trailing sentence follows the constraint line here\n"],
    ["go", "//go:generate stringer -type=Kind\n"],
    ["typescript", '/// <reference path="a.d.ts" />\n/// <reference path="b.d.ts" />\n'],
    ["python", "#!/usr/bin/env python3\n# the shard map holds the offsets for each key range here ok\n"],
    ["python", "# pylint: disable=all\n# pylint: disable=none\n"],
  ];
  for (const [lang, text] of rows) {
    const { states } = pressN(text, lang, 5, 3);
    assert.equal(states[1], states[3], `[${lang}]\n${text}=>\n${states[1]}`);
    for (const line of text.split("\n")) {
      if (line.trim() === "") continue;
      const body = line.replace(/^(\/{2,3}|#)/, "");
      if (tightenIsDirective(lang, body)) {
        assert.equal(states[1].includes(line), true, `[${lang}] directive lost its bytes: ${JSON.stringify(line)}\n${states[1]}`);
      }
    }
  }
});

test("S5 the apostrophe rule: a literal holding one, and a possessive beside one", () => {
  const rows = [
    ["typescript", "const t = `don't do this`;\n// the shard map holds the offsets for each key range here ok\n// and a second sentence in the same block to make the wrap do work\n"],
    ["rust", "let s = \"don't\";\n// the shard map holds the offsets for each key range here ok\n// and a second sentence in the same block to make the wrap do work\n"],
    ["rust", "// the shard map is the caller's\nlet s = \"a string with // inside it\";\n// and another comment block down here with enough words to wrap ok\n"],
  ];
  for (const [lang, text] of rows) {
    // The LAST comment-led line, so the caret cannot land on a `//` that is
    // two characters of a string's value.
    const cursor = text.lastIndexOf("\n//") + 1;
    const { states } = pressN(text, lang, cursor + 4, 3);
    assert.equal(states[1], states[3], `[${lang}]\n${states[1]}`);
    assert.equal(states[1].split("\n")[0], text.split("\n")[0], `line 0 changed:\n${states[1]}`);
  }
  const doc = 'def f():\n    """The caller\'s map holds the offsets for each key range and it is long enough to wrap."""\n';
  const { states } = pressN(doc, "python", 30, 3);
  assert.equal(states[1], states[3]);
  assert.equal(states[1].includes("caller's"), true);
});

test("S6 mechanism C does refuse the literals it was built for", () => {
  const rows = [
    ["typescript", "const t = `\n// the shard map holds the offsets for each key range in the file here\n// and a second line of the very same fake comment block continues here\n`;\n", "// the"],
    ["go", "var t = `\n// the shard map holds the offsets for each key range in the file ok\n// and a second line of the very same fake comment block continues here\n`\n", "// the"],
    ["python", 'x = """\nthe shard map holds the offsets for each key range\n"""\n', "the shard"],
  ];
  for (const [lang, text, needle] of rows) {
    const r = tightenAtCursor({ text, languageId: lang, cursor: text.indexOf(needle) + 3 });
    assert.equal(r.ok, false, `[${lang}] served a literal's interior:\n${r.ok ? r.replacement : ""}`);
  }
});

test("S7 ship condition 1 and 6 under 4000 fuzz rows of the new vocabulary", () => {
  rngState = 777 >>> 0;
  const WORDS = ["shard", "map", "offsets", "key", "range", "value", "returns", "the", "empty", "caller", "12.", "-", "##", "|"];
  const SPANS = ["`Vec<T, A>`", "`Ok(())`"];
  const URL = "https://example.com/a/very/long/path/that/keeps/going/for/ages";
  const strip = (s) => s.replace(/[ \t\r\n`]+/g, "");
  let bad1 = 0;
  let bad6 = 0;
  let first = "";
  for (let t = 0; t < 4000; t++) {
    const [lang, pfx] = pick(LANGS);
    const tw = pick([1, 2, 4, 8]);
    const indent = pick(["", "  ", "    ", "\t", "        "]);
    const lines = [];
    for (let i = 0, n = 1 + int(6); i < n; i++) {
      const r = rnd();
      let c;
      if (r < 0.1) c = "| " + Array.from({ length: 1 + int(3) }, () => pick(WORDS)).join(" | ") + " |";
      else if (r < 0.16) c = "[lbl]: " + URL;
      else if (r < 0.22) c = "    " + Array.from({ length: 1 + int(6) }, () => pick(WORDS)).join(" ");
      else if (r < 0.26) c = "```";
      else if (r < 0.33) c = " ".repeat(int(5)) + pick(["-", "*", "1.", "##"]) + " " + Array.from({ length: 1 + int(10) }, () => pick(WORDS)).join(" ");
      else if (r < 0.37) c = "";
      else c = Array.from({ length: 1 + int(14) }, () => (rnd() < 0.12 ? pick(SPANS) : rnd() < 0.06 ? URL : pick(WORDS))).join(" ");
      lines.push(indent + (c === "" ? pfx.trimEnd() : pfx + c));
    }
    const text = lines.join("\n") + "\n";
    const out = press(text, lang, indent.length + pfx.length + 1, tw);
    if (!out.ok) continue;
    if (out.region.indent !== indent) {
      bad6++;
      continue;
    }
    const opener = pfx.trimEnd();
    const body = out.replacement
      .split("\n")
      .map((l) => {
        const s = l.replace(/^[ \t]*/, "");
        return s.startsWith(opener) ? s.slice(opener.length) : s;
      })
      .join(" ");
    if (strip(body) !== strip(out.region.prose)) {
      bad1++;
      if (!first) first = `[${lang}]\n${text}--prose--\n${out.region.prose}\n--repl--\n${out.replacement}`;
    }
  }
  assert.equal(bad1, 0, `ship condition 1 broke ${bad1} times. First:\n${first}`);
  assert.equal(bad6, 0, `ship condition 6 broke ${bad6} times`);
});

test("S8 ship condition 2 under 4000 fuzz rows, with the amended exception", () => {
  rngState = 4242 >>> 0;
  const WORDS = ["shard", "map", "offsets", "key", "range", "value", "returns", "the", "empty", "caller"];
  const SPANS = ["`Vec<T, A>`", "`HashMap<K, V>`"];
  const URL = "https://example.com/a/very/long/path/that/keeps/going/for/ages/and/ages";
  let viol = 0;
  let first = "";
  for (let t = 0; t < 4000; t++) {
    const [lang, pfx] = pick(LANGS);
    const tw = pick([1, 2, 4, 8]);
    const indent = pick(["", "  ", "    ", "\t", "        "]);
    const lines = [];
    for (let i = 0, n = 1 + int(6); i < n; i++) {
      const r = rnd();
      let c;
      if (r < 0.1) c = "| " + Array.from({ length: 1 + int(3) }, () => pick(WORDS)).join(" | ") + " |";
      else if (r < 0.16) c = "[lbl]: " + URL;
      else if (r < 0.22) c = "    " + Array.from({ length: 1 + int(6) }, () => pick(WORDS)).join(" ");
      else if (r < 0.26) c = "```";
      else if (r < 0.34) c = " ".repeat(int(5)) + pick(["-", "*", "1.", "##"]) + " " + Array.from({ length: 1 + int(10) }, () => pick(WORDS)).join(" ");
      else if (r < 0.38) c = "";
      else c = Array.from({ length: 1 + int(14) }, () => (rnd() < 0.12 ? pick(SPANS) : rnd() < 0.06 ? URL : pick(WORDS))).join(" ");
      lines.push(indent + (c === "" ? pfx.trimEnd() : pfx + c));
    }
    const text = lines.join("\n") + "\n";
    const out = press(text, lang, indent.length + pfx.length + 1, tw);
    if (!out.ok) continue;
    const budget = 80 - widthOf(indent, tw) - widthOf(pfx, tw);
    let inFence = false;
    for (const line of out.replacement.split("\n")) {
      const body = line.replace(/^[ \t]*/, "").replace(/^(\/{2,3}|#)\s?/, "");
      const wasFence = inFence;
      if (tightenOpensFence(body.trim())) inFence = !inFence;
      if (widthOf(line, tw) <= 80) continue;
      // The amended exception: a verbatim shape, or an unsplittable token.
      if (wasFence || tightenOpensFence(body.trim())) continue;
      if (tightenVerbatimLine(body) || tightenIsDirective(lang, body)) continue;
      const widest = Math.max(0, ...tightenTokens(body).map((x) => widthOf(x, tw)));
      if (widest > budget) continue;
      viol++;
      if (!first) first = `[${lang} tw=${tw}] ${JSON.stringify(line)} width=${widthOf(line, tw)} budget=${budget}\n${text}`;
      break;
    }
  }
  assert.equal(viol, 0, `${viol} lines over 80 with no unsplittable cause. First:\n${first}`);
});

test("S9 scanDocument cost on a 500KB document stays inside a manual command's budget", () => {
  let big = "";
  while (big.length < 500 * 1024) big += "/// the shard map holds the write ahead log offsets for each key range\n";
  tightenAtCursor({ text: big, languageId: "rust", cursor: big.length - 10 });
  const t0 = process.hrtime.bigint();
  tightenAtCursor({ text: big, languageId: "rust", cursor: big.length - 10 });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.ok(ms < 250, `500KB of comments took ${ms.toFixed(1)}ms`);
});
