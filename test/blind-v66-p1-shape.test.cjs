// Blind oracle for session-v66 phase 1: no inline item ends on an empty line
// (src/core/dictationDoc: freshLineAfter, declarationGhost). Written against
// session-v66/contracts/phase1-shape.md only; nothing here reads src/**.
// Expected texts are built from the contract's rules (doc form per language,
// indent on later lines, body line at indent+unit, closer), with the strings the
// contract spells out literally pinned as-is.
//
// Run: SKIP_LIVE=1 node --test test/blind-v66-p1-shape.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore("blind-v66-p1-shape", 'export * from "../src/core/dictationDoc";\n');
const { freshLineAfter, declarationGhost } = mod;
test.after(cleanup);

// ---- fixtures and rule-derived builders

const TS_FAMILY = ["typescript", "typescriptreact", "javascript", "javascriptreact"];
const LANGS = ["rust", "csharp", "go", ...TS_FAMILY, "python"];
const INDENTS = ["", " ", "    ", "\t", "\t\t"];
const EOLS = ["\n", "\r\n"];
const SENTENCE = "The shape.";
const unitFor = (indent) => (indent.includes("\t") ? "\t" : "    ");

// Rule 14's table. 7 = opens a body, 9 = opens nothing.
const SHAPES = [
  ["rust", "pub struct Point {", 7],
  ["rust", "pub struct Unit;", 9],
  ["rust", "pub enum Kind {", 7],
  ["rust", "pub trait Shape {", 7],
  ["rust", "impl Point {", 7],
  ["rust", "pub type Alias = Vec<u8>;", 9],
  ["rust", "pub fn area(&self) -> f64 {", 7],
  ["rust", "fn area(&self) -> f64;", 9],
  ["typescript", "export class Point {", 7],
  ["typescript", "export interface Shape {", 7],
  ["typescript", "export enum Kind {", 7],
  ["typescript", "export type Point = { x: number; y: number; z: number };", 9],
  ["typescript", "export type Id = string;", 9],
  ["typescript", "export function area(p: Point): number {", 7],
  ["typescript", "export const ORIGIN = { x: 0, y: 0 };", 9],
  ["csharp", "public class Point", 7],
  ["csharp", "public struct Point", 7],
  ["csharp", "public interface IShape", 7],
  ["csharp", "public enum Kind", 7],
  ["csharp", "public record Point(int X, int Y, int Z);", 9],
  ["csharp", "public record Point(int X, int Y, int Z)", 7],
  ["csharp", "public double Area()", 7],
  ["csharp", "public int Count;", 9],
  ["csharp", "public int Count { get; set; }", 9],
  ["go", "type Point struct {", 7],
  ["go", "type Shape interface {", 7],
  ["go", "type Kind int", 9],
  ["go", "func (p Point) Area() float64 {", 7],
  ["go", "var Origin = Point{}", 9],
  ["python", "class Point:", 7],
  ["python", "class Kind(Enum):", 7],
  ["python", "def area(self) -> float:", 7],
  ["python", "Origin = Point(0, 0)", 9],
];

// Rule 9's other no-body shapes: a cap-cut head and an empty head, per language.
const CAP_CUT = {
  rust: "pub fn area(&self, other: &Point) ->",
  csharp: "public double Distance(Point other,",
  go: "func (p Point) Distance(other Point,",
  python: "def distance(self, other: Point,",
};
for (const l of TS_FAMILY) CAP_CUT[l] = "export function distance(a: Point, b: Point,";
const EMPTY_HEADS = [undefined, ""];
// Rules 1 and 2, restated locally so expected texts do not lean on the module.
const fresh = (eol, indent) => (indent.length > 0 ? eol + indent : "");

// Rule 5: the doc comment form per language.
function docLines(sentence, lang) {
  if (lang === "rust" || lang === "csharp") return ["/// " + sentence];
  if (lang === "go") return ["// " + sentence];
  if (TS_FAMILY.includes(lang)) return ["/**", " * " + sentence, " */"];
  return [];
}

// Rule 6: first line bare, every later line starts with indent.
const joinAt = (lines, eol, indent) => lines.map((l, i) => (i === 0 ? l : indent + l)).join(eol);

// Rules 8 and 9: doc, trimmed head, then the fresh line.
function expectNoBody(head, sentence, lang, eol, indent) {
  const lines = docLines(sentence, lang);
  const h = typeof head === "string" ? head.trim() : "";
  if (h !== "") lines.push(h);
  return joinAt(lines, eol, indent) + fresh(eol, indent);
}

// Rule 7: doc, head, (csharp own-line brace), (python docstring), body line, closer.
function expectBody(head, sentence, lang, eol, indent, unit) {
  const lines = docLines(sentence, lang);
  const h = head.trim();
  lines.push(h);
  if (lang === "csharp" && !h.endsWith("{")) lines.push("{");
  if (lang === "python") lines.push(unit + '"""' + sentence + '"""');
  lines.push(unit);
  const caretOffset = joinAt(lines, eol, indent).length;
  if (lang !== "python") lines.push("}");
  return { text: joinAt(lines, eol, indent), caretOffset };
}

const splitLines = (text) => text.split(/\r\n|\n|\r/);

function lineAt(text, offset) {
  const before = text.slice(0, offset);
  const start = Math.max(before.lastIndexOf("\n"), before.lastIndexOf("\r")) + 1;
  const m = text.slice(offset).search(/\r|\n/);
  return text.slice(start, m < 0 ? text.length : offset + m);
}

// Rule 12's invariants on one ghost.
function checkInvariants(g, indent, label) {
  assert.strictEqual(typeof g.text, "string", label);
  assert.ok(!g.text.endsWith("\n") && !g.text.endsWith("\r"), `${label}: text ends with a line break`);
  assert.ok(Number.isInteger(g.caretOffset), `${label}: caretOffset is not an integer`);
  assert.ok(g.caretOffset >= 0 && g.caretOffset <= g.text.length, `${label}: caret out of range`);
  if (indent === "") assert.notStrictEqual(lineAt(g.text, g.caretOffset), "", `${label}: caret sits on an empty line`);
  const lines = splitLines(g.text);
  assert.notStrictEqual(lines[lines.length - 1], "", `${label}: last line is empty`);
}

// Rule 6 on one ghost.
function checkIndentLayout(g, indent, label) {
  const lines = splitLines(g.text);
  assert.ok(!/^[ \t]/.test(lines[0]), `${label}: first line carries indent`);
  for (const l of lines.slice(1)) assert.ok(l.startsWith(indent), `${label}: later line lacks indent: ${JSON.stringify(l)}`);
}

const tag = (lang, head, eol, indent) => `${lang} ${JSON.stringify(head)} eol=${JSON.stringify(eol)} indent=${JSON.stringify(indent)}`;

// ---- freshLineAfter

test("rule 1: a non-empty indent gives eol + indent", () => {
  assert.strictEqual(freshLineAfter("\n", "    "), "\n    ");
  assert.strictEqual(freshLineAfter("\r\n", "\t"), "\r\n\t");
  for (const i of [" ", "\t\t"]) assert.strictEqual(freshLineAfter("\r\n", i), "\r\n" + i);
});

test("rule 2: the empty indent gives the empty string", () => {
  for (const eol of EOLS) assert.strictEqual(freshLineAfter(eol, ""), "");
});

test("rule 3: a non-string eol or indent is treated as the empty string", () => {
  for (const eol of [undefined, null, 3]) assert.strictEqual(freshLineAfter(eol, "  "), "  ", String(eol));
  for (const indent of [undefined, null, 4]) assert.strictEqual(freshLineAfter("\n", indent), "", String(indent));
  assert.strictEqual(freshLineAfter(undefined, undefined), "");
});

test("rule 4: the result never ends with a line break", () => {
  for (const eol of ["\n", "\r\n", "\r", "", undefined, null, 7]) {
    for (const indent of [...INDENTS, undefined, null, 7]) {
      const r = freshLineAfter(eol, indent);
      assert.ok(typeof r === "string" && !/[\r\n]$/.test(r), `${JSON.stringify(eol)} ${JSON.stringify(indent)}`);
    }
  }
});

// ---- declarationGhost, unchanged rules

test("rule 5: the doc comment form per language, above the head or as the docstring", () => {
  const rows = [
    ["rust", "pub struct Point {", "/// The shape.\npub struct Point {"],
    ["csharp", "public class Point", "/// The shape.\npublic class Point\n{"],
    ["go", "type Point struct {", "// The shape.\ntype Point struct {"],
  ];
  for (const [lang, head, prefix] of rows) {
    const t = declarationGhost(head, SENTENCE, lang, "\n", "", "    ").text;
    assert.ok(t.startsWith(prefix), `${lang}: ${t}`);
  }
  for (const lang of TS_FAMILY) {
    const ts = declarationGhost("export class Point {", SENTENCE, lang, "\n", "", "    ").text;
    assert.ok(ts.startsWith("/**\n * The shape.\n */\nexport class Point {"), `${lang}: ${ts}`);
  }
  const py = declarationGhost("class Point:", SENTENCE, "python", "\n", "", "    ").text;
  assert.ok(py.startsWith('class Point:\n    """The shape."""'), py);
});

test("rule 5: the doc lines wrap at 80 columns minus the indent", () => {
  const long = "word ".repeat(30).trim() + ".";
  const indent = "        ";
  // CONTRACT AMBIGUITY: python's docstring is a body line, not a doc line above the head; the
  // wrap rule is only checked on the languages that put lines above the head.
  for (const lang of LANGS.filter((l) => l !== "python")) {
    const head = lang === "csharp" ? "public class Point" : "fn f() {";
    const g = declarationGhost(head, long, lang, "\n", indent, "    ");
    const lines = splitLines(g.text);
    const headIdx = lines.findIndex((l) => l.trim() === head);
    assert.ok(headIdx > 1, `${lang}: the long sentence did not wrap onto more than one line`);
    for (let i = 0; i < headIdx; i++) {
      const content = i === 0 ? lines[i] : lines[i].slice(indent.length);
      assert.ok(i === 0 || lines[i].startsWith(indent), `${lang}: doc line ${i} lacks indent`);
      assert.ok(content.length <= 80 - indent.length, `${lang}: doc line ${i} is ${content.length} wide`);
    }
    const words = lines.slice(0, headIdx).join(" ").match(/\bword\b/g) || [];
    assert.strictEqual(words.length, 30, `${lang}: the wrapped doc lost words`);
  }
});

test("rule 6: the first line carries no indent, every later line starts with indent", () => {
  for (const lang of LANGS) {
    const head = lang === "csharp" ? "public class Point" : lang === "python" ? "class Point:" : "fn f() {";
    for (const indent of ["  ", "\t"]) {
      for (const eol of EOLS) {
        const g = declarationGhost(head, SENTENCE, lang, eol, indent, unitFor(indent));
        checkIndentLayout(g, indent, tag(lang, head, eol, indent));
      }
    }
  }
});

test("rule 7: a head that opens a body gets the body line at indent+unit, the closer, caret on the body line", () => {
  // csharp: the brace goes on its own line for a type keyword or a `)` head with no `{`.
  assert.strictEqual(declarationGhost("public class ThreatLevel", "The threat level.", "csharp", "\n", "", "    ").text,
    "/// The threat level.\npublic class ThreatLevel\n{\n    \n}");
  assert.strictEqual(declarationGhost("public double Area()", SENTENCE, "csharp", "\n", "", "    ").text,
    "/// The shape.\npublic double Area()\n{\n    \n}");
  // csharp with its own `{` does not get a second one.
  assert.strictEqual(declarationGhost("public class Point {", SENTENCE, "csharp", "\n", "", "    ").text,
    "/// The shape.\npublic class Point {\n    \n}");
  // python: docstring first, then the empty body line, caret at its end.
  const py = declarationGhost("def area(self) -> float:", SENTENCE, "python", "\n", "", "    ");
  assert.strictEqual(py.text, 'def area(self) -> float:\n    """The shape."""\n    ');
  assert.strictEqual(py.caretOffset, py.text.length);
  for (const [lang, head, rule] of SHAPES) {
    if (rule !== 7) continue;
    for (const eol of EOLS) {
      const want = expectBody(head, SENTENCE, lang, eol, "    ", "    ");
      const got = declarationGhost(head, SENTENCE, lang, eol, "    ", "    ");
      assert.strictEqual(got.text, want.text, tag(lang, head, eol, "    "));
      assert.strictEqual(got.caretOffset, want.caretOffset, tag(lang, head, eol, "    "));
    }
  }
});

test("rule 8: trailing whitespace on the served head is trimmed; a non-string head is empty", () => {
  assert.strictEqual(declarationGhost("fn f() {   ", "Say.", "rust", "\n", "", "  ").text, "/// Say.\nfn f() {\n  \n}");
  assert.strictEqual(declarationGhost("pub struct Unit;  \t", "Say.", "rust", "\n", "    ", "    ").text,
    declarationGhost("pub struct Unit;", "Say.", "rust", "\n", "    ", "    ").text);
  const bare = declarationGhost(undefined, "Say.", "rust", "\n", "    ", "    ");
  for (const served of [null, 42, {}, []]) {
    const g = declarationGhost(served, "Say.", "rust", "\n", "    ", "    ");
    assert.strictEqual(g.text, bare.text, `served=${JSON.stringify(served)}`);
    assert.strictEqual(g.caretOffset, bare.caretOffset, `served=${JSON.stringify(served)}`);
  }
  assert.strictEqual(declarationGhost(null, "Say.", "rust", "\n", "", "  ").text, "/// Say.");
});

// ---- declarationGhost, the new rule

test("rule 9: a no-body head at a non-empty indent ends with the fresh line at that indent", () => {
  assert.strictEqual(declarationGhost("public int Count;", "The count.", "csharp", "\n", "    ", "    ").text,
    "/// The count.\n    public int Count;\n    ");
  for (const [lang, head, rule] of SHAPES) {
    if (rule !== 9) continue;
    for (const eol of EOLS) {
      for (const indent of ["    ", "\t"]) {
        const got = declarationGhost(head, SENTENCE, lang, eol, indent, unitFor(indent)).text;
        assert.strictEqual(got, expectNoBody(head, SENTENCE, lang, eol, indent), tag(lang, head, eol, indent));
        assert.ok(got.endsWith(eol + indent), tag(lang, head, eol, indent));
      }
    }
  }
  // CONTRACT AMBIGUITY: rule 5 gives python no line above the head and rule 9 gives a no-body
  // head nothing but the fresh line, so the sentence has nowhere to go; the literal reading is
  // head + fresh line.
  assert.strictEqual(declarationGhost("Origin = Point(0, 0)", SENTENCE, "python", "\n", "    ", "    ").text,
    "Origin = Point(0, 0)\n    ");
});

test("rule 10: at module level the text ends at the end of the head", () => {
  assert.strictEqual(declarationGhost("pub struct Query;", "The query.", "rust", "\n", "", "    ").text,
    "/// The query.\npub struct Query;");
  assert.strictEqual(declarationGhost(undefined, "Say.", "rust", "\n", "", "  ").text, "/// Say.");
  assert.strictEqual(declarationGhost("", "Say.", "rust", "\n", "", "  ").text, "/// Say.");
  for (const [lang, head, rule] of SHAPES) {
    if (rule !== 9) continue;
    for (const eol of EOLS) {
      const got = declarationGhost(head, SENTENCE, lang, eol, "", "    ").text;
      assert.strictEqual(got, expectNoBody(head, SENTENCE, lang, eol, ""), tag(lang, head, eol, ""));
      assert.ok(got.endsWith(head), tag(lang, head, eol, ""));
    }
  }
  for (const lang of LANGS) {
    const g = declarationGhost(CAP_CUT[lang], SENTENCE, lang, "\n", "", "    ").text;
    assert.ok(g.endsWith(CAP_CUT[lang]), tag(lang, CAP_CUT[lang], "\n", ""));
  }
});

test("rule 11: caretOffset is text.length for every no-body head, indented or not", () => {
  const rows = SHAPES.filter(([, , r]) => r === 9).map(([l, h]) => [l, h]);
  for (const lang of LANGS) rows.push([lang, CAP_CUT[lang]], ...EMPTY_HEADS.map((h) => [lang, h]));
  for (const [lang, head] of rows) {
    for (const eol of EOLS) {
      for (const indent of INDENTS) {
        const g = declarationGhost(head, SENTENCE, lang, eol, indent, unitFor(indent));
        assert.strictEqual(g.caretOffset, g.text.length, tag(lang, head, eol, indent));
      }
    }
  }
});

test("rule 12 + 16: sweep every language, indent, eol and head shape for the no-empty-last-line invariants", () => {
  const rows = [];
  for (const [lang, head] of SHAPES) {
    const langs = lang === "typescript" ? TS_FAMILY : [lang];
    for (const l of langs) rows.push([l, head]);
  }
  for (const lang of LANGS) rows.push([lang, CAP_CUT[lang]], ...EMPTY_HEADS.map((h) => [lang, h]));
  let count = 0;
  for (const [lang, head] of rows) {
    for (const eol of EOLS) {
      for (const indent of INDENTS) {
        const g = declarationGhost(head, SENTENCE, lang, eol, indent, unitFor(indent));
        const label = tag(lang, head, eol, indent);
        count++;
        // Rule 16: python with no head at module level has no doc line and no head: empty text, caret 0.
        if (lang === "python" && EMPTY_HEADS.includes(head) && indent === "") {
          assert.strictEqual(g.text, "", label);
          assert.strictEqual(g.caretOffset, 0, label);
          continue;
        }
        checkInvariants(g, indent, label);
        checkIndentLayout(g, indent, label);
      }
    }
  }
  assert.ok(count >= 500, `swept ${count} combinations`);
});

test("rule 13: the v65 strings with a non-empty indent are byte-identical", () => {
  const rust = declarationGhost("pub fn add_column(&mut self, name: &str) {", "Add the threat level column.", "rust", "\n", "    ", "    ");
  assert.strictEqual(rust.text, "/// Add the threat level column.\n    pub fn add_column(&mut self, name: &str) {\n        \n    }");
  assert.strictEqual(rust.text.slice(rust.caretOffset - 8, rust.caretOffset), "        ");
  assert.strictEqual(rust.text[rust.caretOffset], "\n");
  const ts = declarationGhost("export function addColumn(name: string): void {", "Add it.", "typescript", "\r\n", "\t", "\t");
  assert.strictEqual(ts.text, "/**\r\n\t * Add it.\r\n\t */\r\n\texport function addColumn(name: string): void {\r\n\t\t\r\n\t}");
  assert.strictEqual(ts.text.slice(ts.caretOffset - 2, ts.caretOffset), "\t\t");
  const py = declarationGhost("def add_column(self, name: str) -> None:", "Add the threat level column.", "python", "\n", "    ", "    ");
  assert.strictEqual(py.text, 'def add_column(self, name: str) -> None:\n        """Add the threat level column."""\n        ');
  assert.strictEqual(py.caretOffset, py.text.length);
  const m = declarationGhost("public void Add(string name)", "Add it.", "csharp", "\n", "    ", "    ");
  assert.strictEqual(m.text, "/// Add it.\n    public void Add(string name)\n    {\n        \n    }");
  const done = declarationGhost("public int Count;", "The count.", "csharp", "\n", "    ", "    ");
  assert.strictEqual(done.text, "/// The count.\n    public int Count;\n    ");
});

test("rule 14: every table row at indent \"\" and \"    \", both eols, matches the rule-built text", () => {
  for (const [lang, head, rule] of SHAPES) {
    for (const eol of EOLS) {
      for (const indent of ["", "    "]) {
        const label = tag(lang, head, eol, indent);
        const got = declarationGhost(head, SENTENCE, lang, eol, indent, "    ");
        if (rule === 7) {
          const want = expectBody(head, SENTENCE, lang, eol, indent, "    ");
          assert.strictEqual(got.text, want.text, label);
          assert.strictEqual(got.caretOffset, want.caretOffset, label);
          assert.strictEqual(splitLines(got.text.slice(0, got.caretOffset)).pop(), indent + "    ", `${label}: caret line`);
        } else {
          assert.strictEqual(got.text, expectNoBody(head, SENTENCE, lang, eol, indent), label);
          assert.strictEqual(got.caretOffset, got.text.length, label);
        }
        checkInvariants(got, indent, label);
        checkIndentLayout(got, indent, label);
      }
    }
  }
});

test("rule 15: `;` and `}` never open a body; only `{`, python `:`, and the csharp own-line shapes do", () => {
  const closed = ["foo;", "public int Count { get; set; }", "public record P(int X);", "let x = { a: 1 };"];
  for (const lang of LANGS) {
    for (const head of closed) {
      for (const indent of ["", "    "]) {
        const g = declarationGhost(head, SENTENCE, lang, "\n", indent, "    ");
        assert.strictEqual(g.text, expectNoBody(head, SENTENCE, lang, "\n", indent), tag(lang, head, "\n", indent));
        assert.strictEqual(g.caretOffset, g.text.length, tag(lang, head, "\n", indent));
      }
    }
  }
  // A python-style `:` head opens nothing outside python; csharp is excluded because its
  // rule-7 shape names `class` and so opens a body under the contract.
  for (const lang of LANGS.filter((l) => l !== "python" && l !== "csharp")) {
    const g = declarationGhost("class Point:", SENTENCE, lang, "\n", "    ", "    ").text;
    assert.strictEqual(g, expectNoBody("class Point:", SENTENCE, lang, "\n", "    "), lang);
  }
  for (const lang of LANGS.filter((l) => l !== "csharp")) {
    for (const head of ["public class Point", "public double Area()"]) {
      const g = declarationGhost(head, SENTENCE, lang, "\n", "    ", "    ").text;
      assert.strictEqual(g, expectNoBody(head, SENTENCE, lang, "\n", "    "), `${lang} ${head}`);
    }
  }
  // A `{` head opens a body in every brace language.
  for (const lang of LANGS.filter((l) => l !== "python")) {
    const g = declarationGhost("fn f() {", SENTENCE, lang, "\n", "    ", "    ");
    assert.strictEqual(g.text, expectBody("fn f() {", SENTENCE, lang, "\n", "    ", "    ").text, lang);
    assert.ok(g.caretOffset < g.text.length, `${lang}: caret should sit before the closer`);
  }
});
