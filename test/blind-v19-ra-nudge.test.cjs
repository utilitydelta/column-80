// Blind oracle for S10: the rust-analyzer argument-snippet nudge
// (session-v19/s10-surface.md). Written against the surface doc alone;
// src/vscode/firstRun.ts, src/vscode/completionProvider.ts and
// src/core/completionService.ts were never read. Expected red until the
// feature exists.
//
// The surface names the home (firstRun.ts) and the idiom (offerModelPull) but
// not the export or its signature, so this file DEFINES them:
//
//   offerRaSnippetFix(context, languageId, output) -> Promise<unknown>
//
// called from the completion path at a member site with the widget open. The
// "member site seen with the widget open" precondition is the caller's job;
// the function owns the other three gates (language, live setting, once-ever).
// Name resolution is generous (see NUDGE_ALIASES) so a different but
// recognisable export still binds.
//
// The load-bearing half is the prohibition list. A nudge gated only on "have I
// shown it" passes a weak suite, so the language gate, the `none` gate and the
// never-write-without-ratification gate each get an assertion on the WRITE,
// not just on the UI call.
//
// Run: SKIP_LIVE=1 node --test test/blind-v19-ra-nudge.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");

// The setting under offer belongs to another extension. column80.* is this
// extension's own namespace (package.json contributes.configuration) and must
// never be confused with it.
const RA_KEY = "rust-analyzer.completion.callable.snippets";
const RENDERS_ARGUMENTS = ["fill_arguments", "add_parentheses"];

// ---- stub vscode, recording every configuration read and write with its section

const STUB = path.join(__dirname, ".blind-v19-ra-nudge-stub.cjs");
fs.writeFileSync(
  STUB,
  `
const state = {
  config: {},          // "section|key" -> effective value
  reads: [],           // { section, key } per get()
  sections: [],        // every getConfiguration(section) call
  updates: [],         // { section, key, value, target }
  messages: [],        // { kind, message, actions }
  respond: () => undefined, // (message, actions) -> the clicked action
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
  Uri: { parse: (s) => s },
};
`,
);

const entry = path.join(__dirname, ".blind-v19-ra-nudge.entry.ts");
const outfile = path.join(__dirname, ".blind-v19-ra-nudge.bundle.cjs");
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

// ---- binding the promised surface

const NUDGE_ALIASES = [
  "offerRaSnippetFix",
  "offerRustAnalyzerSnippetFix",
  "offerRaSnippetNudge",
  "offerRustAnalyzerSnippetNudge",
  "offerRustAnalyzerNudge",
  "maybeOfferRaSnippetFix",
  "maybeOfferRaSnippetNudge",
  "maybeNudgeRaSnippets",
  "offerSnippetNudge",
];

const resolveNudge = () => {
  if (loadError) assert.fail(`the vscode layer would not bundle: ${loadError.message}`);
  for (const name of NUDGE_ALIASES) {
    if (typeof bundle[name] === "function") return bundle[name];
  }
  const loose = Object.keys(bundle).filter(
    (k) => typeof bundle[k] === "function" && /nudge|snippet|rustanalyz|(^|[^a-z])ra[A-Z]/i.test(k),
  );
  if (loose.length === 1) return bundle[loose[0]];
  assert.fail(
    `no rust-analyzer nudge export on src/vscode/firstRun.ts (looked for ${NUDGE_ALIASES.join(", ")}); ` +
      `exports are: ${Object.keys(bundle).join(", ")}`,
  );
};

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

// One install. The same store survives across calls and across "restarts",
// which is what "at most once per install" is measured against.
// A real vscode ExtensionContext carries BOTH mementos. This stub carried only
// globalState, so the answered gate had nowhere to settle and every member site
// re-offered: four rows in this file were failing on the fixture rather than on
// the product (diagnosed in impl-v21-nudge-scope.test.cjs, and re-proved there
// against a context shaped like this one). `store` is the WORKSPACE memento,
// which is where v21 put the answer; see supersessions.md S6.
const memento = (store) => ({
  get: (k, fallback) => (k in store ? store[k] : fallback),
  update: async (k, v) => {
    store[k] = v;
  },
  keys: () => Object.keys(store),
});

const install = (store = {}, globalStore = {}) => ({
  store,
  globalStore,
  subscriptions: [],
  workspaceState: memento(store),
  globalState: memento(globalStore),
});

const output = () => {
  const lines = [];
  return { lines, appendLine: (l) => lines.push(l) };
};

const label = (action) => (typeof action === "string" ? action : String(action && action.title));
const DECLINE_RE = /not now|no thanks|no,|keep|dismiss|later|leave|cancel|never/i;

// The surface fixes the two intents but not the button text, so the answer is
// classified from the offered actions rather than hardcoded.
const classify = (actions) => {
  const decline = actions.find((a) => DECLINE_RE.test(label(a)));
  const accept = actions.find((a) => a !== decline);
  return { accept, decline };
};

// Every test drives the feature through this one seam. When the signature
// moves, it moves here.
const visit = (ctx, languageId, out) => resolveNudge()(ctx, languageId, out);

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

const raWrites = () =>
  __state()
    .updates.filter((u) => `${u.section ? u.section + "." : ""}${u.key}` === RA_KEY);

const foreignWrites = () => __state().updates.filter((u) => !String(u.section ?? u.key).startsWith("column80"));

const offers = () => __state().messages;

// ---- the language gate [surface: 'The nudge never fires for TypeScript, C# or Python']

test("only Rust reaches the offer; every other language costs nothing and offers nothing", async () => {
  const cases = [
    { languageId: "typescript", fires: false },
    { languageId: "typescriptreact", fires: false },
    { languageId: "javascript", fires: false },
    { languageId: "csharp", fires: false },
    { languageId: "python", fires: false },
    { languageId: "plaintext", fires: false },
    { languageId: "rust", fires: true },
  ];
  for (const c of cases) {
    resetState({ [RA_KEY]: "fill_arguments" });
    answerWith("decline");
    await visit(install(), c.languageId, output());
    assert.strictEqual(
      offers().length,
      c.fires ? 1 : 0,
      `${c.languageId}: expected ${c.fires ? "one offer" : "silence"}, got ${JSON.stringify(offers().map((m) => m.message))}`,
    );
    if (!c.fires) {
      assert.deepStrictEqual(__state().reads, [], `${c.languageId}: the language gate must come before any configuration read`);
      assert.deepStrictEqual(foreignWrites(), [], `${c.languageId}: nothing may be written for a non-Rust site`);
    }
  }
});

// ---- the live-setting gate [surface: 'never fires when the setting is already none']

test("fires only while the setting renders arguments; at none it stays silent and writes nothing", async () => {
  const cases = [
    { value: "fill_arguments", fires: true },
    { value: "add_parentheses", fires: true },
    { value: "none", fires: false },
  ];
  for (const c of cases) {
    resetState({ [RA_KEY]: c.value });
    answerWith("accept");
    await visit(install(), "rust", output());
    assert.strictEqual(
      offers().length,
      c.fires ? 1 : 0,
      `${c.value}: expected ${c.fires ? "one offer" : "silence"}`,
    );
    if (!c.fires) {
      assert.deepStrictEqual(raWrites(), [], `${c.value}: already off, so there is nothing to set and nothing to ask`);
    }
  }
});

test("a setting already at none is never re-written, however many member sites are visited", async () => {
  resetState({ [RA_KEY]: "none" });
  answerWith("accept");
  const ctx = install();
  for (let i = 0; i < 40; i++) await visit(ctx, "rust", output());
  assert.deepStrictEqual(offers(), []);
  assert.deepStrictEqual(__state().updates, []);
});

// ---- ratification [surface: "Another extension's configuration is never written silently"]

test("no answer means no write: a decline and a bare dismissal both leave rust-analyzer untouched", async () => {
  for (const kind of ["decline", "dismiss"]) {
    resetState({ [RA_KEY]: "fill_arguments" });
    answerWith(kind);
    await visit(install(), "rust", output());
    assert.strictEqual(offers().length, 1, `${kind}: the offer was made`);
    assert.deepStrictEqual(
      __state().updates,
      [],
      `${kind}: a dismissed message is not a yes - no configuration write of any kind may happen`,
    );
    assert.strictEqual(__state().config[RA_KEY], "fill_arguments", `${kind}: the live value is unchanged`);
  }
});

test("accepting writes exactly one setting: rust-analyzer.completion.callable.snippets = none, at an explicit scope", async () => {
  resetState({ [RA_KEY]: "fill_arguments" });
  answerWith("accept");
  await visit(install(), "rust", output());
  const writes = raWrites();
  assert.strictEqual(writes.length, 1, `exactly one write, got ${JSON.stringify(__state().updates)}`);
  assert.strictEqual(writes[0].value, "none");
  assert.notStrictEqual(
    writes[0].target,
    undefined,
    "the scope is stated, not left to the VS Code default - this is an install-wide preference",
  );
  assert.strictEqual(__state().updates.length, 1, "one ratified click writes one setting and nothing else");
});

test("the offer states the trade and gives two ways out, so the setting is not presented as free", async () => {
  resetState({ [RA_KEY]: "fill_arguments" });
  answerWith("decline");
  const out = output();
  await visit(install(), "rust", out);
  const msg = offers()[0];
  assert.ok(msg, "an offer was shown");
  assert.strictEqual(msg.actions.length, 2, "one action applies the setting, one declines");
  const { accept, decline } = classify(msg.actions);
  assert.ok(accept && decline, `both intents readable from ${JSON.stringify(msg.actions.map(label))}`);
  assert.match(msg.message, /argument|placeholder|snippet/i, "names what changes");
  assert.match(msg.message, /rust-analyzer/i, "names whose setting is being touched");
});

// ---- the once-ever gate [surface: 'fires at most once per install']

test("one offer per workspace across many member sites, once the user has actually answered", async () => {
  for (const kind of ["accept", "decline"]) {
    resetState({ [RA_KEY]: "fill_arguments" });
    answerWith(kind);
    const ctx = install();
    for (let i = 0; i < 50; i++) await visit(ctx, "rust", output());
    assert.strictEqual(
      offers().length,
      1,
      `${kind}: 50 member sites produced ${offers().length} offers; the gate must be persisted, not per-call`,
    );
  }
});

// This row used to ride inside the one above, asserting that a DISMISS settled
// the gate too. It does not, on purpose: a modeless message that faded while the
// developer kept typing is not an answer, and recording it as one costs them the
// offer forever (firstRun.ts, the `choice === undefined` leg). What stops the
// nag while the question is on screen is `offersInFlight`, not the persisted
// gate. See supersessions.md S6.
test("a dismissal is not an answer: nothing is persisted, and nothing is written", async () => {
  resetState({ [RA_KEY]: "fill_arguments" });
  answerWith("dismiss");
  const ctx = install();
  await visit(ctx, "rust", output());
  assert.strictEqual(offers().length, 1, "the question was asked");
  assert.deepStrictEqual(Object.keys(ctx.store), [], "a faded toast recorded no answer in the workspace memento");
  assert.deepStrictEqual(Object.keys(ctx.globalStore), [], "nor in the global one");
  assert.deepStrictEqual(__state().updates, [], "and no configuration was written");
});

test("a declined nudge stays declined across a restart, and still writes nothing", async () => {
  resetState({ [RA_KEY]: "fill_arguments" });
  answerWith("decline");
  const store = {};
  await visit(install(store), "rust", output());
  assert.strictEqual(offers().length, 1);

  // Same install, fresh session: only globalState carries over.
  answerWith("accept"); // if it re-offers, it would now be accepted and would write
  for (let i = 0; i < 10; i++) await visit(install(store), "rust", output());
  assert.strictEqual(offers().length, 1, "the remembered decline survives the restart");
  assert.deepStrictEqual(__state().updates, [], "a re-offer would have written; nothing did");
});

// v19's surface said globalState, install-wide. v21 moved it to workspaceState
// after a dogfood failure: one project's answer silenced the nudge in every
// other project the user opened. The scope is now per WORKSPACE and pinned green
// by impl-v21-nudge-scope.test.cjs. See supersessions.md S6.
test("the remembered answer lives in workspaceState, so the next project is asked in its own right", async () => {
  resetState({ [RA_KEY]: "fill_arguments" });
  answerWith("decline");
  const ctx = install();
  await visit(ctx, "rust", output());
  assert.ok(Object.keys(ctx.store).length > 0, "the answer was persisted in the workspace memento");

  // Same install, a different project: fresh workspaceState, same globalState.
  resetState({ [RA_KEY]: "fill_arguments" });
  answerWith("decline");
  await visit(install({}, ctx.globalStore), "rust", output());
  assert.strictEqual(offers().length, 1, "the second project got asked in its own right");
});

// ---- honesty on decline [surface: 'Declining leaves the extension honest']

test("declining puts the reduced state on the record instead of pretending nothing changed", async () => {
  resetState({ [RA_KEY]: "fill_arguments" });
  answerWith("decline");
  const out = output();
  await visit(install(), "rust", out);
  assert.ok(out.lines.length > 0, "the decline is on the channel, as the pull path does it");
  assert.ok(
    out.lines.every((l) => l.startsWith("[carve] ")),
    `channel lines follow the [carve] idiom, got ${JSON.stringify(out.lines)}`,
  );
  assert.ok(
    out.lines.some((l) => /snippet|argument|declin/i.test(l)),
    `the line names what was declined and what it costs, got ${JSON.stringify(out.lines)}`,
  );
});

test("the ratified accept is on the record before the write, matching the pull path's ratify-then-act ordering", async () => {
  resetState({ [RA_KEY]: "fill_arguments" });
  const out = output();
  const seen = [];
  __state().respond = (message, actions) => {
    seen.push(out.lines.length);
    return classify(actions).accept;
  };
  await visit(install(), "rust", out);
  assert.strictEqual(raWrites().length, 1, "the accept wrote the setting");
  assert.ok(out.lines.length > seen[0], "a line lands after the click, carrying the ratification");
});

// ---- the hot path [surface: 'Nothing on the hot path pays for this']

test("member sites do not each buy a configuration read; once settled the cost is zero", async () => {
  resetState({ [RA_KEY]: "fill_arguments" });
  answerWith("decline");
  const ctx = install();

  await visit(ctx, "rust", output());
  const readsAfterOffer = __state().reads.length;
  assert.ok(readsAfterOffer <= 2, `the single offer read config ${readsAfterOffer} times`);

  __state().reads = [];
  __state().sections = [];
  for (let i = 0; i < 100; i++) await visit(ctx, "rust", output());
  assert.deepStrictEqual(
    __state().reads,
    [],
    "after the one-shot gate is settled, a member site must not read configuration at all",
  );
  assert.deepStrictEqual(__state().sections, [], "not even a getConfiguration handle per keystroke");
});
