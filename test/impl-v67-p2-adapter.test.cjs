// session-v67 phase 2, white-box: the adapter inserts the dictated sentence into a
// comment and hands over to the tighten. The blind file proves the contract's
// surface; these rows pin the mechanics the implementer chose and a reader
// cannot see from the surface: the tighten is chained on the insert's promise,
// the heard label rides the existing linger timer (no second timer), the clamp
// re-reads the CURRENT line for both the column and the leading space, and the
// failure paths still let the label go.
//
// Harness as blind-v67-p2-adapter: the real Dictation bundled against the shared
// activation stub, a resident recogniser object, staged binaries so a press arms.
// The stub has no DecorationRangeBehavior, so `indicator heard` throws on an ACTIVE
// editor (scrap S67-2); rows that read the status bar leave the site editor visible
// only, the way the blind rule 11 row does.
//
// Run: SKIP_LIVE=1 node --test test/impl-v67-p2-adapter.test.cjs

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { bundleActivation } = require("./.activation-stub.cjs");

const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), "impl-v67-p2-"));
process.env.COLUMN80_NATIVE_DIR = SCRATCH;
process.env.COLUMN80_WHISPER_MODEL = path.join(SCRATCH, "base.en.bin");
process.env.COLUMN80_VAD_MODEL = path.join(SCRATCH, "vad.bin");
fs.writeFileSync(process.env.COLUMN80_WHISPER_MODEL, "");
fs.writeFileSync(process.env.COLUMN80_VAD_MODEL, "");
fs.writeFileSync(path.join(SCRATCH, "whisper-server"), "");
fs.writeFileSync(path.join(SCRATCH, "column80-capture"), "#!/bin/sh\nexec sleep 3\n");
fs.chmodSync(path.join(SCRATCH, "column80-capture"), 0o755);

const built = bundleActivation(
  "impl-v67-p2-adapter",
  `export { Dictation } from "../src/vscode/dictation";
export { window } from "vscode";\n`,
);
const { Dictation, __state, Position, window } = built.mod;

test.after(() => {
  built.cleanup();
  fs.rmSync(SCRATCH, { recursive: true, force: true });
});

const URI = "file:///w/v67/impl.ts";
const OTHER_URI = "file:///w/v67/elsewhere.ts";
const SPOKEN = "this is the sentence";
const SENTENCE = "This is the sentence.";
const TIGHTEN = "column80.tightenDocComment";
const HEARD_LINGER_MS = 2500;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const statusItems = [];
const originalCreateStatusBarItem = window.createStatusBarItem;
window.createStatusBarItem = (...args) => {
  const item = originalCreateStatusBarItem(...args);
  item.calls = [];
  const show = item.show;
  const hide = item.hide;
  item.show = () => {
    item.calls.push(`show:${item.text}`);
    show.call(item);
  };
  item.hide = () => {
    item.calls.push("hide");
    hide.call(item);
  };
  statusItems.push(item);
  return item;
};
const statusMessages = [];
window.setStatusBarMessage = (text) => {
  statusMessages.push(String(text));
  return { dispose() {} };
};
// The real host makes the shown document's editor the active one; the stub does not,
// so the wrap does, and records the call. `showError` set makes it reject.
const shows = [];
let showError;
window.showTextDocument = async (document, opts) => {
  shows.push({ uri: document.uri.toString(), opts });
  if (showError) throw showError;
  const editor = __state.visibleTextEditors.find((e) => e.document === document);
  __state.activeTextEditor = editor;
  return editor;
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
  shows.length = 0;
  showError = undefined;
  const context = { extensionPath: SCRATCH, subscriptions: [], globalStorageUri: { fsPath: SCRATCH } };
  const d = new Dictation(context, output, { armIntent() {} });
  d.recogniser = { alive: true, dispose() {} };
  return { d, lines, item: statusItems[statusItems.length - 1] };
}
const dictateLines = (lines) => lines.filter((l) => l.includes("[dictate]")).join("\n");

/** A harness editor over `text`; `edit` records the builder's calls, applies the
 *  insert, and resolves `editResult` after `editDelayMs`. */
function editorAt({ text, line, col, lang = "typescript", uri = URI, editResult = true, editDelayMs = 0, trace = [] }) {
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
    setText(t) {
      current = t;
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
      lineAt: (n) => ({ text: rows()[n] ?? "", range: { end: new Position(n, (rows()[n] ?? "").length) } }),
    },
    viewColumn: 2,
    selection: { active: new Position(line, col) },
    setDecorations() {},
    revealRange() {},
    async edit(cb, opts) {
      const rec = { calls: [], opts };
      ed.edits.push(rec);
      cb({
        insert: (p, t) => {
          rec.calls.push({ position: { line: p.line, character: p.character }, text: t });
          trace.push("insert");
          const r = rows();
          const l = r[p.line] ?? "";
          r[p.line] = l.slice(0, p.character) + t + l.slice(p.character);
          current = r.join("\n");
        },
      });
      if (editDelayMs) await sleep(editDelayMs);
      trace.push("edit-resolved");
      if (editResult instanceof Error) throw editResult;
      return editResult;
    },
  };
  return ed;
}

const finalising = (line, lang = "typescript") => ({ phase: "finalising", site: { uri: URI, line }, languageId: lang, indentColumns: 0, commentSite: true });
const transcript = () => ({ type: "transcript", text: SPOKEN, decodeMs: 5 });
const tightenCalls = () => __state.executeCalls.filter((c) => c.id === TIGHTEN);

/** Press on `editor` (the caret is read there), then hold the gesture in `finalising`
 *  on the comment site. `visibleOnly` leaves the editor out of `activeTextEditor` for
 *  the rows that read the status bar (S67-2). */
async function pressThenFinalise(d, editor, { visibleOnly = false } = {}) {
  __state.activeTextEditor = editor;
  await d.press();
  assert.equal(d.phase, "arming", `CONTROL: the press armed: ${d.phase}`);
  d.state = finalising(editor.selection.active.line, editor.document.languageId);
  if (visibleOnly) {
    __state.activeTextEditor = undefined;
    __state.visibleTextEditors = [editor];
  }
}

// ---------------------------------------------------------------------------
// The tighten is chained on the insert's promise
// ---------------------------------------------------------------------------

test("the tighten waits for a slow edit: nothing runs while the edit is pending, and it runs once after the edit resolved", async () => {
  const { d, lines } = newRig();
  const trace = [];
  const editor = editorAt({ text: "//", line: 0, col: 2, editDelayMs: 150, trace });
  __state.commandHandlers[TIGHTEN] = () => {
    trace.push("tighten");
    return Promise.resolve();
  };
  try {
    await pressThenFinalise(d, editor);
    d.dispatch(transcript());
    assert.equal(d.phase, "idle", "the gesture is idle the moment the transcript is reduced");
    await sleep(60);
    assert.deepEqual(trace, ["insert"], `the tighten ran before the edit resolved: ${JSON.stringify(trace)}\n${dictateLines(lines)}`);
    assert.ok(!lines.includes("[dictate] tighten invoked"), `the tighten line was written before the edit resolved:\n${dictateLines(lines)}`);
    await sleep(200);
    assert.deepEqual(trace, ["insert", "edit-resolved", "tighten"], JSON.stringify(trace));
    assert.equal(tightenCalls().length, 1);
    const inserted = lines.indexOf(lines.find((l) => l.startsWith("[dictate] comment inserted at ")));
    const invoked = lines.indexOf("[dictate] tighten invoked");
    assert.ok(inserted >= 0 && inserted < invoked, `channel order: inserted=${inserted} invoked=${invoked}\n${dictateLines(lines)}`);
  } finally {
    delete __state.commandHandlers[TIGHTEN];
    d.dispose();
  }
});

test("a slow edit that resolves false never reaches the tighten, and the refusal names the reason", async () => {
  const { d, lines } = newRig();
  const editor = editorAt({ text: "//", line: 0, col: 2, editDelayMs: 80, editResult: false });
  try {
    await pressThenFinalise(d, editor);
    d.dispatch(transcript());
    await sleep(200);
    assert.equal(tightenCalls().length, 0, dictateLines(lines));
    const failed = lines.find((l) => l.startsWith("[dictate] comment insert failed: "));
    assert.ok(failed, dictateLines(lines));
    assert.deepEqual(statusMessages, [`Column 80: dictation stopped: ${failed.slice("[dictate] comment insert failed: ".length)}`]);
  } finally {
    d.dispose();
  }
});

test("a second gesture after a failed insert does not inherit the failure: its own tighten runs", async () => {
  const { d, lines } = newRig();
  const first = editorAt({ text: "//", line: 0, col: 2, editResult: false });
  const second = editorAt({ text: "//", line: 0, col: 2 });
  try {
    await pressThenFinalise(d, first);
    d.dispatch(transcript());
    await sleep(60);
    assert.equal(tightenCalls().length, 0, `CONTROL: ${dictateLines(lines)}`);
    await pressThenFinalise(d, second);
    d.dispatch(transcript());
    await sleep(60);
    assert.equal(second.edits.length, 1, dictateLines(lines));
    assert.equal(tightenCalls().length, 1, dictateLines(lines));
  } finally {
    d.dispose();
  }
});

// ---------------------------------------------------------------------------
// The clamp re-reads the current line
// ---------------------------------------------------------------------------

const CLAMPS = [
  { name: "line shrank to `//`: column 2, one leading space", before: "// already", col: 10, after: "//", at: 2, inserted: ` ${SENTENCE}` },
  { name: "line shrank to `// `: column 3, no leading space after the space", before: "// already", col: 10, after: "// ", at: 3, inserted: SENTENCE },
  { name: "line changed under the column: pressed after a space, now after `x`, so a space is added", before: "// ", col: 3, after: "//x", at: 3, inserted: ` ${SENTENCE}` },
  { name: "line emptied: column 0, no leading space", before: "// already", col: 10, after: "", at: 0, inserted: SENTENCE },
];

test("the insert column is min(press column, current length) and the space rule reads the current text", async (t) => {
  for (const row of CLAMPS) {
    await t.test(row.name, async () => {
      const { d, lines } = newRig();
      const editor = editorAt({ text: row.before, line: 0, col: row.col });
      try {
        await pressThenFinalise(d, editor);
        editor.setText(row.after);
        d.dispatch(transcript());
        await sleep(60);
        assert.equal(editor.edits.length, 1, dictateLines(lines));
        assert.deepEqual(editor.edits[0].calls, [{ position: { line: 0, character: row.at }, text: row.inserted }]);
        assert.equal(editor.selection.active.character, row.at + row.inserted.length, "the caret ends after the text");
        assert.match(lines.find((l) => l.startsWith("[dictate] comment inserted at ")) ?? "", new RegExp(`:0:${row.at} chars=${row.inserted.length} insert=\\d+ms$`));
      } finally {
        d.dispose();
      }
    });
  }
});

// ---------------------------------------------------------------------------
// The heard label rides the existing linger
// ---------------------------------------------------------------------------

test("the heard label is still up 1s after the hand-off and gone within HEARD_LINGER_MS plus a margin, on one timer", async () => {
  const { d, lines, item } = newRig();
  const editor = editorAt({ text: "//", line: 0, col: 2 });
  try {
    await pressThenFinalise(d, editor, { visibleOnly: true });
    d.dispatch(transcript());
    await sleep(60);
    assert.equal(editor.edits.length, 1, `CONTROL: ${dictateLines(lines)}`);
    assert.equal(tightenCalls().length, 1, "CONTROL: the hand-off happened");
    assert.equal(item.text, "$(mic) heard", JSON.stringify(item.calls));
    const shown = item.calls.length;
    await sleep(1000);
    assert.equal(item.text, "$(mic) heard", "the label went early");
    assert.ok(!item.calls.slice(shown).includes("hide"), `hidden inside the linger: ${JSON.stringify(item.calls)}`);
    await sleep(HEARD_LINGER_MS - 1000 + 400);
    assert.ok(item.calls.slice(shown).includes("hide"), `still up after the linger: ${JSON.stringify(item.calls)}`);
    const hides = item.calls.slice(shown).filter((c) => c === "hide").length;
    assert.equal(hides, 1, `one linger, one hide: ${JSON.stringify(item.calls)}`);
  } finally {
    d.dispose();
  }
});

test("the label also goes after a failed insert: the refusal shows and the heard label hides within the linger", async () => {
  const { d, lines, item } = newRig();
  const editor = editorAt({ text: "//", line: 0, col: 2, editResult: false });
  try {
    await pressThenFinalise(d, editor, { visibleOnly: true });
    d.dispatch(transcript());
    await sleep(60);
    assert.equal(item.text, "$(mic) heard", `CONTROL: ${JSON.stringify(item.calls)}\n${dictateLines(lines)}`);
    assert.equal(statusMessages.length, 1, `CONTROL: the refusal showed: ${JSON.stringify(statusMessages)}`);
    const shown = item.calls.length;
    await sleep(HEARD_LINGER_MS + 400);
    assert.ok(item.calls.slice(shown).includes("hide"), `still up after the linger: ${JSON.stringify(item.calls)}`);
  } finally {
    d.dispose();
  }
});

// ---------------------------------------------------------------------------
// The editor moved away
// ---------------------------------------------------------------------------

// A site with nowhere to land is an insert failure to the user (review F6): the
// channel keeps the contract's `error:` line, and the status bar says the sentence
// was lost, the same way a declined edit does.
const NOWHERE = [
  {
    name: "the site's document is in no editor",
    reason: "the editor moved away from the dictated line",
    arrange: (editor, other) => {
      __state.activeTextEditor = undefined;
      __state.visibleTextEditors = [other];
    },
  },
  {
    name: "the site line is past the document's end",
    reason: "the dictated line is gone",
    arrange: (editor) => {
      editor.setText("");
      __state.activeTextEditor = undefined;
      __state.visibleTextEditors = [editor];
    },
    line: 1,
    text: "//\n// two",
    col: 6,
  },
];

test("a site with nowhere to land: error line, insert-failed line, `failed` refusal, no edit, no tighten, idle, the label goes", async (t) => {
  for (const row of NOWHERE) {
    await t.test(row.name, async () => {
      const { d, lines, item } = newRig();
      const editor = editorAt({ text: row.text ?? "//", line: row.line ?? 0, col: row.col ?? 2 });
      const other = editorAt({ text: "// elsewhere", line: 0, col: 12, uri: OTHER_URI });
      try {
        await pressThenFinalise(d, editor);
        row.arrange(editor, other);
        d.dispatch(transcript());
        await sleep(60);
        assert.ok(lines.includes(`[dictate] error: ${row.reason}`), dictateLines(lines));
        assert.ok(lines.includes(`[dictate] comment insert failed: ${row.reason}`), dictateLines(lines));
        assert.deepEqual(statusMessages, [`Column 80: dictation stopped: ${row.reason}`]);
        assert.equal(editor.edits.length + other.edits.length, 0);
        assert.equal(tightenCalls().length, 0);
        assert.equal(d.phase, "idle");
        const shown = item.calls.length;
        await sleep(HEARD_LINGER_MS + 400);
        assert.ok(item.calls.slice(shown).includes("hide"), `the label outlived the failed hand-off: ${JSON.stringify(item.calls)}`);
      } finally {
        d.dispose();
      }
    });
  }
});

// ---------------------------------------------------------------------------
// The press column belongs to the press that armed the gesture (review F1)
// ---------------------------------------------------------------------------

test("the stop press does not move the column: a caret moved during the take, then the stop press, still lands at the first press", async () => {
  const { d, lines } = newRig();
  const editor = editorAt({ text: "// already", line: 0, col: 10 });
  try {
    await pressThenFinalise(d, editor);
    d.state = { ...d.state, phase: "recording", pressedAt: Date.now() };
    editor.selection = { active: new Position(0, 3) };
    await d.press();
    assert.equal(d.phase, "finalising", `CONTROL: the second press stopped the take: ${d.phase}`);
    d.state = finalising(0);
    d.dispatch(transcript());
    await sleep(60);
    assert.deepEqual(editor.edits[0]?.calls, [{ position: { line: 0, character: 10 }, text: ` ${SENTENCE}` }], dictateLines(lines));
  } finally {
    d.dispose();
  }
});

test("a stop press with the caret in another document keeps the first press's column", async () => {
  const { d, lines } = newRig();
  const editor = editorAt({ text: "// already", line: 0, col: 10 });
  const other = editorAt({ text: "x", line: 0, col: 1, uri: OTHER_URI });
  try {
    await pressThenFinalise(d, editor);
    d.state = { ...d.state, phase: "recording", pressedAt: Date.now() };
    __state.activeTextEditor = other;
    await d.press();
    d.state = finalising(0);
    __state.activeTextEditor = editor;
    d.dispatch(transcript());
    await sleep(60);
    assert.equal(editor.edits[0]?.calls[0].position.character, 10, dictateLines(lines));
  } finally {
    d.dispose();
  }
});

test("a refused press (no comment row) does not move the column of the gesture that follows", async () => {
  const { d, lines } = newRig();
  const editor = editorAt({ text: "// already", line: 0, col: 10 });
  try {
    __state.activeTextEditor = editorAt({ text: "text", line: 0, col: 4, lang: "plaintext" });
    await d.press();
    assert.equal(d.phase, "idle", `CONTROL: the press refused: ${dictateLines(lines)}`);
    await pressThenFinalise(d, editor);
    d.dispatch(transcript());
    await sleep(60);
    assert.equal(editor.edits[0]?.calls[0].position.character, 10, dictateLines(lines));
  } finally {
    d.dispose();
  }
});

// ---------------------------------------------------------------------------
// The tighten runs on the site's editor (review F2)
// ---------------------------------------------------------------------------

test("a sentence that landed in a visible-only editor brings that editor to the front before the tighten, which then sees it active", async () => {
  const { d, lines } = newRig();
  const visible = editorAt({ text: "//", line: 0, col: 2 });
  const active = editorAt({ text: "/** other */", line: 0, col: 4, uri: OTHER_URI });
  let tightenedUri;
  __state.commandHandlers[TIGHTEN] = () => {
    tightenedUri = __state.activeTextEditor?.document.uri.toString();
    return Promise.resolve();
  };
  try {
    await pressThenFinalise(d, visible);
    __state.activeTextEditor = active;
    __state.visibleTextEditors = [active, visible];
    d.dispatch(transcript());
    await sleep(60);
    assert.equal(visible.edits.length, 1, `CONTROL: ${dictateLines(lines)}`);
    assert.deepEqual(shows, [{ uri: URI, opts: { viewColumn: 2, preserveFocus: false } }]);
    assert.ok(lines.includes("[dictate] focus returned to the dictated editor for the tighten"), dictateLines(lines));
    assert.equal(tightenCalls().length, 1);
    assert.equal(tightenedUri, URI, `the tighten ran against ${tightenedUri}`);
    const focused = lines.indexOf("[dictate] focus returned to the dictated editor for the tighten");
    assert.ok(focused < lines.indexOf("[dictate] tighten invoked"), "focus before the tighten line");
  } finally {
    delete __state.commandHandlers[TIGHTEN];
    d.dispose();
  }
});

test("when the site editor is already active nothing is shown and no focus line is written", async () => {
  const { d, lines } = newRig();
  const editor = editorAt({ text: "//", line: 0, col: 2 });
  try {
    await pressThenFinalise(d, editor);
    d.dispatch(transcript());
    await sleep(60);
    assert.equal(tightenCalls().length, 1, dictateLines(lines));
    assert.deepEqual(shows, []);
    assert.ok(!lines.some((l) => l.includes("focus returned")), dictateLines(lines));
  } finally {
    d.dispose();
  }
});

test("a showTextDocument that rejects skips the tighten with its reason; the sentence stays", async () => {
  const { d, lines } = newRig();
  const visible = editorAt({ text: "//", line: 0, col: 2 });
  const active = editorAt({ text: "x", line: 0, col: 1, uri: OTHER_URI });
  try {
    await pressThenFinalise(d, visible);
    __state.activeTextEditor = active;
    __state.visibleTextEditors = [active, visible];
    showError = new Error("the group is gone");
    d.dispatch(transcript());
    await sleep(60);
    assert.equal(visible.document.getText(), `// ${SENTENCE}`);
    assert.ok(lines.includes("[dictate] tighten skipped: the group is gone"), dictateLines(lines));
    assert.equal(tightenCalls().length, 0, "the tighten ran on the wrong editor");
    assert.ok(!lines.includes("[dictate] tighten invoked"));
    assert.equal(statusMessages.length, 0, "a skipped tighten is not a refusal");
  } finally {
    d.dispose();
  }
});

// ---------------------------------------------------------------------------
// dispose() mid-insert (review F5)
// ---------------------------------------------------------------------------

test("dispose() while the edit is pending: no tighten, no tighten line, no linger re-armed", async () => {
  const { d, lines, item } = newRig();
  const editor = editorAt({ text: "//", line: 0, col: 2, editDelayMs: 100 });
  try {
    await pressThenFinalise(d, editor, { visibleOnly: true });
    d.dispatch(transcript());
    await sleep(20);
    d.dispose();
    const calls = item.calls.length;
    await sleep(200);
    assert.equal(tightenCalls().length, 0, dictateLines(lines));
    assert.ok(!lines.includes("[dictate] tighten invoked"), dictateLines(lines));
    assert.deepEqual(item.calls.slice(calls), [], `the disposed item was painted again: ${JSON.stringify(item.calls.slice(calls))}`);
  } finally {
    d.dispose();
  }
});

test("a press on a comment site keeps its own character for the insert: two presses, the second column wins", async () => {
  const { d, lines } = newRig();
  const editor = editorAt({ text: "// one two", line: 0, col: 6 });
  try {
    await pressThenFinalise(d, editor);
    d.cancel();
    assert.equal(d.phase, "idle", "CONTROL");
    editor.selection = { active: new Position(0, 10) };
    await pressThenFinalise(d, editor);
    d.dispatch(transcript());
    await sleep(60);
    assert.deepEqual(editor.edits.map((e) => e.calls[0].position), [{ line: 0, character: 10 }], dictateLines(lines));
  } finally {
    d.dispose();
  }
});
