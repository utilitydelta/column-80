// session-v33 in a REAL extension host: a context block is a LIVE range over a
// LIVE document, and the model gets what the lines say NOW.
//
// The human's own words are the spec, and row 1 is that sentence turned into a
// drive:
//
//   > it needs to be live - text changes, blocks expanding (eg. add an if {}
//   > block and then add implementation inside that block, at model gen time
//   > the context injected contains the implementation!)
//
// Everything else this session built is graded headless against fakes. This
// file is the only place where the real panel gesture, the real change events,
// the real language server and the real prompt assembly meet, so it is the only
// evidence that the product does the thing that was asked for.
//
// Six rows, in the order they matter:
//
//   1  THE HUMAN'S CASE. Add a block over a function, type an `if` block into
//      it, fill the body, generate, and assert the ASSEMBLED PROMPT carries the
//      implementation that was typed AFTER the block was added.
//   2  The block GROWS. N lines typed inside it leave the entry's range N lines
//      longer, start line untouched.
//   3  Close and reopen is RE-ADOPTED, not lost. Also a measurement: v33 scout
//      finding 7 saw a document survive a close of every editor with its
//      version intact, so the lapse path may never fire here at all.
//   4  A boundary-crossing edit LOSES the block, and the generation proceeds
//      WITHOUT it rather than refusing. Drop-not-refuse is the human's ruling.
//   5  A RENAME carries the block's uri.
//   6  A DIRTY BUFFER counts. Type without saving, generate, assert the prompt
//      carries text that is not on disk. No headless test can see this.
//
// THE INSTRUMENTS, and why they are the ones used.
//
// A test cannot read the extension host's output channel, and it cannot read a
// TreeView's rendered rows. It CAN read the channel teed to `C80_LOG_FILE`
// (extension.ts:24), so every assertion here rides the product's own evidence
// lines:
//
//   `[fngen] prompt-begin bytes=N` … `[fngen] prompt-end`   the whole assembled
//        prompt, verbatim, under `column80.logPrompts`. Written BEFORE the model
//        call (fnGenService.ts:262), which is what lets these rows grade prompt
//        assembly on a machine with no model running.
//   `[ctx] add id=… range=L…-L…`                            the entry as added.
//   `[ctx] reanchor id=… L…-L… -> L…-L…`                    the entry's range
//        after an event. This is the same `entry.range` the panel row renders as
//        its `L{start}-L{end}` (contextPanel.ts:57), so row 2 grades the panel's
//        number without scraping pixels.
//   `[ctx] lost id=… reason=…` / `[ctx] rename n=… from -> to`
//
// A GENERATION NEEDS A MODEL, and the rows here do not. Every row asserts on the
// prompt, which is logged before the request leaves. With no ollama running the
// command then raises its honest "server isn't running" toast and waits on the
// human; the rows never await the command, they await the prompt, and dismiss
// the toast afterwards.
//
// Fixture hygiene: two files are written into the dogfood repo, driven, and
// DELETED. Nothing here reconfigures a dogfood repo; the two settings this file
// needs are written to the test instance's own GLOBAL settings and restored.
//
// Run:  C80_LOG_FILE=/tmp/c80.log npm run test:vscode -- --label ts --grep V33LIVE

'use strict';

const assert = require('assert');
const vscode = require('vscode');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { SPECS } = require('./helpers/specs');
const { LANG, settled, symbols, report, sleep } = require('./helpers/probe');

const spec = SPECS[LANG];

// One identifier, every language, so the "typed after the block was added"
// assertion is a single substring search wherever it runs.
const SENTINEL = 'V33SentinelQ7X';

// Per-language fixtures. Same geometry everywhere: a context file holding one
// small function with a two line body, and a target file holding one documented
// function to generate. Every coordinate below is a text NEEDLE, never a line
// number, so a fixture edit cannot silently re-point an assertion.
const FIXTURES = {
  ts: {
    ctxRel: 'src/c80_v33_live_ctx.ts',
    ctxText: `export const V33_CTX_BEFORE = 1;

export function v33Stage(total: number, limit: number): number {
  let out = total;
  return out;
}

export const V33_CTX_AFTER = 2;
`,
    fnNeedle: 'export function v33Stage',
    insertAfter: '  let out = total;',
    ifBlock: '  if (total > limit) {\n  }\n',
    ifNeedle: 'if (total > limit) {',
    fill: `    out = ${SENTINEL} * limit;\n`,
    lineComment: '//',
    targetRel: 'src/c80_v33_live_target.ts',
    targetText: `/**
 * Fold the staged totals into one number.
 */
export function v33Target(rows: number[]): number {
  return 0;
}
`,
    targetNeedle: '  return 0;',
    targetName: 'v33Target',
  },
  csharp: {
    ctxRel: 'C80V33LiveCtx.cs',
    ctxText: `namespace Playground;

public static class C80V33LiveCtx
{
    public static int V33Stage(int total, int limit)
    {
        var staged = total;
        return staged;
    }
}
`,
    fnNeedle: 'public static int V33Stage',
    insertAfter: '        var staged = total;',
    ifBlock: '        if (total > limit) {\n        }\n',
    ifNeedle: 'if (total > limit) {',
    fill: `            staged = ${SENTINEL} * limit;\n`,
    lineComment: '//',
    targetRel: 'C80V33LiveTarget.cs',
    targetText: `namespace Playground;

public static class C80V33LiveTarget
{
    /// <summary>Fold the staged totals into one number.</summary>
    public static int V33Target(int[] rows)
    {
        return 0;
    }
}
`,
    targetNeedle: '        return 0;',
    targetName: 'V33Target',
  },
  python: {
    ctxRel: 'c80_v33_live_ctx.py',
    ctxText: `V33_CTX_BEFORE = 1


def v33_stage(total, limit):
    staged = total
    return staged


V33_CTX_AFTER = 2
`,
    fnNeedle: 'def v33_stage',
    insertAfter: '    staged = total',
    ifBlock: '    if total > limit:\n        pass\n',
    ifNeedle: 'if total > limit:',
    fill: `        staged = ${SENTINEL} * limit\n`,
    lineComment: '#',
    targetRel: 'c80_v33_live_target.py',
    targetText: `def v33_target(rows):
    # fold the staged totals into one number
    return 0
`,
    targetNeedle: '    return 0',
    targetName: 'v33_target',
  },
  rust: {
    ctxRel: 'src/c80_v33_live_ctx.rs',
    ctxText: `pub const V33_CTX_BEFORE: i32 = 1;

pub fn v33_stage(total: i32, limit: i32) -> i32 {
    let mut staged = total;
    staged
}

pub const V33_CTX_AFTER: i32 = 2;
`,
    fnNeedle: 'pub fn v33_stage',
    insertAfter: '    let mut staged = total;',
    ifBlock: '    if total > limit {\n    }\n',
    ifNeedle: 'if total > limit {',
    fill: `        staged = ${SENTINEL} * limit;\n`,
    lineComment: '//',
    targetRel: 'src/c80_v33_live_target.rs',
    targetText: `/// Fold the staged totals into one number.
pub fn v33_target(rows: &[i32]) -> i32 {
    rows.len() as i32
}
`,
    targetNeedle: '    rows.len() as i32',
    targetName: 'v33_target',
  },
  go: {
    ctxRel: 'playground/c80_v33_live_ctx.go',
    ctxText: `package playground

const V33CtxBefore = 1

func V33Stage(total int, limit int) int {
\tstaged := total
\treturn staged
}

const V33CtxAfter = 2
`,
    fnNeedle: 'func V33Stage',
    insertAfter: '\tstaged := total',
    ifBlock: '\tif total > limit {\n\t}\n',
    ifNeedle: 'if total > limit {',
    fill: `\t\tstaged = ${SENTINEL} * limit\n`,
    lineComment: '//',
    targetRel: 'playground/c80_v33_live_target.go',
    targetText: `package playground

// V33Target folds the staged totals into one number.
func V33Target(rows []int) int {
\treturn 0
}
`,
    targetNeedle: '\treturn 0',
    targetName: 'V33Target',
  },
};

const fx = FIXTURES[LANG];

// --- the log instrument ------------------------------------------------------

// The tee is read out of `process.env` when the extension ACTIVATES
// (extension.ts:24, `onStartupFinished`). Setting the variable here works only
// while that has not happened yet, which is why both facts are captured at
// module load and never inferred later: a missing instrument that gets read as a
// measurement is the failure mode goal item 13 cost ten dogfood rounds to learn.
//
//   - variable already in the environment: the tee is installed, whatever the
//     activation order was. This is how the file is meant to be run.
//   - not in the environment, extension not yet active: this default wins and
//     the tee is installed.
//   - not in the environment, extension ALREADY active: there is no instrument
//     and there is no way to add one. The suite says so by name and skips,
//     rather than reporting a silent zero or a red that blames the product.
const EXT_ID = 'utilitydelta.column-80';
const extensionAtLoad = vscode.extensions.getExtension(EXT_ID);
const ACTIVE_AT_LOAD = extensionAtLoad ? extensionAtLoad.isActive === true : false;
const LOG_FROM_ENV = typeof process.env.C80_LOG_FILE === 'string' && process.env.C80_LOG_FILE !== '';
const DEFAULT_LOG = path.join(os.tmpdir(), `c80-v33-live-${process.pid}.log`);
if (!LOG_FROM_ENV) {
  process.env.C80_LOG_FILE = DEFAULT_LOG;
}
const LOG_FILE = process.env.C80_LOG_FILE;
const NO_INSTRUMENT = !LOG_FROM_ENV && ACTIVE_AT_LOAD;

// Byte offsets, and the slice is taken on the BUFFER: a prompt carrying any
// non-ascii byte would put a character offset out of step with the file size.
const logMark = () => {
  try {
    return fs.statSync(LOG_FILE).size;
  } catch {
    return 0;
  }
};
const logSince = (mark) => {
  try {
    return fs.readFileSync(LOG_FILE).subarray(mark).toString('utf8');
  } catch {
    return '';
  }
};

// Every assembled fn-gen prompt written since `mark`, in order. `[fim]` dumps
// share the setting and are deliberately not matched: they are a different
// path with a different marker.
function promptsSince(mark) {
  const out = [];
  const re = /^\[fngen\] prompt-begin bytes=\d+\n([\s\S]*?)\n\[fngen\] prompt-end$/gm;
  const text = logSince(mark);
  let m;
  while ((m = re.exec(text)) !== null) {
    out.push(m[1]);
  }
  return out;
}

const ctxLinesSince = (mark) => logSince(mark).split('\n').filter((l) => l.startsWith('[ctx] '));

function addedSince(mark) {
  const m = /^\[ctx\] add id=(b\d+) range=L(\d+)-L(\d+)/m.exec(logSince(mark));
  return m ? { id: m[1], startLine: Number(m[2]), endLine: Number(m[3]) } : undefined;
}

// The LAST range the store re-anchored `id` to, which is the range the panel row
// is rendering right now.
function lastRangeSince(mark, id) {
  const re = new RegExp(`^\\[ctx\\] reanchor id=${id} L\\d+-L\\d+ -> L(\\d+)-L(\\d+)`, 'gm');
  const text = logSince(mark);
  let last;
  let m;
  while ((m = re.exec(text)) !== null) {
    last = { startLine: Number(m[1]), endLine: Number(m[2]) };
  }
  return last;
}

const lostSince = (mark, id) =>
  (new RegExp(`^\\[ctx\\] lost id=${id} reason=(\\S+)`, 'm').exec(logSince(mark)) || [])[1];

async function waitFor(fn, timeoutMs, what) {
  const started = Date.now();
  for (;;) {
    let value;
    try {
      value = await fn();
    } catch {
      value = undefined;
    }
    if (value) return value;
    if (Date.now() - started > timeoutMs) {
      throw new Error(`timed out after ${timeoutMs}ms waiting for ${what}`);
    }
    await sleep(250);
  }
}

// --- fixture helpers ---------------------------------------------------------

const ctxUri = fx && vscode.Uri.file(path.join(spec.repo, fx.ctxRel));
const renamedUri = fx && vscode.Uri.file(path.join(spec.repo, fx.ctxRel.replace(/(\.\w+)$/, '_moved$1')));
const targetUri = fx && vscode.Uri.file(path.join(spec.repo, fx.targetRel));

function lineOf(doc, needle) {
  const idx = doc.getText().indexOf(needle);
  assert.ok(idx >= 0, `needle not found in the fixture: ${JSON.stringify(needle)}`);
  return doc.positionAt(idx).line;
}

function cursorOn(doc, needle) {
  const line = doc.lineAt(lineOf(doc, needle));
  return new vscode.Position(
    line.lineNumber,
    Math.min(line.firstNonWhitespaceCharacterIndex + 1, line.text.length),
  );
}

const newlines = (s) => (s.match(/\n/g) || []).length;

// The context file back to its pristine bytes, in the buffer AND on disk, with
// the store emptied first so the reset's own edits reach no entry.
async function resetCtx() {
  await vscode.commands.executeCommand('column80.contextClear');
  if (!fs.existsSync(ctxUri.fsPath)) {
    fs.writeFileSync(ctxUri.fsPath, fx.ctxText);
  }
  const doc = await vscode.workspace.openTextDocument(ctxUri);
  await vscode.window.showTextDocument(doc, { preview: false });
  if (doc.getText() !== fx.ctxText) {
    const edit = new vscode.WorkspaceEdit();
    edit.replace(doc.uri, new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)), fx.ctxText);
    assert.ok(await vscode.workspace.applyEdit(edit), 'applyEdit refused the fixture reset');
  }
  if (doc.isDirty) await doc.save();
  await sleep(200);
  return doc;
}

// The panel gesture a human uses: cursor on the function header, "Add Symbol".
async function addSymbolBlock(doc) {
  const editor = await vscode.window.showTextDocument(doc, { preview: false });
  const pos = cursorOn(doc, fx.fnNeedle);
  editor.selection = new vscode.Selection(pos, pos);
  const mark = logMark();
  await vscode.commands.executeCommand('column80.contextAddSymbol');
  const entry = await waitFor(
    () => addedSince(mark),
    15000,
    `a [ctx] add line in ${LOG_FILE} after column80.contextAddSymbol. ` +
      'Either the gesture refused (no symbol at the cursor) or the C80_LOG_FILE tee is not ' +
      'installed, in which case this file loaded after the extension activated and the run must ' +
      'be re-invoked with C80_LOG_FILE already set in the environment.',
  );
  return entry;
}

// The human's typing, in two events because that is how a human makes them: the
// `if` shell first, its body second.
async function typeIfBlockInside(doc) {
  const editor = await vscode.window.showTextDocument(doc, { preview: false });
  await editor.edit((b) => b.insert(new vscode.Position(lineOf(doc, fx.insertAfter) + 1, 0), fx.ifBlock));
  await sleep(400);
  await editor.edit((b) => b.insert(new vscode.Position(lineOf(doc, fx.ifNeedle) + 1, 0), fx.fill));
  await sleep(400);
  return newlines(fx.ifBlock) + newlines(fx.fill);
}

// Fire the generation, capture the prompt it assembled, and let the command go.
// NOT awaited: with no model reachable the command ends on an error toast with a
// button, and a toast nobody clicks never resolves. The prompt is logged before
// the request leaves, so the row's evidence lands either way.
async function generateAndCapturePrompt() {
  const doc = await vscode.workspace.openTextDocument(targetUri);
  const editor = await vscode.window.showTextDocument(doc, { preview: false });
  const pos = cursorOn(doc, fx.targetNeedle);
  editor.selection = new vscode.Selection(pos, pos);
  const mark = logMark();
  const running = vscode.commands.executeCommand('column80.generateFunction');
  Promise.resolve(running).catch(() => {});
  let prompts;
  try {
    prompts = await waitFor(
      () => {
        const found = promptsSince(mark);
        return found.length > 0 ? found : undefined;
      },
      120000,
      'an [fngen] prompt-begin/prompt-end pair on the channel',
    );
  } catch (err) {
    throw new Error(`${err.message}\n--- channel since the gesture ---\n${logSince(mark).slice(0, 4000)}`);
  } finally {
    await sleep(1500);
    // Release whatever the command is waiting on (the unreachable-server error,
    // or the generate-time "your prompt went without a block" warning) and drop
    // any preview a reachable model would have opened.
    try {
      await vscode.commands.executeCommand('notifications.clearAll');
    } catch {}
    try {
      await vscode.commands.executeCommand('column80.proposalReject');
    } catch {}
    await Promise.race([Promise.resolve(running).catch(() => {}), sleep(5000)]);
  }
  return prompts[prompts.length - 1];
}

// The one prompt section a block produces (prompt.ts:296), or undefined when the
// prompt carries no section for that uri at all.
function contextSectionFor(prompt, uri) {
  const head = new RegExp(`^Context: ${uri.toString().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}#L(\\d+)-L(\\d+)\\n\`\`\`\\n([\\s\\S]*?)\`\`\``, 'm');
  const m = head.exec(prompt);
  return m ? { startLine: Number(m[1]), endLine: Number(m[2]), text: m[3] } : undefined;
}

async function closeEverything() {
  // Saved first: `closeAllEditors` on a dirty buffer opens a modal nobody is
  // here to answer, and the fixture files are deleted at teardown anyway.
  for (const doc of vscode.workspace.textDocuments) {
    if (doc.isDirty && doc.uri.scheme === 'file') {
      try {
        await doc.save();
      } catch {}
    }
  }
  try {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  } catch {}
}

// --- the suite ---------------------------------------------------------------

suite(`V33LIVE context blocks are live in a real host [${LANG}]`, function () {
  let ready = false;

  suiteSetup(async function () {
    if (!fx) return;
    if (NO_INSTRUMENT) {
      report('V33LIVE setup', [
        'SKIPPED, no instrument: C80_LOG_FILE was unset and the extension had already activated ' +
          'when this file loaded, so the channel tee could not be installed. Every row here reads ' +
          'the product\'s own channel lines. Re-run with the variable set, e.g. ' +
          'C80_LOG_FILE=/tmp/c80.log npm run test:vscode -- --label ' + LANG + ' --grep V33LIVE',
      ]);
      return;
    }
    const ext = vscode.extensions.getExtension(EXT_ID);
    if (ext && !ext.isActive) await ext.activate();

    fs.mkdirSync(path.dirname(ctxUri.fsPath), { recursive: true });
    fs.mkdirSync(path.dirname(targetUri.fsPath), { recursive: true });
    fs.writeFileSync(ctxUri.fsPath, fx.ctxText);
    fs.writeFileSync(targetUri.fsPath, fx.targetText);

    // GLOBAL, never Workspace: a Workspace update writes .vscode/settings.json
    // into the dogfood repo, and reconfiguring a dogfood repo to make a test
    // pass is banned. logPrompts is the capture; FIM off keeps its own
    // per-keystroke prompt dumps out of the instrument.
    const cfg = vscode.workspace.getConfiguration('column80');
    await cfg.update('logPrompts', true, vscode.ConfigurationTarget.Global);
    await cfg.update('enabled', false, vscode.ConfigurationTarget.Global);
    // The fn-gen service snapshots its config at construction and the extension
    // rebuilds it on the change event; let that land before the first generate.
    await sleep(2000);

    const ctxDoc = await vscode.workspace.openTextDocument(ctxUri);
    await vscode.window.showTextDocument(ctxDoc, { preview: false });
    const targetDoc = await vscode.workspace.openTextDocument(targetUri);
    await vscode.window.showTextDocument(targetDoc, { preview: false });

    const timeoutMs = LANG === 'csharp' ? 120000 : 30000;
    const ctxTree = await settled(() => symbols(ctxUri), {
      ready: (v) => Array.isArray(v) && v.length > 0 && JSON.stringify(v).includes(fx.fnNeedle.split(/\s+/).pop()),
      timeoutMs,
    });
    const targetTree = await settled(() => symbols(targetUri), {
      ready: (v) => Array.isArray(v) && v.length > 0,
      timeoutMs,
    });
    ready = Array.isArray(ctxTree.value) && ctxTree.value.length > 0 && Array.isArray(targetTree.value) && targetTree.value.length > 0;
    report('V33LIVE setup', [
      `log instrument: ${LOG_FILE} (${process.env.C80_LOG_FILE === DEFAULT_LOG ? 'defaulted by this file' : 'from the environment'})`,
      `ctx symbols settled=${ctxTree.settled} ms=${ctxTree.ms}; target symbols settled=${targetTree.settled} ms=${targetTree.ms}`,
      `server ready=${ready}`,
    ]);
  });

  suiteTeardown(async function () {
    if (!fx || NO_INSTRUMENT) return;
    try {
      await vscode.commands.executeCommand('column80.contextClear');
    } catch {}
    await closeEverything();
    const cfg = vscode.workspace.getConfiguration('column80');
    try {
      await cfg.update('logPrompts', undefined, vscode.ConfigurationTarget.Global);
      await cfg.update('enabled', undefined, vscode.ConfigurationTarget.Global);
    } catch {}
    // Every path this file can leave a file at, including the rename target.
    for (const uri of [ctxUri, renamedUri, targetUri]) {
      fs.rmSync(uri.fsPath, { force: true });
    }
    report('V33LIVE fixture hygiene', [
      [ctxUri, renamedUri, targetUri]
        .map((u) => `${path.relative(spec.repo, u.fsPath)} exists=${fs.existsSync(u.fsPath)}`)
        .join('; '),
    ]);
  });

  // =========================================================================
  // ROW 1. The human's example, end to end. This one row is the session.
  // =========================================================================
  test('1: an `if` block typed INTO a context block after it was added reaches the model', async function () {
    if (!fx || !ready) return this.skip();
    const doc = await resetCtx();
    assert.ok(
      !fx.ctxText.includes(SENTINEL),
      'the fixture must not carry the sentinel before the drive, or this row proves nothing',
    );
    const entry = await addSymbolBlock(doc);
    const grew = await typeIfBlockInside(doc);
    const prompt = await generateAndCapturePrompt();

    const section = contextSectionFor(prompt, ctxUri);
    report('1 the human\'s case', [
      `block added as ${entry.id} L${entry.startLine}-L${entry.endLine}; typed ${grew} lines inside it`,
      `prompt bytes=${prompt.length}; context section=${section ? `L${section.startLine}-L${section.endLine}` : 'ABSENT'}`,
      ...(section ? section.text.split('\n').map((l) => `  | ${l}`) : []),
    ]);
    assert.ok(section, `the prompt carried no context section for ${ctxUri}. Prompt:\n${prompt}`);
    assert.ok(
      section.text.includes(SENTINEL),
      'the implementation typed INSIDE the block after it was added did not reach the prompt. ' +
        `Looked for ${SENTINEL} in:\n${section.text}`,
    );
    assert.ok(
      section.text.includes(fx.ifNeedle),
      `the \`if\` block itself did not reach the prompt. Looked for ${JSON.stringify(fx.ifNeedle)} in:\n${section.text}`,
    );
    // Liveness, not luck: the section must also still hold the lines the block
    // was added over, so this is a grown block rather than a re-pointed one.
    assert.ok(
      section.text.includes(fx.insertAfter.trim()),
      `the block's original lines are missing from the prompt:\n${section.text}`,
    );
    assert.strictEqual(section.startLine, entry.startLine, 'the block\'s first line moved');
    assert.strictEqual(
      section.endLine,
      entry.endLine + grew,
      'the prompt\'s own range header did not grow with the typing',
    );
  });

  // =========================================================================
  // ROW 2. The panel row's range grows with what was typed inside it.
  // =========================================================================
  test('2: the entry range the panel renders is N lines longer after N lines are typed inside', async function () {
    if (!fx || !ready) return this.skip();
    const doc = await resetCtx();
    const entry = await addSymbolBlock(doc);
    const mark = logMark();
    const grew = await typeIfBlockInside(doc);
    const range = await waitFor(() => lastRangeSince(mark, entry.id), 10000, `a [ctx] reanchor line for ${entry.id}`);
    report('2 the block grows', [
      `added L${entry.startLine}-L${entry.endLine}; typed ${grew} lines inside; now L${range.startLine}-L${range.endLine}`,
      `this range is entry.range, which the panel row renders verbatim as L{start}-L{end}`,
    ]);
    assert.strictEqual(range.startLine, entry.startLine, 'typing INSIDE a block must not move its first line');
    assert.strictEqual(
      range.endLine,
      entry.endLine + grew,
      `typing ${grew} lines inside the block must make it exactly ${grew} lines longer`,
    );
  });

  // =========================================================================
  // ROW 3. Close and reopen: re-adopted, never lost.
  // =========================================================================
  test('3: closing every editor and generating again re-adopts the block rather than losing it', async function () {
    if (!fx || !ready) return this.skip();
    const doc = await resetCtx();
    const entry = await addSymbolBlock(doc);
    await typeIfBlockInside(doc);
    await doc.save();
    const mark = logMark();
    await closeEverything();
    await sleep(4000);
    // A MEASUREMENT, not a requirement. v33 finding 7 saw the document survive
    // this with its version intact in all five languages, so the lapse leg may
    // never fire in a real host. Either answer is reported; only the outcome is
    // graded.
    const stillOpen = vscode.workspace.textDocuments.some((d) => d.uri.toString() === ctxUri.toString());

    const prompt = await generateAndCapturePrompt();
    const section = contextSectionFor(prompt, ctxUri);
    const lost = lostSince(mark, entry.id);
    report('3 close and reopen', [
      `after closeAllEditors the ctx document is ${stillOpen ? 'STILL in workspace.textDocuments' : 'GONE from workspace.textDocuments'}`,
      `[ctx] lost for ${entry.id}: ${lost === undefined ? 'none' : lost}`,
      `context section after reopen: ${section ? `L${section.startLine}-L${section.endLine}, ${section.text.length} chars` : 'ABSENT'}`,
      stillOpen
        ? 'MEASUREMENT: the host kept the document, so onDidCloseTextDocument never fired and the ' +
          'LAPSE/RE-ADOPTION leg was NOT exercised by this row. What is graded here is the outcome ' +
          'a human sees, which is that closing every tab costs them nothing. The lapse leg cannot be ' +
          'forced: the API says the document lifetime is the editor\'s, so only the headless oracles ' +
          'can drive it.'
        : 'MEASUREMENT: the host DID drop the document, so this row exercised the lapse and ' +
          're-adoption path for real.',
    ]);
    assert.strictEqual(lost, undefined, `the block was lost across a close/reopen cycle, reason=${lost}`);
    assert.ok(section, `the block reached no prompt after a close/reopen cycle. Prompt:\n${prompt}`);
    assert.ok(section.text.includes(SENTINEL), `the re-adopted block lost its text:\n${section.text}`);
  });

  // =========================================================================
  // ROW 4. A crossing edit loses the block, and the generation goes on WITHOUT
  // it. Drop, never refuse.
  // =========================================================================
  test('4: an edit crossing the block boundary loses it, and the generation proceeds without it', async function () {
    if (!fx || !ready) return this.skip();
    const doc = await resetCtx();
    const entry = await addSymbolBlock(doc);
    const mark = logMark();
    const editor = await vscode.window.showTextDocument(doc, { preview: false });
    // Starts one line ABOVE the block and ends at character 0 of the block's
    // SECOND line: a head overlap, which is the shape the four-case rule refuses
    // rather than clamping.
    const first = entry.startLine - 1; // 0-based first line of the block
    await editor.edit((b) =>
      b.replace(new vscode.Range(first - 1, 0, first + 1, 0), `${fx.lineComment} v33 crossing edit\n`),
    );
    await sleep(600);
    const lost = await waitFor(() => lostSince(mark, entry.id), 10000, `a [ctx] lost line for ${entry.id}`);

    const prompt = await generateAndCapturePrompt();
    const section = contextSectionFor(prompt, ctxUri);
    report('4 drop, never refuse', [
      `[ctx] lost id=${entry.id} reason=${lost}`,
      `the generation still assembled a prompt of ${prompt.length} bytes`,
      `context section for the lost block: ${section ? 'PRESENT' : 'absent, as it must be'}`,
    ]);
    assert.strictEqual(lost, 'crossed', 'a boundary-crossing edit must lose the block with reason=crossed');
    assert.ok(!section, `a lost block reached the prompt anyway:\n${prompt}`);
    // Drop-not-refuse: there IS a prompt, and it is the real one for the target
    // rather than any old string that happened to reach the channel.
    assert.ok(
      prompt.includes(fx.targetName),
      `the generation refused instead of proceeding without the lost block; the prompt does not ` +
        `even name ${fx.targetName}:\n${prompt}`,
    );
  });

  // =========================================================================
  // ROW 5. A rename carries the block's uri.
  // =========================================================================
  test('5: renaming the file carries the block, and the prompt names the new uri', async function () {
    if (!fx || !ready) return this.skip();
    const doc = await resetCtx();
    const entry = await addSymbolBlock(doc);
    await typeIfBlockInside(doc);
    await doc.save();
    const mark = logMark();
    // A WorkspaceEdit rename, which is the API that raises onDidRenameFiles. A
    // rename on disk would not: that event is explicitly not fired for changes
    // made outside the editor.
    const renameEdit = new vscode.WorkspaceEdit();
    renameEdit.renameFile(ctxUri, renamedUri, { overwrite: true });
    assert.ok(await vscode.workspace.applyEdit(renameEdit), 'applyEdit refused the rename');
    await sleep(1500);
    const renameLine = ctxLinesSince(mark).find((l) => l.startsWith('[ctx] rename '));

    const prompt = await generateAndCapturePrompt();
    const atNew = contextSectionFor(prompt, renamedUri);
    const atOld = contextSectionFor(prompt, ctxUri);
    report('5 rename', [
      `channel: ${renameLine ?? '(no [ctx] rename line)'}`,
      `prompt names the NEW uri: ${!!atNew}; the OLD uri: ${!!atOld}`,
    ]);
    try {
      assert.ok(renameLine, `no [ctx] rename line after a WorkspaceEdit rename. Channel:\n${ctxLinesSince(mark).join('\n')}`);
      assert.ok(renameLine.includes(renamedUri.toString()), `the rename did not point at ${renamedUri}: ${renameLine}`);
      assert.ok(atNew, `the block did not follow its file. Prompt:\n${prompt}`);
      assert.ok(!atOld, 'the prompt still names the pre-rename uri');
      assert.ok(atNew.text.includes(SENTINEL), `the renamed block lost its text:\n${atNew.text}`);
    } finally {
      // Put the file back so the later rows and the teardown see one path.
      if (fs.existsSync(renamedUri.fsPath)) {
        const back = new vscode.WorkspaceEdit();
        back.renameFile(renamedUri, ctxUri, { overwrite: true });
        await vscode.workspace.applyEdit(back);
        await sleep(500);
      }
      await vscode.commands.executeCommand('column80.contextClear');
    }
  });

  // =========================================================================
  // ROW 6. A dirty buffer counts. The reader reads the buffer, not the disk,
  // and no headless test can see the difference.
  // =========================================================================
  test('6: unsaved text in the buffer reaches the prompt while the disk still says otherwise', async function () {
    if (!fx || !ready) return this.skip();
    const doc = await resetCtx();
    const entry = await addSymbolBlock(doc);
    await typeIfBlockInside(doc);
    // Deliberately NOT saved.
    const onDisk = fs.readFileSync(ctxUri.fsPath, 'utf8');
    const prompt = await generateAndCapturePrompt();
    const section = contextSectionFor(prompt, ctxUri);
    report('6 the dirty buffer', [
      `buffer isDirty=${doc.isDirty}; disk carries the sentinel=${onDisk.includes(SENTINEL)}`,
      `context section: ${section ? `L${section.startLine}-L${section.endLine}` : 'ABSENT'}; carries the sentinel=${!!section && section.text.includes(SENTINEL)}`,
    ]);
    assert.ok(doc.isDirty, 'the drive failed to leave the buffer dirty, so this row proves nothing');
    assert.ok(
      !onDisk.includes(SENTINEL),
      'the disk already carries the sentinel, so a disk read would pass this row',
    );
    assert.ok(section, `the prompt carried no context section for ${ctxUri}. Prompt:\n${prompt}`);
    assert.ok(
      section.text.includes(SENTINEL),
      `the reader read the DISK, not the buffer: unsaved text never reached the prompt:\n${section.text}`,
    );
    // Leave the buffer clean for whatever runs next.
    await doc.save();
  });
});
