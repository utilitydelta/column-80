// IMPLEMENTER tests - session-v46 phase 0b: the budget-profile derivation seam
// (src/core/budgetProfile.ts). The blind oracle (blind-v46-budgetprofile)
// pins the contract's observables and names one property it cannot reach from
// the API: "moving surfaceBudgetTok for a cell moves the deriveds with it".
// That property is proven here the way the rig moves the number for real - by
// patching `var DATASHAPE_TOTAL_TOK` in the bundle - along with the drift
// guards the module's own comments promise (the provider literal, the
// transport defaults the config layer re-serves).
//
// Run: SKIP_LIVE=1 node --test test/impl-v46-p0b-budgetprofile.test.cjs

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const esbuild = require("esbuild");

const ENTRY = path.join(__dirname, ".v46p0b.entry.ts");
const OUT = path.join(__dirname, ".v46p0b.bundle.cjs");
const OUT_KNOB = path.join(__dirname, ".v46p0b.knob900.bundle.cjs");
const OUT_CS = path.join(__dirname, ".v46p0b.cs900.bundle.cjs");
fs.writeFileSync(
  ENTRY,
  `export * from "../src/core/budgetProfile";
export { CLAUDE_CODE, DEFAULT_TIMEOUT_MS } from "../src/core/claudeCodeInstruct";
export { CLOUD_PROVIDERS, OPENAI_COMPATIBLE } from "../src/core/cloudInstruct";
export { DEFAULT_FNGEN_CONFIG } from "../src/core/config";
export { MEMBER_CAP } from "../src/core/extraction";
`,
);
esbuild.buildSync({ entryPoints: [ENTRY], bundle: true, outfile: OUT, format: "cjs", platform: "node" });
const src = fs.readFileSync(OUT, "utf8");
// The rig's exact substitutions (lib-core's loadPrefillBudget shape).
fs.writeFileSync(OUT_KNOB, src.replace(/var DATASHAPE_TOTAL_TOK = \d+;/, "var DATASHAPE_TOTAL_TOK = 900;"));
fs.writeFileSync(OUT_CS, src.replace(/var CS_DATASHAPE_TOTAL_TOK = [^;\n]+;/, "var CS_DATASHAPE_TOTAL_TOK = 900;"));
const M = require(OUT);
const KNOB = require(OUT_KNOB);
const CS = require(OUT_CS);
test.after(() => [ENTRY, OUT, OUT_KNOB, OUT_CS].forEach((f) => fs.rmSync(f, { force: true })));

// RE-CUT by session-v48 phase 1 (docs/supersessions.md). `budgetProfileFor` takes
// a required context stop now. These rows are about the DERIVATION - move the
// aggregate, and memberCap / surfaceCap / refineTotalChars / walkTokMax move with
// it - so they ask for the `shipped` stop, the pre-dial point whose budget IS the
// module constant the rig patches. Every number below is unchanged.
const IDENTITY_STOP = "shipped";

test("moving the base budget moves every derived with it, for every class and language", () => {
  for (const cls of ["fim-small", "local-mid", "frontier"]) {
    for (const lang of ["rust", "typescript", "csharp", "python", "go"]) {
      const p = KNOB.budgetProfileFor(cls, lang, IDENTITY_STOP);
      assert.equal(p.surfaceBudgetTok, 900, `${cls}/${lang} budget`);
      assert.equal(p.memberCap, 72, `${cls}/${lang} memberCap follows (24 per 300)`);
      assert.equal(p.surfaceCap, 12, `${cls}/${lang} surfaceCap follows (4 per 300)`);
      assert.equal(p.refineTotalChars, 7200, `${cls}/${lang} refineTotalChars follows (8 chars per token)`);
      assert.equal(p.walkTokMax, 600, `${cls}/${lang} walkTokMax follows (two thirds)`);
    }
  }
});

test("moving C#'s own budget moves C#'s deriveds and nobody else's", () => {
  const cs = CS.budgetProfileFor("local-mid", "csharp", IDENTITY_STOP);
  assert.equal(cs.surfaceBudgetTok, 900);
  assert.equal(cs.memberCap, 72, "C#'s deriveds follow C#'s budget");
  const rust = CS.budgetProfileFor("local-mid", "rust", IDENTITY_STOP);
  assert.equal(rust.surfaceBudgetTok, 300, "the other languages stay at the base");
  assert.equal(rust.memberCap, 24);
});

test("the 'claude-code' literal tracks claudeCodeInstruct's CLAUDE_CODE (the cycle-avoidance mirror)", () => {
  assert.equal(M.modelClassFor(M.CLAUDE_CODE, "any-tag"), "frontier");
  assert.ok(M.providerKnown(M.CLAUDE_CODE));
});

test("every provider the product ships a preset for is a known frontier provider", () => {
  for (const provider of [...Object.keys(M.CLOUD_PROVIDERS), M.OPENAI_COMPATIBLE]) {
    assert.equal(M.modelClassFor(provider, "some-model"), "frontier", provider);
    assert.ok(M.providerKnown(provider), provider);
  }
});

test("the shipped FIM default tag resolves to fim-small; the fn-gen defaults to local-mid", () => {
  assert.equal(M.modelClassFor("ollama", "qwen2.5-coder:1.5b-base"), "fim-small");
  assert.equal(M.modelClassFor("ollama", M.DEFAULT_FNGEN_CONFIG.model), "local-mid");
  assert.equal(M.modelClassFor("ollama", M.DEFAULT_FNGEN_CONFIG.fallbackModel), "local-mid");
});

test("the defaults the rest of the tree serves are the profile's own values", () => {
  const p = M.budgetProfileFor("local-mid", "rust", IDENTITY_STOP);
  assert.equal(M.DEFAULT_TIMEOUT_MS, p.timeoutMs, "claudeCodeInstruct's default timeout");
  assert.equal(M.DEFAULT_FNGEN_CONFIG.maxTokens, p.maxTokens, "config's default num_predict");
  assert.equal(M.DEFAULT_FNGEN_CONFIG.numCtx, p.numCtx, "config's default context window");
  assert.equal(M.MEMBER_CAP, p.memberCap, "extraction's shared member cap");
});
