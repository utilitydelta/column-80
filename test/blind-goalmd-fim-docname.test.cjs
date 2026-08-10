// BLIND ORACLE — goal.md "round-1 injection resolves the WRONG type", FIM half.
// Defect 2 (shared with fn-gen): the C# whole-block detector extracts collaborator
// types ONLY from the signature's return type and params. `int StripeFanout()`
// names no user type there, so csWholeBlockSite returns undefined -> FIM gets zero
// injection -> the 1.5b invents a whole fictional API (new Stripe(1,2,3),
// Map<Aggregate>, tile.Codex()...). The collaborator is named only in the
// docstring, which the detector never reads.
//
// THE FIX these tests specify: csWholeBlockSite also mines backtick-quoted
// collaborator types from the doc-comment that heads the method (the same
// convention fn-gen adopts). The extracted names feed resolveWholeBlock, which
// resolves them via the LS — that resolution is the LIVE half, not covered here.
//
// RED by design until the fix lands. Pure over strings; never reads src/**.
// Run: SKIP_LIVE=1 node --test test/blind-goalmd-fim-docname.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

let mod = {};
let cleanup = () => {};
let bundleErr;
try {
  ({ mod, cleanup } = bundleCore(
    "blind-goalmd-fim-docname",
    `export { csWholeBlockSite, wholeBlockSiteFor } from "../src/core/fimWholeBlock";\n`,
  ));
} catch (e) {
  bundleErr = e;
}
test.after(() => cleanup());
const { csWholeBlockSite, wholeBlockSiteFor } = mod;

test("bundle guard: fimWholeBlock bundles headless", () => {
  if (bundleErr) assert.fail(`bundle failed: ${bundleErr.message}`);
});

// The registry arm must stay resolvable regardless of the fix (no sibling disturbed).
test("wholeBlockSiteFor('csharp') still resolves a detector fn", () => {
  assert.strictEqual(typeof wholeBlockSiteFor("csharp"), "function");
});

// The production case: an empty StripeFanout body whose ONLY collaborator mention
// is the backticked `Stripe` in the doc-comment above it. The signature names no
// user type (primitive int return, no params).
const STRIPE_PREFIX =
  "    /// <summary>\n" +
  "    /// Create a `Stripe`, enroll tiles at morton codes 1, 2 and 3, and\n" +
  "    /// return the stripe's aggregate fanout.\n" +
  "    /// </summary>\n" +
  "    public static int StripeFanout()\n" +
  "    {\n" +
  "        ";

test("Defect 2: csWholeBlockSite surfaces a doc-named backticked collaborator", () => {
  const site = csWholeBlockSite(STRIPE_PREFIX);
  assert.ok(site, "an empty body over a doc naming a collaborator is a whole-block site (currently undefined)");
  assert.ok(
    Array.isArray(site.types) && site.types.includes("Stripe"),
    `the doc's backticked Stripe is a type-in-play; got ${JSON.stringify(site && site.types)}`,
  );
});

// No regression: a collaborator named in the SIGNATURE (the existing path) is
// still extracted. This must stay GREEN through the fix.
test("no regression: a signature param type is still extracted", () => {
  const prefix = "    public int Fill(Widget w)\n    {\n        ";
  const site = csWholeBlockSite(prefix);
  assert.ok(site, "a signature naming a user type is still a site");
  assert.ok(site.types.includes("Widget"), `signature param type still found; got ${JSON.stringify(site && site.types)}`);
});
