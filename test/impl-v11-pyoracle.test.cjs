// Impl oracle for PyOracle (v11): the internals the blind contract set cannot
// see from the CompilerOracle surface alone —
//   * byte-offset conversion beyond the blind's single multibyte case (tabs,
//     multi-line ranges, past-EOF -1, the ASCII baseline)
//   * the missing-imports storm THRESHOLD I chose (strict majority + min 2)
//   * the steering catalog parsing a real site-packages layout on disk
//   * interpreter resolution across .venv/venv and the Windows Scripts variant,
//     including precedence
//   * the autosave-guard sentinel boundary (mtime == checkStartMs floor)
//   * the bundled-pyright entry resolution + the product/test override seam
//
// The blind file (blind-v11-pyoracle*.test.cjs) owns the external contract; this
// file owns the mechanism. No real pyright run is needed here: the blind LIVE
// rung already spawns real pyright through the default entry resolution.
//
// Run: SKIP_LIVE=1 node --test test/impl-v11-pyoracle.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-v11-pyoracle",
  `export { PyOracle } from "../src/core/compilerOracle";\n`,
);
test.after(() => cleanup());
const { PyOracle } = mod;

const scratch = [];
test.after(() => {
  for (const d of scratch) fs.rmSync(d, { recursive: true, force: true });
});
const mkTmp = (tag) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), `impl-v11-${tag}-`));
  scratch.push(d);
  return d;
};

const FUTURE = () => Date.now() + 3_600_000;

// Build a one-diagnostic pyright JSON pointing at `abs`, 0-based LSP range.
const oneDiagJson = (abs, sl, sc, el, ec, rule = "reportAttributeAccessIssue", severity = "error") =>
  JSON.stringify({
    version: "1.1.411",
    generalDiagnostics: [
      { file: abs, severity, message: "m", rule, range: { start: { line: sl, character: sc }, end: { line: el, character: ec } } },
    ],
    summary: { filesAnalyzed: 1, errorCount: severity === "error" ? 1 : 0, warningCount: severity === "warning" ? 1 : 0, informationCount: 0, timeInSec: 0.1 },
  });

// The independent LSP(0-based line, UTF-16 char) -> UTF-8 byte reference.
const lspToByte = (src, line, char) => {
  const lines = src.split("\n");
  let b = 0;
  for (let i = 0; i < line; i++) b += Buffer.byteLength(lines[i], "utf8") + 1;
  return b + Buffer.byteLength(lines[line].slice(0, char), "utf8");
};

// ===========================================================================
// Byte-offset conversion mechanism (parseCheckOutput reads the real source).
// ===========================================================================

test("byte offset: ASCII, tab-indented, multi-line, and emoji ranges all match a UTF-8 recomputation", () => {
  const cases = [
    // [src, startLine, startChar, endLine, endChar]
    { src: "a = 1\nb = 2\n", sl: 1, sc: 4, el: 1, ec: 5, why: "ASCII on line 2" },
    { src: "def f():\n\treturn undefined_x\n", sl: 1, sc: 8, el: 1, ec: 19, why: "tab counts as ONE UTF-16 unit and ONE byte" },
    { src: "x = (\n  bad_ref\n)\n", sl: 1, sc: 2, el: 2, ec: 0, why: "a range spanning two lines converts both ends" },
    { src: "s = \"日本語\".no()\n", sl: 0, sc: 9, el: 0, ec: 12, why: "each CJK char is 3 UTF-8 bytes over 1 UTF-16 unit" },
    { src: "😀 = 1\ny = 😀.z\n", sl: 1, sc: 4, el: 1, ec: 6, why: "an astral char (2 UTF-16 units, 4 bytes) before the range" },
  ];
  for (const c of cases) {
    const dir = mkTmp("byte");
    const abs = path.join(dir, "f.py");
    fs.writeFileSync(abs, c.src);
    const diags = new PyOracle().parseCheckOutput(oneDiagJson(abs, c.sl, c.sc, c.el, c.ec), dir, FUTURE());
    assert.strictEqual(diags.length, 1, c.why);
    const s = diags[0].spans[0];
    assert.strictEqual(s.byteStart, lspToByte(c.src, c.sl, c.sc), `${c.why}: byteStart`);
    assert.strictEqual(s.byteEnd, lspToByte(c.src, c.el, c.ec), `${c.why}: byteEnd`);
    assert.strictEqual(s.lineStart, c.sl + 1, `${c.why}: 1-based lineStart`);
    assert.strictEqual(s.columnStart, c.sc + 1, `${c.why}: 1-based columnStart`);
  }
});

test("byte offset: a range whose start line runs past EOF -> the -1 sentinel, never a wild offset", () => {
  const dir = mkTmp("eof");
  const abs = path.join(dir, "f.py");
  fs.writeFileSync(abs, "line0\nline1\n"); // only lines 0 and 1 exist (LSP 0-based)
  // LSP line 9 is far past EOF: byteOffset walks 9 newlines, never finds them.
  const diags = new PyOracle().parseCheckOutput(oneDiagJson(abs, 9, 0, 9, 3), dir, FUTURE());
  assert.strictEqual(diags.length, 1, "the diagnostic still surfaces");
  assert.strictEqual(diags[0].spans[0].byteStart, -1, "past-EOF start -> -1");
  assert.strictEqual(diags[0].spans[0].byteEnd, -1, "past-EOF end -> -1");
  assert.strictEqual(diags[0].spans[0].lineStart, 10, "line/col are still kept (10 = 9+1)");
});

test("byte offset: a column past the line end -> -1, never a spill into the next line (the autosave-race twin of past-EOF)", () => {
  const dir = mkTmp("col");
  const abs = path.join(dir, "f.py");
  // The line the diagnostic names is 6 chars ("cd = 2"); disk is shorter than
  // what pyright analyzed (the autosave race). A char-50 column must refuse, not
  // slice past the newline into the next line's bytes (the pre-fix bug returned 14).
  fs.writeFileSync(abs, "ab = 1\ncd = 2\n");
  const diags = new PyOracle().parseCheckOutput(oneDiagJson(abs, 1, 50, 1, 52), dir, FUTURE());
  assert.strictEqual(diags.length, 1, "the diagnostic still surfaces");
  assert.strictEqual(diags[0].spans[0].byteStart, -1, "column past line end -> -1, not a next-line spill");
  assert.strictEqual(diags[0].spans[0].byteEnd, -1, "column past line end -> -1 for the end too");
  assert.strictEqual(diags[0].spans[0].lineStart, 2, "line/col are still kept (2 = 1+1)");
});

test("byte offset: a range with a non-finite character is dropped as a span (no NaN offset), diagnostic still present", () => {
  const dir = mkTmp("nan");
  const abs = path.join(dir, "f.py");
  fs.writeFileSync(abs, "x = 1\n");
  const json = JSON.stringify({
    generalDiagnostics: [
      { file: abs, severity: "error", rule: "reportGeneralTypeIssues", message: "m", range: { start: { line: 0, character: null }, end: { line: 0, character: 1 } } },
    ],
    summary: { filesAnalyzed: 1, errorCount: 1, warningCount: 0, informationCount: 0 },
  });
  const diags = new PyOracle().parseCheckOutput(json, dir, FUTURE());
  assert.strictEqual(diags.length, 1, "the malformed range drops only the span, not the whole diagnostic");
  assert.deepStrictEqual(diags[0].spans, [], "no span rather than a NaN-bearing one");
  assert.strictEqual(diags[0].code, "reportGeneralTypeIssues");
});

// ===========================================================================
// Autosave-guard sentinel boundary. The floor comparison (mtime > checkStartMs)
// must NOT fire when the file's mtime equals the check start (same-ms save).
// ===========================================================================

test("autosave guard: mtime strictly AFTER checkStartMs -> -1; mtime AT-OR-BEFORE -> real offset", () => {
  const dir = mkTmp("auto");
  const abs = path.join(dir, "f.py");
  const src = "x = broken\n";
  fs.writeFileSync(abs, src);
  const mtimeMs = fs.statSync(abs).mtimeMs;

  // checkStartMs one ms in the PAST of the file's floored mtime -> changed -> -1.
  const stale = new PyOracle().parseCheckOutput(oneDiagJson(abs, 0, 4, 0, 10), dir, Math.floor(mtimeMs) - 1);
  assert.strictEqual(stale[0].spans[0].byteStart, -1, "file newer than the check start is refused");

  // checkStartMs exactly at the floored mtime -> NOT strictly newer -> real offset.
  const boundary = new PyOracle().parseCheckOutput(oneDiagJson(abs, 0, 4, 0, 10), dir, Math.floor(mtimeMs));
  assert.strictEqual(boundary[0].spans[0].byteStart, lspToByte(src, 0, 4), "a same-ms write is not treated as newer (no false-fire)");
});

// ===========================================================================
// Missing-imports storm threshold: strict majority AND at least two.
// ===========================================================================

test("storm threshold: strict majority of reportMissingImports AND >= 2 fires; a lone or non-majority import does not", () => {
  const oracle = new PyOracle();
  const err = (code) => ({ kind: "compile-error", level: "error", code, message: "m", spans: [], suggestions: [] });
  const warn = (code) => ({ kind: "compile-warning", level: "warning", code, message: "m", spans: [], suggestions: [] });
  const MI = () => err("reportMissingImports");
  const OTHER = () => err("reportUndefinedVariable");

  const cases = [
    { diags: [MI(), MI()], want: true, why: "2 of 2 (100%) -> storm (the blind fixture)" },
    { diags: [MI(), MI(), OTHER()], want: true, why: "2 of 3 (majority) -> storm" },
    { diags: [MI()], want: false, why: "a lone missing import is ambiguous, not a storm (min 2)" },
    { diags: [MI(), OTHER()], want: false, why: "1 of 2 is not a strict majority" },
    { diags: [MI(), MI(), OTHER(), OTHER()], want: false, why: "2 of 4 is exactly half, not a majority" },
    { diags: [OTHER(), OTHER()], want: false, why: "no missing imports at all -> not a storm" },
    { diags: [], want: false, why: "no diagnostics -> not a storm" },
    // Warnings never count toward the storm: it is an error-level environment tell.
    { diags: [MI(), warn("reportMissingImports")], want: false, why: "only ONE error-level missing import; the warning does not count" },
  ];
  for (const c of cases) {
    assert.strictEqual(oracle.isMissingImportsStorm(c.diags), c.want, c.why);
  }
});

test("describeEnvironment: names the interpreter/venv on a storm stdout; undefined on a non-storm or garbage", () => {
  const oracle = new PyOracle();
  const stormJson = JSON.stringify({
    generalDiagnostics: [
      { file: "/p/a.py", severity: "error", rule: "reportMissingImports", message: "Import \"x\" could not be resolved", range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } } },
      { file: "/p/a.py", severity: "error", rule: "reportMissingImports", message: "Import \"y\" could not be resolved", range: { start: { line: 1, character: 0 }, end: { line: 1, character: 1 } } },
    ],
    summary: { filesAnalyzed: 1, errorCount: 2, warningCount: 0, informationCount: 0 },
  });
  const reason = oracle.describeEnvironment(stormJson);
  assert.ok(typeof reason === "string" && /interpreter|venv|resolve/i.test(reason), `the reason names the environment, got ${JSON.stringify(reason)}`);
  assert.ok(reason.includes("2"), "the reason counts the unresolved imports");

  const oneJson = oneDiagJson("/p/a.py", 0, 0, 0, 1, "reportMissingImports");
  assert.strictEqual(oracle.describeEnvironment(oneJson), undefined, "a single missing import is not surfaced as an environment storm");
  assert.strictEqual(oracle.describeEnvironment("not json"), undefined, "garbage stdout -> undefined, never a throw");
});

// ===========================================================================
// Interpreter resolution across layouts + precedence.
// ===========================================================================

const pythonPathArg = (cmd) => {
  const i = cmd.args.indexOf("--pythonpath");
  return i >= 0 ? cmd.args[i + 1] : undefined;
};

test("interpreter resolution: .venv, venv (POSIX), and the Windows Scripts variant each resolve; .venv wins over venv", () => {
  const dir = "/proj";
  const file = "/proj/gen.py";
  const dotVenvPosix = path.join(dir, ".venv", "bin", "python");
  const venvPosix = path.join(dir, "venv", "bin", "python");
  const dotVenvWin = path.join(dir, ".venv", "Scripts", "python.exe");

  const only = (present) => (p) => present.includes(p);
  const build = (present) => new PyOracle({ fileExists: only(present) }).buildCheckCommand(dir, undefined, file);

  assert.strictEqual(pythonPathArg(build([dotVenvPosix])), dotVenvPosix, ".venv/bin/python resolves");
  assert.strictEqual(pythonPathArg(build([venvPosix])), venvPosix, "venv/bin/python resolves");
  assert.strictEqual(pythonPathArg(build([dotVenvWin])), dotVenvWin, ".venv/Scripts/python.exe (Windows) resolves");
  // Precedence: both present -> .venv wins over venv.
  assert.strictEqual(pythonPathArg(build([dotVenvPosix, venvPosix])), dotVenvPosix, ".venv takes precedence over venv");
});

// ===========================================================================
// Bundled-pyright entry resolution + the product/test override seam.
// ===========================================================================

test("buildCheckCommand: spawns the host node with the pyright entry; the pyrightEntry dep overrides resolution", () => {
  const dir = mkTmp("entry");
  const file = path.join(dir, "gen.py");
  const oracle = new PyOracle({ fileExists: () => false, pyrightEntry: "/custom/pyright/index.js" });
  const cmd = oracle.buildCheckCommand(dir, undefined, file);
  assert.strictEqual(cmd.command, process.execPath, "spawned through the host's own node (ELECTRON_RUN_AS_NODE)");
  assert.strictEqual(cmd.env.ELECTRON_RUN_AS_NODE, "1", "the node-as-node env is set");
  assert.strictEqual(cmd.args[0], "/custom/pyright/index.js", "the injected pyright entry is argv[0]");
  assert.ok(cmd.args.includes("--outputjson"));
  assert.ok(cmd.args.includes(file), "the single-file target rides");
});

test("buildCheckCommand: no filePath -> degrades to checking the crate root (never a crash)", () => {
  const dir = mkTmp("degrade");
  const oracle = new PyOracle({ fileExists: () => false, pyrightEntry: "/p/index.js" });
  const cmd = oracle.buildCheckCommand(dir);
  assert.ok(cmd.args.includes(dir), "the crate root is the fallback target when no file is given");
});

// ===========================================================================
// Steering catalog over a REAL site-packages layout on disk.
// ===========================================================================

test("catalog: reads a real .venv site-packages layout -> sorted, normalized top-level distributions", () => {
  const root = mkTmp("cat");
  const sp = path.join(root, ".venv", "lib", "python3.12", "site-packages");
  fs.mkdirSync(sp, { recursive: true });
  // Top-level package dirs, dist-info/egg-info metadata dirs, single-module
  // distributions, and non-importable noise.
  fs.mkdirSync(path.join(sp, "requests"));
  fs.mkdirSync(path.join(sp, "requests-2.31.0.dist-info"));
  fs.mkdirSync(path.join(sp, "numpy"));
  fs.mkdirSync(path.join(sp, "numpy-1.26.4.dist-info"));
  fs.mkdirSync(path.join(sp, "typing_extensions-4.9.0.dist-info")); // dir but the module itself is a .py below
  fs.writeFileSync(path.join(sp, "typing_extensions.py"), "\n");
  fs.mkdirSync(path.join(sp, "flask-3.0.0.egg-info"));
  fs.mkdirSync(path.join(sp, "flask"));
  fs.writeFileSync(path.join(sp, "six.py"), "\n"); // a single-module distribution
  fs.mkdirSync(path.join(sp, "__pycache__")); // noise: excluded
  fs.mkdirSync(path.join(sp, "_distutils_hack")); // noise: underscore-led
  fs.writeFileSync(path.join(sp, "easy-install.pth"), "\n"); // noise: pth marker
  fs.writeFileSync(path.join(sp, "README.txt"), "\n"); // noise: txt

  const names = new PyOracle().catalog(root);
  assert.deepStrictEqual(
    names,
    ["flask", "numpy", "requests", "six", "typing_extensions"].sort(),
    "top-level dirs + .py modules win over their dist-info twins (import form preferred), deduped, sorted; noise dropped",
  );
});

test("catalog: a distribution with NO same-named top-level rides on its distribution name (the fallback hint)", () => {
  const root = mkTmp("catdist");
  const sp = path.join(root, ".venv", "lib", "python3.11", "site-packages");
  fs.mkdirSync(sp, { recursive: true });
  // A namespace/differently-named dist: only the metadata dir is present.
  fs.mkdirSync(path.join(sp, "PyYAML-6.0.1.dist-info"));
  fs.mkdirSync(path.join(sp, "yaml")); // its ACTUAL importable top-level
  const names = new PyOracle().catalog(root);
  assert.ok(names.includes("yaml"), "the importable top-level surfaces");
  assert.ok(names.includes("PyYAML"), "a dist with no same-named top-level keeps its distribution name");
});

test("catalog: a Windows Lib/site-packages layout resolves too", () => {
  const root = mkTmp("catwin");
  const sp = path.join(root, ".venv", "Lib", "site-packages");
  fs.mkdirSync(sp, { recursive: true });
  fs.mkdirSync(path.join(sp, "click"));
  fs.mkdirSync(path.join(sp, "click-8.1.7.dist-info"));
  assert.deepStrictEqual(new PyOracle().catalog(root), ["click"]);
});

test("catalog: no venv beside the root -> [] (offline, no spawn, no crash)", () => {
  const root = mkTmp("catnone");
  assert.deepStrictEqual(new PyOracle().catalog(root), [], "no interpreter env -> empty catalog");
});
