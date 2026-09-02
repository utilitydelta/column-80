// session-v65, gesture 2 first half: dictate a declaration. The sentence is the doc comment and
// stays; the served head is dressed into one ghost with the body line and the caret target.
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");
const { mod, cleanup } = bundleCore("impl-v65-p9-declaration", 'export * from "../src/core/dictationDoc";\n');
const { docStyleFor, docCommentAbove, declarationGhost } = mod;
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

test("a head that opens nothing gets a fresh line at the site's indent", () => {
  const g = declarationGhost("pub struct Query;", "The query.", "rust", "\n", "", "    ");
  assert.strictEqual(g.text, "/// The query.\npub struct Query;\n");
  assert.strictEqual(g.caretOffset, g.text.length);
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

test("a served head with trailing whitespace or a non-string is tolerated", () => {
  assert.strictEqual(declarationGhost("fn f() {   ", "Say.", "rust", "\n", "", "  ").text, "/// Say.\nfn f() {\n  \n}");
  assert.strictEqual(declarationGhost(undefined, "Say.", "rust", "\n", "", "  ").text, "/// Say.\n\n");
});
