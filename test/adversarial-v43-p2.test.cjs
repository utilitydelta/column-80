// Adversarial review, session-v43 phase 2 (the vscode wiring).
//
// Every row here is an ATTACK on src/vscode/fnGen.ts's claude-code arm,
// src/vscode/config.ts's readCloudConfig branch, and the registerFnGen call
// site. Rows are named for the property they assert; a RED row is a defect
// claim with evidence, not a style opinion.
//
// Nothing here spawns a real `claude`. The PATH probe is either injected
// (`deps.run`) or answered by a fake shim, and the only round ever driven goes
// to that shim.
//
// Run: SKIP_LIVE=1 node --test test/adversarial-v43-p2.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const esbuild = require("esbuild");

const REPO = path.join(__dirname, "..");

const tmpDirs = [];
function tmpDir(prefix) {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  tmpDirs.push(d);
  return d;
}
test.after(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// bundle src/vscode/* against a stub `vscode` (same mechanism as the oracles)
// ---------------------------------------------------------------------------

const STUB = path.join(__dirname, ".adv-v43-p2-stub.cjs");
fs.writeFileSync(
  STUB,
  `
const state = { config: {}, configInfo: {}, updates: [], messages: [], infoResponses: [], warnResponses: [], errorResponses: [], opened: [], quickPickImpl: null, commands: {}, terminals: [] };
class EventEmitter {
  constructor() { this.handlers = []; }
  get event() { return (fn) => { this.handlers.push(fn); return { dispose() {} }; }; }
  fire(x) { for (const h of this.handlers) h(x); }
  dispose() {}
}
module.exports = {
  __state: state,
  EventEmitter,
  ProgressLocation: { Notification: 15, Window: 10 },
  ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
  SymbolKind: { Function: 11, Method: 5, Constructor: 8 },
  ThemeColor: class { constructor(id) { this.id = id; } },
  workspace: {
    getConfiguration: () => ({
      get: (key, fallback) => (key in state.config ? state.config[key] : fallback),
      inspect: (key) => state.configInfo[key],
      update: async (key, value, target) => { state.updates.push({ key, value, target }); state.config[key] = value; },
    }),
    inspect: (key) => state.configInfo[key],
    onDidChangeConfiguration: () => ({ dispose() {} }),
    registerTextDocumentContentProvider: () => ({ dispose() {} }),
  },
  window: {
    showInformationMessage: async (message, ...actions) => { state.messages.push({ kind: "info", message, actions }); return state.infoResponses.shift(); },
    showWarningMessage: async (message, ...actions) => { state.messages.push({ kind: "warn", message, actions }); return state.warnResponses.shift(); },
    showErrorMessage: async (message, ...actions) => { state.messages.push({ kind: "error", message, actions }); return state.errorResponses.shift(); },
    showQuickPick: async (items, opts) => (state.quickPickImpl ? state.quickPickImpl(items, opts) : undefined),
    withProgress: async (opts, task) => task({ report: () => {} }, { onCancellationRequested: () => ({ dispose() {} }) }),
    createTerminal: (opts) => { const t = { name: opts.name, shown: false, sent: [], show() { this.shown = true; }, sendText(s) { this.sent.push(s); } }; state.terminals.push(t); return t; },
    get terminals() { return state.terminals; },
    tabGroups: { all: [], onDidChangeTabs: () => ({ dispose() {} }), close: async () => {} },
  },
  commands: { registerCommand: (id, fn) => { state.commands[id] = fn; return { dispose() {} }; } },
  env: { openExternal: async (uri) => { state.opened.push(String(uri)); return true; } },
  Uri: { parse: (s) => s, file: (s) => ({ fsPath: s, toString: () => s }) },
};
`
);

const entry = path.join(__dirname, ".adv-v43-p2.entry.ts");
const outfile = path.join(__dirname, ".adv-v43-p2.bundle.cjs");
fs.writeFileSync(
  entry,
  `export { readCloudConfig, readFnGenConfig, readConfig } from "../src/vscode/config";
export { buildFnGenService } from "../src/vscode/fnGen";
export { DEFAULT_FNGEN_CONFIG } from "../src/core/config";
export { __state } from "vscode";\n`
);
esbuild.buildSync({
  entryPoints: [entry],
  bundle: true,
  outfile,
  format: "cjs",
  platform: "node",
  alias: { vscode: STUB },
});
const { readCloudConfig, readFnGenConfig, readConfig, buildFnGenService, DEFAULT_FNGEN_CONFIG, __state } =
  require(outfile);
test.after(() => {
  fs.rmSync(entry, { force: true });
  fs.rmSync(outfile, { force: true });
  fs.rmSync(STUB, { force: true });
});

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const resetState = () => {
  __state.config = {};
  __state.configInfo = {};
  __state.messages = [];
};

const output = () => {
  const lines = [];
  return { lines, appendLine: (l) => lines.push(l) };
};

async function build({ deps } = {}) {
  const out = output();
  const log = [];
  const built = await buildFnGenService(out, (l) => log.push(l), undefined, deps);
  return { ...built, out, log };
}

/** A `run` seam that answers the PATH probe however the row needs, and records
 *  every invocation so "the probe never generates" is assertable. */
function fakeRun(result) {
  const calls = [];
  const fn = async (command, args) => {
    calls.push({ command, args });
    if (typeof result === "function") return result(command, args);
    return result;
  };
  fn.calls = calls;
  return fn;
}
const PRESENT = { stdout: "2.1.224 (Claude Code)\n", exitCode: 0 };

// The contract's C3 message battery, verbatim.
const MSG = {
  "no-storage-path":
    "Function generation is disabled: the Claude Code backend has no product-owned directory to run in. FIM tab-completion still works.",
  "binary-missing":
    "Function generation is disabled: the Claude Code backend needs the `claude` CLI on PATH. FIM tab-completion still works.",
};

// A fake `claude` on PATH that records the cwd it was spawned in. Used only by
// the rows that must observe a real transport spawn.
const SHIM_SRC = `#!/usr/bin/env node
"use strict";
const fs = require("fs");
const path = require("path");
const rec = path.join(__dirname, "rec");
const at = (n) => path.join(rec, n);
const argv = process.argv.slice(2);
if (!argv.includes("-p")) { process.stdout.write("2.1.224\\n"); process.exit(0); }
fs.writeFileSync(at("cwd.txt"), process.cwd());
fs.writeFileSync(at("argv.json"), JSON.stringify(argv));
const chunks = [];
process.stdin.on("data", (d) => chunks.push(d));
process.stdin.on("end", () => {
  process.stdout.write(JSON.stringify({
    type: "result", subtype: "success", is_error: false, num_turns: 1,
    result: "fn add(a: i32, b: i32) -> i32 {\\n    a + b\\n}",
    stop_reason: "end_turn", ttft_ms: 11, duration_ms: 22
  }));
});
`;
function makeShim() {
  const dir = tmpDir("c80-adv-shim-");
  fs.mkdirSync(path.join(dir, "rec"));
  const bin = path.join(dir, "claude");
  fs.writeFileSync(bin, SHIM_SRC, { mode: 0o755 });
  fs.chmodSync(bin, 0o755);
  const at = (n) => path.join(dir, "rec", n);
  return { dir, spawned: () => fs.existsSync(at("cwd.txt")), cwd: () => fs.readFileSync(at("cwd.txt"), "utf8") };
}
const SEP = path.delimiter;
function withPath(p, fn) {
  const saved = process.env.PATH;
  process.env.PATH = p;
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      process.env.PATH = saved;
    });
}
async function driveOneRound(service) {
  try {
    await service.generateRaw("// write the body\nfn add(a: i32, b: i32) -> i32 {\n");
  } catch {
    /* a rejected round still recorded its spawn */
  }
}

// ===========================================================================
// A1. THE FAIL-CLOSED SERVICE IS ARMED TO SPAWN IN process.cwd()
// ===========================================================================
//
// buildClaudeCodeFnGenService's `disabled()` helper hands back a live
// FnGenService whose generate fn is makeClaudeCodeInstruct({ cwd: "" }).
// node's spawn does NOT reject an empty-string cwd: it inherits the parent's.
// So the service built for the exact reason "there is nowhere product-owned to
// run" carries a generate fn that runs the CLI in whatever directory the
// extension host was started in - which, for `code .` from a project shell, is
// the user's workspace. The contract calls that the leak the whole neutral-cwd
// section exists to prevent.

test("A1a: node's spawn treats cwd:\"\" as inherit, not as an error - the premise", async () => {
  const { spawn } = require("node:child_process");
  const seen = await new Promise((resolve) => {
    const c = spawn(process.execPath, ["-e", "process.stdout.write(process.cwd())"], { cwd: "" });
    let o = "";
    c.stdout.on("data", (d) => (o += d));
    c.on("error", () => resolve("ERROR"));
    c.on("close", () => resolve(o));
  });
  assert.strictEqual(
    seen,
    process.cwd(),
    "cwd:\"\" silently inherits the parent's directory; it does not fail, so it cannot fail closed"
  );
});

test("A1b: the fail-closed claude-code service must not be able to spawn in the host's cwd", async () => {
  const shim = makeShim();
  resetState();
  __state.config = { fnGenProvider: "claude-code" };
  // The exact contract row 6 shape: no storage path available.
  const built = await build({ deps: { run: fakeRun(PRESENT) } });
  assert.strictEqual(built.tier.fnGenEnabled, false, "precondition: this build failed closed");

  await withPath(shim.dir + SEP + (process.env.PATH || ""), () => driveOneRound(built.service));
  built.service.dispose();

  assert.strictEqual(
    shim.spawned(),
    false,
    `the service returned by the fail-closed path spawned the CLI anyway, in ${
      shim.spawned() ? fs.realpathSync(shim.cwd()) : "?"
    } - which is the host's process.cwd(), i.e. the user's workspace when VS Code was started from it`
  );
});

// ===========================================================================
// A2. THE INJECTED SEAMS (C1) - NO ORACLE ROW DRIVES THEM
// ===========================================================================

test("A2a: deps.run is the PATH probe, is called with `claude --version`, and never generates", async () => {
  resetState();
  __state.config = { fnGenProvider: "claude-code" };
  const run = fakeRun(PRESENT);
  const built = await build({ deps: { storagePath: tmpDir("c80-adv-store-"), run } });
  assert.strictEqual(built.tier.fnGenEnabled, true, "an injected present probe enables the tier");
  assert.deepStrictEqual(
    run.calls,
    [{ command: "claude", args: ["--version"] }],
    "exactly one probe, and it is the version probe - never a -p round"
  );
  built.service.dispose();
});

test("A2b: an injected probe that exits non-zero, and one that throws, both read as binary-missing", async () => {
  for (const [label, run] of [
    ["exit 1", fakeRun({ stdout: "", exitCode: 1 })],
    ["throws", fakeRun(() => Promise.reject(new Error("ENOENT")))],
  ]) {
    resetState();
    __state.config = { fnGenProvider: "claude-code" };
    const built = await build({ deps: { storagePath: tmpDir("c80-adv-store-"), run } });
    assert.strictEqual(built.tier.fnGenEnabled, false, `${label}: fails closed`);
    assert.strictEqual(built.tier.message, MSG["binary-missing"], `${label}: the C3 binary-missing text`);
    assert.ok(
      built.log.includes("[carve] tier=claude-code fnGen=disabled reason=binary-missing"),
      `${label}: the C3 evidence line, got ${JSON.stringify(built.log)}`
    );
    built.service.dispose();
  }
});

test("A2c (C6): the probe is NOT memoized - a second build probes afresh", async () => {
  resetState();
  __state.config = { fnGenProvider: "claude-code" };
  const storagePath = tmpDir("c80-adv-store-");
  const run = fakeRun(PRESENT);
  const a = await build({ deps: { storagePath, run } });
  a.service.dispose();
  const b = await build({ deps: { storagePath, run } });
  b.service.dispose();
  assert.strictEqual(run.calls.length, 2, "C6: each service build probes afresh");
});

// ===========================================================================
// A3. cwd-unusable (C3/C4) - the third reason, unexercised by the oracle
// ===========================================================================

test("A3a: an ensureDir that throws yields the cwd-unusable reason, message and evidence line", async () => {
  resetState();
  __state.config = { fnGenProvider: "claude-code" };
  const storagePath = tmpDir("c80-adv-store-");
  const built = await build({
    deps: {
      storagePath,
      run: fakeRun(PRESENT),
      ensureDir: () => {
        throw new Error("EACCES: read-only profile");
      },
    },
  });
  assert.strictEqual(built.tier.fnGenEnabled, false, "C4: a throwing creation fails the tier CLOSED");
  assert.ok(
    built.log.includes("[carve] tier=claude-code fnGen=disabled reason=cwd-unusable"),
    `C3 evidence line, got ${JSON.stringify(built.log)}`
  );
  const cwd = path.join(storagePath, "claude-cwd");
  assert.match(built.tier.message, /^Function generation is disabled: the Claude Code backend could not create its working directory /);
  assert.ok(built.tier.message.includes(cwd), "the message names the path");
  assert.ok(built.tier.message.endsWith("FIM tab-completion still works."), "the message ends with the FIM sentence");
  built.service.dispose();
});

test("A3b: a claude-cwd that already exists as a FILE fails closed, never enables over an unusable cwd", async () => {
  resetState();
  __state.config = { fnGenProvider: "claude-code" };
  const storagePath = tmpDir("c80-adv-store-");
  fs.writeFileSync(path.join(storagePath, "claude-cwd"), "not a directory");
  const built = await build({ deps: { storagePath, run: fakeRun(PRESENT) } });
  assert.strictEqual(built.tier.fnGenEnabled, false, "a file where the directory belongs must fail closed");
  assert.ok(
    built.log.some((l) => l === "[carve] tier=claude-code fnGen=disabled reason=cwd-unusable"),
    `got ${JSON.stringify(built.log)}`
  );
  built.service.dispose();
});

// ===========================================================================
// A4. C2 precedence and the exact C3 no-storage-path text
// ===========================================================================

test("A4a (C2): storage path is checked FIRST - both conditions at once reports no-storage-path", async () => {
  resetState();
  __state.config = { fnGenProvider: "claude-code" };
  const run = fakeRun({ stdout: "", exitCode: 127 }); // the CLI is missing too
  const built = await build({ deps: { run } });
  assert.strictEqual(built.tier.message, MSG["no-storage-path"], "C2: the product-side defect is named, not the CLI");
  assert.ok(
    built.log.includes("[carve] tier=claude-code fnGen=disabled reason=no-storage-path"),
    `got ${JSON.stringify(built.log)}`
  );
  assert.strictEqual(run.calls.length, 0, "a doomed build should not spend a probe");
  built.service.dispose();
});

test("A4b: an empty-string storage path is treated as absent, with the same C3 text", async () => {
  for (const storagePath of [undefined, ""]) {
    resetState();
    __state.config = { fnGenProvider: "claude-code" };
    const built = await build({ deps: { storagePath, run: fakeRun(PRESENT) } });
    assert.strictEqual(built.tier.message, MSG["no-storage-path"], `storagePath=${JSON.stringify(storagePath)}`);
    built.service.dispose();
  }
});

// ===========================================================================
// A5. THE NEUTRAL CWD MUST BE ABSOLUTE
// ===========================================================================
//
// Phase 1's contract: "Absolute path to a product-owned EMPTY directory".
// The wiring path.joins whatever it is handed and never checks. A relative
// storage path therefore resolves - and gets MKDIR'd - against the host's
// process.cwd(), i.e. the user's workspace on a terminal-launched VS Code.

test("A5: a relative storage path must fail closed rather than resolve against the host cwd", async () => {
  resetState();
  __state.config = { fnGenProvider: "claude-code" };
  const rel = "c80-adv-relative-storage";
  const leaked = path.join(process.cwd(), rel);
  fs.rmSync(leaked, { recursive: true, force: true });
  let built;
  try {
    built = await build({ deps: { storagePath: rel, run: fakeRun(PRESENT) } });
    assert.strictEqual(
      fs.existsSync(path.join(leaked, "claude-cwd")),
      false,
      `the wiring created ${path.join(leaked, "claude-cwd")} - a directory inside the host's cwd, from a non-absolute input`
    );
    assert.strictEqual(built.tier.fnGenEnabled, false, "a non-absolute neutral cwd is not product-owned; fail closed");
  } finally {
    built?.service.dispose();
    fs.rmSync(leaked, { recursive: true, force: true });
  }
});

// ===========================================================================
// A6. FIM IS UNTOUCHED BY fnGenProvider
// ===========================================================================

test("A6a: readConfig() (the FIM config) is byte-identical under ollama and under claude-code", () => {
  resetState();
  __state.config = { fnGenProvider: "ollama" };
  const local = readConfig();
  resetState();
  __state.config = { fnGenProvider: "claude-code", cloudApiKey: "sk-x", cloudApiBase: "https://x.invalid" };
  const claude = readConfig();
  assert.deepStrictEqual(claude, local, "no FIM field moves when the fn-gen backend changes");
});

test("A6b: the FIM config carries no provider, no key and no endpoint override", () => {
  resetState();
  __state.config = { fnGenProvider: "claude-code" };
  const fim = readConfig();
  const keys = Object.keys(fim).join(",");
  assert.ok(!/provider|apiKey|cloud/i.test(keys), `FIM config keys: ${keys}`);
  assert.strictEqual(fim.apiBase, "http://localhost:11434", "FIM still points at the local server");
});

test("A6c: the fn-gen config the claude arm hands out never rewrites the FIM model", async () => {
  resetState();
  __state.config = { fnGenProvider: "claude-code" };
  const built = await build({ deps: { storagePath: tmpDir("c80-adv-store-"), run: fakeRun(PRESENT) } });
  assert.strictEqual(readConfig().model, "qwen2.5-coder:1.5b-base", "the FIM model is the shipped local base model");
  assert.strictEqual(built.config.apiBase, "", "the claude arm blanks its own apiBase");
  assert.strictEqual(readConfig().apiBase, "http://localhost:11434", "and does not blank FIM's");
  built.service.dispose();
});

// ===========================================================================
// A7. THE EXISTING CLOUD ARM IS UNTOUCHED
// ===========================================================================

test("A7a: every pre-existing provider still resolves exactly as before", () => {
  const expected = {
    openai: { label: "OpenAI", baseUrl: "https://api.openai.com/v1" },
    anthropic: { label: "Anthropic (Claude)", baseUrl: "https://api.anthropic.com/v1" },
    xai: { label: "xAI (Grok)", baseUrl: "https://api.x.ai/v1" },
    gemini: { label: "Google (Gemini)", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai" },
  };
  for (const [provider, want] of Object.entries(expected)) {
    resetState();
    __state.config = { fnGenProvider: provider, cloudApiKey: "sk-test" };
    const cfg = readCloudConfig();
    assert.strictEqual(cfg.provider, provider);
    assert.strictEqual(cfg.apiKey, "sk-test", `${provider} still carries the key`);
    assert.strictEqual(cfg.baseUrl, want.baseUrl, `${provider} still resolves its preset base`);
    assert.strictEqual(cfg.label, want.label, `${provider} keeps its label`);
    // the override still wins
    __state.config.cloudApiBase = "https://proxy.invalid/v1";
    assert.strictEqual(readCloudConfig().baseUrl, "https://proxy.invalid/v1", `${provider} override still wins`);
  }

  resetState();
  __state.config = { fnGenProvider: "openai-compatible", cloudApiBase: "https://openrouter.ai/api/v1", cloudApiKey: "k" };
  const oc = readCloudConfig();
  assert.strictEqual(oc.label, "OpenAI-compatible");
  assert.strictEqual(oc.baseUrl, "https://openrouter.ai/api/v1");
  assert.strictEqual(oc.apiKey, "k");

  resetState();
  __state.config = { fnGenProvider: "made-up", cloudApiBase: "https://h.invalid", cloudApiKey: "k" };
  const unknown = readCloudConfig();
  assert.strictEqual(unknown.label, "made-up", "an unknown provider is still carried through for the gate to report");
  assert.strictEqual(unknown.baseUrl, "https://h.invalid");
});

test("A7b: the cloud arm's key/endpoint gate still fires, and still names tier=cloud", async () => {
  resetState();
  __state.config = { fnGenProvider: "openai" }; // no key
  const noKey = await build({});
  assert.strictEqual(noKey.tier.id, "cloud");
  assert.strictEqual(noKey.tier.fnGenEnabled, false);
  assert.ok(noKey.log.some((l) => l.includes("reason=missing-key")), `got ${JSON.stringify(noKey.log)}`);
  noKey.service.dispose();

  resetState();
  __state.config = { fnGenProvider: "openai-compatible", cloudApiKey: "k" }; // no base
  const noBase = await build({});
  assert.strictEqual(noBase.tier.fnGenEnabled, false);
  assert.ok(noBase.log.some((l) => l.includes("reason=missing-endpoint")), `got ${JSON.stringify(noBase.log)}`);
  noBase.service.dispose();

  resetState();
  __state.config = { fnGenProvider: "openai", cloudApiKey: "k", fnGenModel: "gpt-5" };
  const ok = await build({});
  assert.strictEqual(ok.tier.id, "cloud");
  assert.strictEqual(ok.tier.fnGenEnabled, true);
  assert.ok(
    ok.log.includes("[carve] tier=cloud provider=openai model=gpt-5 fnGen=enabled"),
    `got ${JSON.stringify(ok.log)}`
  );
  ok.service.dispose();
});

// ===========================================================================
// A8. HAND-EDITED SETTINGS VALUES
// ===========================================================================

test("A8: whitespace around claude-code is tolerated; a cased variant is NOT, and lands on the cloud arm", async () => {
  resetState();
  __state.config = { fnGenProvider: "  claude-code  " };
  assert.strictEqual(readCloudConfig().provider, "claude-code", "the trim already happened before the branch");

  resetState();
  __state.config = { fnGenProvider: "Claude-Code" };
  const cased = readCloudConfig();
  assert.strictEqual(cased.provider, "Claude-Code");
  const built = await build({ deps: { storagePath: tmpDir("c80-adv-store-"), run: fakeRun(PRESENT) } });
  // Documenting the shipped behaviour: a cased variant is an unknown provider,
  // reported as a misconfigured cloud backend rather than silently local.
  assert.strictEqual(built.tier.id, "cloud");
  assert.strictEqual(built.tier.fnGenEnabled, false);
  assert.match(built.tier.message, /needs an endpoint/, "the message names the endpoint, not the CLI");
  built.service.dispose();
});

// ===========================================================================
// A9. THE MODEL RENDERING RULE (C5) IS A COPY OF PHASE 1'S, NOT PHASE 1'S
// ===========================================================================

test("A9: the evidence line's cli-default rule agrees with modelArg on every shipped tag", async () => {
  // C5: "model= renders cli-default in exactly the case phase 1 omits --model."
  // Phase 1 omits on: "", the two shipped defaults, or any id with a colon.
  // The wiring renders cli-default on: contains a colon. The two agree only
  // because both shipped defaults happen to contain one.
  assert.ok(DEFAULT_FNGEN_CONFIG.model.includes(":"), "shipped fn-gen model tag carries a colon");
  assert.ok(DEFAULT_FNGEN_CONFIG.fallbackModel.includes(":"), "shipped fallback tag carries a colon");

  resetState();
  __state.config = { fnGenProvider: "claude-code" };
  const built = await build({ deps: { storagePath: tmpDir("c80-adv-store-"), run: fakeRun(PRESENT) } });
  assert.ok(
    built.log.includes("[carve] tier=claude-code model=cli-default fnGen=enabled"),
    `the default tag renders cli-default, got ${JSON.stringify(built.log)}`
  );
  built.service.dispose();
});
