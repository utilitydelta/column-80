// session-v77 phase 1b, adversarial review. Phase 1b rewrote the dictated
// ghost's accept command: it no longer forwards to the post-FIM-accept check,
// and it became synchronous. No unit row pinned what that command still owes
// the user: the dictated item carries it with the caret offset, and the handler
// puts the caret on the body line. These rows pin both, so a later edit to
// either file cannot drop the caret silently. impl-v77-p1b pins the other half
// (no oracle runs).
//
// Run: SKIP_LIVE=1 node --test test/review-v77-p1b-dictated-accept.test.cjs
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { bundleActivation } = require("./.activation-stub.cjs");

const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), "review-v77p1b-"));
process.env.COLUMN80_NATIVE_DIR = SCRATCH;
process.env.COLUMN80_WHISPER_MODEL = path.join(SCRATCH, "missing-base.en.bin");
process.env.COLUMN80_VAD_MODEL = path.join(SCRATCH, "missing-vad.bin");
const built = bundleActivation("review-v77-p1b", 'export { registerDictation, DICTATION_ACCEPTED_COMMAND } from "../src/vscode/dictation";\n');
const { providerModule, registerDictation, DICTATION_ACCEPTED_COMMAND, __state, Position, Range, Selection } = built.mod;

test.after(() => {
  built.cleanup();
  fs.rmSync(SCRATCH, { recursive: true, force: true });
});

const URI = "file:///w/v77/mod.ts";
const SRC = "export const a = 1;\n\nexport const b = 2;\n";

function doc() {
  const lines = SRC.split("\n");
  const starts = [0];
  for (let i = 0; i < SRC.length; i++) if (SRC[i] === "\n") starts.push(i + 1);
  const offsetAt = (p) => Math.min((starts[p.line] ?? SRC.length) + p.character, SRC.length);
  return {
    uri: { toString: () => URI, scheme: "file", fsPath: "/w/v77/mod.ts" },
    languageId: "typescript",
    version: 1,
    eol: 1,
    lineCount: lines.length,
    getText: (r) => (r ? SRC.slice(offsetAt(r.start), offsetAt(r.end)) : SRC),
    offsetAt,
    positionAt(o) {
      let line = 0;
      while (line + 1 < starts.length && starts[line + 1] <= o) line++;
      return new Position(line, o - starts[line]);
    },
    lineAt(a) {
      const n = typeof a === "number" ? a : a.line;
      const t = lines[n] ?? "";
      return { lineNumber: n, text: t, range: new Range(n, 0, n, t.length), firstNonWhitespaceCharacterIndex: t.search(/\S|$/), isEmptyOrWhitespace: t.trim() === "" };
    },
  };
}

test("a dictated declaration ghost carries column80.dictationAccepted with the caret offset as its fourth argument", async () => {
  __state.config = { enabled: true };
  const lines = [];
  const provider = new providerModule.FimCompletionProvider(
    () => ({ complete: async () => ({ text: "export function bump(n: number): number {" }) }),
    { appendLine: (l) => lines.push(String(l)), append() {} },
  );
  provider.armIntent({
    id: 1,
    uri: URI,
    line: 1,
    kind: "declaration",
    sentence: "Adds one to the count.",
    unit: "  ",
    comment: "// Adds one to the count.",
    roots: [],
    eol: "\n",
    indent: "",
    onServed: () => true,
  });
  const items = await provider.provideInlineCompletionItems(
    doc(),
    new Position(1, 0),
    { triggerKind: 0 },
    { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) },
  );
  assert.ok(Array.isArray(items) && items.length >= 1, `the dictated request served nothing: ${lines.join("\n")}`);
  const cmd = items[0].command;
  assert.ok(cmd !== undefined, "a dictated item must carry the accept command, or the caret and the take's end are lost");
  assert.equal(cmd.command, "column80.dictationAccepted");
  assert.equal(cmd.arguments.length, 4, `uri, landed start, text length, caret offset; got ${JSON.stringify(cmd.arguments)}`);
  assert.equal(typeof cmd.arguments[3], "number", "the caret offset rides as the fourth argument");
  const caretInItem = cmd.arguments[3] - cmd.arguments[1];
  const beforeCaret = items[0].insertText.slice(0, caretInItem);
  assert.ok(beforeCaret.includes("{"), `the caret sits past the head's opening brace, on the body line: ${JSON.stringify(beforeCaret)}`);
});

test("the dictated accept handler puts the caret at the offset it was handed, with no check forwarded", async () => {
  __state.config = { "dictation.muteSpeakers": false, "dictation.partials": false, "dictation.enabled": true };
  __state.executeCalls = [];
  const d = doc();
  const editor = { document: d, selection: new Selection(new Position(1, 0), new Position(1, 0)), setDecorations() {}, revealRange() {} };
  __state.activeTextEditor = editor;
  const context = { extensionPath: SCRATCH, subscriptions: [], globalStorageUri: { fsPath: SCRATCH }, globalState: { get: () => undefined, update: async () => {} } };
  registerDictation(context, { appendLine() {}, append() {} }, { armIntent() {} });
  const handler = __state.commands[DICTATION_ACCEPTED_COMMAND];
  assert.equal(typeof handler, "function");
  const caret = SRC.indexOf("export const b");
  await handler(URI, SRC.indexOf("\n\n") + 1, 4, caret);
  assert.equal(editor.selection.active.line, 2, "the caret lands at the offset the item named");
  assert.equal(editor.selection.active.character, 0);
  assert.deepEqual(__state.executeCalls.map((c) => c.id).filter((id) => id !== "setContext"), [], "nothing is executed after a dictated accept");
  for (const s of context.subscriptions) {
    try {
      s.dispose();
    } catch {
      /* teardown */
    }
  }
});
