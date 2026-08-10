// END TO END against the real product, in a real extension host, with a real
// language server and a real model behind it. This is the only test in the repo
// that drives the human's actual gesture:
//
//   widget open at a member site -> arrow to a KNOWN member -> Escape -> Tab
//   -> the buffer must name the member that was highlighted
//
// Promoted from `scout-v19/e2e.spike.js`, which ran against TypeScript only.
// Rust was the first language tried outside that population and it broke
// immediately, on a shape TypeScript structurally cannot produce. So this runs
// per language off `C80_LANG`, driven by `gestureSite` in the spec row.
//
// Run:  npm run test:vscode -- --label ts     (and csharp, python, rust)
//
// ## What the family is for
//
// `gestureSite.family` is three members whose names are prefixes of each other
// (`enroll` -> `enrollTile` -> `enrollBatch`). Serving `enrollTile` where the
// user highlighted `enroll` is the exact defect this feature exists to prevent,
// and a member set without prefix sharing cannot detect it. Their arities differ
// (1, 2, 3), so a wrong pick shows up in the landed call text as well as in the
// name.
//
// ## The control, and where each half of it lives
//
// The IN-FILE control is `CONTROL: the reader tells prefix-sharing siblings
// apart`. It is the cheap half and it runs first, with no server involved: it
// feeds the reader the buffer line each family member would produce and asserts
// the reader returns that member and refuses the other two. It exists because a
// containment reader - does the line contain the target? - calls a line that
// landed `enrollTile` a correct `enroll`, so a probe built that way reports
// green while the product serves the wrong sibling. The control pins the trap
// from both sides on one line, so a future edit cannot quietly relax the reader
// back into it.
//
// The EXTERNAL control is the one that proved the greens are evidence: this same
// gesture against the BASE commit source, rebuilt. Base landed `s.enroll(1)` for
// every highlighted member, so the probe demonstrably detects a wrong member.
// That control cannot live in this file - it needs a different product build -
// and it is recorded in `session-v19/progress.md` under 2026-07-21.
//
// ## Why nothing landing is a failure here
//
// The spike asserted the member name only when something committed, and treated
// an empty commit as a soft note. A completely dead feature passes that: nothing
// commits, nothing is compared, mocha exits 0. The contract is `gestureSite.lands`
// in the spec row, `true` on all four today, and an empty commit fails the row
// and says so. A language that legitimately serves nothing declares it there with
// a reason.
//
// ## Dead probe vs absent server
//
// These are different outcomes and the file keeps them apart, because collapsing
// them is how an absent instrument gets read as a clean run.
//
//  - The server never answers at the gesture site: SKIP, reported as a skip.
//  - The server answers but the widget never delivers `selectedCompletionInfo`:
//    DEAD PROBE, a loud failure. Nothing below it is evidence.
//
// The liveness signal is `selectedCompletionInfo` ARRIVING, never
// `window.state.focused`. Measured: focus reads false on this box while the
// widget opens and delivers normally, so gating on focus rejects good runs,
// which is the mirror of the failure the gate exists to prevent.

'use strict';

const assert = require('assert');
const vscode = require('vscode');
const { SPECS } = require('./helpers/specs');
const { LANG, open, sleep, settled, completions, itemsOf, labelOf, report } = require('./helpers/probe');

const spec = SPECS[LANG];
const site = spec.gestureSite;
const FAMILY = site.family;

// `insert` is a newline plus indentation plus the receiver, e.g. "\n    stripe.".
// Trimmed it is the receiver text the landed line must carry.
const RECEIVER = site.insert.trim();

// Wide enough for all four languages at once. `$` is TypeScript-only and `_` is
// everywhere; nothing in the four dogfood repos needs more.
const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*/;

// The member name inside whatever the widget put in `selectedCompletionInfo.text`.
// Three measured shapes reach this: TypeScript at an empty partial leads with the
// separator (".band"), C#, Python and rust-analyzer under `callable.snippets:
// "none"` hand back a bare name, and rust-analyzer under "fill_arguments" hands
// back a RENDERED ARGUMENT LIST ("from_morton(morton_code, lod)"). All three
// reduce to the same identifier.
function widgetMember(text) {
  const m = IDENT.exec(String(text).replace(/^[.:]+/, ''));
  return m ? m[0] : null;
}

// True when the widget text is a rendered call rather than a bare name. This is
// the S10 shape, and the product deliberately serves NO ghost while the widget is
// open under it, holding the scope for the Escape. Recorded per run rather than
// assumed from the language, because it is a server SETTING and rust-scratch can
// change it without this file knowing.
const isRenderedCall = (text) => {
  const bare = String(text).replace(/^[.:]+/, '');
  return widgetMember(bare) !== bare;
};

// The member the buffer names on the probe line. Reads the identifier that
// directly follows the receiver, and nothing else: `enroll` and `enrollTile` are
// distinguishable only by taking the WHOLE run.
function memberOnLine(line) {
  const i = line.indexOf(RECEIVER);
  if (i < 0) return null;
  const m = IDENT.exec(line.slice(i + RECEIVER.length));
  return m ? m[0] : null;
}

// Settle the server at the gesture site. `settled`'s default readiness test is
// "not null", and a CompletionList is a non-null object even when it holds zero
// items, so an unwarmed server would read as ready instantly and the row would
// grade an empty widget. Readiness here is a NON-EMPTY item list.
const settledItems = (doc, cursor) =>
  settled(() => completions(doc.uri, cursor), {
    ready: (v) => itemsOf(v).length > 0,
    timeoutMs: 60000,
  });

// --- site handling -----------------------------------------------------------

// Apply the probe edit at the checked-in anchor, park the cursor at its end, run,
// and always revert. Nothing is saved, so the server sees a dirty buffer, which
// is what it sees while a human types.
//
// The probe line is tracked by LINE NUMBER, not by searching for the receiver
// text. Three of the four dogfood repos carry the anchor call on the line above,
// which starts with the same receiver, so a text search reads the anchor and
// reports the gesture as having landed `enroll` no matter what the product did.
async function atGestureSite(fn) {
  const doc = await open(spec, site.file);
  // Full pristine text, the probe.js withInsertion discipline: this drive
  // COMMITS ghosts (Tab), and the product's accept path saves the buffer
  // before its oracle check, so `files.revert` alone would restore to a
  // disk state the drive itself just polluted. A committed half-open
  // composite literal then breaks the whole Go package for every later
  // suite (session-v23, measured).
  const pristine = doc.getText();
  const wasDirty = doc.isDirty;
  const anchorIdx = pristine.indexOf(site.anchor);
  if (anchorIdx < 0) {
    throw new Error(`gestureSite anchor not found in ${site.file}: ${JSON.stringify(site.anchor)}`);
  }
  const base = anchorIdx + site.anchor.length;
  const edit = new vscode.WorkspaceEdit();
  edit.insert(doc.uri, doc.positionAt(base), site.insert);
  try {
    if (!(await vscode.workspace.applyEdit(edit))) throw new Error('applyEdit refused the probe edit');
    const cursor = doc.positionAt(base + site.insert.length);
    const ed = await vscode.window.showTextDocument(doc, { preview: false });
    ed.selection = new vscode.Selection(cursor, cursor);
    await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
    await sleep(400);
    return await fn(doc, cursor);
  } finally {
    await vscode.commands.executeCommand('hideSuggestWidget');
    await vscode.window.showTextDocument(doc, { preview: false });
    if (doc.getText() !== pristine) {
      const restore = new vscode.WorkspaceEdit();
      restore.replace(doc.uri, new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)), pristine);
      await vscode.workspace.applyEdit(restore);
      if (!wasDirty) await doc.save();
    }
    await sleep(200);
  }
}

// One sample of what the widget is currently handing the inline layer. The probe
// provider is registered only for the duration of the sample so it never competes
// with the product's own provider for longer than it has to.
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
  await sleep(600);
  d.dispose();
  return seen;
}

// Arrow until the HIGHLIGHTED item is the target. Never arrow a fixed number of
// times: the widget sorts alphabetically, so the family lists as `enroll`,
// `enrollBatch`, `enrollTile` and a fixed count lands on a different member than
// the one the test names.
//
// The bound is the ITEM COUNT the server settled on, doubled, and never less
// than 40. Two full cycles of the list is enough for any starting selection, and
// the widget does not always start at the top: rust-analyzer's 30-item list has
// been measured opening on the fourth entry.
//
// A repeated name is deliberately NOT treated as proof the list wrapped. Samples
// arrive stale and out of order under a busy inline layer, so an earlier name
// reappearing is routine; keying the bound off it aborted the rust walk after 14
// of 30 items and reported a live widget as a dead probe.
// The widget is also re-opened while nothing has been seen at all. `triggerSuggest`
// does not always open it - measured against Roslyn, which can be busy at the
// moment the command fires - and arrowing an unopened widget does nothing, so a
// single failed open otherwise burns the whole walk and reports a live server as
// a dead probe.
async function selectByName(doc, target) {
  const seen = [];
  const cap = Math.max(40, row.items * 2);
  for (let i = 0; i < cap; i++) {
    if (seen.length === 0 && i > 0 && i % 8 === 0) {
      await vscode.commands.executeCommand('editor.action.triggerSuggest');
      await sleep(2000);
    }
    const sci = await sampleSci(doc);
    if (sci) {
      const name = widgetMember(sci.text);
      if (name && seen[seen.length - 1] !== name) seen.push(name);
      if (name === target) return { sci, seen };
    }
    await vscode.commands.executeCommand('selectNextSuggestion');
    await sleep(350);
  }
  return { sci: null, seen };
}

// --- row liveness ------------------------------------------------------------

// Filled by suiteSetup. `items` is what the server returned at the gesture site
// once settled; `missing` is the family members it never offered.
const row = { items: 0, missing: FAMILY.slice(), settled: false, ms: 0 };
const landed = [];

const serverAbsent = () => row.items === 0;

suite(`GESTURE sticky selection end to end [${LANG}]`, () => {
  suiteSetup(async function () {
    // The configuration the defects lived in: product on, member gate armed,
    // compiler-directed injection on. The gate is TS, C# and Python only - rust
    // is deliberately ungated in the product because rust-analyzer serves
    // keyword and postfix completions at a `.` site, so the rust row exercises a
    // different gate configuration from the other three by design.
    const cfg = vscode.workspace.getConfiguration('column80');
    await cfg.update('enabled', true, vscode.ConfigurationTarget.Global);
    await cfg.update('fimMemberGate', true, vscode.ConfigurationTarget.Global);
    await cfg.update('compilerDirectedInjection', true, vscode.ConfigurationTarget.Global);
    await vscode.workspace
      .getConfiguration('editor')
      .update('inlineSuggest.enabled', true, vscode.ConfigurationTarget.Global);

    // Settle the server before anything else. These answer provisionally while
    // indexing, so a first non-empty list proves nothing.
    await atGestureSite(async (doc, cursor) => {
      const s = await settledItems(doc, cursor);
      // Labels are not bare identifiers everywhere: rust-analyzer renders a
      // method as `enroll(…)`. Reduce both sides to the identifier run, which is
      // the same normalisation the widget text goes through.
      const names = itemsOf(s.value).map((it) => widgetMember(labelOf(it)));
      row.items = names.length;
      row.settled = s.settled;
      row.ms = s.ms;
      row.missing = FAMILY.filter((f) => !names.includes(f));
    });
    report('server at the gesture site', [
      `items=${row.items} settled=${row.settled} ms=${row.ms}`,
      `family=${JSON.stringify(FAMILY)} missing=${JSON.stringify(row.missing)}`,
    ]);
  });

  suiteTeardown(async () => {
    const cfg = vscode.workspace.getConfiguration('column80');
    for (const k of ['enabled', 'fimMemberGate', 'compilerDirectedInjection']) {
      await cfg.update(k, undefined, vscode.ConfigurationTarget.Global);
    }
    report('landed buffer text, one row per family member', landed.length ? landed : ['(none)']);
  });

  // The in-file control. No server, no model, no widget: it grades the reader
  // this file's verdicts rest on. If the reader cannot tell `enroll` from
  // `enrollTile` in a buffer line, every assertion below is decoration.
  test('CONTROL: the reader tells prefix-sharing siblings apart', () => {
    const indent = site.insert.replace(/^\n/, '').slice(0, -RECEIVER.length);
    for (const member of FAMILY) {
      const line = `${indent}${RECEIVER}${member}(1)`;
      assert.strictEqual(
        memberOnLine(line), member,
        `reader misread its own family member in ${JSON.stringify(line)}`,
      );
      for (const other of FAMILY.filter((f) => f !== member)) {
        assert.notStrictEqual(
          memberOnLine(line), other,
          `reader confused ${member} with ${other} in ${JSON.stringify(line)}`,
        );
      }
    }
    // The trap, asserted from both sides on one line. A line that landed the
    // LONGEST family member also contains the shortest one as a substring, so a
    // reader written as `line.includes(target)` calls that line a correct
    // `enroll` and never reports the wrong sibling it is actually looking at.
    // The first assertion pins that the trap is real on this row's names; the
    // second pins that the reader in use does not fall into it.
    const shortest = FAMILY.reduce((a, b) => (a.length <= b.length ? a : b));
    const longest = FAMILY.reduce((a, b) => (a.length >= b.length ? a : b));
    const wrongSibling = `${RECEIVER}${longest}(1, 2, 3)`;
    assert.ok(
      wrongSibling.includes(shortest),
      `this family does not share a prefix: ${JSON.stringify(FAMILY)} cannot detect a wrong sibling`,
    );
    assert.strictEqual(
      memberOnLine(wrongSibling), longest,
      `reader accepted ${shortest} on a line that landed ${longest}`,
    );
  });

  test('the server serves the whole family at the gesture site', function () {
    if (serverAbsent()) {
      this.skip(); // SKIP, not a pass: this row measured nothing.
    }
    assert.deepStrictEqual(
      row.missing, [],
      `the server answered with ${row.items} items but never offered ${JSON.stringify(row.missing)}. ` +
        'The gesture cannot be graded against members the widget will not show.',
    );
  });

  test('SMOKE: the widget delivers selectedCompletionInfo', async function () {
    if (serverAbsent()) this.skip();
    const shape = await atGestureSite(async (doc, cursor) => {
      await settledItems(doc, cursor);
      await vscode.commands.executeCommand('editor.action.triggerSuggest');
      await sleep(2500);
      let sci = await sampleSci(doc);
      for (let i = 0; !sci && i < 8; i++) {
        await vscode.commands.executeCommand('selectNextSuggestion');
        await sleep(500);
        sci = await sampleSci(doc);
      }
      return sci;
    });
    report('widget shape', [
      `selectedCompletionInfo.text = ${shape ? JSON.stringify(shape.text) : '(never delivered)'}`,
      `renderedArgumentList = ${shape ? isRenderedCall(shape.text) : 'n/a'}`,
      `window.state.focused = ${vscode.window.state.focused} (not the liveness signal, recorded only)`,
    ]);
    assert.ok(
      shape,
      'PROBE DEAD: the server answered but the widget never delivered selectedCompletionInfo. ' +
        'Nothing below this line is evidence about the product.',
    );
  });

  for (const target of FAMILY) {
    test(`arrow to ${target}, Escape, Tab -> the buffer must name ${target}`, async function () {
      if (serverAbsent()) this.skip();

      const result = await atGestureSite(async (doc, cursor) => {
        const line = cursor.line;
        await settledItems(doc, cursor);

        // A ghost on screen first, which is the realistic starting state.
        await vscode.commands.executeCommand('editor.action.inlineSuggest.trigger');
        await sleep(3000);

        await vscode.commands.executeCommand('editor.action.triggerSuggest');
        await sleep(2500);

        const picked = await selectByName(doc, target);
        if (!picked.sci) return { picked, line: null, name: null, text: null, committed: false };

        // Give the scoped generation time to come back from a real model.
        await sleep(4000);

        await vscode.commands.executeCommand('hideSuggestWidget');
        await sleep(500);

        // Tab, polled tightly. Re-timed under the human design call
        // 2026-07-26 (session-v26/journeys/member-dot-flow.md): the 1.5s
        // window is UNIFORM, so the arrowed ghost lives 1500ms from its
        // post-Escape serve and then the unconstrained rerun replaces it BY
        // DESIGN. The old shape slept 2s and retried on 1.5-2.5s steps,
        // which Tabs after the expiry swap and grades the rerun instead of
        // the arrowed ghost. A 500ms poll lands the commit well inside the
        // window wherever generation latency puts the serve, while the retry
        // budget still covers a slow model's fresh generation - the false
        // negative the old comment guarded against.
        const before = doc.getText();
        let committed = false;
        for (let i = 0; i < 30 && !committed; i++) {
          await vscode.commands.executeCommand('editor.action.inlineSuggest.commit');
          await sleep(500);
          committed = doc.getText() !== before;
        }

        const text = doc.lineAt(line).text;
        return { picked, line: text.trim(), name: memberOnLine(text), text: picked.sci.text, committed };
      });

      const { picked } = result;
      landed.push(
        `${target}: committed=${result.committed} landed=${JSON.stringify(result.name)} ` +
          `line=${JSON.stringify(result.line)} widgetText=${JSON.stringify(result.text)}`,
      );
      report(`gesture ${target}`, [
        `widget walked through ${JSON.stringify(picked.seen)}`,
        `selectedCompletionInfo.text = ${JSON.stringify(result.text)}`,
        `renderedArgumentList = ${result.text === null ? 'n/a' : isRenderedCall(result.text)}`,
        `committed = ${result.committed}`,
        `landed line = ${JSON.stringify(result.line)}`,
        `landed member = ${JSON.stringify(result.name)}`,
      ]);

      assert.ok(
        picked.sci,
        `PROBE DEAD: the widget never highlighted ${target}. Walked ${JSON.stringify(picked.seen)}. ` +
          'This is a probe failure, not a verdict about the product.',
      );

      // The honest contract, per `gestureSite.lands` in the spec row. An empty
      // commit is a distinct, loud outcome from the right member landing; it is
      // never silently green.
      if (site.lands) {
        assert.ok(
          result.committed,
          `NOTHING LANDED: highlighted ${target}, Escape then Tab committed no edit at all. ` +
            `The spec row declares gestureSite.lands=true for ${LANG}, so this is a failure, ` +
            'not a weaker pass. Declare gestureSite.lands=false with a landsPending reason if ' +
            'this row is genuinely expected to serve nothing.',
        );
      } else if (!result.committed) {
        report(`gesture ${target}`, [`NOTHING LANDED, declared expected: ${site.landsPending}`]);
        return;
      }

      assert.strictEqual(
        result.name, target,
        `WRONG MEMBER: the widget highlighted ${target}, the buffer reads ${JSON.stringify(result.line)}. ` +
          'Serving a prefix-sharing sibling is the defect this gesture exists to prevent.',
      );
    });
  }
});

// ===========================================================================
// v20: the PASSIVE preselect's window, and the second Escape that closes it
// early. Both promise the same end state - the ghost stops naming the member
// the widget guessed and starts naming the model's own answer - and neither
// had a test in real VS Code. Three dogfood rounds went into diagnosing them
// from the output channel, twice wrongly, because nothing here could say what
// the editor actually drew.
//
// The oracle is the buffer after Tab, not the ghost on screen. There is no API
// to read rendered inline text, and what lands is what the developer gets.
// ===========================================================================

suite(`v20 preselect window and second Escape [${LANG}]`, () => {
  // The widget's own first pick at this site, whatever it is. The rows below
  // never arrow, so this is the member v20 must stop scoping to.
  let preselect = null;

  // Open the widget without arrowing, close it, and hand back what the widget
  // had highlighted plus the line the buffer ends up with after Tab. `settle`
  // runs between closing the widget and pressing Tab, which is where a row
  // puts its wait or its dismissal.
  const passiveThenTab = async (settle) =>
    atGestureSite(async (doc, cursor) => {
      const line = cursor.line;
      await settledItems(doc, cursor);
      await vscode.commands.executeCommand('editor.action.inlineSuggest.trigger');
      await sleep(3000);
      await vscode.commands.executeCommand('editor.action.triggerSuggest');
      await sleep(2500);
      const sci = await sampleSci(doc);
      // The first Escape: the widget goes, and v20 promises the ghost stays.
      await vscode.commands.executeCommand('hideSuggestWidget');
      await sleep(1200);

      await settle();

      const before = doc.getText();
      let committed = false;
      for (let i = 0; i < 4 && !committed; i++) {
        await vscode.commands.executeCommand('editor.action.inlineSuggest.commit');
        await sleep(1500);
        committed = doc.getText() !== before;
        if (!committed) await sleep(2500);
      }
      const text = doc.lineAt(line).text;
      return { sci, committed, line: text.trim(), name: memberOnLine(text) };
    });

  test('CONTROL: a passive preselect Tabs in as itself while its window is open', async function () {
    if (serverAbsent()) this.skip();
    const r = await passiveThenTab(async () => {});
    preselect = r.sci ? widgetMember(r.sci.text) : null;
    report('v20 passive control', [
      `widget preselected ${JSON.stringify(preselect)}`,
      `committed = ${r.committed}`,
      `landed line = ${JSON.stringify(r.line)}`,
      `landed member = ${JSON.stringify(r.name)}`,
    ]);
    assert.ok(r.sci, 'the widget delivered no selectedCompletionInfo, so there is no preselect to be sticky about');
    assert.ok(
      r.committed,
      'NOTHING LANDED after a passive preselect and one Escape. v19 threw this ghost away and v20 exists to keep it; ' +
        'a passive Escape that commits nothing is the exact defect this session was opened for.',
    );
    assert.strictEqual(
      r.name,
      preselect,
      `inside its window the passive scope still governs, so Tab must land ${JSON.stringify(preselect)}`,
    );
  });

  test('the 1500ms window closes on its own: waiting past it Tabs in the model answer, not the widget guess', async function () {
    if (serverAbsent()) this.skip();
    // Well past PASSIVE_SCOPE_MS, and the expiry asks the editor to re-render
    // rather than waiting for a keystroke, so the ghost under the cursor at
    // the end of this wait is the unscoped one.
    const r = await passiveThenTab(async () => sleep(4000));
    const rowPreselect = r.sci ? widgetMember(r.sci.text) : null;
    report('v20 window expiry', [
      `widget preselected ${JSON.stringify(rowPreselect)}`,
      `committed = ${r.committed}`,
      `landed line = ${JSON.stringify(r.line)}`,
      `landed member = ${JSON.stringify(r.name)}`,
    ]);
    assert.ok(r.sci, 'no preselect was delivered, so nothing was on a clock');
    assert.ok(
      r.committed,
      'NOTHING LANDED after the window closed. The revert is meant to swap the ghost, not remove it: ' +
        'an expiry that leaves the developer with nothing to Tab is worse than the scope it replaced.',
    );
    // Strengthened 2026-07-26 (review-p34.md finding 2): this row's title
    // promised the swap but asserted only that SOMETHING committed, so it
    // stayed green while a bare-trigger expiry re-rendered the stale scoped
    // ghost. The landed member must differ from the widget's guess.
    if (rowPreselect !== null) {
      assert.notStrictEqual(
        r.name,
        rowPreselect,
        'the expiry must land the model\'s own answer, not the widget guess; ' +
          'landing the preselect means platform preservation overrode the swap',
      );
    }
  });

  test('the second Escape closes the window early and lands the same thing waiting would', async function () {
    if (serverAbsent()) this.skip();
    // The command the Escape keybinding runs. Invoked directly: what a keypress
    // resolves to is VS Code's business and is guarded by the `when` clause,
    // and this row is about what the command DOES.
    const r = await passiveThenTab(async () => {
      await vscode.commands.executeCommand('column80.dismissScopedGhost');
      await sleep(2500);
    });
    const rowPreselect = r.sci ? widgetMember(r.sci.text) : null;
    report('v20 second escape', [
      `widget preselected ${JSON.stringify(rowPreselect)}`,
      `committed = ${r.committed}`,
      `landed line = ${JSON.stringify(r.line)}`,
      `landed member = ${JSON.stringify(r.name)}`,
    ]);
    assert.ok(r.sci, 'no preselect was delivered, so there was no scope to dismiss');
    assert.ok(
      r.committed,
      'NOTHING LANDED after the second Escape. This is the dogfood report the fix was written for: ' +
        'the scope is dropped and the developer is left with no ghost at all.',
    );
    // Strengthened 2026-07-26 (review-p34.md finding 2), same one-line check
    // as the expiry row: the dismissal exists to swap the ghost.
    if (rowPreselect !== null) {
      assert.notStrictEqual(
        r.name,
        rowPreselect,
        'the expiry must land the model\'s own answer, not the widget guess; ' +
          'landing the preselect means platform preservation overrode the swap',
      );
    }
  });
});

// ===========================================================================
// Does arrowing the widget re-invoke the PRODUCT provider on its own?
//
// Nothing above answers that. `sampleSci` fires `inlineSuggest.trigger` after
// every arrow, so every row here has been measuring what happens once the
// provider is invoked, never whether the editor invokes it. A dogfood report
// that TypeScript and C# do not re-render on up/down while Rust does is exactly
// the gap that leaves, and it is per-language, so a per-language tier is where
// it belongs.
//
// The instrument is the extension's own log, teed to C80_LOG_FILE. A test
// cannot see into the extension host's output channel, but it can read that
// file.
//
// It counts `[fim] invoked` lines, NOT lines. `[fim] invoked` is the provider's
// first statement, written before anything can return, so its count is the
// number of invocations exactly. A line count is hostage to how many lines a
// path happens to write - four per generation, three per cache hit, measured -
// and to anything else sharing the channel.
// ===========================================================================

const fs = require('fs');

// Three states, and they must stay apart. Collapsing them is how a missing
// instrument gets read as a measurement, which is the failure goal item 13 cost
// ten dogfood rounds to learn.
//
//  - UNSET: no tee asked for. `null`, and the rows skip WITH A REASON.
//  - ARMED, file absent: the tee creates it lazily on the first line, so before
//    the extension writes anything there is genuinely nothing. Zero.
//  - ARMED, unreadable: a permission or path fault. That is a broken harness
//    and it throws, rather than reporting a number nobody can defend.
const NO_INSTRUMENT = null;

const invocations = () => {
  const p = process.env.C80_LOG_FILE;
  if (!p) return NO_INSTRUMENT;
  let text;
  try {
    text = fs.readFileSync(p, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return 0;
    throw new Error(`C80_LOG_FILE is set to ${p} but cannot be read: ${err.message}`);
  }
  return (text.match(/^\[fim\] invoked\b/gm) ?? []).length;
};

suite(`widget arrow re-invocation [${LANG}]`, () => {
  // `ghostFirst` is the whole experiment. With a ghost already on screen the
  // editor has a live inline session and re-requests on every selection change.
  // With the widget opening FIRST - which is what the `.` trigger character
  // does by default - there may be no session to re-request for, and that is
  // the difference between a workspace that sets suggestOnTriggerCharacters
  // false (Rust, here) and every workspace that does not.
  const arrowDeltas = (ghostFirst) =>
    atGestureSite(async (doc, cursor) => {
      await settledItems(doc, cursor);
      if (ghostFirst) {
        await vscode.commands.executeCommand('editor.action.inlineSuggest.trigger');
        await sleep(3000);
      }
      await vscode.commands.executeCommand('editor.action.triggerSuggest');
      await sleep(2500);

      const out = [];
      for (let i = 0; i < 3; i++) {
        const before = invocations();
        // The arrow, and NOTHING else. No inlineSuggest.trigger: whether the
        // editor re-requests is the whole question.
        await vscode.commands.executeCommand('selectNextSuggestion');
        await sleep(2500);
        const after = invocations();
        // Still nothing on disk at the LAST read means the extension never
        // wrote a line all run, so the tee was never created and there is no
        // measurement here. Loud, because the alternative is a `[0,0,0]` whose
        // failure message announces the editor-version floor.
        if (i === 2 && after === 0) {
          throw new Error(
            `C80_LOG_FILE (${process.env.C80_LOG_FILE}) was never created: the extension wrote no ` +
              'log line during the whole drive, so these arrows measured nothing',
          );
        }
        out.push(after - before);
      }
      return out;
    });

  test('arrowing re-invokes the provider when a ghost was already on screen', async function () {
    if (serverAbsent()) this.skip();
    if (invocations() === NO_INSTRUMENT) {
      // Named, not bare: a lone `-` in the tier output is indistinguishable
      // from a harness fault, and this row is the one that reports whether the
      // editor re-requests at all.
      report('arrow re-invocation', ['SKIPPED: C80_LOG_FILE is unset, so there is no instrument']);
      this.skip();
    }
    const deltas = await arrowDeltas(true);
    report('arrow re-invocation, ghost first', [
      `provider invocations after each of three arrows: ${JSON.stringify(deltas)}`,
      'zero means the editor did not re-request, so the ghost cannot follow the highlight',
    ]);
    assert.ok(
      deltas.some((d) => d > 0),
      `arrowing the widget produced NO provider activity at all (${JSON.stringify(deltas)}). ` +
        'The scoped-ghost gesture needs the editor to re-request on every selection change; ' +
        'without it the ghost is frozen on whichever member was highlighted first.',
    );
  });

  test('arrowing re-invokes the provider when the WIDGET opened first, which is what typing a dot does', async function () {
    if (serverAbsent()) this.skip();
    if (invocations() === NO_INSTRUMENT) {
      // Named, not bare: a lone `-` in the tier output is indistinguishable
      // from a harness fault, and this row is the one that reports whether the
      // editor re-requests at all.
      report('arrow re-invocation', ['SKIPPED: C80_LOG_FILE is unset, so there is no instrument']);
      this.skip();
    }
    const deltas = await arrowDeltas(false);
    report('arrow re-invocation, widget first', [
      `provider invocations after each of three arrows: ${JSON.stringify(deltas)}`,
      'this is the ORDER a developer gets by default: the dot opens the widget before any ghost exists',
    ]);
    assert.ok(
      deltas.some((d) => d > 0),
      `arrowing produced NO provider activity when the widget opened before any ghost existed ` +
        `(${JSON.stringify(deltas)}). Dogfooded: the ghost does not follow the highlight in any language ` +
        'whose workspace lets the dot open the widget. Setting editor.suggestOnTriggerCharacters false ' +
        'is what makes Rust look like it works.',
    );
  });
});
