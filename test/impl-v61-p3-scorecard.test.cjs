// White-box: the slicer, the scorecard assembly and the renderer (session-v61
// phase 3). Written against the implementation, so it pins what a blind oracle
// cannot see: where the slicer's upward walk stops, what an annotation line
// between the doc and the head does to headIndex, where a Python body starts,
// the two refusal paths, and the fact that DEFAULT_ELEVATION is DERIVED from
// the detectors rather than typed out.
//
// Run: node --test test/impl-v61-p3-scorecard.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-v61-p3-scorecard",
  `export { sliceFunction } from "../src/core/criticizeSlice";
export { scoreFunction, signatureLevel, blastRadiusFor, DEFAULT_ELEVATION } from "../src/core/criticizeScore";
export { renderScorecard } from "../src/core/criticizeRender";
export { criticizeLangFor } from "../src/core/criticizeLang";
export { unitDefect, docLines } from "../src/core/criticizeTypes";
export { HONESTY_DETECTORS } from "../src/core/criticizeHonesty";
export { SIGNATURE_DETECTORS } from "../src/core/criticizeSignature";
export { CONTRACT_DETECTORS } from "../src/core/criticizeContract";
export { ALTITUDE_DETECTORS } from "../src/core/criticizeAltitude";
export { SAFETY_DETECTORS } from "../src/core/criticizeSafety";\n`,
);
const {
  sliceFunction,
  scoreFunction,
  signatureLevel,
  blastRadiusFor,
  DEFAULT_ELEVATION,
  renderScorecard,
  criticizeLangFor,
  unitDefect,
  docLines,
  HONESTY_DETECTORS,
  SIGNATURE_DETECTORS,
  CONTRACT_DETECTORS,
  ALTITUDE_DETECTORS,
  SAFETY_DETECTORS,
} = mod;
test.after(cleanup);

const RUST = criticizeLangFor("rust");
const PY = criticizeLangFor("python");
const CS = criticizeLangFor("csharp");
const GO = criticizeLangFor("go");

const rowFor = (card, dim) => card.rows.find((r) => r.dimension === dim);
const NONE_HELD = { held: [] };

// ===========================================================================
// The slicer
// ===========================================================================

// A Rust function whose doc sits above an attribute, which sits above the
// head. This is the shape the contract calls out: an upward walk that stops at
// the first non-doc line finds no doc on any annotated function.
const RUST_DOC = [
  "use std::time::Instant;",       // 1
  "",                              // 2
  "/// Warms the cache.",          // 3
  "///",                           // 4
  "/// Callers must pass a root.", // 5
  "#[inline]",                     // 6
  "pub fn warm(root: &Path) -> usize {", // 7
  "    let started = Instant::now();",   // 8
  "    root.len() + started.elapsed().as_secs() as usize", // 9
  "}",                             // 10
];

test("the slicer walks UPWARD from a head-only startLine and brings the doc with it", () => {
  const fromHead = sliceFunction(RUST_DOC, 7, 10, "warm", RUST);
  assert.ok(fromHead, "a head line is a valid startLine");
  assert.strictEqual(fromHead.startLine, 3, "the slice begins at the first doc line");
  assert.strictEqual(fromHead.lines[0], "/// Warms the cache.");
  assert.deepStrictEqual(
    fromHead.lines.slice(0, 3),
    ["/// Warms the cache.", "///", "/// Callers must pass a root."],
    "the doc is IN the slice: a slicer that drops it reads a documented function as undocumented",
  );
});

test("a startLine at the doc and a startLine at the head produce the SAME unit", () => {
  const fromDoc = sliceFunction(RUST_DOC, 3, 10, "warm", RUST);
  const fromHead = sliceFunction(RUST_DOC, 7, 10, "warm", RUST);
  assert.deepStrictEqual(fromDoc, fromHead, "the caller's cursor must not change the answer");
});

test("an attribute line between the doc and the head is in the slice, and headIndex points PAST it", () => {
  const fn = sliceFunction(RUST_DOC, 7, 10, "warm", RUST);
  assert.strictEqual(fn.lines[fn.headIndex], "pub fn warm(root: &Path) -> usize {");
  assert.strictEqual(fn.lines[3], "#[inline]", "the attribute is inside the slice");
});

test("the upward walk stops at a blank line and never reaches the code above it", () => {
  const fn = sliceFunction(RUST_DOC, 7, 10, "warm", RUST);
  assert.strictEqual(
    fn.lines.includes("use std::time::Instant;"),
    false,
    "the line above the blank belongs to another declaration",
  );
});

test("bodyIndex lands on the first body line for a brace language", () => {
  const fn = sliceFunction(RUST_DOC, 3, 10, "warm", RUST);
  assert.strictEqual(fn.lines[fn.bodyIndex], "    let started = Instant::now();");
  assert.strictEqual(unitDefect(fn), undefined, "the slicer never hands out a defective unit");
});

test("a head spread over several lines puts bodyIndex after the line carrying the brace", () => {
  const lines = [
    "/// Adds.",
    "pub fn add(",
    "    left: i64,",
    "    right: i64,",
    ") -> i64",
    "where",
    "    i64: Copy,",
    "{",
    "    left + right",
    "}",
  ];
  const fn = sliceFunction(lines, 1, 10, "add", RUST);
  assert.strictEqual(fn.headIndex, 1);
  assert.strictEqual(fn.lines[fn.bodyIndex], "    left + right");
});

test("Python bodyIndex lands AFTER the docstring, because Python puts its doc inside the body", () => {
  const lines = [
    "@classmethod",
    "def load(cls, path):",
    '    """Loads a thing.',
    "",
    '    The path must exist."""',
    "    return open(path).read()",
  ];
  const fn = sliceFunction(lines, 2, 6, "load", PY);
  assert.strictEqual(fn.startLine, 1, "the decorator is part of the slice");
  assert.strictEqual(fn.lines[fn.headIndex], "def load(cls, path):");
  assert.strictEqual(
    fn.lines[fn.bodyIndex],
    "    return open(path).read()",
    "a bodyIndex pointing at the docstring would hand every honesty detector prose",
  );
  assert.strictEqual(docLines(fn, PY).length > 0, true);
});

test("a single-line Python docstring is one line of span", () => {
  const lines = ["def f(a):", '    """One line."""', "    return a"];
  const fn = sliceFunction(lines, 1, 3, "f", PY);
  assert.strictEqual(fn.lines[fn.bodyIndex], "    return a");
});

test("the slicer REFUSES a range with no declaration head in it", () => {
  const lines = ["/// Only a doc.", "/// And more doc."];
  assert.strictEqual(
    sliceFunction(lines, 1, 2, "nothing", RUST),
    undefined,
    "no head is a refusal, never an empty-but-valid unit",
  );
});

test("the slicer REFUSES a range that ends before the body starts", () => {
  assert.strictEqual(
    sliceFunction(RUST_DOC, 3, 7, "warm", RUST),
    undefined,
    "a unit whose body was never in the input reads clean on every body dimension",
  );
});

test("the slicer REFUSES nonsense ranges rather than clamping them into a unit", () => {
  assert.strictEqual(sliceFunction([], 1, 1, "x", RUST), undefined);
  assert.strictEqual(sliceFunction(RUST_DOC, 0, 4, "x", RUST), undefined, "document lines are 1-based");
  assert.strictEqual(sliceFunction(RUST_DOC, 8, 3, "x", RUST), undefined, "an inverted range is a defect");
  assert.strictEqual(sliceFunction(RUST_DOC, 99, 120, "x", RUST), undefined, "past the end of the document");
});

test("a C# attribute above the head is walked over, and a Go doc block is not lost", () => {
  const cs = [
    "/// <summary>Does a thing.</summary>",
    "[Obsolete]",
    "public int Widen(int span)",
    "{",
    "    return span + 1;",
    "}",
  ];
  const csFn = sliceFunction(cs, 3, 6, "Widen", CS);
  assert.strictEqual(csFn.startLine, 1, "the C# attribute does not end the doc walk");
  assert.strictEqual(csFn.lines[0], "/// <summary>Does a thing.</summary>");

  const go = [
    "// Cookies implements the interface.",
    "func (j *Jar) Cookies(u *url.URL) []*http.Cookie {",
    "\treturn j.cookies(u, time.Now())",
    "}",
  ];
  const goFn = sliceFunction(go, 2, 4, "Jar.Cookies", GO);
  assert.strictEqual(goFn.startLine, 1);
  assert.strictEqual(docLines(goFn, GO).length, 1);
});

// The doc harvester, not the slicer, is what reads the block back out. It
// stops at an annotation line, so a slice that correctly carries the doc past
// an attribute still harvests nothing. That hole is recorded in
// session-v61/scraps-p3.md; this fixture keeps the annotation out of the way so
// the end-to-end assertion is about the slicer.
const RUST_PLAIN = [
  "/// Warms the cache.",
  "pub fn warm(root: &Path) -> usize {",
  "    let started = Instant::now();",
  "    root.len() + started.elapsed().as_secs() as usize",
  "}",
];

test("the slicer end to end: a sliced Rust function scores its clock finding at the DOCUMENT line", () => {
  const fn = sliceFunction(RUST_DOC, 7, 10, "warm", RUST);
  const card = scoreFunction(fn, RUST);
  const clock = rowFor(card, "clock");
  assert.strictEqual(clock.outcome.state, "flagged");
  assert.strictEqual(clock.outcome.findings[0].line, 8, "line 8 of the document, not index 5 of the slice");
  assert.strictEqual(card.headLine, 7, "headLine is the document line of the declaration head");

  const plain = scoreFunction(sliceFunction(RUST_PLAIN, 2, 5, "warm", RUST), RUST);
  assert.strictEqual(
    rowFor(plain, "undocumented").outcome.state,
    "clean",
    "the doc came with the slice, from a startLine that pointed at the head",
  );
});

// ===========================================================================
// Assembly
// ===========================================================================

const ALL_DETECTORS = [
  ...HONESTY_DETECTORS,
  ...SIGNATURE_DETECTORS,
  ...CONTRACT_DETECTORS,
  ...ALTITUDE_DETECTORS,
  ...SAFETY_DETECTORS,
];

test("DEFAULT_ELEVATION is DERIVED from the detectors' own held flags, not typed out", () => {
  const heldDetectors = ALL_DETECTORS.filter((d) => d.held === true).map((d) => d.dimension);
  assert.deepStrictEqual(
    DEFAULT_ELEVATION.held.slice(),
    heldDetectors,
    "a detector that claims to be held must be held by the shipped policy",
  );
  assert.deepStrictEqual(DEFAULT_ELEVATION.held.slice(), ["section-comment"]);
});

test("the card's row order is exactly the five detector arrays concatenated", () => {
  const fn = sliceFunction(RUST_DOC, 3, 10, "warm", RUST);
  const card = scoreFunction(fn, RUST);
  assert.deepStrictEqual(
    card.rows.map((r) => r.dimension),
    ALL_DETECTORS.map((d) => d.dimension),
  );
  assert.deepStrictEqual(
    card.rows.map((r) => r.source),
    ALL_DETECTORS.map((d) => d.source),
    "the source line on a row is the detector's own curriculum line",
  );
});

test("an UNREGISTERED language yields fifteen blind rows naming it, and never a clean one", () => {
  const fn = {
    languageId: "cobol",
    name: "compute",
    lines: ["      * Doc.", "PROCEDURE DIVISION.", "    DISPLAY 'x'."],
    startLine: 1,
    headIndex: 1,
    bodyIndex: 2,
  };
  const card = scoreFunction(fn);
  assert.strictEqual(card.rows.length, 15);
  for (const row of card.rows) {
    assert.strictEqual(row.outcome.state, "blind", `${row.dimension} was never examined`);
    assert.ok(row.outcome.reason.includes("cobol"), "the refusal names the language");
    assert.strictEqual(row.elevated, false);
  }
});

test("the language profile is looked up from the unit when the caller omits it", () => {
  const fn = sliceFunction(RUST_DOC, 3, 10, "warm", RUST);
  assert.deepStrictEqual(scoreFunction(fn), scoreFunction(fn, RUST));
});

test("signatureLevel splits the rubric nine to six, and blastRadiusFor follows it", () => {
  const yes = ALL_DETECTORS.filter((d) => signatureLevel(d.dimension)).map((d) => d.dimension);
  assert.strictEqual(yes.length, 9);
  assert.strictEqual(blastRadiusFor({ dimension: "clock", callSites: 14 }), 14);
  assert.strictEqual(blastRadiusFor({ dimension: "nesting", callSites: 14 }), undefined, "body-local: the count describes nothing");
  assert.strictEqual(blastRadiusFor({ dimension: "clock", callSites: undefined }), undefined);
});

test("a call-site count lands ONLY on signature-level rows, and the key is ABSENT elsewhere", () => {
  const fn = sliceFunction(RUST_DOC, 3, 10, "warm", RUST);
  const card = scoreFunction(fn, RUST, DEFAULT_ELEVATION, 14);
  assert.strictEqual(rowFor(card, "clock").blastRadius, 14);
  assert.strictEqual(
    "blastRadius" in rowFor(card, "nesting"),
    false,
    "an absent key is what makes an unmeasured count unrenderable",
  );
});

test("with no walk, no row carries the key at all", () => {
  const fn = sliceFunction(RUST_DOC, 3, 10, "warm", RUST);
  const card = scoreFunction(fn, RUST);
  for (const row of card.rows) {
    assert.strictEqual("blastRadius" in row, false, `${row.dimension} has no measured count`);
  }
});

test("scoreFunction is pure: two calls on two equal units deep-equal", () => {
  const a = scoreFunction(sliceFunction(RUST_DOC, 3, 10, "warm", RUST), RUST);
  const b = scoreFunction(sliceFunction(RUST_DOC, 3, 10, "warm", RUST), RUST);
  assert.deepStrictEqual(a, b);
});

// ===========================================================================
// Rendering
// ===========================================================================

/** A card with one flagged row, built through the product's own path. */
function warmCard(callSites) {
  return scoreFunction(sliceFunction(RUST_DOC, 3, 10, "warm", RUST), RUST, DEFAULT_ELEVATION, callSites);
}

test("the renderer IGNORES a stale row.elevated in both directions", () => {
  const card = warmCard();
  for (const row of card.rows) {
    row.elevated = row.dimension === "nesting";
  }
  const out = renderScorecard(card, DEFAULT_ELEVATION);
  assert.ok(
    out.includes("let started = Instant::now();"),
    "a row the policy elevates is elevated however the stored boolean was stamped",
  );
  assert.ok(
    out.includes("nesting                  clean"),
    "a clean row the boolean claimed was elevated stays a roster line",
  );
});

test("the roster carries all fifteen dimensions, in order, on every card", () => {
  const out = renderScorecard(warmCard(), DEFAULT_ELEVATION);
  const roster = out.split("\n").filter((l) => /^ {2}[a-z-]+ {2,}(clean|blind|flagged)/.test(l));
  assert.strictEqual(roster.length, 15, `every dimension shows its state, got:\n${out}`);
});

test("a held row shows on the roster that the POLICY holds it, so a reader does not think it was lost", () => {
  const lines = [
    "/// Runs the thing.",
    "pub fn run_thing(name: &str) -> usize {",
    "    // gather the inputs",
    "    let n = name.len();",
    "    n",
    "}",
  ];
  const card = scoreFunction(sliceFunction(lines, 1, 6, "run_thing", RUST), RUST);
  const out = renderScorecard(card, DEFAULT_ELEVATION);
  assert.ok(out.includes("held below the bar by policy"));
  assert.ok(out.includes("this pass found nothing above the evidence bar"));
  assert.ok(!out.includes("// gather the inputs"), "a held row never renders its evidence");
});

test("the last non-empty line is the honest contract sentence, exactly", () => {
  const out = renderScorecard(warmCard(14), DEFAULT_ELEVATION);
  const lines = out.trimEnd().split("\n");
  assert.strictEqual(
    lines[lines.length - 1],
    "It finds what the repo's oracles can witness, plus concretely-instanced advice. It does not certify correctness.",
  );
});

test("a blind row renders its reason under its roster line", () => {
  const py = ["def apply_rule(alpha, beta, flag):", '    """Applies."""', "    return alpha + beta"];
  const card = scoreFunction(sliceFunction(py, 1, 3, "apply_rule", PY), PY);
  const out = renderScorecard(card, DEFAULT_ELEVATION);
  const reason = rowFor(card, "adjacent-params").outcome.reason;
  assert.ok(out.includes(reason), `the refusal names the language and the cause, got:\n${out}`);
});

test("ONE call site is singular, and a measured zero says so in words rather than in a digit", () => {
  const one = renderScorecard(warmCard(1), NONE_HELD);
  assert.ok(one.includes("reaches 1 call site"), "1 call sites would be a tell that nothing read the count");
  assert.ok(!/1 call sites/.test(one));

  const none = renderScorecard(warmCard(0), NONE_HELD);
  assert.strictEqual(none.includes("0 call sites"), false, "the ruled phrase never appears");
  assert.ok(none.includes("the caller walk found no call sites"), "a walk that ran and found none is not the same as no walk");
});

test("the rendered card never delivers a verdict, on any of the three row states", () => {
  const py = ["def apply_rule(alpha, beta, flag):", '    """Applies."""', "    return alpha + beta"];
  const mixed = renderScorecard(warmCard(14), NONE_HELD).toLowerCase()
    + renderScorecard(scoreFunction(sliceFunction(py, 1, 3, "apply_rule", PY), PY), DEFAULT_ELEVATION).toLowerCase();
  for (const phrase of ["is clean", "all clean", "is correct", "looks correct", "no problems", "all good", "replace with", "change to", "rewrite"]) {
    assert.strictEqual(mixed.includes(phrase), false, `"${phrase}" is a verdict or a fix, and this pass delivers neither`);
  }
});

test("rendering is a pure function of the card and the policy", () => {
  const card = warmCard(14);
  assert.strictEqual(renderScorecard(card, DEFAULT_ELEVATION), renderScorecard(card, DEFAULT_ELEVATION));
  assert.notStrictEqual(
    renderScorecard(card, DEFAULT_ELEVATION),
    renderScorecard(card, { held: ["clock"] }),
    "a different policy is a different card",
  );
});

test("an explanation, when phase 4 attaches one, renders under its row and nowhere else", () => {
  const card = warmCard();
  rowFor(card, "clock").explanation = "explmark the clock read is the input this signature never asks for";
  const out = renderScorecard(card, DEFAULT_ELEVATION);
  assert.ok(out.includes("explmark the clock read"));
  assert.strictEqual(out.split("explmark").length - 1, 1, "one row, one explanation");
});
