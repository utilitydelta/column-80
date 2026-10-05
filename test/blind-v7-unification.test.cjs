// v7 Phase-2 UNIFICATION oracle (goal "Unification oracle"): after prepare is
// folded onto the cross-file resolver, exactly ONE implementation resolves a
// struct's shape (fields/methods) — resolveCrossFileShape. This greps the source
// for a SECOND same-file struct/field parser (the divergence the goal removes);
// its return is the regression guard against re-divergence. Source-level, no RA.
//
// Run: node --test test/blind-v7-unification.test.cjs
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "..", "src");
const read = (rel) => fs.readFileSync(path.join(SRC, rel), "utf8");
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(dir, e.name);
  return e.isDirectory() ? walk(p) : p.endsWith(".ts") ? [p] : [];
});

test("the same-file field/struct parsers are GONE (parseStructFields, buildLocalStructMap)", () => {
  for (const f of walk(SRC)) {
    const s = fs.readFileSync(f, "utf8");
    assert.ok(!/\bfunction\s+parseStructFields\b/.test(s), `parseStructFields still defined in ${f} — a second field parser`);
    assert.ok(!/\bfunction\s+buildLocalStructMap\b/.test(s), `buildLocalStructMap still defined in ${f} — the same-file struct graph`);
  }
});

test("exactly ONE struct-shape resolver: resolveCrossFileShape is the sole definition", () => {
  let defs = 0;
  for (const f of walk(SRC)) {
    if (/\bexport\s+(async\s+)?function\s+resolveCrossFileShape\b/.test(fs.readFileSync(f, "utf8"))) {
      defs++;
    }
  }
  assert.strictEqual(defs, 1, `resolveCrossFileShape must be defined exactly once, found ${defs}`);
});

test("prepare resolves struct shape THROUGH the resolver, not a private field parser", () => {
  const fnGen = read("vscode/fnGen.ts");
  assert.match(fnGen, /resolveCrossFileShape\(/, "prepare calls the unified resolver");
  assert.match(fnGen, /toResolveStruct\(/, "prepare feeds the resolver through walkDataShape's seam");
  // No leftover same-file struct-map construction in the prepare path.
  assert.ok(!/buildLocalStructMap\(/.test(fnGen), "prepare no longer builds a same-file struct map");
  assert.ok(!/parseStructFields\(/.test(fnGen), "prepare no longer parses fields by regex");
});

test("repair's field-shape renders through the SHARED primitives, not a bespoke struct-def", () => {
  const oracle = read("vscode/oracleSurface.ts");
  assert.match(oracle, /renderDerivedDef\(/, "repair renders the receiver shape via the shared renderer");
  assert.match(oracle, /parseStructHoverFields\(/, "repair parses hover fields via the shared parser");
  // The old bespoke assembly (`pub struct ${type} { ... }`) must be gone.
  assert.ok(
    !/`pub struct \$\{type\} \{ \$\{[a-zA-Z]+\} \}`/.test(oracle),
    "repair no longer assembles its own `pub struct ${type} { ... }` struct-def",
  );
});

// SUPERSEDED (session-v77 Amendment 1, scrap S77-6): the FIM accept no longer
// runs the oracle, so two entry points remain, not three.
test("both post-accept entry points (generate accept, Repair Function) route through ONE surface path", () => {
  const fnGen = read("vscode/fnGen.ts");
  const oracle = read("vscode/oracleSurface.ts");
  // Both entry points route via the (deps.runOracle ?? runPostAcceptOracle) seam,
  // so both reach the one oracle and nothing calls it around the seam.
  const directCalls = (fnGen.match(/runPostAcceptOracle\(\{/g) || []).length;
  assert.strictEqual(directCalls, 0, `expected no direct oracle call around the seam, found ${directCalls}`);
  const seamCalls = (fnGen.match(/\?\?\s*runPostAcceptOracle\)\(/g) || []).length;
  assert.strictEqual(seamCalls, 2, `expected 2 entry points through the runOracle seam (generate accept, Repair Function), found ${seamCalls}`);
  assert.match(fnGen, /registerCommand\("column80\.repairFunction"/, "the manual Repair Function command is registered");
  const surfaceDefs = (oracle.match(/export async function resolveSurfaceInjection\b/g) || []).length;
  assert.strictEqual(surfaceDefs, 1, `exactly one resolveSurfaceInjection (the single surface path), found ${surfaceDefs}`);
});

test("the per-type member cap is ONE shared constant (prepare and repair do not each hard-code 24)", () => {
  const extraction = read("core/extraction.ts");
  assert.match(extraction, /export const MEMBER_CAP = 24/, "the one shared cap lives in extraction.ts");
  // Neither vscode path re-declares its own numeric member cap.
  assert.ok(!/PREFILL_MEMBER_CAP\s*=\s*24/.test(read("vscode/fnGen.ts")), "prepare uses the shared MEMBER_CAP, not its own 24");
  assert.ok(!/REPAIR_MEMBER_CAP\s*=\s*24\b/.test(read("vscode/oracleSurface.ts")), "repair uses the shared MEMBER_CAP, not its own 24");
});
