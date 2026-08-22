// Adversarial rows against phase 9's wrong-tree refusal (`4ad41f5`): a type
// reference in a DECLARATION HEAD.
//
// The refusal's third fact was "the cursor is inside one of that container's
// members". A base list, a primary-constructor parameter, a generic constraint
// and an attribute all sit OUTSIDE every member's range, so the refusal could
// not fire there and the enclosing class's members rendered under
// `to build a <the other type>:` - the exact false statement the leg exists to
// remove.
//
// THE TREE AND THE SOURCE BELOW ARE CAPTURED, NOT INVENTED. Both come from a
// live Roslyn LS 2.140.9 (ms-dotnettools.csharp) over a real csproj, through
// `CsLspExtractor.documentSymbolsForTest`. Every `name`, `kind` and `range` is
// verbatim. Roslyn's `selectionRange` is dropped: the predicate never reads it,
// and a half-measured field is worse than an absent one. Three captured facts
// are load-bearing and none of them would survive a hand-built fixture:
//
//   * Roslyn emits NO constructor child for `Seeded(Plain seed)`, for
//     `Box<T>(T item)` or for the positional record. A primary constructor
//     parameter is therefore inside no member's range, which is why the old
//     third fact could never fire on it.
//   * A container's reported name carries its generic clause: `Box<T>`,
//     `Repo<T>`. The word under a correct cursor is `Box`.
//   * An attributed class's `range` STARTS at the attribute line (`Marked`
//     spans 30:0-34:1 while the class name is on line 31), so an attribute's
//     type argument is inside the container.
//
// What is NOT proven here, and the honest limit of the whole leg: on this box
// Roslyn's `definition()` answered CORRECTLY at all five head positions - it
// pointed at `Plain`'s own name token every time. The triggering server state,
// where a reference resolves to its OWN position, was not reproduced. These
// rows are built against the SHAPE: given a cursor at a head reference, the
// descent hands back the wrong class's members, measured live, and the refusal
// must fire. That the cursor can arrive there is the premise phase 9 already
// rests on.
//
// Run: SKIP_LIVE=1 node --test test/adversarial-v59-p9-declhead.test.cjs
// (Hermetic: captured symbol tree, no server, no network.)

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "adv-v59-p9-declhead",
  `export { resolutionReachedWrongTree, membersFromDocumentSymbols } from "../src/core/extraction";\n` +
    `export { csLspSymbolRole, toCsSymbolMember } from "../src/core/csExtraction";\n`,
);
test.after(() => cleanup());

// The file the tree was captured over, verbatim.
const SOURCE = [
  "namespace Playground;",
  "",
  "public sealed class MarkerAttribute : System.Attribute",
  "{",
  "    public MarkerAttribute(System.Type t) { Kind = t; }",
  "    public System.Type Kind { get; }",
  "}",
  "",
  "public class Plain",
  "{",
  "    public int A;",
  "    public void B() { }",
  "}",
  "",
  "public class Helper : Plain",
  "{",
  "    public void Use() { }",
  "}",
  "",
  "public class Seeded(Plain seed)",
  "{",
  "    public Plain Seed => seed;",
  "    public int Twice() => 2;",
  "}",
  "",
  "public class Repo<T> where T : Plain",
  "{",
  "    public T Item = default!;",
  "}",
  "",
  "[Marker(typeof(Plain))]",
  "public class Marked",
  "{",
  "    public int M;",
  "}",
  "",
  "[Marker(typeof(Plain))] public class MarkedInline",
  "{",
  "    public int N;",
  "}",
  "",
  "public record Point(int X, int Y);",
  "",
  "public class Box<T>(T item)",
  "{",
  "    public T Item => item;",
  "}",
];

const r = (sl, sc, el, ec) => ({ start: { line: sl, character: sc }, end: { line: el, character: ec } });
const n = (name, kind, range, children = []) => ({ name, kind, range, children });

// LSP SymbolKind numbering, as Roslyn sent it: 3 Namespace, 5 Class, 6 Method,
// 7 Property, 8 Field.
const TREE = [
  n("Playground", 3, r(0, 0, 46, 1), [
    n("MarkerAttribute", 5, r(2, 0, 6, 1), [
      n("MarkerAttribute(Type)", 6, r(4, 4, 4, 55)),
      n("Kind : Type", 7, r(5, 4, 5, 36)),
    ]),
    n("Plain", 5, r(8, 0, 12, 1), [n("A : int", 8, r(10, 15, 10, 16)), n("B() : void", 6, r(11, 4, 11, 23))]),
    n("Helper", 5, r(14, 0, 17, 1), [n("Use() : void", 6, r(16, 4, 16, 25))]),
    n("Seeded", 5, r(19, 0, 23, 1), [
      n("Seed : Plain", 7, r(21, 4, 21, 30)),
      n("Twice() : int", 6, r(22, 4, 22, 28)),
    ]),
    n("Repo<T>", 5, r(25, 0, 28, 1), [n("Item : T", 8, r(27, 13, 27, 28))]),
    n("Marked", 5, r(30, 0, 34, 1), [n("M : int", 8, r(33, 15, 33, 16))]),
    n("MarkedInline", 5, r(36, 0, 39, 1), [n("N : int", 8, r(38, 15, 38, 16))]),
    n("Point", 5, r(41, 0, 41, 34)),
    n("Box<T>", 5, r(43, 0, 46, 1), [n("Item : T", 7, r(45, 4, 45, 26))]),
  ]),
];

// A cursor one character into the nth whole-word occurrence of `word` on `line`.
const at = (line, word, occurrence = 1) => {
  const text = SOURCE[line];
  const re = new RegExp(`\\b${word}\\b`, "g");
  let m;
  for (let i = 0; i < occurrence; i++) {
    m = re.exec(text);
    if (!m) throw new Error(`occurrence ${occurrence} of ${word} is not on line ${line}: ${text}`);
  }
  return { uri: "file:///ws/DeclHeadProbe.cs", line, character: m.index };
};

const refused = (cursor) =>
  mod.resolutionReachedWrongTree(TREE, cursor, mod.csLspSymbolRole, SOURCE[cursor.line]);

const wouldRender = (cursor) =>
  mod.membersFromDocumentSymbols(TREE, cursor, mod.csLspSymbolRole, mod.toCsSymbolMember).map((m) => m.name);

// ---------------------------------------------------------------------------
// The gap. Each row's `renders` is what the descent ACTUALLY hands back at that
// cursor, measured live against Roslyn - the false surface the refusal removes.
// ---------------------------------------------------------------------------

const HEAD_REFERENCE_ROWS = [
  { why: "a base list: Plain in `public class Helper : Plain`", cursor: () => at(14, "Plain"), renders: ["Use"] },
  {
    why: "a primary-constructor parameter: Plain in `public class Seeded(Plain seed)`",
    cursor: () => at(19, "Plain"),
    renders: ["Seed", "Twice"],
  },
  {
    why: "a generic constraint: Plain in `public class Repo<T> where T : Plain`",
    cursor: () => at(25, "Plain"),
    renders: ["Item"],
  },
  {
    why: "an attribute on its own line, inside the attributed class's range",
    cursor: () => at(30, "Plain"),
    renders: ["M"],
  },
  {
    why: "an attribute inline, BEFORE the class's own name token",
    cursor: () => at(36, "Plain"),
    renders: ["N"],
  },
  {
    why: "a field's TYPE: Roslyn's field child is the NAME TOKEN alone (`Item : T` spans 27:13-27:28), so the type at column 11 is inside no member",
    cursor: () => at(27, "T"),
    renders: ["Item"],
  },
];

for (const row of HEAD_REFERENCE_ROWS) {
  test(`wrong tree, declaration head: ${row.why}`, () => {
    const cursor = row.cursor();
    assert.deepStrictEqual(
      wouldRender(cursor),
      row.renders,
      "the descent hands back this wrong surface at that cursor - if this changed, re-measure before touching the refusal",
    );
    assert.strictEqual(refused(cursor), true, "and the refusal must remove it");
  });
}

// ---------------------------------------------------------------------------
// The rows that must STAY green. A false refusal costs every correct surface;
// the gap above costs one. These are the shapes the review cleared by name,
// plus the two the phase's own suite already pinned.
// ---------------------------------------------------------------------------

const ALLOWED_ROWS = [
  {
    why: "CONTROL: the type's own name token in its own head",
    cursor: () => at(8, "Plain"),
    renders: ["A", "B"],
  },
  {
    why: "a C# 12 primary-constructor GENERIC class at its name token: the container reports `Box<T>` and the word is `Box`",
    cursor: () => at(43, "Box"),
    renders: ["Item"],
  },
  {
    why: "a generic class at its name token, no primary constructor: `Repo<T>` versus the word `Repo`",
    cursor: () => at(25, "Repo"),
    renders: ["Item"],
  },
  {
    why: "a POSITIONAL RECORD at its own name token",
    cursor: () => at(41, "Point"),
    renders: [],
  },
  {
    why: "a `public` modifier - the shape a server answering a whole-declaration span produces",
    cursor: () => at(8, "public"),
    renders: ["A", "B"],
  },
  {
    why: "the `class` keyword itself",
    cursor: () => at(14, "class"),
    renders: ["Use"],
  },
  {
    why: "a primitive in a positional record's parameter list is syntax, not a workspace type",
    cursor: () => at(41, "int"),
    renders: [],
  },
  {
    why: "`typeof` inside an attribute is a keyword, not the referenced type",
    cursor: () => at(30, "typeof"),
    renders: ["M"],
  },
];

for (const row of ALLOWED_ROWS) {
  test(`no refusal: ${row.why}`, () => {
    const cursor = row.cursor();
    assert.strictEqual(refused(cursor), false, "refusing here would cost a CORRECT surface");
    assert.deepStrictEqual(wouldRender(cursor), row.renders, "and this is the surface that survives");
  });
}

// The body reference and the member site are phase 9's own rows
// (impl-v59-p9-byname-leg), over its own tree. They are not re-cut here.
