// Blind oracle: RustOracle strategy decisions + runOracleCheck orchestration
// with an injected fake RunCommandFn (phase4-surface.md "The oracle strategy,
// and the check command shape"). The fake runner replays committed real
// cargo captures from test/fixtures/rustc/. Never read src/**. Expected red
// on stubs.
//
// Run: npm test

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "blind4-oracle-run",
  `export { RustOracle, runOracleCheck } from "../src/core/compilerOracle";\n`
);
const { RustOracle, runOracleCheck } = mod;
test.after(cleanup);

const FIXTURES = path.join(__dirname, "fixtures", "rustc");
const fixture = (name) => fs.readFileSync(path.join(FIXTURES, name), "utf8");

// Virtual filesystem for the crate-root walk: fileExists is injectable via
// RustOracleDeps so the walk tests headless without real crates.
const vfs = (manifestDirs) => {
  const calls = [];
  const fileExists = (p) => {
    calls.push(p);
    return manifestDirs.some((d) => p === path.join(d, "Cargo.toml"));
  };
  return { fileExists, calls };
};

// ---- appliesTo [surface: 'RustOracle answers true exactly for "rust"']

const languageCases = [
  { id: "rust", want: true },
  { id: "Rust", want: false },
  { id: "rs", want: false },
  { id: "rust ", want: false },
  { id: "toml", want: false },
  { id: "javascript", want: false },
  { id: "", want: false },
];
for (const { id, want } of languageCases) {
  test(`appliesTo(${JSON.stringify(id)}) === ${want}`, () => {
    assert.strictEqual(new RustOracle().appliesTo(id), want);
  });
}

// ---- buildCheckCommand [surface: 'exactly { command: "cargo", args: ["check", "--message-format=json"], cwd: crateRoot }']

test("buildCheckCommand is exactly the contracted shape, no --all-targets, cwd is the crate root", () => {
  const cmd = new RustOracle().buildCheckCommand("/w/ws/member");
  assert.deepStrictEqual(cmd, {
    command: "cargo",
    args: ["check", "--message-format=json"],
    cwd: "/w/ws/member",
  });
});

// ---- detectCrateRoot [surface: 'walk parent-ward to the filesystem root; the first directory containing Cargo.toml wins']

test("nearest manifest wins in a workspace: the member scopes the check, not the workspace root", async () => {
  const { fileExists } = vfs(["/w/ws", "/w/ws/member"]);
  const oracle = new RustOracle({ fileExists });
  const root = await oracle.detectCrateRoot("/w/ws/member/src/lib.rs");
  assert.strictEqual(root, "/w/ws/member");
});

test("walk order is parent-ward from the file's directory and stops at the first hit", async () => {
  const { fileExists, calls } = vfs(["/a/b"]);
  const oracle = new RustOracle({ fileExists });
  const root = await oracle.detectCrateRoot("/a/b/c/d/f.rs");
  assert.strictEqual(root, "/a/b");
  assert.deepStrictEqual(calls, [
    path.join("/a/b/c/d", "Cargo.toml"),
    path.join("/a/b/c", "Cargo.toml"),
    path.join("/a/b", "Cargo.toml"),
  ], "starts at the file's directory, walks up, never probes past the hit");
});

test("manifest beside the file wins immediately", async () => {
  const { fileExists } = vfs(["/crate/src"]);
  const root = await new RustOracle({ fileExists }).detectCrateRoot("/crate/src/main.rs");
  assert.strictEqual(root, path.join("/crate", "src"));
});

test("no manifest anywhere up the walk: undefined, silently inapplicable, never an error [surface: 'the oracle is silently inapplicable to a bare file']", async () => {
  const { fileExists, calls } = vfs([]);
  const root = await new RustOracle({ fileExists }).detectCrateRoot("/tmp/loose/file.rs");
  assert.strictEqual(root, undefined);
  assert.ok(calls.length >= 2, "the walk actually ran to the filesystem root");
});

// ---- runOracleCheck orchestration [surface: 'runOracleCheck(oracle, filePath, opts) orchestrates']

const FILE = "/w/crate/src/task1.rs";
const setup = (stdoutFixture, exitCode, { manifestDirs = ["/w/crate"] } = {}) => {
  const { fileExists } = vfs(manifestDirs);
  const oracle = new RustOracle({ fileExists });
  const runnerCalls = [];
  const runCommand = async (cmd) => {
    runnerCalls.push(cmd);
    return { stdout: stdoutFixture, exitCode };
  };
  const lines = [];
  const log = (l) => lines.push(l);
  return { oracle, runCommand, runnerCalls, lines, log };
};

test("compile-error run: cargo exits 101, the promise RESOLVES, diagnostics parsed, success false [surface: 'cargo exits 101 on compile errors and that is this oracle doing its job']", async () => {
  const { oracle, runCommand, runnerCalls, lines, log } = setup(fixture("type-error.json"), 101);
  const result = await runOracleCheck(oracle, FILE, { runCommand, log });
  assert.ok(result, "non-zero exit with parseable diagnostics is a NORMAL resolution");
  assert.strictEqual(result.success, false, "build-finished line says success=false");
  assert.strictEqual(result.diagnostics.length, 1);
  assert.strictEqual(result.diagnostics[0].code, "E0308");
  assert.strictEqual(typeof result.durationMs, "number");
  assert.ok(result.durationMs >= 0);
  // Command shape reaches the runner untouched.
  assert.strictEqual(runnerCalls.length, 1);
  assert.deepStrictEqual(
    { command: runnerCalls[0].command, args: runnerCalls[0].args, cwd: runnerCalls[0].cwd },
    { command: "cargo", args: ["check", "--message-format=json"], cwd: "/w/crate" }
  );
  // Evidence lines [surface: '[oracle] and [repair] line formats, complete list'].
  assert.ok(lines.includes(`[oracle] check crate=/w/crate file=${FILE}`), `got ${JSON.stringify(lines)}`);
  const done = lines.find((l) => l.startsWith("[oracle] check done "));
  assert.ok(done, `a done line was emitted, got ${JSON.stringify(lines)}`);
  assert.match(done, /^\[oracle\] check done ms=\d+ errors=1 warnings=0 success=false$/, "ms renders as integer, counts are over parsed diagnostics by level");
});

test("warnings leave success true; success is not 'diagnostics empty' [surface: 'Warnings leave success true']", async () => {
  const { oracle, runCommand, lines, log } = setup(fixture("warning-only.json"), 0);
  const result = await runOracleCheck(oracle, FILE, { runCommand, log });
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.diagnostics.length, 1, "one warning parsed");
  assert.strictEqual(result.diagnostics[0].level, "warning");
  assert.ok(lines.some((l) => /^\[oracle\] check done ms=\d+ errors=0 warnings=1 success=true$/.test(l)), `got ${JSON.stringify(lines)}`);
});

const strippedOf = (name) =>
  fixture(name)
    .split("\n")
    .filter((l) => !l.includes('"build-finished"'))
    .join("\n");
const successFallbackCases = [
  { name: "killed mid-stream, exit 0", stdout: strippedOf("warning-only.json"), exitCode: 0, want: true },
  { name: "killed mid-stream, exit 101", stdout: strippedOf("type-error.json"), exitCode: 101, want: false },
];
for (const { name, stdout, exitCode, want } of successFallbackCases) {
  test(`success falls back to exitCode===0 when build-finished is missing: ${name} -> ${want} [surface: 'when that line is missing (killed mid-stream), exitCode === 0']`, async () => {
    const { oracle, runCommand, log } = setup(stdout, exitCode);
    const result = await runOracleCheck(oracle, FILE, { runCommand, log });
    assert.strictEqual(result.success, want);
  });
}

test("dedup rides through orchestration: the multi-target capture parses to one warning and the done line counts 1", async () => {
  const { oracle, runCommand, lines, log } = setup(fixture("dedup-warning.json"), 0);
  const result = await runOracleCheck(oracle, FILE, { runCommand, log });
  assert.strictEqual(result.diagnostics.length, 1);
  assert.ok(lines.some((l) => /errors=0 warnings=1 success=true$/.test(l)), `got ${JSON.stringify(lines)}`);
});

test("no crate root: resolves undefined, runner never called, skip logged [surface: 'Resolves undefined when detectCrateRoot misses (logged, skipped)']", async () => {
  const { oracle, runCommand, runnerCalls, lines, log } = setup(fixture("type-error.json"), 101, { manifestDirs: [] });
  const result = await runOracleCheck(oracle, FILE, { runCommand, log });
  assert.strictEqual(result, undefined);
  assert.strictEqual(runnerCalls.length, 0, "nothing spawns without a crate root");
  assert.ok(lines.includes(`[oracle] check skipped: no crate root for ${FILE}`), `got ${JSON.stringify(lines)}`);
});

test("rejects only when the checker could not run: a rejecting runner rejects runOracleCheck and logs the failure [surface: 'Rejects only when the checker could not run']", async () => {
  const { fileExists } = vfs(["/w/crate"]);
  const oracle = new RustOracle({ fileExists });
  const lines = [];
  const runCommand = async () => {
    throw new Error("spawn cargo ENOENT");
  };
  await assert.rejects(
    () => runOracleCheck(oracle, FILE, { runCommand, log: (l) => lines.push(l) }),
    /ENOENT/
  );
  assert.ok(lines.some((l) => l.startsWith("[oracle] check failed: ") && l.includes("ENOENT")), `got ${JSON.stringify(lines)}`);
});

test("garbage stdout from the runner still resolves: fewer diagnostics, never a thrown parser [surface: parse rules 'Garbage tolerance is a guarantee']", async () => {
  const { oracle, runCommand, log } = setup("cargo said something weird\n{not json\n", 0);
  const result = await runOracleCheck(oracle, FILE, { runCommand, log });
  assert.deepStrictEqual(result.diagnostics, []);
  assert.strictEqual(result.success, true, "no build-finished line, exit 0");
});
