// BLIND ORACLE — goal.md "round-1 injection resolves the WRONG type".
// Defect 1: pre-fill treats the function's OWN name as a collaborator type.
// `typesNamedIn` mines every PascalCase token in the signature, and a C# method
// name is PascalCase (StripeFanout), so the target's own name becomes a
// candidate, resolves to the enclosing class's members, and fills the single
// injection slot — the model never sees the real collaborator. (Rust never hit
// this: fn names are snake_case, invisible to the PascalCase scan.)
//
// THE FIX these tests specify: typesNamedIn takes an optional `excludeName` (the
// declared symbol, threaded from resolved.symbolName) and never returns it. This
// is the pure, core-level seam the earlier reconstruction spike bypassed by
// hand-writing the surface — so it never caught the resolver defect.
//
// RED by design until the fix lands. Pure over strings; never reads src/**.
// Run: SKIP_LIVE=1 node --test test/blind-goalmd-prefill-targetname.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

let mod = {};
let cleanup = () => {};
let bundleErr;
try {
  ({ mod, cleanup } = bundleCore(
    "blind-goalmd-prefill-targetname",
    `export { typesNamedIn } from "../src/core/compilerDirected";\n`,
  ));
} catch (e) {
  bundleErr = e;
}
test.after(() => cleanup());
const { typesNamedIn } = mod;

test("bundle guard: compilerDirected bundles headless", () => {
  if (bundleErr) assert.fail(`bundle failed: ${bundleErr.message}`);
});

// The exact production case from the logPrompts dump: generating StripeFanout,
// the injected surface was "Members of `StripeFanout`" (the Fns siblings). The
// function's own name must never be a candidate.
test("Defect 1: typesNamedIn excludes the declared symbol name (StripeFanout)", () => {
  const got = typesNamedIn("public static int StripeFanout()", undefined, "StripeFanout");
  assert.ok(
    !got.includes("StripeFanout"),
    `the target's own name must never be an injection candidate; got ${JSON.stringify(got)}`,
  );
});

// Defect 1 + Defect 2 together: with the collaborator backticked in the doc (the
// convention the fix adopts), the REAL type is a candidate and the target name
// is not. This is the surface round-1 should have carried.
test("Defect 1+2: real backticked collaborator kept, target name dropped", () => {
  const got = typesNamedIn("public static int StripeFanout()", "Create a `Stripe`, enroll tiles.", "StripeFanout");
  assert.ok(got.includes("Stripe"), `the backticked doc collaborator is a candidate; got ${JSON.stringify(got)}`);
  assert.ok(!got.includes("StripeFanout"), `the target's own name is excluded; got ${JSON.stringify(got)}`);
});

// The exclusion must be SURGICAL: only the declared name is dropped, never other
// PascalCase types in the signature. A method returning StripeSummary and taking
// a Stripe keeps both; only its own name (Build) goes.
test("exclusion is surgical: other signature types survive, only the target name drops", () => {
  const got = typesNamedIn("public static StripeSummary Build(Stripe s)", undefined, "Build");
  assert.ok(got.includes("Stripe"), `param type Stripe kept; got ${JSON.stringify(got)}`);
  assert.ok(got.includes("StripeSummary"), `return type StripeSummary kept; got ${JSON.stringify(got)}`);
  assert.ok(!got.includes("Build"), `the target's own name Build is excluded; got ${JSON.stringify(got)}`);
});

// Backward-compat: called WITHOUT excludeName (Rust/TS callers not yet threading
// it), behaviour is unchanged — nothing is silently dropped.
test("no excludeName arg: behaviour unchanged (nothing dropped)", () => {
  const got = typesNamedIn("fn build(s: Stripe) -> StripeSummary");
  assert.deepStrictEqual(got, ["Stripe", "StripeSummary"], `two-arg call unchanged; got ${JSON.stringify(got)}`);
});
