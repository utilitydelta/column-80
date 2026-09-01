// Implementer live oracle: phase-4 repair scenarios the blind live file
// does not cover, driven through the REAL seam — FnGenService.generateRaw
// (ruling 5) — instead of raw generateInstruct:
//
// 1. fngen self-repair: one real 30b round on its "own" failing output,
//    ending clean or route-exhausted, never a second round.
// 2. span scope (P4-F3 live): errors outside the accepted function never
//    reach a model — zero calls when nothing in-span is broken, and an
//    in-span repair leaves the unrelated fault surfaced, never repaired.
// 3. const-assert refusal (contract 4b live): a REAL cargo check run on a
//    const-assert breakage produces the E0080 evaluation-panicked assertion
//    and the session refuses it with zero model calls — the live half of
//    4b; the blind file's 4b test replays a committed capture.
//
// All splice through the same fn-slice mechanics as the blind live test,
// and every session decision is scoped to the driven function's byte span,
// mirroring the executor.
// Requires ollama at http://localhost:11434 with qwen3-coder:30b pulled and
// cargo on PATH; numGpu 30 per the carve discipline. Skip with SKIP_LIVE=1.
// Runs at the END of the test:live serial list (ruling 6): cargo checks are
// CPU-bound, and ordering them after the TTFT/boundary files keeps those
// gates free of contention.
//
// Run: node --test --test-concurrency=1 test/impl4-integration-live.test.cjs

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
  "impl4-integration",
  `export { RustOracle, runOracleCheck } from "../src/core/compilerOracle";
export { RepairSession, assembleRepairPrompt } from "../src/core/repair";
export { FnGenService } from "../src/core/fnGenService";
export { listModels } from "../src/core/ollama";\n`
);
const { RustOracle, runOracleCheck, RepairSession, assembleRepairPrompt, FnGenService, listModels } = mod;
test.after(cleanup);

const REPAIRBENCH = path.join(__dirname, "fixtures", "repairbench");
const scratchCopy = (tag) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `impl4live-${tag}-`));
  fs.cpSync(REPAIRBENCH, dir, { recursive: true });
  return dir;
};

const realRunner = (cmd) =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd.command, cmd.args, { cwd: cmd.cwd });
    let stdout = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", () => {});
    child.on("error", reject);
    child.on("close", (code) => resolve({ stdout, exitCode: code }));
  });

const breakTask1 = (crate) => {
  const p = path.join(crate, "src", "task1.rs");
  const src = fs.readFileSync(p, "utf8");
  const broken = src.replace('"s" => Some(number),', '"s" => Some("thirty"),');
  assert.notStrictEqual(broken, src, "fixture sanity: breakage anchor present");
  fs.writeFileSync(p, broken);
  return p;
};

const fnSlice = (fileText, name) => {
  const start = fileText.indexOf(`pub fn ${name}`);
  assert.ok(start >= 0, `${name} present`);
  const end = fileText.indexOf("\n}", start) + 2;
  return { start, end, text: fileText.slice(start, end) };
};

const TASK1_DOC = [
  '/// Parses a duration string like "30s", "5m", or "2h" into total seconds.',
  "/// Supports suffixes: 's' (seconds), 'm' (minutes), 'h' (hours).",
  "/// Returns None for empty input, unknown suffixes, or a non-numeric amount.",
].join("\n");

const newService = (lines) =>
  new FnGenService(
    { apiBase: API_BASE, model: MODEL, fallbackModel: "x", maxTokens: 512, temperature: 0.2, numGpu: 30, numCtx: 16384 },
    undefined, // the real generateInstruct: this IS the seam under test
    (l) => lines.push(l),
  );

// The executor loop distilled: session decides, generateRaw produces under
// the shared guards, splice lands, re-check feeds back (wave semantics).
async function driveSession(source, file, fnName, docComment, lines) {
  const oracle = new RustOracle();
  const service = newService(lines);
  const session = new RepairSession(source, true, (l) => lines.push(l));
  const log = (l) => lines.push(l);
  let modelCalls = 0;
  const actions = [];

  // Byte scope over the driven function, recomputed per decision because
  // every splice moves bytes — exactly what the executor does (P4-F3).
  const scopeNow = () => {
    const text = fs.readFileSync(file, "utf8");
    const s = fnSlice(text, fnName);
    return {
      filePath: file,
      crateRoot: path.dirname(path.dirname(file)), // <crate>/src/<file>.rs
      byteStart: Buffer.byteLength(text.slice(0, s.start)),
      byteEnd: Buffer.byteLength(text.slice(0, s.end)),
    };
  };

  let check = await runOracleCheck(oracle, file, { runCommand: realRunner, log });
  let action = session.next(check, scopeNow());
  while (action.kind === "repair") {
    actions.push(action);
    const current = fnSlice(fs.readFileSync(file, "utf8"), fnName);
    const prompt = assembleRepairPrompt({
      languageId: "rust",
      docComment,
      code: current.text,
      diagnostics: action.eligible,
    });
    modelCalls++;
    let result;
    try {
      result = await service.generateRaw(prompt, { docComment, span: { start: current.start, end: current.end } });
    } catch {
      result = undefined; // guard rejection: round consumed, nothing splices
    }
    if (result) {
      const now = fs.readFileSync(file, "utf8");
      const span = fnSlice(now, fnName);
      fs.writeFileSync(file, now.slice(0, span.start) + result.text + now.slice(span.end));
    }
    check = await runOracleCheck(oracle, file, { runCommand: realRunner, log });
    action = session.next(check, scopeNow());
  }
  return { action, actions, modelCalls, session };
}

test("precondition: live ollama is up and the fn-gen model is pulled", { skip: SKIP, timeout: LIVE_TIMEOUT }, async () => {
  const tags = await listModels(API_BASE);
  assert.ok(Array.isArray(tags), "server reachable");
  assert.ok(tags.includes(MODEL), `${MODEL} must be pulled`);
});

test("fngen self-repair through generateRaw: one real 30b round, never two, evidence rides the shared [fngen] pipeline", { skip: SKIP, timeout: LIVE_TIMEOUT * 2 }, async () => {
  const crate = scratchCopy("selfrepair");
  try {
    const file = breakTask1(crate);
    const lines = [];
    const { action, modelCalls, session } = await driveSession("fngen", file, "parse_duration", TASK1_DOC, lines);

    assert.strictEqual(modelCalls, 1, "fngen routing allows exactly one self-repair round");
    assert.strictEqual(session.roundsUsed, 1);
    assert.strictEqual(action.kind, "surface");
    assert.ok(["clean", "route-exhausted"].includes(action.why), `inside the table, got why=${action.why}`);
    assert.ok(
      lines.some((l) => /^\[repair\] decision round=1\/2 route=self-repair source=fngen eligible=\d+$/.test(l)),
      `got ${JSON.stringify(lines.filter((l) => l.startsWith("[repair]")))}`,
    );
    assert.ok(
      lines.some((l) => /^\[fngen\] gen model=qwen3-coder:30b promptBytes=\d+ blocks=- span=\d+-\d+$/.test(l)),
      `the round went through the FnGenService raw path, got ${JSON.stringify(lines.filter((l) => l.startsWith("[fngen]")))}`,
    );
    assert.ok(!lines.some((l) => /decision round=2/.test(l)), "no second round exists for fngen source");
  } finally {
    fs.rmSync(crate, { recursive: true, force: true });
  }
});

test("span scope A (P4-F3 live): only an unrelated file is broken -> ZERO model calls, why=no-eligible-in-span, out-of-span refusal logged", { skip: SKIP, timeout: LIVE_TIMEOUT }, async () => {
  const crate = scratchCopy("scope0");
  try {
    const file = path.join(crate, "src", "task1.rs"); // parse_duration is untouched and correct
    const task3 = path.join(crate, "src", "task3.rs");
    const t3 = fs.readFileSync(task3, "utf8");
    const brokenT3 = t3.replace("pub fn", "pub fnn");
    assert.notStrictEqual(brokenT3, t3, "fixture sanity: task3 anchor present");
    fs.writeFileSync(task3, brokenT3);

    const lines = [];
    const { action, modelCalls, session } = await driveSession("fim", file, "parse_duration", TASK1_DOC, lines);

    assert.strictEqual(modelCalls, 0, "P4-F3: an unrelated pre-existing error never reaches a model");
    assert.strictEqual(session.roundsUsed, 0);
    assert.strictEqual(action.kind, "surface");
    assert.strictEqual(action.why, "no-eligible-in-span");
    assert.ok(action.diagnostics.some((d) => d.level === "error"), "the unrelated fault still reaches the human");
    assert.ok(lines.some((l) => /^\[repair\] ineligible code=.+ reason=out-of-span$/.test(l)), `got ${JSON.stringify(lines.filter((l) => l.startsWith("[repair]")))}`);
    assert.ok(lines.some((l) => l.startsWith("[repair] surface why=no-eligible-in-span ")), `got ${JSON.stringify(lines.filter((l) => l.startsWith("[repair]")))}`);
    assert.ok(!lines.some((l) => l.startsWith("[repair] decision")), "no routing decision ever fired");
  } finally {
    fs.rmSync(crate, { recursive: true, force: true });
  }
});

test("span scope B (P4-F3 live): in-span error repaired by a real 30b round, unrelated error survives un-repaired and ends the session in-span-honestly", { skip: SKIP, timeout: LIVE_TIMEOUT * 3 }, async () => {
  const crate = scratchCopy("scopeB");
  try {
    const file = breakTask1(crate); // in-span E0308 inside parse_duration
    const task3 = path.join(crate, "src", "task3.rs");
    fs.writeFileSync(task3, fs.readFileSync(task3, "utf8").replace("pub fn", "pub fnn"));

    const lines = [];
    const { action, actions, modelCalls, session } = await driveSession("fim", file, "parse_duration", TASK1_DOC, lines);

    assert.ok(modelCalls >= 1 && modelCalls <= 2, `in-span repair ran within the cap, got ${modelCalls}`);
    assert.ok(session.roundsUsed <= 2);
    for (const a of actions) {
      for (const d of a.eligible) {
        const primary = d.spans.find((s) => s.isPrimary);
        assert.strictEqual(primary.fileName, "src/task1.rs", `bar P4-F3: a repair round saw an out-of-span diagnostic: ${JSON.stringify(d.code)}`);
      }
    }
    assert.strictEqual(action.kind, "surface");
    assert.ok(["no-eligible-in-span", "cap-exhausted"].includes(action.why), `session ends without ever looping onto the unrelated fault, got why=${action.why}`);
    assert.ok(action.diagnostics.some((d) => d.level === "error"), "the unrelated fault is still surfaced at the end");
    assert.ok(lines.some((l) => /reason=out-of-span$/.test(l)), "the unrelated fault's refusal is on the record");
    for (const d of lines.filter((l) => l.startsWith("[repair] decision"))) {
      assert.ok(/round=[12]\/2/.test(d), `bar 4: evidence shows a round outside 1-2: ${d}`);
    }
  } finally {
    fs.rmSync(crate, { recursive: true, force: true });
  }
});

test("const-assert refusal (contract 4b LIVE): real cargo check on a const-assert breakage -> E0080 refused, zero model calls", { skip: SKIP, timeout: LIVE_TIMEOUT }, async () => {
  const crate = scratchCopy("constassert");
  try {
    const file = path.join(crate, "src", "task1.rs");
    // The breakage cargo check itself executes: const evaluation panics on
    // the assert, producing the E0080 evaluation-panicked assertion family.
    fs.appendFileSync(file, "\npub const MIN_UNITS: usize = 0;\nconst _: () = assert!(MIN_UNITS > 0);\n");

    const lines = [];
    const { action, modelCalls, session } = await driveSession("fngen", file, "parse_duration", TASK1_DOC, lines);

    assert.strictEqual(modelCalls, 0, "bar 4: repair attempted from an assertion failure");
    assert.strictEqual(session.roundsUsed, 0);
    assert.strictEqual(action.kind, "surface");
    assert.strictEqual(action.why, "no-eligible", "assertion refusal, not span refusal, is the honest why");
    assert.ok(action.diagnostics.some((d) => d.code === "E0080"), `the const-eval failure surfaced, got ${JSON.stringify(action.diagnostics.map((d) => d.code))}`);
    assert.ok(lines.includes("[repair] ineligible code=E0080 reason=assertion-failure"), `contract 4b evidence, got ${JSON.stringify(lines.filter((l) => l.startsWith("[repair]")))}`);
    assert.ok(!lines.some((l) => l.startsWith("[repair] decision")), "no routing ever ran");
  } finally {
    fs.rmSync(crate, { recursive: true, force: true });
  }
});
