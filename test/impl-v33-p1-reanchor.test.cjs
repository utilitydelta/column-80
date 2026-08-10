// White-box tests for the widened anchor (session-v33 phase 1).
//
// v32's re-anchor had two answers: shift, or stale. This session gives it
// three: shift, resize, lost. `stale` is gone from the outcome type, because
// under live semantics a block's own lines are SUPPOSED to change and "the
// text moved" stopped being news.
//
// The first table below is `session-v33/spikes/resize.spike.cjs` ported case
// for case. Every row marked MEASURED is a verbatim change event captured from
// a real extension host, which is a stronger fixture than anything written by
// hand (session-v32 finding 6 is the standing reminder of what hand-written
// event fixtures get wrong). The spike's block is 1-based 3..6 throughout.
//
// Run: SKIP_LIVE=1 node --test test/impl-v33-p1-reanchor.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-v33-p1-reanchor",
  `export { reanchorRange, sliceLines, ContextBlockStore } from "../src/core/contextBlocks";`,
);
test.after(cleanup);

const { reanchorRange, sliceLines, ContextBlockStore } = mod;

// A change as the vscode adapter reduces it: the 0-based replaced range plus
// the newline count of the replacement text.
const ch = (startLine, endLine, endCharacter, newlineCount) => ({
  startLine,
  endLine,
  endCharacter,
  newlineCount,
});
const insertLinesAt = (line, count) => ch(line, line, 0, count);

// The block every spike case is measured against: 0-based 2..5.
const BLOCK = { startLine: 3, endLine: 6 };

const shift = (startLine, endLine) => ({ kind: "shift", range: { startLine, endLine } });
const resize = (startLine, endLine) => ({ kind: "resize", range: { startLine, endLine } });
const LOST = { kind: "lost", reason: "crossed" };

// ===========================================================================
// The spike table. Same cases, same answers, now split into shift vs resize
// because the shipped outcome distinguishes them and the spike did not.
// ===========================================================================

const SPIKE_CASES = [
  {
    name: "MEASURED rust format: 2 changes, both inside, net 0 lines",
    changes: [ch(4, 4, 4, 0), ch(3, 3, 6, 0)],
    want: resize(3, 6),
  },
  {
    name: "MEASURED prettier: character-level edits above and inside, net 0 lines",
    changes: [
      ch(0, 0, 15, 0),
      ch(0, 0, 20, 0),
      ch(2, 2, 26, 0),
      ch(2, 2, 28, 0),
      ch(3, 3, 6, 0),
      ch(4, 4, 6, 0),
      ch(7, 7, 13, 0),
    ],
    want: resize(3, 6),
  },
  {
    name: "MEASURED external edit above the block (the git-pull shape)",
    changes: [ch(0, 1, 0, 1)],
    want: shift(3, 6),
  },
  {
    name: "MEASURED THE HUMAN CASE: insert 2 lines inside the block",
    changes: [ch(3, 3, 0, 2)],
    want: resize(3, 8),
  },
  {
    name: "MEASURED delete a line inside the block",
    changes: [ch(3, 4, 0, 0)],
    want: resize(3, 5),
  },
  {
    name: "MEASURED head overlap: replace L1-L3 with 3 lines is LOST",
    changes: [ch(1, 3, 0, 3)],
    want: LOST,
  },
  {
    name: "MEASURED containment: replace L0-L6 with 1 line is LOST",
    changes: [ch(0, 6, 0, 1)],
    want: LOST,
  },
  {
    name: "MEASURED two inserts in ONE event, DESCENDING order",
    changes: [ch(3, 3, 0, 1), ch(0, 0, 0, 1)],
    want: resize(4, 8),
  },
  {
    name: "the same two inserts ASCENDING (order independence)",
    changes: [ch(0, 0, 0, 1), ch(3, 3, 0, 1)],
    want: resize(4, 8),
  },
  {
    name: "MEASURED WorkspaceEdit from outside: a replace arrives as delete+insert pairs",
    changes: [
      ch(7, 7, 0, 1),
      ch(3, 3, 15, 0),
      ch(3, 3, 14, 0),
      ch(0, 0, 12, 0),
      ch(0, 0, 11, 0),
      ch(0, 0, 7, 0),
    ],
    want: resize(3, 6),
  },
  {
    name: "MEASURED the zero-change second event",
    changes: [],
    want: shift(3, 6),
  },
  {
    name: "MEASURED undo of the inside insert",
    changes: [ch(3, 4, 0, 0)],
    want: resize(3, 5),
  },
  {
    name: "retype the block EXACTLY: select its own lines, replace with 6 lines",
    changes: [ch(2, 5, 1, 5)],
    want: resize(3, 8),
  },
  {
    name: "press Enter at the very start of the block: insert at L2C0 is ABOVE",
    changes: [ch(2, 2, 0, 1)],
    want: shift(4, 7),
  },
  {
    name: "edit inside the block's first LINE (typing in the signature) resizes, never lost",
    changes: [ch(2, 2, 20, 0)],
    want: resize(3, 6),
  },
  {
    name: "delete the block down to nothing",
    changes: [ch(2, 5, 1, 0)],
    want: resize(3, 3),
  },
  {
    name: "one event mixing an above insert and a crossing replace: LOST wins",
    changes: [ch(0, 0, 0, 1), ch(1, 3, 0, 3)],
    want: LOST,
  },
];

for (const c of SPIKE_CASES) {
  test(`spike: ${c.name}`, () => {
    assert.deepStrictEqual(reanchorRange(BLOCK, c.changes), c.want);
  });
}

// ===========================================================================
// The four resize shapes the goal names, each on its own row.
// ===========================================================================

test("resize shape 1: insert inside grows the end and leaves the start alone", () => {
  assert.deepStrictEqual(reanchorRange({ startLine: 10, endLine: 14 }, [insertLinesAt(11, 3)]), resize(10, 17));
});

test("resize shape 2: delete inside shrinks the end and leaves the start alone", () => {
  assert.deepStrictEqual(reanchorRange({ startLine: 10, endLine: 14 }, [ch(11, 13, 0, 0)]), resize(10, 12));
});

test("resize shape 3: replace inside with MORE lines", () => {
  assert.deepStrictEqual(reanchorRange({ startLine: 10, endLine: 14 }, [ch(10, 12, 0, 5)]), resize(10, 17));
});

test("resize shape 4: replace inside with FEWER lines", () => {
  assert.deepStrictEqual(reanchorRange({ startLine: 10, endLine: 14 }, [ch(10, 13, 0, 1)]), resize(10, 12));
});

// ===========================================================================
// Boundaries. Each of these is one classification decision away from a
// different answer, which is why they are rows rather than a table.
// ===========================================================================

test("a change entirely above shifts both bounds and is NEVER a resize", () => {
  assert.deepStrictEqual(reanchorRange({ startLine: 10, endLine: 14 }, [insertLinesAt(0, 1)]), shift(11, 15));
  assert.deepStrictEqual(reanchorRange({ startLine: 10, endLine: 14 }, [ch(1, 3, 0, 0)]), shift(8, 12));
});

test("a change entirely below is ignored, and the answer is a zero shift", () => {
  assert.deepStrictEqual(reanchorRange({ startLine: 10, endLine: 14 }, [insertLinesAt(20, 3)]), shift(10, 14));
});

test("the block's FIRST line boundary is decided by the character, not the line", () => {
  const range = { startLine: 10, endLine: 14 }; // 0-based first line is 9.
  // Ending at column 0 of the first line lands before the block's first byte:
  // above, so the block moves down whole.
  assert.deepStrictEqual(reanchorRange(range, [ch(9, 9, 0, 1)]), shift(11, 15));
  // One column further in touches the block's own text: inside, so it resizes.
  assert.deepStrictEqual(reanchorRange(range, [ch(9, 9, 1, 1)]), resize(10, 15));
});

test("the block's LAST line boundary: a replaced range ending at character 0 does not touch that line", () => {
  const range = { startLine: 10, endLine: 14 }; // 0-based last line is 13.
  // Ends at column 0 of line 14: the last line it TOUCHES is 13, still inside.
  // Deleting lines 12 and 13 whole, from column 0, takes two lines with it.
  assert.deepStrictEqual(
    reanchorRange(range, [{ ...ch(12, 14, 0, 0), endsAtLineStart: true }]),
    resize(10, 12),
  );
  // The same span ending one column into line 14 crosses the tail.
  assert.deepStrictEqual(reanchorRange(range, [ch(12, 14, 1, 0)]), LOST);
});

test("the block's LAST line boundary: the same span that does NOT end at a line start keeps a line", () => {
  const range = { startLine: 10, endLine: 14 };
  // The identical replaced span, but starting mid-line 12 (or replacing with
  // text that has no trailing newline). Line 12 survives, carrying what used to
  // be line 14 joined onto it, so the block ends one line later than the
  // column-0 deletion above. The two rows differ ONLY in `endsAtLineStart`,
  // which is the whole reason the field exists.
  assert.deepStrictEqual(
    reanchorRange(range, [{ ...ch(12, 14, 0, 0), endsAtLineStart: false }]),
    resize(10, 13),
  );
});

test("a single-line change ON the last line is inside, not a crossing", () => {
  // endCharacter is not load-bearing when endLine === startLine: the change
  // cannot reach past the line it starts on.
  assert.deepStrictEqual(reanchorRange({ startLine: 10, endLine: 14 }, [ch(13, 13, 40, 0)]), resize(10, 14));
});

test("a change that starts above and ends inside is lost", () => {
  assert.deepStrictEqual(reanchorRange({ startLine: 10, endLine: 14 }, [ch(8, 10, 4, 0)]), LOST);
});

test("a change that starts inside and ends below is lost", () => {
  assert.deepStrictEqual(reanchorRange({ startLine: 10, endLine: 14 }, [ch(12, 18, 4, 0)]), LOST);
});

test("a whole-document replacement is lost, with no special case for it", () => {
  assert.deepStrictEqual(reanchorRange({ startLine: 10, endLine: 14 }, [ch(0, 40, 0, 2)]), LOST);
});

test("an empty change list is a shift with the range unchanged, never lost", () => {
  // The second event of every edit in every language (finding 3, finding 6).
  assert.deepStrictEqual(reanchorRange({ startLine: 10, endLine: 14 }, []), shift(10, 14));
});

test("a resolved start line above line 1 is lost, because the deltas disagree with the classification", () => {
  const above = ch(0, 9, 0, 0); // ends at character 0 of the block's first line: above, -9.
  assert.deepStrictEqual(reanchorRange({ startLine: 10, endLine: 14 }, [above, { ...above }]), LOST);
});

test("a resolved end line above the start line is lost, however the deltas got there", () => {
  // Deleting the block's five lines INCLUDING its final newline, from column 0:
  // inside by the line test (it ends at character 0 of the line after), and
  // `endsAtLineStart` is true because the deletion started at a line start, so
  // the tail correction does not apply and -5 on a 5-line block leaves nothing.
  assert.deepStrictEqual(
    reanchorRange({ startLine: 10, endLine: 14 }, [{ ...ch(9, 14, 0, 0), endsAtLineStart: true }]),
    LOST,
  );
});

test("lost wins over any number of clean shifts, in either order", () => {
  const range = { startLine: 10, endLine: 14 };
  const changes = [insertLinesAt(0, 1), ch(8, 10, 3, 0), insertLinesAt(2, 1)];
  assert.deepStrictEqual(reanchorRange(range, changes), LOST);
  assert.deepStrictEqual(reanchorRange(range, [...changes].reverse()), LOST);
});

test("mixed above and inside changes sum independently: the start takes only the shift", () => {
  const range = { startLine: 10, endLine: 14 };
  const changes = [insertLinesAt(0, 2), insertLinesAt(11, 3)];
  assert.deepStrictEqual(reanchorRange(range, changes), resize(12, 19));
  assert.deepStrictEqual(reanchorRange(range, [...changes].reverse()), resize(12, 19), "order independent");
});

test("a shift of zero is still a shift when nothing inside moved", () => {
  // Typing a character on a line above the block: delta 0, endDelta 0.
  assert.deepStrictEqual(reanchorRange({ startLine: 10, endLine: 14 }, [ch(3, 3, 12, 0)]), shift(10, 14));
});

test("an inside change of zero net lines is still a RESIZE, not a shift", () => {
  // The distinction is what the panel and the toast key off: the block's own
  // bytes changed even though its line count did not.
  assert.deepStrictEqual(reanchorRange({ startLine: 10, endLine: 14 }, [ch(11, 11, 4, 0)]), resize(10, 14));
});

test("a one-line block resizes and is lost by the same rules as any other", () => {
  assert.deepStrictEqual(reanchorRange({ startLine: 5, endLine: 5 }, [ch(4, 4, 3, 2)]), resize(5, 7));
  assert.deepStrictEqual(reanchorRange({ startLine: 5, endLine: 5 }, [ch(3, 4, 2, 0)]), LOST);
});

// ===========================================================================
// The tail boundary, three concrete gestures.
//
// A replaced range ending at character 0 of the line AFTER the block does not
// touch that line, so it is INSIDE. But the line boundary it consumed sits
// BETWEEN the block and the line below it, so the block does not pay for it
// unless the replacement puts that boundary back. Every row here is a gesture
// a human performs by accident, and every one of them handed the model a
// function with no closing brace until 2026-07-28.
//
// Found by adversarial review AFTER the phase-1 blind oracle passed: the
// oracle never pinned the shape, so the arithmetic was wrong and green.
// ===========================================================================

const DOC = [
  'import { Stripe } from "./stripe";', // L1
  "", // L2
  "export function audit(n: number): number {", // L3
  "  const x = n - 1;", // L4
  "  return x;", // L5
  "}", // L6
  "", // L7
  "export function other(): void {}", // L8
].join("\n");

const lineOffset = (text, line) => {
  const lines = text.split("\n");
  let offset = 0;
  for (let i = 0; i < line; i++) {
    offset += lines[i].length + 1;
  }
  return offset;
};

// Apply one VS Code content change to `text`; `sc`/`ec` are 0-based characters.
const applyChange = (text, { sl, sc, el, ec, repl }) =>
  text.slice(0, lineOffset(text, sl) + sc) + repl + text.slice(lineOffset(text, el) + ec);

// The same change reduced the way the vscode layer reduces it, `endsAtLineStart`
// included, so these rows exercise the bit a hand-written fixture would omit.
const asLineChange = ({ sl, sc, el, ec, repl }) => ({
  startLine: sl,
  endLine: el,
  endCharacter: ec,
  newlineCount: repl.split("\n").length - 1,
  endsAtLineStart: repl.endsWith("\n") || (repl.length === 0 && sc === 0),
});

test("tail: joining the following line onto the block's last line keeps every line of the block", () => {
  // The block is the whole `audit` function, L3-L6. The human puts the cursor
  // at the end of `}` and presses Delete (Backspace at the start of L7 is the
  // same event): replace [5:1 .. 6:0) with "". Nothing of the block is deleted.
  const edit = { sl: 5, sc: 1, el: 6, ec: 0, repl: "" };
  const after = applyChange(DOC, edit);
  const whole = "export function audit(n: number): number {\n  const x = n - 1;\n  return x;\n}";
  assert.strictEqual(sliceLines(after, BLOCK), whole, "sanity: still four whole lines at L3-L6");

  const out = reanchorRange(BLOCK, [asLineChange(edit)]);
  assert.deepStrictEqual(out, resize(3, 6));
  assert.strictEqual(sliceLines(after, out.range), whole, "the closing brace is still in the range");
});

test("tail: the same gesture on a SINGLE-line block keeps the block, rather than losing it", () => {
  // Block over L4 alone. Delete at the end of L4: replace [3:18 .. 4:0) with "".
  const block = { startLine: 4, endLine: 4 };
  const edit = { sl: 3, sc: DOC.split("\n")[3].length, el: 4, ec: 0, repl: "" };
  const after = applyChange(DOC, edit);
  const out = reanchorRange(block, [asLineChange(edit)]);
  assert.deepStrictEqual(out, resize(4, 4), "an edit that deletes none of the block cannot destroy it");
  assert.strictEqual(sliceLines(after, out.range), "  const x = n - 1;  return x;");
});

test("tail: select through column 0 of the following line and retype ONE line with no trailing newline", () => {
  // Replace [2:0 .. 6:0) with a single line that does not end in a newline. The
  // contract's "retype the block exactly" row survives because its replacement
  // happens to end on a line boundary; one line short of that and the block died.
  const edit = { sl: 2, sc: 0, el: 6, ec: 0, repl: "export const audit = (n) => n - 1;" };
  const after = applyChange(DOC, edit);
  const out = reanchorRange(BLOCK, [asLineChange(edit)]);
  assert.deepStrictEqual(out, resize(3, 3));
  assert.strictEqual(sliceLines(after, out.range), "export const audit = (n) => n - 1;");
});

test("reanchorRange mutates neither argument", () => {
  const range = Object.freeze({ startLine: 10, endLine: 14 });
  const changes = Object.freeze([Object.freeze(insertLinesAt(0, 2)), Object.freeze(insertLinesAt(11, 1))]);
  const before = JSON.parse(JSON.stringify(changes));
  assert.deepStrictEqual(reanchorRange(range, changes), resize(12, 17));
  assert.deepStrictEqual({ ...range }, { startLine: 10, endLine: 14 });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(changes)), before);
});

// ===========================================================================
// ContextBlockStore.reanchor now reports, rather than counting.
// ===========================================================================

const SOURCE = [
  'import { Stripe } from "./stripe";', // L1
  "", // L2
  "export function fanout(n: number): number {", // L3
  "  return n * 2;", // L4
  "}", // L5
  "", // L6
  "export function audit(n: number): number {", // L7
  "  return n - 1;", // L8
  "}", // L9
].join("\n");

const URI = "file:///w/fanout.ts";
const AUDIT = { startLine: 7, endLine: 9 };
const addAudit = (store, uri = URI) =>
  store.add({ uri, range: { ...AUDIT }, text: sliceLines(SOURCE, AUDIT), version: 1 });

test("a healthy entry carries neither `lapsed` nor `lost`: the keys are ABSENT, not false", () => {
  const store = new ContextBlockStore();
  const entry = addAudit(store);
  assert.deepStrictEqual(Object.keys(entry).sort(), ["addedAtVersion", "id", "range", "text", "uri"]);
  assert.strictEqual("lost" in entry, false);
  assert.strictEqual("lapsed" in entry, false);
});

test("reanchor returns {moved, lost} rather than a count", () => {
  const store = new ContextBlockStore();
  addAudit(store);
  const report = store.reanchor(URI, [insertLinesAt(0, 1)], 2);
  assert.deepStrictEqual(report, { moved: 1, lost: [] });
});

test("a shift replaces in place and keeps the entry healthy", () => {
  const store = new ContextBlockStore();
  const before = addAudit(store);
  store.reanchor(URI, [insertLinesAt(0, 1)], 2);
  const after = store.list()[0];
  assert.strictEqual(after.id, before.id);
  assert.strictEqual(after.text, before.text, "text is the last known slice, untouched by an anchor move");
  assert.deepStrictEqual({ ...after.range }, { startLine: 8, endLine: 10 });
  assert.strictEqual(after.addedAtVersion, 2);
  assert.deepStrictEqual(Object.keys(after).sort(), ["addedAtVersion", "id", "range", "text", "uri"]);
  assert.ok(Object.isFrozen(after) && Object.isFrozen(after.range));
});

test("a resize moves the END only, and the entry stays healthy and countable", () => {
  const store = new ContextBlockStore();
  addAudit(store);
  // The human's case: type two lines inside the audit body.
  const report = store.reanchor(URI, [insertLinesAt(7, 2)], 2);
  assert.deepStrictEqual(report, { moved: 1, lost: [] });
  const after = store.list()[0];
  assert.deepStrictEqual({ ...after.range }, { startLine: 7, endLine: 11 }, "start fixed, end grew");
  assert.strictEqual(after.addedAtVersion, 2);
  assert.strictEqual("lost" in after, false, "a resize is NOT a loss");
});

test("a lost entry keeps its range and text, gains lost:crossed, and is reported once", () => {
  const store = new ContextBlockStore();
  const before = addAudit(store);
  const report = store.reanchor(URI, [ch(5, 7, 4, 1)], 2); // crosses the head
  assert.strictEqual(report.moved, 0, "a loss is not a move");
  assert.strictEqual(report.lost.length, 1);
  const after = store.list()[0];
  assert.strictEqual(report.lost[0], after, "the report carries the entry that is now in the list");
  assert.strictEqual(after.id, before.id);
  assert.strictEqual(after.lost, "crossed");
  assert.deepStrictEqual({ ...after.range }, { ...AUDIT }, "the panel can still say where it used to be");
  assert.strictEqual(after.text, before.text);
  assert.ok(Object.isFrozen(after));
});

test("an already-lost entry is skipped entirely: not re-anchored, not re-reported, never healed", () => {
  const store = new ContextBlockStore();
  addAudit(store);
  store.reanchor(URI, [ch(5, 7, 4, 1)], 2);
  const lostEntry = store.list()[0];

  // A later, entirely innocent edit above the block.
  const second = store.reanchor(URI, [insertLinesAt(0, 1)], 3);
  assert.deepStrictEqual(second, { moved: 0, lost: [] }, "no move, no second report");
  const after = store.list()[0];
  assert.strictEqual(after, lostEntry, "the very same frozen object");
  assert.strictEqual(after.addedAtVersion, 1, "the version stops advancing: nothing tracks a lost block");
  assert.strictEqual(after.lost, "crossed");
});

test("report.lost carries the entries lost by THIS event, in list order", () => {
  const store = new ContextBlockStore();
  const a = store.add({ uri: URI, range: { startLine: 3, endLine: 5 }, text: "a", version: 1 });
  const b = store.add({ uri: URI, range: { startLine: 7, endLine: 9 }, text: "b", version: 1 });
  const other = store.add({ uri: "file:///w/other.ts", range: { startLine: 3, endLine: 5 }, text: "o", version: 1 });
  // One replace spanning from inside `a` to inside `b`: it crosses both.
  const report = store.reanchor(URI, [ch(3, 7, 4, 1)], 2);
  assert.deepStrictEqual(report.lost.map((e) => e.id), [a.id, b.id]);
  assert.strictEqual(report.moved, 0);
  assert.strictEqual(store.list()[2], other, "the other uri's entry is the identical object");
});

test("moved counts the entries whose range or version changed, losses excluded", () => {
  const store = new ContextBlockStore();
  store.add({ uri: URI, range: { startLine: 3, endLine: 5 }, text: "a", version: 1 }); // crossed
  store.add({ uri: URI, range: { startLine: 7, endLine: 9 }, text: "b", version: 1 }); // shifted
  const report = store.reanchor(URI, [ch(3, 5, 4, 2)], 2);
  assert.strictEqual(report.moved, 1);
  assert.deepStrictEqual(report.lost.map((e) => e.id), ["b1"]);
});

test("an entry the event did not move still takes the event's version", () => {
  const store = new ContextBlockStore();
  addAudit(store);
  const report = store.reanchor(URI, [insertLinesAt(20, 1)], 2); // below the block
  assert.deepStrictEqual(report, { moved: 1, lost: [] });
  assert.strictEqual(store.list()[0].addedAtVersion, 2);
});

test("a zero-change event at the same version changes nothing and announces nothing", () => {
  const store = new ContextBlockStore();
  const before = addAudit(store);
  let notifications = 0;
  store.subscribe(() => notifications++);
  assert.deepStrictEqual(store.reanchor(URI, [], 1), { moved: 0, lost: [] });
  assert.strictEqual(store.list()[0], before, "the same frozen object");
  assert.strictEqual(notifications, 0);
});

test("subscribers hear one notification per event, whatever it did", () => {
  const store = new ContextBlockStore();
  store.add({ uri: URI, range: { startLine: 3, endLine: 5 }, text: "a", version: 1 });
  store.add({ uri: URI, range: { startLine: 7, endLine: 9 }, text: "b", version: 1 });
  let notifications = 0;
  store.subscribe(() => notifications++);

  store.reanchor(URI, [insertLinesAt(0, 1)], 2);
  assert.strictEqual(notifications, 1, "two entries moved, one notification");

  store.reanchor("file:///w/absent.ts", [insertLinesAt(0, 1)], 3);
  assert.strictEqual(notifications, 1, "an event for a uri with no entries is silent");
});

test("a loss alone notifies, even though nothing moved", () => {
  const store = new ContextBlockStore();
  addAudit(store);
  let notifications = 0;
  store.subscribe(() => notifications++);
  const report = store.reanchor(URI, [ch(5, 7, 4, 1)], 2);
  assert.strictEqual(report.moved, 0);
  assert.strictEqual(notifications, 1, "the panel must repaint the block red");
});

test("the loss lands on the log at the moment it happens, alongside the reanchor line", () => {
  const lines = [];
  const store = new ContextBlockStore((line) => lines.push(line));
  store.add({ uri: URI, range: { startLine: 3, endLine: 5 }, text: "a", version: 1 });
  store.add({ uri: URI, range: { startLine: 7, endLine: 9 }, text: "b", version: 1 });
  lines.length = 0;
  // Crosses b1's tail; b2 sits below it and shifts by +1.
  store.reanchor(URI, [ch(3, 5, 4, 3)], 2);
  assert.deepStrictEqual(lines.filter((l) => l.startsWith("[ctx] lost")), ["[ctx] lost id=b1 reason=crossed"]);
  assert.strictEqual(lines.some((l) => l.startsWith("[ctx] reanchor id=b2")), true);
});

test("a lost entry stays removable and movable by id", () => {
  const store = new ContextBlockStore();
  const a = addAudit(store);
  const b = store.add({ uri: URI, range: { startLine: 3, endLine: 5 }, text: "b", version: 1 });
  store.reanchor(URI, [ch(5, 7, 4, 1)], 2);
  assert.strictEqual(store.move(a.id, "down"), true);
  assert.deepStrictEqual(store.list().map((e) => e.id), [b.id, a.id]);
  assert.strictEqual(store.remove(a.id), true);
  assert.deepStrictEqual(store.list().map((e) => e.id), [b.id]);
});

test("a lost block still reaches toPromptBlocks in phase 1: the payload path is phase 2", () => {
  // Stated as a row rather than left implicit, because it is the one place a
  // reader could mistake phase 1 for the whole feature. toPromptBlocks keeps
  // its sync last-known shape and filters nothing; resolveForPrompt is what
  // excludes a lost block, and it does not exist yet.
  const store = new ContextBlockStore();
  addAudit(store);
  store.reanchor(URI, [ch(5, 7, 4, 1)], 2);
  assert.strictEqual(store.toPromptBlocks().length, 1);
  assert.deepStrictEqual(Object.keys(store.toPromptBlocks()[0]).sort(), ["range", "text", "uri"]);
});
