// Blind oracle, session-v55 phase 3: how many times the first-run flow runs,
// and in which windows. Queue Q24.
//
// RE-CUT after an adversarial pass found the phase-3 contract was factually
// wrong about VS Code in two ways, and this file's first cut inherited both.
// The corrected model, from VS Code's own source, is what everything below
// rests on:
//
//   1. There is ONE EXTENSION HOST PER WINDOW, always. Not one per workspace,
//      not one shared across windows. `extensionHostStarter.ts` mints a new
//      WindowUtilityProcess per window with `responseWindowId` bound to that
//      window, and VS Code's own blog says it verbatim: "There is one extension
//      host per opened window". So each window gets its own module instances,
//      its own `activate()`, and its own ExtensionContext. A module-level `let`
//      cannot be seen by the second window - which is the only window the Q24
//      defect is about. (VS Code also refuses to open one folder in two
//      windows, so "two windows of a workspace" is not a case that exists.)
//
//   2. `Memento.update` writes SYNCHRONOUSLY in memory. `extHostMemento.ts`:
//
//          update(key, value) {
//            this._value![key] = value;   // synchronous, unconditional
//            ...
//            return promise.p;            // tracks PERSISTENCE only
//          }
//
//      The returned Thenable reports that the value was persisted through a
//      debounced RPC. It is NOT a visibility barrier: a `get` on the next line
//      already sees the new value. `test/impl5-vscode.test.cjs:244` had this
//      right all along; this file's first cut had it wrong and was the odd one
//      out of two fakes for one API.
//
// What that costs the first cut: its item 1 went red at HEAD only because its
// fake made the write invisible, so an unfixed `if (get() !== true)` looked
// broken when in fact it is already a complete guard WITHIN one host. Under the
// faithful memento below, the same rows pass at HEAD. They are kept, relabelled
// as REGRESSION GUARDS: true today, and they must stay true.
//
// The real defect is in the KNOWN WRONG section at the bottom. Two windows are
// two hosts, so no in-process anything can see across them, and globalState
// reaches the other host only after a ~100ms debounce that an extension cannot
// observe. Those rows are GREEN BY ASSERTING THE BUG, this repo's usual way of
// recording an open defect. When a real fix lands they go red, and that red is
// the success signal.
//
// Run: npm run test:unit

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");

// ---- the vscode stub: same shape as test/impl5-vscode.test.cjs uses

const STUB = path.join(__dirname, ".blind-v55-p3-stub.cjs");
fs.writeFileSync(
  STUB,
  `
const state = {
  config: {},
  configInfo: {},
  updates: [],
  messages: [],
  infoResponses: [],
  warnResponses: [],
  errorResponses: [],
  opened: [],
  quickPicks: [],
  quickPickImpl: null,
  commands: {},
  terminals: [],
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
  ProgressLocation: { Notification: 15 },
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
      return state.infoResponses.shift();
    },
    showWarningMessage: async (message, ...actions) => {
      state.messages.push({ kind: "warn", message, actions });
      return state.warnResponses.shift();
    },
    showErrorMessage: async (message, ...actions) => {
      state.messages.push({ kind: "error", message, actions });
      return state.errorResponses.shift();
    },
    showQuickPick: async (items, opts) => {
      state.quickPicks.push({ items, opts });
      return state.quickPickImpl ? state.quickPickImpl(items, opts) : undefined;
    },
    withProgress: async (opts, task) =>
      task({ report: () => {} }, { onCancellationRequested: () => ({ dispose() {} }) }),
    createTerminal: (opts) => {
      const t = { name: opts.name, shown: false, sent: [], show() { this.shown = true; }, sendText(s) { this.sent.push(s); } };
      state.terminals.push(t);
      return t;
    },
    get terminals() { return state.terminals; },
    tabGroups: { all: [], onDidChangeTabs: () => ({ dispose() {} }), close: async () => {} },
  },
  commands: {
    registerCommand: (id, fn) => { state.commands[id] = fn; return { dispose() {} }; },
  },
  env: {
    openExternal: async (uri) => { state.opened.push(String(uri)); return true; },
  },
  Uri: { parse: (s) => s },
};
`,
);

const entry = path.join(__dirname, ".blind-v55-p3.entry.ts");
const outfile = path.join(__dirname, ".blind-v55-p3.bundle.cjs");
fs.writeFileSync(
  entry,
  `export { registerFirstRun, runFirstRunFlow } from "../src/vscode/firstRun";
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

test.after(() => {
  fs.rmSync(entry, { force: true });
  fs.rmSync(outfile, { force: true });
  fs.rmSync(STUB, { force: true });
});

/**
 * A new extension host, which in VS Code means A NEW WINDOW. A fresh module
 * instance is the faithful model: its own copy of every module-level binding,
 * its own command registry, its own notifications. Two calls to this are two
 * windows and can share nothing but storage.
 */
const newHost = () => {
  delete require.cache[require.resolve(outfile)];
  const world = require(outfile);
  world.__state.quickPickImpl = async () => undefined; // dismissed by default
  return world;
};

// ---- the globalState fake, modelled on extHostMemento + the storage service

/** VS Code's STORAGE_CHANGE_DEBOUNCE_TIME: how long a write waits before other
 *  hosts are told about it. */
const STORAGE_CHANGE_DEBOUNCE_MS = 100;

/**
 * One storage file, N hosts. Each host holds its own in-memory blob, which is
 * what its Memento reads and writes. Three properties are modelled because all
 * three decide what a guard built on this API can and cannot do:
 *
 *   - `update` mutates the LOCAL blob synchronously and returns a promise that
 *     resolves when the value is persisted. Reading back on the next line sees
 *     it (extHostMemento.ts).
 *   - Other hosts see it only after the debounce, and Memento exposes NO change
 *     event, so an extension cannot even wait for it.
 *   - Propagation REPLACES the whole per-extension blob rather than merging
 *     keys, so two hosts writing different keys inside one debounce window is
 *     last-write-wins and one key is simply lost.
 */
const storageBackend = (initial = {}) => {
  let persisted = { ...initial };
  const hosts = [];
  const dirty = new Set();
  let timer = null;
  let neverPersist = false;
  const waiters = [];

  // The debounce covers the persist AND the broadcast: an in-memory write is
  // not on disk either until the timer fires, which is why a window opening in
  // the meantime still reads the old blob.
  const flush = () => {
    timer = null;
    for (const h of dirty) persisted = { ...h.blob }; // whole blob, last writer wins
    dirty.clear();
    for (const h of hosts) h.blob = { ...persisted }; // whole-blob replace
    for (const w of waiters.splice(0)) w();
  };

  const openMemento = () => {
    // A host starts up by reading what is on disk right now.
    const host = { blob: { ...persisted } };
    hosts.push(host);
    return {
      keys: () => Object.keys(host.blob),
      setKeysForSync: () => {},
      get: (k, fallback) => (k in host.blob ? host.blob[k] : fallback),
      update: (k, v) => {
        host.blob[k] = v; // synchronous and unconditional, exactly as VS Code does it
        dirty.add(host); // this host's whole blob goes to storage at flush time
        if (neverPersist) return new Promise(() => {});
        if (!timer) timer = setTimeout(flush, STORAGE_CHANGE_DEBOUNCE_MS);
        return new Promise((resolve) => waiters.push(resolve));
      },
    };
  };

  return {
    /** One window's ExtensionContext. One host gets exactly one of these. */
    context: () => ({ subscriptions: [], globalState: openMemento() }),
    onDisk: () => ({ ...persisted }),
    /** Resolves once a pending write has reached the other hosts. */
    whenPropagated: () => new Promise((resolve) => (timer ? waiters.push(resolve) : resolve())),
    stallPersistence: () => {
      neverPersist = true;
    },
  };
};

const FIRST_RUN_KEY = "column80.firstRunDone";
const FIM_MODEL = "qwen2.5-coder:1.5b-base";
const MODEL_30B = "qwen3-coder:30b";

const output = () => {
  const lines = [];
  return { lines, appendLine: (l) => lines.push(l) };
};

// Injected so no row ever spawns host nvidia-smi.
const referenceProbe = () => ({
  runCommand: async () => ({ stdout: "16303\n", exitCode: 0 }),
  totalMemBytes: () => 61826 * 1048576,
});
// A probe that never answers: used only to prove activation does not await it.
const hangingProbe = () => ({
  runCommand: () => new Promise(() => {}),
  totalMemBytes: () => 61826 * 1048576,
});

const quietDeps = () => ({ probe: referenceProbe(), listModels: async () => [FIM_MODEL, MODEL_30B] });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const waitFor = async (predicate, what, budgetMs = 2000) => {
  for (let i = 0; i < budgetMs / 10; i++) {
    if (predicate()) return;
    await sleep(10);
  }
  assert.fail(`timed out waiting for ${what}`);
};

// Long enough for a second flow, a second picker or a late write to show up.
const settle = () => sleep(250);

// A channel that saw the flow: the tier evidence is the flow's own first output.
const flowsIn = (out) => out.lines.filter((l) => l.startsWith("[carve] probe vram=")).length;
const ranFlow = (out) => flowsIn(out) > 0;

// ---- the rig itself. Every row below inherits this model, so it is pinned
// here rather than assumed. It is a model of a cited source, not a measurement
// of VS Code: fidelity rests on extHostMemento.ts and the storage service, and
// if those change this row is where the correction goes.

test("RIG: a globalState write is visible to the writing host at once, and to other hosts only after the debounce", async () => {
  const backend = storageBackend();
  const windowA = backend.context();
  const windowB = backend.context();

  const persisting = windowA.globalState.update(FIRST_RUN_KEY, true);
  assert.strictEqual(
    windowA.globalState.get(FIRST_RUN_KEY),
    true,
    "the writing host sees its own write immediately - the Thenable is not a visibility barrier",
  );
  assert.strictEqual(
    windowB.globalState.get(FIRST_RUN_KEY),
    undefined,
    "another window does not, yet: this is the whole of the Q24 window",
  );

  await persisting;
  assert.strictEqual(windowB.globalState.get(FIRST_RUN_KEY), true, "and does once the write has propagated");
});

test("RIG: propagation replaces the whole blob, so two hosts writing different keys inside one window lose one", async () => {
  const backend = storageBackend();
  const windowA = backend.context();
  const windowB = backend.context();

  await Promise.all([
    windowA.globalState.update("column80.keyFromA", 1),
    windowB.globalState.update("column80.keyFromB", 2),
  ]);

  const disk = backend.onDisk();
  assert.ok(
    !("column80.keyFromA" in disk) || !("column80.keyFromB" in disk),
    "last write wins on the whole blob - which is why globalState cannot be used as a lock",
  );
});

// ---- REGRESSION GUARDS: true at HEAD, and they must stay true.
//
// These are NOT evidence of a fix. Within one host the existing
// `if (get() !== true)` is already a complete guard, because the memento write
// is synchronous. They exist so a future change cannot quietly break the guard
// that does work.

test("REGRESSION: one host, two activations - the flow runs once, the second is silent", async () => {
  const host = newHost();
  const backend = storageBackend();
  const context = backend.context(); // one host gets exactly one ExtensionContext
  const out = output();
  const deps = quietDeps();

  // Back to back in the same tick: no await can intervene, so this is the
  // hardest ordering the existing guard has to survive.
  host.registerFirstRun(context, out, deps);
  host.registerFirstRun(context, out, deps);

  await waitFor(() => ranFlow(out), "the activation-time first run");
  await settle();

  assert.strictEqual(flowsIn(out), 1, `exactly one flow, got ${JSON.stringify(out.lines)}`);
  assert.strictEqual(host.__state.quickPicks.length, 1, "the user is offered exactly one tier picker");
  assert.deepStrictEqual(host.__state.messages, [], "and nothing else is shown");
  assert.strictEqual(context.globalState.get(FIRST_RUN_KEY), true, "the install is marked done");
});

test("REGRESSION: the second activation reads the key the first one wrote, without waiting for persistence", async () => {
  const host = newHost();
  const backend = storageBackend();
  backend.stallPersistence(); // the write never reaches disk or any other host
  const context = backend.context();
  const out = output();

  host.registerFirstRun(context, out, quietDeps());
  host.registerFirstRun(context, out, quietDeps());

  await waitFor(() => ranFlow(out), "the activation-time first run");
  await settle();
  assert.strictEqual(
    flowsIn(out),
    1,
    "the in-memory write is what guards the second activation, so a stalled persist cannot double the ask",
  );
});

// ---- item 3: the single-window path

test("item 3a: one window, key unset - the flow runs exactly once", async () => {
  const host = newHost();
  const backend = storageBackend();
  const out = output();

  host.registerFirstRun(backend.context(), out, quietDeps());

  await waitFor(() => ranFlow(out), "the single-window first run");
  await settle();
  assert.strictEqual(flowsIn(out), 1, `one flow, got ${JSON.stringify(out.lines)}`);
  assert.strictEqual(host.__state.quickPicks.length, 1, "one picker");
  assert.strictEqual(backend.onDisk()[FIRST_RUN_KEY], true, "and it is persisted for the next window");
});

test("item 3b: one window, key already true - the flow runs zero times", async () => {
  const host = newHost();
  const backend = storageBackend({ [FIRST_RUN_KEY]: true });
  const out = output();

  host.registerFirstRun(backend.context(), out, quietDeps());

  await settle();
  assert.deepStrictEqual(out.lines, [], "an install that already asked stays quiet");
  assert.deepStrictEqual(host.__state.quickPicks, [], "and shows no picker");
  assert.ok(host.__state.commands["column80.selectHardwareTier"], "the command is still registered");
});

// ---- item 4

test("item 4: a DISMISSED flow still counts as the one automatic ask - the next window does not re-ask", async () => {
  const hostA = newHost();
  const backend = storageBackend();
  const first = output();

  hostA.registerFirstRun(backend.context(), first, quietDeps()); // the user dismisses the picker
  await waitFor(() => ranFlow(first), "the first ask");
  await backend.whenPropagated();
  await settle();
  assert.strictEqual(backend.onDisk()[FIRST_RUN_KEY], true, "dismissing still marks the install asked");

  const hostB = newHost(); // a later window, opened after the write settled
  const second = output();
  hostB.registerFirstRun(backend.context(), second, quietDeps());
  await settle();
  assert.deepStrictEqual(second.lines, [], "a user who dismissed is not asked again automatically");
  assert.deepStrictEqual(hostB.__state.quickPicks, [], "no second picker");
});

// ---- item 5

test("item 5: a flow that THROWS still leaves the key marked done, so a crash cannot loop the ask forever", async () => {
  const hostA = newHost();
  hostA.__state.quickPickImpl = () => {
    throw new Error("BOOM: the first-run flow crashed");
  };
  const backend = storageBackend();

  // Rig check first: this injected crash really does escape runFirstRunFlow, so
  // the activation leg below is exercising a crash and not a quiet dismissal.
  await assert.rejects(
    () => hostA.runFirstRunFlow(backend.context(), output(), quietDeps()),
    /BOOM/,
    "the lever must actually throw out of the flow",
  );

  const out = output();
  hostA.registerFirstRun(backend.context(), out, quietDeps());
  await waitFor(() => hostA.__state.quickPicks.length >= 2, "the activation flow reaching the crash point");
  await backend.whenPropagated();
  await settle();

  assert.strictEqual(
    backend.onDisk()[FIRST_RUN_KEY],
    true,
    "the key is marked done even though the flow blew up - this is what stops an infinite re-ask",
  );

  const hostB = newHost();
  const second = output();
  hostB.registerFirstRun(backend.context(), second, quietDeps());
  await settle();
  assert.deepStrictEqual(second.lines, [], "and the next window does not re-ask after the crash");
});

// ---- item 6: the command path carries no guard at all

test("item 6: the Select Hardware Tier command is NOT guarded - it re-runs every time, forever", async () => {
  const host = newHost();
  const backend = storageBackend({ [FIRST_RUN_KEY]: true }); // guard fully closed
  const out = output();

  host.registerFirstRun(backend.context(), out, quietDeps());
  await settle();
  assert.deepStrictEqual(out.lines, [], "activation asked nothing");

  const run = host.__state.commands["column80.selectHardwareTier"];
  assert.ok(run, "the command exists");
  await run();
  await run();
  await run();
  assert.strictEqual(flowsIn(out), 3, `three invocations, three flows, got ${JSON.stringify(out.lines)}`);
  assert.strictEqual(host.__state.quickPicks.length, 3, "and three pickers, one per deliberate invocation");
});

test("item 6: a second window's command still runs after the first window did the automatic ask", async () => {
  const hostA = newHost();
  const backend = storageBackend();
  const outA = output();
  hostA.registerFirstRun(backend.context(), outA, quietDeps());
  await waitFor(() => ranFlow(outA), "the first window's automatic ask");
  await backend.whenPropagated();

  const hostB = newHost();
  const outB = output();
  hostB.registerFirstRun(backend.context(), outB, quietDeps());
  await settle();
  assert.deepStrictEqual(outB.lines, [], "the second window asks nothing automatically");

  await hostB.__state.commands["column80.selectHardwareTier"]();
  assert.strictEqual(flowsIn(outB), 1, "but a deliberate invocation there is honoured in full");
});

// ---- item 7

test("item 7: activation adds no unbounded await - registerFirstRun returns immediately even when persistence never lands", async () => {
  const host = newHost();
  const backend = storageBackend();
  backend.stallPersistence(); // the debounced RPC never completes
  const out = output();

  const t0 = Date.now();
  const returned = host.registerFirstRun(backend.context(), out, {
    probe: hangingProbe(),
    listModels: () => new Promise(() => {}),
  });
  const elapsed = Date.now() - t0;

  assert.ok(
    returned === undefined || typeof returned.then !== "function",
    "activation does not hand back a promise the extension host would have to wait on",
  );
  assert.ok(elapsed < 50, `registerFirstRun must not block activation, took ${elapsed}ms`);
  assert.ok(
    host.__state.commands["column80.selectHardwareTier"],
    "and the command is registered before it returns, even with a stuck storage write",
  );
});

// ---- KNOWN WRONG: queue Q24, open and unfixed.
//
// These rows are GREEN BY ASSERTING THE DEFECT. Two windows are two extension
// hosts, so nothing in process can coordinate them, and globalState reaches the
// other host only after STORAGE_CHANGE_DEBOUNCE_TIME with no change event to
// wait on. Two windows launched together therefore both run the flow: two tier
// pickers, and two concurrent pulls of the same model.
//
// WHEN A REAL FIX LANDS THESE GO RED, AND THAT RED IS SUCCESS. Rewrite them to
// assert one flow at that point; do not delete them and do not weaken them
// meanwhile. A fix has to be cross-host - a lock file under global storage with
// stale-lock handling - because no module state and no globalState read can see
// the other window in time.

test("KNOWN WRONG (Q24): two windows launched together BOTH run the first-run flow", async () => {
  const windowA = newHost();
  const windowB = newHost();
  const backend = storageBackend();
  const outA = output();
  const outB = output();

  // Both hosts start up before either write has propagated: two icons clicked
  // together, or a session restore reopening two windows. Both contexts are
  // opened first, because that is the part that decides the outcome - each host
  // reads storage at its own startup.
  const contextA = backend.context();
  const contextB = backend.context();
  windowA.registerFirstRun(contextA, outA, quietDeps());
  windowB.registerFirstRun(contextB, outB, quietDeps());

  await waitFor(() => ranFlow(outA) && ranFlow(outB), "both windows to run the flow", 1000);
  assert.strictEqual(flowsIn(outA) + flowsIn(outB), 2, "the defect: the ask happens twice");
  assert.strictEqual(
    windowA.__state.quickPicks.length + windowB.__state.quickPicks.length,
    2,
    "and the user is handed two tier pickers, which is what Q24 is about",
  );
});

test("KNOWN WRONG (Q24): the window is the storage debounce - a window opened after it does not re-ask", async () => {
  const windowA = newHost();
  const backend = storageBackend();
  const outA = output();
  windowA.registerFirstRun(backend.context(), outA, quietDeps());
  await waitFor(() => ranFlow(outA), "the first window's ask");

  // Past the debounce, the write has reached storage and any host started from
  // here reads it. The defect is bounded at roughly STORAGE_CHANGE_DEBOUNCE_MS
  // plus the IPC hops, not open-ended - which is the honest size of it.
  await backend.whenPropagated();
  const windowB = newHost();
  const outB = output();
  windowB.registerFirstRun(backend.context(), outB, quietDeps());
  await settle();

  assert.deepStrictEqual(outB.lines, [], "a window opened later is correctly quiet");
  assert.deepStrictEqual(windowB.__state.quickPicks, [], "and gets no picker");
});
