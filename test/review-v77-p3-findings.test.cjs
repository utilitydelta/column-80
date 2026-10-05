"use strict";

// session-v77 phase 3 adversarial review. Rows named F* FAIL on the phase 3
// tree: each is a finding in session-v77/review-p3.md. Rows named PIN pass on
// the phase 3 tree and go red under the mutation their comment names: they are
// the replacements for two adversarial-v52-p5 rows that phase 3 made vacuous.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { bundleActivation } = require("./.activation-stub.cjs");

const ROOT = path.join(__dirname, "..");
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), "review-v77-p3-"));
process.env.COLUMN80_NATIVE_DIR = SCRATCH;
process.env.COLUMN80_WHISPER_MODEL = path.join(SCRATCH, "missing-base.en.bin");
process.env.COLUMN80_VAD_MODEL = path.join(SCRATCH, "missing-vad.bin");

const built = bundleActivation(
  "review-v77-p3-findings",
  `export { Dictation } from "../src/vscode/dictation";
export { registerTightenDocComment, tightenDocComment } from "../src/vscode/tightenDocComment";
export { runFirstRunFlow } from "../src/vscode/firstRun";
export { window } from "vscode";\n`,
);
const { Dictation, registerTightenDocComment, tightenDocComment, runFirstRunFlow, __state, window } = built.mod;

test.after(() => {
  built.cleanup();
  fs.rmSync(SCRATCH, { recursive: true, force: true });
});

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const setting = (key) => pkg.contributes.configuration.properties[key];
const src = (rel) => fs.readFileSync(path.join(ROOT, "src", rel), "utf8");

// ---------------------------------------------------------------------------
// F1 MED. "which is off on this machine" is false when the tier closed for a
// reason that is not this machine: a cloud backend missing its key, or a remote
// Ollama that did not answer. Both messages come from buildFnGenService
// (fnGen.ts buildCloudFnGenService / the remote arm) and reach Tighten and
// Review Function through the same `tierMessage()`.
// ---------------------------------------------------------------------------

// F1a and F1b drove Tighten's closed-tier toast. session-v77 R2 removed that toast: a closed
// tier re-wraps without the proposer (test/impl-v77-p6-lane3.test.cjs), so no Tighten sentence
// can blame the machine. F1c still holds Review Function to the same rule.

test("F1c: Review Function builds the same sentence (source check, the command needs a resolvable function to reach it)", () => {
  const code = src("vscode/criticizeAdviseCommand.ts");
  assert.ok(
    !code.includes("which is off on this machine"),
    "criticizeAdviseCommand.ts carries the same 'off on this machine' prefix over the same tierMessage()",
  );
});

// ---------------------------------------------------------------------------
// F2 LOW (pre-existing, re-authored by R10). "Tab completion still works." is
// appended without checking that tab completion works. In one first-run pass
// the user can decline the FIM model and then the generation model, and the
// last toast says tab completion still works while its model is not installed.
// ---------------------------------------------------------------------------

test("F2: first run, both downloads declined: no toast says tab completion still works", async () => {
  __state.messages = [];
  __state.config = {};
  const origPick = window.showQuickPick;
  window.showQuickPick = async (items) => items[0];
  const out = { lines: [], appendLine(l) { this.lines.push(String(l)); } };
  try {
    await runFirstRunFlow({ subscriptions: [], globalState: { get() {}, update: async () => {} } }, out, {
      probe: {
        runCommand: async () => ({ stdout: "16303\n", exitCode: 0 }),
        totalMemBytes: () => 61826 * 1048576,
        platformInfo: () => ({ platform: "linux", arch: "x64" }),
      },
      listModels: async () => [],
      pull: async () => {
        throw new Error("no pull expected: both offers are declined");
      },
    });
  } finally {
    window.showQuickPick = origPick;
  }
  assert.ok(out.lines.some((l) => l.includes("pull declined model=qwen2.5-coder")), out.lines.join("\n"));
  const claims = __state.messages.filter((m) => /Tab completion still works/.test(m.message));
  assert.deepEqual(
    claims.map((m) => m.message),
    [],
    "the tab completion model was declined a moment earlier, so tab completion does not work",
  );
});

// ---------------------------------------------------------------------------
// F3 MED. column80.repairEnabled's new description scopes the switch to
// "an accepted generation". oracleSurface.ts reads the same switch on a
// Repair Function Body press: off, the press repairs nothing, runs no covering
// tests and does not compare the function with how the repo uses its calls
// (oracleSurface.ts, the `manualRefine` branches).
// ---------------------------------------------------------------------------

test("F3: repairEnabled's description says it also turns off Repair Function Body's repair", () => {
  const surface = src("vscode/oracleSurface.ts");
  assert.ok(
    /Repair is off \(column80\.repairEnabled\), so its covering tests did not run and it was not compared with how the rest of the repo uses what it calls/.test(surface),
    "precondition: the manual press reads the switch",
  );
  const d = setting("column80.repairEnabled").description;
  assert.match(d, /Repair Function/, `the description only covers the post-generation check: ${d}`);
});

// ---------------------------------------------------------------------------
// F4 LOW. column80.fimUsageExamples now says a slow answer "never delays a
// completion". The usage lookup is awaited inside the injection window
// (completionProvider.ts, `await resolveUsageInBudget(..., INJECTION_DEADLINE_MS - elapsed ...)`)
// before the argument-type lookup and before the model call, so it can hold a
// completion for up to the rest of the 50ms window.
// ---------------------------------------------------------------------------

test("F4: fimUsageExamples does not promise it never delays a completion", () => {
  const code = src("vscode/completionProvider.ts");
  assert.match(code, /const usage = await resolveUsageInBudget\(/, "precondition: the lookup is awaited on the request path");
  const d = setting("column80.fimUsageExamples").description;
  assert.ok(!/never delays/.test(d), `the lookup spends up to the rest of the injection window: ${d}`);
});

// ---------------------------------------------------------------------------
// F5 LOW. `binary-missing` always names this machine's platform and says
// dictation "is not available on it yet". The extension ships a recorder for
// linux-x64 (native/bin/linux-x64), so on that platform a missing binary is a
// broken install or a source build, not a platform the product lacks.
// ---------------------------------------------------------------------------

// Deferred to the human as session-v77 scrap S77-14 (triage-p3 L3): the row stays as evidence, marked todo.
test("F5: a missing recorder on a platform the extension ships for is not called an unsupported platform", { todo: "S77-14" }, (t) => {
  const platform = `${process.platform}-${process.arch}`;
  if (!fs.existsSync(path.join(ROOT, "native", "bin", platform, "column80-capture"))) {
    return t.skip(`no recorder ships for ${platform}; the sentence is true here`);
  }
  const statusMessages = [];
  const orig = window.setStatusBarMessage;
  window.setStatusBarMessage = (text) => {
    statusMessages.push(String(text));
    return { dispose() {} };
  };
  __state.config = { "dictation.muteSpeakers": false, "dictation.partials": false };
  const context = { extensionPath: SCRATCH, subscriptions: [], globalStorageUri: { fsPath: SCRATCH } };
  const d = new Dictation(context, { appendLine() {}, append() {} }, { armIntent() {} });
  try {
    d.state = { phase: "recording", site: { uri: "file:///w/a.ts", line: 0 }, languageId: "typescript", indentColumns: 0, pressedAt: Date.now() };
    d.dispatch({ type: "stopped", pcmBytes: 0, failure: "binary-missing", stderr: "" });
  } finally {
    d.dispose();
    window.setStatusBarMessage = orig;
  }
  assert.equal(statusMessages.length, 1, JSON.stringify(statusMessages));
  assert.ok(
    !statusMessages[0].includes(`not available on ${platform} yet`),
    `${platform} ships a recorder; the install is what is missing it: ${statusMessages[0]}`,
  );
});

// ---------------------------------------------------------------------------
// PIN rows. adversarial-v52-p5 D6 checks the row for "not currently injected"
// and D6b checks `review.notes[0]` for "~0 tok". Phase 3 moved both phrases off
// the review, so both rows pass whatever the code does. Proved by mutation:
// `if (measured)` -> `if (true)` in consequenceOf, and budgetLine printing
// `~${surface ?? 0} tok` when nothing was measured, leave adversarial-v52-p5
// and impl-v52-p5-command fully green. These two rows go red under each.
// ---------------------------------------------------------------------------

function makeDoc(text, uriStr, languageId) {
  const lines = text.split("\n");
  const offsetAt = (p) => {
    let o = 0;
    for (let i = 0; i < Math.min(p.line, lines.length); i++) o += lines[i].length + 1;
    return Math.min(o + p.character, text.length);
  };
  const positionAt = (off) => {
    let o = 0;
    for (let l = 0; l < lines.length; l++) {
      if (off <= o + lines[l].length) return { line: l, character: off - o };
      o += lines[l].length + 1;
    }
    return { line: lines.length - 1, character: 0 };
  };
  return {
    languageId,
    version: 1,
    isClosed: false,
    uri: { toString: () => uriStr, fsPath: uriStr, path: uriStr },
    offsetAt,
    positionAt,
    getText: (r) => (r ? text.slice(offsetAt(r.start), offsetAt(r.end)) : text),
    lineAt: (l) => ({ text: lines[l] }),
  };
}

async function tightenWithoutPrefill() {
  const text =
    "// this walker keeps a shard mem cache for each of the client sets and drops every entry it can prove is stale\n" +
    "export function walk() {}\n";
  const ws = [{ name: "ShardMemCache", kind: 4, path: "/repo/src/core/shardMemCache.ts" }];
  const logs = [];
  let seen;
  const wiring = {
    presenter: { confirmDiff: async () => "accept" },
    resolveFunction: async () => undefined,
    resolvePrefill: async () => undefined,
    prefillLangFor: () => ({ localTypeDefs: () => new Map(), typeReference: () => undefined }),
    extractorFor: () => undefined,
    transport: () => async () => ({ text: "shard mem cache\n", ttftMs: 1, totalMs: 2 }),
    modelTag: () => "test-model",
  };
  const deps = {
    querySymbols: async (q) => ws.filter((s) => s.name.toLowerCase().includes(String(q).toLowerCase().replace(/[^a-z]/g, "").slice(0, 6))),
    fileExists: (p) => p === "/repo/package.json" || ws.some((s) => s.path === p),
    readFile: (p) => (p === "/repo/package.json" ? '{"name":"repo"}' : undefined),
    workspaceRoot: () => "/repo",
    config: () => ({ apiBase: "http://localhost:11434", model: "m", fallbackModel: "x", maxTokens: 2048, temperature: 0, numCtx: 16384 }),
    windowed: () => true,
    review: async (r) => {
      seen = r;
      return [];
    },
    applyEdit: async () => true,
    warn: () => {},
  };
  await tightenDocComment(makeDoc(text, "/repo/src/walk.ts", "typescript"), { line: 0, character: 20 }, (l) => logs.push(l), wiring, deps);
  return { logs, review: seen };
}

test("PIN (replaces adversarial-v52-p5 D6): with no pre-fill, no row says what the model sees", async () => {
  const { review } = await tightenWithoutPrefill();
  assert.ok(review && review.rows.length > 0, "precondition: the run reaches the review with a row");
  for (const row of review.rows) {
    assert.ok(!/does not see this type/.test(row.detail), `nothing was measured, yet the row says: ${row.detail}`);
  }
});

test("PIN (replaces adversarial-v52-p5 D6b): with no pre-fill, the budget line does not read as a measured zero", async () => {
  const { logs } = await tightenWithoutPrefill();
  const budget = logs.find((l) => l.startsWith("[tighten] budget"));
  assert.ok(budget, `precondition: the budget line is on the channel: ${logs.join("\n")}`);
  assert.ok(!/~0 tok/.test(budget), `"~0 tok" is an empty prompt, not an unmeasured one: ${budget}`);
});
