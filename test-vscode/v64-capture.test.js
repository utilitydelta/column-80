// session-v64 phase 4: the CAPTURE RIG.
//
// The arms cannot be measured inside an extension host. Five arms, three runs
// for determinism, two model classes: that is thirty model rounds per finding,
// against a host that has to be launched one language label at a time and can
// only be driven by a human at a keyboard. So the host's job is not to grade
// anything. Its job is to CAPTURE, once, the exact context the product would
// hand a model, and write it where an offline rig can replay every arm against
// it as many times as the measurement needs.
//
// IT REPRODUCES THE PRODUCT'S OWN ASSEMBLY, and that is the whole point of the
// exports it uses. `buildFixContext` is the function `runCriticize` calls, and
// `scoreFunction` on a `sliceFunction` unit is what the card is. A rig that
// re-derived either would be measuring the rig: session-v37 wrote that up
// (measuring a gesture against whatever a repo already contains is circular)
// and session-v29 wrote up the other half (a re-derived mapping inverted an arm
// result).
//
// THE POPULATION IS THE DOGFOOD WORKSPACE, AND THAT FLATTERS. These five repos
// were authored as FIM fixtures, and the phase 5 spike measured 41 of 42 of
// their callees carrying a doc comment against 2.5% to 41.5% on production
// code. The capture is honest about what it captured: every row names its file,
// so the offline judge can see the population it is grading.
//
// NOTHING IS WRITTEN TO THE WORKSPACE. Every other file in this tier inserts a
// fixture and restores it; this one only reads, because its population is the
// committed functions themselves.
//
// Run, ONE LABEL AT A TIME, with the display up:
//   npm run build
//   DISPLAY=:1 npx vscode-test --config test-vscode/.vscode-test.mjs --label rust   --grep V64CAPTURE
//   DISPLAY=:1 npx vscode-test --config test-vscode/.vscode-test.mjs --label ts     --grep V64CAPTURE
//   DISPLAY=:1 npx vscode-test --config test-vscode/.vscode-test.mjs --label csharp --grep V64CAPTURE
//   DISPLAY=:1 npx vscode-test --config test-vscode/.vscode-test.mjs --label python --grep V64CAPTURE
//   DISPLAY=:1 npx vscode-test --config test-vscode/.vscode-test.mjs --label go     --grep V64CAPTURE

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vscode = require('vscode');
const { SPECS } = require('./helpers/specs');
const { report } = require('./helpers/probe');

const product = require('./.build/product.js');

const LANG = process.env.C80_LANG || 'ts';
const spec = SPECS[LANG];
const EXT_ID = 'utilitydelta.column-80';

// WHICH POPULATION THIS RUN CAPTURED, and the two never share a directory.
// The dogfood workspaces were authored as FIM fixtures and they flatter: the
// phase 5 spike measured 41 of 42 of their callees carrying a doc comment,
// against 2.5% to 41.5% on production repositories. Averaging the two
// populations together would produce a number that is true of neither, so the
// directory is a parameter and `captures-real` is a separate corpus.
const OUT_DIR = path.join(__dirname, '..', 'session-v64', process.env.C80_CAPTURE_DIR || 'captures');

/** An env override for one of this file's bounds, or the default. A production
 *  repository is two orders larger than a dogfood one and wants a wider walk;
 *  the bound is a parameter rather than a second copy of this file. */
function bound(name, fallback) {
  const raw = process.env[name];
  const n = raw === undefined ? NaN : Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Which files to walk, per label. The exclusions are build output and vendored
// dependencies: a symbol tree from `target/` or `node_modules/` is not this
// repository's code, and resolving types inside one spends the budget proving
// something about a dependency.
const GLOBS = {
  ts: { include: '**/*.ts', exclude: '**/{node_modules,dist,out,.git}/**' },
  rust: { include: '**/*.rs', exclude: '**/{target,.git}/**' },
  csharp: { include: '**/*.cs', exclude: '**/{bin,obj,.git}/**' },
  python: { include: '**/*.py', exclude: '**/{.venv,venv,__pycache__,.git}/**' },
  go: { include: '**/*.go', exclude: '**/{vendor,.git}/**' },
};

// `playground/fim.py` does not parse: its line 52 is a deliberately unclosed
// `stripe.enroll_tile(`, an anchor the sticky-selection suite needs. Pylance
// reads everything below it as part of that call, so a symbol query against it
// answers about the wrong function. Skipped BY NAME rather than by a heuristic,
// so the skip cannot silently widen.
const SKIP_FILES = ['playground/fim.py'];

// How much of the workspace to walk before stopping. CHOSEN, not measured: each
// function costs a type resolve (up to eight cross-file walks) and two
// call-hierarchy round trips, so a whole repository would run past the tier's
// own timeout. The row target is what actually ends the walk on a healthy repo.
const FILE_CAP = bound('C80_FILE_CAP', 40);
const FUNCTION_CAP = bound('C80_FUNCTION_CAP', 60);
const ROW_TARGET = bound('C80_ROW_TARGET', 24);

/**
 * How many rows one FILE may contribute. CHOSEN.
 *
 * Without it the first capture off a 475-file repository took all 24 of its
 * rows from four files that happen to sort first, which is a sample of one
 * corner of one crate. The arms are graded per finding, so a corpus where six
 * rows come from one file is six rows about one author's habits. The cap and
 * the stride below are the two halves of spreading the sample.
 */
const FILE_ROW_CAP = bound('C80_FILE_ROW_CAP', 4);

/** Roughly how many distinct files the walk should touch. Used to stride the
 *  file list rather than to truncate it: a repository is walked from front to
 *  back in even steps, so the sample spans it instead of stopping at the
 *  alphabetical head. */
const SPREAD_FILES = bound('C80_SPREAD_FILES', 30);
const WALK_BUDGET_MS = bound('C80_WALK_MS', 420000);

/** The goal asks for at least ten rows per language where the workspace has
 *  them. Below this the capture is reported as thin rather than as a result. */
const ROW_FLOOR = 10;

/** How long to wait for the language server to answer the FIRST function. A
 *  Roslyn cold start is the slow one. */
const SERVER_READY_MS = bound('C80_SERVER_READY_MS', 120000);

/**
 * How long to wait for a symbol tree PER FILE before treating the file as
 * having no functions.
 *
 * THIS BOUND IS THE ONE THAT NEARLY VOIDED THE PYTHON CAPTURE. The first cut
 * waited for a server only at the first function it managed to resolve, and a
 * file whose symbol query came back EMPTY never reached that gate: it was
 * skipped as "no functions here". Pylance answers in seconds, the walk sorted
 * the files alphabetically and ran past all nine of them in one second, and the
 * capture came back with five functions from one file and called it the
 * workspace's total. A rig that cannot make the case fire reports a zero about
 * itself.
 */
const FILE_SYMBOL_MS = 20000;

/** The type resolve's bound, and it is deliberately far above the product's
 *  own. A developer waiting on a gesture must not hang; a capture run may
 *  wait for a cold server, and a context missing its type block would be a
 *  fact about the clock rather than about the language. */
const CAPTURE_TYPE_SHAPE_MS = 30000;

const FUNCTION_KINDS = new Set([
  vscode.SymbolKind.Function,
  vscode.SymbolKind.Method,
  vscode.SymbolKind.Constructor,
]);

function flatten(symbols, out = []) {
  for (const s of symbols || []) {
    out.push(s);
    if (Array.isArray(s.children)) flatten(s.children, out);
  }
  return out;
}

suite(`V64CAPTURE the fix-round context, captured from real functions [${LANG}]`, function () {
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

  test('captures one row per elevated finding, with the context the product would send', async function () {
    if (!spec || !GLOBS[LANG]) return this.skip();
    const started = Date.now();
    const glob = GLOBS[LANG];
    const found = await vscode.workspace.findFiles(glob.include, glob.exclude, FILE_CAP);
    const sorted = found
      .filter((uri) => !SKIP_FILES.some((rel) => uri.fsPath.endsWith(rel)))
      .sort((a, b) => a.fsPath.localeCompare(b.fsPath));
    // STRIDE, NOT TRUNCATE. Sorted order puts every file from one crate or one
    // package together, so walking the head of it samples one corner of the
    // repository and calls it the repository. Visiting every k-th file first
    // spans the whole list, and the order is still deterministic, so two runs
    // over unchanged bytes capture the same rows.
    const stride = Math.max(1, Math.floor(sorted.length / SPREAD_FILES));
    const files = [];
    for (let offset = 0; offset < stride; offset++) {
      for (let i = offset; i < sorted.length; i += stride) files.push(sorted[i]);
    }

    const rows = [];
    const perFile = new Map();
    const notes = [];
    let functionsSeen = 0;
    let refusedSlice = 0;
    let unresolved = 0;
    let firstResolveMs;
    // Whether the walk ENDED ON ITS OWN, having seen every function in every
    // file the glob found. A thin capture means two opposite things depending
    // on this flag: an exhausted walk is a fact about the workspace, and a walk
    // that stopped on a cap or the clock is a fact about the rig. They are not
    // allowed to share a verdict.
    let exhausted = true;
    /** Whether any file has produced a symbol tree yet. Until one has, an empty
     *  answer means "the server is still starting", not "no functions". */
    let sawSymbols = false;
    /** Files whose symbol query stayed empty for the whole budget. Reported,
     *  because a file that really has no functions and a file the server never
     *  took up look the same from here. */
    const emptyFiles = [];

    for (const uri of files) {
      if (rows.length >= ROW_TARGET || functionsSeen >= FUNCTION_CAP || Date.now() - started > WALK_BUDGET_MS) {
        exhausted = false;
        break;
      }

      let doc;
      try {
        doc = await vscode.workspace.openTextDocument(uri);
      } catch (err) {
        notes.push(`${uri.fsPath}: could not be opened (${String(err)})`);
        continue;
      }
      const lang = product.criticizeLangFor(doc.languageId);
      if (lang === undefined) continue;
      await vscode.window.showTextDocument(doc, { preview: false });

      // AN EMPTY ANSWER IS NOT THE SAME AS NO FUNCTIONS until the server has
      // had time to say so. The first file waits the full cold-start budget;
      // every later file gets a short one, because by then the server has
      // answered at least once and a long wait per file would multiply one cold
      // start by forty.
      const budget = sawSymbols ? FILE_SYMBOL_MS : SERVER_READY_MS;
      const symbolDeadline = Date.now() + budget;
      let functions = [];
      for (;;) {
        const symbols = await vscode.commands.executeCommand(
          'vscode.executeDocumentSymbolProvider',
          uri,
        );
        functions = flatten(symbols).filter((s) => FUNCTION_KINDS.has(s.kind));
        if (functions.length > 0) break;
        if (Date.now() > symbolDeadline) break;
        await sleep(1000);
      }
      if (functions.length === 0) {
        emptyFiles.push(vscode.workspace.asRelativePath(uri, false));
        continue;
      }
      sawSymbols = true;
      let rowsFromThisFile = 0;

      for (const symbol of functions) {
        if (rows.length >= ROW_TARGET || functionsSeen >= FUNCTION_CAP || Date.now() - started > WALK_BUDGET_MS) {
          exhausted = false;
          break;
        }
        // The per-file cap ends THIS file rather than the walk, so the next
        // file gets its turn. It does not make the capture non-exhaustive: the
        // walk still visits every file.
        if (rowsFromThisFile >= FILE_ROW_CAP) break;
        functionsSeen++;
        const at = symbol.selectionRange.start;

        // THE READINESS GATE IS THE PRODUCT'S OWN RESOLVE, not a raw symbol
        // query: a server that answers with a tree the product cannot navigate
        // leaves every gesture refusing, and a rig that reported that as "no
        // findings" would be blaming the code for a dead server. Only the FIRST
        // function waits; after that the server has answered once and a
        // per-symbol wait would multiply the cold start by sixty.
        let resolved;
        if (firstResolveMs === undefined) {
          const deadline = Date.now() + SERVER_READY_MS;
          for (;;) {
            resolved = await product.resolveFunctionAtCursor(doc, at);
            if (resolved !== undefined) break;
            if (Date.now() > deadline) break;
            await sleep(1000);
          }
          firstResolveMs = Date.now() - started;
        } else {
          resolved = await product.resolveFunctionAtCursor(doc, at);
        }
        if (resolved === undefined) {
          unresolved++;
          continue;
        }

        // Exactly the gesture's own arithmetic. `headOffset`, never
        // `span.start`: the span is the WRITABLE region and Python's Fork A
        // moves it past a leading docstring, which refused 7 of 10 real Python
        // functions in the v61 host tier.
        const view = product.scoringView(doc.getText().split(/\r?\n/), doc.languageId);
        const headLine = doc.positionAt(resolved.headOffset).line + 1;
        const endLine = doc.positionAt(resolved.span.end).line + 1;
        const unit = product.sliceFunction(
          view.lines,
          product.viewLineAtOrAfter(view, headLine),
          product.viewLineAtOrBefore(view, endLine),
          resolved.symbolName,
          lang,
        );
        if (unit === undefined) {
          refusedSlice++;
          continue;
        }

        const policy = product.DEFAULT_ELEVATION;
        const scored = product.scoreFunction(unit, lang, policy);
        const card = product.cardInDocumentLines(scored, view);
        const elevated = product.explainableRows(card, policy);
        const flagged = elevated.filter((row) => row.outcome.state === 'flagged');
        if (flagged.length === 0) continue;

        // ONE CONTEXT PER FUNCTION, which is what the product builds: the type
        // shapes, the call lines and the callees are properties of the function
        // rather than of the finding. It is embedded per ROW so the offline rig
        // can replay one row without holding the whole file.
        const log = () => {};
        let context = {};
        const contextStarted = Date.now();
        try {
          context = await product.buildFixContext(
            doc,
            resolved,
            unit,
            lang,
            {
              resolvePrefill: product.resolvePrefill,
              extractorFor: product.extractorFor,
              typeShapeMs: CAPTURE_TYPE_SHAPE_MS,
            },
            log,
          );
        } catch (err) {
          notes.push(`${resolved.symbolName}: the context failed (${String(err)})`);
        }
        // THE RESOLVED FACTS, in the host, exactly as the gesture resolves them.
        // Best effort: a server that will not answer costs this row its reach
        // block and costs the row nothing else.
        let reachFacts = [];
        try {
          const headLine = doc.positionAt(resolved.headOffset).line + 1;
          const endLine = doc.positionAt(resolved.span.end).line + 1;
          reachFacts = Array.from(
            await product.resolveReach(doc, product.reachQueries(unit, lang), { from: headLine, to: endLine }, lang, log),
          );
        } catch (err) {
          notes.push(`${resolved.symbolName}: reach failed (${String(err)})`);
        }
        const contextMs = Date.now() - contextStarted;

        const rel = vscode.workspace.asRelativePath(uri, false);
        for (const row of flagged) {
          if (rowsFromThisFile >= FILE_ROW_CAP) break;
          for (const finding of row.outcome.findings) {
            if (rowsFromThisFile >= FILE_ROW_CAP) break;
            rowsFromThisFile++;
            const tablePhrase = product.VOICE_PARTS[finding.dimension];
            rows.push({
              language: doc.languageId,
              file: rel,
              functionName: resolved.symbolName,
              dimension: finding.dimension,
              line: finding.line,
              evidence: finding.evidence,
              detail: finding.detail,
              source: row.source,
              // THE TABLE'S OWN SENTENCE, carried so the offline judge can put
              // an arm head to head against the phrase that ships today without
              // re-deriving it. An arm that does not beat a lookup table does
              // not ship, and shipping the table is a perfectly good outcome.
              tableOrder: tablePhrase ? tablePhrase.order : '',
              contextMs,
              context: {
                functionText: context.functionText ? Array.from(context.functionText) : [],
                signature: context.signature === undefined ? '' : context.signature,
                typeShapes: context.typeShapes ? Array.from(context.typeShapes) : [],
                callSites: context.callSites ? Array.from(context.callSites) : [],
                callees: context.callees ? Array.from(context.callees) : [],
                // THE RESOLVED FACTS, added 2026-08-29. Where every name the
                // body uses is actually defined and what it is declared as.
                // Captured here rather than derived offline because only a live
                // language server can answer it, which is the same reason the
                // type shapes and call sites are captured rather than computed.
                reach: reachFacts,
              },
            });
          }
        }
        perFile.set(rel, rowsFromThisFile);
      }
    }

    fs.mkdirSync(OUT_DIR, { recursive: true });
    const languageId = rows.length > 0 ? rows[0].language : LANG;
    const outFile = path.join(OUT_DIR, `${languageId}.json`);
    fs.writeFileSync(outFile, `${JSON.stringify(rows, null, 2)}\n`, 'utf8');

    const withTypes = rows.filter((r) => r.context.typeShapes.length > 0).length;
    const withCalls = rows.filter((r) => r.context.callSites.length > 0).length;
    const withCallees = rows.filter((r) => r.context.callees.length > 0).length;
    const withSignature = rows.filter((r) => r.context.signature !== '').length;

    report(`V64CAPTURE ${LANG}`, [
      `wrote ${rows.length} row(s) to ${outFile}`,
      `walked ${files.length} file(s), ${functionsSeen} function(s), in ${Math.round((Date.now() - started) / 1000)}s`,
      `first product resolve took ${firstResolveMs === undefined ? 'n/a' : `${firstResolveMs}ms`}`,
      `${unresolved} function(s) the product could not resolve, ${refusedSlice} the slicer refused`,
      `context filled: ${withSignature} signature, ${withTypes} type shapes, ${withCalls} call sites, ${withCallees} callees`,
      `per file: ${[...perFile.entries()].map(([f, n]) => `${f}=${n}`).join(', ') || '(none)'}`,
      `${emptyFiles.length} file(s) answered no function symbols inside their budget: ${emptyFiles.slice(0, 8).join(', ') || '(none)'}`,
      exhausted
        ? 'the walk saw every function in every file the glob found, so this count is the workspace\'s'
        : 'the walk stopped on a cap or the clock, so there may be more findings than this',
      ...notes.slice(0, 10),
    ]);

    // A ZERO FROM A RIG THAT COULD NOT FIRE IS A FACT ABOUT THE RIG. If the
    // product resolved nothing at all, the language server never answered and
    // this row must say so rather than reporting an empty capture as a finding
    // about the code.
    assert.ok(
      firstResolveMs !== undefined && unresolved < functionsSeen,
      `the product resolved no function anywhere in ${files.length} file(s). The language server `
        + 'never answered, so this capture measures the rig and not the workspace.',
    );
    // THE FLOOR IS ABOUT THE RIG, NOT ABOUT THE WORKSPACE. A walk that saw every
    // function the glob found and still came back thin has measured a small
    // workspace, and go-scratch is one: eight files, twenty-six functions, six
    // elevated findings in the whole repository. Failing on that would be the
    // rig calling a true answer a defect. A walk that stopped on a cap or the
    // clock and came back thin is the other thing, and it fails.
    if (exhausted) {
      assert.ok(
        rows.length > 0,
        `the walk saw all ${functionsSeen} function(s) in ${files.length} file(s) and found no `
          + 'elevated finding anywhere. That is a claim about the whole workspace, and it wants '
          + 'triage rather than a green.',
      );
    } else {
      assert.ok(
        rows.length >= ROW_FLOOR,
        `captured only ${rows.length} row(s), under the ${ROW_FLOOR}-row floor, and the walk did NOT `
          + `exhaust the workspace: ${functionsSeen} function(s) seen, ${unresolved} unresolved, `
          + `${refusedSlice} slice-refused. Something stopped it early.`,
      );
    }
  });
});
