// session-v77 phase 6 lane 1: goal.md Amendment 3 rows R3, R4, R5, R7.
//
// R3: Dump Completion Items is hidden from the command palette.
// R4: a dismissed rust-analyzer snippet offer is not re-asked for the rest of
//     the VS Code session (one ExtensionContext), and is asked again in the next.
// R5: column80.dictation.surfaces defaults off.
// R7: the cancel command's palette title is "Cancel Running Task", and the
//     status bar tooltip names that title.
//
// Run: node --test test/impl-v77-p6-lane1.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));

test("R3: Dump Completion Items is hidden from the command palette", () => {
  const entries = pkg.contributes.menus.commandPalette.filter((m) => m.command === "column80.dumpCompletionItems");
  assert.deepStrictEqual(entries, [{ command: "column80.dumpCompletionItems", when: "false" }]);
  // Hidden from the palette, still a contributed command a keybinding can run.
  assert.ok(pkg.contributes.commands.some((c) => c.command === "column80.dumpCompletionItems"));
});

test("R5: column80.dictation.surfaces defaults off", () => {
  const setting = pkg.contributes.configuration.properties["column80.dictation.surfaces"];
  assert.ok(setting, "the setting is contributed");
  assert.strictEqual(setting.default, false);
  // The reader's own fallback must agree, or an unset key reads on.
  const src = fs.readFileSync(path.join(__dirname, "..", "src", "vscode", "dictation.ts"), "utf8");
  assert.match(src, /surfaces: b\("dictation\.surfaces", false\)/);
});

test("R7: the cancel command reads Column 80: Cancel Running Task in the palette", () => {
  const entry = pkg.contributes.commands.find((c) => c.command === "column80.cancelGeneration");
  assert.strictEqual(`${entry.category}: ${entry.title}`, "Column 80: Cancel Running Task");
});

test("R7: the status bar tooltip names the command by its palette title", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "src", "vscode", "inFlight.ts"), "utf8");
  assert.match(src, /bind `Column 80: Cancel Running Task` to a keyboard shortcut/);
  assert.doesNotMatch(src, /Cancel Generation/);
});

// ---- R4, driven against firstRun.ts with a vscode stub

const STUB = path.join(__dirname, ".impl-v77-p6-lane1.vscode.js");
fs.writeFileSync(
  STUB,
  `const state = { config: {}, updates: [], messages: [], respond: () => undefined };
module.exports = {
  __state: state,
  ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
  workspace: {
    getConfiguration: (section) => ({
      get: (key, fallback) => {
        const k = section + "." + key;
        return k in state.config ? state.config[k] : fallback;
      },
      update: async (key, value) => {
        state.updates.push({ section, key, value });
        state.config[section + "." + key] = value;
      },
    }),
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
const entry = path.join(__dirname, ".impl-v77-p6-lane1.entry.ts");
const outfile = path.join(__dirname, ".impl-v77-p6-lane1.bundle.cjs");
fs.writeFileSync(entry, `export * from "../src/vscode/firstRun";\nexport { __state } from "vscode";\n`);
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
const session = (workspaceStore) => ({
  globalState: memento({}),
  workspaceState: memento(workspaceStore),
  subscriptions: [],
});
const output = () => ({ lines: [], appendLine() {} });
const RA_SNIPPETS = "rust-analyzer.completion.callable.snippets";

const reset = () => {
  const s = bundle.__state;
  s.config = { [RA_SNIPPETS]: "fill_arguments" };
  s.updates = [];
  s.messages = [];
  s.respond = () => undefined;
};

test("R4: a faded snippet offer is not asked again at the next member site in the same session", async () => {
  reset();
  const ctx = session({});
  await bundle.offerRaSnippetFix(ctx, "rust", output());
  assert.strictEqual(bundle.__state.messages.length, 1, "the first member site asks");
  for (let i = 0; i < 5; i++) await bundle.offerRaSnippetFix(ctx, "rust", output());
  assert.strictEqual(bundle.__state.messages.length, 1, "a faded toast waits for the next window");
  assert.deepStrictEqual(bundle.__state.updates, [], "and nothing was written");
});

test("R4: a faded offer is still not an answer, so the next session asks again", async () => {
  reset();
  const store = {};
  await bundle.offerRaSnippetFix(session(store), "rust", output());
  assert.deepStrictEqual(Object.keys(store), [], "nothing persisted");
  await bundle.offerRaSnippetFix(session(store), "rust", output());
  assert.strictEqual(bundle.__state.messages.length, 2, "a new window, a new ExtensionContext, a new offer");
});
