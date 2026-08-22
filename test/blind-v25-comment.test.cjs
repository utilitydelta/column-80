// BLIND ORACLE - session-v25 fixes 3 and 4: the comment rules.
// Black-box contract test for `src/core/fimComment.ts` written against
// the comment contract ONLY (plus goal fixes 3 and 4 and the
// two scout-notes sections behind them). This file has never read the
// implementation, has never read `src/core/fimInject.ts`, and must not be
// edited to make an implementation pass (AGENTS.md "Rules").
//
// The surface under test: commentSyntaxFor, cutIntroducedComment,
// cursorInComment, and the CommentSyntax / CommentCut / InCommentKind shapes.
// Nothing here names a helper, a regex or an internal step; every assertion is
// a property the contract states.
//
// The class this exists for: 189 of 749 ghosts introduce a comment, and the
// cheap fix - reach for `maskSpans` - reads `#` as a comment opener in every
// language, so it would eat a Rust `#[derive]`, a C# `#region` and a
// TypeScript private `#field`. The false-positive bars below are the point of
// the file: going dark on real code is worse than any ghost these rules remove.
//
// Expected RED until the module lands.
//
// Run: SKIP_LIVE=1 node --test test/blind-v25-comment.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "blind-v25-comment",
  `export { commentSyntaxFor, cutIntroducedComment, cursorInComment } from "../src/core/fimComment";\n`,
);
const { commentSyntaxFor, cutIntroducedComment, cursorInComment } = mod;
test.after(cleanup);

// ---- local mechanics for the assertions (never the module's) -------------

/** Resolve a row the table promises, failing loudly if it is missing. */
function syn(languageId) {
  const s = commentSyntaxFor(languageId);
  assert.ok(s, `the table must have a row for ${languageId}`);
  return s;
}

const cut = (languageId, text) => cutIntroducedComment(text, syn(languageId));
const inCmt = (languageId, prefix) => cursorInComment(prefix, syn(languageId));

// The contract's window, transcribed so the bound can be probed without
// asking the module for a constant it does not export.
const WINDOW_CHARS = 4000;

/** Marker-free, quote-free filler: `lines` lines of `width` letters. */
const filler = (lines, width = 60) => (`y`.repeat(width) + "\n").repeat(lines);

// The table, transcribed from contract-comment.md "The table".
const TABLE = [
  { line: "//", block: true, doc: false, ids: ["rust"] },
  {
    line: "//",
    block: true,
    doc: false,
    ids: ["typescript", "javascript", "typescriptreact", "javascriptreact"],
  },
  { line: "//", block: true, doc: false, ids: ["csharp"] },
  { line: "//", block: true, doc: false, ids: ["go"] },
  {
    line: "//",
    block: true,
    doc: false,
    ids: ["c", "cpp", "java", "kotlin", "swift", "scala", "php", "dart"],
  },
  { line: "#", block: false, doc: true, ids: ["python"] },
  {
    line: "#",
    block: false,
    doc: false,
    ids: [
      "ruby",
      "shellscript",
      "bash",
      "yaml",
      "perl",
      "r",
      "elixir",
      "powershell",
      "toml",
      "makefile",
      "dockerfile",
    ],
  },
  {
    line: "--",
    block: false,
    doc: false,
    ids: ["lua", "sql", "haskell", "elm", "ada"],
  },
  {
    line: ";",
    block: false,
    doc: false,
    ids: ["clojure", "lisp", "scheme", "racket"],
  },
];

const ALL_MAPPED_IDS = TABLE.flatMap((row) => row.ids);

// Real code in every mapped language that contains NO comment marker for that
// language. Every one of these must pass through byte-identically. This is the
// failure mode that matters: a false positive here is a ghost lost on code
// that never had a comment in it.
const MARKERLESS = [
  ["rust", "let x = 1;\nlet y = x + 2;\n"],
  ["typescript", "const x = 1;\nconst y = x + 2;\n"],
  ["javascript", "const x = 1;\nreturn x + 2;\n"],
  ["typescriptreact", "const x = 1;\nreturn <div>{x}</div>;\n"],
  ["javascriptreact", "const x = 1;\nreturn <div>{x}</div>;\n"],
  ["csharp", "var x = 1;\nvar y = x + 2;\n"],
  ["go", "x := 1\ny := x + 2\n"],
  ["c", "int x = 1;\nint y = x + 2;\n"],
  ["cpp", "auto x = 1;\nauto y = x + 2;\n"],
  ["java", "int x = 1;\nint y = x + 2;\n"],
  ["kotlin", "val x = 1\nval y = x + 2\n"],
  ["swift", "let x = 1\nlet y = x + 2\n"],
  ["scala", "val x = 1\nval y = x + 2\n"],
  ["php", "$x = 1;\n$y = $x + 2;\n"],
  ["dart", "var x = 1;\nvar y = x + 2;\n"],
  ["python", "x = 1\ny = x + 2\n"],
  ["ruby", "x = 1\nputs x\n"],
  ["shellscript", 'x=1\necho "$x"\n'],
  ["bash", 'x=1\necho "$x"\n'],
  ["yaml", "name: thing\nport: 8080\n"],
  ["perl", "my $x = 1;\n"],
  ["r", "x <- 1\n"],
  ["elixir", "x = 1\nIO.puts(x)\n"],
  ["powershell", "$x = 1\n"],
  ["toml", "port = 8080\n"],
  ["makefile", "all:\n\techo hi\n"],
  ["dockerfile", "RUN echo hi\n"],
  ["lua", "local x = 1\nreturn x\n"],
  ["sql", "select a from t where b = 1\n"],
  ["haskell", "f a = a + 1\n"],
  ["elm", "f a = a + 1\n"],
  ["ada", "X : Integer := 1;\n"],
  ["clojure", "(defn f [a] (+ a 1))\n"],
  ["lisp", "(defun f (a) (+ a 1))\n"],
  ["scheme", "(define (f a) (+ a 1))\n"],
  ["racket", "(define (f a) (+ a 1))\n"],
];

// Everything rule 1 is asked about anywhere in this file, for the totality and
// idempotence sweeps.
const CUT_CORPUS = [
  ...MARKERLESS,
  ["rust", "// compute the thing\nlet x = 1;\n"],
  ["rust", "let x = 1;\n// note\nlet y = 2;\n"],
  ["rust", "let x = 1; // note\nlet y = 2;\n"],
  ["rust", 'let s = "// not a comment";\n'],
  ["rust", "#[derive(Debug)]\nstruct S { a: u32 }\n"],
  ["rust", "fn longest<'a>(x: &'a str) -> &'a str { x } // pick x\n"],
  ["python", '    """Extract intrinsics from a projection matrix."""\n'],
  ["python", "x = 1\n# TODO: check if this is correct\ny = 2\n"],
  ["python", "q = 7 // 2\n"],
  ["python", 's = "# not a comment"\n'],
  ["csharp", "#region Serialization\nvar x = 1;\n"],
  ["typescript", "class A { #count = 0; }\n"],
  ["typescript", "const s = '// not a comment';\n"],
  ["go", "x := 1 // note\n"],
  ["rust", "/* compute the thing */\nlet x = 1;\n"],
  ["rust", "let x = 1; /* note */\nlet y = 2;\n"],
  ["rust", "let x = 1; /* note that never closes\n"],
  ["go", "x := 1\n/* note\n   over two lines */\ny := 2\n"],
  ["typescript", 'const s = "/* not a comment */";\n'],
  ["python", "x = 1 /* not a comment in python */\n"],
  ["lua", "local x = 1 -- note\n"],
  ["clojure", "(def x 1) ; note\n"],
  ["", ""],
  ["rust", ""],
  ["rust", "\n"],
];

// =========================================================================
// 1. The table
// =========================================================================

test("every languageId the table names resolves to a syntax", () => {
  for (const row of TABLE) {
    for (const id of row.ids) {
      const s = commentSyntaxFor(id);
      assert.ok(s, `${id} must resolve`);
      assert.ok(
        s.line.includes(row.line),
        `${id} must carry the line marker ${row.line}, got ${JSON.stringify(s.line)}`,
      );
    }
  }
});

test("a language with no row in the table resolves to undefined", () => {
  for (const id of ["plaintext", "json", "notalanguage", ""]) {
    assert.strictEqual(
      commentSyntaxFor(id),
      undefined,
      `${JSON.stringify(id)} is not in the table and must not be guessed at`,
    );
  }
});

test("only the languages the table gives block delimiters have them", () => {
  for (const row of TABLE) {
    for (const id of row.ids) {
      const s = syn(id);
      assert.strictEqual(
        s.block.length > 0,
        row.block,
        `${id} block delimiters`,
      );
    }
  }
});

test("python is the only language whose prose literals are comments", () => {
  for (const row of TABLE) {
    for (const id of row.ids) {
      const s = syn(id);
      assert.strictEqual(s.doc.length > 0, row.doc, `${id} doc openers`);
    }
  }
});

test("line markers are ordered longest first so the longer one wins", () => {
  for (const id of ALL_MAPPED_IDS) {
    const lens = syn(id).line.map((m) => m.length);
    const sorted = [...lens].sort((a, b) => b - a);
    assert.deepStrictEqual(lens, sorted, `${id} line markers must be ordered`);
  }
});

test("every mapped language carries at least one line marker and a quote", () => {
  for (const id of ALL_MAPPED_IDS) {
    const s = syn(id);
    assert.ok(s.line.length >= 1, `${id} needs a line marker`);
    assert.ok(Array.isArray(s.block), `${id} block must be an array`);
    assert.ok(Array.isArray(s.doc), `${id} doc must be an array`);
    assert.ok(s.quotes.includes('"'), `${id} must skip double-quoted strings`);
  }
});

test("rust reads // and /* */, has no prose literal, and no lifetime quote", () => {
  const s = syn("rust");
  assert.deepStrictEqual(s.line, ["//"]);
  assert.deepStrictEqual(
    s.block.map((p) => [p[0], p[1]]),
    [["/*", "*/"]],
  );
  assert.deepStrictEqual(s.doc, []);
  assert.ok(s.quotes.includes('"'));
  assert.ok(
    !s.quotes.includes("'"),
    "rust's ' is a lifetime tick, not a string delimiter",
  );
});

test("python reads # and both triple quotes, and has no block comment", () => {
  const s = syn("python");
  assert.deepStrictEqual(s.line, ["#"]);
  assert.deepStrictEqual(s.block, []);
  assert.deepStrictEqual([...s.doc].sort(), ['"""', "'''"].sort());
  assert.ok(s.quotes.includes('"'));
  assert.ok(s.quotes.includes("'"));
});

test("lua reads -- and nothing else", () => {
  const s = syn("lua");
  assert.deepStrictEqual(s.line, ["--"]);
  assert.deepStrictEqual(s.block, []);
  assert.deepStrictEqual(s.doc, []);
});

test("clojure reads ;", () => {
  const s = syn("clojure");
  assert.deepStrictEqual(s.line, [";"]);
  assert.deepStrictEqual(s.block, []);
  assert.deepStrictEqual(s.doc, []);
});

test("the whole TypeScript family answers the same as typescript", () => {
  const ts = syn("typescript");
  for (const id of ["javascript", "typescriptreact", "javascriptreact"]) {
    assert.deepStrictEqual(
      JSON.parse(JSON.stringify(syn(id))),
      JSON.parse(JSON.stringify(ts)),
      `${id} must not drift from typescript`,
    );
  }
  assert.deepStrictEqual(ts.line, ["//"]);
  assert.deepStrictEqual(
    ts.block.map((p) => [p[0], p[1]]),
    [["/*", "*/"]],
  );
  assert.deepStrictEqual(ts.doc, []);
});

// =========================================================================
// 2. Rule 1, comment-led
// =========================================================================

test("a ghost whose first content line is a comment serves nothing", () => {
  const cases = [
    ["rust", "// compute the thing\nlet x = 1;\n"],
    ["python", "# compute the thing\nx = 1\n"],
    ["go", "// compute the thing\nx := 1\n"],
    ["csharp", "// compute the thing\nvar x = 1;\n"],
    ["typescript", "// compute the thing\nconst x = 1;\n"],
  ];
  for (const [lang, text] of cases) {
    const r = cut(lang, text);
    assert.strictEqual(r.cut, "led", `${lang} cut`);
    assert.strictEqual(r.text, "", `${lang} must serve nothing`);
  }
});

test("indentation before the marker still makes the line comment-led", () => {
  const cases = [
    ["rust", "    // compute the thing\n    let x = 1;\n"],
    ["python", "    # compute the thing\n    x = 1\n"],
    ["go", "\t// compute the thing\n\tx := 1\n"],
  ];
  for (const [lang, text] of cases) {
    const r = cut(lang, text);
    assert.strictEqual(r.cut, "led", `${lang} cut`);
    assert.strictEqual(r.text, "", `${lang} must serve nothing`);
  }
});

test("a leading blank line does not save a comment-led ghost", () => {
  const r = cut("rust", "\n// compute the thing\nlet x = 1;\n");
  assert.strictEqual(r.cut, "led");
  assert.strictEqual(r.text, "", "nothing may survive, not even the blank");
});

test("a comment-led line past the first cuts the ghost before that line", () => {
  // Both cut kinds trimEnd the served text, so the caller never has to ask
  // which cut it got.
  const cases = [
    ["rust", "let x = 1;\n// note\nlet y = 2;\n", "let x = 1;"],
    ["python", "x = 1\n# TODO: check this\ny = 2\n", "x = 1"],
    ["go", "x := 1\n// note\ny := 2\n", "x := 1"],
    ["csharp", "var x = 1;\n// note\nvar y = 2;\n", "var x = 1;"],
    ["typescript", "const x = 1;\n// note\nconst y = 2;\n", "const x = 1;"],
  ];
  for (const [lang, text, kept] of cases) {
    const r = cut(lang, text);
    assert.strictEqual(r.cut, "led", `${lang} cut`);
    assert.strictEqual(r.text, kept, `${lang} kept text`);
  }
});

test("a led cut removes the trailing whitespace it leaves behind", () => {
  const r = cut("rust", "let x = 1;   \n\n  \n// note\nlet y = 2;\n");
  assert.strictEqual(r.cut, "led");
  assert.strictEqual(r.text, "let x = 1;");
});

test("an indented comment on a later line is led, not trailing", () => {
  const r = cut("rust", "let x = 1;\n    // note\nlet y = 2;\n");
  assert.strictEqual(r.cut, "led");
  assert.strictEqual(r.text, "let x = 1;");
});

test("a python docstring opening a content line is cut as led", () => {
  const cases = [
    '"""Extract intrinsics from a projection matrix."""\nreturn K\n',
    '    """Extract intrinsics from a projection matrix."""\n    return K\n',
    "    '''Extract intrinsics.'''\n    return K\n",
  ];
  for (const text of cases) {
    const r = cut("python", text);
    assert.strictEqual(r.cut, "led", JSON.stringify(text));
    assert.strictEqual(r.text, "", JSON.stringify(text));
  }
});

test("a python docstring opening a later line cuts before it", () => {
  const r = cut("python", "    x = 1\n    \"\"\"prose the model invented\"\"\"\n");
  assert.strictEqual(r.cut, "led");
  assert.strictEqual(r.text, "    x = 1", "indentation ahead of the code stays");
});

// Ruling, 2026-07-25: a block opener counts for rule 1 exactly as a line
// opener does. The rule is "the ghost never introduces a comment", and a block
// comment is a comment.

test("a block opener at the start of a content line is led", () => {
  const cases = [
    ["rust", "/* compute the thing */\nlet x = 1;\n"],
    ["csharp", "/* compute the thing */\nvar x = 1;\n"],
    ["typescript", "/**\n * compute the thing\n */\nconst x = 1;\n"],
    ["go", "/* compute the thing */\nx := 1\n"],
    ["rust", "    /* compute the thing */\n    let x = 1;\n"],
  ];
  for (const [lang, text] of cases) {
    const r = cut(lang, text);
    assert.strictEqual(r.cut, "led", `${lang}: ${JSON.stringify(text)}`);
    assert.strictEqual(r.text, "", `${lang}: ${JSON.stringify(text)}`);
  }
});

test("a block opener on a later line cuts the ghost before that line", () => {
  const cases = [
    ["rust", "let x = 1;\n/* note */\nlet y = 2;\n", "let x = 1;"],
    ["csharp", "var x = 1;\n/* note */\nvar y = 2;\n", "var x = 1;"],
    ["typescript", "const x = 1;\n/** doc */\nconst y = 2;\n", "const x = 1;"],
    ["go", "x := 1\n/* note\n   over two lines */\ny := 2\n", "x := 1"],
  ];
  for (const [lang, text, kept] of cases) {
    const r = cut(lang, text);
    assert.strictEqual(r.cut, "led", `${lang}: ${JSON.stringify(text)}`);
    assert.strictEqual(r.text, kept, `${lang}: ${JSON.stringify(text)}`);
  }
});

test("a block comment after code on a line is trailing", () => {
  const cases = [
    ["rust", "let x = 1; /* note */\n", "let x = 1;"],
    ["csharp", "var x = 1; /* note */\nvar y = 2;\n", "var x = 1;"],
    ["typescript", "const x = 1;  /* note */ const y = 2;\n", "const x = 1;"],
    ["go", "x := 1 /* note */\ny := 2\n", "x := 1"],
    // Unterminated: the cut takes the opener and everything after it anyway.
    ["rust", "let x = 1; /* note that never closes\nlet y = 2;\n", "let x = 1;"],
  ];
  for (const [lang, text, kept] of cases) {
    const r = cut(lang, text);
    assert.strictEqual(r.cut, "trailing", `${lang}: ${JSON.stringify(text)}`);
    assert.strictEqual(r.text, kept, `${lang}: ${JSON.stringify(text)}`);
  }
});

test("a block opener inside a string literal is not a comment", () => {
  const cases = [
    ["rust", 'let s = "/* not a comment */";\nlet t = 1;\n'],
    ["typescript", 'const s = "/* not a comment */";\n'],
    ["typescript", "const s = '/* not a comment */';\n"],
    ["csharp", 'var s = "/* not a comment */";\n'],
    ["go", 's := "/* not a comment */"\n'],
  ];
  for (const [lang, text] of cases) {
    const r = cut(lang, text);
    assert.strictEqual(r.cut, "none", `${lang}: ${JSON.stringify(text)}`);
    assert.strictEqual(r.text, text, `${lang}: ${JSON.stringify(text)}`);
  }
});

test("a block opener is inert in python, which has no block row", () => {
  for (const text of [
    "x = 1\n/* not a comment in python */\ny = 2\n",
    'p = "a/*b"\n',
    "x = 1 /* still not a comment */\n",
  ]) {
    const r = cut("python", text);
    assert.strictEqual(r.cut, "none", JSON.stringify(text));
    assert.strictEqual(r.text, text, JSON.stringify(text));
  }
});

test("a triple quote is not a comment outside python", () => {
  for (const lang of ["rust", "typescript", "csharp", "go"]) {
    const text = 'let s = """x""";\n';
    const r = cut(lang, text);
    assert.strictEqual(r.cut, "none", lang);
    assert.strictEqual(r.text, text, lang);
  }
});

// =========================================================================
// 3. Rule 1, trailing
// =========================================================================

test("a trailing comment keeps the code and drops the rest of the line", () => {
  const cases = [
    ["rust", "let x = 1; // note\n", "let x = 1;"],
    ["python", "x = 1  # note\n", "x = 1"],
    ["go", "x := 1 // note\n", "x := 1"],
    ["csharp", "var x = 1; // note\n", "var x = 1;"],
    ["typescript", "const x = 1; // note\n", "const x = 1;"],
    ["lua", "local x = 1 -- note\n", "local x = 1"],
    ["clojure", "(def x 1) ; note\n", "(def x 1)"],
  ];
  for (const [lang, text, kept] of cases) {
    const r = cut(lang, text);
    assert.strictEqual(r.cut, "trailing", `${lang} cut`);
    assert.strictEqual(r.text, kept, `${lang} kept text`);
  }
});

test("a trailing comment also drops every later line", () => {
  const r = cut("rust", "let x = 1; // note\nlet y = 2;\nlet z = 3;\n");
  assert.strictEqual(r.cut, "trailing");
  assert.strictEqual(r.text, "let x = 1;");
});

test("a trailing comment on a later line keeps the lines above it", () => {
  const r = cut("go", "x := 1\ny := 2 // note\nz := 3\n");
  assert.strictEqual(r.cut, "trailing");
  assert.strictEqual(r.text, "x := 1\ny := 2");
});

test("the whitespace a trailing cut leaves behind is trimmed", () => {
  const r = cut("rust", "let x = 1;   \t// note\n");
  assert.strictEqual(r.cut, "trailing");
  assert.strictEqual(r.text, "let x = 1;");
});

test("the first comment on the ghost decides the cut", () => {
  const r = cut("rust", "let x = 1; // note\n// a whole line of prose\n");
  assert.strictEqual(r.cut, "trailing");
  assert.strictEqual(r.text, "let x = 1;");
});

test("code with no comment in it is served unchanged and reports none", () => {
  const text = "let x = 1;\nlet y = x + 2;\n";
  const r = cut("rust", text);
  assert.strictEqual(r.cut, "none");
  assert.strictEqual(r.text, text);
});

// =========================================================================
// 4. The named bars
// =========================================================================

test("a comment marker inside a string literal is not a comment", () => {
  const cases = [
    ["rust", 'let s = "// not a comment";\n'],
    ["typescript", 'const s = "// not a comment";\n'],
    ["csharp", 'var s = "// not a comment";\n'],
    ["go", 's := "// not a comment"\n'],
    ["python", 's = "# not a comment"\n'],
  ];
  for (const [lang, text] of cases) {
    const r = cut(lang, text);
    assert.strictEqual(r.cut, "none", `${lang} must not cut a string`);
    assert.strictEqual(r.text, text, `${lang} must survive intact`);
  }
});

test("a single-quoted string hides a marker where ' is a quote", () => {
  const cases = [
    ["typescript", "const s = '// not a comment';\n"],
    ["csharp", "var s = '#';\nvar t = 1;\n"],
    ["python", "s = '# not a comment'\n"],
  ];
  for (const [lang, text] of cases) {
    const r = cut(lang, text);
    assert.strictEqual(r.cut, "none", lang);
    assert.strictEqual(r.text, text, lang);
  }
});

test("a rust lifetime tick does not hide the comment that follows it", () => {
  const r = cut("rust", "fn longest<'a>(x: &'a str) -> &'a str { x } // pick x\n");
  assert.strictEqual(r.cut, "trailing");
  assert.strictEqual(r.text, "fn longest<'a>(x: &'a str) -> &'a str { x }");
});

test("a rust attribute is not a comment", () => {
  const text = "#[derive(Debug, Clone)]\npub struct S { a: u32 }\n";
  const r = cut("rust", text);
  assert.strictEqual(r.cut, "none");
  assert.strictEqual(r.text, text);
});

test("a csharp preprocessor directive is not a comment", () => {
  for (const text of [
    "#region Serialization\nvar x = 1;\n",
    "#nullable enable\nvar x = 1;\n",
    "var x = 1;\n#endregion\n",
  ]) {
    const r = cut("csharp", text);
    assert.strictEqual(r.cut, "none", text);
    assert.strictEqual(r.text, text, text);
  }
});

test("a typescript private field is not a comment", () => {
  for (const text of [
    "class A {\n  #count = 0;\n}\n",
    "#count = 0;\nreturn this.#count;\n",
  ]) {
    const r = cut("typescript", text);
    assert.strictEqual(r.cut, "none", text);
    assert.strictEqual(r.text, text, text);
  }
});

test("# is inert in every language whose line marker is not #", () => {
  const nonHash = TABLE.filter((row) => row.line !== "#").flatMap((r) => r.ids);
  for (const id of nonHash) {
    const text = "a #b c\n";
    const r = cut(id, text);
    assert.strictEqual(r.cut, "none", `${id} must not read # as a comment`);
    assert.strictEqual(r.text, text, id);
  }
});

test("// is inert in python, where floor division is not a comment", () => {
  for (const text of ["q = 7 // 2\n", 'p = "a//b"\n', "q = a // b\nr = q + 1\n"]) {
    const r = cut("python", text);
    assert.strictEqual(r.cut, "none", text);
    assert.strictEqual(r.text, text, text);
  }
});

test("# inside a rust string is not a comment", () => {
  const text = 'let s = "#not a comment";\nlet t = 1;\n';
  const r = cut("rust", text);
  assert.strictEqual(r.cut, "none");
  assert.strictEqual(r.text, text);
});

test("-- is inert outside the -- languages", () => {
  const text = "let x = a--;\n";
  const r = cut("rust", text);
  assert.strictEqual(r.cut, "none");
  assert.strictEqual(r.text, text);
});

// =========================================================================
// 5. Rule 2: dark inside a comment
// =========================================================================

test("a cursor inside a line comment is in a comment", () => {
  const cases = [
    ["rust", "let x = 1;\n// the note the developer is "],
    ["rust", "/// Like run_history_checks but "],
    ["python", "x = 1\n# the note the developer is "],
    ["go", "// the note the developer is "],
    ["csharp", "// the note the developer is "],
    ["typescript", "const x = 1; // the note "],
    ["lua", "-- the note "],
    ["clojure", "; the note "],
  ];
  for (const [lang, prefix] of cases) {
    const r = inCmt(lang, prefix);
    assert.strictEqual(r.inComment, true, `${lang}: ${prefix}`);
    assert.strictEqual(r.kind, "line", `${lang}: ${prefix}`);
    assert.strictEqual(r.windowExhausted, false, `${lang}: ${prefix}`);
  }
});

test("a cursor inside a block comment spanning lines is in a comment", () => {
  const cases = [
    ["rust", "/*\n * the note the developer is \n * still "],
    ["go", "x := 1\n/* the note\n   continues "],
    ["csharp", "/* the note\n   continues "],
    ["typescript", "/**\n * @param a the "],
  ];
  for (const [lang, prefix] of cases) {
    const r = inCmt(lang, prefix);
    assert.strictEqual(r.inComment, true, `${lang}: ${prefix}`);
    assert.strictEqual(r.kind, "block", `${lang}: ${prefix}`);
    assert.strictEqual(r.windowExhausted, false, `${lang}: ${prefix}`);
  }
});

test("a cursor inside a python docstring is in a comment", () => {
  for (const prefix of [
    'def f(m):\n    """Extract intrinsics from ',
    "def f(m):\n    '''Extract intrinsics from ",
    'def f(m):\n    """Extract intrinsics.\n\n    Args:\n        m: the ',
  ]) {
    const r = inCmt("python", prefix);
    assert.strictEqual(r.inComment, true, prefix);
    assert.strictEqual(r.kind, "doc", prefix);
    assert.strictEqual(r.windowExhausted, false, prefix);
  }
});

test("a cursor before the comment on its own line is not in a comment", () => {
  // `let x = 1; // note` with the cursor at column 5: the comment is ahead of
  // the cursor, so the developer is writing code and still gets a ghost.
  const r = inCmt("rust", "let x");
  assert.strictEqual(r.inComment, false);
  assert.strictEqual(r.windowExhausted, false);
});

test("a comment marker inside a string on the cursor line does not go dark", () => {
  const cases = [
    ["rust", 'let s = "// not a comment"; let t = '],
    ["typescript", "const s = '// not a comment'; const t = "],
    ["csharp", 'var s = "// not a comment"; var t = '],
    ["go", 's := "// not a comment"\nt := '],
    ["python", 's = "# not a comment"\nt = '],
  ];
  for (const [lang, prefix] of cases) {
    const r = inCmt(lang, prefix);
    assert.strictEqual(r.inComment, false, `${lang}: ${prefix}`);
  }
});

test("# on the cursor line does not go dark outside the # languages", () => {
  const cases = [
    ["rust", "#[derive(Debug)]\nstruct S { a: "],
    ["csharp", "#region Serialization\nvar x = "],
    ["typescript", "class A {\n  #count = "],
  ];
  for (const [lang, prefix] of cases) {
    const r = inCmt(lang, prefix);
    assert.strictEqual(r.inComment, false, `${lang}: ${prefix}`);
  }
});

test("// on a python line does not go dark", () => {
  const r = inCmt("python", "q = 7 // ");
  assert.strictEqual(r.inComment, false);
});

test("a closed block comment above the cursor leaves the cursor in code", () => {
  const cases = [
    ["rust", "/* a note */\nlet x = "],
    ["go", "/* a note\n   over two lines */\nx := "],
    ["csharp", "/** doc */\npublic int F() { return "],
  ];
  for (const [lang, prefix] of cases) {
    const r = inCmt(lang, prefix);
    assert.strictEqual(r.inComment, false, `${lang}: ${prefix}`);
    assert.strictEqual(r.windowExhausted, false, `${lang}: ${prefix}`);
  }
});

test("a closed python docstring above the cursor leaves the cursor in code", () => {
  for (const prefix of [
    'def f(m):\n    """Extract intrinsics."""\n    return ',
    'def f(m):\n    """Extract intrinsics.\n\n    Args:\n        m: matrix\n    """\n    return ',
  ]) {
    const r = inCmt("python", prefix);
    assert.strictEqual(r.inComment, false, prefix);
    assert.strictEqual(r.windowExhausted, false, prefix);
  }
});

test("a line comment ends at its own newline and never carries down", () => {
  const cases = [
    ["rust", "// a note\nlet x = "],
    ["python", "# a note\nx = "],
    ["lua", "-- a note\nlocal x = "],
    ["clojure", "; a note\n(def x "],
  ];
  for (const [lang, prefix] of cases) {
    const r = inCmt(lang, prefix);
    assert.strictEqual(r.inComment, false, `${lang}: ${prefix}`);
  }
});

// =========================================================================
// 6. The window
// =========================================================================

test("a block comment opened above the window is reported, not guessed", () => {
  // The opener sits well past 4000 characters back, so the scan cannot see it.
  // The contract's deliberate bias is to serve, and to say the answer was a
  // guess so the caller can tell.
  const prefix = "/* the long note\n" + filler(100) + "still writing ";
  assert.ok(prefix.length > WINDOW_CHARS + 1000, "fixture must exhaust it");
  const r = inCmt("go", prefix);
  assert.strictEqual(r.windowExhausted, true, "the flag must say it was a guess");
  assert.strictEqual(r.inComment, false, "the bias is toward serving");
});

test("a docstring opened above the window is reported, not guessed", () => {
  const prefix = '"""the long note\n' + filler(100) + "still writing ";
  const r = inCmt("python", prefix);
  assert.strictEqual(r.windowExhausted, true);
  assert.strictEqual(r.inComment, false);
});

test("a block comment opened just inside the window is still detected", () => {
  // 60 lines of 61 characters is ~3.7k, so the opener is inside the bound.
  // The bound is a window, not a cliff.
  const body = filler(60);
  const prefix = "/* the long note\n" + body + "still writing ";
  assert.ok(prefix.length < WINDOW_CHARS, "fixture must fit the window");
  const r = inCmt("go", prefix);
  assert.strictEqual(r.inComment, true);
  assert.strictEqual(r.kind, "block");
});

test("a line comment on the cursor line is decided inside any long prefix", () => {
  // Rule 2 says a line comment is decided on the cursor's own line alone, so a
  // prefix far longer than the window never makes it ambiguous.
  const prefix = filler(200) + "// the note the developer is ";
  const r = inCmt("rust", prefix);
  assert.strictEqual(r.inComment, true);
  assert.strictEqual(r.kind, "line");
});

// =========================================================================
// 7. Idempotence and totality
// =========================================================================

test("cutting an already cut ghost changes nothing", () => {
  for (const [lang, text] of CUT_CORPUS) {
    const s = commentSyntaxFor(lang);
    if (!s) continue;
    const once = cutIntroducedComment(text, s);
    const twice = cutIntroducedComment(once.text, s);
    assert.strictEqual(twice.text, once.text, `${lang}: ${JSON.stringify(text)}`);
    assert.strictEqual(twice.cut, "none", `${lang}: ${JSON.stringify(text)}`);
  }
});

test("the cut never lengthens the served text", () => {
  for (const [lang, text] of CUT_CORPUS) {
    const s = commentSyntaxFor(lang);
    if (!s) continue;
    const r = cutIntroducedComment(text, s);
    assert.ok(
      r.text.length <= text.length,
      `${lang}: ${JSON.stringify(text)} grew to ${JSON.stringify(r.text)}`,
    );
    assert.ok(
      ["none", "led", "trailing"].includes(r.cut),
      `${lang}: cut must be one of the three, got ${JSON.stringify(r.cut)}`,
    );
  }
});

test("empty and blank text are served unchanged and report no cut", () => {
  for (const text of ["", "\n", "   ", "\n\n  \n"]) {
    const r = cut("rust", text);
    assert.strictEqual(r.cut, "none", JSON.stringify(text));
    assert.strictEqual(r.text, text, JSON.stringify(text));
  }
});

test("a cursor at the very start of a document is not in a comment", () => {
  for (const lang of ["rust", "python", "go", "csharp", "typescript", "lua"]) {
    const r = inCmt(lang, "");
    assert.strictEqual(r.inComment, false, lang);
    assert.strictEqual(r.windowExhausted, false, lang);
  }
});

test("a cursor in ordinary code is not in a comment in any language", () => {
  for (const [lang, text] of MARKERLESS) {
    const r = inCmt(lang, text);
    assert.strictEqual(r.inComment, false, `${lang}: ${JSON.stringify(text)}`);
  }
});

// =========================================================================
// 8. The property that matters: no false positives on marker-free code
// =========================================================================

test("code with no marker for its language passes through byte-identically", () => {
  for (const [lang, text] of MARKERLESS) {
    const r = cut(lang, text);
    assert.strictEqual(
      r.text,
      text,
      `${lang} lost real code: ${JSON.stringify(r.text)}`,
    );
    assert.strictEqual(r.cut, "none", `${lang}: ${JSON.stringify(text)}`);
  }
});

test("a marker for one language never cuts a different language", () => {
  // Every marker in the table, tried against every language that does not own
  // it. The cross product is the shape of the `maskSpans` regression.
  const MARKERS = ["#", "//", "--", ";", '"""', "/*"];
  for (const id of ALL_MAPPED_IDS) {
    const s = syn(id);
    const owned = new Set([...s.line, ...s.doc, ...s.block.map((p) => p[0])]);
    for (const marker of MARKERS) {
      if (owned.has(marker)) continue;
      const text = `a ${marker} b\n`;
      const r = cutIntroducedComment(text, s);
      assert.strictEqual(
        r.text,
        text,
        `${id} cut on ${marker}, which it does not own`,
      );
      assert.strictEqual(r.cut, "none", `${id} on ${marker}`);
    }
  }
});
