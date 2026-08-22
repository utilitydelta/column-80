// Blind oracle: the C# compiler oracle (v10 phase 2 and its brief).
// Black-box contract tests written from the CompilerOracle surface ALONE,
// before src/core/csOracle.ts exists. Covers
// every phase-2 contract point:
//   Construction    CsOracle(deps), language === "csharp", NO test rung
//   appliesTo       "csharp" true; rust/typescript/unknown false
//   oracleFor       registration + rust/ts keep precedence
//   detectCrateRoot nearest *.csproj (ANY name) walking parent-ward; none -> undefined
//   buildCheckCommand  dotnet build <csproj> --no-restore /p:ErrorLog=<f>%2cversion=2
//                      + child env DOTNET_CLI_TELEMETRY_OPTOUT=1 / DOTNET_NOLOGO=1;
//                      the comma is %2c-ESCAPED (raw comma -> SARIF v1, the killshot);
//                      the sarif path is deterministic per crateRoot
//   parseCheckOutput   REAL captured SARIF v2.1.0 -> Diagnostic[]: ruleId->code,
//                      level, message.text->message, file:// URI URL-decoded to an
//                      absolute path, region line/col (utf16CodeUnits) -> UTF-8 byte
//                      offsets (multibyte proves the conversion), autosave guard and
//                      unreadable-file -1 sentinels, note-level dropped, missing
//                      sarif -> [], garbage -> []; the sarif is read then UNLINKED
//   checkSuccess    exit 0 -> true (warnings still succeed); non-zero -> false
//   describeCheckFailure  NETSDK1004 -> a "restore first" reason (not failing code)
//   coverage        buildCoverageCommand (dotnet msbuild -getItem:Compile) +
//                   fileCovered: an included file covered, a <Compile Remove> file
//                   not; garbage probe fails OPEN
//   resolveDiagnosticPath  absolute passthrough (no crateRoot anchoring)
//   isAssertionShaped  kind-only; a CS#### text that looks assertion-shaped stays eligible
//   Test rung       buildTestCommand/parseTestOutput absent -> runTestOracle skips
//
// FIXTURES ARE REAL. Every .sarif under test/fixtures/csharp/ was produced by
// running `dotnet build <proj> --no-restore /p:ErrorLog=<f>%2cversion=2` with
// dotnet 10.0.110 (+8.0.129 present) in this environment and captured verbatim;
// the massive tool.driver.rules catalog (unused by the parse contract - ruleId
// IS the code) was stripped, results/regions/messages left untouched. The
// compile-items.json is a real `dotnet msbuild -getItem:Compile` capture. Only
// each fixture's artifactLocation.uri is rewritten to point at the temp source
// this test writes (the diagnostic's identity is environmental in path only; its
// line/col and the source content that the byte math consumes are both real).
// NETSDK1004 console text is a real capture too.
//
// Never read src/**. Expected RED: `CsOracle` does not exist yet. The bundle may
// build with the export elided (esbuild treats an unresolved TS re-export as a
// possible type); the guard below keeps the red one loud surface failure, the
// rest skip, until the impl lands.
//
// Run: SKIP_LIVE=1 node --test test/blind-v10-csoracle.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { pathToFileURL } = require("url");
const { bundleCore } = require("./.blind-util.cjs");

let mod = {};
let cleanup = () => {};
let bundleError;
try {
  ({ mod, cleanup } = bundleCore(
    "blind-v10-csoracle",
    `export { CsOracle, oracleFor, runOracleCheck, runTestOracle } from "../src/core/compilerOracle";\n`
  ));
} catch (e) {
  bundleError = e;
}
if (!bundleError && typeof mod.CsOracle !== "function") {
  bundleError = new Error("the bundle built but exports no CsOracle class");
}
test.after(() => cleanup());

const { CsOracle, oracleFor, runOracleCheck, runTestOracle } = mod;

test("bundle: the v10 csoracle surface builds (CsOracle exported from compilerOracle) [surface: goal 'CsOracle implements CompilerOracle']", () => {
  if (bundleError) {
    assert.fail(`the surface is not implemented yet: ${bundleError.message}`);
  }
});

// Every other test skips (not fails) while the bundle is broken, so the red run
// stays one loud failure instead of a wall of TypeErrors.
const gtest = (name, fn) =>
  test(name, (ctx) => {
    if (bundleError) return ctx.skip("bundle failed to build; see the bundle test");
    return fn(ctx);
  });

// ---------------------------------------------------------------------------
// Real-fixture plumbing. The parse contract is out-of-band: buildCheckCommand
// picks a deterministic sarif path from crateRoot, and parseCheckOutput
// RECOMPUTES that same path, reads + parses + unlinks it (phase2-brief 'The
// out-of-band SARIF wrinkle'). So the tests exercise the REAL round-trip on a
// real temp dir: they learn the path from buildCheckCommand, drop the captured
// SARIF there (uri rewritten to the temp source), and drive parseCheckOutput.
// ---------------------------------------------------------------------------

const FIX = path.join(__dirname, "fixtures", "csharp");
const readFix = (name) => fs.readFileSync(path.join(FIX, name), "utf8");

const scratch = [];
test.after(() => {
  for (const d of scratch) fs.rmSync(d, { recursive: true, force: true });
});
const mkTmp = (tag) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), `blind-v10-${tag}-`));
  scratch.push(d);
  return d;
};

// A csproj stub so buildCheckCommand can find a project in the crateRoot dir.
const STUB_CSPROJ =
  '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup>' +
  "<TargetFramework>net8.0</TargetFramework></PropertyGroup></Project>\n";
const withCsproj = (dir, name = "Proj.csproj") => {
  fs.writeFileSync(path.join(dir, name), STUB_CSPROJ);
  return dir;
};

// The sarif path buildCheckCommand encoded, decoded back out of the %2c-escaped
// /p:ErrorLog token. Pins the escaping shape as a side effect: the token must
// carry `%2c` (not a raw comma) before `version=2`.
const errorLogPath = (cmd) => {
  const arg = cmd.args.find((a) => /ErrorLog=/.test(a));
  assert.ok(arg, `buildCheckCommand emits an ErrorLog arg, got ${JSON.stringify(cmd.args)}`);
  const m = /ErrorLog=(.+?)(%2c|,)version=2\b/i.exec(arg);
  assert.ok(m, `the ErrorLog token is <path>{%2c|,}version=2, got ${JSON.stringify(arg)}`);
  return { sarifPath: m[1], sep: m[2], token: arg };
};

// Drop a captured SARIF at the path buildCheckCommand dictates for `crateRoot`,
// with every result's uri rewritten to `srcAbs`. Returns nothing; the parse
// reads + unlinks it.
const placeSarif = (oracle, crateRoot, fixtureName, srcAbs) => {
  const { sarifPath } = errorLogPath(oracle.buildCheckCommand(crateRoot));
  const doc = JSON.parse(readFix(fixtureName));
  for (const run of doc.runs || []) {
    for (const r of run.results || []) {
      for (const loc of r.locations || []) {
        loc.physicalLocation.artifactLocation.uri = pathToFileURL(srcAbs).href;
      }
    }
  }
  fs.mkdirSync(path.dirname(sarifPath), { recursive: true });
  fs.writeFileSync(sarifPath, JSON.stringify(doc));
  return sarifPath;
};

// A full parse round-trip: real crateRoot, real source on disk, real captured
// SARIF at the deterministic path. checkStartMs defaults to the far future so
// the autosave guard passes (source mtime <= check start -> real offsets).
const FUTURE = () => Date.now() + 3_600_000;
const PAST = () => Date.now() - 3_600_000;
const parseRoundTrip = (fixtureName, srcFixture, { srcAbs, checkStartMs } = {}) => {
  const dir = withCsproj(mkTmp("parse"));
  const src = srcAbs || path.join(dir, "Src.cs");
  fs.mkdirSync(path.dirname(src), { recursive: true });
  fs.writeFileSync(src, readFix(srcFixture));
  const sarifPath = placeSarif(oracleNoDeps(), dir, fixtureName, src);
  const oracle = oracleNoDeps();
  const diags = oracle.parseCheckOutput("", dir, checkStartMs ?? FUTURE());
  return { diags, dir, src, sarifPath };
};

// A default-constructed oracle (real fs). detectCrateRoot / buildCheckCommand /
// parse all ride the real filesystem the tests scaffold.
const oracleNoDeps = () => new CsOracle();

// Byte offsets below were computed from the REAL fixture source + the REAL
// captured region columns (utf16CodeUnits), verified against a UTF-16-slice ->
// UTF-8-encode reference. Naive col-1 arithmetic would miss the multibyte one.
const BROKEN = {
  // Broken.cs: three hallucination classes in one build (goal finding 3).
  CS1061: { line: 11, col: 23, byteStart: 184, byteEnd: 196 },
  CS0246a: { line: 12, col: 13, byteStart: 212, byteEnd: 218 },
  CS0246b: { line: 12, col: 28, byteStart: 227, byteEnd: 233 },
  CS0234: { line: 13, col: 21, byteStart: 257, byteEnd: 275 },
};
const MULTI = { line: 1, col: 82, byteStart: 84, byteEnd: 96 }; // café😀 before the col
const WARN = { line: 1, col: 48, byteStart: 47, byteEnd: 49 };

// ===========================================================================
// Construction + registration. [surface: 'Construction' + oracleFor]
// ===========================================================================

gtest("construction: CsOracle takes optional deps and pins language 'csharp' [surface: goal phase2]", () => {
  assert.strictEqual(new CsOracle().language, "csharp", "language is the readonly literal 'csharp'");
  assert.strictEqual(new CsOracle({ log: () => {} }).language, "csharp", "deps object is accepted, language holds");
  assert.strictEqual(typeof new CsOracle().checkLabel, "string", "a display checkLabel exists");
  assert.ok(new CsOracle().checkLabel.length > 0, "the checkLabel is non-empty (the edit-site verdict line)");
});

gtest("construction: CsOracle carries every required strategy method, and NO test rung [surface: CompilerOracle interface + 'No test rung ... in v10']", () => {
  const oracle = new CsOracle();
  for (const m of ["appliesTo", "detectCrateRoot", "buildCheckCommand", "parseCheckOutput", "checkSuccess", "resolveDiagnosticPath", "isAssertionShaped"]) {
    assert.strictEqual(typeof oracle[m], "function", `required strategy method: ${m}`);
  }
  assert.strictEqual(oracle.buildTestCommand, undefined, "no C# test rung: buildTestCommand absent (dotnet test is roadmap item 2)");
  assert.strictEqual(oracle.parseTestOutput, undefined, "no C# test rung: parseTestOutput absent");
  assert.strictEqual(typeof oracle.buildCoverageCommand, "function", "the C# coverage probe pair is present");
  assert.strictEqual(typeof oracle.fileCovered, "function", "fileCovered is present (the unearned-green probe)");
});

gtest("appliesTo: true for 'csharp' only, false for every other id [surface: goal 'the csharp language id']", () => {
  const oracle = new CsOracle();
  assert.strictEqual(oracle.appliesTo("csharp"), true);
  for (const id of ["rust", "typescript", "javascript", "python", "fsharp", "cs", "c#", "CSharp", "", "plaintext"]) {
    assert.strictEqual(oracle.appliesTo(id), false, `appliesTo(${JSON.stringify(id)}) is false`);
  }
});

gtest("oracleFor: 'csharp' constructs a CsOracle; rust and typescript keep precedence [surface: 'registered in oracleFor']", () => {
  const cs = oracleFor("csharp");
  assert.ok(cs, "oracleFor('csharp') resolves an oracle");
  assert.ok(cs instanceof CsOracle, "it is a CsOracle instance");
  assert.strictEqual(cs.language, "csharp");

  const rust = oracleFor("rust");
  assert.ok(rust && rust.language === "rust", "rust still resolves, never a CsOracle");
  assert.ok(!(rust instanceof CsOracle), "the C# oracle did not swallow rust");
  const ts = oracleFor("typescript");
  assert.ok(ts && ts.language === "typescript", "typescript still resolves");
  assert.ok(!(ts instanceof CsOracle), "the C# oracle did not swallow typescript");
});

gtest("oracleFor: unregistered ids stay undefined [surface: 'no registered oracle applies -> undefined']", () => {
  // python left this set at v11 supersession (PyOracle wired into oracleFor);
  // its registration is pinned in full by blind-v11-pyoracle.test.cjs.
  for (const id of ["fsharp", "vue", ""]) {
    assert.strictEqual(oracleFor(id), undefined, `oracleFor(${JSON.stringify(id)}) is undefined`);
  }
});

// ===========================================================================
// detectCrateRoot: nearest *.csproj walking parent-ward, ANY csproj name.
// Real temp trees (the manifest is discovered by name-pattern, not a fixed
// filename, so a virtual fileExists cannot express it). [surface: detectCrateRoot]
// ===========================================================================

gtest("detectCrateRoot: nearest *.csproj (any name) up from the file dir wins [surface: 'nearest .csproj walking parent-ward']", () => {
  const root = mkTmp("root");
  fs.writeFileSync(path.join(root, "My.Weird.App.csproj"), STUB_CSPROJ);
  fs.mkdirSync(path.join(root, "src", "deep"), { recursive: true });
  const oracle = oracleNoDeps();
  assert.strictEqual(oracle.detectCrateRoot(path.join(root, "src", "deep", "File.cs")), root, "an ancestor csproj (any name) is found");
  assert.strictEqual(oracle.detectCrateRoot(path.join(root, "Direct.cs")), root, "a file directly in the root dir resolves too");
});

gtest("detectCrateRoot: a nested project scopes the check to the nearest csproj [surface: 'nearest .csproj ... not the whole solution']", () => {
  const root = mkTmp("nested");
  fs.writeFileSync(path.join(root, "Outer.csproj"), STUB_CSPROJ);
  const inner = path.join(root, "inner");
  fs.mkdirSync(path.join(inner, "sub"), { recursive: true });
  fs.writeFileSync(path.join(inner, "Inner.csproj"), STUB_CSPROJ);
  const oracle = oracleNoDeps();
  assert.strictEqual(oracle.detectCrateRoot(path.join(inner, "sub", "F.cs")), inner, "the nested Inner.csproj is nearer than Outer");
  const outerFile = path.join(root, "top", "T.cs");
  fs.mkdirSync(path.dirname(outerFile), { recursive: true });
  assert.strictEqual(oracle.detectCrateRoot(outerFile), root, "outside inner/, the outer csproj is nearest");
});

gtest("detectCrateRoot: no csproj anywhere up is undefined (silently inapplicable) [surface: 'none means silently inapplicable']", () => {
  const root = mkTmp("bare");
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  const oracle = oracleNoDeps();
  assert.strictEqual(oracle.detectCrateRoot(path.join(root, "src", "Loose.cs")), undefined, "a .cs with no csproj above it: the gesture stays dark");
});

// ===========================================================================
// buildCheckCommand. [surface: phase2-brief 'The check command' (PROVEN)]
// ===========================================================================

gtest("buildCheckCommand: dotnet build <csproj> --no-restore, the %2c-escaped ErrorLog, and the telemetry/nologo child env [surface: phase2-brief 'The check command']", () => {
  const dir = mkTmp("check");
  fs.writeFileSync(path.join(dir, "S.csproj"), STUB_CSPROJ); // any csproj name
  const oracle = oracleNoDeps();
  const cmd = oracle.buildCheckCommand(dir);

  assert.strictEqual(cmd.command, "dotnet", "spawn dotnet directly - it is on PATH, no execPath dance");
  assert.ok(cmd.args.includes("build"), `the verb is build, got ${JSON.stringify(cmd.args)}`);
  assert.ok(cmd.args.includes("--no-restore"), "--no-restore is non-negotiable (offline invariant; NETSDK1004 over a silent network call)");

  const proj = cmd.args.find((a) => a.endsWith(".csproj"));
  assert.ok(proj, `the specific csproj path is on the command line, got ${JSON.stringify(cmd.args)}`);
  assert.strictEqual(path.basename(proj), "S.csproj", "buildCheckCommand located the actual csproj in the crate dir");

  const { sarifPath, sep, token } = errorLogPath(cmd);
  assert.strictEqual(sep, "%2c", `the comma is %2c-ESCAPED, never a raw comma (raw comma -> SARIF v1.0.0, the killshot), got ${JSON.stringify(token)}`);
  assert.ok(!/,/.test(token), `no unescaped comma anywhere in the ErrorLog token, got ${JSON.stringify(token)}`);
  assert.ok(/\.sarif/i.test(sarifPath), `the ErrorLog target is a .sarif file, got ${JSON.stringify(sarifPath)}`);

  assert.strictEqual(cmd.cwd, dir, "cwd is the crate root");
  assert.ok(cmd.env, "a child env is set");
  assert.strictEqual(cmd.env.DOTNET_CLI_TELEMETRY_OPTOUT, "1", "telemetry opt-out is mandatory (local-first)");
  assert.strictEqual(cmd.env.DOTNET_NOLOGO, "1", "nologo is mandatory");
});

gtest("buildCheckCommand: the sarif path is DETERMINISTIC per crateRoot and DISTINCT across roots [surface: phase2-brief 'Stateless - keyed by crateRoot ... does not race itself']", () => {
  const a = withCsproj(mkTmp("detA"), "A.csproj");
  const b = withCsproj(mkTmp("detB"), "B.csproj");
  const oracle = oracleNoDeps();
  const p1 = errorLogPath(oracle.buildCheckCommand(a)).sarifPath;
  const p2 = errorLogPath(oracle.buildCheckCommand(a)).sarifPath;
  const pb = errorLogPath(oracle.buildCheckCommand(b)).sarifPath;
  assert.strictEqual(p1, p2, "same crateRoot -> same sarif path (stateless, so parseCheckOutput can recompute it)");
  assert.notStrictEqual(p1, pb, "different crateRoots -> different sarif paths (no cross-root collision)");
});

// ===========================================================================
// parseCheckOutput: REAL captured SARIF -> Diagnostic[].
// [surface: phase2-brief 'SARIF v2.1.0 shape' + 'The out-of-band SARIF wrinkle']
// ===========================================================================

gtest("parse: the three hallucination classes map ruleId/level/message/path/line/col + UTF-8 byte offsets [surface: phase2-brief 'SARIF v2.1.0 shape', goal finding 3]", () => {
  const { diags, src } = parseRoundTrip("broken.sarif", "Broken.cs");
  assert.strictEqual(diags.length, 4, "four real results: CS1061, two CS0246, CS0234");

  const cs1061 = diags.find((d) => d.code === "CS1061");
  assert.ok(cs1061, "CS1061 (member does not exist) surfaced");
  assert.strictEqual(cs1061.kind, "compile-error");
  assert.strictEqual(cs1061.level, "error");
  assert.ok(cs1061.message.includes("does not contain a definition for 'NoSuchMember'"), `the message.text rides through, got ${JSON.stringify(cs1061.message)}`);
  assert.strictEqual(cs1061.spans.length, 1, "one span per located result");
  const s = cs1061.spans[0];
  assert.strictEqual(s.fileName, src, "the file:// URI is URL-decoded to the absolute filesystem path");
  assert.ok(path.isAbsolute(s.fileName), "absolute (no crateRoot anchoring - kills the rustc path problem)");
  assert.strictEqual(s.lineStart, BROKEN.CS1061.line);
  assert.strictEqual(s.columnStart, BROKEN.CS1061.col);
  assert.strictEqual(s.byteStart, BROKEN.CS1061.byteStart, "line/col (utf16CodeUnits) -> UTF-8 byte offset");
  assert.strictEqual(s.byteEnd, BROKEN.CS1061.byteEnd, "endColumn -> UTF-8 byte offset");
  assert.strictEqual(s.isPrimary, true, "the diagnostic's own location is primary");

  const cs0246 = diags.filter((d) => d.code === "CS0246");
  assert.strictEqual(cs0246.length, 2, "the invented type CS0246 appears twice (decl + ctor site)");
  assert.strictEqual(cs0246[0].spans[0].byteStart, BROKEN.CS0246a.byteStart);
  assert.strictEqual(cs0246[1].spans[0].byteStart, BROKEN.CS0246b.byteStart);

  const cs0234 = diags.find((d) => d.code === "CS0234");
  assert.ok(cs0234, "CS0234 (invented namespace member) surfaced");
  assert.strictEqual(cs0234.spans[0].byteStart, BROKEN.CS0234.byteStart);
  assert.strictEqual(cs0234.spans[0].byteEnd, BROKEN.CS0234.byteEnd);
});

gtest("parse: multibyte source - byte offsets count UTF-8 bytes over a UTF-16 column slice [surface: phase2-brief 'Columns are UTF-16 code units -> UTF-8 byte offsets']", () => {
  const { diags } = parseRoundTrip("multi.sarif", "Multi.cs");
  assert.strictEqual(diags.length, 1);
  const s = diags[0].spans[0];
  assert.strictEqual(diags[0].code, "CS1061");
  assert.strictEqual(s.columnStart, MULTI.col, "the real captured column (café😀 counted in UTF-16 units)");
  assert.strictEqual(s.byteStart, MULTI.byteStart, "é is 2 UTF-8 bytes and the emoji 4 - the byte offset is 84, not the naive 81");
  assert.strictEqual(s.byteEnd, MULTI.byteEnd);
  assert.notStrictEqual(s.byteStart, MULTI.col - 1, "naive col-1 arithmetic (UTF-16 units as bytes) would be wrong here");
});

gtest("parse: a file:// URI with a percent-encoded space is URL-decoded to the real path [surface: phase2-brief 'URL-decode to a filesystem path']", () => {
  const spaceDir = withCsproj(mkTmp("space"));
  const src = path.join(spaceDir, "with space", "Broken.cs");
  fs.mkdirSync(path.dirname(src), { recursive: true });
  fs.writeFileSync(src, readFix("Broken.cs"));
  const oracle = oracleNoDeps();
  placeSarif(oracle, spaceDir, "broken.sarif", src); // uri becomes file://.../with%20space/Broken.cs
  const diags = oracle.parseCheckOutput("", spaceDir, FUTURE());
  const cs1061 = diags.find((d) => d.code === "CS1061");
  assert.ok(cs1061, "the diagnostic survived");
  assert.strictEqual(cs1061.spans[0].fileName, src, "%20 decoded back to a literal space in the absolute path");
  assert.strictEqual(cs1061.spans[0].byteStart, BROKEN.CS1061.byteStart, "byte conversion still ran on the decoded file");
});

gtest("parse: a warning-level SARIF result maps to compile-warning [surface: Diagnostic.level 'error'|'warning', 'warnings still succeed']", () => {
  const { diags } = parseRoundTrip("warning-only.sarif", "WarnField.cs");
  assert.strictEqual(diags.length, 1);
  const d = diags[0];
  assert.strictEqual(d.code, "CS0649");
  assert.strictEqual(d.level, "warning");
  assert.strictEqual(d.kind, "compile-warning");
  assert.strictEqual(d.spans[0].byteStart, WARN.byteStart, "byte conversion runs on warnings too");
});

gtest("parse: a note-level analyzer result is dropped (only error/warning become Diagnostics) [surface: Diagnostic.level is error|warning only, the RustOracle 'two top-level severities' rule]", () => {
  const { diags } = parseRoundTrip("note-only.sarif", "WarnField.cs");
  assert.deepStrictEqual(diags, [], "a CA-rule 'note' suggestion is not a compile error/warning: repair never sees it");
});

gtest("parse: a clean build (0 SARIF results) yields [] [surface: phase2-brief 'a clean build (0 results)']", () => {
  const { diags } = parseRoundTrip("clean-empty.sarif", "WarnField.cs");
  assert.deepStrictEqual(diags, []);
});

gtest("parse: the SARIF is read then UNLINKED - a second parse of the same root finds nothing [surface: phase2-brief 'reads + parses it, then unlinks it']", () => {
  const { dir, sarifPath, diags } = parseRoundTrip("broken.sarif", "Broken.cs");
  assert.strictEqual(diags.length, 4, "the first parse read the sarif");
  assert.strictEqual(fs.existsSync(sarifPath), false, "the sarif was unlinked after the read");
  const again = oracleNoDeps().parseCheckOutput("", dir, FUTURE());
  assert.deepStrictEqual(again, [], "no sarif now -> [] (never a throw)");
});

gtest("parse: a MISSING sarif (NETSDK1004 / crash writes none) -> [], never a throw [surface: phase2-brief 'SARIF file ABSENT ... return []']", () => {
  const dir = withCsproj(mkTmp("nosarif"));
  const oracle = oracleNoDeps();
  let diags;
  assert.doesNotThrow(() => { diags = oracle.parseCheckOutput("error NETSDK1004: ...\n", dir, FUTURE()); });
  assert.deepStrictEqual(diags, [], "no sarif file at the deterministic path -> empty, garbage-tolerant");
});

gtest("parse: garbage / truncated SARIF -> [], never a throw [surface: parseCheckOutput 'Must never throw on garbage']", () => {
  for (const junk of ['{ "version": "2.1.0", "runs": [ { "results": [ {  ', "not json at all }{", "", "<xml>not sarif</xml>"]) {
    const dir = withCsproj(mkTmp("garbage"));
    const { sarifPath } = errorLogPath(oracleNoDeps().buildCheckCommand(dir));
    fs.mkdirSync(path.dirname(sarifPath), { recursive: true });
    fs.writeFileSync(sarifPath, junk);
    let diags;
    assert.doesNotThrow(() => { diags = oracleNoDeps().parseCheckOutput("", dir, FUTURE()); }, `garbage ${JSON.stringify(junk).slice(0, 30)} must not throw`);
    assert.deepStrictEqual(diags, [], "unparseable SARIF yields [], not a crashed oracle");
  }
});

gtest("parse: an unreadable named file keeps line/col but sets byteStart=byteEnd=-1 [surface: phase2-brief 'the unreadable-file -1 sentinel']", () => {
  const dir = withCsproj(mkTmp("unread"));
  const oracle = oracleNoDeps();
  // The SARIF names a file that does not exist; the source read fails.
  placeSarif(oracle, dir, "broken.sarif", path.join(dir, "does-not-exist", "Ghost.cs"));
  const diags = oracle.parseCheckOutput("", dir, FUTURE());
  const cs1061 = diags.find((d) => d.code === "CS1061");
  assert.ok(cs1061, "the diagnostic still surfaces");
  assert.strictEqual(cs1061.spans[0].lineStart, BROKEN.CS1061.line, "line/col are kept from the SARIF region");
  assert.strictEqual(cs1061.spans[0].columnStart, BROKEN.CS1061.col);
  assert.strictEqual(cs1061.spans[0].byteStart, -1, "unreadable source -> -1 (refuse-repair wins, never a guessed offset)");
  assert.strictEqual(cs1061.spans[0].byteEnd, -1);
});

gtest("parse: the autosave guard - source changed AFTER the check start gets sentinel -1 [surface: phase2-brief 'the autosave mtime guard ... content changed since checkStartMs -> sentinel -1']", () => {
  // checkStartMs is in the PAST; the source is written now, so its mtime is
  // strictly after the check start - the file changed since the check ran.
  const { diags } = parseRoundTrip("broken.sarif", "Broken.cs", { checkStartMs: PAST() });
  const cs1061 = diags.find((d) => d.code === "CS1061");
  assert.ok(cs1061, "the diagnostic still surfaces");
  assert.strictEqual(cs1061.spans[0].byteStart, -1, "mtime > checkStartMs -> a stale conversion is refused, sentinel -1");
  assert.strictEqual(cs1061.spans[0].byteEnd, -1);
  // Control: the SAME fixture with a future check start converts for real.
  const ok = parseRoundTrip("broken.sarif", "Broken.cs", { checkStartMs: FUTURE() });
  assert.strictEqual(ok.diags.find((d) => d.code === "CS1061").spans[0].byteStart, BROKEN.CS1061.byteStart, "a check start after the file's mtime -> the real offset");
});

// ===========================================================================
// checkSuccess + NETSDK1004. [surface: phase2-brief 'checkSuccess + NETSDK1004']
// ===========================================================================

gtest("checkSuccess: exit 0 succeeds (warnings included), non-zero fails [surface: phase2-brief 'exit 0 = success (warnings still succeed)']", () => {
  const oracle = new CsOracle();
  const NETSDK = readFix("netsdk1004-stdout.txt");
  const cases = [
    { stdout: "", exitCode: 0, want: true, why: "clean build" },
    { stdout: "warnings live in the SARIF, not stdout", exitCode: 0, want: true, why: "exit 0 with warnings still succeeds" },
    { stdout: "", exitCode: 1, want: false, why: "non-zero fails" },
    { stdout: NETSDK, exitCode: 1, want: false, why: "an unrestored build exits non-zero (the not-restored distinction is drawn by describeCheckFailure, not here)" },
  ];
  for (const c of cases) {
    assert.strictEqual(oracle.checkSuccess(c.stdout, c.exitCode), c.want, c.why);
  }
});

gtest("describeCheckFailure: NETSDK1004 evidence surfaces a 'restore first' reason - not failing code [surface: phase2-brief 'describeCheckFailure ... surfaces restore first, NEVER an auto-restore']", () => {
  const oracle = new CsOracle();
  assert.strictEqual(typeof oracle.describeCheckFailure, "function", "the C# oracle describes the not-restored inapplicability");
  const netsdkLine = readFix("netsdk1004-stdout.txt").split("\n").find((l) => l.includes("NETSDK1004"));
  const reason = oracle.describeCheckFailure(1, netsdkLine);
  assert.ok(typeof reason === "string" && reason.length > 0, "a one-line reason is produced");
  assert.ok(/restore/i.test(reason), `the reason names the fix (restore), got ${JSON.stringify(reason)}`);
});

// ===========================================================================
// Coverage probe. [surface: phase2-brief 'Coverage probe', goal finding 4]
// ===========================================================================

gtest("buildCoverageCommand: dotnet msbuild <csproj> -getItem:Compile, telemetry/nologo env [surface: phase2-brief 'dotnet msbuild -getItem:Compile']", () => {
  const dir = withCsproj(mkTmp("cov"), "Cov.csproj");
  const cmd = oracleNoDeps().buildCoverageCommand(dir);
  assert.strictEqual(cmd.command, "dotnet");
  assert.ok(cmd.args.includes("msbuild"), `the probe is dotnet msbuild, got ${JSON.stringify(cmd.args)}`);
  assert.ok(cmd.args.some((a) => /-getItem:Compile/.test(a)), "the probe asks for the Compile item set");
  assert.ok(cmd.args.some((a) => a.endsWith(".csproj")), "the probe targets the csproj");
  assert.strictEqual(cmd.cwd, dir);
  assert.ok(cmd.env && cmd.env.DOTNET_CLI_TELEMETRY_OPTOUT === "1" && cmd.env.DOTNET_NOLOGO === "1", "the probe carries the same telemetry/nologo env");
});

gtest("fileCovered: an included file reads covered, a <Compile Remove> file reads not-covered [surface: goal finding 4 'the unearned green ... has a probe']", () => {
  const json = readFix("compile-items.json");
  const included = JSON.parse(json).Items.Compile[0].FullPath; // real captured absolute path
  const crateRoot = path.dirname(included);
  const oracle = new CsOracle();
  assert.strictEqual(oracle.fileCovered(json, crateRoot, included), true, "the compiled file is an input -> covered");
  const excluded = path.join(crateRoot, "Excluded.cs"); // the <Compile Remove> file, absent from the JSON
  assert.strictEqual(oracle.fileCovered(json, crateRoot, excluded), false, "the excluded broken file is NOT an input -> the unearned green is refused");
});

gtest("fileCovered: an unparseable probe answer fails OPEN [surface: phase2-brief 'Fail OPEN on a probe that did not answer cleanly']", () => {
  const oracle = new CsOracle();
  const crateRoot = "/proj";
  for (const junk of ["not json }{", "", "MSBUILD : error MSB1009: Project file does not exist."]) {
    assert.strictEqual(oracle.fileCovered(junk, crateRoot, path.join(crateRoot, "Any.cs")), true, `garbage probe -> assume covered, got a not-covered for ${JSON.stringify(junk).slice(0, 20)}`);
  }
});

// ===========================================================================
// resolveDiagnosticPath + isAssertionShaped + test rung.
// ===========================================================================

gtest("resolveDiagnosticPath: an absolute SARIF path passes through unchanged (no crateRoot anchoring) [surface: phase2-brief 'Absolute; no crateRoot anchoring needed']", () => {
  const oracle = new CsOracle();
  const abs = path.join(path.sep + "abs", "src", "Thing.cs");
  assert.strictEqual(oracle.resolveDiagnosticPath("/proj", abs), abs, "C# paths are already absolute file:// URIs - passthrough");
});

const csDiag = (over = {}) => ({
  kind: "compile-error",
  level: "error",
  code: "CS1061",
  message: "'string' does not contain a definition for 'NoSuchMember' ...",
  spans: [{ fileName: "/proj/Broken.cs", byteStart: 184, byteEnd: 196, lineStart: 11, lineEnd: 11, columnStart: 23, columnEnd: 35, isPrimary: true }],
  suggestions: [],
  ...over,
});

gtest("isAssertionShaped: kind-only - 'assertion-failure' true, a CS#### text that looks assertion-shaped stays eligible [surface: goal 'isAssertionShaped is the producer kind tag alone', the TsOracle shape]", () => {
  const oracle = new CsOracle();
  const cases = [
    { d: csDiag({ kind: "assertion-failure", message: "anything" }), want: true, why: "producer-assigned kind is the only signal" },
    { d: csDiag({ message: "assertion `left == right` failed" }), want: false, why: "C# has no assertion TEXT family: rustc-shaped text is NOT refused" },
    { d: csDiag({ message: "assertion failed: totals must match" }), want: false, why: "the other rustc text shape is not refused either" },
    { d: csDiag(), want: false, why: "a plain CS1061 is not assertion-shaped" },
  ];
  for (const c of cases) {
    assert.strictEqual(oracle.isAssertionShaped(c.d), c.want, c.why);
  }
});

gtest("no rung: runTestOracle resolves undefined, never spawns, logs the C# skip [surface: goal 'No test rung ... runTestOracle skips honestly']", async () => {
  const oracle = new CsOracle();
  const calls = [];
  const lines = [];
  const runCommand = async (cmd) => { calls.push(cmd); return { stdout: "", stderr: "", exitCode: 0 }; };
  const result = await runTestOracle(oracle, "/proj/Broken.cs", "SomeFilter", { runCommand, log: (l) => lines.push(l) });
  assert.strictEqual(result, undefined, "no rung -> undefined, not an error");
  assert.strictEqual(calls.length, 0, "runCommand is never invoked");
  assert.ok(lines.some((l) => l.includes("no test rung for csharp")), `the skip line names the missing rung, got ${JSON.stringify(lines)}`);
});

// ===========================================================================
// Orchestrator glue (headless): the coverage probe rides runOracleCheck, then
// the check's SARIF round-trip produces the verdict + diagnostics. Fully
// injected runCommand - no dotnet spawn (the live rung proves the real thing).
// [surface: runOracleCheck 585-704 + the C# strategy pair]
// ===========================================================================

gtest("runOracleCheck with a CsOracle: probe spawns FIRST, a covering answer lets the check run, SARIF diagnostics + exit-code verdict ride out [surface: runOracleCheck probe-first ordering + 'checkSuccess']", async () => {
  const dir = withCsproj(mkTmp("orch"), "Orch.csproj");
  const src = path.join(dir, "Broken.cs");
  fs.writeFileSync(src, readFix("Broken.cs"));
  const oracle = oracleNoDeps();
  const crateRoot = oracle.detectCrateRoot(src);
  assert.strictEqual(crateRoot, dir, "the file resolves to its csproj dir");

  // The probe answer must report `src` as a compiled input so coverage passes.
  const probeJson = JSON.stringify({ Items: { Compile: [{ Identity: "Broken.cs", FullPath: src }] } });
  const isProbe = (cmd) => cmd.args.some((a) => /-getItem:Compile/.test(a));
  const calls = [];
  const runCommand = async (cmd) => {
    calls.push(cmd);
    if (isProbe(cmd)) return { stdout: probeJson, exitCode: 0 };
    // The check "runs": drop the real captured SARIF where buildCheckCommand
    // pointed, uri rewritten to src, then answer a non-zero exit (real errors).
    placeSarif(oracle, crateRoot, "broken.sarif", src);
    return { stdout: "", exitCode: 1 };
  };

  const result = await runOracleCheck(oracle, src, { runCommand });
  assert.ok(result, "a completed run resolves a result");
  assert.ok(calls.length >= 2, "at least two spawns: the probe, then the check");
  assert.ok(isProbe(calls[0]), "the FIRST spawn is the coverage probe (-getItem:Compile)");
  assert.ok(!isProbe(calls[calls.length - 1]), "the last spawn is the build check");
  assert.strictEqual(result.success, false, "non-zero exit -> failure verdict");
  assert.strictEqual(result.crateRoot, crateRoot);
  const codes = result.diagnostics.map((d) => d.code).sort();
  assert.deepStrictEqual(codes, ["CS0234", "CS0246", "CS0246", "CS1061"], "the SARIF diagnostics rode out of the out-of-band file");
  const cs1061 = result.diagnostics.find((d) => d.code === "CS1061");
  assert.strictEqual(cs1061.spans[0].fileName, src, "absolute path round-tripped through the URI decode");
  assert.strictEqual(cs1061.spans[0].byteStart, BROKEN.CS1061.byteStart, "byte conversion rode along end to end");
});

gtest("runOracleCheck with a CsOracle: a <Compile Remove> file is not-covered - the check NEVER spawns, the gesture stays dark [surface: runOracleCheck 646-657 'is not an input of', goal finding 4]", async () => {
  const dir = withCsproj(mkTmp("dark"), "Dark.csproj");
  const excluded = path.join(dir, "Excluded.cs");
  fs.writeFileSync(excluded, readFix("Broken.cs"));
  const oracle = oracleNoDeps();

  // The probe answers a clean exit 0 but the Compile set omits the excluded file.
  const probeJson = JSON.stringify({ Items: { Compile: [{ Identity: "Included.cs", FullPath: path.join(dir, "Included.cs") }] } });
  const isProbe = (cmd) => cmd.args.some((a) => /-getItem:Compile/.test(a));
  const calls = [];
  const lines = [];
  const result = await runOracleCheck(oracle, excluded, {
    runCommand: async (cmd) => { calls.push(cmd); if (isProbe(cmd)) return { stdout: probeJson, exitCode: 0 }; return { stdout: "", exitCode: 0 }; },
    log: (l) => lines.push(l),
  });
  assert.strictEqual(result, undefined, "not an input -> undefined, the unearned green is refused");
  assert.ok(calls.every(isProbe), `only probe(s) spawned, the check never ran; spawned ${JSON.stringify(calls.map((c) => c.args))}`);
  assert.ok(lines.some((l) => l.includes("is not an input of") && l.includes(excluded)), `the honest-dark skip names the file, got ${JSON.stringify(lines)}`);
});
