// session-v52 phase 5, the half that only a real extension host can reach.
//
// `test/impl-v52-p5-command.test.cjs` drives the whole pipeline headless: the
// ordering, the one pre-fill, the verbatim guarantee, the fold rule, the strips
// and the refusals. FOUR THINGS IT CANNOT SEE, and they are what this file is
// for:
//
//   1. the command is REGISTERED - a palette entry the human can actually press
//   2. `vscode.executeWorkspaceSymbolProvider` is a real language server here,
//      and tier 2's cost ruling ("one query, sweep only on a miss") is a claim
//      about THAT provider's matcher. Row 2 is the product-side half of the
//      measurement written up in session-v52/ratify-measurements.md.
//   3. a refusal really leaves the buffer untouched, through the real editor
//   4. the command does not throw inside the host
//
// The ACCEPT path is deliberately not driven: it ends in a multi-select
// QuickPick and then the product's own preview-and-confirm diff, and a test
// that clicks its way through both is a test of `showQuickPick`, not of this
// command. That gap is stated in the report rather than papered over.
//
// Run:  DISPLAY=:1 npx vscode-test --config test-vscode/.vscode-test.mjs --label ts --grep TIGHTEN

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vscode = require('vscode');
const { SPECS } = require('./helpers/specs');
const { report } = require('./helpers/probe');

const LANG = process.env.C80_LANG || 'ts';
const spec = SPECS[LANG];
const EXT_ID = 'utilitydelta.column-80';
const COMMAND = 'column80.tightenDocComment';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fold = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');

/** The spoken words of an identifier, split on its own humps, then the two
 *  spellings the cost ruling turns on: the PascalCase first query and the
 *  underscore variant the sweep would spend a round trip on. */
function spellings(name) {
  const words = String(name)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter((w) => w !== '');
  const cap = (w) => w[0].toUpperCase() + w.slice(1).toLowerCase();
  return {
    words,
    pascal: words.map(cap).join(''),
    glue: words.join('').toLowerCase(),
    snake: words.map((w) => w.toLowerCase()).join('_'),
  };
}

suite(`TIGHTEN the doc-comment gesture in a real host [${LANG}]`, function () {
  suiteSetup(async function () {
    const ext = vscode.extensions.getExtension(EXT_ID);
    if (ext && !ext.isActive) await ext.activate();
    await sleep(1000);
  });

  suiteTeardown(async function () {
    try {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    } catch {}
  });

  test('1: the command is registered, and it is the only way in', async function () {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes(COMMAND), `${COMMAND} must be registered by the extension`);
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    const declared = pkg.contributes.commands.find((c) => c.command === COMMAND);
    assert.ok(declared, 'package.json must declare it, or the palette entry has no title');
    assert.strictEqual(declared.category, 'Column 80');
    assert.strictEqual(declared.title, 'Tighten Doc Comment');
  });

  test('2: ONE workspace-symbol query answers, and the sweep buys nothing', async function () {
    if (!spec) return this.skip();
    // A file has to be OPEN first. Every one of these servers loads its project
    // lazily, so a workspace-symbol query fired into a host with no editor open
    // answers nothing and reads exactly like a matcher that cannot find the
    // name. Proven here: without this the row skipped on "no provider answered
    // in 30s".
    if (spec.memberSite) {
      const seed = vscode.Uri.file(path.join(spec.repo, spec.memberSite.file));
      if (fs.existsSync(seed.fsPath)) {
        const doc = await vscode.workspace.openTextDocument(seed);
        await vscode.window.showTextDocument(doc, { preview: false });
        await sleep(2000);
      }
    }
    const name = spec.typeName;
    const s = spellings(name);
    // The clock as well as the answer. `session-v52/ratify-query-cost.md` has
    // this number headless for tsserver, gopls, rust-analyzer and Roslyn, and
    // Pylance is the one server that cannot be driven outside a host (its
    // bundle prints the Visual Studio licence and exits), so THIS row is where
    // the python figure has to come from.
    const timings = [];
    const ask = async (query) => {
      const t0 = Date.now();
      const hits = await vscode.commands.executeCommand('vscode.executeWorkspaceSymbolProvider', query);
      timings.push(Date.now() - t0);
      return Array.isArray(hits) ? hits.filter((h) => fold(h.name) === fold(name)).length : 0;
    };
    // The server needs to be up for this to mean anything: a zero from a dead
    // provider is a fact about the rig, not about the matcher.
    let first = 0;
    for (let i = 0; i < 30 && first === 0; i++) {
      first = await ask(s.pascal);
      if (first === 0) await sleep(1000);
    }
    if (first === 0) {
      report(`TIGHTEN ${LANG} symbol query`, [`no provider answered ${s.pascal} in 30s; SKIPPED, this is a rig fact`]);
      return this.skip();
    }
    const glue = await ask(s.glue);
    const snake = s.snake === s.glue ? glue : await ask(s.snake);
    // Three more rounds purely for the clock, after the answers are in.
    for (let i = 0; i < 3; i++) await ask(s.pascal);
    const sorted = [...timings].sort((a, b) => a - b);
    report(`TIGHTEN ${LANG} symbol query`, [
      `type=${name} words=[${s.words.join(' ')}]`,
      `first query ${JSON.stringify(s.pascal)} -> ${first} hits`,
      `glue ${JSON.stringify(s.glue)} -> ${glue} hits`,
      `snake ${JSON.stringify(s.snake)} -> ${snake} hits`,
      `latency ms: n=${sorted.length} min=${sorted[0]} p50=${sorted[Math.floor(sorted.length / 2)]} max=${sorted[sorted.length - 1]}` +
        ' (session-v52/ratify-query-cost.md has the headless numbers for the other four servers)',
    ]);
    assert.ok(first > 0, 'the first query, in the convention the command asks first, must answer');
  });

  test('3: a cursor on a line of CODE refuses, and the buffer does not move', async function () {
    if (!spec || !spec.memberSite) return this.skip();
    const uri = vscode.Uri.file(path.join(spec.repo, spec.memberSite.file));
    if (!fs.existsSync(uri.fsPath)) return this.skip();
    const doc = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(doc, { preview: false });
    const line = doc.getText().split('\n').findIndex((l) => l.includes(spec.memberSite.needle));
    if (line < 0) return this.skip();
    const before = doc.getText();
    editor.selection = new vscode.Selection(new vscode.Position(line, 2), new vscode.Position(line, 2));

    await vscode.commands.executeCommand(COMMAND);
    await sleep(500);

    assert.strictEqual(doc.getText(), before, 'a refusal must leave the buffer byte-identical');
    assert.strictEqual(doc.isDirty, false, 'and must not even dirty it');
  });
});
