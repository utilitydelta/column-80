// Implementer oracle: context-block edges the blind set cannot see —
// subscribe reentrancy (roster changes and store mutation during delivery),
// move boundary indices after interleaved mutation, staleness probes shaped
// like deleted/truncated files, and the store under concurrent/superseding
// generates (the headless analog of the command path's live read).
// Complements test/blind3-*.test.cjs.
//
// Run: npm test

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl3-contextBlocks",
  `export { ContextBlockStore, isStale, sliceLines, clampedLineSpan, decorationLineSpans } from "../src/core/contextBlocks";
export { FnGenService } from "../src/core/fnGenService";\n`
);
const { ContextBlockStore, isStale, sliceLines, clampedLineSpan, decorationLineSpans, FnGenService } = mod;
test.after(cleanup);

const input = (uri, text, version = 1, startLine = 1, endLine = 1) => ({
  uri,
  range: { startLine, endLine },
  text,
  version,
});
const A = () => input("file:///w/a.rs", "SENTINEL_ALPHA", 7, 3, 9);
const B = () => input("file:///w/b.rs", "SENTINEL_BETA", 2, 1, 4);
const C = () => input("file:///w/c.rs", "SENTINEL_GAMMA", 5, 10, 12);

// ---- subscribe reentrancy: the roster is snapshotted per notification

test("a listener subscribing another listener mid-notification: the new one misses the current mutation, sees the next", () => {
  const store = new ContextBlockStore();
  const seen = [];
  let subscribed = false;
  store.subscribe(() => {
    seen.push("outer");
    if (!subscribed) {
      subscribed = true;
      store.subscribe(() => seen.push("inner"));
    }
  });
  store.add(A());
  assert.deepStrictEqual(seen, ["outer"], "inner not called for the mutation that registered it");
  store.add(B());
  assert.deepStrictEqual(seen, ["outer", "outer", "inner"]);
});

test("a listener unsubscribing itself mid-notification: runs to completion now, absent from the next", () => {
  const store = new ContextBlockStore();
  const seen = [];
  const unsub = store.subscribe(() => {
    seen.push("self");
    unsub();
  });
  store.subscribe(() => seen.push("other"));
  store.add(A());
  assert.deepStrictEqual(seen, ["self", "other"], "self-unsubscribe does not disturb later listeners in the same delivery");
  store.add(B());
  assert.deepStrictEqual(seen, ["self", "other", "other"]);
});

test("a listener unsubscribing a LATER listener mid-notification: the later one still runs this delivery (snapshot semantics), gone next", () => {
  const store = new ContextBlockStore();
  const seen = [];
  let unsubLater;
  store.subscribe(() => {
    seen.push("first");
    unsubLater();
  });
  unsubLater = store.subscribe(() => seen.push("later"));
  store.add(A());
  assert.deepStrictEqual(seen, ["first", "later"]);
  store.add(B());
  assert.deepStrictEqual(seen, ["first", "later", "first"]);
});

test("the same function subscribed twice fires twice in order; each unsubscribe removes only its own registration", () => {
  const store = new ContextBlockStore();
  const seen = [];
  const fn = () => seen.push("x");
  const unsub1 = store.subscribe(fn);
  store.subscribe(fn);
  store.add(A());
  assert.deepStrictEqual(seen, ["x", "x"]);
  unsub1();
  store.add(B());
  assert.deepStrictEqual(seen, ["x", "x", "x"], "second registration survives the first's unsubscribe");
});

test("a listener mutating the store mid-notification: nested delivery completes and the final state is consistent", () => {
  const store = new ContextBlockStore();
  const e1 = store.add(A());
  let fired = 0;
  let removed = false;
  store.subscribe(() => {
    fired++;
    if (!removed) {
      removed = true;
      // Reentrant mutation: notifies again, nested inside this delivery.
      store.remove(e1.id);
    }
  });
  store.add(B());
  assert.strictEqual(fired, 2, "the nested remove produced its own delivery");
  assert.deepStrictEqual(store.list().map((e) => e.uri), ["file:///w/b.rs"]);
  assert.deepStrictEqual(store.toPromptBlocks().map((b) => b.uri), ["file:///w/b.rs"]);
});

// ---- move boundary indices after interleaved mutation

test("repeated up moves stop exactly at the top; order below stays intact", () => {
  const store = new ContextBlockStore();
  const [a, b, c] = [store.add(A()), store.add(B()), store.add(C())];
  assert.strictEqual(store.move(c.id, "up"), true); // [a, c, b]
  assert.strictEqual(store.move(c.id, "up"), true); // [c, a, b]
  assert.strictEqual(store.move(c.id, "up"), false, "already at the top");
  assert.deepStrictEqual(store.list().map((e) => e.id), [c.id, a.id, b.id]);
});

test("remove shifts the boundary: the new first entry cannot move up, the new last cannot move down", () => {
  const store = new ContextBlockStore();
  const [a, b, c] = [store.add(A()), store.add(B()), store.add(C())];
  assert.strictEqual(store.remove(a.id), true); // [b, c]
  assert.strictEqual(store.move(b.id, "up"), false, "b is now first");
  assert.strictEqual(store.move(c.id, "down"), false, "c is now last");
  assert.strictEqual(store.move(b.id, "down"), true);
  assert.deepStrictEqual(store.list().map((e) => e.id), [c.id, b.id]);
});

test("move on an empty store is a miss, not a crash", () => {
  const store = new ContextBlockStore();
  assert.strictEqual(store.move("b1", "up"), false);
  assert.strictEqual(store.move("b1", "down"), false);
});

test("two entries: first-down and second-up are inverse swaps", () => {
  const store = new ContextBlockStore();
  const [a, b] = [store.add(A()), store.add(B())];
  assert.strictEqual(store.move(a.id, "down"), true);
  assert.deepStrictEqual(store.list().map((e) => e.id), [b.id, a.id]);
  assert.strictEqual(store.move(a.id, "up"), true);
  assert.deepStrictEqual(store.list().map((e) => e.id), [a.id, b.id]);
});

// ---- staleness on file-delete shapes: what the panel hands isStale when the
// source is gone, truncated, or replaced

const entry = (text = "l2\nl3", startLine = 2, endLine = 3) => ({
  id: "b1",
  uri: "file:///w/a.rs",
  range: { startLine, endLine },
  text,
  addedAtVersion: 7,
});

const deleteShapes = [
  // Deleted-and-closed: no document, no evidence, renders fresh by contract.
  { name: "file deleted and closed (empty probe) is not stale", e: entry(), probe: {}, expected: false },
  // Buffer truncated to empty: the snapshot's lines no longer exist.
  { name: "buffer truncated to empty text is stale for a non-empty snapshot", e: entry(), probe: { text: "" }, expected: true },
  { name: "empty snapshot vs empty buffer is not stale (nothing changed about nothing)", e: entry("", 1, 1), probe: { text: "" }, expected: false },
  // File shrank below the snapshot's range: the slice degrades to "".
  { name: "range entirely beyond the shrunken text is stale", e: entry("l5\nl6", 5, 6), probe: { text: "l1\nl2" }, expected: true },
  // Whole file replaced by unrelated content of the same length.
  { name: "replaced content under the same range is stale", e: entry(), probe: { text: "x1\nx2\nx3\nx4" }, expected: true },
  // Truncation that leaves the range's lines intact is not stale on the text leg.
  { name: "truncation below the range but above its lines is not stale on the text leg", e: entry(), probe: { text: "l1\nl2\nl3" }, expected: false },
];
for (const { name, e, probe, expected } of deleteShapes) {
  test(`file-delete shapes: ${name}`, () => {
    assert.strictEqual(isStale(e, probe), expected);
  });
}

test("sliceLines on empty text never yields a phantom line, whatever the range", () => {
  for (const range of [{ startLine: 1, endLine: 1 }, { startLine: 1, endLine: 99 }, { startLine: 2, endLine: 2 }]) {
    assert.strictEqual(sliceLines("", range), "");
  }
});

// ---- the store under concurrent generate: projections are read at generate
// time, and an in-flight generate keeps the projection it was handed

const CFG = {
  apiBase: "http://127.0.0.1:1", // never reached: generate is injected
  model: "fake-30b",
  fallbackModel: "fake-14b",
  maxTokens: 128,
  temperature: 0.2,
};
const REQ = { signature: "fn add(a: i32, b: i32) -> i32", docComment: "/// Adds.", languageId: "rust" };
const RAW = "```rust\nfn add(a: i32, b: i32) -> i32 {\n    a + b\n}\n```";

// Injected generate fn that parks until released, capturing each prompt at
// invocation — the moment the service fixed its bytes.
function gatedGenerate() {
  let release;
  const gate = new Promise((r) => (release = r));
  const prompts = [];
  const fn = async (params) => {
    prompts.push(params.prompt);
    await gate;
    return { text: RAW, ttftMs: 1, totalMs: 2 };
  };
  return { fn, prompts, release };
}

test("a generate in flight keeps its projection; a later generate on another service sees the mutated store", async () => {
  const store = new ContextBlockStore();
  const a = store.add(A());
  const slow = gatedGenerate();
  const svc1 = new FnGenService(CFG, slow.fn);
  const pending = svc1.generate({ ...REQ, contextBlocks: store.toPromptBlocks() });
  assert.strictEqual(slow.prompts.length, 1, "prompt bytes fixed before any await");
  assert.ok(slow.prompts[0].includes("SENTINEL_ALPHA"));

  assert.strictEqual(store.remove(a.id), true);
  let fastPrompt;
  const svc2 = new FnGenService(CFG, async (p) => {
    fastPrompt = p.prompt;
    return { text: RAW, ttftMs: 1, totalMs: 2 };
  });
  const fast = await svc2.generate({ ...REQ, contextBlocks: store.toPromptBlocks() });
  assert.ok(fast, "the second generate completes while the first is parked");
  assert.ok(!fastPrompt.includes("SENTINEL_ALPHA"), "removed block absent from the post-removal generate");

  slow.release();
  const result = await pending;
  assert.ok(result, "the parked generate still completes");
  assert.ok(slow.prompts[0].includes("SENTINEL_ALPHA"), "in-flight prompt unchanged by the removal");
  svc1.dispose();
  svc2.dispose();
});

test("regenerate gesture: superseding generate on the SAME service reads the store fresh; the stale one dies, the new prompt drops the removed block", async () => {
  const store = new ContextBlockStore();
  const a = store.add(A());
  store.add(B());
  const gated = gatedGenerate();
  const svc = new FnGenService(CFG, gated.fn);

  const first = svc.generate({ ...REQ, contextBlocks: store.toPromptBlocks() });
  assert.strictEqual(store.remove(a.id), true);
  const second = svc.generate({ ...REQ, contextBlocks: store.toPromptBlocks() });
  gated.release();
  const [r1, r2] = await Promise.all([first, second]);

  assert.strictEqual(r1, undefined, "superseded generate resolves undefined, never a leaked result");
  assert.ok(r2, "the regenerate completes");
  assert.ok(gated.prompts[0].includes("SENTINEL_ALPHA"), "control: the first prompt held the block");
  assert.ok(!gated.prompts[1].includes("SENTINEL_ALPHA"), "the regenerate's fresh read excludes the removed block");
  assert.ok(gated.prompts[1].includes("SENTINEL_BETA"), "surviving block still present");
  svc.dispose();
});

test("store mutations during an in-flight generate notify subscribers normally; the generate does not hold a store lock", async () => {
  const store = new ContextBlockStore();
  store.add(A());
  const gated = gatedGenerate();
  const svc = new FnGenService(CFG, gated.fn);
  const pending = svc.generate({ ...REQ, contextBlocks: store.toPromptBlocks() });

  let notified = 0;
  store.subscribe(() => notified++);
  store.add(B());
  store.clear();
  assert.strictEqual(notified, 2, "panel keeps tracking while a generate is parked");

  gated.release();
  assert.ok(await pending);
  svc.dispose();
});

// ---------------------------------------------------------------------------
// Editor line spans: the panel's highlight and click-to-reveal share one
// clamp (clampedLineSpan), and the highlight filters on `lost`.
// ---------------------------------------------------------------------------

const entryAt = (startLine, endLine, text, version = 1) => ({
  id: "b1",
  uri: "file:///a.ts",
  range: { startLine, endLine },
  text,
  addedAtVersion: version,
});

test("clampedLineSpan: 1-based inclusive ranges become 0-based editor spans, clamped to the document", () => {
  assert.deepStrictEqual(clampedLineSpan({ startLine: 3, endLine: 5 }, 10), { startLine: 2, endLine: 4 });
  assert.deepStrictEqual(clampedLineSpan({ startLine: 1, endLine: 1 }, 1), { startLine: 0, endLine: 0 });
  // a shrunk document still yields a landing spot near where the block was
  assert.deepStrictEqual(clampedLineSpan({ startLine: 8, endLine: 12 }, 5), { startLine: 4, endLine: 4 });
  // empty/absurd documents yield nothing to select
  assert.strictEqual(clampedLineSpan({ startLine: 1, endLine: 3 }, 0), undefined);
  assert.strictEqual(clampedLineSpan({ startLine: 1, endLine: 0 }, 5), undefined);
});

test("decorationLineSpans: live entries highlight, lost entries do not", () => {
  const live = entryAt(1, 2, "alpha\nbeta");
  assert.deepStrictEqual(decorationLineSpans([live], 3), [{ startLine: 0, endLine: 1 }]);
  // A version bump and a text drift are both the FEATURE now: the range tracks
  // the edit and the payload is read at generate time, so the tint stays.
  assert.deepStrictEqual(decorationLineSpans([{ ...live, addedAtVersion: 2 }], 3), [
    { startLine: 0, endLine: 1 },
  ]);
  assert.deepStrictEqual(decorationLineSpans([entryAt(1, 2, "alpha\nCHANGED")], 3), [
    { startLine: 0, endLine: 1 },
  ]);
  // mixed roster keeps only the live span: a lost block's range says where it
  // USED to be, and tinting it would claim the model still gets those lines
  const lost = { ...entryAt(3, 3, "WRONG"), id: "b2", lost: "crossed" };
  assert.deepStrictEqual(decorationLineSpans([live, lost], 3), [{ startLine: 0, endLine: 1 }]);
});
