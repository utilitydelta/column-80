// BLIND ORACLE - session-v52 phase 1: THE RENDER.
//
// Bound to `session-v52/contract-p1.md`, written before the implementation
// exists. Nothing in this file has read `src/**`; every row below points at a
// sentence of that contract and says which one in a comment above it.
//
// THE SUBJECT IS THE FACADE. Every behavioural row drives `tightenAtCursor`,
// the contract's "product path; every ship condition is stated against it".
// `renderRegion` is touched in exactly one row, and only to pin that the facade
// and the helper agree - a row bound to a helper is how a leg sits dark.
//
// THE ORACLES ARE COMPUTED HERE. Ship conditions 1, 2 and 4 (verbatim, under
// eighty, no split token) are properties, and each is recomputed in this file
// from the contract's own words: strip whitespace and backticks by hand, expand
// tabs by hand, tokenise by hand. No helper from the module under test is
// trusted to grade its own output.
//
// Expected RED until phase 1 lands.
//
// Run: SKIP_LIVE=1 npx node --test test/blind-v52-p1-render.test.cjs

const test = require("node:test");
const assert = require("node:assert/strict");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "blind-v52-p1",
  `export { tightenAtCursor, resolveTightenRegion, renderRegion, TIGHTEN_COLUMN, TIGHTEN_PARAGRAPH_WORDS, TIGHTEN_TAB_WIDTH } from "../src/core/tightenRender";\n`
);
const {
  tightenAtCursor,
  resolveTightenRegion,
  renderRegion,
  TIGHTEN_COLUMN,
  TIGHTEN_PARAGRAPH_WORDS,
  TIGHTEN_TAB_WIDTH,
} = mod;
test.after(cleanup);

// ---------------------------------------------------------------------------
// Independent oracles. Contract clauses recomputed here, never asked of the
// module under test.
// ---------------------------------------------------------------------------

// Contract "The wrap": `width` expands tabs to `tabWidth`.
function widthOf(s, tabWidth) {
  let w = 0;
  for (const ch of s) w += ch === "\t" ? tabWidth : 1;
  return w;
}

// Ship condition 1: "Strip all whitespace and all backticks".
const strip = (s) => s.replace(/[\s`]/g, "");

// Contract "Languages": the doc prefix per language, used when naked prose is
// turned into a comment. Written out here so the test never asks the module
// what its own prefix is.
const DOC_PREFIX = {
  rust: "/// ",
  csharp: "/// ",
  go: "// ",
  typescript: "// ",
  python: "# ",
};

// The comment marker the replacement's lines carry, from the contract, not
// from the module: the region's own opener for a comment block, the language's
// doc prefix for naked prose, nothing at all for a docstring.
function markerFor(region, languageId) {
  if (region.kind === "docstring") return "";
  if (region.kind === "prose") return DOC_PREFIX[languageId].trim();
  return String(region.prefix).trim();
}

// The prose carried by a replacement: indentation and comment markers removed,
// docstring delimiter lines dropped. Used only inside the whitespace-and-
// backtick-insensitive comparison of ship condition 1.
function replacementProse(replacement, region, languageId) {
  const marker = markerFor(region, languageId);
  const out = [];
  for (const line of replacement.split("\n")) {
    const left = line.replace(/^[\t ]*/, "");
    if (region.kind === "docstring" && left.trim() === region.quote) continue;
    out.push(marker && left.startsWith(marker) ? left.slice(marker.length) : left);
  }
  return out.join("\n");
}

// Contract "The wrap": "A backticked span is ONE token, spaces included".
// Fixtures keep backtick spans whitespace-delimited so this stays exact.
function tokensOf(prose) {
  return prose.match(/`[^`]*`|\S+/g) || [];
}

// The body of a rendered line: indent and marker gone, so what is left is the
// tokens the wrap put there.
function bodyOf(line, region, languageId) {
  const marker = markerFor(region, languageId);
  let body = line.replace(/^[\t ]*/, "");
  if (marker && body.startsWith(marker)) body = body.slice(marker.length);
  return body;
}

function press(target) {
  let r;
  assert.doesNotThrow(() => {
    r = tightenAtCursor(target);
  }, "the facade never throws; bad input is a refusal");
  return r;
}

function ok(result, what) {
  assert.equal(result.ok, true, `${what}: expected an edit, got refusal ${JSON.stringify(result.refusal)}`);
  return result;
}

function cursorOn(text, needle, delta = 2) {
  const i = text.indexOf(needle);
  assert.ok(i >= 0, `fixture needle missing: ${needle}`);
  return i + delta;
}

// ---------------------------------------------------------------------------
// Fixtures.
// ---------------------------------------------------------------------------

const WORDS =
  "alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november oscar papa quebec romeo sierra tango".split(
    " "
  );

// Exactly `n` whitespace-separated words, all distinct across sentences, the
// last carrying the full stop that `(?<=[.!?])\s+` splits on.
function sentence(i, n = 10) {
  const w = [];
  for (let j = 0; j < n; j++) w.push(`${WORDS[(i * 7 + j) % WORDS.length]}${i}${j}`);
  return `${w.join(" ")}.`;
}

const LONG_PATH =
  "crate::rendering::pipeline::descriptors::AttachmentDescriptorBuilder::WithDepthStencil";
const BACKTICK_SPAN = "`fn encode(frame: &Frame, out: &mut Vec<u8>) -> Result<usize>`";

const RUST_BLOCK = [
  "pub struct Widget;",
  "",
  "/// The widget hands the incoming frame straight to the encoder without copying it first, which is the entire point of the design.",
  "/// It keeps a `RingBuffer<Frame>` around so that one slow consumer cannot stall the producer behind it.",
  "impl Widget {}",
  "",
].join("\n");

const TS_BLOCK = [
  "class Service {",
  "    // The service resolves the token out of the header and then asks the store for the session, and when the store is cold it warms the store first.",
  "    resolve() {}",
  "}",
  "",
].join("\n");

const CS_DEEP = [
  "namespace Contoso {",
  "    class Retry {",
  "        void Attempt() {",
  "            /// dictated note about the retry policy and the reason the backoff keeps doubling on every attempt until it meets the ceiling",
  "        }",
  "    }",
  "}",
  "",
].join("\n");

const GO_TABS = [
  "func serve() {",
  "\t\t// the handler writes the response out before it ever checks the context, which is the bug we keep hitting in production whenever load spikes",
  "}",
  "",
].join("\n");

const PY_DOCSTRING = [
  "def build(spec):",
  '    """',
  "    Build the widget described by the spec and return it, raising when the spec names a codec the runtime was never compiled with.",
  '    """',
  "    return None",
  "",
].join("\n");

const PY_ONELINE_DOCSTRING = [
  "class Codec:",
  '    """Decode the frame in place and return the number of bytes the header consumed."""',
  "",
].join("\n");

const PY_NAKED = [
  "def go():",
  "    the parser should skip over the header and start reading at the first frame boundary it can find",
  "",
].join("\n");

const RUST_NAKED = [
  "fn go() {",
  "    the parser should skip over the header and start reading at the first frame boundary it finds",
  "}",
  "",
].join("\n");

const TS_NAKED = [
  "function go() {",
  "    the parser should skip over the header and start reading at the first frame boundary it finds",
  "}",
  "",
].join("\n");

const GO_NAKED = [
  "func Go() {",
  "\tthe parser should skip over the header and start reading at the first frame boundary it finds",
  "}",
  "",
].join("\n");

const CS_NAKED = [
  "class Parser {",
  "    void Go() {",
  "        the parser should skip over the header and start reading at the first frame boundary",
  "    }",
  "}",
  "",
].join("\n");

const RUST_LIST = [
  "/// The widget supports the modes below and picks between them at open time.",
  "/// - the fast mode does the quick thing and skips the verification step entirely so that it can keep up with a fast producer",
  "/// - the slow mode verifies every frame against the manifest before it hands anything on",
  "/// 1. the first ordered step is to open the device",
  "/// # Panics",
  "fn open() {}",
  "",
].join("\n");

const RUST_FENCE = [
  "/// Here is the way that a caller is expected to drive it from the outside.",
  "/// ```",
  "/// let x = widget::new(1, 2);",
  "///     let y = x.encode();",
  "/// ```",
  "/// and that is all there is to it in the end.",
  "fn open() {}",
  "",
].join("\n");

const RUST_LONG_PATH = [
  "mod inner {",
  "    mod deeper {",
  `        /// the attachment is produced by ${LONG_PATH} and nothing else builds one.`,
  "    }",
  "}",
  "",
].join("\n");

const TS_BACKTICKS = [
  `// The encoder entry point is ${BACKTICK_SPAN} and it is the only one that borrows the frame.`,
  "export {};",
  "",
].join("\n");

// Ten sentences of ten words: 100 words on ONE dictated line.
const BRAIN_DUMP_SENTENCES = Array.from({ length: 10 }, (_, i) => sentence(i, 10));
const TS_BRAIN_DUMP = [`// ${BRAIN_DUMP_SENTENCES.join(" ")}`, "export {};", ""].join("\n");

// Three sentences of eight words: 24 words, under TIGHTEN_PARAGRAPH_WORDS.
const TS_SHORT_DUMP = [
  `// ${[sentence(11, 8), sentence(12, 8), sentence(13, 8)].join(" ")}`,
  "export {};",
  "",
].join("\n");

// Already broken into two paragraphs by a bare opener line.
const GO_ALREADY_BROKEN = [
  `// ${sentence(21, 9)}`,
  "//",
  `// ${sentence(22, 9)}`,
  "func f() {}",
  "",
].join("\n");

// The corpus the three ship-condition properties sweep. `needle` places the
// cursor; `+2` lands inside the line, never on its first character.
const CORPUS = [
  { name: "rust /// block", languageId: "rust", text: RUST_BLOCK, needle: "incoming frame" },
  { name: "typescript // block, indent 4", languageId: "typescript", text: TS_BLOCK, needle: "resolves the token" },
  { name: "csharp /// block, indent 12", languageId: "csharp", text: CS_DEEP, needle: "retry policy" },
  { name: "go // block, tab indent", languageId: "go", text: GO_TABS, needle: "writes the response" },
  { name: "go // block, tab indent, tabWidth 8", languageId: "go", text: GO_TABS, needle: "writes the response", tabWidth: 8 },
  { name: "python docstring", languageId: "python", text: PY_DOCSTRING, needle: "Build the widget" },
  { name: "python one-line docstring", languageId: "python", text: PY_ONELINE_DOCSTRING, needle: "Decode the frame" },
  { name: "python naked prose", languageId: "python", text: PY_NAKED, needle: "the parser should" },
  { name: "rust naked prose", languageId: "rust", text: RUST_NAKED, needle: "the parser should" },
  { name: "typescript naked prose", languageId: "typescript", text: TS_NAKED, needle: "the parser should" },
  { name: "go naked prose", languageId: "go", text: GO_NAKED, needle: "the parser should" },
  { name: "csharp naked prose", languageId: "csharp", text: CS_NAKED, needle: "the parser should" },
  { name: "rust markdown list", languageId: "rust", text: RUST_LIST, needle: "supports the modes" },
  { name: "rust fenced block", languageId: "rust", text: RUST_FENCE, needle: "the way that a caller" },
  { name: "rust long path, indent 8", languageId: "rust", text: RUST_LONG_PATH, needle: "the attachment is" },
  { name: "typescript backtick span", languageId: "typescript", text: TS_BACKTICKS, needle: "encoder entry point" },
  { name: "typescript brain dump", languageId: "typescript", text: TS_BRAIN_DUMP, needle: BRAIN_DUMP_SENTENCES[0].slice(0, 12) },
  { name: "typescript short dump", languageId: "typescript", text: TS_SHORT_DUMP, needle: sentence(11, 8).slice(0, 12) },
  { name: "go already broken", languageId: "go", text: GO_ALREADY_BROKEN, needle: sentence(21, 9).slice(0, 12) },
];

function pressCase(c) {
  const cursor = cursorOn(c.text, c.needle);
  const target = { text: c.text, languageId: c.languageId, cursor };
  if (c.tabWidth !== undefined) target.tabWidth = c.tabWidth;
  return { target, result: ok(press(target), c.name) };
}

// ---------------------------------------------------------------------------
// Constants [contract: "Constants, exported"].
// ---------------------------------------------------------------------------

test("the three exported constants are 80, 50 and 4 [contract: 'Constants, exported']", () => {
  assert.equal(TIGHTEN_COLUMN, 80);
  assert.equal(TIGHTEN_PARAGRAPH_WORDS, 50);
  assert.equal(TIGHTEN_TAB_WIDTH, 4);
});

// ---------------------------------------------------------------------------
// Ship condition 1: verbatim. The oracle is recomputed here.
// ---------------------------------------------------------------------------

for (const c of CORPUS) {
  test(`verbatim (${c.name}): prose survives stripped of whitespace and backticks [ship 1]`, () => {
    const { result } = pressCase(c);
    const before = strip(result.region.prose);
    const after = strip(replacementProse(result.replacement, result.region, c.languageId));
    assert.ok(before.length > 0, "the region carried prose to begin with");
    assert.equal(after, before, "not one character of prose was added, lost or reordered");
  });
}

// ---------------------------------------------------------------------------
// Ship condition 2: under 80, tabs expanded, the single-token line excepted.
// ---------------------------------------------------------------------------

for (const c of CORPUS) {
  test(`under eighty (${c.name}): every line fits, or carries exactly one token [ship 2]`, () => {
    const { result } = pressCase(c);
    const tabWidth = c.tabWidth ?? TIGHTEN_TAB_WIDTH;
    for (const line of result.replacement.split("\n")) {
      const w = widthOf(line, tabWidth);
      if (w <= TIGHTEN_COLUMN) continue;
      const body = bodyOf(line, result.region, c.languageId).trim();
      const single = /^`[^`]*`$/.test(body) || !/\s/.test(body);
      assert.ok(
        single,
        `line is ${w} columns wide and carries more than one token: ${JSON.stringify(line)}`
      );
    }
  });
}

// ---------------------------------------------------------------------------
// Ship condition 4: no wrap splits a token or a backticked span.
// ---------------------------------------------------------------------------

for (const c of CORPUS) {
  // The fenced case is emitted verbatim, so its interior is not tokenised.
  if (c.name === "rust fenced block") continue;
  test(`no split (${c.name}): every source token appears intact in the replacement [ship 4]`, () => {
    const { result } = pressCase(c);
    for (const tok of tokensOf(result.region.prose)) {
      assert.ok(
        result.replacement.includes(tok),
        `token was broken by the wrap: ${JSON.stringify(tok)}`
      );
    }
  });
}

// ---------------------------------------------------------------------------
// Ship condition 6: the indent is the region's own, unchanged.
// ---------------------------------------------------------------------------

for (const c of CORPUS) {
  test(`indent (${c.name}): every rendered line sits at the region's captured indent [ship 6]`, () => {
    const { result } = pressCase(c);
    const indent = result.region.indent;
    const cursorLineStart = c.text.lastIndexOf("\n", cursorOn(c.text, c.needle)) + 1;
    const sourceIndent = /^[\t ]*/.exec(c.text.slice(cursorLineStart))[0];
    assert.equal(indent, sourceIndent, "region.indent is the source line's own leading whitespace");
    for (const line of result.replacement.split("\n")) {
      if (line.length === 0) continue;
      assert.ok(
        line.startsWith(indent),
        `a rendered line walked off the region's indent: ${JSON.stringify(line)}`
      );
    }
  });
}

// ---------------------------------------------------------------------------
// Ship condition 3: idempotence, all five languages plus both Python shapes.
// ---------------------------------------------------------------------------

const IDEMPOTENT = CORPUS.filter((c) =>
  [
    "rust /// block",
    "typescript // block, indent 4",
    "csharp /// block, indent 12",
    "go // block, tab indent",
    "python docstring",
    "python one-line docstring",
    "python naked prose",
    "rust naked prose",
    "typescript naked prose",
    "go naked prose",
    "csharp naked prose",
    "rust markdown list",
    "rust fenced block",
    "typescript brain dump",
    "go already broken",
  ].includes(c.name)
);

for (const c of IDEMPOTENT) {
  test(`idempotent (${c.name}): the second press changes nothing [ship 3, ship 6]`, () => {
    const { target, result } = pressCase(c);
    const once = c.text.slice(0, result.start) + result.replacement + c.text.slice(result.end);

    // A cursor inside the block the first press produced: first non-blank
    // character of its second line, or of its first when it has only one.
    const lines = result.replacement.split("\n");
    const pick = lines.length > 1 && lines[1].trim().length > 0 ? 1 : 0;
    const off =
      (pick === 1 ? lines[0].length + 1 : 0) + Math.max(lines[pick].search(/\S/), 0) + 1;
    const cursor2 = result.start + off;

    const second = ok(
      press({ text: once, languageId: c.languageId, cursor: cursor2, tabWidth: target.tabWidth }),
      `${c.name} second press`
    );
    const twice = once.slice(0, second.start) + second.replacement + once.slice(second.end);
    assert.equal(twice, once, "press twice is press once, byte for byte");
    assert.equal(second.region.indent, result.region.indent, "the block did not walk right");
  });
}

// ---------------------------------------------------------------------------
// Ship condition 5 / region resolution: the three kinds and the five languages.
// ---------------------------------------------------------------------------

test("a comment-led line resolves kind 'line-comment' with the opener plus one space as the prefix [contract: 'Region resolution' 1]", () => {
  const { result } = pressCase(CORPUS[0]);
  assert.equal(result.region.kind, "line-comment");
  assert.equal(result.region.prefix, "/// ");
  assert.equal(result.region.indent, "");
  assert.equal(result.region.quote, undefined);
});

test("///, //! and // are three different blocks, each preserved verbatim as the prefix [contract: 'Region resolution' 1]", () => {
  const text = [
    "//! module level note about this crate and what it is for",
    "/// item level note about the function that sits below it",
    "// plain note about one implementation detail nearby here",
    "fn f() {}",
    "",
  ].join("\n");
  for (const [needle, prefix] of [
    ["module level", "//! "],
    ["item level", "/// "],
    ["plain note", "// "],
  ]) {
    const r = ok(press({ text, languageId: "rust", cursor: cursorOn(text, needle) }), needle);
    assert.equal(r.region.prefix, prefix, `${needle} keeps its own opener`);
    const lineStart = text.lastIndexOf("\n", cursorOn(text, needle)) + 1;
    const line = text.slice(lineStart, text.indexOf("\n", lineStart) + 1);
    assert.equal(text.slice(r.start, r.end), line, "a differing opener ends the block");
  }
});

test("a bare opener line is a paragraph break, not the end of the block [contract: 'Region resolution' 1]", () => {
  const text = [
    "/// first paragraph of the dictated note about the encoder",
    "///",
    "/// second paragraph of the dictated note about the decoder",
    "fn f() {}",
    "",
  ].join("\n");
  const r = ok(press({ text, languageId: "rust", cursor: cursorOn(text, "first paragraph") }), "bare opener");
  assert.ok(r.region.prose.includes("\n\n"), "the break survives as a blank line in the prose");
  assert.ok(strip(r.region.prose).includes("secondparagraph"), "the block spans past the bare opener");
  assert.equal(r.end, text.indexOf("fn f()"), "the block ends where the comments do");
});

test("two comment lines with different indents are two blocks [contract: 'Region resolution' 1]", () => {
  const text = [
    "/// outer line of dictated prose about the outer thing here",
    "    /// inner line of dictated prose about the inner thing here",
    "fn f() {}",
    "",
  ].join("\n");
  const r = ok(press({ text, languageId: "rust", cursor: cursorOn(text, "outer line") }), "outer");
  assert.equal(r.start, 0);
  assert.equal(r.end, text.indexOf("    ///"), "the indented comment is a separate block");
  assert.ok(!strip(r.region.prose).includes("innerline"));
});

test("a python docstring resolves kind 'docstring' with the quote, an empty prefix and the delimiter line's indent [contract: 'Region resolution' 2]", () => {
  const { result } = pressCase(CORPUS.find((c) => c.name === "python docstring"));
  assert.equal(result.region.kind, "docstring");
  assert.equal(result.region.quote, '"""');
  assert.equal(result.region.prefix, "");
  assert.equal(result.region.indent, "    ");
  assert.equal(PY_DOCSTRING.slice(result.start, result.end).trimStart().slice(0, 3), '"""');
});

test("a one-line docstring renders the same three-line way [contract: 'The docstring']", () => {
  const c = CORPUS.find((c) => c.name === "python one-line docstring");
  const { result } = pressCase(c);
  const lines = result.replacement.replace(/\n$/, "").split("\n");
  assert.ok(lines.length >= 3, `expected at least three lines, got ${JSON.stringify(lines)}`);
  assert.equal(lines[0], '    """');
  assert.equal(lines[lines.length - 1], '    """');
  for (const line of lines.slice(1, -1)) assert.ok(line.startsWith("    "), line);
});

test("a ''' docstring keeps its own delimiter verbatim [contract: 'Region resolution' 2]", () => {
  const text = [
    "def build(spec):",
    "    '''",
    "    Build the widget described by the spec and return it to the caller who asked for it.",
    "    '''",
    "",
  ].join("\n");
  const r = ok(press({ text, languageId: "python", cursor: cursorOn(text, "Build the widget") }), "'''");
  assert.equal(r.region.quote, "'''");
  assert.ok(r.replacement.startsWith("    '''\n"));
  assert.ok(!r.replacement.includes('"""'));
});

test("naked prose resolves kind 'prose' and renders with the language's doc prefix, all five languages [contract: 'Region resolution' 3 + 'Languages', ship 5]", () => {
  for (const name of [
    "rust naked prose",
    "typescript naked prose",
    "csharp naked prose",
    "go naked prose",
    "python naked prose",
  ]) {
    const c = CORPUS.find((x) => x.name === name);
    const { result } = pressCase(c);
    assert.equal(result.region.kind, "prose", name);
    const want = result.region.indent + DOC_PREFIX[c.languageId];
    for (const line of result.replacement.replace(/\n$/, "").split("\n")) {
      assert.ok(line.startsWith(want), `${name}: expected ${JSON.stringify(want)} on ${JSON.stringify(line)}`);
    }
  }
});

test("python naked prose becomes '#' comment lines IN PLACE, never moved into a body [contract: 'Region resolution' 3]", () => {
  const c = CORPUS.find((x) => x.name === "python naked prose");
  const { result } = pressCase(c);
  const after = PY_NAKED.slice(0, result.start) + result.replacement + PY_NAKED.slice(result.end);
  assert.ok(after.startsWith("def go():\n"), "the def line was not touched");
  assert.ok(after.includes("\n    # "), "the prose is now a # comment at its own indent");
  // Line-granular and in place: the replaced span is exactly the prose line.
  assert.equal(PY_NAKED.slice(result.start, result.end), PY_NAKED.split("\n")[1] + "\n");
});

// ---------------------------------------------------------------------------
// Ship condition 7: refusals. A sentence naming why, and never an edit.
// ---------------------------------------------------------------------------

function refuses(name, target, expectIn) {
  test(`refusal (${name}) [ship 7]`, () => {
    const r = press(target);
    assert.equal(r.ok, false, `expected a refusal, got ${JSON.stringify(r.replacement)}`);
    assert.equal(typeof r.refusal, "string");
    assert.ok(r.refusal.trim().split(/\s+/).length >= 3, `a sentence, not a code: ${r.refusal}`);
    assert.equal(r.start, undefined, "a refusal never carries an edit");
    assert.equal(r.end, undefined, "a refusal never carries an edit");
    assert.equal(r.replacement, undefined, "a refusal never carries an edit");
    if (expectIn) assert.ok(r.refusal.toLowerCase().includes(expectIn), `refusal names ${expectIn}: ${r.refusal}`);
  });
}

const CODE_LINE = ["fn f() {", "    let widget = compute(a, b);", "}", ""].join("\n");
refuses("a line of code carrying ; and =", {
  text: CODE_LINE,
  languageId: "rust",
  cursor: cursorOn(CODE_LINE, "let widget"),
});

const BRACE_LINE = ["fn f() {", "", "}", ""].join("\n");
refuses("a blank line", { text: BRACE_LINE, languageId: "rust", cursor: BRACE_LINE.indexOf("\n") + 1 });

const RUBY = ["# a dictated note about the widget and how it behaves", "puts 1", ""].join("\n");
refuses(
  "an unsupported languageId is named in the message",
  { text: RUBY, languageId: "ruby", cursor: cursorOn(RUBY, "dictated note") },
  "ruby"
);

const ENDS_PAREN = ["fn f() {", "    please call the widget factory now(", "}", ""].join("\n");
refuses("a prose-looking line ending with (", {
  text: ENDS_PAREN,
  languageId: "rust",
  cursor: cursorOn(ENDS_PAREN, "please call"),
});

const ENDS_COLON = ["def f():", "    consider each of the following items:", ""].join("\n");
refuses("a prose-looking line ending with :", {
  text: ENDS_COLON,
  languageId: "python",
  cursor: cursorOn(ENDS_COLON, "consider each"),
});

const ENDS_COMMA = ["fn f() {", "    the first of several different things,", "}", ""].join("\n");
refuses("a prose-looking line ending with ,", {
  text: ENDS_COMMA,
  languageId: "rust",
  cursor: cursorOn(ENDS_COMMA, "the first of"),
});

const THREE_WORDS = ["fn f() {", "    just three words", "}", ""].join("\n");
refuses("a line of only three words", {
  text: THREE_WORDS,
  languageId: "rust",
  cursor: cursorOn(THREE_WORDS, "just three"),
});

const BRACES = ["fn f() {", "    match the incoming frame against the manifest { }", "}", ""].join("\n");
refuses("a line carrying braces", {
  text: BRACES,
  languageId: "rust",
  cursor: cursorOn(BRACES, "match the incoming"),
});

refuses("an empty document", { text: "", languageId: "rust", cursor: 0 });
refuses("a cursor past the end of the text", { text: RUST_BLOCK, languageId: "rust", cursor: RUST_BLOCK.length + 50 });
refuses("a negative cursor", { text: RUST_BLOCK, languageId: "rust", cursor: -1 });

// ---------------------------------------------------------------------------
// The wrap: the two token rules, spelled as their own rows.
// ---------------------------------------------------------------------------

test("a token wider than the budget takes a line of its own and is never broken [contract: 'The wrap', ship 4]", () => {
  const c = CORPUS.find((x) => x.name === "rust long path, indent 8");
  const { result } = pressCase(c);
  assert.ok(result.replacement.includes(LONG_PATH), "the path is intact");
  const line = result.replacement.split("\n").find((l) => l.includes(LONG_PATH));
  assert.equal(
    bodyOf(line, result.region, "rust").trim(),
    LONG_PATH,
    "the over-long token is alone on its line"
  );
  assert.ok(widthOf(line, TIGHTEN_TAB_WIDTH) > TIGHTEN_COLUMN, "and it overflows rather than being split");
});

test("a backticked span containing spaces is one token and never splits across lines [contract: 'The wrap', ship 4]", () => {
  const c = CORPUS.find((x) => x.name === "typescript backtick span");
  const { result } = pressCase(c);
  const line = result.replacement.split("\n").find((l) => l.includes("`fn encode("));
  assert.ok(line, "the span starts somewhere");
  assert.ok(line.includes(BACKTICK_SPAN), `the span was split: ${JSON.stringify(line)}`);
});

test("a deeply indented block gets a smaller budget and still fits [contract: 'The wrap' budget, ship 2]", () => {
  const c = CORPUS.find((x) => x.name === "csharp /// block, indent 12");
  const { result } = pressCase(c);
  assert.equal(result.region.indent, "            ");
  const bodies = result.replacement
    .replace(/\n$/, "")
    .split("\n")
    .map((l) => bodyOf(l, result.region, "csharp"));
  assert.ok(bodies.length > 1, "the smaller budget forced a wrap");
  for (const line of result.replacement.split("\n")) {
    if (line.length === 0) continue;
    assert.ok(widthOf(line, TIGHTEN_TAB_WIDTH) <= TIGHTEN_COLUMN, JSON.stringify(line));
  }
});

test("a tab-indented block measures tabs at tabWidth, and the caller's tabWidth is honoured [contract: 'The wrap' width]", () => {
  const base = { text: GO_TABS, languageId: "go", cursor: cursorOn(GO_TABS, "writes the response") };
  const four = ok(press({ ...base }), "tabWidth default");
  const eight = ok(press({ ...base, tabWidth: 8 }), "tabWidth 8");
  assert.equal(four.region.indent, "\t\t");
  for (const line of eight.replacement.split("\n")) {
    if (line.length === 0) continue;
    assert.ok(line.startsWith("\t\t"), JSON.stringify(line));
    assert.ok(widthOf(line, 8) <= TIGHTEN_COLUMN, `${JSON.stringify(line)} at tabWidth 8`);
  }
  // A wider tab is a smaller budget, so the same prose cannot need fewer lines.
  // (Ignoring tabWidth entirely is already caught above: a budget computed at 4
  // puts these lines past column 80 once the tabs are measured at 8.)
  const lineCount = (r) => r.replacement.replace(/\n$/, "").split("\n").length;
  assert.ok(
    lineCount(eight) >= lineCount(four),
    "the wider tab buys a smaller budget, so the prose takes at least as many lines"
  );
});

// ---------------------------------------------------------------------------
// Units: fences, list items, headings.
// ---------------------------------------------------------------------------

test("a fenced block inside a doc comment survives verbatim, interior indentation included [contract: 'Units']", () => {
  const c = CORPUS.find((x) => x.name === "rust fenced block");
  const { result } = pressCase(c);
  const lines = result.replacement.split("\n");
  assert.ok(lines.includes("/// ```"), "the fences keep their own lines");
  assert.equal(lines.filter((l) => l.trim() === "/// ```").length, 2, "both fences survive");
  assert.ok(lines.includes("/// let x = widget::new(1, 2);"), "the fenced line is byte-identical");
  assert.ok(lines.includes("///     let y = x.encode();"), "the fenced interior is not re-indented");
  const open = lines.findIndex((l) => l === "/// ```");
  const close = lines.lastIndexOf("/// ```");
  assert.equal(close - open, 3, "nothing was wrapped into or out of the fence");
});

test("a markdown list item is a unit of its own and is never merged with its neighbour [contract: 'Units']", () => {
  const c = CORPUS.find((x) => x.name === "rust markdown list");
  const { result } = pressCase(c);
  const lines = result.replacement.split("\n");
  assert.ok(lines.some((l) => l.startsWith("/// - the fast mode")), "the first item opens its own line");
  assert.ok(lines.some((l) => l.startsWith("/// - the slow mode")), "the second item opens its own line");
  assert.ok(lines.some((l) => l.startsWith("/// 1. the first ordered step")), "the numbered item too");
  assert.ok(lines.some((l) => l.startsWith("/// # Panics")), "the heading too");
  for (const line of lines) {
    assert.ok(
      !(line.includes("fast mode") && line.includes("slow mode")),
      `two list items were merged: ${JSON.stringify(line)}`
    );
    assert.ok(
      !(line.includes("picks between them") && line.includes("fast mode")),
      `prose was merged into a list item: ${JSON.stringify(line)}`
    );
  }
});

test("a wrapped list item indents its continuation by the marker's width [contract: 'Units']", () => {
  const c = CORPUS.find((x) => x.name === "rust markdown list");
  const { result } = pressCase(c);
  const lines = result.replacement.split("\n");
  const i = lines.findIndex((l) => l.startsWith("/// - the fast mode"));
  const cont = lines[i + 1];
  assert.ok(cont.startsWith("///   "), `continuation sits under the marker: ${JSON.stringify(cont)}`);
  assert.notEqual(cont[6], " ", "indented by exactly the two columns of '- '");
});

// ---------------------------------------------------------------------------
// Paragraph breaking at TIGHTEN_PARAGRAPH_WORDS.
// ---------------------------------------------------------------------------

// The separator inside a line-comment block: indent + prefix, trailing
// whitespace stripped.
function separatorCount(replacement, region, languageId) {
  const sep = region.indent + markerFor(region, languageId);
  return replacement.split("\n").filter((l) => l === sep).length;
}

test("a hundred-word dictated line breaks into paragraphs at TIGHTEN_PARAGRAPH_WORDS [contract: 'Paragraph breaks']", () => {
  const c = CORPUS.find((x) => x.name === "typescript brain dump");
  const { result } = pressCase(c);
  assert.equal(
    separatorCount(result.replacement, result.region, "typescript"),
    1,
    `ten sentences of ten words is two paragraphs: ${JSON.stringify(result.replacement)}`
  );
  // The break falls between sentences, never mid-sentence.
  const sep = result.region.indent + markerFor(result.region, "typescript");
  const idx = result.replacement.split("\n").findIndex((l) => l === sep);
  const before = result.replacement.split("\n").slice(0, idx).join(" ");
  assert.ok(before.trimEnd().endsWith("."), "a paragraph closes on a sentence end");
});

test("a twenty-four-word dictated line is not broken at all [contract: 'Paragraph breaks']", () => {
  const c = CORPUS.find((x) => x.name === "typescript short dump");
  const { result } = pressCase(c);
  assert.equal(separatorCount(result.replacement, result.region, "typescript"), 0);
  assert.ok(!result.region.prose.includes("\n\n"), "there was no source break either");
});

test("a comment that arrived already broken keeps its paragraphs apart [contract: 'Paragraph breaks', ship 3]", () => {
  const c = CORPUS.find((x) => x.name === "go already broken");
  const { result } = pressCase(c);
  assert.equal(separatorCount(result.replacement, result.region, "go"), 1, "still exactly one break");
  const head21 = sentence(21, 9).split(" ")[0];
  const head22 = sentence(22, 9).split(" ")[0];
  for (const line of result.replacement.split("\n")) {
    assert.ok(!(line.includes(head21) && line.includes(head22)), `paragraphs merged: ${line}`);
  }
});

// ---------------------------------------------------------------------------
// The edit span, and the facade's agreement with renderRegion.
// ---------------------------------------------------------------------------

test("the span is line-granular and keeps the region's trailing newline [contract: TightenRegion 'Line-granular', renderRegion]", () => {
  const c = CORPUS[0];
  const { result } = pressCase(c);
  assert.ok(result.start === 0 || c.text[result.start - 1] === "\n", "start sits at a line start");
  assert.ok(result.end === c.text.length || c.text[result.end - 1] === "\n", "end sits just past a newline");
  assert.ok(result.replacement.endsWith("\n"), "the region ended with a newline, so the replacement does");

  const noTrailing = "/// a dictated note about the encoder and the reason it never copies the frame";
  const r2 = ok(press({ text: noTrailing, languageId: "rust", cursor: 6 }), "no trailing newline");
  assert.equal(r2.end, noTrailing.length);
  assert.ok(!r2.replacement.endsWith("\n"), "the region had no newline, so neither does the replacement");
});

test("the facade's replacement is exactly renderRegion of the resolved region [contract: 'The facade']", () => {
  for (const c of CORPUS) {
    const { target, result } = pressCase(c);
    const resolved = resolveTightenRegion(target);
    assert.equal(resolved.ok, true, c.name);
    assert.deepEqual(resolved.region, result.region, `${c.name}: the facade resolves the same region`);
    assert.equal(
      renderRegion(result.region, c.languageId, target.tabWidth),
      result.replacement,
      `${c.name}: the facade renders through renderRegion`
    );
  }
});

test("resolveTightenRegion refuses where the facade refuses, and never throws [contract: 'never throws']", () => {
  const target = { text: CODE_LINE, languageId: "rust", cursor: cursorOn(CODE_LINE, "let widget") };
  let r;
  assert.doesNotThrow(() => {
    r = resolveTightenRegion(target);
  });
  assert.equal(r.ok, false);
  assert.equal(typeof r.refusal, "string");
  assert.equal(r.region, undefined);
});
