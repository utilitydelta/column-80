// session-v75 phase 1: what the two gates DO with a proposer reply.
//
// The arms are measured offline, at the proposer, by
// `session-v75/rig/proposer-replies.cjs`. That measurement stops one step short
// of the decision: deleting the worked example from the prompt takes type
// recall from 5 of 40 to 27 of 40 and makes the proposer talkative, and
// `tightenProposer.ts` says in its own header that talkative is fine because
// two deterministic gates downstream can reject everything it said. This file
// checks that claim instead of quoting it.
//
// WHY A HOST AND NOT A HEADLESS FAKE. Both halves of the answer belong to a
// live language server. Whether a proposed FUNCTION name is dropped depends on
// the SymbolKind a real provider returns for it, and whether the query budget
// binds depends on how many hits a real matcher gives back. A fake provider
// answers the fake.
//
// WHY THE REPLIES ARE REPLAYED. The model call is not under measurement here,
// the gates are, so each row is driven with the reply that model really gave on
// that arm. Replay makes the run deterministic and re-runnable, and it keeps
// the host tier's job to the part only a host can do.
//
// THE WORKSPACE IS THE CORPUS THE ITEMS CAME FROM. The dictation corpus was
// harvested from a real private Rust repo, so in that workspace every one of
// the 40 type names, 40 function names and 40 field names really exists, at its
// real kind, beside 489 files of real neighbours. A workspace where the junk
// names do not exist cannot produce the case: the gate would refuse them for
// the wrong reason and the run would report a clean bill it never earned.
// The path is read from the environment and never written down here.
//
// Run:
//   npm run build
//   C80_RUST_CORPUS=<the corpus> DISPLAY=:1 \
//     npx vscode-test --config test-vscode/v75gate.vscode-test.mjs --label v75gate

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vscode = require('vscode');
const P = require('./.build/product.js');

const EXT_ID = 'utilitydelta.column-80';
const ARMS = (process.env.C80_GATE_ARMS || 'control,no-example,example-as-data').split(',');
const REPLY_DIR = process.env.C80_GATE_REPLIES;
const OUT_DIR = process.env.C80_GATE_OUT;
const TAG = process.env.C80_GATE_TAG || 'v75-pre';
/** The reply log to replay. Separate from `TAG` so a re-run can grade the same
 *  replies into a differently named report. */
const IN_TAG = process.env.C80_GATE_IN_TAG || TAG;
const POPULATIONS = (process.env.C80_GATE_POPULATIONS || 'proposer,long').split(',');
const LIMIT = Number(process.env.C80_GATE_LIMIT || 0);
/** A name the workspace is known to define, used to decide the server is up.
 *
 *  NO DEFAULT, and that is a leak rule rather than a style choice. The corpus
 *  this rig is pointed at is a client repository, and a symbol name out of it
 *  is as identifying as its path. The path was already read from the
 *  environment; adversarial review caught the probe sitting here in plain text
 *  in a file bound for the public repo. A run without it fails loudly. */
const READY_PROBE = process.env.C80_GATE_PROBE;
const LANG = process.env.C80_GATE_LANG || 'rust';

/**
 * How the fixture comment and its declaration are spelled, per language.
 *
 * `decl` is the DECLARATION UNDER THE COMMENT and it is the half that decides
 * what the delta gate sees. An empty signature is the neutral case: the pre-fill
 * runs for real, and no name from the prose can reach the prompt through it, so
 * every candidate classifies as class 4 and the existence gate is measured
 * alone. `C80_GATE_DECL` overrides it, which is how the hero row is driven -
 * there the dictation has already written the types into the signature and the
 * delta gate is the thing under test.
 */
const FIXTURES = {
  rust: { prefix: '///', decl: 'pub fn v75_gesture_site() {}' },
  csharp: { prefix: '///', decl: 'public static void V75GestureSite() { }' },
  typescript: { prefix: '//', decl: 'export function v75GestureSite(): void {}' },
  go: { prefix: '//', decl: 'func V75GestureSite() {}' },
  python: { prefix: '#', decl: 'def v75_gesture_site():\n    pass' },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The file the dictated comment is written into: an existing module in an
 *  existing crate, appended to and restored. A NEW file is the trap that voided
 *  an earlier run on another server, and a file outside the module tree is one
 *  no Rust server will analyse. */
function pickTargetFile(root) {
  const named = process.env.C80_GATE_TARGET;
  if (named) {
    return path.join(root, named);
  }
  const crates = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => path.join(root, d.name, 'src', 'lib.rs'))
    .filter((p) => fs.existsSync(p));
  assert.ok(crates.length > 0, 'no crate with a src/lib.rs in the workspace, and no C80_GATE_TARGET naming a file');
  return crates.sort()[0];
}

// The main tier globs `*.test.js`, so this file is loaded by the five language
// labels too. It has no business running there: it needs a corpus workspace and
// a reply log, and without them it would fail in five places for the wrong
// reason. No reply directory means this is not the gate rig's host.
if (!REPLY_DIR) {
  suite('V75 the tighten gates (not this host)', function () {
    test('skipped: C80_GATE_REPLIES is unset, so this is not the gate rig host', function () {
      this.skip();
    });
  });
} else
suite('V75 the tighten gates, over replayed proposer replies', function () {
  let doc;
  let original;
  let targetFile;
  const report = { arms: {}, server: {} };

  suiteSetup(async function () {
    const ext = vscode.extensions.getExtension(EXT_ID);
    if (ext && !ext.isActive) await ext.activate();
    const root = vscode.workspace.workspaceFolders[0].uri.fsPath;
    targetFile = pickTargetFile(root);
    original = fs.readFileSync(targetFile, 'utf8');
    doc = await vscode.workspace.openTextDocument(vscode.Uri.file(targetFile));
    await vscode.window.showTextDocument(doc, { preview: false });

    // THE SERVER HAS TO BE UP BEFORE A SINGLE ROW RUNS. Every refusal this file
    // records would also be produced by a dead server, and the two are opposite
    // findings wearing the same word.
    assert.ok(READY_PROBE, 'C80_GATE_PROBE must name a symbol this workspace defines, or nothing can tell a loading server from a broken one');
    const deadline = Date.now() + 15 * 60 * 1000;
    let hits = [];
    for (;;) {
      hits = await P.defaultQuerySymbols(READY_PROBE);
      if (hits.some((h) => h.name === READY_PROBE)) break;
      assert.ok(Date.now() < deadline, `the symbol provider never answered about ${READY_PROBE}`);
      await sleep(5000);
    }
    report.server = { probe: READY_PROBE, hits: hits.length, kinds: [...new Set(hits.map((h) => h.kind))] };
    console.log(`server ready: ${READY_PROBE} -> ${hits.length} hits, kinds ${report.server.kinds.join(',')}`);
  });

  suiteTeardown(async function () {
    try {
      await restore();
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    } catch {}
    if (OUT_DIR) {
      fs.mkdirSync(OUT_DIR, { recursive: true });
      fs.writeFileSync(path.join(OUT_DIR, `${TAG}-gate.json`), JSON.stringify(report, null, 2));
      console.log(`wrote ${path.join(OUT_DIR, `${TAG}-gate.json`)}`);
    }
  });

  /** The buffer back to the bytes it started with, through the editor so the
   *  server sees the same document the test did. */
  async function restore() {
    const edit = new vscode.WorkspaceEdit();
    edit.replace(doc.uri, new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)), original);
    await vscode.workspace.applyEdit(edit);
  }

  /** The comment, and a declaration that names nothing, appended to the file.
   *  The declaration is there so the ONE pre-fill really runs and the delta
   *  gate reads a real ledger; its signature is empty so no corpus name can
   *  reach the prompt through it and change the class of a candidate. */
  async function place(prose, declOverride, template) {
    const fixture = FIXTURES[LANG];
    assert.ok(fixture, `no fixture shape for ${LANG}`);
    const comment = prose
      .split('. ')
      .map((s, i, all) => `${fixture.prefix} ${s}${i === all.length - 1 ? '' : '.'}`)
      .join('\n');
    const decl = declOverride ?? process.env.C80_GATE_DECL ?? fixture.decl;
    const block = `${comment}\n${decl}`;
    // APPEND BY DEFAULT, because a file the server already parses is the only
    // kind some servers will answer about. A row may hand over a whole-file
    // template instead, which is what the hero row needs: C# closes its class,
    // so a method appended past the last brace does not parse and the
    // declaration under the comment would not resolve.
    const text = template === undefined ? `${original}\n\n${block}\n` : template.split('__BLOCK__').join(block);
    const edit = new vscode.WorkspaceEdit();
    edit.replace(doc.uri, new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)), text);
    assert.ok(await vscode.workspace.applyEdit(edit), 'the fixture edit was refused');
    const at = doc.getText().indexOf(comment) + fixture.prefix.length + 2;
    return doc.positionAt(at);
  }

  async function runRow(row) {
    const position = await place(row.prose, row.decl, row.fileTemplate);
    const logs = [];
    const queries = [];
    const warns = [];
    let review;
    const wiring = {
      presenter: { confirmDiff: async () => 'accept' },
      resolveFunction: P.v75ResolveFunction,
      resolvePrefill: P.resolvePrefill,
      prefillLangFor: P.prefillLangFor,
      extractorFor: P.extractorFor,
      transport: () => async () => ({ text: row.reply }),
      modelTag: () => 'replay',
      tierGate: async () => ({ allowed: true }),
      tierMessage: () => undefined,
    };
    const deps = {
      querySymbols: async (q) => {
        const hits = await P.defaultQuerySymbols(q);
        queries.push({ q, hits: hits.length });
        return hits;
      },
      review: async (r) => {
        review = { rows: r.rows.map((x) => ({ kind: x.kind, label: x.label, detail: x.detail, checked: x.checked })), notes: [...r.notes] };
        return [];
      },
      applyEdit: async () => true,
      warn: (m) => warns.push(m),
    };
    const started = Date.now();
    const outcome = await P.tightenDocComment(doc, position, (l) => logs.push(l), wiring, deps);
    const ms = Date.now() - started;
    const spans = P.parseProposerReply(row.reply, row.prose);
    const claimLines = row.reply
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l !== '' && row.prose.includes(l));
    return {
      id: row.id,
      kind: row.kind,
      prose: row.prose,
      wanted: row.wanted ?? null,
      wantedSpans: row.wantedSpans ?? null,
      reply: row.reply,
      spans: spans.map((s) => s.phrase),
      claimLines: claimLines.length,
      capReached: spans.length >= P.PROPOSER_SPAN_CAP,
      status: outcome.status,
      rows: review ? review.rows : [],
      notes: review ? review.notes : [],
      strips: logs.filter((l) => l.startsWith('[tighten] strip:')).map((l) => l.slice('[tighten] strip: '.length)),
      candidates: logs.filter((l) => l.startsWith('[tighten] candidate ')),
      skips: logs.filter((l) => l.startsWith('[tighten] skip:')),
      queries,
      budgetSpent: queries.length,
      budgetBound: logs.some((l) => l.includes('query budget of')),
      warns,
      ms,
    };
  }

  for (const population of POPULATIONS) {
    for (const arm of ARMS) {
      test(`${population} / ${arm}`, async function () {
        const file = path.join(REPLY_DIR, `${IN_TAG}-${population === 'long' ? 'long' : 'proposer'}-${arm}.json`);
        const loaded = JSON.parse(fs.readFileSync(file, 'utf8'));
        const rows = LIMIT > 0 ? loaded.rows.slice(0, LIMIT) : loaded.rows;
        const out = [];
        for (const row of rows) {
          out.push(await runRow({ ...row, prose: row.prose }));
        }
        await restore();
        report.arms[`${population}/${arm}`] = out;
        // EVERY ROW THAT WRITES A NAME, not just the ones whose kind is
        // `backtick`. A span the developer spoke as "action executor" becomes
        // `ActionExecutor`, and that row's kind is `respell`. Counting only
        // `backtick` printed "0 offered" for a run that offered eleven.
        const offered = out.reduce((a, r) => a + r.rows.filter((x) => x.kind !== 'delete').length, 0);
        const spent = out.reduce((a, r) => a + r.budgetSpent, 0);
        console.log(
          `${population}/${arm}: ${out.length} rows, ${offered} name rows offered, ` +
            `${out.reduce((a, r) => a + r.strips.length, 0)} strips, ${spent} queries, ` +
            `budget bound on ${out.filter((r) => r.budgetBound).length}, cap reached on ${out.filter((r) => r.capReached).length}`,
        );
      });
    }
  }
});
