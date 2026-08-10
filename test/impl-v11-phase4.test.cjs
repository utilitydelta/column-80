// IMPL ORACLE — v11 phase 4 internals the blind oracles do not see: the Python
// type anchor (import-line preference + `#`-comment skip), pyTypesInPlay's
// stop-set, and the pyShapeHooks / PY_STD_TYPE_NAMES shape registered for the
// whole-block + prefill cross-file resolver.
//
// Run: SKIP_LIVE=1 node --test test/impl-v11-phase4.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

let mod = {};
let cleanup = () => {};
let bundleErr;
try {
  ({ mod, cleanup } = bundleCore(
    "impl-v11-phase4",
    `export { pyFindTypeAnchorInText, pyTypesInPlay, pyWholeBlockSite } from "../src/core/fimWholeBlock";\n` +
      `export { pyShapeHooks, PY_STD_TYPE_NAMES } from "../src/core/crossFileShape";\n`,
  ));
} catch (e) {
  bundleErr = e;
}
test.after(() => cleanup());
const { pyFindTypeAnchorInText, pyTypesInPlay, pyWholeBlockSite, pyShapeHooks, PY_STD_TYPE_NAMES } = mod;

// --- pyWholeBlockSite: an inline `#` comment in a multi-line header never leaks
// its PascalCase words into `types` (phase-4 review finding #1). -----
test("pyWholeBlockSite: a param-line `#` comment word does not leak into types (no false-fire)", () => {
  // The only user annotation is `int` (stdlib), so the site must go DARK — the
  // `Gadget` in the comment must not resurrect it into a whole-block gesture.
  const prefix = "def foo(\n    a: int,  # see Gadget\n) -> int:\n    ";
  assert.strictEqual(pyWholeBlockSite(prefix), undefined, "a PascalCase comment word must not fire the gesture");
});

test("pyWholeBlockSite: real annotations survive, comment words are stripped", () => {
  const prefix = "def foo(\n    a: Widget,  # returns a Frobulator\n) -> Order:\n    ";
  const site = pyWholeBlockSite(prefix);
  assert.ok(site, "a real user-typed signature is a whole-block site");
  assert.deepStrictEqual(site.types, ["Widget", "Order"], "the `Frobulator` comment word is stripped; real types kept");
});

test("pyWholeBlockSite: a `#` inside a string default is NOT treated as a comment", () => {
  // The `#x` lives inside a string literal, so the strip must leave the header
  // intact and the `Widget` annotation still resolves.
  const prefix = 'def foo(\n    a: str = "#x",\n    b: Widget,\n) -> Order:\n    ';
  const site = pyWholeBlockSite(prefix);
  assert.ok(site, "string-default `#` does not corrupt detection");
  assert.deepStrictEqual(site.types, ["Widget", "Order"], "string-literal `#` is not a comment");
});

test("bundle guard: phase-4 core pieces build headless", () => {
  if (bundleErr) assert.fail(`bundle failed: ${bundleErr.message}`);
});

// --- pyFindTypeAnchorInText: import lines win; `#` comments never anchor. -----

test("pyFindTypeAnchorInText: prefers a `from X import Y` line over a later code use", () => {
  const text = ["# Widget is great", "from model import Widget", "", "w = Widget()"].join("\n");
  assert.deepStrictEqual(
    pyFindTypeAnchorInText(text, "Widget"),
    { line: 1, character: "from model import ".length },
    "anchors on the import line, not the header comment nor the later constructor call",
  );
});

test("pyFindTypeAnchorInText: prefers a bare `import numpy` line", () => {
  const text = ["import numpy", "x = numpy"].join("\n");
  assert.deepStrictEqual(pyFindTypeAnchorInText(text, "numpy"), { line: 0, character: "import ".length });
});

test("pyFindTypeAnchorInText: with no import line, falls to the first NON-comment reference", () => {
  const text = ["# Order placeholder", "def f(o: Order):", "    pass"].join("\n");
  const at = pyFindTypeAnchorInText(text, "Order");
  assert.strictEqual(at.line, 1, "skips the `#` comment header, anchors in real code");
});

test("pyFindTypeAnchorInText: a type named ONLY in a `#` comment does not anchor", () => {
  assert.strictEqual(pyFindTypeAnchorInText("# uses a Widget somewhere\n", "Widget"), undefined);
});

test("pyFindTypeAnchorInText: an empty type name is undefined", () => {
  assert.strictEqual(pyFindTypeAnchorInText("import numpy\n", ""), undefined);
});

// --- pyTypesInPlay: user types survive; stdlib/typing + single-letter dropped. -

test("pyTypesInPlay: excludes PY_STD_TYPE_NAMES and single-letter TypeVars, dedups, keeps order", () => {
  assert.deepStrictEqual(
    pyTypesInPlay("(a: Widget, b: Optional[Order], c: Widget, t: T, xs: List[Order]) -> Order"),
    ["Widget", "Order"],
    "Optional/List (typing) and T (TypeVar) drop; Widget/Order dedup to first-seen order",
  );
});

test("pyTypesInPlay: a signature naming only stdlib/typing/TypeVars yields []", () => {
  assert.deepStrictEqual(pyTypesInPlay("(x: int, y: str, t: T) -> Optional[int]"), []);
});

// --- pyShapeHooks / PY_STD_TYPE_NAMES: the signatures-only Python hooks. --------

test("pyShapeHooks: signatures-only — parseHoverFields is empty, stdTypeNames is PY_STD_TYPE_NAMES", () => {
  assert.deepStrictEqual(pyShapeHooks.parseHoverFields("class Foo"), [], "a pyright class hover carries no field body");
  assert.strictEqual(pyShapeHooks.fieldTypeCursor(), undefined, "no field-edge recursion");
  assert.strictEqual(pyShapeHooks.stdTypeNames, PY_STD_TYPE_NAMES, "the walk-stop set is the Python one");
  assert.strictEqual(pyShapeHooks.renderDef({ signature: "class Bar" }), "class Bar", "renderDef returns the raw signature");
});

test("PY_STD_TYPE_NAMES: names the common typing surface, not user types", () => {
  for (const n of ["Optional", "List", "Dict", "Any", "Callable", "None"]) {
    assert.ok(PY_STD_TYPE_NAMES.has(n), n);
  }
  for (const n of ["Widget", "Order", "Result"]) {
    assert.ok(!PY_STD_TYPE_NAMES.has(n), n);
  }
});
