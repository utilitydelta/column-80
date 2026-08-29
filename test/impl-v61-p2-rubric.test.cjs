// White-box: dimensions 5 to 15 (session-v61 phase 2). Written against the
// implementation, so it pins what a blind oracle cannot see: which paren the
// parameter reader picks, what the two depth counters do to real formatting,
// and the four places a first cut of a detector read a REAL corpus wrong.
//
// Every trap below was found by measuring, not by reasoning:
//
//  - `pub(crate) fn f(x)` opened a paren before the `fn` keyword, and reading
//    it as the parameter list made 61 of 618 Rust functions unparseable.
//  - A template literal's `${...}` was masked as string content, and dimension
//    7 then called a used parameter unused on 7.9% of 2197 TypeScript slices.
//  - `_, err = w.Seek(n)` KEEPS the error and discards a count, and firing on
//    it read 15.1% of the Go standard library against a measured 3.4%.
//  - `_, ok := v.(*T)` is a type assertion, not a call.
//
// Run: node --test test/impl-v61-p2-rubric.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-v61-p2-rubric",
  `export { SIGNATURE_DETECTORS } from "../src/core/criticizeSignature";
export { CONTRACT_DETECTORS } from "../src/core/criticizeContract";
export { ALTITUDE_DETECTORS } from "../src/core/criticizeAltitude";
export { SAFETY_DETECTORS } from "../src/core/criticizeSafety";
export { criticizeLangFor, parseParams, signatureParts } from "../src/core/criticizeLang";
export { maskLine, maskedBody } from "../src/core/criticizeTypes";\n`,
);
test.after(cleanup);

const {
  SIGNATURE_DETECTORS, CONTRACT_DETECTORS, ALTITUDE_DETECTORS, SAFETY_DETECTORS,
  criticizeLangFor, parseParams, signatureParts, maskLine,
} = mod;

const ALL = [...SIGNATURE_DETECTORS, ...CONTRACT_DETECTORS, ...ALTITUDE_DETECTORS, ...SAFETY_DETECTORS];
const detector = (dimension) => ALL.find((d) => d.dimension === dimension);

/** A slice, doc first. `head` is the index of the declaration head and `body`
 *  the index of the first body line. */
function unit(languageId, lines, head = 0, body = head + 1, startLine = 1) {
  return { languageId, name: "sample", lines, startLine, headIndex: head, bodyIndex: body };
}
const run = (dimension, fn) => detector(dimension).run(fn, criticizeLangFor(fn.languageId));
const params = (fn) => parseParams(fn, criticizeLangFor(fn.languageId));
const parts = (fn) => signatureParts(fn, criticizeLangFor(fn.languageId));

// ---------------------------------------------------------------------------
// The parameter reader
// ---------------------------------------------------------------------------

test("parseParams takes the paren AFTER the name, so pub(crate) is not a parameter", () => {
  const fn = unit("rust", ["pub(crate) fn parse(text: &str) -> Ast {", "    Ast::from(text)", "}"]);
  assert.deepEqual(params(fn).map((p) => p.name), ["text"]);
});

test("parseParams reads a zero-parameter Rust fn whose RETURN type has parens", () => {
  const fn = unit("rust", ["pub(crate) fn test_dir() -> (TempDir, PathBuf) {", "    make()", "}"]);
  assert.deepEqual(params(fn), []);
});

test("parseParams keeps a Rust `mut` binding's name and drops every receiver spelling", () => {
  for (const receiver of ["self", "&self", "&mut self", "&'a self"]) {
    const fn = unit("rust", [`pub fn render(${receiver}, mut label: String) -> String {`, "    label", "}"]);
    assert.deepEqual(params(fn).map((p) => p.name), ["label"], receiver);
  }
});

test("parseParams drops a C# extension receiver and strips a default value", () => {
  const fn = unit("csharp", ["public static string Pad(this string text, int width = 4)", "{", "    return text;", "}"], 0, 2);
  assert.deepEqual(params(fn).map((p) => [p.name, p.type]), [["width", "int"]]);
});

test("parseParams refuses a TypeScript destructured parameter rather than naming it", () => {
  const fn = unit("typescript", ["export function draw({ x, y }: Point, label: string): void {", "  paint(x, y, label);", "}"]);
  assert.equal(params(fn), undefined, "a destructured parameter has no single name to judge");
});

test("parseParams refuses a Go type-only list, which an interface method may write", () => {
  const fn = unit("go", ["func Read([]byte) (int, error) {", "\treturn 0, nil", "}"]);
  assert.equal(params(fn), undefined);
});

test("signatureParts reads the result each language writes in its own place", () => {
  const cases = [
    ["rust", ["pub fn a(x: u8) -> String {", "    x", "}"], 0, 1, "String"],
    ["rust", ["pub fn a(x: u8) {", "    x;", "}"], 0, 1, ""],
    ["go", ["func A(x int) (Ast, error) {", "\treturn nil, nil", "}"], 0, 1, "(Ast, error)"],
    ["go", ["func A(x int) {", "\tx++", "}"], 0, 1, ""],
    ["csharp", ["public Dictionary<string, int> A(int x)", "{", "    return null;", "}"], 0, 2, "Dictionary<string, int>"],
    ["csharp", ["public Widget(int x)", "{", "    X = x;", "}"], 0, 2, ""],
    ["typescript", ["export function a(x: number): Promise<void> {", "  return go(x);", "}"], 0, 1, "Promise<void>"],
    ["python", ["def a(x) -> None:", "    return None"], 0, 1, "None"],
  ];
  for (const [languageId, lines, head, body, expected] of cases) {
    assert.equal(parts(unit(languageId, lines, head, body)).result, expected, lines[head]);
  }
});

// ---------------------------------------------------------------------------
// Masking: a template interpolation is CODE
// ---------------------------------------------------------------------------

// The row that followed this one read the same rule through the unused-parameter
// dimension - a parameter mentioned only inside `${...}` must count as read.
// That dimension was DELETED 2026-08-29 (clippy, TS6133 and gopls already report
// it), and the row went with it: no surviving detector observes a parameter READ,
// so there is nothing to repoint it at. The masking rule itself is unchanged and
// is what the row below measures directly.
test("maskLine keeps a template interpolation and blanks the text around it", () => {
  const line = "  return `id ${node.filePath} for ${node.line}`;";
  const masked = maskLine(line, criticizeLangFor("typescript"));
  assert.equal(masked.length, line.length, "column positions must survive");
  assert.match(masked, /node\.filePath/);
  assert.match(masked, /node\.line/);
  assert.ok(!masked.includes("id "), `the literal text must still be masked: "${masked}"`);
});

// ---------------------------------------------------------------------------
// The two depth counters
// ---------------------------------------------------------------------------

test("the brace counter reads blocks, not a struct literal on one line", () => {
  const fn = unit("rust", [
    "pub fn build(&self) -> Row {",
    "    Row { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6 }",
    "}",
  ]);
  assert.deepEqual(run("nesting", fn), { state: "clean" });
});

test("the Python counter is an indent STACK, so a two-space file still measures", () => {
  const fn = unit("python", [
    "def resolve(rows):",
    "  for row in rows:",
    "    if row:",
    "      for cell in row:",
    "        if cell.ready:",
    "          return cell",
    "  return None",
  ], 0, 1);
  const out = run("nesting", fn);
  assert.equal(out.state, "flagged", JSON.stringify(out));
  assert.match(out.findings[0].detail, /4 blocks deep/, "four blocks below the outermost statement of the body");
});

// ---------------------------------------------------------------------------
// Dimension 14, the two Go traps
// ---------------------------------------------------------------------------

const goBody = (line) => unit("go", ["// Do does a thing.", "func Do(f *os.File) error {", `\t${line}`, "\treturn nil", "}"], 1, 2);

test("Go: only the LAST slot counts, so `_, err = w.Seek(n)` keeps its error", () => {
  assert.deepEqual(run("unadmitted-failure", goBody("_, err = f.Seek(0, 0)")), { state: "clean" });
});

test("Go: a type assertion is not a call, so `_, ok := v.(*T)` is clean", () => {
  assert.deepEqual(run("unadmitted-failure", goBody("_, ok := v.(*Config)")), { state: "clean" });
});

test("Go: a range loop discards an index, not an error", () => {
  assert.deepEqual(run("unadmitted-failure", goBody("for _, row := range rows {")), { state: "clean" });
});

test("Go: a bare `_ =` against a call is the dropped error", () => {
  const out = run("unadmitted-failure", goBody("_ = f.Sync()"));
  assert.equal(out.state, "flagged");
  assert.equal(out.findings[0].evidence, "_ = f.Sync()");
});

// ---------------------------------------------------------------------------
// Dimension 11, the Rust deref trap
// ---------------------------------------------------------------------------

test("Rust: a deref assignment to a LOCAL guard is not state that outlives the call", () => {
  const fn = unit("rust", [
    "/// Publishes the event and reports how many listeners saw it.",
    "pub fn publish(&self, event: Event) -> usize {",
    "    let mut guard = self.slot.lock();",
    "    *guard = Some(event.clone());",
    "    self.listeners.len()",
    "}",
  ], 1, 2);
  assert.deepEqual(run("cqs", fn), { state: "clean" });
});

test("Rust: a deref assignment through a &mut PARAMETER is", () => {
  const fn = unit("rust", [
    "/// Bumps the counter and reports its new value.",
    "pub fn bump(total: &mut usize) -> usize {",
    "    *total += 1;",
    "    *total",
    "}",
  ], 1, 2);
  const out = run("cqs", fn);
  assert.equal(out.state, "flagged", JSON.stringify(out));
  assert.equal(out.findings[0].evidence, "*total += 1;");
});

// ---------------------------------------------------------------------------
// Dimension 15 and dimension 9, the two head-reading rules
// ---------------------------------------------------------------------------

test("a comment whose only follower is a closing brace labels nothing", () => {
  const fn = unit("rust", [
    "/// Rebuilds the index.",
    "pub fn rebuild(&mut self) {",
    "    self.index = fold(self.read_shards());",
    "    // the compaction pass is tracked in the queue",
    "}",
  ], 1, 2);
  assert.deepEqual(run("section-comment", fn), { state: "clean" });
});

test("dimension 9 reads the name off the DECLARATION, not off the slice's name", () => {
  const fn = { languageId: "go", name: "lower case description of a slice", startLine: 1, headIndex: 0, bodyIndex: 1,
    lines: ["func Parse(text string) Ast {", "\treturn astFrom(text)", "}"] };
  assert.equal(run("undocumented", fn).state, "flagged", "Parse is exported by its capital P");
});

// ---------------------------------------------------------------------------
// Refusals and chosen constants
// ---------------------------------------------------------------------------

test("an unreadable parameter list is BLIND on all four signature dimensions", () => {
  const fn = unit("typescript", ["export function draw({ x, y }: Point): void {", "  paint(x, y);", "}"]);
  for (const d of SIGNATURE_DETECTORS) {
    const out = d.run(fn, criticizeLangFor("typescript"));
    assert.equal(out.state, "blind", `${d.dimension} must refuse, got ${JSON.stringify(out)}`);
    assert.match(out.reason, /TypeScript/, d.dimension);
  }
});

test("a malformed slice is refused BY NAME by every dimension in the phase", () => {
  const broken = { languageId: "rust", name: "broken", lines: ["pub fn a() {"], startLine: 1, headIndex: 0, bodyIndex: 9 };
  for (const d of ALL) {
    const out = d.run(broken, criticizeLangFor("rust"));
    assert.equal(out.state, "blind", d.dimension);
    assert.ok(out.reason.length > 0, d.dimension);
  }
});

test("every profile carries the two CHOSEN thresholds, and only dimension 15 is held", () => {
  for (const id of ["rust", "typescript", "csharp", "python", "go"]) {
    const lang = criticizeLangFor(id);
    assert.ok(lang.craft.paramCountThreshold >= 1, id);
    assert.ok(lang.craft.nestingThreshold >= 1, id);
  }
  assert.deepEqual(ALL.filter((d) => d.held === true).map((d) => d.dimension), ["section-comment"]);
});
