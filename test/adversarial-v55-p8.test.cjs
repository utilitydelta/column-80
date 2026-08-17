// Adversarial review, session-v55 phase 8 (FIM is served locally, whatever
// `column80.apiBase` says).
//
// Written AFTER the fix, against the diff, by a reviewer whose job is to poke
// holes. Two kinds of row live here and they are labelled:
//
//   VERIFY - a claim the implementer made that this file went and checked.
//            These are green, and they close gaps the blind oracle left
//            (its `listModels` fake is host-BLIND, so no blind row can tell
//            which host the CATALOGUE came from).
//   FINDING - a defect. These are RED on purpose. Each one names the exact
//            input and the exact wrong output in its message.
//
// HERMETIC: every remote host is `.invalid` (RFC 2606), and `listModels`,
// `pull` and the hardware probe are injected on every row. Nothing opens a
// socket and nothing spawns a process.
//
// Run: SKIP_LIVE=1 node --test test/adversarial-v55-p8.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");

const STUB = path.join(__dirname, ".adv-v55-p8-stub.cjs");
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

const entry = path.join(__dirname, ".adv-v55-p8.entry.ts");
const outfile = path.join(__dirname, ".adv-v55-p8.bundle.cjs");
fs.writeFileSync(
  entry,
  `export { readConfig, readFnGenConfig } from "../src/vscode/config";
export { runFirstRunFlow } from "../src/vscode/firstRun";
export { warnIfFimNotReady } from "../src/vscode/extension";
export { DEFAULT_FIM_CONFIG, DEFAULT_FNGEN_CONFIG, fimApiBase, isRemoteApiBase } from "../src/core/config";
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
  DEFAULT_FIM_CONFIG,
  fimApiBase,
  __state,
} = require(outfile);
test.after(() => {
  fs.rmSync(entry, { force: true });
  fs.rmSync(outfile, { force: true });
  fs.rmSync(STUB, { force: true });
});

const LOCAL = DEFAULT_FIM_CONFIG.apiBase;
const REMOTE = "http://gpu-box.invalid:11434";
const FIM_MODEL = DEFAULT_FIM_CONFIG.model;
const MODEL_30B = "qwen3-coder:30b";

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

const fakeContext = () => ({ subscriptions: [], globalState: { get: () => undefined, update: async () => {} } });
/** 16GB reference box: the tier resolves and fn-gen is locally enabled. */
const referenceProbe = () => ({
  runCommand: async () => ({ stdout: "16303\n", exitCode: 0 }),
  totalMemBytes: () => 61826 * 1048576,
});

/** Records every host the catalogue was asked for, and answers per host.
 *  `up` is the set of hosts that answer; everything else is dark. */
const listRecorder = (up, models = []) => {
  const calls = [];
  return {
    calls,
    fn: async (apiBase) => {
      calls.push(apiBase);
      return up.includes(apiBase) ? models : undefined;
    },
  };
};

const recordingPull = () => {
  const calls = [];
  return {
    calls,
    pull: async (apiBase, model, _signal, onProgress) => {
      calls.push({ apiBase, model });
      onProgress(1, "success");
      return undefined;
    },
  };
};

const clickEveryDownload = () => (_message, actions) => (actions.includes("Download") ? "Download" : undefined);

// ===========================================================================
// VERIFY: the gaps the blind oracle's host-blind `listModels` fake leaves
// ===========================================================================

test("VERIFY A1: on a remote apiBase the CATALOGUE is read from localhost, never from the remote host", async () => {
  // The blind oracle proves the PULL target moved. Its listModels fake answers
  // the same for every host, so no blind row can see which host was listed -
  // and the contract amendment's whole second half is about the list.
  resetState();
  __state.config = { apiBase: REMOTE };
  __state.quickPickImpl = async (items) => items[0];
  __state.infoImpl = clickEveryDownload();
  const out = output();
  const list = listRecorder([LOCAL], []);
  const { calls, pull } = recordingPull();

  await runFirstRunFlow(fakeContext(), out, { probe: referenceProbe(), listModels: list.fn, pull });

  assert.deepStrictEqual(
    list.calls,
    [LOCAL],
    `the readiness list must be read from the FIM host only, it asked ${JSON.stringify(list.calls)}`,
  );
  assert.deepStrictEqual(calls, [{ apiBase: LOCAL, model: FIM_MODEL }], `pulls: ${JSON.stringify(calls)}`);
});

test("VERIFY A2: a loopback apiBase on a NON-default port carries the whole first-run flow to that port", async () => {
  // Item 2 applied to firstRun, which no blind row reaches: a container
  // publishing 11500 must have BOTH its catalogue read and its models pulled
  // on 11500. A fix that pinned the FIM host to the literal default would
  // pass every blind item-2 row (they only read readConfig) and fail here.
  resetState();
  __state.config = { apiBase: "http://localhost:11500" };
  __state.quickPickImpl = async (items) => items[0];
  __state.infoImpl = clickEveryDownload();
  const out = output();
  const list = listRecorder(["http://localhost:11500"], []);
  const { calls, pull } = recordingPull();

  await runFirstRunFlow(fakeContext(), out, { probe: referenceProbe(), listModels: list.fn, pull });

  assert.deepStrictEqual(list.calls, ["http://localhost:11500"], "the catalogue is read on the container's port");
  assert.deepStrictEqual(
    calls.map((c) => c.apiBase),
    ["http://localhost:11500", "http://localhost:11500"],
    `both models are pulled to the container's port, got ${JSON.stringify(calls)}`,
  );
  assert.deepStrictEqual(
    calls.map((c) => c.model).sort(),
    [MODEL_30B, FIM_MODEL].sort(),
    "and both entries are still offered on a loopback endpoint",
  );
});

test("VERIFY A3: a cloud fn-gen provider WITH a remote apiBase still lands the FIM pull on localhost", async () => {
  // The arm the implementer's 'walk the arms' argument names but no row drives:
  // both suppressors firing at once.
  resetState();
  __state.config = { apiBase: REMOTE, fnGenProvider: "anthropic", cloudApiKey: "k" };
  __state.quickPickImpl = async (items) => items[0];
  __state.infoImpl = clickEveryDownload();
  const out = output();
  const list = listRecorder([LOCAL], []);
  const { calls, pull } = recordingPull();

  await runFirstRunFlow(fakeContext(), out, { probe: referenceProbe(), listModels: list.fn, pull });

  assert.deepStrictEqual(list.calls, [LOCAL], "the catalogue is local");
  assert.deepStrictEqual(calls, [{ apiBase: LOCAL, model: FIM_MODEL }], `pulls: ${JSON.stringify(calls)}`);
});

test("VERIFY A4 [REGRESSION]: the default arm reads and pulls exactly where it did before the carve", async () => {
  resetState();
  __state.quickPickImpl = async (items) => items[0];
  __state.infoImpl = clickEveryDownload();
  const out = output();
  const list = listRecorder([LOCAL], []);
  const { calls, pull } = recordingPull();

  await runFirstRunFlow(fakeContext(), out, { probe: referenceProbe(), listModels: list.fn, pull });

  assert.deepStrictEqual(list.calls, [LOCAL], "one list call, of localhost");
  assert.deepStrictEqual(
    calls.map((c) => c.apiBase),
    [LOCAL, LOCAL],
    "and both pulls to localhost, which is what item 4 means by 'changes nothing'",
  );
});

test("VERIFY A5: remote apiBase, healthy remote, DEAD localhost - the user is told the truth and nothing names the remote", async () => {
  // The scenario the review brief asks about. Before this phase the flow read
  // the REMOTE catalogue, so a live remote sailed past this branch and the FIM
  // model was checked against the wrong machine's model list.
  resetState();
  __state.config = { apiBase: REMOTE };
  __state.quickPickImpl = async (items) => items[0];
  __state.warnResponses = [undefined]; // dismiss, so nothing is spawned
  const out = output();
  const list = listRecorder([REMOTE], [FIM_MODEL]); // the remote is UP and even has the model
  const { calls, pull } = recordingPull();

  await runFirstRunFlow(fakeContext(), out, { probe: referenceProbe(), listModels: list.fn, pull });

  assert.deepStrictEqual(list.calls, [LOCAL], "it asks the host FIM actually uses");
  const warn = __state.messages.find((m) => m.kind === "warn");
  assert.ok(warn, `a down FIM host must be reported, got ${JSON.stringify(__state.messages)}`);
  assert.match(warn.message, /the Ollama server is not answering/);
  assert.ok(!warn.message.includes("gpu-box.invalid"), "and the sentence must not be about the remote host");
  assert.deepStrictEqual(warn.actions, ["Start ollama serve"], "the offered fix starts THIS box's server");
  assert.deepStrictEqual(calls, [], "and nothing is pulled anywhere");
});

test("VERIFY A6: fimReadiness inherits the carve - on a remote apiBase it asks localhost and only localhost", async () => {
  // extension.ts was not edited. This pins the inheritance the implementer
  // claimed rather than taking it on trust, and it pins the EXACT call list,
  // not just 'no remote call'.
  resetState();
  __state.config = { apiBase: REMOTE, fimModel: FIM_MODEL };
  const list = listRecorder([LOCAL], [FIM_MODEL]);
  const out = output();

  await warnIfFimNotReady(out, list.fn, async () => ({ stdout: "v", exitCode: 0 }));

  assert.deepStrictEqual(list.calls, [LOCAL], `readiness asked ${JSON.stringify(list.calls)}`);
  assert.deepStrictEqual(__state.messages, [], "and a healthy local FIM says nothing");
});

// ===========================================================================
// FINDING 1: the channel says "no local model pull" and then makes one
// ===========================================================================

test("FINDING 1: the remote arm logs '(no local model pull)' and then pulls a model locally, in the same run", async () => {
  // INPUT: column80.apiBase = http://gpu-box.invalid:11434, a 16GB box,
  //        localhost answering with an EMPTY catalogue, the user clicks
  //        Download on everything.
  //
  // OBSERVED: src/vscode/firstRun.ts:144 emits
  //   [carve] fn-gen backend=remote host=http://gpu-box.invalid:11434 (no local model pull)
  // and then src/vscode/firstRun.ts:212 pulls qwen2.5-coder:1.5b-base to
  // http://localhost:11434 and logs `[carve] pull ratified` / `[carve] pull done`.
  //
  // Before this phase that parenthetical was literally true on this arm: the
  // one pull the remote arm makes went to the remote host, so no model landed
  // locally. The diff moved the pull and left the sentence. The line is pinned
  // byte-for-byte by test/impl5-vscode.test.cjs:766, so it is a contracted
  // channel string, not a stray log.
  resetState();
  __state.config = { apiBase: REMOTE };
  __state.quickPickImpl = async (items) => items[0];
  __state.infoImpl = clickEveryDownload();
  const out = output();
  const { calls, pull } = recordingPull();

  await runFirstRunFlow(fakeContext(), out, {
    probe: referenceProbe(),
    listModels: listRecorder([LOCAL], []).fn,
    pull,
  });

  const claim = out.lines.find((l) => l.includes("backend=remote") && l.includes("(no local model pull)"));
  const localPulls = calls.filter((c) => c.apiBase === LOCAL);
  assert.ok(
    !(claim !== undefined && localPulls.length > 0),
    `the channel claims ${JSON.stringify(claim)} and then pulls ${JSON.stringify(localPulls)} to the local host in the same run. ` +
      `Either the parenthetical has to say which model class it means (it is about the fn-gen model), or the line has to move.`,
  );
});

// ===========================================================================
// FINDING 2: the retired policy sentence survives, one file over
// ===========================================================================

test("FINDING 2: impl5-vscode.test.cjs still asserts the retired 'FIM rides the same apiBase' policy, and is green under the new one", () => {
  // Contract item 5: "The comment at :180-183 states the old policy in so many
  // words, 'FIM's entry above still runs and is still right, because FIM rides
  // the same apiBase', and it is now false. Fix the target and the comment
  // together."
  //
  // The comment in src/vscode/firstRun.ts was fixed. The SAME sentence, as a
  // test name and as an assertion message, is still in
  // test/impl5-vscode.test.cjs:802-815, and that row is green - it asserts the
  // FIM entry is offered, which is still true, for a reason that is now false.
  // A reader who greps this repo for what apiBase does finds a passing test
  // whose title states the retired ruling.
  const src = fs.readFileSync(path.join(__dirname, "impl5-vscode.test.cjs"), "utf8");
  const stale = src
    .split("\n")
    .map((line, i) => [i + 1, line])
    .filter(([, line]) => /FIM rides the same apiBase|it genuinely uses this host/.test(line));
  assert.deepStrictEqual(
    stale,
    [],
    `these lines state the policy goal amendment A retired:\n${stale.map(([n, l]) => `  impl5-vscode.test.cjs:${n}: ${l.trim()}`).join("\n")}`,
  );
});

// ===========================================================================
// FINDING 3: the settings blurb was fixed in package.json only
// ===========================================================================

test("FINDING 3: docs/user-manual.md still tells the user column80.apiBase moves the whole of Ollama", () => {
  // Contract, "Also in scope": "a setting whose blurb contradicts its behaviour
  // is the next queue entry". package.json:357 was fixed. The user manual
  // carries the same blurb twice and neither was:
  //
  //   docs/user-manual.md:54   "- [Ollama] on `http://localhost:11434`
  //                             (`column80.apiBase` moves it)."
  //   docs/user-manual.md:561  "| `column80.apiBase` | http://localhost:11434
  //                             | Ollama base URL. |"
  //
  // Line 54 is under Requirements, and it is now actionably wrong: a user who
  // points apiBase at a GPU box reads that sentence as "I do not need Ollama on
  // this machine", and after this phase they do - FIM will not start without it,
  // and FIM failing is silent.
  const manual = fs.readFileSync(path.join(__dirname, "..", "docs", "user-manual.md"), "utf8");
  const lines = manual.split("\n");
  const requirement = lines.findIndex((l) => /column80\.apiBase.*moves it/.test(l));
  const table = lines.findIndex((l) => /\|\s*`column80\.apiBase`\s*\|/.test(l));
  const offenders = [];
  if (requirement >= 0) offenders.push(`user-manual.md:${requirement + 1}: ${lines[requirement].trim()}`);
  if (table >= 0 && !/FIM/i.test(lines[table])) offenders.push(`user-manual.md:${table + 1}: ${lines[table].trim()}`);
  assert.deepStrictEqual(
    offenders,
    [],
    `the manual still describes apiBase as moving all of Ollama:\n  ${offenders.join("\n  ")}`,
  );
});

// ===========================================================================
// NOTE: the helper's contract on inputs readConfig cannot produce
// ===========================================================================

test("NOTE: fimApiBase(\"\") returns \"\", not a servable base - unreachable today, load-bearing on str()", () => {
  // Not filed as a defect: `str()` in src/vscode/config.ts:34 substitutes the
  // default for "", so the only caller in src cannot pass "" through. Recorded
  // because `fimApiBase` is EXPORTED from core and documented as "Where FIM's
  // model is served", and the one thing standing between that doc comment and
  // an empty base is a guard in a different file. A second caller that reads a
  // FimConfig from anywhere but readConfig inherits "" silently.
  assert.strictEqual(fimApiBase(""), "", "documented here so the coupling is on the record");
  assert.strictEqual(fimApiBase("not a url at all"), "not a url at all", "unparseable stays put, per contract item 3");
  // The guard that makes the above unreachable, pinned:
  resetState();
  __state.config = { apiBase: "" };
  assert.strictEqual(readConfig().apiBase, LOCAL, "an emptied setting falls back before fimApiBase sees it");
  assert.strictEqual(readFnGenConfig().apiBase, LOCAL, "both halves, same guard");
});
