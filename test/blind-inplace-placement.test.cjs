// Blind oracle: placeGeneratedReply, the one function that puts a model's reply
// at the target's column. Written from the written contract only, no src/** read.
//
// The bug this guards: the prompt shows the model written code and asks for what
// goes under it, so models frequently reply ALREADY INDENTED. Adding the target's
// indent to those bytes landed the definition a level deep, which is an
// IndentationError in Python and a silently over-indented body everywhere else.
// So the load-bearing property is: flush-left reply and in-place reply, same
// bytes out. Columns are asserted exactly, because "it parses" does not catch a
// body one level too deep.
//
// Run: SKIP_LIVE=1 node --test test/blind-inplace-placement.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { execFileSync } = require("child_process");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "blind-inplace-placement",
  `export { placeGeneratedReply } from "../src/core/placeReply";\n`,
);
const { placeGeneratedReply } = mod;
test.after(cleanup);

const L = (...parts) => parts.join("\n");
const place = (text, placement) => placeGeneratedReply(text, placement);

// The leading whitespace of every line, so a failure names the column instead of
// making a human count spaces in a diff.
const columns = (text) => text.split("\n").map((l) => /^[ \t]*/.exec(l)[0]);

// A model "answering in place" writes its lines where the header it was shown
// sits: a uniform prefix on the code lines, blanks left blank.
const inPlace = (text, prefix) =>
  text.split("\n").map((l) => (l.trim() === "" ? l : prefix + l)).join("\n");

let pythonOk = true;
try {
  execFileSync("python3", ["-c", "import ast"], { stdio: "ignore" });
} catch {
  pythonOk = false;
}
const pyParses = (src) => {
  try {
    execFileSync("python3", ["-c", "import ast,sys; ast.parse(sys.stdin.read())"], {
      input: src,
      stdio: ["pipe", "ignore", "pipe"],
    });
    return true;
  } catch {
    return false;
  }
};

// ===== Clause 1: whole-definition placement, exact bytes =====================
// First line flush (the document already holds the header indent at the splice
// point), every later code line at headerIndent + its depth relative to the head.

const DEFINITION = [
  // ---- C# -----------------------------------------------------------------
  {
    name: "csharp: flush-left method into a 4-space class body",
    why: "the baseline shape, Allman braces",
    lang: "csharp",
    headerIndent: "    ",
    reply: L("public int Add(int a, int b)", "{", "    return a + b;", "}"),
    want: L("public int Add(int a, int b)", "    {", "        return a + b;", "    }"),
  },
  {
    name: "csharp: the SAME method written in place at col 4",
    why: "the whole point: an already-indented reply must not stack a second level",
    lang: "csharp",
    headerIndent: "    ",
    reply: L("    public int Add(int a, int b)", "    {", "        return a + b;", "    }"),
    want: L("public int Add(int a, int b)", "    {", "        return a + b;", "    }"),
  },
  {
    name: "csharp: K&R brace on the head line",
    why: "the head line carrying an open brace must not change how depth is measured",
    lang: "csharp",
    headerIndent: "    ",
    reply: L("public int Add(int a, int b) {", "    return a + b;", "}"),
    want: L("public int Add(int a, int b) {", "        return a + b;", "    }"),
  },
  {
    name: "csharp: tab-indented target and tab-indented reply, answered in place",
    why: "tabs must be carried as bytes, not converted to a space column",
    lang: "csharp",
    headerIndent: "\t\t",
    reply: L("\t\tpublic void M()", "\t\t{", "\t\t\tCall();", "\t\t}"),
    want: L("public void M()", "\t\t{", "\t\t\tCall();", "\t\t}"),
  },
  {
    name: "csharp: nested class inside the reply",
    why: "internal structure keeps its relative depth, every level shifts by the same amount",
    lang: "csharp",
    headerIndent: "    ",
    reply: L(
      "public class Outer",
      "{",
      "    public class Inner",
      "    {",
      "        public int V() => 1;",
      "    }",
      "}",
    ),
    want: L(
      "public class Outer",
      "    {",
      "        public class Inner",
      "        {",
      "            public int V() => 1;",
      "        }",
      "    }",
    ),
  },
  {
    name: "csharp: verbatim string holding a comment token and braces",
    why: "those bytes are the string's VALUE, shifting them changes the program's output",
    lang: "csharp",
    headerIndent: "    ",
    reply: L(
      "public string Banner()",
      "{",
      "    return @\"",
      "// not a comment",
      "  { not a block }",
      "\";",
      "}",
    ),
    want: L(
      "public string Banner()",
      "    {",
      "        return @\"",
      "// not a comment",
      "  { not a block }",
      "\";",
      "    }",
    ),
  },
  {
    name: "csharp: raw string literal interior stays byte-exact",
    why: "C# raw strings strip against the closing delimiter, so a shifted interior changes the value",
    lang: "csharp",
    headerIndent: "    ",
    reply: L("public string Doc()", "{", "    return \"\"\"", "line one", "  line two", "\"\"\";", "}"),
    want: L("public string Doc()", "    {", "        return \"\"\"", "line one", "  line two", "\"\"\";", "    }"),
  },
  {
    name: "csharp: a head with no body (multi-line signature only)",
    why: "an abstract/interface member is all head, there is no block to measure against",
    lang: "csharp",
    headerIndent: "    ",
    reply: L("public int Add(", "    int a,", "    int b);"),
    want: L("public int Add(", "        int a,", "        int b);"),
  },
  {
    name: "csharp: single-line reply is returned untouched",
    why: "with no later lines there is nothing to indent, whatever headerIndent says",
    lang: "csharp",
    headerIndent: "        ",
    reply: "public int Value { get; set; }",
    want: "public int Value { get; set; }",
  },
  {
    name: "csharp: CRLF reply keeps its carriage returns",
    why: "splitting on /\\r?\\n/ and rejoining with \\n silently rewrites a CRLF file",
    lang: "csharp",
    headerIndent: "    ",
    reply: "public int Add()\r\n{\r\n\treturn 1;\r\n}",
    want: "public int Add()\r\n    {\r\n    \treturn 1;\r\n    }",
  },
  {
    name: "csharp: CRLF blank line stays a bare CR, never indented whitespace",
    why: "clause 3, and a CRLF blank line is the shape most likely to collect trailing spaces",
    lang: "csharp",
    headerIndent: "    ",
    reply: "public int Add()\r\n{\r\n    var x = 1;\r\n\r\n    return x;\r\n}",
    want: "public int Add()\r\n    {\r\n        var x = 1;\r\n\r\n        return x;\r\n    }",
  },

  // ---- Rust ---------------------------------------------------------------
  {
    name: "rust: flush-left fn into a 4-space impl block",
    why: "the baseline shape",
    lang: "rust",
    headerIndent: "    ",
    reply: L("fn add(a: i32, b: i32) -> i32 {", "    a + b", "}"),
    want: L("fn add(a: i32, b: i32) -> i32 {", "        a + b", "    }"),
  },
  {
    name: "rust: the SAME fn written in place at col 4",
    why: "in-place reply, identical bytes required",
    lang: "rust",
    headerIndent: "    ",
    reply: L("    fn add(a: i32, b: i32) -> i32 {", "        a + b", "    }"),
    want: L("fn add(a: i32, b: i32) -> i32 {", "        a + b", "    }"),
  },
  {
    name: "rust: nested fn and a closure",
    why: "closures and inner fns are the shapes where a per-line reindent goes wrong quietly",
    lang: "rust",
    headerIndent: "    ",
    reply: L(
      "fn outer(v: Vec<i32>) -> i32 {",
      "    fn inner(x: i32) -> i32 {",
      "        x + 1",
      "    }",
      "    let f = |y: i32| -> i32 {",
      "        inner(y)",
      "    };",
      "    v.iter().map(|&x| f(x)).sum()",
      "}",
    ),
    want: L(
      "fn outer(v: Vec<i32>) -> i32 {",
      "        fn inner(x: i32) -> i32 {",
      "            x + 1",
      "        }",
      "        let f = |y: i32| -> i32 {",
      "            inner(y)",
      "        };",
      "        v.iter().map(|&x| f(x)).sum()",
      "    }",
    ),
  },
  {
    name: "rust: raw string r#\"...\"# holding a comment token and braces",
    why: "raw-string bytes are the value, and // inside one is not a comment",
    lang: "rust",
    headerIndent: "    ",
    reply: L("fn banner() -> &'static str {", "    r#\"", "// not a comment", "  { braces }", "\"#", "}"),
    want: L("fn banner() -> &'static str {", "        r#\"", "// not a comment", "  { braces }", "\"#", "    }"),
  },
  {
    name: "rust: normal multi-line string literal interior stays put",
    why: "a plain \"...\" spanning lines is still a literal, not code to reindent",
    lang: "rust",
    headerIndent: "    ",
    reply: L("fn s() -> &'static str {", "    \"line one", "line two\"", "}"),
    want: L("fn s() -> &'static str {", "        \"line one", "line two\"", "    }"),
  },
  {
    name: "rust: tab-indented target, flush-left reply with tab bodies",
    why: "mixing a tab headerIndent with a tab reply must concatenate, not average",
    lang: "rust",
    headerIndent: "\t",
    reply: L("fn m(&mut self) {", "\tself.x = 1;", "}"),
    want: L("fn m(&mut self) {", "\t\tself.x = 1;", "\t}"),
  },

  // ---- TypeScript / JavaScript --------------------------------------------
  {
    name: "typescript: method into a 2-space class body",
    why: "the baseline shape for the 2-space half of the world",
    lang: "typescript",
    headerIndent: "  ",
    reply: L("add(a: number, b: number): number {", "  return a + b;", "}"),
    want: L("add(a: number, b: number): number {", "    return a + b;", "  }"),
  },
  {
    name: "typescript: a 2-space reply into an 8-space target",
    why: "relative depth is preserved literally, the reply's unit is not rescaled to the file's",
    lang: "typescript",
    headerIndent: "        ",
    reply: L("function f(): number {", "  return 1;", "}"),
    want: L("function f(): number {", "          return 1;", "        }"),
  },
  {
    name: "typescript: template literal holding a comment token and braces",
    why: "backtick contents are the string's value, a shift changes rendered output",
    lang: "typescript",
    headerIndent: "    ",
    reply: L("function banner(): string {", "  return `", "// not a comment", "  { braces }", "`;", "}"),
    want: L("function banner(): string {", "      return `", "// not a comment", "  { braces }", "`;", "    }"),
  },
  {
    name: "typescriptreact: registered like typescript",
    why: ".tsx is a distinct languageId and must not fall through to the unchanged path",
    lang: "typescriptreact",
    headerIndent: "  ",
    reply: L("function Badge() {", "  return <b>hi</b>;", "}"),
    want: L("function Badge() {", "    return <b>hi</b>;", "  }"),
  },
  {
    name: "javascript: nested arrow function",
    why: "an inner lambda's body is two levels down and must stay two levels down",
    lang: "javascript",
    headerIndent: "    ",
    reply: L("function outer(xs) {", "  const f = (y) => {", "    return y * 2;", "  };", "  return xs.map(f);", "}"),
    want: L(
      "function outer(xs) {",
      "      const f = (y) => {",
      "        return y * 2;",
      "      };",
      "      return xs.map(f);",
      "    }",
    ),
  },
  {
    name: "javascriptreact: registered like javascript",
    why: ".jsx is a distinct languageId",
    lang: "javascriptreact",
    headerIndent: "  ",
    reply: L("const A = () => {", "  return null;", "};"),
    want: L("const A = () => {", "    return null;", "  };"),
  },

  // ---- Python (whole definition, NOT bodyOnly) -----------------------------
  {
    name: "python: flush-left method into a 4-space class body",
    why: "the baseline shape",
    lang: "python",
    headerIndent: "    ",
    reply: L("def add(self, a, b):", "    return a + b"),
    want: L("def add(self, a, b):", "        return a + b"),
  },
  {
    name: "python: the SAME method written in place at col 4",
    why: "this is the shape that produced the IndentationError in the field",
    lang: "python",
    headerIndent: "    ",
    reply: L("    def add(self, a, b):", "        return a + b"),
    want: L("def add(self, a, b):", "        return a + b"),
  },
  {
    name: "python: nested class and method",
    why: "three levels of relative depth must all shift by exactly headerIndent",
    lang: "python",
    headerIndent: "    ",
    reply: L("class Outer:", "    class Inner:", "        def v(self):", "            return 1"),
    want: L("class Outer:", "        class Inner:", "            def v(self):", "                return 1"),
  },
  {
    name: "python: nested function and a lambda",
    why: "an inner def is the shape a naive per-line reindent flattens",
    lang: "python",
    headerIndent: "    ",
    reply: L(
      "def outer(xs):",
      "    def inner(y):",
      "        return y + 1",
      "    f = lambda z: inner(z) * 2",
      "    return [f(x) for x in xs]",
    ),
    want: L(
      "def outer(xs):",
      "        def inner(y):",
      "            return y + 1",
      "        f = lambda z: inner(z) * 2",
      "        return [f(x) for x in xs]",
    ),
  },
  {
    name: "python: triple-quoted string holding a comment token and braces",
    why: "a # inside a string is not a comment and its column is part of the value",
    lang: "python",
    headerIndent: "    ",
    reply: L("def banner():", "    text = \"\"\"", "# not a comment", "  { braces }", "\"\"\"", "    return text"),
    want: L("def banner():", "        text = \"\"\"", "# not a comment", "  { braces }", "\"\"\"", "        return text"),
  },
  {
    name: "python: tab-indented target and tab reply",
    why: "tab files exist and a tab must not be measured as one space",
    lang: "python",
    headerIndent: "\t",
    reply: L("def m(self):", "\treturn 1"),
    want: L("def m(self):", "\t\treturn 1"),
  },
  {
    name: "python: a 2-space reply into an 8-space target",
    why: "relative depth is preserved literally, so the body lands at 8+2",
    lang: "python",
    headerIndent: "        ",
    reply: L("def f():", "  return 1"),
    want: L("def f():", "          return 1"),
  },
  {
    name: "python: single-line def is returned untouched",
    why: "no later lines, nothing to place",
    lang: "python",
    headerIndent: "    ",
    reply: "def f(): return 1",
    want: "def f(): return 1",
  },
  {
    name: "python: blank line inside the body stays empty, not whitespace",
    why: "clause 3, a whitespace-only line is a lint failure the human then has to clean",
    lang: "python",
    headerIndent: "    ",
    reply: L("def add(a, b):", "    total = a + b", "", "    return total"),
    want: L("def add(a, b):", "        total = a + b", "", "        return total"),
  },
];

for (const c of DEFINITION) {
  test(`definition placement: ${c.name}`, () => {
    const got = place(c.reply, { languageId: c.lang, headerIndent: c.headerIndent });
    assert.strictEqual(got, c.want, `${c.why}\n--- got ---\n${got}\n--- want ---\n${c.want}`);
    assert.strictEqual(
      /^[ \t]*/.exec(got)[0],
      "",
      "clause 1: the returned first line carries no indentation, the document already holds it",
    );
  });
}

// ===== Landed columns, named explicitly =====================================
// Exact bytes above already pin these, but a column list is what a human reads
// when a row goes red: "body at 12, wanted 8" instead of counting spaces.

const COLUMN_ROWS = [
  {
    name: "csharp method at a 4-space header",
    lang: "csharp",
    headerIndent: "    ",
    reply: L("    public int Add(int a, int b)", "    {", "        return a + b;", "    }"),
    wantCols: ["", "    ", "        ", "    "],
  },
  {
    name: "rust fn at a 4-space header",
    lang: "rust",
    headerIndent: "    ",
    reply: L("    fn add(a: i32) -> i32 {", "        a + 1", "    }"),
    wantCols: ["", "        ", "    "],
  },
  {
    name: "typescript method at a 2-space header",
    lang: "typescript",
    headerIndent: "  ",
    reply: L("  add(a: number): number {", "    return a;", "  }"),
    wantCols: ["", "    ", "  "],
  },
  {
    name: "python method at a 4-space header",
    lang: "python",
    headerIndent: "    ",
    reply: L("    def add(self, a):", "        return a"),
    wantCols: ["", "        "],
  },
  {
    name: "javascript at an 8-space header, 2-space reply",
    lang: "javascript",
    headerIndent: "        ",
    reply: L("function f() {", "  return 1;", "}"),
    wantCols: ["", "          ", "        "],
  },
];

for (const c of COLUMN_ROWS) {
  test(`landed columns: ${c.name}`, () => {
    const got = place(c.reply, { languageId: c.lang, headerIndent: c.headerIndent });
    assert.deepStrictEqual(columns(got), c.wantCols, `columns wrong, got:\n${got}`);
  });
}

// ===== Clause 1's equivalence property ======================================
// Flush-left reply and the same reply written in place must be byte-identical
// out. Replies here hold no multi-line strings on purpose: prefixing a string's
// interior would make it a genuinely different program, not the same reply.

const EQUIV = [
  ["csharp", "    ", L("public int Add(int a, int b)", "{", "    return a + b;", "}")],
  ["csharp", "\t", L("public void M()", "{", "\tCall();", "}")],
  ["rust", "    ", L("fn add(a: i32, b: i32) -> i32 {", "    a + b", "}")],
  ["typescript", "  ", L("add(a: number): number {", "  return a;", "}")],
  ["typescriptreact", "  ", L("function A() {", "  return null;", "}")],
  ["javascript", "    ", L("function f(xs) {", "  return xs.map((x) => x + 1);", "}")],
  ["javascriptreact", "  ", L("const A = () => {", "  return null;", "};")],
  ["python", "    ", L("def add(self, a, b):", "    total = a + b", "", "    return total")],
  ["python", "\t", L("def m(self):", "\tif self.x:", "\t\treturn 1", "\treturn 0")],
];

for (const [lang, headerIndent, flush] of EQUIV) {
  test(`in-place equivalence: ${lang} at ${JSON.stringify(headerIndent)}`, () => {
    const a = place(flush, { languageId: lang, headerIndent });
    // The realistic shape: the model wrote its reply where the header it was shown sits.
    const b = place(inPlace(flush, headerIndent), { languageId: lang, headerIndent });
    assert.strictEqual(b, a, `an in-place reply must place identically\n--- in place ---\n${b}\n--- flush ---\n${a}`);
    // And any other uniform prefix, since the rule is "strip the reply's own base".
    const c = place(inPlace(flush, "      "), { languageId: lang, headerIndent });
    assert.strictEqual(c, a, `a reply at an unrelated base must place identically, got:\n${c}`);
  });
}

// ===== Clause 3: blank lines stay byte-exact ================================
// Interior and trailing blanks are where a "prefix every line" loop leaves
// whitespace-only lines behind.

const BLANKS = [
  [
    "csharp",
    "    ",
    L("public int Add()", "{", "", "    return 1;", "", "}", ""),
    L("public int Add()", "    {", "", "        return 1;", "", "    }", ""),
  ],
  [
    "python",
    "    ",
    L("def add(a, b):", "", "    return a + b", "", ""),
    L("def add(a, b):", "", "        return a + b", "", ""),
  ],
  ["rust", "  ", L("fn f() -> i32 {", "", "    1", "", "}", ""), L("fn f() -> i32 {", "", "      1", "", "  }", "")],
  [
    "typescript",
    "    ",
    L("function f() {", "", "  return 1;", "", "}", ""),
    L("function f() {", "", "      return 1;", "", "    }", ""),
  ],
];

for (const [lang, headerIndent, reply, want] of BLANKS) {
  test(`blank lines: ${lang} reply with interior and trailing blanks`, () => {
    const got = place(reply, { languageId: lang, headerIndent });
    assert.strictEqual(got, want, `blanks stay empty, code keeps its columns\n--- got ---\n${got}`);
    for (const line of got.split("\n")) {
      if (line.trim() === "") {
        assert.strictEqual(line, "", "clause 3: a blank line must stay empty, never whitespace-only");
      }
    }
  });
}

// A model that opens its reply with a blank line is common (it starts the code
// block on a fresh line). The base indent must come from the DECLARATION HEAD,
// which is the first non-blank line, not from whatever sits at line 0. If line 0
// decides, an in-place reply keeps its own indent AND collects headerIndent at
// the splice, which is the double indent this whole function exists to prevent.

const LEADING_BLANK = [
  ["csharp", "    ", L("public int Add()", "{", "    return 1;", "}")],
  ["rust", "    ", L("fn add(a: i32) -> i32 {", "    a + 1", "}")],
  ["typescript", "  ", L("add(a: number): number {", "  return a;", "}")],
  ["javascript", "    ", L("function f() {", "  return 1;", "}")],
  ["python", "    ", L("def add(self, a):", "    return a")],
];

for (const [lang, headerIndent, body] of LEADING_BLANK) {
  // RE-CUT after review. "The document holds the indent" is true of the physical
  // FIRST line, which is the one that lands at the splice point. A blank line
  // ahead of the head moves the head to a fresh line, where the document holds
  // nothing, so the head has to carry the target's indent itself. Asserting it
  // lands flush would put a Python method at column 0 and quietly take it out of
  // its class; the row below proves that with the compiler rather than a claim.
  test(`leading blank line: ${lang} head carries the target indent, since the blank moved it off the splice point`, () => {
    const got = place("\n" + body, { languageId: lang, headerIndent });
    const head = got.split("\n").find((l) => l.trim() !== "");
    assert.strictEqual(
      /^[ \t]*/.exec(head)[0],
      headerIndent,
      `the head sits on its own line and needs the indent\n--- got ---\n${JSON.stringify(got)}`,
    );
  });

  test(`leading blank line: ${lang} in-place reply still places identically`, () => {
    const flush = place("\n" + body, { languageId: lang, headerIndent });
    const written = place("\n" + inPlace(body, headerIndent), { languageId: lang, headerIndent });
    assert.strictEqual(
      written,
      flush,
      `clause 1: a leading blank must not turn an in-place reply into a double indent\n--- in place ---\n${JSON.stringify(written)}\n--- flush ---\n${JSON.stringify(flush)}`,
    );
  });
}

test("leading blank line: CRLF is the same shape, not a separate escape", () => {
  const got = place("\r\n    public int Add()\r\n    {\r\n    }", { languageId: "csharp", headerIndent: "    " });
  const head = got.split("\n").find((l) => l.trim() !== "");
  assert.strictEqual(/^[ \t]*/.exec(head)[0], "    ", `the head carries the target indent, got:\n${JSON.stringify(got)}`);
});

// The compiler decides this one, not the reviewer. Spliced under a class member,
// a head left flush after a leading blank still PARSES and is no longer a method
// of that class, which is worse than a syntax error: it is silent.
test("leading blank line: the placed method stays a method of its class", { skip: pythonOk ? false : "python3 not available" }, () => {
  const placed = place("\n" + L("    def add(self, a):", "        return a"), {
    languageId: "python",
    headerIndent: "    ",
  });
  const buffer = "class C:\n    x = 1\n    " + placed + "\n";
  const owners = execFileSync(
    "python3",
    ["-c", "import ast,sys;t=ast.parse(sys.stdin.read());print(','.join(n.name for n in ast.walk(t) if isinstance(n,ast.ClassDef) for b in n.body if isinstance(b,ast.FunctionDef) and b.name=='add'))"],
    { input: buffer, encoding: "utf8" },
  ).trim();
  assert.strictEqual(owners, "C", `add must still belong to C, got owners=${JSON.stringify(owners)} for:\n${buffer}`);
});

// The bodyOnly path measures the shallowest STATEMENT, so a leading blank has
// nothing to say about the base. Kept as the contrast row for the definition
// path above.
test("leading blank line: the python bodyOnly path is unaffected", () => {
  const got = place(L("", "    return a + b"), { languageId: "python", bodyOnly: true, bodyIndent: "    " });
  assert.strictEqual(got, "\n\n    return a + b", `the statement still sets the base, got:\n${JSON.stringify(got)}`);
});

// ===== The head is indented but the body is NOT =============================
// A real reply shape when a model half-follows the in-place instruction. The
// head's own indent is the base, so a line SHALLOWER than the base has zero
// relative depth and lands on headerIndent. It must not be left at column 0
// (which would fall outside the block) and must not lose characters.

test("head indented, body flush: the shallow line clamps to headerIndent, nothing is mangled", () => {
  const reply = L("    public int F()", "    {", "return 1;", "    }");
  const got = place(reply, { languageId: "csharp", headerIndent: "    " });
  assert.strictEqual(
    got,
    L("public int F()", "    {", "    return 1;", "    }"),
    `a line shallower than the head has zero relative depth\n--- got ---\n${got}`,
  );
});

test("head indented, body flush: the line's own text survives verbatim", () => {
  const reply = L("  function f() {", "return 1;", "  }");
  const got = place(reply, { languageId: "typescript", headerIndent: "        " });
  const trimmed = got.split("\n").map((l) => l.trim());
  assert.deepStrictEqual(trimmed, ["function f() {", "return 1;", "}"], `no bytes lost, got:\n${got}`);
});

// ===== Clause 2: headerIndent "" returns text unchanged =====================
// A top-level target has no indent to add, so the reply is the answer, byte for
// byte, including shapes that would otherwise be normalised.

const SHAPES = [
  ["a flush-left definition", L("def f():", "    return 1")],
  ["an already-indented definition", L("    def f():", "        return 1")],
  ["a tab-indented definition", L("\tdef f():", "\t\treturn 1")],
  ["blank lines around it", L("", "def f():", "", "    return 1", "")],
  ["CRLF", "def f():\r\n    return 1\r\n"],
  ["a whitespace-only line inside", L("def f():", "    x = 1", "    ", "    return x")],
  ["a single line", "def f(): return 1"],
  ["the empty string", ""],
];
const ALL_LANGS = ["csharp", "rust", "typescript", "typescriptreact", "javascript", "javascriptreact", "python"];

for (const lang of ALL_LANGS) {
  test(`clause 2: ${lang} with headerIndent "" returns every reply shape unchanged`, () => {
    for (const [why, text] of SHAPES) {
      assert.strictEqual(
        place(text, { languageId: lang, headerIndent: "" }),
        text,
        `a top-level target adds nothing: ${why}`,
      );
    }
  });
  test(`clause 2: ${lang} with headerIndent omitted behaves like ""`, () => {
    for (const [why, text] of SHAPES) {
      assert.strictEqual(place(text, { languageId: lang }), text, `headerIndent is optional: ${why}`);
    }
  });
}

// ===== The empty reply ======================================================
test("an empty reply places to the empty string, for every language", () => {
  for (const lang of ALL_LANGS) {
    assert.strictEqual(place("", { languageId: lang, headerIndent: "        " }), "", `${lang}: nothing in, nothing out`);
  }
});

// ===== Clause 6: an unregistered languageId returns text unchanged ==========
test("clause 6: an unregistered languageId returns the reply unchanged", () => {
  const reply = L("func Add(a, b int) int {", "    return a + b", "}");
  // `go` was on this list until session-v35 item 1 REGISTERED it (supersession
  // S-v35-1). It was never a statement about Go: it stood for "unregistered",
  // and the clause it pins is unchanged and still asserted by the five below.
  for (const lang of ["ruby", "plaintext", "", "GO", "c#"]) {
    assert.strictEqual(
      place(reply, { languageId: lang, headerIndent: "        " }),
      reply,
      `${JSON.stringify(lang)} is not registered, so the reply passes through`,
    );
  }
});

// ===== Clause 5: python bodyOnly ============================================
// The reply is a BODY that goes below a preserved docstring, so the result leads
// with a newline and every code line lands at bodyIndent plus its depth relative
// to the shallowest STATEMENT line.

const BODY_ONLY = [
  {
    name: "a flush-left body lands on the docstring column",
    why: "the baseline",
    bodyIndent: "    ",
    reply: "return a + b",
    want: "\n    return a + b",
  },
  {
    name: "the same body written in place at col 4 lands on the same column",
    why: "the in-place bug, body path: two levels deep is an IndentationError",
    bodyIndent: "    ",
    reply: "    return a + b",
    want: "\n    return a + b",
  },
  {
    name: "2-space file: the reply's own 4-space level is stripped, the file's 2 goes on",
    why: "the body column comes from the docstring, never from a hardcoded 4",
    bodyIndent: "  ",
    reply: "    return a + b",
    want: "\n  return a + b",
  },
  {
    name: "tab file: the body lands on the docstring's tab column",
    why: "tabs are bytes",
    bodyIndent: "\t",
    reply: "\treturn a + b",
    want: "\n\treturn a + b",
  },
  {
    name: "a nested block keeps its relative depth",
    why: "the inner return must stay one level under its if",
    bodyIndent: "    ",
    reply: L("    if data:", "        return data", "    return None"),
    want: "\n" + L("    if data:", "        return data", "    return None"),
  },
  {
    name: "8-space body column, 2-space reply: relative depth is preserved literally",
    why: "the reply's unit is not rescaled to the file's",
    bodyIndent: "        ",
    reply: L("  if a:", "    return a", "  return b"),
    want: "\n" + L("        if a:", "          return a", "        return b"),
  },
  {
    name: "a blank line inside the body stays empty",
    why: "clause 5 defers to clause 3",
    bodyIndent: "    ",
    reply: L("    total = a + b", "", "    return total"),
    want: "\n" + L("    total = a + b", "", "    return total"),
  },
  {
    name: "a flush-left comment does not set the base",
    why: "python lets a # sit at any column, so a hanging comment must not veto the dedent",
    bodyIndent: "    ",
    reply: L("# explain", "    return a + b"),
    want: "\n" + L("    # explain", "    return a + b"),
  },
  {
    name: "a partially-indented comment does not drag the base with it",
    why: "same rule, the comment lands on the body column instead",
    bodyIndent: "    ",
    reply: L("  # explain", "    return a + b"),
    want: "\n" + L("    # explain", "    return a + b"),
  },
  {
    name: "a comment DEEPER than the base keeps its depth",
    why: "the statement set the base, so the comment's extra depth is real relative depth",
    bodyIndent: "    ",
    reply: L("    total = a + b", "        # why", "    return total"),
    want: "\n" + L("    total = a + b", "        # why", "    return total"),
  },
  {
    name: "an all-comment block lands on the body column",
    why: "no statement to set a base, so every comment sits on the body column",
    bodyIndent: "  ",
    reply: L("    # step one", "    # step two"),
    want: "\n" + L("  # step one", "  # step two"),
  },
  {
    name: "a multi-line string interior is byte-exact",
    why: "the opener is code and dedents, the string's own lines must not move",
    bodyIndent: "    ",
    reply: L("    text = \"\"\"", "line one", "  line two", "\"\"\"", "    return text"),
    want: "\n" + L("    text = \"\"\"", "line one", "  line two", "\"\"\"", "    return text"),
  },
  {
    name: "a string line that looks shallower than the base does not drag the base down",
    why: "a string interior is not a statement, so it cannot define column zero",
    bodyIndent: "        ",
    reply: L("    text = \"\"\"", "flush", "\"\"\"", "    return text"),
    want: "\n" + L("        text = \"\"\"", "flush", "\"\"\"", "        return text"),
  },
  {
    name: "CRLF body keeps its carriage returns",
    why: "a CRLF file must stay CRLF",
    bodyIndent: "    ",
    reply: "    total = a + b\r\n\r\n    return total",
    want: "\n    total = a + b\r\n\r\n    return total",
  },
  {
    name: "a single statement with no indent",
    why: "the smallest possible body",
    bodyIndent: "        ",
    reply: "pass",
    want: "\n        pass",
  },
];

for (const c of BODY_ONLY) {
  test(`python bodyOnly: ${c.name}`, () => {
    const got = place(c.reply, {
      languageId: "python",
      bodyOnly: true,
      headerIndent: c.bodyIndent.slice(0, -1),
      bodyIndent: c.bodyIndent,
    });
    assert.strictEqual(got, c.want, `${c.why}\n--- got ---\n${JSON.stringify(got)}\n--- want ---\n${JSON.stringify(c.want)}`);
    assert.ok(got.startsWith("\n"), "clause 5: the body leads with a newline, below the docstring's own line");
  });
}

test("python bodyOnly: bodyIndent governs, headerIndent does not move the body", () => {
  const reply = L("    if a:", "        return a", "    return b");
  const want = "\n" + L("        if a:", "            return a", "        return b");
  for (const headerIndent of ["", "    ", "\t\t", "                "]) {
    const got = place(reply, { languageId: "python", bodyOnly: true, headerIndent, bodyIndent: "        " });
    assert.strictEqual(got, want, `headerIndent ${JSON.stringify(headerIndent)} must not change the body column`);
  }
});

// Clause 7: the BLOCK path is idempotent, modulo the leading newline. Placing an
// already-placed body again must be a no-op, because a re-run of the command on
// a repaired file must not walk the body deeper each time.
test("clause 7: python bodyOnly placement is idempotent modulo the leading newline", () => {
  const cases = [
    ["    return a + b", "    "],
    [L("if data:", "    return data", "return None"), "        "],
    [L("# explain", "    total = a + b", "", "    return total"), "  "],
    [L("    text = \"\"\"", "line one", "\"\"\"", "    return text"), "    "],
  ];
  for (const [reply, bodyIndent] of cases) {
    const once = place(reply, { languageId: "python", bodyOnly: true, bodyIndent });
    const twice = place(once.replace(/^\n/, ""), { languageId: "python", bodyOnly: true, bodyIndent });
    assert.strictEqual(twice, once, `re-placing must not add a level, got:\n${JSON.stringify(twice)}`);
  }
});

// ===== python3 proves the placed result is real Python =======================
// Columns are asserted above. This section only adds the thing bytes cannot say:
// the result is still a parseable program in the document it lands in. Skips
// cleanly if python3 is absent.

const PY_DOCS = [
  {
    name: "a method placed at col 4 next to an existing sibling",
    prefix: L("class C:", "    def existing(self):", "        pass", "") + "\n",
    headerIndent: "    ",
    reply: L("    def add(self, a, b):", "        return a + b"),
  },
  {
    name: "a nested class placed at col 4",
    prefix: L("class C:", "    x = 1", "") + "\n",
    headerIndent: "    ",
    reply: L("    class Inner:", "        def v(self):", "            return 1"),
  },
  {
    name: "a def placed at col 8 from a 2-space reply",
    prefix: L("class A:", "    class B:", "        y = 1", "") + "\n",
    headerIndent: "        ",
    reply: L("def f(self):", "  if self.y:", "    return 1", "  return 0"),
  },
  {
    name: "a tab-indented method next to a tab-indented sibling",
    prefix: L("class C:", "\tdef existing(self):", "\t\tpass", "") + "\n",
    headerIndent: "\t",
    reply: L("\tdef add(self, a, b):", "\t\treturn a + b"),
  },
  {
    name: "a body holding a triple-quoted string",
    prefix: L("class C:", "    z = 1", "") + "\n",
    headerIndent: "    ",
    reply: L("    def banner(self):", "        text = \"\"\"", "raw line", "\"\"\"", "        return text"),
  },
  {
    name: "blank lines inside the body",
    prefix: L("class C:", "    def existing(self):", "        pass", "") + "\n",
    headerIndent: "    ",
    reply: L("    def add(self, a, b):", "        total = a + b", "", "        return total"),
  },
];

for (const c of PY_DOCS) {
  test(`python3 parse, definition: ${c.name}`, { skip: pythonOk ? false : "python3 not available" }, () => {
    const placed = place(c.reply, { languageId: "python", headerIndent: c.headerIndent });
    const doc = c.prefix + c.headerIndent + placed;
    assert.ok(pyParses(doc), `the placed document must parse, got:\n${doc}`);
  });
}

// The negative control: the oracle above is only worth something if the bug it
// guards actually breaks the parse. This is the historical behaviour, headerIndent
// added on top of an in-place reply's own bytes.
test("python3 parse: the double-indent this function exists to prevent really is an IndentationError", {
  skip: pythonOk ? false : "python3 not available",
}, () => {
  // The sibling must be a STATEMENT, not an open block: a sibling def would
  // happily adopt the over-indented line as a nested def and parse fine.
  const prefix = L("class C:", "    x = 1", "") + "\n";
  const reply = L("    def add(self, a, b):", "        return a + b");
  const naive = reply.split("\n").map((l, i) => (i === 0 ? l : "    " + l)).join("\n");
  assert.strictEqual(pyParses(prefix + "    " + naive), false, "the old behaviour must be a parse error, or this oracle proves nothing");
  assert.strictEqual(
    pyParses(prefix + "    " + place(reply, { languageId: "python", headerIndent: "    " })),
    true,
    "and the placed version must parse",
  );
});

// The leading-blank case, taken all the way to the compiler: a model that opens
// with a newline and writes in place must still produce a parseable file.
test("python3 parse: a leading blank line in an in-place reply still parses", {
  skip: pythonOk ? false : "python3 not available",
}, () => {
  const prefix = L("class C:", "    x = 1", "") + "\n";
  const reply = "\n" + L("    def add(self, a, b):", "        return a + b");
  const doc = prefix + "    " + place(reply, { languageId: "python", headerIndent: "    " });
  assert.ok(pyParses(doc), `a leading blank must not push the def a level deeper, got:\n${doc}`);
});

const PY_BODY_DOCS = [
  {
    name: "a flush body under a col-4 docstring",
    prefix: L("def f(a, b):", "    \"\"\"Add.\"\"\""),
    bodyIndent: "    ",
    reply: "return a + b",
  },
  {
    name: "an in-place body under a col-4 docstring",
    prefix: L("def f(a, b):", "    \"\"\"Add.\"\"\""),
    bodyIndent: "    ",
    reply: "    return a + b",
  },
  {
    name: "an in-place body under a col-8 method docstring",
    prefix: L("class C:", "    def m(self):", "        \"\"\"Doc.\"\"\""),
    bodyIndent: "        ",
    reply: L("        if self.x:", "            return 1", "        return 0"),
  },
  {
    name: "a hanging comment above the body",
    prefix: L("def f(a, b):", "    \"\"\"Add.\"\"\""),
    bodyIndent: "    ",
    reply: L("# explain", "    return a + b"),
  },
  {
    name: "a 2-space file",
    prefix: L("def f(a, b):", "  \"\"\"Add.\"\"\""),
    bodyIndent: "  ",
    reply: L("    total = a + b", "", "    return total"),
  },
  {
    name: "a body holding a triple-quoted string",
    prefix: L("def f():", "    \"\"\"Doc.\"\"\""),
    bodyIndent: "    ",
    reply: L("    text = \"\"\"", "raw", "\"\"\"", "    return text"),
  },
];

for (const c of PY_BODY_DOCS) {
  test(`python3 parse, bodyOnly: ${c.name}`, { skip: pythonOk ? false : "python3 not available" }, () => {
    const placed = place(c.reply, { languageId: "python", bodyOnly: true, bodyIndent: c.bodyIndent });
    const doc = c.prefix + placed + "\n";
    assert.ok(pyParses(doc), `the placed body must parse under its docstring, got:\n${doc}`);
  });
}

test("python3 parse, bodyOnly: the double-indent it prevents really is an IndentationError", {
  skip: pythonOk ? false : "python3 not available",
}, () => {
  const prefix = L("def f(a, b):", "    \"\"\"Add.\"\"\"");
  const naive = "\n" + "    " + "    return a + b";
  assert.strictEqual(pyParses(prefix + naive + "\n"), false, "the old behaviour must be a parse error");
  assert.strictEqual(
    pyParses(prefix + place("    return a + b", { languageId: "python", bodyOnly: true, bodyIndent: "    " }) + "\n"),
    true,
    "and the placed version must parse",
  );
});
