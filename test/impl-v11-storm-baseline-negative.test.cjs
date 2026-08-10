// IMPL ORACLE — v11 phase 4 / P2-1: the TYPE-LEVEL refusal of the storm
// classifier. blind-v11-storm-baseline can prove the RUNTIME brand refuses a raw
// object, but it explicitly CANNOT prove the compile-time refusal (a phantom-ish
// newtype is erased). This drives a separate `tsc --noEmit` over a fixture that
// passes a raw OracleCheckResult to isMissingImportsStorm and asserts tsc REJECTS
// it — the real baseline-only enforcement proof.
//
// Run: SKIP_LIVE=1 node --test test/impl-v11-storm-baseline-negative.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const { spawnSync } = require("child_process");

const FIXTURE = path.join(__dirname, ".impl-v11-storm-baseline-negative.fixture.ts");

function tscOn(file) {
  return spawnSync(
    "npx",
    [
      "tsc", "--noEmit", "--strict",
      "--module", "Node16", "--moduleResolution", "Node16",
      "--target", "ES2022", "--lib", "ES2022",
      "--esModuleInterop", "--skipLibCheck",
      file,
    ],
    { cwd: path.join(__dirname, ".."), encoding: "utf8" },
  );
}

test("P2-1 type refusal: passing a raw OracleCheckResult to isMissingImportsStorm is a COMPILE error", () => {
  const res = tscOn(FIXTURE);
  const out = `${res.stdout || ""}${res.stderr || ""}`;
  assert.notStrictEqual(res.status, 0, `tsc must REJECT the raw call; got exit 0.\n${out}`);
  assert.match(
    out,
    /is not assignable to parameter of type 'BaselineCheck'/,
    `the rejection must be the BaselineCheck refusal (not some unrelated error).\n${out}`,
  );
  // Exactly ONE error: the raw call. The positive control (baselineCheck(raw))
  // must NOT error — proving the newtype accepts a minted baseline.
  const errorLines = out.split("\n").filter((l) => /error TS\d+/.test(l));
  assert.strictEqual(
    errorLines.length,
    1,
    `exactly one type error (the raw call); the minted-baseline control must compile clean.\n${out}`,
  );
});
