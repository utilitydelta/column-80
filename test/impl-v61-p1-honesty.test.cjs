// White-box: the Criticize detector seam and the honesty block (session-v61
// phase 1). Written against the implementation, so it pins the internals a
// blind oracle cannot see: what masking does to a Rust lifetime, what carries
// across a line boundary, where the Python doc walk starts from, and the two
// refusal paths that exist to stop a silent zero.
//
// REWRITTEN IN PART, 2026-08-29. A human ruled that the product carries no
// hardcoded string table matching a third party's code (ruling 3, the amendment
// at the end of session-v64/goal.md). The four honesty tables and the logWrites
// table are deleted from `CriticizeLang`, and `HONESTY_DETECTORS` refuses out of
// the synchronous pass because a `Detector.run` is synchronous and pure and a
// model round is neither. Every row below that drove a spelling through a
// detector is removed and marked; the masking, doc-harvest, registry and slice
// rows are untouched, and one row now pins that no name table comes back.
//
// Run: node --test test/impl-v61-p1-honesty.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-v61-p1-honesty",
  `export { maskLine, maskedBody, docLines, unitDefect } from "../src/core/criticizeTypes";
export { criticizeLangFor, RUST_CRITICIZE_LANG, TS_CRITICIZE_LANG, CS_CRITICIZE_LANG, PY_CRITICIZE_LANG, GO_CRITICIZE_LANG } from "../src/core/criticizeLang";
export { HONESTY_DETECTORS } from "../src/core/criticizeHonesty";\n`,
);
const {
  maskLine,
  maskedBody,
  docLines,
  unitDefect,
  criticizeLangFor,
  RUST_CRITICIZE_LANG,
  TS_CRITICIZE_LANG,
  CS_CRITICIZE_LANG,
  PY_CRITICIZE_LANG,
  GO_CRITICIZE_LANG,
  HONESTY_DETECTORS,
} = mod;
test.after(cleanup);

/** A brace-language unit: doc lines, then the head, then the body. */
function braceUnit(languageId, doc, head, body, startLine = 1) {
  return {
    languageId,
    name: "sample",
    lines: [...doc, head, ...body],
    startLine,
    headIndex: doc.length,
    bodyIndex: doc.length + 1,
  };
}

// ---------------------------------------------------------------------------
// maskLine
// ---------------------------------------------------------------------------

test("maskLine blanks a line comment and keeps the width", () => {
  const line = "    let x = 1; // Instant::now()";
  const masked = maskLine(line, RUST_CRITICIZE_LANG);
  assert.strictEqual(masked.length, line.length);
  assert.strictEqual(masked.trimEnd(), "    let x = 1;");
});

test("maskLine blanks a string literal but leaves the call around it", () => {
  const masked = maskLine('    open("Instant::now()")', PY_CRITICIZE_LANG);
  assert.match(masked, /^\s+open\(\s+\)$/);
});

test("maskLine leaves a Rust lifetime alone when the tick never closes", () => {
  const line = "    let s: &'a str = name;";
  assert.strictEqual(maskLine(line, RUST_CRITICIZE_LANG), line);
});

test("maskLine blanks a char literal that does close", () => {
  const masked = maskLine("    if c == '/' { go(); }", RUST_CRITICIZE_LANG);
  assert.strictEqual(masked, "    if c ==     { go(); }");
});

test("maskLine blanks a same-line block comment", () => {
  const masked = maskLine("    let x = /* Date.now() */ 1;", TS_CRITICIZE_LANG);
  assert.strictEqual(masked.replace(/\s+/g, " "), " let x = 1;");
});

test("maskLine uses the profile's own line comment, so a hash is code in Rust", () => {
  const line = "    let v = vec![1]; # not a comment here";
  assert.strictEqual(maskLine(line, RUST_CRITICIZE_LANG), line);
  assert.match(maskLine("    x = 1  # time.time()", PY_CRITICIZE_LANG), /^\s+x = 1\s+$/);
});

// ---------------------------------------------------------------------------
// maskedBody
// ---------------------------------------------------------------------------

test("maskedBody carries a block comment across line boundaries", () => {
  const fn = braceUnit("typescript", [], "function f() {", [
    "  /* an example:",
    "     const t = Date.now();",
    "  */",
    "  return 1;",
    "}",
  ]);
  const body = maskedBody(fn, TS_CRITICIZE_LANG);
  assert.strictEqual(body.length, 5);
  assert.ok(!body.some((l) => l.includes("Date.now")), body.join("\n"));
  assert.match(body[3], /return 1;/);
});

test("maskedBody carries a template literal across line boundaries", () => {
  const fn = braceUnit("typescript", [], "function f() {", [
    "  const prompt = `read the clock with",
    "  Date.now() and stop`;",
    "  return prompt;",
    "}",
  ]);
  const body = maskedBody(fn, TS_CRITICIZE_LANG);
  assert.ok(!body.some((l) => l.includes("Date.now")), body.join("\n"));
});

test("maskedBody index i is lines[bodyIndex + i]", () => {
  const fn = braceUnit("rust", ["/// doc"], "fn f() {", ["    let a = 1;", "    let b = 2;", "}"]);
  const body = maskedBody(fn, RUST_CRITICIZE_LANG);
  assert.strictEqual(body.length, 3);
  assert.strictEqual(body[0], fn.lines[fn.bodyIndex]);
  assert.strictEqual(body[1], fn.lines[fn.bodyIndex + 1]);
});

test("maskedBody blanks a python triple-quoted block across lines", () => {
  const fn = {
    languageId: "python",
    name: "f",
    lines: ["def f():", '    """Doc."""', "    note = '''", "    time.time()", "    '''", "    return note"],
    startLine: 1,
    headIndex: 0,
    bodyIndex: 2,
  };
  const body = maskedBody(fn, PY_CRITICIZE_LANG);
  assert.ok(!body.some((l) => l.includes("time.time")), body.join("\n"));
});

// ---------------------------------------------------------------------------
// docLines: four read upward, Python reads downward
// ---------------------------------------------------------------------------

test("docLines reads Rust /// upward", () => {
  const fn = braceUnit("rust", ["/// Adds one.", "/// Never panics."], "pub fn f(x: u8) -> u8 {", ["    x + 1", "}"]);
  assert.deepStrictEqual(docLines(fn, RUST_CRITICIZE_LANG), ["Adds one.", "Never panics."]);
});

test("docLines strips a TypeScript block doc down to its text", () => {
  const fn = braceUnit("typescript", ["/**", " * Adds one.", " */"], "export function f(x: number) {", ["  return x + 1;", "}"]);
  assert.deepStrictEqual(docLines(fn, TS_CRITICIZE_LANG), ["Adds one."]);
});

test("docLines handles a one-line block doc", () => {
  const fn = braceUnit("typescript", ["/** Adds one. */"], "function f(x) {", ["  return x + 1;", "}"]);
  assert.deepStrictEqual(docLines(fn, TS_CRITICIZE_LANG), ["Adds one."]);
});

test("docLines reads C# /// upward", () => {
  const fn = braceUnit("csharp", ["/// <summary>Adds one.</summary>"], "public int F(int x) {", ["    return x + 1;", "}"]);
  assert.deepStrictEqual(docLines(fn, CS_CRITICIZE_LANG), ["<summary>Adds one.</summary>"]);
});

test("docLines stops at a blank line, so an unrelated comment is not this doc", () => {
  const fn = {
    languageId: "go",
    name: "F",
    lines: ["// unrelated note", "", "// F adds one.", "func F(x int) int {", "\treturn x + 1", "}"],
    startLine: 10,
    headIndex: 3,
    bodyIndex: 4,
  };
  assert.deepStrictEqual(docLines(fn, GO_CRITICIZE_LANG), ["F adds one."]);
});

test("docLines reads a Python docstring DOWNWARD, not upward", () => {
  const fn = {
    languageId: "python",
    name: "f",
    lines: ["def f(x):", '    """Adds one.', "", "    Never raises.", '    """', "    return x + 1"],
    startLine: 1,
    headIndex: 0,
    bodyIndex: 5,
  };
  assert.deepStrictEqual(docLines(fn, PY_CRITICIZE_LANG), ["Adds one.", "", "Never raises."]);
});

test("docLines reads a single-quoted Python docstring", () => {
  const fn = {
    languageId: "python",
    name: "f",
    lines: ["def f(x):", '    "Adds one."', "    return x + 1"],
    startLine: 1,
    headIndex: 0,
    bodyIndex: 2,
  };
  assert.deepStrictEqual(docLines(fn, PY_CRITICIZE_LANG), ["Adds one."]);
});

test("docLines finds the Python docstring even when bodyIndex points AT it", () => {
  // A producer that pointed bodyIndex at the docstring rather than past it must
  // not turn a documented function into an undocumented one silently.
  const fn = {
    languageId: "python",
    name: "f",
    lines: ["def f(x):", '    """Adds one."""', "    return x + 1"],
    startLine: 1,
    headIndex: 0,
    bodyIndex: 1,
  };
  assert.deepStrictEqual(docLines(fn, PY_CRITICIZE_LANG), ["Adds one."]);
});

test("docLines walks past a multi-line Python declaration head", () => {
  const fn = {
    languageId: "python",
    name: "f",
    lines: ["def f(", "    x: int,", ") -> int:", '    """Adds one."""', "    return x + 1"],
    startLine: 1,
    headIndex: 0,
    bodyIndex: 4,
  };
  assert.deepStrictEqual(docLines(fn, PY_CRITICIZE_LANG), ["Adds one."]);
});

test("docLines is empty when a Python function has no docstring", () => {
  const fn = {
    languageId: "python",
    name: "f",
    lines: ["def f(x):", "    return x + 1"],
    startLine: 1,
    headIndex: 0,
    bodyIndex: 1,
  };
  assert.deepStrictEqual(docLines(fn, PY_CRITICIZE_LANG), []);
});

test("docLines is empty when a brace function has no doc", () => {
  const fn = braceUnit("rust", [], "fn f() {", ["    1", "}"]);
  assert.deepStrictEqual(docLines(fn, RUST_CRITICIZE_LANG), []);
});

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------

test("criticizeLangFor registers five profiles and the TypeScript aliases", () => {
  assert.strictEqual(criticizeLangFor("rust").displayName, "Rust");
  assert.strictEqual(criticizeLangFor("csharp").displayName, "C#");
  assert.strictEqual(criticizeLangFor("python").displayName, "Python");
  assert.strictEqual(criticizeLangFor("go").displayName, "Go");
  for (const id of ["typescript", "javascript", "typescriptreact", "javascriptreact"]) {
    assert.strictEqual(criticizeLangFor(id).displayName, "TypeScript", id);
  }
});

test("criticizeLangFor returns undefined for an unregistered language", () => {
  assert.strictEqual(criticizeLangFor("ruby"), undefined);
  assert.strictEqual(criticizeLangFor(""), undefined);
});

// INVERTED 2026-08-29. It read `every registered profile fills all four honesty
// tables and a log table`. Both fields are deleted, and the row now guards
// against their return: a profile field listing someone else's API is the defect
// ruling 3 names, whatever it is called next time.
test("no profile carries a name table for a third party's API", () => {
  for (const lang of [RUST_CRITICIZE_LANG, TS_CRITICIZE_LANG, CS_CRITICIZE_LANG, PY_CRITICIZE_LANG, GO_CRITICIZE_LANG]) {
    assert.strictEqual(lang.honesty, undefined, `${lang.displayName} still carries an honesty table`);
    assert.strictEqual(lang.logWrites, undefined, `${lang.displayName} still carries a logWrites table`);
    assert.ok(lang.lineComment.length > 0, lang.displayName);
    // What stays is the language's own syntax, and it is still here.
    assert.ok(lang.craft.guards.length > 0, `${lang.displayName} guards`);
    assert.ok(Array.isArray(lang.craft.mutations), `${lang.displayName} mutations`);
  }
});

// ---------------------------------------------------------------------------
// The detector set itself
// ---------------------------------------------------------------------------

test("HONESTY_DETECTORS is the four dimensions, each with a curriculum line", () => {
  assert.deepStrictEqual(HONESTY_DETECTORS.map((d) => d.dimension), ["clock", "prng", "env", "world"]);
  for (const d of HONESTY_DETECTORS) {
    assert.ok(d.source.length > 0, d.dimension);
    assert.ok(["safer", "understandable", "both"].includes(d.axis), d.dimension);
  }
});

// REPLACED 2026-08-29. The old row walked the findings a name table produced
// and checked their detail line. The sync pass produces no findings at all now,
// so that row could not fail; this one asserts what the sync pass DOES produce.
test("every detector refuses out of the synchronous pass, in a sentence, and never says clean", () => {
  const cases = [
    [RUST_CRITICIZE_LANG, "rust", "fn f() {", "    let t = Instant::now();"],
    [TS_CRITICIZE_LANG, "typescript", "function f() {", "  const t = Date.now();"],
    [CS_CRITICIZE_LANG, "csharp", "public void F() {", "    var t = DateTime.UtcNow;"],
    [GO_CRITICIZE_LANG, "go", "func F() {", "\tt := time.Now()"],
    [PY_CRITICIZE_LANG, "python", "def f():", "    t = time.time()"],
  ];
  for (const d of HONESTY_DETECTORS) {
    for (const [lang, id, head, line] of cases) {
      const fn = braceUnit(id, [], head, [line, "}"]);
      const out = d.run(fn, lang);
      assert.strictEqual(out.state, "blind", `${d.dimension} on ${lang.displayName}: ${JSON.stringify(out)}`);
      assert.ok(out.reason.trim().split(/\s+/).length >= 5, out.reason);
      assert.ok(/model/i.test(out.reason), `the refusal names what would have to run: ${out.reason}`);
    }
  }
});

// ---------------------------------------------------------------------------
// Dimensions 1 to 4 - REMOVED 2026-08-29
// ---------------------------------------------------------------------------
// Nine clock rows, the clock precision row, the document-line row, the
// ascending-and-one-per-line row, both PRNG rows, the env row, and all four
// world rows including the log-write guard and its two containment rows. Every
// one of them drove a library spelling through a name table, and the tables are
// deleted by ruling 3 of the amendment at the end of session-v64/goal.md.
//
// What they were really pinning has split in two and both halves are covered.
// The masking and slice rows above still hold the reading of a body. The
// finding assembly, the document-line arithmetic and the ordering moved to
// `criticizeHonestyModel.ts`, which has its own oracle. The log-write guard has
// no successor in code at all: the model is told in the prompt that writing
// output is not reading the world.

// ---------------------------------------------------------------------------
// The two refusal paths. Both exist so a zero cannot be a fact about the rig.
// ---------------------------------------------------------------------------

// REMOVED 2026-08-29: `an empty name table is BLIND, not clean, and the reason
// names the language`. There is no table to empty. Its point, that a zero must
// never be a fact about the rig, is now the whole of the synchronous pass and is
// asserted by the refusal row above.

// REWORKED 2026-08-29. It ran a malformed slice through the clock detector,
// which refused because `unitDefect` named the defect. The detector now refuses
// whatever it is handed, so it can no longer tell a malformed slice from a
// well-formed one, and the row reads `unitDefect` directly. That is the same
// guard the model judge consults before it spends a round.
test("unitDefect names the defect in a malformed slice, so a refusal can say which", () => {
  const past = {
    languageId: "rust",
    name: "f",
    lines: ["fn f() {", "    let t = 1;", "}"],
    startLine: 1,
    headIndex: 0,
    bodyIndex: 9,
  };
  const defect = unitDefect(past);
  assert.ok(defect !== undefined, "a bodyIndex past the end is a defect");
  assert.ok(defect.includes("bodyIndex"), defect);

  for (const bad of [
    { headIndex: 2, bodyIndex: 1 },
    { headIndex: -1, bodyIndex: 1 },
    { startLine: 0 },
    { lines: [] },
  ]) {
    const fn = { ...past, bodyIndex: 1, ...bad };
    assert.ok(unitDefect(fn) !== undefined, JSON.stringify(bad));
  }
});

test("unitDefect passes a well-formed slice", () => {
  const fn = braceUnit("rust", ["/// Doc."], "fn f() {", ["    1", "}"]);
  assert.strictEqual(unitDefect(fn), undefined);
});

// REWORKED 2026-08-29 for the same reason as the row above: a well-formed slice
// with nothing in its body is not a defect, and the difference has to stay
// visible somewhere now that the detectors refuse either way.
test("an empty body is well formed and simply has no lines to read", () => {
  const fn = { languageId: "rust", name: "f", lines: ["/// Doc.", "fn f() {}"], startLine: 1, headIndex: 1, bodyIndex: 2 };
  assert.strictEqual(unitDefect(fn), undefined, "an empty body is not a malformed slice");
  assert.deepStrictEqual(maskedBody(fn, RUST_CRITICIZE_LANG), [], "and there is nothing in it to read");
});
