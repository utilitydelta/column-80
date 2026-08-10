// Blind oracle: the Python re-indent contract, black box. Written from the
// written contract only, never from src/**.
//
// The defect this aims at: the model is shown a header plus docstring and asked
// for the body under it, so it answers IN PLACE with every statement already
// indented. Prepending the target column to those bytes lands the body one level
// too deep. So every row here carries a reply whose own base column is
// deliberately NOT the target column, and asserts the EXACT landed column. "It
// parses" is not enough: a body two levels deep parses fine.
//
// Run: SKIP_LIVE=1 node --test test/blind-hotfix-pyindent.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { execFileSync } = require("child_process");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "blind-hotfix-pyindent",
  `export { reindentPyBlock, reindentPyBody } from "../src/core/pyExtraction";\n` +
    `export { spliceSpan } from "../src/core/span";\n`,
);
const { reindentPyBlock, reindentPyBody, spliceSpan } = mod;
test.after(cleanup);

let pythonOk = true;
try {
  execFileSync("python3", ["-c", "import ast"], { stdio: "ignore" });
} catch {
  pythonOk = false;
}
const parses = (src) => {
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

// ===== reindentPyBlock: exact landed columns ================================
// [name, reply, indent, want]
const BLOCK = [
  [
    "the model answered IN PLACE at 4: the reply's own level is its base, not an addition",
    "    return a + b",
    "    ",
    "    return a + b",
  ],
  [
    "a flush-left reply lands at the target column",
    "return a + b",
    "    ",
    "    return a + b",
  ],
  [
    "a 2-space reply in an 8-space file: the target column is 8, the reply's inner 2-space step survives as 2",
    "  if x:\n    return 1\n  return 0",
    "        ",
    "        if x:\n          return 1\n        return 0",
  ],
  [
    "a tab reply into a tab file lands at one tab, not two",
    "\tif x:\n\t\treturn 1",
    "\t",
    "\tif x:\n\t\treturn 1",
  ],
  [
    "a tab reply into a 4-space file: the tab base is stripped, spaces go on",
    "\treturn 1",
    "    ",
    "    return 1",
  ],
  [
    "first line flush-left, later lines indented: the shallowest CODE line sets the base",
    "if x:\n    return 1\nreturn 0",
    "    ",
    "    if x:\n        return 1\n    return 0",
  ],
  [
    "a blank line inside an indented reply stays byte-exact, never whitespace-only",
    "    total = a + b\n\n    return total",
    "  ",
    "  total = a + b\n\n  return total",
  ],
  [
    "leading and trailing blank lines are byte-exact and do not set the base",
    "\n    x = 1\n\n",
    "    ",
    "\n    x = 1\n\n",
  ],
  [
    "a single-line reply into a tab file",
    "return 1",
    "\t",
    "\treturn 1",
  ],
  [
    "an entirely empty reply has no code lines to move",
    "",
    "    ",
    "",
  ],
  [
    "an all-blank reply stays byte-exact, no whitespace-only lines invented",
    "\n\n",
    "    ",
    "\n\n",
  ],
  [
    "a nested def inside the reply keeps its internal shape one level under its own header",
    "    def inner():\n        return 1\n    return inner",
    "        ",
    "        def inner():\n            return 1\n        return inner",
  ],
  [
    "a backslash continuation line is a code line: it moves with the rest, keeping its extra depth",
    "    total = a + \\\n        b\n    return total",
    "  ",
    "  total = a + \\\n      b\n  return total",
  ],
  [
    "a triple quote inside a COMMENT does not open a string: every later line is still code and still moves",
    '    url = "http://x/#frag"  # note """ here\n    q = "he said hi"\n    return url',
    "  ",
    '  url = "http://x/#frag"  # note """ here\n  q = "he said hi"\n  return url',
  ],
  [
    "a # inside a string is not a comment and changes nothing about the column",
    '    s = "# not a comment"\n    return s',
    "      ",
    '      s = "# not a comment"\n      return s',
  ],
  [
    "a one-line docstring is code (it opens and closes on the same line) so it moves",
    '    """Do it."""\n    return 1',
    "  ",
    '  """Do it."""\n  return 1',
  ],
];
for (const [name, reply, indent, want] of BLOCK) {
  test(`reindentPyBlock: ${name}`, () => {
    assert.strictEqual(reindentPyBlock(reply, indent), want);
  });
}

// A multi-line docstring: the OPENING line is code and moves, but every line
// from there to the terminator sits inside the string, and its leading
// whitespace is part of the string's VALUE. Moving those bytes rewrites the
// user's docstring, so they stay put even though the result looks ragged.
test("reindentPyBlock: a multi-line docstring's interior and closing line are byte-exact", () => {
  const reply = '    """Do it.\n\n    Longer.\n    """\n    return 1';
  const want = '  """Do it.\n\n    Longer.\n    """\n  return 1';
  assert.strictEqual(reindentPyBlock(reply, "  "), want);
});

// The contract names both quote styles, so the single-quote form gets the same
// interior guarantee.
test("reindentPyBlock: a ''' docstring's interior and closing line are byte-exact", () => {
  const reply = "    '''Doc.\n\n    More.\n    '''\n    return 1";
  const want = "  '''Doc.\n\n    More.\n    '''\n  return 1";
  assert.strictEqual(reindentPyBlock(reply, "  "), want);
});

// A """ sitting INSIDE a '''-string opens nothing. If the two quote styles are
// scanned independently the toggle flips on the wrong line and the code after
// the string stops moving.
test("reindentPyBlock: a triple double-quote inside a '''-string opens nothing", () => {
  const reply = "    s = '''\nhas \"\"\" inside\n'''\n    return s";
  const want = "  s = '''\nhas \"\"\" inside\n'''\n  return s";
  assert.strictEqual(reindentPyBlock(reply, "  "), want);
});

// A triple quote inside an ordinary single-quoted string is not an opener. If it
// were treated as one, every line after it would freeze at the reply's column.
test("reindentPyBlock: a triple quote inside a short string is not an opener", () => {
  const reply = "    x = '\"\"\"'\n    return x";
  const want = "  x = '\"\"\"'\n  return x";
  assert.strictEqual(reindentPyBlock(reply, "  "), want);
});

// An f-prefix still opens a multi-line string: the prefix must not hide it.
test("reindentPyBlock: an f-prefixed multi-line string still protects its interior", () => {
  const reply = '    text = f"""\nline one\n"""\n    return text';
  const want = '        text = f"""\nline one\n"""\n        return text';
  assert.strictEqual(reindentPyBlock(reply, "        "), want);
});

// Two multi-line strings in a row: the second opener must be seen, which only
// happens if the first one was properly closed.
test("reindentPyBlock: back-to-back multi-line strings toggle correctly", () => {
  const reply = '    a = """\nraw a\n"""\n    b = """\nraw b\n"""\n    return a + b';
  const want = '  a = """\nraw a\n"""\n  b = """\nraw b\n"""\n  return a + b';
  assert.strictEqual(reindentPyBlock(reply, "  "), want);
});

// CRLF replies happen on Windows. Whatever is done with the \r, the code must
// still land at the target column.
test("reindentPyBlock: CRLF reply still lands its code at the target column", () => {
  const got = reindentPyBlock("    x = 1\r\n    return x", "      ");
  for (const line of got.split("\n")) {
    if (line.trim() === "") continue;
    assert.ok(line.startsWith("      "), `every code line lands at col 6, got ${JSON.stringify(line)}`);
    assert.ok(!line.startsWith("       "), `and not deeper, got ${JSON.stringify(line)}`);
  }
});

// The interior is SHALLOWER than the code around it. If interior lines were
// counted when finding the shallowest line, the base would be 0 and the code
// would land 4 columns too deep. This row is the detector for that.
test("reindentPyBlock: string interior shallower than the code does not drag the base to 0", () => {
  const reply = '    text = """\nline one\n  line two\n"""\n    return text';
  const want = '        text = """\nline one\n  line two\n"""\n        return text';
  assert.strictEqual(reindentPyBlock(reply, "        "), want);
});

// indent === "" is the documented identity case: byte for byte, whatever the
// input shape. Uses the gnarliest input in the file so identity is a real claim.
test('reindentPyBlock: indent "" returns the reply byte for byte', () => {
  const reply = '\tif x:\n\n    text = """\nline one\n"""\n  return 0   \n';
  assert.strictEqual(reindentPyBlock(reply, ""), reply);
});

// "Tabs and spaces are never mixed by guesswork": with no common whitespace
// prefix across the code lines there is no base to strip, so each line's own
// leading bytes must still be there afterwards.
test("reindentPyBlock: mixed tab and space code lines have nothing stripped", () => {
  const reply = "\tif x:\n    return 1";
  const got = reindentPyBlock(reply, "    ");
  const gotLines = got.split("\n");
  const srcLines = reply.split("\n");
  assert.strictEqual(gotLines.length, srcLines.length, `line count must not change, got:\n${JSON.stringify(got)}`);
  for (let i = 0; i < srcLines.length; i++) {
    assert.ok(
      gotLines[i].endsWith(srcLines[i]),
      `line ${i} must keep its own leading whitespace, want a line ending in ${JSON.stringify(srcLines[i])}, got ${JSON.stringify(gotLines[i])}`,
    );
  }
});

// A whitespace-only line is not code, so it must not set the base. If it did,
// the common prefix would collapse to one space and the code would land three
// columns too deep.
test("reindentPyBlock: a whitespace-only line does not set the base", () => {
  const got = reindentPyBlock("    a = 1\n \n    return a", "  ");
  const gotLines = got.split("\n");
  assert.strictEqual(gotLines[0], "  a = 1");
  assert.strictEqual(gotLines[2], "  return a");
});

// Trailing whitespace on a code line must not change where the line LANDS.
test("reindentPyBlock: trailing whitespace does not move the landing column", () => {
  const got = reindentPyBlock("    x = 1   \n    return x", "      ");
  const gotLines = got.split("\n");
  assert.ok(gotLines[0].startsWith("      x = 1"), `want col 6, got ${JSON.stringify(gotLines[0])}`);
  assert.ok(!gotLines[0].startsWith("       "), `and not col 7+, got ${JSON.stringify(gotLines[0])}`);
  assert.strictEqual(gotLines[1], "      return x");
});

// ===== reindentPyBody: exact landed columns ================================
// The first line comes back bare: the document already holds the indent at the
// splice point, so a leading indent here would double it.
// [name, reply, indent, want]
const BODY = [
  [
    "a flush-left definition: header bare, body at indent plus its own depth",
    "def f(self):\n    return 1",
    "    ",
    "def f(self):\n        return 1",
  ],
  [
    "the model answered IN PLACE: the reply's header column is its column zero, not an addition",
    "    def f(self):\n        return 1",
    "    ",
    "def f(self):\n        return 1",
  ],
  [
    "a reply indented 8 landing in a 4-space file lands one level deep, not three",
    "        def f(self):\n            return 1\n",
    "    ",
    "def f(self):\n        return 1\n",
  ],
  [
    "a tab reply into a tab file",
    "\tdef f(self):\n\t\treturn 1",
    "\t",
    "def f(self):\n\t\treturn 1",
  ],
  [
    "a 2-space reply into an 8-space file keeps the 2-space step",
    "  def f(self):\n    return 1\n    return 2",
    "        ",
    "def f(self):\n          return 1\n          return 2",
  ],
  [
    "a class reply with a docstring, a blank line and a nested method",
    'class C:\n    """Doc."""\n\n    def m(self):\n        return 1',
    "    ",
    'class C:\n        """Doc."""\n\n        def m(self):\n            return 1',
  ],
  [
    "a backslash continuation inside the body keeps its extra depth",
    "def f(a, b):\n    total = a + \\\n        b\n    return total",
    "  ",
    "def f(a, b):\n      total = a + \\\n          b\n      return total",
  ],
  [
    "a triple quote in a comment does not open a string: later lines are still code",
    'def f():\n    url = "x"  # note """ here\n    return url',
    "  ",
    'def f():\n      url = "x"  # note """ here\n      return url',
  ],
  [
    "a space-indented reply into a tab file: depth is copied as BYTES, never re-tabbed",
    "def f():\n    pass",
    "\t",
    "def f():\n\t    pass",
  ],
  [
    "trailing blank lines after the definition stay byte-exact",
    "def f():\n    return 1\n\n",
    "    ",
    "def f():\n        return 1\n\n",
  ],
];
for (const [name, reply, indent, want] of BODY) {
  test(`reindentPyBody: ${name}`, () => {
    assert.strictEqual(reindentPyBody(reply, indent), want);
  });
}

// Same string rule as the block form: interiors and the terminator line hold
// the docstring's value and must not move.
test("reindentPyBody: a multi-line docstring's interior stays byte-exact", () => {
  const reply = 'def f():\n    """Doc.\n\n    More.\n    """\n    return 1';
  const want = 'def f():\n      """Doc.\n\n    More.\n    """\n      return 1';
  assert.strictEqual(reindentPyBody(reply, "  "), want);
});

// An in-place reply whose docstring interior is shallower than its own header.
test("reindentPyBody: an indented reply with a shallow string interior", () => {
  const reply = '    def f():\n        text = """\nline one\n"""\n        return text';
  const want = 'def f():\n        text = """\nline one\n"""\n        return text';
  assert.strictEqual(reindentPyBody(reply, "    "), want);
});

// A signature split over several lines: the closing ")" sits at the header's own
// column, so it must land exactly at indent, and the body one level below it.
test("reindentPyBody: a multi-line signature keeps the closing paren at the header column", () => {
  const reply = "def f(\n    a,\n    b,\n):\n    return a + b";
  const want = "def f(\n        a,\n        b,\n    ):\n        return a + b";
  const got = reindentPyBody(reply, "    ");
  assert.strictEqual(got, want);
  if (pythonOk) assert.ok(parses("class Outer:\n    " + got + "\n"), `must parse in a class, got:\n${got}`);
});

test('reindentPyBody: indent "" returns the reply byte for byte', () => {
  const reply = '    def f():\n\n        """Doc.\n    raw\n        """\n        return 1   \n';
  assert.strictEqual(reindentPyBody(reply, ""), reply);
});

// ===== End to end: splice into a real buffer and parse it ===================
// A column assertion alone cannot prove the file is still Python, and a parse
// alone cannot prove the column. Every row below asserts both.

function spliceBlockInto(fullDoc, placeholder, indent, reply) {
  const start = fullDoc.indexOf(placeholder);
  assert.ok(start >= 0, "the fixture must contain the placeholder");
  return spliceSpan(fullDoc, { start, end: start + placeholder.length }, reindentPyBlock(reply, indent));
}

// [name, fullDoc, placeholder, indent, reply, want]
const E2E_BLOCK = [
  [
    "in-place 4-space reply into a 4-space function",
    'def add(a, b):\n    """Add two ints."""\n    pass\n',
    "    pass",
    "    ",
    "    total = a + b\n    return total",
    'def add(a, b):\n    """Add two ints."""\n    total = a + b\n    return total\n',
  ],
  [
    "in-place 2-space reply into a method body at column 8",
    'class Outer:\n    def m(self):\n        """Doc."""\n        pass\n',
    "        pass",
    "        ",
    "  if self.x:\n    return 1\n  return 0",
    'class Outer:\n    def m(self):\n        """Doc."""\n        if self.x:\n          return 1\n        return 0\n',
  ],
  [
    "in-place reply whose multi-line string is flush left, into a column-8 method",
    'class Outer:\n    def banner(self):\n        """Doc."""\n        pass\n',
    "        pass",
    "        ",
    '    text = """\nline one\n  line two\n"""\n    return text',
    'class Outer:\n    def banner(self):\n        """Doc."""\n        text = """\nline one\n  line two\n"""\n        return text\n',
  ],
  [
    "in-place reply with a nested def, into a tab-indented function",
    'def outer():\n\t"""Doc."""\n\tpass\n',
    "\tpass",
    "\t",
    "    def inner():\n        return 1\n    return inner()",
    'def outer():\n\t"""Doc."""\n\tdef inner():\n\t    return 1\n\treturn inner()\n',
  ],
];
for (const [name, fullDoc, placeholder, indent, reply, want] of E2E_BLOCK) {
  test(`e2e block splice: ${name}`, () => {
    const got = spliceBlockInto(fullDoc, placeholder, indent, reply);
    assert.strictEqual(got, want);
    if (pythonOk) assert.ok(parses(got), `the spliced buffer must be valid Python, got:\n${got}`);
  });
}

function spliceBodyInto(fullDoc, oldDef, indent, reply) {
  const start = fullDoc.indexOf(oldDef);
  assert.ok(start >= 0, "the fixture must contain the old definition");
  return spliceSpan(fullDoc, { start, end: start + oldDef.length }, reindentPyBody(reply, indent));
}

// [name, fullDoc, oldDef, indent, reply, want]
const E2E_BODY = [
  [
    "an in-place whole-definition reply replacing a method at column 4",
    "class Outer:\n    def old(self):\n        pass\n",
    "def old(self):\n        pass",
    "    ",
    '    def m(self):\n        """Doc."""\n        return 1',
    'class Outer:\n    def m(self):\n        """Doc."""\n        return 1\n',
  ],
  [
    "a flush-left whole-definition reply replacing a method at column 4",
    "class Outer:\n    def old(self):\n        pass\n",
    "def old(self):\n        pass",
    "    ",
    "def m(self):\n    if self.x:\n        return 1\n    return 0",
    "class Outer:\n    def m(self):\n        if self.x:\n            return 1\n        return 0\n",
  ],
  [
    "a space-indented reply into a tab-indented class: the tab column goes on, the reply's own depth stays spaces",
    "class Outer:\n\tdef old(self):\n\t\tpass\n",
    "def old(self):\n\t\tpass",
    "\t",
    "    def m(self):\n        return 1",
    "class Outer:\n\tdef m(self):\n\t    return 1\n",
  ],
  [
    "a top-level definition: indent is empty, the reply goes in byte for byte",
    "def old():\n    pass\n",
    "def old():\n    pass",
    "",
    "def m():\n    return 1",
    "def m():\n    return 1\n",
  ],
];
for (const [name, fullDoc, oldDef, indent, reply, want] of E2E_BODY) {
  test(`e2e body splice: ${name}`, () => {
    const got = spliceBodyInto(fullDoc, oldDef, indent, reply);
    assert.strictEqual(got, want);
    if (pythonOk) assert.ok(parses(got), `the spliced buffer must be valid Python, got:\n${got}`);
  });
}

// The wrong answer parses too, so name it: a doubly-indented body is the exact
// regression this hotfix is about, and it must not appear in the buffer.
test("e2e: the doubly-indented body never appears in the buffer", () => {
  const fullDoc = 'def add(a, b):\n    """Add two ints."""\n    pass\n';
  const got = spliceBlockInto(fullDoc, "    pass", "    ", "    return a + b");
  assert.ok(!got.includes("\n        return a + b"), `must not land two levels deep, got:\n${got}`);
  assert.ok(got.includes("\n    return a + b"), `must land one level deep, got:\n${got}`);
  if (pythonOk) assert.ok(parses(got), `must parse, got:\n${got}`);
});
