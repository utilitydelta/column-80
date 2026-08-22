// BLIND ORACLE — session-v45 phase 0, the C# method scanner.
//
// Bound to the phase 0 contract and to nothing else. Written WITHOUT reading
// the rig's lib-cs-scan.cjs, 01-corpus-cs.cjs or lib-cs.cjs — the only
// mirror-language material read was lib-go-scan.cjs's classify contract and
// test/impl-v40-p2-go-rig.test.cjs's conventions. Every expectation below
// comes from the contract's words plus hand-computed byte arithmetic over the
// snippet in the row.
//
// If a row and the scanner disagree, that is a FINDING to be settled in
// writing (an A-number amendment in the contract) before either side moves.
// No row here may be edited to match observed output.
//
// The contract's "Falsification depth" section is the marching order: classify
// is the piece most likely to be subtly wrong, and a wrong class does not
// throw — it silently moves a bodyClose. So the classify rows assert the class
// of individual byte positions through segment lists that must reproduce the
// source exactly, and the scanMethods rows assert byte offsets, never just
// "a method was found".
//
// Run: SKIP_LIVE=1 node --test test/blind-v45-csscan.test.cjs
// No GPU, no network, no LSP, no toolchain. The real-corpus rows at the bottom
// only READ files, so they gate on the corpus existing (skip, never fail),
// not on SKIP_LIVE.

// THE MEASUREMENT RIG LIVES IN A DIFFERENT REPOSITORY (2026-08-10). It and the
// session archives were split into a private repo because they carry corpora
// taken against private client code and cannot be published, so a public clone
// has no `session-complxity-research/` and the rows below have no subject.
//
// The whole file skips, with the reason on the channel. It SKIPS rather than
// passing vacuously: a row that goes green when the thing it tests is absent is
// the false green this suite exists to prevent. Where a baseline can be
// vendored instead, vendor it (see test/fixtures/prompt) and do not use this.
const { RIG_PRESENT, SKIP_REASON } = require("./.rig-present.cjs");
if (!RIG_PRESENT) {
  require("node:test")("rig-dependent rows", { skip: SKIP_REASON }, () => {});
  return;
}

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

// The module is required defensively so that a missing or half-written
// implementation reports as a per-row failure with a clear message instead of
// aborting the whole file at load time — which would also hide any arithmetic
// error in the rows themselves. The rows still exercise the real exports.
let mod = {};
let modErr = null;
try {
  mod = require("../session-complxity-research/spikes/lib-cs-scan.cjs");
} catch (e) {
  modErr = e;
}
function api() {
  if (modErr) throw new Error(`lib-cs-scan.cjs did not load: ${modErr.message}`);
  return mod;
}
const classify = (text) => api().classify(text);
const matchBrace = (text, cls, open) => api().matchBrace(text, cls, open);
const scanMethods = (text) => api().scanMethods(text);
const enclosingTypeOf = (text, cls, index) => api().enclosingTypeOf(text, cls, index);

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const CODE = 0;
const COMMENT = 1;
const STR = 2;
const ANY = -1; // a position the contract does not pin down; see the gap list.

/**
 * Assert a byte-class expectation as a list of [text, class] segments. The
 * segments must concatenate to `src` exactly — that check runs BEFORE
 * classify, so an arithmetic slip in the row is a distinct, loud failure and
 * can never be mistaken for a scanner defect.
 */
function expectClasses(src, segments) {
  assert.equal(segments.map((s) => s[0]).join(""), src, "row bug: the segment list must reproduce the source verbatim");
  const cls = classify(src);
  assert.equal(cls.length, src.length, "classify length must equal text.length exactly");
  let i = 0;
  for (const [seg, want] of segments) {
    for (let k = 0; k < seg.length; k++, i++) {
      if (want === ANY) continue;
      assert.equal(
        cls[i],
        want,
        `index ${i} (${JSON.stringify(src[i])}) inside segment ${JSON.stringify(seg)}: want class ${want}, got ${cls[i]}`,
      );
    }
  }
  return cls;
}

/** Byte offset of the nth (1-based) occurrence of `needle` in `src`. */
function at(src, needle, occurrence = 1) {
  let idx = -1;
  for (let k = 0; k < occurrence; k++) {
    idx = src.indexOf(needle, idx + 1);
    assert.notEqual(idx, -1, `row bug: occurrence ${occurrence} of ${JSON.stringify(needle)} is not in the snippet`);
  }
  return idx;
}

/** The contract's byte-exactness invariants, which every returned row must satisfy. */
function assertRowInvariants(text, cls, m, label) {
  assert.equal(text[m.bodyOpen], "{", `${label}: text[bodyOpen] must be "{"`);
  assert.equal(text[m.bodyClose], "}", `${label}: text[bodyClose] must be "}"`);
  assert.ok(m.declStart < m.bodyOpen, `${label}: declStart must precede bodyOpen`);
  assert.ok(m.bodyOpen < m.bodyClose, `${label}: bodyOpen must precede bodyClose`);
  assert.equal(matchBrace(text, cls, m.bodyOpen), m.bodyClose, `${label}: bodyClose must be bodyOpen's match`);
  assert.equal(m.signature, text.slice(m.declStart, m.bodyOpen).replace(/\s+$/, ""), `${label}: signature is the verbatim slice, trailing whitespace stripped`);
  assert.equal(m.body, text.slice(m.bodyOpen + 1, m.bodyClose), `${label}: body is the slice between the braces`);
  assert.equal(cls[m.declStart], CODE, `${label}: declStart is never inside a comment or a string`);
  assert.equal(m.isExpressionBodied, false, `${label}: isExpressionBodied is always false in this array`);
  const lineStart = text.lastIndexOf("\n", m.declStart - 1) + 1;
  const lead = text.slice(lineStart, m.declStart);
  if (/^\s*$/.test(lead)) {
    // Only checkable when nothing else shares the declaration's line; a
    // same-line attribute makes "the leading whitespace of the declaration's
    // first line" ambiguous (gap list).
    assert.equal(m.indent, lead, `${label}: indent is the leading whitespace of the declaration's first line, verbatim`);
  }
}

// ===========================================================================
// the module surface
// ===========================================================================

test("exports: classify, matchBrace, scanMethods and enclosingTypeOf are all functions", () => {
  const m = api();
  for (const name of ["classify", "matchBrace", "scanMethods", "enclosingTypeOf"]) {
    assert.equal(typeof m[name], "function", `module.exports.${name} must be a function`);
  }
});

// ===========================================================================
// classify — the five string forms, each holding a brace
// ===========================================================================

test("classify: a } inside a regular string literal is class 2, the code around it class 0", () => {
  const src = 'var s = "a}b";';
  expectClasses(src, [
    ["var s = ", CODE],
    ['"a}b"', STR],
    [";", CODE],
  ]);
});

test("classify: a backslash-escaped quote does not end a regular string, so the following } stays class 2", () => {
  const src = 'var s = "a\\"}b"; var t = 1;';
  expectClasses(src, [
    ["var s = ", CODE],
    ['"a\\"}b"', STR],
    ["; var t = 1;", CODE],
  ]);
});

test("classify: verbatim @\"a \"\"}\"\" b\" — \"\" is ONE literal quote, so the string does not end early", () => {
  const src = 'var p = @"a ""}"" b"; var q = 2;';
  expectClasses(src, [
    ["var p = ", CODE],
    ["@", ANY],
    ['"a ""}"" b"', STR],
    ["; var q = 2;", CODE],
  ]);
});

test("classify: a verbatim string spans lines, and the } inside it is class 2", () => {
  const src = 'var p = @"line1 }\nline2";\nvar q = 3;';
  expectClasses(src, [
    ["var p = ", CODE],
    ["@", ANY],
    ['"line1 }\nline2"', STR],
    [";\nvar q = 3;", CODE],
  ]);
});

test("classify: verbatim strings have NO backslash escapes — a trailing \\ does not swallow the closing quote", () => {
  const src = 'var p = @"C:\\dir\\"; var q = "}";';
  expectClasses(src, [
    ["var p = ", CODE],
    ["@", ANY],
    ['"C:\\dir\\"', STR],
    ["; var q = ", CODE],
    ['"}"', STR],
    [";", CODE],
  ]);
});

test("classify: raw string \"\"\"a \"\" } b\"\"\" — an embedded 2-quote run does not close a 3-quote raw string", () => {
  const src = 'var r = """a "" } b""";';
  expectClasses(src, [
    ["var r = ", CODE],
    ['"""a "" } b"""', STR],
    [";", CODE],
  ]);
});

test("classify: a 4-quote raw string is not closed by an embedded 3-quote run", () => {
  const src = 'var r = """"a """ } b"""";';
  expectClasses(src, [
    ["var r = ", CODE],
    ['""""a """ } b""""', STR],
    [";", CODE],
  ]);
});

test("classify: a raw string spanning lines holds its } as class 2 and hands the code back after the closing run", () => {
  const src = 'var r = """\n  a } b\n  """;\nvar q = 3;';
  expectClasses(src, [
    ["var r = ", CODE],
    ['"""\n  a } b\n  """', STR],
    [";\nvar q = 3;", CODE],
  ]);
});

test("classify: a '}' char literal is class 2, and the surrounding block braces stay class 0", () => {
  const src = "if (c == '}') { x++; }";
  const cls = expectClasses(src, [
    ["if (c == ", CODE],
    ["'}'", STR],
    [") { x++; }", CODE],
  ]);
  // and the block still matches, because the literal brace never counted
  assert.equal(matchBrace(src, cls, at(src, "{")), src.lastIndexOf("}"));
});

test("classify: a '\"' char literal does NOT open a string — the rest of the line stays code", () => {
  const src = 'if (c == \'"\') { x++; }';
  const cls = expectClasses(src, [
    ["if (c == ", CODE],
    ["'\"'", STR],
    [") { x++; }", CODE],
  ]);
  assert.equal(matchBrace(src, cls, at(src, "{")), src.lastIndexOf("}"));
});

test("classify: an escaped quote char literal '\\'' ends at the unescaped tick, not the escaped one", () => {
  const src = "if (c == '\\'') { x++; }";
  expectClasses(src, [
    ["if (c == ", CODE],
    ["'\\''", STR],
    [") { x++; }", CODE],
  ]);
});

test("classify: '\\u007D' is one char literal, class 2 throughout", () => {
  const src = "var c = '\\u007D';";
  expectClasses(src, [
    ["var c = ", CODE],
    ["'\\u007D'", STR],
    [";", CODE],
  ]);
});

// ===========================================================================
// classify — comments against strings, both directions
// ===========================================================================

test("classify: a quote inside a // comment does not open a string; a } inside it is class 1", () => {
  const src = '// he said "hi\nvar x = 1; // }\n';
  expectClasses(src, [
    ['// he said "hi', COMMENT],
    ["\n", ANY],
    ["var x = 1; ", CODE],
    ["// }", COMMENT],
    ["\n", ANY],
  ]);
});

test("classify: a // inside a string literal is not a comment — the code after the string is still class 0", () => {
  const src = 'var s = "// not a comment"; var y = 1;';
  expectClasses(src, [
    ["var s = ", CODE],
    ['"// not a comment"', STR],
    ["; var y = 1;", CODE],
  ]);
});

test("classify: a /* inside a string literal does not open a block comment", () => {
  const src = 'var s = "/* not a comment"; var y = 1;';
  expectClasses(src, [
    ["var s = ", CODE],
    ['"/* not a comment"', STR],
    ["; var y = 1;", CODE],
  ]);
});

test("classify: a block comment holding a } and a \" is class 1 through its closing */", () => {
  const src = 'var a = 1; /* } " */ var b = 2;';
  expectClasses(src, [
    ["var a = 1; ", CODE],
    ['/* } " */', COMMENT],
    [" var b = 2;", CODE],
  ]);
});

test("classify: an unterminated /* runs to end of text", () => {
  const src = 'var a = 1; /* } " \n more';
  expectClasses(src, [
    ["var a = 1; ", CODE],
    ['/* } " \n more', COMMENT],
  ]);
});

test("classify: a /// doc line is a comment (class 1), braces and quotes inside it included", () => {
  const src = '/// <summary>} "x"</summary>\nvar x = 1;';
  expectClasses(src, [
    ['/// <summary>} "x"</summary>', COMMENT],
    ["\n", ANY],
    ["var x = 1;", CODE],
  ]);
});

// ===========================================================================
// classify — interpolated strings: literal parts class 2, HOLES class 0
// ===========================================================================

test("classify: $\"x{a}y\" — the hole's contents are class 0, the delimiting { } are class 2", () => {
  const src = 'var s = $"x{a}y";';
  expectClasses(src, [
    ["var s = ", CODE],
    ["$", ANY],
    ['"x', STR],
    ["{", STR],
    ["a", CODE],
    ["}", STR],
    ['y"', STR],
    [";", CODE],
  ]);
});

test("classify: $\"{{x}}\" — 2N braces are escaped literal braces, so nothing inside is code", () => {
  const src = 'var s = $"{{x}}";';
  expectClasses(src, [
    ["var s = ", CODE],
    ["$", ANY],
    ['"', STR],
    ["{{x}}", STR],
    ['"', STR],
    [";", CODE],
  ]);
});

test("classify: a nested string inside an interpolation hole classifies normally, brace and all", () => {
  const src = 'var s = $"{F("}")}";';
  expectClasses(src, [
    ["var s = ", CODE],
    ["$", ANY],
    ['"', STR],
    ["{", STR],
    ["F(", CODE],
    ['"}"', STR],
    [")", CODE],
    ["}", STR],
    ['"', STR],
    [";", CODE],
  ]);
});

test("classify: a '}' char literal inside an interpolation hole does not close the hole", () => {
  const src = "var s = $\"{(c == '}' ? 1 : 2)}\";";
  expectClasses(src, [
    ["var s = ", CODE],
    ["$", ANY],
    ['"', STR],
    ["{", STR],
    ["(c == ", CODE],
    ["'}'", STR],
    [" ? 1 : 2)", CODE],
    ["}", STR],
    ['"', STR],
    [";", CODE],
  ]);
});

test("classify: braces of a lambda body inside an interpolation hole are class 0 and balance", () => {
  const src = 'var s = $"a{Run(() => { return 1; })}b";';
  const cls = expectClasses(src, [
    ["var s = ", CODE],
    ["$", ANY],
    ['"a', STR],
    ["{", STR],
    ["Run(() => ", CODE],
    ["{ return 1; }", CODE],
    [")", CODE],
    ["}", STR],
    ['b"', STR],
    [";", CODE],
  ]);
  // The lambda's own braces balance against each other, not against the hole:
  // the hole's delimiters are class 2 and so invisible to matchBrace.
  const lambdaOpen = at(src, "{ return");
  assert.equal(matchBrace(src, cls, lambdaOpen), src.indexOf("}", lambdaOpen));
});

test("classify: $$\"\"\"...\"\"\" — with N=2, a single { is literal and {{y}} opens a hole", () => {
  const src = 'var s = $$"""a { b {{y}} c""";';
  expectClasses(src, [
    ["var s = ", CODE],
    ["$$", ANY],
    ['"""a { b ', STR],
    ["{{", STR],
    ["y", CODE],
    ["}}", STR],
    [' c"""', STR],
    [";", CODE],
  ]);
});

test("classify: $@\"...\" is verbatim AND interpolated — \"\" is one quote and {b} is still a hole", () => {
  const src = 'var s = $@"a ""}"" {b} c";';
  expectClasses(src, [
    ["var s = ", CODE],
    ["$@", ANY],
    ['"a ""}"" ', STR],
    ["{", STR],
    ["b", CODE],
    ["}", STR],
    [' c"', STR],
    [";", CODE],
  ]);
});

test("classify: @$\"...\" (prefixes reversed) behaves identically to $@\"...\"", () => {
  const src = 'var s = @$"a ""}"" {b} c";';
  expectClasses(src, [
    ["var s = ", CODE],
    ["@$", ANY],
    ['"a ""}"" ', STR],
    ["{", STR],
    ["b", CODE],
    ["}", STR],
    [' c"', STR],
    [";", CODE],
  ]);
});

test("classify: AMBIGUITY — the @ prefix is bound here as part of the literal (class 2)", () => {
  // The contract's form table shows `@"C:\x ..."` as the form, prefix
  // included, but never states the prefix character's own class. Bound as 2;
  // see gap list. Nothing downstream depends on it, since matchBrace only
  // reads braces.
  const src = 'var s = @"x";';
  const cls = classify(src);
  assert.equal(cls[at(src, "@")], STR);
});

test("classify: length equals text.length exactly, empty text included, and every byte is 0, 1 or 2", () => {
  assert.equal(classify("").length, 0);
  const src = 'class C { void M() { var s = $"{a}"; /* c */ } } // end\n';
  const cls = classify(src);
  assert.equal(cls.length, src.length);
  assert.ok(cls instanceof Uint8Array, "classify returns a Uint8Array");
  for (let i = 0; i < cls.length; i++) {
    assert.ok(cls[i] === 0 || cls[i] === 1 || cls[i] === 2, `index ${i}: class ${cls[i]} is outside {0,1,2}`);
  }
});

// ===========================================================================
// matchBrace
// ===========================================================================

test("matchBrace: nested code braces resolve to the outer brace's own match", () => {
  const src = "{ a { b } c }";
  const cls = classify(src);
  assert.equal(matchBrace(src, cls, 0), src.length - 1);
  assert.equal(matchBrace(src, cls, at(src, "{", 2)), at(src, "}", 1));
});

test("matchBrace: a } in a string, a comment and a char literal are all skipped", () => {
  const src = '{ var s = "}"; /* } */ var c = \'}\'; }';
  const cls = classify(src);
  assert.equal(matchBrace(src, cls, 0), src.length - 1);
});

test("matchBrace: interpolation hole delimiters never affect the count", () => {
  const src = '{ var s = $"{a}{b}"; }';
  const cls = classify(src);
  assert.equal(matchBrace(src, cls, 0), src.length - 1);
});

test("matchBrace: returns -1 when the brace is unbalanced to end of text", () => {
  const src = "{ a { b }";
  const cls = classify(src);
  assert.equal(matchBrace(src, cls, 0), -1);
});

test("matchBrace: a } that only exists inside a string leaves the brace unbalanced (-1)", () => {
  const src = '{ var s = "}";';
  const cls = classify(src);
  assert.equal(matchBrace(src, cls, 0), -1);
});

// ===========================================================================
// scanMethods — byte-exactness on the C# brace-on-the-next-line convention
// ===========================================================================

const S_ALLMAN = ["class C", "{", "    public int Add(int a, int b)", "    {", "        return a + b;", "    }", "}", ""].join("\n");

test("scanMethods: Allman brace on the NEXT line — byte-exact declStart/bodyOpen/bodyClose", () => {
  const rows = scanMethods(S_ALLMAN);
  assert.equal(rows.length, 1);
  const m = rows[0];
  assert.equal(m.name, "Add");
  assert.equal(m.declStart, at(S_ALLMAN, "public int Add"));
  assert.equal(m.bodyOpen, at(S_ALLMAN, "{", 2));
  assert.equal(m.bodyClose, at(S_ALLMAN, "}", 1));
  assert.equal(S_ALLMAN.slice(m.declStart, m.bodyOpen + 1), "public int Add(int a, int b)\n    {");
  assert.equal(m.body, "\n        return a + b;\n    ");
  assertRowInvariants(S_ALLMAN, classify(S_ALLMAN), m, "Add");
});

test("scanMethods: signature is verbatim and un-normalized, with only trailing whitespace stripped", () => {
  const m = scanMethods(S_ALLMAN)[0];
  assert.equal(m.signature, "public int Add(int a, int b)");
  assert.equal(m.indent, "    ");
  assert.equal(m.kind, "method");
  assert.equal(m.implHeader, "C");
  assert.equal(m.typePath, "C");
  assert.equal(m.attrStart, undefined);
  assert.equal(m.docComment, undefined);
  assert.equal(m.isLocal, false);
  assert.equal(m.crossesDirective, false);
});

test("scanMethods: a brace on the SAME line as the signature is found too, with no newline in the signature", () => {
  const src = ["class C", "{", "    public int Add(int a) {", "        return a;", "    }", "}", ""].join("\n");
  const m = scanMethods(src)[0];
  assert.equal(m.signature, "public int Add(int a)");
  assert.equal(m.bodyOpen, at(src, "{", 2));
  assertRowInvariants(src, classify(src), m, "Add same-line");
});

test("scanMethods: a multi-line parameter list keeps the newlines in the signature verbatim", () => {
  const src = [
    "class C",
    "{",
    "    protected virtual void Attach(",
    "        IRegistry registry,",
    "        IRegistration registration)",
    "    {",
    "    }",
    "}",
    "",
  ].join("\n");
  const m = scanMethods(src)[0];
  assert.equal(m.name, "Attach");
  assert.equal(m.signature, "protected virtual void Attach(\n        IRegistry registry,\n        IRegistration registration)");
  assertRowInvariants(src, classify(src), m, "Attach");
});

test("scanMethods: no access modifier is required", () => {
  const src = ["class C", "{", "    int Add(int a)", "    {", "        return a;", "    }", "}", ""].join("\n");
  const rows = scanMethods(src);
  assert.deepEqual(rows.map((r) => r.name), ["Add"]);
  assert.equal(rows[0].declStart, at(src, "int Add"));
});

test("scanMethods: a generic, nullable, fully-qualified return type does not block the match", () => {
  const src = [
    "class C",
    "{",
    "    System.Collections.Generic.Dictionary<string, List<int>>? Build(int a)",
    "    {",
    "        return null;",
    "    }",
    "}",
    "",
  ].join("\n");
  const rows = scanMethods(src);
  assert.deepEqual(rows.map((r) => r.name), ["Build"]);
  assert.equal(rows[0].declStart, at(src, "System.Collections"));
  assert.equal(rows[0].signature, "System.Collections.Generic.Dictionary<string, List<int>>? Build(int a)");
  assertRowInvariants(src, classify(src), rows[0], "Build");
});

test("scanMethods: a TUPLE return type does not block the match — bare, array-of and nullable alike", () => {
  // The contract: "return types including generic, array, nullable, tuple and
  // fully-qualified forms ... none of them prevent a match". All three shapes
  // below are one method with a brace body each, so all three must be rows —
  // and anything dropped must land in `skipped`, since "nothing is silently
  // dropped by the scanner except what is not a method-with-a-body at all".
  const heads = [
    ["(int Count, string Name) Bare()", "Bare"],
    ["(int Count, string Name)[] Many()", "Many"],
    ["(int A, int B)? Maybe()", "Maybe"],
  ];
  for (const [head, name] of heads) {
    const src = ["class C", "{", `    ${head}`, "    {", "        return default;", "    }", "}", ""].join("\n");
    const rows = scanMethods(src);
    assert.deepEqual(rows.map((r) => r.name), [name], `${head}: expected exactly this method, skipped=${JSON.stringify({ ...rows.skipped })}`);
    assert.equal(rows[0].declStart, at(src, "("), `${head}: declStart is the first char of the return type`);
    assert.equal(rows[0].signature, head, `${head}: signature is verbatim`);
    assertRowInvariants(src, classify(src), rows[0], head);
  }
});

test("scanMethods: a generic method reports the bare name, with the type list still in the signature", () => {
  const src = ["class C", "{", "    public T Pick<T>(T a, T b)", "    {", "        return a;", "    }", "}", ""].join("\n");
  const m = scanMethods(src)[0];
  assert.equal(m.name, "Pick");
  assert.equal(m.signature, "public T Pick<T>(T a, T b)");
});

test("scanMethods: a where constraint clause between the parameter list and the brace is crossed, not stopped at", () => {
  const src = [
    "class C",
    "{",
    "    public T Pick<T>(T a, T b)",
    "        where T : class, new()",
    "    {",
    "        return a;",
    "    }",
    "}",
    "",
  ].join("\n");
  const rows = scanMethods(src);
  assert.equal(rows.length, 1, "the where clause must not hide the method");
  const m = rows[0];
  assert.equal(m.name, "Pick");
  assert.equal(m.signature, "public T Pick<T>(T a, T b)\n        where T : class, new()");
  assert.equal(m.bodyOpen, at(src, "{", 2));
  assertRowInvariants(src, classify(src), m, "Pick where");
});

test("scanMethods: two where clauses on separate lines are both inside the signature", () => {
  const src = [
    "class C",
    "{",
    "    public TOut Map<TIn, TOut>(TIn a)",
    "        where TIn : notnull",
    "        where TOut : class, new()",
    "    {",
    "        return default;",
    "    }",
    "}",
    "",
  ].join("\n");
  const m = scanMethods(src)[0];
  assert.equal(m.name, "Map");
  assert.ok(m.signature.includes("where TIn : notnull"));
  assert.ok(m.signature.includes("where TOut : class, new()"));
  assert.equal(m.bodyOpen, at(src, "{", 2));
});

test("scanMethods: an explicit interface implementation reports the member name (AMBIGUITY: not \"IFoo.Bar\")", () => {
  // "name | the method's identifier" — for `void IFoo.Bar()` the identifier is
  // Bar; the qualifier is part of what "appears ahead of the name". Bound that
  // way; see gap list.
  const src = ["class C : IFoo", "{", "    void IFoo.Bar(int x)", "    {", "    }", "}", ""].join("\n");
  const rows = scanMethods(src);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, "Bar");
  assert.equal(rows[0].declStart, at(src, "void IFoo.Bar"));
  assert.equal(rows[0].implHeader, "C");
});

// ===========================================================================
// scanMethods — attributes, doc comments, indent
// ===========================================================================

const S_ATTR_DOC = [
  "class C",
  "{",
  "    /// <summary>Adds.</summary>",
  '    /// <param name="a">a</param>',
  "    [Obsolete]",
  '    [SuppressMessage("x", "y")]',
  "    public int Add(int a)",
  "    {",
  "        return a;",
  "    }",
  "}",
  "",
].join("\n");

test("scanMethods: declStart is the first modifier, NOT the attribute and NOT the doc", () => {
  const m = scanMethods(S_ATTR_DOC)[0];
  assert.equal(m.declStart, at(S_ATTR_DOC, "public int Add"));
  assert.equal(S_ATTR_DOC.slice(m.declStart, m.bodyOpen + 1), "public int Add(int a)\n    {");
  assert.equal(m.signature, "public int Add(int a)", "attributes are outside the signature");
});

test("scanMethods: attrStart is the first attribute line above the declaration", () => {
  const m = scanMethods(S_ATTR_DOC)[0];
  assert.equal(m.attrStart, at(S_ATTR_DOC, "[Obsolete]"));
});

test("scanMethods: indent is the declaration line's leading whitespace, not the attribute line's", () => {
  const m = scanMethods(S_ATTR_DOC)[0];
  assert.equal(m.indent, "    ");
});

test("scanMethods: docComment is captured even with attribute lines between the doc and the head (AMBIGUITY)", () => {
  // The contract says "the contiguous /// block above"; intervening attribute
  // lines are not mentioned. Bound as still captured, because the doc is
  // unambiguously this member's. See gap list.
  const m = scanMethods(S_ATTR_DOC)[0];
  assert.equal(m.docComment, '    /// <summary>Adds.</summary>\n    /// <param name="a">a</param>');
});

test("scanMethods: docComment keeps its indentation verbatim and joins the lines with \\n", () => {
  const src = [
    "class C",
    "{",
    "    /// <summary>",
    "    /// Line two.",
    "    /// </summary>",
    "    public void M()",
    "    {",
    "    }",
    "}",
    "",
  ].join("\n");
  const m = scanMethods(src)[0];
  assert.equal(m.docComment, "    /// <summary>\n    /// Line two.\n    /// </summary>");
  assert.equal(m.docComment.split("\n").length, 3);
});

test("scanMethods: docComment is undefined (not \"\") when there is none", () => {
  const m = scanMethods(S_ALLMAN)[0];
  assert.equal(m.docComment, undefined);
});

test("scanMethods: a blank line breaks doc contiguity (AMBIGUITY: \"contiguous\" read as line-adjacent)", () => {
  const src = [
    "class C",
    "{",
    "    /// <summary>Belongs to nothing.</summary>",
    "",
    "    public void M()",
    "    {",
    "    }",
    "}",
    "",
  ].join("\n");
  const m = scanMethods(src)[0];
  assert.equal(m.docComment, undefined);
});

test("scanMethods: a plain // comment above the head is not a doc comment", () => {
  const src = ["class C", "{", "    // an ordinary note", "    public void M()", "    {", "    }", "}", ""].join("\n");
  const m = scanMethods(src)[0];
  assert.equal(m.docComment, undefined);
});

test("scanMethods: a signature-shaped line inside a doc comment is not a declaration", () => {
  const src = [
    "class C",
    "{",
    "    /// <summary>public int Fake(int q) { return 1; }</summary>",
    "    public int Real(int q)",
    "    {",
    "        return q;",
    "    }",
    "}",
    "",
  ].join("\n");
  const rows = scanMethods(src);
  assert.deepEqual(rows.map((r) => r.name), ["Real"]);
  assert.equal(rows[0].declStart, at(src, "public int Real"));
});

test("scanMethods: a signature-shaped string literal inside a body is not a declaration", () => {
  const src = [
    "class C",
    "{",
    "    void M()",
    "    {",
    '        var t = "public int Fake(int q) { return 1; }";',
    "    }",
    "}",
    "",
  ].join("\n");
  const rows = scanMethods(src);
  assert.deepEqual(rows.map((r) => r.name), ["M"]);
  // The FIRST } in this text sits inside the string literal; the method's own
  // close is the second-to-last, with the class's close last.
  assert.equal(rows[0].bodyClose, src.lastIndexOf("}", src.lastIndexOf("}") - 1));
});

test("scanMethods: an attribute on the SAME line as the head still leaves declStart at the modifier", () => {
  // attrStart is deliberately not asserted here: the contract says "the first
  // attribute line ABOVE the declaration", which does not describe this shape.
  // See gap list.
  const src = ["class C", "{", "    [Obsolete] public int Add(int a)", "    {", "        return a;", "    }", "}", ""].join("\n");
  const rows = scanMethods(src);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].declStart, at(src, "public int Add"));
  assert.equal(rows[0].signature, "public int Add(int a)");
});

// ===========================================================================
// scanMethods — types, nesting, namespaces, local functions
// ===========================================================================

test("scanMethods: nested types give implHeader = inner simple name and typePath = the dotted chain", () => {
  const src = [
    "namespace N",
    "{",
    "    public class Outer",
    "    {",
    "        public class Inner",
    "        {",
    "            public void Deep()",
    "            {",
    "            }",
    "        }",
    "",
    "        public void Shallow()",
    "        {",
    "        }",
    "    }",
    "}",
    "",
  ].join("\n");
  const rows = scanMethods(src);
  assert.deepEqual(rows.map((r) => r.name), ["Deep", "Shallow"]);
  assert.equal(rows[0].implHeader, "Inner");
  assert.equal(rows[0].typePath, "Outer.Inner", "namespace N must not appear in typePath");
  assert.equal(rows[1].implHeader, "Outer");
  assert.equal(rows[1].typePath, "Outer");
});

test("scanMethods: a file-scoped namespace is still excluded from typePath", () => {
  const src = ["namespace N;", "", "class C", "{", "    void M()", "    {", "    }", "}", ""].join("\n");
  const rows = scanMethods(src);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].typePath, "C");
  assert.equal(rows[0].implHeader, "C");
});

test("scanMethods: a generic enclosing type contributes its bare name to typePath", () => {
  const src = ["class Box<T>", "{", "    public void Put(T item)", "    {", "    }", "}", ""].join("\n");
  const m = scanMethods(src)[0];
  assert.equal(m.implHeader, "Box");
  assert.equal(m.typePath, "Box");
});

test("scanMethods: a local function is REPORTED with isLocal true, and its enclosing method with isLocal false", () => {
  const src = [
    "class C",
    "{",
    "    public int Outer(int a)",
    "    {",
    "        int Inner(int b)",
    "        {",
    "            return b + 1;",
    "        }",
    "",
    "        return Inner(a);",
    "    }",
    "}",
    "",
  ].join("\n");
  const rows = scanMethods(src);
  assert.deepEqual(rows.map((r) => r.name), ["Outer", "Inner"], "source order: the enclosing method's declStart comes first");
  assert.equal(rows[0].isLocal, false);
  assert.equal(rows[1].isLocal, true);
  // The local function's whole span sits inside its parent's body.
  assert.ok(rows[0].bodyOpen < rows[1].declStart && rows[1].bodyClose < rows[0].bodyClose);
  const cls = classify(src);
  for (const r of rows) assertRowInvariants(src, cls, r, r.name);
});

test("scanMethods: a lambda assigned into a field is not a declaration", () => {
  const src = [
    "class C",
    "{",
    "    private readonly Func<int, int> _f = x =>",
    "    {",
    "        return x + 1;",
    "    };",
    "",
    "    public int Use(int a)",
    "    {",
    "        return _f(a);",
    "    }",
    "}",
    "",
  ].join("\n");
  const rows = scanMethods(src);
  assert.deepEqual(rows.map((r) => r.name), ["Use"]);
});

test("scanMethods: an interface member with a default body is scanned; the bodyless one is not", () => {
  const src = ["interface IFoo", "{", "    void Bar();", "", "    void Baz()", "    {", "    }", "}", ""].join("\n");
  const rows = scanMethods(src);
  assert.deepEqual(rows.map((r) => r.name), ["Baz"]);
  assert.equal(rows[0].implHeader, "IFoo");
  assert.equal(rows.skipped.bodyless, 1);
});

// ===========================================================================
// scanMethods — kinds
// ===========================================================================

const S_KINDS = [
  "class Foo",
  "{",
  "    static Foo()",
  "    {",
  "    }",
  "",
  "    public Foo(int a)",
  "    {",
  "    }",
  "",
  "    ~Foo()",
  "    {",
  "    }",
  "",
  "    public static Foo operator +(Foo a, Foo b)",
  "    {",
  "        return a;",
  "    }",
  "",
  "    public static implicit operator int(Foo f)",
  "    {",
  "        return 0;",
  "    }",
  "",
  "    public void M()",
  "    {",
  "    }",
  "}",
  "",
].join("\n");

test("scanMethods: kind is reported for method, ctor, static-ctor, finalizer, operator and conversion, in source order", () => {
  const rows = scanMethods(S_KINDS);
  assert.deepEqual(rows.map((r) => r.kind), ["static-ctor", "ctor", "finalizer", "operator", "conversion", "method"]);
});

test("scanMethods: a constructor is SCANNED (not excluded) and its name equals the enclosing type's", () => {
  const rows = scanMethods(S_KINDS);
  const ctor = rows.find((r) => r.kind === "ctor");
  assert.equal(ctor.name, "Foo");
  assert.equal(ctor.implHeader, "Foo");
  assert.equal(ctor.declStart, at(S_KINDS, "public Foo(int a)"));
  assertRowInvariants(S_KINDS, classify(S_KINDS), ctor, "ctor");
});

test("scanMethods: every kind row still satisfies the byte-exactness invariants", () => {
  const cls = classify(S_KINDS);
  const rows = scanMethods(S_KINDS);
  assert.equal(rows.length, 6);
  rows.forEach((r, i) => assertRowInvariants(S_KINDS, cls, r, `${r.kind}#${i}`));
});

test("scanMethods: a constructor with a : base(...) initializer before the brace is still scanned (AMBIGUITY)", () => {
  // The contract's crossing list names only "where constraint clauses"; a
  // constructor initializer is not mentioned, yet constructors are declared
  // scannable with a brace body. Bound as scanned. See gap list.
  const src = ["class C : B", "{", "    public C(int a)", "        : base(a)", "    {", "    }", "}", ""].join("\n");
  const rows = scanMethods(src);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, "ctor");
  assert.equal(rows[0].bodyOpen, at(src, "{", 2));
  assert.ok(rows[0].signature.includes(": base(a)"));
  assertRowInvariants(src, classify(src), rows[0], "ctor with initializer");
});

// ===========================================================================
// scanMethods — the exclusions and the skipped counters
// ===========================================================================

const S_EXCLUDE = [
  "abstract class C",
  "{",
  "    public abstract int A(int x);",
  "",
  "    public int B(int x) => x + 1;",
  "",
  "    public int P { get; set; }",
  "",
  "    public int Q",
  "    {",
  "        get { return 1; }",
  "        set { _q = value; }",
  "    }",
  "",
  "    public int this[int i]",
  "    {",
  "        get { return i; }",
  "    }",
  "",
  "    public event EventHandler E;",
  "",
  "    public int Real(int x)",
  "    {",
  "        return x;",
  "    }",
  "}",
  "",
].join("\n");

test("scanMethods: bodyless, expression-bodied, property, indexer, accessor and event are all out of the array", () => {
  const rows = scanMethods(S_EXCLUDE);
  assert.deepEqual(rows.map((r) => r.name), ["Real"]);
});

test("scanMethods: skipped counts the expression-bodied method and the bodyless one, by reason", () => {
  const rows = scanMethods(S_EXCLUDE);
  assert.deepEqual({ ...rows.skipped }, { expressionBodied: 1, bodyless: 1, unbalanced: 0 });
});

test("scanMethods: an expression-bodied PROPERTY is not method-shaped, so it is not counted (AMBIGUITY)", () => {
  // "A property has no parameter list" — so it is not a method-shaped
  // declaration at all and never reaches the expression-bodied test. Bound as
  // count 0. See gap list.
  const src = ["class C", "{", "    public bool IsActive => _t != 0;", "}", ""].join("\n");
  const rows = scanMethods(src);
  assert.equal(rows.length, 0);
  assert.deepEqual({ ...rows.skipped }, { expressionBodied: 0, bodyless: 0, unbalanced: 0 });
});

test("scanMethods: an expression-bodied member whose arrow follows a lambda inside parens is still expression-bodied", () => {
  // The real shape from Autofac's NamedParameter: the `pi => pi.Name == name`
  // arrow sits at paren depth 1, the member's own arrow at depth 0.
  const src = [
    "class NamedParameter : ConstantParameter",
    "{",
    "    public NamedParameter(string name, object? value)",
    "        : base(value, pi => pi.Name == name)",
    '            => Name = Enforce.ArgumentNotNullOrEmpty(name, "name");',
    "}",
    "",
  ].join("\n");
  const rows = scanMethods(src);
  assert.equal(rows.length, 0);
  assert.equal(rows.skipped.expressionBodied, 1);
});

test("scanMethods: a default parameter value containing => does not make a braced method expression-bodied", () => {
  const src = [
    "class C",
    "{",
    "    public int Run(Func<int, int> f, int seed = 0)",
    "    {",
    "        return f(seed);",
    "    }",
    "}",
    "",
  ].join("\n");
  const rows = scanMethods(src);
  assert.deepEqual(rows.map((r) => r.name), ["Run"]);
  assert.equal(rows.skipped.expressionBodied, 0);
});

test("scanMethods: an expression-bodied member reaching => before any { is counted, not returned", () => {
  const src = ["class C", "{", "    public int Sq(int x) => x * x;", "}", ""].join("\n");
  const rows = scanMethods(src);
  assert.equal(rows.length, 0);
  assert.equal(rows.skipped.expressionBodied, 1);
  assert.equal(rows.skipped.bodyless, 0);
});

test("scanMethods: an expression-bodied member whose expression contains a brace is still not returned", () => {
  const src = ["class C", "{", "    public Dict Make() => new Dict { [1] = 2 };", "}", ""].join("\n");
  const rows = scanMethods(src);
  assert.equal(rows.length, 0);
  assert.equal(rows.skipped.expressionBodied, 1);
});

test("scanMethods: skipped is a non-enumerable property of the array, not an element or a visible key", () => {
  const rows = scanMethods(S_EXCLUDE);
  const d = Object.getOwnPropertyDescriptor(rows, "skipped");
  assert.ok(d, "skipped must exist on the returned array");
  assert.equal(d.enumerable, false, "skipped must be non-enumerable");
  assert.ok(Array.isArray(rows));
  assert.ok(!Object.keys(rows).includes("skipped"));
  assert.ok(!JSON.stringify(rows).includes("skipped"));
});

test("scanMethods: an unbalanced body is counted as unbalanced and returns no row", () => {
  const src = ["class C", "{", "    public void M()", "    {", "        // never closed", ""].join("\n");
  const rows = scanMethods(src);
  assert.equal(rows.length, 0);
  assert.equal(rows.skipped.unbalanced, 1);
});

// ===========================================================================
// scanMethods — the string/comment forms moving a bodyClose, which is the
// whole point of classify existing
// ===========================================================================

test("scanMethods: a } in a regular string inside the body does NOT end the body early", () => {
  const src = ["class C", "{", "    public void M()", "    {", '        var s = "}";', "    }", "}", ""].join("\n");
  const m = scanMethods(src)[0];
  // Hand-computed: the braces in source order are class-open(1), body-open(2),
  // string-} (not a brace for our purposes), body-close(1st }), class-close.
  assert.equal(m.bodyOpen, at(src, "{", 2));
  assert.equal(m.bodyClose, src.lastIndexOf("}", src.lastIndexOf("}") - 1));
  assert.equal(m.body, '\n        var s = "}";\n    ');
});

test("scanMethods: every one of the five string forms plus both comment forms leave bodyClose where it belongs", () => {
  const src = [
    "class C",
    "{",
    "    public string Render()",
    "    {",
    '        var a = "}";',
    '        var b = @"a ""}"" }";',
    '        var c = """ } """;',
    "        var d = '}';",
    "        // }",
    "        /* } */",
    '        var e = $"{Wrap(() => { return 1; })}";',
    "        return a + b + c + e;",
    "    }",
    "}",
    "",
  ].join("\n");
  const rows = scanMethods(src);
  assert.equal(rows.length, 1, "the whole method must survive as exactly one row");
  const m = rows[0];
  const classClose = src.lastIndexOf("}");
  assert.equal(m.bodyOpen, at(src, "{", 2));
  assert.equal(m.bodyClose, src.lastIndexOf("}", classClose - 1));
  assert.ok(m.body.includes("return a + b + c + e;"));
  assertRowInvariants(src, classify(src), m, "Render");
});

test("scanMethods: a verbatim string spanning lines with an unbalanced brace does not desync the scan", () => {
  const src = [
    "class C",
    "{",
    "    public string A()",
    "    {",
    '        return @"line one {',
    'line two";',
    "    }",
    "",
    "    public int B()",
    "    {",
    "        return 2;",
    "    }",
    "}",
    "",
  ].join("\n");
  const rows = scanMethods(src);
  assert.deepEqual(rows.map((r) => r.name), ["A", "B"], "B must still be found after the multi-line verbatim string");
  const cls = classify(src);
  for (const r of rows) assertRowInvariants(src, cls, r, r.name);
});

// ===========================================================================
// scanMethods — crossesDirective
// ===========================================================================

const S_DIRECTIVE = [
  "class C",
  "{",
  "    public int A()",
  "    {",
  "#if NET8_0",
  "        return 1;",
  "#else",
  "        return 2;",
  "#endif",
  "    }",
  "",
  "    public int B()",
  "    {",
  "        return 3;",
  "    }",
  "}",
  "",
].join("\n");

test("scanMethods: crossesDirective is true only for the row whose span intersects #if/#else/#endif", () => {
  const rows = scanMethods(S_DIRECTIVE);
  assert.deepEqual(rows.map((r) => r.name), ["A", "B"]);
  assert.equal(rows[0].crossesDirective, true);
  assert.equal(rows[1].crossesDirective, false);
});

test("scanMethods: an indented #if still counts (first non-whitespace on the line is the test)", () => {
  const src = [
    "class C",
    "{",
    "    public int A()",
    "    {",
    "        #if DEBUG",
    "        return 1;",
    "        #endif",
    "        return 2;",
    "    }",
    "}",
    "",
  ].join("\n");
  assert.equal(scanMethods(src)[0].crossesDirective, true);
});

test("scanMethods: a #region / #nullable line does not set crossesDirective (only the four named directives do)", () => {
  const src = [
    "class C",
    "{",
    "#region helpers",
    "#nullable enable",
    "    public int A()",
    "    {",
    "        return 1;",
    "    }",
    "#endregion",
    "}",
    "",
  ].join("\n");
  const rows = scanMethods(src);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].crossesDirective, false);
});

test("scanMethods: a #if in a DIFFERENT method's span does not mark this row", () => {
  const rows = scanMethods(S_DIRECTIVE);
  assert.equal(rows[1].crossesDirective, false);
  assert.ok(rows[1].declStart > S_DIRECTIVE.indexOf("#endif"));
});

// ===========================================================================
// enclosingTypeOf
// ===========================================================================

test("enclosingTypeOf: a position inside a class body reports name, path and kind", () => {
  const src = ["class Box", "{", "    void M()", "    {", "        var x = 1;", "    }", "}", ""].join("\n");
  const cls = classify(src);
  const got = enclosingTypeOf(src, cls, at(src, "var x"));
  assert.deepEqual(got, { name: "Box", path: "Box", kind: "class" });
});

test("enclosingTypeOf: generics are stripped from name and path", () => {
  const src = ["class Box<T>", "{", "    void M()", "    {", "        var x = 1;", "    }", "}", ""].join("\n");
  const cls = classify(src);
  const got = enclosingTypeOf(src, cls, at(src, "var x"));
  assert.equal(got.name, "Box");
  assert.equal(got.path, "Box");
});

test("enclosingTypeOf: a nested type reports the inner name with the dotted path, outermost first", () => {
  const src = [
    "namespace N",
    "{",
    "    class Outer",
    "    {",
    "        class Inner",
    "        {",
    "            void M()",
    "            {",
    "                var x = 1;",
    "            }",
    "        }",
    "    }",
    "}",
    "",
  ].join("\n");
  const cls = classify(src);
  const got = enclosingTypeOf(src, cls, at(src, "var x"));
  assert.equal(got.name, "Inner");
  assert.equal(got.path, "Outer.Inner");
});

test("enclosingTypeOf: a namespace is not a type — a position inside one but outside any type is undefined", () => {
  const src = ["namespace N", "{", "    // nothing here yet", "}", ""].join("\n");
  const cls = classify(src);
  assert.equal(enclosingTypeOf(src, cls, at(src, "// nothing")), undefined);
});

test("enclosingTypeOf: a position at file scope is undefined", () => {
  const src = ["using System;", "", "class C", "{", "}", ""].join("\n");
  const cls = classify(src);
  assert.equal(enclosingTypeOf(src, cls, at(src, "using")), undefined);
});

test("enclosingTypeOf: a file-scoped namespace does not appear in the path", () => {
  const src = ["namespace N;", "", "class C", "{", "    void M()", "    {", "        var x = 1;", "    }", "}", ""].join("\n");
  const cls = classify(src);
  const got = enclosingTypeOf(src, cls, at(src, "var x"));
  assert.deepEqual(got, { name: "C", path: "C", kind: "class" });
});

test("enclosingTypeOf: struct, record, interface and enum kinds are reported", () => {
  const cases = [
    ["struct S", "struct", "S"],
    ["record R(int A)", "record", "R"],
    ["interface IFoo", "interface", "IFoo"],
    ["enum E", "enum", "E"],
  ];
  for (const [head, kind, name] of cases) {
    const src = [head, "{", "    // marker", "}", ""].join("\n");
    const cls = classify(src);
    const got = enclosingTypeOf(src, cls, at(src, "// marker"));
    assert.ok(got, `${head}: expected a type, got undefined`);
    assert.equal(got.kind, kind, `${head}: kind`);
    assert.equal(got.name, name, `${head}: name`);
    assert.equal(got.path, name, `${head}: a non-nested type's path equals its name`);
  }
});

test("enclosingTypeOf: a type name that appears inside a string or comment does not become the enclosing type", () => {
  const src = ["class Real", "{", "    void M()", "    {", '        var t = "class Fake {";', "    }", "}", ""].join("\n");
  const cls = classify(src);
  const got = enclosingTypeOf(src, cls, at(src, "var t"));
  assert.equal(got.name, "Real");
});

// ===========================================================================
// REAL C# from the v43 corpus. Invariants and hand-verified methods only —
// never a whole-repo method count, which churns with the checkout. Gated on
// the corpus existing (skip, never fail), the discipline of
// test/impl-v40-p2-go-rig-live.test.cjs; these rows only read files, so
// SKIP_LIVE does not apply.
// ===========================================================================

const CORPUS = process.env.STUDY_ROOT_CS ?? path.join(os.homedir(), "sandbox", "v43-corpus");
const AUTOFAC = path.join(CORPUS, "Autofac", "src", "Autofac");
const MODULE_CS = path.join(AUTOFAC, "Module.cs");
const NAMED_CS = path.join(AUTOFAC, "NamedParameter.cs");
const STOPWATCH_CS = path.join(AUTOFAC, "Diagnostics", "ValueStopwatch.cs");
const CORPUS_SKIP = !fs.existsSync(MODULE_CS) ? `no Autofac checkout at ${AUTOFAC}` : false;

if (CORPUS_SKIP) {
  test(`real-corpus C# rows (SKIPPED: ${CORPUS_SKIP})`, () => {});
} else {
  test("real corpus: Autofac Module.cs yields exactly its six brace-bodied methods, in source order", () => {
    const text = fs.readFileSync(MODULE_CS, "utf8");
    const rows = scanMethods(text);
    assert.deepEqual(
      rows.map((r) => r.name),
      ["Configure", "Load", "AttachToComponentRegistration", "AttachToRegistrationSource", "AttachToRegistrations", "AttachToSources"],
      "hand-verified from the file: the ThisAssembly property, its get accessor, and the two static lambdas are not methods",
    );
  });

  test("real corpus: Module.cs — Configure's doc, type path and byte-exact span", () => {
    const text = fs.readFileSync(MODULE_CS, "utf8");
    const cls = classify(text);
    const m = scanMethods(text).find((r) => r.name === "Configure");
    assert.equal(m.kind, "method");
    assert.equal(m.implHeader, "Module");
    assert.equal(m.typePath, "Module", "the file-scoped `namespace Autofac;` is not part of typePath");
    assert.equal(m.isLocal, false);
    assert.equal(m.crossesDirective, false);
    assert.equal(m.indent, "    ");
    assert.equal(m.signature, "public void Configure(IComponentRegistryBuilder componentRegistry)");
    assert.equal(text.slice(m.declStart, m.declStart + 6), "public");
    assert.equal(m.docComment.split("\n").length, 4);
    assert.ok(m.docComment.startsWith("    /// <summary>"));
    assert.ok(m.docComment.includes("Apply the module to the component registry."));
    assert.ok(m.body.includes("AttachToSources(componentRegistry);"));
    assertRowInvariants(text, cls, m, "Module.Configure");
  });

  test("real corpus: Module.cs — AttachToRegistrations' attrStart is its multi-line attribute, declStart is not", () => {
    const text = fs.readFileSync(MODULE_CS, "utf8");
    const m = scanMethods(text).find((r) => r.name === "AttachToRegistrations");
    assert.equal(text.slice(m.declStart, m.declStart + "private void AttachToRegistrations".length), "private void AttachToRegistrations");
    assert.ok(m.attrStart < m.declStart, "attrStart precedes declStart");
    assert.equal(text.slice(m.attrStart, m.attrStart + "[UnconditionalSuppressMessage".length), "[UnconditionalSuppressMessage");
    assert.equal(m.docComment, undefined, "this member has attributes but no /// doc");
    // The attribute's Justification string contains prose with braces-free but
    // quoted text; the span must still balance.
    assertRowInvariants(text, classify(text), m, "Module.AttachToRegistrations");
  });

  test("real corpus: Module.cs — a static lambda body inside AttachToSources does not become the method's close", () => {
    const text = fs.readFileSync(MODULE_CS, "utf8");
    const m = scanMethods(text).find((r) => r.name === "AttachToSources");
    assert.ok(m.body.includes("static t =>"), "the lambda is inside the method body, not a row of its own");
    assert.ok(m.body.includes("RegistrationSourceAdded"));
    assertRowInvariants(text, classify(text), m, "Module.AttachToSources");
  });

  test("real corpus: Autofac NamedParameter.cs — an expression-bodied ctor plus a property yields no rows", () => {
    const text = fs.readFileSync(NAMED_CS, "utf8");
    const rows = scanMethods(text);
    assert.deepEqual(rows.map((r) => r.name), []);
    assert.ok(rows.skipped.expressionBodied >= 1, "the `=> Name = ...` constructor is counted as expression-bodied");
    assert.equal(rows.skipped.unbalanced, 0);
  });

  test("real corpus: Autofac ValueStopwatch.cs — the #if method is flagged, the ctor and plain method are not", () => {
    const text = fs.readFileSync(STOPWATCH_CS, "utf8");
    const rows = scanMethods(text);
    assert.deepEqual(rows.map((r) => r.name), ["ValueStopwatch", "GetElapsedTime", "GetElapsedTime"]);
    assert.deepEqual(rows.map((r) => r.kind), ["ctor", "method", "method"]);
    assert.equal(rows[0].crossesDirective, false, "the private ctor sits below the #endif");
    assert.equal(rows[1].crossesDirective, true, "static GetElapsedTime(long,long) spans #if/#else/#endif");
    assert.equal(rows[2].crossesDirective, false);
    assert.equal(rows[1].typePath, "ValueStopwatch");
    assert.ok(rows.skipped.expressionBodied >= 1, "StartNew() is expression-bodied");
    const cls = classify(text);
    for (const r of rows) assertRowInvariants(text, cls, r, `ValueStopwatch.${r.name}`);
    assert.deepEqual(enclosingTypeOf(text, cls, rows[1].bodyOpen + 1), {
      name: "ValueStopwatch",
      path: "ValueStopwatch",
      kind: "struct",
    });
  });

  test("real corpus: every row over a real Autofac + Serilog sweep satisfies the byte-exactness invariants", () => {
    const roots = [AUTOFAC, path.join(CORPUS, "serilog", "src")].filter((p) => fs.existsSync(p));
    assert.ok(roots.length > 0);
    const files = [];
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (files.length >= 120) return;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith(".cs")) files.push(p);
      }
    };
    for (const r of roots) walk(r);
    assert.ok(files.length >= 20, `expected real .cs files, found ${files.length}`);

    let total = 0;
    for (const f of files) {
      const text = fs.readFileSync(f, "utf8");
      const cls = classify(text);
      const rows = scanMethods(text);
      total += rows.length;
      for (const m of rows) {
        assertRowInvariants(text, cls, m, `${path.relative(CORPUS, f)}:${m.name}`);
        assert.equal(typeof m.name, "string");
        assert.ok(m.name.length > 0, `${f}: empty name`);
        assert.ok(!m.name.includes("<"), `${f}: name ${m.name} still carries generics`);
        assert.ok(["method", "ctor", "static-ctor", "finalizer", "operator", "conversion"].includes(m.kind), `${f}: kind ${m.kind}`);
        if (m.attrStart !== undefined) {
          assert.ok(m.attrStart < m.declStart, `${f}:${m.name}: attrStart must precede declStart`);
          assert.equal(text[m.attrStart], "[", `${f}:${m.name}: attrStart must point at a [`);
        }
        if (m.docComment !== undefined) {
          for (const line of m.docComment.split("\n")) {
            assert.match(line, /^\s*\/\/\//, `${f}:${m.name}: every docComment line must be a /// line`);
          }
        }
      }
      assert.equal(typeof rows.skipped.expressionBodied, "number");
      assert.equal(typeof rows.skipped.bodyless, "number");
      assert.equal(typeof rows.skipped.unbalanced, "number");
      assert.equal(rows.skipped.unbalanced, 0, `${f}: real, compiling C# must never have an unbalanced method body`);
    }
    assert.ok(total > 100, `expected the sweep to find real methods, found ${total}`);
  });
}
