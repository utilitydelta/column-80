// Blind oracle: session-v43 phase 2, the vscode wiring for the Claude Code
// fn-gen backend.
//
// Written from the phase-2 contract ONLY. Row numbers below match
// that contract's "Blind oracle rows" list 1..11. The oracle did not read the
// `claude-code` branches of src/vscode/config.ts, src/vscode/fnGen.ts or
// package.json's fnGenProvider block; it read only the pre-existing seams it
// needs to drive the layer at all (the CloudFnGenConfig type, the
// buildFnGenService signature, and how test/impl5-vscode.test.cjs stubs the
// `vscode` module). Every assertion traces to a sentence in the contract.
//
// Two mechanics worth stating up front, because they are what keeps this file
// honest and hermetic:
//
//  * The `claude` binary is a FAKE SHIM on PATH, never the host CLI. Present
//    means "a temp dir holding an executable named `claude` is first on PATH";
//    missing means "PATH is the host PATH with every directory that holds a
//    `claude` filtered out". So rows 4/5 never depend on whether this box has
//    a real claude, and no round ever leaves the machine or spends quota - the
//    shim answers any non-`-p` invocation as a version probe and answers a
//    `-p` round from a canned JSON payload.
//  * Row 7 observes the spawn cwd the same way phase 1's oracle does: the shim
//    records its own process.cwd() to a file, and the test drives one real
//    round through the built service. Nothing reaches into module internals.
//
// Run: SKIP_LIVE=1 node --test test/blind-v43-p2-wiring.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const esbuild = require("esbuild");

const REPO = path.join(__dirname, "..");

// ---------------------------------------------------------------------------
// temp dirs
// ---------------------------------------------------------------------------

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
// row 11: package.json only. No vscode stub, no bundle, no binary.
// ---------------------------------------------------------------------------

test("row 11: fnGenProvider enum and enumDescriptions are the same length and claude-code sits at the same index in both", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO, "package.json"), "utf8"));
  const prop = pkg.contributes.configuration.properties["column80.fnGenProvider"];
  assert.ok(prop, "column80.fnGenProvider is a contributed setting");
  assert.ok(Array.isArray(prop.enum), "the setting carries an enum array");
  assert.ok(Array.isArray(prop.enumDescriptions), "the setting carries an enumDescriptions array");
  assert.strictEqual(
    prop.enum.length,
    prop.enumDescriptions.length,
    "a misaligned pair silently mislabels every provider after it"
  );
  const i = prop.enum.indexOf("claude-code");
  assert.ok(i >= 0, `claude-code joins the enum, got ${JSON.stringify(prop.enum)}`);
  assert.strictEqual(
    prop.enumDescriptions.indexOf(prop.enumDescriptions[i]),
    i,
    "the description at claude-code's index is claude-code's own (no duplicate shifting the pair)"
  );
  // "in the same position in both arrays": the description that belongs to
  // claude-code must actually be at claude-code's index. The copy contract
  // below is what identifies it.
  const copy = prop.enumDescriptions[i];
  assert.ok(typeof copy === "string" && copy.trim() !== "", "claude-code's enumDescription is non-empty");
  assert.match(copy, /subscription/i, "copy states billing rides the Claude subscription");
  assert.match(copy, /Claude Code/i, "copy names the installed Claude Code CLI");
  assert.match(copy, /no API key|without an API key|API key is not needed|no key/i, "copy states no API key is needed");
  assert.match(copy, /leaves? (the|your) machine/i, "copy states the prompt leaves the machine");
  assert.match(copy, /FIM|tab-completion/i, "copy states FIM tab-completion stays local regardless");
  assert.match(copy, /2\.1\.224/, "the quota-weight figure carries 'measured on claude 2.1.224' beside it");
  assert.match(copy, /\d[\dk,\s-]*(k|thousand)?\s*tokens/i, "copy states the rough per-call quota weight in tokens");
});

test("row 11 rider: cloudApiKey and cloudApiBase say they are ignored by claude-code", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO, "package.json"), "utf8"));
  const props = pkg.contributes.configuration.properties;
  for (const key of ["column80.cloudApiKey", "column80.cloudApiBase"]) {
    const d = props[key] && props[key].description;
    assert.ok(typeof d === "string" && d !== "", `${key} has a description`);
    assert.match(d, /ignored/i, `${key} says it is ignored by claude-code`);
    assert.match(d, /claude-code/i, `${key} names claude-code as the provider that ignores it`);
  }
});

// ---------------------------------------------------------------------------
// bundle src/vscode/* against a stub `vscode`
// (mechanism copied from test/impl5-vscode.test.cjs)
// ---------------------------------------------------------------------------

const STUB = path.join(__dirname, ".blind-v43-p2-stub.cjs");
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

const entry = path.join(__dirname, ".blind-v43-p2.entry.ts");
const outfile = path.join(__dirname, ".blind-v43-p2.bundle.cjs");
fs.writeFileSync(
  entry,
  `export { readCloudConfig, readFnGenConfig } from "../src/vscode/config";
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
const { readCloudConfig, readFnGenConfig, buildFnGenService, DEFAULT_FNGEN_CONFIG, __state } = require(outfile);
test.after(() => {
  fs.rmSync(entry, { force: true });
  fs.rmSync(outfile, { force: true });
  fs.rmSync(STUB, { force: true });
});

// ---------------------------------------------------------------------------
// the fake `claude` shim, and PATH control
// ---------------------------------------------------------------------------

// Any invocation WITHOUT `-p` is treated as the contract's "cheap PATH probe"
// (`claude --version` or an equivalent): it answers a version string on stdout
// and exits 0 without reading stdin, so a probe can never hang this suite. A
// `-p` round records argv/cwd/stdin and answers one canned success payload -
// no network, no login, no quota.
const SHIM_SRC = `#!/usr/bin/env node
"use strict";
const fs = require("fs");
const path = require("path");
const rec = path.join(__dirname, "rec");
const at = (n) => path.join(rec, n);
const argv = process.argv.slice(2);
if (!argv.includes("-p")) {
  fs.appendFileSync(at("probes.log"), JSON.stringify(argv) + "\\n");
  process.stdout.write("2.1.224 (Claude Code)\\n");
  process.exit(0);
}
fs.writeFileSync(at("argv.json"), JSON.stringify(argv));
fs.writeFileSync(at("cwd.txt"), process.cwd());
const chunks = [];
const bomb = setTimeout(() => { fs.writeFileSync(at("no-stdin-end.txt"), "1"); process.exit(99); }, 8000);
process.stdin.on("data", (d) => chunks.push(d));
process.stdin.on("end", () => {
  clearTimeout(bomb);
  fs.writeFileSync(at("stdin.bin"), Buffer.concat(chunks));
  process.stdout.write(JSON.stringify({
    type: "result", subtype: "success", is_error: false, num_turns: 1,
    result: "fn add(a: i32, b: i32) -> i32 {\\n    a + b\\n}",
    stop_reason: "end_turn", ttft_ms: 11, duration_ms: 22
  }));
});
`;

function makeShim() {
  const dir = tmpDir("c80-v43p2-shim-");
  fs.mkdirSync(path.join(dir, "rec"));
  const bin = path.join(dir, "claude");
  fs.writeFileSync(bin, SHIM_SRC, { mode: 0o755 });
  fs.chmodSync(bin, 0o755);
  const at = (n) => path.join(dir, "rec", n);
  return {
    dir,
    spawned: () => fs.existsSync(at("argv.json")),
    argv: () => JSON.parse(fs.readFileSync(at("argv.json"), "utf8")),
    cwd: () => fs.readFileSync(at("cwd.txt"), "utf8"),
    stdin: () => fs.readFileSync(at("stdin.bin")),
  };
}

const ORIGINAL_PATH = process.env.PATH || "";
const SEP = path.delimiter;

// PATH with every directory that actually holds an executable `claude`
// removed, so "binary missing" is true no matter what this box has installed,
// while node / sh stay resolvable for anything else the layer spawns.
const PATH_WITHOUT_CLAUDE = ORIGINAL_PATH.split(SEP)
  .filter((d) => d !== "")
  .filter((d) => {
    try {
      fs.accessSync(path.join(d, "claude"), fs.constants.X_OK);
      return false;
    } catch {
      return true;
    }
  })
  .join(SEP);

function withPath(p, fn) {
  const saved = process.env.PATH;
  process.env.PATH = p;
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      process.env.PATH = saved;
    });
}
const withClaude = (shim, fn) => withPath(shim.dir + SEP + PATH_WITHOUT_CLAUDE, fn);
const withoutClaude = (fn) => withPath(PATH_WITHOUT_CLAUDE, fn);

// ---------------------------------------------------------------------------
// harness helpers
// ---------------------------------------------------------------------------

const resetState = () => {
  __state.config = {};
  __state.configInfo = {};
  __state.updates = [];
  __state.messages = [];
  __state.infoResponses = [];
  __state.warnResponses = [];
  __state.errorResponses = [];
  __state.opened = [];
  __state.quickPickImpl = null;
  __state.commands = {};
  __state.terminals = [];
};

const output = () => {
  const lines = [];
  return { lines, appendLine: (l) => lines.push(l) };
};

// The reference hardware probe from impl5-vscode.test.cjs: no host nvidia-smi
// is ever spawned by this file, on any row.
const referenceProbe = () => ({
  runCommand: async () => ({ stdout: "16303\n", exitCode: 0 }),
  totalMemBytes: () => 61826 * 1048576,
  platformInfo: () => ({ platform: "linux", arch: "x64" }),
});

// The contract: "buildFnGenService ... gains a FOURTH optional parameter
// carrying the storage path." Everything else about the call is unchanged.
// The parameter is the layer's declared deps bag (the `FnGenDeps`/`ollamaCheck`
// pattern the contract points at), so the storage path rides it as a field;
// see CONTRACT GAP 1 in the report.
async function build({ storagePath, probe, deps } = {}) {
  const out = output();
  const log = [];
  const bag = storagePath === undefined && deps === undefined ? undefined : { storagePath, ...deps };
  const built = await buildFnGenService(out, (l) => log.push(l), probe, bag);
  return { ...built, out, log };
}

const claudeStorage = (storagePath) => path.join(storagePath, "claude-cwd");

const BINARY_MISSING_MESSAGE =
  "Function generation is disabled: the Claude Code backend needs the `claude` CLI on PATH. FIM tab-completion still works.";

const CLAUDE_MODEL = "claude-sonnet-4-5";

// One real round through the built service, driven at the service's own public
// seam. The postprocess guards may or may not accept the shim's canned reply;
// that is phase 1 / pipeline territory and irrelevant here. What matters is
// that the transport ran, so the shim's recordings exist.
async function driveOneRound(service) {
  try {
    await service.generateRaw("// write the body\nfn add(a: i32, b: i32) -> i32 {\n");
  } catch {
    /* a rejected round still recorded its spawn */
  }
}

// ---------------------------------------------------------------------------
// row 1, row 2: readCloudConfig
// ---------------------------------------------------------------------------

test("row 1: readCloudConfig returns the claude-code config with no key and no baseUrl required", () => {
  resetState();
  __state.config = { fnGenProvider: "claude-code" }; // no cloudApiKey, no cloudApiBase
  const cfg = readCloudConfig();
  assert.ok(cfg, "claude-code is a cloud-family provider, so readCloudConfig answers");
  assert.strictEqual(cfg.provider, "claude-code");
  assert.strictEqual(typeof cfg.label, "string");
  assert.ok(cfg.label.trim() !== "", "a human label rides the config");
  assert.strictEqual(cfg.baseUrl, "", 'contract: "baseUrl and apiKey are \\"\\""');
  assert.strictEqual(cfg.apiKey, "", 'contract: "baseUrl and apiKey are \\"\\""');
});

test("row 1 rider: a set cloudApiBase / cloudApiKey is never read on this path - both stay empty", () => {
  resetState();
  __state.config = {
    fnGenProvider: "claude-code",
    cloudApiBase: "https://example.invalid/v1",
    cloudApiKey: "sk-should-be-ignored",
  };
  const cfg = readCloudConfig();
  assert.strictEqual(cfg.provider, "claude-code");
  assert.strictEqual(cfg.baseUrl, "", "the endpoint setting is ignored by claude-code");
  assert.strictEqual(cfg.apiKey, "", "the key setting is ignored by claude-code");
});

test("row 2: claude-code does not fall through to the unknown-provider branch", async () => {
  resetState();
  // The observable of falling through is the OpenAI-compat arm: a synthetic
  // tier id of "cloud", disabled for a missing endpoint. claude-code must land
  // on its OWN synthetic tier instead.
  __state.config = { fnGenProvider: "not-a-real-provider" };
  const fellThrough = await build({ storagePath: tmpDir("c80-v43p2-store-") });
  assert.strictEqual(fellThrough.tier.id, "cloud", "baseline: an unknown provider takes the OpenAI-compat arm");
  assert.strictEqual(fellThrough.tier.fnGenEnabled, false);
  fellThrough.service.dispose();

  const shim = makeShim();
  resetState();
  __state.config = { fnGenProvider: "claude-code" };
  const built = await withClaude(shim, () => build({ storagePath: tmpDir("c80-v43p2-store-") }));
  assert.strictEqual(built.tier.id, "claude-code", 'contract: synthetic tier { id: "claude-code" }');
  assert.notStrictEqual(built.tier.id, "cloud", "claude-code never reaches the CLOUD_PROVIDERS preset lookup");
  built.service.dispose();
});

// ---------------------------------------------------------------------------
// row 3: the regression this wiring is most likely to introduce
// ---------------------------------------------------------------------------

test("row 3: an EMPTY cloudApiKey still ENABLES fn-gen on claude-code - the cloud arm's key gate must not fire here", async () => {
  const shim = makeShim();
  const storagePath = tmpDir("c80-v43p2-store-");
  for (const key of [undefined, "", "   "]) {
    resetState();
    __state.config = { fnGenProvider: "claude-code" };
    if (key !== undefined) __state.config.cloudApiKey = key;
    const built = await withClaude(shim, () => build({ storagePath }));
    assert.strictEqual(
      built.tier.fnGenEnabled,
      true,
      `claude-code with cloudApiKey=${JSON.stringify(key)} must be ENABLED; got message ${JSON.stringify(built.tier.message)}`
    );
    assert.strictEqual(built.tier.message, undefined, "an enabled tier carries no disabled message");
    assert.ok(
      !built.log.some((l) => /missing-key|missing-endpoint|API key|cloudApiKey|cloudApiBase/i.test(l)),
      `no key/endpoint gate may appear on the evidence channel, got ${JSON.stringify(built.log)}`
    );
    built.service.dispose();
  }
});

test("row 3 rider: an empty cloudApiBase does not disable claude-code either", async () => {
  const shim = makeShim();
  resetState();
  __state.config = { fnGenProvider: "claude-code", cloudApiBase: "" };
  const built = await withClaude(shim, () => build({ storagePath: tmpDir("c80-v43p2-store-") }));
  assert.strictEqual(built.tier.fnGenEnabled, true);
  assert.strictEqual(built.tier.provisional, false, "contract: provisional: false");
  built.service.dispose();
});

// ---------------------------------------------------------------------------
// rows 4, 5: the binary check
// ---------------------------------------------------------------------------

test("row 4: binary present -> fnGenEnabled true and the evidence line matches the stated shape", async () => {
  const shim = makeShim();
  resetState();
  __state.config = { fnGenProvider: "claude-code", fnGenModel: CLAUDE_MODEL };
  const built = await withClaude(shim, () => build({ storagePath: tmpDir("c80-v43p2-store-") }));
  assert.strictEqual(built.tier.fnGenEnabled, true);
  assert.strictEqual(built.tier.id, "claude-code");
  assert.strictEqual(built.tier.provisional, false);
  const line = built.log.find((l) => l.startsWith("[carve] tier=claude-code"));
  assert.ok(line, `an evidence line names the tier, got ${JSON.stringify(built.log)}`);
  assert.match(
    line,
    /^\[carve\] tier=claude-code model=\S+ fnGen=enabled$/,
    "contract: [carve] tier=claude-code model=<id|cli-default> fnGen=enabled"
  );
  assert.strictEqual(
    line,
    `[carve] tier=claude-code model=${CLAUDE_MODEL} fnGen=enabled`,
    "a frontier id the human set renders verbatim"
  );
  built.service.dispose();
});

test("row 5: binary missing -> fnGenEnabled false and the EXACT stated message", async () => {
  resetState();
  __state.config = { fnGenProvider: "claude-code", fnGenModel: CLAUDE_MODEL };
  const built = await withoutClaude(() => build({ storagePath: tmpDir("c80-v43p2-store-") }));
  assert.strictEqual(built.tier.id, "claude-code");
  assert.strictEqual(built.tier.fnGenEnabled, false, "fail CLOSED on a missing binary");
  assert.strictEqual(built.tier.message, BINARY_MISSING_MESSAGE);
  const line = built.log.find((l) => l.startsWith("[carve] tier=claude-code"));
  assert.ok(line, `an evidence line names the tier, got ${JSON.stringify(built.log)}`);
  assert.match(line, /fnGen=disabled reason=\S+/, "contract: the fnGen=disabled reason=... form");
  built.service.dispose();
});

test("row 5 rider: the binary check never runs a generation - the shim records a probe, never a -p round", async () => {
  const shim = makeShim();
  resetState();
  __state.config = { fnGenProvider: "claude-code" };
  const built = await withClaude(shim, () => build({ storagePath: tmpDir("c80-v43p2-store-") }));
  assert.strictEqual(built.tier.fnGenEnabled, true);
  assert.strictEqual(shim.spawned(), false, "building the service must not spawn a generation round");
  built.service.dispose();
});

// ---------------------------------------------------------------------------
// row 6: no storage path
// ---------------------------------------------------------------------------

test("row 6: no storage path available -> fails CLOSED, with a message that says why", async () => {
  const shim = makeShim();
  resetState();
  __state.config = { fnGenProvider: "claude-code" };
  // Three existing call sites pass at most three arguments; that is exactly
  // the "older call site / headless test" the contract names.
  const built = await withClaude(shim, () => build({ storagePath: undefined }));
  assert.strictEqual(built.tier.id, "claude-code");
  assert.strictEqual(
    built.tier.fnGenEnabled,
    false,
    "a silent fallback to process.cwd() is the exact leak the neutral-cwd section exists to prevent"
  );
  assert.ok(typeof built.tier.message === "string" && built.tier.message.trim() !== "", "an honest message exists");
  assert.match(built.tier.message, /disabled/i, "the message says function generation is disabled");
  assert.notStrictEqual(
    built.tier.message,
    BINARY_MISSING_MESSAGE,
    "the binary IS on PATH here; blaming the CLI would be a dishonest message"
  );
  built.service.dispose();
});

// ---------------------------------------------------------------------------
// row 7: the neutral cwd
// ---------------------------------------------------------------------------

test("row 7: the spawn cwd handed to the module is <global storage>/claude-cwd, and the directory exists", async () => {
  const shim = makeShim();
  const storagePath = tmpDir("c80-v43p2-store-");
  const expected = claudeStorage(storagePath);
  assert.strictEqual(fs.existsSync(expected), false, "precondition: phase 2 has not created it yet");

  resetState();
  __state.config = { fnGenProvider: "claude-code", fnGenModel: CLAUDE_MODEL };
  const built = await withClaude(shim, () => build({ storagePath }));
  assert.strictEqual(built.tier.fnGenEnabled, true);

  assert.ok(fs.existsSync(expected), `contract: created by phase 2 if absent - ${expected}`);
  assert.ok(fs.statSync(expected).isDirectory(), "it is a directory");

  await withClaude(shim, () => driveOneRound(built.service));
  assert.ok(shim.spawned(), "the round reached the CLI transport");
  assert.strictEqual(
    fs.realpathSync(shim.cwd()),
    fs.realpathSync(expected),
    "the CLI is spawned in the product-owned directory, never the user's workspace"
  );
  assert.notStrictEqual(fs.realpathSync(shim.cwd()), fs.realpathSync(process.cwd()), "never process.cwd()");
  built.service.dispose();
});

test("row 7 rider: an absent global-storage parent either gets created too, or the build fails CLOSED - never a silent enable over a missing cwd", async () => {
  const shim = makeShim();
  // VS Code does not materialise globalStorageUri until something writes to
  // it, so the parent can legitimately be absent on a first run. Phase 1 fails
  // every round `bad-cwd` when the directory is missing, so enabling the tier
  // over a directory that does not exist would be a silent lie.
  const storagePath = path.join(tmpDir("c80-v43p2-store-"), "nested", "globalStorage");
  resetState();
  __state.config = { fnGenProvider: "claude-code" };
  const built = await withClaude(shim, () => build({ storagePath }));
  const created = fs.existsSync(claudeStorage(storagePath));
  if (built.tier.fnGenEnabled) {
    assert.ok(created, `enabled, so the cwd must exist: ${claudeStorage(storagePath)}`);
  } else {
    assert.ok(
      typeof built.tier.message === "string" && built.tier.message.trim() !== "",
      "not created, so the tier must be disabled with an honest message"
    );
  }
  built.service.dispose();
});

// ---------------------------------------------------------------------------
// rows 8, 9: the config handed to the service
// ---------------------------------------------------------------------------

test("row 8: numGpu is absent from the config handed to the service - no local carve rides a CLI backend", async () => {
  const shim = makeShim();
  const storagePath = tmpDir("c80-v43p2-store-");
  resetState();
  __state.config = { fnGenProvider: "claude-code", fnGenModel: CLAUDE_MODEL };
  const enabled = await withClaude(shim, () => build({ storagePath }));
  assert.ok(!("numGpu" in enabled.config), `key-absent, got ${JSON.stringify(enabled.config)}`);
  assert.strictEqual(enabled.config.numGpu, undefined);
  enabled.service.dispose();

  resetState();
  __state.config = { fnGenProvider: "claude-code", fnGenModel: CLAUDE_MODEL };
  const disabled = await withoutClaude(() => build({ storagePath }));
  assert.ok(!("numGpu" in disabled.config), "the fail-closed build drops it too");
  disabled.service.dispose();
});

test("row 9: the model reaches the module unchanged", async () => {
  const shim = makeShim();
  const storagePath = tmpDir("c80-v43p2-store-");
  resetState();
  __state.config = { fnGenProvider: "claude-code", fnGenModel: CLAUDE_MODEL };
  const built = await withClaude(shim, () => build({ storagePath }));
  assert.strictEqual(built.config.model, CLAUDE_MODEL, "no rewrite, no mapping, no guess in the wiring");

  await withClaude(shim, () => driveOneRound(built.service));
  const argv = shim.argv();
  const i = argv.indexOf("--model");
  assert.ok(i >= 0, `a frontier id reaches the module and phase 1 passes it, got ${JSON.stringify(argv)}`);
  assert.strictEqual(argv[i + 1], CLAUDE_MODEL, "byte-identical to the setting");
  built.service.dispose();
});

test("row 9 rider: the shipped local default is handed over unchanged too - the omission decision is phase 1's, not the wiring's", async () => {
  const shim = makeShim();
  resetState();
  __state.config = { fnGenProvider: "claude-code" }; // fnGenModel left at the shipped default
  const built = await withClaude(shim, () => build({ storagePath: tmpDir("c80-v43p2-store-") }));
  assert.strictEqual(
    built.config.model,
    DEFAULT_FNGEN_CONFIG.model,
    "the wiring does not substitute a Claude id for the local default"
  );
  built.service.dispose();
});

// ---------------------------------------------------------------------------
// row 10: ollama is completely unaffected
// ---------------------------------------------------------------------------

test("row 10: fnGenProvider ollama is untouched - readCloudConfig returns undefined and the local tier path runs", async () => {
  resetState();
  assert.strictEqual(readCloudConfig(), undefined, "the default (unset) provider is local");
  __state.config = { fnGenProvider: "ollama" };
  assert.strictEqual(readCloudConfig(), undefined, "an explicit ollama is local");
  __state.config = { fnGenProvider: "  " };
  assert.strictEqual(readCloudConfig(), undefined, "an emptied field is local");

  resetState();
  __state.config = { fnGenProvider: "ollama" };
  const built = await build({ probe: referenceProbe() });
  assert.strictEqual(built.tier.id, "16gb-large-ram", "the hardware tier path ran, unchanged");
  assert.strictEqual(built.config.model, DEFAULT_FNGEN_CONFIG.model);
  assert.strictEqual(built.config.numGpu, 30, "the local carve still reaches the local service");
  assert.ok(
    built.out.lines.some((l) => l.startsWith("[carve] probe vram=")),
    `the local probe evidence is unchanged, got ${JSON.stringify(built.out.lines)}`
  );
  assert.ok(!built.log.some((l) => l.includes("claude-code")), "no claude-code evidence on a local build");
  built.service.dispose();

  // And a storage path being available must not divert the local path.
  resetState();
  __state.config = { fnGenProvider: "ollama" };
  const withStorage = await build({ probe: referenceProbe(), storagePath: tmpDir("c80-v43p2-store-") });
  assert.strictEqual(withStorage.tier.id, "16gb-large-ram");
  assert.strictEqual(withStorage.config.numGpu, 30);
  withStorage.service.dispose();
});
