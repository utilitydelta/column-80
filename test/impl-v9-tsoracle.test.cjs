// Implementer oracles for the phase 2 review fixes (rounds 1 and 2): the
// crateRoot-first read order, BOM and UTF-16 byte-offset math, the coverage
// probe's fail-open on a crashed probe, the unplaced-span human message,
// and the failed-with-no-diagnostics evidence line. Each pins a fix the
// blind suites do not cover from their side of the seam.
//
// Run: SKIP_LIVE=1 node --test test/impl-v9-tsoracle.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-v9-tsoracle",
  `export { TsOracle, RustOracle, runOracleCheck } from "../src/core/compilerOracle";\n` +
    `export { spanScopedVerdict, spanScopedMessage } from "../src/core/repair";\n`,
);
const { TsOracle, RustOracle, runOracleCheck, spanScopedVerdict, spanScopedMessage } = mod;
test.after(cleanup);

test("a relative tsc path unreadable from the process cwd resolves against crateRoot", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "c80-tsroot-"));
  try {
    fs.mkdirSync(path.join(root, "src"));
    // 10 ASCII chars before line 2; the error is at line 2, col 7.
    fs.writeFileSync(path.join(root, "src", "app.ts"), "// header\nconst n: number = \"x\";\n");
    const oracle = new TsOracle();
    const stdout = 'src/app.ts(2,7): error TS2322: Type \'string\' is not assignable to type \'number\'.\n';
    const [d] = oracle.parseCheckOutput(stdout, root);
    assert.strictEqual(d.code, "TS2322");
    // byte offset = "// header\n" (10) + "const " (6) = 16
    assert.strictEqual(d.spans[0].byteStart, 16, "byte offset computed through the crateRoot-joined read");
    assert.strictEqual(d.spans[0].byteEnd, 16);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("without crateRoot the unreadable relative path degrades to -1, never a guess", () => {
  const oracle = new TsOracle();
  const [d] = oracle.parseCheckOutput('src/nope.ts(1,1): error TS2322: x\n');
  assert.strictEqual(d.spans[0].byteStart, -1, "unknown position can never test in-scope");
});

test("read order: the crateRoot copy wins over a same-named decoy at the as-printed path", () => {
  const reads = [];
  const oracle = new TsOracle({
    readFile: (p) => {
      reads.push(p);
      if (p === path.join("/proj", "src", "app.ts")) {
        return "const x = 1;\n";
      }
      if (p === path.join("src", "app.ts")) {
        return "// decoy at the process cwd, longer prefix\nconst x = 1;\n";
      }
      return undefined;
    },
  });
  const [d] = oracle.parseCheckOutput("src/app.ts(1,7): error TS2322: x\n", "/proj");
  assert.strictEqual(d.spans[0].byteStart, 6, "offset from the crateRoot copy");
  assert.ok(!reads.includes(path.join("src", "app.ts")), "the decoy is never read");
});

test("a BOM'd file converts to the same offsets tsc's stripped columns describe", () => {
  const oracle = new TsOracle({
    readFile: () => "\uFEFFconst n: number = \"x\";\n",
  });
  const [d] = oracle.parseCheckOutput("app.ts(1,7): error TS2322: x\n", "/p");
  // col 7 on the BOM-stripped line: "const " = 6 bytes, not 9 (BOM counted).
  assert.strictEqual(d.spans[0].byteStart, 6);
});

test("the default readFile decodes a UTF-16LE source instead of producing wrong offsets", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "c80-utf16-"));
  try {
    fs.writeFileSync(path.join(root, "app.ts"), Buffer.from("\uFEFFconst n: number = \"x\";\n", "utf16le"));
    const [d] = new TsOracle().parseCheckOutput("app.ts(1,7): error TS2322: x\n", root);
    assert.strictEqual(d.spans[0].byteStart, 6, "decoded via the UTF-16LE BOM, offsets in UTF-8 of the decoded text");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a tsc column past the line's end -> -1, never a spill into the next line (autosave-race twin of past-EOF)", () => {
  // Disk is shorter than what tsc analyzed (the autosave race): line 1 is "ab"
  // (2 chars) but the reported column is 50. The offset must REFUSE (-1), not
  // slice past the newline and hand out a byte inside line 2.
  const oracle = new TsOracle({ readFile: () => "ab\ncd\n" });
  const [d] = oracle.parseCheckOutput("app.ts(1,50): error TS2322: x\n", "/p");
  assert.strictEqual(d.spans[0].byteStart, -1, "column past line end refuses, not a next-line spill");
});

// ---- The coverage probe fails OPEN when it crashed, CLOSED only on a real answer

const probeExists = (root) => (p) =>
  p === path.join(root, "tsconfig.json") || p === path.join(root, "node_modules", "typescript", "bin", "tsc");

test("a crashed probe (non-zero exit, empty stdout) fails open with evidence; the check still runs", async () => {
  const root = path.join(path.sep, "probe-crash");
  const oracle = new TsOracle({ fileExists: probeExists(root), readFile: () => undefined });
  const commands = [];
  const lines = [];
  const result = await runOracleCheck(oracle, path.join(root, "app.ts"), {
    log: (l) => lines.push(l),
    runCommand: async (cmd) => {
      commands.push(cmd.args);
      // First call is the probe: crash shape (node MODULE_NOT_FOUND).
      return commands.length === 1 ? { stdout: "", exitCode: 1 } : { stdout: "", exitCode: 0 };
    },
  });
  assert.ok(lines.some((l) => l.includes("coverage probe failed (exit 1)")), `evidence line, got ${JSON.stringify(lines)}`);
  assert.ok(!lines.some((l) => l.includes("is not an input of")), "a crash is never read as absence");
  assert.strictEqual(commands.length, 2, "the check ran after the failed probe");
  assert.strictEqual(result?.success, true);
});

test("a failed-open assumption is never cached: the crashed probe re-runs next accept, an answered probe does not", async () => {
  const isProbe = (args) => args.includes("--listFilesOnly");
  const runTwice = async (root, probeResult) => {
    const oracle = new TsOracle({ fileExists: probeExists(root), readFile: () => undefined });
    const file = path.join(root, "app.ts");
    let probes = 0;
    const runCommand = async (cmd) => {
      if (isProbe(cmd.args)) {
        probes += 1;
        return probeResult(file);
      }
      return { stdout: "", exitCode: 0 };
    };
    await runOracleCheck(oracle, file, { runCommand });
    await runOracleCheck(oracle, file, { runCommand });
    return probes;
  };
  const crashed = await runTwice(path.join(path.sep, "probe-uncached"), () => ({ stdout: "", exitCode: 1 }));
  assert.strictEqual(crashed, 2, "a crashed probe earns no cache entry, so the next accept probes again");
  const answered = await runTwice(path.join(path.sep, "probe-cached"), (file) => ({ stdout: `${file}\n`, exitCode: 0 }));
  assert.strictEqual(answered, 1, "an answered positive is cached; the second accept skips the probe");
});

// ---- Do-7: unplaced (-1) spans in the human verdict message

const errAt = (fileName, byteStart) => ({
  kind: "compile-error",
  level: "error",
  message: "x",
  suggestions: [],
  spans: [{ fileName, byteStart, byteEnd: byteStart, lineStart: 1, lineEnd: 1, columnStart: 1, columnEnd: 1, isPrimary: true }],
});
const SCOPE = { filePath: "/p/a.ts", crateRoot: "/p", byteStart: 100, byteEnd: 200, resolvePath: (r, f) => `${r}/${f}` };

test("all-unplaced: the message drops the geometry claim and names no file", () => {
  const verdict = spanScopedVerdict([errAt("a.ts", -1)], SCOPE);
  assert.strictEqual(verdict.kind, "clean-out-of-span");
  assert.strictEqual(verdict.unplaced, 1);
  assert.deepStrictEqual(verdict.outOfSpanFiles, [], "-1 carries no geometry, so no file is named");
  const msg = spanScopedMessage(verdict, "f");
  assert.ok(!msg.includes("outside the touched span"), `no geometry claim, got: ${msg}`);
  assert.ok(msg.includes("could not be located"), msg);
});

test("mixed placed+unplaced: placed count and files only, plus an unplaced tail", () => {
  const verdict = spanScopedVerdict([errAt("b.ts", 500), errAt("a.ts", -1)], SCOPE);
  assert.strictEqual(verdict.unplaced, 1);
  assert.deepStrictEqual(verdict.outOfSpanFiles, ["/p/b.ts"]);
  const msg = spanScopedMessage(verdict, "f");
  assert.ok(msg.includes("1 error remains outside the touched span, in b.ts"), msg);
  assert.ok(msg.includes("(+1 not precisely located)"), msg);
});

test("a span-less error keeps its old shape: out of span, not unplaced, message byte-identical", () => {
  const spanless = { kind: "compile-error", level: "error", message: "aborting", suggestions: [], spans: [] };
  const verdict = spanScopedVerdict([spanless], SCOPE);
  assert.strictEqual(verdict.unplaced, 0, "no primaries means nothing to place, not an unplaced conversion");
  assert.strictEqual(
    spanScopedMessage(verdict, "f"),
    "no error landed inside `f`; 1 error remains outside the touched span",
  );
});

// ---- Do-8: a failed check with zero diagnostics logs its stderr reason

test("failed-with-no-diagnostics logs the first stderr line; a diagnosed failure does not", async () => {
  const oracle = new RustOracle({ fileExists: (p) => p === path.join("/w", "Cargo.toml") });
  const run = async (stdout, stderr) => {
    const lines = [];
    await runOracleCheck(oracle, path.join("/w", "src", "lib.rs"), {
      log: (l) => lines.push(l),
      runCommand: async () => ({ stdout, stderr, exitCode: 101 }),
    });
    return lines;
  };
  const bare = await run("", "node:internal/modules/cjs/loader:1: MODULE_NOT_FOUND\n  at x\n");
  assert.ok(
    bare.some((l) => l.includes("check failed with no diagnostics: node:internal/modules/cjs/loader:1: MODULE_NOT_FOUND")),
    JSON.stringify(bare),
  );
  const rustcLine = JSON.stringify({
    reason: "compiler-message",
    message: { level: "error", message: "boom", code: null, spans: [], children: [] },
  });
  const diagnosed = await run(rustcLine + "\n", "progress noise\n");
  assert.ok(!diagnosed.some((l) => l.includes("check failed with no diagnostics")), "a diagnosed failure carries its own evidence");
});
