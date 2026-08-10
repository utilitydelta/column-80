// Implementer oracle (v13): the Fork A body-only splice, end to end. Drives the
// REAL pyLeadingDocstring (the span cut) + reindentPyBlock (the body indent) +
// spliceSpan (the edit), then PARSES the result with python3 and checks the
// docstring survived BYTE-EXACT. This is the non-negotiable the blind contracts
// cannot reach: valid Python out, and the human's docstring never touched. Skips
// cleanly if python3 is absent.
//
// The command builds the splice as: span = [headStart + doc.end .. range.end],
// replacement = "\n" + reindentPyBlock(modelBody, headerIndent + "    "). This
// test reproduces exactly that and asserts (1) it parses, (2) the docstring bytes
// are identical to the original, (3) the body lands at the right column.
//
// Run: SKIP_LIVE=1 node --test test/impl-v13-bodyonly-splice.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { execFileSync } = require("child_process");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-v13-bodyonly-splice",
  `export { pyLeadingDocstring, pyDocstringHasAdjacentLiteral, reindentPyBlock } from "../src/core/pyExtraction";\n` +
    `export { spliceSpan } from "../src/core/span";\n`,
);
const { pyLeadingDocstring, pyDocstringHasAdjacentLiteral, reindentPyBlock, spliceSpan } = mod;
test.after(cleanup);

// An implicit string-concatenation docstring must be DETECTED (so the command
// refuses) rather than half-eaten by the span (review MAJOR: only the first
// literal is located).
const ADJ = [
  { span: 'def f():\n    "a " "b"\n    return 1', want: true, why: "adjacent literals on one line" },
  { span: 'def f():\n    "a " \\\n    "b"\n    return 1', want: true, why: "backslash-continued adjacent literals" },
  { span: 'def f():\n    """doc"""\n    return 1', want: false, why: "a normal docstring, code follows on the next line" },
  { span: 'def f():\n    """doc"""\n    "not a docstring, a separate statement"', want: false, why: "a string on the NEXT line is a separate statement, not concatenation" },
  { span: 'def f():\n    """doc"""', want: false, why: "docstring-only body, nothing adjacent" },
];
for (const c of ADJ) {
  test(`pyDocstringHasAdjacentLiteral: ${c.why} -> ${c.want}`, () => {
    const doc = pyLeadingDocstring(c.span);
    assert.ok(doc, "the leading docstring is found");
    assert.strictEqual(pyDocstringHasAdjacentLiteral(c.span, doc.end), c.want, c.why);
  });
}

let pythonOk = true;
try {
  execFileSync("python3", ["-c", "import ast"], { stdio: "ignore" });
} catch {
  pythonOk = false;
}
const parses = (src) => {
  try {
    execFileSync("python3", ["-c", "import ast,sys; ast.parse(sys.stdin.read())"], { input: src, stdio: ["pipe", "ignore", "pipe"] });
    return true;
  } catch {
    return false;
  }
};

// Reproduce the command's body-only edit exactly, from headStart..range.end. The
// body indents to the DOCSTRING's own column (bodyIndent), read from its line —
// never a hardcoded 4 (the review BLOCKER).
function bodyOnlySplice(fullDoc, headStart, rangeEnd, modelBody) {
  const spanText = fullDoc.slice(headStart, rangeEnd);
  const doc = pyLeadingDocstring(spanText);
  assert.ok(doc && !doc.sameLineAsHeader, "the fixture must have a leading (non-one-liner) docstring");
  const lineStart = spanText.lastIndexOf("\n", doc.start - 1) + 1;
  const bodyIndent = spanText.slice(lineStart, doc.start);
  const span = { start: headStart + doc.end, end: rangeEnd };
  const replacement = "\n" + reindentPyBlock(modelBody, bodyIndent);
  const rawDocstring = spanText.slice(doc.start, doc.end);
  return { result: spliceSpan(fullDoc, span, replacement), rawDocstring, bodyIndent };
}

// [name, fullDoc, headStart, rangeEnd, modelBody, bodyNeedle]
const CASES = [
  [
    "top-level fn, single-line docstring, real body",
    'def add(a, b):\n    """Add two ints."""\n    return 0\n',
    0, 'def add(a, b):\n    """Add two ints."""\n    return 0'.length,
    "return a + b", "\n    return a + b",
  ],
  [
    "2-SPACE file: body indents to the docstring's column (2), not a hardcoded 4 (BLOCKER fix)",
    'def add(a, b):\n  """Add two ints."""\n  return 0\n',
    0, 'def add(a, b):\n  """Add two ints."""\n  return 0'.length,
    "return a + b", "\n  return a + b",
  ],
  [
    "TAB file: body indents to the docstring's tab column (BLOCKER fix)",
    'def add(a, b):\n\t"""Add two ints."""\n\treturn 0\n',
    0, 'def add(a, b):\n\t"""Add two ints."""\n\treturn 0'.length,
    "return a + b", "\n\treturn a + b",
  ],
  [
    "top-level fn, multi-line docstring, body with a nested block",
    'def parse(data):\n    """Parse.\n\n    more.\n    """\n    return data\n',
    0, 'def parse(data):\n    """Parse.\n\n    more.\n    """\n    return data'.length,
    "if data:\n    return data\nreturn None", "\n    if data:\n        return data\n    return None",
  ],
  [
    "class with a docstring, members below",
    'class Cfg:\n    """A config."""\n    old = 0\n',
    0, 'class Cfg:\n    """A config."""\n    old = 0'.length,
    "host: str\nport: int", "\n    host: str\n    port: int",
  ],
  [
    "docstring-only body (empty span -> INSERT below the docstring)",
    'def only_doc():\n    """A stub."""\n',
    0, 'def only_doc():\n    """A stub."""'.length,
    "return None", "\n    return None",
  ],
  [
    "escaped triple-quote inside the docstring stays byte-exact (DO-2: escape-aware close)",
    'def f():\n    """a\\""" b"""\n    old = 0\n',
    0, 'def f():\n    """a\\""" b"""\n    old = 0'.length,
    "return 1", "\n    return 1",
  ],
  [
    "body member holding a multi-line string is byte-exact",
    'class C:\n    """doc."""\n    x = 0\n',
    0, 'class C:\n    """doc."""\n    x = 0'.length,
    'text = """\nline one\n  line two\n"""', "\n    text = ",
  ],
];

for (const [name, fullDoc, headStart, rangeEnd, modelBody, bodyNeedle] of CASES) {
  test(`body-only splice: ${name}`, () => {
    const { result, rawDocstring } = bodyOnlySplice(fullDoc, headStart, rangeEnd, modelBody);
    // The docstring survives byte-exact, in its original position.
    assert.ok(result.includes(rawDocstring), `the docstring must be preserved byte-exact, got:\n${result}`);
    // The generated body landed at the body column.
    assert.ok(result.includes(bodyNeedle), `the body must land indented, got:\n${result}`);
    if (pythonOk) {
      assert.ok(parses(result), `the spliced result must be valid Python, got:\n${result}`);
    }
  });
}

// A NESTED method with a docstring: the body indents to the method-body column (8).
test("body-only splice: nested method with a docstring, body at col 8, parses", () => {
  const fullDoc =
    "class Outer:\n" + // 0
    "    def m(self):\n" + // 1  headStart at col 4
    '        """Method doc."""\n' + // 2
    "        old = 0\n"; // 3
  const headStart = fullDoc.indexOf("def m");
  const rangeEnd = fullDoc.indexOf("old = 0") + "old = 0".length;
  const { result, rawDocstring } = bodyOnlySplice(fullDoc, headStart, rangeEnd, "self.x = 1");
  assert.ok(result.includes(rawDocstring), "the method docstring is preserved byte-exact");
  assert.ok(result.includes("\n        self.x = 1"), `the body indents to col 8, got:\n${result}`);
  if (pythonOk) assert.ok(parses(result), `must parse, got:\n${result}`);
});

// ===== The model answers IN PLACE ==========================================
// The prompt shows a written header and docstring and asks for the body below
// them, so a model that indents its statements under that header is obeying.
// Prepending the body column to those bytes stacked a second level in the file.
// Every row below is that reply shape; the needle is the ONE-level answer.
//
// [name, fullDoc, modelBody, bodyNeedle]
const INDENTED_REPLIES = [
  [
    "4-space file: an indented reply lands at the docstring column, not two levels deep",
    'def add(a, b):\n    """Add two ints."""\n    return 0\n',
    "    return a + b",
    "\n    return a + b\n",
  ],
  [
    "2-space file: the reply's own 4-space level is stripped, the file's 2 goes on",
    'def add(a, b):\n  """Add two ints."""\n  return 0\n',
    "    return a + b",
    "\n  return a + b\n",
  ],
  [
    "an indented reply keeps its INTERNAL shape: nested block still one level below its if",
    'def parse(data):\n    """Parse."""\n    return data\n',
    "    if data:\n        return data\n    return None",
    "\n    if data:\n        return data\n    return None\n",
  ],
  [
    "a blank line inside an indented reply stays blank, never indented whitespace",
    'def add(a, b):\n    """Add two ints."""\n    return 0\n',
    "    total = a + b\n\n    return total",
    "\n    total = a + b\n\n    return total\n",
  ],
];
for (const [name, fullDoc, modelBody, bodyNeedle] of INDENTED_REPLIES) {
  test(`body-only splice, model answered in place: ${name}`, () => {
    const rangeEnd = fullDoc.trimEnd().length;
    const { result, rawDocstring } = bodyOnlySplice(fullDoc, 0, rangeEnd, modelBody);
    assert.ok(result.includes(rawDocstring), `the docstring must be preserved byte-exact, got:\n${result}`);
    assert.ok(result.includes(bodyNeedle), `the body must land ONE level under the header, got:\n${result}`);
    if (pythonOk) assert.ok(parses(result), `the spliced result must be valid Python, got:\n${result}`);
  });
}

// Python lets a `#` sit at ANY column, so a comment must never decide where the
// block's own column zero is. A hanging comment used to collapse the shared
// prefix to nothing, which handed the whole block back at its original depth:
// the double indent, restored, in its parse-breaking form (review finding 1).
const HANGING_COMMENTS = [
  [
    "a flush-left comment above an indented body does not veto the dedent",
    "# explain\n    return a + b",
    "\n    # explain\n    return a + b\n",
  ],
  [
    "a partially-indented comment does not drag the base with it",
    "  # explain\n    return a + b",
    "\n    # explain\n    return a + b\n",
  ],
  [
    "a comment DEEPER than the body keeps its depth, because the body set the base",
    "    total = a + b\n        # why\n    return total",
    "\n    total = a + b\n        # why\n    return total\n",
  ],
  [
    "an all-comment block has only comments to measure, so they set the base themselves",
    "    # step one\n    # step two",
    "\n    # step one\n    # step two\n",
  ],
];
for (const [name, modelBody, bodyNeedle] of HANGING_COMMENTS) {
  test(`body-only splice, hanging comment: ${name}`, () => {
    const fullDoc = 'def add(a, b):\n    """Add two ints."""\n    return 0\n';
    const { result } = bodyOnlySplice(fullDoc, 0, fullDoc.trimEnd().length, modelBody);
    assert.ok(result.includes(bodyNeedle), `expected ${JSON.stringify(bodyNeedle)}, got:\n${result}`);
    if (pythonOk) assert.ok(parses(result), `the spliced result must be valid Python, got:\n${result}`);
  });
}

// Inside an open bracket Python allows any column at all, so a continuation line
// is not a statement and must not vote on where the block sits. One of them at
// column 0 used to collapse the base and hand the whole block back at its
// original depth: the double indent, restored (review round 2, finding 1).
const CONTINUATIONS = [
  [
    "a call whose arguments sit at column 0 does not veto the dedent",
    "    x = foo(\na,\nb,\n)\n    return x",
    "\n    x = foo(\n    a,\n    b,\n    )\n    return x\n",
  ],
  [
    "a dict literal broken across lines, same shape",
    "    d = {\n'k': 1,\n}\n    return d",
    "\n    d = {\n    'k': 1,\n    }\n    return d\n",
  ],
  [
    "a backslash continuation is free-column too",
    "    total = a + \\\nb\n    return total",
    "\n    total = a + \\\n    b\n    return total\n",
  ],
  [
    "an indented continuation inside an indented reply keeps the statements aligned",
    "    x = foo(\n        a,\n    )\n    return x",
    "\n    x = foo(\n        a,\n    )\n    return x\n",
  ],
];
for (const [name, modelBody, bodyNeedle] of CONTINUATIONS) {
  test(`body-only splice, bracket continuation: ${name}`, () => {
    const fullDoc = 'def add(a, b):\n    """Add two ints."""\n    return 0\n';
    const { result } = bodyOnlySplice(fullDoc, 0, fullDoc.trimEnd().length, modelBody);
    assert.ok(result.includes(bodyNeedle), `expected ${JSON.stringify(bodyNeedle)}, got:\n${result}`);
    if (pythonOk) assert.ok(parses(result), `the spliced result must be valid Python, got:\n${result}`);
  });
}

// A multi-line string inside an indented reply: the opener is code and dedents
// with the rest, the string's own lines must not move a byte.
test("body-only splice, model answered in place: a multi-line string's contents never shift", () => {
  const fullDoc = 'def banner():\n    """The banner."""\n    old = 0\n';
  const rangeEnd = fullDoc.indexOf("old = 0") + "old = 0".length;
  const { result } = bodyOnlySplice(fullDoc, 0, rangeEnd, '    text = """\nline one\n  line two\n"""\n    return text');
  assert.ok(result.includes('\n    text = """\nline one\n  line two\n"""\n    return text'), `string contents byte-exact, got:\n${result}`);
  if (pythonOk) assert.ok(parses(result), `must parse, got:\n${result}`);
});

// A nested method, the same in-place reply shape: one level under the docstring
// at col 8, not col 12.
test("body-only splice, model answered in place: nested method body lands at col 8", () => {
  const fullDoc = "class Outer:\n    def m(self):\n" + '        """Method doc."""\n' + "        old = 0\n";
  const headStart = fullDoc.indexOf("def m");
  const rangeEnd = fullDoc.indexOf("old = 0") + "old = 0".length;
  const { result } = bodyOnlySplice(fullDoc, headStart, rangeEnd, "        self.x = 1");
  assert.ok(result.includes("\n        self.x = 1"), `the body indents to col 8, got:\n${result}`);
  assert.ok(!result.includes("\n            self.x"), `and not to col 12, got:\n${result}`);
  if (pythonOk) assert.ok(parses(result), `must parse, got:\n${result}`);
});

// The docstring is preserved even when it contains a tricky quote.
test("body-only splice: a docstring with an embedded quote survives byte-exact", () => {
  const fullDoc = 'def f():\n    """Say \\"hi\\"."""\n    old = 0\n';
  const rangeEnd = fullDoc.indexOf("old = 0") + "old = 0".length;
  const { result, rawDocstring } = bodyOnlySplice(fullDoc, 0, rangeEnd, "return 1");
  assert.ok(result.includes(rawDocstring), "the embedded-quote docstring is byte-exact");
  if (pythonOk) assert.ok(parses(result), `must parse, got:\n${result}`);
});
