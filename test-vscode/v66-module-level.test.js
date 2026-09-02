// session-v66: the module-level dictated ghost, the landing watch, and Escape.
//
// The human dictated "A TypeScript class that contains an x, y, and z float." at the last line
// of a file, module level, and nothing landed: the served head opened no body, the ghost ended
// on an empty fresh line, and the editor never draws an item that ends on an empty line. The
// gesture then sat in `ghost` with a stale "heard:" label. Rows here: the editor rule itself
// with no product in the loop (A), the fixed shape landing at module level (B, C), Escape in
// the phases it now covers (D, E), a forced no-op commit ending the gesture (F), and the cap-cut
// head the human's first gesture served (G). Run: see v66modulelevel.vscode-test.mjs.
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
const note = (line) => fs.appendFileSync(path.join(SCRATCH, `v66-${LANG}.txt`), line + '\n');

// One module-level site per language: a finished function, then the blank last line.
const SITES = {
  ts: { file: 'src/v66_module.ts', doc: '/**', text: ['export function area(x: number): number {', '  return x;', '}', '', ''].join('\n') },
  rust: { file: 'src/v66_module.rs', doc: '///', text: ['pub fn area(x: f64) -> f64 {', '    x', '}', '', ''].join('\n') },
  python: { file: 'v66_module.py', doc: '"""', text: ['def area(x: float) -> float:', '    return x', '', '', ''].join('\n') },
  csharp: { file: 'V66Module.cs', doc: '///', text: ['namespace Scratch;', '', 'public static class Areas', '{', '    public static double Area(double x) => x;', '}', '', ''].join('\n') },
  go: { file: 'v66_module.go', doc: '//', text: ['package scratch', '', 'func Area(x float64) float64 {', '\treturn x', '}', '', ''].join('\n') },
};
const site = SITES[LANG];
const workspace = vscode.workspace.workspaceFolders[0].uri.fsPath;
const fixturePath = path.join(workspace, site.file);
const docLine = site.text.split('\n').length - 1;

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
const eolOf = (doc) => (doc.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n');
// The Go host's formatter appends a final newline after the accept (the fixture ends at the
// site); one trailing line break is the editor's, anything beyond it would be the item's.
const landedBody = (inserted, eol) => (inserted.endsWith(eol) ? inserted.slice(0, -eol.length) : inserted);

async function fresh() {
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  fs.writeFileSync(fixturePath, site.text);
  return openAt(docLine, 0);
}

/** Dictate `sentence` at the module-level site and wait for the gesture to END, one way or
 *  another. Returns what the channel said and what the buffer gained. */
async function dictate(sentence, endNeedles = ['[dictate] ghost accepted', '[dictate] nothing landed', '[dictate] no ghost for the intent', '[dictate] heard nothing', '[dictate] error', '[dictate] refused', '[dictate] site left']) {
  const { doc, editor } = await fresh();
  const before = doc.getText();
  say(sentence);
  const mark = logMark();
  await press();
  const live = await waitForLine(mark, ['[dictate] mic live', '[dictate] refused'], 10000);
  assert.strictEqual(live.hit, '[dictate] mic live', `mic live: ${live.text.slice(-400)}`);
  await sleep(1200);
  await press();
  const done = await waitForLine(mark, endNeedles, 60000);
  await sleep(400);
  const after = doc.getText();
  const inserted = after.slice(doc.offsetAt(new vscode.Position(docLine, 0)));
  return { doc, editor, before, after, inserted, done, channel: logSince(mark) };
}

suite('V66 module-level dictation, the landing watch, and Escape', function () {
  this.timeout(600000);

  suiteSetup(async () => {
    assert.ok(LOG_FILE, 'C80_LOG_FILE must be set by the config');
    const ext = vscode.extensions.getExtension(EXT_ID);
    assert.ok(ext, 'extension present');
    if (!ext.isActive) await ext.activate();
    await vscode.workspace.getConfiguration('editor').update('inlineSuggest.enabled', true, vscode.ConfigurationTarget.Global);
    await vscode.workspace.getConfiguration('column80').update('dictation.muteSpeakers', false, vscode.ConfigurationTarget.Global);
    await vscode.workspace.getConfiguration('column80').update('dictation.autoAccept', true, vscode.ConfigurationTarget.Global);
    // The human's setting: keystroke FIM off, the dictated request served anyway.
    await vscode.workspace.getConfiguration('column80').update('enabled', false, vscode.ConfigurationTarget.Global);
    const { hit, text } = await waitForLine(0, ['[dictate] recogniser started', '[dictate] recogniser failed'], 30000);
    assert.strictEqual(hit, '[dictate] recogniser started', `recogniser did not start: ${text.slice(-800)}`);
    note(`\n=== ${new Date().toISOString()} vscode ${vscode.version} lang ${LANG}`);
  });

  suiteTeardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    try { fs.unlinkSync(fixturePath); } catch {}
    try { fs.unlinkSync(TEXT_FILE + '.delay'); } catch {}
    await vscode.workspace.getConfiguration('column80').update('enabled', undefined, vscode.ConfigurationTarget.Global);
    await vscode.workspace.getConfiguration('column80').update('dictation.muteSpeakers', undefined, vscode.ConfigurationTarget.Global);
  });

  test('A: the editor rule, product out of the loop: an inline item that ends on an empty line is never drawn; the same item with any last-line character, a body, or no trailing break is', async () => {
    // The dogfood playgrounds pin column80.enabled at WORKSPACE scope, which outranks the
    // Global false above; without this the probe commits a product ghost and reads it as its
    // own shape (the rust label did, 2026-09-02).
    const settingsPath = path.join(workspace, '.vscode', 'settings.json');
    const settingsBefore = fs.existsSync(settingsPath) ? fs.readFileSync(settingsPath) : null;
    await vscode.workspace.getConfiguration('column80').update('enabled', false, vscode.ConfigurationTarget.Workspace);
    await sleep(300);
    const languageId = { ts: 'typescript', rust: 'rust', python: 'python', csharp: 'csharp', go: 'go' }[LANG];
    const shapes = [
      ['ends-on-empty-line', '/**\n * A class.\n */\nexport type Point = { x: number; y: number; z: number };\n', false],
      ['ends-with-a-space', '/**\n * A class.\n */\nexport type Point = { x: number; y: number; z: number };\n ', true],
      ['ends-with-a-closer', '/**\n * A fn.\n */\nexport function f(): number {\n  \n}', true],
      ['no-trailing-break', '/**\n * A class.\n */\nexport type Point = { x: number; y: number; z: number };', true],
    ];
    try {
      for (const [name, text, drawn] of shapes) {
        const { doc } = await fresh();
        let calls = 0;
        const disp = vscode.languages.registerInlineCompletionItemProvider({ language: languageId }, {
          provideInlineCompletionItems(d, p) { calls++; return [new vscode.InlineCompletionItem(text, new vscode.Range(p, p))]; },
        });
        const before = doc.getText();
        // Three attempts: a positive shape only has to land once; a shape that never draws
        // fails all three, which is what makes the negative row a claim rather than a race.
        let changed = false;
        for (let attempt = 0; attempt < 3 && !changed; attempt++) {
          await vscode.commands.executeCommand('editor.action.inlineSuggest.trigger');
          await sleep(900);
          await vscode.commands.executeCommand('editor.action.inlineSuggest.commit');
          await sleep(500);
          changed = doc.getText() !== before;
        }
        const mark = logMark();
        disp.dispose();
        note(`A ${name}: drawn+committed=${changed} providerCalls=${calls}`);
        assert.ok(!logSince(mark).includes('[fim] ttft='), 'the product served nothing during the probe');
        assert.strictEqual(changed, drawn, `${name}: the editor ${drawn ? 'should have' : 'should not have'} committed ${JSON.stringify(text)} (vscode ${vscode.version}). If this row flips, the editor changed its rule and the product's shape decision needs re-measuring.`);
      }
    } finally {
      await vscode.workspace.getConfiguration('column80').update('enabled', false, vscode.ConfigurationTarget.Global);
      await vscode.workspace.getConfiguration('column80').update('enabled', undefined, vscode.ConfigurationTarget.Workspace);
      await sleep(300);
      if (settingsBefore === null) {
        try { fs.unlinkSync(settingsPath); } catch {}
        try { fs.rmdirSync(path.dirname(settingsPath)); } catch {}
      } else {
        fs.writeFileSync(settingsPath, settingsBefore);
      }
    }
  });

  test('B: the human\'s sentence at module level lands: the doc comment and the head are in the file, the item did not end on an empty line, the gesture ended in an accept', async () => {
    const r = await dictate(LANG === 'ts' ? 'A TypeScript class that contains an x, y, and z float.' : 'A class that contains an x, y, and z float.');
    note(`B done=${r.done.hit}\n${r.inserted}\n---\n${r.channel}`);
    assert.strictEqual(r.done.hit, '[dictate] ghost accepted', `the gesture ended in an accept: ${r.channel.slice(-900)}`);
    assert.notStrictEqual(r.after, r.before, 'the buffer changed');
    assert.ok(r.inserted.includes(site.doc), `the doc comment is in the file: ${JSON.stringify(r.inserted)}`);
    assert.ok(/x, y, and z float/.test(r.inserted), `the sentence is in the file: ${JSON.stringify(r.inserted)}`);
    assert.ok(!r.channel.includes('nothing landed'), 'the landing watch stayed quiet');
    assert.ok(!landedBody(r.inserted, eolOf(r.doc)).endsWith(eolOf(r.doc)), `the landed text does not end on an empty line: ${JSON.stringify(r.inserted)}`);
    const cursor = r.editor.selection.active;
    assert.ok(cursor.line >= docLine, `the caret is in the landed text: ${cursor.line}`);
    assert.ok(r.doc.lineAt(cursor.line).text !== '' || cursor.line < r.doc.lineCount - 1 || r.inserted.trimEnd() === r.inserted, 'the caret is not left on a trailing empty line');
  });

  test('C: the declaration shapes the human asked for, enums, structs, records, aliases: each lands or is refused on the record, never stuck; what the model served is logged for the human', async () => {
    const sentences = [
      'An enumeration called Kind with the values small, medium and large.',
      'A record called Point holding x, y and z as floats.',
      'A type alias called Id for a string.',
      'An interface called Shape with an area method returning a float.',
    ];
    for (const sentence of sentences) {
      const r = await dictate(sentence);
      note(`C ${JSON.stringify(sentence)} done=${r.done.hit}\n${r.inserted}\n---\n${r.channel.split('\n').filter((l) => /ttft=|nothing landed|ghost accepted|no ghost/.test(l)).join('\n')}`);
      assert.ok(['[dictate] ghost accepted', '[dictate] no ghost for the intent'].includes(r.done.hit), `${sentence}: the gesture ended on the record, got ${r.done.hit}: ${r.channel.slice(-700)}`);
      if (r.done.hit === '[dictate] ghost accepted') {
        assert.ok(!landedBody(r.inserted, eolOf(r.doc)).endsWith(eolOf(r.doc)), `${sentence}: the landed text does not end on an empty line: ${JSON.stringify(r.inserted)}`);
        if (LANG === 'python' && !r.inserted.includes(site.doc)) {
          // S66-2, awaiting the human: Python's doc form is a docstring inside a body, so a
          // head that opens no body (`Id = str`) carries the sentence nowhere. Recorded, not
          // asserted, until the `#` comment above is ruled in or the loss is ruled accepted.
          note(`C ${JSON.stringify(sentence)}: SENTENCE LOST on a body-less python head (S66-2): ${JSON.stringify(r.inserted)}`);
        } else {
          assert.ok(r.inserted.includes(site.doc), `${sentence}: the doc comment landed: ${JSON.stringify(r.inserted)}`);
        }
      }
      // Whatever happened, the next press must open a take, not dismiss a phantom ghost.
      const mark = logMark();
      await press();
      const next = await waitForLine(mark, ['[dictate] press at'], 5000);
      assert.ok(next.hit && !next.text.includes('(re-record)'), `${sentence}: the gesture was idle afterwards: ${next.text.slice(-300)}`);
      await cancel();
      await waitForLine(mark, ['[dictate] cancelled by Escape'], 5000);
    }
  });

  test('D: Escape while the mic is open cancels: the take is aborted, nothing is requested, the buffer is untouched, and the next press opens a new take', async () => {
    const { doc } = await fresh();
    const before = doc.getText();
    say('A sentence that must never reach the model.');
    const mark = logMark();
    await press();
    const live = await waitForLine(mark, ['[dictate] mic live'], 10000);
    assert.ok(live.hit, `mic live: ${live.text.slice(-300)}`);
    await sleep(500);
    await cancel();
    const cancelled = await waitForLine(mark, ['[dictate] cancelled by Escape after'], 5000);
    assert.ok(cancelled.hit, `the cancel line: ${cancelled.text.slice(-400)}`);
    await sleep(800);
    const text = logSince(mark);
    assert.ok(!text.includes('[fim] invoked'), `no request left after the cancel: ${text.slice(-400)}`);
    assert.ok(!text.includes('[dictate] heard:'), `nothing was decoded after the cancel: ${text.slice(-400)}`);
    assert.strictEqual(doc.getText(), before, 'the buffer is untouched');
    const mark2 = logMark();
    await press();
    const next = await waitForLine(mark2, ['[dictate] press at', '[dictate] refused'], 5000);
    assert.strictEqual(next.hit, '[dictate] press at', `a fresh press after the cancel: ${next.text.slice(-300)}`);
    await cancel();
    await waitForLine(mark2, ['[dictate] cancelled by Escape'], 5000);
    note(`D ok`);
  });

  test('E: Escape while the take is decoding cancels, and the late transcript is ignored on the record', async () => {
    const { doc } = await fresh();
    const before = doc.getText();
    say('A sentence whose decode arrives after the cancel.');
    fs.writeFileSync(TEXT_FILE + '.delay', '2000');
    try {
      const mark = logMark();
      await press();
      const live = await waitForLine(mark, ['[dictate] mic live'], 10000);
      assert.ok(live.hit, `mic live: ${live.text.slice(-300)}`);
      await sleep(600);
      await press();
      const stopping = await waitForLine(mark, ['[dictate] stop after'], 5000);
      assert.ok(stopping.hit, `the take stopped: ${stopping.text.slice(-300)}`);
      await sleep(300);
      await cancel();
      const cancelled = await waitForLine(mark, ['[dictate] cancelled by Escape while decoding'], 5000);
      assert.ok(cancelled.hit, `the decode-phase cancel line: ${cancelled.text.slice(-500)}`);
      const late = await waitForLine(mark, ['[dictate] ignored transcript in idle', '[dictate] ignored stopped in idle'], 6000);
      assert.ok(late.hit, `the late answer was ignored on the record: ${late.text.slice(-500)}`);
      await sleep(500);
      const text = logSince(mark);
      assert.ok(!text.includes('[fim] invoked'), `no request after the cancel: ${text.slice(-400)}`);
      assert.strictEqual(doc.getText(), before, 'the buffer is untouched');
      note(`E ok`);
    } finally {
      try { fs.unlinkSync(TEXT_FILE + '.delay'); } catch {}
    }
  });

  test('F: a commit that lands nothing ends the gesture: the ghost is hidden under the auto-commit, the landing watch fires, the label clears, the next press is a fresh take', async () => {
    const { doc } = await fresh();
    const before = doc.getText();
    say('A TypeScript class that contains an x, y, and z float.');
    const mark = logMark();
    await press();
    await waitForLine(mark, ['[dictate] mic live'], 10000);
    await sleep(1200);
    await press();
    // Race the auto-commit: hide the drawn ghost the instant the provider serves it.
    const served = await waitForLine(mark, ['[dictate] ghost served', '[dictate] no ghost for the intent'], 60000);
    assert.strictEqual(served.hit, '[dictate] ghost served', `a ghost was served: ${served.text.slice(-400)}`);
    await vscode.commands.executeCommand('editor.action.inlineSuggest.hide');
    const ended = await waitForLine(mark, ['[dictate] nothing landed', '[dictate] ghost accepted'], 5000);
    note(`F ended=${ended.hit} changed=${doc.getText() !== before}\n---\n${logSince(mark).split('\n').filter((l) => /^\[dictate\]|^\[fim\] (ttft|invoked|no ghost)/.test(l)).join('\n')}`);
    if (ended.hit === '[dictate] ghost accepted') {
      // The hide lost the race to the commit; the row cannot force the no-op this time. Say so.
      note('F: the hide lost the race; the landing watch was not exercised in this run');
      return;
    }
    assert.strictEqual(ended.hit, '[dictate] nothing landed', `the landing watch ended the gesture: ${ended.text.slice(-500)}`);
    assert.strictEqual(doc.getText(), before, 'nothing landed in the buffer');
    const mark2 = logMark();
    await press();
    const next = await waitForLine(mark2, ['[dictate] press at'], 5000);
    assert.ok(next.hit && !next.text.includes('(re-record)'), `the gesture was idle after the no-op commit: ${next.text.slice(-300)}`);
    await cancel();
    await waitForLine(mark2, ['[dictate] cancelled by Escape'], 5000);
  });

  test('G: the cap-cut head (the human\'s first gesture): a long parameter list at module level ends on the record and leaves nothing stuck', async () => {
    const r = await dictate('A function called place that takes a name, an x, a y, a z, a width, a height, a depth, a colour, a label and a parent and returns nothing.');
    note(`G done=${r.done.hit}\n${r.inserted}\n---\n${r.channel}`);
    assert.ok(['[dictate] ghost accepted', '[dictate] no ghost for the intent'].includes(r.done.hit), `the gesture ended on the record: ${r.done.hit}: ${r.channel.slice(-900)}`);
    if (r.done.hit === '[dictate] ghost accepted') {
      assert.notStrictEqual(r.after, r.before, 'the accept changed the buffer');
      assert.ok(!landedBody(r.inserted, eolOf(r.doc)).endsWith(eolOf(r.doc)), `the landed text does not end on an empty line: ${JSON.stringify(r.inserted)}`);
    }
    const mark = logMark();
    await press();
    const next = await waitForLine(mark, ['[dictate] press at'], 5000);
    assert.ok(next.hit && !next.text.includes('(re-record)'), `idle afterwards: ${next.text.slice(-300)}`);
    await cancel();
    await waitForLine(mark, ['[dictate] cancelled by Escape'], 5000);
  });
});
