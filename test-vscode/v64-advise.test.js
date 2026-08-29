'use strict';

// THE MODEL-AUTHORED REVIEW, IN A REAL EXTENSION HOST (session-v64 phase 12).
//
// Everything else that grades this path runs against a structural `vscode` stub
// with a scripted model. That proves the plumbing and it cannot prove the thing
// a human pressing the command would find out in five seconds: whether the
// command is registered at all, whether a real language server answers for the
// callees, whether the diagnostics the developer's own toolchain published are
// actually reachable, and whether a real model's reply survives the round trip.
//
// This session has already shipped one leg that was correct, unit tested, and
// registered nowhere. A stub cannot catch that. A host can.
//
// IT PRESSES THE SAME FUNCTION `v61-criticize.test.js` PRESSES, out of the
// shared fixture helper, because the two commands exist to be compared and a
// comparison of two different functions is not one.
//
// A DEAD SERVER OR A DEAD MODEL SKIPS BY NAME, never fails. A zero from a rig
// that cannot fire is a fact about the rig, and this session has paid for that
// lesson twice. Every skip says which half was missing.
//
// Run: DISPLAY=:1 npx vscode-test --config test-vscode/.vscode-test.mjs --label ts
// (the label chooses the language; C80_LANG selects the fixture row)

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vscode = require('vscode');
const { SPECS } = require('./helpers/specs');
const { FIXTURES } = require('./helpers/criticize-fixtures');

const product = require('./.build/product.js');

const LANG = process.env.C80_LANG || 'ts';
const spec = SPECS[LANG];
const fixture = FIXTURES[LANG];
const fixturePath = spec && fixture ? path.join(spec.repo, fixture.file) : undefined;
const EXT_ID = 'utilitydelta.column-80';
const ADVISE = 'column80.reviewFunctionModel';
const RUBRIC = 'column80.criticizeFunction';

// The channel tee, on the same three-way rule the other host suites use.
const extensionAtLoad = vscode.extensions.getExtension(EXT_ID);
const ACTIVE_AT_LOAD = extensionAtLoad ? extensionAtLoad.isActive === true : false;
const LOG_FROM_ENV = typeof process.env.C80_LOG_FILE === 'string' && process.env.C80_LOG_FILE !== '';
if (!LOG_FROM_ENV) {
  process.env.C80_LOG_FILE = path.join(os.tmpdir(), `c80-v64-advise-${process.pid}.log`);
}
const LOG_FILE = process.env.C80_LOG_FILE;
const NO_INSTRUMENT = !LOG_FROM_ENV && ACTIVE_AT_LOAD;

// A model round against a 30B is tens of seconds; against a frontier CLI it can
// be more. CHOSEN well above both, and it never decides an answer: when it fires
// the row skips rather than failing.
const ROUND_MS = 180000;
const SERVER_READY_MS = 90000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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

/** Waits for any one of several channel needles, so a row can wait on "the
 *  round finished, however it finished" rather than on one outcome it has
 *  already assumed. */
async function waitForAny(mark, needles, ms) {
  const deadline = Date.now() + ms;
  for (;;) {
    const text = logSince(mark);
    if (needles.some((n) => text.includes(n))) return text;
    if (Date.now() > deadline) return text;
    await sleep(250);
  }
}

/** Every `[critique]` line since the mark. */
const critique = (text) =>
  text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.includes('[critique]'));

let pristine;
let pristineDirty;

function cursorOnProbe(doc) {
  const lines = doc.getText().split('\n');
  const at = lines.findIndex((l) => l.includes(fixture.cursorNeedle));
  if (at < 0) return undefined;
  return new vscode.Position(at, Math.max(0, lines[at].length - 1));
}

/**
 * Appends the fixture and waits until THE PRODUCT resolves a function at the
 * probe cursor.
 *
 * The readiness signal is `resolveFunctionAtCursor` and not a raw symbol query,
 * because that is the precondition every row actually has. The reset is
 * append-shaped: replacing the whole document made Pylance serve a stale symbol
 * tree for the full readiness window, and every python row then skipped as a
 * dead rig.
 */
async function openFixture() {
  const uri = vscode.Uri.file(fixturePath);
  const doc = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(doc, { preview: false });
  if (pristine === undefined) {
    pristine = doc.getText();
    pristineDirty = doc.isDirty;
  }
  const wanted = pristine + fixture.text;
  if (doc.getText() !== wanted) {
    const edit = new vscode.WorkspaceEdit();
    edit.replace(
      uri,
      new vscode.Range(doc.positionAt(pristine.length), doc.positionAt(doc.getText().length)),
      fixture.text,
    );
    if (!(await vscode.workspace.applyEdit(edit))) {
      throw new Error('applyEdit refused the fixture reset');
    }
  }
  const at = cursorOnProbe(doc);
  assert.ok(at !== undefined, 'the inserted fixture must contain its cursor needle');
  const deadline = Date.now() + SERVER_READY_MS;
  let resolved;
  for (;;) {
    resolved = await product.resolveFunctionAtCursor(doc, at);
    if (resolved !== undefined) break;
    if (Date.now() > deadline) break;
    await sleep(1000);
  }
  return { doc, uri, at, resolved, ready: resolved !== undefined };
}

async function restoreFixture() {
  if (pristine === undefined || fixturePath === undefined) return;
  try {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(fixturePath));
    if (doc.getText() !== pristine) {
      await vscode.window.showTextDocument(doc, { preview: false });
      const edit = new vscode.WorkspaceEdit();
      edit.replace(doc.uri, new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)), pristine);
      await vscode.workspace.applyEdit(edit);
      if (!pristineDirty) await doc.save();
    }
  } catch {
    // A restore that cannot run is not a test result.
  }
}

/** Fires the command and waits for the round to END, whatever it ended as.
 *
 *  FIRE, DO NOT AWAIT: the command waits on a human verdict at the diff tab, and
 *  awaiting it here would deadlock on a decision this suite has not made. */
async function press(command, doc) {
  // RE-OPEN BY URI rather than trusting the handle. `closeAllEditors` between
  // presses can leave the caller holding a document whose editor is gone, and
  // the second press then set a selection from an undefined position and threw
  // `Invalid arguments` out of the harness. Reading the cursor off the freshly
  // opened document is one line and it makes a row that presses twice honest.
  const fresh = await vscode.workspace.openTextDocument(doc.uri);
  const editor = await vscode.window.showTextDocument(fresh, { preview: false });
  const at = cursorOnProbe(fresh);
  assert.ok(at !== undefined, 'the cursor needle is gone from the buffer, so this press would measure nothing');
  editor.selection = new vscode.Selection(at, at);
  const mark = logMark();
  const running = vscode.commands.executeCommand(command);
  const text = await waitForAny(
    mark,
    [
      'model review offers',
      'nothing to propose',
      'got no answer',
      'had nothing to say',
      'not one of them named a line',
      'model review skipped',
      'model review has no backend',
      '[critique] proposing',
      'It does not certify correctness.',
    ],
    ROUND_MS,
  );
  return { text, lines: critique(text), running, mark };
}

/** Closes whatever diff the press opened, so the next row starts clean. */
async function dismiss(running) {
  try {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  } catch {
    // nothing
  }
  try {
    await Promise.race([running, sleep(5000)]);
  } catch {
    // The command's own failures are read off the channel, not off this promise.
  }
}

suite(`v64 model-authored review, real host, ${LANG}`, function () {
  this.timeout(900000);

  suiteSetup(async function () {
    // ACTIVATE FIRST. `getCommands` answers before an extension has registered
    // anything, so row 1 asked the question too early and reported a command
    // that WAS registered as missing.
    const ext = vscode.extensions.getExtension(EXT_ID);
    if (ext !== undefined && !ext.isActive) {
      await ext.activate();
    }

    // PIN THE BACKEND. `vscode-test` KEEPS ITS USER-DATA-DIR between runs, so a
    // model name left behind by an earlier session survives into this one: the
    // first run of this suite hit `Ollama 404: model 'claude-sonnet-4-5' not
    // found`, which is a stale profile wearing a product defect's clothes. The
    // shipped defaults are ollama + qwen3-coder:30b and this puts them back
    // rather than trusting whatever the profile carries.
    const cfg = vscode.workspace.getConfiguration();
    try {
      await cfg.update('column80.fnGenProvider', 'ollama', vscode.ConfigurationTarget.Global);
      await cfg.update('column80.fnGenModel', process.env.C80_MODEL || 'qwen3-coder:30b', vscode.ConfigurationTarget.Global);
    } catch {
      // A profile that refuses the write is reported by the rows below as a
      // transport failure, which is the honest reading.
    }
  });

  suiteTeardown(async () => {
    await restoreFixture();
    try {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    } catch {
      // nothing
    }
  });

  test('1: the command is registered in a real host, under its own id', async function () {
    if (NO_INSTRUMENT) return this.skip();
    const ext = vscode.extensions.getExtension(EXT_ID);
    assert.ok(ext !== undefined, 'the extension is not installed in this host at all');
    assert.ok(ext.isActive, 'the extension did not activate, so no command of ours can be registered');
    const all = await vscode.commands.getCommands(true);
    assert.ok(
      all.includes(ADVISE),
      `${ADVISE} is not registered. Every stub test can pass with the command wired to nothing; this is ` +
        'the row that catches it.',
    );
    assert.ok(all.includes(RUBRIC), 'and the rubric command it is meant to be compared against is still there');
  });

  test('2: a press produces a round that ENDED, and the channel says how', async function () {
    if (NO_INSTRUMENT) return this.skip();
    if (fixturePath === undefined) return this.skip();
    const state = await openFixture();
    if (!state.ready) {
      return this.skip();
    }
    const run = await press(ADVISE, state.doc);
    await dismiss(run.running);

    assert.ok(run.lines.length > 0, `the gesture wrote nothing to the channel at all:\n${run.text}`);
    // EVERY ENDING IS NAMED. The three failure states and the two success
    // states each have their own sentence, and a round that ends on none of
    // them is a round nobody can triage.
    const endings = [
      'model review offers',
      'nothing to propose',
      'got no answer',
      'had nothing to say',
      'not one of them named a line',
      'model review skipped',
      'model review has no backend',
    ];
    assert.ok(
      endings.some((e) => run.text.includes(e)),
      `the round ended on none of its named outcomes:\n${run.lines.join('\n')}`,
    );
  });

  test('3: the context line reports what the REAL host could gather', async function () {
    if (NO_INSTRUMENT) return this.skip();
    if (fixturePath === undefined) return this.skip();
    const state = await openFixture();
    if (!state.ready) return this.skip();
    const run = await press(ADVISE, state.doc);
    await dismiss(run.running);

    const line = run.lines.find((l) => l.includes('model review context'));
    if (line === undefined) {
      // A closed tier gate or an unreachable model ends the gesture before the
      // bundle is built. That is a legitimate ending, not a failure, and it is
      // reported rather than asserted away.
      assert.ok(
        run.text.includes('model review skipped') || run.text.includes('model review has no backend'),
        `no context line and no reason for its absence:\n${run.lines.join('\n')}`,
      );
      return this.skip();
    }
    assert.match(
      line,
      /\d+ diagnostic\(s\) from the developer's tools, \d+ callee contract\(s\)/,
      `the context line must count both legs, present or absent:\n${line}`,
    );
  });

  test('4: every comment the review proposes sits directly above a line that is really there', async function () {
    if (NO_INSTRUMENT) return this.skip();
    if (fixturePath === undefined) return this.skip();
    const state = await openFixture();
    if (!state.ready) return this.skip();
    const before = state.doc.getText();
    const run = await press(ADVISE, state.doc);

    if (!run.text.includes('model review offers')) {
      await dismiss(run.running);
      return this.skip();
    }
    // THE BUFFER HAS NOT MOVED. Nothing may reach the file before the human
    // says yes, and this gesture's only write path is inside the presenter.
    assert.strictEqual(state.doc.getText(), before, 'the buffer moved before any human accepted');
    await dismiss(run.running);

    // Every dropped block said why. A block that vanished with no line is the
    // defect the phase 12 review found, and this is its host-tier guard.
    for (const l of run.lines.filter((x) => x.includes('block dropped'))) {
      assert.ok(
        /no line matches this anchor|more than one line matches this anchor|another block already took this line|above the region/.test(l),
        `a dropped block gave no usable reason: ${l}`,
      );
    }
  });

  test('5: two presses, two commands, and nothing reaches the developer\'s file', async function () {
    if (NO_INSTRUMENT) return this.skip();
    if (fixturePath === undefined) return this.skip();

    // THE FIXTURE IS RE-INSERTED BETWEEN PRESSES, and finding that out was the
    // point of writing this row. `closeAllEditors` discards an unsaved buffer,
    // so the fixture this suite appends is gone by the second press and the
    // first cut asserted against a document that no longer had the function in
    // it. A row that measures a vanished fixture measures nothing.
    const onDiskBefore = fs.readFileSync(fixturePath, 'utf8');

    const first = await openFixture();
    if (!first.ready) return this.skip();
    const adviseRun = await press(ADVISE, first.doc);
    await dismiss(adviseRun.running);

    const second = await openFixture();
    if (!second.ready) return this.skip();
    const rubricRun = await press(RUBRIC, second.doc);
    await dismiss(rubricRun.running);

    // THE GUARANTEE BOTH COMMANDS SHARE, and the only one a rejected pair can
    // be held to: neither gesture's only write path ran, so the file on disk is
    // exactly as it was found. The anti-stacking property itself is proven at
    // the unit tier against the planner, where an accept can be simulated; what
    // a host proves is that two real commands at one cursor, both declined,
    // leave the developer's file untouched.
    assert.strictEqual(
      fs.readFileSync(fixturePath, 'utf8'),
      onDiskBefore,
      'two presses with no accept must leave the file on disk exactly as they found it',
    );

    // And each press reached its own gesture rather than one of them silently
    // doing nothing, which is what would make the row above pass for free.
    assert.ok(
      adviseRun.lines.some((l) => l.includes('model review')),
      `the model review press wrote none of its own lines:\n${adviseRun.lines.join('\n')}`,
    );
    assert.ok(
      rubricRun.lines.length > 0,
      `the rubric press wrote nothing to the channel:\n${rubricRun.text}`,
    );
  });
});
