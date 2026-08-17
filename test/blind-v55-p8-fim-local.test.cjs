// Blind oracle, session-v55 phase 8: FIM is served LOCALLY, whatever
// `column80.apiBase` says. Goal amendment A.
//
// Written from session-v55/contract-phase8.md ONLY. Every row names the item
// under "What must hold" (1..8) that it pins, plus the two rows that pin the
// "Out of scope" section, which contains a do-NOT-build and a do-build.
//
// WHAT THIS ORACLE READ. The contract; the test files; package.json; and, to
// find the facade and its injection seams and nothing else: the exported
// signatures `readConfig` / `readFnGenConfig` (src/vscode/config.ts:38,177),
// `registerFirstRun` / `runFirstRunFlow` / `interface FirstRunDeps`
// (src/vscode/firstRun.ts:29-37), `warnIfFimNotReady` /
// `resolveToggleWhileEnabled` (src/vscode/extension.ts), and the phase-2
// remote arm in src/vscode/fnGen.ts, which is NOT one of the files this phase
// changes but is where item 8's pinned message lives. It did not read the body
// of the FIM config read, and it did not read `isRemoteApiBase`.
//
// EVERYTHING IS DRIVEN THROUGH THE FACADE. No row calls a helper. The four
// consumers the contract names are reached as the product reaches them:
// `readConfig()` (which carries extension.ts:50's CompletionService and
// extension.ts:361's fimReadiness), `runFirstRunFlow` with an injected `pull`,
// `warnIfFimNotReady` / `resolveToggleWhileEnabled` with an injected
// `listModels`, and `buildFnGenService` for the phase-2 message.
//
// HERMETIC. Every remote host named here is under the `.invalid` TLD (RFC
// 2606), which is guaranteed never to resolve, and every seam that could open
// a socket (`listModels`, `pull`) or spawn a process (the hardware probe) is
// injected on every row. Nothing leaves this machine.
//
// FIXTURES: all synthetic. There is no real Ollama, no real GPU and no real
// settings file in this file. The one thing modelled on somebody else's code
// is the `vscode` stub, and what it claims about the platform is stated at
// the stub itself.
//
// Run: SKIP_LIVE=1 node --test test/blind-v55-p8-fim-local.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");

// ---------------------------------------------------------------------------
// the vscode stub
// ---------------------------------------------------------------------------
//
// Copied from test/impl5-vscode.test.cjs, which is the fake that drives this
// exact set of modules today, with two additions this file needs:
//
//  * `quickPicks` records every picker (the phase-3 oracle's shape), so a row
//    can tell "the flow never got that far" from "the flow asked".
//  * `infoImpl` lets a row answer a notification by WHICH ACTIONS it offers
//    rather than by queue position. The first-run flow can raise more than one
//    "Download" prompt in one run and their order is not contracted, so a
//    positional queue would bind this file to an ordering nothing promises.
//
// WHAT THIS ASSERTS ABOUT THE PLATFORM: `showInformationMessage(message,
// ...actions)` resolves to the action string the user clicked, or `undefined`
// if the notification is dismissed; `WorkspaceConfiguration.get(key, fallback)`
// returns the fallback when no scope sets the key. Both are the documented
// vscode API and both are what every other test file here models.

const STUB = path.join(__dirname, ".blind-v55-p8-stub.cjs");
fs.writeFileSync(
  STUB,
  `
const state = {
  config: {}, configInfo: {}, updates: [], messages: [],
  infoResponses: [], warnResponses: [], errorResponses: [],
  opened: [], quickPicks: [], quickPickImpl: null, infoImpl: null,
  commands: {}, terminals: [],
};
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
    showInformationMessage: async (message, ...actions) => {
      state.messages.push({ kind: "info", message, actions });
      if (state.infoImpl) return state.infoImpl(message, actions);
      return state.infoResponses.shift();
    },
    showWarningMessage: async (message, ...actions) => { state.messages.push({ kind: "warn", message, actions }); return state.warnResponses.shift(); },
    showErrorMessage: async (message, ...actions) => { state.messages.push({ kind: "error", message, actions }); return state.errorResponses.shift(); },
    showQuickPick: async (items, opts) => { state.quickPicks.push({ items, opts }); return state.quickPickImpl ? state.quickPickImpl(items, opts) : undefined; },
    withProgress: async (opts, task) => task({ report: () => {} }, { onCancellationRequested: () => ({ dispose() {} }) }),
    createTerminal: (opts) => { const t = { name: opts.name, shown: false, sent: [], show() { this.shown = true; }, sendText(s) { this.sent.push(s); } }; state.terminals.push(t); return t; },
    get terminals() { return state.terminals; },
    tabGroups: { all: [], onDidChangeTabs: () => ({ dispose() {} }), close: async () => {} },
  },
  commands: { registerCommand: (id, fn) => { state.commands[id] = fn; return { dispose() {} }; } },
  env: { openExternal: async (uri) => { state.opened.push(String(uri)); return true; } },
  Uri: { parse: (s) => s, file: (s) => ({ fsPath: s, toString: () => s }) },
};
`,
);

const entry = path.join(__dirname, ".blind-v55-p8.entry.ts");
const outfile = path.join(__dirname, ".blind-v55-p8.bundle.cjs");
fs.writeFileSync(
  entry,
  `export { readConfig, readFnGenConfig } from "../src/vscode/config";
export { runFirstRunFlow } from "../src/vscode/firstRun";
export { warnIfFimNotReady, resolveToggleWhileEnabled } from "../src/vscode/extension";
export { buildFnGenService } from "../src/vscode/fnGen";
export { DEFAULT_FIM_CONFIG, DEFAULT_FNGEN_CONFIG, isRemoteApiBase } from "../src/core/config";
export { __state } from "vscode";\n`,
);
esbuild.buildSync({
  entryPoints: [entry],
  bundle: true,
  outfile,
  format: "cjs",
  platform: "node",
  alias: { vscode: STUB },
});
const {
  readConfig,
  readFnGenConfig,
  runFirstRunFlow,
  warnIfFimNotReady,
  resolveToggleWhileEnabled,
  buildFnGenService,
  DEFAULT_FIM_CONFIG,
  isRemoteApiBase,
  __state,
} = require(outfile);
test.after(() => {
  fs.rmSync(entry, { force: true });
  fs.rmSync(outfile, { force: true });
  fs.rmSync(STUB, { force: true });
});

// ---------------------------------------------------------------------------
// constants and harness
// ---------------------------------------------------------------------------

// The ruling, in one place: FIM's base is DEFAULT_FIM_CONFIG.apiBase. The
// literal is asserted against the exported constant once, below, so that if
// somebody moves the default this file follows it rather than contradicting it.
const LOCAL = DEFAULT_FIM_CONFIG.apiBase;
const REMOTE = "http://gpu-box.invalid:11434";
const REMOTE_SPELLINGS = [
  ["http://gpu-box.invalid:11434", "a named host on the network"],
  ["http://ml.invalid:11500", "a named host on some other port"],
  ["https://ollama.example.invalid", "a named host behind TLS, no port"],
  ["http://192.168.1.5:11434", "a private LAN address is still somebody else's machine"],
];

const FNGEN_MODEL = "qwen3-coder:30b"; // the 16gb-large-ram row, via impl5-vscode.test.cjs

const resetState = () => {
  __state.config = {};
  __state.configInfo = {};
  __state.updates = [];
  __state.messages = [];
  __state.infoResponses = [];
  __state.warnResponses = [];
  __state.errorResponses = [];
  __state.opened = [];
  __state.quickPicks = [];
  __state.quickPickImpl = null;
  __state.infoImpl = null;
  __state.commands = {};
  __state.terminals = [];
};

const output = () => {
  const lines = [];
  return { lines, appendLine: (l) => lines.push(l) };
};

/** The reference box, injected so no row ever spawns nvidia-smi. */
const referenceProbe = () => ({
  runCommand: async () => ({ stdout: "16303\n", exitCode: 0 }),
  totalMemBytes: () => 61826 * 1048576,
});

/** True for the endpoints a human would call "this machine". Written out by
 *  hand ON PURPOSE: a fake that asked `isRemoteApiBase` would inherit the
 *  opinion of the code under test, and then a wrong predicate would look
 *  right. */
const looksLocal = (apiBase) =>
  typeof apiBase === "string" && /(^|\/\/|@)(localhost|127\.0\.0\.\d+|\[::1\]|0\.0\.0\.0)(:|\/|$)/.test(apiBase);

/** A listModels fake that answers DIFFERENTLY per host, which is the only way
 *  a "which host was asked" row can be about behaviour rather than about a
 *  recorded argument. `local` is what this box serves; every other host is
 *  dark, which is the situation the contract is written about. */
const hostAwareList = (local) => {
  const calls = [];
  return {
    calls,
    fn: async (apiBase) => {
      calls.push(apiBase);
      return looksLocal(apiBase) ? local : undefined;
    },
  };
};

/** A pull fake that records its target. This is the whole of item 5. */
const recordingPull = () => {
  const calls = [];
  return {
    calls,
    pull: async (apiBase, model, signal, onProgress) => {
      calls.push({ apiBase, model });
      onProgress(undefined, "pulling manifest");
      onProgress(1, "success");
    },
  };
};

/** A user who clicks Download on every download offer and dismisses the rest.
 *  Position-independent, so the flow may raise its offers in any order. */
const clickEveryDownload = () => (message, actions) => (actions.includes("Download") ? "Download" : undefined);

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));

// ===========================================================================
// RIG: the one literal this file rests on
// ===========================================================================

test("RIG: DEFAULT_FIM_CONFIG.apiBase is http://localhost:11434, the value the ruling names", () => {
  assert.strictEqual(
    LOCAL,
    "http://localhost:11434",
    'contract item 1 names "http://localhost:11434, the DEFAULT_FIM_CONFIG.apiBase value" - if these ever disagree, every row below is measuring the wrong thing',
  );
});

// ===========================================================================
// ITEM 1: a remote `apiBase` does not move FIM
// ===========================================================================

test("item 1a [surface: contract-phase8 'A remote apiBase does not move FIM']: FIM reads localhost while fn-gen reads the remote host", () => {
  resetState();
  __state.config = { apiBase: REMOTE };
  assert.strictEqual(
    readConfig().apiBase,
    LOCAL,
    `contract item 1: FIM's base is ${LOCAL} when apiBase names another machine`,
  );
  assert.strictEqual(readFnGenConfig().apiBase, REMOTE, "and fn-gen's base is the remote host, as phase 2 built it");
});

test("item 1b: every remote spelling moves fn-gen and leaves FIM on localhost", () => {
  for (const [endpoint, why] of REMOTE_SPELLINGS) {
    resetState();
    __state.config = { apiBase: endpoint };
    assert.strictEqual(readConfig().apiBase, LOCAL, `${JSON.stringify(endpoint)}: FIM stays local - ${why}`);
    assert.strictEqual(readFnGenConfig().apiBase, endpoint, `${JSON.stringify(endpoint)}: fn-gen follows the setting`);
  }
});

test("item 1c [OVER-REACH GUARD]: on a remote apiBase, NO other FIM config field moves - only the base", () => {
  // Green today (nothing but apiBase differs), and it must stay green: the
  // carve is one field, and a helper that rebuilt the FIM config from the
  // defaults would silently drop the user's fimModel, fimLanguages and the
  // rest. This is the row that catches that.
  resetState();
  __state.config = {
    fimModel: "qwen2.5-coder:1.5b-base-custom",
    fimLanguages: ["rust", "go"],
    fimMemberGate: false,
  };
  const onDefault = readConfig();
  resetState();
  __state.config = {
    apiBase: REMOTE,
    fimModel: "qwen2.5-coder:1.5b-base-custom",
    fimLanguages: ["rust", "go"],
    fimMemberGate: false,
  };
  const onRemote = readConfig();

  assert.deepStrictEqual(
    Object.keys(onRemote).sort(),
    Object.keys(onDefault).sort(),
    "the remote read must not add or drop a key",
  );
  const stripped = (c) => {
    const { apiBase, ...rest } = c;
    return rest;
  };
  assert.deepStrictEqual(
    stripped(onRemote),
    stripped(onDefault),
    "apiBase is the ONLY field a remote host may change on the FIM config",
  );
  assert.strictEqual(onRemote.apiBase, LOCAL, "and that field is pinned to localhost");
});

// ===========================================================================
// ITEM 2: a loopback `apiBase` still moves FIM, on any port
// ===========================================================================
//
// GREEN TODAY, BY CONSTRUCTION: at HEAD FIM follows every apiBase, so it
// follows these too. They are here because they go RED under the wrong fix -
// the `apiBase !== DEFAULT_FIM_CONFIG.apiBase` compare the contract calls out
// by name. A fix that passes item 1 and fails these has taken FIM away from
// somebody running Ollama in a container on this box.

const LOOPBACK_SPELLINGS = [
  ["http://localhost:11500", "a container publishing 11500 is still this box"],
  ["http://127.0.0.1:11434", "the loopback address, spelled numerically"],
  ["http://[::1]:11434", "loopback over IPv6, which the contract names explicitly"],
  ["http://0.0.0.0:11434", "OLLAMA_HOST=0.0.0.0 is the standard way to expose Ollama and it is still this box"],
  ["http://127.0.0.2:11434", "all of 127.0.0.0/8 is loopback, not just .1"],
  ["https://localhost:11434", "loopback behind TLS is still loopback"],
];

for (const [endpoint, why] of LOOPBACK_SPELLINGS) {
  test(`item 2 [surface: contract-phase8 'A loopback apiBase still moves FIM, on any port']: ${endpoint} - FIM follows it`, () => {
    resetState();
    __state.config = { apiBase: endpoint };
    assert.strictEqual(
      readConfig().apiBase,
      endpoint,
      `${why}. contract item 2: "FIM must follow them there. This is the rule that makes the carve safe, and it is the one a !== default compare gets wrong."`,
    );
    assert.strictEqual(readFnGenConfig().apiBase, endpoint, "and both halves still agree on a local endpoint");
  });
}

// ===========================================================================
// ITEM 3: the predicate is `isRemoteApiBase`, not a new one
// ===========================================================================
//
// A second predicate cannot be seen from outside unless it DISAGREES, so that
// is what these rows look for: the shipped predicate's verdict and the FIM
// base must move together, endpoint for endpoint, including on the three edge
// cases the contract names (trailing slash, empty hostname, unparseable).

const PREDICATE_TABLE = [
  ...REMOTE_SPELLINGS.map(([e]) => e),
  ...LOOPBACK_SPELLINGS.map(([e]) => e),
  LOCAL,
  "http://localhost:11434/", // trailing-slash normalisation
  "  http://localhost:11434  ", // the whitespace a paste leaves behind
  "localhost:11434", // new URL() parses this to an EMPTY hostname
  "not a url at all", // unparseable-stays-local
  "", // an emptied setting
];

test("item 3 [surface: contract-phase8 'The predicate is isRemoteApiBase, not a new one']: the FIM base tracks isRemoteApiBase endpoint for endpoint", () => {
  for (const endpoint of PREDICATE_TABLE) {
    resetState();
    __state.config = { apiBase: endpoint };
    const fim = readConfig().apiBase;
    const fnGen = readFnGenConfig().apiBase;
    if (isRemoteApiBase(endpoint)) {
      assert.strictEqual(fim, LOCAL, `isRemoteApiBase(${JSON.stringify(endpoint)}) is true, so FIM must be pinned local`);
    } else {
      assert.strictEqual(
        fim,
        fnGen,
        `isRemoteApiBase(${JSON.stringify(endpoint)}) is false, so FIM must read exactly what fn-gen reads - a second predicate that disagrees here is the thing item 3 forbids`,
      );
    }
  }
});

test("item 3 rider: the three edge cases the contract names by hand are LOCAL, and FIM sees the setting on all three", () => {
  for (const [endpoint, why] of [
    ["http://localhost:11434/", "trailing-slash normalisation"],
    ["localhost:11434", 'the empty-hostname case: new URL("localhost:11434") parses to hostname ""'],
    ["nonsense://:::", "unparseable-stays-local"],
  ]) {
    resetState();
    __state.config = { apiBase: endpoint };
    assert.strictEqual(isRemoteApiBase(endpoint), false, `${JSON.stringify(endpoint)} is LOCAL: ${why}`);
    assert.strictEqual(
      readConfig().apiBase,
      readFnGenConfig().apiBase,
      `${JSON.stringify(endpoint)}: a local endpoint must reach FIM exactly as it reaches fn-gen`,
    );
  }
});

// ===========================================================================
// ITEM 4: the default changes nothing. THE REGRESSION THAT MATTERS MOST.
// ===========================================================================

test("item 4a [surface: contract-phase8 'The default changes nothing']: an unset apiBase reads the same for both halves", () => {
  resetState();
  assert.strictEqual(readConfig().apiBase, LOCAL, "FIM's base on a fresh install");
  assert.strictEqual(readFnGenConfig().apiBase, LOCAL, "and fn-gen's");
  assert.strictEqual(readConfig().model, DEFAULT_FIM_CONFIG.model, "and the FIM model is untouched by any of this");
});

test("item 4b: apiBase typed by hand as the default value is byte-for-byte the same read as leaving it unset", () => {
  resetState();
  const unset = readConfig();
  resetState();
  __state.config = { apiBase: LOCAL };
  assert.deepStrictEqual(
    readConfig(),
    unset,
    "typing the default must not divert FIM anywhere, and must not change one field of the config either",
  );
});

test("item 4c: the whole FIM config on a default apiBase is unchanged by the carve - every field, not just the base", () => {
  // The strongest form available from outside: a config with several non-default
  // FIM settings set, read on the default endpoint, must come back exactly as
  // the settings say. If the fix rebuilds the config instead of substituting one
  // field, this is where it shows.
  resetState();
  __state.config = {
    fimModel: "starcoder2:3b",
    fimLanguages: ["typescript"],
    fimUsageExamples: false,
    fimAlternatives: 2,
  };
  const cfg = readConfig();
  assert.strictEqual(cfg.apiBase, LOCAL);
  assert.strictEqual(cfg.model, "starcoder2:3b", "the user's FIM model still reaches the config");
  assert.deepStrictEqual(cfg.fimLanguages, ["typescript"], "and so does every other FIM setting");
});

test("item 4d: on the default endpoint the FIM half and the fn-gen half still agree, which is the shape every existing FIM test assumes", () => {
  for (const config of [{}, { apiBase: LOCAL }, { fimModel: "starcoder2:3b" }, { hardwareTier: "16gb-large-ram" }]) {
    resetState();
    __state.config = config;
    assert.strictEqual(
      readConfig().apiBase,
      readFnGenConfig().apiBase,
      `${JSON.stringify(config)}: nothing about the carve may separate the two halves on a local endpoint`,
    );
  }
});

// ===========================================================================
// ITEM 5: the FIM model pull targets the FIM host
// ===========================================================================

test("item 5a [surface: contract-phase8 'The FIM model pull targets the FIM host']: on a remote apiBase the FIM model is pulled to LOCALHOST", async () => {
  resetState();
  __state.config = { apiBase: REMOTE };
  __state.quickPickImpl = async (items) => items[0];
  __state.infoImpl = clickEveryDownload();
  __state.warnResponses = [undefined, undefined, undefined];
  const out = output();
  const { calls, pull } = recordingPull();

  await runFirstRunFlow({ subscriptions: [], globalState: { get: () => undefined, update: async () => {} } }, out, {
    probe: referenceProbe(),
    listModels: async () => [], // the server answers, and has nothing installed
    pull,
    ollamaCheck: async () => ({ stdout: "ollama version 0.0.0", exitCode: 0 }),
  });

  const fimPulls = calls.filter((c) => c.model === DEFAULT_FIM_CONFIG.model);
  assert.ok(
    fimPulls.length > 0,
    `the FIM model was never offered for download at all, so nothing about its target was proven. Pulls seen: ${JSON.stringify(calls)}`,
  );
  for (const c of fimPulls) {
    assert.strictEqual(
      c.apiBase,
      LOCAL,
      `contract item 5: "On a remote host that offers to download the FIM model onto somebody else's server." The FIM model must be pulled to ${LOCAL}, got ${c.apiBase}`,
    );
  }
});

// MEASURED, and it corrects the contract: item 5 says firstRun.ts:195 offers
// "both entries in `needed`" on a remote host. It does not. On a remote apiBase
// the flow today offers exactly ONE pull, the FIM entry, and points it at the
// remote host - the fn-gen entry never appears, because the remote arm has no
// tier row and so no fn-gen model to need. So the defect item 5 describes is
// not "one of two pulls is misdirected", it is "the ONLY pull the remote arm
// makes is the misdirected one", which is worse, not better.
//
// This row pins the population rather than the target: the phase moves WHERE
// the FIM pull goes, not WHICH entries are offered. If the fix starts offering
// an fn-gen pull on the remote arm, this goes red on purpose - that is a
// separate design change and it needs a human, not a silent pass.
test("item 5b: the remote arm offers exactly one pull, the FIM entry - and any fn-gen-class pull would still target the remote host", async () => {
  resetState();
  __state.config = { apiBase: REMOTE };
  __state.quickPickImpl = async (items) => items[0];
  __state.infoImpl = clickEveryDownload();
  __state.warnResponses = [undefined, undefined, undefined];
  const out = output();
  const { calls, pull } = recordingPull();

  await runFirstRunFlow({ subscriptions: [], globalState: { get: () => undefined, update: async () => {} } }, out, {
    probe: referenceProbe(),
    listModels: async () => [],
    pull,
    ollamaCheck: async () => ({ stdout: "ollama version 0.0.0", exitCode: 0 }),
  });

  assert.deepStrictEqual(
    calls.map((c) => c.model),
    [DEFAULT_FIM_CONFIG.model],
    `on a remote apiBase exactly one pull is offered and it is the FIM entry, got ${JSON.stringify(calls)}`,
  );
  for (const c of calls.filter((c) => c.model !== DEFAULT_FIM_CONFIG.model)) {
    assert.strictEqual(
      c.apiBase,
      REMOTE,
      `an fn-gen-class model (${c.model}) belongs on the fn-gen host - the carve moves the FIM entry only`,
    );
  }
});

test("item 5c [REGRESSION]: on the default apiBase both entries are still pulled to localhost, exactly as before", async () => {
  resetState();
  __state.quickPickImpl = async (items) => items[0];
  __state.infoImpl = clickEveryDownload();
  __state.warnResponses = [undefined, undefined, undefined];
  const out = output();
  const { calls, pull } = recordingPull();

  await runFirstRunFlow({ subscriptions: [], globalState: { get: () => undefined, update: async () => {} } }, out, {
    probe: referenceProbe(),
    listModels: async () => [],
    pull,
    ollamaCheck: async () => ({ stdout: "ollama version 0.0.0", exitCode: 0 }),
  });

  assert.ok(calls.length >= 2, `both models are missing, so both are offered, got ${JSON.stringify(calls)}`);
  assert.ok(
    calls.some((c) => c.model === DEFAULT_FIM_CONFIG.model),
    "the FIM entry is one of them",
  );
  assert.ok(
    calls.some((c) => c.model === FNGEN_MODEL),
    "and the fn-gen entry is the other",
  );
  for (const c of calls) {
    assert.strictEqual(c.apiBase, LOCAL, `${c.model} is pulled to the local server on a default install`);
  }
});

// ===========================================================================
// ITEM 6: `fimReadiness` asks the FIM host
// ===========================================================================
//
// fimReadiness is not exported. It is reached the way the product reaches it:
// through `warnIfFimNotReady` (the enable path) and
// `resolveToggleWhileEnabled` (the toggle path), both of which take the
// `listModels` seam as a parameter. The fake answers per host, so these rows
// turn on the OUTCOME the user sees, not on a recorded argument.

test("item 6a [surface: contract-phase8 'fimReadiness asks the FIM host']: with a dead remote host and a healthy localhost, enabling FIM says nothing", async () => {
  resetState();
  __state.config = { apiBase: REMOTE, fimModel: DEFAULT_FIM_CONFIG.model };
  const list = hostAwareList([DEFAULT_FIM_CONFIG.model]);
  const out = output();

  await warnIfFimNotReady(out, list.fn, async () => ({ stdout: "ollama version 0.0.0", exitCode: 0 }));

  assert.deepStrictEqual(
    list.calls.filter((c) => !looksLocal(c)),
    [],
    `contract item 6: "On a remote arm it must probe localhost". It asked ${JSON.stringify(list.calls)}`,
  );
  assert.deepStrictEqual(
    __state.messages,
    [],
    "FIM is served locally and localhost has the model, so there is nothing to warn about - a warning here is the wrong server being reported down",
  );
  assert.strictEqual(__state.terminals.length, 0, "and no terminal is spawned to fix a server that is not FIM's");
});

test("item 6b: the toggle path reads the same host - toggling a working FIM off just turns it off", async () => {
  resetState();
  __state.config = { apiBase: REMOTE, fimModel: DEFAULT_FIM_CONFIG.model };
  const list = hostAwareList([DEFAULT_FIM_CONFIG.model]);
  const out = output();

  const decision = await resolveToggleWhileEnabled(out, list.fn, async () => ({ stdout: "v", exitCode: 0 }));

  assert.strictEqual(
    decision,
    "disable",
    "FIM is working (it is local), so a toggle press means turn it off - not 'the server is down, do you want to start it'",
  );
  assert.deepStrictEqual(
    list.calls.filter((c) => !looksLocal(c)),
    [],
    `the readiness probe must not ask the fn-gen host, it asked ${JSON.stringify(list.calls)}`,
  );
});

test("item 6c [NOT VACUOUS]: with a remote apiBase and localhost genuinely down, FIM readiness still reports server-down", async () => {
  // The failure mode on the other side of item 6: a fix that makes readiness
  // always-ready would pass 6a and 6b and leave the user with no diagnosis at
  // all. Here nothing is up anywhere, and the user must still be told.
  resetState();
  __state.config = { apiBase: REMOTE, fimModel: DEFAULT_FIM_CONFIG.model };
  const list = hostAwareList(undefined); // localhost is down too
  const out = output();
  __state.warnResponses = [undefined]; // dismiss, so nothing is spawned

  await warnIfFimNotReady(out, list.fn, async () => ({ stdout: "v", exitCode: 0 }));

  const warn = __state.messages.find((m) => m.kind === "warn");
  assert.ok(warn, `a down FIM server must still be reported, got ${JSON.stringify(__state.messages)}`);
  assert.strictEqual(__state.terminals.length, 0, "dismissed, so nothing spawned");
});

test("item 6d [NOT VACUOUS]: with a remote apiBase and localhost up but the FIM model absent, the download is still offered", async () => {
  resetState();
  __state.config = { apiBase: REMOTE, fimModel: DEFAULT_FIM_CONFIG.model };
  const list = hostAwareList([FNGEN_MODEL]); // local server answers, no FIM model
  const out = output();

  await warnIfFimNotReady(out, list.fn, async () => ({ stdout: "v", exitCode: 0 }));

  const info = __state.messages.find((m) => m.kind === "info");
  assert.ok(info, `the missing-model diagnosis must survive the carve, got ${JSON.stringify(__state.messages)}`);
  assert.ok(info.message.includes(DEFAULT_FIM_CONFIG.model), "and it still names the model that is missing");
});

test("item 6e [REGRESSION]: on a default apiBase readiness is unchanged - localhost is asked, a down server is reported", async () => {
  resetState();
  __state.config = { fimModel: DEFAULT_FIM_CONFIG.model };
  const list = hostAwareList(undefined);
  const out = output();
  __state.warnResponses = [undefined];

  await warnIfFimNotReady(out, list.fn, async () => ({ stdout: "v", exitCode: 0 }));

  assert.deepStrictEqual(list.calls, [LOCAL], `exactly one probe, of localhost, got ${JSON.stringify(list.calls)}`);
  assert.ok(
    __state.messages.some((m) => m.kind === "warn"),
    "and the existing server-down warning still fires",
  );
});

// ===========================================================================
// ITEM 7: the tighten path is unaffected and must stay that way
// ===========================================================================

test("item 7a [surface: contract-phase8 'The tighten path is unaffected']: the fn-gen config tighten reads still carries the remote host", () => {
  // tightenDocComment.ts:565 reads `readFnGenConfig`. This is that read, at the
  // facade, under every remote spelling: "make FIM local" must not reach it.
  for (const [endpoint, why] of REMOTE_SPELLINGS) {
    resetState();
    __state.config = { apiBase: endpoint };
    assert.strictEqual(
      readFnGenConfig().apiBase,
      endpoint,
      `${JSON.stringify(endpoint)}: tighten is an fn-gen-class model and follows the remote host - ${why}`,
    );
  }
});

test("item 7b [STRUCTURAL, not behavioural]: tightenDocComment.ts still binds its config default to readFnGenConfig and never touches readConfig", () => {
  // Stated plainly: this row reads source text. It is here because the
  // behavioural half above cannot tell "tighten reads readFnGenConfig" from
  // "tighten reads readConfig and readConfig happens to be remote too" - and
  // after this phase those two stop being the same thing. Driving the real
  // tighten gesture needs an editor, a language server and a model, which is
  // the live rig, not a unit row.
  const src = fs.readFileSync(path.join(__dirname, "..", "src", "vscode", "tightenDocComment.ts"), "utf8");
  assert.ok(
    src.includes("deps.config ?? readFnGenConfig"),
    "the default config binding on the tighten path is readFnGenConfig",
  );
  assert.ok(
    !/\breadConfig\b/.test(src),
    "tighten must not start reading the FIM config - that is the over-reach this item exists to catch",
  );
});

// ===========================================================================
// ITEM 8: the phase-2 message is not edited
// ===========================================================================

test("item 8a [surface: contract-phase8 'The phase-2 message is not edited']: the unreachable-remote message is byte-for-byte what amendment E pinned", async () => {
  resetState();
  __state.config = { apiBase: REMOTE };
  const built = await buildFnGenService(
    output(),
    () => {},
    referenceProbe(),
    { listModels: async () => undefined }, // the remote host does not answer
  );

  assert.strictEqual(built.tier.id, "remote");
  assert.strictEqual(built.tier.fnGenEnabled, false);
  assert.strictEqual(
    built.tier.message,
    `Function generation is disabled: the Ollama server at ${REMOTE} did not answer. FIM tab-completion still works.`,
    'contract item 8: "A phase that reworded it would have solved nothing." The whole justification for this phase is making this sentence true, not editing it.',
  );
  built.service.dispose();
});

test("item 8b: and in that exact scenario the sentence is TRUE - the FIM half is pointed at localhost, not at the host that just failed", async () => {
  resetState();
  __state.config = { apiBase: REMOTE };
  const built = await buildFnGenService(output(), () => {}, referenceProbe(), { listModels: async () => undefined });

  assert.ok(built.tier.message.endsWith("FIM tab-completion still works."), "the sentence is on screen");
  assert.strictEqual(
    readConfig().apiBase,
    LOCAL,
    "so FIM had better be somewhere that can answer. This row is item 8 and item 1 in one place: the message is the reason the carve exists",
  );
  built.service.dispose();
});

// ===========================================================================
// OUT OF SCOPE: one do-NOT-build and one do-build
// ===========================================================================

test("out of scope [contract-phase8 'FIM served from a remote host']: no column80.fimApiBase setting is added, and no escape hatch under another name", () => {
  const props = Object.keys(pkg.contributes.configuration.properties);
  const suspects = props.filter((k) => /fim.*(apibase|host|url|endpoint|server)/i.test(k));
  assert.deepStrictEqual(
    suspects,
    [],
    'contract: "Do not add the setting, do not add a hidden escape hatch, and do not leave a half-wired parameter that reads like one."',
  );
});

test("out of scope [contract-phase8 'The settings description']: column80.apiBase's blurb no longer contradicts its behaviour", () => {
  const desc = pkg.contributes.configuration.properties["column80.apiBase"].description;
  assert.notStrictEqual(
    desc,
    "Base URL of the local Ollama server.",
    'contract: "It is now the fn-gen backend\'s base and FIM ignores it when it is not loopback. Update the description"',
  );
  assert.match(
    desc,
    /FIM/i,
    "a reader of this setting has to be told which half of the product it moves, which is the whole reason the contract asks for the edit",
  );
});
