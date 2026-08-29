// White-box: the SECOND press (session-v62 phase 4a, S62-7).
//
// THE RUBRIC WAS SCORING A DOCUMENT THAT CONTAINED THE PRODUCT'S OWN CRITICISM,
// and everything below follows from that one fact. Measured on shipped code
// before this phase, on the contract's own Rust specimen:
//
//     press 1 elevated: clock, bool-param                       planted 2
//     press 2 elevated: clock, bool-param, undocumented, section-comment
//     press 2: clock above `pub fn`, bool-param and undocumented above `}`
//
// Three faces, one root:
//
//  1. PLACEMENT DRIFTS. The planner maps findings onto the STRIPPED region, so
//     the number it subtracts has to count stripped lines too. A
//     document-numbered card over an already-commented region walks every
//     finding below a planted comment down the body by the number of comment
//     lines above it.
//  2. THE CARD IS WRONG IN RUST. `docLines` walks up from the head and stops at
//     the first line that is not a doc line, and a planted `// C80 ...` block
//     between a `///` and the head is not one, so a documented function reads as
//     undocumented.
//  3. THE CARD IS WRONG IN GO, THE OTHER WAY. `//` IS Go's doc prefix, so a
//     planted comment reads AS documentation and an undocumented exported
//     function's finding VANISHES on the second press - taking the comment with
//     it, because the region strips what the card no longer replaces.
//
// The fix is one move: score the COMMENT-FREE document, and carry a LINE MAP so
// the card the human reads still names lines in the file they are looking at.
//
// TWO THINGS THIS FILE IS BUILT TO CATCH THAT PHASE 2'S TESTS COULD NOT:
//
//  - phase 2 re-planned with the SAME card, whose line numbers were never
//    renumbered against the injected text. That is not an input a real second
//    press can produce. Every press here is a WHOLE PASS - slice, score, plan,
//    apply - over the buffer the previous accept left behind.
//  - the FIRST PRESS MUST NOT MOVE. `the first press is byte-identical to the
//    pipeline that shipped before the scoring view existed` runs the old
//    coordinate path beside the new one on clean source and compares both the
//    card and the planned text.
//
// Run: node --test test/impl-v62-p4-secondpress.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-v62-p4-secondpress",
  `export * from "../src/core/criticizeGesture";
export { planInjection, stripCriticism } from "../src/core/criticizePlan";
export { sliceFunction } from "../src/core/criticizeSlice";
export { scoreFunction, DEFAULT_ELEVATION } from "../src/core/criticizeScore";
export { criticizeLangFor } from "../src/core/criticizeLang";
export { C80_TAG } from "../src/core/criticizeVoice";\n`,
);
test.after(cleanup);

const {
  cardInDocumentLines,
  criticizeLangFor,
  documentLineOf,
  injectionRegion,
  planInjection,
  scoreFunction,
  scoringView,
  sliceFunction,
  stripCriticism,
  viewLineAtOrAfter,
  viewLineAtOrBefore,
  C80_TAG,
  DEFAULT_ELEVATION,
} = mod;

// ---------------------------------------------------------------------------
// One whole press, in the facade's own order
//
// `src/vscode/criticize.ts` holds the editor, the transport and the channel;
// the ORDER is what this reproduces, and the last test in this file pins the
// facade's source against it so the two cannot drift apart silently.
// ---------------------------------------------------------------------------

/** Where a real `resolveFunctionAtCursor` puts `headOffset`: at the declaration
 *  itself, past the indent, never at the line start. */
function headOffsetOf(text, line) {
  const lines = text.split("\n");
  let offset = 0;
  for (let i = 0; i < line - 1; i++) {
    offset += lines[i].length + 1;
  }
  return offset + /^[ \t]*/.exec(lines[line - 1])[0].length;
}

/** One past the last byte of `line`, which is where `span.end` lands. */
function endOffsetOf(text, line) {
  const lines = text.split("\n");
  let offset = 0;
  for (let i = 0; i < line; i++) {
    offset += lines[i].length + (i === line - 1 ? 0 : 1);
  }
  return offset;
}

/** The head and the last line of the function, the way a symbol provider would
 *  hand them over: found again in the CURRENT buffer on every press. */
function locate(text, fixture) {
  const lines = text.split("\n");
  const head = lines.findIndex((line) => fixture.head.test(line));
  assert.ok(head >= 0, `${fixture.name}: no declaration head in the buffer`);
  let end = head;
  for (let i = head + 1; i < lines.length; i++) {
    if (fixture.end.test(lines[i])) {
      end = i;
      break;
    }
  }
  assert.ok(end > head, `${fixture.name}: no end of function in the buffer`);
  return { headLine: head + 1, endLine: end + 1 };
}

/**
 * Slice, score, plan, and the bytes an accept would leave behind.
 *
 * `scored` is the card in VIEW lines, which is what the planner reads. `card` is
 * the card in DOCUMENT lines, which is what the human reads. Keeping both is the
 * point: one of them is wrong on every surface it is not for.
 */
function press(text, fixture) {
  const { headLine, endLine } = locate(text, fixture);
  const lang = criticizeLangFor(fixture.languageId);
  const view = scoringView(text.split(/\r?\n/), fixture.languageId);
  const unit = sliceFunction(
    view.lines,
    viewLineAtOrAfter(view, headLine),
    viewLineAtOrBefore(view, endLine),
    fixture.name,
    lang,
  );
  assert.ok(unit !== undefined, `${fixture.name}: the slice was refused`);
  const scored = scoreFunction(unit, lang, DEFAULT_ELEVATION);
  const card = cardInDocumentLines(scored, view);
  const region = injectionRegion(
    text,
    headOffsetOf(text, headLine),
    endOffsetOf(text, endLine),
    fixture.languageId,
  );
  const plan = planInjection(
    region.lines,
    viewLineAtOrAfter(view, region.startLine),
    scored,
    DEFAULT_ELEVATION,
  );
  return {
    view,
    scored,
    card,
    plan,
    region,
    headLine,
    endLine,
    accepted: text.slice(0, region.start) + plan.text + text.slice(region.end),
  };
}

/** The old coordinate path, exactly as it stood before the scoring view: score
 *  the document as it is, plan against the region's own document line. Only
 *  ever run on CLEAN source, where it is the definition of a correct first
 *  press. */
function pressTheOldWay(text, fixture) {
  const { headLine, endLine } = locate(text, fixture);
  const lang = criticizeLangFor(fixture.languageId);
  const unit = sliceFunction(text.split(/\r?\n/), headLine, endLine, fixture.name, lang);
  const card = scoreFunction(unit, lang, DEFAULT_ELEVATION);
  const region = injectionRegion(
    text,
    headOffsetOf(text, headLine),
    endOffsetOf(text, endLine),
    fixture.languageId,
  );
  const plan = planInjection(region.lines, region.startLine, card, DEFAULT_ELEVATION);
  return {
    card,
    plan,
    accepted: text.slice(0, region.start) + plan.text + text.slice(region.end),
  };
}

const flaggedRows = (card) =>
  card.rows.filter((row) => row.outcome.state === "flagged").map((row) => row.dimension);

const findingCount = (card) =>
  card.rows.reduce(
    (n, row) => n + (row.outcome.state === "flagged" ? row.outcome.findings.length : 0),
    0,
  );

const rowState = (card, dimension) =>
  card.rows.find((row) => row.dimension === dimension).outcome.state;

/**
 * Which CODE line each planted comment sits above, keyed by dimension.
 *
 * This is the placement question in one value: a comment that drifted is a
 * comment above a different line of code, and comparing texts alone would call
 * two presses equal when both were wrong in the same way.
 */
function attachments(text, token) {
  const lines = text.split("\n");
  const marker = `${token} ${C80_TAG}`;
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed.startsWith(marker)) {
      continue;
    }
    const dimension = /^([a-z][a-z-]*):/.exec(trimmed.slice(marker.length));
    let below = i + 1;
    while (
      below < lines.length &&
      (lines[below].trim().startsWith(token) || lines[below].trim() === "")
    ) {
      below++;
    }
    out.push({
      dimension: dimension === null ? trimmed : dimension[1],
      code: below < lines.length ? lines[below].trim() : "",
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// The five fixtures
//
// Every one of them is a function a developer would press this gesture on: it
// takes a bool, and it does one more thing wrong on a BODY line. The Rust and Go
// pair carry the doc hole in both directions, which is why each language appears
// with a documented and an undocumented shape.
//
// AMENDED 2026-08-29. The body line used to be a clock read. The four honesty
// dimensions became a model judgement that day and no longer fire in the
// synchronous pass (ruling 3, the amendment at the end of session-v64/goal.md),
// so the Rust specimen's body line is an unadmitted panic instead. The property
// under test is WHERE a body finding's comment lands, not which dimension it
// came from.
// ---------------------------------------------------------------------------

const RUST_DOCUMENTED = {
  languageId: "rust",
  name: "parse_header",
  token: "//",
  head: /pub fn parse_header/,
  end: /^ {4}\}$/,
  text: [
    "impl Parser {",
    "    /// Parses the header.",
    "    #[inline]",
    "    pub fn parse_header(&self, raw: &str, flag: bool) -> u32 {",
    "        let now = self.clock.unwrap();",
    "        raw.len() as u32 + flag as u32 + now",
    "    }",
    "}",
    "",
  ].join("\n"),
};

const GO_UNDOCUMENTED = {
  languageId: "go",
  name: "ParseHeader",
  token: "//",
  head: /^func ParseHeader/,
  end: /^\}$/,
  text: [
    "package main",
    "",
    "func ParseHeader(raw string, flag bool) uint32 {",
    "\tnow := time.Now()",
    "\treturn uint32(len(raw)) + uint32(now.Unix())",
    "}",
    "",
  ].join("\n"),
};

const GO_DOCUMENTED = {
  languageId: "go",
  name: "ParseHeader",
  token: "//",
  head: /^func ParseHeader/,
  end: /^\}$/,
  text: [
    "package main",
    "",
    "// ParseHeader turns a raw header into a count.",
    "func ParseHeader(raw string, flag bool) uint32 {",
    "\tnow := time.Now()",
    "\treturn uint32(len(raw)) + uint32(now.Unix())",
    "}",
    "",
  ].join("\n"),
};

const TS_DOCUMENTED = {
  languageId: "typescript",
  name: "widen",
  token: "//",
  head: /public widen/,
  end: /^ {2}\}$/,
  text: [
    "export class Store {",
    "  /** Widens the value. */",
    "  public widen(a: number, flag: boolean): number {",
    "    const now = Date.now();",
    "    return a + now + (flag ? 1 : 0);",
    "  }",
    "}",
    "",
  ].join("\n"),
};

const CS_DOCUMENTED = {
  languageId: "csharp",
  name: "Widen",
  token: "//",
  head: /public int Widen/,
  end: /^ {4}\}$/,
  text: [
    "public class Store",
    "{",
    "    /// <summary>Widens the value.</summary>",
    "    public int Widen(int a, bool flag)",
    "    {",
    "        var now = DateTime.Now;",
    "        return a + now.Second + (flag ? 1 : 0);",
    "    }",
    "}",
    "",
  ].join("\n"),
};

const PY_DOCUMENTED = {
  languageId: "python",
  name: "widen",
  token: "#",
  head: /def widen/,
  end: /return a \+ now/,
  text: [
    "class Store:",
    "    def widen(self, a: int, flag: bool) -> float:",
    '        """Widens the value."""',
    "        now = time.time() if flag else 0.0",
    "        return a + now",
    "",
  ].join("\n"),
};

const FIVE = [RUST_DOCUMENTED, GO_UNDOCUMENTED, TS_DOCUMENTED, CS_DOCUMENTED, PY_DOCUMENTED];

// ===========================================================================
// The ratifying measurement
//
// The goal's own words: run the gesture twice, accept both times, and the
// function has the same comments it had after the first accept.
// ===========================================================================

test("press, accept, press, accept leaves the buffer the first accept left, in all five languages", () => {
  for (const fixture of FIVE) {
    const first = press(fixture.text, fixture);
    assert.ok(first.plan.planted > 0, `${fixture.languageId}: the fixture plants something`);
    assert.strictEqual(first.plan.stripped, 0, `${fixture.languageId}: the source arrived clean`);

    const second = press(first.accepted, fixture);
    assert.strictEqual(
      second.accepted,
      first.accepted,
      `${fixture.languageId}: the second accept moved the file`,
    );
    assert.strictEqual(
      second.plan.stripped,
      first.plan.planted,
      `${fixture.languageId}: the second press takes back exactly what the first planted`,
    );
  }
});

test("ten presses leave what the first press left, so nothing accumulates", () => {
  for (const fixture of FIVE) {
    let buffer = fixture.text;
    const settled = press(buffer, fixture).accepted;
    buffer = settled;
    for (let i = 2; i <= 10; i++) {
      buffer = press(buffer, fixture).accepted;
      assert.strictEqual(buffer, settled, `${fixture.languageId}: press ${i} moved the file`);
    }
  }
});

test("the CARD is the same card on the second press: same dimensions, same finding count", () => {
  for (const fixture of FIVE) {
    const first = press(fixture.text, fixture);
    const second = press(first.accepted, fixture);
    assert.deepStrictEqual(
      flaggedRows(second.card),
      flaggedRows(first.card),
      `${fixture.languageId}: the second card flags a different set of dimensions`,
    );
    assert.strictEqual(
      findingCount(second.card),
      findingCount(first.card),
      `${fixture.languageId}: the second card carries a different number of findings`,
    );
  }
});

// ===========================================================================
// Symptom 1: placement
//
// The card here is the one a REAL second press produces: numbered against a
// document that already contains planted comments. Phase 2 could not construct
// this input, because it re-planned with the first press's card.
// ===========================================================================

test("every comment on the second press sits above the same line of code it did on the first", () => {
  for (const fixture of FIVE) {
    const first = press(fixture.text, fixture);
    const second = press(first.accepted, fixture);
    assert.deepStrictEqual(
      attachments(second.accepted, fixture.token),
      attachments(first.accepted, fixture.token),
      `${fixture.languageId}: a comment moved off the line that earned it`,
    );
  }
});

test("no comment on the second press attaches to the closing brace", () => {
  // The measured shape of the drift: findings below a planted comment ran off
  // the end of the region and fell back to its first line, or piled up above the
  // closer. A comment above `}` is the tell.
  for (const fixture of FIVE) {
    const first = press(fixture.text, fixture);
    const second = press(first.accepted, fixture);
    for (const attachment of attachments(second.accepted, fixture.token)) {
      assert.notStrictEqual(
        attachment.code,
        "}",
        `${fixture.languageId}: ${attachment.dimension} landed on the closing brace`,
      );
    }
  }
});

test("the second press plants the SAME comment above the SAME code line, dimension by dimension", () => {
  const first = press(RUST_DOCUMENTED.text, RUST_DOCUMENTED);
  const second = press(first.accepted, RUST_DOCUMENTED);
  const placed = attachments(second.accepted, "//");
  assert.deepStrictEqual(
    placed.map((a) => [a.dimension, a.code]),
    [
      ["bool-param", "pub fn parse_header(&self, raw: &str, flag: bool) -> u32 {"],
      ["unadmitted-failure", "let now = self.clock.unwrap();"],
    ],
    "the contract's own specimen: the body finding on its body line, bool-param on the head",
  );
});

// ===========================================================================
// Symptom 2: the card behind it
// ===========================================================================

// MOVED FROM RUST TO TYPESCRIPT on 2026-08-29. The guard is S62-7's: a comment
// this product planted sits between the doc block and the declaration head, and
// must not blind the doc walk into reporting a documented function as
// undocumented. `undocumented` now DELEGATES in Rust (to `missing_docs`), so the
// row could no longer be expressed there - it would have asserted a refusal and
// proved nothing about the doc walk.
//
// TypeScript is one of the two languages where the dimension still asks, and it
// carries the same shape: a `/** */` block above the head with the planted
// comment landing between them. The Go row below covers the mirror case, where
// `//` is BOTH the doc prefix and this product's comment token.
test("a documented TypeScript function still reads as documented once the comments are in it", () => {
  const first = press(TS_DOCUMENTED.text, TS_DOCUMENTED);
  assert.strictEqual(rowState(first.card, "undocumented"), "clean", "press 1: it has a `/** */`");
  const second = press(first.accepted, TS_DOCUMENTED);
  assert.strictEqual(
    rowState(second.card, "undocumented"),
    "clean",
    "the planted block sits between the doc block and the head, and blinded the doc walk",
  );
  assert.doesNotMatch(second.accepted, /C80 undocumented/, "a finding that is not real");
});

test("an undocumented Go function is NOT read as documented by the comment above it", () => {
  const first = press(GO_UNDOCUMENTED.text, GO_UNDOCUMENTED);
  assert.strictEqual(rowState(first.card, "undocumented"), "flagged", "press 1: no doc comment");
  assert.match(first.accepted, /C80 undocumented/);
  const second = press(first.accepted, GO_UNDOCUMENTED);
  assert.strictEqual(
    rowState(second.card, "undocumented"),
    "flagged",
    "`//` IS Go's doc prefix, so the planted comment read AS documentation",
  );
  // The cost of the capture is not just a wrong card: the region strips what the
  // card no longer replaces, so the criticism disappeared out of the file.
  assert.match(second.accepted, /C80 undocumented/, "the criticism vanished on the second press");
});

test("a documented Go function is never flagged undocumented, on either press", () => {
  const first = press(GO_DOCUMENTED.text, GO_DOCUMENTED);
  assert.strictEqual(rowState(first.card, "undocumented"), "clean");
  const second = press(first.accepted, GO_DOCUMENTED);
  assert.strictEqual(rowState(second.card, "undocumented"), "clean");
  assert.strictEqual(second.accepted, first.accepted);
  assert.match(second.accepted, /^\/\/ ParseHeader turns a raw header into a count\.$/m);
});

test("this product's own comment is not scored as a section comment", () => {
  // The third face of the same root, measured on the Rust specimen: press 2 read
  // the planted block as a section comment inside the function.
  for (const fixture of FIVE) {
    const first = press(fixture.text, fixture);
    const second = press(first.accepted, fixture);
    assert.strictEqual(
      rowState(second.card, "section-comment"),
      rowState(first.card, "section-comment"),
      `${fixture.languageId}: the rubric scored the criticism it wrote itself`,
    );
  }
});

// ===========================================================================
// The line map
//
// The card's numbers name the file the human is looking at, not the internal
// stripped view. A card citing line 41 while the editor shows line 47 is a new
// defect traded for an old one.
// ===========================================================================

test("every line number on the second press's card names the line the human sees", () => {
  for (const fixture of FIVE) {
    const first = press(fixture.text, fixture);
    const second = press(first.accepted, fixture);
    const lines = first.accepted.split("\n");
    for (const row of second.card.rows) {
      if (row.outcome.state !== "flagged") {
        continue;
      }
      for (const finding of row.outcome.findings) {
        assert.strictEqual(
          lines[finding.line - 1].trim(),
          finding.evidence,
          `${fixture.languageId}: ${row.dimension} cites line ${finding.line}, which holds something else`,
        );
      }
    }
    assert.match(
      lines[second.card.headLine - 1],
      fixture.head,
      `${fixture.languageId}: the card's declared-at line is not the declaration`,
    );
  }
});

test("the card the human reads and the card the planner reads differ by exactly the map", () => {
  const first = press(RUST_DOCUMENTED.text, RUST_DOCUMENTED);
  const second = press(first.accepted, RUST_DOCUMENTED);
  // The view is three lines shorter than the file: the planted bool-param
  // comment wraps to three lines above the head.
  assert.ok(
    second.view.lines.length < first.accepted.split("\n").length,
    "the second press scores a shorter document than the one on screen",
  );
  for (let i = 0; i < second.scored.rows.length; i++) {
    const scoredRow = second.scored.rows[i];
    const shownRow = second.card.rows[i];
    if (scoredRow.outcome.state !== "flagged") {
      continue;
    }
    for (let f = 0; f < scoredRow.outcome.findings.length; f++) {
      const view = scoredRow.outcome.findings[f];
      const shown = shownRow.outcome.findings[f];
      assert.strictEqual(shown.line, documentLineOf(second.view, view.line));
      assert.ok(shown.line > view.line, "the file is longer than the view, so the number grows");
      assert.strictEqual(shown.evidence, view.evidence, "only the number moves");
    }
  }
});

test("the map is the identity on a document that carries no C80 comment", () => {
  for (const fixture of FIVE) {
    const lines = fixture.text.split("\n");
    const view = scoringView(lines, fixture.languageId);
    assert.deepStrictEqual(view.lines, lines, `${fixture.languageId}: the view is the document`);
    assert.deepStrictEqual(
      view.documentLine,
      lines.map((_, i) => i + 1),
      `${fixture.languageId}: the map is the identity`,
    );
  }
});

test("the strip's source map names the incoming line every survivor came from", () => {
  const lines = [
    "func F() {",
    "\t// C80 clock: reads the wall clock. Hidden wall-clock read. Untestable.",
    "\t//     Pass it in.",
    "\tnow := time.Now()",
    "\t// a note of my own",
    "\treturn now",
    "}",
  ];
  const stripped = stripCriticism(lines, "go");
  assert.deepStrictEqual(stripped.lines, [
    "func F() {",
    "\tnow := time.Now()",
    "\t// a note of my own",
    "\treturn now",
    "}",
  ]);
  assert.deepStrictEqual(stripped.sourceIndex, [0, 3, 4, 5, 6]);
  assert.strictEqual(stripped.stripped, 1, "one head, not three lines");
});

test("a line the strip removed maps to the first surviving line below it", () => {
  const view = scoringView(
    ["func F() {", "\t// C80 clock: reads the wall clock.", "\tnow := time.Now()", "}"],
    "go",
  );
  // The injection region OPENS on a planted comment on a second press, and the
  // planner's first stripped line is the code below it.
  assert.strictEqual(viewLineAtOrAfter(view, 2), 2);
  assert.strictEqual(documentLineOf(view, viewLineAtOrAfter(view, 2)), 3);
  assert.strictEqual(viewLineAtOrBefore(view, 2), 1);
});

// ===========================================================================
// THE FIRST PRESS DOES NOT MOVE
// ===========================================================================

test("the first press is byte-identical to the pipeline that shipped before the scoring view existed", () => {
  for (const fixture of [...FIVE, GO_DOCUMENTED]) {
    const now = press(fixture.text, fixture);
    const before = pressTheOldWay(fixture.text, fixture);
    assert.strictEqual(
      now.plan.text,
      before.plan.text,
      `${fixture.languageId}: the proposed text moved`,
    );
    assert.strictEqual(now.plan.planted, before.plan.planted, `${fixture.languageId}: planted`);
    assert.strictEqual(now.plan.stripped, before.plan.stripped, `${fixture.languageId}: stripped`);
    assert.strictEqual(now.accepted, before.accepted, `${fixture.languageId}: the accepted bytes`);
    assert.deepStrictEqual(
      now.card,
      before.card,
      `${fixture.languageId}: the card the human reads moved`,
    );
    assert.deepStrictEqual(
      now.scored,
      before.card,
      `${fixture.languageId}: on clean source the two coordinate systems are one`,
    );
  }
});

test("a hand-written comment above a declaration is not a C80 comment, and the view keeps it", () => {
  const text = [
    "package main",
    "",
    "// ParseHeader turns a raw header into a count.",
    "// TODO: this one is mine.",
    "func ParseHeader(raw string, flag bool) uint32 {",
    "\t// my own note",
    "\tnow := time.Now()",
    "\treturn uint32(len(raw)) + uint32(now.Unix())",
    "}",
    "",
  ].join("\n");
  const view = scoringView(text.split("\n"), "go");
  assert.deepStrictEqual(view.lines, text.split("\n"), "nothing here is this product's");
  const first = press(text, GO_DOCUMENTED);
  assert.match(first.accepted, /\/\/ TODO: this one is mine\./);
  assert.match(first.accepted, /\/\/ my own note/);
  const second = press(first.accepted, GO_DOCUMENTED);
  assert.strictEqual(second.accepted, first.accepted);
  assert.match(second.accepted, /\/\/ TODO: this one is mine\./);
  assert.match(second.accepted, /\/\/ my own note/);
});

// ===========================================================================
// The facade runs this order, and cannot quietly stop
//
// Every test above drives the core in the order `src/vscode/criticize.ts` drives
// it. That is only evidence about the product while the facade still does it, so
// the order is pinned against the module source the way v61 pins the write path.
// ===========================================================================

test("the vscode facade scores the view, renders the document-numbered card, and plans on the view line", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "src", "vscode", "criticize.ts"),
    "utf8",
  );
  assert.match(source, /const view = scoringView\(/, "the facade builds a scoring view");
  assert.match(source, /sliceFunction\(\s*view\.lines,/, "and slices the view, not the document");
  assert.match(source, /cardInDocumentLines\(/, "and maps the card home before it is read");
  assert.match(
    source,
    /planInjection\(\s*region\.lines,\s*viewLineAtOrAfter\(view, region\.startLine\),/,
    "and plans against the region's first STRIPPED line",
  );
  assert.doesNotMatch(
    source,
    /planInjection\(region\.lines, region\.startLine/,
    "the document-numbered plan is the placement drift itself",
  );
});
