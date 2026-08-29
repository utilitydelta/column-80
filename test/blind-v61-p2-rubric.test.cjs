// BLIND ORACLE - session-v61 phase 2, dimensions 5 to 15.
//
// Written from `session-v61/contracts/phase2-rubric-dimensions.md` and
// `phase1-detector-seam.md` alone. No implementation file was read while this
// was authored, and none may be read to make it pass: when a row here
// disagrees with the code, the contract is the tie-breaker until a human moves
// the contract.
//
// The rows that carry the most weight are the ones that must stay quiet. A
// detector that fires on everything scores well against a naive fixture set and
// is useless on a real file, so every dimension below is paired: one slice that
// must fire, and the neighbouring slice the contract says must not.
//
// Every slice is a function the way a developer writes one, DOC COMMENT FIRST,
// because `FunctionUnderReview.lines` starts at the doc and the scout's second
// rig failure was a slicer that started at the declaration head - it read a
// real detector as 0.0%.
//
// Run: node --test test/blind-v61-p2-rubric.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "blind-v61-p2",
  `export * as sig from "../src/core/criticizeSignature";
export * as contract from "../src/core/criticizeContract";
export * as altitude from "../src/core/criticizeAltitude";
export * as safety from "../src/core/criticizeSafety";
export * as lang from "../src/core/criticizeLang";
export * as types from "../src/core/criticizeTypes";\n`,
);
test.after(cleanup);

const criticizeLangFor = mod.lang.criticizeLangFor;

// ===========================================================================
// Detector discovery.
//
// Phase 2's contract names the four MODULES and says each exports a
// `readonly Detector[]`; it does not name the arrays. So the arrays are found
// by shape - an array whose every element is a Detector - rather than by a
// guessed identifier.
// ===========================================================================

const isDetector = (d) =>
  !!d &&
  typeof d === "object" &&
  typeof d.dimension === "string" &&
  typeof d.source === "string" &&
  typeof d.axis === "string" &&
  typeof d.run === "function";

function detectorsIn(ns, label) {
  const found = [];
  for (const value of Object.values(ns || {})) {
    if (Array.isArray(value) && value.length > 0 && value.every(isDetector)) found.push(...value);
  }
  if (found.length === 0) {
    throw new Error(`no Detector[] export found in ${label}`);
  }
  return found;
}

const MODULE_DETECTORS = {
  signature: detectorsIn(mod.sig, "criticizeSignature"),
  contract: detectorsIn(mod.contract, "criticizeContract"),
  altitude: detectorsIn(mod.altitude, "criticizeAltitude"),
  safety: detectorsIn(mod.safety, "criticizeSafety"),
};
const ALL_DETECTORS = [].concat(...Object.values(MODULE_DETECTORS));

const byDim = (dimension) => {
  const hit = ALL_DETECTORS.filter((d) => d.dimension === dimension);
  if (hit.length !== 1) {
    throw new Error(`expected exactly 1 detector for "${dimension}", found ${hit.length}`);
  }
  return hit[0];
};

// ===========================================================================
// Fixtures. `lines` is the whole slice, doc first.
// ===========================================================================

const DOC_MARKERS = ["///", "//!", "/**", "*/", "*", "//", "#"];

/** First line that is not part of a doc block above the head. */
function defaultHead(lines) {
  for (let i = 0; i < lines.length; i += 1) {
    const t = lines[i].trim();
    if (t === "") continue;
    if (DOC_MARKERS.some((m) => t.startsWith(m))) continue;
    return i;
  }
  return 0;
}

/** Every fixture built in this file, for the cross-cutting sweep at the end. */
const ALL_FIXTURES = [];

function slice(languageId, name, lines, opts) {
  const o = opts || {};
  const headIndex =
    typeof o.head === "number" ? o.head : o.head ? lines.findIndex((l) => o.head.test(l)) : defaultHead(lines);
  const bodyIndex =
    typeof o.body === "number" ? o.body : o.body ? lines.findIndex((l) => o.body.test(l)) : headIndex + 1;
  const startLine = o.startLine || 1;
  if (headIndex < 0 || bodyIndex < 0 || headIndex >= bodyIndex || bodyIndex > lines.length) {
    throw new Error(`fixture "${name}": bad indices head=${headIndex} body=${bodyIndex}`);
  }
  const fn = { languageId, name, lines, startLine, headIndex, bodyIndex };
  ALL_FIXTURES.push(fn);
  return fn;
}

const rust = (name, lines, opts) => slice("rust", name, lines, opts);
const ts = (name, lines, opts) => slice("typescript", name, lines, opts);
const cs = (name, lines, opts) => slice("csharp", name, lines, opts);
const py = (name, lines, opts) => slice("python", name, lines, opts);
const go = (name, lines, opts) => slice("go", name, lines, opts);

// ===========================================================================
// Outcome assertions. Every flagged row is validated whole, so a detector
// cannot pass a count check while emitting an empty evidence string.
// ===========================================================================

const FIX_WORDS = /\bshould\b|\bconsider\b|\buse\s|\binstead\b|\brename\b|\bextract\b/i;

function outcomeOf(dimension, fn) {
  const lang = criticizeLangFor(fn.languageId);
  assert.ok(lang, `no CriticizeLang profile for "${fn.languageId}"`);
  const out = byDim(dimension).run(fn, lang);
  assert.ok(out && typeof out === "object", `${dimension}/${fn.name}: run returned ${out}`);
  assert.ok(
    out.state === "clean" || out.state === "flagged" || out.state === "blind",
    `${dimension}/${fn.name}: unknown state ${JSON.stringify(out)}`,
  );
  return out;
}

const show = (out) => JSON.stringify(out);

function expectClean(dimension, fn) {
  const out = outcomeOf(dimension, fn);
  assert.equal(out.state, "clean", `${dimension} must be clean on "${fn.name}", got ${show(out)}`);
}

function expectBlind(dimension, fn) {
  const out = outcomeOf(dimension, fn);
  assert.equal(out.state, "blind", `${dimension} must be blind on "${fn.name}", got ${show(out)}`);
  assert.equal(typeof out.reason, "string", `${dimension}/${fn.name}: blind reason must be a string`);
  assert.ok(out.reason.trim().length > 0, `${dimension}/${fn.name}: blind reason must not be empty`);
  return out;
}

function validateFindings(dimension, fn, findings) {
  const trimmedLines = fn.lines.map((l) => l.trim());
  const lastLine = fn.startLine + fn.lines.length - 1;
  const seen = new Set();
  let previous = -Infinity;
  for (const f of findings) {
    assert.equal(f.dimension, dimension, `${fn.name}: finding carries the wrong dimension: ${show(f)}`);
    assert.ok(Number.isInteger(f.line), `${fn.name}: finding line must be an integer: ${show(f)}`);
    assert.ok(
      f.line >= fn.startLine && f.line <= lastLine,
      `${fn.name}: finding line ${f.line} outside document range ${fn.startLine}..${lastLine}`,
    );
    assert.ok(f.line >= previous, `${fn.name}: findings must sort by line ascending: ${show(findings)}`);
    previous = f.line;
    const key = `${f.dimension}@${f.line}`;
    assert.ok(!seen.has(key), `${fn.name}: duplicate (dimension, line) pair ${key}`);
    seen.add(key);
    assert.equal(typeof f.evidence, "string", `${fn.name}: evidence must be a string: ${show(f)}`);
    assert.ok(f.evidence.length > 0, `${fn.name}: evidence must never be empty: ${show(f)}`);
    assert.ok(
      trimmedLines.includes(f.evidence),
      `${fn.name}: evidence "${f.evidence}" is not a trimmed line of this slice`,
    );
    assert.equal(typeof f.detail, "string", `${fn.name}: detail must be a string: ${show(f)}`);
    assert.ok(f.detail.trim().length > 0, `${fn.name}: detail must not be empty: ${show(f)}`);
    assert.ok(!f.detail.includes("\n"), `${fn.name}: detail must be one line: ${show(f)}`);
    assert.ok(!FIX_WORDS.test(f.detail), `${fn.name}: detail names a fix, which is advice: "${f.detail}"`);
  }
}

function expectFlagged(dimension, fn, count) {
  const out = outcomeOf(dimension, fn);
  assert.equal(out.state, "flagged", `${dimension} must fire on "${fn.name}", got ${show(out)}`);
  assert.ok(Array.isArray(out.findings), `${dimension}/${fn.name}: findings must be an array`);
  validateFindings(dimension, fn, out.findings);
  assert.equal(
    out.findings.length,
    count,
    `${dimension}/${fn.name}: expected ${count} finding(s), got ${out.findings.length}: ${show(out)}`,
  );
  return out.findings;
}

// ===========================================================================
// DIMENSION 5 - adjacent same-typed parameters.
// The Go exemption is the whole point of this block: grouped parameters are
// 36.1% of the Go standard library, so firing on them flags Go, not the code.
// ===========================================================================

const goGrouped = go("go grouped params", [
  "// Copy copies bytes from src into dst and returns the number copied.",
  "func Copy(dst, src []byte) int {",
  "\tn := copy(dst, src)",
  "\treturn n",
  "}",
]);

const goSeparatelyTyped = go("go separately typed neighbours", [
  "// Blend mixes the two weights and returns their sum.",
  "func Blend(a int, b int) int {",
  "\treturn a + b",
  "}",
]);

const rustAdjacent = rust("rust adjacent same-typed", [
  "/// Swaps the two slots and returns the value that used to sit on the left.",
  "pub fn swap_slots(left: String, right: String, slot: usize) -> String {",
  "    let old = left.clone();",
  "    self.rows[slot] = right;",
  "    old",
  "}",
]);

const rustNonAdjacent = rust("rust same type but not adjacent", [
  "/// Formats one row of the table at the given width.",
  "pub fn format_row(width: usize, label: &str, height: usize) -> String {",
  "    format!(\"{}x{} {}\", width, height, label)",
  "}",
]);

const csAdjacent = cs("csharp adjacent same-typed", [
  "/// <summary>Joins the two halves with the separator.</summary>",
  "public static string Join(string left, string right, char separator)",
  "{",
  "    return left + separator + right;",
  "}",
], { body: 3 });

const tsAdjacent = ts("typescript adjacent same-typed", [
  "/** Renders a rectangle caption. */",
  "export function rect(width: number, height: number, label: string): string {",
  "  return label + \": \" + width * height;",
  "}",
]);

const pyAnnotatedAdjacent = py("python fully annotated, adjacent same-typed", [
  "def scale(width: float, height: float, label: str) -> str:",
  "    \"\"\"Scales the box and returns its caption.\"\"\"",
  "    area = width * height",
  "    return label + str(area)",
], { head: 0, body: 2 });

const pyUnannotated = py("python unannotated signature", [
  "def scale(width, height, label):",
  "    \"\"\"Scales the box and returns its caption.\"\"\"",
  "    area = width * height",
  "    return label + str(area)",
], { head: 0, body: 2 });

const pyPartiallyAnnotated = py("python partially annotated signature", [
  "def mix(a: int, b, c: int) -> int:",
  "    \"\"\"Mixes the three channels.\"\"\"",
  "    return a + b + c",
], { head: 0, body: 2 });

const pyAnnotatedDistinct = py("python annotated, distinct types", [
  "def label_at(name: str, index: int) -> str:",
  "    \"\"\"Returns the label at index.\"\"\"",
  "    return name + str(index)",
], { head: 0, body: 2 });

test("D5 Go grouped parameters are BLIND, never flagged - 36.1% of the standard library", () => {
  const out = expectBlind("adjacent-params", goGrouped);
  assert.match(out.reason, /go/i, `the blind reason must name the language: "${out.reason}"`);
  assert.match(
    out.reason,
    /group|idiom/i,
    `the blind reason must name the cause - the grouped spelling is Go's own idiom: "${out.reason}"`,
  );
});

test("D5 two SEPARATELY typed Go neighbours of the same type still fire", () => {
  expectFlagged("adjacent-params", goSeparatelyTyped, 1);
});

test("D5 fires on adjacent same-typed Rust parameters", () => {
  const findings = expectFlagged("adjacent-params", rustAdjacent, 1);
  assert.equal(findings[0].line, rustAdjacent.startLine + rustAdjacent.headIndex);
});

test("D5 stays clean when the same type is not adjacent", () => {
  expectClean("adjacent-params", rustNonAdjacent);
});

test("D5 fires in C# and TypeScript", () => {
  expectFlagged("adjacent-params", csAdjacent, 1);
  expectFlagged("adjacent-params", tsAdjacent, 1);
});

test("D5 Python with an unannotated signature is BLIND, never clean", () => {
  const out = expectBlind("adjacent-params", pyUnannotated);
  assert.match(out.reason, /python/i, `the blind reason must name the language: "${out.reason}"`);
  assert.match(
    out.reason,
    /annotat|13\.7/i,
    `the blind reason must name the coverage gap: "${out.reason}"`,
  );
});

test("D5 Python is blind when only SOME parameters are annotated", () => {
  expectBlind("adjacent-params", pyPartiallyAnnotated);
});

test("D5 a fully annotated Python signature is judged, not refused", () => {
  expectFlagged("adjacent-params", pyAnnotatedAdjacent, 1);
  expectClean("adjacent-params", pyAnnotatedDistinct);
});

// ===========================================================================
// DIMENSION 6 - boolean parameter. Acton 2014.
// ===========================================================================

const rustBoolParam = rust("rust bool parameter", [
  "/// Shows or hides the row.",
  "pub fn set_visible(&mut self, visible: bool) {",
  "    self.visible = visible;",
  "}",
]);

const csBoolParam = cs("csharp bool parameter", [
  "/// <summary>Saves the document to the given path.</summary>",
  "public void Save(string path, bool overwrite)",
  "{",
  "    Writer.Write(path, overwrite);",
  "}",
], { body: 3 });

const tsBoolParam = ts("typescript bool parameter", [
  "/** Opens the file at the given path. */",
  "export function open(path: string, force: boolean): Handle {",
  "  return sys.open(path, force);",
  "}",
]);

const goBoolParam = go("go bool parameter", [
  "// Retry runs the job again, optionally logging each attempt.",
  "func Retry(attempts int, verbose bool) error {",
  "\treturn run(attempts, verbose)",
  "}",
]);

const pyBoolParam = py("python annotated bool parameter", [
  "def dump(path: str, pretty: bool) -> None:",
  "    \"\"\"Writes the model to path.\"\"\"",
  "    write(path, pretty)",
], { head: 0, body: 2 });

const rustBoolReturn = rust("rust boolean RETURN", [
  "/// Reports whether the table holds no rows.",
  "pub fn is_empty(&self) -> bool {",
  "    self.rows.is_empty()",
  "}",
]);

const tsBoolReturn = ts("typescript boolean RETURN", [
  "/** Reports whether the session is ready to serve. */",
  "export function isReady(id: string): boolean {",
  "  return sessions.get(id) !== undefined;",
  "}",
]);

const goBoolReturn = go("go boolean RETURN", [
  "// Valid reports whether s parses as a key.",
  "func Valid(s string) bool {",
  "\treturn len(s) > 0",
  "}",
]);

const csBoolReturn = cs("csharp boolean RETURN", [
  "/// <summary>Reports whether the key is present.</summary>",
  "public bool Contains(string key)",
  "{",
  "    return Map.ContainsKey(key);",
  "}",
], { body: 3 });

const pyBoolReturn = py("python boolean RETURN", [
  "def is_ok(value: int) -> bool:",
  "    \"\"\"Reports whether the value is inside the band.\"\"\"",
  "    return value > 0",
], { head: 0, body: 2 });

test("D6 fires on a boolean parameter in all four annotated languages", () => {
  expectFlagged("bool-param", rustBoolParam, 1);
  expectFlagged("bool-param", csBoolParam, 1);
  expectFlagged("bool-param", tsBoolParam, 1);
  expectFlagged("bool-param", goBoolParam, 1);
});

test("D6 fires on an annotated Python bool parameter", () => {
  expectFlagged("bool-param", pyBoolParam, 1);
});

test("D6 Python with an unannotated signature is BLIND, never clean", () => {
  const out = expectBlind("bool-param", pyUnannotated);
  assert.match(out.reason, /python/i, `the blind reason must name the language: "${out.reason}"`);
  assert.match(out.reason, /annotat|13\.7/i, `the blind reason must name the coverage gap: "${out.reason}"`);
});

test("D6 NEVER fires on a boolean RETURN type - it is a parameter dimension", () => {
  expectClean("bool-param", rustBoolReturn);
  expectClean("bool-param", tsBoolReturn);
  expectClean("bool-param", goBoolReturn);
  expectClean("bool-param", csBoolReturn);
  expectClean("bool-param", pyBoolReturn);
});

// ===========================================================================
// The unused-parameter dimension was DELETED 2026-08-29 (the developer's own
// toolchain already reports it: clippy `unused_variables`, TS6133 with no
// tsconfig, gopls `unusedparams`), and its five rows went with it. The fixtures
// below stay: they are ordinary function slices that every remaining detector
// is still swept over by the corpus rows at the end of this file.
// ===========================================================================

const tsUsedOnlyInCommentAndString = ts("typescript param named only in a comment and a string", [
  "/** Formats one row of the report. */",
  "export function formatRow(id: string, label: string): string {",
  "  // label is intentionally not rendered yet",
  "  const text = \"label: \" + id;",
  "  return text;",
  "}",
]);

const tsUsedForReal = ts("typescript param actually used", [
  "/** Formats one row of the report. */",
  "export function formatRow(id: string, label: string): string {",
  "  return label + \": \" + id;",
  "}",
]);

const rustUnderscoreParam = rust("rust _-prefixed parameter", [
  "/// Handles the message, ignoring the context for now.",
  "pub fn handle(_ctx: &Ctx, message: &str) -> usize {",
  "    message.len()",
  "}",
]);

const goUnderscoreParam = go("go _-prefixed parameter", [
  "// Handle processes the message and ignores the context.",
  "func Handle(_ctx context.Context, message string) int {",
  "\treturn len(message)",
  "}",
]);

const pyUnderscoreParam = py("python _-prefixed parameter", [
  "def handle(_ctx, message):",
  "    \"\"\"Handles the message and ignores the context.\"\"\"",
  "    return len(message)",
], { head: 0, body: 2 });

const csUnderscoreParam = cs("csharp _-prefixed unused parameter", [
  "/// <summary>Writes one audit entry.</summary>",
  "public void Audit(string key, string _message)",
  "{",
  "    Sink.Write(key);",
  "}",
], { body: 3 });

const rustReceiverNotAParam = rust("rust receiver is not a parameter", [
  "/// Renders the label inside brackets.",
  "pub fn render(&self, label: &str) -> String {",
  "    format!(\"[{}]\", label)",
  "}",
]);

const pyReceiverNotAParam = py("python self is not a parameter", [
  "def render(self, label: str) -> str:",
  "    \"\"\"Renders the label inside brackets.\"\"\"",
  "    return \"[\" + label + \"]\"",
], { head: 0, body: 2 });

// ===========================================================================
// DIMENSION 7 - parameter count. The threshold is a CHOSEN constant, so these
// rows sit far either side of any plausible value rather than pinning it.
// ===========================================================================

const rustManyParams = rust("rust nine parameters", [
  "/// Builds one report row from every column the table needs.",
  "pub fn build_row(a: usize, b: &str, c: u8, d: f64, e: char, f: u8, g: i64, h: u16, i: u32) -> String {",
  "    format!(\"{}{}{}{}{}{}{}{}{}\", a, b, c, d, e, f, g, h, i)",
  "}",
], { startLine: 120 });

const rustOneParam = rust("rust one parameter", [
  "/// Returns the row width.",
  "pub fn width(row: &Row) -> usize {",
  "    row.cells.len()",
  "}",
]);

const csManyParams = cs("csharp nine parameters", [
  "/// <summary>Builds a report row.</summary>",
  "public static string BuildRow(int a, string b, byte c, double d, char e, byte f, long g, ushort h, uint i)",
  "{",
  "    return Formatter.Row(a, b, c, d, e, f, g, h, i);",
  "}",
], { body: 3 });

const pyManyParams = py("python nine parameters", [
  "def build_row(a, b, c, d, e, f, g, h, i):",
  "    \"\"\"Builds one report row.\"\"\"",
  "    return format_row(a, b, c, d, e, f, g, h, i)",
], { head: 0, body: 2 });

const goManyParams = go("go nine parameters", [
  "// BuildRow builds one report row.",
  "func BuildRow(a int, b string, c byte, d float64, e rune, f byte, g int64, h uint16, i uint32) string {",
  "\treturn formatRow(a, b, c, d, e, f, g, h, i)",
  "}",
]);

const tsManyParams = ts("typescript nine parameters", [
  "/** Builds one report row. */",
  "export function buildRow(a: number, b: string, c: number, d: number, e: string, f: number, g: number, h: number, i: number): string {",
  "  return formatRow(a, b, c, d, e, f, g, h, i);",
  "}",
]);

test("D8 fires at nine parameters in all five languages", () => {
  expectFlagged("param-count", rustManyParams, 1);
  expectFlagged("param-count", csManyParams, 1);
  expectFlagged("param-count", pyManyParams, 1);
  expectFlagged("param-count", goManyParams, 1);
  expectFlagged("param-count", tsManyParams, 1);
});

test("D8 quotes the declaration head as its evidence, at the head's document line", () => {
  const findings = expectFlagged("param-count", rustManyParams, 1);
  assert.equal(findings[0].evidence, rustManyParams.lines[rustManyParams.headIndex].trim());
  assert.equal(findings[0].line, 120 + rustManyParams.headIndex);
});

test("D8 a one-parameter function is clean", () => {
  expectClean("param-count", rustOneParam);
});

// ===========================================================================
// DIMENSION 9 - public and undocumented. Knuth's point is about the reader of
// an interface, so a PRIVATE undocumented function is clean. Five spellings.
// ===========================================================================

const rustPubNoDoc = rust("rust pub, no doc", [
  "pub fn parse(text: &str) -> Ast {",
  "    Ast::from(text)",
  "}",
], { head: 0 });

const rustPubCrateNoDoc = rust("rust pub(crate), no doc", [
  "pub(crate) fn parse_inner(text: &str) -> Ast {",
  "    Ast::from(text)",
  "}",
], { head: 0 });

const rustPrivateNoDoc = rust("rust private, no doc", [
  "fn parse_inner(text: &str) -> Ast {",
  "    Ast::from(text)",
  "}",
], { head: 0 });

const rustPubWithDoc = rust("rust pub, documented", [
  "/// Parses `text` into an abstract syntax tree.",
  "pub fn parse(text: &str) -> Ast {",
  "    Ast::from(text)",
  "}",
]);

const csPublicNoDoc = cs("csharp public, no doc", [
  "public string Parse(string text)",
  "{",
  "    return Ast.From(text);",
  "}",
], { head: 0, body: 2 });

const csProtectedNoDoc = cs("csharp protected, no doc", [
  "protected string ParseCore(string text)",
  "{",
  "    return Ast.From(text);",
  "}",
], { head: 0, body: 2 });

const csPrivateNoDoc = cs("csharp private, no doc", [
  "private string ParseCore(string text)",
  "{",
  "    return Ast.From(text);",
  "}",
], { head: 0, body: 2 });

const tsExportNoDoc = ts("typescript export, no doc", [
  "export function parse(text: string): Ast {",
  "  return Ast.from(text);",
  "}",
], { head: 0 });

const tsExportDefaultNoDoc = ts("typescript export default, no doc", [
  "export default function parse(text: string): Ast {",
  "  return Ast.from(text);",
  "}",
], { head: 0 });

const tsLocalNoDoc = ts("typescript not exported, no doc", [
  "function parse(text: string): Ast {",
  "  return Ast.from(text);",
  "}",
], { head: 0 });

const goExportedNoDoc = go("go capitalised, no doc", [
  "func Parse(text string) (Ast, error) {",
  "\treturn astFrom(text)",
  "}",
], { head: 0 });

const goUnexportedNoDoc = go("go lower case, no doc", [
  "func parse(text string) (Ast, error) {",
  "\treturn astFrom(text)",
  "}",
], { head: 0 });

const pyPublicNoDoc = py("python public, no docstring", [
  "def parse(text):",
  "    return ast_from(text)",
], { head: 0, body: 1 });

const pyPrivateNoDoc = py("python _-prefixed, no docstring", [
  "def _parse(text):",
  "    return ast_from(text)",
], { head: 0, body: 1 });

const pyPublicWithDoc = py("python public, documented", [
  "def parse(text):",
  "    \"\"\"Parses text into a tree.\"\"\"",
  "    return ast_from(text)",
], { head: 0, body: 2 });

// D9 DELEGATES IN RUST, C# AND PYTHON since 2026-08-29. Each of those languages
// carries a rule that reports a missing doc comment - `missing_docs`, CS1591,
// `D103` - and the human's ruling is that a question the developer's own
// toolchain answers is not this product's to ask. The dimension REFUSES BY NAME
// rather than disappearing, so the card still tells a reader where the real
// check lives.
//
// The rows below are the old fire/clean pairs turned into the new contract: the
// answer no longer depends on the CODE at all in these three languages, which is
// exactly what makes them delegated rather than merely quiet.

test("D9 Rust: DELEGATED to rustc, so pub, pub(crate), private and documented all refuse alike", () => {
  for (const fixture of [rustPubNoDoc, rustPubCrateNoDoc, rustPrivateNoDoc, rustPubWithDoc]) {
    const out = expectBlind("undocumented", fixture);
    assert.match(
      out.reason,
      /missing_docs/,
      "a delegated dimension must NAME the rule that answers it, or the developer learns nothing from the refusal",
    );
  }
});

test("D9 C#: DELEGATED to Roslyn, public, protected and private alike", () => {
  for (const fixture of [csPublicNoDoc, csProtectedNoDoc, csPrivateNoDoc]) {
    const out = expectBlind("undocumented", fixture);
    assert.match(out.reason, /CS1591/, "the refusal names the Roslyn rule");
  }
});

test("D9 TypeScript: export and export default fire, a module-local function is CLEAN", () => {
  expectFlagged("undocumented", tsExportNoDoc, 1);
  expectFlagged("undocumented", tsExportDefaultNoDoc, 1);
  expectClean("undocumented", tsLocalNoDoc);
});

test("D9 Go: capitalisation is the public surface, lower case is CLEAN", () => {
  expectFlagged("undocumented", goExportedNoDoc, 1);
  expectClean("undocumented", goUnexportedNoDoc);
});

test("D9 Python: DELEGATED to ruff, so the underscore convention no longer decides anything here", () => {
  for (const fixture of [pyPublicNoDoc, pyPrivateNoDoc, pyPublicWithDoc]) {
    const out = expectBlind("undocumented", fixture);
    assert.match(out.reason, /D103/, "the refusal names the ruff rule");
  }
});

// THE TWO LANGUAGES THAT STILL ASK. Nothing in the Go or TypeScript toolchain,
// default or opt-in, reports a missing doc comment, so the dimension is still
// this product's to answer there. These two rows are what stops the delegation
// spreading by accident: if a later change made D9 refuse everywhere, they fail.

// ===========================================================================
// DIMENSION 10 - states a precondition it never enforces. Guard vocabulary is
// per-language and shares nothing, so each language gets its own pair.
// ===========================================================================

const rustPreconditionGuarded = rust("rust must + assert!", [
  "/// Returns the entry at `index`. The caller must pass an index inside the table.",
  "pub fn entry(&self, index: usize) -> u8 {",
  "    assert!(index < self.rows.len());",
  "    self.rows[index]",
  "}",
]);

const rustPreconditionUnguarded = rust("rust must, no guard", [
  "/// Returns the entry at `index`. The caller must pass an index inside the table.",
  "pub fn entry(&self, index: usize) -> u8 {",
  "    self.rows[index]",
  "}",
]);

const rustNoDocAtAll = rust("rust no doc, no guard", [
  "pub fn entry(&self, index: usize) -> u8 {",
  "    self.rows[index]",
  "}",
], { head: 0 });

const goPreconditionGuarded = go("go must + nil check", [
  "// Write appends p to the buffer. p must not be nil.",
  "func Write(b *Buf, p []byte) (int, error) {",
  "\tif p == nil {",
  "\t\treturn 0, errors.New(\"nil payload\")",
  "\t}",
  "\tb.data = append(b.data, p...)",
  "\treturn len(p), nil",
  "}",
]);

const goPreconditionUnguarded = go("go must, no guard", [
  "// Write appends p to the buffer. p must not be nil.",
  "func Write(b *Buf, p []byte) (int, error) {",
  "\tb.data = append(b.data, p...)",
  "\treturn len(p), nil",
  "}",
]);

const csPreconditionGuarded = cs("csharp requires + ThrowIfNull", [
  "/// <summary>Loads the config. Requires a non-null path.</summary>",
  "public Config Load(string path)",
  "{",
  "    ArgumentNullException.ThrowIfNull(path);",
  "    return Reader.Read(path);",
  "}",
], { body: 3 });

const csPreconditionUnguarded = cs("csharp requires, no guard", [
  "/// <summary>Loads the config. Requires a non-null path.</summary>",
  "public Config Load(string path)",
  "{",
  "    return Reader.Read(path);",
  "}",
], { body: 3 });

const tsPreconditionGuarded = ts("typescript must + throw new", [
  "/** Loads the session. The id must be a non-empty string. */",
  "export function load(id: string): Session {",
  "  if (id.length === 0) {",
  "    throw new Error(\"empty id\");",
  "  }",
  "  return sessions.get(id);",
  "}",
]);

const tsPreconditionUnguarded = ts("typescript must, no guard", [
  "/** Loads the session. The id must be a non-empty string. */",
  "export function load(id: string): Session {",
  "  return sessions.get(id);",
  "}",
]);

const pyPreconditionGuarded = py("python must + raise", [
  "def load(session_id):",
  "    \"\"\"Loads the session. The id must be a non-empty string.\"\"\"",
  "    if not session_id:",
  "        raise ValueError(\"empty id\")",
  "    return SESSIONS[session_id]",
], { head: 0, body: 2 });

const pyPreconditionUnguarded = py("python must, no guard", [
  "def load(session_id):",
  "    \"\"\"Loads the session. The id must be a non-empty string.\"\"\"",
  "    return SESSIONS[session_id]",
], { head: 0, body: 2 });

const pyNoDocAtAll = py("python no docstring, no guard", [
  "def load(session_id):",
  "    return SESSIONS[session_id]",
], { head: 0, body: 1 });

test("D10 Rust: a doc that says must plus an assert! is CLEAN", () => {
  expectClean("unenforced-precondition", rustPreconditionGuarded);
  expectFlagged("unenforced-precondition", rustPreconditionUnguarded, 1);
});

test("D10 Go: an if x == nil early return is the guard", () => {
  expectClean("unenforced-precondition", goPreconditionGuarded);
  expectFlagged("unenforced-precondition", goPreconditionUnguarded, 1);
});

test("D10 C#: ArgumentNullException.ThrowIfNull is the guard", () => {
  expectClean("unenforced-precondition", csPreconditionGuarded);
  expectFlagged("unenforced-precondition", csPreconditionUnguarded, 1);
});

test("D10 TypeScript: throw new on a checked condition is the guard", () => {
  expectClean("unenforced-precondition", tsPreconditionGuarded);
  expectFlagged("unenforced-precondition", tsPreconditionUnguarded, 1);
});

test("D10 Python: raise is the guard", () => {
  expectClean("unenforced-precondition", pyPreconditionGuarded);
  expectFlagged("unenforced-precondition", pyPreconditionUnguarded, 1);
});

test("D10 a doc-less function is CLEAN here - nothing was promised", () => {
  expectClean("unenforced-precondition", rustNoDocAtAll);
  expectClean("unenforced-precondition", pyNoDocAtAll);
});

// ===========================================================================
// DIMENSION 11 - command-query separation, Meyer 1988. A void / unit / None
// return that mutates is a COMMAND, and a command may change the world.
// ===========================================================================

const csQueryAndCommand = cs("csharp returns a value and assigns a property", [
  "/// <summary>Records the hit and returns the running total.</summary>",
  "public int RecordHit(string key)",
  "{",
  "    this.Total += 1;",
  "    return this.Total;",
  "}",
], { body: 3 });

const csCommandOnly = cs("csharp void, assigns a property", [
  "/// <summary>Records the hit.</summary>",
  "public void RecordHit(string key)",
  "{",
  "    this.Total += 1;",
  "}",
], { body: 3 });

const rustQueryAndCommand = rust("rust &mut self returning a value", [
  "/// Pushes `item` and returns the new length.",
  "pub fn push(&mut self, item: String) -> usize {",
  "    self.items.push(item);",
  "    self.items.len()",
  "}",
]);

const rustCommandOnly = rust("rust &mut self returning unit", [
  "/// Pushes `item` onto the tail.",
  "pub fn push(&mut self, item: String) {",
  "    self.items.push(item);",
  "}",
]);

const tsQueryAndCommand = ts("typescript returns a value and assigns this.x", [
  "/** Bumps the counter and returns its new value. */",
  "bump(step: number): number {",
  "  this.count += step;",
  "  return this.count;",
  "}",
]);

const tsCommandOnly = ts("typescript void, assigns this.x", [
  "/** Bumps the counter. */",
  "bump(step: number): void {",
  "  this.count += step;",
  "}",
]);

const pyQueryAndCommand = py("python returns a value and assigns self.x", [
  "def bump(self, step: int) -> int:",
  "    \"\"\"Bumps the counter and returns its new value.\"\"\"",
  "    self.count += step",
  "    return self.count",
], { head: 0, body: 2 });

const pyCommandOnly = py("python None return, assigns self.x", [
  "def bump(self, step: int) -> None:",
  "    \"\"\"Bumps the counter.\"\"\"",
  "    self.count += step",
], { head: 0, body: 2 });

const goQueryAndCommand = go("go pointer receiver returning a value", [
  "// Add stores n and returns the running total.",
  "func (c *Counter) Add(n int) int {",
  "\tc.total += n",
  "\treturn c.total",
  "}",
]);

const goCommandOnly = go("go pointer receiver, no return", [
  "// Add stores n.",
  "func (c *Counter) Add(n int) {",
  "\tc.total += n",
  "}",
]);

test("D11 C#: returning data while assigning a property fires", () => {
  expectFlagged("cqs", csQueryAndCommand, 1);
});

test("D11 Rust: a &mut self receiver that returns a value fires", () => {
  expectFlagged("cqs", rustQueryAndCommand, 1);
});

test("D11 TypeScript, Python and Go fire on the same shape", () => {
  expectFlagged("cqs", tsQueryAndCommand, 1);
  expectFlagged("cqs", pyQueryAndCommand, 1);
  expectFlagged("cqs", goQueryAndCommand, 1);
});

test("D11 a void / unit / None return that mutates is CLEAN in every language", () => {
  expectClean("cqs", csCommandOnly);
  expectClean("cqs", rustCommandOnly);
  expectClean("cqs", tsCommandOnly);
  expectClean("cqs", pyCommandOnly);
  expectClean("cqs", goCommandOnly);
});

// ===========================================================================
// DIMENSION 12 - shallow pass-through. Ousterhout 2018.
// ===========================================================================

const rustPassThrough = rust("rust one delegating call", [
  "/// Parses `text` in the requested mode.",
  "pub fn parse(text: &str, mode: Mode) -> Ast {",
  "    inner::parse(text, mode)",
  "}",
]);

const rustTransformsFirst = rust("rust transforms an argument before delegating", [
  "/// Parses `text` in the requested mode, ignoring surrounding whitespace.",
  "pub fn parse(text: &str, mode: Mode) -> Ast {",
  "    inner::parse(text.trim(), mode)",
  "}",
]);

const tsPassThrough = ts("typescript one delegating call", [
  "/** Writes the payload to the sink. */",
  "export function write(payload: Buffer, sink: Sink): number {",
  "  return sinkWrite(payload, sink);",
  "}",
]);

const tsNarrowerCall = ts("typescript delegates with fewer arguments than parameters", [
  "/** Opens the file at the given path. */",
  "export function open(path: string, mode: string): Handle {",
  "  return sys.open(path);",
  "}",
]);

const tsLiteralReturn = ts("typescript returns a literal", [
  "/** The wire format version this build speaks. */",
  "export function version(): number {",
  "  return 3;",
  "}",
]);

const tsFieldReturn = ts("typescript returns a field", [
  "/** The display name. */",
  "name(): string {",
  "  return this.displayName;",
  "}",
]);

const csPassThrough = cs("csharp one delegating call", [
  "/// <summary>Writes the payload to the sink.</summary>",
  "public int Write(byte[] payload, Sink sink)",
  "{",
  "    return Sinks.Write(payload, sink);",
  "}",
], { body: 3 });

const pyPassThrough = py("python one delegating call", [
  "def parse(text: str, mode: str) -> Ast:",
  "    \"\"\"Parses text in the requested mode.\"\"\"",
  "    return _inner.parse(text, mode)",
], { head: 0, body: 2 });

const goPassThrough = go("go one delegating call", [
  "// Parse parses text in the requested mode.",
  "func Parse(text string, mode Mode) (Ast, error) {",
  "\treturn inner.Parse(text, mode)",
  "}",
]);

test("D12 fires when the body is one delegating call as wide as the signature", () => {
  expectFlagged("pass-through", rustPassThrough, 1);
  expectFlagged("pass-through", tsPassThrough, 1);
  expectFlagged("pass-through", csPassThrough, 1);
  expectFlagged("pass-through", pyPassThrough, 1);
  expectFlagged("pass-through", goPassThrough, 1);
});

test("D12 a body that TRANSFORMS its arguments before delegating is not a pass-through", () => {
  expectClean("pass-through", rustTransformsFirst);
});

test("D12 a delegating call narrower than the signature is not a pass-through", () => {
  expectClean("pass-through", tsNarrowerCall);
});

test("D12 one return of a literal, or of a field, is not a pass-through", () => {
  expectClean("pass-through", tsLiteralReturn);
  expectClean("pass-through", tsFieldReturn);
});

// ===========================================================================
// DIMENSION 13 - nesting depth. Python counts INDENTATION: a brace counter
// reads every Python function as depth zero, and that zero looks exactly like
// a clean result. This block is what catches it.
// ===========================================================================

const pyDeeplyNested = py("python deeply nested body", [
  "def resolve(rows, key):",
  "    \"\"\"Finds the first ready cell matching key.\"\"\"",
  "    for row in rows:",
  "        if row:",
  "            for cell in row:",
  "                if cell.key == key:",
  "                    if cell.ready:",
  "                        return cell.value",
  "    return None",
], { head: 0, body: 2 });

const pyShallow = py("python shallow body", [
  "def total(rows):",
  "    \"\"\"Adds every row.\"\"\"",
  "    n = 0",
  "    for row in rows:",
  "        n += row",
  "    return n",
], { head: 0, body: 2 });

const rustDeeplyNested = rust("rust deeply nested body", [
  "/// Finds the first ready cell matching `key`.",
  "pub fn resolve(&self, key: &str) -> Option<&Cell> {",
  "    for row in &self.rows {",
  "        if !row.is_empty() {",
  "            for cell in row {",
  "                if cell.key == key {",
  "                    if cell.ready {",
  "                        return Some(cell);",
  "                    }",
  "                }",
  "            }",
  "        }",
  "    }",
  "    None",
  "}",
]);

const rustShallow = rust("rust shallow body", [
  "/// Adds every row width.",
  "pub fn total(&self) -> usize {",
  "    let mut n = 0;",
  "    for row in &self.rows {",
  "        n += row.width;",
  "    }",
  "    n",
  "}",
]);

const tsDeeplyNested = ts("typescript deeply nested body", [
  "/** Finds the first ready cell matching the key. */",
  "export function resolve(rows: Row[], key: string): Cell | undefined {",
  "  for (const row of rows) {",
  "    if (row.cells.length > 0) {",
  "      for (const cell of row.cells) {",
  "        if (cell.key === key) {",
  "          if (cell.ready) {",
  "            return cell;",
  "          }",
  "        }",
  "      }",
  "    }",
  "  }",
  "  return undefined;",
  "}",
]);

const csDeeplyNested = cs("csharp deeply nested body", [
  "/// <summary>Finds the first ready cell matching the key.</summary>",
  "public Cell Resolve(string key)",
  "{",
  "    foreach (var row in Rows)",
  "    {",
  "        if (row.Cells.Count > 0)",
  "        {",
  "            foreach (var cell in row.Cells)",
  "            {",
  "                if (cell.Key == key)",
  "                {",
  "                    if (cell.Ready)",
  "                    {",
  "                        return cell;",
  "                    }",
  "                }",
  "            }",
  "        }",
  "    }",
  "    return null;",
  "}",
], { body: 3 });

const goDeeplyNested = go("go deeply nested body", [
  "// Resolve finds the first ready cell matching key.",
  "func Resolve(rows []Row, key string) *Cell {",
  "\tfor _, row := range rows {",
  "\t\tif len(row.Cells) > 0 {",
  "\t\t\tfor _, cell := range row.Cells {",
  "\t\t\t\tif cell.Key == key {",
  "\t\t\t\t\tif cell.Ready {",
  "\t\t\t\t\t\treturn &cell",
  "\t\t\t\t\t}",
  "\t\t\t\t}",
  "\t\t\t}",
  "\t\t}",
  "\t}",
  "\treturn nil",
  "}",
]);

test("D13 PYTHON counts indentation - a deeply nested Python body FIRES", () => {
  // A brace counter reads this as depth zero, and depth zero renders as clean.
  const findings = expectFlagged("nesting", pyDeeplyNested, 1);
  const digits = findings[0].detail.match(/\d+/g);
  if (digits) {
    assert.ok(
      digits.some((d) => Number(d) > 0),
      `a Python depth of zero means the counter read braces: "${findings[0].detail}"`,
    );
  }
});

test("D13 a shallow Python body is clean", () => {
  expectClean("nesting", pyShallow);
});

test("D13 fires on deep brace-language bodies and stays quiet on shallow ones", () => {
  expectFlagged("nesting", rustDeeplyNested, 1);
  expectFlagged("nesting", tsDeeplyNested, 1);
  expectFlagged("nesting", csDeeplyNested, 1);
  expectFlagged("nesting", goDeeplyNested, 1);
  expectClean("nesting", rustShallow);
});

// ===========================================================================
// DIMENSION 14 - can it fail in a way the signature never admits. One idea,
// five detectors, and the MEANING changes per language.
// ===========================================================================

const tsThrows = ts("typescript body that throws", [
  "/** Loads the session, throwing when the id is unknown. */",
  "export function load(id: string): Session {",
  "  const found = sessions.get(id);",
  "  if (found === undefined) {",
  "    throw new Error(\"unknown session\");",
  "  }",
  "  return found;",
  "}",
]);

const tsQuiet = ts("typescript body that cannot throw", [
  "/** Returns the row count. */",
  "export function count(rows: Row[]): number {",
  "  return rows.length;",
  "}",
]);

const rustUnwrapNoResult = rust("rust unwrap with a plain return type", [
  "/// Loads the first row of the table at `path`.",
  "pub fn load(path: &str) -> Row {",
  "    let table = open_table(path).unwrap();",
  "    table.first()",
  "}",
]);

const rustUnwrapWithResult = rust("rust unwrap inside a Result-returning fn", [
  "/// Loads the first row, returning an error when the table is missing.",
  "pub fn load(path: &str) -> Result<Row, Error> {",
  "    let table = open_table(path).unwrap();",
  "    Ok(table.first())",
  "}",
]);

const rustPanicWithOption = rust("rust panic inside an Option-returning fn", [
  "/// Returns the first ready row, if the table has one.",
  "pub fn first_ready(&self) -> Option<&Row> {",
  "    if self.rows.is_empty() {",
  "        panic!(\"table was never opened\");",
  "    }",
  "    self.rows.iter().find(|r| r.ready)",
  "}",
]);

const rustTodoNoReturn = rust("rust todo! with no return type", [
  "/// Installs the schema.",
  "pub fn install(&mut self) {",
  "    todo!(\"schema install lands with the migration work\");",
  "}",
]);

const goDroppedError = go("go dropped error", [
  "// Flush writes any buffered bytes and resets the buffer.",
  "func Flush(b *Buf, f *os.File) {",
  "\t_ = f.Sync()",
  "\tb.data = b.data[:0]",
  "}",
]);

const goPanicsButHandlesErrors = go("go panics, handles every error", [
  "// MustParse parses s and panics when it is malformed.",
  "func MustParse(s string) Config {",
  "\tc, err := parse(s)",
  "\tif err != nil {",
  "\t\tpanic(err)",
  "\t}",
  "\treturn c",
  "}",
]);

const csUndocumentedThrow = cs("csharp throw with no <exception>", [
  "/// <summary>Loads the config from disk.</summary>",
  "public Config Load(string path)",
  "{",
  "    if (path.Length == 0)",
  "    {",
  "        throw new ArgumentException(\"empty path\");",
  "    }",
  "    return Reader.Read(path);",
  "}",
], { body: 3 });

const csDocumentedThrow = cs("csharp throw with an <exception> element", [
  "/// <summary>Loads the config from disk.</summary>",
  "/// <exception cref=\"ArgumentException\">The path was empty.</exception>",
  "public Config Load(string path)",
  "{",
  "    if (path.Length == 0)",
  "    {",
  "        throw new ArgumentException(\"empty path\");",
  "    }",
  "    return Reader.Read(path);",
  "}",
], { body: 4 });

const pyRaiseUndocumented = py("python raise with no Raises: section", [
  "def load(session_id):",
  "    \"\"\"Loads the session for the given id.\"\"\"",
  "    if session_id not in SESSIONS:",
  "        raise KeyError(session_id)",
  "    return SESSIONS[session_id]",
], { head: 0, body: 2 });

const pyRaiseDocumented = py("python raise with a Raises: section", [
  "def load(session_id):",
  "    \"\"\"Loads the session for the given id.",
  "",
  "    Raises:",
  "        KeyError: when the id is not open.",
  "    \"\"\"",
  "    if session_id not in SESSIONS:",
  "        raise KeyError(session_id)",
  "    return SESSIONS[session_id]",
], { head: 0, body: 6 });

test("D14 TypeScript is ALWAYS blind - the language has no checked exceptions", () => {
  for (const fn of [tsThrows, tsQuiet]) {
    const out = expectBlind("unadmitted-failure", fn);
    assert.match(
      out.reason,
      /typescript|checked exception/i,
      `the reason must say what the language cannot tell you: "${out.reason}"`,
    );
  }
});

test("D14 Rust: unwrap in a plain-returning fn fires", () => {
  expectFlagged("unadmitted-failure", rustUnwrapNoResult, 1);
  expectFlagged("unadmitted-failure", rustTodoNoReturn, 1);
});

test("D14 Rust: unwrap inside a Result-returning fn is CLEAN", () => {
  expectClean("unadmitted-failure", rustUnwrapWithResult);
  expectClean("unadmitted-failure", rustPanicWithOption);
});

test("D14 Go: a DROPPED error fires, and a panic does not", () => {
  expectFlagged("unadmitted-failure", goDroppedError, 1);
  expectClean("unadmitted-failure", goPanicsButHandlesErrors);
});

test("D14 C#: a throw the doc never lists in an <exception> element fires", () => {
  expectFlagged("unadmitted-failure", csUndocumentedThrow, 1);
  expectClean("unadmitted-failure", csDocumentedThrow);
});

test("D14 Python: a raise with no Raises: section fires", () => {
  expectFlagged("unadmitted-failure", pyRaiseUndocumented, 1);
  expectClean("unadmitted-failure", pyRaiseDocumented);
});

// ===========================================================================
// DIMENSION 15 - section comment betrays mixed altitude. Wirth 1971.
// Ships SCORED but NOT ELEVATED, and the detector carries the held flag.
// ===========================================================================

const rustSectionComments = rust("rust three section comments", [
  "/// Rebuilds the index from disk.",
  "pub fn rebuild(&mut self) {",
  "    // read every shard",
  "    let shards = self.read_shards();",
  "    // fold them into one map",
  "    let map = fold(shards);",
  "    // publish",
  "    self.index = map;",
  "}",
], { startLine: 200 });

const rustDocOnly = rust("rust doc comment only", [
  "/// Rebuilds the index from disk.",
  "/// The shards are read in file order.",
  "pub fn rebuild(&mut self) {",
  "    let shards = self.read_shards();",
  "    self.index = fold(shards);",
  "}",
]);

const rustTrailingComment = rust("rust comment on the same line as code", [
  "/// Rebuilds the index from disk.",
  "pub fn rebuild(&mut self) {",
  "    let shards = self.read_shards(); // every shard, in file order",
  "    self.index = fold(shards);",
  "}",
]);

const rustCommentedOutCode = rust("rust commented-out code, all four tells", [
  "/// Rebuilds the index from disk.",
  "pub fn rebuild(&mut self) {",
  "    // let shards = self.read_shards();",
  "    // if shards.is_empty() {",
  "    // }",
  "    // fold(",
  "    self.index = fold(self.read_shards());",
  "}",
]);

const pyTrailingProse = py("python comment with no code after it", [
  "def rebuild(self):",
  "    \"\"\"Rebuilds the index from disk.\"\"\"",
  "    self.index = fold(self.read_shards())",
  "    # the shard compaction pass is tracked in the queue",
], { head: 0, body: 2 });

const pySectionComment = py("python section comment", [
  "def rebuild(self):",
  "    \"\"\"Rebuilds the index from disk.\"\"\"",
  "    # read every shard",
  "    shards = self.read_shards()",
  "    self.index = fold(shards)",
], { head: 0, body: 2 });

const goSectionComment = go("go section comment", [
  "// Rebuild rebuilds the index from disk.",
  "func (i *Index) Rebuild() {",
  "\t// read every shard",
  "\tshards := i.readShards()",
  "\ti.data = fold(shards)",
  "}",
]);

const csSectionComment = cs("csharp section comment", [
  "/// <summary>Rebuilds the index from disk.</summary>",
  "public void Rebuild()",
  "{",
  "    // read every shard",
  "    var shards = ReadShards();",
  "    Data = Fold(shards);",
  "}",
], { body: 3 });

const tsSectionComment = ts("typescript section comment", [
  "/** Rebuilds the index from disk. */",
  "rebuild(): void {",
  "  // read every shard",
  "  const shards = this.readShards();",
  "  this.data = fold(shards);",
  "}",
]);

test("D15 fires on each section comment, sorted ascending on document lines", () => {
  const findings = expectFlagged("section-comment", rustSectionComments, 3);
  assert.deepEqual(findings.map((f) => f.line), [202, 204, 206]);
  assert.equal(findings[0].evidence, "// read every shard");
});

test("D15 a DOC comment above the declaration is not a section comment", () => {
  expectClean("section-comment", rustDocOnly);
});

test("D15 a comment on the same line as code is not a section comment", () => {
  expectClean("section-comment", rustTrailingComment);
});

test("D15 commented-out code is not a section comment - the tells are ; { } and (", () => {
  expectClean("section-comment", rustCommentedOutCode);
});

test("D15 a comment with no code following it is not a section comment", () => {
  expectClean("section-comment", pyTrailingProse);
});

test("D15 fires in Python, Go, C# and TypeScript on each language's line comment", () => {
  expectFlagged("section-comment", pySectionComment, 1);
  expectFlagged("section-comment", goSectionComment, 1);
  expectFlagged("section-comment", csSectionComment, 1);
  expectFlagged("section-comment", tsSectionComment, 1);
});

test("D15 the detector carries a HELD flag, and it is the only detector that does", () => {
  const isHeld = (d) => d.held === true || d.heldPendingRuling === true || d.elevated === false || d.elevate === false;
  const section = byDim("section-comment");
  assert.ok(
    isHeld(section),
    `dimension 14 ships scored but not elevated, so the detector must carry the flag phase 3 reads. keys: ${JSON.stringify(Object.keys(section))}`,
  );
  const others = ALL_DETECTORS.filter((d) => d.dimension !== "section-comment" && isHeld(d));
  assert.deepEqual(
    others.map((d) => d.dimension),
    [],
    "only dimension 14 is held pending the end-of-session ruling",
  );
});

// ===========================================================================
// Cross-cutting rules that bind every dimension in this phase.
// ===========================================================================

const EXPECTED_MODULE_DIMENSIONS = {
  signature: ["adjacent-params", "bool-param", "param-count"],
  contract: ["undocumented", "unenforced-precondition", "cqs"],
  altitude: ["pass-through", "nesting", "section-comment"],
  safety: ["unadmitted-failure"],
};

test("each module carries exactly the dimensions the contract assigns it", () => {
  for (const [name, expected] of Object.entries(EXPECTED_MODULE_DIMENSIONS)) {
    const got = MODULE_DETECTORS[name].map((d) => d.dimension).sort();
    assert.deepEqual(got, expected.slice().sort(), `criticize${name} carries the wrong dimensions`);
  }
});

test("the four modules cover dimensions 5 to 14 once each, and nothing else", () => {
  const all = ALL_DETECTORS.map((d) => d.dimension).sort();
  const expected = [].concat(...Object.values(EXPECTED_MODULE_DIMENSIONS)).sort();
  assert.deepEqual(all, expected);
  assert.equal(new Set(all).size, all.length, "a dimension is served by two detectors");
  assert.equal(all.length, 10);
});

test("every detector carries a non-empty source line and a valid axis", () => {
  const axes = new Set(["safer", "understandable", "both"]);
  for (const d of ALL_DETECTORS) {
    assert.ok(
      typeof d.source === "string" && d.source.trim().length > 0,
      `${d.dimension}: the curriculum line is the product, and it must never be empty`,
    );
    assert.ok(axes.has(d.axis), `${d.dimension}: axis "${d.axis}" is not one of safer/understandable/both`);
  }
});

test("every detector answers every fixture with a well-formed outcome", () => {
  assert.ok(ALL_FIXTURES.length >= 80, `expected a real corpus, built ${ALL_FIXTURES.length} slices`);
  let blinds = 0;
  let flaggeds = 0;
  for (const fn of ALL_FIXTURES) {
    const lang = criticizeLangFor(fn.languageId);
    assert.ok(lang, `no profile for ${fn.languageId}`);
    for (const d of ALL_DETECTORS) {
      const out = d.run(fn, lang);
      assert.ok(out && typeof out === "object", `${d.dimension}/${fn.name}: no outcome`);
      if (out.state === "blind") {
        blinds += 1;
        assert.ok(
          typeof out.reason === "string" && out.reason.trim().length > 0,
          `${d.dimension}/${fn.name}: a blind outcome with an empty reason is a defect`,
        );
      } else if (out.state === "flagged") {
        flaggeds += 1;
        validateFindings(d.dimension, fn, out.findings);
      } else {
        assert.equal(out.state, "clean", `${d.dimension}/${fn.name}: unknown state`);
        assert.equal(out.findings, undefined, `${d.dimension}/${fn.name}: a clean outcome carries no findings`);
      }
    }
  }
  assert.ok(blinds > 0, "the corpus contains Python and TypeScript rows that must refuse by name");
  assert.ok(flaggeds > 0, "the corpus contains rows that must fire");
});

test("no detail names a fix - these dimensions ADVISE, they never prescribe", () => {
  const offenders = [];
  for (const fn of ALL_FIXTURES) {
    const lang = criticizeLangFor(fn.languageId);
    for (const d of ALL_DETECTORS) {
      const out = d.run(fn, lang);
      if (out.state !== "flagged") continue;
      for (const f of out.findings) {
        if (FIX_WORDS.test(f.detail)) offenders.push(`${d.dimension}/${fn.name}: "${f.detail}"`);
      }
    }
  }
  assert.deepEqual(offenders, [], "a detail that names a fix has turned the rubric into a linter");
});

// ===========================================================================
// The parameter model. The contract grows `parseParams` on the profile.
// ===========================================================================

function parseParamsFor(fn) {
  const lang = criticizeLangFor(fn.languageId);
  const bound =
    typeof lang.parseParams === "function"
      ? (f) => lang.parseParams(f)
      : typeof mod.lang.parseParams === "function"
        ? (f) => mod.lang.parseParams(f, lang)
        : undefined;
  assert.ok(bound, `no parseParams reachable for "${fn.languageId}"`);
  return bound(fn);
}

test("parseParams reads names and types, and excludes the receiver", () => {
  const params = parseParamsFor(rustReceiverNotAParam);
  assert.ok(Array.isArray(params), `expected a parameter list, got ${JSON.stringify(params)}`);
  assert.deepEqual(params.map((p) => p.name), ["label"], "&self is a receiver, not a parameter");

  const pyParams = parseParamsFor(pyReceiverNotAParam);
  assert.deepEqual(pyParams.map((p) => p.name), ["label"], "self is a receiver, not a parameter");

  const goParams = parseParamsFor(goQueryAndCommand);
  assert.deepEqual(goParams.map((p) => p.name), ["n"], "a Go method receiver is not a parameter");
});

test("parseParams marks Go's grouped spelling, and does not mark the separate one", () => {
  const grouped = parseParamsFor(goGrouped);
  assert.deepEqual(grouped.map((p) => p.name), ["dst", "src"]);
  assert.deepEqual(grouped.map((p) => p.grouped), [true, true]);

  const separate = parseParamsFor(goSeparatelyTyped);
  assert.deepEqual(separate.map((p) => p.name), ["a", "b"]);
  assert.deepEqual(separate.map((p) => p.grouped), [false, false]);
});

test("parseParams leaves type undefined where Python never made the developer write one", () => {
  const params = parseParamsFor(pyPartiallyAnnotated);
  assert.deepEqual(params.map((p) => p.name), ["a", "b", "c"]);
  assert.deepEqual(params.map((p) => p.type === undefined), [false, true, false]);
});
