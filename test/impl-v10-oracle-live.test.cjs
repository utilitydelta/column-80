// Implementer's LIVE falsification for the two triaged CsOracle fixes
// (session-v10 phase 2, adversarial-review do-list). Real `dotnet` spawns,
// end to end through runOracleCheck. Reaches what the unit round-trips cannot:
//
//   Fix 1 (multi-TFM coverage): a REAL <TargetFrameworks>net8.0;net10.0</> build
//   whose OUTER msbuild evaluation returns an empty Compile set. The unpinned
//   probe (the bug) reads every file not-covered and the check never runs; the
//   TFM-pinned probe reads the real per-TFM Compile set, so an included broken
//   file surfaces its diagnostics and a <Compile Remove> file stays dark.
//
//   Fix 2 (NETSDK1004 evidence): a REAL unrestored build writes NETSDK1004 to
//   STDOUT with an empty stderr (verified this session). The orchestrator's
//   stdout evidence fallback + describeCheckFailure surface the actionable
//   "restore first" reason through envReason, not the generic crash line.
//
// Requires dotnet on PATH (10.0.110 + 8.0.129 this session). The multi-TFM
// project is a package-less classlib (restores offline from the SDK); the
// unrestored project carries a PackageReference and is deliberately NOT
// restored. Skip with SKIP_LIVE=1. Everything is built in temp dirs and torn
// down; nothing in the repo is touched. NEVER auto-restores (offline invariant).
//
// Run: node --test --test-concurrency=1 test/impl-v10-oracle-live.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { spawnSync } = require("child_process");
const { bundleCore } = require("./.blind-util.cjs");

const SKIP = process.env.SKIP_LIVE === "1" ? "SKIP_LIVE=1" : false;
const LIVE_TIMEOUT = 120_000;

const { mod, cleanup } = bundleCore(
  "impl-v10-oracle-live",
  `export { CsOracle, oracleFor, runOracleCheck } from "../src/core/compilerOracle";\n`,
);
test.after(() => cleanup());
const { oracleFor, runOracleCheck } = mod;

const DOTNET_ENV = { ...process.env, DOTNET_CLI_TELEMETRY_OPTOUT: "1", DOTNET_NOLOGO: "1" };
const scratch = [];
test.after(() => { for (const d of scratch) fs.rmSync(d, { recursive: true, force: true }); });
const mkTmp = (tag) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), `impl-v10-${tag}-`));
  scratch.push(d);
  return d;
};

// A broken file: CS1061 (member does not exist). ImplicitUsings disabled so the
// only diagnostic is the intended one.
const BROKEN_CS = `namespace Demo
{
    public class Thing
    {
        public void Go()
        {
            string s = "hello";
            var x = s.NoSuchMember();
        }
    }
}
`;

// ---------------------------------------------------------------------------
// Fix 1: multi-TFM coverage end to end.
// ---------------------------------------------------------------------------

const MULTI_TFM_CSPROJ = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Library</OutputType>
    <TargetFrameworks>net8.0;net10.0</TargetFrameworks>
    <ImplicitUsings>disable</ImplicitUsings>
    <EnableNETAnalyzers>false</EnableNETAnalyzers>
  </PropertyGroup>
  <ItemGroup>
    <Compile Remove="Excluded.cs" />
  </ItemGroup>
</Project>
`;

test(
  "live Fix 1: a REAL multi-TFM (net8.0;net10.0) project reads an included broken file as COVERED end to end; a <Compile Remove> file stays dark [surface: multi-TFM outer-eval empty -> pin the inner TFM]",
  { skip: SKIP, timeout: LIVE_TIMEOUT },
  async () => {
    const dir = mkTmp("mtfm");
    fs.writeFileSync(path.join(dir, "Multi.csproj"), MULTI_TFM_CSPROJ);
    const included = path.join(dir, "Included.cs");
    const excluded = path.join(dir, "Excluded.cs");
    fs.writeFileSync(included, BROKEN_CS);
    fs.writeFileSync(excluded, BROKEN_CS);
    const r = spawnSync("dotnet", ["restore", path.join(dir, "Multi.csproj")], { cwd: dir, env: DOTNET_ENV, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`restore failed: ${(r.stderr || r.stdout || "").slice(0, 400)}`);

    const oracle = oracleFor("csharp");

    // The included file: the TFM-pinned probe lists it, so coverage passes and
    // the check runs. Unpinned (the bug), the outer eval's empty Compile set
    // would read it not-covered and runOracleCheck would resolve undefined.
    const incLines = [];
    const inc = await runOracleCheck(oracle, included, { log: (l) => incLines.push(l) });
    assert.ok(inc, `multi-TFM coverage passed and the check ran (undefined here would be the false-dark bug); logs: ${JSON.stringify(incLines)}`);
    assert.strictEqual(inc.success, false, "the broken build fails");
    assert.ok(inc.diagnostics.some((d) => d.code === "CS1061"), `CS1061 surfaced from the multi-TFM build; got ${JSON.stringify(inc.diagnostics.map((d) => d.code))}`);

    // The excluded file: the pinned probe's Compile set omits it, so the
    // unearned green is refused (the probe still DISCRIMINATES on multi-TFM).
    const exLines = [];
    const ex = await runOracleCheck(oracle, excluded, { log: (l) => exLines.push(l) });
    assert.strictEqual(ex, undefined, "the <Compile Remove> file is not an input -> dark, even on multi-TFM");
    assert.ok(exLines.some((l) => l.includes("is not an input of")), `the honest-dark skip fired; got ${JSON.stringify(exLines)}`);
  },
);

// ---------------------------------------------------------------------------
// Fix 2: NETSDK1004 -> "restore first" reason end to end.
// ---------------------------------------------------------------------------

const UNRESTORED_CSPROJ = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Library</OutputType>
    <TargetFramework>net8.0</TargetFramework>
    <ImplicitUsings>disable</ImplicitUsings>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Newtonsoft.Json" Version="13.0.3" />
  </ItemGroup>
</Project>
`;

test(
  "live Fix 2: a REAL unrestored build surfaces a 'restore first' envReason (NETSDK1004 lives on STDOUT) - never the generic crash line, never an auto-restore [surface: orchestrator stdout evidence fallback + describeCheckFailure]",
  { skip: SKIP, timeout: LIVE_TIMEOUT },
  async () => {
    const dir = mkTmp("unrestored");
    fs.writeFileSync(path.join(dir, "Unr.csproj"), UNRESTORED_CSPROJ);
    const src = path.join(dir, "A.cs");
    fs.writeFileSync(src, "namespace Demo { public class A { } }\n");
    // Deliberately NOT restored: --no-restore then fails NETSDK1004.

    const oracle = oracleFor("csharp");
    const reasons = [];
    const lines = [];
    const result = await runOracleCheck(oracle, src, { envReason: (r) => reasons.push(r), log: (l) => lines.push(l) });

    assert.ok(result, "the check ran (the offline probe answered without restoring)");
    assert.strictEqual(result.success, false, "the unrestored build fails");
    assert.deepStrictEqual(result.diagnostics, [], "NETSDK1004 is an MSBuild error, absent from the SARIF -> no diagnostics");
    assert.strictEqual(reasons.length, 1, `one env reason surfaced; got ${JSON.stringify(reasons)}`);
    assert.ok(/restore/i.test(reasons[0]), `the reason names the fix (restore), got ${JSON.stringify(reasons[0])}`);
    assert.ok(!/crashed/i.test(reasons[0]), "the actionable restore-first line, not the dead generic crash line");

    // Offline invariant: no restore ever happened (no assets file materialized).
    assert.strictEqual(fs.existsSync(path.join(dir, "obj", "project.assets.json")), false, "the oracle never auto-restored (offline invariant)");
  },
);
