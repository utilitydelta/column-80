// IMPLEMENTER (white-box) - session-v52 phase 1: the render. Cursor to a region
// (`src/core/tightenRegion.ts`), region to the bytes that replace it
// (`src/core/tightenRender.ts`).
//
// The contract is `session-v52/contract-p1.md`. A blind oracle tests the same
// surface from the contract alone; this file tests the seams the contract does
// not name - the tokenizer's backtick glue, the paragraph accumulator's
// prefix-greedy property, the opener extension that keeps `//!` out of a `///`
// block - plus every ship condition, because a ship condition is a test and not
// a review.
//
// Two of these exist because the product has already shipped the bug:
//   - the press-twice test per language, since the indent-drift bug has landed
//     in three separate write paths, every time by re-deriving a column at
//     write time instead of using the one the read captured;
//   - the verbatim test, which strips whitespace and backticks from both sides
//     and compares bytes, because "I read it and the words look the same" is
//     what this project's own manifesto forbids as evidence.
//
// Run: SKIP_LIVE=1 node --test test/impl-v52-p1-render.test.cjs

const test = require("node:test");
const assert = require("node:assert/strict");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-v52-p1-render",
  `export {
  TIGHTEN_COLUMN,
  TIGHTEN_PARAGRAPH_WORDS,
  TIGHTEN_TAB_WIDTH,
  renderRegion,
  resolveTightenRegion,
  tightenAtCursor,
  tightenParagraphs,
  tightenTokens,
} from "../src/core/tightenRender";\n`,
);
const {
  TIGHTEN_COLUMN,
  TIGHTEN_PARAGRAPH_WORDS,
  TIGHTEN_TAB_WIDTH,
  renderRegion,
  resolveTightenRegion,
  tightenAtCursor,
  tightenParagraphs,
  tightenTokens,
} = mod;
test.after(cleanup);

// ---------------------------------------------------------------- helpers

const cols = (line, tabWidth = 4) =>
  [...line].reduce((n, ch) => n + (ch === "\t" ? tabWidth : 1), 0);

/** Ship condition 1's fold: whitespace and backticks are the only things this
 *  command may move, so everything else has to survive byte for byte.
 *
 *  ASCII whitespace ONLY, and this is the whole point of the row. The first
 *  version of this helper stripped `\s`, which matches U+00A0 and U+3000 as
 *  well, so a render that replaced a non-breaking space with a plain space was
 *  INVISIBLE to the one test built to catch a substituted character. An
 *  instrument that cannot produce the failure it exists for is a fact about the
 *  instrument (adversarial review, defect 16). */
const bare = (text) => text.replace(/[ \t\r\n`]/g, "");

/** The prose out of a rendered block: openers off, delimiters off, nothing
 *  else touched. */
function renderedProse(replacement, region) {
  let lines = replacement.replace(/\n$/, "").split("\n");
  if (region.kind === "docstring") {
    lines = lines.slice(1, -1);
  }
  const opener = region.prefix.trim();
  return lines
    .map((line) => {
      const trimmed = line.trim();
      return opener !== "" && trimmed.startsWith(opener) ? trimmed.slice(opener.length) : trimmed;
    })
    .join(" ");
}

function press(text, languageId, cursor, tabWidth) {
  const result = tightenAtCursor({ text, languageId, cursor, tabWidth });
  assert.ok(result.ok, result.ok ? "" : `refused: ${result.refusal}`);
  return {
    result,
    next: text.slice(0, result.start) + result.replacement + text.slice(result.end),
  };
}

/** Every ship condition that holds for every shape, run as one gate. Returns
 *  the first press so a caller can assert the shape-specific part. */
function shipConditions(text, languageId, cursor, tabWidth = TIGHTEN_TAB_WIDTH) {
  const one = press(text, languageId, cursor, tabWidth);
  const region = one.result.region;

  // 1. Verbatim.
  assert.equal(
    bare(renderedProse(one.result.replacement, region)),
    bare(region.prose),
    "the rendered prose is not the region's prose",
  );

  // 2. Under 80, except a line carrying exactly one token.
  for (const line of one.result.replacement.replace(/\n$/, "").split("\n")) {
    if (cols(line, tabWidth) > TIGHTEN_COLUMN) {
      const content = line.trim().slice(region.prefix.trim().length);
      assert.equal(tightenTokens(content).length, 1, `over 80 with more than one token: ${line}`);
    }
  }

  // 6. The indent is the region's own, on every line.
  for (const line of one.result.replacement.replace(/\n$/, "").split("\n")) {
    if (line !== "") {
      assert.ok(line.startsWith(region.indent), `line lost the region's indent: ${JSON.stringify(line)}`);
    }
  }

  // 3. Idempotent. The second press starts one character into the opener, which
  //    is inside the region whatever shape it took.
  const two = press(one.next, languageId, region.start + region.indent.length + 1, tabWidth);
  assert.equal(two.next, one.next, "the second press moved bytes");
  return one;
}

// ---------------------------------------------------------------- fixtures

// One line, the way a mic leaves it: no breaks, no backticks, 96 words.
const DICTATED =
  "This walks the shard map and returns every segment that overlaps the requested key range. " +
  "It resolves each segment through the shard mem cache before touching disk, because the cache " +
  "holds the decoded footer and the disk copy does not. If a segment is missing the walk records " +
  "it on the channel and keeps going, since a partial answer is more useful to the caller than a " +
  "hard failure. The caller is expected to sort the result, because the map iterates in hash " +
  "order and the range scan wants key order.";

const TEN_WORDS = "One two three four five six seven eight nine ten.";

// ---------------------------------------------------------------- constants

test("the three constants are the contract's values", () => {
  assert.equal(TIGHTEN_COLUMN, 80);
  assert.equal(TIGHTEN_PARAGRAPH_WORDS, 50);
  assert.equal(TIGHTEN_TAB_WIDTH, 4);
});

// ---------------------------------------------------------------- languages

test("an unserved language refuses and names itself", () => {
  const result = resolveTightenRegion({ text: "-- a dictated line about the thing\n", languageId: "lua", cursor: 5 });
  assert.equal(result.ok, false);
  assert.match(result.refusal, /lua/);
});

test("all five language families resolve their own opener", () => {
  const rows = [
    ["rust", "/// ", "/// a line of dictated prose about the shard map\n"],
    ["typescript", "// ", "// a line of dictated prose about the shard map\n"],
    ["typescriptreact", "// ", "// a line of dictated prose about the shard map\n"],
    ["csharp", "/// ", "/// a line of dictated prose about the shard map\n"],
    ["go", "// ", "// a line of dictated prose about the shard map\n"],
    ["python", "# ", "# a line of dictated prose about the shard map\n"],
  ];
  for (const [languageId, prefix, text] of rows) {
    const result = resolveTightenRegion({ text, languageId, cursor: 6 });
    assert.ok(result.ok, `${languageId} refused`);
    assert.equal(result.region.prefix, prefix, languageId);
    assert.equal(result.region.kind, "line-comment", languageId);
  }
});

// ---------------------------------------------------------------- the block

test("the block is the maximal run at the same indent with the same opener", () => {
  const text = ["fn a() {}", "/// first", "/// second", "/// third", "fn b() {}", ""].join("\n");
  const result = resolveTightenRegion({ text, languageId: "rust", cursor: text.indexOf("second") });
  assert.ok(result.ok);
  assert.equal(result.region.start, text.indexOf("/// first"));
  assert.equal(result.region.end, text.indexOf("fn b()"));
  assert.equal(result.region.prose, "first second third");
});

test("`///`, `//!` and `//` are three different blocks", () => {
  const text = ["//! module note here", "/// item doc here", "// plain note here", ""].join("\n");
  const at = (needle) => {
    const result = resolveTightenRegion({ text, languageId: "rust", cursor: text.indexOf(needle) });
    assert.ok(result.ok);
    return result.region;
  };
  assert.equal(at("module").prefix, "//! ");
  assert.equal(at("module").prose, "module note here");
  assert.equal(at("item").prefix, "/// ");
  assert.equal(at("item").prose, "item doc here");
  assert.equal(at("plain").prefix, "// ");
  assert.equal(at("plain").prose, "plain note here");
});

test("two comment lines at different indents are two blocks", () => {
  const text = ["/// outer line of prose", "    /// inner line of prose", ""].join("\n");
  const inner = resolveTightenRegion({ text, languageId: "rust", cursor: text.indexOf("inner") });
  assert.ok(inner.ok);
  assert.equal(inner.region.indent, "    ");
  assert.equal(inner.region.prose, "inner line of prose");
});

test("a bare opener line is a paragraph break, not the end of the block", () => {
  const text = ["/// first para", "///", "/// second para", ""].join("\n");
  const result = resolveTightenRegion({ text, languageId: "rust", cursor: 4 });
  assert.ok(result.ok);
  assert.equal(result.region.prose, "first para\n\nsecond para");
  assert.equal(result.region.end, text.length);
  // And the break comes back as a bare opener with no trailing space.
  assert.equal(renderRegion(result.region, "rust"), "/// first para\n///\n/// second para\n");
});

test("a trailing comment on a line of code is not a block", () => {
  const text = "let x = 1; // a trailing note about the value\n";
  const result = resolveTightenRegion({ text, languageId: "rust", cursor: text.indexOf("trailing") });
  assert.equal(result.ok, false);
});

// ---------------------------------------------------------------- the wrap

test("greedy fill puts every line under 80 in all five languages", () => {
  const rows = [
    ["rust", `/// ${DICTATED}\n`],
    ["typescript", `// ${DICTATED}\n`],
    ["csharp", `        /// ${DICTATED}\n`],
    ["go", `// ${DICTATED}\n`],
    ["python", `    # ${DICTATED}\n`],
  ];
  for (const [languageId, text] of rows) {
    const one = shipConditions(text, languageId, text.indexOf("walks"));
    const lines = one.result.replacement.replace(/\n$/, "").split("\n");
    assert.ok(lines.length > 4, `${languageId} did not wrap`);
    for (const line of lines) {
      assert.ok(cols(line) <= 80, `${languageId} over 80: ${line}`);
    }
  }
});

test("a token wider than the budget takes its own line and overflows it", () => {
  const long = "crate::storage::shard::segment::footer::DecodedSegmentFooterBuilderExtremelyLong";
  const text = `/// short words here ${long} and more short words here after it\n`;
  const one = shipConditions(text, "rust", 8);
  const lines = one.result.replacement.replace(/\n$/, "").split("\n");
  const carrier = lines.find((line) => line.includes(long));
  assert.ok(carrier !== undefined, "the long token was destroyed");
  assert.equal(carrier, `/// ${long}`, "the long token shares its line");
  assert.ok(cols(carrier) > 80);
  // Nothing else overflows.
  for (const line of lines.filter((l) => l !== carrier)) {
    assert.ok(cols(line) <= 80, line);
  }
});

test("a backticked span with spaces in it is one token and never splits", () => {
  assert.deepEqual(tightenTokens("a `Vec<T, A>` b"), ["a", "`Vec<T, A>`", "b"]);
  assert.deepEqual(tightenTokens("(`Foo`)"), ["(`Foo`)"]);
  // An unmatched tick is an ordinary character; it must not swallow the rest.
  assert.deepEqual(tightenTokens("a ` b c"), ["a", "`", "b", "c"]);

  const span = "`HashMap<ShardId, Vec<SegmentFooter>>`";
  const text = `/// the walk returns ${span} keyed by shard so the caller can sort it by key order later on\n`;
  const one = shipConditions(text, "rust", 8);
  const lines = one.result.replacement.split("\n");
  assert.ok(
    lines.some((line) => line.includes(span)),
    "the backticked span was split across lines",
  );
});

test("the verbatim oracle can SEE a non-ASCII whitespace substitution", () => {
  // The oracle before this one stripped `\s`, so the two strings below folded to
  // the same bytes and the check that exists to catch a substituted character
  // could not catch this one. Proving the instrument first, then the product.
  assert.notEqual(bare("gamma delta"), bare("gamma delta"), "the fold is blind again");
  assert.notEqual(bare("gamma　delta"), bare("gamma delta"), "the fold is blind again");

  const text = `/// alpha beta gamma　delta epsilon zeta eta theta iota kappa lambda mu nu xi\nstruct S;\n`;
  const one = shipConditions(text, "rust", 8);
  assert.ok(one.result.replacement.includes("alpha beta"), "a non-breaking space was replaced");
  assert.ok(one.result.replacement.includes("gamma　delta"), "an ideographic space was replaced");
  // And the pair is ONE token to the wrapper, since neither is whitespace here.
  assert.deepEqual(tightenTokens("gamma　delta epsilon"), ["gamma　delta", "epsilon"]);
});

test("a tab in the indent is measured at tabWidth, not one column", () => {
  const text = `\t\t// ${DICTATED}\n`;
  const one = shipConditions(text, "go", text.indexOf("walks"), 8);
  for (const line of one.result.replacement.replace(/\n$/, "").split("\n")) {
    // A paragraph separator is a bare opener with the trailing space stripped.
    assert.ok(line === "\t\t//" || line.startsWith("\t\t// "), JSON.stringify(line));
    assert.ok(cols(line, 8) <= 80, `over 80 at tabWidth 8: ${JSON.stringify(line)}`);
  }
  // The indent comes back verbatim: tabs stay tabs.
  assert.ok(!one.result.replacement.includes("    //"));
});

// ---------------------------------------------------------- paragraph breaks

test("paragraphs close at the first sentence that reaches the cap", () => {
  const twelve = Array.from({ length: 12 }, () => TEN_WORDS).join(" ");
  const paragraphs = tightenParagraphs(twelve);
  assert.equal(paragraphs.length, 3, "120 words at a 50-word cap is 5 + 5 + 2 sentences");
  assert.equal(paragraphs[0].split(/\s+/).length, 50);
  assert.equal(paragraphs[2].split(/\s+/).length, 20);
});

test("re-running the accumulator on its own output returns it whole", () => {
  // This is the property that makes the second press a no-op, tested directly
  // rather than only through the bytes.
  for (const paragraph of tightenParagraphs(Array.from({ length: 12 }, () => TEN_WORDS).join(" "))) {
    assert.deepEqual(tightenParagraphs(paragraph), [paragraph]);
  }
});

test("a long dictated line comes back as several paragraphs separated by bare openers", () => {
  const text = `/// ${Array.from({ length: 12 }, () => TEN_WORDS).join(" ")}\n`;
  const one = shipConditions(text, "rust", 8);
  const separators = one.result.replacement.split("\n").filter((line) => line === "///");
  assert.equal(separators.length, 2, "three paragraphs need two separator lines");
});

test("a paragraph that arrived already broken is never merged with its neighbour", () => {
  const text = ["/// A short first paragraph.", "///", "/// A short second paragraph.", ""].join("\n");
  const one = shipConditions(text, "rust", 8);
  assert.equal(one.result.replacement, text);
});

// ---------------------------------------------------------------- structure

test("a fenced block is one unit and is emitted verbatim", () => {
  const text = [
    "/// prose above the fence which is long enough to need a wrap of its own here",
    "/// ```rust",
    "/// let x = Foo::new();",
    "///     let y = x.bar();",
    "/// ```",
    "/// prose below",
    "",
  ].join("\n");
  const one = shipConditions(text, "rust", 8);
  const lines = one.result.replacement.split("\n");
  assert.ok(lines.includes("/// ```rust"));
  assert.ok(lines.includes("/// let x = Foo::new();"));
  assert.ok(lines.includes("///     let y = x.bar();"), "the fence interior was re-indented");
  assert.ok(lines.includes("/// prose below"));
});

test("a list item wraps with its continuation indented by the marker's width", () => {
  const text = `/// - ${DICTATED}\n`;
  const one = shipConditions(text, "rust", 8);
  const lines = one.result.replacement.replace(/\n$/, "").split("\n");
  assert.ok(lines[0].startsWith("/// - "));
  for (const line of lines.slice(1)) {
    assert.ok(line.startsWith("///   ") && !line.startsWith("///    "), `bad continuation: ${line}`);
  }
});

test("consecutive list items stay separate units", () => {
  const text = ["/// - first item here", "/// - second item here", "/// 1. third item here", ""].join("\n");
  const one = shipConditions(text, "rust", 8);
  assert.equal(one.result.replacement, text);
});

test("a list item already wrapped in the source folds back into one unit", () => {
  const text = [
    "/// - a list item that the developer already wrapped by hand across two",
    "///   lines of the block",
    "/// - a second item",
    "",
  ].join("\n");
  const result = resolveTightenRegion({ text, languageId: "rust", cursor: 8 });
  assert.ok(result.ok);
  assert.equal(
    result.region.prose,
    "- a list item that the developer already wrapped by hand across two lines of the block\n- a second item",
  );
  shipConditions(text, "rust", 8);
});

test("a nested list survives under a long parent as well as a short one", () => {
  // Scraps S52-8, narrowed to nothing anyone will meet. The signal is whether
  // the line above had room, and the second round made it measure the line the
  // RENDER leaves, not the source line. A long parent item wraps, so its LAST
  // line is short and the nested item under it is plainly not a wrap artifact.
  const long = `/// - ${Array(17).fill("aaaa").join(" ")}\n///   - inner item one\n/// - outer two\nstruct S;\n`;
  const one = shipConditions(long, "rust", 8);
  assert.ok(one.result.replacement.includes("///   - inner item one"), one.result.replacement);
  assert.equal(one.result.replacement.includes("aaaa - inner item one"), false, "the nesting was flattened");
  const roomy = "/// - outer item one\n///   - inner item one\n/// - outer item two\nstruct S;\n";
  assert.equal(shipConditions(roomy, "rust", 8).result.replacement, roomy.replace("struct S;\n", ""));
});

test("renderRegion joins an indented continuation under a marker, not a flush paragraph", () => {
  const base = { kind: "line-comment", start: 0, end: 0, indent: "", prefix: "/// " };
  assert.equal(renderRegion({ ...base, prose: "- alpha\n  beta" }, "rust"), "/// - alpha beta\n");
  assert.equal(renderRegion({ ...base, prose: "# Errors\nbeta" }, "rust"), "/// # Errors\n/// beta\n");
});

test("a heading is its own unit and does not swallow the paragraph under it", () => {
  const text = ["/// # Errors", "/// Returns an error when the shard map is empty.", ""].join("\n");
  const one = shipConditions(text, "rust", 8);
  assert.equal(one.result.replacement, text);
});

// ---------------------------------------------------------------- docstring

test("a one-line Python docstring becomes the three-line shape and stays there", () => {
  const text = ['def go():', '    """Do the thing."""', "    return 1", ""].join("\n");
  const one = shipConditions(text, "python", text.indexOf("Do the"));
  assert.equal(one.result.region.kind, "docstring");
  assert.equal(one.result.region.quote, '"""');
  assert.equal(one.result.region.indent, "    ");
  assert.equal(one.result.replacement, '    """\n    Do the thing.\n    """\n');
  assert.ok(one.next.includes("    return 1"), "the body below the docstring moved");
});

test("a dictated Python docstring wraps at the docstring's own column", () => {
  const text = ["class Shard:", "    def walk(self):", `        """${DICTATED}"""`, "        return []", ""].join("\n");
  const one = shipConditions(text, "python", text.indexOf("walks"));
  const lines = one.result.replacement.replace(/\n$/, "").split("\n");
  assert.equal(lines[0], '        """');
  assert.equal(lines[lines.length - 1], '        """');
  for (const line of lines) {
    assert.ok(cols(line) <= 80, line);
    // A paragraph separator inside a docstring is a blank line: the prefix is empty and the
    // indent is stripped off the end with it.
    assert.ok(line === "" || line.startsWith("        "), JSON.stringify(line));
    assert.ok(!line.includes("#"), "a docstring is not a comment");
  }
});

test("a `'''` docstring keeps its own delimiter", () => {
  const text = ["def go():", "    '''Do the thing here.'''", ""].join("\n");
  const one = shipConditions(text, "python", text.indexOf("Do the"));
  assert.equal(one.result.region.quote, "'''");
  assert.equal(one.result.replacement, "    '''\n    Do the thing here.\n    '''\n");
});

test("a `#` line inside a docstring is docstring prose, not a comment block", () => {
  const text = ["def go():", '    """', "    # not a comment, a heading", '    """', ""].join("\n");
  const result = resolveTightenRegion({ text, languageId: "python", cursor: text.indexOf("not a") });
  assert.ok(result.ok);
  assert.equal(result.region.kind, "docstring");
});

test("code after the closing delimiter refuses rather than being swallowed", () => {
  const text = ['x = """some prose here"""; y = 2\n'];
  const result = resolveTightenRegion({ text: text[0], languageId: "python", cursor: 8 });
  assert.equal(result.ok, false);
});

test("an unterminated docstring refuses", () => {
  const text = ["def go():", '    """the prose starts here and never ends', ""].join("\n");
  const result = resolveTightenRegion({ text, languageId: "python", cursor: text.indexOf("prose") });
  assert.equal(result.ok, false);
  assert.match(result.refusal, /close/);
});

// ------------------------------------------------------------- naked prose

test("a naked dictated line above a signature becomes a comment in place", () => {
  const text = `${DICTATED}\nfn walk() {}\n`;
  const one = shipConditions(text, "rust", 10);
  assert.equal(one.result.region.kind, "prose");
  assert.equal(one.result.region.prefix, "/// ");
  assert.ok(one.result.replacement.startsWith("/// This walks"));
  assert.ok(one.next.endsWith("fn walk() {}\n"), "the signature below moved");
});

test("a naked Python line becomes a `#` comment IN PLACE, not a docstring", () => {
  const text = `def walk():\n    ${DICTATED}\n    return []\n`;
  const one = shipConditions(text, "python", text.indexOf("walks"));
  assert.equal(one.result.region.kind, "prose");
  assert.equal(one.result.region.prefix, "# ");
  for (const line of one.result.replacement.replace(/\n$/, "").split("\n")) {
    assert.ok(line === "    #" || line.startsWith("    # "), JSON.stringify(line));
  }
  assert.ok(one.next.includes("def walk():\n    # This walks"), "the line was relocated");
});

test("the naked-prose gate refuses everything that might be code", () => {
  const rows = [
    ["", "blank"],
    ["   ", "whitespace only"],
    ["let total = sum of the entries", "carries an ="],
    ["fn walk(map, range) -> Vec<Segment> {", "carries a {"],
    ["call the walker with the map;", "carries a ;"],
    ["walk the shard map and then(", "ends with ("],
    ["if the shard map is empty:", "ends with :"],
    ["the shard map, the range,", "ends with ,"],
    ["walk the map", "three words"],
  ];
  for (const [line, why] of rows) {
    const text = `${line}\nfn walk() {}\n`;
    const result = resolveTightenRegion({ text, languageId: "rust", cursor: 1 });
    assert.equal(result.ok, false, `accepted ${why}: ${line}`);
    assert.ok(result.refusal.length > 20, `refusal is not a sentence: ${result.refusal}`);
  }
});

test("one odd quote does not take every comment below it in the file", () => {
  // The scan owns its walk because a shared one that does not know these shapes
  // desynchronised and went dark on the rest of the file: 819 of 11,088 comment
  // lines in this repo's own TypeScript, 19 of 27 in one real Rust file.
  const rows = [
    ["rust", "fn q(s: &str) -> Option<usize> { s.find('\"') }\n", "a Rust char literal holding a quote"],
    ["rust", "let c = '\\\\'';\n", "a Rust escaped char literal"],
    ["typescript", "const closer = (s) => /^[\"'`)\\\\]}]+[;,]?$/.test(s);\n", "an arrow-function regex"],
    ["typescript", "function f(s) { return /^[\"'`]$/.test(s); }\n", "a regex after `return`"],
    ["typescript", "const m = `a ${x ? \"\" : ` and \\\\`${y}.\\\\` here`} b`;\n", "a nested template literal"],
    ["typescript", "const unclosed = \"never closes\n", "an unbalanced quote, resynced"],
  ];
  for (const [lang, head, why] of rows) {
    const text = `${head}\n// the shard map holds the write ahead log offsets for each key range here\n// a second line of the same block, long enough that the wrap has real work\n`;
    const result = tightenAtCursor({ text, languageId: lang, cursor: text.indexOf("the shard") + 3 });
    assert.ok(result.ok, `${why}: ${result.ok ? "" : result.refusal}`);
  }
});

test("an apostrophe in a dictated line does not swallow the lines below it", () => {
  // The literal scan is what keeps a `#` out of a Python triple-quoted string. A `'`
  // run that crosses a newline is an apostrophe, not a string, and treating it as one
  // refused every prose line after the first "don't" in the file.
  const text = `the caller does not own the map so it must not drop it\nthe walk records the callers' names on the channel\nthe second dictated line still has to serve here\n`;
  for (const needle of ["caller does", "callers'", "second dictated"]) {
    const result = resolveTightenRegion({ text, languageId: "python", cursor: text.indexOf(needle) });
    assert.ok(result.ok, result.ok ? "" : `${needle}: ${result.refusal}`);
  }
  // A real multi-line literal still hides its interior.
  const held = 'TEMPLATE = """\nrender the widget for the user\n"""\n';
  assert.equal(resolveTightenRegion({ text: held, languageId: "python", cursor: held.indexOf("render") }).ok, false);
});

test("a quoted line is refused but an intra-word apostrophe is not", () => {
  const quoted = `the message says hello world to everyone\n`;
  assert.ok(resolveTightenRegion({ text: quoted, languageId: "go", cursor: 4 }).ok);
  assert.equal(
    resolveTightenRegion({ text: `the message says "hello world" to everyone\n`, languageId: "go", cursor: 4 }).ok,
    false,
  );
  assert.equal(
    resolveTightenRegion({ text: `the message says 'hello world' to everyone\n`, languageId: "go", cursor: 4 }).ok,
    false,
  );
  assert.ok(resolveTightenRegion({ text: `the caller's map holds the callers' names\n`, languageId: "go", cursor: 4 }).ok);
});

test("four words with no code punctuation is accepted", () => {
  const result = resolveTightenRegion({ text: "walk the shard map\n", languageId: "rust", cursor: 2 });
  assert.ok(result.ok);
  assert.equal(result.region.prose, "walk the shard map");
});

// ---------------------------------------------------------------- the edit

test("a region with no trailing newline renders without one", () => {
  const text = "/// a dictated line with no terminator at all";
  const one = press(text, "rust", 8);
  assert.equal(one.result.end, text.length);
  assert.ok(!one.result.replacement.endsWith("\n"));
  assert.equal(one.next, text);
});

test("a CRLF file comes back CRLF", () => {
  const text = `/// ${DICTATED}\r\nfn walk() {}\r\n`;
  const one = press(text, "rust", text.indexOf("walks"));
  assert.ok(one.result.replacement.endsWith("\r\n"));
  assert.ok(!/[^\r]\n/.test(one.result.replacement), "a bare LF landed in a CRLF file");
  // And it is still stable under a second press.
  const region = one.result.region;
  const two = press(one.next, "rust", region.start + region.indent.length + 1);
  assert.equal(two.next, one.next);
});

test("the region is line-granular from either end of the block", () => {
  const text = ["fn a() {}", "/// first line", "/// last line", "fn b() {}", ""].join("\n");
  const first = resolveTightenRegion({ text, languageId: "rust", cursor: text.indexOf("/// first") });
  const last = resolveTightenRegion({ text, languageId: "rust", cursor: text.indexOf("last line") });
  assert.ok(first.ok && last.ok);
  assert.deepEqual(
    [first.region.start, first.region.end],
    [last.region.start, last.region.end],
    "the block depends on which line the cursor landed on",
  );
  assert.equal(text[first.region.start - 1], "\n");
  assert.equal(text[first.region.end - 1], "\n");
});

test("a cursor at offset zero on the first line of a block still resolves it", () => {
  const text = "/// a dictated line about the shard map\nfn walk() {}\n";
  const result = resolveTightenRegion({ text, languageId: "rust", cursor: 0 });
  assert.ok(result.ok);
  assert.equal(result.region.start, 0);
});

test("a refusal carries no edit at all", () => {
  const result = tightenAtCursor({ text: "let x = 1;\n", languageId: "rust", cursor: 3 });
  assert.equal(result.ok, false);
  assert.equal(result.start, undefined);
  assert.equal(result.replacement, undefined);
  assert.ok(/[a-z]/.test(result.refusal) && result.refusal.endsWith("."));
});

test("renderRegion uses the region's own prefix, never a re-derived `///`", () => {
  const region = {
    kind: "line-comment",
    start: 0,
    end: 0,
    indent: "  ",
    prefix: "//! ",
    prose: "a module note",
  };
  assert.equal(renderRegion(region, "rust"), "  //! a module note\n");
});

test("nothing throws on garbage", () => {
  const junk = [
    undefined,
    null,
    {},
    { text: 5, languageId: "rust", cursor: 0 },
    { text: "ok", languageId: 7, cursor: 0 },
    { text: "ok", languageId: "rust", cursor: -1 },
    { text: "ok", languageId: "rust", cursor: 99 },
    { text: "ok", languageId: "rust", cursor: 1.5 },
  ];
  for (const target of junk) {
    const result = tightenAtCursor(target);
    assert.equal(result.ok, false, JSON.stringify(target));
    assert.equal(typeof result.refusal, "string");
  }
  for (const region of [undefined, null, {}, { kind: "prose", prose: 3 }]) {
    assert.equal(renderRegion(region, "rust"), "");
  }
});

// -------------------------------------------------- the press-twice gate, x5

test("press twice changes nothing, in all five languages, on the dictated line", () => {
  const rows = [
    ["rust", `mod a {\n    /// ${DICTATED}\n    fn walk() {}\n}\n`, "walks"],
    ["typescript", `class A {\n  // ${DICTATED}\n  walk() {}\n}\n`, "walks"],
    ["csharp", `class A {\n    /// ${DICTATED}\n    void Walk() {}\n}\n`, "walks"],
    ["go", `// ${DICTATED}\nfunc Walk() {}\n`, "walks"],
    ["python", `class A:\n    def walk(self):\n        """${DICTATED}"""\n        return []\n`, "walks"],
  ];
  for (const [languageId, text, needle] of rows) {
    const one = shipConditions(text, languageId, text.indexOf(needle));
    // And a THIRD press, because a two-press cycle can still oscillate.
    const region = one.result.region;
    const two = press(one.next, languageId, region.start + region.indent.length + 1);
    const three = press(two.next, languageId, region.start + region.indent.length + 1);
    assert.equal(three.next, one.next, `${languageId} drifted on press three`);
    assert.ok(!one.next.includes("     ///"), `${languageId} walked right`);
  }
});

test("press twice changes nothing on a naked prose line, in all five languages", () => {
  const rows = [
    ["rust", `    ${DICTATED}\n    fn walk() {}\n`],
    ["typescript", `  ${DICTATED}\n  walk() {}\n`],
    ["csharp", `    ${DICTATED}\n    void Walk() {}\n`],
    ["go", `${DICTATED}\nfunc Walk() {}\n`],
    ["python", `    ${DICTATED}\n    return []\n`],
  ];
  for (const [languageId, text] of rows) {
    shipConditions(text, languageId, text.indexOf("walks"));
  }
});

test("press twice changes nothing on a block carrying every structure at once", () => {
  const text = [
    "    /// Walks the shard map and returns the overlapping segments in hash order for you.",
    "    ///",
    "    /// # Errors",
    "    /// - a missing segment is recorded on the channel and the walk keeps going regardless",
    "    /// - an empty map returns `Vec<SegmentFooter>` with nothing in it at all",
    "    ///",
    "    /// ```rust",
    "    /// let out = shard.walk(&range)?;",
    "    ///     assert!(out.is_empty());",
    "    /// ```",
    "    fn walk() {}",
    "",
  ].join("\n");
  const one = shipConditions(text, "rust", text.indexOf("Errors"));
  assert.ok(one.result.replacement.includes("    ///     assert!(out.is_empty());"));
  assert.ok(one.result.replacement.includes("    /// # Errors"));
});
