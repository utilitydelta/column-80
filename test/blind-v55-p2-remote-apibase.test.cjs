// Blind oracle: session-v55 phase 2, a remote Ollama (`column80.apiBase`
// pointed at another machine) is not gated on THIS box's VRAM.
//
// Written from session-v55/contract-phase2.md ONLY. Every test names the
// contract item under "What must hold" that it pins, 1..9. The oracle read no
// implementation of the remote arm: it read the public seam it must drive
// (`buildFnGenService`'s signature, `ProbeHardwareOptions`, `ClaudeCodeDeps`,
// `DEFAULT_FNGEN_CONFIG`) and the two precedent arms' TESTS
// (test/blind-v43-p2-wiring.test.cjs, test/adversarial-v43-p2.test.cjs,
// test/impl5-vscode.test.cjs), which are the same shape of carve.
//
// Hermetic by construction, on two axes:
//
//  * NO HARDWARE. Every build in this file injects `probeOpts`. The reference
//    probe answers vram=16303 ram=61826 from memory, so `nvidia-smi` is never
//    spawned by this file on any row - and, on the remote rows, the injected
//    probe RECORDS its calls, which is how item 1 ("no hardware probe of any
//    kind") is evidenced rather than asserted by inspection.
//  * NO NETWORK. Every host named here is under the `.invalid` TLD (RFC 2606),
//    which is guaranteed never to resolve. So even if the reachability
//    injection below fails to bind (see ASSUMPTION 1), nothing leaves this
//    machine - the worst case is a red row, never a packet.
//
// Run: node --test test/blind-v55-p2-remote-apibase.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const esbuild = require("esbuild");

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
// bundle src/vscode/* against a stub `vscode`
// (mechanism copied verbatim from test/blind-v43-p2-wiring.test.cjs)
// ---------------------------------------------------------------------------

const STUB = path.join(__dirname, ".blind-v55-p2-stub.cjs");
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

const entry = path.join(__dirname, ".blind-v55-p2.entry.ts");
const outfile = path.join(__dirname, ".blind-v55-p2.bundle.cjs");
fs.writeFileSync(
  entry,
  `export { buildFnGenService } from "../src/vscode/fnGen";
export { readFnGenConfig } from "../src/vscode/config";
export { DEFAULT_FNGEN_CONFIG, isRemoteApiBase } from "../src/core/config";
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
const { buildFnGenService, readFnGenConfig, DEFAULT_FNGEN_CONFIG, isRemoteApiBase, __state } = require(outfile);
test.after(() => {
  fs.rmSync(entry, { force: true });
  fs.rmSync(outfile, { force: true });
  fs.rmSync(STUB, { force: true });
});

// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------

// A remote host that can never resolve, so no row in this file can reach the
// network even if the injection below misses. It deliberately contains neither
// "gpu" nor "vram", so item 5's "the message must not mention the GPU" check
// can be case-insensitive without the host itself tripping it.
const REMOTE_HOST = "http://ml-box.invalid:11434";
const REMOTE_HOSTNAME = "ml-box.invalid";
const DEFAULT_HOST = "http://localhost:11434";

// A model tag that is NOT any tier row's model and not the shipped default, so
// "the local VRAM row's model was substituted" is detectable (item 2).
const REMOTE_MODEL = "qwen3-coder:480b";

// The 16gb-large-ram row, from the shipped table via impl5-vscode.test.cjs.
// This is what the defect substitutes, and what item 7 must keep.
const ROW_MODEL = "qwen3-coder:30b";
const ROW_NUM_GPU = 30;

// ===========================================================================
// ASSUMPTION 1 - the ONE un-dictated name in this file (item 8)
// ===========================================================================
//
// Item 8 says the reachability probe "is injectable" but names neither the
// parameter nor the function's shape. The contract holes are reported; here is
// how this file binds to it, in ONE place:
//
//  * CHANNEL. `buildFnGenService(output, log, probeOpts?, claudeCode?)` already
//    carries a deps bag in its FOURTH parameter - the `ClaudeCodeDeps` pattern
//    ({ storagePath, run, ensureDir }) that the claude-code arm's oracle drives.
//    This file assumes the remote arm's probe rides that same bag. `probeOpts`
//    is the wrong channel by construction: item 1 requires the remote arm never
//    to touch the hardware probe at all.
//  * NAME. Not dictated, so the fake is installed under every plausible key at
//    once and the row asserts only that ONE of them was called. `listModels` is
//    first because it is the codebase's existing "is the server up" call
//    (`listModels(apiBase, signal) -> string[] | undefined`, core/ollama.ts) and
//    is already a `FirstRunDeps` seam.
//  * SHAPE. The fake answers `["qwen3-coder:30b", ...]` for REACHABLE - truthy
//    under a boolean-shaped seam and correct under a listModels-shaped one -
//    and `undefined` for UNREACHABLE, which is falsy under every convention and
//    is listModels' own "server is down" answer.
//
// If the fix picks a name outside this set, the rows go red with "the injected
// reachability probe was never called", which is an honest report of a missed
// seam, not a silent pass.
//
// RESOLVED. The fix landed on `listModels` in that fourth bag (and forwards it
// from `registerFnGen` as `FnGenDeps.claudeCode.listModels`, falling back to
// `FnGenDeps.listModels`). The alias spread is left in place: it costs nothing,
// and it keeps this file honest if the seam is renamed later.
const REACHABILITY_KEYS = ["listModels", "reachable", "remoteCheck", "checkRemote", "probeRemote", "ollamaCheck"];

/** A recording reachability fake. `answer` is a value or a function of the
 *  arguments; `calls` is every invocation, whichever key it arrived through. */
function reachabilityProbe(answer) {
  const calls = [];
  const fn = async (...args) => {
    calls.push(args);
    return typeof answer === "function" ? answer(...args) : answer;
  };
  return { fn, calls, spread: () => Object.fromEntries(REACHABILITY_KEYS.map((k) => [k, fn])) };
}

// SUPERSEDED in one respect by session-v56 phase 1 (roadmap item 57): the
// remote arm now also requires the configured model in the list, so the
// reachable stub must CARRY it for "reachable enables" to stay what these
// rows pin. The model-gate half lives in blind-v56-p1-remote-model-gate.
const REACHABLE = ["qwen3-coder:30b", REMOTE_MODEL, "qwen2.5-coder:1.5b-base"];
const UNREACHABLE = undefined;

// ASSUMPTION 2 (item 8, "it is bounded"): the contract states boundedness but
// gives no number. This file only asserts that activation is not hung by a
// probe that never answers, using a ceiling far above any plausible timeout -
// the sibling arm's PATH probe budgets 5s. Any bound at or under this passes.
const ACTIVATION_BOUND_MS = 10_000;

// ---------------------------------------------------------------------------
// harness
// ---------------------------------------------------------------------------

const resetState = () => {
  __state.config = {};
  __state.configInfo = {};
  __state.updates = [];
  __state.messages = [];
};

const output = () => {
  const lines = [];
  return { lines, appendLine: (l) => lines.push(l) };
};

/** The reference-box probe from impl5-vscode.test.cjs, wrapped so every call
 *  is recorded. Zero calls is item 1's evidence; a non-zero count on item 7 is
 *  the regression guard's evidence. Answers 16GB VRAM / 61GB RAM, which is the
 *  16gb-large-ram row - the row whose model substitution is the defect. */
function recordingProbe() {
  const calls = [];
  return {
    calls,
    opts: {
      runCommand: async (command, args) => {
        calls.push({ kind: "runCommand", command, args });
        return { stdout: "16303\n", exitCode: 0 };
      },
      totalMemBytes: () => {
        calls.push({ kind: "totalMemBytes" });
        return 61826 * 1048576;
      },
    },
  };
}

/** One build at the public seam. Never omits `probeOpts`: an omitted probe is
 *  a host `nvidia-smi` spawn, which this file must never do. */
async function build({ probe, deps } = {}) {
  const out = output();
  const log = [];
  const built = await buildFnGenService(out, (l) => log.push(l), probe.opts, deps);
  return { ...built, out, log, probe };
}

/** Every evidence line the build wrote, on either channel. The contract says
 *  "the channel says so" without saying which of the two the layer carries -
 *  see CONTRACT HOLE 2 - so rows search the union. */
const evidence = (built) => [...built.log, ...built.out.lines];

// ===========================================================================
// ITEM 1: a non-default apiBase takes an off-table `remote` arm - NO probe
// ===========================================================================

test("item 1: a non-default apiBase spawns no hardware probe of any kind - zero calls to the injected probe", async () => {
  resetState();
  __state.config = { apiBase: REMOTE_HOST };
  const r = reachabilityProbe(REACHABLE);
  const built = await build({ probe: recordingProbe(), deps: r.spread() });

  assert.deepStrictEqual(
    built.probe.calls,
    [],
    `the remote arm probed THIS machine: ${JSON.stringify(built.probe.calls)} - contract: "no resolveTier call, no nvidia-smi spawn, no hardware probe of any kind"`
  );
  assert.ok(
    !evidence(built).some((l) => l.startsWith("[carve] probe vram=")),
    `no local probe evidence may be written on the remote arm, got ${JSON.stringify(evidence(built))}`
  );
  assert.strictEqual(built.tier.id, "remote", "the off-table arm is taken, mirroring the cloud short-circuit");
  built.service.dispose();
});

test("item 1 rider: an UNREACHABLE remote host does not fall back to probing the local box either", async () => {
  resetState();
  __state.config = { apiBase: REMOTE_HOST };
  const r = reachabilityProbe(UNREACHABLE);
  const built = await build({ probe: recordingProbe(), deps: r.spread() });

  assert.deepStrictEqual(
    built.probe.calls,
    [],
    "a failed reachability check must not degrade into the local VRAM story - that is the defect, reintroduced"
  );
  assert.strictEqual(built.tier.id, "remote", "still the remote arm, just disabled");
  built.service.dispose();
});

// ===========================================================================
// ITEM 2: no model override, explicit or not
// ===========================================================================

test("item 2a: an EXPLICITLY set fnGenModel reaches config.model verbatim on the remote arm", async () => {
  resetState();
  __state.config = { apiBase: REMOTE_HOST, fnGenModel: REMOTE_MODEL };
  __state.configInfo = { fnGenModel: { globalValue: REMOTE_MODEL } };
  const r = reachabilityProbe(REACHABLE);
  const built = await build({ probe: recordingProbe(), deps: r.spread() });

  assert.strictEqual(built.config.model, REMOTE_MODEL, "no rewrite, no mapping, no guess");
  assert.notStrictEqual(built.config.model, ROW_MODEL, "the local VRAM row's model must never be substituted");
  built.service.dispose();
});

test("item 2b: a NON-explicit fnGenModel reaches config.model verbatim too - the local row's model is never substituted", async () => {
  resetState();
  // The value is the effective setting, but no scope reports it as written by
  // the human - the exact case applyTier's `explicitFnGenModel ? config.model :
  // rowModel` rule substitutes on today.
  __state.config = { apiBase: REMOTE_HOST, fnGenModel: REMOTE_MODEL };
  __state.configInfo = {};
  const r = reachabilityProbe(REACHABLE);
  const built = await build({ probe: recordingProbe(), deps: r.spread() });

  assert.strictEqual(
    built.config.model,
    REMOTE_MODEL,
    `contract: "fnGenModel reaches FnGenConfig.model verbatim, whether or not the user set it explicitly"`
  );
  built.service.dispose();
});

test("item 2c: with no fnGenModel at all the shipped default is handed over unchanged, off the tier table", async () => {
  resetState();
  __state.config = { apiBase: REMOTE_HOST };
  const r = reachabilityProbe(REACHABLE);
  const built = await build({ probe: recordingProbe(), deps: r.spread() });

  assert.strictEqual(
    built.config.model,
    DEFAULT_FNGEN_CONFIG.model,
    "the remote arm does not consult the tier table for a model, so the base config's tag survives"
  );
  assert.deepStrictEqual(built.probe.calls, [], "and it still did not measure this machine to decide that");
  built.service.dispose();
});

// ===========================================================================
// ITEM 3: no local carve
// ===========================================================================
//
// READ THIS BEFORE TRUSTING THE ROW BELOW. It is a GUARD, not evidence. The
// adversarial review deleted the arm's `delete config.numGpu` and this row
// still passed 20/20, because `readFnGenConfig` never sets `numGpu` in the
// first place - the carve only ever arrives via `applyTier`, which the remote
// arm does not call. So the row proves the OUTCOME (nothing local rides the
// config) and cannot prove the MECHANISM. No black-box input can: there is no
// public seam that puts a numGpu on the base config. Triage kept the delete as
// a structural guard against a future base-config change, and ruled this row a
// guard to match. Do not read a pass here as proof the delete is live.

test("item 3 [GUARD, not evidence - see the note above]: numGpu is absent from the config handed to the service, reachable and unreachable alike", async () => {
  for (const [label, answer] of [
    ["reachable", REACHABLE],
    ["unreachable", UNREACHABLE],
  ]) {
    resetState();
    __state.config = { apiBase: REMOTE_HOST, fnGenModel: REMOTE_MODEL };
    const r = reachabilityProbe(answer);
    const built = await build({ probe: recordingProbe(), deps: r.spread() });
    assert.ok(
      !("numGpu" in built.config),
      `${label}: key-absent, got ${JSON.stringify(built.config)} - numGpu is a local-serving knob and does not belong on a config aimed at another machine`
    );
    assert.notStrictEqual(built.config.numGpu, ROW_NUM_GPU, `${label}: and certainly not this box's carve`);
    built.service.dispose();
  }
});

// ===========================================================================
// ITEM 4: the channel says so
// ===========================================================================

test("item 4: a [carve] tier=remote evidence line is written, and it names the host", async () => {
  resetState();
  __state.config = { apiBase: REMOTE_HOST, fnGenModel: REMOTE_MODEL };
  const r = reachabilityProbe(REACHABLE);
  const built = await build({ probe: recordingProbe(), deps: r.spread() });

  const line = evidence(built).find((l) => l.startsWith("[carve] tier=remote"));
  assert.ok(line, `contract: "a [carve] tier=remote line naming the host", got ${JSON.stringify(evidence(built))}`);
  assert.ok(line.includes(REMOTE_HOSTNAME), `the line names the host, got ${JSON.stringify(line)}`);
  built.service.dispose();
});

test("item 4 rider: the disabled remote build also says tier=remote on the channel, and names the host", async () => {
  resetState();
  __state.config = { apiBase: REMOTE_HOST };
  const r = reachabilityProbe(UNREACHABLE);
  const built = await build({ probe: recordingProbe(), deps: r.spread() });

  const line = evidence(built).find((l) => l.startsWith("[carve] tier=remote"));
  assert.ok(line, `a disabled arm is exactly when the channel matters, got ${JSON.stringify(evidence(built))}`);
  assert.ok(line.includes(REMOTE_HOSTNAME), `the line names the host, got ${JSON.stringify(line)}`);
  built.service.dispose();
});

// ===========================================================================
// ITEM 5: fail CLOSED on an unreachable host, with an HONEST message
// ===========================================================================

test("item 5: an unreachable host disables fn-gen with a message that names the host and never mentions the GPU", async () => {
  resetState();
  __state.config = { apiBase: REMOTE_HOST, fnGenModel: REMOTE_MODEL };
  const r = reachabilityProbe(UNREACHABLE);
  const built = await build({ probe: recordingProbe(), deps: r.spread() });

  assert.strictEqual(built.tier.id, "remote");
  assert.strictEqual(built.tier.fnGenEnabled, false, "fail CLOSED on an unreachable host");
  const msg = built.tier.message;
  assert.ok(typeof msg === "string" && msg.trim() !== "", `a disabled tier carries an honest message, got ${JSON.stringify(msg)}`);
  assert.ok(msg.includes(REMOTE_HOSTNAME), `the message names the HOST, got ${JSON.stringify(msg)}`);
  for (const banned of [/GPU/i, /VRAM/i, /nvidia/i]) {
    assert.ok(
      !banned.test(msg),
      `contract: "It must not mention the GPU, VRAM, or nvidia-smi. That wrong message is the whole item." - got ${JSON.stringify(msg)}`
    );
  }
  built.service.dispose();
});

// ===========================================================================
// ITEM 6: a reachable host ENABLES fn-gen
// ===========================================================================

test("item 6: a reachable host enables fn-gen with tier.id remote and provisional false", async () => {
  resetState();
  __state.config = { apiBase: REMOTE_HOST, fnGenModel: REMOTE_MODEL };
  const r = reachabilityProbe(REACHABLE);
  const built = await build({ probe: recordingProbe(), deps: r.spread() });

  assert.strictEqual(built.tier.id, "remote");
  assert.strictEqual(built.tier.fnGenEnabled, true, `a reachable host enables fn-gen, message was ${JSON.stringify(built.tier.message)}`);
  assert.strictEqual(built.tier.provisional, false, 'contract: "provisional: false"');
  assert.strictEqual(built.tier.message, undefined, "an enabled tier carries no disabled message");
  assert.ok(built.service && typeof built.service.generate === "function", "a real service was built on that config");
  built.service.dispose();
});

test("item 6 rider: the service's config still points at the remote host - the setting is the base of every request", async () => {
  resetState();
  __state.config = { apiBase: REMOTE_HOST, fnGenModel: REMOTE_MODEL };
  const r = reachabilityProbe(REACHABLE);
  const built = await build({ probe: recordingProbe(), deps: r.spread() });
  assert.strictEqual(built.config.apiBase, REMOTE_HOST, "the remote arm must not blank or rewrite the endpoint it exists for");
  built.service.dispose();
});

// ===========================================================================
// ITEM 7: the default apiBase changes NOTHING - the regression that matters
// ===========================================================================

test("item 7a: an unset apiBase still walks resolveTier, still probes the hardware, still carves", async () => {
  resetState();
  __state.config = {}; // apiBase left at the shipped default
  const r = reachabilityProbe(REACHABLE);
  const built = await build({ probe: recordingProbe(), deps: r.spread() });

  assert.ok(built.probe.calls.length > 0, "the local hardware probe still runs on the default endpoint");
  assert.strictEqual(built.tier.id, "16gb-large-ram", "the reference probe still resolves its table row");
  assert.strictEqual(built.config.model, ROW_MODEL, "applyTier still supplies the row's model");
  assert.strictEqual(built.config.numGpu, ROW_NUM_GPU, "the local carve still reaches the local service");
  assert.strictEqual(built.config.apiBase, DEFAULT_HOST);
  assert.ok(
    built.out.lines.some((l) => l.startsWith("[carve] probe vram=")),
    `the local probe evidence is unchanged, got ${JSON.stringify(built.out.lines)}`
  );
  assert.strictEqual(r.calls.length, 0, "and no reachability probe is spent on localhost");
  built.service.dispose();
});

test("item 7b: apiBase set EXPLICITLY to http://localhost:11434 is the default, not a remote host", async () => {
  resetState();
  __state.config = { apiBase: DEFAULT_HOST };
  const r = reachabilityProbe(REACHABLE);
  const built = await build({ probe: recordingProbe(), deps: r.spread() });

  assert.strictEqual(built.tier.id, "16gb-large-ram", "typing the default value by hand must not divert to the remote arm");
  assert.ok(built.probe.calls.length > 0, "the hardware probe still runs");
  assert.strictEqual(built.config.numGpu, ROW_NUM_GPU, "the carve still applies");
  built.service.dispose();
});

test("item 7c: a hardwareTier override on the default endpoint still applies the tier, unchanged", async () => {
  resetState();
  __state.config = { hardwareTier: "16gb-low-ram" };
  const r = reachabilityProbe(REACHABLE);
  const built = await build({ probe: recordingProbe(), deps: r.spread() });

  assert.strictEqual(built.tier.id, "16gb-low-ram", "the override path is untouched by the remote arm");
  assert.strictEqual(built.config.model, DEFAULT_FNGEN_CONFIG.fallbackModel);
  assert.ok(!("numGpu" in built.config), "and that row's no-carve rule still holds");
  built.service.dispose();
});

// ===========================================================================
// ITEM 8: the reachability probe is injectable and bounded
// ===========================================================================

test("item 8a: the reachability check is INJECTABLE - the remote arm calls the injected probe, with the host", async () => {
  resetState();
  __state.config = { apiBase: REMOTE_HOST };
  const r = reachabilityProbe(REACHABLE);
  const built = await build({ probe: recordingProbe(), deps: r.spread() });

  assert.ok(
    r.calls.length > 0,
    `the injected reachability probe was never called under any of ${JSON.stringify(REACHABILITY_KEYS)} - see ASSUMPTION 1 at the top of this file`
  );
  assert.ok(
    r.calls.some((args) => args.some((a) => typeof a === "string" && a.includes(REMOTE_HOSTNAME))),
    `the probe is told which host to check, got ${JSON.stringify(r.calls)}`
  );
  built.service.dispose();
});

test("item 8b: the reachability probe cannot hang activation - a probe that never answers is bounded", async () => {
  resetState();
  __state.config = { apiBase: REMOTE_HOST };
  // Never answers. The timer is unref'd so a wedged build can never keep this
  // process alive past the run.
  const timers = [];
  const r = reachabilityProbe(
    () =>
      new Promise((resolve) => {
        const t = setTimeout(() => resolve(UNREACHABLE), 5 * 60_000);
        if (typeof t.unref === "function") t.unref();
        timers.push(t);
      })
  );

  const started = Date.now();
  let settled = null;
  const buildPromise = build({ probe: recordingProbe(), deps: r.spread() }).then((b) => {
    settled = b;
    return b;
  });
  const timeout = new Promise((resolve) => {
    const t = setTimeout(() => resolve("TIMEOUT"), ACTIVATION_BOUND_MS);
    if (typeof t.unref === "function") t.unref();
    timers.push(t);
  });
  const winner = await Promise.race([buildPromise.then(() => "BUILT"), timeout]);
  for (const t of timers) clearTimeout(t);

  assert.ok(
    r.calls.length > 0,
    `precondition: the injected probe must actually be the thing that could hang - never called under ${JSON.stringify(REACHABILITY_KEYS)}`
  );
  assert.strictEqual(
    winner,
    "BUILT",
    `activation is still pending after ${Date.now() - started}ms - contract: "the reachability probe cannot hang activation. It is bounded."`
  );
  assert.strictEqual(settled.tier.id, "remote");
  assert.strictEqual(settled.tier.fnGenEnabled, false, "a probe that never answers is not a reachable host; fail CLOSED");
  settled.service.dispose();
});

// ===========================================================================
// ITEM 9: the cloud and claude-code arms still win
// ===========================================================================

test("item 9a: a configured cloud provider takes the cloud arm even with a non-default apiBase", async () => {
  resetState();
  __state.config = { fnGenProvider: "openai", cloudApiKey: "sk-test", fnGenModel: "gpt-5", apiBase: REMOTE_HOST };
  const r = reachabilityProbe(REACHABLE);
  const built = await build({ probe: recordingProbe(), deps: r.spread() });

  assert.strictEqual(built.tier.id, "cloud", "the remote arm is checked AFTER the cloud arm");
  assert.strictEqual(built.tier.fnGenEnabled, true);
  assert.deepStrictEqual(built.probe.calls, [], "the cloud arm still short-circuits the hardware probe");
  assert.strictEqual(r.calls.length, 0, "and spends no reachability probe on an endpoint it does not use");
  built.service.dispose();
});

test("item 9a rider: a HALF-configured cloud provider still reports as cloud, not as a remote host", async () => {
  resetState();
  __state.config = { fnGenProvider: "openai", apiBase: REMOTE_HOST }; // no key
  const r = reachabilityProbe(REACHABLE);
  const built = await build({ probe: recordingProbe(), deps: r.spread() });

  assert.strictEqual(built.tier.id, "cloud", "a misconfigured cloud backend must not be reported as an unreachable Ollama box");
  assert.strictEqual(built.tier.fnGenEnabled, false);
  assert.ok(
    evidence(built).some((l) => l.includes("reason=missing-key")),
    `the cloud arm's own gate still fires, got ${JSON.stringify(evidence(built))}`
  );
  built.service.dispose();
});

test("item 9b: the claude-code arm still wins over a non-default apiBase", async () => {
  resetState();
  __state.config = { fnGenProvider: "claude-code", apiBase: REMOTE_HOST };
  const r = reachabilityProbe(REACHABLE);
  const built = await build({
    probe: recordingProbe(),
    deps: {
      ...r.spread(),
      // the claude-code arm's own injected seams, from its oracle
      storagePath: tmpDir("c80-v55p2-store-"),
      run: async () => ({ stdout: "2.1.224 (Claude Code)\n", exitCode: 0 }),
    },
  });

  assert.strictEqual(built.tier.id, "claude-code", "the remote arm is checked after claude-code too");
  assert.strictEqual(built.tier.fnGenEnabled, true);
  assert.deepStrictEqual(built.probe.calls, [], "still no hardware probe");
  assert.strictEqual(r.calls.length, 0, "and no reachability probe against an endpoint the CLI never uses");
  built.service.dispose();
});

// ===========================================================================
// AMENDMENT B: WHICH ENDPOINTS COUNT AS LOCAL
// ===========================================================================
//
// Added after an adversarial review showed amendment B had ZERO coverage in
// this file: every "local" row above uses either an unset apiBase or the exact
// default string, and both are caught by the `normalized === DEFAULT`
// short-circuit before the loopback logic is ever consulted. Replacing the
// whole loopback set with `return true` survived all 20 rows.
//
// So every row below uses an endpoint that CANNOT reach that short-circuit.
// The verdict is pinned twice: once on the predicate directly (precise), and
// once through `buildFnGenService` (proves the predicate is actually the gate,
// not a dead function beside a hardcoded branch).
//
// Hermetic note: `http://192.168.1.5:11434` is a routable address on a real
// LAN, so it appears in the PREDICATE table only - `isRemoteApiBase` is a pure
// function and opens no socket. Every row that builds a service uses a
// `.invalid` host, which can never resolve.

/** Amendment B2's local set: endpoints that are this machine, spelled in a way
 *  the default-string short-circuit cannot catch. */
const LOCAL_ENDPOINTS = [
  ["http://localhost:11500", "loopback on a non-default port - a container publishing 11500 is still your own VRAM"],
  ["http://127.0.0.1:11434", "the loopback address, spelled numerically"],
  ["https://localhost:11434", "loopback behind TLS is still loopback"],
  ["http://localhost:11434/", "the default with a trailing slash - a hand-edited settings value"],
  ["  http://localhost:11434  ", "the default with the whitespace a paste leaves behind"],
  ["http://0.0.0.0:11434", "OLLAMA_HOST=0.0.0.0 is the standard way to expose Ollama, and it is still THIS box"],
  ["http://127.0.0.2:11434", "all of 127.0.0.0/8 is loopback, not just .1"],
  ["localhost:11434", "no scheme: new URL() does not throw here, it parses to an empty hostname"],
  ["unix:///var/run/ollama.sock", "a unix socket is as local as it gets"],
  ["file:///x", "no host at all"],
];

/** And the other side, so the rows are not one-sided: a predicate that answers
 *  false for everything passes the table above and fails here. */
const REMOTE_ENDPOINTS = [
  ["http://gpu.invalid:11434", "a named host on the network"],
  ["http://192.168.1.5:11434", "a private LAN address is somebody else's machine"],
  [REMOTE_HOST, "the host every row above this section uses"],
];

test("amendment B2 predicate: every local spelling answers LOCAL, including the ones the default-string short-circuit cannot catch", () => {
  for (const [endpoint, why] of LOCAL_ENDPOINTS) {
    assert.strictEqual(isRemoteApiBase(endpoint), false, `${JSON.stringify(endpoint)} is LOCAL: ${why}`);
  }
  // The two the short-circuit does catch, kept so the table is complete.
  assert.strictEqual(isRemoteApiBase(DEFAULT_HOST), false, "the shipped default is local");
  assert.strictEqual(isRemoteApiBase(""), false, "an emptied setting is an un-choice, not a remote host");
  assert.strictEqual(isRemoteApiBase("   "), false, "and neither is whitespace");
});

test("amendment B2 predicate: a host on the network answers REMOTE - the predicate is not just `return false`", () => {
  for (const [endpoint, why] of REMOTE_ENDPOINTS) {
    assert.strictEqual(isRemoteApiBase(endpoint), true, `${JSON.stringify(endpoint)} is REMOTE: ${why}`);
  }
});

test("amendment B2 wired: every local spelling still walks resolveTier, probes THIS box, and carves", async () => {
  for (const [endpoint, why] of LOCAL_ENDPOINTS) {
    resetState();
    __state.config = { apiBase: endpoint };
    const r = reachabilityProbe(REACHABLE);
    const built = await build({ probe: recordingProbe(), deps: r.spread() });

    assert.strictEqual(built.tier.id, "16gb-large-ram", `${JSON.stringify(endpoint)} must take the LOCAL path: ${why}`);
    assert.ok(built.probe.calls.length > 0, `${JSON.stringify(endpoint)}: the hardware probe still runs`);
    assert.strictEqual(built.config.numGpu, ROW_NUM_GPU, `${JSON.stringify(endpoint)}: the local carve still applies`);
    assert.strictEqual(r.calls.length, 0, `${JSON.stringify(endpoint)}: no reachability probe is spent on this machine`);
    built.service.dispose();
  }
});

test("amendment B2 wired: a host on the network still takes the remote arm - the local set did not swallow everything", async () => {
  resetState();
  __state.config = { apiBase: "http://gpu.invalid:11434" };
  const r = reachabilityProbe(REACHABLE);
  const built = await build({ probe: recordingProbe(), deps: r.spread() });

  assert.strictEqual(built.tier.id, "remote", "a named network host is not loopback");
  assert.deepStrictEqual(built.probe.calls, [], "and it does not measure this machine");
  assert.ok(r.calls.length > 0, "it asks the host instead");
  built.service.dispose();
});

test("amendment B2 regression: a 6GB laptop serving on 0.0.0.0 gets the honest below-12gb refusal, not fn-gen on the 30b", async () => {
  // The entry's own regression: OLLAMA_HOST=0.0.0.0 read as a remote host, so
  // the box was never measured and fn-gen came up ENABLED on the shipped 30b
  // default - on a card that cannot hold it. The honest answer is the VRAM
  // refusal, and this is the one place in this file where the message SHOULD
  // name the VRAM, because here the local GPU really is the reason.
  resetState();
  __state.config = { apiBase: "http://0.0.0.0:11434" };
  const smallBox = {
    calls: [],
    opts: {
      runCommand: async () => ({ stdout: "6144\n", exitCode: 0 }),
      totalMemBytes: () => 16384 * 1048576,
    },
  };
  const r = reachabilityProbe(REACHABLE);
  const built = await build({ probe: smallBox, deps: r.spread() });

  assert.strictEqual(built.tier.id, "below-12gb", "the box is measured, and it is a small box");
  assert.strictEqual(built.tier.fnGenEnabled, false, "fn-gen must NOT come up enabled on a 6GB card");
  assert.match(built.tier.message, /VRAM/, "and the refusal names the real reason, which here is the VRAM");
  assert.strictEqual(r.calls.length, 0, "0.0.0.0 is this machine, so nothing is asked over the wire");
  built.service.dispose();
});

// ===========================================================================
// A closing sanity row: the base config read is not what is broken
// ===========================================================================

test("baseline: readFnGenConfig already carries the non-default apiBase - the defect is downstream of the read", () => {
  resetState();
  __state.config = { apiBase: REMOTE_HOST };
  assert.strictEqual(readFnGenConfig().apiBase, REMOTE_HOST, "the setting is read; what follows it is the item");
});

test("baseline: the base config read can never carry a numGpu - this is WHY the item 3 row is a guard", () => {
  // Pins the premise behind the item 3 note. Deleting the remote arm's
  // `delete config.numGpu` changes no observable outcome, and this row is the
  // reason: the carve is not a setting, so it cannot arrive through the read.
  // It only ever arrives from `applyTier`, which the remote arm never calls.
  // A future change that lets the carve into the base config makes the delete
  // load-bearing - and breaks THIS row first, which is the warning.
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
  const contributed = Object.keys(pkg.contributes.configuration.properties);
  assert.ok(
    !contributed.some((k) => /numgpu/i.test(k)),
    `numGpu is deliberately not a setting, got ${JSON.stringify(contributed.filter((k) => /numgpu/i.test(k)))}`
  );
  for (const config of [
    {},
    { apiBase: REMOTE_HOST },
    { fnGenModel: REMOTE_MODEL },
    { hardwareTier: "16gb-large-ram" },
    { numGpu: 30 }, // even a hand-edited settings.json cannot smuggle one in
  ]) {
    resetState();
    __state.config = config;
    assert.ok(
      !("numGpu" in readFnGenConfig()),
      `no carve rides the base read for ${JSON.stringify(config)}, got ${JSON.stringify(readFnGenConfig())}`
    );
  }
});
