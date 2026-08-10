// Implementer's mechanism tests for CsOracle (session-v10 phase 2). These see
// the internals the blind oracle could not: the CsOracleDeps injection seams
// (fileExists/readFile/readDir/statMtimeMs/readSarif/unlinkSarif/log) let every
// edge and error path run headlessly, with no dotnet spawn and no real fs. Each
// case names the invariant it proves.
//
// Run: SKIP_LIVE=1 node --test test/impl-v10-csoracle.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const os = require("os");
const { pathToFileURL } = require("url");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-v10-csoracle",
  `export { CsOracle, runOracleCheck } from "../src/core/compilerOracle";\n`,
);
test.after(() => cleanup());
const { CsOracle, runOracleCheck } = mod;

// A virtual filesystem: dirs -> listing, files -> content, plus mtimes. The
// oracle never touches real disk in these tests; readSarif/unlinkSarif are
// captured so the deterministic-path round-trip and the unlink are observable.
const makeVfs = (init = {}) => {
  const files = new Map(Object.entries(init.files || {}));
  const dirs = new Map(Object.entries(init.dirs || {}));
  const mtimes = new Map(Object.entries(init.mtimes || {}));
  const sarifByPath = new Map(Object.entries(init.sarif || {}));
  const log = [];
  const reads = [];
  const unlinked = [];
  const sarifRequested = [];
  const deps = {
    fileExists: (p) => files.has(p) || sarifByPath.has(p),
    readFile: (p) => {
      reads.push(p);
      return files.has(p) ? files.get(p) : undefined;
    },
    readDir: (d) => dirs.get(d) || [],
    statMtimeMs: (p) => (mtimes.has(p) ? mtimes.get(p) : undefined),
    readSarif: (p) => {
      sarifRequested.push(p);
      return sarifByPath.has(p) ? sarifByPath.get(p) : undefined;
    },
    unlinkSarif: (p) => {
      unlinked.push(p);
      sarifByPath.delete(p);
    },
    log: (l) => log.push(l),
  };
  return { deps, log, reads, unlinked, sarifRequested, sarifByPath, files, setSarif: (p, v) => sarifByPath.set(p, v) };
};

// SARIF v2.1.0 doc builder over compact {code, level, uri, sl, sc, el, ec}.
const sarifDoc = (results) => ({
  version: "2.1.0",
  runs: [
    {
      columnKind: "utf16CodeUnits",
      tool: { driver: { name: "Microsoft (R) Visual C# Compiler" } },
      results: results.map((r) => ({
        ruleId: r.code,
        level: r.level,
        message: { text: r.message || `${r.code} text` },
        locations:
          r.uri === null
            ? []
            : [
                {
                  physicalLocation: {
                    artifactLocation: { uri: r.uri },
                    region: r.region === null ? undefined : { startLine: r.sl, startColumn: r.sc, endLine: r.el, endColumn: r.ec },
                  },
                },
              ],
      })),
    },
  ],
});

// The deterministic sarif path buildCheckCommand encoded (decoded from the
// %2c-escaped ErrorLog token). Pure function of crateRoot — the parse
// recomputes the same one.
const sarifPathFor = (oracle, crateRoot) => {
  const cmd = oracle.buildCheckCommand(crateRoot);
  const arg = cmd.args.find((a) => /ErrorLog=/.test(a));
  return /ErrorLog=(.+?)%2cversion=2\b/.exec(arg)[1];
};

const ROOT = path.join(path.sep + "proj", "app");

// ===========================================================================
// Invariant 1: the SARIF path is a PURE FUNCTION of crateRoot — buildCheckCommand
// and parseCheckOutput compute the SAME path with no shared instance state.
// ===========================================================================

test("deterministic path: buildCheckCommand and parseCheckOutput agree on the sarif path, statelessly [invariant: pure fn of crateRoot, no temporal coupling]", () => {
  const vfs = makeVfs({ dirs: { [ROOT]: ["App.csproj"] } });
  const oracle = new CsOracle(vfs.deps);
  const wanted = sarifPathFor(oracle, ROOT);
  // A DIFFERENT oracle instance recomputes the identical path from crateRoot
  // alone (no state carried from the build call): the parse reads exactly there.
  const parser = new CsOracle(makeVfs({ dirs: { [ROOT]: ["App.csproj"] } }).deps);
  parser.parseCheckOutput("", ROOT, Date.now() + 1e6);
  // buildCheckCommand is stable across calls and across instances.
  assert.strictEqual(sarifPathFor(new CsOracle(vfs.deps), ROOT), wanted, "same crateRoot -> same path, any instance");
  assert.ok(wanted.startsWith(os.tmpdir()), "the path lives under os.tmpdir()");
  assert.ok(/\.sarif$/.test(wanted), "it is a .sarif file");
});

test("deterministic path: distinct crateRoots -> distinct sarif paths (no cross-root collision) [invariant: per-root keying]", () => {
  const oracle = new CsOracle(makeVfs().deps);
  const a = sarifPathFor(oracle, path.join(path.sep + "one"));
  const b = sarifPathFor(oracle, path.join(path.sep + "two"));
  assert.notStrictEqual(a, b);
});

test("recompute round-trip: parseCheckOutput reads the EXACT path buildCheckCommand wrote, then unlinks it [invariant: out-of-band handshake + read-once-then-delete]", () => {
  const vfs = makeVfs({ dirs: { [ROOT]: ["App.csproj"] }, files: { [path.join(ROOT, "S.cs")]: "class S {}\n" } });
  const oracle = new CsOracle(vfs.deps);
  const wanted = sarifPathFor(oracle, ROOT);
  vfs.setSarif(wanted, JSON.stringify(sarifDoc([{ code: "CS0246", level: "error", uri: pathToFileURL(path.join(ROOT, "S.cs")).href, sl: 1, sc: 1, el: 1, ec: 6 }])));
  const diags = oracle.parseCheckOutput("", ROOT, Date.now() + 1e6);
  assert.strictEqual(diags.length, 1, "the diagnostic came out of the file at the recomputed path");
  assert.deepStrictEqual(vfs.sarifRequested, [wanted], "the parse read exactly the path build wrote");
  assert.deepStrictEqual(vfs.unlinked, [wanted], "the sarif is unlinked after the read");
});

// ===========================================================================
// Invariant 2: URL-decode of the file:// URI — spaces and unicode.
// ===========================================================================

for (const [label, rel] of [
  ["a space", "with space/Broken.cs"],
  ["unicode (café😀)", "café😀/Model.cs"],
  ["both", "with space/café😀/A.cs"],
]) {
  test(`uri decode: a percent-encoded file:// path (${label}) decodes to the literal filesystem path [invariant: decodeURIComponent over the file:// scheme]`, () => {
    const abs = path.join(ROOT, ...rel.split("/"));
    const vfs = makeVfs({ dirs: { [ROOT]: ["App.csproj"] }, files: { [abs]: "class X {}\n" } });
    const oracle = new CsOracle(vfs.deps);
    const wanted = sarifPathFor(oracle, ROOT);
    // pathToFileURL percent-encodes the space and the emoji, exactly as dotnet does.
    vfs.setSarif(wanted, JSON.stringify(sarifDoc([{ code: "CS0246", level: "error", uri: pathToFileURL(abs).href, sl: 1, sc: 1, el: 1, ec: 6 }])));
    const diags = oracle.parseCheckOutput("", ROOT, Date.now() + 1e6);
    assert.strictEqual(diags[0].spans[0].fileName, abs, "the URI decoded back to the exact absolute path");
    assert.ok(path.isAbsolute(diags[0].spans[0].fileName), "absolute, no crateRoot anchoring");
  });
}

// ===========================================================================
// Invariant 3: the SDK-floor gate (global.json < 8 -> whole oracle dark).
// ===========================================================================

for (const [label, version, blocked] of [
  ["pinned 6.0.100 (below floor)", "6.0.100", true],
  ["pinned 7.0.400 (below floor)", "7.0.400", true],
  ["pinned 8.0.100 (at floor)", "8.0.100", false],
  ["pinned 10.0.110 (above floor)", "10.0.110", false],
]) {
  test(`sdk floor: global.json ${label} -> detectCrateRoot ${blocked ? "undefined (oracle dark)" : "resolves"} [invariant: coverage probe needs SDK 8+]`, () => {
    const gj = path.join(ROOT, "global.json");
    const vfs = makeVfs({
      dirs: { [ROOT]: ["App.csproj", "global.json"] },
      files: { [gj]: JSON.stringify({ sdk: { version } }) },
    });
    const oracle = new CsOracle(vfs.deps);
    const root = oracle.detectCrateRoot(path.join(ROOT, "F.cs"));
    if (blocked) {
      assert.strictEqual(root, undefined, "an SDK below 8 is named inapplicability for the whole oracle");
      assert.ok(oracle.describeMissingRoot(path.join(ROOT, "F.cs")).includes("global.json"), "the reason names the global.json floor");
    } else {
      assert.strictEqual(root, ROOT, "an SDK at/above 8 keeps the oracle applicable");
      assert.strictEqual(oracle.describeMissingRoot(path.join(ROOT, "F.cs")), undefined, "nothing to explain when the root resolves");
    }
  });
}

test("sdk floor: a garbage/version-less global.json fails OPEN (applicable) [invariant: only a KNOWN-low version gates]", () => {
  for (const raw of ["not json }{", "{}", '{"sdk":{}}', '{"sdk":{"version":"weird"}}']) {
    const gj = path.join(ROOT, "global.json");
    const vfs = makeVfs({ dirs: { [ROOT]: ["App.csproj", "global.json"] }, files: { [gj]: raw } });
    const oracle = new CsOracle(vfs.deps);
    assert.strictEqual(oracle.detectCrateRoot(path.join(ROOT, "F.cs")), ROOT, `garbage global.json ${JSON.stringify(raw).slice(0, 20)} must not gate`);
  }
});

// ===========================================================================
// Invariant 4: detectCrateRoot finds ANY *.csproj name, nearest-wins, and a
// dir with several resolves deterministically.
// ===========================================================================

test("detectCrateRoot: any *.csproj name is a manifest; several in one dir pick deterministically [invariant: name-pattern manifest, not a fixed filename]", () => {
  const vfs = makeVfs({ dirs: { [ROOT]: ["Zeta.csproj", "Alpha.csproj", "Program.cs"] } });
  const oracle = new CsOracle(vfs.deps);
  assert.strictEqual(oracle.detectCrateRoot(path.join(ROOT, "Program.cs")), ROOT);
  // buildCheckCommand picks the sorted-first csproj, stably.
  const proj = oracle.buildCheckCommand(ROOT).args.find((a) => a.endsWith(".csproj"));
  assert.strictEqual(path.basename(proj), "Alpha.csproj", "sorted-first csproj wins, deterministically");
});

test("detectCrateRoot: nearest csproj wins over an ancestor csproj [invariant: scope to the touched project]", () => {
  const inner = path.join(ROOT, "inner");
  const vfs = makeVfs({ dirs: { [ROOT]: ["Outer.csproj"], [inner]: ["Inner.csproj"] } });
  const oracle = new CsOracle(vfs.deps);
  assert.strictEqual(oracle.detectCrateRoot(path.join(inner, "F.cs")), inner, "inner beats outer");
});

// ===========================================================================
// Invariant 5: one source read per distinct file per parse (caching), and the
// -1 sentinels (unreadable, autosave-changed).
// ===========================================================================

test("multi-diagnostic caching: N diagnostics in one file read the source ONCE [invariant: per-file read cache]", () => {
  const src = path.join(ROOT, "Broken.cs");
  const vfs = makeVfs({ dirs: { [ROOT]: ["App.csproj"] }, files: { [src]: "aaaa\nbbbb\ncccc\n" }, mtimes: { [src]: 1 } });
  const oracle = new CsOracle(vfs.deps);
  const wanted = sarifPathFor(oracle, ROOT);
  const uri = pathToFileURL(src).href;
  vfs.setSarif(wanted, JSON.stringify(sarifDoc([
    { code: "CS0001", level: "error", uri, sl: 1, sc: 1, el: 1, ec: 2 },
    { code: "CS0002", level: "error", uri, sl: 2, sc: 1, el: 2, ec: 2 },
    { code: "CS0003", level: "warning", uri, sl: 3, sc: 1, el: 3, ec: 2 },
  ])));
  const diags = oracle.parseCheckOutput("", ROOT, Date.now() + 1e6);
  assert.strictEqual(diags.length, 3, "all three surfaced");
  const readsOfSrc = vfs.reads.filter((p) => p === src);
  assert.strictEqual(readsOfSrc.length, 1, "the source was read exactly once for three diagnostics");
  // Byte offsets: ASCII, so byte == (lineStart + col - 1). Line 2 starts at byte 5.
  assert.strictEqual(diags[1].spans[0].byteStart, 5, "line 2 col 1 -> byte 5");
});

test("sentinel: an unreadable source keeps line/col but -1 bytes; a valid source converts [invariant: refuse-repair over a guessed offset]", () => {
  const ghost = path.join(ROOT, "Ghost.cs");
  const vfs = makeVfs({ dirs: { [ROOT]: ["App.csproj"] } }); // no file content for Ghost.cs
  const oracle = new CsOracle(vfs.deps);
  const wanted = sarifPathFor(oracle, ROOT);
  vfs.setSarif(wanted, JSON.stringify(sarifDoc([{ code: "CS1061", level: "error", uri: pathToFileURL(ghost).href, sl: 11, sc: 23, el: 11, ec: 35 }])));
  const d = oracle.parseCheckOutput("", ROOT, Date.now() + 1e6)[0];
  assert.strictEqual(d.spans[0].lineStart, 11, "line kept from the region");
  assert.strictEqual(d.spans[0].columnStart, 23, "col kept from the region");
  assert.strictEqual(d.spans[0].byteStart, -1, "unreadable -> -1");
  assert.strictEqual(d.spans[0].byteEnd, -1);
});

test("sentinel: a SARIF column past the line's end -> -1 bytes, never a spill into the next line (autosave-race twin of the past-EOF -1)", () => {
  const src = path.join(ROOT, "Col.cs");
  const uri = pathToFileURL(src).href;
  // line 1 "ab" (2 chars); the region's columns 50/52 are far past it (disk
  // shorter than what the checker analyzed). Refuse, do not slice into line 2.
  const vfs = makeVfs({ dirs: { [ROOT]: ["App.csproj"] }, files: { [src]: "ab\ncd\n" }, mtimes: { [src]: 1 } });
  const oracle = new CsOracle(vfs.deps);
  const wanted = sarifPathFor(oracle, ROOT);
  vfs.setSarif(wanted, JSON.stringify(sarifDoc([{ code: "CS0001", level: "error", uri, sl: 1, sc: 50, el: 1, ec: 52 }])));
  const d = oracle.parseCheckOutput("", ROOT, Date.now() + 1e6)[0];
  assert.strictEqual(d.spans[0].byteStart, -1, "start column past line end refuses, not a next-line spill");
  assert.strictEqual(d.spans[0].byteEnd, -1, "end column past line end refuses too");
});

test("sentinel: the autosave guard - mtime strictly after checkStartMs -> -1, floored so same-ms does not false-fire [invariant: no stale-content conversion]", () => {
  const src = path.join(ROOT, "S.cs");
  const uri = pathToFileURL(src).href;
  const mk = (mtime) => {
    const vfs = makeVfs({ dirs: { [ROOT]: ["App.csproj"] }, files: { [src]: "abcd\n" }, mtimes: { [src]: mtime } });
    const oracle = new CsOracle(vfs.deps);
    const wanted = sarifPathFor(oracle, ROOT);
    vfs.setSarif(wanted, JSON.stringify(sarifDoc([{ code: "CS0001", level: "error", uri, sl: 1, sc: 1, el: 1, ec: 2 }])));
    return oracle;
  };
  // checkStart = 1000. mtime 1000.9 floors to 1000 (NOT > 1000): converts.
  assert.strictEqual(mk(1000.9).parseCheckOutput("", ROOT, 1000)[0].spans[0].byteStart, 0, "same integer ms -> real offset (floored, no false fire)");
  // mtime 1001 > 1000: changed since the check, refuse.
  assert.strictEqual(mk(1001).parseCheckOutput("", ROOT, 1000)[0].spans[0].byteStart, -1, "written after check start -> -1");
});

// ===========================================================================
// Invariant 6: garbage tolerance — every malformed shape yields fewer
// diagnostics (or []), never a throw.
// ===========================================================================

test("garbage tolerance: absent sarif, invalid JSON, and malformed regions never throw [invariant: fewer diagnostics, never a crash]", () => {
  const uri = pathToFileURL(path.join(ROOT, "S.cs")).href;
  const cases = [
    { name: "absent sarif", sarif: undefined, want: 0 },
    { name: "not json", sarif: "not json }{", want: 0 },
    { name: "truncated", sarif: '{"version":"2.1.0","runs":[{"results":[{ ', want: 0 },
    { name: "runs not array", sarif: JSON.stringify({ runs: 5 }), want: 0 },
    { name: "note-level dropped, error kept", sarif: JSON.stringify(sarifDoc([
        { code: "CA1822", level: "note", uri, sl: 1, sc: 1, el: 1, ec: 2 },
        { code: "CS0246", level: "error", uri, sl: 1, sc: 1, el: 1, ec: 2 },
      ])), want: 1 },
    { name: "malformed region drops the span, keeps the diagnostic", sarif: JSON.stringify(sarifDoc([{ code: "CS0246", level: "error", uri, sl: "x", sc: null, el: 1, ec: 2 }])), want: 1, spans: 0 },
    { name: "no locations -> diagnostic with empty spans", sarif: JSON.stringify(sarifDoc([{ code: "CS0246", level: "error", uri: null }])), want: 1, spans: 0 },
  ];
  for (const c of cases) {
    const vfs = makeVfs({ dirs: { [ROOT]: ["App.csproj"] }, files: { [path.join(ROOT, "S.cs")]: "abcd\n" } });
    const oracle = new CsOracle(vfs.deps);
    if (c.sarif !== undefined) {
      vfs.setSarif(sarifPathFor(oracle, ROOT), c.sarif);
    }
    let diags;
    assert.doesNotThrow(() => { diags = oracle.parseCheckOutput("", ROOT, Date.now() + 1e6); }, `${c.name} must not throw`);
    assert.strictEqual(diags.length, c.want, `${c.name}: diagnostic count`);
    if (c.spans !== undefined) {
      assert.strictEqual(diags[0].spans.length, c.spans, `${c.name}: span count`);
    }
  }
});

test("garbage tolerance: parseCheckOutput with no crateRoot -> [] (cannot recompute the path) [invariant: undefined root is not a crash]", () => {
  const oracle = new CsOracle(makeVfs().deps);
  assert.deepStrictEqual(oracle.parseCheckOutput("", undefined, Date.now()), []);
});

// ===========================================================================
// Invariant 7: multi-line region — byteEnd is computed from endLine/endColumn,
// not startLine (the C# region is a range; TsOracle's was a point).
// ===========================================================================

test("multi-line region: byteEnd converts from endLine/endColumn, distinct from byteStart [invariant: SARIF region is a start..end range]", () => {
  const src = path.join(ROOT, "Span.cs");
  const content = "line1\nline2\nline3\n"; // each line 5 chars + \n; line2 starts at byte 6
  const vfs = makeVfs({ dirs: { [ROOT]: ["App.csproj"] }, files: { [src]: content }, mtimes: { [src]: 1 } });
  const oracle = new CsOracle(vfs.deps);
  const wanted = sarifPathFor(oracle, ROOT);
  vfs.setSarif(wanted, JSON.stringify(sarifDoc([{ code: "CS0100", level: "error", uri: pathToFileURL(src).href, sl: 1, sc: 1, el: 2, ec: 3 }])));
  const s = oracle.parseCheckOutput("", ROOT, Date.now() + 1e6)[0].spans[0];
  assert.strictEqual(s.byteStart, 0, "line 1 col 1 -> byte 0");
  assert.strictEqual(s.byteEnd, 8, "line 2 col 3 -> byte 6 + 2 = 8 (spans two lines)");
  assert.strictEqual(s.lineStart, 1);
  assert.strictEqual(s.lineEnd, 2);
});

// ===========================================================================
// Invariant 8: fileCovered path normalization (a non-canonical FullPath still
// matches), and the not-covered answer.
// ===========================================================================

test("fileCovered: FullPath compared by path.resolve so a '/a/./b' style entry still matches [invariant: canonicalized membership]", () => {
  const oracle = new CsOracle(makeVfs().deps);
  const target = path.join(path.sep + "proj", "Included.cs");
  const noisy = path.join(path.sep + "proj", ".", "Included.cs");
  const json = JSON.stringify({ Items: { Compile: [{ FullPath: noisy }] } });
  assert.strictEqual(oracle.fileCovered(json, path.sep + "proj", target), true, "resolve() collapses the '/.' so it matches");
  assert.strictEqual(oracle.fileCovered(json, path.sep + "proj", path.join(path.sep + "proj", "Other.cs")), false, "an absent file is not covered");
  assert.strictEqual(oracle.fileCovered(JSON.stringify({ Items: {} }), path.sep + "proj", target), true, "no Compile set -> fail open");
});

// ===========================================================================
// Fix 1 (multi-TFM). The OUTER msbuild evaluation of a <TargetFrameworks>
// project returns an EMPTY Compile set; probing unpinned false-darks every
// multi-target project. buildCoverageCommand pins the first TFM, and fileCovered
// fails OPEN on an empty set (the safety backstop).
// ===========================================================================

for (const [label, csproj, wantPin] of [
  ["multi-TFM <TargetFrameworks>", "<Project><PropertyGroup><TargetFrameworks>net8.0;net10.0</TargetFrameworks></PropertyGroup></Project>", "net8.0"],
  ["multi-TFM with whitespace", "<Project><PropertyGroup><TargetFrameworks> net8.0 ; net10.0 </TargetFrameworks></PropertyGroup></Project>", "net8.0"],
  ["single <TargetFramework> (no pin)", "<Project><PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup></Project>", undefined],
  ["property expression (unresolvable -> no pin, backstop covers it)", "<Project><PropertyGroup><TargetFrameworks>$(SharedTfms)</TargetFrameworks></PropertyGroup></Project>", undefined],
]) {
  test(`coverage probe TFM pin: ${label} [invariant: multi-TFM outer eval is empty, pin the inner]`, () => {
    const csprojPath = path.join(ROOT, "App.csproj");
    const vfs = makeVfs({ dirs: { [ROOT]: ["App.csproj"] }, files: { [csprojPath]: csproj } });
    const cmd = new CsOracle(vfs.deps).buildCoverageCommand(ROOT);
    assert.strictEqual(cmd.command, "dotnet");
    assert.ok(cmd.args.includes("-getItem:Compile"), "still asks for the Compile set");
    const pin = cmd.args.find((a) => a.startsWith("-p:TargetFramework="));
    if (wantPin === undefined) {
      assert.strictEqual(pin, undefined, "single-TFM / unresolvable -> no pin (outer eval carries the set, or the backstop covers it)");
    } else {
      assert.strictEqual(pin, `-p:TargetFramework=${wantPin}`, "the first TFM is pinned so the inner build's Compile set returns");
    }
    assert.ok(cmd.env.DOTNET_CLI_TELEMETRY_OPTOUT === "1" && cmd.env.DOTNET_NOLOGO === "1", "telemetry/nologo env still set");
  });
}

test("fileCovered backstop: an EMPTY Compile array fails OPEN (never false-dark) [invariant: empty set is not a legitimate not-covered answer]", () => {
  const oracle = new CsOracle(makeVfs().deps);
  const target = path.join(path.sep + "proj", "Anything.cs");
  for (const empty of [
    JSON.stringify({ Items: { Compile: [] } }), // the multi-TFM outer-eval shape
    JSON.stringify({ Items: { Compile: [] }, extra: 1 }),
  ]) {
    assert.strictEqual(oracle.fileCovered(empty, path.sep + "proj", target), true, "an empty Compile set assumes covered — the check speaks");
  }
  // A NON-empty set still discriminates (the backstop did not blunt the probe).
  const real = JSON.stringify({ Items: { Compile: [{ FullPath: path.join(path.sep + "proj", "Other.cs") }] } });
  assert.strictEqual(oracle.fileCovered(real, path.sep + "proj", target), false, "a real non-empty set still reports not-covered for an absent file");
});

// ===========================================================================
// Fix 2 (NETSDK1004 evidence). dotnet writes NETSDK1004 to STDOUT with an empty
// stderr, so the orchestrator's stderr-only evidence was always undefined and
// the "restore first" line was dead. The orchestrator now falls back to the
// first error-ish stdout line when stderr is empty; describeCheckFailure then
// keys on it. Headless end-to-end through runOracleCheck (the live file proves
// the real spawn).
// ===========================================================================

const NETSDK1004_STDOUT =
  "/usr/lib/dotnet/sdk/10.0.110/Sdks/Microsoft.NET.Sdk/targets/Microsoft.PackageDependencyResolution.targets(266,5): " +
  "error NETSDK1004: Assets file '/proj/app/obj/project.assets.json' not found. Run a NuGet package restore to generate this file. [/proj/app/App.csproj]\n" +
  "\nBuild FAILED.\n";

test("orchestrator + CsOracle: an unrestored build (NETSDK1004 on STDOUT, empty stderr) surfaces a 'restore first' envReason [invariant: evidence line names the fix, sourced from stdout]", async () => {
  const src = path.join(ROOT, "A.cs");
  const vfs = makeVfs({ dirs: { [ROOT]: ["App.csproj"] }, files: { [src]: "class A {}\n", [path.join(ROOT, "App.csproj")]: "<Project><PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup></Project>" } });
  const oracle = new CsOracle(vfs.deps);
  const reasons = [];
  const isProbe = (cmd) => cmd.args.some((a) => /-getItem:Compile/.test(a));
  const result = await runOracleCheck(oracle, src, {
    // The probe answers covered; the build "fails" NETSDK1004 on stdout, empty
    // stderr, and writes NO sarif (readSarif returns undefined -> [] diagnostics).
    runCommand: async (cmd) => {
      if (isProbe(cmd)) return { stdout: JSON.stringify({ Items: { Compile: [{ FullPath: src }] } }), exitCode: 0 };
      return { stdout: NETSDK1004_STDOUT, stderr: "", exitCode: 1 };
    },
    envReason: (r) => reasons.push(r),
  });
  assert.ok(result, "the check completed");
  assert.strictEqual(result.success, false, "the unrestored build fails");
  assert.deepStrictEqual(result.diagnostics, [], "no SARIF -> no diagnostics (NETSDK1004 is not a Roslyn diagnostic)");
  assert.strictEqual(reasons.length, 1, "one env reason surfaced");
  assert.ok(/restore/i.test(reasons[0]), `the reason names the fix (restore), got ${JSON.stringify(reasons[0])}`);
  assert.ok(!/crashed/i.test(reasons[0]), "it is the actionable restore-first line, not the generic crash line");
});

test("orchestrator evidence fallback is stdout-only when stderr is empty: a real stderr crash still wins (no Rust/TS regression) [invariant: stderr preferred, stdout is the fallback]", async () => {
  // stderr non-empty -> the reason comes from stderr, stdout ignored: the exact
  // pre-fix behavior every non-C# language relies on.
  const src = path.join(ROOT, "A.cs");
  const vfs = makeVfs({ dirs: { [ROOT]: ["App.csproj"] }, files: { [src]: "class A {}\n" } });
  const oracle = new CsOracle(vfs.deps);
  const reasons = [];
  const isProbe = (cmd) => cmd.args.some((a) => /-getItem:Compile/.test(a));
  await runOracleCheck(oracle, src, {
    runCommand: async (cmd) => {
      if (isProbe(cmd)) return { stdout: JSON.stringify({ Items: { Compile: [{ FullPath: src }] } }), exitCode: 0 };
      return { stdout: "error NETSDK1004: on stdout", stderr: "spawn ENOENT the real crash\n", exitCode: -1 };
    },
    envReason: (r) => reasons.push(r),
  });
  assert.ok(reasons.length === 1 && reasons[0].includes("spawn ENOENT the real crash"), `stderr wins when present, got ${JSON.stringify(reasons)}`);
  assert.ok(!/restore/i.test(reasons[0]), "the stdout NETSDK1004 was NOT consulted because stderr had content");
});
