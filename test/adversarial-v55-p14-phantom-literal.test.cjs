// ADVERSARIAL review evidence for session-v55 phase 14 (queue Q17, the Rust
// `'"'` char literal that opens a phantom string). Every row here is EVIDENCE
// for a finding in the review, not a contract. Nothing in this file was written
// to be satisfied by the implementation; the rows that fail are the findings.
//
// The phase has NO blind oracle on purpose: the goal forbade a new one and named
// the exact row to flip. So this file is the only independent measurement of
// what the ratified rule actually did, and it deliberately measures the two
// things the entry declared without measuring - the COST and the RESIDUAL - plus
// the four languages the entry called unaffected.
//
// Run: SKIP_LIVE=1 node --test test/adversarial-v55-p14-phantom-literal.test.cjs

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const ts = require("typescript");
const { bundleCore } = require("./.blind-util.cjs");

const core = bundleCore(
  "adversarial-v55-p14-core",
  `export { commentTypesIn, firstCodeOccurrence } from "../src/core/commentTypes";\n`,
);
const { commentTypesIn, firstCodeOccurrence } = core.mod;
test.after(() => core.cleanup());

const show = (v) => JSON.stringify(v);

// ── the RESIDUAL the phase declared ──────────────────────────────────────────
// Both the product doc comment and the re-cut row D of
// `impl-v37-p1-comment-anchor.test.cjs` name ONE example of the residual:
// `let q = '"'; let s = "x";`, "crosses no newline and is still read as a
// literal". Measured against the pre-fix build (worktree at b0c65d0), that
// example returned `[]` before the fix and returns `["Sprocket"]` after it. It
// is not a residual. It is a case the fix CLOSED, by luck rather than by design:
// the char literal's `"` pairs with the OPENER of `"x"` on its own line, which
// leaves the CLOSER of `"x"` unpaired, and that closer crosses the newline and
// is blanked. Any odd number of remaining quotes on the line lands the same way.
test("A14-1: the residual the phase DECLARED does not reproduce - that shape is fixed", () => {
  const stated = 'fn f() {\n    let q = \'"\'; let s = "x";\n    // `Sprocket`\n}';
  assert.deepEqual(
    commentTypesIn(stated, "rust", undefined, undefined),
    ["Sprocket"],
    "the doc comment and row D both call this shape a live residual; it is not",
  );
});

// The residual is REAL, and this is what it looks like: the comment has to sit
// on the SAME line, BETWEEN the phantom opener and the quote it wrongly pairs
// with. Then nothing crosses a newline, nothing is blanked, and the whole
// comment is skipped as literal content exactly as before.
test("A14-2: the TRUE residual is a comment on the phantom's own line", () => {
  const same = 'fn f() {\n    let q = \'"\'; /* `Sprocket` */ let s = "x";\n}';
  assert.deepEqual(
    commentTypesIn(same, "rust", undefined, undefined),
    [],
    "if this ever returns the name, the quote set was fixed and this row is the record of when",
  );
});

// ── the COST the phase declared ──────────────────────────────────────────────
// Stated in the product doc comment: a Rust string literal that legally spans
// lines and closes is blanked too, so a `//` inside it can contribute a name.
// It does. This is the counter-case, built rather than assumed.
test("A14-3: the declared COST fires - a legal multi-line Rust string leaks a name", () => {
  const code =
    'fn f() {\n    let sql = "SELECT a\n        // `Bogus` is inside a STRING\n        FROM t";\n    // `Sprocket`\n}';
  assert.deepEqual(
    commentTypesIn(code, "rust", undefined, undefined),
    ["Bogus", "Sprocket"],
    "`Bogus` is string content, not a comment, and it now takes a cap slot AHEAD of the real name",
  );
});

// And the leak is ORDER-SENSITIVE, which the cost paragraph does not say. The
// false name arrives FIRST, so under a type cap it is the real name that is
// evicted, not the false one.
test("A14-3b: the leaked name arrives ahead of the real one, so a cap evicts the real one", () => {
  const code =
    'fn f() {\n    let sql = "a\n    // `Bogus`\n    b";\n    // `Sprocket`\n}';
  const got = commentTypesIn(code, "rust", undefined, undefined);
  assert.equal(got[0], "Bogus", `first-seen order puts the string leak first: ${show(got)}`);
});

// ── the four languages the entry called unaffected ───────────────────────────
// The entry's premise is that C#, Go, TS and Python "carry `'` and get it
// right", so this is a Rust-row fault. That is true of the DEFECT. It is not
// true of the FIX: the rule keys on a literal scan crossing a newline, and a
// TS template literal, a Go raw string and a C# verbatim string all cross
// newlines LEGALLY. All three now leak their contents to the comment scanner.
test("A14-4a: TypeScript template literals are blanked too - a `//` inside one now leaks", () => {
  const code = "function f() {\n  const q = `SELECT a\n    // \\`Bogus\\`\n    FROM t`;\n  // `Sprocket`\n}";
  assert.deepEqual(
    commentTypesIn(code, "typescript", undefined, undefined),
    ["Bogus", "Sprocket"],
    "the rule is not Rust-only; a multi-line template literal is a legal, common TS shape",
  );
});

test("A14-4b: Go raw strings are blanked too", () => {
  const code = "func f() {\n\tq := `SELECT a\n\t// $NAME$\n\tFROM t`\n\t// `Sprocket`\n}".replace(
    "$NAME$",
    "`Bogus`",
  );
  assert.deepEqual(
    commentTypesIn(code, "go", undefined, undefined),
    ["Bogus", "Sprocket"],
    "Go raw strings span lines by construction and are the idiomatic way to write SQL and templates",
  );
});

test("A14-4c: C# verbatim strings are blanked too", () => {
  const code = 'void F() {\n    var s = @"line one\n    // `Bogus`\n    line two";\n    // `Sprocket`\n}';
  assert.deepEqual(
    commentTypesIn(code, "csharp", undefined, undefined),
    ["Bogus", "Sprocket"],
    "`@\"...\"` is the C# multi-line shape and it is everywhere in path and SQL code",
  );
});

// Python is the one that already bit the implementer once (the doc-opener order
// was added because blanking ate the first character of a docstring). It holds.
test("A14-4d: Python's docstring shapes are untouched, including the unterminated one", () => {
  const unterminated = 'def f():\n    """not closed\n    # `Sprocket`\n    x = Widget()\n';
  assert.deepEqual(commentTypesIn(unterminated, "python", undefined, undefined), ["Sprocket"]);
  const closed = 'def f():\n    """uses `Sprocket` here"""\n    x = Widget()\n';
  assert.deepEqual(commentTypesIn(closed, "python", undefined, undefined), ["Sprocket"]);
  const apostrophe = "def f():\n    # don't do it\n    # `Sprocket`\n    x = Widget()\n";
  assert.deepEqual(commentTypesIn(apostrophe, "python", undefined, undefined), ["Sprocket"]);
  assert.equal(
    firstCodeOccurrence(apostrophe, "python", "Widget"),
    apostrophe.indexOf("Widget"),
    "an apostrophe in English prose is the shape that broke this once already",
  );
});

// ── the anchor half changes DIRECTION ────────────────────────────────────────
// The pre-fix module header called the phantom's failure "the safe one": it
// UNDER-rejected, accepting a comment position. Blanking a literal opener can
// now let a `/*` inside that literal open a block comment that never closes, and
// then the anchor OVER-rejects: every real code position after it in the span is
// refused. That is a direction the header never priced. The fallback is the
// use/import scan, so it degrades rather than lies - but a local type that is
// not imported gets no anchor at all.
test("A14-5: a `/*` inside a legal multi-line literal now refuses every later code position", () => {
  const code = 'fn f() {\n    let s = "see /* here\n    and here";\n    let w: Widget = make();\n}';
  assert.equal(
    firstCodeOccurrence(code, "rust", "Widget"),
    undefined,
    "a real declaration position, refused; pre-fix this returned the offset of `Widget`",
  );
  assert.notEqual(code.indexOf("Widget"), -1, "and the name really is there, in code");
});

// ── why BOTH halves had to move ──────────────────────────────────────────────
// The implementer's stated reason, checked rather than taken: fixing extraction
// alone makes the gesture PRODUCE a candidate whose only occurrence is the
// comment, and the un-fixed anchor would have handed that comment offset to the
// language server. That is a dead anchor the module header calls worse than
// nothing, and it is a state that did not exist before the fix - so moving
// `firstCodeOccurrence` is required BY the ratified rule, not scope creep.
test("A14-6: the fixed pair agrees - the name is extracted AND the comment is refused as an anchor", () => {
  const code = "fn build() {\n    let q = '\"';\n    // needs `Sprocket`\n}\n";
  assert.deepEqual(commentTypesIn(code, "rust", undefined, undefined), ["Sprocket"]);
  assert.equal(
    firstCodeOccurrence(code, "rust", "Sprocket"),
    undefined,
    "extraction without this refusal would anchor the candidate at its comment offset",
  );
  assert.equal(
    code.indexOf("Sprocket"),
    code.indexOf("// needs `Sprocket`") + "// needs `".length,
    "and that offset is inside the comment, which is the dead anchor",
  );
});

// ── the exported function must keep its prose ────────────────────────────────
// This repo's method is prose-as-interface, and the new private helper was
// inserted BETWEEN `commentTypesIn`'s doc comment and `commentTypesIn` itself.
// Two consecutive JSDoc blocks both bind to the declaration that follows them,
// so the gesture's own documentation silently detached from the gesture. This
// row is mechanical and catches it whoever does it next.
test("A14-7: every exported function in commentTypes.ts still carries its own doc comment", () => {
  const file = path.join(__dirname, "..", "src", "core", "commentTypes.ts");
  const text = fs.readFileSync(file, "utf8");
  const sf = ts.createSourceFile("commentTypes.ts", text, ts.ScriptTarget.Latest, true);
  const missing = [];
  sf.forEachChild((node) => {
    if (!ts.isFunctionDeclaration(node) || node.name === undefined) {
      return;
    }
    const exported = (node.modifiers ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    if (exported && ts.getJSDocCommentsAndTags(node).length === 0) {
      missing.push(node.name.text);
    }
  });
  assert.deepEqual(missing, [], `exported with no JSDoc bound to it: ${show(missing)}`);
});

// ── cost of the pass itself ──────────────────────────────────────────────────
// `withoutPhantomLiterals` runs on every call and `firstCodeOccurrence` is
// called once per candidate TYPE, so it runs several times over the same span
// per injection. Linear, and the constant is small against a span; the row
// exists so a future rewrite that makes it quadratic is caught rather than felt.
test("A14-8: the phantom pass is linear in the span, not quadratic", () => {
  const unit = 'let s = "value"; // a `Widget` and an apostrophe it\'s\n';
  const timeAt = (n) => {
    const code = unit.repeat(n);
    commentTypesIn(code, "typescript", undefined, undefined);
    const start = process.hrtime.bigint();
    for (let k = 0; k < 5; k++) {
      commentTypesIn(code, "typescript", undefined, undefined);
    }
    return Number(process.hrtime.bigint() - start) / 5;
  };
  const small = timeAt(2000);
  const big = timeAt(16000);
  // 8x the input. Linear lands near 8x; quadratic lands near 64x. The bound is
  // deliberately loose because this is a wall clock on a shared box - it is a
  // COMPLEXITY row, not a latency row.
  assert.ok(big / small < 24, `8x input cost ${(big / small).toFixed(1)}x, which is not linear`);
});
