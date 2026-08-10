// Adversarial review, session-v40 phase 3 (item 2): goTypesFromQualifiedUsage
// mines `pkg.Name` selectors and admits `Name` as a type candidate whenever
// `pkg` is a real import identifier in the file. It never checks whether the
// LOCAL SCOPE at the mined occurrence actually resolves `pkg` to the package
// (as opposed to a local variable/parameter that shadows the import name), so
// a shadowed identifier's field/method access gets mis-attributed to the
// import.
//
// Left RED on purpose — this is a review finding, not yet fixed. See the
// review report for severity and the corpus-noise finding this sits beside
// (goTypesFromQualifiedUsage also admits function/const/var names, not just
// types, whenever they follow a real import qualifier; downstream
// resolveTypeCursorByName's role="container" filter fails safe for pure
// noise, but a shadowed name that happens to collide with an UNRELATED real
// type elsewhere in a large workspace would anchor and inject that type's
// shape, attributed to code that has nothing to do with it).
//
// Run: node --test test/review-v40-p3-qualified-usage-adversarial.test.cjs

const test = require("node:test");
const assert = require("node:assert/strict");
const { bundleCore } = require("./.blind-util.cjs");

const { mod: CORE, cleanup } = bundleCore(
  "review-v40-p3-adversarial",
  `export { goTypesFromQualifiedUsage } from "../src/core/repairTypes";\n`,
);
test.after(cleanup);

test("REVIEW FINDING: a local variable shadowing a real import identifier must not be mined as that package", () => {
  // `strings` is a real import (used nowhere else in this snippet, which is
  // enough — the miner only checks package-name membership, never reachability
  // at the specific occurrence). The body then shadows it with a local
  // variable of the same name and accesses a field on the LOCAL value.
  const fullText = 'package x\n\nimport "strings"\n';
  const span = ["func run() {", "\tstrings := MyLocalType{}", "\tx := strings.Foo", "\t_ = x", "}"].join("\n");
  const out = CORE.goTypesFromQualifiedUsage("func run()", undefined, span, fullText);
  // Current (buggy) behavior mines ["Foo"], attributing MyLocalType's own
  // field to the `strings` package. A correct miner must refuse a shadowed
  // qualifier the same way it already refuses a qualifier that was never
  // imported at all (the sibling test in impl-v40-p3-qualified-usage.test.cjs,
  // "a qualifier with no matching import is refused").
  assert.deepEqual(out, [], "a shadowed import identifier must not be mined as the package it shadows");
});

test("REVIEW FINDING: pkg.Func() — an exported FUNCTION call is mined as though it named a type", () => {
  // encoding/json.NewEncoder is a constructor FUNCTION, not a type. Every
  // exported Go identifier is capitalized, so `pkg.<Anything>` cannot
  // distinguish a type from a function/const/var syntactically — but the
  // miner does not try, and admits every one. Downstream resolveTypeCursorByName
  // fails this safely (role="container" filter), so this is not a correctness
  // bug in what gets INJECTED, but it is not a "real, sane type name" either,
  // and it burns a live workspace/symbol round trip plus a resolveCap/typeCap
  // slot for every occurrence — see the review report's corpus sample (cobra
  // command.go, 45 functions with >=1 candidate: only 3 of ~29 distinct mined
  // names were real types; the rest were funcs/consts/vars such as
  // NewFlagSet, ContinueOnError, Fprintf, Errorf, Stderr, CommandLine).
  const fullText = 'package x\n\nimport "encoding/json"\n';
  const span = ["func run(w io.Writer, v any) error {", "\treturn json.NewEncoder(w).Encode(v)", "}"].join("\n");
  const out = CORE.goTypesFromQualifiedUsage("func run(w io.Writer, v any) error", undefined, span, fullText);
  // SUPERSEDED (session-v42 phase 0, S40-3): the over-admission this row
  // documented is FIXED - a mined name immediately followed by `(` is refused
  // before the lookup fires, so `json.NewEncoder(` no longer emits. The
  // original expectation `["NewEncoder"]` was the record of the defect ("NOT
  // an endorsement", its own words); the row now pins the fix. Measured on
  // the clean v42 corpus: round trips 2.34 -> 1.10 per row, ceiling flat at
  // 17.8% (spike-0-ceiling.cjs). test/impl-v42-p0-call-guard.test.cjs carries
  // the fix's own rows.
  assert.deepEqual(out, [], "a function call is refused before it burns the round trip");
});
