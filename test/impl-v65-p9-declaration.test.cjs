// session-v65, gesture 2 first half: dictate a declaration. The sentence is the doc comment and
// stays; the served head is dressed into one ghost with the body line and the caret target.
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");
const { mod, cleanup } = bundleCore("impl-v65-p9-declaration", 'export * from "../src/core/dictationDoc";\n');
const { docStyleFor, docCommentAbove, declarationGhost, freshLineAfter } = mod;
test.after(cleanup);

test("doc style per language", () => {
  assert.strictEqual(docStyleFor("rust"), "triple-slash");
  assert.strictEqual(docStyleFor("csharp"), "triple-slash");
  assert.strictEqual(docStyleFor("go"), "double-slash");
  assert.strictEqual(docStyleFor("typescript"), "block");
  assert.strictEqual(docStyleFor("typescriptreact"), "block");
  assert.strictEqual(docStyleFor("python"), "docstring");
  assert.strictEqual(docStyleFor("zig"), undefined);
});

test("the doc comment above the head, per language, wrapped at 80 minus the indent", () => {
  assert.strictEqual(docCommentAbove("Add the threat level column.", "rust"), "/// Add the threat level column.");
  assert.strictEqual(docCommentAbove("Add the threat level column.", "go"), "// Add the threat level column.");
  assert.strictEqual(docCommentAbove("Add the threat level column.", "typescript"), "/**\n * Add the threat level column.\n */");
  assert.strictEqual(docCommentAbove("Add the threat level column.", "python"), undefined, "python's doc goes inside");
  assert.strictEqual(docCommentAbove("", "rust"), undefined);
  assert.strictEqual(docCommentAbove(undefined, "rust"), undefined);
  const long = docCommentAbove("word ".repeat(30).trim() + ".", "rust", 8);
  for (const line of long.split("\n")) assert.ok(line.length <= 72, line);
});

test("a brace head that opens a body: doc, head, empty body line, closer; caret on the body line", () => {
  const g = declarationGhost("pub fn add_column(&mut self, name: &str) {", "Add the threat level column.", "rust", "\n", "    ", "    ");
  assert.strictEqual(g.text, "/// Add the threat level column.\n    pub fn add_column(&mut self, name: &str) {\n        \n    }");
  assert.strictEqual(g.text.slice(g.caretOffset - 8, g.caretOffset), "        ");
  assert.strictEqual(g.text[g.caretOffset], "\n", "the caret sits at the end of the body line");
});

test("a head that opens nothing gets a fresh line at the site's indent, inside a block", () => {
  const g = declarationGhost("pub struct Query;", "The query.", "rust", "\n", "    ", "    ");
  assert.strictEqual(g.text, "/// The query.\n    pub struct Query;\n    ");
  assert.strictEqual(g.caretOffset, g.text.length);
});

test("session-v66: at module level the fresh line is withheld, because the editor drops an item that ends on an empty line", () => {
  const g = declarationGhost("pub struct Query;", "The query.", "rust", "\n", "", "    ");
  assert.strictEqual(g.text, "/// The query.\npub struct Query;");
  assert.strictEqual(g.caretOffset, g.text.length);
  const alias = declarationGhost("export type Point = { x: number; y: number; z: number };", "A point.", "typescript", "\n", "", "  ");
  assert.strictEqual(alias.text, "/**\n * A point.\n */\nexport type Point = { x: number; y: number; z: number };");
  assert.strictEqual(freshLineAfter("\n", ""), "");
  assert.strictEqual(freshLineAfter("\n", "  "), "\n  ");
});

test("session-v66: a head that spans lines (an attribute the bound read through) carries the indent on every line", () => {
  const g = declarationGhost("#[derive(Debug)]\npub enum Kind {", "The kind.", "rust", "\n", "    ", "    ");
  assert.strictEqual(g.text, "/// The kind.\n    #[derive(Debug)]\n    pub enum Kind {\n        \n    }");
  const top = declarationGhost("#[derive(Debug)]\npub struct Unit;", "A unit.", "rust", "\n", "", "    ");
  assert.strictEqual(top.text, "/// A unit.\n#[derive(Debug)]\npub struct Unit;");
  const py = declarationGhost("@dataclass\nclass P:", "A point.", "python", "\n", "    ", "    ");
  assert.strictEqual(py.text, '@dataclass\n    class P:\n        """A point."""\n        ');
});

test("session-v66: a C# positional record that ends with `;` opens nothing, whatever words it carries", () => {
  const rec = declarationGhost("public record Point(int X, int Y, int Z);", "A point.", "csharp", "\n", "    ", "    ");
  assert.strictEqual(rec.text, "/// A point.\n    public record Point(int X, int Y, int Z);\n    ");
  const prop = declarationGhost("public int Count { get; set; }", "The count.", "csharp", "\n", "", "    ");
  assert.strictEqual(prop.text, "/// The count.\npublic int Count { get; set; }");
  // A trailing line comment does not hide the terminator (review finding 5).
  const commented = declarationGhost("public record Point(int X, int Y); // a point", "A point.", "csharp", "\n", "", "    ");
  assert.strictEqual(commented.text, "/// A point.\npublic record Point(int X, int Y); // a point");
  const opened = declarationGhost("pub fn area(&self) -> f64 { // the area", "The area.", "rust", "\n", "", "    ");
  assert.strictEqual(opened.text, "/// The area.\npub fn area(&self) -> f64 { // the area\n    \n}");
  // The opener inside a string literal is not a comment (review round 2, finding 1).
  const url = declarationGhost('export function fetchIt(base = "https://x.y"): void {', "Fetch it.", "typescript", "\n", "", "  ");
  assert.strictEqual(url.text, '/**\n * Fetch it.\n */\nexport function fetchIt(base = "https://x.y"): void {\n  \n}');
  const hash = declarationGhost('def split(s: str, sep: str = "#") -> list[str]:', "Split it.", "python", "\n", "", "    ");
  assert.strictEqual(hash.text, 'def split(s: str, sep: str = "#") -> list[str]:\n    """Split it."""\n    ');
  const tag = declarationGhost('public static string Tag(string channel = "#general")', "Tag it.", "csharp", "\n", "", "    ");
  assert.strictEqual(tag.text, '/// Tag it.\npublic static string Tag(string channel = "#general")\n{\n    \n}');
});

test("typescript: block doc comment, tabs kept, CRLF kept", () => {
  const g = declarationGhost("export function addColumn(name: string): void {", "Add it.", "typescript", "\r\n", "\t", "\t");
  assert.strictEqual(g.text, "/**\r\n\t * Add it.\r\n\t */\r\n\texport function addColumn(name: string): void {\r\n\t\t\r\n\t}");
  assert.strictEqual(g.text.slice(g.caretOffset - 2, g.caretOffset), "\t\t");
});

test("python: the head, then the docstring inside the body, then the caret on the next body line", () => {
  const g = declarationGhost("def add_column(self, name: str) -> None:", "Add the threat level column.", "python", "\n", "    ", "    ");
  assert.strictEqual(g.text, 'def add_column(self, name: str) -> None:\n        """Add the threat level column."""\n        ');
  assert.strictEqual(g.caretOffset, g.text.length);
});

test("csharp: the brace goes on its own line under a head the bound cut it from", () => {
  const g = declarationGhost("public class ThreatLevel", "The threat level.", "csharp", "\n", "", "    ");
  assert.strictEqual(g.text, "/// The threat level.\npublic class ThreatLevel\n{\n    \n}");
  assert.strictEqual(g.text[g.caretOffset], "\n");
  const m = declarationGhost("public void Add(string name)", "Add it.", "csharp", "\n", "    ", "    ");
  assert.strictEqual(m.text, "/// Add it.\n    public void Add(string name)\n    {\n        \n    }");
  const done = declarationGhost("public int Count;", "The count.", "csharp", "\n", "    ", "    ");
  assert.strictEqual(done.text, "/// The count.\n    public int Count;\n    ");
});

test("a served head with trailing whitespace or a non-string is tolerated", () => {
  assert.strictEqual(declarationGhost("fn f() {   ", "Say.", "rust", "\n", "", "  ").text, "/// Say.\nfn f() {\n  \n}");
  assert.strictEqual(declarationGhost(undefined, "Say.", "rust", "\n", "", "  ").text, "/// Say.");
  assert.strictEqual(declarationGhost(undefined, "Say.", "rust", "\n", "  ", "  ").text, "/// Say.\n  \n  ");
});
