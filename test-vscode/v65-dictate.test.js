// session-v65: dictate-then-FIM, end to end in the real extension host.
//
// The journey (session-v65/journeys/dictate-then-fim.md), proven: press, the mic goes live,
// the fixture "says" its sentence, press again, the heard sentence rides into ONE FIM request
// as a virtual comment, a ghost is served, Tab accepts it, and the buffer after minus the
// buffer before is the accepted ghost plus the fresh line the accept lands on. The comment
// never enters the file. The microphone is a fixture; the recogniser, the FIM model, the
// provider and the editor are real.
//
// Run: see v65dictate.vscode-test.mjs.
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vscode = require('vscode');

const EXT_ID = 'utilitydelta.column-80';
const LANG = process.env.C80_LANG || 'rust';
const LOG_FILE = process.env.C80_LOG_FILE;
const FIXTURES = path.join(__dirname, '..', 'test', 'fixtures', 'dictation');
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
    await sleep(150);
  }
}

// One fixture per language: a small function with an empty line where the next statement
// goes. The dictated sentence is "Add the threat level column to the select list too." (the
// fixture WAV), so the site is a select-list builder in every language.
const SITES = {
  rust: {
    file: 'src/v65_dictate.rs',
    text: [
      'pub struct Query {',
      '    pub columns: Vec<String>,',
      '}',
      '',
      'impl Query {',
      '    pub fn select_list(&self) -> Vec<String> {',
      '        let mut columns = self.columns.clone();',
      '        columns.push("severity".to_string());',
      '        ',
      '        columns',
      '    }',
      '}',
      '',
    ].join('\n'),
    line: 8,
    indent: '        ',
    comment: '//',
  },
  ts: {
    file: 'src/v65_dictate.ts',
    text: [
      'export class Query {',
      '  constructor(public columns: string[]) {}',
      '',
      '  selectList(): string[] {',
      '    const columns = [...this.columns];',
      '    columns.push("severity");',
      '    ',
      '    return columns;',
      '  }',
      '}',
      '',
    ].join('\n'),
    line: 6,
    indent: '    ',
    comment: '//',
  },
  python: {
    file: 'v65_dictate.py',
    text: [
      'class Query:',
      '    def __init__(self, columns: list[str]) -> None:',
      '        self.columns = columns',
      '',
      '    def select_list(self) -> list[str]:',
      '        columns = list(self.columns)',
      '        columns.append("severity")',
      '        ',
      '        return columns',
      '',
    ].join('\n'),
    line: 7,
    indent: '        ',
    comment: '#',
  },
  csharp: {
    file: 'V65Dictate.cs',
    text: [
      'using System.Collections.Generic;',
      '',
      'public class Query',
      '{',
      '    public List<string> Columns { get; } = new();',
      '',
      '    public List<string> SelectList()',
      '    {',
      '        var columns = new List<string>(Columns);',
      '        columns.Add("severity");',
      '        ',
      '        return columns;',
      '    }',
      '}',
      '',
    ].join('\n'),
    line: 10,
    indent: '        ',
    comment: '//',
  },
  go: {
    file: 'v65_dictate.go',
    text: [
      'package playground',
      '',
      'type Query struct {',
      '\tColumns []string',
      '}',
      '',
      'func (q *Query) SelectList() []string {',
      '\tcolumns := append([]string{}, q.Columns...)',
      '\tcolumns = append(columns, "severity")',
      '\t',
      '\treturn columns',
      '}',
      '',
    ].join('\n'),
    line: 9,
    indent: '\t',
    comment: '//',
  },
};

const site = SITES[LANG];
const workspace = vscode.workspace.workspaceFolders[0].uri.fsPath;
const fixturePath = path.join(workspace, site.file);

// A frame of the host window, because the one thing the buffer diff cannot say is whether the
// ghost was VISIBLE (the human's first real gesture served a ghost that Tab did not accept).
function shot(name) {
  const { spawnSync } = require('child_process');
  const display = process.env.DISPLAY || ':9';
  const file = path.join(process.env.C80_SCRATCH, `${name}.png`);
  const env = { ...process.env, DISPLAY: display };
  const tree = spawnSync('xwininfo', ['-root', '-tree'], { env }).stdout.toString();
  const line = tree.split('\n').find((l) => /Extension Development Host/.test(l)) || '';
  const id = (line.match(/0x[0-9a-f]+/) || [null])[0];
  if (!id) return { file, status: 'no window' };
  const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'x11grab', '-window_id', id, '-i', display, '-frames:v', '1', file], { env });
  return { file, status: r.status };
}

async function openAt(line, character) {
  const doc = await vscode.workspace.openTextDocument(fixturePath);
  let editor;
  // A language extension's own welcome or notification can take focus on first open (the Go
  // host did, once); the gesture needs OUR editor active, so this insists.
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

async function press() {
  await vscode.commands.executeCommand('column80.dictate');
}

suite('V65 dictate then FIM', function () {
  this.timeout(600000);

  suiteSetup(async () => {
    assert.ok(LOG_FILE, 'C80_LOG_FILE must be set by the config');
    const ext = vscode.extensions.getExtension(EXT_ID);
    assert.ok(ext, 'extension present');
    if (!ext.isActive) await ext.activate();
    fs.writeFileSync(fixturePath, site.text);
    await vscode.workspace.getConfiguration('editor').update('inlineSuggest.enabled', true, vscode.ConfigurationTarget.Global);
    await vscode.workspace.getConfiguration('column80').update('dictation.muteSpeakers', false, vscode.ConfigurationTarget.Global);
    // The recogniser starts at activation; give it its first second.
    const { hit } = await waitForLine(0, ['[dictate] recogniser started', '[dictate] recogniser failed'], 30000);
    assert.strictEqual(hit, '[dictate] recogniser started', `recogniser did not start: ${logSince(0).slice(-800)}`);
  });

  setup(async () => {
    // Every row starts from the pristine fixture: an earlier accept leaves its line in the
    // file and the next request then dedupes against it.
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    fs.writeFileSync(fixturePath, site.text);
    await vscode.workspace.getConfiguration('column80').update('dictation.autoAccept', true, vscode.ConfigurationTarget.Global);
  });

  suiteTeardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    try { fs.unlinkSync(fixturePath); } catch {}
    await vscode.workspace.getConfiguration('column80').update('dictation.muteSpeakers', undefined, vscode.ConfigurationTarget.Global);
  });

  test('the journey: press, speak, press, ghost, Tab; the buffer gains the ghost and the newline and nothing else', async () => {
    process.env.C80_FAKE_WAV = path.join(FIXTURES, 'threat-level-3s.wav');
    const { doc, editor } = await openAt(site.line, site.indent.length);
    const before = doc.getText();
    // The human's shape, part one: a PLAIN FIM ghost is already drawn at the site when the
    // shortcut is pressed. The explicit trigger preserves a drawn item, so without a hide
    // the gesture would commit this one instead of its own serve.
    const drawnMark = logMark();
    await vscode.commands.executeCommand('editor.action.inlineSuggest.trigger');
    const drawn = await waitForLine(drawnMark, ['[fim] ttft='], 20000);
    const plainGhost = (drawn.text.match(/ghost="((?:[^"\\]|\\.)*)"/) || [])[1];
    const mark = logMark();

    await press();
    const live = await waitForLine(mark, ['[dictate] mic live', '[dictate] refused', '[dictate] capture failed'], 10000);
    assert.strictEqual(live.hit, '[dictate] mic live', `mic did not go live: ${live.text}`);
    // The human's shape: while the take runs, the Output panel is open, FOCUSED, and being
    // written to. Its editor's selection changes on every line and must not read as the
    // site being left, and the trigger must still reach the dictated editor.
    const panel = vscode.window.createOutputChannel('V65 panel');
    panel.show(false);
    const chatter = setInterval(() => panel.appendLine(`chatter ${Date.now()}`), 150);
    // The fixture is 3.0s of speech; the fake streams it in real time, then silence.
    await sleep(3600);
    await press();
    const served = await waitForLine(mark, ['[dictate] ghost served', '[dictate] no ghost for the intent', '[dictate] heard nothing', '[dictate] error', '[dictate] capture failed'], 60000);
    assert.strictEqual(served.hit, '[dictate] ghost served', `no ghost: ${served.text}`);
    const text = served.text;
    assert.match(text, /\[dictate\] heard: .*threat level.*\./i, 'the heard sentence names the threat level');
    assert.match(text, /\[fim\] intent injected lines=\d+/, 'the intent rode the FIM request');
    assert.match(text, /\[dictate\] timings press-to-first-buffer=\d+ms take=[\d.]+s decode=\d+ms fim=\d+ms mic-close-to-ghost=\d+ms/, 'the timings line');
    // Auto-accept: the gesture commits the ghost itself; nothing else touches the document.
    const accepted = await waitForLine(mark, ['[dictate] ghost accepted', '[dictate] auto-commit failed', '[dictate] site left'], 5000);
    clearInterval(chatter);
    panel.dispose();
    assert.strictEqual(accepted.hit, '[dictate] ghost accepted', `the gesture committed its ghost: ${accepted.text.slice(-500)}`);
    await sleep(300);
    fs.appendFileSync(path.join(process.env.C80_SCRATCH, `journey-${LANG}.txt`), `shot: ${JSON.stringify(shot(`ghost-${LANG}`))}\n`);
    const after = doc.getText();
    assert.notStrictEqual(after, before, 'the accept changed the buffer');
    // Buffer after minus buffer before is one insertion at the site.
    const prefix = before.slice(0, doc.offsetAt(new vscode.Position(site.line, site.indent.length)));
    assert.ok(after.startsWith(prefix), 'the text before the site is untouched');
    const suffixBefore = before.slice(prefix.length);
    assert.ok(after.endsWith(suffixBefore), 'the text after the site is untouched');
    const inserted = after.slice(prefix.length, after.length - suffixBefore.length);
    assert.ok(inserted.length > 0, 'something was inserted');
    // The committed text is the DICTATED serve (the ttft line after `intent injected`), not the
    // plain ghost that was drawn before the press.
    const dictatedGhost = (text.slice(text.indexOf('[fim] intent injected')).match(/ghost="((?:[^"\\]|\\.)*)"/) || [])[1];
    assert.ok(dictatedGhost, `the dictated serve has a ghost line: ${text.slice(-400)}`);
    const unescape = (g) => JSON.parse(`"${g}"`);
    assert.ok(inserted.startsWith(unescape(dictatedGhost)), `the gesture committed its own serve ${JSON.stringify(dictatedGhost)}, got ${JSON.stringify(inserted)} (plain ghost drawn before the press: ${JSON.stringify(plainGhost)})`);
    const eol = doc.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
    // The Go host trims the fresh line's tab after the accept (measured 2026-09-02); the line
    // break itself is the ruled part, the indent is what the editor lets stand.
    assert.ok(inserted.endsWith(eol + site.indent) || inserted.endsWith(eol), `the accepted ghost ends with a fresh line: ${JSON.stringify(inserted)}`);
    if (!inserted.endsWith(eol + site.indent)) fs.appendFileSync(path.join(process.env.C80_SCRATCH, `journey-${LANG}.txt`), `NOTE: the host trimmed the fresh line's indent\n`);
    assert.ok(!inserted.includes(`${site.comment} Add the threat`), `the comment never enters the file: ${JSON.stringify(inserted)}`);
    assert.ok(!after.includes('threat level column to the select list'), 'the heard sentence is not in the buffer');
    const cursor = editor.selection.active;
    assert.strictEqual(cursor.line, site.line + inserted.split(eol).length - 1, 'the cursor is on the fresh line');
    assert.ok(cursor.character === site.indent.length || cursor.character === 0, `the cursor sits at the block's indent (or column 0 where the host trimmed it): ${cursor.character}`);
    fs.appendFileSync(path.join(process.env.C80_SCRATCH, `journey-${LANG}.txt`), `${LANG}\n${inserted}\n---\n${text}\n`);
  });

  test('the human\'s shape: cursor at column 0 of an EMPTY line inside the block; the ghost carries the block indent', async () => {
    await vscode.workspace.getConfiguration('column80').update('dictation.autoAccept', false, vscode.ConfigurationTarget.Global);
    process.env.C80_FAKE_WAV = path.join(FIXTURES, 'threat-level-3s.wav');
    const { doc, editor } = await openAt(site.line, 0);
    // The line is made truly empty (no indent at all), the way the human's file was.
    await editor.edit((b) => b.delete(doc.lineAt(site.line).range));
    editor.selection = new vscode.Selection(site.line, 0, site.line, 0);
    await sleep(200);
    const before = doc.getText();
    const mark = logMark();
    await press();
    const live = await waitForLine(mark, ['[dictate] mic live'], 10000);
    assert.ok(live.hit, `mic live: ${live.text}`);
    await sleep(3600);
    await press();
    const served = await waitForLine(mark, ['[dictate] ghost served', '[dictate] no ghost for the intent', '[dictate] heard nothing', '[dictate] error'], 60000);
    assert.strictEqual(served.hit, '[dictate] ghost served', `no ghost: ${served.text}`);
    assert.match(served.text, /\[dictate\] virtual indent of \d+ for the request/, 'the request carried the block indent virtually');
    await sleep(400);
    const shotInfo = shot(`ghost-col0-${LANG}`);
    fs.appendFileSync(path.join(process.env.C80_SCRATCH, `journey-${LANG}.txt`), `col0 shot: ${JSON.stringify(shotInfo)}\n`);
    // Tab as the human presses it, when a key injector exists; the commit command otherwise.
    const { spawnSync } = require('child_process');
    const xdo = spawnSync('which', ['xdotool']).status === 0;
    fs.appendFileSync(path.join(process.env.C80_SCRATCH, `journey-${LANG}.txt`), `col0 active editor at commit: ${vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.uri.toString()}\n`);
    if (xdo) {
      spawnSync('xdotool', ['key', 'Tab'], { env: { ...process.env, DISPLAY: process.env.DISPLAY || ':9' } });
    } else {
      await vscode.commands.executeCommand('editor.action.inlineSuggest.commit');
    }
    await sleep(800);
    const after = doc.getText();
    fs.appendFileSync(path.join(process.env.C80_SCRATCH, `journey-${LANG}.txt`), `col0 via ${xdo ? 'xdotool Tab' : 'commit'}: changed=${after !== before} inserted=${JSON.stringify(after.slice(0, after.length - (before.length - doc.offsetAt(new vscode.Position(site.line, 0)))).slice(doc.offsetAt(new vscode.Position(site.line, 0))))}\n${logSince(mark)}\n`);
    assert.notStrictEqual(after, before, 'Tab accepted the ghost at column 0');
    const landed = doc.lineAt(site.line).text;
    assert.ok(landed.startsWith(site.indent) && landed.trim() !== '', `the landed line carries the block indent: ${JSON.stringify(landed)}`);
    assert.strictEqual(editor.selection.active.line, site.line + 1, 'the cursor is on the fresh line');
    // The Go host trims the fresh line's tab after the accept (as in the journey row); the
    // line break is the ruled part, the indent is what the editor lets stand.
    assert.ok(editor.selection.active.character === site.indent.length || editor.selection.active.character === 0, `the fresh line carries the block indent (or the host trimmed it): ${editor.selection.active.character}`);
    await vscode.commands.executeCommand('undo');
  });

  test('keystroke FIM off, dictation on: the dictated request is served and the follow-up keystroke request is refused', async () => {
    // Workspace scope: the dogfood repos pin column80.enabled in their own settings.json. The
    // write reformats (or creates) that file, so its exact bytes are put back afterwards.
    const settingsPath = path.join(workspace, '.vscode', 'settings.json');
    const settingsBefore = fs.existsSync(settingsPath) ? fs.readFileSync(settingsPath) : null;
    await vscode.workspace.getConfiguration('column80').update('enabled', false, vscode.ConfigurationTarget.Workspace);
    try {
      process.env.C80_FAKE_WAV = path.join(FIXTURES, 'threat-level-3s.wav');
      const { doc } = await openAt(site.line, site.indent.length);
      const before = doc.getText();
      const mark = logMark();
      await press();
      const live = await waitForLine(mark, ['[dictate] mic live', '[dictate] refused'], 10000);
      assert.strictEqual(live.hit, '[dictate] mic live', `mic live with FIM off: ${live.text}`);
      await sleep(3600);
      await press();
      const served = await waitForLine(mark, ['[dictate] ghost accepted', '[dictate] no ghost for the intent', '[dictate] heard nothing', '[dictate] error'], 60000);
      assert.strictEqual(served.hit, '[dictate] ghost accepted', `dictated ghost with FIM off: ${served.text.slice(-600)}`);
      assert.notStrictEqual(doc.getText(), before, 'the dictated ghost landed');
      const followUp = await waitForLine(mark, ['[fim] no ghost: column80.fim is disabled'], 5000);
      assert.ok(followUp.hit, `the keystroke request on the fresh line is refused: ${followUp.text.slice(-300)}`);
    } finally {
      await vscode.workspace.getConfiguration('column80').update('enabled', true, vscode.ConfigurationTarget.Workspace);
      await sleep(300);
      if (settingsBefore === null) {
        try { fs.unlinkSync(settingsPath); } catch {}
        try { fs.rmdirSync(path.dirname(settingsPath)); } catch {}
      } else {
        fs.writeFileSync(settingsPath, settingsBefore);
      }
    }
  });

  test('the second press before the mic is live cancels, on the record', async () => {
    process.env.C80_FAKE_MIC_DELAY_MS = '1500';
    try {
      await openAt(site.line, site.indent.length);
      const mark = logMark();
      await press();
      await sleep(100);
      await press();
      const { hit } = await waitForLine(mark, ['[dictate] cancelled before the mic opened'], 5000);
      assert.ok(hit, `cancel line: ${logSince(mark)}`);
      await sleep(1800);
      assert.ok(!logSince(mark).includes('[dictate] mic live'), 'a cancelled take never goes live');
    } finally {
      delete process.env.C80_FAKE_MIC_DELAY_MS;
    }
  });

  test('a silent take is refused as heard nothing, and nothing is generated', async () => {
    const silent = path.join(os.tmpdir(), 'c80-v65-silence.wav');
    const pcm = Buffer.alloc(16000 * 2 * 2);
    const hdr = Buffer.alloc(44);
    hdr.write('RIFF', 0); hdr.writeUInt32LE(36 + pcm.length, 4); hdr.write('WAVE', 8); hdr.write('fmt ', 12);
    hdr.writeUInt32LE(16, 16); hdr.writeUInt16LE(1, 20); hdr.writeUInt16LE(1, 22); hdr.writeUInt32LE(16000, 24);
    hdr.writeUInt32LE(32000, 28); hdr.writeUInt16LE(2, 32); hdr.writeUInt16LE(16, 34); hdr.write('data', 36); hdr.writeUInt32LE(pcm.length, 40);
    fs.writeFileSync(silent, Buffer.concat([hdr, pcm]));
    process.env.C80_FAKE_WAV = silent;
    const { doc } = await openAt(site.line, site.indent.length);
    const before = doc.getText();
    const mark = logMark();
    await press();
    const live = await waitForLine(mark, ['[dictate] mic live'], 10000);
    assert.ok(live.hit, `mic live: ${live.text}`);
    await sleep(2300);
    await press();
    const { hit, text } = await waitForLine(mark, ['[dictate] heard nothing', '[dictate] ghost served', '[dictate] error'], 30000);
    assert.strictEqual(hit, '[dictate] heard nothing', `silence: ${text}`);
    assert.ok(!text.includes('[fim] intent injected'), 'no FIM request for silence');
    assert.strictEqual(doc.getText(), before, 'nothing wrote to the document');
  });

  test('inside a comment the press is refused before the mic opens', async () => {
    process.env.C80_FAKE_WAV = path.join(FIXTURES, 'threat-level-3s.wav');
    const { doc } = await openAt(site.line, site.indent.length);
    await vscode.window.activeTextEditor.edit((b) => b.insert(new vscode.Position(site.line, site.indent.length), `${site.comment} note `));
    const editor = vscode.window.activeTextEditor;
    const end = doc.lineAt(site.line).range.end;
    editor.selection = new vscode.Selection(end, end);
    await sleep(200);
    const mark = logMark();
    await press();
    const { hit, text } = await waitForLine(mark, ['[dictate] refused: in-comment', '[dictate] mic live'], 5000);
    assert.strictEqual(hit, '[dictate] refused: in-comment', `refusal: ${text}`);
    await vscode.commands.executeCommand('undo');
  });
});
