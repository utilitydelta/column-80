// IMPLEMENTER test - session-v55 phase 26 (Q14): the fence a prompt writes is
// adapted to the content it wraps.
//
// THE DEFECT. Every prompt assembler hard-coded `const FENCE = "```"`, so any
// content carrying its own fence line - a staged context block cut out of a
// markdown file, a Python docstring holding an example, a hover the extractor
// leaked a fence marker out of - closed the block early and the model read the
// rest of the section as prose.
//
// THE FALSIFICATION the queue entry names: "a block containing each fence
// length renders balanced". Balanced is asserted TWICE here, and the second
// half is what makes it real:
//
//   1. the emitted fence outruns every fence line in the content, and
//   2. feeding the emitted section back through the product's OWN reader
//      (`extractFirstCodeBlock`) returns the content byte for byte.
//
// A writer verified only against itself proves nothing. The reader is the one
// that decides what closes a block, and it deliberately deviates from
// CommonMark (it honours a BARE run of three as a closer for any opener, which
// is why `fenceFor` answers tildes for that one content shape).
//
// Run: SKIP_LIVE=1 node --test test/impl-v55-p26-adaptive-fence.test.cjs

const test = require("node:test");
const assert = require("node:assert/strict");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-v55-p26-adaptive-fence",
  `export { fenceFor, extractFirstCodeBlock } from "../src/core/instructPostprocess";
export { assembleFnGenPrompt, assembleTestGenPrompt, renderContextBlock } from "../src/core/prompt";
export { assembleRepairPrompt } from "../src/core/repair";
export { assembleRefinePrompt } from "../src/core/refine";
export { assembleAntiPuntReprompt } from "../src/core/punt";
export { assembleCsMemberPayload, assemblePyMemberPayload, assembleGoMemberPayload, assembleTsMemberPayload, assembleSurfacePayload } from "../src/core/compilerDirected";
export { csShapeGraphBlock } from "../src/core/csExtraction";
export { assembleProposerPrompt } from "../src/core/tightenProposer";
export { renderCatalog } from "../src/core/catalog";\n`,
);
const F = mod;
test.after(cleanup);

const back = (n) => "`".repeat(n);
const tilde = (n) => "~".repeat(n);

// ===========================================================================
// A. THE HELPER.
// ===========================================================================

test("no line-opening fence run means the plain three, byte for byte", () => {
  assert.equal(F.fenceFor(""), "```");
  assert.equal(F.fenceFor("fn add(a: i32) -> i32 { a }"), "```");
  assert.equal(F.fenceFor("/// Adds `a` to `b`.\nfn add() {}"), "```", "inline backticks are not a fence");
});

test("a fence run MID-LINE opens no block, so it must not inflate the fence", () => {
  assert.equal(F.fenceFor('let s = "```";'), "```");
  assert.equal(F.fenceFor("/// ```\n/// let x = 1;\n/// ```"), "```", "a `///`-prefixed run opens nothing");
  assert.equal(F.fenceFor("x = 1 ````` y"), "```");
});

test("a line-opening run is beaten by exactly one, for every length", () => {
  // Run 3 is the one length a longer BACKTICK fence cannot beat (the reader
  // honours a bare three against any opener), so it is covered in B below.
  assert.equal(F.fenceFor("```rust\nlet x = 1;\n``` trailing"), back(4), "info string and trailing prose: neither is a closer");
  assert.equal(F.fenceFor(`${back(4)}\nx\n${back(4)}`), back(5));
  assert.equal(F.fenceFor(`${back(5)}\nx\n${back(5)}`), back(6));
  assert.equal(F.fenceFor(`${back(6)}\nx\n${back(6)}`), back(7));
  assert.equal(F.fenceFor(`${back(7)}\nx\n${back(7)}`), back(8));
  assert.equal(F.fenceFor(back(20)), back(21), "a run longer than any sane content");
});

test("an indented run still opens a line: the reader trims before it looks", () => {
  assert.equal(F.fenceFor(`    ${back(4)}\n    x\n    ${back(4)}`), back(5));
});

test("a BARE run of three takes tildes, because no backtick fence can beat it", () => {
  assert.equal(F.fenceFor("```\nlet x = 1;\n```"), tilde(3));
  assert.equal(F.fenceFor("```"), tilde(3), "content that is only backticks");
  assert.equal(F.fenceFor("```\nx\n```\n~~~~\ny\n~~~~"), tilde(5), "the tilde run is beaten too");
});

test("bare threes of BOTH characters: no fence exists, and it says so by falling back", () => {
  const both = "```\nx\n```\n~~~\ny\n~~~";
  assert.equal(F.fenceFor(both), back(4), "the backtick answer, which is what the unadapted code already did");
});

// ===========================================================================
// B. THE FALSIFICATION: writer and reader agree, at every fence length.
// ===========================================================================

function roundTrip(content) {
  const fence = F.fenceFor(content);
  const section = `${fence}\n${content}\n${fence}`;
  return { fence, section, read: F.extractFirstCodeBlock(section) };
}

for (const len of [3, 4, 5, 6, 7]) {
  test(`a block whose content carries a bare run of ${len} renders balanced and round-trips`, () => {
    const content = `${back(len)}rust\nlet x = 1;\n${back(len)}`;
    const { fence, read } = roundTrip(content);
    assert.equal(read, content, "the product's own reader returns the content exactly");
    // Balanced: nothing inside the block can close it. Same test the reader
    // applies - a bare run of the SAME character, length 3 or the opener's.
    for (const line of content.split("\n")) {
      const t = line.trim();
      const isCloser =
        /^(`{3,}|~{3,})$/.test(t) && t[0] === fence[0] && (t.length === 3 || t.length === fence.length);
      assert.equal(isCloser, false, `content line ${JSON.stringify(line)} closes the ${fence.length}-fence`);
    }
  });

  test(`the same run of ${len} as an INFO-STRING opener only (no bare closer)`, () => {
    const content = `${back(len)}rust\nlet x = 1;\nfn tail() {}`;
    const { fence, read } = roundTrip(content);
    assert.equal(read, content);
    assert.equal(fence, back(len + 1), "one longer than the run it must beat");
  });
}

test("the shapes with no run at all round-trip on the plain three", () => {
  for (const content of ["", "fn add() {}", 'let s = "```";', "a\n\nb", "/// Adds `a`.\nfn add() {}"]) {
    const { fence, read } = roundTrip(content);
    assert.equal(fence, "```", `content ${JSON.stringify(content)} must not inflate`);
    assert.equal(read, content);
  }
});

test("only backticks, and a run of 20, round-trip", () => {
  assert.equal(roundTrip("```").read, "```");
  assert.equal(roundTrip(back(20)).read, back(20));
  assert.equal(roundTrip(`x\n${back(20)}\ny`).read, `x\n${back(20)}\ny`);
});

// ===========================================================================
// C. THE EMIT SITES. Content the product did NOT author, carrying a fence.
// ===========================================================================

// A markdown selection: the shape a human stages into a context block, and the
// shape a Rust doc comment or a Python docstring holds. TAIL is the last line,
// so an early close loses it and the row goes red.
const TAIL = "SENTINEL_TAIL_LINE";
const FENCED = ["Example:", "```rust", "let g = Grid::new(1);", "```", TAIL].join("\n");
// Bare-three content, the case that takes tildes.
const BARE = ["```", "let g = Grid::new(1);", "```", TAIL].join("\n");

/** The fenced body of a rendered section, read back with the product's own
 *  reader. undefined means the section never closed. */
function readBack(section) {
  return F.extractFirstCodeBlock(section);
}

function assertCarriesTail(section, what) {
  const read = readBack(section);
  assert.notEqual(read, undefined, `${what}: the section does not close at all`);
  assert.ok(read.includes(TAIL), `${what}: the block closed early and lost the last line\n${section}`);
}

test("renderContextBlock: a staged block carrying a fence renders balanced", () => {
  const block = { uri: "file:///w/notes.md", range: { startLine: 1, endLine: 5 }, text: FENCED };
  assertCarriesTail(F.renderContextBlock(block), "context block");
  assertCarriesTail(
    F.renderContextBlock({ ...block, text: BARE }),
    "context block, bare three",
  );
});

test("assembleFnGenPrompt: a fence in the doc comment does not close the target", () => {
  const prompt = F.assembleFnGenPrompt({
    signature: "def demo():",
    docComment: FENCED,
    languageId: "python",
  });
  const read = readBack(prompt);
  assert.notEqual(read, undefined, "the target block does not close");
  assert.ok(read.includes("def demo():"), "the signature is inside the block, after the fenced doc");
});

test("assembleFnGenPrompt: a fence in a staged context block does not close it", () => {
  const prompt = F.assembleFnGenPrompt({
    signature: "fn demo()",
    languageId: "rust",
    contextBlocks: [{ uri: "file:///w/notes.md", range: { startLine: 1, endLine: 5 }, text: FENCED }],
  });
  assertCarriesTail(prompt, "fn-gen context head");
});

test("assembleTestGenPrompt: the collaborator surface and the target both adapt", () => {
  const prompt = F.assembleTestGenPrompt({
    signature: "fn demo()",
    docComment: FENCED,
    languageId: "rust",
    calleeSurface: FENCED,
  });
  assertCarriesTail(prompt, "testgen callee surface");
});

test("assembleRepairPrompt: the code section and the diagnostics section adapt", () => {
  const withDoc = F.assembleRepairPrompt({
    code: "def demo():\n    return 1\n",
    docComment: FENCED,
    docIndent: "",
    spanIndent: "",
    languageId: "python",
    diagnostics: [{ message: "boom", rendered: "boom" }],
  });
  const read = readBack(withDoc);
  assert.notEqual(read, undefined);
  assert.ok(read.includes("return 1"), "the code survives below the fenced doc comment");

  const withDiag = F.assembleRepairPrompt({
    code: "fn demo() {}\n",
    languageId: "rust",
    diagnostics: [{ message: "x", rendered: `${FENCED}\n` }],
  });
  const diagSection = withDiag.slice(withDiag.indexOf("Compiler diagnostics:"));
  assertCarriesTail(diagSection, "repair diagnostics");
});

test("assembleRefinePrompt: the code section adapts", () => {
  const prompt = F.assembleRefinePrompt({
    code: "def demo():\n    return 1\n",
    docComment: FENCED,
    docIndent: "",
    spanIndent: "",
    languageId: "python",
    diagnostics: [],
  });
  const read = readBack(prompt);
  assert.notEqual(read, undefined);
  assert.ok(read.includes("return 1"));
});

test("assembleAntiPuntReprompt: the model's own stub can carry a fence", () => {
  const prompt = F.assembleAntiPuntReprompt({
    signature: "fn demo()",
    languageId: "rust",
    punted: `${FENCED}\ntodo!()`,
  });
  const stub = prompt.slice(prompt.indexOf("Your previous stub:"));
  assertCarriesTail(stub, "anti-punt stub");
});

test("the four member payloads adapt: a leaked hover fence must not close them", () => {
  for (const [name, fn] of [
    ["cs", F.assembleCsMemberPayload],
    ["python", F.assemblePyMemberPayload],
    ["go", F.assembleGoMemberPayload],
    ["ts", F.assembleTsMemberPayload],
  ]) {
    assertCarriesTail(fn({ type: "Widget", members: FENCED }), `${name} member payload`);
  }
});

test("assembleSurfacePayload: the worked EXAMPLE is doc text and adapts", () => {
  const example = `${FENCED}\nlet w = Widget::new();`;
  const payload = F.assembleSurfacePayload({ typeOrCrate: "Widget", example, omitInstruction: true });
  assert.ok(payload !== "", "the example names its type and is not refused");
  assertCarriesTail(payload, "surface example");
  assertCarriesTail(
    F.assembleSurfacePayload({ typeOrCrate: "Widget", signatures: `${FENCED}\nfn Widget::new()`, omitInstruction: true }),
    "surface signatures",
  );
});

test("csShapeGraphBlock: a member list carrying a fence renders balanced", () => {
  const out = F.csShapeGraphBlock(
    [{ name: "Widget", methods: FENCED.split("\n") }],
    { memberCap: 32, visited: new Set(), budget: { remaining: 100000 } },
  );
  assertCarriesTail(out, "cs shape graph block");
});

test("assembleProposerPrompt: the dictated prose is fenced adaptively", () => {
  const prompt = F.assembleProposerPrompt({ prose: FENCED, languageId: "rust" });
  assertCarriesTail(prompt, "proposer prose");
});

// ===========================================================================
// D. BYTE IDENTITY. Content with no fence run keeps the exact three.
// ===========================================================================

const PLAIN_DOC = "/// Adds `a` to `b`.";
const PLAIN_CODE = "fn add(a: i32, b: i32) -> i32 {\n    a + b\n}\n";

test("every adapted site emits the plain three when the content has no fence run", () => {
  const sections = {
    context: F.renderContextBlock({ uri: "file:///w/a.rs", range: { startLine: 1, endLine: 2 }, text: PLAIN_CODE }),
    fngen: F.assembleFnGenPrompt({ signature: "fn add()", docComment: PLAIN_DOC, languageId: "rust" }),
    testgen: F.assembleTestGenPrompt({ signature: "fn add()", docComment: PLAIN_DOC, languageId: "rust", calleeSurface: "fn other()" }),
    repair: F.assembleRepairPrompt({ code: PLAIN_CODE, docComment: PLAIN_DOC, languageId: "rust", diagnostics: [{ message: "x", rendered: "x" }] }),
    refine: F.assembleRefinePrompt({ code: PLAIN_CODE, docComment: PLAIN_DOC, languageId: "rust", diagnostics: [] }),
    punt: F.assembleAntiPuntReprompt({ signature: "fn add()", languageId: "rust", punted: "todo!()" }),
    cs: F.assembleCsMemberPayload({ type: "Widget", members: "void Go()" }),
    py: F.assemblePyMemberPayload({ type: "Widget", members: "def go(self)" }),
    go: F.assembleGoMemberPayload({ type: "Widget", members: "func (w Widget) Go()" }),
    ts: F.assembleTsMemberPayload({ type: "Widget", members: "go(): void" }),
    surface: F.assembleSurfacePayload({ typeOrCrate: "Widget", example: "let w = Widget::new();", omitInstruction: true }),
    csgraph: F.csShapeGraphBlock([{ name: "Widget", methods: ["void Go()"] }], {
      memberCap: 32,
      visited: new Set(),
      budget: { remaining: 100000 },
    }),
    proposer: F.assembleProposerPrompt({ prose: "adds a to b", languageId: "rust" }),
  };
  for (const [name, section] of Object.entries(sections)) {
    const fences = section.split("\n").filter((l) => /^\s*(`{3,}|~{3,})/.test(l));
    assert.ok(fences.length > 0, `${name}: no fence line rendered`);
    for (const line of fences) {
      assert.match(line.trim(), /^```[a-z]*$/, `${name}: fence widened on content with no run: ${JSON.stringify(line)}`);
    }
  }
});

test("renderCatalog is deliberately NOT adapted, and here is why that is safe", () => {
  // Every rendered line starts with a crate NAME (`name` or `name: description`),
  // so no line of this block can ever open a fence run. Product-composed content
  // from a fixed vocabulary: adapting it would be churn.
  const rendered = F.renderCatalog([
    { name: "serde", description: "A ``` in a description cannot start a line" },
    { name: "tokio" },
  ]);
  const fences = rendered.split("\n").filter((l) => /^\s*`{3,}/.test(l));
  assert.equal(fences.length, 2);
  for (const line of fences) {
    assert.equal(line.trim(), "```");
  }
  assert.notEqual(F.extractFirstCodeBlock(rendered), undefined, "the block still closes");
});
