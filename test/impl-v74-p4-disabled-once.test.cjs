// Implementer oracle, session-v74 phase 4: "column80.fim is disabled" is said
// ONCE per off.
//
// The provider is asked on every keystroke in every open document whatever the
// setting says, and the refusal used to print a line each time. With FIM off
// for an afternoon that is a line per character, and it buries every other
// event on the channel - which is the one thing the channel exists not to do.
//
// The evidence still has to survive. A reader who turns FIM off and sees the
// channel go quiet needs one line saying why, and needs the answer AGAIN the
// next time they turn it off, or a feature that stopped working leaves no trace
// the second time. So the rule is once per off, re-armed by the setting coming
// back, which is the same shape as the unserved-language ledger next to it.
//
// Same harness idiom as impl-v29-p1-provider-gate.test.cjs: alias `vscode` to a
// hand-built stub whose configuration the rows mutate, so a settings change is
// a real settings change against a live provider instance.
//
// Run: SKIP_LIVE=1 node --test test/impl-v74-p4-disabled-once.test.cjs

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const { execFileSync } = require("child_process");

const TAG = ".impl-v74-p4-disabled";
const STUB = path.join(__dirname, `${TAG}-vscode-stub.cjs`);
const REGISTRY_STUB = path.join(__dirname, `${TAG}-registry.ts`);
const pEntry = path.join(__dirname, `${TAG}.entry.ts`);
const pOutfile = path.join(__dirname, `${TAG}.bundle.cjs`);
const buildScript = path.join(__dirname, `${TAG}.build.cjs`);

fs.writeFileSync(
  STUB,
  `const state = { fimLanguages: [], enabled: true };
class Position { constructor(line, character) { this.line = line; this.character = character; }
  translate(l, c) { return new Position(this.line + (l || 0), this.character + (c || 0)); } }
class Range { constructor(a, b, c, d) {
  if (typeof a === "number") { this.start = new Position(a, b); this.end = new Position(c, d); }
  else { this.start = a; this.end = b; } } }
module.exports = {
  __state: state,
  Position, Range,
  Uri: { parse: (s) => ({ toString: () => s }) },
  languages: {}, window: {}, commands: {},
  workspace: {
    getConfiguration: () => ({ get: (k, d) => {
      if (k === "fimAlternatives") { return 1; }
      if (k === "debounceMs") { return 0; }
      if (k === "fimLanguages") { return state.fimLanguages; }
      if (k === "enabled") { return state.enabled; }
      return d;
    } }),
    textDocuments: [],
    openTextDocument: async () => { throw new Error("no such file"); },
  },
  InlineCompletionItem: class { constructor(text, range) { this.insertText = text; this.range = range; } },
  InlineCompletionTriggerKind: { Invoke: 0, Automatic: 1 },
  ThemeColor: class {}, MarkdownString: class {}, EventEmitter: class {},
};\n`,
);

fs.writeFileSync(REGISTRY_STUB, `export function extractorFor(_languageId: string): any { return undefined; }\n`);

fs.writeFileSync(
  pEntry,
  `export { FimCompletionProvider } from "../src/vscode/completionProvider";
export { CompletionService } from "../src/core/completionService";
export { DEFAULT_FIM_CONFIG } from "../src/core/config";
export { __state } from "vscode";\n`,
);

fs.writeFileSync(
  buildScript,
  `require("esbuild").build({
  entryPoints: [${JSON.stringify(pEntry)}],
  bundle: true, outfile: ${JSON.stringify(pOutfile)}, format: "cjs", platform: "node",
  alias: { vscode: ${JSON.stringify(STUB)} },
  plugins: [{ name: "registry", setup(b) {
    b.onResolve({ filter: /(^|\\/)extractors$/ }, () => ({ path: ${JSON.stringify(REGISTRY_STUB)} }));
  } }],
}).catch((e) => { console.error(e); process.exit(1); });\n`,
);

let buildError;
let pmod = {};
try {
  execFileSync(process.execPath, [buildScript], { stdio: "pipe" });
  pmod = require(pOutfile);
} catch (e) {
  buildError = e;
}

test.after(() => {
  [STUB, REGISTRY_STUB, pEntry, pOutfile, buildScript].forEach((f) => fs.rmSync(f, { force: true }));
});

function makePos(line, character) {
  return { line, character, translate: (l, c) => makePos(line + (l || 0), character + (c || 0)) };
}

function makeDoc(text, languageId) {
  return {
    languageId,
    version: 1,
    uri: { toString: () => `file:///a.${languageId}` },
    get lineCount() {
      return text.split("\n").length;
    },
    _offset(p) {
      const lines = text.split("\n");
      const line = Math.max(0, Math.min(p.line, lines.length - 1));
      let n = 0;
      for (let i = 0; i < line; i += 1) n += lines[i].length + 1;
      return n + Math.max(0, Math.min(p.character, lines[line].length));
    },
    getText(range) {
      return range == null ? text : text.slice(this._offset(range.start), this._offset(range.end));
    },
    lineAt(n) {
      const lines = text.split("\n");
      const len = (lines[n] ?? "").length;
      return { text: lines[n] ?? "", range: { start: { line: n, character: 0 }, end: { line: n, character: len } } };
    },
    offsetAt(p) {
      return this._offset(p);
    },
  };
}

// One provider across a row's requests: "once per off" is a property of an
// instance that lives across the setting moving.
function newProvider() {
  const lines = [];
  const generated = [];
  const service = new pmod.CompletionService(
    { ...pmod.DEFAULT_FIM_CONFIG, debounceMs: 0, cacheCapacity: 0 },
    async (params) => {
      generated.push(params);
      return { text: "tileCount();", ttftMs: 1, totalMs: 2 };
    },
    (l) => lines.push(l),
  );
  const provider = new pmod.FimCompletionProvider(() => service, { appendLine: (l) => lines.push(l) });
  const ask = (line, character) =>
    provider.provideInlineCompletionItems(
      makeDoc("fn main() {\n    let n = \n}\n", "rust"),
      makePos(line, character),
      { triggerKind: 1, selectedCompletionInfo: undefined },
      { isCancellationRequested: false, onCancellationRequested: () => {} },
    );
  return { provider, service, lines, generated, ask };
}

const disabledLines = (lines) => lines.filter((l) => l.includes("column80.fim is disabled"));

test("harness: the provider bundle builds [red here is a build problem, not a contract failure]", () => {
  if (buildError) {
    assert.fail(String(buildError.stderr || buildError.message).slice(0, 2000));
  }
  assert.equal(typeof pmod.FimCompletionProvider, "function");
});

test("[IMPL-V74-P4 1] twenty keystrokes with FIM off produce ONE line and no model call", async () => {
  pmod.__state.enabled = false;
  const h = newProvider();
  for (let i = 0; i < 20; i += 1) {
    assert.equal(await h.ask(1, 12 + i), undefined);
  }
  assert.equal(disabledLines(h.lines).length, 1, h.lines.join("\n"));
  assert.equal(h.generated.length, 0, "FIM off must cost no model call");
  h.service.dispose();
  pmod.__state.enabled = true;
});

test("[IMPL-V74-P4 2] the one line names the setting AND says it will not repeat", async () => {
  pmod.__state.enabled = false;
  const h = newProvider();
  await h.ask(1, 12);
  const [line] = disabledLines(h.lines);
  // Names the setting, because "no ghost in my .rs" is otherwise
  // indistinguishable from the extension being broken.
  assert.match(line, /column80\.fim is disabled/);
  // And says the quiet after it is this rule, not a second defect.
  assert.match(line, /said once/);
  h.service.dispose();
  pmod.__state.enabled = true;
});

test("[IMPL-V74-P4 3] turning it back on and off again answers again", async () => {
  pmod.__state.enabled = false;
  const h = newProvider();
  await h.ask(1, 12);
  await h.ask(1, 13);
  assert.equal(disabledLines(h.lines).length, 1);

  // Back on: a served keystroke, and no new disabled line.
  pmod.__state.enabled = true;
  await h.ask(1, 12);
  assert.equal(disabledLines(h.lines).length, 1, "an enabled keystroke printed a disabled line");

  // Off again. A human who turns the feature off a second time is asking the
  // question a second time, and a feature that goes quiet with no channel line
  // is what evidence discipline exists to prevent.
  pmod.__state.enabled = false;
  await h.ask(1, 12);
  await h.ask(1, 13);
  assert.equal(disabledLines(h.lines).length, 2, h.lines.join("\n"));
  h.service.dispose();
  pmod.__state.enabled = true;
});

test("[IMPL-V74-P4 4] a fresh provider answers for its own first off", async () => {
  // The ledger is per instance, so a window reload (a new provider) says it
  // once more rather than inheriting somebody else's answer.
  pmod.__state.enabled = false;
  const a = newProvider();
  await a.ask(1, 12);
  const b = newProvider();
  await b.ask(1, 12);
  assert.equal(disabledLines(a.lines).length, 1);
  assert.equal(disabledLines(b.lines).length, 1);
  a.service.dispose();
  b.service.dispose();
  pmod.__state.enabled = true;
});
