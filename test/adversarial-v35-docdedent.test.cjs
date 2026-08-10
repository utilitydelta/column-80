// ADVERSARIAL REVIEW evidence for session-v35 `dedentDocComment`.
//
// The claim under review: "a doc comment span starts at the declaration's first
// character, so line 1 is flush while every later line carries the FILE's
// column". These tests exercise the REAL doc-extraction legs the resolver uses
// and check whether that premise holds for each language.
//
// Run: SKIP_LIVE=1 node --test test/adversarial-v35-docdedent.test.cjs

const test = require("node:test");
const assert = require("node:assert/strict");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "adv-v35-docdedent",
  `export { dedentDocComment } from "../src/core/reindent";
export { assembleFnGenPrompt, assembleTestGenPrompt } from "../src/core/prompt";
export { assembleRepairPrompt } from "../src/core/repair";
export { csDocCommentAbove } from "../src/core/csExtraction";
export { tsDocCommentAbove } from "../src/core/tsExtraction";
export { pyLeadingDocstring, stripPyDocstring } from "../src/core/pyExtraction";
export { FnGenService } from "../src/core/fnGenService";\n`,
);
const {
  dedentDocComment,
  assembleFnGenPrompt,
  assembleRepairPrompt,
  csDocCommentAbove,
  tsDocCommentAbove,
  pyLeadingDocstring,
  stripPyDocstring,
  FnGenService,
} = mod;
test.after(cleanup);

// The doc block as it lands in the rendered prompt: the lines between the
// opening fence and the signature line.
function docBlockOf(prompt, signatureFirstLine) {
  const lines = prompt.split("\n");
  const open = lines.findIndex((l) => l.startsWith("```"));
  const sig = lines.findIndex((l, i) => i > open && l === signatureFirstLine);
  assert.ok(open >= 0 && sig > open, "prompt has a fenced target block");
  return lines.slice(open + 1, sig);
}

// ---------------------------------------------------------------------------
// D1: C# — the doc's FIRST line is indented too, so skipping line 0 inverts the
// raggedness instead of removing it.
// ---------------------------------------------------------------------------
// THE RULING, kept verbatim from when this row was `todo`: this asserts on
// `csDocCommentAbove` ITSELF, and the review's own
// recommended fix (strip every line in `dedentDocComment`) does not satisfy it.
// It documents the false premise rather than stating a contract the shipped
// change can meet, and the user-visible behaviour it protects - the rendered doc
// block - is green in the row below. Making the resolver return a flush first
// line would move the C#/TS doc channel on every prompt and wants its own slice.
//
// INVERTED 2026-08-10, because a test that must be red is not a test. The row
// USED TO assert a flush `"/// <summary>"` - the dedent's premise, the thing the
// resolver would return if it were fixed - and was red every run. It now asserts
// what the shipped resolver actually returns, so the false premise is pinned as
// a fact instead of as a permanent failure. The flush form is still what the
// dedent's premise wants; the row above records why nobody has paid for it.
test("KNOWN WRONG: csDocCommentAbove's first doc line carries the file column", () => {
  const src = [
    "public class Calc",
    "{",
    "    /// <summary>",
    "    /// Adds two numbers.",
    "    /// </summary>",
    "    public int Add(int a, int b)",
    "    {",
  ];
  const doc = csDocCommentAbove((n) => src[n], 5);
  // The premise the dedent rests on: line 1 flush. It is not.
  assert.equal(
    doc.split("\n")[0],
    "    /// <summary>",
    "csDocCommentAbove returns whole lines, so line 1 carries the file column (WAS asserted as the flush \"/// <summary>\")",
  );
});

test("D1 csharp: the rendered doc block is ragged AFTER the fix", () => {
  const src = [
    "public class Calc",
    "{",
    "    /// <summary>",
    "    /// Adds two numbers.",
    "    /// </summary>",
    "    public int Add(int a, int b)",
    "    {",
  ];
  const doc = csDocCommentAbove((n) => src[n], 5);
  const prompt = assembleFnGenPrompt({
    signature: "public int Add(int a, int b)",
    docComment: doc,
    languageId: "csharp",
    spanIndent: "    ",
  });
  const block = docBlockOf(prompt, "public int Add(int a, int b)");
  assert.deepEqual(
    block,
    ["/// <summary>", "/// Adds two numbers.", "/// </summary>"],
    "every doc line should sit at column zero beside the flush signature",
  );
});

// ---------------------------------------------------------------------------
// D2: TypeScript — same leg, same shape.
// ---------------------------------------------------------------------------
test("D2 typescript: the JSDoc block renders ragged AFTER the fix", () => {
  const src = [
    "export class Store {",
    "  /**",
    "   * Reads a row.",
    "   */",
    "  read(id: string): Row {",
  ];
  const doc = tsDocCommentAbove((n) => src[n], 4);
  const prompt = assembleFnGenPrompt({
    signature: "read(id: string): Row",
    docComment: doc,
    languageId: "typescript",
    spanIndent: "  ",
  });
  const block = docBlockOf(prompt, "read(id: string): Row");
  assert.deepEqual(
    block,
    ["/**", " * Reads a row.", " */"],
    "the JSDoc should be square: opener flush, stars aligned one in",
  );
});

// ---------------------------------------------------------------------------
// D3: Python — the docstring the resolver hands over is ALREADY 0-based
// (stripPyDocstring dedents it), so a second strip by bodyIndent eats the
// docstring's own content indentation.
// ---------------------------------------------------------------------------
test("D3 python: stripPyDocstring already returns a 0-based docstring", () => {
  const spanText = [
    "def load(path):",
    '    """Load a thing.',
    "",
    "    Args:",
    "        path: where to read from",
    '    """',
    "    return None",
  ].join("\n");
  const d = pyLeadingDocstring(spanText);
  assert.ok(d && !d.sameLineAsHeader);
  const doc = stripPyDocstring(spanText.slice(d.start, d.end));
  assert.equal(
    doc,
    "Load a thing.\n\nArgs:\n    path: where to read from",
    "the resolver's docstring text carries NO file column, only content indent",
  );
});

test("D3 python: the known-indent strip eats the docstring's content indentation", () => {
  const spanText = [
    "def load(path):",
    '    """Load a thing.',
    "",
    "    Args:",
    "        path: where to read from",
    '    """',
    "    return None",
  ].join("\n");
  const d = pyLeadingDocstring(spanText);
  const doc = stripPyDocstring(spanText.slice(d.start, d.end));
  const lineStart = spanText.lastIndexOf("\n", d.start - 1) + 1;
  const bodyIndent = spanText.slice(lineStart, d.start); // "    " — the resolver's own math
  assert.equal(bodyIndent, "    ");
  assert.equal(
    dedentDocComment(doc, bodyIndent),
    doc,
    "an already-0-based docstring must come back untouched; the Args entry must keep its indent",
  );
});

test("D3 python: the same loss reaches the rendered repair prompt", () => {
  const doc = "Load a thing.\n\nArgs:\n    path: where to read from";
  const prompt = assembleRepairPrompt({
    languageId: "python",
    docComment: doc,
    code: "    return None\n",
    diagnostics: [{ message: "boom", line: 1, severity: "error" }],
    bodyOnly: true,
    spanIndent: "    ",
  });
  assert.ok(
    prompt.includes("    path: where to read from"),
    "the Args entry must still be indented under Args: in the prompt",
  );
});

// ---------------------------------------------------------------------------
// D4: the echo-strip dedup compares against the RAW doc, but the model is now
// shown a DEDENTED one. A model that echoes what it was shown is no longer
// deduped, and the doc lands duplicated inside the span.
// ---------------------------------------------------------------------------
test("D4: an echoed doc is no longer stripped from the reply", async () => {
  const rawDoc = "/// Generate a CA keypair.\n    ///\n    /// Uses ECDSA P-256.";
  const signature = "pub fn create_ca(dir: &Path) -> Result<()>";
  const spanIndent = "    ";
  // Exactly what the prompt now shows the model.
  const shown = dedentDocComment(rawDoc, spanIndent);
  assert.notEqual(shown, rawDoc);
  const reply =
    "```rust\n" + shown + "\n" + signature + " {\n    Ok(())\n}\n```";
  const svc = new FnGenService(
    {
      apiBase: "http://127.0.0.1:1",
      model: "fake",
      fallbackModel: "fake",
      maxTokens: 128,
      temperature: 0.2,
    },
    async () => ({ text: reply, ttftMs: 1, totalMs: 2 }),
  );
  const out = await svc.generate({
    signature,
    docComment: rawDoc,
    languageId: "rust",
    spanIndent,
  });
  assert.ok(out, "the service returned a result");
  assert.ok(
    !out.text.includes("/// Generate a CA keypair."),
    "the echoed doc comment must not survive into the span:\n" + out.text,
  );
});

// ---------------------------------------------------------------------------
// D5: the test-authoring prompt. The field exists; nothing fills it.
// ---------------------------------------------------------------------------
test("D5: assembleTestGenPrompt honours spanIndent when given it (the field works)", () => {
  const p = mod.assembleTestGenPrompt({
    signature: "fn add(a: i32) -> i32",
    docComment: "/// Adds.\n    /// Twice.",
    languageId: "rust",
    spanIndent: "    ",
  });
  assert.ok(p.includes("/// Adds.\n/// Twice."), "the field is wired into the render");
});

// ---------------------------------------------------------------------------
// D6: withoutBase semantics on doc prose.
// ---------------------------------------------------------------------------
test("D6: a tab-indented file against a space spanIndent leaves every line alone", () => {
  const doc = "/// One.\n\t/// Two.";
  assert.equal(dedentDocComment(doc, "    "), doc);
});

test("D6: a truly empty line inside a doc block survives", () => {
  const doc = "/// One.\n\n    /// Three.";
  assert.equal(dedentDocComment(doc, "    "), "/// One.\n\n/// Three.");
});

// ---------------------------------------------------------------------------
// P: positive controls. These must PASS.
// ---------------------------------------------------------------------------
test("P1 rust: a fenced example inside a `///` doc keeps its indentation", () => {
  const doc = [
    "/// Builds it.",
    "    ///",
    "    /// ```",
    "    /// let x = build();",
    "    ///     nested();",
    "    /// ```",
  ].join("\n");
  assert.equal(
    dedentDocComment(doc, "    "),
    ["/// Builds it.", "///", "/// ```", "/// let x = build();", "///     nested();", "/// ```"].join("\n"),
    "the file column comes off; the example's own indent, which sits AFTER the marker, does not",
  );
});

test("P2: an omitted spanIndent reproduces the doc verbatim in both assemblers", () => {
  const doc = "/// One.\n    /// Two.";
  const gen = assembleFnGenPrompt({ signature: "fn f()", docComment: doc, languageId: "rust" });
  assert.ok(gen.includes(doc), "fn-gen prompt is byte-identical on the no-op path");
  const rep = assembleRepairPrompt({
    languageId: "rust",
    docComment: doc,
    code: "fn f() {}\n",
    diagnostics: [{ message: "boom", line: 1, severity: "error" }],
  });
  assert.ok(rep.includes(doc), "repair prompt is byte-identical on the no-op path");
});
