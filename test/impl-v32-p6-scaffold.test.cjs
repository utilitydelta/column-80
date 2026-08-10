// The scaffold harvest: comments the developer left at the function body's own
// depth become a visible prompt channel for fn-gen, and only for fn-gen.
//
// White-box over the three pure pieces, one row per case the contract's table
// names, in every language whose syntax differs:
//   - scanBrackets' block-comment state, including the byte-identity of the
//     absent-option path that postprocess, fimBound and fimComment all ride on;
//   - harvestBodyComments' depth predicate, which is the whole rule;
//   - the fn-gen prompt channel, and assembleTestGenPrompt staying inputs-frozen
//     because a body-scoped comment is an algorithm note and a test authored
//     from one couples to the algorithm.
//
// Run: SKIP_LIVE=1 node --test test/impl-v32-p6-scaffold.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-v32-p6-scaffold",
  [
    `export { harvestBodyComments, bodyTextOfSpan } from "../src/core/scaffold";`,
    `export { scanBrackets, openStack } from "../src/core/brackets";`,
    `export { assembleFnGenPrompt, assembleTestGenPrompt } from "../src/core/prompt";`,
    "",
  ].join("\n"),
);
test.after(cleanup);

const { harvestBodyComments, bodyTextOfSpan, scanBrackets, assembleFnGenPrompt, assembleTestGenPrompt } = mod;

// The product's own call shape: slice the body off the span text, then harvest.
// Going through bodyTextOfSpan is deliberate - a fixture that hands the harvest a
// pre-cut body would not prove the doc comment above the header stays out.
function harvest(spanText, languageId, opts = {}) {
  const body = bodyTextOfSpan(spanText, languageId, opts.spanStartsInBody ?? false);
  return harvestBodyComments(body, languageId, opts.bodyIndent ?? "");
}

// ---------------------------------------------------------------------------
// The flagship case: a body sketched as `// step N`, in all five languages.
// ---------------------------------------------------------------------------

const SCAFFOLD_BODIES = {
  rust: "fn build(items: &[u8]) -> Vec<u8> {\n    // step 1: validate\n    // step 2: sort\n    // step 3: emit\n}",
  typescript: "function build(items: number[]): number[] {\n  // step 1: validate\n  // step 2: sort\n  // step 3: emit\n}",
  csharp:
    "public byte[] Build(byte[] items)\n{\n    // step 1: validate\n    // step 2: sort\n    // step 3: emit\n}",
  go: "func Build(items []byte) []byte {\n\t// step 1: validate\n\t// step 2: sort\n\t// step 3: emit\n}",
  python: "def build(items):\n    # step 1: validate\n    # step 2: sort\n    # step 3: emit\n",
};

for (const [languageId, spanText] of Object.entries(SCAFFOLD_BODIES)) {
  test(`${languageId}: three step comments in an empty body harvest all three, in document order`, () => {
    assert.deepStrictEqual(harvest(spanText, languageId), {
      comments: ["step 1: validate", "step 2: sort", "step 3: emit"],
      considered: 3,
    });
  });
}

// ---------------------------------------------------------------------------
// Depth is the whole predicate: nested blocks and closures are excluded.
// ---------------------------------------------------------------------------

const NESTED_IF = {
  rust: "fn f(x: bool) {\n    // body note\n    if x {\n        // nested note\n    }\n}",
  typescript: "function f(x: boolean) {\n  // body note\n  if (x) {\n    // nested note\n  }\n}",
  csharp: "void F(bool x)\n{\n    // body note\n    if (x)\n    {\n        // nested note\n    }\n}",
  go: "func F(x bool) {\n\t// body note\n\tif x {\n\t\t// nested note\n\t}\n}",
  python: "def f(x):\n    # body note\n    if x:\n        # nested note\n        pass\n",
};

for (const [languageId, spanText] of Object.entries(NESTED_IF)) {
  test(`${languageId}: a comment inside an if inside the body is EXCLUDED`, () => {
    assert.deepStrictEqual(harvest(spanText, languageId), {
      comments: ["body note"],
      considered: 2,
    });
  });
}

const NESTED_CLOSURE = {
  rust: "fn f(items: &[u8]) {\n    // body note\n    items.iter().for_each(|i| {\n        // closure note\n    });\n}",
  typescript: "function f(items: number[]) {\n  // body note\n  items.map((i) => {\n    // closure note\n  });\n}",
  csharp: "void F(int[] items)\n{\n    // body note\n    items.Select(i =>\n    {\n        // closure note\n        return i;\n    });\n}",
  go: "func F(items []byte) {\n\t// body note\n\tfn := func(i byte) {\n\t\t// closure note\n\t}\n}",
  python: "def f(items):\n    # body note\n    def inner(i):\n        # closure note\n        return i\n",
};

for (const [languageId, spanText] of Object.entries(NESTED_CLOSURE)) {
  test(`${languageId}: a comment inside a closure in the body is EXCLUDED`, () => {
    assert.deepStrictEqual(harvest(spanText, languageId), {
      comments: ["body note"],
      considered: 2,
    });
  });
}

// A `match`/`switch` arm is the same shape as an `if`, and Rust is the language
// whose match arms carry most of the commentary.
test("rust: a comment inside a match arm is EXCLUDED, the one above the match is not", () => {
  const spanText = [
    "fn f(x: Option<u8>) {",
    "    // body note",
    "    match x {",
    "        Some(v) => {",
    "            // arm note",
    "        }",
    "        None => {}",
    "    }",
    "}",
  ].join("\n");
  assert.deepStrictEqual(harvest(spanText, "rust"), { comments: ["body note"], considered: 2 });
});

// ---------------------------------------------------------------------------
// Body depth after code, and trailing comments on a body-depth line.
// ---------------------------------------------------------------------------

const AFTER_CODE = {
  rust: "fn f() {\n    let a = 1;\n    // after code\n}",
  typescript: "function f() {\n  const a = 1;\n  // after code\n}",
  csharp: "void F()\n{\n    var a = 1;\n    // after code\n}",
  go: "func F() {\n\ta := 1\n\t// after code\n}",
  python: "def f():\n    a = 1\n    # after code\n",
};

for (const [languageId, spanText] of Object.entries(AFTER_CODE)) {
  test(`${languageId}: a comment at body depth AFTER code is harvested`, () => {
    assert.deepStrictEqual(harvest(spanText, languageId), { comments: ["after code"], considered: 1 });
  });
}

const TRAILING = {
  rust: "fn f() {\n    let a = compute(); // trailing note\n}",
  typescript: "function f() {\n  const a = compute(); // trailing note\n}",
  csharp: "void F()\n{\n    var a = Compute(); // trailing note\n}",
  go: "func F() {\n\ta := compute() // trailing note\n}",
  python: "def f():\n    a = compute() # trailing note\n",
};

for (const [languageId, spanText] of Object.entries(TRAILING)) {
  test(`${languageId}: a trailing comment on a code line at body depth is harvested`, () => {
    assert.deepStrictEqual(harvest(spanText, languageId), { comments: ["trailing note"], considered: 1 });
  });
}

test("typescript: a trailing comment on a NESTED code line is excluded, the body-depth one is not", () => {
  const spanText = [
    "function f(x: boolean) {",
    "  const a = 1; // body trailing",
    "  if (x) {",
    "    const b = 2; // nested trailing",
    "  }",
    "}",
  ].join("\n");
  assert.deepStrictEqual(harvest(spanText, "typescript"), {
    comments: ["body trailing"],
    considered: 2,
  });
});

// ---------------------------------------------------------------------------
// A comment inside a string literal is not a comment.
// ---------------------------------------------------------------------------

const IN_LITERAL = {
  rust: 'fn f() {\n    let s = "// not a comment";\n    // real note\n}',
  typescript: 'function f() {\n  const s = "// not a comment";\n  const t = `// nor this`;\n  // real note\n}',
  csharp: 'void F()\n{\n    var s = "// not a comment";\n    // real note\n}',
  go: 'func F() {\n\ts := "// not a comment"\n\t// real note\n}',
  python: 'def f():\n    s = "# not a comment"\n    # real note\n',
};

for (const [languageId, spanText] of Object.entries(IN_LITERAL)) {
  test(`${languageId}: a comment marker inside a string literal is not a comment`, () => {
    assert.deepStrictEqual(harvest(spanText, languageId), { comments: ["real note"], considered: 1 });
  });
}

// ---------------------------------------------------------------------------
// Block comments: the unbalanced brace inside one, and the multi-line form.
// ---------------------------------------------------------------------------

// The row that needs scanBrackets' new state. Without it the `{` inside the
// first comment pushes an opener that never closes, every later comment reads as
// nested, and the harvest silently keeps only the first one.
const UNBALANCED_BLOCK = {
  rust: "fn f() {\n    /* step 1 { */\n    // step 2\n}",
  typescript: "function f() {\n  /* step 1 { */\n  // step 2\n}",
  csharp: "void F()\n{\n    /* step 1 { */\n    // step 2\n}",
  go: "func F() {\n\t/* step 1 { */\n\t// step 2\n}",
};

for (const [languageId, spanText] of Object.entries(UNBALANCED_BLOCK)) {
  test(`${languageId}: an unbalanced brace inside a block comment leaves the depth count uncorrupted`, () => {
    assert.deepStrictEqual(harvest(spanText, languageId), {
      comments: ["step 1 {", "step 2"],
      considered: 2,
    });
  });
}

// The same brace, but with a real nested block after it. If the comment's `{`
// counted, `step 2` would read as body depth from INSIDE the if and be harvested
// while the real body-depth comment after the if would not.
test("rust: a comment brace does not shift a later real block's depth", () => {
  const spanText = [
    "fn f(x: bool) {",
    "    /* step 1 { */",
    "    if x {",
    "        // nested note",
    "    }",
    "    // step 2",
    "}",
  ].join("\n");
  assert.deepStrictEqual(harvest(spanText, "rust"), {
    comments: ["step 1 {", "step 2"],
    considered: 3,
  });
});

const MULTILINE_BLOCK = {
  rust: "fn f() {\n    /*\n     * step 1\n     * step 2\n     */\n}",
  typescript: "function f() {\n  /**\n   * step 1\n   * step 2\n   */\n}",
  csharp: "void F()\n{\n    /*\n     * step 1\n     * step 2\n     */\n}",
  go: "func F() {\n\t/*\n\t * step 1\n\t * step 2\n\t */\n}",
};

for (const [languageId, spanText] of Object.entries(MULTILINE_BLOCK)) {
  test(`${languageId}: a multi-line block comment becomes one entry per line, markers stripped`, () => {
    assert.deepStrictEqual(harvest(spanText, languageId), {
      comments: ["step 1", "step 2"],
      considered: 2,
    });
  });
}

test("rust: a multi-line block comment inside an if is EXCLUDED, every line of it", () => {
  const spanText = [
    "fn f(x: bool) {",
    "    if x {",
    "        /*",
    "         * nested 1",
    "         * nested 2",
    "         */",
    "    }",
    "}",
  ].join("\n");
  assert.deepStrictEqual(harvest(spanText, "rust"), { comments: [], considered: 2 });
});

test("rust: marker variants (///, //!, /*! */) reach the prompt as words, not syntax", () => {
  const spanText = "fn f() {\n    /// step 1\n    //! step 2\n    /*! step 3 */\n}";
  assert.deepStrictEqual(harvest(spanText, "rust"), {
    comments: ["step 1", "step 2", "step 3"],
    considered: 3,
  });
});

// ---------------------------------------------------------------------------
// Python: indentation is the depth, and where bodyIndent comes from.
// ---------------------------------------------------------------------------

test("python: a # at bodyIndent is harvested, one indented deeper is excluded", () => {
  const spanText = "def f(x):\n    # at body indent\n    if x:\n            # deeper\n        pass\n";
  assert.deepStrictEqual(harvest(spanText, "python"), {
    comments: ["at body indent"],
    considered: 2,
  });
});

test("python: a resolver-supplied bodyIndent decides, so a Fork A span needs no header", () => {
  // Fork A: span.start already sits past the preserved docstring, and bodyIndent
  // is the docstring's own column.
  const body = '\n    # step 1\n    if True:\n        # nested\n        pass\n';
  assert.deepStrictEqual(harvest(body, "python", { spanStartsInBody: true, bodyIndent: "    " }), {
    comments: ["step 1"],
    considered: 2,
  });
});

test("python: a docstring in the body is NOT harvested - it is the doc channel already", () => {
  const spanText = 'def f():\n    """The spec, written for the caller."""\n    # step 1\n';
  assert.deepStrictEqual(harvest(spanText, "python"), { comments: ["step 1"], considered: 1 });
});

test("python: a two-space body indents the comments at two spaces, not a guessed four", () => {
  const spanText = "def f(x):\n  # step 1\n  if x:\n    # nested\n    pass\n";
  assert.deepStrictEqual(harvest(spanText, "python"), { comments: ["step 1"], considered: 2 });
});

test("python: a multi-line header does not become the body", () => {
  const spanText = "def f(\n    a: int,\n    b: int,\n) -> int:\n    # step 1\n    return a\n";
  assert.deepStrictEqual(harvest(spanText, "python"), { comments: ["step 1"], considered: 1 });
});

test("python: a tab-indented body and a space-indented comment are not the same level", () => {
  const spanText = "def f():\n\ta = 1\n        # spaces, not the body's tab\n";
  assert.deepStrictEqual(harvest(spanText, "python"), { comments: [], considered: 1 });
});

test("python: a comment-only body derives its indent from the shallowest comment", () => {
  const spanText = "def f():\n    # step 1\n        # a continuation the human indented\n";
  assert.deepStrictEqual(harvest(spanText, "python"), { comments: ["step 1"], considered: 2 });
});

// ---------------------------------------------------------------------------
// The empty cases, and the doc comment that must never be in the harvest.
// ---------------------------------------------------------------------------

const EMPTY_BODIES = {
  rust: "fn f() {\n}",
  typescript: "function f() {\n}",
  csharp: "void F()\n{\n}",
  go: "func F() {\n}",
  python: "def f():\n    pass\n",
};

for (const [languageId, spanText] of Object.entries(EMPTY_BODIES)) {
  test(`${languageId}: an empty body harvests nothing, and puts no channel in the prompt`, () => {
    const result = harvest(spanText, languageId);
    assert.deepStrictEqual(result, { comments: [], considered: 0 });
    const withHarvest = assembleFnGenPrompt({
      signature: "sig",
      languageId,
      scaffoldComments: result.comments,
    });
    assert.strictEqual(withHarvest, assembleFnGenPrompt({ signature: "sig", languageId }));
  });
}

const CODE_ONLY = {
  rust: "fn f() {\n    let a = 1;\n    a + 1\n}",
  typescript: "function f() {\n  const a = 1;\n  return a + 1;\n}",
  csharp: "int F()\n{\n    var a = 1;\n    return a + 1;\n}",
  go: "func F() int {\n\ta := 1\n\treturn a + 1\n}",
  python: "def f():\n    a = 1\n    return a + 1\n",
};

for (const [languageId, spanText] of Object.entries(CODE_ONLY)) {
  test(`${languageId}: a body of only code harvests nothing`, () => {
    assert.deepStrictEqual(harvest(spanText, languageId), { comments: [], considered: 0 });
  });
}

// The doc comment above the declaration is the caller's spec and keeps its own
// channel. The fixtures deliberately hand the WHOLE text, doc lines included, so
// the exclusion is proven by the body slice rather than by the caller's manners.
const DOC_ABOVE = {
  rust: "/// Doc line one.\n/// Doc line two.\nfn f() {\n    // step 1\n}",
  typescript: "/**\n * Doc line one.\n * Doc line two.\n */\nfunction f() {\n  // step 1\n}",
  csharp: "/// <summary>Doc line one.</summary>\npublic void F()\n{\n    // step 1\n}",
  go: "// Doc line one.\n// Doc line two.\nfunc F() {\n\t// step 1\n}",
  python: "# Doc line one.\ndef f():\n    # step 1\n",
};

for (const [languageId, spanText] of Object.entries(DOC_ABOVE)) {
  test(`${languageId}: the doc comment above the function is never in the harvest`, () => {
    const result = harvest(spanText, languageId);
    assert.deepStrictEqual(result.comments, ["step 1"]);
    for (const line of result.comments) {
      assert.ok(!line.includes("Doc line"), `doc comment leaked into the harvest: ${line}`);
    }
  });
}

// ---------------------------------------------------------------------------
// A body with BOTH code and comments harvests, and says how much of it it took.
// ---------------------------------------------------------------------------

test("typescript: a mixed body harvests, and `considered` carries the harvested-N-of-M number", () => {
  const spanText = [
    "function build(items: number[]): number[] {",
    "  // step 1: validate",
    "  if (items.length === 0) {",
    "    // nothing to do",
    "    return [];",
    "  }",
    "  // step 2: sort",
    "  const sorted = items.slice().sort(); // stable enough",
    "  return sorted.map((i) => {",
    "    // scale each",
    "    return i * 2;",
    "  });",
    "}",
  ].join("\n");
  assert.deepStrictEqual(harvest(spanText, "typescript"), {
    comments: ["step 1: validate", "step 2: sort", "stable enough"],
    considered: 5,
  });
});

// ---------------------------------------------------------------------------
// scanBrackets: the absent-option path is byte-identical, the new option works.
// ---------------------------------------------------------------------------

// Real inputs off the paths that ride this scan: postprocess's overlap filters,
// fimBound's balance step, and fimComment's is-this-`//`-in-a-string. Every
// expectation below is the answer the scan gave BEFORE block-comment state
// existed, so a drift in the absent path fails here.
const ABSENT_PATH_ROWS = [
  ["quote-blind default over a nested call", "foo(bar(baz", {}, ["(", "("], false, false],
  ["a closed pair leaves nothing", "if (a) { b(); }", {}, [], false, false],
  ["an apostrophe in a comment is not a literal", "// it's fine\nfn f() {", { lineComment: "//", literalQuotes: '"' }, ["{"], false, false],
  ["a brace inside a string literal is not structure", 'let s = "{{{";', { literalQuotes: '"' }, [], false, false],
  ["an unterminated literal swallows the tail", 'let s = "abc', { literalQuotes: '"' }, [], true, false],
  ["a comment that closes on a newline does not report itself", "let a = 1; // note\nb();", { lineComment: "//" }, [], false, false],
  ["a trailing line comment with no newline sets inLineComment", "fn f() { // note", { lineComment: "//" }, ["{"], false, true],
  ["a rust lifetime tick is not a literal", "fn f<'a>(x: &'a str) {", { literalQuotes: '"', charQuote: "'", lineComment: "//" }, ["{"], false, false],
  ["a rust char literal keeps the count", "let d = '(';\nfn f() {", { literalQuotes: '"', charQuote: "'", lineComment: "//" }, ["{"], false, false],
  ["a regex `//` is not a comment", "s.split(/\\/\\//);\nfn f() {", { literalQuotes: '"', lineComment: "//" }, ["{"], false, false],
  // The one that MOVES when the option is passed, kept here to pin what the
  // absent path does: the `}` inside the comment pops the real `{`.
  ["a brace inside a block comment still counts when blockComment is absent", "a { /* } */ b", { lineComment: "//", literalQuotes: '"' }, [], false, false],
];

for (const [name, text, syntax, stack, inLiteral, inLineComment] of ABSENT_PATH_ROWS) {
  test(`scanBrackets without blockComment: ${name}`, () => {
    assert.deepStrictEqual(scanBrackets(text, syntax), {
      stack,
      inLiteral,
      inLineComment,
      // Never set when the option is absent, so the added field costs the
      // existing callers nothing.
      inBlockComment: false,
    });
  });
}

test("scanBrackets: blockComment makes the brace inside a comment inert", () => {
  const syntax = { lineComment: "//", literalQuotes: '"', blockComment: ["/*", "*/"] };
  assert.deepStrictEqual(scanBrackets("a { /* } */ b", syntax), {
    stack: ["{"],
    inLiteral: false,
    inLineComment: false,
    inBlockComment: false,
  });
});

test("scanBrackets: a quote and a line-comment opener inside a block comment are inert", () => {
  const syntax = { lineComment: "//", literalQuotes: '"', blockComment: ["/*", "*/"] };
  assert.deepStrictEqual(scanBrackets('a { /* " // ( */ }', syntax), {
    stack: [],
    inLiteral: false,
    inLineComment: false,
    inBlockComment: false,
  });
});

test("scanBrackets: a block-comment opener inside a line comment or a literal is inert", () => {
  const syntax = { lineComment: "//", literalQuotes: '"', blockComment: ["/*", "*/"] };
  assert.deepStrictEqual(scanBrackets("// /* not opened\n{", syntax).stack, ["{"]);
  assert.deepStrictEqual(scanBrackets('let s = "/*"; {', syntax).stack, ["{"]);
});

test("scanBrackets: an unterminated block comment sets inBlockComment and ends the scan", () => {
  const syntax = { lineComment: "//", literalQuotes: '"', blockComment: ["/*", "*/"] };
  assert.deepStrictEqual(scanBrackets("fn f() { /* unterminated (", syntax), {
    stack: ["{"],
    inLiteral: false,
    inLineComment: false,
    inBlockComment: true,
  });
});

test("scanBrackets: nesting is not supported, so the first terminator closes", () => {
  const syntax = { blockComment: ["/*", "*/"] };
  // `/* /* */` closes at the first `*/`, leaving `{` as real structure. Rust
  // nests block comments and that is the documented limitation.
  assert.deepStrictEqual(scanBrackets("/* /* */ {", syntax).stack, ["{"]);
});

// ---------------------------------------------------------------------------
// The prompt channel.
// ---------------------------------------------------------------------------

const BASE_INPUT = {
  signature: "fn add(a: i32, b: i32) -> i32",
  docComment: "/// Adds.",
  languageId: "rust",
};

// The bytes as they were before this channel existed. Hardcoded rather than
// diffed against a second call, so a drift in the assembler cannot be invisible
// to both sides at once.
const BASE_PROMPT =
  "Implement the function below. Reply with one fenced code block containing the complete function " +
  "definition, signature and body. The block must contain only this one function: no imports, no other " +
  "functions, no code before or after it. Output nothing outside the code block.\n\n" +
  "```rust\n/// Adds.\nfn add(a: i32, b: i32) -> i32\n```";

test("fn-gen prompt: absent scaffoldComments is byte-identical", () => {
  assert.strictEqual(assembleFnGenPrompt(BASE_INPUT), BASE_PROMPT);
});

test("fn-gen prompt: an EMPTY harvest is byte-identical too", () => {
  assert.strictEqual(assembleFnGenPrompt({ ...BASE_INPUT, scaffoldComments: [] }), BASE_PROMPT);
});

test("fn-gen prompt: a present harvest renders a labelled section carrying every line", () => {
  const prompt = assembleFnGenPrompt({ ...BASE_INPUT, scaffoldComments: ["step 1", "step 2"] });
  assert.ok(prompt.startsWith(BASE_PROMPT.split("\n\n")[0]), "the instruction still leads");
  assert.match(prompt, /sketched the body as comments/, "the label says where they came from");
  assert.ok(prompt.includes("- step 1\n- step 2"), `lines missing: ${prompt}`);
  assert.ok(prompt.endsWith("```rust\n/// Adds.\nfn add(a: i32, b: i32) -> i32\n```"), "the target still ends it");
});

test("fn-gen prompt: the harvest sits ABOVE the injected surface, not below it", () => {
  const prompt = assembleFnGenPrompt({
    ...BASE_INPUT,
    scaffoldComments: ["step 1"],
    injectedSurface: "API surface:\n```rust\nfn helper()\n```",
  });
  assert.ok(
    prompt.indexOf("- step 1") < prompt.indexOf("API surface:"),
    `the harvest must precede the reference material: ${prompt}`,
  );
});

test("fn-gen prompt: the harvest survives every other routing (type kind, bodyOnly)", () => {
  for (const extra of [{ kind: "struct" }, { bodyOnly: true }, { noPunt: true }]) {
    const prompt = assembleFnGenPrompt({ ...BASE_INPUT, ...extra, scaffoldComments: ["step 1"] });
    assert.ok(prompt.includes("- step 1"), `harvest dropped under ${JSON.stringify(extra)}`);
  }
});

// ---------------------------------------------------------------------------
// Decision 1: the test-authoring pass never receives a body-scoped comment.
// ---------------------------------------------------------------------------

test("assembleTestGenPrompt: its inputs did not change, and a scaffold field is inert", () => {
  const input = {
    signature: "fn add(a: i32, b: i32) -> i32",
    docComment: "/// Adds.",
    languageId: "rust",
  };
  const base = assembleTestGenPrompt(input);
  // Handing it a harvest cannot change one byte: there is no such input on the
  // test-authoring pass, and there must never be one.
  assert.strictEqual(assembleTestGenPrompt({ ...input, scaffoldComments: ["step 1", "step 2"] }), base);
  assert.ok(!base.includes("step 1"), "a body comment reached the test prompt");
  assert.ok(!base.includes("sketched the body as comments"), "the scaffold label reached the test prompt");
});

test("assembleTestGenPrompt: the same harvest that changes the fn-gen prompt leaves this one alone", () => {
  const harvested = harvest(SCAFFOLD_BODIES.rust, "rust").comments;
  assert.strictEqual(harvested.length, 3);
  const sig = { signature: "fn build(items: &[u8]) -> Vec<u8>", docComment: "/// Builds.", languageId: "rust" };
  assert.notStrictEqual(
    assembleFnGenPrompt({ ...sig, scaffoldComments: harvested }),
    assembleFnGenPrompt(sig),
  );
  assert.strictEqual(assembleTestGenPrompt({ ...sig, scaffoldComments: harvested }), assembleTestGenPrompt(sig));
});

// ---------------------------------------------------------------------------
// Body slicing, on the shapes that have no body at all.
// ---------------------------------------------------------------------------

test("bodyTextOfSpan: a bodyless or expression-bodied member yields no body and harvests nothing", () => {
  assert.strictEqual(bodyTextOfSpan("int Area();", "csharp"), "");
  assert.strictEqual(bodyTextOfSpan("public int Area() => _w * _h;", "csharp"), "");
  assert.deepStrictEqual(harvest("int Area();", "csharp"), { comments: [], considered: 0 });
});

test("bodyTextOfSpan: a brace in a destructured parameter is not the body brace", () => {
  const spanText = "function f({ a, b }: Args) {\n  // step 1\n}";
  assert.deepStrictEqual(harvest(spanText, "typescript"), { comments: ["step 1"], considered: 1 });
});

test("bodyTextOfSpan: a generic constraint brace is not the body brace", () => {
  const spanText = "func F[T any](m map[string]T) {\n\t// step 1\n}";
  assert.deepStrictEqual(harvest(spanText, "go"), { comments: ["step 1"], considered: 1 });
});

test("harvestBodyComments: an unregistered language harvests nothing rather than guessing", () => {
  assert.deepStrictEqual(harvestBodyComments("{\n  // step 1\n}", "brainfuck", ""), {
    comments: [],
    considered: 0,
  });
});
