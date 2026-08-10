// Implementer oracle (v12 Phase 2, DO-1): the Python body re-indent that makes
// a NESTED class/enum splice VALID Python. Before the fix the splice was a raw
// full-span replacement with no re-indent, so a nested `class Inner:` (header at
// col 4) got its body spliced at col 0+4 -> IndentationError (review-phase2
// MAJOR 1). The fix (reindentPyBody) re-indents the generated body to the
// header's own indent, triple-quoted-string aware so a multi-line string member
// is never shifted. This drives the REAL reindentPyBody + spliceSpan and PARSES
// the spliced result with python3 -m ast — the end-to-end oracle the slice
// lacked. Skips cleanly if python3 is absent.
//
// Run: SKIP_LIVE=1 node --test test/impl-v12-py-nested-splice.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { execFileSync } = require("child_process");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-v12-py-nested-splice",
  `export { reindentPyBody } from "../src/core/pyExtraction";\n` +
    `export { spliceSpan } from "../src/core/span";\n`,
);
const { reindentPyBody, spliceSpan } = mod;
test.after(cleanup);

let pythonOk = true;
try {
  execFileSync("python3", ["-c", "import ast"], { stdio: "ignore" });
} catch {
  pythonOk = false;
}
// True when `src` is syntactically valid Python (ast.parse does not raise).
function parses(src) {
  try {
    execFileSync("python3", ["-c", "import ast,sys; ast.parse(sys.stdin.read())"], { input: src, stdio: ["pipe", "ignore", "pipe"] });
    return true;
  } catch {
    return false;
  }
}

// Offset of (line, col) in text (LF).
function offsetOf(text, line, col) {
  const lines = text.split("\n");
  let o = 0;
  for (let i = 0; i < line; i++) o += lines[i].length + 1;
  return o + col;
}

test("reindentPyBody: top-level (indent '') is byte-identical", () => {
  const model = 'class Color(Enum):\n    RED = 1\n    GREEN = 2';
  assert.strictEqual(reindentPyBody(model, ""), model, "a top-level target must be untouched byte-for-byte");
});

test("nested class: the spliced document parses under python3 (no IndentationError)", () => {
  if (!pythonOk) return; // python3 absent — skip
  // Original doc: Inner is nested in Outer at col 4; its span is [headStart .. end of its one body line].
  const doc =
    "class Outer:\n" + // 0
    "    x: int\n" + // 1
    "    class Inner:\n" + // 2  header at col 4
    "        a: int\n"; // 3  original body
  const start = offsetOf(doc, 2, 4); // the `c` of `class Inner`
  const end = offsetOf(doc, 3, 14); // end of `        a: int`
  const model = "class Inner:\n    a: int\n    b: str"; // model replies dedented (col 0)
  const reindented = reindentPyBody(model, "    ");
  const spliced = spliceSpan(doc, { start, end }, reindented);
  assert.ok(parses(spliced), `the spliced nested class must parse; got:\n${spliced}`);
  // And the members must sit at col 8 (header_indent 4 + body 4).
  assert.ok(spliced.includes("\n        a: int"), "the first member must be indented to col 8");
  assert.ok(spliced.includes("\n        b: str"), "the generated member must be indented to col 8");
});

test("nested class: a triple-quoted multi-line string member keeps its bytes exactly", () => {
  const model =
    "class Cfg:\n" +
    '    doc = """\n' +
    "line1\n" +
    "  line2 has 2 leading spaces\n" +
    '"""\n' +
    "    x: int = 0";
  const reindented = reindentPyBody(model, "    ");
  // The string CONTENT lines must be byte-exact (not prefixed), or the string value silently changes.
  assert.ok(reindented.includes("\nline1\n  line2 has 2 leading spaces\n"), "the multi-line string body must be unchanged");
  // The CODE lines around it must be re-indented to col 8.
  assert.ok(reindented.includes("\n        doc = "), "the code line opening the string is re-indented");
  assert.ok(reindented.includes("\n        x: int = 0"), "the code line after the string is re-indented");
  if (pythonOk) {
    // The whole thing, wrapped so it is a complete nested class, must parse.
    const doc = "class Outer:\n    class Cfg:\n        pass\n";
    const start = offsetOf(doc, 1, 4);
    const end = offsetOf(doc, 2, 12);
    assert.ok(parses(spliceSpan(doc, { start, end }, reindented)), "the spliced class with a triple-quoted member must parse");
  }
});

test("nested class: an escaped \\\"\"\" inside a multi-line string does not close it early (no silent re-indent of string content)", () => {
  // The string body contains an escaped triple-quote; the string must stay open
  // through it, so `still in string` is content (byte-exact) and only the real
  // code after the real close is re-indented. A naive indexOf close would end the
  // string at the escaped delimiter and silently re-indent the following line.
  const model =
    "class C:\n" +
    '    s = """\n' +
    'a \\""" b\n' +
    "still in string\n" +
    '"""\n' +
    "    x = 1";
  const reindented = reindentPyBody(model, "    ");
  assert.ok(reindented.includes("\na \\\"\"\" b\nstill in string\n"), "the string content (through the escaped triple-quote) must be byte-exact");
  assert.ok(reindented.includes("\n        x = 1"), "the real code after the real string close must be re-indented");
  assert.ok(!reindented.includes("\n        still in string"), "a line INSIDE the string must not be re-indented");
  if (pythonOk) {
    const doc = "class Outer:\n    class C:\n        pass\n";
    const spliced = spliceSpan(doc, { start: offsetOf(doc, 1, 4), end: offsetOf(doc, 2, 12) }, reindented);
    assert.ok(parses(spliced), `the spliced class with an escaped triple-quote must parse; got:\n${spliced}`);
  }
});

test("nested class: a single-line string continued with a trailing backslash-newline keeps its value (no silent re-indent)", () => {
  // `x = "abc\<newline>def"` is the string "abcdef"; re-indenting the `def"` line
  // would silently change it to "abc    def" (both parse — pyright would not
  // flag it). The continuation line must stay byte-exact.
  const model = 'class Foo:\n    x = "abc\\\ndef"\n    y = 1';
  const reindented = reindentPyBody(model, "    ");
  assert.ok(reindented.includes('\ndef"\n'), "the backslash-continued line must stay byte-exact (not re-indented)");
  assert.ok(!reindented.includes('\n    def"'), "the string continuation must not gain indentation");
  assert.ok(reindented.includes("\n        y = 1"), "the real code after the string is re-indented");
  if (pythonOk) {
    // Prove the string VALUE is preserved: eval the attribute before and after.
    const valOf = (src) => execFileSync("python3", ["-c", "import ast,sys\nm=ast.parse(sys.stdin.read())\nprint(next(n.value.value for c in ast.walk(m) if isinstance(c,ast.ClassDef) for n in c.body if isinstance(n,ast.Assign) and n.targets[0].id=='x'))"], { input: src, encoding: "utf8" }).trim();
    const before = valOf(model);
    const after = valOf(reindented.replace(/^class Foo:/, "class Foo:")); // reindented is already a valid top-level class here
    assert.strictEqual(after, before, `the string value must be unchanged (before='${before}' after='${after}')`);
  }
});

test("nested enum: members re-indent and the spliced doc parses", () => {
  if (!pythonOk) return;
  const doc =
    "class Palette:\n" + // 0
    "    class Color(Enum):\n" + // 1  header col 4
    "        RED = 1\n"; // 2
  const start = offsetOf(doc, 1, 4);
  const end = offsetOf(doc, 2, 15);
  const model = "class Color(Enum):\n    RED = 1\n    GREEN = 2\n    BLUE = 3";
  const spliced = spliceSpan(doc, { start, end }, reindentPyBody(model, "    "));
  assert.ok(parses(spliced), `the spliced nested enum must parse; got:\n${spliced}`);
});
