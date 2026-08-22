// BLIND CONTRACT TEST - v21 phase 2: the two configuration nudges.
//
// Written from the phase 2 surface and nothing else. src/vscode/firstRun.ts
// was NOT read - not opened, not grepped, not inspected through bundle output.
// esbuild resolves it at bundle time only. Expected RED until phase 2 ships.
//
// What it pins:
//
//   ITEM 1 - the snippet-nudge gate (offerRaSnippetFix), one section per branch.
//     A. ALREADY OFF: no write of ANY kind (configuration, globalState,
//        workspaceState), and a later call in a workspace whose effective value
//        renders arguments again still offers. Reading "none" in one workspace
//        must not answer the question for the whole install.
//     B. DECLINED: persisted, so the same workspace is not asked twice, and it
//        survives a restart - but a decline must NOT silence the offer in a
//        workspace whose effective value is different. Either workspaceState or
//        re-offer on value change satisfies this; the test does not care which.
//     C. ACCEPTED: ratify line lands BEFORE the write, the write target is
//        ConfigurationTarget.Global.
//     D. IN FLIGHT: a second member site while the first message is still
//        pending opens no second offer; and a message dismissed WITHOUT an
//        answer (resolving undefined) is not an answer, so a later call still
//        offers. That second half is the behaviour change - today a faded toast
//        counts as answered.
//
//   ITEM 2 - the hover-cap nudge. The surface does not name the export, so this
//     file DEFINES it, and the name is a contract, not a guess:
//
//        offerRaHoverCapFix(context, languageId, output) -> Promise<boolean>
//
//     same signature shape as offerRaSnippetFix, fired from the same member-site
//     trigger. It is Rust-only, offers only while at least one of
//     rust-analyzer.hover.show.fields / hover.show.enumVariants is capped low
//     enough to truncate, one click sets BOTH, ratify before write, target
//     Global, and it does not share a persistence key with the snippet nudge.
//
// The export may not exist yet. It is resolved DYNAMICALLY off the bundle
// namespace, so a missing symbol fails one assertion with a clear message
// instead of taking the file down with a bundle error. A build failure or a
// harness throw is a bug in this file, not a contract failure.
//
// Run: SKIP_LIVE=1 node --test test/blind-v21-p2.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");

const SNIPPET_KEY = "rust-analyzer.completion.callable.snippets";
const FIELDS_KEY = "rust-analyzer.hover.show.fields";
const VARIANTS_KEY = "rust-analyzer.hover.show.enumVariants";
const HOVER_KEYS = [FIELDS_KEY, VARIANTS_KEY];

// rust-analyzer's shipped defaults, which is what truncates at 5 of 12.
const CAPPED = 5;
// A value nobody would call a truncating cap. The measured run used 64.
const RAISED = 64;

// ---- stub vscode (the blind-v19-ra-nudge stub, plus a deferrable message)

const STUB = path.join(__dirname, ".blind-v21-p2-stub.cjs");
fs.writeFileSync(
  STUB,
  `
const state = {
  config: {},          // "section.key" -> effective value
  reads: [],           // { section, key } per get()
  sections: [],        // every getConfiguration(section) call
  updates: [],         // { section, key, value, target }
  messages: [],        // { kind, message, actions }
  respond: () => undefined, // (message, actions) -> clicked action, or a promise of one
  terminals: [],
  commands: {},
};
const flat = (section, key) => (section ? section + "." + key : key);
const configFor = (section) => {
  state.sections.push(section);
  return {
    get: (key, fallback) => {
      state.reads.push({ section, key });
      const k = flat(section, key);
      return k in state.config ? state.config[k] : fallback;
    },
    inspect: (key) => {
      state.reads.push({ section, key });
      const k = flat(section, key);
      return k in state.config ? { globalValue: state.config[k] } : undefined;
    },
    update: async (key, value, target) => {
      state.updates.push({ section, key, value, target });
      state.config[flat(section, key)] = value;
    },
  };
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
    getConfiguration: (section) => configFor(section),
    onDidChangeConfiguration: () => ({ dispose() {} }),
    registerTextDocumentContentProvider: () => ({ dispose() {} }),
  },
  window: {
    showInformationMessage: async (message, ...actions) => {
      state.messages.push({ kind: "info", message, actions });
      return state.respond(message, actions);
    },
    showWarningMessage: async (message, ...actions) => {
      state.messages.push({ kind: "warn", message, actions });
      return state.respond(message, actions);
    },
    showErrorMessage: async (message, ...actions) => {
      state.messages.push({ kind: "error", message, actions });
      return state.respond(message, actions);
    },
    showQuickPick: async () => undefined,
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
  commands: { registerCommand: (id, fn) => { state.commands[id] = fn; return { dispose() {} }; } },
  env: { openExternal: async () => true },
  Uri: { parse: (s) => s, file: (s) => s },
};
`,
);

const entry = path.join(__dirname, ".blind-v21-p2.entry.ts");
const outfile = path.join(__dirname, ".blind-v21-p2.bundle.cjs");
fs.writeFileSync(
  entry,
  `export * from "../src/vscode/firstRun";
export { __state } from "vscode";\n`,
);

let bundle;
let loadError;
try {
  esbuild.buildSync({
    entryPoints: [entry],
    bundle: true,
    outfile,
    format: "cjs",
    platform: "node",
    alias: { vscode: STUB },
  });
  bundle = require(outfile);
} catch (err) {
  loadError = err;
}
test.after(() => {
  fs.rmSync(entry, { force: true });
  fs.rmSync(outfile, { force: true });
  fs.rmSync(STUB, { force: true });
});

// ---- binding the two surfaces, dynamically, so a missing export is a
// contract failure with a readable message rather than a bundle error

const SNIPPET_ALIASES = ["offerRaSnippetFix", "offerRustAnalyzerSnippetFix", "offerRaSnippetNudge"];
// Named here, on purpose. The implementer owes this exact symbol.
const HOVER_ALIASES = ["offerRaHoverCapFix"];

const resolveExport = (aliases, what) => {
  if (loadError) assert.fail(`the vscode layer would not bundle: ${loadError.message}`);
  for (const name of aliases) {
    if (typeof bundle[name] === "function") return bundle[name];
  }
  assert.fail(
    `${what}: src/vscode/firstRun.ts exports no ${aliases.join(" / ")}. ` +
      `This name is part of the phase 2 contract. Exports are: ${Object.keys(bundle).join(", ")}`,
  );
};

const snippetNudge = () => resolveExport(SNIPPET_ALIASES, "item 1");
const hoverNudge = () => resolveExport(HOVER_ALIASES, "item 2");

const __state = () => bundle.__state;

// ---- harness

const resetState = (config = {}) => {
  const s = __state();
  s.config = { ...config };
  s.reads = [];
  s.sections = [];
  s.updates = [];
  s.messages = [];
  s.respond = () => undefined;
  s.terminals = [];
  s.commands = {};
};

const memento = (store, scope, writes) => ({
  get: (k, fallback) => (k in store ? store[k] : fallback),
  update: async (k, v) => {
    writes.push({ scope, key: k, value: v });
    store[k] = v;
  },
  keys: () => Object.keys(store),
  setKeysForSync() {},
});

// One install. `globalStore` survives every restart and every workspace;
// `workspaceStore` is what a different project would NOT share.
const install = (globalStore = {}, workspaceStore = {}) => {
  const writes = [];
  return {
    globalStore,
    workspaceStore,
    stateWrites: writes,
    subscriptions: [],
    globalState: memento(globalStore, "global", writes),
    workspaceState: memento(workspaceStore, "workspace", writes),
  };
};

// The output channel doubles as a clock: every line records how many
// configuration writes had happened when it was appended, which is how
// "ratify BEFORE write" is measured without reading the implementation.
const output = () => {
  const lines = [];
  const updatesBefore = [];
  return {
    lines,
    updatesBefore,
    appendLine: (l) => {
      lines.push(l);
      updatesBefore.push(__state().updates.length);
    },
  };
};

const label = (a) => (typeof a === "string" ? a : String(a && a.title));
const DECLINE_RE = /not now|no thanks|no,|keep|dismiss|later|leave|cancel|never/i;

const classify = (actions) => {
  const decline = actions.find((a) => DECLINE_RE.test(label(a)));
  const accept = actions.find((a) => a !== decline);
  return { accept, decline };
};

const answerWith = (kind) => {
  __state().respond = (message, actions) => {
    if (kind === "dismiss") return undefined;
    const { accept, decline } = classify(actions);
    if (kind === "accept") {
      assert.ok(accept, `no accepting action among ${JSON.stringify(actions.map(label))}`);
      return accept;
    }
    assert.ok(decline, `no declining action among ${JSON.stringify(actions.map(label))}`);
    return decline;
  };
};

const flatKey = (u) => `${u.section ? u.section + "." : ""}${u.key}`;
const writesTo = (...keys) => __state().updates.filter((u) => keys.includes(flatKey(u)));
const offers = () => __state().messages;
const offerText = () => JSON.stringify(offers().map((m) => m.message));

// Drive the two features through one seam each.
const visitSnippet = (ctx, languageId = "rust", out = output()) => snippetNudge()(ctx, languageId, out);
const visitHover = (ctx, languageId = "rust", out = output()) => hoverNudge()(ctx, languageId, out);

// A pending message that the test resolves by hand: the modeless toast still
// on screen while the developer keeps typing.
const pendingOffer = () => {
  let settle;
  const gate = new Promise((res) => {
    settle = res;
  });
  __state().respond = () => gate;
  return {
    dismiss: () => settle(undefined),
    answer: (kind) => {
      const last = offers()[offers().length - 1];
      const { accept, decline } = classify(last.actions);
      settle(kind === "accept" ? accept : decline);
    },
  };
};

const withTimeout = (p, ms, what) =>
  Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`${what}: still hanging after ${ms}ms`)), ms).unref()),
  ]);

// ============================================================================
// ITEM 1 - A. ALREADY OFF
// ============================================================================

test("item 1A: a workspace where the setting is already off writes nothing at all", async () => {
  resetState({ [SNIPPET_KEY]: "none" });
  answerWith("accept");
  const ctx = install();
  const result = await visitSnippet(ctx);

  assert.strictEqual(offers().length, 0, `nothing to ask, got ${offerText()}`);
  assert.strictEqual(result, false, "the function reports that it did not offer");
  assert.deepStrictEqual(__state().updates, [], "no configuration write");
  assert.deepStrictEqual(
    ctx.stateWrites,
    [],
    "no write of ANY kind: an install-wide 'answered' flag inferred from one workspace's settings.json " +
      "is exactly the bug item 1 exists to remove",
  );
  assert.deepStrictEqual(ctx.globalStore, {}, "globalState untouched");
  assert.deepStrictEqual(ctx.workspaceStore, {}, "workspaceState untouched");
});

test("item 1A: reading 'none' in one project does not silence the nudge in the next project", async () => {
  const globalStore = {};

  // Project one pins the setting off in .vscode/settings.json. Right answer
  // there, and the question stays open everywhere else.
  resetState({ [SNIPPET_KEY]: "none" });
  answerWith("accept");
  const projectOne = install(globalStore, {});
  for (let i = 0; i < 10; i++) await visitSnippet(projectOne);
  assert.strictEqual(offers().length, 0, "project one had nothing to ask");

  // Project two, same machine, same install. rust-analyzer falls back to its
  // fill_arguments default, so the arrow-to-ghost gesture is broken here.
  resetState({ [SNIPPET_KEY]: "fill_arguments" });
  answerWith("decline");
  const projectTwo = install(globalStore, {});
  await visitSnippet(projectTwo);
  assert.strictEqual(
    offers().length,
    1,
    "the effective value renders arguments again, so the offer must still be live; " +
      `got ${offerText()}. A short-circuit on a globalState flag written from project one is the defect.`,
  );
});

// ============================================================================
// ITEM 1 - B. DECLINED
// ============================================================================

test("item 1B: a decline is remembered in the workspace it was given, across calls and restarts", async () => {
  resetState({ [SNIPPET_KEY]: "fill_arguments" });
  answerWith("decline");
  const globalStore = {};
  const workspaceStore = {};
  await visitSnippet(install(globalStore, workspaceStore));
  assert.strictEqual(offers().length, 1, "the offer was made once");
  assert.deepStrictEqual(__state().updates, [], "a decline writes no configuration");

  // Same project, fresh session: both stores carry over, the config has not moved.
  answerWith("accept"); // a re-offer would now write, which makes the failure loud
  for (let i = 0; i < 10; i++) await visitSnippet(install(globalStore, workspaceStore));
  assert.strictEqual(offers().length, 1, `the decline survived the restart, got ${offerText()}`);
  assert.deepStrictEqual(__state().updates, [], "a re-offer would have written; nothing did");
});

test("item 1B: a decline in one workspace does not answer for a workspace whose effective value differs", async () => {
  const globalStore = {};

  resetState({ [SNIPPET_KEY]: "fill_arguments" });
  answerWith("decline");
  await visitSnippet(install(globalStore, {}));
  assert.strictEqual(offers().length, 1, "the first project asked and was told no");

  // Another project. Different effective value, still renders arguments, so
  // the trade on offer is a different one from the one that was declined.
  // Passes on workspaceState persistence, and passes on a global flag that
  // re-offers when the effective value changes. Fails only on a bare
  // value-blind globalState flag.
  resetState({ [SNIPPET_KEY]: "add_parentheses" });
  answerWith("decline");
  await visitSnippet(install(globalStore, {}));
  assert.strictEqual(
    offers().length,
    1,
    `the second workspace must be asked in its own right, got ${offerText()}`,
  );
});

// ============================================================================
// ITEM 1 - C. ACCEPTED
// ============================================================================

test("item 1C: accepting ratifies on the channel first, then writes Global, then reports true", async () => {
  resetState({ [SNIPPET_KEY]: "fill_arguments" });
  const out = output();
  let linesAtClick = 0;
  __state().respond = (message, actions) => {
    linesAtClick = out.lines.length;
    return classify(actions).accept;
  };
  const result = await visitSnippet(install(), "rust", out);

  const writes = writesTo(SNIPPET_KEY);
  assert.strictEqual(writes.length, 1, `exactly one write, got ${JSON.stringify(__state().updates)}`);
  assert.strictEqual(writes[0].value, "none", "the accepted setting");
  assert.strictEqual(
    writes[0].target,
    1,
    "ConfigurationTarget.Global: an install-wide preference, not a .vscode/settings.json a repo may track",
  );
  assert.strictEqual(result, true, "an accepted offer reports true");

  const ratify = out.lines
    .map((line, i) => ({ line, before: out.updatesBefore[i], i }))
    .filter((r) => r.i >= linesAtClick && r.before === 0);
  assert.ok(
    ratify.length > 0,
    `a ratify line must land BEFORE the configuration write. Lines: ${JSON.stringify(out.lines)}, ` +
      `writes-already-done per line: ${JSON.stringify(out.updatesBefore)}`,
  );
  assert.ok(
    ratify.some((r) => /rust-analyzer|snippet|argument/i.test(r.line)),
    `the ratify line names whose setting is about to be touched, got ${JSON.stringify(ratify.map((r) => r.line))}`,
  );
});

// ============================================================================
// ITEM 1 - D. IN FLIGHT
// ============================================================================

test("item 1D: a second member site under a still-open message opens no second offer", async () => {
  resetState({ [SNIPPET_KEY]: "fill_arguments" });
  const gate = pendingOffer();
  const ctx = install();

  const first = visitSnippet(ctx);
  await new Promise((r) => setTimeout(r, 5));
  assert.strictEqual(offers().length, 1, "the first member site opened the offer");
  assert.deepStrictEqual(
    ctx.stateWrites,
    [],
    "while the message is still on screen nothing is persisted yet: the guard is an in-memory in-flight " +
      "flag, and persistence happens on the reply. Writing the flag before the await is what makes a " +
      "faded toast count as answered",
  );

  // The developer keeps typing under the modeless toast.
  for (let i = 0; i < 5; i++) {
    await withTimeout(visitSnippet(ctx), 500, "a member site under an in-flight offer");
  }
  assert.strictEqual(
    offers().length,
    1,
    `only one message may be on screen at a time, got ${offerText()}`,
  );

  gate.answer("decline");
  await withTimeout(first, 500, "the in-flight offer after the click");
});

test("item 1D: a toast that fades without an answer is not an answer - a later member site still offers", async () => {
  resetState({ [SNIPPET_KEY]: "fill_arguments" });
  const ctx = install();

  // Dismissed without a click: showInformationMessage resolves undefined.
  answerWith("dismiss");
  await visitSnippet(ctx);
  assert.strictEqual(offers().length, 1, "the offer was shown");
  assert.deepStrictEqual(__state().updates, [], "a dismissal is not a yes");
  assert.deepStrictEqual(
    ctx.stateWrites,
    [],
    "an unanswered message persists nothing: the question was never answered",
  );

  // Later, still typing Rust, still rendering arguments.
  answerWith("decline");
  await visitSnippet(ctx);
  assert.strictEqual(
    offers().length,
    2,
    "the faded toast must not count as answered - this is the v21 behaviour change",
  );
});

// ============================================================================
// ITEM 2 - the hover-cap nudge
// ============================================================================

test("item 2: offerRaHoverCapFix exists on firstRun.ts with the snippet nudge's signature shape", () => {
  const fn = hoverNudge();
  assert.strictEqual(typeof fn, "function", "the hover-cap nudge is exported");
  assert.strictEqual(
    fn.length,
    3,
    "same shape as offerRaSnippetFix: (context, languageId, output)",
  );
});

test("item 2: Rust only, and no other language pays a configuration read for it", async () => {
  for (const languageId of ["typescript", "typescriptreact", "csharp", "python", "plaintext"]) {
    resetState({ [FIELDS_KEY]: CAPPED, [VARIANTS_KEY]: CAPPED });
    answerWith("accept");
    const ctx = install();
    await visitHover(ctx, languageId);
    assert.strictEqual(offers().length, 0, `${languageId}: expected silence, got ${offerText()}`);
    assert.deepStrictEqual(__state().reads, [], `${languageId}: the language gate comes before any config read`);
    assert.deepStrictEqual(__state().updates, [], `${languageId}: nothing written`);
    assert.deepStrictEqual(ctx.stateWrites, [], `${languageId}: nothing persisted`);
  }
});

test("item 2: it offers only while a cap is low enough to truncate", async () => {
  const cases = [
    { fields: CAPPED, variants: CAPPED, offers: true, why: "both at the truncating default" },
    { fields: CAPPED, variants: RAISED, offers: true, why: "fields still truncates" },
    { fields: RAISED, variants: CAPPED, offers: true, why: "enum variants still truncates" },
    { fields: RAISED, variants: RAISED, offers: false, why: "already raised, so there is nothing to ask" },
  ];
  for (const c of cases) {
    resetState({ [FIELDS_KEY]: c.fields, [VARIANTS_KEY]: c.variants });
    answerWith("decline");
    const ctx = install();
    const result = await visitHover(ctx);
    assert.strictEqual(
      offers().length,
      c.offers ? 1 : 0,
      `${c.why} (fields=${c.fields}, enumVariants=${c.variants}): got ${offerText()}`,
    );
    if (!c.offers) {
      assert.strictEqual(result, false, `${c.why}: reports no offer`);
      assert.deepStrictEqual(__state().updates, [], `${c.why}: no configuration write`);
      assert.deepStrictEqual(
        ctx.stateWrites,
        [],
        `${c.why}: nothing persisted either - never assume the value you READ is global`,
      );
    }
  }
});

test("item 2: one message, one click, and BOTH caps are raised at Global scope", async () => {
  resetState({ [FIELDS_KEY]: CAPPED, [VARIANTS_KEY]: CAPPED });
  answerWith("accept");
  const out = output();
  const result = await visitHover(install(), "rust", out);

  assert.strictEqual(offers().length, 1, "two toasts for one decision is the product managing the developer");
  assert.strictEqual(result, true, "an accepted offer reports true");

  const writes = writesTo(...HOVER_KEYS);
  const written = writes.map(flatKey).sort();
  assert.deepStrictEqual(
    written,
    [...HOVER_KEYS].sort(),
    `one click sets both settings, got ${JSON.stringify(__state().updates)}`,
  );
  for (const w of writes) {
    assert.strictEqual(w.target, 1, `${flatKey(w)}: ConfigurationTarget.Global`);
    const raised = w.value === null || (typeof w.value === "number" && w.value > CAPPED);
    assert.ok(raised, `${flatKey(w)}: the cap must actually be raised, got ${JSON.stringify(w.value)}`);
  }
  assert.strictEqual(
    __state().updates.length,
    2,
    "one ratified click writes those two settings and nothing else",
  );
});

test("item 2: the offer names the trade and gives two ways out; declining writes nothing", async () => {
  resetState({ [FIELDS_KEY]: CAPPED, [VARIANTS_KEY]: CAPPED });
  answerWith("decline");
  const out = output();
  const result = await visitHover(install(), "rust", out);

  const msg = offers()[0];
  assert.ok(msg, "an offer was shown");
  assert.strictEqual(msg.actions.length, 2, "one action raises both caps, one declines");
  const { accept, decline } = classify(msg.actions);
  assert.ok(accept && decline, `both intents readable from ${JSON.stringify(msg.actions.map(label))}`);
  assert.match(msg.message, /rust-analyzer/i, "names whose settings are being touched");
  assert.match(msg.message, /hover|field|variant|truncat/i, "names what changes");
  assert.strictEqual(result, false, "a decline reports false");
  assert.deepStrictEqual(__state().updates, [], "a decline leaves rust-analyzer untouched");
  assert.ok(out.lines.length > 0, "the decline is on the channel");
});

test("item 2: ratify lands before the write", async () => {
  resetState({ [FIELDS_KEY]: CAPPED, [VARIANTS_KEY]: CAPPED });
  const out = output();
  let linesAtClick = 0;
  __state().respond = (message, actions) => {
    linesAtClick = out.lines.length;
    return classify(actions).accept;
  };
  await visitHover(install(), "rust", out);

  assert.ok(writesTo(...HOVER_KEYS).length > 0, "the accept wrote");
  const ratify = out.lines
    .map((line, i) => ({ line, before: out.updatesBefore[i], i }))
    .filter((r) => r.i >= linesAtClick && r.before === 0);
  assert.ok(
    ratify.length > 0,
    `a write line with no ratify line above it is a bug by definition. Lines: ${JSON.stringify(out.lines)}, ` +
      `writes-already-done per line: ${JSON.stringify(out.updatesBefore)}`,
  );
  assert.ok(
    ratify.some((r) => /hover|field|variant|rust-analyzer/i.test(r.line)),
    `the ratify line names what is about to be written, got ${JSON.stringify(ratify.map((r) => r.line))}`,
  );
});

test("item 2: a dismissed hover offer is not an answer either", async () => {
  resetState({ [FIELDS_KEY]: CAPPED, [VARIANTS_KEY]: CAPPED });
  const ctx = install();
  answerWith("dismiss");
  await visitHover(ctx);
  assert.strictEqual(offers().length, 1, "the offer was shown");
  assert.deepStrictEqual(ctx.stateWrites, [], "an unanswered message persists nothing");

  answerWith("decline");
  await visitHover(ctx);
  assert.strictEqual(offers().length, 2, "a faded toast leaves the question open");
});

test("item 2: a second member site under a still-open hover offer opens no second offer", async () => {
  resetState({ [FIELDS_KEY]: CAPPED, [VARIANTS_KEY]: CAPPED });
  const gate = pendingOffer();
  const ctx = install();

  const first = visitHover(ctx);
  await new Promise((r) => setTimeout(r, 5));
  assert.strictEqual(offers().length, 1, "the first member site opened the offer");
  assert.deepStrictEqual(
    ctx.stateWrites,
    [],
    "nothing is persisted while the message is still up: in-memory in-flight flag, persistence on the reply",
  );
  for (let i = 0; i < 5; i++) {
    await withTimeout(visitHover(ctx), 500, "a member site under an in-flight hover offer");
  }
  assert.strictEqual(offers().length, 1, `only one message on screen, got ${offerText()}`);

  gate.answer("decline");
  await withTimeout(first, 500, "the in-flight hover offer after the click");
});

test("item 2: the two nudges do not share a key - declining one still offers the other", async () => {
  // Decline snippets, then walk into the hover nudge in the same workspace.
  resetState({ [SNIPPET_KEY]: "fill_arguments", [FIELDS_KEY]: CAPPED, [VARIANTS_KEY]: CAPPED });
  answerWith("decline");
  const ctx = install();
  await visitSnippet(ctx);
  assert.strictEqual(offers().length, 1, "the snippet nudge asked");
  await visitHover(ctx);
  assert.strictEqual(
    offers().length,
    2,
    `answering the snippet question says nothing about the hover caps, got ${offerText()}`,
  );

  // And the other way round.
  resetState({ [SNIPPET_KEY]: "fill_arguments", [FIELDS_KEY]: CAPPED, [VARIANTS_KEY]: CAPPED });
  answerWith("decline");
  const ctx2 = install();
  await visitHover(ctx2);
  assert.strictEqual(offers().length, 1, "the hover nudge asked");
  await visitSnippet(ctx2);
  assert.strictEqual(
    offers().length,
    2,
    `declining the hover caps must not silence the snippet nudge, got ${offerText()}`,
  );
});

test("item 2: a declined hover offer is remembered, so the same workspace is not asked twice", async () => {
  resetState({ [FIELDS_KEY]: CAPPED, [VARIANTS_KEY]: CAPPED });
  answerWith("decline");
  const globalStore = {};
  const workspaceStore = {};
  await visitHover(install(globalStore, workspaceStore));
  assert.strictEqual(offers().length, 1, "asked once");

  answerWith("accept"); // a re-offer would write, making the failure loud
  for (let i = 0; i < 10; i++) await visitHover(install(globalStore, workspaceStore));
  assert.strictEqual(offers().length, 1, `the decline was persisted, got ${offerText()}`);
  assert.deepStrictEqual(__state().updates, [], "a re-offer would have written; nothing did");
});
