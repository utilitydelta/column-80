// The argument-type leg under the REAL per-keystroke injection budget.
//
// Its sibling `product.test.js` grades the same payload with the deadline
// switched OFF: every call there runs under `P.settled` and a ten-minute mocha
// timeout, so a leg that never lands inside 50ms in a real editor still passes
// it. That is not a gap in one file, it is the mechanism by which this feature
// could be starved to the point of skipping entirely on most keystrokes while
// the whole suite stayed green.
//
// So this row spends no budget it would not spend in the editor. It walks the
// same order the provider walks — resolve the receiver's members at the `.`
// site, render, then give the argument-type leg WHAT IS LEFT of
// INJECTION_DEADLINE_MS — and it asserts the argument-type surface is there
// afterwards. Everything it measures is a real language server answering a real
// dogfood repo.
//
// Warm, not cold. A cold first call includes the server's own indexing and is
// not what a typing session pays; the warm-up iteration is discarded and
// reported separately so the two are never conflated.

'use strict';

const assert = require('assert');
const vscode = require('vscode');
const P = require('./helpers/probe');
const { SPECS } = require('./helpers/specs');
const {
  extractorFor, memberSiteFor, narrowToPartial, argumentTypeNames, renderFimCandidates, lineCommentFor,
  resolveArgTypesInBudget, INJECTION_DEADLINE_MS, ARG_TYPE_DEADLINE_MARGIN_MS, argTypeMinBudgetMs,
} = require('./.build/product');

// One warm-up plus this many measured keystrokes.
//
// Five was under-sampling. The row landed red four times and green once over
// five known runs, for two DIFFERENT assertions, so a single run of five could
// not say which defect it had seen or whether it had seen one at all. Twenty
// warm keystrokes at 30-60ms each costs under two seconds on the slowest row
// and turns a coin flip into a measurement: a defect firing one keystroke in
// five fires almost surely in twenty.
//
// The bound is deliberately NOT loosened to compensate, and the row is
// deliberately not a percentile. A percentile encodes "some keystrokes may be
// dark" as accepted product behaviour, and that is a decision for the human,
// not something a test should settle quietly.
//
// Twenty was still under-sampling, and v17 caught it first-hand: two clean-tree
// runs minutes apart gave ts 30/3 and ts 31/2, and the row that moved was this
// file's own window assertion. A row that flips on its own cannot grade a fix,
// because a green after the change is indistinguishable from a lucky run. Sixty
// is v16's own spike configuration (review-p3-round2 S2), which put the ts label
// at 27s against 25s. Nearly free, and it turns a coin flip into a measurement.
const WARM_ITERATIONS = 60;

// Budgets for the forced-budget arm, chosen to straddle every regime the leg
// can be in: below the floor, at it, and out to a window the leg can finish
// inside. The dogfood repos only ever hand it the top of this range.
const FORCED_BUDGETS_MS = [5, 8, 10, 12, 15, 20, 25, 30, 40];

// Timer slip is variable, so one sample per budget measures a mood.
//
// This is the arm the margin and both floors were SET from, which makes its
// sample count the most load-bearing number in the file. At three it was also
// the smallest. Nine budgets times three is 27 keystrokes, but TypeScript
// clears only four of those budgets once its floor of 20 is applied, so the
// measurement that chose ARG_TYPE_DEADLINE_MARGIN_MS rested on TWELVE admitted
// TypeScript keystrokes of a quantity whose tail is the entire reason the
// constant exists. v16's F1 and F3 are both invisible at 12 and both fire at 60.
//
// Twelve, per v16's S1 spike. The forced arm is cheap to grow: S2 ran 60 forced
// plus 20 warm and the whole ts label took 27s against 25s committed.
const FORCED_ITERATIONS = 12;

const LANG = P.LANG;
const S = SPECS[LANG];
if (!S) throw new Error(`C80_LANG must be one of ${Object.keys(SPECS).join(', ')}, got ${LANG}`);

// The floor is per-language now, so a row that read the default would grade
// TypeScript against a number TypeScript does not use.
const FLOOR_MS = argTypeMinBudgetMs(S.languageId);

suite(`argument-type leg under the real injection budget [${LANG}]`, function () {
  this.timeout(600000);

  // One keystroke, walked exactly as `provideInlineCompletionItems` walks it.
  // The clock starts where the provider's does, so the leg receives the same
  // budget the editor gives it and not a fresh 50ms.
  // `forcedBudgetMs` overrides the computed budget and nothing else, so the leg
  // can be driven at budgets the dogfood repos never produce. The receiver
  // resolve still runs, because the leg's cost depends on a warm server.
  async function oneKeystroke(ex, doc, position, forcedBudgetMs) {
    const cursor = { uri: doc.uri.toString(), line: position.line, character: position.character };
    const prefix = doc.getText(new vscode.Range(new vscode.Position(0, 0), position));
    const site = memberSiteFor(doc.languageId)(prefix);
    if (!site) return { site: undefined };

    const startedAt = Date.now();
    const members = await ex.completeMembers(cursor);
    const receiverMs = Date.now() - startedAt;
    const receiverOnly = renderFimCandidates(members, site.partial, lineCommentFor(doc.languageId));

    const candidates = narrowToPartial(members, site.partial);
    const wanted = argumentTypeNames(candidates, doc.languageId);
    const budgetMs = forcedBudgetMs === undefined
      ? INJECTION_DEADLINE_MS - (Date.now() - startedAt) - ARG_TYPE_DEADLINE_MARGIN_MS
      : forcedBudgetMs;

    const legStart = Date.now();
    const argTypes = await resolveArgTypesInBudget(
      ex,
      { uri: cursor.uri, languageId: doc.languageId, text: doc.getText() },
      candidates,
      budgetMs,
    );
    const legMs = Date.now() - legStart;

    return {
      site, memberCount: members.length, receiverMs, receiverOnly, wanted, budgetMs, legMs,
      argTypes: argTypes.map((t) => t.name),
      totalMs: Date.now() - startedAt,
    };
  }

  test('the argument-type surface survives the real 50ms injection window', async function () {
    const ex = extractorFor(S.languageId);
    assert.ok(ex, `extractorFor(${S.languageId}) is undefined, so this row has no transport to budget`);

    const doc = await P.open(S, S.argSite.file);
    const position = P.cursorAt(doc, S.argSite);

    // The server answers provisionally while it indexes, and a member set that
    // is still growing makes every number below meaningless. Settle FIRST,
    // outside the measured window; a typing session is warm by construction.
    const warm = await P.settled(
      () => ex.completeMembers({ uri: doc.uri.toString(), line: position.line, character: position.character }),
      { key: (v) => (v || []).map((m) => m.name).sort().join(',') },
    );
    const cold = await oneKeystroke(ex, doc, position);

    const runs = [];
    for (let i = 0; i < WARM_ITERATIONS; i++) {
      runs.push(await oneKeystroke(ex, doc, position));
      await P.sleep(50);
    }

    P.report(`the injection window, ${S.argSite.file} at \`${S.argSite.needle}\``, [
      `INJECTION_DEADLINE_MS=${INJECTION_DEADLINE_MS}  margin=${ARG_TYPE_DEADLINE_MARGIN_MS}`,
      `receiver settled=${warm.settled} after ${warm.ms}ms with ${(warm.value || []).length} members`,
      `cold  receiver=${cold.receiverMs}ms  budget=${cold.budgetMs}ms  leg=${cold.legMs}ms  ` +
      `total=${cold.totalMs}ms  wanted=[${(cold.wanted || []).join(',')}]  landed=[${(cold.argTypes || []).join(',')}]`,
      ...runs.map((r, i) =>
        `warm${i} receiver=${r.receiverMs}ms  budget=${r.budgetMs}ms  leg=${r.legMs}ms  ` +
        `total=${r.totalMs}ms  members=${r.memberCount}  wanted=[${r.wanted.join(',')}]  landed=[${r.argTypes.join(',')}]`),
    ]);

    // Where the window actually goes. The receiver's member resolve is the only
    // unbounded spender in the window, and its cost is set by the resolve count
    // the transport passes to the completion command: the server resolves the
    // first N items, and on Python most of those are dunders the transport
    // filters out afterwards. This sweep is the evidence behind that constant,
    // re-measured every run rather than quoted from a session note. The second
    // render is the other half of the arithmetic - it is what the deadline
    // margin is reserved for.
    //
    // Run in BOTH directions, because one direction is not a measurement. The
    // sweep used to run the cap first every time, so every smaller count rode
    // its warm-up and read three to four times cheaper than it is: 32 -> 27-29ms
    // then 16 -> 3-4ms forward, against 11-13ms reversed. Anyone sizing a
    // receiver fix off the forward reading sizes it nearly twice too big, and
    // the two directions bracket the truth rather than either one being it.
    const counts = [P.MEMBER_RESOLVE_CAP, 16, 8, 0];
    const sweepOnce = async (order) => {
      const out = [];
      for (const n of order) {
        const at = Date.now();
        const items = P.itemsOf(await P.completions(doc.uri, position, '.', n));
        out.push(`resolveCount=${String(n).padStart(2)} -> ${Date.now() - at}ms for ${items.length} raw items`);
      }
      return out;
    };
    const sweep = [
      'descending (each count rides the one above it):',
      ...(await sweepOnce(counts)),
      'ascending (each count rides the one below it):',
      ...(await sweepOnce([...counts].reverse())),
    ];
    const settledMembers = warm.value || [];
    const renderAt = Date.now();
    for (let i = 0; i < 100; i++) {
      renderFimCandidates(settledMembers, runs[0].site.partial, lineCommentFor(doc.languageId));
    }
    P.report('where the injection window goes', [
      ...sweep,
      `render x100 over ${settledMembers.length} members: ${Date.now() - renderAt}ms total`,
    ]);

    assert.ok(runs[0].site, `memberSiteFor(${S.languageId}) does not see \`${S.argSite.needle}\` as a member site`);
    assert.ok(
      runs.every((r) => r.wanted.includes(S.typeName)),
      `the candidate members at \`${S.argSite.needle}\` never name \`${S.typeName}\` as an argument type, so this row ` +
      `is measuring a site the leg has no work to do at. wanted=${JSON.stringify(runs.map((r) => r.wanted))}`,
    );

    // The receiver block and the enforcement set must never be collateral. They
    // are already in hand when the leg starts, and losing them to a slow
    // parameter-type resolve switches off the gate that catches hallucinations.
    assert.ok(
      runs.every((r) => r.receiverOnly !== undefined),
      'a keystroke lost its receiver-only block, which was already resolved before the argument-type leg ran',
    );

    // Two different defects used to share one assertion here, and a single
    // verdict could not say which had fired: a leg that overspends what it was
    // given, and a receiver that leaves it nothing to spend. They are graded
    // apart because the fixes live in different places.

    // The leg spends what it is given. Every keystroke that handed it a viable
    // budget must come back with the construction surface; a leg that lands on
    // some keystrokes and not others renders a block whose contents change
    // while the user types.
    const viable = runs.filter((r) => r.budgetMs >= FLOOR_MS);
    const landed = viable.filter((r) => r.argTypes.includes(S.typeName)).length;
    assert.strictEqual(
      landed, viable.length,
      `on ${LANG} the argument-type surface for \`${S.typeName}\` survived on ${landed} of ${viable.length} warm ` +
      `keystrokes that gave the leg a usable budget. Budgets: ${viable.map((r) => `${r.budgetMs}ms`).join(', ')}; ` +
      `leg spent ${viable.map((r) => `${r.legMs}ms`).join(', ')}. The leg overspent a window it was given, so the ` +
      'block the model reads carries the construction arity on some keystrokes and not others.',
    );

    // The window must reach the leg at all. The receiver's own member
    // resolution runs first and is the only unbounded spender in the window; a
    // keystroke where it leaves less than the floor skips the leg entirely, and
    // the surface the whole feature exists to inject is simply absent. The
    // sweep reported above is the cost curve behind whichever constant is
    // spending it.
    //
    // The floor is PER-LANGUAGE now, so this assertion no longer means what it
    // did: a starved keystroke is one whose receiver left less than THIS
    // language's floor, and the floor itself moved on TypeScript. What it still
    // reports is unchanged and is the point — the cause is the receiver's
    // spend, never the leg's, and no budget handed to the leg can fix it.
    const starved = runs.filter((r) => r.budgetMs < FLOOR_MS);
    assert.deepStrictEqual(
      starved.map((r) => `receiver=${r.receiverMs}ms leaving ${r.budgetMs}ms`), [],
      `on ${LANG} the receiver's own member resolution consumed the injection window on ${starved.length} of ` +
      `${WARM_ITERATIONS} warm keystrokes, leaving the argument-type leg below the ${FLOOR_MS}ms floor ${LANG} ` +
      `was measured to need: ${starved.map((r) => `${r.receiverMs}ms`).join(', ')} of ${INJECTION_DEADLINE_MS}ms, ` +
      `with ${ARG_TYPE_DEADLINE_MARGIN_MS}ms of that window reserved as margin. No budget the leg is given can fix ` +
      'this; the cost is in what the receiver pays before the leg starts.',
    );

    // The whole injection is raced against INJECTION_DEADLINE_MS by the service.
    // A leg that overruns does not merely lose its own result: the receiver
    // block and the enforcement set go with it.
    const over = runs.filter((r) => r.totalMs > INJECTION_DEADLINE_MS);
    assert.deepStrictEqual(
      over.map((r) => r.totalMs), [],
      `on ${LANG} ${over.length} of ${WARM_ITERATIONS} warm keystrokes took longer than the whole ` +
      `${INJECTION_DEADLINE_MS}ms injection window (${over.map((r) => `${r.totalMs}ms`).join(', ')}). The service ` +
      'discards the entire injection at that point, so those keystrokes get no block and no enforcement set at all.',
    );
  });

  // The invariant the row above cannot reach, graded directly.
  //
  // The provider hands the leg `budgetMs = INJECTION_DEADLINE_MS - elapsed -
  // margin`, so the whole injection lands at `elapsed + legMs`. Substitute and
  // `elapsed` cancels: the injection takes `INJECTION_DEADLINE_MS - margin +
  // (legMs - budgetMs)`. A leg that returns later than `budgetMs + margin`
  // therefore pushes the total past the window for EVERY value of `elapsed`, on
  // every language, at every budget, and the service discards the receiver
  // block and the enforcement set along with the argument types. That is why
  // the first assertion below is the arithmetic and not a tuned number: no
  // measured leg cost and no language's receiver cost appears in it.
  //
  // The row above waits for a dogfood repo to wander into the regime where the
  // slip matters, and TypeScript's receiver settles at 7-9ms so it never does.
  // Forcing the budget reaches the regime on purpose.
  //
  // The other two assertions grade the per-language floor, which is the half of
  // the design that keeps the first one true: a budget under the floor must
  // start nothing, and a budget at or over it must land. Together they are
  // falsifiable in both directions — a floor set too low admits legs that spend
  // the window and land nothing, a floor set too high skips work the language
  // could have done.
  //
  // The table prints on a pass as well as a failure because it is the
  // measurement `ARG_TYPE_DEADLINE_MARGIN_MS` and the floor are set from. A
  // probe that gets reverted after the constants are chosen leaves nobody able
  // to check them.
  test('the leg never returns later than its budget plus the margin the window reserves', async function () {
    const ex = extractorFor(S.languageId);
    assert.ok(ex, `extractorFor(${S.languageId}) is undefined, so this row has no transport to budget`);

    const doc = await P.open(S, S.argSite.file);
    const position = P.cursorAt(doc, S.argSite);
    await P.settled(
      () => ex.completeMembers({ uri: doc.uri.toString(), line: position.line, character: position.character }),
      { key: (v) => (v || []).map((m) => m.name).sort().join(',') },
    );

    const runs = [];
    for (const budget of FORCED_BUDGETS_MS) {
      for (let i = 0; i < FORCED_ITERATIONS; i++) {
        const r = await oneKeystroke(ex, doc, position, budget);
        runs.push({ ...r, forced: budget, overMs: r.legMs - r.budgetMs });
        await P.sleep(50);
      }
    }

    const admitted = runs.filter((r) => r.forced >= FLOOR_MS);
    P.report(`the leg against forced budgets, margin=${ARG_TYPE_DEADLINE_MARGIN_MS} floor=${FLOOR_MS}`, [
      'budget  leg  over  landed',
      ...runs.map((r) =>
        `${String(r.forced).padStart(6)}ms ${String(r.legMs).padStart(4)}ms ` +
        `${String(r.overMs).padStart(4)}ms  [${r.argTypes.join(',')}]` +
        (r.forced < FLOOR_MS ? '  (under the floor, no leg started)' : '')),
      `worst overshoot ${Math.max(...runs.map((r) => r.overMs))}ms over ${runs.length} keystrokes`,
      `worst overshoot at or above the ${FLOOR_MS}ms floor: ` +
      `${Math.max(...admitted.map((r) => r.overMs))}ms over ${admitted.length} keystrokes`,
    ]);

    const over = runs.filter((r) => r.overMs > ARG_TYPE_DEADLINE_MARGIN_MS);
    assert.deepStrictEqual(
      over.map((r) => `budget=${r.forced}ms leg=${r.legMs}ms over by ${r.overMs}ms`), [],
      `on ${LANG} the argument-type leg returned later than its budget plus the ` +
      `${ARG_TYPE_DEADLINE_MARGIN_MS}ms margin on ${over.length} of ${runs.length} forced-budget keystrokes. ` +
      `The provider gives the leg INJECTION_DEADLINE_MS - elapsed - ${ARG_TYPE_DEADLINE_MARGIN_MS}, so an ` +
      `overshoot larger than the margin puts the whole injection past ${INJECTION_DEADLINE_MS}ms whatever the ` +
      'receiver cost, and the service then throws away the receiver block and the enforcement set too. The ' +
      'margin is the only lever on this: it must be at least the timer slip measured in the table above.',
    );

    // A budget under the floor must buy nothing at all. The failure it prevents
    // is a leg that starts, spends the whole window on a round trip it cannot
    // wait for, and returns empty - the receiver block pays for it and the
    // model gets no construction arity in exchange.
    const wasted = runs
      .filter((r) => r.forced < FLOOR_MS && r.legMs > FLOOR_MS)
      .map((r) => `budget=${r.forced}ms leg=${r.legMs}ms landed=[${r.argTypes.join(',')}]`);
    assert.deepStrictEqual(
      wasted, [],
      `on ${LANG} the leg ran at a budget under its ${FLOOR_MS}ms floor: ${wasted.join(' ; ')}. Under the floor it ` +
      'must cost nothing rather than spending a window it cannot finish inside.',
    );

    // And a budget at or above the floor must not be SPENT for nothing, or the
    // floor is set too low and is admitting exactly the waste it exists to
    // refuse.
    //
    // Spent, not merely empty. A leg that comes back inside a millisecond with
    // nothing did not waste a window: the server answered nothing, which
    // happens occasionally on every row here and is not a statement about the
    // floor. Those are reported below instead of asserted on, so a server that
    // starts answering nothing regularly is still visible.
    const quiet = admitted.filter((r) => !r.argTypes.includes(S.typeName) && r.legMs < FLOOR_MS);
    if (quiet.length) {
      P.report('the server answered nothing, inside a millisecond, at a viable budget', [
        `${quiet.length} of ${admitted.length} iterations at or above the ${FLOOR_MS}ms floor`,
        ...quiet.map((r) => `budget=${r.forced}ms leg=${r.legMs}ms`),
      ]);
    }
    const empty = admitted
      .filter((r) => !r.argTypes.includes(S.typeName) && r.legMs >= FLOOR_MS)
      .map((r) => `budget=${r.forced}ms leg=${r.legMs}ms landed=[${r.argTypes.join(',')}]`);
    assert.deepStrictEqual(
      empty, [],
      `on ${LANG} the leg spent a budget at or above its ${FLOOR_MS}ms floor and still did not land ` +
      `\`${S.typeName}\`: ${empty.join(' ; ')}. The floor sits above the worst leg this language was measured to ` +
      'cost, so a budget over it that is spent and lands nothing means the floor is too low for what the server ' +
      'now costs.',
    );
  });
});
