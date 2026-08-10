// BLIND ORACLE, session-v17 phase P1. Written against a PROMISED surface by an
// author who has not read `src/vscode/**`, `src/core/argTypeSurface.ts` or
// `src/core/fimInject.ts`. Per AGENTS.md, blind assertions are never edited to
// make an implementation pass.
//
// ============================================================================
// WHAT THIS FILE IS, AFTER THE PLATFORM REFUTED HALF OF IT
// ============================================================================
//
// It was written to grade four clauses from session-v17/goal.md item 1:
//
//   C1  a user-triggered operation that awaits language-server I/O accepts a
//       `vscode.CancellationToken` and honours it.
//   C2  when that token is cancelled the SERVER stops working, not merely the
//       extension stopping listening.
//   C3  superseding a request cancels the request it supersedes.
//   C4  cancellation degrades DARK, never WRONG.
//
// C1, C2 and C3 ARE UNSATISFIABLE ON THIS PLATFORM. Not hard, not unbuilt:
// unreachable through the API this extension uses. Two independent cuts in VS
// Code main, either fatal on its own:
//
//   1. `ExtHostCommands.registerApiCommand` forwards only DECLARED arguments,
//      and `vscode.executeHoverProvider` declares `[Uri, Position]`. A third
//      argument is never read and never validated. It does not arrive and it
//      does not throw, so a token passed there is silently discarded.
//   2. The main thread hardcodes `CancellationToken.None` into
//      `_executeHoverProvider`, `_executeDefinitionProvider` and
//      `_executeDocumentSymbolProvider`.
//
// Confirmed empirically in a real extension host, with no threshold involved: a
// token cancelled BEFORE the call still bought full server work
// (`pre-cancelled token: threw=no result=array(1) ms=151`), and cancelling
// mid-flight left the promise RESOLVED rather than rejected.
//
// The three tests that grade C1-C3 are KEPT AND SKIPPED at the bottom of this
// file. They are not dead weight: a test that encodes a promise the platform
// cannot keep is the cheapest durable record of WHY the feature is impossible,
// and it is what stops v18 rediscovering it by tuning a fifth constant. They
// assert nothing, so they cannot rot into a nuisance red. If VS Code ever
// forwards a token to these commands, deleting one `this.skip()` turns each
// back into a live oracle.
//
// WHAT SURVIVES, and what this file now exists to grade:
//
//   * C4, unchanged. It is the one property still standing, and the strategy
//     below is the change most likely to break it.
//   * ROUND-TRIP COUNT, which is new and is the real deliverable. With
//     cancellation off the table the only strategy left is goal.md item 2: ask
//     for LESS per keystroke. Hover only the constructor - 1 round trip instead
//     of `HOVER_SIGNATURE_CAP = 8`. That needs an oracle, and the right oracle
//     is STRUCTURAL rather than temporal.
//
// ============================================================================
// STRUCTURAL VS TEMPORAL - the split, stated up front
// ============================================================================
//
// STRUCTURAL (counts and set containments. No clock is read for any verdict.
// Immune to machine load, to a busy box, to a concurrent agent, and to every
// constant this repo has been burned by):
//
//   T1  round trips per keystroke, bounded, per language.        ASSERTS
//   T1  round trips do not GROW across repeated keystrokes.      ASSERTS
//   T2  a degraded render LOSES arguments, never changes them.   ASSERTS
//   T3  what survives under load is a SUBSET of the quiet run.   ASSERTS
//
// TEMPORAL (reads a clock. Everything here is either skipped or reported
// without an assertion):
//
//   R1, R2, R3   latency and queue-depth probes.                 SKIPPED,
//                                                                platform-
//                                                                refuted
//   T1's timing column                                           REPORTED ONLY
//
// The only assertions this file makes are counts and set containments.
// budget.test.js already owns the temporal axis, and it owns it against
// per-language floors that were re-tuned three times in v16.
//
// ============================================================================
// THE COUNTING INSTRUMENT, AND EXACTLY WHAT IT CAN SEE
// ============================================================================
//
// The tier installs a counting wrapper around `vscode.commands.executeCommand`
// inside the extension host, armed only for the duration of one simulated
// keystroke. The product's transports ride that function - contract.test.js's
// header states it as the shared premise of this whole tier: "Every
// SurfaceExtractor primitive that the product ships rides
// `vscode.commands.executeCommand`".
//
// WHAT IT SEES: every command DISPATCH the product issues while armed, bucketed
// by command id, so the report reads `executeHoverProvider x8,
// executeDocumentSymbolProvider x1`.
//
// WHAT IT CANNOT SEE, and this matters because it is the exact distinction that
// killed C2:
//
//   * IT COUNTS CALLS THE EXTENSION MAKES, NOT WORK THE SERVER DOES. One
//     `executeCompletionItemProvider` dispatch carrying `resolveCount = 24` is
//     ONE tick here and up to twenty-five units of work inside the server. The
//     count bounds what the extension ASKS FOR, never what the server spends.
//     Reading a green here as "the server is doing at most N things" is exactly
//     the mistake C2 made.
//   * work the server starts on its own - indexing, diagnostics, the reparse a
//     dirty buffer triggers - is invisible.
//   * anything the product issues WITHOUT going through
//     `vscode.commands.executeCommand`: a provider invoked directly, or a
//     reference to `executeCommand` captured at import time rather than read at
//     call time. That failure reads as a LOW count, which is a false green, so
//     T1 refuses to grade anything until it has proved the counter is live.
//
// It is still the right instrument. The harm the goal describes - "type a word
// and the queue is 60 deep in a server with one worker" - is caused by the
// number of REQUESTS THE EXTENSION ISSUES. That is precisely this quantity, and
// it is the only quantity item 2 changes.
//
// The counter deliberately does NOT ask the product to expose anything. An
// exported in-flight counter would report what the extension believes, which is
// what this reports anyway, but with a product API to maintain and a shape for
// a blind test to guess at. Harness-side costs nothing and can be deleted.

'use strict';

const assert = require('assert');
const vscode = require('vscode');
const P = require('./helpers/probe');
const { SPECS } = require('./helpers/specs');
const {
  extractorFor, memberSiteFor, narrowToPartial, argumentTypeNames, renderFimCandidates,
  lineCommentFor, resolveArgTypesInBudget, INJECTION_DEADLINE_MS,
} = require('./.build/product');

const LANG = P.LANG;
const S = SPECS[LANG];
if (!S) throw new Error(`C80_LANG must be one of ${Object.keys(SPECS).join(', ')}, got ${LANG}`);

// --- the two round-trip bounds ----------------------------------------------
//
// These are the only two numbers in this file that gate a pass, and neither is
// measured. Both are COMPOSED from the design goal.md item 2 states, which is
// what makes them a contract rather than a tuned constant. A measured bound
// encodes today's cost as tomorrow's budget, and that is the mistake the goal
// warns about five times over.

// goal.md item 2, verbatim: "Hovering only the constructor is 1 round trip
// instead of 8". The constructor is the member that carries arity, and arity is
// the entire point of the feature, so one hover is what the design asks for.
// Today the fan-out is `HOVER_SIGNATURE_CAP = 8` and this bound runs red.
const HOVER_BUDGET = 1;

// The whole keystroke, composed rather than measured:
//   1  completion at the receiver, for the member set. Unavoidable - the
//      feature IS member injection.
//   1  locating the argument's type (a definition, or a workspace symbol).
//   1  descending into it (a documentSymbol).
//   1  the constructor hover above.
// Four is the design's own arithmetic with no room for a fan-out. It is stated
// as a composition so a future transport that genuinely needs a fifth kind of
// round trip has to argue the case in this comment rather than nudge a number.
const TOTAL_BUDGET = 4;

// Language-feature commands are the round trips. Anything else the product
// dispatches (editor gestures, workbench commands) is reported but not counted
// against the bound, because it does not reach a language server.
const SERVER_COMMAND = /^(vscode\.)?_?execute[A-Z]/;

// A generous budget for the COUNTED keystroke. The count must describe what the
// design asks for, not what happened to fit in 50ms on this box: under a
// deadline the count FALLS when the machine is busy, which would hand back
// exactly the load-sensitivity this instrument exists to escape. The count at
// the real 50ms window is measured too, and reported, and never asserted on.
const UNHURRIED_MS = 5000;

const KEYSTROKES = 5;

// UNCALIBRATED give-up cap, not a bar: how long T3 will wait for its own
// saturation load to drain before moving on.
const DRAIN_CAP_MS = 60000;

// --- the counter -------------------------------------------------------------

// Wraps `vscode.commands.executeCommand` for the duration of a call. Returns
// undefined if the property cannot be replaced, which callers must treat as a
// BLIND instrument rather than as a zero count.
function installCounter() {
  const original = vscode.commands.executeCommand;
  let armed = false;
  let seen = [];
  const wrapper = function (command, ...args) {
    if (armed) seen.push(String(command));
    return original.apply(vscode.commands, [command, ...args]);
  };
  try {
    vscode.commands.executeCommand = wrapper;
  } catch (_) {
    return undefined;
  }
  if (vscode.commands.executeCommand !== wrapper) return undefined;
  return {
    async around(fn) {
      seen = [];
      armed = true;
      try {
        return { value: await fn(), calls: [...seen] };
      } finally {
        armed = false;
      }
    },
    restore() { vscode.commands.executeCommand = original; },
  };
}

const tally = (calls) => {
  const out = new Map();
  for (const c of calls) out.set(c, (out.get(c) || 0) + 1);
  return [...out].sort((a, b) => b[1] - a[1]);
};
const shortName = (c) => String(c).replace(/^vscode\./, '').replace(/^_/, '');
const spell = (calls) => tally(calls).map(([c, n]) => `${shortName(c)} x${n}`).join(', ') || '(none)';
const countMatching = (calls, re) => calls.filter((c) => re.test(shortName(c))).length;
const serverCalls = (calls) => calls.filter((c) => SERVER_COMMAND.test(shortName(c)));

// --- latency apparatus -------------------------------------------------------
//
// Retained ONLY as the apparatus of the three platform-refuted tests at the
// bottom. Nothing live reads a clock for a verdict.

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : Math.round((s[s.length / 2 - 1] + s[s.length / 2]) / 2);
};

async function probeMs(uri, pos) {
  const at = Date.now();
  try { await P.hovers(uri, pos); } catch (_) { /* a throw is still a round trip */ }
  return Date.now() - at;
}

// --- shared state ------------------------------------------------------------

let ex;
let argDoc;
let argCursor;
let pristineArgText;
let site;
let counter;

// One keystroke at a member site, walked the way budget.test.js walks it, which
// is the way `provideInlineCompletionItems` walks it. `budgetMs` is the only
// knob. The argument site is used rather than a bare member site because it is
// the most expensive keystroke the feature has: both the receiver's member
// resolve and the argument-type leg run.
async function keystroke(budgetMs) {
  const members = await ex.completeMembers(argCursor);
  const candidates = narrowToPartial(members, site.partial);
  const types = await resolveArgTypesInBudget(
    ex,
    { uri: argCursor.uri, languageId: argDoc.languageId, text: argDoc.getText() },
    candidates,
    budgetMs,
  );
  return {
    members: (members || []).map((m) => m.name),
    wanted: argumentTypeNames(candidates, argDoc.languageId),
    types: (types || []).map((t) => t.name),
    rendered: renderFimCandidates(members, site.partial, lineCommentFor(argDoc.languageId)) || '',
  };
}

const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The rendered line that speaks for one member, or undefined.
function lineFor(rendered, name) {
  const re = new RegExp(`(^|[^A-Za-z0-9_])${escapeRe(name)}([^A-Za-z0-9_]|$)`);
  return String(rendered).split('\n').find((l) => re.test(l));
}

suite(`blind v17: what one keystroke costs a language server [${LANG}]`, function () {
  this.timeout(600000);

  suiteSetup(async function () {
    ex = extractorFor(S.languageId);
    assert.ok(ex, `extractorFor(${S.languageId}) is undefined, so this row has no transport to count`);

    argDoc = await P.open(S, S.argSite.file);
    pristineArgText = argDoc.getText();
    const position = P.cursorAt(argDoc, S.argSite);
    argCursor = { uri: argDoc.uri.toString(), line: position.line, character: position.character };
    site = memberSiteFor(argDoc.languageId)(
      argDoc.getText(new vscode.Range(new vscode.Position(0, 0), position)));

    // A server that never answers is an absent instrument and skips, per this
    // tier's convention. A count taken against no server is a count of nothing.
    const warm = await P.settled(() => ex.completeMembers(argCursor), {
      key: (v) => (v || []).map((m) => m.name).sort().join(','),
    });
    if (!site || !warm.value || !warm.value.length) {
      P.report('no member site or no member set at the argument site; this row cannot be counted', [
        `site=${JSON.stringify(site && site.partial)} members=${(warm.value || []).length} settled=${warm.settled}`,
      ]);
      this.skip();
    }
    counter = installCounter();
  });

  suiteTeardown(async () => {
    if (counter) counter.restore();
    // Belt-and-braces fixture hygiene (session-v23): the GESTURE tier is the
    // proven committer-to-disk (its drives Tab-commit ghosts and the
    // product's accept path saves before its oracle check); this suite only
    // probes, but any buffer it leaves non-pristine would ride the same
    // vector. Restore the pristine text AND save it, so neither the buffer
    // nor the disk carries anything forward.
    if (argDoc && pristineArgText !== undefined && argDoc.getText() !== pristineArgText) {
      const edit = new vscode.WorkspaceEdit();
      edit.replace(
        argDoc.uri,
        new vscode.Range(new vscode.Position(0, 0), argDoc.positionAt(argDoc.getText().length)),
        pristineArgText,
      );
      await vscode.workspace.applyEdit(edit);
      await argDoc.save();
    }
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  // ==========================================================================
  // T1 - THE DELIVERABLE. Structural. No clock is read for the verdict.
  // ==========================================================================
  //
  // How many round trips does ONE member-site keystroke cost the language
  // server? Counted at the command-dispatch layer, bucketed by command, graded
  // against an arithmetic the goal states rather than a number anyone measured.
  //
  // Four assertions, in this order, because they fail for different reasons:
  //
  //   1. INSTRUMENT: the counter is live. A wrapper that was never installed,
  //      or a product that captured `executeCommand` at import time, reports
  //      zero - and zero passes every bound below. That is the false green that
  //      matters most here, so it is refused before anything is graded.
  //   2. PRODUCT: hovers per keystroke, against goal.md item 2's own number.
  //   3. PRODUCT: total server round trips, against the composed budget. This
  //      is what catches the sideways fix - replacing 8 hovers with 8
  //      definitions passes assertion 2 and fails this one.
  //   4. PRODUCT: the count must not GROW across repeated keystrokes. Caching
  //      may make later keystrokes cheaper; nothing may make them dearer. That
  //      one needs no bound at all and survives any renegotiation of 2 and 3.
  test('one member-site keystroke costs a BOUNDED number of language-server round trips', async function () {
    assert.ok(
      counter,
      'INSTRUMENT: `vscode.commands.executeCommand` could not be wrapped, so this tier cannot count round ' +
      'trips at all. Nothing below is a statement about the product.',
    );

    const runs = [];
    for (let i = 0; i < KEYSTROKES; i++) {
      const at = Date.now();
      const { value, calls } = await counter.around(() => keystroke(UNHURRIED_MS));
      runs.push({ ...value, calls, ms: Date.now() - at });
      await P.sleep(50);
    }
    // The same keystroke under the REAL window, reported so the two are never
    // conflated. Never asserted on: under a deadline the count falls for
    // reasons that have nothing to do with the design asking for less.
    const hurried = await counter.around(() => keystroke(INJECTION_DEADLINE_MS));

    const server = runs.map((r) => serverCalls(r.calls));
    const totals = server.map((c) => c.length);
    const hovers = runs.map((r) => countMatching(r.calls, /^executeHoverProvider$/));

    P.report(`round trips for ONE keystroke at \`${S.argSite.needle}\` (budget ${UNHURRIED_MS}ms)`, [
      ...runs.map((r, i) =>
        `keystroke ${i}: ${serverCalls(r.calls).length} server round trips in ${r.ms}ms  ` +
        `[${spell(serverCalls(r.calls))}]  members=${r.members.length} ` +
        `wanted=[${r.wanted.join(',')}] landed=[${r.types.join(',')}]`),
      `non-language-server commands seen: ` +
      `${spell(runs[0].calls.filter((c) => !SERVER_COMMAND.test(shortName(c))))}`,
      `the same keystroke at the real ${INJECTION_DEADLINE_MS}ms window: ` +
      `${serverCalls(hurried.calls).length} round trips [${spell(serverCalls(hurried.calls))}] ` +
      `landed=[${hurried.value.types.join(',')}]   (REPORTED, not asserted)`,
      `budgets: hovers <= ${HOVER_BUDGET}, total server round trips <= ${TOTAL_BUDGET}`,
    ]);

    // 1. The counter is live. A member-site keystroke cannot cost zero round
    //    trips: the member set has to come from somewhere.
    assert.ok(
      Math.min(...totals) > 0,
      `INSTRUMENT: the counter saw ${Math.min(...totals)} language-server dispatches for a keystroke that ` +
      `returned ${runs[0].members.length} members. A member set cannot arrive without a round trip, so the ` +
      'wrapper is not seeing the product\'s calls - most likely the product holds a reference to ' +
      '`executeCommand` captured at import time rather than reading it at call time. Every bound below would ' +
      'pass on a count of zero, which is why this refuses first.',
    );

    // 2. goal.md item 2's own number.
    assert.ok(
      Math.max(...hovers) <= HOVER_BUDGET,
      `on ${LANG} one keystroke costs up to ${Math.max(...hovers)} hover round trips, against the ` +
      `${HOVER_BUDGET} the design asks for. goal.md item 2: the constructor is the member that carries arity, ` +
      'and arity is the entire point of the feature, so hovering only the constructor is 1 round trip instead ' +
      `of ${Math.max(...hovers)}. A fan-out this wide is what puts a one-worker server 60 deep when the user ` +
      'types a word, and cancellation cannot rescue it - the platform discards the token before it reaches the ' +
      'server (see this file\'s header). Asking for less is the only lever left.',
    );

    // 3. The composed budget for the whole keystroke.
    assert.ok(
      Math.max(...totals) <= TOTAL_BUDGET,
      `on ${LANG} one keystroke costs up to ${Math.max(...totals)} language-server round trips, against the ` +
      `${TOTAL_BUDGET} the design composes to (one completion, one locate, one descend, one constructor ` +
      `hover). Breakdown: ${spell(server[totals.indexOf(Math.max(...totals))])}.`,
    );

    // 4. No bound at all, and it outlives any renegotiation of 2 and 3.
    const grew = totals.slice(1)
      .map((n, i) => (n > totals[0] ? `keystroke ${i + 1} cost ${n} vs ${totals[0]}` : ''))
      .filter(Boolean);
    assert.deepStrictEqual(
      grew, [],
      `on ${LANG} a later keystroke cost MORE round trips than the first (${grew.join(', ')}). Warm keystrokes ` +
      'may get cheaper as a transport caches; none may get dearer, or the cost of typing grows with the length ' +
      'of the word.',
    );
  });

  // ==========================================================================
  // T2 - C4 on the axis the round-trip cut will attack. Structural.
  // ==========================================================================
  //
  // Cutting the hover fan-out is the change most likely to break "degrades
  // dark, never wrong", and it breaks it in one specific way: the members that
  // no longer get a hover still have to render SOMETHING. Rendering them as
  // bare names is the correct degradation. Rendering them with an argument list
  // borrowed from the member that DID get hovered is the v15 defect returning
  // through the front door - a block under a "to build a Tile" header stating
  // another symbol's shape.
  //
  // The property is forward-compatible with item 2 by construction, which is
  // what lets it be written before the cut lands: for every member, the degraded
  // line must either be the SAME line the unhurried run produced, or carry no
  // argument list at all. Losing arguments is allowed. Changing them is not.
  //
  // No clock, no fixture, no golden text. The unhurried run is its own
  // reference, taken in the same run against the same server.
  test('a degraded render LOSES arguments, never changes them', async function () {
    const quiet = await keystroke(UNHURRIED_MS);
    const hurried = await keystroke(INJECTION_DEADLINE_MS);

    const compared = [];
    const wrong = [];
    for (const name of quiet.members) {
      const q = lineFor(quiet.rendered, name);
      const h = lineFor(hurried.rendered, name);
      if (!q || !h) continue;
      compared.push(name);
      if (q === h) continue;
      if (!h.includes('(')) continue; // went bare: the correct degradation
      wrong.push(`${name}: unhurried ${JSON.stringify(q.trim())} vs degraded ${JSON.stringify(h.trim())}`);
    }

    P.report('dark-not-wrong on the RENDERED block', [
      `unhurried members ${quiet.members.length}, degraded members ${hurried.members.length}, ` +
      `lines compared ${compared.length}`,
      `unhurried arg types [${quiet.types.join(',')}] vs degraded [${hurried.types.join(',')}]`,
      ...quiet.rendered.split('\n').slice(0, 12).map((l) => `  unhurried| ${l}`),
      ...hurried.rendered.split('\n').slice(0, 12).map((l) => `  degraded | ${l}`),
    ]);

    assert.deepStrictEqual(
      wrong, [],
      `on ${LANG} a member rendered a DIFFERENT argument list when the keystroke was degraded, rather than ` +
      `losing its arguments: ${wrong.join(' ; ')}. Under pressure the block must go dark, not go wrong: a ` +
      'signature the server never confirmed, rendered under a construction header, is the failure this whole ' +
      'feature is supposed to be better than.',
    );
    // A degraded keystroke that renders NOTHING passes the loop above
    // vacuously. That is honest - dark IS the accepted degradation - but the
    // report is then the only evidence, which is why it prints either way.
  });

  // ==========================================================================
  // T3 - C4 under load. Structural (set containment).
  // ==========================================================================
  //
  // The identity half of the same property, against a saturated server rather
  // than a short budget. Cancellation may be unreachable, but ABANDONMENT still
  // happens on every deadline miss, and what comes back from an abandoned
  // keystroke must be a SUBSET of what a quiet one produces. It may shrink. It
  // may not change.
  test('under load the argument-type surface only ever SHRINKS, never changes', async function () {
    const quietRuns = [];
    for (let i = 0; i < 3; i++) quietRuns.push(await keystroke(UNHURRIED_MS));
    const quietMembers = new Set(quietRuns.flatMap((q) => q.members));
    const quietTypes = new Set(quietRuns.flatMap((q) => q.types));

    // Saturate with the product's own primitive, then take one real keystroke
    // while the server is busy. No token is passed: the platform would discard
    // it, so this is exactly what a real deadline miss leaves behind.
    const load = [];
    for (let i = 0; i < 24; i++) {
      load.push(Promise.resolve().then(() => ex.completeMembers(argCursor)).catch(() => undefined));
    }
    let loaded;
    try {
      loaded = await keystroke(INJECTION_DEADLINE_MS);
    } finally {
      await Promise.race([Promise.all(load), P.sleep(DRAIN_CAP_MS)]);
    }

    P.report('dark-not-wrong: quiet reference against a loaded keystroke', [
      `quiet members (${quietMembers.size}): ${[...quietMembers].slice(0, 20).join(', ')}`,
      `quiet arg types: ${[...quietTypes].join(', ') || '(none)'}`,
      `loaded members (${loaded.members.length}), loaded arg types: ${loaded.types.join(', ') || '(none)'}`,
    ]);

    const inventedTypes = loaded.types.filter((n) => !quietTypes.has(n));
    assert.deepStrictEqual(
      inventedTypes, [],
      `on ${LANG} a loaded keystroke produced argument types the quiet run never produced ` +
      `(${inventedTypes.join(', ')}). Under pressure the leg must go DARK, not answer differently.`,
    );
    const inventedMembers = loaded.members.filter((n) => !quietMembers.has(n));
    assert.deepStrictEqual(
      inventedMembers, [],
      `on ${LANG} a loaded keystroke returned members the quiet run never returned ` +
      `(${inventedMembers.join(', ')}). A member set that changes shape under load renders a different block ` +
      'on a busy machine than on an idle one.',
    );
  });

  // ==========================================================================
  // PLATFORM-REFUTED BELOW. Kept as the record of why, asserted by nothing.
  // ==========================================================================
  //
  // Each of the three tests below was written against C1, C2 or C3, and each is
  // unsatisfiable for the same two reasons, restated here so a reader who lands
  // on one test does not have to hunt the file header:
  //
  //   1. `ExtHostCommands.registerApiCommand` forwards only DECLARED arguments;
  //      `vscode.executeHoverProvider` declares `[Uri, Position]`, so a token
  //      passed as a third argument is silently dropped - it neither arrives
  //      nor throws.
  //   2. The main thread hardcodes `CancellationToken.None` into
  //      `_executeHoverProvider`, `_executeDefinitionProvider` and
  //      `_executeDocumentSymbolProvider`.
  //
  // Empirically, in a real host: a token cancelled BEFORE the call still bought
  // full server work (`threw=no result=array(1) ms=151`), and cancelling
  // mid-flight left the promise resolved rather than rejected.
  //
  // The bodies are left intact on purpose. They are the experiment anyone would
  // otherwise have to rebuild in order to disbelieve the claim, and each one
  // becomes a live oracle again by deleting a single `this.skip()`.

  test('PLATFORM-REFUTED (C1): a primitive handed an ALREADY-CANCELLED token does no work', async function () {
    P.report('SKIPPED: C1 is unsatisfiable', [
      'a token passed to vscode.executeHoverProvider is dropped by registerApiCommand (declared args only),',
      'and the main thread hardcodes CancellationToken.None. Measured: a pre-cancelled token still bought',
      'full server work - threw=no result=array(1) ms=151.',
    ]);
    this.skip();

    const warmMs = [];
    for (let i = 0; i < 5; i++) {
      const at = Date.now();
      await ex.completeMembers(argCursor);
      warmMs.push(Date.now() - at);
    }
    const src = new vscode.CancellationTokenSource();
    src.cancel();
    const at = Date.now();
    let result;
    try { result = await ex.completeMembers(argCursor, src.token); } catch (_) { result = []; }
    const cancelledMs = Date.now() - at;
    src.dispose();
    assert.strictEqual((result || []).length, 0, 'a pre-cancelled token still returned members');
    assert.ok(cancelledMs < Math.min(...warmMs), 'a pre-cancelled call still paid for the round trip');
  });

  test('PLATFORM-REFUTED (C2): cancelling in-flight work drains the SERVER queue', async function () {
    P.report('SKIPPED: C2 is unsatisfiable, and it was the headline', [
      'the instrument below is sound and was run. The probe is an independent raw hover - a code path the',
      'product never issues - so its latency can only be inflated by the SERVER being busy, and it is timed',
      'against a control arm that abandons rather than cancels. Measured: cancel 114/38/37ms against abandon',
      '56/43/33ms on ts, and cancel 847/698/688ms against abandon 726/703/691ms on python, over an idle',
      'baseline of 1-3ms. The arms are indistinguishable because the token never reaches the server. No',
      'implementation can move this. Only asking for less can, which is what the count test above grades.',
    ]);
    this.skip();

    const probePos = P.cursorAt(await P.open(S, S.memberSite.file), S.memberSite).translate(0, -2);
    const idle = [];
    for (let i = 0; i < 7; i++) idle.push(await probeMs(argDoc.uri, probePos));
    const arm = async (cancel) => {
      const sources = [];
      const settled = [];
      for (let i = 0; i < 24; i++) {
        const src = new vscode.CancellationTokenSource();
        sources.push(src);
        settled.push(Promise.resolve().then(() => ex.completeMembers(argCursor, src.token)).catch(() => undefined));
      }
      // Awaiting request #0 is proof the server received and served work, so
      // the rest are genuinely queued behind it. It is also what makes the two
      // arms identical in timing without a sleep constant.
      await settled[0];
      if (cancel) for (let i = 1; i < sources.length; i++) sources[i].cancel();
      const probe = await probeMs(argDoc.uri, probePos);
      for (const s of sources) { s.cancel(); s.dispose(); }
      await Promise.race([Promise.all(settled), P.sleep(DRAIN_CAP_MS)]);
      return probe;
    };
    const cancelled = await arm(true);
    const abandoned = await arm(false);
    assert.ok(abandoned > Math.max(...idle), 'INSTRUMENT: abandoned work did not visibly clog the server');
    assert.ok(cancelled < (median(idle) + abandoned) / 2, 'cancelling did not give the server its queue back');
  });

  test('PLATFORM-REFUTED (C3): a burst of superseding keystrokes does not queue linearly', async function () {
    P.report('SKIPPED: C3 dies with C2', [
      'superseding can only cancel what a token can cancel. Measured: the last of 24 back-to-back keystrokes',
      'answered after 73ms against 2ms warm on ts, and 691ms against 25ms warm on python - the serialised',
      'regime in both cases. The count test above attacks the same harm from the only side left: fewer',
      'requests per keystroke, so a burst of N is N times a smaller number.',
    ]);
    this.skip();

    const serviceMs = [];
    for (let i = 0; i < 5; i++) {
      const at = Date.now();
      await ex.completeMembers(argCursor);
      serviceMs.push(Date.now() - at);
    }
    const one = median(serviceMs);
    const at = Date.now();
    const pending = Array.from({ length: 24 }, () =>
      Promise.resolve().then(() => ex.completeMembers(argCursor)).catch(() => undefined));
    await pending[pending.length - 1];
    const lastMs = Date.now() - at;
    assert.ok(lastMs < (one + one * pending.length) / 2, 'the burst queued linearly');
  });
});
