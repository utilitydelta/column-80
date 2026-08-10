// MEASUREMENT ONLY. No product code is graded here.
//
// v19 phase 1 rests on an unmeasured premise about VS Code's NATIVE suggest
// widget: that `InlineCompletionContext.selectedCompletionInfo.range` starts
// exactly AT the member separator (`.` / `::`), and that `.text` therefore
// carries that leading separator. That was observed once against tsserver and
// generalised to all four rows. This file measures it per row.
//
// For each language, at a member site, in two states:
//   A. empty partial - cursor right after the separator, widget open
//   B. typed partial - a few characters typed after the separator
// it records the verbatim `.text`, the `.range`, the cursor, what the BUFFER
// actually holds at `range.start`, and whether the range is single-line.
//
// The liveness signal is `selectedCompletionInfo` ARRIVING, not
// `window.state.focused`, which reads false on this box while the widget opens
// and delivers normally. A row that never delivers one is reported as a DEAD
// PROBE rather than having its range inferred.
//
// Run:  npm run test:vscode:ci -- --label ts --grep WIDGETRANGE

'use strict';

const vscode = require('vscode');
const { SPECS } = require('./helpers/specs');
const { LANG, open, sleep, settled, completions } = require('./helpers/probe');

const spec = SPECS[LANG];

// Every state this row is measured in. `suffix` is what is typed after the
// separator; the empty-partial state types nothing.
function statesFor(row) {
  const prefix = spec.required[0].slice(0, 3);
  const out = [
    { name: 'A empty partial', insert: spec.dotSite.insert, sep: spec.dotSite.insert.trimEnd().slice(-1) },
    { name: `B typed partial (${prefix})`, insert: spec.dotSite.insert + prefix, sep: spec.dotSite.insert.trimEnd().slice(-1) },
  ];
  if (row === 'rust') {
    // The `::` separator exists only on this row, and `::` is half the premise.
    const lead = spec.dotSite.insert.replace(/[A-Za-z_]*\.$/, '');
    out.push({ name: 'C empty partial via ::', insert: `${lead}Tile::`, sep: ':' });
    out.push({ name: 'D typed partial via :: (fro)', insert: `${lead}Tile::fro`, sep: ':' });
  }
  return out;
}

const pos2 = (p) => `{line:${p.line},character:${p.character}}`;

// Apply the probe edit, park the cursor at its end, and always revert. Nothing
// is saved: the server sees a dirty buffer, which is what it sees while a human
// types.
async function atSite(insert, fn) {
  const site = spec.dotSite;
  const doc = await open(spec, site.file);
  const anchorIdx = doc.getText().indexOf(site.anchor);
  if (anchorIdx < 0) throw new Error(`anchor not found in ${site.file}`);
  const base = anchorIdx + site.anchor.length;
  const edit = new vscode.WorkspaceEdit();
  edit.insert(doc.uri, doc.positionAt(base), insert);
  try {
    if (!(await vscode.workspace.applyEdit(edit))) throw new Error('applyEdit refused the probe edit');
    const cursor = doc.positionAt(base + insert.length);
    const ed = await vscode.window.showTextDocument(doc, { preview: false });
    ed.selection = new vscode.Selection(cursor, cursor);
    await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
    await sleep(400);
    return await fn(doc, cursor);
  } finally {
    await vscode.commands.executeCommand('hideSuggestWidget');
    await vscode.window.showTextDocument(doc, { preview: false });
    await vscode.commands.executeCommand('workbench.action.files.revert');
    await sleep(200);
  }
}

// One sample of whatever the widget is currently handing the inline layer.
async function sampleSci(doc) {
  let seen = null;
  const d = vscode.languages.registerInlineCompletionItemProvider(
    { scheme: 'file', language: doc.languageId },
    {
      provideInlineCompletionItems(_d, _p, ctx) {
        if (ctx.selectedCompletionInfo) seen = ctx.selectedCompletionInfo;
        return [];
      },
    },
  );
  await vscode.commands.executeCommand('editor.action.inlineSuggest.trigger');
  await sleep(700);
  d.dispose();
  return seen;
}

function describe(doc, sci, cursor) {
  const r = sci.range;
  const startChar = doc.getText(new vscode.Range(r.start, r.start.translate(0, 1)));
  const covered = doc.getText(r);
  const lineText = doc.lineAt(r.start.line).text;
  return {
    text: sci.text,
    range: `start=${pos2(r.start)} end=${pos2(r.end)}`,
    cursor: pos2(cursor),
    charAtRangeStart: startChar,
    coveredBufferText: covered,
    singleLine: r.start.line === r.end.line,
    line: lineText,
  };
}

suite(`WIDGETRANGE selectedCompletionInfo shape [${LANG}]`, () => {
  suiteSetup(async () => {
    // The product's own inline provider is irrelevant to this measurement and
    // its network round-trips only add noise, so it is off. The editor's inline
    // layer itself must stay on: it is what invokes the probe provider.
    const cfg = vscode.workspace.getConfiguration('column80');
    await cfg.update('enabled', false, vscode.ConfigurationTarget.Global);
    await vscode.workspace
      .getConfiguration('editor')
      .update('inlineSuggest.enabled', true, vscode.ConfigurationTarget.Global);
  });

  suiteTeardown(async () => {
    await vscode.workspace
      .getConfiguration('column80')
      .update('enabled', undefined, vscode.ConfigurationTarget.Global);
  });

  test('server is alive at the member site (SKIP marker if not)', async () => {
    await atSite(spec.dotSite.insert, async (doc, cursor) => {
      const s = await settled(() => completions(doc.uri, cursor), { timeoutMs: 60000 });
      const items = s.value && Array.isArray(s.value.items) ? s.value.items : [];
      console.log(
        `\n  [MEASURE ${LANG}] server-alive settled=${s.settled} items=${items.length} ms=${s.ms}` +
          (items.length ? '' : '  <-- SKIP: this row measured nothing'),
      );
    });
  });

  for (const state of statesFor(LANG)) {
    test(`${state.name}`, async () => {
      await atSite(state.insert, async (doc, cursor) => {
        // Settle the server first: these answer provisionally while indexing,
        // so a first non-empty list proves nothing about the widget.
        await settled(() => completions(doc.uri, cursor), { timeoutMs: 60000 });

        await vscode.commands.executeCommand('editor.action.triggerSuggest');
        await sleep(2500);

        // Nudge the selection so an item is definitely highlighted, then
        // sample. Retry: the widget can still be assembling.
        let sci = await sampleSci(doc);
        for (let i = 0; !sci && i < 8; i++) {
          await vscode.commands.executeCommand('selectNextSuggestion');
          await sleep(600);
          sci = await sampleSci(doc);
        }

        if (!sci) {
          console.log(
            `\n  [MEASURE ${LANG}] ${state.name}: DEAD PROBE - widget never delivered selectedCompletionInfo`,
          );
          return;
        }

        const d = describe(doc, sci, cursor);
        console.log(
          `\n  [MEASURE ${LANG}] ${state.name}\n` +
            `    text            = ${JSON.stringify(d.text)}\n` +
            `    range           = ${d.range}\n` +
            `    cursor          = ${d.cursor}\n` +
            `    charAtRangeStart= ${JSON.stringify(d.charAtRangeStart)}\n` +
            `    coveredBuffer   = ${JSON.stringify(d.coveredBufferText)}\n` +
            `    singleLine      = ${d.singleLine}\n` +
            `    lineText        = ${JSON.stringify(d.line)}\n` +
            `    separatorAtStart= ${d.charAtRangeStart === state.sep}`,
        );

        // Arrow once and re-sample, so a second highlighted member confirms the
        // shape is a property of the widget rather than of one item.
        await vscode.commands.executeCommand('selectNextSuggestion');
        await sleep(600);
        const sci2 = await sampleSci(doc);
        if (sci2) {
          const d2 = describe(doc, sci2, cursor);
          console.log(
            `    -- after one arrow --\n` +
              `    text            = ${JSON.stringify(d2.text)}\n` +
              `    range           = ${d2.range}\n` +
              `    charAtRangeStart= ${JSON.stringify(d2.charAtRangeStart)}\n` +
              `    singleLine      = ${d2.singleLine}`,
          );
        }
      });
    });
  }
});
