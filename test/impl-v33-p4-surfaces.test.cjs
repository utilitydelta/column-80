// The branches of the phase-4 surface decisions, which live in core so the
// panel's rendering is testable without an extension host.
//
// The blind oracle (`blind-v33-p4-surfaces.test.cjs`) pins the CONTRACT: the
// icon union, the color token, the description format, and the shape of the
// toast sentences. This file pins the things an implementation can get wrong
// underneath a green contract: which branch each entry state takes, what the
// decoration filter now filters on, and how a uri becomes the one label the
// tree, the toast and the generate-time warning all name it by.
//
// The last section drives the STORE, because a surface is only worth testing if
// what it says is true: a block the panel paints red must be a block the prompt
// does not carry, and the async payload path gave it one way to be both.
//
// Run: SKIP_LIVE=1 node --test test/impl-v33-p4-surfaces.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-v33-p4-surfaces",
  `export { blockRowShape, lostToastMessage, fileLabel, decorationLineSpans, clampedLineSpan, ContextBlockStore } from "../src/core/contextBlocks";\n`,
);
test.after(cleanup);
const { blockRowShape, lostToastMessage, fileLabel, decorationLineSpans, ContextBlockStore } = mod;

const entry = (over = {}) => ({
  id: "b1",
  uri: "file:///w/alpha.ts",
  range: { startLine: 3, endLine: 8 },
  text: "three\nfour",
  addedAtVersion: 7,
  ...over,
});

// ---------------------------------------------------------------------------
// blockRowShape: the branch, and what the healthy branch does NOT carry.
// ---------------------------------------------------------------------------

test("blockRowShape: a healthy entry answers exactly two keys, so `color` and `reason` are absent rather than undefined", () => {
  assert.deepStrictEqual(Object.keys(blockRowShape(entry())).sort(), ["description", "icon"]);
  assert.deepStrictEqual(blockRowShape(entry()), { icon: "file", description: "L3-L8" });
});

test("blockRowShape: a lapsed entry takes the HEALTHY branch, because a lapse is recoverable and fires on every tab close", () => {
  assert.deepStrictEqual(blockRowShape(entry({ lapsed: true })), { icon: "file", description: "L3-L8" });
});

test("blockRowShape: lost wins over lapsed, because lost is terminal", () => {
  const shape = blockRowShape(entry({ lapsed: true, lost: "lapsed" }));
  assert.strictEqual(shape.icon, "error");
  assert.strictEqual(shape.description, "L3-L8 (lost)");
});

test("blockRowShape: a lost entry whose reason has no sentence answers NO reason key, rather than one that is present-and-undefined", () => {
  // Not reachable through the closed union today, and it is the panel this row
  // protects: the tooltip used to branch on `reason === undefined` while the
  // icon branched on `lost`, so a fourth reason with no sentence behind it
  // painted a red row carrying the HEALTHY tooltip. One field decides now, and
  // the shape's contract is emphatic that an absent value is absent rather than
  // present-and-undefined.
  const shape = blockRowShape(entry({ lost: "evicted" }));
  assert.strictEqual(shape.icon, "error", "the row is still lost");
  assert.strictEqual(shape.description, "L3-L8 (lost)");
  assert.ok(
    !Object.prototype.hasOwnProperty.call(shape, "reason"),
    `no sentence means no key, got ${JSON.stringify(shape)}`,
  );
});

test("blockRowShape: each LostReason gets its own sentence, and each names the thing that went wrong", () => {
  // Wording is the human's; what this pins is that the sentence is ABOUT the
  // reason it was chosen for, which a shared sentence would not be.
  const of = (reason) => blockRowShape(entry({ lost: reason })).reason;
  assert.match(of("crossed"), /edit|boundary/i);
  assert.match(of("deleted"), /delet|read/i);
  assert.match(of("lapsed"), /clos|match/i);
});

test("blockRowShape: a single-line block reads L4-L4, not L4", () => {
  assert.strictEqual(blockRowShape(entry({ range: { startLine: 4, endLine: 4 } })).description, "L4-L4");
});

// ---------------------------------------------------------------------------
// lostToastMessage: the n=0 escape hatch and the grammar of the two frames.
// ---------------------------------------------------------------------------

test("lostToastMessage: nothing lost is the empty string, so a caller that toasts it unguarded shows nothing rather than a lie", () => {
  assert.strictEqual(lostToastMessage([]), "");
});

test("lostToastMessage: the singular frame carries no count at all", () => {
  const message = lostToastMessage([entry({ lost: "crossed" })]);
  assert.ok(!/\d+\s+context/.test(message), `the singular sentence counts nothing: ${message}`);
  assert.ok(message.includes("alpha.ts L3-L8"), message);
});

test("lostToastMessage: the plural frame leads with the count and names every block", () => {
  const message = lostToastMessage([
    entry({ id: "b1", uri: "file:///w/alpha.ts", range: { startLine: 3, endLine: 8 }, lost: "crossed" }),
    entry({ id: "b2", uri: "file:///w/beta.rs", range: { startLine: 41, endLine: 52 }, lost: "deleted" }),
  ]);
  assert.ok(message.includes("2 context blocks"), message);
  assert.ok(message.includes("alpha.ts L3-L8"), message);
  assert.ok(message.includes("beta.rs L41-L52"), message);
});

test("lostToastMessage: two blocks in ONE file are two named rows, not one deduped file", () => {
  const message = lostToastMessage([
    entry({ id: "b1", range: { startLine: 3, endLine: 8 }, lost: "crossed" }),
    entry({ id: "b2", range: { startLine: 30, endLine: 31 }, lost: "crossed" }),
  ]);
  assert.ok(message.includes("alpha.ts L3-L8"), message);
  assert.ok(message.includes("alpha.ts L30-L31"), message);
});

// ---------------------------------------------------------------------------
// fileLabel: one rule, in core, for the tree row and both warnings.
// ---------------------------------------------------------------------------

test("fileLabel: the last path segment, percent-decoded, with the whole uri as the fallback", () => {
  assert.strictEqual(fileLabel("file:///w/util.rs"), "util.rs");
  assert.strictEqual(fileLabel("file:///w/deep/nested/util.rs"), "util.rs");
  // A trailing slash must not answer the empty string: an unnamed row is worse
  // than a long one.
  assert.strictEqual(fileLabel("file:///w/dir/"), "dir");
  assert.strictEqual(fileLabel("untitled:Untitled-1"), "Untitled-1");
  assert.strictEqual(fileLabel("file:///w/a%20b.ts"), "a b.ts");
  // Query and fragment are addressing, not the name.
  assert.strictEqual(fileLabel("file:///w/a.ts?v=2"), "a.ts");
  assert.strictEqual(fileLabel("file:///w/a.ts#L3"), "a.ts");
  // Nothing segment-shaped left: say the whole thing rather than nothing.
  assert.strictEqual(fileLabel("file:///"), "file:///");
  assert.strictEqual(fileLabel(""), "");
  // A malformed escape makes decodeURIComponent throw; the raw tail still names
  // the file better than an exception does.
  assert.strictEqual(fileLabel("file:///w/100%.ts"), "100%.ts");
});

// ---------------------------------------------------------------------------
// decorationLineSpans: the filter is `lost`, and nothing else.
// ---------------------------------------------------------------------------

test("decorationLineSpans: live blocks tint, lost blocks do not", () => {
  const live = entry({ id: "b1", range: { startLine: 1, endLine: 2 } });
  const lost = entry({ id: "b2", range: { startLine: 3, endLine: 3 }, lost: "crossed" });
  assert.deepStrictEqual(decorationLineSpans([live, lost], 3), [{ startLine: 0, endLine: 1 }]);
});

test("decorationLineSpans: a lapsed block still tints, because its lines are still where it says", () => {
  const lapsed = entry({ range: { startLine: 1, endLine: 2 }, lapsed: true });
  assert.deepStrictEqual(decorationLineSpans([lapsed], 3), [{ startLine: 0, endLine: 1 }]);
});

test("decorationLineSpans: the cached text no longer decides anything; only the range and the document length do", () => {
  // Under the frozen-snapshot design this entry read stale and went dark. Under
  // live semantics a block whose text moved on is the feature.
  const edited = entry({ range: { startLine: 1, endLine: 2 }, text: "text from three edits ago" });
  assert.deepStrictEqual(decorationLineSpans([edited], 3), [{ startLine: 0, endLine: 1 }]);
  // A block past the end of a shrunk document still clamps to a real span.
  assert.deepStrictEqual(decorationLineSpans([entry({ range: { startLine: 8, endLine: 12 } })], 5), [
    { startLine: 4, endLine: 4 },
  ]);
  // and an empty document has nothing to tint.
  assert.deepStrictEqual(decorationLineSpans([entry()], 0), []);
});

// ---------------------------------------------------------------------------
// The surfaces against the payload. Every row above decides what a human is
// TOLD; these two decide whether the telling is true.
//
// `read` is async and the extension host dispatches workspace events while a
// resolve is suspended on `openTextDocument`, so a block can go lost AFTER its
// own read and BEFORE the walk ends. It is already in the emission map by then,
// and the post-walk projection used to ask only whether the entry was still in
// the LIST. That made all four phase-4 surfaces liars in one gesture: the row
// paints red, the tooltip says the block reaches no prompt, the toast says it
// will not reach the model, and the generate-time warning names it as excluded,
// while the block itself rides into the prompt. The vocabulary is absolute:
// lost is terminal and the block is excluded from EVERY prompt.
//
// Both loss paths, because they reach the same hole through different doors.
// ---------------------------------------------------------------------------

test("a block DELETED mid-resolve is red in the panel AND excluded from the prompt", async () => {
  const store = new ContextBlockStore();
  store.add({ uri: "file:///w/a.rs", range: { startLine: 1, endLine: 1 }, text: "a", version: 1 });
  store.add({ uri: "file:///w/b.rs", range: { startLine: 1, endLine: 1 }, text: "b", version: 1 });

  const blocks = await store.resolveForPrompt(async (uri) => {
    if (uri === "file:///w/b.rs") {
      // The delete watcher fires while b.rs is being read, so a.rs is already
      // read and emitted. Exactly the mutation the contract says the walk must
      // survive.
      store.markDeleted("file:///w/a.rs");
    }
    return "x\n";
  });

  const a = store.list().find((e) => e.uri === "file:///w/a.rs");
  assert.strictEqual(a.lost, "deleted", "control: the store lost it");
  assert.strictEqual(blockRowShape(a).icon, "error", "control: the panel paints that row RED");
  assert.deepStrictEqual(
    blocks.map((b) => b.uri),
    ["file:///w/b.rs"],
    "a block the panel shows as lost, and the toast said would not reach the model, reached the prompt",
  );
});

test("a block CROSSED mid-resolve is red in the panel AND excluded from the prompt", async () => {
  const store = new ContextBlockStore();
  store.add({ uri: "file:///w/a.rs", range: { startLine: 3, endLine: 6 }, text: "l3\nl4\nl5\nl6", version: 1 });
  store.add({ uri: "file:///w/b.rs", range: { startLine: 1, endLine: 1 }, text: "b", version: 1 });

  const blocks = await store.resolveForPrompt(async (uri) => {
    if (uri === "file:///w/b.rs") {
      // The other door: a keystroke crossing a.rs's boundary, dispatched while
      // b.rs is being read.
      store.reanchor(
        "file:///w/a.rs",
        [{ startLine: 1, endLine: 4, endCharacter: 0, newlineCount: 1, endsAtLineStart: true }],
        2,
        "l1\nX\nl5\nl6\n",
      );
    }
    return "l1\nl2\nl3\nl4\nl5\nl6\n";
  });

  const a = store.list().find((e) => e.uri === "file:///w/a.rs");
  assert.strictEqual(a.lost, "crossed", "control: the edit crossed it");
  assert.strictEqual(blockRowShape(a).icon, "error", "control: the panel paints that row RED");
  assert.deepStrictEqual(
    blocks.map((b) => b.uri),
    ["file:///w/b.rs"],
    "the crossed block was red in the tree and in the prompt at the same time",
  );
});

test("a block REMOVED mid-resolve still reaches no prompt: the lost filter did not cost bar 3", async () => {
  // The control the two rows above are read against, so neither can be
  // satisfied by breaking the walk in general.
  const store = new ContextBlockStore();
  const a = store.add({ uri: "file:///w/a.rs", range: { startLine: 1, endLine: 1 }, text: "a", version: 1 });
  store.add({ uri: "file:///w/b.rs", range: { startLine: 1, endLine: 1 }, text: "b", version: 1 });
  const blocks = await store.resolveForPrompt(async (uri) => {
    if (uri === "file:///w/b.rs") {
      store.remove(a.id);
    }
    return "x\n";
  });
  assert.deepStrictEqual(blocks.map((b) => b.uri), ["file:///w/b.rs"]);
});
