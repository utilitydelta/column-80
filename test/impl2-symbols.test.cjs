// Implementer oracle: the pure half of span resolution (P2-F6, P2-F11) —
// the declaration-head trivia walk extracted to src/core/symbols.ts so
// decorator/attribute shapes are provable headless, and the symbol-shape
// guard that keeps SymbolInformation[] providers from turning into a
// TypeError. The vscode layer supplies only line access and positions.
//
// Run: npm test

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl2-symbols",
  `export { declarationHeadLine, hasDocumentSymbolShape } from "../src/core/symbols";\n`
);
const { declarationHeadLine, hasDocumentSymbolShape } = mod;
test.after(cleanup);

const head = (lines, nameLine) => declarationHeadLine((i) => lines[i], 0, nameLine);

// ---- declaration-head walk: shapes the walker provably handles

const headCases = [
  {
    name: "rust doc comment + single-line attribute",
    lines: ["/// Doc.", "#[inline]", "pub fn f() {"],
    nameLine: 2,
    expected: 2,
  },
  {
    name: "rust multi-line attribute (#[derive(...)] across lines)",
    lines: ["#[derive(", "  Debug,", "  Clone,", ")]", "fn f() {"],
    nameLine: 4,
    expected: 4,
  },
  {
    name: "P2-F6: multi-line paren decorator (@Component({...})) resolves at the declaration head, never mid-decorator",
    lines: ["@Component({", "  selector: 'app-x',", "  template: '<div/>',", "})", "ngOnInit() {"],
    nameLine: 4,
    expected: 4,
  },
  {
    name: "P2-F6: python multi-line decorator with nested parens",
    lines: ["@retry(", "  times=3,", "  on=(IOError, OSError),", ")", "def fetch():"],
    nameLine: 4,
    expected: 4,
  },
  {
    name: "P2-F6: C#-style [Fact] attribute line sits outside the span",
    lines: ["[Fact]", "public void Works() {"],
    nameLine: 1,
    expected: 1,
  },
  {
    name: "P2-F6: multi-line bare attribute ([InlineData( ... )])",
    lines: ["[InlineData(", "  1, 2)]", "public void Sums() {"],
    nameLine: 2,
    expected: 2,
  },
  {
    name: "single-line balanced decorator (@Inject())",
    lines: ["@Inject()", "constructor() {"],
    nameLine: 1,
    expected: 1,
  },
  {
    name: "stacked decorators, doc comment, and blank line together",
    lines: ["/** Jsdoc. */", "", "@A()", "@B({", "  x: 1,", "})", "method() {"],
    nameLine: 6,
    expected: 6,
  },
  {
    name: "block comment spanning lines",
    lines: ["/*", " * prose", " */", "fn f() {"],
    nameLine: 3,
    expected: 3,
  },
  {
    name: "no trivia at all: head is the range start",
    lines: ["pub fn f() {"],
    nameLine: 0,
    expected: 0,
  },
  {
    name: "safety cap: an unbalanced decorator can never walk past the symbol-name line",
    lines: ["@Broken((", "  x,", "fn f() {"],
    nameLine: 2,
    expected: 2,
  },
  {
    name: "declaration containing brackets is NOT eaten as an attribute (cap and break order)",
    lines: ["/// Doc.", "pub fn get(v: &[i64]) -> i64 {"],
    nameLine: 1,
    expected: 1,
  },
];

for (const { name, lines, nameLine, expected } of headCases) {
  test(`declarationHeadLine: ${name}`, () => {
    assert.strictEqual(head(lines, nameLine), expected);
  });
}

test("declarationHeadLine honors a non-zero range start", () => {
  const lines = ["mod m {", "    /// Doc.", "    #[test]", "    fn t() {"];
  assert.strictEqual(declarationHeadLine((i) => lines[i], 1, 3), 3);
});

// ---- P2-F11: symbol-shape guard

test("P2-F11: DocumentSymbol-shaped list passes the guard", () => {
  const sym = {
    name: "f",
    kind: 11,
    range: {},
    selectionRange: {},
    children: [],
  };
  assert.strictEqual(hasDocumentSymbolShape([sym]), true);
});

test("P2-F11: SymbolInformation-shaped list (location, no selectionRange/children) fails the guard gracefully", () => {
  const info = { name: "f", kind: 11, location: { uri: "file:///a", range: {} }, containerName: "" };
  assert.strictEqual(hasDocumentSymbolShape([info]), false);
});

test("P2-F11: empty list passes (nothing to mis-shape; resolution finds no function anyway)", () => {
  assert.strictEqual(hasDocumentSymbolShape([]), true);
});

test("P2-F11: junk entries (null, primitives) fail the guard, never throw", () => {
  assert.strictEqual(hasDocumentSymbolShape([null]), false);
  assert.strictEqual(hasDocumentSymbolShape(["x"]), false);
});

// ---- P2-F19: closers inside string/template literals must not zero the
// balance early; when counting still fails, the fallback shrinks the span
// (head at or after provable trivia end, capped at the name line), never
// mid-construct.

test("P2-F19 probe 1: decorator string containing close-parens (NestJS/Swagger shape) never yields a mid-decorator head", () => {
  const lines = [
    "@ApiOperation({",
    '  summary: "get a) and b)",',
    "})",
    "async getAll() {",
  ];
  assert.strictEqual(head(lines, 3), 3);
});

test("P2-F19 probe 2: multi-line template literal inside a decorator is consumed as literal, not counted", () => {
  const lines = [
    "@Log(`prefix with ) and {",
    "second line with } and )`)",
    "someMethod() {",
  ];
  assert.strictEqual(head(lines, 2), 2);
});

test("P2-F19 probe 3: attribute string containing a close-bracket does not close the attribute early", () => {
  const lines = [
    "#[doc(",
    '  alias = "x]y",',
    ")]",
    "fn f() {",
  ];
  assert.strictEqual(head(lines, 3), 3);
});

test("P2-F19: escaped quotes inside decorator strings do not end the literal early", () => {
  const lines = [
    "@D({",
    '  msg: "say \\") and run",',
    "})",
    "m() {",
  ];
  assert.strictEqual(head(lines, 3), 3);
});

test("P2-F19 fallback: a walk that still breaks on a closer-leading line falls to the name line (span-shrinking), never mid-construct", () => {
  // A shape the literal scanner cannot model (the closer on line 1 is real
  // to the scanner): the break candidate line starts with a closer, which
  // is provably mid-construct, so the head falls forward to the name line.
  const lines = [
    "@D(",
    "everything ) closed early",
    "}) // still inside the construct",
    "def f():",
  ];
  assert.strictEqual(head(lines, 3), 3);
});

test("P2-F19 fallback direction check: a genuine multi-line head after a closed decorator is NOT skipped (no unconditional fallback)", () => {
  const lines = [
    "@A(",
    "  x,",
    ")",
    "public static",
    "create() {",
  ];
  // Head is the first unrecognized non-closer line: "public static".
  assert.strictEqual(head(lines, 4), 3);
});
