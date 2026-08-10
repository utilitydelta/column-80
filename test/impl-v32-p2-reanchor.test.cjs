// White-box tests for block re-anchoring (session-v32 phase 2, goal item 3).
// The implementer's half: the classification boundaries, the delta arithmetic,
// the in-place freeze, and the version-per-EVENT rule.
//
// The three measured facts from scout finding 6 are each a named test here,
// because each one is a way to get this wrong that produces "every block reads
// stale forever" rather than an error: one event bumps the version ONCE, the
// changes arrive in DESCENDING order, and a second event arrives at the same
// version with ZERO changes.
//
// session-v33 phase 1 widened the outcome from shift-or-stale to
// shift/resize/lost and turned `reanchor`'s count into a {moved, lost} report.
// The rows that asserted `{kind:"stale"}` for a change touching the block's own
// lines were re-cut here to the new truth, each marked RE-CUT with why. The
// widened rule's own coverage lives in test/impl-v33-p1-reanchor.test.cjs.
//
// Run: SKIP_LIVE=1 node --test test/impl-v32-p2-reanchor.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-v32-p2-reanchor",
  `export { reanchorRange, isStale, sliceLines, ContextBlockStore } from "../src/core/contextBlocks";`,
);
test.after(cleanup);

const { reanchorRange, isStale, sliceLines, ContextBlockStore } = mod;

// A change as the vscode adapter reduces it: 0-based replaced range plus the
// newline count of the replacement text.
const ch = (startLine, endLine, endCharacter, newlineCount) => ({
  startLine,
  endLine,
  endCharacter,
  newlineCount,
});
// The two shapes that dominate real editing.
const insertLinesAt = (line, count) => ch(line, line, 0, count);
const deleteLines = (fromLine, count) => ch(fromLine, fromLine + count, 0, 0);

test("an insertion above the block shifts both ends by the line delta", () => {
  const out = reanchorRange({ startLine: 10, endLine: 14 }, [insertLinesAt(0, 1)]);
  assert.deepStrictEqual(out, { kind: "shift", range: { startLine: 11, endLine: 15 } });
});

test("a deletion above the block shifts both ends back", () => {
  const out = reanchorRange({ startLine: 10, endLine: 14 }, [deleteLines(1, 2)]);
  assert.deepStrictEqual(out, { kind: "shift", range: { startLine: 8, endLine: 12 } });
});

test("a change entirely below the block leaves the range alone", () => {
  const out = reanchorRange({ startLine: 10, endLine: 14 }, [insertLinesAt(20, 3)]);
  assert.deepStrictEqual(out, { kind: "shift", range: { startLine: 10, endLine: 14 } });
});

test("an edit inside a single line above the block is a zero shift, not a stale", () => {
  // Typing a character on line 3 (0-based) with the block at L10-L14.
  const out = reanchorRange({ startLine: 10, endLine: 14 }, [ch(3, 3, 12, 0)]);
  assert.deepStrictEqual(out, { kind: "shift", range: { startLine: 10, endLine: 14 } });
});

// RE-CUT by session-v33: this row asserted `{kind:"stale"}` for all six shapes.
// The outcome widened, and the six split in two: a change that stays INSIDE the
// block now resizes it (the human's if-block case), and only a change that
// CROSSES a boundary loses it.
test("a change inside the block resizes it, at either end and in the middle", () => {
  const range = { startLine: 10, endLine: 14 };
  for (const [name, change] of [
    ["the first line", ch(9, 9, 5, 0)],
    ["the last line", ch(13, 13, 5, 0)],
    ["the middle", ch(11, 11, 2, 0)],
  ]) {
    assert.deepStrictEqual(
      reanchorRange(range, [change]),
      { kind: "resize", range: { startLine: 10, endLine: 14 } },
      name,
    );
  }
});

test("a change crossing either boundary loses the block", () => {
  const range = { startLine: 10, endLine: 14 };
  for (const [name, change] of [
    ["spanning the whole block", ch(5, 20, 0, 3)],
    ["overlapping the top", ch(8, 10, 4, 0)],
    ["overlapping the bottom", ch(13, 18, 4, 0)],
  ]) {
    assert.deepStrictEqual(reanchorRange(range, [change]), { kind: "lost", reason: "crossed" }, name);
  }
});

test("the block's first-line boundary is decided by the character, not the line", () => {
  const range = { startLine: 10, endLine: 14 }; // 0-based first line is 9.
  // Ending AT column 0 of the block's first line: the insertion lands before
  // the block's first byte, so the whole block moves down.
  assert.deepStrictEqual(reanchorRange(range, [ch(9, 9, 0, 1)]), {
    kind: "shift",
    range: { startLine: 11, endLine: 15 },
  });
  // Ending anywhere past column 0 touches the block's own text. RE-CUT by
  // session-v33: that was stale, and is now a resize rather than a loss,
  // because typing in a block's first line must never read as a head overlap.
  assert.deepStrictEqual(reanchorRange(range, [ch(9, 9, 1, 1)]), {
    kind: "resize",
    range: { startLine: 10, endLine: 15 },
  });
});

test("a multi-line replacement above the block nets its added and removed lines", () => {
  // A range from (2,0) to (4,0) spans TWO line boundaries, so it removes 2 and
  // the replacement's single newline adds 1: net -1. Counting the replaced
  // LINES (three) instead of the boundaries is the off-by-one to avoid.
  assert.deepStrictEqual(reanchorRange({ startLine: 10, endLine: 14 }, [ch(2, 4, 0, 1)]), {
    kind: "shift",
    range: { startLine: 9, endLine: 13 },
  });
  // The other direction: two boundaries out, four newlines in, net +2.
  assert.deepStrictEqual(reanchorRange({ startLine: 10, endLine: 14 }, [ch(2, 4, 0, 4)]), {
    kind: "shift",
    range: { startLine: 12, endLine: 16 },
  });
});

test("changes in descending order answer identically to ascending order", () => {
  const range = { startLine: 10, endLine: 14 };
  const ascending = [insertLinesAt(0, 1), insertLinesAt(1, 1), insertLinesAt(2, 1)];
  const descending = [...ascending].reverse();
  const scrambled = [ascending[1], ascending[2], ascending[0]];
  const expected = { kind: "shift", range: { startLine: 13, endLine: 17 } };
  assert.deepStrictEqual(reanchorRange(range, ascending), expected);
  assert.deepStrictEqual(reanchorRange(range, descending), expected, "descending, as measured");
  assert.deepStrictEqual(reanchorRange(range, scrambled), expected);
});

// RE-CUT by session-v33: the poisoning change here was an INSIDE one, which
// now resizes instead. Only a crossing change poisons an event, and it still
// does so whatever order it arrives in.
test("one crossing change poisons an event however many others shift cleanly", () => {
  const range = { startLine: 10, endLine: 14 };
  const changes = [insertLinesAt(0, 1), ch(8, 10, 3, 0), insertLinesAt(2, 1)];
  assert.deepStrictEqual(reanchorRange(range, changes), { kind: "lost", reason: "crossed" });
  assert.deepStrictEqual(reanchorRange(range, [...changes].reverse()), { kind: "lost", reason: "crossed" });
});

test("an inside change no longer poisons an event: it resizes while the others shift", () => {
  const range = { startLine: 10, endLine: 14 };
  const changes = [insertLinesAt(0, 1), ch(11, 11, 3, 0), insertLinesAt(2, 1)];
  const wanted = { kind: "resize", range: { startLine: 12, endLine: 16 } };
  assert.deepStrictEqual(reanchorRange(range, changes), wanted);
  assert.deepStrictEqual(reanchorRange(range, [...changes].reverse()), wanted);
});

test("a zero-change event shifts by zero rather than reporting stale", () => {
  // The second event of every edit, in every language (finding 6). Reading it
  // as a whole-document change flags every block on every keystroke.
  const out = reanchorRange({ startLine: 10, endLine: 14 }, []);
  assert.deepStrictEqual(out, { kind: "shift", range: { startLine: 10, endLine: 14 } });
});

// RE-CUT by session-v33: `stale` became `lost`, and the change this row used
// (L0-L10 over a block at L5-L9) never reached the arithmetic at all. It spans
// the block, so it is refused by the classification. Both legs are asserted
// separately now.
test("a change spanning the whole block is refused before any arithmetic runs", () => {
  const out = reanchorRange({ startLine: 5, endLine: 9 }, [ch(0, 10, 0, 0)]);
  assert.deepStrictEqual(out, { kind: "lost", reason: "crossed" });
});

test("a shift that would land above line 1 is refused, because the deltas disagree with the classification", () => {
  // Two ABOVE changes (they end at character 0 of the block's first line), each
  // -4: the block would start at L5 - 8.
  const above = ch(0, 4, 0, 0);
  const out = reanchorRange({ startLine: 5, endLine: 9 }, [above, { ...above }]);
  assert.deepStrictEqual(out, { kind: "lost", reason: "crossed" });
});

test("reanchorRange mutates neither argument", () => {
  const range = Object.freeze({ startLine: 10, endLine: 14 });
  const changes = Object.freeze([Object.freeze(insertLinesAt(0, 2))]);
  const out = reanchorRange(range, changes);
  assert.deepStrictEqual(out, { kind: "shift", range: { startLine: 12, endLine: 16 } });
  assert.deepStrictEqual({ ...range }, { startLine: 10, endLine: 14 });
});

// ===========================================================================
// End to end against a real document, which is the only way a shift is proven
// CORRECT rather than merely arithmetic: apply the edit to the text, then ask
// isStale.
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

test("after a correct shift, isStale reports FRESH against the edited document", () => {
  const store = new ContextBlockStore();
  const uri = "file:///w/fanout.ts";
  const range = { startLine: 7, endLine: 9 }; // the audit function
  const entry = store.add({ uri, range, text: sliceLines(SOURCE, range), version: 1 });
  assert.strictEqual(isStale(entry, { version: 1, text: SOURCE }), false, "fresh at add time");

  // Insert an import at the top: one line, entirely above the block.
  const edited = ['import { Band } from "./band";', ...SOURCE.split("\n")].join("\n");
  // RE-CUT by session-v33: reanchor reports {moved, lost} instead of a count.
  assert.deepStrictEqual(store.reanchor(uri, [insertLinesAt(0, 1)], 2), { moved: 1, lost: [] });

  const after = store.list()[0];
  assert.deepStrictEqual({ ...after.range }, { startLine: 8, endLine: 10 });
  assert.strictEqual(after.addedAtVersion, 2, "the version advanced with the anchor");
  assert.strictEqual(isStale(after, { version: 2, text: edited }), false, "still fresh");
  // The proof that the shift is RIGHT and not merely consistent: the new range
  // slices the edited document back to the frozen text.
  assert.strictEqual(sliceLines(edited, after.range), after.text);
});

test("a WRONG shift still reads stale, because leg 2 of isStale audits leg 1", () => {
  const store = new ContextBlockStore();
  const uri = "file:///w/fanout.ts";
  const range = { startLine: 7, endLine: 9 };
  store.add({ uri, range, text: sliceLines(SOURCE, range), version: 1 });
  const edited = ['import { Band } from "./band";', ...SOURCE.split("\n")].join("\n");

  // Feed a change that claims TWO lines were inserted when the document only
  // grew by one. Leg 1 is satisfied (versions agree); leg 2 is not.
  store.reanchor(uri, [insertLinesAt(0, 2)], 2);
  const after = store.list()[0];
  assert.deepStrictEqual({ ...after.range }, { startLine: 9, endLine: 11 }, "the wrong anchor landed");
  assert.strictEqual(after.addedAtVersion, 2, "leg 1 is satisfied, which is the danger");
  assert.strictEqual(isStale(after, { version: 2, text: edited }), true, "leg 2 catches it");
});

test("an edit below the block advances the version so leg 1 stops flagging it", () => {
  const store = new ContextBlockStore();
  const uri = "file:///w/fanout.ts";
  const range = { startLine: 3, endLine: 5 }; // the fanout function
  store.add({ uri, range, text: sliceLines(SOURCE, range), version: 1 });

  // Append a line at the end of the file: below the block, no anchor movement.
  const edited = [...SOURCE.split("\n"), "// trailing"].join("\n");
  const report = store.reanchor(uri, [insertLinesAt(9, 1)], 2);
  assert.strictEqual(report.moved, 1, "the version moved even though the range did not");
  const after = store.list()[0];
  assert.deepStrictEqual({ ...after.range }, { startLine: 3, endLine: 5 });
  assert.strictEqual(after.addedAtVersion, 2);
  assert.strictEqual(isStale(after, { version: 2, text: edited }), false);
});

test("one event with N changes advances the version exactly once", () => {
  const store = new ContextBlockStore();
  const uri = "file:///w/fanout.ts";
  const range = { startLine: 7, endLine: 9 };
  store.add({ uri, range, text: sliceLines(SOURCE, range), version: 1 });
  // Two inserts in one editor.edit: the version goes 1 -> 2, not 1 -> 3.
  store.reanchor(uri, [insertLinesAt(1, 1), insertLinesAt(0, 1)], 2);
  const after = store.list()[0];
  assert.strictEqual(after.addedAtVersion, 2);
  assert.deepStrictEqual({ ...after.range }, { startLine: 9, endLine: 11 });
  const edited = SOURCE.split("\n");
  edited.splice(1, 0, "// spike line B");
  edited.splice(0, 0, "// spike line A");
  assert.strictEqual(isStale(after, { version: 2, text: edited.join("\n") }), false);
});

test("a zero-change event leaves every entry alone and flags nothing", () => {
  const store = new ContextBlockStore();
  const uri = "file:///w/fanout.ts";
  const range = { startLine: 7, endLine: 9 };
  const before = store.add({ uri, range, text: sliceLines(SOURCE, range), version: 1 });
  let notifications = 0;
  store.subscribe(() => notifications++);
  assert.deepStrictEqual(store.reanchor(uri, [], 1), { moved: 0, lost: [] }, "nothing moved, nothing lost");
  assert.strictEqual(notifications, 0, "and nothing was announced");
  assert.strictEqual(store.list()[0], before, "the same frozen object");
});

test("a shift preserves id, text and list position, and leaves other uris alone", () => {
  const store = new ContextBlockStore();
  const a = store.add({ uri: "file:///w/a.ts", range: { startLine: 7, endLine: 9 }, text: sliceLines(SOURCE, { startLine: 7, endLine: 9 }), version: 1 });
  const b = store.add({ uri: "file:///w/b.ts", range: { startLine: 3, endLine: 5 }, text: "other", version: 1 });
  const c = store.add({ uri: "file:///w/a.ts", range: { startLine: 3, endLine: 5 }, text: sliceLines(SOURCE, { startLine: 3, endLine: 5 }), version: 1 });

  const report = store.reanchor("file:///w/a.ts", [insertLinesAt(0, 1)], 2);
  assert.strictEqual(report.moved, 2);
  const list = store.list();
  assert.deepStrictEqual(list.map((e) => e.id), [a.id, b.id, c.id], "order preserved");
  assert.strictEqual(list[1], b, "the other uri's entry is the identical object");
  assert.strictEqual(list[0].text, a.text, "text is still frozen");
  assert.strictEqual(list[2].text, c.text);
  assert.deepStrictEqual({ ...list[0].range }, { startLine: 8, endLine: 10 });
  assert.deepStrictEqual({ ...list[2].range }, { startLine: 4, endLine: 6 });
});

test("a shift keeps entries removable and movable by id", () => {
  const store = new ContextBlockStore();
  const uri = "file:///w/a.ts";
  const a = store.add({ uri, range: { startLine: 7, endLine: 9 }, text: "a", version: 1 });
  const b = store.add({ uri, range: { startLine: 3, endLine: 5 }, text: "b", version: 1 });
  store.reanchor(uri, [insertLinesAt(0, 2)], 2);
  assert.strictEqual(store.move(a.id, "down"), true);
  assert.deepStrictEqual(store.list().map((e) => e.id), [b.id, a.id]);
  assert.strictEqual(store.remove(b.id), true);
  assert.deepStrictEqual(store.list().map((e) => e.id), [a.id]);
});

// RE-CUT by session-v33: an edit inside a block used to leave the entry behind
// so isStale would report it. It is now a resize, re-anchored and version
// advanced, because the block's text being different is the POINT of the
// session rather than something to warn about. A crossing change is what leaves
// an entry behind now, and it says so with `lost` rather than by lagging.
test("an entry whose own lines changed is re-anchored, not left behind", () => {
  const store = new ContextBlockStore();
  const uri = "file:///w/fanout.ts";
  const range = { startLine: 7, endLine: 9 };
  store.add({ uri, range, text: sliceLines(SOURCE, range), version: 1 });
  assert.deepStrictEqual(store.reanchor(uri, [ch(7, 7, 4, 0)], 2), { moved: 1, lost: [] });
  assert.strictEqual(store.list()[0].addedAtVersion, 2);
});

test("a crossing change marks the entry lost and reports it", () => {
  const store = new ContextBlockStore();
  const uri = "file:///w/fanout.ts";
  const range = { startLine: 7, endLine: 9 };
  const before = store.add({ uri, range, text: sliceLines(SOURCE, range), version: 1 });
  const report = store.reanchor(uri, [ch(5, 7, 4, 0)], 2);
  assert.strictEqual(report.moved, 0);
  assert.deepStrictEqual(report.lost.map((e) => e.id), [before.id]);
  const after = store.list()[0];
  assert.strictEqual(after.lost, "crossed");
  assert.deepStrictEqual({ ...after.range }, { startLine: 7, endLine: 9 }, "where it used to be");
  assert.strictEqual(after.text, before.text);
});

test("entries stay frozen after a re-anchor", () => {
  const store = new ContextBlockStore();
  const uri = "file:///w/a.ts";
  store.add({ uri, range: { startLine: 7, endLine: 9 }, text: "a", version: 1 });
  store.reanchor(uri, [insertLinesAt(0, 1)], 2);
  const entry = store.list()[0];
  assert.ok(Object.isFrozen(entry), "the entry");
  assert.ok(Object.isFrozen(entry.range), "and its range");
});

test("subscribers hear about a move exactly once per event", () => {
  const store = new ContextBlockStore();
  const uri = "file:///w/a.ts";
  store.add({ uri, range: { startLine: 7, endLine: 9 }, text: "a", version: 1 });
  store.add({ uri, range: { startLine: 3, endLine: 5 }, text: "b", version: 1 });
  let notifications = 0;
  store.subscribe(() => notifications++);
  store.reanchor(uri, [insertLinesAt(0, 1)], 2);
  assert.strictEqual(notifications, 1, "two entries moved, one notification");
});
