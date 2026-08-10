// Blind oracle: the Python compiler oracle (session-python/goal.md phase 2 +
// session-python/phase2-brief.md). Black-box contract tests written from the
// CompilerOracle surface ALONE, before src/core/pyOracle.ts exists. Covers
// every phase-2 contract point the brief pins:
//   Construction    PyOracle(deps), language === "python", NO test rung, NO
//                   coverage pair (coverage folds into checkSuccess)
//   appliesTo       "python" true; rust/typescript/csharp/unknown false
//   oracleFor       registration + rust/ts/csharp keep precedence
//   detectCrateRoot nearest of {pyproject.toml,setup.py,setup.cfg,
//                   requirements.txt,pyrightconfig.json} parent-ward; each
//                   marker triggers; nearest wins; bare workspace-folder
//                   fallback; undefined when nothing places the file
//   buildCheckCommand  pyright --outputjson [--pythonpath <interp>] <file>,
//                   cwd===crateRoot; interpreter from .venv/venv beside root;
//                   --pythonpath OMITTED when none resolves
//   parseCheckOutput   REAL captured pyright --outputjson -> Diagnostic[]:
//                   rule->code, severity->kind/level, message rides, 0-based
//                   LSP range -> 1-based DiagnosticSpan line/col + UTF-8 byte
//                   offsets (multibyte proves the conversion), "information"
//                   dropped, autosave guard + unreadable-file -1 sentinels,
//                   garbage -> [] never throws
//   checkSuccess    errorCount===0 && filesAnalyzed>0; the excluded-file
//                   filesAnalyzed:0 unearned-green is REFUSED; warnings-only
//                   succeeds; summary authoritative over exit code
//   missing-imports the reportMissingImports storm is preserved through parse
//                   (the environment-broken signal) — env-reason surface name
//                   is a FINDING, see the storm test
//   isAssertionShaped  kind-tag only (no runtime-assertion text in pyright)
//   test rung       buildTestCommand/parseTestOutput absent -> runTestOracle skips
//
// FIXTURES ARE REAL. Every JSON constant below was produced by running the
// bundled `node_modules/.bin/pyright --outputjson <fixture>` (pyright 1.1.411)
// in this environment and captured verbatim (compacted). Only each result's
// `file` field is rewritten in-test to point at the temp source this test
// writes — the diagnostic's identity is environmental in path only; its
// range and the source bytes the offset math consumes are both real. The
// live rung (blind-v11-pyoracle-live.test.cjs) re-proves the same shapes by
// spawning real pyright end to end.
//
// Never read src/**. Expected RED: `PyOracle` does not exist yet. The bundle
// may build with the export elided (esbuild treats an unresolved TS re-export
// as a possible type); the guard below keeps ONE loud surface failure, the
// rest skip, until the impl lands.
//
// Run: SKIP_LIVE=1 node --test test/blind-v11-pyoracle.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { bundleCore } = require("./.blind-util.cjs");

let mod = {};
let cleanup = () => {};
let bundleError;
try {
  ({ mod, cleanup } = bundleCore(
    "blind-v11-pyoracle",
    `export { PyOracle, oracleFor, runOracleCheck, runTestOracle } from "../src/core/compilerOracle";\n`
  ));
} catch (e) {
  bundleError = e;
}
if (!bundleError && typeof mod.PyOracle !== "function") {
  bundleError = new Error("the bundle built but exports no PyOracle class (re-export it from compilerOracle.ts, the csOracle precedent)");
}
test.after(() => cleanup());

const { PyOracle, oracleFor, runOracleCheck, runTestOracle } = mod;

test("bundle: the v11 pyoracle surface builds (PyOracle exported from compilerOracle) [surface: goal 'PyOracle implements CompilerOracle']", () => {
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
// Real captured pyright --outputjson (1.1.411). `file` rewritten per test.
// ---------------------------------------------------------------------------
const FIX = {
  // x: str = "hello" / y = x.no_such_member() / z = undefined_name
  broken: '{"version":"1.1.411","generalDiagnostics":[{"file":"__F__","severity":"error","message":"Cannot access attribute \\"no_such_member\\" for class \\"Literal[\'hello\']\\"\\n\\u00a0\\u00a0Attribute \\"no_such_member\\" is unknown","range":{"start":{"line":1,"character":6},"end":{"line":1,"character":20}},"rule":"reportAttributeAccessIssue"},{"file":"__F__","severity":"error","message":"\\"undefined_name\\" is not defined","range":{"start":{"line":2,"character":4},"end":{"line":2,"character":18}},"rule":"reportUndefinedVariable"}],"summary":{"filesAnalyzed":1,"errorCount":2,"warningCount":0,"informationCount":0,"timeInSec":0.1}}',
  clean: '{"version":"1.1.411","generalDiagnostics":[],"summary":{"filesAnalyzed":1,"errorCount":0,"warningCount":0,"informationCount":0,"timeInSec":0.08}}',
  // s = "café😀".no_member()  — attribute error at UTF-16 char 13
  multi: '{"version":"1.1.411","generalDiagnostics":[{"file":"__F__","severity":"error","message":"Cannot access attribute \\"no_member\\" for class \\"Literal[\'caf\\u00e9\\ud83d\\ude00\']\\"\\n\\u00a0\\u00a0Attribute \\"no_member\\" is unknown","range":{"start":{"line":0,"character":13},"end":{"line":0,"character":22}},"rule":"reportAttributeAccessIssue"}],"summary":{"filesAnalyzed":1,"errorCount":1,"warningCount":0,"informationCount":0,"timeInSec":0.08}}',
  // import os  (reportUnusedImport as warning)
  warn: '{"version":"1.1.411","generalDiagnostics":[{"file":"__F__","severity":"warning","message":"Import \\"os\\" is not accessed","range":{"start":{"line":0,"character":7},"end":{"line":0,"character":9}},"rule":"reportUnusedImport"}],"summary":{"filesAnalyzed":1,"errorCount":0,"warningCount":1,"informationCount":0,"timeInSec":0.09}}',
  // import os  (reportUnusedImport forced to information)
  info: '{"version":"1.1.411","generalDiagnostics":[{"file":"__F__","severity":"information","message":"Import \\"os\\" is not accessed","range":{"start":{"line":0,"character":7},"end":{"line":0,"character":9}},"rule":"reportUnusedImport"}],"summary":{"filesAnalyzed":1,"errorCount":0,"warningCount":0,"informationCount":1,"timeInSec":0.12}}',
  // two reportMissingImports errors — the broken-environment storm
  missing: '{"version":"1.1.411","generalDiagnostics":[{"file":"__F__","severity":"error","message":"Import \\"definitely_not_installed_pkg\\" could not be resolved","range":{"start":{"line":0,"character":7},"end":{"line":0,"character":35}},"rule":"reportMissingImports"},{"file":"__F__","severity":"error","message":"Import \\"another_missing_one\\" could not be resolved","range":{"start":{"line":1,"character":7},"end":{"line":1,"character":26}},"rule":"reportMissingImports"}],"summary":{"filesAnalyzed":1,"errorCount":2,"warningCount":0,"informationCount":0,"timeInSec":0.08}}',
  // an EXCLUDED file: named on the CLI, filesAnalyzed 0, errorCount 0 (real capture)
  excluded: '{"version":"1.1.411","generalDiagnostics":[],"summary":{"filesAnalyzed":0,"errorCount":0,"warningCount":0,"informationCount":0,"timeInSec":0}}',
};

// Exact source bytes for each JSON fixture, so the byte-offset math the oracle
// runs matches an independent recomputation from the same source.
const SRC = {
  broken: 'x: str = "hello"\ny = x.no_such_member()\nz = undefined_name\n',
  multi: 's = "café\u{1F600}".no_member()\n',
  warn: "import os\n",
  missing: "import definitely_not_installed_pkg\nimport another_missing_one\nval = definitely_not_installed_pkg.thing()\n",
};

// Independent LSP(0-based line, UTF-16 char) -> UTF-8 byte reference. This is
// the same conversion the oracle must perform; the tests assert the oracle
// equals it. JS strings are UTF-16, so slice(0, char) takes exactly `char`
// code units — the LSP unit.
const lspToByte = (src, line, char) => {
  const lines = src.split("\n");
  let b = 0;
  for (let i = 0; i < line; i++) b += Buffer.byteLength(lines[i], "utf8") + 1; // +1 for the \n
  return b + Buffer.byteLength(lines[line].slice(0, char), "utf8");
};

// Rewrite every result's absolute `file` to `abs` and hand back the stdout JSON.
const stdoutFor = (fixtureKey, abs) => FIX[fixtureKey].split("__F__").join(abs);

const scratch = [];
test.after(() => {
  for (const d of scratch) fs.rmSync(d, { recursive: true, force: true });
});
const mkTmp = (tag) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), `blind-v11-${tag}-`));
  scratch.push(d);
  return d;
};

const FUTURE = () => Date.now() + 3_600_000;
const PAST = () => Date.now() - 3_600_000;

// Write the real source to a temp file, point the fixture JSON at it, parse.
const parseRoundTrip = (fixtureKey, srcKey, { checkStartMs, srcAbs } = {}) => {
  const dir = mkTmp("parse");
  const src = srcAbs || path.join(dir, "f.py");
  fs.mkdirSync(path.dirname(src), { recursive: true });
  if (srcKey) fs.writeFileSync(src, SRC[srcKey]);
  const stdout = stdoutFor(fixtureKey, src);
  const diags = new PyOracle().parseCheckOutput(stdout, dir, checkStartMs ?? FUTURE());
  return { diags, dir, src };
};

// ===========================================================================
// Construction + registration. [surface: 'Construction' + oracleFor]
// ===========================================================================

gtest("construction: PyOracle takes optional deps and pins language 'python' [surface: goal phase2]", () => {
  assert.strictEqual(new PyOracle().language, "python", "language is the readonly literal 'python'");
  assert.strictEqual(new PyOracle({ log: () => {} }).language, "python", "deps object accepted, language holds");
  assert.strictEqual(typeof new PyOracle().checkLabel, "string", "a display checkLabel exists (the edit-site verdict line)");
  assert.ok(new PyOracle().checkLabel.length > 0, "the checkLabel is non-empty");
});

gtest("construction: PyOracle carries the required strategy methods, and NO test rung / NO coverage pair [surface: CompilerOracle interface + brief 'No test rung' + 'coverage folds in']", () => {
  const oracle = new PyOracle();
  for (const m of ["appliesTo", "detectCrateRoot", "buildCheckCommand", "parseCheckOutput", "checkSuccess", "isAssertionShaped"]) {
    assert.strictEqual(typeof oracle[m], "function", `required strategy method: ${m}`);
  }
  assert.strictEqual(oracle.buildTestCommand, undefined, "no Python test rung: buildTestCommand absent (pytest is roadmap item 2 / v12)");
  assert.strictEqual(oracle.parseTestOutput, undefined, "no Python test rung: parseTestOutput absent");
  assert.strictEqual(oracle.buildCoverageCommand, undefined, "no separate coverage probe: it folds into checkSuccess (brief)");
  assert.strictEqual(oracle.fileCovered, undefined, "no fileCovered: filesAnalyzed in the check JSON is the coverage tell");
});

gtest("appliesTo: true for 'python' only, false for every other id [surface: goal 'the python language id']", () => {
  const oracle = new PyOracle();
  assert.strictEqual(oracle.appliesTo("python"), true);
  for (const id of ["rust", "typescript", "javascript", "csharp", "py", "Python", "python3", "", "plaintext"]) {
    assert.strictEqual(oracle.appliesTo(id), false, `appliesTo(${JSON.stringify(id)}) is false`);
  }
});

gtest("oracleFor: 'python' constructs a PyOracle; rust/typescript/csharp keep precedence [surface: 'registered in oracleFor as the 4th strategy']", () => {
  const py = oracleFor("python");
  assert.ok(py, "oracleFor('python') resolves an oracle");
  assert.ok(py instanceof PyOracle, "it is a PyOracle instance");
  assert.strictEqual(py.language, "python");
  for (const id of ["rust", "typescript", "csharp"]) {
    const o = oracleFor(id);
    assert.ok(o && o.language === id, `${id} still resolves`);
    assert.ok(!(o instanceof PyOracle), `the Python oracle did not swallow ${id}`);
  }
});

gtest("oracleFor: unregistered ids stay undefined [surface: 'no registered oracle applies -> undefined']", () => {
  // go left this set at v23 supersession (GoOracle wired into oracleFor);
  // its registration is pinned in full by blind-v23-gooracle.test.cjs.
  for (const id of ["java", "fsharp", "vue", ""]) {
    assert.strictEqual(oracleFor(id), undefined, `oracleFor(${JSON.stringify(id)}) is undefined`);
  }
});

// ===========================================================================
// detectCrateRoot: nearest marker parent-ward, then bare workspace folder.
// Real temp trees (markers discovered by real fs). [surface: detectCrateRoot]
// ===========================================================================

const MARKERS = ["pyproject.toml", "setup.py", "setup.cfg", "requirements.txt", "pyrightconfig.json"];

for (const marker of MARKERS) {
  gtest(`detectCrateRoot: the marker '${marker}' alone marks a root [surface: brief 'ANY of pyproject.toml/setup.py/setup.cfg/requirements.txt/pyrightconfig.json']`, () => {
    const root = mkTmp("mk");
    fs.writeFileSync(path.join(root, marker), "\n");
    fs.mkdirSync(path.join(root, "pkg", "sub"), { recursive: true });
    const oracle = new PyOracle();
    assert.strictEqual(oracle.detectCrateRoot(path.join(root, "pkg", "sub", "m.py")), root, `an ancestor ${marker} places the file`);
    assert.strictEqual(oracle.detectCrateRoot(path.join(root, "top.py")), root, "a file directly in the marker dir resolves too");
  });
}

gtest("detectCrateRoot: the NEAREST marker wins over a farther one [surface: brief 'nearest dir walking parent-ward']", () => {
  const root = mkTmp("near");
  fs.writeFileSync(path.join(root, "pyproject.toml"), "\n"); // outer marker
  const inner = path.join(root, "inner");
  fs.mkdirSync(path.join(inner, "sub"), { recursive: true });
  fs.writeFileSync(path.join(inner, "requirements.txt"), "\n"); // nearer marker
  const oracle = new PyOracle();
  assert.strictEqual(oracle.detectCrateRoot(path.join(inner, "sub", "f.py")), inner, "the nested requirements.txt is nearer than the outer pyproject.toml");
  const outerFile = path.join(root, "top", "t.py");
  fs.mkdirSync(path.dirname(outerFile), { recursive: true });
  assert.strictEqual(oracle.detectCrateRoot(outerFile), root, "outside inner/, the outer pyproject.toml is nearest");
});

gtest("detectCrateRoot: no marker but an injected workspace folder contains the file -> that folder is a valid BARE root [surface: brief 'bare-folder fallback ... a VALID bare root']", () => {
  const root = mkTmp("bare");
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  const file = path.join(root, "src", "loose.py");
  const oracle = new PyOracle({ workspaceFolders: [root] });
  assert.strictEqual(oracle.detectCrateRoot(file), root, "pyright needs no manifest: the workspace folder is the bare root");
});

gtest("detectCrateRoot: no marker AND no workspace folder placing the file -> undefined [surface: brief 'undefined only when neither a marker nor a workspace folder places the file']", () => {
  const root = mkTmp("nowhere");
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  const oracle = new PyOracle({ workspaceFolders: [path.join(root, "some", "other", "project")] });
  assert.strictEqual(oracle.detectCrateRoot(path.join(root, "src", "loose.py")), undefined, "nothing places the file: the gesture stays dark, never an error");
});

// ===========================================================================
// buildCheckCommand. [surface: brief 'The check command' (PROVEN)]
// buildCheckCommand(crateRoot, project?, filePath?) — the additive 3rd param.
// Interpreter resolved by fileExists beside the crateRoot.
// ===========================================================================

// A fileExists that returns true ONLY for the paths in `present`.
const fileExistsOnly = (present) => (p) => present.includes(p);
const pythonPathArg = (cmd) => {
  const i = cmd.args.indexOf("--pythonpath");
  return i >= 0 ? cmd.args[i + 1] : undefined;
};

gtest("buildCheckCommand: --outputjson + the target file, cwd is the crate root [surface: brief 'pyright --outputjson ... <targetFile>, cwd = crateRoot']", () => {
  const dir = mkTmp("check");
  const file = path.join(dir, "gen.py");
  const oracle = new PyOracle({ fileExists: () => false }); // no interpreter beside root
  const cmd = oracle.buildCheckCommand(dir, undefined, file);
  assert.ok(cmd.args.includes("--outputjson"), `--outputjson is on the command line, got ${JSON.stringify(cmd.args)}`);
  assert.ok(cmd.args.includes(file), `the specific target file is on the command line (single-file scope), got ${JSON.stringify(cmd.args)}`);
  assert.strictEqual(cmd.cwd, dir, "cwd is the crate root");
  assert.strictEqual(typeof cmd.command, "string", "a spawnable command string is set");
  assert.ok(cmd.command.length > 0, "the command names the pyright binary (or node + pyright.js)");
});

gtest("buildCheckCommand: a '.venv/bin/python' beside the root feeds --pythonpath <interpreter> [surface: brief 'interpreter resolves beside crateRoot ... feeds --pythonpath']", () => {
  const dir = mkTmp("venv");
  const file = path.join(dir, "gen.py");
  const interp = path.join(dir, ".venv", "bin", "python");
  const oracle = new PyOracle({ fileExists: fileExistsOnly([interp]) });
  const cmd = oracle.buildCheckCommand(dir, undefined, file);
  assert.strictEqual(pythonPathArg(cmd), interp, `--pythonpath is followed by the resolved .venv interpreter, got ${JSON.stringify(cmd.args)}`);
});

gtest("buildCheckCommand: 'venv/bin/python' (no dot) also resolves the interpreter [surface: brief 'look for .venv/bin/python, then venv/bin/python']", () => {
  const dir = mkTmp("venv2");
  const file = path.join(dir, "gen.py");
  const interp = path.join(dir, "venv", "bin", "python");
  const oracle = new PyOracle({ fileExists: fileExistsOnly([interp]) });
  const cmd = oracle.buildCheckCommand(dir, undefined, file);
  assert.strictEqual(pythonPathArg(cmd), interp, `the plain-venv interpreter feeds --pythonpath, got ${JSON.stringify(cmd.args)}`);
});

gtest("buildCheckCommand: NO interpreter beside the root -> --pythonpath is OMITTED [surface: brief 'OMITS --pythonpath when none resolves']", () => {
  const dir = mkTmp("noven");
  const file = path.join(dir, "gen.py");
  const oracle = new PyOracle({ fileExists: () => false });
  const cmd = oracle.buildCheckCommand(dir, undefined, file);
  assert.strictEqual(pythonPathArg(cmd), undefined, `no interpreter -> no --pythonpath (system python fallback), got ${JSON.stringify(cmd.args)}`);
  assert.ok(!cmd.args.includes("--pythonpath"), "the flag is entirely absent, not present with an empty value");
});

// ===========================================================================
// parseCheckOutput: REAL captured pyright JSON -> Diagnostic[].
// [surface: brief 'parseCheckOutput' + DiagnosticSpan 1-based doc]
// ===========================================================================

gtest("parse: generalDiagnostics -> neutral Diagnostic[] with rule->code, severity->kind/level, message, 1-based span + UTF-8 byte offsets [surface: brief 'parseCheckOutput', goal finding 3]", () => {
  const { diags, src } = parseRoundTrip("broken", "broken");
  assert.strictEqual(diags.length, 2, "two real results: reportAttributeAccessIssue, reportUndefinedVariable");

  const attr = diags.find((d) => d.code === "reportAttributeAccessIssue");
  assert.ok(attr, "reportAttributeAccessIssue (the member hallucination) surfaced");
  assert.strictEqual(attr.kind, "compile-error");
  assert.strictEqual(attr.level, "error");
  assert.ok(attr.message.includes("no_such_member"), `the message rides through, got ${JSON.stringify(attr.message)}`);
  assert.strictEqual(attr.spans.length, 1, "one span per pyright range");
  const s = attr.spans[0];
  assert.strictEqual(s.fileName, src, "the JSON `file` (already absolute) is the span fileName");
  assert.ok(path.isAbsolute(s.fileName), "absolute path (pyright reports absolute)");
  assert.strictEqual(s.lineStart, 2, "LSP line 1 (0-based) -> 1-based lineStart 2");
  assert.strictEqual(s.columnStart, 7, "LSP character 6 (0-based) -> 1-based columnStart 7");
  assert.strictEqual(s.byteStart, lspToByte(SRC.broken, 1, 6), "byteStart is the UTF-8 byte offset of the range start");
  assert.strictEqual(s.byteEnd, lspToByte(SRC.broken, 1, 20), "byteEnd is the UTF-8 byte offset of the range end");
  assert.strictEqual(s.isPrimary, true, "pyright gives one range per diagnostic: isPrimary true");

  const undef = diags.find((d) => d.code === "reportUndefinedVariable");
  assert.ok(undef, "reportUndefinedVariable (invented name) surfaced");
  assert.strictEqual(undef.level, "error");
  assert.strictEqual(undef.spans[0].byteStart, lspToByte(SRC.broken, 2, 4), "the second diagnostic's byte offset is right too");
});

gtest("parse: multibyte source - the byte offset counts UTF-8 bytes over a UTF-16 char range, not the naive column [surface: brief 'LSP UTF-16 char -> UTF-8 byte']", () => {
  const { diags } = parseRoundTrip("multi", "multi");
  assert.strictEqual(diags.length, 1);
  const s = diags[0].spans[0];
  assert.strictEqual(diags[0].code, "reportAttributeAccessIssue");
  assert.strictEqual(s.columnStart, 14, "LSP char 13 -> 1-based columnStart 14 (café😀 counted in UTF-16 units)");
  assert.strictEqual(s.byteStart, lspToByte(SRC.multi, 0, 13), "byteStart is the UTF-8 recomputation");
  assert.strictEqual(s.byteStart, 16, "é is 2 UTF-8 bytes and 😀 is 4: the byte offset is 16, not the naive 13");
  assert.notStrictEqual(s.byteStart, 13, "naive UTF-16-char-as-byte arithmetic (13) would be wrong here");
});

gtest("parse: a warning-severity result maps to compile-warning [surface: Diagnostic.level, 'warnings still succeed']", () => {
  const { diags } = parseRoundTrip("warn", "warn");
  assert.strictEqual(diags.length, 1);
  const d = diags[0];
  assert.strictEqual(d.code, "reportUnusedImport");
  assert.strictEqual(d.level, "warning");
  assert.strictEqual(d.kind, "compile-warning");
});

gtest("parse: an 'information'-severity result is DROPPED (only error/warning become Diagnostics) [surface: brief 'drop information']", () => {
  const { diags } = parseRoundTrip("info", "warn");
  assert.deepStrictEqual(diags, [], "an information-level hint is not a compile error/warning: repair never sees it");
});

gtest("parse: a clean run (0 generalDiagnostics) yields [] [surface: parseCheckOutput on a clean check]", () => {
  const { diags } = parseRoundTrip("clean", null);
  assert.deepStrictEqual(diags, []);
});

gtest("parse: garbage / invalid JSON -> [], never a throw [surface: brief 'garbage/invalid JSON -> [] never throws']", () => {
  const dir = mkTmp("garbage");
  const oracle = new PyOracle();
  for (const junk of ['{ "generalDiagnostics": [ {  ', "not json at all }{", "", "<xml>not json</xml>", '{"generalDiagnostics":"notarray"}']) {
    let diags;
    assert.doesNotThrow(() => { diags = oracle.parseCheckOutput(junk, dir, FUTURE()); }, `garbage ${JSON.stringify(junk).slice(0, 24)} must not throw`);
    assert.deepStrictEqual(diags, [], "unparseable stdout yields [], not a crashed oracle");
  }
});

gtest("parse: an unreadable named file keeps line/col but sets byteStart=byteEnd=-1 [surface: brief 'reading the named absolute file' + the tsc/csOracle -1 sentinel]", () => {
  const dir = mkTmp("unread");
  const ghost = path.join(dir, "does-not-exist", "ghost.py");
  const oracle = new PyOracle();
  const diags = oracle.parseCheckOutput(stdoutFor("broken", ghost), dir, FUTURE());
  const attr = diags.find((d) => d.code === "reportAttributeAccessIssue");
  assert.ok(attr, "the diagnostic still surfaces");
  assert.strictEqual(attr.spans[0].lineStart, 2, "line is kept from the range");
  assert.strictEqual(attr.spans[0].columnStart, 7, "column is kept from the range");
  assert.strictEqual(attr.spans[0].byteStart, -1, "unreadable source -> -1 sentinel (refuse-repair, never a guessed offset)");
  assert.strictEqual(attr.spans[0].byteEnd, -1);
});

gtest("parse: the autosave guard - source changed AFTER checkStartMs gets sentinel -1 [surface: brief 'a file changed since checkStartMs gets the -1 sentinel']", () => {
  // checkStartMs in the PAST; the source is written now, so its mtime is
  // strictly after the check start - the file changed since the check ran.
  const { diags } = parseRoundTrip("broken", "broken", { checkStartMs: PAST() });
  const attr = diags.find((d) => d.code === "reportAttributeAccessIssue");
  assert.ok(attr, "the diagnostic still surfaces");
  assert.strictEqual(attr.spans[0].byteStart, -1, "mtime > checkStartMs -> a stale conversion is refused, sentinel -1");
  assert.strictEqual(attr.spans[0].byteEnd, -1);
  // Control: the same fixture with a future check start converts for real.
  const ok = parseRoundTrip("broken", "broken", { checkStartMs: FUTURE() });
  assert.strictEqual(ok.diags.find((d) => d.code === "reportAttributeAccessIssue").spans[0].byteStart, lspToByte(SRC.broken, 1, 6), "a check start after the file's mtime -> the real offset");
});

// ===========================================================================
// checkSuccess: errorCount===0 && filesAnalyzed>0, summary authoritative.
// [surface: brief 'checkSuccess', goal finding 5]
// ===========================================================================

gtest("checkSuccess: clean -> true; error -> false; the filesAnalyzed:0 unearned green -> false; warnings-only -> true [surface: brief 'errorCount 0 && filesAnalyzed > 0 ... filesAnalyzed:0 is the unearned-green tell']", () => {
  const oracle = new PyOracle();
  const F = (k) => FIX[k].split("__F__").join("/x/y.py");
  const cases = [
    { stdout: F("clean"), exitCode: 0, want: true, why: "clean file, filesAnalyzed 1 -> success" },
    { stdout: F("broken"), exitCode: 1, want: false, why: "errorCount 2 -> failure" },
    { stdout: F("excluded"), exitCode: 0, want: false, why: "filesAnalyzed 0 with errorCount 0 -> the unearned green is REFUSED (fail closed)" },
    { stdout: F("warn"), exitCode: 0, want: true, why: "warnings-only, errorCount 0, filesAnalyzed 1 -> success" },
  ];
  for (const c of cases) {
    assert.strictEqual(oracle.checkSuccess(c.stdout, c.exitCode), c.want, c.why);
  }
});

gtest("checkSuccess: the JSON summary is authoritative, NOT the exit code [surface: brief 'pyright exit code is nonzero on errors but the JSON summary is authoritative']", () => {
  const oracle = new PyOracle();
  const clean = FIX.clean.split("__F__").join("/x/y.py");
  const broken = FIX.broken.split("__F__").join("/x/y.py");
  assert.strictEqual(oracle.checkSuccess(clean, 1), true, "a clean summary succeeds even if the process exited non-zero");
  assert.strictEqual(oracle.checkSuccess(broken, 0), false, "an error-bearing summary fails even if the process exited zero");
});

gtest("checkSuccess: garbage stdout fails CLOSED (no confirmed filesAnalyzed>0) [surface: brief 'fail CLOSED with evidence' + garbage tolerance]", () => {
  const oracle = new PyOracle();
  for (const junk of ["not json }{", "", "<xml/>", '{"summary":"nope"}']) {
    let v;
    assert.doesNotThrow(() => { v = oracle.checkSuccess(junk, 0); }, "checkSuccess never throws on garbage");
    assert.strictEqual(v, false, `unparseable summary -> no earned green (${JSON.stringify(junk).slice(0, 16)})`);
  }
});

// ===========================================================================
// Missing-imports storm. The environment-broken gate. [surface: brief
// 'Missing-imports storm gate', goal finding 6]
// ===========================================================================

gtest("storm: the reportMissingImports signal survives parse intact (all-error, coded) so a storm is DETECTABLE [surface: brief 'diagnostics carry reportMissingImports']", () => {
  const { diags } = parseRoundTrip("missing", "missing");
  assert.strictEqual(diags.length, 2, "both reportMissingImports results surface");
  assert.ok(diags.every((d) => d.code === "reportMissingImports"), "every code is reportMissingImports (the storm is 100% import-resolution)");
  assert.ok(diags.every((d) => d.level === "error"), "they arrive as errors, so a naive checkSuccess would (wrongly) blame the generation without the storm gate");
});

gtest("storm: a reportMissingImports-dominated result is flagged ENVIRONMENT-broken via some describe*/env channel [surface: brief 'surfaces an ENVIRONMENT reason, NOT a generation-error verdict' — FINDING: exact method name is unspecified]", () => {
  // The brief pins the BEHAVIOR (a missing-imports storm is named as an
  // environment problem, never as the generation hallucinating) but leaves the
  // exact surface open ("a describe*/envReason channel ... if the exact method
  // name is unspecified, assert the behavioral contract and note the ambiguity
  // as a finding"). This test locks the behavior against the likely surfaces;
  // if PyOracle names its env-reason method something not probed here, THIS is
  // the finding for the implementer, not a real regression.
  const oracle = new PyOracle();
  const evidence = 'Import "definitely_not_installed_pkg" could not be resolved';
  const storm = FIX.missing.split("__F__").join("/proj/gen.py");
  const candidates = [
    () => oracle.describeMissingRoot && oracle.describeMissingRoot("/proj/gen.py"),
    () => oracle.describeCheckFailure && oracle.describeCheckFailure(1, evidence),
    () => oracle.describeEnvironment && oracle.describeEnvironment(storm),
    () => oracle.describeCheckFailure && oracle.describeCheckFailure(1, storm),
  ];
  const named = candidates
    .map((fn) => { try { return fn(); } catch { return undefined; } })
    .find((r) => typeof r === "string" && /import|interpreter|environ|venv|resolve|install/i.test(r));
  assert.ok(
    named,
    "some describe*/env channel names the missing-imports storm as an environment problem (interpreter/import/venv). FINDING: no probed method produced one — the implementer must expose the env-reason surface and its name should be pinned here."
  );
});

// ===========================================================================
// isAssertionShaped + test rung. [surface: brief 'isAssertionShaped = kind-tag only']
// ===========================================================================

const pyDiag = (over = {}) => ({
  kind: "compile-error",
  level: "error",
  code: "reportAttributeAccessIssue",
  message: 'Cannot access attribute "x" for class "str"',
  spans: [{ fileName: "/proj/gen.py", byteStart: 1, byteEnd: 2, lineStart: 1, lineEnd: 1, columnStart: 1, columnEnd: 2, isPrimary: true }],
  suggestions: [],
  ...over,
});

gtest("isAssertionShaped: kind-only - 'assertion-failure' true, an assertion-shaped message stays eligible [surface: brief 'isAssertionShaped = kind-tag only', the csOracle shape]", () => {
  const oracle = new PyOracle();
  const cases = [
    { d: pyDiag({ kind: "assertion-failure", message: "anything" }), want: true, why: "producer-assigned kind is the only signal" },
    { d: pyDiag({ message: "assertion `left == right` failed" }), want: false, why: "pyright has no runtime-assertion TEXT family: rustc-shaped text is NOT refused" },
    { d: pyDiag({ message: "assertion failed: totals must match" }), want: false, why: "the other rustc text shape is not refused either" },
    { d: pyDiag(), want: false, why: "a plain reportAttributeAccessIssue is not assertion-shaped" },
  ];
  for (const c of cases) {
    assert.strictEqual(oracle.isAssertionShaped(c.d), c.want, c.why);
  }
});

gtest("no rung: runTestOracle resolves undefined, never spawns, logs the python skip [surface: brief 'No test rung ... runTestOracle skips']", async () => {
  const oracle = new PyOracle();
  const calls = [];
  const lines = [];
  const runCommand = async (cmd) => { calls.push(cmd); return { stdout: "", stderr: "", exitCode: 0 }; };
  const result = await runTestOracle(oracle, "/proj/gen.py", "SomeFilter", { runCommand, log: (l) => lines.push(l) });
  assert.strictEqual(result, undefined, "no rung -> undefined, not an error");
  assert.strictEqual(calls.length, 0, "runCommand is never invoked");
  assert.ok(lines.some((l) => l.includes("no test rung for python")), `the skip line names the missing rung, got ${JSON.stringify(lines)}`);
});

// ===========================================================================
// Orchestrator glue (headless): runOracleCheck drives detect -> build -> parse
// with an injected runCommand (no pyright spawn; the live rung proves the real
// thing). Also pins the compilerOracle.ts:703 call-site update: the check
// command must carry the target file, or single-file scope is lost.
// [surface: runOracleCheck + brief 'Update ... the one call site to pass filePath']
// ===========================================================================

gtest("runOracleCheck with a PyOracle: the check command carries the target file, error diagnostics + a failing verdict ride out [surface: runOracleCheck + brief 'single-file invocation']", async () => {
  const dir = mkTmp("orch");
  fs.writeFileSync(path.join(dir, "pyproject.toml"), "\n");
  const src = path.join(dir, "gen.py");
  fs.writeFileSync(src, SRC.broken);
  const oracle = new PyOracle({ workspaceFolders: [dir] });
  assert.strictEqual(oracle.detectCrateRoot(src), dir, "the file resolves to its marker dir");

  const calls = [];
  const runCommand = async (cmd) => { calls.push(cmd); return { stdout: stdoutFor("broken", src), exitCode: 1 }; };
  const result = await runOracleCheck(oracle, src, { runCommand });
  assert.ok(result, "a completed run resolves a result");
  assert.ok(calls.length >= 1, "the check spawned");
  assert.ok(calls[calls.length - 1].args.includes(src), `the check command carries the target file (pins compilerOracle.ts:703 passing filePath), got ${JSON.stringify(calls[calls.length - 1].args)}`);
  assert.strictEqual(result.success, false, "an error-bearing summary -> failure verdict");
  assert.strictEqual(result.crateRoot, dir);
  const codes = result.diagnostics.map((d) => d.code).sort();
  assert.deepStrictEqual(codes, ["reportAttributeAccessIssue", "reportUndefinedVariable"], "the neutral diagnostics rode out of the check JSON");
  const attr = result.diagnostics.find((d) => d.code === "reportAttributeAccessIssue");
  assert.strictEqual(attr.spans[0].byteStart, lspToByte(SRC.broken, 1, 6), "byte conversion rode along end to end");
});

gtest("runOracleCheck with a PyOracle: a clean check -> success true, no diagnostics [surface: runOracleCheck + checkSuccess]", async () => {
  const dir = mkTmp("orchok");
  fs.writeFileSync(path.join(dir, "setup.py"), "\n");
  const src = path.join(dir, "ok.py");
  fs.writeFileSync(src, "def f(a: int) -> int:\n    return a\n");
  const oracle = new PyOracle({ workspaceFolders: [dir] });
  const runCommand = async () => ({ stdout: stdoutFor("clean", src), exitCode: 0 });
  const result = await runOracleCheck(oracle, src, { runCommand });
  assert.ok(result, "a result resolves");
  assert.strictEqual(result.success, true, "clean summary -> success");
  assert.deepStrictEqual(result.diagnostics, [], "no diagnostics on a clean check");
});
