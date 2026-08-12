// ADVERSARIAL REVIEW - session-v52 phase 1 (the render).
//
// Every row here is EVIDENCE for a defect claim, or a probe that resolves a
// contract gap. Nothing here is a spec: the blind oracle owns the spec. This
// file exists to show, with bytes, what the shipped code does to input the
// existing rows never hand it.
//
// Naming, because it decides how to read a green tick:
//   D*  a DEFECT. A `D` row that PASSES is pinning the bad bytes so the claim
//       is reproducible; a `D` row that FAILS asserts the right answer and does
//       not get it. Read every D as "this is wrong", green or red.
//   P*  a suspicion that turned out SOUND. Green means the product is fine.
//   G*  a probe resolving one of the blind oracle's eight contract gaps.
//   F*  a fuzz.
//   I*  a row pinning AMENDED ship condition 2. Added with the triage, because
//       mechanism I was a contract fix and a contract fix needs bytes under it.
//
// Red at the time of writing: D0, D0b, D0c, D23, F1.
//
// 2026-08-12, after the triage: mechanisms A through I are implemented, so every
// D row below that PINNED the wrong bytes now asserts the right ones. The rows
// are unchanged in intent and each still fails if its defect comes back. Three
// defects stay deferred by ruling and their rows still pin what the product
// does: D6 (defect 13, commented-out code merges), D15 (15, nested fences of
// differing width), D24 (17, a break after an abbreviation).
//
// Run: SKIP_LIVE=1 npx node --test test/adversarial-v52-p1.test.cjs

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "adversarial-v52-p1",
  `export { tightenAtCursor, resolveTightenRegion, renderRegion, tightenTokens, tightenParagraphs, servesTighten, TIGHTEN_COLUMN, TIGHTEN_PARAGRAPH_WORDS, TIGHTEN_TAB_WIDTH } from "../src/core/tightenRender";\n`
);
const { tightenAtCursor, resolveTightenRegion, tightenTokens, servesTighten } = mod;
test.after(cleanup);

// --- helpers -------------------------------------------------------------

/** Cursor at the first occurrence of `needle`. Throws if it is not there, so a
 *  typo in a fixture is a loud failure and not a silent cursor at 0. */
function at(text, needle) {
  const i = text.indexOf(needle);
  assert.notEqual(i, -1, `fixture has no ${JSON.stringify(needle)}`);
  return i;
}

function press(text, languageId, cursor, tabWidth) {
  const r = tightenAtCursor({ text, languageId, cursor, tabWidth });
  if (!r.ok) return { ok: false, refusal: r.refusal, text };
  return {
    ok: true,
    text: text.slice(0, r.start) + r.replacement + text.slice(r.end),
    replacement: r.replacement,
    region: r.region,
    start: r.start,
    end: r.end,
  };
}

/** Press again with the cursor put back on the same LINE INDEX, which is what a
 *  developer's caret does. */
function pressAtLine(text, languageId, lineIndex) {
  const lines = text.split("\n");
  let off = 0;
  for (let n = 0; n < lineIndex; n++) off += lines[n].length + 1;
  return press(text, languageId, off);
}

const widthOf = (s, tw = 4) => {
  let w = 0;
  for (const ch of s) w += ch === "\t" ? tw : 1;
  return w;
};
const strip = (s) => s.replace(/[\s`]/g, "");

// The bundle bundleCore just wrote. A hang has to be proved in a CHILD, or the
// proof takes the suite down with it.
const BUNDLE = path.join(__dirname, ".adversarial-v52-p1.bundle.cjs");

/** Resolve in a child process with a wall clock. Returns "returned" or the
 *  signal that killed it. */
function resolveInChild(text, languageId, cursor, ms = 2500) {
  const script =
    `const { resolveTightenRegion } = require(${JSON.stringify(BUNDLE)});` +
    `resolveTightenRegion({ text: ${JSON.stringify(text)}, languageId: ${JSON.stringify(languageId)}, cursor: ${cursor} });` +
    `process.stdout.write("returned");`;
  const r = spawnSync(process.execPath, ["-e", script], { timeout: ms, encoding: "utf8", maxBuffer: 1 << 24 });
  return r.stdout === "returned" ? "returned" : `killed:${r.signal}:${(r.stderr || "").slice(0, 200)}`;
}

// =========================================================================
// 0. The hang.
// =========================================================================

test("D0 a document whose first character is a newline hangs the resolver", () => {
  // `lineStartAt(text, 0)` is `text.lastIndexOf("\n", -1) + 1`, and JS clamps a
  // negative fromIndex to 0, so on a text that OPENS with a newline it answers
  // 1 rather than 0. The block walk then sets `start = prev` where prev equals
  // start, and never terminates. The `above` array grows every turn, so it is
  // a spin plus an unbounded allocation.
  assert.equal(resolveInChild("\n#a", "python", 1, 5000), "returned", "python");
});

test("D0b the same hang in every language, on an ordinary leading blank line", () => {
  const rows = [
    ["rust", "\n/// alpha beta gamma delta\nstruct S;\n"],
    ["go", "\n// alpha beta gamma delta\nfunc f() {}\n"],
    ["csharp", "\n/// alpha beta gamma delta\nclass C {}\n"],
    ["typescript", "\n// alpha beta gamma delta\nexport {};\n"],
    ["python", "\n# alpha beta gamma delta\nx = 1\n"],
  ];
  const dead = [];
  for (const [lang, text] of rows) {
    if (resolveInChild(text, lang, 3) !== "returned") dead.push(lang);
  }
  assert.deepEqual(dead, [], "these languages hang");
});

test("D0c cursor offset 0 on a leading blank line reads the WRONG line", () => {
  // Same root cause, without the spin: offset 0 is on the empty first line, and
  // `lineStartAt` reports the second line's start.
  const src = "\nalpha beta gamma delta epsilon\nx = 1\n";
  const r = resolveTightenRegion({ text: src, languageId: "python", cursor: 0 });
  assert.equal(r.ok, false, "the cursor is on a blank line, so this must refuse");
});

// =========================================================================
// A. Directive and code corruption through the line-comment path.
//    The line-comment path has NO refusal gate: any comment-led line is
//    re-flowed, whatever the compiler thinks of it.
// =========================================================================

test("D1 a go build directive keeps its spacing and stays a directive", () => {
  const src = `//go:build linux\n\npackage main\n`;
  const out = press(src, "go", at(src, "//go"));
  assert.equal(out.ok, true);
  assert.equal(out.replacement, "//go:build linux\n");
  assert.equal(out.text.includes("//go:build"), true);
  assert.equal(out.text.includes("// go:build"), false, "the opener's space would kill the constraint");
});

test("D2 the two go build constraint lines stay two lines", () => {
  const src = `//go:build linux\n// +build linux\n\npackage main\n`;
  const out = press(src, "go", at(src, "//go"));
  assert.equal(out.ok, true);
  assert.equal(out.replacement, "//go:build linux\n// +build linux\n");
  const two = pressAtLine(out.text, "go", 0);
  assert.equal(two.replacement, out.replacement, "press two");
});

test("D3 adjacent TypeScript triple-slash directives each keep their line", () => {
  const src = `/// <reference path="a.d.ts" />\n/// <reference path="b.d.ts" />\nexport {};\n`;
  const out = press(src, "typescript", at(src, "///"));
  assert.equal(out.ok, true);
  assert.equal(out.replacement, `/// <reference path="a.d.ts" />\n/// <reference path="b.d.ts" />\n`);
  const two = pressAtLine(out.text, "typescript", 0);
  assert.equal(two.replacement, out.replacement, "press two");
});

test("D4 a python shebang keeps its spacing", () => {
  const src = `#!/usr/bin/env python3\nimport os\n`;
  const out = press(src, "python", 0);
  assert.equal(out.ok, true);
  assert.equal(out.replacement, "#!/usr/bin/env python3\n");
});

test("D5 two pylint directives stay two directives", () => {
  const src = `# pylint: disable=no-member\n# pylint: disable=too-many-locals\nvalue = 1\n`;
  const out = press(src, "python", 0);
  assert.equal(out.ok, true);
  assert.equal(out.replacement, "# pylint: disable=no-member\n# pylint: disable=too-many-locals\n");
  const two = pressAtLine(out.text, "python", 0);
  assert.equal(two.replacement, out.replacement, "press two");
});

test("D6 a commented-out block of code is merged into one line", () => {
  const src = `    // const a = read();\n    // const b = a + 1;\n    // return b;\n    return 0;\n`;
  const out = press(src, "typescript", at(src, "// const a"));
  assert.equal(out.ok, true);
  assert.equal(out.replacement, "    // const a = read(); const b = a + 1; return b;\n");
});

// =========================================================================
// B. Comment-shaped lines INSIDE a string literal. The line-comment walk is a
//    raw text match; it never asks `nextComment`, which does skip literals.
// =========================================================================

test("D7 lines inside a TypeScript template literal are refused, not re-flowed", () => {
  const src = "const banner = `\n// first line of the banner\n// second line of the banner\n`;\n";
  const out = press(src, "typescript", at(src, "// first"));
  assert.equal(out.ok, false, "re-flowing this changes the STRING'S VALUE");
  assert.equal(out.text, src);
  assert.equal(out.text.includes("// second line of the banner"), true);
});

test("D8 a python line inside a non-docstring triple-quoted string is refused", () => {
  const src = 'TEMPLATE = """\nrender the widget for the user\n"""\n';
  const out = press(src, "python", at(src, "render"));
  assert.equal(out.ok, false, "a `#` here would land inside the string's value");
  assert.equal(out.text, src);
});

// =========================================================================
// C. Real code that walks through the naked-prose gate and gets commented out.
// =========================================================================

test("D9 a C# Allman signature line is refused", () => {
  const src = `public sealed class Widget\n{\n    public async Task<int> GetValueAsync(int id)\n    {\n        return 1;\n    }\n}\n`;
  const sig = press(src, "csharp", at(src, "public async"));
  assert.equal(sig.ok, false, "Allman is the .NET default, so this is not an exotic shape");
  const decl = press(src, "csharp", 0);
  assert.equal(decl.ok, false);
  assert.equal(decl.text, src);
});

test("D10 a rust attribute and a where clause are refused", () => {
  const attr = `#[derive(Debug, Clone, PartialEq, Eq)]\nstruct Point;\n`;
  const a = press(attr, "rust", 0);
  assert.equal(a.ok, false);
  assert.equal(a.text, attr);

  const wh = `fn run<T>(v: T) -> T\nwhere T: Clone + Send + Sync\n{\n}\n`;
  const w = press(wh, "rust", at(wh, "where"));
  assert.equal(w.ok, false);
  assert.equal(w.text, wh);
});

test("D11 a python import statement is refused", () => {
  const src = `from typing import Optional, List\n\nvalue = 1\n`;
  const out = press(src, "python", 0);
  assert.equal(out.ok, false);
  assert.equal(out.text, src);
});

test("D12 a python raw docstring line is refused", () => {
  const src = `def f():\n    r"""Compute the widget for a given identifier."""\n    return 1\n`;
  const out = press(src, "python", at(src, "r\"\"\""));
  assert.equal(out.ok, false);
  assert.equal(out.text, src);
});

test("P1 plain and f docstrings for comparison", () => {
  const plain = `def f():\n    """Compute the widget for a given identifier."""\n    return 1\n`;
  const p = press(plain, "python", at(plain, '"""'));
  assert.equal(p.ok, true);
  assert.equal(p.region.kind, "docstring");

  const fstr = `def f():\n    f"""Compute the widget for {name} here."""\n    return 1\n`;
  const f = press(fstr, "python", at(fstr, 'f"""'));
  // Records whatever it does; asserted below in the report.
  assert.equal(typeof f.ok, "boolean");
  if (f.ok) assert.equal(f.replacement, '    # f"""Compute the widget for {name} here."""\n');
});

// =========================================================================
// D. Structure destroyed inside a legitimate doc comment.
// =========================================================================

test("D13 a nested list keeps its second level", () => {
  const src = `/// - outer item one\n///   - inner item one\n///   - inner item two\n/// - outer item two\nstruct S;\n`;
  const out = press(src, "rust", 0);
  assert.equal(out.ok, true);
  assert.equal(
    out.replacement,
    "/// - outer item one\n///   - inner item one\n///   - inner item two\n/// - outer item two\n"
  );
  const two = pressAtLine(out.text, "rust", 0);
  assert.equal(two.replacement, out.replacement, "press two");
});

test("D14 an indented markdown code block keeps its lines and its columns", () => {
  const src = `/// Example:\n///\n///     let x = 1;\n///     let y = x + 1;\nstruct S;\n`;
  const out = press(src, "rust", 0);
  assert.equal(out.ok, true);
  assert.equal(out.replacement, "/// Example:\n///\n///     let x = 1;\n///     let y = x + 1;\n");
  const two = pressAtLine(out.text, "rust", 0);
  assert.equal(two.replacement, out.replacement, "press two");
});

test("D15 a four-backtick fence around a three-backtick fence is broken", () => {
  const src =
    "/// ````\n" +
    "/// ```rust\n" +
    "/// let x = 1;\n" +
    "/// ```\n" +
    "/// ````\n" +
    "struct S;\n";
  const out = press(src, "rust", 0);
  assert.equal(out.ok, true);
  // The inner opener closes the outer fence, so the inner body escapes the
  // fence and the trailing ```` opens an unterminated one.
  assert.equal(
    out.replacement,
    "/// ````\n/// ```rust\n/// let x = 1;\n/// ```\n/// ````\n"
  );
  const second = pressAtLine(out.text, "rust", 0);
  assert.equal(second.ok, true);
  assert.equal(second.replacement, out.replacement, "press two on the nested fence");
});

// =========================================================================
// E. Idempotence. Ship condition 3.
// =========================================================================

// A lone `-` (or `*`, `+`, `1.`) is ordinary prose on press one, and the wrap
// can land it at the start of a continuation line.
//
// UPDATED after the second round. This row recorded that press two then read it
// as a LIST MARKER and that the bytes happened to hold anyway. The generalised
// continuation rule removes the re-promotion at its root: the line above could
// not have taken the hyphen, so the hyphen is a continuation and its own kind is
// never read. The byte assertions are untouched and still the point of the row;
// the shape assertion is inverted, so it now fails if the re-promotion returns.
test("P13 a lone hyphen at a wrap boundary is NOT re-promoted, and the bytes hold", () => {
  // 19 three-letter words fill to column 75 of a 76 budget, so the `-` cannot
  // join and starts the next line.
  const head = Array(19).fill("abc").join(" ");
  const tail = "- the remainder of this sentence has to be long enough that it wraps again onto a third line here";
  const src = `${head} ${tail}\nstruct S;\n`;
  const one = press(src, "rust", 0);
  assert.equal(one.ok, true);
  assert.equal(one.region.kind, "prose");
  const two = pressAtLine(one.text, "rust", 0);
  assert.equal(two.ok, true);
  // The prose the second press sees is the SAME paragraph again: the hyphen line
  // is a wrapped continuation, not a structural unit of its own.
  assert.equal(two.region.prose.includes("\n- the remainder"), false, JSON.stringify(two.region.prose));
  assert.ok(two.region.prose.includes("abc - the remainder"), JSON.stringify(two.region.prose));
  assert.equal(two.replacement, one.replacement);
  const three = pressAtLine(two.text, "rust", 0);
  assert.equal(three.ok, true);
  assert.equal(three.replacement, two.replacement);
});

test("D23 a marker token on a marker's continuation line breaks press two", () => {
  // The continuation of a `12.` item is indented four columns. On press two the
  // trimmed continuation reads as a `##` heading, so it becomes a unit of its
  // own and comes back flush. The indent the first press wrote is gone.
  const filler = Array(15).fill("aaaa").join(" ");
  const src = `12. ${filler} ## tail words here\nx = 1\n`;
  const one = press(src, "python", 0);
  assert.equal(one.ok, true);
  assert.equal(
    one.replacement,
    "# 12. aaaa aaaa aaaa aaaa aaaa aaaa aaaa aaaa aaaa aaaa aaaa aaaa aaaa aaaa aaaa\n#     ## tail words here\n"
  );
  const two = pressAtLine(one.text, "python", 0);
  assert.equal(two.ok, true);
  assert.equal(two.replacement, one.replacement, "ship condition 3: running twice changes nothing");
});

test("D16 a markdown table keeps its rows and its interior alignment", () => {
  const src = `/// | name | kind |\n/// |------|------|\n/// | id   | u32  |\nstruct S;\n`;
  const out = press(src, "rust", 0);
  assert.equal(out.ok, true);
  assert.equal(out.replacement, "/// | name | kind |\n/// |------|------|\n/// | id   | u32  |\n");
  const two = pressAtLine(out.text, "rust", 0);
  assert.equal(two.replacement, out.replacement, "press two");
});

test("D17 each markdown link reference definition keeps its own line", () => {
  const src = `/// See [alpha] and [beta].\n///\n/// [alpha]: https://example.invalid/a\n/// [beta]: https://example.invalid/b\nstruct S;\n`;
  const out = press(src, "rust", 0);
  assert.equal(out.ok, true);
  assert.equal(
    out.replacement,
    "/// See [alpha] and [beta].\n///\n/// [alpha]: https://example.invalid/a\n/// [beta]: https://example.invalid/b\n"
  );
  const two = pressAtLine(out.text, "rust", 0);
  assert.equal(two.replacement, out.replacement, "press two");
});

test("P2 press three times on the ordinary shapes", () => {
  const cases = [
    ["rust", "/// - a list item that is long enough to need to wrap onto a second line and then a third line as well\nstruct S;\n"],
    ["rust", "/// # A heading that is long enough that it has to wrap onto a second line for sure yes indeed\nstruct S;\n"],
    ["rust", "/// 10. a numbered item with a three character marker that wraps onto a second and a third line here\nstruct S;\n"],
    ["go", "// a heading follows\n// # Errors\n// Returns an error when the map is empty and the caller asked for a key\nfunc f() {}\n"],
    ["rust", "/// text before\n/// ```\n///\n/// let x = 1;\n/// ```\n/// text after\nstruct S;\n"],
    ["rust", "/// # Example\n/// ```rust\n/// let x = 1;\n/// ```\n/// - and a list right after the fence\nstruct S;\n"],
  ];
  for (const [lang, src] of cases) {
    const one = press(src, lang, 0);
    assert.equal(one.ok, true, src);
    const two = pressAtLine(one.text, lang, 0);
    assert.equal(two.ok, true, src);
    assert.equal(two.replacement, one.replacement, `press two: ${JSON.stringify(src)}`);
    const three = pressAtLine(two.text, lang, 0);
    assert.equal(three.ok, true, src);
    assert.equal(three.replacement, two.replacement, `press three: ${JSON.stringify(src)}`);
  }
});

test("P3 press three times on a python docstring", () => {
  const src = `def f():\n    """One line of docs that is quite long and will need to wrap because it runs past eighty columns."""\n    return 1\n`;
  const one = press(src, "python", at(src, '"""'));
  assert.equal(one.ok, true);
  const two = press(one.text, "python", at(one.text, '"""'));
  assert.equal(two.ok, true);
  assert.equal(two.replacement, one.replacement);
  const three = press(two.text, "python", at(two.text, '"""'));
  assert.equal(three.ok, true);
  assert.equal(three.replacement, two.replacement);
});

test("P4 a paragraph break landing exactly at the word cap is stable", () => {
  const words = [];
  for (let n = 0; n < 25; n++) words.push(`w${n}a w${n}b.`);
  const src = `/// ${words.join(" ")}\nstruct S;\n`;
  const one = press(src, "rust", 0);
  assert.equal(one.ok, true);
  const two = pressAtLine(one.text, "rust", 0);
  assert.equal(two.ok, true);
  assert.equal(two.replacement, one.replacement);
});

// =========================================================================
// F. Under 80.
// =========================================================================

test("D18 a list marker plus one long token puts a MULTI-token line past 80", () => {
  const url = "https://example.invalid/a/very/long/path/segment/that/will/not/fit/on/one/line/at/all";
  const src = `/// - ${url}\nstruct S;\n`;
  const out = press(src, "rust", 0);
  assert.equal(out.ok, true);
  const line = out.replacement.split("\n")[0];
  assert.equal(line, `/// - ${url}`);
  assert.ok(widthOf(line) > 80, `width ${widthOf(line)}`);
  // The contract's exception is "a line carrying exactly one token". This line
  // carries two by any whitespace tokenizer, and three by the contract's own.
  assert.equal(line.trim().split(/\s+/).length, 3);
});

test("D19 a long backticked span puts a multi-word line past 80", () => {
  const span = "`impl Iterator<Item = (usize, &'a str, Option<Cow<'a, Path>>)> + Send + Sync + 'static`";
  const src = `/// The return type is ${span} and that is the whole story.\nstruct S;\n`;
  const out = press(src, "rust", 0);
  assert.equal(out.ok, true);
  const over = out.replacement.split("\n").filter((l) => widthOf(l) > 80);
  assert.equal(over.length, 1);
  assert.ok(over[0].trim().split(/\s+/).length > 1, over[0]);
});

test("I1 every over-80 line is caused by ONE unsplittable unit, all three kinds", () => {
  // Ship condition 2 as AMENDED 2026-08-12 (defect 14). The old wording admitted
  // only "a line carrying exactly one token", which the code has never produced
  // for a marker plus a long URL, or for a long backticked span, or for a fence.
  const url = "https://example.invalid/a/very/long/path/segment/that/will/not/fit/on/one/line/at/all";
  const span = "`impl Iterator<Item = (usize, &'a str, Option<Cow<'a, Path>>)> + Send + Sync + 'static`";
  const long = `let value = ${"x".repeat(90)};`;
  const rows = [
    ["over-long token", `/// - ${url}\nstruct S;\n`, url],
    ["backticked span", `/// The return type is ${span} and that is the whole story.\nstruct S;\n`, span],
    ["verbatim fence line", `/// \`\`\`\n/// ${long}\n/// \`\`\`\nstruct S;\n`, long],
  ];
  for (const [kind, src, unit] of rows) {
    const out = press(src, "rust", 0);
    assert.equal(out.ok, true, kind);
    const over = out.replacement.split("\n").filter((l) => widthOf(l) > 80);
    assert.equal(over.length, 1, `${kind}: ${JSON.stringify(over)}`);
    // The overflow is caused by ONE unsplittable unit, and removing it puts the
    // line back inside the budget. That is the amended condition, stated in bytes.
    assert.ok(over[0].includes(unit), kind);
    assert.ok(widthOf(over[0].replace(unit, "")) <= 80, kind);
    const two = pressAtLine(out.text, "rust", 0);
    assert.equal(two.replacement, out.replacement, `${kind} press two`);
  }
});

test("P5 a deep indent still terminates and does not loop", () => {
  const src = `${" ".repeat(100)}/// alpha beta gamma delta epsilon\nstruct S;\n`;
  const out = press(src, "rust", at(src, "///"));
  assert.equal(out.ok, true);
  assert.equal(out.replacement.split("\n").length, 6);
});

// =========================================================================
// G. Encoding and line endings.
// =========================================================================

test("P14 CRLF is preserved by the facade across all five languages", () => {
  const rows = [
    ["rust", "/// alpha beta gamma delta\r\n/// epsilon zeta eta theta\r\nstruct S;\r\n"],
    ["go", "// alpha beta gamma delta\r\n// epsilon zeta eta theta\r\nfunc f() {}\r\n"],
    ["csharp", "/// alpha beta gamma delta\r\n/// epsilon zeta eta theta\r\nclass C {}\r\n"],
    ["typescript", "// alpha beta gamma delta\r\n// epsilon zeta eta theta\r\nexport {};\r\n"],
    ["python", "# alpha beta gamma delta\r\n# epsilon zeta eta theta\r\nx = 1\r\n"],
  ];
  for (const [lang, src] of rows) {
    const out = press(src, lang, 0);
    assert.equal(out.ok, true, lang);
    assert.equal(out.replacement.includes("\r\n"), true, lang);
    assert.equal(/[^\r]\n/.test(out.replacement), false, `${lang}: ${JSON.stringify(out.replacement)}`);
    const two = press(out.text, lang, 0);
    assert.equal(two.replacement, out.replacement, `${lang} press two`);
  }
});

test("P15 a CRLF python docstring keeps CRLF on its wrapped interior lines", () => {
  const long = Array(24).fill("delta").join(" ");
  const src = `def f():\r\n    """${long}"""\r\n    return 1\r\n`;
  const out = press(src, "python", at(src, '"""'));
  assert.equal(out.ok, true);
  assert.equal(out.replacement.includes("\r\n"), true);
  assert.equal(/[^\r]\n/.test(out.replacement), false, JSON.stringify(out.replacement));
});

test("D21 renderRegion on its own emits the region's own line ending", () => {
  const src = "/// alpha beta gamma delta\r\n/// epsilon zeta eta theta\r\nstruct S;\r\n";
  const r = resolveTightenRegion({ text: src, languageId: "rust", cursor: 0 });
  assert.equal(r.ok, true);
  const direct = mod.renderRegion(r.region, "rust");
  const viaFacade = press(src, "rust", 0).replacement;
  assert.equal(direct.includes("\r\n"), true, "a caller on the contract's own facade must not get LF here");
  assert.equal(/[^\r]\n/.test(direct), false);
  assert.equal(direct, viaFacade);
});

test("D22 a non-breaking space and an ideographic space survive verbatim", () => {
  // Only space, tab, CR and LF are whitespace this command may move. Note the
  // oracle here is NOT `strip`: `\\s` matches U+00A0 and U+3000, so the helper
  // built to catch a word substitution could not see this one.
  const src = "/// alpha beta gamma　delta epsilon\nstruct S;\n";
  const out = press(src, "rust", 0);
  assert.equal(out.ok, true);
  assert.equal(out.replacement, "/// alpha beta gamma　delta epsilon\n");
  assert.equal(out.replacement.includes(" "), true);
  assert.equal(out.replacement.includes("　"), true);
});

test("P6 a lone surrogate, a zero width space and an emoji survive verbatim", () => {
  const odd = "alpha\ud800beta zero​width gamma \u{1f600} delta epsilon zeta";
  const src = `/// ${odd}\nstruct S;\n`;
  const out = press(src, "rust", 0);
  assert.equal(out.ok, true);
  assert.equal(strip(out.region.prose), strip(out.replacement.replace(/^\/\/\/ ?/gm, "")));
  assert.ok(out.replacement.includes("\ud800"));
  assert.ok(out.replacement.includes("​"));
});

test("P7 an unmatched backtick, a trailing backtick and a nested one keep every character", () => {
  const cases = [
    "an `unmatched tick starts here and never closes at all in this line",
    "a trailing tick at the very end of the prose line here `",
    "a ``double`` tick span and a `single` one in the same prose line",
    "`a spanning span` glued to (`Vec<T, A>`) punctuation here now",
  ];
  for (const body of cases) {
    const src = `/// ${body}\nstruct S;\n`;
    const out = press(src, "rust", 0);
    assert.equal(out.ok, true, body);
    const back = out.replacement
      .split("\n")
      .filter((l) => l !== "")
      .map((l) => l.replace(/^\/\/\/ ?/, ""))
      .join(" ");
    assert.equal(strip(back), strip(body), body);
  }
});

test("P8 a tab inside prose and a tab indent", () => {
  const src = "\t/// alpha\tbeta gamma delta epsilon zeta\nstruct S;\n";
  const out = press(src, "rust", 0);
  assert.equal(out.ok, true);
  assert.equal(out.replacement, "\t/// alpha beta gamma delta epsilon zeta\n");
});

test("P9 no trailing newline at end of file", () => {
  const src = "/// alpha beta gamma delta epsilon zeta eta theta iota kappa";
  const out = press(src, "rust", 0);
  assert.equal(out.ok, true);
  assert.equal(out.replacement.endsWith("\n"), false);
  assert.equal(out.text, src);
});

// =========================================================================
// H. Contract gap probes.
// =========================================================================

test("G1 region.prefix for kind prose is the language doc prefix", () => {
  const rows = [
    ["rust", "/// "],
    ["csharp", "/// "],
    ["go", "// "],
    ["typescript", "// "],
    ["python", "# "],
  ];
  for (const [lang, prefix] of rows) {
    const src = "alpha beta gamma delta epsilon\n";
    const r = resolveTightenRegion({ text: src, languageId: lang, cursor: 0 });
    assert.equal(r.ok, true, lang);
    assert.equal(r.region.kind, "prose", lang);
    assert.equal(r.region.prefix, prefix, lang);
  }
});

test("G4 every TS_LANGUAGE_IDS member is served with the same prefix", () => {
  for (const lang of ["typescript", "javascript", "typescriptreact", "javascriptreact"]) {
    assert.equal(servesTighten(lang), true, lang);
    const src = "alpha beta gamma delta epsilon\n";
    const out = press(src, lang, 0);
    assert.equal(out.ok, true, lang);
    assert.equal(out.replacement, "// alpha beta gamma delta epsilon\n", lang);
  }
  assert.equal(servesTighten("java"), false);
  const r = resolveTightenRegion({ text: "// x\n", languageId: "java", cursor: 0 });
  assert.equal(r.ok, false);
  assert.ok(r.refusal.includes("java"), r.refusal);
});

test("G5 width charges a flat tabWidth per tab, not the next tab stop", () => {
  const src = "  /// alpha beta\n";
  const a = resolveTightenRegion({ text: src, languageId: "rust", cursor: 0 });
  assert.equal(a.ok, true);
  // Two-space indent and a tab indent of the same nominal width wrap the same
  // number of tokens only under the flat model.
  const words = Array(30).fill("seven7").join(" ");
  const spaces = press(`  /// ${words}\nstruct S;\n`, "rust", 0);
  const tabs = press(`\t/// ${words}\nstruct S;\n`, "rust", 0, 2);
  assert.equal(spaces.ok, true);
  assert.equal(tabs.ok, true);
  assert.equal(
    spaces.replacement.split("\n").map((l) => l.replace(/^\s+/, "")).join("\n"),
    tabs.replacement.split("\n").map((l) => l.replace(/^\s+/, "")).join("\n")
  );
});

test("D24 a paragraph break lands INSIDE a sentence, right after an abbreviation", () => {
  // 48 words in 24 two-word sentences, then a sentence whose first fragment is
  // "cc e.g.". The abbreviation reads as a sentence end, the running count hits
  // 50 there, and the break is inserted mid-sentence.
  const head = Array(24).fill("aa bb.").join(" ");
  const src = `/// ${head} cc e.g. dd ee ff.\nstruct S;\n`;
  const out = press(src, "rust", 0);
  assert.equal(out.ok, true);
  const lines = out.replacement.split("\n");
  const blank = lines.indexOf("///");
  assert.notEqual(blank, -1, out.replacement);
  assert.ok(lines[blank - 1].endsWith("cc e.g."), lines[blank - 1]);
  assert.equal(lines[blank + 1], "/// dd ee ff.");
});

test("G6 sentence splitting fires on abbreviations", () => {
  const { tightenParagraphs } = mod;
  const short = tightenParagraphs("Use e.g. the map. Ok. Next one.");
  assert.deepEqual(short, ["Use e.g. the map. Ok. Next one."], "under the cap it does not matter");
  // Over the cap the split point is decided by the abbreviation boundary.
  const filler = Array(48).fill("word").join(" ");
  const over = tightenParagraphs(`Use e.g. ${filler} tail. Second sentence here.`);
  assert.equal(over.length, 2);
  assert.ok(over[0].startsWith("Use e.g."), over[0]);
});

test("G7 a docstring whose opener does not start its line", () => {
  const src = 'def f():\n    x = 1; """not a docstring but words here"""\n';
  const r = resolveTightenRegion({ text: src, languageId: "python", cursor: at(src, '"""') });
  assert.equal(r.ok, false);
  // CHANGED BY THE TRIAGE, and it is the one G row that moved. This probe
  // recorded that `return """..."""` was accepted as prose and commented out.
  // Mechanism D refuses it twice over: `return` opens a declaration, and the
  // line carries a quote character. A G row records what the product does, and
  // the product now does something else on purpose.
  const inline = 'def f():\n    return """a value with several words in it"""\n';
  const r2 = resolveTightenRegion({ text: inline, languageId: "python", cursor: at(inline, '"""') });
  assert.equal(r2.ok, false);
  assert.ok(/return|quote/.test(r2.refusal), r2.refusal);
});

test("G8 an unclosed fence, an unterminated docstring and a bare EOF", () => {
  const fence = "/// text\n/// ```\n/// let x = 1;\nstruct S;\n";
  const f = press(fence, "rust", 0);
  assert.equal(f.ok, true);
  assert.equal(f.replacement, "/// text\n/// ```\n/// let x = 1;\n");

  const doc = 'def f():\n    """never closes\n';
  const d = resolveTightenRegion({ text: doc, languageId: "python", cursor: at(doc, "never") });
  assert.equal(d.ok, false);
  assert.ok(/never closes|cannot be found/.test(d.refusal), d.refusal);
});

test("G2 a fenced line longer than the budget is emitted past column 80", () => {
  const long = `let value = ${"x".repeat(90)};`;
  const src = `/// \`\`\`\n/// ${long}\n/// \`\`\`\nstruct S;\n`;
  const out = press(src, "rust", 0);
  assert.equal(out.ok, true);
  assert.ok(out.replacement.split("\n").some((l) => widthOf(l) > 80));
});

test("G3 a heading continuation is indented two columns", () => {
  const src = `/// # ${Array(20).fill("delta").join(" ")}\nstruct S;\n`;
  const out = press(src, "rust", 0);
  assert.equal(out.ok, true);
  const lines = out.replacement.split("\n").filter((l) => l !== "");
  assert.ok(lines.length > 1);
  assert.ok(lines[1].startsWith("///   "), JSON.stringify(lines[1]));
});

// =========================================================================
// I. Region choice.
// =========================================================================

test("P10 adjacent blocks with different openers or indents stay separate", () => {
  const src = `/// doc line one here\n//! inner line one here\n    // deeper line here\n// flush line here\nstruct S;\n`;
  const a = press(src, "rust", 0);
  assert.equal(a.ok, true);
  assert.equal(a.replacement, "/// doc line one here\n");
  const b = pressAtLine(src, "rust", 1);
  assert.equal(b.ok, true);
  assert.equal(b.replacement, "//! inner line one here\n");
  const c = pressAtLine(src, "rust", 2);
  assert.equal(c.ok, true);
  assert.equal(c.replacement, "    // deeper line here\n");
});

test("P11 a bare opener line is a paragraph break and not a block end", () => {
  const src = `/// one two three four\n///\n/// five six seven eight\nstruct S;\n`;
  const out = press(src, "rust", 0);
  assert.equal(out.ok, true);
  assert.equal(out.replacement, "/// one two three four\n///\n/// five six seven eight\n");
});

// =========================================================================
// J. Fuzz. Deterministic PRNG, so a failure is reproducible from the seed.
// =========================================================================

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const VOCAB = [
  "alpha", "beta", "gamma", "delta.", "epsilon", "zeta!", "eta?", "theta",
  "-", "*", "+", "1.", "12.", "#", "##", "e.g.", "i.e.", "Ok.",
  "`a b c`", "`x`", "`", "``", "a`b", "std::collections::HashMap",
  "a-very-long-hyphenated-identifier-that-will-not-fit-inside-any-reasonable-budget-at-all",
  "https://example.invalid/one/two/three/four/five/six/seven/eight/nine",
  "é́", "\u{1f600}", "​", "word", "the", "and",
];

const BLOCK_LINES = [
  "some ordinary prose words here",
  "- a list item with words",
  "  a continuation of the item",
  "# A heading",
  "```",
  "```rust",
  "let x = 1;",
  "",
  "| a | b |",
  "more ordinary prose",
];

test("F1 fuzz: naked prose is idempotent from press two, in five languages", () => {
  const next = rng(20520812);
  const langs = ["rust", "csharp", "go", "typescript", "python"];
  const unstable = [];
  const lost = [];
  let tried = 0;
  for (let n = 0; n < 3000; n++) {
    const count = 4 + Math.floor(next() * 40);
    const words = [];
    for (let w = 0; w < count; w++) words.push(VOCAB[Math.floor(next() * VOCAB.length)]);
    const lang = langs[Math.floor(next() * langs.length)];
    const indent = "    ".repeat(Math.floor(next() * 3));
    const src = `${indent}${words.join(" ")}\nend\n`;
    const one = press(src, lang, indent.length);
    if (!one.ok) continue;
    tried++;
    const two = pressAtLine(one.text, lang, 0);
    assert.equal(two.ok, true, `seed row ${n} ${lang}: ${JSON.stringify(src)}`);
    const three = pressAtLine(two.text, lang, 0);
    assert.equal(three.ok, true, `seed row ${n}`);
    if (two.replacement !== one.replacement) {
      unstable.push(`row ${n} ${lang} press1!=press2\nsrc: ${JSON.stringify(src)}\none: ${JSON.stringify(one.replacement)}\ntwo: ${JSON.stringify(two.replacement)}`);
    } else if (three.replacement !== two.replacement) {
      unstable.push(`row ${n} ${lang} press2!=press3\nsrc: ${JSON.stringify(src)}`);
    }
    if (strip(two.region.prose) !== strip(one.region.prose)) {
      lost.push(`row ${n} ${lang}\nsrc: ${JSON.stringify(src)}\none: ${JSON.stringify(one.region.prose)}\ntwo: ${JSON.stringify(two.region.prose)}`);
    }
  }
  assert.ok(tried > 500, `only ${tried} rows got past the gate`);
  assert.deepEqual(lost.slice(0, 3), [], "VERBATIM LOST");
  assert.equal(unstable.length, 0, `${unstable.length} of ${tried} rows are not idempotent. First three:\n${unstable.slice(0, 3).join("\n---\n")}`);
});

test("F2 fuzz: comment blocks are idempotent from press two", () => {
  const next = rng(777123);
  const rows = [
    ["rust", "/// ", "struct S;"],
    ["rust", "//! ", "struct S;"],
    ["go", "// ", "func f() {}"],
    ["csharp", "/// ", "class C {}"],
    ["python", "# ", "x = 1"],
    ["typescript", "// ", "export {};"],
  ];
  let bad = 0;
  const unstable = [];
  const lost = [];
  for (let n = 0; n < 2000; n++) {
    const [lang, prefix, tailLine] = rows[Math.floor(next() * rows.length)];
    const indent = "  ".repeat(Math.floor(next() * 3));
    const count = 1 + Math.floor(next() * 7);
    const lines = [];
    for (let l = 0; l < count; l++) {
      const body = BLOCK_LINES[Math.floor(next() * BLOCK_LINES.length)];
      lines.push(`${indent}${prefix}${body}`.replace(/\s+$/, ""));
    }
    const src = `${lines.join("\n")}\n${tailLine}\n`;
    const one = press(src, lang, indent.length);
    if (!one.ok) continue;
    const two = pressAtLine(one.text, lang, 0);
    if (!two.ok) {
      bad++;
      assert.fail(`press two refused, row ${n}: ${JSON.stringify(src)} -> ${two.refusal}`);
    }
    if (two.replacement !== one.replacement) {
      unstable.push(`row ${n} ${lang}\nsrc: ${JSON.stringify(src)}\none: ${JSON.stringify(one.replacement)}\ntwo: ${JSON.stringify(two.replacement)}`);
    }
    if (strip(two.region.prose) !== strip(one.region.prose)) {
      lost.push(`row ${n} ${lang}\nsrc: ${JSON.stringify(src)}`);
    }
  }
  assert.equal(bad, 0);
  assert.deepEqual(lost.slice(0, 3), [], "VERBATIM LOST");
  assert.equal(unstable.length, 0, `${unstable.length} rows not idempotent. First three:\n${unstable.slice(0, 3).join("\n---\n")}`);
});

test("F3 fuzz: no crash and no throw on arbitrary bytes at arbitrary cursors", () => {
  const next = rng(31337);
  const alphabet = ["/", "#", "`", '"', "'", "\n", " ", "\t", "\r", "a", "1", ".", "-", "{", "}", ";", "=", "\\", "\u{1f600}", "\ud800"];
  for (let n = 0; n < 4000; n++) {
    let text = "";
    const len = Math.floor(next() * 60);
    for (let i = 0; i < len; i++) text += alphabet[Math.floor(next() * alphabet.length)];
    const lang = ["rust", "python", "go", "csharp", "typescript"][Math.floor(next() * 5)];
    const cursor = Math.floor(next() * (text.length + 1));
    // D0's hang. Skipped here so this row can hunt for a SECOND defect instead
    // of re-finding the first one and taking the suite down.
    if (text.startsWith("\n")) continue;
    const r = tightenAtCursor({ text, languageId: lang, cursor });
    assert.equal(typeof r.ok, "boolean");
    if (r.ok) {
      assert.equal(typeof r.replacement, "string");
      assert.ok(r.start <= r.end && r.end <= text.length);
    } else {
      assert.equal(typeof r.refusal, "string");
      assert.ok(r.refusal.length > 0);
    }
  }
});

test("P12 a trailing comment on a line of code is refused", () => {
  const src = `let x = 1; // a trailing note with several words\n`;
  const r = resolveTightenRegion({ text: src, languageId: "rust", cursor: at(src, "//") });
  assert.equal(r.ok, false);
});
