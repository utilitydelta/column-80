// BLIND contract oracle for session-v36 phase 1: the backtick gesture for
// comment-named types. Written against the contract in the goal
// before the implementation existed, from the exported surface only, and never
// edited to make an implementation pass.
//
// WHAT THE CONTRACT SAYS. A type name written in a COMMENT reaches the model
// ONLY when the developer backticks it. `MyType` in the comment means MyType is
// a candidate; an unbackticked PascalCase word in a comment is prose and is
// left alone. Same rule for doc comments and body comments, all five supported
// languages. The goal measured 97.7% of unbackticked comment words on real
// human-written code to be sentence-initial English (`Phase`, `The`, `Verify`),
// and the type cap binds on most targets, so admitting prose does not merely
// waste bytes, it evicts real types. That is the refuted design; the backtick
// gesture is the shipped one.
//
// WHAT IS PINNED HERE. `spanTypesInPlay` returns a span's candidate type names,
// deduped first-seen, in priority order. Today the order is signature, body
// code, doc-comment backticks, diagnostics. This phase inserts the BODY
// COMMENT's backticks between body code and the doc comment, giving five tiers.
// Section D is the row that pins that tier position; sections A and C pin that
// the leg fires at all, per language, through each language's real comment
// syntax; section B pins that it fires on nothing else.
//
// WHY SO MANY ROWS ARE ANTI-VACUITY PAIRS. Every fixture in A and C names its
// type in exactly ONE place, the comment, so a green row cannot be green for a
// second reason. Every guard row that expects nothing carries a control name in
// the same fixture that DOES resolve, so a row cannot pass because the leg died.
//
// CAPTURED, NOT DESIGNED. Section E freezes today's doc-comment output verbatim,
// and several filter rows below record what today's filter actually does rather
// than what it ought to do. Every such row says so and names its capture. The
// captures were taken by running the current `spanTypesInPlay` through this same
// bundle before the phase was implemented; the capture scripts are the probe
// files in the session scratchpad, and their results are inlined here so this
// file stands alone.
//
// EXPECTED RED AT THE TIME OF WRITING: sections A, C, D, and the two body-comment
// filter rows in F that carry a control. The feature does not exist yet, so the
// body-comment tier returns nothing. Those are the ratchet. Everything else is
// green today and must stay green.
//
// PARTLY SUPERSEDED 2026-08-02. F5 and F6 [rust] pinned the STRICT rule for what
// may sit inside a backtick: the whole span had to be one identifier or a `::`
// path. The human ratified the reversal of that decision, on evidence this file
// did not have. Playing the developer over 5,514 real functions showed the
// strict rule is invisible for the shapes people actually type, scoring 0% in Go
// and C# on `` `IsCa Yes` ``, and the widened rule's cost on committed doc prose
// was measured against the shipped rule rather than against nothing. The
// replacement contract is session-v37 item 1 and its oracle is
// `test/blind-v37-p1-backtick-r4.test.cjs`.
//
// Only those two rows move. F1 to F4 and F7 are untouched: a lowercase word, a
// lone capital, a std name, an ALL-CAPS constant and a string literal are all
// still refused, and every one of them is what stops the widened rule turning
// into a scan.
//
// Run: SKIP_LIVE=1 node --test test/blind-v36-p1-comment-backticks.test.cjs

const test = require("node:test");
const assert = require("node:assert/strict");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "blind-v36-p1-comment-backticks",
  `export { spanTypesInPlay } from "../src/core/repairTypes";\n`,
);
const { spanTypesInPlay } = mod;
test.after(cleanup);

const show = (v) => JSON.stringify(v);
const LANGS = ["rust", "csharp", "typescript", "python", "go"];

// The five languages' real line-comment openers, and the fixture shape each one
// needs. `head` and `tail` wrap the comment in a function whose signature names
// NO PascalCase type, so the comment is the only thing in the span that could
// possibly resolve. `indent` is what that language's body actually uses.
const SPAN = {
  rust: { head: "fn build() {", tail: "}", line: "//", indent: "    " },
  csharp: { head: "void build() {", tail: "}", line: "//", indent: "    " },
  typescript: { head: "function build() {", tail: "}", line: "//", indent: "  " },
  python: { head: "def build():", tail: "    pass", line: "#", indent: "    " },
  go: { head: "func build() {", tail: "}", line: "//", indent: "\t" },
};

// Wraps body lines in that language's empty-signature function.
const span = (languageId, ...bodyLines) => {
  const s = SPAN[languageId];
  return [s.head, ...bodyLines.map((l) => `${s.indent}${l}`), s.tail].join("\n");
};

// `Sprocket` is the probe name used everywhere a row expects a resolve. It was
// checked against all five languages' filters and none of them drops it, so a
// row that returns nothing is telling us about the LEG, not about the stop set.
const PROBE = "Sprocket";

// ===========================================================================
// 0. THE PREMISE. Every claim below is a claim about a SECOND source for an
// extraction that already exists. If the doc-comment leg were not already
// reading backticks, sections A through D would be pinning a feature nobody
// asked for rather than the placement of an existing one.
// ===========================================================================

test("0 premise: the doc-comment backtick leg already ships, in all five languages", () => {
  for (const languageId of LANGS) {
    assert.deepEqual(
      spanTypesInPlay({ languageId, docComment: `Returns a \`${PROBE}\` to the caller.` }),
      [PROBE],
      `${languageId}: the body-comment leg is "the same extraction pointed at a second source", so the first source must work`,
    );
  }
});

test("0 premise: and it already refuses the unbackticked word, in all five languages", () => {
  for (const languageId of LANGS) {
    assert.deepEqual(
      spanTypesInPlay({ languageId, docComment: `Returns a ${PROBE} to the caller.` }),
      [],
      `${languageId}: backticks are the gesture in doc comments today; the phase carries that same rule into the body`,
    );
  }
});

// ===========================================================================
// A. THE LINE COMMENT, ONE FIXTURE PER LANGUAGE. Each span's signature names no
// type and its body has no code at all, so the ONLY thing that can produce
// `Sprocket` is the comment. RED at the time of writing: the tier does not
// exist.
//
// The comment opener comes from each language's real syntax, `//` for rust, C#,
// TypeScript and Go, `#` for Python. A fixture using the wrong opener would
// make the language's row green for the wrong reason.
// ===========================================================================

for (const languageId of LANGS) {
  test(`A [${languageId}]: a backticked name in a LINE body comment resolves`, () => {
    const code = span(languageId, `${SPAN[languageId].line} resolve \`${PROBE}\` before writing this`);
    assert.deepEqual(
      spanTypesInPlay({ languageId, code }),
      [PROBE],
      `the backtick is the developer's explicit opt-in. Span:\n${code}`,
    );
  });
}

// TypeScript and Go both list the backtick as a STRING delimiter (template
// literals, raw strings). A masker that runs its quote rules over comment text
// would swallow the gesture in exactly those two languages and nowhere else,
// which is the kind of defect that ships green on rust and is found in the
// field. This row exists to make that failure loud rather than partial.
for (const languageId of ["typescript", "go"]) {
  test(`A [${languageId}]: the backtick is a quote character in this language, and still reads as the gesture inside a comment`, () => {
    const code = span(languageId, `${SPAN[languageId].line} the caller needs \`${PROBE}\` here`);
    assert.deepEqual(
      spanTypesInPlay({ languageId, code }),
      [PROBE],
      `a backtick inside a comment is never a string opener. Span:\n${code}`,
    );
  });
}

test("A [rust]: two backticked names in one comment both resolve, in written order", () => {
  const code = span("rust", "// resolve `Sprocket` and then `Flywheel`");
  assert.deepEqual(
    spanTypesInPlay({ languageId: "rust", code }),
    ["Sprocket", "Flywheel"],
    "the leg is a scan, not a single match, and order within a tier is the order the developer wrote",
  );
});

test("A [rust]: a comment on the same line as code still carries the gesture", () => {
  // A trailing comment is where a developer most often names the type they are
  // reaching for, so a leg that only reads whole-line comments misses the
  // commonest gesture.
  const code = span("rust", "let held = load(); // this should be a `Sprocket`");
  assert.deepEqual(
    spanTypesInPlay({ languageId: "rust", code }),
    [PROBE],
    `trailing comments are comments. Span:\n${code}`,
  );
});

// ===========================================================================
// B. THE REFUTED DESIGN. An unbackticked PascalCase word in the same comment
// position resolves nothing. The prose below is the measured junk: the goal
// counted `Phase(229)`, `The(217)`, `Verify(169)`, `Wait`, `If` and `No` across
// 6,856 comment lines of human-written code, at 97.7% junk.
//
// GREEN today and must stay green. This is the row that fails if somebody
// "helpfully" widens the leg to any PascalCase word in a comment.
// ===========================================================================

const PROSE = "Phase two. The caller must Verify this. Wait. If No, return.";

for (const languageId of LANGS) {
  test(`B [${languageId}]: unbackticked PascalCase prose in a body comment resolves nothing`, () => {
    const code = span(languageId, `${SPAN[languageId].line} ${PROSE}`);
    assert.deepEqual(
      spanTypesInPlay({ languageId, code }),
      [],
      `sentence-initial English is 97.7% of what an unbackticked scan finds, and the type cap binds, so admitting it evicts real types. Span:\n${code}`,
    );
  });
}

test("A [rust]: an unbackticked real-looking type name beside a backticked one admits only the backticked one", () => {
  // The sharpest form of the rule: both words are plausible types and only the
  // gesture separates them. Sits in A rather than B because it expects a
  // resolve, so it is RED until the tier exists.
  const code = span("rust", "// a Flywheel goes in here, so resolve `Sprocket` first");
  assert.deepEqual(
    spanTypesInPlay({ languageId: "rust", code }),
    [PROBE],
    "the developer marked one and not the other, and that mark is the whole contract",
  );
});

test("B [rust]: the same prose in a DOC comment also resolves nothing", () => {
  assert.deepEqual(
    spanTypesInPlay({ languageId: "rust", docComment: `/// ${PROSE}` }),
    [],
    "one rule, both comment kinds",
  );
});

// ===========================================================================
// C. BLOCK COMMENTS, per language where the syntax is real. Rust, C#,
// TypeScript and Go have `/* */`. Python has no `/* */` at all; its block form
// is the triple-quoted string, which the product's own comment-syntax table
// classifies as a doc delimiter rather than a quote, so that is what this
// section uses for Python. RED at the time of writing.
// ===========================================================================

for (const languageId of ["rust", "csharp", "typescript", "go"]) {
  test(`C [${languageId}]: a backticked name in a /* */ BLOCK comment resolves`, () => {
    const code = span(languageId, `/* resolve \`${PROBE}\` before writing this */`);
    assert.deepEqual(
      spanTypesInPlay({ languageId, code }),
      [PROBE],
      `block comments are comments. Span:\n${code}`,
    );
  });

  test(`C [${languageId}]: and across several lines of one block comment`, () => {
    const code = span(
      languageId,
      "/*",
      ` * the caller hands us a \`${PROBE}\``,
      " * and expects it back",
      " */",
    );
    assert.deepEqual(
      spanTypesInPlay({ languageId, code }),
      [PROBE],
      `a multi-line block is one comment, not a run of unrecognised lines. Span:\n${code}`,
    );
  });
}

for (const delim of ['"""', "'''"]) {
  test(`C [python]: a backticked name in a ${delim} block resolves`, () => {
    const code = span("python", `${delim}resolve \`${PROBE}\` before writing this${delim}`);
    assert.deepEqual(
      spanTypesInPlay({ languageId: "python", code }),
      [PROBE],
      `python's block-comment idiom is the triple-quoted block, and both delimiters are real. Span:\n${code}`,
    );
  });
}

// ===========================================================================
// D. THE ORDER, and the reason this file exists. The tier goes BETWEEN body
// code and the doc comment. A span whose signature, body code, body comment and
// doc comment each name a distinct type, plus a diagnostic naming a fifth,
// pins all five positions at once. Nothing here is deduped, so a wrong position
// cannot hide behind first-seen.
//
// RED at the time of writing. CAPTURED before the phase: today this same
// fixture returns ["SigOnly","SigReturn","BodyOnly","DocOnly","DiagOnly"], the
// four-tier order with `CommentOnly` absent entirely. After the phase,
// `CommentOnly` must appear at index 3 and nothing else may move.
// ===========================================================================

const orderFixture = (languageId, sigLine, bodyLine, docComment) => ({
  languageId,
  signature: sigLine,
  code: span(languageId, bodyLine, `${SPAN[languageId].line} resolve \`CommentOnly\` here`),
  docComment,
  diagnosticTypes: ["DiagOnly"],
});

const ORDER_CASES = {
  rust: orderFixture("rust", "fn build(input: SigOnly) -> SigReturn", "let held: BodyOnly = load();", "/// Builds from a `DocOnly`."),
  typescript: orderFixture("typescript", "function build(input: SigOnly): SigReturn", "const held: BodyOnly = load();", "/** Builds from a `DocOnly`. */"),
  csharp: orderFixture("csharp", "public SigReturn build(SigOnly input)", "BodyOnly held = load();", "/// <summary>Builds from a `DocOnly`.</summary>"),
  python: orderFixture("python", "def build(input: SigOnly) -> SigReturn:", "held: BodyOnly = load()", '"""Builds from a `DocOnly`."""'),
  go: orderFixture("go", "func build(input SigOnly) SigReturn", "var held BodyOnly = load()", "// Builds from a `DocOnly`."),
};

// C# renders its signature return type first, which was captured from today's
// output and is not something this phase touches.
const ORDER_SIGNATURE_TIER = {
  rust: ["SigOnly", "SigReturn"],
  typescript: ["SigOnly", "SigReturn"],
  csharp: ["SigReturn", "SigOnly"],
  python: ["SigOnly", "SigReturn"],
  go: ["SigOnly", "SigReturn"],
};

for (const [languageId, input] of Object.entries(ORDER_CASES)) {
  test(`D [${languageId}]: five tiers, signature then body code then BODY COMMENT then doc comment then diagnostics`, () => {
    assert.deepEqual(
      spanTypesInPlay(input),
      [...ORDER_SIGNATURE_TIER[languageId], "BodyOnly", "CommentOnly", "DocOnly", "DiagOnly"],
      `the body comment sits between the body's code and the doc comment. A tier in the wrong place still returns every name, so only the exact list catches it. Span:\n${input.code}`,
    );
  });
}

test("D [rust]: the tier is BELOW body code, shown by a body comment that repeats a body-code name", () => {
  // Dedupe is first-seen, so a name in both places keeps the EARLIER slot. If
  // the comment tier were placed above body code this list would be
  // ["BodyOnly","Sprocket"] instead.
  const input = {
    languageId: "rust",
    code: span("rust", "let held: Sprocket = load();", "// also resolve `BodyOnly` and `Sprocket`"),
  };
  assert.deepEqual(
    spanTypesInPlay(input),
    ["Sprocket", "BodyOnly"],
    "the body's real code outranks a comment about it",
  );
});

test("D [rust]: the tier is ABOVE the doc comment, shown by a shared name landing at the body-comment slot", () => {
  const input = {
    languageId: "rust",
    code: span("rust", "// resolve `Sprocket` and `Flywheel`"),
    docComment: "/// Builds a `Flywheel` from a `Camshaft`.",
  };
  assert.deepEqual(
    spanTypesInPlay(input),
    ["Sprocket", "Flywheel", "Camshaft"],
    "`Flywheel` is in both comments; first-seen puts it at the body-comment position, which is only true if that tier runs first",
  );
});

// ===========================================================================
// E. THE DOC-COMMENT LEG IS BYTE-IDENTICAL TO TODAY. Every expected value below
// was CAPTURED by running the current `spanTypesInPlay` through this bundle
// before the phase was implemented. None of these fixtures contains a body
// comment or a backtick in body code, so nothing this phase adds may touch
// them. A changed value here is a regression, not a new behaviour, whatever the
// implementation says.
//
// GREEN today by construction. The value of the section is entirely in staying
// green afterwards.
// ===========================================================================

const FROZEN_DOC = [
  ["rust, plain doc with a prose word beside the gesture", { languageId: "rust", docComment: "/// Builds a `Widget` from a `Gadget`.\n/// Ignores Widget written as prose." }, ["Widget", "Gadget"]],
  ["rust, a `::` path contributes its final segment", { languageId: "rust", docComment: "/// See `pki::CertBundle` and `Sprocket`." }, ["CertBundle", "Sprocket"]],
  ["rust, the filters, all three kinds at once", { languageId: "rust", docComment: "/// Returns `Vec` of `T` with `MAX_LOD` and `Sprocket`." }, ["Sprocket"]],
  ["csharp, an XML doc comment", { languageId: "csharp", docComment: "/// <summary>Builds a `Widget` from a `Gadget`.</summary>\n/// <returns>A `Sprocket`.</returns>" }, ["Widget", "Gadget", "Sprocket"]],
  ["typescript, a JSDoc block", { languageId: "typescript", docComment: "/**\n * Builds a `Widget` from a `Gadget`.\n * @returns a `Sprocket`\n */" }, ["Widget", "Gadget", "Sprocket"]],
  ["python, a docstring", { languageId: "python", docComment: '"""Builds a `Widget` from a `Gadget`.\n\nReturns a `Sprocket`.\n"""' }, ["Widget", "Gadget", "Sprocket"]],
  ["go, a leading `//` doc block", { languageId: "go", docComment: "// Build turns a `Widget` into a `Gadget` and a `Sprocket`." }, ["Widget", "Gadget", "Sprocket"]],
  ["rust, doc behind a signature", { languageId: "rust", signature: "fn build(g: Gadget) -> Sprocket", docComment: "/// Builds a `Widget` from a `Gadget`." }, ["Gadget", "Sprocket", "Widget"]],
  [
    "rust, all four existing tiers with two names shared across them",
    {
      languageId: "rust",
      signature: "fn build(g: Gadget) -> Sprocket",
      code: "fn build(g: Gadget) -> Sprocket {\n    let w: Widget = Widget::new();\n    todo!()\n}",
      docComment: "/// Builds a `Widget` and a `Flywheel`.",
      diagnosticTypes: ["Camshaft", "Gadget"],
    },
    ["Gadget", "Sprocket", "Widget", "Flywheel", "Camshaft"],
  ],
];

for (const [label, input, frozen] of FROZEN_DOC) {
  test(`E freeze: ${label}`, () => {
    assert.deepEqual(
      spanTypesInPlay(input),
      frozen,
      "captured from the shipping code before this phase. The goal's acceptance says existing doc-comment behaviour is byte-identical",
    );
  });
}

// ===========================================================================
// F. THE GUARDS.
//
// F1 to F5 run on the DOC comment, where the filter already ships, so they
// prove the filter EXISTS and are green today. The contract says the
// body-comment leg is held to the same rule, so F6 repeats them against a body
// comment with a control name in the same fixture. F6 is RED today: the control
// half cannot resolve until the leg exists.
//
// The per-language stop-set memberships in F3 were CAPTURED, not assumed. The
// five languages do not share one list: `Vec` is dropped for rust and kept for
// C#, `Error` is dropped for TypeScript and kept for go. Each name below was
// probed individually against today's doc leg. `Widget` is kept by all five and
// serves as every row's control.
// ===========================================================================

test("F1: a backticked lowercase word resolves nothing, and the control beside it resolves", () => {
  assert.deepEqual(
    spanTypesInPlay({ languageId: "rust", docComment: "see `somecrate` and `foo` for the `Sprocket`" }),
    [PROBE],
    "a crate or module name is not a type surface to inject",
  );
});

test("F2: a backticked single capital resolves nothing", () => {
  // A single letter is a generic parameter. Resolving one buys a round trip and
  // a cap slot for something no caller can use.
  assert.deepEqual(
    spanTypesInPlay({ languageId: "rust", docComment: "generic over `T` and `U`, returns a `Sprocket`" }),
    [PROBE],
    "single letters are type parameters",
  );
});

// CAPTURED per language. These are the names today's doc leg actually drops for
// each language, probed one at a time, not a guess at what a prelude contains.
const STOP_NAMES = {
  rust: ["Vec", "Result", "Option"],
  csharp: ["String", "List", "Task"],
  typescript: ["String", "Promise", "Array"],
  python: ["String", "List", "Dict"],
  go: ["String", "Context", "Time"],
};

for (const [languageId, stops] of Object.entries(STOP_NAMES)) {
  test(`F3 [${languageId}]: a backticked std/prelude name resolves nothing, and Widget beside it does`, () => {
    const ticked = stops.map((n) => `\`${n}\``).join(" and ");
    assert.deepEqual(
      spanTypesInPlay({ languageId, docComment: `takes ${ticked} and a \`Widget\`` }),
      ["Widget"],
      `${languageId}: the model already knows its own standard library; a slot spent on ${show(stops)} is a slot a real collaborator needed`,
    );
  });
}

test("F4: a backticked ALL-CAPS name resolves nothing", () => {
  assert.deepEqual(
    spanTypesInPlay({ languageId: "rust", docComment: "bounded by `MAX_LOD` and `TTL_SECS`, returns a `Sprocket`" }),
    [PROBE],
    "an ALL-CAPS name is a constant, not a type",
  );
});

test("F5 [SUPERSEDED 2026-08-02]: the span is parsed, and what it yields is still bounded", () => {
  // WHAT THIS ROW USED TO SAY, kept verbatim so the reversal is on the record
  // rather than inferred from a diff: all seven cases below resolved nothing,
  // "frozen so the body-comment leg is held to the same shape rather than
  // growing a looser parser".
  //
  // The human reversed it. Parsing whatever sits inside a backtick is what the
  // tool did before v36, now fenced to backtick regions, and it matches what a
  // developer means by the gesture. Two of these seven flip, and both flips are
  // the point of the reversal.
  assert.deepEqual(
    spanTypesInPlay({ languageId: "rust", docComment: "see `Wrapper<Inner>` here" }),
    ["Wrapper", "Inner"],
    "the inner type is the one worth having; reading the span as `Wrapper` alone would inject nothing at all once the stop set drops a container name",
  );
  assert.deepEqual(
    spanTypesInPlay({ languageId: "rust", docComment: "see `Widget,` here" }),
    ["Widget"],
    "a trailing comma is punctuation, not a reason to ignore the developer",
  );
  // Two more flipped a second time, after an adversarial review measured that
  // 79.8% of Go type occurrences and 12.0% of Rust ones are spelled a way the
  // first cut of the widened rule still refused. A path is read as a path, and a
  // CALL names its receiver.
  assert.deepEqual(
    spanTypesInPlay({ languageId: "rust", docComment: "see `Widget::new()` here" }),
    ["Widget"],
    "a developer naming a constructor by its call path is naming a type",
  );
  assert.deepEqual(
    spanTypesInPlay({ languageId: "rust", docComment: "see `Some.Namespace.OtherType` here" }),
    ["OtherType"],
    "a qualified name is the type on the right; reading the leading segment injected the NAMESPACE and lost the type",
  );

  // The other three still resolve nothing, and each for its own reason. This is
  // the half that says the widened rule is a parser and not a scan.
  const stillNothing = [
    ["`_Private`", "an underscore start is not a type name"],
    ["`3Type`", "a digit start is not an identifier"],
    ["`myType`", "lowercase is not a type"],
  ];
  for (const [c, why] of stillNothing) {
    assert.deepEqual(spanTypesInPlay({ languageId: "rust", docComment: `see ${c} here` }), [], `${c}: ${why}`);
  }
  // And the member-access guard, which is what keeps the path rule from reading
  // every dotted expression in a doc as a type.
  assert.deepEqual(
    spanTypesInPlay({ languageId: "rust", docComment: "see `self.value` and `some.module` here" }),
    [],
    "a lowercase path is not a type at either end",
  );

  assert.deepEqual(
    spanTypesInPlay({ languageId: "rust", docComment: "see `myType` and `Sprocket` here" }),
    [PROBE],
    "control: the leg is alive in the same fixture that refuses the four above",
  );
});

test("F6 [rust] [SUPERSEDED 2026-08-02]: every surviving filter applies to a BODY comment too", () => {
  // Unchanged in intent: one extraction, two sources, one filter. What changed
  // is that `Wrapper<Inner>` is no longer one of the things refused, so it moves
  // out of this fixture and into F5's flip half above. The four refusals left
  // here are the ones the reversal did not touch.
  const code = span("rust", "// `somecrate` `T` `Vec` `MAX_LOD` and a real `Sprocket`");
  assert.deepEqual(
    spanTypesInPlay({ languageId: "rust", code }),
    [PROBE],
    `one extraction, two sources, one filter. Span:\n${code}`,
  );
});

test("F6 [python]: the same, on a language with a different stop set and a different comment opener", () => {
  const code = span("python", "# `somecrate` `T` `List` `MAX_LOD` and a real `Sprocket`");
  assert.deepEqual(
    spanTypesInPlay({ languageId: "python", code }),
    [PROBE],
    `python drops List where csharp does and rust does not, and the body leg inherits that per-language table. Span:\n${code}`,
  );
});

// A backtick inside a STRING LITERAL is not a comment. These rows are green
// today and are the ones most at risk from the phase: the goal points the new
// leg at whatever the body masker blanked out, and if that text includes string
// contents then a string full of backticks becomes an injection source. Each
// fixture carries a real type in body-CODE position so the row cannot pass
// because the whole body scan died.
const STRING_LITERAL_CASES = {
  rust: 'let s = "a `StringOnly` b";',
  csharp: 'string s = "a `StringOnly` b";',
  typescript: 'const s = "a `StringOnly` b";',
  python: 's = "a `StringOnly` b"',
  go: 's := "a `StringOnly` b"',
};

for (const [languageId, literal] of Object.entries(STRING_LITERAL_CASES)) {
  test(`F7 [${languageId}]: a backtick inside a string literal is not a comment`, () => {
    const bodyDecl = { rust: "let held: Sprocket = load();", csharp: "Sprocket held = load();", typescript: "const held: Sprocket = load();", python: "held: Sprocket = load()", go: "var held Sprocket = load()" }[languageId];
    const code = span(languageId, literal, bodyDecl);
    assert.deepEqual(
      spanTypesInPlay({ languageId, code }),
      [PROBE],
      `StringOnly is program data, not a developer gesture. The control Sprocket proves the body scan ran. Span:\n${code}`,
    );
  });
}

test("F7 [go]: a RAW string, whose own delimiter is the backtick, is still not a comment", () => {
  // Go raw strings are delimited by backticks, so `Widget` sitting in Go source
  // is a string literal and not a gesture. The gesture only exists inside a
  // comment, and this row is what separates the two for the one language where
  // the characters are identical.
  const code = span("go", "raw := `Widget`", "var held Sprocket = load()", "_ = raw");
  assert.deepEqual(
    spanTypesInPlay({ languageId: "go", code }),
    [PROBE],
    `a raw string is code. Span:\n${code}`,
  );
});

test("F7 [typescript]: a TEMPLATE literal is not a comment either", () => {
  const code = span("typescript", "const raw = `Widget`;", "const held: Sprocket = load();");
  assert.deepEqual(
    spanTypesInPlay({ languageId: "typescript", code }),
    [PROBE],
    `a template literal is code. Span:\n${code}`,
  );
});

test("F8: a name appearing in both comments is returned once", () => {
  // Dedupe is first-seen across the whole list. A second tier reading the same
  // gesture twice would double a name and spend two cap slots on one type.
  const input = {
    languageId: "rust",
    code: span("rust", "// resolve `Sprocket`"),
    docComment: "/// Also a `Sprocket`.",
  };
  assert.deepEqual(spanTypesInPlay(input), [PROBE], "one name, one slot");
});

// ===========================================================================
// G. ROBUSTNESS. This function runs inside a repair round on whatever the
// developer's buffer happens to contain, including a half-typed comment. It
// returns a list or it breaks the round; there is no third option. Every row
// here is green today and the phase must not change that.
// ===========================================================================

const ok = (label, input) => {
  test(`G: ${label} returns an array of strings and never throws`, () => {
    let out;
    assert.doesNotThrow(() => {
      out = spanTypesInPlay(input);
    }, `a malformed span must not break the repair round: ${label}`);
    assert.ok(Array.isArray(out), `got ${show(out)}`);
    for (const name of out) {
      assert.equal(typeof name, "string", `every element is a name; got ${show(out)}`);
    }
  });
};

ok("empty code", { languageId: "rust", code: "" });
ok("undefined code", { languageId: "rust" });
ok("an empty input object", {});
ok("an unknown language", { languageId: "elvish", code: "// `Sprocket`", docComment: "`Widget`" });
ok("an unterminated block comment", { languageId: "rust", code: "fn build() {\n    /* resolve `Sprocket`\n" });
ok("an unterminated python block", { languageId: "python", code: 'def build():\n    """resolve `Sprocket`\n' });
ok("an unclosed backtick", { languageId: "rust", code: "fn build() {\n    // resolve `Sprocket and no close\n}" });
ok("a comment that is only backticks", { languageId: "rust", code: "fn build() {\n    // ``````\n}" });
ok("a doc comment that is only backticks", { languageId: "rust", docComment: "``````" });
ok("an unterminated string literal", { languageId: "rust", code: 'fn build() {\n    let s = "a `Sprocket\n}' });

// A 200KB body is what a generated file or a vendored blob looks like when the
// cursor lands in one. The leg scans the whole span, so its cost is linear in
// something the developer controls and the round cannot afford a pathological
// scan there.
test("G: a 200KB body neither throws nor loses the gesture at the end of it", () => {
  const filler = `${SPAN.rust.indent}let n = 1;\n`;
  const body = filler.repeat(Math.ceil(200 * 1024 / filler.length));
  const code = `fn build() {\n${body}    // resolve \`${PROBE}\` before writing this\n}`;
  assert.ok(code.length >= 200 * 1024, `fixture precondition: the body is at least 200KB, got ${code.length}`);
  let out;
  assert.doesNotThrow(() => {
    out = spanTypesInPlay({ languageId: "rust", code });
  }, "a large buffer is an ordinary buffer");
  assert.ok(Array.isArray(out), `got ${show(out)}`);
});
