// IMPLEMENTER tests - session-v51 phase 1: the Python measurement rig.
// Proves the pieces that need neither a live pyright nor a corpus: the
// function scanner (`lib-py-scan.cjs`) and the placement rules (`lib-py.cjs`),
// against synthetic Python snippets.
//
// Python has no braces, so every span rule here is a DEDENT rule, and each of
// the rows below is a shape that would silently truncate or over-run a span if
// the rule were the obvious one. The live half - that lib-py.cjs's buildTests
// really runs the product's pyright and really distinguishes a good body from a
// broken one - is impl-v51-p1-pyrig-live.test.cjs.
//
// Run: SKIP_LIVE=1 node --test test/impl-v51-p1-pyrig.test.cjs

// THE MEASUREMENT RIG LIVES IN A DIFFERENT REPOSITORY (2026-08-10). It and the
// session archives were split into a private repo because they carry corpora
// taken against private client code and cannot be published, so a public clone
// has no `session-complxity-research/` and the rows below have no subject.
const { RIG_PRESENT, SKIP_REASON } = require("./.rig-present.cjs");
if (!RIG_PRESENT) {
  require("node:test")("rig-dependent rows", { skip: SKIP_REASON }, () => {});
  return;
}

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const { classify, scanFunctions, headerColon, indentWidthOf, CLS_CODE, CLS_STRING, CLS_COMMENT } = require("../session-complxity-research/spikes/lib-py-scan.cjs");

/** The one function in `src`, or a failure naming what was found instead. */
function only(src) {
  const fns = scanFunctions(src);
  assert.equal(fns.length, 1, `expected one def, got ${fns.length}: ${fns.map((f) => f.name).join(",")}`);
  return fns[0];
}

// ---------------------------------------------------------------------------
// classify
// ---------------------------------------------------------------------------

test("classify: a `#` inside a string is not a comment, and a quote inside a comment is not a string", () => {
  const src = 's = "a # b"\n# a "quote" here\nx = 1\n';
  const cls = classify(src);
  assert.equal(cls[src.indexOf("# b")], CLS_STRING);
  assert.equal(cls[src.indexOf('# a "quote"')], CLS_COMMENT);
  assert.equal(cls[src.indexOf('"quote"')], CLS_COMMENT);
  assert.equal(cls[src.indexOf("x = 1")], CLS_CODE);
});

test("classify: a triple-quoted string swallows newlines, a single-quoted one stops at the newline", () => {
  const triple = 'x = """a\nb"""\ny = 1\n';
  const c1 = classify(triple);
  assert.equal(c1[triple.indexOf("\nb")], CLS_STRING);
  assert.equal(c1[triple.indexOf("y = 1")], CLS_CODE);

  // An unterminated single-quoted literal must not eat the rest of the file.
  const broken = 'x = "a\ny = 1\n';
  const c2 = classify(broken);
  assert.equal(c2[broken.indexOf("y = 1")], CLS_CODE);
});

test("classify: prefixed literals are string from the prefix, and a raw string's escaped quote does not close it", () => {
  const src = 'a = rb"x"\nb = f"{n}"\nc = r"\\""\nd = 1\n';
  const cls = classify(src);
  assert.equal(cls[src.indexOf("rb")], CLS_STRING);
  assert.equal(cls[src.indexOf("f\"")], CLS_STRING);
  // Everything through the raw literal's real closing quote is string; the
  // assignment after it is code. If `r"\""` were read as closing at the
  // escaped quote, `d = 1` would land inside a literal.
  assert.equal(cls[src.indexOf("d = 1")], CLS_CODE);
});

test("classify: a bare identifier abutting a quote is not a prefix", () => {
  const src = 'foo"bar"\n';
  const cls = classify(src);
  assert.equal(cls[0], CLS_CODE, "`foo` is an identifier, not a string prefix");
});

// ---------------------------------------------------------------------------
// The span rule
// ---------------------------------------------------------------------------

test("scanFunctions: declStart, the colon, and an inclusive bodyClose on the simplest def", () => {
  const src = 'def add(a, b):\n    return a + b\n';
  const f = only(src);
  assert.equal(f.name, "add");
  assert.equal(src.slice(f.declStart, f.declStart + 3), "def");
  assert.equal(src[f.bodyOpen], ":");
  assert.equal(f.signature, "def add(a, b):");
  // bodyClose is the LAST character of the body, inclusive, with the trailing
  // newline outside the span.
  assert.equal(src[f.bodyClose], "b");
  assert.equal(src.slice(f.declStart, f.bodyClose + 1), "def add(a, b):\n    return a + b");
});

test("scanFunctions: the colon that ends the header is at bracket depth 0, never a default's or an annotation's", () => {
  const src = 'def f(a: int = 1, b: dict = {1: 2}, c: list = [x for x in y]) -> dict:\n    return b\n';
  const f = only(src);
  assert.equal(src[f.bodyOpen], ":");
  assert.equal(f.signature.endsWith("-> dict:"), true, f.signature);
  assert.equal(headerColon(src, classify(src), f.declStart), f.bodyOpen);
});

test("scanFunctions: a multi-line parameter list keeps the header intact", () => {
  const src = "def f(\n    a,\n    b,\n):\n    return a\n";
  const f = only(src);
  assert.equal(f.signature, "def f(\n    a,\n    b,\n):");
  assert.equal(src.slice(f.bodyClose - 7, f.bodyClose + 1), "return a");
});

const TABLE = [
  {
    name: "a blank line inside the body does not end it",
    src: "def f():\n    a = 1\n\n    b = 2\n",
    tail: "b = 2",
  },
  {
    name: "a comment at column 0 inside the body does not end it",
    src: "def f():\n    a = 1\n# a banner\n    b = 2\n",
    tail: "b = 2",
  },
  {
    name: "a trailing indented comment belongs to the body",
    src: "def f():\n    a = 1\n    # why\n\ndef g():\n    pass\n",
    tail: "# why",
  },
  {
    name: "a bracket continuation at column 0 does not end the body",
    src: "def f():\n    x = foo(\n1,\n)\n    return x\n",
    tail: "return x",
  },
  {
    name: "a triple-quoted string with a column-0 line does not end the body",
    src: 'def f():\n    s = """\nflush left\n"""\n    return s\n',
    tail: "return s",
  },
  {
    name: "a backslash continuation at column 0 does not end the body",
    src: "def f():\n    x = 1 + \\\n2\n    return x\n",
    tail: "return x",
  },
  {
    name: "the next def at the same indent ends the body",
    src: "def f():\n    a = 1\n\ndef g():\n    b = 2\n",
    tail: "a = 1",
  },
  {
    name: "a dedented statement ends the body and trailing blanks stay outside it",
    src: "def f():\n    a = 1\n\n\nx = 2\n",
    tail: "a = 1",
  },
];

for (const row of TABLE) {
  test(`bodyEnd: ${row.name}`, () => {
    const f = scanFunctions(row.src)[0];
    assert.ok(f, `${row.name}: no def scanned`);
    const span = row.src.slice(f.declStart, f.bodyClose + 1);
    assert.ok(span.endsWith(row.tail), `${row.name}: span ended "${span.slice(-30)}", expected to end "${row.tail}"`);
  });
}

test("scanFunctions: nested defs and methods carry their enclosing class path", () => {
  const src =
    "class A:\n" +
    "    def m(self):\n" +
    "        def inner():\n" +
    "            return 1\n" +
    "        return inner()\n" +
    "\n" +
    "class B:\n" +
    "    class C:\n" +
    "        def n(self):\n" +
    "            return 2\n";
  const fns = scanFunctions(src);
  const m = fns.find((f) => f.name === "m");
  const inner = fns.find((f) => f.name === "inner");
  const n = fns.find((f) => f.name === "n");
  assert.equal(m.typePath, "A");
  assert.equal(m.kind, "method");
  assert.equal(inner.isNested, true);
  assert.equal(inner.typePath, "A");
  assert.equal(n.typePath, "B.C");
  // The method's span ends at its own last line, never at the class's.
  assert.ok(src.slice(m.declStart, m.bodyClose + 1).endsWith("return inner()"));
});

test("scanFunctions: async and decorated defs, and the decorator sits at attrStart", () => {
  const src = "@deco(1)\n@other\nasync def go(x):\n    return x\n";
  const f = only(src);
  assert.equal(f.isAsync, true);
  assert.equal(src.slice(f.declStart, f.declStart + 9), "async def");
  assert.equal(f.attrStart, 0, "attrStart is the FIRST of the contiguous decorators");
});

test("scanFunctions: a one-line def is reported as skipped, never as a row", () => {
  const src = "def f(): return 1\n\ndef g():\n    return 2\n";
  const fns = scanFunctions(src);
  assert.deepEqual(fns.map((f) => f.name), ["g"]);
  assert.equal(fns.skipped.inlineBody, 1);
});

test("scanFunctions: the docstring is located with absolute offsets and its own bodyIndent", () => {
  const src = 'class A:\n    def m(self):\n        """Doc.\n\n        More.\n        """\n        return 1\n';
  const f = scanFunctions(src).find((x) => x.name === "m");
  assert.equal(src.slice(f.docStart, f.docEnd), f.docComment);
  assert.ok(f.docComment.startsWith('"""Doc.'));
  assert.ok(f.docComment.endsWith('"""'));
  assert.equal(f.bodyIndent, "        ");
  assert.equal(src[f.docEnd], "\n", "docEnd is exclusive and the next byte is the newline spliceBody writes");
});

test("scanFunctions: a def whose first statement is code has no docstring", () => {
  const f = only("def f():\n    x = 1\n    return x\n");
  assert.equal(f.docComment, undefined);
  assert.equal(f.docStart, undefined);
});

test("scanFunctions: a string used as a statement AFTER real code is not the docstring", () => {
  const f = only('def f():\n    x = 1\n    "not a docstring"\n    return x\n');
  assert.equal(f.docComment, undefined);
});

test("indentWidthOf: a tab counts 8 columns to the next stop", () => {
  assert.equal(indentWidthOf("    x"), 4);
  assert.equal(indentWidthOf("\tx"), 8);
  assert.equal(indentWidthOf("  \tx"), 8);
  assert.equal(indentWidthOf("\t\tx"), 16);
});

// ---------------------------------------------------------------------------
// Placement. These are the rules two wrong answers were shipped and measured
// against before the right one; see lib-py.cjs's placeAtColumn comment.
// ---------------------------------------------------------------------------

const { placeAtColumn, placeBodyAtColumn, assertOffsets } = require("../session-complxity-research/spikes/lib-py.cjs");

test("placeAtColumn: a reply at column 0 and the function's own bytes land identically", () => {
  // Both inputs are SELF-CONSISTENT - the `def` at some column and every other
  // line relative to it. That is the contract, and `committedFunctionText`
  // exists so the corpus side of it cannot be got wrong.
  const fromModel = "def m(self):\n    return 1\n";
  const fromFile = "    def m(self):\n        return 1\n";
  assert.equal(placeAtColumn(fromModel, "    "), "def m(self):\n        return 1\n");
  assert.equal(placeAtColumn(fromFile, "    "), "def m(self):\n        return 1\n");
});

test("placeAtColumn: an already-indented reply is PLACED, not SHIFTED", () => {
  const out = placeAtColumn("    def m(self):\n        return 1", "    ");
  assert.equal(out, "def m(self):\n        return 1");
});

test("placeAtColumn: a WRAPPED SIGNATURE keeps its own geometry, it is not body", () => {
  // graph_engine.py:list_nodes. The lines between the `def` and the header's
  // `:` are not body lines: giving them the body's column pushed the parameter
  // list to 12 and the closing `) -> ...` to 8. Invisible until the
  // span-scoped population admitted the file that has one.
  const src = "    def f(\n        a, b\n    ) -> int:\n        return a\n";
  assert.equal(placeAtColumn(src, "    "), "def f(\n        a, b\n    ) -> int:\n        return a\n");
  const fromModel = "def f(\n    a, b\n) -> int:\n    return a\n";
  assert.equal(placeAtColumn(fromModel, "    "), "def f(\n        a, b\n    ) -> int:\n        return a\n");
});

test("placeAtColumn: a line inside a multi-line string keeps its own column", () => {
  const src = 'def m(self):\n    s = """\nflush left\n"""\n    return s';
  const out = placeAtColumn(src, "    ");
  const lines = out.split("\n");
  assert.equal(lines[0], "def m(self):");
  assert.equal(lines[1], '        s = """');
  assert.equal(lines[2], "flush left", "the string's interior is data and must not move");
  assert.equal(lines[4], "        return s");
});

test("placeBodyAtColumn: every line moves, including the first", () => {
  const out = placeBodyAtColumn("try:\n    x = 1\nexcept E:\n    pass", "        ");
  assert.equal(out, "        try:\n            x = 1\n        except E:\n            pass");
});

test("placeBodyAtColumn: an already-indented body is re-based, and blank lines stay empty", () => {
  const out = placeBodyAtColumn("    a = 1\n\n    b = 2", "  ");
  assert.equal(out, "  a = 1\n\n  b = 2");
});

// ---------------------------------------------------------------------------
// The span-scoped verdict. The RULE is the product's (`spanScopedVerdict`,
// src/core/repair.ts); what is tested here is the rig's half - the byte
// arithmetic that builds the scope, and that the three-way verdict is carried
// out whole instead of collapsed to a boolean.
// ---------------------------------------------------------------------------

const { repairScopeFor, gradeSpan, ROOT: PY_ROOT } = require("../session-complxity-research/spikes/lib-py.cjs");

const CAND = { file: "repo/mod.py", crate: "repo" };
const ABS = path.join(PY_ROOT, CAND.file);

/** A pyright-shaped error Diagnostic at a byte range. */
const errAt = (byteStart, byteEnd, message = "boom", fileName = ABS) => ({
  kind: "compile-error",
  level: "error",
  code: "reportTest",
  message,
  spans: [{ fileName, byteStart, byteEnd, lineStart: 1, lineEnd: 1, columnStart: 1, columnEnd: 1, isPrimary: true }],
  suggestions: [],
});

test("repairScopeFor: the scope is UTF-8 BYTES, not JS string indices", () => {
  // The diagnostics' offsets come from PyOracle's line/col-to-byte conversion,
  // so a scope in string indices would drift by one per non-ASCII character and
  // the drift is silent - it just moves which errors count as the row's.
  const text = "# é é é\ndef f():\n    pass\n";
  const start = text.indexOf("def");
  const scope = repairScopeFor(CAND, text, start, text.length);
  assert.equal(scope.byteStart, Buffer.byteLength(text.slice(0, start), "utf8"));
  assert.notEqual(scope.byteStart, start, "the fixture must actually contain multi-byte characters");
  assert.equal(scope.byteEnd - scope.byteStart, Buffer.byteLength(text.slice(start), "utf8"));
  assert.equal(scope.filePath, ABS);
});

test("gradeSpan: partitions the diagnostics and keeps the out-of-span ones", () => {
  const text = "x = 1\ndef f():\n    pass\n";
  const start = text.indexOf("def");
  const check = {
    crateRoot: path.join(PY_ROOT, "repo"),
    diagnostics: [
      errAt(0, 1, "pre-existing, above the row"),
      errAt(start + 2, start + 3, "the generation's own"),
      { kind: "compile-warning", level: "warning", message: "ignored", spans: [], suggestions: [] },
    ],
  };
  const v = gradeSpan(CAND, check, text, start, text.length);
  assert.equal(v.kind, "in-span");
  assert.equal(v.ok, false);
  assert.equal(v.inSpan.length, 1);
  assert.match(v.inSpan[0], /the generation's own/);
  // The pre-existing error is RECORDED, never dropped - that is the whole
  // reason the verdict is three-way and not a boolean.
  assert.equal(v.outOfSpan.length, 1);
  assert.match(v.outOfSpan[0], /pre-existing/);
  assert.deepEqual(v.outOfSpanFiles, [ABS]);
});

const VERDICT_TABLE = [
  { name: "no errors at all is green", errors: [], kind: "green", ok: true, inSpan: 0, outOfSpan: 0 },
  { name: "errors only outside the span is clean-out-of-span", errors: [errAt(0, 1)], kind: "clean-out-of-span", ok: true, inSpan: 0, outOfSpan: 1 },
  { name: "one error inside the span is in-span", errors: [errAt(10, 11)], kind: "in-span", ok: false, inSpan: 1, outOfSpan: 0 },
  { name: "an error in ANOTHER file is out of span", errors: [errAt(10, 11, "elsewhere", path.join(PY_ROOT, "repo/other.py"))], kind: "clean-out-of-span", ok: true, inSpan: 0, outOfSpan: 1 },
];

for (const row of VERDICT_TABLE) {
  test(`gradeSpan: ${row.name}`, () => {
    const text = "abcdefghij" + "klmnopqrst"; // span is [10, 20)
    const v = gradeSpan(CAND, { crateRoot: path.join(PY_ROOT, "repo"), diagnostics: row.errors }, text, 10, 20);
    assert.equal(v.kind, row.kind);
    assert.equal(v.ok, row.ok);
    assert.equal(v.inSpanCount, row.inSpan);
    assert.equal(v.outOfSpanCount, row.outOfSpan);
  });
}

test("gradeSpan: an error with the -1 no-offset sentinel is counted unplaced, never in-span", () => {
  // PyOracle emits -1 when it cannot convert a position (unreadable file, or
  // the autosave guard). Counting such an error as the row's would be a
  // confidently-wrong red; counting it as somebody else's would be a false
  // green. It is out-of-span AND unplaced, so the record can say so.
  const d = errAt(-1, -1, "no geometry");
  const v = gradeSpan(CAND, { crateRoot: path.join(PY_ROOT, "repo"), diagnostics: [d] }, "abcdefghijklmnopqrst", 10, 20);
  assert.equal(v.kind, "clean-out-of-span");
  assert.equal(v.unplaced, 1);
  assert.deepEqual(v.outOfSpanFiles, [], "an unplaced error may not name a file as outside");
});

test("assertOffsets: THROWS on a stale span rather than skipping the row", () => {
  const src = "def add(a, b):\n    return a + b\n";
  const good = { file: "x.py", name: "add", declStart: 0, bodyOpen: src.indexOf(":"), bodyClose: src.length - 2 };
  assert.doesNotThrow(() => assertOffsets(good, src));

  const cases = [
    ["bodyOpen off the colon", { ...good, bodyOpen: good.bodyOpen + 1 }],
    ["bodyClose on whitespace", { ...good, bodyClose: src.indexOf("\n") }],
    ["a different function's name", { ...good, name: "sub" }],
    ["declStart past the header", { ...good, declStart: 4 }],
  ];
  for (const [why, cand] of cases) {
    assert.throws(() => assertOffsets(cand, src), /stale offsets/, `${why}: expected a throw`);
  }
});
