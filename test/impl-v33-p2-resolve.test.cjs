// White-box tests for the payload path (session-v33 phase 2).
//
// Phase 1 made the RANGE live. This phase makes the TEXT live: the prompt is
// sliced out of the document at generate time, so the block over a function you
// are still writing carries the implementation you just typed into it. The
// entry's `text` stops being the payload and becomes the last known slice, which
// is what the panel previews and what the re-adoption audit compares against.
//
// The rows here are the five-step rule of session-v33/contract.md
// (`resolveForPrompt`), plus the three uri-level state changes the vscode layer
// drives from workspace events: markLapsed, markDeleted, renameUri.
//
// Run: SKIP_LIVE=1 node --test test/impl-v33-p2-resolve.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-v33-p2-resolve",
  `export { ContextBlockStore, sliceLines } from "../src/core/contextBlocks";`,
);
test.after(cleanup);

const { ContextBlockStore } = mod;

const A = "file:///w/a.rs";
const B = "file:///w/b.rs";

const add = (store, uri, startLine, endLine, text, version = 1) =>
  store.add({ uri, range: { startLine, endLine }, text, version });

// A reader over a fixed document table, recording every uri it was asked for so
// a test can pin BOTH what was read and what was deliberately not read.
function reader(docs) {
  const calls = [];
  return {
    calls,
    read: async (uri) => {
      calls.push(uri);
      return Object.prototype.hasOwnProperty.call(docs, uri) ? docs[uri] : undefined;
    },
  };
}

// Counts notifications; the store notifies synchronously.
function watch(store) {
  const seen = { count: 0 };
  store.subscribe(() => {
    seen.count++;
  });
  return seen;
}

const lines = (...ls) => ls.join("\n");

// ===========================================================================
// The point of the session: the model gets what the lines say NOW
// ===========================================================================

test("resolveForPrompt returns the LIVE slice, not the text captured at add time", async () => {
  const store = new ContextBlockStore();
  add(store, A, 2, 3, lines("stale one", "stale two"));
  const { read } = reader({ [A]: lines("head", "live one", "live two", "tail") });

  const blocks = await store.resolveForPrompt(read);

  assert.deepStrictEqual(blocks, [
    { uri: A, range: { startLine: 2, endLine: 3 }, text: lines("live one", "live two") },
  ]);
  assert.strictEqual(store.list()[0].text, lines("live one", "live two"), "the cached last-known slice is refreshed");
});

test("THE HUMAN CASE: an if block typed inside the block reaches the prompt with its implementation", async () => {
  const store = new ContextBlockStore();
  // A block over the whole function, added when its body was one line.
  const before = lines(
    "// header",
    "",
    "fn compute(n: i32) -> i32 {",
    "    let mut total = 0;",
    "    total",
    "}",
    "",
    "// tail",
  );
  add(store, A, 3, 6, lines("fn compute(n: i32) -> i32 {", "    let mut total = 0;", "    total", "}"));

  // The human types an `if` block with an implementation inside it: three lines
  // inserted at 0-based line 4, entirely inside the block.
  store.reanchor(A, [{ startLine: 4, endLine: 4, endCharacter: 0, newlineCount: 3, endsAtLineStart: true }], 2);
  const after = lines(
    "// header",
    "",
    "fn compute(n: i32) -> i32 {",
    "    let mut total = 0;",
    "    if n > 0 {",
    "        total += n * 2;",
    "    }",
    "    total",
    "}",
    "",
    "// tail",
  );
  assert.deepStrictEqual(store.list()[0].range, { startLine: 3, endLine: 9 }, "the range grew with the edit");

  const blocks = await store.resolveForPrompt(reader({ [A]: after }).read);

  assert.strictEqual(blocks.length, 1);
  assert.match(blocks[0].text, /total \+= n \* 2;/, "the implementation typed inside reaches the prompt");
  assert.strictEqual(
    blocks[0].text,
    lines(
      "fn compute(n: i32) -> i32 {",
      "    let mut total = 0;",
      "    if n > 0 {",
      "        total += n * 2;",
      "    }",
      "    total",
      "}",
    ),
    "the whole function, closing brace included",
  );
  assert.ok(!before.includes("total += n * 2;"), "the sentence only means something because it was not there before");
});

test("order in the list is order in the resolved blocks, across uris", async () => {
  const store = new ContextBlockStore();
  add(store, A, 1, 1, "one");
  add(store, B, 1, 1, "two");
  add(store, A, 2, 2, "three");
  const { read } = reader({ [A]: lines("a1", "a2"), [B]: "b1" });

  const blocks = await store.resolveForPrompt(read);

  assert.deepStrictEqual(blocks.map((b) => b.text), ["a1", "b1", "a2"]);
  assert.deepStrictEqual(blocks.map((b) => b.uri), [A, B, A]);
});

test("the projection is exactly {uri, range, text}", async () => {
  const store = new ContextBlockStore();
  add(store, A, 1, 1, "one");
  const [block] = await store.resolveForPrompt(reader({ [A]: "one" }).read);
  assert.deepStrictEqual(Object.keys(block).sort(), ["range", "text", "uri"]);
  assert.deepStrictEqual(Object.keys(block.range).sort(), ["endLine", "startLine"]);
});

// ===========================================================================
// Step 1: an already-lost entry is excluded, and not even read for
// ===========================================================================

test("an already-lost entry is excluded and NO read is attempted for it", async () => {
  const store = new ContextBlockStore();
  add(store, A, 1, 1, "gone");
  add(store, B, 1, 1, "kept");
  // Cross b1's boundary: a replace spanning its first line.
  store.reanchor(A, [{ startLine: 0, endLine: 1, endCharacter: 3, newlineCount: 0, endsAtLineStart: false }], 2);
  assert.strictEqual(store.list()[0].lost, "crossed");

  const { read, calls } = reader({ [A]: "a1", [B]: "b1" });
  const blocks = await store.resolveForPrompt(read);

  assert.deepStrictEqual(blocks.map((b) => b.uri), [B], "the lost block is not in the prompt");
  assert.deepStrictEqual(calls, [B], "no read is attempted for a lost entry");
});

// ===========================================================================
// Step 2: an unreadable file loses the block; never an empty section
// ===========================================================================

test("read returning undefined loses the entry as deleted and never substitutes an empty string", async () => {
  const store = new ContextBlockStore();
  add(store, A, 1, 2, lines("last", "known"));
  add(store, B, 1, 1, "kept");

  const blocks = await store.resolveForPrompt(reader({ [B]: "b1" }).read);

  assert.deepStrictEqual(blocks.map((b) => b.uri), [B]);
  assert.ok(!blocks.some((b) => b.text === ""), "an empty section would be sent silently; it must not exist");
  const gone = store.list()[0];
  assert.strictEqual(gone.lost, "deleted");
  assert.strictEqual(gone.text, lines("last", "known"), "the last known text survives for the panel");
  assert.deepStrictEqual(gone.range, { startLine: 1, endLine: 2 }, "and so does where it was");
});

// ===========================================================================
// Step 3: the re-adoption audit, both ways
// ===========================================================================

test("lapsed + the recorded range still says the same thing: lapsed clears and the block carries on", async () => {
  const store = new ContextBlockStore();
  add(store, A, 2, 3, lines("one", "two"));
  assert.strictEqual(store.markLapsed(A), 1);
  assert.strictEqual(store.list()[0].lapsed, true);

  const blocks = await store.resolveForPrompt(reader({ [A]: lines("head", "one", "two", "tail") }).read);

  assert.deepStrictEqual(blocks.map((b) => b.text), [lines("one", "two")]);
  const adopted = store.list()[0];
  assert.strictEqual(adopted.lapsed, undefined);
  assert.ok(!("lapsed" in adopted), "the key is ABSENT again, not present-and-undefined");
  assert.ok(!("lost" in adopted));
});

test("lapsed + a CRLF and trailing-newline difference is still the same thing: the audit uses the isStale canonical rule", async () => {
  const store = new ContextBlockStore();
  add(store, A, 1, 2, "one\r\ntwo\n");
  store.markLapsed(A);

  const blocks = await store.resolveForPrompt(reader({ [A]: lines("one", "two", "tail") }).read);

  assert.deepStrictEqual(blocks.map((b) => b.text), [lines("one", "two")]);
  assert.ok(!("lapsed" in store.list()[0]));
});

test("lapsed + the recorded range now says something else: lost as lapsed, excluded", async () => {
  const store = new ContextBlockStore();
  add(store, A, 2, 3, lines("one", "two"));
  store.markLapsed(A);

  const blocks = await store.resolveForPrompt(reader({ [A]: lines("head", "ONE", "TWO", "tail") }).read);

  assert.deepStrictEqual(blocks, []);
  const gone = store.list()[0];
  assert.strictEqual(gone.lost, "lapsed");
  assert.strictEqual(gone.text, lines("one", "two"), "the last known text is what the panel still shows");
});

test("no content search: a lapsed block whose lines moved two down is LOST, never hunted for", async () => {
  const store = new ContextBlockStore();
  add(store, A, 2, 3, lines("one", "two"));
  store.markLapsed(A);
  // The exact text is still in the document, two lines lower. Finding it would
  // be a content search, which is a named non-goal.
  const doc = lines("head", "inserted", "inserted", "one", "two", "tail");

  const blocks = await store.resolveForPrompt(reader({ [A]: doc }).read);

  assert.deepStrictEqual(blocks, []);
  assert.strictEqual(store.list()[0].lost, "lapsed");
  assert.deepStrictEqual(store.list()[0].range, { startLine: 2, endLine: 3 }, "the range is not re-derived either");
});

test("a HEALTHY entry is never audited: its text is supposed to differ", async () => {
  const store = new ContextBlockStore();
  add(store, A, 1, 1, "what it used to say");

  const blocks = await store.resolveForPrompt(reader({ [A]: "what it says now" }).read);

  assert.deepStrictEqual(blocks.map((b) => b.text), ["what it says now"]);
  assert.ok(!("lost" in store.list()[0]));
});

// ===========================================================================
// Step 4: a range that resolves to nothing is not a block
// ===========================================================================

test("a range that slices to nothing is lost as crossed", async () => {
  const store = new ContextBlockStore();
  add(store, A, 8, 9, lines("one", "two"));

  const blocks = await store.resolveForPrompt(reader({ [A]: lines("head", "tail") }).read);

  assert.deepStrictEqual(blocks, []);
  assert.strictEqual(store.list()[0].lost, "crossed");
});

test("an empty document loses the block rather than sending an empty section", async () => {
  const store = new ContextBlockStore();
  add(store, A, 1, 1, "one");

  const blocks = await store.resolveForPrompt(reader({ [A]: "" }).read);

  assert.deepStrictEqual(blocks, []);
  assert.strictEqual(store.list()[0].lost, "crossed");
});

// ===========================================================================
// The read seam, the notification, the log
// ===========================================================================

test("one read per live entry, in list order, even when two entries share a uri", async () => {
  const store = new ContextBlockStore();
  add(store, A, 1, 1, "one");
  add(store, B, 1, 1, "two");
  add(store, A, 2, 2, "three");
  const { read, calls } = reader({ [A]: lines("a1", "a2"), [B]: "b1" });

  await store.resolveForPrompt(read);

  assert.deepStrictEqual(calls, [A, B, A]);
});

test("notifies exactly once when a resolve changed something, whatever it changed", async () => {
  const store = new ContextBlockStore();
  add(store, A, 1, 1, "old"); // text refreshes
  add(store, B, 1, 1, "old"); // file gone
  const seen = watch(store);

  await store.resolveForPrompt(reader({ [A]: "new" }).read);

  assert.strictEqual(seen.count, 1);
});

test("notifies not at all when a resolve changed nothing", async () => {
  const store = new ContextBlockStore();
  add(store, A, 1, 1, "same");
  const seen = watch(store);

  const blocks = await store.resolveForPrompt(reader({ [A]: "same" }).read);

  assert.deepStrictEqual(blocks.map((b) => b.text), ["same"]);
  assert.strictEqual(seen.count, 0, "a resolve that found no news must not repaint the panel");
});

test("every loss logs [ctx] lost id=<id> reason=<reason> at the moment it happens", async () => {
  const log = [];
  const store = new ContextBlockStore((line) => log.push(line));
  const C = "file:///w/c.rs";
  add(store, A, 1, 1, "one"); // b1: file gone -> deleted
  add(store, C, 5, 6, "two"); // b2: range off the end -> crossed
  add(store, B, 1, 1, "nope"); // b3: lapsed, audit fails -> lapsed
  store.markLapsed(B);
  log.length = 0;

  await store.resolveForPrompt(reader({ [B]: lines("b1", "b2"), [C]: lines("c1", "c2") }).read);

  assert.deepStrictEqual(
    log,
    ["[ctx] lost id=b1 reason=deleted", "[ctx] lost id=b2 reason=crossed", "[ctx] lost id=b3 reason=lapsed"],
    "logged in list order, at the moment each loss happens",
  );
});

test("a LAPSED entry whose range now falls off the end is lost as lapsed, not crossed: the audit runs first", async () => {
  const store = new ContextBlockStore();
  add(store, A, 5, 6, lines("one", "two"));
  store.markLapsed(A);

  assert.deepStrictEqual(await store.resolveForPrompt(reader({ [A]: lines("head", "tail") }).read), []);
  assert.strictEqual(store.list()[0].lost, "lapsed", "step 3 precedes step 4");
});

// ===========================================================================
// Entry discipline: frozen, in place, and no key growth
// ===========================================================================

test("a resolve replaces entries in place: id, uri and list position survive, and the entry stays frozen", async () => {
  const store = new ContextBlockStore();
  add(store, A, 1, 1, "old-a");
  add(store, B, 1, 1, "old-b");

  await store.resolveForPrompt(reader({ [A]: "new-a", [B]: "new-b" }).read);

  const list = store.list();
  assert.deepStrictEqual(list.map((e) => e.id), ["b1", "b2"]);
  assert.deepStrictEqual(list.map((e) => e.text), ["new-a", "new-b"]);
  assert.ok(list.every((e) => Object.isFrozen(e)));
  assert.ok(list.every((e) => Object.isFrozen(e.range)));
});

test("a healthy entry never grows a lapsed or lost key through a resolve", async () => {
  const store = new ContextBlockStore();
  add(store, A, 1, 1, "old");

  await store.resolveForPrompt(reader({ [A]: "new" }).read);

  assert.deepStrictEqual(Object.keys(store.list()[0]).sort(), ["addedAtVersion", "id", "range", "text", "uri"]);
});

test("a block removed while its own text was being read never reaches the prompt (bar 3)", async () => {
  const store = new ContextBlockStore();
  add(store, A, 1, 1, "one");
  add(store, B, 1, 1, "two");
  const read = async (uri) => {
    if (uri === A) {
      store.remove("b1");
    }
    return uri === A ? "one" : "two";
  };

  const blocks = await store.resolveForPrompt(read);

  assert.deepStrictEqual(blocks.map((b) => b.uri), [B], "the removed block is gone from the prompt");
  assert.strictEqual(store.list().length, 1);
});

test("a block removed while an EARLIER entry was being read is skipped, and the rest still resolve", async () => {
  const store = new ContextBlockStore();
  add(store, A, 1, 1, "one");
  add(store, B, 1, 1, "two");
  add(store, A, 2, 2, "three");
  const read = async (uri) => {
    store.remove("b2"); // fires on the first read, before b2's turn
    return uri === A ? lines("a1", "a2") : "b1";
  };

  const blocks = await store.resolveForPrompt(read);

  assert.deepStrictEqual(blocks.map((b) => b.text), ["a1", "a2"], "b3 is not skipped by the hole b2 left");
});

// ===========================================================================
// markLapsed
// ===========================================================================

test("markLapsed marks every live entry in the uri, counts them, and leaves other uris alone", () => {
  const store = new ContextBlockStore();
  add(store, A, 1, 1, "one");
  add(store, B, 1, 1, "two");
  add(store, A, 2, 2, "three");
  const seen = watch(store);

  assert.strictEqual(store.markLapsed(A), 2);
  assert.strictEqual(seen.count, 1);
  assert.deepStrictEqual(store.list().map((e) => e.lapsed), [true, undefined, true]);
  assert.ok(!("lapsed" in store.list()[1]));
});

test("markLapsed is idempotent: the second call changes nothing and does not notify", () => {
  const store = new ContextBlockStore();
  add(store, A, 1, 1, "one");
  store.markLapsed(A);
  const seen = watch(store);
  const before = store.list()[0];

  assert.strictEqual(store.markLapsed(A), 0);
  assert.strictEqual(seen.count, 0);
  assert.strictEqual(store.list()[0], before, "not even a churned object");
});

test("markLapsed skips a lost entry: lost is terminal and does not go back to being merely lapsed", () => {
  const store = new ContextBlockStore();
  add(store, A, 1, 1, "one");
  store.markDeleted(A);

  assert.strictEqual(store.markLapsed(A), 0);
  assert.strictEqual(store.list()[0].lost, "deleted");
  assert.ok(!("lapsed" in store.list()[0]));
});

test("markLapsed on a uri with no blocks returns 0 and does not notify", () => {
  const store = new ContextBlockStore();
  add(store, A, 1, 1, "one");
  const seen = watch(store);
  assert.strictEqual(store.markLapsed(B), 0);
  assert.strictEqual(seen.count, 0);
});

// ===========================================================================
// markDeleted
// ===========================================================================

test("markDeleted loses every live entry in the uri, returns them in list order, and notifies once", () => {
  const log = [];
  const store = new ContextBlockStore((line) => log.push(line));
  add(store, A, 1, 1, "one");
  add(store, B, 1, 1, "two");
  add(store, A, 2, 2, "three");
  const seen = watch(store);

  const lost = store.markDeleted(A);

  assert.deepStrictEqual(lost.map((e) => e.id), ["b1", "b3"]);
  assert.ok(lost.every((e) => e.lost === "deleted"));
  assert.strictEqual(seen.count, 1);
  assert.strictEqual(store.list()[1].lost, undefined, "the other uri is untouched");
  assert.deepStrictEqual(log.filter((l) => l.startsWith("[ctx] lost")), [
    "[ctx] lost id=b1 reason=deleted",
    "[ctx] lost id=b3 reason=deleted",
  ]);
});

test("markDeleted does not re-report an already-lost entry", () => {
  const store = new ContextBlockStore();
  add(store, A, 1, 1, "one");
  assert.deepStrictEqual(store.markDeleted(A).map((e) => e.id), ["b1"]);
  const seen = watch(store);

  assert.deepStrictEqual(store.markDeleted(A), []);
  assert.strictEqual(seen.count, 0);
});

test("markDeleted keeps the range and the last known text, so the panel can still say where the block was", () => {
  const store = new ContextBlockStore();
  add(store, A, 3, 6, "the body");
  const [gone] = store.markDeleted(A);
  assert.deepStrictEqual(gone.range, { startLine: 3, endLine: 6 });
  assert.strictEqual(gone.text, "the body");
  assert.ok(Object.isFrozen(gone));
});

test("a deleted block is excluded from the next resolve without a read", async () => {
  const store = new ContextBlockStore();
  add(store, A, 1, 1, "one");
  store.markDeleted(A);
  const { read, calls } = reader({ [A]: "one" });

  assert.deepStrictEqual(await store.resolveForPrompt(read), []);
  assert.deepStrictEqual(calls, []);
});

// ===========================================================================
// renameUri
// ===========================================================================

test("renameUri moves the ADDRESS and nothing else: range, text, id, position and health survive", () => {
  const store = new ContextBlockStore();
  add(store, A, 3, 6, "alpha", 7);
  add(store, B, 1, 1, "beta");
  add(store, A, 2, 2, "gamma");
  store.markLapsed(A);
  const seen = watch(store);

  assert.strictEqual(store.renameUri(A, "file:///w/moved.rs"), 2);
  assert.strictEqual(seen.count, 1);

  const list = store.list();
  assert.deepStrictEqual(list.map((e) => e.uri), ["file:///w/moved.rs", B, "file:///w/moved.rs"]);
  assert.deepStrictEqual(list.map((e) => e.id), ["b1", "b2", "b3"]);
  assert.deepStrictEqual(list[0].range, { startLine: 3, endLine: 6 });
  assert.strictEqual(list[0].text, "alpha");
  assert.strictEqual(list[0].addedAtVersion, 7);
  assert.strictEqual(list[0].lapsed, true, "a rename moves a block's address, not its health");
});

test("renameUri carries a LOST entry too: a lost block still has to say where it used to live", () => {
  const store = new ContextBlockStore();
  add(store, A, 1, 1, "one");
  store.markDeleted(A);

  assert.strictEqual(store.renameUri(A, B), 1);
  assert.strictEqual(store.list()[0].uri, B);
  assert.strictEqual(store.list()[0].lost, "deleted");
});

test("renameUri with no match returns 0 and does not notify", () => {
  const store = new ContextBlockStore();
  add(store, A, 1, 1, "one");
  const seen = watch(store);
  assert.strictEqual(store.renameUri(B, "file:///w/nope.rs"), 0);
  assert.strictEqual(seen.count, 0);
});

test("after a rename the resolver reads the NEW uri", async () => {
  const store = new ContextBlockStore();
  add(store, A, 1, 1, "one");
  store.renameUri(A, B);
  const { read, calls } = reader({ [B]: "moved text" });

  const blocks = await store.resolveForPrompt(read);

  assert.deepStrictEqual(calls, [B]);
  assert.deepStrictEqual(blocks, [{ uri: B, range: { startLine: 1, endLine: 1 }, text: "moved text" }]);
});

// ===========================================================================
// The list mutating under a suspended resolve. Folded in from the phase-2
// adversarial review (2026-07-28), which found six defects here. `read` is
// async and the human still has the panel, so every one of these gestures is
// reachable between one entry's read and the next.
// ===========================================================================

const C = "file:///w/c.rs";
const D = "file:///w/d.rs";

test("bar 3: a block removed mid-resolve AFTER its own read never reaches the projection", async () => {
  const store = new ContextBlockStore();
  const doomed = add(store, A, 1, 1, "SENTINEL_A");
  add(store, B, 1, 1, "SENTINEL_B");

  const read = async (uri) => {
    // The human clicks Remove on block A while block B's file is being read.
    if (uri === B) {
      store.remove(doomed.id);
    }
    return uri === A ? "SENTINEL_A" : "SENTINEL_B";
  };

  const blocks = await store.resolveForPrompt(read);

  assert.ok(
    !store.list().some((e) => e.id === doomed.id),
    "control: the block really was removed before the resolve returned",
  );
  assert.deepStrictEqual(
    blocks.map((b) => b.uri),
    [B],
    `a block removed mid-resolve reached the prompt: bar 3 broken. got ${JSON.stringify(blocks)}`,
  );
});

test("bar 3: clear() mid-resolve drops the blocks already read as well", async () => {
  const store = new ContextBlockStore();
  add(store, A, 1, 1, "SENTINEL_A");
  add(store, B, 1, 1, "SENTINEL_B");

  const read = async (uri) => {
    if (uri === B) {
      store.clear();
    }
    return uri === A ? "SENTINEL_A" : "SENTINEL_B";
  };

  const blocks = await store.resolveForPrompt(read);

  assert.strictEqual(store.list().length, 0, "control: the store really is empty");
  assert.deepStrictEqual(blocks, [], `a cleared store still produced a payload: ${JSON.stringify(blocks)}`);
});

test("two removals in ONE gesture do not make the walk skip a healthy neighbour", async () => {
  const store = new ContextBlockStore();
  const a = add(store, A, 1, 1, "TEXT_A");
  const b = add(store, B, 1, 1, "TEXT_B");
  add(store, C, 1, 1, "TEXT_C");
  add(store, D, 1, 1, "TEXT_D");

  let fired = false;
  const read = async (uri) => {
    // The toast's `Remove` action clears exactly the blocks it named: more than
    // one entry leaves the list in a single gesture.
    if (uri === B && !fired) {
      fired = true;
      store.remove(a.id);
      store.remove(b.id);
    }
    return `TEXT_${uri.slice(-4, -3).toUpperCase()}`;
  };

  const blocks = await store.resolveForPrompt(read);

  assert.ok(store.list().some((e) => e.uri === C), "control: block C is still listed and still healthy");
  assert.deepStrictEqual(
    blocks.map((x) => x.uri),
    [C, D],
    "the two removed blocks are gone and neither survivor was skipped",
  );
});

test("an entry moved UP mid-resolve reaches the prompt ONCE, in the panel's new order", async () => {
  const store = new ContextBlockStore();
  add(store, A, 1, 1, "TEXT_A");
  const b = add(store, B, 1, 1, "TEXT_B");
  add(store, C, 1, 1, "TEXT_C");

  let fired = false;
  const read = async (uri) => {
    if (uri === B && !fired) {
      fired = true;
      store.move(b.id, "up");
    }
    return `TEXT_${uri.slice(-4, -3).toUpperCase()}`;
  };

  const blocks = await store.resolveForPrompt(read);
  const uris = blocks.map((x) => x.uri);

  assert.strictEqual(new Set(uris).size, uris.length, `the same block reached the prompt twice: ${JSON.stringify(uris)}`);
  assert.deepStrictEqual(uris, store.list().map((e) => e.uri), "order in the panel is order in the prompt");
});

test("an entry moved DOWN mid-resolve does not make the walk skip its neighbour", async () => {
  const store = new ContextBlockStore();
  const a = add(store, A, 1, 1, "TEXT_A");
  add(store, B, 1, 1, "TEXT_B");
  add(store, C, 1, 1, "TEXT_C");

  let fired = false;
  const read = async (uri) => {
    if (uri === A && !fired) {
      fired = true;
      store.move(a.id, "down");
    }
    return `TEXT_${uri.slice(-4, -3).toUpperCase()}`;
  };

  const blocks = await store.resolveForPrompt(read);

  assert.deepStrictEqual(blocks.map((x) => x.uri), store.list().map((e) => e.uri), "nothing skipped, panel order kept");
  assert.ok(blocks.some((x) => x.uri === B), "the neighbour the moved entry displaced still resolves");
});

test("a read that REJECTS still notifies: the mutations it already landed reach the panel", async () => {
  // The contract's reader wraps `vscode.workspace.openTextDocument`, which
  // rejects for a missing file rather than resolving undefined. A phase-3
  // reader missing a `.catch` produces exactly this.
  const store = new ContextBlockStore();
  add(store, A, 1, 1, "TEXT_A");
  add(store, B, 1, 1, "TEXT_B");
  const seen = watch(store);

  const read = async (uri) => {
    if (uri === A) {
      return undefined; // -> lost: "deleted", a real mutation
    }
    throw new Error("EACCES");
  };

  await assert.rejects(() => store.resolveForPrompt(read), /EACCES/);

  assert.strictEqual(store.list()[0].lost, "deleted", "control: the store really was mutated");
  assert.strictEqual(
    seen.count,
    1,
    "a mutation landed with no notification: the panel keeps painting a lost block green",
  );
});

test("an entry re-frozen under its own await is read ONCE, not read again without bound", async () => {
  const store = new ContextBlockStore();
  add(store, A, 1, 1, "TEXT_A");

  let version = 1;
  let reads = 0;
  const read = async (uri) => {
    if (++reads > 50) {
      throw new Error(`livelock: read called ${reads} times for one entry`);
    }
    // A zero-change event at a new version: the store's own documented shape
    // for "an edit landed". It replaces the frozen entry object, and object
    // identity alone would read that as a brand new entry.
    store.reanchor(uri, [], ++version);
    return "TEXT_A";
  };

  const blocks = await store.resolveForPrompt(read);

  assert.strictEqual(blocks.length, 1);
  assert.strictEqual(reads, 1, `read is called once per live entry, got ${reads}`);
});

test("a block lost by markDeleted mid-resolve does not reach the prompt either", async () => {
  const store = new ContextBlockStore();
  add(store, A, 1, 1, "TEXT_A");
  add(store, B, 1, 1, "TEXT_B");

  const read = async (uri) => {
    if (uri === A) {
      store.markDeleted(A); // the delete watcher fires while we are reading
    }
    return uri === A ? "TEXT_A" : "TEXT_B";
  };

  const blocks = await store.resolveForPrompt(read);

  assert.deepStrictEqual(blocks.map((b) => b.uri), [B], "an entry lost under the await is excluded");
  assert.strictEqual(store.list()[0].lost, "deleted");
});

// ===========================================================================
// reanchor's optional fourth argument: the document's full text.
// The cached `text` is what the panel previews without an await and what the
// re-adoption audit compares against, so it has to be current as of the moment
// tracking stopped, not as of the last generation.
// ===========================================================================

test("reanchor with the document text refreshes every surviving entry's cached slice", async () => {
  const store = new ContextBlockStore();
  add(store, A, 2, 3, lines("one", "two"));
  add(store, A, 5, 5, "five");
  const after = lines("head", "ONE", "TWO", "mid", "five");

  store.reanchor(A, [{ startLine: 1, endLine: 1, endCharacter: 3, newlineCount: 0, endsAtLineStart: false }], 2, after);

  assert.deepStrictEqual(
    store.list().map((e) => e.text),
    [lines("ONE", "TWO"), "five"],
    "the panel preview reads entry.text and cannot await, so it has to be current",
  );
});

test("reanchor WITHOUT the document text leaves the cached slice alone", () => {
  const store = new ContextBlockStore();
  add(store, A, 2, 3, lines("one", "two"));

  store.reanchor(A, [{ startLine: 1, endLine: 1, endCharacter: 3, newlineCount: 0, endsAtLineStart: false }], 2);

  assert.strictEqual(store.list()[0].text, lines("one", "two"), "the three-argument form is unchanged");
});

test("a lost entry's cached text is NOT refreshed: it is the record of where the block was", () => {
  const store = new ContextBlockStore();
  add(store, A, 1, 1, "the body");
  const doc = lines("replaced", "replaced");

  store.reanchor(A, [{ startLine: 0, endLine: 1, endCharacter: 3, newlineCount: 0, endsAtLineStart: false }], 2, doc);

  assert.strictEqual(store.list()[0].lost, "crossed");
  assert.strictEqual(store.list()[0].text, "the body");
});

test("a block EDITED and then LAPSED is adopted at the next resolve, not lost", async () => {
  const store = new ContextBlockStore();
  const before = lines("fn beta() {", "    let y = 1;", "}");
  const entry = add(store, A, 1, 3, before);
  const after = lines("fn beta() {", "    let y = 41;", "}");

  // The human edits INSIDE the block. reanchor keeps the range exactly right
  // and, with the document text, the cached slice with it.
  const report = store.reanchor(
    A,
    [{ startLine: 1, endLine: 1, endCharacter: 16, newlineCount: 0, endsAtLineStart: false }],
    2,
    after,
  );
  assert.strictEqual(report.lost.length, 0, "control: the edit did not lose the block");
  assert.deepStrictEqual(store.list()[0].range, { startLine: 1, endLine: 3 }, "control: the range still slices the function");

  // The human closes the tab, then generates from another file.
  assert.strictEqual(store.markLapsed(A), 1);
  const blocks = await store.resolveForPrompt(reader({ [A]: after }).read);

  assert.strictEqual(
    store.list().find((e) => e.id === entry.id).lost,
    undefined,
    "the range was exact the whole time; losing it here would be the audit failing over its own stale cache",
  );
  assert.deepStrictEqual(blocks.map((b) => b.text), [after], "and the block still reaches the prompt, live");
});

test("moved still counts range-or-version, so a text-only refresh is not a move", () => {
  const store = new ContextBlockStore();
  add(store, A, 1, 1, "old", 2);

  // Zero changes at the SAME version: the second event every edit fires. The
  // slice differs only because the cache was behind.
  const report = store.reanchor(A, [], 2, "new");

  assert.strictEqual(report.moved, 0, "nothing's range or version changed");
  assert.strictEqual(store.list()[0].text, "new", "but the cache caught up");
});

// ===========================================================================
// toPromptBlocks does not move
// ===========================================================================

test("toPromptBlocks is unchanged: synchronous, whole-list, last-known text", () => {
  const store = new ContextBlockStore();
  add(store, A, 1, 1, "one");
  add(store, B, 2, 3, "two");
  store.markDeleted(B);

  assert.deepStrictEqual(store.toPromptBlocks(), [
    { uri: A, range: { startLine: 1, endLine: 1 }, text: "one" },
    { uri: B, range: { startLine: 2, endLine: 3 }, text: "two" },
  ]);
});
