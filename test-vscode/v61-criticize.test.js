// session-v61 phase 5, the half only a real extension host can reach.
//
// `test/impl-v61-p5-gesture.test.cjs` drives the pipeline headless against
// fixture line arrays: every refusal, the order of operations, the elevation
// policy, and the absence of a write path. S61-22 recorded that NONE of it had
// ever run inside VS Code, and that a host test written that day would execute
// nowhere. This file is that gap closed.
//
// FIVE THINGS THE HEADLESS TIER CANNOT SEE, and they are what this file is for:
//
//   1. THE SPAN A LIVE LANGUAGE SERVER RETURNS, FED TO THE REAL SLICER. This is
//      the row that earns the tier. `resolveFunctionAtCursor` deliberately puts
//      doc comments OUTSIDE the span so a regeneration cannot eat them, and
//      `sliceFunction` must walk back up over them, because a slice that begins
//      at the declaration head reads 29% of documented Rust functions as
//      undocumented and takes dimensions 9 and 10 silently wrong with it. The
//      v61 scout's rig hit that twice. Headless fixtures encode what the
//      servers were MEASURED to do; only a real server can catch them drifting.
//   2. the command is REGISTERED, so the palette entry the human presses exists
//   3. the whole gesture really writes nothing, through a real editor and a
//      real document, rather than by a grep over the module's imports
//   4. a real card, rendered end to end from a live symbol span, carries all
//      fifteen dimensions and the closing contract sentence
//   5. the refusals name what they refuse, in the channel, in the host
//
// THE INSTRUMENT IS THE CHANNEL, teed to `C80_LOG_FILE`. No test can read an
// OutputChannel back, and `renderScorecard`'s output reaches the channel through
// `appendLine`, which is the method the tee proxies. Without the variable set
// before the host starts there is no instrument, and the rows that need one say
// so by name and skip rather than reporting a green that graded nothing.
//
// WHAT IS NOT DRIVEN, and it is stated rather than papered over: the explainer.
// It needs a reachable model, its rounds are per elevated row, and its failure
// mode is already a COMPLETE card by construction. A host row that waits on
// ollama grades ollama.
//
// Run:  C80_LOG_FILE=/tmp/c80-v61.log DISPLAY=:1 \
//         npx vscode-test --config test-vscode/.vscode-test.mjs --label rust --grep V61

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vscode = require('vscode');
const { SPECS } = require('./helpers/specs');
const { report } = require('./helpers/probe');

const product = require('./.build/product.js');

const LANG = process.env.C80_LANG || 'ts';
const spec = SPECS[LANG];
const EXT_ID = 'utilitydelta.column-80';
const COMMAND = 'column80.criticizeFunction';

// The tee, on the same three-way rule v33 settled: set in the environment wins,
// unset with the extension not yet active installs a default, unset with the
// extension already active means there is no instrument and no way to add one.
const extensionAtLoad = vscode.extensions.getExtension(EXT_ID);
const ACTIVE_AT_LOAD = extensionAtLoad ? extensionAtLoad.isActive === true : false;
const LOG_FROM_ENV = typeof process.env.C80_LOG_FILE === 'string' && process.env.C80_LOG_FILE !== '';
const DEFAULT_LOG = path.join(os.tmpdir(), `c80-v61-${process.pid}.log`);
if (!LOG_FROM_ENV) {
  process.env.C80_LOG_FILE = DEFAULT_LOG;
}
const LOG_FILE = process.env.C80_LOG_FILE;
const NO_INSTRUMENT = !LOG_FROM_ENV && ACTIVE_AT_LOAD;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Byte offsets, and the slice is taken on the BUFFER: a card quoting any
// non-ascii evidence line would put a character offset out of step with the
// file size.
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

/** Waits for the card's own last line rather than for a duration. The gesture
 *  walks callers and may consult a tier gate, so a fixed sleep either flakes or
 *  is far longer than the gesture takes. */
async function waitForCard(mark, ms = 60000) {
  const deadline = Date.now() + ms;
  for (;;) {
    const text = logSince(mark);
    if (text.includes(CONTRACT_SENTENCE)) return text;
    if (Date.now() > deadline) return text;
    await sleep(250);
  }
}

async function waitForLine(mark, needle, ms = 30000) {
  const deadline = Date.now() + ms;
  for (;;) {
    const text = logSince(mark);
    if (text.includes(needle)) return text;
    if (Date.now() > deadline) return text;
    await sleep(200);
  }
}

// The last non-empty line of every card, taken from the product rather than
// retyped here. A copy in the test is a second source of truth for a ruled
// constant, and it would keep passing after the product's wording changed.
const CONTRACT_SENTENCE = product.HONEST_CONTRACT;

const DIMENSIONS = [
  'clock', 'prng', 'env', 'world',
  'adjacent-params', 'bool-param', 'unused-param', 'param-count',
  'undocumented', 'unenforced-precondition', 'cqs',
  'pass-through', 'nesting',
  'unadmitted-failure',
  'section-comment',
];

// ---------------------------------------------------------------------------
// The fixture.
//
// One authored function per language, and AUTHORED is the point: measuring a
// gesture against whatever the dogfood repo already contains is the circular
// measurement session-v37 wrote up. Each carries a doc comment (so the upward
// walk has something to find), a wall-clock read (so `clock` fires, and its
// evidence line is a fixed string this file can assert on), two adjacent
// parameters of one type (so `adjacent-params` fires, which is signature-level
// and therefore the dimension that asks for a blast radius), one caller in the
// same file (so the call-hierarchy walk has an incoming call to find), and a
// trailing marker line that no symbol range and no doc comment can claim.
//
// IT IS APPENDED TO AN EXISTING FILE, NOT WRITTEN AS A NEW ONE. A new file was
// the first cut and it worked on four of the five servers; PYLANCE NEVER
// ANSWERED, returning no documentSymbol array at all for 120 seconds on a file
// created after the workspace loaded, while answering completions and hovers on
// that same repo's committed files throughout. Rather than keep a per-language
// strategy, all five now go through the insertion the tier already uses
// everywhere else. The restore is the same one `withInsertion` performs, and it
// matters for the same reason session-v23 recorded: a fixture left behind
// breaks package-level analysis for every suite that runs after this one.
//
// Nothing here needs an import the target file does not already have: the clock
// reads are written fully qualified for exactly that reason.
//
// `docNeedle` is a line that exists ONLY in the doc comment. If it is inside
// the slice, the slicer walked up past the declaration head that the live
// server's span begins at.
// ---------------------------------------------------------------------------
const MARKER = 'nothing below this line is inside a function';

const FIXTURES = {
  ts: {
    file: 'playground/src/fim.ts',
    name: 'spanProbe',
    docNeedle: 'Probe for the v61 host tier.',
    cursorNeedle: 'const c80Started = Date.now();',
    text: [
      '',
      '/**',
      ' * Probe for the v61 host tier.',
      ' *',
      ' * @param first the first bound',
      ' * @param second the second bound',
      ' */',
      'export function spanProbe(first: number, second: number): number {',
      '  const c80Started = Date.now();',
      '  return first + second + c80Started;',
      '}',
      '',
      'export function spanProbeCaller(): number {',
      '  return spanProbe(1, 2);',
      '}',
      '',
      `// ${MARKER}`,
      '',
    ].join('\n'),
  },
  rust: {
    file: 'crates/playground/src/fim.rs',
    name: 'span_probe',
    docNeedle: 'Probe for the v61 host tier.',
    cursorNeedle: 'let c80_started = std::time::Instant::now();',
    text: [
      '',
      '/// Probe for the v61 host tier.',
      '///',
      '/// Takes two bounds and adds them.',
      'pub fn span_probe(first: u64, second: u64) -> u64 {',
      '    let c80_started = std::time::Instant::now();',
      '    first + second + c80_started.elapsed().as_secs()',
      '}',
      '',
      'pub fn span_probe_caller() -> u64 {',
      '    span_probe(1, 2)',
      '}',
      '',
      `// ${MARKER}`,
      '',
    ].join('\n'),
  },
  go: {
    file: 'playground/fim.go',
    name: 'SpanProbe',
    docNeedle: 'SpanProbe is a probe for the v61 host tier.',
    cursorNeedle: 'c80Started := time.Now()',
    text: [
      '',
      '// SpanProbe is a probe for the v61 host tier.',
      '//',
      '// It takes two bounds and adds them.',
      'func SpanProbe(first int64, second int64) int64 {',
      '\tc80Started := time.Now()',
      '\treturn first + second + c80Started.Unix()',
      '}',
      '',
      'func SpanProbeCaller() int64 {',
      '\treturn SpanProbe(1, 2)',
      '}',
      '',
      `// ${MARKER}`,
      '',
    ].join('\n'),
  },
  python: {
    // NOT `playground/fim.py`, and the reason is checked into that file: its
    // line 52 is a deliberately unclosed `stripe.enroll_tile(`, an anchor the
    // sticky-selection suite needs. The file does not parse, so Pylance reads
    // everything appended below it as part of that unterminated call and hands
    // back `gesture_site` for a cursor a hundred lines lower. A target for an
    // insertion has to be a file that parses.
    file: 'playground/fns.py',
    name: 'span_probe',
    docNeedle: 'Probe for the v61 host tier.',
    cursorNeedle: 'c80_started = time.time()',
    text: [
      '',
      '',
      'def span_probe(first: int, second: int) -> int:',
      '    """Probe for the v61 host tier.',
      '',
      '    Takes two bounds and adds them.',
      '    """',
      '    import time',
      '',
      '    c80_started = time.time()',
      '    return first + second + int(c80_started)',
      '',
      '',
      'def span_probe_caller() -> int:',
      '    return span_probe(1, 2)',
      '',
      '',
      `# ${MARKER}`,
      '',
    ].join('\n'),
  },
  csharp: {
    file: 'src/Playground/Fim.cs',
    name: 'SpanProbe',
    docNeedle: 'Probe for the v61 host tier.',
    cursorNeedle: 'var c80Started = System.DateTime.UtcNow;',
    text: [
      '',
      'public static class C80V61Probe',
      '{',
      '    /// <summary>Probe for the v61 host tier.</summary>',
      '    /// <param name="first">the first bound</param>',
      '    /// <param name="second">the second bound</param>',
      '    public static long SpanProbe(long first, long second)',
      '    {',
      '        var c80Started = System.DateTime.UtcNow;',
      '        return first + second + c80Started.Ticks;',
      '    }',
      '',
      '    public static long SpanProbeCaller() => SpanProbe(1, 2);',
      '}',
      '',
      `// ${MARKER}`,
      '',
    ].join('\n'),
  },
};

const fixture = FIXTURES[LANG];
const fixturePath = spec && fixture ? path.join(spec.repo, fixture.file) : undefined;

/**
 * How long to wait for a language server to take up the insertion before
 * calling the rig dead. Roslyn is the slow one on a first open. CHOSEN, not
 * measured.
 */
const SERVER_READY_MS = 90000;

/** The pristine text of the target file, captured before the first insertion
 *  and written back in teardown. A fixture left in a dogfood repo breaks
 *  package-level analysis for every suite that runs after this one, which is
 *  the defect session-v23 spent a run finding. */
let pristine;
let pristineDirty = false;

function cursorOnProbe(doc) {
  const lines = doc.getText().split('\n');
  const at = lines.findIndex((l) => l.includes(fixture.cursorNeedle));
  if (at < 0) return undefined;
  return new vscode.Position(at, Math.max(0, lines[at].length - 1));
}

/**
 * Appends the fixture to the target file and waits until THE PRODUCT resolves a
 * function at the probe cursor.
 *
 * The readiness signal is `resolveFunctionAtCursor` rather than a raw
 * documentSymbol call, because that is the precondition every row below
 * actually has: a server that answers a symbol query with a tree the product
 * cannot navigate leaves the gesture refusing, and a row that then goes red is
 * blaming the product for a dead rig.
 *
 * EVERY ROW GOES THROUGH THIS GATE, including the two that expect a refusal.
 * Row 7 wants "no function at this cursor" and row 3 wants "nothing was
 * written", and under a dead server both pass for the wrong reason. A green a
 * dead server would also produce is not evidence.
 */
async function openFixture() {
  const uri = vscode.Uri.file(fixturePath);
  const doc = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(doc, { preview: false });
  if (pristine === undefined) {
    pristine = doc.getText();
    pristineDirty = doc.isDirty;
  }
  if (!doc.getText().includes(fixture.cursorNeedle)) {
    const edit = new vscode.WorkspaceEdit();
    edit.insert(uri, doc.positionAt(doc.getText().length), fixture.text);
    if (!(await vscode.workspace.applyEdit(edit))) {
      throw new Error('applyEdit refused the fixture insertion');
    }
  }
  const at = cursorOnProbe(doc);
  assert.ok(at !== undefined, 'the inserted fixture must contain its cursor needle');
  const deadline = Date.now() + SERVER_READY_MS;
  let resolved;
  let symbols;
  for (;;) {
    symbols = await vscode.commands.executeCommand('vscode.executeDocumentSymbolProvider', uri);
    resolved = await product.resolveFunctionAtCursor(doc, at);
    if (resolved !== undefined) break;
    if (Date.now() > deadline) break;
    await sleep(1000);
  }
  return { doc, uri, symbols, resolved, ready: resolved !== undefined };
}

/** Puts the target file back exactly as it was found, buffer and disk. */
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
  } catch {}
}

/**
 * The one sentence every row uses to disown a dead server, so a skip reads the
 * same wherever it came from.
 *
 * IT REPORTS THE SYMBOL TREE AS WELL AS THE RESOLUTION, because "the server
 * never answered" and "the server answered and the product could not navigate
 * what it sent" are opposite findings wearing the same skip. The first is a
 * fact about the rig and the second is a product defect, and a message that
 * cannot tell them apart lets a real defect leave as a skip.
 */
function skipDeadServer(ctx, where, state) {
  const syms = state && Array.isArray(state.symbols) ? state.symbols : undefined;
  const names = syms === undefined ? 'no array' : syms.map((sy) => sy.name).join(', ') || '(empty)';
  report(`V61 ${LANG} ${where}`, [
    `the product resolved no function at the probe cursor in ${SERVER_READY_MS / 1000}s.`,
    `documentSymbol returned ${syms === undefined ? 'no array' : `${syms.length} top-level symbols`}: ${names.slice(0, 300)}`,
    syms !== undefined && syms.length > 0
      ? 'THE SERVER ANSWERED AND THE PRODUCT DID NOT RESOLVE. That is not a rig fact: the tree is '
        + 'there and `resolveFunctionAtCursor` could not find a function at the cursor in it. '
        + 'SKIPPED so the run continues, but this wants triage rather than a shrug.'
      : 'the language server sent no symbols, so it never took up the insertion. SKIPPED: this is '
        + 'a fact about the rig, and a row that went red here would be blaming the product for it.',
  ]);
  return ctx.skip();
}

suite(`V61CRITICIZE the criticize gesture in a real host [${LANG}]`, function () {
  suiteSetup(async function () {
    const ext = vscode.extensions.getExtension(EXT_ID);
    if (ext && !ext.isActive) await ext.activate();
    await sleep(1000);
  });

  suiteTeardown(async function () {
    // THE RESTORE IS NOT OPTIONAL. The fixture is appended to a file the other
    // suites in this tier read, and a leftover `span_probe` changes what their
    // symbol queries and package analysis see.
    await restoreFixture();
    try {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    } catch {}
  });

  test('1: the command is registered, and the palette entry has a title', async function () {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes(COMMAND), `${COMMAND} must be registered by the extension`);
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    const declared = pkg.contributes.commands.find((c) => c.command === COMMAND);
    assert.ok(declared, 'package.json must declare it, or the palette entry has no title');
    assert.strictEqual(declared.category, 'Column 80');
    assert.strictEqual(declared.title, 'Criticize Function');
  });

  test('2: the LIVE span, through the REAL slicer, still carries the doc comment', async function () {
    if (!spec || !fixture) return this.skip();
    const state = await openFixture();
    const { doc, ready, resolved } = state;
    if (!ready) return skipDeadServer(this, 'live span', state);

    const lang = product.criticizeLangFor(doc.languageId);
    assert.ok(lang !== undefined, `${doc.languageId} must be a registered criticize language`);

    // Exactly what the gesture does, and the numbers are the gesture's numbers.
    // `headOffset`, NOT `span.start`: the span is the writable region and Python
    // moves it past a leading docstring. A first cut of this row kept its own
    // copy of the arithmetic, and when the product's copy was fixed this one
    // went on measuring the defect and calling it a failure.
    const headLine = doc.positionAt(resolved.headOffset).line + 1;
    const endLine = doc.positionAt(resolved.span.end).line + 1;
    const lines = doc.getText().split(/\r?\n/);
    const unit = product.sliceFunction(lines, headLine, endLine, resolved.symbolName, lang);
    const spanText = doc.getText().slice(resolved.span.start, resolved.span.end);
    // The declaration the server named, found in the document, so a refusal can
    // say how far the span start sits from it rather than only that it refused.
    const declAt = lines.findIndex((l) => l.includes(fixture.name) && /\b(def|fn|func|function|public|static)\b/.test(l));

    report(`V61 ${LANG} live span`, [
      `symbolName=${resolved.symbolName} span lines ${headLine}..${endLine}`,
      `head found at document line ${declAt + 1}; headOffset line ${headLine}; `
        + `span.start line ${doc.positionAt(resolved.span.start).line + 1}`,
      `span itself carries the doc line: ${spanText.includes(fixture.docNeedle)}`,
      unit === undefined
        ? 'THE SLICER REFUSED this function outright'
        : `slice starts at document line ${unit.startLine}, headIndex ${unit.headIndex}`,
      unit === undefined
        ? '(no slice, so no doc to carry)'
        : `slice carries the doc line: ${unit.lines.join('\n').includes(fixture.docNeedle)}`,
    ]);

    assert.ok(
      unit !== undefined,
      'the slicer refused a function a live server had just resolved. The span the product hands '
        + `it starts at document line ${headLine} and the declaration head is at line ${declAt + 1}: `
        + 'when the span starts BELOW the head there is no declaration in the range for `findHead` '
        + 'to find, and the gesture refuses every function of this shape.',
    );

    const sliceText = unit.lines.join('\n');

    // THE ASSERTION. Not "the span has the doc" - the span deliberately may not,
    // and on most of these servers it does not. The unit the DETECTORS read must.
    assert.ok(
      sliceText.includes(fixture.docNeedle),
      'the slice a detector reads must include the doc comment. It does not, so the live span '
        + 'begins below it and the upward walk did not reach: dimension 9 now reads every '
        + `documented ${LANG} function as undocumented, and dimension 10 goes blind with it. `
        + `slice was:\n${sliceText}`,
    );
    // WHERE the doc sits is per-language, and the slice's shape follows it.
    // Four of the five write the doc ABOVE the declaration, so the head is not
    // the first line of the slice and the upward walk is what put it there.
    // PYTHON'S DOCSTRING IS THE FIRST STATEMENT OF THE BODY, below the `def`, so
    // its head IS the first slice line and there was never anything to walk up
    // over. Asserting `headIndex > 0` for Python would be asserting that its
    // docs are written somewhere they are not.
    if (LANG === 'python') {
      assert.strictEqual(
        unit.headIndex, 0,
        "Python's docstring is the first statement of the body, so the slice starts AT the `def`",
      );
    } else {
      assert.ok(
        unit.headIndex > 0,
        'a doc comment above the head means the head is not the first slice line, so the upward '
          + 'walk is what reached it',
      );
    }
  });

  // -------------------------------------------------------------------------
  // The census.
  //
  // Row 2 grades ONE authored function, which is enough to catch the seam
  // breaking and not enough to say how much of a real file it costs. This row
  // walks every function the server reports in the target file, puts the
  // gesture's own two steps behind each one, and counts the refusals.
  //
  // It is a MEASUREMENT and it asserts a floor rather than perfection: a
  // language whose every function refuses is a broken seam, and that is the
  // claim worth failing on. The rate itself goes to the report, because the
  // number is the finding.
  // -------------------------------------------------------------------------
  test('2b: how many of a real file\'s functions the seam can actually slice', async function () {
    if (!spec || !fixture) return this.skip();
    const state = await openFixture();
    const { doc, ready, symbols } = state;
    if (!ready) return skipDeadServer(this, 'census', state);
    const lang = product.criticizeLangFor(doc.languageId);
    const lines = doc.getText().split(/\r?\n/);

    const flat = [];
    const walk = (list) => {
      for (const sym of list || []) {
        flat.push(sym);
        if (Array.isArray(sym.children)) walk(sym.children);
      }
    };
    walk(symbols);
    // Function, Method and Constructor: the kinds a cursor resolves to.
    const fns = flat.filter((sy) => sy.kind === vscode.SymbolKind.Function
      || sy.kind === vscode.SymbolKind.Method
      || sy.kind === vscode.SymbolKind.Constructor);
    if (fns.length === 0) return skipDeadServer(this, 'census', state);

    const refused = [];
    let sliced = 0;
    let unresolved = 0;
    for (const sym of fns) {
      const range = sym.selectionRange || sym.range;
      const resolved = await product.resolveFunctionAtCursor(doc, range.start);
      if (resolved === undefined) { unresolved += 1; continue; }
      const headLine = doc.positionAt(resolved.headOffset).line + 1;
      const endLine = doc.positionAt(resolved.span.end).line + 1;
      const unit = product.sliceFunction(lines, headLine, endLine, resolved.symbolName, lang);
      if (unit === undefined) refused.push(sym.name);
      else sliced += 1;
    }

    report(`V61 ${LANG} census`, [
      `${fns.length} functions reported by the server in ${fixture.file}`,
      `${sliced} sliced, ${refused.length} REFUSED by the slicer, ${unresolved} not resolved by the product`,
      refused.length > 0 ? `refused: ${refused.join(', ')}` : 'no refusals',
    ]);

    assert.ok(
      sliced > 0,
      `the slicer refused EVERY function in ${fixture.file} (${refused.length} of ${fns.length}). `
        + 'The seam between the resolved span and the detector slice is broken for this language, '
        + 'and the gesture cannot score anything the developer opens.',
    );
  });

  test('3: the gesture writes NOTHING, through a real editor', async function () {
    if (!spec || !fixture) return this.skip();
    const state = await openFixture();
    const { doc, ready } = state;
    if (!ready) return skipDeadServer(this, 'writes nothing', state);
    const editor = vscode.window.activeTextEditor;
    const probeAt = cursorOnProbe(doc);
    assert.ok(probeAt !== undefined, 'the inserted fixture must contain its cursor needle');
    editor.selection = new vscode.Selection(probeAt, probeAt);
    // The invariant is that THE GESTURE moves nothing, so every reading is
    // taken after this suite's own insertion and compared to itself. Asserting
    // `isDirty === false` would be asserting that the fixture was never
    // inserted, which is a test of the harness rather than of the product.
    const before = doc.getText();
    const versionBefore = doc.version;
    const dirtyBefore = doc.isDirty;
    const onDisk = fs.readFileSync(fixturePath, 'utf8');

    const mark = logMark();
    await vscode.commands.executeCommand(COMMAND);
    if (!NO_INSTRUMENT) await waitForCard(mark);
    else await sleep(8000);

    assert.strictEqual(doc.getText(), before, 'the buffer must be byte-identical after a critique');
    assert.strictEqual(doc.version, versionBefore, 'and its version must not have moved');
    assert.strictEqual(doc.isDirty, dirtyBefore, 'and the gesture must not change whether it is dirty');
    assert.strictEqual(fs.readFileSync(fixturePath, 'utf8'), onDisk, 'and nothing may reach the disk');
    // A SAVE IS THE FAILURE THIS ROW EXISTS FOR. The fixture is an unsaved
    // insertion, so a gesture that saved the buffer would put `span_probe` into
    // a dogfood repo and the disk comparison above would catch it.

    // It publishes no diagnostics either: the Problems panel belongs to the
    // compiler. Anything this extension owned would carry its name as a source.
    const ours = vscode.languages
      .getDiagnostics(doc.uri)
      .filter((d) => typeof d.source === 'string' && /column.?80/i.test(d.source));
    assert.deepStrictEqual(ours, [], 'the gesture must publish no diagnostics');
  });

  test('4: a real card carries all fifteen dimensions and the contract sentence', async function () {
    if (!spec || !fixture) return this.skip();
    if (NO_INSTRUMENT) {
      report(`V61 ${LANG} card`, ['SKIPPED: C80_LOG_FILE was unset and the extension was already active, so there is no instrument']);
      return this.skip();
    }
    const state = await openFixture();
    const { doc, ready } = state;
    if (!ready) return skipDeadServer(this, 'card', state);
    const editor = vscode.window.activeTextEditor;
    const probeAt = cursorOnProbe(doc);
    assert.ok(probeAt !== undefined, 'the inserted fixture must contain its cursor needle');
    editor.selection = new vscode.Selection(probeAt, probeAt);

    const mark = logMark();
    await vscode.commands.executeCommand(COMMAND);
    const text = await waitForCard(mark);

    assert.ok(
      text.includes(CONTRACT_SENTENCE),
      `no card reached the channel in 60s. What did:\n${text.slice(0, 4000)}`,
    );
    assert.ok(text.includes('The rubric, all fifteen dimensions'), 'the roster heading must be on the card');
    const missing = DIMENSIONS.filter((d) => !text.includes(d));
    assert.deepStrictEqual(missing, [], 'every dimension scores always, so every id must appear on the card');

    // The authored defects, so this is a card about the fixture rather than any
    // card at all. Both are detector findings, neither needs a model.
    assert.ok(/\bclock\s+flagged/.test(text), `the fixture reads the wall clock, so dimension 1 must be flagged. card:\n${text.slice(0, 4000)}`);

    // THE BLAST RADIUS IS A TWO-STATE CONTRACT, and this row grades the pair
    // rather than presence. Either the walk produced a number and the card says
    // what an honest fix reaches, or it produced nothing and the card carries NO
    // line at all while the channel names the cause. What must never appear is a
    // digit the walk did not measure: a reader cannot tell an unmeasured zero
    // from a measured one, so the two states may not share a spelling.
    //
    // A first cut of this row asserted on /call sites?/ and read TRUE on a run
    // where the walk never fired, because the `adjacent-params` curriculum line
    // ends with the words "at a call site". An instrument that cannot fail is
    // not an instrument.
    const reached = /an honest fix to this signature reaches (\d+) call sites?/.exec(text);
    const walkedEmpty = text.includes('the caller walk found no call sites for this function');
    const noWalk = /\[critique\][^\n]*no call-site count was produced/.test(text)
      || /\[critique\][^\n]*blast radius not walked/.test(text);

    assert.ok(!/\b0 call sites?\b/.test(text), 'an absent blast radius must print no line, never a zero');
    if (reached === null && !walkedEmpty) {
      assert.ok(
        noWalk,
        'the card carries no blast-radius line, so the channel must say why the walk produced '
          + `nothing. It said neither. channel:\n${text.slice(0, 3000)}`,
      );
    } else {
      assert.ok(!noWalk, 'the card carries a blast-radius line, so the channel must not also say the walk produced nothing');
      if (reached !== null) assert.ok(Number(reached[1]) > 0, 'a rendered count must be a number the walk measured');
    }

    report(`V61 ${LANG} card`, [
      `clock flagged: ${/\bclock\s+flagged/.test(text)}`,
      `adjacent-params flagged: ${/adjacent-params\s+flagged/.test(text)}`,
      `blast radius: ${reached !== null ? `${reached[1]} call sites` : walkedEmpty ? 'walked, none found' : 'NOT WALKED (server placed no call-hierarchy root)'}`,
      `blind rows: ${(text.match(/blind, and it says why/g) || []).length}`,
      // Measurement only, never an assertion: the explainer needs a reachable
      // model, and a host row that waits on ollama grades ollama.
      `explainer: ${(/\[critique\] explained (\d+) of (\d+) elevated row/.exec(text) || [, 'n/a', 'n/a']).slice(1).join(' of ')}`,
    ]);
  });

  test('5: the card is byte-identical when the same function is scored twice', async function () {
    if (!spec || !fixture) return this.skip();
    if (NO_INSTRUMENT) return this.skip();
    const state = await openFixture();
    const { doc, ready } = state;
    if (!ready) return skipDeadServer(this, 'twice', state);
    const editor = vscode.window.activeTextEditor;
    const probeAt = cursorOnProbe(doc);
    assert.ok(probeAt !== undefined, 'the inserted fixture must contain its cursor needle');
    editor.selection = new vscode.Selection(probeAt, probeAt);

    const cards = [];
    for (let i = 0; i < 2; i++) {
      const mark = logMark();
      await vscode.commands.executeCommand(COMMAND);
      const text = await waitForCard(mark);
      const at = text.indexOf('Criticize rubric for');
      const end = text.indexOf(CONTRACT_SENTENCE);
      if (at < 0 || end < 0) return this.skip();
      cards.push(text.slice(at, end));
    }
    assert.strictEqual(cards[0], cards[1], 'the detectors decide the findings, so two passes over unchanged bytes must render the same card');
  });

  test('6: an unregistered language is refused BY NAME, in the channel', async function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c80-v61-rb-'));
    const rb = path.join(dir, 'probe.rb');
    fs.writeFileSync(rb, ['def probe(a, b)', '  a + b', 'end', ''].join('\n'), 'utf8');
    try {
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(rb));
      const editor = await vscode.window.showTextDocument(doc, { preview: false });
      editor.selection = new vscode.Selection(new vscode.Position(1, 3), new vscode.Position(1, 3));
      if (NO_INSTRUMENT) return this.skip();

      const mark = logMark();
      await vscode.commands.executeCommand(COMMAND);
      // The product's own words for this refusal, not a retyped copy.
      const expected = product.unregisteredLanguageReason(doc.languageId);
      const text = await waitForLine(mark, product.CRITIQUE_PREFIX, 15000);

      report(`V61 ${LANG} unregistered`, [`languageId=${doc.languageId}`, `channel said: ${text.trim().split('\n').slice(0, 3).join(' | ')}`]);
      assert.ok(
        text.includes(expected),
        `the refusal must name the language. Expected ${JSON.stringify(expected)}, channel had:\n${text.slice(0, 2000)}`,
      );
      assert.ok(!text.includes(CONTRACT_SENTENCE), 'a refused language must not render a card');
    } finally {
      try { fs.unlinkSync(rb); fs.rmdirSync(dir); } catch {}
    }
  });

  test('7: a cursor in no function refuses, and never scores the file', async function () {
    if (!spec || !fixture) return this.skip();
    if (NO_INSTRUMENT) return this.skip();
    const state = await openFixture();
    const { doc, ready } = state;
    if (!ready) return skipDeadServer(this, 'no function', state);
    const editor = vscode.window.activeTextEditor;
    // THE TRAILING MARKER, not line 0. A first cut aimed at line 0 and failed on
    // TypeScript, correctly: line 0 there is the opening `/**` of the doc block,
    // and session-v32 ruled that a cursor in a doc comment resolves to the
    // function it documents. That is the product working. The position this row
    // needs is one no symbol range and no doc comment can claim, which is the
    // line below the last declaration.
    const lines = doc.getText().split('\n');
    const marker = lines.findIndex((l) => l.includes('nothing below this line is inside a function'));
    assert.ok(marker > 0, 'the fixture must carry its out-of-function marker');
    editor.selection = new vscode.Selection(new vscode.Position(marker, 0), new vscode.Position(marker, 0));

    const mark = logMark();
    await vscode.commands.executeCommand(COMMAND);
    const text = await waitForLine(mark, product.CRITIQUE_PREFIX, 20000);

    report(`V61 ${LANG} no function`, [`channel said: ${text.trim().split('\n').slice(0, 2).join(' | ')}`]);
    assert.ok(
      !text.includes(CONTRACT_SENTENCE),
      `a cursor outside a function must not produce a card: a file-level card is the "criticize file" gesture the one-gesture rule refuses. channel had:\n${text.slice(0, 2000)}`,
    );
  });
});
