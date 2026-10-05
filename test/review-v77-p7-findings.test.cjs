"use strict";

// session-v77 phase 7 adversarial review: red rows for the prose dictation site (Amendment 4).
// Each test names its finding in session-v77/review-p7.md. Every row here was red against the
// phase 7 tree when written.
//
// Run: SKIP_LIVE=1 node --test test/review-v77-p7-findings.test.cjs

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { bundleActivation } = require("./.activation-stub.cjs");

const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), "review-v77-p7-"));
process.env.COLUMN80_NATIVE_DIR = SCRATCH;
process.env.COLUMN80_WHISPER_MODEL = path.join(SCRATCH, "base.en.bin");
process.env.COLUMN80_VAD_MODEL = path.join(SCRATCH, "vad.bin");
fs.writeFileSync(process.env.COLUMN80_WHISPER_MODEL, "");
fs.writeFileSync(process.env.COLUMN80_VAD_MODEL, "");
fs.writeFileSync(path.join(SCRATCH, "whisper-server"), "");
fs.writeFileSync(path.join(SCRATCH, "column80-capture"), "#!/bin/sh\nexec sleep 3\n");
fs.chmodSync(path.join(SCRATCH, "column80-capture"), 0o755);

const built = bundleActivation(
  "review-v77-p7-findings",
  `export { Dictation } from "../src/vscode/dictation";
export { window } from "vscode";\n`,
);
test.after(() => {
  built.cleanup();
  fs.rmSync(SCRATCH, { recursive: true, force: true });
});
const { Dictation, __state, Position, Selection, window } = built.mod;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

window.setStatusBarMessage = () => ({ dispose() {} });

function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** A recogniser whose every transcribe call parks until the test resolves it. */
function fakeRecogniser() {
  const calls = [];
  return {
    calls,
    alive: true,
    transcribe() {
      const d = deferred();
      calls.push(d);
      return d.promise;
    },
    dispose() {},
  };
}

function newRig() {
  const lines = [];
  const output = { appendLine: (l) => lines.push(String(l)), append: () => {} };
  __state.config = { "dictation.muteSpeakers": false, "dictation.partials": false };
  __state.executeCalls = [];
  __state.messages = [];
  __state.visibleTextEditors = [];
  __state.activeTextEditor = undefined;
  const context = { extensionPath: SCRATCH, subscriptions: [], globalStorageUri: { fsPath: SCRATCH } };
  const d = new Dictation(context, output, { armIntent: () => {}, disarmIntent: () => {} });
  const rec = fakeRecogniser();
  d.recogniser = rec;
  return { d, lines, rec };
}

/** A harness editor over `text` whose `edit` applies inserts, and whose text the test can
 *  change underneath the gesture the way a user or a formatter would. */
function editorAt({ text, line, col, lang = "markdown", uri = "file:///w/notes.md" }) {
  let current = text;
  const rows = () => current.split("\n");
  const offsetAt = (p) => {
    const r = rows();
    let o = 0;
    for (let i = 0; i < Math.min(p.line, r.length); i++) o += r[i].length + 1;
    return Math.min(o + p.character, current.length);
  };
  const ed = {
    get text() {
      return current;
    },
    set text(t) {
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
  return ed;
}

/** Press through the adapter's own `press()`, then walk the take to the recogniser the way a
 *  stop does: finalising, the stopped event, and the adapter's own transcribe action. */
async function pressToDecode(rig, editor) {
  __state.activeTextEditor = editor;
  __state.visibleTextEditors = [editor];
  await rig.d.press();
  assert.equal(rig.d.state.phase, "arming", `CONTROL: the press armed\n${rig.lines.join("\n")}`);
  assert.equal(rig.d.state.proseSite, true, "CONTROL: a prose site");
  rig.d.state = { ...rig.d.state, phase: "finalising" };
  rig.d.lastTake = { pcm: Buffer.alloc(3200), exitCode: 0 };
  rig.d.dispatch({ type: "stopped", pcmBytes: 3200 });
}

// ---------------------------------------------------------------------------
// F1 (MED). The space rule was written for `//|`. In markdown the character before the caret
// is often an opening marker, and a space after it breaks the construct: `** text**` is not
// bold in CommonMark, `[ text](u)` and `( text)` read as typos, `` ` text` `` changes a code
// span. Typing at those carets inserts no space; dictation should not either.
// ---------------------------------------------------------------------------

test("F1: no separating space after an opening markdown marker", async () => {
  const rows = [
    { name: "between bold markers", line: "****", at: 2, want: "**then test**" },
    { name: "inside link text", line: "[](u)", at: 1, want: "[then test](u)" },
    { name: "inside parens", line: "()", at: 1, want: "(then test)" },
    { name: "inside a code span", line: "``", at: 1, want: "`then test`" },
    { name: "inside quotes", line: '""', at: 1, want: '"then test"' },
    { name: "between italic markers", line: "__", at: 1, want: "_then test_" },
    // Controls: the rule's real job, a space after a word and after a list or heading marker.
    { name: "CONTROL after a word", line: "Ship it", at: 7, want: "Ship it then test" },
    { name: "CONTROL bullet with no space", line: "-", at: 1, want: "- then test" },
    { name: "CONTROL heading with no space", line: "#", at: 1, want: "# then test" },
  ];
  for (const row of rows) {
    const rig = newRig();
    try {
      const editor = editorAt({ text: row.line, line: 0, col: row.at });
      await pressToDecode(rig, editor);
      rig.rec.calls[0].resolve({ text: "then test", decodeMs: 5 });
      await sleep(20);
      assert.equal(editor.text, row.want, `${row.name}\n${rig.lines.join("\n")}`);
    } finally {
      rig.d.dispose();
    }
  }
});

// ---------------------------------------------------------------------------
// F2 (MED). Escape while decoding, then a new press: the cancelled take's decode is still in
// flight, and nothing ties its answer to the take that asked. When it returns while the new
// take is decoding, the reducer is in `finalising` and inserts the CANCELLED words; the words
// of the take the user kept are then ignored in idle. The manual says Escape while the take is
// decoding drops the answer.
// ---------------------------------------------------------------------------

test("F2: a cancelled take's late transcript does not land in the file", async () => {
  const rig = newRig();
  try {
    const editor = editorAt({ text: "# Notes\n\n", line: 2, col: 0 });
    await pressToDecode(rig, editor);
    assert.equal(rig.rec.calls.length, 1, "CONTROL: the first take is decoding");
    rig.d.cancel();
    assert.equal(rig.d.state.phase, "idle", "CONTROL: Escape ended the first take");

    await pressToDecode(rig, editor);
    assert.equal(rig.rec.calls.length, 2, "CONTROL: the second take is decoding");

    rig.rec.calls[0].resolve({ text: "the words I cancelled", decodeMs: 5 });
    await sleep(20);
    rig.rec.calls[1].resolve({ text: "the words I kept", decodeMs: 5 });
    await sleep(20);

    assert.ok(!editor.text.includes("cancelled"), `cancelled words landed: ${JSON.stringify(editor.text)}\n${rig.lines.join("\n")}`);
    assert.ok(editor.text.includes("the words I kept"), `kept words lost: ${JSON.stringify(editor.text)}`);
  } finally {
    rig.d.dispose();
  }
});

// ---------------------------------------------------------------------------
// F3 (LOW). The site is `{uri, line}` captured at the press and never moved while the take
// records or decodes (`onDocumentChanged` only listens in requesting and ghost). A line added
// above the site in that window (a paste, a formatter, another press of Enter higher up) shifts
// the text, and the words land on whatever line now has the old number.
// ---------------------------------------------------------------------------

test("F3: a line added above the site during the decode does not move the insert", async () => {
  const rig = newRig();
  try {
    const editor = editorAt({ text: "# Notes\nfirst para\n", line: 2, col: 0 });
    await pressToDecode(rig, editor);
    editor.text = "> quote\n# Notes\nfirst para\n";
    rig.d.onDocumentChanged({
      document: editor.document,
      contentChanges: [{ range: { start: new Position(0, 0), end: new Position(0, 0) }, text: "> quote\n" }],
    });
    rig.rec.calls[0].resolve({ text: "then test", decodeMs: 5 });
    await sleep(20);
    assert.equal(editor.text, "> quote\n# Notes\nfirst para\nthen test", rig.lines.join("\n"));
  } finally {
    rig.d.dispose();
  }
});

// ---------------------------------------------------------------------------
// F4 (LOW). After a prose insert the adapter sets the selection to the end of the inserted
// text unconditionally. At a comment site that is load-bearing (the tighten reads the caret).
// At a prose site nothing follows the insert, so a user who moved the caret while the take
// decoded and kept typing elsewhere is yanked back to the press site mid-word.
// ---------------------------------------------------------------------------

test("F4: a prose insert leaves a caret the user moved during the decode where it is", async () => {
  const rig = newRig();
  try {
    const editor = editorAt({ text: "# Notes\nfirst para\n", line: 2, col: 0 });
    await pressToDecode(rig, editor);
    editor.selection = new Selection(1, 5, 1, 5);
    rig.rec.calls[0].resolve({ text: "then test", decodeMs: 5 });
    await sleep(20);
    assert.equal(editor.text, "# Notes\nfirst para\nthen test", "CONTROL: the words landed at the press site");
    assert.deepEqual(
      { line: editor.selection.active.line, character: editor.selection.active.character },
      { line: 1, character: 5 },
      "the caret was moved back to the press site",
    );
  } finally {
    rig.d.dispose();
  }
});
