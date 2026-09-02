// session-v67: dictating INTO a comment. Blind rows, written from
// session-v67/contracts/phase3-host.md without reading src/.
//
// The human's words: put a `//` (or `#`), or the caret inside a comment, then the chord; the
// sentence lands in the comment, no FIM request follows, and Tighten Doc Comment opens after.
// Rows: opener then chord (A), caret inside an existing comment (B), Escape while recording on
// a comment site (C), and `|// text`, which is NOT a comment site (D). Every row writes what it
// saw to `${C80_SCRATCH}/v67-<lang>.txt`; the tighten's outcome after the hand-off is recorded,
// never asserted. Run: see v67commentdictation.vscode-test.mjs, one label at a time.
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vscode = require('vscode');

const EXT_ID = 'utilitydelta.column-80';
const LANG = process.env.C80_LANG || 'ts';
const LOG_FILE = process.env.C80_LOG_FILE;
const TEXT_FILE = process.env.C80_FAKE_TEXT_FILE;
const SCRATCH = process.env.C80_SCRATCH;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const logMark = () => { try { return fs.statSync(LOG_FILE).size; } catch { return 0; } };
const logSince = (mark) => { try { return fs.readFileSync(LOG_FILE).subarray(mark).toString('utf8'); } catch { return ''; } };
async function waitForLine(mark, needles, ms = 30000) {
  const list = Array.isArray(needles) ? needles : [needles];
  const deadline = Date.now() + ms;
  for (;;) {
    const text = logSince(mark);
    const hit = list.find((n) => text.includes(n));
    if (hit !== undefined) return { text, hit };
    if (Date.now() > deadline) return { text, hit: undefined };
    await sleep(100);
  }
}
const note = (line) => fs.appendFileSync(path.join(SCRATCH, `v67-${LANG}.txt`), line + '\n');

// The fake says the human's kind of sentence: lower case, no full stop. The product cleans it:
// first letter capitalised, full stop appended. The leading space is the insert's, because the
// character before the caret (`/`, `#`, or a word) is not whitespace in every row here.
const SAID = 'this returns the area of the shape scaled by the factor';
const SENTENCE = 'This returns the area of the shape scaled by the factor.';
const INSERT = ' ' + SENTENCE;

// Per language: the file, the opener, and the four fixture texts with the press position in
// each. `press` is [line, character]; lines and characters are 0-based, as the channel's are.
const j = (lines) => lines.join('\n');
const SITES = {
  ts: {
    file: 'src/v67_comment.ts', opener: '//',
    fn: ['export function area(x: number): number {', '  return x;', '}'],
    existing: { text: j(['/** Existing words */', 'export function area(x: number): number {', '  return x;', '}', '']), press: [0, '/** Existing words'.length] },
  },
  rust: {
    file: 'src/v67_comment.rs', opener: '//',
    fn: ['pub fn area(x: f64) -> f64 {', '    x', '}'],
    existing: { text: j(['/* Existing words */', 'pub fn area(x: f64) -> f64 {', '    x', '}', '']), press: [0, '/* Existing words'.length] },
  },
  python: {
    file: 'v67_comment.py', opener: '#',
    fn: ['def area(x: float) -> float:', '    return x'],
    existing: { text: j(['# existing words', 'def area(x: float) -> float:', '    return x', '']), press: [0, '# existing words'.length] },
  },
  csharp: {
    file: 'V67Comment.cs', opener: '//',
    fn: ['namespace Scratch;', '', 'public static class Areas', '{', '    public static double Area(double x) => x;', '}'],
    existing: { text: j(['namespace Scratch;', '', '/** Existing words */', 'public static class Areas', '{', '    public static double Area(double x) => x;', '}', '']), press: [2, '/** Existing words'.length] },
  },
  go: {
    file: 'v67_comment.go', opener: '//',
    fn: ['package scratch', '', 'func Area(x float64) float64 {', '\treturn x', '}'],
    existing: { text: j(['package scratch', '', '/** Existing words */', 'func Area(x float64) float64 {', '\treturn x', '}', '']), press: [2, '/** Existing words'.length] },
  },
};
const site = SITES[LANG];
// A: a finished function, a blank line, then the opener as the LAST line with no newline after
// it; the caret sits after the opener. D: the same shape with `text` after the opener and the
// caret at column 0.
const openerText = j([...site.fn, '', site.opener]);
const openerLine = site.fn.length + 1;
const openerPress = [openerLine, site.opener.length];
const notSiteText = j([...site.fn, '', `${site.opener} text`]);
const notSitePress = [openerLine, 0];

const workspace = vscode.workspace.workspaceFolders[0].uri.fsPath;
const fixturePath = path.join(workspace, site.file);

async function openAt(line, character) {
  const doc = await vscode.workspace.openTextDocument(fixturePath);
  let editor;
  for (let attempt = 0; attempt < 5; attempt++) {
    editor = await vscode.window.showTextDocument(doc, { preview: false });
    await sleep(300);
    if (vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.uri.toString() === doc.uri.toString()) break;
  }
  assert.ok(vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.uri.toString() === doc.uri.toString(), 'the fixture editor is active');
  editor.selection = new vscode.Selection(line, character, line, character);
  await sleep(200);
  return { doc, editor };
}
const press = () => vscode.commands.executeCommand('column80.dictate');
const cancel = () => vscode.commands.executeCommand('column80.cancelDictation');
const say = (sentence) => fs.writeFileSync(TEXT_FILE, sentence);

/** Write `text` as the fixture, open it, and put the caret at `[line, character]`. The tighten
 *  may have left a quick pick up from the previous row; close it before the editors. */
async function fresh(text, [line, character]) {
  await vscode.commands.executeCommand('workbench.action.closeQuickOpen');
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  fs.writeFileSync(fixturePath, text);
  return openAt(line, character);
}

const PRESS_RE = /^\[dictate\] press at (.+):(\d+)(.*)$/m;
const INSERTED_RE = /^\[dictate\] comment inserted at (.+):(\d+):(\d+) chars=(\d+)/m;
const onlyDictate = (text) => text.split('\n').filter((l) => /^\[dictate\]|^\[tighten\]|^\[fim\]/.test(l)).join('\n');

/** Press, wait for the mic, hold 1200ms, press again, and wait for the hand-off. Reads the
 *  buffer the instant `tighten invoked` lands. AMENDED 2026-09-03 (tier run 1): the tighten
 *  writes its lines in the same tick as `tighten invoked` (it refuses at once with no model),
 *  so a `[tighten]` line is already there when the row polls; the read is not "before the
 *  tighten's line", it is "at the hand-off". On this tier the tighten never applies, and its
 *  outcome is recorded, not asserted. Then waits up to 30s for the `[tighten]` line. */
async function dictateIntoComment(text, pressAt) {
  const { doc, editor } = await fresh(text, pressAt);
  const before = doc.getText();
  say(SAID);
  const mark = logMark();
  await press();
  const live = await waitForLine(mark, ['[dictate] mic live', '[dictate] refused', '[dictate] error'], 10000);
  assert.strictEqual(live.hit, '[dictate] mic live', `mic live: ${live.text.slice(-400)}`);
  await sleep(1200);
  await press();
  const handoff = await waitForLine(mark, ['[dictate] tighten invoked', '[dictate] refused', '[dictate] error', '[dictate] comment insert failed'], 60000);
  const after = doc.getText();
  const atHandoff = logSince(mark);
  // CONTRACT AMBIGUITY: the contract names the tighten's channel prefix as `[tighten]` and
  // nothing else; if the command writes under another prefix this wait times out and the row
  // goes red on the hand-off's echo, not on the insert. The needle is the contract's.
  const tighten = await waitForLine(mark, ['[tighten]'], 30000);
  const firstTighten = (tighten.text.match(/^\[tighten\].*$/m) || ['(no [tighten] line within 30s)'])[0];
  return { doc, editor, before, after, handoff, atHandoff, tighten, firstTighten, mark };
}

/** The contract's channel order, and the no-`[fim]` window between the insert and the
 *  tighten's line. Shared by A and B; the failure message names the row. */
function assertChannel(row, r, pressAt) {
  const [line, col] = pressAt;
  const text = r.tighten.text;
  const pressLine = text.match(PRESS_RE);
  assert.ok(pressLine, `${row}: a press line: ${onlyDictate(text).slice(-600)}`);
  assert.strictEqual(Number(pressLine[2]), line, `${row}: the press line is the caret's line: ${pressLine[0]}`);
  assert.ok(pressLine[3].includes('(comment)'), `${row}: the press names a comment site: ${pressLine[0]}`);
  assert.ok(pressLine[1].includes(path.basename(site.file)), `${row}: the press names the fixture: ${pressLine[0]}`);
  const inserted = text.match(INSERTED_RE);
  assert.ok(inserted, `${row}: a comment inserted line: ${onlyDictate(text).slice(-600)}`);
  assert.strictEqual(Number(inserted[2]), line, `${row}: the insert is on the press line: ${inserted[0]}`);
  assert.strictEqual(Number(inserted[3]), col, `${row}: the insert is at the press character: ${inserted[0]}`);
  assert.strictEqual(Number(inserted[4]), INSERT.length, `${row}: chars counts the leading space and the sentence: ${inserted[0]}`);
  const order = ['[dictate] press at', '[dictate] mic live', '[dictate] heard:', '[dictate] comment inserted at', '[dictate] tighten invoked'];
  const at = order.map((n) => text.indexOf(n));
  order.forEach((n, i) => assert.ok(at[i] >= 0, `${row}: the channel carries ${JSON.stringify(n)}: ${onlyDictate(text).slice(-800)}`));
  for (let i = 1; i < at.length; i++) assert.ok(at[i] > at[i - 1], `${row}: ${JSON.stringify(order[i - 1])} comes before ${JSON.stringify(order[i])}: ${onlyDictate(text)}`);
  assert.ok(r.tighten.hit, `${row}: a [tighten] line within 30s of the hand-off: ${onlyDictate(text).slice(-800)}`);
  const tightenAt = text.indexOf('[tighten]');
  assert.ok(tightenAt > at[at.length - 1], `${row}: the [tighten] line follows tighten invoked: ${onlyDictate(text)}`);
  // AMENDED 2026-09-03 (tier run 1): the "no [tighten] line at the buffer read" check is gone;
  // the tighten's lines land synchronously with `tighten invoked`, so it could never hold.
  // AMENDED 2026-09-03 (review p2 host): the no-[fim] window used to end at that same first
  // [tighten] line, so it closed in the tick the insert landed and could not catch a keystroke
  // request 50ms later. It now ends at the `ignored cancel in idle` line assertIdle produces.
}

async function assertIdle(row, r) {
  const mark = logMark();
  await cancel();
  const idle = await waitForLine(mark, ['[dictate] ignored cancel in idle', '[dictate] cancelled by Escape'], 5000);
  assert.strictEqual(idle.hit, '[dictate] ignored cancel in idle', `${row}: the gesture is idle after the hand-off: ${idle.text.slice(-400)}`);
  const text = logSince(r.mark);
  const from = text.indexOf('[dictate] comment inserted at');
  const to = text.indexOf('[dictate] ignored cancel in idle');
  assert.ok(from >= 0 && to > from, `${row}: the insert and the idle line bound the window: ${onlyDictate(text).slice(-600)}`);
  const between = text.slice(from, to);
  assert.ok(!between.includes('[fim]'), `${row}: no [fim] line from the insert to idle (column80.enabled is on): ${between}`);
}

suite('V67 dictating into a comment: the insert, the hand-off, Escape, and the not-a-site line', function () {
  this.timeout(600000);

  suiteSetup(async () => {
    assert.ok(LOG_FILE, 'C80_LOG_FILE must be set by the config');
    const ext = vscode.extensions.getExtension(EXT_ID);
    assert.ok(ext, 'extension present');
    if (!ext.isActive) await ext.activate();
    await vscode.workspace.getConfiguration('editor').update('inlineSuggest.enabled', true, vscode.ConfigurationTarget.Global);
    await vscode.workspace.getConfiguration('column80').update('dictation.muteSpeakers', false, vscode.ConfigurationTarget.Global);
    await vscode.workspace.getConfiguration('column80').update('dictation.autoAccept', true, vscode.ConfigurationTarget.Global);
    // Goal ruling 6: keystroke FIM ON, and still no [fim] request follows the insert.
    await vscode.workspace.getConfiguration('column80').update('enabled', true, vscode.ConfigurationTarget.Global);
    const { hit, text } = await waitForLine(0, ['[dictate] recogniser started', '[dictate] recogniser failed'], 30000);
    assert.strictEqual(hit, '[dictate] recogniser started', `recogniser did not start: ${text.slice(-800)}`);
    note(`\n=== ${new Date().toISOString()} vscode ${vscode.version} lang ${LANG}`);
  });

  suiteTeardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeQuickOpen');
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    try { fs.unlinkSync(fixturePath); } catch {}
    try { fs.unlinkSync(TEXT_FILE + '.delay'); } catch {}
    await vscode.workspace.getConfiguration('column80').update('enabled', undefined, vscode.ConfigurationTarget.Global);
    await vscode.workspace.getConfiguration('column80').update('dictation.autoAccept', undefined, vscode.ConfigurationTarget.Global);
    await vscode.workspace.getConfiguration('column80').update('dictation.muteSpeakers', undefined, vscode.ConfigurationTarget.Global);
  });

  test('A: opener then chord: the sentence lands after the opener on the press line, no newline, nothing below, the channel hands over to the tighten, no [fim] follows, and the gesture is idle', async () => {
    const r = await dictateIntoComment(openerText, openerPress);
    note(`A handoff=${r.handoff.hit} tighten=${r.tighten.hit}\nfirst [tighten] line: ${r.firstTighten}\n${r.after.slice(r.doc.offsetAt(new vscode.Position(openerLine, 0)))}\n---\n${onlyDictate(r.tighten.text)}`);
    assert.strictEqual(r.handoff.hit, '[dictate] tighten invoked', `the gesture handed over: ${onlyDictate(r.handoff.text).slice(-800)}`);
    // The opener is the last line, so the whole diff is the press line's tail: everything
    // before the opener is byte-identical, and the file ends where the sentence ends.
    const head = r.before.slice(0, r.before.length - site.opener.length);
    assert.strictEqual(r.after, head + site.opener + INSERT, `the buffer is the fixture plus ${JSON.stringify(INSERT)} on the press line and nothing else: ${JSON.stringify(r.after.slice(head.length))}`);
    assert.strictEqual(r.doc.lineCount, openerLine + 1, 'no line was appended');
    assert.strictEqual(r.doc.lineAt(openerLine).text, `${site.opener} ${SENTENCE}`, 'the press line');
    assertChannel('A', r, openerPress);
    await assertIdle('A', r);
  });

  test('B: caret inside an existing comment: the sentence lands at the caret with one leading space, nothing else moves, same channel order', async () => {
    const { text, press: pressAt } = site.existing;
    const r = await dictateIntoComment(text, pressAt);
    note(`B handoff=${r.handoff.hit} tighten=${r.tighten.hit}\nfirst [tighten] line: ${r.firstTighten}\n${r.doc.lineAt(pressAt[0]).text}\n---\n${onlyDictate(r.tighten.text)}`);
    assert.strictEqual(r.handoff.hit, '[dictate] tighten invoked', `the gesture handed over: ${onlyDictate(r.handoff.text).slice(-800)}`);
    const off = r.doc.offsetAt(new vscode.Position(pressAt[0], pressAt[1]));
    assert.strictEqual(r.after, r.before.slice(0, off) + INSERT + r.before.slice(off), `the buffer is the fixture with ${JSON.stringify(INSERT)} spliced at the caret and nothing else: ${JSON.stringify(r.doc.lineAt(pressAt[0]).text)}`);
    assert.strictEqual(r.doc.lineCount, r.before.split('\n').length, 'no line was appended');
    assertChannel('B', r, pressAt);
    await assertIdle('B', r);
  });

  test('C: Escape while recording on a comment site: the take is aborted, nothing is inserted, no tighten, the gesture is idle', async () => {
    const { doc } = await fresh(openerText, openerPress);
    const before = doc.getText();
    say(SAID);
    const mark = logMark();
    await press();
    const live = await waitForLine(mark, ['[dictate] mic live', '[dictate] refused'], 10000);
    assert.strictEqual(live.hit, '[dictate] mic live', `mic live: ${live.text.slice(-300)}`);
    await sleep(300);
    await cancel();
    const cancelled = await waitForLine(mark, ['[dictate] cancelled by Escape'], 5000);
    assert.ok(cancelled.hit, `the cancel line: ${cancelled.text.slice(-400)}`);
    await sleep(800);
    const text = logSince(mark);
    note(`C\n${onlyDictate(text)}`);
    assert.strictEqual(doc.getText(), before, 'the buffer is untouched');
    assert.ok(!text.includes('[dictate] comment inserted'), `nothing was inserted: ${onlyDictate(text)}`);
    assert.ok(!text.includes('[dictate] tighten invoked'), `the tighten was not invoked: ${onlyDictate(text)}`);
    assert.ok(!text.includes('[fim] invoked'), `no request after the cancel: ${onlyDictate(text)}`);
    // The recording context is not readable through the API; a second cancel landing in idle
    // is the contract's witness that it came down.
    const mark2 = logMark();
    await cancel();
    const idle = await waitForLine(mark2, ['[dictate] ignored cancel in idle', '[dictate] cancelled by Escape'], 5000);
    assert.strictEqual(idle.hit, '[dictate] ignored cancel in idle', `the second cancel finds idle: ${idle.text.slice(-300)}`);
    assert.strictEqual(doc.getText(), before, 'the buffer is still untouched');
  });

  test('D: `|// text` with the caret at column 0 is NOT a comment site: the press line carries no (comment)', async () => {
    const { doc } = await fresh(notSiteText, notSitePress);
    const before = doc.getText();
    const mark = logMark();
    await press();
    // CONTRACT AMBIGUITY: the contract asserts a `press at` line with no `(comment)` and says
    // nothing about the line gesture refusing `|// text` for a reason of its own (text after
    // the caret, say). If it refuses before writing `press at`, this row goes red on the
    // missing press line; the contract says the line is written.
    const pressed = await waitForLine(mark, ['[dictate] press at', '[dictate] refused'], 5000);
    const text = logSince(mark);
    note(`D\n${onlyDictate(text)}`);
    assert.strictEqual(pressed.hit, '[dictate] press at', `the press was written: ${onlyDictate(text)}`);
    const pressLine = text.match(PRESS_RE);
    assert.ok(pressLine, `a press line: ${onlyDictate(text)}`);
    assert.strictEqual(Number(pressLine[2]), notSitePress[0], `the press line is the caret's line: ${pressLine[0]}`);
    assert.ok(!pressLine[3].includes('(comment)'), `the caret before the opener is not a comment site: ${pressLine[0]}`);
    await cancel();
    // AMENDED 2026-09-03 (review p2 host): suffix absence alone does not prove the line gesture
    // ran; the arming-phase cancel line is the positive witness (the row cancels straight
    // after the press, before the mic opens).
    const ended = await waitForLine(mark, ['[dictate] cancelled by Escape before the mic opened', '[dictate] cancelled by Escape', '[dictate] ignored cancel in idle'], 5000);
    assert.strictEqual(ended.hit, '[dictate] cancelled by Escape before the mic opened', `the line gesture was arming and the cancel ended it: ${onlyDictate(logSince(mark))}`);
    await sleep(300);
    assert.strictEqual(doc.getText(), before, 'the buffer is untouched');
  });
});
