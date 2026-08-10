// IMPLEMENTER regression test for the Defect-1 exclusion over the REAL Roslyn
// documentSymbol name shape. The blind oracle (blind-goalmd-prefill-targetname)
// excluded a BARE name ("StripeFanout"), but the C# transport threads
// resolved.symbolName = the documentSymbol name VERBATIM, which Roslyn renders
// WITH CHROME: "StripeFanout() : int", "PickLargest<T>(...) : T?" (PROVEN by a
// live documentSymbol probe on csharp-scratch). An exact-string compare against
// the chromed name never matched the bare scanned token, so the target's own
// name leaked back into round-1 injection ("Members of `StripeFanout`"). This
// pins the leading-identifier normalization so it can never regress.
//
// Run: SKIP_LIVE=1 node --test test/impl-goalmd-prefill-chrome.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-goalmd-prefill-chrome",
  `export { typesNamedIn } from "../src/core/compilerDirected";\n`,
);
test.after(() => cleanup());
const { typesNamedIn } = mod;

const SIG = "public static int StripeFanout()";

// The EXACT string Roslyn returns as DocumentSymbol.name for the method (probed
// live). This is what resolved.symbolName carries into the pre-fill.
const CHROMED = "StripeFanout() : int";

test("Defect 1 over the REAL chromed symbol name: the target's own name is still excluded", () => {
  const plain = typesNamedIn(SIG, "Create a Stripe, enroll tiles", CHROMED);
  assert.ok(!plain.includes("StripeFanout"), `chromed excludeName must still drop StripeFanout; got ${JSON.stringify(plain)}`);
  // Plain prose "Stripe" is not backticked, so round-1 has no candidate — the
  // honest empty, NOT the sibling-class garbage.
  assert.deepStrictEqual(plain, [], `plain-doc round-1 is empty, not garbage; got ${JSON.stringify(plain)}`);
});

test("Defect 1+2 over the chromed name: a backticked collaborator resolves, target name dropped", () => {
  const got = typesNamedIn(SIG, "Create a `Stripe`, enroll tiles", CHROMED);
  assert.deepStrictEqual(got, ["Stripe"], `backticked Stripe kept, chromed target name dropped; got ${JSON.stringify(got)}`);
});

test("a generic method's chromed name is excluded by its leading identifier", () => {
  const got = typesNamedIn(
    "public static T? PickLargest<T>(IReadOnlyList<T> items, Func<T, int> measure)",
    undefined,
    "PickLargest<T>(IReadOnlyList<T>, Func<T, int>) : T?",
  );
  assert.ok(!got.includes("PickLargest"), `the generic target's own name is excluded; got ${JSON.stringify(got)}`);
});

test("a bare excludeName (Rust/TS callers) still works unchanged", () => {
  const got = typesNamedIn(SIG, "Create a `Stripe`", "StripeFanout");
  assert.deepStrictEqual(got, ["Stripe"], `bare name path unchanged; got ${JSON.stringify(got)}`);
});
