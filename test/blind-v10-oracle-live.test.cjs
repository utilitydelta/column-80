// Blind oracle: the C# oracle's LIVE falsification rung (session-v10 phase 2).
// A REAL `dotnet build` against a broken fixture project, driven end to end
// through runOracleCheck. This reaches what the unit round-trip cannot: the
// %2c escaping actually yielding SARIF v2.1.0 (a raw comma silently yields v1
// and this test would find zero diagnostics), the real ErrorLog file written
// by dotnet and read back, the file:// URI round-trip, and the real coverage
// probe (`dotnet msbuild -getItem:Compile`) gating the check.
//
// Requires dotnet on PATH (10.0.110 + 8.0.129 seen this session) and a one-time
// `dotnet restore` of the scratch project (a package-less net8.0 classlib
// restores offline from the SDK). Skip with SKIP_LIVE=1. The scratch project is
// built in a temp dir and torn down; nothing in the repo is touched.
//
// Expected RED until src/core/csOracle.ts lands: the bundle exports no CsOracle.
//
// Run: node --test --test-concurrency=1 test/blind-v10-oracle-live.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { spawnSync } = require("child_process");
const { bundleCore } = require("./.blind-util.cjs");

const SKIP = process.env.SKIP_LIVE === "1" ? "SKIP_LIVE=1" : false;
const LIVE_TIMEOUT = 120_000;

let mod = {};
let cleanupBundle = () => {};
let bundleError;
try {
  ({ mod, cleanup: cleanupBundle } = bundleCore(
    "blind-v10-oracle-live",
    `export { CsOracle, oracleFor, runOracleCheck } from "../src/core/compilerOracle";\n`
  ));
} catch (e) {
  bundleError = e;
}
if (!bundleError && typeof mod.CsOracle !== "function") {
  bundleError = new Error("the bundle built but exports no CsOracle class");
}
test.after(() => cleanupBundle());

const { CsOracle, oracleFor, runOracleCheck } = mod;

// One broken project, the three hallucination classes in one build. Restored
// once (offline for a package-less classlib), reused by the live cases.
const CSPROJ = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Library</OutputType>
    <TargetFramework>net8.0</TargetFramework>
    <ImplicitUsings>disable</ImplicitUsings>
    <EnableNETAnalyzers>false</EnableNETAnalyzers>
  </PropertyGroup>
</Project>
`;
const BROKEN_CS = `using System;

namespace Demo
{
    public class Thing
    {
        public void Go()
        {
            string s = "hello";
            var x = s.NoSuchMember();
            Widget w = new Widget();
        }
    }
}
`;

const scratch = [];
test.after(() => { for (const d of scratch) fs.rmSync(d, { recursive: true, force: true }); });

const buildFixtureProject = () => {
  // realpath the temp dir: on macOS /tmp and /var are symlinks to /private/*,
  // and `dotnet build`'s SARIF output canonicalizes to the /private/... form,
  // so the fixture path must match it or the file:// URI round-trip compares
  // two spellings of the same file.
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "blind-v10-live-")));
  scratch.push(dir);
  fs.writeFileSync(path.join(dir, "Broken.csproj"), CSPROJ);
  const src = path.join(dir, "Broken.cs");
  fs.writeFileSync(src, BROKEN_CS);
  const env = { ...process.env, DOTNET_CLI_TELEMETRY_OPTOUT: "1", DOTNET_NOLOGO: "1" };
  const r = spawnSync("dotnet", ["restore", path.join(dir, "Broken.csproj")], { cwd: dir, env, encoding: "utf8" });
  if (r.status !== 0) {
    throw new Error(`dotnet restore failed (status ${r.status}): ${(r.stderr || r.stdout || "").slice(0, 400)}`);
  }
  return { dir, src };
};

test(
  "live: a real dotnet build surfaces CS1061 + CS0246 through runOracleCheck, with absolute paths and real byte offsets [surface: phase2-brief end-to-end falsification]",
  { skip: SKIP, timeout: LIVE_TIMEOUT },
  async () => {
    if (bundleError) assert.fail(`the surface is not implemented yet: ${bundleError.message}`);

    const { dir, src } = buildFixtureProject();
    const oracle = oracleFor("csharp");
    assert.ok(oracle instanceof CsOracle, "oracleFor('csharp') gives a CsOracle");
    assert.strictEqual(oracle.detectCrateRoot(src), dir, "the broken file resolves to its csproj dir");

    const lines = [];
    const result = await runOracleCheck(oracle, src, { log: (l) => lines.push(l) });
    assert.ok(result, `a real result resolves (logs: ${JSON.stringify(lines)})`);
    assert.strictEqual(result.success, false, "the broken build fails");
    assert.strictEqual(result.crateRoot, dir);

    const codes = new Set(result.diagnostics.map((d) => d.code));
    assert.ok(codes.has("CS1061"), `CS1061 surfaced (proves SARIF v2.1.0 - a raw comma would have yielded v1 and no results); got ${JSON.stringify([...codes])}`);
    assert.ok(codes.has("CS0246"), `CS0246 surfaced; got ${JSON.stringify([...codes])}`);

    const cs1061 = result.diagnostics.find((d) => d.code === "CS1061");
    assert.strictEqual(cs1061.level, "error");
    assert.strictEqual(cs1061.kind, "compile-error");
    assert.ok(cs1061.message.includes("NoSuchMember"), `the real message rode through: ${JSON.stringify(cs1061.message)}`);
    const s = cs1061.spans[0];
    assert.strictEqual(s.fileName, src, "the file:// URI URL-decoded to the real absolute path");
    assert.strictEqual(s.lineStart, 10, "CS1061 is on the s.NoSuchMember() line");

    // Real byte offset from the real source: line 10, col of 'NoSuchMember'.
    const srcText = fs.readFileSync(src, "utf8");
    const linesArr = srcText.split("\n");
    const before = linesArr.slice(0, s.lineStart - 1).reduce((n, l) => n + Buffer.byteLength(l, "utf8") + 1, 0);
    const col = Buffer.byteLength(linesArr[s.lineStart - 1].slice(0, s.columnStart - 1), "utf8");
    assert.strictEqual(s.byteStart, before + col, "the byte offset matches a UTF-8 recomputation from the real source");
    assert.ok(s.byteStart > 0, "a real, positive byte offset (not the -1 sentinel)");
  }
);
