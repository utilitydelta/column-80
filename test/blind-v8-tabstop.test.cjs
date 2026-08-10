// Blind oracle: the blank-value tabstop renderer [P3-surface.md
// "renderBlankValue", goal.md finding 1b + contract item 2]. ONE pure function
// turns a resolved RETURN TYPE into a VS Code snippet RHS with ${N} holes, per
// a fixed-precedence arity rule: scalar -> tuple -> array -> fixed-struct ->
// variable. The whole point is a controlled leak boundary: scaffold what the
// TYPE determines (visible in the signature anyway, no contract leak), keep as
// ONE hole what the CONTRACT determines (leaking it defeats blank-value). This
// test mirrors session-v8/tabstop-templates.txt (ground truth) exactly. Never
// read src/**; renderBlankValue is a stub, so multi-hole/struct/tuple/array/
// startHole cases are expected genuine RED.
//
// Run: SKIP_LIVE=1 node --test test/blind-v8-tabstop.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "blind-v8-tabstop",
  `export { renderBlankValue } from "../src/core/tabstop";\n`
);
const { renderBlankValue } = mod;
test.after(cleanup);

// Cross-check the impl can't fudge: holes MUST equal the count of ${...}
// occurrences in rhs [P3-surface clause: "holes always equals the count of
// ${…} occurrences in rhs"]. Every case asserts this.
function countHoles(rhs) {
  const m = rhs.match(/\$\{/g);
  return m ? m.length : 0;
}
function assertInvariant(res, label) {
  assert.strictEqual(
    res.holes,
    countHoles(res.rhs),
    `[invariant ${label}] holes(${res.holes}) must equal the number of \${…} in rhs(${JSON.stringify(res.rhs)})`,
  );
}

// ---------------------------------------------------------------------------
// 1. SCALAR  [P3 clause 1; template lines 3-5] -> one hole "${1}", no leak.
// ---------------------------------------------------------------------------

for (const ty of ["i32", "u64", "usize", "isize", "f64", "f32", "bool", "char", "i8", "u128"]) {
  test(`scalar ${ty} -> { rhs: "\${1}", holes: 1 } [P3 clause 1; template line 3]`, () => {
    const res = renderBlankValue(ty);
    assert.strictEqual(res.rhs, "${1}", `scalar ${ty} scaffolds a single bare hole`);
    assert.strictEqual(res.holes, 1, `scalar ${ty} is exactly one hole`);
    assertInvariant(res, `scalar ${ty}`);
  });
}

// ---------------------------------------------------------------------------
// 2. TUPLE  [P3 clause 2; template line 6] -> one hole per TOP-LEVEL element,
//    split respecting <> () [] nesting.
// ---------------------------------------------------------------------------

test(`tuple (i32, i32) -> "(\${1}, \${2})", holes 2 [P3 clause 2; template line 6]`, () => {
  const res = renderBlankValue("(i32, i32)");
  assert.strictEqual(res.rhs, "(${1}, ${2})", "tuple scaffolds parens with one hole per element");
  assert.strictEqual(res.holes, 2, "two top-level elements -> two holes");
  assertInvariant(res, "tuple (i32, i32)");
});

// Nesting: the split must respect <> and () so inner commas do NOT create holes.
const tupleNestingCases = [
  { ty: "(i32, Vec<u8>)", why: "no inner comma, but Vec<u8> is one element not scaffolded" },
  { ty: "(i32, (u8, u8))", why: "the inner tuple's comma is inside () -> one top-level hole for it" },
  { ty: "(String, HashMap<u8, u8>)", why: "the comma inside HashMap<u8, u8> is inside <> -> not a split" },
];
for (const { ty, why } of tupleNestingCases) {
  test(`tuple ${ty} -> "(\${1}, \${2})", holes 2 (top-level split respects nesting) [P3 clause 2: "(i32, Vec<u8>) is 2 elements not 3"]`, () => {
    const res = renderBlankValue(ty);
    assert.strictEqual(res.rhs, "(${1}, ${2})", `${ty}: ${why}`);
    assert.strictEqual(res.holes, 2, `${ty}: exactly two top-level elements -> two holes, not more`);
    assertInvariant(res, `tuple ${ty}`);
  });
}

// A 3-element tuple, to prove scaffolding is not hard-coded to 2.
test(`tuple (i32, i32, i32) -> "(\${1}, \${2}, \${3})", holes 3 [P3 clause 2]`, () => {
  const res = renderBlankValue("(i32, i32, i32)");
  assert.strictEqual(res.rhs, "(${1}, ${2}, ${3})", "three top-level elements -> three holes");
  assert.strictEqual(res.holes, 3);
  assertInvariant(res, "tuple 3");
});

// ---------------------------------------------------------------------------
// 3. ARRAY  [P3 clause 3; template line 7] -> literal K -> K holes; non-literal
//    length falls through to variable (one hole with the type comment).
// ---------------------------------------------------------------------------

test(`array [u8; 3] -> "[\${1}, \${2}, \${3}]", holes 3 [P3 clause 3; template line 7]`, () => {
  const res = renderBlankValue("[u8; 3]");
  assert.strictEqual(res.rhs, "[${1}, ${2}, ${3}]", "array with literal length scaffolds K holes in brackets");
  assert.strictEqual(res.holes, 3, "K=3 literal -> three holes");
  assertInvariant(res, "array [u8; 3]");
});

test(`array [i32; 2] -> "[\${1}, \${2}]", holes 2 [P3 clause 3]`, () => {
  const res = renderBlankValue("[i32; 2]");
  assert.strictEqual(res.rhs, "[${1}, ${2}]");
  assert.strictEqual(res.holes, 2);
  assertInvariant(res, "array [i32; 2]");
});

test(`array [u8; N] with a NON-literal (const-generic) length -> variable one hole, type in the comment [P3 clause 3: "falls through to variable"]`, () => {
  const res = renderBlankValue("[u8; N]");
  assert.strictEqual(res.holes, 1, "const-generic length is not scaffoldable -> one hole");
  assert.strictEqual(res.rhs, "${1:/* [u8; N] */}", "degrades to the variable one-hole form with the verbatim type");
  assert.ok(res.rhs.includes("[u8; N]"), "the exact type text is shown so the human sees what to type");
  assertInvariant(res, "array [u8; N]");
});

// ---------------------------------------------------------------------------
// 4. FIXED STRUCT  [P3 clause 4; template line 8] -> one hole per field, in
//    field ORDER, from opts.structFields.
// ---------------------------------------------------------------------------

test(`fixed struct Point{x,y} -> "Point { x: \${1}, y: \${2} }", holes 2 [P3 clause 4; template line 8]`, () => {
  const res = renderBlankValue("Point", { structFields: [{ name: "x", typeName: "i32" }, { name: "y", typeName: "i32" }] });
  assert.strictEqual(res.rhs, "Point { x: ${1}, y: ${2} }", "struct scaffolds Name { field: hole, ... } in field order");
  assert.strictEqual(res.holes, 2, "two fields -> two holes");
  assertInvariant(res, "struct Point");
});

test(`fixed struct preserves field ORDER (3 fields) [P3 clause 4: "one hole per field, in field order"]`, () => {
  const res = renderBlankValue("Rgb", {
    structFields: [
      { name: "red", typeName: "u8" },
      { name: "green", typeName: "u8" },
      { name: "blue", typeName: "u8" },
    ],
  });
  assert.strictEqual(res.rhs, "Rgb { red: ${1}, green: ${2}, blue: ${3} }", "fields appear in given order with ascending holes");
  assert.strictEqual(res.holes, 3);
  // Order is load-bearing: red before green before blue, holes 1<2<3 respectively.
  assert.ok(res.rhs.indexOf("red") < res.rhs.indexOf("green"), "red field precedes green");
  assert.ok(res.rhs.indexOf("green") < res.rhs.indexOf("blue"), "green field precedes blue");
  assertInvariant(res, "struct Rgb");
});

// A named type WITHOUT structFields is NOT a fixed struct -> variable (clause 5).
// (Pinned in the variable section below.)

// ---------------------------------------------------------------------------
// 5. VARIABLE  [P3 clause 5; template lines 9-11] -> ONE hole, and the type
//    text appears VERBATIM inside the placeholder comment.
// ---------------------------------------------------------------------------

const variableCases = [
  { ty: "Option<i32>", note: "variant choice is contract (template line 11)" },
  { ty: "String", note: "std String -> variable" },
  { ty: "Result<T, E>", note: "Result variant choice is contract -> variable" },
  { ty: "Widget", note: "bare named type with NO structFields -> variable (conservative, never leak shape)" },
  { ty: "Shape", note: "enum-looking named type -> variable" },
];
for (const { ty, note } of variableCases) {
  test(`variable ${ty} -> one hole with the type verbatim in the comment [P3 clause 5; ${note}]`, () => {
    const res = renderBlankValue(ty);
    assert.strictEqual(res.holes, 1, `${ty}: the whole value is exactly ONE hole`);
    assert.strictEqual(res.rhs, `\${1:/* ${ty} */}`, `${ty}: variable one-hole placeholder mirrors template`);
    assert.ok(res.rhs.includes(ty), `${ty}: the exact type string appears inside the hole so the human sees what to type`);
    assertInvariant(res, `variable ${ty}`);
  });
}

// Precedence: a named type with structFields is a fixed struct; the SAME name
// with none is variable. Pins clause 4 vs clause 5 boundary.
test(`named type WITHOUT structFields degrades to variable one hole [P3 clause 5: "a named type with NO structFields"]`, () => {
  const res = renderBlankValue("Point"); // no opts.structFields this time
  assert.strictEqual(res.holes, 1, "no structFields -> not a fixed struct -> one variable hole");
  assert.strictEqual(res.rhs, "${1:/* Point */}", "the name is the verbatim placeholder");
  assertInvariant(res, "Point-no-fields");
});

test(`empty structFields array is NOT a fixed struct -> variable [P3 clause 4: "provided and non-empty"]`, () => {
  const res = renderBlankValue("Point", { structFields: [] });
  assert.strictEqual(res.holes, 1, "empty structFields is not scaffoldable -> one hole");
  assert.strictEqual(res.rhs, "${1:/* Point */}");
  assertInvariant(res, "Point-empty-fields");
});

// ---------------------------------------------------------------------------
// 5b. STD COLLECTION [P3 clause 5b] -> scaffold the type-determined constructor,
//     keep the contract-determined CONTENTS as ONE hole hinting the element type.
//     The constructor (`vec!`, `HashSet::from([…])`) leaks no value; the count and
//     the values stay a single hole. Option/Result are NOT collections (variant
//     choice is the answer) and stay variable, pinned above.
// ---------------------------------------------------------------------------

const collectionCases = [
  { ty: "Vec<u8>", rhs: "vec![${1:/* u8 */}]", note: "Vec uses the prelude vec! macro" },
  { ty: "Vec<(char, usize)>", rhs: "vec![${1:/* (char, usize) */}]", note: "element type is one arg (tuple), hinted verbatim" },
  { ty: "HashSet<i32>", rhs: "HashSet::from([${1:/* i32 */}])", note: "set -> From<[T; N]>" },
  { ty: "std::collections::HashSet<String>", rhs: "std::collections::HashSet::from([${1:/* String */}])", note: "fully-qualified path is preserved" },
  { ty: "BTreeSet<u64>", rhs: "BTreeSet::from([${1:/* u64 */}])", note: "BTreeSet -> From<[T; N]>" },
  { ty: "VecDeque<u8>", rhs: "VecDeque::from([${1:/* u8 */}])", note: "VecDeque -> From<[T; N]>" },
  { ty: "HashMap<String, usize>", rhs: "HashMap::from([${1:/* (String, usize) */}])", note: "map contents hinted as a (K, V) pair" },
  { ty: "BTreeMap<String, i32>", rhs: "BTreeMap::from([${1:/* (String, i32) */}])", note: "BTreeMap -> From<[(K, V); N]>" },
];
for (const { ty, rhs, note } of collectionCases) {
  test(`collection ${ty} -> scaffolds the constructor, contents ONE hole [P3 clause 5b; ${note}]`, () => {
    const res = renderBlankValue(ty);
    assert.strictEqual(res.rhs, rhs, `${ty}: constructor scaffolded, contents a single hole`);
    assert.strictEqual(res.holes, 1, `${ty}: exactly one hole (count + values are contract-determined)`);
    // No VALUE leak: the guessed contents never appear; only the element TYPE, which
    // the return type already fixes, is shown as the hole's comment hint.
    assertInvariant(res, `collection ${ty}`);
  });
}

test(`collection scaffold threads startHole: HashSet<i32> @9 -> "HashSet::from([\${9:/* i32 */}])" [P3 clause 5b + startHole]`, () => {
  const res = renderBlankValue("HashSet<i32>", { startHole: 9 });
  assert.strictEqual(res.rhs, "HashSet::from([${9:/* i32 */}])", "the single content hole is numbered from startHole");
  assert.strictEqual(res.holes, 1);
  assertInvariant(res, "collection @9");
});

test(`a malformed container (wrong arity) degrades to variable, never a broken scaffold [P3 clause 5b guard]`, () => {
  // HashMap needs 2 args; with 1 it is not a map -> variable one-hole, no crash.
  const res = renderBlankValue("HashMap<String>");
  assert.strictEqual(res.holes, 1);
  assert.strictEqual(res.rhs, "${1:/* HashMap<String> */}", "an ill-formed map is not scaffolded; it degrades to the variable form");
  assertInvariant(res, "HashMap<String> arity");
});

// ---------------------------------------------------------------------------
// 6. LEAK CHECK (the whole point) [P3 notes: "scalar/fixed forms do NOT leak
//    the value; the variable one-hole placeholder contains the type verbatim"].
//    Both directions pinned.
// ---------------------------------------------------------------------------

test(`NO LEAK: scalar/tuple/array/struct RHS contains no placeholder comment (value not leaked) [P3 note: "scalar/fixed forms do NOT leak"]`, () => {
  const scaffolded = [
    renderBlankValue("i32"),
    renderBlankValue("(i32, i32)"),
    renderBlankValue("(i32, Vec<u8>)"),
    renderBlankValue("[u8; 3]"),
    renderBlankValue("Point", { structFields: [{ name: "x", typeName: "i32" }, { name: "y", typeName: "i32" }] }),
  ];
  for (const res of scaffolded) {
    assert.ok(!res.rhs.includes("/*"), `scaffolded form must carry no /* type comment (no leak): ${JSON.stringify(res.rhs)}`);
    assert.ok(!res.rhs.includes("*/"), `scaffolded form must carry no comment terminator: ${JSON.stringify(res.rhs)}`);
  }
  // Specifically: the tuple element type text must not appear in the scaffold.
  assert.ok(!renderBlankValue("(i32, Vec<u8>)").rhs.includes("Vec<u8>"), "tuple element type Vec<u8> is not pre-filled");
});

test(`LEAK BY DESIGN: variable RHS MUST contain the type text as a comment (shape is contract-determined, stays one hole) [P3 note: "the variable one-hole placeholder contains the type text verbatim"]`, () => {
  const res = renderBlankValue("Option<i32>");
  assert.ok(res.rhs.includes("/*") && res.rhs.includes("*/"), "variable form carries a placeholder comment");
  assert.ok(res.rhs.includes("Option<i32>"), "the exact type string is shown to the human");
});

// ---------------------------------------------------------------------------
// 7. startHole threading [P3 clause: "startHole threads numbering"; default 1].
// ---------------------------------------------------------------------------

test(`startHole threads numbering: (i32, i32) @5 -> "(\${5}, \${6})", holes 2 [P3: "startHole threads numbering"]`, () => {
  const res = renderBlankValue("(i32, i32)", { startHole: 5 });
  assert.strictEqual(res.rhs, "(${5}, ${6})", "holes run consecutively from startHole");
  assert.strictEqual(res.holes, 2, "holes counts the emitted holes, not the max index");
  assertInvariant(res, "tuple @5");
});

test(`startHole on a scalar: i32 @3 -> "\${3}", holes 1 [P3: "N running consecutively from opts.startHole"]`, () => {
  const res = renderBlankValue("i32", { startHole: 3 });
  assert.strictEqual(res.rhs, "${3}", "the single scalar hole is numbered from startHole");
  assert.strictEqual(res.holes, 1);
  assertInvariant(res, "scalar @3");
});

test(`startHole on an array: [u8; 3] @10 -> "[\${10}, \${11}, \${12}]", holes 3 [P3 clause 3 + startHole]`, () => {
  const res = renderBlankValue("[u8; 3]", { startHole: 10 });
  assert.strictEqual(res.rhs, "[${10}, ${11}, ${12}]");
  assert.strictEqual(res.holes, 3);
  assertInvariant(res, "array @10");
});

test(`startHole on a struct: Point @7 -> "Point { x: \${7}, y: \${8} }", holes 2 [P3 clause 4 + startHole]`, () => {
  const res = renderBlankValue("Point", { startHole: 7, structFields: [{ name: "x", typeName: "i32" }, { name: "y", typeName: "i32" }] });
  assert.strictEqual(res.rhs, "Point { x: ${7}, y: ${8} }");
  assert.strictEqual(res.holes, 2);
  assertInvariant(res, "struct @7");
});

test(`startHole on a variable one-hole: String @4 -> "\${4:/* String */}", holes 1 [P3 clause 5 + startHole]`, () => {
  const res = renderBlankValue("String", { startHole: 4 });
  assert.strictEqual(res.rhs, "${4:/* String */}", "variable hole is numbered from startHole, type verbatim");
  assert.strictEqual(res.holes, 1);
  assertInvariant(res, "variable @4");
});

test(`startHole defaults to 1 when opts omits it [P3: "default 1"]`, () => {
  assert.strictEqual(renderBlankValue("i32").rhs, "${1}", "no opts -> startHole 1");
  assert.strictEqual(renderBlankValue("i32", {}).rhs, "${1}", "empty opts -> startHole 1");
});

// ---------------------------------------------------------------------------
// 8. ROBUSTNESS [P3: "Never throws; a bizarre/empty returnType degrades to the
//    variable one-hole form"].
// ---------------------------------------------------------------------------

test(`empty returnType does not throw; degrades to the variable one-hole form [P3: "bizarre/empty ... degrades"]`, () => {
  let res;
  assert.doesNotThrow(() => { res = renderBlankValue(""); }, "empty return type must not throw");
  assert.strictEqual(res.holes, 1, "empty type -> one hole");
  assert.strictEqual(countHoles(res.rhs), 1, "one ${…} occurrence");
  assertInvariant(res, "empty");
});

test(`garbage returnType does not throw; degrades to the variable one-hole form [P3: "an unparseable type" -> variable]`, () => {
  for (const junk of ["(((", "<<>", "!@#$%", "[u8;", "Vec<"]) {
    let res;
    assert.doesNotThrow(() => { res = renderBlankValue(junk); }, `garbage ${JSON.stringify(junk)} must not throw`);
    assert.strictEqual(res.holes, 1, `garbage ${JSON.stringify(junk)} -> one hole`);
    assert.strictEqual(countHoles(res.rhs), 1, `garbage ${JSON.stringify(junk)} -> one ${"${…}"} in rhs`);
    assertInvariant(res, `garbage ${junk}`);
  }
});
