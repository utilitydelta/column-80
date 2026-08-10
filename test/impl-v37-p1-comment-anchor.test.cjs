// WHITE-BOX rows for session-v37 phase 1: a span occurrence inside a COMMENT is
// not an anchor.
//
// THE DEFECT. Before a type is injected the product finds a real position in the
// target file where the name is written and asks the language server to resolve
// the identifier there. The span leg of that search ran on raw text, comments
// included. The v36 backtick gesture writes the name in a body comment by
// construction, so the span leg won every time the developer used the gesture.
//
// Measured live on two servers, 12 rows in session-v37/spike-14-comment-anchor.txt:
// rust-analyzer and the TypeScript language service both return NOTHING at a
// comment position (no definition, no hover, no shape, no worked example), and
// the same name at a code position in the same file in the same run resolves
// completely. The pre-emption is the worst of it: in a file that both imports
// the type and names it in a gesture comment, the comment anchor injected
// nothing while the import line it skipped injected the whole enum. Writing the
// gesture was strictly worse than writing nothing.
//
// WHY THESE ROWS AND NOT A CHANNEL ASSERTION. The old failure was invisible on
// the diagnostic channel: `findTypeReference` DID return a cursor, so
// `no anchor found` never fired and the reader saw the pair an unrenderable
// resolved type produces. The line pointed at the renderer and the fault was the
// anchor. So the rows assert LINE NUMBERS, which is where the fault actually is.
//
// ANTI-VACUITY. Every fixture that expects no comment anchor carries a CONTROL
// name at a genuine code position in the same span, asserted to the line, so a
// row cannot go green because the leg died. Section A also asserts that
// `commentTypesIn` really does extract the comment name from the same span, so
// the refusal is proven to be about a name the gesture genuinely produces.
//
// Run: SKIP_LIVE=1 node --test test/impl-v37-p1-comment-anchor.test.cjs

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-v37-p1-comment-anchor",
  `export { commentTypesIn, firstCodeOccurrence } from "../src/core/commentTypes";\n`,
);
const { commentTypesIn, firstCodeOccurrence } = mod;
test.after(cleanup);

// fn-gen sits behind the vscode module, so it needs the stub-alias bundle.
// Mechanics copied from the bottom of test/impl-v36-p1-commenttypes.test.cjs.
const STUB = path.join(__dirname, ".impl-v37-p1-anchor-vscode-stub.cjs");
fs.writeFileSync(
  STUB,
  `class Position { constructor(line, character){ this.line=line; this.character=character; } }
class Range { constructor(a,b){ this.start=a; this.end=b; } }
const mkUri = (s) => ({ toString: () => String(s), fsPath: String(s), path: String(s) });
module.exports = {
  Position, Range, Selection: Range, WorkspaceEdit: class {},
  EventEmitter: class { constructor(){ this.event=()=>({dispose(){}}); } fire(){} dispose(){} },
  ThemeColor: class {}, MarkdownString: class {},
  Uri: { parse: mkUri, file: mkUri },
  SymbolKind: { File:0, Module:1, Namespace:2, Package:3, Class:4, Method:5, Property:6,
    Field:7, Constructor:8, Enum:9, Interface:10, Function:11, Variable:12, Constant:13,
    String:14, Number:15, Boolean:16, Array:17, Object:18, Key:19, Null:20, EnumMember:21,
    Struct:22, Event:23, Operator:24, TypeParameter:25 },
  ProgressLocation: {}, EndOfLine: { LF:1, CRLF:2 },
  languages: {}, window: {}, commands: {},
  workspace: { getConfiguration: () => ({ get: (k, f) => f, has: () => false, inspect: () => undefined, update: async () => {} }) },
};
`,
);
const ENTRY = path.join(__dirname, ".impl-v37-p1-anchor.entry.ts");
const OUTFILE = path.join(__dirname, ".impl-v37-p1-anchor.bundle.cjs");
fs.writeFileSync(ENTRY, `export { prefillLangFor } from "../src/vscode/fnGen";\n`);
esbuild.buildSync({
  entryPoints: [ENTRY],
  bundle: true,
  outfile: OUTFILE,
  format: "cjs",
  platform: "node",
  alias: { vscode: STUB },
});
const FNGEN = require(OUTFILE);
test.after(() => [STUB, ENTRY, OUTFILE].forEach((f) => fs.rmSync(f, { force: true })));

const show = (v) => JSON.stringify(v);
const URI = "file:///w/target.src";

// `document` needs only what the seam declares: a uri and positionAt.
const makeDoc = (text) => ({
  uri: { toString: () => URI },
  positionAt: (offset) => {
    const at = Math.max(0, Math.min(Number(offset) || 0, text.length));
    const before = text.slice(0, at);
    const nl = before.lastIndexOf("\n");
    return { line: before.split("\n").length - 1, character: before.length - (nl + 1) };
  },
});

// Every fixture puts the target function LAST, so the span runs from the head to
// the end of the file and no offset arithmetic is guessed.
const anchorCall = (languageId, fullText, head, name, localTypeDefs = new Map()) => {
  const lang = FNGEN.prefillLangFor(languageId);
  assert.ok(lang, `${languageId} must have a prefill entry`);
  const start = fullText.indexOf(head);
  assert.ok(start >= 0, `fixture precondition: ${show(head)} is in the fixture`);
  return lang.typeReference(name, makeDoc(fullText), { span: { start, end: fullText.length } }, fullText, localTypeDefs);
};

const lineOf = (fullText, needle) => {
  const at = fullText.indexOf(needle);
  assert.ok(at >= 0, `fixture precondition: ${show(needle)} is in the fixture`);
  return fullText.slice(0, at).split("\n").length - 1;
};

// ===========================================================================
// A. PER LANGUAGE. A name written ONLY in a body comment inside the span does
// not anchor at the comment. Each language in its own comment syntax, line and
// block, and Python's docstring, because the gesture is "backtick it in any
// comment" and the refusal has to cover the same ground the extraction does.
// ===========================================================================

// head/code/close are the language's spelling of the same three-line function.
// COMMENT_ONLY is named nowhere but the comment; CONTROL is named nowhere but
// the code line.
const SHAPES = {
  rust: { head: "fn build() {", code: "    let held: Control = load();", close: "}", indent: "    " },
  typescript: { head: "function build(): void {", code: "  const held: Control = load();", close: "}", indent: "  " },
  csharp: { head: "void Build() {", code: "    Control held = Load();", close: "}", indent: "    " },
  python: { head: "def build():", code: "    held: Control = load()", close: "", indent: "    " },
  go: { head: "func Build() {", code: "\tvar held Control", close: "}", indent: "\t" },
};

const COMMENTS = {
  rust: [["line", "// needs `CommentOnly`"], ["block", "/* needs `CommentOnly` */"]],
  typescript: [["line", "// needs `CommentOnly`"], ["block", "/* needs `CommentOnly` */"]],
  csharp: [["line", "// needs `CommentOnly`"], ["block", "/* needs `CommentOnly` */"]],
  python: [["line", "# needs `CommentOnly`"], ["docstring", '"""needs `CommentOnly`"""']],
  go: [["line", "// needs `CommentOnly`"], ["block", "/* needs `CommentOnly` */"]],
};

const LANGS = Object.keys(SHAPES);

const commentFixture = (languageId, comment) => {
  const s = SHAPES[languageId];
  const lines = [s.head, `${s.indent}${comment}`, s.code];
  if (s.close !== "") {
    lines.push(s.close);
  }
  return `${lines.join("\n")}\n`;
};

test("A: a name written only in a body comment does not anchor at the comment, in all five", () => {
  for (const languageId of LANGS) {
    for (const [kind, comment] of COMMENTS[languageId]) {
      const fullText = commentFixture(languageId, comment);
      const head = SHAPES[languageId].head;
      const label = `${languageId} ${kind}`;

      // The gesture really does produce this name from this span, so the row
      // below is about the ANCHOR and not about an extraction that never ran.
      assert.deepEqual(
        commentTypesIn(fullText.slice(fullText.indexOf(head)), languageId),
        ["CommentOnly"],
        `${label}: fixture precondition, the gesture extracts the name from this span`,
      );

      assert.equal(
        anchorCall(languageId, fullText, head, "CommentOnly"),
        undefined,
        `${label}: the only occurrence is a comment position, where the server resolves nothing. Fixture:\n${fullText}`,
      );

      // CONTROL: a genuine code position in the same span still anchors, at its
      // own line. Without this the row above passes for a dead leg.
      const ref = anchorCall(languageId, fullText, head, "Control");
      assert.ok(ref, `${label}: control, a code occurrence must still anchor. Fixture:\n${fullText}`);
      assert.equal(ref.line, lineOf(fullText, "Control"), `${label}: control anchors at its code line`);
      assert.equal(ref.uri.toString(), URI, `${label}: control anchors in the target document`);
    }
  }
});

test("A: a comment occurrence EARLIER in the span does not shadow a later code occurrence", () => {
  // The refusal has to keep looking inside the span, not stop at the first
  // rejected hit. Both spell the same name, and only the code line is an anchor.
  for (const languageId of LANGS) {
    const s = SHAPES[languageId];
    const comment = COMMENTS[languageId][0][1].replace("CommentOnly", "Control");
    const lines = [s.head, `${s.indent}${comment}`, s.code];
    if (s.close !== "") {
      lines.push(s.close);
    }
    const fullText = `${lines.join("\n")}\n`;
    const ref = anchorCall(languageId, fullText, s.head, "Control");
    assert.ok(ref, `${languageId}: the code line spells it. Fixture:\n${fullText}`);
    assert.equal(ref.line, 2, `${languageId}: the code line (2), not the comment line (1). Fixture:\n${fullText}`);
  }
});

// ===========================================================================
// B. THE PRE-EMPTION. The row that matters: the name is on an import line AND in
// a gesture comment inside the span. The comment anchor injected nothing and
// skipped the import line that injects the whole type, so the gesture made the
// outcome worse than silence. Only Rust and TypeScript have an import leg; a Go
// import carries a package path and a C# using carries a namespace, so neither
// line ever spells a type name.
// ===========================================================================

const PREEMPT = {
  rust: [
    "use crate::decode::DecodeError;",
    "",
    "fn build() {",
    "    // fails with `DecodeError` when the quad is short",
    "    let held: Control = load();",
    "}",
    "",
  ].join("\n"),
  typescript: [
    'import type { DecodeError } from "./decode";',
    "",
    "function build(): void {",
    "  // fails with `DecodeError` when the quad is short",
    "  const held: Control = load();",
    "}",
    "",
  ].join("\n"),
};

test("B: the import line wins over the gesture comment that used to pre-empt it", () => {
  for (const [languageId, fullText] of Object.entries(PREEMPT)) {
    const head = SHAPES[languageId].head;
    const ref = anchorCall(languageId, fullText, head, "DecodeError");
    assert.ok(ref, `${languageId}: two positions spell it, so something must anchor. Fixture:\n${fullText}`);
    // Line 0 is the import, line 3 is the comment. Before the fix this was 3,
    // which is the position both servers resolve to nothing at.
    assert.equal(
      ref.line,
      0,
      `${languageId}: the import line (0), not the gesture comment (3). Fixture:\n${fullText}`,
    );

    // CONTROL, same fixture: the span's code line still beats the import leg,
    // so the row above is a comment refusal and not the span leg going dark.
    const control = anchorCall(languageId, fullText, head, "Control");
    assert.ok(control, `${languageId}: control must anchor. Fixture:\n${fullText}`);
    assert.equal(control.line, 4, `${languageId}: control anchors at its code line in the span`);
  }
});

test("B: a wrapped import group is still reached once the comment is refused", () => {
  // The dominant shape in real Rust and in prettier-wrapped TypeScript. The
  // comment refusal has to fall through to the CONTINUATION line, not just to
  // the line that starts with `use`/`import`.
  const rust = [
    "use crate::decode::{",
    "    Alphabet,",
    "    DecodeError,",
    "};",
    "",
    "fn build() {",
    "    // fails with `DecodeError` when the quad is short",
    "    let held: Control = load();",
    "}",
    "",
  ].join("\n");
  const rustRef = anchorCall("rust", rust, "fn build() {", "DecodeError");
  assert.ok(rustRef, `rust: the wrapped group spells it. Fixture:\n${rust}`);
  assert.equal(rustRef.line, 2, `rust: the continuation line the name is written on. Fixture:\n${rust}`);

  const ts = [
    "import type {",
    "  Alphabet,",
    "  DecodeError,",
    '} from "./decode";',
    "",
    "function build(): void {",
    "  // fails with `DecodeError` when the quad is short",
    "  const held: Control = load();",
    "}",
    "",
  ].join("\n");
  const tsRef = anchorCall("typescript", ts, "function build(): void {", "DecodeError");
  assert.ok(tsRef, `typescript: the wrapped group spells it. Fixture:\n${ts}`);
  assert.equal(tsRef.line, 2, `typescript: the continuation line the name is written on. Fixture:\n${ts}`);
});

// ===========================================================================
// C. THE REST OF THE ORDER IS UNCHANGED. Span code beats import beats same-file
// declaration, and a name with none of the three still returns undefined so the
// caller logs `no anchor found` instead of spending a slot on a dead cursor.
// ===========================================================================

test("C: span code, then import, then same-file declaration, unchanged", () => {
  const defs = new Map([["DecodeError", { line: 40, character: 7 }]]);

  const all = [
    "use crate::decode::DecodeError;",
    "",
    "fn build() {",
    "    let held: DecodeError = load();",
    "}",
    "",
  ].join("\n");
  const first = anchorCall("rust", all, "fn build() {", "DecodeError", defs);
  assert.ok(first, "the name is written three times, so something must anchor");
  assert.equal(first.line, 3, `the span's own code line beats the use line (0) and the declaration (40). Fixture:\n${all}`);

  const noSpan = ["use crate::decode::DecodeError;", "", "fn build() {", "}", ""].join("\n");
  const second = anchorCall("rust", noSpan, "fn build() {", "DecodeError", defs);
  assert.ok(second, "with the span hit removed, something still anchors");
  assert.equal(second.line, 0, "the use line beats the declaration (40)");

  const neither = ["fn build() {", "}", ""].join("\n");
  const third = anchorCall("rust", neither, "fn build() {", "DecodeError", defs);
  assert.ok(third, "with the use line removed too, the declaration is the last leg");
  assert.equal(third.line, 40, "the declaration handed in by the caller");
  assert.equal(third.character, 7, "and its character");
});

test("C: a gesture name in no import and no declaration returns undefined, in all five", () => {
  // The honest ending. `no anchor found (no reference cursor)` is a true
  // sentence; the pair the old behaviour produced pointed the reader at the
  // renderer instead.
  for (const languageId of LANGS) {
    const fullText = commentFixture(languageId, COMMENTS[languageId][0][1]);
    const head = SHAPES[languageId].head;
    assert.equal(
      anchorCall(languageId, fullText, head, "CommentOnly", new Map([["Other", { line: 3, character: 0 }]])),
      undefined,
      `${languageId}: nothing but a comment spells it, so there is no position to resolve at`,
    );
    // CONTROL: the declaration leg is alive in the same call shape.
    const ref = anchorCall(languageId, fullText, head, "Declared", new Map([["Declared", { line: 9, character: 2 }]]));
    assert.ok(ref, `${languageId}: control, the declaration leg still answers`);
    assert.equal(ref.line, 9, `${languageId}: control anchors at the declaration`);
  }
});

// ===========================================================================
// D. THE HELPER ITSELF. `firstCodeOccurrence` is the one place the rule lives,
// and these rows pin the two traps that argue against the obvious alternative
// (`maskNonCode`) plus the two refusals it deliberately does NOT make.
// ===========================================================================

test("D: a Rust attribute is not a comment, so a name under one still anchors", () => {
  // `maskNonCode` treats `#` as a line-comment opener in every language and
  // would blank this whole line. That is why the helper uses `commentSyntaxFor`.
  const code = "#[derive(Debug)]\nstruct Holder { w: Widget }\n";
  assert.equal(firstCodeOccurrence(code, "rust", "Widget"), code.indexOf("Widget"), "the attribute is code");
  assert.equal(firstCodeOccurrence("#[derive(Widget)]\n", "rust", "Widget"), 9, "and so is the attribute's own body");
});

test("D: a Rust lifetime tick is not a quote, so a name after three of them still anchors", () => {
  // `maskNonCode` treats `'` as a literal delimiter. Trace this signature
  // through it and the third unpaired tick blanks `Widget`, which is the name
  // being anchored.
  const code = "fn get<'a>(&'a self) -> &'a Widget {\n    self.w\n}\n";
  assert.equal(firstCodeOccurrence(code, "rust", "Widget"), code.indexOf("Widget"), "lifetimes are not strings");
});

test("D: a name in a STRING literal is still accepted, on purpose", () => {
  // Also a dead anchor, also unmeasured. Widening the refusal on a guess would
  // drop anchors that work today, so the rule stays comments-only.
  const code = 'fn build() {\n    let s = "Widget";\n}\n';
  assert.equal(firstCodeOccurrence(code, "rust", "Widget"), code.indexOf("Widget"), "strings are out of scope");
});

test("D: S36-1 makes the refusal UNDER-reject in Rust, which is today's behaviour", () => {
  // session-v36/scraps.md S36-1: the Rust row in `commentSyntaxFor` leaves `'`
  // out of its quote set, so a `'"'` char literal opens a phantom string and the
  // scanner walks past every comment after it. The comment is then accepted as
  // an anchor. Known, not fixed here, and the safe direction: it falls back to
  // what shipped rather than refusing a real position.
  const code = "fn build() {\n    let q = '\"';\n    // needs `Sprocket`\n}\n";
  assert.equal(
    firstCodeOccurrence(code, "rust", "Sprocket"),
    code.indexOf("Sprocket"),
    "the phantom string hides the comment from the scanner, so the position is accepted",
  );
  // The same span, same scanner, same silence on the extraction side. One
  // defect, two symptoms.
  assert.deepEqual(commentTypesIn(code, "rust"), [], "and the gesture extracts nothing from it either");
});

test("D: an unmapped language has no comment syntax to judge with and refuses nothing", () => {
  const code = "-- needs Widget\nlet x: Widget = 1\n";
  assert.equal(firstCodeOccurrence(code, "no-such-language", "Widget"), code.indexOf("Widget"), "first occurrence, unchanged");
});

test("D: empty and missing inputs give undefined rather than throwing", () => {
  for (const [code, lang, name] of [["", "rust", "Widget"], ["let x: Widget;", "rust", ""], ["let x: Y;", "rust", "Widget"]]) {
    assert.equal(firstCodeOccurrence(code, lang, name), undefined, `${show([code, lang, name])}`);
  }
});
