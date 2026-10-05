// Adversarial review of session-v77 phase 1: the C# placement refusal that now
// names the SDK. `missingProjectDetail` asks `sdkFloorBlocked` BEFORE asking
// whether any .csproj exists, so a repo with an old global.json and no project
// file is told to raise its SDK. The pre-v77 text said "no .csproj above X",
// which was the true cause.
//
// Run: SKIP_LIVE=1 node --test test/review-v77-p1-cs-sdk-floor.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "review-v77-p1-cs-sdk-floor",
  `export { tddLangFor, REAL_TDD_DEPS } from "../src/core/tddLang";\n`,
);
test.after(() => cleanup());

function tree(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "v77-cs-floor-"));
  for (const [rel, text] of Object.entries(files)) {
    const p = path.join(root, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, text);
  }
  return root;
}

const OLD_SDK = JSON.stringify({ sdk: { version: "6.0.100" } });
const SRC = "namespace A; public static class Calc { public static int Widen(int n) => n; }\n";

test("no .csproj anywhere + old global.json: the refusal names the missing project, not the SDK", () => {
  const root = tree({ "global.json": OLD_SDK, "src/Calc.cs": SRC });
  try {
    const lang = mod.tddLangFor("csharp");
    const placed = lang.placementFor(path.join(root, "src/Calc.cs"), "Widen", { log: () => {} });
    assert.strictEqual(placed.ok, false, "precondition: no project, so placement refuses");
    assert.match(
      placed.refusal.detail,
      /\.csproj/,
      `the cause is a missing .csproj; telling the user to raise the SDK cannot fix it. Got ${JSON.stringify(placed.refusal.detail)}`,
    );
    assert.doesNotMatch(placed.refusal.detail, /Raise the SDK/, `Got ${JSON.stringify(placed.refusal.detail)}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("no .csproj + old global.json, test-file side (Run TDD Tests / Run Covering Tests)", () => {
  const root = tree({ "global.json": OLD_SDK, "tests/CalcTests.cs": SRC });
  try {
    const lang = mod.tddLangFor("csharp");
    const placed = lang.runTargetForTestFile(path.join(root, "tests/CalcTests.cs"), { log: () => {} });
    assert.strictEqual(placed.ok, false);
    assert.match(placed.refusal.detail, /\.csproj/, `Got ${JSON.stringify(placed.refusal.detail)}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("control: a .csproj under an old global.json still names the SDK", () => {
  const root = tree({
    "global.json": OLD_SDK,
    "src/A.csproj": '<Project Sdk="Microsoft.NET.Sdk"></Project>\n',
    "src/Calc.cs": SRC,
  });
  try {
    const lang = mod.tddLangFor("csharp");
    const placed = lang.placementFor(path.join(root, "src/Calc.cs"), "Widen", { log: () => {} });
    assert.strictEqual(placed.ok, false);
    assert.match(placed.refusal.detail, /SDK/, `Got ${JSON.stringify(placed.refusal.detail)}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
