// Implementer: a model that answers IN PLACE lands at the target's column, in
// every registered language.
//
// The prompt shows the model code that is already written and asks for what goes
// under it, so it often replies with its lines already indented to sit where they
// were shown. Adding the target's indent to those bytes lands the definition a
// level deep: an IndentationError in Python, and a body plus closing brace one
// level too far in for C#, TypeScript and Rust, which compiles and so was never
// caught by any check.
//
// Every row here feeds a reply whose own base column is NOT the target's, through
// the REAL placeGeneratedReply dispatcher the three write paths (generate, repair,
// refine) all call, and asserts the exact landed text. The flush-left rows are the
// regression bar: they were correct before and must be byte-identical after.
//
// Run: SKIP_LIVE=1 node --test test/impl-inplace-reply.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-inplace-reply",
  `export { placeGeneratedReply } from "../src/core/placeReply";\n`,
);
const { placeGeneratedReply } = mod;
test.after(cleanup);

// A method nested one level in, the shape every one of these targets: the
// document already holds the header's indent before the splice point, so the
// header line comes back at column 0 and the body at the target's indent.
const CASES = [
  {
    lang: "csharp",
    indent: "    ",
    inPlace: "    public int Add(int a, int b)\n    {\n        return a + b;\n    }",
    flush: "public int Add(int a, int b)\n{\n    return a + b;\n}",
    want: "public int Add(int a, int b)\n    {\n        return a + b;\n    }",
  },
  {
    lang: "typescript",
    indent: "  ",
    inPlace: "  add(a: number, b: number): number {\n    return a + b;\n  }",
    flush: "add(a: number, b: number): number {\n  return a + b;\n}",
    want: "add(a: number, b: number): number {\n    return a + b;\n  }",
  },
  {
    lang: "rust",
    indent: "    ",
    inPlace: "    fn add(a: i32, b: i32) -> i32 {\n        a + b\n    }",
    flush: "fn add(a: i32, b: i32) -> i32 {\n    a + b\n}",
    want: "fn add(a: i32, b: i32) -> i32 {\n        a + b\n    }",
  },
  {
    lang: "python",
    indent: "    ",
    inPlace: "    def add(a, b):\n        return a + b",
    flush: "def add(a, b):\n    return a + b",
    want: "def add(a, b):\n        return a + b",
  },
];

for (const c of CASES) {
  test(`${c.lang}: an in-place reply lands at the target column, not a level deeper`, () => {
    const placed = placeGeneratedReply(c.inPlace, { languageId: c.lang, headerIndent: c.indent });
    assert.strictEqual(placed, c.want, `in-place reply mis-placed for ${c.lang}`);
  });

  test(`${c.lang}: a flush-left reply is unchanged by the fix (regression bar)`, () => {
    const placed = placeGeneratedReply(c.flush, { languageId: c.lang, headerIndent: c.indent });
    assert.strictEqual(placed, c.want, `flush-left reply must land exactly as it always did (${c.lang})`);
  });

  test(`${c.lang}: both reply styles land on the same bytes`, () => {
    assert.strictEqual(
      placeGeneratedReply(c.inPlace, { languageId: c.lang, headerIndent: c.indent }),
      placeGeneratedReply(c.flush, { languageId: c.lang, headerIndent: c.indent }),
      `the reply's own column must not change where it lands (${c.lang})`,
    );
  });

  test(`${c.lang}: a top-level target (indent "") is a byte-for-byte no-op`, () => {
    assert.strictEqual(placeGeneratedReply(c.flush, { languageId: c.lang, headerIndent: "" }), c.flush);
    assert.strictEqual(placeGeneratedReply(c.inPlace, { languageId: c.lang, headerIndent: "" }), c.inPlace);
  });

}

// Placing a whole definition is deliberately NOT idempotent, and no caller may
// treat it as if it were. The header comes back at column 0 because the document
// already holds its indent before the splice point, which is exactly the shape of
// an unplaced flush-left reply. Nothing can tell the two apart, so a second pass
// indents again. One call per reply, at the splice.
for (const c of CASES) {
  test(`${c.lang}: placing a definition twice indents twice, which is why it happens once`, () => {
    const once = placeGeneratedReply(c.inPlace, { languageId: c.lang, headerIndent: c.indent });
    const twice = placeGeneratedReply(once, { languageId: c.lang, headerIndent: c.indent });
    assert.notStrictEqual(twice, once, "a second pass is a bug at the call site, not a no-op");
  });
}

// The BODY-block path is idempotent, and that asymmetry is not an accident: every
// line of a placed block carries the body column, so it is the block's own base
// and comes straight back off.
test("python bodyOnly: placing the same block twice lands the same bytes", () => {
  const once = placeGeneratedReply("    return a + b", { languageId: "python", bodyOnly: true, bodyIndent: "    " });
  const twice = placeGeneratedReply(once.slice(1), { languageId: "python", bodyOnly: true, bodyIndent: "    " });
  assert.strictEqual(twice, once);
});

// String literals still never move: their bytes are the value.
const STRINGS = [
  {
    lang: "csharp",
    indent: "    ",
    reply: '    public string Banner()\n    {\n        return @"line one\nline two";\n    }',
    needle: '@"line one\nline two"',
  },
  {
    lang: "rust",
    indent: "    ",
    reply: '    fn banner() -> &\'static str {\n        "line one\nline two"\n    }',
    needle: '"line one\nline two"',
  },
  {
    lang: "typescript",
    indent: "    ",
    reply: "    banner(): string {\n        return `line one\nline two`;\n    }",
    needle: "`line one\nline two`",
  },
  {
    lang: "python",
    indent: "    ",
    reply: '    def banner():\n        return """line one\nline two"""',
    needle: '"""line one\nline two"""',
  },
];
for (const s of STRINGS) {
  test(`${s.lang}: a multi-line string's own lines survive the dedent byte-exact`, () => {
    const placed = placeGeneratedReply(s.reply, { languageId: s.lang, headerIndent: s.indent });
    assert.ok(placed.includes(s.needle), `the literal must be untouched, got:\n${placed}`);
  });
}

// The dispatcher is what the three write paths share, so its Python legs are
// pinned here too: repair and refine reached the non-bodyOnly one through no
// path at all before it existed.
test("python bodyOnly: the body indents to the docstring column and leads with a newline", () => {
  const placed = placeGeneratedReply("    return a + b", {
    languageId: "python",
    bodyOnly: true,
    bodyIndent: "  ",
  });
  assert.strictEqual(placed, "\n  return a + b");
});

test("python non-bodyOnly at a nested target: the body lands under the header, not at column 0", () => {
  const placed = placeGeneratedReply("def add(a, b):\n    return a + b", {
    languageId: "python",
    headerIndent: "    ",
  });
  assert.strictEqual(placed, "def add(a, b):\n        return a + b");
});

test("an unregistered language is returned untouched: no leg means no guess", () => {
  // Was `go` until session-v35 item 1 registered it (supersession S-v35-1). The
  // id was standing in for "unregistered", so the clause moves to one that
  // still is; ruby has no leg and no plans for one.
  const reply = "  def add(a, b)\n    a + b\n  end";
  assert.strictEqual(placeGeneratedReply(reply, { languageId: "ruby", headerIndent: "\t" }), reply);
});

test("go IS registered now, and a nested target gets its body one level deeper", () => {
  const placed = placeGeneratedReply("func Add(a, b int) int {\n\treturn a + b\n}", {
    languageId: "go",
    headerIndent: "\t",
  });
  assert.strictEqual(placed, "func Add(a, b int) int {\n\t\treturn a + b\n\t}");
});

// A `#` above the declaration head. Python allows it at any column, so its
// column is not the reply's base: reading it as one puts the header and its body
// on the SAME column, which is an IndentationError, not a cosmetic slip. The
// postprocess re-anchors whole-definition replies at their head today, so this
// does not arrive from the model. It is pinned because "it cannot arrive" is the
// argument that deleted this guard once already (review round 3, finding 1).
const COMMENT_HEADS = [
  {
    name: "comment indented, head flush",
    reply: "    # helper for the cache\ndef load(self, key):\n    return self._cache[key]",
    want: "    # helper for the cache\n    def load(self, key):\n        return self._cache[key]",
  },
  {
    name: "comment flush, head indented",
    reply: "# helper\n    def load(self, key):\n        return self._cache[key]",
    want: "# helper\n    def load(self, key):\n        return self._cache[key]",
  },
  {
    // The comment is the FIRST line, so it lands at the splice point, where the
    // document already holds the target's indent. Stripping the base off it is
    // what puts it level with the def rather than one stop past it.
    name: "comment and head at the same column",
    reply: "    # helper\n    def load(self, key):\n        return self._cache[key]",
    want: "# helper\n    def load(self, key):\n        return self._cache[key]",
  },
];
for (const c of COMMENT_HEADS) {
  test(`python, comment above the head: ${c.name}`, () => {
    const placed = placeGeneratedReply(c.reply, { languageId: "python", headerIndent: "    " });
    assert.strictEqual(placed, c.want, `the head sets the base, not the comment`);
  });
}

// The compiler decides it: spliced under a sibling at the target's column, the
// method must still be a method with a body.
const { execFileSync } = require("child_process");
let pythonOk = true;
try {
  execFileSync("python3", ["-c", "import ast"], { stdio: "ignore" });
} catch {
  pythonOk = false;
}
test("python, comment above the head: the spliced method still has a body", { skip: pythonOk ? false : "python3 not available" }, () => {
  const placed = placeGeneratedReply(
    "    # helper for the cache\ndef load(self, key):\n    return self._cache[key]",
    { languageId: "python", headerIndent: "    " },
  );
  const buffer = "class C:\n    x = 1\n    " + placed + "\n";
  execFileSync("python3", ["-c", "import ast,sys; ast.parse(sys.stdin.read())"], {
    input: buffer,
    stdio: ["pipe", "ignore", "pipe"],
  });
});
