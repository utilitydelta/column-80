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

test("pyShapeHooks: the field leg — parseFields reads the MEMBERS, stdTypeNames is PY_STD_TYPE_NAMES", () => {
  // RENAMED 2026-08-10 (session-v49 phase 2): `parseHoverFields(signature)` became
  // `parseFields(signature, members, defLines)`, because C# and Python have their
  // fields on the resolved MEMBERS and not in any hover. Python still answered []
  // there — its own leg was phase 3.
  //
  // RE-CUT 2026-08-11, session-v50 phase 3. Python's leg landed, so three of the
  // four hooks this row pins are different objects. What shipped alongside:
  // `pyShapeHooks.parseFields` is now `pyFieldsFromMembers`, `fieldTypeCursor` is
  // `pyFieldTypeCursor` (two rules: an annotation, then a constructor call) and
  // `renderDef` is `pyRenderDerivedDef`, which synthesises a class body from the
  // derived fields because a pyright class hover is `(class) Foo` and carries no
  // body. `pyShapeBlock` renders the resulting `Data shape of` block. The old row
  // did not fail on an expectation: it threw, because `fieldTypeCursor()` with no
  // arguments and `renderDef({signature})` with no `fields` are now calls into
  // parsers that read their arguments.
  //
  // The old claim is not deleted, it is narrowed to the case it was always true
  // of: a hover with NO members still yields no fields. That is the assertion
  // below, and it is what stops the leg from inventing a field out of the hover
  // text the way the Rust struct parser would.
  assert.deepStrictEqual(
    pyShapeHooks.parseFields("(class) Foo", [], []),
    [],
    "no members, no fields — a pyright class hover carries no field body to fall back on",
  );
  assert.deepStrictEqual(
    pyShapeHooks.parseFields("(class) Foo", [
      { name: "matcher", kind: "field", signature: "matcher: Matcher" },
      { name: "events", kind: "field", signature: "events: list[Event]" },
      { name: "run", kind: "method", signature: "run(self) -> None" },
      { name: "bare", kind: "field", signature: "bare" },
    ], []),
    [{ name: "matcher", typeName: "Matcher" }, { name: "events", typeName: "list[Event]" }],
    "fields come off the resolved members with the type after the colon; a method and an un-inferred " +
      "bare name yield nothing rather than a guess",
  );
  // The field-edge cursor: the annotated rule, anchored AFTER the colon so a
  // field whose name matches the type cannot anchor on itself.
  const lines = ["class Foo:", "    def __init__(self):", "        self.matcher: Matcher = Matcher()", ""];
  assert.deepStrictEqual(
    pyShapeHooks.fieldTypeCursor(lines, { open: 0, close: 3 }, "matcher", "Matcher"),
    { line: 2, character: lines[2].indexOf("Matcher") },
    "the recursive hop anchors on the field's own type token",
  );
  assert.strictEqual(pyShapeHooks.stdTypeNames, PY_STD_TYPE_NAMES, "the walk-stop set is the Python one");
  // renderDef on a head that already reads as Python: the head alone when the
  // walk derived no fields, and an annotated body when it did.
  assert.strictEqual(pyShapeHooks.renderDef({ name: "Bar", signature: "class Bar", fields: [] }), "class Bar");
  assert.strictEqual(
    pyShapeHooks.renderDef({ name: "Bar", signature: "class Bar", fields: [{ name: "matcher", typeName: "Matcher" }] }),
    "class Bar:\n    matcher: Matcher",
    "with fields: a body a reader can type, in the annotated spelling the member lines already use",
  );
  // THE REAL HOVER, and the row asks it because the convenient one hides the
  // defect. pyright hovers a class as `(class) Bar`, byte for byte, plain class
  // and Enum subclass alike (test/impl-v40-p4-py-enum-render.test.cjs opens on
  // that fact), so the chrome strip leaves a BARE NAME and not a declaration.
  //
  // RE-CUT 2026-08-11, session-v50 phase 3, and this row asked for the re-cut in
  // its own words. It used to pin `"Bar"` and `"Bar:\n    matcher: Matcher"` as
  // OBSERVED-AND-A-DEFECT: the block a Python gesture rendered read `Bar:` inside
  // a ```python fence under a header telling the model these are real
  // declarations. `pyRenderDerivedDef` now puts the keyword back when the head
  // does not already declare something, so the two expectations are the ones the
  // old comment named. The fix is in src/core/pyExtraction.ts and shipped with the
  // rest of the Python render.
  assert.strictEqual(pyShapeHooks.renderDef({ name: "Bar", signature: "(class) Bar", fields: [] }), "class Bar");
  assert.strictEqual(
    pyShapeHooks.renderDef({ name: "Bar", signature: "(class) Bar", fields: [{ name: "matcher", typeName: "Matcher" }] }),
    "class Bar:\n    matcher: Matcher",
    "the real pyright hover renders a declaration, not a bare name with a colon",
  );
  // A head that already declares keeps its own spelling: a decorated dataclass
  // hover must not collect a second `class` in front of the decorator.
  assert.strictEqual(
    pyShapeHooks.renderDef({ name: "Bar", signature: "@dataclass\nclass Bar", fields: [{ name: "n", typeName: "int" }] }),
    "@dataclass\nclass Bar:\n    n: int",
  );
});

test("PY_STD_TYPE_NAMES: names the common typing surface, not user types", () => {
  for (const n of ["Optional", "List", "Dict", "Any", "Callable", "None"]) {
    assert.ok(PY_STD_TYPE_NAMES.has(n), n);
  }
  for (const n of ["Widget", "Order", "Result"]) {
    assert.ok(!PY_STD_TYPE_NAMES.has(n), n);
  }
});
