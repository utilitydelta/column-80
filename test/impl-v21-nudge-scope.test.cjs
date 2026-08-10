// IMPLEMENTATION test for the v21 nudge gate, and it exists to answer ONE
// question the blind set cannot: whether the hot path still costs nothing.
//
// `blind-v19-ra-nudge.test.cjs` pins "once settled, a member site must not read
// configuration at all". Under v21 that row goes RED, and the reason matters:
// its context stub has no `workspaceState`, so the gate it settles into does
// not exist there and nothing ever settles. That is a harness limitation, not a
// regression, and the claim needs an oracle rather than an argument.
//
// So this drives the same 100-member-site loop against a context that HAS a
// workspaceState, which is every real VS Code context.
//
// Run: SKIP_LIVE=1 node --test test/impl-v21-nudge-scope.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");

// ---- a vscode stub carrying only what the nudge paths touch

const STUB = path.join(__dirname, ".impl-v21-nudge-scope.vscode.js");
fs.writeFileSync(
  STUB,
  `const state = { config: {}, reads: [], sections: [], updates: [], messages: [], respond: () => undefined };
const configFor = (section) => {
  state.sections.push(section);
  return {
    get: (key, fallback) => {
      state.reads.push({ section, key });
      const k = section + "." + key;
      return k in state.config ? state.config[k] : fallback;
    },
    update: async (key, value, target) => {
      state.updates.push({ section, key, value, target });
      state.config[section + "." + key] = value;
    },
  };
};
module.exports = {
  __state: state,
  ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
  workspace: {
    getConfiguration: (section) => configFor(section),
    onDidChangeConfiguration: () => ({ dispose() {} }),
  },
  window: {
    showInformationMessage: async (message, ...actions) => {
      state.messages.push({ message, actions });
      return state.respond(message, actions);
    },
  },
  commands: { registerCommand: () => ({ dispose() {} }) },
};
`,
);

const entry = path.join(__dirname, ".impl-v21-nudge-scope.entry.ts");
const outfile = path.join(__dirname, ".impl-v21-nudge-scope.bundle.cjs");
fs.writeFileSync(
  entry,
  `export * from "../src/vscode/firstRun";\nexport { __state } from "vscode";\n`,
);
esbuild.buildSync({
  entryPoints: [entry],
  bundle: true,
  outfile,
  format: "cjs",
  platform: "node",
  alias: { vscode: STUB },
});
const bundle = require(outfile);
test.after(() => {
  for (const f of [entry, outfile, STUB]) fs.rmSync(f, { force: true });
});

const memento = (store) => ({
  get: (k, fallback) => (k in store ? store[k] : fallback),
  update: async (k, v) => {
    store[k] = v;
  },
  keys: () => Object.keys(store),
});

// A context shaped like the real one: BOTH mementos present.
const context = (globalStore = {}, workspaceStore = {}) => ({
  globalState: memento(globalStore),
  workspaceState: memento(workspaceStore),
  subscriptions: [],
});

const output = () => {
  const lines = [];
  return { lines, appendLine: (l) => lines.push(l) };
};

const reset = (config) => {
  const s = bundle.__state;
  s.config = { ...config };
  s.reads = [];
  s.sections = [];
  s.updates = [];
  s.messages = [];
  s.respond = () => undefined;
};

const RA_SNIPPETS = "rust-analyzer.completion.callable.snippets";
const HOVER_FIELDS = "rust-analyzer.hover.show.fields";
const HOVER_VARIANTS = "rust-analyzer.hover.show.enumVariants";

const decline = () => {
  bundle.__state.respond = (_m, actions) => actions[actions.length - 1];
};

// ---- the hot path, per nudge

for (const [what, fn, live] of [
  ["snippet", () => bundle.offerRaSnippetFix, { [RA_SNIPPETS]: "fill_arguments" }],
  ["hover cap", () => bundle.offerRaHoverCapFix, { [HOVER_FIELDS]: 5, [HOVER_VARIANTS]: 5 }],
]) {
  test(`${what}: once the answer is recorded, a member site buys no configuration read at all`, async () => {
    reset(live);
    decline();
    const ctx = context();

    await fn()(ctx, "rust", output());
    assert.strictEqual(bundle.__state.messages.length, 1, "the one offer was made");

    bundle.__state.reads = [];
    bundle.__state.sections = [];
    for (let i = 0; i < 100; i++) await fn()(ctx, "rust", output());

    assert.deepStrictEqual(
      bundle.__state.reads,
      [],
      "after the answer is recorded a member site must not read configuration",
    );
    assert.deepStrictEqual(
      bundle.__state.sections,
      [],
      "not even a getConfiguration handle per keystroke",
    );
    assert.strictEqual(bundle.__state.messages.length, 1, "and no second offer");
  });

  test(`${what}: the answer is recorded per WORKSPACE, so the next project is asked in its own right`, async () => {
    const globalStore = {};
    reset(live);
    decline();
    await fn()(context(globalStore, {}), "rust", output());
    assert.strictEqual(bundle.__state.messages.length, 1, "the first project asked");

    // Same install, different project: a fresh workspaceState, the same
    // globalState. This is the dogfood failure - one project's answer silencing
    // every other project - and it must not happen.
    reset(live);
    decline();
    await fn()(context(globalStore, {}), "rust", output());
    assert.strictEqual(bundle.__state.messages.length, 1, "the second project asked too");
  });

  test(`${what}: nothing at all is persisted when there is nothing to offer`, async () => {
    reset(
      what === "snippet"
        ? { [RA_SNIPPETS]: "none" }
        : { [HOVER_FIELDS]: 64, [HOVER_VARIANTS]: 64 },
    );
    const globalStore = {};
    const workspaceStore = {};
    const answered = await fn()(context(globalStore, workspaceStore), "rust", output());

    assert.strictEqual(answered, false, "nothing was offered, so nothing was accepted");
    assert.deepStrictEqual(bundle.__state.messages, [], "and no message was shown");
    assert.deepStrictEqual(bundle.__state.updates, [], "no configuration was written");
    assert.deepStrictEqual(
      [Object.keys(globalStore), Object.keys(workspaceStore)],
      [[], []],
      "an answer nobody gave must not be recorded in either memento - this is the bug that " +
        "silenced the nudge install-wide from one project's settings.json",
    );
  });
}

// ---- the hover nudge must not overrule a cap the user already raised

const accept = () => {
  bundle.__state.respond = (_m, actions) => actions[0];
};

test("the hover nudge raises only the keys that truncate: a cap the user already raised is left alone", async () => {
  // `null` is rust-analyzer's unlimited, and 100 is a deliberate raise. Writing
  // 64 over either is the product overruling the user under a message that
  // promises to show them everything.
  for (const [fields, expected] of [
    [null, ["enumVariants"]],
    [100, ["enumVariants"]],
    [64, ["enumVariants"]],
    [5, ["fields", "enumVariants"]],
  ]) {
    reset({ [HOVER_FIELDS]: fields, [HOVER_VARIANTS]: 5 });
    accept();
    const answered = await bundle.offerRaHoverCapFix(context(), "rust", output());

    assert.strictEqual(answered, true, `fields=${JSON.stringify(fields)}: the click was accepted`);
    assert.deepStrictEqual(
      bundle.__state.updates.map((u) => u.key),
      expected,
      `fields=${JSON.stringify(fields)}: only the truncating keys may be written`,
    );
    assert.ok(
      bundle.__state.updates.every((u) => u.target === 1),
      "every write goes to ConfigurationTarget.Global",
    );
  }
});

test("a ratify line is written for every key that is written, and for no key that is not", async () => {
  reset({ [HOVER_FIELDS]: null, [HOVER_VARIANTS]: 5 });
  accept();
  const out = output();
  await bundle.offerRaHoverCapFix(context(), "rust", out);

  const ratified = out.lines.filter((l) => l.includes("ratified"));
  assert.strictEqual(ratified.length, 1, `one write, one ratify line; got ${JSON.stringify(ratified)}`);
  assert.ok(
    ratified[0].includes("enumVariants") && !ratified[0].includes("show.fields"),
    `the ratify line names the key actually written; got ${JSON.stringify(ratified)}`,
  );
});
