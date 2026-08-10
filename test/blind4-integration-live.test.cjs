// Blind oracle: phase-4 live integration bars (phase4-surface.md
// "Integration bars (phase 4 falsification)" + goal falsification bar 4:
// more than 2 repair rounds, or repair attempted from an assertion failure,
// means feature 4 is mis-built).
//
// Every cargo-running test copies test/fixtures/repairbench to a
// per-test scratch dir and mutates the copy; the repo's repairbench is never
// touched [surface: 'Real cargo, scratch copies only']. The live repair
// round drives the surface's stated wiring: RepairSession decides,
// assembleRepairPrompt shapes the bytes, the reply goes through the phase-2
// instruct path (generateInstruct + postprocessInstructOutput; the
// FnGenService.generate hand-off carries no repair-specific casing).
//
// Requires ollama at http://localhost:11434 with qwen3-coder:30b pulled and
// cargo on PATH. Live 30b calls run with numGpu 30 per the carve discipline.
// Skip with SKIP_LIVE=1. Model rounds cost 4-8s each; this file spends at
// most 2 (the structural cap makes a third impossible).
//
// Run: node --test --test-concurrency=1 test/blind4-integration-live.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { spawn } = require("child_process");
const { bundleCore } = require("./.blind-util.cjs");

const SKIP = process.env.SKIP_LIVE === "1" ? "SKIP_LIVE=1" : false;
const LIVE_TIMEOUT = 180_000;

const API_BASE = "http://localhost:11434";
const MODEL = "qwen3-coder:30b";

const { mod, cleanup } = bundleCore(
  "blind4-integration",
  `export { RustOracle, runOracleCheck } from "../src/core/compilerOracle";
export { RepairSession, assembleRepairPrompt, classifyEligibility } from "../src/core/repair";
export { generateInstruct, listModels } from "../src/core/ollama";
export { postprocessInstructOutput } from "../src/core/instructPostprocess";\n`
);
const {
  RustOracle,
  runOracleCheck,
  RepairSession,
  assembleRepairPrompt,
  classifyEligibility,
  generateInstruct,
  listModels,
  postprocessInstructOutput,
} = mod;
test.after(cleanup);

const REPAIRBENCH = path.join(__dirname, "fixtures", "repairbench");
const FIXTURES = path.join(__dirname, "fixtures", "rustc");

// Scratch copy per test; the repo crate is read-only donor material.
const scratchCopy = (tag) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `blind4-${tag}-`));
  fs.cpSync(REPAIRBENCH, dir, { recursive: true });
  return dir;
};

// Real runner: the injectable RunCommandFn backed by a real process spawn.
const realRunner = (exitCodes) => (cmd) =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd.command, cmd.args, { cwd: cmd.cwd });
    let stdout = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", () => {});
    child.on("error", reject);
    child.on("close", (code) => {
      exitCodes.push(code);
      resolve({ stdout, exitCode: code });
    });
  });

const realFs = { fileExists: (p) => fs.existsSync(p) };

// The type breakage proven in fixture capture: one E0308 in parse_duration.
const breakTask1 = (crateDir) => {
  const p = path.join(crateDir, "src", "task1.rs");
  const src = fs.readFileSync(p, "utf8");
  const broken = src.replace('"s" => Some(number),', '"s" => Some("thirty"),');
  assert.notStrictEqual(broken, src, "fixture sanity: the breakage anchor exists in repairbench task1");
  fs.writeFileSync(p, broken);
  return p;
};

// Current parse_duration function text and span in a task1.rs body. The doc
// comment stays outside the spliced span, mirroring the vscode layer.
const fnSlice = (fileText) => {
  const start = fileText.indexOf("pub fn parse_duration");
  assert.ok(start >= 0, "parse_duration present");
  const end = fileText.indexOf("\n}", start) + 2;
  return { start, end, text: fileText.slice(start, end) };
};
const TASK1_DOC = [
  '/// Parses a duration string like "30s", "5m", or "2h" into total seconds.',
  "/// Supports suffixes: 's' (seconds), 'm' (minutes), 'h' (hours).",
  "/// Returns None for empty input, unknown suffixes, or a non-numeric amount.",
].join("\n");

test("precondition: live ollama is up and the fn-gen model is pulled", { skip: SKIP, timeout: LIVE_TIMEOUT }, async () => {
  const tags = await listModels(API_BASE);
  assert.ok(Array.isArray(tags), "server reachable");
  assert.ok(tags.includes(MODEL), `${MODEL} must be pulled; got ${JSON.stringify(tags)}`);
});

test("check-only bar: real cargo check on a scratch copy resolves through exit 101, parses the E0308, emits [oracle] evidence [surface: 'A non-zero exit with parseable diagnostics is a NORMAL resolution']", { skip: SKIP, timeout: LIVE_TIMEOUT }, async () => {
  const crate = scratchCopy("check");
  try {
    const file = breakTask1(crate);
    const exitCodes = [];
    const lines = [];
    const result = await runOracleCheck(new RustOracle(realFs), file, {
      runCommand: realRunner(exitCodes),
      log: (l) => lines.push(l),
    });
    assert.ok(result, "resolved, not rejected");
    assert.deepStrictEqual(exitCodes, [101], "cargo exited 101 on the compile error; the oracle called that normal");
    assert.strictEqual(result.success, false);
    const e0308 = result.diagnostics.filter((d) => d.code === "E0308");
    assert.strictEqual(e0308.length, 1, `one type error, got ${JSON.stringify(result.diagnostics.map((d) => d.code))}`);
    assert.strictEqual(e0308[0].kind, "compile-error");
    assert.strictEqual(e0308[0].spans.find((s) => s.isPrimary).fileName, "src/task1.rs", "fileName is crate-relative to the check's cwd");
    assert.ok(result.durationMs > 0, "spawn-to-parse-complete duration measured");
    assert.ok(lines.includes(`[oracle] check crate=${crate} file=${file}`), `crate detected by the real walk, got ${JSON.stringify(lines)}`);
    assert.ok(lines.some((l) => /^\[oracle\] check done ms=\d+ errors=1 warnings=0 success=false$/.test(l)), `got ${JSON.stringify(lines)}`);
  } finally {
    fs.rmSync(crate, { recursive: true, force: true });
  }
});

test("live repair (contract 4a live): fim session, real cross-model 30b round(s), re-check after every splice, roundsUsed <= 2 structurally, evidence complete", { skip: SKIP, timeout: LIVE_TIMEOUT * 2 }, async () => {
  const crate = scratchCopy("repair");
  try {
    const file = breakTask1(crate);
    const exitCodes = [];
    const oracleLines = [];
    const repairLines = [];
    const oracle = new RustOracle(realFs);
    const doCheck = () =>
      runOracleCheck(oracle, file, { runCommand: realRunner(exitCodes), log: (l) => oracleLines.push(l) });

    const session = new RepairSession("fim", true, (l) => repairLines.push(l));
    let checkResult = await doCheck();
    assert.strictEqual(checkResult.success, false, "the broken FIM-shaped output fails the first check");

    const actions = [];
    let modelCalls = 0;
    let action = session.next(checkResult);
    while (action.kind === "repair") {
      actions.push(action);
      assert.ok(actions.length <= 2, `bar 4: a third repair round happened (round=${action.round})`);
      assert.strictEqual(action.route, actions.length === 1 ? "cross-model" : "self-repair", "fim routing: cross-model once, then self once");

      const current = fnSlice(fs.readFileSync(file, "utf8"));
      const prompt = assembleRepairPrompt({
        languageId: "rust",
        docComment: TASK1_DOC,
        code: current.text,
        diagnostics: action.eligible,
      });
      assert.ok(prompt.includes("The function below failed the compiler check:"), "spike-shaped repair prompt");
      assert.ok(prompt.includes("error[E0308]") || prompt.includes("mismatched types"), "rustc rendered rides into the prompt");

      modelCalls++;
      const reply = await generateInstruct({
        apiBase: API_BASE,
        model: MODEL,
        prompt,
        maxTokens: 512,
        temperature: 0.2,
        numGpu: 30, // carve discipline
        signal: new AbortController().signal,
      });
      const fixed = postprocessInstructOutput(reply.text);
      if (fixed) {
        const now = fs.readFileSync(file, "utf8");
        const span = fnSlice(now);
        fs.writeFileSync(file, now.slice(0, span.start) + fixed + now.slice(span.end));
      }
      checkResult = await doCheck(); // wave semantics: never assume a fixed diagnostic means a clean crate
      action = session.next(checkResult);
    }

    assert.strictEqual(action.kind, "surface");
    assert.ok(["clean", "cap-exhausted"].includes(action.why), `session ended inside the cap, got why=${action.why}`);
    assert.ok(modelCalls >= 1 && modelCalls <= 2, `1-2 model calls, got ${modelCalls}`);
    assert.ok(session.roundsUsed <= 2, `roundsUsed=${session.roundsUsed} escaped the 0|1|2 type`);

    // Evidence: every decision line stays inside round <=2 [surface: contract 4a
    // 'the round counter in [repair] evidence never exceeds 2'].
    const decisions = repairLines.filter((l) => l.startsWith("[repair] decision "));
    assert.strictEqual(decisions.length, actions.length, `one decision line per round, got ${JSON.stringify(repairLines)}`);
    for (const d of decisions) {
      const m = d.match(/round=(\d)\/2 route=(cross-model|self-repair) source=fim/);
      assert.ok(m, `decision line format, got ${d}`);
      assert.ok(Number(m[1]) <= 2);
    }
    assert.ok(repairLines.some((l) => l.startsWith(`[repair] surface why=${action.why} `)), `surface evidence, got ${JSON.stringify(repairLines)}`);
    // The 30b fixing one localized E0308 is the spike-proven case; record it as
    // the expected outcome without weakening the structural bar above.
    if (action.why === "clean") {
      assert.ok(exitCodes[exitCodes.length - 1] === 0, "final check exited 0");
    }
  } finally {
    fs.rmSync(crate, { recursive: true, force: true });
  }
});

test("refuse-assertion (contract 4b, capture replay — the LIVE 4b proof is impl4-integration-live's const-assert case): a real cargo-test panic shape gets zero model calls, reason=assertion-failure logged, why=no-eligible", { skip: SKIP, timeout: LIVE_TIMEOUT }, () => {
  // Diagnostic built from the committed real `cargo test` panic capture
  // (wrong-value task, spike q2 shape). It carries a primary span on purpose:
  // refusal must come from the assertion shape, not from a missing location.
  const panicText = fs.readFileSync(path.join(FIXTURES, "assertion-panic.txt"), "utf8");
  const at = panicText.match(/panicked at (src\/task\d+\.rs):(\d+):(\d+):\n(assertion `left == right` failed\n[^\n]*\n[^\n]*)/);
  assert.ok(at, "fixture sanity: real panic location and assertion text present");
  const [, fileName, line, col, message] = at;
  const diagnostic = {
    kind: "assertion-failure",
    level: "error",
    message,
    spans: [{
      fileName,
      byteStart: 0,
      byteEnd: 0,
      lineStart: Number(line),
      lineEnd: Number(line),
      columnStart: Number(col),
      columnEnd: Number(col),
      isPrimary: true,
    }],
    suggestions: [],
  };
  assert.deepStrictEqual(classifyEligibility(diagnostic), { eligible: false, reason: "assertion-failure" });

  const repairLines = [];
  const session = new RepairSession("fngen", true, (l) => repairLines.push(l));
  let modelCalls = 0;
  const action = session.next({ success: false, diagnostics: [diagnostic], durationMs: 12 });
  // The executor loop only calls a model on kind:"repair"; surface-first means
  // zero calls by construction, observable here as the counter never moving.
  if (action.kind === "repair") modelCalls++;
  assert.strictEqual(modelCalls, 0, "bar 4: repair attempted from an assertion failure");
  assert.strictEqual(action.kind, "surface");
  assert.strictEqual(action.why, "no-eligible");
  assert.strictEqual(session.roundsUsed, 0);
  assert.ok(repairLines.includes("[repair] ineligible code=- reason=assertion-failure"), `contract 4b evidence half, got ${JSON.stringify(repairLines)}`);
  assert.ok(repairLines.includes("[repair] surface why=no-eligible errors=1 warnings=0"), `got ${JSON.stringify(repairLines)}`);
  assert.ok(!repairLines.some((l) => l.startsWith("[repair] decision")), "no routing ever ran");
});
