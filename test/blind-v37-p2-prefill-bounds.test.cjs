// SUPERSEDED IN FULL by session-v48 phase 1, the context dial.
// Register entry: docs/supersessions.md.
//
// ---------------------------------------------------------------------------
// WHAT THIS FILE USED TO BE
//
// The blind contract oracle for session-v37 item 2: "give each language its own
// bounds, values unchanged". Three numbers moved off module constants onto a
// per-language `PrefillLang` entry -
//
//   typeCap (4)        spends PROMPT BYTES, roughly 765 per injected type
//   resolveCap (8)     spends LATENCY, one language-server round trip each
//   provenanceCap (24) spends the same latency currency, on definition lookups
//
// - and seventeen rows pinned them: one per language for all three values, the
// separate-own-members property, the unknown-language fallback BY IDENTITY, the
// resolveCap >= typeCap and provenanceCap >= resolveCap orderings, and a
// load-bearing row that assigned to `prefillLangFor("rust").typeCap` and
// required the injected count to follow.
//
// ---------------------------------------------------------------------------
// WHY IT IS GONE
//
// The three fields it was written about no longer exist. Session-v48 phase 1
// (`docs/constants.md`, "The derivation seam's contract") makes all three
// derivations of ONE context stop, resolved in `budgetProfileFor` and read off
// the resolved profile, for exactly the reason the v37 seam was built: so a
// later ruling could move them.
// The ruling of 2026-08-10 is that every language gets the same numbers, which
// removes both the per-language table and the mutability the seam offered.
//
// The measurements that put the numbers there are NOT refuted. Go's 8 is the
// authored-gesture funnel's knee and it is why the dial's bottom stop is 8 for
// every language; Rust's flat 4->12 ladder ran with the token budget pinned,
// and session-v45 showed that raising the cap alone relocates the loss rather
// than recovering it, so the condition Rust measured flat under does not hold
// in a dial where roots and budget move together.
//
// A row-by-row inversion was considered and refused. There is nothing to invert
// each row TO: `prefillLangFor(id).typeCap` is not a different number now, it is
// not a property. What replaced the contract is
// `test/blind-v48-p1-context-dial.test.cjs`, 54 rows against the new contract,
// written blind by an oracle that never read the implementation. What survives
// here is the reversal itself, asserted rather than described, so a build that
// quietly put the per-language table back turns this file red.
//
// Run: SKIP_LIVE=1 node --test test/blind-v37-p2-prefill-bounds.test.cjs

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");

const STUB = path.join(__dirname, ".blind-v37-p2-vscode-stub.cjs");
fs.writeFileSync(
  STUB,
  `
module.exports = {
  Position: class { constructor(l, c) { this.line = l; this.character = c; } },
  Range: class { constructor(a, b) { this.start = a; this.end = b; } },
  Uri: { parse: (s) => ({ toString: () => String(s) }), file: (s) => ({ toString: () => String(s) }) },
  SymbolKind: { Class: 4, Struct: 22, Interface: 10, Enum: 9, Module: 1, Namespace: 2, Function: 11, Method: 5 },
  languages: {}, window: {}, commands: { executeCommand: async () => undefined },
  workspace: {
    getConfiguration: () => ({ get: (k, f) => f, has: () => false, inspect: () => undefined, update: async () => {} }),
    openTextDocument: () => Promise.resolve({ getText: () => "" }),
  },
};
`,
);

const ENTRY = path.join(__dirname, ".blind-v37-p2.entry.ts");
const OUTFILE = path.join(__dirname, ".blind-v37-p2.bundle.cjs");
let mod;
let bundleSrc = "";
let bundleErr;
try {
  fs.writeFileSync(
    ENTRY,
    `export { resolvePrefill, prefillLangFor } from "../src/vscode/fnGen";\n` +
      `export { budgetProfileFor, contextBoundsFor, DEFAULT_CONTEXT_STOP } from "../src/core/budgetProfile";\n`,
  );
  esbuild.buildSync({ entryPoints: [ENTRY], bundle: true, outfile: OUTFILE, format: "cjs", platform: "node", alias: { vscode: STUB } });
  bundleSrc = fs.readFileSync(OUTFILE, "utf8");
  mod = require(OUTFILE);
} catch (e) {
  bundleErr = e;
}
test.after(() => [STUB, ENTRY, OUTFILE].forEach((f) => fs.rmSync(f, { force: true })));

test("bundle guard: the prefill seam and the dial's derivation both build headless against the vscode stub", () => {
  if (bundleErr) assert.fail(`bundle failed to build: ${bundleErr.message}`);
  assert.equal(typeof mod.prefillLangFor, "function", "prefillLangFor must still be exported");
  assert.equal(typeof mod.contextBoundsFor, "function", "the dial's derivation must be exported");
});
const btest = (name, fn) =>
  test(name, (ctx) => {
    if (bundleErr) return ctx.skip("bundle failed to build; see the bundle guard");
    return fn(ctx);
  });

const LANGS = ["rust", "typescript", "csharp", "python", "go"];
const show = (v) => JSON.stringify(v);

btest("SUPERSEDED (v48 phase 1): the three caps are NOT per-language properties any more", () => {
  // The row that would have to be edited first to put the table back. It is not
  // a style preference: two places holding the same decision is how Go's cap
  // and the shared knob drifted apart in v42 (adversarial-v42-p2 R1).
  for (const languageId of LANGS) {
    const lang = mod.prefillLangFor(languageId);
    assert.ok(lang, `${languageId} must still have a prefill entry - the language seam itself survives`);
    for (const field of ["typeCap", "resolveCap", "provenanceCap"]) {
      assert.equal(
        lang[field],
        undefined,
        `${languageId}.${field} is back on the PrefillLang entry (${show(lang[field])}). Since session-v48 ` +
          `phase 1 the three are resolved from ONE context stop in budgetProfileFor; a per-language copy ` +
          `is a second place for the same decision, which is how v42's Go cap escaped the rig's knob`,
      );
    }
  }
});

btest("SUPERSEDED (v48 phase 1): the three caps come from the stop, and are the SAME in every language", () => {
  // The reversal of the v37 A-rows and of v42's Go exception, in one row: the
  // per-language split was the point of the old seam and is what the ruling of
  // 2026-08-10 removed.
  const caps = {};
  for (const languageId of LANGS) {
    const p = mod.budgetProfileFor("local-mid", languageId, mod.DEFAULT_CONTEXT_STOP);
    caps[languageId] = { rootCap: p.rootCap, resolveCap: p.resolveCap, provenanceCap: p.provenanceCap };
  }
  const distinct = new Set(Object.values(caps).map((c) => JSON.stringify(c)));
  assert.equal(distinct.size, 1, `five languages must resolve ONE set of caps, got ${show(caps)}`);
  const bounds = mod.contextBoundsFor(mod.DEFAULT_CONTEXT_STOP);
  assert.deepEqual(
    caps.rust,
    { rootCap: bounds.rootCap, resolveCap: bounds.resolveCap, provenanceCap: bounds.provenanceCap },
    "and it is the stop's own row, not a constant that happens to agree with it",
  );
});

btest("KEPT: the ordering the v37 contract's C-rows protect survives, as a property of every stop", () => {
  // rootCap <= resolveCap <= provenanceCap. This is the one thing from the old
  // file that is still true, still load-bearing, and still worth a red row: a
  // root beyond the resolve cap can never be injected, because a type nobody
  // resolved has no surface, so a stop that broke it would be inert above its
  // resolve cap while the channel claimed otherwise.
  for (const stop of ["shipped", "small", "medium", "large", "frontier"]) {
    const b = mod.contextBoundsFor(stop);
    assert.ok(b.rootCap <= b.resolveCap, `${stop}: rootCap ${b.rootCap} > resolveCap ${b.resolveCap}`);
    assert.ok(b.resolveCap <= b.provenanceCap, `${stop}: resolveCap ${b.resolveCap} > provenanceCap ${b.provenanceCap}`);
  }
});

btest("KEPT: an unknown language id still falls back to the RUST entry, by identity", () => {
  // The v37 A7 row, unchanged in subject. Only languages with a registered
  // extractor reach resolvePrefill at all, so the fallback is the Rust path -
  // and it must be the SAME OBJECT, because a copy would let one of the two
  // drift while every test looked at the other.
  assert.strictEqual(mod.prefillLangFor("fortran"), mod.prefillLangFor("rust"));
});

btest("SUPERSEDED (v48 phase 1): the module constants the per-language table was built from are gone from fnGen", () => {
  // `PREFILL_TYPE_CAP` still exists - it is the rig's cap knob and it feeds the
  // `shipped` stop - but it lives in core/budgetProfile.ts with the stop table
  // now, and no `PrefillLang` entry copies it as its live cap.
  const copied = (bundleSrc.match(/typeCap:\s*(?:GO_)?PREFILL_TYPE_CAP/g) || []).length;
  assert.equal(copied, 0, `${copied} PrefillLang entries still copy a cap constant onto themselves`);
  // RE-CUT 2026-08-10, after the adversarial review, and the row is now the
  // sharper one. The first cut asserted `GO_PREFILL_TYPE_CAP` was gone from the
  // bundle entirely - and that made the `shipped` stop render a Go point the
  // product never shipped (1204 bytes against HEAD's 2116), which is the whole
  // job that stop exists for. The constant is back for the REPLAY and nothing
  // else: it may appear only as `shippedRootCap`, and every stop a user can
  // select must still give all five languages one root cap.
  const uses = bundleSrc.match(/\bGO_PREFILL_TYPE_CAP\b/g) || [];
  const asReplay = bundleSrc.match(/shippedRootCap:\s*GO_PREFILL_TYPE_CAP/g) || [];
  assert.equal(
    uses.length - asReplay.length,
    1, // the declaration itself
    `Go's cap constant may be READ only as the shipped-stop replay value; found ${uses.length} uses ` +
      `and ${asReplay.length} of them are the replay field`,
  );
  for (const stop of ["small", "medium", "large", "frontier"]) {
    const caps = new Set(
      ["rust", "go", "typescript", "python", "csharp"].map((id) => mod.budgetProfileFor("local-mid", id, stop).rootCap),
    );
    assert.equal(
      caps.size,
      1,
      `${stop}: Go's 8-root exception is gone from the DIAL (contract-phase1.md P4); got ${JSON.stringify([...caps])}`,
    );
  }
});
