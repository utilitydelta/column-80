// Adversarial review of session-v61 phase 1: the detector seam and the honesty
// block. Every test here is a DEFECT CLAIM with the evidence attached, written
// after grading the four honesty detectors against the 138-row labelled set in
// session-v61/graded/labels.json.
//
// These are expected to FAIL against the phase-1 build. They are not
// regressions and they are not a request to loosen an assertion: each one
// states what contracts/phase1-detector-seam.md says the behaviour is, and
// shows the input where the shipped behaviour differs.
//
// The grading result these sit under, for context:
//   clock  tp=12 fp=0 tn=34 fn=0   precision 100.0%  recall 100.0%
//   prng   tp=4  fp=0 tn=23 fn=0   precision 100.0%  recall 100.0%
//   env    tp=8  fp=0 tn=16 fn=0   precision 100.0%  recall 100.0%
//   world  tp=14 fp=1 tn=37 fn=8   precision  93.3%  recall  63.6%
// Three of the four legs are clean on this set. Everything below is about the
// fourth, and about the masking and doc-harvest holes that the labelled set is
// too small to have hit.
//
// AMENDED 2026-08-29. The four honesty name tables are deleted by ruling 3 of
// the amendment at the end of session-v64/goal.md, so no claim here can be
// stated through a detector any more. Every masking claim is restated against
// `maskedBody`, which is the code each one was really about: the detector was
// only the probe that made the masking hole visible. The two `world` leg claims
// are removed, because the leg they were about no longer exists.
//
// Run: node --test test/adversarial-v61-p1.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "adversarial-v61-p1",
  `export { maskLine, maskedBody, docLines } from "../src/core/criticizeTypes";
export { criticizeLangFor } from "../src/core/criticizeLang";\n`,
);
const { maskLine, maskedBody, docLines, criticizeLangFor } = mod;
test.after(cleanup);

/** A unit whose doc block is lines[0..headIndex), whose head is lines[headIndex]
 *  and whose body starts at bodyIndex. */
const unit = (languageId, lines, headIndex, bodyIndex, startLine = 1) => ({
  languageId,
  name: "sample",
  lines,
  startLine,
  headIndex,
  bodyIndex,
});

/** The body as the detectors read it, one string. The masking claims below are
 *  all about what is and is not in here. */
const body = (fn) => maskedBody(fn, criticizeLangFor(fn.languageId)).join("\n");

// ===========================================================================
// 1. Masking: string literals the masker does not recognise as strings
// ===========================================================================

// CONTRACT: "A `Instant::now()` inside a comment, a doc example, a string
// literal, or a `//` line is NOT a clock read and must not fire."
//
// EVIDENCE: a Rust raw string `r#"..."#` may legally contain a bare `"`. That is
// the whole point of the `#` delimiter. The masker treats the first inner `"` as
// the close, so the rest of the literal is handed to the detectors as code.
// In the production Rust crate used as this session's Rust corpus, 234 of the
// 245 lines that contain `r#"` carry an inner quote (they are JSON literals),
// so the masking guarantee is broken on 95% of that crate's raw strings.
test("DEFECT 1: a Rust raw string with an inner quote leaks its contents past the mask", () => {
  const rust = criticizeLangFor("rust");
  const line = '    let payload = r#"he said "Instant::now()" here"#;';
  assert.ok(
    !/Instant::now/.test(maskLine(line, rust)),
    "a raw string's contents must be masked, and `Instant::now()` inside one is not a clock read",
  );
});

test("DEFECT 1b: a Rust raw string's contents reach the body reader as code", () => {
  const fn = unit("rust", [
    "fn build() -> String {",
    '    let payload = r#"{"note": "Instant::now()"}"#;',
    "    payload",
    "}",
  ], 0, 1);
  assert.ok(!/Instant::now/.test(body(fn)), "a raw string's contents are string content, not body code");
});

// EVIDENCE: C# 11 raw string literals open with `"""` and may span lines. Only
// the backtick is registered as a spanning delimiter for the brace languages,
// so line two of the literal is masked as if it were code.
test("DEFECT 2: a C# raw string literal spanning lines leaks its body past the mask", () => {
  const fn = unit("csharp", [
    "void Load() {",
    '    var sql = """',
    "        SELECT DateTime.UtcNow FROM t",
    '        """;',
    "}",
  ], 0, 1);
  assert.ok(
    !/DateTime\.UtcNow/.test(body(fn)),
    "the body of a C# raw string literal is string content and must not reach the body reader as code",
  );
});

// EVIDENCE: `/*/` is an unterminated block comment opener in every C-family
// grammar: the `/` is consumed by the `/*`. The masker starts its search for
// `*/` at the opener itself, finds the overlapping one at offset 1, and treats
// the comment as closed. Everything after it is read as code.
test("DEFECT 3: `/*/` is treated as an opened-and-closed comment, exposing the commented-out body", () => {
  const fn = unit("typescript", [
    "function f() {",
    "    /*/ const t = Date.now(); /*/",
    "    return 1;",
    "}",
  ], 0, 1);
  assert.ok(
    !/Date\.now/.test(body(fn)),
    "a commented-out statement is a comment and must not reach the body reader as code",
  );
});

// ===========================================================================
// 2. Masking: real code the masker hides
// ===========================================================================

// EVIDENCE: a C# verbatim string has no backslash escape, so `@"C:\"` is the
// three-character string `C:\` and it closes on its line. `indexOfUnescaped`
// counts the backslash, decides the closing quote is escaped, finds no close,
// and blanks the rest of the line. The real `DateTime.UtcNow` after it is gone.
// Windows paths spelled this way are ordinary in a C# corpus.
test("DEFECT 4: a C# verbatim string ending in a backslash swallows the rest of the line", () => {
  const fn = unit("csharp", [
    "void Run() {",
    '    var dir = @"C:\\"; var t = DateTime.UtcNow;',
    "}",
  ], 0, 1);
  assert.ok(
    /DateTime\.UtcNow/.test(body(fn)),
    "the code after a closed verbatim string is real code and must survive the mask",
  );
});

// EVIDENCE: the interpolated part of a template literal or an f-string is
// executable code, not string content. Masking the whole literal hides it.
//
// This one is not hypothetical. It is line 102 of
// /home/utilitydelta/work/utilitydelta/life-coach-engine/indexer.py, which the
// labelled set records as a clock read on row py-001 ("clock: datetime.now at
// 102 and 114, time.time at 110 and 118"). The detector reports 110 and 118 and
// misses 102 and 114. The row still grades as a true positive because two other
// lines fire, so the confusion matrix cannot see this class at all.
test("DEFECT 5: a Python f-string interpolation hides a real clock read (py-001, lines 102 and 114)", () => {
  const fn = unit("python", [
    "def acquire(self):",
    '    self.fd.write(f"{os.getpid()}\\n{datetime.now().isoformat()}\\n")',
    "    return True",
  ], 0, 1, 101);
  const masked = maskedBody(fn, criticizeLangFor("python"));
  assert.ok(
    /datetime\.now\(\)/.test(masked.join("\n")),
    "an f-string placeholder holds executable code and must survive the mask",
  );
  // The line that carries it is still document line 102, which is the half of
  // this claim the finding's line number used to prove.
  assert.strictEqual(fn.startLine + fn.bodyIndex, 102);
});

test("DEFECT 5b: a TypeScript template placeholder hides real code", () => {
  const fn = unit("typescript", [
    "function log() {",
    "    const s = `served at ${Date.now()}`;",
    "    return s;",
    "}",
  ], 0, 1);
  assert.ok(/Date\.now\(\)/.test(body(fn)), "a template placeholder is code and must survive the mask");
});

// ===========================================================================
// 3. The `world` leg: the only false positive on the labelled set
// ===========================================================================

// REMOVED 2026-08-29: `DEFECT 6: the world leg fires on an INJECTED reader
// (labelled row ts-030)` and `DEFECT 6b: the world leg fires on an interface
// member DECLARATION, which is not a call`.
//
// Both were precision claims against the TypeScript world TABLE, and the fix
// they won was a receiver-aware pattern in that table. Ruling 3 deletes the
// table, so there is no pattern left to be wrong. The claim underneath survives
// as a fact the model judge is asked to honour in its prompt: a read through a
// reader the caller handed in came through the signature, so it is honest. It
// is measured against a labelled set now, not asserted here.

// ===========================================================================
// 4. The doc harvester
// ===========================================================================

// CONTRACT: "`headIndex` - Index into `lines` of the declaration head."
//
// EVIDENCE: an attribute is not a declaration head, so with headIndex on the
// `fn` line the upward walk stops at `#[inline]` and returns nothing. Measured
// on the production Rust crate this session used as its Rust corpus: 493 of
// 1688 documented functions (29.2%) put one or more attributes between the doc
// comment and the `fn` line. In the C# corpus it is 10 of 198 (5.1%).
//
// This is the shape of the failure the module's own header is built around: a
// doc that IS in the input and is never read, producing a zero that is spelled
// the same as a real one.
test("DEFECT 7: a Rust attribute between the doc and the fn loses the whole doc block", () => {
  const fn = unit("rust", [
    "/// Adds two numbers.",
    "#[inline]",
    "pub fn add(a: i32, b: i32) -> i32 {",
    "    a + b",
    "}",
  ], 2, 3);
  assert.deepStrictEqual(docLines(fn, criticizeLangFor("rust")), ["Adds two numbers."]);
});

test("DEFECT 7b: a C# attribute between the doc and the declaration loses the whole doc block", () => {
  const fn = unit("csharp", [
    "/// <summary>Adds two numbers.</summary>",
    "[Obsolete]",
    "public int Add(int a, int b) {",
    "    return a + b;",
    "}",
  ], 2, 3);
  assert.deepStrictEqual(docLines(fn, criticizeLangFor("csharp")), ["<summary>Adds two numbers.</summary>"]);
});

// CONTRACT: "Rust `///` and `//!`, TypeScript and C# `/** */` (and C# `///`),
// Go `//` immediately above with no blank line between."
//
// EVIDENCE: `isDocLine` accepts a bare `//` for all four brace languages, so a
// tool directive or a scratch note above a Rust or TypeScript function is
// harvested as that function's contract. Rust has no doc comment spelled `//`
// and neither does TypeScript. The dimensions that read the doc will then read
// an eslint pragma as a stated precondition, and dimension 9 will call an
// undocumented function documented.
test("DEFECT 8: a bare `//` comment is harvested as a Rust doc comment", () => {
  const fn = unit("rust", [
    "// TODO: rewrite this before the release",
    "pub fn add(a: i32) -> i32 {",
    "    a",
    "}",
  ], 1, 2);
  assert.deepStrictEqual(
    docLines(fn, criticizeLangFor("rust")),
    [],
    "Rust's doc comment is `///` or `//!`; a `//` line is not a doc comment",
  );
});

test("DEFECT 8b: a bare `//` comment is harvested as a TypeScript doc comment", () => {
  const fn = unit("typescript", [
    "// eslint-disable-next-line @typescript-eslint/no-explicit-any",
    "export function add(a: number): number {",
    "    return a;",
    "}",
  ], 1, 2);
  assert.deepStrictEqual(docLines(fn, criticizeLangFor("typescript")), []);
});

// EVIDENCE: Python's docstring is the first STATEMENT of the body. A comment is
// not a statement, so `def f(): # noqa \n """doc"""` still binds `__doc__`. The
// harvester skips blank lines only, hits the comment, and gives up.
test("DEFECT 9: a comment before a Python docstring loses the docstring", () => {
  const fn = unit("python", [
    "def f():",
    "    # set up",
    '    """Real docstring."""',
    "    return 1",
  ], 0, 3);
  assert.deepStrictEqual(docLines(fn, criticizeLangFor("python")), ["Real docstring."]);
});

// EVIDENCE: a Go build constraint is a directive to the toolchain, not prose
// about the function, and `go doc` does not print it. The upward walk takes
// every `//` line until a blank, so it lands in the harvested doc.
test("DEFECT 10: a Go build constraint is harvested as part of the doc comment", () => {
  const fn = unit("go", [
    "//go:build linux",
    "// Add adds two numbers.",
    "func Add(a, b int) int {",
    "    return a + b",
    "}",
  ], 2, 3);
  assert.deepStrictEqual(docLines(fn, criticizeLangFor("go")), ["Add adds two numbers."]);
});

// ===========================================================================
// 5. The slice invariant: a shape that satisfies it and is still a silent zero
// ===========================================================================

// CONTRACT: "0 <= headIndex < bodyIndex <= lines.length", and `unitDefect`
// exists so that "a bodyIndex past the end of `lines` makes every body scan
// read an empty body and report a clean function that was never examined".
//
// EVIDENCE: a function whose body shares a line with its declaration head has
// no first line of the body. The only representable slice is headIndex 0,
// bodyIndex 1, lines.length 1, which satisfies the invariant exactly.
// `unitDefect` passes it, `maskedBody` returns [], and all four honesty legs
// answer `clean` on a function that was never read.
//
// This is not an edge case. The C# corpus this session labelled against holds
// 307 expression-bodied members, and the Rust corpus holds 123 single-line
// `fn` bodies. Labelled row cs-027 (`StampOutcome.Stamp`) is exactly this
// shape: startLine and endLine are both 26.
//
// It is also the failure the module's own header is about: a zero produced by
// a rig that could not fire, spelled identically to a real one. The expected
// outcome here is `blind` with a reason, not `clean`.
// RESTATED 2026-08-29. The claim was `a one-line function reads CLEAN on every
// honesty leg without being examined`, and since the detectors now refuse
// whatever they are handed, asserting "not clean" would pass on a build that had
// lost the fix. It is restated against the body reader, where the fix actually
// landed: the head line's remainder IS the body, and it must reach the reader.
test("DEFECT 11: a one-line function's body reaches the body reader", () => {
  const cases = [
    ["csharp", "public DateTime Now() => DateTime.UtcNow;", /DateTime\.UtcNow/],
    ["rust", "pub fn now() -> Instant { Instant::now() }", /Instant::now/],
    ["typescript", "export const now = () => Date.now();", /Date\.now/],
    ["go", "func Now() time.Time { return time.Now() }", /time\.Now/],
    ["python", "def now(): return time.time()", /time\.time/],
  ];
  for (const [languageId, line, spelling] of cases) {
    const fn = unit(languageId, [line], 0, 1);
    const read = body(fn);
    assert.ok(read.trim().length > 0, `${languageId}: a slice with no body LINE still has a body`);
    assert.ok(spelling.test(read), `${languageId}: the head line's remainder is the body, got ${JSON.stringify(read)}`);
  }
});
