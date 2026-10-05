// Accepting a FIM ghost runs nothing from the compiler oracle: no check, no
// "verifying" status, no annotation, no repair. That holds for a plain Tab and
// for a dictated ghost, whose accept command used to forward to the same check.
// Function generation's own post-accept check is untouched, and the third row
// pins that, so the removal cannot quietly take the fn-gen leg with it.
//
// The human's ruling is session-v77 Amendment 1: "If I want to repair, I'll
// trigger it myself." Repair Function is that trigger.
//
// The rig is the product's own activation over the shared stub, then a second
// registerFnGen with an injected service and oracle, the way
// blind-v58-p5-cancel-affordance drives generation headless.
//
// Run: SKIP_LIVE=1 node --test test/impl-v77-p1b-fim-accept-no-oracle.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { bundleActivation } = require("./.activation-stub.cjs");

const built = bundleActivation(
  "impl-v77-p1b",
  `export { registerFnGen, buildFnGenService } from "../src/vscode/fnGen";
export { FnGenService } from "../src/core/fnGenService";
export { ContextBlockStore } from "../src/core/contextBlocks";
export { window } from "vscode";
`,
);
const B = built.mod;

const WROOT = fs.mkdtempSync(path.join(os.tmpdir(), "c80-v77p1b-"));
fs.mkdirSync(path.join(WROOT, "src"), { recursive: true });
const SRC = "// adds one to the count it is handed\nexport function bump(n: number): number {\n  return n;\n}\n";
const FSPATH = path.join(WROOT, "src", "bump.ts");
fs.writeFileSync(FSPATH, SRC);
const URI = `file://${FSPATH}`;

test.after(() => {
  built.cleanup();
  fs.rmSync(WROOT, { recursive: true, force: true });
});

const MODEL = "qwen3-coder:480b";
const MB = 1048576;
const PROBE = { runCommand: async () => ({ stdout: "16303\n", exitCode: 0 }), totalMemBytes: () => 61826 * MB };
const CFG = { apiBase: "http://ml-box.invalid:11434", model: MODEL, fallbackModel: MODEL, maxTokens: 512, temperature: 0.2 };
const GOOD = { text: "export function bump(n: number): number {\n  return n + 1;\n}", ttftMs: 1, totalMs: 2, doneReason: "stop" };

function makeDoc() {
  const lineStarts = [0];
  for (let i = 0; i < SRC.length; i++) if (SRC[i] === "\n") lineStarts.push(i + 1);
  const lines = SRC.split("\n");
  const offsetAt = (pos) => Math.min((lineStarts[pos.line] ?? SRC.length) + pos.character, SRC.length);
  return {
    languageId: "typescript",
    version: 1,
    isDirty: false,
    isClosed: false,
    eol: 1,
    lineCount: lines.length,
    fileName: FSPATH,
    uri: { fsPath: FSPATH, path: FSPATH, scheme: "file", toString: () => URI, with() { return this; } },
    getText: (range) => (range ? SRC.slice(offsetAt(range.start), offsetAt(range.end)) : SRC),
    offsetAt,
    positionAt(offset) {
      let line = 0;
      while (line + 1 < lineStarts.length && lineStarts[line + 1] <= offset) line++;
      return new B.Position(line, offset - lineStarts[line]);
    },
    lineAt(arg) {
      const n = typeof arg === "number" ? arg : arg.line;
      const text = lines[n] ?? "";
      const m = text.match(/\S/);
      return {
        lineNumber: n,
        text,
        range: new B.Range(n, 0, n, text.length),
        firstNonWhitespaceCharacterIndex: m ? m.index : text.length,
        isEmptyOrWhitespace: !m,
      };
    },
    save: async () => true,
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (predicate, ms = 3000) => {
  for (let waited = 0; waited < ms; waited += 5) {
    if (predicate()) return true;
    await sleep(5);
  }
  return predicate();
};

// What a user would see of an oracle run: the status-bar spinner (its text was
// "verifying generated code" until session-v77 phase 4 DE6, now "checking the code"),
// and the oracle's own channel lines. Plus the seam's call record, which is the
// direct witness that a run started at all.
const rig = { channel: [], progressTitles: [], oracleCalls: [], ready: false, reason: "" };
const verifying = () => rig.progressTitles.filter((t) => /checking the code/i.test(t));
const oracleLines = () => [...rig.channel, ...B.__state.outputLines].filter((l) => /^\[(oracle|repair)\]/.test(String(l)));

async function buildRig() {
  const st = B.__state;
  st.config = { apiBase: CFG.apiBase, fnGenModel: MODEL, repairEnabled: true, "dictation.enabled": false };
  const doc = makeDoc();
  st.textDocuments = [doc];
  st.commandHandlers = {
    "vscode.executeDocumentSymbolProvider": () => [
      { name: "bump", detail: "", kind: 11, range: new B.Range(1, 0, 3, 1), selectionRange: new B.Range(1, 16, 1, 20), children: [] },
    ],
    // The human presses Accept on the preview tab. Scheduled: present() listens
    // for the decision only after this call resolves.
    "vscode.diff": (_left, previewUri) => {
      setTimeout(() => st.commands["column80.proposalAccept"](previewUri), 0);
    },
  };
  B.window.withProgress = async (opts, task) => {
    rig.progressTitles.push(String(opts?.title ?? ""));
    return task({ report() {} }, { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) });
  };

  const context = {
    subscriptions: [],
    globalState: { get: () => undefined, update: async () => {} },
    workspaceState: { get: () => undefined, update: async () => {} },
    extensionPath: WROOT,
    extensionUri: { fsPath: WROOT, toString: () => `file://${WROOT}` },
    globalStorageUri: { fsPath: path.join(WROOT, ".storage") },
  };
  await B.activate(context);

  // The instrumented fn-gen registration over a transport and an oracle this
  // file holds. It replaces activation's registrations of the same ids.
  const output = { appendLine: (l) => rig.channel.push(String(l)), append() {}, replace() {}, show() {}, hide() {}, clear() {}, dispose() {} };
  let service;
  B.registerFnGen({ subscriptions: [], globalStorageUri: { fsPath: path.join(WROOT, ".storage") } }, output, new B.ContextBlockStore(() => {}), {
    buildService: async (out, log) => {
      const real = await B.buildFnGenService(out, log, PROBE, { listModels: async () => [MODEL] });
      try {
        real.service.dispose();
      } catch {
        /* teardown only */
      }
      service = new B.FnGenService(CFG, async () => GOOD, log);
      return { ...real, service };
    },
    listModels: async () => [MODEL],
    ollamaCheck: async () => ({ stdout: "ollama version 0.0.0", exitCode: 0 }),
    runOracle: async (ctx) => {
      rig.oracleCalls.push(ctx);
    },
  });
  if (!(await waitFor(() => service !== undefined && rig.channel.some((l) => l.startsWith("[carve] tier="))))) {
    rig.reason = `the tier never resolved: ${JSON.stringify(rig.channel)}`;
    return;
  }
  const at = new B.Position(2, 4);
  const selection = new B.Selection(at, at);
  st.activeTextEditor = {
    document: doc,
    viewColumn: 1,
    options: { tabSize: 2, insertSpaces: true },
    selection,
    insertSnippet: async () => true,
    revealRange: () => {},
    edit: async (cb) => {
      cb({ replace() {}, insert() {}, delete() {} });
      return true;
    },
  };
  rig.ready = true;
}

const ready = buildRig();

function beginRow() {
  rig.channel.length = 0;
  rig.progressTitles.length = 0;
  rig.oracleCalls.length = 0;
  B.__state.outputLines.length = 0;
  B.__state.executeCalls = [];
}

const rtest = (name, fn) =>
  test(name, async () => {
    await ready;
    assert.ok(rig.ready, `harness is not up: ${rig.reason}`);
    beginRow();
    await fn();
  });

// The landed span of a ghost on line 2: "n + 1" typed over "n".
const LANDED = [URI, SRC.indexOf("return n") + "return ".length, 5];

rtest("a plain FIM accept starts no oracle run: no verifying status, no check line, no repair", async () => {
  await B.__state.commands["column80.fimAccepted"]?.(...LANDED);
  await sleep(300);
  assert.deepStrictEqual(verifying(), [], "the verifying spinner never shows after a FIM accept");
  assert.deepStrictEqual(oracleLines(), [], "no oracle or repair line reaches the channel after a FIM accept");
});

rtest("a dictated ghost's accept starts no oracle run", async () => {
  const accept = B.__state.commands["column80.dictationAccepted"];
  assert.strictEqual(typeof accept, "function", "activation registers the dictated accept command");
  await accept(...LANDED);
  await sleep(300);
  const forwarded = B.__state.executeCalls.map((c) => c.id).filter((id) => id === "column80.fimAccepted");
  assert.deepStrictEqual(forwarded, [], "the dictated accept forwards to no post-accept check");
  assert.deepStrictEqual(verifying(), [], "the verifying spinner never shows after a dictated accept");
  assert.deepStrictEqual(oracleLines(), [], "no oracle or repair line reaches the channel after a dictated accept");
});

rtest("function generation's accept still runs the post-accept oracle on the landed body", async () => {
  await B.__state.commands["column80.generateFunction"]();
  assert.ok(
    await waitFor(() => rig.oracleCalls.length > 0),
    `the fn-gen accept must start the oracle; channel: ${JSON.stringify(rig.channel)}`,
  );
  assert.strictEqual(rig.oracleCalls.length, 1, "one accept, one oracle run");
  const ctx = rig.oracleCalls[0];
  assert.strictEqual(ctx.document.uri.toString(), URI, "the oracle checks the document the body landed in");
  assert.strictEqual(ctx.landedSpan.start, SRC.indexOf("export function bump"), "the landed span starts at the function head");
  assert.ok(verifying().length > 0, "the verifying spinner shows for the fn-gen check");
});
