// Blind oracle: session-v33 phase 1, the widened `reanchorRange` and
// `ContextBlockStore.reanchor`. Written from the phase contract ALONE. src/**
// was never read: esbuild resolves `../src/core/contextBlocks` at bundle time
// only, and every expectation below is quoted from the contract or lifted
// verbatim from the resize spike, which the contract names as the source of its
// row table.
//
// Covered, and nothing else: the three `reanchorRange` outcomes, the four-case
// classification table, the resolution rules including the defensive
// start-line-below-1 leg, lost-wins, the empty change list, order independence,
// purity; and `ContextBlockStore.reanchor`'s `{moved, lost}` report, in-place
// replacement, already-lost entries, one version bump per EVENT, and the
// notify-once rule.
//
// NOT covered here on purpose: `resolveForPrompt`, `markLapsed`, `markDeleted`,
// `renameUri`. Those are phase 2 and get their own oracle.
//
// The MEASURED rows are verbatim events captured from a real extension host.
// They are a stronger fixture than anything written by hand, which is the
// standing lesson of session-v32 finding 6: a hand-written event fixture gets
// the arrival order and the character offsets wrong in exactly the ways that
// matter.
//
// Expected RED until phase 1 lands: on main `reanchorRange` answers `stale`
// where this file demands `resize` or `lost`, and `reanchor` returns a number
// where this file demands a `{moved, lost}` report.
//
// Observed on the first honest run (2026-07-28): 28 pass, 1 fail, because phase
// 1 was already in the working tree when this oracle was written. The single
// red was the contract disagreeing with itself about whether a net-zero inside
// change is a shift or a resize. This oracle read it one way, the phase-1
// implementation read it the other, and that disagreement is what surfaced it.
// The human ruled for `resize` on 2026-07-28 and corrected the contract; the
// affected rows were re-cut against the corrected sentence, never against the
// implementation. The re-cut row carries the full history.
//
// Run: SKIP_LIVE=1 node --test test/blind-v33-p1-reanchor.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

// ---- bundle: one informative failure if an export is missing, rest skip ----

let mod = null;
let bundleError = null;
let cleanup = () => {};
try {
  const built = bundleCore(
    "blind-v33-p1-reanchor",
    `export { reanchorRange, ContextBlockStore } from "../src/core/contextBlocks";\n`
  );
  mod = built.mod;
  cleanup = built.cleanup;
  for (const name of ["reanchorRange", "ContextBlockStore"]) {
    if (typeof mod[name] === "undefined") {
      throw new Error(`src/core/contextBlocks exports no \`${name}\``);
    }
  }
} catch (err) {
  bundleError = err;
}
test.after(cleanup);

test("bundle: contextBlocks exports reanchorRange and ContextBlockStore [contract: the two phase-1 sections]", () => {
  if (bundleError) {
    assert.fail(
      `cannot bundle the phase-1 contract surface, so every other row in this file skipped:\n${bundleError.message}`
    );
  }
});

const skip = bundleError
  ? "core bundle failed; see the bundle test above for the reason"
  : false;
const t = (name, fn) => test(name, { skip }, fn);

const reanchorRange = bundleError ? null : mod.reanchorRange;
const ContextBlockStore = bundleError ? null : mod.ContextBlockStore;

// ---- CALL SHAPES the contract does not state (CONTRACT GAPS) --------------
// The contract gives full signatures for `LineChange`, `reanchorRange`,
// `ContextBlockEntry` and `reanchor`, and none for `add`, `list`, or subscriber
// registration, though the reanchor section is defined in terms of all three.
// The adapters below are the only place this file leans on anything outside the
// contract. Each was settled from the store's own public surface, never by
// reading src/**.
// A1. `store.add({uri, range, text, version})` -> the created entry, and
//     `store.list()` -> the entries in list order. The contract names the entry
//     field `addedAtVersion` but not the input key that sets it.
// A2. subscriber registration is discovered by probing the public surface: the
//     contract says "subscribers are notified" and names no method.

function subscribeTo(store, listener) {
  for (const name of ["subscribe", "onChange", "onDidChange", "onDidChangeBlocks", "onDidChangeEntries"]) {
    if (typeof store[name] === "function") return store[name](listener);
  }
  assert.fail(
    "ContextBlockStore exposes no subscribe-shaped method; the contract says subscribers are 'notified once when anything changed' but names none (CONTRACT GAP)"
  );
}

// ---- the fixtures --------------------------------------------------------

// `changes` are 0-based, the shape `LineChange` carries. Note there is no start
// CHARACTER in the contract's shape, so the spike's `sc` column is dropped.
const ch = (startLine, endLine, endCharacter, newlineCount) => ({
  startLine,
  endLine,
  endCharacter,
  newlineCount,
});

// The block used in every measured event: 0-based lines 2..5, so 1-based 3..6.
const BLOCK = { startLine: 3, endLine: 6 };

// Every row marked MEASURED is a verbatim event from an extension-host run,
// transcribed from spikes/resize.spike.cjs.
//
// The four net-zero-inside rows below (rust format, prettier, WorkspaceEdit,
// and the first-line edit) asserted their range but accepted either `kind` in
// the first cut of this file, because the contract said both. See the re-cut
// row further down for what settled it.
const REANCHOR_ROWS = [
  {
    name: "MEASURED rust format: 2 changes, both inside, net 0 lines",
    changes: [ch(4, 4, 4, 0), ch(3, 3, 6, 0)],
    want: { kind: "resize", range: { startLine: 3, endLine: 6 } },
  },
  {
    name: "MEASURED prettier: 7 character edits above and inside, net 0 lines",
    changes: [
      ch(0, 0, 15, 0),
      ch(0, 0, 20, 0),
      ch(2, 2, 26, 0),
      ch(2, 2, 28, 0),
      ch(3, 3, 6, 0),
      ch(4, 4, 6, 0),
      ch(7, 7, 13, 0),
    ],
    want: { kind: "resize", range: { startLine: 3, endLine: 6 } },
  },
  {
    name: "MEASURED external edit above the block (the git-pull shape) is a shift",
    changes: [ch(0, 1, 0, 1)],
    want: { kind: "shift", range: { startLine: 3, endLine: 6 } },
  },
  {
    name: "MEASURED THE HUMAN CASE: insert 2 lines inside the block grows it by 2 [resize shape: insert inside]",
    changes: [ch(3, 3, 0, 2)],
    want: { kind: "resize", range: { startLine: 3, endLine: 8 } },
  },
  {
    name: "MEASURED delete a line inside the block shrinks it by 1 [resize shape: delete inside]",
    changes: [ch(3, 4, 0, 0)],
    want: { kind: "resize", range: { startLine: 3, endLine: 5 } },
  },
  {
    name: "MEASURED head overlap: replace L1-L3 with 3 lines crosses the top boundary and is LOST",
    changes: [ch(1, 3, 0, 3)],
    want: { kind: "lost" },
  },
  {
    name: "MEASURED containment: replace L0-L6 with 1 line swallows the block and is LOST",
    changes: [ch(0, 6, 0, 1)],
    want: { kind: "lost" },
  },
  {
    name: "MEASURED two inserts in ONE event arriving DESCENDING: one above, one inside",
    changes: [ch(3, 3, 0, 1), ch(0, 0, 0, 1)],
    want: { kind: "resize", range: { startLine: 4, endLine: 8 } },
  },
  {
    name: "the same two inserts ASCENDING answer identically (order independence)",
    changes: [ch(0, 0, 0, 1), ch(3, 3, 0, 1)],
    want: { kind: "resize", range: { startLine: 4, endLine: 8 } },
  },
  {
    name: "MEASURED WorkspaceEdit from outside: a replace arrives as 6 delete+insert changes",
    changes: [
      ch(7, 7, 0, 1),
      ch(3, 3, 15, 0),
      ch(3, 3, 14, 0),
      ch(0, 0, 12, 0),
      ch(0, 0, 11, 0),
      ch(0, 0, 7, 0),
    ],
    want: { kind: "resize", range: { startLine: 3, endLine: 6 } },
  },
  {
    name: "MEASURED the zero-change second event is a shift with the range unchanged, never lost",
    changes: [],
    want: { kind: "shift", range: { startLine: 3, endLine: 6 } },
  },
  {
    name: "MEASURED undo of the inside insert shrinks the block back",
    changes: [ch(3, 4, 0, 0)],
    want: { kind: "resize", range: { startLine: 3, endLine: 5 } },
  },
  {
    name: "retype the block exactly: selecting its own lines and replacing with 6 resizes, never lost [resize shape: replace inside with MORE lines]",
    changes: [ch(2, 5, 1, 5)],
    want: { kind: "resize", range: { startLine: 3, endLine: 8 } },
  },
  {
    name: "press Enter at the very start of the block: an insert ending at char 0 of the first line is ABOVE",
    changes: [ch(2, 2, 0, 1)],
    want: { kind: "shift", range: { startLine: 4, endLine: 7 } },
  },
  {
    name: "an edit inside the block's FIRST line is never mistaken for a head overlap",
    changes: [ch(2, 2, 20, 0)],
    want: { kind: "resize", range: { startLine: 3, endLine: 6 } },
  },
  {
    name: "delete the block down to nothing leaves a one-line range, not a loss [resize shape: replace inside with FEWER lines]",
    changes: [ch(2, 5, 1, 0)],
    want: { kind: "resize", range: { startLine: 3, endLine: 3 } },
  },
  {
    name: "one event mixing an above insert and a crossing replace is LOST: lost wins over any shift",
    changes: [ch(0, 0, 0, 1), ch(1, 3, 0, 3)],
    want: { kind: "lost" },
  },
  // Derived from the resolution rules rather than from a measurement.
  {
    name: "a shift delta that drives the start line below 1 is LOST, because the deltas disagree with the classification",
    // two ABOVE changes (endLine === firstLine0, endCharacter 0) of -2 each.
    changes: [ch(0, 2, 0, 0), ch(0, 2, 0, 0)],
    want: { kind: "lost" },
  },
  {
    name: "a change entirely below the block is ignored and leaves a zero-delta shift",
    changes: [ch(8, 9, 4, 0)],
    want: { kind: "shift", range: { startLine: 3, endLine: 6 } },
  },
];

function checkRow(row) {
  const where = `row: ${row.name}`;
  const got = reanchorRange({ ...BLOCK }, row.changes);

  if (row.want.kind === "lost") {
    assert.deepStrictEqual(
      got,
      { kind: "lost", reason: "crossed" },
      `${where} -> expected {kind:"lost", reason:"crossed"}, got ${JSON.stringify(got)}`
    );
    return;
  }

  assert.notStrictEqual(
    got && got.kind,
    "lost",
    `${where} -> must survive this event, got ${JSON.stringify(got)}`
  );
  assert.deepStrictEqual(
    got && got.range,
    row.want.range,
    `${where} -> wrong resolved range, got ${JSON.stringify(got)}`
  );

  assert.strictEqual(
    got.kind,
    row.want.kind,
    `${where} -> wrong outcome kind, got ${JSON.stringify(got)}`
  );
}

for (const row of REANCHOR_ROWS) {
  t(`reanchorRange: ${row.name} [contract: "Rows the tests must carry"]`, () => checkRow(row));
}

// ============================================================================
// reanchorRange: the rules the row table cannot express
// ============================================================================

t('an INSIDE change with a net line delta of zero is a RESIZE, not a shift [contract: "Any change classified INSIDE yields `resize`, even when its net line delta is zero"]', () => {
  // RE-CUT 2026-07-28 on a corrected contract, and the history matters because
  // the diff otherwise looks like an oracle bent to fit the code.
  //
  // The first cut of this row asserted `shift`, bound to a contract sentence
  // that read "`endDelta !== 0` yields `resize`. Otherwise `shift`". That
  // sentence contradicted the contract's own row table, which called the same
  // four events resize. This oracle and the phase-1 implementation, working
  // without sight of each other, read the contradiction opposite ways, which is
  // how it surfaced at all. The human ruled for `resize` and rewrote the
  // sentence: `shift` means "the block moved, its content did not", so a
  // formatter rewriting bytes inside the block cannot be a shift whatever it
  // did to the line count. This row is re-cut against the corrected sentence,
  // not against the implementation.
  //
  // Two formatter events measured in a real extension host land here, so it is
  // worth being precise: a net-zero inside change resizes by zero lines.
  const oneChange = reanchorRange({ ...BLOCK }, [ch(2, 2, 20, 0)]);
  assert.deepStrictEqual(
    oneChange,
    { kind: "resize", range: { startLine: 3, endLine: 6 } },
    "typing inside the block's first line changes its content, so it resizes by zero"
  );

  // and the same holds when several inside changes cancel out rather than each
  // being zero: MEASURED rust format, one change of -0 and one of +0.
  const manyChanges = reanchorRange({ ...BLOCK }, [ch(4, 4, 4, 0), ch(3, 3, 6, 0)]);
  assert.deepStrictEqual(
    manyChanges,
    { kind: "resize", range: { startLine: 3, endLine: 6 } },
    "a formatter's minimal edits inside the block resize it, they do not shift it"
  );

  // the control, so this row cannot pass by a classifier that answers resize to
  // everything: an event whose changes are all ABOVE is still a shift, even
  // when its shift delta is zero.
  assert.deepStrictEqual(
    reanchorRange({ ...BLOCK }, [ch(0, 1, 0, 1)]),
    { kind: "shift", range: { startLine: 3, endLine: 6 } },
    "the git-pull shape touches nothing inside the block, so it shifts by zero"
  );
});

t("the same event answers identically whichever order its changes arrive in, because every change is classified against the PRE-EVENT range", () => {
  // Measured events arrive DESCENDING (v32 finding 6, reconfirmed by v33
  // finding 6) and nothing in the rule may notice.
  const events = [
    {
      name: "MEASURED prettier, 7 changes",
      changes: REANCHOR_ROWS[1].changes,
    },
    {
      name: "MEASURED WorkspaceEdit, 6 changes",
      changes: REANCHOR_ROWS[9].changes,
    },
    {
      name: "one above insert and one inside insert",
      changes: [ch(0, 0, 0, 1), ch(3, 3, 0, 1)],
    },
    {
      name: "an above insert and a crossing replace, which must be lost either way",
      changes: [ch(0, 0, 0, 1), ch(1, 3, 0, 3)],
    },
  ];

  for (const event of events) {
    const ascending = [...event.changes].sort((a, b) => a.startLine - b.startLine);
    const descending = [...ascending].reverse();
    const asc = reanchorRange({ ...BLOCK }, ascending);
    const desc = reanchorRange({ ...BLOCK }, descending);
    assert.deepStrictEqual(
      desc,
      asc,
      `event: ${event.name} -> descending gave ${JSON.stringify(desc)} but ascending gave ${JSON.stringify(asc)}`
    );
  }
});

t("reanchorRange is pure: it mutates neither the range nor the change list", () => {
  const range = { startLine: 3, endLine: 6 };
  const changes = [ch(0, 0, 0, 1), ch(3, 3, 0, 2), ch(8, 9, 4, 0)];
  const rangeBefore = JSON.parse(JSON.stringify(range));
  const changesBefore = JSON.parse(JSON.stringify(changes));

  reanchorRange(range, changes);

  assert.deepStrictEqual(range, rangeBefore, "the input range was mutated");
  assert.deepStrictEqual(changes, changesBefore, "the input change list was mutated");
});

// ============================================================================
// ContextBlockStore.reanchor
// ============================================================================

const URI = "file:///w/live.ts";
const OTHER_URI = "file:///w/other.ts";

// A real multi-line TypeScript document, long enough that every measured change
// and every block below addresses a line that exists.
const BASE_LINES = [
  /*  1 */ 'import { foo } from "./foo";',
  /*  2 */ "",
  /*  3 */ "export function beta(x: number): number {",
  /*  4 */ "  const y = foo(x);",
  /*  5 */ "  return y + 1;",
  /*  6 */ "}",
  /*  7 */ "",
  /*  8 */ "export function gamma(): void {",
  /*  9 */ "  beta(2);",
  /* 10 */ "}",
  /* 11 */ "",
  /* 12 */ "export const NAME = 'column-80';",
  /* 13 */ "",
  /* 14 */ "export function delta(n: number): number {",
  /* 15 */ "  return n * 2;",
  /* 16 */ "}",
  /* 17 */ "",
  /* 18 */ "export function epsilon(): void {",
  /* 19 */ "  delta(3);",
  /* 20 */ "}",
  /* 21 */ "",
  /* 22 */ "export function zeta(): void {",
  /* 23 */ "  epsilon();",
  /* 24 */ "}",
];

// 1-based inclusive, exactly as `ContextBlockEntry.range` is defined.
const sliceOf = (range) => BASE_LINES.slice(range.startLine - 1, range.endLine).join("\n");

// Versions are deliberately not 1, so "advanced once per EVENT" cannot pass by
// accident on a store that counts changes instead.
const V1 = 7;
const V2 = 8;
const V3 = 9;

const addBlock = (store, uri, range, version = V1) =>
  store.add({ uri, range: { ...range }, text: sliceOf(range), version });

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

t('reanchor answers with a {moved, lost} report, and `lost` is empty when nothing was lost [contract: "{ moved: number; lost: readonly ContextBlockEntry[] }"]', () => {
  const store = new ContextBlockStore();
  addBlock(store, URI, BLOCK);

  const report = store.reanchor(URI, [ch(3, 3, 0, 2)], V2);

  assert.strictEqual(
    typeof report,
    "object",
    `reanchor must return a ReanchorReport object, got ${typeof report} (${JSON.stringify(report)})`
  );
  assert.strictEqual(typeof report.moved, "number", "report.moved is a count");
  assert.ok(Array.isArray(report.lost), "report.lost is an array of entries");
  assert.strictEqual(report.moved, 1, "the resized entry moved");
  assert.deepStrictEqual(report.lost, [], "nothing was lost, so report.lost is empty");
});

t("a shift or a resize replaces the entry in place, preserving its id, its text and its position in the list", () => {
  const store = new ContextBlockStore();
  const above = addBlock(store, URI, { startLine: 1, endLine: 2 });
  const target = addBlock(store, URI, BLOCK);
  const below = addBlock(store, URI, { startLine: 8, endLine: 10 });
  const elsewhere = addBlock(store, OTHER_URI, BLOCK);
  const ids = [above.id, target.id, below.id, elsewhere.id];
  const texts = [above.text, target.text, below.text, elsewhere.text];

  // THE HUMAN CASE: two lines inserted inside the target block.
  const report = store.reanchor(URI, [ch(3, 3, 0, 2)], V2);

  const after = store.list();
  assert.deepStrictEqual(after.map((e) => e.id), ids, "ids and list order preserved");
  assert.deepStrictEqual(after.map((e) => e.text), texts, "text is the last known slice and this event did not touch it");
  assert.deepStrictEqual(
    after.map((e) => e.range),
    [
      { startLine: 1, endLine: 2 }, // the change is below it
      { startLine: 3, endLine: 8 }, // resized by +2
      { startLine: 10, endLine: 12 }, // shifted by +2
      { startLine: 3, endLine: 6 }, // another uri, untouched
    ],
    "ranges resolved per entry"
  );
  assert.deepStrictEqual(
    after.map((e) => e.addedAtVersion),
    [V2, V2, V2, V1],
    "every entry in this uri carries the event's version; the other uri's does not"
  );
  for (const entry of after) {
    assert.strictEqual(hasOwn(entry, "lost"), false, `a healthy entry carries no \`lost\` key, saw ${JSON.stringify(entry)}`);
    assert.strictEqual(hasOwn(entry, "lapsed"), false, `a healthy entry carries no \`lapsed\` key, saw ${JSON.stringify(entry)}`);
  }
  assert.strictEqual(
    report.moved,
    3,
    "moved counts entries whose range OR version changed, so the untouched-range entry above the change still counts"
  );
});

t("a crossed entry is marked lost in place, keeps the range and text it had, and is reported in list order", () => {
  const store = new ContextBlockStore();
  const first = addBlock(store, URI, BLOCK); // 3..6
  const second = addBlock(store, URI, { startLine: 9, endLine: 10 });
  const survivor = addBlock(store, URI, { startLine: 22, endLine: 24 });

  // one replace spanning 0-based L1..L10, which crosses both of the first two
  // blocks and sits entirely above the third.
  const report = store.reanchor(URI, [ch(1, 10, 0, 2)], V2);

  assert.deepStrictEqual(
    report.lost.map((e) => e.id),
    [first.id, second.id],
    "report.lost carries the entries lost by THIS event, in list order"
  );
  for (const entry of report.lost) {
    assert.strictEqual(entry.lost, "crossed", `a boundary crossing loses the block with reason "crossed"`);
  }

  const after = store.list();
  assert.deepStrictEqual(after.map((e) => e.id), [first.id, second.id, survivor.id], "list position preserved");
  assert.deepStrictEqual(
    after[0].range,
    { startLine: 3, endLine: 6 },
    "a lost entry keeps the range it had, so the panel can still say where the block used to be"
  );
  assert.strictEqual(after[0].text, first.text, "and keeps its last known text");
  assert.strictEqual(after[1].lost, "crossed", "the second lost entry is marked in place too");
  assert.deepStrictEqual(
    after[2].range,
    { startLine: 15, endLine: 17 },
    "the surviving block below shifted by the change's net delta of -7"
  );

  // A lost entry's version stops at the last version anyone can honestly claim
  // the range was exact at, which is the one BEFORE the event that lost it.
  assert.deepStrictEqual(
    after.map((e) => e.addedAtVersion),
    [V1, V1, V2],
    "a lost entry's version stops advancing at the moment of loss; only the survivor takes the event's version"
  );
  assert.strictEqual(
    report.moved,
    1,
    "moved counts entries whose range or version changed, and a lost entry changed neither, so two losses and one shift is moved:1"
  );
});

t("an entry already lost is skipped: a later event neither re-reports it nor returns it to health", () => {
  const store = new ContextBlockStore();
  const doomed = addBlock(store, URI, BLOCK);
  const healthy = addBlock(store, URI, { startLine: 14, endLine: 16 });

  const first = store.reanchor(URI, [ch(1, 3, 0, 3)], V2);
  assert.deepStrictEqual(first.lost.map((e) => e.id), [doomed.id], "the first event loses it");
  const atLoss = { ...store.list()[0] };

  // a second, entirely innocent event: one line inserted at the top.
  const second = store.reanchor(URI, [ch(0, 0, 0, 1)], V3);

  assert.deepStrictEqual(second.lost, [], "a second event does not re-report an entry already lost");
  const after = store.list()[0];
  assert.strictEqual(after.lost, "crossed", "it never returns to health on its own");
  assert.deepStrictEqual(after.range, atLoss.range, "a skipped entry's range is not re-anchored");
  assert.strictEqual(after.text, atLoss.text, "nor is its text touched");
  assert.strictEqual(
    after.addedAtVersion,
    atLoss.addedAtVersion,
    "nor its version: skipped means skipped"
  );
  assert.deepStrictEqual(
    store.list()[1].range,
    { startLine: 16, endLine: 18 },
    "while the healthy entry alongside it still tracks the edit: +1 from each of the two events"
  );
  assert.strictEqual(second.moved, 1, "only the healthy entry moved");
});

t("one event advances the version exactly once, however many changes it carries", () => {
  const store = new ContextBlockStore();
  addBlock(store, URI, BLOCK);

  // MEASURED prettier: 7 changes in a single event.
  store.reanchor(URI, REANCHOR_ROWS[1].changes, V2);

  const entry = store.list()[0];
  assert.strictEqual(
    entry.addedAtVersion,
    V2,
    `the version must land on the EVENT's version, not on ${V1} plus the number of changes`
  );
  assert.deepStrictEqual(entry.range, { startLine: 3, endLine: 6 }, "and the range is unchanged by 7 character edits");
});

t("subscribers are notified once when the event changed something, and not at all when it changed nothing", () => {
  const store = new ContextBlockStore();
  addBlock(store, URI, BLOCK);
  addBlock(store, URI, { startLine: 14, endLine: 16 });
  let notifications = 0;
  subscribeTo(store, () => {
    notifications += 1;
  });

  // MEASURED: every edit fires a second event at the SAME version carrying zero
  // changes. Reading that as a change flags every block on every save.
  const quiet = store.reanchor(URI, [], V1);
  assert.strictEqual(quiet.moved, 0, "a zero-change event at the same version moved nothing");
  assert.deepStrictEqual(quiet.lost, [], "and lost nothing");
  assert.strictEqual(notifications, 0, "so subscribers hear nothing");

  const absent = store.reanchor("file:///w/absent.ts", [ch(0, 0, 0, 1)], V2);
  assert.strictEqual(absent.moved, 0, "an event for a uri with no entries moves nothing");
  assert.strictEqual(notifications, 0, "and is silent too");

  store.reanchor(URI, [ch(0, 0, 0, 1)], V2);
  assert.strictEqual(notifications, 1, "two entries moved in one event, and that is ONE notification");

  store.reanchor(URI, [ch(2, 8, 0, 1)], V3);
  assert.strictEqual(notifications, 2, "losing a block is a change, so it notifies once as well");
});

t("an event that only lost blocks and moved none still notifies, because the panel has to repaint those rows red", () => {
  // The isolating case the row above cannot make: there, the losing event also
  // shifted a survivor, so a store that only notified on `moved` would still
  // have passed. Here nothing moves at all and the notification must fire on
  // the loss alone.
  const store = new ContextBlockStore();
  addBlock(store, URI, BLOCK);
  addBlock(store, URI, { startLine: 4, endLine: 5 });
  let notifications = 0;
  subscribeTo(store, () => {
    notifications += 1;
  });

  // MEASURED containment: replace L0-L6 with 1 line swallows both blocks, and
  // there is no third entry left to move.
  const report = store.reanchor(URI, [ch(0, 6, 0, 1)], V2);

  assert.strictEqual(report.lost.length, 2, "both blocks were swallowed");
  assert.strictEqual(report.moved, 0, "and nothing moved, because a lost entry does not count");
  assert.strictEqual(
    notifications,
    1,
    "an all-lost event still notifies exactly once: moved:0 is not the same as nothing changed"
  );
});
