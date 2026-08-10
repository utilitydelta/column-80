// Blind oracle: the Python oracle's LIVE falsification rung (session-python
// phase 2). REAL `pyright --outputjson` (1.1.411, the npm dep) against real
// fixture files, driven end to end through runOracleCheck. This reaches what
// the unit round-trip cannot: the real pyright binary spawning headless, the
// real generalDiagnostics JSON, the real file:// absolute paths and ranges,
// the real filesAnalyzed coverage field, and the real exit code.
//
// Two rungs:
//   1. GROUND-TRUTH sanity (independent of PyOracle): spawn real pyright and
//      assert the JSON shape the unit fixtures were captured from is still what
//      pyright emits. This PASSES whether or not PyOracle exists, proving the
//      captured fixtures + the byte-offset assertions are sound.
//   2. PyOracle-driven: runOracleCheck(new PyOracle(...), src) end to end.
//      RED until src/core/pyOracle.ts lands.
//
// Requires node_modules/.bin/pyright (1.1.411 present this session). No network,
// no venv, no config: a bare .py + a workspace marker in a temp dir, torn down.
// Skip with SKIP_LIVE=1. Nothing in the repo is touched.
//
// Run: node --test --test-concurrency=1 test/blind-v11-pyoracle-live.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { spawnSync } = require("child_process");
const { bundleCore } = require("./.blind-util.cjs");

const SKIP = process.env.SKIP_LIVE === "1" ? "SKIP_LIVE=1" : false;
const LIVE_TIMEOUT = 60_000;
const PYRIGHT = path.join(__dirname, "..", "node_modules", ".bin", "pyright");

let mod = {};
let cleanupBundle = () => {};
let bundleError;
try {
  ({ mod, cleanup: cleanupBundle } = bundleCore(
    "blind-v11-pyoracle-live",
    `export { PyOracle, oracleFor, runOracleCheck } from "../src/core/compilerOracle";\n`
  ));
} catch (e) {
  bundleError = e;
}
if (!bundleError && typeof mod.PyOracle !== "function") {
  bundleError = new Error("the bundle built but exports no PyOracle class");
}
test.after(() => cleanupBundle());

const { PyOracle, oracleFor, runOracleCheck } = mod;

// x: str = "hello" / y = x.no_such_member() / z = undefined_name — the two
// hallucination classes (member-not-found + undefined name) in one file.
const BROKEN_PY = 'x: str = "hello"\ny = x.no_such_member()\nz = undefined_name\n';

const scratch = [];
test.after(() => { for (const d of scratch) fs.rmSync(d, { recursive: true, force: true }); });

const buildFixture = (content = BROKEN_PY) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "blind-v11-live-"));
  scratch.push(dir);
  fs.writeFileSync(path.join(dir, "pyproject.toml"), "[project]\nname = \"fixture\"\n");
  const src = path.join(dir, "gen.py");
  fs.writeFileSync(src, content);
  return { dir, src };
};

// The independent LSP(0-based, UTF-16) -> UTF-8 byte reference (matches the
// unit file's converter).
const lspToByte = (src, line, char) => {
  const lines = src.split("\n");
  let b = 0;
  for (let i = 0; i < line; i++) b += Buffer.byteLength(lines[i], "utf8") + 1;
  return b + Buffer.byteLength(lines[line].slice(0, char), "utf8");
};

// ---------------------------------------------------------------------------
// Rung 1: ground truth. Independent of PyOracle - proves the fixtures are real.
// ---------------------------------------------------------------------------

test(
  "live ground-truth: real pyright --outputjson emits the generalDiagnostics/summary shape the unit fixtures assume [surface: the pyright JSON contract of record]",
  { skip: SKIP, timeout: LIVE_TIMEOUT },
  () => {
    const { src } = buildFixture();
    const r = spawnSync(PYRIGHT, ["--outputjson", src], { encoding: "utf8" });
    assert.ok(r.stdout, `pyright produced stdout (status ${r.status}, stderr ${JSON.stringify((r.stderr || "").slice(0, 200))})`);
    const doc = JSON.parse(r.stdout);

    assert.ok(Array.isArray(doc.generalDiagnostics), "generalDiagnostics is an array");
    const rules = new Set(doc.generalDiagnostics.map((g) => g.rule));
    assert.ok(rules.has("reportAttributeAccessIssue"), `the member hallucination surfaced; got ${JSON.stringify([...rules])}`);
    assert.ok(rules.has("reportUndefinedVariable"), `the undefined name surfaced; got ${JSON.stringify([...rules])}`);

    const attr = doc.generalDiagnostics.find((g) => g.rule === "reportAttributeAccessIssue");
    assert.strictEqual(attr.severity, "error", "the attribute issue is an error");
    assert.strictEqual(attr.file, src, "the JSON `file` is the absolute path we passed");
    assert.strictEqual(attr.range.start.line, 1, "0-based LSP line: the s.no_such_member() line");
    assert.strictEqual(attr.range.start.character, 6, "0-based LSP character of no_such_member");

    assert.strictEqual(doc.summary.filesAnalyzed, 1, "single-file scope: exactly one file analyzed");
    assert.strictEqual(doc.summary.errorCount, 2, "two errors counted");
    assert.strictEqual(r.status, 1, "pyright exits non-zero when errors are present");

    // The unit file's byte-offset assertions rest on this exact mapping.
    assert.strictEqual(lspToByte(BROKEN_PY, 1, 6), 23, "the ground-truth byte offset the unit test recomputes");
  }
);

test(
  "live ground-truth: a clean file yields filesAnalyzed 1 / errorCount 0 / exit 0; an excluded file yields filesAnalyzed 0 (the unearned-green tell) [surface: brief checkSuccess + goal finding 5]",
  { skip: SKIP, timeout: LIVE_TIMEOUT },
  () => {
    const { src } = buildFixture("def f(a: int) -> int:\n    return a\n");
    const clean = JSON.parse(spawnSync(PYRIGHT, ["--outputjson", src], { encoding: "utf8" }).stdout);
    assert.strictEqual(clean.summary.filesAnalyzed, 1);
    assert.strictEqual(clean.summary.errorCount, 0);

    // Exclude the file, then name it on the CLI: analyzed 0 with 0 errors — the
    // green that checkSuccess must REFUSE (errorCount 0 but filesAnalyzed 0).
    const { dir, src: exSrc } = buildFixture(BROKEN_PY);
    fs.writeFileSync(path.join(dir, "pyrightconfig.json"), JSON.stringify({ exclude: ["gen.py"], include: ["gen.py"] }));
    const ex = JSON.parse(spawnSync(PYRIGHT, ["--outputjson", exSrc], { cwd: dir, encoding: "utf8" }).stdout);
    assert.strictEqual(ex.summary.filesAnalyzed, 0, "the excluded file is analyzed 0 times even when named on the CLI");
    assert.strictEqual(ex.summary.errorCount, 0, "and reports 0 errors: filesAnalyzed 0 is the only tell");
  }
);

// ---------------------------------------------------------------------------
// Rung 2: PyOracle end to end over real pyright. RED until the impl lands.
// ---------------------------------------------------------------------------

test(
  "live: runOracleCheck(new PyOracle) over real pyright surfaces the neutral Diagnostic[] with real byte offsets, and fails the verdict [surface: phase2-brief end-to-end falsification]",
  { skip: SKIP, timeout: LIVE_TIMEOUT },
  async () => {
    if (bundleError) assert.fail(`the surface is not implemented yet: ${bundleError.message}`);

    const { dir, src } = buildFixture();
    const oracle = oracleFor("python", { workspaceFolders: [dir] }) || new PyOracle({ workspaceFolders: [dir] });
    assert.ok(oracle instanceof PyOracle, "oracleFor('python') gives a PyOracle");
    assert.strictEqual(oracle.detectCrateRoot(src), dir, "the broken file resolves to its marker dir");

    const lines = [];
    const result = await runOracleCheck(oracle, src, { log: (l) => lines.push(l) });
    assert.ok(result, `a real result resolves (logs: ${JSON.stringify(lines)})`);
    assert.strictEqual(result.success, false, "the broken file fails the verdict");
    assert.strictEqual(result.crateRoot, dir);

    const codes = new Set(result.diagnostics.map((d) => d.code));
    assert.ok(codes.has("reportAttributeAccessIssue"), `the member hallucination surfaced; got ${JSON.stringify([...codes])}`);
    assert.ok(codes.has("reportUndefinedVariable"), `the undefined name surfaced; got ${JSON.stringify([...codes])}`);

    const attr = result.diagnostics.find((d) => d.code === "reportAttributeAccessIssue");
    assert.strictEqual(attr.level, "error");
    assert.strictEqual(attr.kind, "compile-error");
    const s = attr.spans[0];
    assert.strictEqual(s.fileName, src, "the absolute file path rode through");
    assert.strictEqual(s.lineStart, 2, "0-based LSP line 1 -> 1-based lineStart 2");
    assert.strictEqual(s.byteStart, lspToByte(BROKEN_PY, 1, 6), "the byte offset matches a UTF-8 recomputation from the real source");
    assert.ok(s.byteStart > 0, "a real, positive byte offset (not the -1 sentinel)");
  }
);

test(
  "live: runOracleCheck over a clean real file -> success true, no diagnostics [surface: brief checkSuccess earned green]",
  { skip: SKIP, timeout: LIVE_TIMEOUT },
  async () => {
    if (bundleError) assert.fail(`the surface is not implemented yet: ${bundleError.message}`);
    const { dir, src } = buildFixture("def f(a: int) -> int:\n    return a\n");
    const oracle = new PyOracle({ workspaceFolders: [dir] });
    const result = await runOracleCheck(oracle, src, {});
    assert.ok(result, "a real result resolves");
    assert.strictEqual(result.success, true, "a clean file earns the green");
    assert.deepStrictEqual(result.diagnostics, [], "no diagnostics on a clean file");
  }
);
