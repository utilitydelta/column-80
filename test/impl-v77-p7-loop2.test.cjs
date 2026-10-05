"use strict";

// session-v77 phase 7 loop 2: the prose site's edges after review-p7. The review's own red rows
// live in review-v77-p7-findings; these pin what those rows do not: the closing-marker half of
// the space rule, the comment site's rule left alone, the site line following edits above it,
// the caret left alone only when the user moved it, the empty-take sentence per site, and the
// read-only refusal at the press.
//
// Run: SKIP_LIVE=1 node --test test/impl-v77-p7-loop2.test.cjs

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { bundleActivation } = require("./.activation-stub.cjs");

const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), "impl-v77-p7-loop2-"));
process.env.COLUMN80_NATIVE_DIR = SCRATCH;
process.env.COLUMN80_WHISPER_MODEL = path.join(SCRATCH, "base.en.bin");
process.env.COLUMN80_VAD_MODEL = path.join(SCRATCH, "vad.bin");
fs.writeFileSync(process.env.COLUMN80_WHISPER_MODEL, "");
fs.writeFileSync(process.env.COLUMN80_VAD_MODEL, "");
fs.writeFileSync(path.join(SCRATCH, "whisper-server"), "");
fs.writeFileSync(path.join(SCRATCH, "column80-capture"), "#!/bin/sh\nexec sleep 3\n");
fs.chmodSync(path.join(SCRATCH, "column80-capture"), 0o755);

const built = bundleActivation(
  "impl-v77-p7-loop2",
  `export { Dictation, siteLineAfter } from "../src/vscode/dictation";
export { window, workspace } from "vscode";\n`,
);
test.after(() => {
  built.cleanup();
  fs.rmSync(SCRATCH, { recursive: true, force: true });
});
const { Dictation, siteLineAfter, __state, Position, Selection, window, workspace } = built.mod;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const status = [];
window.setStatusBarMessage = (m) => {
  status.push(String(m));
  return { dispose() {} };
};

function fakeRecogniser() {
  const calls = [];
  return {
    calls,
    alive: true,
    transcribe() {
      let resolve;
      const promise = new Promise((r) => {
        resolve = r;
      });
      calls.push({ resolve });
      return promise;
    },
    dispose() {},
  };
}

function newRig() {
  const lines = [];
  const output = { appendLine: (l) => lines.push(String(l)), append: () => {} };
  __state.config = { "dictation.muteSpeakers": false, "dictation.partials": false };
  __state.executeCalls = [];
  __state.visibleTextEditors = [];
  __state.activeTextEditor = undefined;
  status.length = 0;
  const context = { extensionPath: SCRATCH, subscriptions: [], globalStorageUri: { fsPath: SCRATCH } };
  const d = new Dictation(context, output, { armIntent: () => {}, disarmIntent: () => {} });
  const rec = fakeRecogniser();
  d.recogniser = rec;
  return { d, lines, rec };
}

function editorAt({ text, line, col, lang = "markdown", uri = "file:///w/notes.md", scheme = "file" }) {
  let current = text;
  const rows = () => current.split("\n");
  const offsetAt = (p) => {
    const r = rows();
    let o = 0;
    for (let i = 0; i < Math.min(p.line, r.length); i++) o += r[i].length + 1;
    return Math.min(o + p.character, current.length);
  };
  return {
    get text() {
      return current;
    },
    set text(t) {
      current = t;
    },
    document: {
      uri: { toString: () => uri, scheme },
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
    selection: new Selection(line, col, line, col),
    setDecorations() {},
    revealRange() {},
    async edit(cb) {
      cb({
        insert: (p, t) => {
          const r = rows();
          const l = r[p.line] ?? "";
          r[p.line] = l.slice(0, p.character) + t + l.slice(p.character);
          current = r.join("\n");
        },
        replace: () => {},
        delete: () => {},
      });
      return true;
    },
  };
}

async function pressToDecode(rig, editor) {
  __state.activeTextEditor = editor;
  __state.visibleTextEditors = [editor];
  await rig.d.press();
  assert.equal(rig.d.state.phase, "arming", `CONTROL: the press armed\n${rig.lines.join("\n")}`);
  rig.d.state = { ...rig.d.state, phase: "finalising" };
  rig.d.lastTake = { pcm: Buffer.alloc(3200), exitCode: 0 };
  rig.d.dispatch({ type: "stopped", pcmBytes: 3200 });
}

async function dictate(row, words = "then test") {
  const rig = newRig();
  try {
    const editor = editorAt(row);
    await pressToDecode(rig, editor);
    rig.rec.calls[0].resolve({ text: words, decodeMs: 5 });
    await sleep(20);
    return { editor, lines: rig.lines, status: [...status] };
  } finally {
    rig.d.dispose();
  }
}

test("prose space rule: a closing marker or a word gets a space, an opening run does not", async () => {
  const rows = [
    { name: "after closing bold", line: "**bold**", at: 8, want: "**bold** then test" },
    { name: "after a closing quote", line: 'said "yes"', at: 10, want: 'said "yes" then test' },
    { name: "after an apostrophe in a word", line: "dogs'", at: 5, want: "dogs' then test" },
    { name: "after a closing paren", line: "(see)", at: 5, want: "(see) then test" },
    { name: "link target paren after ]", line: "[x]()", at: 4, want: "[x](then test)" },
    { name: "an opening run after a space", line: "say **", at: 6, want: "say **then test" },
    { name: "bracket then a marker", line: "(*", at: 2, want: "(*then test" },
    { name: "an angle bracket", line: "<", at: 1, want: "<then test" },
    { name: "line start", line: "", at: 0, want: "then test" },
    { name: "after a full stop", line: "Done.", at: 5, want: "Done. then test" },
  ];
  for (const row of rows) {
    const { editor, lines } = await dictate({ text: row.line, line: 0, col: row.at });
    assert.equal(editor.text, row.want, `${row.name}\n${lines.join("\n")}`);
  }
});

test("comment site space rule is unchanged: an opener before the caret still gets a space", async () => {
  const { editor, lines } = await dictate({ text: "// see (", line: 0, col: 8, lang: "typescript", uri: "file:///w/a.ts" });
  assert.equal(editor.text, "// see ( Then test.", lines.join("\n"));
});

test("the site line follows edits above it during the take, and ignores edits below or elsewhere", async () => {
  const rows = [
    {
      name: "two lines deleted above",
      before: "a\nb\nc\nend",
      line: 3,
      after: "a\nend",
      changes: [{ range: { start: new Position(1, 0), end: new Position(3, 0) }, text: "" }],
      want: "a\nend then test",
    },
    {
      name: "an edit below the site",
      before: "top\nmid\n",
      line: 1,
      after: "top\nmid\nx\ny",
      changes: [{ range: { start: new Position(2, 0), end: new Position(2, 0) }, text: "x\ny" }],
      want: "top\nmid then test\nx\ny",
    },
  ];
  for (const row of rows) {
    const rig = newRig();
    try {
      const editor = editorAt({ text: row.before, line: row.line, col: row.before.split("\n")[row.line].length });
      await pressToDecode(rig, editor);
      editor.text = row.after;
      rig.d.onDocumentChanged({ document: editor.document, contentChanges: row.changes });
      rig.rec.calls[0].resolve({ text: "then test", decodeMs: 5 });
      await sleep(20);
      assert.equal(editor.text, row.want, `${row.name}\n${rig.lines.join("\n")}`);
    } finally {
      rig.d.dispose();
    }
  }
});

test("the site line ignores an edit in another document", async () => {
  const rig = newRig();
  try {
    const editor = editorAt({ text: "a\nb", line: 1, col: 1 });
    await pressToDecode(rig, editor);
    const other = { uri: { toString: () => "file:///w/other.md", scheme: "file" } };
    rig.d.onDocumentChanged({ document: other, contentChanges: [{ range: { start: new Position(0, 0), end: new Position(0, 0) }, text: "x\n" }] });
    rig.rec.calls[0].resolve({ text: "then test", decodeMs: 5 });
    await sleep(20);
    assert.equal(editor.text, "a\nb then test", rig.lines.join("\n"));
  } finally {
    rig.d.dispose();
  }
});

test("a prose insert moves a caret still at the press to the end of the words", async () => {
  const { editor } = await dictate({ text: "Ship it", line: 0, col: 7 });
  assert.deepEqual({ line: editor.selection.active.line, character: editor.selection.active.character }, { line: 0, character: 17 });
});

test("an empty take names the site: nothing written at prose and comment sites, generated at a code line", async () => {
  const rows = [
    { name: "prose", ed: { text: "", line: 0, col: 0 }, want: "Column 80: heard nothing, so nothing was written." },
    { name: "comment", ed: { text: "// ", line: 0, col: 3, lang: "typescript", uri: "file:///w/a.ts" }, want: "Column 80: heard nothing, so nothing was written." },
    { name: "code line", ed: { text: "", line: 0, col: 0, lang: "typescript", uri: "file:///w/a.ts" }, want: "Column 80: heard nothing, so nothing was generated." },
  ];
  for (const row of rows) {
    const { status: shown, lines } = await dictate(row.ed, "[BLANK_AUDIO]");
    assert.ok(shown.includes(row.want), `${row.name}: ${JSON.stringify(shown)}\n${lines.join("\n")}`);
  }
});

test("a read-only document refuses at the press, before anything records", async () => {
  const saved = workspace.fs.isWritableFileSystem;
  workspace.fs.isWritableFileSystem = (scheme) => scheme !== "git";
  const rig = newRig();
  try {
    const editor = editorAt({ text: "# Notes", line: 0, col: 7, uri: "git:///w/notes.md", scheme: "git" });
    __state.activeTextEditor = editor;
    __state.visibleTextEditors = [editor];
    await rig.d.press();
    assert.equal(rig.d.state.phase, "idle", rig.lines.join("\n"));
    assert.equal(rig.d.take, undefined, "a recorder started");
    assert.deepEqual(status, ["Column 80: this file is read-only, so dictation cannot write to it."]);

    // CONTROL: the same press on a writable scheme arms.
    const writable = editorAt({ text: "# Notes", line: 0, col: 7 });
    __state.activeTextEditor = writable;
    __state.visibleTextEditors = [writable];
    await rig.d.press();
    assert.equal(rig.d.state.phase, "arming", "CONTROL");
  } finally {
    rig.d.dispose();
    workspace.fs.isWritableFileSystem = saved;
  }
});

test("siteLineAfter: which changes move the site line, and by how much", () => {
  const ch = (sl, sc, el, ec, text) => ({ range: { start: { line: sl, character: sc }, end: { line: el, character: ec } }, text });
  const rows = [
    { name: "a line inserted above", line: 5, changes: [ch(0, 0, 0, 0, "x\n")], want: 6 },
    { name: "a newline typed mid-line above", line: 5, changes: [ch(2, 3, 2, 3, "\n")], want: 6 },
    { name: "a whole-line delete ending at the site", line: 5, changes: [ch(4, 0, 5, 0, "")], want: 4 },
    { name: "an insert ending in a newline at the site start", line: 5, changes: [ch(5, 0, 5, 0, "x\n")], want: 6 },
    { name: "a join that shifts the site's column is not followed", line: 5, changes: [ch(4, 2, 5, 0, "")], want: 5 },
    { name: "an edit on the site line", line: 5, changes: [ch(5, 1, 5, 1, "a\nb")], want: 5 },
    { name: "an edit below", line: 5, changes: [ch(6, 0, 6, 0, "x\n")], want: 5 },
    { name: "two changes above in one event", line: 5, changes: [ch(3, 0, 3, 0, "a\nb\n"), ch(0, 0, 2, 0, "")], want: 5 },
  ];
  for (const row of rows) {
    assert.equal(siteLineAfter(row.line, row.changes), row.want, row.name);
  }
});
