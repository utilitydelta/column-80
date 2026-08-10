// Blind oracle: subscribe/notification semantics + [ctx] evidence lines
// (phase3-surface.md "Store semantics" subscribe bullet + "[ctx] log line
// formats, complete list"). Written against the surface doc only; never read
// src/**. Expected red while stubs throw.
//
// Run: npm test

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "blind3-notify",
  `export { ContextBlockStore, isStale, sliceLines } from "../src/core/contextBlocks";\n`
);
const { ContextBlockStore, isStale, sliceLines } = mod;
test.after(cleanup);

const input = (uri, text, version = 1, startLine = 1, endLine = 1) => ({
  uri,
  range: { startLine, endLine },
  text,
  version,
});
const A = () => input("file:///w/a.rs", "alpha text", 7, 3, 9);
const B = () => input("file:///w/b.rs", "beta text", 2, 1, 4);

// ---- notifications fire on every state change [surface: 'listener runs synchronously after
// every state change (successful add/remove/move, every clear)']

test("listener fires synchronously exactly once per successful add/remove/move and every clear, n=0 included", () => {
  const store = new ContextBlockStore();
  let n = 0;
  store.subscribe(() => n++);
  const e1 = store.add(A());
  assert.strictEqual(n, 1, "add notifies synchronously");
  const e2 = store.add(B());
  assert.strictEqual(n, 2);
  assert.strictEqual(store.move(e2.id, "up"), true);
  assert.strictEqual(n, 3, "successful move notifies");
  assert.strictEqual(store.remove(e1.id), true);
  assert.strictEqual(n, 4, "successful remove notifies");
  assert.strictEqual(store.clear(), 1);
  assert.strictEqual(n, 5, "clear notifies");
  assert.strictEqual(store.clear(), 0);
  assert.strictEqual(n, 6, "clear always notifies, n=0 included");
});

test("failed remove and failed move do not notify [surface: remove/move 'no log, no notification']", () => {
  const store = new ContextBlockStore();
  const e = store.add(A());
  let n = 0;
  store.subscribe(() => n++);
  assert.strictEqual(store.remove("nope"), false);
  assert.strictEqual(store.move("nope", "up"), false);
  assert.strictEqual(store.move(e.id, "up"), false, "move past the top edge");
  assert.strictEqual(store.move(e.id, "down"), false, "move past the bottom edge");
  assert.strictEqual(n, 0, "no notification for any failed mutation");
});

test("reads and staleness recomputation never notify: list, toPromptBlocks, isStale, sliceLines [surface: subscribe fires on state change only]", () => {
  const store = new ContextBlockStore();
  const e = store.add(A());
  let n = 0;
  store.subscribe(() => n++);
  store.list();
  store.toPromptBlocks();
  isStale(e, { version: 999, text: "changed" });
  sliceLines("a\nb\nc", { startLine: 1, endLine: 2 });
  assert.strictEqual(n, 0, "staleness recomputation is not a state change");
});

// ---- listener ordering and errors [surface: 'in subscription order. Listener exceptions
// propagate to the mutating caller.']

test("listeners run in subscription order on every mutation", () => {
  const store = new ContextBlockStore();
  const order = [];
  store.subscribe(() => order.push("first"));
  store.subscribe(() => order.push("second"));
  store.add(A());
  store.clear();
  assert.deepStrictEqual(order, ["first", "second", "first", "second"]);
});

test("a throwing listener propagates to the mutating caller, after the state change landed", () => {
  const store = new ContextBlockStore();
  store.subscribe(() => {
    throw new Error("panel exploded");
  });
  assert.throws(() => store.add(A()), /panel exploded/);
  assert.strictEqual(store.list().length, 1, "listener runs after the state change: the add landed");
});

// ---- unsubscribe [surface: 'Returns an idempotent unsubscribe.']

test("unsubscribe stops delivery, is idempotent, and leaves other listeners untouched", () => {
  const store = new ContextBlockStore();
  const seen = [];
  const unsub = store.subscribe(() => seen.push("one"));
  store.subscribe(() => seen.push("two"));
  store.add(A());
  assert.deepStrictEqual(seen, ["one", "two"]);
  unsub();
  assert.doesNotThrow(unsub, "unsubscribe is idempotent");
  store.add(B());
  assert.deepStrictEqual(seen, ["one", "two", "two"], "only the surviving listener fires");
});

// ---- [ctx] evidence lines [surface: '[ctx] log line formats, complete list']

test("[ctx] lines: exact formats in mutation order — bytes is UTF-8 length, uri last, n=0 clear logged", () => {
  const lines = [];
  const store = new ContextBlockStore((l) => lines.push(l));
  // "café" is 4 chars, 5 UTF-8 bytes; the uri carries a space to justify uri-last.
  const e1 = store.add({ uri: "file:///my dir/café.rs", range: { startLine: 3, endLine: 9 }, text: "café", version: 7 });
  const e2 = store.add({ uri: "file:///w/b.rs", range: { startLine: 1, endLine: 1 }, text: "", version: 2 });
  assert.strictEqual(store.move(e2.id, "up"), true);
  assert.strictEqual(store.move(e2.id, "down"), true);
  assert.strictEqual(store.remove(e1.id), true);
  assert.strictEqual(store.clear(), 1);
  assert.strictEqual(store.clear(), 0);
  assert.deepStrictEqual(lines, [
    `[ctx] add id=${e1.id} range=L3-L9 bytes=5 version=7 uri=file:///my dir/café.rs`,
    `[ctx] add id=${e2.id} range=L1-L1 bytes=0 version=2 uri=file:///w/b.rs`,
    `[ctx] move id=${e2.id} up`,
    `[ctx] move id=${e2.id} down`,
    `[ctx] remove id=${e1.id}`,
    "[ctx] clear n=1",
    "[ctx] clear n=0",
  ]);
});

test("failed remove and failed move log nothing [surface: 'Failed remove/move (unknown id, edge move) log nothing']", () => {
  const lines = [];
  const store = new ContextBlockStore((l) => lines.push(l));
  const e = store.add(A());
  const after = lines.length;
  store.remove("nope");
  store.move("nope", "up");
  store.move(e.id, "up");
  store.move(e.id, "down");
  assert.strictEqual(lines.length, after, "no [ctx] line for any failed mutation");
});

test("a store constructed without a log fn mutates without throwing [surface: 'constructor(log?: LogFn)']", () => {
  const store = new ContextBlockStore();
  assert.doesNotThrow(() => {
    const e = store.add(A());
    store.move(e.id, "up");
    store.remove(e.id);
    store.clear();
  });
});
