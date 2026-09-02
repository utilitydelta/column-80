// Blind oracle for session-v67 phase 2: the dictation adapter inserts the
// dictated sentence into a comment and hands over to the tighten. Written
// against session-v67/contracts/phase2-adapter.md rules 1..14, on top of
// phase1-reducer.md (the actions the adapter executes). Nothing here reads
// src/**; the REAL Dictation is bundled against the shared activation stub the
// way review-v66-p12 does.
//
// HARNESS. `press()` needs the recogniser alive, and the recogniser is a child
// process the headless box cannot run. The rig hands the adapter a resident
// object that answers the documented `Recogniser` surface (`alive`, `dispose`,
// phase3-runtime.md) and stages the binaries the readiness checks stat:
// `column80-capture` is a script that sleeps, so a press arms and the take
// stays open until the row disposes the adapter. The status bar item is the
// one the stub hands back, captured by wrapping `window.createStatusBarItem`
// before construction; `failed` refusals surface through
// `window.setStatusBarMessage`, wrapped the same way.
//
// Run: SKIP_LIVE=1 node --test test/blind-v67-p2-adapter.test.cjs

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { bundleActivation } = require("./.activation-stub.cjs");

const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), "blind-v67-p2-"));
process.env.COLUMN80_NATIVE_DIR = SCRATCH;
process.env.COLUMN80_WHISPER_MODEL = path.join(SCRATCH, "base.en.bin");
process.env.COLUMN80_VAD_MODEL = path.join(SCRATCH, "vad.bin");
// The files the readiness checks stat. The capture binary is a script that
// holds the take open for a bounded time; `exec` so the kill reaches the sleep.
fs.writeFileSync(process.env.COLUMN80_WHISPER_MODEL, "");
fs.writeFileSync(process.env.COLUMN80_VAD_MODEL, "");
fs.writeFileSync(path.join(SCRATCH, "whisper-server"), "");
fs.writeFileSync(path.join(SCRATCH, "column80-capture"), "#!/bin/sh\nexec sleep 3\n");
fs.chmodSync(path.join(SCRATCH, "column80-capture"), 0o755);

const built = bundleActivation(
  "blind-v67-p2-adapter",
  `export { Dictation } from "../src/vscode/dictation";
export { commentScanStart } from "../src/vscode/completionProvider";
export { cursorInComment, commentSyntaxFor } from "../src/core/fimComment";
export { cleanTranscript } from "../src/core/dictation";
export { window } from "vscode";\n`,
);
const { Dictation, __state, Position, window, commentScanStart, cursorInComment, commentSyntaxFor, cleanTranscript } = built.mod;

test.after(() => {
  built.cleanup();
  fs.rmSync(SCRATCH, { recursive: true, force: true });
});

const ROOT = path.resolve(__dirname, "..");
const URI = "file:///w/v67/mod.ts";
const OTHER_URI = "file:///w/v67/other.ts";
const SPOKEN = "this is the sentence";
const SENTENCE = "This is the sentence.";
const TIGHTEN = "column80.tightenDocComment";
const HEARD_LINGER_MS = 2500;
const FORBIDDEN_COMMANDS = ["editor.action.inlineSuggest.trigger", "editor.action.inlineSuggest.commit", "column80.fimAccepted", "column80.dictationAccepted"];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- the status bar, captured at the factory

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

// ---- the rig

function channel() {
  const lines = [];
  return { lines, output: { appendLine: (l) => lines.push(String(l)), append: () => {} } };
}
const dictateLines = (lines) => lines.filter((l) => l.includes("[dictate]")).join("\n");

function newRig(wiring) {
  const { lines, output } = channel();
  __state.config = { "dictation.muteSpeakers": false, "dictation.partials": false };
  __state.executeCalls = [];
  __state.messages = [];
  __state.visibleTextEditors = [];
  __state.activeTextEditor = undefined;
  statusMessages.length = 0;
  const context = { extensionPath: SCRATCH, subscriptions: [], globalStorageUri: { fsPath: SCRATCH } };
  const spies = { armIntent: [], disarmIntent: [] };
  const d = new Dictation(
    context,
    output,
    wiring ?? { armIntent: (i) => spies.armIntent.push(i), disarmIntent: () => spies.disarmIntent.push(1) },
  );
  d.recogniser = { alive: true, dispose() {} };
  const item = statusItems[statusItems.length - 1];
  return { d, lines, item, spies };
}

/** A harness editor over `text`. `edit` records every builder call and the
 *  options, applies the insert to the text, and resolves `editResult` after
 *  `editDelayMs` (throws it when it is an Error). `trace` receives the order
 *  of the builder call and the resolve. */
function editorAt({ text, line, col, lang = "typescript", uri = URI, editResult = true, editDelayMs = 0, trace = [] }) {
  let current = text;
  const rows = () => current.split("\n");
  const offsetAt = (p) => {
    const r = rows();
    let o = 0;
    for (let i = 0; i < Math.min(p.line, r.length); i++) o += r[i].length + 1;
    return Math.min(o + p.character, current.length);
  };
  const positionAt = (off) => {
    const r = rows();
    let o = 0;
    for (let l = 0; l < r.length; l++) {
      if (off <= o + r[l].length) return new Position(l, off - o);
      o += r[l].length + 1;
    }
    return new Position(r.length - 1, r[r.length - 1].length);
  };
  const ed = {
    edits: [],
    trace,
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
      offsetAt,
      positionAt,
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
          rec.calls.push({ op: "insert", position: { line: p.line, character: p.character }, text: t });
          trace.push("insert");
          const r = rows();
          const l = r[p.line] ?? "";
          r[p.line] = l.slice(0, p.character) + t + l.slice(p.character);
          current = r.join("\n");
        },
        replace: (range, t) => rec.calls.push({ op: "replace", range, text: t }),
        delete: (range) => rec.calls.push({ op: "delete", range }),
      });
      if (editDelayMs) await sleep(editDelayMs);
      trace.push("edit-resolved");
      if (editResult instanceof Error) throw editResult;
      return editResult;
    },
  };
  return ed;
}

const site = (line, uri = URI) => ({ uri, line });
const finalising = (line, lang = "typescript", uri = URI) => ({ phase: "finalising", site: site(line, uri), languageId: lang, indentColumns: 0, commentSite: true });
const recording = (line, lang = "typescript") => ({ phase: "recording", site: site(line), languageId: lang, indentColumns: 0, pressedAt: Date.now(), commentSite: true });
const transcript = (text = SPOKEN) => ({ type: "transcript", text, decodeMs: 5 });
const tightenCalls = () => __state.executeCalls.filter((c) => c.id === TIGHTEN);
const pressLine = (lines) => lines.find((l) => l.startsWith("[dictate] press at "));
const insertedLine = (lines) => lines.find((l) => l.startsWith("[dictate] comment inserted at "));

/** Press on `editor` through the adapter's own `press()` (rule 1: the caret is
 *  read there), then hold the gesture in `finalising` on a comment site. */
async function pressThenFinalise(d, editor, lang = "typescript") {
  __state.activeTextEditor = editor;
  await d.press();
  assert.equal(d.phase, "arming", `CONTROL: the press armed: ${d.phase}`);
  const line = editor.selection.active.line;
  d.state = finalising(line, lang);
}

// ---------------------------------------------------------------------------
// Rules 1 and 2: site detection, per language, through press()
// ---------------------------------------------------------------------------

const C_LIKE = ["typescript", "rust", "go", "csharp"];
const SITES = [];
for (const lang of C_LIKE) {
  SITES.push(
    { name: `${lang} //|`, lang, text: "//", line: 0, col: 2, comment: true },
    { name: `${lang} // already|`, lang, text: "// already", line: 0, col: 10, comment: true },
    { name: `${lang} /* |`, lang, text: "/* ", line: 0, col: 3, comment: true },
    { name: `${lang} /** | */`, lang, text: "/**  */", line: 0, col: 4, comment: true },
    { name: `${lang} x = "// not";|`, lang, text: 'x = "// not";', line: 0, col: 13, comment: false },
    { name: `${lang} |// text`, lang, text: "// text", line: 0, col: 0, comment: false },
    { name: `${lang} code(); // |`, lang, text: "code(); // ", line: 0, col: 11, comment: true },
    { name: `${lang} line 1 inside a block: /*\\n|\\n*/`, lang, text: "/*\n\n*/", line: 1, col: 0, comment: true },
  );
}
for (const lang of ["rust", "csharp"]) {
  SITES.push({ name: `${lang} /// |`, lang, text: "/// ", line: 0, col: 4, comment: true });
}
SITES.push(
  { name: "rust // on line 1 in a body", lang: "rust", text: "fn main() {\n    // ", line: 1, col: 7, comment: true },
  { name: "python # |", lang: "python", text: "# ", line: 0, col: 2, comment: true },
  { name: "python #|", lang: "python", text: "#", line: 0, col: 1, comment: true },
  { name: 'python """| led by a def', lang: "python", text: 'def f():\n    """', line: 1, col: 7, comment: true },
  { name: 'python x = "# not"|', lang: "python", text: 'x = "# not"', line: 0, col: 11, comment: false },
  { name: "python |# text", lang: "python", text: "# text", line: 0, col: 0, comment: false },
  { name: "python code()  # |", lang: "python", text: "code()  # ", line: 0, col: 10, comment: true },
);

test("rules 1-2: the press line names the site kind for every shape in every served language", async (t) => {
  for (const row of SITES) {
    await t.test(row.name, async () => {
      const { d, lines } = newRig();
      try {
        __state.activeTextEditor = editorAt(row);
        await d.press();
        const expected = `[dictate] press at ${URI}:${row.line}${row.comment ? " (comment)" : ""}`;
        assert.equal(pressLine(lines), expected, dictateLines(lines));
        assert.equal(d.phase, "arming", `CONTROL: the press armed: ${dictateLines(lines)}`);
        assert.equal(d.state.commentSite, row.comment ? true : undefined, `state.commentSite: ${JSON.stringify(d.state)}`);
      } finally {
        d.dispose();
      }
    });
  }
});

test("rule 1: the adapter's verdict is cursorInComment over the prefix from commentScanStart, nothing else", (t) => {
  // The pure route the contract names, over the same table. A disagreement here
  // is the table being wrong about the scanner, and is flagged as such.
  for (const row of SITES) {
    t.test(row.name, () => {
      const editor = editorAt(row);
      const position = new Position(row.line, row.col);
      const start = commentScanStart(editor.document, position);
      const rows = row.text.split("\n");
      const offset = (p) => rows.slice(0, p.line).reduce((n, l) => n + l.length + 1, 0) + p.character;
      const prefix = row.text.slice(offset(start), offset(position));
      const syntax = commentSyntaxFor(row.lang);
      assert.ok(syntax, `CONTROL: ${row.lang} has a comment row`);
      assert.equal(cursorInComment(prefix, syntax).inComment, row.comment, `prefix=${JSON.stringify(prefix)}`);
    });
  }
});

// ---------------------------------------------------------------------------
// Rules 3 to 7: the insert
// ---------------------------------------------------------------------------

const INSERTS = [
  { name: "//| gets one leading space", lang: "typescript", text: "//", line: 0, col: 2, inserted: ` ${SENTENCE}` },
  { name: "// already| gets one leading space", lang: "typescript", text: "// already", line: 0, col: 10, inserted: ` ${SENTENCE}` },
  { name: "//  | after whitespace gets none", lang: "typescript", text: "//  ", line: 0, col: 4, inserted: SENTENCE },
  { name: "#| in python gets one", lang: "python", text: "#", line: 0, col: 1, inserted: ` ${SENTENCE}` },
  { name: "/* | after whitespace gets none", lang: "typescript", text: "/* ", line: 0, col: 3, inserted: SENTENCE },
  { name: "column 0 inside a block gets none", lang: "typescript", text: "/*\n\n*/", line: 1, col: 0, inserted: SENTENCE },
  { name: "rust // note| on line 1", lang: "rust", text: "fn main() {\n    // note", line: 1, col: 11, inserted: ` ${SENTENCE}` },
  { name: "go //|", lang: "go", text: "//", line: 0, col: 2, inserted: ` ${SENTENCE}` },
  { name: "csharp /// | after whitespace gets none", lang: "csharp", text: "/// ", line: 0, col: 4, inserted: SENTENCE },
];

test("rules 4-6: the sentence lands at the press caret with the right leading space, one edit, undo stops, caret after, channel line", async (t) => {
  assert.equal(cleanTranscript(SPOKEN).sentence, SENTENCE, "CONTROL: the cleaner's sentence");
  for (const row of INSERTS) {
    await t.test(row.name, async () => {
      const { d, lines } = newRig();
      const editor = editorAt(row);
      try {
        await pressThenFinalise(d, editor, row.lang);
        assert.equal(pressLine(lines), `[dictate] press at ${URI}:${row.line} (comment)`, `CONTROL: ${dictateLines(lines)}`);
        d.dispatch(transcript());
        await sleep(60);
        assert.equal(editor.edits.length, 1, `edit() calls: ${editor.edits.length}\n${dictateLines(lines)}`);
        const [edit] = editor.edits;
        assert.deepEqual(edit.calls, [{ op: "insert", position: { line: row.line, character: row.col }, text: row.inserted }]);
        assert.deepEqual(edit.opts, { undoStopBefore: true, undoStopAfter: true });
        const after = editor.selection.active ?? editor.selection;
        assert.equal(after.line, row.line, "selection line after the insert");
        assert.equal(after.character, row.col + row.inserted.length, "selection character after the insert");
        const expected = new RegExp(`^\\[dictate\\] comment inserted at ${URI.replace(/[.]/g, "\\.")}:${row.line}:${row.col} chars=${row.inserted.length} insert=\\d+ms$`);
        assert.match(insertedLine(lines) ?? "(no comment inserted line)", expected, dictateLines(lines));
        // Rule 10 as amended 2026-09-03: the reducer emits `indicator heard` and the
        // heard line BEFORE `insert-comment`, so the heard line precedes the insert's.
        const heardAt = lines.findIndex((l) => l.startsWith("[dictate] heard: "));
        const insertedAt = lines.indexOf(insertedLine(lines));
        assert.ok(heardAt >= 0 && heardAt < insertedAt, `heard line at ${heardAt}, comment inserted at ${insertedAt}:\n${dictateLines(lines)}`);
        assert.equal(d.phase, "idle");
      } finally {
        d.dispose();
      }
    });
  }
});

test("rule 1: the caret is read once, at the press; a caret that moved before the transcript does not move the insert", async () => {
  const { d, lines } = newRig();
  const editor = editorAt({ text: "// already", line: 0, col: 10 });
  try {
    await pressThenFinalise(d, editor);
    editor.selection = { active: new Position(0, 3) };
    d.dispatch(transcript());
    await sleep(60);
    assert.equal(editor.edits.length, 1, dictateLines(lines));
    assert.deepEqual(editor.edits[0].calls, [{ op: "insert", position: { line: 0, character: 10 }, text: ` ${SENTENCE}` }]);
  } finally {
    d.dispose();
  }
});

test("rule 4: a line shorter than the press column at insert time clamps to the current line end", async () => {
  const { d, lines } = newRig();
  const editor = editorAt({ text: "// already", line: 0, col: 10 });
  try {
    await pressThenFinalise(d, editor);
    editor.setText("//");
    d.dispatch(transcript());
    await sleep(60);
    assert.equal(editor.edits.length, 1, dictateLines(lines));
    assert.deepEqual(editor.edits[0].calls, [{ op: "insert", position: { line: 0, character: 2 }, text: ` ${SENTENCE}` }]);
    assert.match(insertedLine(lines) ?? "", new RegExp(`:0:2 chars=${SENTENCE.length + 1} insert=\\d+ms$`), dictateLines(lines));
  } finally {
    d.dispose();
  }
});

test("rule 3: the site's editor is the active one on its uri, else the visible one; another document is never edited", async () => {
  const { d, lines } = newRig();
  const active = editorAt({ text: "// elsewhere", line: 0, col: 12, uri: OTHER_URI });
  const visible = editorAt({ text: "//", line: 0, col: 2 });
  try {
    await pressThenFinalise(d, visible);
    __state.activeTextEditor = active;
    __state.visibleTextEditors = [active, visible];
    d.dispatch(transcript());
    await sleep(60);
    assert.equal(visible.edits.length, 1, `the visible editor on the site uri got ${visible.edits.length} edits:\n${dictateLines(lines)}`);
    assert.deepEqual(visible.edits[0].calls, [{ op: "insert", position: { line: 0, character: 2 }, text: ` ${SENTENCE}` }]);
    assert.equal(active.edits.length, 0, "the active editor on another uri was edited");
    assert.equal(tightenCalls().length, 1, "the tighten followed the insert on the visible editor");
  } finally {
    d.dispose();
  }
});

test("rule 3: with no editor on the site uri the adapter reports the editor moved away, and neither inserts nor tightens", async () => {
  const { d, lines } = newRig();
  const editor = editorAt({ text: "//", line: 0, col: 2 });
  const other = editorAt({ text: "// elsewhere", line: 0, col: 12, uri: OTHER_URI });
  try {
    await pressThenFinalise(d, editor);
    __state.activeTextEditor = other;
    __state.visibleTextEditors = [other];
    d.dispatch(transcript());
    await sleep(60);
    assert.ok(lines.includes("[dictate] error: the editor moved away from the dictated line"), dictateLines(lines));
    assert.equal(editor.edits.length + other.edits.length, 0, "an edit was made");
    assert.equal(tightenCalls().length, 0, "the tighten ran without an insert");
  } finally {
    d.dispose();
  }
});

test("rule 3: a site line past the document's end is reported gone, no insert, no tighten", async () => {
  const { d, lines } = newRig();
  const editor = editorAt({ text: "//\n// two", line: 1, col: 6 });
  try {
    await pressThenFinalise(d, editor);
    editor.setText("//");
    assert.equal(editor.document.lineCount, 1, "CONTROL: the document shrank to one line");
    d.dispatch(transcript());
    await sleep(60);
    assert.ok(lines.includes("[dictate] error: the dictated line is gone"), dictateLines(lines));
    assert.equal(editor.edits.length, 0, "an edit was made on a line that is gone");
    assert.equal(tightenCalls().length, 0);
  } finally {
    d.dispose();
  }
});

test("rule 7: an edit that resolves false logs the failure, refuses `failed` on the status bar, and does not tighten", async () => {
  const { d, lines } = newRig();
  const editor = editorAt({ text: "//", line: 0, col: 2, editResult: false });
  try {
    await pressThenFinalise(d, editor);
    d.dispatch(transcript());
    await sleep(60);
    const failed = lines.find((l) => l.startsWith("[dictate] comment insert failed: "));
    assert.ok(failed, dictateLines(lines));
    const reason = failed.slice("[dictate] comment insert failed: ".length);
    assert.ok(reason.length > 0, "the failure names a reason");
    assert.ok(
      statusMessages.some((m) => m === `Column 80: dictation stopped: ${reason}`),
      `status bar: ${JSON.stringify(statusMessages)}; channel: ${dictateLines(lines)}`,
    );
    assert.equal(tightenCalls().length, 0, "the tighten ran after a declined edit");
    assert.equal(insertedLine(lines), undefined, "a declined edit was logged as inserted");
  } finally {
    d.dispose();
  }
});

test("rule 7: an edit that rejects logs the rejection's message, refuses `failed`, and does not tighten", async () => {
  const { d, lines } = newRig();
  const editor = editorAt({ text: "//", line: 0, col: 2, editResult: new Error("the document is closed") });
  try {
    await pressThenFinalise(d, editor);
    d.dispatch(transcript());
    await sleep(60);
    const failed = lines.find((l) => l.startsWith("[dictate] comment insert failed: "));
    assert.ok(failed && failed.includes("the document is closed"), dictateLines(lines));
    assert.ok(statusMessages.some((m) => m.startsWith("Column 80: dictation stopped: ") && m.includes("the document is closed")), JSON.stringify(statusMessages));
    assert.equal(tightenCalls().length, 0);
    assert.equal(d.phase, "idle");
  } finally {
    d.dispose();
  }
});

// ---------------------------------------------------------------------------
// Rules 8 to 10: the hand-off
// ---------------------------------------------------------------------------

test("rules 8, 10: the tighten command runs once, with no arguments, after the insert's edit resolved, with its channel line already written", async () => {
  const { d, lines } = newRig();
  const trace = [];
  const editor = editorAt({ text: "//", line: 0, col: 2, editDelayMs: 40, trace });
  let lineAtInvocation;
  __state.commandHandlers[TIGHTEN] = () => {
    trace.push("tighten");
    lineAtInvocation = lines.includes("[dictate] tighten invoked");
    return Promise.resolve();
  };
  try {
    await pressThenFinalise(d, editor);
    d.dispatch(transcript());
    await sleep(120);
    assert.deepEqual(trace, ["insert", "edit-resolved", "tighten"], `${JSON.stringify(trace)}\n${dictateLines(lines)}`);
    const calls = tightenCalls();
    assert.equal(calls.length, 1, `tighten calls: ${calls.length}`);
    assert.deepEqual(calls[0].args, [], "the tighten takes no arguments");
    assert.equal(lineAtInvocation, true, "`[dictate] tighten invoked` was not on the channel when the command ran");
    assert.equal(d.phase, "idle");
  } finally {
    delete __state.commandHandlers[TIGHTEN];
    d.dispose();
  }
});

test("rule 8: a tighten that rejects is logged as `tighten failed: <reason>` and changes nothing else", async () => {
  const { d, lines } = newRig();
  const editor = editorAt({ text: "//", line: 0, col: 2 });
  __state.commandHandlers[TIGHTEN] = () => Promise.reject(new Error("no comment block at the cursor"));
  try {
    await pressThenFinalise(d, editor);
    d.dispatch(transcript());
    await sleep(80);
    assert.ok(lines.includes("[dictate] tighten failed: no comment block at the cursor"), dictateLines(lines));
    assert.equal(editor.edits.length, 1, "the sentence's edit is the only edit");
    assert.deepEqual(editor.edits[0].calls.map((c) => c.op), ["insert"], "the sentence was touched after the tighten failed");
    assert.equal(editor.document.getText(), `// ${SENTENCE}`, "the sentence stays");
    assert.equal(d.phase, "idle");
    assert.equal(statusMessages.length, 0, `a refusal was raised for a tighten failure: ${JSON.stringify(statusMessages)}`);
    assert.equal(tightenCalls().length, 1, "the tighten was retried");
  } finally {
    delete __state.commandHandlers[TIGHTEN];
    d.dispose();
  }
});

test("rule 9: across the comment-site gesture no FIM trigger, commit or accept command runs, and the intent wiring is never touched", async () => {
  const { d, lines, spies } = newRig();
  const editor = editorAt({ text: "//", line: 0, col: 2 });
  try {
    __state.activeTextEditor = editor;
    await d.press();
    assert.equal(d.phase, "arming", "CONTROL");
    d.dispatch({ type: "first-buffer", msSincePress: 40 });
    assert.equal(d.phase, "recording", `CONTROL: ${d.phase}`);
    d.state = finalising(0);
    d.dispatch(transcript());
    await sleep(80);
    assert.equal(d.phase, "idle");
    const forbidden = __state.executeCalls.filter((c) => FORBIDDEN_COMMANDS.includes(c.id)).map((c) => c.id);
    assert.deepEqual(forbidden, [], `forbidden commands ran: ${JSON.stringify(forbidden)}\n${dictateLines(lines)}`);
    assert.equal(spies.armIntent.length, 0, "wiring.armIntent was called");
    assert.equal(spies.disarmIntent.length, 0, "wiring.disarmIntent was called");
    assert.equal(editor.edits.length, 1, "CONTROL: the insert happened");
    assert.equal(tightenCalls().length, 1, "CONTROL: the tighten happened");
  } finally {
    d.dispose();
  }
});

// ---------------------------------------------------------------------------
// Rule 11: the status bar
// ---------------------------------------------------------------------------

// CONTRACT AMBIGUITY: rule 11 says the heard label "behaves as today", but today the
// label lingers and hides only on the accept path (a ghost was committed); an
// `indicator heard` that ends in idle, measured on the shipped adapter, stays up with
// no timer armed. So the row binds the sentence the rule actually states (hidden within
// 2500ms plus a margin, no further event), which is new behaviour for this path.
test("rule 11: after the hand-off the heard label shows and hides on its own within HEARD_LINGER_MS plus a margin", async () => {
  const { d, lines, item } = newRig();
  const editor = editorAt({ text: "//", line: 0, col: 2 });
  try {
    await pressThenFinalise(d, editor);
    // HARNESS: the shared stub has no DecorationRangeBehavior, so the heard indicator's
    // decoration throws on an ACTIVE editor and the action aborts there. The site editor
    // is left visible only (rule 3's fallback) so the status path runs to its end.
    __state.activeTextEditor = undefined;
    __state.visibleTextEditors = [editor];
    d.dispatch(transcript());
    await sleep(60);
    assert.equal(editor.edits.length, 1, `CONTROL: the insert happened on the visible editor\n${dictateLines(lines)}`);
    assert.ok(!lines.some((l) => l.startsWith("[dictate] action indicator failed")), `CONTROL: the indicator action ran to its end\n${dictateLines(lines)}`);
    assert.equal(item.text, "$(mic) heard", `status bar after the transcript: ${JSON.stringify(item.calls)}`);
    const shown = item.calls.length;
    await sleep(HEARD_LINGER_MS + 700);
    const hidden = item.calls.slice(shown).includes("hide") || !item.text.includes("heard");
    assert.ok(hidden, `the heard label is still up ${HEARD_LINGER_MS + 700}ms later: text=${JSON.stringify(item.text)} calls=${JSON.stringify(item.calls)}\n${dictateLines(lines)}`);
  } finally {
    d.dispose();
  }
});

// ---------------------------------------------------------------------------
// Rule 12: the refusal is retired from the shipped text
// ---------------------------------------------------------------------------

test("rule 12: the in-comment refusal sentence appears nowhere under src/", () => {
  const sentence = "the cursor is inside a comment; dictation writes code, not the spec";
  let hits = "";
  try {
    hits = execFileSync("grep", ["-rl", "--", sentence, path.join(ROOT, "src")], { encoding: "utf8" });
  } catch (e) {
    // grep exits 1 with no matches
    assert.equal(e.status, 1, e.stderr);
  }
  assert.equal(hits.trim(), "", `the retired sentence is still shipped in: ${hits}`);
});

test("rule 12: the adapter carries no `in-comment` refusal kind", () => {
  let hits = "";
  try {
    // The provider's FIM suppression kind of the same name is a different thing and stays.
    hits = execFileSync("grep", ["-n", "--", '"in-comment"', path.join(ROOT, "src", "vscode", "dictation.ts")], { encoding: "utf8" });
  } catch (e) {
    assert.equal(e.status, 1, e.stderr);
  }
  assert.equal(hits.trim(), "", `an in-comment branch survives in the adapter:\n${hits}`);
});

// ---------------------------------------------------------------------------
// Rule 13: Escape
// ---------------------------------------------------------------------------

const lastKey = (name) => {
  const values = __state.executeCalls.filter((c) => c.id === "setContext" && c.args[0] === name).map((c) => c.args[1]);
  return values[values.length - 1];
};

for (const phase of ["arming", "recording", "finalising"]) {
  test(`rule 13: Escape in ${phase} on a comment site goes idle with both keys down, no insert, no tighten; a late transcript is ignored`, async () => {
    const { d, lines } = newRig();
    const editor = editorAt({ text: "//", line: 0, col: 2 });
    try {
      __state.activeTextEditor = editor;
      await d.press();
      assert.equal(d.phase, "arming", "CONTROL");
      if (phase === "recording") d.state = recording(0);
      if (phase === "finalising") d.state = finalising(0);
      d.cancel();
      await sleep(60);
      assert.equal(d.phase, "idle", dictateLines(lines));
      assert.equal(lastKey("column80.recording"), false, `column80.recording after Escape: ${JSON.stringify(__state.executeCalls)}`);
      assert.equal(lastKey("column80.dictationGhost"), false, "column80.dictationGhost after Escape");
      assert.equal(editor.edits.length, 0, "Escape inserted");
      assert.equal(tightenCalls().length, 0, "Escape tightened");
      d.dispatch(transcript());
      await sleep(60);
      assert.ok(lines.includes("[dictate] ignored transcript in idle"), dictateLines(lines));
      assert.equal(editor.edits.length, 0, "a late transcript inserted");
      assert.equal(tightenCalls().length, 0, "a late transcript tightened");
      const forbidden = __state.executeCalls.filter((c) => FORBIDDEN_COMMANDS.includes(c.id)).map((c) => c.id);
      assert.deepEqual(forbidden, []);
    } finally {
      d.dispose();
    }
  });
}

// ---------------------------------------------------------------------------
// Rule 14: keystroke FIM stays dark after the insert
// ---------------------------------------------------------------------------

test("rule 14: with column80.enabled on, the insert asks for no inline suggestion", async () => {
  const { d, lines } = newRig();
  __state.config["column80.enabled"] = true;
  __state.config["column80.fim"] = true;
  const editor = editorAt({ text: "//", line: 0, col: 2 });
  try {
    await pressThenFinalise(d, editor);
    d.dispatch(transcript());
    await sleep(80);
    assert.equal(editor.edits.length, 1, `CONTROL: the insert happened\n${dictateLines(lines)}`);
    const triggers = __state.executeCalls.filter((c) => c.id === "editor.action.inlineSuggest.trigger");
    assert.equal(triggers.length, 0, `the insert triggered an inline suggestion ${triggers.length} time(s)`);
    assert.ok(!lines.some((l) => l.startsWith("[fim]")), `a [fim] line followed the insert:\n${lines.filter((l) => l.startsWith("[fim]")).join("\n")}`);
  } finally {
    d.dispose();
  }
});
