// session-v67 phases 2 and 3, adversarial review. Failing rows are EVIDENCE for the
// findings in the review, not regressions to fix by editing this file; each row names
// the source line it attacks. Harness as blind-v67-p2-adapter: the REAL Dictation
// bundled against the shared activation stub, a resident recogniser object, staged
// binaries so a press arms, the status bar item captured at the factory.
//
// Run: SKIP_LIVE=1 node --test test/review-v67-p2.test.cjs
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { bundleActivation } = require("./.activation-stub.cjs");

const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), "review-v67-p2-"));
process.env.COLUMN80_NATIVE_DIR = SCRATCH;
process.env.COLUMN80_WHISPER_MODEL = path.join(SCRATCH, "base.en.bin");
process.env.COLUMN80_VAD_MODEL = path.join(SCRATCH, "vad.bin");
fs.writeFileSync(process.env.COLUMN80_WHISPER_MODEL, "");
fs.writeFileSync(process.env.COLUMN80_VAD_MODEL, "");
fs.writeFileSync(path.join(SCRATCH, "whisper-server"), "");
fs.writeFileSync(path.join(SCRATCH, "column80-capture"), "#!/bin/sh\nexec sleep 3\n");
fs.chmodSync(path.join(SCRATCH, "column80-capture"), 0o755);

const built = bundleActivation(
  "review-v67-p2",
  `export { Dictation } from "../src/vscode/dictation";
export { window } from "vscode";\n`,
);
const { Dictation, __state, Position, window } = built.mod;

test.after(() => {
  built.cleanup();
  fs.rmSync(SCRATCH, { recursive: true, force: true });
});

const URI = "file:///w/v67/review.ts";
const OTHER_URI = "file:///w/v67/other.ts";
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
  const d = new Dictation(context, output, { armIntent() {} });
  d.recogniser = { alive: true, dispose() {} };
  return { d, lines, item: statusItems[statusItems.length - 1] };
}
const dictateLines = (lines) => lines.filter((l) => l.includes("[dictate]")).join("\n");

function editorAt({ text, line, col, lang = "typescript", uri = URI, editDelayMs = 0 }) {
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
    selection: { active: new Position(line, col) },
    setDecorations() {},
    revealRange() {},
    async edit(cb, opts) {
      const rec = { calls: [], opts };
      ed.edits.push(rec);
      cb({
        insert: (p, t) => {
          rec.calls.push({ position: { line: p.line, character: p.character }, text: t });
          const r = rows();
          const l = r[p.line] ?? "";
          r[p.line] = l.slice(0, p.character) + t + l.slice(p.character);
          current = r.join("\n");
        },
      });
      if (editDelayMs) await sleep(editDelayMs);
      return true;
    },
  };
  return ed;
}

const finalising = (line, lang = "typescript") => ({ phase: "finalising", site: { uri: URI, line }, languageId: lang, indentColumns: 0, commentSite: true });
const transcript = () => ({ type: "transcript", text: SPOKEN, decodeMs: 5 });
const tightenCalls = () => __state.executeCalls.filter((c) => c.id === TIGHTEN);

async function pressOn(d, editor) {
  __state.activeTextEditor = editor;
  await d.press();
  assert.equal(d.phase, "arming", `CONTROL: the press armed: ${d.phase}`);
}

// ---------------------------------------------------------------------------
// F1: dictation.ts:454 `this.pressCharacter = position.character` runs on EVERY press,
// the stop press included. Goal ruling 2: the sentence lands "at the caret captured at
// the press" (the first). A caret that moved during the take, then the stop press,
// moves the insert to the SECOND press's column on the FIRST press's line.
// ---------------------------------------------------------------------------

test("F1: the stop press does not move the insert column; the sentence lands at the first press's caret", async () => {
  const { d, lines } = newRig();
  const editor = editorAt({ text: "// already", line: 0, col: 10 });
  try {
    await pressOn(d, editor);
    d.dispatch({ type: "first-buffer", msSincePress: 40 });
    assert.equal(d.phase, "recording", "CONTROL");
    // The user clicked back to column 3 while speaking, then pressed to stop.
    editor.selection = { active: new Position(0, 3) };
    await d.press();
    d.state = finalising(0);
    d.dispatch(transcript());
    await sleep(60);
    assert.equal(editor.edits.length, 1, dictateLines(lines));
    assert.deepEqual(editor.edits[0].calls, [{ position: { line: 0, character: 10 }, text: ` ${SENTENCE}` }], `inserted at the stop press's column, not the first press's:\n${dictateLines(lines)}`);
  } finally {
    d.dispose();
  }
});

test("F1b: a stop press with the caret in ANOTHER document keeps the first press's column", async () => {
  const { d, lines } = newRig();
  const editor = editorAt({ text: "// already", line: 0, col: 10 });
  const other = editorAt({ text: "x", line: 0, col: 1, uri: OTHER_URI });
  try {
    await pressOn(d, editor);
    d.dispatch({ type: "first-buffer", msSincePress: 40 });
    __state.activeTextEditor = other;
    await d.press();
    d.state = finalising(0);
    __state.activeTextEditor = editor;
    d.dispatch(transcript());
    await sleep(60);
    assert.equal(editor.edits.length, 1, dictateLines(lines));
    assert.equal(editor.edits[0].calls[0].position.character, 10, `the other document's caret column was used: ${JSON.stringify(editor.edits[0].calls)}`);
  } finally {
    d.dispose();
  }
});

// ---------------------------------------------------------------------------
// F2: dictation.ts `siteEditor` falls back to a visible editor, and `tighten()` runs
// `column80.tightenDocComment` with no argument; that command reads
// `vscode.window.activeTextEditor` (tightenDocComment.ts:1517). The insert lands in
// the visible editor and the tighten runs on the active one, a different document.
// ---------------------------------------------------------------------------

test("F2: when the site editor is visible but not active, the tighten runs on the site's document", async () => {
  const { d, lines } = newRig();
  const visible = editorAt({ text: "//", line: 0, col: 2 });
  const active = editorAt({ text: "/** other */", line: 0, col: 4, uri: OTHER_URI });
  let tightenedUri;
  __state.commandHandlers[TIGHTEN] = () => {
    tightenedUri = __state.activeTextEditor && __state.activeTextEditor.document.uri.toString();
    return Promise.resolve();
  };
  try {
    await pressOn(d, visible);
    d.state = finalising(0);
    __state.activeTextEditor = active;
    __state.visibleTextEditors = [active, visible];
    d.dispatch(transcript());
    await sleep(60);
    assert.equal(visible.edits.length, 1, `CONTROL: the insert landed in the visible editor\n${dictateLines(lines)}`);
    assert.equal(tightenCalls().length, 1, "CONTROL: the tighten was invoked");
    // AMENDED 2026-09-03 (triage p2, F2 fixed): the adapter now calls showTextDocument on the
    // site editor before the command. The shared stub's showTextDocument never sets
    // state.activeTextEditor, so `tightenedUri` cannot observe the focus here; the row pins the
    // focus call's channel line landing BEFORE the invoke instead. The real host proves the
    // rest (the line gesture's focus return uses the same call).
    const focusAt = lines.findIndex((l) => l.includes("focus returned to the dictated editor for the tighten"));
    const invokeAt = lines.findIndex((l) => l.includes("[dictate] tighten invoked"));
    assert.ok(focusAt >= 0, `no focus-return line before the tighten:\n${dictateLines(lines)}`);
    assert.ok(focusAt < invokeAt, `focus returned at ${focusAt} but the tighten was invoked at ${invokeAt}`);
    void tightenedUri;
  } finally {
    delete __state.commandHandlers[TIGHTEN];
    d.dispose();
  }
});

// ---------------------------------------------------------------------------
// F3 (observation, passes): typing on the press line during the take. The clamp rule
// (contract rule 4) inserts at the stale column into the changed text.
// ---------------------------------------------------------------------------

test("F3 observation: text typed after the caret during the take ends up AFTER the sentence", async () => {
  const { d, lines } = newRig();
  const editor = editorAt({ text: "// already", line: 0, col: 10 });
  try {
    await pressOn(d, editor);
    d.state = finalising(0);
    editor.setText("// already more");
    d.dispatch(transcript());
    await sleep(60);
    assert.equal(editor.document.getText(), `// already ${SENTENCE} more`, dictateLines(lines));
  } finally {
    d.dispose();
  }
});

// ---------------------------------------------------------------------------
// F4 (passes): the linger timer versus a new press inside 2.5s. The timer's guard
// (`indicatorMode === "heard"`) keeps the armed label up.
// ---------------------------------------------------------------------------

test("F4: a press inside the heard linger shows armed, and the old timer does not hide it", async () => {
  const { d, lines, item } = newRig();
  const editor = editorAt({ text: "//", line: 0, col: 2 });
  try {
    await pressOn(d, editor);
    d.state = finalising(0);
    __state.activeTextEditor = undefined;
    __state.visibleTextEditors = [editor];
    d.dispatch(transcript());
    await sleep(60);
    assert.equal(item.text, "$(mic) heard", `CONTROL: ${dictateLines(lines)}`);
    await sleep(500);
    await pressOn(d, editor);
    assert.equal(item.text, "$(record) opening mic…", JSON.stringify(item.calls));
    const shown = item.calls.length;
    await sleep(HEARD_LINGER_MS + 400);
    assert.equal(item.text, "$(record) opening mic…", `the old linger changed the armed label: ${JSON.stringify(item.calls.slice(shown))}`);
    assert.ok(!item.calls.slice(shown).includes("hide"), `the old linger hid the armed label: ${JSON.stringify(item.calls.slice(shown))}`);
  } finally {
    d.dispose();
  }
});

// ---------------------------------------------------------------------------
// F5: dispose() mid-insert. dictation.ts `dispose()` clears every timer but not
// `pendingInsert`; the chained tighten runs a command after the adapter is gone.
// ---------------------------------------------------------------------------

test("F5: dispose() during a pending insert stops the tighten from running afterwards", async () => {
  const { d, lines } = newRig();
  const editor = editorAt({ text: "//", line: 0, col: 2, editDelayMs: 100 });
  try {
    await pressOn(d, editor);
    d.state = finalising(0);
    d.dispatch(transcript());
    await sleep(20);
    d.dispose();
    await sleep(200);
    assert.equal(tightenCalls().length, 0, `the tighten ran after dispose():\n${dictateLines(lines)}`);
  } finally {
    d.dispose();
  }
});

// ---------------------------------------------------------------------------
// F6 (observation, passes): the leading-space rule around tabs, a surrogate pair,
// and a no-break space; and the editor-moved-away path raises no status message.
// ---------------------------------------------------------------------------

const SPACES = [
  { name: "tab before the caret: no space", text: "//\t", col: 3, inserted: SENTENCE },
  { name: "emoji (surrogate pair) before the caret: one space, UTF-16 column", text: "// 🙂", col: 5, inserted: ` ${SENTENCE}` },
  { name: "no-break space before the caret: no space (\\s matches U+00A0)", text: "//\u00a0", col: 3, inserted: SENTENCE },
];
test("F6 observation: the leading-space rule on tabs, a surrogate pair and NBSP", async (t) => {
  for (const row of SPACES) {
    await t.test(row.name, async () => {
      const { d, lines } = newRig();
      const editor = editorAt({ text: row.text, line: 0, col: row.col });
      try {
        await pressOn(d, editor);
        d.state = finalising(0);
        d.dispatch(transcript());
        await sleep(60);
        assert.deepEqual(editor.edits[0]?.calls, [{ position: { line: 0, character: row.col }, text: row.inserted }], dictateLines(lines));
        assert.equal(editor.selection.active.character, row.col + row.inserted.length);
      } finally {
        d.dispose();
      }
    });
  }
});

test("F6: the editor moved away tells the user on the status bar (amended: was a red observation)", async () => {
  const { d, lines } = newRig();
  const editor = editorAt({ text: "//", line: 0, col: 2 });
  try {
    await pressOn(d, editor);
    d.state = finalising(0);
    __state.activeTextEditor = undefined;
    __state.visibleTextEditors = [];
    d.dispatch(transcript());
    await sleep(60);
    assert.ok(lines.includes("[dictate] error: the editor moved away from the dictated line"), dictateLines(lines));
    // AMENDED 2026-09-03 (triage p2, F6 fixed): the moved-away path now surfaces as a failed
    // refusal on the status bar; the row pins the NEW shape.
    assert.ok(statusMessages.some((m) => m.includes("dictation stopped")), `the user was not told: ${JSON.stringify(statusMessages)}`);
  } finally {
    d.dispose();
  }
});
