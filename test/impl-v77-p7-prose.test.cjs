"use strict";

// session-v77 phase 7 (goal.md Amendment 4).
//
// A1: markdown and plaintext are a prose dictation site. The press records, the transcript
//     lands at the press caret as typed text: no comment marker, no tighten, no intent, no FIM.
// A2: a press in a language dictation can never serve refuses before the recorder, speech
//     model and recogniser checks, so it never offers the 148MB download first. Remote stays first.
//
// Run: SKIP_LIVE=1 node --test test/impl-v77-p7-prose.test.cjs

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { bundleActivation } = require("./.activation-stub.cjs");
const { bundleCore } = require("./.blind-util.cjs");

const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), "impl-v77-p7-"));
process.env.COLUMN80_NATIVE_DIR = SCRATCH;
process.env.COLUMN80_WHISPER_MODEL = path.join(SCRATCH, "base.en.bin");
process.env.COLUMN80_VAD_MODEL = path.join(SCRATCH, "vad.bin");
fs.writeFileSync(process.env.COLUMN80_WHISPER_MODEL, "");
fs.writeFileSync(process.env.COLUMN80_VAD_MODEL, "");
fs.writeFileSync(path.join(SCRATCH, "whisper-server"), "");
fs.writeFileSync(path.join(SCRATCH, "column80-capture"), "#!/bin/sh\nexec sleep 3\n");
fs.chmodSync(path.join(SCRATCH, "column80-capture"), 0o755);

const built = bundleActivation(
  "impl-v77-p7-prose",
  `export { Dictation } from "../src/vscode/dictation";
export { window } from "vscode";\n`,
);
const core = bundleCore("impl-v77-p7-prose-reducer", 'export * from "../src/core/dictationGesture";\n');
test.after(() => {
  built.cleanup();
  core.cleanup();
  fs.rmSync(SCRATCH, { recursive: true, force: true });
});
const { Dictation, __state, Position, window } = built.mod;
const { reduce, IDLE } = core.mod;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

const READY = {
  remote: false,
  binaryPresent: true,
  modelPresent: true,
  recogniserAlive: true,
  served: true,
  commentRow: true,
  inComment: false,
  prose: false,
  platform: "linux-x64",
};
const PROSE = { served: false, commentRow: false, inComment: false, prose: true };
const pressEvent = (ready, languageId = "typescript") => ({
  type: "press",
  site: { uri: "file:///w/notes.md", line: 2 },
  languageId,
  indentColumns: 0,
  now: 1000,
  ghostVisible: false,
  ready: { ...READY, ...ready },
});

/** Press, first buffer, stop, a captured take: the reducer at the transcript. */
function takeTo(ready, languageId, text) {
  let s = reduce(IDLE, pressEvent(ready, languageId)).state;
  s = reduce(s, { type: "first-buffer", msSincePress: 30 }).state;
  s = reduce(s, { type: "press", ...pressEvent(ready, languageId), now: 2000 }).state;
  s = reduce(s, { type: "stopped", pcmBytes: 3200 }).state;
  return { before: s, out: reduce(s, { type: "transcript", text, decodeMs: 5 }) };
}

const MODEL_ACTIONS = new Set(["build-intent", "trigger-fim", "tighten", "insert-comment"]);

test("A1: a prose press arms with no refusal, though FIM does not serve it and it has no comment syntax", () => {
  for (const lang of ["markdown", "plaintext"]) {
    const out = reduce(IDLE, pressEvent(PROSE, lang));
    assert.equal(out.state.phase, "arming", `${lang}: ${JSON.stringify(out.actions)}`);
    assert.equal(out.state.proseSite, true, lang);
    assert.equal(out.state.commentSite, undefined, lang);
    assert.ok(!out.actions.some((a) => a.type === "refuse"), `${lang}: ${JSON.stringify(out.actions)}`);
  }
});

test("A1: the prose transcript is inserted as typed, trimmed, and the gesture is idle", () => {
  const rows = [
    { name: "lower case, no full stop", text: "  then we ship it  ", want: "then we ship it" },
    { name: "case and punctuation kept", text: " Ship it on Friday, maybe", want: "Ship it on Friday, maybe" },
    { name: "noise marker dropped", text: "[BLANK_AUDIO] the plan holds", want: "the plan holds" },
  ];
  for (const row of rows) {
    const { before, out } = takeTo(PROSE, "markdown", row.text);
    assert.equal(before.phase, "finalising", `${row.name}: CONTROL`);
    assert.equal(out.state.phase, "idle", row.name);
    const inserts = out.actions.filter((a) => a.type === "insert-text");
    assert.deepEqual(inserts, [{ type: "insert-text", site: { uri: "file:///w/notes.md", line: 2 }, text: row.want }], `${row.name}: ${JSON.stringify(out.actions)}`);
    assert.ok(!out.actions.some((a) => MODEL_ACTIONS.has(a.type)), `${row.name}: ${JSON.stringify(out.actions)}`);
    assert.deepEqual(out.actions.find((a) => a.type === "indicator"), { type: "indicator", mode: "heard", text: row.want }, row.name);
    assert.ok(out.actions.some((a) => a.type === "unmute"), row.name);
  }
});

test("A1: an empty prose take refuses heard nothing, as at a comment site", () => {
  for (const text of ["", "   ", "[BLANK_AUDIO]"]) {
    const { out } = takeTo(PROSE, "markdown", text);
    assert.equal(out.state.phase, "idle");
    assert.deepEqual(out.actions.find((a) => a.type === "refuse"), { type: "refuse", kind: "empty-transcript" }, JSON.stringify(text));
    assert.ok(!out.actions.some((a) => a.type === "insert-text"), JSON.stringify(text));
  }
});

test("A1: Escape on a prose take cancels, as at a comment site", () => {
  let s = reduce(IDLE, pressEvent(PROSE, "markdown")).state;
  s = reduce(s, { type: "first-buffer", msSincePress: 30 }).state;
  const out = reduce(s, { type: "cancel", now: 1500 });
  assert.equal(out.state.phase, "idle");
  assert.deepEqual(out.actions.slice(0, 4), [{ type: "abort-capture" }, { type: "unmute" }, { type: "indicator", mode: "off" }, { type: "refuse", kind: "cancelled" }]);
});

test("A1: a prose site still refuses remote, and the recorder checks when served", () => {
  for (const [ready, kind] of [
    [{ remote: true }, "remote"],
    [{ binaryPresent: false }, "binary-missing"],
    [{ modelPresent: false }, "model-missing"],
    [{ recogniserAlive: false }, "server-down"],
  ]) {
    const out = reduce(IDLE, pressEvent({ ...PROSE, ...ready }, "markdown"));
    assert.equal(out.actions[0].kind, kind);
  }
});

// A2. A never-served press: not prose, and (no comment syntax, or not served and not in a comment).
const NEVER = [
  { name: "no comment syntax (zig)", ready: { commentRow: false, served: false }, lang: "zig", kind: "no-comment-row" },
  { name: "code line, not served (lua)", ready: { served: false, inComment: false }, lang: "lua", kind: "not-served" },
];
const MACHINE = [
  { name: "binary missing", ready: { binaryPresent: false } },
  { name: "model missing", ready: { modelPresent: false } },
  { name: "recogniser down", ready: { recogniserAlive: false } },
  { name: "all three", ready: { binaryPresent: false, modelPresent: false, recogniserAlive: false } },
];

test("A2: a press dictation can never serve refuses for the language before any machine check", () => {
  for (const n of NEVER) {
    for (const m of MACHINE) {
      const out = reduce(IDLE, pressEvent({ ...n.ready, ...m.ready }, n.lang));
      assert.deepEqual(out.actions[0], { type: "refuse", kind: n.kind, detail: n.lang }, `${n.name} x ${m.name}`);
    }
  }
});

test("A2: remote stays first, ahead of the language refusals", () => {
  for (const n of NEVER) {
    const out = reduce(IDLE, pressEvent({ ...n.ready, remote: true, modelPresent: false }, n.lang));
    assert.deepEqual(out.actions[0], { type: "refuse", kind: "remote" }, n.name);
  }
});

test("A2: no comment syntax still comes before not-served (the L1 order)", () => {
  const out = reduce(IDLE, pressEvent({ commentRow: false, served: false }, "zig"));
  assert.equal(out.actions[0].kind, "no-comment-row");
});

test("A2 control: a press that can be served still refuses the machine checks in their order", () => {
  // A comment site in an unserved language is servable: it reaches the model check.
  const out = reduce(IDLE, pressEvent({ served: false, inComment: true, modelPresent: false }, "lua"));
  assert.deepEqual(out.actions[0], { type: "refuse", kind: "model-missing" });
  const both = reduce(IDLE, pressEvent({ binaryPresent: false, modelPresent: false }));
  assert.equal(both.actions[0].kind, "binary-missing");
});

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

const statusMessages = [];
window.setStatusBarMessage = (text) => {
  statusMessages.push(String(text));
  return { dispose() {} };
};

function newRig() {
  const lines = [];
  const output = { appendLine: (l) => lines.push(String(l)), append: () => {} };
  __state.config = { "dictation.muteSpeakers": false, "dictation.partials": false };
  __state.executeCalls = [];
  __state.messages = [];
  __state.visibleTextEditors = [];
  __state.activeTextEditor = undefined;
  statusMessages.length = 0;
  const context = { extensionPath: SCRATCH, subscriptions: [], globalStorageUri: { fsPath: SCRATCH } };
  const spies = { armIntent: [], disarmIntent: [] };
  const d = new Dictation(context, output, { armIntent: (i) => spies.armIntent.push(i), disarmIntent: () => spies.disarmIntent.push(1) });
  d.recogniser = { alive: true, dispose() {} };
  return { d, lines, spies };
}

/** A harness editor over `text` whose `edit` applies inserts to the text. */
function editorAt({ text, line, col, lang, uri }) {
  let current = text;
  const rows = () => current.split("\n");
  const offsetAt = (p) => {
    const r = rows();
    let o = 0;
    for (let i = 0; i < Math.min(p.line, r.length); i++) o += r[i].length + 1;
    return Math.min(o + p.character, current.length);
  };
  const ed = {
    edits: [],
    get text() {
      return current;
    },
    document: {
      uri: { toString: () => uri, scheme: "file" },
      languageId: lang,
      version: 1,
      eol: 1,
      get lineCount() {
        return rows().length;
      },
      getText: (range) => (range ? current.slice(offsetAt(range.start), offsetAt(range.end)) : current),
      offsetAt,
      lineAt: (n) => ({ text: rows()[n] ?? "", range: { end: new Position(n, (rows()[n] ?? "").length) } }),
    },
    selection: { active: new Position(line, col) },
    setDecorations() {},
    revealRange() {},
    async edit(cb, opts) {
      const rec = { calls: [], opts };
      ed.edits.push(rec);
      cb({
        insert: (p, t) => {
          rec.calls.push({ line: p.line, character: p.character, text: t });
          const r = rows();
          const l = r[p.line] ?? "";
          r[p.line] = l.slice(0, p.character) + t + l.slice(p.character);
          current = r.join("\n");
        },
        replace: () => rec.calls.push({ op: "replace" }),
        delete: () => rec.calls.push({ op: "delete" }),
      });
      return true;
    },
  };
  return ed;
}

/** Press through the adapter's own `press()`, hold the take at `finalising` (the recorder is a
 *  sleep), and hand it a transcript. Counts every network call made meanwhile. */
async function dictateInto(editor, spoken) {
  const rig = newRig();
  const fetches = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (...args) => {
    fetches.push(String(args[0]));
    return Promise.reject(new Error("no network in this row"));
  };
  try {
    __state.activeTextEditor = editor;
    __state.visibleTextEditors = [editor];
    await rig.d.press();
    const pressed = { phase: rig.d.phase, state: { ...rig.d.state } };
    rig.d.state = { ...rig.d.state, phase: "finalising" };
    rig.d.dispatch({ type: "transcript", text: spoken, decodeMs: 5 });
    await sleep(30);
    return { ...rig, pressed, fetches };
  } finally {
    globalThis.fetch = realFetch;
    rig.d.dispose();
  }
}

const NO_MODEL_COMMANDS = ["column80.tightenDocComment", "editor.action.inlineSuggest.trigger", "editor.action.inlineSuggest.commit", "column80.fimAccepted", "column80.dictationAccepted"];

test("A1 adapter: a markdown press inserts the transcript raw at the caret, with no model or network call", async () => {
  const editor = editorAt({ text: "# Notes\n\n", line: 2, col: 0, lang: "markdown", uri: "file:///w/notes.md" });
  const r = await dictateInto(editor, " then we ship it on friday ");
  assert.equal(r.pressed.phase, "arming", `CONTROL: the press armed: ${r.lines.join("\n")}`);
  assert.equal(r.pressed.state.proseSite, true);
  assert.equal(editor.text, "# Notes\n\nthen we ship it on friday", r.lines.join("\n"));
  assert.equal(editor.edits.length, 1);
  assert.deepEqual(editor.edits[0].opts, { undoStopBefore: true, undoStopAfter: true });
  assert.deepEqual(r.fetches, [], "no network call");
  assert.deepEqual(r.spies.armIntent, [], "no intent armed");
  const cmds = __state.executeCalls.map((c) => c.id).filter((id) => NO_MODEL_COMMANDS.includes(id));
  assert.deepEqual(cmds, [], "no tighten, no FIM");
  assert.ok(r.lines.some((l) => l.startsWith("[dictate] text inserted at file:///w/notes.md:2:0")), r.lines.join("\n"));
  assert.ok(!statusMessages.some((m) => /does not|cannot/.test(m)), statusMessages.join("\n"));
  assert.equal(r.d.phase, "idle");
});

test("A1 adapter: a plaintext press inserts the transcript raw too", async () => {
  const editor = editorAt({ text: "todo:\n", line: 1, col: 0, lang: "plaintext", uri: "file:///w/todo.txt" });
  const r = await dictateInto(editor, "buy milk");
  assert.equal(r.pressed.phase, "arming", r.lines.join("\n"));
  assert.equal(editor.text, "todo:\nbuy milk");
  assert.deepEqual(r.fetches, []);
});

test("A1 adapter: a separating space only after a non-whitespace character on the line", async () => {
  const rows = [
    { name: "after a word", text: "Ship it", col: 7, want: "Ship it then test" },
    { name: "after a space", text: "Ship it ", col: 8, want: "Ship it then test" },
    { name: "column 0", text: "", col: 0, want: "then test" },
    { name: "mid-line before text", text: "A.B", col: 2, want: "A. then testB" },
  ];
  for (const row of rows) {
    const editor = editorAt({ text: row.text, line: 0, col: row.col, lang: "markdown", uri: "file:///w/s.md" });
    await dictateInto(editor, "then test");
    assert.equal(editor.text, row.want, row.name);
  }
});

test("A1 adapter: a code language without comment syntax still refuses, and opens no mic", async () => {
  const editor = editorAt({ text: "const x = 1;\n", line: 1, col: 0, lang: "zig", uri: "file:///w/a.zig" });
  const rig = newRig();
  try {
    __state.activeTextEditor = editor;
    await rig.d.press();
    assert.equal(rig.d.phase, "idle");
    assert.ok(rig.lines.includes("[dictate] refused: no-comment-row"), rig.lines.join("\n"));
    assert.ok(statusMessages.some((m) => /zig/.test(m)), statusMessages.join("\n"));
  } finally {
    rig.d.dispose();
  }
});

test("A2 adapter: a never-served press with the speech model missing refuses with no download offer", async () => {
  const model = process.env.COLUMN80_WHISPER_MODEL;
  process.env.COLUMN80_WHISPER_MODEL = path.join(SCRATCH, "absent-model.bin");
  const offers = [];
  const realInfo = window.showInformationMessage;
  window.showInformationMessage = (message, ...actions) => {
    offers.push(String(message));
    return Promise.resolve(undefined);
  };
  const rig = newRig();
  try {
    __state.activeTextEditor = editorAt({ text: "\n", line: 0, col: 0, lang: "zig", uri: "file:///w/b.zig" });
    await rig.d.press();
    await sleep(30);
    assert.ok(rig.lines.includes("[dictate] refused: no-comment-row"), rig.lines.join("\n"));
    assert.deepEqual(offers.filter((m) => /speech model|download/i.test(m)), []);
    assert.ok(!__state.messages.some((m) => /speech model|download/i.test(m.message)), JSON.stringify(__state.messages));
  } finally {
    window.showInformationMessage = realInfo;
    process.env.COLUMN80_WHISPER_MODEL = model;
    rig.d.dispose();
  }
});
