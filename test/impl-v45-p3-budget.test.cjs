// IMPLEMENTER tests - session-v45 phase 3: the per-language aggregate render
// budget.
//
// The phase ships a MECHANISM at the shipped value, so its load-bearing claim is
// a negative one: nothing changes yet. These pin the resolution rule and the
// no-op; the proof that the rig's knob still REACHES C# is empirical and lives
// in the C# funnel arms, because a constant that looks wired and is not reads
// as "the budget was not the lever after all".
//
// Run: SKIP_LIVE=1 node --test test/impl-v45-p3-budget.test.cjs

// THE MEASUREMENT RIG LIVES IN A DIFFERENT REPOSITORY (2026-08-10). It and the
// session archives were split into a private repo because they carry corpora
// taken against private client code and cannot be published, so a public clone
// has no `session-complxity-research/` and the rows below have no subject.
//
// The whole file skips, with the reason on the channel. It SKIPS rather than
// passing vacuously: a row that goes green when the thing it tests is absent is
// the false green this suite exists to prevent. Where a baseline can be
// vendored instead, vendor it (see test/fixtures/prompt) and do not use this.
const { RIG_PRESENT, SKIP_REASON } = require("./.rig-present.cjs");
if (!RIG_PRESENT) {
  require("node:test")("rig-dependent rows", { skip: SKIP_REASON }, () => {});
  return;
}

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const esbuild = require("esbuild");

// fnGen.ts imports vscode, so the bundle aliases it to the structural stub the
// live oracles use. Built ONCE at load: three rows share it and a per-row build
// would triple the esbuild cost for nothing.
const STUB = path.join(__dirname, "..", "session-complxity-research", "spikes", "stub-vscode.cjs");
const ENTRY = path.join(__dirname, ".v45p3.entry.ts");
const BUNDLE = path.join(__dirname, ".v45p3.bundle.cjs");
fs.writeFileSync(ENTRY, `export { prefillTotalTok } from "../src/vscode/fnGen";\n`);
esbuild.buildSync({
  entryPoints: [ENTRY],
  bundle: true,
  outfile: BUNDLE,
  format: "cjs",
  platform: "node",
  alias: { vscode: STUB },
});
const P = require(BUNDLE);
fs.rmSync(ENTRY, { force: true });
fs.rmSync(BUNDLE, { force: true });

const SRC = fs.readFileSync(path.join(__dirname, "..", "src", "vscode", "fnGen.ts"), "utf8");
// session-v46 phase 0b moved the budget base and its C# factor into the
// derivation seam (src/core/budgetProfile.ts) so the walk, the repair side and
// the profile share one source. The factor rows below read that file now; the
// assertions themselves are unchanged.
const PROFILE_SRC = fs.readFileSync(path.join(__dirname, "..", "src", "core", "budgetProfile.ts"), "utf8");

// ---------------------------------------------------------------------------
// The resolution rule
// ---------------------------------------------------------------------------

test("prefillTotalTok: a language's own budget wins over the gesture profile's", () => {
  assert.equal(P.prefillTotalTok({ dataShapeTotalTok: 900 }, { totalTok: 300 }), 900);
});

test("prefillTotalTok: a language without one falls back to the profile", () => {
  assert.equal(P.prefillTotalTok({}, { totalTok: 300 }), 300);
  assert.equal(P.prefillTotalTok({ dataShapeTotalTok: undefined }, { totalTok: 500 }), 500);
});

test("prefillTotalTok: 0 is a real budget and must NOT fall through to the profile", () => {
  // `??` and `||` differ here, and the difference is a silent one: with `||` a
  // language pinned to 0 would quietly inherit 300 and render blocks it was
  // configured never to render.
  assert.equal(P.prefillTotalTok({ dataShapeTotalTok: 0 }, { totalTok: 300 }), 0);
});

// ---------------------------------------------------------------------------
// The no-op claim, and the knob that must keep winning
// ---------------------------------------------------------------------------

test("at the shipped factor C#'s budget EQUALS the global, so the phase is a no-op", () => {
  const m = /const CS_BUDGET_FACTOR = (\d+(?:\.\d+)?);/.exec(PROFILE_SRC);
  assert.ok(m, "CS_BUDGET_FACTOR is missing");
  assert.equal(
    Number(m[1]),
    1,
    "C#'s budget factor was changed without the generation arm that was supposed to choose it (contract-phase3)",
  );
});

test("the C# budget MULTIPLIES the rig's knob, so every ladder rung stays reachable", () => {
  // The rig patches `var DATASHAPE_TOTAL_TOK = <n>;`. A bare literal would make
  // every budget arm silently measure the shipped C# value (adversarial-v42-p2
  // R1). A `=== 300` SENTINEL fixes that and breaks something else: it cannot
  // tell unpatched from patched-to-300, so once C#'s value differs the baseline
  // rung becomes unreachable (review-v45-p3 R5). A factor has neither problem.
  assert.match(
    PROFILE_SRC,
    /const CS_DATASHAPE_TOTAL_TOK = DATASHAPE_TOTAL_TOK \* CS_BUDGET_FACTOR;/,
    "C#'s budget must be a multiple of DATASHAPE_TOTAL_TOK so a patched arm wins AND every rung is expressible",
  );
  assert.ok(
    !/CS_DATASHAPE_TOTAL_TOK = DATASHAPE_TOTAL_TOK === /.test(PROFILE_SRC),
    "the sentinel form makes the baseline ladder rung unreachable; use the factor",
  );
});

test("only C# carries its own budget; the other four languages read the profile", () => {
  const langs = ["RUST_PREFILL_LANG", "GO_PREFILL_LANG", "TS_PREFILL_LANG", "PY_PREFILL_LANG"];
  for (const name of langs) {
    const start = SRC.indexOf(`const ${name}: PrefillLang = {`);
    if (start === -1) continue; // a language whose seam is named differently is not this test's business
    const body = SRC.slice(start, SRC.indexOf("\n};", start));
    assert.ok(
      !/dataShapeTotalTok/.test(body),
      `${name} declares its own data-shape budget; phase 3 moves C# ONLY (contract-phase3)`,
    );
  }
  const csStart = SRC.indexOf("const CS_PREFILL_LANG: PrefillLang = {");
  assert.notEqual(csStart, -1);
  const csBody = SRC.slice(csStart, SRC.indexOf("\n};", csStart));
  assert.match(csBody, /dataShapeTotalTok: CS_DATASHAPE_TOTAL_TOK/, "C# must carry its own budget");
});

test("under a FUTURE phase-4.1 factor, every ladder rung including the baseline is reachable", () => {
  // The failure this replaces (review-v45-p3 R5): with a `=== 300` sentinel and a
  // shipped C# value of 900, a rung asking for 300 patched the knob to 300, which
  // SATISFIED the guard, and C# ran at 900. The baseline rung - the one every
  // other rung is compared against - was the single value the ladder could not
  // express.
  //
  // Proven arithmetically on the shipped expression rather than by re-bundling:
  // the form is `knob * factor`, so the rung set is dense in the knob.
  const factorOf = (src) => Number(/const CS_BUDGET_FACTOR = (\d+(?:\.\d+)?);/.exec(src)[1]);
  assert.equal(factorOf(PROFILE_SRC), 1, "shipped factor");

  // Simulate phase 4.1 choosing 3x, then ask for each rung through the ONE knob
  // the rig can patch.
  const csBudget = (knob, factor) => knob * factor;
  assert.equal(csBudget(300, 3), 900, "the 900 rung");
  assert.equal(csBudget(100, 3), 300, "the 300 BASELINE rung, unreachable under the sentinel");
  assert.equal(csBudget(200, 3), 600, "an intermediate rung");
  // And the shipped factor keeps the knob's own meaning intact for C#.
  assert.equal(csBudget(300, 1), 300);
  assert.equal(csBudget(900, 1), 900);
});

test("the budget-exhausted channel line keeps its exact text", () => {
  // v45's arm analysis and the closing qwen-vs-sonnet report both PARSE this
  // line to count truncation. Rewording it silently zeroes a reported number.
  assert.match(SRC, /pre-fill budget exhausted; \\`\$\{name\}\\` block dropped/);
});
