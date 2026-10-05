"use strict";

// session-v77 phase 6 adversarial review: red rows for the defects in
// session-v77/review-p6.md. Each row names its finding id.
//
// Run: node --test test/review-v77-p6-findings.test.cjs

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const esbuild = require("esbuild");
const { bundleCore } = require("./.blind-util.cjs");

// ---- M1 (R4): the hover cap offer still asks at every member site after it fades

const STUB = path.join(__dirname, ".review-v77-p6.vscode.js");
fs.writeFileSync(
  STUB,
  `const state = { config: {}, updates: [], messages: [] };
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
    // Every toast fades: the user keeps typing and answers nothing.
    showInformationMessage: async (message, ...actions) => {
      state.messages.push({ message, actions });
      return undefined;
    },
  },
  commands: { registerCommand: () => ({ dispose() {} }) },
};
`,
);
const entry = path.join(__dirname, ".review-v77-p6.entry.ts");
const outfile = path.join(__dirname, ".review-v77-p6.bundle.cjs");
fs.writeFileSync(entry, `export * from "../src/vscode/firstRun";\nexport { __state } from "vscode";\n`);
esbuild.buildSync({ entryPoints: [entry], bundle: true, outfile, format: "cjs", platform: "node", alias: { vscode: STUB } });
const firstRun = require(outfile);

const reducer = bundleCore("review-v77-p6-reducer", 'export * from "../src/core/dictationGesture";\n');

test.after(() => {
  for (const f of [entry, outfile, STUB]) fs.rmSync(f, { force: true });
  reducer.cleanup();
});

const memento = (store) => ({
  get: (k, fallback) => (k in store ? store[k] : fallback),
  update: async (k, v) => {
    store[k] = v;
  },
  keys: () => Object.keys(store),
});
const output = { appendLine() {} };

// The member-site hook exactly as `extension.ts:78-84` chains it: the snippet
// offer settles, then the hover cap offer runs.
const memberSite = (ctx) =>
  firstRun
    .offerRaSnippetFix(ctx, "rust", output)
    .catch(() => undefined)
    .then(() => firstRun.offerRaHoverCapFix(ctx, "rust", output).catch(() => undefined));

test("M1 (R4): with every rust-analyzer toast faded, no offer is asked twice in one session", async () => {
  const s = firstRun.__state;
  // rust-analyzer defaults: argument snippets on, hover caps unset (5).
  s.config = { "rust-analyzer.completion.callable.snippets": "fill_arguments" };
  s.messages = [];
  s.updates = [];
  const ctx = { globalState: memento({}), workspaceState: memento({}), subscriptions: [] };
  for (let site = 0; site < 6; site++) {
    await memberSite(ctx);
  }
  const snippet = s.messages.filter((m) => /argument snippets/.test(m.message)).length;
  const hover = s.messages.filter((m) => /hover/.test(m.message)).length;
  assert.equal(snippet, 1, "the snippet offer asks once (R4 as built)");
  assert.equal(
    hover,
    1,
    `a faded rust-analyzer offer asked again at the next member site: the hover cap offer was shown ${hover} times in 6 member sites`,
  );
  assert.deepEqual(s.updates, [], "nothing written without a click");
});

// ---- L1 (R8): a language with no comment syntax is told a remedy that cannot work

const { reduce, IDLE } = reducer.mod;

test("L1 (R8): a press in a language with no comment syntax is not told to add it to fimLanguages", () => {
  // plaintext and markdown have no row in commentSyntaxFor, so inComment and
  // commentRow are both false (the adapter derives both from the same lookup).
  for (const languageId of ["plaintext", "markdown"]) {
    const out = reduce(IDLE, {
      type: "press",
      site: { uri: `file:///w/a.${languageId}`, line: 0 },
      languageId,
      indentColumns: 0,
      now: 1000,
      ghostVisible: false,
      ready: {
        remote: false,
        binaryPresent: true,
        modelPresent: true,
        recogniserAlive: true,
        served: false,
        commentRow: false,
        inComment: false,
      },
    });
    const refusal = out.actions.find((a) => a.type === "refuse");
    // Following "Add <lang> to column80.fimLanguages" turns keystroke FIM on in
    // that language and the next press still refuses, now as no-comment-row.
    assert.notEqual(
      refusal && refusal.kind,
      "not-served",
      `${languageId}: refused not-served, whose remedy (add it to column80.fimLanguages) cannot make dictation run here`,
    );
  }
});
